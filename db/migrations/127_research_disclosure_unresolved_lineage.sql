-- Exact ambiguous target membership remains separate from resolved relations.
CREATE INDEX IF NOT EXISTS research_announcements_unresolved_lineage_idx
  ON research.announcements USING GIN ((record->'unresolvedRelations') jsonb_path_ops);
