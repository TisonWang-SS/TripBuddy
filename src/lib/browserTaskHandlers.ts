import { accountImportTaskDefinition } from "@/lib/accountImportTasks";
import { bookingPriceTaskDefinition, type BookingPriceTaskInput } from "@/lib/bookingPriceTasks";
import { publishBrowserTaskChange } from "@/lib/browserTaskEvents";
import { BrowserTaskError, getBrowserTask, type BrowserTaskCapture } from "@/lib/browserTasks";
import { getBrowserTaskDefinition } from "@/lib/browserTaskRegistry";
import {
  hotelSearchTaskDefinition,
  supportedHotelSearchGroups,
  type HotelSearchTaskInput
} from "@/lib/hotelSearchTasks";

export { supportedHotelSearchGroups };

export function createBookingPriceTask(input: BookingPriceTaskInput) {
  return bookingPriceTaskDefinition.create(input);
}

export function createHotelSearchTask(input: HotelSearchTaskInput) {
  return hotelSearchTaskDefinition.create(input);
}

export function createAccountImportTask(hotelGroup = "Hyatt") {
  return accountImportTaskDefinition.create({ hotelGroup });
}

export async function captureBrowserTask(taskId: string, capture: BrowserTaskCapture) {
  const task = await getBrowserTask(taskId);
  if (!task) {
    throw new BrowserTaskError("task_not_found", "Browser task was not found or expired.", 404);
  }
  const result = await getBrowserTaskDefinition(task.kind).capture(taskId, capture);
  /*
   * Every extension-driven state change funnels through here, which is why the
   * notification is published from this one place rather than from each of the
   * writes underneath it.
   */
  publishBrowserTaskChange(taskId);
  return result;
}
