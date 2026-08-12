import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseAgentEvent, readAgentEventFrames } from "@/lib/agent/events";

const mocks = vi.hoisted(() => ({ getBrowserTask: vi.fn() }));

vi.mock("@/lib/browserTasks", () => ({
  getBrowserTask: mocks.getBrowserTask,
  serializeTaskState: (task: unknown) => task
}));

const finished = {
  errorCode: null,
  errorMessage: null,
  expiresAt: "2030-01-01T00:03:00.000Z",
  finishedAt: "2030-01-01T00:00:01.000Z",
  status: "succeeded",
  taskId: "task-1"
};

function get(headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/browser-tasks/task-1/events", { headers, method: "GET" });
}

const params = Promise.resolve({ id: "task-1" });

async function readStream(response: Response) {
  return readAgentEventFrames(await response.text())
    .map(parseAgentEvent)
    .filter((event) => event !== null);
}

describe("browser task event stream", () => {
  beforeEach(() => {
    mocks.getBrowserTask.mockReset().mockResolvedValue(finished);
  });

  /* Same boundary the polling route had; the status alone is not the assertion. */
  it("refuses a request from an unapproved origin without reading the task", async () => {
    const { GET } = await import("@/app/api/browser-tasks/[id]/events/route");
    const response = await GET(get({ Origin: "https://www.hyatt.com" }), { params });

    expect(response.status).toBe(403);
    expect(mocks.getBrowserTask).not.toHaveBeenCalled();
  });

  it("streams the state and closes once the task is terminal", async () => {
    const { GET } = await import("@/app/api/browser-tasks/[id]/events/route");
    const response = await GET(get(), { params });

    expect(response.headers.get("Content-Type")).toBe("text/event-stream; charset=utf-8");
    const events = await readStream(response);
    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "STATE_SNAPSHOT", "RUN_FINISHED"]);

    const snapshot = events[1];
    expect(snapshot.type === "STATE_SNAPSHOT" && snapshot.snapshot).toMatchObject({ status: "succeeded" });
  });

  it("ends a failed task as a completed run carrying the failure state", async () => {
    mocks.getBrowserTask.mockResolvedValue({ ...finished, errorMessage: "No rate evidence.", status: "failed" });

    const { GET } = await import("@/app/api/browser-tasks/[id]/events/route");
    const events = await readStream(await GET(get(), { params }));

    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "STATE_SNAPSHOT", "RUN_FINISHED"]);
    const snapshot = events[1];
    expect(snapshot.type === "STATE_SNAPSHOT" && snapshot.snapshot).toMatchObject({
      errorMessage: "No rate evidence.",
      status: "failed"
    });
  });

  it("reports a task that no longer exists as an error rather than a completion", async () => {
    mocks.getBrowserTask.mockResolvedValue(null);

    const { GET } = await import("@/app/api/browser-tasks/[id]/events/route");
    const events = await readStream(await GET(get(), { params }));

    expect(events.map((event) => event.type)).toEqual(["RUN_STARTED", "RUN_ERROR"]);
    const error = events[1];
    expect(error.type === "RUN_ERROR" && error.code).toBe("task_not_found");
  });
});
