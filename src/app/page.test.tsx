import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardPage from "@/app/page";

vi.mock("@/lib/db", () => ({
  prisma: {
    userProfile: {
      findUnique: vi.fn().mockResolvedValue({
        id: "primary",
        defaultCurrency: "USD"
      })
    },
    hotelBooking: {
      findMany: vi.fn().mockResolvedValue([])
    },
    recommendation: {
      findMany: vi.fn().mockResolvedValue([])
    }
  }
}));

describe("dashboard page", () => {
  it("renders the empty booking state", async () => {
    render(await DashboardPage());
    expect(screen.getByText("No bookings yet")).toBeInTheDocument();
    expect(screen.getByText("Add a booking")).toBeInTheDocument();
  });
});
