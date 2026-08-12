import type { EvidenceQuality, RecommendationVerdict, RiskLevel, SourceType } from "@prisma/client";

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
  pointValue: number;
  tier: string;
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

export function calculateStayCost(input: {
  booking: DecisionBooking;
  cashPrice: number;
  creditCards: DecisionCreditCardBenefit[];
  loyaltyAccount?: DecisionLoyaltyAccount | null;
  loyaltyEligible: boolean;
  loyaltyRule?: DecisionLoyaltyRule | null;
  points: number;
  promotions: DecisionPromotion[];
}) {
  const pointValue = input.loyaltyAccount?.pointValue ?? 0;
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
    creditCardValue,
    effectiveCost: input.cashPrice + redemptionPointsValue - earnedPointsValue - promotionValue - creditCardValue,
    earnedPointsValue,
    promotionValue,
    redemptionPointsValue
  } satisfies CostBreakdown;
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
