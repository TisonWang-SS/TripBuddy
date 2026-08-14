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

function baseContentGlobals(overrides: Record<string, unknown> = {}) {
  const values = new Map<string, string>();
  return {
    URL,
    URLSearchParams,
    chrome: { runtime: { onMessage: { addListener: vi.fn() }, sendMessage: vi.fn() } },
    console,
    location: {
      hash: "",
      href: "https://www.hyatt.com/",
      origin: "https://www.hyatt.com",
      pathname: "/"
    },
    sessionStorage: {
      getItem: vi.fn((key: string) => values.get(key) ?? null),
      removeItem: vi.fn((key: string) => values.delete(key)),
      setItem: vi.fn((key: string, value: string) => values.set(key, value))
    },
    setTimeout,
    ...overrides
  };
}

function contentContext(overrides: Record<string, unknown> = {}) {
  const context = vm.createContext(baseContentGlobals(overrides));
  new vm.Script(extensionSource).runInContext(context);
  return context;
}

describe("Browser Companion behavior", () => {
  it("routes task reads and captures through the extension service worker", async () => {
    const sendMessage = vi.fn()
      .mockResolvedValueOnce({ body: { status: "running" }, ok: true, status: 200 })
      .mockResolvedValueOnce({ body: { status: "succeeded" }, ok: true, status: 200 });
    const context = contentContext({
      chrome: { runtime: { onMessage: { addListener: vi.fn() }, sendMessage } }
    });

    await expect(vm.runInContext('readTask("http://localhost:3000", "task-123456")', context)).resolves.toEqual({
      status: "running"
    });
    await expect(
      vm.runInContext(
        'postCapture("http://localhost:3000", "task-123456", { snapshot: { pageText: "Visible" } })',
        context
      )
    ).resolves.toEqual({ status: "succeeded" });
    expect(sendMessage).toHaveBeenNthCalledWith(1, {
      endpoint: "http://localhost:3000",
      method: "GET",
      payload: undefined,
      taskId: "task-123456",
      type: "tripbuddy:browser-request"
    });
    expect(sendMessage).toHaveBeenNthCalledWith(2, {
      endpoint: "http://localhost:3000",
      method: "POST",
      payload: { snapshot: { pageText: "Visible" } },
      taskId: "task-123456",
      type: "tripbuddy:browser-request"
    });
    expect(manifest.background.service_worker).toBe("background.js");
    expect(() => new vm.Script(background)).not.toThrow();
  });

  it("loads shared protocol and final-action guards before the content script and fails closed", () => {
    expect(manifest.content_scripts[0].js).toEqual(["taskProtocol.js", "safetyRules.js", "content.js"]);

    const context = vm.createContext({});
    new vm.Script(taskProtocolSource).runInContext(context);
    new vm.Script(safetyRules).runInContext(context);
    expect(vm.runInContext("TripBuddyTaskProtocol", context)).toEqual(taskProtocol);
    expect(vm.runInContext('TripBuddySafetyRules.isUnsafeBookingControl("Continue to payment")', context)).toBe(true);
    expect(vm.runInContext('TripBuddySafetyRules.isUnsafeBookingControl("Select & Book")', context)).toBe(false);

    const missingSafetyRules = vm.createContext(baseContentGlobals());
    new vm.Script(taskProtocolSource).runInContext(missingSafetyRules);
    expect(() => new vm.Script(content).runInContext(missingSafetyRules)).toThrow("safety rules failed to load");
  });

  it("keeps approved Hyatt links in the same task tab", () => {
    const assign = vi.fn();
    const context = contentContext({
      HTMLAnchorElement: class TestAnchor {},
      MouseEvent: class TestMouseEvent {},
      location: {
        assign,
        hash: "",
        href: "https://www.hyatt.com/",
        origin: "https://www.hyatt.com",
        pathname: "/"
      },
      window: {}
    });
    vm.runInContext(`
      var approvedAnchor = new HTMLAnchorElement();
      approvedAnchor.href = "https://www.hyatt.com/shop/rooms/tyogh";
      approvedAnchor.scrollIntoView = () => {};
      approvedAnchor.focus = () => {};
      approvedAnchor.dispatchEvent = () => {};
      approvedAnchor.click = () => {};
      activateSafeControl(approvedAnchor);
    `, context);

    expect(assign).toHaveBeenCalledWith("https://www.hyatt.com/shop/rooms/tyogh");
    expect(vm.runInContext('isHyattNavigationHref("https://sub.hyatt.com/path")', context)).toBe(true);
    expect(vm.runInContext('isHyattNavigationHref("http://www.hyatt.com/path")', context)).toBe(false);
    expect(vm.runInContext('isHyattNavigationHref("https://hyatt.example/path")', context)).toBe(false);
  });

  it("collects visible Stay Details links and opens them directly", async () => {
    const values = new Map<string, string>();
    const location = {
      hash: "",
      href: "https://www.hyatt.com/profile/en-US/my-stays",
      origin: "https://www.hyatt.com",
      pathname: "/profile/en-US/my-stays"
    };
    const detailLink = {
      getAttribute: vi.fn(() => null),
      getBoundingClientRect: () => ({ height: 20, width: 100 }),
      href: "https://www.hyatt.com/profile/en-US/reservation/ABC123",
      innerText: "Stay Details",
      textContent: "Stay Details"
    };
    const ignoredLink = { ...detailLink, href: "https://example.com/ABC123" };
    const context = contentContext({
      document: {
        body: { innerText: "Upcoming Stays" },
        querySelectorAll: vi.fn(() => [detailLink, ignoredLink]),
        title: "My Stays"
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      location,
      sessionStorage: {
        getItem: vi.fn((key: string) => values.get(key) ?? null),
        removeItem: vi.fn((key: string) => values.delete(key)),
        setItem: vi.fn((key: string, value: string) => values.set(key, value))
      }
    });
    vm.runInContext(`
      waitForText = async () => true;
      waitForCondition = async (check) => check();
      showStatus = () => {};
    `, context);

    await expect(vm.runInContext('runAccountImportTask("http://localhost:3000", "account-task")', context)).resolves.toBeNull();
    expect(location.href).toBe(detailLink.href);
    expect(JSON.parse(values.get("tripbuddyAccountState")!)).toMatchObject({
      index: 0,
      links: [detailLink.href],
      taskId: "account-task"
    });
  });

  it("prioritizes visible dialog controls before background room cards", () => {
    const element = (label: string, inDialog: boolean) => ({
      closest: vi.fn(() => (inDialog ? {} : null)),
      getAttribute: vi.fn(() => null),
      getBoundingClientRect: () => ({ height: 20, width: 100 }),
      innerText: label,
      parentElement: null,
      setAttribute: vi.fn(),
      textContent: label
    });
    const backgroundControl = element("Background room", false);
    const dialogControl = element("Dialog rate", true);
    const context = contentContext({
      HTMLAnchorElement: class TestAnchor {},
      document: { querySelectorAll: vi.fn(() => [backgroundControl, dialogControl]) },
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      window: {}
    });

    expect(vm.runInContext("collectControls().map((control) => control.label)", context)).toEqual([
      "Dialog rate",
      "Background room"
    ]);
  });

  /*
   * The rooms page decides cash against points with a switch, and a collector
   * that only saw links and buttons reported a page with no such control —
   * which is how a points check ran four times without ever entering points.
   */
  it("captures a labelled switch with its state, not just links and buttons", () => {
    const toggle = {
      checked: false,
      closest: vi.fn(() => null),
      getAttribute: vi.fn((name: string) => (name === "id" ? "use-points" : null)),
      getBoundingClientRect: () => ({ height: 20, width: 40 }),
      innerText: "",
      parentElement: null,
      setAttribute: vi.fn(),
      tagName: "INPUT",
      textContent: "",
      type: "checkbox"
    };
    /*
     * Selector-aware on purpose: a mock that answers every query would pass
     * even if the collector had never asked for a checkbox, which is exactly
     * the bug this test exists to prevent.
     */
    const querySelectorAll = vi.fn((selector: string) => (/input\[type="checkbox"\]|role="switch"/.test(selector) ? [toggle] : []));
    const context = contentContext({
      HTMLAnchorElement: class TestAnchor {},
      document: {
        getElementById: vi.fn(() => null),
        querySelector: vi.fn(() => ({ innerText: "Use Points" })),
        querySelectorAll
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" })
    });

    expect(vm.runInContext("collectControls()", context)).toMatchObject([
      { label: "Use Points", pressed: false }
    ]);
  });

  it("selects Hyatt's city-search Points view before capturing rates", async () => {
    let checked = false;
    const toggle = {
      click: vi.fn(() => {
        checked = true;
        body.innerText = "Rates from: 12,000 Points/Night";
      }),
      dispatchEvent: vi.fn(),
      focus: vi.fn(),
      getAttribute: vi.fn((name: string) => {
        if (name === "aria-label") return "Points";
        if (name === "aria-checked") return String(checked);
        if (name === "role") return "switch";
        return null;
      }),
      getBoundingClientRect: () => ({ height: 20, width: 40 }),
      innerText: "Points",
      parentElement: null,
      scrollIntoView: vi.fn(),
      tagName: "BUTTON",
      textContent: "Points"
    };
    const body = { innerText: "Rates from: $155 Avg/Night" };
    const context = contentContext({
      HTMLAnchorElement: class TestAnchor {},
      MouseEvent: class TestMouseEvent {},
      document: {
        body,
        querySelectorAll: vi.fn((selector: string) => selector.includes('[role="switch"]') ? [toggle] : [])
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" }),
      window: {}
    });

    await expect(vm.runInContext("selectHyattPoints()", context)).resolves.toBe(true);
    expect(toggle.click).toHaveBeenCalledOnce();
  });

  it("returns visible Hyatt sign-in evidence through the task protocol", async () => {
    const location = {
      hash: "",
      href: "https://www.hyatt.com/profile/en-US/my-stays",
      origin: "https://www.hyatt.com",
      pathname: "/profile/en-US/my-stays"
    };
    const context = contentContext({
      document: {
        body: { innerText: "Sign In Password" },
        querySelectorAll: vi.fn(() => []),
        title: "Sign In | Hyatt"
      },
      location
    });
    vm.runInContext(`
      var accountPayload = null;
      var accountStatus = null;
      waitForText = async () => true;
      postCapture = async (_endpoint, _taskId, payload) => {
        accountPayload = payload;
        return { errorMessage: "Login required", status: "partial" };
      };
      showStatus = (message) => { accountStatus = message; };
    `, context);

    await expect(
      vm.runInContext('runAccountImportTask("http://localhost:3000", "account-task")', context)
    ).resolves.toMatchObject({ status: "partial" });
    expect(vm.runInContext("accountPayload.snapshots[0]", context)).toMatchObject({
      pageText: "Sign In Password",
      pageTitle: "Sign In | Hyatt"
    });
    expect(vm.runInContext("accountStatus", context)).toBe("Login required");

    const returnUrl = `https://www.hyatt.com/profile/en-US/my-stays#${taskProtocol.taskIdKey}=return-task`;
    location.href = `https://www.hyatt.com/login?returnUrl=${encodeURIComponent(returnUrl)}`;
    expect(vm.runInContext(`taskHashFromLocation().get("${taskProtocol.taskIdKey}")`, context)).toBe("return-task");
  });

  it("requires a visible currency switch before importing city prices", () => {
    const context = contentContext();
    expect(
      vm.runInContext(
        'currencyControlText({ getAttribute: () => "Currency", innerText: "Chinese Yuan", textContent: "" })',
        context
      )
    ).toBe("CHINESE YUAN CURRENCY");
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
        var statusMessages = [];
        var waitForTextCalls = 0;
        var waitForReadablePageCalls = 0;
        waitForText = async () => { waitForTextCalls += 1; return true; };
        waitForReadablePage = async () => { waitForReadablePageCalls += 1; return true; };
        selectHyattCurrency = async () => false;
        reportFailure = async (_endpoint, _taskId, errorCode, errorMessage) => ({ errorCode, errorMessage });
        showStatus = (message) => { statusMessages.push(message); };
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
    expect(vm.runInContext("statusMessages", context)).toContain(
      "Hyatt's search currency control was not readable. TripBuddy will only accept a final total visibly shown in CNY."
    );
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

  it("retries only the current Hyatt tab from the popup", async () => {
    let clickHandler: (() => Promise<void>) | null = null;
    const importButton = {
      addEventListener: vi.fn((_type: string, handler: () => Promise<void>) => {
        clickHandler = handler;
      }),
      disabled: false
    };
    const statusBox = { textContent: "" };
    const query = vi.fn().mockResolvedValue([{ id: 7, url: "https://www.hyatt.com/shop/rooms/tyogh" }]);
    const sendMessage = vi.fn().mockResolvedValue({ ok: true, result: { status: "running" } });
    const context = vm.createContext({
      chrome: { tabs: { query, sendMessage } },
      document: {
        querySelector: (selector: string) => (selector === "#importButton" ? importButton : statusBox)
      }
    });
    new vm.Script(popup).runInContext(context);

    expect(clickHandler).not.toBeNull();
    await clickHandler!();
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(sendMessage).toHaveBeenCalledWith(7, { type: "tripbuddy:import-current-task" });
    expect(statusBox.textContent).toBe("Task status: running.");
    expect(importButton.disabled).toBe(false);
  });

  it("refuses to send popup retry messages to a non-Hyatt tab", async () => {
    const importButton = { addEventListener: vi.fn(), disabled: false };
    const statusBox = { textContent: "" };
    const sendMessage = vi.fn();
    const context = vm.createContext({
      chrome: {
        tabs: {
          query: vi.fn().mockResolvedValue([{ id: 9, url: "https://example.com/" }]),
          sendMessage
        }
      },
      document: {
        querySelector: (selector: string) => (selector === "#importButton" ? importButton : statusBox)
      }
    });
    new vm.Script(popup).runInContext(context);

    await vm.runInContext("retryCurrentTask()", context);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(statusBox.textContent).toBe("Open the Hyatt tab launched by TripBuddy first.");
    expect(importButton.disabled).toBe(false);
  });

  /*
   * From a real run: Hyatt's award rate card opened, TripBuddy pressed SELECT
   * twelve times, the page never changed, and the only thing reported was a
   * timeout. The card itself said why it would not move.
   */
  it("reports a control that does not advance instead of retrying it into a timeout", async () => {
    const control = {
      closest: vi.fn(() => null),
      /* Only the control-id attribute answers; an aria-label here would be
       * read as the button's text and hide what the run actually pressed. */
      getAttribute: vi.fn((name: string) => (name === "data-tripbuddy-control-id" ? "select-1" : null)),
      getBoundingClientRect: () => ({ height: 20, width: 100 }),
      innerText: "SELECT",
      parentElement: null,
      setAttribute: vi.fn(),
      textContent: "SELECT"
    };
    const pageText = "Choose Your Rate World of Hyatt Free Night Award from 12,000 Points/Night Sign In or Join to book SELECT";
    const posted: Array<Record<string, unknown>> = [];
    const context = contentContext({
      HTMLAnchorElement: class TestAnchor {},
      document: {
        body: { innerText: pageText },
        querySelector: vi.fn(() => control),
        querySelectorAll: vi.fn(() => [control]),
        title: "Hyatt rooms"
      },
      getComputedStyle: () => ({ display: "block", visibility: "visible" })
    });
    vm.runInContext(`
      waitForReadablePage = async () => true;
      showStatus = () => {};
      delay = async () => {};
      activateSafeControl = () => {};
      postCapture = async (endpoint, taskId, body) => {
        globalThis.__posted.push(body);
        return body.errorCode
          ? { status: "failed" }
          : { status: "running", action: { action: "click", elementId: "select-1", reason: "Select the lowest visible Hyatt rate plan." } };
      };
    `, context);
    context.__posted = posted;

    await vm.runInContext('runBookingPriceTask("http://localhost:3000", "price-task")', context);

    const failure = posted.find((body) => body.errorCode);
    expect(failure).toMatchObject({ errorCode: "control_did_not_advance" });
    expect(String(failure?.errorMessage)).toContain('pressed "SELECT"');
    /* Quotes the page's own reason rather than guessing at one. */
    expect(String(failure?.errorMessage)).toContain("Sign In or Join to book");
  });
});
