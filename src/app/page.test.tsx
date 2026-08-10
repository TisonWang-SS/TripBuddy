import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import DashboardPage, { dynamic } from "@/app/page";

const mocks = vi.hoisted(() => ({ findBookings: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() })
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: "primary",
        defaultCurrency: "USD"
      })
    },
    hotelBooking: {
      findMany: mocks.findBookings
    },
    recommendation: {
      findMany: vi.fn().mockResolvedValue([])
    }
  }
}));

describe("dashboard page", () => {
  beforeEach(() => {
    mocks.findBookings.mockResolvedValue([]);
  });

  it("renders the empty booking state", async () => {
    expect(dynamic).toBe("force-dynamic");
    render(await DashboardPage());
    expect(screen.getByText("No bookings yet")).toBeInTheDocument();
    expect(screen.getByText("Add a booking")).toBeInTheDocument();
  });

  it("surfaces due checks without starting them", async () => {
    mocks.findBookings.mockResolvedValue([
      {
        baselineCashTotal: 500,
        baselineType: "cash",
        cancellationDeadline: new Date("2030-09-08T00:00:00.000Z"),
        checkIn: new Date("2030-09-10T00:00:00.000Z"),
        checkOut: new Date("2030-09-12T00:00:00.000Z"),
        city: "Tokyo",
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        currency: "USD",
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Tokyo",
        id: "booking-1",
        observations: [],
        recommendations: [],
        watchPlan: {
          awardEnabled: true,
          cashEnabled: true,
          enabled: true,
          lastCheckedAt: null,
          normalCadenceHours: 24,
          urgentCadenceHours: 6,
          urgentWindowHours: 72
        }
      }
    ]);

    render(await DashboardPage());

    expect(screen.getByText("Price checks due")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run price check" })).toBeInTheDocument();
  });
});
