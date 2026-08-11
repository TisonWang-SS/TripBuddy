import { describe, expect, it } from "vitest";
import taskProtocol from "@extension/taskProtocol.js";
import { stripBrowserTaskHash } from "@/lib/browserTasks";
import { selectEvidenceTextSample } from "@/lib/json";

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

  it("retains both ends of an oversized evidence snapshot", () => {
    const sample = selectEvidenceTextSample(`Price list ${"x".repeat(20_000)} Price Summary Total Cash MYR3,031.23`);

    expect(sample).toHaveLength(12_000);
    expect(sample).toMatch(/^Price list/);
    expect(sample).toContain("[middle omitted]");
    expect(sample).toMatch(/Price Summary Total Cash MYR3,031\.23$/);
  });
});
