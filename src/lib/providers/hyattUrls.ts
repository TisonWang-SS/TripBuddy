/*
 * Hyatt URL shapes, in one place.
 *
 * Both the launch-URL builder and the navigation planner need to recognise a
 * link that leads to one hotel's rates. Keeping the patterns here is what lets
 * the planner identify a search result by where a control goes rather than by
 * what its label says — a label changes with sign-in state and with Hyatt's
 * copy, while the destination is the thing that actually makes a control the
 * one worth clicking.
 */

const HOTEL_CODE_PATTERNS: readonly RegExp[] = [
  /\/hotel\/[^/]+\/[^/]+\/([a-z0-9]{4,6})(?:[/?#]|$)/i,
  /\/[a-z-]+\/[a-z]{2}-[A-Z]{2}\/([a-z0-9]{4,6})-[^/?#]+/i,
  /\/shop\/rooms\/([a-z0-9]{4,6})(?:[/?#]|$)/i
];

export function extractHyattHotelCode(value?: string | null) {
  if (!value) {
    return null;
  }
  for (const pattern of HOTEL_CODE_PATTERNS) {
    const match = value.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }
  return /^[a-z0-9]{4,6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

/**
 * Whether a link points at one hotel's own pages, as opposed to a bare hotel
 * code that happens to look like one.
 *
 * `extractHyattHotelCode` deliberately accepts a naked code because the booking
 * form stores one, but a control's `href` is only a search result when it
 * carries a real Hyatt hotel path.
 */
export function isHyattHotelPageUrl(value?: string | null) {
  if (!value) {
    return false;
  }
  return HOTEL_CODE_PATTERNS.some((pattern) => pattern.test(value));
}
