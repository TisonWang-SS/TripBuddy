import { parseJson, toJson } from "@/lib/json";
import type {
  HotelSearchHotelResult,
  HotelSearchOffer,
  HotelSearchSessionResults
} from "@/lib/hotelSearchSessions";
import type { HotelSearchQuery } from "@/lib/providers/types";

export function parseHotelSearchQuery(value: string | null | undefined, fallback: HotelSearchQuery) {
  return decodeQuery(parseJson<unknown>(value, null)) ?? fallback;
}

export function serializeHotelSearchQuery(value: HotelSearchQuery) {
  const query = decodeQuery(value);
  if (!query) {
    throw new Error("Hotel search query JSON is invalid.");
  }
  return toJson(query);
}

export function parseHotelSearchSessionResults(
  value: string | null | undefined,
  fallback: HotelSearchSessionResults
) {
  return decodeResults(parseJson<unknown>(value, null)) ?? fallback;
}

export function serializeHotelSearchSessionResults(value: HotelSearchSessionResults) {
  const results = decodeResults(value);
  if (!results) {
    throw new Error("Hotel search session results JSON is invalid.");
  }
  return toJson(results);
}

function decodeQuery(value: unknown): HotelSearchQuery | null {
  if (!isRecord(value)) {
    return null;
  }
  const adults = positiveInteger(value.adults);
  const checkIn = calendarDate(value.checkIn);
  const checkOut = calendarDate(value.checkOut);
  const city = requiredString(value.city);
  const cityAsAsked = value.cityAsAsked === undefined ? city : requiredString(value.cityAsAsked);
  const currency = requiredString(value.currency)?.toUpperCase() ?? null;
  const hotelGroup = requiredString(value.hotelGroup);
  const maxStayTotal = value.maxStayTotal === undefined || value.maxStayTotal === null
    ? null
    : positiveNumber(value.maxStayTotal);
  if (
    !adults ||
    !checkIn ||
    !checkOut ||
    !city ||
    !cityAsAsked ||
    !currency ||
    !hotelGroup ||
    (value.maxStayTotal !== undefined && value.maxStayTotal !== null && maxStayTotal === null) ||
    checkOut <= checkIn
  ) {
    return null;
  }
  return { adults, checkIn, checkOut, city, cityAsAsked, currency, hotelGroup, maxStayTotal };
}

function decodeResults(value: unknown): HotelSearchSessionResults | null {
  if (!isRecord(value) || !Array.isArray(value.hotels)) {
    return null;
  }
  const hotels = value.hotels.map(decodeHotel);
  if (hotels.some((hotel) => hotel === null)) {
    return null;
  }
  const capturedAt = nullableDateString(value.capturedAt);
  const summary = nullableString(value.summary);
  const warning = nullableString(value.warning);
  if (capturedAt === undefined || summary === undefined || warning === undefined) {
    return null;
  }
  return {
    capturedAt,
    hotels: hotels as HotelSearchHotelResult[],
    summary,
    warning
  };
}

function decodeHotel(value: unknown): HotelSearchHotelResult | null {
  if (!isRecord(value) || !Array.isArray(value.offers)) {
    return null;
  }
  const offers = value.offers.map(decodeOffer);
  const availabilityLabel = requiredString(value.availabilityLabel);
  const hotelGroup = requiredString(value.hotelGroup);
  const hotelKey = requiredString(value.hotelKey);
  const hotelName = requiredString(value.hotelName);
  const locationLabel = nullableString(value.locationLabel);
  if (
    offers.some((offer) => offer === null) ||
    !availabilityLabel ||
    !hotelGroup ||
    !hotelKey ||
    !hotelName ||
    locationLabel === undefined
  ) {
    return null;
  }
  return {
    availabilityLabel,
    hotelGroup,
    hotelKey,
    hotelName,
    locationLabel,
    offers: offers as HotelSearchOffer[]
  };
}

function decodeOffer(value: unknown): HotelSearchOffer | null {
  if (!isRecord(value)) {
    return null;
  }
  const offer = {
    breakfastIncluded: nullableBoolean(value.breakfastIncluded),
    cancellationPolicy: nullableString(value.cancellationPolicy),
    capturedAt: dateString(value.capturedAt),
    comparisonWarnings: stringArray(value.comparisonWarnings),
    currency: requiredString(value.currency)?.toUpperCase() ?? null,
    displayedAmount: nonNegativeNumber(value.displayedAmount),
    displayedPriceBasis: enumValue(value.displayedPriceBasis, ["tax_exclusive", "tax_inclusive", "unknown"] as const),
    displayedPriceUnit: enumValue(value.displayedPriceUnit, ["avg_nightly", "stay_total"] as const),
    eliteNightEligible: nullableBoolean(value.eliteNightEligible),
    evidenceLevel: enumValue(value.evidenceLevel, ["starting_price", "verified_offer", "final_total"] as const),
    feesAmount: nullableNumber(value.feesAmount),
    feesIncluded: enumValue(value.feesIncluded, ["included", "excluded", "unknown"] as const),
    hotelGroup: requiredString(value.hotelGroup),
    loyaltyEligible: nullableBoolean(value.loyaltyEligible),
    nights: positiveInteger(value.nights),
    offerKey: requiredString(value.offerKey),
    providerName: requiredString(value.providerName),
    ratePlanName: nullableString(value.ratePlanName),
    roomType: nullableString(value.roomType),
    sourceName: requiredString(value.sourceName),
    sourceType: enumValue(value.sourceType, ["direct", "ota", "other"] as const),
    sourceUrl: requiredString(value.sourceUrl),
    startingAvgNightlyRate: nullableNumber(value.startingAvgNightlyRate),
    staySubtotal: nullableNumber(value.staySubtotal),
    stayTotal: nullableNumber(value.stayTotal),
    taxesAmount: nullableNumber(value.taxesAmount),
    taxesAndFeesAmount: nullableNumber(value.taxesAndFeesAmount),
    taxesIncluded: enumValue(value.taxesIncluded, ["included", "excluded", "unknown"] as const)
  };
  if (
    offer.breakfastIncluded === undefined ||
    offer.cancellationPolicy === undefined ||
    !offer.capturedAt ||
    !offer.comparisonWarnings ||
    !offer.currency ||
    offer.displayedAmount === null ||
    !offer.displayedPriceBasis ||
    !offer.displayedPriceUnit ||
    offer.eliteNightEligible === undefined ||
    !offer.evidenceLevel ||
    offer.feesAmount === undefined ||
    !offer.feesIncluded ||
    !offer.hotelGroup ||
    offer.loyaltyEligible === undefined ||
    !offer.nights ||
    !offer.offerKey ||
    !offer.providerName ||
    offer.ratePlanName === undefined ||
    offer.roomType === undefined ||
    !offer.sourceName ||
    !offer.sourceType ||
    !offer.sourceUrl ||
    offer.startingAvgNightlyRate === undefined ||
    offer.staySubtotal === undefined ||
    offer.stayTotal === undefined ||
    offer.taxesAmount === undefined ||
    offer.taxesAndFeesAmount === undefined ||
    !offer.taxesIncluded
  ) {
    return null;
  }
  return offer as HotelSearchOffer;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null | undefined {
  return value === null ? null : typeof value === "string" ? value : undefined;
}

function stringArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : null;
}

function nonNegativeNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nullableNumber(value: unknown): number | null | undefined {
  return value === null ? null : nonNegativeNumber(value) ?? undefined;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nullableBoolean(value: unknown): boolean | null | undefined {
  return value === null ? null : typeof value === "boolean" ? value : undefined;
}

function enumValue<const T extends readonly string[]>(value: unknown, allowed: T): T[number] | null {
  return typeof value === "string" && allowed.includes(value) ? value as T[number] : null;
}

function calendarDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function dateString(value: unknown) {
  if (typeof value !== "string" || Number.isNaN(new Date(value).getTime())) {
    return null;
  }
  return new Date(value).toISOString();
}

function nullableDateString(value: unknown): string | null | undefined {
  return value === null ? null : dateString(value) ?? undefined;
}
