import { afterEach, describe, expect, it, vi } from "vitest";
import { type AgentEvent, encodeAgentEvent } from "@/lib/agent/events";
import { waitForBrowserTask } from "@/lib/browserTaskClient";

afterEach(() => {
  vi.unstubAllGlobals();
});

const succeeded = {
  errorCode: null,
  errorMessage: null,
  expiresAt: "2030-01-01T00:03:00.000Z",
  finishedAt: "2030-01-01T00:00:01.000Z",
  hotelGroup: "Hyatt",
  kind: "booking_price_check",
  launchUrl: "https://example.com",
  result: { observationsCreated: 1 },
  runId: "run-1",
  status: "succeeded",
  taskId: "task-1"
};

function streamOf(events: readonly AgentEvent[]) {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) {
        controller.enqueue(encoder.encode(encodeAgentEvent(event)));
      }
      controller.close();
    }
  });
}

function serving(events: readonly AgentEvent[]) {
  const fetchImpl = vi.fn().mockResolvedValue(
    new Response(streamOf(events), { headers: { "Content-Type": "text/event-stream" }, status: 200 })
  );
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

const snapshot = (state: unknown): AgentEvent => ({ snapshot: state, timestamp: 1, type: "STATE_SNAPSHOT" });

describe("browser task watcher", () => {
  it("resolves with the last state the server streamed", async () => {
    serving([
      { runId: "task-1", timestamp: 0, type: "RUN_STARTED" },
      snapshot({ ...succeeded, status: "running" }),
      snapshot(succeeded),
      { runId: "task-1", timestamp: 2, type: "RUN_FINISHED" }
    ]);

    await expect(waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z")).resolves.toMatchObject({
      status: "succeeded"
    });
  });

  it("reports every intermediate state to the caller", async () => {
    serving([snapshot({ ...succeeded, status: "pending" }), snapshot({ ...succeeded, status: "running" }), snapshot(succeeded)]);

    const seen: string[] = [];
    await waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z", (task) => seen.push(task.status));
    expect(seen).toEqual(["pending", "running", "succeeded"]);
  });

  it("watches the task's own event stream", async () => {
    const fetchImpl = serving([snapshot(succeeded)]);
    await waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z");
    expect(fetchImpl.mock.calls[0][0]).toBe("/api/browser-tasks/task-1/events");
  });

  it("raises the failure the task recorded", async () => {
    serving([snapshot({ ...succeeded, errorMessage: "Hyatt returned no rate evidence.", status: "failed" })]);

    await expect(waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z")).rejects.toThrow(
      "Hyatt returned no rate evidence."
    );
  });

  /* The server owns the deadline now and ends the stream with this. */
  it("raises a timeout reported by the server", async () => {
    serving([
      snapshot({ ...succeeded, status: "running" }),
      {
        code: "task_expired",
        message: "Timed out waiting for the Browser Companion task.",
        runId: "task-1",
        timestamp: 3,
        type: "RUN_ERROR"
      }
    ]);

    await expect(waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z")).rejects.toThrow(/Timed out/);
  });

  /*
   * A create response without a usable expiry is malformed. Failing here beats
   * opening a stream on a task that can never terminate cleanly.
   */
  it("rejects a missing or malformed server deadline", async () => {
    await expect(waitForBrowserTask("task-1", "not-a-date")).rejects.toThrow(/valid expiration time/);
  });

  it("raises the route's error when the stream cannot be opened", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "Browser task requests must come from TripBuddy or its Browser Companion." }), {
          headers: { "Content-Type": "application/json" },
          status: 403
        })
      )
    );

    await expect(waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z")).rejects.toThrow(/must come from TripBuddy/);
  });
});
