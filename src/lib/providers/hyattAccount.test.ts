import { describe, expect, it } from "vitest";
import {
  isHyattReservationDetailUrl,
  parseHyattAccountBookingsFromSnapshots
} from "@/lib/providers/hyattAccount";

describe("account booking extraction", () => {
  it("recognizes both Hyatt reservation and My Stays detail URLs", () => {
    expect(isHyattReservationDetailUrl("https://www.hyatt.com/res/en-US/detail/example")).toBe(true);
    expect(isHyattReservationDetailUrl("https://www.hyatt.com/profile/en-US/my-stays/stay-details")).toBe(true);
    expect(isHyattReservationDetailUrl("https://www.hyatt.com/profile/en-US/my-stays")).toBe(false);
  });

  it("detects a Hyatt account sign-in page through the account parser", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text: "Introducing Passkeys First time signing in? Activate your online account Not a member? Join World of Hyatt Password",
        title: "Hyatt Sign In",
        url: "https://www.hyatt.com/profile/en-US/account-overview"
      }
    ]);

    expect(result.loginState).toBe("login_required");
  });

  it("returns login required when any account snapshot is a sign-in page", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text: "Sign in to your World of Hyatt account Password Passkeys Not a member?",
        title: "Hyatt Sign In",
        url: "https://www.hyatt.com/login"
      },
      {
        links: [],
        text:
          "Upcoming Stays Grand Hyatt Tokyo Tokyo, Japan Confirmation Number ABC12345 Check-in Thu, Sep 10, 2026 Check-out Sun, Sep 13, 2026 Room 1 King Bed 2 Adults Total USD 1,260",
        title: "My Reservations",
        url: "https://www.hyatt.com/profile/en-US/my-account/stays"
      }
    ]);

    expect(result.loginState).toBe("login_required");
    expect(result.bookings).toEqual([]);
  });

  it("treats a loaded empty Hyatt My Stays page as signed in with no visible bookings", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text: "TIANSHENG WANG MY ACCOUNT Account Overview Account Activity My Stays Upcoming Past Missing a reservation? Refresh Filter",
        title: "Hyatt - My Stays",
        url: "https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays"
      }
    ]);

    expect(result.loginState).toBe("logged_in");
    expect(result.bookings).toEqual([]);
    expect(result.summary).toBe("Hyatt account is signed in, but no upcoming bookings are visible in My Stays.");
  });

  it("reports incomplete reservation evidence as a capture failure", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text: "Confirmation Check-in Checkout Price Summary",
        title: "Hyatt | View Reservation",
        url: "https://www.hyatt.com/res/en-US/detail/loading"
      }
    ]);

    expect(result.bookings).toEqual([]);
    expect(result.summary).toBe("Hyatt account opened, but TripBuddy could not parse a booking from the captured page.");
  });

  it("parses Hyatt account reservations from visible page text", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text:
          "Upcoming Stays Grand Hyatt Tokyo Tokyo, Japan Confirmation Number ABC12345 Check-in Thu, Sep 10, 2026 Check-out Sun, Sep 13, 2026 Room 1 King Bed 2 Adults Total USD 1,260 Free cancellation before Sep 8, 2026",
        title: "My Reservations",
        url: "https://www.hyatt.com/profile/en-US/my-account/stays"
      }
    ]);

    expect(result.loginState).toBe("logged_in");
    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      bookingUrl: null,
      city: "Tokyo",
      confirmationNumber: "ABC12345",
      currency: "USD",
      guests: 2,
      hotelGroup: "Hyatt",
      hotelName: "Grand Hyatt Tokyo",
      cashTotal: 1260,
      roomType: "1 King Bed"
    });
    expect(result.bookings[0].checkIn.toISOString()).toBe("2026-09-10T00:00:00.000Z");
    expect(result.bookings[0].checkOut.toISOString()).toBe("2026-09-13T00:00:00.000Z");
  });

  it("parses real Hyatt My Stays cards with yearless date ranges", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text:
          "Upcoming Past Missing a reservation? Refresh Filter Mon, Jul 20 - Mon, Jul 27 Hyatt Place Kuala Lumpur Bukit Jalil Check-in: 03:00 PM Checkout: 12:00 PM Confirmation Number: 40023B23013271 M-1, Pusat Perdagangan Bandar Bukit Jalil, Persiaran Jalil 1 Kuala Lumpur, 57000 Malaysia Stay Details Mon, Jul 27 - Sat, Aug 1 Hyatt House Kuala Lumpur, Mont Kiara Check-in: 03:00 PM Checkout: 12:00 PM Confirmation Number: 40023B23448487 G-2 Arcoris, No. 10, Jalan Kiara, Mont Kiara Kuala Lumpur, 50480 Malaysia Stay Details Sat, Aug 1 - Sun, Aug 2 Grand Hyatt Kuala Lumpur Check-in: 03:00 PM Checkout: 12:00 PM Confirmation Number: 40023B23492944 12 Jalan Pinang Kuala Lumpur, 50450 Malaysia Stay Details",
        title: "Hyatt - My Stays",
        url: "https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays"
      }
    ]);

    expect(result.loginState).toBe("logged_in");
    expect(result.bookings.map((booking) => [booking.hotelName, booking.confirmationNumber, booking.city])).toEqual([
      ["Hyatt Place Kuala Lumpur Bukit Jalil", "40023B23013271", "Kuala Lumpur"],
      ["Hyatt House Kuala Lumpur, Mont Kiara", "40023B23448487", "Kuala Lumpur"],
      ["Grand Hyatt Kuala Lumpur", "40023B23492944", "Kuala Lumpur"]
    ]);
    expect(result.bookings.map((booking) => [booking.checkIn.toISOString(), booking.checkOut.toISOString()])).toEqual([
      ["2026-07-20T00:00:00.000Z", "2026-07-27T00:00:00.000Z"],
      ["2026-07-27T00:00:00.000Z", "2026-08-01T00:00:00.000Z"],
      ["2026-08-01T00:00:00.000Z", "2026-08-02T00:00:00.000Z"]
    ]);
  });

  it("merges cash totals from Hyatt stay details into imported bookings", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text:
          "Mon, Jul 27 - Sat, Aug 1 Hyatt House Kuala Lumpur, Mont Kiara Check-in: 03:00 PM Checkout: 12:00 PM Confirmation Number: 40023B23448487 G-2 Arcoris, No. 10, Jalan Kiara, Mont Kiara Kuala Lumpur, 50480 Malaysia Stay Details",
        title: "Hyatt - My Stays",
        url: "https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays"
      },
      {
        links: [],
        text:
          "Hyatt House Kuala Lumpur, Mont Kiara Mon, Jul 27 - Sat, Aug 1 Confirmation Number: 40023B23448487 Room 1 King Bed Den Grand Total MYR 1,860.50",
        title: "Stay Details",
        url: "https://www.hyatt.com/profile/en-US/my-stays/stay-details"
      }
    ]);

    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      bookingUrl: "https://www.hyatt.com/profile/en-US/my-stays/stay-details",
      currency: "MYR",
      cashTotal: 1860.5,
      pointsPrice: null,
      priceSource: "cash",
      roomType: "1 King Bed Den"
    });
  });

  it("parses real Hyatt reservation detail price summary text", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text:
          "Confirmation: # 40023B23013271 Hyatt Place Kuala Lumpur Bukit Jalil 1 King Bed Long Stay Rate Guests 1 Adult Check-in Mon, Jul 20, 2026, 03:00 PM Checkout Mon, Jul 27, 2026, 12:00 PM Price Summary Total Cost Per Room* $614.48 7 Night Stay $568.96 Taxes & Fees $45.52",
        title: "Hyatt | View Reservation",
        url: "https://www.hyatt.com/res/en-US/detail/example"
      }
    ]);

    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      bookingUrl: "https://www.hyatt.com/res/en-US/detail/example",
      confirmationNumber: "40023B23013271",
      currency: "USD",
      cashTotal: 614.48,
      priceSource: "cash"
    });
  });

  it("captures points totals from Hyatt stay details", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text:
          "Sat, Aug 1 - Sun, Aug 2 Grand Hyatt Kuala Lumpur Check-in: 03:00 PM Checkout: 12:00 PM Confirmation Number: 40023B23492944 12 Jalan Pinang Kuala Lumpur, 50450 Malaysia Stay Details",
        title: "Hyatt - My Stays",
        url: "https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays"
      },
      {
        links: [],
        text:
          "Grand Hyatt Kuala Lumpur Sat, Aug 1 - Sun, Aug 2 Confirmation Number: 40023B23492944 Room 1 King Bed Points Total 12,000 points",
        title: "Stay Details",
        url: "https://www.hyatt.com/profile/en-US/my-stays/stay-details"
      }
    ]);

    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      cashTotal: 0,
      pointsPrice: 12000,
      priceSource: "points"
    });
  });

  it("captures free night awards from Hyatt stay details", () => {
    const result = parseHyattAccountBookingsFromSnapshots([
      {
        links: [],
        text:
          "Confirmation: # 40023B23492944 Grand Hyatt Kuala Lumpur 1 King Bed Promotional Award Check-in Sat, Aug 1, 2026, 03:00 PM Checkout Sun, Aug 2, 2026, 12:00 PM Free Night Award Applied Price Summary Total Awards** 1 Free Night 1 Night Stay Sat, Aug 1 Free Night",
        title: "Hyatt | View Reservation",
        url: "https://www.hyatt.com/res/en-US/detail/example"
      }
    ]);

    expect(result.bookings).toHaveLength(1);
    expect(result.bookings[0]).toMatchObject({
      awardLabel: "1 Free Night",
      cashTotal: 0,
      pointsPrice: null,
      priceSource: "free_night"
    });
  });
});
