import { describe, expect, it } from "vitest";
import { formatDateTimeInput, formatMoney } from "@/lib/format";

describe("money formatting", () => {
  it("preserves cents when the amount has a fractional part", () => {
    expect(formatMoney(614.48, "USD")).toBe("$614.48");
  });

  it("keeps whole amounts compact", () => {
    expect(formatMoney(614, "USD")).toBe("$614");
  });

  it("round-trips datetime-local values as local wall time", () => {
    const localDeadline = new Date(2026, 8, 8, 20, 30);
    const inputValue = formatDateTimeInput(localDeadline);

    expect(inputValue).toBe("2026-09-08T20:30");
    expect(new Date(inputValue).getTime()).toBe(localDeadline.getTime());
  });
});
