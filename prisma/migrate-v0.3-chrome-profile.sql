ALTER TABLE UserProfile ADD COLUMN chromeProfileName TEXT NOT NULL DEFAULT 'TripBuddy';
ALTER TABLE UserProfile ADD COLUMN chromeProfileDirectory TEXT;
ALTER TABLE UserProfile ADD COLUMN chromeUserDataDir TEXT;
ALTER TABLE UserProfile ADD COLUMN chromeDebugPort INTEGER NOT NULL DEFAULT 0;
