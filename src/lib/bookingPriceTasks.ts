import type { PriceCheckTrigger } from "@prisma/client";
import type { BrowserTaskDefinition } from "@/lib/browserTaskDefinition";
import { captureBookingPriceTask, BrowserCompanionPriceCheckRunner } from "@/lib/priceChecks";

export type BookingPriceTaskInput = { bookingId: string; trigger: PriceCheckTrigger };

export const bookingPriceTaskDefinition = {
  capture: captureBookingPriceTask,
  create(input: BookingPriceTaskInput) {
    return new BrowserCompanionPriceCheckRunner().run(input);
  },
  kind: "booking_price_check"
} satisfies BrowserTaskDefinition<
  BookingPriceTaskInput,
  Awaited<ReturnType<BrowserCompanionPriceCheckRunner["run"]>>
>;
