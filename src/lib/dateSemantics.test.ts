import { describe, expect, it } from "vitest";
import {
  calendarDayOf,
  localDayAsCalendarDate,
  localInstantDayOf,
  parseCalendarDate
} from "@/lib/dateSemantics";

describe("date semantics", () => {
  it("keeps stored calendar days distinct from local instant days", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const instant = new Date("2026-09-10T00:00:00.000Z");

      expect(calendarDayOf(instant)).toBe(Date.UTC(2026, 8, 10));
      expect(localInstantDayOf(instant)).toBe(Date.UTC(2026, 8, 9));
      expect(localDayAsCalendarDate(instant).toISOString()).toBe("2026-09-09T00:00:00.000Z");
    } finally {
      process.env.TZ = previousTimezone ?? "UTC";
    }
  });

  it("parses only valid, zero-padded HTML calendar dates", () => {
    expect(parseCalendarDate("2026-09-10").toISOString()).toBe("2026-09-10T00:00:00.000Z");

    for (const invalid of ["2026-02-30", "2026-9-10", "10/09/2026"]) {
      expect(parseCalendarDate(invalid).getTime(), invalid).toBeNaN();
    }
  });
});
