import { describe, expect, it, vi } from "vitest";
import type { RouteDecision } from "./router";
import { describeDecision, evaluateIntentRouter, type RouterFixture } from "./routerEvaluation";

vi.mock("@/lib/db", () => ({ prisma: {} }));

const fixtures: readonly RouterFixture[] = [
  { expected: { capability: "list_bookings", kind: "capability" }, id: "list", request: "my bookings" },
  { expected: { kind: "unsupported" }, id: "flight", request: "book a flight" }
];

function decide(kind: RouteDecision["kind"], capability = "list_bookings"): RouteDecision {
  if (kind === "capability") {
    return { args: {}, capability, kind, source: "deterministic" };
  }
  return kind === "clarify"
    ? { kind, question: "which one?", source: "deterministic" }
    : { kind, message: "out of scope", source: "deterministic" };
}

describe("router evaluation", () => {
  it("scores a routing decision by where it went, not how it was worded", () => {
    expect(describeDecision(decide("capability"))).toBe("capability:list_bookings");
    expect(describeDecision(decide("unsupported"))).toBe("unsupported");
    expect(describeDecision(decide("clarify"))).toBe("clarify");
  });

  it("passes only when the decision matches the expectation", async () => {
    const result = await evaluateIntentRouter(fixtures, async (request) =>
      request === "my bookings" ? decide("capability") : decide("unsupported")
    );
    expect(result).toMatchObject({ fixtures: { passed: 2, total: 2 }, score: 1 });
    expect(result.failures).toEqual([]);
  });

  /* A capability that routed somewhere plausible but wrong is still a failure. */
  it("records the actual destination when a fixture fails", async () => {
    const result = await evaluateIntentRouter(fixtures, async () => decide("capability", "get_booking"));
    expect(result.score).toBe(0);
    expect(result.failures).toEqual([
      { actual: "capability:get_booking", expected: "capability:list_bookings", id: "list", request: "my bookings" },
      { actual: "capability:get_booking", expected: "unsupported", id: "flight", request: "book a flight" }
    ]);
  });

  it("scores an empty fixture set as zero rather than dividing by zero", async () => {
    expect(await evaluateIntentRouter([], async () => decide("capability"))).toMatchObject({ score: 0 });
  });
});
