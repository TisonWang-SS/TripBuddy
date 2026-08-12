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
      .toEqual(["adults", "checkIn", "checkOut", "city", "hotelGroup"]);
  });

  it("runs a read capability without any confirmation", async () => {
    const { result } = await invokeCapability("list_bookings", { scope: "all" });
    expect(result).toEqual({ bookings: [] });
    expect(mocks.findManyBookings).toHaveBeenCalled();
  });

  /*
   * Recognising an intent is not permission to act on it. This is the guard the
   * whole agent layer rests on, so it is asserted by its effect — the runner is
   * never reached — rather than only by the thrown type.
   */
  it("refuses to open a browser tab without explicit confirmation", async () => {
    mocks.runPriceCheck.mockClear();
    await expect(invokeCapability("run_price_check", { bookingId: "booking-1" })).rejects.toThrow(ConfirmationRequiredError);
    expect(mocks.runPriceCheck).not.toHaveBeenCalled();

    await expect(invokeCapability("import_account_bookings", {})).rejects.toThrow(ConfirmationRequiredError);
    expect(mocks.createAccountImportTask).not.toHaveBeenCalled();
  });

  it("treats any value other than true as unconfirmed", async () => {
    mocks.runPriceCheck.mockClear();
    for (const confirmed of [false, undefined]) {
      await expect(invokeCapability("run_price_check", { bookingId: "booking-1" }, { confirmed })).rejects.toThrow(
        ConfirmationRequiredError
      );
    }
    expect(mocks.runPriceCheck).not.toHaveBeenCalled();
  });

  it("runs a browser task once it is confirmed", async () => {
    mocks.runPriceCheck.mockClear().mockResolvedValue({ taskId: "task-1" });
    const { result } = await invokeCapability("run_price_check", { bookingId: "booking-1" }, { confirmed: true });
    expect(result).toEqual({ taskId: "task-1" });
    expect(mocks.runPriceCheck).toHaveBeenCalledWith({ bookingId: "booking-1", trigger: "manual" });
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
});
