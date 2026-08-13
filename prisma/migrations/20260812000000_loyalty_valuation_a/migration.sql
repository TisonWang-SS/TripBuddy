ALTER TABLE "UserProfile" ADD COLUMN "caresAboutBreakfast" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserProfile" ADD COLUMN "caresAboutLounge" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserProfile" ADD COLUMN "caresAboutLateCheckout" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserProfile" ADD COLUMN "caresAboutUpgrade" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "UserProfile" DROP COLUMN "breakfastValue";
ALTER TABLE "UserProfile" DROP COLUMN "loungeValue";
ALTER TABLE "UserProfile" DROP COLUMN "lateCheckoutValue";
ALTER TABLE "UserProfile" DROP COLUMN "upgradeValue";
ALTER TABLE "UserProfile" DROP COLUMN "eliteNightValue";

-- The recommendation rows and their costBreakdownJson snapshots are copied in
-- place by SQLite. Historical snapshots keep the two legacy components; no
-- historical effective cost or savings figure is recalculated.
ALTER TABLE "Recommendation" DROP COLUMN "eliteProgressDifference";
ALTER TABLE "Recommendation" DROP COLUMN "benefitValueDifference";
