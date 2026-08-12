import { explainRecommendation, getBooking, getPriceHistory, listBookings } from "@/lib/agent/capabilities/bookings";
import { importAccountBookings, listDueChecks, runPriceCheck } from "@/lib/agent/capabilities/checks";
import { getSearchSession, searchHotels } from "@/lib/agent/capabilities/search";
import { getProfile, getSettings } from "@/lib/agent/capabilities/setup";
import type { AnyCapability, CapabilityParam } from "@/lib/agent/types";

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
    super(`"${name}" opens a browser tab and needs explicit confirmation before it runs.`);
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
  getSearchSession,
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

/**
 * Single entry point for running a capability.
 *
 * The confirmation guard lives here rather than in each handler so it cannot be
 * forgotten by a new capability: anything that opens a browser tab refuses to
 * run until the caller passes `confirmed`. Recognising an intent is never the
 * same thing as being allowed to act on it.
 */
export async function invokeCapability(name: string, rawArgs: unknown, options: { confirmed?: boolean } = {}) {
  const capability = requireCapability(name);
  const args = capability.parseArgs(rawArgs);
  if (capability.effect === "browser_task" && options.confirmed !== true) {
    throw new ConfirmationRequiredError(name);
  }
  return { args, capability, result: await capability.run(args) };
}
