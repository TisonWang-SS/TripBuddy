-- CreateTable
CREATE TABLE "LoyaltyValuation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "hotelGroup" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "realizationRate" REAL NOT NULL DEFAULT 1,
    "sourceName" TEXT NOT NULL,
    "asOf" DATETIME NOT NULL,
    "lastReviewedAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoyaltyValuation_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "LoyaltyValuation_profileId_hotelGroup_kind_key" ON "LoyaltyValuation"("profileId", "hotelGroup", "kind");

-- A recorded point value moves to the sourced store rather than being dropped:
-- the traveler typed it, so "Traveler entry" is its true source and the row's
-- own updatedAt is truly as of when. Values left at the old form default carry
-- an old review date and therefore surface as stale, which is the correct
-- reading of a number nobody ever chose.
INSERT INTO "LoyaltyValuation" (
    "id", "profileId", "hotelGroup", "kind", "amount", "currency", "realizationRate",
    "sourceName", "asOf", "lastReviewedAt", "createdAt", "updatedAt"
)
SELECT
    lower(hex(randomblob(16))),
    "LoyaltyAccount"."profileId",
    "LoyaltyAccount"."hotelGroup",
    'point',
    "LoyaltyAccount"."pointValue",
    "UserProfile"."defaultCurrency",
    1,
    'Traveler entry',
    "LoyaltyAccount"."updatedAt",
    "LoyaltyAccount"."updatedAt",
    "LoyaltyAccount"."createdAt",
    "LoyaltyAccount"."updatedAt"
FROM "LoyaltyAccount"
JOIN "UserProfile" ON "UserProfile"."id" = "LoyaltyAccount"."profileId";

ALTER TABLE "LoyaltyAccount" DROP COLUMN "pointValue";

-- A certificate baseline can now say what it spends. Existing rows keep their
-- prose label and stay unpriced until a count and kind are recorded.
ALTER TABLE "HotelBooking" ADD COLUMN "baselineAwardKind" TEXT;
ALTER TABLE "HotelBooking" ADD COLUMN "baselineAwardCount" INTEGER;
