import styles from "./Card.module.css";

type CardProps = {
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
  eyebrow?: string;
  /** Drops the surface and border, for cards that only group content. */
  flat?: boolean;
  title?: string;
};

export function Card({ actions, children, className, eyebrow, flat = false, title }: CardProps) {
  const hasHeader = Boolean(eyebrow || title || actions);
  return (
    <section className={[styles.card, flat ? styles.flat : null, className].filter(Boolean).join(" ")}>
      {hasHeader ? (
        <div className={styles.header}>
          <div>
            {eyebrow ? <p className={styles.eyebrow}>{eyebrow}</p> : null}
            {title ? <h2 className={styles.title}>{title}</h2> : null}
          </div>
          {actions ? <div>{actions}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}
