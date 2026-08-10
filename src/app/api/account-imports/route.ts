import { browserJson } from "@/lib/browserApi";
import { createAccountImportTask } from "@/lib/browserTaskHandlers";
import { BrowserTaskError } from "@/lib/browserTasks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as { hotelGroup?: string };
    return browserJson(await createAccountImportTask(String(payload.hotelGroup ?? "Hyatt")), 201);
  } catch (error) {
    if (error instanceof BrowserTaskError) {
      return browserJson({ code: error.code, error: error.message }, error.status);
    }
    return browserJson({ error: error instanceof Error ? error.message : "Account import could not be started." }, 400);
  }
}
