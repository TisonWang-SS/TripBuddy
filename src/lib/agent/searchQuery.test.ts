import { describe, expect, it } from "vitest";
import { extractDates, extractSearchQuery } from "./searchQuery";

describe("deterministic hotel search extraction", () => {
  it("resolves a yearless date to the next valid occurrence", () => {
    expect(extractSearchQuery("帮我查一下9月1日东京的酒店价格", { referenceDate: new Date("2026-08-14T12:00:00Z") })).toMatchObject({
      city: "Tokyo",
      cityAsAsked: "东京",
      checkIn: "2026-09-01",
      checkOut: "2026-09-02"
    });
  });

  it("moves a month/day that has already passed into the next year", () => {
    expect(extractSearchQuery("3月1日纽约酒店价格", { referenceDate: new Date("2026-08-14T12:00:00Z") })).toMatchObject({
      checkIn: "2027-03-01",
      city: "New York",
      cityAsAsked: "纽约"
    });
  });

  it("combines a date from the first turn with a year and stay length from the answer", () => {
    expect(extractSearchQuery("帮我查一下9月1日东京的酒店价格\n2026年，住1晚")).toMatchObject({
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      city: "Tokyo",
      cityAsAsked: "东京",
      nights: 1
    });
  });

  it("reads complete Chinese and ISO date ranges in order", () => {
    expect(extractDates("2026年9月1日到9月3日")).toEqual(["2026-09-01", "2026-09-03"]);
    expect(extractDates("2026-09-01 to 2026-09-03")).toEqual(["2026-09-01", "2026-09-03"]);
  });

  it("normalizes common city aliases to provider-facing names", () => {
    expect(extractSearchQuery("查NYC酒店价格", { referenceDate: new Date("2026-08-14T12:00:00Z") })).toMatchObject({
      city: "New York",
      cityAsAsked: "NYC"
    });
  });

  it("recognizes points-rate intent without requiring the word hotel", () => {
    expect(extractSearchQuery("上海 9月1日 积分价", { referenceDate: new Date("2026-08-14T12:00:00Z") })).toMatchObject({
      checkIn: "2026-09-01",
      checkOut: "2026-09-02",
      city: "Shanghai",
      cityAsAsked: "上海",
      priceMode: "points"
    });
  });
});
