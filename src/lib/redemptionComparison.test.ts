import { describe, expect, it } from "vitest";
import {
  compareRedemptionToCash,
  selectRedemptionPair,
  type RedemptionAwardSide,
  type RedemptionCashSide,
  type RedemptionObservation
} from "@/lib/redemptionComparison";

function cash(overrides: Partial<RedemptionCashSide> = {}): RedemptionCashSide {
  return {
    captureId: "run-1",
    currency: "USD",
    feesIncluded: "yes",
    roomLabel: "1 King Bed",
    taxesIncluded: "yes",
    total: 500,
    ...overrides
  };
}

function award(overrides: Partial<RedemptionAwardSide> = {}): RedemptionAwardSide {
  return {
    captureId: "run-1",
    copay: 0,
    copayCurrency: "USD",
    points: 25_000,
    pointsBasis: "stay_total",
    roomLabel: "1 King Bed",
    ...overrides
  };
}

const pointValuation = { amount: 0.017, currency: "USD" };

function observation(overrides: Partial<RedemptionObservation> = {}): RedemptionObservation {
  return {
    captureId: "run-1",
    cashCopay: null,
    cashCopayCurrency: null,
    cashCurrency: "USD",
    cashTotal: 500,
    feesIncluded: "yes",
    inventoryType: "cash",
    observedAt: new Date("2026-08-13T00:00:00Z"),
    points: null,
    pointsBasis: "stay_total",
    roomLabel: "1 King Bed",
    taxesIncluded: "yes",
    ...overrides
  };
}

describe("cash against points inside one capture", () => {
  it("concludes that points beat cash when the return per point exceeds the recorded value", () => {
    const result = compareRedemptionToCash({ award: award(), cash: cash(), pointValuation });

    expect(result.valuePerPoint).toBe(0.02);
    expect(result.pointValue).toBe(0.017);
    expect(result.verdict).toBe("redeem");
    expect(result.reason).toBeNull();
  });

  it("concludes that cash wins when the return per point falls short", () => {
    const result = compareRedemptionToCash({ award: award({ points: 40_000 }), cash: cash(), pointValuation });

    expect(result.valuePerPoint).toBe(0.0125);
    expect(result.verdict).toBe("pay_cash");
  });

  it("subtracts the cash the award still charges before dividing by points", () => {
    const result = compareRedemptionToCash({
      award: award({ copay: 100 }),
      cash: cash(),
      pointValuation
    });

    expect(result.copay).toBe(100);
    expect(result.valuePerPoint).toBe(0.016);
    expect(result.verdict).toBe("pay_cash");
  });

  it("does not compare two rates read in different captures", () => {
    const result = compareRedemptionToCash({ award: award({ captureId: "run-2" }), cash: cash(), pointValuation });

    expect(result.verdict).toBe("not_compared");
    expect(result.valuePerPoint).toBeNull();
    expect(result.reason).toBe("The cash rate and the award rate come from different captures, so they are not compared.");
  });

  it("does not compare two rates that name different rooms", () => {
    const result = compareRedemptionToCash({ award: award({ roomLabel: "Suite" }), cash: cash(), pointValuation });

    expect(result.verdict).toBe("not_compared");
    expect(result.reason).toBe("The cash rate and the award rate do not name the same room, so they are not compared.");
  });

  it("does not compare against a cash total whose taxes or fees are unverified", () => {
    const taxes = compareRedemptionToCash({ award: award(), cash: cash({ taxesIncluded: "unknown" }), pointValuation });
    const fees = compareRedemptionToCash({ award: award(), cash: cash({ feesIncluded: "no" }), pointValuation });

    expect([taxes.verdict, fees.verdict]).toEqual(["not_compared", "not_compared"]);
    expect(taxes.reason).toBe(
      "The cash total does not show taxes and fees as included, so it is not compared with the award rate."
    );
    expect(fees.reason).toBe(taxes.reason);
  });

  it("does not compare an award whose points requirement is missing", () => {
    const result = compareRedemptionToCash({ award: award({ points: null }), cash: cash(), pointValuation });

    expect(result.verdict).toBe("not_compared");
    expect(result.reason).toBe("The award rate does not state how many points it costs.");
  });

  /*
   * Why the basis guard exists, in the shape that produced it. A Hyatt room
   * list renders "USD 350 Avg/Night ... 25,000 points" in one snapshot, so a
   * single capture really can hold both sides — but the cash side arrives as a
   * stay total from the summary while the points side is still nightly.
   * Dividing one by the other does not merely blur the answer, it reverses it.
   */
  it("would invert the verdict if a nightly points figure were read as a stay total", () => {
    const threeNightCash = cash({ total: 990 });
    const nightly = compareRedemptionToCash({
      award: award({ points: 25_000, pointsBasis: "per_night" }),
      cash: threeNightCash,
      pointValuation
    });
    const wholeStay = compareRedemptionToCash({
      award: award({ points: 75_000, pointsBasis: "stay_total" }),
      cash: threeNightCash,
      pointValuation
    });

    expect(wholeStay.valuePerPoint).toBe(0.0132);
    expect(wholeStay.verdict).toBe("pay_cash");
    /* Read as a stay total the same figure returns 0.0396 and says "redeem". */
    expect(nightly.verdict).toBe("not_compared");
    expect(nightly.valuePerPoint).toBeNull();
  });

  it("refuses a points figure that has not shown whether it covers the stay or one night", () => {
    const result = compareRedemptionToCash({ award: award({ pointsBasis: "unknown" }), cash: cash(), pointValuation });

    expect(result.verdict).toBe("not_compared");
    expect(result.valuePerPoint).toBeNull();
    expect(result.reason).toBe(
      "The award rate does not show whether its points cover the stay or one night, so it is not compared."
    );
  });

  it("refuses a nightly points figure rather than dividing a stay total by it", () => {
    const result = compareRedemptionToCash({ award: award({ pointsBasis: "per_night" }), cash: cash(), pointValuation });

    expect(result.verdict).toBe("not_compared");
    expect(result.reason).toBe(
      "The award rate is quoted per night while the cash total covers the stay, so they are not compared."
    );
  });

  it("does not compare a copay and a cash total quoted in different currencies", () => {
    const result = compareRedemptionToCash({
      award: award({ copay: 80, copayCurrency: "CNY" }),
      cash: cash(),
      pointValuation
    });

    expect(result.verdict).toBe("not_compared");
    expect(result.reason).toBe("The award copay and the cash total are in different currencies, so they are not compared.");
  });

  it("shows the return per point but draws no conclusion without a recorded point value", () => {
    const result = compareRedemptionToCash({ award: award(), cash: cash(), pointValuation: null });

    expect(result.valuePerPoint).toBe(0.02);
    expect(result.verdict).toBe("not_compared");
    expect(result.reason).toBe("No point value is recorded, so this return per point has nothing to be measured against.");
  });

  it("does not measure a capture against a point value recorded in another currency", () => {
    const result = compareRedemptionToCash({
      award: award(),
      cash: cash(),
      pointValuation: { amount: 0.12, currency: "CNY" }
    });

    expect(result.valuePerPoint).toBe(0.02);
    expect(result.verdict).toBe("not_compared");
    expect(result.reason).toBe("The recorded point value is in CNY and this capture is in USD, so they are not compared.");
  });
});

describe("choosing which pair to compare", () => {
  it("takes the newest capture that holds both sides for one room", () => {
    const pair = selectRedemptionPair([
      observation({ captureId: "old", cashTotal: 400, observedAt: new Date("2026-08-01T00:00:00Z") }),
      observation({
        captureId: "old",
        inventoryType: "award",
        observedAt: new Date("2026-08-01T00:00:00Z"),
        points: 20_000
      }),
      observation({ captureId: "new", cashTotal: 500 }),
      observation({ captureId: "new", inventoryType: "award", points: 25_000 })
    ]);

    expect(pair?.cash.captureId).toBe("new");
    expect(pair?.award.points).toBe(25_000);
  });

  it("uses the cheapest cash rate in that capture, the hardest one for the award to beat", () => {
    const pair = selectRedemptionPair([
      observation({ cashTotal: 700 }),
      observation({ cashTotal: 420 }),
      observation({ inventoryType: "award", points: 25_000 })
    ]);

    expect(pair?.cash.cashTotal).toBe(420);
  });

  it("finds no pair when a capture holds only one side", () => {
    expect(selectRedemptionPair([observation(), observation({ cashTotal: 450 })])).toBeNull();
  });

  it("finds no pair across captures, so a manual observation never pairs with a browser one", () => {
    expect(
      selectRedemptionPair([
        observation({ captureId: null }),
        observation({ captureId: "run-1", inventoryType: "award", points: 25_000 })
      ])
    ).toBeNull();
  });
});
