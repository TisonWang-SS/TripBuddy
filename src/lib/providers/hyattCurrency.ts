export const HYATT_CURRENCY_TOKENS = [
  "US\\$",
  "USD",
  "CA\\$",
  "CAD",
  "A\\$",
  "AUD",
  "HK\\$",
  "HKD",
  "S\\$",
  "SGD",
  "MYR",
  "RM",
  "JPY",
  "CN¥",
  "¥",
  "￥",
  "CNY",
  "RMB",
  "EUR",
  "€",
  "GBP",
  "£",
  "THB",
  "฿",
  "KRW",
  "₩",
  "\\$"
] as const;

export const HYATT_CURRENCY_PATTERN = HYATT_CURRENCY_TOKENS.join("|");

export function normalizeHyattCurrency(value: string) {
  const normalized = value.replace(/\s+/g, "").toUpperCase();
  const aliases: Record<string, string> = {
    "$": "USD",
    "A$": "AUD",
    "CA$": "CAD",
    "CN¥": "CNY",
    "HK$": "HKD",
    "S$": "SGD",
    "US$": "USD",
    RM: "MYR",
    RMB: "CNY",
    "¥": "JPY",
    "￥": "JPY",
    "€": "EUR",
    "£": "GBP",
    "฿": "THB",
    "₩": "KRW"
  };
  return aliases[normalized] ?? (normalized.slice(0, 3) || "USD");
}
