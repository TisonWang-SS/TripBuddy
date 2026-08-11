"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type ExtractionResult = {
  corroboratedCandidates: number;
  error?: string;
  observationsCreated: number;
  proposedCandidates: number;
  status: "partial" | "succeeded";
};

export function RunLlmExtractionButton({ configured, runId }: { configured: boolean; runId: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ExtractionResult | null>(null);

  async function run() {
    setLoading(true);
    setResult(null);
    try {
      const response = await fetch(`/api/price-checks/${encodeURIComponent(runId)}/llm-extraction`, {
        method: "POST"
      });
      const payload = await response.json() as ExtractionResult;
      if (!response.ok) {
        throw new Error(payload.error || `LLM extraction failed with ${response.status}.`);
      }
      setResult(payload);
      router.refresh();
    } catch (error) {
      setResult({
        corroboratedCandidates: 0,
        error: error instanceof Error ? error.message : "LLM extraction failed.",
        observationsCreated: 0,
        proposedCandidates: 0,
        status: "partial"
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="importPanel">
      <button disabled={!configured || loading} onClick={run} type="button">
        {loading ? "Extracting stored evidence..." : "Replay with LLM"}
      </button>
      {!configured ? <small className="muted">Set TRIPBUDDY_LLM_API_KEY to enable.</small> : null}
      {result ? (
        <div className={`notice ${result.error ? "warning" : "success"}`}>
          {result.error ??
            `LLM proposed ${result.proposedCandidates}, corroborated ${result.corroboratedCandidates}, and created ${result.observationsCreated} observation(s).`}
        </div>
      ) : null}
    </div>
  );
}
