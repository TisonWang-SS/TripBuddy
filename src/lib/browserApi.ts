import { NextResponse } from "next/server";

export function browserTaskAccessError(request: Request) {
  return browserTaskRequestOrigin(request).allowed
    ? null
    : NextResponse.json({ error: "Browser task requests must come from TripBuddy or its Browser Companion." }, { status: 403 });
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
  const requestOrigin = new URL(request.url).origin;
  if (!origin || origin === requestOrigin) {
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
