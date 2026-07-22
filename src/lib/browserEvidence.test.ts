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
