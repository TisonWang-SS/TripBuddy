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
  const settings = await getSystemSettings();
  return settings.displayCurrency;
}

export async function normalizeMoneyToSystemCurrency(input: {
  amount: number;
  basePrice?: number | null;
  taxAmount?: number | null;
  feeAmount?: number | null;
  totalPrice?: number | null;
  cashCopay?: number | null;
  sourceCurrency: string;
}) {
  const targetCurrency = await getSystemCurrency();
  const observedCurrency = normalizeObservedCurrency(input.sourceCurrency);
  if (observedCurrency !== targetCurrency && isZeroOnlyAwardLikeAmount(input)) {
    return {
      currency: targetCurrency,
      price: 0,
      basePrice: null,
      taxAmount: null,
      feeAmount: null,
      totalPrice: input.totalPrice === null || input.totalPrice === undefined ? null : 0,
      cashCopay: null,
      observedCurrency: null,
      observedPrice: null,
      conversionRate: null
    };
  }

  const conversionRate = await findConversionRate(observedCurrency, targetCurrency);

  if (conversionRate === null) {
    throw new Error(`Missing currency conversion rate from ${observedCurrency} to ${targetCurrency}.`);
  }

  return {
    currency: targetCurrency,
    price: roundMoney(input.amount * conversionRate),
    basePrice: convertNullable(input.basePrice, conversionRate),
    taxAmount: convertNullable(input.taxAmount, conversionRate),
    feeAmount: convertNullable(input.feeAmount, conversionRate),
    totalPrice: convertNullable(input.totalPrice, conversionRate),
    cashCopay: convertNullable(input.cashCopay, conversionRate),
    observedCurrency,
    observedPrice: observedCurrency === targetCurrency ? null : input.amount,
    conversionRate: observedCurrency === targetCurrency ? null : conversionRate
  };
}

async function findConversionRate(sourceCurrency: string, targetCurrency: SupportedCurrency) {
  if (sourceCurrency === targetCurrency) {
    return 1;
  }

  const rate = await prisma.currencyConversionRate.findUnique({
    where: {
      systemSettingId_sourceCurrency_targetCurrency: {
        systemSettingId: DEFAULT_SYSTEM_SETTING_ID,
        sourceCurrency,
        targetCurrency
      }
    }
  });

  return rate?.rate ?? null;
}

function convertNullable(value: number | null | undefined, rate: number) {
  return value === null || value === undefined ? null : roundMoney(value * rate);
}

function isZeroOnlyAwardLikeAmount(input: {
  amount: number;
  basePrice?: number | null;
  taxAmount?: number | null;
  feeAmount?: number | null;
  totalPrice?: number | null;
  cashCopay?: number | null;
}) {
  return (
    input.amount === 0 &&
    (input.basePrice === null || input.basePrice === undefined) &&
    (input.taxAmount === null || input.taxAmount === undefined) &&
    (input.feeAmount === null || input.feeAmount === undefined) &&
    (input.cashCopay === null || input.cashCopay === undefined) &&
    (input.totalPrice === null || input.totalPrice === undefined || input.totalPrice === 0)
  );
}
