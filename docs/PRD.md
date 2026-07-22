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
- Hyatt may also return an empty `200 text/plain` document to remote-debugging Chrome sessions. The product should treat this as an automation block or unreadable document, not as a valid no-rate result.
- Users can switch a booking's watch plan between browser-assisted import, Chrome profile automation, server automation, and visible automation window modes.
- Browser-assisted import is the preferred Hyatt path after CDP testing showed Hyatt can return empty documents or KPSDK challenge pages to remote-debugging profiles. The user opens Hyatt in a real Chrome TripBuddy profile, then explicitly imports visible page evidence through the TripBuddy Browser Companion extension.
- Chrome profile automation is an experimental fallback. TripBuddy opens the user's real local Chrome app with a dedicated TripBuddy-managed Chrome data directory and a local Chrome DevTools Protocol port, then connects to that real Chrome tab to extract visible page text.
- Chrome profile mode must not depend on Codex, the Codex browser connector, or a Codex-managed browser session. It is a TripBuddy product capability.
- Chrome profile mode should use a dedicated travel-checking Chrome data directory instead of the user's daily browser profile.
- The default Chrome data directory should be project-local at `data/chrome-cdp-profile`. Users may sign in to hotel accounts once in this dedicated Chrome session so hotel cookies and login state persist across checks.
- The dedicated Chrome data directory will look like a separate empty Chrome profile at first launch. This is expected and keeps TripBuddy hotel sessions isolated from the user's daily Chrome profile.
- Chrome debugging should default to automatic port selection to avoid stale fixed-port Chrome sessions blocking new checks.
- Chrome profile mode should open at most one TripBuddy-owned tab per check. On a fresh launch, the connector should reuse the startup blank tab and navigate it to the hotel URL instead of opening the hotel URL during launch and then creating a second tab.
- When automatic port selection is enabled, stale `DevToolsActivePort` data should be ignored or cleared only after the saved endpoint is confirmed unreachable.
- Server automation and visible automation window modes are best-effort fallbacks only. If a hotel blocks those modes, the product should prefer Chrome profile mode or browser-assisted import rather than escalating into brittle anti-bot workarounds.
- If Chrome profile mode is blocked at the document level, the next preferred direction is a user-browser-assisted extractor such as a companion Chrome extension or a macOS Chrome automation path that reads the user's real rendered tab with explicit user permission.
- The Browser Companion extension should only read the active tab when the user clicks import. It should POST visible page evidence to the local TripBuddy API and must not click, book, cancel, pay, or submit hotel forms.
- Browser Companion should also support a user-initiated automatic import link. TripBuddy may open the hotel source URL with the booking ID in the URL hash, then the extension can import visible page evidence after rate text appears. The hash must not be required by or sent to the hotel server.
- Browser Companion auto-import must wait for rate-like text, such as nightly cash prices, points rates, or final totals. It must not import merely because the hotel shell, navigation, or non-rate selection controls have rendered.
- Browser Companion should prefer final price-summary evidence over room-list nightly estimates. For Hyatt, it may safely select a visible rate and rate plan to reach a pre-payment price summary, but it must never click payment, confirmation, purchase, or submit controls.
- Browser Companion must preserve the TripBuddy booking context across same-tab hotel navigations, because Hyatt room, rate-plan, and review pages may not preserve the original URL hash.
- Browser Companion imports should create a `PriceCheckRun`, store parsed candidates as `PriceObservation` records, preserve source URL and page text samples, and refresh the booking recommendation.
- Hyatt page-text parsing should support common cash formats beyond USD, including JPY/¥, EUR/€, GBP/£, SGD, MYR/RM, HKD/HK$, CNY/RMB, THB/฿, and KRW/₩.
- Hyatt cash parsing should preserve the observed page currency instead of assuming it matches the booking currency.
- Hyatt checks should request the booking currency when building the source URL. If the source cannot return the booking currency, the resulting observation should be treated as review-only until currency conversion exists.
- Hyatt `Avg/Night` cash rates must not be stored as booking totals. The collector should store the visible nightly rate as base price, multiply it by stay nights for the candidate total, and keep tax or fee inclusion as unknown unless the page exposes a reliable total.
- Hyatt room-list extraction should capture the visible room name and rate plan near the selected rate when available. Cancellation policy should remain unknown when it is not visible in the room list.
- Hyatt Chrome profile checks should use a two-step evidence flow when possible: collect room-list candidates first, select the lowest visible safe cash rate, then read the subsequent pre-payment detail page for final total, taxes, fees, and cancellation policy text.
- The collector must never click payment, confirm booking, purchase, place order, or any equivalent final action. It may stop at pre-payment review/detail pages only.
- Hyatt award searches may still expose visible cash rates. When either cash or award checking is enabled, the collector should store any visible Hyatt cash or award candidate that it can parse as evidence from the same page.
- When page-text parsing finds no rates, the run should preserve a short text sample in the error details so parser gaps can be diagnosed.
- Hyatt direct checks should prefer canonical hotel-specific `/en-US/shop/rooms/{hotelCode}` URLs. If a hotel code cannot be parsed from the booking URL, the tool may use a curated hotel-name mapping for known properties.
- Collector outputs must be stored as observations, not transient UI-only results.
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
