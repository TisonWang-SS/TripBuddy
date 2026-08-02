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
import { sanitizeEvidenceText, toJson } from "@/lib/json";

export type EvidenceAssessmentOverride = {
  cancellationMatch?: CancellationMatch;
  roomMatch?: RoomMatch;
};

export type EvidenceInput = {
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
  const roomMatch = input.overrides?.roomMatch ?? inferredRoom.match;
  const cancellationMatch = input.overrides?.cancellationMatch ?? "unknown";
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
  if (input.inventoryType === "cash" && taxesIncluded !== "yes") {
    blockers.push("Final tax inclusion is not verified.");
  }
  if (input.inventoryType === "cash" && feesIncluded !== "yes") {
    blockers.push("Final fee inclusion is not verified.");
  }
  if (!currencyComparable) {
    blockers.push(`No conversion is available from ${input.cashCurrency ?? "the observed currency"} to ${input.bookingCurrency}.`);
  }
  if (cancellationMatch === "worse") {
    warnings.push("The candidate has a weaker cancellation policy.");
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
        : input.cancellationPolicyRaw
          ? "Policy text was captured, but equivalence requires review."
          : "Cancellation policy was not captured.",
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
