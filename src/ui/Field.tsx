import styles from "./Field.module.css";

type FieldProps = {
  children: React.ReactNode;
  className?: string;
  hint?: string;
  /** Must match the `id` of the control passed as children. */
  htmlFor: string;
  label: string;
};

export function Field({ children, className, hint, htmlFor, label }: FieldProps) {
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label className={styles.label} htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className={styles.hint}>{hint}</p> : null}
    </div>
  );
}
