import { describe, expect, it } from "vitest";
import { stripBrowserTaskHash } from "@/lib/browserTasks";

describe("browser task URL cleanup", () => {
  it("removes every TripBuddy task fragment while preserving unrelated state", () => {
    expect(
      stripBrowserTaskHash(
        "https://www.hyatt.com/search#view=map&tripbuddyEndpoint=http%3A%2F%2Flocalhost%3A3000&tripbuddyTaskId=task-1&tripbuddyRequestedCurrency=USD"
      )
    ).toBe("https://www.hyatt.com/search#view=map");
  });

  it("returns malformed source values unchanged", () => {
    expect(stripBrowserTaskHash("not a URL")).toBe("not a URL");
  });
});
