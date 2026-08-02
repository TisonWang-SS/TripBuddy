import { describe, expect, it } from "vitest";
import { getBookingPriceProvider, getHotelSearchProvider, listSearchableHotelGroups } from "@/lib/providers/registry";
import { buildHyattBookingSearchUrl, extractHyattHotelCode } from "@/lib/providers/hyatt";

const input = {
  bookingId: "booking-1",
  bookingUrl: null,
  checkIn: new Date("2026-09-10T00:00:00.000Z"),
  checkOut: new Date("2026-09-13T00:00:00.000Z"),
  city: "Tokyo",
  currency: "USD",
  guests: 2,
  hotelGroup: "Hyatt",
  hotelName: "Grand Hyatt Tokyo",
  inventoryTypes: ["cash", "award"] as const,
  roomType: "1 King Bed"
};

function snapshot(
  pageText: string,
  sourceUrl = "https://www.hyatt.com/shop/rooms/tyogh?checkinDate=2026-09-10&checkoutDate=2026-09-13"
) {
  return { capturedAt: new Date().toISOString(), controls: [], pageText, pageTitle: "Hyatt", sourceUrl };
}

describe("hotel provider registry", () => {
  it("exposes only implemented search providers", () => {
    expect(listSearchableHotelGroups()).toEqual(["Hyatt"]);
    expect(getBookingPriceProvider("Hyatt")?.name).toBe("hyatt-browser-companion");
    expect(getHotelSearchProvider("Marriott")).toBeNull();
  });

  it("builds canonical Hyatt URLs and preserves requested inventory", () => {
    const url = buildHyattBookingSearchUrl({
      ...input,
      bookingUrl: "https://www.hyatt.com/en-US/hotel/japan/grand-hyatt-tokyo/tyogh"
    });
    expect(url).toContain("/shop/rooms/tyogh");
    expect(url).toContain("checkinDate=2026-09-10");
    expect(url).toContain("currency=USD");
    expect(url).toContain("usePoints=true");
    expect(extractHyattHotelCode(url)).toBe("tyogh");
  });

  it("keeps every visible Hyatt city result, including The Standard", () => {
    const provider = getHotelSearchProvider("Hyatt")!;
    const results = provider.parseSearchSnapshot(
      snapshot(
        "3 Results Andaz Singapore 4.5 (2664) Award Category 6 +7 Rates from: SGD 456 Avg/Night HOTEL WEBSITE VIEW RATES Grand Hyatt Singapore 4.5 (2480) Award Category 6 +8 Rates from: SGD 342 Avg/Night HOTEL WEBSITE VIEW RATES The Standard, Singapore 4.5 (59) Award Category 4 +4 Rates from: SGD 420 Avg/Night HOTEL WEBSITE VIEW RATES Members save more",
        "https://www.hyatt.com/search/hotels/en-US/Singapore?currency=SGD"
      )
    );

    expect(results).toEqual([
      expect.objectContaining({ hotelName: "Grand Hyatt Singapore", avgNightlyRate: 342, currency: "SGD" }),
      expect.objectContaining({ hotelName: "The Standard, Singapore", avgNightlyRate: 420, currency: "SGD" }),
      expect.objectContaining({ hotelName: "Andaz Singapore", avgNightlyRate: 456, currency: "SGD" })
    ]);
  });

  it("keeps room-list cash estimates as inventory only", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot("1 King Bed Member Rate MYR 401 Avg/Night Select & Book"),
      { ...input, currency: "MYR" }
    );
    expect(parsed.inventory).toEqual(expect.arrayContaining([expect.objectContaining({ cashBase: 401, cashTotal: 1203 })]));
    expect(parsed.observations).toHaveLength(0);
    expect(parsed.status).toBe("partial");
  });

  it("emits final cash totals and explicit points as observation-ready", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot("Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53 1 King Bed Cancellation Policy Free cancellation 25,000 points"),
      { ...input, currency: "MYR" }
    );
    expect(parsed.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ cashTotal: 3031.23, feesIncluded: true, inventoryType: "cash", taxesIncluded: true }),
        expect.objectContaining({ inventoryType: "award", points: 25000 })
      ])
    );
  });

  it("keeps a final total with incomplete tax evidence as an observation that needs assessment", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(snapshot("Price Summary Total Cash MYR3,031.23 1 King Bed"), {
      ...input,
      currency: "MYR"
    });
    expect(parsed.observations).toEqual([
      expect.objectContaining({
        cashTotal: 3031.23,
        feesIncluded: null,
        inventoryType: "cash",
        taxesIncluded: null
      })
    ]);
  });
});
