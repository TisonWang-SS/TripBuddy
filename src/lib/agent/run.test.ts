import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "./events";
import { runAgentRequest } from "./run";

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

async function collect(request: Parameters<typeof runAgentRequest>[0]) {
  const events: AgentEvent[] = [];
  await runAgentRequest(request, (event) => events.push(event), { now: () => 0, runId: "run-1" });
  return events;
}

function saidText(events: AgentEvent[]) {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => ("delta" in event ? event.delta : ""))
    .join("");
}

function types(events: AgentEvent[]) {
  return events.map((event) => event.type);
}

describe("agent run", () => {
  beforeEach(() => {
    /* No key configured, so routing takes the deterministic path in these tests. */
    vi.stubEnv("TRIPBUDDY_LLM_API_KEY", "");
    mocks.findManyBookings.mockReset().mockResolvedValue([]);
    mocks.runPriceCheck.mockReset();
    mocks.createAccountImportTask.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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
      /* The rendered form of the same result. */
      "CUSTOM",
      "RUN_FINISHED"
    ]);
  });

  it("emits the surface composed from the result", async () => {
    const events = await collect({ capability: "list_bookings" });
    const surface = events.find((event) => event.type === "CUSTOM" && event.name === "surface");
    expect(surface && "value" in surface && surface.value).toMatchObject({
      nodes: [{ component: "Message", props: { text: "Nothing on the desk yet." } }],
      version: "tripbuddy-surface-1"
    });
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
    const launch = events.find((event) => event.type === "CUSTOM" && event.name === "browser_task_launch");
    expect(launch && "value" in launch && launch.value).toEqual({
      capability: "run_price_check",
      resultRoute: "/bookings/booking-1"
    });
  });

  /*
   * The launch is the whole result of a browser task, so it has to be renderable
   * on its own. Without this the confirmed run answers with an empty panel and
   * the client has no launch URL for the tab it opened.
   */
  it("composes the launch as the surface for a confirmed browser task", async () => {
    mocks.runPriceCheck.mockResolvedValue({ launchUrl: "https://www.hyatt.com/", taskId: "task-1" });
    const events = await collect({ args: { bookingId: "booking-1" }, capability: "run_price_check", confirmed: true });

    const surface = events.find((event) => event.type === "CUSTOM" && event.name === "surface");
    expect(surface && "value" in surface && surface.value).toMatchObject({
      nodes: [
        {
          component: "TaskLaunch",
          props: {
            capability: "run_price_check",
            launchUrl: "https://www.hyatt.com/",
            resultRoute: "/bookings/booking-1"
          }
        }
      ]
    });
  });

  it("does not emit a launch target for a read capability", async () => {
    const events = await collect({ capability: "list_bookings" });
    const names = events.filter((event) => event.type === "CUSTOM").map((event) => ("name" in event ? event.name : ""));
    expect(names).not.toContain("browser_task_launch");
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

describe("agent run — routing a message", () => {
  beforeEach(() => {
    vi.stubEnv("TRIPBUDDY_LLM_API_KEY", "");
    mocks.findManyBookings.mockReset().mockResolvedValue([]);
    mocks.runPriceCheck.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /* Routing is a visible step, so the interface can show what was understood. */
  it("routes a sentence and reports routing as its own step", async () => {
    const events = await collect({ message: "show me my bookings" });
    expect(types(events)).toEqual([
      "RUN_STARTED",
      "STEP_STARTED",
      "STEP_FINISHED",
      "TOOL_CALL_START",
      "TOOL_CALL_ARGS",
      "TOOL_CALL_END",
      "STEP_STARTED",
      "STEP_FINISHED",
      "TOOL_CALL_RESULT",
      "CUSTOM",
      "RUN_FINISHED"
    ]);
    const call = events.find((event) => event.type === "TOOL_CALL_START");
    expect(call && "toolCallName" in call && call.toolCallName).toBe("list_bookings");
  });

  /*
   * An out-of-scope request ends in words rather than a call, and the words are
   * product-owned copy — the model never writes what the user reads.
   */
  it("answers an out-of-scope request in words, without calling anything", async () => {
    const events = await collect({ message: "what time is the train to Kyoto" });
    expect(types(events)).toEqual([
      "RUN_STARTED",
      "STEP_STARTED",
      "STEP_FINISHED",
      "TEXT_MESSAGE_START",
      "TEXT_MESSAGE_CONTENT",
      "TEXT_MESSAGE_END",
      "CUSTOM",
      "RUN_FINISHED"
    ]);
    expect(saidText(events)).toContain("only tracks Hyatt hotel bookings");
    expect(mocks.findManyBookings).not.toHaveBeenCalled();
  });

  it("refuses an action the product never takes", async () => {
    const events = await collect({ message: "cancel my reservation for me" });
    expect(saidText(events)).toContain("never books, cancels");
    expect(types(events)).not.toContain("TOOL_CALL_START");
  });

  it("asks for a missing argument instead of running", async () => {
    const events = await collect({ message: "run a price check" });
    expect(saidText(events)).toContain("booking identifier");
    expect(mocks.runPriceCheck).not.toHaveBeenCalled();
  });

  it("prefers an explicit capability over routing the message", async () => {
    const events = await collect({ capability: "list_bookings", message: "cancel everything" });
    expect(types(events)).not.toContain("TEXT_MESSAGE_START");
    expect(types(events)).toContain("RUN_FINISHED");
  });
});
