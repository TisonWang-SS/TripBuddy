import { browserJson } from "@/lib/browserApi";
import { createHotelSearchTask, supportedHotelSearchGroups } from "@/lib/browserTaskHandlers";
import { BrowserTaskError } from "@/lib/priceChecks";

export const dynamic = "force-dynamic";

export async function GET() {
  return browserJson({ hotelGroups: supportedHotelSearchGroups() });
}

export async function POST(request: Request) {
  try {
    return browserJson(await createHotelSearchTask(await request.json()), 201);
  } catch (error) {
    if (error instanceof BrowserTaskError) {
      return browserJson({ code: error.code, error: error.message }, error.status);
    }
    return browserJson({ error: error instanceof Error ? error.message : "Hotel search could not be started." }, 400);
  }
}
