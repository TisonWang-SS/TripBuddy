# ADR 0007: Asking is the initiation; only a write asks twice

## Status

Accepted. Narrows the "explicit user initiation" clause of ADR 0001 and the v0.2 boundary in `docs/PRD.md` to mean *the user asked for this*, rather than *the user pressed an extra button*.

## Context

ADR 0005 gave every capability that opens Hyatt a confirmation card: the turn stopped, the user pressed, and the run resumed on the next request. The reasoning was that a tab opening on someone's screen is an action taken on their behalf.

In use it did not read that way. The card appeared for every price question, always said a version of "this opens a Hyatt tab, nothing is booked", and was always pressed. A confirmation that arrives every time and is accepted every time is not consent — it is a step. Worse, it made every price question a two-exchange affair: ask, press, read. Following up ("and the points price?") started the same two steps again.

The clause it was implementing says something narrower than it was read as saying. `docs/PRD.md` requires that a check be *explicitly initiated by the user* and run in a *visible normal-Chrome tab*. Someone typing "查一下上海 9 月 1 日的酒店" has explicitly initiated it. The visible tab is unchanged. What the card added was a second acknowledgement of a decision already made.

## Decision

A browser task runs on the strength of the request. A write still asks.

**Browser tasks** — hotel search, price check, tax-inclusive total, account import — are reads. They collect evidence and store it; nothing about the user's bookings or the world changes. The request is the initiation, the tab is still opened in the user's own Chrome, and it is still visible.

**Writes** still stop and ask, with product-owned copy stating exactly what will change. A read that turns out unwanted is re-read; a write that turns out unwanted has already happened and the user has to undo it by hand. `requiresConfirmation` is now `effect === "write"`, and `invokeCapability` still refuses an unconfirmed one, so a caller that forgets cannot write by accident.

**The tab is opened by the send keystroke.** Chrome allows `window.open` only inside a gesture, and with the confirmation press gone, sending the message is the only gesture the turn has. The client opens a blank tab when the message looks like it may need one, and the run points it at an address when it has one.

That guess is allowed to be wrong, in both directions. Opening a tab that goes unused costs a tab that is closed again. Failing to open one — a wrong guess, or a blocked pop-up — makes the launch arrive with nowhere to go, and the conversation renders a link instead; the server is already waiting on the task, so opening it any time before the task expires completes the same run. Neither miss is a correctness problem, which is what allows the guess to stay a keyword match rather than an attempt to predict the planner.

## Consequences

- A price question is one exchange again. "查上海 9 月 1 日" now searches, waits, renders results, and advises, without the user re-entering in the middle.
- The `precheck` hook had to move. It ran inside the confirmation branch, so when browser tasks stopped taking that branch the currency check stopped running with them — a budget in the wrong currency would have reached Hyatt. It now runs before every call, whatever the effect.
- The same is true of the tools note: it was spoken in the confirmation branch, and now speaks before anything with a cost. A free read still says nothing, because it has a progress line and a result card of its own.
- Step budgets were raised to match. A turn can now run search → verify a total → apply a budget → compare against a booking without the user re-entering between each, so twelve deliberations rather than six, with any one capability capped at four calls.
- ADR 0001's due queue is untouched. Those entries are reminders the user clicks on the desk; this decision is about capabilities the agent proposes inside a conversation the user is already having.
- The risk accepted: the agent can now open a Hyatt tab as a direct consequence of a sentence, and a misread sentence opens a tab that was not wanted. It costs a tab and a few seconds, it is visible while it happens, and nothing it does can book, cancel, or pay. That is the trade — a wasted tab against a step on every price question.
