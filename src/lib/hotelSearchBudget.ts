import type { HotelSearchBudget, HotelSearchQuery } from "@/lib/providers/types";

export const APPROXIMATE_BUDGET_TOLERANCE = 0.1;

export type HotelSearchBudgetSummary = HotelSearchBudget & {
  comparisonCeiling: number;
  nights: number;
  stayTarget: number;
};

/**
 * Converts a user-stated budget into a whole-stay comparison ceiling without
 * asking the model to perform arithmetic. Approximate budgets get a documented
 * 10% tolerance; all derived values retain the literal amount and its basis.
 */
export function summarizeHotelSearchBudget(query: HotelSearchQuery): HotelSearchBudgetSummary | null {
  if (!query.budget) {
    return null;
  }
  const nights = hotelStayNights(query.checkIn, query.checkOut);
  const stayTarget = roundMoney(query.budget.amount * (query.budget.basis === "per_night" ? nights : 1));
  const comparisonCeiling = query.budget.flexibility === "approximate"
    ? roundMoney(stayTarget * (1 + APPROXIMATE_BUDGET_TOLERANCE))
    : stayTarget;
  return { ...query.budget, comparisonCeiling, nights, stayTarget };
}

export function hotelStayNights(checkIn: string, checkOut: string) {
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
