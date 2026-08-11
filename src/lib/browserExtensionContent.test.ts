import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";
import taskProtocol from "@extension/taskProtocol.js";

const content = readFileSync(resolve("browser-extension/content.js"), "utf8");
const background = readFileSync(resolve("browser-extension/background.js"), "utf8");
const taskProtocolSource = readFileSync(resolve("browser-extension/taskProtocol.js"), "utf8");
const safetyRules = readFileSync(resolve("browser-extension/safetyRules.js"), "utf8");
const extensionSource = `${taskProtocolSource}\n${safetyRules}\n${content}`;
const popup = readFileSync(resolve("browser-extension/popup.js"), "utf8");
const manifest = JSON.parse(readFileSync(resolve("browser-extension/manifest.json"), "utf8")) as {
  background: { service_worker: string };
  content_scripts: Array<{ js: string[] }>;
};

describe("Browser Companion source", () => {
  it("is valid JavaScript and uses one browser-task API", () => {
    expect(() => new vm.Script(extensionSource)).not.toThrow();
    expect(() => new vm.Script(background)).not.toThrow();
    expect(manifest.background.service_worker).toBe("background.js");
    expect(background).toContain("/api/browser-tasks/");
    expect(content).toContain('type: "tripbuddy:browser-request"');
    expect(content).not.toContain("fetch(");
    expect(content).not.toContain("/api/browser-evidence");
    expect(content).not.toContain("/api/browser-agent/snapshot");
  });

  it("loads shared protocol and final-action guards before the content script", () => {
    expect(manifest.content_scripts[0].js).toEqual(["taskProtocol.js", "safetyRules.js", "content.js"]);
    expect(safetyRules).toMatch(/payment\|pay now\|confirm\|purchase\|place order\|complete reservation/);
    expect(content).toContain("TASK_PROTOCOL.requestedCurrencyKey");
    expect(content).toContain("SAFETY_RULES.isUnsafeBookingControl(label)");
    expect(content).toContain("activateSafeControl(element)");

    const context = vm.createContext({});
    new vm.Script(taskProtocolSource).runInContext(context);
    new vm.Script(safetyRules).runInContext(context);
    expect(vm.runInContext("TripBuddyTaskProtocol", context)).toEqual(taskProtocol);
    expect(vm.runInContext('TripBuddySafetyRules.isUnsafeBookingControl("Continue to payment")', context)).toBe(true);
    expect(vm.runInContext('TripBuddySafetyRules.isUnsafeBookingControl("Select & Book")', context)).toBe(false);
  });

  it("keeps approved Hyatt links in the same task tab", () => {
    expect(content).toContain("element instanceof HTMLAnchorElement && isHyattNavigationHref(element.href)");
    expect(content).toContain("location.assign(element.href)");
    expect(content).toContain("url.protocol === \"https:\"");
  });

  it("opens collected Stay Details URLs directly", () => {
    expect(content).toContain("findStayDetailLinks");
    expect(content).toContain("await waitForCondition(");
    expect(content).toContain("location.href = state.links[state.index]");
  });

  it("prioritizes visible dialog controls before background room cards", () => {
    expect(content).toContain("const dialogControls = visible.filter");
    expect(content).toContain("const prioritized = [...dialogControls");
  });

  it("returns visible Hyatt sign-in evidence through the task protocol", () => {
    expect(content).toContain("Sign in to Hyatt in Chrome, then start the import again from TripBuddy.");
    expect(content).toContain("snapshots: [buildAccountSnapshot()]");
    expect(content).toContain('searchParams.get("returnUrl")');
  });

  it("requires a visible currency switch before importing city prices", () => {
    expect(content).toContain("selectHyattCurrency(requestedCurrency)");
    expect(content).toContain("runHotelSearchTask(endpoint, taskId, task.hotelSearchMode)");
    expect(content).toContain('hotelSearchMode !== "tax_inclusive_total"');
    expect(content).toContain("currencyControlText(toggle)");
    expect(content).toContain("element.innerText || \"\"");
    expect(content).toContain("currency_selector_unavailable");
    expect(content).toContain("no official prices were imported");
  });

  it("uses the saved hotel-search mode when the currency selector is unavailable", async () => {
    const context = vm.createContext({
      URL,
      URLSearchParams,
      chrome: { runtime: { onMessage: { addListener: vi.fn() } } },
      console,
      location: {
        hash: `#${taskProtocol.requestedCurrencyKey}=CNY`,
        href: `https://www.hyatt.com/search/hotels/en-US/Kuala-Lumpur#${taskProtocol.requestedCurrencyKey}=CNY`,
        origin: "https://www.hyatt.com",
        pathname: "/search/hotels/en-US/Kuala-Lumpur"
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn()
      },
      setTimeout
    });
    new vm.Script(extensionSource).runInContext(context);
    vm.runInContext(
      `
        var waitForTextCalls = 0;
        var waitForReadablePageCalls = 0;
        waitForText = async () => { waitForTextCalls += 1; return true; };
        waitForReadablePage = async () => { waitForReadablePageCalls += 1; return true; };
        selectHyattCurrency = async () => false;
        reportFailure = async (_endpoint, _taskId, errorCode, errorMessage) => ({ errorCode, errorMessage });
        showStatus = () => {};
        buildPageSnapshot = () => ({ pageText: "A".repeat(81), pageTitle: "Hyatt" });
        postCapture = async () => ({ status: "succeeded", result: { results: [] } });
      `,
      context
    );

    const cityResult = await vm.runInContext(
      'runHotelSearchTask("http://localhost:3000", "city-task", "city_results")',
      context
    );
    expect(cityResult.errorCode).toBe("currency_selector_unavailable");

    const totalResult = await vm.runInContext(
      'runHotelSearchTask("http://localhost:3000", "total-task", "tax_inclusive_total")',
      context
    );
    expect(totalResult.status).toBe("succeeded");
    expect(vm.runInContext("({ waitForTextCalls, waitForReadablePageCalls })", context)).toEqual({
      waitForReadablePageCalls: 1,
      waitForTextCalls: 1
    });
  });

  it("does not post an empty Hyatt snapshot during a tax-total navigation", async () => {
    const context = vm.createContext({
      URL,
      URLSearchParams,
      chrome: { runtime: { onMessage: { addListener: vi.fn() } } },
      console,
      document: { title: "" },
      location: {
        hash: `#${taskProtocol.requestedCurrencyKey}=USD`,
        href: "https://www.hyatt.com/shop/rooms/kulph",
        origin: "https://www.hyatt.com",
        pathname: "/shop/rooms/kulph"
      },
      sessionStorage: {
        getItem: vi.fn(() => null),
        removeItem: vi.fn(),
        setItem: vi.fn()
      },
      setTimeout
    });
    new vm.Script(extensionSource).runInContext(context);
    vm.runInContext(
      `
        var captureCount = 0;
        var snapshotCount = 0;
        waitForReadablePage = async () => true;
        selectHyattCurrency = async () => true;
        showStatus = () => {};
        delay = async () => {};
        buildPageSnapshot = () => {
          snapshotCount += 1;
          return snapshotCount === 1
            ? { pageText: "", pageTitle: "" }
            : { pageText: "A".repeat(81), pageTitle: "Hyatt rooms" };
        };
        postCapture = async () => {
          captureCount += 1;
          return { status: "succeeded", result: { results: [] } };
        };
      `,
      context
    );

    const result = await vm.runInContext(
      'runHotelSearchTask("http://localhost:3000", "total-task", "tax_inclusive_total")',
      context
    );

    expect(result.status).toBe("succeeded");
    expect(vm.runInContext("({ captureCount, snapshotCount })", context)).toEqual({
      captureCount: 1,
      snapshotCount: 2
    });
  });

  it("does not treat a Hyatt page title without visible body text as readable", () => {
    const context = vm.createContext({
      URL,
      URLSearchParams,
      chrome: { runtime: { onMessage: { addListener: vi.fn() } } },
      location: { hash: "", href: "https://www.hyatt.com", origin: "https://www.hyatt.com", pathname: "/" },
      sessionStorage: { getItem: vi.fn(() => null), removeItem: vi.fn(), setItem: vi.fn() },
      setTimeout
    });
    new vm.Script(extensionSource).runInContext(context);

    expect(vm.runInContext('isReadableSnapshot({ pageTitle: "Hyatt", pageText: "" })', context)).toBe(false);
    expect(vm.runInContext('isReadableSnapshot({ pageTitle: "", pageText: "A".repeat(81) })', context)).toBe(true);
  });

  it("refreshes a stalled Hyatt room page once and resumes with the same task state", async () => {
    const values = new Map<string, string>();
    const reload = vi.fn();
    const context = vm.createContext({
      URL,
      URLSearchParams,
      chrome: { runtime: { onMessage: { addListener: vi.fn() } } },
      console,
      location: {
        hash: "",
        href: "https://www.hyatt.com/shop/rooms/kulrk",
        origin: "https://www.hyatt.com",
        pathname: "/shop/rooms/kulrk",
        reload
      },
      sessionStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        removeItem: vi.fn((key: string) => values.delete(key)),
        setItem: vi.fn((key: string, value: string) => values.set(key, value))
      },
      setTimeout
    });
    new vm.Script(extensionSource).runInContext(context);
    vm.runInContext(
      `
        showStatus = () => {};
        waitForReadablePage = async () => true;
        delay = async () => {};
        Date.now = () => 20000;
        buildPageSnapshot = () => ({
          pageText: "SELECT A ROOM Currency United States Dollar",
          pageTitle: "Hyatt | Select Room",
          sourceUrl: "https://www.hyatt.com/shop/rooms/kulrk"
        });
        postCapture = async () => ({
          action: { action: "wait", milliseconds: 1500, reason: "Waiting for Hyatt booking content." },
          status: "running"
        });
        sessionStorage.setItem(
          AUTO_RELOAD_STATE_KEY,
          JSON.stringify({ reloaded: false, startedAt: 1000, taskId: "booking-task" })
        );
      `,
      context
    );

    const result = await vm.runInContext(
      'runBookingPriceTask("http://localhost:3000", "booking-task")',
      context
    );

    expect(result).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(JSON.parse(values.get("tripbuddyAutoReloadState")!)).toEqual({
      reloaded: true,
      startedAt: 1000,
      taskId: "booking-task"
    });
    expect(
      vm.runInContext(
        `autoReloadStalledHyattRoomPage(
          "booking-task",
          buildPageSnapshot(),
          { action: "wait", reason: "Waiting for Hyatt booking content." },
          AUTO_RELOAD_AFTER_MS
        )`,
        context
      )
    ).toBe(false);
    vm.runInContext('clearAutoReloadState("booking-task")', context);
    expect(values.has("tripbuddyAutoReloadState")).toBe(false);
  });

  it("does not auto-refresh search, blocked, hydrated, or newly opened Hyatt pages", () => {
    const values = new Map<string, string>();
    const reload = vi.fn();
    const context = vm.createContext({
      URL,
      URLSearchParams,
      chrome: { runtime: { onMessage: { addListener: vi.fn() } } },
      location: {
        hash: "",
        href: "https://www.hyatt.com/shop/rooms/kulrk",
        origin: "https://www.hyatt.com",
        pathname: "/shop/rooms/kulrk",
        reload
      },
      sessionStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        removeItem: vi.fn((key: string) => values.delete(key)),
        setItem: vi.fn((key: string, value: string) => values.set(key, value))
      },
      setTimeout
    });
    new vm.Script(extensionSource).runInContext(context);
    vm.runInContext(
      `
        showStatus = () => {};
        sessionStorage.setItem(
          AUTO_RELOAD_STATE_KEY,
          JSON.stringify({ reloaded: false, startedAt: 1000, taskId: "safe-task" })
        );
      `,
      context
    );

    const attempts = vm.runInContext(
      `[
        autoReloadStalledHyattRoomPage(
          "safe-task",
          { pageText: "SELECT A ROOM", sourceUrl: "https://www.hyatt.com/search/hotels/en-US/Kuala-Lumpur" },
          { action: "wait", reason: "Waiting for Hyatt booking content." },
          AUTO_RELOAD_AFTER_MS
        ),
        autoReloadStalledHyattRoomPage(
          "safe-task",
          { pageText: "SELECT A ROOM verify you are human", sourceUrl: "https://www.hyatt.com/shop/rooms/kulrk" },
          { action: "wait", reason: "Waiting for Hyatt booking content." },
          AUTO_RELOAD_AFTER_MS
        ),
        autoReloadStalledHyattRoomPage(
          "safe-task",
          { pageText: "SELECT A ROOM $104 Avg/Night", sourceUrl: "https://www.hyatt.com/shop/rooms/kulrk" },
          { action: "wait", reason: "Waiting for selectable Hyatt room rates." },
          AUTO_RELOAD_AFTER_MS
        ),
        autoReloadStalledHyattRoomPage(
          "safe-task",
          { pageText: "SELECT A ROOM", sourceUrl: "https://www.hyatt.com/shop/rooms/kulrk" },
          { action: "wait", reason: "Waiting for Hyatt booking content." },
          AUTO_RELOAD_AFTER_MS - 1
        )
      ]`,
      context
    );

    expect(attempts).toEqual([false, false, false, false]);
    expect(reload).not.toHaveBeenCalled();
  });

  it("allows a tax-total task to continue only when its final visible total matches the requested currency", () => {
    expect(content).toContain("TripBuddy will only accept a final total visibly shown in ${requestedCurrency}.");
  });

  it("keeps popup parsing and arbitrary booking identifiers out of the extension", () => {
    expect(() => new vm.Script(popup)).not.toThrow();
    expect(popup).not.toContain("bookingId");
    expect(popup).not.toContain("parseHyatt");
  });
});
