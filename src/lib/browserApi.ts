import { NextResponse } from "next/server";

export const browserCorsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

export function browserOptionsResponse() {
  return new NextResponse(null, { headers: browserCorsHeaders });
}

export function browserJson(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: browserCorsHeaders, status });
}
