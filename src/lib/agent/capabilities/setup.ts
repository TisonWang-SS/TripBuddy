import { argsBag } from "@/lib/agent/args";
import { instant } from "@/lib/agent/serialize";
import type { Capability } from "@/lib/agent/types";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { isLlmEvidenceExtractionConfigured } from "@/lib/providers/llmEvidence";
import { getSystemCurrency } from "@/lib/systemSettings";

export type ProfileValues = {
  breakfastValue: number;
  defaultCurrency: string;
  eliteNightValue: number;
  lateCheckoutValue: number;
  loungeValue: number;
  name: string;
  savingsThreshold: number;
  upgradeValue: number;
  urgentWindowHours: number;
};

export const getProfile: Capability<Record<string, never>, { profile: ProfileValues | null }> = {
  name: "get_profile",
  keywords: ["profile", "loyalty", "tier", "point value", "threshold"],
  summary: "Read the traveler profile that prices loyalty and benefit value.",
  effect: "read",
  params: [],
  parseArgs(raw) {
    argsBag(raw, []);
    return {};
  },
  async run() {
    const profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });
    if (!profile) {
      return { profile: null };
    }
    return {
      profile: {
        breakfastValue: profile.breakfastValue,
        defaultCurrency: profile.defaultCurrency,
        eliteNightValue: profile.eliteNightValue,
        lateCheckoutValue: profile.lateCheckoutValue,
        loungeValue: profile.loungeValue,
        name: profile.name,
        savingsThreshold: profile.savingsThreshold,
        upgradeValue: profile.upgradeValue,
        urgentWindowHours: profile.urgentWindowHours
      }
    };
  }
};

export const getSettings: Capability<
  Record<string, never>,
  {
    conversionRates: { asOf: string | null; rate: number; sourceCurrency: string; targetCurrency: string }[];
    displayCurrency: string;
    /* Whether the opt-in model replay stage is available at all. */
    llmExtractionConfigured: boolean;
  }
> = {
  name: "get_settings",
  keywords: ["settings", "currency", "conversion rate", "exchange rate", "configuration"],
  summary: "Read the display currency, stored conversion rates, and whether model extraction is configured.",
  effect: "read",
  params: [],
  parseArgs(raw) {
    argsBag(raw, []);
    return {};
  },
  async run() {
    const [displayCurrency, rates] = await Promise.all([
      getSystemCurrency(),
      prisma.currencyConversionRate.findMany({ orderBy: { sourceCurrency: "asc" } })
    ]);
    return {
      conversionRates: rates.map((rate) => ({
        asOf: instant(rate.asOf),
        rate: rate.rate,
        sourceCurrency: rate.sourceCurrency,
        targetCurrency: rate.targetCurrency
      })),
      displayCurrency,
      llmExtractionConfigured: isLlmEvidenceExtractionConfigured()
    };
  }
};
