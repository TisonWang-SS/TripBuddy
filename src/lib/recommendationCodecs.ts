import type { CostBreakdown } from "@/lib/decision";
import { parseJson, toJson } from "@/lib/json";
import type { RedemptionComparison, RedemptionVerdict } from "@/lib/redemptionComparison";

export type RecommendationCostBreakdown = {
  baseline: StoredCostBreakdown;
  candidate: StoredCostBreakdown;
  redemption?: RedemptionComparison;
};

/*
 * Three tenses of the same shape. A stored snapshot is never recalculated, so
 * reading has to accept every composition this product has ever written while
 * writing accepts only the current one.
 */

/** Present in every snapshot ever written. */
const COST_FIELDS = [
  "cashPrice",
  "creditCardValue",
  "effectiveCost",
  "earnedPointsValue",
  "promotionValue",
  "redemptionPointsValue"
] as const satisfies readonly (keyof CostBreakdown)[];

/** Added by ADR 0003-B: required when writing, absent from older snapshots. */
const ADDED_COST_FIELDS = ["certificateValue"] as const satisfies readonly (keyof CostBreakdown)[];

/** Removed by ADR 0003-A: readable as history, never written again. */
const LEGACY_COST_FIELDS = ["benefitValue", "eliteProgressValue"] as const;

const REDEMPTION_VERDICTS: readonly RedemptionVerdict[] = ["redeem", "pay_cash", "even", "not_compared"];

const REDEMPTION_NUMBERS = ["cashTotal", "copay", "points", "pointValue", "valuePerPoint"] as const;
const REDEMPTION_STRINGS = ["captureId", "currency", "reason", "roomLabel"] as const;

export type StoredCostBreakdown = Omit<CostBreakdown, "certificateValue"> & {
  benefitValue?: number;
  certificateValue?: number;
  eliteProgressValue?: number;
};

export function parseRecommendationCostBreakdown(value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, null);
  if (!isRecord(parsed) || !isStoredCostBreakdown(parsed.baseline) || !isStoredCostBreakdown(parsed.candidate)) {
    return null;
  }
  const redemption = isRedemptionComparison(parsed.redemption) ? parsed.redemption : undefined;
  return { baseline: parsed.baseline, candidate: parsed.candidate, ...(redemption ? { redemption } : {}) } satisfies RecommendationCostBreakdown;
}

export function serializeRecommendationCostBreakdown(value: {
  baseline: CostBreakdown;
  candidate: CostBreakdown;
  redemption?: RedemptionComparison;
}) {
  if (!isCurrentCostBreakdown(value.baseline) || !isCurrentCostBreakdown(value.candidate)) {
    throw new Error("Recommendation cost breakdown is invalid.");
  }
  if (value.redemption && !isRedemptionComparison(value.redemption)) {
    throw new Error("Recommendation redemption comparison is invalid.");
  }
  return toJson(value);
}

function isStoredCostBreakdown(value: unknown): value is StoredCostBreakdown {
  return (
    isRecord(value) &&
    COST_FIELDS.every((field) => isFiniteNumber(value[field])) &&
    [...ADDED_COST_FIELDS, ...LEGACY_COST_FIELDS].every((field) => value[field] === undefined || isFiniteNumber(value[field]))
  );
}

function isCurrentCostBreakdown(value: unknown): value is CostBreakdown {
  return (
    isStoredCostBreakdown(value) &&
    ADDED_COST_FIELDS.every((field) => isFiniteNumber(value[field])) &&
    LEGACY_COST_FIELDS.every((field) => !(field in value))
  );
}

function isRedemptionComparison(value: unknown): value is RedemptionComparison {
  return (
    isRecord(value) &&
    typeof value.verdict === "string" &&
    REDEMPTION_VERDICTS.includes(value.verdict as RedemptionVerdict) &&
    REDEMPTION_NUMBERS.every((field) => value[field] === null || isFiniteNumber(value[field])) &&
    REDEMPTION_STRINGS.every((field) => value[field] === null || typeof value[field] === "string")
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
