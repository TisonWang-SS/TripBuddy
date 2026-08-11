import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsPage from "@/app/settings/page";

vi.mock("@/lib/actions", () => ({ saveCurrencyConversionRate: vi.fn() }));
vi.mock("@/lib/db", () => ({
  prisma: {
    systemSetting: {
      findUnique: vi.fn().mockResolvedValue({
        conversionRates: [{
          asOf: new Date("2030-08-01T00:00:00.000Z"),
          id: "rate-1",
          rate: 0.0067,
          sourceCurrency: "JPY",
          sourceName: "Manual",
          targetCurrency: "USD"
        }],
        displayCurrency: "USD"
      })
    },
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({ defaultCurrency: "USD", savingsThreshold: 50 })
    }
  }
}));

describe("settings page", () => {
  it("shows configured conversion rates and a validated entry form", async () => {
    render(await SettingsPage());

    expect(screen.getByRole("heading", { name: "Observed currencies to USD" })).toBeInTheDocument();
    expect(screen.getByText("JPY")).toBeInTheDocument();
    expect(screen.getByLabelText("Observed currency")).toHaveAttribute("pattern", "[A-Za-z]{3}");
    expect(screen.getByRole("button", { name: "Save conversion rate" })).toBeInTheDocument();
  });
});
