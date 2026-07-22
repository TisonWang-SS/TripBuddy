CREATE TABLE IF NOT EXISTS WatchPlan (
  id TEXT PRIMARY KEY NOT NULL,
  bookingId TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  cashEnabled BOOLEAN NOT NULL DEFAULT true,
  awardEnabled BOOLEAN NOT NULL DEFAULT true,
  directEnabled BOOLEAN NOT NULL DEFAULT true,
  otaReferenceEnabled BOOLEAN NOT NULL DEFAULT false,
  browserMode TEXT NOT NULL DEFAULT 'headless',
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

ALTER TABLE PriceObservation ADD COLUMN priceCheckRunId TEXT;
ALTER TABLE PriceObservation ADD COLUMN collectedBy TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE PriceObservation ADD COLUMN collectorName TEXT;
ALTER TABLE PriceObservation ADD COLUMN inventoryType TEXT NOT NULL DEFAULT 'cash';
ALTER TABLE PriceObservation ADD COLUMN basePrice REAL;
ALTER TABLE PriceObservation ADD COLUMN taxAmount REAL;
ALTER TABLE PriceObservation ADD COLUMN feeAmount REAL;
ALTER TABLE PriceObservation ADD COLUMN totalPrice REAL;
ALTER TABLE PriceObservation ADD COLUMN pointsPrice INTEGER;
ALTER TABLE PriceObservation ADD COLUMN cashCopay REAL;
ALTER TABLE PriceObservation ADD COLUMN rawRateName TEXT;
ALTER TABLE PriceObservation ADD COLUMN ratePlanName TEXT;
