import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSearchSession, searchHotels } from "@/lib/agent/capabilities/search";

const mocks = vi.hoisted(() => ({
  createHotelSearchTask: vi.fn(),
  getHotelSearchSession: vi.fn()
}));

vi.mock("@/lib/hotelSearchTasks", () => ({
  createHotelSearchTask: mocks.createHotelSearchTask,
  supportedHotelSearchGroups: () => ["Hyatt"]
}));
vi.mock("@/lib/hotelSearchSessions", () => ({ getHotelSearchSession: mocks.getHotelSearchSession }));

const args = {
  budgetAmount: 1000,
  budgetBasis: "stay_total",
  budgetFlexibility: "maximum",
  checkIn: "2030-09-10",
  checkOut: "2030-09-12",
  city: "Tokyo",
  cityAsAsked: "东京",
  currency: "CNY"
};

describe("hotel search capabilities", () => {
  beforeEach(() => {
    mocks.createHotelSearchTask.mockReset().mockResolvedValue({
      launchUrl: "https://www.hyatt.com/search",
      searchSessionId: "session-1",
      taskId: "task-1"
    });
    mocks.getHotelSearchSession.mockReset();
  });

  it("keeps the literal budget amount and its stated basis beside the provider city", () => {
    expect(searchHotels.parseArgs(args)).toEqual({
      adults: undefined,
      budget: { amount: 1000, basis: "stay_total", basisAssumed: false, flexibility: "maximum" },
      checkIn: args.checkIn,
      checkOut: args.checkOut,
      city: args.city,
      cityAsAsked: args.cityAsAsked,
      currency: args.currency,
      hotelGroup: "Hyatt"
    });
    expect(() => searchHotels.parseArgs({ ...args, cityAsAsked: undefined })).toThrow(/cityAsAsked/);
  });

  it("defaults an unstated basis to per night and preserves approximate wording", () => {
    expect(searchHotels.parseArgs({ ...args, budgetBasis: undefined, budgetFlexibility: "approximate" }).budget)
      .toEqual({ amount: 1000, basis: "per_night", basisAssumed: true, flexibility: "approximate" });
    expect(() => searchHotels.parseArgs({ ...args, budgetAmount: undefined })).toThrow(/budgetAmount/);
  });

  it("passes normalized city, explicit currency, and budget into the saved search", async () => {
    await searchHotels.run(searchHotels.parseArgs(args));

    expect(mocks.createHotelSearchTask).toHaveBeenCalledWith(expect.objectContaining({
      city: "Tokyo",
      cityAsAsked: "东京",
      currency: "CNY",
      budget: { amount: 1000, basis: "stay_total", basisAssumed: false, flexibility: "maximum" },
      mode: "city_results"
    }));
  });

  it("returns the stored session for deterministic surface composition", async () => {
    mocks.getHotelSearchSession.mockResolvedValue({ id: "session-1" });
    await expect(getSearchSession.run({ sessionId: "session-1" })).resolves.toEqual({ session: { id: "session-1" } });
  });
});
