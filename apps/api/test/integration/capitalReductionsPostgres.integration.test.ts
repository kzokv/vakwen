import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { previewCapitalReduction, confirmCapitalReduction } from "../../src/services/capitalReduction.js";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import { amendInput, capitalReductionInput, confirmation, ownerContext, postCapitalReduction, seedCapitalReductionHolding, syntheticFraction, syntheticFeePayment } from "../helpers/capitalReductionFixtures.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
if (process.env.RUN_POSTGRES_INTEGRATION === "1" && process.env.VAKWEN_MANAGED_CI_STACK !== "1") throw new Error("Use npm run test:integration:full:host or npm run test:integration:full:container");
const postgres = process.env.RUN_POSTGRES_INTEGRATION === "1" && databaseUrl && redisUrl ? describe : describe.skip;

postgres("cash capital reduction real Postgres acceptance", () => {
  let persistence: PostgresPersistence, pool: Pool, accountId: string;
  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA IF EXISTS market_data CASCADE"); await pool.query("DROP SCHEMA IF EXISTS public CASCADE"); await pool.query("CREATE SCHEMA public"); await pool.query("GRANT ALL ON SCHEMA public TO public");
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! }); await persistence.init(); await persistence.ensureDevBypassUser();
    ({ accountId } = await seedCapitalReductionHolding(persistence));
  });
  afterEach(async () => { await persistence?.close(); await pool?.end(); });
  it("[R10 R13 R17 R18 R19]: multiple cash components → durable reload, replay and idempotent revision", async () => {
    const initial = capitalReductionInput(accountId);
    let action = await postCapitalReduction(persistence, initial);
    action = await postCapitalReduction(persistence, amendInput(action, { repaymentReceipts: [{ id: "synthetic-first", evidenceReference: "synthetic-first-proof", receivedDate: "2026-02-10", grossAmount: 2000, cashAmount: 1995, feeAmount: 5 }] }));
    expect(action.reconciliation.outstandingRepaymentAmount).toBe(2579);
    action = await postCapitalReduction(persistence, amendInput(action, { repaymentReceipts: [...action.revisions.at(-1)!.input.repaymentReceipts, { id: "synthetic-second", evidenceReference: "synthetic-second-proof", receivedDate: "2026-02-11", grossAmount: 2579, cashAmount: 2579, feeAmount: 0 }], fractionSettlement: syntheticFraction }));
    const preview = await previewCapitalReduction(persistence, ownerContext(), amendInput(action, { fractionAdjustments: [syntheticFeePayment] }));
    action = await confirmCapitalReduction(persistence, ownerContext(), confirmation(preview));
    await persistence.close(); persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! }); await persistence.init();
    expect((await confirmCapitalReduction(persistence, ownerContext(), confirmation(preview))).id).toBe(action.id);
    await replayPositionHistory(persistence, "user-1", accountId, "SYNTH", { marketCode: "TW" });
    const store = await persistence.loadStore("user-1"), cash = store.accounting.facts.cashLedgerEntries.filter(row => row.relatedCapitalReductionId === action.id);
    expect(cash).toHaveLength(3); expect(cash.reduce((sum, row) => sum + row.amount, 0)).toBe(4573); expect(new Set(cash.map(row => row.sourceReference)).size).toBe(3);
    expect(store.accounting.projections.holdings.find(row => row.ticker === "SYNTH")).toMatchObject({ quantity: 542, costBasisAmount: 25418.69 });
    expect(store.accounting.facts.capitalReductions!.actions[0]!.reconciliation).toMatchObject({ outstandingRepaymentAmount: 0, feeAmount: 8, fractionalRealizedAmount: -0.31, outstandingFractionFeeAmount: 0 });
  });
  it("[R14 R18]: immutable history, account event uniqueness and scoped cash FK → reject SQL bypasses", async () => {
    const action = await postCapitalReduction(persistence, capitalReductionInput(accountId));
    await expect(pool.query("UPDATE account_capital_reductions SET history=jsonb_set(history,'{revisions,0,reason}','\"silently overwritten\"') WHERE id=$1", [action.id])).rejects.toThrow(/immutable/);
    await expect(pool.query("INSERT INTO account_capital_reductions SELECT 'synthetic-duplicate',user_id,account_id,event_id,current_revision,status,history FROM account_capital_reductions WHERE id=$1", [action.id])).rejects.toMatchObject({ code: "23505" });
    await expect(pool.query("UPDATE capital_reduction_announcements SET terms=jsonb_set(terms,'{ratioNumerator}','\"100\"') WHERE event_id=$1", [action.eventId])).rejects.toThrow(/immutable/);
    await expect(pool.query("INSERT INTO cash_ledger_entries (id,user_id,account_id,entry_date,entry_type,amount,currency,source,source_reference,related_capital_reduction_id) VALUES ('synthetic-invalid-parent','user-1',$1,'2026-02-10','CAPITAL_REPAYMENT_RECEIPT',1,'TWD','capital_repayment','synthetic-invalid-parent','foreign-synthetic-action')", [accountId])).rejects.toMatchObject({ code: "23503" });
    const other = await persistence.createAccount({ userId: "user-1", name: "Synthetic Isolated Account", defaultCurrency: "TWD", accountType: "broker", auditInput: { actorUserId: "user-1" } });
    await expect(pool.query("INSERT INTO cash_ledger_entries (id,user_id,account_id,entry_date,entry_type,amount,currency,source,source_reference,related_capital_reduction_id) VALUES ('synthetic-wrong-account','user-1',$1,'2026-02-10','CAPITAL_REPAYMENT_RECEIPT',1,'TWD','capital_repayment','synthetic-wrong-account',$2)", [other.account.id, action.id])).rejects.toMatchObject({ code: "23503" });
    expect((await pool.query("SELECT id FROM cash_ledger_entries WHERE id='synthetic-invalid-parent'")).rows).toHaveLength(0);
    expect((await persistence.loadStore("user-1")).accounting.facts.capitalReductions!.actions[0]!.revision).toBe(1);
  });
  it("[R18 R24]: hard purge synthetic account → private histories and cash disappear, public source survives", async () => {
    const action = await postCapitalReduction(persistence, capitalReductionInput(accountId, { repaymentReceipts: [{ id: "synthetic-purge-receipt", evidenceReference: "synthetic-purge-proof", receivedDate: "2026-02-10", grossAmount: 4579, cashAmount: 4574, feeAmount: 5 }] }));
    await persistence.hardPurgeAccount(accountId, "user-1", { actorUserId: "user-1" }, { mustBeSoftDeleted: false });
    expect((await pool.query("SELECT id FROM account_capital_reductions WHERE id=$1", [action.id])).rows).toHaveLength(0);
    expect((await pool.query("SELECT id FROM cash_ledger_entries WHERE related_capital_reduction_id=$1", [action.id])).rows).toHaveLength(0);
    const store = await persistence.loadStore("user-1");
    expect(store.accounting.facts.capitalReductions!.actions.some(row => row.id === action.id)).toBe(false);
    expect(store.accounting.facts.capitalReductions!.previews.some(row => row.preview.input.accountId === accountId)).toBe(false);
    expect((await pool.query("SELECT event_id FROM capital_reduction_announcements WHERE event_id=$1", [action.eventId])).rows).toHaveLength(1);
  });
  it("[R18]: source insert SQL failure → whole confirmation rollback then safe retry", async () => {
    const preview = await previewCapitalReduction(persistence, ownerContext(), capitalReductionInput(accountId));
    await pool.query("CREATE FUNCTION synthetic_fail_capital_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic persistence failure'; END $$");
    await pool.query("CREATE TRIGGER synthetic_fail_capital_write BEFORE INSERT ON account_capital_reductions FOR EACH ROW EXECUTE FUNCTION synthetic_fail_capital_write()");
    await expect(confirmCapitalReduction(persistence, ownerContext(), confirmation(preview))).rejects.toThrow(/synthetic persistence failure/);
    const store = await persistence.loadStore("user-1"); expect(store.accounting.facts.positionActions).toHaveLength(0); expect(store.accounting.projections.holdings[0]!.quantity).toBe(1000);
    expect((await pool.query("SELECT id FROM account_capital_reductions")).rows).toHaveLength(0);
    await pool.query("DROP TRIGGER synthetic_fail_capital_write ON account_capital_reductions");
    await expect(confirmCapitalReduction(persistence, ownerContext(), confirmation(preview))).resolves.toMatchObject({ revision: 1 });
  });
  it("[R05 R19]: exact SQL share allocation and actual dividend eligibility → account conversion parity", async () => {
    const action = await postCapitalReduction(persistence, capitalReductionInput(accountId));
    const allocation = await pool.query("SELECT capital_reduction_share_allocation(ARRAY[1,1]::numeric[],ARRAY['2026-01-02','2026-01-02']::date[],ARRAY[1,1]::numeric[],ARRAY['a','b']::text[],$1::jsonb) AS quantities", [JSON.stringify({ announcement: { ratioNumerator: "1", ratioDenominator: "2" } })]);
    expect(allocation.rows[0].quantities.map(Number)).toEqual([1, 0]);
    const store = await persistence.loadStore("user-1");
    store.marketData.dividendEvents.push({ id: "synthetic-post-conversion-dividend", ticker: "SYNTH", marketCode: "TW", eventType: "CASH", exDividendDate: "2026-02-10", paymentDate: "2026-02-20", cashDividendPerShare: 1, cashDividendCurrency: "TWD", stockDividendPerShare: 0, source: "synthetic" });
    await persistence.saveStore(store);
    const review = await persistence.listDividendReviewRows("user-1", { page: 1, limit: 10, sortBy: "paymentDate", sortOrder: "desc" });
    expect(review.rows.find(row => row.id === `expected:${accountId}:synthetic-post-conversion-dividend`)).toMatchObject({ eligibleQuantity: 542, expectedCashAmount: 542 });
    const voided = await postCapitalReduction(persistence, amendInput(action, { operation: "VOID" }));
    expect((await persistence.loadStore("user-1")).accounting.projections.holdings[0]!.quantity).toBe(1000);
    const restored = await postCapitalReduction(persistence, amendInput(voided, { operation: "RESTORE" })); expect(restored.id).toBe(action.id);
  });
});
