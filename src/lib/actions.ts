"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { inferIsSuite, supportedCurrencyValue } from "@/lib/currency";
import { getHotelPriceTool, type InventoryType } from "@/lib/collectors";
import { createRecommendationForBooking } from "@/lib/recommendations";
import { getSystemCurrency, normalizeMoneyToSystemCurrency } from "@/lib/systemSettings";

function value(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

function optionalValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  return raw.length > 0 ? raw : null;
}

function numberValue(formData: FormData, key: string, fallback = 0) {
  const raw = value(formData, key);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(formData: FormData, key: string) {
  return formData.get(key) === "on" || formData.get(key) === "true";
}

function browserModeValue(raw: string) {
  if (raw === "interactive" || raw === "chrome_profile" || raw === "persistent") {
    return raw === "persistent" ? "chrome_profile" : raw;
  }

  return "headless";
}

function dateValue(formData: FormData, key: string) {
  const raw = value(formData, key);
  if (!raw) {
    return null;
  }
  return new Date(raw);
}

export async function createBooking(formData: FormData) {
  const currency = await getSystemCurrency();
  const roomType = value(formData, "roomType");
  const booking = await prisma.hotelBooking.create({
    data: {
      hotelGroup: value(formData, "hotelGroup"),
      hotelName: value(formData, "hotelName"),
      city: value(formData, "city"),
      checkIn: new Date(value(formData, "checkIn")),
      checkOut: new Date(value(formData, "checkOut")),
      guests: numberValue(formData, "guests", 1),
      roomType,
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomType),
      originalPrice: numberValue(formData, "originalPrice"),
      currency,
      bookingChannel: value(formData, "bookingChannel") || "direct",
      cancellationDeadline: dateValue(formData, "cancellationDeadline"),
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      loyaltyEligible: boolValue(formData, "loyaltyEligible"),
      bookingUrl: optionalValue(formData, "bookingUrl"),
      notes: optionalValue(formData, "notes"),
      watchPlan: {
        create: {
          enabled: true,
          cashEnabled: true,
          awardEnabled: true,
          directEnabled: true,
          otaReferenceEnabled: false,
          browserMode: "chrome_profile"
        }
      }
    }
  });

  revalidatePath("/");
  redirect(`/bookings/${booking.id}`);
}

export async function runPriceCheck(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const booking = await prisma.hotelBooking.findUnique({
    where: { id: bookingId },
    include: { watchPlan: true }
  });
  const profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });

  if (!booking) {
    return;
  }

  const watchPlan =
    booking.watchPlan ??
    (await prisma.watchPlan.create({
      data: {
        bookingId: booking.id,
        enabled: true,
        cashEnabled: true,
        awardEnabled: true,
        directEnabled: true,
        otaReferenceEnabled: false,
        browserMode: "chrome_profile"
      }
    }));

  const inventoryTypes: InventoryType[] = [
    ...(watchPlan.cashEnabled ? (["cash"] as const) : []),
    ...(watchPlan.awardEnabled ? (["award"] as const) : [])
  ];
  const tool = getHotelPriceTool(booking.hotelGroup);
  const browserMode = browserModeValue(watchPlan.browserMode);
  const systemCurrency = await getSystemCurrency();
  const run = await prisma.priceCheckRun.create({
    data: {
      bookingId: booking.id,
      watchPlanId: watchPlan.id,
      status: "running",
      trigger: "manual",
      inventoryTypesJson: JSON.stringify(inventoryTypes),
      collectorName: tool.name
    }
  });

  try {
    const result = await tool.run({
      bookingId: booking.id,
      hotelGroup: booking.hotelGroup,
      hotelName: booking.hotelName,
      city: booking.city,
      checkIn: booking.checkIn,
      checkOut: booking.checkOut,
      guests: booking.guests,
      roomType: booking.roomType,
      currency: booking.currency,
      bookingUrl: booking.bookingUrl,
      inventoryTypes,
      browserMode,
      chromeProfile: {
        profileName: profile?.chromeProfileName ?? "TripBuddy",
        profileDirectory: profile?.chromeProfileDirectory,
        userDataDir: profile?.chromeUserDataDir,
        debugPort: profile?.chromeDebugPort ?? 0
      }
    });

    for (const candidate of result.candidates) {
      const money = await normalizeMoneyToSystemCurrency({
        amount: candidate.price.total,
        basePrice: candidate.price.base,
        taxAmount: candidate.price.taxes,
        feeAmount: candidate.price.fees,
        totalPrice: candidate.price.total,
        cashCopay: candidate.price.cashCopay,
        sourceCurrency: candidate.price.currency || systemCurrency
      });
      await prisma.priceObservation.create({
        data: {
          bookingId: booking.id,
          priceCheckRunId: run.id,
          observedAt: candidate.collectedAt,
          sourceName: candidate.sourceName,
          sourceType: candidate.sourceType,
          collectedBy: "collector",
          collectorName: result.collectorName,
          inventoryType: candidate.inventoryType,
          price: money.price,
          basePrice: money.basePrice,
          taxAmount: money.taxAmount,
          feeAmount: money.feeAmount,
          totalPrice: money.totalPrice,
          pointsPrice: candidate.price.points,
          cashCopay: money.cashCopay,
          currency: money.currency,
          observedCurrency: money.observedCurrency,
          observedPrice: money.observedPrice,
          conversionRate: money.conversionRate,
          rawRateName: candidate.rawRateName,
          ratePlanName: candidate.ratePlanName,
          roomTypeRaw: candidate.room.rawName,
          isSuite: inferIsSuite(candidate.room.rawName),
          roomMatch: candidate.room.match,
          cancellationPolicyRaw: candidate.cancellation.rawPolicy,
          cancellationMatch: candidate.cancellation.match,
          breakfastIncluded: candidate.breakfastIncluded,
          taxesIncluded: candidate.price.taxesIncluded ?? false,
          loyaltyEligible: candidate.loyalty.eligible ?? false,
          sourceUrl: candidate.source.url,
          confidence: candidate.source.verified ? 0.85 : 0.65,
          notes: candidate.room.matchReason
        }
      });
    }

    await prisma.priceCheckRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        finishedAt: new Date(),
        sourceUrl: result.sourceUrl,
        summary: result.summary,
        errorMessage: result.errorMessage
      }
    });

    await prisma.watchPlan.update({
      where: { id: watchPlan.id },
      data: { lastCheckedAt: new Date() }
    });

    if (result.candidates.length > 0) {
      await createRecommendationForBooking(booking.id);
    }
  } catch (error) {
    await prisma.priceCheckRun.update({
      where: { id: run.id },
      data: {
        status: "failed",
        finishedAt: new Date(),
        errorMessage: error instanceof Error ? error.message : "Unknown price check failure"
      }
    });
  }

  revalidatePath("/");
  revalidatePath(`/bookings/${booking.id}`);
}

export async function updateWatchPlan(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  await prisma.watchPlan.upsert({
    where: { bookingId },
    update: {
      cashEnabled: boolValue(formData, "cashEnabled"),
      awardEnabled: boolValue(formData, "awardEnabled"),
      directEnabled: boolValue(formData, "directEnabled"),
      otaReferenceEnabled: boolValue(formData, "otaReferenceEnabled"),
      browserMode: browserModeValue(value(formData, "browserMode")),
      normalCadenceHours: numberValue(formData, "normalCadenceHours", 24),
      urgentCadenceHours: numberValue(formData, "urgentCadenceHours", 6),
      urgentWindowHours: numberValue(formData, "urgentWindowHours", 72)
    },
    create: {
      bookingId,
      enabled: true,
      cashEnabled: boolValue(formData, "cashEnabled"),
      awardEnabled: boolValue(formData, "awardEnabled"),
      directEnabled: boolValue(formData, "directEnabled"),
      otaReferenceEnabled: boolValue(formData, "otaReferenceEnabled"),
      browserMode: browserModeValue(value(formData, "browserMode")),
      normalCadenceHours: numberValue(formData, "normalCadenceHours", 24),
      urgentCadenceHours: numberValue(formData, "urgentCadenceHours", 6),
      urgentWindowHours: numberValue(formData, "urgentWindowHours", 72)
    }
  });

  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function updateBooking(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const currency = await getSystemCurrency();
  const roomType = value(formData, "roomType");
  await prisma.hotelBooking.update({
    where: { id: bookingId },
    data: {
      hotelGroup: value(formData, "hotelGroup"),
      hotelName: value(formData, "hotelName"),
      city: value(formData, "city"),
      checkIn: new Date(value(formData, "checkIn")),
      checkOut: new Date(value(formData, "checkOut")),
      guests: numberValue(formData, "guests", 1),
      roomType,
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomType),
      originalPrice: numberValue(formData, "originalPrice"),
      currency,
      bookingChannel: value(formData, "bookingChannel") || "direct",
      cancellationDeadline: dateValue(formData, "cancellationDeadline"),
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      loyaltyEligible: boolValue(formData, "loyaltyEligible"),
      bookingUrl: optionalValue(formData, "bookingUrl"),
      notes: optionalValue(formData, "notes")
    }
  });

  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function addObservation(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const sourceCurrency = value(formData, "currency");
  const money = await normalizeMoneyToSystemCurrency({
    amount: numberValue(formData, "price"),
    sourceCurrency
  });
  const roomTypeRaw = value(formData, "roomTypeRaw");
  await prisma.priceObservation.create({
    data: {
      bookingId,
      sourceName: value(formData, "sourceName"),
      sourceType: value(formData, "sourceType") || "direct",
      price: money.price,
      currency: money.currency,
      observedCurrency: money.observedCurrency,
      observedPrice: money.observedPrice,
      conversionRate: money.conversionRate,
      roomTypeRaw,
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomTypeRaw),
      roomMatch: value(formData, "roomMatch") || "unknown",
      cancellationPolicyRaw: value(formData, "cancellationPolicyRaw"),
      cancellationMatch: value(formData, "cancellationMatch") || "unknown",
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      taxesIncluded: boolValue(formData, "taxesIncluded"),
      loyaltyEligible: boolValue(formData, "loyaltyEligible"),
      sourceUrl: optionalValue(formData, "sourceUrl"),
      confidence: value(formData, "sourceType") === "direct" ? 0.85 : 0.7,
      notes: optionalValue(formData, "notes")
    }
  });

  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function updateObservation(formData: FormData) {
  const observationId = value(formData, "observationId");
  const bookingId = value(formData, "bookingId");
  const sourceCurrency = value(formData, "currency");
  const money = await normalizeMoneyToSystemCurrency({
    amount: numberValue(formData, "price"),
    sourceCurrency
  });
  const roomTypeRaw = value(formData, "roomTypeRaw");
  await prisma.priceObservation.update({
    where: { id: observationId },
    data: {
      sourceName: value(formData, "sourceName"),
      sourceType: value(formData, "sourceType") || "direct",
      price: money.price,
      currency: money.currency,
      observedCurrency: money.observedCurrency,
      observedPrice: money.observedPrice,
      conversionRate: money.conversionRate,
      roomTypeRaw,
      isSuite: boolValue(formData, "isSuite") || inferIsSuite(roomTypeRaw),
      roomMatch: value(formData, "roomMatch") || "unknown",
      cancellationPolicyRaw: value(formData, "cancellationPolicyRaw"),
      cancellationMatch: value(formData, "cancellationMatch") || "unknown",
      breakfastIncluded: boolValue(formData, "breakfastIncluded"),
      taxesIncluded: boolValue(formData, "taxesIncluded"),
      loyaltyEligible: boolValue(formData, "loyaltyEligible"),
      sourceUrl: optionalValue(formData, "sourceUrl"),
      confidence: value(formData, "sourceType") === "direct" ? 0.85 : 0.7,
      notes: optionalValue(formData, "notes")
    }
  });

  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
  redirect(`/bookings/${bookingId}`);
}

export async function deleteObservation(formData: FormData) {
  const observationId = value(formData, "observationId");
  const bookingId = value(formData, "bookingId");
  const observation = await prisma.priceObservation.findUnique({
    where: { id: observationId }
  });

  if (!observation || observation.bookingId !== bookingId) {
    return;
  }

  await prisma.priceObservation.delete({
    where: { id: observationId }
  });

  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function promoteObservationToBooking(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  const observationId = value(formData, "observationId");
  const observation = await prisma.priceObservation.findUnique({
    where: { id: observationId }
  });

  if (!observation || observation.bookingId !== bookingId) {
    return;
  }

  await prisma.hotelBooking.update({
    where: { id: bookingId },
    data: {
      originalPrice: observation.price,
      currency: observation.currency,
      bookingChannel: observation.sourceType,
      roomType: observation.roomTypeRaw,
      isSuite: observation.isSuite,
      breakfastIncluded: observation.breakfastIncluded,
      loyaltyEligible: observation.loyaltyEligible,
      bookingUrl: observation.sourceUrl
    }
  });

  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}

export async function createPromotion(formData: FormData) {
  await prisma.promotion.create({
    data: {
      hotelGroup: value(formData, "hotelGroup"),
      title: value(formData, "title"),
      description: optionalValue(formData, "description"),
      startDate: dateValue(formData, "startDate"),
      endDate: dateValue(formData, "endDate"),
      bonusMultiplier: numberValue(formData, "bonusMultiplier"),
      flatValue: numberValue(formData, "flatValue"),
      requiresRegistration: boolValue(formData, "requiresRegistration"),
      appliesToExistingBookings: boolValue(formData, "appliesToExistingBookings"),
      sourceUrl: optionalValue(formData, "sourceUrl")
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
    create: { id: "primary", displayCurrency: defaultCurrency }
  });

  await prisma.userProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    update: {
      name: value(formData, "name") || "Primary Traveler",
      defaultCurrency,
      savingsThreshold: numberValue(formData, "savingsThreshold", 50),
      urgentWindowHours: numberValue(formData, "urgentWindowHours", 24),
      breakfastValue: numberValue(formData, "breakfastValue", 25),
      loungeValue: numberValue(formData, "loungeValue", 35),
      lateCheckoutValue: numberValue(formData, "lateCheckoutValue", 15),
      upgradeValue: numberValue(formData, "upgradeValue", 40),
      eliteNightValue: numberValue(formData, "eliteNightValue", 10)
    },
    create: {
      id: DEFAULT_PROFILE_ID,
      name: value(formData, "name") || "Primary Traveler",
      defaultCurrency,
      savingsThreshold: numberValue(formData, "savingsThreshold", 50),
      urgentWindowHours: numberValue(formData, "urgentWindowHours", 24),
      breakfastValue: numberValue(formData, "breakfastValue", 25),
      loungeValue: numberValue(formData, "loungeValue", 35),
      lateCheckoutValue: numberValue(formData, "lateCheckoutValue", 15),
      upgradeValue: numberValue(formData, "upgradeValue", 40),
      eliteNightValue: numberValue(formData, "eliteNightValue", 10)
    }
  });

  const groups = ["Hyatt", "IHG", "Marriott", "Hilton", "Accor"];
  for (const group of groups) {
    await prisma.loyaltyAccount.upsert({
      where: {
        profileId_hotelGroup: {
          profileId: DEFAULT_PROFILE_ID,
          hotelGroup: group
        }
      },
      update: {
        tier: value(formData, `${group}_tier`),
        currentNights: numberValue(formData, `${group}_currentNights`),
        currentPoints: numberValue(formData, `${group}_currentPoints`),
        currentSpend: numberValue(formData, `${group}_currentSpend`),
        targetTier: optionalValue(formData, `${group}_targetTier`),
        pointValue: numberValue(formData, `${group}_pointValue`)
      },
      create: {
        profileId: DEFAULT_PROFILE_ID,
        hotelGroup: group,
        tier: value(formData, `${group}_tier`),
        currentNights: numberValue(formData, `${group}_currentNights`),
        currentPoints: numberValue(formData, `${group}_currentPoints`),
        currentSpend: numberValue(formData, `${group}_currentSpend`),
        targetTier: optionalValue(formData, `${group}_targetTier`),
        pointValue: numberValue(formData, `${group}_pointValue`)
      }
    });
  }

  revalidatePath("/profile");
  revalidatePath("/");
}

export async function updateChromeSettings(formData: FormData) {
  await prisma.userProfile.upsert({
    where: { id: DEFAULT_PROFILE_ID },
    update: {
      chromeProfileName: value(formData, "chromeProfileName") || "TripBuddy",
      chromeProfileDirectory: optionalValue(formData, "chromeProfileDirectory"),
      chromeUserDataDir: optionalValue(formData, "chromeUserDataDir"),
      chromeDebugPort: numberValue(formData, "chromeDebugPort", 0)
    },
    create: {
      id: DEFAULT_PROFILE_ID,
      chromeProfileName: value(formData, "chromeProfileName") || "TripBuddy",
      chromeProfileDirectory: optionalValue(formData, "chromeProfileDirectory"),
      chromeUserDataDir: optionalValue(formData, "chromeUserDataDir"),
      chromeDebugPort: numberValue(formData, "chromeDebugPort", 0)
    }
  });

  revalidatePath("/settings");
}

export async function createCreditCardBenefit(formData: FormData) {
  await prisma.creditCardBenefit.create({
    data: {
      profileId: DEFAULT_PROFILE_ID,
      name: value(formData, "name"),
      hotelGroup: optionalValue(formData, "hotelGroup"),
      cashBackRate: numberValue(formData, "cashBackRate"),
      pointMultiplier: numberValue(formData, "pointMultiplier"),
      eliteNightCredits: numberValue(formData, "eliteNightCredits"),
      notes: optionalValue(formData, "notes")
    }
  });

  revalidatePath("/profile");
}

export async function createRecommendationAction(formData: FormData) {
  const bookingId = value(formData, "bookingId");
  await createRecommendationForBooking(bookingId);
  revalidatePath("/");
  revalidatePath(`/bookings/${bookingId}`);
}
