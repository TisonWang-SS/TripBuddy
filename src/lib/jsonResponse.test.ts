import { describe, expect, it } from "vitest";
import { NonJsonResponseError, readJsonResponse } from "@/lib/jsonResponse";

function respond(body: string, init: ResponseInit) {
  const response = new Response(body, init);
  Object.defineProperty(response, "url", { value: "http://localhost:3000/api/hotel-search" });
  return response;
}

const html = () => respond("<!DOCTYPE html><html>404</html>", { headers: { "content-type": "text/html" }, status: 404 });

describe("json response reader", () => {
  it("parses a JSON body", async () => {
    const response = respond(JSON.stringify({ ok: 1 }), { headers: { "content-type": "application/json" } });
    await expect(readJsonResponse<{ ok: number }>(response)).resolves.toEqual({ ok: 1 });
  });

  /*
   * The condition this exists for: a stale dev build answers a route with the
   * HTML 404 page, and `response.json()` reports only that "<" is unexpected —
   * naming neither the request nor its status.
   */
  it("names the request, status and content type when the body is HTML", async () => {
    await expect(readJsonResponse(html())).rejects.toThrow(NonJsonResponseError);
    await expect(readJsonResponse(html())).rejects.toThrow(/\/api\/hotel-search answered 404 with text\/html/);
    await expect(readJsonResponse(html())).rejects.toThrow(/delete \.next/);
  });
});
