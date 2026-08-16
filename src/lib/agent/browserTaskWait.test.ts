import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * Waiting on a tab, and knowing when there is no tab to wait on.
 *
 * The distinction matters more since ADR 0007: with no confirmation press, the
 * tab is opened on a guess, so "nobody ever picked this up" is a real and
 * recoverable state rather than an impossible one.
 */

const mocks = vi.hoisted(() => ({ getBrowserTask: vi.fn() }));

vi.mock("@/lib/browserTasks", () => ({
  getBrowserTask: mocks.getBrowserTask,
  serializeTaskState: (task: unknown) => task
}));

const { awaitBrowserTask, BrowserTaskWaitError } = await import("@/lib/agent/browserTaskWait");

/** A clock the test drives, so no real time passes. */
function clock() {
  let value = 0;
  return { advance: (ms: number) => (value += ms), now: () => value };
}

describe("waiting for a browser task", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns as soon as the task reaches a terminal state", async () => {
    mocks.getBrowserTask.mockResolvedValue({ errorMessage: null, result: { total: 1 }, status: "succeeded" });

    const finished = await awaitBrowserTask("task-1", { now: clock().now, pollIntervalMs: 1 });

    expect(finished).toMatchObject({ result: { total: 1 }, status: "succeeded" });
  });

  /*
   * The Companion moves a task to `running` on its first snapshot. Still pending
   * well past that means the tab was never opened — blocked, guessed wrong, or
   * closed. Waiting out the full TTL would say nothing for three minutes and
   * then report a timeout, when the answer was knowable in twenty seconds and
   * the thing to do about it is different.
   */
  it("reports a task no tab ever picked up, rather than waiting out its TTL", async () => {
    const time = clock();
    mocks.getBrowserTask.mockImplementation(async () => {
      time.advance(10_000);
      return { errorMessage: null, result: null, status: "pending" };
    });

    const finished = await awaitBrowserTask("task-1", { now: time.now, pollIntervalMs: 1 });

    expect(finished.status).toBe("never_started");
    /* Three polls, not three minutes of them. */
    expect(mocks.getBrowserTask.mock.calls.length).toBeLessThan(5);
  });

  /* Once a tab has reported in, it is given the time the task itself allows. */
  it("keeps waiting on a task that has started running", async () => {
    const time = clock();
    let polls = 0;
    mocks.getBrowserTask.mockImplementation(async () => {
      time.advance(30_000);
      polls += 1;
      return polls < 4
        ? { errorMessage: null, result: null, status: "running" }
        : { errorMessage: null, result: { ok: true }, status: "succeeded" };
    });

    const finished = await awaitBrowserTask("task-1", { now: time.now, pollIntervalMs: 1 });

    expect(finished.status).toBe("succeeded");
    expect(polls).toBe(4);
  });

  it("gives up on a task that never advances at all", async () => {
    const time = clock();
    mocks.getBrowserTask.mockImplementation(async () => {
      time.advance(60_000);
      return { errorMessage: null, result: null, status: "running" };
    });

    await expect(awaitBrowserTask("task-1", { now: time.now, pollIntervalMs: 1 })).rejects.toThrow(BrowserTaskWaitError);
  });

  it("stops when the request is cancelled", async () => {
    mocks.getBrowserTask.mockResolvedValue({ errorMessage: null, result: null, status: "running" });
    const controller = new AbortController();
    controller.abort();

    await expect(awaitBrowserTask("task-1", { pollIntervalMs: 1, signal: controller.signal })).rejects.toThrow(
      BrowserTaskWaitError
    );
  });
});
