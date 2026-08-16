import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent/events";
import { Chat } from "./Chat";

/*
 * The conversation, checked on what a user would notice: that the assistant's
 * words appear, that results appear as cards rather than as a link elsewhere,
 * and that the Hyatt tab is opened by their press and not by the run.
 */

const mocks = vi.hoisted(() => ({ streamAgentRun: vi.fn() }));

vi.mock("@/lib/agent/client", () => ({ streamAgentRun: mocks.streamAgentRun }));

function emitting(...events: AgentEvent[]) {
  return vi.fn(async (_request: unknown, onEvent: (event: AgentEvent) => void) => {
    for (const event of events) {
      onEvent(event);
    }
  });
}

function spoke(text: string): AgentEvent[] {
  return [
    { messageId: "m1", role: "assistant", timestamp: 1, type: "TEXT_MESSAGE_START" },
    { delta: text, messageId: "m1", timestamp: 2, type: "TEXT_MESSAGE_CONTENT" },
    { messageId: "m1", timestamp: 3, type: "TEXT_MESSAGE_END" }
  ];
}

function surfaceEvent(nodes: unknown[]): AgentEvent {
  return {
    name: "surface",
    timestamp: 4,
    type: "CUSTOM",
    value: { nodes, surfaceId: "s1", version: "tripbuddy-surface-1" }
  };
}

const adviceSurface = surfaceEvent([
  {
    component: "Advice",
    key: "advice",
    props: {
      narrative: "两晚合计还是这家最合适。",
      picks: [
        {
          amount: 314.23,
          amountBasis: "stay_total",
          currency: "USD",
          href: "/bookings/b-1",
          label: "Grand Hyatt Kuala Lumpur",
          note: null,
          reason: "唯一一间在预算内的房"
        }
      ]
    }
  }
]);

const confirmSurface = surfaceEvent([
  {
    component: "ConfirmAction",
    key: "confirm",
    props: {
      args: { checkIn: "2026-09-01", checkOut: "2026-09-03", city: "Tokyo", cityAsAsked: "东京" },
      capability: "search_hotels",
      detail: "Hyatt city rates for 东京.",
      label: "Open Hyatt and collect prices"
    }
  }
]);

function ask(text: string) {
  render(<Chat />);
  fireEvent.change(screen.getByRole("textbox", { name: /ask tripbuddy/i }), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("conversation", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.streamAgentRun.mockReset();
  });

  it("shows what the user said and what the assistant answered", async () => {
    mocks.streamAgentRun.mockImplementation(emitting(...spoke("两晚合计还是这家最合适。"), adviceSurface));

    ask("我现在的预订还值得留着吗？");

    expect(screen.getByText("我现在的预订还值得留着吗？")).toBeInTheDocument();
    /*
     * Regression: the assistant's prose was read inside a React updater, which
     * runs after the line that resets it, so every answer rendered as cards with
     * no words at all.
     */
    await waitFor(() => expect(screen.getByText("两晚合计还是这家最合适。")).toBeInTheDocument());
  });

  it("renders a recommendation with the product's own figure beside it", async () => {
    mocks.streamAgentRun.mockImplementation(emitting(...spoke("看下来是这家。"), adviceSurface));

    ask("哪家好");

    await waitFor(() => expect(screen.getByText("Grand Hyatt Kuala Lumpur")).toBeInTheDocument());
    expect(screen.getByText("唯一一间在预算内的房")).toBeInTheDocument();
    expect(screen.getByText("$314.23")).toBeInTheDocument();
  });

  it("sends the exchange so far, so the next turn has context", async () => {
    mocks.streamAgentRun.mockImplementation(emitting(...spoke("好的。"), adviceSurface));

    ask("第一句");
    await waitFor(() => expect(screen.getByText("好的。")).toBeInTheDocument());

    fireEvent.change(screen.getByRole("textbox", { name: /ask tripbuddy/i }), { target: { value: "第二句" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(mocks.streamAgentRun).toHaveBeenCalledTimes(2));
    expect(mocks.streamAgentRun.mock.calls[1][0].conversation).toEqual([
      { content: "第一句", role: "user" },
      { content: "好的。", role: "assistant" },
      { content: "第二句", role: "user" }
    ]);
  });

  /*
   * The tab has to be opened inside a gesture — Chrome allows `window.open`
   * nowhere else — and since ADR 0007 removed the confirmation press, the send
   * keystroke is the only gesture the turn gets.
   */
  it("opens the Hyatt tab from the send gesture and points it at the launch", async () => {
    const tab = { close: vi.fn(), location: { href: "about:blank" } };
    vi.stubGlobal("open", vi.fn(() => tab));
    mocks.streamAgentRun.mockImplementation(
      emitting({
        name: "browser_task_launch",
        timestamp: 5,
        type: "CUSTOM",
        value: { capability: "search_hotels", launchUrl: "https://www.hyatt.com/search", resultRoute: "/hotel-search" }
      })
    );

    ask("查一下上海的酒店价格");

    expect(window.open).toHaveBeenCalledWith("about:blank", "_blank");
    await waitFor(() => expect(tab.location.href).toBe("https://www.hyatt.com/search"));
  });

  /*
   * The guess is allowed to be wrong. A launch arriving with no tab waiting
   * renders a link instead — the server is already waiting on the task, so
   * opening it any time before the task expires completes the same run.
   */
  it("offers a link when no tab was opened for the launch", async () => {
    vi.stubGlobal("open", vi.fn(() => null));
    mocks.streamAgentRun.mockImplementation(
      emitting({
        name: "browser_task_launch",
        timestamp: 5,
        type: "CUSTOM",
        value: { capability: "search_hotels", launchUrl: "https://www.hyatt.com/search", resultRoute: "/hotel-search" }
      })
    );

    ask("我的预订还好吗");

    await waitFor(() => expect(screen.getByRole("link", { name: /Open the Hyatt tab/i })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Open the Hyatt tab/i })).toHaveAttribute(
      "href",
      "https://www.hyatt.com/search"
    );
  });

  /* A write still asks, and its press opens nothing. */
  it("sends a confirmed write without opening a tab", async () => {
    vi.stubGlobal("open", vi.fn());
    mocks.streamAgentRun.mockImplementationOnce(emitting(confirmSurface));

    ask("帮我盯着它");
    await waitFor(() => expect(screen.getByRole("button", { name: /Open Hyatt and collect prices/ })).toBeInTheDocument());

    mocks.streamAgentRun.mockImplementationOnce(emitting(...spoke("好的。")));
    fireEvent.click(screen.getByRole("button", { name: /Open Hyatt and collect prices/ }));

    expect(window.open).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.streamAgentRun.mock.calls[1][0].confirm).toMatchObject({ capability: "search_hotels" }));
  });

  it("reports a failed run in the conversation rather than silently", async () => {
    mocks.streamAgentRun.mockImplementation(
      emitting({ code: "browser_task_failed", message: "Hyatt returned an empty page.", runId: "r", timestamp: 1, type: "RUN_ERROR" })
    );

    ask("查东京的酒店");

    await waitFor(() => expect(screen.getByText("Hyatt returned an empty page.")).toBeInTheDocument());
  });
});
