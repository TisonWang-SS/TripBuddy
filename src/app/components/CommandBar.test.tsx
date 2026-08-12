import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentEvent } from "@/lib/agent/events";
import { CommandBar, type Command } from "./CommandBar";

const mocks = vi.hoisted(() => ({ push: vi.fn(), streamAgentRun: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock("@/lib/agent/client", () => ({ streamAgentRun: mocks.streamAgentRun }));

const commands: readonly Command[] = [
  { group: "Desk", href: "/", keywords: "dashboard home", label: "Open the desk" },
  { group: "Find", href: "/hotel-search", keywords: "city rates", label: "Search hotels in a city" }
];

function emitting(...events: AgentEvent[]) {
  return vi.fn(async (_request: unknown, onEvent: (event: AgentEvent) => void) => {
    for (const event of events) {
      onEvent(event);
    }
  });
}

const surfaceEvent: AgentEvent = {
  name: "surface",
  timestamp: 1,
  type: "CUSTOM",
  value: {
    nodes: [{ component: "Message", key: "m", props: { text: "Nothing is due for a check.", tone: "positive" } }],
    surfaceId: "s1",
    version: "tripbuddy-surface-1"
  }
};

/* fireEvent rather than user-event: this repo keeps its dependency surface small. */
function openBar() {
  render(<CommandBar commands={commands} />);
  fireEvent.click(screen.getByRole("button", { name: /type a command/i }));
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
}

describe("command bar", () => {
  beforeEach(() => {
    mocks.push.mockReset();
    mocks.streamAgentRun.mockReset().mockImplementation(emitting(surfaceEvent));
  });

  it("still navigates when a command matches", async () => {
    openBar();
    fireEvent.click(screen.getByRole("option", { name: /Open the desk/ }));
    expect(mocks.push).toHaveBeenCalledWith("/");
    expect(mocks.streamAgentRun).not.toHaveBeenCalled();
  });

  it("offers to ask whatever was typed", async () => {
    openBar();
    typeQuery("anything due");
    expect(screen.getByRole("option", { name: /anything due/ })).toBeInTheDocument();
  });

  it("renders the surface the run produced, in place", async () => {
    openBar();
    typeQuery("anything due");
    fireEvent.click(screen.getByRole("option", { name: /anything due/ }));

    await waitFor(() => expect(screen.getByText("Nothing is due for a check.")).toBeInTheDocument());
    expect(mocks.streamAgentRun).toHaveBeenCalledWith({ message: "anything due" }, expect.any(Function));
    /* A read answers in place; it does not navigate away from the palette. */
    expect(mocks.push).not.toHaveBeenCalled();
  });

  /*
   * The protocol round trip: a run that opens a Hyatt tab reports
   * confirmation_required, and the request is only re-sent after a press.
   */
  it("holds a browser task until it is confirmed", async () => {
    mocks.streamAgentRun.mockImplementation(
      emitting(
        { timestamp: 1, toolCallId: "t", toolCallName: "run_price_check", type: "TOOL_CALL_START" },
        { delta: JSON.stringify({ bookingId: "booking-1" }), timestamp: 2, toolCallId: "t", type: "TOOL_CALL_ARGS" },
        { code: "confirmation_required", message: "This opens a Hyatt tab.", runId: "r", timestamp: 3, type: "RUN_ERROR" }
      )
    );

    openBar();
    typeQuery("check booking-1");
    fireEvent.click(screen.getByRole("option", { name: /check booking-1/ }));

    await waitFor(() => expect(screen.getByText("This opens a Hyatt tab.")).toBeInTheDocument());
    expect(mocks.streamAgentRun).toHaveBeenCalledTimes(1);

    mocks.streamAgentRun.mockImplementation(emitting(surfaceEvent));
    fireEvent.click(screen.getByRole("button", { name: /Open the Hyatt tab/i }));

    await waitFor(() =>
      expect(mocks.streamAgentRun).toHaveBeenLastCalledWith(
        { args: { bookingId: "booking-1" }, capability: "run_price_check", confirmed: true },
        expect.any(Function)
      )
    );
  });

  it("reports a failed run without closing the palette", async () => {
    mocks.streamAgentRun.mockRejectedValue(new Error("The agent request failed with 500."));

    openBar();
    typeQuery("anything due");
    fireEvent.click(screen.getByRole("option", { name: /anything due/ }));

    await waitFor(() => expect(screen.getByText("The agent request failed with 500.")).toBeInTheDocument());
    expect(screen.getByRole("combobox")).toBeInTheDocument();
  });
});
