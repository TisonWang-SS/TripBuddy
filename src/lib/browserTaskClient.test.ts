import { afterEach, describe, expect, it, vi } from "vitest";
import { waitForBrowserTask } from "@/lib/browserTaskClient";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("browser task polling deadline", () => {
  it("uses the task's server-issued expiration time", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2030-01-01T00:00:00.000Z"));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
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
    }), { status: 200 })));

    const completed = waitForBrowserTask("task-1", "2030-01-01T00:03:00.000Z");
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(completed).resolves.toMatchObject({ status: "succeeded" });
  });

  it("rejects a missing or malformed server deadline", async () => {
    await expect(waitForBrowserTask("task-1", "not-a-date")).rejects.toThrow(/valid expiration time/);
  });
});
