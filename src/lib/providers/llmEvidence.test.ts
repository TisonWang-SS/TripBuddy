import { describe, expect, it, vi } from "vitest";
import { buildObservationEvidence } from "@/lib/evidence";
import {
  DeepSeekChatCompletionsEvidenceExtractor,
  LLM_EVIDENCE_SCHEMA,
  LlmEvidenceError,
  validateLlmEvidenceCandidates,
  type LlmEvidenceCandidate
} from "@/lib/providers/llmEvidence";

const pageText =
  "Price Summary 3 Night Stay USD 900.00 Taxes & Fees USD 90.00 Total Cash USD 990.00 1 King Bed Cancellation Policy Free cancellation before arrival";

const candidate = {
  averageNightlyRate: null,
  breakfastIncluded: null,
  cancellationPolicyRaw: "Free cancellation before arrival",
  cashCopay: null,
  cashFees: { amount: 90, currency: "USD" },
  cashTaxes: null,
  cashTotal: { amount: 990, currency: "USD" },
  evidenceText: pageText,
  feesIncluded: true,
  inventoryType: "cash",
  loyaltyEligible: null,
  points: null,
  ratePlanName: null,
  rawRateName: null,
  roomTypeRaw: "1 King Bed",
  staySubtotal: { amount: 900, currency: "USD" },
  taxesIncluded: true
} satisfies LlmEvidenceCandidate;

describe("DeepSeek Chat Completions evidence extractor", () => {
  it("requests JSON output while marking page text as untrusted data", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ candidates: [candidate] }) } }]
    }), { status: 200 }));
    const extractor = new DeepSeekChatCompletionsEvidenceExtractor({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test/",
      fetchImpl,
      model: "test-model"
    });

    await expect(extractor.extract({
      hotelGroup: "Hyatt",
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    })).resolves.toEqual([candidate]);

    const [url, request] = fetchImpl.mock.calls[0];
    const body = JSON.parse(String(request.body));
    expect(url).toBe("https://api.deepseek.test/chat/completions");
    expect(request.headers.Authorization).toBe("Bearer test-key");
    expect(body).toMatchObject({
      model: "test-model",
      response_format: { type: "json_object" },
      thinking: { type: "disabled" }
    });
    expect(body.messages[0].content).toContain("untrusted third-party page data");
    expect(body.messages[0].content).toContain("one short, contiguous, exact substring");
    expect(body.messages[0].content).toContain("never derive a per-night value");
    expect(body.messages[0].content).toContain(JSON.stringify(LLM_EVIDENCE_SCHEMA));
    expect(body.messages[0].content).toContain('{"candidates":[]}');
  });

  it("requires environment-backed credentials before making a request", async () => {
    const fetchImpl = vi.fn();
    const extractor = new DeepSeekChatCompletionsEvidenceExtractor({
      apiKey: "",
      baseUrl: "https://api.deepseek.test",
      fetchImpl,
      model: "test-model"
    });

    await expect(extractor.extract({
      hotelGroup: "Hyatt",
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    })).rejects.toMatchObject({ code: "llm_not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces content filtering instead of treating it as empty evidence", async () => {
    const extractor = new DeepSeekChatCompletionsEvidenceExtractor({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ finish_reason: "content_filter", message: { content: null } }]
      }), { status: 200 })),
      model: "test-model"
    });

    await expect(extractor.extract({
      hotelGroup: "Hyatt",
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    })).rejects.toBeInstanceOf(LlmEvidenceError);
  });

  it("revalidates structured output instead of trusting the provider response", async () => {
    const extractor = new DeepSeekChatCompletionsEvidenceExtractor({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{
          finish_reason: "stop",
          message: { content: JSON.stringify({ candidates: [{ ...candidate, unexpectedAuthorization: true }] }) }
        }]
      }), { status: 200 })),
      model: "test-model"
    });

    await expect(extractor.extract({
      hotelGroup: "Hyatt",
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    })).rejects.toMatchObject({ code: "llm_schema_mismatch" });
  });

  it("rejects truncated and empty completions explicitly", async () => {
    const truncated = new DeepSeekChatCompletionsEvidenceExtractor({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ finish_reason: "length", message: { content: '{"candidates":' } }]
      }), { status: 200 })),
      model: "test-model"
    });
    const empty = new DeepSeekChatCompletionsEvidenceExtractor({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.test",
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify({
        choices: [{ finish_reason: "stop", message: { content: "" } }]
      }), { status: 200 })),
      model: "test-model"
    });
    const input = {
      hotelGroup: "Hyatt",
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    };

    await expect(truncated.extract(input)).rejects.toMatchObject({ code: "llm_incomplete_response" });
    await expect(empty.extract(input)).rejects.toMatchObject({ code: "llm_empty_response" });
  });
});

describe("LLM evidence deterministic validation", () => {
  it("accepts page-grounded, currency-consistent arithmetic", () => {
    const result = validateLlmEvidenceCandidates([candidate], {
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.issues).toEqual([]);
    expect(result.accepted[0].draft).toMatchObject({
      cashBase: 900,
      cashCurrency: "USD",
      cashFees: 90,
      cashTotal: 990,
      inventoryType: "cash"
    });
  });

  it("downgrades unsupported boolean claims before they can clear blockers or inflate benefits", () => {
    const negativePageText =
      "Price Summary Total Cash USD 990.00 1 King Bed Cancellation Policy Free cancellation before arrival. Taxes and fees are NOT included and will be collected at the hotel. Room only.";
    const sourceUrl = "https://www.hyatt.com/booking/summary";
    const result = validateLlmEvidenceCandidates([{
      ...candidate,
      breakfastIncluded: true,
      cashFees: null,
      evidenceText: negativePageText,
      feesIncluded: true,
      loyaltyEligible: true,
      staySubtotal: null,
      taxesIncluded: true
    }], {
      nights: 3,
      pageText: negativePageText,
      sourceUrl
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.issues.join(" ")).toMatch(/breakfastIncluded=true was replaced with false/);
    expect(result.issues.join(" ")).toMatch(/feesIncluded=true was replaced with false/);
    expect(result.issues.join(" ")).toMatch(/loyaltyEligible=true was replaced with null/);
    expect(result.issues.join(" ")).toMatch(/taxesIncluded=true was replaced with false/);
    expect(result.accepted[0].draft).toMatchObject({
      breakfastIncluded: false,
      feesIncluded: false,
      loyaltyEligible: null,
      taxesIncluded: false
    });

    const draft = result.accepted[0].draft;
    const evidence = buildObservationEvidence({
      bookingCancellationDeadline: new Date("2030-09-08T12:00:00.000Z"),
      bookingCheckIn: new Date("2030-09-10T00:00:00.000Z"),
      bookingCurrency: "USD",
      bookingRoomType: "1 King Bed",
      cancellationPolicyRaw: draft.cancellationPolicyRaw,
      cashCurrency: draft.cashCurrency,
      collectionMethod: "browser_companion",
      conversionAvailable: true,
      feesIncluded: draft.feesIncluded,
      inventoryType: draft.inventoryType,
      loyaltyEligible: draft.loyaltyEligible,
      pageText: negativePageText,
      roomTypeRaw: draft.roomTypeRaw,
      sourceType: "direct",
      sourceUrl,
      taxesIncluded: draft.taxesIncluded
    });

    expect(evidence.blockers).toContain("Final tax inclusion is not verified.");
    expect(evidence.blockers).toContain("Final fee inclusion is not verified.");
    expect(evidence.qualityLevel).toBe("needs_review");
  });

  it("derives breakfast and loyalty benefits only from candidate-local visible tokens", () => {
    const supportedPageText =
      `${pageText} Member Bed and Breakfast Eligible to earn World of Hyatt points`;
    const result = validateLlmEvidenceCandidates([{
      ...candidate,
      breakfastIncluded: false,
      evidenceText: supportedPageText,
      loyaltyEligible: false,
      ratePlanName: "Member Bed and Breakfast"
    }], {
      nights: 3,
      pageText: supportedPageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].draft).toMatchObject({ breakfastIncluded: true, loyaltyEligible: true });
    expect(result.issues.join(" ")).toMatch(/breakfastIncluded=false was replaced with true/);
    expect(result.issues.join(" ")).toMatch(/loyaltyEligible=false was replaced with true/);
  });

  it("does not borrow benefit evidence from an unrelated rate elsewhere on the page", () => {
    const mixedRatePageText =
      `${pageText} Member Bed and Breakfast Eligible to earn World of Hyatt points`;
    const result = validateLlmEvidenceCandidates([{
      ...candidate,
      breakfastIncluded: true,
      evidenceText: "Total Cash USD 990.00",
      feesIncluded: true,
      loyaltyEligible: true,
      ratePlanName: "Member Bed and Breakfast",
      staySubtotal: null,
      taxesIncluded: true
    }], {
      nights: 3,
      pageText: mixedRatePageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].draft).toMatchObject({
      breakfastIncluded: null,
      feesIncluded: null,
      loyaltyEligible: null,
      taxesIncluded: null
    });
    expect(result.issues.join(" ")).toMatch(/breakfastIncluded=true was replaced with null/);
    expect(result.issues.join(" ")).toMatch(/feesIncluded=true was replaced with null/);
    expect(result.issues.join(" ")).toMatch(/loyaltyEligible=true was replaced with null/);
    expect(result.issues.join(" ")).toMatch(/taxesIncluded=true was replaced with null/);
  });

  it("does not mix a list-page nightly rate into a final-total observation", () => {
    const mixedPageText = `${pageText} Member Rate USD 300.00 Avg/Night`;
    const result = validateLlmEvidenceCandidates([{
      ...candidate,
      averageNightlyRate: { amount: 300, currency: "USD" },
      evidenceText: mixedPageText,
      staySubtotal: null
    }], {
      nights: 3,
      pageText: mixedPageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.issues).toEqual([]);
    expect(result.accepted[0].draft.cashBase).toBeNull();
    expect(result.accepted[0].proposal.averageNightlyRate?.amount).toBe(300);
  });

  it("suppresses cash list rates when the same snapshot has a final cash total", () => {
    const mixedPageText = `${pageText} Member Rate USD 300.00 Avg/Night`;
    const result = validateLlmEvidenceCandidates([
      { ...candidate, evidenceText: pageText },
      {
        ...candidate,
        averageNightlyRate: { amount: 300, currency: "USD" },
        cashFees: null,
        cashTotal: null,
        evidenceText: "Member Rate USD 300.00 Avg/Night",
        feesIncluded: false,
        staySubtotal: null,
        taxesIncluded: false
      }
    ], {
      nights: 3,
      pageText: mixedPageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.issues).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.accepted[0].proposal.cashTotal?.amount).toBe(990);
  });

  it("rejects invented numbers, mixed currencies, and broken totals", () => {
    const result = validateLlmEvidenceCandidates([{
      ...candidate,
      cashFees: { amount: 91, currency: "EUR" },
      cashTotal: { amount: 1200, currency: "USD" }
    }], {
      nights: 3,
      pageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.accepted).toEqual([]);
    expect(result.issues.join(" ")).toMatch(/inconsistent currencies/);
    expect(result.issues.join(" ")).toMatch(/does not occur/);
    expect(result.issues.join(" ")).toMatch(/does not match total/);
  });

  it("recognizes a compact amount immediately followed by the stay count", () => {
    const compactPageText =
      "Price SummaryTotal Cash$325.371 Night Stay$301.27Taxes & Fees$24.10 Grand Hyatt Kuala Lumpur 1 King Bed";
    const result = validateLlmEvidenceCandidates([{
      ...candidate,
      cancellationPolicyRaw: null,
      cashFees: { amount: 24.1, currency: "USD" },
      cashTotal: { amount: 325.37, currency: "USD" },
      evidenceText: compactPageText,
      roomTypeRaw: "1 King Bed",
      staySubtotal: { amount: 301.27, currency: "USD" }
    }], {
      nights: 1,
      pageText: compactPageText,
      sourceUrl: "https://www.hyatt.com/booking/summary"
    });

    expect(result.issues).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });
});
