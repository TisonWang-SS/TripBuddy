import { describe, expect, it } from "vitest";
import { buildRollingGoHotelDetailRequest, parseRollingGoHotelDetail } from "@/lib/providers/rollinggoGlobal";
import type { HotelSearchQuery } from "@/lib/providers/types";

const query: HotelSearchQuery = {
  adults: 2,
  budget: null,
  checkIn: "2030-09-09",
  checkOut: "2030-09-10",
  city: "Beijing",
  cityAsAsked: "北京",
  currency: "USD",
  hotelGroup: "Hyatt"
};

describe("RollingGo Global OTA adapter", () => {
  it("builds the documented hotel-detail payload with the TripBuddy stay conditions", () => {
    expect(buildRollingGoHotelDetailRequest(query, "Grand Hyatt Beijing")).toEqual({
      name: "Grand Hyatt Beijing",
      dateParam: { checkInDate: "2030-09-09", checkOutDate: "2030-09-10" },
      occupancyParam: { roomCount: 1, adultCount: 2, childCount: 0 },
      localeParam: { countryCode: "US", currency: "USD" }
    });
  });

  it("selects the lowest room total and preserves the tax-inclusive semantics", () => {
    const quote = parseRollingGoHotelDetail({
      bookingUrl: "https://rollinggo.ai/hotel/123",
      roomRatePlans: [
        {
          cancellationPolicies: [{ description: "Non-refundable" }],
          currency: "USD",
          ratePlanName: "Flexible",
          roomName: "King Room",
          totalPrice: 220,
          totalSalesRate: 220
        },
        {
          currency: "USD",
          ratePlanName: "Advance Purchase",
          roomName: "Standard Room",
          totalPrice: 180,
          totalSalesRate: 180
        }
      ],
      success: true
    }, "Grand Hyatt Beijing");

    expect(quote).toMatchObject({
      currency: "USD",
      hotelName: "Grand Hyatt Beijing",
      roomType: "Standard Room",
      sourceUrl: "https://rollinggo.ai/hotel/123",
      stayTotal: 180,
      taxesIncluded: true
    });
  });

  it("does not turn a response with only a nightly reference price into a stay total", () => {
    expect(parseRollingGoHotelDetail({
      roomRatePlans: [{ currency: "USD", totalSalesRate: 180 }],
      success: true
    }, "Grand Hyatt Beijing")).toBeNull();
  });

  it("supports the current live schema's inclusive averagePrice and cancelPolicy", () => {
    const quote = parseRollingGoHotelDetail({
      bookingUrl: "https://rollinggo.ai/hotel/123",
      roomRatePlans: [{
        averagePrice: 180,
        cancelPolicy: "Free cancellation until the day before",
        currency: "USD",
        roomName: "1 King Bed"
      }],
      success: true
    }, "Grand Hyatt Beijing", "USD", 2);

    expect(quote).toMatchObject({
      cancellationPolicy: "Free cancellation until the day before",
      stayTotal: 360,
      taxesIncluded: true
    });
  });
});
