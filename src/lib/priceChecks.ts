import { randomUUID } from "node:crypto";
import type { PriceCheckTrigger } from "@prisma/client";
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
import { parseJson, toJson } from "@/lib/json";
import { getBookingPriceProvider } from "@/lib/providers/registry";
import type { BookingPriceInput, ParsedObservationDraft } from "@/lib/providers/types";
import { createRecommendationForBooking } from "@/lib/recommendations";
import { getCurrencyConversion } from "@/lib/systemSettings";

export type BrowserTaskLaunch = {
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
          contextJson: toJson(serializeBookingContext(context)),
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
      })
    ]);

    return { launchUrl, runId, status: "pending", taskId };
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
    const context = parseBookingContext(task.contextJson);
    const inventory = parseJson<ParsedObservationDraft[]>(task.priceCheckRun.inventoryEvidenceJson, []);
    const awards = inventory.filter((candidate) => candidate.inventoryType === "award" && candidate.points);
    if (context && awards.length > 0) {
      const observationIds = await completePriceCheckTask({
        context,
        inventory,
        observations: awards,
        pageText: "",
        pageTitle: "",
        parsed: {
          errorCode: capture.errorCode ?? "browser_capture_partial",
          errorMessage: capture.errorMessage,
          inventory,
          observations: awards,
          sourceUrl: awards[0].sourceUrl,
          status: "partial",
          summary: "Explicit award evidence was saved, but the browser task did not reach a final cash summary."
        },
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
  const context = parseBookingContext(task.contextJson);
  const provider = getBookingPriceProvider(task.hotelGroup);
  if (!context || !provider) {
    await failPriceCheckTask(taskId, "provider_unavailable", `No booking-price provider is available for ${task.hotelGroup}.`);
    return serializeTaskState(await getBrowserTask(taskId));
  }

  await appendBrowserSnapshot(taskId, snapshot);
  const parsed = provider.parseSnapshot(snapshot, context);
  const existingInventory = parseJson<ParsedObservationDraft[]>(task.priceCheckRun.inventoryEvidenceJson, []);
  const inventory = mergeCandidates(existingInventory, parsed.inventory.map((candidate) => ({ ...candidate, sourceUrl: snapshot.sourceUrl })));
  await prisma.priceCheckRun.update({
    where: { id: task.priceCheckRun.id },
    data: { inventoryEvidenceJson: toJson(inventory), sourceUrl: snapshot.sourceUrl }
  });

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

  const observations = mergeCandidates(
    inventory.filter((candidate) => candidate.inventoryType === "award"),
    parsed.observations.map((candidate) => ({ ...candidate, sourceUrl: snapshot.sourceUrl }))
  );
  const observationIds = await completePriceCheckTask({
    context,
    inventory,
    observations,
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

async function completePriceCheckTask(input: {
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
  const status = prepared.length > 0 ? input.parsed.status : "partial";
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
              promotionApplicability: evidence.promotionApplicability,
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
          id: observationIds[index],
          inventoryType: candidate.inventoryType,
          isSuite: candidate.roomTypeRaw ? inferIsSuite(candidate.roomTypeRaw) : null,
          loyaltyEligible: candidate.loyaltyEligible,
          points: candidate.points,
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
        errorCode: input.parsed.errorCode,
        errorMessage: input.parsed.errorMessage,
        finishedAt,
        inventoryEvidenceJson: toJson(input.inventory),
        sourceUrl: input.parsed.sourceUrl,
        status,
        summary: input.parsed.summary
      }
    });
    await tx.browserTask.update({
      where: { id: input.taskId },
      data: {
        errorCode: input.parsed.errorCode,
        errorMessage: input.parsed.errorMessage,
        finishedAt,
        resultJson: toJson({ observationsCreated: observationIds.length, runId: task.priceCheckRun!.id }),
        status
      }
    });
    await tx.watchPlan.update({ where: { id: task.priceCheckRun!.watchPlanId! }, data: { lastCheckedAt: finishedAt } });
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
    })
  ]);
}

function mergeCandidates(current: ParsedObservationDraft[], incoming: ParsedObservationDraft[]) {
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
  return [...result.values()].slice(0, 24);
}

function serializeBookingContext(input: BookingPriceInput) {
  return {
    ...input,
    cancellationDeadline: input.cancellationDeadline?.toISOString() ?? null,
    checkIn: input.checkIn.toISOString(),
    checkOut: input.checkOut.toISOString()
  };
}

function parseBookingContext(value: string): BookingPriceInput | null {
  const context = parseJson<Record<string, unknown> | null>(value, null);
  if (!context || typeof context.bookingId !== "string" || typeof context.hotelGroup !== "string") {
    return null;
  }
  const checkIn = new Date(String(context.checkIn ?? ""));
  const checkOut = new Date(String(context.checkOut ?? ""));
  const cancellationDeadline = context.cancellationDeadline ? new Date(String(context.cancellationDeadline)) : null;
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return null;
  }
  if (cancellationDeadline && Number.isNaN(cancellationDeadline.getTime())) {
    return null;
  }
  return {
    bookingId: context.bookingId,
    bookingUrl: typeof context.bookingUrl === "string" ? context.bookingUrl : null,
    cancellationDeadline,
    checkIn,
    checkOut,
    city: String(context.city ?? ""),
    currency: String(context.currency ?? "USD"),
    guests: Number(context.guests ?? 1),
    hotelGroup: context.hotelGroup,
    hotelName: String(context.hotelName ?? ""),
    inventoryTypes: Array.isArray(context.inventoryTypes)
      ? context.inventoryTypes.filter((item): item is "cash" | "award" => item === "cash" || item === "award")
      : ["cash", "award"],
    roomType: String(context.roomType ?? "")
  };
}
