import { describe, expect, it } from "vitest";
import {
  parseHotelSearchQuery,
  parseHotelSearchSessionResults,
  serializeHotelSearchQuery,
  serializeHotelSearchSessionResults
} from "@/lib/hotelSearchSessionCodecs";

const query = {
  adults: 2,
  budget: { amount: 500, basis: "per_night" as const, basisAssumed: false, flexibility: "maximum" as const },
  checkIn: "2030-09-10",
  checkOut: "2030-09-13",
  city: "Tokyo",
  cityAsAsked: "东京",
  currency: "USD",
  hotelGroup: "Hyatt"
};

const emptyResults = { capturedAt: null, hotels: [], summary: null, warning: null };
const results = {
  capturedAt: "2030-08-01T00:00:00.000Z",
  hotels: [{
    availabilityLabel: "Available",
    hotelGroup: "Hyatt",
    hotelKey: "hyatt:tokyo:grand-hyatt-tokyo",
    hotelName: "Grand Hyatt Tokyo",
    locationLabel: "Tokyo",
    offers: [{
      breakfastIncluded: null,
      cancellationPolicy: null,
      capturedAt: "2030-08-01T00:00:00.000Z",
      comparisonWarnings: [],
      currency: "USD",
      displayedAmount: 500,
      displayedPriceBasis: "tax_exclusive" as const,
      displayedPriceUnit: "avg_nightly" as const,
      eliteNightEligible: true,
      evidenceLevel: "starting_price" as const,
      feesAmount: null,
      feesIncluded: "excluded" as const,
      hotelGroup: "Hyatt",
      loyaltyEligible: true,
      nights: 3,
      offerKey: "offer-1",
      providerName: "Hyatt",
      ratePlanName: null,
      roomType: null,
      sourceName: "Hyatt official",
      sourceType: "direct" as const,
      sourceUrl: "https://www.hyatt.com/search",
      startingAvgNightlyRate: 500,
      staySubtotal: 1500,
      stayTotal: null,
      taxesAmount: null,
      taxesAndFeesAmount: null,
      taxesIncluded: "excluded" as const
    }]
  }],
  summary: "One hotel found.",
  warning: null
};

describe("hotel search session JSON codecs", () => {
  it("round-trips valid query and rich results", () => {
    expect(parseHotelSearchQuery(serializeHotelSearchQuery(query), query)).toEqual(query);
    expect(parseHotelSearchSessionResults(serializeHotelSearchSessionResults(results), emptyResults)).toEqual(results);
  });

  it("fails closed for invalid dates and malformed nested offers", () => {
    expect(parseHotelSearchQuery('{"adults":2,"checkIn":"bad"}', query)).toEqual(query);
    expect(parseHotelSearchSessionResults(JSON.stringify({
      ...results,
      hotels: [{ ...results.hotels[0], offers: [{ ...results.hotels[0].offers[0], stayTotal: "500" }] }]
    }), emptyResults)).toEqual(emptyResults);
  });

  it("keeps pre-feature sessions readable with safe display and budget defaults", () => {
    const legacy = JSON.stringify({
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-13",
      city: "Tokyo",
      currency: "USD",
      hotelGroup: "Hyatt"
    });
    expect(parseHotelSearchQuery(legacy, query)).toEqual({
      adults: 2,
      budget: null,
      checkIn: "2030-09-10",
      checkOut: "2030-09-13",
      city: "Tokyo",
      cityAsAsked: "Tokyo",
      currency: "USD",
      hotelGroup: "Hyatt"
    });
  });

  it("upgrades the first whole-stay-only budget shape with explicit provenance", () => {
    const legacy = JSON.stringify({
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-13",
      city: "Tokyo",
      cityAsAsked: "东京",
      currency: "USD",
      hotelGroup: "Hyatt",
      maxStayTotal: 1500
    });
    expect(parseHotelSearchQuery(legacy, query).budget).toEqual({
      amount: 1500,
      basis: "stay_total",
      basisAssumed: false,
      flexibility: "maximum"
    });
  });
});
