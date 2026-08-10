import { describe, expect, it } from "vitest";
import { currentLocalDayAsCalendarDate, isActiveBookingDate } from "@/lib/bookingDates";

describe("booking date helpers", () => {
  it("compares stored calendar dates with the current local calendar day", () => {
    const previousTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const now = new Date("2026-07-27T19:00:00.000Z");

      expect(currentLocalDayAsCalendarDate(now).toISOString()).toBe("2026-07-27T00:00:00.000Z");
      expect(isActiveBookingDate(new Date("2026-07-27T00:00:00.000Z"), now)).toBe(true);
      expect(isActiveBookingDate(new Date("2026-07-26T00:00:00.000Z"), now)).toBe(false);
    } finally {
      process.env.TZ = previousTimezone ?? "UTC";
    }
  });

});
