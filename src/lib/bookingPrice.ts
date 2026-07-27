import { formatMoney } from "@/lib/format";

export function formatBookingBaseline(booking: { currency: string; notes?: string | null; originalPrice: number }) {
  const awardLabel = extractVisibleAccountAward(booking.notes);
  if (booking.originalPrice <= 0 && awardLabel) {
    return awardLabel;
  }

  const pointsPrice = extractVisibleAccountPoints(booking.notes);
  if (booking.originalPrice <= 0 && pointsPrice) {
    return `${pointsPrice.toLocaleString("en-US")} points`;
  }

  return formatMoney(booking.originalPrice, booking.currency);
}

export function extractVisibleAccountAward(notes?: string | null) {
  const match = notes?.match(/Visible account award:\s*([^.]+)\./i);
  return match?.[1]?.trim() || null;
}

export function extractVisibleAccountPoints(notes?: string | null) {
  const match = notes?.match(/Visible account points:\s*([0-9,]+)\s*points/i);
  if (!match) {
    return null;
  }

  const points = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(points) && points > 0 ? points : null;
}
