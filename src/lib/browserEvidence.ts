export type BrowserEvidenceCandidateInput = {
  basePrice?: number | null;
  breakfastIncluded?: boolean | null;
  cancellationPolicyRaw?: string | null;
  currency: string;
  fees?: number | null;
  inventoryType?: "award" | "cash";
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
  inventoryType: "award" | "cash";
  pointsPrice: number | null;
  price: number;
  ratePlanName: string | null;
  rawRateName: string | null;
  roomTypeRaw: string;
  taxes: number | null;
  taxesIncluded: boolean;
};

const CASH_CURRENCIES = ["MYR", "RM", "USD", "$", "JPY", "¥", "￥", "SGD", "HKD", "EUR", "GBP", "THB", "KRW", "CNY", "CN¥", "RMB"];

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
    return [];
  }

  if (finalTotal) {
    candidates.push({
      breakfastIncluded: false,
      cancellationPolicyRaw: extractPolicyText(detailTextForTotals),
      currency: finalTotal.currency,
      inventoryType: "cash",
      roomTypeRaw: extractHyattFinalRoomName(detailTextForTotals) ?? extractHyattDetailRoomName(detailTextForTotals) ?? extractRoomName(detailTextForTotals),
      taxes: finalTaxes?.currency === finalTotal.currency ? finalTaxes.amount : null,
      taxesIncluded: true,
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
    candidates.push({
      breakfastIncluded: hasBreakfastIncluded(award.context),
      cancellationPolicyRaw: extractPolicyText(award.context),
      currency: finalTotal?.currency ?? "USD",
      inventoryType: "award",
      pointsPrice: award.points,
      ratePlanName: extractRateName(award.context),
      roomTypeRaw: extractRoomName(award.context),
      taxesIncluded: false,
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
    currency: normalizeCurrency(candidate.currency),
    fees: numericOrNull(candidate.fees),
    inventoryType,
    pointsPrice,
    price: totalPrice ?? 0,
    ratePlanName: candidate.ratePlanName?.trim() || null,
    rawRateName: candidate.rawRateName?.trim() || candidate.ratePlanName?.trim() || null,
    roomTypeRaw: cleanRoomTypeLabel(candidate.roomTypeRaw?.trim() || "Room not captured"),
    taxes: numericOrNull(candidate.taxes),
    taxesIncluded: candidate.taxesIncluded === true || Boolean(candidate.taxes)
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

function normalizeCurrency(value: string) {
  const normalized = value.trim().toUpperCase();
  if (normalized === "RM") {
    return "MYR";
  }
  if (normalized === "$") {
    return "USD";
  }
  if (normalized === "RMB" || normalized === "CN¥" || normalized === "¥" || normalized === "￥") {
    return "CNY";
  }
  return CASH_CURRENCIES.includes(normalized) ? normalized : normalized.slice(0, 3) || "USD";
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
      return { amount: parseAmount(match[2]), currency: normalizeCurrency(match[1]) };
    }
  }

  const summaryMatch = text.match(/(?:Price Summary|Booking Summary)([^]{0,1600})/i);
  if (summaryMatch) {
    const summaryText = summaryMatch[1];
    const summaryTotalPattern = new RegExp(`(?:Grand total|(?<!Room\\s)Total)\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "gi");
    const summaryTotals = [...summaryText.matchAll(summaryTotalPattern)];
    const match = summaryTotals.at(-1);
    if (match) {
      return { amount: parseAmount(match[2]), currency: normalizeCurrency(match[1]) };
    }
  }

  return null;
}

function extractTaxesAndFees(text: string) {
  const currencyPattern = currencyPatternSource();
  const pattern = new RegExp(`(?:Taxes? (?:&|and) Fees?|Fees? (?:&|and) Taxes?)\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "i");
  const match = text.match(pattern);
  return match ? { amount: parseAmount(match[2]), currency: normalizeCurrency(match[1]) } : null;
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
      currency: normalizeCurrency(match[1]),
      ratePlanName: extractRateName(context),
      roomName: extractRoomName(context)
    });
  }
  return rates;
}

function extractAwardRates(text: string) {
  const pattern = /([0-9][0-9,]{3,8})\s*(?:points|pts)(?:\s*(?:Avg\s*\/\s*Night|point\s*\/\s*night|points\s*\/\s*night|pts\s*\/\s*night))?/gi;
  const rates: Array<{ context: string; points: number }> = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    rates.push({
      context: text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900)),
      points: Math.round(parseAmount(match[1]))
    });
  }
  return rates;
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
    currency: normalizeCurrency(match[2]),
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

function extractPolicyText(text: string) {
  const match = text.match(/((?:Cancellation|Cancel|Deposit|Refund)[^.]{0,260})/i);
  return match ? cleanLabel(match[1]) : "Policy not captured";
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
  return CASH_CURRENCIES.map(escapeRegExp).join("|");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  return result.slice(0, 12);
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
      normalizeCurrency(candidate.currency),
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
