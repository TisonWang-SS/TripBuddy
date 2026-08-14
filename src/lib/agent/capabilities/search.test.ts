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
  budgetAmount: 1000, budgetQuote: "budget 1000",
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
      budget: { amount: 1000, basis: "stay_total", basisAssumed: false, flexibility: "maximum", quote: "budget 1000" },
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
      .toEqual({ amount: 1000, basis: "per_night", basisAssumed: true, flexibility: "approximate", quote: "budget 1000" });
    expect(() => searchHotels.parseArgs({ ...args, budgetAmount: undefined })).toThrow(/budgetAmount/);
  });

  it("accepts the normalized args emitted by the agent on a retry", () => {
    expect(searchHotels.parseArgs({
      adults: undefined,
      budget: null,
      checkIn: "2030-09-10",
      checkOut: "2030-09-11",
      city: "Tokyo",
      cityAsAsked: "东京",
      currency: undefined,
      hotelGroup: "Hyatt"
    })).toMatchObject({
      checkIn: "2030-09-10",
      checkOut: "2030-09-11",
      city: "Tokyo",
      cityAsAsked: "东京",
      budget: null
    });
  });

  it("passes normalized city, explicit currency, and budget into the saved search", async () => {
    await searchHotels.run(searchHotels.parseArgs(args));

    expect(mocks.createHotelSearchTask).toHaveBeenCalledWith(expect.objectContaining({
      city: "Tokyo",
      cityAsAsked: "东京",
      currency: "CNY",
      budget: { amount: 1000, basis: "stay_total", basisAssumed: false, flexibility: "maximum", quote: "budget 1000" },
      mode: "city_results"
    }));
  });

  it("starts a points-mode city search when the request asks for award rates", async () => {
    const pointsArgs = searchHotels.parseArgs({
      checkIn: "2030-09-10",
      checkOut: "2030-09-11",
      city: "Shanghai",
      cityAsAsked: "上海",
      priceMode: "points"
    });
    await searchHotels.run(pointsArgs);
    expect(mocks.createHotelSearchTask).toHaveBeenCalledWith(expect.objectContaining({
      city: "Shanghai",
      mode: "city_points",
      priceMode: "points"
    }));
  });

  it("returns the stored session for deterministic surface composition", async () => {
    mocks.getHotelSearchSession.mockResolvedValue({ id: "session-1" });
    await expect(getSearchSession.run({ sessionId: "session-1" })).resolves.toEqual({ session: { id: "session-1" } });
  });

  /* The router can only verify a citation that the parser insisted on having. */
  it("refuses a budget amount that arrives without the wording it came from", () => {
    expect(() => searchHotels.parseArgs({
      budgetAmount: 1000,
      checkIn: "2030-09-10",
      checkOut: "2030-09-12",
      city: "Tokyo",
      cityAsAsked: "东京"
    })).toThrow(/"budgetQuote" is required/);
  });
});
