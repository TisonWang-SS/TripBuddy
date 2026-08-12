import type { RecommendationDecider } from "@/lib/decision";
import {
  calculateStayCost,
  decideWithGuardrails,
  DeterministicRecommendationDecider,
  entitlementLossWarnings,
  unconfirmedPromotionWarnings
} from "@/lib/decision";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { stringList, toJson } from "@/lib/json";
import { serializeRecommendationCostBreakdown } from "@/lib/recommendationCodecs";
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
  const baselineCost = calculateStayCost({
    booking,
    cashPrice: booking.baselineCashTotal ?? 0,
    creditCards: profile.creditCardBenefits,
    loyaltyAccount,
    loyaltyEligible: booking.loyaltyEligible,
    loyaltyRule,
    points: booking.baselinePoints ?? 0,
    promotions: promotions.filter((promotion) => promotion.appliesToExistingBookings)
  });
  const baselinePromotionWarnings = unconfirmedPromotionWarnings({
    booking,
    loyaltyEligible: booking.loyaltyEligible,
    promotions: promotions.filter((promotion) => promotion.appliesToExistingBookings)
  });
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
          loyaltyAccount,
          loyaltyEligible: observation.loyaltyEligible === true,
          loyaltyRule,
          points: observation.points ?? 0,
          promotions
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
          ...baselinePromotionWarnings,
          ...unconfirmedPromotionWarnings({
            booking,
            loyaltyEligible: observation.loyaltyEligible === true,
            promotions
          })
        ];
        return {
          blockers: stringList(evidence.blockersJson),
          breakfastIncluded: observation.breakfastIncluded === true,
          cashTotal: comparableCashPrice,
          cost,
          id: observation.id,
          loyaltyEligible: observation.loyaltyEligible === true,
          qualityLevel: evidence.qualityLevel,
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
  const selectedObservation = observations.find((observation) => observation.id === output.candidateObservationId)!;
  const selectedEvidence = selectedObservation.evidence!;

  return prisma.recommendation.create({
    data: {
      blockersJson: selectedEvidence.blockersJson,
      bookingId,
      candidateObservationId: selected.id,
      cashDifference: baselineCost.cashPrice - selected.cost.cashPrice,
      costBreakdownJson: serializeRecommendationCostBreakdown({ baseline: baselineCost, candidate: selected.cost }),
      creditCardValueDifference: selected.cost.creditCardValue - baselineCost.creditCardValue,
      currency: booking.currency,
      decisionProvider: decider.name,
      decisionVersion: decider.version,
      estimatedSavings: output.estimatedSavings,
      explanation: output.explanation,
      pointsValueDifference: baselineCost.redemptionPointsValue - selected.cost.redemptionPointsValue,
      promotionValueDifference: selected.cost.promotionValue - baselineCost.promotionValue,
      qualityLevel: selectedEvidence.qualityLevel,
      riskLevel: output.riskLevel,
      verdict: output.verdict,
      warningsJson: toJson(selected.warnings)
    }
  });
}

async function comparableCashTotal(amount: number | null, sourceCurrency: string | null, targetCurrency: "USD" | "CNY") {
  if (amount === null || !sourceCurrency) {
    return null;
  }
  const rate = await getCurrencyConversion(sourceCurrency, targetCurrency);
  return rate === null ? null : amount * rate;
}
