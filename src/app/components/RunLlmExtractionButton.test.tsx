import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RunLlmExtractionButton } from "@/app/components/RunLlmExtractionButton";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("RunLlmExtractionButton", () => {
  it("explains the environment requirement when the extractor is not configured", () => {
    render(<RunLlmExtractionButton configured={false} runId="run-1" />);

    expect(screen.getByRole("button", { name: "Replay with LLM" })).toBeDisabled();
    expect(screen.getByText(/TRIPBUDDY_LLM_API_KEY/)).toBeInTheDocument();
  });
});
