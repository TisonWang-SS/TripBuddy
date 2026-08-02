import { describe, expect, it } from "vitest";
import { supportedCurrencyValue } from "@/lib/currency";

describe("supported currencies", () => {
  it("accepts configured currency codes without changing their meaning", () => {
    expect(supportedCurrencyValue("cny")).toBe("CNY");
  });

  it("falls back safely for an unsupported code", () => {
    expect(supportedCurrencyValue("MYR", "CNY")).toBe("CNY");
  });
});
