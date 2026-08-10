import type { BrowserTaskKind, BrowserTaskStatus } from "@prisma/client";
import taskProtocol from "@extension/taskProtocol.js";
import { prisma } from "@/lib/db";
import { parseJson, sanitizeEvidenceText, toJson } from "@/lib/json";
import type { BrowserPageSnapshot, SanitizedBrowserSnapshot } from "@/lib/providers/types";

export const BROWSER_TASK_TTL_MS = 3 * 60 * 1000;
export const DEFAULT_LOCAL_ENDPOINT = process.env.TRIPBUDDY_LOCAL_ENDPOINT ?? "http://localhost:3000";

export type BrowserTaskCapture = {
  errorCode?: string | null;
  errorMessage?: string | null;
  snapshot?: Partial<BrowserPageSnapshot> | null;
  snapshots?: Array<{
    links?: Array<{ href?: string; text?: string }>;
    pageText?: string;
    pageTitle?: string;
    sourceUrl?: string;
  }> | null;
};

export async function createBrowserTask(input: {
  context: unknown;
  expiresAt?: Date;
  hotelGroup: string;
  id: string;
  kind: BrowserTaskKind;
  launchUrl: string;
}) {
  return prisma.browserTask.create({
    data: {
      contextJson: toJson(input.context),
      expiresAt: input.expiresAt ?? new Date(Date.now() + BROWSER_TASK_TTL_MS),
      hotelGroup: input.hotelGroup,
      id: input.id,
      kind: input.kind,
      launchUrl: input.launchUrl
    }
  });
}

export async function getBrowserTask(id: string) {
  const task = await prisma.browserTask.findUnique({ where: { id }, include: { priceCheckRun: true } });
  if (!task) {
    return null;
  }
  if ((task.status === "pending" || task.status === "running") && task.expiresAt <= new Date()) {
    return expireBrowserTask(task.id);
  }
  return task;
}

export function serializeTaskState(task: Awaited<ReturnType<typeof getBrowserTask>>) {
  if (!task) {
    return null;
  }
  return {
    errorCode: task.errorCode,
    errorMessage: task.errorMessage,
    expiresAt: task.expiresAt.toISOString(),
    finishedAt: task.finishedAt?.toISOString() ?? null,
    hotelGroup: task.hotelGroup,
    hotelSearchMode: task.kind === "hotel_search" ? readHotelSearchMode(task.contextJson) : null,
    kind: task.kind,
    launchUrl: task.launchUrl,
    result: parseJson<unknown>(task.resultJson, null),
    runId: task.priceCheckRun?.id ?? null,
    status: task.status,
    taskId: task.id
  };
}

export async function appendBrowserSnapshot(taskId: string, snapshot: BrowserPageSnapshot) {
  const task = await prisma.browserTask.findUnique({ where: { id: taskId } });
  if (!task) {
    return null;
  }
  const snapshots = parseJson<SanitizedBrowserSnapshot[]>(task.snapshotsJson, []);
  snapshots.push({
    capturedAt: snapshot.capturedAt,
    pageTitle: snapshot.pageTitle.slice(0, 200),
    phase: inferSnapshotPhase(snapshot.pageText),
    sourceUrl: stripBrowserTaskHash(snapshot.sourceUrl),
    textSample: sanitizeEvidenceText(snapshot.pageText)
  });
  return prisma.browserTask.update({
    where: { id: taskId },
    data: { snapshotsJson: toJson(snapshots.slice(-12)), status: "running" }
  });
}

export async function finishBrowserTask(input: {
  errorCode?: string | null;
  errorMessage?: string | null;
  result?: unknown;
  status: Exclude<BrowserTaskStatus, "pending" | "running">;
  taskId: string;
}) {
  return prisma.browserTask.update({
    where: { id: input.taskId },
    data: {
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
      finishedAt: new Date(),
      resultJson: input.result === undefined ? null : toJson(input.result),
      status: input.status
    },
    include: { priceCheckRun: true }
  });
}

export function addBrowserTaskHash(sourceUrl: string, taskId: string, endpoint = DEFAULT_LOCAL_ENDPOINT) {
  const url = new URL(sourceUrl);
  const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
  hash.set(taskProtocol.endpointKey, endpoint);
  hash.set(taskProtocol.taskIdKey, taskId);
  url.hash = hash.toString();
  return url.toString();
}

export function normalizeBrowserSnapshot(input: Partial<BrowserPageSnapshot> | null | undefined): BrowserPageSnapshot | null {
  const sourceUrl = String(input?.sourceUrl ?? "").trim();
  const pageText = String(input?.pageText ?? "").replace(/\s+/g, " ").trim();
  if (!sourceUrl) {
    return null;
  }
  return {
    capturedAt: validCapturedAt(input?.capturedAt),
    controls: Array.isArray(input?.controls)
      ? input.controls
          .filter((control) => control && typeof control.elementId === "string" && typeof control.label === "string")
          .slice(0, 100)
      : [],
    pageText,
    pageTitle: String(input?.pageTitle ?? "").trim().slice(0, 200),
    sourceUrl
  };
}

async function expireBrowserTask(taskId: string) {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const run = await tx.priceCheckRun.findUnique({
      where: { browserTaskId: taskId },
      select: { watchPlanId: true }
    });
    const task = await tx.browserTask.update({
      where: { id: taskId },
      data: {
        errorCode: "task_expired",
        errorMessage: "The Browser Companion task expired before it completed.",
        finishedAt: now,
        status: "failed"
      }
    });
    await tx.priceCheckRun.updateMany({
      where: { browserTaskId: taskId, status: "running" },
      data: {
        errorCode: "task_expired",
        errorMessage: "The Browser Companion task expired before it completed.",
        finishedAt: now,
        status: "failed"
      }
    });
    if (run?.watchPlanId) {
      await tx.watchPlan.update({
        where: { id: run.watchPlanId },
        data: { consecutiveFailures: { increment: 1 }, lastAttemptedAt: now }
      });
    }
    return tx.browserTask.findUnique({ where: { id: task.id }, include: { priceCheckRun: true } });
  });
}

function inferSnapshotPhase(text: string): SanitizedBrowserSnapshot["phase"] {
  if (/Total Cash|Price Summary|Grand Total|Amount Due|Total Including Taxes/i.test(text)) {
    return "detail";
  }
  if (/Avg\s*\/\s*Night|per night|points|pts/i.test(text)) {
    return "inventory";
  }
  return "other";
}

export function stripBrowserTaskHash(value: string) {
  try {
    const url = new URL(value);
    const hash = new URLSearchParams(url.hash.replace(/^#/, ""));
    hash.delete(taskProtocol.endpointKey);
    hash.delete(taskProtocol.taskIdKey);
    hash.delete(taskProtocol.requestedCurrencyKey);
    url.hash = hash.toString();
    return url.toString();
  } catch {
    return value;
  }
}

export class BrowserTaskError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number
  ) {
    super(message);
  }
}

function readHotelSearchMode(contextJson: string) {
  const context = parseJson<{ mode?: unknown }>(contextJson, {});
  return context.mode === "tax_inclusive_total" ? "tax_inclusive_total" : "city_results";
}

function validCapturedAt(value: string | undefined) {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
