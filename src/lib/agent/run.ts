import type { AgentEvent } from "@/lib/agent/events";
import { capabilityResultRoute, invokeCapability, parseCapabilityArgs, requireCapability } from "@/lib/agent/registry";
import { type RouteDecision, routeIntent } from "@/lib/agent/router";
import { composeCapabilitySurface, composeMessageSurface } from "@/lib/agent/surface";
import type { AgentConversationMessage } from "@/lib/agent/types";

export type AgentRunRequest = {
  args?: unknown;
  /** Set when the caller already knows the capability, such as a pressed button. */
  capability?: string;
  /**
   * Set only after the user has explicitly agreed to an action that opens a
   * browser tab. The client learns it is needed from a RUN_ERROR carrying
   * `confirmation_required`, and re-sends the same request with this set.
   */
  confirmed?: boolean;
  /** A person's words, to be routed. Ignored when `capability` is given. */
  message?: string;
  /** Earlier turns, retained when the router asks the user for missing details. */
  conversation?: readonly AgentConversationMessage[];
};

export type AgentEventSink = (event: AgentEvent) => void;

type RunOptions = {
  /** Injected so tests assert on an exact event sequence. */
  now?: () => number;
  /** Optional calendar anchor for deterministic date-rewrite tests. */
  referenceDate?: Date;
  runId?: string;
};

/**
 * Runs one agent request and reports it as an AG-UI event sequence.
 *
 * Deliberately transport-free: the HTTP route turns these events into SSE
 * frames, and nothing here knows that.
 *
 * A request either names a capability — a pressed button — or carries a
 * sentence to route. Routing is a step in the same run, so the interface can
 * show what was understood before anything executes.
 */
export async function runAgentRequest(request: AgentRunRequest, emit: AgentEventSink, options: RunOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const runId = options.runId ?? globalThis.crypto.randomUUID();
  const toolCallId = `${runId}-1`;

  emit({ runId, timestamp: now(), type: "RUN_STARTED" });

  try {
    const resolved = await resolveRequest(request, emit, now, options.referenceDate);
    if (resolved.kind !== "capability") {
      /*
       * The run ends in words rather than a call. The words are product-owned:
       * a refusal sentence or the capability parser's own message. The model
       * never writes what the user reads.
       */
      const text = resolved.kind === "clarify" ? resolved.question : resolved.message;
      say(emit, now, runId, text);
      emit({
        name: "surface",
        timestamp: now(),
        type: "CUSTOM",
        value: composeMessageSurface(runId, text, resolved.kind === "clarify" ? "neutral" : "caution")
      });
      emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
      return;
    }

    const capability = requireCapability(resolved.capability);
    emit({ timestamp: now(), toolCallId, toolCallName: capability.name, type: "TOOL_CALL_START" });

    /* Announce the arguments the run will actually use, not the raw request. */
    const args = parseCapabilityArgs(capability.name, resolved.args);
    emit({ delta: JSON.stringify(args), timestamp: now(), toolCallId, type: "TOOL_CALL_ARGS" });
    emit({ timestamp: now(), toolCallId, type: "TOOL_CALL_END" });

    emit({ stepName: capability.name, timestamp: now(), type: "STEP_STARTED" });
    const { result } = await invokeCapability(capability.name, resolved.args, { confirmed: request.confirmed });
    emit({ stepName: capability.name, timestamp: now(), type: "STEP_FINISHED" });

    emit({ content: JSON.stringify(result), timestamp: now(), toolCallId, type: "TOOL_CALL_RESULT" });

    /*
     * A browser task's progress and result render on the route that owns it,
     * which the client cannot derive from the result alone.
     */
    const resultRoute = capabilityResultRoute(capability, args);

    /*
     * The rendered form of the result, composed here from the same deterministic
     * data. A capability with no surface yet emits none, so a caller can fall
     * through to its own presentation rather than this inventing one.
     */
    const surface = composeCapabilitySurface(capability.name, result, runId, resultRoute);
    if (surface) {
      emit({ name: "surface", timestamp: now(), type: "CUSTOM", value: surface });
    }

    if (resultRoute) {
      emit({
        name: "browser_task_launch",
        timestamp: now(),
        type: "CUSTOM",
        value: { capability: capability.name, resultRoute }
      });
    }

    emit({ runId, timestamp: now(), type: "RUN_FINISHED" });
  } catch (error) {
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

type ResolvedRequest = { args: unknown; capability: string; kind: "capability" } | Exclude<RouteDecision, { kind: "capability" }>;

async function resolveRequest(
  request: AgentRunRequest,
  emit: AgentEventSink,
  now: () => number,
  referenceDate?: Date
): Promise<ResolvedRequest> {
  if (typeof request.capability === "string" && request.capability.trim().length > 0) {
    return { args: request.args, capability: request.capability.trim(), kind: "capability" };
  }

  emit({ stepName: "route", timestamp: now(), type: "STEP_STARTED" });
  const decision = await routeIntent(request.message ?? "", {
    conversation: request.conversation,
    referenceDate
  });
  emit({ stepName: "route", timestamp: now(), type: "STEP_FINISHED" });

  return decision.kind === "capability"
    ? { args: decision.args, capability: decision.capability, kind: "capability" }
    : decision;
}

/** One complete assistant message, streamed as the protocol expects. */
function say(emit: AgentEventSink, now: () => number, runId: string, text: string) {
  const messageId = `${runId}-m1`;
  emit({ messageId, role: "assistant", timestamp: now(), type: "TEXT_MESSAGE_START" });
  emit({ delta: text, messageId, timestamp: now(), type: "TEXT_MESSAGE_CONTENT" });
  emit({ messageId, timestamp: now(), type: "TEXT_MESSAGE_END" });
}

/**
 * Capability, registry, router, and browser-task errors all carry a `code`.
 * Passing it through unchanged is what lets a client tell "you must confirm
 * this" apart from "that failed", rather than string-matching a message.
 */
function errorCode(error: unknown) {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "string" && code.length > 0) {
      return code;
    }
  }
  return "capability_failed";
}
