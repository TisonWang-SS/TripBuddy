import type {
  AssessmentSource,
  CancellationMatch,
  EligibilityStatus,
  EvidenceQuality,
  InclusionStatus,
  LoginState,
  PromotionApplicability,
  RoomMatch
} from "@prisma/client";
import { calendarDayOf, localInstantDayOf } from "@/lib/dateSemantics";
import { WEAKER_CANCELLATION_WARNING } from "@/lib/evidenceWarnings";
import { sanitizeEvidenceText, toJson } from "@/lib/json";

export type EvidenceAssessmentOverride = {
  cancellationMatch?: CancellationMatch;
  roomMatch?: RoomMatch;
};

export type EvidenceInput = {
  bookingCancellationDeadline: Date | string | null;
  bookingCheckIn: Date | string;
  bookingCurrency: string;
  bookingRoomType: string;
  cancellationPolicyRaw: string | null;
  cashCurrency: string | null;
  collectionMethod: "manual" | "browser_companion";
  conversionAvailable: boolean;
  feesIncluded: boolean | null;
  hasCashComponent?: boolean;
  inventoryType: "cash" | "award";
  loyaltyEligible: boolean | null;
  overrides?: EvidenceAssessmentOverride;
  pageText?: string;
  pageTitle?: string;
  roomTypeRaw: string | null;
  sourceType: "direct" | "ota" | "other";
  sourceUrl: string | null;
  taxesIncluded: boolean | null;
};

export type BuiltEvidence = {
  blockers: string[];
  cancellationAssessmentSource: AssessmentSource;
  cancellationMatch: CancellationMatch;
  cancellationMatchReason: string;
  currencyComparable: boolean;
  feesIncluded: InclusionStatus;
  loginState: LoginState;
  loyaltyEligibility: EligibilityStatus;
  promotionApplicability: PromotionApplicability;
  qualityLevel: EvidenceQuality;
  roomAssessmentSource: AssessmentSource;
  roomMatch: RoomMatch;
  roomMatchReason: string;
  snapshotJson: string;
  sourceVerified: boolean;
  taxesIncluded: InclusionStatus;
  warnings: string[];
};

export function buildObservationEvidence(input: EvidenceInput): BuiltEvidence {
  const inferredRoom = inferRoomMatch(input.bookingRoomType, input.roomTypeRaw);
  const inferredCancellation = inferCancellationMatch(
    input.bookingCancellationDeadline,
    input.bookingCheckIn,
    input.cancellationPolicyRaw
  );
  const roomMatch = input.overrides?.roomMatch ?? inferredRoom.match;
  const cancellationMatch = input.overrides?.cancellationMatch ?? inferredCancellation.match;
  const roomAssessmentSource: AssessmentSource = input.overrides?.roomMatch ? "user" : "automated";
  const cancellationAssessmentSource: AssessmentSource = input.overrides?.cancellationMatch ? "user" : "automated";
  const taxesIncluded = inclusion(input.taxesIncluded);
  const feesIncluded = inclusion(input.feesIncluded);
  const loyaltyEligibility: EligibilityStatus =
    input.loyaltyEligible === true ? "eligible" : input.loyaltyEligible === false ? "not_eligible" : "unknown";
  const currencyComparable =
    (input.inventoryType === "award" && !input.hasCashComponent) ||
    !input.cashCurrency ||
    input.cashCurrency === input.bookingCurrency ||
    input.conversionAvailable;
  const sourceVerified = input.collectionMethod === "browser_companion" && input.sourceType === "direct";
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (roomMatch === "unknown") {
    blockers.push("Room equivalence is unknown.");
  }
  if (cancellationMatch === "unknown") {
    blockers.push("Cancellation-policy equivalence is unknown.");
  }
  if (cancellationMatch === "worse") {
    warnings.push(WEAKER_CANCELLATION_WARNING);
  }
  if (input.inventoryType === "cash" && taxesIncluded !== "yes") {
    blockers.push("Final tax inclusion is not verified.");
  }
  if (input.inventoryType === "cash" && feesIncluded !== "yes") {
    blockers.push("Final fee inclusion is not verified.");
  }
  if (!currencyComparable) {
    blockers.push(`No conversion is available from ${input.cashCurrency ?? "the observed currency"} to ${input.bookingCurrency}.`);
  }
  if (roomMatch === "similar") {
    warnings.push("The candidate room is similar rather than an exact match.");
  }
  if (!sourceVerified) {
    warnings.push("The source was not captured by the Browser Companion from a direct hotel page.");
  }
  if (loyaltyEligibility === "unknown") {
    warnings.push("Loyalty eligibility is unknown.");
  } else if (loyaltyEligibility === "not_eligible") {
    warnings.push("The candidate does not earn hotel loyalty credit.");
  }

  return {
    blockers,
    cancellationAssessmentSource,
    cancellationMatch,
    cancellationMatchReason:
      cancellationAssessmentSource === "user"
        ? "Confirmed by the user."
        : inferredCancellation.reason,
    currencyComparable,
    feesIncluded,
    loginState: sourceVerified ? "unknown" : "not_required",
    loyaltyEligibility,
    promotionApplicability: "unknown",
    qualityLevel: classifyQuality({ blockers, roomMatch, sourceVerified, warnings }),
    roomAssessmentSource,
    roomMatch,
    roomMatchReason: roomAssessmentSource === "user" ? "Confirmed by the user." : inferredRoom.reason,
    snapshotJson: toJson({
      pageTitle: input.pageTitle?.trim() || null,
      sourceUrl: input.sourceUrl,
      textSample: sanitizeEvidenceText(input.pageText ?? "")
    }),
    sourceVerified,
    taxesIncluded,
    warnings
  };
}

function inferCancellationMatch(
  bookingCancellationDeadline: Date | string | null,
  bookingCheckIn: Date | string,
  cancellationPolicyRaw: string | null
): { match: CancellationMatch; reason: string } {
  const policy = cancellationPolicyRaw?.replace(/\s+/g, " ").trim() ?? "";
  if (!policy || /policy not captured/i.test(policy)) {
    return { match: "unknown", reason: "Cancellation policy was not captured." };
  }

  const currentDeadline = validDate(bookingCancellationDeadline);
  if (!currentDeadline) {
    return {
      match: "unknown",
      reason: "The current booking has no cancellation deadline to compare."
    };
  }

  if (/\b(?:non[ -]?refundable|no refunds?|no cancellation|cannot be cancelled)\b/i.test(policy)) {
    return {
      match: "worse",
      reason: "The candidate is explicitly non-refundable while the current booking has a cancellation deadline."
    };
  }

  const candidateDeadline = extractCancellationDeadline(policy, bookingCheckIn);
  if (!candidateDeadline) {
    return {
      match: "unknown",
      reason: "The captured policy does not contain an explicit cancellation cutoff that TripBuddy can compare."
    };
  }

  const candidateDay = calendarDayOf(candidateDeadline);
  const currentDay = localInstantDayOf(currentDeadline);
  const candidateLabel = formatCalendarDay(candidateDeadline);
  const currentLabel = formatLocalInstantDay(currentDeadline);
  if (candidateDay >= currentDay) {
    return {
      match: "same_or_better",
      reason: `The candidate cancellation cutoff (${candidateLabel}) is on or after the current booking cutoff (${currentLabel}).`
    };
  }
  return {
    match: "worse",
    reason: `The candidate cancellation cutoff (${candidateLabel}) is before the current booking cutoff (${currentLabel}).`
  };
}

function extractCancellationDeadline(policy: string, bookingCheckIn: Date | string) {
  const absoluteDate = extractExplicitPolicyDate(policy);
  if (absoluteDate) {
    return parsePolicyDate(absoluteDate);
  }

  const relative = policy.match(
    /\b(\d{1,3}|one|two|three|four|five|six|seven)\s*(days?|hours?|hrs?)\s*(?:bfr|before|prior to)\s*(?:arrv|arrival|check-?in)\b/i
  );
  const checkIn = validDate(bookingCheckIn);
  if (!relative || !checkIn) {
    return null;
  }
  const quantity = parsePolicyQuantity(relative[1]);
  const unit = relative[2].toLowerCase();
  const days = unit.startsWith("day") ? quantity : quantity % 24 === 0 ? quantity / 24 : null;
  if (days === null) {
    return null;
  }
  return new Date(calendarDayOf(checkIn) - days * 86_400_000);
}

function extractExplicitPolicyDate(policy: string) {
  const datePattern =
    /\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|\b\d{4}-\d{2}-\d{2}\b/gi;
  for (const match of policy.matchAll(datePattern)) {
    const prefix = policy.slice(Math.max(0, match.index - 48), match.index);
    if (
      /\b(?:by|before|until)\s+(?:(?:[0-2]?\d(?::[0-5]\d)?\s*(?:am|pm))\s+(?:(?:hotel|local)\s+)?time\s+(?:on\s+)?)?$/i.test(
        prefix
      )
    ) {
      return match[0];
    }
  }
  return null;
}

function parsePolicyDate(value: string) {
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return validUtcDate(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const named = value.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!named) {
    return null;
  }
  const month = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(
    named[1].slice(0, 3).toLowerCase()
  );
  return validUtcDate(Number(named[3]), month, Number(named[2]));
}

function validUtcDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month && date.getUTCDate() === day ? date : null;
}

function validDate(value: Date | string | null) {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parsePolicyQuantity(value: string) {
  const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
  return words[value.toLowerCase()] ?? Number(value);
}

function formatCalendarDay(value: Date) {
  return new Date(calendarDayOf(value)).toISOString().slice(0, 10);
}

function formatLocalInstantDay(value: Date) {
  return new Date(localInstantDayOf(value)).toISOString().slice(0, 10);
}

function inclusion(value: boolean | null): InclusionStatus {
  return value === true ? "yes" : value === false ? "no" : "unknown";
}

function classifyQuality(input: {
  blockers: string[];
  roomMatch: RoomMatch;
  sourceVerified: boolean;
  warnings: string[];
}): EvidenceQuality {
  if (input.blockers.length > 0) {
    return "needs_review";
  }
  if (!input.sourceVerified) {
    return "low";
  }
  if (input.roomMatch === "exact" && input.warnings.length === 0) {
    return "high";
  }
  return "medium";
}

function inferRoomMatch(currentRoomType: string, observedRoomType: string | null) {
  const current = normalizeComparableRoom(currentRoomType);
  const observed = normalizeComparableRoom(observedRoomType ?? "");
  if (!current || !observed || /not captured|unknown/.test(observed)) {
    return { match: "unknown" as const, reason: "Observed room type was not captured." };
  }
  if (current === observed || current.includes(observed) || observed.includes(current)) {
    return { match: "exact" as const, reason: "The normalized room names match." };
  }
  for (const token of ["king", "queen", "twin", "double", "suite"]) {
    if (current.includes(token) && observed.includes(token)) {
      return { match: "similar" as const, reason: `Both room names contain ${token}.` };
    }
  }
  return { match: "unknown" as const, reason: "The room names are not equivalent enough to infer a match." };
}

function normalizeComparableRoom(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(?:room|rooms|standard|view|details|hyatt|place|select|book)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
