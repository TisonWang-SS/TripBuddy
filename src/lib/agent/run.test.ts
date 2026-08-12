import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./events";
import { runCapability } from "./run";

const mocks = vi.hoisted(() => ({
  createAccountImportTask: vi.fn(),
  createHotelSearchTask: vi.fn(),
  findManyBookings: vi.fn(),
  runPriceCheck: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    currencyConversionRate: { findMany: vi.fn().mockResolvedValue([]) },
    hotelBooking: { findMany: mocks.findManyBookings, findUnique: vi.fn().mockResolvedValue(null) },
    priceCheckRun: { findMany: vi.fn().mockResolvedValue([]) },
    priceObservation: { findMany: vi.fn().mockResolvedValue([]) },
    recommendation: { findFirst: vi.fn().mockResolvedValue(null) },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) }
  }
}));

vi.mock("@/lib/priceChecks", () => ({
  BrowserCompanionPriceCheckRunner: class {
    run = mocks.runPriceCheck;
  }
}));

vi.mock("@/lib/accountImportTasks", () => ({ createAccountImportTask: mocks.createAccountImportTask }));

vi.mock("@/lib/hotelSearchTasks", () => ({
  createHotelSearchTask: mocks.createHotelSearchTask,
  supportedHotelSearchGroups: () => ["Hyatt"]
}));

async function collect(request: Parameters<typeof runCapability>[0]) {
  const events: AgentEvent[] = [];
  await runCapability(request, (event) => events.push(event), { now: () => 0, runId: "run-1" });
  return events;
}

function types(events: AgentEvent[]) {
  return events.map((event) => event.type);
}

describe("agent run", () => {
  beforeEach(() => {
    mocks.findManyBookings.mockReset().mockResolvedValue([]);
    mocks.runPriceCheck.mockReset();
    mocks.createAccountImportTask.mockReset();
  });

  it("reports a read capability as a complete run", async () => {
    const events = await collect({ capability: "list_bookings" });
    expect(types(events)).toEqual([
      "RUN_STARTED",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "STEP_STARTED",
      "STEP_FINISHED",
      "TOOL_CALL_RESULT",
      "RUN_FINISHED"
    ]);
  });

  it("carries the result as the tool call result", async () => {
    const events = await collect({ capability: "list_bookings" });
    const result = events.find((event) => event.type === "TOOL_CALL_RESULT");
    expect(result && "content" in result && JSON.parse(result.content)).toEqual({ bookings: [] });
  });

  /* The stream announces the arguments actually used, defaults included. */
  it("announces parsed arguments rather than the raw request", async () => {
    const events = await collect({ capability: "list_bookings", args: {} });
    const args = events.find((event) => event.type === "TOOL_CALL_ARGS");
    expect(args && "delta" in args && JSON.parse(args.delta)).toEqual({ scope: "upcoming" });
  });

  it("ends an unknown capability with an error and no completion", async () => {
    const events = await collect({ capability: "book_the_room" });
    expect(types(events)).toEqual(["RUN_STARTED", "RUN_ERROR"]);
    const error = events.at(-1);
    expect(error && "code" in error && error.code).toBe("unknown_capability");
  });

  /*
   * Invalid arguments must stop the run before the capability executes, so
   * STEP_STARTED is the assertion that matters here, not the error code alone.
   */
  it("fails invalid arguments before the capability runs", async () => {
    const events = await collect({ capability: "list_bookings", args: { scope: "everything" } });
    expect(types(events)).toEqual(["RUN_STARTED", "TOOL_CALL_START", "RUN_ERROR"]);
    expect(types(events)).not.toContain("STEP_STARTED");
    const error = events.at(-1);
    expect(error && "code" in error && error.code).toBe("invalid_args");
  });

  /*
   * The client learns that an action needs a press from this code, then re-sends
   * the same request with `confirmed`. The tab is never opened in between.
   */
  it("reports an unconfirmed browser task as confirmation_required without running it", async () => {
    const events = await collect({ args: { bookingId: "booking-1" }, capability: "run_price_check" });
    const error = events.at(-1);
    expect(error && "code" in error && error.code).toBe("confirmation_required");
    expect(types(events)).not.toContain("RUN_FINISHED");
    expect(mocks.runPriceCheck).not.toHaveBeenCalled();
  });

  it("runs a confirmed browser task and names where its result renders", async () => {
    mocks.runPriceCheck.mockResolvedValue({ launchUrl: "https://www.hyatt.com/", taskId: "task-1" });
    const events = await collect({ args: { bookingId: "booking-1" }, capability: "run_price_check", confirmed: true });

    expect(types(events)).toContain("RUN_FINISHED");
    const custom = events.find((event) => event.type === "CUSTOM");
    expect(custom && "value" in custom && custom.value).toEqual({
      capability: "run_price_check",
      resultRoute: "/bookings/booking-1"
    });
  });

  it("does not emit a launch target for a read capability", async () => {
    const events = await collect({ capability: "list_bookings" });
    expect(types(events)).not.toContain("CUSTOM");
  });

  it("passes a capability failure through with its own code", async () => {
    mocks.findManyBookings.mockRejectedValue(Object.assign(new Error("database is gone"), { code: "db_unavailable" }));
    const events = await collect({ capability: "list_bookings" });
    const error = events.at(-1);
    expect(error && "code" in error && error.code).toBe("db_unavailable");
    expect(error && "message" in error && error.message).toBe("database is gone");
  });

  it("falls back to a generic code when a failure carries none", async () => {
    mocks.findManyBookings.mockRejectedValue(new Error("something broke"));
    const events = await collect({ capability: "list_bookings" });
    const error = events.at(-1);
    expect(error && "code" in error && error.code).toBe("capability_failed");
  });
});
