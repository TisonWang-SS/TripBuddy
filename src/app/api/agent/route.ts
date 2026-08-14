import { type AgentEvent, encodeAgentEvent } from "@/lib/agent/events";
import { type AgentTurnRequest, runAgentTurn } from "@/lib/agent/loop";
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

  let payload: AgentTurnRequest;
  try {
    payload = (await request.json()) as AgentTurnRequest;
  } catch {
    return browserJson({ error: "The request body must be JSON." }, 400);
  }
  /* Either something the user said, or the press that resumes a held action. */
  if (!hasText(payload?.message) && !hasText(payload?.confirm?.capability)) {
    return browserJson({ error: "Provide either a message or a confirmed action." }, 400);
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

      /*
       * A turn can wait on a Hyatt tab, so a reader that goes away must stop the
       * run rather than leave it polling a task nobody is listening for.
       */
      await runAgentTurn(payload, emit, { signal: request.signal });

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
