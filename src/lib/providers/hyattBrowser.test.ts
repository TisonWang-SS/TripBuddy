import { describe, expect, it } from "vitest";
import { planBrowserAgentAction, type BrowserAgentSnapshot } from "@/lib/providers/hyattBrowser";

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

  /*
   * Signed out, Hyatt words this control differently. Matching the label alone
   * missed it, which did not read as a mismatch: with no recognised control the
   * planner concluded the page was still loading and waited until the task
   * timed out on the search results page. The href is what does not move.
   */
  it("opens a search result whose label changes with sign-in state", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Tokyo",
      targetHotelName: "Park Hyatt Tokyo",
      pageText: "Park Hyatt Tokyo Rates from: JPY 90,000 Avg/Night Select Room Hyatt Centric Ginza Tokyo Rates from: JPY 40,000 Avg/Night Select Room",
      controls: [
        {
          context: "Hyatt Centric Ginza Tokyo Rates from: JPY 40,000 Avg/Night",
          elementId: "wrong",
          href: "https://www.hyatt.com/shop/rooms/tyogz",
          label: "Select Room"
        },
        {
          context: "Park Hyatt Tokyo Rates from: JPY 90,000 Avg/Night",
          elementId: "right",
          href: "https://www.hyatt.com/hotel/japan/park-hyatt-tokyo/tyoph",
          label: "Select Room"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({ action: "click", elementId: "right" });
  });

  /*
   * The destination cannot be used to walk past the safety rules. "Book Now" is
   * deliberately not on that list — on a search card it only opens the rates
   * page — so this asserts with a label the rules do treat as final.
   */
  it("still refuses an unsafe control even when it points at a hotel page", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Tokyo",
      targetHotelName: "Park Hyatt Tokyo",
      pageText: "Park Hyatt Tokyo Rates from: JPY 90,000 Avg/Night Complete Booking",
      controls: [
        {
          context: "Park Hyatt Tokyo Rates from: JPY 90,000 Avg/Night",
          elementId: "unsafe",
          href: "https://www.hyatt.com/shop/rooms/tyoph",
          label: "Complete Booking"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({ action: "wait" });
  });

  it("waits when the target hotel card is visible before its View Rates control hydrates", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        controls: [],
        pageText: "Hyatt House Kuala Lumpur, Mont Kiara Rates from: $91 Avg/Night",
        pageTitle: "Hyatt | Search Results",
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur",
        targetHotelName: "Hyatt House Kuala Lumpur, Mont Kiara"
      })
    ).toMatchObject({ action: "wait" });
  });

  it("stops when hydrated search controls do not contain the requested hotel", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        controls: [
          {
            context: "Grand Hyatt Kuala Lumpur Rates from: MYR 820 Avg/Night View Rates",
            elementId: "grand-hyatt",
            label: "View Rates"
          }
        ],
        pageText: "Grand Hyatt Kuala Lumpur Rates from: MYR 820 Avg/Night View Rates",
        sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Kuala%20Lumpur",
        targetHotelName: "Hyatt House Kuala Lumpur, Mont Kiara"
      })
    ).toMatchObject({ action: "stop" });
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

  /*
   * Built from a real capture: task 56e9bab8 sat on /shop/rooms/nrtzt for
   * twelve snapshots and timed out. The page was finished — thirteen Avg/Night
   * rates were visible — but signed out every room card said "Book Now", which
   * the room matcher excluded, so nothing was selectable and the planner kept
   * reporting that it was waiting for rates to load.
   */
  it("selects a signed-out room card labelled Book Now", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/shop/rooms/nrtzt?adults=2&checkinDate=2026-08-27&checkoutDate=2026-08-28",
      pageText:
        "Sign In Hyatt Regency Tokyo Bay View Room Details Members Save More $114 Avg/Night Book Now " +
        "View Room Details Members Save More $99 Avg/Night Book Now",
      controls: [
        {
          context: "View Room Details Members Save More $114 Avg/Night Book Now",
          elementId: "pricier",
          label: "Book Now"
        },
        {
          context: "View Room Details Members Save More $99 Avg/Night Book Now",
          elementId: "cheapest",
          label: "Book Now"
        }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).toMatchObject({ action: "click", elementId: "cheapest" });
  });

  /* The account flow is not a room selection, whatever the page shows next. */
  it("never treats a sign-in or join control as a room selection", () => {
    const snapshot: BrowserAgentSnapshot = {
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/shop/rooms/nrtzt",
      pageText: "View Room Details Members Save More $99 Avg/Night Sign In & Book Join While You Book",
      controls: [
        { context: "Members Save More $99 Avg/Night", elementId: "signin", label: "Sign In & Book" },
        { context: "Members Save More $99 Avg/Night", elementId: "join", label: "Join While You Book" }
      ]
    };

    expect(planBrowserAgentAction(snapshot)).not.toMatchObject({ action: "click" });
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

  it("refuses to click a cart control containing an unsafe final-action token", () => {
    const action = planBrowserAgentAction({
      bookingId: "booking-1",
      sourceUrl: "https://www.hyatt.com/booking/cart",
      pageText: "My Cart Grand Hyatt Kuala Lumpur Room total $302 Continue to payment",
      controls: [
        {
          context: "My Cart Grand Hyatt Kuala Lumpur Room total $302 Continue to payment",
          elementId: "payment",
          label: "Continue to payment"
        }
      ]
    });

    expect(action).toMatchObject({ action: "wait" });
    expect(action).not.toMatchObject({ action: "click", elementId: "payment" });
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

  it("continues from a visible Hyatt rate dialog without treating Book Now as a final purchase", () => {
    expect(
      planBrowserAgentAction({
        bookingId: "booking-1",
        controls: [
          {
            context: "Book Now",
            elementId: "dialog-book-now",
            label: "Book Now"
          }
        ],
        pageText:
          "Choose Your Rate Members Save More $167 Avg/Night Cancellation Policy 3 days before arrival Deposit Policy 1 night deposit Book Now",
        sourceUrl: "https://www.hyatt.com/shop/rooms/kuagh"
      })
    ).toMatchObject({ action: "click", elementId: "dialog-book-now" });
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
