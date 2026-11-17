import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { createTransaction } from "../../src/services/portfolio.js";
import { capitalReductionInput, postCapitalReduction, seedCapitalReductionHolding } from "../helpers/capitalReductionFixtures.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const migration = "124_cash_capital_reduction.sql";
if (process.env.RUN_POSTGRES_INTEGRATION === "1" && process.env.VAKWEN_MANAGED_CI_STACK !== "1") throw new Error("Use the managed test:integration:full:host or test:integration:full:container runner");
const postgres = process.env.RUN_POSTGRES_INTEGRATION === "1" && databaseUrl && redisUrl ? describe : describe.skip;

postgres("capital reduction migration recovery guards", () => {
  let persistence: PostgresPersistence, pool: Pool, accountId: string;
  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA IF EXISTS market_data CASCADE"); await pool.query("DROP SCHEMA IF EXISTS public CASCADE"); await pool.query("CREATE SCHEMA public"); await pool.query("GRANT ALL ON SCHEMA public TO public");
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! }); await persistence.init(); await persistence.ensureDevBypassUser();
    ({ accountId } = await seedCapitalReductionHolding(persistence));
  });
  afterEach(async () => { await persistence?.close(); await pool?.end(); });
  async function receipt() {
    await postCapitalReduction(persistence, capitalReductionInput(accountId, { repaymentReceipts: [{ id: "synthetic-recovery-credit", evidenceReference: "synthetic-recovery-credit-proof", receivedDate: "2026-02-10", grossAmount: 2000, cashAmount: 1995, feeAmount: 5 }] }));
  }
  async function precisionTrade() {
    await persistence.upsertInstruments("user-1", [{ ticker: "PRECISION", type: "STOCK", marketCode: "TW", name: "Synthetic Four Decimal Stock" }]);
    const store = await persistence.loadStore("user-1");
    createTransaction(store, "user-1", { id: "synthetic-recovery-precision-buy", accountId, ticker: "PRECISION", marketCode: "TW", quantity: 1, unitPrice: 10, priceCurrency: "TWD", tradeDate: "2026-01-03", type: "BUY", commissionAmount: 0.1234, taxAmount: 0.0001, isDayTrade: false });
    await persistence.saveStore(store);
    expect((await pool.query("SELECT commission_amount::text,tax_amount::text FROM trade_events WHERE id='synthetic-recovery-precision-buy'")).rows).toEqual([{ commission_amount: "0.1234", tax_amount: "0.0001" }]);
    expect((await pool.query("SELECT amount::text FROM cash_ledger_entries WHERE related_trade_event_id='synthetic-recovery-precision-buy'")).rows).toEqual([{ amount: "-10.1235" }]);
    expect((await pool.query("SELECT total_cost_amount::text FROM lots WHERE ticker='PRECISION'")).rows).toEqual([{ total_cost_amount: "10.1235" }]);
  }
  async function financialState() {
    return {
      actions: (await pool.query("SELECT * FROM account_capital_reductions ORDER BY id")).rows,
      state: (await pool.query("SELECT * FROM capital_reduction_state ORDER BY user_id")).rows,
      cash: (await pool.query("SELECT * FROM cash_ledger_entries ORDER BY id")).rows.map(row => ({ ...row, related_capital_reduction_id: row.related_capital_reduction_id ?? null })),
      lots: (await pool.query("SELECT * FROM lots ORDER BY id")).rows,
      positions: (await pool.query("SELECT * FROM position_actions ORDER BY id")).rows,
      trades: (await pool.query("SELECT * FROM trade_events ORDER BY id")).rows,
      // Compare PostgreSQL's actual typmods as well as unparsed NUMERIC strings.
      typmods: (await pool.query("SELECT table_name,column_name,numeric_precision,numeric_scale FROM information_schema.columns WHERE table_schema='public' AND ((table_name='cash_ledger_entries' AND column_name='amount') OR (table_name='lots' AND column_name='total_cost_amount') OR (table_name='trade_events' AND column_name IN ('unit_price','commission_amount','tax_amount'))) ORDER BY table_name,column_name")).rows,
    };
  }
  async function reopen() {
    await persistence.close(); persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
  }
  async function ledgerChecksum() {
    return (await pool.query<{ checksum: string }>("SELECT checksum FROM schema_migrations WHERE name=$1", [migration])).rows;
  }
  async function expectedChecksum() { return createHash("sha256").update(await readFile(new URL(`../../../../db/migrations/${migration}`, import.meta.url))).digest("hex"); }
  async function fullSchema() {
    const fk = await pool.query("SELECT pg_get_constraintdef(oid) AS definition,condeferrable,condeferred FROM pg_constraint WHERE conname='cash_ledger_entries_capital_reduction_owner_fk'");
    expect(fk.rows).toHaveLength(1); expect(fk.rows[0]).toMatchObject({ condeferrable: true, condeferred: true });
    expect(fk.rows[0].definition).toMatch(/FOREIGN KEY \(user_id, account_id, related_capital_reduction_id\)/);
    const guards = await pool.query("SELECT tgname FROM pg_trigger WHERE tgname IN ('capital_reduction_history_guard','capital_reduction_announcement_guard') AND NOT tgisinternal"); expect(guards.rows).toHaveLength(2);
    const allocation = await pool.query("SELECT capital_reduction_share_allocation(ARRAY[1,1]::numeric[],ARRAY['2026-01-01','2026-01-02']::date[],ARRAY[1,1]::numeric[],ARRAY['a','b']::text[],$1::jsonb) AS result", [JSON.stringify({ announcement: { ratioNumerator: "1", ratioDenominator: "2" } })]);
    expect(allocation.rows[0].result.map(Number)).toEqual([1, 0]);
    expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='cash_ledger_entries' AND column_name='related_capital_reduction_id'")).rows).toHaveLength(1);
  }
  it.each(["124 only", "all rows", "partial ledger"])("[R18 recovery]: physical schema with missing %s ledger → checksum recovered without financial mutation", async missing => {
    await precisionTrade(); await receipt(); const before = await financialState();
    expect(before.typmods).toHaveLength(5);
    expect(before.typmods.filter(row => row.column_name !== "unit_price").every(row => row.numeric_precision === 20 && row.numeric_scale === 4)).toBe(true);
    if (missing === "all rows") await pool.query("DELETE FROM schema_migrations");
    else if (missing === "partial ledger") await pool.query("DELETE FROM schema_migrations WHERE name>='095_ai_connector_identity_and_bearer_policy.sql'");
    else await pool.query("DELETE FROM schema_migrations WHERE name=$1", [migration]);
    await reopen();
    expect(await ledgerChecksum()).toEqual([{ checksum: await expectedChecksum() }]); await fullSchema();
    expect(await financialState()).toEqual(before);
  });
  it.each(["missing history trigger", "incorrect allocation function", "wrong account scope FK", "nondeferred scope FK", "missing cash parent column"])("[R18 reflection negative]: %s → repair fully or fail without a false migration stamp", async fault => {
    // Destructive column fault uses an empty capital-action fixture: deleted parent values cannot be inferred.
    if (fault !== "missing cash parent column") await receipt();
    if (fault === "missing history trigger") await pool.query("DROP TRIGGER capital_reduction_history_guard ON account_capital_reductions");
    if (fault === "incorrect allocation function") await pool.query("CREATE OR REPLACE FUNCTION capital_reduction_share_allocation(quantities NUMERIC[],opening_dates DATE[],opening_sequences NUMERIC[],lot_ids TEXT[],detail JSONB) RETURNS NUMERIC[] LANGUAGE SQL IMMUTABLE STRICT AS 'SELECT ARRAY[999]::numeric[]'");
    if (fault === "wrong account scope FK" || fault === "nondeferred scope FK") {
      await pool.query("ALTER TABLE cash_ledger_entries DROP CONSTRAINT cash_ledger_entries_capital_reduction_owner_fk");
      await pool.query(fault === "wrong account scope FK"
        ? "ALTER TABLE cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_capital_reduction_owner_fk FOREIGN KEY(related_capital_reduction_id) REFERENCES account_capital_reductions(id) DEFERRABLE INITIALLY DEFERRED"
        : "ALTER TABLE cash_ledger_entries ADD CONSTRAINT cash_ledger_entries_capital_reduction_owner_fk FOREIGN KEY(user_id,account_id,related_capital_reduction_id) REFERENCES account_capital_reductions(user_id,account_id,id) NOT DEFERRABLE");
    }
    if (fault === "missing cash parent column") await pool.query("ALTER TABLE cash_ledger_entries DROP COLUMN related_capital_reduction_id CASCADE");
    await pool.query("DELETE FROM schema_migrations WHERE name=$1", [migration]);
    const before = await financialState();
    let error: unknown;
    try { await reopen(); } catch (caught) { error = caught; }
    if (error) expect(await ledgerChecksum()).toEqual([]);
    else { await fullSchema(); expect(await ledgerChecksum()).toEqual([{ checksum: await expectedChecksum() }]); }
    expect(await financialState()).toEqual(before);
  });
  it("[R18 early preflight]: missing legacy catalog proof with post124 facts → rejects before precision-changing old DDL", async () => {
    await precisionTrade(); await receipt();
    await pool.query("ALTER TABLE market_data.instruments DROP COLUMN type_raw");
    const missing = ["020_decimal_prices.sql", "021_instruments_catalog_columns.sql", "022_cash_ledger_decimal_amount.sql", "043_kzo168_fx_transfer.sql", migration];
    await pool.query("DELETE FROM schema_migrations WHERE name=ANY($1::text[])", [missing]);
    const before = await financialState();
    expect(before.typmods).toHaveLength(5);
    expect(before.typmods.filter(row => row.column_name !== "unit_price").every(row => row.numeric_precision === 20 && row.numeric_scale === 4)).toBe(true);
    const ledgerBefore = (await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows;
    await expect(reopen()).rejects.toThrow();
    expect(await financialState()).toEqual(before);
    expect((await pool.query("SELECT name,checksum FROM schema_migrations ORDER BY name")).rows).toEqual(ledgerBefore);
    expect(await ledgerChecksum()).toEqual([]);
    expect((await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema='market_data' AND table_name='instruments' AND column_name='type_raw'")).rows).toEqual([]);
  });
});
