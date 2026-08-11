import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

const source = readFileSync(resolve("browser-extension/background.js"), "utf8");

function backgroundContext(fetchImpl = vi.fn()) {
  const context = vm.createContext({
    URL,
    chrome: { runtime: { onMessage: { addListener: vi.fn() } } },
    encodeURIComponent,
    fetch: fetchImpl
  });
  new vm.Script(source).runInContext(context);
  return context;
}

describe("Browser Companion service worker", () => {
  it("performs local API requests only for Hyatt task tabs", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "running" })));
    const context = backgroundContext(fetchImpl);
    const result = await vm.runInContext(`runBrowserRequest(
      { endpoint: "http://localhost:3000", method: "GET", taskId: "task-123456", type: "tripbuddy:browser-request" },
      { tab: { url: "https://www.hyatt.com/shop/rooms/test" } }
    )`, context);

    expect(result).toEqual({ body: { status: "running" }, ok: true, status: 200 });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://localhost:3000/api/browser-tasks/task-123456",
      expect.objectContaining({ method: "GET" })
    );
  });

  it("rejects page senders and non-local endpoints", async () => {
    const context = backgroundContext();

    await expect(vm.runInContext(`runBrowserRequest(
      { endpoint: "http://localhost:3000", method: "GET", taskId: "task-123456" },
      { tab: { url: "https://example.com/" } }
    )`, context)).rejects.toThrow("only from a Hyatt task tab");
    await expect(vm.runInContext(`runBrowserRequest(
      { endpoint: "https://evil.example", method: "GET", taskId: "task-123456" },
      { tab: { url: "https://www.hyatt.com/shop/rooms/test" } }
    )`, context)).rejects.toThrow("local HTTP origin");
  });
});
