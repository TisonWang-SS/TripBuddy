import { describe, expect, it } from "vitest";
import {
  formatCalendarDate,
  formatCalendarDateInput,
  formatLocalInstantInput,
  formatMoney,
  formatRetryDelay
} from "@/lib/format";

describe("money formatting", () => {
  it("preserves cents when the amount has a fractional part", () => {
    expect(formatMoney(614.48, "USD")).toBe("$614.48");
  });

  it("keeps whole amounts compact", () => {
    expect(formatMoney(614, "USD")).toBe("$614");
  });

  it("round-trips datetime-local values as local wall time", () => {
    const localDeadline = new Date(2026, 8, 8, 20, 30);
    const inputValue = formatLocalInstantInput(localDeadline);

    expect(inputValue).toBe("2026-09-08T20:30");
    expect(new Date(inputValue).getTime()).toBe(localDeadline.getTime());
  });

  it("formats UTC-midnight calendar dates without shifting them into the local timezone", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const calendarDate = new Date("2026-09-10T00:00:00.000Z");

      expect(formatCalendarDate(calendarDate)).toBe("Sep 10, 2026");
      expect(formatCalendarDateInput(calendarDate)).toBe("2026-09-10");
    } finally {
      process.env.TZ = previousTimezone ?? "UTC";
    }
  });

  it("formats fractional retry delays for display", () => {
    expect(formatRetryDelay(8.866666666666667)).toBe("in 9 hours");
    expect(formatRetryDelay(0.5)).toBe("in 30 minutes");
    expect(formatRetryDelay(1)).toBe("in 1 hour");
    expect(formatRetryDelay(0)).toBe("now");
  });
});
