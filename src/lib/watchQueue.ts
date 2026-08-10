export type WatchQueueBooking = {
  cancellationDeadline: Date | null;
  checkIn: Date;
  createdAt: Date;
  id: string;
  hotelName: string;
  watchPlan: {
    awardEnabled: boolean;
    cashEnabled: boolean;
    enabled: boolean;
    lastCheckedAt: Date | null;
    normalCadenceHours: number;
    urgentCadenceHours: number;
    urgentWindowHours: number;
  } | null;
};

export type DuePriceCheck = {
  bookingId: string;
  cadenceHours: number;
  hotelName: string;
  nextCheckAt: Date;
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
  if (!plan?.enabled || (!plan.cashEnabled && !plan.awardEnabled)) {
    return null;
  }

  const hoursToCancellation = booking.cancellationDeadline
    ? (booking.cancellationDeadline.getTime() - now.getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;
  const urgency =
    hoursToCancellation >= 0 && hoursToCancellation <= plan.urgentWindowHours ? "urgent" : "normal";
  const cadenceHours = urgency === "urgent" ? plan.urgentCadenceHours : plan.normalCadenceHours;
  const anchor = plan.lastCheckedAt ?? booking.createdAt;

  return {
    bookingId: booking.id,
    cadenceHours,
    hotelName: booking.hotelName,
    nextCheckAt: plan.lastCheckedAt
      ? new Date(anchor.getTime() + cadenceHours * 3_600_000)
      : anchor,
    urgency
  };
}
