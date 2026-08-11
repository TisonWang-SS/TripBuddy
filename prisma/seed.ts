import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const reviewedAt = new Date("2026-07-21T00:00:00.000Z");

const loyaltyRules = [
  ["Hyatt", "Member", 5, 0, false, false, false, false, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["Hyatt", "Discoverist", 5, 0.1, false, false, true, true, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["Hyatt", "Explorist", 5, 0.2, false, false, true, true, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["Hyatt", "Globalist", 5, 0.3, true, true, true, true, "https://world.hyatt.com/content/gp/en/tiers-and-benefits.html"],
  ["IHG", "Club Member", 10, 0, false, false, false, false, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Silver Elite", 10, 0.2, false, false, false, false, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Gold Elite", 10, 0.4, false, false, false, false, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Platinum Elite", 10, 0.6, false, false, true, true, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["IHG", "Diamond Elite", 10, 1, true, false, true, true, "https://www.ihg.com/onerewards/content/us/en/tier-benefits"],
  ["Marriott", "Member", 10, 0, false, false, false, false, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Silver Elite", 10, 0.1, false, false, true, false, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Gold Elite", 10, 0.25, false, false, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Platinum Elite", 10, 0.5, true, true, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Titanium Elite", 10, 0.75, true, true, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Marriott", "Ambassador Elite", 10, 0.75, true, true, true, true, "https://www.marriott.com/loyalty/member-benefits.mi"],
  ["Hilton", "Member", 10, 0, false, false, false, false, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Hilton", "Silver", 10, 0.2, false, false, false, false, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Hilton", "Gold", 10, 0.8, true, false, false, true, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Hilton", "Diamond", 10, 1, true, true, false, true, "https://www.hilton.com/en/help-center/hilton-honors-benefits/tiers-and-benefits/"],
  ["Accor", "Classic", 25, 0, false, false, false, false, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Silver", 25, 0.24, false, false, true, false, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Gold", 25, 0.48, false, false, true, true, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Platinum", 25, 0.76, false, true, true, true, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"],
  ["Accor", "Diamond", 25, 1, true, true, true, true, "https://all.accor.com/loyalty-program/cards-status-benefits-details/index.en.shtml"]
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
        basePointsPerUsd: rule[2],
        bonusRate: rule[3],
        breakfastBenefit: rule[4],
        loungeBenefit: rule[5],
        lateCheckoutBenefit: rule[6],
        upgradeBenefit: rule[7],
        sourceUrl: rule[8],
        lastReviewedAt: reviewedAt
      },
      create: {
        hotelGroup: rule[0],
        tier: rule[1],
        basePointsPerUsd: rule[2],
        bonusRate: rule[3],
        breakfastBenefit: rule[4],
        loungeBenefit: rule[5],
        lateCheckoutBenefit: rule[6],
        upgradeBenefit: rule[7],
        sourceUrl: rule[8],
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
