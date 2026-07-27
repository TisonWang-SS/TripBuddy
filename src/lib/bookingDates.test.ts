import { describe, expect, it } from "vitest";
import { isActiveBookingDate, startOfToday } from "@/lib/bookingDates";

describe("booking date helpers", () => {
  it("uses local start of day as the active booking boundary", () => {
    const now = new Date("2026-07-27T12:00:00+08:00");

    expect(startOfToday(now).getFullYear()).toBe(2026);
    expect(startOfToday(now).getMonth()).toBe(6);
    expect(startOfToday(now).getDate()).toBe(27);
    expect(isActiveBookingDate(new Date("2026-07-27T00:00:00+08:00"), now)).toBe(true);
    expect(isActiveBookingDate(new Date("2026-07-26T23:59:59+08:00"), now)).toBe(false);
  });
});
