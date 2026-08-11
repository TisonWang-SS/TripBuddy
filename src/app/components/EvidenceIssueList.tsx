import { isEvidenceCaution } from "@/lib/evidenceWarnings";
import { Notice } from "@/ui";
import styles from "./EvidenceIssueList.module.css";

type EvidenceIssueListProps = {
  blockers: readonly string[];
  className?: string;
  warnings: readonly string[];
};

/**
 * Three severities, three treatments: blockers and cancellation cautions get a
 * framed notice, everything else stays plain text. Tone is readable from
 * `data-tone` on the notice rather than from a class name.
 */
export function EvidenceIssueList({ blockers, className, warnings }: EvidenceIssueListProps) {
  if (blockers.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className={[styles.list, className].filter(Boolean).join(" ")}>
      {blockers.map((item) => (
        <Notice key={item} tone="caution">
          {item}
        </Notice>
      ))}
      {warnings.map((item) =>
        isEvidenceCaution(item) ? (
          <Notice key={item} tone="caution">
            <strong>Caution:</strong> {item}
          </Notice>
        ) : (
          <p className={styles.soft} key={item}>
            {item}
          </p>
        )
      )}
    </div>
  );
}
