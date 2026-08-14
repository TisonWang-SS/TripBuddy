import { randomUUID } from "node:crypto";
import type { PriceCheckTrigger } from "@prisma/client";
import {
  parseBookingPriceContext,
  parseObservationDrafts,
  serializeBookingPriceContext,
  serializeBrowserTaskContext,
  serializeBrowserTaskResult
} from "@/lib/browserTaskCodecs";
import {
  addBrowserTaskHash,
  appendBrowserSnapshot,
  BROWSER_TASK_TTL_MS,
  BrowserTaskError,
  getBrowserTask,
  normalizeBrowserSnapshot,
  serializeTaskState,
  type BrowserTaskCapture
} from "@/lib/browserTasks";
import { inferIsSuite } from "@/lib/currency";
import { prisma } from "@/lib/db";
import { buildObservationEvidence } from "@/lib/evidence";
import { toJson } from "@/lib/json";
import { getBookingPriceProvider } from "@/lib/providers/registry";
import type { BookingPriceInput, ParsedObservationDraft } from "@/lib/providers/types";
import { createRecommendationForBooking } from "@/lib/recommendations";
import { getCurrencyConversion } from "@/lib/systemSettings";

export type BrowserTaskLaunch = {
  expiresAt: string;
  launchUrl: string;
  runId: string;
  status: "pending" | "running";
  taskId: string;
};

export interface PriceCheckRunner {
  run(input: { bookingId: string; trigger: PriceCheckTrigger }): Promise<BrowserTaskLaunch>;
}

export class BrowserCompanionPriceCheckRunner implements PriceCheckRunner {
  async run({ bookingId, trigger }: { bookingId: string; trigger: PriceCheckTrigger }): Promise<BrowserTaskLaunch> {
    const booking = await prisma.hotelBooking.findUnique({ where: { id: bookingId }, include: { watchPlan: true } });
    if (!booking) {
      throw new Error("Booking was not found.");
    }
    const provider = getBookingPriceProvider(booking.hotelGroup);
    if (!provider) {
      throw new Error(`No booking-price provider is available for ${booking.hotelGroup}.`);
    }

    const staleRuns = await prisma.priceCheckRun.findMany({
      where: { bookingId, status: "running", expiresAt: { lte: new Date() } },
      select: { browserTaskId: true }
    });
    for (const stale of staleRuns) {
      await getBrowserTask(stale.browserTaskId);
    }

    const active = await prisma.priceCheckRun.findFirst({
      where: { bookingId, status: "running", expiresAt: { gt: new Date() } },
      include: { browserTask: true },
      orderBy: { startedAt: "desc" }
    });
    if (active) {
      return {
        expiresAt: active.browserTask.expiresAt.toISOString(),
        launchUrl: active.browserTask.launchUrl,
        runId: active.id,
        status: active.browserTask.status === "pending" ? "pending" : "running",
        taskId: active.browserTaskId
      };
    }

    const watchPlan =
      booking.watchPlan ??
      (await prisma.watchPlan.create({ data: { awardEnabled: true, bookingId, cashEnabled: true, enabled: true } }));
    const inventoryTypes: Array<"cash" | "award"> = [
      ...(watchPlan.cashEnabled ? (["cash"] as const) : []),
      ...(watchPlan.awardEnabled ? (["award"] as const) : [])
    ];
    if (!watchPlan.enabled || inventoryTypes.length === 0) {
      throw new Error("The booking watch plan has no enabled inventory types.");
    }
    const context: BookingPriceInput = {
      bookingId,
      bookingUrl: booking.bookingUrl,
      cancellationDeadline: booking.cancellationDeadline,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      city: booking.city,
      currency: booking.currency,
      guests: booking.guests,
      hotelGroup: booking.hotelGroup,
      hotelName: booking.hotelName,
      inventoryTypes,
      roomType: booking.roomType
    };
    const taskId = randomUUID();
    const runId = randomUUID();
    const expiresAt = new Date(Date.now() + BROWSER_TASK_TTL_MS);
    const launchUrl = addBrowserTaskHash(provider.buildLaunchUrl(context), taskId);

    await prisma.$transaction([
      prisma.browserTask.create({
        data: {
          contextJson: serializeBrowserTaskContext("booking_price_check", serializeBookingPriceContext(context)),
          expiresAt,
          hotelGroup: booking.hotelGroup,
          id: taskId,
          kind: "booking_price_check",
          launchUrl
        }
      }),
      prisma.priceCheckRun.create({
        data: {
          bookingId,
          browserTaskId: taskId,
          expiresAt,
          id: runId,
          inventoryTypesJson: toJson(inventoryTypes),
          providerName: provider.name,
          trigger,
          watchPlanId: watchPlan.id
        }
      }),
      prisma.watchPlan.update({
        where: { id: watchPlan.id },
        data: { lastAttemptedAt: new Date() }
      })
    ]);

    return { expiresAt: expiresAt.toISOString(), launchUrl, runId, status: "pending", taskId };
  }
}

export async function captureBookingPriceTask(taskId: string, capture: BrowserTaskCapture) {
  const task = await getBrowserTask(taskId);
  if (!task || task.kind !== "booking_price_check" || !task.priceCheckRun) {
    throw new BrowserTaskError("task_not_found", "Booking price-check task was not found or expired.", 404);
  }
  if (task.status !== "pending" && task.status !== "running") {
    return serializeTaskState(task);
  }
  if (capture.errorMessage) {
    const context = parseBookingPriceContext(task.contextJson);
    const inventory = parseObservationDrafts(task.priceCheckRun.inventoryEvidenceJson);
    /*
     * Whatever the run already proved, kept.
     *
     * This matters more since a run can walk two modes: the first leg's total
     * is only in inventory until the last leg imports, so a second leg that
     * dies would otherwise discard a summary this run had already reached.
     * The bar is the same one storage always applies — an award needs its
     * points, a cash total needs its taxes and fees shown as included.
     */
    const provider = getBookingPriceProvider(task.hotelGroup);
    const awards = [
      ...(context && provider ? provider.selectComparableAwards(inventory, context) : []),
      ...inventory.filter(
        (candidate) =>
          candidate.inventoryType === "cash" &&
          candidate.cashTotal !== null &&
          candidate.taxesIncluded === true &&
          candidate.feesIncluded === true
      )
    ];
    if (context && awards.length > 0) {
      const observationIds = await completePriceCheckTask({
        context,
        inventory,
        observations: awards,
        pageText: "",
        pageTitle: "",
        parsed: {
          candidatesTruncated: task.priceCheckRun.candidatesTruncated,
          errorCode: capture.errorCode ?? "browser_capture_partial",
          errorMessage: capture.errorMessage,
          inventory,
          loginState: "unknown",
          observations: awards,
          sourceUrl: awards[0].sourceUrl,
          status: "partial",
          summary: "The rate evidence this run had already proved was saved, but the browser task did not finish every requested mode."
        },
        candidatesTruncated: task.priceCheckRun.candidatesTruncated,
        taskId
      });
      if (observationIds.length > 0) {
        await createRecommendationForBooking(context.bookingId);
      }
      return serializeTaskState(await getBrowserTask(taskId));
    }
    await failPriceCheckTask(taskId, capture.errorCode ?? "browser_capture_failed", capture.errorMessage);
    return serializeTaskState(await getBrowserTask(taskId));
  }

  const snapshot = normalizeBrowserSnapshot(capture.snapshot);
  if (!snapshot) {
    throw new BrowserTaskError("invalid_snapshot", "A source URL and visible page snapshot are required.", 400);
  }
  const context = parseBookingPriceContext(task.contextJson);
  const provider = getBookingPriceProvider(task.hotelGroup);
  if (!context || !provider) {
    await failPriceCheckTask(taskId, "provider_unavailable", `No booking-price provider is available for ${task.hotelGroup}.`);
    return serializeTaskState(await getBrowserTask(taskId));
  }

  await appendBrowserSnapshot(taskId, snapshot);
  const parsed = provider.parseSnapshot(snapshot, context);
  const existingInventory = parseObservationDrafts(task.priceCheckRun.inventoryEvidenceJson);
  const inventoryMerge = mergeObservationCandidates(
    existingInventory,
    parsed.inventory.map((candidate) => ({ ...candidate, sourceUrl: snapshot.sourceUrl }))
  );
  const candidatesTruncated =
    task.priceCheckRun.candidatesTruncated || parsed.candidatesTruncated || inventoryMerge.truncated;
  await prisma.priceCheckRun.update({
    where: { id: task.priceCheckRun.id },
    data: {
      candidatesTruncated,
      inventoryEvidenceJson: toJson(inventoryMerge.candidates),
      sourceUrl: snapshot.sourceUrl
    }
  });

  /*
   * Switch here rather than after an import: the award leg never reaches a
   * payment summary, so waiting for one would sit on the room list holding
   * the answer until the task timed out.
   */
  if (
    awardLegIsSatisfied(
      context,
      inventoryMerge.candidates,
      provider.selectComparableAwards(inventoryMerge.candidates, context)
    )
  ) {
    const modeSwitch = planInventoryModeSwitch(context);
    if (modeSwitch) {
      await prisma.browserTask.update({
        where: { id: taskId },
        data: {
          contextJson: serializeBrowserTaskContext(
            "booking_price_check",
            serializeBookingPriceContext({ ...context, capturedModes: modeSwitch.capturedModes })
          )
        }
      });
      return {
        ...serializeTaskState(await getBrowserTask(taskId)),
        action: {
          action: "navigate" as const,
          reason: modeSwitch.reason,
          url: addBrowserTaskHash(provider.buildLaunchUrl({ ...context, inventoryTypes: [modeSwitch.nextMode] }), taskId)
        }
      };
    }
  }

  if (parsed.status === "failed") {
    await failPriceCheckTask(taskId, parsed.errorCode ?? "provider_failed", parsed.errorMessage ?? parsed.summary);
    return serializeTaskState(await getBrowserTask(taskId));
  }

  const action = provider.planAction(snapshot, context);
  if (action.action === "stop") {
    await failPriceCheckTask(taskId, "navigation_stopped", action.reason);
    return serializeTaskState(await getBrowserTask(taskId));
  }
  if (action.action !== "import") {
    return { ...serializeTaskState(await getBrowserTask(taskId)), action };
  }

  /*
   * One capture, both modes.
   *
   * Hyatt renders cash or points and never both, and which one is fixed in the
   * URL the task launched with. Comparing them therefore takes two walks, and
   * they have to belong to one run: a cash total from this visit against an
   * award rate from another is two inventories wearing one conclusion.
   *
   * The decision lives here rather than in the planner because only this
   * function can see what the run has already collected. It fires at most
   * once — the second leg finds a mode already recorded and imports.
   */
  const modeSwitch = planInventoryModeSwitch(context);
  if (modeSwitch) {
    await prisma.browserTask.update({
      where: { id: taskId },
      data: {
        contextJson: serializeBrowserTaskContext(
          "booking_price_check",
          serializeBookingPriceContext({ ...context, capturedModes: modeSwitch.capturedModes })
        )
      }
    });
    return {
      ...serializeTaskState(await getBrowserTask(taskId)),
      action: {
        action: "navigate" as const,
        reason: modeSwitch.reason,
        url: addBrowserTaskHash(provider.buildLaunchUrl({ ...context, inventoryTypes: [modeSwitch.nextMode] }), taskId)
      }
    };
  }

  /*
   * Both inventory types reach storage through the provider's own rule.
   *
   * This used to hand every award in the run's evidence straight to storage
   * while cash had to pass parseSnapshot, so the points side was exempt from
   * the completeness and room-comparability rules cash has always met — and
   * any filter added to the provider had no effect on what was written.
   */
  const observationMerge = mergeObservationCandidates(
    provider.selectComparableAwards(inventoryMerge.candidates, context),
    parsed.observations.map((candidate) => ({ ...candidate, sourceUrl: snapshot.sourceUrl }))
  );
  const observationIds = await completePriceCheckTask({
    candidatesTruncated: candidatesTruncated || observationMerge.truncated,
    context,
    inventory: inventoryMerge.candidates,
    observations: observationMerge.candidates,
    pageText: snapshot.pageText,
    pageTitle: snapshot.pageTitle,
    parsed,
    taskId
  });
  if (observationIds.length > 0) {
    await createRecommendationForBooking(context.bookingId);
  }
  return serializeTaskState(await getBrowserTask(taskId));
}

/*
 * Which mode this leg was, and whether another one is owed.
 *
 * The launch mode is derivable rather than stored: `buildLaunchUrl` asks for
 * points whenever award inventory is requested, so the first leg is award when
 * award was requested at all. Once a mode is recorded the run is done
 * switching, which is what bounds this to a single extra walk.
 */
export function planInventoryModeSwitch(context: BookingPriceInput) {
  if ((context.capturedModes ?? []).length > 0) {
    return null;
  }
  const requested = new Set(context.inventoryTypes);
  if (!requested.has("cash") || !requested.has("award")) {
    return null;
  }
  const currentMode = "award" as const;
  const nextMode = "cash" as const;
  return {
    capturedModes: [currentMode],
    nextMode,
    reason: "Re-open the same room in cash rates so this capture holds both a points price and a cash total."
  };
}

/*
 * The award leg is done as soon as a free-night award is priced for the stay.
 *
 * Unlike a cash rate there is nothing further to discover: points-only awards
 * carry no tax, so the room list already holds the whole price. Walking on
 * would mean pressing a rate control that Hyatt greys out until a member
 * signs in — and signing in is something this product does not do.
 */
export function awardLegIsSatisfied(
  context: BookingPriceInput,
  inventory: readonly ParsedObservationDraft[],
  comparableAwards: readonly ParsedObservationDraft[]
) {
  return (
    context.inventoryTypes.includes("award") &&
    !(context.capturedModes ?? []).includes("award") &&
    comparableAwards.some(
      (candidate) =>
        candidate.points !== null && candidate.pointsBasis === "stay_total" && hasCapturedPolicy(candidate)
    )
  );
}

/*
 * The price alone does not finish the award leg.
 *
 * Hyatt's room list prints the points but not the cancellation terms, and an
 * observation with no policy is blocked on unknown equivalence — so a run that
 * stopped at the price produced an award that could never be acted on. The
 * terms appear once the rate card is expanded, which is a step short of the
 * control Hyatt greys out for anonymous redemption.
 */
function hasCapturedPolicy(candidate: ParsedObservationDraft) {
  const policy = (candidate.cancellationPolicyRaw ?? "").trim();
  return policy.length > 0 && !/^policy not captured$/i.test(policy);
}

async function completePriceCheckTask(input: {
  candidatesTruncated: boolean;
  context: BookingPriceInput;
  inventory: ParsedObservationDraft[];
  observations: ParsedObservationDraft[];
  pageText: string;
  pageTitle: string;
  parsed: ReturnType<NonNullable<ReturnType<typeof getBookingPriceProvider>>["parseSnapshot"]>;
  taskId: string;
}) {
  const task = await prisma.browserTask.findUnique({ where: { id: input.taskId }, include: { priceCheckRun: true } });
  if (!task?.priceCheckRun) {
    return [];
  }
  const prepared = await Promise.all(
    input.observations.map(async (candidate) => {
      const conversionAvailable =
        candidate.inventoryType === "award" ||
        !candidate.cashCurrency ||
        (await getCurrencyConversion(candidate.cashCurrency, input.context.currency as "USD" | "CNY")) !== null;
      const evidence = buildObservationEvidence({
        bookingCancellationDeadline: input.context.cancellationDeadline,
        bookingCheckIn: input.context.checkIn,
        bookingCurrency: input.context.currency,
        bookingRoomType: input.context.roomType,
        cancellationPolicyRaw: candidate.cancellationPolicyRaw,
        cashCurrency: candidate.cashCurrency,
        collectionMethod: "browser_companion",
        conversionAvailable,
        feesIncluded: candidate.feesIncluded,
        hasCashComponent: candidate.cashCopay !== null,
        inventoryType: candidate.inventoryType,
        loginState: input.parsed.loginState,
        loyaltyEligible: candidate.loyaltyEligible,
        pageText: input.pageText,
        pageTitle: input.pageTitle,
        roomTypeRaw: candidate.roomTypeRaw,
        sourceType: "direct",
        sourceUrl: candidate.sourceUrl,
        taxesIncluded: candidate.taxesIncluded
      });
      return { candidate, evidence };
    })
  );
  /*
   * A requested inventory type that produced nothing is reported, not dropped.
   *
   * A run that asked Hyatt for award rates and came back with only cash used
   * to finish as a clean success, which is the product claiming to have
   * checked something it never saw. Naming it is what makes a broken points
   * path visible instead of looking like a hotel with no award availability.
   */
  const missingInventory = input.context.inventoryTypes.filter(
    (type) => !prepared.some(({ candidate }) => candidate.inventoryType === type)
  );
  const status = prepared.length > 0 ? (missingInventory.length > 0 ? "partial" : input.parsed.status) : "partial";
  const summary =
    missingInventory.length > 0 && prepared.length > 0
      ? `${input.parsed.summary} No ${missingInventory.join(" or ")} rate was visible on the pages this run reached.`
      : input.parsed.summary;
  const finishedAt = new Date();
  const observationIds = prepared.map(() => randomUUID());

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < prepared.length; index += 1) {
      const { candidate, evidence } = prepared[index];
      await tx.priceObservation.create({
        data: {
          breakfastIncluded: candidate.breakfastIncluded,
          cancellationPolicyRaw: candidate.cancellationPolicyRaw,
          cashBase: candidate.cashBase,
          cashCopay: candidate.cashCopay,
          cashCopayCurrency: candidate.cashCurrency,
          cashCurrency: candidate.cashCurrency,
          cashFees: candidate.cashFees,
          cashTaxes: candidate.cashTaxes,
          cashTotal: candidate.cashTotal,
          collectionMethod: "browser_companion",
          booking: { connect: { id: input.context.bookingId } },
          evidence: {
            create: {
              blockersJson: toJson(evidence.blockers),
              cancellationAssessmentSource: evidence.cancellationAssessmentSource,
              cancellationMatch: evidence.cancellationMatch,
              cancellationMatchReason: evidence.cancellationMatchReason,
              currencyComparable: evidence.currencyComparable,
              feesIncluded: evidence.feesIncluded,
              loginState: evidence.loginState,
              loyaltyEligibility: evidence.loyaltyEligibility,
              qualityLevel: evidence.qualityLevel,
              roomAssessmentSource: evidence.roomAssessmentSource,
              roomMatch: evidence.roomMatch,
              roomMatchReason: evidence.roomMatchReason,
              snapshotJson: evidence.snapshotJson,
              sourceVerified: evidence.sourceVerified,
              taxesIncluded: evidence.taxesIncluded,
              warningsJson: toJson(evidence.warnings)
            }
          },
          extractionSource: "deterministic",
          extractorName: task.priceCheckRun!.providerName,
          extractorVersion: "1",
          id: observationIds[index],
          inventoryType: candidate.inventoryType,
          isSuite: candidate.roomTypeRaw ? inferIsSuite(candidate.roomTypeRaw) : null,
          loyaltyEligible: candidate.loyaltyEligible,
          points: candidate.points,
          pointsBasis: candidate.pointsBasis,
          priceCheckRun: { connect: { id: task.priceCheckRun!.id } },
          providerName: task.priceCheckRun!.providerName,
          ratePlanName: candidate.ratePlanName,
          rawRateName: candidate.rawRateName,
          roomTypeRaw: candidate.roomTypeRaw,
          sourceName: "Hyatt official site",
          sourceType: "direct",
          sourceUrl: candidate.sourceUrl
        }
      });
    }
    await tx.priceCheckRun.update({
      where: { id: task.priceCheckRun!.id },
      data: {
        candidatesTruncated: input.candidatesTruncated,
        errorCode: input.parsed.errorCode,
        errorMessage: input.parsed.errorMessage,
        finishedAt,
        inventoryEvidenceJson: toJson(input.inventory),
        sourceUrl: input.parsed.sourceUrl,
        status,
        summary
      }
    });
    await tx.browserTask.update({
      where: { id: input.taskId },
      data: {
        errorCode: input.parsed.errorCode,
        errorMessage: input.parsed.errorMessage,
        finishedAt,
        resultJson: serializeBrowserTaskResult("booking_price_check", {
          observationsCreated: observationIds.length,
          runId: task.priceCheckRun!.id
        }),
        status
      }
    });
    await tx.watchPlan.update({
      where: { id: task.priceCheckRun!.watchPlanId! },
      data: { consecutiveFailures: 0, lastAttemptedAt: finishedAt, lastCheckedAt: finishedAt }
    });
  });
  return observationIds;
}

async function failPriceCheckTask(taskId: string, errorCode: string, errorMessage: string) {
  const now = new Date();
  await prisma.$transaction([
    prisma.browserTask.update({
      where: { id: taskId },
      data: { errorCode, errorMessage, finishedAt: now, status: "failed" }
    }),
    prisma.priceCheckRun.update({
      where: { browserTaskId: taskId },
      data: { errorCode, errorMessage, finishedAt: now, status: "failed", summary: "Browser price check failed." }
    }),
    prisma.watchPlan.updateMany({
      where: { priceCheckRuns: { some: { browserTaskId: taskId } } },
      data: { consecutiveFailures: { increment: 1 }, lastAttemptedAt: now }
    })
  ]);
}

export function mergeObservationCandidates(current: ParsedObservationDraft[], incoming: ParsedObservationDraft[]) {
  const result = new Map<string, ParsedObservationDraft>();
  for (const candidate of [...current, ...incoming]) {
    const key = [
      candidate.inventoryType,
      candidate.cashCurrency,
      candidate.cashTotal,
      candidate.cashBase,
      candidate.points,
      candidate.roomTypeRaw,
      candidate.ratePlanName
    ].join("|");
    result.set(key, candidate);
  }
  const candidates = [...result.values()];
  return { candidates: candidates.slice(0, 24), truncated: candidates.length > 24 };
}
