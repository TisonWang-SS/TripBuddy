import { describe, expect, it } from "vitest";
import {
  buildHyattSearchUrl,
  calculateStayNights,
  extractHyattHotelCode,
  extractBestHyattCashRate,
  extractHyattCashRates,
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

  it("uses CNY as the Hyatt query currency for China yuan", () => {
    const url = buildHyattSearchUrl({ ...input, currency: "CNY" });
    expect(url).toContain("currency=CNY");
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

  it("extracts all visible Hyatt cash rates with room and breakfast details", () => {
    const rates = extractHyattCashRates(
      "ROOMS (2) SUITES (1) 1 King Bed Work or unwind. View Room Details Member Rate MYR 399 Avg/Night Free cancellation Select & Book 1 King Bed, Balcony Enjoy the view. View Room Details Bed and Breakfast MYR 608 Avg/Night Includes breakfast Cancel before arrival Select & Book Family Suite Relax together. View Room Details Standard Rate MYR 720 Avg/Night Select & Book",
      { ...input, checkIn: new Date("2026-07-27T00:00:00.000Z"), checkOut: new Date("2026-08-03T00:00:00.000Z"), roomType: "1 King Bed" }
    );

    expect(rates).toHaveLength(3);
    expect(rates.map((rate) => rate.roomName)).toEqual(["1 King Bed", "1 King Bed, Balcony", "Family Suite"]);
    expect(rates[1]).toMatchObject({
      breakfastIncluded: true,
      nightlyAmount: 608,
      ratePlanName: "Bed and Breakfast"
    });
  });

  it("extracts real Hyatt Members Save More rates from compact room-list text", () => {
    const rates = extractHyattCashRates(
      "1 King Bed Work or unwind in this spacious 32 sqm room overlooking Bukit Jalil, featuring a king-size bed. View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 2 Twin Beds Work or unwind in this spacious 32 sqm room overlooking Bukit Jalil, featuring two twin beds. View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 1 King Bed, Balcony Enjoy a restful stay in this 42 sqm room. View Room Details Members Save More MYR 557 Avg/Night Members Save MYR 61 Standard Rate MYR 618 Avg/Night +3 more rates SELECT & BOOK",
      { ...input, checkIn: new Date("2026-08-24T00:00:00.000Z"), checkOut: new Date("2026-08-26T00:00:00.000Z"), roomType: "1 King Bed" }
    );

    expect(rates.map((rate) => [rate.roomName, rate.ratePlanName, rate.nightlyAmount])).toEqual([
      ["1 King Bed", "Members Save More", 345],
      ["2 Twin Beds", "Members Save More", 345],
      ["1 King Bed", "Standard Rate", 383],
      ["2 Twin Beds", "Standard Rate", 383],
      ["1 King Bed, Balcony", "Members Save More", 557],
      ["1 King Bed, Balcony", "Standard Rate", 618]
    ]);
  });

  it("parses real Hyatt room-list text into all visible cash candidates", () => {
    const candidates = parseHyattCandidates(
      "1 King Bed Work or unwind in this spacious 32 sqm room overlooking Bukit Jalil, featuring a king-size bed. View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 2 Twin Beds Work or unwind in this spacious 32 sqm room overlooking Bukit Jalil, featuring two twin beds. View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 1 King Bed, Balcony Enjoy a restful stay in this 42 sqm room. View Room Details Members Save More MYR 557 Avg/Night Members Save MYR 61 Standard Rate MYR 618 Avg/Night +3 more rates SELECT & BOOK",
      {
        ...input,
        checkIn: new Date("2026-08-24T00:00:00.000Z"),
        checkOut: new Date("2026-08-26T00:00:00.000Z"),
        currency: "MYR"
      },
      "https://www.hyatt.com/en-US/shop/rooms/kulzk"
    );

    expect(candidates.filter((candidate) => candidate.inventoryType === "cash")).toHaveLength(6);
    expect(candidates[0]).toMatchObject({
      price: {
        base: 345,
        total: 690
      },
      ratePlanName: "Members Save More",
      room: {
        rawName: "1 King Bed"
      }
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

    expect(candidates).toHaveLength(2);
    expect(candidates[0].inventoryType).toBe("cash");
    expect(candidates[0].price.base).toBe(399);
    expect(candidates[0].price.total).toBe(2793);
    expect(candidates[0].price.currency).toBe("MYR");
    expect(candidates[0].ratePlanName).toBe("Long Stay Rate");
    expect(candidates.find((candidate) => candidate.price.base === 608)?.room.rawName).toBe("1 King Bed, Balcony");
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

  it("applies Hyatt detail page totals only to the selected room-list rate", () => {
    const candidates = parseHyattCandidates(
      "ROOMS (2) SUITES (1) 1 King Bed Work or unwind. View Room Details Long Stay Rate MYR 399 Avg/Night Select & Book 1 King Bed, Balcony Enjoy the view. View Room Details Long Stay Rate MYR 608 Avg/Night Select & Book",
      {
        ...input,
        checkIn: new Date("2026-07-27T00:00:00.000Z"),
        checkOut: new Date("2026-08-03T00:00:00.000Z"),
        currency: "MYR"
      },
      "https://www.hyatt.com/en-US/shop/rooms/kulzk",
      "Booking Summary Room total MYR 2,793 Taxes and fees MYR 326 Grand total MYR 3,119 Cancellation is allowed until 24 hours before arrival.",
      "https://www.hyatt.com/booking",
      {
        amount: 399,
        clicked: true,
        reason: null,
        snippet: "1 King Bed Long Stay Rate MYR 399 Avg/Night"
      }
    );

    const selected = candidates.find((candidate) => candidate.price.base === 399);
    const otherRoom = candidates.find((candidate) => candidate.price.base === 608);

    expect(selected).toMatchObject({
      price: {
        taxesIncluded: true,
        total: 3119
      }
    });
    expect(otherRoom).toMatchObject({
      cancellation: {
        rawPolicy: "Policy not visible in Hyatt detail page"
      },
      price: {
        taxesIncluded: false,
        total: 4256
      }
    });
  });

  it("adds selected Hyatt rate-plan breakfast candidates with policy", () => {
    const candidates = parseHyattCandidates(
      "1 King Bed View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Looking for room details? SEE MORE Choose Your Rate Showing rates for Mon, Aug 24, 2026 - Wed, Aug 26, 2026 Members Save More Members Save More MYR 345 Exclusive rate for World of Hyatt Members. Members Save MYR 38 Member Rate MYR 345 Members Save MYR 38 Standard Rate MYR 383 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 345 Avg/Night Cancellation Policy FULL PREPAYMENT/NO REFUND/NO CHANGES Deposit Policy FULL PREPAYMENT JOIN WHILE YOU BOOK SIGN IN & BOOK",
      {
        ...input,
        checkIn: new Date("2026-08-24T00:00:00.000Z"),
        checkOut: new Date("2026-08-26T00:00:00.000Z"),
        currency: "MYR"
      },
      "https://www.hyatt.com/en-US/shop/rooms/kulzk"
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          breakfastIncluded: true,
          cancellation: expect.objectContaining({
            rawPolicy: expect.stringContaining("FULL PREPAYMENT")
          }),
          price: expect.objectContaining({
            base: 431,
            total: 862
          }),
          ratePlanName: "Member Bed and Breakfast",
          room: expect.objectContaining({
            rawName: "1 King Bed"
          })
        })
      ])
    );
  });
});
