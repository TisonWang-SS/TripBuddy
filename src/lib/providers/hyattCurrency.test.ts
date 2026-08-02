import { describe, expect, it } from "vitest";
import { normalizeHyattCurrency } from "@/lib/providers/hyattCurrency";

describe("Hyatt currency normalization", () => {
  it.each([
    ["$", "USD"],
    ["RM", "MYR"],
    ["CN¥", "CNY"],
    ["¥", "JPY"],
    ["HK$", "HKD"],
    ["€", "EUR"]
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeHyattCurrency(input)).toBe(expected);
  });
});
