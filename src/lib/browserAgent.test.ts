import { describe, expect, it } from "vitest";
import { planBrowserAgentAction, type BrowserAgentSnapshot } from "@/lib/browserAgent";

describe("browser agent planner", () => {
  it("opens the matching Hyatt View Rates result from a city search snapshot", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur",
      targetHotelName: "Grand Hyatt Kuala Lumpur",
      pageText: "Grand Hyatt Kuala Lumpur Rates from: MYR 820 Avg/Night View Rates Hyatt Place Kuala Lumpur Bukit Jalil Rates from: MYR 345 Avg/Night View Rates",
      controls: [
        {
          context: "Hyatt Place Kuala Lumpur Bukit Jalil Award Category 1 Rates from: MYR 345 Avg/Night View Rates",
          elementId: "wrong",
          label: "View Rates"
        },
        {
          context: "Grand Hyatt Kuala Lumpur Award Category 3 Rates from: MYR 820 Avg/Night View Rates",
          elementId: "right",
          label: "View Rates"
        },
        {
          context: "Grand Hyatt Kuala Lumpur Hotel Website",
          elementId: "website",
          label: "Hotel Website"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({
      action: "click",
      elementId: "right"
    });
  });

  it("matches a View Rates link from the hotel slug when the card context is sparse", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        controls: [
          {
            context: "View Rates",
            elementId: "first-rates",
            href: "https://www.hyatt.com/shop/rooms/kulzp",
            label: "View Rates"
          },
          { context: "Hotel Website", elementId: "website", label: "Hotel Website" },
          {
            context: "View Rates",
            elementId: "second-rates",
            href: "https://www.hyatt.com/grand-hyatt/en-US/kuagh-grand-hyatt-kuala-lumpur/rooms",
            label: "View Rates"
          }
        ],
        pageText: "Grand Hyatt Kuala Lumpur Award Category 3 Rates from: MYR 820 Avg/Night View Rates Hyatt Place Kuala Lumpur Bukit Jalil Rates from: MYR 345 Avg/Night View Rates",
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur",
        targetHotelName: "Grand Hyatt Kuala Lumpur"
      })
    ).toMatchObject({
      action: "click",
      elementId: "second-rates"
    });
  });

  it("associates sparse View Rates controls with hotel names by page order", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        controls: [
          { context: "View Rates", elementId: "first-rates", label: "View Rates" },
          { context: "View Rates", elementId: "second-rates", label: "View Rates" }
        ],
        pageText:
          "Hyatt Place Kuala Lumpur Bukit Jalil Rates from MYR 345 Avg/Night View Rates Grand Hyatt Kuala Lumpur Rates from MYR 820 Avg/Night View Rates",
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur",
        targetHotelName: "Grand Hyatt Kuala Lumpur"
      })
    ).toMatchObject({
      action: "click",
      elementId: "second-rates"
    });
  });

  it("selects the lowest visible room rate control", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh?checkinDate=2026-08-01&checkoutDate=2026-08-02",
      targetHotelName: "Grand Hyatt Kuala Lumpur",
      pageText: "Grand Hyatt Kuala Lumpur 1 King Bed Member Rate MYR 820 Avg/Night Select & Book Grand Suite Member Rate MYR 1,800 Avg/Night Select & Book",
      controls: [
        {
          context: "Grand Suite Member Rate MYR 1,800 Avg/Night Select & Book",
          elementId: "suite",
          label: "Select & Book MYR 1,800"
        },
        {
          context: "1 King Bed Member Rate MYR 820 Avg/Night Select & Book",
          elementId: "king",
          label: "Select & Book MYR 820"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({
      action: "click",
      elementId: "king",
      rememberRoomList: true
    });
  });

  it("does not treat hotel review controls as cart actions on the room page", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh",
        pageText:
          "Grand Hyatt Kuala Lumpur 1 King Bed Members Save More $302 Avg/Night Select & Book Your Stay was excellent Next review",
        controls: [
          {
            context: "Guest review Your Stay was excellent",
            elementId: "review",
            label: "Next review"
          },
          {
            context: "1 King Bed Members Save More $302 Avg/Night Select & Book",
            elementId: "room",
            label: "Select & Book"
          }
        ]
      })
    ).toMatchObject({
      action: "click",
      elementId: "room",
      rememberRoomList: true
    });
  });

  it("continues only from an explicit Hyatt booking cart", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        sourceUrl: "https://www.hyatt.com/booking/cart",
        pageText: "My Cart Grand Hyatt Kuala Lumpur Room total $302 Continue",
        controls: [
          {
            context: "My Cart Grand Hyatt Kuala Lumpur Room total $302 Continue",
            elementId: "continue",
            label: "Continue"
          }
        ]
      })
    ).toMatchObject({
      action: "click",
      elementId: "continue"
    });
  });

  it("selects the lowest Hyatt rate plan", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh/rates",
      pageText: "Choose Your Rate Standard Rate MYR 900 Cancellation Policy Sign In & Book Member Rate MYR 820 Cancellation Policy Sign In & Book",
      controls: [
        {
          context: "Standard Rate MYR 900 Cancellation Policy Sign In & Book",
          elementId: "standard",
          label: "Sign In & Book MYR 900"
        },
        {
          context: "Member Rate MYR 820 Cancellation Policy Sign In & Book",
          elementId: "member",
          label: "Sign In & Book MYR 820"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({
      action: "click",
      elementId: "member"
    });
  });

  it("ignores room-card Select & Book controls when a Hyatt rate dialog is open", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh",
      pageText:
        "1 King Bed Members Save More $302 Avg/Night Select & Book Choose Your Rate Members Save More $302 Cancellation Policy Deposit Policy Join While You Book Sign In & Book",
      controls: [
        {
          context: "1 King Bed Members Save More $302 Avg/Night Select & Book",
          elementId: "room-card",
          label: "Select & Book"
        },
        {
          context:
            "Choose Your Rate Members Save More $302 Standard Rate $355 Cancellation Policy Deposit Policy Join While You Book Sign In & Book",
          elementId: "join",
          label: "Join While You Book"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({
      action: "click",
      elementId: "join"
    });
  });

  it("prefers the direct checkout path over sign-in when both expose the same lowest rate", () => {
    const sharedContext =
      "Choose Your Rate Members Save More $302 Standard Rate $355 Cancellation Policy Deposit Policy Join While You Book Sign In & Book";

    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh",
        pageText: sharedContext,
        controls: [
          { context: sharedContext, elementId: "sign-in", label: "Sign In & Book" },
          { context: sharedContext, elementId: "join", label: "Join While You Book" }
        ]
      })
    ).toMatchObject({
      action: "click",
      elementId: "join"
    });
  });

  it("imports when a final Hyatt total is visible", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        sourceUrl: "https://www.hyatt.com/booking/summary",
        pageText: "Price Summary Room total MYR820.00 Taxes & Fees MYR164.00 Total MYR984.00"
      })
    ).toMatchObject({
      action: "import"
    });
  });
});
