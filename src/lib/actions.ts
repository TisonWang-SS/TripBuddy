"use server";

import type {
  BookingBaselineType,
  CancellationMatch,
  CertificateKind,
  CollectionMethod,
  InventoryType,
  LoyaltyValuationKind,
  RoomMatch,
  SourceType
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_PROFILE_ID, HOTEL_GROUPS } from "@/lib/constants";
import { inferIsSuite, supportedCurrencyValue } from "@/lib/currency";
import { parseCalendarDate } from "@/lib/dateSemantics";
import { prisma } from "@/lib/db";
import { buildObservationEvidence } from "@/lib/evidence";
import { toJson } from "@/lib/json";
import { validateValuationDraft } from "@/lib/loyaltyValuation";
import { createRecommendationForBooking } from "@/lib/recommendations";
import {
  convertMoneyToSystemCurrency,
  getCurrencyConversion,
  getSystemCurrency,
  setCurrencyConversionRate
} from "@/lib/systemSettings";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalValue(formData: FormData, key: string) {
  return value(formData, key) || null;
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const parsed = Number(value(formData, key));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function optionalNumberValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  if (!raw) {
    return null;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function boolValue(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function optionalBooleanValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw === "yes" ? true : raw === "no" ? false : null;
}

function optionalLocalInstantValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw ? new Date(raw) : null;
}

function optionalCalendarDateValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw ? parseCalendarDate(raw) : null;
}

function sourceTypeValue(raw: string): SourceType {
  return raw === "ota" || raw === "other" ? raw : "direct";
}

function roomMatchOverride(raw: string): RoomMatch | undefined {
  return raw === "exact" || raw === "similar" || raw === "unknown" ? raw : undefined;
}

function cancellationMatchOverride(raw: string): CancellationMatch | undefined {
  return raw === "same_or_better" || raw === "worse" || raw === "unknown" ? raw : undefined;
}

function inventoryTypeValue(raw: string): InventoryType {
  return raw === "award" ? "award" : "cash";
}

function bookingBaseline(formData: FormData) {
  const baselineType: BookingBaselineType =
    value(formData, "baselineType") === "points"
      ? "points"
      : value(formData, "baselineType") === "certificate"
        ? "certificate"
        : "cash";
  const baselineCashTotal = optionalNumberValue(formData, "baselineCashTotal");
  const baselinePoints = optionalNumberValue(formData, "baselinePoints");
  const baselineAwardLabel = optionalValue(formData, "baselineAwardLabel");
  const baselineAwardKind = certificateKindValue(value(formData, "baselineAwardKind"));
  const baselineAwardCount = optionalNumberValue(formData, "baselineAwardCount");
  if (baselineType === "cash" && baselineCashTotal === null) {
    throw new Error("A cash booking baseline requires a cash total.");
  }
  if (baselineType === "points" && baselinePoints === null) {
    throw new Error("A points booking baseline requires a points amount.");
  }
  if (baselineType === "certificate" && !baselineAwardLabel) {
    throw new Error("A certificate booking baseline requires an award label.");
  }
  if (baselineType === "certificate" && baselineAwardCount !== null && baselineAwardCount < 1) {
    throw new Error("A certificate booking baseline spends at least one certificate.");
  }
  const structuredCertificate = baselineType === "certificate" && baselineAwardKind !== null && baselineAwardCount !== null;
  return {
    baselineAwardCount: structuredCertificate ? Math.round(baselineAwardCount!) : null,
    baselineAwardKind: structuredCertificate ? baselineAwardKind : null,
    baselineAwardLabel: baselineType === "certificate" ? baselineAwardLabel : null,
    baselineCashTotal: baselineType === "cash" || baselineType === "points" ? baselineCashTotal : null,
    baselinePoints: baselineType === "points" ? Math.round(baselinePoints!) : null,
    baselineType
  };
}

function certificateKindValue(raw: string): CertificateKind | null {
  return raw === "free_night" || raw === "suite_upgrade" ? raw : null;
}

function loyaltyValuationKindValue(raw: string): LoyaltyValuationKind {
  if (raw === "point" || raw === "free_night" || raw === "suite_upgrade") {
    return raw;
  }
  throw new Error("A valuation kind must be a point, free-night, or suite-upgrade value.");
}

export async function createBooking(formData: FormData) {
  const currency = await getSystemCurrency();
  const roomType = value(formData, "roomType");
  const booking = await prisma.hotelBooking.create({
    data: {
      ...bookingBaseline(formData),
      bookingChannel: sourceTypeValue(value(formData, "bookingChannel")),
      bookingUrl: optionalValue(formData, "bookingUrl"),
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      cancellationDeadline: optionalLocalInstantValue(formData, "cancellationDeadline"),
      checkIn: parseCalendarDate(value(formData, "checkIn")),
      checkOut: parseCalendarDate(value(formData, "checkOut")),
      city: value(formData, "city"),
      currency,
      guests: numberValue(formData, "guests", 1),
      hotelGroup: value(formData, "hotelGroup"),
      hotelName: value(formData, "hotelName"),
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomType),
      loyaltyEligible: boolValue(formData, "loyaltyEligible"),
      notes: optionalValue(formData, "notes"),
      roomType,
      watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } }
    }
  });
  revalidatePath("/");
  redirect(`/bookings/${booking.id}`);
}

export async function updateWatchPlan(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const normalCadenceHours = boundedIntegerValue(formData, "normalCadenceHours", 1, 720);
  const urgentCadenceHours = boundedIntegerValue(formData, "urgentCadenceHours", 1, 720);
  const urgentWindowHours = boundedIntegerValue(formData, "urgentWindowHours", 1, 720);
  if (urgentCadenceHours > normalCadenceHours) {
    throw new Error("Urgent cadence must be no longer than normal cadence.");
  }
  await prisma.watchPlan.upsert({
    where: { bookingId },
    update: {
      awardEnabled: boolValue(formData, "awardEnabled"),
      cashEnabled: boolValue(formData, "cashEnabled"),
      enabled: true,
      normalCadenceHours,
      urgentCadenceHours,
      urgentWindowHours
    },
    create: {
      awardEnabled: boolValue(formData, "awardEnabled"),
      bookingId,
      cashEnabled: boolValue(formData, "cashEnabled"),
      enabled: true,
      normalCadenceHours,
      urgentCadenceHours,
      urgentWindowHours
    }
  });
  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

function boundedIntegerValue(formData: FormData, key: string, minimum: number, maximum: number) {
  const parsed = Number(value(formData, key));
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}.`);
  }
  return parsed;
}

export async function updateBooking(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const currency = await getSystemCurrency();
  const roomType = value(formData, "roomType");
  await prisma.hotelBooking.update({
    where: { id: bookingId },
    data: {
      ...bookingBaseline(formData),
      bookingChannel: sourceTypeValue(value(formData, "bookingChannel")),
      bookingUrl: optionalValue(formData, "bookingUrl"),
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      cancellationDeadline: optionalLocalInstantValue(formData, "cancellationDeadline"),
      checkIn: parseCalendarDate(value(formData, "checkIn")),
      checkOut: parseCalendarDate(value(formData, "checkOut")),
      city: value(formData, "city"),
      currency,
      guests: numberValue(formData, "guests", 1),
      hotelGroup: value(formData, "hotelGroup"),
      hotelName: value(formData, "hotelName"),
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomType),
      loyaltyEligible: boolValue(formData, "loyaltyEligible"),
      notes: optionalValue(formData, "notes"),
      roomType
    }
  });
  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function addObservation(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const booking = await prisma.hotelBooking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    return;
  }
  const cashCurrency = value(formData, "cashCurrency") || booking.currency;
  const inventoryType = inventoryTypeValue(value(formData, "inventoryType"));
  const cashTotal = optionalNumberValue(formData, "cashTotal");
  const cashCopay = optionalNumberValue(formData, "cashCopay");
  const points = optionalNumberValue(formData, "points");
  if (inventoryType === "cash" && cashTotal === null) {
    throw new Error("A cash observation requires a final cash total.");
  }
  if (inventoryType === "award" && points === null && cashCopay === null) {
    throw new Error("An award observation requires points or a cash copay.");
  }
  const sourceType = sourceTypeValue(value(formData, "sourceType"));
  const roomTypeRaw = value(formData, "roomTypeRaw");
  const evidence = await buildFormEvidence(
    formData,
    booking,
    cashCurrency,
    inventoryType,
    sourceType,
    roomTypeRaw,
    "manual"
  );
  await prisma.priceObservation.create({
    data: {
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      cancellationPolicyRaw: optionalValue(formData, "cancellationPolicyRaw"),
      cashBase: inventoryType === "cash" ? optionalNumberValue(formData, "cashBase") : null,
      cashCopay: inventoryType === "award" ? cashCopay : null,
      cashCopayCurrency: inventoryType === "award" && cashCopay !== null ? cashCurrency : null,
      cashCurrency: inventoryType === "cash" ? cashCurrency : null,
      cashFees: inventoryType === "cash" ? optionalNumberValue(formData, "cashFees") : null,
      cashTaxes: inventoryType === "cash" ? optionalNumberValue(formData, "cashTaxes") : null,
      cashTotal: inventoryType === "cash" ? cashTotal : null,
      collectionMethod: "manual",
      booking: { connect: { id: bookingId } },
      evidence: { create: evidence },
      inventoryType,
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomTypeRaw),
      loyaltyEligible: optionalBooleanValue(formData, "loyaltyEligible"),
      notes: optionalValue(formData, "notes"),
      points: inventoryType === "award" && points !== null ? Math.round(points) : null,
      roomTypeRaw,
      sourceName: value(formData, "sourceName"),
      sourceType,
      sourceUrl: optionalValue(formData, "sourceUrl")
    }
  });
  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function updateObservation(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const observationId = value(formData, "observationId");
  const booking = await prisma.hotelBooking.findUnique({ where: { id: bookingId } });
  const observation = await prisma.priceObservation.findUnique({ where: { id: observationId }, include: { evidence: true } });
  if (!booking || !observation || observation.bookingId !== bookingId) {
    return;
  }
  const cashCurrency = value(formData, "cashCurrency") || booking.currency;
  const inventoryType = inventoryTypeValue(value(formData, "inventoryType"));
  const cashTotal = optionalNumberValue(formData, "cashTotal");
  const cashCopay = optionalNumberValue(formData, "cashCopay");
  const points = optionalNumberValue(formData, "points");
  if (inventoryType === "cash" && cashTotal === null) {
    throw new Error("A cash observation requires a final cash total.");
  }
  if (inventoryType === "award" && points === null && cashCopay === null) {
    throw new Error("An award observation requires points or a cash copay.");
  }
  const sourceType = sourceTypeValue(value(formData, "sourceType"));
  const roomTypeRaw = value(formData, "roomTypeRaw");
  const evidence = await buildFormEvidence(
    formData,
    booking,
    cashCurrency,
    inventoryType,
    sourceType,
    roomTypeRaw,
    observation.collectionMethod,
    observation.evidence?.snapshotJson
  );
  await prisma.priceObservation.update({
    where: { id: observationId },
    data: {
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      cancellationPolicyRaw: optionalValue(formData, "cancellationPolicyRaw"),
      cashBase: inventoryType === "cash" ? optionalNumberValue(formData, "cashBase") : null,
      cashCopay: inventoryType === "award" ? cashCopay : null,
      cashCopayCurrency: inventoryType === "award" && cashCopay !== null ? cashCurrency : null,
      cashCurrency: inventoryType === "cash" ? cashCurrency : null,
      cashFees: inventoryType === "cash" ? optionalNumberValue(formData, "cashFees") : null,
      cashTaxes: inventoryType === "cash" ? optionalNumberValue(formData, "cashTaxes") : null,
      cashTotal: inventoryType === "cash" ? cashTotal : null,
      evidence: { upsert: { create: evidence, update: { ...evidence, reviewedAt: new Date() } } },
      inventoryType,
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomTypeRaw),
      loyaltyEligible: optionalBooleanValue(formData, "loyaltyEligible"),
      notes: optionalValue(formData, "notes"),
      points: inventoryType === "award" && points !== null ? Math.round(points) : null,
      roomTypeRaw,
      sourceName: value(formData, "sourceName"),
      sourceType,
      sourceUrl: optionalValue(formData, "sourceUrl")
    }
  });
  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function deleteObservation(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const observation = await prisma.priceObservation.findUnique({ where: { id: value(formData, "observationId") } });
  if (!observation || observation.bookingId !== bookingId) {
    return;
  }
  await prisma.priceObservation.delete({ where: { id: observation.id } });
  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function promoteObservationToBooking(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const observation = await prisma.priceObservation.findUnique({ where: { id: value(formData, "observationId") } });
  if (!observation || observation.bookingId !== bookingId) {
    return;
  }
  const booking = await prisma.hotelBooking.findUnique({ where: { id: bookingId } });
  if (!booking) {
    return;
  }
  const converted =
    observation.cashTotal !== null && observation.cashCurrency
      ? await convertMoneyToSystemCurrency(observation.cashTotal, observation.cashCurrency)
      : null;
  const convertedCopay =
    observation.cashCopay !== null && observation.cashCopayCurrency
      ? await convertMoneyToSystemCurrency(observation.cashCopay, observation.cashCopayCurrency)
      : null;
  if (observation.inventoryType === "cash" && !converted) {
    throw new Error("This observation cannot become the baseline until its currency has a conversion rate.");
  }
  if (observation.inventoryType === "award" && observation.cashCopay !== null && !convertedCopay) {
    throw new Error("This award copay cannot become the baseline until its currency has a conversion rate.");
  }
  await prisma.hotelBooking.update({
    where: { id: bookingId },
    data: {
      baselineAwardCount: null,
      baselineAwardKind: null,
      baselineAwardLabel: null,
      baselineCashTotal: observation.inventoryType === "cash" ? converted!.amount : convertedCopay?.amount ?? null,
      baselinePoints: observation.inventoryType === "award" ? observation.points : null,
      baselineType: observation.inventoryType === "award" ? "points" : "cash",
      bookingChannel: observation.sourceType,
      bookingUrl: observation.sourceUrl,
      breakfastIncluded: observation.breakfastIncluded === true,
      currency: observation.inventoryType === "cash" ? converted!.currency : booking.currency,
      isSuite: observation.isSuite === true,
      loyaltyEligible: observation.loyaltyEligible === true,
      roomType: observation.roomTypeRaw || booking.roomType
    }
  });
  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function createPromotion(formData: FormData) {
  await prisma.promotion.create({
    data: {
      appliesToExistingBookings: boolValue(formData, "appliesToExistingBookings"),
      bonusMultiplier: numberValue(formData, "bonusMultiplier"),
      description: optionalValue(formData, "description"),
      endDate: optionalCalendarDateValue(formData, "endDate"),
      flatValue: numberValue(formData, "flatValue"),
      hotelGroup: value(formData, "hotelGroup"),
      requiresRegistration: boolValue(formData, "requiresRegistration"),
      sourceUrl: optionalValue(formData, "sourceUrl"),
      startDate: optionalCalendarDateValue(formData, "startDate"),
      title: value(formData, "title")
    }
  });
  revalidatePath("/promotions");
  revalidatePath("/");
}

export async function updateProfile(formData: FormData) {
  const defaultCurrency = supportedCurrencyValue(formData.get("defaultCurrency"));
  await prisma.systemSetting.upsert({
    where: { id: "primary" },
    update: { displayCurrency: defaultCurrency },
    create: { displayCurrency: defaultCurrency, id: "primary" }
  });
  const profileData = {
    caresAboutBreakfast: boolValue(formData, "caresAboutBreakfast"),
    caresAboutLateCheckout: boolValue(formData, "caresAboutLateCheckout"),
    caresAboutLounge: boolValue(formData, "caresAboutLounge"),
    caresAboutUpgrade: boolValue(formData, "caresAboutUpgrade"),
    defaultCurrency,
    name: value(formData, "name") || "Primary Traveler",
    savingsThreshold: numberValue(formData, "savingsThreshold", 50),
    urgentWindowHours: numberValue(formData, "urgentWindowHours", 24)
  };
  await prisma.userProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    update: profileData,
    create: { ...profileData, id: DEFAULT_PROFILE_ID }
  });
  for (const group of HOTEL_GROUPS) {
    const data = { tier: value(formData, `${group}_tier`) };
    await prisma.loyaltyAccount.upsert({
      where: { profileId_hotelGroup: { hotelGroup: group, profileId: DEFAULT_PROFILE_ID } },
      update: data,
      create: { ...data, hotelGroup: group, profileId: DEFAULT_PROFILE_ID }
    });
  }
  revalidatePath("/profile");
  revalidatePath("/");
}

export async function saveLoyaltyValuation(formData: FormData) {
  /* Rejected rather than coerced: forcing a point's rate to 1 would let a
   * traveler believe they had set an adjustment the product ignores. */
  const draft = validateValuationDraft({
    amount: numberValue(formData, "amount", Number.NaN),
    asOf: parseCalendarDate(value(formData, "asOf")),
    currency: supportedCurrencyValue(formData.get("currency")),
    hotelGroup: value(formData, "hotelGroup"),
    kind: loyaltyValuationKindValue(value(formData, "kind")),
    lastReviewedAt: parseCalendarDate(value(formData, "lastReviewedAt")),
    realizationRate: numberValue(formData, "realizationRate", 1),
    sourceName: value(formData, "sourceName")
  });
  if (!HOTEL_GROUPS.includes(draft.hotelGroup as (typeof HOTEL_GROUPS)[number])) {
    throw new Error("A valuation must belong to a supported hotel group.");
  }
  const data = {
    amount: draft.amount,
    asOf: draft.asOf,
    currency: draft.currency,
    lastReviewedAt: draft.lastReviewedAt,
    realizationRate: draft.realizationRate,
    sourceName: draft.sourceName
  };
  await prisma.loyaltyValuation.upsert({
    where: {
      profileId_hotelGroup_kind: { hotelGroup: draft.hotelGroup, kind: draft.kind, profileId: DEFAULT_PROFILE_ID }
    },
    update: data,
    create: { ...data, hotelGroup: draft.hotelGroup, kind: draft.kind, profileId: DEFAULT_PROFILE_ID }
  });
  revalidatePath("/profile");
  revalidatePath("/");
}

export async function createCreditCardBenefit(formData: FormData) {
  await prisma.creditCardBenefit.create({
    data: {
      cashBackRate: numberValue(formData, "cashBackRate"),
      hotelGroup: optionalValue(formData, "hotelGroup"),
      name: value(formData, "name"),
      notes: optionalValue(formData, "notes"),
      pointMultiplier: numberValue(formData, "pointMultiplier"),
      profileId: DEFAULT_PROFILE_ID
    }
  });
  revalidatePath("/profile");
}

export async function saveCurrencyConversionRate(formData: FormData) {
  await setCurrencyConversionRate({
    asOf: parseCalendarDate(value(formData, "asOf")),
    rate: numberValue(formData, "rate", Number.NaN),
    sourceCurrency: value(formData, "sourceCurrency"),
    sourceName: optionalValue(formData, "sourceName")
  });
  revalidatePath("/settings");
  revalidatePath("/");
}

async function buildFormEvidence(
  formData: FormData,
  booking: {
    cancellationDeadline: Date | null;
    checkIn: Date;
    currency: "USD" | "CNY";
    roomType: string;
  },
  cashCurrency: string,
  inventoryType: "cash" | "award",
  sourceType: SourceType,
  roomTypeRaw: string,
  collectionMethod: CollectionMethod,
  existingSnapshotJson?: string
) {
  const conversionAvailable = (await getCurrencyConversion(cashCurrency, booking.currency)) !== null;
  const evidence = buildObservationEvidence({
    bookingCancellationDeadline: booking.cancellationDeadline,
    bookingCheckIn: booking.checkIn,
    bookingCurrency: booking.currency,
    bookingRoomType: booking.roomType,
    cancellationPolicyRaw: optionalValue(formData, "cancellationPolicyRaw"),
    cashCurrency,
    collectionMethod,
    conversionAvailable,
    feesIncluded: optionalBooleanValue(formData, "feesIncluded"),
    hasCashComponent: inventoryType === "award" && optionalNumberValue(formData, "cashCopay") !== null,
    inventoryType,
    loyaltyEligible: optionalBooleanValue(formData, "loyaltyEligible"),
    overrides: {
      cancellationMatch: cancellationMatchOverride(value(formData, "cancellationMatch")),
      roomMatch: roomMatchOverride(value(formData, "roomMatch"))
    },
    roomTypeRaw,
    sourceType,
    sourceUrl: optionalValue(formData, "sourceUrl"),
    taxesIncluded: optionalBooleanValue(formData, "taxesIncluded")
  });
  return {
    blockersJson: toJson(evidence.blockers),
    cancellationAssessmentSource: evidence.cancellationAssessmentSource,
    cancellationMatch: evidence.cancellationMatch,
    cancellationMatchReason: evidence.cancellationMatchReason,
    currencyComparable: evidence.currencyComparable,
    feesIncluded: evidence.feesIncluded,
    loginState: evidence.loginState,
    loyaltyEligibility: evidence.loyaltyEligibility,
    qualityLevel: evidence.qualityLevel,
    roomAssessmentSource: evidence.roomAssessmentSource,
    roomMatch: evidence.roomMatch,
    roomMatchReason: evidence.roomMatchReason,
    snapshotJson: existingSnapshotJson ?? evidence.snapshotJson,
    sourceVerified: evidence.sourceVerified,
    taxesIncluded: evidence.taxesIncluded,
    warningsJson: toJson(evidence.warnings)
  };
}
