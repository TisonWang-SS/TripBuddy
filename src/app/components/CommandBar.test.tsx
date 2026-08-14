import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CommandBar, type Command } from "./CommandBar";

/*
 * The palette navigates and nothing else now. Everything it used to do with a
 * typed question — routing it, holding a confirmation, rendering the surface it
 * produced — moved to the conversation, and is tested in Chat.test.tsx.
 */

const mocks = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

const commands: readonly Command[] = [
  { group: "Desk", href: "/", keywords: "chat ask assistant", label: "Ask TripBuddy" },
  { group: "Desk", href: "/desk", keywords: "dashboard home", label: "Open the desk" },
  { group: "Set up", href: "/settings", keywords: "currency preferences", label: "Settings" }
];

/* fireEvent rather than user-event: this repo keeps its dependency surface small. */
function openBar() {
  render(<CommandBar commands={commands} />);
  fireEvent.click(screen.getByRole("button", { name: /jump to a page/i }));
}

function typeQuery(value: string) {
  fireEvent.change(screen.getByRole("combobox"), { target: { value } });
}

describe("command bar", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.push.mockReset();
  });

  it("navigates when a command is chosen", () => {
    openBar();
    fireEvent.click(screen.getByRole("option", { name: /Open the desk/ }));
    expect(mocks.push).toHaveBeenCalledWith("/desk");
  });

  it("filters on label, keywords, and group", () => {
    openBar();
    typeQuery("currency");
    expect(screen.getByRole("option", { name: /Settings/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Open the desk/ })).not.toBeInTheDocument();
  });

  /* A query that matches nothing points at the one place that can still help. */
  it("sends an unmatched query to the conversation", () => {
    openBar();
    typeQuery("zzzz");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText(/use the conversation/i)).toBeInTheDocument();
  });

  it("moves through results with the arrow keys and opens with Enter", () => {
    openBar();
    const field = screen.getByRole("combobox");
    fireEvent.keyDown(field, { key: "ArrowDown" });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(mocks.push).toHaveBeenCalledWith("/desk");
  });

  it("closes on Escape without navigating", () => {
    openBar();
    fireEvent.keyDown(screen.getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.push).not.toHaveBeenCalled();
  });
});
