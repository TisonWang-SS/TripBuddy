import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityArgsError } from "@/lib/agent/args";

const mocks = vi.hoisted(() => ({ findUnique: vi.fn(), upsert: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: { hotelBooking: { findUnique: mocks.findUnique }, watchPlan: { upsert: mocks.upsert } }
}));

const { setWatchPlan } = await import("@/lib/agent/capabilities/watch");

describe("set_watch_plan", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({ hotelName: "Grand Hyatt Kuala Lumpur", id: "b-1" });
  });

  /* A write is gated by its effect, not by remembering to opt in. */
  it("declares itself as changing stored data", () => {
    expect(setWatchPlan.effect).toBe("write");
  });

  /*
   * Both spellings arrive in practice: a model writes `true` as often as
   * `"true"`, and a confirmation press re-sends whatever the first parse
   * produced. Modelled as an enum of "true"/"false" at first, which rejected the
   * boolean — an already-confirmed write then failed on its own arguments, live.
   */
  it("accepts a boolean and its string spelling", () => {
    expect(setWatchPlan.parseArgs({ bookingId: "b-1", watching: true })).toMatchObject({ watching: true });
    expect(setWatchPlan.parseArgs({ bookingId: "b-1", watching: "false" })).toMatchObject({ watching: false });
    expect(setWatchPlan.parseArgs({ bookingId: "b-1" })).toMatchObject({ watching: true });
    expect(() => setWatchPlan.parseArgs({ bookingId: "b-1", watching: "maybe" })).toThrow(CapabilityArgsError);
  });

  /*
   * The cadence is the product's. "Watch it closely" is an expression of
   * urgency, not a proposed interval, and every check it schedules is a real
   * browser tab someone has to press for.
   */
  it("keeps the intervals out of the model's hands", async () => {
    await setWatchPlan.run({ attention: "close", bookingId: "b-1", watching: true });

    expect(mocks.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { enabled: true, normalCadenceHours: 24, urgentCadenceHours: 12, urgentWindowHours: 96 }
      })
    );
    /* And no argument exists through which a caller could supply one. */
    expect(setWatchPlan.params.map((param) => param.name).sort()).toEqual(["attention", "bookingId", "watching"]);
  });

  it("leaves the cadence alone when switching watching off", async () => {
    await setWatchPlan.run({ attention: "routine", bookingId: "b-1", watching: false });

    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: { enabled: false } }));
  });

  /* What the press agrees to, in the user's terms, written by the product. */
  it("describes the change before it happens", () => {
    /* Narrowed rather than asserted: `describeChange` exists only on a write. */
    if (setWatchPlan.effect !== "write") {
      throw new Error("set_watch_plan must be a write capability.");
    }
    expect(setWatchPlan.describeChange({ attention: "close", bookingId: "b-1", watching: true })).toContain("every 24 hours");
    expect(setWatchPlan.describeChange({ attention: "close", bookingId: "b-1", watching: false })).toContain(
      "Nothing already recorded is deleted"
    );
  });

  it("asks rather than failing when the booking is gone", async () => {
    mocks.findUnique.mockResolvedValue(null);

    expect(await setWatchPlan.precheck!({ attention: "routine", bookingId: "b-gone", watching: true })).toContain(
      "could not find that booking"
    );
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});
