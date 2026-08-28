ALTER TABLE research.identity_records
  ADD COLUMN IF NOT EXISTS revision_precedence SMALLINT NOT NULL DEFAULT 0
  CHECK (revision_precedence >= 0);

UPDATE research.identity_records
SET revision_precedence = 1
WHERE EXISTS (
  SELECT 1
  FROM jsonb_array_elements(record -> 'observations') AS observation
  WHERE observation ->> 'field' = 'listing_status'
)
AND jsonb_array_length(record -> 'observations') = 1;

COMMENT ON COLUMN research.identity_records.revision_precedence IS
  'Terminal lifecycle priority; effective explicit status-only revisions sort after full snapshots.';
