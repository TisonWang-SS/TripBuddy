import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAgentEvent, readAgentEventFrames } from "@/lib/agent/events";

const mocks = vi.hoisted(() => ({ runAgentRequest: vi.fn() }));

vi.mock("@/lib/agent/run", () => ({ runAgentRequest: mocks.runAgentRequest }));

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/agent", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
    method: "POST"
  });
}

async function readStream(response: Response) {
  const text = await response.text();
  return readAgentEventFrames(text)
    .map(parseAgentEvent)
    .filter((event) => event !== null);
}

describe("agent event stream route", () => {
  beforeEach(() => {
    mocks.runAgentRequest.mockReset().mockImplementation(async (_request: unknown, emit: (event: unknown) => void) => {
      emit({ runId: "run-1", timestamp: 1, type: "RUN_STARTED" });
      emit({ runId: "run-1", timestamp: 2, type: "RUN_FINISHED" });
    });
  });

  /*
   * Same boundary as the other task-creation routes, asserted the same way: the
   * status is not enough, the run must never have started.
   */
  it("blocks a cross-origin request before any capability runs", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ capability: "list_bookings" }, { Origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect(mocks.runAgentRequest).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ capability: "list_bookings" }, { Origin: "http://localhost" }));

    expect(response.status).toBe(200);
    expect(mocks.runAgentRequest).toHaveBeenCalled();
  });

  it("answers a malformed body with a status rather than a stream", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post("{ not json"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(mocks.runAgentRequest).not.toHaveBeenCalled();
  });

  it("requires either a capability or a message", async () => {
    const { POST } = await import("@/app/api/agent/route");
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ capability: "   " }))).status).toBe(400);
    expect((await POST(post({ message: "  " }))).status).toBe(400);
    expect(mocks.runAgentRequest).not.toHaveBeenCalled();
  });

  it("accepts a message with no capability", async () => {
    const { POST } = await import("@/app/api/agent/route");
    expect((await POST(post({ message: "show my bookings" }))).status).toBe(200);
    expect(mocks.runAgentRequest).toHaveBeenCalled();
  });

  it("streams events as server-sent events", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ capability: "list_bookings" }));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    /* Without this a reverse proxy can buffer the whole run into one response. */
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const events = await readStream(response);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  it("forwards confirmation through to the run", async () => {
    const { POST } = await import("@/app/api/agent/route");
    await POST(post({ args: { bookingId: "booking-1" }, capability: "run_price_check", confirmed: true }));

    expect(mocks.runAgentRequest).toHaveBeenCalledWith(
      expect.objectContaining({ args: { bookingId: "booking-1" }, capability: "run_price_check", confirmed: true }),
      expect.any(Function)
    );
  });

  /* A failing run still answers 200; the failure is a RUN_ERROR in the stream. */
  it("reports a run failure inside the stream", async () => {
    mocks.runAgentRequest.mockImplementation(async (_request: unknown, emit: (event: unknown) => void) => {
      emit({ runId: "run-1", timestamp: 1, type: "RUN_STARTED" });
      emit({ code: "confirmation_required", message: "needs a press", runId: "run-1", timestamp: 2, type: "RUN_ERROR" });
    });

    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ capability: "run_price_check" }));

    expect(response.status).toBe(200);
    const events = await readStream(response);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_ERROR"]);
  });
});
