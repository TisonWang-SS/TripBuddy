import { type AgentEvent, encodeAgentEvent } from "@/lib/agent/events";
import { type AgentRunRequest, runAgentRequest } from "@/lib/agent/run";
import { browserJson, sameOriginRequestError } from "@/lib/browserApi";

export const dynamic = "force-dynamic";

/**
 * The agent event stream — the only HTTP surface the agent layer adds.
 *
 * Transport problems answer with a status code; anything that goes wrong inside
 * a run is reported as a RUN_ERROR event on an otherwise healthy 200 stream, so
 * a client has one place to read outcomes rather than two.
 */
export async function POST(request: Request) {
  const accessError = sameOriginRequestError(request);
  if (accessError) {
    return accessError;
  }

  let payload: AgentRunRequest;
  try {
    payload = (await request.json()) as AgentRunRequest;
  } catch {
    return browserJson({ error: "The request body must be JSON." }, 400);
  }
  /* Either a pressed button naming a capability, or a sentence to route. */
  if (!hasText(payload?.capability) && !hasText(payload?.message)) {
    return browserJson({ error: "Provide either a capability or a message." }, 400);
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const emit = (event: AgentEvent) => {
        if (!open) {
          return;
        }
        try {
          controller.enqueue(encoder.encode(encodeAgentEvent(event)));
        } catch {
          /* The reader went away mid-run; stop writing rather than throwing. */
          open = false;
        }
      };

      await runAgentRequest(payload, emit);

      if (open) {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      /* Stops a reverse proxy from buffering the stream into one response. */
      "X-Accel-Buffering": "no"
    }
  });
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
