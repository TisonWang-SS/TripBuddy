import type { SupportedCurrency } from "@prisma/client";
import { SUPPORTED_CURRENCIES } from "@/lib/constants";

export function supportedCurrencyValue(value: FormDataEntryValue | string | null | undefined, fallback: SupportedCurrency = "USD") {
  const normalized = String(value ?? "").trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(normalized as SupportedCurrency) ? (normalized as SupportedCurrency) : fallback;
}

export function externalCurrencyCode(currency: string) {
  return currency;
}

export function displayCurrencyCode(currency: string) {
  return currency;
}

export function inferIsSuite(roomType: string) {
  return /\bsuite\b/i.test(roomType);
}

export function normalizeObservedCurrency(value: string) {
  return value.trim().toUpperCase();
}

export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}
