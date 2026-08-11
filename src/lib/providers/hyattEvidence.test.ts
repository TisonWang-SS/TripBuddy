import { describe, expect, it } from "vitest";
import { evaluateTextEvidenceExtractor } from "@/lib/providers/extractionEvaluation";
import { hyattEvidenceFixtures } from "@/lib/providers/hyattEvidence.fixtures";
import { normalizeBrowserEvidencePayload, parseHyattEvidenceFromText } from "@/lib/providers/hyattEvidence";
import baseline from "../../../docs/evals/hyatt-evidence-deterministic-baseline.json";

describe("Hyatt evidence extraction", () => {
  it("scores the deterministic extractor against the shared fixture set", () => {
    const report = evaluateTextEvidenceExtractor(hyattEvidenceFixtures, parseHyattEvidenceFromText);

    expect(report.failures).toEqual([]);
    expect(report.fixtures).toEqual({ passed: hyattEvidenceFixtures.length, total: hyattEvidenceFixtures.length });
    expect(report.assertions.passed).toBe(report.assertions.total);
    expect(report.score).toBe(1);
    expect(report).toMatchObject({
      assertions: baseline.assertions,
      fixtures: baseline.fixtures,
      score: baseline.score
    });
  });

  it("normalizes breakfast-included candidate payloads", () => {
    const normalized = normalizeBrowserEvidencePayload({
      bookingId: "booking_1",
      candidates: [
        {
          breakfastIncluded: true,
          currency: "MYR",
          ratePlanName: "Bed and Breakfast",
          roomTypeRaw: "Family Suite",
          totalPrice: 4480
        }
      ]
    });

    expect(normalized.candidates[0]).toMatchObject({
      breakfastIncluded: true,
      roomTypeRaw: "Family Suite"
    });
  });

  it("normalizes extension payload candidates", () => {
    const normalized = normalizeBrowserEvidencePayload({
      bookingId: "booking_1",
      candidates: [
        {
          currency: "MYR",
          inventoryType: "award",
          pointsPrice: 35000,
          roomTypeRaw: "Standard King Room"
        }
      ],
      pageText: "35,000 points Avg/Night",
      sourceUrl: "https://www.hyatt.com/en-US/shop/rooms/kulzk"
    });

    expect(normalized.candidates[0]).toMatchObject({
      currency: "MYR",
      inventoryType: "award",
      pointsPrice: 35000,
      totalPrice: null
    });
  });
});
