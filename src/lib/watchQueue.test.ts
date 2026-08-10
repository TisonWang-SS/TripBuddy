import { describe, expect, it } from "vitest";
import { buildDuePriceCheckQueue, type WatchQueueBooking } from "@/lib/watchQueue";

const now = new Date("2026-08-10T12:00:00.000Z");
const base: WatchQueueBooking = {
  cancellationDeadline: new Date("2026-08-20T12:00:00.000Z"),
  checkIn: new Date("2026-08-22T00:00:00.000Z"),
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  hotelName: "Grand Hyatt Tokyo",
  id: "booking-1",
  priceCheckRuns: [],
  watchPlan: {
    awardEnabled: true,
    cashEnabled: true,
    consecutiveFailures: 0,
    enabled: true,
    lastCheckedAt: new Date("2026-08-10T00:00:00.000Z"),
    lastAttemptedAt: new Date("2026-08-10T00:00:00.000Z"),
    normalCadenceHours: 24,
    urgentCadenceHours: 6,
    urgentWindowHours: 72
  }
};

describe("foreground price-check queue", () => {
  it("queues never-checked bookings immediately", () => {
    const queue = buildDuePriceCheckQueue([
      { ...base, watchPlan: { ...base.watchPlan!, lastAttemptedAt: null, lastCheckedAt: null } }
    ], now);

    expect(queue).toMatchObject([{ bookingId: "booking-1", urgency: "normal" }]);
  });

  it("uses urgent cadence near the cancellation deadline", () => {
    const queue = buildDuePriceCheckQueue([
      {
        ...base,
        cancellationDeadline: new Date("2026-08-11T12:00:00.000Z"),
        watchPlan: {
          ...base.watchPlan!,
          lastAttemptedAt: new Date("2026-08-10T05:00:00.000Z"),
          lastCheckedAt: new Date("2026-08-10T05:00:00.000Z")
        }
      }
    ], now);

    expect(queue).toMatchObject([{ cadenceHours: 6, urgency: "urgent" }]);
  });

  it("omits checks that are not due or have been disabled", () => {
    const queue = buildDuePriceCheckQueue([
      { ...base, watchPlan: { ...base.watchPlan!, lastCheckedAt: new Date("2026-08-10T10:00:00.000Z") } },
      { ...base, id: "booking-2", watchPlan: { ...base.watchPlan!, enabled: false } }
    ], now);

    expect(queue).toEqual([]);
  });

  it("backs off repeated failures", () => {
    const queue = buildDuePriceCheckQueue([
      {
        ...base,
        watchPlan: {
          ...base.watchPlan!,
          consecutiveFailures: 2,
          lastAttemptedAt: new Date("2026-08-06T12:00:00.000Z"),
          lastCheckedAt: null
        }
      }
    ], now);

    expect(queue).toMatchObject([{ consecutiveFailures: 2, retryDelayHours: 96 }]);
  });

  it("keeps failed urgent checks due before the cancellation deadline", () => {
    const queue = buildDuePriceCheckQueue([
      {
        ...base,
        cancellationDeadline: new Date("2026-08-11T12:00:00.000Z"),
        watchPlan: {
          ...base.watchPlan!,
          consecutiveFailures: 4,
          lastAttemptedAt: new Date("2026-08-09T23:00:00.000Z"),
          lastCheckedAt: null
        }
      }
    ], now);

    expect(queue).toMatchObject([{
      consecutiveFailures: 4,
      retryDelayHours: 12,
      urgency: "urgent"
    }]);
  });

  it("hides a due booking while a price check is active", () => {
    const queue = buildDuePriceCheckQueue([
      { ...base, priceCheckRuns: [{ id: "run-1" }] }
    ], now);

    expect(queue).toEqual([]);
  });

  it("never shortens a configured cadence longer than the backoff cap", () => {
    const queue = buildDuePriceCheckQueue([
      {
        ...base,
        watchPlan: {
          ...base.watchPlan!,
          consecutiveFailures: 1,
          lastAttemptedAt: new Date("2026-07-01T00:00:00.000Z"),
          lastCheckedAt: null,
          normalCadenceHours: 240
        }
      }
    ], now);

    expect(queue).toMatchObject([{ retryDelayHours: 240 }]);
  });
});
