import styles from "./Form.module.css";

/**
 * A desk form: a stack of sections with the submit row ruled off at the bottom.
 * Takes the server action straight through, so pages keep using `action={fn}`.
 */
export function Form({
  action,
  children,
  className,
  onSubmit
}: {
  action?: (formData: FormData) => void | Promise<void>;
  children: React.ReactNode;
  className?: string;
  /** For client-side search forms that post through fetch rather than an action. */
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
}) {
  return (
    <form action={action} className={[styles.form, className].filter(Boolean).join(" ")} onSubmit={onSubmit}>
      {children}
    </form>
  );
}

/** Two columns on a desk, one on a phone. Fields keep their own labels. */
export function FieldGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.grid, className].filter(Boolean).join(" ")}>{children}</div>;
}

/** The submit row, ruled off from the fields above it. */
export function FormActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={[styles.actions, className].filter(Boolean).join(" ")}>{children}</div>;
}

/**
 * A checkbox reads as a line you tick, not as a field with a caption above it,
 * so the label sits beside the control rather than over it.
 */
export function CheckField({
  defaultChecked,
  hint,
  id,
  label,
  name
}: {
  defaultChecked?: boolean;
  hint?: string;
  id: string;
  label: string;
  name: string;
}) {
  return (
    <div className={styles.check}>
      <input className={styles.checkbox} defaultChecked={defaultChecked} id={id} name={name} type="checkbox" />
      <label className={styles.checkLabel} htmlFor={id}>
        {label}
        {hint ? <span className={styles.checkHint}>{hint}</span> : null}
      </label>
    </div>
  );
}
