import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
    ({ getBrowserTask } = await import("@/lib/browserTasks"));
    ({ captureBrowserTask, createAccountImportTask, createHotelSearchTask } = await import("@/lib/browserTaskHandlers"));
    ({ getHotelSearchSession } = await import("@/lib/hotelSearchSessions"));
    ({ importAccountBookings } = await import("@/lib/accountBookings"));

    await prisma.systemSetting.create({ data: { id: "primary", displayCurrency: "USD" } });
    await prisma.userProfile.create({
      data: {
        defaultCurrency: "USD",
        id: "primary",
        loyaltyAccounts: {
          create: { hotelGroup: "Hyatt", pointValue: 0.017, tier: "Member" }
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

    expect(duplicateStart).toMatchObject({ runId: first.runId, taskId: first.taskId });
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
    expect(completed?.status).toBe("succeeded");
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(2);
    expect(await prisma.observationEvidence.count()).toBe(2);
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
    expect(await prisma.priceObservation.count({ where: { bookingId: booking.id } })).toBe(2);
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

function accountSnapshot(pageText: string, suffix: string) {
  return {
    links: [],
    pageText,
    pageTitle: "Hyatt reservation details",
    sourceUrl: `https://www.hyatt.com/res/en-US/detail/${suffix}`
  };
}
