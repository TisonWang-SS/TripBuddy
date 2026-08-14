import { type AgentEvent, parseAgentEvent, readAgentEventFrames } from "@/lib/agent/events";
import type { AgentTurnRequest } from "@/lib/agent/loop";

/*
 * Browser-side reader for the agent event stream.
 *
 * One turn of the conversation is one call here, and it stays open for as long
 * as the turn takes — including while the server waits on a Hyatt tab.
 */

export type AgentStreamOptions = {
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export async function streamAgentRun(
  request: AgentTurnRequest,
  onEvent: (event: AgentEvent) => void,
  options: AgentStreamOptions = {}
) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl("/api/agent", {
    body: JSON.stringify(request),
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: options.signal
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `The agent request failed with ${response.status}.`);
  }
  if (!response.body) {
    throw new Error("The agent response carried no stream.");
  }

  await readEventStream(response.body, onEvent);
}

/**
 * Reads an SSE body into events.
 *
 * A frame ends on a blank line, and a chunk boundary can fall anywhere — even
 * mid-token. Everything after the last frame terminator is held back until the
 * rest of it arrives, so one event is never read as two broken ones.
 */
export async function readEventStream(body: ReadableStream<Uint8Array>, onEvent: (event: AgentEvent) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const lastBreak = buffer.lastIndexOf("\n\n");
    if (lastBreak === -1) {
      continue;
    }
    const complete = buffer.slice(0, lastBreak + 2);
    buffer = buffer.slice(lastBreak + 2);
    emitFrames(complete, onEvent);
  }

  buffer += decoder.decode();
  emitFrames(buffer, onEvent);
}

function emitFrames(chunk: string, onEvent: (event: AgentEvent) => void) {
  for (const frame of readAgentEventFrames(chunk)) {
    const event = parseAgentEvent(frame);
    if (event) {
      onEvent(event);
    }
  }
}
