export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toJson(value: unknown) {
  return JSON.stringify(value);
}

export function sanitizeEvidenceText(value: string, limit = 1200) {
  return value
    .replace(/\b([\w.+-]+)@([\w.-]+\.[A-Za-z]{2,})\b/g, "[redacted email]")
    .replace(/\b(?:confirmation|reservation)(?:\s+(?:number|code))?\s*[:#]?\s*[A-Z0-9-]{5,}\b/gi, "Confirmation: [redacted]")
    .replace(/\b(?:world of hyatt|member)(?:\s+(?:number|id))?\s*[:#]?\s*[A-Z0-9-]{6,}\b/gi, "Member: [redacted]")
    .replace(/\b(?:\d[ -]*?){13,19}\b/g, "[redacted number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

export function stringList(value: string | null | undefined) {
  const parsed = parseJson<unknown>(value, []);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}
