/*
 * The agent loop.
 *
 * One turn of the conversation is: deliberate, act, observe, repeat — until the
 * model has enough to advise, needs something only the user can supply, or runs
 * out of steps. This replaces the single-shot router as the primary path (ADR
 * 0005). The router survives as the offline path, because a local-first product
 * has to stay usable with no API key, and keyword routing is what it had before.
 *
 * Three properties are worth stating because they are enforced here rather than
 * hoped for:
 *
 * - **A tab needs a press.** Every capability that opens Hyatt suspends the turn
 *   and asks. The loop is autonomous about reading and reasoning, never about
 *   opening a browser on someone's behalf. PRD "Booking Price Checks" requires
 *   it, and the loop is the place a well-meaning plan would otherwise route
 *   around it.
 *
 * - **The run outlives the tab.** After a browser task starts, the loop waits on
 *   the server for the Companion's evidence, then feeds it back to the model.
 *   That is what puts a search result in the conversation rather than on a page
 *   the user has to go find.
 *
 * - **Steps are bounded.** A model that keeps proposing tools is stopped and
 *   made to answer from what it already has.
 */

import { CapabilityArgsError } from "@/lib/agent/args";
import { refusedAction, UNSUPPORTED_MESSAGE } from "@/lib/agent/boundaries";
import { awaitBrowserTask, BrowserTaskWaitError } from "@/lib/agent/browserTaskWait";
import type { BookingSummary } from "@/lib/agent/capabilities/bookings";
import type { AgentEvent } from "@/lib/agent/events";
import { observeToolResult, type ToolObservation } from "@/lib/agent/modelView";
import { loadPriorSearches } from "@/lib/agent/priorWork";
import { isPlannerConfigured, planNextStep, type PlannerStep } from "@/lib/agent/planner";
import {
  capabilityResultRoute,
  describeCapabilityChange,
  invokeCapability,
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
import type { AgentConversationMessage } from "@/lib/agent/types";
import { getHotelSearchSession, type HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import { LlmError } from "@/lib/providers/llmClient";

/** Enough for search → read a booking → compare → advise, and no more. */
const MAX_TOOL_STEPS = 6;

export type AgentTurnRequest = {
  /** The exchange so far, oldest first, not including `message`. */
  conversation?: readonly AgentConversationMessage[];
  /** Set when the user pressed the button on a ConfirmAction card. */
  confirm?: { args: unknown; capability: string };
  /** What the user just said. Absent on a confirmation press. */
  message?: string;
  /**
   * Searches earlier turns of this conversation produced.
   *
   * Held by the client because the server keeps no conversation of its own. The
   * ids are re-read here rather than trusted as descriptions, so an expired one
   * simply drops out and a session that has since gained a total is described as
   * it now is.
   */
  searchSessionIds?: readonly string[];
};

export type AgentEventSink = (event: AgentEvent) => void;

export type TurnOptions = {
  now?: () => number;
  referenceDate?: Date;
  runId?: string;
  signal?: AbortSignal;
};

export async function runAgentTurn(request: AgentTurnRequest, emit: AgentEventSink, options: TurnOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const runId = options.runId ?? globalThis.crypto.randomUUID();
  let messageCount = 0;
  let toolCount = 0;
  /*
   * Hoisted out of the try so a failure can see what the turn already achieved.
   * A tab that opened, a wait the user sat through, and a total now stored are
   * not undone by the next step going wrong.
   */
  const observations: ToolObservation[] = [];

  emit({ runId, timestamp: now(), type: "RUN_STARTED" });

  const conversation: AgentConversationMessage[] = [
    ...(request.conversation ?? []).filter((turn) => typeof turn.content === "string" && turn.content.trim().length > 0),
    ...(request.message && request.message.trim().length > 0
      ? [{ content: request.message.trim(), role: "user" as const }]
      : [])
  ];

  /** One assistant message, streamed as the protocol expects, plus its surface. */
  const respond = (text: string, surface: Surface) => {
    const messageId = `${runId}-m${++messageCount}`;
    emit({ messageId, role: "assistant", timestamp: now(), type: "TEXT_MESSAGE_START" });
    emit({ delta: text, messageId, timestamp: now(), type: "TEXT_MESSAGE_CONTENT" });
    emit({ messageId, timestamp: now(), type: "TEXT_MESSAGE_END" });
    emit({ name: "surface", timestamp: now(), type: "CUSTOM", value: surface });
  };

  try {
    if (conversation.length === 0 && !request.confirm) {
      throw new LoopError("empty_request", "Say what you would like to do.");
    }

    /*
     * Checked before the model runs, so the refusal cannot be planned around.
     * A confirmation press carries no new wording, so there is nothing to check.
     */
    const refusal = refusedAction(userWording(conversation).toLowerCase());
    if (refusal) {
      /*
       * Paired with the scope sentence, because this refusal fires on the verb
       * alone and cannot tell what was being asked for. "Book me a flight" trips
       * it and would otherwise be answered only with what the product does not do
       * to a reservation — true, but silent on the flight. Saying both keeps the
       * check deterministic and in front of the model, while still answering.
       */
      const text = `${refusal}\n\n${UNSUPPORTED_MESSAGE}`;
      respond(text, composeMessageSurface(`${runId}-s0`, text, "caution"));
      emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
      return;
    }

    if (!isPlannerConfigured()) {
      await runOfflineTurn(conversation, { emit, now, options, respond, runId });
      emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
      return;
    }

    /*
     * What this conversation already paid for. Told to the model as summaries,
     * so a follow-up about a search it just ran reaches `set_search_budget` or
     * `get_hotel_search_session` instead of opening Hyatt a second time.
     */
    const priorSearches = await loadPriorSearches(request.searchSessionIds, now);

    const source: AdviceSource = { bookings: [], hotelSession: null, refs: {} };
    /*
     * One press authorises one call. Held as a value that is spent rather than a
     * predicate over the request: a predicate stays true, so a plan that proposed
     * the same capability again later would open a second tab on the strength of
     * a press the user made for the first one.
     */
    let pending = request.confirm;
    let authorised: { args: unknown; capability: string } | null = request.confirm ?? null;

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      let plan: PlannerStep;
      if (pending) {
        /*
         * The press already decided this call. Re-planning here would let a
         * second deliberation substitute a different action for the one the user
         * actually agreed to.
         */
        plan = { calls: [{ args: pending.args, capability: pending.capability }], kind: "tools", message: "" };
        pending = undefined;
      } else {
        emit({ stepName: "think", timestamp: now(), type: "STEP_STARTED" });
        plan = await deliberate({
          conversation,
          observations,
          priorSearches,
          referenceDate: options.referenceDate,
          stepsRemaining: MAX_TOOL_STEPS - step
        });
        emit({ stepName: "think", timestamp: now(), type: "STEP_FINISHED" });
      }

      if (plan.kind !== "tools") {
        concludeWith(plan);
        emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
        return;
      }

      /*
       * What the model wants to say before the work happens. It matters most
       * right here: the next thing the user may see is a button that costs them
       * a press and a wait, and a request the product can only partly serve —
       * a hotel group it does not collect, a second city it had to drop — has
       * to say so while declining is still free.
       *
       * Said once, and only once the work is known to be runnable. Announcing it
       * up front produced "I will search Shanghai under your ¥1000 budget"
       * immediately followed by a precheck refusing that very search.
       */
      const note = plan.message ?? "";
      let noteSpoken = note.length === 0;
      const speakNote = () => {
        if (!noteSpoken) {
          noteSpoken = true;
          respond(note, composeMessageSurface(`${runId}-s${++messageCount}`, note, "neutral"));
        }
      };

      /* Set when a call failed in a way the model is expected to correct. */
      let retry = false;

      for (const proposed of plan.calls) {
        /* The model names rows; the tools take identifiers. See `resolveRefs`. */
        const call = { args: resolveRefs(proposed.args, source.refs), capability: proposed.capability };

        /*
         * A tab is never opened by a plan alone. The turn stops here and the
         * conversation carries the question; the next request arrives with
         * `confirm` set and resumes at the top of this loop.
         */
        if (needsPress(call.capability) && !spendAuthorisation(call.capability)) {
          const args = parseCapabilityArgs(call.capability, call.args);
          /*
           * Asked before the press, not after it. A capability that cannot run
           * as asked should say so while the user still has a choice to make —
           * not once they have agreed and a blank tab is already open.
           */
          const blocker = await precheckCapability(call.capability, args);
          if (typeof blocker === "string") {
            /* Only the user can resolve this one; the wording is product-owned. */
            respond(blocker, composeMessageSurface(`${runId}-s${++messageCount}`, blocker, "caution"));
            emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
            return;
          }
          if (blocker) {
            /*
             * The model can fix this itself — a stale row reference, usually.
             * Handed back as an observation, it corrects course inside the same
             * turn; ended here instead, a recoverable mistake becomes a wall.
             */
            observations.push({ capability: call.capability, refs: {}, view: { error: blocker.retryable } });
            retry = true;
            break;
          }
          speakNote();
          emit({
            name: "surface",
            timestamp: now(),
            type: "CUSTOM",
            value: composeConfirmSurface(`${runId}-s${++messageCount}`, {
              args,
              capability: call.capability,
              detail: describeCapabilityChange(call.capability, args) ?? confirmDetail(call.capability, args),
              label: confirmLabel(call.capability)
            })
          });
          emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
          return;
        }

        let observed: ActedTool;
        try {
          observed = await act(call, { emit, now, runId, signal: options.signal, toolIndex: ++toolCount });
        } catch (error) {
          /*
           * A capability refusing its own arguments is a question, not a failed
           * run: it knows something the planner could not — an expired session,
           * a budget in a currency the results are not priced in — and it wrote
           * a sentence saying what to do about it.
           */
          if (error instanceof CapabilityArgsError) {
            respond(error.message, composeMessageSurface(`${runId}-s${++messageCount}`, error.message, "caution"));
            emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
            return;
          }
          throw error;
        }
        observations.push(observed.observation);
        mergeSource(source, observed);
        if (observed.surface) {
          emit({ name: "surface", timestamp: now(), type: "CUSTOM", value: observed.surface });
        }
      }

      if (retry) {
        continue;
      }
    }

    /*
     * Out of steps with tools still being proposed. Asking for a conclusion from
     * what was already collected is better than both alternatives: silence, or
     * another round that the budget cannot pay for anyway.
     */
    emit({ stepName: "think", timestamp: now(), type: "STEP_STARTED" });
    const final = await deliberate({
      conversation,
      observations,
      priorSearches,
      referenceDate: options.referenceDate,
      stepsRemaining: 0
    });
    emit({ stepName: "think", timestamp: now(), type: "STEP_FINISHED" });
    concludeWith(final.kind === "tools" ? { kind: "ask", message: OUT_OF_STEPS } : final);
    emit({ runId, timestamp: now(), type: "RUN_FINISHED" });

    /** Consumes the press, if it was for this capability. Never grants twice. */
    function spendAuthorisation(capability: string) {
      if (authorised?.capability !== capability) {
        return false;
      }
      authorised = null;
      return true;
    }

    function concludeWith(plan: Exclude<PlannerStep, { kind: "tools" }>) {
      if (plan.kind === "answer") {
        respond(plan.message, composeAdviceSurface(`${runId}-s${++messageCount}`, plan.message, plan.picks, source));
        return;
      }
      respond(
        plan.message,
        composeMessageSurface(`${runId}-s${++messageCount}`, plan.message, plan.kind === "refuse" ? "caution" : "neutral")
      );
    }
  } catch (error) {
    /*
     * A turn that already collected something does not fail outright.
     *
     * Live: a tax-inclusive total was captured — the tab opened, the user
     * waited, the figure was stored and its card already rendered — and then the
     * provider returned an empty completion. The turn ended on a technical
     * string about JSON, saying nothing about the price that had just been
     * fetched, and the next question had to start over. The cards are real
     * whatever happened afterwards, so say so and let the user carry on.
     */
    if (observations.length > 0) {
      const text = partialWork(conversation);
      respond(text, composeMessageSurface(`${runId}-s${++messageCount}`, text, "caution"));
      emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
      return;
    }

    /* RUN_ERROR terminates the run; RUN_FINISHED must not follow it. */
    emit({
      code: errorCode(error),
      message: error instanceof Error ? error.message : "The request could not be run.",
      runId,
      timestamp: now(),
      type: "RUN_ERROR"
    });
  }
}

/** Product-owned, in the language being spoken. Names what survived, not what broke. */
function partialWork(conversation: readonly AgentConversationMessage[]) {
  const chinese = /[\u3400-\u9fff]/.test(conversation.map((turn) => turn.content).join(""));
  return chinese
    ? "上面的结果是真的、已经存下来了，但我没能接着往下说。你可以直接看，或者告诉我接下来要做什么——不用重新查一遍。"
    : "The results above are real and saved, but I could not carry on from them. Read them directly, or tell me what to do next — there is no need to run any of it again.";
}

const OUT_OF_STEPS =
  "I gathered what I could but could not finish this in one turn. Tell me which part matters most and I will go deeper on it.";

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
            ? ungroundedAdvice(input.conversation)
            : partialWork(input.conversation)
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
function ungroundedAdvice(conversation: readonly AgentConversationMessage[]) {
  const chinese = /[\u3400-\u9fff]/.test(conversation.map((turn) => turn.content).join(""));
  return chinese
    ? "我没能写出一段自己信得过的总结——它反复给出上面材料里没有的数字。上面的结果本身是准确的，你可以直接看，或者挑其中一条问我，我逐条说明。"
    : "I could not put together a summary I trust — it kept stating figures the sources above do not show. " +
      "The results themselves are accurate; read them directly, or ask me about one of them and I will go through it.";
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
async function runOfflineTurn(
  conversation: readonly AgentConversationMessage[],
  context: {
    emit: AgentEventSink;
    now: () => number;
    options: TurnOptions;
    respond: (text: string, surface: Surface) => void;
    runId: string;
  }
) {
  const { emit, now, respond, runId } = context;
  const last = conversation.filter((turn) => turn.role === "user").at(-1)?.content ?? "";
  const decision = await routeIntent(last, {
    conversation: conversation.slice(0, -1),
    deterministicOnly: true,
    referenceDate: context.options.referenceDate
  });

  if (decision.kind !== "capability") {
    const text = decision.kind === "clarify" ? decision.question : decision.message;
    respond(text, composeMessageSurface(`${runId}-s1`, text, decision.kind === "clarify" ? "neutral" : "caution"));
    return;
  }

  const capability = requireCapability(decision.capability);
  const args = parseCapabilityArgs(capability.name, decision.args);
  if (capability.effect === "browser_task") {
    emit({
      name: "surface",
      timestamp: now(),
      type: "CUSTOM",
      value: composeConfirmSurface(`${runId}-s1`, {
        args,
        capability: capability.name,
        detail: confirmDetail(capability.name, args),
        label: confirmLabel(capability.name)
      })
    });
    return;
  }

  const acted = await act({ args: decision.args, capability: capability.name }, {
    emit,
    now,
    runId,
    signal: context.options.signal,
    toolIndex: 1
  });
  if (acted.surface) {
    emit({ name: "surface", timestamp: now(), type: "CUSTOM", value: acted.surface });
  }
}



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
