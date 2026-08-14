import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent/events";

/*
 * The loop's contract, asserted at the level a reader cares about: what the user
 * sees, and what cannot happen to them.
 *
 * The planner and the capability layer are mocked, because neither is what this
 * file is about — the point is what the loop does with what they return. The
 * planner is scripted turn by turn, so a multi-step run is an explicit sequence
 * rather than something to hope a live model produces.
 */

const mocks = vi.hoisted(() => ({
  awaitBrowserTask: vi.fn(),
  getHotelSearchSession: vi.fn(),
  invokeCapability: vi.fn(),
  isPlannerConfigured: vi.fn(() => true),
  planNextStep: vi.fn(),
  routeIntent: vi.fn()
}));

vi.mock("@/lib/agent/planner", () => ({
  isPlannerConfigured: mocks.isPlannerConfigured,
  planNextStep: mocks.planNextStep
}));
vi.mock("@/lib/agent/browserTaskWait", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent/browserTaskWait")>("@/lib/agent/browserTaskWait");
  return { ...actual, awaitBrowserTask: mocks.awaitBrowserTask };
});
vi.mock("@/lib/hotelSearchSessions", () => ({ getHotelSearchSession: mocks.getHotelSearchSession }));
vi.mock("@/lib/agent/router", () => ({ routeIntent: mocks.routeIntent }));
vi.mock("@/lib/agent/registry", async () => {
  const actual = await vi.importActual<typeof import("@/lib/agent/registry")>("@/lib/agent/registry");
  return { ...actual, invokeCapability: mocks.invokeCapability };
});

const { runAgentTurn } = await import("@/lib/agent/loop");

async function collect(request: Parameters<typeof runAgentTurn>[0]) {
  const events: AgentEvent[] = [];
  await runAgentTurn(request, (event) => events.push(event), { now: () => 0, runId: "run-1" });
  return events;
}

function surfaces(events: readonly AgentEvent[]) {
  return events
    .filter((event) => event.type === "CUSTOM" && event.name === "surface")
    .map((event) => (event as Extract<AgentEvent, { type: "CUSTOM" }>).value as { nodes: { component: string; props: Record<string, unknown> }[] });
}

function spoken(events: readonly AgentEvent[]) {
  return events
    .filter((event) => event.type === "TEXT_MESSAGE_CONTENT")
    .map((event) => (event as Extract<AgentEvent, { type: "TEXT_MESSAGE_CONTENT" }>).delta)
    .join("");
}

const session = {
  createdAt: "2026-08-14T00:00:00.000Z",
  expiresAt: "2026-08-15T00:00:00.000Z",
  id: "sess-1",
  profileId: "primary",
  query: {
    adults: 2,
    budget: null,
    checkIn: "2026-09-01",
    checkOut: "2026-09-03",
    city: "Tokyo",
    cityAsAsked: "东京",
    currency: "CNY",
    hotelGroup: "Hyatt",
    priceMode: "cash" as const
  },
  results: {
    capturedAt: "2026-08-14T00:00:00.000Z",
    hotels: [
      {
        availabilityLabel: "Available",
        hotelGroup: "Hyatt",
        hotelKey: "hyatt|park-hyatt-tokyo|tokyo",
        hotelName: "Park Hyatt Tokyo",
        locationLabel: "Tokyo",
        offers: [
          {
            breakfastIncluded: null,
            cancellationPolicy: null,
            capturedAt: "2026-08-14T00:00:00.000Z",
            comparisonWarnings: [],
            currency: "CNY",
            displayedAmount: 3200,
            displayedPriceBasis: "tax_exclusive" as const,
            displayedPriceUnit: "avg_nightly" as const,
            eliteNightEligible: null,
            evidenceLevel: "starting_price" as const,
            feesAmount: null,
            feesIncluded: "unknown" as const,
            hotelGroup: "Hyatt",
            loyaltyEligible: null,
            nights: 2,
            offerKey: "o1",
            providerName: "Hyatt",
            ratePlanName: null,
            roomType: null,
            sourceName: "Hyatt",
            sourceType: "direct" as const,
            sourceUrl: "https://www.hyatt.com/shop",
            startingAvgNightlyRate: 3200,
            staySubtotal: null,
            stayTotal: null,
            taxesAmount: null,
            taxesAndFeesAmount: null,
            taxesIncluded: "unknown" as const
          }
        ]
      }
    ],
    summary: "1 hotel",
    warning: null
  },
  updatedAt: "2026-08-14T00:00:00.000Z"
};

describe("agent loop", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isPlannerConfigured.mockReturnValue(true);
    mocks.getHotelSearchSession.mockResolvedValue(session);
  });

  it("answers without tools when the planner already knows the answer", async () => {
    mocks.planNextStep.mockResolvedValue({ kind: "answer", message: "You have nothing booked yet.", picks: [] });

    const events = await collect({ message: "有什么要处理的吗" });

    expect(spoken(events)).toBe("You have nothing booked yet.");
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
    expect(mocks.invokeCapability).not.toHaveBeenCalled();
  });

  it("feeds a tool result back and answers from it", async () => {
    mocks.invokeCapability.mockResolvedValue({ result: { bookings: [] } });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools" })
      .mockResolvedValueOnce({ kind: "answer", message: "Nothing on the desk.", picks: [] });

    const events = await collect({ message: "show my stays" });

    expect(mocks.planNextStep).toHaveBeenCalledTimes(2);
    /* The second deliberation must have seen what the first one collected. */
    expect(mocks.planNextStep.mock.calls[1][0].observations).toHaveLength(1);
    expect(spoken(events)).toBe("Nothing on the desk.");
  });

  /*
   * The property PRD "Booking Price Checks" requires: recognising an intent is
   * never permission to open a browser.
   */
  it("stops and asks before opening a Hyatt tab", async () => {
    mocks.planNextStep.mockResolvedValue({
      calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" }],
      kind: "tools"
    });

    const events = await collect({ message: "查东京的酒店" });

    expect(mocks.invokeCapability).not.toHaveBeenCalled();
    expect(surfaces(events).at(-1)?.nodes[0]).toMatchObject({
      component: "ConfirmAction",
      props: { capability: "search_hotels" }
    });
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
  });

  it("runs the confirmed action, waits for the tab, and advises on what came back", async () => {
    mocks.invokeCapability.mockResolvedValue({
      result: { launchUrl: "https://www.hyatt.com/search", searchSessionId: "sess-1", taskId: "task-1" }
    });
    mocks.awaitBrowserTask.mockResolvedValue({ errorMessage: null, result: {}, status: "succeeded", taskId: "task-1" });
    mocks.planNextStep.mockResolvedValueOnce({
      kind: "answer",
      message: "One option, and its total still needs verifying.",
      picks: [{ reason: "Closest to the station.", ref: "h1" }]
    });

    const events = await collect({
      confirm: { args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" },
      conversation: [{ content: "查东京的酒店", role: "user" }]
    });

    /* The tab is opened by the client, so the loop has to hand it the address. */
    const launch = events.find((event) => event.type === "CUSTOM" && event.name === "browser_task_launch");
    expect(launch).toMatchObject({ value: { launchUrl: "https://www.hyatt.com/search" } });
    expect(mocks.awaitBrowserTask).toHaveBeenCalledWith("task-1", expect.anything());

    /* The results themselves land in the conversation, not on another page. */
    const rendered = surfaces(events);
    expect(rendered.some((surface) => surface.nodes[0]?.component === "HotelSearchResults")).toBe(true);

    /* And the recommendation carries the stored price, not a model-written one. */
    const advice = rendered.at(-1)?.nodes[0];
    expect(advice).toMatchObject({
      component: "Advice",
      props: { picks: [{ amount: 3200, amountBasis: "per_night", currency: "CNY", label: "Park Hyatt Tokyo" }] }
    });
  });

  /*
   * One press authorises one call. Without this, a plan that proposes the same
   * capability again later opens a second tab on the strength of the first press.
   */
  it("does not let one press authorise a second tab", async () => {
    mocks.invokeCapability.mockResolvedValue({
      result: { launchUrl: "https://www.hyatt.com/search", searchSessionId: "sess-1", taskId: "task-1" }
    });
    mocks.awaitBrowserTask.mockResolvedValue({ errorMessage: null, result: {}, status: "succeeded", taskId: "task-1" });
    mocks.planNextStep.mockResolvedValueOnce({
      calls: [{ args: { checkIn: "2026-09-04", checkOut: "2026-09-05", city: "Osaka", cityAsAsked: "大阪" }, capability: "search_hotels" }],
      kind: "tools"
    });

    const events = await collect({
      confirm: { args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" },
      conversation: [{ content: "查东京的酒店", role: "user" }]
    });

    expect(mocks.invokeCapability).toHaveBeenCalledTimes(1);
    expect(surfaces(events).at(-1)?.nodes[0]).toMatchObject({ component: "ConfirmAction" });
  });

  /* Deterministic, and in front of the model rather than behind it. */
  it("refuses an action the product never takes, without planning", async () => {
    const events = await collect({ message: "帮我订一间东京的房" });

    expect(mocks.planNextStep).not.toHaveBeenCalled();
    expect(spoken(events)).toContain("never books, cancels");
  });

  it("stops proposing tools once the step budget is spent", async () => {
    mocks.invokeCapability.mockResolvedValue({ result: { bookings: [] } });
    mocks.planNextStep.mockResolvedValue({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools" });

    const events = await collect({ message: "keep going" });

    /* Six tool steps, then one last deliberation that is made to conclude. */
    expect(mocks.invokeCapability).toHaveBeenCalledTimes(6);
    expect(spoken(events)).toContain("could not finish this in one turn");
  });

  it("reports a failed browser task as an error rather than an empty answer", async () => {
    mocks.invokeCapability.mockResolvedValue({
      result: { launchUrl: "https://www.hyatt.com/search", searchSessionId: "sess-1", taskId: "task-1" }
    });
    mocks.awaitBrowserTask.mockResolvedValue({
      errorMessage: "Hyatt returned an empty page.",
      result: null,
      status: "failed",
      taskId: "task-1"
    });

    const events = await collect({
      confirm: { args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" },
      conversation: [{ content: "查东京的酒店", role: "user" }]
    });

    expect(events.at(-1)).toMatchObject({ code: "browser_task_failed", type: "RUN_ERROR" });
  });

  /* No API key is not no product: keyword routing still answers a read. */
  it("falls back to deterministic routing with no model configured", async () => {
    mocks.isPlannerConfigured.mockReturnValue(false);
    mocks.routeIntent.mockResolvedValue({ args: {}, capability: "list_bookings", kind: "capability", source: "deterministic" });
    mocks.invokeCapability.mockResolvedValue({ result: { bookings: [] } });

    const events = await collect({ message: "my stays" });

    expect(mocks.planNextStep).not.toHaveBeenCalled();
    expect(surfaces(events).at(-1)?.nodes[0]).toMatchObject({ component: "Message" });
  });
});
