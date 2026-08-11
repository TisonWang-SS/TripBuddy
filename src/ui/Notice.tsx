import type { Tone } from "@/lib/labels";
import styles from "./Notice.module.css";

type NoticeProps = {
  children?: React.ReactNode;
  className?: string;
  tone?: Tone;
};

export function Notice({ children, className, tone = "neutral" }: NoticeProps) {
  return (
    <div
      className={[styles.notice, styles[tone], className].filter(Boolean).join(" ")}
      data-tone={tone}
      role={tone === "critical" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}
