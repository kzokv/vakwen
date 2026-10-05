-- Unknown-target notices remain metadata limitations, never invented lineage.
CREATE INDEX IF NOT EXISTS research_announcements_unknown_targets_idx
  ON research.announcements (issuer_id, (record->>'listingId'), (record->>'venue'), published_at)
  WHERE jsonb_array_length(COALESCE(record->'unknownRelationTargets', '[]'::jsonb)) > 0;
