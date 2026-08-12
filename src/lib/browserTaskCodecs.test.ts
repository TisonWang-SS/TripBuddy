import { describe, expect, it } from "vitest";
import {
  parseBrowserTaskResult,
  parseBookingPriceContext,
  parseHotelSearchTaskContext,
  parseObservationDrafts,
  parseSanitizedBrowserSnapshots,
  serializeBookingPriceContext,
  serializeBrowserTaskContext,
  serializeBrowserTaskResult
} from "@/lib/browserTaskCodecs";
import { toJson } from "@/lib/json";

describe("browser task JSON codecs", () => {
  it("round-trips booking dates and rejects invalid date context", () => {
    const context = {
      bookingId: "booking-1",
      bookingUrl: null,
      cancellationDeadline: new Date("2030-09-08T12:00:00.000Z"),
      checkIn: new Date("2030-09-10T00:00:00.000Z"),
      checkOut: new Date("2030-09-13T00:00:00.000Z"),
      city: "Tokyo",
      currency: "USD",
      guests: 2,
      hotelGroup: "Hyatt",
      hotelName: "Grand Hyatt Tokyo",
      inventoryTypes: ["cash", "award"] as const,
      roomType: "1 King Bed"
    };

    expect(parseBookingPriceContext(toJson(serializeBookingPriceContext(context)))).toMatchObject(context);
    expect(parseBookingPriceContext('{"bookingId":"booking-1","hotelGroup":"Hyatt","checkIn":"bad"}')).toBeNull();
  });

  it("keeps only structurally valid inventory drafts", () => {
    const drafts = parseObservationDrafts(toJson([
      {
        breakfastIncluded: false,
        cancellationPolicyRaw: null,
        cashBase: 100,
        cashCopay: null,
        cashCurrency: "USD",
        cashFees: null,
        cashTaxes: null,
        cashTotal: 300,
        feesIncluded: false,
        inventoryType: "cash",
        loyaltyEligible: true,
        points: null,
        ratePlanName: null,
        rawRateName: null,
        roomTypeRaw: "King Room",
        sourceUrl: "https://example.com",
        taxesIncluded: false
      },
      { inventoryType: "cash", sourceUrl: 123 },
      { inventoryType: "unknown", sourceUrl: "https://example.com" }
    ]));

    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ cashTotal: 300, inventoryType: "cash" });
  });

  it("bounds snapshots and remains compatible with pre-truncation rows", () => {
    const snapshots = parseSanitizedBrowserSnapshots(toJson([
      {
        capturedAt: "2030-09-10T00:00:00.000Z",
        pageTitle: "Summary",
        phase: "detail",
        sourceUrl: "https://example.com",
        textSample: "x".repeat(13_000)
      },
      { capturedAt: "invalid", sourceUrl: "https://example.com" }
    ]));

    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ phase: "detail", truncated: true });
    expect(snapshots[0].textSample).toHaveLength(12_000);
  });

  it("validates hotel-search contexts and task-kind-specific results on both boundaries", () => {
    const context = {
      hotelName: null,
      mode: "city_results" as const,
      query: {
        adults: 2,
        checkIn: "2030-09-10",
        checkOut: "2030-09-13",
        city: "Tokyo",
        cityAsAsked: "东京",
        currency: "USD",
        hotelGroup: "Hyatt",
        maxStayTotal: 1000
      },
      searchSessionId: "session-1"
    };
    const result = { observationsCreated: 2, runId: "run-1" };

    expect(parseHotelSearchTaskContext(serializeBrowserTaskContext("hotel_search", context))).toEqual(context);
    expect(parseBrowserTaskResult(
      "booking_price_check",
      serializeBrowserTaskResult("booking_price_check", result)
    )).toEqual(result);
    expect(parseBrowserTaskResult("booking_price_check", '{"observationsCreated":"2"}')).toBeNull();
    expect(() => serializeBrowserTaskResult("booking_price_check", { observationsCreated: -1, runId: "" }))
      .toThrow(/result JSON is invalid/);
  });

  it("upgrades an older hotel-search task context with display and budget defaults", () => {
    const legacy = JSON.stringify({
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-13",
      city: "Tokyo",
      currency: "USD",
      hotelGroup: "Hyatt"
    });
    expect(parseHotelSearchTaskContext(legacy)?.query).toMatchObject({
      city: "Tokyo",
      cityAsAsked: "Tokyo",
      maxStayTotal: null
    });
  });
});
