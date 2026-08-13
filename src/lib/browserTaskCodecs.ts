import type { BrowserTaskKind } from "@prisma/client";
import { parseJson, toJson } from "@/lib/json";
import type {
  BookingPriceInput,
  HotelSearchBudget,
  HotelSearchQuery,
  ParsedObservationDraft,
  SanitizedBrowserSnapshot
} from "@/lib/providers/types";

export type HotelSearchTaskContext = {
  hotelName: string | null;
  mode: "city_results" | "tax_inclusive_total";
  query: HotelSearchQuery;
  searchSessionId: string | null;
};

export function serializeBookingPriceContext(input: BookingPriceInput) {
  return {
    ...input,
    cancellationDeadline: input.cancellationDeadline?.toISOString() ?? null,
    checkIn: input.checkIn.toISOString(),
    checkOut: input.checkOut.toISOString()
  };
}

export function parseBookingPriceContext(value: string): BookingPriceInput | null {
  const context = parseJson<unknown>(value, null);
  if (!isRecord(context) || typeof context.bookingId !== "string" || typeof context.hotelGroup !== "string") {
    return null;
  }
  const checkIn = new Date(stringValue(context.checkIn));
  const checkOut = new Date(stringValue(context.checkOut));
  const cancellationDeadline = context.cancellationDeadline
    ? new Date(stringValue(context.cancellationDeadline))
    : null;
  if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime())) {
    return null;
  }
  if (cancellationDeadline && Number.isNaN(cancellationDeadline.getTime())) {
    return null;
  }

  return {
    bookingId: context.bookingId,
    bookingUrl: typeof context.bookingUrl === "string" ? context.bookingUrl : null,
    cancellationDeadline,
    checkIn,
    checkOut,
    city: stringValue(context.city),
    currency: stringValue(context.currency) || "USD",
    guests: finiteNumber(context.guests) ?? 1,
    hotelGroup: context.hotelGroup,
    hotelName: stringValue(context.hotelName),
    inventoryTypes: Array.isArray(context.inventoryTypes)
      ? context.inventoryTypes.filter((item): item is "cash" | "award" => item === "cash" || item === "award")
      : ["cash", "award"],
    roomType: stringValue(context.roomType)
  };
}

export function parseHotelSearchTaskContext(value: string): HotelSearchTaskContext | null {
  const parsed = parseJson<unknown>(value, null);
  const legacyQuery = decodeHotelSearchQuery(parsed);
  if (legacyQuery) {
    return { hotelName: null, mode: "city_results", query: legacyQuery, searchSessionId: null };
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const query = decodeHotelSearchQuery(parsed.query);
  if (!query) {
    return null;
  }
  return {
    hotelName: nullableTrimmedString(parsed.hotelName),
    mode: parsed.mode === "tax_inclusive_total" ? "tax_inclusive_total" : "city_results",
    query,
    searchSessionId: nullableTrimmedString(parsed.searchSessionId)
  };
}

export function serializeBrowserTaskContext(kind: BrowserTaskKind, value: unknown) {
  if (kind === "booking_price_check") {
    const context = parseBookingPriceContext(toJson(value));
    if (!context) {
      throw new Error("Booking price task context is invalid.");
    }
    return toJson(serializeBookingPriceContext(context));
  }
  if (kind === "hotel_search") {
    const context = parseHotelSearchTaskContext(toJson(value));
    if (!context) {
      throw new Error("Hotel search task context is invalid.");
    }
    return toJson(context);
  }
  if (!isRecord(value) || !stringValue(value.hotelGroup).trim()) {
    throw new Error("Account import task context is invalid.");
  }
  return toJson({ hotelGroup: stringValue(value.hotelGroup).trim() });
}

export function parseBrowserTaskResult(kind: BrowserTaskKind, value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, null);
  return isBrowserTaskResult(kind, parsed) ? parsed : null;
}

export function serializeBrowserTaskResult(kind: BrowserTaskKind, value: unknown) {
  if (!isBrowserTaskResult(kind, value)) {
    throw new Error(`${kind} result JSON is invalid.`);
  }
  return toJson(value);
}

export function parseObservationDrafts(value: string | null | undefined): ParsedObservationDraft[] {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed)
    ? parsed.map(parseObservationDraft).filter((item): item is ParsedObservationDraft => item !== null)
    : [];
}

export function parseSanitizedBrowserSnapshots(value: string | null | undefined): SanitizedBrowserSnapshot[] {
  const parsed = parseJson<unknown>(value, []);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.flatMap((item) => {
    if (!isRecord(item) || typeof item.capturedAt !== "string" || typeof item.sourceUrl !== "string") {
      return [];
    }
    const capturedAt = new Date(item.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      return [];
    }
    return [{
      capturedAt: capturedAt.toISOString(),
      pageTitle: stringValue(item.pageTitle).slice(0, 200),
      phase: item.phase === "inventory" || item.phase === "detail" ? item.phase : "other" as const,
      sourceUrl: item.sourceUrl,
      textSample: stringValue(item.textSample).slice(0, 12_000),
      truncated: item.truncated === true || stringValue(item.textSample).length > 12_000
    }];
  });
}

function parseObservationDraft(value: unknown): ParsedObservationDraft | null {
  if (!isRecord(value) || (value.inventoryType !== "cash" && value.inventoryType !== "award")) {
    return null;
  }
  if (typeof value.sourceUrl !== "string") {
    return null;
  }
  return {
    breakfastIncluded: nullableBoolean(value.breakfastIncluded),
    cancellationPolicyRaw: nullableString(value.cancellationPolicyRaw),
    cashBase: nullableNumber(value.cashBase),
    cashCopay: nullableNumber(value.cashCopay),
    cashCurrency: nullableString(value.cashCurrency),
    cashFees: nullableNumber(value.cashFees),
    cashTaxes: nullableNumber(value.cashTaxes),
    cashTotal: nullableNumber(value.cashTotal),
    feesIncluded: nullableBoolean(value.feesIncluded),
    inventoryType: value.inventoryType,
    loyaltyEligible: nullableBoolean(value.loyaltyEligible),
    points: nullableInteger(value.points),
    ratePlanName: nullableString(value.ratePlanName),
    rawRateName: nullableString(value.rawRateName),
    roomTypeRaw: nullableString(value.roomTypeRaw),
    sourceUrl: value.sourceUrl,
    taxesIncluded: nullableBoolean(value.taxesIncluded)
  };
}

function isBrowserTaskResult(kind: BrowserTaskKind, value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false;
  }
  if (kind === "booking_price_check") {
    return nonNegativeInteger(value.observationsCreated) !== null && Boolean(stringValue(value.runId).trim());
  }
  if (kind === "account_booking_import") {
    return (
      [value.created, value.imported, value.skipped, value.updated].every(
        (item) => nonNegativeInteger(item) !== null
      ) &&
      [value.loginUrl, value.sourceUrl, value.summary].every((item) => Boolean(stringValue(item).trim())) &&
      (value.status === "login_required" || value.status === "succeeded")
    );
  }
  return isCitySearchResult(value) || isTaxInclusiveTotalResult(value);
}

function isCitySearchResult(value: Record<string, unknown>) {
  return (
    validDateString(value.capturedAt) &&
    Array.isArray(value.results) &&
    value.results.every(isHotelSearchResult) &&
    Boolean(stringValue(value.searchSessionId).trim()) &&
    Boolean(stringValue(value.searchUrl).trim()) &&
    (value.status === "succeeded" || value.status === "partial") &&
    Boolean(stringValue(value.summary).trim()) &&
    (value.warning === null || typeof value.warning === "string")
  );
}

function isHotelSearchResult(value: unknown) {
  if (!isRecord(value)) {
    return false;
  }
  return (
    [value.availabilityLabel, value.currency, value.hotelName, value.priceBasis, value.sourceUrl].every(
      (item) => Boolean(stringValue(item).trim())
    ) &&
    finiteNumber(value.avgNightlyRate) !== null &&
    (value.locationLabel === null || typeof value.locationLabel === "string")
  );
}

function isTaxInclusiveTotalResult(value: Record<string, unknown>) {
  return (
    validDateString(value.capturedAt) &&
    [value.currency, value.hotelName, value.priceBasis, value.searchSessionId, value.sourceUrl].every(
      (item) => Boolean(stringValue(item).trim())
    ) &&
    positiveInteger(value.nights) !== null &&
    finiteNumber(value.total) !== null &&
    [value.fees, value.subtotal, value.taxes, value.taxesAndFees].every(nullableFiniteNumber)
  );
}

function decodeHotelSearchQuery(value: unknown): HotelSearchQuery | null {
  if (!isRecord(value)) {
    return null;
  }
  const adults = positiveInteger(value.adults);
  const budget = decodeHotelSearchBudget(value);
  const checkIn = stringValue(value.checkIn).trim();
  const checkOut = stringValue(value.checkOut).trim();
  const city = stringValue(value.city).trim();
  const cityAsAsked = value.cityAsAsked === undefined ? city : stringValue(value.cityAsAsked).trim();
  const currency = stringValue(value.currency).trim();
  const hotelGroup = stringValue(value.hotelGroup).trim();
  if (
    adults === null ||
    !checkIn ||
    !checkOut ||
    !city ||
    !cityAsAsked ||
    !currency ||
    !hotelGroup ||
    budget === undefined
  ) {
    return null;
  }
  return { adults, budget, checkIn, checkOut, city, cityAsAsked, currency, hotelGroup };
}

function decodeHotelSearchBudget(value: Record<string, unknown>): HotelSearchBudget | null | undefined {
  if (value.budget === undefined) {
    if (value.maxStayTotal === undefined || value.maxStayTotal === null) {
      return null;
    }
    const legacyAmount = positiveFiniteNumber(value.maxStayTotal);
    return legacyAmount === null
      ? undefined
      : { amount: legacyAmount, basis: "stay_total", basisAssumed: false, flexibility: "maximum" };
  }
  if (value.budget === null) {
    return null;
  }
  if (!isRecord(value.budget)) {
    return undefined;
  }
  const amount = positiveFiniteNumber(value.budget.amount);
  const basis = value.budget.basis;
  const flexibility = value.budget.flexibility;
  if (
    amount === null ||
    (basis !== "per_night" && basis !== "stay_total") ||
    (flexibility !== "maximum" && flexibility !== "approximate") ||
    typeof value.budget.basisAssumed !== "boolean"
  ) {
    return undefined;
  }
  return { amount, basis, basisAssumed: value.budget.basisAssumed, flexibility };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function nonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

function positiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function positiveFiniteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nullableFiniteNumber(value: unknown) {
  return value === null || finiteNumber(value) !== null;
}

function nullableTrimmedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function nullableNumber(value: unknown) {
  return value === null || value === undefined ? null : finiteNumber(value);
}

function nullableInteger(value: unknown) {
  const number = nullableNumber(value);
  return number === null ? null : Math.round(number);
}

function nullableString(value: unknown) {
  return value === null || value === undefined ? null : typeof value === "string" ? value : null;
}

function nullableBoolean(value: unknown) {
  return value === null || value === undefined ? null : typeof value === "boolean" ? value : null;
}
