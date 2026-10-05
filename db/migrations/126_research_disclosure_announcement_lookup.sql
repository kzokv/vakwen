-- Target new disclosure lookup seams; preserve immutable evidence tables.
CREATE INDEX IF NOT EXISTS research_announcements_listing_window_idx
  ON research.announcements (issuer_id, (record->>'listingId'), (record->>'venue'), published_at, id);
CREATE INDEX IF NOT EXISTS research_announcements_collection_idx
  ON research.announcements (issuer_id, (record->>'listingId'), (record->>'venue'), (record->>'collectionRecordId'));
CREATE INDEX IF NOT EXISTS research_announcements_detail_success_idx
  ON research.announcements (issuer_id, (record->>'listingId'), (record->>'venue'), (record->>'collectionRecordId'), processed_at DESC, id DESC)
  WHERE record->'detailQuality'->>'status' = 'available';
CREATE INDEX IF NOT EXISTS research_announcements_attachment_idx
  ON research.announcements USING GIN ((record->'attachments') jsonb_path_ops);
CREATE INDEX IF NOT EXISTS research_announcements_lineage_idx
  ON research.announcements USING GIN ((record->'relations') jsonb_path_ops);
