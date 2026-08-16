import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { loopScenarios, type LoopScenario, type LoopScenarioTurn, STAY_PLACEHOLDER } from "../src/lib/agent/loop.fixtures";
import type { AgentEvent } from "../src/lib/agent/events";
import { runAgentTurn } from "../src/lib/agent/loop";
import { isLlmConfigured } from "../src/lib/providers/llmClient";
import { createHotelSearchSession, replaceOfficialSearchResults } from "../src/lib/hotelSearchSessions";
import { prisma } from "../src/lib/db";

/*
 * Runs the conversation scenarios against the real loop and the real model.
 *
 * Not a test suite. A model's wording varies between runs, so this reports what
 * happened and leaves the judgement to a reader; only the coarse structural
 * expectations — did it call that tool, did it avoid the other, did it stop for
 * a press — are checked mechanically, and those are the ones that actually
 * caught defects.
 *
 * A scenario that reaches the point of opening a Hyatt tab has proved what it
 * set out to, so the run is aborted there. Waiting would mean waiting on a
 * browser this process does not have, which the tab-pickup grace would end
 * twenty-five seconds later with nothing learned.
 *
 *   npm run eval:agent-loop
 *   npm run eval:agent-loop -- --scenario=followup-budget
 *   npm run eval:agent-loop -- --group=boundary
 */

const argument = (name: string) =>
  process.argv.find((entry) => entry.startsWith(`--${name}=`))?.slice(name.length + 3);

const scenarioId = argument("scenario");
const group = argument("group");
const selected = loopScenarios.filter(
  (scenario) => (!scenarioId || scenario.id === scenarioId) && (!group || scenario.group === group)
);
if (selected.length === 0) {
  throw new Error(`No scenarios matched${scenarioId ? ` --scenario=${scenarioId}` : ""}${group ? ` --group=${group}` : ""}.`);
}
const llmConfigured = isLlmConfigured();
if (!llmConfigured) {
  throw new Error("TRIPBUDDY_LLM_API_KEY is not set; the agent loop cannot be scored without a model.");
}

type TurnReport = {
  cards: string[];
  confirmed: string | null;
  events: AgentEvent[];
  failed: string | null;
  misses: string[];
  openedTab: boolean;
  said: string;
  tools: string[];
};

type PersistedTurn = {
  conversationBefore: { content: string; role: "assistant" | "user" }[];
  error: string | null;
  input: string;
  memoryAfter: unknown;
  memoryBefore: unknown;
  reaches: LoopScenarioTurn["reaches"];
  report: TurnReport;
};

type PersistedScenario = {
  expect: string;
  group: LoopScenario["group"];
  id: string;
  misses: string[];
  name: string;
  threw: boolean;
  turns: PersistedTurn[];
};

type PersistedRun = {
  commit: string | null;
  finishedAt: string | null;
  group: string | null;
  llmConfigured: boolean;
  scenario: string | null;
  scenarios: PersistedScenario[];
  startedAt: string;
  status: "complete" | "running";
  summary: { clean: number; misses: number; scenarios: number; threw: number } | null;
  traceVersion: 1;
};

const startedAt = new Date();
const runStamp = startedAt.toISOString().replace(/[.:]/g, "-");
const traceDirectory = join(process.cwd(), "data", "evals", "agent-loop");
const traceJsonPath = join(traceDirectory, `agent-loop-${runStamp}.json`);
const traceMarkdownPath = join(traceDirectory, `agent-loop-${runStamp}.md`);

const persistedRun: PersistedRun = {
  commit: null,
  finishedAt: null,
  group: group ?? null,
  llmConfigured,
  scenario: scenarioId ?? null,
  scenarios: [],
  startedAt: startedAt.toISOString(),
  status: "running",
  summary: null,
  traceVersion: 1
};

function jsonString(value: unknown) {
  return JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? `${current}n` : current), 2);
}

function markdownString(value: string) {
  return value.replaceAll("```", "\\`\\`\\`");
}

function renderMarkdown(run: PersistedRun) {
  const lines = [
    "# TripBuddy agent-loop evaluation",
    "",
    `- Status: ${run.status}`,
    `- Started: ${run.startedAt}`,
    `- Finished: ${run.finishedAt ?? "running"}`,
    `- Commit: ${run.commit ?? "unknown"}`,
    `- Selection: ${run.scenario ? `scenario=${run.scenario}` : run.group ? `group=${run.group}` : "all scenarios"}`,
    "- The JSON file beside this report contains the complete event trace, conversation context, memory, and turn report.",
    ""
  ];

  if (run.summary) {
    lines.push(
      `## Summary: ${run.summary.clean}/${run.summary.scenarios} clean, ${run.summary.misses} with misses, ${run.summary.threw} threw`,
      ""
    );
  }

  for (const scenario of run.scenarios) {
    lines.push(`## ${scenario.id} — ${scenario.name}`, "", scenario.expect, "");
    for (const [index, turn] of scenario.turns.entries()) {
      const report = turn.report;
      lines.push(
        `### Turn ${index + 1}`,
        "",
        `**Input**: ${turn.input}`,
        `**Tools**: ${report.tools.length ? report.tools.join(", ") : "none"}`,
        `**Cards**: ${report.cards.length ? report.cards.join(", ") : "none"}`,
        `**Opened Hyatt tab**: ${report.openedTab ? "yes" : "no"}`,
        `**Confirmation**: ${report.confirmed ?? "none"}`,
        `**Error**: ${report.failed ?? turn.error ?? "none"}`,
        `**Misses**: ${report.misses.length ? report.misses.join("; ") : "none"}`,
        "",
        "#### Assistant reply",
        "",
        "```text",
        markdownString(report.said || "(no assistant prose)"),
        "```",
        "",
        "#### Event timeline",
        "",
        "```json",
        jsonString(report.events),
        "```",
        ""
      );
    }
  }
  return lines.join("\n");
}

async function persistTrace() {
  await mkdir(traceDirectory, { recursive: true });
  await writeFile(traceJsonPath, jsonString(persistedRun), "utf8");
  await writeFile(traceMarkdownPath, renderMarkdown(persistedRun), "utf8");
}

console.log(`Trace JSON: ${traceJsonPath}`);
console.log(`Trace Markdown: ${traceMarkdownPath}`);

/**
 * A captured search for the follow-up scenarios to work from.
 *
 * Seeded rather than searched: a real capture needs a browser, and what these
 * scenarios are about is what the loop does with results it already has.
 */
async function seedSearchSession() {
  const checkIn = offsetDate(30);
  const [, month, day] = checkIn.split("-");
  const spokenStay = `${Number(month)}月${Number(day)}日`;
  const session = await createHotelSearchSession({
    adults: 2,
    budget: null,
    checkIn,
    checkOut: offsetDate(31),
    city: "Shanghai",
    cityAsAsked: "上海",
    currency: "USD",
    hotelGroup: "Hyatt",
    priceMode: "cash"
  });
  await replaceOfficialSearchResults({
    capturedAt: new Date().toISOString(),
    hotelGroup: "Hyatt",
    results: [
      { availabilityLabel: "Available", avgNightlyRate: 165, currency: "USD", hotelName: "Hyatt on the Bund, Shanghai", locationLabel: "Shanghai", pointsPerNight: null, priceBasis: "tax_exclusive", priceMode: "cash", sourceUrl: "https://www.hyatt.com/shop" },
      { availabilityLabel: "Available", avgNightlyRate: 51, currency: "USD", hotelName: "Hyatt Place Shanghai Lingang", locationLabel: "Shanghai", pointsPerNight: null, priceBasis: "tax_exclusive", priceMode: "cash", sourceUrl: "https://www.hyatt.com/shop" },
      { availabilityLabel: "Available", avgNightlyRate: 210, currency: "USD", hotelName: "Park Hyatt Shanghai", locationLabel: "Shanghai", pointsPerNight: null, priceBasis: "tax_exclusive", priceMode: "cash", sourceUrl: "https://www.hyatt.com/shop" }
    ],
    searchSessionId: session.id,
    summary: "3 hotels",
    warning: null
  });
  return { sessionId: session.id, spokenStay };
}

function offsetDate(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function runTurn(
  turn: LoopScenarioTurn,
  conversation: { content: string; role: "assistant" | "user" }[],
  memory: unknown
): Promise<{ memory: unknown; report: TurnReport }> {
  const controller = new AbortController();
  const report: TurnReport = { cards: [], confirmed: null, events: [], failed: null, misses: [], openedTab: false, said: "", tools: [] };
  let carried = memory;

  await runAgentTurn({ conversation, memory, message: turn.say }, (event: AgentEvent) => {
    report.events.push(event);
    if (event.type === "TOOL_CALL_START") {
      report.tools.push(event.toolCallName);
    } else if (event.type === "TEXT_MESSAGE_CONTENT") {
      report.said += event.delta;
    } else if (event.type === "RUN_ERROR") {
      report.failed = `${event.code}: ${event.message}`;
    } else if (event.type === "CUSTOM" && event.name === "memory") {
      carried = event.value;
    } else if (event.type === "CUSTOM" && event.name === "browser_task_launch") {
      /* Proved what it set out to; waiting would wait on a browser we lack. */
      report.openedTab = true;
      controller.abort();
    } else if (event.type === "CUSTOM" && event.name === "surface") {
      for (const node of (event.value as { nodes: { component: string; props: Record<string, unknown> }[] }).nodes) {
        report.cards.push(node.component);
        if (node.component === "ConfirmAction") {
          report.confirmed = String(node.props.capability);
        }
      }
    }
  }, { signal: controller.signal });

  /*
   * The abort above surfaces as a cancellation error. It is this script's own
   * doing, not the loop's, and reporting it as a failure would teach the reader
   * to ignore the one column that matters.
   */
  if (report.openedTab && report.failed?.startsWith("browser_task_unfinished")) {
    report.failed = null;
  }

  const wanted = turn.reaches;
  if (wanted?.calls && !report.tools.includes(wanted.calls)) {
    report.misses.push(`expected to call ${wanted.calls}`);
  }
  if (wanted?.avoids && report.tools.includes(wanted.avoids)) {
    report.misses.push(`should not have called ${wanted.avoids}`);
  }
  if (wanted?.confirms === true && report.confirmed === null) {
    report.misses.push("expected a confirmation card");
  }
  if (wanted?.confirms === false && report.confirmed !== null) {
    report.misses.push(`unexpected confirmation for ${report.confirmed}`);
  }
  if (wanted?.opensTab === true && !report.openedTab) {
    report.misses.push("expected to open a Hyatt tab");
  }
  if (wanted?.opensTab === false && report.openedTab) {
    report.misses.push("should not have opened a Hyatt tab");
  }
  if (wanted?.says && !report.said.includes(wanted.says)) {
    report.misses.push(`expected the reply to mention "${wanted.says}"`);
  }
  if (wanted?.saysNot && report.said.includes(wanted.saysNot)) {
    report.misses.push(`the reply should not have said "${wanted.saysNot}"`);
  }
  return { memory: carried, report };
}

async function runScenario(scenario: LoopScenario, sessionId: string, stay: string) {
  /* The seed says the dates the session was captured for; see STAY_PLACEHOLDER. */
  const conversation = (scenario.seed ?? []).map((turn) => ({
    ...turn,
    content: turn.content.replaceAll(STAY_PLACEHOLDER, stay)
  }));
  let memory: unknown = scenario.needsSession ? { searchSessionIds: [sessionId] } : undefined;
  const reports: TurnReport[] = [];
  const turns: PersistedTurn[] = [];

  console.log(`\n### ${scenario.id} — ${scenario.name}`);
  console.log(`    ${scenario.expect}`);
  for (const turn of scenario.turns) {
    console.log(`  > ${turn.say.length > 90 ? `${turn.say.slice(0, 90)}…` : turn.say}`);
    let result;
    const conversationBefore = conversation.map((entry) => ({ ...entry }));
    const memoryBefore = memory;
    try {
      result = await runTurn(turn, conversation, memory);
    } catch (error) {
      console.log(`    THREW ${error instanceof Error ? error.message : String(error)}`);
      const report: TurnReport = { cards: [], confirmed: null, events: [], failed: "threw", misses: ["threw"], openedTab: false, said: "", tools: [] };
      reports.push(report);
      turns.push({ conversationBefore, error: error instanceof Error ? error.message : String(error), input: turn.say, memoryAfter: memory, memoryBefore, reaches: turn.reaches, report });
      break;
    }
    memory = result.memory;
    const { report } = result;
    reports.push(report);
    turns.push({ conversationBefore, error: null, input: turn.say, memoryAfter: result.memory, memoryBefore, reaches: turn.reaches, report });

    console.log(
      `    tools=[${report.tools.join(",")}] cards=[${report.cards.join(",")}]` +
      `${report.openedTab ? " tab=opened" : ""}${report.confirmed ? ` confirm=${report.confirmed}` : ""}` +
      `${report.failed ? ` ERROR=${report.failed.slice(0, 80)}` : ""}`
    );
    if (report.said) {
      console.log(`    said: ${report.said.replace(/\n/g, " ").slice(0, 180)}`);
    }
    for (const miss of report.misses) {
      console.log(`    MISS: ${miss}`);
    }

    conversation.push({ content: turn.say, role: "user" });
    if (report.said) {
      conversation.push({ content: report.said, role: "assistant" });
    }
  }
  return { reports, turns };
}

const seeded = selected.some((scenario) => scenario.needsSession)
  ? await seedSearchSession()
  : { sessionId: "", spokenStay: "" };
try {
  persistedRun.commit = (await import("node:child_process")).execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
} catch {
  persistedRun.commit = null;
}

for (const scenario of selected) {
  const { reports, turns } = await runScenario(scenario, seeded.sessionId, seeded.spokenStay);
  const scenarioReport: PersistedScenario = {
    expect: scenario.expect,
    id: scenario.id,
    group: scenario.group,
    misses: reports.flatMap((report) => report.misses),
    name: scenario.name,
    threw: reports.some((report) => report.failed === "threw"),
    turns
  };
  persistedRun.scenarios.push(scenarioReport);
  await persistTrace();
  if (scenarioReport.threw) {
    console.log(`  Trace checkpoint written after ${scenario.id}.`);
  }
}

const all = persistedRun.scenarios.map((entry) => ({
  id: entry.id,
  misses: entry.misses,
  threw: entry.threw
}));

const missed = all.filter((entry) => entry.misses.length > 0);
persistedRun.summary = {
  clean: all.length - missed.length,
  misses: missed.length,
  scenarios: all.length,
  threw: all.filter((entry) => entry.threw).length
};
persistedRun.status = "complete";
persistedRun.finishedAt = new Date().toISOString();
await persistTrace();

/* The console summary remains the quick terminal view; the JSON and Markdown
 * checkpoints above are the durable analysis artifacts. */
if (seeded.sessionId) {
  await prisma.hotelSearchSession.deleteMany({ where: { id: seeded.sessionId } });
}

console.log(`\n${"=".repeat(60)}`);
console.log(`${selected.length} scenarios, ${all.length - missed.length} clean, ${missed.length} with misses.`);
for (const entry of missed) {
  console.log(`  ${entry.id}: ${entry.misses.join("; ")}`);
}
console.log("\nMisses are a prompt to look, not a verdict — a live model varies, and the prose is judged by reading it.");

/* Only a crash fails the run. Everything else is for a person to weigh. */
if (all.some((entry) => entry.threw)) {
  process.exitCode = 1;
}
await prisma.$disconnect();
