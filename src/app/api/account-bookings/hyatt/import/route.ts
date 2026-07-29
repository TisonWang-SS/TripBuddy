import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import {
  parseHyattAccountBookingsFromSnapshots,
  type AccountPageSnapshot
} from "@/lib/accountBookings";
import {
  completeBrowserTask,
  createBrowserTask,
  failBrowserTask,
  getBrowserTask
} from "@/lib/browserTasks";
import { isActiveBookingDate } from "@/lib/bookingDates";
import { inferIsSuite, supportedCurrencyValue } from "@/lib/currency";
import { prisma } from "@/lib/db";
import { getSystemCurrency, normalizeMoneyToSystemCurrency } from "@/lib/systemSettings";

export const dynamic = "force-dynamic";

const taskKind = "hyatt_account_import";
const corsHeaders = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

type AccountImportCapture = {
  error?: string | null;
  requestId?: string | null;
  snapshots?: AccountPageSnapshot[] | null;
};

export async function OPTIONS() {
  return new NextResponse(null, { headers: corsHeaders });
}

export async function GET(request: Request) {
  const requestId = new URL(request.url).searchParams.get("requestId")?.trim();
  if (!requestId) {
    return json({ error: "requestId is required." }, 400);
  }
  const task = getBrowserTask(requestId, taskKind);
  return task
    ? json({ error: task.error, requestId, result: task.result, status: task.status })
    : json({ error: "Hyatt account-import task was not found or expired." }, 404);
}

export async function POST(request: Request) {
  let capture: AccountImportCapture = {};
  try {
    capture = (await request.json()) as AccountImportCapture;
  } catch {
    // An empty body starts a new browser task for compatibility with the existing UI.
  }

  if (!capture.requestId) {
    const task = createBrowserTask(taskKind);
    return json({
      launchUrl: createAccountImportUrl(task.id),
      requestId: task.id,
      status: task.status
    });
  }

  const requestId = String(capture.requestId).trim();
  if (!getBrowserTask(requestId, taskKind)) {
    return json({ error: "Hyatt account-import task was not found or expired." }, 404);
  }
  if (capture.error) {
    failBrowserTask(requestId, taskKind, capture.error);
    return json({ error: capture.error, requestId, status: "failed" }, 422);
  }
  if (!capture.snapshots?.length) {
    return json({ error: "At least one Hyatt account snapshot is required." }, 400);
  }

  try {
    const result = await importHyattAccountSnapshots(capture.snapshots);
    completeBrowserTask(requestId, taskKind, result);
    return json({ requestId, result, status: "succeeded" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Hyatt account import failed.";
    failBrowserTask(requestId, taskKind, message);
    return json({ error: message, requestId, status: "failed" }, 500);
  }
}

async function importHyattAccountSnapshots(snapshots: AccountPageSnapshot[]) {
  const extraction = parseHyattAccountBookingsFromSnapshots(snapshots);
  if (extraction.loginState === "login_required") {
    return {
      loginUrl: extraction.loginUrl,
      status: "login_required" as const,
      summary: extraction.summary
    };
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
              browserMode: "browser_assisted"
            }
          }
        }
      });
      created += 1;
    }
  }

  revalidatePath("/");

  return {
    created,
    imported: importableBookings.length,
    skipped,
    sourceUrl: extraction.sourceUrl,
    status: extraction.loginState === "logged_in" ? "succeeded" : "partial",
    summary: createImportSummary(extraction.summary, skipped),
    updated
  };
}

function createAccountImportUrl(requestId: string) {
  const hash = new URLSearchParams({
    tripbuddyAccountImportId: requestId,
    tripbuddyEndpoint: "http://localhost:3000"
  });
  return `https://www.hyatt.com/profile/en-US/my-stays#upcoming-stays&${hash.toString()}`;
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

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { headers: corsHeaders, status });
}
