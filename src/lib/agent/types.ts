/*
 * The capability contract.
 *
 * A capability is one thing the product can do, described well enough that an
 * intent router can pick it and validate its arguments without knowing anything
 * about Prisma, browser tasks, or React. Handlers reuse the existing domain
 * modules; nothing here reimplements business logic.
 *
 * Results must be JSON-serializable. They cross an SSE boundary in P2, so dates
 * are ISO strings rather than Date objects, and enums stay as their stored
 * values — resolving them to copy is the presentation layer's job, via
 * `@/lib/labels`.
 */

export type CapabilityParamType = "string" | "integer" | "number" | "calendar_date" | "enum";

export type CapabilityParam = {
  description: string;
  /** Present only when `type` is "enum". */
  enumValues?: readonly string[];
  name: string;
  required: boolean;
  type: CapabilityParamType;
};

/** User/assistant turns retained by the command bar for a clarification round. */
export type AgentConversationMessage = {
  content: string;
  role: "assistant" | "user";
};

type CapabilityBase<TArgs, TResult> = {
  /** One line, written to be read by the router and shown in the command bar. */
  summary: string;
  /**
   * The words a person would use for this action. Used by the deterministic
   * router when no model is configured, and included in the model's catalogue.
   * Required so a new capability cannot be unreachable by keyword alone.
   */
  keywords: readonly string[];
  name: string;
  params: readonly CapabilityParam[];
  /** Strict: rejects unknown keys, missing required values, and wrong types. */
  parseArgs(raw: unknown): TArgs;
  run(args: TArgs): Promise<TResult>;
};

/** Safe to run as soon as an intent is recognised. Reads only. */
type ReadCapability<TArgs, TResult> = CapabilityBase<TArgs, TResult> & {
  effect: "read";
};

/**
 * Opens a Hyatt tab through the Browser Companion. Two consequences, both
 * enforced rather than documented:
 *
 * - it needs explicit user confirmation unless it is explicitly marked as
 *   read-only, because the product never mutates anything without a press;
 * - it needs a route that owns its progress and error notices. The command bar
 *   closes when it runs a command, so a task fired from there would leave its
 *   result nowhere to land. `resultRoute` is where the caller must be standing.
 */
type BrowserTaskCapability<TArgs, TResult> = CapabilityBase<TArgs, TResult> & {
  effect: "browser_task";
  /** Read-only browser work may start from a user query without a second press. */
  confirmationRequired?: boolean;
  resultRoute(args: TArgs): string;
};

export type Capability<TArgs = never, TResult = unknown> =
  | ReadCapability<TArgs, TResult>
  | BrowserTaskCapability<TArgs, TResult>;

/** Erased form, for the registry: the arg type differs per capability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCapability = Capability<any, unknown>;

export function requiresConfirmation(capability: AnyCapability) {
  return capability.effect === "browser_task" && capability.confirmationRequired !== false;
}
