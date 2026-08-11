ALTER TABLE "LoyaltyAccount" DROP COLUMN "currentNights";
ALTER TABLE "LoyaltyAccount" DROP COLUMN "currentPoints";
ALTER TABLE "LoyaltyAccount" DROP COLUMN "currentSpend";
ALTER TABLE "LoyaltyAccount" DROP COLUMN "targetTier";

ALTER TABLE "CreditCardBenefit" DROP COLUMN "eliteNightCredits";

ALTER TABLE "ObservationEvidence" DROP COLUMN "promotionApplicability";

ALTER TABLE "LoyaltyRule" DROP COLUMN "nightsRequired";
ALTER TABLE "LoyaltyRule" DROP COLUMN "pointsRequired";
ALTER TABLE "LoyaltyRule" DROP COLUMN "spendRequired";
