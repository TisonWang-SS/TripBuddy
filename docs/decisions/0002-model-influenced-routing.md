# ADR 0002: A model may choose an intent, never an outcome

## Status

Accepted. Its final paragraph — reserving "the model writes prose to the user" for a separate decision — was taken up and superseded by [ADR 0005](0005-model-writes-advice.md). Everything else here still holds, and the router described below survives as the offline path.

## Context

Until now the model in this product had no influence on control flow. The evidence extractor proposes facts, and every proposal must pass schema validation, page grounding, currency agreement, and arithmetic checks before it becomes an observation. If the model fails, nothing happens; if it lies, the guards reject it. That is the arrangement `docs/CODE_REVIEW.zh-CN.md` §4.3 calls "model proposes, never authorizes".

A conversational entry point breaks that symmetry. Routing means reading a sentence and deciding which capability runs. The model is no longer proposing a fact to be checked against a page — it is choosing what happens next, and there is no page to check the choice against.

The risk is not that the router picks the wrong read. It is that a chat box implies a general assistant, while this product does exactly eleven things and structurally refuses to book, cancel, or pay. A router that tries to be helpful about a request it cannot serve is how an interface starts promising flights.

## Decision

The model chooses an intent. It never produces an outcome.

Concretely, the model receives the capability catalogue and one sentence from the user, and returns `{capability, args}` and nothing else. It does not see a booking, a price, a verdict, an evidence record, or the result of the capability it selected. It does not write any text the user reads.

Everything it returns is checked before it is acted on:

- A capability name outside the catalogue is treated as out of scope, not passed through.
- Arguments go through the same strict parser a hand-written call uses, so an invented parameter or a natural-language date is rejected rather than coerced.
- Choosing a capability is not permission to run it. Anything that opens a browser tab still requires explicit user confirmation, enforced in `invokeCapability`.

Two refusals are deterministic and sit in front of the model rather than behind it:

- **Actions the product never takes.** Booking, cancelling, paying, confirming, or modifying a reservation is refused by pattern match before either routing path runs. This mirrors the Browser Companion's unsafe-control rules, which the server enforces rather than trusting the page — the model never gets the opportunity to route these.
- **Out-of-scope subjects.** The refusal sentence is product-owned copy. The model signals that a request is unsupported; it does not get to describe what the product does.

The router degrades rather than fails. With no API key, or when the provider is unreachable, it falls back to keyword matching over the same catalogue — the behaviour the command bar already had. A local-first product stays usable offline, and the decision records which path produced it.

Both paths are scored against one fixture set, with the deterministic router as the checked-in baseline. A model router that scores below keyword matching is not an improvement.

## Consequences

- Adding a capability makes it routable with no prompt edit; the catalogue is built from the registry.
- The router's blast radius is bounded by the capability layer. It can send a user to the wrong read, which is visible and recoverable. It cannot spend money, change a baseline, or open a tab on its own.
- User-facing copy stays product-owned. Clarifying questions reuse the capability parser's own messages rather than model prose.
- Prompt injection in a user's own sentence is a lower-severity threat than in scraped page text, but the request is still framed as data. The deterministic refusals hold regardless of what the sentence says.
- Letting the model write prose to the user, summarise a result, or explain a verdict is a separate decision and needs its own ADR. The line drawn here is intent only.
