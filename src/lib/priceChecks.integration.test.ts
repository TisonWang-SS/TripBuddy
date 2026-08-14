import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WEAKER_CANCELLATION_WARNING } from "@/lib/evidenceWarnings";
import type { LlmEvidenceCandidate } from "@/lib/providers/llmEvidence";

let workspace = "";
let prisma: typeof import("@/lib/db")["prisma"];
let BrowserCompanionPriceCheckRunner: typeof import("@/lib/priceChecks")["BrowserCompanionPriceCheckRunner"];
let captureBookingPriceTask: typeof import("@/lib/priceChecks")["captureBookingPriceTask"];
let getBrowserTask: typeof import("@/lib/browserTasks")["getBrowserTask"];
let captureBrowserTask: typeof import("@/lib/browserTaskHandlers")["captureBrowserTask"];
let createAccountImportTask: typeof import("@/lib/browserTaskHandlers")["createAccountImportTask"];
let createHotelSearchTask: typeof import("@/lib/browserTaskHandlers")["createHotelSearchTask"];
let getHotelSearchSession: typeof import("@/lib/hotelSearchSessions")["getHotelSearchSession"];
let importAccountBookings: typeof import("@/lib/accountBookings")["importAccountBookings"];
let appendBrowserSnapshot: typeof import("@/lib/browserTasks")["appendBrowserSnapshot"];
let runLlmExtractionForPriceCheck: typeof import("@/lib/llmExtraction")["runLlmExtractionForPriceCheck"];
let convertMoneyToSystemCurrency: typeof import("@/lib/systemSettings")["convertMoneyToSystemCurrency"];
let setCurrencyConversionRate: typeof import("@/lib/systemSettings")["setCurrencyConversionRate"];
let createRecommendationForBooking: typeof import("@/lib/recommendations")["createRecommendationForBooking"];

describe("persistent browser price-check flow", () => {
  beforeAll(async () => {
    workspace = mkdtempSync(join(tmpdir(), "tripbuddy-price-check-"));
    const databasePath = join(workspace, "integration.db");
    const sqlite = new DatabaseSync(databasePath);
    for (const migration of readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((migration) => existsSync(join("prisma/migrations", migration, "migration.sql")))
      .sort()) {
      sqlite.exec(readFileSync(join("prisma/migrations", migration, "migration.sql"), "utf8"));
    }
    sqlite.close();
    process.env.DATABASE_URL = `file:${databasePath}`;

    ({ prisma } = await import("@/lib/db"));
    ({ BrowserCompanionPriceCheckRunner, captureBookingPriceTask } = await import("@/lib/priceChecks"));
    ({ appendBrowserSnapshot, getBrowserTask } = await import("@/lib/browserTasks"));
    ({ captureBrowserTask, createAccountImportTask, createHotelSearchTask } = await import("@/lib/browserTaskHandlers"));
    ({ getHotelSearchSession } = await import("@/lib/hotelSearchSessions"));
    ({ importAccountBookings } = await import("@/lib/accountBookings"));
    ({ runLlmExtractionForPriceCheck } = await import("@/lib/llmExtraction"));
    ({ createRecommendationForBooking } = await import("@/lib/recommendations"));
    ({ convertMoneyToSystemCurrency, setCurrencyConversionRate } = await import("@/lib/systemSettings"));

    await prisma.systemSetting.create({ data: { id: "primary", displayCurrency: "USD" } });
    await prisma.userProfile.create({
      data: {
        defaultCurrency: "USD",
        id: "primary",
        loyaltyAccounts: {
          create: { hotelGroup: "Hyatt", tier: "Member" }
        },
        loyaltyValuations: {
          create: {
            amount: 0.017,
            asOf: new Date("2026-08-01T00:00:00.000Z"),
            currency: "USD",
            hotelGroup: "Hyatt",
            kind: "point",
            lastReviewedAt: new Date("2026-08-01T00:00:00.000Z"),
            sourceName: "Points guy valuations"
          }
        },
        name: "Integration Traveler"
      }
    });
    await prisma.loyaltyRule.create({
      data: {
        basePointsPerUsd: 5,
        bonusRate: 0,
        hotelGroup: "Hyatt",
        lastReviewedAt: new Date("2026-08-01T00:00:00.000Z"),
        sourceUrl: "https://world.hyatt.com/",
        tier: "Member"
      }
    });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
    if (workspace) {
      rmSync(workspace, { force: true, recursive: true });
    }
  });

  it("keeps one run across inventory, final detail, failure, and expiration", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 1200,
        baselineType: "cash",
        bookingChannel: "direct",
        cancellationDeadline: new Date("2026-09-08T00:00:00.000Z"),
        checkIn: new Date("2026-09-10T00:00:00.000Z"),
        checkOut: new Date("2026-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
      }
    });
    const runner = new BrowserCompanionPriceCheckRunner();
    const first = await runner.run({ bookingId: booking.id, trigger: "manual" });
    const duplicateStart = await runner.run({ bookingId: booking.id, trigger: "manual" });

    expect(first.expiresAt).toEqual(expect.any(String));
    expect(Number.isFinite(Date.parse(first.expiresAt))).toBe(true);
    expect(duplicateStart).toMatchObject({ expiresAt: first.expiresAt, runId: first.runId, taskId: first.taskId });
    expect(await prisma.priceCheckRun.count({ where: { bookingId: booking.id } })).toBe(1);

    await captureBookingPriceTask(first.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText: "1 King Bed Member Rate USD 350 Avg/Night Select & Book 25,000 points",
        pageTitle: "Hyatt rooms",
        sourceUrl: "https://www.hyatt.com/shop/rooms/tyogh?checkinDate=2026-09-10&checkoutDate=2026-09-13"
      }
    });
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(0);
    expect((await prisma.priceCheckRun.findUnique({ where: { id: first.runId } }))?.status).toBe("running");

    /*
     * Both inventory types were requested, so the first summary does not end
     * the run: Hyatt shows one mode per page, and the comparison needs both
     * inside this one capture.
     */
    const firstSummary = await captureBookingPriceTask(first.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText:
          "Price Summary Total Cash USD 990.00 Taxes & Fees USD 90.00 1 King Bed Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
        pageTitle: "Hyatt price summary",
        sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2026-09-10&checkoutDate=2026-09-13"
      }
    });
    const switchAction = (firstSummary as { action?: { action: string; url: string } }).action;
    expect(switchAction?.action).toBe("navigate");
    /* The launch leg carried usePoints; the second one must drop it for cash. */
    expect(switchAction?.url).toContain("https://www.hyatt.com/");
    expect(switchAction?.url).not.toContain("usePoints");
    expect(first.launchUrl).toContain("usePoints=true");
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(0);

    const completed = await captureBookingPriceTask(first.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText:
          "Price Summary Total Cash USD 990.00 Taxes & Fees USD 90.00 1 King Bed Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
        pageTitle: "Hyatt price summary",
        sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2026-09-10&checkoutDate=2026-09-13"
      }
    });
    /*
     * The room list's "25,000 points" states no unit and no award, so nothing
     * says whether it prices the stay. It stays evidence, and the run reports
     * that the award rates it was asked for never became comparable.
     */
    expect(completed?.status).toBe("partial");
    await expect(prisma.priceCheckRun.findUniqueOrThrow({ where: { id: first.runId } })).resolves.toMatchObject({
      summary: expect.stringContaining("No award rate was visible on the pages this run reached.")
    });
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await prisma.observationEvidence.count()).toBe(1);
    expect(await prisma.recommendation.count({ where: { bookingId: booking.id } })).toBe(1);
    await expect(prisma.watchPlan.findUniqueOrThrow({ where: { bookingId: booking.id } })).resolves.toMatchObject({
      consecutiveFailures: 0,
      lastAttemptedAt: expect.any(Date),
      lastCheckedAt: expect.any(Date)
    });

    const cashObservation = await prisma.priceObservation.findFirstOrThrow({
      where: { bookingId: booking.id, inventoryType: "cash" },
      include: { evidence: true }
    });
    expect(cashObservation.evidence).toMatchObject({
      cancellationAssessmentSource: "automated",
      cancellationMatch: "same_or_better",
      qualityLevel: "high"
    });
    expect(await prisma.recommendation.findFirstOrThrow({ where: { bookingId: booking.id } })).toMatchObject({
      candidateObservationId: cashObservation.id,
      qualityLevel: "high",
      verdict: "rebook_direct"
    });

    const failed = await runner.run({ bookingId: booking.id, trigger: "manual" });
    await captureBookingPriceTask(failed.taskId, {
      errorCode: "browser_capture_failed",
      errorMessage: "Hyatt page became unreadable."
    });
    expect((await prisma.priceCheckRun.findUnique({ where: { id: failed.runId } }))?.status).toBe("failed");
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(1);
    await expect(prisma.watchPlan.findUniqueOrThrow({ where: { bookingId: booking.id } })).resolves.toMatchObject({
      consecutiveFailures: 1,
      lastAttemptedAt: expect.any(Date)
    });

    const expiring = await runner.run({ bookingId: booking.id, trigger: "due_queue" });
    const expiredAt = new Date(Date.now() - 1_000);
    await prisma.$transaction([
      prisma.browserTask.update({ where: { id: expiring.taskId }, data: { expiresAt: expiredAt } }),
      prisma.priceCheckRun.update({ where: { id: expiring.runId }, data: { expiresAt: expiredAt } })
    ]);
    const expired = await getBrowserTask(expiring.taskId);
    expect(expired?.status).toBe("failed");
    expect(expired?.priceCheckRun?.status).toBe("failed");
    expect(expired?.errorCode).toBe("task_expired");
    await expect(prisma.watchPlan.findUniqueOrThrow({ where: { bookingId: booking.id } })).resolves.toMatchObject({
      consecutiveFailures: 2
    });
  });

  it("records when browser snapshot history exceeds its retention limit", async () => {
    const task = await prisma.browserTask.create({
      data: {
        contextJson: "{}",
        expiresAt: new Date(Date.now() + 60_000),
        hotelGroup: "Hyatt",
        id: "snapshot-retention-task",
        kind: "hotel_search",
        launchUrl: "https://www.hyatt.com/search/hotels/en-US/Tokyo"
      }
    });

    for (let index = 1; index <= 13; index += 1) {
      await appendBrowserSnapshot(task.id, {
        capturedAt: new Date(2026, 7, 11, 0, 0, index).toISOString(),
        controls: [],
        pageText: `Visible evidence ${index}`,
        pageTitle: `Snapshot ${index}`,
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Tokyo"
      });
    }

    const retained = await prisma.browserTask.findUniqueOrThrow({ where: { id: task.id } });
    const snapshots = JSON.parse(retained.snapshotsJson) as Array<{ pageTitle: string }>;
    expect(snapshots).toHaveLength(12);
    expect(snapshots[0].pageTitle).toBe("Snapshot 2");
    expect(retained.snapshotsTruncated).toBe(true);
  });

  it("persists a weaker-policy warning on an automatic direct rebook recommendation", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 1200,
        baselineType: "cash",
        bookingChannel: "direct",
        cancellationDeadline: new Date("2031-09-08T20:00:00.000Z"),
        checkIn: new Date("2031-09-10T00:00:00.000Z"),
        checkOut: new Date("2031-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Hyatt",
        hotelName: "Park Hyatt Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
      }
    });
    const runner = new BrowserCompanionPriceCheckRunner();
    const started = await runner.run({ bookingId: booking.id, trigger: "manual" });

    await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText: "1 King Bed Member Rate USD 350 Avg/Night Select & Book",
        pageTitle: "Hyatt rooms",
        sourceUrl: "https://www.hyatt.com/shop/rooms/tyoph?checkinDate=2031-09-10&checkoutDate=2031-09-13"
      }
    });
    const summarySnapshot = {
      capturedAt: new Date().toISOString(),
      controls: [],
      pageText:
        "Price Summary Total Cash USD 900.00 Taxes & Fees USD 90.00 1 King Bed Cancellation Policy FULL PREPAYMENT/NO REFUND/NO CHANGES",
      pageTitle: "Hyatt price summary",
      sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2031-09-10&checkoutDate=2031-09-13"
    };
    /* First summary switches modes; the second one imports. */
    await captureBookingPriceTask(started.taskId, { snapshot: summarySnapshot });
    const completed = await captureBookingPriceTask(started.taskId, { snapshot: summarySnapshot });

    /*
     * Award rates were requested and none were visible, so the run reports
     * what it actually obtained rather than a clean success.
     */
    expect(completed?.status).toBe("partial");
    await expect(prisma.priceCheckRun.findUniqueOrThrow({ where: { id: started.runId } })).resolves.toMatchObject({
      summary: expect.stringContaining("No award rate was visible on the pages this run reached.")
    });
    const observation = await prisma.priceObservation.findFirstOrThrow({
      where: { bookingId: booking.id, inventoryType: "cash" },
      include: { evidence: true }
    });
    expect(observation.evidence).toMatchObject({
      blockersJson: "[]",
      cancellationAssessmentSource: "automated",
      cancellationMatch: "worse",
      qualityLevel: "medium"
    });
    expect(JSON.parse(observation.evidence!.warningsJson)).toContain(WEAKER_CANCELLATION_WARNING);

    const recommendation = await prisma.recommendation.findFirstOrThrow({ where: { bookingId: booking.id } });
    expect(recommendation).toMatchObject({
      blockersJson: "[]",
      candidateObservationId: observation.id,
      qualityLevel: "medium",
      riskLevel: "medium",
      verdict: "rebook_direct"
    });
    expect(JSON.parse(recommendation.warningsJson)).toContain(WEAKER_CANCELLATION_WARNING);
  });

  it("persists entitlement-loss and unconfirmed-registration warnings without pricing either one", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 1200,
        baselineType: "cash",
        bookingChannel: "direct",
        breakfastIncluded: true,
        checkIn: new Date("2033-09-10T00:00:00.000Z"),
        checkOut: new Date("2033-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Test Group",
        hotelName: "Test Group Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed"
      }
    });
    await prisma.promotion.create({
      data: {
        appliesToExistingBookings: false,
        flatValue: 500,
        hotelGroup: "Test Group",
        requiresRegistration: true,
        title: "Register Before Your Stay"
      }
    });
    const observation = await prisma.priceObservation.create({
      data: {
        bookingId: booking.id,
        breakfastIncluded: false,
        cashCurrency: "USD",
        cashTotal: 900,
        inventoryType: "cash",
        loyaltyEligible: true,
        roomTypeRaw: "1 King Bed",
        sourceName: "Test Group official site",
        sourceType: "direct",
        evidence: {
          create: {
            blockersJson: "[]",
            cancellationMatch: "same_or_better",
            cancellationMatchReason: "Same test policy.",
            currencyComparable: true,
            feesIncluded: "yes",
            loyaltyEligibility: "eligible",
            qualityLevel: "high",
            roomMatch: "exact",
            roomMatchReason: "Exact test room.",
            sourceVerified: true,
            taxesIncluded: "yes",
            warningsJson: "[]"
          }
        }
      }
    });

    const recommendation = await createRecommendationForBooking(booking.id);
    const warnings = JSON.parse(recommendation!.warningsJson);
    const breakdown = JSON.parse(recommendation!.costBreakdownJson);

    expect(recommendation).toMatchObject({
      candidateObservationId: observation.id,
      decisionVersion: "3",
      estimatedSavings: 300,
      verdict: "rebook_direct"
    });
    expect(warnings).toEqual([
      "The candidate drops breakfast available with the current booking.",
      "Promotion “Register Before Your Stay” requires registration and is excluded until registration can be confirmed."
    ]);
    expect(breakdown.baseline).not.toHaveProperty("benefitValue");
    expect(breakdown.baseline).not.toHaveProperty("eliteProgressValue");
    expect(breakdown.candidate.promotionValue).toBe(0);
  });

  /*
   * The whole point of walking two modes. A free-night award needs no payment
   * summary — points carry no tax — so the award leg finishes on the room list
   * and hands over to cash, and one capture ends up holding both sides.
   */
  it("finishes the award leg once the rate card shows its terms, and compares it with the cash total", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 900,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2035-09-10T00:00:00.000Z"),
        checkOut: new Date("2035-09-12T00:00:00.000Z"),
        city: "Kuala Lumpur",
        currency: "USD",
        guests: 1,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Kuala Lumpur",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
      }
    });
    const started = await new BrowserCompanionPriceCheckRunner().run({ bookingId: booking.id, trigger: "manual" });

    const switched = await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        /* The expanded rate card, which is where Hyatt prints the terms. */
        pageText:
          "SELECT A ROOM 1 King Bed View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night " +
          "Cancellation Policy 11:59PM HOTEL TIME 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE Deposit Policy CREDIT CARD REQUIRED SELECT & BOOK",
        pageTitle: "Hyatt rooms",
        sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2035-09-10&checkoutDate=2035-09-12"
      }
    });
    /* No summary was reached, and none is owed. */
    expect((switched as { action?: { action: string } }).action?.action).toBe("navigate");

    await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        /* Room naming copied from a real Hyatt summary, which prints the room
         * beside the stay dates — the two sides must agree on the room. */
        pageText:
          "Grand Hyatt Kuala Lumpur 1 King Bed Thu, Sep 10, 2035 - Sat, Sep 12, 2035 " +
          "Price Summary Total Cash USD 600.00 Taxes & Fees USD 60.00 Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
        pageTitle: "Hyatt price summary",
        sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2035-09-10&checkoutDate=2035-09-12"
      }
    });

    const saved = await prisma.priceObservation.findMany({ where: { bookingId: booking.id } });
    const award = saved.find((observation) => observation.inventoryType === "award");
    const cash = saved.find((observation) => observation.inventoryType === "cash");

    /* Two nights at 12,000 points a night, with nothing left to discover. */
    expect(award).toMatchObject({ points: 24_000, pointsBasis: "stay_total" });
    expect(cash).toMatchObject({ cashTotal: 600 });
    expect(award?.priceCheckRunId).toBe(cash?.priceCheckRunId);

    const breakdown = JSON.parse(
      (await prisma.recommendation.findFirstOrThrow({
        where: { bookingId: booking.id },
        orderBy: { generatedAt: "desc" }
      })).costBreakdownJson
    );
    expect(breakdown.redemption).toMatchObject({
      cashTotal: 600,
      points: 24_000,
      pointValue: 0.017,
      valuePerPoint: 0.025,
      verdict: "redeem"
    });
  });

  /*
   * The import path used to take every award in the run's evidence directly,
   * so the points side was exempt from the completeness and room rules the
   * cash side has always met — and a filter added to the provider changed
   * nothing about what was stored.
   */
  it("stores only the awards the provider considers comparable, not every one it ever saw", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 900,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2036-09-10T00:00:00.000Z"),
        checkOut: new Date("2036-09-12T00:00:00.000Z"),
        city: "Kuala Lumpur",
        currency: "USD",
        guests: 1,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Kuala Lumpur",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
      }
    });
    const started = await new BrowserCompanionPriceCheckRunner().run({ bookingId: booking.id, trigger: "manual" });

    await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText:
          "SELECT A ROOM 1 King Bed Relax here. View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night " +
          "Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE SELECT & BOOK " +
          "2 Twin Beds Twin beds. View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night " +
          "Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE SELECT & BOOK " +
          "1 King Bed with Club Access Lounge access. View Room Details From World of Hyatt Club Point Free Night Award 17,000 +1 more rates Points/Night " +
          "Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE SELECT & BOOK",
        pageTitle: "Hyatt rooms",
        sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2036-09-10&checkoutDate=2036-09-12"
      }
    });
    await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText:
          "Grand Hyatt Kuala Lumpur 1 King Bed Thu, Sep 10, 2036 - Sat, Sep 12, 2036 " +
          "Price Summary Total Cash USD 600.00 Taxes & Fees USD 60.00 Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
        pageTitle: "Hyatt price summary",
        sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2036-09-10&checkoutDate=2036-09-12"
      }
    });

    const saved = await prisma.priceObservation.findMany({ where: { bookingId: booking.id } });

    /* Three rooms were priced in points; one is the booked room. */
    expect(saved.filter((observation) => observation.inventoryType === "award").map((observation) => observation.roomTypeRaw))
      .toEqual(["1 King Bed"]);
    expect(saved.filter((observation) => observation.inventoryType === "cash")).toHaveLength(1);
  });

  /*
   * A price with no terms is an observation that is blocked on unknown
   * cancellation equivalence — captured, but unusable. The award leg keeps
   * going until the rate card states them.
   */
  it("does not finish the award leg on a price the page has not stated terms for", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 900,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2037-09-10T00:00:00.000Z"),
        checkOut: new Date("2037-09-12T00:00:00.000Z"),
        city: "Kuala Lumpur",
        currency: "USD",
        guests: 1,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Kuala Lumpur",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
      }
    });
    const started = await new BrowserCompanionPriceCheckRunner().run({ bookingId: booking.id, trigger: "manual" });

    const roomListOnly = await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        /* The room list prints the points and nothing about cancelling. */
        pageText:
          "SELECT A ROOM 1 King Bed View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night SELECT & BOOK",
        pageTitle: "Hyatt rooms",
        sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2037-09-10&checkoutDate=2037-09-12"
      }
    });

    expect((roomListOnly as { action?: { action: string } }).action?.action).not.toBe("navigate");
    await expect(prisma.browserTask.findUniqueOrThrow({ where: { id: started.taskId } })).resolves.toMatchObject({
      contextJson: expect.stringContaining('"capturedModes":[]')
    });
  });

  it("keeps a summary the first leg already reached when the second mode fails", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 1200,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2034-09-10T00:00:00.000Z"),
        checkOut: new Date("2034-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Hyatt",
        hotelName: "Andaz Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
      }
    });
    const started = await new BrowserCompanionPriceCheckRunner().run({ bookingId: booking.id, trigger: "manual" });

    const switched = await captureBookingPriceTask(started.taskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText:
          "Price Summary Total Cash USD 810.00 Taxes & Fees USD 60.00 1 King Bed Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
        pageTitle: "Hyatt price summary",
        sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2034-09-10&checkoutDate=2034-09-13"
      }
    });
    expect((switched as { action?: { action: string } }).action?.action).toBe("navigate");
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(0);

    /* The second leg never arrives. The first leg's proven total must survive. */
    await captureBookingPriceTask(started.taskId, {
      errorCode: "task_timeout",
      errorMessage: "Hyatt did not reach a pre-payment price summary before the task timed out."
    });

    const saved = await prisma.priceObservation.findMany({ where: { bookingId: booking.id } });
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ cashTotal: 810, inventoryType: "cash" });
    expect((await prisma.priceCheckRun.findUnique({ where: { id: started.runId } }))?.status).toBe("partial");
  });

  it("prices a certificate baseline from its sourced valuation and lowers confidence when that figure is stale", async () => {
    await prisma.loyaltyValuation.create({
      data: {
        amount: 300,
        asOf: new Date("2020-01-01T00:00:00.000Z"),
        currency: "USD",
        hotelGroup: "Award Group",
        kind: "free_night",
        lastReviewedAt: new Date("2020-01-01T00:00:00.000Z"),
        profileId: "primary",
        realizationRate: 0.8,
        sourceName: "Award trading desk"
      }
    });
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineAwardCount: 1,
        baselineAwardKind: "free_night",
        baselineAwardLabel: "1 Free Night",
        baselineType: "certificate",
        bookingChannel: "direct",
        checkIn: new Date("2033-10-10T00:00:00.000Z"),
        checkOut: new Date("2033-10-11T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Award Group",
        hotelName: "Award Group Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed"
      }
    });
    await prisma.priceObservation.create({
      data: {
        bookingId: booking.id,
        cashCurrency: "USD",
        cashTotal: 200,
        inventoryType: "cash",
        loyaltyEligible: true,
        roomTypeRaw: "1 King Bed",
        sourceName: "Award Group official site",
        sourceType: "direct",
        evidence: {
          create: {
            blockersJson: "[]",
            cancellationMatch: "same_or_better",
            cancellationMatchReason: "Same test policy.",
            currencyComparable: true,
            feesIncluded: "yes",
            loyaltyEligibility: "eligible",
            qualityLevel: "high",
            roomMatch: "exact",
            roomMatchReason: "Exact test room.",
            sourceVerified: true,
            taxesIncluded: "yes",
            warningsJson: "[]"
          }
        }
      }
    });

    const recommendation = await createRecommendationForBooking(booking.id);
    const breakdown = JSON.parse(recommendation!.costBreakdownJson);

    expect(breakdown.baseline.certificateValue).toBe(240);
    expect(breakdown.baseline.effectiveCost).toBe(240);
    expect(recommendation).toMatchObject({ estimatedSavings: 40, qualityLevel: "medium" });
    expect(JSON.parse(recommendation!.warningsJson)).toContain(
      "The Award Group free-night award value (Award trading desk, reviewed Jan 1, 2020) is past its 180-day review date and was used as recorded."
    );
  });

  it("compares cash against points within one capture and refuses to across two", async () => {
    await prisma.loyaltyValuation.create({
      data: {
        amount: 0.017,
        asOf: new Date("2033-01-01T00:00:00.000Z"),
        currency: "USD",
        hotelGroup: "Redemption Group",
        kind: "point",
        lastReviewedAt: new Date("2033-01-01T00:00:00.000Z"),
        profileId: "primary",
        sourceName: "Points guy valuations"
      }
    });
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 700,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2033-11-10T00:00:00.000Z"),
        checkOut: new Date("2033-11-11T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Redemption Group",
        hotelName: "Redemption Group Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed"
      }
    });
    const sharedCapture = await createCapture(booking.id, "capture-shared");
    await createRedemptionObservation(booking.id, sharedCapture, { cashTotal: 500, inventoryType: "cash" });
    await createRedemptionObservation(booking.id, sharedCapture, {
      inventoryType: "award",
      points: 25_000,
      pointsBasis: "stay_total"
    });

    const compared = JSON.parse((await createRecommendationForBooking(booking.id))!.costBreakdownJson);

    expect(compared.redemption).toMatchObject({
      cashTotal: 500,
      points: 25_000,
      pointValue: 0.017,
      valuePerPoint: 0.02,
      verdict: "redeem"
    });

    const separate = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 700,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2033-11-20T00:00:00.000Z"),
        checkOut: new Date("2033-11-21T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Redemption Group",
        hotelName: "Redemption Group Osaka",
        loyaltyEligible: true,
        roomType: "1 King Bed"
      }
    });
    await createRedemptionObservation(separate.id, await createCapture(separate.id, "capture-cash"), {
      cashTotal: 500,
      inventoryType: "cash"
    });
    await createRedemptionObservation(separate.id, await createCapture(separate.id, "capture-award"), {
      inventoryType: "award",
      points: 25_000
    });

    const uncompared = JSON.parse((await createRecommendationForBooking(separate.id))!.costBreakdownJson);

    expect(uncompared.redemption).toBeUndefined();
  });

  it("replays stored snapshots through the LLM extractor without duplicating corroborated facts", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 1200,
        baselineType: "cash",
        bookingChannel: "direct",
        cancellationDeadline: new Date("2032-09-08T00:00:00.000Z"),
        checkIn: new Date("2032-09-10T00:00:00.000Z"),
        checkOut: new Date("2032-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: false, cashEnabled: true, enabled: true } }
      }
    });
    const task = await new BrowserCompanionPriceCheckRunner().run({ bookingId: booking.id, trigger: "manual" });
    const pageText =
      "Account Overview Sign Out Payment summary Member Rate Stay subtotal USD 800.00 Taxes & Fees USD 100.00 Final amount payable USD 900.00 1 King Bed Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE";
    await appendBrowserSnapshot(task.taskId, {
      capturedAt: "2032-08-11T10:00:00.000Z",
      controls: [],
      pageText,
      pageTitle: "Hyatt final payment summary",
      sourceUrl: "https://www.hyatt.com/booking/review?checkinDate=2032-09-10&checkoutDate=2032-09-13"
    });
    await prisma.$transaction([
      prisma.browserTask.update({
        where: { id: task.taskId },
        data: { errorCode: "deterministic_parse_failed", finishedAt: new Date(), status: "failed" }
      }),
      prisma.priceCheckRun.update({
        where: { id: task.runId },
        data: { errorCode: "deterministic_parse_failed", finishedAt: new Date(), status: "failed" }
      })
    ]);
    const candidate = {
      averageNightlyRate: null,
      breakfastIncluded: null,
      cancellationPolicyRaw: "2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
      cashCopay: null,
      cashFees: { amount: 100, currency: "USD" },
      cashTaxes: null,
      cashTotal: { amount: 900, currency: "USD" },
      evidenceText: pageText,
      feesIncluded: true,
      inventoryType: "cash",
      loyaltyEligible: true,
      points: null,
      ratePlanName: "Member Rate",
      rawRateName: "Member Rate",
      roomTypeRaw: "1 King Bed",
      staySubtotal: { amount: 800, currency: "USD" },
      taxesIncluded: true
    } satisfies LlmEvidenceCandidate;
    const extractor = {
      extract: async () => [candidate],
      model: "fixture-model",
      name: "fixture-llm-extractor",
      version: "test-1"
    };

    const first = await runLlmExtractionForPriceCheck(task.runId, { extractor });

    expect(first).toMatchObject({
      acceptedCandidates: 1,
      corroboratedCandidates: 0,
      observationsCreated: 1,
      status: "succeeded"
    });
    await expect(prisma.priceObservation.findFirstOrThrow({
      where: { bookingId: booking.id, extractionSource: "model" },
      include: { evidence: true, extractionRun: true }
    })).resolves.toMatchObject({
      cashTotal: 900,
      extractionRun: { modelName: "fixture-model", status: "succeeded" },
      extractorName: "fixture-llm-extractor",
      extractorVersion: "test-1",
      evidence: { loginState: "member", qualityLevel: "high" }
    });

    const replay = await runLlmExtractionForPriceCheck(task.runId, { extractor });

    expect(replay).toMatchObject({ corroboratedCandidates: 1, observationsCreated: 0 });
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(1);
    expect(await prisma.evidenceExtractionRun.count({ where: { priceCheckRunId: task.runId } })).toBe(2);
  });

  it("persists grounded booleans instead of model assertions during LLM replay", async () => {
    const booking = await prisma.hotelBooking.create({
      data: {
        baselineCashTotal: 1200,
        baselineType: "cash",
        bookingChannel: "direct",
        cancellationDeadline: new Date("2032-09-08T00:00:00.000Z"),
        checkIn: new Date("2032-09-10T00:00:00.000Z"),
        checkOut: new Date("2032-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Tokyo",
        loyaltyEligible: true,
        roomType: "1 King Bed",
        watchPlan: { create: { awardEnabled: false, cashEnabled: true, enabled: true } }
      }
    });
    const task = await new BrowserCompanionPriceCheckRunner().run({ bookingId: booking.id, trigger: "manual" });
    const pageText =
      "Price Summary Total Cash USD 900.00 1 King Bed Cancellation Policy 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE. Taxes and fees are NOT included and will be collected at the hotel. Room only.";
    await appendBrowserSnapshot(task.taskId, {
      capturedAt: "2032-08-11T10:00:00.000Z",
      controls: [],
      pageText,
      pageTitle: "Hyatt payment summary with excluded taxes",
      sourceUrl: "https://www.hyatt.com/booking/review?checkinDate=2032-09-10&checkoutDate=2032-09-13"
    });
    await prisma.$transaction([
      prisma.browserTask.update({
        where: { id: task.taskId },
        data: { errorCode: "deterministic_parse_failed", finishedAt: new Date(), status: "failed" }
      }),
      prisma.priceCheckRun.update({
        where: { id: task.runId },
        data: { errorCode: "deterministic_parse_failed", finishedAt: new Date(), status: "failed" }
      })
    ]);
    const candidate = {
      averageNightlyRate: null,
      breakfastIncluded: true,
      cancellationPolicyRaw: "2 DAYS BFR ARRV OR PAY 1 NIGHT FEE",
      cashCopay: null,
      cashFees: null,
      cashTaxes: null,
      cashTotal: { amount: 900, currency: "USD" },
      evidenceText: pageText,
      feesIncluded: true,
      inventoryType: "cash",
      loyaltyEligible: true,
      points: null,
      ratePlanName: null,
      rawRateName: null,
      roomTypeRaw: "1 King Bed",
      staySubtotal: null,
      taxesIncluded: true
    } satisfies LlmEvidenceCandidate;

    const replay = await runLlmExtractionForPriceCheck(task.runId, {
      extractor: {
        extract: async () => [candidate],
        model: "fixture-model",
        name: "fixture-llm-extractor",
        version: "test-grounding"
      }
    });

    expect(replay).toMatchObject({ acceptedCandidates: 1, observationsCreated: 1, status: "partial" });
    expect(replay.issues.join(" ")).toMatch(/taxesIncluded=true was replaced with false/);
    const observation = await prisma.priceObservation.findFirstOrThrow({
      where: { bookingId: booking.id, extractionSource: "model" },
      include: { evidence: true, extractionRun: true }
    });
    expect(observation).toMatchObject({
      breakfastIncluded: false,
      loyaltyEligible: null,
      evidence: { feesIncluded: "no", qualityLevel: "needs_review", taxesIncluded: "no" },
      extractionRun: { status: "partial" }
    });
    expect(JSON.parse(observation.evidence!.blockersJson)).toEqual(expect.arrayContaining([
      "Final tax inclusion is not verified.",
      "Final fee inclusion is not verified."
    ]));
    const extractionRun = await prisma.evidenceExtractionRun.findUniqueOrThrow({
      where: { id: observation.extractionRunId! }
    });
    expect(JSON.parse(extractionRun.proposedCandidatesJson)[0]).toMatchObject({
      breakfastIncluded: true,
      feesIncluded: true,
      loyaltyEligible: true,
      taxesIncluded: true
    });
    expect(JSON.parse(extractionRun.acceptedCandidatesJson)[0].proposal).toMatchObject({
      breakfastIncluded: false,
      feesIncluded: false,
      loyaltyEligible: null,
      taxesIncluded: false
    });
  });

  it("imports active Hyatt cash, points, and certificate baselines but skips an already-started stay", async () => {
    const task = await createAccountImportTask("Hyatt");
    const captured = await captureBrowserTask(task!.taskId, {
      snapshots: [
        accountSnapshot(
          "Grand Hyatt Tokyo Confirmation Number CASH2030 Room 1 King Bed Check-in Tue, Sep 10, 2030 Check-out Fri, Sep 13, 2030 Total Cost Per Room* USD 900.00",
          "cash"
        ),
        accountSnapshot(
          "Hyatt Regency Kyoto Confirmation Number POINT2030 Room 1 King Bed Check-in Sun, Oct 6, 2030 Check-out Mon, Oct 7, 2030 Points Total 22,500 points",
          "points"
        ),
        accountSnapshot(
          "Park Hyatt Sydney Confirmation Number AWARD2030 Room 1 King Bed Check-in Mon, Nov 4, 2030 Check-out Tue, Nov 5, 2030 Total Awards** 1 Free Night",
          "certificate"
        ),
        accountSnapshot(
          "Grand Hyatt Singapore Confirmation Number PAST2020 Room 1 King Bed Check-in Wed, Jan 1, 2020 Check-out Thu, Jan 2, 2020 Total Cost Per Room* USD 500.00",
          "past"
        )
      ]
    });

    expect(captured?.status).toBe("succeeded");
    expect(captured?.result).toMatchObject({ imported: 3, skipped: 1 });
    const imported = await prisma.hotelBooking.findMany({
      where: { bookingUrl: { contains: "/res/en-US/detail/" } },
      orderBy: { checkIn: "asc" }
    });
    expect(imported.map((booking) => booking.baselineType)).toEqual(["cash", "points", "certificate"]);
    expect(imported[1]).toMatchObject({ baselineCashTotal: null, baselinePoints: 22500 });
    expect(imported[2]).toMatchObject({ baselineAwardLabel: "1 Free Night", baselineCashTotal: null });
  });

  it("rolls back every account booking when a later write fails", async () => {
    const booking = (hotelName: string, checkOut: Date) => ({
      awardLabel: null,
      bookingUrl: `https://www.hyatt.com/res/en-US/detail/${hotelName.toLowerCase().replace(/\s+/g, "-")}`,
      cancellationDeadline: null,
      cashTotal: 900,
      checkIn: new Date("2031-09-10T00:00:00.000Z"),
      checkOut,
      city: "Tokyo",
      confirmationNumber: null,
      currency: "USD",
      guests: 2,
      hotelGroup: "Hyatt",
      hotelName,
      pointsPrice: null,
      priceSource: "cash" as const,
      roomType: "1 King Bed"
    });

    await expect(importAccountBookings({
      bookings: [
        booking("Atomic Hyatt One", new Date("2031-09-12T00:00:00.000Z")),
        booking("Atomic Hyatt Two", new Date("invalid"))
      ],
      loginState: "logged_in",
      loginUrl: "https://www.hyatt.com/login",
      sourceUrl: "https://www.hyatt.com/profile/en-US/my-stays",
      summary: "Atomic import fixture"
    })).rejects.toThrow();

    expect(await prisma.hotelBooking.count({ where: { hotelName: { startsWith: "Atomic Hyatt" } } })).toBe(0);
  });

  it("uses the single profile currency for city search and rejects client currency overrides", async () => {
    const task = await createHotelSearchTask({
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-12",
      city: "Tokyo",
      hotelGroup: "Hyatt"
    });

    expect(task!.launchUrl).toContain("currency=USD");
    expect(task!.launchUrl).toContain("tripbuddyRequestedCurrency=USD");
    expect(task!.searchSessionId).toEqual(expect.any(String));
    await expect(getHotelSearchSession(task!.searchSessionId)).resolves.toMatchObject({
      query: { city: "Tokyo", currency: "USD" },
      results: { hotels: [] }
    });
    await expect(
      createHotelSearchTask({
        adults: 2,
        checkIn: "2030-09-10",
        checkOut: "2030-09-12",
        city: "Tokyo",
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Tokyo",
        mode: "tax_inclusive_total"
      })
    ).rejects.toMatchObject({ code: "search_session_required" });
    await expect(
      createHotelSearchTask({
        adults: 2,
        checkIn: "2030-09-10",
        checkOut: "2030-09-12",
        city: "Tokyo",
        currency: "CNY",
        hotelGroup: "Hyatt"
      })
    ).rejects.toMatchObject({ code: "currency_mismatch" });
  });

  it("persists an observed-currency conversion that removes the dead-end rate lookup", async () => {
    await setCurrencyConversionRate({
      asOf: new Date("2030-08-01T00:00:00.000Z"),
      rate: 0.0067,
      sourceCurrency: "jpy",
      sourceName: "Integration fixture"
    });

    await expect(convertMoneyToSystemCurrency(100_000, "JPY")).resolves.toEqual({
      amount: 670,
      currency: "USD",
      observedCurrency: "JPY",
      rate: 0.0067
    });
    await expect(setCurrencyConversionRate({
      asOf: new Date("2030-08-01T00:00:00.000Z"),
      rate: 0,
      sourceCurrency: "EUR"
    })).rejects.toThrow("Conversion rate must be greater than zero.");
  });

  it("follows a selected city result through Hyatt's safe flow before returning a tax-inclusive total", async () => {
    const observationCount = await prisma.priceObservation.count();
    const cityTask = await createHotelSearchTask({
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-12",
      city: "Tokyo",
      hotelGroup: "Hyatt"
    });
    const cityTaskId = cityTask.taskId;
    if (!cityTaskId) {
      throw new Error("Expected city search to create a browser task.");
    }
    const cityCaptured = await captureBrowserTask(cityTaskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText: "Grand Hyatt Tokyo Rates from: USD 500 Avg/Night View Rates",
        pageTitle: "Hyatt Tokyo search",
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Tokyo?checkinDate=2030-09-10&checkoutDate=2030-09-12"
      }
    });
    expect(cityCaptured).toMatchObject({
      result: { results: [{ avgNightlyRate: 500, hotelName: "Grand Hyatt Tokyo" }] },
      status: "succeeded"
    });
    await expect(getHotelSearchSession(cityTask!.searchSessionId)).resolves.toMatchObject({
      results: {
        hotels: [{
          availabilityLabel: expect.any(String),
          hotelName: "Grand Hyatt Tokyo",
          offers: [{
            displayedPriceBasis: "tax_exclusive",
            evidenceLevel: "starting_price",
            startingAvgNightlyRate: 500,
            staySubtotal: 1000,
            stayTotal: null
          }]
        }]
      }
    });
    const task = await createHotelSearchTask({
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-12",
      city: "Tokyo",
      hotelGroup: "Hyatt",
      hotelName: "Grand Hyatt Tokyo",
      mode: "tax_inclusive_total",
      searchSessionId: cityTask!.searchSessionId
    });
    expect(task).toMatchObject({ hotelSearchMode: "tax_inclusive_total" });
    const totalTaskId = task.taskId;
    if (!totalTaskId) {
      throw new Error("Expected final-total search to create a browser task.");
    }

    const cityResult = await captureBrowserTask(totalTaskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [{
          context: "Grand Hyatt Tokyo Rates from: USD 500 Avg/Night View Rates",
          elementId: "grand-hyatt-rates",
          label: "View Rates"
        }],
        pageText: "Grand Hyatt Tokyo Rates from: USD 500 Avg/Night View Rates",
        pageTitle: "Hyatt Tokyo search",
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Tokyo?checkinDate=2030-09-10&checkoutDate=2030-09-12"
      }
    });
    expect(cityResult).toMatchObject({ action: { action: "click", elementId: "grand-hyatt-rates" }, status: "running" });

    const roomResult = await captureBrowserTask(totalTaskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [{
          context: "Grand Hyatt Tokyo 1 King Bed Member Rate USD 500 Avg/Night Select & Book",
          elementId: "select-room",
          label: "Select & Book"
        }],
        pageText: "Grand Hyatt Tokyo 1 King Bed Member Rate USD 500 Avg/Night Select & Book",
        pageTitle: "Hyatt rooms",
        sourceUrl: "https://www.hyatt.com/shop/rooms/tyogh?checkinDate=2030-09-10&checkoutDate=2030-09-12"
      }
    });
    expect(roomResult).toMatchObject({ action: { action: "click", elementId: "select-room" }, status: "running" });

    const completed = await captureBrowserTask(totalTaskId, {
      snapshot: {
        capturedAt: new Date().toISOString(),
        controls: [],
        pageText: "Price Summary Total Cash USD 1,090.00 Taxes & Fees USD 90.00 1 King Bed Cancellation Policy Free cancellation",
        pageTitle: "Hyatt price summary",
        sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2030-09-10&checkoutDate=2030-09-12"
      }
    });
    expect(completed).toMatchObject({
      result: {
        currency: "USD",
        hotelName: "Grand Hyatt Tokyo",
        nights: 2,
        searchSessionId: cityTask!.searchSessionId,
        subtotal: 1000,
        taxesAndFees: 90,
        total: 1090
      },
      status: "succeeded"
    });
    await expect(getHotelSearchSession(cityTask!.searchSessionId)).resolves.toMatchObject({
      results: {
        hotels: [{
          offers: [{
            evidenceLevel: "final_total",
            feesAmount: 90,
            staySubtotal: 1000,
            stayTotal: 1090,
            taxesAndFeesAmount: 90
          }]
        }]
      }
    });
    expect(await prisma.priceObservation.count()).toBe(observationCount);
  });
});

/** One page visit: the unit a cash rate and an award rate must share to be compared. */
async function createCapture(bookingId: string, id: string) {
  const expiresAt = new Date("2033-12-01T00:00:00.000Z");
  await prisma.browserTask.create({
    data: {
      contextJson: "{}",
      expiresAt,
      hotelGroup: "Redemption Group",
      id: `task-${id}`,
      kind: "booking_price_check",
      launchUrl: "https://example.test/rates"
    }
  });
  await prisma.priceCheckRun.create({
    data: {
      bookingId,
      browserTaskId: `task-${id}`,
      expiresAt,
      id,
      inventoryTypesJson: '["cash","award"]',
      providerName: "test-provider",
      trigger: "manual"
    }
  });
  return id;
}

async function createRedemptionObservation(
  bookingId: string,
  priceCheckRunId: string,
  overrides: {
    cashTotal?: number;
    inventoryType: "cash" | "award";
    points?: number;
    pointsBasis?: "stay_total" | "per_night" | "unknown";
  }
) {
  return prisma.priceObservation.create({
    data: {
      bookingId,
      cashCurrency: "USD",
      cashTotal: overrides.cashTotal ?? null,
      inventoryType: overrides.inventoryType,
      loyaltyEligible: true,
      points: overrides.points ?? null,
      pointsBasis: overrides.pointsBasis ?? "unknown",
      priceCheckRunId,
      roomTypeRaw: "1 King Bed",
      sourceName: "Redemption Group official site",
      sourceType: "direct",
      evidence: {
        create: {
          blockersJson: "[]",
          cancellationMatch: "same_or_better",
          cancellationMatchReason: "Same test policy.",
          currencyComparable: true,
          feesIncluded: "yes",
          loyaltyEligibility: "eligible",
          qualityLevel: "high",
          roomMatch: "exact",
          roomMatchReason: "Exact test room.",
          sourceVerified: true,
          taxesIncluded: "yes",
          warningsJson: "[]"
        }
      }
    }
  });
}

function accountSnapshot(pageText: string, suffix: string) {
  return {
    links: [],
    pageText,
    pageTitle: "Hyatt reservation details",
    sourceUrl: `https://www.hyatt.com/res/en-US/detail/${suffix}`
  };
}
