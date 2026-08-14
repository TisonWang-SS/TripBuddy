-- A cash total proves it covers the stay by reaching a final summary with
-- taxes and fees. A points figure has no such gate: the same "N points" text
-- appears on a room list as a nightly rate and on an award summary as a stay
-- total. Existing rows cannot be told apart after the fact, so every one of
-- them is `unknown`, and anything that divides by points refuses rather than
-- guessing which it was.
ALTER TABLE "PriceObservation" ADD COLUMN "pointsBasis" TEXT NOT NULL DEFAULT 'unknown';
