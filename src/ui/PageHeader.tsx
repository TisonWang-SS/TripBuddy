import styles from "./PageHeader.module.css";

type PageHeaderProps = {
  actions?: React.ReactNode;
  description?: React.ReactNode;
  eyebrow?: string;
  /** Renders an h2 instead of an h1, for headers inside a page rather than at its top. */
  level?: 1 | 2;
  title: string;
};

/**
 * The top of a desk page: a mono kicker, the name in the display face, and the
 * page's actions pushed to the far edge. Shared so ten pages do not each grow
 * their own header stylesheet that drifts apart.
 */
export function PageHeader({ actions, description, eyebrow, level = 1, title }: PageHeaderProps) {
  const Heading = level === 1 ? "h1" : "h2";
  return (
    <header className={styles.header}>
      <div className={styles.text}>
        {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
        <Heading className={level === 1 ? styles.title : styles.titleSm}>{title}</Heading>
        {description ? <p className={styles.description}>{description}</p> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}
