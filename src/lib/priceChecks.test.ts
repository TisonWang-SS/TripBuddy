import { describe, expect, it } from "vitest";
import { mergeObservationCandidates, planInventoryModeSwitch } from "@/lib/priceChecks";
import type { BookingPriceInput, ParsedObservationDraft } from "@/lib/providers/types";

function bookingContext(overrides: Partial<BookingPriceInput> = {}): BookingPriceInput {
  return {
    bookingId: "booking-1",
    bookingUrl: null,
    cancellationDeadline: null,
    checkIn: new Date("2026-09-10T00:00:00Z"),
    checkOut: new Date("2026-09-13T00:00:00Z"),
    city: "Tokyo",
    currency: "USD",
    guests: 2,
    hotelGroup: "Hyatt",
    hotelName: "Grand Hyatt Tokyo",
    inventoryTypes: ["cash", "award"],
    roomType: "1 King Bed",
    ...overrides
  };
}

function cashCandidate(index: number): ParsedObservationDraft {
  return {
    breakfastIncluded: null,
    cancellationPolicyRaw: null,
    cashBase: index,
    cashCopay: null,
    cashCurrency: "USD",
    cashFees: null,
    cashTaxes: null,
    cashTotal: 100 + index,
    feesIncluded: null,
    inventoryType: "cash",
    pointsBasis: "unknown",
    loyaltyEligible: null,
    points: null,
    ratePlanName: `Rate ${index}`,
    rawRateName: null,
    roomTypeRaw: `Room ${index}`,
    sourceUrl: "https://www.hyatt.com/",
    taxesIncluded: null
  };
}

describe("price-check candidate retention", () => {
  it("reports truncation while retaining the first 24 distinct candidates", () => {
    const merged = mergeObservationCandidates([], Array.from({ length: 25 }, (_, index) => cashCandidate(index)));

    expect(merged.candidates).toHaveLength(24);
    expect(merged.candidates.at(-1)?.ratePlanName).toBe("Rate 23");
    expect(merged.truncated).toBe(true);
  });

  it("deduplicates without reporting truncation", () => {
    const candidate = cashCandidate(1);
    const merged = mergeObservationCandidates([candidate], [candidate]);

    expect(merged).toEqual({ candidates: [candidate], truncated: false });
  });
});

describe("walking both Hyatt modes inside one capture", () => {
  it("switches to cash once when the run wants both, so a comparison has two sides", () => {
    const first = planInventoryModeSwitch(bookingContext());

    expect(first).toMatchObject({ capturedModes: ["award"], nextMode: "cash" });
  });

  it("stops after one switch rather than walking modes forever", () => {
    expect(planInventoryModeSwitch(bookingContext({ capturedModes: ["award"] }))).toBeNull();
  });

  it("never switches when only one inventory type was asked for", () => {
    expect(planInventoryModeSwitch(bookingContext({ inventoryTypes: ["cash"] }))).toBeNull();
    expect(planInventoryModeSwitch(bookingContext({ inventoryTypes: ["award"] }))).toBeNull();
  });
});
