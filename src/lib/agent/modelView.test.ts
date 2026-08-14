import { describe, expect, it } from "vitest";
import { numbersInView, observeToolResult, ungroundedNumbers } from "@/lib/agent/modelView";

/*
 * The projection is what stands between a Hyatt page and the model's context,
 * and the number check is what stands between the model's prose and a person
 * deciding whether to rebook. Both are asserted on their edges.
 */

describe("what the model is shown", () => {
  it("keeps identifiers the model has no use for out of the view", () => {
    const observed = observeToolResult("list_bookings", {
      bookings: [
        {
          baselineCashTotal: 314.23,
          baselinePoints: null,
          baselineType: "cash",
          bookingId: "booking-1",
          cancellationDeadline: null,
          checkIn: "2026-09-10",
          checkOut: "2026-09-12",
          city: "Kuala Lumpur",
          currency: "USD",
          estimatedSavings: null,
          hotelGroup: "Hyatt",
          hotelName: "Grand Hyatt Kuala Lumpur",
          lastObservedAt: null,
          nights: 2,
          qualityLevel: null,
          riskLevel: null,
          verdict: "keep_booking",
          watchEnabled: true
        }
      ]
    });

    expect(JSON.stringify(observed.view)).not.toContain("booking-1");
    /* But the ref that stands for it resolves back, for a recommendation. */
    expect(observed.refs).toEqual({ b1: "booking-1" });
  });

  it("caps free text that came off a page", () => {
    const observed = observeToolResult("get_booking", {
      booking: { city: "Tokyo", currency: "JPY", hotelName: "H".repeat(400), nights: 1 }
    });
    expect(JSON.stringify(observed.view).length).toBeLessThan(600);
  });
});

describe("grounding what the model writes", () => {
  const view = { nights: 2, stayTotal: 4200 };

  it("rejects a money-sized figure the tools never produced", () => {
    expect(ungroundedNumbers("只要 1899 元。", numbersInView(view))).toEqual([1899]);
  });

  it("accepts a shown figure and a difference between shown figures", () => {
    expect(ungroundedNumbers("4200 元，比另一家低 4198。", numbersInView(view))).toEqual([]);
  });

  it("ignores numbers too small to be a price", () => {
    expect(ungroundedNumbers("2 晚 2 人，第 3 晚另算。", numbersInView(view))).toEqual([]);
  });

  /*
   * Dates live in the view as strings. Before this, writing "2026年9月" back was
   * read as a fabricated four-figure amount and threw away a correct answer.
   */
  it("counts numbers inside strings as shown", () => {
    const dated = { checkIn: "2026-09-10", checkOut: "2026-09-12" };
    expect(ungroundedNumbers("2026 年 9 月 10 日入住。", numbersInView(dated))).toEqual([]);
  });
});
