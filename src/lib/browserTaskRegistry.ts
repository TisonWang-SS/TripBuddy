import type { BrowserTaskKind } from "@prisma/client";
import { accountImportTaskDefinition } from "@/lib/accountImportTasks";
import { bookingPriceTaskDefinition } from "@/lib/bookingPriceTasks";
import { hotelSearchTaskDefinition } from "@/lib/hotelSearchTasks";

export const browserTaskDefinitions = {
  account_booking_import: accountImportTaskDefinition,
  booking_price_check: bookingPriceTaskDefinition,
  hotel_search: hotelSearchTaskDefinition
} as const;

export function getBrowserTaskDefinition(kind: BrowserTaskKind) {
  return browserTaskDefinitions[kind];
}
