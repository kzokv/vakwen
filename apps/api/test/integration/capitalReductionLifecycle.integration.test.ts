import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { previewCapitalReduction, confirmCapitalReduction, retryCapitalReductionGeneration } from "../../src/services/capitalReduction.js";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import { capitalReductionInput, confirmation, ownerContext, postCapitalReduction, seedCapitalReductionHolding, amendInput, syntheticFraction, syntheticFeePayment } from "../helpers/capitalReductionFixtures.js";

describe("cash capital reduction linked lifecycle", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => { app = await buildApp({ persistenceBackend: "memory" }); await seedCapitalReductionHolding(app.persistence); });
  afterEach(async () => { vi.restoreAllMocks(); await app.close(); });
  it("[R09 R10 R13]: partial net receipt → later fee classification and separately dated fraction payment occur once", async () => {
    let action = await postCapitalReduction(app.persistence, capitalReductionInput());
    action = await postCapitalReduction(app.persistence, amendInput(action, { repaymentReceipts: [{ id: "synthetic-net", evidenceReference: "synthetic-bank-proof", receivedDate: "2026-02-10", grossAmount: 4574, cashAmount: 4574, feeAmount: 0 }] }));
    expect(action.reconciliation).toMatchObject({ outstandingRepaymentAmount: 5, cashAmount: 4574, feeAmount: 0 });
    action = await postCapitalReduction(app.persistence, amendInput(action, { repaymentReceipts: [...action.revisions.at(-1)!.input.repaymentReceipts, { id: "synthetic-classification", evidenceReference: "synthetic-fee-proof", receivedDate: "2026-02-11", grossAmount: 5, cashAmount: 0, feeAmount: 5 }], fractionSettlement: syntheticFraction }));
    expect(action.reconciliation).toMatchObject({ outstandingRepaymentAmount: 0, cashAmount: 4574, feeAmount: 8, fractionalRealizedAmount: -0.31, outstandingFractionFeeAmount: 1, reconciled: false });
    action = await postCapitalReduction(app.persistence, amendInput(action, { fractionAdjustments: [syntheticFeePayment] }));
    expect(action.reconciliation).toMatchObject({ cashAmount: 4573, feeAmount: 8, fractionalRealizedAmount: -0.31, outstandingFractionFeeAmount: 0, reconciled: true });
    await replayPositionHistory(app.persistence, "user-1", "acc-1", "SYNTH", { marketCode: "TW" });
    const store = await app.persistence.loadStore("user-1"), cash = store.accounting.facts.cashLedgerEntries.filter(row => row.relatedCapitalReductionId === action.id);
    expect(cash.map(row => [row.entryType, row.amount, row.entryDate]).sort()).toEqual([["CAPITAL_REPAYMENT_RECEIPT", 4574, "2026-02-10"], ["CAPITAL_REDUCTION_FEE_PAYMENT", -1, "2026-02-13"]].sort());
    expect(new Set(cash.map(row => row.sourceReference)).size).toBe(2);
    expect(store.accounting.facts.positionActions).toHaveLength(1);
    expect(store.accounting.projections.holdings.find(row => row.ticker === "SYNTH")).toMatchObject({ quantity: 542, costBasisAmount: 25418.69 });
  });
  it("[R12 R13]: confirmed undistributed proceeds → later cash allocation never repeats gross or cost", async () => {
    let action = await postCapitalReduction(app.persistence, capitalReductionInput("acc-1", { fractionSettlement: { ...syntheticFraction, processingFeeAmount: 0, feeOffsetAmount: 0 } }));
    expect(action.reconciliation).toMatchObject({ outstandingFractionProceedsAmount: 2, cashAmount: 0, fractionalRealizedAmount: -0.31 });
    action = await postCapitalReduction(app.persistence, amendInput(action, { fractionAdjustments: [{ ...syntheticFeePayment, feeCashPaidAmount: 0, cashAmount: 2 }] }));
    expect(action.reconciliation).toMatchObject({ outstandingFractionProceedsAmount: 0, cashAmount: 2, fractionalRealizedAmount: -0.31, feeAmount: 0 });
  });
  it.each(["overpayment", "duplicate", "unbalanced"])("[R11]: %s → blocked without partial mutation", async kind => {
    const action = await postCapitalReduction(app.persistence, capitalReductionInput());
    const receipt = { id: "synthetic-receipt", evidenceReference: "synthetic-proof", receivedDate: "2026-02-10", grossAmount: 2000, cashAmount: 1995, feeAmount: 5 };
    const receipts = kind === "duplicate" ? [receipt, receipt] : [{ ...receipt, ...(kind === "overpayment" ? { grossAmount: 4580, cashAmount: 4575 } : { grossAmount: 2001 }) }];
    const preview = await previewCapitalReduction(app.persistence, ownerContext(), amendInput(action, { repaymentReceipts: receipts }));
    expect(preview.blockers.length).toBeGreaterThan(0);
    await expect(confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview))).rejects.toMatchObject({ statusCode: 409 });
    expect((await app.persistence.loadStore("user-1")).accounting.facts.capitalReductions!.actions[0]!.revision).toBe(1);
  });
  it("[R03]: fraction adjustment preceding confirmed base settlement → HTTP rejects", async () => {
    const input = capitalReductionInput("acc-1", { fractionSettlement: syntheticFraction, fractionAdjustments: [{ ...syntheticFeePayment, occurredDate: "2026-02-11" }] });
    expect((await app.inject({ method: "POST", url: "/portfolio/capital-reductions/preview", payload: input })).statusCode).toBe(400);
  });
  it("[R14 R15]: audited void and restore → same history restores linked effects", async () => {
    let action = await postCapitalReduction(app.persistence, capitalReductionInput("acc-1", { repaymentReceipts: [{ id: "synthetic-credit", evidenceReference: "synthetic-credit-proof", receivedDate: "2026-02-10", grossAmount: 4579, cashAmount: 4574, feeAmount: 5 }] }));
    const id = action.id, original = structuredClone(action.revisions[0]);
    action = await postCapitalReduction(app.persistence, amendInput(action, { operation: "VOID", reason: "Synthetic audited erroneous posting" }));
    expect(action.status).toBe("VOIDED");
    let store = await app.persistence.loadStore("user-1"); expect(store.accounting.projections.holdings[0]!.quantity).toBe(1000); expect(store.accounting.facts.cashLedgerEntries.filter(row => row.relatedCapitalReductionId === id)).toHaveLength(0);
    action = await postCapitalReduction(app.persistence, amendInput(action, { operation: "RESTORE", reason: "Synthetic mistaken void correction" }));
    expect(action.id).toBe(id); expect(action.revision).toBe(3); expect(action.revisions[0]).toEqual(original);
    expect(action.revisions.map(row => row.operation)).toEqual(["POST", "VOID", "RESTORE"]);
    store = await app.persistence.loadStore("user-1"); expect(store.accounting.projections.holdings[0]!.quantity).toBe(542); expect(store.accounting.facts.cashLedgerEntries.filter(row => row.relatedCapitalReductionId === id)).toHaveLength(1);
  });
  it("[R15]: amendment oversells later history → preserves action, sales and cash", async () => {
    const action = await postCapitalReduction(app.persistence, capitalReductionInput());
    const sale = await app.inject({ method: "POST", url: "/portfolio/transactions", headers: { "idempotency-key": "synthetic-later-sell" }, payload: { accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", type: "SELL", quantity: 500, unitPrice: 60, priceCurrency: "TWD", tradeDate: "2026-02-15", commissionAmount: 0, taxAmount: 0, isDayTrade: false } });
    expect(sale.statusCode).toBe(200);
    const before = structuredClone((await app.persistence.loadStore("user-1")).accounting);
    const input = amendInput(action, { operation: "AMEND", confirmedWholeQuantity: 100, announcement: { ...action.revisions[0]!.input.announcement, version: 2, ratioNumerator: "100" } });
    expect((await previewCapitalReduction(app.persistence, ownerContext(), input)).blockers.length).toBeGreaterThan(0);
    const after = (await app.persistence.loadStore("user-1")).accounting;
    expect(after.projections).toEqual(before.projections); expect(after.facts.tradeEvents).toEqual(before.facts.tradeEvents); expect(after.facts.cashLedgerEntries).toEqual(before.facts.cashLedgerEntries);
  });
  it("[R06]: sell all converted shares → allocated cost conserves full retained acquisition cost", async () => {
    await postCapitalReduction(app.persistence, capitalReductionInput());
    const sale = await app.inject({ method: "POST", url: "/portfolio/transactions", headers: { "idempotency-key": "synthetic-all-shares-sale" }, payload: { accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", type: "SELL", quantity: 542, unitPrice: 60, priceCurrency: "TWD", tradeDate: "2026-02-15", commissionAmount: 0, taxAmount: 0, isDayTrade: false } });
    expect(sale.statusCode).toBe(200);
    const store = await app.persistence.loadStore("user-1");
    const trade = store.accounting.facts.tradeEvents.find(row => row.type === "SELL")!;
    expect(store.accounting.projections.lotAllocations.filter(row => row.tradeEventId === trade.id).reduce((sum, row) => sum + row.allocatedCostAmount, 0)).toBe(25418.69);
    expect(store.accounting.projections.holdings.filter(row => row.ticker === "SYNTH")).toHaveLength(0);
  });
  it("[R18]: persistence commit failure → source and holdings rollback, retry succeeds", async () => {
    const preview = await previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput());
    const before = structuredClone((await app.persistence.loadStore("user-1")).accounting);
    const save = vi.spyOn(app.persistence, "saveStore").mockRejectedValueOnce(new Error("synthetic durable failure"));
    await expect(confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview))).rejects.toThrow("synthetic durable failure");
    expect((await app.persistence.loadStore("user-1")).accounting).toEqual(before);
    save.mockRestore(); await expect(confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview))).resolves.toMatchObject({ revision: 1 });
  });
  it("[R06]: sequential partial and final sales → acquisition cents conserved", async () => {
    await postCapitalReduction(app.persistence, capitalReductionInput());
    for (const [index, quantity] of [100, 442].entries()) {
      const response = await app.inject({ method: "POST", url: "/portfolio/transactions", headers: { "idempotency-key": `synthetic-sequential-sale-${index}` }, payload: { accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", type: "SELL", quantity, unitPrice: 60, priceCurrency: "TWD", tradeDate: `2026-02-${15 + index}`, commissionAmount: 0, taxAmount: 0, isDayTrade: false } });
      expect(response.statusCode).toBe(200);
      const store = await app.persistence.loadStore("user-1");
      if (index === 0) expect(store.accounting.projections.holdings.find(row => row.ticker === "SYNTH")).toMatchObject({ quantity: 442, costBasisAmount: 20728.89 });
      else expect(store.accounting.projections.holdings.filter(row => row.ticker === "SYNTH")).toHaveLength(0);
    }
    const allocated = (await app.persistence.loadStore("user-1")).accounting.projections.lotAllocations;
    expect(allocated.map(row => row.allocatedCostAmount)).toEqual([4689.8, 20728.89]);
    expect(allocated.reduce((sum, row) => sum + Math.round(row.allocatedCostAmount * 100), 0)).toBe(2541869);
  });
  it("[R23]: genuine generator failure → durable failed status and actual retry recovery", async () => {
    const action = await postCapitalReduction(app.persistence, capitalReductionInput());
    const result = await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id, { generateSnapshots: async () => { throw new Error("synthetic generator dependency failure"); } });
    expect(result.generation).toMatchObject({ status: "failed", retryable: true, error: "synthetic generator dependency failure" });
    expect((await app.persistence.loadStore("user-1")).accounting.facts.capitalReductions!.actions[0]!.generation.status).toBe("failed");
    const recovered = await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id);
    expect(recovered.generation).toMatchObject({ status: "current", retryable: false });
  });
});
