/*
 * Presentation layer for database enums.
 *
 * Enum values are storage identifiers, not copy. Rendering them directly leaks
 * strings like "rebook_direct" into the interface, so every user-facing enum
 * resolves through here into a human label plus a badge tone.
 *
 * Unmapped values fall back to a humanized form rather than passing through, so
 * adding an enum member can never regress the interface to raw snake_case.
 */

export type Tone = "neutral" | "positive" | "info" | "caution" | "critical";

export type Label = {
  label: string;
  tone: Tone;
};

const VERDICTS: Record<string, Label> = {
  keep: { label: "Keep booking", tone: "positive" },
  rebook_direct: { label: "Rebook direct", tone: "info" },
  consider_ota: { label: "Consider OTA", tone: "caution" },
  needs_review: { label: "Needs review", tone: "caution" },
  urgent: { label: "Urgent", tone: "critical" }
};

const EVIDENCE_QUALITIES: Record<string, Label> = {
  high: { label: "High", tone: "positive" },
  medium: { label: "Medium", tone: "info" },
  low: { label: "Low", tone: "caution" },
  needs_review: { label: "Needs review", tone: "caution" }
};

const RUN_STATUSES: Record<string, Label> = {
  pending: { label: "Pending", tone: "neutral" },
  running: { label: "Running", tone: "info" },
  succeeded: { label: "Succeeded", tone: "positive" },
  partial: { label: "Partial", tone: "caution" },
  failed: { label: "Failed", tone: "critical" }
};

const RISK_LEVELS: Record<string, Label> = {
  low: { label: "Low", tone: "positive" },
  medium: { label: "Medium", tone: "caution" },
  high: { label: "High", tone: "critical" }
};

const ROOM_MATCHES: Record<string, Label> = {
  exact: { label: "Exact match", tone: "positive" },
  similar: { label: "Similar", tone: "caution" },
  unknown: { label: "Unknown", tone: "neutral" }
};

const CANCELLATION_MATCHES: Record<string, Label> = {
  same_or_better: { label: "Same or better", tone: "positive" },
  worse: { label: "Worse", tone: "critical" },
  unknown: { label: "Unknown", tone: "neutral" }
};

const INCLUSION_STATUSES: Record<string, Label> = {
  yes: { label: "Included", tone: "positive" },
  no: { label: "Not included", tone: "caution" },
  unknown: { label: "Unknown", tone: "neutral" }
};

const SOURCE_TYPES: Record<string, Label> = {
  direct: { label: "Direct", tone: "neutral" },
  ota: { label: "OTA", tone: "neutral" },
  other: { label: "Other", tone: "neutral" }
};

const COLLECTION_METHODS: Record<string, Label> = {
  manual: { label: "Manual entry", tone: "neutral" },
  browser_companion: { label: "Browser Companion", tone: "neutral" }
};

const EXTRACTION_SOURCES: Record<string, Label> = {
  deterministic: { label: "Deterministic", tone: "neutral" },
  model: { label: "Model", tone: "info" },
  manual: { label: "Manual", tone: "neutral" }
};

const INVENTORY_TYPES: Record<string, Label> = {
  cash: { label: "Cash", tone: "neutral" },
  award: { label: "Award", tone: "info" }
};

const LOGIN_STATES: Record<string, Label> = {
  not_required: { label: "Not required", tone: "neutral" },
  anonymous: { label: "Anonymous", tone: "caution" },
  member: { label: "Member", tone: "positive" },
  unknown: { label: "Unknown", tone: "neutral" }
};

const BASELINE_TYPES: Record<string, Label> = {
  cash: { label: "Cash", tone: "neutral" },
  points: { label: "Points", tone: "info" },
  certificate: { label: "Free-night certificate", tone: "info" }
};

const TRIGGERS: Record<string, Label> = {
  manual: { label: "Manual", tone: "neutral" },
  due_queue: { label: "Due queue", tone: "neutral" }
};

/** Turns an unmapped storage value into sentence-case copy. */
export function humanize(value: string) {
  const spaced = value.replace(/[_-]+/g, " ").trim();
  if (spaced.length === 0) {
    return value;
  }
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function resolve(map: Record<string, Label>, value: string | null | undefined, empty: Label): Label {
  if (!value) {
    return empty;
  }
  return map[value] ?? { label: humanize(value), tone: "neutral" };
}

const UNKNOWN: Label = { label: "Unknown", tone: "neutral" };

export function verdictLabel(value: string | null | undefined) {
  return resolve(VERDICTS, value, { label: "No verdict", tone: "neutral" });
}

export function evidenceQualityLabel(value: string | null | undefined) {
  return resolve(EVIDENCE_QUALITIES, value, EVIDENCE_QUALITIES.needs_review);
}

export function runStatusLabel(value: string | null | undefined) {
  return resolve(RUN_STATUSES, value, UNKNOWN);
}

export function riskLevelLabel(value: string | null | undefined) {
  return resolve(RISK_LEVELS, value, UNKNOWN);
}

export function roomMatchLabel(value: string | null | undefined) {
  return resolve(ROOM_MATCHES, value, UNKNOWN);
}

export function cancellationMatchLabel(value: string | null | undefined) {
  return resolve(CANCELLATION_MATCHES, value, UNKNOWN);
}

export function inclusionLabel(value: string | null | undefined) {
  return resolve(INCLUSION_STATUSES, value, UNKNOWN);
}

export function sourceTypeLabel(value: string | null | undefined) {
  return resolve(SOURCE_TYPES, value, UNKNOWN);
}

export function collectionMethodLabel(value: string | null | undefined) {
  return resolve(COLLECTION_METHODS, value, UNKNOWN);
}

export function extractionSourceLabel(value: string | null | undefined) {
  return resolve(EXTRACTION_SOURCES, value, UNKNOWN);
}

export function inventoryTypeLabel(value: string | null | undefined) {
  return resolve(INVENTORY_TYPES, value, UNKNOWN);
}

export function loginStateLabel(value: string | null | undefined) {
  return resolve(LOGIN_STATES, value, UNKNOWN);
}

export function baselineTypeLabel(value: string | null | undefined) {
  return resolve(BASELINE_TYPES, value, UNKNOWN);
}

export function triggerLabel(value: string | null | undefined) {
  return resolve(TRIGGERS, value, UNKNOWN);
}
