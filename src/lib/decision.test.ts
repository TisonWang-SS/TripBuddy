import { describe, expect, it } from "vitest";
import {
  calculateStayCost,
  decideWithGuardrails,
  DeterministicRecommendationDecider,
  entitlementLossWarnings,
  type DecisionInput,
  type RecommendationDecider,
  unconfirmedPromotionWarnings,
  valuationIssues
} from "@/lib/decision";
import type { SourcedValuation } from "@/lib/loyaltyValuation";

const NOW = new Date("2026-08-13T00:00:00Z");

function valuation(overrides: Partial<SourcedValuation> = {}): SourcedValuation {
  return {
    amount: 0.01,
    asOf: new Date("2026-07-01T00:00:00Z"),
    currency: "USD",
    hotelGroup: "Hyatt",
    kind: "point",
    lastReviewedAt: new Date("2026-07-01T00:00:00Z"),
    realizationRate: 1,
    sourceName: "Points guy valuations",
    ...overrides
  };
}

const booking = {
  baselineCashTotal: 1000,
  baselinePoints: null,
  baselineType: "cash" as const,
  bookingChannel: "direct" as const,
  breakfastIncluded: false,
  cancellationDeadline: null,
  checkIn: new Date("2026-09-10T00:00:00Z"),
  checkOut: new Date("2026-09-12T00:00:00Z"),
  currency: "USD",
  guests: 2,
  hotelGroup: "Hyatt",
  hotelName: "Grand Hyatt Tokyo",
  id: "booking-1",
  loyaltyEligible: true,
  roomType: "King Room"
};
const profile = {
  caresAboutBreakfast: true,
  caresAboutLateCheckout: true,
  caresAboutLounge: true,
  caresAboutUpgrade: true,
  savingsThreshold: 50,
  urgentWindowHours: 24
};

function cost(cashPrice: number, points = 0) {
  return calculateStayCost({
    booking,
    cashPrice,
    creditCards: [],
    loyaltyEligible: true,
    loyaltyRule: null,
    points,
    promotions: [],
    valuations: [valuation()]
  });
}

function input(blockers: string[] = []): DecisionInput {
  return {
    baselineCost: cost(1000),
    booking,
    candidates: [{
      blockers,
      breakfastIncluded: false,
      cashTotal: 800,
      cost: cost(800),
      id: "candidate-1",
      loyaltyEligible: true,
      qualityLevel: blockers.length ? "needs_review" : "high",
      roomType: "King Room",
      sourceType: "direct",
      warnings: []
    }],
    profile
  };
}

describe("decision boundary", () => {
  it("values points redemption deterministically", () => {
    expect(cost(0, 25000).redemptionPointsValue).toBe(250);
    expect(cost(0, 25000).effectiveCost).toBe(250);
  });

  it("prices a spent certificate at its quoted value adjusted by the realization rate", () => {
    const breakdown = calculateStayCost({
      booking,
      cashPrice: 0,
      certificate: { count: 2, kind: "free_night" },
      creditCards: [],
      loyaltyEligible: true,
      loyaltyRule: null,
      points: 0,
      promotions: [],
      valuations: [valuation({ amount: 300, kind: "free_night", realizationRate: 0.8 })]
    });

    expect(breakdown.certificateValue).toBe(480);
    expect(breakdown.effectiveCost).toBe(480);
  });

  it("blocks a stay that spends an unpriced figure and only warns about an unpriced one it earns", () => {
    const spending = valuationIssues({
      certificate: { count: 1, kind: "free_night" },
      earnsPoints: true,
      hotelGroup: "Hyatt",
      now: NOW,
      points: 25000,
      valuations: []
    });
    const earning = valuationIssues({
      earnsPoints: true,
      hotelGroup: "Hyatt",
      now: NOW,
      points: 0,
      valuations: []
    });

    expect(spending.blockers).toEqual([
      "No Hyatt point value is recorded, so this stay cannot be priced.",
      "No Hyatt free-night award value is recorded, so this stay cannot be priced."
    ]);
    expect(earning.blockers).toEqual([]);
    expect(earning.warnings).toEqual([
      "No Hyatt point value is recorded, so the points this stay earns are not priced."
    ]);
  });

  it("blocks a nightly points rate from being priced as if it covered the stay", () => {
    const nightly = valuationIssues({
      earnsPoints: false,
      hotelGroup: "Hyatt",
      now: NOW,
      points: 12_000,
      pointsBasis: "per_night",
      valuations: [valuation()]
    });
    const unknown = valuationIssues({
      earnsPoints: false,
      hotelGroup: "Hyatt",
      now: NOW,
      points: 12_000,
      pointsBasis: "unknown",
      valuations: [valuation()]
    });
    const wholeStay = valuationIssues({
      earnsPoints: false,
      hotelGroup: "Hyatt",
      now: NOW,
      points: 24_000,
      pointsBasis: "stay_total",
      valuations: [valuation()]
    });

    expect(nightly.blockers).toEqual([
      "The points rate covers one night rather than the stay, so it cannot be compared with a stay total."
    ]);
    expect(unknown.blockers).toEqual(["The points rate does not show whether it covers the stay or one night."]);
    expect(wholeStay.blockers).toEqual([]);
  });

  it("keeps using a valuation past its review date and names it as stale", () => {
    const stale = valuation({ lastReviewedAt: new Date("2026-01-01T00:00:00Z") });
    const breakdown = calculateStayCost({
      booking,
      cashPrice: 0,
      creditCards: [],
      loyaltyEligible: true,
      loyaltyRule: null,
      points: 25000,
      promotions: [],
      valuations: [stale]
    });
    const issues = valuationIssues({
      earnsPoints: false,
      hotelGroup: "Hyatt",
      now: NOW,
      points: 25000,
      valuations: [stale]
    });

    expect(breakdown.redemptionPointsValue).toBe(250);
    expect(issues.blockers).toEqual([]);
    expect(issues.stale).toBe(true);
    expect(issues.warnings).toEqual([
      "The Hyatt point value (Points guy valuations, reviewed Jan 1, 2026) is past its 180-day review date and was used as recorded."
    ]);
  });

  it("uses the best eligible payment card instead of stacking multiple cards", () => {
    const breakdown = calculateStayCost({
      booking,
      cashPrice: 1000,
      creditCards: [
        { cashBackRate: 0.02, hotelGroup: null, pointMultiplier: 0 },
        { cashBackRate: 0, hotelGroup: "Hyatt", pointMultiplier: 4 }
      ],
      loyaltyEligible: true,
      loyaltyRule: null,
      points: 0,
      promotions: [],
      valuations: [valuation()]
    });
    expect(breakdown.creditCardValue).toBe(40);
  });

  it("shows entitlement loss as a warning without moving effective cost", () => {
    const loyaltyRule = {
      basePointsPerUsd: 5,
      bonusRate: 0,
      breakfastBenefit: true,
      hotelGroup: "Hyatt",
      lateCheckoutBenefit: true,
      loungeBenefit: true,
      tier: "Globalist",
      upgradeBenefit: true
    };
    const baselineCost = calculateStayCost({
      booking,
      cashPrice: 1000,
      creditCards: [],
      loyaltyEligible: true,
      loyaltyRule,
      points: 0,
      promotions: [],
      valuations: [valuation()]
    });
    const candidateCost = calculateStayCost({
      booking,
      cashPrice: 1000,
      creditCards: [],
      loyaltyEligible: false,
      loyaltyRule,
      points: 0,
      promotions: [],
      valuations: [valuation()]
    });
    const warnings = entitlementLossWarnings({
      baseline: { breakfastIncluded: false, loyaltyEligible: true, loyaltyRule },
      candidate: { breakfastIncluded: false, loyaltyEligible: false, loyaltyRule },
      profile
    });

    expect(warnings).toEqual([
      "The candidate drops breakfast available with the current booking.",
      "The candidate drops lounge access available with the current booking.",
      "The candidate drops late checkout available with the current booking.",
      "The candidate drops room upgrades available with the current booking."
    ]);
    expect(baselineCost).not.toHaveProperty("benefitValue");
    expect(baselineCost).not.toHaveProperty("eliteProgressValue");
    expect(baselineCost.effectiveCost).toBe(950);
    expect(candidateCost.effectiveCost).toBe(1000);
  });

  it("lets a traveler suppress an entitlement warning without changing either cost", () => {
    const loyaltyRule = {
      basePointsPerUsd: 0,
      bonusRate: 0,
      breakfastBenefit: true,
      hotelGroup: "Hyatt",
      lateCheckoutBenefit: false,
      loungeBenefit: false,
      tier: "Globalist",
      upgradeBenefit: false
    };
    const warnings = entitlementLossWarnings({
      baseline: { breakfastIncluded: false, loyaltyEligible: true, loyaltyRule },
      candidate: { breakfastIncluded: false, loyaltyEligible: false, loyaltyRule },
      profile: { ...profile, caresAboutBreakfast: false }
    });
    const baselineCost = calculateStayCost({
      booking,
      cashPrice: 1000,
      creditCards: [],
      loyaltyEligible: true,
      loyaltyRule,
      points: 0,
      promotions: [],
      valuations: []
    });
    const candidateCost = calculateStayCost({
      booking,
      cashPrice: 1000,
      creditCards: [],
      loyaltyEligible: false,
      loyaltyRule,
      points: 0,
      promotions: [],
      valuations: []
    });

    expect(warnings).toEqual([]);
    expect(candidateCost.effectiveCost).toBe(baselineCost.effectiveCost);
  });

  it("excludes registration-gated promotions and names the omission", () => {
    const promotion = {
      appliesToExistingBookings: true,
      bonusMultiplier: 0,
      endDate: null,
      flatValue: 100,
      hotelGroup: "Hyatt",
      requiresRegistration: true,
      startDate: null,
      title: "Double Your Stay"
    };
    const breakdown = calculateStayCost({
      booking,
      cashPrice: 1000,
      creditCards: [],
      loyaltyEligible: true,
      loyaltyRule: null,
      points: 0,
      promotions: [promotion],
      valuations: []
    });

    expect(breakdown.promotionValue).toBe(0);
    expect(breakdown.effectiveCost).toBe(1000);
    expect(unconfirmedPromotionWarnings({ booking, loyaltyEligible: true, promotions: [promotion] })).toEqual([
      "Promotion “Double Your Stay” requires registration and is excluded until registration can be confirmed."
    ]);
  });

  it("recommends a safe direct candidate above threshold", async () => {
    const result = await decideWithGuardrails(new DeterministicRecommendationDecider(), input());
    expect(result).toMatchObject({ estimatedSavings: 200, verdict: "rebook_direct" });
  });

  it("allows a direct candidate with a weaker-cancellation warning", async () => {
    const decisionInput = input();
    decisionInput.candidates[0].qualityLevel = "medium";
    decisionInput.candidates[0].warnings = ["The candidate has a weaker cancellation policy."];

    const result = await decideWithGuardrails(new DeterministicRecommendationDecider(), decisionInput);

    expect(result).toMatchObject({ estimatedSavings: 200, riskLevel: "medium", verdict: "rebook_direct" });
  });

  it("forces a future decider through deterministic blockers", async () => {
    const unsafeDecider: RecommendationDecider = {
      name: "future-llm",
      version: "1",
      async decide() {
        return { candidateObservationId: "candidate-1", estimatedSavings: 200, explanation: "Rebook", riskLevel: "low", verdict: "rebook_direct" };
      }
    };
    const result = await decideWithGuardrails(unsafeDecider, input(["Cancellation-policy equivalence is unknown."]));
    expect(result.verdict).toBe("needs_review");
    expect(result.riskLevel).toBe("high");
  });

  it("replaces provider savings with the deterministic cost result", async () => {
    const decider: RecommendationDecider = {
      name: "future-llm",
      version: "1",
      async decide() {
        return { candidateObservationId: "candidate-1", estimatedSavings: 999999, explanation: "Keep", riskLevel: "low", verdict: "keep" };
      }
    };
    expect((await decideWithGuardrails(decider, input())).estimatedSavings).toBe(200);
  });

  it("rejects a decision provider output that fails runtime validation", async () => {
    const decider = {
      name: "broken-provider",
      version: "1",
      async decide() {
        return { candidateObservationId: "candidate-1", estimatedSavings: Number.NaN, explanation: "", riskLevel: "impossible", verdict: "book" };
      }
    } as unknown as RecommendationDecider;
    await expect(decideWithGuardrails(decider, input())).rejects.toThrow("invalid decision output");
  });
});
