CREATE INDEX IF NOT EXISTS research_identity_records_listing_history_page_idx
  ON research.identity_records (
    listing_id,
    effective_at ASC,
    retrieved_at ASC,
    revision_precedence ASC,
    record_key ASC
  );

COMMENT ON INDEX research.research_identity_records_listing_history_page_idx IS
  'Supports keyset-limited chronological identity history pages for one immutable listing.';

CREATE INDEX IF NOT EXISTS research_identity_records_listing_latest_revision_idx
  ON research.identity_records (
    listing_id,
    revision_precedence DESC,
    effective_at DESC,
    retrieved_at DESC,
    record_key DESC
  );

COMMENT ON INDEX research.research_identity_records_listing_latest_revision_idx IS
  'Supports bounded latest identity and terminal-status revision reads for request-time resolution.';
