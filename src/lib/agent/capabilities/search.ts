import {
  argsBag,
  CapabilityArgsError,
  optionalEnum,
  optionalInteger,
  requireString,
  requireUpcomingCalendarDate
} from "@/lib/agent/args";
import type { Capability } from "@/lib/agent/types";
import { createHotelSearchTask, supportedHotelSearchGroups } from "@/lib/hotelSearchTasks";
import { getHotelSearchSession, type HotelSearchSessionSnapshot } from "@/lib/hotelSearchSessions";

/* Computed once: the registry is static metadata, and the list is provider-driven. */
const SEARCHABLE_GROUPS = supportedHotelSearchGroups();

export type SearchHotelsArgs = {
  adults?: number;
  checkIn: string;
  checkOut: string;
  city: string;
  hotelGroup: string;
};

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
    { description: "City to search.", name: "city", required: true, type: "string" },
    { description: "Check-in date, YYYY-MM-DD.", name: "checkIn", required: true, type: "calendar_date" },
    { description: "Check-out date, YYYY-MM-DD.", name: "checkOut", required: true, type: "calendar_date" },
    { description: "Number of adults. Defaults to the profile setting.", name: "adults", required: false, type: "integer" },
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
    const bag = argsBag(raw, ["adults", "checkIn", "checkOut", "city", "hotelGroup"]);
    const checkIn = requireUpcomingCalendarDate(bag, "checkIn");
    const checkOut = requireUpcomingCalendarDate(bag, "checkOut");
    /*
     * The provider rejects this too, but only once the task is being created —
     * after the confirmation press. Refusing it here makes it a question.
     */
    if (checkOut <= checkIn) {
      throw new CapabilityArgsError(`"checkOut" must be after "checkIn"; received ${checkIn} to ${checkOut}.`);
    }
    return {
      adults: optionalInteger(bag, "adults"),
      checkIn,
      checkOut,
      city: requireString(bag, "city"),
      hotelGroup: optionalEnum(bag, "hotelGroup", SEARCHABLE_GROUPS) ?? SEARCHABLE_GROUPS[0]
    };
  },
  async run({ adults, checkIn, checkOut, city, hotelGroup }) {
    const task = await createHotelSearchTask({ adults, checkIn, checkOut, city, hotelGroup, mode: "city_results" });
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
