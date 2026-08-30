CREATE INDEX IF NOT EXISTS research_price_records_listing_page_idx
  ON research.price_records (
    listing_id,
    session_date DESC,
    retrieved_at DESC,
    record_key DESC
  );
