import type { Label, Tone } from "@/lib/labels";
import styles from "./Badge.module.css";

type BadgeProps = {
  children?: React.ReactNode;
  className?: string;
  /** Renders a leading status dot. Use for lifecycle state, not for categories. */
  dot?: boolean;
  tone?: Tone;
};

export function Badge({ children, className, dot = false, tone = "neutral" }: BadgeProps) {
  return (
    <span className={[styles.badge, styles[tone], className].filter(Boolean).join(" ")} data-tone={tone}>
      {dot ? <span aria-hidden="true" className={styles.dot} /> : null}
      {children}
    </span>
  );
}

/**
 * Renders a resolved label from `@/lib/labels`. Taking the whole descriptor
 * keeps copy and tone decided in one place instead of at every call site.
 */
export function LabelBadge({ className, dot, value }: { className?: string; dot?: boolean; value: Label }) {
  return (
    <Badge className={className} dot={dot} tone={value.tone}>
      {value.label}
    </Badge>
  );
}
