export type BrowserEvidenceCandidateInput = {
  basePrice?: number | null;
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

const CASH_CURRENCIES = ["MYR", "RM", "USD", "JPY", "SGD", "HKD", "EUR", "GBP", "THB", "KRW", "CNY"];

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
  const nights = parseStayNights(sourceUrl);
  const finalTotal = extractFinalTotal(normalizedText);
  const finalTaxes = extractTaxesAndFees(normalizedText);

  if (finalTotal) {
    candidates.push({
      cancellationPolicyRaw: extractPolicyText(normalizedText),
      currency: finalTotal.currency,
      inventoryType: "cash",
      roomTypeRaw: extractRoomName(normalizedText),
      taxes: finalTaxes?.currency === finalTotal.currency ? finalTaxes.amount : null,
      taxesIncluded: true,
      totalPrice: finalTotal.amount
    });
  }

  if (!finalTotal) {
    for (const rate of extractNightlyRates(normalizedText)) {
      candidates.push({
        basePrice: rate.amount,
        cancellationPolicyRaw: extractPolicyText(rate.context),
        currency: rate.currency,
        inventoryType: "cash",
        ratePlanName: extractRateName(rate.context),
        roomTypeRaw: extractRoomName(rate.context),
        taxesIncluded: false,
        totalPrice: rate.amount * nights
      });
    }
  }

  for (const award of extractAwardRates(normalizedText)) {
    candidates.push({
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

  return dedupeCandidates(candidates);
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
    cancellationPolicyRaw: candidate.cancellationPolicyRaw?.trim() || "Policy not captured",
    currency: normalizeCurrency(candidate.currency),
    fees: numericOrNull(candidate.fees),
    inventoryType,
    pointsPrice,
    price: totalPrice ?? 0,
    ratePlanName: candidate.ratePlanName?.trim() || null,
    rawRateName: candidate.rawRateName?.trim() || candidate.ratePlanName?.trim() || null,
    roomTypeRaw: candidate.roomTypeRaw?.trim() || "Room not captured",
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
  return CASH_CURRENCIES.includes(normalized) ? normalized : normalized.slice(0, 3) || "USD";
}

function parseCapturedAt(value?: string | null) {
  if (!value) {
    return new Date();
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseStayNights(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const checkIn = url.searchParams.get("checkinDate");
    const checkOut = url.searchParams.get("checkoutDate");
    if (!checkIn || !checkOut) {
      return 1;
    }
    const start = new Date(`${checkIn}T00:00:00.000Z`);
    const end = new Date(`${checkOut}T00:00:00.000Z`);
    const nights = Math.round((end.getTime() - start.getTime()) / 86_400_000);
    return nights > 0 ? nights : 1;
  } catch {
    return 1;
  }
}

function extractFinalTotal(text: string) {
  const currencyPattern = CASH_CURRENCIES.join("|");
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

  return null;
}

function extractTaxesAndFees(text: string) {
  const currencyPattern = CASH_CURRENCIES.join("|");
  const pattern = new RegExp(`(?:Taxes? (?:&|and) Fees?|Fees? (?:&|and) Taxes?)\\s*(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "i");
  const match = text.match(pattern);
  return match ? { amount: parseAmount(match[2]), currency: normalizeCurrency(match[1]) } : null;
}

function extractNightlyRates(text: string) {
  const currencyPattern = CASH_CURRENCIES.join("|");
  const pattern = new RegExp(`(${currencyPattern})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "gi");
  const rates: Array<{ amount: number; context: string; currency: string }> = [];
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    rates.push({
      amount: parseAmount(match[2]),
      context: text.slice(Math.max(0, index - 700), Math.min(text.length, index + 900)),
      currency: normalizeCurrency(match[1])
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

function extractRoomName(text: string) {
  const candidates = [
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

function cleanLabel(value: string) {
  return value.replace(/\s+/g, " ").replace(/\s+\|.*$/, "").trim().slice(0, 180);
}

function parseAmount(value: string) {
  return Number(value.replace(/,/g, ""));
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
      candidate.roomTypeRaw ?? ""
    ].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(candidate);
    }
  }
  return result.slice(0, 12);
}
