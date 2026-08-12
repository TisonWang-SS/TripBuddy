import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Surface, SurfaceNode } from "@/lib/agent/surface";
import { SurfaceRenderer } from "./SurfaceRenderer";

function surfaceOf(...nodes: SurfaceNode[]): Surface {
  return { nodes, surfaceId: "s1", version: "tripbuddy-surface-1" };
}

const booking = {
  bookingId: "booking-1",
  baselineCashTotal: 314.23,
  baselinePoints: null,
  baselineType: "cash",
  cancellationDeadline: null,
  checkIn: "2026-09-10",
  checkOut: "2026-09-12",
  city: "Kuala Lumpur",
  currency: "USD",
  estimatedSavings: 0,
  hotelGroup: "Hyatt",
  hotelName: "Grand Hyatt Kuala Lumpur",
  lastObservedAt: null,
  nights: 2,
  qualityLevel: "needs_review",
  riskLevel: "high",
  verdict: "needs_review",
  watchEnabled: true
};

describe("surface renderer", () => {
  it("renders a booking list with resolved labels, not stored enums", () => {
    render(<SurfaceRenderer surface={surfaceOf({ component: "BookingList", key: "b", props: { bookings: [booking], title: "Stays" } })} />);

    expect(screen.getByRole("link", { name: "Grand Hyatt Kuala Lumpur" })).toHaveAttribute("href", "/bookings/booking-1");
    expect(screen.getByText("Needs review")).toBeInTheDocument();
    expect(screen.queryByText("needs_review")).not.toBeInTheDocument();
    expect(screen.getByText("$314.23")).toBeInTheDocument();
  });

  it("renders a message with its tone", () => {
    render(<SurfaceRenderer surface={surfaceOf({ component: "Message", key: "m", props: { text: "Nothing is due.", tone: "positive" } })} />);
    expect(screen.getByText("Nothing is due.")).toHaveAttribute("data-tone", "positive");
  });

  it("separates blockers from warnings by tone", () => {
    render(
      <SurfaceRenderer
        surface={surfaceOf({
          component: "EvidenceIssues",
          key: "e",
          props: { blockers: ["Policy equivalence is unknown."], warnings: ["The room is similar, not exact."] }
        })}
      />
    );

    expect(screen.getByText("Policy equivalence is unknown.")).toHaveAttribute("data-tone", "critical");
    expect(screen.getByText("The room is similar, not exact.")).toHaveAttribute("data-tone", "caution");
  });

  it("renders nothing for an issues node with no issues", () => {
    const { container } = render(
      <SurfaceRenderer surface={surfaceOf({ component: "EvidenceIssues", key: "e", props: { blockers: [], warnings: [] } })} />
    );
    expect(container.textContent).toBe("");
  });

  /*
   * The security boundary. An older client meeting a newer server must render
   * nothing for a name it does not know — never resolve it, never throw, and
   * never take the rest of the surface down with it.
   */
  it("ignores a component outside its catalogue without failing", () => {
    const unknown = { component: "ScriptTag", key: "x", props: { src: "https://evil.example/x.js" } } as unknown as SurfaceNode;
    render(<SurfaceRenderer surface={surfaceOf(unknown, { component: "Message", key: "m", props: { text: "Still here.", tone: "neutral" } })} />);

    expect(screen.getByText("Still here.")).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(screen.queryByText("https://evil.example/x.js")).not.toBeInTheDocument();
  });

  it("renders surface order as composed", () => {
    const { container } = render(
      <SurfaceRenderer
        surface={surfaceOf(
          { component: "EvidenceIssues", key: "e", props: { blockers: ["Blocker first."], warnings: [] } },
          { component: "BaselineAction", key: "a", props: { bookingId: "booking-1", label: "Use candidate as current" } }
        )}
      />
    );

    const text = container.textContent ?? "";
    expect(text.indexOf("Blocker first.")).toBeLessThan(text.indexOf("Use candidate as current"));
  });
});
