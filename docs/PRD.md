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
- Official hotel discovery by city, with a saved whole-stay budget and an explicit upgrade from starting prices to verified tax-inclusive totals. Hyatt is the first provider; other hotel groups plug into the same provider contract later.
- One third-party comparison price per hotel, collected over an authenticated API rather than a browser, for hotels the official search already found. See `docs/decisions/0006-ota-price-source.md`.
- A conversational entry point as the product's primary interface: a typed capability registry the model calls as tools, a multi-step agent loop that gathers requirements, runs tools, reads what they returned, and advises on it, explicit confirmation before any browser-opening action, streamed progress, and server-composed result surfaces rendered in the conversation itself.
- User correction of uncertain room and cancellation assessments.

The v0.2 release does not include:

- Automatic booking, cancellation, payment, or credential handling.
- Headless browsers, copied Chrome profiles, CDP automation, or a browser fallback outside normal Chrome plus Browser Companion.
- Background or unattended price checks. Every check requires explicit user initiation and a visible normal-Chrome tab.
- An LLM decision implementation. The deterministic decider implements the initial provider contract.
- Automatic collection from any source that requires driving a third-party website. Non-Hyatt hotel-group collection. Unsupported providers are not shown as available.

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
- A control that is pressed and does not move the page is reported as such, naming the control and quoting any reason the page itself gave. Retrying it until the task runs out of time reports a slow page for what is a control that does not advance.
- It must never activate payment, purchase, booking confirmation, place-order, complete-reservation, or equivalent final actions.
- The provider planner and Browser Companion enforce the same shared unsafe-control rules independently. Browser task fragment and storage keys also come from one shared protocol module. The extension fails closed if either shared module is unavailable.
- Hyatt work uses normal Chrome with the installed Browser Companion. There is no automated or copied-profile fallback. The third-party comparison source is not browser work and opens no tab: it is an authenticated API call for hotels the official search already returned, it never initiates a booking step, and it fails silently — no token, a timeout, or an unreadable response yields no comparison offers and leaves the official result untouched.
- Application routes accept a browser request only when its origin is the address the request was actually sent to, and that address is loopback or a private IPv4 literal. Agreement between origin and address is not sufficient on its own: a public name pointed at this machine produces that agreement and is refused. A host outside those ranges is named explicitly in the environment or not accepted.
- An empty Hyatt DOM, E6020 response, KPSDK challenge, missing rate evidence, or task timeout is an unreadable/failed result, not valid no-availability evidence.
- Booking context persists across same-tab Hyatt navigation.

### Staged Hyatt Evidence

1. **Inventory phase:** capture visible rooms, rate plans, nightly cash estimates, and points rates.
2. **Selection phase:** deterministically choose the closest current-room candidate or the cheapest safe candidate.
3. **Detail phase:** navigate to a rate detail or pre-payment page and capture final total, taxes/fees, room, breakfast, and cancellation policy.

A hotel is judged against a budget by any comparable offer it has: a Hyatt final total captured under the staged-evidence rules, or a third-party quote in the same currency. Where several qualify, the cheapest is the one judged. The third-party source quotes an all-in price and publishes no tax or fee breakdown, so inclusion is known while the split is not; `docs/decisions/0006-ota-price-source.md` records that assumption, the constant that carries it, and the unresolved question of whether the two collection methods should look alike to a reader.

Room-list `Avg/Night` cash prices are transient inventory facts. They are retained only in the run's sanitized evidence and never become user-facing observations. A cash observation requires final/detail total evidence. Both inventory types reach storage through the same provider decision: a run imports on its last snapshot while rates are seen on earlier ones, so the accumulated evidence is filtered by the rule that decides observations rather than being written straight through. A points rate meets the same bar rather than a lower one: it becomes an award observation only when it is a complete price for the stay, and it remains review-only when policy or room equivalence is unknown. A points room list prices every room at once, so award observations are limited to the booked room itself, judged by the same room equivalence the evidence layer applies; the rest stay evidence. A variant that adds an entitlement — club access, a lounge, a view — is a different room at a different price, not a formatting difference, and one room name containing another never on its own makes them the same room. When a capture yields two different stay prices for one room, neither becomes an observation, because the capture cannot say which is that room's rate.

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
- Comparable cost can include cash, recorded points value, recorded certificate value, cash copay, confirmed eligible promotions, and credit-card value. Breakfast, lounge access, late checkout, room upgrades, and flat elite-night progress never enter `effectiveCost`.
- A point value and a certificate value are stored with the source that quotes them, the date quoted, and the date last reviewed. A figure past its review date is still used, named as stale in the recommendation that depends on it, and lowers that recommendation's evidence quality by one level. It neither disappears nor passes silently.
- A certificate value is a market price adjusted by a realization rate of at most 1, which trusts the quote by default. The rate applies to certificates only: points redeem at their value, so a point valuation carrying a rate is rejected rather than corrected.
- Spending an unpriced point or certificate is a blocker, because valuing it at zero would make a stay look free. Earning an unpriced point is only a warning, because a missing upside understates both sides instead of manufacturing a saving. A certificate baseline whose kind and count are not recorded is named as unpriced rather than counted as one night.
- A valuation recorded in another currency is converted only through a recorded conversion rate; without one it is named and treated as absent.
- A captured points figure records whether it covers the whole stay or one night. Cash evidence proves this by reaching a final total; award evidence has no equivalent gate and the same wording appears in both places, so an unproven figure stays unknown and anything dividing by it refuses rather than assuming.
- Cash and an award rate are compared only when both were read in one capture, name the same room, and the points figure is known to cover the stay, and only against a same-currency cash total whose taxes and fees are shown as included. The comparison reports the return per point beside the recorded point value and the resulting conclusion, shown with the verdict rather than inside a collapsed breakdown — it is a conclusion, not a line item. Any missing input produces no comparison and a stated reason, never an estimate, and the comparison never moves `effectiveCost` or a verdict.
- An entitlement available with the current booking but absent from a candidate is a warning on that candidate. The traveler can mark each entitlement as not important; that suppresses only its warning and cannot change a cost figure or verdict.
- A promotion marked as requiring registration is excluded until registration can be confirmed. Because the profile does not yet record registration state, the omission is named in the recommendation rather than silently treated as zero.
- Historical recommendation rows retain the cost snapshot and savings produced by the decision version that created them. A cost-model migration never recalculates history; legacy subjective components remain readable only as historical composition, and a snapshot written before a component existed stays readable without it.
- Missing conversion for an observed currency is a hard blocker. A recorded conversion rate may make the rate comparable without changing the preserved observed currency.
- Unknown room match, unknown cancellation match, and incomplete final taxes/fees block an automatic rebook recommendation.
- A known weaker cancellation policy does not block an automatic recommendation; it lowers evidence quality and risk confidence to medium and is surfaced as a prominent caution.
- OTA candidates, when later supported, remain reference-first unless loyalty eligibility and policy equivalence are verified.
- A nearby cancellation deadline is surfaced even when savings do not cross the normal threshold.
- Recommendations are created only when at least one candidate observation exists. Repeated empty refreshes must not create decision-history noise.

The decision boundary is a replaceable `RecommendationDecider`. It receives only structured evidence, deterministic cost breakdowns, profile preferences, promotion summaries, and guardrail results. The default implementation is deterministic. A future LLM implementation may choose a candidate, verdict, risk, and explanation, but its result must validate against the output contract and cannot override deterministic safety blockers.

## City Search and Account Import

- Official city search is the discovery path for candidate stays. It remains separate from booking recommendations until a user creates or updates a booking baseline.
- Search dispatches through a hotel-group provider registry. The UI lists only providers that actually implement city search.
- A natural-language search preserves the destination exactly as asked for display and sends a separate Latin-letter destination accepted by the provider. Hyatt's visible location labels, location mismatches, and zero-result state remain visible grounding evidence; normalization alone never claims that the destination matched.
- City-search currency is the profile's single primary calculation currency. A search opens one normal-Chrome Hyatt task, visibly switches the selector to that currency, and shows only results in that rendered currency. It neither trusts a URL parameter nor silently applies FX conversion.
- A search budget preserves the amount the traveler stated, the wording it was read from, and a `per_night` or `stay_total` basis; no model may multiply, divide, convert, round, or otherwise derive the amount. When no basis is stated, deterministic product code interprets it as per night and the result surface names that assumption. Wording such as "around" or "左右" produces an approximate target with a product-owned 10% tolerance; all other budgets are hard maxima. Night multiplication and the resulting whole-stay ceiling are deterministic and shown with their provenance.
- Page and agent surfaces apply one deterministic comparison rule: an `Avg/Night` starting price is an explicitly tax-exclusive discovery hint and can never qualify a hotel against that budget. Unknown totals stay visible with an upgrade action; only a same-currency final total with visible `Taxes & Fees` evidence can be marked within budget or hidden as over budget.
- A user can request that tax-inclusive total for one listed hotel. The same task safely follows that hotel's `View Rates` path toward Hyatt's pre-payment summary and returns a total only when visible `Taxes & Fees` and final-total evidence confirm inclusion. City-search totals remain transient search facts, not booking observations.
- Hyatt account import starts from `My Stays`, collects visible `Stay Details` URLs, then opens each detail URL directly in the same tab.
- Account-import task handling parses browser evidence; booking creation and updates are owned by a separate account-booking domain service.
- A points-only award is payable in points alone and carries no tax, so its nightly figure times the nights is the whole price. Its cancellation terms are not on the room list, so the check opens the rate card to read them — a price with no terms is blocked on unknown equivalence and cannot be acted on. It stops short of the rate control, which Hyatt grants only to a signed-in member. A points-plus-cash rate is not completable that way: its cash half is quoted before tax like any other nightly cash rate, so it stays a nightly figure and anything comparing spans refuses it.
- A booking price check collects the inventory types its watch plan asks for. Hyatt renders cash or points and never both, and the mode is entered by pressing the page's own control rather than by a URL parameter, so a run that wants both walks the same room twice inside one capture. That control is sticky across navigation, so each leg sets it to the mode it needs rather than assuming a fresh page starts in cash. A requested inventory type that produced no rate is reported as such; a check that obtained only part of what it asked for is not described as a complete success.
- Cash, points, and free-night certificate baselines are represented explicitly. An imported certificate baseline keeps the visible award wording; the kind and count that make it priceable are stated by the traveler rather than parsed out of that wording.
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

What TripBuddy can do is described once, as a set of named capabilities with typed arguments. Every caller — a page, the agent loop, and the offline keyword router — goes through the same registry, so there is one list of product actions rather than one per surface.

A capability declares one of three effects, and the effect is what decides whether consent is needed — a capability does not opt in to being gated. A **read** is safe to run as soon as an intent is recognised. A **write** changes stored data without opening anything; it always requires a press, with no exemption, and must state in the product's own words what that press will change. A **browser task** opens a Hyatt tab through the Browser Companion; it always requires a press, and names the route that owns its progress and error notices. Opening a window on someone's screen is an action taken on their behalf whether or not it writes anything, so there is no read-only exemption for browser work. Recognising an intent is never authority to act on it, and a result that has nowhere to render is not an acceptable outcome. A capability may declare a pre-flight check for conditions its argument parser cannot see — a budget named in a currency the results are not priced in, say. It runs before the user is asked to confirm anything, so an impossible call becomes a question while they still have a choice, rather than a failure on a tab they have already opened. A condition added to work already done is a read over what was collected, never a repeat of collecting it: a budget filters search results, and the rates a hotel publishes do not depend on what the traveler is willing to pay.

Most requests arrive as a sentence rather than a pressed control. A model reads the conversation and decides between four moves: call tools, ask for something only the user can supply, answer with advice, or explain that a request is out of scope. It repeats that until it can conclude, bounded so a loop that keeps proposing tools is made to answer from what it already collected.

The model sees what the tools returned and writes the words the user reads. It does not produce outcomes. A capability name outside the catalogue is out of scope rather than passed through, and arguments are validated by the same parser a pressed control uses. Tool results reach it as a projection — identifiers it has no use for never enter its context, and free text captured from a page is length-capped and framed as data rather than instructions. It recommends by pointing at a row, and the money beside that row is read from the stored result: a money-sized figure in its prose must be one the tools produced, or a difference between two of them, and anything else is rejected rather than shown.

Choosing a capability is never permission to run it. Every capability that opens a Hyatt tab suspends the turn and asks; one press authorises one call and is spent, not held. Requests to book, cancel, pay for, confirm, or modify a reservation are refused before the model runs, and that refusal does not depend on it. The sentence describing what this product is stays product-owned; the model may only explain why one particular request cannot be served. Without a configured model — or when it is unreachable — the loop does not run and routing falls back to keyword matching over the same catalogue, so the product stays usable offline. See `docs/decisions/0002-model-influenced-routing.md` and `docs/decisions/0005-model-writes-advice.md`.

A search is the most expensive thing the agent does — it opens a tab, waits on a page, and costs a press — so a conversation carries the ones it has already collected. Each turn is told which searches exist, as summaries of what was asked and when it was captured, never the results themselves; the agent reads one back, re-judges it against a newly stated budget, or collects afresh, each as an ordinary tool call. A capture reads as current for fifteen minutes. That is a description, not a cache lifetime: nothing is evicted when it passes, and an older search may still be used as long as the answer says how old it is. A different destination, date, party size, or cash/points mode is a different search and reuses nothing. Searches are never shared between conversations, because a displayed price depends on the profile currency, the party size, and the signed-in account.

A running browser task reports its own progress as it changes, rather than being asked once a second whether it is done. The deadline belongs to the server, which ends the watch itself when the task finishes or expires. A turn started by the agent stays open across that wait, so the evidence the Companion posts back reaches the model and the conversation rather than only a page the user has to go find.

A run is reported as a stream of events rather than a single response: which capability was chosen, the arguments it actually used, when it started and finished, and what it returned. Progress is something the user can watch, and a failure is an event in that stream rather than a separate error channel. Confirmation is part of the exchange — a run that needs a press ends by saying so, and the client asks again once the user has agreed.

A turn hands the next one a small record of what it established: which rows were shown, and which searches this conversation produced. The client stores that record and returns it unread — its shape is the server's — so a reference shown in one turn still names the same row in the next, and a search already paid for is not run again. Everything else is re-read from storage rather than carried.

A turn ends exactly once, however it ends. A failure that occurs after real work has been done reports what survived rather than the failure: a captured total means a tab was opened, a wait was sat through, and a figure was stored, none of which a later error undoes.

Results are shown to the model as a projection that omits stored identifiers, and each row carries a short reference. The model names rows by that reference and the product resolves it to the identifier a capability needs, so the model can only act on rows it was actually shown and a reference it invents resolves to nothing.

Capability arguments are validated strictly and rejected rather than coerced. Dates must be calendar dates; an undeclared argument is an error, not something to ignore. A model-proposed hotel-search budget is grounded by citation rather than by digits: the model returns the amount it read plus the contiguous wording it read it from, that wording must occur verbatim in the request, and when the cited wording writes its amount in digits the amount must be one of them. A proposed date is grounded by membership rather than equality: deterministic extraction enumerates every date the request could support — dates it states, month/day wording normalized to its next occurrence, and each of those extended by a stated stay length or by the documented one-night default — and the proposed date must be one of them. Requiring it to equal a single deterministic reading would make the extractor the arbiter of how well a request can be read, which is the job the model is there to do better. A value that fails either check becomes a question naming what to supply, not a failed run. This admits a transcribed amount such as “一千”, which creates no information, while still refusing a derived one; its basis and flexibility are separate enums rather than arithmetic hidden in the amount. Capability results carry stored enum values and explicit date strings, leaving copy to the presentation layer.

## Documentation and Validation Rule

Every behavior, data-model, architecture, or assumption change updates this PRD in the same change. A change that alters what the product can do, or what has been verified, also updates `docs/STATUS.zh-CN.md`; a change that rests on a new decision adds an ADR under `docs/decisions/`.

Each document owns one tense and must not take on another: this PRD is what the product should be, `docs/decisions/` is why, `docs/SYSTEM_DESIGN_AND_AI_AGENT_INTERVIEW_GUIDE.zh-CN.md` is how it works now, `docs/CODE_REVIEW.zh-CN.md` is what was found and fixed, and `docs/STATUS.zh-CN.md` is the only description of the present. Figures that go stale — test counts, gate results — belong in `STATUS.zh-CN.md` anchored to the commit that produced them, never restated elsewhere.

Any Hyatt extraction behavior change requires unit/integration checks plus one real Hyatt validation through the app and normal Chrome with Browser Companion. Booking price validation uses the booking page/API, city search is started from the conversation on `/` and reviewed there or at `/hotel-search?sessionId=…`, and account import uses the desk action at `/desk`. If a real page cannot be validated, report that limitation and do not describe the extraction as verified.
