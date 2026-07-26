ALTER TABLE users
  ADD COLUMN IF NOT EXISTS portfolio_initialized BOOLEAN NOT NULL DEFAULT false;

-- Before configured-currency controls existed, a stored reporting currency
-- could outlive every matching account. Preserve valid preferences, otherwise
-- fall back in canonical capability order; empty portfolios have no effective
-- reporting currency and therefore drop the key.
WITH normalized_preferences AS (
  SELECT
    up.user_id,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM accounts a
        WHERE a.user_id = up.user_id
          AND a.deleted_at IS NULL
          AND a.default_currency = up.preferences->>'reportingCurrency'
      ) THEN up.preferences->>'reportingCurrency'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = up.user_id AND a.deleted_at IS NULL AND a.default_currency = 'TWD'
      ) THEN 'TWD'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = up.user_id AND a.deleted_at IS NULL AND a.default_currency = 'USD'
      ) THEN 'USD'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = up.user_id AND a.deleted_at IS NULL AND a.default_currency = 'AUD'
      ) THEN 'AUD'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = up.user_id AND a.deleted_at IS NULL AND a.default_currency = 'KRW'
      ) THEN 'KRW'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = up.user_id AND a.deleted_at IS NULL AND a.default_currency = 'JPY'
      ) THEN 'JPY'
      ELSE NULL
    END AS reporting_currency
  FROM user_preferences up
  WHERE up.preferences ? 'reportingCurrency'
)
UPDATE user_preferences up
SET preferences = CASE
      WHEN normalized.reporting_currency IS NULL
        THEN up.preferences - 'reportingCurrency'
      ELSE jsonb_set(
        up.preferences,
        '{reportingCurrency}',
        to_jsonb(normalized.reporting_currency),
        true
      )
    END,
    updated_at = NOW()
FROM normalized_preferences normalized
WHERE normalized.user_id = up.user_id;

-- Existing users have already crossed the one-time bootstrap boundary, even
-- when they currently have no accounts because they intentionally removed
-- them. Marking them initialized prevents a later read from recreating Main.
UPDATE users
SET portfolio_initialized = true
WHERE portfolio_initialized = false;
