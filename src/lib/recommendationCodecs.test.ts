import { describe, expect, it } from "vitest";
import {
  parseRecommendationCostBreakdown,
  serializeRecommendationCostBreakdown
} from "@/lib/recommendationCodecs";

const cost = {
  benefitValue: 0,
  cashPrice: 100,
  creditCardValue: 2,
  effectiveCost: 88,
  eliteProgressValue: 5,
  earnedPointsValue: 5,
  promotionValue: 0,
  redemptionPointsValue: 0
};

describe("recommendation JSON codecs", () => {
  it("round-trips finite cost breakdowns and rejects malformed legacy rows", () => {
    const value = { baseline: cost, candidate: { ...cost, cashPrice: 90 } };
    expect(parseRecommendationCostBreakdown(serializeRecommendationCostBreakdown(value))).toEqual(value);
    expect(parseRecommendationCostBreakdown('{"baseline":{"cashPrice":"100"}}')).toBeNull();
    expect(() => serializeRecommendationCostBreakdown({
      baseline: { ...cost, effectiveCost: Number.NaN },
      candidate: cost
    })).toThrow(/cost breakdown is invalid/);
  });
});
