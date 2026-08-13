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
import { getHotelSearchSession, type HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";
import type { HotelSearchBudget } from "@/lib/providers/types";

/* Computed once: the registry is static metadata, and the list is provider-driven. */
const SEARCHABLE_GROUPS = supportedHotelSearchGroups();

export type SearchHotelsArgs = {
  adults?: number;
  budget: HotelSearchBudget | null;
  checkIn: string;
  checkOut: string;
  city: string;
  cityAsAsked: string;
  currency?: string;
  hotelGroup: string;
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
      description: "Budget amount exactly as stated by the user; do not multiply it by the stay length.",
      name: "budgetAmount",
      required: false,
      type: "number"
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
    }
  ],
  resultRoute() {
    return "/hotel-search";
  },
  parseArgs(raw) {
    const bag = argsBag(raw, [
      "adults",
      "budgetAmount",
      "budgetBasis",
      "budgetFlexibility",
      "checkIn",
      "checkOut",
      "city",
      "cityAsAsked",
      "currency",
      "hotelGroup"
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
    if (budgetAmount === undefined && (statedBasis !== undefined || statedFlexibility !== undefined)) {
      throw new CapabilityArgsError('"budgetAmount" is required when a budget basis or flexibility is supplied.');
    }
    return {
      adults: optionalInteger(bag, "adults"),
      budget: budgetAmount === undefined
        ? null
        : {
            amount: budgetAmount,
            basis: statedBasis ?? "per_night",
            basisAssumed: statedBasis === undefined,
            flexibility: statedFlexibility ?? "maximum"
          },
      checkIn,
      checkOut,
      city: requireString(bag, "city"),
      cityAsAsked: requireString(bag, "cityAsAsked"),
      currency,
      hotelGroup: optionalEnum(bag, "hotelGroup", SEARCHABLE_GROUPS) ?? SEARCHABLE_GROUPS[0]
    };
  },
  async run({ adults, budget, checkIn, checkOut, city, cityAsAsked, currency, hotelGroup }) {
    const task = await createHotelSearchTask({
      adults,
      budget,
      checkIn,
      checkOut,
      city,
      cityAsAsked,
      currency,
      hotelGroup,
      mode: "city_results"
    });
    /* The task state is spread from a nullable serializer; a fresh task has both. */
    if (!task.launchUrl || !task.taskId) {
      throw new Error("The hotel search task was created but its launch state could not be read back.");
    }
    return { launchUrl: task.launchUrl, searchSessionId: task.searchSessionId, taskId: task.taskId };
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
