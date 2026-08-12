import { readEventStream } from "@/lib/agent/client";

export type BrowserTaskPayload<TResult = unknown> = {
  errorCode: string | null;
  errorMessage: string | null;
  expiresAt: string;
  finishedAt: string | null;
  hotelGroup: string;
  kind: "booking_price_check" | "hotel_search" | "account_booking_import";
  launchUrl: string;
  result: TResult | null;
  runId: string | null;
  status: "pending" | "running" | "succeeded" | "partial" | "failed";
  taskId: string;
};

/**
 * Watches one Browser Companion task to completion.
 *
 * The server streams state as it changes rather than the browser asking once a
 * second. The deadline is the server's too — it holds the task's expiry and
 * ends the stream itself — so this function no longer runs a clock.
 *
 * `expiresAt` is still taken and still validated: a task created without a
 * usable expiry means the create response was malformed, and failing here is
 * better than opening a stream that can never terminate cleanly.
 */
export async function waitForBrowserTask<TResult>(
  taskId: string,
  expiresAt: string,
  onUpdate?: (task: BrowserTaskPayload<TResult>) => void
) {
  if (!Number.isFinite(Date.parse(expiresAt))) {
    throw new Error("Browser task did not provide a valid expiration time.");
  }

  const response = await fetch(`/api/browser-tasks/${encodeURIComponent(taskId)}/events`, { cache: "no-store" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Browser task status failed with ${response.status}.`);
  }
  if (!response.body) {
    throw new Error("The Browser Companion task stream carried no body.");
  }

  let latest: BrowserTaskPayload<TResult> | null = null;
  let failure: string | null = null;

  await readEventStream(response.body, (event) => {
    if (event.type === "STATE_SNAPSHOT") {
      latest = event.snapshot as BrowserTaskPayload<TResult>;
      onUpdate?.(latest);
    } else if (event.type === "RUN_ERROR") {
      failure = event.message;
    }
  });

  if (failure) {
    throw new Error(failure);
  }
  if (!latest) {
    throw new Error("The Browser Companion task reported no state.");
  }

  const task: BrowserTaskPayload<TResult> = latest;
  if (task.status === "failed") {
    throw new Error(task.errorMessage || "The Browser Companion task failed.");
  }
  return task;
}
