import { hyattProvider } from "@/lib/providers/hyatt";
import type { HotelProvider } from "@/lib/providers/types";

const providers: HotelProvider[] = [hyattProvider];

export function getHotelProvider(hotelGroup: string) {
  return providers.find((provider) => provider.hotelGroup.toLowerCase() === hotelGroup.trim().toLowerCase()) ?? null;
}

export function getBookingPriceProvider(hotelGroup: string) {
  return getHotelProvider(hotelGroup)?.bookingPrice ?? null;
}

export function getHotelSearchProvider(hotelGroup: string) {
  return getHotelProvider(hotelGroup)?.hotelSearch ?? null;
}

export function getAccountBookingImporter(hotelGroup: string) {
  return getHotelProvider(hotelGroup)?.accountImporter ?? null;
}

export function listSearchableHotelGroups() {
  return providers.filter((provider) => provider.hotelSearch).map((provider) => provider.hotelGroup);
}
