ALTER TABLE users
  ADD COLUMN IF NOT EXISTS portfolio_initialized BOOLEAN NOT NULL DEFAULT false;

-- Existing users have already crossed the one-time bootstrap boundary, even
-- when they currently have no accounts because they intentionally removed
-- them. Marking them initialized prevents a later read from recreating Main.
UPDATE users
SET portfolio_initialized = true
WHERE portfolio_initialized = false;
