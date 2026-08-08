import { describe, expect, it } from "vitest";
import taskProtocol from "@extension/taskProtocol.js";
import { stripBrowserTaskHash } from "@/lib/browserTasks";

describe("browser task URL cleanup", () => {
  it("removes every TripBuddy task fragment while preserving unrelated state", () => {
    expect(
      stripBrowserTaskHash(
        `https://www.hyatt.com/search#view=map&${taskProtocol.endpointKey}=http%3A%2F%2Flocalhost%3A3000&${taskProtocol.taskIdKey}=task-1&${taskProtocol.requestedCurrencyKey}=USD`
      )
    ).toBe("https://www.hyatt.com/search#view=map");
  });

  it("returns malformed source values unchanged", () => {
    expect(stripBrowserTaskHash("not a URL")).toBe("not a URL");
  });
});
