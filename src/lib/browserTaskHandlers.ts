import { randomUUID } from "node:crypto";
import type { BookingBaselineType } from "@prisma/client";
import taskProtocol from "@extension/taskProtocol.js";
import {
  addBrowserTaskHash,
  appendBrowserSnapshot,
  BROWSER_TASK_TTL_MS,
  createBrowserTask,
  DEFAULT_LOCAL_ENDPOINT,
  finishBrowserTask,
  getBrowserTask,
  normalizeBrowserSnapshot,
  stripBrowserTaskHash,
  type BrowserTaskCapture
} from "@/lib/browserTasks";
import { isActiveBookingDate } from "@/lib/bookingDates";
import { inferIsSuite } from "@/lib/currency";
import { prisma } from "@/lib/db";
import {
  createHotelSearchSession,
  getHotelSearchSession,
  hotelSearchQueriesMatch,
  recordOfficialFinalTotal,
  replaceOfficialSearchResults
} from "@/lib/hotelSearchSessions";
import { parseJson } from "@/lib/json";
import { getProfileSearchCurrency } from "@/lib/profilePreferences";
import {
  getAccountBookingImporter,
  getBookingPriceProvider,
  getHotelSearchProvider,
  listSearchableHotelGroups
} from "@/lib/providers/registry";
import type { AccountBookingExtraction, AccountPageSnapshot, BookingPriceInput, HotelSearchQuery } from "@/lib/providers/types";
import { captureBookingPriceTask, BrowserTaskError, serializeTaskState } from "@/lib/priceChecks";
import { convertMoneyToSystemCurrency, getSystemCurrency } from "@/lib/systemSettings";

export function supportedHotelSearchGroups() {
  return listSearchableHotelGroups();
}

type HotelSearchTaskMode = "city_results" | "tax_inclusive_total";

type HotelSearchTaskContext = {
  hotelName: string | null;
  mode: HotelSearchTaskMode;
  query: HotelSearchQuery;
  searchSessionId: string | null;
};

type HotelSearchTaskInput = Partial<HotelSearchQuery> & {
  hotelName?: unknown;
  mode?: unknown;
  searchSessionId?: unknown;
};

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
  const mode: HotelSearchTaskMode = input.mode === "tax_inclusive_total" ? "tax_inclusive_total" : "city_results";
  const hotelName = mode === "tax_inclusive_total" ? String(input.hotelName ?? "").trim() : null;
  if (mode === "tax_inclusive_total" && !hotelName) {
    throw new BrowserTaskError("hotel_name_required", "Choose a hotel before requesting a tax-inclusive total.", 400);
  }
  let searchSessionId: string;
  if (mode === "city_results") {
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
      throw new BrowserTaskError("search_session_expired", "The hotel search session expired. Run the city search again.", 404);
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

export async function createAccountImportTask(hotelGroup = "Hyatt") {
  const importer = getAccountBookingImporter(hotelGroup);
  if (!importer) {
    throw new BrowserTaskError("provider_unavailable", `No account importer is available for ${hotelGroup}.`, 400);
  }
  const taskId = randomUUID();
  const launchUrl = importer.buildLaunchUrl(taskId, DEFAULT_LOCAL_ENDPOINT);
  const task = await createBrowserTask({
    context: { hotelGroup },
    expiresAt: new Date(Date.now() + Math.max(BROWSER_TASK_TTL_MS, 5 * 60 * 1000)),
    hotelGroup,
    id: taskId,
    kind: "account_booking_import",
    launchUrl
  });
  return serializeTaskState({ ...task, priceCheckRun: null });
}

export async function captureBrowserTask(taskId: string, capture: BrowserTaskCapture) {
  const task = await getBrowserTask(taskId);
  if (!task) {
    throw new BrowserTaskError("task_not_found", "Browser task was not found or expired.", 404);
  }
  if (task.kind === "booking_price_check") {
    return captureBookingPriceTask(taskId, capture);
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
  return task.kind === "hotel_search"
    ? captureHotelSearchTask(taskId, task.contextJson, task.hotelGroup, capture)
    : captureAccountTask(taskId, task.hotelGroup, capture);
}

async function captureHotelSearchTask(
  taskId: string,
  contextJson: string,
  hotelGroup: string,
  capture: BrowserTaskCapture
) {
  const snapshot = normalizeBrowserSnapshot(capture.snapshot);
  if (!snapshot) {
    throw new BrowserTaskError("invalid_snapshot", "A readable hotel-search snapshot is required.", 400);
  }
  const provider = getHotelSearchProvider(hotelGroup);
  if (!provider) {
    throw new BrowserTaskError("provider_unavailable", `No city-search provider is available for ${hotelGroup}.`, 400);
  }
  const context = parseHotelSearchTaskContext(contextJson);
  if (!context) {
    throw new BrowserTaskError("invalid_search", "The saved hotel-search task context is invalid.", 400);
  }
  await appendBrowserSnapshot(taskId, snapshot);
  if (context.mode === "tax_inclusive_total") {
    return captureTaxInclusiveHotelSearchTask(taskId, hotelGroup, context, snapshot);
  }
  const query = context.query;
  const visibleResults = provider.parseSearchSnapshot(snapshot);
  const results = visibleResults.filter((result) => result.currency === query.currency);
  const result = {
    capturedAt: snapshot.capturedAt,
    results,
    searchSessionId: context.searchSessionId,
    searchUrl: stripBrowserTaskHash(snapshot.sourceUrl),
    status: results.length > 0 ? ("succeeded" as const) : ("partial" as const),
    summary:
      results.length > 0
        ? `${hotelGroup} official search returned ${results.length} visible hotel rate${results.length === 1 ? "" : "s"}.`
        : `${hotelGroup} opened in Chrome, but no supported visible hotel rates were found.`,
    warning:
      visibleResults.length > 0 && results.length === 0
        ? `${hotelGroup} did not render the requested profile currency (${query.currency}); no prices were imported.`
        : results.length === 0
          ? "The source may have no availability or may have changed its visible page structure."
          : null
  };
  if (context.searchSessionId) {
    await replaceOfficialSearchResults({
      capturedAt: snapshot.capturedAt,
      hotelGroup,
      results,
      searchSessionId: context.searchSessionId,
      summary: result.summary,
      warning: result.warning
    });
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

function parseHotelSearchTaskContext(value: string): HotelSearchTaskContext | null {
  const parsed = parseJson<unknown>(value, null);
  if (isHotelSearchQuery(parsed)) {
    return { hotelName: null, mode: "city_results", query: parsed, searchSessionId: null };
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const context = parsed as { hotelName?: unknown; mode?: unknown; query?: unknown; searchSessionId?: unknown };
  if (!isHotelSearchQuery(context.query)) {
    return null;
  }
  return {
    hotelName: typeof context.hotelName === "string" && context.hotelName.trim() ? context.hotelName.trim() : null,
    mode: context.mode === "tax_inclusive_total" ? "tax_inclusive_total" : "city_results",
    query: context.query,
    searchSessionId:
      typeof context.searchSessionId === "string" && context.searchSessionId.trim()
        ? context.searchSessionId.trim()
        : null
  };
}

function isHotelSearchQuery(value: unknown): value is HotelSearchQuery {
  if (!value || typeof value !== "object") {
    return false;
  }
  const query = value as Partial<HotelSearchQuery>;
  return [query.adults, query.checkIn, query.checkOut, query.city, query.currency, query.hotelGroup].every(
    (item) => item !== undefined && item !== null && String(item).trim() !== ""
  );
}

function toCitySearchPriceInput(taskId: string, hotelGroup: string, context: HotelSearchTaskContext): BookingPriceInput {
  return {
    bookingId: taskId,
    bookingUrl: null,
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

async function captureAccountTask(taskId: string, hotelGroup: string, capture: BrowserTaskCapture) {
  const snapshots = normalizeAccountSnapshots(capture.snapshots);
  if (snapshots.length === 0) {
    throw new BrowserTaskError("invalid_snapshot", "Readable Hyatt account snapshots are required.", 400);
  }
  const importer = getAccountBookingImporter(hotelGroup);
  if (!importer) {
    throw new BrowserTaskError("provider_unavailable", `No account importer is available for ${hotelGroup}.`, 400);
  }
  const extraction = importer.parseSnapshots(snapshots);
  const hasReservationDetail = snapshots.some(
    (snapshot) => importer.isReservationDetailUrl(snapshot.url) && /Check-?in/i.test(snapshot.text) && /Check-?out/i.test(snapshot.text)
  );
  if (extraction.bookings.length > 0 && !hasReservationDetail) {
    await finishBrowserTask({
      errorCode: "stay_details_missing",
      errorMessage: "Hyatt showed upcoming stays without complete reservation-detail evidence; no booking data was changed.",
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  if (extraction.loginState === "unknown" && extraction.bookings.length === 0) {
    await finishBrowserTask({
      errorCode: "unreadable_account",
      errorMessage: "Hyatt account evidence was unreadable; no booking data was changed.",
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  const result = await importAccountBookings(extraction);
  await finishBrowserTask({
    result,
    status: extraction.loginState === "login_required" ? "partial" : "succeeded",
    taskId
  });
  return serializeTaskState(await getBrowserTask(taskId));
}

async function importAccountBookings(extraction: AccountBookingExtraction) {
  const systemCurrency = await getSystemCurrency();
  const active = extraction.bookings.filter((booking) => isActiveBookingDate(booking.checkIn));
  let created = 0;
  let updated = 0;

  for (const imported of active) {
    const cash =
      imported.priceSource === "cash" && imported.cashTotal > 0
        ? await convertMoneyToSystemCurrency(imported.cashTotal, imported.currency)
        : null;
    const baselineType: BookingBaselineType =
      imported.priceSource === "points"
        ? "points"
        : imported.priceSource === "free_night"
          ? "certificate"
          : "cash";
    const data = {
      baselineAwardLabel: imported.awardLabel,
      baselineCashTotal: cash?.amount ?? null,
      baselinePoints: imported.pointsPrice,
      baselineType,
      bookingChannel: "direct" as const,
      bookingUrl: imported.bookingUrl,
      breakfastIncluded: false,
      cancellationDeadline: imported.cancellationDeadline,
      checkIn: imported.checkIn,
      checkOut: imported.checkOut,
      city: imported.city,
      currency: cash?.currency ?? systemCurrency,
      guests: imported.guests,
      hotelGroup: imported.hotelGroup,
      hotelName: imported.hotelName,
      isSuite: inferIsSuite(imported.roomType),
      loyaltyEligible: true,
      notes:
        imported.priceSource === "cash" && !cash
          ? `Visible ${imported.currency} cash total requires a configured conversion rate.`
          : "Imported from Hyatt account.",
      roomType: imported.roomType
    };
    const existing = imported.bookingUrl
      ? await prisma.hotelBooking.findFirst({ where: { bookingUrl: imported.bookingUrl } })
      : await prisma.hotelBooking.findFirst({
          where: { checkIn: imported.checkIn, checkOut: imported.checkOut, hotelName: imported.hotelName }
        });
    if (existing) {
      await prisma.hotelBooking.update({ where: { id: existing.id }, data });
      updated += 1;
    } else {
      await prisma.hotelBooking.create({
        data: { ...data, watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } } }
      });
      created += 1;
    }
  }
  return {
    created,
    imported: active.length,
    loginUrl: extraction.loginUrl,
    skipped: extraction.bookings.length - active.length,
    sourceUrl: extraction.sourceUrl,
    status: extraction.loginState === "login_required" ? "login_required" : "succeeded",
    summary: extraction.summary,
    updated
  };
}

function normalizeAccountSnapshots(input: BrowserTaskCapture["snapshots"]): AccountPageSnapshot[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((snapshot) => ({
      links: Array.isArray(snapshot.links)
        ? snapshot.links
            .map((link) => ({ href: String(link.href ?? "").trim(), text: String(link.text ?? "").trim() }))
            .filter((link) => link.href)
        : [],
      text: String(snapshot.pageText ?? "").replace(/\s+/g, " ").trim(),
      title: String(snapshot.pageTitle ?? "").trim(),
      url: String(snapshot.sourceUrl ?? "").trim()
    }))
    .filter((snapshot) => snapshot.url && snapshot.text);
}

function addRequestedCurrency(sourceUrl: string, currency: string) {
  const url = new URL(sourceUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.set(taskProtocol.requestedCurrencyKey, currency);
  url.hash = hash.toString();
  return url.toString();
}
