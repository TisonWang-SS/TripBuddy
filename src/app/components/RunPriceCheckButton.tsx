"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { waitForBrowserTask, type BrowserTaskPayload } from "@/lib/browserTaskClient";
import { Notice } from "@/ui";

export function RunPriceCheckButton({
  bookingId,
  className,
  trigger = "manual"
}: {
  bookingId: string;
  className?: string;
  trigger?: "due_queue" | "manual";
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [task, setTask] = useState<BrowserTaskPayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    const browserTab = window.open("about:blank", "_blank");
    setError(null);
    setLoading(true);
    try {
      if (!browserTab) {
        throw new Error("Chrome blocked the Hyatt tab. Allow pop-ups for TripBuddy and try again.");
      }
      const response = await fetch("/api/price-checks", {
        body: JSON.stringify({ bookingId, trigger }),
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const created = (await response.json()) as BrowserTaskPayload & { error?: string };
      if (!response.ok) {
        throw new Error(created.error || `Price check failed with ${response.status}.`);
      }
      browserTab.location.href = created.launchUrl;
      setTask(created);
      const completed = await waitForBrowserTask(created.taskId, created.expiresAt, setTask);
      setTask(completed);
      router.refresh();
    } catch (runError) {
      browserTab?.close();
      setError(runError instanceof Error ? runError.message : "Price check failed.");
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="importPanel">
      <button className={className} disabled={loading} onClick={run} type="button">
        {loading ? "Checking Hyatt..." : "Run price check"}
      </button>
      {error ? <Notice tone="caution">{error}</Notice> : null}
      {task && !error ? (
        <Notice tone={task.status === "succeeded" ? "positive" : "caution"}>
          Price check {task.status}. {task.result && typeof task.result === "object" && "observationsCreated" in task.result
            ? `${String(task.result.observationsCreated)} observation(s) created.`
            : "Keep the Hyatt tab open until capture finishes."}
        </Notice>
      ) : null}
    </div>
  );
}
