import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { HotelOtaPriceProvider, HotelOtaQuote, HotelSearchQuery } from "@/lib/providers/types";

const DEFAULT_BASE_URL = "https://mcp.rollinggo.ai/mcp";
const DEFAULT_COUNTRY_CODE = "US";
const DEFAULT_TIMEOUT_MS = 15_000;
const TOKEN_FILE = ".hotel-global-cli/token.json";
const HOTEL_DETAIL_ENDPOINT = "/hoteldetail";

type JsonRecord = Record<string, unknown>;

/**
 * The Global skill's CLI is a thin wrapper over this endpoint. Keeping the
 * adapter here means the app can reuse the authenticated session without
 * spawning a CLI process or exposing its token to the browser.
 */
export const rollingGoGlobalOtaProvider: HotelOtaPriceProvider = {
  name: "RollingGo Global",
  async fetchQuotes(query, hotelNames) {
    const accessToken = await readAccessToken();
    if (!accessToken) {
      // Global comparison is optional until the user has authorized the skill.
      return { quotes: [], warning: null };
    }

    const uniqueHotelNames = [...new Set(hotelNames.map((name) => name.trim()).filter(Boolean))].slice(0, 20);
    const results = await mapWithConcurrency(uniqueHotelNames, 4, async (hotelName) => {
      try {
        const payload = await requestHotelDetail(accessToken, query, hotelName);
        return {
          hotelName,
          quote: parseRollingGoHotelDetail(payload, hotelName, query.currency, stayNights(query.checkIn, query.checkOut)),
          warning: null
        };
      } catch (error) {
        return {
          hotelName,
          quote: null,
          warning: error instanceof Error ? error.message : "The OTA price could not be read."
        };
      }
    });
    const quotes = results.flatMap((result) => result.quote ? [result.quote] : []);
    const failures = results.filter((result) => result.warning !== null);
    return {
      quotes,
      warning: quotes.length === 0
        ? "RollingGo Global was authorized, but no tax-inclusive OTA quote was available for the visible hotels."
        : failures.length > 0
          ? `RollingGo Global returned tax-inclusive OTA quotes for ${quotes.length} hotel${quotes.length === 1 ? "" : "s"}; some hotels were unavailable.`
          : null
    };
  }
};

export function buildRollingGoHotelDetailRequest(query: HotelSearchQuery, hotelName: string) {
  return {
    name: hotelName,
    dateParam: {
      checkInDate: query.checkIn,
      checkOutDate: query.checkOut
    },
    occupancyParam: {
      roomCount: 1,
      adultCount: query.adults,
      childCount: 0
    },
    localeParam: {
      countryCode: process.env.ROLLINGGO_GLOBAL_COUNTRY_CODE?.trim().toUpperCase() || DEFAULT_COUNTRY_CODE,
      currency: query.currency
    }
  };
}

/**
 * Normalizes both the documented `totalPrice` response and the current live
 * response, which exposes the same tax-inclusive quote as `averagePrice`.
 * The latter is multiplied by the stay length because it is explicitly an
 * average nightly amount in the live schema; it is still kept as a verified
 * OTA quote rather than a locked booking price.
 */
export function parseRollingGoHotelDetail(
  value: unknown,
  requestedHotelName: string,
  fallbackCurrency = "USD",
  nights = 1
): HotelOtaQuote | null {
  const payload = record(value);
  if (!payload || payload.success === false || !Array.isArray(payload.roomRatePlans)) {
    return null;
  }
  const plans = payload.roomRatePlans
    .map((item) => record(item))
    .filter((item): item is JsonRecord => item !== null)
    .map((plan) => ({
      plan,
      totalPrice: nonNegativeNumber(plan.totalPrice),
      averagePrice: nonNegativeNumber(plan.averagePrice),
      currency: stringValue(plan.currency)?.toUpperCase() ?? null
    }))
    .map((item) => ({
      ...item,
      stayTotal: item.totalPrice ?? (item.averagePrice === null ? null : item.averagePrice * Math.max(1, nights))
    }))
    .filter((item): item is { plan: JsonRecord; totalPrice: number | null; averagePrice: number | null; currency: string | null; stayTotal: number } => item.stayTotal !== null)
    .sort((left, right) => left.stayTotal - right.stayTotal);
  const selected = plans[0];
  if (!selected || selected.stayTotal <= 0) {
    return null;
  }

  const plan = selected.plan;
  const inventoryCount = nonNegativeInteger(plan.inventoryCount);
  const isOnRequest = plan.isOnRequest === true;
  const availabilityLabel = inventoryCount === 0
    ? "Unavailable"
    : isOnRequest
      ? "On request"
      : "Available via RollingGo Global";
  const cancellationPolicy = Array.isArray(plan.cancellationPolicies)
    ? plan.cancellationPolicies
        .map((item) => record(item))
        .map((policy) => policy ? stringValue(policy.description) : null)
        .filter((description): description is string => Boolean(description))
        .join("; ") || null
    : stringValue(plan.cancelPolicy);

  return {
    availabilityLabel,
    cancellationPolicy,
    currency: selected.currency ?? fallbackCurrency.toUpperCase(),
    hotelName: requestedHotelName,
    ratePlanName: stringValue(plan.ratePlanName),
    roomType: stringValue(plan.roomName) ?? stringValue(plan.roomNameCn),
    sourceUrl: stringValue(payload.bookingUrl) ?? "https://rollinggo.ai",
    stayTotal: selected.stayTotal,
    /*
     * Asserted, not read. This source quotes an all-in price — what the traveler
     * would actually pay — and publishes no tax or fee breakdown, so there is no
     * field to derive this from. It is a property of the source, recorded here
     * as the one place that knows it (see ADR 0006).
     *
     * The consequence is worth stating: if the source ever begins quoting
     * pre-tax prices, nothing here would notice, and every OTA row would
     * silently understate. That is why it is a named constant with a test on it
     * rather than an inline literal.
     */
    taxesIncluded: OTA_QUOTES_ARE_ALL_IN
  };
}

/**
 * Whether this source's quotes already include taxes and fees.
 *
 * True for RollingGo Global. Kept as a named constant because it is an
 * assumption about a third party rather than something the response states, and
 * an assumption with a name can be found, tested, and revisited.
 */
export const OTA_QUOTES_ARE_ALL_IN = true;

async function requestHotelDetail(accessToken: string, query: HotelSearchQuery, hotelName: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs());
  try {
    const response = await fetch(`${baseUrl()}${HOTEL_DETAIL_ENDPOINT}`, {
      body: JSON.stringify(buildRollingGoHotelDetailRequest(query, hotelName)),
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`RollingGo Global returned HTTP ${response.status}.`);
    }
    return await response.json() as unknown;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("RollingGo Global price lookup timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function readAccessToken() {
  const configuredToken = process.env.ROLLINGGO_GLOBAL_TOKEN?.trim();
  if (configuredToken) {
    return configuredToken;
  }
  try {
    const tokenJson = JSON.parse(await readFile(process.env.ROLLINGGO_GLOBAL_TOKEN_PATH ?? join(homedir(), TOKEN_FILE), "utf8")) as unknown;
    return record(tokenJson)?.access_token && typeof record(tokenJson)?.access_token === "string"
      ? record(tokenJson)?.access_token as string
      : null;
  } catch {
    return null;
  }
}

function baseUrl() {
  return (process.env.ROLLINGGO_GLOBAL_MCP_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/$/, "");
}

function timeoutMs() {
  const configured = Number(process.env.ROLLINGGO_GLOBAL_TIMEOUT_MS);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TIMEOUT_MS;
}

async function mapWithConcurrency<T, R>(items: readonly T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output: R[] = [];
  let nextIndex = 0;
  async function consume() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      output[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => consume()));
  return output;
}

function record(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }
  return null;
}

function nonNegativeInteger(value: unknown) {
  const parsed = nonNegativeNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function stayNights(checkIn: string, checkOut: string) {
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}
