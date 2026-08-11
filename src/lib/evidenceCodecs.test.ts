import { describe, expect, it } from "vitest";
import {
  parseObservationEvidenceSnapshot,
  serializeObservationEvidenceSnapshot
} from "@/lib/evidenceCodecs";

describe("observation evidence snapshot codec", () => {
  it("round-trips a valid snapshot", () => {
    const snapshot = {
      pageTitle: "Hyatt price summary",
      sourceUrl: "https://www.hyatt.com/booking/summary",
      textSample: "Total Cash USD 900"
    };

    expect(parseObservationEvidenceSnapshot(serializeObservationEvidenceSnapshot(snapshot))).toEqual(snapshot);
  });

  it("fails closed for malformed stored JSON", () => {
    expect(parseObservationEvidenceSnapshot('{"pageTitle":5,"textSample":[]}')).toEqual({
      pageTitle: null,
      sourceUrl: null,
      textSample: ""
    });
  });
});
