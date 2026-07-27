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

export function ImportHyattBookingsButton() {
  const [loading, setLoading] = useState(false);
  const [payload, setPayload] = useState<ImportPayload | null>(null);

  async function importBookings() {
    setLoading(true);
    setPayload(null);

    try {
      const response = await fetch("/api/account-bookings/hyatt/import", {
        cache: "no-store",
        method: "POST"
      });
      const data = (await response.json()) as ImportPayload;
      setPayload(data);
    } catch (error) {
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
