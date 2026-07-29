const TRIPBUDDY_AUTO_IMPORT_FLAG = "tripbuddyAutoImportedUrl";
const TRIPBUDDY_BOOKING_ID_KEY = "tripbuddyBookingId";
const TRIPBUDDY_ENDPOINT_KEY = "tripbuddyEndpoint";
const TRIPBUDDY_RUN_NONCE_KEY = "tripbuddyRunNonce";
const TRIPBUDDY_ROOM_LIST_TEXT_KEY = "tripbuddyHyattRoomListText";
const TRIPBUDDY_SOURCE_URL_KEY = "tripbuddyHyattSourceUrl";
const CASH_CURRENCY_PATTERN =
  "US\\$|USD|CA\\$|CAD|A\\$|AUD|HK\\$|HKD|S\\$|SGD|MYR|RM|JPY|¥|￥|CN¥|CNY|RMB|EUR|€|GBP|£|THB|฿|KRW|₩|\\$";

runTripBuddyAutoImport();

async function runTripBuddyAutoImport() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ""));
  const hashBookingId = params.get("tripbuddyBookingId") || params.get("tbBookingId");
  if (hashBookingId) {
    sessionStorage.setItem(TRIPBUDDY_BOOKING_ID_KEY, hashBookingId);
  }
  const bookingId = hashBookingId || sessionStorage.getItem(TRIPBUDDY_BOOKING_ID_KEY);
  if (!bookingId) {
    return;
  }
  const hashRunNonce = params.get("tripbuddyRunNonce");
  if (hashRunNonce) {
    sessionStorage.setItem(TRIPBUDDY_RUN_NONCE_KEY, hashRunNonce);
  }
  rememberHyattSourceUrl(location.href);

  const stored = await chrome.storage.local.get(["endpoint"]);
  const hashEndpoint = params.get("tripbuddyEndpoint");
  if (hashEndpoint) {
    sessionStorage.setItem(TRIPBUDDY_ENDPOINT_KEY, hashEndpoint);
  }
  const endpoint = normalizeEndpoint(hashEndpoint || sessionStorage.getItem(TRIPBUDDY_ENDPOINT_KEY) || stored.endpoint || "http://localhost:3000");
  if (!endpoint) {
    showTripBuddyStatus("TripBuddy auto import skipped: invalid local endpoint.");
    return;
  }

  const runNonce = hashRunNonce || sessionStorage.getItem(TRIPBUDDY_RUN_NONCE_KEY);
  const importKey = `${bookingId}|${runNonce || location.href}`;
  if (sessionStorage.getItem(TRIPBUDDY_AUTO_IMPORT_FLAG) === importKey) {
    return;
  }

  showTripBuddyStatus("TripBuddy is waiting for hotel rates...");
  const ready = await waitForReadablePage();
  if (!ready) {
    showTripBuddyStatus(
      isHyattEmptyDocument()
        ? "TripBuddy found an empty Hyatt page. Fully quit Chrome, reopen it, then retry this import."
        : "TripBuddy could not find readable rate text on this page."
    );
    return;
  }

  if (!hasFinalTotalToken(getPageText())) {
    const bridgeHandled = await runBrowserAgentBridge(endpoint, bookingId, importKey);
    if (!bridgeHandled) {
      showTripBuddyStatus("TripBuddy could not reach the local browser agent. Import stopped before saving incomplete Hyatt rates.");
    }
    return;
  }

  const pageText = buildEvidencePageText();
  const sourceUrl = buildEvidenceSourceUrl();
  if (!isImportableHyattEvidence(pageText)) {
    showTripBuddyStatus("TripBuddy did not reach a Hyatt price summary. Import stopped so incomplete rate text is not saved.");
    return;
  }
  await importCurrentHyattEvidence(endpoint, bookingId, importKey);
}

async function importCurrentHyattEvidence(endpoint, bookingId, importKey) {
  sessionStorage.setItem(TRIPBUDDY_AUTO_IMPORT_FLAG, importKey);
  showTripBuddyStatus("TripBuddy is importing this page...");
  const pageText = buildEvidencePageText();
  const sourceUrl = buildEvidenceSourceUrl();
  try {
    const response = await fetch(`${endpoint}/api/browser-evidence`, {
      body: JSON.stringify({
        bookingId,
        capturedAt: new Date().toISOString(),
        hotelGroup: "Hyatt",
        pageText,
        pageTitle: document.title,
        sourceUrl
      }),
      headers: {
        "Content-Type": "application/json"
      },
      method: "POST"
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || `Import failed with status ${response.status}.`);
    }
    showTripBuddyStatus(`TripBuddy imported ${result.candidatesImported} candidate rate${result.candidatesImported === 1 ? "" : "s"}.`);
  } catch (error) {
    showTripBuddyStatus(error instanceof Error ? `TripBuddy import failed: ${error.message}` : "TripBuddy import failed.");
    sessionStorage.removeItem(TRIPBUDDY_AUTO_IMPORT_FLAG);
  }
}

async function runBrowserAgentBridge(endpoint, bookingId, importKey) {
  const startedAt = Date.now();
  let lastActionKey = "";
  let repeatedActionCount = 0;

  while (Date.now() - startedAt < 90000) {
    rememberHyattSourceUrl(location.href);
    const snapshot = buildBrowserAgentSnapshot(bookingId);
    let action;
    try {
      const response = await fetch(`${endpoint}/api/browser-agent/snapshot`, {
        body: JSON.stringify(snapshot),
        headers: {
          "Content-Type": "application/json"
        },
        method: "POST"
      });
      if (!response.ok) {
        return false;
      }
      action = await response.json();
    } catch {
      return false;
    }

    if (!action || typeof action.action !== "string") {
      return false;
    }

    const actionKey = `${action.action}|${action.elementId ?? ""}|${location.href}`;
    repeatedActionCount = actionKey === lastActionKey ? repeatedActionCount + 1 : 0;
    lastActionKey = actionKey;
    if (repeatedActionCount > 3) {
      showTripBuddyStatus(`TripBuddy stopped because Hyatt did not respond to: ${action.reason || "the selected browser action"}.`);
      return true;
    }

    if (action.action === "import") {
      const pageText = buildEvidencePageText();
      if (!isImportableHyattEvidence(pageText)) {
        showTripBuddyStatus("TripBuddy stopped because the browser agent requested an import before a final Hyatt total was visible.");
        return true;
      }
      await importCurrentHyattEvidence(endpoint, bookingId, importKey);
      return true;
    }

    if (action.action === "stop") {
      showTripBuddyStatus(`TripBuddy stopped before importing: ${action.reason || "No safe browser-agent action was available."}`);
      return true;
    }

    if (action.action === "wait") {
      showTripBuddyStatus(`TripBuddy is waiting: ${action.reason || "Hyatt content is still loading."}`);
      await new Promise((resolve) => setTimeout(resolve, Math.max(500, Math.min(Number(action.milliseconds) || 1500, 5000))));
      continue;
    }

    if (action.action === "click" && action.elementId) {
      const element = document.querySelector(`[data-tripbuddy-agent-id="${cssEscape(action.elementId)}"]`);
      if (!element || !isVisibleControl(element)) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        continue;
      }
      if (action.rememberRoomList) {
        rememberHyattRoomListText(getPageText());
      }
      showTripBuddyStatus(`TripBuddy is acting: ${action.reason || "Selecting the next Hyatt control."}`);
      clickBrowserAgentElement(element);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      continue;
    }

    showTripBuddyStatus("TripBuddy stopped because the browser agent returned an unsupported action.");
    return true;
  }

  showTripBuddyStatus("TripBuddy stopped after waiting 90 seconds for Hyatt to reach the final price summary.");
  return true;
}

function buildBrowserAgentSnapshot(bookingId) {
  return {
    bookingId,
    controls: collectBrowserAgentControls(),
    pageText: getPageText().slice(0, 50000),
    pageTitle: document.title,
    sourceUrl: location.href
  };
}

function collectBrowserAgentControls() {
  const controlSelector = "a,button,[role='button']";
  const activeRateSurface = Array.from(document.querySelectorAll("dialog,[role='dialog'],[aria-modal='true']"))
    .find((element) => !element.closest("[inert],[hidden],[aria-hidden='true']") && /Choose Your Rate/i.test(getElementText(element)));
  const prioritizedElements = activeRateSurface
    ? [...activeRateSurface.querySelectorAll(controlSelector), ...document.querySelectorAll(controlSelector)]
    : Array.from(document.querySelectorAll(controlSelector));

  return Array.from(new Set(prioritizedElements))
    .filter((element) => isVisibleControl(element))
    .map((element, index) => {
      const elementId = ensureBrowserAgentElementId(element, index);
      return {
        context: findBrowserAgentContext(element),
        elementId,
        href: element.href || element.getAttribute("href") || null,
        label: getControlLabel(element)
      };
    })
    .filter((control) => control.label && control.context && control.elementId)
    .slice(0, 180);
}

function ensureBrowserAgentElementId(element, index) {
  const existing = element.getAttribute("data-tripbuddy-agent-id");
  if (existing) {
    return existing;
  }
  const elementId = `tba-${Date.now().toString(36)}-${index.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  element.setAttribute("data-tripbuddy-agent-id", elementId);
  return elementId;
}

function findBrowserAgentContext(element) {
  let container = element;
  let bestText = "";
  for (let index = 0; index < 10 && container; index += 1) {
    const text = getElementText(container);
    if (text.length > bestText.length) {
      bestText = text;
    }
    const hasPriceOrStage =
      new RegExp(`(?:${CASH_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?`, "i").test(text) ||
      /Choose Your Rate|Price Summary|Booking Summary|Grand Total|Total Cash|View Rates|Hotel Website/i.test(text);
    if (
      text.length > 30 &&
      text.length < 2600 &&
      hasPriceOrStage &&
      /Hyatt|Rate|Rates|Avg|Night|Room|Suite|Cart|Summary|Total|Book|Select|Continue/i.test(text)
    ) {
      return text.slice(0, 2600);
    }
    container = container.parentElement;
  }
  return bestText.slice(0, 2600);
}

function clickBrowserAgentElement(element) {
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  element.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));
  const href = element.href || element.getAttribute("href") || "";
  if (href) {
    try {
      const url = new URL(href, location.href);
      if (url.protocol === "https:" || url.protocol === "http:") {
        location.href = url.toString();
        return;
      }
    } catch {
      // Let the native click handle non-standard controls.
    }
  }
  element.click();
}

function cssEscape(value) {
  if (window.CSS?.escape) {
    return window.CSS.escape(value);
  }
  return String(value).replace(/["\\]/g, "\\$&");
}

function normalizeEndpoint(value) {
  const endpoint = String(value || "").trim().replace(/\/+$/, "");
  if (endpoint.startsWith("http://localhost:") || endpoint.startsWith("http://127.0.0.1:")) {
    return endpoint;
  }
  return null;
}

async function waitForReadablePage() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90000) {
    const text = getPageText();
    if (hasFinalTotalToken(text)) {
      return true;
    }
    if (text.length > 80 && hasHyattBookingSurface(text)) {
      return true;
    }
    if (text.length > 300 && (hasRateToken(text) || hasHyattBookingSurface(text))) {
      return true;
    }
    if (Date.now() - startedAt > 20000 && text.length > 1000 && hasHyattPageShell(text)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function rememberHyattRoomListText(text) {
  if (text.length > 1000) {
    sessionStorage.setItem(TRIPBUDDY_ROOM_LIST_TEXT_KEY, text.slice(0, 50000));
  }
}

function rememberHyattSourceUrl(url) {
  if (/checkinDate=|checkoutDate=/i.test(url)) {
    sessionStorage.setItem(TRIPBUDDY_SOURCE_URL_KEY, url);
  }
}

function buildEvidenceSourceUrl() {
  const storedSourceUrl = sessionStorage.getItem(TRIPBUDDY_SOURCE_URL_KEY);
  return storedSourceUrl || location.href;
}

function buildEvidencePageText() {
  const currentText = getPageText();
  const roomListText = sessionStorage.getItem(TRIPBUDDY_ROOM_LIST_TEXT_KEY);
  if (!roomListText || currentText.includes(roomListText.slice(0, 500))) {
    return currentText;
  }
  return `${roomListText} __TRIPBUDDY_FINAL_DETAIL_PAGE__ ${currentText}`;
}

function isImportableHyattEvidence(text) {
  return hasFinalTotalToken(text);
}

function hasRateToken(text) {
  return new RegExp(`(?:${CASH_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i").test(text) ||
    /[0-9][0-9,]{3,8}\s*(?:points|pts)/i.test(text) ||
    /Total Cash|Price Summary|Stay Total|Total for Stay|Grand Total|Amount Due/i.test(text);
}

function hasFinalTotalToken(text) {
  const currencyAmount = `(?:${CASH_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?`;
  return new RegExp(`(?:Total\\s+Cash|Stay\\s+Total|Total\\s+for\\s+Stay|Grand\\s+Total|Amount\\s+Due|Total\\s+Including\\s+Taxes[^A-Z]{0,40})\\s*${currencyAmount}`, "i").test(text) ||
    new RegExp(`${currencyAmount}\\s*(?:Total\\s+Cash|Stay\\s+Total|Total\\s+for\\s+Stay|Grand\\s+Total|Amount\\s+Due)`, "i").test(text) ||
    new RegExp(`(?:Price\\s+Summary|Booking\\s+Summary)[^]{0,800}(?:Grand\\s+Total|(?<!Room\\s)Total)\\s*${currencyAmount}`, "i").test(text);
}

function hasHyattBookingSurface(text) {
  return /Select\s*&\s*Book|Choose Your Rate|View Room Details|Member Rate|Standard Rate|Award Category|Rooms\s*\(\d+\)|Suites\s*\(\d+\)/i.test(text);
}

function hasHyattPageShell(text) {
  return /Hyatt|World of Hyatt|Find Hotels|Rooms|Rates|View Room Details|Select/i.test(text);
}

function isHyattEmptyDocument() {
  if (!/hyatt\.com$/i.test(location.hostname)) {
    return false;
  }
  const html = document.documentElement?.outerHTML || "";
  return (
    !document.title &&
    getPageText().length === 0 &&
    ((html.length < 2000 && document.scripts.length === 0) || /window\.kpsdk|\/ips\.js|x-kpsdk-im/i.test(html))
  );
}

function getPageText() {
  return document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
}

function getControlLabel(element) {
  return [
    element.getAttribute("aria-label") || "",
    element.getAttribute("title") || "",
    getElementText(element)
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function isVisibleControl(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    !element.closest("[inert],[hidden],[aria-hidden='true']") &&
    !element.disabled &&
    element.getAttribute("aria-hidden") !== "true" &&
    element.getAttribute("hidden") === null &&
    style?.display !== "none" &&
    style?.visibility !== "hidden"
  );
}

function getElementText(element) {
  return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
}

function showTripBuddyStatus(message) {
  let element = document.querySelector("#tripbuddy-auto-import-status");
  if (!element) {
    element = document.createElement("div");
    element.id = "tripbuddy-auto-import-status";
    element.style.background = "#172033";
    element.style.borderRadius = "12px";
    element.style.boxShadow = "0 12px 40px rgba(0, 0, 0, 0.25)";
    element.style.color = "white";
    element.style.font = "13px Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    element.style.lineHeight = "1.4";
    element.style.maxWidth = "360px";
    element.style.padding = "12px 14px";
    element.style.position = "fixed";
    element.style.right = "16px";
    element.style.top = "16px";
    element.style.zIndex = "2147483647";
    document.documentElement.appendChild(element);
  }
  element.textContent = message;
}
