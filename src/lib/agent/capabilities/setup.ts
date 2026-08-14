import { argsBag } from "@/lib/agent/args";
import { instant } from "@/lib/agent/serialize";
import type { Capability } from "@/lib/agent/types";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { isValuationStale } from "@/lib/loyaltyValuation";
import { isLlmEvidenceExtractionConfigured } from "@/lib/providers/llmEvidence";
import { getSystemCurrency } from "@/lib/systemSettings";

export type ProfileValues = {
  caresAboutBreakfast: boolean;
  caresAboutLateCheckout: boolean;
  caresAboutLounge: boolean;
  caresAboutUpgrade: boolean;
  defaultCurrency: string;
  name: string;
  savingsThreshold: number;
  urgentWindowHours: number;
};

export type ValuationRecord = {
  amount: number;
  asOf: string | null;
  currency: string;
  hotelGroup: string;
  kind: string;
  lastReviewedAt: string | null;
  realizationRate: number;
  sourceName: string;
  /* Reported rather than filtered: a figure past review is still in use. */
  stale: boolean;
};

export const getProfile: Capability<
  Record<string, never>,
  { profile: ProfileValues | null; valuations: ValuationRecord[] }
> = {
  name: "get_profile",
  keywords: ["profile", "loyalty", "tier", "point value", "valuation", "threshold"],
  summary: "Read the traveler profile, sourced loyalty valuations, and entitlement-warning preferences.",
  effect: "read",
  params: [],
  parseArgs(raw) {
    argsBag(raw, []);
    return {};
  },
  async run() {
    const [profile, valuations] = await Promise.all([
      prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } }),
      prisma.loyaltyValuation.findMany({
        where: { profileId: DEFAULT_PROFILE_ID },
        orderBy: [{ hotelGroup: "asc" }, { kind: "asc" }]
      })
    ]);
    const now = new Date();
    const records = valuations.map((valuation) => ({
      amount: valuation.amount,
      asOf: instant(valuation.asOf),
      currency: valuation.currency,
      hotelGroup: valuation.hotelGroup,
      kind: valuation.kind,
      lastReviewedAt: instant(valuation.lastReviewedAt),
      realizationRate: valuation.realizationRate,
      sourceName: valuation.sourceName,
      stale: isValuationStale(valuation, now)
    }));
    if (!profile) {
      return { profile: null, valuations: records };
    }
    return {
      profile: {
        caresAboutBreakfast: profile.caresAboutBreakfast,
        caresAboutLateCheckout: profile.caresAboutLateCheckout,
        caresAboutLounge: profile.caresAboutLounge,
        caresAboutUpgrade: profile.caresAboutUpgrade,
        defaultCurrency: profile.defaultCurrency,
        name: profile.name,
        savingsThreshold: profile.savingsThreshold,
        urgentWindowHours: profile.urgentWindowHours
      },
      valuations: records
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
