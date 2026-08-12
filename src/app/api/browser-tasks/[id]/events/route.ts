import { type AgentEvent, encodeAgentEvent } from "@/lib/agent/events";
import { browserTaskAccessError } from "@/lib/browserApi";
import { subscribeToBrowserTaskChanges } from "@/lib/browserTaskEvents";
import { getBrowserTask, serializeTaskState } from "@/lib/browserTasks";

export const dynamic = "force-dynamic";

const TERMINAL: readonly string[] = ["succeeded", "partial", "failed"];

/**
 * How long a watcher waits before re-reading anyway.
 *
 * The bus normally wakes it the moment a capture lands, so this is a floor, not
 * the mechanism: it catches a notification lost to a process restart, and the
 * lazy expiry transition inside getBrowserTask, which no capture announces.
 */
const SAFETY_POLL_MS = 3_000;

/** Matches the old client's tolerance: a task may report just past its deadline. */
const GRACE_MS = 5_000;

/**
 * Progress for one browser task, as an event stream.
 *
 * Replaces a fixed one-second poll from the browser. Correctness does not
 * depend on the in-process notification arriving — every wake-up re-reads the
 * task, and a slow poll runs regardless.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessError = browserTaskAccessError(request);
  if (accessError) {
    return accessError;
  }
  const { id } = await params;

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
          open = false;
        }
      };

      let wake: (() => void) | null = null;
      const unsubscribe = subscribeToBrowserTaskChanges((taskId) => {
        if (taskId === id) {
          wake?.();
        }
      });

      emit({ runId: id, timestamp: Date.now(), type: "RUN_STARTED" });

      let lastSnapshot = "";
      let deadline = Number.POSITIVE_INFINITY;

      try {
        while (open && !request.signal.aborted && Date.now() <= deadline) {
          const task = await getBrowserTask(id);
          if (!task) {
            emit({
              code: "task_not_found",
              message: "Browser task was not found or expired.",
              runId: id,
              timestamp: Date.now(),
              type: "RUN_ERROR"
            });
            break;
          }

          const state = serializeTaskState(task);
          deadline = Date.parse(state?.expiresAt ?? "") + GRACE_MS;

          /* Only announce a state that actually differs from the last one sent. */
          const serialized = JSON.stringify(state);
          if (serialized !== lastSnapshot) {
            lastSnapshot = serialized;
            emit({ snapshot: state, timestamp: Date.now(), type: "STATE_SNAPSHOT" });
          }

          if (state && TERMINAL.includes(state.status)) {
            emit({ runId: id, timestamp: Date.now(), type: "RUN_FINISHED" });
            break;
          }

          await nextWake(request.signal, (resolve) => {
            wake = resolve;
          });
          wake = null;
        }

        /* Falling out of the loop on time is a timeout, not a silent success. */
        if (open && !request.signal.aborted && Date.now() > deadline) {
          emit({
            code: "task_expired",
            message: "Timed out waiting for the Browser Companion task.",
            runId: id,
            timestamp: Date.now(),
            type: "RUN_ERROR"
          });
        }
      } finally {
        unsubscribe();
        if (open) {
          controller.close();
        }
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no"
    }
  });
}

/** Resolves on the next published change for this task, on abort, or on the poll floor. */
function nextWake(signal: AbortSignal, register: (resolve: () => void) => void) {
  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, SAFETY_POLL_MS);
    signal.addEventListener("abort", finish, { once: true });
    register(finish);
  });
}
