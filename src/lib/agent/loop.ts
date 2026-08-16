/*
 * The agent loop.
 *
 * One turn of the conversation is: deliberate, act, observe, repeat — until the
 * model has enough to advise, needs something only the user can supply, or runs
 * out of steps. This replaces the single-shot router as the primary path (ADR
 * 0005). The router survives as the offline path, because a local-first product
 * has to stay usable with no API key, and keyword routing is what it had before.
 *
 * Four properties, all enforced here rather than hoped for:
 *
 * - **A tab needs a press.** Every capability that opens Hyatt, or writes,
 *   suspends the turn and asks. The loop is autonomous about reading and
 *   reasoning, never about acting for someone. One press authorises one call.
 *
 * - **The run outlives the tab.** After a browser task starts, the loop waits on
 *   the server for the Companion's evidence, then feeds it back to the model.
 *   That is what puts a search result in the conversation rather than on a page
 *   the user has to go find.
 *
 * - **Steps are bounded.** A model that keeps proposing tools is stopped and
 *   made to answer from what it already has.
 *
 * - **A turn has one ending.** Every path produces a `TurnOutcome` and returns;
 *   only `concludeTurn` emits a terminal event. This is structural rather than
 *   stylistic: the invariants that matter — a failure never discards work the
 *   user already paid for, RUN_ERROR is never followed by RUN_FINISHED — held
 *   in some of the seven earlier exits and not others, and each new failure
 *   mode was a new chance to forget one.
 */

import { CapabilityArgsError } from "@/lib/agent/args";
import { refusedAction, UNSUPPORTED_MESSAGE } from "@/lib/agent/boundaries";
import { awaitBrowserTask, BrowserTaskWaitError } from "@/lib/agent/browserTaskWait";
import type { BookingSummary } from "@/lib/agent/capabilities/bookings";
import type { AgentEvent } from "@/lib/agent/events";
import { observeToolResult, type ToolObservation } from "@/lib/agent/modelView";
import { isPlannerConfigured, planNextStep, type PlannerStep } from "@/lib/agent/planner";
import { loadPriorSearches, type PriorSearch } from "@/lib/agent/priorWork";
import {
  capabilityResultRoute,
  describeCapabilityChange,
  invokeCapability,
  mutatesByName,
  needsPress,
  parseCapabilityArgs,
  precheckCapability,
  requireCapability
} from "@/lib/agent/registry";
import { routeIntent } from "@/lib/agent/router";
import {
  type AdviceSource,
  composeAdviceSurface,
  composeCapabilitySurface,
  composeConfirmSurface,
  composeMessageSurface,
  type Surface
} from "@/lib/agent/surface";
import { parseTurnMemory, rememberTurn, type TurnMemory } from "@/lib/agent/turnMemory";
import type { AgentConversationMessage } from "@/lib/agent/types";
import { getHotelSearchSession, type HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import type { Tone } from "@/lib/labels";
import { LlmError } from "@/lib/providers/llmClient";

/**
 * How many deliberations one turn may spend on tools.
 *
 * Raised from six once browser work stopped needing a press: a turn can now run
 * search → verify a total → apply a budget → compare against a booking without
 * the user re-entering between each, and six ran out mid-thought.
 */
const MAX_TOOL_STEPS = 12;

/**
 * How often one capability may run in a turn, whatever the arguments.
 *
 * Different arguments are a different question — three hotels' details is three
 * legitimate calls — so this is not deduplication; exact repeats are dropped
 * separately and for a different reason. This is the ceiling on a model that has
 * decided to work through a list of twenty.
 */
const MAX_CALLS_PER_CAPABILITY = 4;

export type AgentTurnRequest = {
  /** The exchange so far, oldest first, not including `message`. */
  conversation?: readonly AgentConversationMessage[];
  /** Set when the user pressed the button on a ConfirmAction card. */
  confirm?: { args: unknown; capability: string };
  /**
   * What earlier turns of this conversation left behind, as this server handed
   * it out. The client stores it and returns it untouched; see `turnMemory`.
   */
  memory?: unknown;
  /** What the user just said. Absent on a confirmation press. */
  message?: string;
};

export type AgentEventSink = (event: AgentEvent) => void;

export type TurnOptions = {
  now?: () => number;
  referenceDate?: Date;
  runId?: string;
  signal?: AbortSignal;
};

/**
 * How a turn ended, decided before anything terminal is emitted.
 *
 * Returning one of these rather than emitting in place is what gives the turn a
 * single ending. `conductTurn` never emits a terminal event; `concludeTurn`
 * only ever emits one.
 */
type TurnOutcome =
  /** The assistant has something to say, and that ends the turn. */
  | { kind: "said"; surface: Surface; text: string }
  /** A confirmation card is already on screen; the turn waits for the press. */
  | { kind: "awaiting_press" }
  /** Nothing usable happened. Downgraded by `concludeTurn` if work survived. */
  | { code: string; kind: "failed"; message: string };

/** Everything one turn needs, gathered once so the phases below stay pure-ish. */
type TurnContext = {
  conversation: AgentConversationMessage[];
  emit: AgentEventSink;
  memory: TurnMemory;
  now: () => number;
  /** Tool results collected this turn, in order. Read by a failure to see what survived. */
  observations: ToolObservation[];
  /** How many times each capability has run this turn. Bounded by `MAX_CALLS_PER_CAPABILITY`. */
  callsPerCapability: Map<string, number>;
  /** Call signatures already run this turn, so an exact repeat is skipped rather than re-run. */
  ranThisTurn: Set<string>;
  options: TurnOptions;
  priorSearches: readonly PriorSearch[];
  runId: string;
  /** What a recommendation may point at, accumulated as tools run. */
  source: AdviceSource;
  surfaceCount: { messages: number; tools: number };
};

export async function runAgentTurn(request: AgentTurnRequest, emit: AgentEventSink, options: TurnOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const runId = options.runId ?? globalThis.crypto.randomUUID();
  const memory = parseTurnMemory(request.memory);

  const context: TurnContext = {
    conversation: [
      ...(request.conversation ?? []).filter((turn) => typeof turn.content === "string" && turn.content.trim().length > 0),
      ...(request.message && request.message.trim().length > 0
        ? [{ content: request.message.trim(), role: "user" as const }]
        : [])
    ],
    emit,
    memory,
    now,
    callsPerCapability: new Map<string, number>(),
    observations: [],
    options,
    ranThisTurn: new Set<string>(),
    priorSearches: [],
    runId,
    /* Seeded from memory: a ref shown last turn still names the same row. */
    source: { bookings: [], hotelSession: null, refs: { ...(memory.refs ?? {}) } },
    surfaceCount: { messages: 0, tools: 0 }
  };

  emit({ runId, timestamp: now(), type: "RUN_STARTED" });

  let outcome: TurnOutcome;
  try {
    outcome = await conductTurn(context, request);
  } catch (error) {
    outcome = {
      code: errorCode(error),
      kind: "failed",
      message: error instanceof Error ? error.message : "The request could not be run."
    };
  }
  concludeTurn(context, outcome);
}

/**
 * The single ending.
 *
 * Two invariants live here and nowhere else. A failure that happened after real
 * work does not read as a failure — a captured total means a tab opened, the
 * user waited, and the figure is stored, none of which a later error undoes. And
 * RUN_ERROR is terminal, so RUN_FINISHED never follows it.
 */
function concludeTurn(context: TurnContext, outcome: TurnOutcome) {
  const { emit, now, runId } = context;

  if (outcome.kind === "failed" && context.observations.length > 0) {
    const text = partialWork(context.conversation, context.observations.length > 0);
    outcome = { kind: "said", surface: composeMessageSurface(nextSurfaceId(context), text, "caution"), text };
  }

  if (outcome.kind === "failed") {
    emit({ code: outcome.code, message: outcome.message, runId, timestamp: now(), type: "RUN_ERROR" });
    return;
  }

  if (outcome.kind === "said") {
    say(context, outcome.text, outcome.surface);
  }

  /* What this turn learned, for the client to hand back next time. */
  emit({
    name: "memory",
    timestamp: now(),
    type: "CUSTOM",
    value: rememberTurn(context.memory, {
      refs: context.source.refs,
      searchSessionIds: context.source.hotelSession ? [context.source.hotelSession.id] : []
    })
  });
  emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
}

/** Decides how the turn ends. Never emits a terminal event. */
async function conductTurn(context: TurnContext, request: AgentTurnRequest): Promise<TurnOutcome> {
  const { conversation } = context;

  if (conversation.length === 0 && !request.confirm) {
    return { code: "empty_request", kind: "failed", message: "Say what you would like to do." };
  }

  /*
   * Checked before the model runs, so the refusal cannot be planned around. A
   * confirmation press carries no new wording, so there is nothing to check.
   *
   * Paired with the scope sentence, because this fires on the verb alone and
   * cannot tell what was being asked for: "book me a flight" trips it and would
   * otherwise be answered only with what the product does not do to a
   * reservation — true, but silent on the flight.
   */
  const refusal = refusedAction(userWording(conversation).toLowerCase());
  if (refusal) {
    return spoke(context, `${refusal}\n\n${UNSUPPORTED_MESSAGE}`, "caution");
  }

  if (!isPlannerConfigured()) {
    return runOfflineTurn(context);
  }

  context.priorSearches = await loadPriorSearches(context.memory.searchSessionIds, context.now);
  return runPlannedTurn(context, request);
}

/**
 * The deliberate → act → observe loop itself.
 *
 * One press authorises one call, held as a value that is spent rather than a
 * predicate over the request: a predicate stays true, so a plan proposing the
 * same capability again later would open a second tab on the strength of a
 * press made for the first one.
 */
async function runPlannedTurn(context: TurnContext, request: AgentTurnRequest): Promise<TurnOutcome> {
  let pending = request.confirm;
  let authorised = request.confirm ?? null;

  const spendAuthorisation = (capability: string) => {
    if (authorised?.capability !== capability) {
      return false;
    }
    authorised = null;
    return true;
  };

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    let plan: PlannerStep;
    if (pending) {
      /*
       * The press already decided this call. Re-planning here would let a second
       * deliberation substitute a different action for the one agreed to.
       */
      plan = { calls: [{ args: pending.args, capability: pending.capability }], kind: "tools", message: "" };
      pending = undefined;
    } else {
      plan = await think(context, MAX_TOOL_STEPS - step);
    }

    if (plan.kind !== "tools") {
      return conclusionOf(context, plan);
    }

    const outcome = await runToolStep(context, plan, spendAuthorisation);
    if (outcome !== "continue") {
      return outcome;
    }
  }

  /*
   * Out of steps with tools still being proposed. Asking for a conclusion from
   * what was already collected beats both alternatives: silence, or another
   * round the budget cannot pay for anyway.
   */
  const final = await think(context, 0);
  return conclusionOf(context, final.kind === "tools" ? { kind: "ask", message: OUT_OF_STEPS } : final);
}

/**
 * Runs the calls of one planned step.
 *
 * Returns "continue" when the loop should deliberate again — either the calls
 * all ran, or one failed in a way the model is expected to correct.
 */
async function runToolStep(
  context: TurnContext,
  plan: Extract<PlannerStep, { kind: "tools" }>,
  spendAuthorisation: (capability: string) => boolean
): Promise<TurnOutcome | "continue"> {
  /*
   * What the model says before work that costs a press, said once and only once
   * that work is known to be runnable. Announcing it up front produced "I will
   * search Shanghai under your ¥1000 budget" immediately followed by a precheck
   * refusing that very search.
   *
   * Only before a press. It was originally spoken before any tool, and the model
   * took that as an invitation to narrate: four reads produced four near-identical
   * paragraphs, each repeating what the answer was about to say anyway. A free
   * read already shows its own progress line and its own result card.
   */
  const note = plan.message ?? "";
  let noteSpoken = note.length === 0;
  const speakNote = () => {
    if (!noteSpoken) {
      noteSpoken = true;
      say(context, note, composeMessageSurface(nextSurfaceId(context), note, "neutral"));
    }
  };

  for (const proposed of plan.calls) {
    /* The model names rows; the tools take identifiers. */
    const call = { args: resolveRefs(proposed.args, context.source.refs), capability: proposed.capability };

    /*
     * An exact repeat — same capability, same arguments — is the model losing
     * its place rather than asking a second question. Observed requesting one
     * hotel's detail three times over and narrating each. Skipping is safer than
     * running it again: repeating a read wastes a request, and repeating
     * anything else is a second action.
     */
    const signature = `${call.capability}:${JSON.stringify(call.args)}`;
    if (context.ranThisTurn.has(signature)) {
      continue;
    }

    /*
     * A ceiling on how far one capability can be worked, separate from the
     * above: asking four hotels for their cancellation terms is four real
     * questions, asking twenty is a model that has mistaken the tool for a
     * loop. Silently stopping is right — the results already gathered are
     * good, and the answer is built from those.
     */
    const used = context.callsPerCapability.get(call.capability) ?? 0;
    if (used >= MAX_CALLS_PER_CAPABILITY) {
      continue;
    }
    context.callsPerCapability.set(call.capability, used + 1);
    context.ranThisTurn.add(signature);

    /*
     * Checked before the call runs, whether or not it will also ask for a press.
     * It used to live inside the confirmation branch, which meant that when
     * browser work stopped needing one, the currency check stopped running with
     * it — a budget in the wrong currency would have reached Hyatt.
     */
    let args: unknown;
    let blocker: Awaited<ReturnType<typeof precheckCapability>>;
    try {
      args = parseCapabilityArgs(call.capability, call.args);
      blocker = await precheckCapability(call.capability, args);
    } catch (error) {
      /*
       * A capability refusing its own arguments is a question, not a failed
       * run: it knows something the planner could not — a stay that has already
       * happened, an expired session — and it wrote a sentence saying what to
       * do about it. Parsing moved out of the confirmation branch when browser
       * work stopped needing one, and briefly moved outside this net with it.
       */
      if (error instanceof CapabilityArgsError) {
        return spoke(context, error.message, "caution");
      }
      throw error;
    }
    if (typeof blocker === "string") {
      /* Only the user can resolve this one; the wording is product-owned. */
      return spoke(context, blocker, "caution");
    }
    if (blocker) {
      /*
       * The model can fix this itself — a stale row reference, usually. Handed
       * back as an observation it corrects course inside the same turn; ended
       * here instead, a recoverable mistake becomes a wall.
       */
      context.observations.push({ capability: call.capability, refs: {}, view: { error: blocker.retryable } });
      return "continue";
    }

    /*
     * Said before anything with a cost — a tab that will open, a setting that
     * will change — and not before a plain read, which has its own progress line
     * and its own result card. Spoken before every tool it became narration.
     */
    if (mutatesByName(call.capability)) {
      speakNote();
    }

    if (needsPress(call.capability) && !spendAuthorisation(call.capability)) {
      context.emit({
        name: "surface",
        timestamp: context.now(),
        type: "CUSTOM",
        value: composeConfirmSurface(nextSurfaceId(context), {
          args,
          capability: call.capability,
          detail: describeCapabilityChange(call.capability, args) ?? confirmDetail(call.capability, args),
          label: confirmLabel(call.capability)
        })
      });
      return { kind: "awaiting_press" };
    }

    let observed: ActedTool;
    try {
      observed = await act(call, {
        emit: context.emit,
        now: context.now,
        runId: context.runId,
        signal: context.options.signal,
        toolIndex: ++context.surfaceCount.tools
      });
    } catch (error) {
      /*
       * A capability refusing its own arguments is a question, not a failed run:
       * it knows something the planner could not — an expired session, a budget
       * in a currency the results are not priced in — and it wrote a sentence
       * saying what to do about it.
       */
      if (error instanceof CapabilityArgsError) {
        return spoke(context, error.message, "caution");
      }
      throw error;
    }
    context.observations.push(observed.observation);
    mergeSource(context.source, observed);
    if (observed.surface) {
      context.emit({ name: "surface", timestamp: context.now(), type: "CUSTOM", value: observed.surface });
    }
  }

  return "continue";
}

/** One deliberation, bracketed by the step events the interface renders. */
async function think(context: TurnContext, stepsRemaining: number) {
  context.emit({ stepName: "think", timestamp: context.now(), type: "STEP_STARTED" });
  try {
    return await deliberate({
      conversation: context.conversation,
      observations: context.observations,
      priorSearches: context.priorSearches,
      referenceDate: context.options.referenceDate,
      stepsRemaining
    });
  } finally {
    context.emit({ stepName: "think", timestamp: context.now(), type: "STEP_FINISHED" });
  }
}

/** Turns a non-tool plan into the turn's ending. */
function conclusionOf(context: TurnContext, plan: Exclude<PlannerStep, { kind: "tools" }>): TurnOutcome {
  if (plan.kind === "answer") {
    return {
      kind: "said",
      surface: composeAdviceSurface(nextSurfaceId(context), plan.message, plan.picks, context.source),
      text: plan.message
    };
  }
  return spoke(context, plan.message, plan.kind === "refuse" ? "caution" : "neutral");
}

/** An outcome that is just words, with the surface that carries them. */
function spoke(context: TurnContext, text: string, tone: Tone): TurnOutcome {
  return { kind: "said", surface: composeMessageSurface(nextSurfaceId(context), text, tone), text };
}

/** One complete assistant message plus its surface, streamed as the protocol expects. */
function say(context: TurnContext, text: string, surface: Surface) {
  const { emit, now, runId } = context;
  const messageId = `${runId}-m${++context.surfaceCount.messages}`;
  emit({ messageId, role: "assistant", timestamp: now(), type: "TEXT_MESSAGE_START" });
  emit({ delta: text, messageId, timestamp: now(), type: "TEXT_MESSAGE_CONTENT" });
  emit({ messageId, timestamp: now(), type: "TEXT_MESSAGE_END" });
  emit({ name: "surface", timestamp: now(), type: "CUSTOM", value: surface });
}

function nextSurfaceId(context: TurnContext) {
  return `${context.runId}-s${++context.surfaceCount.messages}`;
}

/**
 * One deliberation, with a single retry and a floor under it.
 *
 * The retry exists for one specific failure: a model that wrote a figure into
 * its prose that no tool produced. That answer is rejected rather than shown,
 * and asking again usually gets a clean one, because the instruction against it
 * is explicit. Retrying anything else would just spend a second request on the
 * same outcome.
 *
 * When the second attempt fails the same way, the turn does not. The tool
 * results already in the conversation are real and are the substance of the
 * answer; what was lost is the prose over them. Failing the whole run would
 * throw away good evidence over a bad sentence, and would show the user a
 * diagnostic written for a developer.
 */
async function deliberate(input: Parameters<typeof planNextStep>[0]): Promise<PlannerStep> {
  try {
    return await planNextStep(input);
  } catch (error) {
    if (!(error instanceof LlmError) || !RETRYABLE_PLANNER_CODES.has(error.code)) {
      throw error;
    }
    try {
      return await planNextStep(input);
    } catch (retryError) {
      if (retryError instanceof LlmError && RETRYABLE_PLANNER_CODES.has(retryError.code)) {
        /*
         * Two different failures, so two different sentences. Telling someone
         * the model "kept stating figures the sources do not show" when the
         * provider simply returned nothing describes a problem that did not
         * happen, and points them at the results as if those were in doubt.
         */
        return {
          kind: "ask",
          message: retryError.code === "planner_ungrounded_number"
            ? ungroundedAdvice(input.conversation, input.observations.length > 0)
            : partialWork(input.conversation, input.observations.length > 0)
        };
      }
      throw retryError;
    }
  }
}

/**
 * Failures worth asking again about, rather than ending a turn over.
 *
 * `planner_ungrounded_number` is the model writing a figure nothing supports —
 * usually not repeated, because the instruction against it is explicit.
 *
 * `llm_empty_response` is the provider returning a completion with no content
 * at all, on a healthy 200 with a normal finish reason. Observed live, once,
 * immediately after a tax-inclusive capture: the tab had opened, the user had
 * waited, the total had been stored, and the turn ended on a technical string
 * about JSON. A transient nothing from the provider should cost one more
 * request, not the work already paid for.
 */
const RETRYABLE_PLANNER_CODES = new Set(["planner_ungrounded_number", "llm_empty_response"]);

/*
 * Product-owned, and in the language being spoken. Every other fallback in the
 * loop follows the conversation's language; this one did not, so a Chinese
 * exchange ended in an English apology — which reads less like a limit being
 * explained and more like something broke.
 */
function ungroundedAdvice(conversation: readonly AgentConversationMessage[], hasResults: boolean) {
  const chinese = isChinese(conversation);
  if (!hasResults) {
    /*
     * Nothing ran, so there is nothing above to point at. The original wording
     * did anyway — a very long message produced "the results above are
     * accurate, read them directly" over an empty conversation, which is worse
     * than saying nothing: it sends the reader looking for something that is
     * not there.
     */
    return chinese
      ? "我没能给出一个自己信得过的答复。可以换个说法再问一次吗？说清城市、日期，以及你最看重什么。"
      : "I could not produce an answer I trust. Try asking again in different words — the city, the dates, and what matters most to you.";
  }
  return chinese
    ? "我没能写出一段自己信得过的总结——它反复给出上面材料里没有的数字。上面的结果本身是准确的，你可以直接看，或者挑其中一条问我，我逐条说明。"
    : "I could not put together a summary I trust — it kept stating figures the sources above do not show. " +
      "The results themselves are accurate; read them directly, or ask me about one of them and I will go through it.";
}

function isChinese(conversation: readonly AgentConversationMessage[]) {
  return /[\u3400-\u9fff]/.test(conversation.map((turn) => turn.content).join(""));
}

type ActedTool = {
  observation: ToolObservation;
  /** The untrimmed capability result. The model never sees this; the renderer does. */
  result: unknown;
  session: HotelSearchSessionSnapshot | null;
  surface: Surface | null;
};

/**
 * Runs one tool and reports it, including waiting out its browser tab.
 *
 * The event sequence is the AG-UI one the interface already reads: the call and
 * its parsed arguments are announced before anything runs, so what is about to
 * happen is visible before it happens.
 */
async function act(
  call: { args: unknown; capability: string },
  context: { emit: AgentEventSink; now: () => number; runId: string; signal?: AbortSignal; toolIndex: number }
): Promise<ActedTool> {
  const { emit, now } = context;
  const toolCallId = `${context.runId}-t${context.toolIndex}`;
  const capability = requireCapability(call.capability);

  emit({ timestamp: now(), toolCallId, toolCallName: capability.name, type: "TOOL_CALL_START" });
  const args = parseCapabilityArgs(capability.name, call.args);
  emit({ delta: JSON.stringify(args), timestamp: now(), toolCallId, type: "TOOL_CALL_ARGS" });
  emit({ timestamp: now(), toolCallId, type: "TOOL_CALL_END" });

  emit({ stepName: capability.name, timestamp: now(), type: "STEP_STARTED" });
  const { result } = await invokeCapability(capability.name, call.args, { confirmed: true });
  emit({ stepName: capability.name, timestamp: now(), type: "STEP_FINISHED" });

  if (capability.effect !== "browser_task") {
    emit({ content: JSON.stringify(result), timestamp: now(), toolCallId, type: "TOOL_CALL_RESULT" });
    return {
      observation: observeToolResult(capability.name, result),
      result,
      session: null,
      surface: composeCapabilitySurface(capability.name, result, `${context.runId}-s${context.toolIndex}`)
    };
  }

  /*
   * The tab the user agreed to. It is opened by the client, from inside the
   * press, because that is the only moment Chrome allows it — so the launch URL
   * goes out as an event and this waits for what comes back.
   */
  const launch = result as { launchUrl?: unknown; searchSessionId?: unknown; taskId?: unknown };
  const resultRoute = capabilityResultRoute(capability, args);
  emit({
    name: "browser_task_launch",
    timestamp: now(),
    type: "CUSTOM",
    value: {
      capability: capability.name,
      launchUrl: typeof launch.launchUrl === "string" ? launch.launchUrl : null,
      resultRoute
    }
  });

  if (typeof launch.taskId !== "string") {
    throw new LoopError("browser_task_unreadable", "The browser task was created but did not report an identifier.");
  }
  const finished = await awaitBrowserTask(launch.taskId, { signal: context.signal });
  emit({ content: JSON.stringify({ status: finished.status }), timestamp: now(), toolCallId, type: "TOOL_CALL_RESULT" });

  /*
   * No tab ever picked this up. Distinct from a failure, and the difference is
   * what the user can do: the task is still live, so opening the link finishes
   * the same run rather than starting a new one.
   */
  if (finished.status === "never_started") {
    throw new LoopError(
      "browser_task_never_started",
      "The Hyatt tab did not open, so there is nothing to read yet. Open it from the link above and I will pick up from there, or ask again and I will start over."
    );
  }

  if (finished.status === "failed") {
    throw new LoopError(
      "browser_task_failed",
      finished.errorMessage ?? "The Hyatt tab did not return usable evidence."
    );
  }

  /*
   * A search reads back as its session, so the model observes real offers rather
   * than the launch envelope, and the conversation renders the same results the
   * search page would.
   */
  if (typeof launch.searchSessionId === "string") {
    const session = await getHotelSearchSession(launch.searchSessionId);
    return {
      observation: observeToolResult(capability.name, { session }),
      result: { session },
      session,
      surface: session
        ? composeCapabilitySurface("get_hotel_search_session", { session }, `${context.runId}-s${context.toolIndex}`)
        : null
    };
  }

  return {
    observation: observeToolResult(capability.name, finished.result),
    result: finished.result,
    session: null,
    surface: composeCapabilitySurface(capability.name, finished.result, `${context.runId}-s${context.toolIndex}`)
  };
}

/**
 * Turns the refs the model can see into the identifiers the tools require.
 *
 * The model is shown `b1` and `h2`; it is never shown a booking id, because
 * `modelView` strips them. So when it wants to explain a verdict it has the row
 * but not the argument, and the only honest thing it can do is ask the user
 * which booking they meant — of the one booking it just listed. That was live
 * behaviour, and it reads as the product forgetting its own last sentence.
 *
 * Resolving here rather than widening the view keeps the property that made the
 * view worth having: the model can only name rows it was actually shown, so an
 * identifier it invents resolves to nothing instead of to someone's booking.
 */
function resolveRefs(args: unknown, refs: Readonly<Record<string, string>>): unknown {
  if (typeof args === "string") {
    return refs[args] ?? args;
  }
  if (Array.isArray(args)) {
    return args.map((item) => resolveRefs(item, refs));
  }
  if (args !== null && typeof args === "object") {
    return Object.fromEntries(Object.entries(args).map(([key, value]) => [key, resolveRefs(value, refs)]));
  }
  return args;
}

/** Accumulates what a later recommendation may point at. */
function mergeSource(source: AdviceSource, acted: ActedTool) {
  Object.assign(source.refs, acted.observation.refs);
  if (acted.session) {
    source.hotelSession = acted.session;
  }
  /* Held for `composeAdviceSurface`, which needs the full row a view omits. */
  const bookings = readBookings(acted.observation.capability, acted.result);
  if (bookings.length > 0) {
    source.bookings = [...source.bookings, ...bookings];
  }
}

function readBookings(capability: string, result: unknown): readonly BookingSummary[] {
  if (!result || typeof result !== "object") {
    return [];
  }
  if (capability === "list_bookings") {
    const { bookings } = result as { bookings?: readonly BookingSummary[] };
    return bookings ?? [];
  }
  if (capability === "get_booking") {
    const { booking } = result as { booking?: BookingSummary | null };
    return booking ? [booking] : [];
  }
  return [];
}

/**
 * The offline path.
 *
 * No API key means no loop: keyword routing picks one capability, and the
 * product's own copy answers. Less capable by design, and honest about it — the
 * alternative is an interface that appears conversational and silently is not.
 */
/**
 * The offline path.
 *
 * No API key means no loop: keyword routing picks one capability, and the
 * product's own copy answers. Less capable by design, and honest about it — the
 * alternative is an interface that appears conversational and silently is not.
 */
async function runOfflineTurn(context: TurnContext): Promise<TurnOutcome> {
  const { conversation } = context;
  const last = conversation.filter((turn) => turn.role === "user").at(-1)?.content ?? "";
  const decision = await routeIntent(last, {
    conversation: conversation.slice(0, -1),
    deterministicOnly: true,
    referenceDate: context.options.referenceDate
  });

  if (decision.kind !== "capability") {
    const text = decision.kind === "clarify" ? decision.question : decision.message;
    return spoke(context, text, decision.kind === "clarify" ? "neutral" : "caution");
  }

  const capability = requireCapability(decision.capability);
  const args = parseCapabilityArgs(capability.name, decision.args);
  if (needsPress(capability.name)) {
    context.emit({
      name: "surface",
      timestamp: context.now(),
      type: "CUSTOM",
      value: composeConfirmSurface(nextSurfaceId(context), {
        args,
        capability: capability.name,
        detail: describeCapabilityChange(capability.name, args) ?? confirmDetail(capability.name, args),
        label: confirmLabel(capability.name)
      })
    });
    return { kind: "awaiting_press" };
  }

  const acted = await act({ args: decision.args, capability: capability.name }, {
    emit: context.emit,
    now: context.now,
    runId: context.runId,
    signal: context.options.signal,
    toolIndex: 1
  });
  context.observations.push(acted.observation);
  mergeSource(context.source, acted);
  if (acted.surface) {
    context.emit({ name: "surface", timestamp: context.now(), type: "CUSTOM", value: acted.surface });
  }
  /* Nothing more to say: the surface is the answer on this path. */
  return { kind: "awaiting_press" };
}

/** Product-owned, in the language being spoken. Names what survived, not what broke. */
function partialWork(conversation: readonly AgentConversationMessage[], hasResults: boolean) {
  const chinese = isChinese(conversation);
  if (!hasResults) {
    return chinese
      ? "这次没能完成。可以再说一次你想做什么吗？"
      : "That did not go through. Tell me again what you were after and I will try once more.";
  }
  return chinese
    ? "上面的结果是真的、已经存下来了，但我没能接着往下说。你可以直接看，或者告诉我接下来要做什么——不用重新查一遍。"
    : "The results above are real and saved, but I could not carry on from them. Read them directly, or tell me what to do next — there is no need to run any of it again.";
}

const OUT_OF_STEPS =
  "I gathered what I could but could not finish this in one turn. Tell me which part matters most and I will go deeper on it.";




/*
 * Product-owned copy on the control itself. What a button does is the product's
 * statement, not the model's — a model-written label is how a press means
 * something other than what it said.
 */
function confirmLabel(capability: string) {
  switch (capability) {
    case "search_hotels":
      return "Open Hyatt and collect prices";
    case "get_tax_inclusive_total":
      return "Open Hyatt and get the final total";
    case "set_watch_plan":
      return "Save this watch setting";
    case "run_price_check":
      return "Open Hyatt and check this price";
    case "import_account_bookings":
      return "Open Hyatt and import my stays";
    default:
      return "Open the Hyatt tab";
  }
}

function confirmDetail(capability: string, args: unknown) {
  const bag = (args ?? {}) as Record<string, unknown>;
  if (capability === "search_hotels") {
    const where = typeof bag.cityAsAsked === "string" ? bag.cityAsAsked : String(bag.city ?? "");
    /*
     * The mode is named because it is often the only thing that distinguishes
     * this search from one already done. Asked for award rates after a cash
     * search, the card read identically to the cash one — same city, same
     * dates — and gave the user no way to tell what they were pressing for.
     */
    const mode = bag.priceMode === "points" ? "award (points) rates" : "cash rates";
    return `Hyatt ${mode} in ${where}, ${String(bag.checkIn)} to ${String(bag.checkOut)}. A visible tab opens; nothing is booked.`;
  }
  if (capability === "get_tax_inclusive_total") {
    return `A verified tax-inclusive total for ${String(bag.hotelName ?? "this hotel")} — the only figure that can settle a budget. A visible tab opens; nothing is booked.`;
  }
  if (capability === "import_account_bookings") {
    return "Reads the stays already booked in your signed-in Hyatt account. A visible tab opens; nothing is booked.";
  }
  return "A visible Hyatt tab opens and collects price evidence. Nothing is booked, cancelled, or paid.";
}

function userWording(conversation: readonly AgentConversationMessage[]) {
  return conversation
    .filter((turn) => turn.role === "user")
    .map((turn) => turn.content)
    .join("\n");
}

class LoopError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LoopError";
  }
}

/**
 * Capability, registry, planner, and browser-task errors all carry a `code`.
 * Passing it through unchanged is what lets a client tell one failure from
 * another rather than string-matching a message.
 */
function errorCode(error: unknown) {
  if (error instanceof BrowserTaskWaitError) {
    return error.code;
  }
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return "capability_failed";
}
