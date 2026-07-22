CREATE TABLE IF NOT EXISTS SystemSetting (
  id TEXT PRIMARY KEY NOT NULL DEFAULT 'primary',
  displayCurrency TEXT NOT NULL DEFAULT 'USD',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS CurrencyConversionRate (
  id TEXT PRIMARY KEY NOT NULL,
  systemSettingId TEXT NOT NULL DEFAULT 'primary',
  sourceCurrency TEXT NOT NULL,
  targetCurrency TEXT NOT NULL,
  rate REAL NOT NULL,
  sourceName TEXT,
  asOf DATETIME NOT NULL,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (systemSettingId) REFERENCES SystemSetting(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS CurrencyConversionRate_systemSettingId_sourceCurrency_targetCurrency_key
  ON CurrencyConversionRate(systemSettingId, sourceCurrency, targetCurrency);

CREATE TABLE IF NOT EXISTS UserProfile (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL DEFAULT 'Primary Traveler',
  defaultCurrency TEXT NOT NULL DEFAULT 'USD',
  savingsThreshold REAL NOT NULL DEFAULT 50,
  urgentWindowHours INTEGER NOT NULL DEFAULT 24,
  breakfastValue REAL NOT NULL DEFAULT 25,
  loungeValue REAL NOT NULL DEFAULT 35,
  lateCheckoutValue REAL NOT NULL DEFAULT 15,
  upgradeValue REAL NOT NULL DEFAULT 40,
  eliteNightValue REAL NOT NULL DEFAULT 10,
  chromeProfileName TEXT NOT NULL DEFAULT 'TripBuddy',
  chromeProfileDirectory TEXT,
  chromeUserDataDir TEXT,
  chromeDebugPort INTEGER NOT NULL DEFAULT 0,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS LoyaltyAccount (
  id TEXT PRIMARY KEY NOT NULL,
  profileId TEXT NOT NULL,
  hotelGroup TEXT NOT NULL,
  tier TEXT NOT NULL,
  currentNights INTEGER NOT NULL DEFAULT 0,
  currentPoints INTEGER NOT NULL DEFAULT 0,
  currentSpend REAL NOT NULL DEFAULT 0,
  targetTier TEXT,
  pointValue REAL NOT NULL DEFAULT 0.005,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profileId) REFERENCES UserProfile(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS LoyaltyAccount_profileId_hotelGroup_key ON LoyaltyAccount(profileId, hotelGroup);

CREATE TABLE IF NOT EXISTS CreditCardBenefit (
  id TEXT PRIMARY KEY NOT NULL,
  profileId TEXT NOT NULL,
  name TEXT NOT NULL,
  hotelGroup TEXT,
  cashBackRate REAL NOT NULL DEFAULT 0,
  pointMultiplier REAL NOT NULL DEFAULT 0,
  eliteNightCredits INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (profileId) REFERENCES UserProfile(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS HotelBooking (
  id TEXT PRIMARY KEY NOT NULL,
  hotelGroup TEXT NOT NULL,
  hotelName TEXT NOT NULL,
  city TEXT NOT NULL,
  checkIn DATETIME NOT NULL,
  checkOut DATETIME NOT NULL,
  guests INTEGER NOT NULL DEFAULT 1,
  roomType TEXT NOT NULL,
  isSuite BOOLEAN NOT NULL DEFAULT false,
  originalPrice REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  bookingChannel TEXT NOT NULL,
  cancellationDeadline DATETIME,
  breakfastIncluded BOOLEAN NOT NULL DEFAULT false,
  loyaltyEligible BOOLEAN NOT NULL DEFAULT true,
  bookingUrl TEXT,
  notes TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS WatchPlan (
  id TEXT PRIMARY KEY NOT NULL,
  bookingId TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cashEnabled BOOLEAN NOT NULL DEFAULT true,
  awardEnabled BOOLEAN NOT NULL DEFAULT true,
  directEnabled BOOLEAN NOT NULL DEFAULT true,
  otaReferenceEnabled BOOLEAN NOT NULL DEFAULT false,
  browserMode TEXT NOT NULL DEFAULT 'chrome_profile',
  normalCadenceHours INTEGER NOT NULL DEFAULT 24,
  urgentCadenceHours INTEGER NOT NULL DEFAULT 6,
  urgentWindowHours INTEGER NOT NULL DEFAULT 72,
  lastCheckedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bookingId) REFERENCES HotelBooking(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS WatchPlan_bookingId_key ON WatchPlan(bookingId);

CREATE TABLE IF NOT EXISTS PriceCheckRun (
  id TEXT PRIMARY KEY NOT NULL,
  bookingId TEXT NOT NULL,
  watchPlanId TEXT,
  startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finishedAt DATETIME,
  status TEXT NOT NULL,
  trigger TEXT NOT NULL,
  inventoryTypesJson TEXT NOT NULL,
  collectorName TEXT NOT NULL,
  sourceUrl TEXT,
  summary TEXT,
  errorMessage TEXT,
  FOREIGN KEY (bookingId) REFERENCES HotelBooking(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (watchPlanId) REFERENCES WatchPlan(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS PriceObservation (
  id TEXT PRIMARY KEY NOT NULL,
  bookingId TEXT NOT NULL,
  priceCheckRunId TEXT,
  observedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sourceName TEXT NOT NULL,
  sourceType TEXT NOT NULL,
  collectedBy TEXT NOT NULL DEFAULT 'manual',
  collectorName TEXT,
  inventoryType TEXT NOT NULL DEFAULT 'cash',
  price REAL NOT NULL,
  basePrice REAL,
  taxAmount REAL,
  feeAmount REAL,
  totalPrice REAL,
  pointsPrice INTEGER,
  cashCopay REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  observedCurrency TEXT,
  observedPrice REAL,
  conversionRate REAL,
  rawRateName TEXT,
  ratePlanName TEXT,
  roomTypeRaw TEXT NOT NULL,
  isSuite BOOLEAN NOT NULL DEFAULT false,
  roomMatch TEXT NOT NULL,
  cancellationPolicyRaw TEXT NOT NULL,
  cancellationMatch TEXT NOT NULL,
  breakfastIncluded BOOLEAN NOT NULL DEFAULT false,
  taxesIncluded BOOLEAN NOT NULL DEFAULT true,
  loyaltyEligible BOOLEAN NOT NULL DEFAULT false,
  sourceUrl TEXT,
  confidence REAL NOT NULL DEFAULT 0.7,
  notes TEXT,
  FOREIGN KEY (bookingId) REFERENCES HotelBooking(id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (priceCheckRunId) REFERENCES PriceCheckRun(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS Promotion (
  id TEXT PRIMARY KEY NOT NULL,
  hotelGroup TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  startDate DATETIME,
  endDate DATETIME,
  bonusMultiplier REAL NOT NULL DEFAULT 0,
  flatValue REAL NOT NULL DEFAULT 0,
  requiresRegistration BOOLEAN NOT NULL DEFAULT false,
  appliesToExistingBookings BOOLEAN NOT NULL DEFAULT false,
  sourceUrl TEXT,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS Recommendation (
  id TEXT PRIMARY KEY NOT NULL,
  bookingId TEXT NOT NULL,
  candidateObservationId TEXT,
  generatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  verdict TEXT NOT NULL,
  estimatedSavings REAL NOT NULL,
  confidence REAL NOT NULL,
  cashDifference REAL NOT NULL,
  pointsValueDifference REAL NOT NULL,
  promotionValueDifference REAL NOT NULL,
  creditCardValueDifference REAL NOT NULL,
  eliteProgressDifference REAL NOT NULL,
  benefitValueDifference REAL NOT NULL,
  explanation TEXT NOT NULL,
  FOREIGN KEY (bookingId) REFERENCES HotelBooking(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS LoyaltyRule (
  id TEXT PRIMARY KEY NOT NULL,
  hotelGroup TEXT NOT NULL,
  tier TEXT NOT NULL,
  nightsRequired INTEGER,
  pointsRequired INTEGER,
  spendRequired REAL,
  basePointsPerUsd REAL NOT NULL,
  bonusRate REAL NOT NULL,
  breakfastBenefit BOOLEAN NOT NULL DEFAULT false,
  loungeBenefit BOOLEAN NOT NULL DEFAULT false,
  lateCheckoutBenefit BOOLEAN NOT NULL DEFAULT false,
  upgradeBenefit BOOLEAN NOT NULL DEFAULT false,
  sourceUrl TEXT NOT NULL,
  lastReviewedAt DATETIME NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS LoyaltyRule_hotelGroup_tier_key ON LoyaltyRule(hotelGroup, tier);
