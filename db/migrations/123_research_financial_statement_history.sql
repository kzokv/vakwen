CREATE TABLE IF NOT EXISTS research.financial_statement_records (
  record_key TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  issuer_id TEXT NOT NULL,
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL CHECK (venue IN ('TWSE', 'TPEX')),
  periodicity TEXT NOT NULL CHECK (periodicity IN ('annual', 'quarterly')),
  period_key TEXT NOT NULL,
  period_end DATE NOT NULL,
  filing_basis TEXT NOT NULL CHECK (filing_basis IN ('consolidated', 'individual', 'unknown')),
  filing_published_at TIMESTAMPTZ NOT NULL,
  filing_sequence INTEGER NOT NULL CHECK (filing_sequence >= 0),
  revision_published_at TIMESTAMPTZ NULL,
  revision_sequence INTEGER NOT NULL CHECK (revision_sequence >= 0),
  processing_id TEXT NOT NULL,
  processing_sequence INTEGER NOT NULL CHECK (processing_sequence >= 0),
  retrieved_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (periodicity = 'annual' AND period_key ~ '^\d{4}$')
    OR (periodicity = 'quarterly' AND period_key ~ '^\d{4}-Q[1-4]$')
  )
);

CREATE INDEX IF NOT EXISTS research_financial_statement_records_listing_temporal_idx
  ON research.financial_statement_records (
    listing_id,
    periodicity,
    filing_basis,
    period_key,
    filing_published_at,
    filing_sequence,
    revision_sequence,
    processing_sequence,
    record_key
  );

CREATE INDEX IF NOT EXISTS research_financial_statement_records_issuer_temporal_idx
  ON research.financial_statement_records (
    issuer_id,
    periodicity,
    filing_basis,
    period_key,
    filing_published_at,
    filing_sequence,
    revision_sequence,
    processing_sequence,
    record_key
  );

CREATE INDEX IF NOT EXISTS research_financial_statement_records_listing_latest_idx
  ON research.financial_statement_records (
    listing_id,
    periodicity,
    filing_basis,
    period_key,
    filing_published_at DESC,
    filing_sequence DESC,
    revision_published_at DESC,
    revision_sequence DESC,
    processing_sequence DESC,
    record_key DESC
  );

CREATE INDEX IF NOT EXISTS research_financial_statement_records_issuer_latest_idx
  ON research.financial_statement_records (
    issuer_id,
    periodicity,
    filing_basis,
    period_key,
    filing_published_at DESC,
    filing_sequence DESC,
    revision_published_at DESC,
    revision_sequence DESC,
    processing_sequence DESC,
    record_key DESC
  );

COMMENT ON TABLE research.financial_statement_records IS
  'Immutable canonical MOPS XBRL financial statement revisions with effective-time, knowledge-time, and explicit filing/revision/processing precedence.';
