import styles from "./EmptyState.module.css";

type EmptyStateProps = {
  action?: React.ReactNode;
  className?: string;
  description?: string;
  title: string;
};

export function EmptyState({ action, className, description, title }: EmptyStateProps) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(" ")}>
      <h3 className={styles.title}>{title}</h3>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
