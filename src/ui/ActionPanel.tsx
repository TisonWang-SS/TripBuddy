import styles from "./ActionPanel.module.css";

/**
 * A button with its result notice underneath. The three Browser Companion
 * actions all report back in place rather than through a toast, because the
 * result — what was imported, why a check failed — is something you read, not
 * something that should slide away on a timer.
 */
export function ActionPanel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.panel, className].filter(Boolean).join(" ")}>{children}</div>;
}
