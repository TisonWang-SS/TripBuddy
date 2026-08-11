-- Track how extracted price facts were produced and preserve model replay attempts.
ALTER TABLE "PriceObservation" ADD COLUMN "extractionSource" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "PriceObservation" ADD COLUMN "extractorName" TEXT NOT NULL DEFAULT 'manual-form';
ALTER TABLE "PriceObservation" ADD COLUMN "extractorVersion" TEXT NOT NULL DEFAULT '1';
ALTER TABLE "PriceObservation" ADD COLUMN "extractionRunId" TEXT;

UPDATE "PriceObservation"
SET "extractionSource" = 'deterministic',
    "extractorName" = COALESCE("providerName", 'browser-companion'),
    "extractorVersion" = '1'
WHERE "collectionMethod" = 'browser_companion';

CREATE TABLE "EvidenceExtractionRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "priceCheckRunId" TEXT NOT NULL,
    "extractorName" TEXT NOT NULL,
    "extractorVersion" TEXT NOT NULL,
    "modelName" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "snapshotCount" INTEGER NOT NULL,
    "proposedCandidatesJson" TEXT NOT NULL DEFAULT '[]',
    "acceptedCandidatesJson" TEXT NOT NULL DEFAULT '[]',
    "issuesJson" TEXT NOT NULL DEFAULT '[]',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EvidenceExtractionRun_priceCheckRunId_fkey" FOREIGN KEY ("priceCheckRunId") REFERENCES "PriceCheckRun" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "EvidenceExtractionRun_priceCheckRunId_createdAt_idx" ON "EvidenceExtractionRun"("priceCheckRunId", "createdAt");

-- SQLite cannot add a foreign key with ALTER COLUMN, so rebuild the observation
-- table after the extraction-run table exists.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_PriceObservation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "priceCheckRunId" TEXT,
    "observedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "collectionMethod" TEXT NOT NULL DEFAULT 'manual',
    "sourceName" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "providerName" TEXT,
    "inventoryType" TEXT NOT NULL DEFAULT 'cash',
    "cashBase" REAL,
    "cashTaxes" REAL,
    "cashFees" REAL,
    "cashTotal" REAL,
    "cashCurrency" TEXT,
    "points" INTEGER,
    "cashCopay" REAL,
    "cashCopayCurrency" TEXT,
    "rawRateName" TEXT,
    "ratePlanName" TEXT,
    "roomTypeRaw" TEXT,
    "isSuite" BOOLEAN,
    "cancellationPolicyRaw" TEXT,
    "breakfastIncluded" BOOLEAN,
    "loyaltyEligible" BOOLEAN,
    "sourceUrl" TEXT,
    "notes" TEXT,
    "extractionSource" TEXT NOT NULL DEFAULT 'manual',
    "extractorName" TEXT NOT NULL DEFAULT 'manual-form',
    "extractorVersion" TEXT NOT NULL DEFAULT '1',
    "extractionRunId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PriceObservation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HotelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceObservation_priceCheckRunId_fkey" FOREIGN KEY ("priceCheckRunId") REFERENCES "PriceCheckRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PriceObservation_extractionRunId_fkey" FOREIGN KEY ("extractionRunId") REFERENCES "EvidenceExtractionRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

INSERT INTO "new_PriceObservation" (
    "id", "bookingId", "priceCheckRunId", "observedAt", "collectionMethod", "sourceName", "sourceType",
    "providerName", "inventoryType", "cashBase", "cashTaxes", "cashFees", "cashTotal", "cashCurrency",
    "points", "cashCopay", "cashCopayCurrency", "rawRateName", "ratePlanName", "roomTypeRaw", "isSuite",
    "cancellationPolicyRaw", "breakfastIncluded", "loyaltyEligible", "sourceUrl", "notes", "extractionSource",
    "extractorName", "extractorVersion", "extractionRunId", "createdAt", "updatedAt"
)
SELECT
    "id", "bookingId", "priceCheckRunId", "observedAt", "collectionMethod", "sourceName", "sourceType",
    "providerName", "inventoryType", "cashBase", "cashTaxes", "cashFees", "cashTotal", "cashCurrency",
    "points", "cashCopay", "cashCopayCurrency", "rawRateName", "ratePlanName", "roomTypeRaw", "isSuite",
    "cancellationPolicyRaw", "breakfastIncluded", "loyaltyEligible", "sourceUrl", "notes", "extractionSource",
    "extractorName", "extractorVersion", "extractionRunId", "createdAt", "updatedAt"
FROM "PriceObservation";

DROP TABLE "PriceObservation";
ALTER TABLE "new_PriceObservation" RENAME TO "PriceObservation";

CREATE INDEX "PriceObservation_bookingId_observedAt_idx" ON "PriceObservation"("bookingId", "observedAt");
CREATE INDEX "PriceObservation_extractionRunId_idx" ON "PriceObservation"("extractionRunId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
