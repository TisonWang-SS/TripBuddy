import { explainRecommendation, getBooking, getPriceHistory, listBookings } from "@/lib/agent/capabilities/bookings";
import { importAccountBookings, listDueChecks, runPriceCheck } from "@/lib/agent/capabilities/checks";
import {
  getHotelOfferDetail,
  getSearchSession,
  getTaxInclusiveTotal,
  searchHotels,
  setSearchBudget
} from "@/lib/agent/capabilities/search";
import { getProfile, getSettings } from "@/lib/agent/capabilities/setup";
import { setWatchPlan } from "@/lib/agent/capabilities/watch";
import { type AnyCapability, type CapabilityParam, requiresConfirmation } from "@/lib/agent/types";

export class UnknownCapabilityError extends Error {
  readonly code = "unknown_capability";

  constructor(name: string) {
    super(`No capability named "${name}".`);
    this.name = "UnknownCapabilityError";
  }
}

export class ConfirmationRequiredError extends Error {
  readonly code = "confirmation_required";

  constructor(name: string) {
    super(`"${name}" changes something, so it needs explicit confirmation before it runs.`);
    this.name = "ConfirmationRequiredError";
  }
}

const CAPABILITIES: readonly AnyCapability[] = [
  listBookings,
  getBooking,
  getPriceHistory,
  explainRecommendation,
  listDueChecks,
  runPriceCheck,
  importAccountBookings,
  searchHotels,
  setSearchBudget,
  getTaxInclusiveTotal,
  getSearchSession,
  getHotelOfferDetail,
  setWatchPlan,
  getProfile,
  getSettings
];

const BY_NAME = new Map(CAPABILITIES.map((capability) => [capability.name, capability]));

export function listCapabilities() {
  return CAPABILITIES;
}

export function findCapability(name: string) {
  return BY_NAME.get(name) ?? null;
}

export function requireCapability(name: string) {
  const capability = findCapability(name);
  if (!capability) {
    throw new UnknownCapabilityError(name);
  }
  return capability;
}

export type CapabilityDescription = {
  effect: AnyCapability["effect"];
  keywords: readonly string[];
  name: string;
  params: readonly CapabilityParam[];
  summary: string;
};

/**
 * The router's view of what the product can do. Deliberately just names,
 * summaries, and parameter shapes — the model chooses a capability and supplies
 * arguments; it never sees handlers, data, or prices.
 */
export function describeCapabilities(): CapabilityDescription[] {
  return CAPABILITIES.map(({ effect, keywords, name, params, summary }) => ({ effect, keywords, name, params, summary }));
}

/**
 * Validates arguments without running anything. The event stream announces a
 * capability and its arguments before it executes, so it needs the parsed form
 * up front. `invokeCapability` parses again — the parsers are pure, and one
 * cheap repetition is better than a second place that could skip the guard.
 */
export function parseCapabilityArgs(name: string, rawArgs: unknown) {
  return requireCapability(name).parseArgs(rawArgs);
}

/** Where a capability's progress and result are meant to render, if anywhere. */
export function capabilityResultRoute(capability: AnyCapability, args: unknown) {
  return capability.effect === "browser_task" ? capability.resultRoute(args) : null;
}

/** True when running this capability needs a press first. Unknown names need one. */
export function requiresConfirmationByName(name: string) {
  const capability = findCapability(name);
  return capability === null || requiresConfirmation(capability);
}

/**
 * Whether the loop must stop and ask before running this.
 *
 * The same question as `requiresConfirmationByName`, named for what the loop is
 * deciding. Both a browser task and a write need a press, for different reasons
 * — one opens a window, the other changes stored data — and the loop should not
 * have to know which reason applies in order to honour it.
 */
export function needsPress(name: string) {
  return requiresConfirmationByName(name);
}

/** Every capability, split by whether running it changes anything. */
export function capabilityEffects() {
  return CAPABILITIES.map(({ effect, name }) => ({ effect, name, needsPress: requiresConfirmation({ effect } as AnyCapability) }));
}

/**
 * What a write is about to change, in the user's terms, or null for anything
 * that changes nothing. Product-owned copy: the capability writes it, not the
 * model, because a press must mean what the button said.
 */
export function describeCapabilityChange(name: string, args: unknown) {
  const capability = findCapability(name);
  return capability?.effect === "write" ? capability.describeChange(args) : null;
}

/** True when this capability opens a Hyatt tab, whether or not it needs a press. */
export function opensBrowserTab(name: string) {
  return findCapability(name)?.effect === "browser_task";
}

/**
 * Runs a capability's own pre-flight check, if it has one. Returns the question
 * to put to the user, or null when nothing stands in the way.
 */
export async function precheckCapability(name: string, args: unknown) {
  const capability = findCapability(name);
  return capability?.precheck ? capability.precheck(args) : null;
}

/**
 * Single entry point for running a capability.
 *
 * The confirmation guard lives here rather than in each handler so it cannot be
 * forgotten by a new capability. It asks `requiresConfirmation`, which reads the
 * effect — so a capability consents to being gated by declaring what it does,
 * not by remembering to opt in. Recognising an intent is never the same thing as
 * being allowed to mutate.
 *
 * This is the last gate, not the first. The loop stops and asks well before
 * reaching here; this exists so that a caller which does not — a future route, a
 * test, a script — cannot write by forgetting to.
 */
export async function invokeCapability(name: string, rawArgs: unknown, options: { confirmed?: boolean } = {}) {
  const capability = requireCapability(name);
  const args = capability.parseArgs(rawArgs);
  if (requiresConfirmation(capability) && options.confirmed !== true) {
    throw new ConfirmationRequiredError(name);
  }
  return { args, capability, result: await capability.run(args) };
}
