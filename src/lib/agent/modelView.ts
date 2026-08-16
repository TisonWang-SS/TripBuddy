/*
 * What the model is allowed to see of a tool result, and what it is allowed to
 * say about it.
 *
 * ADR 0005 lets the model read results and write advice, which ADR 0002 did not.
 * That is a real widening, so it comes with two mechanical limits rather than a
 * promise of good behaviour:
 *
 * - **A view, not the result.** Every tool result is projected into a small,
 *   flat object built here. Identifiers the model has no use for — profile ids,
 *   observation ids, full source URLs — never enter its context, so it cannot
 *   quote one back or be talked into following one.
 *
 * - **Refs, not prices.** Each row carries a short `ref`. The model recommends
 *   by ref; the interface renders that row's money from the stored result. A
 *   recommendation is therefore a pointer, and the number beside it is never
 *   the model's transcription of a number.
 *
 * Free text inside a view — a hotel name, a rate plan, a cancellation policy —
 * came off a Hyatt page and is untrusted. It is length-capped here and framed as
 * data in the planner's instructions. The same rule the evidence extractor
 * already applies to page snapshots.
 */

import type { BookingSummary, ObservationRecord, RecommendationExplanation } from "@/lib/agent/capabilities/bookings";
import type { DueCheck } from "@/lib/agent/capabilities/checks";
import type { RunRecord } from "@/lib/agent/surface";
import { summarizeHotelSearchBudget } from "@/lib/hotelSearchBudget";
import { compareHotelSearchSession } from "@/lib/hotelSearchComparison";
import type { HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";

/** Long enough to identify a room or policy, short enough not to become a prompt. */
const TEXT_CAP = 160;

export type ToolObservation = {
  capability: string;
  /** Ref anchor to the stored identifier it stands for. Empty when nothing is referenceable. */
  refs: Readonly<Record<string, string>>;
  /** The projection handed to the model. Always JSON-serializable. */
  view: unknown;
};

export function observeToolResult(capability: string, result: unknown): ToolObservation {
  switch (capability) {
    case "search_hotels":
    case "set_search_budget":
    case "get_tax_inclusive_total":
    case "get_hotel_search_session": {
      const { session } = result as { session: HotelSearchSessionSnapshot | null };
      return session === null
        ? { capability, refs: {}, view: { note: "The search session was not found or has expired." } }
        : observeHotelSearchSession(capability, session);
    }

    case "list_bookings": {
      const { bookings } = result as { bookings: readonly BookingSummary[] };
      const refs: Record<string, string> = {};
      const rows = bookings.map((booking, index) => {
        const ref = `b${index + 1}`;
        refs[ref] = booking.bookingId;
        return {
          ref,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          city: cap(booking.city),
          currency: booking.currency,
          hotel: cap(booking.hotelName),
          nights: booking.nights,
          baselineCashTotal: booking.baselineCashTotal,
          verdict: booking.verdict
        };
      });
      return { capability, refs, view: { bookings: rows, count: rows.length } };
    }

    case "get_booking": {
      const { booking } = result as { booking: BookingSummary | null };
      if (!booking) {
        return { capability, refs: {}, view: { note: "No booking with that identifier." } };
      }
      return {
        capability,
        refs: { b1: booking.bookingId },
        view: {
          ref: "b1",
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          city: cap(booking.city),
          currency: booking.currency,
          hotel: cap(booking.hotelName),
          nights: booking.nights,
          baselineCashTotal: booking.baselineCashTotal,
          verdict: booking.verdict
        }
      };
    }

    case "list_due_checks": {
      const { due } = result as { due: readonly DueCheck[] };
      const refs: Record<string, string> = {};
      const rows = due.map((check, index) => {
        const ref = `b${index + 1}`;
        refs[ref] = check.bookingId;
        return {
          ref,
          consecutiveFailures: check.consecutiveFailures,
          dueSince: check.nextCheckAt,
          hotel: cap(check.hotelName),
          urgency: check.urgency
        };
      });
      return { capability, refs, view: { due: rows, count: rows.length } };
    }

    case "explain_recommendation": {
      const { recommendation } = result as { recommendation: RecommendationExplanation | null };
      if (!recommendation) {
        return { capability, refs: {}, view: { note: "No verdict has been stamped for that booking yet." } };
      }
      return {
        capability,
        refs: {},
        view: {
          blockers: recommendation.blockers.map(cap),
          currency: recommendation.currency,
          estimatedSavings: recommendation.estimatedSavings,
          evidenceQuality: recommendation.qualityLevel,
          explanation: cap(recommendation.explanation),
          risk: recommendation.riskLevel,
          verdict: recommendation.verdict,
          warnings: recommendation.warnings.map(cap)
        }
      };
    }

    case "get_price_history": {
      const { observations, runs } = result as { observations: readonly ObservationRecord[]; runs: readonly RunRecord[] };
      return {
        capability,
        refs: {},
        view: {
          observations: observations.slice(0, 12).map((observation) => ({
            cashTotal: observation.cashTotal,
            currency: observation.cashCurrency,
            evidenceQuality: observation.qualityLevel,
            observedAt: observation.observedAt,
            points: observation.points,
            source: cap(observation.sourceName)
          })),
          runs: runs.slice(0, 8).map((run) => ({ finishedAt: run.finishedAt, status: run.status, trigger: run.trigger }))
        }
      };
    }

    case "set_watch_plan": {
      const { hotelName, watching } = result as { hotelName: string; watching: boolean };
      return { capability, refs: {}, view: { hotel: cap(hotelName), watching } };
    }

    /*
     * Configuration reads. Passed through as scalars only: a nested structure
     * here would be stored settings the model has no decision to make about.
     */
    case "get_profile":
    case "get_settings":
      return { capability, refs: {}, view: scalarsOf(result) };

    default:
      /*
       * A capability with no projection yet. Reporting that it ran, without its
       * payload, is the safe default — inventing a projection from an unknown
       * shape is how an unreviewed field reaches the model.
       */
      return { capability, refs: {}, view: { note: `${capability} completed.` } };
  }
}

function observeHotelSearchSession(capability: string, session: HotelSearchSessionSnapshot): ToolObservation {
  const comparison = compareHotelSearchSession(session);
  const budget = summarizeHotelSearchBudget(session.query);
  const refs: Record<string, string> = {};

  const hotels = comparison.rows.map((row, index) => {
    const ref = `h${index + 1}`;
    refs[ref] = row.hotel.hotelKey;
    const starting = row.startingOffer;
    const final = row.finalOffer;
    return {
      ref,
      availability: cap(row.hotel.availabilityLabel),
      budgetStatus: row.budgetStatus,
      currency: starting?.currency ?? session.query.currency,
      destinationMatch: row.destinationGrounding,
      evidenceLevel: final ? final.evidenceLevel : starting?.evidenceLevel ?? null,
      /* Present only once a tax-inclusive total has actually been captured. */
      finalStayTotal: final?.stayTotal ?? null,
      hotel: cap(row.hotel.hotelName),
      location: row.hotel.locationLabel === null ? null : cap(row.hotel.locationLabel),
      pointsPerNight: starting?.startingPointsPerNight ?? null,
      priceBasis: starting?.displayedPriceBasis ?? null,
      priceSources: row.finalOffers.map((offer) => ({
        evidenceLevel: offer.evidenceLevel,
        source: cap(offer.sourceName),
        stayTotal: offer.stayTotal,
        taxesIncluded: offer.taxesIncluded === "included"
      })),
      startingNightly: starting?.startingAvgNightlyRate ?? null
    };
  });

  return {
    capability,
    refs,
    view: {
      awaitingFinalTotalCount: comparison.awaitingFinalTotalCount,
      budget: budget === null
        ? null
        : {
            amount: budget.amount,
            basis: budget.basis,
            basisAssumed: budget.basisAssumed,
            comparisonCeiling: budget.comparisonCeiling,
            flexibility: budget.flexibility
          },
      capturedAt: session.results.capturedAt,
      hotels,
      hotelCount: hotels.length,
      query: {
        adults: session.query.adults,
        checkIn: session.query.checkIn,
        checkOut: session.query.checkOut,
        city: session.query.city,
        cityAsAsked: session.query.cityAsAsked,
        currency: session.query.currency,
        hotelGroup: session.query.hotelGroup,
        priceMode: session.query.priceMode ?? "cash"
      },
      sessionId: session.id,
      summary: session.results.summary === null ? null : cap(session.results.summary),
      warning: session.results.warning === null ? null : cap(session.results.warning),
      withinBudgetCount: comparison.withinBudgetCount
    }
  };
}

/**
 * Every number the model was shown, for grounding what it writes back.
 *
 * Walks the view rather than taking a curated list, so a field added to a
 * projection above is covered without a second edit here — the failure mode of
 * a hand-maintained list is a legitimate number rejected as fabricated.
 *
 * Strings are read for digits too, and that is load-bearing rather than
 * thorough. Dates are strings: a view full of "2026-09-10" shows the model the
 * year 2026 and nothing here would know it. Writing "2026年9月" back then looks
 * like a fabricated four-figure amount, and a correct answer gets thrown away
 * for stating a date. A number the tools displayed is a number the model saw,
 * whatever the field's type happened to be.
 */
export function numbersInView(view: unknown, into: Set<number> = new Set()): Set<number> {
  if (typeof view === "number" && Number.isFinite(view)) {
    into.add(Math.abs(view));
    return into;
  }
  if (typeof view === "string") {
    for (const token of view.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) {
      const value = Number(token.replace(/,/g, ""));
      if (Number.isFinite(value)) {
        into.add(value);
      }
    }
    return into;
  }
  if (Array.isArray(view)) {
    for (const item of view) {
      numbersInView(item, into);
    }
    return into;
  }
  if (view !== null && typeof view === "object") {
    for (const value of Object.values(view)) {
      numbersInView(value, into);
    }
  }
  return into;
}

/** Below this, a number in prose is a night count or a room count, not money. */
const MONEY_FLOOR = 100;

/**
 * Rejects prose that states a figure the model was never shown.
 *
 * The model is instructed to point at rows rather than transcribe money, but an
 * instruction is not an enforcement, and a wrong price written confidently is
 * exactly the failure this product exists to prevent. So any money-sized number
 * in the narrative has to be one the tools produced, or a difference between two
 * of them — "saves 800" is arithmetic over shown figures and is legitimate.
 *
 * Small numbers pass: a night count, a party size, and a year are not prices,
 * and rejecting "3 nights" would make the check useless by making it noisy.
 */
export function ungroundedNumbers(narrative: string, shown: ReadonlySet<number>) {
  const allowed = new Set(shown);
  for (const first of shown) {
    for (const second of shown) {
      allowed.add(Math.abs(first - second));
      allowed.add(first + second);
    }
  }
  const written = narrative.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return written
    .map((token) => Number(token.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value) && value >= MONEY_FLOOR && !allowed.has(value));
}

function scalarsOf(result: unknown): Record<string, unknown> {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? (result as Record<string, unknown>)
    : {};
  const inner = source.profile && typeof source.profile === "object" ? (source.profile as Record<string, unknown>) : source;
  return Object.fromEntries(
    Object.entries(inner)
      .filter(([, value]) => value === null || ["boolean", "number", "string"].includes(typeof value))
      .map(([key, value]) => [key, typeof value === "string" ? cap(value) : value])
  );
}

function cap(value: string) {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > TEXT_CAP ? `${collapsed.slice(0, TEXT_CAP)}…` : collapsed;
}
