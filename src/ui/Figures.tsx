import styles from "./Figures.module.css";

/**
 * A row of readings taken off one ticket — ruled top and bottom, split by the
 * same dashed line the stub perforation uses. Deliberately not cards: these are
 * values read off a single record, not separate objects.
 */
export function Figures({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.figures, className].filter(Boolean).join(" ")}>{children}</div>;
}

export function Figure({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className={styles.figure}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
