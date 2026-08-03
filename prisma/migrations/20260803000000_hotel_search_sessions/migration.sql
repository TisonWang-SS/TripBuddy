-- CreateTable
CREATE TABLE "HotelSearchSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "profileId" TEXT NOT NULL DEFAULT 'primary',
    "queryJson" TEXT NOT NULL,
    "resultsJson" TEXT NOT NULL DEFAULT '{"hotels":[]}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    CONSTRAINT "HotelSearchSession_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "UserProfile" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "HotelSearchSession_profileId_createdAt_idx" ON "HotelSearchSession"("profileId", "createdAt");

-- CreateIndex
CREATE INDEX "HotelSearchSession_expiresAt_idx" ON "HotelSearchSession"("expiresAt");
