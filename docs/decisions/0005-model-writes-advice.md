# ADR 0005: A model may read results and write advice, never the numbers

## Status

Accepted. Supersedes the final paragraph of [ADR 0002](0002-model-influenced-routing.md), which reserved this decision for its own record.

## Context

ADR 0002 drew a narrow line: the model chooses which capability runs, sees nothing of what it returns, and writes no text the user reads. That was the right line for a command bar. It is the wrong line for the product this is becoming.

Three things it made impossible, each of which is the thing a person actually wanted:

- **Advice.** "Which of these should I take?" cannot be answered by a router that never sees a price. The product could stamp a deterministic verdict on a booking it already tracked, but it could not look at eight hotels it just found and say anything about them.
- **Decomposition.** A request like "东京 9 月 1 日住 3 晚，预算每晚 1500，跟我现在的预订比一下" is three steps. A router that returns one capability answers a third of it and drops the rest silently.
- **Follow-through.** A starting Avg/Night excludes taxes and fees, so it cannot settle a budget. Knowing that a total was needed — and going to get one — was left to the reader, as a button beside each hotel.

The interface made the same shape of mistake. Results rendered on `/hotel-search`, behind a nine-field form, while the conversation showed a card saying "a tab was opened, look over there".

## Decision

The model runs an agent loop. Each turn it deliberates, may call tools, observes what they returned, and repeats until it can advise, needs something only the user can supply, or runs out of steps. It writes the sentence the user reads.

**What widened.** The model now sees tool results and authors prose. Hotel search, price checks, and the tax-inclusive upgrade are tools it decides to call, rather than intents it is routed to.

**What did not.** It still cannot produce an outcome. Five guards, all enforced in code:

1. **A view, not the result.** Every tool result is projected in `modelView.ts` before the model sees it. Profile ids, observation ids, and source URLs never enter its context. Free text off a Hyatt page is length-capped and framed as data.
2. **Refs, not prices.** A recommendation is `{ref, reason}`. The label, the money, and the caveat beside it are read from the stored result. The model can be wrong about which hotel suits someone — visible, arguable — but not about what it costs.
3. **Grounded prose.** A money-sized figure in its message must be one the tools produced, or a difference between two of them. Anything else is rejected, retried once, and then abandoned.
4. **A tab needs a press.** Every capability that opens Hyatt suspends the turn and asks. One press authorises one call; it is spent, not held. This is stricter than what it replaces — `search_hotels` used to start from a typed query without a second press.
5. **The old deterministic refusals, unmoved.** Booking, cancelling, paying, confirming, or modifying a reservation is refused by pattern match before the model runs. The sentence describing what this product *is* stays product-owned; the model may only explain why one particular request cannot be served.

**Waiting.** After a browser task starts, the loop waits on the server for the Companion's evidence and feeds it back. This is what puts real results in the conversation. It changes nothing about how the work is done: still a visible normal-Chrome tab, still opened by the user, still completed by the extension posting evidence back.

**Degradation.** With no API key the loop does not run. Keyword routing picks one capability and product copy answers, which is what the command bar had. Less capable, and honest about it.

## Consequences

- The conversation is the product's front door. `/desk`, `/bookings`, and `/hotel-search` are where a result is looked at again, not where work starts. `/hotel-search` lost its form; the palette lost its ability to ask.
- `get_tax_inclusive_total` exists as a capability. The judgement of *when* a verified total is needed moved from the reader to the loop.
- Blast radius is still bounded by the capability layer. The loop can advise badly, which the user can see and disagree with. It cannot spend money, change a baseline, or open a tab unpressed.
- The failure mode this trades for is new: confident, well-written, wrong reasoning. Guards 2 and 3 mean it cannot be wrong about a number, which is the version of it that would cost someone money. It can still be wrong about a judgement, and that is the risk being accepted.
- Prompt injection now has a second position to occupy: tool results carrying scraped page text. Previously the model saw only the user's own sentence. The projection, the length caps, and the data framing are the response; the deterministic refusals hold regardless of what any of it says.
- Turns are bounded at six tool steps. A loop that keeps proposing tools is made to conclude from what it has.
