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
- Structured observations, evidence quality, deterministic cost calculations, and recommendation history.
- An auxiliary official hotel city search. Hyatt is the first provider; other hotel groups plug into the same provider contract later.
- User correction of uncertain room and cancellation assessments.

The v0.2 release does not include:

- Automatic booking, cancellation, payment, or credential handling.
- Headless browsers, copied Chrome profiles, CDP automation, or a browser fallback outside normal Chrome plus Browser Companion.
- A running scheduler. Scheduled checks must eventually call the same price-check runner as manual checks.
- An LLM decision implementation. The deterministic decider implements the initial provider contract.
- OTA collection or non-Hyatt collection. Unsupported providers are not shown as available.

## Booking Price Checks

- A booking detail page has one primary **Run price check** action.
- The app creates a persistent browser task and one linked `PriceCheckRun` before opening Hyatt.
- Task context travels in the URL fragment and tab-scoped session storage. It is not required by the Hyatt server.
- Browser task status is queryable by the initiating page and ends as `succeeded`, `partial`, `failed`, or expired. A task must not leave a linked run permanently `running`.
- A failed check preserves all earlier observations and recommendations.
- The watch plan controls cash and award inventory. Cadence data is reserved for a future scheduler but is not presented as an active scheduling feature.

### Browser Companion Safety

- The extension reads visible page evidence and may perform only server-planned, visible navigation toward a pre-payment price summary.
- It must never activate payment, purchase, booking confirmation, place-order, complete-reservation, or equivalent final actions.
- The provider planner and Browser Companion enforce the same shared unsafe-control rules independently, and the extension fails closed if those rules are unavailable.
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
- `medium`: no blocker and only soft uncertainty, such as a similar room or anonymous direct price.
- `low`: important uncertainty exists but does not make the comparison unsafe.
- `needs_review`: unknown room or cancellation equivalence, incomplete material taxes/fees, unavailable currency conversion, or another hard blocker.

Evidence answers where the rate came from, how it was collected, whether room and policy are comparable, whether taxes and fees are included, whether loyalty and promotions apply, and which facts remain uncertain.

Raw browser storage is deliberately bounded: persist structured stage data and short sanitized text samples, not full visible pages. Confirmation numbers and similar account identifiers must be removed from diagnostic samples.

## Cost and Recommendation Behavior

- Monetary and points calculations remain deterministic.
- Comparable cost can include cash, points value, cash copay, promotions, credit-card value, elite progress, breakfast, lounge, late checkout, and upgrade value.
- Missing conversion for an observed currency is a hard blocker. A recorded conversion rate may make the rate comparable without changing the preserved observed currency.
- Unknown room match, unknown cancellation match, and incomplete final taxes/fees block an automatic rebook recommendation.
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
- Cash, points, and free-night certificate baselines are represented explicitly.
- A Hyatt stay is active only when its check-in date is today or later.
- An unreadable account DOM must stop the import rather than write partial or empty booking data.

## Documentation and Validation Rule

Every behavior, data-model, architecture, or assumption change updates this PRD and `docs/IMPLEMENTATION_PLAN.md` in the same change.

Any Hyatt extraction behavior change requires unit/integration checks plus one real Hyatt validation through the app and normal Chrome with Browser Companion. Booking price validation uses the booking page/API, city search uses `/hotel-search`, and account import uses the dashboard action. If a real page cannot be validated, report that limitation and do not describe the extraction as verified.
