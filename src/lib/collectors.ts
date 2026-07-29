import { extractRateDetailWithChromeProfile, extractTextWithChromeProfile, type ChromeProfileConfig } from "@/lib/browserConnector";
import { externalCurrencyCode } from "@/lib/currency";

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
  inventoryTypes: readonly InventoryType[];
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
  breakfastIncluded: boolean;
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
  const hotelCode = extractHyattHotelCode(input.bookingUrl) ?? extractHyattHotelCode(input.hotelName);
  const params = new URLSearchParams({
    location: `${input.hotelName} ${input.city}`,
    checkinDate: input.checkIn.toISOString().slice(0, 10),
    checkoutDate: input.checkOut.toISOString().slice(0, 10),
    rooms: "1",
    adults: String(input.guests),
    kids: "0",
    currency: externalCurrencyCode(input.currency)
  });

  if (input.inventoryTypes.includes("award")) {
    params.set("usePoints", "true");
  }

  if (hotelCode) {
    return `https://www.hyatt.com/shop/rooms/${hotelCode}?${params.toString()}`;
  }

  return `https://www.hyatt.com/search/hotels/en-US/${encodeURIComponent(`${input.hotelName} ${input.city}`)}?${params.toString()}`;
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

function normalizeHotelName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
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
    const detailRateText = compactDetailText ?? (/Choose Your Rate/i.test(compactText) ? compactText : undefined);
    const cashRates = mergeHyattCashRates(
      extractHyattCashRates(compactText, input),
      detailRateText ? extractHyattDetailCashRates(detailRateText, input) : []
    );
    for (const cashRate of cashRates) {
      const detailTextForRate =
        compactDetailText && (cashRates.length === 1 || isDetailForHyattCashRate(cashRate, selectedRate)) ? compactDetailText : null;
      const detailTotal = detailTextForRate ? extractHyattFinalTotal(detailTextForRate, cashRate.currency) : null;
      const detailTaxesAndFees = detailTextForRate ? extractHyattTaxesAndFees(detailTextForRate, cashRate.currency) : null;
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
          rawPolicy: detailTextForRate ? extractHyattCancellationPolicy(detailTextForRate) : (cashRate.cancellationPolicy ?? extractHyattCancellationPolicy(cashRate.snippet)),
          deadline: null,
          match: "unknown",
          matchReason: detailTextForRate
            ? "The Hyatt detail page exposed policy text, but equivalence still requires review."
            : "The Hyatt room list candidate was captured without a selected detail-page comparison."
        },
        breakfastIncluded: cashRate.breakfastIncluded,
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
        breakfastIncluded: false,
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

function isDetailForHyattCashRate(cashRate: HyattCashRate, selectedRate: unknown) {
  if (!selectedRate || typeof selectedRate !== "object") {
    return false;
  }
  const selected = selectedRate as { amount?: unknown; snippet?: unknown };
  const selectedAmount = typeof selected.amount === "number" ? selected.amount : null;
  if (selectedAmount !== null) {
    return Math.abs(selectedAmount - cashRate.nightlyAmount) < 0.01;
  }
  const snippet = typeof selected.snippet === "string" ? selected.snippet : "";
  return Boolean(snippet && snippet.includes(cashRate.ratePlanName) && snippet.includes(String(cashRate.nightlyAmount)));
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
  breakfastIncluded: boolean;
  cancellationPolicy: string | null;
  nightlyAmount: number;
  totalAmount: number;
  currency: string;
  nights: number;
  roomName: string | null;
  ratePlanName: string;
  snippet: string;
};

export function extractBestHyattCashRate(text: string, input: Pick<CollectorInput, "checkIn" | "checkOut" | "roomType">): HyattCashRate | null {
  return extractHyattCashRates(text, input)[0] ?? null;
}

export function extractHyattCashRates(text: string, input: Pick<CollectorInput, "checkIn" | "checkOut" | "roomType">): HyattCashRate[] {
  const compactText = text.replace(/\s+/g, " ");
  const ratePattern =
    /\b(Long Stay Rate|Members Save More|Members Save|Member Rate with Breakfast|Breakfast Rate|Bed and Breakfast|Member Rate|Standard Rate|Advance Purchase Rate|Hyatt Member Rate|Flexible Rate|Best Available Rate)\s+(US\$|USD|CA\$|CAD|A\$|AUD|HK\$|HKD|S\$|SGD|MYR|RM|JPY|¥|￥|CNY|RMB|EUR|€|GBP|£|THB|฿|KRW|₩|\$)\s?([0-9][0-9,]{1,8})(?:\.\d{2})?\s*Avg\/Night/gi;
  const nights = calculateStayNights(input.checkIn, input.checkOut);
  const rates = [...compactText.matchAll(ratePattern)]
        .map((match) => {
      const nightlyAmount = Number(match[3].replace(/,/g, ""));
      const index = match.index ?? 0;
      const before = extractCurrentHyattRoomScope(compactText, index);
      const snippet = compactText.slice(Math.max(0, index - 220), Math.min(compactText.length, index + 260));
      return {
        breakfastIncluded: hasBreakfastIncluded(snippet) || hasBreakfastIncluded(match[1]),
        cancellationPolicy: null,
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
      ? [
          {
            breakfastIncluded: false,
            cancellationPolicy: null,
          nightlyAmount: fallback.amount,
          totalAmount: fallback.amount * nights,
          currency: fallback.currency ?? "USD",
          nights,
          roomName: null,
          ratePlanName: "Visible nightly rate",
          snippet: createTextSample(compactText)
          }
        ]
      : [];
  }

  return dedupeHyattCashRates(rates.sort((a, b) => a.totalAmount - b.totalAmount));
}

export function extractHyattDetailCashRates(text: string, input: Pick<CollectorInput, "checkIn" | "checkOut" | "roomType">): HyattCashRate[] {
  const compactText = text.replace(/\s+/g, " ");
  if (!/Choose Your Rate/i.test(compactText)) {
    return [];
  }
  const detailBlock = extractFirstHyattRateDetailBlock(compactText);
  const roomName = extractHyattDetailRoomName(detailBlock) ?? input.roomType;
  const policy = extractHyattCancellationPolicy(detailBlock);
  const nights = calculateStayNights(input.checkIn, input.checkOut);
  const currencyPattern = "(US\\$|USD|CA\\$|CAD|A\\$|AUD|HK\\$|HKD|S\\$|SGD|MYR|RM|JPY|¥|￥|CNY|RMB|EUR|€|GBP|£|THB|฿|KRW|₩|\\$)";
  const detailRatePattern = new RegExp(
    "\\b(Members Save More|Member Rate|Standard Rate|Member Bed and Breakfast|Bed and Breakfast)\\s+" +
      currencyPattern +
      "\\s?([0-9][0-9,]{1,8})(?:\\.\\d{2})?\\b",
    "gi"
  );

  const rates = [...detailBlock.matchAll(detailRatePattern)]
    .map((match) => {
      const ratePlanName = match[1].trim();
      const nightlyAmount = Number(match[3].replace(/,/g, ""));
      const index = match.index ?? 0;
      return {
        breakfastIncluded: hasBreakfastIncluded(ratePlanName),
        cancellationPolicy: policy,
        nightlyAmount,
        totalAmount: nightlyAmount * nights,
        currency: normalizeCurrencyToken(match[2]),
        nights,
        roomName,
        ratePlanName,
        snippet: detailBlock.slice(Math.max(0, index - 220), Math.min(detailBlock.length, index + 520))
      };
    })
    .filter((rate) => rate.nightlyAmount >= 20 && rate.nightlyAmount <= 5000000);

  return dedupeHyattCashRates(rates.sort((a, b) => a.totalAmount - b.totalAmount));
}

function extractHyattDetailRoomName(text: string) {
  const matches = [...text.matchAll(/SELECT & BOOK\s+(.{3,90}?)\s+Hyatt Place Kuala Lumpur Bukit Jalil Award Category/gi)].map((match) =>
    cleanRoomName(match[1])
  );
  return matches.find((name) => name && !/rate|price|guarantee/i.test(name)) ?? null;
}

function extractFirstHyattRateDetailBlock(text: string) {
  const startMatch = text.match(/SELECT & BOOK\s+.{3,90}?\s+Hyatt [^]{0,500}?Choose Your Rate/i);
  const start = startMatch?.index ?? text.search(/Choose Your Rate/i);
  if (start < 0) {
    return text;
  }
  const rest = text.slice(start);
  const endMatch = rest.match(/JOIN WHILE YOU BOOK\s+SIGN IN & BOOK/i);
  return endMatch?.index && endMatch.index > 0 ? rest.slice(0, endMatch.index) : rest;
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
    /(?:^|\s)([0-9]\s+[A-Z][A-Za-z, &/-]{2,60}?)\s+(?:Work|Enjoy|Relax|Unwind|View Room Details)/gi,
    /(?:SELECT & BOOK\s+)?([A-Z][A-Za-z0-9, &/-]{2,70}?(?:Room|Suite|King|Queen|Twin|Bed|Balcony))\s+(?:Work|Enjoy|Relax|Unwind|View Room Details)/gi,
    /(?:SELECT & BOOK\s+)?([0-9]\s+[A-Z][A-Za-z0-9, &/-]{2,70}?(?:Room|Suite|King|Queen|Twin|Bed|Balcony))\s+(?:Long Stay Rate|Members Save More|Members Save|Member Rate|Standard Rate|Advance Purchase Rate|Hyatt Member Rate|Flexible Rate|Best Available Rate)?$/gi
  ];
  const matches = roomPatterns.flatMap((pattern) =>
    [...textBeforeRate.matchAll(pattern)].map((match) => ({
      index: match.index ?? 0,
      name: cleanRoomName(match[1]),
      score: roomNameScore(cleanRoomName(match[1]))
    }))
  );
  const validMatches = matches.filter((match) => !/rate|avg\/night|cancellation|breakfast/i.test(match.name));
  const selected = validMatches
    .sort((a, b) => {
      if (Math.abs(b.index - a.index) <= 3 && b.score !== a.score) {
        return b.score - a.score;
      }
      if (b.index !== a.index) {
        return b.index - a.index;
      }
      return b.name.length - a.name.length;
    })[0]?.name;
  if (selected) {
    return selected;
  }

  const selectBookFallback = textBeforeRate.match(/Select & Book\s+(.{3,90})$/i);
  return selectBookFallback ? cleanRoomName(selectBookFallback[1]) : null;
}

function extractCurrentHyattRoomScope(text: string, rateIndex: number) {
  const before = text.slice(Math.max(0, rateIndex - 1200), rateIndex);
  const previousSelectIndex = before.lastIndexOf("SELECT & BOOK");
  if (previousSelectIndex >= 0) {
    return before.slice(previousSelectIndex);
  }
  const roomsMarker = before.match(/(?:ROOMS \(\d+\) SUITES \(\d+\)|Use Points ROOMS \(\d+\) SUITES \(\d+\))/gi);
  if (roomsMarker?.length) {
    const marker = roomsMarker[roomsMarker.length - 1];
    const markerIndex = before.lastIndexOf(marker);
    return before.slice(markerIndex);
  }
  return before;
}

function roomNameScore(name: string) {
  let score = 0;
  if (/^[0-9]\s/.test(name)) {
    score += 4;
  }
  if (/\b(?:suite|family|balcony|view|club|premium|deluxe)\b/i.test(name)) {
    score += 2;
  }
  if (/\b(?:room|king|queen|twin|bed)\b/i.test(name)) {
    score += 1;
  }
  return score;
}

function hasBreakfastIncluded(text: string) {
  return /\b(?:breakfast included|includes breakfast|with breakfast|bed and breakfast|breakfast rate)\b/i.test(text) &&
    !/\b(?:breakfast available|breakfast excluded|without breakfast|no breakfast)\b/i.test(text);
}

function dedupeHyattCashRates(rates: HyattCashRate[]) {
  const seen = new Set<string>();
  const result: HyattCashRate[] = [];
  for (const rate of rates) {
    const key = [rate.currency, rate.nightlyAmount, rate.roomName ?? "", rate.ratePlanName, rate.breakfastIncluded ? "breakfast" : "room-only"].join("|");
    if (!seen.has(key)) {
      seen.add(key);
      result.push(rate);
    }
  }
  return result.slice(0, 24);
}

function mergeHyattCashRates(listRates: HyattCashRate[], detailRates: HyattCashRate[]) {
  const byKey = new Map<string, HyattCashRate>();
  for (const rate of listRates) {
    byKey.set(hyattCashRateKey(rate), rate);
  }
  for (const rate of detailRates) {
    byKey.set(hyattCashRateKey(rate), rate);
  }
  return [...byKey.values()].sort((a, b) => a.totalAmount - b.totalAmount).slice(0, 24);
}

function hyattCashRateKey(rate: HyattCashRate) {
  return [rate.currency, rate.nightlyAmount, rate.roomName ?? "", rate.ratePlanName, rate.breakfastIncluded ? "breakfast" : "room-only"].join("|");
}

function cleanRoomName(value: string) {
  return value
    .replace(/^(ROOMS \(\d+\) SUITES \(\d+\)|SELECT & BOOK)\s*/i, "")
    .replace(/\s+(?:Long Stay Rate|Members Save More|Members Save|Member Rate with Breakfast|Breakfast Rate|Bed and Breakfast|Member Rate|Standard Rate|Advance Purchase Rate|Hyatt Member Rate|Flexible Rate|Best Available Rate).*$/i, "")
    .trim();
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
