import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import {
  parseHotelSearchQuery,
  parseHotelSearchSessionResults,
  serializeHotelSearchQuery,
  serializeHotelSearchSessionResults
} from "@/lib/hotelSearchSessionCodecs";
import { hotelStayNights } from "@/lib/hotelSearchBudget";
import type { HotelSearchQuery, HotelSearchResult } from "@/lib/providers/types";

export const HOTEL_SEARCH_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type SearchPriceInclusion = "included" | "excluded" | "unknown";
export type SearchPriceUnit = "avg_nightly" | "stay_total";
export type SearchEvidenceLevel = "starting_price" | "verified_offer" | "final_total";

export type HotelSearchOffer = {
  breakfastIncluded: boolean | null;
  cancellationPolicy: string | null;
  capturedAt: string;
  comparisonWarnings: string[];
  currency: string;
  displayedAmount: number;
  displayedPriceBasis: "tax_exclusive" | "tax_inclusive" | "unknown";
  displayedPriceUnit: SearchPriceUnit;
  eliteNightEligible: boolean | null;
  evidenceLevel: SearchEvidenceLevel;
  feesAmount: number | null;
  feesIncluded: SearchPriceInclusion;
  hotelGroup: string;
  loyaltyEligible: boolean | null;
  nights: number;
  offerKey: string;
  providerName: string;
  ratePlanName: string | null;
  roomType: string | null;
  sourceName: string;
  sourceType: "direct" | "ota" | "other";
  sourceUrl: string;
  startingAvgNightlyRate: number | null;
  staySubtotal: number | null;
  stayTotal: number | null;
  /** Populated for points searches; legacy cash offers omit this field. */
  startingPointsPerNight?: number | null;
  taxesAmount: number | null;
  taxesAndFeesAmount: number | null;
  taxesIncluded: SearchPriceInclusion;
};

export type HotelSearchHotelResult = {
  availabilityLabel: string;
  hotelGroup: string;
  hotelKey: string;
  hotelName: string;
  locationLabel: string | null;
  offers: HotelSearchOffer[];
};

export type HotelSearchSessionResults = {
  capturedAt: string | null;
  hotels: HotelSearchHotelResult[];
  summary: string | null;
  warning: string | null;
};

export type HotelSearchSessionSnapshot = {
  createdAt: string;
  expiresAt: string;
  id: string;
  profileId: string;
  query: HotelSearchQuery;
  results: HotelSearchSessionResults;
  updatedAt: string;
};

const EMPTY_RESULTS: HotelSearchSessionResults = {
  capturedAt: null,
  hotels: [],
  summary: null,
  warning: null
};

export async function createHotelSearchSession(query: HotelSearchQuery) {
  const now = new Date();
  await prisma.hotelSearchSession.deleteMany({ where: { expiresAt: { lte: now } } });
  const session = await prisma.hotelSearchSession.create({
    data: {
      expiresAt: new Date(now.getTime() + HOTEL_SEARCH_SESSION_TTL_MS),
      profileId: DEFAULT_PROFILE_ID,
      queryJson: serializeHotelSearchQuery(query),
      resultsJson: serializeHotelSearchSessionResults(EMPTY_RESULTS)
    }
  });
  return serializeHotelSearchSession(session);
}

export async function getHotelSearchSession(sessionId: string) {
  const session = await prisma.hotelSearchSession.findFirst({
    where: { expiresAt: { gt: new Date() }, id: sessionId }
  });
  return session ? serializeHotelSearchSession(session) : null;
}

export async function replaceOfficialSearchResults(input: {
  capturedAt: string;
  hotelGroup: string;
  results: HotelSearchResult[];
  searchSessionId: string;
  summary: string;
  warning: string | null;
}) {
  const session = await getHotelSearchSession(input.searchSessionId);
  if (!session) {
    return null;
  }
  const nights = hotelStayNights(session.query.checkIn, session.query.checkOut);
  const hotels = input.results.map((result) => {
    const hotelKey = buildHotelKey(input.hotelGroup, result.hotelName, session.query.city);
    const offer: HotelSearchOffer = {
      breakfastIncluded: null,
      cancellationPolicy: null,
      capturedAt: input.capturedAt,
      comparisonWarnings: ["Starting price only; room and rate-plan equivalence are not verified."],
      currency: result.priceMode === "points" ? "PTS" : result.currency,
      displayedAmount: result.priceMode === "points" ? result.pointsPerNight ?? 0 : result.avgNightlyRate ?? 0,
      displayedPriceBasis: result.priceMode === "points" ? "unknown" : "tax_exclusive",
      displayedPriceUnit: "avg_nightly",
      eliteNightEligible: true,
      evidenceLevel: "starting_price",
      feesAmount: null,
      feesIncluded: "excluded",
      hotelGroup: input.hotelGroup,
      loyaltyEligible: true,
      nights,
      offerKey: buildOfferKey("direct", `${input.hotelGroup} official`, hotelKey),
      providerName: input.hotelGroup,
      ratePlanName: null,
      roomType: null,
      sourceName: `${input.hotelGroup} official`,
      sourceType: "direct",
      sourceUrl: result.sourceUrl,
      startingAvgNightlyRate: result.avgNightlyRate,
      staySubtotal: result.priceMode === "points" || result.avgNightlyRate === null
        ? null
        : roundMoney(result.avgNightlyRate * nights),
      stayTotal: null,
      ...(result.priceMode === "points" ? { startingPointsPerNight: result.pointsPerNight } : {}),
      taxesAmount: null,
      taxesAndFeesAmount: null,
      taxesIncluded: "excluded"
    };
    return {
      availabilityLabel: result.availabilityLabel,
      hotelGroup: input.hotelGroup,
      hotelKey,
      hotelName: result.hotelName,
      locationLabel: result.locationLabel,
      offers: [offer]
    } satisfies HotelSearchHotelResult;
  });
  return updateSessionResults(input.searchSessionId, {
    capturedAt: input.capturedAt,
    hotels,
    summary: input.summary,
    warning: input.warning
  });
}

export async function recordOfficialFinalTotal(input: {
  breakfastIncluded: boolean | null;
  cancellationPolicy: string | null;
  capturedAt: string;
  currency: string;
  feesAmount: number | null;
  hotelGroup: string;
  hotelName: string;
  ratePlanName: string | null;
  roomType: string | null;
  searchSessionId: string;
  sourceUrl: string;
  staySubtotal: number | null;
  stayTotal: number;
  taxesAmount: number | null;
  taxesAndFeesAmount: number | null;
}) {
  const session = await getHotelSearchSession(input.searchSessionId);
  if (!session) {
    return null;
  }
  const hotelKey = buildHotelKey(input.hotelGroup, input.hotelName, session.query.city);
  const existingHotel = session.results.hotels.find((hotel) => hotel.hotelKey === hotelKey);
  const sourceName = `${input.hotelGroup} official`;
  const offerKey = buildOfferKey("direct", sourceName, hotelKey);
  const existingOffer = existingHotel?.offers.find((offer) => offer.offerKey === offerKey);
  const finalOffer: HotelSearchOffer = {
    breakfastIncluded: input.breakfastIncluded,
    cancellationPolicy: input.cancellationPolicy,
    capturedAt: input.capturedAt,
    comparisonWarnings: [],
    currency: input.currency,
    displayedAmount: existingOffer?.displayedAmount ?? input.stayTotal,
    displayedPriceBasis: existingOffer?.displayedPriceBasis ?? "tax_inclusive",
    displayedPriceUnit: existingOffer?.displayedPriceUnit ?? "stay_total",
    eliteNightEligible: true,
    evidenceLevel: "final_total",
    feesAmount: input.feesAmount,
    feesIncluded: "included",
    hotelGroup: input.hotelGroup,
    loyaltyEligible: true,
    nights: hotelStayNights(session.query.checkIn, session.query.checkOut),
    offerKey,
    providerName: input.hotelGroup,
    ratePlanName: input.ratePlanName,
    roomType: input.roomType,
    sourceName,
    sourceType: "direct",
    sourceUrl: input.sourceUrl,
    startingAvgNightlyRate: existingOffer?.startingAvgNightlyRate ?? null,
    staySubtotal: input.staySubtotal,
    stayTotal: input.stayTotal,
    taxesAmount: input.taxesAmount,
    taxesAndFeesAmount: input.taxesAndFeesAmount,
    taxesIncluded: "included"
  };
  const hotels = existingHotel
    ? session.results.hotels.map((hotel) =>
        hotel.hotelKey === hotelKey
          ? { ...hotel, offers: replaceOffer(hotel.offers, finalOffer) }
          : hotel
      )
    : [
        ...session.results.hotels,
        {
          availabilityLabel: "Available",
          hotelGroup: input.hotelGroup,
          hotelKey,
          hotelName: input.hotelName,
          locationLabel: null,
          offers: [finalOffer]
        }
      ];
  return updateSessionResults(input.searchSessionId, {
    ...session.results,
    capturedAt: input.capturedAt,
    hotels
  });
}

export function hotelSearchQueriesMatch(left: HotelSearchQuery, right: HotelSearchQuery) {
  return (
    left.adults === right.adults &&
    left.checkIn === right.checkIn &&
    left.checkOut === right.checkOut &&
    left.city.trim().toLowerCase() === right.city.trim().toLowerCase() &&
    left.currency === right.currency &&
    left.hotelGroup === right.hotelGroup &&
    (left.priceMode ?? "cash") === (right.priceMode ?? "cash")
  );
}

function replaceOffer(offers: HotelSearchOffer[], replacement: HotelSearchOffer) {
  const found = offers.some((offer) => offer.offerKey === replacement.offerKey);
  return found
    ? offers.map((offer) => (offer.offerKey === replacement.offerKey ? replacement : offer))
    : [...offers, replacement];
}

async function updateSessionResults(searchSessionId: string, results: HotelSearchSessionResults) {
  const session = await prisma.hotelSearchSession.update({
    data: { resultsJson: serializeHotelSearchSessionResults(results) },
    where: { id: searchSessionId }
  });
  return serializeHotelSearchSession(session);
}

function serializeHotelSearchSession(session: {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  profileId: string;
  queryJson: string;
  resultsJson: string;
  updatedAt: Date;
}): HotelSearchSessionSnapshot {
  return {
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    id: session.id,
    profileId: session.profileId,
    query: parseHotelSearchQuery(session.queryJson, emptyQuery()),
    results: parseHotelSearchSessionResults(session.resultsJson, EMPTY_RESULTS),
    updatedAt: session.updatedAt.toISOString()
  };
}

function buildHotelKey(hotelGroup: string, hotelName: string, city: string) {
  return `${normalizeKey(hotelGroup)}:${normalizeKey(city)}:${normalizeKey(hotelName)}`;
}

function buildOfferKey(sourceType: string, sourceName: string, hotelKey: string) {
  return `${normalizeKey(sourceType)}:${normalizeKey(sourceName)}:${hotelKey}`;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function emptyQuery(): HotelSearchQuery {
  return {
    adults: 1,
    budget: null,
    checkIn: "",
    checkOut: "",
    city: "",
    cityAsAsked: "",
    currency: "USD",
    hotelGroup: ""
  };
}
