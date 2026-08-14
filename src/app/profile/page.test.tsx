import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProfilePage from "@/app/profile/page";

vi.mock("@/lib/actions", () => ({
  createCreditCardBenefit: vi.fn(),
  saveLoyaltyValuation: vi.fn(),
  updateProfile: vi.fn()
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    userProfile: {
      upsert: vi.fn().mockResolvedValue({
        caresAboutBreakfast: true,
        caresAboutLateCheckout: false,
        caresAboutLounge: true,
        caresAboutUpgrade: false,
        creditCardBenefits: [],
        defaultCurrency: "USD",
        loyaltyAccounts: [],
        loyaltyValuations: [
          {
            amount: 0.017,
            asOf: new Date("2026-02-01T00:00:00.000Z"),
            currency: "USD",
            hotelGroup: "Hyatt",
            id: "valuation-current",
            kind: "point",
            lastReviewedAt: new Date("2030-02-01T00:00:00.000Z"),
            realizationRate: 1,
            sourceName: "Points guy valuations"
          },
          {
            amount: 300,
            asOf: new Date("2026-02-01T00:00:00.000Z"),
            currency: "USD",
            hotelGroup: "Hyatt",
            id: "valuation-stale",
            kind: "free_night",
            lastReviewedAt: new Date("2020-02-01T00:00:00.000Z"),
            realizationRate: 0.8,
            sourceName: "Award trading desk"
          }
        ],
        name: "Preference Tester",
        savingsThreshold: 50,
        urgentWindowHours: 24
      })
    }
  }
}));

describe("profile page", () => {
  it("edits entitlement-warning preferences instead of subjective benefit prices", async () => {
    render(await ProfilePage());

    expect(screen.getByRole("checkbox", { name: "Breakfast" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Lounge access" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Late checkout" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Room upgrades" })).not.toBeChecked();
    expect(screen.queryByLabelText("Breakfast value per night")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Elite night value")).not.toBeInTheDocument();
    expect(screen.getByText(/Preferences suppress loss warnings; they never change cost or verdicts/)).toBeInTheDocument();
  });

  it("shows each sourced valuation with its provenance and whether it is past review", async () => {
    render(await ProfilePage());

    expect(screen.getByText("Points guy valuations")).toBeInTheDocument();
    expect(screen.getByText("Award trading desk")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Past review")).toBeInTheDocument();
    expect(screen.getByLabelText("Realization rate")).toBeInTheDocument();
  });
});
