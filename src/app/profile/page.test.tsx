import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProfilePage from "@/app/profile/page";

vi.mock("@/lib/actions", () => ({ createCreditCardBenefit: vi.fn(), updateProfile: vi.fn() }));
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
});
