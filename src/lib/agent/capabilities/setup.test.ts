import { describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/agent/capabilities/setup";

vi.mock("@/lib/db", () => ({
  prisma: {
    loyaltyValuation: {
      findMany: vi.fn().mockResolvedValue([
        {
          amount: 0.017,
          asOf: new Date("2026-02-01T00:00:00.000Z"),
          currency: "USD",
          hotelGroup: "Hyatt",
          kind: "point",
          lastReviewedAt: new Date("2020-02-01T00:00:00.000Z"),
          realizationRate: 1,
          sourceName: "Points guy valuations"
        }
      ])
    },
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({
        breakfastValue: 999,
        caresAboutBreakfast: true,
        caresAboutLateCheckout: false,
        caresAboutLounge: true,
        caresAboutUpgrade: false,
        defaultCurrency: "USD",
        eliteNightValue: 999,
        name: "Capability Tester",
        savingsThreshold: 75,
        urgentWindowHours: 12
      })
    }
  }
}));

describe("setup capabilities", () => {
  it("exposes structured entitlement preferences without legacy subjective prices", async () => {
    expect((await getProfile.run({})).profile).toEqual({
      caresAboutBreakfast: true,
      caresAboutLateCheckout: false,
      caresAboutLounge: true,
      caresAboutUpgrade: false,
      defaultCurrency: "USD",
      name: "Capability Tester",
      savingsThreshold: 75,
      urgentWindowHours: 12
    });
  });

  it("reports a valuation past its review date rather than hiding it", async () => {
    expect((await getProfile.run({})).valuations).toEqual([
      {
        amount: 0.017,
        asOf: "2026-02-01T00:00:00.000Z",
        currency: "USD",
        hotelGroup: "Hyatt",
        kind: "point",
        lastReviewedAt: "2020-02-01T00:00:00.000Z",
        realizationRate: 1,
        sourceName: "Points guy valuations",
        stale: true
      }
    ]);
  });
});
