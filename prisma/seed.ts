import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const reviewedAt = new Date("2026-07-21T00:00:00.000Z");

const loyaltyRules = [
  ["Hyatt", "Member", null, null, null, 5, 0, false, false, false, false, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["Hyatt", "Discoverist", 10, 25000, null, 5, 0.1, false, false, true, true, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["Hyatt", "Explorist", 30, 50000, null, 5, 0.2, false, false, true, true, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["Hyatt", "Globalist", 60, 100000, null, 5, 0.3, true, true, true, true, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["IHG", "Club Member", null, null, null, 10, 0, false, false, false, false, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Silver Elite", 10, null, null, 10, 0.2, false, false, false, false, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Gold Elite", 20, 40000, null, 10, 0.4, false, false, false, false, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Platinum Elite", 40, 60000, null, 10, 0.6, false, false, true, true, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Diamond Elite", 70, 120000, null, 10, 1, true, false, true, true, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["Marriott", "Member", null, null, null, 10, 0, false, false, false, false, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Silver Elite", 10, null, null, 10, 0.1, false, false, true, false, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Gold Elite", 25, null, null, 10, 0.25, false, false, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Platinum Elite", 50, null, null, 10, 0.5, true, true, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Titanium Elite", 75, null, null, 10, 0.75, true, true, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Ambassador Elite", 100, null, 23000, 10, 0.75, true, true, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Hilton", "Member", null, null, null, 10, 0, false, false, false, false, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Hilton", "Silver", 10, null, 2500, 10, 0.2, false, false, false, false, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Hilton", "Gold", 25, null, 6000, 10, 0.8, true, false, false, true, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Hilton", "Diamond", 50, null, 11500, 10, 1, true, true, false, true, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Accor", "Classic", null, null, null, 25, 0, false, false, false, false, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Silver", 10, 2000, null, 25, 0.24, false, false, true, false, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Gold", 30, 7000, null, 25, 0.48, false, false, true, true, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Platinum", 60, 14000, null, 25, 0.76, false, true, true, true, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Diamond", null, 26000, null, 25, 1, true, true, true, true, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"]
] as const;

async function main() {
  await prisma.systemSetting.upsert({
    where: { id: "primary" },
    update: {},
    create: {
      id: "primary",
      displayCurrency: "USD"
    }
  });

  for (const rule of loyaltyRules) {
    await prisma.loyaltyRule.upsert({
      where: {
        hotelGroup_tier: {
          hotelGroup: rule[0],
          tier: rule[1]
        }
      },
      update: {
        nightsRequired: rule[2],
        pointsRequired: rule[3],
        spendRequired: rule[4],
        basePointsPerUsd: rule[5],
        bonusRate: rule[6],
        breakfastBenefit: rule[7],
        loungeBenefit: rule[8],
        lateCheckoutBenefit: rule[9],
        upgradeBenefit: rule[10],
        sourceUrl: rule[11],
        lastReviewedAt: reviewedAt
      },
      create: {
        hotelGroup: rule[0],
        tier: rule[1],
        nightsRequired: rule[2],
        pointsRequired: rule[3],
        spendRequired: rule[4],
        basePointsPerUsd: rule[5],
        bonusRate: rule[6],
        breakfastBenefit: rule[7],
        loungeBenefit: rule[8],
        lateCheckoutBenefit: rule[9],
        upgradeBenefit: rule[10],
        sourceUrl: rule[11],
        lastReviewedAt: reviewedAt
      }
    });
  }

  await prisma.userProfile.upsert({
    where: { id: "primary" },
    update: {},
    create: {
      id: "primary",
      name: "Primary Traveler",
      defaultCurrency: "USD",
      savingsThreshold: 50,
      urgentWindowHours: 24,
      breakfastValue: 25,
      loungeValue: 35,
      lateCheckoutValue: 15,
      upgradeValue: 40,
      eliteNightValue: 10
    }
  });

}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
