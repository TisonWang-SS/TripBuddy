import safetyRules from "@extension/safetyRules.js";
import { HYATT_CURRENCY_PATTERN } from "@/lib/providers/hyattCurrency";
import { isHyattHotelPageUrl } from "@/lib/providers/hyattUrls";

const { isUnsafeBookingControl } = safetyRules;

export type BrowserAgentControlSnapshot = {
  context?: string | null;
  elementId: string;
  href?: string | null;
  label: string;
};

export type BrowserAgentSnapshot = {
  bookingId?: string | null;
  controls?: BrowserAgentControlSnapshot[];
  pageText?: string | null;
  pageTitle?: string | null;
  sourceUrl?: string | null;
  targetHotelName?: string | null;
};

export type BrowserAgentAction =
  | { action: "click"; elementId: string; reason: string; rememberRoomList?: boolean }
  | { action: "import"; reason: string }
  | { action: "stop"; reason: string }
  | { action: "wait"; milliseconds: number; reason: string };

export function planBrowserAgentAction(snapshot: BrowserAgentSnapshot): BrowserAgentAction {
  const sourceUrl = snapshot.sourceUrl ?? "";
  const pageText = compact(snapshot.pageText);
  const controls = (snapshot.controls ?? []).filter((control) => control.elementId && compact(control.label));
  const targetHotelName = compact(snapshot.targetHotelName);

  if (isHyattEmptySnapshot(snapshot)) {
    return { action: "stop", reason: "Hyatt returned an empty page document." };
  }

  if (hasFinalTotalToken(pageText)) {
    return { action: "import", reason: "Final Hyatt price summary with a total was detected." };
  }

  if (isHyattSearchUrl(sourceUrl)) {
    const hotelResult = chooseHyattSearchResult(controls, targetHotelName, pageText);
    if (hotelResult) {
      return { action: "click", elementId: hotelResult.elementId, reason: "Open the matching Hyatt View Rates result." };
    }
    if (targetHotelName) {
      const normalizedTarget = normalizeComparableName(targetHotelName);
      const targetCardIsVisible = normalizeComparableName(pageText).includes(normalizedTarget);
      const rateControlsAreVisible = controls.some(isHyattRatesResultControl);
      if (targetCardIsVisible || !rateControlsAreVisible) {
        return {
          action: "wait",
          milliseconds: 1500,
          reason: "Waiting for Hyatt's View Rates control to finish loading."
        };
      }
      return { action: "stop", reason: `No matching Hyatt View Rates result was found for ${targetHotelName}.` };
    }
    return { action: "wait", milliseconds: 1500, reason: "Waiting for Hyatt search results." };
  }

  if (isHyattRatePlanPage(pageText)) {
    const ratePlan = chooseLowestAmountControl(
      controls.filter(
        (control) =>
          isHyattRatePlanBookControl(control.label) &&
          /Choose Your Rate|Cancellation Policy|Deposit Policy/i.test(compact(control.context))
      ),
      /Choose Your Rate|Cancellation Policy|Deposit Policy/i,
      ratePlanContinuePriority
    );
    if (ratePlan) {
      return { action: "click", elementId: ratePlan.elementId, reason: "Select the lowest visible Hyatt rate plan." };
    }
    const selectedRateContinue = controls.find(
      (control) => /^book now$/i.test(compact(control.label)) && !isUnsafeBookingControl(control.label)
    );
    if (selectedRateContinue) {
      return {
        action: "click",
        elementId: selectedRateContinue.elementId,
        reason: "Continue with Hyatt's visibly selected rate plan."
      };
    }
    return { action: "wait", milliseconds: 1500, reason: "Waiting for selectable Hyatt rate plans." };
  }

  if (isHyattCartOrSummaryPage(sourceUrl, pageText)) {
    const cartControl = controls.find(
      (control) =>
        isHyattCartContinueControl(control.label) &&
        /My Cart|Booking Summary|Your Stay|Room total|Night Stay|Trip Total|Price Summary/i.test(compact(control.context))
    );
    if (cartControl) {
      return { action: "click", elementId: cartControl.elementId, reason: "Continue from Hyatt cart toward the final price summary." };
    }
    return { action: "wait", milliseconds: 1500, reason: "Waiting for a safe Hyatt cart continue control." };
  }

  if (hasRoomListRateToken(pageText)) {
    const roomRate = chooseLowestAmountControl(
      controls.filter((control) => isHyattRoomRateSelectControl(control.label)),
      new RegExp(`(?:${HYATT_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i")
    );
    if (roomRate) {
      return { action: "click", elementId: roomRate.elementId, reason: "Select the lowest visible Hyatt room rate.", rememberRoomList: true };
    }
    return { action: "wait", milliseconds: 1500, reason: "Waiting for selectable Hyatt room rates." };
  }

  return { action: "wait", milliseconds: 1500, reason: "Waiting for Hyatt booking content." };
}

function chooseHyattSearchResult(controls: BrowserAgentControlSnapshot[], targetHotelName: string, pageText: string) {
  const target = normalizeComparableName(targetHotelName);
  if (!target) {
    return null;
  }

  const rateControls = controls.filter(isHyattRatesResultControl);
  const contextualMatch = rateControls
    .map((control) => {
      const score = scoreHotelResultControl(control, target);
      return score > 0 ? { ...control, score } : null;
    })
    .filter((control): control is BrowserAgentControlSnapshot & { score: number } => control !== null)
    .sort((a, b) => b.score - a.score)[0];

  return contextualMatch ?? chooseRatesControlByPageOrder(rateControls, target, pageText);
}

function scoreHotelResultControl(control: BrowserAgentControlSnapshot, normalizedTarget: string) {
  const haystack = normalizeComparableName(`${control.context ?? ""} ${control.href ?? ""}`);
  if (!haystack || !normalizedTarget) {
    return 0;
  }
  if (haystack.includes(normalizedTarget)) {
    return 3;
  }

  const targetTokens = normalizedTarget.split(" ").filter((token) => token.length > 2);
  if (targetTokens.length >= 2 && targetTokens.every((token) => haystack.includes(token))) {
    return 2;
  }
  return 0;
}

function chooseRatesControlByPageOrder(
  rateControls: BrowserAgentControlSnapshot[],
  normalizedTarget: string,
  pageText: string
) {
  if (!normalizedTarget || rateControls.length === 0) {
    return null;
  }

  const comparablePage = normalizeComparableName(pageText);
  let targetIndex = comparablePage.indexOf(normalizedTarget);
  while (targetIndex >= 0) {
    const followingText = comparablePage.slice(targetIndex + normalizedTarget.length);
    if (/\bview rates?\b/.test(followingText)) {
      const precedingRateCount = (comparablePage.slice(0, targetIndex).match(/\bview rates?\b/g) ?? []).length;
      if (precedingRateCount < rateControls.length) {
        return rateControls[precedingRateCount];
      }
    }
    targetIndex = comparablePage.indexOf(normalizedTarget, targetIndex + normalizedTarget.length);
  }

  if (rateControls.length === 1 && comparablePage.includes(normalizedTarget)) {
    return rateControls[0];
  }
  return null;
}

function chooseLowestAmountControl(
  controls: BrowserAgentControlSnapshot[],
  requiredContextPattern: RegExp,
  priority: (control: BrowserAgentControlSnapshot) => number = () => 0
) {
  return controls
    .map((control) => {
      const context = compact(control.context);
      if (!requiredContextPattern.test(context)) {
        return null;
      }
      const amount = extractLowestAmount(`${control.label} ${context}`);
      return amount === null ? null : { ...control, amount, priority: priority(control) };
    })
    .filter((control): control is BrowserAgentControlSnapshot & { amount: number; priority: number } => control !== null)
    .sort((a, b) => a.amount - b.amount || b.priority - a.priority)[0] ?? null;
}

function ratePlanContinuePriority(control: BrowserAgentControlSnapshot) {
  if (/join while you book/i.test(control.label)) {
    return 2;
  }
  if (/sign in/i.test(control.label)) {
    return 0;
  }
  return 1;
}

function isHyattSearchUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    return /(^|\.)hyatt\.com$/i.test(url.hostname) && /\/search\/hotels\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function isHyattEmptySnapshot(snapshot: BrowserAgentSnapshot) {
  return /hyatt\.com/i.test(snapshot.sourceUrl ?? "") && !snapshot.pageTitle && compact(snapshot.pageText).length === 0;
}

function hasRoomListRateToken(text: string) {
  return new RegExp(`(?:${HYATT_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i").test(text) ||
    /[0-9][0-9,]{3,8}\s*(?:points|pts)/i.test(text);
}

function hasFinalTotalToken(text: string) {
  const currencyAmount = `(?:${HYATT_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?`;
  return new RegExp(`(?:Total\\s+Cash|Stay\\s+Total|Total\\s+for\\s+Stay|Grand\\s+Total|Amount\\s+Due|Total\\s+Including\\s+Taxes[^A-Z]{0,40})\\s*${currencyAmount}`, "i").test(text) ||
    new RegExp(`${currencyAmount}\\s*(?:Total\\s+Cash|Stay\\s+Total|Total\\s+for\\s+Stay|Grand\\s+Total|Amount\\s+Due)`, "i").test(text) ||
    new RegExp(`(?:Price\\s+Summary|Booking\\s+Summary)[^]{0,800}(?:Grand\\s+Total|(?<!Room\\s)Total)\\s*${currencyAmount}`, "i").test(text);
}

function isHyattRatePlanPage(text: string) {
  return /Choose Your Rate|Cancellation Policy|Deposit Policy|JOIN WHILE YOU BOOK|SIGN IN & BOOK/i.test(text) && !hasFinalTotalToken(text);
}

function isHyattCartOrSummaryPage(sourceUrl: string, text: string) {
  let bookingPath = false;
  try {
    bookingPath = /\/(?:booking|payment|checkout|cart)(?:\/|$)/i.test(new URL(sourceUrl).pathname);
  } catch {
    bookingPath = false;
  }
  return bookingPath &&
    /My Cart|Booking Summary|Your Stay|Room total|Night Stay|Trip Total|Price Summary/i.test(text) &&
    !hasFinalTotalToken(text);
}

/**
 * A search-result control is recognised by where it goes, not by what it says.
 *
 * Matching the label alone was a silent trap: signed out, Hyatt words this
 * control differently, so the allowlist missed it, `rateControlsAreVisible`
 * came back false, and the planner returned `wait` — believing the page was
 * still loading — until the task timed out on the search results page. A
 * failure that looks like slowness rather than like a mismatch.
 *
 * The destination does not move with sign-in state or with Hyatt's copy, and
 * adding each new wording to a list is the kind of maintenance that quietly
 * falls behind the site. The label still counts, as a second signal for a
 * control whose href a snapshot did not capture.
 */
function isHyattRatesResultControl(control: BrowserAgentControlSnapshot) {
  const value = `${control.label} ${control.href ?? ""}`;
  if (/hotel website|website|hotel info|hotel-info/i.test(value)) {
    return false;
  }
  if (isUnsafeBookingControl(control.label)) {
    return false;
  }
  return isHyattHotelPageUrl(control.href) || /\bview rates?\b|\brates?\b/i.test(control.label);
}

/**
 * A room-card control that opens that room's rates.
 *
 * Signed out, Hyatt labels these `Book Now` — the same words the rate dialog
 * uses for its continue control, which is why they were excluded here. That
 * exclusion is unnecessary and was load-bearing in the wrong direction: the
 * rate-dialog branch is tested before this one and returns, so a `Book Now`
 * reaching a room card cannot belong to a dialog. Excluding it left a signed-out
 * room list with no selectable control at all, and the planner read that as a
 * page still loading rather than as a mismatch — the tax-inclusive upgrade
 * spent its whole budget waiting on a page that was already finished.
 *
 * `Sign In & Book` and `Join While You Book` stay excluded. Those do not open a
 * room's rates; they start an account flow this product does not perform.
 */
function isHyattRoomRateSelectControl(label: string) {
  return /\b(?:select|select\s*&\s*book|book)\b/i.test(label) &&
    !/\b(?:sign in\s*&\s*book|join while you book)\b/i.test(label) &&
    !isUnsafeBookingControl(label);
}

function isHyattRatePlanBookControl(label: string) {
  return (/\b(?:book|continue)\b/i.test(label) || /^(?:select|select\s*&\s*book)$/i.test(label)) && !isUnsafeBookingControl(label);
}

function isHyattCartContinueControl(label: string) {
  return (
    /\b(?:continue|checkout|check out|booking summary)\b/i.test(label) ||
    /\breview\s+(?:booking|reservation|summary)\b/i.test(label)
  ) && !isUnsafeBookingControl(label);
}

function extractLowestAmount(text: string) {
  const pattern = new RegExp(`(?:${HYATT_CURRENCY_PATTERN})\\s*([0-9][0-9,]*(?:\\.\\d{2})?)`, "gi");
  const amounts = [...text.matchAll(pattern)]
    .map((match) => Number(match[1].replace(/,/g, "")))
    .filter((amount) => Number.isFinite(amount));
  return amounts.length > 0 ? Math.min(...amounts) : null;
}

function normalizeComparableName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compact(value?: string | null) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
