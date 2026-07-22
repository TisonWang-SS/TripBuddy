CREATE TABLE IF NOT EXISTS SystemSetting (
  id TEXT PRIMARY KEY NOT NULL DEFAULT 'primary',
  displayCurrency TEXT NOT NULL DEFAULT 'USD',
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updatedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO SystemSetting (id, displayCurrency, createdAt, updatedAt)
VALUES ('primary', 'USD', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

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

ALTER TABLE HotelBooking ADD COLUMN isSuite BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE PriceObservation ADD COLUMN observedCurrency TEXT;
ALTER TABLE PriceObservation ADD COLUMN observedPrice REAL;
ALTER TABLE PriceObservation ADD COLUMN conversionRate REAL;
ALTER TABLE PriceObservation ADD COLUMN isSuite BOOLEAN NOT NULL DEFAULT false;

UPDATE SystemSetting SET displayCurrency = 'CNY' WHERE displayCurrency = 'RMB';
UPDATE UserProfile SET defaultCurrency = 'CNY' WHERE defaultCurrency = 'RMB';
UPDATE UserProfile SET defaultCurrency = 'USD' WHERE defaultCurrency NOT IN ('USD', 'CNY');

DELETE FROM Recommendation;
DELETE FROM PriceObservation;
DELETE FROM PriceCheckRun;
DELETE FROM WatchPlan;
DELETE FROM HotelBooking;
DELETE FROM Promotion;
DELETE FROM CurrencyConversionRate;
