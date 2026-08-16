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

export type CapabilityParamType = "string" | "integer" | "number" | "boolean" | "calendar_date" | "enum";

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

/**
 * What a pre-flight check found, and who should hear about it.
 *
 * A plain string is for the user and ends the turn: the condition is one only
 * they can resolve — a budget currency the search is not priced in — and the
 * wording is product-owned so it cannot be softened into "I could convert that
 * for you".
 *
 * `retryable` is for the model and does not end anything. The call was wrong in
 * a way the model can fix by itself, most often a stale row reference, and
 * handing it the reason lets it correct course inside the same turn instead of
 * turning a recoverable mistake into a wall.
 */
export type PrecheckResult = string | { retryable: string } | null;

type CapabilityBase<TArgs, TResult> = {
  /** One line, written to be read by the router and shown in the command bar. */
  summary: string;
  /**
   * An async check for conditions `parseArgs` cannot see, run before the user is
   * asked to confirm anything. Returns the question to put to them, or null.
   *
   * This exists because a stored fact can make an otherwise valid call
   * impossible — a budget in a currency the search is not priced in, say. Left
   * to the handler, that surfaces after the press: the user has already agreed,
   * a blank tab is already open, and what they get back is a wall. Asked here,
   * it is a question they can answer.
   */
  precheck?(args: TArgs): Promise<PrecheckResult>;
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
 * Changes stored data without opening a browser.
 *
 * The third effect exists because the first two do not divide the space. A
 * browser task is confirmed for two separate reasons — it opens a visible tab,
 * and it changes something — and until now anything that changed stored data
 * had to borrow the tab to inherit the press. That is why the agent could not
 * be given a watch plan or a baseline: the only gate available also demanded a
 * Hyatt window it had no use for.
 *
 * Confirmation is unconditional here, with no opt-out. A read that turns out
 * wrong is re-read; a write that turns out wrong has already happened, and the
 * user is the only one who can say it was wanted.
 */
type WriteCapability<TArgs, TResult> = CapabilityBase<TArgs, TResult> & {
  /** What the press is agreeing to, in the user's terms. Product-owned copy. */
  describeChange(args: TArgs): string;
  effect: "write";
};

/**
 * Opens a Hyatt tab through the Browser Companion.
 *
 * It runs without a separate press. Asking for a search *is* the initiation —
 * requiring a button as well made every price question a two-step exchange, and
 * a confirmation that always arrives and is always accepted stops being consent
 * and becomes friction. The tab is still visible and still opened in the user's
 * own Chrome; what went away is the second click. See ADR 0007.
 *
 * It still needs a route that owns its progress and error notices: a task fired
 * from a surface that then closes would leave its result nowhere to land.
 */
type BrowserTaskCapability<TArgs, TResult> = CapabilityBase<TArgs, TResult> & {
  effect: "browser_task";
  resultRoute(args: TArgs): string;
};

export type Capability<TArgs = never, TResult = unknown> =
  | ReadCapability<TArgs, TResult>
  | WriteCapability<TArgs, TResult>
  | BrowserTaskCapability<TArgs, TResult>;

/** Erased form, for the registry: the arg type differs per capability. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCapability = Capability<any, unknown>;

/**
 * Whether running this needs a press first.
 *
 * Only a write does. A browser task reads — a search, a price check, an account
 * import — and reading on request is what the user asked for; a write changes
 * stored state that they would have to undo by hand.
 *
 * Stated as one function over the effect rather than checked at each call site,
 * because "does this need consent" is exactly the question a new capability
 * must not be able to answer for itself by omission.
 */
export function requiresConfirmation(capability: AnyCapability) {
  return capability.effect === "write";
}

/** True when running this changes stored data or the outside world. */
export function mutates(capability: AnyCapability) {
  return capability.effect !== "read";
}
