CREATE TABLE IF NOT EXISTS research.price_records (
  record_key TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('TWSE', 'TPEX')),
  session_date DATE NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('full_bar', 'close_only', 'no_trade', 'suspended')),
  retrieved_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS research_price_records_listing_session_idx
  ON research.price_records (listing_id, session_date ASC, retrieved_at DESC, record_key DESC);

CREATE INDEX IF NOT EXISTS research_price_records_venue_session_idx
  ON research.price_records (venue, session_date ASC, retrieved_at DESC, record_key DESC);

COMMENT ON TABLE research.price_records IS
  'Immutable canonical Taiwan authoritative price-session records with venue-scoped session dates and knowledge-time retention.';
