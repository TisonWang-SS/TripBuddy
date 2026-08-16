/*
 * The first capability that changes stored data without opening a browser.
 *
 * "Keep an eye on this one" is a thing people say, and until now the agent
 * could only answer it by describing a form to go and fill in. The obstacle was
 * not the writing — `WatchPlan` has been writable since the beginning — it was
 * that the only consent gate available belonged to browser tasks, so anything
 * wanting a press had to also want a Hyatt tab. `effect: "write"` separates the
 * two (see `@/lib/agent/types`).
 *
 * The cadence numbers stay the product's, not the model's. A traveler saying
 * "watch it closely" is expressing urgency, not proposing an interval, and a
 * model converting that sentiment into 6 hours would be inventing a number that
 * then governs how often a real browser opens.
 */

import { argsBag, optionalBoolean, optionalEnum, requireString } from "@/lib/agent/args";
import type { Capability } from "@/lib/agent/types";
import { prisma } from "@/lib/db";

const ATTENTION = ["routine", "close"] as const;

/**
 * Product-owned cadences, one per level of attention.
 *
 * `close` is deliberately not "as often as possible": every check is a visible
 * tab the user has to press for, so a cadence they will not keep up with is a
 * queue of guilt rather than a monitoring plan.
 */
const CADENCE = {
  close: { normalCadenceHours: 24, urgentCadenceHours: 12, urgentWindowHours: 96 },
  routine: { normalCadenceHours: 72, urgentCadenceHours: 24, urgentWindowHours: 72 }
} as const;

export type WatchPlanArgs = {
  attention: (typeof ATTENTION)[number];
  bookingId: string;
  watching: boolean;
};

export const setWatchPlan: Capability<WatchPlanArgs, { bookingId: string; hotelName: string; watching: boolean }> = {
  name: "set_watch_plan",
  keywords: ["watch", "keep an eye", "monitor", "track this", "stop watching", "remind me"],
  summary:
    "Turn price watching on or off for one booking, and how closely. Changes a stored setting; does not open a browser or run a check.",
  effect: "write",
  params: [
    {
      /*
       * Worded to send the reader to list_bookings rather than to the user.
       * "By the ref from an earlier result" read as a precondition: with no
       * earlier result the model asked which booking was meant, of a desk that
       * held exactly one.
       */
      description: "The booking to watch. Look it up with list_bookings if you do not already have it.",
      name: "bookingId",
      required: true,
      type: "string"
    },
    { description: "False to stop watching. Defaults to true.", name: "watching", required: false, type: "boolean" },
    {
      description:
        "How closely to watch. Use close only when the user asks for it; the product owns the actual intervals either way.",
      enumValues: ATTENTION,
      name: "attention",
      required: false,
      type: "enum"
    }
  ],
  describeChange({ attention, watching }) {
    if (!watching) {
      return "Stop watching this booking's price. Nothing already recorded is deleted, and no check runs.";
    }
    const cadence = CADENCE[attention];
    return (
      `Watch this booking's price every ${cadence.normalCadenceHours} hours, and every ${cadence.urgentCadenceHours} ` +
      `inside the ${cadence.urgentWindowHours} hours before its cancellation deadline. Each check still waits for your press.`
    );
  },
  parseArgs(raw) {
    const bag = argsBag(raw, ["attention", "bookingId", "watching"]);
    return {
      attention: optionalEnum(bag, "attention", ATTENTION) ?? "routine",
      bookingId: requireString(bag, "bookingId"),
      watching: optionalBoolean(bag, "watching") ?? true
    };
  },
  async precheck({ bookingId }) {
    const booking = await prisma.hotelBooking.findUnique({ select: { id: true }, where: { id: bookingId } });
    return booking
      ? null
      : {
          retryable:
            "No booking with that identifier. A ref like b1 only means anything in the turn that produced it — call list_bookings again in this turn and use the ref it returns."
        };
  },
  async run({ attention, bookingId, watching }) {
    const booking = await prisma.hotelBooking.findUnique({ select: { hotelName: true }, where: { id: bookingId } });
    if (!booking) {
      throw new Error("That booking no longer exists.");
    }
    const cadence = CADENCE[attention];
    await prisma.watchPlan.upsert({
      create: { bookingId, enabled: watching, ...cadence },
      update: { enabled: watching, ...(watching ? cadence : {}) },
      where: { bookingId }
    });
    return { bookingId, hotelName: booking.hotelName, watching };
  }
};
