# TripBuddy v0.2 Implementation Plan

## Target Architecture

TripBuddy remains a local Next.js App Router application backed by Prisma and SQLite. Browser-backed work is coordinated by persistent browser tasks and completed by normal Chrome plus the TripBuddy Browser Companion.

The application is divided into four boundaries:

1. **Hotel providers** build source URLs, plan safe navigation, and parse source-specific snapshots.
2. **Price-check services** own browser-task/run lifecycle, observation persistence, evidence construction, expiration, and independent snapshot replay.
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
- Store bounded, PII-sanitized snapshots (up to 12k characters each) for diagnostics and independent extraction replay; inventory nightly cash estimates do not create observations.

### 3. Evidence and Recommendation Core

- Add a pure evidence builder with blockers, warnings, quality, user overrides, and assessment provenance.
- Add a schema-constrained LLM evidence extractor as an opt-in replay stage over stored snapshots. Keep provider parsing as the synchronous fast path; model output never controls navigation and must pass page-grounding, currency, and arithmetic checks before persistence.
- Record extraction source, extractor name/version, model, accepted proposals, and rejected-proposal issues so prompt versions remain auditable.
- Compare explicit candidate cancellation cutoffs with the current booking deadline using deterministic rules; keep ambiguous policies review-only, while preserving known weaker policies as non-blocking, prominent cautions on medium-risk recommendations.
- Keep cancellation-deadline form parsing, rendering, and calendar-day comparison on one local wall-time convention so timezone serialization cannot change a blocker.
- Refactor the cost engine around cash, points, copay, conversion, promotion, card, elite, and benefit components.
- Add `RecommendationDecider`; use the deterministic implementation by default and validate every result against guardrails.
- Add a foreground-only `PriceCheckRunner` with `manual` and `due_queue` provenance. Use cadence only to surface work while the Dashboard is open; never start Chrome unattended.
- Track last attempts and consecutive failures separately from successful checks; suppress active runs and apply bounded exponential backoff to failed due-queue items.

### 4. UI and Extension Integration

- Replace booking-page Chrome links and unused server actions with a single task-driven Run price check client.
- Keep client actions shared by multiple routes under `app/components`, not inside a dynamic route segment.
- Define design tokens in `src/ui/tokens.css` as a fixed palette plus semantic aliases built on `light-dark()`; components reference aliases only. Pin the theme with `[data-theme]` on the root and apply it before first paint.
- Keep shared primitives in `src/ui` (Button, Badge, Card, Notice, EmptyState, Table, Field) as CSS Modules, so no unscoped element selector styles the whole application.
- Resolve every user-facing enum through `src/lib/labels.ts` into a label and tone; never interpolate a storage value into copy or a class name.
- Retire the legacy global classes in `app/globals.css` call site by call site as pages move onto the primitives.
- Show evidence quality, blockers, warnings, source facts, and sanitized details; remove numeric confidence.
- Let users inspect stored sanitized snapshots and explicitly replay a price-check run with the configured LLM extractor.
- Reuse booking and observation form components.
- Generalize `/hotel-search` around the provider registry while exposing Hyatt only.
- Keep city search in the profile's single calculation currency. Offer an on-demand Hyatt `View Rates` flow that returns a tax-inclusive total only after visible final-total and tax/fee evidence is captured.
- Refactor Browser Companion to one task context and one server parsing path. The popup imports the current task only.
- Preserve Hyatt account import behavior, including direct reservation-detail navigation and active-date filtering.
- Prepare account-import conversions before entering one transaction that atomically resolves and writes every active booking.

### 5. Capability Layer and Event Stream

- Describe each product action once in `src/lib/agent/capabilities/*` as a capability: name, one-line summary, parameter shapes, effect, and a handler that reuses the existing domain modules rather than reimplementing them.
- Keep capabilities server-side functions invoked through `src/lib/agent/registry.ts`, not new REST routes. The app is a same-origin Next monolith; the only new HTTP surface is the event stream.
- Classify effect as `read` or `browser_task`. A `browser_task` must declare `resultRoute`, the route that owns its progress and error notices — the command bar closes when it runs, so a task fired from there would leave its result nowhere to render.
- Enforce confirmation in `invokeCapability`, not in handlers, so a new capability cannot forget it. Recognising an intent never authorises acting on it.
- Parse arguments strictly in `src/lib/agent/args.ts`: reject undeclared keys, refuse natural-language dates, and require calendar dates as `YYYY-MM-DD`. These arguments arrive from a model, and a silent coercion becomes a wrong answer that looks right.
- Return domain values, not copy: capability results carry stored enum values and ISO strings, and stay JSON-serializable because they cross the event stream.
- Report a run as an AG-UI event sequence over Server-Sent Events from `POST /api/agent`, the only HTTP surface the agent layer adds. Declare the event union in `src/lib/agent/events.ts` rather than depending on a package: align to the wire shape so a later swap is mechanical.
- Keep run orchestration in `src/lib/agent/run.ts`, transport-free, so the whole event sequence is testable without HTTP. The route only frames events and sets headers.
- Split failure reporting by layer: a transport problem answers with a status code, and anything that goes wrong inside a run is a RUN_ERROR event on an otherwise healthy 200 stream, so a client reads outcomes in one place.
- Pass capability error codes through onto RUN_ERROR unchanged, so a client can tell `confirmation_required` from a failure without matching on message text. Confirmation is a protocol round trip: the client re-sends the same request with `confirmed` after the user presses.
- Guard the stream with the same `sameOriginRequestError` the task-creation routes use.
- Route a sentence to a capability in `src/lib/agent/router.ts`. Build the model's catalogue from the registry so a new capability is routable without a prompt edit, and constrain the model to `{capability, args}` with strict key-set validation.
- Check everything the model returns: an unknown capability name is out of scope, and arguments go through the capability's own parser so an invented parameter or a relative date is rejected rather than coerced.
- Refuse booking, cancelling, paying, confirming, and modifying deterministically, before either routing path runs, so the refusal does not depend on the model.
- Keep user-facing copy product-owned: the model signals `unsupported`, and clarifying questions reuse the capability parser's messages.
- Fall back to keyword matching over the same catalogue when no key is configured or the provider is unreachable, and record which path produced the decision.
- Share one DeepSeek JSON-completion client (`src/lib/providers/llmClient.ts`) between the extractor and the router rather than duplicating the request shape and finish-reason handling.
- Score both routing paths against one fixture set with `npm run eval:intent-router`, holding the deterministic router as the checked-in baseline in `docs/evals/`.

### 6. Verification

- Unit-test providers, parsers, evidence, pricing, decider validation, expiry, and click guardrails.
- Score every hotel evidence extractor against the same provider fixture set before it can replace or supplement a deterministic parser.
- Keep the LLM fixture evaluation opt-in because it requires an API key and incurs provider usage; fail it when the model score is below the deterministic baseline.
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
- No full page-text retention. Snapshot replay uses only bounded, PII-sanitized text.
- No compatibility migration for the prototype database; reset and seed are intentional.
- The user's normal Chrome profiles outside this repository are outside reset and cleanup scope. Repo-local copied or CDP profiles under `data/` are prohibited legacy artifacts and must not be created or preserved.
