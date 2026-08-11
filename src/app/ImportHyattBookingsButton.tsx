"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { waitForBrowserTask, type BrowserTaskPayload } from "@/lib/browserTaskClient";
import { ActionPanel, Notice } from "@/ui";

type ImportPayload = {
  created?: number;
  imported?: number;
  loginUrl?: string;
  skipped?: number;
  sourceUrl?: string;
  status?: "login_required" | "partial" | "succeeded";
  summary?: string;
  updated?: number;
  error?: string;
};

export function ImportHyattBookingsButton({ className }: { className?: string } = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<ImportPayload | null>(null);

  async function importBookings() {
    const browserTab = window.open("about:blank", "_blank");
    setLoading(true);
    setPayload(null);

    try {
      if (!browserTab) {
        throw new Error("Chrome blocked the Hyatt tab. Allow pop-ups for TripBuddy and try again.");
      }
      const response = await fetch("/api/account-imports", {
        body: JSON.stringify({ hotelGroup: "Hyatt" }),
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const task = (await response.json()) as BrowserTaskPayload<ImportPayload> & { error?: string };
      if (!response.ok) {
        throw new Error(task.error || `Import failed with status ${response.status}.`);
      }
      browserTab.location.href = task.launchUrl;
      const completed = await waitForBrowserTask<ImportPayload>(task.taskId, task.expiresAt);
      setPayload(completed.result ?? { error: completed.errorMessage ?? "Hyatt import returned no result." });
      router.refresh();
    } catch (error) {
      browserTab?.close();
      setPayload({ error: error instanceof Error ? error.message : "Hyatt booking import failed." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <ActionPanel>
      <button className={className} disabled={loading} onClick={importBookings} type="button">
        {loading ? "Importing Hyatt..." : "Import Hyatt bookings"}
      </button>
      {payload ? (
        <Notice tone={payload.error || payload.status === "login_required" ? "caution" : "positive"}>
          <p>
            {payload.error ??
              payload.summary ??
              `Imported ${payload.imported ?? 0} booking${payload.imported === 1 ? "" : "s"}.`}
          </p>
          {payload.status === "login_required" && payload.loginUrl ? (
            <a href={payload.loginUrl} rel="noreferrer" target="_blank">
              Open Hyatt sign in
            </a>
          ) : null}
          {payload.status === "succeeded" ? (
            <small>
              Created {payload.created ?? 0}, updated {payload.updated ?? 0}.
            </small>
          ) : null}
        </Notice>
      ) : null}
    </ActionPanel>
  );
}
