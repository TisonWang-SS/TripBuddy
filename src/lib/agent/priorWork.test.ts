import { beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The summary that tells the model a search already exists. Its whole reason to
 * exist is that tool results do not survive a turn, so "my budget is about 1000
 * a night" asked right after a search had no session id to apply itself to.
 */

const mocks = vi.hoisted(() => ({ getHotelSearchSession: vi.fn() }));

vi.mock("@/lib/hotelSearchSessions", () => ({ getHotelSearchSession: mocks.getHotelSearchSession }));

const { loadPriorSearches, SEARCH_FRESHNESS_MINUTES } = await import("@/lib/agent/priorWork");

const NOW = Date.parse("2026-08-14T12:00:00.000Z");

function sessionCapturedMinutesAgo(minutes: number | null, overrides: Record<string, unknown> = {}) {
  return {
    createdAt: "2026-08-14T11:00:00.000Z",
    expiresAt: "2026-08-15T11:00:00.000Z",
    id: "sess-1",
    profileId: "primary",
    query: {
      adults: 2,
      budget: null,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      city: "Shanghai",
      cityAsAsked: "上海",
      currency: "USD",
      hotelGroup: "Hyatt",
      priceMode: "points" as const
    },
    results: {
      capturedAt: minutes === null ? null : new Date(NOW - minutes * 60_000).toISOString(),
      hotels: [{ hotelKey: "k1" }, { hotelKey: "k2" }],
      summary: null,
      warning: null
    },
    updatedAt: "2026-08-14T11:00:00.000Z",
    ...overrides
  };
}

describe("prior searches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("is empty when the conversation has produced nothing", async () => {
    expect(await loadPriorSearches(undefined, () => NOW)).toEqual([]);
    expect(await loadPriorSearches([], () => NOW)).toEqual([]);
    expect(mocks.getHotelSearchSession).not.toHaveBeenCalled();
  });

  it("summarises what was asked, without the results themselves", async () => {
    mocks.getHotelSearchSession.mockResolvedValue(sessionCapturedMinutesAgo(3));

    const [search] = await loadPriorSearches(["sess-1"], () => NOW);

    expect(search).toEqual({
      ageMinutes: 3,
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      city: "上海",
      currency: "USD",
      fresh: true,
      hasBudget: false,
      hotelCount: 2,
      priceMode: "points",
      sessionId: "sess-1"
    });
  });

  it(`stops reading as fresh past ${SEARCH_FRESHNESS_MINUTES} minutes`, async () => {
    mocks.getHotelSearchSession.mockResolvedValue(sessionCapturedMinutesAgo(SEARCH_FRESHNESS_MINUTES + 1));

    const [search] = await loadPriorSearches(["sess-1"], () => NOW);

    expect(search).toMatchObject({ ageMinutes: SEARCH_FRESHNESS_MINUTES + 1, fresh: false });
  });

  /* A session created but never captured has no prices to reuse. */
  it("treats an uncaptured session as not fresh", async () => {
    mocks.getHotelSearchSession.mockResolvedValue(sessionCapturedMinutesAgo(null));

    expect(await loadPriorSearches(["sess-1"], () => NOW)).toMatchObject([{ ageMinutes: null, fresh: false }]);
  });

  /*
   * Read back rather than described from a client-held copy: an id whose session
   * has expired should drop out instead of being reported as available.
   */
  it("drops an id whose session has expired", async () => {
    mocks.getHotelSearchSession.mockResolvedValue(null);

    expect(await loadPriorSearches(["sess-gone"], () => NOW)).toEqual([]);
  });

  it("puts the most recently captured search first", async () => {
    mocks.getHotelSearchSession.mockImplementation(async (id: string) =>
      id === "old" ? { ...sessionCapturedMinutesAgo(40), id: "old" } : { ...sessionCapturedMinutesAgo(2), id: "new" }
    );

    const searches = await loadPriorSearches(["old", "new"], () => NOW);

    expect(searches.map((search) => search.sessionId)).toEqual(["new", "old"]);
  });

  /* A long conversation must not grow the prompt without bound. */
  it("keeps only the most recent handful of ids", async () => {
    mocks.getHotelSearchSession.mockResolvedValue(sessionCapturedMinutesAgo(1));

    await loadPriorSearches(["a", "b", "c", "d", "e", "f", "g"], () => NOW);

    expect(mocks.getHotelSearchSession).toHaveBeenCalledTimes(5);
    expect(mocks.getHotelSearchSession).not.toHaveBeenCalledWith("a");
  });
});
