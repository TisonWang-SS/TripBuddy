import { describe, expect, it } from "vitest";
import {
  buildHyattSearchUrl,
  calculateStayNights,
  extractHyattHotelCode,
  extractBestHyattCashRate,
  extractHyattFinalTotal,
  extractHyattTaxesAndFees,
  extractLowestCashRate,
  extractLowestCashPrice,
  extractLowestPointsPrice,
  getKnownHyattHotelCode,
  getHotelPriceTool,
  isHyattAutomationBlocked,
  parseHyattCandidates
} from "@/lib/collectors";

const input = {
  bookingId: "booking-1",
  hotelGroup: "Hyatt",
  hotelName: "Grand Hyatt Tokyo",
  city: "Tokyo",
  checkIn: new Date("2026-09-10T00:00:00.000Z"),
  checkOut: new Date("2026-09-13T00:00:00.000Z"),
  guests: 2,
  roomType: "King Room",
  currency: "USD",
  browserMode: "headless" as const,
  inventoryTypes: ["cash", "award"] as const
};

describe("hotel price tools", () => {
  it("selects the Hyatt tool for Hyatt bookings", () => {
    expect(getHotelPriceTool("Hyatt").name).toBe("hyatt-direct-tool");
  });

  it("builds a Hyatt search URL with dates and points mode", () => {
    const url = buildHyattSearchUrl(input);
    expect(url).toContain("hyatt.com/search");
    expect(url).toContain("checkinDate=2026-09-10");
    expect(url).toContain("checkoutDate=2026-09-13");
    expect(url).toContain("currency=USD");
    expect(url).toContain("usePoints=true");
  });

  it("builds a hotel-specific Hyatt shop URL when a booking URL has a code", () => {
    const url = buildHyattSearchUrl({
      ...input,
      bookingUrl: "https://www.hyatt.com/grand-hyatt/en-US/tyogh-grand-hyatt-tokyo"
    });
    expect(url).toContain("hyatt.com/en-US/shop/rooms/tyogh");
  });

  it("builds a hotel-specific Hyatt shop URL for known hotel names", () => {
    const url = buildHyattSearchUrl({
      ...input,
      hotelName: "Hyatt Place Kuala Lumpur Bukit Jalil",
      city: "Kuala Lumpur"
    });
    expect(url).toContain("hyatt.com/en-US/shop/rooms/kulzk");
  });

  it("extracts Hyatt hotel codes from official hotel URLs", () => {
    expect(extractHyattHotelCode("https://www.hyatt.com/en-US/hotel/japan/grand-hyatt-tokyo/tyogh")).toBe("tyogh");
    expect(extractHyattHotelCode("https://www.hyatt.com/grand-hyatt/en-US/tyogh-grand-hyatt-tokyo")).toBe("tyogh");
  });

  it("resolves known Hyatt hotel codes from names", () => {
    expect(getKnownHyattHotelCode("Hyatt Place Kuala Lumpur Bukit Jalil")).toBe("kulzk");
  });

  it("detects Hyatt automation blocks", () => {
    expect(isHyattAutomationBlocked("We’re sorry. Your browser did something unexpected. ERROR:E6020")).toBe(true);
  });

  it("extracts the lowest cash price from page text", () => {
    expect(extractLowestCashPrice("Member Rate $421 Standard Rate $488")).toBe(421);
  });

  it("extracts non-USD cash prices from page text", () => {
    expect(extractLowestCashPrice("Member Rate JPY 72,000 Standard Rate JPY 81,000")).toBe(72000);
    expect(extractLowestCashPrice("Member Rate ¥72,000 Standard Rate ¥81,000")).toBe(72000);
    expect(extractLowestCashPrice("Member Rate SGD 421 Standard Rate SGD 488")).toBe(421);
    expect(extractLowestCashPrice("Long Stay Rate MYR 399Avg/Night +5 more rates")).toBe(399);
  });

  it("calculates stay nights from check-in and check-out dates", () => {
    expect(calculateStayNights(new Date("2026-07-27T00:00:00.000Z"), new Date("2026-08-03T00:00:00.000Z"))).toBe(7);
  });

  it("extracts Hyatt nightly cash rates and computes stay totals", () => {
    const rate = extractBestHyattCashRate(
      "Use Points ROOMS (2) SUITES (1) 1 King Bed Work or unwind in this spacious room. View Room Details Long Stay Rate MYR 399 Avg/Night +5 more rates SELECT & BOOK",
      { ...input, checkIn: new Date("2026-07-27T00:00:00.000Z"), checkOut: new Date("2026-08-03T00:00:00.000Z"), roomType: "1 King Bed" }
    );

    expect(rate).toMatchObject({
      nightlyAmount: 399,
      totalAmount: 2793,
      currency: "MYR",
      nights: 7,
      roomName: "1 King Bed",
      ratePlanName: "Long Stay Rate"
    });
  });

  it("extracts Hyatt final totals from detail page text", () => {
    expect(extractHyattFinalTotal("Price Summary Taxes and fees MYR 312 Total MYR 3,119", "MYR")).toEqual({
      amount: 3119,
      currency: "MYR"
    });
    expect(extractHyattFinalTotal("Price Summary Total Cash MYR3,031.23 7 Night Stay MYR2,806.70 Taxes & Fees MYR224.53", "MYR")).toEqual({
      amount: 3031.23,
      currency: "MYR"
    });
  });

  it("extracts Hyatt taxes and fees from detail page text", () => {
    expect(extractHyattTaxesAndFees("Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53 Sales Tax MYR224.53", "MYR")).toEqual({
      amount: 224.53,
      currency: "MYR"
    });
  });

  it("extracts the currency for the lowest cash rate", () => {
    expect(extractLowestCashRate("Long Stay Rate MYR 399Avg/Night +5 more rates")).toEqual({
      amount: 399,
      currency: "MYR"
    });
  });

  it("extracts the lowest points price from page text", () => {
    expect(extractLowestPointsPrice("Standard Room 25,000 points Premium Room 33,000 points")).toBe(25000);
  });

  it("extracts alternate points formats from page text", () => {
    expect(extractLowestPointsPrice("Standard Room 25,000 Point/Night Premium Room 33,000 Pts/Night")).toBe(25000);
  });

  it("parses Hyatt cash and award candidates from text", () => {
    const candidates = parseHyattCandidates("Member Rate $421 Standard Room 25,000 points", input, "https://www.hyatt.com/search");
    expect(candidates.map((candidate) => candidate.inventoryType)).toEqual(["cash", "award"]);
  });

  it("parses visible cash rates from a Hyatt award search page", () => {
    const candidates = parseHyattCandidates(
      "Hyatt Place Kuala Lumpur Bukit Jalil Use Points Rooms (2) Suites (1) 1 King Bed Long Stay Rate MYR 399Avg/Night +5 more rates Select & Book 1 King Bed, Balcony Long Stay Rate MYR 608Avg/Night +5 more rates Select & Book",
      {
        ...input,
        hotelName: "Hyatt Place Kuala Lumpur Bukit Jalil",
        city: "Kuala Lumpur",
        checkIn: new Date("2026-07-27T00:00:00.000Z"),
        checkOut: new Date("2026-08-03T00:00:00.000Z"),
        currency: "USD",
        inventoryTypes: ["award"]
      },
      "https://www.hyatt.com/en-US/shop/rooms/kulzk"
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].inventoryType).toBe("cash");
    expect(candidates[0].price.base).toBe(399);
    expect(candidates[0].price.total).toBe(2793);
    expect(candidates[0].price.currency).toBe("MYR");
    expect(candidates[0].ratePlanName).toBe("Long Stay Rate");
  });

  it("uses Hyatt detail page totals when available", () => {
    const candidates = parseHyattCandidates(
      "Hyatt Place Kuala Lumpur Bukit Jalil Use Points Rooms (2) Suites (1) 1 King Bed Work or unwind in this spacious room. View Room Details Long Stay Rate MYR 399 Avg/Night +5 more rates Select & Book",
      {
        ...input,
        hotelName: "Hyatt Place Kuala Lumpur Bukit Jalil",
        city: "Kuala Lumpur",
        checkIn: new Date("2026-07-27T00:00:00.000Z"),
        checkOut: new Date("2026-08-03T00:00:00.000Z"),
        currency: "MYR"
      },
      "https://www.hyatt.com/en-US/shop/rooms/kulzk",
      "Booking Summary Room total MYR 2,793 Taxes and fees MYR 326 Grand total MYR 3,119 Cancellation is allowed until 24 hours before arrival.",
      "https://www.hyatt.com/booking"
    );

    expect(candidates[0].price.base).toBe(399);
    expect(candidates[0].price.total).toBe(3119);
    expect(candidates[0].price.taxes).toBe(326);
    expect(candidates[0].price.taxesIncluded).toBe(true);
    expect(candidates[0].source.url).toBe("https://www.hyatt.com/booking");
    expect(candidates[0].cancellation.rawPolicy).toContain("Cancellation");
  });
});
