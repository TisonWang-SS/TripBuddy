import { describe, expect, it } from "vitest";
import {
  parseRecommendationCostBreakdown,
  serializeRecommendationCostBreakdown
} from "@/lib/recommendationCodecs";

const cost = {
  cashPrice: 100,
  creditCardValue: 2,
  effectiveCost: 93,
  earnedPointsValue: 5,
  promotionValue: 0,
  redemptionPointsValue: 0
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
});
