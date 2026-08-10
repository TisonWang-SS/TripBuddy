# ADR 0001: Price checks require foreground user initiation

## Status

Accepted.

## Context

TripBuddy reads Hyatt through the Browser Companion in the user's normal Chrome session. A check requires a visible tab, the user's existing login state, and a short interactive capture window. A server-side scheduler cannot complete that work without introducing headless browsing, CDP, copied profiles, or unattended browser control, all of which are outside the product's safety boundary.

The original schema exposed `scheduled` price-check runs plus normal and urgent cadence fields even though no runtime connected them to a truthful execution model. Deleting those columns would discard existing user configuration; treating them as a background scheduler would promise an unavailable capability.

## Decision

Price checks are foreground-only and explicitly started by the user. When the Dashboard opens, TripBuddy uses each enabled watch plan's last completed check, normal cadence, urgent cadence, and cancellation window to derive a due queue. A queued item is only a reminder: it starts after the user clicks and opens normal Chrome with the Browser Companion.

`PriceCheckRun.trigger` records `manual` or `due_queue` as provenance. The legacy `scheduled` value is migrated to `due_queue` without deleting historical runs. The queue must not silently add a headless or copied-profile execution path.

## Consequences

- The API and `PriceCheckRunner` accept only foreground `manual` and `due_queue` triggers.
- Watch-plan cadence fields now drive visible Dashboard reminders.
- No browser task is created merely by opening the Dashboard.
- A background scheduler requires a new product and architecture decision rather than reusing the foreground queue label.
