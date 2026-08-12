import { NextResponse } from "next/server";

/*
 * Origin rules for the local API.
 *
 * The threat is a page the user happens to be visiting making requests to
 * TripBuddy running on their own machine. Browsers set Origin on those requests
 * and page script cannot forge it, which is what these checks rest on. A client
 * with no Origin at all is allowed through — curl and the like are not the
 * threat, and a forged header would be trivial for them anyway.
 */

export function browserTaskAccessError(request: Request) {
  return browserTaskRequestOrigin(request).allowed
    ? null
    : NextResponse.json({ error: "Browser task requests must come from TripBuddy or its Browser Companion." }, { status: 403 });
}

export function sameOriginRequestError(request: Request) {
  const origin = request.headers.get("Origin");
  return !origin || originServesThisApp(origin, request)
    ? null
    : NextResponse.json({ error: "Cross-origin requests are not allowed." }, { status: 403 });
}

export function browserOptionsResponse(request: Request) {
  const access = browserTaskRequestOrigin(request);
  if (!access.allowed) {
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(null, { headers: access.headers });
}

export function browserJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}

export function browserTaskJson(request: Request, body: unknown, status = 200) {
  return NextResponse.json(body, { headers: browserTaskRequestOrigin(request).headers, status });
}

function browserTaskRequestOrigin(request: Request): { allowed: boolean; headers: Headers } {
  const origin = request.headers.get("Origin");
  if (!origin || originServesThisApp(origin, request)) {
    return { allowed: true, headers: new Headers() };
  }
  const configuredOrigin = process.env.TRIPBUDDY_BROWSER_EXTENSION_ORIGIN?.trim();
  const extensionOrigin = /^chrome-extension:\/\/[a-p]{32}$/.test(origin);
  const allowed = extensionOrigin && (!configuredOrigin || origin === configuredOrigin);
  return {
    allowed,
    headers: new Headers(
      allowed
        ? {
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
            "Access-Control-Allow-Origin": origin,
            Vary: "Origin"
          }
        : undefined
    )
  };
}

/**
 * Whether `origin` is this application, reached at the address the request was
 * actually sent to.
 *
 * Two conditions, and both matter:
 *
 * 1. Origin equals the served origin, taken from the Host header. It cannot be
 *    taken from `request.url`: Next builds that from the address the server
 *    bound to, so it reads `http://localhost:3000` — or `http://0.0.0.0:3000`
 *    under `--hostname 0.0.0.0` — regardless of which address the browser used.
 *    Comparing against it rejected every request from a LAN address, which is
 *    the setup README's own start command produces.
 *
 * 2. That address is one this app is legitimately reachable at: loopback, or a
 *    private IPv4 literal. Host agreeing with Origin is not sufficient on its
 *    own — a public name rebound to a private address satisfies condition one
 *    while being exactly the attack these checks exist to stop.
 */
function originServesThisApp(origin: string, request: Request) {
  const served = servedOrigin(request);
  if (!served || !isTrustedAppHostname(served.hostname)) {
    return false;
  }
  let from: URL;
  try {
    from = new URL(origin);
  } catch {
    return false;
  }
  if (from.origin === served.origin) {
    return true;
  }
  /* localhost and 127.0.0.1 on one port are the same application, as before. */
  return (
    from.protocol === served.protocol &&
    from.port === served.port &&
    isLoopbackHostname(from.hostname) &&
    isLoopbackHostname(served.hostname)
  );
}

function servedOrigin(request: Request) {
  const host = request.headers.get("Host");
  if (!host) {
    return null;
  }
  try {
    return new URL(`${new URL(request.url).protocol}//${host}`);
  } catch {
    return null;
  }
}

/* IPv4 literals only: a name, even one that resolves here, is not accepted. */
const PRIVATE_IPV4 = /^(?:10\.|192\.168\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.)\d{1,3}(?:\.\d{1,3})*$/;

function isTrustedAppHostname(hostname: string) {
  /* Escape hatch for a host this rule cannot know about, such as an mDNS name. */
  const configured = process.env.TRIPBUDDY_APP_ORIGIN?.trim();
  if (configured) {
    try {
      if (new URL(configured).hostname === hostname) {
        return true;
      }
    } catch {
      /* A malformed setting must not widen the rule. */
    }
  }
  return isLoopbackHostname(hostname) || PRIVATE_IPV4.test(hostname);
}

function isLoopbackHostname(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
