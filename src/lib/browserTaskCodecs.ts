import { parseJson } from "@/lib/json";
import type {
  BookingPriceInput,
  ParsedObservationDraft,
  SanitizedBrowserSnapshot
} from "@/lib/providers/types";

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
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
