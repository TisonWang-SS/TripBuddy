import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAgentEvent, readAgentEventFrames } from "@/lib/agent/events";

const mocks = vi.hoisted(() => ({ runAgentTurn: vi.fn() }));

vi.mock("@/lib/agent/loop", () => ({ runAgentTurn: mocks.runAgentTurn }));

/* Host is set because real requests always carry it, and the origin guard reads it. */
function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/agent", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: { "Content-Type": "application/json", Host: "localhost", ...headers },
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
    mocks.runAgentTurn.mockReset().mockImplementation(async (_request: unknown, emit: (event: unknown) => void) => {
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
    const response = await POST(post({ message: "show my stays" }, { Origin: "https://evil.example" }));

    expect(response.status).toBe(403);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("accepts a same-origin request", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ message: "show my stays" }, { Origin: "http://localhost" }));

    expect(response.status).toBe(200);
    expect(mocks.runAgentTurn).toHaveBeenCalled();
  });

  it("answers a malformed body with a status rather than a stream", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post("{ not json"));

    expect(response.status).toBe(400);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("requires either a message or a confirmed action", async () => {
    const { POST } = await import("@/app/api/agent/route");
    expect((await POST(post({}))).status).toBe(400);
    expect((await POST(post({ message: "  " }))).status).toBe(400);
    expect((await POST(post({ confirm: { args: {}, capability: "   " } }))).status).toBe(400);
    expect(mocks.runAgentTurn).not.toHaveBeenCalled();
  });

  it("accepts a plain message", async () => {
    const { POST } = await import("@/app/api/agent/route");
    expect((await POST(post({ message: "show my bookings" }))).status).toBe(200);
    expect(mocks.runAgentTurn).toHaveBeenCalled();
  });

  /* A press carries no words, so the turn has to be startable without one. */
  it("accepts a confirmation with no message", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const confirm = { args: { bookingId: "booking-1" }, capability: "run_price_check" };
    expect((await POST(post({ confirm }))).status).toBe(200);
    expect(mocks.runAgentTurn).toHaveBeenCalled();
  });

  it("streams events as server-sent events", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ message: "show my stays" }));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache, no-transform");
    /* Without this a reverse proxy can buffer the whole run into one response. */
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");

    const events = await readStream(response);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  it("forwards the confirmed action through to the turn", async () => {
    const { POST } = await import("@/app/api/agent/route");
    const confirm = { args: { bookingId: "booking-1" }, capability: "run_price_check" };
    await POST(post({ confirm }));

    expect(mocks.runAgentTurn).toHaveBeenCalledWith(
      expect.objectContaining({ confirm }),
      expect.any(Function),
      expect.objectContaining({ signal: expect.anything() })
    );
  });

  /* A failing run still answers 200; the failure is a RUN_ERROR in the stream. */
  it("reports a run failure inside the stream", async () => {
    mocks.runAgentTurn.mockImplementation(async (_request: unknown, emit: (event: unknown) => void) => {
      emit({ runId: "run-1", timestamp: 1, type: "RUN_STARTED" });
      emit({ code: "browser_task_failed", message: "Hyatt returned nothing usable.", runId: "run-1", timestamp: 2, type: "RUN_ERROR" });
    });

    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(post({ message: "check booking-1" }));

    expect(response.status).toBe(200);
    const events = await readStream(response);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_ERROR"]);
  });
});
