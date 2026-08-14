import { describe, expect, it } from "vitest";
import {
  downgradeEvidenceQuality,
  effectiveUnitValue,
  isValuationStale,
  unconvertibleValuationWarning,
  validateValuationDraft,
  VALUATION_REVIEW_INTERVAL_DAYS,
  valuationReviewDueAt,
  type SourcedValuation
} from "@/lib/loyaltyValuation";

function valuation(overrides: Partial<SourcedValuation> = {}): SourcedValuation {
  return {
    amount: 300,
    asOf: new Date("2026-02-01T00:00:00Z"),
    currency: "USD",
    hotelGroup: "Hyatt",
    kind: "free_night",
    lastReviewedAt: new Date("2026-02-01T00:00:00Z"),
    realizationRate: 1,
    sourceName: "Points guy valuations",
    ...overrides
  };
}

describe("sourced loyalty valuations", () => {
  it("expires exactly one review interval after the last review", () => {
    const subject = valuation();
    const due = valuationReviewDueAt(subject);

    expect(due.toISOString()).toBe("2026-07-31T00:00:00.000Z");
    expect(isValuationStale(subject, new Date(due.getTime() - 1))).toBe(false);
    expect(isValuationStale(subject, new Date(due.getTime() + 1))).toBe(true);
    expect(VALUATION_REVIEW_INTERVAL_DAYS).toBe(180);
  });

  it("adjusts a quoted price by the realization rate rather than re-deriving it", () => {
    expect(effectiveUnitValue(valuation({ realizationRate: 1 }))).toBe(300);
    expect(effectiveUnitValue(valuation({ realizationRate: 0.6 }))).toBe(180);
  });

  it("refuses a realization rate above the market price it is meant to discount", () => {
    expect(() => validateValuationDraft(valuation({ realizationRate: 1.2 }))).toThrow("at most 1");
    expect(() => validateValuationDraft(valuation({ realizationRate: 0 }))).toThrow("greater than zero");
  });

  it("refuses a realization rate on points, which redeem at their value", () => {
    expect(() => validateValuationDraft(valuation({ kind: "point", realizationRate: 0.9 }))).toThrow(
      "applies to certificates, not to points"
    );
    expect(validateValuationDraft(valuation({ kind: "point", realizationRate: 1 })).realizationRate).toBe(1);
  });

  it("refuses a valuation with no amount or no source", () => {
    expect(() => validateValuationDraft(valuation({ amount: 0 }))).toThrow("greater than zero");
    expect(() => validateValuationDraft(valuation({ sourceName: "   " }))).toThrow("requires the source");
  });

  it("names an unconvertible valuation instead of applying an unrecorded rate", () => {
    expect(unconvertibleValuationWarning(valuation({ currency: "CNY" }), "USD")).toBe(
      "The Hyatt free-night award value (Points guy valuations, reviewed Feb 1, 2026) is recorded in CNY and no conversion to USD is on record, so it is not used."
    );
  });

  it("lowers confidence one level and never below the floor", () => {
    expect(downgradeEvidenceQuality("high")).toBe("medium");
    expect(downgradeEvidenceQuality("medium")).toBe("low");
    expect(downgradeEvidenceQuality("low")).toBe("low");
    expect(downgradeEvidenceQuality("needs_review")).toBe("needs_review");
  });
});
