# ADR 0006: A second price source, collected without a browser

## Status

Accepted, as the record of what `99bc9cb` shipped. Supersedes the "OTA collection or non-Hyatt collection" exclusion in the v0.2 boundary of `docs/PRD.md`.

One consequence of that commit is recorded below as an open question rather than a decision, because it was never stated anywhere and is still unresolved.

## Context

Until now every price in this product came from one place and arrived one way: a Hyatt page, read by the Browser Companion, in a visible tab the user opened. That single path is what made the evidence rules tractable — "where did this number come from" always had the same answer, and `docs/PRD.md` could require a visible final total plus a taxes-and-fees breakdown before a price counted.

It also made the product's central question hard to answer. "Is this a good price?" needs a second number, and the only second number available was a different date or a different Hyatt hotel.

The v0.2 boundary listed OTA collection as explicitly out of scope. That was a scoping decision made when the only conceivable way to collect one was to drive another website through the Companion — inheriting every anti-bot problem Hyatt already presented, times the number of OTAs.

An authenticated API removes that objection. RollingGo Global exposes hotel room rates over MCP, and the user already has a logged-in Global skill whose token sits at `~/.hotel-global-cli/token.json`.

## Decision

TripBuddy collects a comparison price from one third-party source, over an authenticated API rather than a browser.

**Scope.** It is a comparison price only. The product still never books, cancels, pays for, confirms, or modifies anything, on any source. Everything in the "Product Positioning" section of `docs/PRD.md` holds unchanged; what changed is where a number may come from, not what the product does with it.

**Shape.** The OTA is a `HotelOtaPriceProvider` on the existing provider contract, alongside `hotelSearch` and `bookingPrice`. It is asked only for hotels the primary search already found, and by the name that search returned, so a third-party display name cannot invent a row. Its cheapest room quote is stored as one more offer on that hotel, with `sourceType: "ota"` and its own `capturedAt`.

**Failure is silent and total.** No token, no login, a timeout, or an unparseable response yields no OTA offers and a warning on the session. The Hyatt result is what it always was. A comparison source that can take the primary result down with it is worse than no comparison source.

**Opt-in by possession.** There is no setting. The adapter runs when a token file exists and is valid, which means the feature appears when the user has already signed in to the Global skill elsewhere.

## Consequences

- The evidence model now spans two collection methods with genuinely different guarantees. A Hyatt `final_total` was read off a rendered pre-payment page with a visible tax and fee breakdown. An OTA quote is a JSON field from an authenticated API. Both now sit in the same `offers` array on the same hotel.
- Budget judgement widened. `findComparableFinalOffers` previously accepted only `evidenceLevel === "final_total"`; it now also accepts `verified_offer` when `sourceType === "ota"`, returns every comparable offer rather than the first, and judges a hotel as within budget when **any** of them fits. A hotel can therefore be called within budget on the strength of an OTA number alone.
- `consider_ota` was already a verdict the deterministic decider could produce. It now has real evidence behind it rather than being reachable only in principle.
- The Browser Companion rules are untouched. This path opens no tab, so "every check requires explicit user initiation and a visible normal-Chrome tab" continues to describe every browser-collected price. It does not describe this one, which is the substance of the open question below.

## The all-in assumption

**Settled: this source quotes all-in prices, and the code says so deliberately.**

`parseRollingGoHotelDetail` returns `taxesIncluded` from a constant, not from a response field, because the response has no such field. RollingGo Global quotes what the traveler would actually pay and publishes no tax or fee breakdown. `hotelSearchTasks.ts` derives `feesIncluded: "included"` from the same fact, which is what lets an OTA row qualify a hotel against a budget.

This does not conflict with the "Evidence Quality" rule about incomplete taxes and fees. That rule is about a price whose *inclusion* is unknown. Here inclusion is known and the *breakdown* is unavailable — a weaker claim about detail, not about the total. The offer's warning now says exactly that, where it previously read as if inclusion itself were in doubt.

What is accepted with it: **if the source ever begins quoting pre-tax prices, nothing in this codebase would notice**, and every OTA row would silently understate. That is why the assumption is a named export, `OTA_QUOTES_ARE_ALL_IN`, with a test whose stated job is to be deliberately failed if that ever changes — rather than an inline literal nobody could find.

## Open question

**Collection method is not visible in the evidence.** A reader comparing two rows sees two totals in the same currency. Nothing in the rendered row says one was read from a rendered page under the staged-evidence rules and the other came from an API response that cannot be re-verified by opening a tab. `sourceType` distinguishes `direct` from `ota`, which is about *who sells it*, not *how we know*.

This one is unresolved. It matters most when the two disagree: a reader deciding between a Hyatt total captured under the staged-evidence rules and a cheaper OTA total from an API response is comparing two claims of different strength, and the interface presents them as peers.

## Verification

The parsing and comparison paths are covered by unit tests: lowest-room selection, the live schema's `averagePrice × nights` derivation, refusal to build a stay total from a nightly reference price alone, the all-in assumption itself, and the comparison layer accepting an OTA quote as budget-comparable while keeping its softer evidence level.

**Not verified against the live service.** Doing so needs an active Global skill login, which was out of scope for this pass. No end-to-end capture through the real API has been recorded, so the request shape and the live response schema are checked only against fixtures written from documentation. This is the same gap `docs/PRD.md` names for Hyatt extraction changes, and it stays open.

## Notes

`99bc9cb` shipped this with a README section and `.env.example` entries, and did not touch `docs/PRD.md`, `docs/STATUS.zh-CN.md`, or `docs/decisions/`. That is the documentation rule in `docs/PRD.md` not being followed, and it is how a v0.2 boundary line came to be contradicted by the code it was meant to bound. This ADR and the accompanying PRD and STATUS edits are retroactive.
