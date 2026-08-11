import type { ButtonHTMLAttributes } from "react";
import styles from "./Button.module.css";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
  size?: ButtonSize;
  variant?: ButtonVariant;
};

/**
 * Shared with link-shaped actions. Pages render `<Link>` for navigation that
 * looks like a button, and those cannot be a `<button>` element without losing
 * anchor semantics, so the class list is exported rather than duplicated.
 */
export function buttonClassName({
  className,
  size = "md",
  variant = "primary"
}: { className?: string; size?: ButtonSize; variant?: ButtonVariant } = {}) {
  return [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
}

export function Button({ children, className, disabled, loading = false, size = "md", variant = "primary", ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      aria-busy={loading || undefined}
      className={buttonClassName({ className, size, variant })}
      disabled={disabled || loading}
    >
      {loading ? <span aria-hidden="true" className={styles.spinner} /> : null}
      {children}
    </button>
  );
}
