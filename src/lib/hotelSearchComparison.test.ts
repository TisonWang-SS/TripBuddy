import { describe, expect, it } from "vitest";
import { compareHotelSearchSession } from "@/lib/hotelSearchComparison";
import type { HotelSearchOffer, HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";

const startingOffer: HotelSearchOffer = {
  breakfastIncluded: null,
  cancellationPolicy: null,
  capturedAt: "2030-08-01T00:00:00.000Z",
  comparisonWarnings: [],
  currency: "CNY",
  displayedAmount: 450,
  displayedPriceBasis: "tax_exclusive",
  displayedPriceUnit: "avg_nightly",
  eliteNightEligible: true,
  evidenceLevel: "starting_price",
  feesAmount: null,
  feesIncluded: "excluded",
  hotelGroup: "Hyatt",
  loyaltyEligible: true,
  nights: 2,
  offerKey: "starting",
  providerName: "Hyatt",
  ratePlanName: null,
  roomType: null,
  sourceName: "Hyatt official",
  sourceType: "direct",
  sourceUrl: "https://www.hyatt.com/search",
  startingAvgNightlyRate: 450,
  staySubtotal: 900,
  stayTotal: null,
  taxesAmount: null,
  taxesAndFeesAmount: null,
  taxesIncluded: "excluded"
};

function sessionWith(offers: HotelSearchOffer[], maxStayTotal: number | null = 1000): HotelSearchSessionSnapshot {
  return {
    createdAt: "2030-08-01T00:00:00.000Z",
    expiresAt: "2030-08-02T00:00:00.000Z",
    id: "session-1",
    profileId: "primary",
    query: {
      adults: 2,
      checkIn: "2030-09-10",
      checkOut: "2030-09-12",
      city: "Tokyo",
      cityAsAsked: "东京",
      currency: "CNY",
      hotelGroup: "Hyatt",
      maxStayTotal
    },
    results: {
      capturedAt: "2030-08-01T00:00:00.000Z",
      hotels: [{
        availabilityLabel: "Available",
        hotelGroup: "Hyatt",
        hotelKey: "hyatt:tokyo:grand-hyatt-tokyo",
        hotelName: "Grand Hyatt Tokyo",
        locationLabel: "Tokyo, Japan",
        offers
      }],
      summary: "One visible official rate.",
      warning: null
    },
    updatedAt: "2030-08-01T00:00:00.000Z"
  };
}

describe("hotel search comparison", () => {
  it("never treats a tax-exclusive starting subtotal as within budget", () => {
    const comparison = compareHotelSearchSession(sessionWith([startingOffer]));

    expect(comparison.rows[0]).toMatchObject({ budgetStatus: "needs_final_total", finalOffer: null });
    expect(comparison.visibleRows).toHaveLength(1);
    expect(comparison.withinBudgetCount).toBe(0);
  });

  it("filters only after a verified tax-inclusive stay total exceeds the budget", () => {
    const finalOffer: HotelSearchOffer = {
      ...startingOffer,
      evidenceLevel: "final_total",
      feesIncluded: "included",
      offerKey: "final",
      stayTotal: 1090,
      taxesAndFeesAmount: 190,
      taxesIncluded: "included"
    };
    const comparison = compareHotelSearchSession(sessionWith([startingOffer, finalOffer]));

    expect(comparison.rows[0].budgetStatus).toBe("over_budget");
    expect(comparison.visibleRows).toHaveLength(0);
    expect(comparison.hiddenOverBudgetCount).toBe(1);
  });

  it("requires same-currency explicit tax and fee evidence", () => {
    const incomplete = {
      ...startingOffer,
      currency: "USD",
      evidenceLevel: "final_total" as const,
      feesIncluded: "included" as const,
      stayTotal: 800,
      taxesIncluded: "included" as const
    };
    expect(compareHotelSearchSession(sessionWith([startingOffer, incomplete])).rows[0].budgetStatus)
      .toBe("needs_final_total");
  });

  it("shows Hyatt's location label as matching or mismatching evidence", () => {
    expect(compareHotelSearchSession(sessionWith([startingOffer])).rows[0].destinationGrounding).toBe("matched");
    const mismatched = sessionWith([startingOffer]);
    mismatched.results.hotels[0].locationLabel = "Osaka, Japan";
    expect(compareHotelSearchSession(mismatched).rows[0].destinationGrounding).toBe("mismatch");
  });
});
