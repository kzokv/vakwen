CREATE INDEX IF NOT EXISTS research_identity_records_venue_latest_listing_idx
  ON research.identity_records (
    venue,
    listing_id,
    revision_precedence DESC,
    effective_at DESC,
    retrieved_at DESC,
    record_key DESC
  );

COMMENT ON INDEX research.research_identity_records_venue_latest_listing_idx IS
  'Supports bounded latest-per-listing acquisition reads without materializing immutable revision history.';
