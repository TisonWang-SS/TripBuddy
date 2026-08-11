import type { CostBreakdown } from "@/lib/decision";
import { parseJson, toJson } from "@/lib/json";

export type RecommendationCostBreakdown = {
  baseline: CostBreakdown;
  candidate: CostBreakdown;
};

const COST_FIELDS = [
  "benefitValue",
  "cashPrice",
  "creditCardValue",
  "effectiveCost",
  "eliteProgressValue",
  "earnedPointsValue",
  "promotionValue",
  "redemptionPointsValue"
] as const satisfies readonly (keyof CostBreakdown)[];

export function parseRecommendationCostBreakdown(value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, null);
  if (!isRecord(parsed) || !isCostBreakdown(parsed.baseline) || !isCostBreakdown(parsed.candidate)) {
    return null;
  }
  return { baseline: parsed.baseline, candidate: parsed.candidate } satisfies RecommendationCostBreakdown;
}

export function serializeRecommendationCostBreakdown(value: RecommendationCostBreakdown) {
  if (!isCostBreakdown(value.baseline) || !isCostBreakdown(value.candidate)) {
    throw new Error("Recommendation cost breakdown is invalid.");
  }
  return toJson(value);
}

function isCostBreakdown(value: unknown): value is CostBreakdown {
  return isRecord(value) && COST_FIELDS.every((field) => {
    const fieldValue = value[field];
    return typeof fieldValue === "number" && Number.isFinite(fieldValue);
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
