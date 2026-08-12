import type { CostBreakdown } from "@/lib/decision";
import { parseJson, toJson } from "@/lib/json";

export type RecommendationCostBreakdown = {
  baseline: StoredCostBreakdown;
  candidate: StoredCostBreakdown;
};

const COST_FIELDS = [
  "cashPrice",
  "creditCardValue",
  "effectiveCost",
  "earnedPointsValue",
  "promotionValue",
  "redemptionPointsValue"
] as const satisfies readonly (keyof CostBreakdown)[];

const LEGACY_COST_FIELDS = ["benefitValue", "eliteProgressValue"] as const;

export type StoredCostBreakdown = CostBreakdown & {
  benefitValue?: number;
  eliteProgressValue?: number;
};

export function parseRecommendationCostBreakdown(value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, null);
  if (!isRecord(parsed) || !isStoredCostBreakdown(parsed.baseline) || !isStoredCostBreakdown(parsed.candidate)) {
    return null;
  }
  return { baseline: parsed.baseline, candidate: parsed.candidate } satisfies RecommendationCostBreakdown;
}

export function serializeRecommendationCostBreakdown(value: { baseline: CostBreakdown; candidate: CostBreakdown }) {
  if (!isCurrentCostBreakdown(value.baseline) || !isCurrentCostBreakdown(value.candidate)) {
    throw new Error("Recommendation cost breakdown is invalid.");
  }
  return toJson(value);
}

function isStoredCostBreakdown(value: unknown): value is StoredCostBreakdown {
  return isRecord(value) && COST_FIELDS.every((field) => {
    const fieldValue = value[field];
    return typeof fieldValue === "number" && Number.isFinite(fieldValue);
  }) && LEGACY_COST_FIELDS.every((field) => {
    const fieldValue = value[field];
    return fieldValue === undefined || (typeof fieldValue === "number" && Number.isFinite(fieldValue));
  });
}

function isCurrentCostBreakdown(value: unknown): value is CostBreakdown {
  return isStoredCostBreakdown(value) && LEGACY_COST_FIELDS.every((field) => !(field in value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
