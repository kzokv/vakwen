import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host or " +
      "npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

async function resetDatabase(): Promise<void> {
  const resetPool = new Pool({ connectionString: databaseUrl });
  const client = await resetPool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    client.release();
    await resetPool.end();
  }
}

describePostgres("PostgresPersistence replay artifact cleanup", () => {
  let persistence: PostgresPersistence;
  let pool: Pool;
  let userId: string;
  let accountId: string;
  let feeProfileId: string;

  beforeEach(async () => {
    await resetDatabase();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    const store = await persistence.loadStore("user-1");
    userId = store.userId;
    accountId = store.accounts[0]!.id;
    feeProfileId = store.feeProfiles[0]!.id;

    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(`UPDATE accounts SET default_currency = 'AUD' WHERE id = $1`, [accountId]);
  });

  afterEach(async () => {
    await persistence?.close();
    await pool?.end();
  });

  it("deletes stock-dividend lots and allocations in the scoped market", async () => {
    await seedTrade("trade-buy-au", "BHP", "AU", "AUD", "BUY", 1);
    await seedTrade("trade-sell-au", "BHP", "AU", "AUD", "SELL", 2);
    await seedTrade("trade-rio", "RIO", "AU", "AUD", "SELL", 3);
    const auEventId = await seedStockDividendEvent("div-au", "AU", "AUD");
    await seedDividendLedgerEntry("dle-au", auEventId);
    await seedPositionAction("position-action-dle-au", "dle-au", "BHP", "AU");

    await seedLot("lot-trade-buy-au", "BHP", "AUD", 1);
    await seedLot("lot-dle-au", "BHP", "AUD", 2);
    await seedLot("lot-rio", "RIO", "AUD", 1);
    await seedAllocation("alloc-trade", "trade-sell-au", "BHP", "lot-trade-buy-au", "AUD", 1);
    await seedAllocation("alloc-dividend", "trade-sell-au", "BHP", "lot-dle-au", "AUD", 2);
    await seedAllocation("alloc-other-ticker", "trade-rio", "RIO", "lot-rio", "AUD", 1);

    const deletedLots = await persistence.deleteLotsForAccountTicker(userId, accountId, "BHP", "AU");
    const deletedAllocations = await persistence.deleteLotAllocationsForAccountTicker(userId, accountId, "BHP", "AU");

    expect(deletedLots).toBe(2);
    expect(deletedAllocations).toBe(2);

    const remainingLots = await pool.query<{ id: string }>(`SELECT id FROM lots ORDER BY id`);
    const remainingAllocations = await pool.query<{ id: string }>(`SELECT id FROM lot_allocations ORDER BY id`);
    expect(remainingLots.rows).toEqual([{ id: "lot-rio" }]);
    expect(remainingAllocations.rows).toEqual([{ id: "alloc-other-ticker" }]);
  });

  it("round-trips accounting stores with dividend-linked position actions", async () => {
    const eventId = await seedStockDividendEvent("div-save-order", "AU", "AUD");
    await seedDividendLedgerEntry("dle-save-order", eventId);
    await seedPositionAction("position-action-save-order", "dle-save-order", "BHP", "AU");

    const store = await persistence.loadStore(userId);
    expect(store.accounting.facts.dividendLedgerEntries.some((entry) => entry.id === "dle-save-order")).toBe(true);
    expect(store.accounting.facts.positionActions.some((action) => action.id === "position-action-save-order")).toBe(true);

    await expect(persistence.saveAccountingStore(userId, store.accounting)).resolves.toBeUndefined();

    const persistedActions = await pool.query<{ id: string; related_dividend_ledger_entry_id: string | null }>(
      `SELECT id, related_dividend_ledger_entry_id
       FROM position_actions
       WHERE id = 'position-action-save-order'`,
    );
    expect(persistedActions.rows).toEqual([
      { id: "position-action-save-order", related_dividend_ledger_entry_id: "dle-save-order" },
    ]);
  });

  it("hard-purges users with dividend-linked position actions", async () => {
    const eventId = await seedStockDividendEvent("div-user-purge", "AU", "AUD");
    await seedDividendLedgerEntry("dle-user-purge", eventId);
    await seedPositionAction("position-action-user-purge", "dle-user-purge", "BHP", "AU");

    await expect(persistence.hardPurgeUser(userId, { actorUserId: userId })).resolves.toBeUndefined();

    const remaining = await pool.query<{ position_action_count: string; ledger_count: string }>(
      `SELECT
         (SELECT COUNT(*) FROM position_actions WHERE id = 'position-action-user-purge') AS position_action_count,
         (SELECT COUNT(*) FROM dividend_ledger_entries WHERE id = 'dle-user-purge') AS ledger_count`,
    );
    expect(remaining.rows[0]).toEqual({ position_action_count: "0", ledger_count: "0" });
  });

  it("hard-purges accounts with dividend-linked position actions", async () => {
    const eventId = await seedStockDividendEvent("div-account-purge", "AU", "AUD");
    await seedDividendLedgerEntry("dle-account-purge", eventId);
    await seedPositionAction("position-action-account-purge", "dle-account-purge", "BHP", "AU");

    await expect(
      persistence.hardPurgeAccount(accountId, userId, { actorUserId: userId }, { mustBeSoftDeleted: false }),
    ).resolves.toMatchObject({
      account: { id: accountId },
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
      reportingCurrency: {
        effective: null,
        reason: "no_configured_currencies",
      },
    });

    const remaining = await pool.query<{ position_action_count: string; ledger_count: string; account_count: string }>(
      `SELECT
         (SELECT COUNT(*) FROM position_actions WHERE id = 'position-action-account-purge') AS position_action_count,
         (SELECT COUNT(*) FROM dividend_ledger_entries WHERE id = 'dle-account-purge') AS ledger_count,
         (SELECT COUNT(*) FROM accounts WHERE id = $1) AS account_count`,
      [accountId],
    );
    expect(remaining.rows[0]).toEqual({ position_action_count: "0", ledger_count: "0", account_count: "0" });
  });

  async function seedFeePolicySnapshot(): Promise<string> {
    const id = randomUUID();
    await pool.query(
      `INSERT INTO trade_fee_policy_snapshots (
         id, user_id, profile_id_at_booking, profile_name_at_booking,
         board_commission_rate, commission_discount_percent, minimum_commission_amount,
         commission_currency, commission_rounding_mode, tax_rounding_mode,
         stock_sell_tax_rate_bps, stock_day_trade_tax_rate_bps,
         etf_sell_tax_rate_bps, bond_etf_sell_tax_rate_bps, commission_charge_mode
       ) VALUES (
         $1, $2, $3, 'Default Broker',
         1.425, 28, 20,
         'AUD', 'FLOOR', 'FLOOR',
         30, 15,
         10, 0, 'CHARGED_UPFRONT'
       )`,
      [id, userId, feeProfileId],
    );
    return id;
  }

  async function seedTrade(
    id: string,
    ticker: string,
    marketCode: string,
    currency: string,
    tradeType: "BUY" | "SELL",
    bookingSequence: number,
  ): Promise<void> {
    const snapshotId = await seedFeePolicySnapshot();
    await pool.query(
      `INSERT INTO trade_events (
         id, user_id, account_id, ticker, market_code, instrument_type, trade_type,
         quantity, unit_price, price_currency, trade_date, trade_timestamp,
         booking_sequence, commission_amount, tax_amount, is_day_trade,
         fee_policy_snapshot_id, source, source_reference, booked_at
       ) VALUES (
         $1, $2, $3, $4, $5, 'STOCK', $6,
         1, 100, $7, DATE '2026-02-01', TIMESTAMPTZ '2026-02-01T00:00:00Z',
         $8, 0, 0, false,
         $9, 'test', $1, TIMESTAMPTZ '2026-02-01T00:00:00Z'
       )`,
      [id, userId, accountId, ticker, marketCode, tradeType, currency, bookingSequence, snapshotId],
    );
  }

  async function seedStockDividendEvent(id: string, marketCode: string, currency: string): Promise<string> {
    await pool.query(
      `INSERT INTO market_data.dividend_events (
         id, ticker, market_code, event_type, ex_dividend_date, payment_date,
         cash_dividend_per_share, cash_dividend_currency, stock_dividend_per_share, source
       ) VALUES (
         $1, 'BHP', $2, 'STOCK', DATE '2026-01-15', DATE '2026-01-31',
         0, $3, 0.1, 'test'
       )`,
      [id, marketCode, currency],
    );
    return id;
  }

  async function seedDividendLedgerEntry(id: string, dividendEventId: string): Promise<void> {
    await pool.query(
      `INSERT INTO dividend_ledger_entries (
         id, account_id, dividend_event_id, eligible_quantity,
         expected_cash_amount, expected_stock_quantity, received_stock_quantity,
         posting_status, reconciliation_status, version, source_composition_status, booked_at
       ) VALUES (
         $1, $2, $3, 10,
         0, 1, 1,
         'posted', 'open', 1, 'provided', TIMESTAMPTZ '2026-01-31T00:00:00Z'
       )`,
      [id, accountId, dividendEventId],
    );
  }

  async function seedPositionAction(id: string, dividendLedgerEntryId: string, ticker: string, marketCode: string): Promise<void> {
    await pool.query(
      `INSERT INTO position_actions (
         id, account_id, ticker, market_code, action_type, action_date, action_timestamp,
         booked_at, quantity, related_dividend_ledger_entry_id, source, source_reference
       ) VALUES (
         $1, $2, $3, $4, 'STOCK_DIVIDEND', DATE '2026-01-31', TIMESTAMP '2026-01-31 00:00:00',
         TIMESTAMP '2026-01-31 00:00:00', 1, $5, 'test', $5
       )`,
      [id, accountId, ticker, marketCode, dividendLedgerEntryId],
    );
  }

  async function seedLot(id: string, ticker: string, currency: string, openedSequence: number): Promise<void> {
    await pool.query(
      `INSERT INTO lots (
         id, account_id, ticker, open_quantity, total_cost_amount, cost_currency, opened_at, opened_sequence
       ) VALUES (
         $1, $2, $3, 1, 100, $4, DATE '2026-01-31', $5
       )`,
      [id, accountId, ticker, currency, openedSequence],
    );
  }

  async function seedAllocation(
    id: string,
    tradeEventId: string,
    ticker: string,
    lotId: string,
    currency: string,
    lotOpenedSequence: number,
  ): Promise<void> {
    await pool.query(
      `INSERT INTO lot_allocations (
         id, user_id, account_id, trade_event_id, ticker, lot_id, lot_opened_at,
         lot_opened_sequence, allocated_quantity, allocated_cost_amount, cost_currency, created_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, DATE '2026-01-31',
         $7, 1, 100, $8, TIMESTAMPTZ '2026-02-01T00:00:00Z'
       )`,
      [id, userId, accountId, tradeEventId, ticker, lotId, lotOpenedSequence, currency],
    );
  }
});
