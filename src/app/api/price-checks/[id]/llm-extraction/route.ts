import { NextResponse } from "next/server";
import { sameOriginRequestError } from "@/lib/browserApi";
import { runLlmExtractionForPriceCheck } from "@/lib/llmExtraction";
import { LlmEvidenceError } from "@/lib/providers/llmEvidence";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessError = sameOriginRequestError(request);
  if (accessError) {
    return accessError;
  }
  const { id } = await params;
  try {
    return NextResponse.json(await runLlmExtractionForPriceCheck(id));
  } catch (error) {
    if (error instanceof LlmEvidenceError) {
      return NextResponse.json({ code: error.code, error: error.message }, { status: statusFor(error.code) });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "LLM extraction failed." },
      { status: 500 }
    );
  }
}

function statusFor(code: string) {
  if (code === "price_check_not_found") return 404;
  if (code === "price_check_in_progress") return 409;
  if (code === "llm_not_configured") return 503;
  if (code.startsWith("llm_")) return 502;
  return 422;
}
