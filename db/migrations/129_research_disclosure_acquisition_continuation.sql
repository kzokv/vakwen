-- Bounded board-level durable rotation lookup; never transfer announcement or scan history.
CREATE INDEX IF NOT EXISTS research_disclosure_scans_board_continuation_idx
  ON research.disclosure_scans ((record->>'venue'), processed_at DESC, id DESC)
  WHERE record ? 'acquisitionContinuation';
