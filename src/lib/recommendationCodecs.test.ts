import { describe, expect, it } from "vitest";
import {
  parseRecommendationCostBreakdown,
  serializeRecommendationCostBreakdown
} from "@/lib/recommendationCodecs";
import type { RedemptionComparison } from "@/lib/redemptionComparison";

const cost = {
  cashPrice: 100,
  certificateValue: 0,
  creditCardValue: 2,
  effectiveCost: 93,
  earnedPointsValue: 5,
  promotionValue: 0,
  redemptionPointsValue: 0
};

const redemption: RedemptionComparison = {
  captureId: "run-1",
  cashTotal: 500,
  copay: 0,
  currency: "USD",
  points: 25_000,
  pointValue: 0.017,
  reason: null,
  roomLabel: "1 King Bed",
  valuePerPoint: 0.02,
  verdict: "redeem"
};

describe("recommendation JSON codecs", () => {
  it("round-trips current finite cost breakdowns and rejects malformed rows", () => {
    const value = { baseline: cost, candidate: { ...cost, cashPrice: 90 } };
    expect(parseRecommendationCostBreakdown(serializeRecommendationCostBreakdown(value))).toEqual(value);
    expect(parseRecommendationCostBreakdown('{"baseline":{"cashPrice":"100"}}')).toBeNull();
    expect(() => serializeRecommendationCostBreakdown({
      baseline: { ...cost, effectiveCost: Number.NaN },
      candidate: cost
    })).toThrow(/cost breakdown is invalid/);
  });

  it("reads historical composition without allowing new snapshots to write it", () => {
    const legacyCost = { ...cost, benefitValue: 25, eliteProgressValue: 10 };
    const legacy = { baseline: legacyCost, candidate: { ...legacyCost, cashPrice: 90 } };

    expect(parseRecommendationCostBreakdown(JSON.stringify(legacy))).toEqual(legacy);
    expect(() => serializeRecommendationCostBreakdown(legacy)).toThrow(/cost breakdown is invalid/);
  });

  it("still reads a snapshot written before certificates were priced, and requires the component now", () => {
    const beforeCertificates = { ...cost };
    delete (beforeCertificates as Partial<typeof cost>).certificateValue;
    const older = { baseline: beforeCertificates, candidate: beforeCertificates };

    expect(parseRecommendationCostBreakdown(JSON.stringify(older))).toEqual(older);
    expect(() =>
      serializeRecommendationCostBreakdown(older as unknown as { baseline: typeof cost; candidate: typeof cost })
    ).toThrow(/cost breakdown is invalid/);
  });

  it("round-trips a redemption comparison and drops a malformed one rather than the whole snapshot", () => {
    const value = { baseline: cost, candidate: cost, redemption };
    expect(parseRecommendationCostBreakdown(serializeRecommendationCostBreakdown(value))).toEqual(value);
    expect(
      parseRecommendationCostBreakdown(JSON.stringify({ baseline: cost, candidate: cost, redemption: { verdict: "guess" } }))
    ).toEqual({ baseline: cost, candidate: cost });
    expect(() =>
      serializeRecommendationCostBreakdown({
        baseline: cost,
        candidate: cost,
        redemption: { ...redemption, valuePerPoint: Number.POSITIVE_INFINITY }
      })
    ).toThrow(/redemption comparison is invalid/);
  });
});
