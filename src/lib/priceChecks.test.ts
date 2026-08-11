import { describe, expect, it } from "vitest";
import { mergeObservationCandidates } from "@/lib/priceChecks";
import type { ParsedObservationDraft } from "@/lib/providers/types";

function cashCandidate(index: number): ParsedObservationDraft {
  return {
    breakfastIncluded: null,
    cancellationPolicyRaw: null,
    cashBase: index,
    cashCopay: null,
    cashCurrency: "USD",
    cashFees: null,
    cashTaxes: null,
    cashTotal: 100 + index,
    feesIncluded: null,
    inventoryType: "cash",
    loyaltyEligible: null,
    points: null,
    ratePlanName: `Rate ${index}`,
    rawRateName: null,
    roomTypeRaw: `Room ${index}`,
    sourceUrl: "https://www.hyatt.com/",
    taxesIncluded: null
  };
}

describe("price-check candidate retention", () => {
  it("reports truncation while retaining the first 24 distinct candidates", () => {
    const merged = mergeObservationCandidates([], Array.from({ length: 25 }, (_, index) => cashCandidate(index)));

    expect(merged.candidates).toHaveLength(24);
    expect(merged.candidates.at(-1)?.ratePlanName).toBe("Rate 23");
    expect(merged.truncated).toBe(true);
  });

  it("deduplicates without reporting truncation", () => {
    const candidate = cashCandidate(1);
    const merged = mergeObservationCandidates([candidate], [candidate]);

    expect(merged).toEqual({ candidates: [candidate], truncated: false });
  });
});
