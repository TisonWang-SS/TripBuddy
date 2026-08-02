import { describe, expect, it } from "vitest";
import {
  calculateStayCost,
  decideWithGuardrails,
  DeterministicRecommendationDecider,
  type DecisionInput,
  type RecommendationDecider
} from "@/lib/decision";

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
  breakfastValue: 25,
  eliteNightValue: 10,
  lateCheckoutValue: 15,
  loungeValue: 35,
  savingsThreshold: 50,
  upgradeValue: 40,
  urgentWindowHours: 24
};

function cost(cashPrice: number, points = 0) {
  return calculateStayCost({
    booking,
    breakfastIncluded: false,
    cashPrice,
    creditCards: [],
    loyaltyAccount: { hotelGroup: "Hyatt", pointValue: 0.01, tier: "Member" },
    loyaltyEligible: true,
    loyaltyRule: null,
    points,
    profile,
    promotions: []
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
    expect(cost(0, 25000).effectiveCost).toBe(230);
  });

  it("uses the best eligible payment card instead of stacking multiple cards", () => {
    const breakdown = calculateStayCost({
      booking,
      breakfastIncluded: false,
      cashPrice: 1000,
      creditCards: [
        { cashBackRate: 0.02, eliteNightCredits: 0, hotelGroup: null, pointMultiplier: 0 },
        { cashBackRate: 0, eliteNightCredits: 0, hotelGroup: "Hyatt", pointMultiplier: 4 }
      ],
      loyaltyAccount: { hotelGroup: "Hyatt", pointValue: 0.01, tier: "Member" },
      loyaltyEligible: true,
      loyaltyRule: null,
      points: 0,
      profile,
      promotions: []
    });
    expect(breakdown.creditCardValue).toBe(40);
  });

  it("recommends a safe direct candidate above threshold", async () => {
    const result = await decideWithGuardrails(new DeterministicRecommendationDecider(), input());
    expect(result).toMatchObject({ estimatedSavings: 200, verdict: "rebook_direct" });
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
