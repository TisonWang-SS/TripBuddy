import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { verdictLabel } from "@/lib/labels";
import { Badge, LabelBadge } from "./Badge";

describe("Badge", () => {
  it("exposes its tone for styling and assertions", () => {
    render(<Badge tone="critical">Urgent</Badge>);
    expect(screen.getByText("Urgent")).toHaveAttribute("data-tone", "critical");
  });

  it("defaults to the neutral tone", () => {
    render(<Badge>Cash</Badge>);
    expect(screen.getByText("Cash")).toHaveAttribute("data-tone", "neutral");
  });

  it("renders a resolved label with the tone that label carries", () => {
    render(<LabelBadge value={verdictLabel("keep")} />);
    const badge = screen.getByText("Keep booking");
    expect(badge).toHaveAttribute("data-tone", "positive");
  });

  it("hides the status dot from assistive technology", () => {
    const { container } = render(<LabelBadge dot value={verdictLabel("urgent")} />);
    expect(container.querySelector("[aria-hidden='true']")).toBeInTheDocument();
    expect(screen.getByText("Urgent")).toHaveAttribute("data-tone", "critical");
  });
});
