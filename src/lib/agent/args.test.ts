import { describe, expect, it } from "vitest";
import {
  argsBag,
  CapabilityArgsError,
  optionalEnum,
  optionalInteger,
  optionalString,
  requireCalendarDate,
  requireString
} from "./args";

describe("capability arguments", () => {
  it("accepts a missing argument object as empty", () => {
    expect(argsBag(undefined, ["city"])).toEqual({});
    expect(argsBag(null, ["city"])).toEqual({});
  });

  /*
   * These arguments arrive from a model in P3. An unrecognised key usually means
   * it invented a parameter, and silently dropping it would answer a different
   * question than the one asked.
   */
  it("rejects arguments the capability did not declare", () => {
    expect(() => argsBag({ city: "Tokyo", nights: 3 }, ["city"])).toThrow(CapabilityArgsError);
    expect(() => argsBag({ city: "Tokyo", nights: 3 }, ["city"])).toThrow(/nights/);
  });

  it("rejects a non-object argument payload", () => {
    expect(() => argsBag("Tokyo", ["city"])).toThrow(CapabilityArgsError);
    expect(() => argsBag(["Tokyo"], ["city"])).toThrow(CapabilityArgsError);
  });

  it("treats blank strings as absent", () => {
    const bag = { city: "   ", hotelGroup: "" };
    expect(optionalString(bag, "city")).toBeUndefined();
    expect(optionalString(bag, "hotelGroup")).toBeUndefined();
    expect(() => requireString(bag, "city")).toThrow(/required/);
  });

  it("trims strings it does accept", () => {
    expect(requireString({ city: "  Kuala Lumpur " }, "city")).toBe("Kuala Lumpur");
  });

  it("accepts a quoted whole number but not a fractional one", () => {
    expect(optionalInteger({ adults: "2" }, "adults")).toBe(2);
    expect(optionalInteger({ adults: 2 }, "adults")).toBe(2);
    expect(() => optionalInteger({ adults: 2.5 }, "adults")).toThrow(CapabilityArgsError);
    expect(() => optionalInteger({ adults: "two" }, "adults")).toThrow(CapabilityArgsError);
  });

  /*
   * Check-in and check-out are calendar days compared against hotel policy
   * dates. Accepting a looser format here would put timezone drift into a
   * comparison the product treats as exact.
   */
  it("only accepts calendar dates in YYYY-MM-DD", () => {
    expect(requireCalendarDate({ checkIn: "2026-09-10" }, "checkIn")).toBe("2026-09-10");
    expect(() => requireCalendarDate({ checkIn: "Sep 10 2026" }, "checkIn")).toThrow(/YYYY-MM-DD/);
    expect(() => requireCalendarDate({ checkIn: "next tuesday" }, "checkIn")).toThrow(/YYYY-MM-DD/);
    expect(() => requireCalendarDate({ checkIn: "2026-09-10T12:00:00Z" }, "checkIn")).toThrow(/YYYY-MM-DD/);
  });

  it("rejects a well-formed date that is not real", () => {
    expect(() => requireCalendarDate({ checkIn: "2026-13-45" }, "checkIn")).toThrow(CapabilityArgsError);
  });

  it("constrains enums to the declared values", () => {
    expect(optionalEnum({ scope: "all" }, "scope", ["upcoming", "all"] as const)).toBe("all");
    expect(optionalEnum({}, "scope", ["upcoming", "all"] as const)).toBeUndefined();
    expect(() => optionalEnum({ scope: "everything" }, "scope", ["upcoming", "all"] as const)).toThrow(/one of/);
  });
});
