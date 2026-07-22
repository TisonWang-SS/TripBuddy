import { describe, expect, it } from "vitest";
import { calculateStayCost, generateRecommendation, type DecisionBooking, type DecisionLoyaltyRule, type DecisionProfile } from "@/lib/decision";

const profile: DecisionProfile = {
  savingsThreshold: 50,
  urgentWindowHours: 24,
  breakfastValue: 20,
  loungeValue: 30,
  lateCheckoutValue: 10,
  upgradeValue: 25,
  eliteNightValue: 8
};

const booking: DecisionBooking = {
  id: "booking-1",
  hotelGroup: "Hyatt",
  hotelName: "Grand Hyatt Test",
  checkIn: new Date("2026-09-10T00:00:00.000Z"),
  checkOut: new Date("2026-09-13T00:00:00.000Z"),
  guests: 2,
  roomType: "King Room",
  originalPrice: 900,
  currency: "USD",
  bookingChannel: "direct",
  cancellationDeadline: new Date("2026-09-08T12:00:00.000Z"),
  breakfastIncluded: false,
  loyaltyEligible: true
};

const loyaltyAccount = {
  hotelGroup: "Hyatt",
  tier: "Globalist",
  pointValue: 0.017
};

const loyaltyRule: DecisionLoyaltyRule = {
  hotelGroup: "Hyatt",
  tier: "Globalist",
  basePointsPerUsd: 5,
  bonusRate: 0.3,
  breakfastBenefit: true,
  loungeBenefit: true,
  lateCheckoutBenefit: true,
  upgradeBenefit: true
};

describe("decision engine", () => {
  it("calculates loyalty bonus point value", () => {
    const cost = calculateStayCost({
      price: 1000,
      currency: "USD",
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      loyaltyEligible: true,
      breakfastIncluded: false
    });

    expect(cost.pointsValue).toBeCloseTo(110.5);
    expect(cost.effectiveCost).toBeLessThan(1000);
  });

  it("recommends direct rebooking when adjusted savings clear the threshold", () => {
    const decision = generateRecommendation({
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      now: new Date("2026-08-01T00:00:00.000Z"),
      observations: [
        {
          id: "obs-1",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
          sourceName: "Hyatt official site",
          sourceType: "direct",
          price: 720,
          currency: "USD",
          roomTypeRaw: "King Room",
          roomMatch: "exact",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: false,
          taxesIncluded: true,
          loyaltyEligible: true,
          confidence: 0.9
        }
      ]
    });

    expect(decision.verdict).toBe("rebook_direct");
    expect(decision.estimatedSavings).toBeGreaterThan(50);
  });

  it("treats OTA savings as a reference when loyalty is not eligible", () => {
    const decision = generateRecommendation({
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      now: new Date("2026-08-01T00:00:00.000Z"),
      observations: [
        {
          id: "obs-ota",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
          sourceName: "OTA",
          sourceType: "ota",
          price: 400,
          currency: "USD",
          roomTypeRaw: "King Room",
          roomMatch: "exact",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: false,
          taxesIncluded: true,
          loyaltyEligible: false,
          confidence: 0.75
        }
      ]
    });

    expect(decision.verdict).toBe("consider_ota");
  });

  it("marks the decision urgent near the cancellation deadline", () => {
    const decision = generateRecommendation({
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      now: new Date("2026-09-08T00:00:00.000Z"),
      observations: [
        {
          id: "obs-1",
          observedAt: new Date("2026-09-08T00:00:00.000Z"),
          sourceName: "Hyatt official site",
          sourceType: "direct",
          price: 850,
          currency: "USD",
          roomTypeRaw: "King Room",
          roomMatch: "exact",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: false,
          taxesIncluded: true,
          loyaltyEligible: true,
          confidence: 0.9
        }
      ]
    });

    expect(decision.verdict).toBe("urgent");
  });

  it("requires review when room matching is unknown", () => {
    const decision = generateRecommendation({
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      now: new Date("2026-08-01T00:00:00.000Z"),
      observations: [
        {
          id: "obs-1",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
          sourceName: "Hyatt official site",
          sourceType: "direct",
          price: 650,
          currency: "USD",
          roomTypeRaw: "Guest Room",
          roomMatch: "unknown",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: false,
          taxesIncluded: true,
          loyaltyEligible: true,
          confidence: 0.8
        }
      ]
    });

    expect(decision.verdict).toBe("needs_review");
  });

  it("requires review when taxes and fees are not included", () => {
    const decision = generateRecommendation({
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      now: new Date("2026-08-01T00:00:00.000Z"),
      observations: [
        {
          id: "obs-pretax",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
          sourceName: "Hyatt official site",
          sourceType: "direct",
          price: 650,
          currency: "USD",
          roomTypeRaw: "King Room",
          roomMatch: "exact",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: false,
          taxesIncluded: false,
          loyaltyEligible: true,
          confidence: 0.8
        }
      ]
    });

    expect(decision.verdict).toBe("needs_review");
    expect(decision.explanation).toContain("taxes");
  });

  it("chooses the best comparable candidate across imported room rates", () => {
    const decision = generateRecommendation({
      booking,
      profile,
      loyaltyAccount,
      loyaltyRule,
      creditCards: [],
      promotions: [],
      now: new Date("2026-08-01T00:00:00.000Z"),
      observations: [
        {
          id: "obs-latest",
          observedAt: new Date("2026-08-01T00:05:00.000Z"),
          sourceName: "Hyatt official site",
          sourceType: "direct",
          price: 880,
          currency: "USD",
          roomTypeRaw: "King Room",
          roomMatch: "exact",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: false,
          taxesIncluded: true,
          loyaltyEligible: true,
          confidence: 0.9
        },
        {
          id: "obs-best",
          observedAt: new Date("2026-08-01T00:00:00.000Z"),
          sourceName: "Hyatt official site",
          sourceType: "direct",
          price: 720,
          currency: "USD",
          roomTypeRaw: "King Room",
          roomMatch: "exact",
          cancellationPolicyRaw: "Free cancellation",
          cancellationMatch: "same_or_better",
          breakfastIncluded: true,
          taxesIncluded: true,
          loyaltyEligible: true,
          confidence: 0.9
        }
      ]
    });

    expect(decision.candidateObservationId).toBe("obs-best");
    expect(decision.verdict).toBe("rebook_direct");
  });
});
