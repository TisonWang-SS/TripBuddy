import { randomUUID } from "node:crypto";

export type BrowserTaskKind = "hyatt_account_import" | "hyatt_city_search";
export type BrowserTaskStatus = "failed" | "pending" | "succeeded";

export type BrowserTask = {
  createdAt: Date;
  error: string | null;
  id: string;
  kind: BrowserTaskKind;
  result: unknown;
  status: BrowserTaskStatus;
  updatedAt: Date;
};

declare global {
  var tripBuddyBrowserTasks: Map<string, BrowserTask> | undefined;
}

const tasks = globalThis.tripBuddyBrowserTasks ?? new Map<string, BrowserTask>();
globalThis.tripBuddyBrowserTasks = tasks;

const TASK_TTL_MS = 15 * 60 * 1000;

export function createBrowserTask(kind: BrowserTaskKind) {
  removeExpiredBrowserTasks();
  const now = new Date();
  const task: BrowserTask = {
    createdAt: now,
    error: null,
    id: randomUUID(),
    kind,
    result: null,
    status: "pending",
    updatedAt: now
  };
  tasks.set(task.id, task);
  return task;
}

export function getBrowserTask(id: string, kind: BrowserTaskKind) {
  removeExpiredBrowserTasks();
  const task = tasks.get(id);
  return task?.kind === kind ? task : null;
}

export function completeBrowserTask(id: string, kind: BrowserTaskKind, result: unknown) {
  const task = getBrowserTask(id, kind);
  if (!task) {
    return null;
  }
  const completed = {
    ...task,
    error: null,
    result,
    status: "succeeded" as const,
    updatedAt: new Date()
  };
  tasks.set(id, completed);
  return completed;
}

export function failBrowserTask(id: string, kind: BrowserTaskKind, error: string) {
  const task = getBrowserTask(id, kind);
  if (!task) {
    return null;
  }
  const failed = {
    ...task,
    error,
    status: "failed" as const,
    updatedAt: new Date()
  };
  tasks.set(id, failed);
  return failed;
}

function removeExpiredBrowserTasks() {
  const cutoff = Date.now() - TASK_TTL_MS;
  for (const [id, task] of tasks) {
    if (task.updatedAt.getTime() < cutoff) {
      tasks.delete(id);
    }
  }
}

export function resetBrowserTasksForTests() {
  tasks.clear();
}
