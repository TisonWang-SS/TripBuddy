import { describe, expect, it, vi } from "vitest";
import { CapabilityArgsError } from "./args";
import {
  capabilityResultRoute,
  ConfirmationRequiredError,
  describeCapabilities,
  findCapability,
  invokeCapability,
  listCapabilities,
  requireCapability,
  UnknownCapabilityError
} from "./registry";

const mocks = vi.hoisted(() => ({
  createAccountImportTask: vi.fn(),
  createHotelSearchTask: vi.fn(),
  findManyBookings: vi.fn().mockResolvedValue([]),
  runPriceCheck: vi.fn()
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    currencyConversionRate: { findMany: vi.fn().mockResolvedValue([]) },
    hotelBooking: { findMany: mocks.findManyBookings, findUnique: vi.fn().mockResolvedValue(null) },
    priceCheckRun: { findMany: vi.fn().mockResolvedValue([]) },
    priceObservation: { findMany: vi.fn().mockResolvedValue([]) },
    recommendation: { findFirst: vi.fn().mockResolvedValue(null) },
    userProfile: { findUnique: vi.fn().mockResolvedValue(null) }
  }
}));

vi.mock("@/lib/priceChecks", () => ({
  BrowserCompanionPriceCheckRunner: class {
    run = mocks.runPriceCheck;
  }
}));

vi.mock("@/lib/accountImportTasks", () => ({ createAccountImportTask: mocks.createAccountImportTask }));

vi.mock("@/lib/hotelSearchTasks", () => ({
  createHotelSearchTask: mocks.createHotelSearchTask,
  supportedHotelSearchGroups: () => ["Hyatt"]
}));

describe("capability registry", () => {
  it("exposes uniquely named capabilities", () => {
    const names = listCapabilities().map((capability) => capability.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("list_bookings");
    expect(names).toContain("run_price_check");
  });

  it("looks capabilities up by name and reports unknown ones", () => {
    expect(findCapability("list_bookings")?.name).toBe("list_bookings");
    expect(findCapability("book_the_room")).toBeNull();
    expect(() => requireCapability("book_the_room")).toThrow(UnknownCapabilityError);
  });

  /*
   * The command bar closes when it runs a command, so a task fired from there
   * would leave its progress and error notices nowhere to render. Every
   * browser_task capability has to name the route that owns its result.
   */
  it("gives every browser task a route that owns its result", () => {
    for (const capability of listCapabilities()) {
      if (capability.effect === "browser_task") {
        const route = capability.resultRoute({ bookingId: "booking-1" });
        expect(route.startsWith("/")).toBe(true);
      }
    }
    expect(capabilityResultRoute(requireCapability("run_price_check"), { bookingId: "booking-1" })).toBe("/bookings/booking-1");
    expect(capabilityResultRoute(requireCapability("list_bookings"), {})).toBeNull();
  });

  it("describes capabilities without leaking handlers", () => {
    const described = describeCapabilities();
    expect(described).toHaveLength(listCapabilities().length);
    for (const entry of described) {
      expect(Object.keys(entry).sort()).toEqual(["effect", "keywords", "name", "params", "summary"]);
    }
    expect(described.find((entry) => entry.name === "search_hotels")?.params.map((param) => param.name).sort())
      .toEqual([
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
  });

  it("runs a read capability without any confirmation", async () => {
    const { result } = await invokeCapability("list_bookings", { scope: "all" });
    expect(result).toEqual({ bookings: [] });
    expect(mocks.findManyBookings).toHaveBeenCalled();
  });

  /*
   * Browser work runs on the strength of the request (ADR 0007): asking for a
   * price check is the initiation, and the tab is still visible and still the
   * user's own Chrome.
   */
  it("runs a browser task without confirmation", async () => {
    mocks.runPriceCheck.mockClear().mockResolvedValue({ taskId: "task-1" });
    const { result } = await invokeCapability("run_price_check", { bookingId: "booking-1" });
    expect(result).toEqual({ taskId: "task-1" });
    expect(mocks.runPriceCheck).toHaveBeenCalledWith({ bookingId: "booking-1", trigger: "manual" });
  });

  /*
   * A write still refuses. Recognising an intent is not permission to change
   * stored state, and this is the last gate — asserted by its effect, the
   * handler never being reached, rather than only by the thrown type.
   */
  it("refuses a write without explicit confirmation", async () => {
    await expect(invokeCapability("set_watch_plan", { bookingId: "b1" })).rejects.toThrow(ConfirmationRequiredError);
    for (const confirmed of [false, undefined]) {
      await expect(invokeCapability("set_watch_plan", { bookingId: "b1" }, { confirmed })).rejects.toThrow(
        ConfirmationRequiredError
      );
    }
  });

  /* A search now runs on request; only a write is gated. */
  it("starts a hotel search without a press", async () => {
    mocks.createHotelSearchTask.mockClear().mockResolvedValue({
      launchUrl: "https://www.hyatt.com/search",
      searchSessionId: "session-1",
      taskId: "task-1"
    });
    await invokeCapability("search_hotels", {
      checkIn: "2030-09-10",
      checkOut: "2030-09-11",
      city: "Tokyo",
      cityAsAsked: "东京"
    });
    expect(mocks.createHotelSearchTask).toHaveBeenCalled();
  });

  /* Bad arguments fail before the confirmation question is even reached. */
  it("validates arguments before anything runs", async () => {
    mocks.runPriceCheck.mockClear();
    await expect(invokeCapability("run_price_check", { hotelName: "Grand Hyatt" }, { confirmed: true })).rejects.toThrow(
      CapabilityArgsError
    );
    await expect(invokeCapability("list_bookings", { scope: "everything" })).rejects.toThrow(CapabilityArgsError);
    expect(mocks.runPriceCheck).not.toHaveBeenCalled();
  });

  it("requires real calendar dates before starting a search", async () => {
    mocks.createHotelSearchTask.mockClear();
    await expect(
      invokeCapability("search_hotels", { checkIn: "next friday", checkOut: "2026-09-12", city: "Tokyo" }, { confirmed: true })
    ).rejects.toThrow(CapabilityArgsError);
    expect(mocks.createHotelSearchTask).not.toHaveBeenCalled();
  });

  /*
   * The dates a model invents are well-formed, so they pass every syntactic
   * check and reach Hyatt as a real search of a stay that already happened.
   */
  it("refuses a search of dates that have already passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T09:00:00.000Z"));
    mocks.createHotelSearchTask.mockClear();
    try {
      await expect(
        invokeCapability(
          "search_hotels",
          { checkIn: "2023-09-01", checkOut: "2023-09-10", city: "东京" },
          { confirmed: true }
        )
      ).rejects.toThrow(/already passed/);
      await expect(
        invokeCapability(
          "search_hotels",
          { checkIn: "2026-09-10", checkOut: "2026-09-01", city: "Tokyo" },
          { confirmed: true }
        )
      ).rejects.toThrow(/must be after/);
      expect(mocks.createHotelSearchTask).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
