import { describe, expect, it } from "vitest";
import { buildObservationEvidence } from "@/lib/evidence";

const base = {
  bookingCancellationDeadline: new Date(2026, 8, 8),
  bookingCheckIn: new Date("2026-09-10T00:00:00.000Z"),
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
  it("keeps a policy without an explicit cutoff review-only", () => {
    const evidence = buildObservationEvidence(base);
    expect(evidence.qualityLevel).toBe("needs_review");
    expect(evidence.blockers).toContain("Cancellation-policy equivalence is unknown.");
  });

  it("accepts an explicit cutoff on or after the current booking cutoff", () => {
    const sameDay = buildObservationEvidence({
      ...base,
      cancellationPolicyRaw: "Cancellation Policy Free cancellation before Sep 8, 2026"
    });
    const later = buildObservationEvidence({
      ...base,
      cancellationPolicyRaw: "Cancel by 2026-09-09"
    });

    expect(sameDay).toMatchObject({
      cancellationAssessmentSource: "automated",
      cancellationMatch: "same_or_better",
      qualityLevel: "high"
    });
    expect(later.cancellationMatch).toBe("same_or_better");
  });

  it("compares Hyatt relative arrival cutoffs deterministically", () => {
    const evidence = buildObservationEvidence({
      ...base,
      cancellationPolicyRaw: "Cancellation Policy 11:59PM HOTEL TIME 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE"
    });

    expect(evidence).toMatchObject({ cancellationMatch: "same_or_better", qualityLevel: "high" });
    expect(evidence.cancellationMatchReason).toContain("2026-09-08");
  });

  it("warns without blocking an earlier cutoff or an explicitly non-refundable rate", () => {
    const earlier = buildObservationEvidence({
      ...base,
      cancellationPolicyRaw: "Cancellation Policy 3 days before arrival"
    });
    const nonRefundable = buildObservationEvidence({
      ...base,
      cancellationPolicyRaw: "Cancellation Policy FULL PREPAYMENT/NO REFUND/NO CHANGES"
    });

    expect(earlier).toMatchObject({ blockers: [], cancellationMatch: "worse", qualityLevel: "medium" });
    expect(earlier.warnings).toContain("The candidate has a weaker cancellation policy.");
    expect(nonRefundable).toMatchObject({ blockers: [], cancellationMatch: "worse", qualityLevel: "medium" });
    expect(nonRefundable.warnings).toContain("The candidate has a weaker cancellation policy.");
  });

  it("does not infer equivalence without the current booking cutoff", () => {
    const evidence = buildObservationEvidence({
      ...base,
      bookingCancellationDeadline: null,
      cancellationPolicyRaw: "Free cancellation before Sep 8, 2026"
    });

    expect(evidence.cancellationMatch).toBe("unknown");
    expect(evidence.cancellationMatchReason).toContain("current booking has no cancellation deadline");
  });

  it("does not mistake a later stay date for an absolute cancellation cutoff", () => {
    const evidence = buildObservationEvidence({
      ...base,
      cancellationPolicyRaw: "Free cancellation before arrival for stays beginning Sep 8, 2026"
    });

    expect(evidence.cancellationMatch).toBe("unknown");
  });

  it("compares the current cutoff by its local calendar day", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const evidence = buildObservationEvidence({
        ...base,
        bookingCancellationDeadline: new Date("2026-09-09T03:00:00.000Z"),
        cancellationPolicyRaw: "Free cancellation before Sep 8, 2026"
      });

      expect(evidence.cancellationMatch).toBe("same_or_better");
      expect(evidence.cancellationMatchReason).toContain("current booking cutoff (2026-09-08)");
    } finally {
      if (previousTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = previousTimezone;
      }
    }
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

  it("uses provider-supplied login state only for direct Browser Companion evidence", () => {
    expect(buildObservationEvidence({ ...base, loginState: "member" }).loginState).toBe("member");
    expect(buildObservationEvidence({ ...base, loginState: "anonymous" }).loginState).toBe("anonymous");
    expect(buildObservationEvidence({ ...base, loginState: "unknown" }).loginState).toBe("unknown");
    expect(buildObservationEvidence({ ...base, collectionMethod: "manual" }).loginState).toBe("unknown");
    expect(buildObservationEvidence({ ...base, loginState: "member", sourceType: "ota" }).loginState).toBe("not_required");
  });
});
