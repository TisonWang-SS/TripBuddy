import { beforeEach, describe, expect, it, vi } from "vitest";

const createHotelSearchTask = vi.fn();
const getHotelSearchSession = vi.fn();
vi.mock("@/lib/browserTaskHandlers", () => ({
  createHotelSearchTask,
  supportedHotelSearchGroups: () => ["Hyatt"]
}));
vi.mock("@/lib/hotelSearchSessions", () => ({ getHotelSearchSession }));

describe("hotel search API", () => {
  beforeEach(() => {
    createHotelSearchTask.mockReset();
    getHotelSearchSession.mockReset();
  });

  it("lists supported hotel groups when no session is requested", async () => {
    const { GET } = await import("@/app/api/hotel-search/route");
    const response = await GET(new Request("http://localhost/api/hotel-search"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ hotelGroups: ["Hyatt"] });
  });

  it("returns a live normalized search session for follow-up questions", async () => {
    getHotelSearchSession.mockResolvedValue({
      expiresAt: "2026-09-11T00:00:00.000Z",
      id: "session-1",
      query: { city: "Tokyo" },
      results: { hotels: [] }
    });
    const { GET } = await import("@/app/api/hotel-search/route");
    const response = await GET(new Request("http://localhost/api/hotel-search?sessionId=session-1"));

    expect(response.status).toBe(200);
    expect(getHotelSearchSession).toHaveBeenCalledWith("session-1");
    await expect(response.json()).resolves.toMatchObject({ id: "session-1", results: { hotels: [] } });
  });

  it("does not expose expired search sessions", async () => {
    getHotelSearchSession.mockResolvedValue(null);
    const { GET } = await import("@/app/api/hotel-search/route");
    const response = await GET(new Request("http://localhost/api/hotel-search?sessionId=expired"));

    expect(response.status).toBe(404);
  });

  it("dispatches a generic hotel-group search task", async () => {
    createHotelSearchTask.mockResolvedValue({
      launchUrl: "https://www.hyatt.com/search#task",
      searchSessionId: "session-1",
      status: "pending",
      taskId: "task-1"
    });
    const { POST } = await import("@/app/api/hotel-search/route");
    const response = await POST(new Request("http://localhost/api/hotel-search", {
      body: JSON.stringify({
        adults: 2,
        budget: { amount: 1000, basis: "stay_total", basisAssumed: false, flexibility: "maximum" },
        checkIn: "2026-09-10",
        checkOut: "2026-09-12",
        city: "Tokyo",
        cityAsAsked: "东京",
        currency: "JPY",
        hotelGroup: "Hyatt"
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }));
    expect(response.status).toBe(201);
    expect(createHotelSearchTask).toHaveBeenCalledWith(expect.objectContaining({
      budget: { amount: 1000, basis: "stay_total", basisAssumed: false, flexibility: "maximum" },
      city: "Tokyo",
      cityAsAsked: "东京",
      hotelGroup: "Hyatt"
    }));
    await expect(response.json()).resolves.toMatchObject({ searchSessionId: "session-1" });
  });

  it("rejects a simple cross-origin POST before creating a search task", async () => {
    const { POST } = await import("@/app/api/hotel-search/route");
    const response = await POST(new Request("http://localhost/api/hotel-search", {
      body: JSON.stringify({ city: "Tokyo", hotelGroup: "Hyatt" }),
      headers: { "Content-Type": "text/plain", Origin: "https://evil.example" },
      method: "POST"
    }));

    expect(response.status).toBe(403);
    expect(createHotelSearchTask).not.toHaveBeenCalled();
  });
});
