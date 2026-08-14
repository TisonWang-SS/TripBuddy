import type { CertificateKind, EvidenceQuality, PointsBasis, RecommendationVerdict, RiskLevel, SourceType } from "@prisma/client";
import {
  effectiveUnitValue,
  findValuation,
  isValuationStale,
  missingValuationBlocker,
  staleValuationWarning,
  type SourcedValuation
} from "@/lib/loyaltyValuation";

export type DecisionProfile = {
  caresAboutBreakfast: boolean;
  caresAboutLateCheckout: boolean;
  caresAboutLounge: boolean;
  caresAboutUpgrade: boolean;
  savingsThreshold: number;
  urgentWindowHours: number;
};

export type DecisionBooking = {
  baselineCashTotal: number | null;
  baselinePoints: number | null;
  baselineType: "cash" | "points" | "certificate";
  bookingChannel: SourceType;
  breakfastIncluded: boolean;
  cancellationDeadline: Date | null;
  checkIn: Date;
  checkOut: Date;
  currency: string;
  guests: number;
  hotelGroup: string;
  hotelName: string;
  id: string;
  loyaltyEligible: boolean;
  roomType: string;
};

export type DecisionLoyaltyAccount = {
  hotelGroup: string;
  tier: string;
};

/** What a certificate baseline spends. Absent when the booking never says. */
export type DecisionCertificateBaseline = {
  count: number;
  kind: CertificateKind;
};

export type DecisionLoyaltyRule = {
  basePointsPerUsd: number;
  bonusRate: number;
  breakfastBenefit: boolean;
  hotelGroup: string;
  lateCheckoutBenefit: boolean;
  loungeBenefit: boolean;
  tier: string;
  upgradeBenefit: boolean;
};

export type DecisionCreditCardBenefit = {
  cashBackRate: number;
  hotelGroup: string | null;
  pointMultiplier: number;
};

export type DecisionPromotion = {
  appliesToExistingBookings: boolean;
  bonusMultiplier: number;
  endDate: Date | null;
  flatValue: number;
  hotelGroup: string;
  requiresRegistration: boolean;
  startDate: Date | null;
  title: string;
};

export type CostBreakdown = {
  cashPrice: number;
  /** Sourced value of the certificates this stay spends. A cost, like points. */
  certificateValue: number;
  creditCardValue: number;
  effectiveCost: number;
  earnedPointsValue: number;
  promotionValue: number;
  redemptionPointsValue: number;
};

export type DecisionCandidate = {
  blockers: string[];
  breakfastIncluded: boolean;
  cashTotal: number;
  cost: CostBreakdown;
  id: string;
  loyaltyEligible: boolean;
  qualityLevel: EvidenceQuality;
  roomType: string;
  sourceType: SourceType;
  warnings: string[];
};

export type DecisionInput = {
  baselineCost: CostBreakdown;
  booking: DecisionBooking;
  candidates: DecisionCandidate[];
  now?: Date;
  profile: DecisionProfile;
};

export type DecisionOutput = {
  candidateObservationId: string;
  estimatedSavings: number;
  explanation: string;
  riskLevel: RiskLevel;
  verdict: RecommendationVerdict;
};

export interface RecommendationDecider {
  name: string;
  version: string;
  decide(input: DecisionInput): Promise<DecisionOutput>;
}

export class DeterministicRecommendationDecider implements RecommendationDecider {
  name = "deterministic";
  version = "3";

  async decide(input: DecisionInput): Promise<DecisionOutput> {
    const candidate = selectCandidate(input.candidates, input.baselineCost);
    const estimatedSavings = input.baselineCost.effectiveCost - candidate.cost.effectiveCost;
    const hoursToDeadline = input.booking.cancellationDeadline
      ? (input.booking.cancellationDeadline.getTime() - (input.now ?? new Date()).getTime()) / 3_600_000
      : Number.POSITIVE_INFINITY;

    if (hoursToDeadline >= 0 && hoursToDeadline <= input.profile.urgentWindowHours) {
      return {
        candidateObservationId: candidate.id,
        estimatedSavings,
        explanation: "The free-cancellation deadline is close. Review the latest structured evidence before the window closes.",
        riskLevel: candidate.blockers.length > 0 ? "high" : "medium",
        verdict: "urgent"
      };
    }
    if (candidate.blockers.length > 0) {
      return {
        candidateObservationId: candidate.id,
        estimatedSavings,
        explanation: candidate.blockers.join(" "),
        riskLevel: "high",
        verdict: "needs_review"
      };
    }
    if (candidate.sourceType === "ota" && estimatedSavings >= input.profile.savingsThreshold) {
      return {
        candidateObservationId: candidate.id,
        estimatedSavings,
        explanation: "The OTA candidate may reduce effective cost, but its loyalty and policy tradeoffs should be reviewed.",
        riskLevel: "medium",
        verdict: "consider_ota"
      };
    }
    if (candidate.sourceType === "direct" && estimatedSavings >= input.profile.savingsThreshold) {
      return {
        candidateObservationId: candidate.id,
        estimatedSavings,
        explanation: "The verified direct candidate is meaningfully cheaper after deterministic price and loyalty calculations.",
        riskLevel: candidate.qualityLevel === "high" ? "low" : "medium",
        verdict: "rebook_direct"
      };
    }
    return {
      candidateObservationId: candidate.id,
      estimatedSavings,
      explanation: "The best comparable candidate does not clear the configured savings threshold.",
      riskLevel: "low",
      verdict: "keep"
    };
  }
}

export async function decideWithGuardrails(decider: RecommendationDecider, input: DecisionInput) {
  if (input.candidates.length === 0) {
    throw new Error("A recommendation requires at least one candidate observation.");
  }
  const output = validateDecisionOutput(await decider.decide(input), decider.name);
  const selected = input.candidates.find((candidate) => candidate.id === output.candidateObservationId);
  if (!selected) {
    throw new Error(`${decider.name} returned a candidate that was not present in the structured input.`);
  }
  const guardedOutput = {
    ...output,
    estimatedSavings: input.baselineCost.effectiveCost - selected.cost.effectiveCost
  };
  if (selected.blockers.length > 0 && (guardedOutput.verdict === "rebook_direct" || guardedOutput.verdict === "consider_ota")) {
    return {
      ...guardedOutput,
      explanation: selected.blockers.join(" "),
      riskLevel: "high" as const,
      verdict: "needs_review" as const
    };
  }
  return guardedOutput;
}

function validateDecisionOutput(value: unknown, providerName: string): DecisionOutput {
  const output = value as Partial<DecisionOutput> | null;
  const verdicts: RecommendationVerdict[] = ["keep", "rebook_direct", "consider_ota", "needs_review", "urgent"];
  const risks: RiskLevel[] = ["low", "medium", "high"];
  if (
    !output ||
    typeof output.candidateObservationId !== "string" ||
    !output.candidateObservationId ||
    typeof output.estimatedSavings !== "number" ||
    !Number.isFinite(output.estimatedSavings) ||
    typeof output.explanation !== "string" ||
    !output.explanation.trim() ||
    !output.riskLevel ||
    !risks.includes(output.riskLevel) ||
    !output.verdict ||
    !verdicts.includes(output.verdict)
  ) {
    throw new Error(`${providerName} returned an invalid decision output.`);
  }
  return {
    candidateObservationId: output.candidateObservationId,
    estimatedSavings: output.estimatedSavings,
    explanation: output.explanation.trim().slice(0, 2_000),
    riskLevel: output.riskLevel,
    verdict: output.verdict
  };
}

/*
 * Valuations arrive already expressed in the booking's currency: converting
 * them is the caller's job, because a conversion that is not on record is a
 * blocker rather than something to assume here.
 */
export function calculateStayCost(input: {
  booking: DecisionBooking;
  cashPrice: number;
  certificate?: DecisionCertificateBaseline | null;
  creditCards: DecisionCreditCardBenefit[];
  loyaltyEligible: boolean;
  loyaltyRule?: DecisionLoyaltyRule | null;
  points: number;
  promotions: DecisionPromotion[];
  valuations: readonly SourcedValuation[];
}) {
  /* Points take the quoted value as is. A realization rate is a certificate
   * concept and the write boundary rejects one on a point valuation, so
   * reading `amount` here keeps that boundary visible instead of quietly
   * discounting points if a rate ever reached storage another way. */
  const pointValuation = findValuation(input.valuations, "point");
  const pointValue = pointValuation?.amount ?? 0;
  const certificateValuation = input.certificate ? findValuation(input.valuations, input.certificate.kind) : null;
  const certificateValue =
    input.certificate && certificateValuation ? input.certificate.count * effectiveUnitValue(certificateValuation) : 0;
  const basePoints = input.loyaltyRule?.basePointsPerUsd ?? 0;
  const bonusRate = input.loyaltyRule?.bonusRate ?? 0;
  const earnedPointsValue = input.loyaltyEligible
    ? input.cashPrice * basePoints * (1 + bonusRate) * pointValue
    : 0;
  const redemptionPointsValue = input.points * pointValue;
  const activePromotions = input.promotions.filter((promotion) => {
    return promotionAppliesToStay(promotion, input.booking, input.loyaltyEligible) && !promotion.requiresRegistration;
  });
  const promotionValue = activePromotions.reduce((total, promotion) => {
    return total + input.cashPrice * basePoints * promotion.bonusMultiplier * pointValue + promotion.flatValue;
  }, 0);
  const creditCardValue = Math.max(
    0,
    ...input.creditCards
      .filter((card) => !card.hotelGroup || card.hotelGroup === input.booking.hotelGroup)
      .map((card) => input.cashPrice * card.cashBackRate + input.cashPrice * card.pointMultiplier * pointValue)
  );
  return {
    cashPrice: input.cashPrice,
    certificateValue,
    creditCardValue,
    effectiveCost:
      input.cashPrice + redemptionPointsValue + certificateValue - earnedPointsValue - promotionValue - creditCardValue,
    earnedPointsValue,
    promotionValue,
    redemptionPointsValue
  } satisfies CostBreakdown;
}

/*
 * What the arithmetic above had to assume, said out loud.
 *
 * Spending an unpriced point or certificate is a blocker: valuing it at zero
 * makes a stay look free, which is the one direction a cost model must never
 * fail in. Earning an unpriced point is only a warning, because a missing
 * upside understates both sides rather than manufacturing a saving.
 */
export function valuationIssues(input: {
  certificate?: DecisionCertificateBaseline | null;
  earnsPoints: boolean;
  hotelGroup: string;
  now?: Date;
  points: number;
  pointsBasis?: PointsBasis;
  valuations: readonly SourcedValuation[];
}) {
  const now = input.now ?? new Date();
  const blockers: string[] = [];
  const warnings: string[] = [];
  let stale = false;
  const pointValuation = findValuation(input.valuations, "point");

  /*
   * A nightly points rate priced as if it covered the stay understates the
   * cost by the number of nights, which points the recommendation the wrong
   * way — the same failure the cash side already refuses when it treats an
   * `Avg/Night` starting price as a discovery hint rather than a total.
   */
  if (input.points > 0 && input.pointsBasis !== undefined && input.pointsBasis !== "stay_total") {
    blockers.push(
      input.pointsBasis === "per_night"
        ? "The points rate covers one night rather than the stay, so it cannot be compared with a stay total."
        : "The points rate does not show whether it covers the stay or one night."
    );
  }

  if (input.points > 0 && !pointValuation) {
    blockers.push(missingValuationBlocker(input.hotelGroup, "point"));
  } else if (input.earnsPoints && !pointValuation) {
    warnings.push(`No ${input.hotelGroup} point value is recorded, so the points this stay earns are not priced.`);
  }
  if (input.certificate) {
    const certificateValuation = findValuation(input.valuations, input.certificate.kind);
    if (!certificateValuation) {
      blockers.push(missingValuationBlocker(input.hotelGroup, input.certificate.kind));
    } else if (isValuationStale(certificateValuation, now)) {
      warnings.push(staleValuationWarning(certificateValuation));
      stale = true;
    }
  }
  if (pointValuation && (input.points > 0 || input.earnsPoints) && isValuationStale(pointValuation, now)) {
    warnings.push(staleValuationWarning(pointValuation));
    stale = true;
  }
  return { blockers, stale, warnings };
}

type EntitlementInput = {
  breakfastIncluded: boolean;
  loyaltyEligible: boolean;
  loyaltyRule?: DecisionLoyaltyRule | null;
};

const ENTITLEMENTS = [
  {
    label: "breakfast",
    preference: "caresAboutBreakfast",
    present: (input: EntitlementInput) =>
      input.breakfastIncluded || (input.loyaltyEligible && input.loyaltyRule?.breakfastBenefit === true)
  },
  {
    label: "lounge access",
    preference: "caresAboutLounge",
    present: (input: EntitlementInput) => input.loyaltyEligible && input.loyaltyRule?.loungeBenefit === true
  },
  {
    label: "late checkout",
    preference: "caresAboutLateCheckout",
    present: (input: EntitlementInput) => input.loyaltyEligible && input.loyaltyRule?.lateCheckoutBenefit === true
  },
  {
    label: "room upgrades",
    preference: "caresAboutUpgrade",
    present: (input: EntitlementInput) => input.loyaltyEligible && input.loyaltyRule?.upgradeBenefit === true
  }
] as const;

export function entitlementLossWarnings(input: {
  baseline: EntitlementInput;
  candidate: EntitlementInput;
  profile: DecisionProfile;
}) {
  return ENTITLEMENTS.filter((entitlement) => {
    return input.profile[entitlement.preference] && entitlement.present(input.baseline) && !entitlement.present(input.candidate);
  }).map((entitlement) => `The candidate drops ${entitlement.label} available with the current booking.`);
}

export function unconfirmedPromotionWarnings(input: {
  booking: DecisionBooking;
  loyaltyEligible: boolean;
  promotions: DecisionPromotion[];
}) {
  return input.promotions
    .filter((promotion) => {
      return promotion.requiresRegistration && promotionAppliesToStay(promotion, input.booking, input.loyaltyEligible);
    })
    .map((promotion) => `Promotion “${promotion.title}” requires registration and is excluded until registration can be confirmed.`);
}

function promotionAppliesToStay(
  promotion: DecisionPromotion,
  booking: DecisionBooking,
  loyaltyEligible: boolean
) {
  return (
    promotion.hotelGroup === booking.hotelGroup &&
    (!promotion.startDate || promotion.startDate <= booking.checkOut) &&
    (!promotion.endDate || promotion.endDate >= booking.checkIn) &&
    loyaltyEligible
  );
}

function selectCandidate(candidates: DecisionCandidate[], baselineCost: CostBreakdown) {
  return [...candidates].sort((a, b) => {
    const aSafe = a.blockers.length === 0 ? 1 : 0;
    const bSafe = b.blockers.length === 0 ? 1 : 0;
    if (aSafe !== bSafe) {
      return bSafe - aSafe;
    }
    const aSavings = baselineCost.effectiveCost - a.cost.effectiveCost;
    const bSavings = baselineCost.effectiveCost - b.cost.effectiveCost;
    if (aSavings !== bSavings) {
      return bSavings - aSavings;
    }
    return Number(b.sourceType === "direct") - Number(a.sourceType === "direct");
  })[0];
}
