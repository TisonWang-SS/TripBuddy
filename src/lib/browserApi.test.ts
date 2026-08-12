import { afterEach, describe, expect, it, vi } from "vitest";
import {
  browserOptionsResponse,
  browserTaskAccessError,
  browserTaskJson,
  sameOriginRequestError
} from "@/lib/browserApi";

const extensionOrigin = `chrome-extension://${"a".repeat(32)}`;

/**
 * Real requests always carry Host — HTTP/1.1 requires it — and the guards read
 * it, because `request.url` reports the address the server bound to rather than
 * the address the browser used.
 */
function request(url: string, headers: Record<string, string>, method = "POST") {
  const host = new URL(url).host;
  return new Request(url, { headers: { Host: host, ...headers }, method });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Browser Companion API origin boundary", () => {
  it("rejects Hyatt page scripts before task handling", async () => {
    const response = browserTaskAccessError(
      request("http://localhost:3000/api/browser-tasks/task-1", { Origin: "https://www.hyatt.com" })
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ error: expect.stringContaining("Browser Companion") });
  });

  it("echoes only an allowed extension origin and never emits wildcard CORS", () => {
    const extensionRequest = request("http://localhost:3000/api/browser-tasks/task-1", { Origin: extensionOrigin }, "GET");
    const sameOriginRequest = request("http://localhost:3000/api/browser-tasks/task-1", { Origin: "http://localhost:3000" }, "GET");

    expect(browserTaskAccessError(extensionRequest)).toBeNull();
    expect(browserOptionsResponse(extensionRequest).headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
    expect(browserTaskJson(extensionRequest, { ok: true }).headers.get("Access-Control-Allow-Origin")).toBe(extensionOrigin);
    expect(browserTaskJson(sameOriginRequest, { ok: true }).headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(browserOptionsResponse(extensionRequest).headers.get("Access-Control-Allow-Origin")).not.toBe("*");
  });

  it("treats localhost and 127.0.0.1 on the same port as one application origin", () => {
    const alias = request("http://localhost:3123/api/hotel-search", { Origin: "http://127.0.0.1:3123" });
    const differentPort = request("http://localhost:3123/api/hotel-search", { Origin: "http://127.0.0.1:3000" });

    expect(sameOriginRequestError(alias)).toBeNull();
    expect(browserTaskAccessError(alias)).toBeNull();
    expect(sameOriginRequestError(differentPort)?.status).toBe(403);
  });

  it("rejects a cross-origin task creation request before route handling", async () => {
    const response = sameOriginRequestError(
      request("http://localhost:3000/api/hotel-search", { Origin: "https://evil.example" })
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({ error: "Cross-origin requests are not allowed." });
  });

  /*
   * The app is reached at a LAN address whenever it is opened from another
   * device, which README's own start command invites. Next builds request.url
   * from the bound address, so comparing against it rejected every one of these.
   */
  it("accepts the app reached at a private address", () => {
    for (const host of ["192.168.3.1:3000", "10.0.0.4:3000", "172.16.5.9:3000", "169.254.1.2:3000"]) {
      const lan = new Request("http://localhost:3000/api/price-checks", {
        headers: { Host: host, Origin: `http://${host}` },
        method: "POST"
      });
      expect(sameOriginRequestError(lan), host).toBeNull();
    }
  });

  /* Under --hostname 0.0.0.0 request.url reads http://0.0.0.0:3000 for every request. */
  it("accepts a loopback request served by a server bound to all interfaces", () => {
    const bound = new Request("http://0.0.0.0:3000/api/price-checks", {
      headers: { Host: "localhost:3000", Origin: "http://localhost:3000" },
      method: "POST"
    });
    expect(sameOriginRequestError(bound)).toBeNull();
  });

  /*
   * Host agreeing with Origin is not sufficient. A public name rebound to a
   * private address produces exactly that agreement, so the served address must
   * also be one the app is legitimately reachable at.
   */
  it("rejects a public name pointed at this machine, even though Origin matches Host", () => {
    const rebound = new Request("http://localhost:3000/api/price-checks", {
      headers: { Host: "evil.example:3000", Origin: "http://evil.example:3000" },
      method: "POST"
    });
    expect(sameOriginRequestError(rebound)?.status).toBe(403);
    expect(browserTaskAccessError(rebound)?.status).toBe(403);
  });

  it("rejects a public address that is not private at all", () => {
    const public_ = new Request("http://localhost:3000/api/price-checks", {
      headers: { Host: "8.8.8.8:3000", Origin: "http://8.8.8.8:3000" },
      method: "POST"
    });
    expect(sameOriginRequestError(public_)?.status).toBe(403);
  });

  it("accepts a host named explicitly in the environment", () => {
    const named = new Request("http://localhost:3000/api/price-checks", {
      headers: { Host: "tripbuddy.local:3000", Origin: "http://tripbuddy.local:3000" },
      method: "POST"
    });
    expect(sameOriginRequestError(named)?.status).toBe(403);

    vi.stubEnv("TRIPBUDDY_APP_ORIGIN", "http://tripbuddy.local:3000");
    expect(sameOriginRequestError(named)).toBeNull();
  });

  it("does not widen the rule when the environment setting is malformed", () => {
    vi.stubEnv("TRIPBUDDY_APP_ORIGIN", "not a url");
    const rebound = new Request("http://localhost:3000/api/price-checks", {
      headers: { Host: "evil.example:3000", Origin: "http://evil.example:3000" },
      method: "POST"
    });
    expect(sameOriginRequestError(rebound)?.status).toBe(403);
  });

  /* A client with no Origin is not the threat these checks exist for. */
  it("allows a request that carries no Origin at all", () => {
    expect(sameOriginRequestError(new Request("http://localhost:3000/api/price-checks", { method: "POST" }))).toBeNull();
  });

  it("rejects a request that claims an Origin but carries no Host", () => {
    const headless = new Request("http://localhost:3000/api/price-checks", {
      headers: { Origin: "http://localhost:3000" },
      method: "POST"
    });
    expect(sameOriginRequestError(headless)?.status).toBe(403);
  });
});
