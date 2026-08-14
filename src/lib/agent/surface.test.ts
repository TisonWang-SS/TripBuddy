import { describe, expect, it } from "vitest";
import {
  assertEvidencePrecedesActions,
  buildSurface,
  composeCapabilitySurface,
  composeMessageSurface,
  SurfaceContractError,
  type SurfaceNode
} from "./surface";

const evidence: SurfaceNode = {
  component: "EvidenceIssues",
  key: "evidence",
  props: { blockers: ["Cancellation-policy equivalence is unknown."], warnings: [] }
};

const action: SurfaceNode = {
  component: "BaselineAction",
  key: "action",
  props: { bookingId: "booking-1", label: "Use candidate as current" }
};

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

const recommendation = {
  blockers: ["Cancellation-policy equivalence is unknown."],
  costBreakdown: null,
  currency: "USD",
  decisionProvider: "deterministic",
  decisionVersion: "v2",
  estimatedSavings: 0,
  explanation: "Cancellation-policy equivalence is unknown.",
  generatedAt: "2026-08-11T03:01:00.000Z",
  qualityLevel: "needs_review",
  riskLevel: "high",
  verdict: "needs_review",
  warnings: []
};

const searchSession = {
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
  results: { capturedAt: null, hotels: [], summary: null, warning: null },
  updatedAt: "2030-08-01T00:00:00.000Z"
};

describe("surface ordering contract", () => {
  /*
   * The "Presentation" section of docs/PRD.md. This is the concrete reason
   * composition stays deterministic and server-owned: a model deciding layout
   * could not be held to this.
   */
  it("rejects a control that would change a baseline before its evidence", () => {
    expect(() => assertEvidencePrecedesActions([action, evidence])).toThrow(SurfaceContractError);
    expect(() => buildSurface("s1", [action, evidence])).toThrow(
      /"Presentation" section of docs\/PRD\.md/
    );
  });

  it("accepts evidence before the control", () => {
    expect(assertEvidencePrecedesActions([evidence, action])).toHaveLength(2);
  });

  it("accepts a surface with no such control at all", () => {
    expect(assertEvidencePrecedesActions([evidence])).toHaveLength(1);
    expect(assertEvidencePrecedesActions([])).toHaveLength(0);
  });

  it("rejects evidence that trails a control even when other evidence leads", () => {
    expect(() => assertEvidencePrecedesActions([evidence, action, evidence])).toThrow(SurfaceContractError);
  });
});

describe("surface composition", () => {
  it("composes a booking list", () => {
    const surface = composeCapabilitySurface("list_bookings", { bookings: [booking] }, "s1");
    expect(surface?.nodes).toHaveLength(1);
    expect(surface?.nodes[0].component).toBe("BookingList");
    expect(surface?.version).toBe("tripbuddy-surface-1");
  });

  it("says so plainly when there is nothing to show", () => {
    const surface = composeCapabilitySurface("list_bookings", { bookings: [] }, "s1");
    expect(surface?.nodes[0]).toMatchObject({ component: "Message", props: { text: "Nothing on the desk yet." } });
  });

  /* The verdict and its blockers arrive together, in that order. */
  it("composes a recommendation with its evidence after it", () => {
    const surface = composeCapabilitySurface("explain_recommendation", { recommendation }, "s1");
    expect(surface?.nodes.map((node) => node.component)).toEqual(["RecommendationPanel", "EvidenceIssues"]);
  });

  it("flattens scalar settings into facts and drops nested structures", () => {
    const surface = composeCapabilitySurface(
      "get_settings",
      { conversionRates: [{ rate: 7 }], displayCurrency: "USD", llmExtractionConfigured: true },
      "s1"
    );
    const node = surface?.nodes[0];
    expect(node?.component).toBe("Facts");
    expect(node?.component === "Facts" && node.props.items).toEqual([
      { label: "Display currency", value: "USD" },
      { label: "Llm extraction configured", value: "true" }
    ]);
  });

  it("composes a stored hotel search session into its closed surface node", () => {
    const surface = composeCapabilitySurface("get_hotel_search_session", { session: searchSession }, "s1");
    expect(surface?.nodes).toEqual([
      { component: "HotelSearchResults", key: "hotel-search", props: { session: searchSession } }
    ]);
    expect(composeCapabilitySurface("get_hotel_search_session", { session: null }, "s1")?.nodes[0])
      .toMatchObject({ component: "Message", props: { tone: "caution" } });
  });

  it("links a hotel-search launch to the session that will own its result", () => {
    const surface = composeCapabilitySurface(
      "search_hotels",
      { launchUrl: "https://www.hyatt.com/search", searchSessionId: "session with spaces", taskId: "task-1" },
      "s1",
      "/hotel-search"
    );
    expect(surface?.nodes[0]).toMatchObject({
      component: "TaskLaunch",
      props: { resultRoute: "/hotel-search?sessionId=session+with+spaces&taskId=task-1" }
    });
  });

  /* A capability with no rendered form says so, rather than inventing one. */
  it("returns null for a capability it cannot render", () => {
    /*
     * A tax-inclusive capture is read back as its session, so it has no surface
     * of its own — the loop composes `get_hotel_search_session` from the reread.
     */
    expect(composeCapabilitySurface("get_tax_inclusive_total", { taskId: "t1" }, "s1")).toBeNull();
    expect(composeCapabilitySurface("not_a_capability", {}, "s1")).toBeNull();
  });

  /*
   * Browser tasks the loop waited out do have a rendered form now: the
   * conversation is where their outcome is reported, and a finished check that
   * says nothing reads as one that did not run.
   */
  it("reports a finished browser task in the conversation", () => {
    const surface = composeCapabilitySurface("run_price_check", { taskId: "t1" }, "s1");
    expect(surface?.nodes[0]).toMatchObject({ component: "Message", props: { tone: "positive" } });
  });

  it("composes a standalone message", () => {
    const surface = composeMessageSurface("s1", "TripBuddy only tracks Hyatt hotel bookings.", "caution");
    expect(surface.nodes).toEqual([
      { component: "Message", key: "message", props: { text: "TripBuddy only tracks Hyatt hotel bookings.", tone: "caution" } }
    ]);
  });
});
