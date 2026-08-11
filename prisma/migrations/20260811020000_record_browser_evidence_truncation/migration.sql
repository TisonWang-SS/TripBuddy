ALTER TABLE "BrowserTask" ADD COLUMN "snapshotsTruncated" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PriceCheckRun" ADD COLUMN "candidatesTruncated" BOOLEAN NOT NULL DEFAULT false;
