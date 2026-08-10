import { randomUUID } from "node:crypto";
import { importAccountBookings } from "@/lib/accountBookings";
import type { BrowserTaskDefinition } from "@/lib/browserTaskDefinition";
import {
  BROWSER_TASK_TTL_MS,
  BrowserTaskError,
  createBrowserTask,
  DEFAULT_LOCAL_ENDPOINT,
  finishBrowserTask,
  getBrowserTask,
  serializeTaskState,
  type BrowserTaskCapture
} from "@/lib/browserTasks";
import { getAccountBookingImporter } from "@/lib/providers/registry";
import type { AccountPageSnapshot } from "@/lib/providers/types";

export type AccountImportTaskInput = { hotelGroup?: string };

export async function createAccountImportTask(input: AccountImportTaskInput = {}) {
  const hotelGroup = input.hotelGroup ?? "Hyatt";
  const importer = getAccountBookingImporter(hotelGroup);
  if (!importer) {
    throw new BrowserTaskError("provider_unavailable", `No account importer is available for ${hotelGroup}.`, 400);
  }
  const taskId = randomUUID();
  const launchUrl = importer.buildLaunchUrl(taskId, DEFAULT_LOCAL_ENDPOINT);
  const task = await createBrowserTask({
    context: { hotelGroup },
    expiresAt: new Date(Date.now() + Math.max(BROWSER_TASK_TTL_MS, 5 * 60 * 1000)),
    hotelGroup,
    id: taskId,
    kind: "account_booking_import",
    launchUrl
  });
  return serializeTaskState({ ...task, priceCheckRun: null });
}

export async function captureAccountImportTask(taskId: string, capture: BrowserTaskCapture) {
  const task = await getBrowserTask(taskId);
  if (!task || task.kind !== "account_booking_import") {
    throw new BrowserTaskError("task_not_found", "Account-import task was not found or expired.", 404);
  }
  if (task.status !== "pending" && task.status !== "running") {
    return serializeTaskState(task);
  }
  if (capture.errorMessage) {
    await finishBrowserTask({
      errorCode: capture.errorCode ?? "browser_capture_failed",
      errorMessage: capture.errorMessage,
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }

  const snapshots = normalizeAccountSnapshots(capture.snapshots);
  if (snapshots.length === 0) {
    throw new BrowserTaskError("invalid_snapshot", "Readable Hyatt account snapshots are required.", 400);
  }
  const importer = getAccountBookingImporter(task.hotelGroup);
  if (!importer) {
    throw new BrowserTaskError(
      "provider_unavailable",
      `No account importer is available for ${task.hotelGroup}.`,
      400
    );
  }
  const extraction = importer.parseSnapshots(snapshots);
  const hasReservationDetail = snapshots.some(
    (snapshot) =>
      importer.isReservationDetailUrl(snapshot.url) &&
      /Check-?in/i.test(snapshot.text) &&
      /Check-?out/i.test(snapshot.text)
  );
  if (extraction.bookings.length > 0 && !hasReservationDetail) {
    await finishBrowserTask({
      errorCode: "stay_details_missing",
      errorMessage: "Hyatt showed upcoming stays without complete reservation-detail evidence; no booking data was changed.",
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  if (extraction.loginState === "unknown" && extraction.bookings.length === 0) {
    await finishBrowserTask({
      errorCode: "unreadable_account",
      errorMessage: "Hyatt account evidence was unreadable; no booking data was changed.",
      status: "failed",
      taskId
    });
    return serializeTaskState(await getBrowserTask(taskId));
  }
  const result = await importAccountBookings(extraction);
  await finishBrowserTask({
    result,
    status: extraction.loginState === "login_required" ? "partial" : "succeeded",
    taskId
  });
  return serializeTaskState(await getBrowserTask(taskId));
}

export const accountImportTaskDefinition = {
  capture: captureAccountImportTask,
  create: createAccountImportTask,
  kind: "account_booking_import"
} satisfies BrowserTaskDefinition<AccountImportTaskInput, Awaited<ReturnType<typeof createAccountImportTask>>>;

function normalizeAccountSnapshots(input: BrowserTaskCapture["snapshots"]): AccountPageSnapshot[] {
  if (!Array.isArray(input)) {
    return [];
  }
  return input
    .map((snapshot) => ({
      links: Array.isArray(snapshot.links)
        ? snapshot.links
            .map((link) => ({ href: String(link.href ?? "").trim(), text: String(link.text ?? "").trim() }))
            .filter((link) => link.href)
        : [],
      text: String(snapshot.pageText ?? "").replace(/\s+/g, " ").trim(),
      title: String(snapshot.pageTitle ?? "").trim(),
      url: String(snapshot.sourceUrl ?? "").trim()
    }))
    .filter((snapshot) => snapshot.url && snapshot.text);
}
