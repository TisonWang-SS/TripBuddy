/*
 * AG-UI event vocabulary.
 *
 * The wire shape follows the AG-UI protocol — SCREAMING_SNAKE discriminators,
 * one JSON object per Server-Sent Event — but the types are declared here rather
 * than taken from a package. The protocol is a stable idea with a moving
 * implementation, and this repo keeps its dependency surface small; aligning to
 * the wire shape makes a later swap mechanical.
 *
 * The union is the full vocabulary. The emitter in run.ts uses a subset: text
 * message events exist for the intent router in P3, which is the first thing
 * with prose to stream.
 */

export type AgentEvent =
  /* Lifecycle */
  | { runId: string; timestamp: number; type: "RUN_STARTED" }
  | { runId: string; timestamp: number; type: "RUN_FINISHED" }
  | { code: string; message: string; runId: string; timestamp: number; type: "RUN_ERROR" }
  | { stepName: string; timestamp: number; type: "STEP_STARTED" }
  | { stepName: string; timestamp: number; type: "STEP_FINISHED" }
  /* Assistant prose. Unused until the router exists. */
  | { messageId: string; role: "assistant"; timestamp: number; type: "TEXT_MESSAGE_START" }
  | { delta: string; messageId: string; timestamp: number; type: "TEXT_MESSAGE_CONTENT" }
  | { messageId: string; timestamp: number; type: "TEXT_MESSAGE_END" }
  /* Capability invocation. A capability is this product's tool call. */
  | { timestamp: number; toolCallId: string; toolCallName: string; type: "TOOL_CALL_START" }
  | { delta: string; timestamp: number; toolCallId: string; type: "TOOL_CALL_ARGS" }
  | { timestamp: number; toolCallId: string; type: "TOOL_CALL_END" }
  | { content: string; timestamp: number; toolCallId: string; type: "TOOL_CALL_RESULT" }
  /* Shared state, for browser-task progress. */
  | { snapshot: unknown; timestamp: number; type: "STATE_SNAPSHOT" }
  | { delta: unknown; timestamp: number; type: "STATE_DELTA" }
  /* Application-specific signals that have no protocol event of their own. */
  | { name: string; timestamp: number; type: "CUSTOM"; value: unknown };

export type AgentEventType = AgentEvent["type"];

/**
 * One SSE frame. The trailing blank line terminates the event, and every payload
 * is single-line JSON so a stray newline in a message can never split a frame.
 */
export function encodeAgentEvent(event: AgentEvent) {
  return `data: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parses one SSE `data:` payload back into an event.
 *
 * Returns null rather than throwing on anything unrecognised: a stream is read
 * by a live interface, and one malformed frame should be dropped rather than
 * tearing down a run that is otherwise fine. Follows the same
 * validate-then-accept shape as the other codecs in this codebase.
 */
export function parseAgentEvent(raw: string): AgentEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const candidate = value as { timestamp?: unknown; type?: unknown };
  if (typeof candidate.type !== "string" || !isAgentEventType(candidate.type)) {
    return null;
  }
  if (typeof candidate.timestamp !== "number") {
    return null;
  }
  return value as AgentEvent;
}

const EVENT_TYPES: readonly AgentEventType[] = [
  "RUN_STARTED",
  "RUN_FINISHED",
  "RUN_ERROR",
  "STEP_STARTED",
  "STEP_FINISHED",
  "TEXT_MESSAGE_START",
  "TEXT_MESSAGE_CONTENT",
  "TEXT_MESSAGE_END",
  "TOOL_CALL_START",
  "TOOL_CALL_ARGS",
  "TOOL_CALL_END",
  "TOOL_CALL_RESULT",
  "STATE_SNAPSHOT",
  "STATE_DELTA",
  "CUSTOM"
];

function isAgentEventType(value: string): value is AgentEventType {
  return (EVENT_TYPES as readonly string[]).includes(value);
}

/** Splits a raw SSE chunk into its `data:` payloads. Frames end on a blank line. */
export function readAgentEventFrames(chunk: string) {
  return chunk
    .split("\n\n")
    .map((frame) => frame.trim())
    .filter((frame) => frame.startsWith("data:"))
    .map((frame) => frame.slice("data:".length).trim());
}
