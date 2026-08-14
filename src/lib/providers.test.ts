import { describe, expect, it } from "vitest";
import { getBookingPriceProvider, getHotelSearchProvider, listSearchableHotelGroups } from "@/lib/providers/registry";
import { buildHyattBookingSearchUrl, extractHyattHotelCode } from "@/lib/providers/hyatt";
import { buildHyattCitySearchUrl } from "@/lib/providers/hyattSearch";

const input = {
  bookingId: "booking-1",
  bookingUrl: null,
  cancellationDeadline: new Date("2026-09-08T00:00:00.000Z"),
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
    /* Asserts only that the parameter is composed. Hyatt was observed to
     * ignore it on /shop/rooms, so this proves nothing about the page mode. */
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

  it("does not assign an unrecognized partner hotel's rate to the preceding Hyatt card", () => {
    const provider = getHotelSearchProvider("Hyatt")!;
    const results = provider.parseSearchSnapshot(
      snapshot(
        "Hyatt House Kuala Lumpur, Mont Kiara 4.5 (482) Award Category 1 Rates from: $91 Avg/Night HOTEL WEBSITE VIEW RATES Park Hyatt Kuala Lumpur Award Category 5 Rates from: $392 Avg/Night HOTEL WEBSITE VIEW RATES The Chow Kit 1.1 mi Rates from: $75 Avg/Night HOTEL WEBSITE VIEW RATES The RuMa Hotel and Residences 0.3 mi Rates from: $254 Avg/Night HOTEL WEBSITE VIEW RATES",
        "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur?currency=USD"
      )
    );

    expect(results).toEqual([
      expect.objectContaining({ hotelName: "Hyatt House Kuala Lumpur, Mont Kiara", avgNightlyRate: 91 }),
      expect.objectContaining({ hotelName: "Park Hyatt Kuala Lumpur", avgNightlyRate: 392 })
    ]);
    expect(results).not.toContainEqual(expect.objectContaining({ hotelName: "Park Hyatt Kuala Lumpur", avgNightlyRate: 75 }));
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

  it("waits through Hyatt's title-only navigation state instead of failing the task", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const loading = provider.parseSnapshot(snapshot(""), input);

    expect(loading).toMatchObject({ errorCode: "page_loading", status: "partial" });
    expect(provider.planAction(snapshot(""), input)).toMatchObject({ action: "wait" });

    const empty = provider.parseSnapshot({ ...snapshot(""), pageTitle: "" }, input);
    expect(empty).toMatchObject({ errorCode: "empty_page", status: "failed" });
  });

  it("maps Hyatt-specific account tokens to structured login state", () => {
    const provider = getBookingPriceProvider("Hyatt")!;

    expect(provider.inferLoginState("Account Overview Points Balance Sign Out")).toBe("member");
    expect(provider.inferLoginState("Sign In Join World of Hyatt")).toBe("anonymous");
    expect(provider.inferLoginState("Price Summary Total Cash USD 900")).toBe("unknown");
  });

  it("fails fast when Hyatt visibly reports a request-processing error", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot("Looks like an error occurred while your request was being processed. Edit Stay Details"),
      input
    );

    expect(parsed).toMatchObject({
      errorCode: "hyatt_page_error",
      errorMessage: "Hyatt could not process the visible booking request after the page refresh.",
      status: "failed"
    });
  });

  it("parses Hyatt Points/Night rates when the points view is selected", () => {
    const provider = getHotelSearchProvider("Hyatt")!;
    const results = provider.parseSearchSnapshot(
      snapshot(
        "2 Results Hyatt on the Bund, Shanghai 4.5 (645) Award Category 3 1.5 mi Rates from: 12,000 Points/Night $155 Avg/Night HOTEL WEBSITE VIEW RATES Grand Hyatt Shanghai 4.5 (532) Award Category 3 1.9 mi Rates from: 17,000 Points/Night $169 Avg/Night HOTEL WEBSITE VIEW RATES",
        "https://www.hyatt.com/search/hotels/en-US/Shanghai?currency=USD"
      )
    );

    expect(results).toEqual([
      expect.objectContaining({ hotelName: "Hyatt on the Bund, Shanghai", pointsPerNight: 12000, priceMode: "points" }),
      expect.objectContaining({ hotelName: "Grand Hyatt Shanghai", pointsPerNight: 17000, priceMode: "points" })
    ]);
    expect(results.every((result) => result.avgNightlyRate === null && result.currency === "PTS")).toBe(true);
  });

  it("opens Hyatt city searches directly in the requested points view", () => {
    const url = buildHyattCitySearchUrl({
      adults: 2,
      budget: null,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      city: "Shanghai",
      cityAsAsked: "上海",
      currency: "USD",
      priceMode: "points"
    });

    expect(url).toContain("rateFilter=woh");
  });

  it("emits a final cash total as observation-ready and keeps an unplaceable points figure as inventory", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot("Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53 1 King Bed Cancellation Policy Free cancellation 25,000 points"),
      { ...input, currency: "MYR" }
    );

    expect(parsed.observations).toEqual([
      expect.objectContaining({ cashTotal: 3031.23, feesIncluded: true, inventoryType: "cash", taxesIncluded: true })
    ]);
    /*
     * The points figure is real evidence and is kept, but nothing on this page
     * says whether it covers the stay or a night, so it is not yet a price the
     * product can compare — the same bar a room-list cash rate has always met.
     */
    expect(parsed.inventory).toEqual(
      expect.arrayContaining([expect.objectContaining({ inventoryType: "award", points: 25000, pointsBasis: "unknown" })])
    );
  });

  it("names an award with the room heading that introduces it, not the next card's", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot(
        "SELECT A ROOM 1 King Bed Relax in this room. View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night SELECT & BOOK " +
          "1 King Bed with Club Access Stunning views. View Room Details From World of Hyatt Club Point Free Night Award 17,000 +1 more rates Points/Night SELECT & BOOK"
      ),
      input
    );

    /* Three nights on this fixture's URL: 12,000 and 17,000 a night. Read from
     * inventory, which keeps every room, so this pins the naming rather than
     * the separate rule about which rooms are comparable. */
    expect(
      parsed.inventory
        .filter((candidate) => candidate.inventoryType === "award")
        .map((candidate) => [candidate.roomTypeRaw, candidate.points])
    ).toEqual([
      ["1 King Bed", 36_000],
      ["1 King Bed with Club Access", 51_000]
    ]);
  });

  it("keeps only the awards comparable to the booked room, not every room on the page", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const pointsRoomList = snapshot(
      "SELECT A ROOM 1 King Bed Relax here. View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night SELECT & BOOK " +
        "2 Twin Beds Twin beds here. View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night SELECT & BOOK " +
        "1 King Bed with Club Access Lounge access. View Room Details From World of Hyatt Club Point Free Night Award 17,000 +1 more rates Points/Night SELECT & BOOK"
    );

    /* A points room list prices every room at once; the booking is for one.
     * A club-access variant is a different room, not the booked one. */
    expect(
      provider.parseSnapshot(pointsRoomList, input).observations.map((observation) => observation.roomTypeRaw)
    ).toEqual(["1 King Bed"]);
    expect(
      provider.parseSnapshot(pointsRoomList, { ...input, roomType: "2 Twin Beds" }).observations.map((observation) => observation.roomTypeRaw)
    ).toEqual(["2 Twin Beds"]);
    expect(
      provider
        .parseSnapshot(pointsRoomList, { ...input, roomType: "1 King Bed with Club Access" })
        .observations.map((observation) => observation.roomTypeRaw)
    ).toEqual(["1 King Bed with Club Access"]);
    /* Every room stays in the run's evidence either way. */
    expect(provider.parseSnapshot(pointsRoomList, input).inventory.length).toBe(3);
  });

  it("keeps a room out of the comparison when the page quotes it two different prices", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot(
        "SELECT A ROOM 1 King Bed Relax here. View Room Details From World of Hyatt Free Night Award 17,000 +1 more rates Points/Night SELECT & BOOK " +
          "1 King Bed Choose Your Rate World of Hyatt Free Night Award from 12,000 From 12,000 Points/Night SELECT"
      ),
      input
    );

    expect(parsed.observations.filter((observation) => observation.inventoryType === "award")).toEqual([]);
    /* Still evidence; just not a price the product will act on. */
    expect(parsed.inventory.filter((candidate) => candidate.inventoryType === "award").length).toBeGreaterThan(1);
  });

  it("emits a points figure the page places on the stay as observation-ready", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const parsed = provider.parseSnapshot(
      snapshot("Price Summary 1 King Bed Total Points 50,000 points Taxes & Fees MYR224.53"),
      { ...input, currency: "MYR" }
    );

    expect(parsed.observations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ inventoryType: "award", points: 50000, pointsBasis: "stay_total" })
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

  it("reports when Hyatt exposes more candidates than the parser retains", () => {
    const provider = getBookingPriceProvider("Hyatt")!;
    const awardRates = Array.from({ length: 13 }, (_, index) => `${10_000 + index * 1_000} points`).join(" ");
    const parsed = provider.parseSnapshot(snapshot(awardRates), input);

    expect(parsed.inventory).toHaveLength(12);
    expect(parsed.candidatesTruncated).toBe(true);
  });
});
