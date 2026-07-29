import { beforeEach, describe, expect, it } from "vitest";
import {
  completeBrowserTask,
  createBrowserTask,
  failBrowserTask,
  getBrowserTask,
  resetBrowserTasksForTests
} from "@/lib/browserTasks";

describe("browser tasks", () => {
  beforeEach(() => resetBrowserTasksForTests());

  it("keeps task kinds isolated", () => {
    const task = createBrowserTask("hyatt_city_search");

    expect(getBrowserTask(task.id, "hyatt_city_search")?.status).toBe("pending");
    expect(getBrowserTask(task.id, "hyatt_account_import")).toBeNull();
  });

  it("completes and fails browser tasks", () => {
    const completed = createBrowserTask("hyatt_city_search");
    const failed = createBrowserTask("hyatt_account_import");

    expect(completeBrowserTask(completed.id, completed.kind, { results: [1] })?.status).toBe("succeeded");
    expect(getBrowserTask(completed.id, completed.kind)?.result).toEqual({ results: [1] });
    expect(failBrowserTask(failed.id, failed.kind, "Unreadable Hyatt page")?.status).toBe("failed");
    expect(getBrowserTask(failed.id, failed.kind)?.error).toBe("Unreadable Hyatt page");
  });
});
