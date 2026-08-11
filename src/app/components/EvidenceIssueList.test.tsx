import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EvidenceIssueList } from "@/app/components/EvidenceIssueList";
import { WEAKER_CANCELLATION_WARNING } from "@/lib/evidenceWarnings";

/*
 * Asserts on data-tone rather than class names: the classes are CSS-module
 * hashes now, and the tone is the contract the component actually promises.
 */
describe("evidence issue list", () => {
  it("distinguishes blockers, cancellation cautions, and soft warnings", () => {
    render(
      <EvidenceIssueList
        blockers={["Cancellation-policy equivalence is unknown."]}
        warnings={[WEAKER_CANCELLATION_WARNING, "The candidate room is similar rather than an exact match."]}
      />
    );

    expect(screen.getByText("Cancellation-policy equivalence is unknown.")).toHaveAttribute("data-tone", "caution");
    expect(screen.getByText((_, element) => element?.textContent === `Caution: ${WEAKER_CANCELLATION_WARNING}`))
      .toHaveAttribute("data-tone", "caution");

    /* A soft warning is plain text, so it must not be framed as a notice at all. */
    const soft = screen.getByText("The candidate room is similar rather than an exact match.");
    expect(soft).not.toHaveAttribute("data-tone");
    expect(soft.tagName).toBe("P");
  });

  it("renders nothing when there is no issue to report", () => {
    const { container } = render(<EvidenceIssueList blockers={[]} warnings={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
