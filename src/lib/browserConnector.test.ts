import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_CDP_INTERACTION_WAIT_MS,
  isEmptyHyattDocument,
  normalizeCdpInteractionWaitMs,
  normalizeDebugPort,
  resolveChromeProfileDirectory
} from "@/lib/browserConnector";

describe("browser connector", () => {
  it("resolves a Chrome profile directory by display name", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tripbuddy-chrome-profile-"));
    const localStatePath = path.join(dir, "Local State");

    await writeFile(
      localStatePath,
      JSON.stringify({
        profile: {
          info_cache: {
            "Profile 7": { name: "TripBuddy" },
            Default: { name: "Personal" }
          }
        }
      })
    );

    await expect(resolveChromeProfileDirectory("TripBuddy", localStatePath)).resolves.toBe("Profile 7");
    await rm(dir, { recursive: true, force: true });
  });

  it("normalizes invalid Chrome debug ports", () => {
    expect(normalizeDebugPort(9223)).toBe(9223);
    expect(normalizeDebugPort(0)).toBe(0);
    expect(normalizeDebugPort(70000)).toBe(0);
    expect(normalizeDebugPort(undefined)).toBe(0);
  });

  it("defaults CDP interaction waits to one second", () => {
    expect(DEFAULT_CDP_INTERACTION_WAIT_MS).toBe(1000);
    expect(normalizeCdpInteractionWaitMs(undefined)).toBe(1000);
    expect(normalizeCdpInteractionWaitMs(null)).toBe(1000);
    expect(normalizeCdpInteractionWaitMs(-1)).toBe(1000);
    expect(normalizeCdpInteractionWaitMs(0)).toBe(0);
    expect(normalizeCdpInteractionWaitMs(1250.4)).toBe(1250);
  });

  it("detects empty Hyatt automation documents", () => {
    expect(
      isEmptyHyattDocument({
        htmlSample: "<html><head></head><body></body></html>",
        textLength: 0,
        title: "",
        url: "https://www.hyatt.com/en-US/shop/rooms/kulzk"
      })
    ).toBe(true);
    expect(
      isEmptyHyattDocument({
        htmlSample: "<html><head></head><body>Rates</body></html>",
        textLength: 5,
        title: "Hyatt",
        url: "https://www.hyatt.com/en-US/shop/rooms/kulzk"
      })
    ).toBe(false);
    expect(
      isEmptyHyattDocument({
        htmlSample:
          '<html><head></head><body><script>window.KPSDK={};</script><script src="/challenge/ips.js?x-kpsdk-im=abc"></script></body></html>',
        textLength: 0,
        title: "",
        url: "https://www.hyatt.com/shop/rooms/kuagh"
      })
    ).toBe(true);
  });
});
