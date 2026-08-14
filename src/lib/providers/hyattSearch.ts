import { HYATT_CURRENCY_TOKENS, normalizeHyattCurrency } from "@/lib/providers/hyattCurrency";
import type { HotelSearchBudget, HotelSearchPriceMode, HotelSearchQuery, HotelSearchResult } from "@/lib/providers/types";

type HyattCitySearchQuery = Omit<HotelSearchQuery, "hotelGroup">;

export function normalizeHyattCitySearchQuery(input: Partial<HyattCitySearchQuery>) {
  const adults = Number(input.adults ?? 2);
  const city = String(input.city ?? "").trim();
  const budget = normalizeBudget(input.budget);
  const query = {
    adults: Number.isInteger(adults) && adults > 0 ? adults : 2,
    budget,
    checkIn: String(input.checkIn ?? "").trim(),
    checkOut: String(input.checkOut ?? "").trim(),
    city,
    cityAsAsked: String(input.cityAsAsked ?? city).trim() || city,
    currency: normalizeHyattCurrency(String(input.currency ?? "USD")),
    priceMode: input.priceMode === "points" ? ("points" as const) : ("cash" as const)
  };

  const errors: string[] = [];
  if (!query.city) {
    errors.push("City is required.");
  }
  if (input.budget !== undefined && input.budget !== null && query.budget === null) {
    errors.push("Hotel budget is invalid.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(query.checkIn) || !/^\d{4}-\d{2}-\d{2}$/.test(query.checkOut)) {
    errors.push("Check-in and check-out dates are required.");
  } else if (new Date(`${query.checkOut}T00:00:00.000Z`) <= new Date(`${query.checkIn}T00:00:00.000Z`)) {
    errors.push("Check-out must be after check-in.");
  }

  return { errors, query };
}

function normalizeBudget(value: HotelSearchBudget | null | undefined): HotelSearchBudget | null {
  if (!value || !Number.isFinite(value.amount) || value.amount <= 0) {
    return null;
  }
  if (
    (value.basis !== "per_night" && value.basis !== "stay_total") ||
    (value.flexibility !== "maximum" && value.flexibility !== "approximate") ||
    typeof value.basisAssumed !== "boolean"
  ) {
    return null;
  }
  return { ...value, amount: Number(value.amount) };
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
  if (query.priceMode === "points") {
    params.set("rateFilter", "woh");
  }
  return `https://www.hyatt.com/search/hotels/en-US/${encodeURIComponent(query.city)}?${params.toString()}`;
}

export function parseHyattCitySearchCards(cardTexts: string[], sourceUrl: string): HotelSearchResult[] {
  const results = cardTexts.flatMap((text) => parseHyattCitySearchText(text, sourceUrl));
  return dedupeHyattCityRateResults(results);
}

function parseHyattCitySearchText(text: string, sourceUrl: string): HotelSearchResult[] {
  const compactText = text.replace(/\s+/g, " ").trim();
  const explicitCard = parseHyattCitySearchCard(compactText, sourceUrl);
  const pageResults = parseHyattCitySearchPageText(compactText, sourceUrl);
  return pageResults.length > 0 ? pageResults : explicitCard ? [explicitCard] : [];
}

function parseHyattCitySearchPageText(text: string, sourceUrl: string) {
  const pointsPattern = /Rates from:\s*([0-9][0-9,]{1,8})\s*Points\s*\/\s*Night/gi;
  const pointMatches = [...text.matchAll(pointsPattern)];
  if (pointMatches.length > 0) {
    return parsePageRateMatches(pointMatches, text, sourceUrl, "points");
  }

  const pricePattern = new RegExp(
    `Rates from:\\s*(${HYATT_CURRENCY_TOKENS.join("|")})\\s?([0-9][0-9,]{1,8})(?:\\.\\d{2})?\\s*Avg\\s*\\/\\s*Night`,
    "gi"
  );
  const matches = [...text.matchAll(pricePattern)];
  return parsePageRateMatches(matches, text, sourceUrl, "cash");
}

function parsePageRateMatches(
  matches: RegExpMatchArray[],
  text: string,
  sourceUrl: string,
  priceMode: HotelSearchPriceMode
) {
  const results: HotelSearchResult[] = [];

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
    const amount = Number(match[priceMode === "points" ? 1 : 2].replace(/,/g, ""));
    if (!Number.isFinite(amount) || amount < 1 || amount > 5_000_000) {
      continue;
    }
    results.push({
      availabilityLabel: "Rates from",
      avgNightlyRate: priceMode === "cash" ? amount : null,
      currency: priceMode === "cash" ? normalizeHyattCurrency(match[1]) : "PTS",
      hotelName,
      locationLabel: null,
      priceBasis: priceMode === "points"
        ? "Official Hyatt Points/Night award estimate"
        : "Official Hyatt Avg/Night estimate; taxes and fees excluded unless Hyatt labels otherwise",
      pointsPerNight: priceMode === "points" ? amount : null,
      priceMode,
      sourceUrl
    });
  }

  return results;
}

function parseHyattCitySearchCard(rawText: string, sourceUrl: string): HotelSearchResult | null {
  const text = rawText.replace(/\s+/g, " ").trim();
  const pointsMatch = text.match(/([0-9][0-9,]{1,8})\s*Points\s*\/\s*Night/i);
  if (pointsMatch) {
    const pointsPerNight = Number(pointsMatch[1].replace(/,/g, ""));
    const hotelName = extractHotelName(text);
    if (hotelName && Number.isFinite(pointsPerNight) && pointsPerNight > 0) {
      return {
        availabilityLabel: extractAvailability(text),
        avgNightlyRate: null,
        currency: "PTS",
        hotelName,
        locationLabel: extractLocation(text, hotelName),
        priceBasis: "Official Hyatt Points/Night award estimate",
        pointsPerNight,
        priceMode: "points",
        sourceUrl
      };
    }
  }

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
    pointsPerNight: null,
    priceMode: "cash",
    sourceUrl
  };
}

function extractHotelName(text: string) {
  const candidates = [
    ...text.matchAll(
      /\b((?:Hyatt on the Bund|Park Hyatt|Grand Hyatt|Hyatt Regency|Hyatt Centric|Hyatt Place|Hyatt House|Hyatt Vacation Club|Hyatt Ziva|Hyatt Zilara|Hyatt Vivid|Hyatt Studios|The Unbound Collection by Hyatt|Destination by Hyatt|Caption by Hyatt|JdV by Hyatt|Alila|Andaz|Thompson|Dream|Miraval|The Standard|me and all hotel|Tommy Bahama Miramonte Resort & Spa)[A-Za-z0-9 '&.,()/-]{0,90})/gi
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
      /\b((?:Hyatt on the Bund|Park Hyatt|Grand Hyatt|Hyatt Regency|Hyatt Centric|Hyatt Place|Hyatt House|Hyatt Vacation Club|Hyatt Ziva|Hyatt Zilara|Hyatt Vivid|Hyatt Studios|The Unbound Collection by Hyatt|Destination by Hyatt|Caption by Hyatt|JdV by Hyatt|Alila|Andaz|Thompson|Dream|Miraval|The Standard|me and all hotel|Tommy Bahama Miramonte Resort & Spa|Hotel Toranomon Hills)[A-Za-z0-9 '&.,()/-]{0,90}?)(?:\s+(?:NEWLY ADDED\s+)?Award Category|\s+\d+(?:\.\d+)?\s*mi|\s+\d(?:\.\d)?\s+\(\d+\))/gi
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

function dedupeHyattCityRateResults(results: HotelSearchResult[]) {
  const byHotel = new Map<string, HotelSearchResult>();
  for (const result of results) {
    const key = `${result.priceMode}:${normalizeHotelName(result.hotelName)}`;
    const existing = byHotel.get(key);
    const resultAmount = result.priceMode === "points"
      ? result.pointsPerNight ?? Number.POSITIVE_INFINITY
      : result.avgNightlyRate ?? Number.POSITIVE_INFINITY;
    const existingAmount = existing
      ? existing.priceMode === "points"
        ? existing.pointsPerNight ?? Number.POSITIVE_INFINITY
        : existing.avgNightlyRate ?? Number.POSITIVE_INFINITY
      : Number.POSITIVE_INFINITY;
    if (!existing || resultAmount < existingAmount) {
      byHotel.set(key, result);
    }
  }
  return [...byHotel.values()].sort((a, b) => {
    const left = a.priceMode === "points" ? a.pointsPerNight ?? Number.POSITIVE_INFINITY : a.avgNightlyRate ?? Number.POSITIVE_INFINITY;
    const right = b.priceMode === "points" ? b.pointsPerNight ?? Number.POSITIVE_INFINITY : b.avgNightlyRate ?? Number.POSITIVE_INFINITY;
    return left - right;
  });
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
