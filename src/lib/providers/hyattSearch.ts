import { HYATT_CURRENCY_TOKENS, normalizeHyattCurrency } from "@/lib/providers/hyattCurrency";

export type HyattCitySearchQuery = {
  adults: number;
  checkIn: string;
  checkOut: string;
  city: string;
  currency: string;
};

export type HyattCityRateResult = {
  availabilityLabel: string;
  avgNightlyRate: number;
  currency: string;
  hotelName: string;
  locationLabel: string | null;
  priceBasis: string;
  sourceUrl: string;
};

export type HyattCitySearchRun = {
  capturedAt: Date;
  results: HyattCityRateResult[];
  searchUrl: string;
  status: "succeeded" | "partial" | "failed";
  summary: string;
  warning: string | null;
};

export function normalizeHyattCitySearchQuery(input: Partial<HyattCitySearchQuery>) {
  const adults = Number(input.adults ?? 2);
  const query = {
    adults: Number.isInteger(adults) && adults > 0 ? adults : 2,
    checkIn: String(input.checkIn ?? "").trim(),
    checkOut: String(input.checkOut ?? "").trim(),
    city: String(input.city ?? "").trim(),
    currency: normalizeHyattCurrency(String(input.currency ?? "USD"))
  };

  const errors: string[] = [];
  if (!query.city) {
    errors.push("City is required.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(query.checkOut)) {
    errors.push("Check-in and check-out dates are required.");
  } else if (new Date(`${query.checkOut}T00:00:00.000Z`) <= new Date(`${query.checkIn}T00:00:00.000Z`)) {
    errors.push("Check-out must be after check-in.");
  }

  return { errors, query };
}

export function buildHyattCitySearchUrl(query: HyattCitySearchQuery) {
  const params = new URLSearchParams({
    adults: String(query.adults),
    accessibilityCheck: "false",
    checkinDate: query.checkIn,
    checkoutDate: query.checkOut,
    currency: query.currency,
    kids: "0",
    rate: "Standard",
    rooms: "1"
  });
  return `https://www.hyatt.com/search/hotels/en-US/${encodeURIComponent(query.city)}?${params.toString()}`;
}

export function parseHyattCitySearchCards(cardTexts: string[], sourceUrl: string): HyattCityRateResult[] {
  const results = cardTexts.flatMap((text) => parseHyattCitySearchText(text, sourceUrl));
  return dedupeHyattCityRateResults(results);
}

function parseHyattCitySearchText(text: string, sourceUrl: string): HyattCityRateResult[] {
  const compactText = text.replace(/\s+/g, " ").trim();
  const explicitCard = parseHyattCitySearchCard(compactText, sourceUrl);
  const pageResults = parseHyattCitySearchPageText(compactText, sourceUrl);
  return pageResults.length > 0 ? pageResults : explicitCard ? [explicitCard] : [];
}

function parseHyattCitySearchPageText(text: string, sourceUrl: string) {
  const pricePattern = new RegExp(
    `Rates from:\\s*(${HYATT_CURRENCY_TOKENS.join("|")})\\s?([0-9][0-9,]{1,8})(?:\\.\\d{2})?\\s*Avg\\s*\\/\\s*Night`,
    "gi"
  );
  const matches = [...text.matchAll(pricePattern)];
  const results: HyattCityRateResult[] = [];

  for (const [index, match] of matches.entries()) {
    const matchIndex = match.index ?? 0;
    const previousMatch = matches[index - 1];
    const cardBoundary = previousMatch
      ? (previousMatch.index ?? 0) + previousMatch[0].length
      : 0;
    const before = text.slice(cardBoundary, matchIndex).slice(-600);
    const hotelName = extractHotelNameFromResultPrefix(before);
    if (!hotelName) {
      continue;
    }
    const avgNightlyRate = Number(match[2].replace(/,/g, ""));
    if (!Number.isFinite(avgNightlyRate) || avgNightlyRate < 20 || avgNightlyRate > 5_000_000) {
      continue;
    }
    results.push({
      availabilityLabel: "Rates from",
      avgNightlyRate,
      currency: normalizeHyattCurrency(match[1]),
      hotelName,
      locationLabel: null,
      priceBasis: "Official Hyatt Avg/Night estimate; taxes and fees excluded unless Hyatt labels otherwise",
      sourceUrl
    });
  }

  return results;
}

function parseHyattCitySearchCard(rawText: string, sourceUrl: string): HyattCityRateResult | null {
  const text = rawText.replace(/\s+/g, " ").trim();
  const pricePattern = new RegExp(
    `(${HYATT_CURRENCY_TOKENS.join("|")})\\s?([0-9][0-9,]{1,8})(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`,
    "i"
  );
  const priceMatch = text.match(pricePattern);
  if (!priceMatch) {
    return null;
  }

  const hotelName = extractHotelName(text);
  if (!hotelName) {
    return null;
  }

  const avgNightlyRate = Number(priceMatch[2].replace(/,/g, ""));
  if (!Number.isFinite(avgNightlyRate) || avgNightlyRate < 20 || avgNightlyRate > 5_000_000) {
    return null;
  }

  return {
    availabilityLabel: extractAvailability(text),
    avgNightlyRate,
    currency: normalizeHyattCurrency(priceMatch[1]),
    hotelName,
    locationLabel: extractLocation(text, hotelName),
    priceBasis: "Official Hyatt Avg/Night estimate; taxes and fees excluded unless Hyatt labels otherwise",
    sourceUrl
  };
}

function extractHotelName(text: string) {
  const candidates = [
    ...text.matchAll(
      /\b((?:Park Hyatt|Grand Hyatt|Hyatt Regency|Hyatt Centric|Hyatt Place|Hyatt House|Hyatt Vacation Club|Hyatt Ziva|Hyatt Zilara|Hyatt Vivid|Hyatt Studios|The Unbound Collection by Hyatt|Destination by Hyatt|Caption by Hyatt|JdV by Hyatt|Alila|Andaz|Thompson|Dream|Miraval|The Standard|me and all hotel|Tommy Bahama Miramonte Resort & Spa)[A-Za-z0-9 '&.,()/-]{0,90})/gi
    )
  ]
    .map((match) => cleanLabel(match[1]))
    .filter((name) => name.length >= 4 && !/World of Hyatt|Hyatt Search|Hyatt Hotels/i.test(name));

  return candidates.sort((a, b) => b.length - a.length)[0] ?? null;
}

function extractHotelNameFromResultPrefix(text: string) {
  const normalized = text
    .replace(/\b(?:HOTEL WEBSITE|VIEW RATES|Points View|RECOMMENDED|JAPANESE YEN|FILTERS)\b/gi, " ")
    .replace(/\b\d+\s*\/\s*\d+\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const candidates = [
    ...normalized.matchAll(
      /\b((?:Park Hyatt|Grand Hyatt|Hyatt Regency|Hyatt Centric|Hyatt Place|Hyatt House|Hyatt Vacation Club|Hyatt Ziva|Hyatt Zilara|Hyatt Vivid|Hyatt Studios|The Unbound Collection by Hyatt|Destination by Hyatt|Caption by Hyatt|JdV by Hyatt|Alila|Andaz|Thompson|Dream|Miraval|The Standard|me and all hotel|Tommy Bahama Miramonte Resort & Spa|Hotel Toranomon Hills)[A-Za-z0-9 '&.,()/-]{0,90}?)(?:\s+(?:NEWLY ADDED\s+)?Award Category|\s+\d+(?:\.\d+)?\s*mi|\s+\d(?:\.\d)?\s+\(\d+\))/gi
    )
  ].map((match) => ({
    index: match.index ?? 0,
    name: cleanLabel(match[1])
  }));

  return candidates.filter((candidate) => candidate.name).sort((a, b) => b.index - a.index)[0]?.name ?? null;
}

function extractAvailability(text: string) {
  const match = text.match(/\b(Sold Out|Not Available|Available|Member Rate|Standard Rate|From)\b/i);
  return match ? cleanLabel(match[1]) : "Rate visible";
}

function extractLocation(text: string, hotelName: string) {
  const nameIndex = text.indexOf(hotelName);
  if (nameIndex < 0) {
    return null;
  }
  const afterName = text.slice(nameIndex + hotelName.length, nameIndex + hotelName.length + 220);
  const match = afterName.match(/\b([A-Z][A-Za-z .'-]+,\s*[A-Z][A-Za-z .'-]+)\b/);
  return match ? cleanLabel(match[1]) : null;
}

function dedupeHyattCityRateResults(results: HyattCityRateResult[]) {
  const byHotel = new Map<string, HyattCityRateResult>();
  for (const result of results) {
    const key = normalizeHotelName(result.hotelName);
    const existing = byHotel.get(key);
    if (!existing || result.avgNightlyRate < existing.avgNightlyRate) {
      byHotel.set(key, result);
    }
  }
  return [...byHotel.values()].sort((a, b) => a.avgNightlyRate - b.avgNightlyRate);
}

function cleanLabel(value: string) {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+Award Category\b.*$/i, "")
    .replace(/\s+\d+(?:\.\d+)?\s*mi\b.*$/i, "")
    .replace(/\s+Rates from\b.*$/i, "")
    .replace(/\s+(?:Member Rate|Standard Rate|Available|From|Sold Out|Not Available)\b.*$/i, "")
    .replace(/\s+(?:Avg\/Night|Average\/Night|View Hotel|Book Now|Select).*$/i, "")
    .trim()
    .slice(0, 160);
}

function normalizeHotelName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
