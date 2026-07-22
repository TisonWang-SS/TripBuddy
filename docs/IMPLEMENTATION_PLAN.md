# TripBuddy Implementation Plan

## Current Architecture

TripBuddy is a local Next.js App Router application with:

- Prisma Client as the app ORM.
- SQLite as the local database.
- Server actions for mutations.
- A deterministic decision engine in `src/lib/decision.ts`.
- A collector interface in `src/lib/collectors.ts`.
- Manual observations as the current input path.
- Booking detail uses compact observation rows instead of inline edit forms.
- Observation editing is handled on a dedicated edit page.
- Observation deletion is available from the booking detail list.

The next implementation should preserve the current local-first architecture and make automated price checks a primary booking workflow behind a group-specific tool abstraction.

## v0.2 Key Changes: Booking-Driven Automated Query + Evidence

### Data Model

Add structured evidence fields without removing existing observations immediately.

Recommended new models:

- `WatchPlan`
  - `id`
  - `bookingId`
  - `enabled`
  - `cashEnabled`
  - `awardEnabled`
  - `directEnabled`
  - `otaReferenceEnabled`
  - `browserMode`: `chrome_profile`, `headless`, `interactive`
  - `normalCadenceHours`
  - `urgentCadenceHours`
  - `urgentWindowHours`
  - `lastCheckedAt`

- `PriceCheckRun`
  - `id`
  - `bookingId`
  - `watchPlanId`
  - `startedAt`
  - `finishedAt`
  - `status`: `running`, `succeeded`, `partial`, `failed`
  - `trigger`: `manual`, `scheduled`
  - `inventoryTypesJson`
  - `collectorName`
  - `sourceUrl`

Recommended additions to `UserProfile`:

- `chromeProfileName`
- `chromeProfileDirectory`
- `chromeUserDataDir`
- `chromeDebugPort`
  - `summary`
  - `errorMessage`

- `ObservationEvidence`
  - `id`
  - `observationId`
  - `collectionMethod`: `automated`, `manual`
  - `sourceVerified`
  - `loginState`: `not_required`, `anonymous`, `member`, `unknown`
  - `roomMatch`: `exact`, `similar`, `unknown`
  - `roomMatchReason`
  - `cancellationMatch`: `same_or_better`, `worse`, `unknown`
  - `cancellationMatchReason`
  - `taxesIncluded`: `yes`, `no`, `unknown`
  - `feesIncluded`: `yes`, `no`, `unknown`
  - `loyaltyEligibility`: `eligible`, `not_eligible`, `unknown`
  - `promotionApplicability`: `applies`, `does_not_apply`, `unknown`
  - `currencyMatch`
  - `qualityLevel`: `high`, `medium`, `low`, `needs_review`
  - `blockersJson`
  - `warningsJson`
  - `rawSnapshotJson`

Recommended additions to `PriceObservation`:

- `priceCheckRunId`
- `collectedBy`: `manual`, `collector`
- `collectorName`
- `inventoryType`: `cash`, `award`
- `pointsPrice`
- `cashCopay`
- `rawRateName`
- `ratePlanName`
- `taxAmount`
- `feeAmount`
- `totalPrice`
- `basePrice`

The existing `confidence` field should remain internal for compatibility but should not appear in the UI.

### Group Tool Interface

Each hotel group should be represented as a separate tool behind a shared interface. The app should select the correct tool by `hotelGroup`, then pass the booking and watch plan. Hyatt is the first implementation target.

Replace the placeholder collector result with a richer contract:

```ts
type CollectorRateCandidate = {
  sourceName: string;
  sourceType: "direct" | "ota" | "other";
  inventoryType: "cash" | "award";
  collectedAt: Date;
  price: {
    base: number | null;
    taxes: number | null;
    fees: number | null;
    total: number;
    currency: string;
    points: number | null;
    cashCopay: number | null;
    taxesIncluded: boolean | null;
    feesIncluded: boolean | null;
  };
  room: {
    rawName: string;
    normalizedName: string | null;
    match: "exact" | "similar" | "unknown";
    matchReason: string;
  };
  cancellation: {
    rawPolicy: string;
    deadline: Date | null;
    match: "same_or_better" | "worse" | "unknown";
    matchReason: string;
  };
  loyalty: {
    eligible: boolean | null;
    loginState: "not_required" | "anonymous" | "member" | "unknown";
  };
  source: {
    url: string | null;
    verified: boolean;
    snapshot: unknown;
  };
};
```

Group tools should not directly create recommendations. They should only produce candidates, source URLs, run status, and evidence-ready raw data.

### First Group Tool: Hyatt

Implement Hyatt first, because the app already treats direct rates as the primary decision source.

The first Hyatt tool should:

- Accept booking fields as input.
- Support cash and award inventory modes in the tool contract.
- Build or open a direct Hyatt search URL.
- Use Browser Companion import as the first Hyatt path for real-profile evidence capture.
- Keep Chrome profile mode as an experimental fallback, not the default trusted Hyatt path.
- Support per-booking browser mode from the watch plan.
- Add a shared BrowserConnector that resolves the configured Chrome data directory, launches the real local Chrome app with a Chrome DevTools Protocol port when needed, connects to that real Chrome instance, opens the source URL, and extracts visible page text.
- Use a minimal native Chrome DevTools Protocol client as the first connector implementation. It should create a target through Chrome's local `/json/new` endpoint, connect to the target websocket, navigate with `Page.navigate`, and read visible text with `Runtime.evaluate`.
- Do not use Playwright `launch`, `launchPersistentContext`, or `connectOverCDP` for Chrome profile mode.
- Store Chrome connector settings in the local user profile. Default session name should be `TripBuddy`, default port should be `0` for automatic port selection, and default Chrome data directory should be project-local at `data/chrome-cdp-profile`.
- Use a TripBuddy-managed Chrome data directory for CDP. Do not rely on Chrome's default user data directory, because remote debugging may be unavailable or ignored there.
- Read Chrome's dynamic `DevToolsActivePort` file when automatic port selection is enabled. This avoids stale fixed debugging ports.
- Before launching a new automatic-port Chrome session, reuse a reachable endpoint from `DevToolsActivePort`; if the saved endpoint is unreachable, clear the stale file and wait for the new dynamic endpoint.
- Launch Chrome with `about:blank`, then reuse an existing blank or new-tab CDP target for navigation. Create a new `/json/new` target only when no reusable blank page exists.
- Detect empty Hyatt documents, including `200 text/plain` responses with an empty DOM, as an unreadable automation-block state rather than a no-rate result.
- Add a follow-up user-browser-assisted extractor path if CDP Chrome profile mode continues to receive empty Hyatt documents. Candidate approaches are a companion Chrome extension or a macOS Chrome automation connector with explicit user permission.
- Add a `browser-extension` unpacked Chrome extension that reads the active tab only after a user click, extracts Hyatt visible text and candidate rates, and posts evidence to `POST /api/browser-evidence`.
- Add a content-script auto-import mode. Booking detail pages should open the hotel source URL with `tripbuddyBookingId` in the URL hash; the extension should wait for readable rate text, then POST page evidence to the local API without clicking hotel controls.
- Auto-import readiness should require rate-like tokens, not generic page controls. Accept examples include `Avg/Night`, `Avg / Night`, `per night`, points rates, `Total Cash`, `Price Summary`, and related final-total labels.
- For Hyatt auto-import, attempt a conservative staged navigation from room list to rate plan to pre-payment price summary. If final total evidence appears, import only observation-ready final/detail evidence and suppress room-list nightly estimates for the same page import.
- Store the booking ID and local endpoint in tab-scoped session storage after opening the auto-import URL so the content script can continue across Hyatt navigations even when the URL hash is dropped.
- Use a state-machine-like content script loop: wait for room-list rates, click the lowest safe rate selector, detect rate-plan pages, click a safe rate-plan selector, then import only after final-total evidence appears or the fallback timeout expires.
- Maintain hard click guardrails for payment, confirmation, purchase, complete-reservation, place-order, and submit-payment controls.
- Add `POST /api/browser-evidence` to create a browser-extension `PriceCheckRun`, store parsed candidates as `PriceObservation`, update `lastCheckedAt`, and refresh the booking recommendation.
- Add a Browser Import card on booking detail pages showing the booking ID, local endpoint, and extension usage instructions.
- In interactive mode, launch a visible browser and wait before extracting body text.
- Do not use the user's daily Chrome profile for collector automation.
- Prefer canonical hotel-specific `/en-US/shop/rooms/{hotelCode}` URLs when a Hyatt hotel code can be extracted from the booking URL.
- Add curated hotel-name-to-code mappings as a short-term fallback for known Hyatt properties, starting with Hyatt Place Kuala Lumpur Bukit Jalil (`kulzk`).
- Detect Hyatt E6020 automation blocks and store a clear failed run status.
- Parse cash and award candidates conservatively from page text.
- Support common Hyatt cash display formats across USD, JPY, EUR, GBP, SGD, MYR, HKD, CNY, THB, and KRW.
- Preserve the observed Hyatt page currency for parsed cash rates.
- Request the booking currency in Hyatt source URLs where Hyatt supports a currency query parameter.
- Treat Hyatt `Avg/Night` as a nightly base rate, not a stay total. Calculate stay total as nightly rate multiplied by the number of nights, and store the nightly value in `basePrice`.
- Capture the visible room name and rate plan near a Hyatt cash rate when the room list exposes them.
- Mark cancellation policy as unknown when it is not visible in the Hyatt room list. Do not infer a policy from the existence of a rate.
- In Chrome profile mode, use a conservative multi-step Hyatt flow: read the room list, identify the lowest visible safe cash rate, click its `Select & Book` control, wait for a pre-payment detail or review page, and extract final total, tax/fee text, and cancellation policy text when visible.
- Add a hard automation guardrail: never click payment, purchase, confirm booking, place order, submit payment, or equivalent final-booking controls.
- Treat room-list totals as transient estimates when detail-page final total is unavailable. Detail-page totals should override room-list nightly-rate estimates, and estimates must not be stored as `PriceObservation` rows when a final total was captured in the same import.
- Split Hyatt extraction into two explicit phases:
  1. Inventory phase: collect all visible room-list room/rate estimates, including rooms and suites. These are candidate-selection facts, not final observations.
  2. Detail phase: select one or more backup candidates, navigate each selected candidate to its rate/detail or pre-payment page, and capture final total, tax/fee inclusion, breakfast inclusion, and cancellation policy.
- The initial deterministic candidate selector can choose the closest matching current room and the cheapest safe candidate. Future LLM selection should choose candidates from the inventory phase using current booking details, party type, room preferences, breakfast preference, and cancellation sensitivity.
- Future Hyatt detail extraction may use multiple TripBuddy-owned tabs or windows to collect final totals for selected candidates in parallel, provided all tabs preserve the original booking dates, guest count, currency, and no final booking action is clicked.
- Parse any visible Hyatt cash or award candidate from the same loaded page when either inventory mode is enabled, because Hyatt award searches can still render cash rates.
- Support award text variants such as `points`, `point/night`, and `pts/night`.
- Store a short page-text sample in failed or partial run details when no rate token can be parsed.
- Mark room and cancellation matches as `unknown` until structured extraction can verify equivalence.
- Store one or more observations.
- Attach evidence to each observation.
- Fail safely with a `PriceCheckRun` error state.

Manual observation remains the fallback when automated collection fails.

### Evidence Builder

Add a pure module, likely `src/lib/evidence.ts`, that converts a collector candidate and booking into an evidence object.

Responsibilities:

- Determine quality level.
- Produce blockers and warnings.
- Normalize "unknown" values.
- Avoid recommendation-ready status when room or cancellation policy is unknown.
- Preserve raw collector data for debugging.

Quality rules:

- `high`: source verified, exact room match, same or better cancellation, known tax/fee inclusion, loyalty eligibility known.
- `medium`: no blockers, but one or more warnings such as similar room match or anonymous direct pricing.
- `low`: important uncertainty exists, but no hard blocker.
- `needs_review`: room match unknown, cancellation match unknown, currency mismatch, tax/fee ambiguity with material price impact, or collector failure.

### Decision Engine

Refactor `generateRecommendation` so it consumes:

- Booking baseline.
- Candidate observation.
- Observation evidence.
- Cost breakdown.
- User profile and loyalty assumptions.

The deterministic engine should return:

- `verdict`
- `estimatedSavings`
- `riskLevel`: `low`, `medium`, `high`
- `qualityLevel`
- `blockers`
- `warnings`
- `candidateObservationId`
- `costBreakdown`
- `explanation`

The current savings threshold should become a guardrail:

- Below threshold: usually keep, unless cancellation deadline is close or user preference later requests sensitive alerts.
- Above threshold: eligible for recommendation only if evidence has no hard blockers.
- Missing tax/fee inclusion and currency mismatch are hard blockers that should return `needs_review`.

### Future LLM Candidate Selection

Before final recommendation, introduce an LLM-assisted candidate selector that consumes structured candidates, not raw page text. Inputs should include:

- Current booking room type and rate.
- Trip party type and user room preferences.
- Breakfast requirement.
- Cancellation preference.
- Loyalty and promotion context.
- Structured candidate rooms, rates, final totals, policy text, and evidence quality.

The selector should choose or rank candidates and explain tradeoffs. Numeric cost calculations should remain deterministic.

Until the LLM selector exists, keep a deterministic fallback:

- First prefer exact or near-exact current room matches.
- Also consider the cheapest safe room-list candidate.
- For family or larger-party trips, include suite or larger-room candidates only after the detail phase can capture final total and policy.
- Do not surface room-list estimates as final recommendations when their tax/fee inclusion is unknown.

### Future LLM Layer

Do not add the LLM decision layer until automated evidence is stable.

When added, the LLM should receive only:

- Structured evidence.
- Cost breakdown.
- User preference profile.
- Recommendation guardrail result.
- Relevant promotion summaries.

It should not make unsupported factual claims from raw page text.

The LLM output should be validated against an expected JSON shape before being saved.

### UI Changes

Booking detail should add:

- "Run price check" button.
- Price check run status.
- Candidate cards grouped by source.
- Evidence quality badge.
- Blockers and warnings.
- Raw details collapsible section.

Dashboard should continue showing only the latest recommendation per booking.

Manual observation forms should stay available, but should be visually secondary once automated checks exist. Existing observations should remain list-first: show summary rows, keep edit/delete/promote actions explicit, and avoid rendering full raw edit forms inline on the booking detail page.

### Tests

Data extraction changes have an additional real-browser requirement:

- Hyatt extraction work must use the real Chrome `TripBuddy` profile plus the TripBuddy Browser Companion extension as the primary tested path.
- Any behavior-changing parser, content-script, navigation, or evidence-import change must be tested once against a real Hyatt page through that profile and extension before being considered done.
- CDP profile automation is experimental for Hyatt. Do not replace the Browser Companion path with CDP unless a fresh real-world test shows CDP reliably renders Hyatt and extracts the same or better evidence.
- If a real-browser test cannot be completed, explicitly report that limitation and do not describe the extraction change as verified.

Add unit tests for:

- Evidence quality classification.
- Exact room and same cancellation producing high quality.
- Unknown room producing needs review.
- OTA non-loyalty rate producing warning.
- Currency mismatch producing blocker.
- Collector failure creating failed run state.

Add integration tests for:

- Running a price check creates `PriceCheckRun`.
- Successful candidate creates `PriceObservation` and `ObservationEvidence`.
- Failed collector does not delete old observations.
- Recommendation uses the newest direct candidate with acceptable evidence.

Add UI smoke tests for:

- Booking detail shows "Run price check".
- Evidence quality badge renders.
- Blockers appear on needs-review candidates.

## Implementation Order

1. Add docs rule and keep this file updated with every behavior-changing code change.
2. Add database models and bootstrap SQL updates.
3. Add evidence types and pure evidence builder.
4. Refactor decision engine types around evidence quality and risk level.
5. Add price check run server action.
6. Add one placeholder automated collector that returns deterministic sample data in tests only.
7. Add first real direct collector behind the same interface.
8. Add UI for run status, candidate evidence, and failures.
9. Add tests and run `npm test` and `npm run build`.
10. For data extraction changes, reload the Browser Companion extension and run one real Hyatt import test through the Chrome `TripBuddy` profile.

## Assumptions

- Automated querying starts as user-triggered, not scheduled.
- Direct hotel sources remain the first priority.
- OTA prices remain reference-first.
- Numeric confidence remains internal and should not be shown to users.
- No automatic booking, cancellation, payment, or credential storage is introduced in v0.2.
