import { randomUUID } from "node:crypto";
import type { EvidenceExtractionStatus } from "@prisma/client";
import {
  parseBookingPriceContext,
  parseObservationDrafts,
  parseSanitizedBrowserSnapshots
} from "@/lib/browserTaskCodecs";
import { inferIsSuite } from "@/lib/currency";
import { prisma } from "@/lib/db";
import { buildObservationEvidence } from "@/lib/evidence";
import { toJson } from "@/lib/json";
import {
  createConfiguredLlmEvidenceExtractor,
  type LlmEvidenceCandidate,
  LlmEvidenceError,
  validateLlmEvidenceCandidates
} from "@/lib/providers/llmEvidence";
import { getBookingPriceProvider } from "@/lib/providers/registry";
import type { BookingPriceInput, ParsedObservationDraft, SanitizedBrowserSnapshot } from "@/lib/providers/types";
import { createRecommendationForBooking } from "@/lib/recommendations";
import { getCurrencyConversion } from "@/lib/systemSettings";

type EvidenceExtractor = {
  extract(input: { hotelGroup: string; nights: number; pageText: string; sourceUrl: string }): Promise<LlmEvidenceCandidate[]>;
  model: string;
  name: string;
  version: string;
};

type AcceptedCandidate = {
  draft: ParsedObservationDraft;
  pageText: string;
  pageTitle: string;
  proposal: LlmEvidenceCandidate;
};

export async function runLlmExtractionForPriceCheck(
  priceCheckRunId: string,
  dependencies: { extractor?: EvidenceExtractor } = {}
) {
  const extractor = dependencies.extractor ?? createConfiguredLlmEvidenceExtractor();
  const run = await prisma.priceCheckRun.findUnique({
    where: { id: priceCheckRunId },
    include: {
      browserTask: true,
      observations: true
    }
  });
  if (!run) {
    throw new LlmEvidenceError("price_check_not_found", "The price-check run was not found.");
  }
  if (run.status === "running") {
    throw new LlmEvidenceError(
      "price_check_in_progress",
      "Wait for browser capture to finish before replaying its stored snapshots."
    );
  }
  const context = parseBookingPriceContext(run.browserTask.contextJson);
  if (!context) {
    throw new LlmEvidenceError("invalid_task_context", "The stored price-check context is invalid.");
  }
  const snapshots = selectReplaySnapshots(parseSanitizedBrowserSnapshots(run.browserTask.snapshotsJson));
  if (snapshots.length === 0) {
    throw new LlmEvidenceError("snapshots_unavailable", "This price check has no readable stored browser snapshots.");
  }

  const extractionRun = await prisma.evidenceExtractionRun.create({
    data: {
      extractorName: extractor.name,
      extractorVersion: extractor.version,
      modelName: extractor.model,
      priceCheckRunId,
      snapshotCount: snapshots.length,
      status: "failed"
    }
  });
  const nights = stayNights(context);
  const settled = await Promise.allSettled(
    snapshots.map(async (snapshot) => ({
      candidates: await extractor.extract({
        hotelGroup: context.hotelGroup,
        nights,
        pageText: snapshot.textSample,
        sourceUrl: snapshot.sourceUrl
      }),
      snapshot
    }))
  );
  const proposed: Array<LlmEvidenceCandidate & { snapshotCapturedAt: string; sourceUrl: string }> = [];
  const accepted: AcceptedCandidate[] = [];
  const issues: string[] = [];
  let failedRequests = 0;

  for (const result of settled) {
    if (result.status === "rejected") {
      failedRequests += 1;
      issues.push(result.reason instanceof Error ? result.reason.message : "The LLM request failed.");
      continue;
    }
    const { candidates, snapshot } = result.value;
    proposed.push(...candidates.map((candidate) => ({
      ...candidate,
      snapshotCapturedAt: snapshot.capturedAt,
      sourceUrl: snapshot.sourceUrl
    })));
    const validated = validateLlmEvidenceCandidates(candidates, {
      nights,
      pageText: snapshot.textSample,
      sourceUrl: snapshot.sourceUrl
    });
    issues.push(...validated.issues.map((issue) => `${snapshot.pageTitle || snapshot.sourceUrl}: ${issue}`));
    accepted.push(...validated.accepted.map((candidate) => ({
      ...candidate,
      pageText: snapshot.textSample,
      pageTitle: snapshot.pageTitle
    })));
  }

  if (failedRequests === snapshots.length) {
    await prisma.evidenceExtractionRun.update({
      where: { id: extractionRun.id },
      data: { issuesJson: toJson(issues), proposedCandidatesJson: toJson(proposed) }
    });
    const firstFailure = settled.find((result) => result.status === "rejected");
    if (firstFailure?.status === "rejected" && firstFailure.reason instanceof LlmEvidenceError) {
      throw new LlmEvidenceError(firstFailure.reason.code, firstFailure.reason.message);
    }
    throw new LlmEvidenceError("llm_extraction_failed", issues[0] ?? "Every LLM extraction request failed.");
  }

  const deterministicCandidates = parseObservationDrafts(run.inventoryEvidenceJson);
  const existingCandidates = run.observations.map(observationToDraft);
  const knownCandidates = [...deterministicCandidates, ...existingCandidates];
  const ready: AcceptedCandidate[] = [];
  let corroborated = 0;
  let incomplete = 0;
  for (const candidate of accepted) {
    if (!context.inventoryTypes.includes(candidate.draft.inventoryType)) {
      issues.push(`The ${candidate.draft.inventoryType} candidate was not requested by this price check.`);
      continue;
    }
    if (knownCandidates.some((known) => candidatesDescribeSameFact(known, candidate.draft))) {
      corroborated += 1;
      continue;
    }
    knownCandidates.push(candidate.draft);
    if (!isObservationReady(candidate.draft)) {
      incomplete += 1;
      continue;
    }
    ready.push(candidate);
  }

  const prepared = await prepareObservations(context, ready);
  const observationIds = prepared.map(() => randomUUID());
  const status: EvidenceExtractionStatus = issues.length > 0 ? "partial" : "succeeded";

  await prisma.$transaction(async (tx) => {
    for (let index = 0; index < prepared.length; index += 1) {
      const { candidate, evidence } = prepared[index];
      await tx.priceObservation.create({
        data: {
          breakfastIncluded: candidate.draft.breakfastIncluded,
          cancellationPolicyRaw: candidate.draft.cancellationPolicyRaw,
          cashBase: candidate.draft.cashBase,
          cashCopay: candidate.draft.cashCopay,
          cashCopayCurrency: candidate.draft.cashCopay === null ? null : candidate.draft.cashCurrency,
          cashCurrency: candidate.draft.cashCurrency,
          cashFees: candidate.draft.cashFees,
          cashTaxes: candidate.draft.cashTaxes,
          cashTotal: candidate.draft.cashTotal,
          collectionMethod: "browser_companion",
          booking: { connect: { id: context.bookingId } },
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
          extractionRun: { connect: { id: extractionRun.id } },
          extractionSource: "model",
          extractorName: extractor.name,
          extractorVersion: extractor.version,
          id: observationIds[index],
          inventoryType: candidate.draft.inventoryType,
          isSuite: inferIsSuite(candidate.draft.roomTypeRaw ?? ""),
          loyaltyEligible: candidate.draft.loyaltyEligible,
          points: candidate.draft.points,
          priceCheckRun: { connect: { id: priceCheckRunId } },
          providerName: run.providerName,
          ratePlanName: candidate.draft.ratePlanName,
          rawRateName: candidate.draft.rawRateName,
          roomTypeRaw: candidate.draft.roomTypeRaw,
          sourceName: `${context.hotelGroup} official site (LLM replay)`,
          sourceType: "direct",
          sourceUrl: candidate.draft.sourceUrl
        }
      });
    }
    await tx.evidenceExtractionRun.update({
      where: { id: extractionRun.id },
      data: {
        acceptedCandidatesJson: toJson(accepted.map((candidate) => ({
          draft: candidate.draft,
          proposal: candidate.proposal
        }))),
        issuesJson: toJson(issues),
        proposedCandidatesJson: toJson(proposed),
        status
      }
    });
  });

  if (observationIds.length > 0) {
    await createRecommendationForBooking(context.bookingId);
  }
  return {
    acceptedCandidates: accepted.length,
    corroboratedCandidates: corroborated,
    extractionRunId: extractionRun.id,
    incompleteCandidates: incomplete,
    issues,
    model: extractor.model,
    observationsCreated: observationIds.length,
    proposedCandidates: proposed.length,
    status
  };
}

export function selectReplaySnapshots(snapshots: readonly SanitizedBrowserSnapshot[]) {
  const selected = new Map<string, SanitizedBrowserSnapshot>();
  for (const phase of ["inventory", "detail"] as const) {
    const snapshot = [...snapshots].reverse().find((item) => item.phase === phase && item.textSample);
    if (snapshot) {
      selected.set(`${snapshot.capturedAt}|${snapshot.sourceUrl}|${snapshot.phase}`, snapshot);
    }
  }
  if (selected.size === 0) {
    const snapshot = [...snapshots].reverse().find((item) => item.textSample);
    if (snapshot) {
      selected.set(`${snapshot.capturedAt}|${snapshot.sourceUrl}|${snapshot.phase}`, snapshot);
    }
  }
  return [...selected.values()];
}

async function prepareObservations(context: BookingPriceInput, candidates: readonly AcceptedCandidate[]) {
  const provider = getBookingPriceProvider(context.hotelGroup);
  return Promise.all(candidates.map(async (candidate) => {
    const conversionAvailable =
      candidate.draft.inventoryType === "award" ||
      !candidate.draft.cashCurrency ||
      (await getCurrencyConversion(candidate.draft.cashCurrency, context.currency as "USD" | "CNY")) !== null;
    return {
      candidate,
      evidence: buildObservationEvidence({
        bookingCancellationDeadline: context.cancellationDeadline,
        bookingCheckIn: context.checkIn,
        bookingCurrency: context.currency,
        bookingRoomType: context.roomType,
        cancellationPolicyRaw: candidate.draft.cancellationPolicyRaw,
        cashCurrency: candidate.draft.cashCurrency,
        collectionMethod: "browser_companion",
        conversionAvailable,
        feesIncluded: candidate.draft.feesIncluded,
        hasCashComponent: candidate.draft.cashCopay !== null,
        inventoryType: candidate.draft.inventoryType,
        loginState: provider?.inferLoginState(candidate.pageText) ?? "unknown",
        loyaltyEligible: candidate.draft.loyaltyEligible,
        pageText: candidate.pageText,
        pageTitle: candidate.pageTitle,
        roomTypeRaw: candidate.draft.roomTypeRaw,
        sourceType: "direct",
        sourceUrl: candidate.draft.sourceUrl,
        taxesIncluded: candidate.draft.taxesIncluded
      })
    };
  }));
}

function stayNights(context: BookingPriceInput) {
  return Math.max(1, Math.round((context.checkOut.getTime() - context.checkIn.getTime()) / 86_400_000));
}

function isObservationReady(candidate: ParsedObservationDraft) {
  return candidate.inventoryType === "cash"
    ? candidate.cashTotal !== null
    : candidate.points !== null || candidate.cashCopay !== null;
}

function candidatesDescribeSameFact(left: ParsedObservationDraft, right: ParsedObservationDraft) {
  const leftRoom = normalizeLabel(left.roomTypeRaw);
  const rightRoom = normalizeLabel(right.roomTypeRaw);
  const currencyMatches = left.inventoryType === "award" && left.cashCopay === null && right.cashCopay === null
    ? true
    : (left.cashCurrency?.toUpperCase() ?? "") === (right.cashCurrency?.toUpperCase() ?? "");
  return left.inventoryType === right.inventoryType &&
    currencyMatches &&
    left.cashTotal === right.cashTotal &&
    left.cashCopay === right.cashCopay &&
    left.points === right.points &&
    (!leftRoom || !rightRoom || leftRoom === rightRoom);
}

function normalizeLabel(value: string | null) {
  return value?.replace(/\s+/g, " ").trim().toLowerCase() ?? "";
}

function observationToDraft(observation: {
  breakfastIncluded: boolean | null;
  cancellationPolicyRaw: string | null;
  cashBase: number | null;
  cashCopay: number | null;
  cashCurrency: string | null;
  cashFees: number | null;
  cashTaxes: number | null;
  cashTotal: number | null;
  inventoryType: string;
  loyaltyEligible: boolean | null;
  points: number | null;
  ratePlanName: string | null;
  rawRateName: string | null;
  roomTypeRaw: string | null;
  sourceUrl: string | null;
}): ParsedObservationDraft {
  return {
    breakfastIncluded: observation.breakfastIncluded,
    cancellationPolicyRaw: observation.cancellationPolicyRaw,
    cashBase: observation.cashBase,
    cashCopay: observation.cashCopay,
    cashCurrency: observation.cashCurrency,
    cashFees: observation.cashFees,
    cashTaxes: observation.cashTaxes,
    cashTotal: observation.cashTotal,
    feesIncluded: null,
    inventoryType: observation.inventoryType === "award" ? "award" : "cash",
    loyaltyEligible: observation.loyaltyEligible,
    points: observation.points,
    ratePlanName: observation.ratePlanName,
    rawRateName: observation.rawRateName,
    roomTypeRaw: observation.roomTypeRaw,
    sourceUrl: observation.sourceUrl ?? "",
    taxesIncluded: null
  };
}
