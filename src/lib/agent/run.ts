import type { AgentEvent } from "@/lib/agent/events";
import { capabilityResultRoute, invokeCapability, parseCapabilityArgs, requireCapability } from "@/lib/agent/registry";

export type AgentRunRequest = {
  args?: unknown;
  capability: string;
  /**
   * Set only after the user has explicitly agreed to an action that opens a
   * browser tab. The client learns it is needed from a RUN_ERROR carrying
   * `confirmation_required`, and re-sends the same request with this set.
   */
  confirmed?: boolean;
};

export type AgentEventSink = (event: AgentEvent) => void;

type RunOptions = {
  /** Injected so tests assert on an exact event sequence. */
  now?: () => number;
  runId?: string;
};

/**
 * Runs one capability and reports it as an AG-UI event sequence.
 *
 * Deliberately transport-free: the HTTP route turns these events into SSE
 * frames, and nothing here knows that. In P3 the router picks the capability
 * name before this runs; the sequence below does not change.
 */
export async function runCapability(request: AgentRunRequest, emit: AgentEventSink, options: RunOptions = {}) {
  const now = options.now ?? (() => Date.now());
  const runId = options.runId ?? cryptoRandomId();
  const toolCallId = `${runId}-1`;

  emit({ runId, timestamp: now(), type: "RUN_STARTED" });

  try {
    const capability = requireCapability(request.capability);
    emit({ timestamp: now(), toolCallId, toolCallName: capability.name, type: "TOOL_CALL_START" });

    /* Announce the arguments the run will actually use, not the raw request. */
    const args = parseCapabilityArgs(capability.name, request.args);
    emit({ delta: JSON.stringify(args), timestamp: now(), toolCallId, type: "TOOL_CALL_ARGS" });
    emit({ timestamp: now(), toolCallId, type: "TOOL_CALL_END" });

    emit({ stepName: capability.name, timestamp: now(), type: "STEP_STARTED" });
    const { result } = await invokeCapability(capability.name, request.args, { confirmed: request.confirmed });
    emit({ stepName: capability.name, timestamp: now(), type: "STEP_FINISHED" });

    emit({ content: JSON.stringify(result), timestamp: now(), toolCallId, type: "TOOL_CALL_RESULT" });

    /*
     * A browser task's result renders on the route that owns it, which the
     * client cannot derive from the result alone.
     */
    const resultRoute = capabilityResultRoute(capability, args);
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
      message: error instanceof Error ? error.message : "The capability could not be run.",
      runId,
      timestamp: now(),
      type: "RUN_ERROR"
    });
  }
}

/**
 * Capability, registry, and browser-task errors all carry a `code`. Passing it
 * through unchanged is what lets a client tell "you must confirm this" apart
 * from "that failed", rather than string-matching a message.
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

function cryptoRandomId() {
  return globalThis.crypto.randomUUID();
}
