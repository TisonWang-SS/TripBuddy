"use client";

import { useState } from "react";

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

type ImportTaskPayload = {
  error?: string | null;
  launchUrl?: string;
  requestId: string;
  result?: ImportPayload | null;
  status: "failed" | "pending" | "succeeded";
};

export function ImportHyattBookingsButton() {
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
      const response = await fetch("/api/account-bookings/hyatt/import", {
        body: "{}",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        method: "POST"
      });
      const task = (await response.json()) as ImportTaskPayload;
      if (!response.ok) {
        throw new Error(task.error || `Import failed with status ${response.status}.`);
      }
      if (!task.launchUrl) {
        throw new Error("TripBuddy did not return a Hyatt account URL.");
      }
      browserTab.location.href = task.launchUrl;
      setPayload(await waitForImportResult(task.requestId));
    } catch (error) {
      browserTab?.close();
      setPayload({ error: error instanceof Error ? error.message : "Hyatt booking import failed." });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="importPanel">
      <button disabled={loading} onClick={importBookings} type="button">
        {loading ? "Importing Hyatt..." : "Import Hyatt bookings"}
      </button>
      {payload ? (
        <div className={`notice ${payload.error || payload.status === "login_required" ? "warning" : "success"}`}>
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
        </div>
      ) : null}
    </div>
  );
}

async function waitForImportResult(requestId: string) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 120000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await fetch(
      `/api/account-bookings/hyatt/import?requestId=${encodeURIComponent(requestId)}`,
      { cache: "no-store" }
    );
    const task = (await response.json()) as ImportTaskPayload;
    if (!response.ok) {
      throw new Error(task.error || `Import status failed with ${response.status}.`);
    }
    if (task.status === "failed") {
      throw new Error(task.error || "The Hyatt account page could not be read by the Browser Companion.");
    }
    if (task.status === "succeeded" && task.result) {
      return task.result;
    }
  }
  throw new Error("Timed out waiting for Hyatt My Stays. Keep Chrome open and confirm the TripBuddy Browser Companion is enabled.");
}
