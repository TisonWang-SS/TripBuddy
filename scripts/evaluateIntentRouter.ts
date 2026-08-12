import { intentRouterFixtures } from "../src/lib/agent/router.fixtures";
import { evaluateIntentRouter } from "../src/lib/agent/routerEvaluation";
import { routeDeterministically, routeIntent } from "../src/lib/agent/router";
import { isLlmConfigured } from "../src/lib/providers/llmClient";
import baseline from "../docs/evals/intent-router-deterministic-baseline.json";

/*
 * Scores both routing paths against one fixture set.
 *
 * The deterministic router is the floor. It runs offline, so its score is a
 * stable baseline that a model has to match before it can be trusted with the
 * same job — the same contract the evidence extractor is held to.
 */

const requestedFixtureId = process.argv.find((argument) => argument.startsWith("--fixture="))?.slice("--fixture=".length);
const fixtures = requestedFixtureId
  ? intentRouterFixtures.filter((fixture) => fixture.id === requestedFixtureId)
  : intentRouterFixtures;
if (requestedFixtureId && fixtures.length === 0) {
  throw new Error(`Unknown router fixture: ${requestedFixtureId}`);
}

const deterministic = await evaluateIntentRouter(fixtures, async (request) => routeDeterministically(request));

const configured = isLlmConfigured();
const model = configured ? await evaluateIntentRouter(fixtures, (request) => routeIntent(request)) : null;

console.log(JSON.stringify({ configured, deterministic, model }, null, 2));

if (
  !requestedFixtureId &&
  (deterministic.score !== baseline.score ||
    deterministic.fixtures.total !== baseline.fixtures.total ||
    deterministic.fixtures.passed !== baseline.fixtures.passed)
) {
  throw new Error("The deterministic router or fixture set changed; review and update the stored baseline first.");
}

if (!configured) {
  console.log("\nTRIPBUDDY_LLM_API_KEY is not set; only the deterministic router was scored.");
} else if (requestedFixtureId ? model!.failures.length > 0 : model!.score < baseline.score) {
  process.exitCode = 1;
}
