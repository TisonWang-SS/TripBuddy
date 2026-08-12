import type { RouteDecision } from "@/lib/agent/router";

/*
 * Shared scorer for routing, so the deterministic router and the model are
 * measured the same way. Mirrors providers/extractionEvaluation.ts: one
 * normalized score, so two implementations can be compared without changing the
 * acceptance criteria to suit whichever one is being promoted.
 */

export type RouterExpectation = {
  /** Only meaningful when `kind` is "capability". */
  capability?: string;
  kind: RouteDecision["kind"];
};

export type RouterFixture = {
  expected: RouterExpectation;
  id: string;
  request: string;
};

export type RouterFailure = {
  actual: string;
  expected: string;
  id: string;
  request: string;
};

export type RouterEvaluation = {
  failures: RouterFailure[];
  fixtures: { passed: number; total: number };
  score: number;
};

export function describeDecision(decision: RouteDecision) {
  return decision.kind === "capability" ? `capability:${decision.capability}` : decision.kind;
}

export function describeExpectation(expected: RouterExpectation) {
  return expected.kind === "capability" ? `capability:${expected.capability}` : expected.kind;
}

export async function evaluateIntentRouter(
  fixtures: readonly RouterFixture[],
  route: (request: string) => Promise<RouteDecision>
): Promise<RouterEvaluation> {
  const failures: RouterFailure[] = [];
  let passed = 0;

  for (const fixture of fixtures) {
    const decision = await route(fixture.request);
    const actual = describeDecision(decision);
    const expected = describeExpectation(fixture.expected);
    if (actual === expected) {
      passed += 1;
    } else {
      failures.push({ actual, expected, id: fixture.id, request: fixture.request });
    }
  }

  return {
    failures,
    fixtures: { passed, total: fixtures.length },
    score: fixtures.length === 0 ? 0 : passed / fixtures.length
  };
}
