import safetyRules from "@extension/safetyRules.js";
import { HYATT_CURRENCY_PATTERN } from "@/lib/providers/hyattCurrency";
import { isHyattHotelPageUrl } from "@/lib/providers/hyattUrls";

const { isUnsafeBookingControl } = safetyRules;

export type BrowserAgentControlSnapshot = {
  context?: string | null;
  elementId: string;
  href?: string | null;
  label: string;
  /** Toggle state; null when the control is not a toggle at all. */
  pressed?: boolean | null;
};

export type BrowserAgentSnapshot = {
  bookingId?: string | null;
  controls?: BrowserAgentControlSnapshot[];
  pageText?: string | null;
  pageTitle?: string | null;
  sourceUrl?: string | null;
  targetHotelName?: string | null;
  /** Whether this leg of the run is the one that owes an award rate. */
  wantsAwardRates?: boolean;
};

export type BrowserAgentAction =
  | { action: "click"; elementId: string; reason: string; rememberRoomList?: boolean }
  | { action: "import"; reason: string }
  /**
   * Go to a URL this product built, in the tab the task already owns.
   *
   * Only ever a URL the server composed from the booking, never one read off
   * the page: navigation the page can choose is navigation an attacker can
   * choose. The task itself survives because it lives in tab session storage,
   * which is how the existing click-through and auto-reload already resume.
   */
  | { action: "navigate"; reason: string; url: string }
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
      withCardText(controls.filter((control) => isHyattRatePlanBookControl(control.label)), pageText).filter((control) =>
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

  /*
   * Points are a switch on the page, not a parameter in the URL.
   *
   * A real run settled this: the rooms page was opened with `usePoints=true`
   * and rendered cash anyway, while the visible text carried a "Use Points"
   * control that nothing had pressed. So the mode is only ever entered by
   * pressing it, and only while it is off — pressing an already-on switch
   * would put the run back into cash and quietly return the wrong inventory.
   */
  if (hasRoomListRateToken(pageText)) {
    const wantsAward = snapshot.wantsAwardRates === true;
    const pointsToggle = controls.find(
      (control) => isHyattUsePointsControl(control.label) && control.pressed === !wantsAward
    );
    if (pointsToggle) {
      /*
       * Both directions. Hyatt remembers the switch across navigation, so the
       * cash leg arrived at a room list still showing points, walked an award
       * card, and stopped on the rate control Hyatt greys out for anonymous
       * redemption — a cash check that returned no cash at all.
       */
      return {
        action: "click",
        elementId: pointsToggle.elementId,
        reason: wantsAward
          ? "Switch Hyatt's visible room rates to points."
          : "Switch Hyatt's visible room rates back to cash."
      };
    }
  }

  if (hasRoomListRateToken(pageText)) {
    /*
     * Rank by whatever unit the page is quoting. A points room list prints no
     * cash amount at all, so ranking only by cash found nothing to click and
     * the run sat on the room list until it timed out — with the switch
     * correctly flipped and the award rates plainly on screen.
     */
    const selectControls = withCardText(
      controls.filter((control) => isHyattRoomRateSelectControl(control.label)),
      pageText
    );
    const roomRate =
      chooseLowestAmountControl(
        selectControls,
        new RegExp(`(?:${HYATT_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i")
      ) ??
      chooseLowestAmountControl(
        selectControls,
        new RegExp(HYATT_POINTS_RATE_PATTERN, "i"),
        () => 0,
        extractLowestPointsAmount
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

/**
 * Widens each control's context to the card it belongs to.
 *
 * The extension climbs at most four ancestors and returns the first whose text
 * clears twenty characters, which on Hyatt's room list lands on the wrapper
 * holding `Excludes tax & service charges SELECT & BOOK` — a context with no
 * price in it. Every control was then discarded for having no amount to rank,
 * the planner reported that it was waiting for selectable rates, and the task
 * spent its budget on a page that was already finished.
 *
 * The same wrapper hides the rate dialog's tokens from the rate-plan branch,
 * which is why both branches widen before they filter.
 *
 * A length floor cannot express what this context is for. What is needed is the
 * text a control is scoped to, so each control takes the page text running from
 * the end of the previous control's occurrence to the end of its own. That is
 * one card by construction: it cannot reach a neighbour's price, and identical
 * contexts — every card here says exactly the same thing — stay distinguishable
 * because occurrences are consumed in order.
 */
function withCardText(controls: BrowserAgentControlSnapshot[], pageText: string) {
  /* Identical contexts are consumed in order; that is the only sensible mapping. */
  const cursors = new Map<string, number>();
  const located = controls.map((control) => {
    const context = compact(control.context);
    const start = pageText.indexOf(context, cursors.get(context) ?? 0);
    if (start >= 0) {
      cursors.set(context, start + context.length);
    }
    return { control, end: start + context.length, start };
  });

  /*
   * The window opens at the nearest control that ends before this one begins,
   * found by position rather than by array order — the snapshot does not
   * promise that controls arrive in the order the page renders them.
   */
  const boundaries = located.filter((item) => item.start >= 0).map((item) => item.end).sort((a, b) => a - b);
  return located.map(({ control, end, start }) => {
    if (start < 0) {
      return control;
    }
    const opensAt = boundaries.filter((boundary) => boundary <= start).pop() ?? 0;
    return { ...control, context: pageText.slice(opensAt, end).trim() };
  });
}

function chooseLowestAmountControl(
  controls: BrowserAgentControlSnapshot[],
  requiredContextPattern: RegExp,
  priority: (control: BrowserAgentControlSnapshot) => number = () => 0,
  /* Cash by default. A points room list quotes no currency at all, so reading
   * the amount has to follow whichever unit the page is actually using. */
  extractAmount: (text: string) => number | null = extractLowestAmount
) {
  return controls
    .map((control) => {
      const context = compact(control.context);
      if (!requiredContextPattern.test(context)) {
        return null;
      }
      const amount = extractAmount(`${control.label} ${context}`);
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

/*
 * Deliberately narrow. This control changes what inventory the whole run
 * reports, so a loose match ("points" appears in Hyatt's marketing copy and in
 * its search placeholder text) would be a way to press the wrong thing.
 */
export function isHyattUsePointsControl(label: string) {
  return /^(?:use\s+points|points)$/i.test(compact(label));
}

function isHyattEmptySnapshot(snapshot: BrowserAgentSnapshot) {
  return /hyatt\.com/i.test(snapshot.sourceUrl ?? "") && !snapshot.pageTitle && compact(snapshot.pageText).length === 0;
}

/** The points unit Hyatt's room list actually prints beside an award rate. */
const HYATT_POINTS_RATE_PATTERN = `[0-9][0-9,]{3,8}(?:.{0,40}?Points\\s*\\/\\s*Night|\\s*(?:points|pts))`;

function hasRoomListRateToken(text: string) {
  return new RegExp(`(?:${HYATT_CURRENCY_PATTERN})\\s*[0-9][0-9,]*(?:\\.\\d{2})?\\s*(?:Avg\\s*\\/\\s*Night|Average\\s*\\/\\s*Night|per\\s*night|\\/\\s*night)`, "i").test(text) ||
    new RegExp(HYATT_POINTS_RATE_PATTERN, "i").test(text);
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

/*
 * Anchored on "Points/Night" rather than on any four-digit number: a room card
 * also carries square metres, review counts and a rate count.
 */
function extractLowestPointsAmount(text: string) {
  const pattern = new RegExp(`([0-9][0-9,]{3,8})(?=.{0,40}?Points\\s*\\/\\s*Night)|([0-9][0-9,]{3,8})\\s*(?:points|pts)`, "gi");
  const amounts = [...text.matchAll(pattern)]
    .map((match) => Number((match[1] ?? match[2]).replace(/,/g, "")))
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
