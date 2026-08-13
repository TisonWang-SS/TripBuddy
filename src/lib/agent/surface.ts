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
import type { HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import type { Tone } from "@/lib/labels";

export const SURFACE_VERSION = "tripbuddy-surface-1";

export type FactItem = {
  label: string;
  value: string;
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
  | { component: "Facts"; key: string; props: { items: readonly FactItem[]; title: string } };

export type SurfaceComponent = SurfaceNode["component"];

export type Surface = {
  nodes: readonly SurfaceNode[];
  surfaceId: string;
  version: typeof SURFACE_VERSION;
};

/** Nodes that present evidence the reader must see before acting. */
const EVIDENCE_COMPONENTS: readonly SurfaceComponent[] = ["EvidenceIssues", "RecommendationPanel"];

/** Nodes carrying a control that changes stored data. */
const ACTION_COMPONENTS: readonly SurfaceComponent[] = ["BaselineAction"];

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
    ? result as { launchUrl?: unknown; searchSessionId?: unknown }
    : {};
  const route = capability === "search_hotels" && typeof launch.searchSessionId === "string"
    ? `${resultRoute}?sessionId=${encodeURIComponent(launch.searchSessionId)}`
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
    case "get_hotel_search_session": {
      const { session } = result as { session: HotelSearchSessionSnapshot | null };
      return session
        ? [{ component: "HotelSearchResults", key: "hotel-search", props: { session } }]
        : [{ component: "Message", key: "missing", props: { text: "That hotel search session was not found or has expired.", tone: "caution" } }];
    }
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
