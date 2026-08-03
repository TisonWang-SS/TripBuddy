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
    waitForBrowserTask
      .mockResolvedValueOnce({ result: cityResult, status: "succeeded" })
      .mockResolvedValueOnce({ result: finalResult, status: "succeeded" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        launchUrl: "https://www.hyatt.com/search#city-task",
        searchSessionId: "session-1",
        taskId: "city-task"
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        launchUrl: "https://www.hyatt.com/search#total-task",
        searchSessionId: "session-1",
        taskId: "total-task"
      }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<HotelSearchClient currency="USD" hotelGroups={["Hyatt"]} />);
    fireEvent.change(screen.getByLabelText("City or destination"), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search official prices in USD" }));

    expect(await screen.findByText("Grand Hyatt Tokyo")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Get tax-inclusive total" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const finalRequest = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(finalRequest).toMatchObject({
      hotelName: "Grand Hyatt Tokyo",
      mode: "tax_inclusive_total",
      searchSessionId: "session-1"
    });
    expect(await screen.findByText("Total $1,090")).toBeInTheDocument();
    expect(screen.getByText("Before taxes & fees $1,000")).toBeInTheDocument();
    expect(screen.getByText("2-night stay · taxes & fees $90")).toBeInTheDocument();
  });
});
