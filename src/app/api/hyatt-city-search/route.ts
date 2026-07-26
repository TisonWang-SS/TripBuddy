import { NextResponse } from "next/server";
import path from "node:path";
import { DEFAULT_PROFILE_ID } from "@/lib/constants";
import {
  resolveChromeProfileDirectory,
  searchHyattCityRatesWithChromeProfile,
  standardChromeUserDataDir,
  type ChromeProfileConfig
} from "@/lib/browserConnector";
import { prisma } from "@/lib/db";
import { normalizeHyattCitySearchQuery } from "@/lib/hyattCitySearch";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { errors, query } = normalizeHyattCitySearchQuery({
    adults: Number(url.searchParams.get("adults") ?? 2),
    checkIn: url.searchParams.get("checkIn") ?? "",
    checkOut: url.searchParams.get("checkOut") ?? "",
    city: url.searchParams.get("city") ?? "",
    currency: url.searchParams.get("currency") ?? "USD"
  });

  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join(" ") }, { status: 400 });
  }

  const profile = await prisma.userProfile.findUnique({ where: { id: DEFAULT_PROFILE_ID } });
  const chromeProfile = await resolveConfiguredChromeProfile({
    chromeDebugPort: profile?.chromeDebugPort ?? 0,
    chromeProfileDirectory: profile?.chromeProfileDirectory,
    chromeProfileName: profile?.chromeProfileName ?? "TripBuddy",
    chromeUserDataDir: profile?.chromeUserDataDir
  });
  if (!chromeProfile.ok) {
    return NextResponse.json({ error: chromeProfile.error }, { status: 400 });
  }

  let run;
  try {
    run = await searchHyattCityRatesWithChromeProfile(query, chromeProfile.config);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown Chrome profile failure.";
    return NextResponse.json(
      {
        error: `Hyatt search could not control the configured Chrome profile: ${message} Close the existing Chrome window for this profile, or start it with remote debugging on port ${chromeProfile.config.debugPort}, then try again.`
      },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ...run,
    capturedAt: run.capturedAt.toISOString()
  });
}

async function resolveConfiguredChromeProfile(profile: {
  chromeDebugPort: number;
  chromeProfileDirectory?: string | null;
  chromeProfileName: string;
  chromeUserDataDir?: string | null;
}): Promise<{ config: ChromeProfileConfig; ok: true } | { error: string; ok: false }> {
  const userDataDir = profile.chromeUserDataDir?.trim() || standardChromeUserDataDir();
  const profileDirectory =
    profile.chromeProfileDirectory?.trim() ||
    (await resolveChromeProfileDirectory(profile.chromeProfileName, path.join(userDataDir, "Local State")).catch(() => null));

  if (!profileDirectory) {
    return {
      error:
        "Hyatt search requires a real Chrome profile. Open Settings and set the Chrome data directory/profile for a normal browser profile before searching Hyatt.",
      ok: false
    };
  }

  return {
    config: {
      debugPort: profile.chromeDebugPort || 9222,
      profileDirectory,
      profileName: profile.chromeProfileName,
      userDataDir
    },
    ok: true
  };
}
