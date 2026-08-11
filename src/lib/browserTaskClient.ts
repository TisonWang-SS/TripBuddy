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

export async function waitForBrowserTask<TResult>(
  taskId: string,
  expiresAt: string,
  onUpdate?: (task: BrowserTaskPayload<TResult>) => void
) {
  const deadline = Date.parse(expiresAt);
  if (!Number.isFinite(deadline)) {
    throw new Error("Browser task did not provide a valid expiration time.");
  }
  while (Date.now() <= deadline + 5_000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(`/api/browser-tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
    const task = (await response.json()) as BrowserTaskPayload<TResult> & { error?: string };
    if (!response.ok) {
      throw new Error(task.error || `Browser task status failed with ${response.status}.`);
    }
    onUpdate?.(task);
    if (task.status === "failed") {
      throw new Error(task.errorMessage || "The Browser Companion task failed.");
    }
    if (task.status === "succeeded" || task.status === "partial") {
      return task;
    }
  }
  throw new Error("Timed out waiting for the Browser Companion task.");
}
