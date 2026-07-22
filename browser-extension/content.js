const TRIPBUDDY_AUTO_IMPORT_FLAG = "tripbuddyAutoImportedUrl";
const TRIPBUDDY_BOOKING_ID_KEY = "tripbuddyBookingId";
const TRIPBUDDY_ENDPOINT_KEY = "tripbuddyEndpoint";
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

  const importKey = `${bookingId}|${location.href}`;
  if (sessionStorage.getItem(TRIPBUDDY_AUTO_IMPORT_FLAG) === importKey) {
    return;
  }

  showTripBuddyStatus("TripBuddy is waiting for hotel rates...");
  const ready = await waitForReadablePage();
  if (!ready) {
    showTripBuddyStatus("TripBuddy could not find readable rate text on this page.");
    return;
  }

  if (!hasFinalTotalToken(getPageText())) {
    await advanceHyattTowardPriceSummary();
  }

  const pageText = buildEvidencePageText();
  const sourceUrl = buildEvidenceSourceUrl();
  sessionStorage.setItem(TRIPBUDDY_AUTO_IMPORT_FLAG, importKey);
  showTripBuddyStatus("TripBuddy is importing this page...");

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

async function advanceHyattTowardPriceSummary() {
  const startedAt = Date.now();
  let roomSelectionClicked = false;
  let ratePlanClicked = false;
  while (Date.now() - startedAt < 90000) {
    const text = getPageText();
    if (hasFinalTotalToken(text)) {
      return true;
    }

    if (!ratePlanClicked && isHyattRatePlanPage(text)) {
      const rateSelection = clickSafeHyattRatePageBook();
      if (rateSelection.clicked) {
        ratePlanClicked = true;
        showTripBuddyStatus("TripBuddy selected the rate plan and is waiting for the final price summary...");
        await new Promise((resolve) => setTimeout(resolve, 2500));
        continue;
      }
    }

    if (!roomSelectionClicked && hasRoomListRateToken(text)) {
      rememberHyattRoomListText(text);
      const selection = clickLowestSafeHyattRate();
      if (selection.clicked) {
        roomSelectionClicked = true;
        showTripBuddyStatus("TripBuddy selected a rate and is waiting for the rate plan...");
        await new Promise((resolve) => setTimeout(resolve, 2500));
        continue;
      }
      showTripBuddyStatus(`TripBuddy could not select a rate safely. Importing visible estimated rates. ${selection.reason}`);
      return false;
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

async function waitForFinalTotalPage() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    const text = getPageText();
    if (text.length > 1000 && hasFinalTotalToken(text)) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

function hasRateToken(text) {
  return new RegExp(`(?:${CASH_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i").test(text) ||
    /[0-9][0-9,]{3,8}\s*(?:points|pts)/i.test(text) ||
    /Total Cash|Price Summary|Stay Total|Total for Stay|Grand Total|Amount Due/i.test(text);
}

function hasFinalTotalToken(text) {
  return /Total Cash|Price Summary|Stay Total|Total for Stay|Grand Total|Amount Due|Taxes?\s*(?:&|and)\s*Fees?/i.test(text);
}

function hasRoomListRateToken(text) {
  return new RegExp(`(?:${CASH_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i").test(text) ||
    /[0-9][0-9,]{3,8}\s*(?:points|pts)/i.test(text);
}

function hasHyattBookingSurface(text) {
  return /Select\s*&\s*Book|Choose Your Rate|View Room Details|Member Rate|Standard Rate|Award Category|Rooms\s*\(\d+\)|Suites\s*\(\d+\)/i.test(text) ||
    hasSafeRateSelectionControl();
}

function hasHyattPageShell(text) {
  return /Hyatt|World of Hyatt|Find Hotels|Rooms|Rates|View Room Details|Select/i.test(text);
}

function isHyattRatePlanPage(text) {
  return /Choose Your Rate|Cancellation Policy|Deposit Policy/i.test(text) && !hasFinalTotalToken(text);
}

function getPageText() {
  return document.body?.innerText?.replace(/\s+/g, " ").trim() || "";
}

function clickLowestSafeHyattRate() {
  const text = getPageText();
  if (/payment|pay now|confirm|purchase|place order|complete reservation|submit payment/i.test(text)) {
    return { clicked: false, reason: "Current page looks like a final booking step." };
  }

  const controls = Array.from(document.querySelectorAll("button,a,[role='button']")).filter((element) => {
    const label = getElementText(element);
    return /^(select|select\s*&\s*book|book)$/i.test(label) && !/(payment|pay|confirm|purchase|place order|complete reservation|book now)/i.test(label);
  });
  const candidates = controls
    .map((control) => {
      const context = findRateContext(control);
      const amount = extractNightlyAmount(context);
      return amount === null ? null : { amount, context, control };
    })
    .filter(Boolean)
    .sort((a, b) => a.amount - b.amount);

  const selected = candidates[0];
  if (!selected) {
    return { clicked: false, reason: "No visible rate selection button was found." };
  }

  selected.control.scrollIntoView({ behavior: "smooth", block: "center" });
  selected.control.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  selected.control.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));
  selected.control.click();
  return { clicked: true, reason: null };
}

function hasSafeRateSelectionControl() {
  return Array.from(document.querySelectorAll("button,a,[role='button']")).some((element) => {
    const label = getElementText(element);
    return /^(select|select\s*&\s*book|book)$/i.test(label) && !/(payment|pay|confirm|purchase|place order|complete reservation|book now)/i.test(label);
  });
}

function clickSafeHyattRatePageBook() {
  const text = getPageText();
  if (!isHyattRatePlanPage(text)) {
    return { clicked: false, reason: "Current page is not a Hyatt rate selection page." };
  }
  if (/payment|pay now|confirm|purchase|place order|complete reservation|submit payment/i.test(text)) {
    return { clicked: false, reason: "Current page looks like a final booking step." };
  }

  const controls = Array.from(document.querySelectorAll("button,a,[role='button']")).filter((element) => {
    const label = getControlLabel(element);
    return /^(book|select|continue)$/i.test(label) && !isUnsafeBookingControl(label);
  });
  const selected = controls.find((control) => /Cancellation Policy|Deposit Policy|Rate/i.test(findPolicyContext(control)));
  if (!selected) {
    return { clicked: false, reason: "No safe rate-plan book button was found." };
  }

  selected.scrollIntoView({ behavior: "smooth", block: "center" });
  selected.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  selected.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));
  selected.click();
  return { clicked: true, reason: null };
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

function isUnsafeBookingControl(label) {
  return /(payment|pay now|confirm|purchase|place order|complete reservation|submit payment|complete booking|finalize)/i.test(label);
}

function findPolicyContext(control) {
  let container = control;
  for (let index = 0; index < 10 && container; index += 1) {
    const text = getElementText(container);
    if (/Cancellation Policy|Deposit Policy|Rate/i.test(text)) {
      return text;
    }
    container = container.parentElement;
  }
  return "";
}

function findRateContext(control) {
  let container = control;
  for (let index = 0; index < 10 && container; index += 1) {
    const text = getElementText(container);
    if (new RegExp(`(?:${CASH_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i").test(text)) {
      return text;
    }
    container = container.parentElement;
  }
  return "";
}

function extractNightlyAmount(text) {
  const match = text.match(new RegExp(`(?:${CASH_CURRENCY_PATTERN})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i"));
  return match ? Number(match[1].replace(/,/g, "")) : null;
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
