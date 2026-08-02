import { formatMoney } from "@/lib/format";

export function formatBookingBaseline(booking: {
  baselineAwardLabel: string | null;
  baselineCashTotal: number | null;
  baselinePoints: number | null;
  baselineType: "cash" | "points" | "certificate";
  currency: string;
}) {
  if (booking.baselineType === "certificate") {
    return booking.baselineAwardLabel || "Award certificate";
  }
  if (booking.baselineType === "points") {
    return booking.baselinePoints ? `${booking.baselinePoints.toLocaleString("en-US")} points` : "Points booking";
  }
  return booking.baselineCashTotal === null ? "Cash total not captured" : formatMoney(booking.baselineCashTotal, booking.currency);
}
