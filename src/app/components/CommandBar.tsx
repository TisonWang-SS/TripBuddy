"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { streamAgentRun } from "@/lib/agent/client";
import type { Surface } from "@/lib/agent/surface";
import { launchUrlOf } from "@/lib/agent/surface";
import { buttonClassName } from "@/ui";
import styles from "./CommandBar.module.css";
import { SurfaceRenderer } from "./SurfaceRenderer";

export type Command = {
  /** Extra words the query should match, beyond the visible label. */
  keywords?: string;
  group: string;
  href: string;
  label: string;
};

function matches(command: Command, query: string) {
  if (!query) {
    return true;
  }
  const haystack = `${command.label} ${command.keywords ?? ""} ${command.group}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term));
}

/**
 * The command bar is the shell's primary entry point: the slab field is always
 * visible so the affordance is discoverable, and Cmd/Ctrl-K reaches it from
 * anywhere for people who already know.
 *
 * It navigates. Actions that open a Hyatt tab — price checks, account imports —
 * deliberately stay as buttons on the pages that own them, because those pages
 * are also where their progress and error notices render; firing them from a
 * palette that then closes would leave the result nowhere to land.
 */
/**
 * What a typed question produced. A run that needs a press is held here rather
 * than acted on: the protocol reports `confirmation_required`, and the same
 * request is sent again only after the user agrees.
 */
type Answer =
  | { kind: "running"; question: string }
  | { args: unknown; capability: string; kind: "confirm"; message: string; question: string }
  | { kind: "answered"; question: string; surface: Surface | null }
  | { kind: "failed"; message: string; question: string };

export function CommandBar({ commands }: { commands: readonly Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const listId = useId();

  const results = useMemo(() => commands.filter((command) => matches(command, query)), [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
    setAnswer(null);
    restoreRef.current?.focus();
    restoreRef.current = null;
  }, []);

  const show = useCallback(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  /* Global shortcut. Bound once, on the document, so it works from any page. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (open) {
          close();
        } else {
          show();
        }
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, open, show]);

  /*
   * Locking the body rather than the scroller keeps the page from jumping when
   * the scrollbar disappears under the overlay.
   */
  useEffect(() => {
    if (!open) {
      return;
    }
    inputRef.current?.focus();
    const previous = document.body.style.overflow;
    const gutter = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (gutter > 0) {
      document.body.style.paddingRight = `${gutter}px`;
    }
    return () => {
      document.body.style.overflow = previous;
      document.body.style.paddingRight = "";
    };
  }, [open]);

  /*
   * A pending confirmation takes the focus, so the next keystroke reaches the
   * decision being asked about. Without this the field keeps focus and Enter
   * re-routes the same sentence, which repaints the identical panel — the
   * question looks unanswered and the press looks ignored.
   *
   * Moving focus rather than teaching the field to confirm is deliberate: the
   * guard in `invokeCapability` wants a press on the control that opens the tab,
   * not a second press of whatever key happened to be under a finger.
   */
  useEffect(() => {
    if (answer?.kind === "confirm") {
      confirmRef.current?.focus();
    }
  }, [answer?.kind]);

  function run(command: Command) {
    close();
    router.push(command.href);
  }

  /**
   * Sends the typed words to be routed, and renders whatever surface comes back
   * in place. Reads land here; anything that opens a Hyatt tab comes back as a
   * surface pointing at the page that owns its progress and result.
   *
   * `browserTab` is a tab the caller already opened inside the click that
   * started this, because Chrome only allows `window.open` during a gesture and
   * the launch URL is not known until the run answers. Same arrangement as
   * `RunPriceCheckButton`; it is closed again if the run produces no launch.
   */
  async function ask(
    request: { args?: unknown; capability?: string; confirmed?: boolean; message?: string },
    question: string,
    browserTab: Window | null = null
  ) {
    setAnswer({ kind: "running", question });
    let surface: Surface | null = null;
    let capability = "";
    let args: unknown = {};
    let failure: { code: string; message: string } | null = null;

    try {
      await streamAgentRun(request, (event) => {
        if (event.type === "TOOL_CALL_START") {
          capability = event.toolCallName;
        } else if (event.type === "TOOL_CALL_ARGS") {
          args = JSON.parse(event.delta) as unknown;
        } else if (event.type === "CUSTOM" && event.name === "surface") {
          surface = event.value as Surface;
        } else if (event.type === "RUN_ERROR") {
          failure = { code: event.code, message: event.message };
        }
      });
    } catch (error) {
      browserTab?.close();
      setAnswer({ kind: "failed", message: error instanceof Error ? error.message : "That request failed.", question });
      return;
    }

    if (failure) {
      browserTab?.close();
      const { code, message } = failure;
      setAnswer(
        code === "confirmation_required"
          ? { args, capability, kind: "confirm", message, question }
          : { kind: "failed", message, question }
      );
      return;
    }

    const launchUrl = launchUrlOf(surface);
    if (browserTab) {
      if (launchUrl) {
        browserTab.location.href = launchUrl;
      } else {
        browserTab.close();
      }
    }
    setAnswer({ kind: "answered", question, surface });
  }

  /**
   * The press the confirmation guard is waiting for. The tab is opened here,
   * empty, because this is the last moment Chrome still counts as a gesture.
   */
  function confirmLaunch(pending: Extract<Answer, { kind: "confirm" }>) {
    const browserTab = window.open("about:blank", "_blank");
    if (!browserTab) {
      setAnswer({
        kind: "failed",
        message: "Chrome blocked the Hyatt tab. Allow pop-ups for TripBuddy and try again.",
        question: pending.question
      });
      return;
    }
    void ask({ args: pending.args, capability: pending.capability, confirmed: true }, pending.question, browserTab);
  }

  const askable = query.trim().length > 0;
  /* The ask row sits after the commands so one flat index still drives the keyboard. */
  const optionCount = results.length + (askable ? 1 : 0);

  function choose(index: number) {
    const command = results[index];
    if (command) {
      run(command);
      return;
    }
    if (askable) {
      void ask({ message: query.trim() }, query.trim());
    }
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (optionCount === 0 ? 0 : (index + 1) % optionCount));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (optionCount === 0 ? 0 : (index - 1 + optionCount) % optionCount));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      choose(active);
    }
  }

  /* Group headings are rendered inline so one flat index can drive the keyboard. */
  let lastGroup: string | null = null;

  return (
    <>
      <button aria-haspopup="dialog" className={styles.trigger} onClick={show} type="button">
        <svg aria-hidden="true" fill="none" height="15" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" viewBox="0 0 24 24" width="15">
          <path d="m5 8 4 4-4 4M12 16h7" />
        </svg>
        <span className={styles.triggerText}>Type a command — search, check, import</span>
        <span className={styles.keys}>
          <kbd>⌘</kbd>
          <kbd>K</kbd>
        </span>
      </button>

      {open ? (
        <div className={styles.overlay}>
          <button aria-label="Close the command bar" className={styles.scrim} onClick={close} type="button" />
          <div aria-label="Command bar" aria-modal="true" className={styles.panel} role="dialog">
            <div className={styles.field}>
              <svg aria-hidden="true" className={styles.fieldIcon} fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" viewBox="0 0 24 24" width="16">
                <path d="m5 8 4 4-4 4M12 16h7" />
              </svg>
              <input
                aria-activedescendant={results[active] ? `${listId}-${active}` : undefined}
                aria-autocomplete="list"
                aria-controls={listId}
                aria-expanded="true"
                aria-label="Type a command"
                autoComplete="off"
                className={styles.input}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                  setAnswer(null);
                }}
                onKeyDown={onFieldKeyDown}
                placeholder="Type a command, or ask…"
                ref={inputRef}
                role="combobox"
                value={query}
              />
              <kbd>esc</kbd>
            </div>

            {answer ? (
              <div className={styles.answer}>
                <p className={styles.answerQuestion}>{answer.question}</p>
                {answer.kind === "running" ? <p className={styles.empty}>Working…</p> : null}
                {answer.kind === "failed" ? <p className={styles.answerError}>{answer.message}</p> : null}
                {answer.kind === "confirm" ? (
                  <div className={styles.answerConfirm}>
                    <p>{answer.message}</p>
                    <button
                      className={buttonClassName({ size: "sm" })}
                      onClick={() => confirmLaunch(answer)}
                      ref={confirmRef}
                      type="button"
                    >
                      Open the Hyatt tab
                    </button>
                  </div>
                ) : null}
                {answer.kind === "answered" && answer.surface ? <SurfaceRenderer surface={answer.surface} /> : null}
              </div>
            ) : null}

            <div className={styles.results} id={listId} role="listbox">
              {results.length === 0 && !askable ? (
                <p className={styles.empty}>Nothing matches “{query}”.</p>
              ) : (
                results.map((command, index) => {
                  const heading = command.group === lastGroup ? null : command.group;
                  lastGroup = command.group;
                  return (
                    <div key={command.href}>
                      {heading ? <p className={styles.group}>{heading}</p> : null}
                      <button
                        aria-selected={index === active}
                        className={index === active ? `${styles.item} ${styles.itemActive}` : styles.item}
                        id={`${listId}-${index}`}
                        onClick={() => run(command)}
                        onMouseMove={() => setActive(index)}
                        role="option"
                        type="button"
                      >
                        <span className={styles.itemNo}>{String(index + 1).padStart(2, "0")}</span>
                        <span className={styles.itemLabel}>{command.label}</span>
                      </button>
                    </div>
                  );
                })
              )}

              {askable ? (
                <button
                  aria-selected={active === results.length}
                  className={active === results.length ? `${styles.item} ${styles.itemActive}` : styles.item}
                  id={`${listId}-${results.length}`}
                  onClick={() => choose(results.length)}
                  onMouseMove={() => setActive(results.length)}
                  role="option"
                  type="button"
                >
                  <span className={styles.itemNo}>ask</span>
                  <span className={styles.itemLabel}>“{query.trim()}”</span>
                </button>
              ) : null}
            </div>

            <div className={styles.foot}>
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> move
              </span>
              <span>
                <kbd>↵</kbd> open
              </span>
              <span>
                <kbd>esc</kbd> close
              </span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
