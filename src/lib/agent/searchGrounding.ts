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

import { extractSearchQuery, groundedDateCandidates } from "@/lib/agent/searchQuery";
import { LlmError } from "@/lib/providers/llmClient";

export type ProposedCall = {
  args: unknown;
  capability: string;
};

/**
 * Checks a proposed search date against every date the request could produce.
 *
 * The rule is membership, not equality. An earlier version compared the model's
 * date to the one `extractSearchQuery` picked, which quietly made the
 * deterministic extractor the arbiter of how well a request can be read — and it
 * reads worse than the model, which is why the model is there. Live, that
 * rejected "9月1日到9月2日": grounding sees all user turns joined, the repeated
 * "9月1日" filled the second date slot, and a correct checkout was reported to
 * the user as a date they never stated.
 *
 * Enumerating candidates keeps the protection that matters. A year the request
 * never implies, a month it never names, or a checkout it gives no length for
 * are all still outside the set, and still refused.
 */
export function assertGroundedSearchDates(output: ProposedCall, request: string, referenceDate: Date) {
  if (output.capability !== "search_hotels" || !output.args || typeof output.args !== "object") {
    return;
  }
  const args = output.args as Record<string, unknown>;
  const candidates = groundedDateCandidates(request, referenceDate);
  for (const key of ["checkIn", "checkOut"] as const) {
    const value = args[key];
    if (typeof value !== "string") {
      continue;
    }
    if (!candidates.has(value)) {
      throw new LlmError(
        "router_ungrounded_date",
        `The router returned ${key} ${value}, which the request does not support. It states: ${[...candidates].sort().join(", ") || "no dates"}.`
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
