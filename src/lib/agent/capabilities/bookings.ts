import { argsBag, optionalEnum, requireString } from "@/lib/agent/args";
import { calendarDate, instant } from "@/lib/agent/serialize";
import type { Capability } from "@/lib/agent/types";
import { currentLocalDayAsCalendarDate } from "@/lib/bookingDates";
import { prisma } from "@/lib/db";
import { nightsBetween } from "@/lib/format";
import { stringList } from "@/lib/json";
import { parseRecommendationCostBreakdown } from "@/lib/recommendationCodecs";

const SCOPES = ["upcoming", "all"] as const;

export type BookingSummary = {
  bookingId: string;
  checkIn: string;
  checkOut: string;
  city: string;
  currency: string;
  hotelGroup: string;
  hotelName: string;
  nights: number;
  /* Enums stay as stored values; `@/lib/labels` resolves them at render time. */
  baselineType: string;
  baselineCashTotal: number | null;
  baselinePoints: number | null;
  cancellationDeadline: string | null;
  estimatedSavings: number | null;
  lastObservedAt: string | null;
  qualityLevel: string | null;
  riskLevel: string | null;
  verdict: string | null;
  watchEnabled: boolean;
};

export const listBookings: Capability<{ scope: "upcoming" | "all" }, { bookings: BookingSummary[] }> = {
  name: "list_bookings",
  keywords: ["bookings", "stays", "reservations", "watchlist", "trips", "my stays"],
  summary: "List tracked hotel bookings with their current verdict and evidence quality.",
  effect: "read",
  params: [
    {
      description: "Which stays to include. Defaults to upcoming, meaning check-in is today or later.",
      enumValues: SCOPES,
      name: "scope",
      required: false,
      type: "enum"
    }
  ],
  parseArgs(raw) {
    const bag = argsBag(raw, ["scope"]);
    return { scope: optionalEnum(bag, "scope", SCOPES) ?? "upcoming" };
  },
  async run({ scope }) {
    const bookings = await prisma.hotelBooking.findMany({
      where: scope === "upcoming" ? { checkIn: { gte: currentLocalDayAsCalendarDate(new Date()) } } : {},
      orderBy: { checkIn: "asc" },
      include: {
        observations: { orderBy: { observedAt: "desc" }, take: 1 },
        recommendations: { where: { candidateObservationId: { not: null } }, orderBy: { generatedAt: "desc" }, take: 1 },
        watchPlan: true
      }
    });

    return {
      bookings: bookings.map((booking): BookingSummary => {
        const recommendation = booking.recommendations[0];
        return {
          bookingId: booking.id,
          baselineCashTotal: booking.baselineCashTotal,
          baselinePoints: booking.baselinePoints,
          baselineType: booking.baselineType,
          cancellationDeadline: instant(booking.cancellationDeadline),
          checkIn: calendarDate(booking.checkIn),
          checkOut: calendarDate(booking.checkOut),
          city: booking.city,
          currency: booking.currency,
          estimatedSavings: recommendation?.estimatedSavings ?? null,
          hotelGroup: booking.hotelGroup,
          hotelName: booking.hotelName,
          lastObservedAt: instant(booking.observations[0]?.observedAt),
          nights: nightsBetween(booking.checkIn, booking.checkOut),
          qualityLevel: recommendation?.qualityLevel ?? null,
          riskLevel: recommendation?.riskLevel ?? null,
          verdict: recommendation?.verdict ?? null,
          watchEnabled: booking.watchPlan?.enabled ?? false
        };
      })
    };
  }
};

export type BookingDetail = BookingSummary & {
  bookingChannel: string | null;
  breakfastIncluded: boolean;
  guests: number;
  isSuite: boolean;
  loyaltyEligible: boolean;
  roomType: string | null;
  watchPlan: {
    awardEnabled: boolean;
    cashEnabled: boolean;
    consecutiveFailures: number;
    enabled: boolean;
    lastCheckedAt: string | null;
    normalCadenceHours: number;
    urgentCadenceHours: number;
    urgentWindowHours: number;
  } | null;
};

export const getBooking: Capability<{ bookingId: string }, { booking: BookingDetail | null }> = {
  name: "get_booking",
  keywords: ["booking", "stay", "reservation", "watch plan"],
  summary: "Read one booking in full, including its watch plan and current verdict.",
  effect: "read",
  params: [{ description: "The booking identifier.", name: "bookingId", required: true, type: "string" }],
  parseArgs(raw) {
    const bag = argsBag(raw, ["bookingId"]);
    return { bookingId: requireString(bag, "bookingId") };
  },
  async run({ bookingId }) {
    const booking = await prisma.hotelBooking.findUnique({
      where: { id: bookingId },
      include: {
        observations: { orderBy: { observedAt: "desc" }, take: 1 },
        recommendations: { where: { candidateObservationId: { not: null } }, orderBy: { generatedAt: "desc" }, take: 1 },
        watchPlan: true
      }
    });
    if (!booking) {
      return { booking: null };
    }

    const recommendation = booking.recommendations[0];
    const plan = booking.watchPlan;
    return {
      booking: {
        bookingId: booking.id,
        baselineCashTotal: booking.baselineCashTotal,
        baselinePoints: booking.baselinePoints,
        baselineType: booking.baselineType,
        bookingChannel: booking.bookingChannel,
        breakfastIncluded: booking.breakfastIncluded,
        cancellationDeadline: instant(booking.cancellationDeadline),
        checkIn: calendarDate(booking.checkIn),
        checkOut: calendarDate(booking.checkOut),
        city: booking.city,
        currency: booking.currency,
        estimatedSavings: recommendation?.estimatedSavings ?? null,
        guests: booking.guests,
        hotelGroup: booking.hotelGroup,
        hotelName: booking.hotelName,
        isSuite: booking.isSuite,
        lastObservedAt: instant(booking.observations[0]?.observedAt),
        loyaltyEligible: booking.loyaltyEligible,
        nights: nightsBetween(booking.checkIn, booking.checkOut),
        qualityLevel: recommendation?.qualityLevel ?? null,
        riskLevel: recommendation?.riskLevel ?? null,
        roomType: booking.roomType,
        verdict: recommendation?.verdict ?? null,
        watchEnabled: plan?.enabled ?? false,
        watchPlan: plan
          ? {
              awardEnabled: plan.awardEnabled,
              cashEnabled: plan.cashEnabled,
              consecutiveFailures: plan.consecutiveFailures,
              enabled: plan.enabled,
              lastCheckedAt: instant(plan.lastCheckedAt),
              normalCadenceHours: plan.normalCadenceHours,
              urgentCadenceHours: plan.urgentCadenceHours,
              urgentWindowHours: plan.urgentWindowHours
            }
          : null
      }
    };
  }
};

export type ObservationRecord = {
  cancellationMatch: string | null;
  cashCurrency: string | null;
  cashTotal: number | null;
  collectionMethod: string;
  extractionSource: string;
  inventoryType: string;
  observationId: string;
  observedAt: string;
  points: number | null;
  qualityLevel: string | null;
  ratePlanName: string | null;
  roomMatch: string | null;
  roomTypeRaw: string | null;
  sourceName: string;
  sourceType: string;
};

export const getPriceHistory: Capability<
  { bookingId: string },
  { observations: ObservationRecord[]; runs: { finishedAt: string | null; runId: string; startedAt: string; status: string; summary: string | null; trigger: string }[] }
> = {
  name: "get_price_history",
  keywords: ["history", "observations", "past prices", "logs", "previous checks"],
  summary: "Read the observation and price-check history recorded for one booking.",
  effect: "read",
  params: [{ description: "The booking identifier.", name: "bookingId", required: true, type: "string" }],
  parseArgs(raw) {
    const bag = argsBag(raw, ["bookingId"]);
    return { bookingId: requireString(bag, "bookingId") };
  },
  async run({ bookingId }) {
    const [observations, runs] = await Promise.all([
      prisma.priceObservation.findMany({
        where: { bookingId },
        include: { evidence: true },
        orderBy: { observedAt: "desc" }
      }),
      prisma.priceCheckRun.findMany({ where: { bookingId }, orderBy: { startedAt: "desc" } })
    ]);

    return {
      observations: observations.map((observation) => ({
        cancellationMatch: observation.evidence?.cancellationMatch ?? null,
        cashCurrency: observation.cashCurrency,
        cashTotal: observation.cashTotal,
        collectionMethod: observation.collectionMethod,
        extractionSource: observation.extractionSource,
        inventoryType: observation.inventoryType,
        observationId: observation.id,
        observedAt: observation.observedAt.toISOString(),
        points: observation.points,
        qualityLevel: observation.evidence?.qualityLevel ?? null,
        ratePlanName: observation.ratePlanName,
        roomMatch: observation.evidence?.roomMatch ?? null,
        roomTypeRaw: observation.roomTypeRaw,
        sourceName: observation.sourceName,
        sourceType: observation.sourceType
      })),
      runs: runs.map((run) => ({
        finishedAt: instant(run.finishedAt),
        runId: run.id,
        startedAt: run.startedAt.toISOString(),
        status: run.status,
        summary: run.summary,
        trigger: run.trigger
      }))
    };
  }
};

export type RecommendationExplanation = {
  blockers: string[];
  costBreakdown: ReturnType<typeof parseRecommendationCostBreakdown>;
  currency: string;
  decisionProvider: string;
  decisionVersion: string;
  estimatedSavings: number;
  explanation: string;
  generatedAt: string;
  qualityLevel: string;
  riskLevel: string;
  verdict: string;
  warnings: string[];
};

export const explainRecommendation: Capability<
  { bookingId: string },
  { bookingFound: boolean; recommendation: RecommendationExplanation | null }
> = {
  name: "explain_recommendation",
  keywords: ["why", "explain", "verdict", "reason", "breakdown", "savings", "recommendation"],
  summary: "Explain the current verdict for a booking, with its cost breakdown, blockers, and warnings.",
  effect: "read",
  params: [{ description: "The booking identifier.", name: "bookingId", required: true, type: "string" }],
  parseArgs(raw) {
    const bag = argsBag(raw, ["bookingId"]);
    return { bookingId: requireString(bag, "bookingId") };
  },
  async run({ bookingId }) {
    /*
     * "No booking with that id" and "this booking has no verdict yet" are
     * different answers, and collapsing them sent the reader the wrong way. A
     * stale identifier was reported as a booking awaiting its first check, so
     * the model explained the absence instead of going to find the right id.
     */
    const booking = await prisma.hotelBooking.findUnique({ select: { id: true }, where: { id: bookingId } });
    if (!booking) {
      return { bookingFound: false, recommendation: null };
    }
    const recommendation = await prisma.recommendation.findFirst({
      where: { bookingId, candidateObservationId: { not: null } },
      orderBy: { generatedAt: "desc" }
    });
    if (!recommendation) {
      return { bookingFound: true, recommendation: null };
    }

    return {
      bookingFound: true,
      recommendation: {
        blockers: stringList(recommendation.blockersJson),
        costBreakdown: parseRecommendationCostBreakdown(recommendation.costBreakdownJson),
        currency: recommendation.currency,
        decisionProvider: recommendation.decisionProvider,
        decisionVersion: recommendation.decisionVersion,
        estimatedSavings: recommendation.estimatedSavings,
        explanation: recommendation.explanation,
        generatedAt: recommendation.generatedAt.toISOString(),
        qualityLevel: recommendation.qualityLevel,
        riskLevel: recommendation.riskLevel,
        verdict: recommendation.verdict,
        warnings: stringList(recommendation.warningsJson)
      }
    };
  }
};
