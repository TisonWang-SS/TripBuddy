# TripBuddy PRD

## Product Positioning

TripBuddy is a local-first hotel booking optimization product. It helps a traveler monitor hotel booking prices, compare direct and reference rates, account for loyalty value, and decide whether a booking should be kept, reviewed, or replaced.

The product is not an OTA. It does not book, cancel, pay, or modify reservations automatically. It gives structured evidence, recommendations, and user-confirmed actions.

## v0.1 Current Scope

TripBuddy currently supports:

- Local Next.js web app.
- SQLite-backed booking data.
- Hotel booking creation and editing.
- Manual price observations.
- Price observations shown as a compact list.
- Dedicated price observation edit page.
- Price observation deletion.
- Loyalty profile and point valuation setup.
- Credit card benefit setup.
- Manual promotion records.
- Rule-based recommendation generation.
- One-click promotion of an observed price into the current booking baseline.
- Decision history inside each booking detail page.
- Dashboard that shows one latest decision per booking.

## v0.2 Goal: Booking-Driven Automated Query + Evidence Structure

The next product goal is to make automated price checks a primary product capability. Manual and external inputs remain useful fallbacks, but the main user value should come from TripBuddy repeatedly checking prices so the user does not need to revisit hotel sites, OTAs, or award search tools by hand.

The system should automatically collect candidate cash rates and award availability from hotel direct channels first, then optionally reference OTA prices. Each collected rate must produce a structured evidence record explaining what the system knows, what it inferred, and what remains uncertain.

TripBuddy should remain booking-centered rather than becoming a general hotel search calendar. The core object is the user's current or candidate booking, and automated checks answer whether that booking should be kept, reviewed, or replaced.

Recommendations should no longer be understood as a simple hard-threshold result. The recommendation flow should become:

1. Booking watch plan decides which hotel group tools to call and how often.
2. Automated group-specific tools gather cash and award candidates.
3. Parser normalizes source data into structured observations.
4. Evidence builder evaluates source, room, policy, tax, loyalty, award, and promotion quality.
5. Deterministic cost engine calculates comparable cost breakdowns.
6. Guardrails block unsafe automatic recommendations.
7. LLM decision layer later receives evidence and cost breakdowns to produce a more human explanation and final recommendation tone.
8. User reviews and confirms any baseline change.

## Product Requirements

### Automated Price Checks

- Users can run a price check from a booking detail page.
- Automated query is a primary capability, not merely an optional import path.
- Each booking should have a watch plan that controls cash checks, award checks, direct checks, OTA reference checks, and cancellation-deadline urgency.
- The system should support a future scheduled daily check, but v0.2 can start with a manual "Run price check" button that uses the same tool path as scheduled checks.
- Direct hotel sources are preferred over OTA sources.
- Award availability is important and should be modeled alongside cash prices, because hotel loyalty value often comes from points redemptions.
- Different hotel groups should be implemented as separate tools behind a common interface. The app should automatically choose the relevant tool from the booking's hotel group.
- The first Hyatt automation can start with browser text extraction. It must be conservative: if room or policy equivalence cannot be verified, it should create a review-needed observation rather than a confident rebooking recommendation.
- Hyatt may block headless browser extraction with an E6020 response. The product must identify this as an automation block instead of presenting it as a normal no-rate result.
- Hyatt can return empty documents or KPSDK challenge pages to automated browser sessions. The product should treat these as unreadable evidence, not valid no-rate results.
- All Hyatt product flows use normal Chrome with the TripBuddy Browser Companion extension. There is no automated-profile fallback.
- Booking price import, city search, and account booking import use user-initiated browser tasks. TripBuddy opens one normal Chrome tab, the extension reads the visible rendered page, and the extension posts results to the local app.
- Browser task IDs and booking context stay in URL fragments and tab-scoped session storage so they are not required by the Hyatt server.
- The Browser Companion extension should only read the active tab when the user clicks import. It should POST visible page evidence to the local TripBuddy API and must not click, book, cancel, pay, or submit hotel forms.
- Browser Companion should also support a user-initiated automatic import link. TripBuddy may open the hotel source URL with the booking ID in the URL hash, then the extension can import visible page evidence after rate text appears. The hash must not be required by or sent to the hotel server.
- Browser Companion auto-import must wait for rate-like text, such as nightly cash prices, points rates, or final totals. It must not import merely because the hotel shell, navigation, or non-rate selection controls have rendered.
- Browser Companion should treat Hyatt room-list nightly prices as transient estimates for candidate selection only. Room-list estimates must not be stored as `PriceObservation` records when final price-summary or rate-detail evidence for a selected candidate is available.
- Browser Companion should prefer final price-summary evidence over room-list nightly estimates. For Hyatt, it may safely select a visible rate and rate plan to reach a pre-payment price summary, but it must never click payment, confirmation, purchase, or submit controls.
- Browser Companion must preserve the TripBuddy booking context across same-tab hotel navigations, because Hyatt room, rate-plan, and review pages may not preserve the original URL hash.
- Browser Companion imports should create a `PriceCheckRun`, store only observation-ready parsed candidates as `PriceObservation` records, preserve source URL and page text samples, and refresh the booking recommendation.
- Any behavior-changing update to browser evidence extraction must include at least one real Hyatt page test through normal Chrome and the Browser Companion extension, in addition to unit tests and build checks.
- Hyatt page-text parsing should support common cash formats beyond USD, including JPY/¥, EUR/€, GBP/£, SGD, MYR/RM, HKD/HK$, CNY/RMB, THB/฿, and KRW/₩.
- Hyatt cash parsing should preserve the observed page currency instead of assuming it matches the booking currency.
- Hyatt checks should request the booking currency when building the source URL. If the source cannot return the booking currency, the resulting observation should be treated as review-only until currency conversion exists.
- Hyatt `Avg/Night` cash rates must not be stored as booking totals. When no better evidence exists, the parser may compute a stay-level estimate as nightly rate multiplied by stay nights, keep the nightly value in `basePrice`, and mark tax or fee inclusion as unknown. If final total evidence exists in the same import, these estimates must be suppressed from `PriceObservation`.
- Hyatt room-list extraction should capture the visible room name and rate plan near the selected rate when available. Cancellation policy should remain unknown when it is not visible in the room list.
- Hyatt checks should use a staged evidence flow: collect room-list room/rate estimates first, select one or more backup candidates using current booking equivalence and user preferences, then read selected candidates' pre-payment detail pages for final total, taxes, fees, breakfast inclusion, and cancellation policy text.
- The future preferred Hyatt flow should support opening selected room/rate candidates in separate windows or tabs when the hotel UI permits it, so several candidate final totals can be collected in parallel. The first deterministic version may select only the closest matching room or the cheapest safe room before LLM candidate selection exists.
- The collector must never click payment, confirm booking, purchase, place order, or any equivalent final action. It may stop at pre-payment review/detail pages only.
- Hyatt award searches may still expose visible cash rates. When either cash or award checking is enabled, the collector should store any visible Hyatt cash or award candidate that it can parse as evidence from the same page.
- When page-text parsing finds no rates, the run should preserve a short text sample in the error details so parser gaps can be diagnosed.
- Hyatt direct checks should prefer canonical hotel-specific `/en-US/shop/rooms/{hotelCode}` URLs. If a hotel code cannot be parsed from the booking URL, the tool may use a curated hotel-name mapping for known properties.
- Collector outputs that are final-price or otherwise observation-ready must be stored as observations. Transient room-list estimates used only for candidate selection should remain run evidence or parser input, not user-facing `PriceObservation` rows.
- If a collector fails, the booking should show a readable failure state and preserve prior observations.
- Manual observations and external results remain fallback and augmentation channels.

### Evidence Quality

The product should stop exposing numeric confidence to users. Instead, each candidate rate should show a human-readable evidence quality summary:

- High: verified source, exact room match, same or better cancellation policy, known tax inclusion, known loyalty eligibility.
- Medium: direct or credible source with one soft uncertainty, such as similar room match or inferred tax inclusion.
- Low: missing or uncertain key fields.
- Needs review: unknown room match, unknown cancellation policy, currency mismatch, or other blocker.

User-facing evidence should answer:

- Where did this price come from?
- Was it collected automatically or entered manually?
- Is the room equivalent?
- Is the cancellation policy equivalent or better?
- Are taxes and fees included?
- Does it earn loyalty credit?
- Does a known promotion apply?
- What facts are uncertain?

### Recommendation Behavior

Hard thresholds should become guardrails, not the whole decision.

- The deterministic engine still calculates cash savings, effective savings, point value, promotion value, credit card value, elite progress value, and benefit value.
- The system should avoid recommending action when source evidence has hard blockers.
- Missing final tax/fee inclusion or currency mismatch should force `needs_review`; it must not produce an automatic rebook recommendation.
- OTA rates should remain reference-first unless marked loyalty eligible and policy-equivalent.
- Near cancellation deadlines should be surfaced even when savings are below the normal threshold.
- Future LLM recommendations should use structured evidence and cost breakdowns as input, not raw page text alone.
- Future LLM recommendations should select among structured room/rate candidates using trip preferences, party type, room needs, breakfast needs, cancellation sensitivity, and current booking equivalence. The tool layer should extract facts; the LLM layer should make preference-sensitive tradeoffs.

### User Actions

Users should be able to:

- Run automated price check.
- View collected candidates.
- Inspect evidence for each candidate.
- Edit or correct an observation.
- Delete an incorrect observation.
- Mark room match or cancellation match manually when the system is uncertain.
- Promote a candidate to the current booking baseline after the user has rebooked externally.

## Out of Scope

- Automatic booking.
- Automatic cancellation.
- Payment handling.
- Full OTA fulfillment.
- Automatic login credential handling in the first automated-query pass.
- Fully LLM-driven decision making without deterministic evidence.

## Documentation Rule

Every future code change that affects product behavior, data model, architecture, tests, or assumptions must update this PRD and `docs/IMPLEMENTATION_PLAN.md` in the same change.
