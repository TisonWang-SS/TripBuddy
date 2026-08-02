import type { SupportedCurrency } from "@prisma/client";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import { prisma } from "@/lib/db";

export async function getProfileSearchCurrency(): Promise<SupportedCurrency> {
  const profile = await prisma.userProfile.findUnique({
    select: { defaultCurrency: true },
    where: { id: DEFAULT_PROFILE_ID }
  });
  return profile?.defaultCurrency ?? "USD";
}
