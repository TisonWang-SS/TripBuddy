import styles from "./Table.module.css";

export function Table({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div className={styles.scroll}>
      <table className={[styles.table, className].filter(Boolean).join(" ")}>{children}</table>
    </div>
  );
}
