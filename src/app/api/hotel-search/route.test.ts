import { beforeEach, describe, expect, it, vi } from "vitest";

const createHotelSearchTask = vi.fn();
vi.mock("@/lib/browserTaskHandlers", () => ({
  createHotelSearchTask,
  supportedHotelSearchGroups: () => ["Hyatt"]
}));

describe("hotel search API", () => {
  beforeEach(() => createHotelSearchTask.mockReset());

  it("dispatches a generic hotel-group search task", async () => {
    createHotelSearchTask.mockResolvedValue({ launchUrl: "https://www.hyatt.com/search#task", status: "pending", taskId: "task-1" });
    const { POST } = await import("@/app/api/hotel-search/route");
    const response = await POST(new Request("http://localhost/api/hotel-search", {
      body: JSON.stringify({ adults: 2, checkIn: "2026-09-10", checkOut: "2026-09-12", city: "Tokyo", currency: "JPY", hotelGroup: "Hyatt" }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    }));
    expect(response.status).toBe(201);
    expect(createHotelSearchTask).toHaveBeenCalledWith(expect.objectContaining({ hotelGroup: "Hyatt" }));
  });
});
