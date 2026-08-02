import { describe, expect, it } from "vitest";
import { buildObservationEvidence } from "@/lib/evidence";

const base = {
  bookingCurrency: "USD",
  bookingRoomType: "1 King Bed",
  cancellationPolicyRaw: "Cancel before arrival",
  cashCurrency: "USD",
  collectionMethod: "browser_companion" as const,
  conversionAvailable: true,
  feesIncluded: true,
  inventoryType: "cash" as const,
  loyaltyEligible: true,
  roomTypeRaw: "1 King Bed",
  sourceType: "direct" as const,
  sourceUrl: "https://www.hyatt.com/booking",
  taxesIncluded: true
};

describe("observation evidence", () => {
  it("keeps automated cancellation equivalence review-only", () => {
    const evidence = buildObservationEvidence(base);
    expect(evidence.qualityLevel).toBe("needs_review");
    expect(evidence.blockers).toContain("Cancellation-policy equivalence is unknown.");
  });

  it("records user overrides and produces high quality evidence", () => {
    const evidence = buildObservationEvidence({ ...base, overrides: { cancellationMatch: "same_or_better", roomMatch: "exact" } });
    expect(evidence.qualityLevel).toBe("high");
    expect(evidence.cancellationAssessmentSource).toBe("user");
  });

  it("does not mark omitted assessments as user corrections", () => {
    const evidence = buildObservationEvidence({
      ...base,
      overrides: { cancellationMatch: undefined, roomMatch: undefined }
    });
    expect(evidence.cancellationAssessmentSource).toBe("automated");
    expect(evidence.roomAssessmentSource).toBe("automated");
  });

  it("blocks an unconvertible observed currency", () => {
    const evidence = buildObservationEvidence({ ...base, cashCurrency: "MYR", conversionAvailable: false });
    expect(evidence.blockers.join(" ")).toContain("No conversion is available");
  });

  it("requires conversion for an award cash copay but not a pure points rate", () => {
    const purePoints = buildObservationEvidence({
      ...base,
      cashCurrency: "MYR",
      conversionAvailable: false,
      inventoryType: "award"
    });
    const pointsAndCash = buildObservationEvidence({
      ...base,
      cashCurrency: "MYR",
      conversionAvailable: false,
      hasCashComponent: true,
      inventoryType: "award"
    });
    expect(purePoints.currencyComparable).toBe(true);
    expect(pointsAndCash.currencyComparable).toBe(false);
  });
});
