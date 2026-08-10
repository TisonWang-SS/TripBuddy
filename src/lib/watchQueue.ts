export type WatchQueueBooking = {
  cancellationDeadline: Date | null;
  checkIn: Date;
  createdAt: Date;
  hasActiveRun: boolean;
  id: string;
  hotelName: string;
  watchPlan: {
    awardEnabled: boolean;
    cashEnabled: boolean;
    enabled: boolean;
    consecutiveFailures: number;
    lastCheckedAt: Date | null;
    lastAttemptedAt: Date | null;
    normalCadenceHours: number;
    urgentCadenceHours: number;
    urgentWindowHours: number;
  } | null;
};

export type DuePriceCheck = {
  bookingId: string;
  cadenceHours: number;
  consecutiveFailures: number;
  hotelName: string;
  nextCheckAt: Date;
  retryDelayHours: number;
  urgency: "normal" | "urgent";
};

export function buildDuePriceCheckQueue(bookings: readonly WatchQueueBooking[], now = new Date()): DuePriceCheck[] {
  return bookings
    .map((booking) => duePriceCheck(booking, now))
    .filter((item): item is DuePriceCheck => item !== null && item.nextCheckAt <= now)
    .sort((left, right) => {
      if (left.urgency !== right.urgency) {
        return left.urgency === "urgent" ? -1 : 1;
      }
      return left.nextCheckAt.getTime() - right.nextCheckAt.getTime();
    });
}

function duePriceCheck(booking: WatchQueueBooking, now: Date): DuePriceCheck | null {
  const plan = booking.watchPlan;
  if (!plan?.enabled || (!plan.cashEnabled && !plan.awardEnabled) || booking.hasActiveRun) {
    return null;
  }

  const hoursToCancellation = booking.cancellationDeadline
    ? (booking.cancellationDeadline.getTime() - now.getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const urgency =
    hoursToCancellation >= 0 && hoursToCancellation <= plan.urgentWindowHours ? "urgent" : "normal";
  const cadenceHours = urgency === "urgent" ? plan.urgentCadenceHours : plan.normalCadenceHours;
  const maximumRetryDelayHours = Math.max(cadenceHours, 168);
  const exponentialRetryDelayHours = Math.min(
    cadenceHours * 2 ** Math.min(plan.consecutiveFailures, 4),
    maximumRetryDelayHours
  );
  // A successful check remains fresh for the configured cadence. Only failures are
  // clamped so repeated collection errors cannot silence reminders past the deadline.
  const retryDelayHours =
    urgency === "urgent" && plan.consecutiveFailures > 0
      ? Math.min(exponentialRetryDelayHours, hoursToCancellation / 2)
      : exponentialRetryDelayHours;
  const anchor = latestDate(plan.lastAttemptedAt, plan.lastCheckedAt) ?? booking.createdAt;
  const hasAttempt = plan.lastAttemptedAt !== null || plan.lastCheckedAt !== null;

  return {
    bookingId: booking.id,
    cadenceHours,
    consecutiveFailures: plan.consecutiveFailures,
    hotelName: booking.hotelName,
    nextCheckAt: hasAttempt
      ? new Date(anchor.getTime() + retryDelayHours * 3_600_000)
      : anchor,
    retryDelayHours,
    urgency
  };
}

function latestDate(left: Date | null, right: Date | null) {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return left > right ? left : right;
}
