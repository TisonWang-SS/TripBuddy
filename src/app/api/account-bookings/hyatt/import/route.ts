import { NextResponse } from "next/server";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { parseHyattAccountBookingsFromSnapshots } from "@/lib/accountBookings";
import {
  extractHyattAccountSnapshotsWithChromeProfile,
  resolveChromeProfileDirectory,
  standardChromeUserDataDir,
  type ChromeProfileConfig
} from "@/lib/browserConnector";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { isActiveBookingDate } from "@/lib/bookingDates";
import { inferIsSuite, supportedCurrencyValue } from "@/lib/currency";
import { prisma } from "@/lib/db";
import { getSystemCurrency, normalizeMoneyToSystemCurrency } from "@/lib/systemSettings";

export const dynamic = "force-dynamic";

export async function POST() {
  const profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });
  const chromeProfile = await resolveConfiguredChromeProfile({
    chromeDebugPort: profile?.chromeDebugPort ?? 0,
    chromeProfileDirectory: profile?.chromeProfileDirectory,
    chromeProfileName: profile?.chromeProfileName ?? "TripBuddy",
    chromeUserDataDir: profile?.chromeUserDataDir
  });

  if (!chromeProfile.ok) {
    return NextResponse.json({ error: chromeProfile.error }, { status: 400 });
  }

  let extraction;
  try {
    const snapshots = await extractHyattAccountSnapshotsWithChromeProfile(chromeProfile.config);
    extraction = parseHyattAccountBookingsFromSnapshots(snapshots);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Chrome profile failure.";
    return NextResponse.json(
      {
        error: `Hyatt bookings could not be imported from the configured Chrome profile: ${message} Sign in with that Chrome profile, then try again.`
      },
      { status: 502 }
    );
  }

  if (extraction.loginState === "login_required") {
    return NextResponse.json(
      {
        loginUrl: extraction.loginUrl,
        status: "login_required",
        summary: extraction.summary
      },
      { status: 401 }
    );
  }

  const systemCurrency = await getSystemCurrency();
  const importableBookings = extraction.bookings.filter((booking) => isActiveBookingDate(booking.checkIn));
  let created = 0;
  let updated = 0;
  let skipped = extraction.bookings.length - importableBookings.length;

  for (const importedBooking of importableBookings) {
    const existing = await prisma.hotelBooking.findFirst({
      where: {
        hotelGroup: importedBooking.hotelGroup,
        hotelName: importedBooking.hotelName,
        checkIn: importedBooking.checkIn,
        checkOut: importedBooking.checkOut,
        notes: importedBooking.confirmationNumber ? { contains: importedBooking.confirmationNumber } : undefined
      }
    });
    const money = await normalizeImportedBookingMoney(importedBooking.originalPrice, importedBooking.currency, systemCurrency);
    const notes = createImportedBookingNotes(importedBooking, money.warning);
    const data = {
      hotelGroup: importedBooking.hotelGroup,
      hotelName: importedBooking.hotelName,
      city: importedBooking.city,
      checkIn: importedBooking.checkIn,
      checkOut: importedBooking.checkOut,
      guests: importedBooking.guests,
      roomType: importedBooking.roomType,
      isSuite: inferIsSuite(importedBooking.roomType),
      originalPrice: money.amount,
      currency: money.currency,
      bookingChannel: "direct",
      cancellationDeadline: importedBooking.cancellationDeadline,
      breakfastIncluded: false,
      loyaltyEligible: true,
      bookingUrl: importedBooking.bookingUrl,
      notes
    };

    if (existing) {
      await prisma.hotelBooking.update({
        where: { id: existing.id },
        data
      });
      updated += 1;
    } else {
      await prisma.hotelBooking.create({
        data: {
          ...data,
          watchPlan: {
            create: {
              enabled: true,
              cashEnabled: true,
              awardEnabled: true,
              directEnabled: true,
              otaReferenceEnabled: false,
              browserMode: "chrome_profile"
            }
          }
        }
      });
      created += 1;
    }
  }

  revalidatePath("/");

  return NextResponse.json({
    created,
    imported: importableBookings.length,
    skipped,
    sourceUrl: extraction.sourceUrl,
    status: extraction.loginState === "logged_in" ? "succeeded" : "partial",
    summary: createImportSummary(extraction.summary, skipped),
    updated
  });
}

async function resolveConfiguredChromeProfile(profile: {
  chromeDebugPort: number;
  chromeProfileDirectory?: string | null;
  chromeProfileName: string;
  chromeUserDataDir?: string | null;
}): Promise<{ config: ChromeProfileConfig; ok: true } | { error: string; ok: false }> {
  const userDataDir = profile.chromeUserDataDir?.trim() || standardChromeUserDataDir();
  const profileDirectory =
    profile.chromeProfileDirectory?.trim() ||
    (await resolveChromeProfileDirectory(profile.chromeProfileName, path.join(userDataDir, "Local State")).catch(() => null));

  if (!profileDirectory) {
    return {
      error:
        "Hyatt booking import requires a real Chrome profile. Open Settings and set the Chrome data directory/profile for a normal browser profile before importing Hyatt bookings.",
      ok: false
    };
  }

  return {
    config: {
      debugPort: profile.chromeDebugPort || 9222,
      profileDirectory,
      profileName: profile.chromeProfileName,
      userDataDir
    },
    ok: true
  };
}

async function normalizeImportedBookingMoney(amount: number, currency: string, fallbackCurrency: "USD" | "CNY") {
  if (amount <= 0) {
    return {
      amount: 0,
      currency: fallbackCurrency,
      warning: "Imported account page did not expose a stay total."
    };
  }

  try {
    const money = await normalizeMoneyToSystemCurrency({ amount, sourceCurrency: currency });
    return { amount: money.price, currency: money.currency, warning: null };
  } catch {
    return {
      amount: 0,
      currency: supportedCurrencyValue(currency, fallbackCurrency),
      warning: `Imported total ${currency} ${amount} needs a conversion rate before it can be stored as the booking baseline.`
    };
  }
}

function createImportedBookingNotes(
  booking: {
    awardLabel: string | null;
    confirmationNumber: string | null;
    currency: string;
    originalPrice: number;
    pointsPrice: number | null;
    priceSource: string;
  },
  warning: string | null
) {
  return [
    "Imported from Hyatt account.",
    booking.confirmationNumber ? `Confirmation number: ${booking.confirmationNumber}.` : null,
    booking.awardLabel ? `Visible account award: ${booking.awardLabel}.` : null,
    booking.pointsPrice ? `Visible account points: ${booking.pointsPrice.toLocaleString("en-US")} points.` : null,
    booking.originalPrice > 0 ? `Visible account total: ${booking.currency} ${booking.originalPrice}.` : null,
    booking.priceSource === "unknown" ? "Visible account price was not captured." : null,
    warning
  ]
    .filter(Boolean)
    .join("\n");
}

function createImportSummary(summary: string, skipped: number) {
  return skipped > 0 ? `${summary} Skipped ${skipped} already-started booking${skipped === 1 ? "" : "s"}.` : summary;
}
