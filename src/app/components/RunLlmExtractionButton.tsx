"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { readJsonResponse } from "@/lib/jsonResponse";
import { ActionPanel, Button, Notice } from "@/ui";

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
      const payload = await readJsonResponse<ExtractionResult>(response, "POST");
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
    <ActionPanel>
      <Button disabled={!configured} loading={loading} onClick={run} size="sm" type="button" variant="secondary">
        {loading ? "Extracting stored evidence…" : "Replay with LLM"}
      </Button>
      {!configured ? <Notice>Set TRIPBUDDY_LLM_API_KEY to enable.</Notice> : null}
      {result ? (
        <Notice tone={result.error ? "caution" : "positive"}>
          {result.error ??
            `LLM proposed ${result.proposedCandidates}, corroborated ${result.corroboratedCandidates}, and created ${result.observationsCreated} observation(s).`}
        </Notice>
      ) : null}
    </ActionPanel>
  );
}
