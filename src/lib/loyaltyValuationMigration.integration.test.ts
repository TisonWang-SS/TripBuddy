import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

const MIGRATION = "20260812000000_loyalty_valuation_a";
let workspace = "";

afterEach(() => {
  if (workspace) {
    rmSync(workspace, { force: true, recursive: true });
    workspace = "";
  }
});

describe("loyalty valuation A migration", () => {
  it("preserves historical recommendation rows and snapshots without recalculation", () => {
    workspace = mkdtempSync(join(tmpdir(), "tripbuddy-loyalty-migration-"));
    const sqlite = new DatabaseSync(join(workspace, "migration.db"));
    const migrations = readdirSync("prisma/migrations", { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => existsSync(join("prisma/migrations", name, "migration.sql")))
      .sort();

    for (const migration of migrations.filter((name) => name < MIGRATION)) {
      sqlite.exec(readFileSync(join("prisma/migrations", migration, "migration.sql"), "utf8"));
    }

    const legacyBreakdown = JSON.stringify({
      baseline: {
        benefitValue: 50,
        cashPrice: 1200,
        creditCardValue: 0,
        effectiveCost: 1120,
        eliteProgressValue: 30,
        earnedPointsValue: 0,
        promotionValue: 0,
        redemptionPointsValue: 0
      },
      candidate: {
        benefitValue: 0,
        cashPrice: 1100,
        creditCardValue: 0,
        effectiveCost: 1100,
        eliteProgressValue: 0,
        earnedPointsValue: 0,
        promotionValue: 0,
        redemptionPointsValue: 0
      }
    });
    sqlite.prepare('INSERT INTO "UserProfile" ("id", "name", "updatedAt") VALUES (?, ?, ?)').run(
      "profile-before-a",
      "Legacy Traveler",
      "2030-01-01T00:00:00.000Z"
    );
    sqlite.prepare(`
      INSERT INTO "HotelBooking" (
        "id", "hotelGroup", "hotelName", "city", "checkIn", "checkOut", "roomType", "updatedAt"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "booking-before-a",
      "Hyatt",
      "Legacy Hyatt",
      "Tokyo",
      "2030-09-10",
      "2030-09-12",
      "1 King Bed",
      "2030-01-01T00:00:00.000Z"
    );
    sqlite.prepare(`
      INSERT INTO "Recommendation" (
        "id", "bookingId", "verdict", "riskLevel", "qualityLevel", "estimatedSavings", "currency",
        "cashDifference", "pointsValueDifference", "promotionValueDifference", "creditCardValueDifference",
        "eliteProgressDifference", "benefitValueDifference", "explanation", "costBreakdownJson",
        "decisionProvider", "decisionVersion"
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "recommendation-before-a",
      "booking-before-a",
      "keep",
      "low",
      "high",
      20,
      "USD",
      100,
      0,
      0,
      0,
      -30,
      -50,
      "Historical recommendation.",
      legacyBreakdown,
      "deterministic",
      "2"
    );

    sqlite.exec(readFileSync(join("prisma/migrations", MIGRATION, "migration.sql"), "utf8"));

    const recommendation = sqlite.prepare(
      'SELECT "estimatedSavings", "costBreakdownJson" FROM "Recommendation" WHERE "id" = ?'
    ).get("recommendation-before-a") as { costBreakdownJson: string; estimatedSavings: number };
    const profile = sqlite.prepare(
      'SELECT "caresAboutBreakfast", "caresAboutLounge", "caresAboutLateCheckout", "caresAboutUpgrade" FROM "UserProfile" WHERE "id" = ?'
    ).get("profile-before-a");
    const recommendationColumns = sqlite.prepare('PRAGMA table_info("Recommendation")').all() as Array<{ name: string }>;
    const profileColumns = sqlite.prepare('PRAGMA table_info("UserProfile")').all() as Array<{ name: string }>;

    expect(recommendation).toEqual({ costBreakdownJson: legacyBreakdown, estimatedSavings: 20 });
    expect(profile).toEqual({
      caresAboutBreakfast: 1,
      caresAboutLateCheckout: 1,
      caresAboutLounge: 1,
      caresAboutUpgrade: 1
    });
    expect(recommendationColumns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["benefitValueDifference", "eliteProgressDifference"])
    );
    expect(profileColumns.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["breakfastValue", "loungeValue", "lateCheckoutValue", "upgradeValue", "eliteNightValue"])
    );

    sqlite.close();
  });
});
