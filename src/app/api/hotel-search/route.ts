import { browserJson, sameOriginRequestError } from "@/lib/browserApi";
import { createHotelSearchTask, supportedHotelSearchGroups } from "@/lib/browserTaskHandlers";
import { BrowserTaskError } from "@/lib/browserTasks";
import { getHotelSearchSession } from "@/lib/hotelSearchSessions";

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
  const accessError = sameOriginRequestError(request);
  if (accessError) {
    return accessError;
  }
  try {
    return browserJson(await createHotelSearchTask(await request.json()), 201);
  } catch (error) {
    if (error instanceof BrowserTaskError) {
      return browserJson({ code: error.code, error: error.message }, error.status);
    }
    return browserJson({ error: error instanceof Error ? error.message : "Hotel search could not be started." }, 400);
  }
}
