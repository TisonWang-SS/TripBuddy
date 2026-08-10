import { isEvidenceCaution } from "@/lib/evidenceWarnings";

type EvidenceIssueListProps = {
  blockers: readonly string[];
  className?: string;
  warnings: readonly string[];
};

export function EvidenceIssueList({ blockers, className, warnings }: EvidenceIssueListProps) {
  if (blockers.length === 0 && warnings.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      {blockers.map((item) => <p className="notice warning" key={item}>{item}</p>)}
      {warnings.map((item) => isEvidenceCaution(item)
        ? <p className="notice caution" key={item}><strong>Caution:</strong> {item}</p>
        : <p className="muted" key={item}>{item}</p>)}
    </div>
  );
}
