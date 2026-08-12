import { describe, expect, it, vi } from "vitest";
import { type AgentEvent, encodeAgentEvent } from "./events";
import { streamAgentRun } from "./client";

function streamOf(chunks: readonly string[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

function respondWith(chunks: readonly string[]) {
  return vi.fn().mockResolvedValue(
    new Response(streamOf(chunks), { headers: { "Content-Type": "text/event-stream" }, status: 200 })
  );
}

const started: AgentEvent = { runId: "run-1", timestamp: 1, type: "RUN_STARTED" };
const finished: AgentEvent = { runId: "run-1", timestamp: 2, type: "RUN_FINISHED" };

async function collect(fetchImpl: typeof fetch) {
  const events: AgentEvent[] = [];
  await streamAgentRun({ capability: "list_bookings" }, (event) => events.push(event), { fetchImpl });
  return events;
}

describe("agent stream client", () => {
  it("reads a run posted as one chunk", async () => {
    const events = await collect(respondWith([encodeAgentEvent(started) + encodeAgentEvent(finished)]) as unknown as typeof fetch);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  /*
   * A chunk boundary can fall anywhere, including mid-token. Holding back the
   * tail until its terminator arrives is what keeps one event from being read
   * as two broken ones.
   */
  it("reassembles an event split across chunks", async () => {
    const whole = encodeAgentEvent(started) + encodeAgentEvent(finished);
    const cut = Math.floor(whole.length / 2);
    const events = await collect(respondWith([whole.slice(0, cut), whole.slice(cut)]) as unknown as typeof fetch);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  it("reads a final event that arrives without a trailing blank line", async () => {
    const events = await collect(respondWith([`data: ${JSON.stringify(started)}`]) as unknown as typeof fetch);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED"]);
  });

  it("drops a malformed frame without losing the rest of the run", async () => {
    const events = await collect(
      respondWith([`data: {not json}\n\n${encodeAgentEvent(finished)}`]) as unknown as typeof fetch
    );
    expect(events.map((event) => event.type)).toEqual(["RUN_FINISHED"]);
  });

  it("posts the request to the agent route", async () => {
    const fetchImpl = respondWith([encodeAgentEvent(started)]);
    await streamAgentRun({ message: "show my stays" }, () => {}, { fetchImpl: fetchImpl as unknown as typeof fetch });

    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("/api/agent");
    expect(JSON.parse(String(init.body))).toEqual({ message: "show my stays" });
    expect(init.method).toBe("POST");
  });

  it("raises the route's own error for a rejected request", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Provide either a capability or a message." }), {
        headers: { "Content-Type": "application/json" },
        status: 400
      })
    );
    await expect(streamAgentRun({}, () => {}, { fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(
      "Provide either a capability or a message."
    );
  });
});
