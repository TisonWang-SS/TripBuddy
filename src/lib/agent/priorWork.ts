/*
 * What this conversation has already collected.
 *
 * A search is the expensive thing this product does: it opens a tab, waits on a
 * page, and costs the user a press. Yet the loop used to forget it the moment
 * the turn ended — tool results live for one turn, and only the assistant's
 * prose survives into the next one. So "my budget is about 1000 a night", asked
 * straight after a search, could only be served by searching again, because
 * `set_search_budget` needs a session id that nothing carried forward.
 *
 * The fix is not a cache and not a new table. `HotelSearchSession` already
 * stores every result with its own `capturedAt`; what was missing was any way
 * for the model to know a session exists. This builds that: a short summary of
 * each session the conversation produced — what was asked, when it was
 * captured, how many hotels came back — handed to the planner alongside the
 * conversation.
 *
 * Deliberately a summary and not the results. The model gets enough to decide
 * between three moves, and takes one of them as an ordinary tool call:
 *
 *   - read it        → `get_hotel_search_session`
 *   - re-judge it    → `set_search_budget`
 *   - collect afresh → `search_hotels`, which still needs a press
 *
 * Nothing here forces reuse. A stale session is described as stale and the
 * model decides; the user asked for reliability over speed, and a price from
 * twenty minutes ago presented as current is the opposite of that.
 */

import { getHotelSearchSession, type HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";

/**
 * How long a captured search reads as current.
 *
 * A product-owned number, not a cache TTL: nothing is evicted when it passes,
 * and the session remains readable for its full storage life. It only changes
 * how the search is described to the model — and through it, what the model
 * tells the user about how current a price is.
 */
export const SEARCH_FRESHNESS_MINUTES = 15;

export type PriorSearch = {
  /** Minutes since capture, or null when nothing has been captured yet. */
  ageMinutes: number | null;
  checkIn: string;
  checkOut: string;
  city: string;
  currency: string;
  /** False once older than `SEARCH_FRESHNESS_MINUTES`. */
  fresh: boolean;
  hasBudget: boolean;
  hotelCount: number;
  priceMode: string;
  sessionId: string;
};

/**
 * Loads the sessions a conversation carries, newest capture first.
 *
 * Reads them back rather than trusting a client-supplied description: the
 * session may have gained a tax-inclusive total or a budget since it was last
 * seen, and an id that has expired should simply drop out rather than be
 * described from a stale copy.
 */
export async function loadPriorSearches(
  sessionIds: readonly string[] | undefined,
  now: () => number = () => Date.now()
): Promise<PriorSearch[]> {
  if (!sessionIds || sessionIds.length === 0) {
    return [];
  }
  /* Bounded: a long conversation should not grow the prompt without limit. */
  const recent = [...new Set(sessionIds)].slice(-5);
  const sessions = await Promise.all(recent.map((id) => getHotelSearchSession(id)));
  return sessions
    .filter((session): session is HotelSearchSessionSnapshot => session !== null)
    .map((session) => summarize(session, now()))
    .sort((left, right) => (left.ageMinutes ?? Infinity) - (right.ageMinutes ?? Infinity));
}

function summarize(session: HotelSearchSessionSnapshot, nowMs: number): PriorSearch {
  const capturedAt = session.results.capturedAt;
  const ageMinutes = capturedAt === null
    ? null
    : Math.max(0, Math.round((nowMs - new Date(capturedAt).getTime()) / 60_000));
  return {
    ageMinutes,
    checkIn: session.query.checkIn,
    checkOut: session.query.checkOut,
    city: session.query.cityAsAsked,
    currency: session.query.currency,
    fresh: ageMinutes !== null && ageMinutes <= SEARCH_FRESHNESS_MINUTES,
    hasBudget: session.query.budget !== null,
    hotelCount: session.results.hotels.length,
    priceMode: session.query.priceMode ?? "cash",
    sessionId: session.id
  };
}
