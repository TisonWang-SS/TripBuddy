import {
  browserOptionsResponse,
  browserTaskAccessError,
  browserTaskJson
} from "@/lib/browserApi";
import { captureBrowserTask } from "@/lib/browserTaskHandlers";
import {
  BrowserTaskError,
  getBrowserTask,
  serializeTaskState,
  type BrowserTaskCapture
} from "@/lib/browserTasks";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return browserOptionsResponse(request);
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessError = browserTaskAccessError(request);
  if (accessError) {
    return accessError;
  }
  const { id } = await params;
  const task = await getBrowserTask(id);
  return task
    ? browserTaskJson(request, serializeTaskState(task))
    : browserTaskJson(request, { error: "Browser task was not found or expired." }, 404);
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessError = browserTaskAccessError(request);
  if (accessError) {
    return accessError;
  }
  const { id } = await params;
  try {
    const capture = (await request.json()) as BrowserTaskCapture;
    return browserTaskJson(request, await captureBrowserTask(id, capture));
  } catch (error) {
    if (error instanceof BrowserTaskError) {
      return browserTaskJson(request, { code: error.code, error: error.message }, error.status);
    }
    return browserTaskJson(request, { error: error instanceof Error ? error.message : "Browser capture failed." }, 500);
  }
}
