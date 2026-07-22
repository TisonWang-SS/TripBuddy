import { describe, expect, it } from "vitest";
import { normalizeBrowserEvidencePayload, parseHyattEvidenceFromText } from "@/lib/browserEvidence";

describe("browser evidence", () => {
  it("parses Hyatt final total and taxes", () => {
    const candidates = parseHyattEvidenceFromText(
      "Price Summary Total Cash MYR3,031.23 7 Night Stay MYR2,806.70 Taxes & Fees MYR224.53 Cancellation Policy Free cancellation before arrival",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03"
    );

    expect(candidates[0]).toMatchObject({
      currency: "MYR",
      inventoryType: "cash",
      taxes: 224.53,
      totalPrice: 3031.23
    });
  });

  it("cleans Hyatt final-page title room text before storing observations", () => {
    const candidates = parseHyattEvidenceFromText(
      "Price Summary Total Cash MYR3,105.59 7 Night Stay MYR2,875.55 Taxes & Fees MYR230.04 Hyatt Place Kuala Lumpur Bukit Jalil 1 King Bed Mon, Jul 27, 2026 - Mon, Aug 3, 2026 1 Room Cancellation Policy 11:59PM HOTEL TIME 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE /CCARD RQRD",
      "https://www.hyatt.com/booking"
    );

    const normalized = normalizeBrowserEvidencePayload({
      bookingId: "booking_1",
      candidates
    });

    expect(normalized.candidates[0]).toMatchObject({
      price: 3105.59,
      roomTypeRaw: "1 King Bed",
      taxesIncluded: true
    });
  });

  it("converts Hyatt average nightly rates to stay totals", () => {
    const candidates = parseHyattEvidenceFromText(
      "Standard King Room Member Rate MYR401.00 Avg/Night Select & Book",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03"
    );

    expect(candidates[0]).toMatchObject({
      basePrice: 401,
      currency: "MYR",
      totalPrice: 2807
    });
  });

  it("supports spaced average nightly labels and RM currency", () => {
    const candidates = parseHyattEvidenceFromText(
      "Standard King Room Member Rate RM 401.00 Avg / Night Select & Book",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03"
    );

    expect(candidates[0]).toMatchObject({
      basePrice: 401,
      currency: "MYR",
      totalPrice: 2807
    });
  });

  it("supports Hyatt CNY symbol rates", () => {
    const candidates = parseHyattEvidenceFromText(
      "Standard King Room Member Rate CN¥ 401.00 Avg / Night Select & Book",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03"
    );

    expect(candidates[0]).toMatchObject({
      basePrice: 401,
      currency: "CNY",
      totalPrice: 2807
    });
  });

  it("prefers final totals over nightly estimates", () => {
    const candidates = parseHyattEvidenceFromText(
      "Standard King Room Member Rate RM 401.00 Avg / Night Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03"
    );

    expect(candidates.filter((candidate) => candidate.inventoryType === "cash")).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      currency: "MYR",
      totalPrice: 3031.23
    });
    expect(candidates[0]).not.toHaveProperty("basePrice");
  });

  it("suppresses room-list estimates when the extension captured a final detail page", () => {
    const candidates = parseHyattEvidenceFromText(
      "Standard King Room Member Rate RM 401.00 Avg / Night Select & Book Family Suite Bed and Breakfast RM 640.00 Avg / Night Free cancellation Includes breakfast Select & Book __TRIPBUDDY_FINAL_DETAIL_PAGE__ Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53 Cancellation Policy Free cancellation before arrival",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03"
    );

    expect(candidates.filter((candidate) => candidate.inventoryType === "cash")).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      breakfastIncluded: false,
      currency: "MYR",
      taxesIncluded: true,
      totalPrice: 3031.23
    });
    expect(candidates[0]).not.toHaveProperty("basePrice");
  });

  it("parses expanded Hyatt rate-plan breakfast rates and cancellation policy", () => {
    const candidates = parseHyattEvidenceFromText(
      "1 King Bed View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Looking for room details? SEE MORE Choose Your Rate Showing rates for Mon, Aug 24, 2026 - Wed, Aug 26, 2026 Members Save More Members Save More MYR 345 Exclusive rate for World of Hyatt Members. Members Save MYR 38 Member Rate MYR 345 Members Save MYR 38 Standard Rate MYR 383 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 345 Avg/Night Cancellation Policy FULL PREPAYMENT/NO REFUND/NO CHANGES Deposit Policy FULL PREPAYMENT JOIN WHILE YOU BOOK SIGN IN & BOOK",
      "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-08-24&checkoutDate=2026-08-26"
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          basePrice: 431,
          breakfastIncluded: true,
          cancellationPolicyRaw: expect.stringContaining("FULL PREPAYMENT"),
          ratePlanName: "Member Bed and Breakfast",
          roomTypeRaw: "1 King Bed",
          totalPrice: 862
        }),
        expect.objectContaining({
          basePrice: 453,
          breakfastIncluded: true,
          ratePlanName: "Bed and Breakfast",
          totalPrice: 906
        })
      ])
    );
  });

  it("does not mix final totals with nightly estimate observations when source URL has lost date params", () => {
    const candidates = parseHyattEvidenceFromText(
      "1 King Bed View Room Details Member Rate MYR 401 Avg/Night SELECT & BOOK __TRIPBUDDY_FINAL_DETAIL_PAGE__ Price Summary Total Cash MYR3,031.23 7 Night Stay MYR2,806.70 Taxes & Fees MYR224.53 SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Choose Your Rate Member Rate MYR 401 Standard Rate MYR 438 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 401 Avg/Night Cancellation Policy Free cancellation before arrival JOIN WHILE YOU BOOK SIGN IN & BOOK",
      "https://www.hyatt.com/booking"
    );

    expect(candidates.filter((candidate) => candidate.inventoryType === "cash")).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      breakfastIncluded: false,
      taxesIncluded: true,
      totalPrice: 3031.23
    });
    expect(candidates[0]).not.toHaveProperty("basePrice");
  });

  it("uses visible stay-night text for detail-rate fallback when no final total is visible", () => {
    const candidates = parseHyattEvidenceFromText(
      "SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Choose Your Rate Showing rates for Mon, Jul 27, 2026 - Mon, Aug 3, 2026 Member Rate MYR 401 Standard Rate MYR 438 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 401 Avg/Night 7 Night Stay Cancellation Policy Free cancellation before arrival JOIN WHILE YOU BOOK SIGN IN & BOOK",
      "https://www.hyatt.com/booking"
    );

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          basePrice: 401,
          ratePlanName: "Member Rate",
          taxesIncluded: false,
          totalPrice: 2807
        }),
        expect.objectContaining({
          basePrice: 431,
          breakfastIncluded: true,
          ratePlanName: "Member Bed and Breakfast",
          totalPrice: 3017
        })
      ])
    );
  });

  it("normalizes breakfast-included candidate payloads", () => {
    const normalized = normalizeBrowserEvidencePayload({
      bookingId: "booking_1",
      candidates: [
        {
          breakfastIncluded: true,
          currency: "MYR",
          ratePlanName: "Bed and Breakfast",
          roomTypeRaw: "Family Suite",
          totalPrice: 4480
        }
      ]
    });

    expect(normalized.candidates[0]).toMatchObject({
      breakfastIncluded: true,
      roomTypeRaw: "Family Suite"
    });
  });

  it("normalizes extension payload candidates", () => {
    const normalized = normalizeBrowserEvidencePayload({
      bookingId: "booking_1",
      candidates: [
        {
          currency: "MYR",
          inventoryType: "award",
          pointsPrice: 35000,
          roomTypeRaw: "Standard King Room"
        }
      ],
      pageText: "35,000 points Avg/Night",
      sourceUrl: "https://www.hyatt.com/en-US/shop/rooms/kulzk"
    });

    expect(normalized.candidates[0]).toMatchObject({
      currency: "MYR",
      inventoryType: "award",
      pointsPrice: 35000,
      price: 0
    });
  });
});
