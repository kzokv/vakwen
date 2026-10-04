CREATE TABLE IF NOT EXISTS research.announcements (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  CHECK (record->>'id' = id AND record->>'issuerId' = issuer_id)
);
CREATE INDEX IF NOT EXISTS research_announcements_issuer_temporal_idx ON research.announcements (issuer_id, published_at, retrieved_at, processed_at);

CREATE TABLE IF NOT EXISTS research.disclosure_artifacts (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  CHECK (record->>'id' = id AND record->>'issuerId' = issuer_id)
);
CREATE INDEX IF NOT EXISTS research_disclosure_artifacts_issuer_temporal_idx ON research.disclosure_artifacts (issuer_id, published_at, retrieved_at, processed_at);

CREATE TABLE IF NOT EXISTS research.disclosure_scans (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  CHECK (record->>'id' = id AND record->>'issuerId' = issuer_id)
);
CREATE INDEX IF NOT EXISTS research_disclosure_scans_issuer_temporal_idx ON research.disclosure_scans (issuer_id, published_at, retrieved_at, processed_at);

CREATE TABLE IF NOT EXISTS research.disclosure_material_references (
  id TEXT PRIMARY KEY,
  issuer_id TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  retrieved_at TIMESTAMPTZ NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL,
  record JSONB NOT NULL CHECK (jsonb_typeof(record) = 'object'),
  CHECK (record->>'id' = id AND record->>'issuerId' = issuer_id)
);
CREATE INDEX IF NOT EXISTS research_disclosure_material_references_issuer_temporal_idx ON research.disclosure_material_references (issuer_id, published_at, retrieved_at, processed_at);
