import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HotelSearchClient } from "@/app/hotel-search/HotelSearchClient";

const { waitForBrowserTask } = vi.hoisted(() => ({ waitForBrowserTask: vi.fn() }));
vi.mock("@/lib/browserTaskClient", () => ({ waitForBrowserTask }));

describe("HotelSearchClient", () => {
  beforeEach(() => {
    waitForBrowserTask.mockReset();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("uses one profile currency and lists only supplied providers", () => {
    render(<HotelSearchClient currency="CNY" hotelGroups={["Hyatt"]} />);
    expect(screen.getByLabelText("Hotel group")).toHaveValue("Hyatt");
    expect(screen.queryByText("Marriott")).not.toBeInTheDocument();
    expect(screen.getByText("Official city prices are captured and displayed in your profile currency: CNY.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Search official prices in CNY" })).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum tax-inclusive stay total (CNY)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Currency")).not.toBeInTheDocument();
  });

  it("carries the temporary session into the final-total request and shows both price standards", async () => {
    const browserTab = { close: vi.fn(), location: { href: "" } };
    vi.spyOn(window, "open").mockReturnValue(browserTab as unknown as Window);
    const cityResult = {
      capturedAt: "2026-08-03T08:00:00.000Z",
      results: [{
        availabilityLabel: "Available",
        avgNightlyRate: 500,
        currency: "USD",
        hotelName: "Grand Hyatt Tokyo",
        locationLabel: "Tokyo",
        priceBasis: "Avg/Night excluding taxes and fees",
        sourceUrl: "https://www.hyatt.com/search"
      }],
      searchSessionId: "session-1",
      searchUrl: "https://www.hyatt.com/search",
      status: "succeeded",
      summary: "One visible official rate.",
      warning: null
    };
    const finalResult = {
      capturedAt: "2026-08-03T08:02:00.000Z",
      currency: "USD",
      fees: 90,
      hotelName: "Grand Hyatt Tokyo",
      nights: 2,
      priceBasis: "Official total including taxes and fees",
      searchSessionId: "session-1",
      sourceUrl: "https://www.hyatt.com/booking/summary",
      subtotal: 1000,
      taxes: null,
      taxesAndFees: 90,
      total: 1090
    };
    const startingOffer = {
      breakfastIncluded: null,
      cancellationPolicy: null,
      capturedAt: cityResult.capturedAt,
      comparisonWarnings: [],
      currency: "USD",
      displayedAmount: 500,
      displayedPriceBasis: "tax_exclusive",
      displayedPriceUnit: "avg_nightly",
      eliteNightEligible: true,
      evidenceLevel: "starting_price",
      feesAmount: null,
      feesIncluded: "excluded",
      hotelGroup: "Hyatt",
      loyaltyEligible: true,
      nights: 2,
      offerKey: "hyatt-official:grand-hyatt-tokyo",
      providerName: "Hyatt",
      ratePlanName: null,
      roomType: null,
      sourceName: "Hyatt official",
      sourceType: "direct",
      sourceUrl: "https://www.hyatt.com/search",
      startingAvgNightlyRate: 500,
      staySubtotal: 1000,
      stayTotal: null,
      taxesAmount: null,
      taxesAndFeesAmount: null,
      taxesIncluded: "excluded"
    };
    const searchSession = (offers: object[]) => ({
      createdAt: cityResult.capturedAt,
      expiresAt: "2026-08-04T08:00:00.000Z",
      id: "session-1",
      profileId: "primary",
      query: {
        adults: 2,
        checkIn: "2026-08-17",
        checkOut: "2026-08-18",
        city: "Tokyo",
        cityAsAsked: "Tokyo",
        currency: "USD",
        hotelGroup: "Hyatt",
        maxStayTotal: null
      },
      results: {
        capturedAt: cityResult.capturedAt,
        hotels: [{
          availabilityLabel: "Available",
          hotelGroup: "Hyatt",
          hotelKey: "hyatt:tokyo:grand-hyatt-tokyo",
          hotelName: "Grand Hyatt Tokyo",
          locationLabel: "Tokyo",
          offers
        }],
        summary: "One visible official rate.",
        warning: null
      },
      updatedAt: cityResult.capturedAt
    });
    const finalOffer = {
      ...startingOffer,
      capturedAt: finalResult.capturedAt,
      displayedPriceBasis: "tax_inclusive",
      displayedPriceUnit: "stay_total",
      evidenceLevel: "final_total",
      feesAmount: 90,
      feesIncluded: "included",
      sourceUrl: finalResult.sourceUrl,
      staySubtotal: 1000,
      stayTotal: 1090,
      taxesAndFeesAmount: 90,
      taxesIncluded: "included"
    };
    waitForBrowserTask
      .mockResolvedValueOnce({ result: cityResult, status: "succeeded" })
      .mockResolvedValueOnce({ result: finalResult, status: "succeeded" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        expiresAt: "2026-08-03T08:03:00.000Z",
        launchUrl: "https://www.hyatt.com/search#city-task",
        searchSessionId: "session-1",
        taskId: "city-task"
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(searchSession([startingOffer]))))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        expiresAt: "2026-08-03T08:05:00.000Z",
        launchUrl: "https://www.hyatt.com/search#total-task",
        searchSessionId: "session-1",
        taskId: "total-task"
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(searchSession([finalOffer]))));
    vi.stubGlobal("fetch", fetchMock);

    render(<HotelSearchClient currency="USD" hotelGroups={["Hyatt"]} />);
    fireEvent.change(screen.getByLabelText("City or destination"), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search official prices in USD" }));

    expect(await screen.findByText("Grand Hyatt Tokyo")).toBeInTheDocument();
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({ city: "Tokyo", cityAsAsked: "Tokyo" });
    fireEvent.click(screen.getByRole("button", { name: "Get tax-inclusive total" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const finalRequest = JSON.parse(String(fetchMock.mock.calls[2][1]?.body));
    expect(finalRequest).toMatchObject({
      hotelName: "Grand Hyatt Tokyo",
      mode: "tax_inclusive_total",
      searchSessionId: "session-1"
    });
    expect(await screen.findByText("Total $1,090")).toBeInTheDocument();
    expect(screen.getByText("Before taxes & fees $1,000")).toBeInTheDocument();
    expect(screen.getByText("2-night stay · taxes & fees $90")).toBeInTheDocument();
    expect(fetchMock.mock.calls[1][0]).toBe("/api/hotel-search?sessionId=session-1");
    expect(fetchMock.mock.calls[3][0]).toBe("/api/hotel-search?sessionId=session-1");
  });
});
