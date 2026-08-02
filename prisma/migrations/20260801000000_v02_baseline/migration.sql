-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'primary',
    "displayCurrency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CurrencyConversionRate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "systemSettingId" TEXT NOT NULL DEFAULT 'primary',
    "sourceCurrency" TEXT NOT NULL,
    "targetCurrency" TEXT NOT NULL,
    "rate" REAL NOT NULL,
    "sourceName" TEXT,
    "asOf" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CurrencyConversionRate_systemSettingId_fkey" FOREIGN KEY ("systemSettingId") REFERENCES "SystemSetting" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserProfile" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL DEFAULT 'Primary Traveler',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'USD',
    "savingsThreshold" REAL NOT NULL DEFAULT 50,
    "urgentWindowHours" INTEGER NOT NULL DEFAULT 24,
    "breakfastValue" REAL NOT NULL DEFAULT 25,
    "loungeValue" REAL NOT NULL DEFAULT 35,
    "lateCheckoutValue" REAL NOT NULL DEFAULT 15,
    "upgradeValue" REAL NOT NULL DEFAULT 40,
    "eliteNightValue" REAL NOT NULL DEFAULT 10,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "hotelGroup" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "currentNights" INTEGER NOT NULL DEFAULT 0,
    "currentPoints" INTEGER NOT NULL DEFAULT 0,
    "currentSpend" REAL NOT NULL DEFAULT 0,
    "targetTier" TEXT,
    "pointValue" REAL NOT NULL DEFAULT 0.005,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LoyaltyAccount_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CreditCardBenefit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hotelGroup" TEXT,
    "cashBackRate" REAL NOT NULL DEFAULT 0,
    "pointMultiplier" REAL NOT NULL DEFAULT 0,
    "eliteNightCredits" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CreditCardBenefit_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "HotelBooking" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelGroup" TEXT NOT NULL,
    "hotelName" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "checkIn" DATETIME NOT NULL,
    "checkOut" DATETIME NOT NULL,
    "guests" INTEGER NOT NULL DEFAULT 1,
    "roomType" TEXT NOT NULL,
    "isSuite" BOOLEAN NOT NULL DEFAULT false,
    "baselineType" TEXT NOT NULL DEFAULT 'cash',
    "baselineCashTotal" REAL,
    "baselinePoints" INTEGER,
    "baselineAwardLabel" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "bookingChannel" TEXT NOT NULL DEFAULT 'direct',
    "cancellationDeadline" DATETIME,
    "breakfastIncluded" BOOLEAN NOT NULL DEFAULT false,
    "loyaltyEligible" BOOLEAN NOT NULL DEFAULT true,
    "bookingUrl" TEXT,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WatchPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "cashEnabled" BOOLEAN NOT NULL DEFAULT true,
    "awardEnabled" BOOLEAN NOT NULL DEFAULT true,
    "normalCadenceHours" INTEGER NOT NULL DEFAULT 24,
    "urgentCadenceHours" INTEGER NOT NULL DEFAULT 6,
    "urgentWindowHours" INTEGER NOT NULL DEFAULT 72,
    "lastCheckedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "WatchPlan_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HotelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "BrowserTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "hotelGroup" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "launchUrl" TEXT NOT NULL,
    "contextJson" TEXT NOT NULL,
    "snapshotsJson" TEXT NOT NULL DEFAULT '[]',
    "resultJson" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "finishedAt" DATETIME
);

-- CreateTable
CREATE TABLE "PriceCheckRun" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "watchPlanId" TEXT,
    "browserTaskId" TEXT NOT NULL,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "trigger" TEXT NOT NULL,
    "inventoryTypesJson" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "summary" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "inventoryEvidenceJson" TEXT NOT NULL DEFAULT '[]',
    CONSTRAINT "PriceCheckRun_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HotelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceCheckRun_watchPlanId_fkey" FOREIGN KEY ("watchPlanId") REFERENCES "WatchPlan" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "PriceCheckRun_browserTaskId_fkey" FOREIGN KEY ("browserTaskId") REFERENCES "BrowserTask" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriceObservation" (
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PriceObservation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HotelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriceObservation_priceCheckRunId_fkey" FOREIGN KEY ("priceCheckRunId") REFERENCES "PriceCheckRun" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ObservationEvidence" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "observationId" TEXT NOT NULL,
    "sourceVerified" BOOLEAN NOT NULL DEFAULT false,
    "loginState" TEXT NOT NULL DEFAULT 'unknown',
    "roomMatch" TEXT NOT NULL DEFAULT 'unknown',
    "roomMatchReason" TEXT NOT NULL,
    "roomAssessmentSource" TEXT NOT NULL DEFAULT 'automated',
    "cancellationMatch" TEXT NOT NULL DEFAULT 'unknown',
    "cancellationMatchReason" TEXT NOT NULL,
    "cancellationAssessmentSource" TEXT NOT NULL DEFAULT 'automated',
    "taxesIncluded" TEXT NOT NULL DEFAULT 'unknown',
    "feesIncluded" TEXT NOT NULL DEFAULT 'unknown',
    "loyaltyEligibility" TEXT NOT NULL DEFAULT 'unknown',
    "promotionApplicability" TEXT NOT NULL DEFAULT 'unknown',
    "currencyComparable" BOOLEAN NOT NULL DEFAULT false,
    "qualityLevel" TEXT NOT NULL,
    "blockersJson" TEXT NOT NULL DEFAULT '[]',
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "snapshotJson" TEXT NOT NULL DEFAULT '{}',
    "reviewedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ObservationEvidence_observationId_fkey" FOREIGN KEY ("observationId") REFERENCES "PriceObservation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelGroup" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" DATETIME,
    "endDate" DATETIME,
    "bonusMultiplier" REAL NOT NULL DEFAULT 0,
    "flatValue" REAL NOT NULL DEFAULT 0,
    "requiresRegistration" BOOLEAN NOT NULL DEFAULT false,
    "appliesToExistingBookings" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Recommendation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "bookingId" TEXT NOT NULL,
    "candidateObservationId" TEXT,
    "generatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verdict" TEXT NOT NULL,
    "riskLevel" TEXT NOT NULL,
    "qualityLevel" TEXT NOT NULL,
    "estimatedSavings" REAL NOT NULL,
    "currency" TEXT NOT NULL,
    "cashDifference" REAL NOT NULL,
    "pointsValueDifference" REAL NOT NULL,
    "promotionValueDifference" REAL NOT NULL,
    "creditCardValueDifference" REAL NOT NULL,
    "eliteProgressDifference" REAL NOT NULL,
    "benefitValueDifference" REAL NOT NULL,
    "explanation" TEXT NOT NULL,
    "blockersJson" TEXT NOT NULL DEFAULT '[]',
    "warningsJson" TEXT NOT NULL DEFAULT '[]',
    "costBreakdownJson" TEXT NOT NULL,
    "decisionProvider" TEXT NOT NULL,
    "decisionVersion" TEXT NOT NULL,
    CONSTRAINT "Recommendation_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "HotelBooking" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recommendation_candidateObservationId_fkey" FOREIGN KEY ("candidateObservationId") REFERENCES "PriceObservation" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "LoyaltyRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "hotelGroup" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "nightsRequired" INTEGER,
    "pointsRequired" INTEGER,
    "spendRequired" REAL,
    "basePointsPerUsd" REAL NOT NULL,
    "bonusRate" REAL NOT NULL,
    "breakfastBenefit" BOOLEAN NOT NULL DEFAULT false,
    "loungeBenefit" BOOLEAN NOT NULL DEFAULT false,
    "lateCheckoutBenefit" BOOLEAN NOT NULL DEFAULT false,
    "upgradeBenefit" BOOLEAN NOT NULL DEFAULT false,
    "sourceUrl" TEXT NOT NULL,
    "lastReviewedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "CurrencyConversionRate_systemSettingId_sourceCurrency_targetCurrency_key" ON "CurrencyConversionRate"("systemSettingId", "sourceCurrency", "targetCurrency");
CREATE UNIQUE INDEX "LoyaltyAccount_profileId_hotelGroup_key" ON "LoyaltyAccount"("profileId", "hotelGroup");
CREATE UNIQUE INDEX "WatchPlan_bookingId_key" ON "WatchPlan"("bookingId");
CREATE INDEX "BrowserTask_status_expiresAt_idx" ON "BrowserTask"("status", "expiresAt");
CREATE UNIQUE INDEX "PriceCheckRun_browserTaskId_key" ON "PriceCheckRun"("browserTaskId");
CREATE INDEX "PriceCheckRun_bookingId_startedAt_idx" ON "PriceCheckRun"("bookingId", "startedAt");
CREATE INDEX "PriceCheckRun_status_expiresAt_idx" ON "PriceCheckRun"("status", "expiresAt");
CREATE INDEX "PriceObservation_bookingId_observedAt_idx" ON "PriceObservation"("bookingId", "observedAt");
CREATE UNIQUE INDEX "ObservationEvidence_observationId_key" ON "ObservationEvidence"("observationId");
CREATE INDEX "Recommendation_bookingId_generatedAt_idx" ON "Recommendation"("bookingId", "generatedAt");
CREATE UNIQUE INDEX "LoyaltyRule_hotelGroup_tier_key" ON "LoyaltyRule"("hotelGroup", "tier");
