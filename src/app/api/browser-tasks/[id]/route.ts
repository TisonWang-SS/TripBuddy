import { browserJson, browserOptionsResponse } from "@/lib/browserApi";
import { captureBrowserTask } from "@/lib/browserTaskHandlers";
import {
  BrowserTaskError,
  getBrowserTask,
  serializeTaskState,
  type BrowserTaskCapture
} from "@/lib/browserTasks";

export const dynamic = "force-dynamic";

export async function OPTIONS() {
  return browserOptionsResponse();
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const task = await getBrowserTask(id);
  return task ? browserJson(serializeTaskState(task)) : browserJson({ error: "Browser task was not found or expired." }, 404);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const capture = (await request.json()) as BrowserTaskCapture;
    return browserJson(await captureBrowserTask(id, capture));
  } catch (error) {
    if (error instanceof BrowserTaskError) {
      return browserJson({ code: error.code, error: error.message }, error.status);
    }
    return browserJson({ error: error instanceof Error ? error.message : "Browser capture failed." }, 500);
  }
}
