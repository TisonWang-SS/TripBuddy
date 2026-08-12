import { describe, expect, it } from "vitest";
import { type AgentEvent, encodeAgentEvent, parseAgentEvent, readAgentEventFrames } from "./events";

const started: AgentEvent = { runId: "run-1", timestamp: 1, type: "RUN_STARTED" };

describe("agent events", () => {
  it("encodes one event as a terminated SSE frame", () => {
    expect(encodeAgentEvent(started)).toBe(`data: {"runId":"run-1","timestamp":1,"type":"RUN_STARTED"}\n\n`);
  });

  it("round-trips through encode and parse", () => {
    const frames = readAgentEventFrames(encodeAgentEvent(started));
    expect(frames).toHaveLength(1);
    expect(parseAgentEvent(frames[0])).toEqual(started);
  });

  /*
   * Payloads are single-line JSON precisely so that content containing newlines
   * cannot split one event into two frames.
   */
  it("keeps a multi-line message inside a single frame", () => {
    const event: AgentEvent = { delta: "line one\n\nline two", messageId: "m1", timestamp: 2, type: "TEXT_MESSAGE_CONTENT" };
    const frames = readAgentEventFrames(encodeAgentEvent(event));
    expect(frames).toHaveLength(1);
    expect(parseAgentEvent(frames[0])).toEqual(event);
  });

  it("splits a chunk carrying several events", () => {
    const chunk = [started, { runId: "run-1", timestamp: 3, type: "RUN_FINISHED" } as AgentEvent]
      .map(encodeAgentEvent)
      .join("");
    const events = readAgentEventFrames(chunk).map(parseAgentEvent);
    expect(events.map((event) => event?.type)).toEqual(["RUN_STARTED", "RUN_FINISHED"]);
  });

  /*
   * A live interface reads this stream. One malformed frame is dropped rather
   * than throwing, so a single bad event cannot tear down a healthy run.
   */
  it("returns null for anything it cannot trust", () => {
    expect(parseAgentEvent("not json")).toBeNull();
    expect(parseAgentEvent("[]")).toBeNull();
    expect(parseAgentEvent("null")).toBeNull();
    expect(parseAgentEvent(`{"type":"RUN_STARTED"}`)).toBeNull();
    expect(parseAgentEvent(`{"timestamp":1}`)).toBeNull();
    expect(parseAgentEvent(`{"type":"NOT_A_REAL_EVENT","timestamp":1}`)).toBeNull();
    expect(parseAgentEvent(`{"type":"RUN_STARTED","timestamp":"soon"}`)).toBeNull();
  });

  it("ignores non-data lines in a chunk", () => {
    expect(readAgentEventFrames(`: keep-alive\n\n${encodeAgentEvent(started)}`)).toHaveLength(1);
  });
});
