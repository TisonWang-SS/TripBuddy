import type { SupportedCurrency } from "@prisma/client";
import { DEFAULT_SYSTEM_SETTING_ID } from "@/lib/constants";
import { normalizeObservedCurrency, roundMoney } from "@/lib/currency";
import { prisma } from "@/lib/db";

export async function getSystemSettings() {
  return prisma.systemSetting.upsert({
    where: { id: DEFAULT_SYSTEM_SETTING_ID },
    update: {},
    create: { id: DEFAULT_SYSTEM_SETTING_ID, displayCurrency: "USD" }
  });
}

export async function getSystemCurrency() {
  return (await getSystemSettings()).displayCurrency;
}

export async function getCurrencyConversion(sourceCurrency: string, targetCurrency: SupportedCurrency) {
  const normalizedSource = normalizeObservedCurrency(sourceCurrency);
  if (normalizedSource === targetCurrency) {
    return 1;
  }
  const rate = await prisma.currencyConversionRate.findUnique({
    where: {
      systemSettingId_sourceCurrency_targetCurrency: {
        sourceCurrency: normalizedSource,
        systemSettingId: DEFAULT_SYSTEM_SETTING_ID,
        targetCurrency
      }
    }
  });
  return rate?.rate ?? null;
}

export async function convertMoneyToSystemCurrency(amount: number, sourceCurrency: string) {
  const currency = await getSystemCurrency();
  const observedCurrency = normalizeObservedCurrency(sourceCurrency);
  const rate = await getCurrencyConversion(observedCurrency, currency);
  if (rate === null) {
    return null;
  }
  return {
    amount: roundMoney(amount * rate),
    currency,
    observedCurrency,
    rate
  };
}
