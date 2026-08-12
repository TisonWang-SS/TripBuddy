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

const launchEvent: AgentEvent = {
  name: "surface",
  timestamp: 1,
  type: "CUSTOM",
  value: {
    nodes: [
      {
        component: "TaskLaunch",
        key: "launch",
        props: { capability: "run_price_check", launchUrl: "https://www.hyatt.com/shop", resultRoute: "/bookings/booking-1" }
      }
    ],
    surfaceId: "s2",
    version: "tripbuddy-surface-1"
  }
};

/* What the server answers while a browser task is still waiting for its press. */
const heldForConfirmation = emitting(
  { timestamp: 1, toolCallId: "t", toolCallName: "run_price_check", type: "TOOL_CALL_START" },
  { delta: JSON.stringify({ bookingId: "booking-1" }), timestamp: 2, toolCallId: "t", type: "TOOL_CALL_ARGS" },
  { code: "confirmation_required", message: "This opens a Hyatt tab.", runId: "r", timestamp: 3, type: "RUN_ERROR" }
);

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
    vi.restoreAllMocks();
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
    const browserTab = { close: vi.fn(), location: { href: "" } };
    vi.spyOn(window, "open").mockReturnValue(browserTab as unknown as Window);
    mocks.streamAgentRun.mockImplementation(heldForConfirmation);

    openBar();
    typeQuery("check booking-1");
    fireEvent.click(screen.getByRole("option", { name: /check booking-1/ }));

    await waitFor(() => expect(screen.getByText("This opens a Hyatt tab.")).toBeInTheDocument());
    expect(mocks.streamAgentRun).toHaveBeenCalledTimes(1);
    expect(window.open).not.toHaveBeenCalled();

    mocks.streamAgentRun.mockImplementation(emitting(launchEvent));
    fireEvent.click(screen.getByRole("button", { name: /Open the Hyatt tab/i }));

    await waitFor(() =>
      expect(mocks.streamAgentRun).toHaveBeenLastCalledWith(
        { args: { bookingId: "booking-1" }, capability: "run_price_check", confirmed: true },
        expect.any(Function)
      )
    );
    /* The press is what opens the tab, and the run is what points it at Hyatt. */
    await waitFor(() => expect(browserTab.location.href).toBe("https://www.hyatt.com/shop"));
    expect(browserTab.close).not.toHaveBeenCalled();
  });

  /*
   * The reported bug: the confirmation appeared, Enter was pressed to accept it,
   * and the same sentence was routed again — repainting an identical panel, so
   * nothing looked like it had happened.
   */
  it("puts the next keystroke on the confirmation rather than re-routing", async () => {
    const browserTab = { close: vi.fn(), location: { href: "" } };
    vi.spyOn(window, "open").mockReturnValue(browserTab as unknown as Window);
    mocks.streamAgentRun.mockImplementation(heldForConfirmation);

    openBar();
    typeQuery("check booking-1");
    fireEvent.click(screen.getByRole("option", { name: /check booking-1/ }));

    const confirm = await screen.findByRole("button", { name: /Open the Hyatt tab/i });
    await waitFor(() => expect(confirm).toHaveFocus());

    mocks.streamAgentRun.mockImplementation(emitting(launchEvent));
    fireEvent.click(confirm);

    await waitFor(() => expect(mocks.streamAgentRun).toHaveBeenCalledTimes(2));
    expect(mocks.streamAgentRun).not.toHaveBeenLastCalledWith({ message: "check booking-1" }, expect.any(Function));
  });

  /* A blocked pop-up is reported rather than leaving a run with nowhere to land. */
  it("says so when the browser refuses the tab", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    mocks.streamAgentRun.mockImplementation(heldForConfirmation);

    openBar();
    typeQuery("check booking-1");
    fireEvent.click(screen.getByRole("option", { name: /check booking-1/ }));

    fireEvent.click(await screen.findByRole("button", { name: /Open the Hyatt tab/i }));

    await waitFor(() => expect(screen.getByText(/Allow pop-ups for TripBuddy/)).toBeInTheDocument());
    expect(mocks.streamAgentRun).toHaveBeenCalledTimes(1);
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
