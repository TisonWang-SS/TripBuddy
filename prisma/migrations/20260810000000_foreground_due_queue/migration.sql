-- Existing scheduled runs were still user-visible Browser Companion checks.
-- Preserve them while renaming the trigger to the foreground execution model.
UPDATE "PriceCheckRun" SET "trigger" = 'due_queue' WHERE "trigger" = 'scheduled';
