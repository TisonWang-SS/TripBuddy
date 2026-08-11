import { describe, expect, it } from "vitest";
import {
  evaluateTextEvidenceExtractor,
  evaluateTextEvidenceExtractorAsync,
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

  it("scores asynchronous model extractors against the same fixtures", async () => {
    const fixtures = [{
      expectedCandidates: [{ fields: { currency: "USD" } }],
      id: "async-sample",
      pageText: "sample page",
      sourceUrl: "https://example.com"
    }] satisfies readonly ExtractionFixture<{ currency: string }>[];

    const report = await evaluateTextEvidenceExtractorAsync(fixtures, async () => [{ currency: "USD" }]);

    expect(report.score).toBe(1);
    expect(report.failures).toEqual([]);
  });

  it("accepts semantically equivalent safe alternatives in shared fixtures", () => {
    const fixtures = [{
      expectedCandidates: [{ fields: {}, oneOfFields: { taxesIncluded: [false, null] } }],
      id: "safe-alternatives",
      pageText: "Average nightly rate without a final total",
      sourceUrl: "https://example.com"
    }] satisfies readonly ExtractionFixture<{ taxesIncluded: boolean | null }>[];

    expect(evaluateTextEvidenceExtractor(fixtures, () => [{ taxesIncluded: false }]).score).toBe(1);
    expect(evaluateTextEvidenceExtractor(fixtures, () => [{ taxesIncluded: null }]).score).toBe(1);
    expect(evaluateTextEvidenceExtractor(fixtures, () => [{ taxesIncluded: true }]).score).toBe(0);
  });
});
