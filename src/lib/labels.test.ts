import { describe, expect, it } from "vitest";
import {
  cancellationMatchLabel,
  collectionMethodLabel,
  evidenceQualityLabel,
  humanize,
  inclusionLabel,
  riskLevelLabel,
  roomMatchLabel,
  runStatusLabel,
  sourceTypeLabel,
  verdictLabel
} from "./labels";

const RESOLVERS = [
  cancellationMatchLabel,
  collectionMethodLabel,
  evidenceQualityLabel,
  inclusionLabel,
  riskLevelLabel,
  roomMatchLabel,
  runStatusLabel,
  sourceTypeLabel,
  verdictLabel
];

describe("labels", () => {
  it("resolves verdicts to copy and a tone", () => {
    expect(verdictLabel("keep")).toEqual({ label: "Keep booking", tone: "positive" });
    expect(verdictLabel("rebook_direct")).toEqual({ label: "Rebook direct", tone: "info" });
    expect(verdictLabel("urgent")).toEqual({ label: "Urgent", tone: "critical" });
  });

  it("uses a stated fallback rather than an empty badge when a value is missing", () => {
    expect(verdictLabel(null).label).toBe("No verdict");
    expect(verdictLabel(undefined).label).toBe("No verdict");
    expect(evidenceQualityLabel(null)).toEqual({ label: "Needs review", tone: "caution" });
    expect(runStatusLabel("").label).toBe("Unknown");
  });

  it("grades evidence and risk onto distinct tones", () => {
    expect(evidenceQualityLabel("high").tone).toBe("positive");
    expect(evidenceQualityLabel("needs_review").tone).toBe("caution");
    expect(riskLevelLabel("high").tone).toBe("critical");
    expect(riskLevelLabel("low").tone).toBe("positive");
  });

  it("humanizes snake_case", () => {
    expect(humanize("same_or_better")).toBe("Same or better");
    expect(humanize("due_queue")).toBe("Due queue");
    expect(humanize("cash")).toBe("Cash");
  });

  /*
   * The point of this module is that a storage identifier can never reach the
   * screen. An enum member added to the schema but not to a map here must still
   * render as copy, so the fallback is asserted rather than assumed.
   */
  it("never returns a raw storage identifier, including for unmapped values", () => {
    for (const resolve of RESOLVERS) {
      expect(resolve("some_future_enum_member").label).toBe("Some future enum member");
    }
  });

  it("resolves every value the schema can store for the enums it covers", () => {
    expect(["keep", "rebook_direct", "consider_ota", "needs_review", "urgent"].map((value) => verdictLabel(value).label))
      .toEqual(["Keep booking", "Rebook direct", "Consider OTA", "Needs review", "Urgent"]);
    expect(["pending", "running", "succeeded", "partial", "failed"].map((value) => runStatusLabel(value).label))
      .toEqual(["Pending", "Running", "Succeeded", "Partial", "Failed"]);
    expect(["same_or_better", "worse", "unknown"].map((value) => cancellationMatchLabel(value).label))
      .toEqual(["Same or better", "Worse", "Unknown"]);
    expect(["yes", "no", "unknown"].map((value) => inclusionLabel(value).label))
      .toEqual(["Included", "Not included", "Unknown"]);
    expect(["exact", "similar", "unknown"].map((value) => roomMatchLabel(value).label))
      .toEqual(["Exact match", "Similar", "Unknown"]);
    expect(collectionMethodLabel("browser_companion").label).toBe("Browser Companion");
    expect(sourceTypeLabel("ota").label).toBe("OTA");
  });
});
