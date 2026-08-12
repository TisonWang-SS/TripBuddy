# TripBuddy PRD

## Product Positioning

TripBuddy is a local-first hotel booking optimization workspace. It monitors a traveler's existing or candidate hotel bookings, gathers direct-channel price evidence, calculates comparable costs, and explains whether a booking should be kept, reviewed, or replaced.

TripBuddy is not an OTA. It never books, cancels, pays, confirms, or modifies a reservation. Every baseline change is confirmed by the user after they act on the hotel website.

## v0.2 Product Boundary

The v0.2 release includes:

- Local Next.js and SQLite operation.
- Manual booking creation, editing, and price observations.
- Hyatt account booking import from the user's normal Chrome session.
- Booking-driven Hyatt cash and award checks through the TripBuddy Browser Companion.
- A foreground due-check queue calculated when the Dashboard opens; every queued check still requires a user click.
- Structured observations, evidence quality, deterministic cost calculations, and recommendation history.
- Opt-in LLM evidence replay over bounded, sanitized Browser Companion snapshots.
- An auxiliary official hotel city search. Hyatt is the first provider; other hotel groups plug into the same provider contract later.
- User correction of uncertain room and cancellation assessments.

The v0.2 release does not include:

- Automatic booking, cancellation, payment, or credential handling.
- Headless browsers, copied Chrome profiles, CDP automation, or a browser fallback outside normal Chrome plus Browser Companion.
- Background or unattended price checks. Every check requires explicit user initiation and a visible normal-Chrome tab.
- An LLM decision implementation. The deterministic decider implements the initial provider contract.
- OTA collection or non-Hyatt collection. Unsupported providers are not shown as available.

## Booking Price Checks

- A booking detail page has one primary **Run price check** action.
- Booking detail and Dashboard due-queue entries reuse the same foreground price-check action.
- The app creates a persistent browser task and one linked `PriceCheckRun` before opening Hyatt.
- Task context travels in the URL fragment and tab-scoped session storage. It is not required by the Hyatt server.
- Browser task status is queryable by the initiating page and ends as `succeeded`, `partial`, `failed`, or expired. A task must not leave a linked run permanently `running`.
- Browser task creation and capture dispatch through one registry keyed by task kind. Booking price checks, city searches, and account imports each own their context, capture handling, and result persistence behind the same definition contract.
- A failed check preserves all earlier observations and recommendations.
- The watch plan controls cash and award inventory, normal and urgent reminder cadence, the urgent cancellation window, and the last completed check.
- When the Dashboard opens, TripBuddy derives a due queue from those facts. The queue never starts work itself; the user must explicitly start each visible Browser Companion check. See `docs/decisions/0001-foreground-price-checks.md`.
- Watch plans record attempts separately from successful checks. Active runs are hidden from the due queue; failures use exponential retry backoff capped at seven days without shortening a longer configured cadence, and reset after the next completed check.

### Browser Companion Safety

- The extension reads visible page evidence and may perform only server-planned, visible navigation toward a pre-payment price summary.
- It must never activate payment, purchase, booking confirmation, place-order, complete-reservation, or equivalent final actions.
- The provider planner and Browser Companion enforce the same shared unsafe-control rules independently. Browser task fragment and storage keys also come from one shared protocol module. The extension fails closed if either shared module is unavailable.
- Hyatt work uses normal Chrome with the installed Browser Companion. There is no automated or copied-profile fallback.
- An empty Hyatt DOM, E6020 response, KPSDK challenge, missing rate evidence, or task timeout is an unreadable/failed result, not valid no-availability evidence.
- Booking context persists across same-tab Hyatt navigation.

### Staged Hyatt Evidence

1. **Inventory phase:** capture visible rooms, rate plans, nightly cash estimates, and points rates.
2. **Selection phase:** deterministically choose the closest current-room candidate or the cheapest safe candidate.
3. **Detail phase:** navigate to a rate detail or pre-payment page and capture final total, taxes/fees, room, breakfast, and cancellation policy.

Room-list `Avg/Night` cash prices are transient inventory facts. They are retained only in the run's sanitized evidence and never become user-facing observations. A cash observation requires final/detail total evidence. An explicit points rate may become an award observation but remains review-only when policy or room equivalence is unknown.

Hyatt parsing must support common visible currencies including USD, CNY, JPY, EUR, GBP, SGD, MYR, HKD, THB, and KRW. The observed currency is preserved. A requested currency selector must be verified from the rendered page rather than trusted from a URL parameter.

## Evidence Quality

Every observation owns one structured evidence record. Evidence distinguishes captured facts, automated assessments, and user corrections.

User-facing quality levels are:

- `high`: verified source, exact room, same-or-better cancellation, known tax/fee inclusion, known loyalty status, and comparable currency.
- `medium`: no blocker, but a material tradeoff or soft uncertainty exists, such as weaker cancellation, a similar room, or an anonymous direct price.
- `low`: important uncertainty exists but does not make the comparison unsafe.
- `needs_review`: unknown room or cancellation equivalence, incomplete material taxes/fees, unavailable currency conversion, or another hard blocker.

Evidence answers where the rate came from, how it was collected, whether room and policy are comparable, whether taxes and fees are included, whether loyalty and promotions apply, and which facts remain uncertain.

Cancellation equivalence may be assessed automatically only when the current booking has a cancellation deadline and the candidate policy exposes an explicit calendar-date or Hyatt-style days/hours-before-arrival cutoff. A candidate cutoff on or after the current cutoff is `same_or_better`. An earlier cutoff or an explicitly non-refundable candidate is `worse`; it remains eligible for a medium-risk automatic recommendation but must be shown as a prominent caution before the user confirms a baseline change. Missing or ambiguous cutoffs remain `unknown` and hard-block automatic rebooking. A user correction can override the automated assessment and is recorded as user-sourced evidence.

Booking cancellation deadlines round-trip through `datetime-local` as local wall time. Calendar-day policy comparison uses that local booking date against the explicit hotel-policy date; it must not derive the booking day from its UTC serialization.

Raw browser storage is deliberately bounded: persist structured stage data and PII-sanitized text samples of at most 12k characters per snapshot, not full visible pages. Confirmation numbers and similar account identifiers must be removed from diagnostic samples.

LLM extraction is a separate, user-triggered replay stage over those stored sanitized snapshots; it is not part of the browser capture timeout. Provider-specific deterministic parsing remains the synchronous fast path. Model output can propose facts only and never controls browser navigation, booking, payment, or baseline changes. Every proposal must pass strict schema validation, prove that its quoted text and numbers occur in the stored snapshot, use one consistent currency, and satisfy available subtotal/fee/total and nightly-rate arithmetic before becoming an observation. Rejected proposals and extractor/model versions remain auditable.

Hotel evidence extractors are compared offline against one shared, provider-specific fixture set. The evaluation reports field-level assertion coverage, fixture pass counts, and one normalized score so deterministic and model extractors can be compared without changing the acceptance criteria. The model extractor must not score below the deterministic baseline before it can supplement production parsing.

## Cost and Recommendation Behavior

- Monetary and points calculations remain deterministic.
- Comparable cost can include cash, points value, cash copay, promotions, credit-card value, elite progress, breakfast, lounge, late checkout, and upgrade value.
- Missing conversion for an observed currency is a hard blocker. A recorded conversion rate may make the rate comparable without changing the preserved observed currency.
- Unknown room match, unknown cancellation match, and incomplete final taxes/fees block an automatic rebook recommendation.
- A known weaker cancellation policy does not block an automatic recommendation; it lowers evidence quality and risk confidence to medium and is surfaced as a prominent caution.
- OTA candidates, when later supported, remain reference-first unless loyalty eligibility and policy equivalence are verified.
- A nearby cancellation deadline is surfaced even when savings do not cross the normal threshold.
- Recommendations are created only when at least one candidate observation exists. Repeated empty refreshes must not create decision-history noise.

The decision boundary is a replaceable `RecommendationDecider`. It receives only structured evidence, deterministic cost breakdowns, profile preferences, promotion summaries, and guardrail results. The default implementation is deterministic. A future LLM implementation may choose a candidate, verdict, risk, and explanation, but its result must validate against the output contract and cannot override deterministic safety blockers.

## City Search and Account Import

- Official city search remains an auxiliary workflow, separate from booking recommendations.
- Search dispatches through a hotel-group provider registry. The UI lists only providers that actually implement city search.
- City-search currency is the profile's single primary calculation currency. A search opens one normal-Chrome Hyatt task, visibly switches the selector to that currency, and shows only results in that rendered currency. It neither trusts a URL parameter nor silently applies FX conversion.
- City listings may show Hyatt's `Avg/Night` starting price, explicitly marked as excluding taxes and fees. A user can request a tax-inclusive total for one listed hotel. The same task safely follows that hotel's `View Rates` path toward Hyatt's pre-payment summary and returns a total only when visible `Taxes & Fees` and final-total evidence confirm inclusion. City-search totals remain transient search facts, not booking observations.
- Hyatt account import starts from `My Stays`, collects visible `Stay Details` URLs, then opens each detail URL directly in the same tab.
- Account-import task handling parses browser evidence; booking creation and updates are owned by a separate account-booking domain service.
- Cash, points, and free-night certificate baselines are represented explicitly.
- A Hyatt stay is active only when its check-in date is today or later.
- An unreadable account DOM must stop the import rather than write partial or empty booking data.
- Account-import booking creates and updates are atomic: conversion and validation finish before one transaction applies the complete active-booking set.

## Presentation

Enum values in this document are storage identifiers, not interface copy. Every user-facing enum resolves through one label layer into a human label and a badge tone, and an unmapped value resolves to a humanized form rather than passing through. A storage identifier such as `rebook_direct` or `needs_review` must never appear in the interface.

Colour, spacing, type, radius, shadow, and motion come only from design tokens. Components consume semantic aliases rather than palette values, so a theme is one declaration and cannot drift between light and dark. The theme follows the operating system by default and the user can pin it; the pinned value is applied before first paint so the interface never flashes the wrong theme.

Shared interface primitives live in `src/ui` and carry the states the product actually needs: hover, focus-visible, disabled, and busy. Dense tables scroll within their own container so a page never scrolls sideways.

Evidence ordering is a contract, not a layout preference: blockers and warnings render before any control that changes a baseline. Composition stays deterministic and server-owned so this ordering cannot be renegotiated per render, and the rule is checked when a surface is built rather than trusted to whoever assembles one.

An answer to a typed question is described as data, not markup. The server composes an ordered list of nodes, each naming a component from a fixed catalogue and carrying its values; the client renders them with its own components. A node never carries markup, a template, or a module path, and a name the client does not recognise renders nothing rather than being resolved — an interface that can be described remotely must not be executable remotely. Because the description is data, the same answer can later be rendered by a different client without the server changing.

## Capability Boundary

What TripBuddy can do is described once, as a set of named capabilities with typed arguments. Every caller — a page, the command bar, and later an intent router — goes through the same registry, so there is one list of product actions rather than one per surface.

Capabilities are either reads or browser tasks. A read is safe to run as soon as an intent is recognised. A browser task opens a Hyatt tab through the Browser Companion, so it requires explicit confirmation and names the route that owns its progress and error notices; recognising an intent is never authority to act on it, and a result that has nowhere to render is not an acceptable outcome.

A request may arrive as a sentence rather than a pressed control. A model reads it and chooses one capability and its arguments; it never sees a booking, a price, a verdict, or a result, and it never writes text the user reads. A capability name outside the catalogue is treated as out of scope rather than passed through, and arguments are validated by the same parser a pressed control uses. Choosing a capability is not permission to run it — anything that opens a browser tab still requires a press. Requests to book, cancel, pay for, confirm, or modify a reservation are refused before either routing path runs, and that refusal does not depend on the model. Without a configured model — or when it is unreachable — routing falls back to keyword matching over the same catalogue, so the product stays usable offline. See `docs/decisions/0002-model-influenced-routing.md`.

A run is reported as a stream of events rather than a single response: which capability was chosen, the arguments it actually used, when it started and finished, and what it returned. Progress is something the user can watch, and a failure is an event in that stream rather than a separate error channel. Confirmation is part of the exchange — a run that needs a press ends by saying so, and the client asks again once the user has agreed.

Capability arguments are validated strictly and rejected rather than coerced. Dates must be calendar dates; an undeclared argument is an error, not something to ignore. Capability results carry stored enum values and explicit date strings, leaving copy to the presentation layer.

## Documentation and Validation Rule

Every behavior, data-model, architecture, or assumption change updates this PRD and `docs/IMPLEMENTATION_PLAN.md` in the same change.

Any Hyatt extraction behavior change requires unit/integration checks plus one real Hyatt validation through the app and normal Chrome with Browser Companion. Booking price validation uses the booking page/API, city search uses `/hotel-search`, and account import uses the dashboard action. If a real page cannot be validated, report that limitation and do not describe the extraction as verified.
