-- KZO-270: source precision lives in typed JSON, independent of legacy six-place ratios.
ALTER TABLE position_actions ADD COLUMN IF NOT EXISTS capital_reduction_detail JSONB;
ALTER TABLE position_actions DROP CONSTRAINT IF EXISTS position_actions_action_type_check;
ALTER TABLE position_actions ADD CONSTRAINT position_actions_action_type_check
  CHECK(action_type IN ('STOCK_DIVIDEND','SPLIT','REVERSE_SPLIT','CASH_CAPITAL_REDUCTION'));
ALTER TABLE position_actions DROP CONSTRAINT IF EXISTS position_actions_check1;
ALTER TABLE position_actions ADD CONSTRAINT position_actions_cash_capital_reduction_shape CHECK (
  (action_type='CASH_CAPITAL_REDUCTION' AND capital_reduction_detail IS NOT NULL)
  OR (action_type='STOCK_DIVIDEND' AND quantity>0)
  OR (action_type IN ('SPLIT','REVERSE_SPLIT') AND ratio_numerator IS NOT NULL AND ratio_denominator IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS capital_reduction_state (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  facts JSONB NOT NULL CHECK(jsonb_typeof(facts)='object')
);
CREATE TABLE IF NOT EXISTS account_capital_reductions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  event_id TEXT NOT NULL,
  current_revision INTEGER NOT NULL CHECK(current_revision>0),
  status TEXT NOT NULL CHECK(status IN ('POSTED','VOIDED')),
  history JSONB NOT NULL,
  UNIQUE(account_id,event_id)
);
CREATE INDEX IF NOT EXISTS idx_account_capital_reductions_owner ON account_capital_reductions(user_id,account_id);

-- PostgreSQL eligibility replay uses the same exact account entitlement and tie rules.
CREATE OR REPLACE FUNCTION capital_reduction_share_allocation(
  quantities NUMERIC[], opening_dates DATE[], opening_sequences NUMERIC[], lot_ids TEXT[], detail JSONB
) RETURNS NUMERIC[] LANGUAGE SQL IMMUTABLE STRICT AS $$
  WITH weights AS (
    SELECT ordinal::int AS ordinal, quantity,
      div(quantity * (detail->'announcement'->>'ratioNumerator')::numeric,
        (detail->'announcement'->>'ratioDenominator')::numeric) AS base_quantity,
      mod(quantity * (detail->'announcement'->>'ratioNumerator')::numeric,
        (detail->'announcement'->>'ratioDenominator')::numeric) AS remainder
    FROM unnest(quantities) WITH ORDINALITY AS input(quantity,ordinal)
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY remainder DESC,
      opening_dates[ordinal], opening_sequences[ordinal], lot_ids[ordinal]) AS remainder_rank,
      div(sum(quantity) OVER () * (detail->'announcement'->>'ratioNumerator')::numeric,
        (detail->'announcement'->>'ratioDenominator')::numeric) - sum(base_quantity) OVER () AS extra
    FROM weights
  ) SELECT coalesce(array_agg(base_quantity + CASE WHEN remainder_rank<=extra THEN 1 ELSE 0 END ORDER BY ordinal), ARRAY[]::numeric[]) FROM ranked
$$;

CREATE TABLE IF NOT EXISTS capital_reduction_announcements (
  event_id TEXT NOT NULL,
  version INTEGER NOT NULL CHECK(version>0),
  ticker TEXT NOT NULL,
  venue TEXT NOT NULL CHECK(venue IN ('TWSE','TPEX')),
  official_reference TEXT NOT NULL,
  terms JSONB NOT NULL,
  PRIMARY KEY(event_id,version)
);
CREATE INDEX IF NOT EXISTS idx_capital_reduction_announcement_identity ON capital_reduction_announcements(ticker,venue,official_reference);

-- Preserve revision prefixes even if a future writer bypasses the application service.
CREATE OR REPLACE FUNCTION guard_capital_reduction_history() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE preserved JSONB;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM accounts WHERE id=NEW.account_id AND user_id=NEW.user_id) THEN
    RAISE EXCEPTION 'capital reduction account owner mismatch';
  END IF;
  IF jsonb_array_length(NEW.history->'revisions')<>NEW.current_revision THEN
    RAISE EXCEPTION 'capital reduction revision count mismatch';
  END IF;
  IF TG_OP='UPDATE' THEN
    IF NEW.id<>OLD.id OR NEW.account_id<>OLD.account_id OR NEW.user_id<>OLD.user_id OR NEW.event_id<>OLD.event_id
      OR NEW.current_revision<OLD.current_revision OR NEW.current_revision>OLD.current_revision+1 THEN
      RAISE EXCEPTION 'capital reduction immutable identity or revision conflict';
    END IF;
    SELECT jsonb_agg(value ORDER BY ordinal) INTO preserved
      FROM jsonb_array_elements(NEW.history->'revisions') WITH ORDINALITY AS entries(value,ordinal)
      WHERE ordinal<=OLD.current_revision;
    IF preserved IS DISTINCT FROM OLD.history->'revisions' THEN
      RAISE EXCEPTION 'capital reduction prior revisions are immutable';
    END IF;
    IF NEW.current_revision=OLD.current_revision AND NEW.status<>OLD.status THEN
      RAISE EXCEPTION 'capital reduction status change requires a confirmed revision';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capital_reduction_history_guard ON account_capital_reductions;
CREATE TRIGGER capital_reduction_history_guard BEFORE INSERT OR UPDATE ON account_capital_reductions
  FOR EACH ROW EXECUTE FUNCTION guard_capital_reduction_history();
CREATE OR REPLACE FUNCTION guard_capital_reduction_announcement_version() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'capital reduction announcement versions are immutable'; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS capital_reduction_announcement_guard ON capital_reduction_announcements;
CREATE TRIGGER capital_reduction_announcement_guard BEFORE UPDATE ON capital_reduction_announcements
  FOR EACH ROW EXECUTE FUNCTION guard_capital_reduction_announcement_version();

-- Capital repayments and fractional settlements are owned-asset movements, never manual contributions.
ALTER TABLE cash_ledger_entries DROP CONSTRAINT IF EXISTS ck_cash_ledger_entries_entry_type_amount_direction;
ALTER TABLE cash_ledger_entries ADD CONSTRAINT ck_cash_ledger_entries_entry_type_amount_direction CHECK (
  (entry_type IN ('TRADE_SETTLEMENT_IN','DIVIDEND_RECEIPT','FX_TRANSFER_IN','CAPITAL_REPAYMENT_RECEIPT','CAPITAL_FRACTION_RECEIPT') AND amount>0)
  OR (entry_type IN ('TRADE_SETTLEMENT_OUT','DIVIDEND_DEDUCTION','FX_TRANSFER_OUT','CAPITAL_REDUCTION_FEE_PAYMENT') AND amount<0)
  OR entry_type IN ('MANUAL_ADJUSTMENT','REVERSAL')
);
ALTER TABLE cash_ledger_entries DROP CONSTRAINT IF EXISTS ck_cash_ledger_entries_entry_type_links;
ALTER TABLE cash_ledger_entries ADD CONSTRAINT ck_cash_ledger_entries_entry_type_links CHECK (
  (entry_type IN ('TRADE_SETTLEMENT_IN','TRADE_SETTLEMENT_OUT') AND related_trade_event_id IS NOT NULL AND related_dividend_ledger_entry_id IS NULL)
  OR (entry_type IN ('DIVIDEND_RECEIPT','DIVIDEND_DEDUCTION') AND related_trade_event_id IS NULL AND related_dividend_ledger_entry_id IS NOT NULL)
  OR (entry_type IN ('MANUAL_ADJUSTMENT','REVERSAL','FX_TRANSFER_OUT','FX_TRANSFER_IN') AND related_trade_event_id IS NULL AND related_dividend_ledger_entry_id IS NULL)
  OR (entry_type IN ('CAPITAL_REPAYMENT_RECEIPT','CAPITAL_FRACTION_RECEIPT','CAPITAL_REDUCTION_FEE_PAYMENT') AND related_trade_event_id IS NULL AND related_dividend_ledger_entry_id IS NULL AND source_reference IS NOT NULL)
);
ALTER TABLE cash_ledger_entries DROP CONSTRAINT IF EXISTS cash_ledger_entries_entry_type_check;
ALTER TABLE cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_entry_type_check CHECK (
  entry_type IN ('TRADE_SETTLEMENT_IN','TRADE_SETTLEMENT_OUT','DIVIDEND_RECEIPT','DIVIDEND_DEDUCTION','MANUAL_ADJUSTMENT','REVERSAL','FX_TRANSFER_OUT','FX_TRANSFER_IN','CAPITAL_REPAYMENT_RECEIPT','CAPITAL_FRACTION_RECEIPT','CAPITAL_REDUCTION_FEE_PAYMENT')
);

-- Each effect retains the existing component-source dedupe while an explicit scoped link owns the group.
ALTER TABLE cash_ledger_entries ADD COLUMN IF NOT EXISTS related_capital_reduction_id TEXT;
ALTER TABLE account_capital_reductions ADD CONSTRAINT account_capital_reductions_owner_account_id_unique UNIQUE(user_id,account_id,id);
ALTER TABLE cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_capital_reduction_owner_fk
  FOREIGN KEY(user_id,account_id,related_capital_reduction_id)
  REFERENCES account_capital_reductions(user_id,account_id,id)
  DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE cash_ledger_entries DROP CONSTRAINT IF EXISTS ck_cash_ledger_entries_entry_type_links;
ALTER TABLE cash_ledger_entries ADD CONSTRAINT ck_cash_ledger_entries_entry_type_links CHECK (
  (entry_type IN ('TRADE_SETTLEMENT_IN','TRADE_SETTLEMENT_OUT') AND related_trade_event_id IS NOT NULL AND related_dividend_ledger_entry_id IS NULL AND related_capital_reduction_id IS NULL)
  OR (entry_type IN ('DIVIDEND_RECEIPT','DIVIDEND_DEDUCTION') AND related_trade_event_id IS NULL AND related_dividend_ledger_entry_id IS NOT NULL AND related_capital_reduction_id IS NULL)
  OR (entry_type IN ('MANUAL_ADJUSTMENT','REVERSAL','FX_TRANSFER_OUT','FX_TRANSFER_IN') AND related_trade_event_id IS NULL AND related_dividend_ledger_entry_id IS NULL AND related_capital_reduction_id IS NULL)
  OR (entry_type IN ('CAPITAL_REPAYMENT_RECEIPT','CAPITAL_FRACTION_RECEIPT','CAPITAL_REDUCTION_FEE_PAYMENT') AND related_trade_event_id IS NULL AND related_dividend_ledger_entry_id IS NULL AND related_capital_reduction_id IS NOT NULL AND source_reference IS NOT NULL)
);
