/*
 * Surface composition.
 *
 * A surface is a declarative description of what to render: an ordered list of
 * nodes that name a component from a fixed catalogue and carry its props. The
 * client renders it with its own trusted components — the payload is data, never
 * markup and never code. That is the A2UI security model, and it is the same
 * rule this codebase already applies to page text and to model proposals.
 *
 * Surfaces are composed here, on the server, from capability results. A model
 * chooses which capability runs (ADR 0002); it does not choose what the answer
 * looks like. That distinction is load-bearing rather than stylistic: this
 * product's substance is money comparison and an audit trail, and the
 * "Presentation" section of docs/PRD.md requires evidence to be shown before
 * any control that changes a baseline.
 * Composing deterministically is what lets that ordering be enforced in code
 * instead of hoped for.
 *
 * Nodes are a flat ordered list rather than a tree. Nesting would buy layout
 * flexibility the product does not need yet, and would cost the two properties
 * that matter here: ordering rules stay trivial to state, and there is no
 * recursion depth to bound when rendering.
 */

import type { BookingSummary, ObservationRecord, RecommendationExplanation } from "@/lib/agent/capabilities/bookings";
import type { DueCheck } from "@/lib/agent/capabilities/checks";
import { compareHotelSearchSession } from "@/lib/hotelSearchComparison";
import type { HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import type { Tone } from "@/lib/labels";

export const SURFACE_VERSION = "tripbuddy-surface-1";

export type FactItem = {
  label: string;
  value: string;
};

/**
 * One recommendation. The model supplied `reason` and nothing else on this
 * object: the label, the money, and the caveat are read from the stored result
 * the pick points at.
 *
 * That split is the whole safety argument for letting a model advise (ADR 0005).
 * It can be wrong about which hotel suits someone — a judgement the user can see
 * and disagree with — but it cannot be wrong about what that hotel costs.
 */
export type AdvicePick = {
  amount: number | null;
  /** How to read `amount`: a nightly starting rate is not a stay total. */
  amountBasis: "per_night" | "stay_total" | "points_per_night" | null;
  currency: string | null;
  href: string | null;
  label: string;
  /** Product-owned caveat, such as an unverified tax-inclusive total. */
  note: string | null;
  reason: string;
};

export type RunRecord = {
  finishedAt: string | null;
  runId: string;
  startedAt: string;
  status: string;
  summary: string | null;
  trigger: string;
};

/**
 * The catalogue. A node's `component` is one of these names and nothing else,
 * so the renderer is a closed switch rather than a lookup that could be talked
 * into resolving something new.
 */
export type SurfaceNode =
  | { component: "Message"; key: string; props: { text: string; tone: Tone } }
  | { component: "BookingList"; key: string; props: { bookings: readonly BookingSummary[]; title: string } }
  | { component: "DueQueue"; key: string; props: { due: readonly DueCheck[] } }
  | { component: "EvidenceIssues"; key: string; props: { blockers: readonly string[]; warnings: readonly string[] } }
  | {
      component: "RecommendationPanel";
      key: string;
      props: { bookingId: string; recommendation: RecommendationExplanation };
    }
  /** Changes the stored baseline. Never composed before its evidence. */
  | { component: "BaselineAction"; key: string; props: { bookingId: string; label: string } }
  | { component: "PriceHistory"; key: string; props: { observations: readonly ObservationRecord[]; runs: readonly RunRecord[] } }
  | { component: "TaskLaunch"; key: string; props: { capability: string; launchUrl: string | null; resultRoute: string } }
  | { component: "HotelSearchResults"; key: string; props: { session: HotelSearchSessionSnapshot } }
  /** Model-written reasoning beside product-written figures. See `AdvicePick`. */
  | { component: "Advice"; key: string; props: { narrative: string; picks: readonly AdvicePick[] } }
  /** Names a browser task the user has not yet agreed to start. */
  | { component: "ConfirmAction"; key: string; props: { args: unknown; capability: string; detail: string; label: string } }
  | { component: "Facts"; key: string; props: { items: readonly FactItem[]; title: string } };

export type SurfaceComponent = SurfaceNode["component"];

export type Surface = {
  nodes: readonly SurfaceNode[];
  surfaceId: string;
  version: typeof SURFACE_VERSION;
};

/** Nodes that present evidence the reader must see before acting. */
const EVIDENCE_COMPONENTS: readonly SurfaceComponent[] = ["EvidenceIssues", "RecommendationPanel"];

/** Nodes carrying a control that changes stored data or opens a Hyatt tab. */
const ACTION_COMPONENTS: readonly SurfaceComponent[] = ["BaselineAction", "ConfirmAction"];

export class SurfaceContractError extends Error {
  readonly code = "surface_contract_violated";

  constructor(message: string) {
    super(message);
    this.name = "SurfaceContractError";
  }
}

/**
 * The "Presentation" section of docs/PRD.md, enforced rather than merely
 * documented: blockers and warnings render before any control that changes a
 * baseline. Composition is the only place this can be guaranteed, which is
 * precisely why composition is not delegated.
 */
export function assertEvidencePrecedesActions(nodes: readonly SurfaceNode[]) {
  const firstAction = nodes.findIndex((node) => ACTION_COMPONENTS.includes(node.component));
  if (firstAction === -1) {
    return nodes;
  }
  const evidenceAfterAction = nodes
    .slice(firstAction)
    .some((node) => EVIDENCE_COMPONENTS.includes(node.component));
  if (evidenceAfterAction) {
    throw new SurfaceContractError(
      'Evidence must be composed before any control that changes a baseline; see the "Presentation" section of docs/PRD.md.'
    );
  }
  return nodes;
}

export function buildSurface(surfaceId: string, nodes: readonly SurfaceNode[]): Surface {
  return { nodes: assertEvidencePrecedesActions(nodes), surfaceId, version: SURFACE_VERSION };
}

/**
 * Turns a capability result into a surface.
 *
 * Returns null when a capability has no rendered form yet, so the caller can
 * fall through to its own presentation rather than this inventing one.
 *
 * `resultRoute` is set only for a capability that opens a browser tab, and it is
 * what makes one renderable at all: the launch itself is the whole result, so
 * without it a confirmed run answers with a blank panel.
 */
export function composeCapabilitySurface(
  capability: string,
  result: unknown,
  surfaceId: string,
  resultRoute: string | null = null
): Surface | null {
  const nodes = resultRoute === null ? composeNodes(capability, result) : composeLaunchNodes(capability, result, resultRoute);
  return nodes === null ? null : buildSurface(surfaceId, nodes);
}

/**
 * Every browser task returns a launch, whatever else it returns, so this is
 * composed from the shape all three share rather than per capability.
 */
function composeLaunchNodes(capability: string, result: unknown, resultRoute: string): SurfaceNode[] {
  const launch = result && typeof result === "object"
    ? result as { launchUrl?: unknown; searchSessionId?: unknown; taskId?: unknown }
    : {};
  const routeParams = new URLSearchParams();
  if (capability === "search_hotels" && typeof launch.searchSessionId === "string") {
    routeParams.set("sessionId", launch.searchSessionId);
  }
  if (capability === "search_hotels" && typeof launch.taskId === "string") {
    routeParams.set("taskId", launch.taskId);
  }
  const route = routeParams.size > 0
    ? `${resultRoute}${resultRoute.includes("?") ? "&" : "?"}${routeParams.toString()}`
    : resultRoute;
  return [
    {
      component: "TaskLaunch",
      key: "launch",
      props: { capability, launchUrl: typeof launch.launchUrl === "string" ? launch.launchUrl : null, resultRoute: route }
    }
  ];
}

/** The Hyatt URL a surface says was launched, for a client holding a tab open for it. */
export function launchUrlOf(surface: Surface | null) {
  const launch = surface?.nodes.find(
    (node): node is Extract<SurfaceNode, { component: "TaskLaunch" }> => node.component === "TaskLaunch"
  );
  return launch?.props.launchUrl ?? null;
}

export function composeMessageSurface(surfaceId: string, text: string, tone: Tone = "neutral"): Surface {
  return buildSurface(surfaceId, [{ component: "Message", key: "message", props: { text, tone } }]);
}

/** What a `ref` in a model's recommendation can point at. */
export type AdviceSource = {
  bookings: readonly BookingSummary[];
  hotelSession: HotelSearchSessionSnapshot | null;
  /** Ref anchor to stored identifier, merged across the tools this run used. */
  refs: Readonly<Record<string, string>>;
};

/**
 * Composes model reasoning and product figures into one node.
 *
 * A pick whose ref no longer resolves is dropped rather than rendered with an
 * empty price. The narrative survives on its own — losing a row is a smaller
 * failure than showing a recommendation with nothing behind it.
 */
export function composeAdviceSurface(
  surfaceId: string,
  narrative: string,
  picks: readonly { reason: string; ref: string }[],
  source: AdviceSource
): Surface {
  const resolved = picks
    .map((pick) => resolvePick(pick, source))
    .filter((pick): pick is AdvicePick => pick !== null);
  return buildSurface(surfaceId, [
    { component: "Advice", key: "advice", props: { narrative, picks: resolved } }
  ]);
}

function resolvePick(pick: { reason: string; ref: string }, source: AdviceSource): AdvicePick | null {
  const identifier = source.refs[pick.ref];
  if (identifier === undefined) {
    return null;
  }

  const booking = source.bookings.find((entry) => entry.bookingId === identifier);
  if (booking) {
    return {
      amount: booking.baselineCashTotal,
      amountBasis: booking.baselineCashTotal === null ? null : "stay_total",
      currency: booking.currency,
      href: `/bookings/${booking.bookingId}`,
      label: booking.hotelName,
      note: null,
      reason: pick.reason
    };
  }

  const hotel = source.hotelSession?.results.hotels.find((entry) => entry.hotelKey === identifier);
  if (!hotel || !source.hotelSession) {
    return null;
  }
  const row = compareHotelSearchSession(source.hotelSession).rows.find((entry) => entry.hotel.hotelKey === identifier);
  const final = row?.finalOffer ?? null;
  const starting = row?.startingOffer ?? null;

  /*
   * A verified tax-inclusive total is the only figure that can answer "does this
   * fit my budget". Anything else is labelled as what it is, on the row itself,
   * so a recommendation can never read as settled when its price is a starting
   * rate that excludes taxes and fees.
   */
  if (final?.stayTotal !== null && final?.stayTotal !== undefined) {
    return {
      amount: final.stayTotal,
      amountBasis: "stay_total",
      currency: final.currency,
      href: `/hotel-search?sessionId=${encodeURIComponent(source.hotelSession.id)}`,
      label: hotel.hotelName,
      note: null,
      reason: pick.reason
    };
  }
  if (starting?.startingPointsPerNight !== null && starting?.startingPointsPerNight !== undefined) {
    return {
      amount: starting.startingPointsPerNight,
      amountBasis: "points_per_night",
      currency: null,
      href: `/hotel-search?sessionId=${encodeURIComponent(source.hotelSession.id)}`,
      label: hotel.hotelName,
      note: "Starting award rate. Room and rate-plan equivalence are not verified.",
      reason: pick.reason
    };
  }
  return {
    amount: starting?.startingAvgNightlyRate ?? null,
    amountBasis: starting?.startingAvgNightlyRate === null || starting === null ? null : "per_night",
    currency: starting?.currency ?? null,
    href: `/hotel-search?sessionId=${encodeURIComponent(source.hotelSession.id)}`,
    label: hotel.hotelName,
    note: "Starting price, before taxes and fees. A final total is still needed to settle a budget.",
    reason: pick.reason
  };
}

/** The card that asks for the press a browser task cannot start without. */
export function composeConfirmSurface(
  surfaceId: string,
  input: { args: unknown; capability: string; detail: string; label: string }
): Surface {
  return buildSurface(surfaceId, [{ component: "ConfirmAction", key: "confirm", props: input }]);
}

function composeNodes(capability: string, result: unknown): SurfaceNode[] | null {
  switch (capability) {
    case "list_bookings": {
      const { bookings } = result as { bookings: readonly BookingSummary[] };
      return bookings.length === 0
        ? [{ component: "Message", key: "empty", props: { text: "Nothing on the desk yet.", tone: "neutral" } }]
        : [{ component: "BookingList", key: "bookings", props: { bookings, title: "Stays" } }];
    }
    case "get_booking": {
      const { booking } = result as { booking: BookingSummary | null };
      return booking
        ? [{ component: "BookingList", key: "booking", props: { bookings: [booking], title: booking.hotelName } }]
        : [{ component: "Message", key: "missing", props: { text: "That booking was not found.", tone: "caution" } }];
    }
    case "list_due_checks": {
      const { due } = result as { due: readonly DueCheck[] };
      return due.length === 0
        ? [{ component: "Message", key: "empty", props: { text: "Nothing is due for a check.", tone: "positive" } }]
        : [{ component: "DueQueue", key: "due", props: { due } }];
    }
    case "explain_recommendation": {
      const { recommendation } = result as { recommendation: RecommendationExplanation | null };
      if (!recommendation) {
        return [
          {
            component: "Message",
            key: "none",
            props: { text: "No verdict has been stamped for that booking yet.", tone: "neutral" }
          }
        ];
      }
      /*
       * Order is the contract: the panel, then its blockers and warnings, and
       * only then the control that would change the baseline.
       */
      return [
        {
          component: "RecommendationPanel",
          key: "verdict",
          props: { bookingId: "", recommendation }
        },
        {
          component: "EvidenceIssues",
          key: "evidence",
          props: { blockers: recommendation.blockers, warnings: recommendation.warnings }
        }
      ];
    }
    case "get_price_history": {
      const { observations, runs } = result as { observations: readonly ObservationRecord[]; runs: readonly RunRecord[] };
      return observations.length === 0 && runs.length === 0
        ? [{ component: "Message", key: "empty", props: { text: "No checks have been recorded yet.", tone: "neutral" } }]
        : [{ component: "PriceHistory", key: "history", props: { observations, runs } }];
    }
    case "get_profile": {
      const { profile } = result as { profile: Record<string, unknown> | null };
      return profile
        ? [{ component: "Facts", key: "profile", props: { items: factsFrom(profile), title: "Profile" } }]
        : [{ component: "Message", key: "none", props: { text: "No traveler profile exists yet.", tone: "caution" } }];
    }
    case "get_settings": {
      const settings = result as Record<string, unknown>;
      return [{ component: "Facts", key: "settings", props: { items: factsFrom(settings), title: "Settings" } }];
    }
    /*
     * Applying a budget re-judges every row against it, so the results are shown
     * again rather than merely reported as updated: the budget column is the
     * whole point of having asked, and a card that only says "done" leaves the
     * reader to go find what changed.
     */
    case "set_search_budget":
    case "get_hotel_search_session": {
      const { session } = result as { session: HotelSearchSessionSnapshot | null };
      return session
        ? [{ component: "HotelSearchResults", key: "hotel-search", props: { session } }]
        : [{ component: "Message", key: "missing", props: { text: "That hotel search session was not found or has expired.", tone: "caution" } }];
    }
    /*
     * Browser tasks the loop waited out. Their evidence lands in the booking's
     * own records, so the conversation says what happened and points there —
     * restating a stored verdict here would be a second copy that can drift.
     */
    case "run_price_check":
      return [
        {
          component: "Message",
          key: "checked",
          props: { text: "The price check finished. Its evidence and verdict are on the booking.", tone: "positive" }
        }
      ];
    case "set_watch_plan": {
      const { hotelName, watching } = result as { hotelName: string; watching: boolean };
      return [
        {
          component: "Message",
          key: "watch",
          props: {
            text: watching
              ? `Watching ${hotelName}. Checks still wait for your press; nothing runs on its own.`
              : `No longer watching ${hotelName}. Everything already recorded is kept.`,
            tone: "positive"
          }
        }
      ];
    }
    case "import_account_bookings":
      return [
        {
          component: "Message",
          key: "imported",
          props: { text: "The Hyatt account import finished. Your stays are on the desk.", tone: "positive" }
        }
      ];
    default:
      return null;
  }
}

/** Flattens a scalar record into label/value pairs, skipping nested structures. */
function factsFrom(source: Record<string, unknown>): FactItem[] {
  return Object.entries(source)
    .filter(([, value]) => value === null || ["boolean", "number", "string"].includes(typeof value))
    .map(([key, value]) => ({ label: humanizeKey(key), value: value === null ? "Not set" : String(value) }));
}

function humanizeKey(key: string) {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
