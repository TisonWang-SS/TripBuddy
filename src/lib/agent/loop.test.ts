import { beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilityArgsError } from "@/lib/agent/args";
import { LlmError } from "@/lib/providers/llmClient";
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
  precheckCapability: vi.fn(async () => null as string | { retryable: string } | null),
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
  return { ...actual, invokeCapability: mocks.invokeCapability, precheckCapability: mocks.precheckCapability };
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
    mocks.precheckCapability.mockResolvedValue(null);
  });

  /*
   * The turn is the only place that can tell the model a search already exists:
   * tool results do not survive a turn, and the server keeps no conversation.
   * Live, a follow-up budget on a fresh search reopened Hyatt instead.
   */
  it("tells the planner about searches this conversation already collected", async () => {
    mocks.planNextStep.mockResolvedValue({ kind: "answer", message: "Using what we already have.", picks: [] });

    await collect({ memory: { searchSessionIds: ["sess-1"] }, message: "我的预算在1000元一晚左右" });

    expect(mocks.getHotelSearchSession).toHaveBeenCalledWith("sess-1");
    expect(mocks.planNextStep.mock.calls[0][0].priorSearches).toMatchObject([
      { checkIn: "2026-09-01", city: "东京", sessionId: "sess-1" }
    ]);
  });

  it("passes no prior searches when the conversation has produced none", async () => {
    mocks.planNextStep.mockResolvedValue({ kind: "answer", message: "Nothing yet.", picks: [] });

    await collect({ message: "有什么要处理的吗" });

    expect(mocks.planNextStep.mock.calls[0][0].priorSearches).toEqual([]);
  });

  /*
   * A confirmation button costs a press and a wait. Live, asking for "上海希尔顿"
   * produced a Hyatt search card with nothing said about the brand swap, and
   * asking to compare two cities produced one card with no mention of the other.
   */
  it("says what it is about to do before work with a cost", async () => {
    mocks.invokeCapability.mockResolvedValue({
      result: { launchUrl: "https://www.hyatt.com/search", searchSessionId: "sess-1", taskId: "task-1" }
    });
    mocks.awaitBrowserTask.mockResolvedValue({ errorMessage: null, result: {}, status: "succeeded", taskId: "task-1" });
    mocks.planNextStep
      .mockResolvedValueOnce({
        calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Shanghai", cityAsAsked: "上海" }, capability: "search_hotels" }],
        kind: "tools",
        message: "您提到的是希尔顿，但本产品只收集凯悦。"
      })
      .mockResolvedValueOnce({ kind: "answer", message: "找到了几家。", picks: [] });

    const events = await collect({ message: "查上海希尔顿" });

    /* Said before the tab opens, which is while declining is still free. */
    const launchIndex = events.findIndex((event) => event.type === "CUSTOM" && event.name === "browser_task_launch");
    const spokenIndex = events.findIndex(
      (event) => event.type === "TEXT_MESSAGE_CONTENT" && event.delta.includes("只收集凯悦")
    );
    expect(spokenIndex).toBeGreaterThanOrEqual(0);
    expect(spokenIndex).toBeLessThan(launchIndex);
  });

  /*
   * Order matters: announcing work a precheck then refuses reads as the product
   * contradicting itself one line later.
   */
  it("does not announce work a precheck refuses", async () => {
    mocks.precheckCapability.mockResolvedValue("City search uses the profile currency (USD).");
    mocks.planNextStep.mockResolvedValue({
      calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Shanghai", cityAsAsked: "上海" }, capability: "search_hotels" }],
      kind: "tools",
      message: "我来按每晚 1000 元的预算搜索上海。"
    });

    const events = await collect({ message: "上海 9月1日 2晚，预算每晚1000元" });

    expect(spoken(events)).not.toContain("我来按每晚");
    expect(spoken(events)).toContain("profile currency");
  });

  /*
   * The model is shown `b1`, never a booking id — `modelView` strips them. So a
   * follow-up like "why keep it?" arrived with the row but not the argument, and
   * the product asked which booking was meant, of the one it had just listed.
   */
  it("resolves the refs the model can see into the ids the tools need", async () => {
    mocks.invokeCapability
      .mockResolvedValueOnce({ result: { bookings: [{ bookingId: "booking-42", city: "KL", hotelName: "Grand Hyatt", nights: 2 }] } })
      .mockResolvedValueOnce({ result: { recommendation: null } });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ calls: [{ args: { bookingId: "b1" }, capability: "explain_recommendation" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "No verdict yet.", picks: [] });

    await collect({ message: "我的预订为什么建议保留？" });

    expect(mocks.invokeCapability).toHaveBeenLastCalledWith("explain_recommendation", { bookingId: "booking-42" }, expect.anything());
  });

  /* A ref the model made up resolves to nothing, not to someone else's row. */
  it("passes an unknown ref through rather than inventing an id", async () => {
    mocks.invokeCapability.mockResolvedValue({ result: { recommendation: null } });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: { bookingId: "b9" }, capability: "explain_recommendation" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "Nothing there.", picks: [] });

    await collect({ message: "解释一下" });

    expect(mocks.invokeCapability).toHaveBeenCalledWith("explain_recommendation", { bookingId: "b9" }, expect.anything());
  });

  /*
   * A precheck the model can act on should not end the turn. Live, "watch that
   * booking" hit a ref that had expired with its turn and answered "I could not
   * find that booking" — about a booking listed two lines earlier.
   */
  it("hands a recoverable precheck failure back to the model", async () => {
    mocks.precheckCapability.mockResolvedValueOnce({ retryable: "That ref expired; call list_bookings again." });
    mocks.invokeCapability.mockResolvedValue({ result: { bookingId: "b-1", hotelName: "Grand Hyatt", watching: true } });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: { bookingId: "b1" }, capability: "set_watch_plan" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "Listed again first.", picks: [] });

    const events = await collect({ message: "帮我盯着它" });

    /* The turn continued, and the failure reached the next deliberation. */
    expect(mocks.planNextStep).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(mocks.planNextStep.mock.calls[1][0].observations)).toContain("That ref expired");
    expect(spoken(events)).toBe("Listed again first.");
  });

  /* A precheck only the user can resolve still stops, in product-owned words. */
  it("stops on a precheck the model cannot act on", async () => {
    mocks.precheckCapability.mockResolvedValue("City search uses the profile currency (USD).");
    mocks.planNextStep.mockResolvedValue({
      calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" }],
      kind: "tools",
      message: ""
    });

    const events = await collect({ message: "东京，预算每晚1000元" });

    expect(mocks.planNextStep).toHaveBeenCalledTimes(1);
    expect(spoken(events)).toContain("profile currency");
  });

  /*
   * The failure that motivated this: a tax-inclusive total had been captured —
   * tab opened, user waited, figure stored, card already on screen — and then the
   * provider returned an empty completion. The turn ended on a technical string
   * about JSON, silent about the price it had just fetched.
   */
  it("keeps what a failed turn already collected", async () => {
    /* `mockResolvedValueOnce` queues outlive clearAllMocks; start from empty. */
    mocks.planNextStep.mockReset();
    mocks.invokeCapability.mockResolvedValue({ result: { bookings: [] } });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools", message: "" })
      .mockRejectedValueOnce(new LlmError("llm_empty_response", "The language model response did not contain JSON content."))
      .mockRejectedValueOnce(new LlmError("llm_empty_response", "The language model response did not contain JSON content."))
      .mockRejectedValueOnce(new Error("still broken"));

    const events = await collect({ message: "我的预订" });

    expect(events.some((event) => event.type === "RUN_ERROR")).toBe(false);
    expect(events.at(-1)?.type).toBe("RUN_FINISHED");
    expect(spoken(events)).toContain("不用重新查一遍");
  });

  /* A transient empty completion costs one more request, not the turn. */
  it("retries an empty completion before giving up on it", async () => {
    /* `mockResolvedValueOnce` queues outlive clearAllMocks; start from empty. */
    mocks.planNextStep.mockReset();
    mocks.planNextStep
      .mockRejectedValueOnce(new LlmError("llm_empty_response", "empty"))
      .mockResolvedValueOnce({ kind: "answer", message: "Second time worked.", picks: [] });

    const events = await collect({ message: "有什么要处理的吗" });

    expect(mocks.planNextStep).toHaveBeenCalledTimes(2);
    expect(spoken(events)).toBe("Second time worked.");
  });

  /* With nothing collected there is nothing to preserve; report the failure. */
  it("still reports a failure that produced nothing", async () => {
    /* `mockResolvedValueOnce` queues outlive clearAllMocks; start from empty. */
    mocks.planNextStep.mockReset();
    mocks.planNextStep.mockRejectedValue(new Error("provider down"));

    const events = await collect({ message: "有什么要处理的吗" });

    expect(events.at(-1)).toMatchObject({ type: "RUN_ERROR" });
  });

  /*
   * The property the restructure exists for. Seven exits each emitted their own
   * terminal event, so "a failure never discards work" and "RUN_ERROR is
   * terminal" held at some of them and not others. Asserted over every shape a
   * turn can end in, rather than one at a time.
   */
  it("ends every turn exactly once, however it ends", async () => {
    const endings: { name: string; arrange: () => void }[] = [
      {
        name: "answered",
        arrange: () => mocks.planNextStep.mockResolvedValue({ kind: "answer", message: "Done.", picks: [] })
      },
      {
        name: "asked",
        arrange: () => mocks.planNextStep.mockResolvedValue({ kind: "ask", message: "Which city?" })
      },
      {
        name: "refused",
        arrange: () => mocks.planNextStep.mockResolvedValue({ kind: "refuse", message: "Out of scope." })
      },
      {
        name: "awaiting a press",
        arrange: () =>
          mocks.planNextStep.mockResolvedValue({
            calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" }],
            kind: "tools",
            message: ""
          })
      },
      {
        name: "failed outright",
        arrange: () => mocks.planNextStep.mockRejectedValue(new Error("provider down"))
      },
      {
        name: "failed after collecting something",
        arrange: () => {
          mocks.invokeCapability.mockResolvedValue({ result: { bookings: [] } });
          mocks.planNextStep
            .mockResolvedValueOnce({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools", message: "" })
            .mockRejectedValue(new Error("provider down"));
        }
      },
      {
        name: "blocked by a precheck",
        arrange: () => {
          mocks.precheckCapability.mockResolvedValue("Change the display currency first.");
          mocks.planNextStep.mockResolvedValue({
            calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" }],
            kind: "tools",
            message: ""
          });
        }
      }
    ];

    for (const ending of endings) {
      vi.clearAllMocks();
      mocks.planNextStep.mockReset();
      mocks.invokeCapability.mockReset();
      mocks.precheckCapability.mockReset().mockResolvedValue(null);
      mocks.getHotelSearchSession.mockResolvedValue(session);
      ending.arrange();

      const events = await collect({ message: "有什么要处理的吗" });
      const terminal = events.filter((event) => event.type === "RUN_FINISHED" || event.type === "RUN_ERROR");

      expect(terminal, `${ending.name}: exactly one terminal event`).toHaveLength(1);
      expect(events.at(-1), `${ending.name}: the terminal event is last`).toBe(terminal[0]);
    }
  });

  /*
   * A ref shown last turn still names the same row. Without this the model had
   * to re-list before every follow-up, and when it forgot, the product asked
   * which booking was meant about the one it had just listed.
   */
  it("carries row references across turns", async () => {
    mocks.invokeCapability.mockResolvedValue({ result: { recommendation: null } });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: { bookingId: "b1" }, capability: "explain_recommendation" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "Read it.", picks: [] });

    await collect({ memory: { refs: { b1: "booking-42" } }, message: "那个值得留着吗？" });

    expect(mocks.invokeCapability).toHaveBeenCalledWith("explain_recommendation", { bookingId: "booking-42" }, expect.anything());
  });

  it("hands back what the turn learned, for the next one", async () => {
    mocks.invokeCapability.mockResolvedValue({
      result: { bookings: [{ bookingId: "booking-42", city: "KL", hotelName: "Grand Hyatt", nights: 2 }] }
    });
    mocks.planNextStep
      .mockResolvedValueOnce({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "One stay.", picks: [] });

    const events = await collect({ memory: { refs: { h9: "old-hotel" } }, message: "我的预订" });

    const handed = events.find((event) => event.type === "CUSTOM" && event.name === "memory");
    expect(handed).toBeDefined();
    /* This turn's rows, merged onto what earlier turns had already established. */
    expect((handed as Extract<AgentEvent, { type: "CUSTOM" }>).value).toMatchObject({
      refs: { b1: "booking-42", h9: "old-hotel" }
    });
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
      .mockResolvedValueOnce({ calls: [{ args: {}, capability: "list_bookings" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "Nothing on the desk.", picks: [] });

    const events = await collect({ message: "show my stays" });

    expect(mocks.planNextStep).toHaveBeenCalledTimes(2);
    /* The second deliberation must have seen what the first one collected. */
    expect(mocks.planNextStep.mock.calls[1][0].observations).toHaveLength(1);
    expect(spoken(events)).toBe("Nothing on the desk.");
  });

  /*
   * Browser work runs on the strength of the request (ADR 0007). Asking for a
   * search is the initiation; a button that always appeared and was always
   * pressed had stopped being consent and become a second step.
   */
  it("runs a browser task without a separate press", async () => {
    mocks.invokeCapability.mockResolvedValue({
      result: { launchUrl: "https://www.hyatt.com/search", searchSessionId: "sess-1", taskId: "task-1" }
    });
    mocks.awaitBrowserTask.mockResolvedValue({ errorMessage: null, result: {}, status: "succeeded", taskId: "task-1" });
    mocks.planNextStep
      .mockResolvedValueOnce({
        calls: [{ args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" }],
        kind: "tools",
        message: ""
      })
      .mockResolvedValueOnce({ kind: "answer", message: "Found some.", picks: [] });

    const events = await collect({ message: "查东京的酒店" });

    expect(mocks.invokeCapability).toHaveBeenCalled();
    expect(surfaces(events).some((surface) => surface.nodes[0]?.component === "ConfirmAction")).toBe(false);
    /* The client still needs the address, since only it can open a tab. */
    expect(events.some((event) => event.type === "CUSTOM" && event.name === "browser_task_launch")).toBe(true);
  });

  /* A write still asks: it changes stored state the user would undo by hand. */
  it("still stops and asks before a write", async () => {
    mocks.planNextStep.mockResolvedValue({
      calls: [{ args: { bookingId: "b-1" }, capability: "set_watch_plan" }],
      kind: "tools",
      message: ""
    });

    const events = await collect({ message: "帮我盯着它" });

    expect(mocks.invokeCapability).not.toHaveBeenCalled();
    expect(surfaces(events).at(-1)?.nodes[0]).toMatchObject({
      component: "ConfirmAction",
      props: { capability: "set_watch_plan" }
    });
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
   * A capability refusing its own arguments knows something the planner could
   * not — an expired session, a stay that has already happened — and it wrote a
   * sentence saying what to do about it. That is a question, not a failed run.
   */
  it("turns a capability's own argument refusal into a question", async () => {
    mocks.invokeCapability.mockRejectedValue(new CapabilityArgsError('"checkIn" is 2020-01-01, which has already passed.'));
    mocks.planNextStep.mockResolvedValue({
      calls: [{ args: { checkIn: "2020-01-01", checkOut: "2020-01-02", city: "Tokyo", cityAsAsked: "东京" }, capability: "search_hotels" }],
      kind: "tools",
      message: ""
    });

    const events = await collect({ message: "查2020年的东京酒店" });

    expect(events.some((event) => event.type === "RUN_ERROR")).toBe(false);
    expect(spoken(events)).toContain("already passed");
  });

  /* Deterministic, and in front of the model rather than behind it. */
  it("refuses an action the product never takes, without planning", async () => {
    const events = await collect({ message: "帮我订一间东京的房" });

    expect(mocks.planNextStep).not.toHaveBeenCalled();
    expect(spoken(events)).toContain("never books, cancels");
  });

  it("stops proposing tools once the step budget is spent", async () => {
    /* `once` queues outlive clearAllMocks and would win over the implementation. */
    mocks.planNextStep.mockReset();
    /* Each capability needs its own result shape, or composing its surface throws. */
    mocks.invokeCapability.mockReset().mockImplementation(async (name: string) => ({
      result:
        name === "get_price_history"
          ? { observations: [], runs: [] }
          : name === "explain_recommendation"
            ? { bookingFound: true, recommendation: null }
            : { booking: null }
    }));
    /*
     * Distinct arguments and rotating capabilities: an exact repeat is skipped,
     * and any one capability is capped at four calls a turn.
     */
    const rotation = ["get_booking", "get_price_history", "explain_recommendation"];
    let step = 0;
    mocks.planNextStep.mockImplementation(async () => {
      const capability = rotation[step % rotation.length];
      return { calls: [{ args: { bookingId: `booking-${step++}` }, capability }], kind: "tools", message: "" };
    });

    const events = await collect({ message: "keep going" });

    /* Twelve tool steps, then one last deliberation that is made to conclude. */
    expect(mocks.invokeCapability).toHaveBeenCalledTimes(12);
    expect(spoken(events)).toContain("could not finish this in one turn");
  });

  /*
   * Different arguments are different questions, so they are not deduplicated —
   * but a model working through a list of twenty is not asking twenty questions.
   */
  it("caps how many times one capability runs in a turn", async () => {
    mocks.planNextStep.mockReset();
    mocks.invokeCapability.mockReset().mockResolvedValue({ result: { booking: null } });
    let step = 0;
    mocks.planNextStep.mockImplementation(async () => ({
      calls: [{ args: { bookingId: `booking-${step++}` }, capability: "get_booking" }],
      kind: "tools",
      message: ""
    }));

    await collect({ message: "keep going" });

    expect(mocks.invokeCapability).toHaveBeenCalledTimes(4);
  });

  /*
   * Live, the model asked for one hotel's detail three times over and narrated
   * each. A repeat is it losing its place, not a second question.
   */
  it("runs the same call once per turn, however often it is proposed", async () => {
    mocks.planNextStep.mockReset();
    mocks.invokeCapability.mockReset().mockResolvedValue({ result: { bookings: [] } });
    mocks.planNextStep
      .mockResolvedValueOnce({
        calls: [
          { args: { scope: "upcoming" }, capability: "list_bookings" },
          { args: { scope: "upcoming" }, capability: "list_bookings" }
        ],
        kind: "tools",
        message: ""
      })
      .mockResolvedValueOnce({ calls: [{ args: { scope: "upcoming" }, capability: "list_bookings" }], kind: "tools", message: "" })
      .mockResolvedValueOnce({ kind: "answer", message: "Once was enough.", picks: [] });

    await collect({ message: "我的预订" });

    expect(mocks.invokeCapability).toHaveBeenCalledTimes(1);
  });

  /*
   * The note is for the moment before a press. Spoken before every tool, it
   * became narration: four reads produced four near-identical paragraphs, each
   * saying what the answer was about to say anyway.
   */
  it("does not narrate a free read", async () => {
    mocks.planNextStep.mockReset();
    mocks.invokeCapability.mockReset().mockResolvedValue({ result: { bookings: [] } });
    mocks.planNextStep
      .mockResolvedValueOnce({
        calls: [{ args: {}, capability: "list_bookings" }],
        kind: "tools",
        message: "我先读取你的预订。"
      })
      .mockResolvedValueOnce({ kind: "answer", message: "你有一笔预订。", picks: [] });

    const events = await collect({ message: "我的预订" });

    expect(spoken(events)).not.toContain("我先读取");
    expect(spoken(events)).toBe("你有一笔预订。");
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
