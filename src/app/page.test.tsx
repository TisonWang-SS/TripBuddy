import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import DashboardPage, { dynamic } from "@/app/page";

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
      findMany: vi.fn().mockResolvedValue([])
    },
    recommendation: {
      findMany: vi.fn().mockResolvedValue([])
    }
  }
}));

describe("dashboard page", () => {
  it("renders the empty booking state", async () => {
    expect(dynamic).toBe("force-dynamic");
    render(await DashboardPage());
    expect(screen.getByText("No bookings yet")).toBeInTheDocument();
    expect(screen.getByText("Add a booking")).toBeInTheDocument();
  });
});
