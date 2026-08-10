import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import BookingDetailPage from "@/app/bookings/[id]/page";
import { WEAKER_CANCELLATION_WARNING } from "@/lib/evidenceWarnings";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() })
}));

vi.mock("@/lib/actions", () => ({ promoteObservationToBooking: vi.fn() }));

vi.mock("@/lib/db", () => ({
  prisma: {
    hotelBooking: {
      findUnique: vi.fn().mockResolvedValue({
        baselineAwardLabel: null,
        baselineCashTotal: 1200,
        baselinePoints: null,
        baselineType: "cash",
        bookingChannel: "direct",
        checkIn: new Date("2030-09-10T00:00:00.000Z"),
        checkOut: new Date("2030-09-13T00:00:00.000Z"),
        city: "Tokyo",
        currency: "USD",
        guests: 2,
        hotelGroup: "Hyatt",
        hotelName: "Grand Hyatt Tokyo",
        id: "booking-1",
        isSuite: false,
        observations: [
          {
            cashCopay: null,
            cashCopayCurrency: null,
            cashCurrency: "MYR",
            cashTotal: 3900,
            collectionMethod: "browser_companion",
            evidence: {
              cancellationMatch: "unknown",
              qualityLevel: "needs_review",
              roomMatch: "exact"
            },
            id: "observation-1",
            inventoryType: "cash",
            observedAt: new Date("2030-08-01T00:00:00.000Z"),
            points: null,
            ratePlanName: "Member Rate",
            roomTypeRaw: "1 King Bed",
            sourceName: "Hyatt official site",
            sourceType: "direct"
          }
        ],
        priceCheckRuns: [
          {
            errorMessage: null,
            startedAt: new Date("2030-08-01T00:00:00.000Z"),
            status: "succeeded",
            summary: "Final Hyatt price evidence was imported."
          }
        ],
        recommendations: [
          {
            blockersJson: JSON.stringify(["Cancellation-policy equivalence is unknown."]),
            candidateObservation: {
              cashCopay: null,
              cashCopayCurrency: null,
              cashCurrency: "MYR",
              cashTotal: 3900,
              evidence: { qualityLevel: "needs_review" },
              id: "observation-1",
              inventoryType: "cash",
              points: null
            },
            currency: "USD",
            decisionProvider: "deterministic",
            decisionVersion: "2",
            estimatedSavings: 0,
            explanation: "Cancellation-policy equivalence is unknown.",
            qualityLevel: "needs_review",
            riskLevel: "high",
            verdict: "needs_review",
            warningsJson: JSON.stringify([
              "The candidate has a weaker cancellation policy.",
              "Review the captured cancellation policy."
            ])
          }
        ],
        watchPlan: { awardEnabled: true, cashEnabled: true, enabled: true }
      })
    }
  }
}));

describe("booking detail page", () => {
  it("shows task status, evidence quality, blockers, warnings, and observed currency", async () => {
    render(await BookingDetailPage({ params: Promise.resolve({ id: "booking-1" }) }));

    expect(screen.getByRole("button", { name: "Run price check" })).toBeInTheDocument();
    expect(screen.getByText("Final Hyatt price evidence was imported.")).toBeInTheDocument();
    expect(screen.getAllByText("needs_review").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cancellation-policy equivalence is unknown.").length).toBeGreaterThan(0);
    expect(screen.getByText((_, element) => element?.textContent === `Caution: ${WEAKER_CANCELLATION_WARNING}`))
      .toHaveClass("notice", "caution");
    expect(screen.getByText("Review the captured cancellation policy.")).toBeInTheDocument();
    expect(screen.getByText("Observed in MYR")).toBeInTheDocument();
  });
});
