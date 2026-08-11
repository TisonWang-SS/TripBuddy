import { beforeEach, describe, expect, it, vi } from "vitest";

const createAccountImportTask = vi.fn();
const createBookingPriceTask = vi.fn();
const createHotelSearchTask = vi.fn();
const runLlmExtractionForPriceCheck = vi.fn();

vi.mock("@/lib/browserTaskHandlers", () => ({
  createAccountImportTask,
  createBookingPriceTask,
  createHotelSearchTask,
  supportedHotelSearchGroups: () => ["Hyatt"]
}));
vi.mock("@/lib/llmExtraction", () => ({ runLlmExtractionForPriceCheck }));

function hostilePost(path: string, body: unknown) {
  return new Request(`http://localhost${path}`, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "text/plain", Origin: "https://evil.example" },
    method: "POST"
  });
}

describe("application task-creation route origin boundary", () => {
  beforeEach(() => {
    createAccountImportTask.mockReset();
    createBookingPriceTask.mockReset();
    createHotelSearchTask.mockReset();
    runLlmExtractionForPriceCheck.mockReset();
  });

  it("blocks account imports before creating a browser task", async () => {
    const { POST } = await import("@/app/api/account-imports/route");
    const response = await POST(hostilePost("/api/account-imports", { hotelGroup: "Hyatt" }));

    expect(response.status).toBe(403);
    expect(createAccountImportTask).not.toHaveBeenCalled();
  });

  it("blocks price checks before updating their watch plan", async () => {
    const { POST } = await import("@/app/api/price-checks/route");
    const response = await POST(hostilePost("/api/price-checks", { bookingId: "booking-1", trigger: "manual" }));

    expect(response.status).toBe(403);
    expect(createBookingPriceTask).not.toHaveBeenCalled();
  });

  it("blocks LLM replay before calling the extractor", async () => {
    const { POST } = await import("@/app/api/price-checks/[id]/llm-extraction/route");
    const response = await POST(
      hostilePost("/api/price-checks/run-1/llm-extraction", {}),
      { params: Promise.resolve({ id: "run-1" }) }
    );

    expect(response.status).toBe(403);
    expect(runLlmExtractionForPriceCheck).not.toHaveBeenCalled();
  });
});
