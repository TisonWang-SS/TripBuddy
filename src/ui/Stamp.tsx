import type { Label, Tone } from "@/lib/labels";
import styles from "./Stamp.module.css";

/*
 * The desk's verdict mark: a rubber-stamped overprint rather than a pill.
 *
 * Badge stays as it is for the pages still on the teal token set — this is an
 * addition, not a replacement, so nothing that already renders a Badge moves.
 */
const TONE_CLASS: Record<Tone, string> = {
  neutral: styles.neutral,
  positive: styles.positive,
  info: styles.info,
  caution: styles.caution,
  critical: styles.critical
};

export function Stamp({ className, tone = "neutral", children }: { className?: string; children?: React.ReactNode; tone?: Tone }) {
  return <span className={[styles.stamp, TONE_CLASS[tone], className].filter(Boolean).join(" ")}>{children}</span>;
}

/** Renders a resolved label from `@/lib/labels`, so copy and tone stay in one place. */
export function LabelStamp({ className, value }: { className?: string; value: Label }) {
  return (
    <Stamp className={className} tone={value.tone}>
      {value.label}
    </Stamp>
  );
}
