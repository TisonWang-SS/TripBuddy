/*
 * What one turn leaves behind for the next.
 *
 * The agent server holds no conversation. Each turn is a fresh request, so
 * everything a turn learns dies with it — and that single fact caused the same
 * class of bug three separate times:
 *
 * - a search the user had just paid for could not be reused, because its
 *   session id existed only inside the turn that made it;
 * - a figure the assistant had stated a moment ago was rejected as fabricated,
 *   because grounding only knew this turn's tool results;
 * - a row reference like `b1` resolved to nothing a turn later, so "why keep
 *   it?" was answered with "which booking do you mean?" about the one booking
 *   just listed.
 *
 * Each was patched separately: one by threading session ids through the client,
 * one by re-reading the transcript, one by telling the model to list again.
 * Three mechanisms for one missing concept.
 *
 * This is the concept. The client stores it and hands it back untouched — it
 * never reads or constructs one — and the server decides what goes in. That
 * keeps the client honest by ignorance: it cannot invent a mapping it does not
 * understand the shape of.
 *
 * It is deliberately small. Anything that can be re-read from the database is
 * re-read, so what lives here is only what would otherwise be unrecoverable:
 * which rows were shown, and which searches this conversation produced.
 */

/** Bounded so a long conversation cannot grow a request without limit. */
const MAX_REFS = 40;
const MAX_SESSIONS = 5;

export type TurnMemory = {
  /**
   * Row anchors from earlier turns: `b1` to a booking id, `h3` to a hotel key.
   *
   * Carrying these across turns does not widen what the model may act on. It
   * was shown these rows, in this conversation, and a client could always have
   * sent any identifier directly — the projection's job is to keep identifiers
   * out of the *model's* context, which it still does.
   */
  refs?: Readonly<Record<string, string>>;
  /** Searches this conversation has produced, oldest first. */
  searchSessionIds?: readonly string[];
};

export const EMPTY_TURN_MEMORY: TurnMemory = {};

/**
 * Reads a memory off the wire, keeping only what has the right shape.
 *
 * Written to survive nonsense rather than to reject it. A memory arrives from a
 * client that may be older than this server, or may have stored a version of it
 * from a previous deploy; a malformed entry should cost that entry, not the turn.
 */
export function parseTurnMemory(raw: unknown): TurnMemory {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_TURN_MEMORY;
  }
  const { refs, searchSessionIds } = raw as { refs?: unknown; searchSessionIds?: unknown };
  return {
    refs: readRefs(refs),
    searchSessionIds: readIds(searchSessionIds)
  };
}

/**
 * Folds what this turn learned into what it already knew.
 *
 * Newer wins on a collision, because a ref is positional: after a second
 * `list_bookings`, `b1` means the first row of *that* list. Keeping the older
 * mapping would silently point a fresh reference at a stale row.
 */
export function rememberTurn(
  before: TurnMemory,
  learned: { refs?: Readonly<Record<string, string>>; searchSessionIds?: readonly string[] }
): TurnMemory {
  const refs = { ...(before.refs ?? {}), ...(learned.refs ?? {}) };
  const sessions = [...(before.searchSessionIds ?? []), ...(learned.searchSessionIds ?? [])];
  return {
    refs: trimRefs(refs),
    searchSessionIds: [...new Set(sessions)].slice(-MAX_SESSIONS)
  };
}

function readRefs(value: unknown) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0 && entry[0].length > 0
  );
  return trimRefs(Object.fromEntries(entries));
}

function readIds(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(-MAX_SESSIONS)
    : [];
}

/** Keeps the most recently added refs, which are the ones a follow-up means. */
function trimRefs(refs: Record<string, string>) {
  const entries = Object.entries(refs);
  return entries.length <= MAX_REFS ? refs : Object.fromEntries(entries.slice(-MAX_REFS));
}
