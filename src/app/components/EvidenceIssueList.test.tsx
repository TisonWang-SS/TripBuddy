import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceIssueList } from "@/app/components/EvidenceIssueList";
import { WEAKER_CANCELLATION_WARNING } from "@/lib/evidenceWarnings";

describe("evidence issue list", () => {
  it("distinguishes blockers, cancellation cautions, and soft warnings", () => {
    render(
      <EvidenceIssueList
        blockers={["Cancellation-policy equivalence is unknown."]}
        warnings={[WEAKER_CANCELLATION_WARNING, "The candidate room is similar rather than an exact match."]}
      />
    );

    expect(screen.getByText("Cancellation-policy equivalence is unknown.")).toHaveClass("notice", "warning");
    expect(screen.getByText((_, element) => element?.textContent === `Caution: ${WEAKER_CANCELLATION_WARNING}`))
      .toHaveClass("notice", "caution");
    expect(screen.getByText("The candidate room is similar rather than an exact match.")).toHaveClass("muted");
  });
});
