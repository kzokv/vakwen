DO $$
DECLARE
  marker_already_exists BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'portfolio_initialized'
  )
  INTO marker_already_exists;

  ALTER TABLE users
    ADD COLUMN IF NOT EXISTS portfolio_initialized BOOLEAN NOT NULL DEFAULT false;

  -- Existing users have already crossed the one-time bootstrap boundary, even
  -- when they currently have no accounts because they intentionally removed
  -- them. Only the first application may mark this pre-migration population;
  -- a rerun must preserve new users still awaiting their one-time bootstrap.
  IF NOT marker_already_exists THEN
    UPDATE users
    SET portfolio_initialized = true
    WHERE portfolio_initialized = false;
  END IF;
END
$$;

-- Before configured-currency controls existed, a stored reporting currency
-- could outlive every matching account, while lazy preference creation left
-- some account owners with an implicit TWD default. Include both populations:
-- preserve valid preferences, otherwise fall back in canonical capability
-- order; empty portfolios have no effective reporting currency and therefore
-- drop the key.
WITH candidate_users AS (
  SELECT user_id
  FROM user_preferences
  UNION
  SELECT DISTINCT user_id
  FROM accounts
  WHERE deleted_at IS NULL
),
normalized_preferences AS (
  SELECT
    candidate.user_id,
    COALESCE(up.preferences, '{}'::jsonb) AS preferences,
    CASE
      WHEN EXISTS (
        SELECT 1
        FROM accounts a
        WHERE a.user_id = candidate.user_id
          AND a.deleted_at IS NULL
          AND a.default_currency = up.preferences->>'reportingCurrency'
      ) THEN up.preferences->>'reportingCurrency'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = candidate.user_id AND a.deleted_at IS NULL AND a.default_currency = 'TWD'
      ) THEN 'TWD'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = candidate.user_id AND a.deleted_at IS NULL AND a.default_currency = 'USD'
      ) THEN 'USD'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = candidate.user_id AND a.deleted_at IS NULL AND a.default_currency = 'AUD'
      ) THEN 'AUD'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = candidate.user_id AND a.deleted_at IS NULL AND a.default_currency = 'KRW'
      ) THEN 'KRW'
      WHEN EXISTS (
        SELECT 1 FROM accounts a
        WHERE a.user_id = candidate.user_id AND a.deleted_at IS NULL AND a.default_currency = 'JPY'
      ) THEN 'JPY'
      ELSE NULL
    END AS reporting_currency
  FROM candidate_users candidate
  LEFT JOIN user_preferences up ON up.user_id = candidate.user_id
)
INSERT INTO user_preferences (user_id, preferences)
SELECT
  normalized.user_id,
  CASE
      WHEN normalized.reporting_currency IS NULL
        THEN normalized.preferences - 'reportingCurrency'
      ELSE jsonb_set(
        normalized.preferences,
        '{reportingCurrency}',
        to_jsonb(normalized.reporting_currency),
        true
      )
  END
FROM normalized_preferences normalized
ON CONFLICT (user_id) DO UPDATE
SET preferences = EXCLUDED.preferences,
    updated_at = NOW();
