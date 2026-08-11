/*
 * Argument parsing for capabilities.
 *
 * Deliberately strict, for the same reason `parseCandidate` in
 * providers/llmEvidence.ts is strict: these arguments will arrive from a
 * language model in P3. Silently dropping an unrecognised key, or coercing
 * "next tuesday" into a date, turns a model mistake into a wrong answer that
 * looks right. Everything unexpected raises instead.
 */

export class CapabilityArgsError extends Error {
  readonly code = "invalid_args";

  constructor(message: string) {
    super(message);
    this.name = "CapabilityArgsError";
  }
}

const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function argsBag(raw: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (raw === null || raw === undefined) {
    return {};
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return failure("Arguments must be an object.");
  }
  const bag = raw as Record<string, unknown>;
  const unknown = Object.keys(bag).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    return failure(`Unexpected argument(s): ${unknown.join(", ")}.`);
  }
  return bag;
}

export function requireString(bag: Record<string, unknown>, key: string) {
  const value = optionalString(bag, key);
  if (value === undefined) {
    return failure(`"${key}" is required.`);
  }
  return value;
}

export function optionalString(bag: Record<string, unknown>, key: string) {
  const value = bag[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  if (typeof value !== "string") {
    return failure(`"${key}" must be a string.`);
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function optionalInteger(bag: Record<string, unknown>, key: string) {
  const value = bag[key];
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  /* Accept the string form: a model emitting JSON often quotes numbers. */
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed)) {
    return failure(`"${key}" must be a whole number.`);
  }
  return parsed;
}

/**
 * Calendar dates only, never a parsed natural-language phrase. The product
 * stores check-in/check-out at UTC midnight and compares them as calendar days;
 * accepting anything looser here would put timezone drift into the query.
 */
export function requireCalendarDate(bag: Record<string, unknown>, key: string) {
  const value = requireString(bag, key);
  if (!CALENDAR_DATE.test(value)) {
    return failure(`"${key}" must be a calendar date formatted YYYY-MM-DD.`);
  }
  if (Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    return failure(`"${key}" is not a real date.`);
  }
  return value;
}

export function optionalEnum<T extends string>(bag: Record<string, unknown>, key: string, allowed: readonly T[]) {
  const value = optionalString(bag, key);
  if (value === undefined) {
    return undefined;
  }
  if (!allowed.includes(value as T)) {
    return failure(`"${key}" must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function failure(message: string): never {
  throw new CapabilityArgsError(message);
}
