# TripBuddy v0.2 Implementation Plan

## Target Architecture

TripBuddy remains a local Next.js App Router application backed by Prisma and SQLite. Browser-backed work is coordinated by persistent browser tasks and completed by normal Chrome plus the TripBuddy Browser Companion.

The application is divided into four boundaries:

1. **Hotel providers** build source URLs, plan safe navigation, and parse source-specific snapshots.
2. **Price-check services** own browser-task/run lifecycle, observation persistence, evidence construction, and expiration.
3. **Pricing and decision services** calculate deterministic comparable costs, enforce guardrails, and call a replaceable recommendation decider.
4. **UI/API adapters** translate forms, browser captures, and provider results without duplicating domain logic.

## Implementation Sequence

### 1. Data and Tooling Baseline

- Replace the prototype schema with explicit enums, `BrowserTask`, `ObservationEvidence`, factual `PriceObservation`, and auditable `Recommendation` models.
- Represent booking cash, points, and certificate baselines explicitly.
- Replace handwritten migration scripts with a standard Prisma baseline migration and `prisma.config.ts`.
- Add reset/migrate/seed scripts, ESLint CLI configuration, and `*.tsbuildinfo` ignore coverage.
- Remove Playwright and all headless/interactive browser modes.

### 2. Provider and Browser Task Core

- Define `BookingPriceProvider`, `HotelSearchProvider`, and `AccountBookingImporter` contracts plus a hotel-group registry.
- Move Hyatt URL creation, parsing, and safe action planning into one provider implementation, with shared task-protocol keys and one unsafe-control rule module executed independently by the provider and Browser Companion.
- Persist browser tasks with an expiry and one linked price-check run for booking checks.
- Expose one task status/capture protocol for booking checks, city search, and account import.
- Register each task kind behind a `BrowserTaskDefinition`; keep the capture router branch-free and isolate search, account-import, and booking-price lifecycle services.
- Store only sanitized structured evidence; inventory nightly cash estimates do not create observations.

### 3. Evidence and Recommendation Core

- Add a pure evidence builder with blockers, warnings, quality, user overrides, and assessment provenance.
- Compare explicit candidate cancellation cutoffs with the current booking deadline using deterministic rules; keep ambiguous policies review-only and hard-block weaker policies.
- Refactor the cost engine around cash, points, copay, conversion, promotion, card, elite, and benefit components.
- Add `RecommendationDecider`; use the deterministic implementation by default and validate every result against guardrails.
- Add a foreground-only `PriceCheckRunner` with `manual` and `due_queue` provenance. Use cadence only to surface work while the Dashboard is open; never start Chrome unattended.

### 4. UI and Extension Integration

- Replace booking-page Chrome links and unused server actions with a single task-driven Run price check client.
- Show evidence quality, blockers, warnings, source facts, and sanitized details; remove numeric confidence.
- Reuse booking and observation form components.
- Generalize `/hotel-search` around the provider registry while exposing Hyatt only.
- Keep city search in the profile's single calculation currency. Offer an on-demand Hyatt `View Rates` flow that returns a tax-inclusive total only after visible final-total and tax/fee evidence is captured.
- Refactor Browser Companion to one task context and one server parsing path. The popup imports the current task only.
- Preserve Hyatt account import behavior, including direct reservation-detail navigation and active-date filtering.

### 5. Verification

- Unit-test providers, parsers, evidence, pricing, decider validation, expiry, and click guardrails.
- Score every hotel evidence extractor against the same provider fixture set before it can replace or supplement a deterministic parser.
- Integration-test task/run identity, stage completion, observation readiness, failure preservation, manual correction, city dispatch, and account baselines.
- Smoke-test booking/check UI, evidence rendering, forms, and search provider selection.
- Run test, lint, typecheck, production build, and clean reset/seed.
- Validate booking price import, the configured city-search currency plus one tax-inclusive city result, and account import through the app using normal Chrome with Browser Companion.

## Stable Interfaces

```ts
interface BrowserTaskDefinition<TCreateInput, TLaunchResult> {
  kind: BrowserTaskKind;
  create(input: TCreateInput): Promise<TLaunchResult>;
  capture(taskId: string, capture: BrowserTaskCapture): Promise<unknown>;
}

interface BookingPriceProvider {
  hotelGroup: string;
  buildLaunchUrl(input: BookingPriceInput): string;
  planAction(snapshot: BrowserPageSnapshot): BrowserTaskAction;
  parseSnapshot(snapshot: BrowserPageSnapshot, input: BookingPriceInput): ParsedBookingEvidence;
}

interface HotelSearchProvider {
  hotelGroup: string;
  buildSearchUrl(query: HotelSearchQuery): string;
  parseSearchSnapshot(snapshot: BrowserPageSnapshot): HotelSearchResult[];
}

interface AccountBookingImporter {
  hotelGroup: string;
  buildLaunchUrl(taskId: string, endpoint: string): string;
  isReservationDetailUrl(value: string): boolean;
  parseSnapshots(snapshots: AccountPageSnapshot[]): AccountBookingExtraction;
}

interface PriceCheckRunner {
  run(input: { bookingId: string; trigger: "manual" | "due_queue" }): Promise<BrowserTaskLaunch>;
}

interface RecommendationDecider {
  name: string;
  version: string;
  decide(input: DecisionInput): Promise<DecisionOutput>;
}
```

Provider results contain facts only. Evidence builders assess comparability. Cost engines calculate numbers. Deciders choose and explain. Guardrails validate the final decision.

## Operational Constraints

- No automatic booking, cancellation, payment, or final form submission.
- No Playwright, CDP, copied Chrome profile, or automated-profile fallback.
- No scheduler process or unattended price-check contract. The due queue is derived when the Dashboard opens and remains user-initiated as recorded in ADR 0001.
- No full page-text retention.
- No compatibility migration for the prototype database; reset and seed are intentional.
- The user's normal Chrome profiles outside this repository are outside reset and cleanup scope. Repo-local copied or CDP profiles under `data/` are prohibited legacy artifacts and must not be created or preserved.
