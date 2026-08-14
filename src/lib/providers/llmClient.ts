/*
 * Shared client for the provider's OpenAI-compatible Chat Completions endpoint.
 *
 * Extracted so the evidence extractor and the intent router share one request
 * shape, one set of error codes, and one place where finish_reason is
 * interpreted. Callers keep their own error types — the extractor's failures are
 * consumed by `instanceof LlmEvidenceError` — so this throws LlmError and the
 * caller maps it.
 *
 * JSON output mode only. Every caller in this codebase wants a schema-shaped
 * object back, never prose.
 */

export const DEFAULT_LLM_BASE_URL = "https://api.deepseek.com";
export const DEFAULT_LLM_MODEL = "deepseek-v4-flash";

export class LlmError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "LlmError";
  }
}

export type LlmClientConfig = {
  apiKey: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
  model: string;
};

/** A turn in a multi-step exchange. Tool output is carried as a user turn. */
export type LlmMessage = {
  content: string;
  role: "assistant" | "user";
};

export type JsonCompletionRequest = {
  maxTokens: number;
  /**
   * Supplied instead of `user` when the caller needs the model to see more than
   * one turn — an agent loop reading its own earlier tool results, for example.
   * The system prompt stays separate either way.
   */
  messages?: readonly LlmMessage[];
  system: string;
  timeoutMs?: number;
  user?: string;
};

export function readLlmConfigFromEnv(): LlmClientConfig {
  return {
    apiKey: process.env.TRIPBUDDY_LLM_API_KEY ?? "",
    baseUrl: process.env.TRIPBUDDY_LLM_BASE_URL ?? DEFAULT_LLM_BASE_URL,
    model: process.env.TRIPBUDDY_LLM_MODEL ?? DEFAULT_LLM_MODEL
  };
}

/** The API key is the single switch for every model-backed feature. */
export function isLlmConfigured() {
  return Boolean(process.env.TRIPBUDDY_LLM_API_KEY?.trim());
}

export async function requestJsonCompletion(config: LlmClientConfig, request: JsonCompletionRequest): Promise<unknown> {
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new LlmError(
      "llm_not_configured",
      "The language model is not configured. Set TRIPBUDDY_LLM_API_KEY in the environment."
    );
  }

  const turns = request.messages ?? (request.user === undefined ? [] : [{ content: request.user, role: "user" as const }]);
  if (turns.length === 0) {
    throw new LlmError("llm_empty_request", "A completion request must carry either a user message or a message list.");
  }

  const fetchImpl = config.fetchImpl ?? fetch;
  const response = await withTimeoutReported(() => fetchImpl(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    body: JSON.stringify({
      messages: [
        { role: "system", content: request.system },
        ...turns.map((turn) => ({ role: turn.role, content: turn.content }))
      ],
      max_tokens: request.maxTokens,
      model: config.model,
      response_format: { type: "json_object" },
      temperature: 0,
      thinking: { type: "disabled" }
    }),
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    method: "POST",
    signal: AbortSignal.timeout(request.timeoutMs ?? 60_000)
  }));

  const payload = await readResponsePayload(response);
  if (!response.ok) {
    throw new LlmError("llm_request_failed", `The language model request failed with ${response.status}: ${readApiError(payload)}`);
  }

  const outputText = readOutputText(payload);
  try {
    return JSON.parse(outputText) as unknown;
  } catch {
    throw new LlmError("llm_invalid_json", "The language model returned output that was not valid JSON.");
  }
}

/** A timed-out request is its own failure, not an unreachable provider. */
async function withTimeoutReported(send: () => Promise<Response>) {
  try {
    return await send();
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LlmError(
        "llm_timeout",
        "The language model did not respond in time. It may be busy; try again."
      );
    }
    throw error;
  }
}

/**
 * Reads the body, distinguishing "the provider sent something odd" from "we
 * stopped listening".
 *
 * The timeout signal aborts the body read as well as the request, so a slow
 * response arrives as a 200 whose `json()` throws. Swallowing that returned null
 * and the caller reported an unreadable response — which sends the reader
 * looking at the provider's output for a problem that was a timeout. Observed
 * live: two turns that each took exactly the configured 30s and then blamed the
 * model's formatting.
 */
async function readResponsePayload(response: Response) {
  try {
    return (await response.json()) as unknown;
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new LlmError(
        "llm_timeout",
        "The language model did not finish responding in time. It may be busy; try again."
      );
    }
    return null;
  }
}

function readApiError(payload: unknown) {
  return isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string"
    ? payload.error.message.slice(0, 500)
    : "The provider returned an unreadable error.";
}

/**
 * A truncated or filtered completion is a distinct failure, not a parse error.
 * Collapsing them would report "invalid JSON" for a response that was simply
 * cut off, which sends the reader looking in the wrong place.
 */
function readOutputText(payload: unknown) {
  if (!isRecord(payload)) {
    throw new LlmError("llm_invalid_response", "The language model returned an unreadable response.");
  }
  if (!Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
    throw new LlmError("llm_invalid_response", "The language model response did not contain a completion choice.");
  }
  const choice = payload.choices[0];
  if (choice.finish_reason === "length") {
    throw new LlmError("llm_incomplete_response", "The language model response exceeded its output limit.");
  }
  if (choice.finish_reason === "content_filter") {
    throw new LlmError("llm_refused", "The language model provider filtered the response.");
  }
  if (!isRecord(choice.message) || typeof choice.message.content !== "string" || !choice.message.content.trim()) {
    throw new LlmError("llm_empty_response", "The language model response did not contain JSON content.");
  }
  return choice.message.content;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
