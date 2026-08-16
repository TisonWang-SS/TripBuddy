"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamAgentRun } from "@/lib/agent/client";
import type { Surface } from "@/lib/agent/surface";
import type { AgentConversationMessage } from "@/lib/agent/types";
import { Button } from "@/ui";
import styles from "./Chat.module.css";
import { SurfaceRenderer } from "./SurfaceRenderer";

/*
 * The conversation. This is the product's primary interface, not a palette that
 * happens to accept sentences: results render here, in place, and the next thing
 * to say is always a sentence rather than a form.
 *
 * Two things it owns that the server cannot:
 *
 * - **The Hyatt tab.** Chrome only allows `window.open` inside a gesture, and
 *   the launch URL is not known until the run answers. So the press on a
 *   confirmation card opens an empty tab, and the run points it somewhere when
 *   it has an address. Same arrangement `RunPriceCheckButton` already uses.
 *
 * - **What the model is told was said.** Only real user and assistant turns go
 *   back; progress lines and cards do not. The server rebuilds its own view of
 *   the tools from that history.
 */

type Entry =
  | { id: string; kind: "user"; text: string }
  | { id: string; kind: "assistant"; text: string }
  | { id: string; kind: "surface"; surface: Surface }
  | { id: string; kind: "status"; text: string }
  /** The safety net when a tab could not be opened for us. See `send`. */
  | { id: string; kind: "launch"; url: string }
  | { id: string; kind: "error"; text: string };

/** Suggestions, not commands. They fill the field so the sentence stays editable. */
const OPENERS: readonly string[] = [
  "查一下 9 月 1 日东京住 2 晚的凯悦，预算每晚 1500 元",
  "我现在的预订还值得留着吗？",
  "哪些预订该重新查价了？"
];

export function Chat() {
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const conversationRef = useRef<AgentConversationMessage[]>([]);
  /*
   * What earlier turns left behind, as the server handed it out. Stored and
   * returned untouched: its shape is the server's business, and a client that
   * does not read it cannot invent an entry it does not understand.
   */
  const memoryRef = useRef<unknown>(undefined);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const idRef = useRef(0);

  const nextId = useCallback(() => `e${++idRef.current}`, []);
  const remember = useCallback((turn: AgentConversationMessage) => {
    conversationRef.current = [...conversationRef.current, turn].slice(-16);
  }, []);

  /*
   * Follows the newest entry, which is where a streaming answer appears. The
   * page is the scroller — the composer sticks to the bottom of it — so this
   * scrolls the window rather than the feed.
   */
  useEffect(() => {
    if (entries.length > 0) {
      window.scrollTo({ behavior: "smooth", top: document.body.scrollHeight });
    }
  }, [entries]);

  const send = useCallback(
    async (
      request: { confirm?: { args: unknown; capability: string }; message?: string },
      browserTab: Window | null
    ) => {
      setBusy(true);
      let assistantText = "";
      /* Read back instead of the tab's own URL: once it reaches hyatt.com, the
       * same-origin policy makes `location.href` throw rather than answer. */
      let launched = false;
      /* Replaced in place as the run reports what it is doing. */
      const statusId = nextId();
      setEntries((current) => [...current, { id: statusId, kind: "status", text: "Thinking…" }]);

      const replaceStatus = (text: string) =>
        setEntries((current) => current.map((entry) => (entry.id === statusId ? { ...entry, kind: "status", text } : entry)));
      const dropStatus = () => setEntries((current) => current.filter((entry) => entry.id !== statusId));

      try {
        await streamAgentRun(
          { ...request, conversation: conversationRef.current, memory: memoryRef.current },
          (event) => {
            if (event.type === "STEP_STARTED" && event.stepName === "think") {
              replaceStatus("Thinking…");
            } else if (event.type === "TOOL_CALL_START") {
              replaceStatus(runningLabel(event.toolCallName));
            } else if (event.type === "TEXT_MESSAGE_CONTENT") {
              assistantText += event.delta;
            } else if (event.type === "CUSTOM" && event.name === "browser_task_launch") {
              const { launchUrl } = event.value as { launchUrl: string | null };
              if (browserTab && launchUrl) {
                browserTab.location.href = launchUrl;
                launched = true;
                replaceStatus("Reading the Hyatt tab… leave it open until it finishes.");
              } else if (launchUrl) {
                /*
                 * No tab was waiting — either the guess was wrong or Chrome
                 * blocked it. The server is already waiting on the task, so a
                 * link is enough: opening it any time before the task expires
                 * completes the same run.
                 */
                setEntries((current) => [...current, { id: nextId(), kind: "launch", url: launchUrl }]);
                replaceStatus("Waiting for the Hyatt tab — open it above.");
              }
            } else if (event.type === "CUSTOM" && event.name === "memory") {
              memoryRef.current = event.value;
            } else if (event.type === "CUSTOM" && event.name === "surface") {
              const surface = event.value as Surface;
              /*
               * Read out before the reset, and into entries built here rather
               * than inside the updater. A React updater runs later than the
               * line that queues it — reading `assistantText` from in there sees
               * the empty string below, which silently dropped every assistant
               * message the model wrote.
               */
              const spoken = assistantText;
              assistantText = "";
              if (spoken) {
                remember({ content: spoken, role: "assistant" });
              }
              const added: Entry[] = [
                ...(spoken ? [{ id: nextId(), kind: "assistant" as const, text: spoken }] : []),
                { id: nextId(), kind: "surface" as const, surface },
                { id: statusId, kind: "status" as const, text: "Thinking…" }
              ];
              setEntries((current) => [...current.filter((entry) => entry.id !== statusId), ...added]);
            } else if (event.type === "RUN_ERROR") {
              dropStatus();
              setEntries((current) => [...current, { id: nextId(), kind: "error", text: event.message }]);
            }
          }
        );
      } catch (error) {
        browserTab?.close();
        dropStatus();
        setEntries((current) => [
          ...current,
          { id: nextId(), kind: "error", text: error instanceof Error ? error.message : "That request failed." }
        ]);
        setBusy(false);
        return;
      }

      dropStatus();
      if (assistantText) {
        const trailing: Entry = { id: nextId(), kind: "assistant", text: assistantText };
        setEntries((current) => [...current, trailing]);
        remember({ content: assistantText, role: "assistant" });
      }

      /*
       * A tab opened for a run that never launched one would sit blank. This is
       * the only place that can tell, because the launch is an event and its
       * absence is not.
       */
      if (browserTab && !launched) {
        browserTab.close();
      }
      setBusy(false);
      inputRef.current?.focus();
    },
    [nextId, remember]
  );

  function ask() {
    const message = draft.trim();
    if (!message || busy) {
      return;
    }
    setDraft("");
    setEntries((current) => [...current, { id: nextId(), kind: "user", text: message }]);
    remember({ content: message, role: "user" });

    /*
     * The tab, opened here or not at all.
     *
     * Chrome only allows `window.open` inside a gesture, and this keystroke is
     * the only gesture the turn gets now that browser work runs without a
     * separate press. The address is not known until the run answers, so an
     * empty tab is opened and pointed somewhere later.
     *
     * Opened only when the message looks like it will need one — the guess is
     * cheap and wrong sometimes, which is why `send` renders a link when a
     * launch arrives with no tab waiting for it. Opening one every time would
     * flash a blank tab for the three questions in four that never need it.
     */
    const browserTab = mayNeedHyatt(message) ? window.open("about:blank", "_blank") : null;
    void send({ message }, browserTab);
  }

  /** The press a write still asks for. Nothing here opens a tab. */
  function confirm(action: { args: unknown; capability: string }) {
    if (busy) {
      return;
    }
    void send({ confirm: action }, null);
  }

  return (
    <div className={styles.chat}>
      <div className={styles.feed}>
        {entries.length === 0 ? (
          <div className={styles.opening}>
            <p className={styles.openingLead}>
              Tell me where you are going and what matters — price, dates, points. I will open Hyatt when I need a real
              price, and never book, cancel, or pay for anything.
            </p>
            <div className={styles.openers}>
              {OPENERS.map((opener) => (
                <button
                  className={styles.opener}
                  key={opener}
                  onClick={() => {
                    setDraft(opener);
                    inputRef.current?.focus();
                  }}
                  type="button"
                >
                  {opener}
                </button>
              ))}
            </div>
          </div>
        ) : (
          entries.map((entry) => <EntryView entry={entry} key={entry.id} onConfirm={confirm} />)
        )}
      </div>

      <div className={styles.composer}>
        <textarea
          aria-label="Ask TripBuddy"
          className={styles.input}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask();
            }
          }}
          placeholder="Ask about a stay, a price, or a city…"
          ref={inputRef}
          rows={2}
          value={draft}
        />
        <div className={styles.composerEnd}>
          <span className={styles.hint}>Enter to send · Shift+Enter for a new line</span>
          <Button disabled={busy || draft.trim().length === 0} loading={busy} onClick={ask} size="sm" type="button">
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function EntryView({
  entry,
  onConfirm
}: {
  entry: Entry;
  onConfirm: (action: { args: unknown; capability: string }) => void;
}) {
  switch (entry.kind) {
    case "user":
      return (
        <div className={styles.userRow}>
          <p className={styles.user}>{entry.text}</p>
        </div>
      );
    case "assistant":
      return <p className={styles.assistant}>{entry.text}</p>;
    case "surface":
      return (
        <div className={styles.card}>
          <SurfaceRenderer onConfirm={onConfirm} surface={entry.surface} variant="conversation" />
        </div>
      );
    case "status":
      return (
        <p aria-live="polite" className={styles.status}>
          {entry.text}
        </p>
      );
    case "launch":
      return (
        <a className={styles.launch} href={entry.url} rel="noreferrer" target="_blank">
          Open the Hyatt tab to continue
        </a>
      );
    case "error":
      return <p className={styles.error}>{entry.text}</p>;
  }
}

/**
 * A cheap guess at whether this turn will want a Hyatt tab.
 *
 * Deliberately loose. Being wrong the safe way costs a blank tab that is closed
 * again; being wrong the other way costs a link the user clicks. Neither is a
 * correctness problem, which is what allows the guess to stay this simple —
 * anything sharper would be predicting the planner, and the planner is the part
 * that is allowed to change its mind.
 */
function mayNeedHyatt(message: string) {
  return /查|搜|找|价|费|积分|点数|多少钱|导入|同步|hotel|search|price|rate|check|import|sync|points|award/i.test(message);
}

/** Product-owned progress copy, keyed by capability rather than written by the model. */
function runningLabel(capability: string) {
  switch (capability) {
    case "search_hotels":
      return "Opening Hyatt to collect city rates…";
    case "run_price_check":
      return "Checking this booking's current price…";
    case "import_account_bookings":
      return "Importing your Hyatt stays…";
    case "list_bookings":
    case "get_booking":
      return "Reading your stays…";
    case "get_price_history":
      return "Reading the price history…";
    case "explain_recommendation":
      return "Reading the verdict…";
    case "list_due_checks":
      return "Checking what is due…";
    default:
      return "Working…";
  }
}
