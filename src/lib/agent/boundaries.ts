/*
 * The product boundary, stated once.
 *
 * Two refusals sit in front of every path that reads a user's sentence — the
 * single-shot router (ADR 0002) and the agent loop (ADR 0005). They live here
 * rather than in either caller because a boundary with two implementations is a
 * boundary with two sets of gaps, and this one is load-bearing: it is what keeps
 * a chat box from implying a general travel agent.
 *
 * Both refusals are deterministic and run before the model does. A model never
 * gets the opportunity to route "cancel my booking", and never gets to write the
 * sentence describing what this product is.
 */

/** Signals that the request is outside what this product does. */
export const UNSUPPORTED_CAPABILITY = "unsupported";

/*
 * Product-owned copy. The model may explain why one particular request cannot be
 * served — that is ADR 0005 — but the description of the product itself is
 * fixed, because a model writing this sentence is how an interface ends up
 * promising flights it cannot book.
 */
export const UNSUPPORTED_MESSAGE =
  "TripBuddy only tracks Hyatt hotel bookings. It can list your stays, explain a verdict, run a price check, " +
  "search a city, or import your account — but not flights, trains, cars, or anything outside Hyatt.";

export const NEVER_ACTS_MESSAGE =
  "TripBuddy never books, cancels, pays for, confirms, or modifies a reservation. It can show you the evidence and " +
  "stamp a verdict, but changing a booking stays on the hotel's own site.";

/*
 * The product boundary, stated in the PRD: TripBuddy never books, cancels, pays
 * for, confirms, or modifies a reservation. Asking for one of those is refused
 * deterministically, before any routing path runs — the same shape as the
 * Browser Companion's unsafe-control rules, which the server enforces rather
 * than trusting the page.
 */
const NEVER_ACTS_PATTERNS: readonly RegExp[] = [
  /\bcancel(s|led|ling|ing)?\b/,
  /\brefund\b/,
  /\b(pay|pays|paying|payment|prepay)\b/,
  /\b(book|books|booking|reserve|reserves|reserving)\s+(me|us|it|a|an|the|my|this)\b/,
  /\bmake\s+(a|the)\s+(reservation|booking)\b/,
  /\bconfirm\s+(my|the|this)\s+(reservation|booking|stay)\b/,

  /*
   * Chinese. `\b` must not appear below: JavaScript defines it against `\w`,
   * which is ASCII, so there is never a boundary between two CJK characters and
   * every pattern using one silently fails to match. That is why this refusal
   * was absent from the Chinese entry point rather than merely incomplete.
   *
   * These are deliberately narrower than their English counterparts, because
   * the two directions of error are not symmetric here. The product has no
   * booking capability at all, so a request that slips through reaches a
   * search — a wrong answer, not a booking. A false refusal, by contrast, turns
   * a legitimate question into a wall. Several of the obvious keywords are load
   * bearing elsewhere in the product and must keep working: 取消政策 is a core
   * evidence field, 延迟退房 is an entitlement, and 预订 as a noun is simply
   * what a stay is called. So each pattern requires a verb reading, not a word.
   */
  /(帮|替|给|请)\s*我?\s*(预订|预定|订)/,
  /(预订|预定|订)\s*(一)?\s*(间|个|晚|下)/,
  /(预订|预定|订)\s*(房|酒店|旅馆|民宿)/,
  /取消\s*(我(的|在)?|这个|那个|该)?\s*[^，。；？!,.?]{0,12}?(预订|预定|订单|房间|入住)/,
  /(退款|退钱|退费)/,
  /(支付|付款|付钱|缴费|预付|扣款|下单)/,
  /确认\s*(我的|这个|该)?\s*(预订|预定|订单)/
];

/** Returns product-owned refusal copy when the request asks for an action this product does not take. */
export function refusedAction(text: string) {
  return NEVER_ACTS_PATTERNS.some((pattern) => pattern.test(text)) ? NEVER_ACTS_MESSAGE : null;
}
