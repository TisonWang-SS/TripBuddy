import { nightsBetween } from "@/lib/format";

export type Verdict = "keep" | "rebook_direct" | "consider_ota" | "needs_review" | "urgent";

export type DecisionProfile = {
  savingsThreshold: number;
  urgentWindowHours: number;
  breakfastValue: number;
  loungeValue: number;
  lateCheckoutValue: number;
  upgradeValue: number;
  eliteNightValue: number;
};

export type DecisionBooking = {
  id: string;
  hotelGroup: string;
  hotelName: string;
  checkIn: Date;
  checkOut: Date;
  roomType: string;
  originalPrice: number;
  currency: string;
  bookingChannel: string;
  cancellationDeadline: Date | null;
  breakfastIncluded: boolean;
  loyaltyEligible: boolean;
};

export type DecisionObservation = {
  id: string;
  observedAt: Date;
  sourceName: string;
  sourceType: string;
  price: number;
  currency: string;
  roomTypeRaw: string;
  roomMatch: string;
  cancellationPolicyRaw: string;
  cancellationMatch: string;
  breakfastIncluded: boolean;
  taxesIncluded: boolean;
  loyaltyEligible: boolean;
  confidence: number;
};

export type DecisionLoyaltyAccount = {
  hotelGroup: string;
  tier: string;
  pointValue: number;
};

export type DecisionLoyaltyRule = {
  hotelGroup: string;
  tier: string;
  basePointsPerUsd: number;
  bonusRate: number;
  breakfastBenefit: boolean;
  loungeBenefit: boolean;
  lateCheckoutBenefit: boolean;
  upgradeBenefit: boolean;
};

export type DecisionCreditCardBenefit = {
  hotelGroup: string | null;
  cashBackRate: number;
  pointMultiplier: number;
  eliteNightCredits: number;
};

export type DecisionPromotion = {
  hotelGroup: string;
  startDate: Date | null;
  endDate: Date | null;
  bonusMultiplier: number;
  flatValue: number;
  appliesToExistingBookings: boolean;
};

export type CostBreakdown = {
  cashPrice: number;
  pointsValue: number;
  promotionValue: number;
  creditCardValue: number;
  eliteProgressValue: number;
  benefitValue: number;
  effectiveCost: number;
};

export type DecisionResult = {
  verdict: Verdict;
  estimatedSavings: number;
  confidence: number;
  cashDifference: number;
  pointsValueDifference: number;
  promotionValueDifference: number;
  creditCardValueDifference: number;
  eliteProgressDifference: number;
  benefitValueDifference: number;
  explanation: string;
  originalCost: CostBreakdown;
  candidateCost: CostBreakdown | null;
  candidateObservationId: string | null;
};

export function calculateStayCost(input: {
  price: number;
  currency: string;
  booking: DecisionBooking;
  profile: DecisionProfile;
  loyaltyAccount?: DecisionLoyaltyAccount | null;
  loyaltyRule?: DecisionLoyaltyRule | null;
  creditCards: DecisionCreditCardBenefit[];
  promotions: DecisionPromotion[];
  loyaltyEligible: boolean;
  breakfastIncluded: boolean;
}) {
  const nights = nightsBetween(input.booking.checkIn, input.booking.checkOut);
  const eligible = input.loyaltyEligible;
  const pointValue = input.loyaltyAccount?.pointValue ?? 0;
  const basePoints = input.loyaltyRule?.basePointsPerUsd ?? 0;
  const bonusRate = input.loyaltyRule?.bonusRate ?? 0;
  const pointsValue = eligible ? input.price * basePoints * (1 + bonusRate) * pointValue : 0;

  const activePromotions = input.promotions.filter((promotion) => {
    if (promotion.hotelGroup !== input.booking.hotelGroup) {
      return false;
    }
    if (promotion.startDate && promotion.startDate > input.booking.checkOut) {
      return false;
    }
    if (promotion.endDate && promotion.endDate < input.booking.checkIn) {
      return false;
    }
    return eligible;
  });

  const promotionValue = activePromotions.reduce((total, promotion) => {
    const bonusPoints = input.price * basePoints * promotion.bonusMultiplier;
    return total + bonusPoints * pointValue + promotion.flatValue;
  }, 0);

  const creditCardValue = input.creditCards
    .filter((card) => !card.hotelGroup || card.hotelGroup === input.booking.hotelGroup)
    .reduce((total, card) => total + input.price * card.cashBackRate + input.price * card.pointMultiplier * pointValue, 0);

  const eliteProgressValue = eligible ? nights * input.profile.eliteNightValue : 0;

  const benefitValue =
    (input.breakfastIncluded || (eligible && input.loyaltyRule?.breakfastBenefit) ? input.profile.breakfastValue * nights : 0) +
    (eligible && input.loyaltyRule?.loungeBenefit ? input.profile.loungeValue * nights : 0) +
    (eligible && input.loyaltyRule?.lateCheckoutBenefit ? input.profile.lateCheckoutValue : 0) +
    (eligible && input.loyaltyRule?.upgradeBenefit ? input.profile.upgradeValue * nights : 0);

  const effectiveCost = input.price - pointsValue - promotionValue - creditCardValue - eliteProgressValue - benefitValue;

  return {
    cashPrice: input.price,
    pointsValue,
    promotionValue,
    creditCardValue,
    eliteProgressValue,
    benefitValue,
    effectiveCost
  };
}

export function generateRecommendation(input: {
  booking: DecisionBooking;
  observations: DecisionObservation[];
  profile: DecisionProfile;
  loyaltyAccount?: DecisionLoyaltyAccount | null;
  loyaltyRule?: DecisionLoyaltyRule | null;
  creditCards: DecisionCreditCardBenefit[];
  promotions: DecisionPromotion[];
  now?: Date;
}): DecisionResult {
  const now = input.now ?? new Date();
  const originalCost = calculateStayCost({
    price: input.booking.originalPrice,
    currency: input.booking.currency,
    booking: input.booking,
    profile: input.profile,
    loyaltyAccount: input.loyaltyAccount,
    loyaltyRule: input.loyaltyRule,
    creditCards: input.creditCards,
    promotions: input.promotions.filter((promotion) => promotion.appliesToExistingBookings),
    loyaltyEligible: input.booking.loyaltyEligible,
    breakfastIncluded: input.booking.breakfastIncluded
  });

  const sortedObservations = [...input.observations].sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime());
  const direct = sortedObservations.find((observation) => observation.sourceType === "direct");
  const ota = sortedObservations.find((observation) => observation.sourceType === "ota");
  const candidate = direct ?? ota ?? null;

  if (!candidate) {
    return buildResult({
      verdict: "needs_review",
      originalCost,
      candidateCost: null,
      candidateObservationId: null,
      estimatedSavings: 0,
      confidence: 0.4,
      explanation: "Add a direct or OTA price observation to generate a recommendation."
    });
  }

  const candidateCost = calculateStayCost({
    price: candidate.price,
    currency: candidate.currency,
    booking: input.booking,
    profile: input.profile,
    loyaltyAccount: input.loyaltyAccount,
    loyaltyRule: input.loyaltyRule,
    creditCards: input.creditCards,
    promotions: input.promotions,
    loyaltyEligible: candidate.loyaltyEligible,
    breakfastIncluded: candidate.breakfastIncluded
  });

  const estimatedSavings = originalCost.effectiveCost - candidateCost.effectiveCost;
  const hoursToDeadline = input.booking.cancellationDeadline
    ? (input.booking.cancellationDeadline.getTime() - now.getTime()) / (1000 * 60 * 60)
    : Number.POSITIVE_INFINITY;

  if (hoursToDeadline >= 0 && hoursToDeadline <= input.profile.urgentWindowHours) {
    return buildResult({
      verdict: "urgent",
      originalCost,
      candidateCost,
      candidateObservationId: candidate.id,
      estimatedSavings,
      confidence: Math.min(candidate.confidence, 0.85),
      explanation: "The free cancellation deadline is close. Review the latest price before the window closes."
    });
  }

  if (candidate.roomMatch === "unknown" || candidate.cancellationMatch === "unknown") {
    return buildResult({
      verdict: "needs_review",
      originalCost,
      candidateCost,
      candidateObservationId: candidate.id,
      estimatedSavings,
      confidence: Math.min(candidate.confidence, 0.6),
      explanation: "The room type or cancellation policy is not clear enough for an automatic recommendation."
    });
  }

  if (!candidate.taxesIncluded || candidate.currency !== input.booking.currency) {
    return buildResult({
      verdict: "needs_review",
      originalCost,
      candidateCost,
      candidateObservationId: candidate.id,
      estimatedSavings,
      confidence: Math.min(candidate.confidence, 0.6),
      explanation: "The observed price is not comparable enough because taxes, fees, or currency are unclear."
    });
  }

  if (candidate.cancellationMatch === "worse") {
    return buildResult({
      verdict: "keep",
      originalCost,
      candidateCost,
      candidateObservationId: candidate.id,
      estimatedSavings,
      confidence: Math.min(candidate.confidence, 0.75),
      explanation: "The observed price has a weaker cancellation policy, so keeping the current booking is safer."
    });
  }

  if (candidate.sourceType === "ota" && !candidate.loyaltyEligible && estimatedSavings >= input.profile.savingsThreshold) {
    return buildResult({
      verdict: "consider_ota",
      originalCost,
      candidateCost,
      candidateObservationId: candidate.id,
      estimatedSavings,
      confidence: Math.min(candidate.confidence, 0.7),
      explanation: "The OTA price may save money, but it can reduce or remove loyalty credit and elite benefits."
    });
  }

  if (candidate.sourceType === "direct" && estimatedSavings >= input.profile.savingsThreshold) {
    return buildResult({
      verdict: "rebook_direct",
      originalCost,
      candidateCost,
      candidateObservationId: candidate.id,
      estimatedSavings,
      confidence: Math.min(candidate.confidence, 0.9),
      explanation: "The direct price appears meaningfully better after loyalty and benefit adjustments."
    });
  }

  return buildResult({
    verdict: "keep",
    originalCost,
    candidateCost,
    candidateObservationId: candidate.id,
    estimatedSavings,
    confidence: Math.min(candidate.confidence, 0.85),
    explanation: "The observed price does not clear your savings threshold after adjustments."
  });
}

function buildResult(input: {
  verdict: Verdict;
  originalCost: CostBreakdown;
  candidateCost: CostBreakdown | null;
  candidateObservationId: string | null;
  estimatedSavings: number;
  confidence: number;
  explanation: string;
}): DecisionResult {
  const candidate = input.candidateCost;

  return {
    verdict: input.verdict,
    estimatedSavings: input.estimatedSavings,
    confidence: input.confidence,
    cashDifference: input.originalCost.cashPrice - (candidate?.cashPrice ?? input.originalCost.cashPrice),
    pointsValueDifference: (candidate?.pointsValue ?? 0) - input.originalCost.pointsValue,
    promotionValueDifference: (candidate?.promotionValue ?? 0) - input.originalCost.promotionValue,
    creditCardValueDifference: (candidate?.creditCardValue ?? 0) - input.originalCost.creditCardValue,
    eliteProgressDifference: (candidate?.eliteProgressValue ?? 0) - input.originalCost.eliteProgressValue,
    benefitValueDifference: (candidate?.benefitValue ?? 0) - input.originalCost.benefitValue,
    explanation: input.explanation,
    originalCost: input.originalCost,
    candidateCost: input.candidateCost,
    candidateObservationId: input.candidateObservationId
  };
}
