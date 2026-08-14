import type { PointsBasis } from "@prisma/client";
import { HYATT_CURRENCY_PATTERN, normalizeHyattCurrency } from "@/lib/providers/hyattCurrency";

export type BrowserEvidenceCandidateInput = {
  basePrice?: number | null;
  breakfastIncluded?: boolean | null;
  cancellationPolicyRaw?: string | null;
  currency: string;
  fees?: number | null;
  feesIncluded?: boolean | null;
  inventoryType?: "award" | "cash";
  pointsBasis?: PointsBasis;
  pointsPrice?: number | null;
  ratePlanName?: string | null;
  rawRateName?: string | null;
  roomTypeRaw?: string | null;
  taxes?: number | null;
  taxesIncluded?: boolean | null;
  totalPrice?: number | null;
};

export type BrowserEvidencePayload = {
  bookingId?: string | null;
  candidates?: BrowserEvidenceCandidateInput[];
  capturedAt?: string | null;
  hotelGroup?: string | null;
  pageText?: string | null;
  pageTitle?: string | null;
  sourceUrl?: string | null;
};

export type NormalizedBrowserEvidenceCandidate = {
  basePrice: number | null;
  breakfastIncluded: boolean;
  cancellationPolicyRaw: string;
  currency: string;
  fees: number | null;
  feesIncluded: boolean | null;
  inventoryType: "award" | "cash";
  pointsBasis: PointsBasis;
  pointsPrice: number | null;
  ratePlanName: string | null;
  rawRateName: string | null;
  roomTypeRaw: string;
  taxes: number | null;
  taxesIncluded: boolean | null;
  totalPrice: number | null;
};

export function normalizeBrowserEvidencePayload(payload: BrowserEvidencePayload) {
  const candidates = (payload.candidates ?? [])
    .map(normalizeBrowserEvidenceCandidate)
    .filter((candidate): candidate is NormalizedBrowserEvidenceCandidate => candidate !== null);

  return {
    bookingId: payload.bookingId?.trim() || null,
    candidates,
    capturedAt: parseCapturedAt(payload.capturedAt),
    hotelGroup: payload.hotelGroup?.trim() || "Hyatt",
    pageText: payload.pageText?.slice(0, 12000) ?? "",
    pageTitle: payload.pageTitle?.trim() || null,
    sourceUrl: payload.sourceUrl?.trim() || null
  };
}

export function parseHyattEvidenceFromText(text: string, sourceUrl: string) {
  return parseHyattEvidenceFromTextWithMetadata(text, sourceUrl).candidates;
}

export function parseHyattEvidenceFromTextWithMetadata(text: string, sourceUrl: string) {
  const candidates: BrowserEvidenceCandidateInput[] = [];
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const [roomListText, detailText] = normalizedText.split("__TRIPBUDDY_FINAL_DETAIL_PAGE__").map((part) => part.trim());
  const listTextForEstimates = detailText ? roomListText : normalizedText;
  const detailTextForTotals = detailText || normalizedText;
  const nights = parseStayNights(sourceUrl, normalizedText);
  const finalTotal = extractFinalTotal(detailTextForTotals);
  const finalTaxes = extractTaxesAndFees(detailTextForTotals);
  const detailRateCandidates = detailText || /Choose Your Rate/i.test(normalizedText) ? extractHyattDetailRateCandidates(detailTextForTotals, nights) : [];

  if (isHyattSearchPageUrl(sourceUrl) && !detailText && !finalTotal && detailRateCandidates.length === 0) {
    return { candidates: [], truncated: false };
  }

  if (finalTotal) {
    candidates.push({
      breakfastIncluded: false,
      cancellationPolicyRaw: extractPolicyText(detailTextForTotals),
      currency: finalTotal.currency,
      inventoryType: "cash",
      roomTypeRaw: extractHyattFinalRoomName(detailTextForTotals) ?? extractHyattDetailRoomName(detailTextForTotals) ?? extractRoomName(detailTextForTotals),
      fees: finalTaxes?.currency === finalTotal.currency ? finalTaxes.amount : null,
      feesIncluded: finalTaxes && finalTaxes.currency === finalTotal.currency ? true : null,
      taxesIncluded: finalTaxes && finalTaxes.currency === finalTotal.currency ? true : null,
      totalPrice: finalTotal.amount
    });
  }

  if (!finalTotal && detailRateCandidates.length === 0) {
    for (const rate of extractHyattVisibleRateCandidates(listTextForEstimates)) {
      candidates.push({
        basePrice: rate.amount,
        breakfastIncluded: rate.breakfastIncluded,
        cancellationPolicyRaw: extractPolicyText(rate.context),
        currency: rate.currency,
        feesIncluded: false,
        inventoryType: "cash",
        ratePlanName: rate.ratePlanName,
        roomTypeRaw: rate.roomName,
        taxesIncluded: false,
        totalPrice: rate.amount * nights
      });
    }
  }

  if (!finalTotal) {
    candidates.push(...detailRateCandidates);
  }

  for (const award of extractAwardRates(normalizedText)) {
    /*
     * A free-night award is payable in points alone, so a nightly figure times
     * the nights is the whole price — there is no tax still to be discovered,
     * which is what makes this different from a nightly cash rate and is why
     * this one does not need to be walked to a payment summary.
     *
     * Points plus cash is not completable this way. Its cash half is quoted
     * before tax exactly like any other nightly cash rate, so it stays a
     * nightly figure and anything comparing spans refuses it.
     */
    /*
     * Read from the card rather than from which regex happened to match: the
     * same 12,000 is printed twice on an expanded card, and deduplication
     * keeps whichever came first, so a rule that depended on the matching
     * pattern decided the price by accident.
     */
    const wholeStay = award.kind === "free_night" && inferPointsBasis(award) === "per_night";
    candidates.push({
      breakfastIncluded: hasBreakfastIncluded(award.context),
      cancellationPolicyRaw: extractPolicyText(award.context),
      currency: finalTotal?.currency ?? "USD",
      feesIncluded: wholeStay ? true : false,
      inventoryType: "award",
      pointsBasis: wholeStay ? "stay_total" : inferPointsBasis(award),
      pointsPrice: wholeStay ? award.points * nights : award.points,
      ratePlanName: extractRateName(award.context),
      roomTypeRaw: extractAwardRoomName(award.precedingText) ?? extractRoomName(award.context),
      taxesIncluded: wholeStay ? true : false,
      totalPrice: 0
    });
  }

  return dedupeCandidates(mergeSimilarCashCandidates(candidates));
}

function normalizeBrowserEvidenceCandidate(candidate: BrowserEvidenceCandidateInput) {
  const inventoryType = candidate.inventoryType === "award" ? "award" : "cash";
  const totalPrice = numericOrNull(candidate.totalPrice);
  const pointsPrice = integerOrNull(candidate.pointsPrice);
  if (inventoryType === "cash" && totalPrice === null) {
    return null;
  }
  if (inventoryType === "award" && pointsPrice === null && totalPrice === null) {
    return null;
  }

  return {
    basePrice: numericOrNull(candidate.basePrice),
    breakfastIncluded: candidate.breakfastIncluded === true || hasBreakfastIncluded(candidate.ratePlanName ?? ""),
    cancellationPolicyRaw: candidate.cancellationPolicyRaw?.trim() || "Policy not captured",
    currency: normalizeHyattCurrency(candidate.currency),
    fees: numericOrNull(candidate.fees),
    feesIncluded: candidate.feesIncluded === true || Boolean(candidate.fees) ? true : candidate.feesIncluded === false ? false : null,
    inventoryType,
    /* Only the two definite values are trusted; anything else, including a
     * value a model proposed, falls back to the refusing default. */
    pointsBasis: candidate.pointsBasis === "per_night" || candidate.pointsBasis === "stay_total"
      ? candidate.pointsBasis
      : "unknown",
    pointsPrice,
    ratePlanName: candidate.ratePlanName?.trim() || null,
    rawRateName: candidate.rawRateName?.trim() || candidate.ratePlanName?.trim() || null,
    roomTypeRaw: cleanRoomTypeLabel(candidate.roomTypeRaw?.trim() || "Room not captured"),
    taxes: numericOrNull(candidate.taxes),
    taxesIncluded: candidate.taxesIncluded === true || Boolean(candidate.taxes) ? true : candidate.taxesIncluded === false ? false : null,
    totalPrice
  };
}

function numericOrNull(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function integerOrNull(value: unknown) {
  const parsed = numericOrNull(value);
  return parsed === null ? null : Math.round(parsed);
}

function parseCapturedAt(value?: string | null) {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseStayNights(sourceUrl: string, text?: string) {
  return parseStayNightsFromUrl(sourceUrl) ?? parseStayNightsFromText(text) ?? 1;
}

function parseStayNightsFromText(text?: string) {
  if (!text) {
    return null;
  }
  const match = text.match(/\b([1-9][0-9]?)\s*(?:Night|Nights|Night Stay|Night Total|晚)\b/i);
  if (!match) {
    return null;
  }
  const nights = Number(match[1]);
  return Number.isInteger(nights) && nights > 0 ? nights : null;
}

function parseStayNightsFromUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const checkIn = url.searchParams.get("checkinDate");
    const checkOut = url.searchParams.get("checkoutDate");
    if (!checkIn || !checkOut) {
      return null;
    }
    const start = new Date(`${checkIn}T00:00:00.000Z`);
    const end = new Date(`${checkOut}T00:00:00.000Z`);
    const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return nights > 0 ? nights : null;
  } catch {
    return null;
  }
}

function isHyattSearchPageUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return /(^|\.)hyatt\.com$/i.test(url.hostname) && /\/search\/hotels\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function extractFinalTotal(text: string) {
  const currencyPattern = currencyPatternSource();
  const patterns = [
    new RegExp(`(?:Total Cash|Stay Total|Total for Stay|Grand Total|Amount Due|Total Including Taxes[^A-Z]{0,20})\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "i"),
    new RegExp(`(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\s*(?:Total Cash|Stay Total|Total for Stay|Grand Total|Amount Due)`, "i")
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return { amount: parseAmount(match[2]), currency: normalizeHyattCurrency(match[1]) };
    }
  }

  const summaryMatch = text.match(/(?:Price Summary|Booking Summary)([^]{0,1600})/i);
  if (summaryMatch) {
    const summaryText = summaryMatch[1];
    const summaryTotalPattern = new RegExp(`(?:Grand total|(?<!Room\\s)Total)\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "gi");
    const summaryTotals = [...summaryText.matchAll(summaryTotalPattern)];
    const match = summaryTotals.at(-1);
    if (match) {
      return { amount: parseAmount(match[2]), currency: normalizeHyattCurrency(match[1]) };
    }
  }

  return null;
}

function extractTaxesAndFees(text: string) {
  const currencyPattern = currencyPatternSource();
  const pattern = new RegExp(`(?:Taxes? (?:&|and) Fees?|Fees? (?:&|and) Taxes?)\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "i");
  const match = text.match(pattern);
  return match ? { amount: parseAmount(match[2]), currency: normalizeHyattCurrency(match[1]) } : null;
}

function extractHyattVisibleRateCandidates(text: string) {
  const currencyPattern = currencyPatternSource();
  const pattern = new RegExp(`(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "gi");
  const rates: Array<{ amount: number; breakfastIncluded: boolean; context: string; currency: string; ratePlanName: string | null; roomName: string }> = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    const context = text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900));
    rates.push({
      amount: parseAmount(match[2]),
      breakfastIncluded: hasBreakfastIncluded(context),
      context,
      currency: normalizeHyattCurrency(match[1]),
      ratePlanName: extractRateName(context),
      roomName: extractRoomName(context)
    });
  }
  return rates;
}

/*
 * Two shapes, because Hyatt writes award prices two ways.
 *
 * The obvious one puts the unit next to the number. The room list does not:
 * it renders "From World of Hyatt Free Night Award 12,000 +1 more rates
 * Points/Night", so the amount is separated from its unit by the rate count.
 * Reading only the adjacent form returned nothing at all from a page that was
 * entirely award rates, which is how a points check looked like a hotel with
 * no award availability.
 */
const ADJACENT_AWARD_PATTERN = /([0-9][0-9,]{3,8})\s*(?:points|pts)(\s*(?:Avg\s*\/\s*Night|point\s*\/\s*night|points\s*\/\s*night|pts\s*\/\s*night))?/gi;
/* Anchored on the unit label itself, which is the one thing that makes the
 * number a points figure rather than any other four-digit number nearby. */
const UNIT_LABELLED_AWARD_PATTERN = /([0-9][0-9,]{3,8})(?=.{0,40}?Points\s*\/\s*Night)/gi;

/*
 * Which award a figure belongs to, decided by the label that introduces it.
 *
 * One Hyatt card offers both: "World of Hyatt Free Night Award from 12,000"
 * and "Points Plus Cash from 6,000 + $91". They are not interchangeable —
 * the second buys the same night for half the points because the rest is
 * cash — so reading the numbers without their labels makes a points-plus-cash
 * rate look like an extraordinarily cheap redemption.
 */
function classifyAwardRate(precedingText: string, followingText: string): "free_night" | "points_plus_cash" | "unknown" {
  /*
   * Keyed on the shape of the quote rather than on the nearest label. Both
   * awards are printed on one card, so the label before a number belongs to
   * whichever rate was named last, which is not the same thing as the rate
   * this number states. A points-plus-cash quote always carries its cash half
   * immediately behind it — "6,000 + $91" — and nothing else does.
   */
  /* The currency mark is required: "+1 more rates" is a rate count, not cash. */
  if (/^.{0,12}?\+\s*[^\s0-9]{1,3}\s*[0-9]/.test(followingText)) {
    return "points_plus_cash";
  }
  return /Free\s*Night\s*Award|World\s*of\s*Hyatt/i.test(precedingText) ? "free_night" : "unknown";
}

function extractAwardRates(text: string) {
  const rates: Array<{
    context: string;
    kind: ReturnType<typeof classifyAwardRate>;
    perNightSuffix: boolean;
    points: number;
    precedingText: string;
  }> = [];
  const seen = new Set<number>();
  for (const [pattern, perNightByLabel] of [
    [ADJACENT_AWARD_PATTERN, false],
    [UNIT_LABELLED_AWARD_PATTERN, true]
  ] as const) {
    for (const match of text.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (seen.has(index)) {
        continue;
      }
      seen.add(index);
      rates.push({
        context: text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900)),
        kind: classifyAwardRate(
          text.slice(Math.max(0, index - 90), index),
          text.slice(index + match[1].length, index + match[1].length + 24)
        ),
        perNightSuffix: perNightByLabel || Boolean(match[2]),
        points: Math.round(parseAmount(match[1])),
        precedingText: text.slice(Math.max(0, index - 700), index)
      });
    }
  }
  return rates;
}

/*
 * Whether a points figure covers the stay or one night, and nothing in between.
 *
 * "25,000 points" is the identical string on a room list, where it is nightly,
 * and on an award summary, where it is the whole stay. Getting this wrong does
 * not blur a comparison against cash, it reverses it, so anything short of a
 * visible statement resolves to `unknown` and the comparison refuses.
 */
function inferPointsBasis(award: { context: string; perNightSuffix: boolean }): PointsBasis {
  if (award.perNightSuffix || /(?:Avg\s*\/\s*Night|Average\s*\/\s*Night|per\s*night|\/\s*night)/i.test(award.context)) {
    return "per_night";
  }
  if (/Total\s+Points|Points\s+Total|Total\s+Awards?|Points\s+Due|Points\s+Required|Redeem(?:ing)?\s+[0-9]/i.test(award.context)) {
    return "stay_total";
  }
  return "unknown";
}

function extractHyattDetailRateCandidates(text: string, nights: number) {
  const detailBlock = extractFirstHyattRateDetailBlock(text);
  if (!/Choose Your Rate/i.test(detailBlock)) {
    return [];
  }
  const roomName = extractHyattDetailRoomName(detailBlock) ?? extractRoomName(detailBlock);
  const policy = extractPolicyText(detailBlock);
  const currencyPattern = currencyPatternSource();
  const pattern = new RegExp(
    `\\b(Members Save More|Member Rate|Standard Rate|Member Bed and Breakfast|Bed and Breakfast)\\s+(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\b`,
    "gi"
  );

  return [...detailBlock.matchAll(pattern)].map((match) => ({
    basePrice: parseAmount(match[3]),
    breakfastIncluded: hasBreakfastIncluded(match[1]),
    cancellationPolicyRaw: policy,
    currency: normalizeHyattCurrency(match[2]),
    inventoryType: "cash" as const,
    ratePlanName: cleanLabel(match[1]),
    roomTypeRaw: roomName,
    taxesIncluded: false,
    totalPrice: parseAmount(match[3]) * nights
  }));
}

function extractHyattDetailRoomName(text: string) {
  const match = text.match(/SELECT & BOOK\s+(.{3,90}?)\s+Hyatt [^]{0,500}?Choose Your Rate/i);
  return match ? cleanLabel(match[1]) : null;
}

function extractHyattFinalRoomName(text: string) {
  const roomPattern =
    "[0-9]\\s+(?:King|Queen|Twin|Double)[A-Za-z0-9 ,/-]{0,50}?(?:Bed|Beds)(?:,\\s*Balcony)?|[A-Z][A-Za-z0-9 ,/-]{0,50}\\s+Suite";
  const patterns = [
    new RegExp(`\\b(${roomPattern})\\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),`, "i"),
    new RegExp(`SELECT & BOOK\\s+(${roomPattern})\\s+Hyatt\\b`, "i"),
    new RegExp(`\\b(${roomPattern})\\s+Hyatt\\b`, "i")
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return cleanRoomTypeLabel(match[1]);
    }
  }

  return null;
}

function extractFirstHyattRateDetailBlock(text: string) {
  const startMatch = text.match(/SELECT & BOOK\s+.{3,90}?\s+Hyatt [^]{0,500}?Choose Your Rate/i);
  const start = startMatch?.index ?? text.search(/Choose Your Rate/i);
  if (start < 0) {
    return text;
  }
  const rest = text.slice(start);
  const endMatch = rest.match(/JOIN WHILE YOU BOOK\s+SIGN IN & BOOK/i);
  return endMatch?.index && endMatch.index > 0 ? rest.slice(0, endMatch.index) : rest;
}

function extractRoomName(text: string) {
  const candidates = [
    /(?:SELECT & BOOK\s+)?([0-9]\s+(?:King|Queen|Twin)[A-Za-z0-9 ,/-]{0,50}?(?:Bed|Beds)(?:,\s*Balcony)?)\s+(?:Work|Enjoy|Relax|Unwind|View Room Details|Hyatt Place|Choose Your Rate|Members|Member Rate|Standard Rate)/i,
    /(?:Room|Suite)\s+([A-Z][A-Za-z0-9 ,/-]{4,90})/,
    /([A-Z][A-Za-z0-9 ,/-]{4,90}(?:Room|Suite|King|Queen|Twin|Bed))/,
    /(Standard [A-Za-z0-9 ,/-]{3,80})/
  ];

  for (const pattern of candidates) {
    const match = text.match(pattern);
    if (match) {
      return cleanLabel(match[1]);
    }
  }

  return "Hyatt room";
}

/*
 * The room heading that introduces an award, taken as the last room-shaped
 * phrase before the price. The generic extractor reads a window around the
 * figure and on a points room list that window is mostly Hyatt's booking
 * furniture, which produced room names like "ECT 1 King Bed" and "CREDIT CARD
 * REQUIRED Sign In or Join to book SELECT 1 King Bed" — labels that no longer
 * match the same room captured on the cash side.
 */
function extractAwardRoomName(precedingText: string) {
  /*
   * Searched behind the figure only. A card's heading precedes its price, so
   * looking at the window on both sides picked up the *next* room's heading
   * and paired every price with the wrong room — the club room's 34,000 came
   * back labelled as the standard king.
   */
  const pattern = /([0-9]\s+(?:King|Queen|Twin|Double)\s+Beds?(?:\s+with\s+[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)?)?)/g;
  const matches = [...precedingText.matchAll(pattern)];
  return matches.length > 0 ? cleanLabel(matches[matches.length - 1][1]) : null;
}

function extractRateName(text: string) {
  const patterns = [
    /(Members Save More[^.]{0,80})/i,
    /(Members Save[^.]{0,80})/i,
    /(Member Rate with Breakfast[^.]{0,80})/i,
    /(Bed and Breakfast[^.]{0,80})/i,
    /(Breakfast Rate[^.]{0,80})/i,
    /(Member Rate[^.]{0,80})/i,
    /(Standard Rate[^.]{0,80})/i,
    /(Advance Purchase[^.]{0,80})/i,
    /(Flexible Rate[^.]{0,80})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return cleanLabel(match[1]);
    }
  }
  return null;
}

/*
 * Bounded at the card it belongs to.
 *
 * Hyatt's flattened room list has no sentence punctuation, so a policy read
 * "until the next full stop" ran on into the following room's card. The terms
 * decide whether an award is comparable at all, so text from a different room
 * must not be able to reach that judgement.
 */
const POLICY_CARD_BOUNDARY =
  /\b(?:Sign In or Join to book|SELECT\s*&\s*BOOK|View Room Details|Choose Your Rate|Looking for room details|[0-9]\s+(?:King|Queen|Twin|Double)\s+Beds?)\b/i;

function extractPolicyText(text: string) {
  const match = text.match(/((?:Cancellation|Cancel|Deposit|Refund)[^.]{0,260})/i);
  if (!match) {
    return "Policy not captured";
  }
  const boundary = match[1].search(POLICY_CARD_BOUNDARY);
  return cleanLabel(boundary > 0 ? match[1].slice(0, boundary) : match[1]);
}

function hasBreakfastIncluded(text: string) {
  return /\b(?:breakfast included|includes breakfast|with breakfast|bed and breakfast|breakfast rate)\b/i.test(text) &&
    !/\b(?:breakfast available|breakfast excluded|without breakfast|no breakfast)\b/i.test(text);
}

function cleanLabel(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/^BOOK\s+/i, "")
    .replace(/\s+\|.*$/, "")
    .trim()
    .slice(0, 180);
}

function cleanRoomTypeLabel(value: string) {
  const label = cleanLabel(value)
    .replace(/\s+(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat),\s+[A-Za-z]{3}\s+\d{1,2},\s+\d{4}.*$/i, "")
    .replace(/\s+\d+\s+Room(?:s)?$/i, "")
    .trim();

  if (!label || /Room not captured/i.test(label)) {
    return "Room not captured";
  }

  const concisePatterns = [
    /\b([0-9]\s+(?:King|Queen|Twin|Double)[A-Za-z0-9 ,/-]{0,50}?(?:Bed|Beds)(?:,\s*Balcony)?)\b/i,
    /\b([A-Z][A-Za-z0-9 ,/-]{0,50}\s+Suite)\b/
  ];

  for (const pattern of concisePatterns) {
    const match = label.match(pattern);
    if (match && (/Hyatt|,\s*(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)|\d+\s+Room/i.test(label) || label.length > 70)) {
      return cleanLabel(match[1]);
    }
  }

  return label;
}

function parseAmount(value: string) {
  return Number(value.replace(/,/g, ""));
}

function currencyPatternSource() {
  return HYATT_CURRENCY_PATTERN;
}

function dedupeCandidates(candidates: BrowserEvidenceCandidateInput[]) {
  const seen = new Set<string>();
  const result: BrowserEvidenceCandidateInput[] = [];
  for (const candidate of candidates) {
    const key = [
      candidate.inventoryType ?? "cash",
      candidate.currency,
      candidate.totalPrice ?? "",
      candidate.pointsPrice ?? "",
      candidate.basePrice ?? "",
      candidate.roomTypeRaw ?? "",
      candidate.ratePlanName ?? ""
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return { candidates: result.slice(0, 12), truncated: result.length > 12 };
}

function mergeSimilarCashCandidates(candidates: BrowserEvidenceCandidateInput[]) {
  const byComparablePrice = new Map<string, BrowserEvidenceCandidateInput>();
  const result: BrowserEvidenceCandidateInput[] = [];

  for (const candidate of candidates) {
    if ((candidate.inventoryType ?? "cash") !== "cash" || candidate.basePrice === undefined || candidate.basePrice === null) {
      result.push(candidate);
      continue;
    }

    const key = [
      normalizeHyattCurrency(candidate.currency),
      candidate.basePrice,
      candidate.totalPrice ?? "",
      cleanLabel(candidate.roomTypeRaw ?? ""),
      candidate.breakfastIncluded ? "breakfast" : "room-only"
    ].join("|");
    const existing = byComparablePrice.get(key);
    if (!existing) {
      byComparablePrice.set(key, candidate);
      result.push(candidate);
      continue;
    }

    const preferred = preferBrowserEvidenceCandidate(existing, candidate);
    byComparablePrice.set(key, preferred);
    const index = result.indexOf(existing);
    if (index >= 0) {
      result[index] = preferred;
    }
  }

  return result;
}

function preferBrowserEvidenceCandidate(a: BrowserEvidenceCandidateInput, b: BrowserEvidenceCandidateInput) {
  const aPolicyScore = a.cancellationPolicyRaw && !/Policy not captured/i.test(a.cancellationPolicyRaw) ? 1 : 0;
  const bPolicyScore = b.cancellationPolicyRaw && !/Policy not captured/i.test(b.cancellationPolicyRaw) ? 1 : 0;
  if (aPolicyScore !== bPolicyScore) {
    return bPolicyScore > aPolicyScore ? b : a;
  }
  const aNameScore = a.ratePlanName && !/Avg\/Night|SELECT & BOOK/i.test(a.ratePlanName) ? 1 : 0;
  const bNameScore = b.ratePlanName && !/Avg\/Night|SELECT & BOOK/i.test(b.ratePlanName) ? 1 : 0;
  return bNameScore > aNameScore ? b : a;
}
