import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";

describe("money formatting", () => {
  it("preserves cents when the amount has a fractional part", () => {
    expect(formatMoney(614.48, "USD")).toBe("$614.48");
  });

  it("keeps whole amounts compact", () => {
    expect(formatMoney(614, "USD")).toBe("$614");
  });
});
