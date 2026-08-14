"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import styles from "./CommandBar.module.css";

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
 * Jump-to-page, reachable from anywhere with Cmd/Ctrl-K.
 *
 * It navigates and nothing else. It used to also route typed questions to the
 * agent, which made sense while the palette was the only place you could type a
 * sentence — but a run that ends by closing the palette leaves its answer
 * nowhere to land. The conversation on `/` owns asking now, and it can hold a
 * multi-step answer that a palette never could.
 */
export function CommandBar({ commands }: { commands: readonly Command[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const listId = useId();

  const results = useMemo(() => commands.filter((command) => matches(command, query)), [commands, query]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
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

  function run(command: Command) {
    close();
    router.push(command.href);
  }

  function onFieldKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => (results.length === 0 ? 0 : (index + 1) % results.length));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => (results.length === 0 ? 0 : (index - 1 + results.length) % results.length));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const command = results[active];
      if (command) {
        run(command);
      }
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
        <span className={styles.triggerText}>Jump to a page</span>
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
                aria-label="Jump to a page"
                autoComplete="off"
                className={styles.input}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onFieldKeyDown}
                placeholder="Jump to a page…"
                ref={inputRef}
                role="combobox"
                value={query}
              />
              <kbd>esc</kbd>
            </div>

            <div className={styles.results} id={listId} role="listbox">
              {results.length === 0 ? (
                <p className={styles.empty}>Nothing matches “{query}”. To ask a question, use the conversation on the desk.</p>
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
