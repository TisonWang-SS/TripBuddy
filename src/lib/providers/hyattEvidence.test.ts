import { describe, expect, it } from "vitest";
import { evaluateTextEvidenceExtractor } from "@/lib/providers/extractionEvaluation";
import { hyattEvidenceFixtures } from "@/lib/providers/hyattEvidence.fixtures";
import { normalizeBrowserEvidencePayload, parseHyattEvidenceFromText } from "@/lib/providers/hyattEvidence";
import baseline from "../../../docs/evals/hyatt-evidence-deterministic-baseline.json";

describe("Hyatt evidence extraction", () => {
  it("scores the deterministic extractor against the shared fixture set", () => {
    const report = evaluateTextEvidenceExtractor(hyattEvidenceFixtures, parseHyattEvidenceFromText);

    expect(report.failures).toEqual([]);
    expect(report.fixtures).toEqual({ passed: hyattEvidenceFixtures.length, total: hyattEvidenceFixtures.length });
    expect(report.assertions.passed).toBe(report.assertions.total);
    expect(report.score).toBe(1);
    expect(report).toMatchObject({
      assertions: baseline.assertions,
      fixtures: baseline.fixtures,
      score: baseline.score
    });
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
      totalPrice: null
    });
    /* An extension payload that states no basis cannot acquire one here. */
    expect(normalized.candidates[0].pointsBasis).toBe("unknown");
  });

  it("marks a room-list points rate as nightly and a summary one as the whole stay", () => {
    const roomList = parseHyattEvidenceFromText(
      "SELECT A ROOM 1 King Bed Member Rate 25,000 points Avg/Night Select & Book",
      "https://www.hyatt.com/shop/rooms/kulgh?checkinDate=2026-09-10&checkoutDate=2026-09-13"
    );
    const summary = parseHyattEvidenceFromText(
      "Price Summary 1 King Bed Total Points 75,000 points Taxes & Fees USD 90.00",
      "https://www.hyatt.com/booking/summary?checkinDate=2026-09-10&checkoutDate=2026-09-13"
    );

    expect(roomList.find((candidate) => candidate.inventoryType === "award")?.pointsBasis).toBe("per_night");
    expect(summary.find((candidate) => candidate.inventoryType === "award")?.pointsBasis).toBe("stay_total");
  });

  /*
   * Verbatim from a real Hyatt points room list. The amount is separated from
   * its unit by the rate count, which is why the adjacent-unit pattern alone
   * read a page of award rates as having none.
   */
  const HYATT_POINTS_ROOM_LIST =
    "ROOMS (4) SUITES (3) 1 King Bed Relax in this elegant 47-square-meter room overlooking Kuala Lumpur's city skyline. " +
    "View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night SELECT & BOOK " +
    "1 King Bed with Club Access Stunning city views and Grand Club lounge access. " +
    "View Room Details From World of Hyatt Club Point Free Night Award 17,000 +1 more rates Points/Night SELECT & BOOK";

  it("prices a nightly free-night award for the whole stay, because points carry no tax", () => {
    const candidates = parseHyattEvidenceFromText(
      HYATT_POINTS_ROOM_LIST,
      "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-09-10&checkoutDate=2026-09-12"
    );
    const awards = candidates.filter((candidate) => candidate.inventoryType === "award");

    /* Two nights, so the nightly 12,000 and 17,000 are the stay's 24,000 and 34,000. */
    expect(awards.map((award) => award.pointsPrice)).toEqual([24_000, 34_000]);
    expect(awards.every((award) => award.pointsBasis === "stay_total")).toBe(true);
  });

  /*
   * Verbatim from the expanded rate card of a real run. One card, two awards:
   * the points-only one is complete, the points-plus-cash one is not, because
   * its cash half is quoted before tax like any other nightly cash rate.
   */
  it("does not let a points-plus-cash rate pass as a cheap points-only price", () => {
    const candidates = parseHyattEvidenceFromText(
      "1 King Bed Choose Your Rate Showing rates for Thu, Sep 10, 2026 - Sat, Sep 12, 2026 " +
        "World of Hyatt Free Night Award from 12,000 Points Plus Cash from 6,000 + $91 From 12,000 Points/Night " +
        "Deposit Policy CREDIT CARD REQUIRED Sign In or Join to book SELECT",
      "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-09-10&checkoutDate=2026-09-12"
    );
    const awards = candidates.filter((candidate) => candidate.inventoryType === "award");
    expect(awards.map((award) => [award.pointsPrice, award.pointsBasis])).toEqual([
      [24_000, "stay_total"],
      /* 6,000 buys the night with cash on top, so it is not a stay price. */
      [6_000, "per_night"]
    ]);
  });

  it("does not read Hyatt's rate count as the cash half of a points-plus-cash rate", () => {
    /* "+1 more rates" carries a digit right after a plus sign, exactly where a
     * cash amount would sit; only the currency mark tells them apart. */
    const awards = parseHyattEvidenceFromText(
      HYATT_POINTS_ROOM_LIST,
      "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-09-10&checkoutDate=2026-09-12"
    ).filter((candidate) => candidate.inventoryType === "award");

    expect(awards.every((award) => award.pointsBasis === "stay_total")).toBe(true);
  });

  it("reads a non-dollar cash half as cash too", () => {
    const awards = parseHyattEvidenceFromText(
      "1 King Bed World of Hyatt Free Night Award from 12,000 Points Plus Cash from 6,000 + MYR 400 From 12,000 Points/Night",
      "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-09-10&checkoutDate=2026-09-12"
    ).filter((candidate) => candidate.inventoryType === "award");

    expect(awards.find((award) => award.pointsPrice === 6_000)?.pointsBasis).toBe("per_night");
  });

  it("refuses to call an earning figure a stay price", () => {
    const earning = parseHyattEvidenceFromText(
      "1 King Bed Member Rate USD 350 Earn 5,000 points on this stay Select & Book",
      "https://www.hyatt.com/shop/rooms/kulgh?checkinDate=2026-09-10&checkoutDate=2026-09-13"
    );

    /*
     * The extractor still mints a candidate from "5,000 points" — that is
     * older behaviour and out of scope here. What must hold is that it never
     * claims to be a stay price, because that is the only route by which it
     * could reach a cash-versus-points conclusion.
     */
    expect(earning.find((candidate) => candidate.inventoryType === "award")?.pointsBasis).not.toBe("stay_total");
  });
});

describe("cancellation terms on a points room list", () => {
  /* Verbatim from a real capture: no sentence punctuation anywhere, so a
   * policy read to the next full stop ran into the following room's card. */
  const twoCards =
    "1 King Bed View Room Details From World of Hyatt Free Night Award 12,000 +1 more rates Points/Night " +
    "Cancellation Policy 11:59PM HOTEL TIME 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE /CCARD RQRD Deposit Policy CREDIT CARD REQUIRED " +
    "Sign In or Join to book SELECT 2 Twin Beds Grand Hyatt Kuala Lumpur Award Category 3";

  it("stops the policy at its own card", () => {
    const award = parseHyattEvidenceFromText(
      twoCards,
      "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-09-10&checkoutDate=2026-09-12"
    ).find((candidate) => candidate.inventoryType === "award");

    expect(award?.cancellationPolicyRaw).toBe(
      "Cancellation Policy 11:59PM HOTEL TIME 2 DAYS BFR ARRV OR PAY 1 NIGHT FEE /CCARD RQRD Deposit Policy CREDIT CARD REQUIRED"
    );
    expect(award?.cancellationPolicyRaw).not.toContain("2 Twin Beds");
  });
});
