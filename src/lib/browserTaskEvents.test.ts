import { describe, expect, it, vi } from "vitest";
import { browserTaskListenerCount, publishBrowserTaskChange, subscribeToBrowserTaskChanges } from "./browserTaskEvents";

describe("browser task change bus", () => {
  it("tells every subscriber which task changed", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeToBrowserTaskChanges(first);
    const stopSecond = subscribeToBrowserTaskChanges(second);

    publishBrowserTaskChange("task-1");

    expect(first).toHaveBeenCalledWith("task-1");
    expect(second).toHaveBeenCalledWith("task-1");
    stopFirst();
    stopSecond();
  });

  it("stops delivering once a subscriber unsubscribes", () => {
    const listener = vi.fn();
    subscribeToBrowserTaskChanges(listener)();
    publishBrowserTaskChange("task-1");
    expect(listener).not.toHaveBeenCalled();
    expect(browserTaskListenerCount()).toBe(0);
  });

  /*
   * A watcher that throws must not silence the others. Delivery is best-effort
   * on purpose — a missed notification costs latency, because every watcher also
   * re-reads on a timer.
   */
  it("keeps notifying after one subscriber throws", () => {
    const healthy = vi.fn();
    const stopBroken = subscribeToBrowserTaskChanges(() => {
      throw new Error("watcher is gone");
    });
    const stopHealthy = subscribeToBrowserTaskChanges(healthy);

    expect(() => publishBrowserTaskChange("task-1")).not.toThrow();
    expect(healthy).toHaveBeenCalledWith("task-1");
    stopBroken();
    stopHealthy();
  });

  it("survives a subscriber removing itself mid-publish", () => {
    const later = vi.fn();
    const stopSelf = subscribeToBrowserTaskChanges(() => stopSelf());
    const stopLater = subscribeToBrowserTaskChanges(later);

    publishBrowserTaskChange("task-1");
    expect(later).toHaveBeenCalledWith("task-1");
    stopLater();
  });
});
