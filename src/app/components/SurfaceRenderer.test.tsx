import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Surface, SurfaceNode } from "@/lib/agent/surface";
import type { HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
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

const searchSession: HotelSearchSessionSnapshot = {
  createdAt: "2030-08-01T00:00:00.000Z",
  expiresAt: "2030-08-02T00:00:00.000Z",
  id: "session-1",
  profileId: "primary",
  query: {
    adults: 2,
    budget: { amount: 500, basis: "per_night", basisAssumed: true, flexibility: "maximum" },
    checkIn: "2030-09-10",
    checkOut: "2030-09-12",
    city: "Tokyo",
    cityAsAsked: "东京",
    currency: "CNY",
    hotelGroup: "Hyatt"
  },
  results: {
    capturedAt: "2030-08-01T00:00:00.000Z",
    hotels: [{
      availabilityLabel: "Available",
      hotelGroup: "Hyatt",
      hotelKey: "hyatt:tokyo:grand-hyatt-tokyo",
      hotelName: "Grand Hyatt Tokyo",
      locationLabel: "Tokyo, Japan",
      offers: [{
        breakfastIncluded: null,
        cancellationPolicy: null,
        capturedAt: "2030-08-01T00:00:00.000Z",
        comparisonWarnings: [],
        currency: "CNY",
        displayedAmount: 450,
        displayedPriceBasis: "tax_exclusive",
        displayedPriceUnit: "avg_nightly",
        eliteNightEligible: true,
        evidenceLevel: "starting_price",
        feesAmount: null,
        feesIncluded: "excluded",
        hotelGroup: "Hyatt",
        loyaltyEligible: true,
        nights: 2,
        offerKey: "starting",
        providerName: "Hyatt",
        ratePlanName: null,
        roomType: null,
        sourceName: "Hyatt official",
        sourceType: "direct",
        sourceUrl: "https://www.hyatt.com/search",
        startingAvgNightlyRate: 450,
        staySubtotal: 900,
        stayTotal: null,
        taxesAmount: null,
        taxesAndFeesAmount: null,
        taxesIncluded: "excluded"
      }]
    }],
    summary: "One visible official rate.",
    warning: null
  },
  updatedAt: "2030-08-01T00:00:00.000Z"
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

  it("renders a saved hotel-search surface with its safe budget basis and upgrade path", () => {
    render(
      <SurfaceRenderer
        surface={surfaceOf({ component: "HotelSearchResults", key: "search", props: { session: searchSession } })}
      />
    );

    expect(screen.getByText(/东京 · 1 to review/)).toBeInTheDocument();
    expect(screen.getByText(/No basis was stated, so TripBuddy interpreted it as per night/)).toBeInTheDocument();
    expect(screen.getByText(/Starting Avg\/Night prices never qualify/)).toBeInTheDocument();
    expect(screen.getByText(/still need a tax-inclusive total/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Verify tax-inclusive total" }))
      .toHaveAttribute("href", "/hotel-search?sessionId=session-1");
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
