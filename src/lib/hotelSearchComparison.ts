import type {
  HotelSearchHotelResult,
  HotelSearchOffer,
  HotelSearchSessionSnapshot
} from "@/lib/hotelSearchSessions";

export type HotelBudgetStatus = "not_requested" | "needs_final_total" | "within_budget" | "over_budget";
export type DestinationGrounding = "matched" | "mismatch" | "unavailable";

export type HotelSearchComparisonRow = {
  budgetStatus: HotelBudgetStatus;
  destinationGrounding: DestinationGrounding;
  finalOffer: HotelSearchOffer | null;
  hotel: HotelSearchHotelResult;
  startingOffer: HotelSearchOffer | null;
};

export type HotelSearchComparison = {
  awaitingFinalTotalCount: number;
  hiddenOverBudgetCount: number;
  rows: HotelSearchComparisonRow[];
  visibleRows: HotelSearchComparisonRow[];
  withinBudgetCount: number;
};

/**
 * One comparison rule shared by the search page and agent surface.
 *
 * A starting Avg/Night may help someone choose which hotel to verify next, but
 * it can never qualify a hotel against a budget because it excludes taxes and
 * fees. Only a same-currency final total with explicit tax and fee inclusion is
 * comparable. Unknowns stay visible so the user has a path to upgrade them.
 */
export function compareHotelSearchSession(session: HotelSearchSessionSnapshot): HotelSearchComparison {
  const rows = session.results.hotels.map((hotel) => rowFor(session, hotel));
  const budgetRequested = session.query.maxStayTotal !== null;
  return {
    awaitingFinalTotalCount: rows.filter((row) => row.budgetStatus === "needs_final_total").length,
    hiddenOverBudgetCount: rows.filter((row) => row.budgetStatus === "over_budget").length,
    rows,
    visibleRows: budgetRequested ? rows.filter((row) => row.budgetStatus !== "over_budget") : rows,
    withinBudgetCount: rows.filter((row) => row.budgetStatus === "within_budget").length
  };
}

function rowFor(session: HotelSearchSessionSnapshot, hotel: HotelSearchHotelResult): HotelSearchComparisonRow {
  const finalOffer = findComparableFinalOffer(hotel.offers, session.query.currency);
  const maxStayTotal = session.query.maxStayTotal;
  const budgetStatus: HotelBudgetStatus = maxStayTotal === null
    ? "not_requested"
    : finalOffer?.stayTotal === null || finalOffer?.stayTotal === undefined
      ? "needs_final_total"
      : finalOffer.stayTotal <= maxStayTotal
        ? "within_budget"
        : "over_budget";
  return {
    budgetStatus,
    destinationGrounding: destinationGrounding(session.query.city, hotel.locationLabel),
    finalOffer,
    hotel,
    startingOffer: findStartingOffer(hotel.offers)
  };
}

export function findStartingOffer(offers: readonly HotelSearchOffer[]) {
  return offers.find((offer) => offer.startingAvgNightlyRate !== null) ?? offers[0] ?? null;
}

function findComparableFinalOffer(offers: readonly HotelSearchOffer[], currency: string) {
  return offers.find((offer) =>
    offer.evidenceLevel === "final_total" &&
    offer.stayTotal !== null &&
    offer.currency === currency &&
    offer.taxesIncluded === "included" &&
    offer.feesIncluded === "included"
  ) ?? null;
}

function destinationGrounding(city: string, locationLabel: string | null): DestinationGrounding {
  if (!locationLabel) {
    return "unavailable";
  }
  const normalizedCity = normalizeDestination(city);
  const normalizedLabel = normalizeDestination(locationLabel);
  if (!normalizedCity || !normalizedLabel) {
    return "unavailable";
  }
  return normalizedLabel.includes(normalizedCity) || normalizedCity.includes(normalizedLabel) ? "matched" : "mismatch";
}

function normalizeDestination(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
