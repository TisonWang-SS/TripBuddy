import { describe, expect, it, vi } from "vitest";
import { getProfile } from "@/lib/agent/capabilities/setup";

vi.mock("@/lib/db", () => ({
  prisma: {
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
    expect(await getProfile.run({})).toEqual({
      profile: {
        caresAboutBreakfast: true,
        caresAboutLateCheckout: false,
        caresAboutLounge: true,
        caresAboutUpgrade: false,
        defaultCurrency: "USD",
        name: "Capability Tester",
        savingsThreshold: 75,
        urgentWindowHours: 12
      }
    });
  });
});
