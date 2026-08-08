import taskProtocol from "@extension/taskProtocol.js";
import { planBrowserAgentAction } from "@/lib/providers/hyattBrowser";
import {
  isHyattReservationDetailUrl,
  parseHyattAccountBookingsFromSnapshots
} from "@/lib/providers/hyattAccount";
import { normalizeBrowserEvidencePayload, parseHyattEvidenceFromText } from "@/lib/providers/hyattEvidence";
import {
  buildHyattCitySearchUrl,
  normalizeHyattCitySearchQuery,
  parseHyattCitySearchCards
} from "@/lib/providers/hyattSearch";
import type {
  AccountBookingImporter,
  BookingPriceInput,
  BookingPriceProvider,
  HotelProvider,
  HotelSearchProvider,
  ParsedObservationDraft
} from "@/lib/providers/types";

const bookingPrice: BookingPriceProvider = {
  hotelGroup: "Hyatt",
  name: "hyatt-browser-companion",
  buildLaunchUrl: buildHyattBookingSearchUrl,
  planAction(snapshot, input) {
    return planBrowserAgentAction({
      controls: snapshot.controls,
      pageText: snapshot.pageText,
      pageTitle: snapshot.pageTitle,
      sourceUrl: snapshot.sourceUrl,
      targetHotelName: input.hotelName
    });
  },
  parseSnapshot(snapshot, input) {
    const pageText = snapshot.pageText.replace(/\s+/g, " ").trim();
    if (!pageText && !snapshot.pageTitle.trim()) {
      return {
        errorCode: "empty_page",
        errorMessage: "Hyatt returned an empty page document.",
        inventory: [],
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "failed",
        summary: "Hyatt page evidence was empty and could not be read."
      };
    }
    if (!pageText) {
      return {
        errorCode: "page_loading",
        errorMessage: "Hyatt's page title was visible while its booking content was still loading.",
        inventory: [],
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "partial",
        summary: "Hyatt's visible booking content was still loading."
      };
    }
    if (/Looks like an error occurred while your request was being processed/i.test(pageText)) {
      return {
        errorCode: "hyatt_page_error",
        errorMessage: "Hyatt could not process the visible booking request after the page refresh.",
        inventory: [],
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "failed",
        summary: "Hyatt displayed a visible request-processing error page."
      };
    }
    if (/ERROR:E6020|browser did something unexpected|KPSDK/i.test(pageText)) {
      return {
        errorCode: "hyatt_blocked",
        errorMessage: "Hyatt blocked or challenged the visible browser page.",
        inventory: [],
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "failed",
        summary: "Hyatt did not expose readable rate evidence."
      };
    }

    const normalized = normalizeBrowserEvidencePayload({
      bookingId: input.bookingId,
      candidates: parseHyattEvidenceFromText(pageText, snapshot.sourceUrl),
      capturedAt: snapshot.capturedAt,
      hotelGroup: "Hyatt",
      pageText,
      pageTitle: snapshot.pageTitle,
      sourceUrl: snapshot.sourceUrl
    });
    const inventory = normalized.candidates.map((candidate) => toDraft(candidate, snapshot.sourceUrl));
    const action = bookingPrice.planAction(snapshot, input);
    const observations = inventory.filter(
      (candidate) => candidate.inventoryType === "award" || (action.action === "import" && candidate.cashTotal !== null)
    );
    const requested = new Set(input.inventoryTypes);
    const selected = observations.filter(
      (candidate) => requested.has(candidate.inventoryType) || candidate.inventoryType === "cash"
    );

    return {
      errorCode: selected.length > 0 ? null : "no_observation_ready_rate",
      errorMessage:
        selected.length > 0
          ? null
          : "Only transient room-list estimates or incomplete rate evidence were visible.",
      inventory,
      observations: selected,
      sourceUrl: snapshot.sourceUrl,
      status: selected.length > 0 ? "succeeded" : inventory.length > 0 ? "partial" : "partial",
      summary:
        selected.length > 0
          ? `Hyatt produced ${selected.length} observation-ready rate${selected.length === 1 ? "" : "s"}.`
          : inventory.length > 0
            ? "Hyatt inventory was captured, but no final cash total or explicit award was ready to store."
            : "Hyatt opened, but no supported rate evidence was parsed."
    };
  }
};

const hotelSearch: HotelSearchProvider = {
  hotelGroup: "Hyatt",
  name: "hyatt-official-search",
  buildSearchUrl(query) {
    return buildHyattCitySearchUrl(query);
  },
  normalizeSearchQuery(input) {
    const result = normalizeHyattCitySearchQuery(input);
    return {
      errors: result.errors,
      query: { ...result.query, hotelGroup: "Hyatt" }
    };
  },
  parseSearchSnapshot(snapshot) {
    return parseHyattCitySearchCards([snapshot.pageText], snapshot.sourceUrl);
  }
};

const accountImporter: AccountBookingImporter = {
  hotelGroup: "Hyatt",
  name: "hyatt-account-import",
  buildLaunchUrl(taskId, endpoint) {
    const hash = new URLSearchParams([
      [taskProtocol.endpointKey, endpoint],
      [taskProtocol.taskIdKey, taskId]
    ]);
    return `https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays&${hash.toString()}`;
  },
  isReservationDetailUrl: isHyattReservationDetailUrl,
  parseSnapshots: parseHyattAccountBookingsFromSnapshots
};

export const hyattProvider: HotelProvider = {
  accountImporter,
  bookingPrice,
  hotelGroup: "Hyatt",
  hotelSearch
};

export function buildHyattBookingSearchUrl(input: BookingPriceInput) {
  const hotelCode = extractHyattHotelCode(input.bookingUrl) ?? extractHyattHotelCode(input.hotelName);
  const params = new URLSearchParams({
    adults: String(input.guests),
    checkinDate: input.checkIn.toISOString().slice(0, 10),
    checkoutDate: input.checkOut.toISOString().slice(0, 10),
    currency: input.currency,
    kids: "0",
    location: `${input.hotelName} ${input.city}`,
    rooms: "1"
  });
  if (input.inventoryTypes.includes("award")) {
    params.set("usePoints", "true");
  }
  if (hotelCode) {
    return `https://www.hyatt.com/shop/rooms/${hotelCode}?${params.toString()}`;
  }
  const location = encodeURIComponent(`${input.hotelName} ${input.city}`);
  return `https://www.hyatt.com/search/hotels/en-US/${location}?${params.toString()}`;
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

function toDraft(
  candidate: ReturnType<typeof normalizeBrowserEvidencePayload>["candidates"][number],
  sourceUrl: string
): ParsedObservationDraft {
  return {
    breakfastIncluded: candidate.breakfastIncluded,
    cancellationPolicyRaw: candidate.cancellationPolicyRaw,
    cashBase: candidate.inventoryType === "cash" ? candidate.basePrice : null,
    cashCopay: null,
    cashCurrency: candidate.currency || null,
    cashFees: candidate.fees,
    cashTaxes: candidate.taxes,
    cashTotal: candidate.inventoryType === "cash" ? candidate.totalPrice : null,
    feesIncluded: candidate.feesIncluded,
    inventoryType: candidate.inventoryType,
    loyaltyEligible: true,
    points: candidate.pointsPrice,
    ratePlanName: candidate.ratePlanName,
    rawRateName: candidate.rawRateName,
    roomTypeRaw: candidate.roomTypeRaw,
    sourceUrl,
    taxesIncluded: candidate.taxesIncluded
  };
}
