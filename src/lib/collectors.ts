import { extractRateDetailWithChromeProfile, extractTextWithChromeProfile, type ChromeProfileConfig } from "@/lib/browserConnector";

export type InventoryType = "cash" | "award";
export type BrowserMode = "headless" | "interactive" | "persistent" | "chrome_profile";

export type CollectorInput = {
  bookingId: string;
  hotelGroup: string;
  hotelName: string;
  city: string;
  checkIn: Date;
  checkOut: Date;
  guests: number;
  roomType: string;
  currency: string;
  bookingUrl?: string | null;
  inventoryTypes: InventoryType[];
  browserMode: BrowserMode;
  chromeProfile?: ChromeProfileConfig | null;
};

export type CollectorRateCandidate = {
  sourceName: string;
  sourceType: "direct" | "ota" | "other";
  inventoryType: InventoryType;
  collectedAt: Date;
  rawRateName: string | null;
  ratePlanName: string | null;
  price: {
    base: number | null;
    taxes: number | null;
    fees: number | null;
    total: number;
    currency: string;
    points: number | null;
    cashCopay: number | null;
    taxesIncluded: boolean | null;
    feesIncluded: boolean | null;
  };
  room: {
    rawName: string;
    normalizedName: string | null;
    match: "exact" | "similar" | "unknown";
    matchReason: string;
  };
  cancellation: {
    rawPolicy: string;
    deadline: Date | null;
    match: "same_or_better" | "worse" | "unknown";
    matchReason: string;
  };
  loyalty: {
    eligible: boolean | null;
    loginState: "not_required" | "anonymous" | "member" | "unknown";
  };
  source: {
    url: string | null;
    verified: boolean;
    snapshot: unknown;
  };
};

export type CollectorRunResult = {
  status: "succeeded" | "partial" | "failed";
  collectorName: string;
  sourceUrl?: string;
  summary: string;
  errorMessage?: string;
  candidates: CollectorRateCandidate[];
};

export interface HotelPriceTool {
  name: string;
  hotelGroup: string;
  supports(hotelGroup: string): boolean;
  run(input: CollectorInput): Promise<CollectorRunResult>;
}

export class HyattPriceTool implements HotelPriceTool {
  name = "hyatt-direct-tool";
  hotelGroup = "Hyatt";

  supports(hotelGroup: string) {
    return hotelGroup.toLowerCase() === "hyatt";
  }

  async run(input: CollectorInput): Promise<CollectorRunResult> {
    const sourceUrl = buildHyattSearchUrl(input);
    const textResult = await collectPageText(sourceUrl, input.browserMode, input.chromeProfile);
    if (!textResult.ok) {
      return {
        status: "partial",
        collectorName: this.name,
        sourceUrl,
        summary: "Hyatt search opened, but browser extraction could not read the page.",
        errorMessage: textResult.error,
        candidates: []
      };
    }

    if (isHyattAutomationBlocked(textResult.text)) {
      return {
        status: "failed",
        collectorName: this.name,
        sourceUrl,
        summary: "Hyatt blocked automated browser extraction before rates could be read.",
        errorMessage:
          input.browserMode === "chrome_profile" || input.browserMode === "persistent"
            ? "Hyatt returned an E6020 browser automation block even with the configured Chrome profile. Use browser-assisted import or manual observation for this booking."
            : input.browserMode === "interactive"
              ? "Hyatt returned an E6020 browser automation block even in interactive mode. Try Chrome profile mode or use browser-assisted import."
              : "Hyatt returned an E6020 browser automation block. Switch this booking to Chrome profile mode.",
        candidates: []
      };
    }

    const candidates = parseHyattCandidates(
      textResult.text,
      input,
      sourceUrl,
      textResult.detailText,
      textResult.detailUrl,
      textResult.selectedRate,
      textResult.detailSelection
    );
    return {
      status: candidates.length > 0 ? "succeeded" : "partial",
      collectorName: this.name,
      sourceUrl,
      summary:
        candidates.length > 0
          ? `Hyatt tool collected ${candidates.length} candidate rate${candidates.length === 1 ? "" : "s"}.`
          : "Hyatt search opened, but no comparable cash or award rates were found in the page text.",
      errorMessage:
        candidates.length > 0
          ? undefined
          : `No rate candidates found in Hyatt page text. Text sample: ${createTextSample(textResult.text)}`,
      candidates
    };
  }
}

export class UnsupportedHotelGroupTool implements HotelPriceTool {
  name = "unsupported-hotel-group-tool";
  hotelGroup = "Unsupported";

  supports() {
    return true;
  }

  async run(input: CollectorInput): Promise<CollectorRunResult> {
    return {
      status: "failed",
      collectorName: this.name,
      summary: "No automated tool is registered for this hotel group yet.",
      errorMessage: `No automated tool is registered for ${input.hotelGroup}.`,
      candidates: []
    };
  }
}

export function getHotelPriceTool(hotelGroup: string): HotelPriceTool {
  const tools: HotelPriceTool[] = [new HyattPriceTool()];
  return tools.find((tool) => tool.supports(hotelGroup)) ?? new UnsupportedHotelGroupTool();
}

export function buildHyattSearchUrl(input: CollectorInput) {
  const hotelCode =
    extractHyattHotelCode(input.bookingUrl) ?? extractHyattHotelCode(input.hotelName) ?? getKnownHyattHotelCode(input.hotelName);
  const params = new URLSearchParams({
    location: `${input.hotelName} ${input.city}`,
    checkinDate: input.checkIn.toISOString().slice(0, 10),
    checkoutDate: input.checkOut.toISOString().slice(0, 10),
    rooms: "1",
    adults: String(input.guests),
    kids: "0",
    currency: input.currency
  });

  if (input.inventoryTypes.includes("award")) {
    params.set("usePoints", "true");
  }

  if (hotelCode) {
    return `https://www.hyatt.com/en-US/shop/rooms/${hotelCode}?${params.toString()}`;
  }

  return `https://www.hyatt.com/search?${params.toString()}`;
}

const KNOWN_HYATT_HOTEL_CODES: Record<string, string> = {
  "hyatt place kuala lumpur bukit jalil": "kulzk"
};

export function getKnownHyattHotelCode(hotelName: string) {
  return KNOWN_HYATT_HOTEL_CODES[normalizeHotelName(hotelName)] ?? null;
}

function normalizeHotelName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function extractHyattHotelCode(value?: string | null) {
  if (!value) {
    return null;
  }

  const patterns = [
    /\/hotel\/[^/]+\/[^/]+\/([a-z0-9]{4,6})(?:[/?#]|$)/i,
    /\/[a-z-]+\/[a-z]{2}-[A-Z]{2}\/([a-z0-9]{4,6})-[^/?#]+/i,
    /\/shop\/rooms\/([a-z0-9]{4,6})(?:[/?#]|$)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      return match[1].toLowerCase();
    }
  }

  return /^[a-z0-9]{4,6}$/i.test(value.trim()) ? value.trim().toLowerCase() : null;
}

export function isHyattAutomationBlocked(text: string) {
  return /ERROR:E6020/i.test(text) || /browser did something unexpected/i.test(text);
}

export function parseHyattCandidates(
  text: string,
  input: CollectorInput,
  sourceUrl: string,
  detailText?: string,
  detailUrl?: string,
  selectedRate?: unknown,
  detailSelection?: unknown
): CollectorRateCandidate[] {
  const compactText = text.replace(/\s+/g, " ");
  const compactDetailText = detailText?.replace(/\s+/g, " ");
  const candidates: CollectorRateCandidate[] = [];
  const shouldParseVisibleInventory = input.inventoryTypes.length > 0;

  if (shouldParseVisibleInventory) {
    const cashRate = extractBestHyattCashRate(compactText, input);
    if (cashRate !== null) {
      const detailTotal = compactDetailText ? extractHyattFinalTotal(compactDetailText, cashRate.currency) : null;
      const detailTaxesAndFees = compactDetailText ? extractHyattTaxesAndFees(compactDetailText, cashRate.currency) : null;
      const totalAmount = detailTotal?.amount ?? cashRate.totalAmount;
      candidates.push({
        sourceName: "Hyatt official site",
        sourceType: "direct",
        inventoryType: "cash",
        collectedAt: new Date(),
        rawRateName: cashRate.ratePlanName,
        ratePlanName: cashRate.ratePlanName,
        price: {
          base: cashRate.nightlyAmount,
          taxes: detailTaxesAndFees?.amount ?? (detailTotal ? Math.max(0, detailTotal.amount - cashRate.totalAmount) : null),
          fees: null,
          total: totalAmount,
          currency: cashRate.currency ?? input.currency,
          points: null,
          cashCopay: null,
          taxesIncluded: detailTotal !== null,
          feesIncluded: detailTotal !== null
        },
        room: {
          rawName: cashRate.roomName ?? input.roomType,
          normalizedName: cashRate.roomName ?? input.roomType,
          match: roomNamesLookSimilar(input.roomType, cashRate.roomName) ? "similar" : "unknown",
          matchReason: cashRate.roomName
            ? "The Hyatt page text exposed a room name near the selected rate."
            : "The Hyatt page text exposed a price, but no nearby room name was parsed."
        },
        cancellation: {
          rawPolicy: compactDetailText ? extractHyattCancellationPolicy(compactDetailText) : "Policy not visible in Hyatt room list",
          deadline: null,
          match: "unknown",
          matchReason: compactDetailText
            ? "The Hyatt detail page exposed policy text, but equivalence still requires review."
            : "The Hyatt room list did not expose a comparable cancellation policy before selecting a rate."
        },
        loyalty: {
          eligible: true,
          loginState: "anonymous"
        },
        source: {
          url: detailUrl ?? sourceUrl,
          verified: true,
          snapshot: {
            parser: "hyatt-text-v1",
            detailParser: detailTotal ? "hyatt-detail-total-v1" : null,
            textLength: compactText.length,
            detailTextLength: compactDetailText?.length ?? null,
            detailSnippet: compactDetailText ? extractDetailPriceSnippet(compactDetailText, cashRate.currency) : null,
            nights: cashRate.nights,
            nightlyAmount: cashRate.nightlyAmount,
            estimatedPretaxTotal: cashRate.totalAmount,
            finalTotalSource: detailTotal ? "detail_page" : "room_list_estimate",
            detailSelection,
            selectedRate,
            rateSnippet: cashRate.snippet
          }
        }
      });
    }
  }

  if (shouldParseVisibleInventory) {
    const pointsPrice = extractLowestPointsPrice(compactText);
    if (pointsPrice !== null) {
      candidates.push({
        sourceName: "Hyatt official site",
        sourceType: "direct",
        inventoryType: "award",
        collectedAt: new Date(),
        rawRateName: "Award rate",
        ratePlanName: "Award rate",
        price: {
          base: null,
          taxes: null,
          fees: null,
          total: 0,
          currency: input.currency,
          points: pointsPrice,
          cashCopay: null,
          taxesIncluded: null,
          feesIncluded: null
        },
        room: {
          rawName: input.roomType,
          normalizedName: input.roomType,
          match: "unknown",
          matchReason: "The Hyatt page text exposed points pricing, but room matching still requires structured extraction."
        },
        cancellation: {
          rawPolicy: "Award policy requires review on Hyatt",
          deadline: null,
          match: "unknown",
          matchReason: "The Hyatt page text did not expose a comparable award cancellation policy."
        },
        loyalty: {
          eligible: true,
          loginState: "anonymous"
        },
        source: {
          url: sourceUrl,
          verified: true,
          snapshot: {
            parser: "hyatt-text-v1",
            textLength: compactText.length
          }
        }
      });
    }
  }

  return candidates;
}

export function extractLowestCashPrice(text: string) {
  return extractLowestCashRate(text)?.amount ?? null;
}

export function calculateStayNights(checkIn: Date, checkOut: Date) {
  const checkInUtc = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const checkOutUtc = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  return Math.max(1, Math.round((checkOutUtc - checkInUtc) / 86400000));
}

type HyattCashRate = {
  nightlyAmount: number;
  totalAmount: number;
  currency: string;
  nights: number;
  roomName: string | null;
  ratePlanName: string;
  snippet: string;
};

export function extractBestHyattCashRate(text: string, input: Pick<CollectorInput, "checkIn" | "checkOut" | "roomType">): HyattCashRate | null {
  const compactText = text.replace(/\s+/g, " ");
  const ratePattern =
    /\b(Long Stay Rate|Member Rate|Standard Rate|Advance Purchase Rate|Hyatt Member Rate|Flexible Rate|Best Available Rate)\s+(US\$|USD|CA\$|CAD|A\$|AUD|HK\$|HKD|S\$|SGD|MYR|RM|JPY|¥|￥|CNY|RMB|EUR|€|GBP|£|THB|฿|KRW|₩|\$)\s?([0-9][0-9,]{1,8})(?:\.\d{2})?\s*Avg\/Night/gi;
  const nights = calculateStayNights(input.checkIn, input.checkOut);
  const rates = [...compactText.matchAll(ratePattern)]
    .map((match) => {
      const nightlyAmount = Number(match[3].replace(/,/g, ""));
      const index = match.index ?? 0;
      const before = compactText.slice(Math.max(0, index - 600), index);
      const snippet = compactText.slice(Math.max(0, index - 220), Math.min(compactText.length, index + 260));
      return {
        nightlyAmount,
        totalAmount: nightlyAmount * nights,
        currency: normalizeCurrencyToken(match[2]),
        nights,
        roomName: extractNearbyHyattRoomName(before),
        ratePlanName: match[1].trim(),
        snippet
      };
    })
    .filter((rate) => rate.nightlyAmount >= 20 && rate.nightlyAmount <= 5000000);

  if (rates.length === 0) {
    const fallback = extractLowestCashRate(compactText);
    return fallback
      ? {
          nightlyAmount: fallback.amount,
          totalAmount: fallback.amount * nights,
          currency: fallback.currency ?? "USD",
          nights,
          roomName: null,
          ratePlanName: "Visible nightly rate",
          snippet: createTextSample(compactText)
        }
      : null;
  }

  return rates.sort((a, b) => a.totalAmount - b.totalAmount)[0];
}

export function extractHyattFinalTotal(text: string, expectedCurrency: string) {
  const compactText = text.replace(/\s+/g, " ");
  const currencyTokens = currencyTokensForCode(expectedCurrency);
  const currencyPattern = currencyTokens.map(escapeRegExp).join("|");
  const amountPattern = `(?:${currencyPattern})\\s?([0-9][0-9,]{1,8}(?:\\.\\d{2})?)`;
  const totalPatterns = [
    new RegExp(`(?:total cash|total|grand total|amount due|due now|due at hotel|stay total|room total)\\b.{0,120}?${amountPattern}`, "gi"),
    new RegExp(`${amountPattern}.{0,120}?\\b(?:total cash|total|grand total|amount due|due now|due at hotel|stay total|room total)`, "gi")
  ];
  const matches = totalPatterns
    .flatMap((pattern) => [...compactText.matchAll(pattern)])
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => value >= 20 && value <= 5000000);

  return matches.length > 0 ? { amount: Math.max(...matches), currency: expectedCurrency } : null;
}

export function extractHyattTaxesAndFees(text: string, expectedCurrency: string) {
  const compactText = text.replace(/\s+/g, " ");
  const currencyTokens = currencyTokensForCode(expectedCurrency);
  const currencyPattern = currencyTokens.map(escapeRegExp).join("|");
  const pattern = new RegExp(`(?:taxes\\s*&\\s*fees|taxes and fees|sales tax|tax)\\b.{0,80}?(?:${currencyPattern})\\s?([0-9][0-9,]{1,8}(?:\\.\\d{2})?)`, "gi");
  const matches = [...compactText.matchAll(pattern)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => value >= 0 && value <= 5000000);

  return matches.length > 0 ? { amount: Math.max(...matches), currency: expectedCurrency } : null;
}

export function extractHyattCancellationPolicy(text: string) {
  const compactText = text.replace(/\s+/g, " ");
  const match = compactText.match(/(?:cancellation|cancel|refundable|non-refundable|nonrefundable).{0,600}/i);
  return match?.[0]?.trim() ?? "Policy not visible in Hyatt detail page";
}

function extractDetailPriceSnippet(text: string, currency: string) {
  const compactText = text.replace(/\s+/g, " ");
  const tokens = currencyTokensForCode(currency);
  const tokenPattern = tokens.map(escapeRegExp).join("|");
  const match = compactText.match(new RegExp(`.{0,300}(?:${tokenPattern}).{0,500}`, "i"));
  return match?.[0]?.trim() ?? createTextSample(compactText);
}

function currencyTokensForCode(currency: string) {
  const map: Record<string, string[]> = {
    USD: ["USD", "US$", "$"],
    CAD: ["CAD", "CA$"],
    AUD: ["AUD", "A$"],
    HKD: ["HKD", "HK$"],
    SGD: ["SGD", "S$"],
    MYR: ["MYR", "RM"],
    JPY: ["JPY", "¥", "￥"],
    CNY: ["CNY", "RMB"],
    EUR: ["EUR", "€"],
    GBP: ["GBP", "£"],
    THB: ["THB", "฿"],
    KRW: ["KRW", "₩"]
  };

  return map[currency.toUpperCase()] ?? [currency.toUpperCase()];
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractNearbyHyattRoomName(textBeforeRate: string) {
  const roomPatterns = [
    /(?:ROOMS \(\d+\) SUITES \(\d+\)|SELECT & BOOK)\s+([^.!?]{3,80}?)\s+(?:Work|Enjoy|Relax|Unwind|View Room Details)/gi,
    /(?:^|\s)([0-9]\s+[A-Z][A-Za-z, &/-]{2,60}?)\s+(?:Work|Enjoy|Relax|Unwind|View Room Details)/gi
  ];
  const matches = roomPatterns.flatMap((pattern) => [...textBeforeRate.matchAll(pattern)].map((match) => cleanRoomName(match[1])));
  return matches.length > 0 ? matches[matches.length - 1] : null;
}

function cleanRoomName(value: string) {
  return value.replace(/^(ROOMS \(\d+\) SUITES \(\d+\)\s*)/i, "").trim();
}

function roomNamesLookSimilar(expectedRoomName: string, observedRoomName: string | null) {
  if (!observedRoomName) {
    return false;
  }
  const expected = normalizeHotelName(expectedRoomName);
  const observed = normalizeHotelName(observedRoomName);
  return expected === observed || expected.includes(observed) || observed.includes(expected);
}

export function extractLowestCashRate(text: string) {
  const currencyBeforeAmount =
    /(US\$|USD|CA\$|CAD|A\$|AUD|HK\$|HKD|S\$|SGD|MYR|RM|JPY|¥|￥|CNY|RMB|EUR|€|GBP|£|THB|฿|KRW|₩|\$)\s?([0-9][0-9,]{1,8})(?:\.\d{2})?/gi;
  const amountBeforeCurrency =
    /([0-9][0-9,]{1,8})(?:\.\d{2})?\s?(USD|CAD|AUD|HKD|SGD|MYR|JPY|CNY|RMB|EUR|GBP|THB|KRW)\b/gi;
  const matches = [
    ...[...text.matchAll(currencyBeforeAmount)].map((match) => ({
      amount: Number(match[2].replace(/,/g, "")),
      currency: normalizeCurrencyToken(match[1])
    })),
    ...[...text.matchAll(amountBeforeCurrency)].map((match) => ({
      amount: Number(match[1].replace(/,/g, "")),
      currency: normalizeCurrencyToken(match[2])
    }))
  ].filter((rate) => rate.amount >= 20 && rate.amount <= 5000000);

  return matches.length > 0 ? matches.sort((a, b) => a.amount - b.amount)[0] : null;
}

function normalizeCurrencyToken(token: string) {
  const normalized = token.toUpperCase();
  const map: Record<string, string> = {
    "US$": "USD",
    "$": "USD",
    "CA$": "CAD",
    "A$": "AUD",
    "HK$": "HKD",
    "S$": "SGD",
    RM: "MYR",
    "¥": "JPY",
    "￥": "JPY",
    RMB: "CNY",
    "€": "EUR",
    "£": "GBP",
    "฿": "THB",
    "₩": "KRW"
  };

  return map[token] ?? map[normalized] ?? normalized;
}

export function extractLowestPointsPrice(text: string) {
  const matches = [
    ...text.matchAll(/([0-9][0-9,]{3,7})\s*(?:points?|pts)(?:\s*\/\s*night)?/gi),
    ...text.matchAll(/(?:points?|pts)(?:\s*\/\s*night)?\s*([0-9][0-9,]{3,7})/gi),
    ...text.matchAll(/([0-9][0-9,]{3,7})\s*(?:point|pt)\s*(?:per|\/)?\s*night/gi)
  ]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((value) => value >= 1000 && value <= 500000);

  return matches.length > 0 ? Math.min(...matches) : null;
}

export function createTextSample(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, 500) || "empty page text";
}

async function collectPageText(
  url: string,
  browserMode: BrowserMode,
  chromeProfile?: ChromeProfileConfig | null
): Promise<
  | { ok: true; detailSelection?: unknown; detailText?: string; detailUrl?: string; selectedRate?: unknown; text: string }
  | { ok: false; error: string }
> {
  let browser: Awaited<ReturnType<typeof import("playwright").chromium.launch>> | null = null;

  try {
    if (browserMode === "chrome_profile" || browserMode === "persistent") {
      if (!chromeProfile) {
        return { ok: false, error: "Chrome profile settings are missing." };
      }
      const extraction = await extractRateDetailWithChromeProfile(url, chromeProfile);
      return {
        ok: true,
        detailSelection: extraction.detailSelection,
        detailText: extraction.detail?.text,
        detailUrl: extraction.detail?.url,
        selectedRate: extraction.selectedRate,
        text: extraction.list.text
      };
    }

    const { chromium } = await import("playwright");
    const pageWaitMs = browserMode === "headless" ? 6000 : 60000;
    const headless = browserMode === "headless";
    try {
      browser = await chromium.launch({ channel: "chrome", headless });
    } catch {
      browser = await chromium.launch({ headless });
    }
    const page = await browser.newPage({
      locale: "en-US",
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36"
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(pageWaitMs);
    const text = await page.locator("body").innerText({ timeout: 10000 });
    await browser.close();
    return { ok: true, text };
  } catch (error) {
    if (browser) {
      await browser.close().catch(() => undefined);
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown browser extraction failure"
    };
  }
}
