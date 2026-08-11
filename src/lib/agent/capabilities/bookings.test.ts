import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBooking, listBookings } from "./bookings";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), findUnique: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { hotelBooking: { findMany: mocks.findMany, findUnique: mocks.findUnique } }
}));

const row = {
  id: "booking-1",
  baselineCashTotal: 314.23,
  baselinePoints: null,
  baselineType: "cash",
  bookingChannel: "direct",
  breakfastIncluded: false,
  cancellationDeadline: new Date("2026-09-08T15:00:00.000Z"),
  checkIn: new Date("2026-09-10T00:00:00.000Z"),
  checkOut: new Date("2026-09-12T00:00:00.000Z"),
  city: "Kuala Lumpur",
  currency: "USD",
  guests: 1,
  hotelGroup: "Hyatt",
  hotelName: "Grand Hyatt Kuala Lumpur",
  isSuite: false,
  loyaltyEligible: true,
  observations: [{ observedAt: new Date("2026-08-11T03:01:00.000Z") }],
  recommendations: [{ estimatedSavings: 0, qualityLevel: "needs_review", riskLevel: "high", verdict: "needs_review" }],
  roomType: "1 King Bed",
  watchPlan: { enabled: true }
};

describe("booking capabilities", () => {
  beforeEach(() => {
    mocks.findMany.mockReset().mockResolvedValue([row]);
    mocks.findUnique.mockReset().mockResolvedValue(null);
  });

  it("summarises a booking with its current verdict", async () => {
    const { bookings } = await listBookings.run({ scope: "upcoming" });
    expect(bookings).toHaveLength(1);
    expect(bookings[0]).toMatchObject({
      bookingId: "booking-1",
      checkIn: "2026-09-10",
      checkOut: "2026-09-12",
      hotelName: "Grand Hyatt Kuala Lumpur",
      nights: 2,
      verdict: "needs_review",
      watchEnabled: true
    });
  });

  /*
   * Capabilities return domain truth, not copy. Resolving enums belongs to the
   * presentation layer via @/lib/labels, so a capability result stays usable by
   * a caller that is not rendering anything.
   */
  it("returns stored enum values rather than resolved labels", async () => {
    const { bookings } = await listBookings.run({ scope: "upcoming" });
    expect(bookings[0].verdict).toBe("needs_review");
    expect(bookings[0].qualityLevel).toBe("needs_review");
    expect(bookings[0].baselineType).toBe("cash");
    expect(JSON.stringify(bookings[0])).not.toContain("Needs review");
  });

  it("serializes instants and calendar dates differently", async () => {
    const { bookings } = await listBookings.run({ scope: "upcoming" });
    expect(bookings[0].checkIn).toBe("2026-09-10");
    expect(bookings[0].cancellationDeadline).toBe("2026-09-08T15:00:00.000Z");
    expect(bookings[0].lastObservedAt).toBe("2026-08-11T03:01:00.000Z");
  });

  it("filters to upcoming stays by default and drops the filter for all", async () => {
    await listBookings.run({ scope: "upcoming" });
    expect(mocks.findMany.mock.calls[0][0].where).toHaveProperty("checkIn");

    await listBookings.run({ scope: "all" });
    expect(mocks.findMany.mock.calls[1][0].where).toEqual({});
  });

  it("defaults the scope to upcoming", () => {
    expect(listBookings.parseArgs({})).toEqual({ scope: "upcoming" });
    expect(listBookings.parseArgs(undefined)).toEqual({ scope: "upcoming" });
  });

  it("reports a missing booking as null rather than throwing", async () => {
    expect(await getBooking.run({ bookingId: "nope" })).toEqual({ booking: null });
  });

  it("includes the watch plan when the booking has one", async () => {
    mocks.findUnique.mockResolvedValue({
      ...row,
      watchPlan: {
        awardEnabled: true,
        cashEnabled: true,
        consecutiveFailures: 0,
        enabled: true,
        lastCheckedAt: new Date("2026-08-11T03:01:00.000Z"),
        normalCadenceHours: 24,
        urgentCadenceHours: 6,
        urgentWindowHours: 72
      }
    });
    const { booking } = await getBooking.run({ bookingId: "booking-1" });
    expect(booking?.watchPlan).toMatchObject({ enabled: true, normalCadenceHours: 24, urgentCadenceHours: 6 });
    expect(booking?.watchPlan?.lastCheckedAt).toBe("2026-08-11T03:01:00.000Z");
  });
});
