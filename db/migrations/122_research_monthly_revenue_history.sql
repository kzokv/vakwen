CREATE TABLE IF NOT EXISTS research.monthly_revenue_records (
  record_key TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('TWSE', 'TPEX')),
  revenue_month TEXT NOT NULL,
  published_at DATE NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (revenue_month ~ '^\d{4}-\d{2}$')
);

CREATE INDEX IF NOT EXISTS monthly_revenue_records_listing_temporal_idx
  ON research.monthly_revenue_records (listing_id, published_at, retrieved_at, revenue_month);

CREATE INDEX IF NOT EXISTS monthly_revenue_records_ticker_venue_temporal_idx
  ON research.monthly_revenue_records (ticker, venue, published_at, retrieved_at, revenue_month);

CREATE INDEX IF NOT EXISTS monthly_revenue_records_listing_latest_month_idx
  ON research.monthly_revenue_records (listing_id, revenue_month, published_at DESC, retrieved_at DESC, record_key DESC);

COMMENT ON TABLE research.monthly_revenue_records IS
  'Immutable canonical Taiwan monthly revenue revisions with publication-date and knowledge-time cutoffs.';

COMMENT ON INDEX research.monthly_revenue_records_listing_temporal_idx IS
  'Supports listing-scoped monthly revenue reads bounded by local publication date and knowledge time.';

COMMENT ON INDEX research.monthly_revenue_records_ticker_venue_temporal_idx IS
  'Supports ticker plus venue monthly revenue reads with the same temporal cutoffs as listing queries.';

COMMENT ON INDEX research.monthly_revenue_records_listing_latest_month_idx IS
  'Supports latest-per-month listing reads while preserving immutable monthly revenue revision history.';
