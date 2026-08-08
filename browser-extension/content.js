const ACCOUNT_STATE_KEY = "tripbuddyAccountState";
const AUTO_RELOAD_STATE_KEY = "tripbuddyAutoReloadState";
const AUTO_RELOAD_AFTER_MS = 15000;
const TASK_TIMEOUT_MS = 120000;
const CONTROL_ATTRIBUTE = "data-tripbuddy-control-id";
const TASK_PROTOCOL = globalThis.TripBuddyTaskProtocol;
const SAFETY_RULES = globalThis.TripBuddySafetyRules;

if (!TASK_PROTOCOL?.taskIdKey || !TASK_PROTOCOL?.endpointKey || !TASK_PROTOCOL?.requestedCurrencyKey) {
  throw new Error("TripBuddy task protocol failed to load.");
}
if (!SAFETY_RULES?.isUnsafeBookingControl) {
  throw new Error("TripBuddy safety rules failed to load.");
}

const TASK_ID_KEY = TASK_PROTOCOL.taskIdKey;
const ENDPOINT_KEY = TASK_PROTOCOL.endpointKey;
const REQUESTED_CURRENCY_KEY = TASK_PROTOCOL.requestedCurrencyKey;

let taskRunning = false;

rememberTaskContext();
runCurrentTask();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "tripbuddy:import-current-task") {
    return false;
  }
  runCurrentTask(true)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ error: error instanceof Error ? error.message : "Task import failed.", ok: false }));
  return true;
});

async function runCurrentTask(force = false) {
  if (taskRunning) {
    return null;
  }
  const taskId = sessionStorage.getItem(TASK_ID_KEY);
  const endpoint = normalizeEndpoint(sessionStorage.getItem(ENDPOINT_KEY));
  if (!taskId || !endpoint) {
    if (force) {
      throw new Error("Open a TripBuddy browser task from the local app first.");
    }
    return null;
  }
  taskRunning = true;
  try {
    const task = await readTask(endpoint, taskId);
    if (["succeeded", "partial", "failed"].includes(task.status)) {
      clearAutoReloadState(taskId);
      showStatus(task.errorMessage || `TripBuddy task is ${task.status}.`);
      return task;
    }
    let result;
    if (task.kind === "hotel_search") {
      result = await runHotelSearchTask(endpoint, taskId, task.hotelSearchMode);
    } else if (task.kind === "account_booking_import") {
      result = await runAccountImportTask(endpoint, taskId);
    } else {
      result = await runBookingPriceTask(endpoint, taskId);
    }
    if (result && ["succeeded", "partial", "failed"].includes(result.status)) {
      clearAutoReloadState(taskId);
    }
    return result;
  } finally {
    taskRunning = false;
  }
}

async function runBookingPriceTask(endpoint, taskId) {
  showStatus("TripBuddy is waiting for visible Hyatt rate evidence...");
  const startedAt = rememberAutoReloadTaskStart(taskId);
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    const readable = await waitForReadablePage(15000);
    if (!readable) {
      return reportFailure(endpoint, taskId, "empty_page", "Hyatt did not expose a readable page document.");
    }
    const snapshot = buildPageSnapshot();
    const response = await postCapture(endpoint, taskId, { snapshot });
    if (["succeeded", "partial", "failed"].includes(response.status)) {
      showStatus(response.errorMessage || `TripBuddy price check ${response.status}.`);
      return response;
    }
    const action = response.action;
    if (!action || action.action === "import") {
      return response;
    }
    if (action.action === "stop") {
      return reportFailure(endpoint, taskId, "navigation_stopped", action.reason);
    }
    if (action.action === "click") {
      const element = document.querySelector(`[${CONTROL_ATTRIBUTE}="${cssEscape(action.elementId)}"]`);
      if (!element || !isVisible(element)) {
        await delay(1200);
        continue;
      }
      const label = controlLabel(element);
      if (SAFETY_RULES.isUnsafeBookingControl(label)) {
        return reportFailure(endpoint, taskId, "unsafe_control", `TripBuddy refused to click an unsafe control: ${label}`);
      }
      showStatus(action.reason);
      activateSafeControl(element);
      await delay(1800);
      continue;
    }
    if (autoReloadStalledHyattRoomPage(taskId, snapshot, action, Date.now() - startedAt)) {
      return null;
    }
    await delay(Math.min(Math.max(action.milliseconds || 1200, 500), 4000));
  }
  return reportFailure(endpoint, taskId, "task_timeout", "Hyatt did not reach a pre-payment price summary before the task timed out.");
}

async function runHotelSearchTask(endpoint, taskId, hotelSearchMode) {
  showStatus("TripBuddy is reading the visible official hotel search...");
  const startedAt =
    hotelSearchMode === "tax_inclusive_total" ? rememberAutoReloadTaskStart(taskId) : Date.now();
  const readable =
    hotelSearchMode === "tax_inclusive_total"
      ? await waitForReadablePage(60000)
      : await waitForText(/Rates from:|Avg\s*\/\s*Night|View Rates|No hotels|not available|Find Hotels/i, 60000);
  if (!readable) {
    return reportFailure(
      endpoint,
      taskId,
      hotelSearchMode === "tax_inclusive_total" ? "price_page_unreadable" : "search_unreadable",
      hotelSearchMode === "tax_inclusive_total"
        ? "Hyatt's room or price page did not become readable in Chrome."
        : "Hyatt search results did not become readable in Chrome."
    );
  }
  const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  const requestedCurrency = hash.get(REQUESTED_CURRENCY_KEY) || new URL(location.href).searchParams.get("currency");
  if (requestedCurrency) {
    const currencyReady = await selectHyattCurrency(requestedCurrency);
    if (!currencyReady && hotelSearchMode !== "tax_inclusive_total") {
      return reportFailure(
        endpoint,
        taskId,
        "currency_selector_unavailable",
        `Hyatt did not visibly switch the search results to ${requestedCurrency}; no official prices were imported.`
      );
    }
    if (!currencyReady) {
      showStatus(`Hyatt's search currency control was not readable. TripBuddy will only accept a final total visibly shown in ${requestedCurrency}.`);
    }
  }
  while (Date.now() - startedAt < TASK_TIMEOUT_MS) {
    const snapshot = buildPageSnapshot();
    if (!isReadableSnapshot(snapshot)) {
      showStatus("TripBuddy is waiting for Hyatt's next page to finish loading...");
      await delay(600);
      continue;
    }
    const result = await postCapture(endpoint, taskId, { snapshot });
    if (["succeeded", "partial", "failed"].includes(result.status)) {
      const count = result.result?.results?.length ?? 0;
      showStatus(result.errorMessage || `TripBuddy captured ${count} visible hotel rate${count === 1 ? "" : "s"}.`);
      return result;
    }
    const action = result.action;
    if (!action || action.action === "import") {
      return result;
    }
    if (action.action === "stop") {
      return reportFailure(endpoint, taskId, "navigation_stopped", action.reason);
    }
    if (action.action === "click") {
      const element = document.querySelector(`[${CONTROL_ATTRIBUTE}="${cssEscape(action.elementId)}"]`);
      if (!element || !isVisible(element)) {
        await delay(1200);
        continue;
      }
      const label = controlLabel(element);
      if (SAFETY_RULES.isUnsafeBookingControl(label)) {
        return reportFailure(endpoint, taskId, "unsafe_control", `TripBuddy refused to click an unsafe control: ${label}`);
      }
      showStatus(action.reason);
      activateSafeControl(element);
      await delay(1800);
      continue;
    }
    if (
      hotelSearchMode === "tax_inclusive_total" &&
      autoReloadStalledHyattRoomPage(taskId, snapshot, action, Date.now() - startedAt)
    ) {
      return null;
    }
    await delay(Math.min(Math.max(action.milliseconds || 1200, 500), 4000));
  }
  return reportFailure(endpoint, taskId, "task_timeout", "Hyatt did not reach a tax-inclusive price summary before the task timed out.");
}

async function runAccountImportTask(endpoint, taskId) {
  showStatus("TripBuddy is reading Hyatt My Stays...");
  const readable = await waitForText(/Upcoming|Past|Stay Details|Confirmation|Sign In|No upcoming/i, 60000);
  if (!readable) {
    return reportFailure(endpoint, taskId, "account_unreadable", "Hyatt My Stays did not become readable in Chrome.");
  }
  if (/Sign In|Sign in to|Password|Passkeys|Activate your online account/i.test(pageText()) && !/Sign Out|Upcoming Stays/i.test(pageText())) {
    const result = await postCapture(endpoint, taskId, { snapshots: [buildAccountSnapshot()] });
    clearAccountState();
    showStatus(result.errorMessage || "Sign in to Hyatt in Chrome, then start the import again from TripBuddy.");
    return result;
  }

  const state = readAccountState(taskId);
  if (!state.links.length && /\/my-stays/i.test(location.pathname)) {
    await waitForCondition(
      () =>
        findStayDetailLinks().length > 0 ||
        /No upcoming stays|No upcoming reservations|No stays found/i.test(pageText()),
      15000
    );
    state.links = findStayDetailLinks();
    state.snapshots.push(buildAccountSnapshot());
    writeAccountState(state);
    if (state.links.length === 0) {
      if (/Confirmation(?: Number)?|Check-?in|Check-?out|Reservation Details/i.test(pageText())) {
        return reportFailure(endpoint, taskId, "stay_details_missing", "Hyatt showed upcoming stays without readable Stay Details links. No booking data was changed.");
      }
      const result = await postCapture(endpoint, taskId, { snapshots: state.snapshots });
      clearAccountState();
      showStatus(result.errorMessage || "TripBuddy finished reading Hyatt My Stays.");
      return result;
    }
    location.href = state.links[0];
    return null;
  }

  if (state.links.length > 0) {
    const complete = await waitForCondition(hasCompleteReservationDetails, 60000);
    if (!complete) {
      return reportFailure(endpoint, taskId, "reservation_unreadable", "A Hyatt reservation detail page was incomplete or unreadable.");
    }
    state.snapshots.push(buildAccountSnapshot());
    state.index += 1;
    writeAccountState(state);
    if (state.index < state.links.length) {
      location.href = state.links[state.index];
      return null;
    }
    const result = await postCapture(endpoint, taskId, { snapshots: state.snapshots });
    clearAccountState();
    showStatus(result.errorMessage || "TripBuddy finished importing Hyatt bookings.");
    return result;
  }

  return reportFailure(endpoint, taskId, "account_unreadable", "Hyatt account navigation state could not be recovered.");
}

function rememberTaskContext() {
  const hash = taskHashFromLocation();
  const taskId = hash.get(TASK_ID_KEY);
  const endpoint = normalizeEndpoint(hash.get(ENDPOINT_KEY));
  if (taskId) {
    sessionStorage.setItem(TASK_ID_KEY, taskId);
  }
  if (endpoint) {
    sessionStorage.setItem(ENDPOINT_KEY, endpoint);
  }
}

function taskHashFromLocation() {
  const direct = new URLSearchParams(location.hash.replace(/^#/, ""));
  if (direct.has(TASK_ID_KEY)) {
    return direct;
  }
  const returnUrl = new URL(location.href).searchParams.get("returnUrl");
  if (!returnUrl) {
    return direct;
  }
  try {
    return new URLSearchParams(new URL(returnUrl, location.origin).hash.replace(/^#/, ""));
  } catch {
    return direct;
  }
}

async function readTask(endpoint, taskId) {
  const response = await fetch(`${endpoint}/api/browser-tasks/${encodeURIComponent(taskId)}`, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `TripBuddy task lookup failed with ${response.status}.`);
  }
  return result;
}

async function postCapture(endpoint, taskId, payload) {
  const response = await fetch(`${endpoint}/api/browser-tasks/${encodeURIComponent(taskId)}`, {
    body: JSON.stringify(payload),
    headers: { "Content-Type": "application/json" },
    method: "POST"
  });
  const result = await response.json();
  if (!response.ok) {
    throw new Error(result.error || `TripBuddy capture failed with ${response.status}.`);
  }
  return result;
}

async function reportFailure(endpoint, taskId, errorCode, errorMessage) {
  try {
    const result = await postCapture(endpoint, taskId, { errorCode, errorMessage });
    showStatus(errorMessage);
    return result;
  } catch (error) {
    showStatus(error instanceof Error ? error.message : errorMessage);
    return null;
  }
}

function buildPageSnapshot(includeControls = true) {
  return {
    capturedAt: new Date().toISOString(),
    controls: includeControls ? collectControls() : [],
    pageText: pageText(),
    pageTitle: document.title || "",
    sourceUrl: location.href
  };
}

function buildAccountSnapshot() {
  return {
    links: Array.from(document.querySelectorAll("a[href]"))
      .filter(isVisible)
      .map((link) => ({ href: link.href, text: controlLabel(link) }))
      .filter((link) => link.href),
    pageText: pageText(),
    pageTitle: document.title || "",
    sourceUrl: location.href
  };
}

function collectControls() {
  const visible = Array.from(document.querySelectorAll('a[href], button, [role="button"]')).filter(isVisible);
  const dialogControls = visible.filter((element) => element.closest('[role="dialog"], [aria-modal="true"], dialog'));
  const prioritized = [...dialogControls, ...visible.filter((element) => !dialogControls.includes(element))];
  return prioritized
    .map((element, index) => {
      const elementId = element.getAttribute(CONTROL_ATTRIBUTE) || `tb-${index}-${Date.now()}`;
      element.setAttribute(CONTROL_ATTRIBUTE, elementId);
      return {
        context: controlContext(element),
        elementId,
        href: element instanceof HTMLAnchorElement ? element.href : null,
        label: controlLabel(element)
      };
    })
    .filter((control) => control.label)
    .slice(0, 100);
}

function controlContext(element) {
  let current = element;
  for (let depth = 0; depth < 4 && current; depth += 1) {
    const text = current.innerText?.replace(/\s+/g, " ").trim();
    if (text && text.length >= 20) {
      return text.slice(0, 700);
    }
    current = current.parentElement;
  }
  return controlLabel(element);
}

function controlLabel(element) {
  return String(element.getAttribute("aria-label") || element.innerText || element.textContent || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function isVisible(element) {
  const style = getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
}

function findStayDetailLinks() {
  return [...new Set(Array.from(document.querySelectorAll('a[href]'))
    .filter((link) => isVisible(link) && /Stay Details|Reservation Details|View Details/i.test(controlLabel(link)))
    .map((link) => link.href)
    .filter((href) => /hyatt\.com/i.test(href)))];
}

function hasCompleteReservationDetails() {
  const text = pageText();
  const hasDates = /Check-?in/i.test(text) && /Check-?out/i.test(text);
  const hasBaseline = /Total Cost Per Room|Total Awards|\b[0-9][0-9,]{3,}\s*points\b/i.test(text);
  return hasDates && hasBaseline;
}

function readAccountState(taskId) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(ACCOUNT_STATE_KEY) || "null");
    if (parsed?.taskId === taskId && Array.isArray(parsed.links) && Array.isArray(parsed.snapshots)) {
      return parsed;
    }
  } catch {
    // Start a new task state below.
  }
  return { index: 0, links: [], snapshots: [], taskId };
}

function writeAccountState(state) {
  sessionStorage.setItem(ACCOUNT_STATE_KEY, JSON.stringify(state));
}

function clearAccountState() {
  sessionStorage.removeItem(ACCOUNT_STATE_KEY);
}

function rememberAutoReloadTaskStart(taskId) {
  const existing = readAutoReloadState(taskId);
  if (existing) {
    return existing.startedAt;
  }
  const state = { reloaded: false, startedAt: Date.now(), taskId };
  sessionStorage.setItem(AUTO_RELOAD_STATE_KEY, JSON.stringify(state));
  return state.startedAt;
}

function readAutoReloadState(taskId) {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(AUTO_RELOAD_STATE_KEY) || "null");
    if (
      parsed?.taskId === taskId &&
      typeof parsed.startedAt === "number" &&
      Number.isFinite(parsed.startedAt) &&
      typeof parsed.reloaded === "boolean"
    ) {
      return parsed;
    }
  } catch {
    // A malformed or stale marker is replaced when the task starts.
  }
  return null;
}

function clearAutoReloadState(taskId) {
  if (readAutoReloadState(taskId)) {
    sessionStorage.removeItem(AUTO_RELOAD_STATE_KEY);
  }
}

function autoReloadStalledHyattRoomPage(taskId, snapshot, action, elapsedMs) {
  const state = readAutoReloadState(taskId);
  if (
    !state ||
    state.reloaded ||
    elapsedMs < AUTO_RELOAD_AFTER_MS ||
    action?.action !== "wait" ||
    action.reason !== "Waiting for Hyatt booking content." ||
    !isReloadableHyattRoomSnapshot(snapshot)
  ) {
    return false;
  }
  sessionStorage.setItem(AUTO_RELOAD_STATE_KEY, JSON.stringify({ ...state, reloaded: true }));
  showStatus("Hyatt's room rates are still loading. TripBuddy is refreshing this page once and will resume the same task...");
  location.reload();
  return true;
}

function isReloadableHyattRoomSnapshot(snapshot) {
  let url;
  try {
    url = new URL(snapshot?.sourceUrl || location.href);
  } catch {
    return false;
  }
  const text = String(snapshot?.pageText || "");
  return (
    url.protocol === "https:" &&
    /(^|\.)hyatt\.com$/i.test(url.hostname) &&
    /^\/shop\/rooms\/[a-z0-9]{4,6}\/?$/i.test(url.pathname) &&
    /SELECT A ROOM|Choose a room/i.test(text) &&
    !/ERROR:E6020|browser did something unexpected|KPSDK|captcha|verify you are human|access denied/i.test(text)
  );
}

async function selectHyattCurrency(currencyCode) {
  const labels = {
    CNY: "Chinese Yuan",
    EUR: "Euro",
    GBP: "British Pound",
    HKD: "Hong Kong Dollar",
    JPY: "Japanese Yen",
    MYR: "Malaysian Ringgit",
    SGD: "Singapore Dollar",
    USD: "United States Dollar"
  };
  const target = labels[String(currencyCode).toUpperCase()];
  if (!target) {
    return false;
  }
  const toggle = Array.from(document.querySelectorAll(
    '[role="combobox"][aria-label*="Currency" i], [aria-haspopup="listbox"][aria-label*="Currency" i], button[aria-label*="Currency" i]'
  )).find(isVisible);
  if (!toggle || !isVisible(toggle)) {
    return false;
  }
  if (currencyControlText(toggle).includes(target.toUpperCase())) {
    return true;
  }
  toggle.click();
  const option = await waitForElement(
    () =>
      Array.from(document.querySelectorAll('[role="option"], [role="menuitemradio"], [role="radio"]')).find(
        (item) => isVisible(item) && currencyControlText(item).includes(target.toUpperCase())
      ),
    5000
  );
  if (!option) {
    return false;
  }
  option.click();
  return waitForCondition(() => currencyControlText(toggle).includes(target.toUpperCase()), 5000);
}

function currencyControlText(element) {
  return `${element.innerText || ""} ${element.textContent || ""} ${element.getAttribute("aria-label") || ""}`
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function activateSafeControl(element) {
  element.scrollIntoView({ block: "center", inline: "center" });
  element.focus({ preventScroll: true });
  if (element instanceof HTMLAnchorElement && isHyattNavigationHref(element.href)) {
    location.assign(element.href);
    return;
  }
  const eventOptions = { bubbles: true, cancelable: true, composed: true, view: window };
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup"]) {
    const EventType = type.startsWith("pointer") && typeof PointerEvent !== "undefined" ? PointerEvent : MouseEvent;
    element.dispatchEvent(new EventType(type, eventOptions));
  }
  element.click();
}

function isHyattNavigationHref(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && /(^|\.)hyatt\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

async function waitForReadablePage(timeoutMs) {
  return waitForCondition(
    () => isReadableSnapshot({ pageText: pageText(), pageTitle: document.title || "" }),
    timeoutMs
  );
}

function isReadableSnapshot(snapshot) {
  return String(snapshot?.pageText || "").length > 80;
}

async function waitForText(pattern, timeoutMs) {
  return waitForCondition(() => pattern.test(pageText()), timeoutMs);
}

async function waitForElement(find, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const result = find();
    if (result) {
      return result;
    }
    await delay(250);
  }
  return null;
}

async function waitForCondition(check, timeoutMs) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return true;
    }
    await delay(300);
  }
  return false;
}

function pageText() {
  return document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
}

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim().replace(/\/+$/, "");
  return endpoint.startsWith("http://localhost:") || endpoint.startsWith("http://127.0.0.1:") ? endpoint : "";
}

function cssEscape(value) {
  return globalThis.CSS?.escape ? globalThis.CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function showStatus(message) {
  let status = document.querySelector("#tripbuddy-browser-status");
  if (!status) {
    status = document.createElement("div");
    status.id = "tripbuddy-browser-status";
    Object.assign(status.style, {
      background: "#172554",
      borderRadius: "8px",
      bottom: "16px",
      boxShadow: "0 8px 24px rgba(0,0,0,.25)",
      color: "white",
      font: "13px/1.4 system-ui, sans-serif",
      maxWidth: "360px",
      padding: "12px 14px",
      position: "fixed",
      right: "16px",
      whiteSpace: "pre-wrap",
      zIndex: "2147483647"
    });
    document.documentElement.append(status);
  }
  status.textContent = message;
}
