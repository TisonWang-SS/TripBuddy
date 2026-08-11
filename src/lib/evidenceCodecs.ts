import { parseJson, toJson } from "@/lib/json";

export type ObservationEvidenceSnapshot = {
  pageTitle: string | null;
  sourceUrl: string | null;
  textSample: string;
};

const emptySnapshot: ObservationEvidenceSnapshot = {
  pageTitle: null,
  sourceUrl: null,
  textSample: ""
};

export function parseObservationEvidenceSnapshot(value: string | null | undefined): ObservationEvidenceSnapshot {
  const parsed = parseJson<unknown>(value, null);
  if (!isRecord(parsed)) {
    return emptySnapshot;
  }
  if (
    !nullableString(parsed.pageTitle) ||
    !nullableString(parsed.sourceUrl) ||
    typeof parsed.textSample !== "string"
  ) {
    return emptySnapshot;
  }
  return {
    pageTitle: parsed.pageTitle,
    sourceUrl: parsed.sourceUrl,
    textSample: parsed.textSample
  };
}

export function serializeObservationEvidenceSnapshot(snapshot: ObservationEvidenceSnapshot) {
  return toJson(snapshot);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
