import { describe, expect, it } from "vitest";
import {
  browserOptionsResponse,
  browserTaskAccessError,
  browserTaskJson
} from "@/lib/browserApi";

const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;

describe("Browser Companion API origin boundary", () => {
  it("rejects Hyatt page scripts before task handling", async () => {
    const request = new Request("http://localhost:3000/api/browser-tasks/task-1", {
      headers: { Origin: "https://www.hyatt.com" },
      method: "POST"
    });
    const response = browserTaskAccessError(request);

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ error: expect.stringContaining("Browser Companion") });
  });

  it("echoes only an allowed extension origin and never emits wildcard CORS", () => {
    const extensionRequest = new Request("http://localhost:3000/api/browser-tasks/task-1", {
      headers: { Origin: extensionOrigin }
    });
    const sameOriginRequest = new Request("http://localhost:3000/api/browser-tasks/task-1", {
      headers: { Origin: "http://localhost:3000" }
    });

    expect(browserTaskAccessError(extensionRequest)).toBeNull();
    expect(browserOptionsResponse(extensionRequest).headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
    expect(browserTaskJson(extensionRequest, { ok: true }).headers.get("Access-Control-Allow-Origin"))
      .toBe(extensionOrigin);
    expect(browserTaskJson(sameOriginRequest, { ok: true }).headers.get("Access-Control-Allow-Origin"))
      .toBeNull();
    expect(browserOptionsResponse(extensionRequest).headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });
});
