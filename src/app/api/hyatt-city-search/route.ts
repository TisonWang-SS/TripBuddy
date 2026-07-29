import { NextResponse } from "next/server";
import {
  completeBrowserTask,
  createBrowserTask,
  failBrowserTask,
  getBrowserTask
} from "@/lib/browserTasks";
import {
  buildHyattCitySearchUrl,
  normalizeHyattCitySearchQuery,
  parseHyattCitySearchCards,
  type HyattCitySearchRun
} from "@/lib/hyattCitySearch";

export const dynamic = "force-dynamic";

const taskKind = "hyatt_city_search";
const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

type CitySearchCapture = {
  error?: string | null;
  pageText?: string | null;
  requestId?: string | null;
  sourceUrl?: string | null;
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestId = url.searchParams.get("requestId")?.trim();
  if (requestId) {
    const task = getBrowserTask(requestId, taskKind);
    return task
      ? json({ error: task.error, requestId, result: task.result, status: task.status })
      : json({ error: "Hyatt city-search task was not found or expired." }, 404);
  }

  const { errors, query } = readQuery(url);
  if (errors.length > 0) {
    return json({ error: errors.join(" ") }, 400);
  }

  const task = createBrowserTask(taskKind);
  const searchUrl = addBrowserTaskHash(buildHyattCitySearchUrl(query), {
    tripbuddyCitySearchId: task.id,
    tripbuddyEndpoint: "http://localhost:3000",
    tripbuddyRequestedCurrency: query.currency
  });

  return json({
    requestId: task.id,
    searchUrl,
    status: task.status
  });
}

export async function POST(request: Request) {
  let capture: CitySearchCapture;
  try {
    capture = (await request.json()) as CitySearchCapture;
  } catch {
    return json({ error: "Invalid JSON payload." }, 400);
  }

  const requestId = capture.requestId ? String(capture.requestId).trim() : "";
  if (!requestId || !getBrowserTask(requestId, taskKind)) {
    return json({ error: "Hyatt city-search task was not found or expired." }, 404);
  }

  if (capture.error) {
    failBrowserTask(requestId, taskKind, capture.error);
    return json({ error: capture.error, requestId, status: "failed" }, 422);
  }

  const pageText = capture.pageText?.replace(/\s+/g, " ").trim() ?? "";
  const sourceUrl = capture.sourceUrl?.trim() ?? "";
  if (!pageText || !sourceUrl) {
    return json({ error: "Readable Hyatt page text and sourceUrl are required." }, 400);
  }

  const requestedCurrency = readRequestedCurrency(sourceUrl);
  const run = createCitySearchRun(pageText, sourceUrl, requestedCurrency);
  completeBrowserTask(requestId, taskKind, serializeRun(run));
  return json({ requestId, result: serializeRun(run), status: "succeeded" });
}

function readQuery(url: URL) {
  return normalizeHyattCitySearchQuery({
    adults: Number(url.searchParams.get("adults") ?? 2),
    checkIn: url.searchParams.get("checkIn") ?? "",
    checkOut: url.searchParams.get("checkOut") ?? "",
    city: url.searchParams.get("city") ?? "",
    currency: url.searchParams.get("currency") ?? "USD"
  });
}

function createCitySearchRun(pageText: string, sourceUrl: string, requestedCurrency: string | null): HyattCitySearchRun {
  const results = parseHyattCitySearchCards([pageText], sourceUrl);
  const requestedCurrencyFound = !requestedCurrency || results.some((result) => result.currency === requestedCurrency);
  return {
    capturedAt: new Date(),
    results,
    searchUrl: stripTripBuddyHash(sourceUrl),
    status: results.length > 0 ? "succeeded" : "partial",
    summary:
      results.length > 0
        ? `Hyatt official search returned ${results.length} visible hotel rate${results.length === 1 ? "" : "s"}.`
        : "Hyatt opened in Chrome, but no visible Avg/Night hotel results were found.",
    warning:
      results.length > 0 && !requestedCurrencyFound
        ? `Hyatt rendered a different currency than ${requestedCurrency}; returned the currency shown by Hyatt.`
        : results.length > 0
          ? null
          : "Hyatt may have returned no available hotels for these dates or changed the visible search page structure."
  };
}

function readRequestedCurrency(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    return hash.get("tripbuddyRequestedCurrency")?.toUpperCase() ?? url.searchParams.get("currency")?.toUpperCase() ?? null;
  } catch {
    return null;
  }
}

function addBrowserTaskHash(sourceUrl: string, values: Record<string, string>) {
  const url = new URL(sourceUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  for (const [key, value] of Object.entries(values)) {
    hash.set(key, value);
  }
  url.hash = hash.toString();
  return url.toString();
}

function stripTripBuddyHash(sourceUrl: string) {
  const url = new URL(sourceUrl);
  url.hash = "";
  return url.toString();
}

function serializeRun(run: HyattCitySearchRun) {
  return {
    ...run,
    capturedAt: run.capturedAt.toISOString()
  };
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: corsHeaders, status });
}
