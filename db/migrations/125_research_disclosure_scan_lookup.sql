-- Support bounded latest-attempt/success reads without transferring scan history.
CREATE INDEX IF NOT EXISTS research_disclosure_scans_listing_latest_idx
  ON research.disclosure_scans (issuer_id, (record->>'listingId'), (record->>'venue'), published_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS research_disclosure_scans_listing_success_idx
  ON research.disclosure_scans (issuer_id, (record->>'listingId'), (record->>'venue'), published_at DESC, id DESC)
  WHERE record->>'status' = 'success';
CREATE INDEX IF NOT EXISTS research_disclosure_scans_artifact_attempt_idx
  ON research.disclosure_scans USING GIN ((record->'artifactAttempts') jsonb_path_ops);
