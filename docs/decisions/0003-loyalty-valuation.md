# ADR 0003: Only resaleable loyalty value is priced; the rest is shown, not scored

## Status

Accepted.

## Context

TripBuddy's audience is the loyalty-program traveler. For that traveler the cheapest booking is routinely not the best one: a redemption can beat cash outright, a stay can complete the qualification that releases a suite upgrade award, and a rate can carry breakfast and lounge access the cheaper one does not.

The product already computes part of this, and computes some of it dishonestly. `decision.ts:256-276` values breakfast, lounge, late checkout, and room upgrade at flat per-night figures from `UserProfile`, adds a flat `nights × eliteNightValue` for elite progress, and subtracts the total from `effectiveCost`. Those five numbers are guesses with two decimal places, and folding them into a comparable cost makes the comparison look more precise than it is.

Three things it cannot do at all.

**It cannot value a redemption.** `LoyaltyAccount.pointValue` is a single flat number. Nothing computes what *this* redemption returns per point, so the product cannot say whether paying with points beats paying cash for the same room.

**It cannot value a certificate.** Free-night awards and suite upgrade awards trade at observable prices and are frequently the deciding factor between two options. The product has no representation of them.

**It cannot value tier progress.** `eliteProgressValue` does not change as the traveler approaches a threshold, so a stay that completes qualification and a stay that does not are valued identically.

That last gap is deliberate and documented. `docs/CODE_REVIEW.zh-CN.md` §1.6 removed `LoyaltyAccount.currentNights / currentPoints / currentSpend / targetTier` and `LoyaltyRule.nightsRequired / pointsRequired / spendRequired`, on the grounds that the product was collecting qualification data it never used, and that these fields must not enter a stay's cost until there is an explicit model for whether a stay crosses a threshold and what crossing is worth. That was correct, and it named the condition for reversing itself. This ADR supplies the model — and, applying the same standard to the numbers already in the code, removes the ones that never met it.

## Decision

### The line: does it have a price someone else pays?

A loyalty benefit enters the cost arithmetic only if it has an observable market value. Everything else is presented as a fact and left to the traveler.

| | Priced | Shown |
|---|---|---|
| Covers | points, free-night awards, suite upgrade awards | breakfast, lounge access, late checkout, room upgrade |
| Why | a secondary market quotes them, so the number has a source outside this product | worth varies by traveler and by trip — alone on expenses versus with family, one night versus five |
| Enters `effectiveCost` | yes | **no** |
| Appears in the recommendation | as a figure with provenance | as an entitlement, and as a warning when a candidate loses one |

The second column is not an unfinished version of the first. There is no correct figure to discover for breakfast, so the product stops pretending to know one. Removing these from the arithmetic makes `effectiveCost` narrower and truthful rather than broad and invented.

**No language model estimates anything in either column.** Not a point value, not a certificate value, not a breakfast value. A model may explain a computed result in the traveler's language, naming figures that already exist in the `CostBreakdown` it describes. A model that estimates a valuation is overwriting the traveler's own configuration, unreproducibly and without audit.

### Priced value carries provenance and expires

Point values and certificate values are stored with `sourceName`, `asOf`, and `lastReviewedAt`, following the discipline `LoyaltyRule` and `CurrencyConversionRate` already use: a value, who says so, and as of when. They drift, so they expire.

A valuation past its review date is not silently used and does not silently vanish. It downgrades the confidence of any recommendation depending on it and names which figure is stale — matching how a missing currency conversion already behaves, where `getCurrencyConversion` returns null and the caller refuses rather than assuming.

### Redemptions are compared, not assumed

For a candidate offering both a cash rate and an award rate on a comparable room:

```
cpp = (cash total − taxes and fees payable on the award) ÷ points required
```

compared against the traveler's recorded point value. That a redemption beats cash, or does not, is a product conclusion — computed deterministically and shown with both figures.

A redemption whose points requirement and cash comparison do not come from the same evidence capture is not compared. A missing input produces no comparison, never an estimated one.

### Threshold crossing is valued by what crossing releases

This is what makes tier progress computable without a subjective input.

Crossing a qualification threshold or milestone grants specific certificates. Those certificates are in the priced column. So the value of crossing is the value of what it releases, and no separate "what is a tier worth to you" number is needed:

```
crossing value = Σ (certificate granted × its sourced value × realization rate)
```

The rest of what a tier confers — breakfast, lounge, upgrades on every future stay — stays in the shown column, for the same reason it does anywhere else. The product does not claim to know what a year of lounge access is worth.

Two facts the product computes and can defend, independent of any valuation:

- whether this stay crosses a threshold or milestone;
- how far short it leaves the traveler — *this stay leaves you one night short of Globalist* is a statement made from recorded progress, the stay's qualifying nights, and the program's published threshold.

Deriving crossing value from projected future benefit is rejected. It requires forecasting travel the product cannot see, and a forecast dressed as a computation is worse than an admitted assumption.

Qualification periods, thresholds, milestones, and what each milestone grants are program facts, stored per program with `sourceUrl` and `lastReviewedAt` beside the existing tier benefit rules.

### Promotions are milestones with an expiry date

*Stay 5 nights, receive a free night* and *reach 30 nights, receive a suite upgrade award* are the same shape: accrue a count, receive something priced. They are modelled together.

Today's `Promotion` is spend-proportional only — `bonusMultiplier` applied to base points, plus a `flatValue`. That expresses *earn double points* and nothing else. It gains a night or stay count and a grant, so a registration-gated seasonal offer computes exactly like a program milestone, with `requiresRegistration` and the existing date window deciding whether it is live.

### Accrual allocation is the traveler's choice, not the product's

An accrual that needs N nights raises a question the arithmetic cannot settle: which stay gets the value?

**At threshold (default).** The value lands entirely on the stay that completes the count. Earlier stays carry zero. This is the marginally correct answer to the question this product actually asks — *keep this booking or replace it* — because the stay that completes the count is the one whose loss costs the whole grant.

**Amortized.** The value spreads across the nights that earned it, so each night carries its share. Some travelers budget this way and read a per-night figure more naturally.

Neither is more true; they answer different questions. The default is *at threshold* because it matches the decision on screen. The mode is recorded per traveler.

**Amortized mode may only spread value across nights already booked.** If the promotion needs five nights and the traveler has five booked, the grant is secured and spreading it is allocation. If only three are booked, the grant is not secured and its value is zero in both modes — the product instead states the fact it can defend: *two more nights would release this*. Amortizing across nights that might be booked later would smuggle back the forecast this ADR rejected two sections above, one accounting convention at a time.

The magnitude never comes from the traveler. Points are valued at their recorded cpp, certificates at their sourced price. What the traveler chooses is when the value is recognised, not how much it is.

### Realization rate adjusts the market price; it does not re-derive it

A suite upgrade award only pays off when a qualifying suite is available at check-in. Its secondary-market price already embeds the market's average expectation of that, so applying a probability on top of the market price would discount it twice.

The realization rate is therefore an adjustment **relative to the market**, defaulting to 1 — trust the quoted price. A traveler who systematically fails to clear awards, because of where or when they travel, lowers it and sees the effect. It is stored per certificate type and displayed alongside any figure derived from it.

Spending a certificate on a stay is a cost. Earning one is a benefit. Both are priced this way.

### Shown value stays load-bearing by becoming a warning

Taking breakfast out of the arithmetic must not make it disappear from the decision. A candidate that is $40 cheaper because it drops an entitlement the current booking has would otherwise read as $40 of savings.

So an entitlement the baseline holds and a candidate does not becomes a **warning on that candidate**, in the same machinery that already carries the cancellation-policy downgrade (§3.1, §3.17): `DecisionCandidate.warnings`, rendered through `EvidenceIssues` before any control that changes a baseline, as `PRD.md:121` requires.

The traveler decides whether losing breakfast is worth $40. The product's job is to make sure they are never asked to decide it without being told.

### Traveler preferences rank and filter; they never price

Breakfast is worth nothing to someone who does not eat it. That is the argument for keeping it out of the arithmetic, and it is also what the product should act on — so preferences need somewhere to live.

They split the same way everything else in this ADR does, by what they are allowed to touch.

**Structured preferences** are stored with the rest of the profile and drive deterministic behaviour. Their first job follows directly from the warning rule above: an entitlement the traveler does not care about **stops generating a loss warning**. A traveler who never eats breakfast is not told that a candidate drops breakfast, because for them it is not a loss. Preferences also order the shown entitlement list and can filter candidates outright.

**Free-text notes** — the `SOUL.md` shape — are read by the agent for tone and lean, and never parsed for facts. *I travel with a toddler, quiet floors matter, I would rather pay a bit more than change hotels mid-trip* is guidance no schema will capture and no arithmetic should try to.

The boundary, stated so it cannot erode: **a preference may reorder, filter, suppress a warning, and shape what the agent says. It may not change a figure in `CostBreakdown`, and it may not change a verdict.**

The reason is the whole argument of this ADR arriving by a side door. If preferences adjust `effectiveCost`, then breakfast has a number again — an unauditable one, this time buried in a document instead of a form field. Suppressing a warning is visible and reversible: the traveler set it, they can unset it, and the entitlement is still listed. Silently moving a cost is neither.

For the same reason, free-text notes reach the agent's prose and the ranking it explains, never the deterministic decider. A note saying *I do not care about price* must not be able to change what the product computes the price to be.

**Why the structured half cannot simply live in the document too.** A single traveler-authored markdown file, read by the agent each time, is the more appealing shape and the wrong one for this half. Suppressing a warning is behaviour, and behaviour in this codebase has to be assertable: *this candidate drops breakfast, this traveler does not want breakfast, therefore no warning and `effectiveCost` unchanged* is a test. The same rule re-derived by a model reading prose is not a rule — it holds on most runs, which for a suppression rule means it silently fails on the others, in the direction of hiding something the traveler should have seen.

So the division is not by storage taste but by testability: anything that changes what the product **does** is structured and covered by a test; anything that changes how the agent **speaks** is free text. A traveler may still edit both from one place — the document can be the editing surface, and the structured fields parsed out of it with a strict codec, the same treatment every other structured payload in this codebase gets. What must not happen is a deterministic behaviour whose only definition is a sentence a model re-interprets on each run.

### Cross-program comparison is out of scope here

Progress value is meaningful only inside one program. This ADR permits it to be computed for same-program comparisons only.

A comparison spanning programs — Hyatt against IHG, or against an OTA booking that earns nothing — must display forfeited progress **as its own figure**, never netted into `estimatedSavings`. The model for deciding whether forfeiting progress is worth it is a separate decision needing its own ADR. What is settled here is only that it may not be hidden inside a savings number.

### Fields exist only if something computes with them

§1.6's rule, applied in both directions. The qualification fields it deleted return as this model is implemented, and only the ones the model consumes. The subjective value fields now leave, because after this decision nothing computes with them.

## Consequences

**Removed**, since nothing calculates with them any more:

- `UserProfile.breakfastValue`, `loungeValue`, `lateCheckoutValue`, `upgradeValue`, `eliteNightValue`, and their Profile form inputs, `actions.ts` parsing, seed values, and `get_settings` exposure.
- `CostBreakdown.benefitValue` and `eliteProgressValue`, the two `effectiveCost` terms at `decision.ts:275-276`, and the `["Elite progress value"], ["Included benefits value"]` rows on the booking page.
- `Recommendation.benefitValueDifference` and `eliteProgressDifference`. Historical rows are migrated, not deleted; past recommendations keep the composition that produced them.

**Kept**: `LoyaltyRule.breakfastBenefit / loungeBenefit / lateCheckoutBenefit / upgradeBenefit`. They stop feeding arithmetic and start driving the shown entitlement list and the loss warnings.

**Added**:

- Sourced valuation storage for point values, free-night awards, and suite upgrade awards, each with source, `asOf`, and `lastReviewedAt`; realization rate per certificate type.
- `LoyaltyAccount` qualification progress and program thresholds, milestones, and grants — arriving with the calculations that read them, not before.
- `Promotion` gains a night or stay count and a grant, so a seasonal offer and a program milestone compute through one path.
- A per-traveler accrual allocation mode, defaulting to *at threshold*.
- Structured entitlement preferences, and a free-text traveler document the agent reads for lean. Neither may reach `CostBreakdown` or a verdict.
- `CostBreakdown` components for redemption comparison, certificates, and threshold crossing. `effectiveCost` stays one comparable number; its composition becomes inspectable and every term in it has a source.

**Behaviour change to expect.** `effectiveCost` no longer absorbs benefit value, so raw price differences will drive more comparisons than before, and some existing recommendations will flip. This is the intended effect: the product stops resolving a judgment call arithmetically and starts presenting it. The loss warnings are what keep that from becoming a downgrade machine, so they ship in the same change as the removal — not after it.

**Tests.** Deterministic decision cases for: a redemption that beats cash and one that does not; a stay that crosses a milestone and one that leaves the traveler short; a stale sourced valuation; a certificate at a realization rate below 1; a cheaper candidate that drops an entitlement, asserting the warning rather than a price adjustment; the same case with that entitlement marked as not wanted, asserting the warning disappears **and `effectiveCost` does not move**; and amortized allocation with the count unmet, asserting zero rather than a share.

**Multi-program.** IHG, Hilton, and an OTA comparison channel can proceed on the existing provider registry. A cross-program verdict stays blocked until the follow-up decision exists.
