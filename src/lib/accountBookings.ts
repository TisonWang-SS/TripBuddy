import type { BookingBaselineType } from "@prisma/client";
import { isActiveBookingDate } from "@/lib/bookingDates";
import { inferIsSuite } from "@/lib/currency";
import { prisma } from "@/lib/db";
import type { AccountBookingExtraction } from "@/lib/providers/types";
import { convertMoneyToSystemCurrency, getSystemCurrency } from "@/lib/systemSettings";

export async function importAccountBookings(extraction: AccountBookingExtraction) {
  const systemCurrency = await getSystemCurrency();
  const active = extraction.bookings.filter((booking) => isActiveBookingDate(booking.checkIn));
  const prepared = await Promise.all(
    active.map(async (imported) => {
      const cash =
        imported.priceSource === "cash" && imported.cashTotal > 0
          ? await convertMoneyToSystemCurrency(imported.cashTotal, imported.currency)
          : null;
      const baselineType: BookingBaselineType =
        imported.priceSource === "points"
          ? "points"
          : imported.priceSource === "free_night"
            ? "certificate"
            : "cash";
      return {
        imported,
        data: {
          baselineAwardLabel: imported.awardLabel,
          baselineCashTotal: cash?.amount ?? null,
          baselinePoints: imported.pointsPrice,
          baselineType,
          bookingChannel: "direct" as const,
          bookingUrl: imported.bookingUrl,
          breakfastIncluded: false,
          cancellationDeadline: imported.cancellationDeadline,
          checkIn: imported.checkIn,
          checkOut: imported.checkOut,
          city: imported.city,
          currency: cash?.currency ?? systemCurrency,
          guests: imported.guests,
          hotelGroup: imported.hotelGroup,
          hotelName: imported.hotelName,
          isSuite: inferIsSuite(imported.roomType),
          loyaltyEligible: true,
          notes:
            imported.priceSource === "cash" && !cash
              ? `Visible ${imported.currency} cash total requires a configured conversion rate.`
              : "Imported from Hyatt account.",
          roomType: imported.roomType
        }
      };
    })
  );
  const { created, updated } = await prisma.$transaction(async (tx) => {
    let created = 0;
    let updated = 0;
    for (const { data, imported } of prepared) {
      const existing = imported.bookingUrl
        ? await tx.hotelBooking.findFirst({ where: { bookingUrl: imported.bookingUrl } })
        : await tx.hotelBooking.findFirst({
            where: { checkIn: imported.checkIn, checkOut: imported.checkOut, hotelName: imported.hotelName }
          });
      if (existing) {
        await tx.hotelBooking.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await tx.hotelBooking.create({
          data: { ...data, watchPlan: { create: { awardEnabled: true, cashEnabled: true, enabled: true } } }
        });
        created += 1;
      }
    }
    return { created, updated };
  });
  return {
    created,
    imported: active.length,
    loginUrl: extraction.loginUrl,
    skipped: extraction.bookings.length - active.length,
    sourceUrl: extraction.sourceUrl,
    status: extraction.loginState === "login_required" ? "login_required" : "succeeded",
    summary: extraction.summary,
    updated
  };
}
