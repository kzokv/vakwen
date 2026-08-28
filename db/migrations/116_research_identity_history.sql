CREATE SCHEMA IF NOT EXISTS research;

CREATE TABLE IF NOT EXISTS research.identity_records (
  record_key TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  security_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('TWSE', 'TPEX')),
  effective_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS research_identity_records_listing_temporal_idx
  ON research.identity_records (listing_id, effective_at, retrieved_at);

CREATE INDEX IF NOT EXISTS research_identity_records_ticker_venue_temporal_idx
  ON research.identity_records (ticker, venue, effective_at, retrieved_at);

CREATE INDEX IF NOT EXISTS research_identity_records_security_temporal_idx
  ON research.identity_records (security_id, effective_at, retrieved_at);

COMMENT ON TABLE research.identity_records IS
  'Immutable canonical Taiwan identity revisions with effective-time and knowledge-time cutoffs.';
