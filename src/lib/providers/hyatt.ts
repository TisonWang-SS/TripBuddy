import taskProtocol from "@extension/taskProtocol.js";
import { planBrowserAgentAction } from "@/lib/providers/hyattBrowser";
import {
  isHyattReservationDetailUrl,
  parseHyattAccountBookingsFromSnapshots
} from "@/lib/providers/hyattAccount";
import { inferRoomMatch } from "@/lib/evidence";
import { normalizeBrowserEvidencePayload, parseHyattEvidenceFromTextWithMetadata } from "@/lib/providers/hyattEvidence";
import { extractHyattHotelCode } from "@/lib/providers/hyattUrls";
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
import { rollingGoGlobalOtaProvider } from "@/lib/providers/rollinggoGlobal";

const bookingPrice: BookingPriceProvider = {
  hotelGroup: "Hyatt",
  name: "hyatt-browser-companion",
  buildLaunchUrl: buildHyattBookingSearchUrl,
  inferLoginState: inferHyattLoginState,
  selectComparableAwards(inventory, input) {
    return awardsWithOneUndisputedPrice(inventory, input.roomType);
  },
  planAction(snapshot, input) {
    return planBrowserAgentAction({
      controls: snapshot.controls,
      pageText: snapshot.pageText,
      pageTitle: snapshot.pageTitle,
      sourceUrl: snapshot.sourceUrl,
      targetHotelName: input.hotelName,
      /* The award leg is the one that has not been walked yet. */
      wantsAwardRates:
        input.inventoryTypes.includes("award") && !(input.capturedModes ?? []).includes("award")
    });
  },
  parseSnapshot(snapshot, input) {
    const pageText = snapshot.pageText.replace(/\s+/g, " ").trim();
    const loginState = bookingPrice.inferLoginState(pageText);
    if (!pageText && !snapshot.pageTitle.trim()) {
      return {
        candidatesTruncated: false,
        errorCode: "empty_page",
        errorMessage: "Hyatt returned an empty page document.",
        inventory: [],
        loginState,
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "failed",
        summary: "Hyatt page evidence was empty and could not be read."
      };
    }
    if (!pageText) {
      return {
        candidatesTruncated: false,
        errorCode: "page_loading",
        errorMessage: "Hyatt's page title was visible while its booking content was still loading.",
        inventory: [],
        loginState,
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "partial",
        summary: "Hyatt's visible booking content was still loading."
      };
    }
    if (/Looks like an error occurred while your request was being processed/i.test(pageText)) {
      return {
        candidatesTruncated: false,
        errorCode: "hyatt_page_error",
        errorMessage: "Hyatt could not process the visible booking request after the page refresh.",
        inventory: [],
        loginState,
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "failed",
        summary: "Hyatt displayed a visible request-processing error page."
      };
    }
    if (/ERROR:E6020|browser did something unexpected|KPSDK/i.test(pageText)) {
      return {
        candidatesTruncated: false,
        errorCode: "hyatt_blocked",
        errorMessage: "Hyatt blocked or challenged the visible browser page.",
        inventory: [],
        loginState,
        observations: [],
        sourceUrl: snapshot.sourceUrl,
        status: "failed",
        summary: "Hyatt did not expose readable rate evidence."
      };
    }

    const extracted = parseHyattEvidenceFromTextWithMetadata(pageText, snapshot.sourceUrl);
    const normalized = normalizeBrowserEvidencePayload({
      bookingId: input.bookingId,
      candidates: extracted.candidates,
      capturedAt: snapshot.capturedAt,
      hotelGroup: "Hyatt",
      pageText,
      pageTitle: snapshot.pageTitle,
      sourceUrl: snapshot.sourceUrl
    });
    const inventory = normalized.candidates.map((candidate) => toDraft(candidate, snapshot.sourceUrl));
    const action = bookingPrice.planAction(snapshot, input);
    /*
     * One bar for both inventory types: a rate becomes an observation only
     * when it is a complete price for the stay.
     *
     * Cash has always been held to this — a room-list `Avg/Night` is a
     * transient inventory fact. Awards were not, so once the points extractor
     * started working a single room list wrote a dozen observations, including
     * points-plus-cash rates whose cash half is not even priced yet.
     */
    const comparableAwards = awardsWithOneUndisputedPrice(inventory, input.roomType);
    const observations = inventory.filter((candidate) =>
      candidate.inventoryType === "award"
        ? comparableAwards.includes(candidate)
        : action.action === "import" && candidate.cashTotal !== null
    );
    const requested = new Set(input.inventoryTypes);
    const selected = observations.filter(
      (candidate) => requested.has(candidate.inventoryType) || candidate.inventoryType === "cash"
    );

    return {
      candidatesTruncated: extracted.truncated,
      errorCode: selected.length > 0 ? null : "no_observation_ready_rate",
      errorMessage:
        selected.length > 0
          ? null
          : "Only transient room-list estimates or incomplete rate evidence were visible.",
      inventory,
      loginState,
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

export function inferHyattLoginState(pageText: string) {
  const normalized = pageText.replace(/\s+/g, " ").trim();
  if (/\b(?:Sign Out|Log Out|Upcoming Stays|My Stays|Points Balance|Account Overview)\b/i.test(normalized)) {
    return "member" as const;
  }
  if (/\b(?:Sign In|Log In|Join World of Hyatt|Not a member|Activate your online account)\b/i.test(normalized)) {
    return "anonymous" as const;
  }
  return "unknown" as const;
}

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
  otaPrice: rollingGoGlobalOtaProvider,
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
  /*
   * Sent, but not relied on. A real run opened this exact URL with
   * `usePoints=true` and got cash rates back, so the mode is entered by
   * pressing the page's own "Use Points" switch (see planBrowserAgentAction).
   * The parameter stays because Hyatt's search results may still read it, and
   * because dropping it would change a launch URL on no evidence — but
   * nothing downstream may treat it as proof the page is in points mode.
   */
  if (input.inventoryTypes.includes("award")) {
    params.set("usePoints", "true");
  }
  if (hotelCode) {
    return `https://www.hyatt.com/shop/rooms/${hotelCode}?${params.toString()}`;
  }
  const location = encodeURIComponent(`${input.hotelName} ${input.city}`);
  return `https://www.hyatt.com/search/hotels/en-US/${location}?${params.toString()}`;
}

/*
 * The awards this booking can actually be compared against.
 *
 * A points room list prices every room at once, so without this a single
 * capture writes an observation for each of them and the traveller is handed
 * four rooms they did not book. Room comparability is decided by the same
 * function the evidence layer already uses, so the filter and the grading
 * cannot drift apart into two different ideas of "the same room".
 *
 * The one-price rule below is not a claim that Hyatt contradicts itself. It
 * guards flattening: an expanded rate panel is a carousel, and its slides can
 * collapse into one run of text where a heading from one slide sits beside a
 * price from another. Two different stay prices for one room means the capture
 * cannot say which is the room's rate, so neither is used.
 */
function awardsWithOneUndisputedPrice(inventory: readonly ParsedObservationDraft[], bookedRoomType: string) {
  const byRoom = new Map<string, ParsedObservationDraft[]>();
  for (const candidate of inventory) {
    if (candidate.inventoryType !== "award" || candidate.points === null || candidate.pointsBasis !== "stay_total") {
      continue;
    }
    /* Exact only. A club-access or view variant is a different room at a
     * different price, and a points list offers all of them at once. */
    if (inferRoomMatch(bookedRoomType, candidate.roomTypeRaw).match !== "exact") {
      continue;
    }
    const room = (candidate.roomTypeRaw ?? "").trim().toLowerCase();
    byRoom.set(room, [...(byRoom.get(room) ?? []), candidate]);
  }
  return [...byRoom.values()]
    .filter((group) => new Set(group.map((candidate) => candidate.points)).size === 1)
    .map((group) => group[0]);
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
    pointsBasis: candidate.pointsBasis,
    ratePlanName: candidate.ratePlanName,
    rawRateName: candidate.rawRateName,
    roomTypeRaw: candidate.roomTypeRaw,
    sourceUrl,
    taxesIncluded: candidate.taxesIncluded
  };
}

/* Re-exported so existing callers keep one import path. */
export { extractHyattHotelCode } from "@/lib/providers/hyattUrls";
