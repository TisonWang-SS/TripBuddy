import { browserJson } from "@/lib/browserApi";
import { createHotelSearchTask, supportedHotelSearchGroups } from "@/lib/browserTaskHandlers";
import { getHotelSearchSession } from "@/lib/hotelSearchSessions";
import { BrowserTaskError } from "@/lib/priceChecks";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const searchSessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  if (searchSessionId) {
    const session = await getHotelSearchSession(searchSessionId);
    return session
      ? browserJson(session)
      : browserJson({ error: "Hotel search session was not found or expired." }, 404);
  }
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
