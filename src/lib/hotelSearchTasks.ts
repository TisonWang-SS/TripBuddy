import { randomUUID } from "node:crypto";
import taskProtocol from "@extension/taskProtocol.js";
import type { BrowserTaskDefinition } from "@/lib/browserTaskDefinition";
import {
  parseHotelSearchTaskContext,
  type HotelSearchTaskContext
} from "@/lib/browserTaskCodecs";
import {
  addBrowserTaskHash,
  appendBrowserSnapshot,
  BrowserTaskError,
  createBrowserTask,
  finishBrowserTask,
  getBrowserTask,
  normalizeBrowserSnapshot,
  serializeTaskState,
  stripBrowserTaskHash,
  type BrowserTaskCapture
} from "@/lib/browserTasks";
import {
  appendHotelSearchOffers,
  createHotelSearchSession,
  getHotelSearchSession,
  hotelSearchQueriesMatch,
  recordOfficialFinalTotal,
  replaceOfficialSearchResults
} from "@/lib/hotelSearchSessions";
import { getProfileSearchCurrency } from "@/lib/profilePreferences";
import { getBookingPriceProvider, getHotelOtaPriceProvider, getHotelSearchProvider, listSearchableHotelGroups } from "@/lib/providers/registry";
import type { BookingPriceInput, HotelSearchQuery } from "@/lib/providers/types";
import type { HotelSearchOfferDraft } from "@/lib/hotelSearchSessions";

type HotelSearchTaskMode = "city_results" | "city_points" | "tax_inclusive_total";

export type HotelSearchTaskInput = Partial<HotelSearchQuery> & {
  hotelName?: unknown;
  mode?: unknown;
  searchSessionId?: unknown;
};

export function supportedHotelSearchGroups() {
  return listSearchableHotelGroups();
}

export async function createHotelSearchTask(input: HotelSearchTaskInput) {
  const hotelGroup = String(input.hotelGroup ?? "Hyatt");
  const provider = getHotelSearchProvider(hotelGroup);
  if (!provider) {
    throw new BrowserTaskError("provider_unavailable", `No city-search provider is available for ${hotelGroup}.`, 400);
  }
  const requestedCurrency = String(input.currency ?? "").trim().toUpperCase();
  const profileCurrency = await getProfileSearchCurrency();
  if (requestedCurrency && requestedCurrency !== profileCurrency) {
    throw new BrowserTaskError(
      "currency_mismatch",
      `City search uses the profile currency (${profileCurrency}). Update it in Profile before searching.`,
      400
    );
  }
  const { errors, query } = provider.normalizeSearchQuery({ ...input, currency: profileCurrency });
  if (errors.length > 0) {
    throw new BrowserTaskError("invalid_search", errors.join(" "), 400);
  }
  const mode: HotelSearchTaskMode = input.mode === "tax_inclusive_total"
    ? "tax_inclusive_total"
    : query.priceMode === "points"
      ? "city_points"
      : "city_results";
  const hotelName = mode === "tax_inclusive_total" ? String(input.hotelName ?? "").trim() : null;
  if (mode === "tax_inclusive_total" && !hotelName) {
    throw new BrowserTaskError("hotel_name_required", "Choose a hotel before requesting a tax-inclusive total.", 400);
  }
  let searchSessionId: string;
  if (mode !== "tax_inclusive_total") {
    searchSessionId = (await createHotelSearchSession(query)).id;
  } else {
    searchSessionId = String(input.searchSessionId ?? "").trim();
    if (!searchSessionId) {
      throw new BrowserTaskError(
        "search_session_required",
        "Start a city search before requesting a tax-inclusive total.",
        400
      );
    }
    const searchSession = await getHotelSearchSession(searchSessionId);
    if (!searchSession) {
      throw new BrowserTaskError(
        "search_session_expired",
        "The hotel search session expired. Run the city search again.",
        404
      );
    }
    if (!hotelSearchQueriesMatch(searchSession.query, query)) {
      throw new BrowserTaskError(
        "search_session_mismatch",
        "The tax-inclusive request does not match the saved hotel search conditions.",
        409
      );
    }
  }
  const taskId = randomUUID();
  const launchUrl = addRequestedCurrency(addBrowserTaskHash(provider.buildSearchUrl(query), taskId), query.currency);
  const task = await createBrowserTask({
    context: { hotelName, mode, query, searchSessionId } satisfies HotelSearchTaskContext,
    hotelGroup,
    id: taskId,
    kind: "hotel_search",
    launchUrl
  });
  return { ...serializeTaskState({ ...task, priceCheckRun: null }), searchSessionId };
}

export async function captureHotelSearchTask(taskId: string, capture: BrowserTaskCapture) {
  const task = await getBrowserTask(taskId);
  if (!task || task.kind !== "hotel_search") {
    throw new BrowserTaskError("task_not_found", "Hotel-search task was not found or expired.", 404);
  }
  if (task.status !== "pending" && task.status !== "running") {
    return serializeTaskState(task);
  }
  if (capture.errorMessage) {
    await finishBrowserTask({
      errorCode: capture.errorCode ?? "browser_capture_failed",
      errorMessage: capture.errorMessage,
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }

  const snapshot = normalizeBrowserSnapshot(capture.snapshot);
  if (!snapshot) {
    throw new BrowserTaskError("invalid_snapshot", "A readable hotel-search snapshot is required.", 400);
  }
  const provider = getHotelSearchProvider(task.hotelGroup);
  if (!provider) {
    throw new BrowserTaskError(
      "provider_unavailable",
      `No city-search provider is available for ${task.hotelGroup}.`,
      400
    );
  }
  const context = parseHotelSearchTaskContext(task.contextJson);
  if (!context) {
    throw new BrowserTaskError("invalid_search", "The saved hotel-search task context is invalid.", 400);
  }
  await appendBrowserSnapshot(taskId, snapshot);
  if (context.mode === "tax_inclusive_total") {
    return captureTaxInclusiveHotelSearchTask(taskId, task.hotelGroup, context, snapshot);
  }
  const query = context.query;
  const visibleResults = provider.parseSearchSnapshot(snapshot);
  const pointsMode = context.mode === "city_points" || query.priceMode === "points";
  const results = visibleResults.filter((result) => pointsMode
    ? result.priceMode === "points"
    : result.priceMode === "cash" && result.currency === query.currency);
  const result = {
    capturedAt: snapshot.capturedAt,
    results,
    searchSessionId: context.searchSessionId,
    searchUrl: stripBrowserTaskHash(snapshot.sourceUrl),
    status: results.length > 0 ? ("succeeded" as const) : ("partial" as const),
    summary:
      results.length > 0
        ? `${task.hotelGroup} official search returned ${results.length} visible ${pointsMode ? "points rate" : "hotel rate"}${results.length === 1 ? "" : "s"}.`
        : `${task.hotelGroup} opened in Chrome, but no supported visible hotel rates were found.`,
    warning:
      visibleResults.length > 0 && results.length === 0
        ? pointsMode
          ? `${task.hotelGroup} did not render visible points rates; no prices were imported.`
          : `${task.hotelGroup} did not render the requested profile currency (${query.currency}); no prices were imported.`
        : results.length === 0
          ? "The source may have no availability or may have changed its visible page structure."
          : null
  };
  if (context.searchSessionId) {
    await replaceOfficialSearchResults({
      capturedAt: snapshot.capturedAt,
      hotelGroup: task.hotelGroup,
      results,
      searchSessionId: context.searchSessionId,
      summary: result.summary,
      warning: result.warning
    });
    if (!pointsMode && results.length > 0) {
      const otaProvider = getHotelOtaPriceProvider(task.hotelGroup);
      if (otaProvider) {
        const ota = await otaProvider.fetchQuotes(query, results.map((hotel) => hotel.hotelName));
        const matchingQuotes = ota.quotes.filter((quote) => quote.currency === query.currency);
        const otaSummary = matchingQuotes.length > 0
          ? `${result.summary} ${otaProvider.name} added ${matchingQuotes.length} tax-inclusive OTA quote${matchingQuotes.length === 1 ? "" : "s"}.`
          : result.summary;
        await appendHotelSearchOffers({
          capturedAt: snapshot.capturedAt,
          results: matchingQuotes.map((quote) => ({
            availabilityLabel: quote.availabilityLabel,
            hotelName: quote.hotelName,
            offer: toOtaSearchOffer(quote, query),
            locationLabel: null
          })),
          searchSessionId: context.searchSessionId,
          summary: otaSummary,
          warning: ota.warning
        });
      }
    }
  }
  await finishBrowserTask({
    errorCode: results.length > 0 ? null : "no_search_results",
    errorMessage: results.length > 0 ? null : result.warning,
    result,
    status: result.status,
    taskId
  });
  return serializeTaskState(await getBrowserTask(taskId));
}

export const hotelSearchTaskDefinition = {
  capture: captureHotelSearchTask,
  create: createHotelSearchTask,
  kind: "hotel_search"
} satisfies BrowserTaskDefinition<HotelSearchTaskInput, Awaited<ReturnType<typeof createHotelSearchTask>>>;

async function captureTaxInclusiveHotelSearchTask(
  taskId: string,
  hotelGroup: string,
  context: HotelSearchTaskContext,
  snapshot: NonNullable<ReturnType<typeof normalizeBrowserSnapshot>>
) {
  const provider = getBookingPriceProvider(hotelGroup);
  if (!provider || !context.hotelName) {
    await finishBrowserTask({
      errorCode: "provider_unavailable",
      errorMessage: `No tax-inclusive price provider is available for ${hotelGroup}.`,
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  const input = toCitySearchPriceInput(taskId, hotelGroup, context);
  const parsed = provider.parseSnapshot(snapshot, input);
  if (parsed.status === "failed") {
    await finishBrowserTask({
      errorCode: parsed.errorCode ?? "provider_failed",
      errorMessage: parsed.errorMessage ?? parsed.summary,
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  const action = provider.planAction(snapshot, input);
  if (action.action === "stop") {
    await finishBrowserTask({
      errorCode: "tax_total_unavailable",
      errorMessage: action.reason,
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  if (action.action !== "import") {
    return { ...serializeTaskState(await getBrowserTask(taskId)), action };
  }

  const total = parsed.observations.find(
    (candidate) =>
      candidate.inventoryType === "cash" &&
      candidate.cashCurrency === context.query.currency &&
      candidate.cashTotal !== null &&
      candidate.taxesIncluded === true &&
      candidate.feesIncluded === true
  );
  const totalCurrency = total?.cashCurrency ?? null;
  const stayTotal = total?.cashTotal ?? null;
  if (!total || !totalCurrency || stayTotal === null) {
    await finishBrowserTask({
      errorCode: "taxes_not_visible",
      errorMessage: "Hyatt reached a final price page, but did not visibly confirm a tax-and-fee-inclusive total.",
      status: "partial",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }

  const result = {
    capturedAt: snapshot.capturedAt,
    currency: totalCurrency,
    fees: total.cashFees,
    hotelName: context.hotelName,
    nights: stayNights(context.query.checkIn, context.query.checkOut),
    priceBasis: "Official Hyatt pre-payment total including visible taxes and fees",
    searchSessionId: context.searchSessionId,
    sourceUrl: stripBrowserTaskHash(snapshot.sourceUrl),
    subtotal: subtotalFromTotal(stayTotal, total.cashTaxes, total.cashFees, total.cashBase),
    taxes: total.cashTaxes,
    taxesAndFees: combineTaxesAndFees(total.cashTaxes, total.cashFees),
    total: stayTotal
  };
  if (context.searchSessionId) {
    await recordOfficialFinalTotal({
      breakfastIncluded: total.breakfastIncluded,
      cancellationPolicy: total.cancellationPolicyRaw,
      capturedAt: snapshot.capturedAt,
      currency: totalCurrency,
      feesAmount: total.cashFees,
      hotelGroup,
      hotelName: context.hotelName,
      ratePlanName: total.ratePlanName,
      roomType: total.roomTypeRaw,
      searchSessionId: context.searchSessionId,
      sourceUrl: result.sourceUrl,
      staySubtotal: result.subtotal,
      stayTotal,
      taxesAmount: total.cashTaxes,
      taxesAndFeesAmount: result.taxesAndFees
    });
  }
  await finishBrowserTask({ result, status: "succeeded", taskId });
  return serializeTaskState(await getBrowserTask(taskId));
}

function toCitySearchPriceInput(taskId: string, hotelGroup: string, context: HotelSearchTaskContext): BookingPriceInput {
  return {
    bookingId: taskId,
    bookingUrl: null,
    cancellationDeadline: null,
    checkIn: new Date(`${context.query.checkIn}T00:00:00.000Z`),
    checkOut: new Date(`${context.query.checkOut}T00:00:00.000Z`),
    city: context.query.city,
    currency: context.query.currency,
    guests: context.query.adults,
    hotelGroup,
    hotelName: context.hotelName ?? "",
    inventoryTypes: ["cash"],
    roomType: ""
  };
}

function toOtaSearchOffer(quote: {
  cancellationPolicy: string | null;
  currency: string;
  ratePlanName: string | null;
  roomType: string | null;
  sourceUrl: string;
  stayTotal: number;
  taxesIncluded: boolean;
}, query: HotelSearchQuery): HotelSearchOfferDraft {
  return {
    breakfastIncluded: null,
    cancellationPolicy: quote.cancellationPolicy,
    capturedAt: new Date().toISOString(),
    comparisonWarnings: [
      "OTA all-in price. The source quotes what you would pay, but publishes no tax or fee breakdown, so the split cannot be shown. Confirm on the seller's own page before booking."
    ],
    currency: quote.currency,
    displayedAmount: quote.stayTotal,
    displayedPriceBasis: quote.taxesIncluded ? "tax_inclusive" : "unknown",
    displayedPriceUnit: "stay_total",
    eliteNightEligible: null,
    evidenceLevel: "verified_offer",
    feesAmount: null,
    feesIncluded: quote.taxesIncluded ? "included" : "unknown",
    hotelGroup: query.hotelGroup,
    loyaltyEligible: null,
    nights: stayNights(query.checkIn, query.checkOut),
    providerName: "RollingGo Global",
    ratePlanName: quote.ratePlanName,
    roomType: quote.roomType,
    sourceName: "RollingGo Global",
    sourceType: "ota",
    sourceUrl: quote.sourceUrl,
    startingAvgNightlyRate: null,
    staySubtotal: null,
    stayTotal: quote.stayTotal,
    taxesAmount: null,
    taxesAndFeesAmount: null,
    taxesIncluded: quote.taxesIncluded ? "included" : "unknown"
  };
}

function stayNights(checkIn: string, checkOut: string) {
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function subtotalFromTotal(total: number, taxes: number | null, fees: number | null, capturedBase: number | null) {
  const breakdown = [taxes, fees].filter((value): value is number => value !== null);
  if (breakdown.length > 0) {
    return Math.max(0, Math.round((total - breakdown.reduce((sum, value) => sum + value, 0)) * 100) / 100);
  }
  return capturedBase;
}

function combineTaxesAndFees(taxes: number | null, fees: number | null) {
  const breakdown = [taxes, fees].filter((value): value is number => value !== null);
  return breakdown.length > 0
    ? Math.round(breakdown.reduce((sum, value) => sum + value, 0) * 100) / 100
    : null;
}

function addRequestedCurrency(sourceUrl: string, currency: string) {
  const url = new URL(sourceUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.set(taskProtocol.requestedCurrencyKey, currency);
  url.hash = hash.toString();
  return url.toString();
}
