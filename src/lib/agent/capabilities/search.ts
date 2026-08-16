import {
  argsBag,
  CapabilityArgsError,
  optionalEnum,
  optionalInteger,
  optionalPositiveNumber,
  optionalString,
  requireString,
  requireUpcomingCalendarDate
} from "@/lib/agent/args";
import type { Capability } from "@/lib/agent/types";
import { createHotelSearchTask, supportedHotelSearchGroups } from "@/lib/hotelSearchTasks";
import { applyHotelSearchBudget, getHotelSearchSession, type HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import { getProfileSearchCurrency } from "@/lib/profilePreferences";
import type { HotelSearchBudget, HotelSearchPriceMode } from "@/lib/providers/types";

/* Computed once: the registry is static metadata, and the list is provider-driven. */
const SEARCHABLE_GROUPS = supportedHotelSearchGroups();

export type HotelOfferDetail = {
  availability: string;
  checkIn: string;
  checkOut: string;
  hotelName: string;
  location: string | null;
  offers: {
    breakfastIncluded: boolean | null;
    cancellationPolicy: string | null;
    capturedAt: string;
    currency: string;
    evidenceLevel: string;
    isHyatt: boolean;
    nightlyRate: number | null;
    pointsPerNight: number | null;
    priceBasis: string;
    ratePlan: string | null;
    roomType: string | null;
    source: string;
    stayTotal: number | null;
    warnings: string[];
  }[];
};

export type SearchHotelsArgs = {
  adults?: number;
  budget: HotelSearchBudget | null;
  checkIn: string;
  checkOut: string;
  city: string;
  cityAsAsked: string;
  currency?: string;
  hotelGroup: string;
  priceMode?: HotelSearchPriceMode;
};

const BUDGET_BASES = ["per_night", "stay_total"] as const;
const BUDGET_FLEXIBILITIES = ["maximum", "approximate"] as const;

/**
 * City results only. The tax-inclusive total is a second step that needs a
 * hotel picked out of an existing session, so it belongs to the search page's
 * own flow rather than to a standalone intent.
 */
export const searchHotels: Capability<SearchHotelsArgs, { launchUrl: string; searchSessionId: string; taskId: string }> = {
  name: "search_hotels",
  keywords: ["search", "find a hotel", "availability", "look for", "hotels in"],
  summary: "Open a Hyatt tab and collect comparable city rates for a set of dates.",
  effect: "browser_task",
  params: [
    {
      description: "Latin-letter city or destination name accepted by the hotel search path.",
      name: "city",
      required: true,
      type: "string"
    },
    {
      description: "The city or destination exactly as the user asked for it, retained for display.",
      name: "cityAsAsked",
      required: true,
      type: "string"
    },
    { description: "Check-in date, YYYY-MM-DD.", name: "checkIn", required: true, type: "calendar_date" },
    { description: "Check-out date, YYYY-MM-DD.", name: "checkOut", required: true, type: "calendar_date" },
    { description: "Number of adults. Defaults to the profile setting.", name: "adults", required: false, type: "integer" },
    {
      description: "The amount the request states, in digits even if the user spelled it out; never multiplied by the stay length.",
      name: "budgetAmount",
      required: false,
      type: "number"
    },
    {
      description:
        "One short, contiguous, exact substring of the request containing the budget as the user wrote it. Required whenever budgetAmount is given.",
      name: "budgetQuote",
      required: false,
      type: "string"
    },
    {
      description: "Whether the stated amount is per night or for the whole stay. Omit when the user gives no basis.",
      enumValues: BUDGET_BASES,
      name: "budgetBasis",
      required: false,
      type: "enum"
    },
    {
      description: "Use approximate only for wording such as around, about, approximately, or 左右.",
      enumValues: BUDGET_FLEXIBILITIES,
      name: "budgetFlexibility",
      required: false,
      type: "enum"
    },
    {
      description: "ISO currency code only when the user states a budget currency; it must match the profile currency.",
      name: "currency",
      required: false,
      type: "string"
    },
    {
      description: "Loyalty program to search. Only Hyatt is collected today.",
      enumValues: SEARCHABLE_GROUPS,
      name: "hotelGroup",
      required: false,
      type: "enum"
    },
    {
      description: "Cash is the default. Use points for wording such as 积分价, 点数, points, or award.",
      enumValues: ["cash", "points"],
      name: "priceMode",
      required: false,
      type: "enum"
    }
  ],
  resultRoute() {
    return "/hotel-search";
  },
  /*
   * The provider refuses a currency the profile is not set to, but only once the
   * task is being created — after the press. Asked here, "1000元 while the desk
   * shows USD" is a question with two answers the user can actually give,
   * instead of a failure on a tab they just opened.
   */
  async precheck({ currency }) {
    if (!currency) {
      return null;
    }
    const profileCurrency = await getProfileSearchCurrency();
    if (currency === profileCurrency) {
      return null;
    }
    return (
      `Prices here are collected in ${profileCurrency}, and you gave a budget in ${currency}. TripBuddy does not convert between ` +
      `them, because a rate it invented would decide whether a hotel fits your budget. Either give the amount in ${profileCurrency}, ` +
      `or change the display currency in Profile and ask again.`
    );
  },
  parseArgs(raw) {
    const bag = argsBag(normalizeSerializedSearchArgs(raw), [
      "adults",
      "budgetAmount",
      "budgetBasis",
      "budgetFlexibility",
      "budgetQuote",
      "checkIn",
      "checkOut",
      "city",
      "cityAsAsked",
      "currency",
      "hotelGroup",
      "priceMode"
    ]);
    const checkIn = requireUpcomingCalendarDate(bag, "checkIn");
    const checkOut = requireUpcomingCalendarDate(bag, "checkOut");
    /*
     * The provider rejects this too, but only once the task is being created —
     * after the confirmation press. Refusing it here makes it a question.
     */
    if (checkOut <= checkIn) {
      throw new CapabilityArgsError(`"checkOut" must be after "checkIn"; received ${checkIn} to ${checkOut}.`);
    }
    const currency = optionalString(bag, "currency")?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new CapabilityArgsError(`"currency" must be a three-letter ISO currency code; received ${currency}.`);
    }
    const budgetAmount = optionalPositiveNumber(bag, "budgetAmount");
    const statedBasis = optionalEnum(bag, "budgetBasis", BUDGET_BASES);
    const statedFlexibility = optionalEnum(bag, "budgetFlexibility", BUDGET_FLEXIBILITIES);
    const budgetQuote = optionalString(bag, "budgetQuote");
    const priceMode = optionalEnum(bag, "priceMode", ["cash", "points"] as const);
    if (budgetAmount === undefined && (statedBasis !== undefined || statedFlexibility !== undefined || budgetQuote !== undefined)) {
      throw new CapabilityArgsError('"budgetAmount" is required when a budget basis, flexibility, or quote is supplied.');
    }
    /*
     * The amount may legitimately be written differently from the request —
     * "一千" arrives as 1000 — so the quote is what ties it back to something the
     * user actually wrote. The router verifies the quote occurs verbatim;
     * requiring it here is what guarantees there is one to verify.
     */
    if (budgetAmount !== undefined && budgetQuote === undefined) {
      throw new CapabilityArgsError('"budgetQuote" is required when a budget amount is supplied.');
    }
    return {
      adults: optionalInteger(bag, "adults"),
      budget: budgetAmount === undefined
        ? null
        : {
            amount: budgetAmount,
            basis: statedBasis ?? "per_night",
            basisAssumed: statedBasis === undefined,
            flexibility: statedFlexibility ?? "maximum",
            quote: budgetQuote ?? null
          },
      checkIn,
      checkOut,
      city: requireString(bag, "city"),
      cityAsAsked: requireString(bag, "cityAsAsked"),
      currency,
      hotelGroup: optionalEnum(bag, "hotelGroup", SEARCHABLE_GROUPS) ?? SEARCHABLE_GROUPS[0],
      ...(priceMode ? { priceMode } : {})
    };
  },
  async run({ adults, budget, checkIn, checkOut, city, cityAsAsked, currency, hotelGroup, priceMode }) {
    const task = await createHotelSearchTask({
      adults,
      budget,
      checkIn,
      checkOut,
      city,
      cityAsAsked,
      currency,
      hotelGroup,
      mode: priceMode === "points" ? "city_points" : "city_results",
      priceMode
    });
    /* The task state is spread from a nullable serializer; a fresh task has both. */
    if (!task.launchUrl || !task.taskId) {
      throw new Error("The hotel search task was created but its launch state could not be read back.");
    }
    return { launchUrl: task.launchUrl, searchSessionId: task.searchSessionId, taskId: task.taskId };
  }
};

/*
 * The command bar announces parsed arguments on the first run and may send
 * those same arguments back on a retry. Accept the serialized budget shape as
 * well as the router's raw budgetAmount fields so a harmless retry cannot fail
 * with "Unexpected argument(s): budget".
 */
function normalizeSerializedSearchArgs(raw: unknown) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || !("budget" in raw)) {
    return raw;
  }
  const { budget, ...rest } = raw as Record<string, unknown>;
  if (budget === null || budget === undefined) {
    return rest;
  }
  if (typeof budget !== "object" || Array.isArray(budget)) {
    return { ...rest, budgetAmount: budget };
  }
  const value = budget as Record<string, unknown>;
  return {
    ...rest,
    ...(value.amount === undefined ? {} : { budgetAmount: value.amount }),
    ...(value.basis === undefined ? {} : { budgetBasis: value.basis }),
    ...(value.flexibility === undefined ? {} : { budgetFlexibility: value.flexibility }),
    ...(value.quote === undefined ? {} : { budgetQuote: value.quote })
  };
}

/**
 * A condition added to a search that already ran.
 *
 * This exists because the loop had no way to say "same search, one more
 * constraint". A traveler who sees the results and then adds "around 1000 a
 * night" was met with a fresh browser task for the identical city and dates —
 * a second press, a second tab, and the same rates back. A budget filters what
 * was collected; it is not an input to collecting it.
 *
 * A read, so it needs no confirmation: nothing is fetched and nothing is opened.
 */
export const setSearchBudget: Capability<
  {
    budget: HotelSearchBudget | null;
    currency?: string;
    searchSessionId: string;
  },
  { session: HotelSearchSessionSnapshot | null }
> = {
  name: "set_search_budget",
  keywords: ["budget", "under", "at most", "around", "per night", "cheaper than", "within"],
  summary:
    "Apply or change a budget on a hotel search that already has results, and re-judge those results against it. Does not open a browser.",
  effect: "read",
  params: [
    {
      description: "The search session to filter. Use the sessionId from an earlier search result.",
      name: "searchSessionId",
      required: true,
      type: "string"
    },
    {
      description: "The amount the request states, in digits even if the user spelled it out; never multiplied by nights.",
      name: "budgetAmount",
      required: false,
      type: "number"
    },
    {
      description:
        "One short, contiguous, exact substring of the request containing the budget as the user wrote it. Required whenever budgetAmount is given.",
      name: "budgetQuote",
      required: false,
      type: "string"
    },
    {
      description: "Whether the stated amount is per night or for the whole stay. Omit when the user gives no basis.",
      enumValues: BUDGET_BASES,
      name: "budgetBasis",
      required: false,
      type: "enum"
    },
    {
      description: "Use approximate only for wording such as around, about, approximately, or 左右.",
      enumValues: BUDGET_FLEXIBILITIES,
      name: "budgetFlexibility",
      required: false,
      type: "enum"
    },
    {
      description: "ISO currency code only when the user names one. It must match the currency the search was priced in.",
      name: "currency",
      required: false,
      type: "string"
    }
  ],
  parseArgs(raw) {
    const bag = argsBag(normalizeSerializedSearchArgs(raw), [
      "budgetAmount",
      "budgetBasis",
      "budgetFlexibility",
      "budgetQuote",
      "currency",
      "searchSessionId"
    ]);
    const budgetAmount = optionalPositiveNumber(bag, "budgetAmount");
    const statedBasis = optionalEnum(bag, "budgetBasis", BUDGET_BASES);
    const statedFlexibility = optionalEnum(bag, "budgetFlexibility", BUDGET_FLEXIBILITIES);
    const budgetQuote = optionalString(bag, "budgetQuote");
    const currency = optionalString(bag, "currency")?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) {
      throw new CapabilityArgsError(`"currency" must be a three-letter ISO currency code; received ${currency}.`);
    }
    if (budgetAmount !== undefined && budgetQuote === undefined) {
      throw new CapabilityArgsError('"budgetQuote" is required when a budget amount is supplied.');
    }
    return {
      budget: budgetAmount === undefined
        ? null
        : {
            amount: budgetAmount,
            basis: statedBasis ?? "per_night",
            basisAssumed: statedBasis === undefined,
            flexibility: statedFlexibility ?? "maximum",
            quote: budgetQuote ?? null
          },
      currency,
      searchSessionId: requireString(bag, "searchSessionId")
    };
  },
  async run({ budget, currency, searchSessionId }) {
    const existing = await getHotelSearchSession(searchSessionId);
    if (!existing) {
      throw new CapabilityArgsError("That search has expired. Ask for the city and dates again and I will collect fresh prices.");
    }
    /*
     * The product does not convert currencies, so a budget named in one the
     * search was not priced in cannot be compared to anything. Refusing here
     * with the two currencies named is what turns it into a question the user
     * can act on, rather than a filter that silently compares 1000 CNY to a
     * dollar figure.
     */
    if (currency && currency !== existing.query.currency) {
      throw new CapabilityArgsError(
        `These prices are in ${existing.query.currency} and the budget is in ${currency}. TripBuddy does not convert between them: ` +
          `either give the budget in ${existing.query.currency}, or change the display currency in Profile and search again.`
      );
    }
    return { session: await applyHotelSearchBudget(searchSessionId, budget) };
  }
};

/**
 * The upgrade from a starting price to a price that can settle a budget.
 *
 * This existed only as a button beside each hotel, which put the judgement of
 * *when* a total is needed on the reader: they had to know that an Avg/Night
 * excludes taxes and fees, and press accordingly. As a capability the agent
 * makes that call itself — a stated budget and a starting-price-only row is
 * exactly the situation the loop should resolve without being asked.
 *
 * The stay conditions are read from the saved session rather than accepted as
 * arguments. A total for slightly different dates than the search that produced
 * the row is not comparable to it, and the task layer rejects the mismatch
 * anyway; taking them from the session means there is nothing to mismatch.
 */
export const getTaxInclusiveTotal: Capability<
  { hotelName: string; searchSessionId: string },
  { launchUrl: string; searchSessionId: string; taskId: string }
> = {
  name: "get_tax_inclusive_total",
  keywords: ["final total", "tax inclusive", "all in price", "total cost", "with taxes"],
  summary:
    "Open a Hyatt tab and capture one hotel's verified tax-inclusive total for a stay already found by search_hotels.",
  effect: "browser_task",
  params: [
    {
      description: "The hotel name exactly as it appears in the search results.",
      name: "hotelName",
      required: true,
      type: "string"
    },
    {
      description: "The search session the hotel was found in.",
      name: "searchSessionId",
      required: true,
      type: "string"
    }
  ],
  resultRoute({ searchSessionId }) {
    return `/hotel-search?sessionId=${encodeURIComponent(searchSessionId)}`;
  },
  parseArgs(raw) {
    const bag = argsBag(raw, ["hotelName", "searchSessionId"]);
    return {
      hotelName: requireString(bag, "hotelName"),
      searchSessionId: requireString(bag, "searchSessionId")
    };
  },
  async run({ hotelName, searchSessionId }) {
    const session = await getHotelSearchSession(searchSessionId);
    if (!session) {
      throw new CapabilityArgsError("That hotel search session expired. Run the city search again before asking for a total.");
    }
    const known = session.results.hotels.some((hotel) => hotel.hotelName === hotelName);
    if (!known) {
      throw new CapabilityArgsError(`“${hotelName}” is not one of the hotels in that search. Name one from the results.`);
    }
    const task = await createHotelSearchTask({
      ...session.query,
      hotelName,
      mode: "tax_inclusive_total",
      searchSessionId
    });
    if (!task.launchUrl || !task.taskId) {
      throw new Error("The tax-inclusive task was created but its launch state could not be read back.");
    }
    return { launchUrl: task.launchUrl, searchSessionId: task.searchSessionId, taskId: task.taskId };
  }
};

/**
 * One hotel's captured detail, rather than the whole result set again.
 *
 * These fields — cancellation terms, room, rate plan, breakfast — have been
 * collected since the search layer existed and had no way to be read. "Can I
 * cancel this one for free?" could only be answered by re-listing everything
 * and hoping the summary happened to mention it.
 *
 * Kept as a read over an existing session rather than a fresh capture: the
 * answer is already stored, and asking Hyatt again would cost a press for
 * something nobody needs to re-verify.
 */
export const getHotelOfferDetail: Capability<
  { hotelName: string; searchSessionId: string },
  { hotel: HotelOfferDetail | null }
> = {
  name: "get_hotel_offer_detail",
  keywords: ["cancellation", "policy", "room type", "breakfast", "rate plan", "details", "what is included"],
  summary:
    "Read one hotel's captured detail from an existing search: cancellation terms, room and rate plan, breakfast, and where each price came from. Does not open a browser.",
  effect: "read",
  params: [
    { description: "The hotel name exactly as it appears in the search results.", name: "hotelName", required: true, type: "string" },
    { description: "The search session the hotel was found in.", name: "searchSessionId", required: true, type: "string" }
  ],
  parseArgs(raw) {
    const bag = argsBag(raw, ["hotelName", "searchSessionId"]);
    return { hotelName: requireString(bag, "hotelName"), searchSessionId: requireString(bag, "searchSessionId") };
  },
  async run({ hotelName, searchSessionId }) {
    const session = await getHotelSearchSession(searchSessionId);
    const hotel = session?.results.hotels.find((entry) => entry.hotelName === hotelName) ?? null;
    if (!session || !hotel) {
      return { hotel: null };
    }
    return {
      hotel: {
        availability: hotel.availabilityLabel,
        checkIn: session.query.checkIn,
        checkOut: session.query.checkOut,
        hotelName: hotel.hotelName,
        location: hotel.locationLabel,
        offers: hotel.offers.map((offer) => ({
          breakfastIncluded: offer.breakfastIncluded,
          cancellationPolicy: offer.cancellationPolicy,
          capturedAt: offer.capturedAt,
          currency: offer.currency,
          evidenceLevel: offer.evidenceLevel,
          isHyatt: offer.sourceType !== "ota",
          nightlyRate: offer.startingAvgNightlyRate,
          pointsPerNight: offer.startingPointsPerNight ?? null,
          priceBasis: offer.displayedPriceBasis,
          ratePlan: offer.ratePlanName,
          roomType: offer.roomType,
          source: offer.sourceName,
          stayTotal: offer.stayTotal,
          warnings: offer.comparisonWarnings
        }))
      }
    };
  }
};

export const getSearchSession: Capability<{ sessionId: string }, { session: HotelSearchSessionSnapshot | null }> = {
  name: "get_hotel_search_session",
  keywords: ["search results", "offers", "search session"],
  summary: "Read the offers already collected for a hotel search session.",
  effect: "read",
  params: [{ description: "The search session identifier.", name: "sessionId", required: true, type: "string" }],
  parseArgs(raw) {
    const bag = argsBag(raw, ["sessionId"]);
    return { sessionId: requireString(bag, "sessionId") };
  },
  async run({ sessionId }) {
    return { session: await getHotelSearchSession(sessionId) };
  }
};
