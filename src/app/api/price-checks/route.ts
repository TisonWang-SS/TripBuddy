import { browserJson } from "@/lib/browserApi";
import { createBookingPriceTask } from "@/lib/browserTaskHandlers";
import { BrowserTaskError } from "@/lib/browserTasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { bookingId?: string; trigger?: "manual" | "scheduled" };
    const bookingId = String(payload.bookingId ?? "").trim();
    if (!bookingId) {
      return browserJson({ error: "bookingId is required." }, 400);
    }
    const task = await createBookingPriceTask({
      bookingId,
      trigger: payload.trigger === "scheduled" ? "scheduled" : "manual"
    });
    return browserJson(task, 201);
  } catch (error) {
    if (error instanceof BrowserTaskError) {
      return browserJson({ code: error.code, error: error.message }, error.status);
    }
    return browserJson({ error: error instanceof Error ? error.message : "Price check could not be started." }, 400);
  }
}
