/*
 * Grounding for the one capability whose arguments a model can quietly get
 * wrong: hotel search.
 *
 * A wrong booking id fails loudly. A wrong date or a derived budget succeeds —
 * it returns real hotels at real prices for a stay the user never asked about,
 * which is the failure mode this product exists to prevent. So the two fields a
 * model is most tempted to compute are checked against the user's own wording
 * before the search runs.
 *
 * Extracted from the router so the agent loop (ADR 0005) enforces the same
 * rules. Two copies of a grounding check is two sets of gaps.
 */

import { addCalendarDays, extractDates, extractSearchQuery } from "@/lib/agent/searchQuery";
import { LlmError } from "@/lib/providers/llmClient";

export type ProposedCall = {
  args: unknown;
  capability: string;
};

/**
 * Grounds a proposed budget in the request, by checking the quote rather than
 * the number.
 *
 * This is the shape `llmEvidence.ts` already uses against a page snapshot: the
 * model reads freely but must cite the contiguous span it read from, and the
 * span is what gets verified. Checking the amount instead confuses two different
 * things — transcribing "一千" as 1000 creates no information and is legitimate,
 * while dividing a stay total by a night count creates a number the request
 * never contained. Matching digits would reject every spelled-out or non-Latin
 * amount, which is the wrong answer for a product whose entry point is natural
 * language.
 *
 * Arithmetic stays out of the model's hands for a separate and duller reason:
 * the product already holds the authoritative night count, so recomputing it
 * from a worse copy can only lose fidelity.
 */
export function assertGroundedSearchDates(output: ProposedCall, request: string, referenceDate: Date) {
  if (output.capability !== "search_hotels" || !output.args || typeof output.args !== "object") {
    return;
  }
  const args = output.args as Record<string, unknown>;
  const dates = extractDates(request);
  const extracted = extractSearchQuery(request, { referenceDate });
  for (const key of ["checkIn", "checkOut"] as const) {
    const value = args[key];
    if (typeof value !== "string") {
      continue;
    }
    const isExplicit = dates.includes(value);
    const isNormalizedFromUserWording = !isExplicit && extracted[key] === value;
    const isDerivedFromNights =
      key === "checkOut" &&
      extracted.checkIn !== undefined &&
      extracted.nights !== undefined &&
      addCalendarDays(extracted.checkIn, extracted.nights) === value;
    if (!isExplicit && !isNormalizedFromUserWording && !isDerivedFromNights) {
      throw new LlmError(
        "router_ungrounded_date",
        `The router returned ${key} ${value}, but that date was not stated by the user.`
      );
    }
  }
}

export function canonicalizeSearchArgs(output: ProposedCall, request: string, referenceDate: Date): ProposedCall {
  if (output.capability !== "search_hotels" || !output.args || typeof output.args !== "object") {
    return output;
  }
  const extracted = extractSearchQuery(request, { referenceDate });
  const args = { ...(output.args as Record<string, unknown>) };
  if (extracted.checkIn && args.checkIn === undefined) {
    args.checkIn = extracted.checkIn;
  }
  if (extracted.checkOut && args.checkOut === undefined) {
    args.checkOut = extracted.checkOut;
  }
  if (extracted.city) {
    args.city = extracted.city;
    args.cityAsAsked = extracted.cityAsAsked;
  }
  if (extracted.priceMode === "points") {
    args.priceMode = "points";
  }
  return { ...output, args };
}

export function assertGroundedSearchBudget(output: ProposedCall, request: string) {
  if (output.capability !== "search_hotels" || !output.args || typeof output.args !== "object") {
    return;
  }
  const args = output.args as Record<string, unknown>;
  if (args.budgetAmount === undefined || args.budgetAmount === null) {
    return;
  }
  const quote = typeof args.budgetQuote === "string" ? args.budgetQuote : "";
  if (quote.trim().length === 0) {
    throw new LlmError(
      "router_ungrounded_budget",
      "The router proposed a budget without quoting the wording it read the amount from."
    );
  }
  if (!normalizeForQuoteMatch(request).includes(normalizeForQuoteMatch(quote))) {
    throw new LlmError(
      "router_ungrounded_budget",
      `The router quoted “${quote}” as the budget wording, but that does not occur in the request.`
    );
  }

  /*
   * A real quote still leaves room to derive: citing "1000 USD per night" while
   * returning 4000 is a true citation of a fabricated number. So when the cited
   * wording writes its amount in digits, the amount must be one of them. When it
   * does not — "每晚预算一千元" — transcription is unavoidable and cannot be
   * verified here, but no digit inside the quote was multiplied either.
   *
   * One rule rather than a list of writing systems: the citation is checked
   * against itself, so nothing has to know how any language spells a thousand.
   */
  const amount = typeof args.budgetAmount === "string" ? Number(args.budgetAmount) : args.budgetAmount;
  const quotedNumbers = quote.match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  if (
    typeof amount === "number" &&
    quotedNumbers.length > 0 &&
    !quotedNumbers.some((token) => Number(token.replace(/,/g, "")) === amount)
  ) {
    throw new LlmError(
      "router_ungrounded_budget",
      `The router returned budgetAmount ${amount}, but the wording it quoted — “${quote}” — states a different number.`
    );
  }
}

/** Collapses whitespace only. A quote must otherwise be a verbatim span. */
function normalizeForQuoteMatch(value: string) {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Turns a parser message into something worth reading, in the language asked in.
 *
 * The parser's own wording names the argument that failed, which is the right
 * level of detail for a log and the wrong one for a person who simply forgot to
 * say which city.
 */
export function friendlySearchQuestion(error: string, request: string) {
  const chinese = /[\u3400-\u9fff]/.test(request);
  if (chinese) {
    if (error.includes("already passed")) {
      return "入住日期已经过去，请告诉我一个今天或之后的入住日期。";
    }
    if (error.includes('"city"') || error.includes('"cityAsAsked"')) {
      return "请告诉我想查哪个城市的酒店。";
    }
    if (error.includes('"checkIn"')) {
      return "请补充入住年份、入住日期，以及退房日期或入住晚数。例如：2026年9月1日住1晚。";
    }
    if (error.includes('"checkOut"')) {
      return "请告诉我退房日期，或告诉我准备住几晚。例如：住1晚。";
    }
    if (error.includes("must be after")) {
      return "入住日期必须早于退房日期，请重新告诉我这次入住的日期。";
    }
  }
  if (error.includes('"city"') || error.includes('"cityAsAsked"')) {
    return "Which city should I search?";
  }
  if (error.includes('"checkIn"')) {
    return "What is the check-in date, including the year, and what is the check-out date or length of stay?";
  }
  if (error.includes('"checkOut"')) {
    return "What is the check-out date, or how many nights will you stay?";
  }
  return error;
}
