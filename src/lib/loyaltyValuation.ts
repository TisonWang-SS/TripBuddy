/*
 * Sourced loyalty valuations.
 *
 * A loyalty figure enters the cost arithmetic only when someone outside this
 * product quotes a price for it (ADR 0003). So every figure here carries who
 * says so and as of when, exactly as CurrencyConversionRate does, and every
 * figure expires: a valuation past its review date is still used and named as
 * stale rather than silently trusted or silently dropped.
 *
 * Nothing in this module estimates. A missing valuation produces a named
 * absence, never a substituted number.
 */

import type { EvidenceQuality, LoyaltyValuationKind, SupportedCurrency } from "@prisma/client";
import { formatCalendarDate } from "@/lib/format";
import { loyaltyValuationKindLabel } from "@/lib/labels";

/*
 * How long a quote stays current. This is a product decision rather than a
 * per-row one: asking a traveler to also invent a review cadence for each
 * figure invites them to set it to never.
 */
export const VALUATION_REVIEW_INTERVAL_DAYS = 180;

const DAY_MS = 86_400_000;

export type SourcedValuation = {
  amount: number;
  asOf: Date;
  currency: SupportedCurrency;
  hotelGroup: string;
  kind: LoyaltyValuationKind;
  lastReviewedAt: Date;
  realizationRate: number;
  sourceName: string;
};

export function findValuation(valuations: readonly SourcedValuation[], kind: LoyaltyValuationKind) {
  return valuations.find((valuation) => valuation.kind === kind) ?? null;
}

export function valuationReviewDueAt(valuation: Pick<SourcedValuation, "lastReviewedAt">) {
  return new Date(valuation.lastReviewedAt.getTime() + VALUATION_REVIEW_INTERVAL_DAYS * DAY_MS);
}

export function isValuationStale(valuation: Pick<SourcedValuation, "lastReviewedAt">, now: Date) {
  return now.getTime() > valuationReviewDueAt(valuation).getTime();
}

/*
 * The market price adjusted for how often this traveler actually clears the
 * award. The rate multiplies the quote rather than re-deriving it, so a
 * certificate is never discounted twice for the same uncertainty.
 */
export function effectiveUnitValue(valuation: Pick<SourcedValuation, "amount" | "realizationRate">) {
  return valuation.amount * valuation.realizationRate;
}

export function describeValuation(valuation: Pick<SourcedValuation, "hotelGroup" | "kind" | "lastReviewedAt" | "sourceName">) {
  return `${valuation.hotelGroup} ${loyaltyValuationKindLabel(valuation.kind).label.toLowerCase()} (${valuation.sourceName}, reviewed ${formatCalendarDate(valuation.lastReviewedAt)})`;
}

export function staleValuationWarning(valuation: SourcedValuation) {
  return `The ${describeValuation(valuation)} is past its ${VALUATION_REVIEW_INTERVAL_DAYS}-day review date and was used as recorded.`;
}

export function missingValuationBlocker(hotelGroup: string, kind: LoyaltyValuationKind) {
  return `No ${hotelGroup} ${loyaltyValuationKindLabel(kind).label.toLowerCase()} is recorded, so this stay cannot be priced.`;
}

export function unconvertibleValuationWarning(valuation: SourcedValuation, targetCurrency: SupportedCurrency) {
  return `The ${describeValuation(valuation)} is recorded in ${valuation.currency} and no conversion to ${targetCurrency} is on record, so it is not used.`;
}

/*
 * Confidence, not correctness: a stale quote still produces a number, and the
 * recommendation that depends on it says so one level less confidently.
 */
export function downgradeEvidenceQuality(level: EvidenceQuality): EvidenceQuality {
  if (level === "high") {
    return "medium";
  }
  return level === "medium" ? "low" : level;
}

export type ValuationDraft = {
  amount: number;
  asOf: Date;
  currency: SupportedCurrency;
  hotelGroup: string;
  kind: LoyaltyValuationKind;
  lastReviewedAt: Date;
  realizationRate: number;
  sourceName: string;
};

/*
 * Rejected rather than coerced, like every other write boundary in this
 * codebase. The realization-rate rules are the load-bearing ones: it is an
 * adjustment down from a quoted price, so it cannot exceed 1, and points
 * redeem at their value, so it does not apply to them at all.
 */
export function validateValuationDraft(draft: ValuationDraft): ValuationDraft {
  if (!Number.isFinite(draft.amount) || draft.amount <= 0) {
    throw new Error("A valuation amount must be greater than zero.");
  }
  if (!draft.sourceName.trim()) {
    throw new Error("A valuation requires the source that quotes it.");
  }
  if (Number.isNaN(draft.asOf.getTime()) || Number.isNaN(draft.lastReviewedAt.getTime())) {
    throw new Error("A valuation requires a valid quote date and review date.");
  }
  if (!Number.isFinite(draft.realizationRate) || draft.realizationRate <= 0 || draft.realizationRate > 1) {
    throw new Error("A realization rate adjusts a quoted price downward, so it must be greater than zero and at most 1.");
  }
  if (draft.kind === "point" && draft.realizationRate !== 1) {
    throw new Error("A realization rate applies to certificates, not to points.");
  }
  return { ...draft, sourceName: draft.sourceName.trim() };
}
