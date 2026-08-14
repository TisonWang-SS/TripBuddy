/*
 * Waiting, on the server, for a Browser Companion task to come back.
 *
 * Until now every browser task was awaited by the page that started it: the page
 * polled, and the agent's part ended at "a tab was opened, look over there". An
 * agent loop cannot end there. The whole point of the loop is that the model
 * reads what came back and advises on it, so the run has to still be alive when
 * the Companion posts its evidence.
 *
 * This changes nothing about how the work is done. The task is still created by
 * TripBuddy, still carried out in a visible normal-Chrome tab the user opened,
 * and still completed by the extension posting evidence back. This only watches
 * the row the extension writes.
 */

import { getBrowserTask, serializeTaskState } from "@/lib/browserTasks";

/** Matches the Companion's own cadence; a Hyatt page takes seconds, not milliseconds. */
const POLL_INTERVAL_MS = 900;

/** Comfortably past any task TTL. Only reached when a task stops advancing at all. */
const WAIT_CEILING_MS = 6 * 60 * 1000;

export type FinishedBrowserTask = {
  errorMessage: string | null;
  result: unknown;
  status: string;
  taskId: string;
};

export class BrowserTaskWaitError extends Error {
  readonly code = "browser_task_unfinished";

  constructor(message: string) {
    super(message);
    this.name = "BrowserTaskWaitError";
  }
}

/**
 * Resolves when the task stops being pending or running.
 *
 * `getBrowserTask` expires a task that has passed its TTL, so every task reaches
 * a terminal state on its own and this does not need a timeout of its own to
 * agree with. The wall-clock guard below is for the case where it does not — a
 * clock moving backwards, or a row that stops advancing — because a poll loop
 * with no exit is how a request hangs until the process is killed.
 */
export async function awaitBrowserTask(
  taskId: string,
  options: { now?: () => number; pollIntervalMs?: number; signal?: AbortSignal } = {}
): Promise<FinishedBrowserTask> {
  const now = options.now ?? (() => Date.now());
  const interval = options.pollIntervalMs ?? POLL_INTERVAL_MS;
  const abandonAt = now() + WAIT_CEILING_MS;

  for (;;) {
    if (options.signal?.aborted) {
      throw new BrowserTaskWaitError("The request was cancelled before the Hyatt tab reported back.");
    }

    const task = serializeTaskState(await getBrowserTask(taskId));
    if (!task) {
      throw new BrowserTaskWaitError(`Browser task ${taskId} could not be read back.`);
    }

    if (task.status !== "pending" && task.status !== "running") {
      return {
        errorMessage: task.errorMessage ?? null,
        result: task.result ?? null,
        status: task.status,
        taskId
      };
    }

    if (now() >= abandonAt) {
      throw new BrowserTaskWaitError(
        "The Hyatt tab did not report back in time. Check that the tab is still open and the Browser Companion is installed."
      );
    }

    await sleep(interval, options.signal);
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(timer);
      reject(new BrowserTaskWaitError("The request was cancelled while waiting for the Hyatt tab."));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
