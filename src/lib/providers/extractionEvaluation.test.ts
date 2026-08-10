import { describe, expect, it } from "vitest";
import {
  evaluateTextEvidenceExtractor,
  type ExtractionFixture
} from "@/lib/providers/extractionEvaluation";

describe("text evidence extractor evaluation", () => {
  it("reports a field-level score and actionable failures", () => {
    const fixtures = [{
      candidateCount: 1,
      expectedCandidates: [{ fields: { currency: "USD", totalPrice: 100 } }],
      id: "sample",
      pageText: "sample page",
      sourceUrl: "https://example.com"
    }] satisfies readonly ExtractionFixture<{ currency: string; totalPrice: number }>[];

    const report = evaluateTextEvidenceExtractor(fixtures, () => [{ currency: "USD", totalPrice: 90 }]);

    expect(report).toMatchObject({
      assertions: { passed: 2, total: 3 },
      fixtures: { passed: 0, total: 1 },
      score: 2 / 3
    });
    expect(report.failures).toEqual([
      "sample candidate 1: expected totalPrice=100, received 90."
    ]);
  });
});
