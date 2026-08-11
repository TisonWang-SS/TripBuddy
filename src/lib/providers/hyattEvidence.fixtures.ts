import type { BrowserEvidenceCandidateInput } from "@/lib/providers/hyattEvidence";
import type { ExtractionFixture } from "@/lib/providers/extractionEvaluation";

const KUALA_LUMPUR_STAY_URL =
  "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-07-27&checkoutDate=2026-08-03";

export const hyattEvidenceFixtures = [
  {
    id: "final-total-and-taxes",
    pageText:
      "Price Summary Total Cash MYR3,031.23 7 Night Stay MYR2,806.70 Taxes & Fees MYR224.53 Cancellation Policy Free cancellation before arrival",
    sourceUrl: KUALA_LUMPUR_STAY_URL,
    expectedCandidates: [{
      fields: { currency: "MYR", fees: 224.53, inventoryType: "cash", totalPrice: 3031.23 }
    }]
  },
  {
    id: "compact-payment-total",
    pageText: `${"Payment form field ".repeat(900)} Price SummaryTotal Cash$325.371 Night Stay$301.27Taxes & Fees$24.10 Grand Hyatt Kuala Lumpur 1 King Bed Sat, Aug 1, 2026`,
    sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-08-01&checkoutDate=2026-08-02",
    expectedCandidates: [{
      fields: {
        currency: "USD",
        fees: 24.1,
        feesIncluded: true,
        inventoryType: "cash",
        roomTypeRaw: "1 King Bed",
        taxesIncluded: true,
        totalPrice: 325.37
      }
    }]
  },
  {
    id: "generic-total-label",
    pageText:
      "Price Summary Room total MYR820.00 Taxes & Fees MYR164.00 Total MYR984.00 Cancellation Policy Cancel before arrival",
    sourceUrl: "https://www.hyatt.com/booking/summary?checkinDate=2026-08-01&checkoutDate=2026-08-02",
    expectedCandidates: [{
      fields: {
        currency: "MYR",
        fees: 164,
        feesIncluded: true,
        inventoryType: "cash",
        taxesIncluded: true,
        totalPrice: 984
      }
    }]
  },
  {
    id: "final-room-name-cleanup",
    pageText:
      "Price Summary Total Cash MYR3,105.59 7 Night Stay MYR2,875.55 Taxes & Fees MYR230.04 Hyatt Place Kuala Lumpur Bukit Jalil 1 King Bed Mon, Jul 27, 2026 - Mon, Aug 3, 2026 1 Room Cancellation Policy 11:59PM HOTEL TIME 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE /CCARD RQRD",
    sourceUrl: "https://www.hyatt.com/booking",
    expectedCandidates: [{
      fields: { roomTypeRaw: "1 King Bed", taxesIncluded: true, totalPrice: 3105.59 }
    }]
  },
  {
    id: "average-nightly-to-stay-total",
    pageText: "Standard King Room Member Rate MYR401.00 Avg/Night Select & Book",
    sourceUrl: KUALA_LUMPUR_STAY_URL,
    expectedCandidates: [{ fields: { basePrice: 401, currency: "MYR", totalPrice: 2807 } }]
  },
  {
    candidateCount: 0,
    id: "city-search-estimates-excluded",
    pageText:
      "Grand Hyatt Kuala Lumpur Award Category 3 Rates from: MYR 820 Avg/Night View Rates Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Rates from: MYR 345 Avg/Night View Rates Hyatt Regency Kuala Lumpur Award Category 2 Rates from: MYR 500 Avg/Night View Rates",
    sourceUrl:
      "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur?checkinDate=2026-07-27&checkoutDate=2026-08-03",
    expectedCandidates: []
  },
  {
    id: "spaced-average-nightly-and-rm",
    pageText: "Standard King Room Member Rate RM 401.00 Avg / Night Select & Book",
    sourceUrl: KUALA_LUMPUR_STAY_URL,
    expectedCandidates: [{ fields: { basePrice: 401, currency: "MYR", totalPrice: 2807 } }]
  },
  {
    id: "cny-symbol-rate",
    pageText: "Standard King Room Member Rate CN¥ 401.00 Avg / Night Select & Book",
    sourceUrl: KUALA_LUMPUR_STAY_URL,
    expectedCandidates: [{ fields: { basePrice: 401, currency: "CNY", totalPrice: 2807 } }]
  },
  {
    candidateCount: 1,
    id: "final-total-preferred-over-estimate",
    pageText:
      "Standard King Room Member Rate RM 401.00 Avg / Night Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53",
    sourceUrl: KUALA_LUMPUR_STAY_URL,
    expectedCandidates: [{
      absentFields: ["basePrice"],
      fields: { currency: "MYR", totalPrice: 3031.23 }
    }]
  },
  {
    candidateCount: 1,
    id: "detail-page-suppresses-list-estimates",
    pageText:
      "Standard King Room Member Rate RM 401.00 Avg / Night Select & Book Family Suite Bed and Breakfast RM 640.00 Avg / Night Free cancellation Includes breakfast Select & Book __TRIPBUDDY_FINAL_DETAIL_PAGE__ Price Summary Total Cash MYR3,031.23 Taxes & Fees MYR224.53 Cancellation Policy Free cancellation before arrival",
    sourceUrl: KUALA_LUMPUR_STAY_URL,
    expectedCandidates: [{
      absentFields: ["basePrice"],
      fields: { breakfastIncluded: false, currency: "MYR", taxesIncluded: true, totalPrice: 3031.23 }
    }]
  },
  {
    id: "expanded-breakfast-rate-plans",
    pageText:
      "1 King Bed View Room Details Members Save More MYR 345 Avg/Night Members Save MYR 38 Standard Rate MYR 383 Avg/Night +3 more rates SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Looking for room details? SEE MORE Choose Your Rate Showing rates for Mon, Aug 24, 2026 - Wed, Aug 26, 2026 Members Save More Members Save More MYR 345 Exclusive rate for World of Hyatt Members. Members Save MYR 38 Member Rate MYR 345 Members Save MYR 38 Standard Rate MYR 383 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 345 Avg/Night Cancellation Policy FULL PREPAYMENT/NO REFUND/NO CHANGES Deposit Policy FULL PREPAYMENT JOIN WHILE YOU BOOK SIGN IN & BOOK",
    sourceUrl: "https://www.hyatt.com/en-US/shop/rooms/kulzk?checkinDate=2026-08-24&checkoutDate=2026-08-26",
    expectedCandidates: [
      {
        containsFields: { cancellationPolicyRaw: "FULL PREPAYMENT" },
        fields: {
          basePrice: 431,
          breakfastIncluded: true,
          ratePlanName: "Member Bed and Breakfast",
          roomTypeRaw: "1 King Bed",
          totalPrice: 862
        }
      },
      {
        fields: {
          basePrice: 453,
          breakfastIncluded: true,
          ratePlanName: "Bed and Breakfast",
          totalPrice: 906
        }
      }
    ]
  },
  {
    candidateCount: 1,
    id: "detail-total-without-url-dates",
    pageText:
      "1 King Bed View Room Details Member Rate MYR 401 Avg/Night SELECT & BOOK __TRIPBUDDY_FINAL_DETAIL_PAGE__ Price Summary Total Cash MYR3,031.23 7 Night Stay MYR2,806.70 Taxes & Fees MYR224.53 SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Choose Your Rate Member Rate MYR 401 Standard Rate MYR 438 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 401 Avg/Night Cancellation Policy Free cancellation before arrival JOIN WHILE YOU BOOK SIGN IN & BOOK",
    sourceUrl: "https://www.hyatt.com/booking",
    expectedCandidates: [{
      absentFields: ["basePrice"],
      fields: { breakfastIncluded: false, taxesIncluded: true, totalPrice: 3031.23 }
    }]
  },
  {
    id: "visible-night-count-detail-fallback",
    pageText:
      "SELECT & BOOK 1 King Bed Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Choose Your Rate Showing rates for Mon, Jul 27, 2026 - Mon, Aug 3, 2026 Member Rate MYR 401 Standard Rate MYR 438 Member Bed and Breakfast MYR 431 Bed and Breakfast MYR 453 See more MYR 401 Avg/Night 7 Night Stay Cancellation Policy Free cancellation before arrival JOIN WHILE YOU BOOK SIGN IN & BOOK",
    sourceUrl: "https://www.hyatt.com/booking",
    expectedCandidates: [
      {
        fields: { basePrice: 401, ratePlanName: "Member Rate", totalPrice: 2807 },
        oneOfFields: { taxesIncluded: [false, null] }
      },
      {
        fields: {
          basePrice: 431,
          breakfastIncluded: true,
          ratePlanName: "Member Bed and Breakfast",
          totalPrice: 3017
        }
      }
    ]
  }
] satisfies readonly ExtractionFixture<BrowserEvidenceCandidateInput>[];
