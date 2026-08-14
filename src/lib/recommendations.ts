import type { PointsBasis, SupportedCurrency } from "@prisma/client";
import type { DecisionCertificateBaseline, RecommendationDecider } from "@/lib/decision";
import {
  calculateStayCost,
  decideWithGuardrails,
  DeterministicRecommendationDecider,
  entitlementLossWarnings,
  unconfirmedPromotionWarnings,
  valuationIssues
} from "@/lib/decision";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { stringList, toJson } from "@/lib/json";
import {
  downgradeEvidenceQuality,
  findValuation,
  unconvertibleValuationWarning,
  type SourcedValuation
} from "@/lib/loyaltyValuation";
import { serializeRecommendationCostBreakdown } from "@/lib/recommendationCodecs";
import { compareRedemptionToCash, selectRedemptionPair } from "@/lib/redemptionComparison";
import { getCurrencyConversion } from "@/lib/systemSettings";

export async function createRecommendationForBooking(
  bookingId: string,
  decider: RecommendationDecider = new DeterministicRecommendationDecider()
) {
  const [profile, booking, observations, promotions] = await Promise.all([
    prisma.userProfile.findUnique({
      where: { id: DEFAULT_PROFILE_ID },
      include: { creditCardBenefits: true, loyaltyAccounts: true }
    }),
    prisma.hotelBooking.findUnique({ where: { id: bookingId } }),
    prisma.priceObservation.findMany({
      where: { bookingId },
      include: { evidence: true },
      orderBy: { observedAt: "desc" }
    }),
    prisma.promotion.findMany()
  ]);
  if (!profile || !booking || observations.length === 0) {
    return null;
  }

  const loyaltyAccount = profile.loyaltyAccounts.find((account) => account.hotelGroup === booking.hotelGroup) ?? null;
  const loyaltyRule = loyaltyAccount
    ? await prisma.loyaltyRule.findUnique({
        where: { hotelGroup_tier: { hotelGroup: loyaltyAccount.hotelGroup, tier: loyaltyAccount.tier } }
      })
    : null;
  const recordedValuations = await prisma.loyaltyValuation.findMany({
    where: { hotelGroup: booking.hotelGroup, profileId: DEFAULT_PROFILE_ID }
  });
  const { valuations, warnings: conversionWarnings } = await comparableValuations(recordedValuations, booking.currency);
  const certificate = certificateBaseline(booking);
  const baselineCost = calculateStayCost({
    booking,
    cashPrice: booking.baselineCashTotal ?? 0,
    certificate,
    creditCards: profile.creditCardBenefits,
    loyaltyEligible: booking.loyaltyEligible,
    loyaltyRule,
    points: booking.baselinePoints ?? 0,
    promotions: promotions.filter((promotion) => promotion.appliesToExistingBookings),
    valuations
  });
  const baselineValuation = valuationIssues({
    certificate,
    earnsPoints: booking.loyaltyEligible && (loyaltyRule?.basePointsPerUsd ?? 0) > 0,
    hotelGroup: booking.hotelGroup,
    points: booking.baselinePoints ?? 0,
    valuations
  });
  const baselineWarnings = [
    ...conversionWarnings,
    ...baselineValuation.warnings,
    ...unstructuredCertificateWarnings(booking),
    ...unconfirmedPromotionWarnings({
      booking,
      loyaltyEligible: booking.loyaltyEligible,
      promotions: promotions.filter((promotion) => promotion.appliesToExistingBookings)
    })
  ];
  const candidates = await Promise.all(
    observations
      .filter((observation) => observation.evidence)
      .map(async (observation) => {
        const evidence = observation.evidence!;
        const cashTotal = await comparableCashTotal(observation.cashTotal, observation.cashCurrency, booking.currency);
        const copay = await comparableCashTotal(
          observation.cashCopay,
          observation.cashCopayCurrency ?? observation.cashCurrency,
          booking.currency
        );
        const comparableCashPrice =
          observation.inventoryType === "cash"
            ? cashTotal ?? baselineCost.cashPrice
            : observation.cashCopay === null
              ? 0
              : copay ?? baselineCost.cashPrice;
        const cost = calculateStayCost({
          booking,
          cashPrice: comparableCashPrice,
          creditCards: profile.creditCardBenefits,
          loyaltyEligible: observation.loyaltyEligible === true,
          loyaltyRule,
          points: observation.points ?? 0,
          promotions,
          valuations
        });
        const candidateValuation = valuationIssues({
          earnsPoints: observation.loyaltyEligible === true && (loyaltyRule?.basePointsPerUsd ?? 0) > 0,
          hotelGroup: booking.hotelGroup,
          points: observation.points ?? 0,
          pointsBasis: observation.pointsBasis,
          valuations
        });
        const warnings = [
          ...stringList(evidence.warningsJson),
          ...entitlementLossWarnings({
            baseline: {
              breakfastIncluded: booking.breakfastIncluded,
              loyaltyEligible: booking.loyaltyEligible,
              loyaltyRule
            },
            candidate: {
              breakfastIncluded: observation.breakfastIncluded === true,
              loyaltyEligible: observation.loyaltyEligible === true,
              loyaltyRule
            },
            profile
          }),
          ...baselineWarnings,
          ...candidateValuation.warnings,
          ...unconfirmedPromotionWarnings({
            booking,
            loyaltyEligible: observation.loyaltyEligible === true,
            promotions
          })
        ];
        return {
          blockers: [
            ...new Set([...stringList(evidence.blockersJson), ...baselineValuation.blockers, ...candidateValuation.blockers])
          ],
          breakfastIncluded: observation.breakfastIncluded === true,
          cashTotal: comparableCashPrice,
          cost,
          id: observation.id,
          loyaltyEligible: observation.loyaltyEligible === true,
          /* A figure past its review date still counts, one confidence level lower. */
          qualityLevel:
            baselineValuation.stale || candidateValuation.stale
              ? downgradeEvidenceQuality(evidence.qualityLevel)
              : evidence.qualityLevel,
          roomType: observation.roomTypeRaw ?? "Room not captured",
          sourceType: observation.sourceType,
          warnings: [...new Set(warnings)]
        };
      })
  );
  if (candidates.length === 0) {
    return null;
  }

  const output = await decideWithGuardrails(decider, {
    baselineCost,
    booking,
    candidates,
    profile
  });
  const selected = candidates.find((candidate) => candidate.id === output.candidateObservationId)!;

  return prisma.recommendation.create({
    data: {
      blockersJson: toJson(selected.blockers),
      bookingId,
      candidateObservationId: selected.id,
      cashDifference: baselineCost.cashPrice - selected.cost.cashPrice,
      costBreakdownJson: serializeRecommendationCostBreakdown({
        baseline: baselineCost,
        candidate: selected.cost,
        redemption: redemptionComparison(observations, findValuation(recordedValuations, "point"))
      }),
      creditCardValueDifference: selected.cost.creditCardValue - baselineCost.creditCardValue,
      currency: booking.currency,
      decisionProvider: decider.name,
      decisionVersion: decider.version,
      estimatedSavings: output.estimatedSavings,
      explanation: output.explanation,
      pointsValueDifference: baselineCost.redemptionPointsValue - selected.cost.redemptionPointsValue,
      promotionValueDifference: selected.cost.promotionValue - baselineCost.promotionValue,
      qualityLevel: selected.qualityLevel,
      riskLevel: output.riskLevel,
      verdict: output.verdict,
      warningsJson: toJson(selected.warnings)
    }
  });
}

type ObservationWithEvidence = {
  cashCopay: number | null;
  cashCopayCurrency: string | null;
  cashCurrency: string | null;
  cashTotal: number | null;
  evidence: { feesIncluded: "yes" | "no" | "unknown"; taxesIncluded: "yes" | "no" | "unknown" } | null;
  inventoryType: "cash" | "award";
  observedAt: Date;
  points: number | null;
  pointsBasis: PointsBasis;
  priceCheckRunId: string | null;
  roomTypeRaw: string | null;
};

/*
 * The cash-versus-points conclusion, drawn only from one page visit. The
 * recorded point value goes in as recorded rather than converted: a comparison
 * of two numbers read together should not acquire a third provenance on the
 * way to its verdict.
 */
function redemptionComparison(observations: readonly ObservationWithEvidence[], pointValuation: SourcedValuation | null) {
  const pair = selectRedemptionPair(
    observations
      .filter((observation) => observation.evidence)
      .map((observation) => ({
        captureId: observation.priceCheckRunId,
        cashCopay: observation.cashCopay,
        cashCopayCurrency: observation.cashCopayCurrency,
        cashCurrency: observation.cashCurrency,
        cashTotal: observation.cashTotal,
        feesIncluded: observation.evidence!.feesIncluded,
        inventoryType: observation.inventoryType,
        observedAt: observation.observedAt,
        points: observation.points,
        pointsBasis: observation.pointsBasis,
        roomLabel: observation.roomTypeRaw,
        taxesIncluded: observation.evidence!.taxesIncluded
      }))
  );
  if (!pair) {
    return undefined;
  }
  return compareRedemptionToCash({
    award: {
      captureId: pair.award.captureId,
      copay: pair.award.cashCopay,
      copayCurrency: pair.award.cashCopayCurrency ?? pair.award.cashCurrency,
      points: pair.award.points,
      pointsBasis: pair.award.pointsBasis,
      roomLabel: pair.award.roomLabel
    },
    cash: {
      captureId: pair.cash.captureId,
      currency: pair.cash.cashCurrency,
      feesIncluded: pair.cash.feesIncluded,
      roomLabel: pair.cash.roomLabel,
      taxesIncluded: pair.cash.taxesIncluded,
      total: pair.cash.cashTotal
    },
    pointValuation: pointValuation ? { amount: pointValuation.amount, currency: pointValuation.currency } : null
  });
}

function certificateBaseline(booking: {
  baselineAwardCount: number | null;
  baselineAwardKind: "free_night" | "suite_upgrade" | null;
  baselineType: "cash" | "points" | "certificate";
}): DecisionCertificateBaseline | null {
  if (booking.baselineType !== "certificate" || !booking.baselineAwardKind || !booking.baselineAwardCount) {
    return null;
  }
  return { count: booking.baselineAwardCount, kind: booking.baselineAwardKind };
}

/*
 * An imported certificate stay records prose, not a count. Pricing it at zero
 * would make the current booking look free and every cash candidate look like
 * a loss, so the gap is named instead.
 */
function unstructuredCertificateWarnings(booking: {
  baselineAwardCount: number | null;
  baselineAwardKind: "free_night" | "suite_upgrade" | null;
  baselineType: "cash" | "points" | "certificate";
}) {
  if (booking.baselineType !== "certificate" || certificateBaseline(booking)) {
    return [];
  }
  return ["The current booking is paid with a certificate whose kind and count are not recorded, so its value is not in this comparison."];
}

async function comparableValuations(
  recorded: readonly SourcedValuation[],
  targetCurrency: SupportedCurrency
) {
  const valuations: SourcedValuation[] = [];
  const warnings: string[] = [];
  for (const valuation of recorded) {
    const rate = await getCurrencyConversion(valuation.currency, targetCurrency);
    if (rate === null) {
      warnings.push(unconvertibleValuationWarning(valuation, targetCurrency));
      continue;
    }
    valuations.push({ ...valuation, amount: valuation.amount * rate, currency: targetCurrency });
  }
  return { valuations, warnings };
}

async function comparableCashTotal(amount: number | null, sourceCurrency: string | null, targetCurrency: "USD" | "CNY") {
  if (amount === null || !sourceCurrency) {
    return null;
  }
  const rate = await getCurrencyConversion(sourceCurrency, targetCurrency);
  return rate === null ? null : amount * rate;
}
