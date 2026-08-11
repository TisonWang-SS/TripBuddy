import type { SupportedCurrency } from "@prisma/client";
import { DEFAULT_SYSTEM_SETTING_ID } from "@/lib/constants";
import { normalizeObservedCurrency, roundMoney } from "@/lib/currency";
import { prisma } from "@/lib/db";

async function getSystemSettings() {
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

export async function setCurrencyConversionRate(input: {
  asOf: Date;
  rate: number;
  sourceCurrency: string;
  sourceName?: string | null;
}) {
  const sourceCurrency = normalizeObservedCurrency(input.sourceCurrency);
  const targetCurrency = await getSystemCurrency();
  if (!/^[A-Z]{3}$/.test(sourceCurrency)) {
    throw new Error("Source currency must be a three-letter currency code.");
  }
  if (sourceCurrency === targetCurrency) {
    throw new Error(`${sourceCurrency} already converts to itself at rate 1.`);
  }
  if (!Number.isFinite(input.rate) || input.rate <= 0) {
    throw new Error("Conversion rate must be greater than zero.");
  }
  if (Number.isNaN(input.asOf.getTime())) {
    throw new Error("Conversion rate date is invalid.");
  }
  return prisma.currencyConversionRate.upsert({
    where: {
      systemSettingId_sourceCurrency_targetCurrency: {
        sourceCurrency,
        systemSettingId: DEFAULT_SYSTEM_SETTING_ID,
        targetCurrency
      }
    },
    update: {
      asOf: input.asOf,
      rate: input.rate,
      sourceName: input.sourceName?.trim() || null
    },
    create: {
      asOf: input.asOf,
      rate: input.rate,
      sourceCurrency,
      sourceName: input.sourceName?.trim() || null,
      systemSettingId: DEFAULT_SYSTEM_SETTING_ID,
      targetCurrency
    }
  });
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
