import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { retryCapitalReductionGeneration, previewCapitalReductionAnnouncement, confirmCapitalReductionAnnouncement, retryCapitalReductionAnnouncementGeneration } from "../../src/services/capitalReduction.js";
import { capitalReductionInput, confirmation, ownerContext, postCapitalReduction, seedCapitalReductionHolding, syntheticFraction, syntheticFeePayment } from "../helpers/capitalReductionFixtures.js";

describe("capital reduction dated valuation and reporting", () => {
  let app: Awaited<ReturnType<typeof buildApp>>, cashBefore: number;
  function bars(rows: Array<[string, number]>) { (app.persistence as MemoryPersistence)._seedDailyBars(rows.map(([barDate, close]) => ({ ticker: "SYNTH", marketCode: "TW", barDate, open: close, high: close, low: close, close, volume: 1000, source: "synthetic", quality: "full_bar", ingestedAt: `${barDate}T06:00:00Z` }))); }
  async function listed() { const response = await app.inject({ method: "GET", url: "/portfolio/capital-reductions?accountId=acc-1&ticker=SYNTH" }); expect(response.statusCode).toBe(200); return response.json(); }
  async function summaryAt(date: string) {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(`${date}T04:00:00Z`);
    const response = await app.inject({ method: "GET", url: "/portfolio/page-data" }); expect(response.statusCode).toBe(200);
    return response.json().capitalReductions;
  }
  beforeEach(async () => { app = await buildApp({ persistenceBackend: "memory" }); ({ cashBefore } = await seedCapitalReductionHolding(app.persistence)); });
  afterEach(async () => { vi.useRealTimers(); await app.close(); });
  it("[R20 R21]: registered suspension → last old value/date, conversion unposted → incomplete", async () => {
    bars([["2026-01-30", 31], ["2026-02-09", 60.25]]);
    const input = capitalReductionInput();
    const preview = await previewCapitalReductionAnnouncement(app.persistence, ownerContext(), { accountId: "acc-1", announcement: input.announcement, reason: "Synthetic suspension source" });
    expect(preview.blockers).toEqual([]); await confirmCapitalReductionAnnouncement(app.persistence, ownerContext(), confirmation(preview));
    await retryCapitalReductionAnnouncementGeneration(app.persistence, ownerContext(), "acc-1", input.announcement.eventId, 1);
    const suspended = await summaryAt("2026-02-04");
    expect(suspended).toMatchObject({ deliveredStockValueAmount: 31000, outstandingRepaymentAmount: 0, pendingFractionValueAmount: 0 });
    const conversionDue = await summaryAt("2026-02-09"); expect(conversionDue.valuationComplete).toBe(false); expect(conversionDue.navAmount).toBeNull();
  });
  it("[R21]: old quote31 → official reference57.80; matching new quote60.25 replaces it", async () => {
    bars([["2026-01-30", 31]]); const action = await postCapitalReduction(app.persistence, capitalReductionInput());
    let current = (await listed()).actions[0];
    expect(current.valuation).toMatchObject({ status: "OFFICIAL_REFERENCE", sharePrice: 57.8, deliveredShareValue: 31327.6, valuationDate: "2026-02-06" });
    bars([["2026-02-09", 60.25]]); current = (await listed()).actions[0];
    expect(current.valuation).toMatchObject({ status: "MARKET", sharePrice: 60.25, deliveredShareValue: 32655.5 });
    expect(current.revisions[0].input.announcement.officialReferencePrice).toBe(action.revisions[0]!.input.announcement.officialReferencePrice);
  });
  it("[R21 R22]: missing new basis and fraction formula → incomplete NAV and affected returns", async () => {
    bars([["2026-01-30", 31]]); const input = capitalReductionInput(); delete input.announcement.officialReferencePrice; delete input.announcement.fractionReferencePrice;
    const action = await postCapitalReduction(app.persistence, input); await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id);
    expect((await listed()).actions[0].valuation).toMatchObject({ status: "INCOMPLETE", pendingFractionValue: null, totalAssetValue: null });
    const summary = await summaryAt("2026-02-09"); expect(summary).toMatchObject({ navAmount: null, valuationComplete: false, returnsComplete: false });
  });
  it("[R03 R09 R10 R13 R22]: independent receipts, fee recognition and later liability payment → dated NAV conserved", async () => {
    bars([["2026-01-30", 31], ["2026-02-09", 60.25]]);
    const input = capitalReductionInput("acc-1", { repaymentReceipts: [{ id: "synthetic-net", evidenceReference: "synthetic-net-proof", receivedDate: "2026-02-10", grossAmount: 4574, cashAmount: 4574, feeAmount: 0 }, { id: "synthetic-classified", evidenceReference: "synthetic-classified-proof", receivedDate: "2026-02-11", grossAmount: 5, cashAmount: 0, feeAmount: 5 }], fractionSettlement: syntheticFraction, fractionAdjustments: [syntheticFeePayment] });
    const action = await postCapitalReduction(app.persistence, input); await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id);
    const baseNav = cashBefore + 32655.5 + 4579 + 2;
    expect(await summaryAt("2026-02-09")).toMatchObject({ outstandingRepaymentAmount: 4579, pendingFractionValueAmount: 2, confirmedFeeAmount: 0, fractionalRealizedAmount: 0, cashBalanceAmount: cashBefore, navAmount: baseNav });
    expect(await summaryAt("2026-02-10")).toMatchObject({ outstandingRepaymentAmount: 5, confirmedFeeAmount: 0, cashBalanceAmount: cashBefore + 4574, navAmount: baseNav });
    expect(await summaryAt("2026-02-11")).toMatchObject({ outstandingRepaymentAmount: 0, confirmedFeeAmount: 5, cashBalanceAmount: cashBefore + 4574, navAmount: baseNav - 5 });
    expect(await summaryAt("2026-02-12")).toMatchObject({ outstandingFractionFeeAmount: 1, confirmedFeeAmount: 8, fractionalRealizedAmount: -0.31, cashBalanceAmount: cashBefore + 4574, navAmount: baseNav - 8 });
    expect(await summaryAt("2026-02-13")).toMatchObject({ outstandingFractionFeeAmount: 0, confirmedFeeAmount: 8, fractionalRealizedAmount: -0.31, cashBalanceAmount: cashBefore + 4573, navAmount: baseNav - 8 });
  });
  it("[R12 R13 R22]: confirmed undistributed fraction asset → later deposit changes asset class only", async () => {
    bars([["2026-02-09", 60.25]]);
    const action = await postCapitalReduction(app.persistence, capitalReductionInput("acc-1", { fractionSettlement: { ...syntheticFraction, processingFeeAmount: 0, feeOffsetAmount: 0 }, fractionAdjustments: [{ ...syntheticFeePayment, occurredDate: "2026-02-14", feeCashPaidAmount: 0, cashAmount: 2 }] }));
    await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id);
    const before = await summaryAt("2026-02-12"), after = await summaryAt("2026-02-14");
    expect(before).toMatchObject({ outstandingFractionProceedsAmount: 2, fractionalRealizedAmount: -0.31, cashBalanceAmount: cashBefore });
    expect(after).toMatchObject({ outstandingFractionProceedsAmount: 0, fractionalRealizedAmount: -0.31, cashBalanceAmount: cashBefore + 2, navAmount: before.navAmount });
  });
  it("[R23]: failed snapshot generation → returns withheld until real retry produces dated snapshots", async () => {
    bars([["2026-01-30", 31], ["2026-02-09", 60.25]]); const action = await postCapitalReduction(app.persistence, capitalReductionInput());
    await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id, { generateSnapshots: async () => { throw new Error("synthetic snapshot dependency offline"); } });
    expect(await summaryAt("2026-02-09")).toMatchObject({ generationStatus: "failed", returnsComplete: false });
    vi.useRealTimers(); await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id);
    const snapshots = await app.persistence.listHoldingSnapshots("user-1", { accountIds: ["acc-1"], startDate: "2026-02-06", endDate: "2026-02-09", includeProvisional: true, limit: 100, offset: 0 });
    expect(snapshots.rows.some(row => row.quantity === 542 && row.costBasis === 25418.69)).toBe(true);
    expect(await summaryAt("2026-02-09")).toMatchObject({ generationStatus: "current", returnsComplete: true });
  });
  it("[R22]: portfolio, daily and market reports → repayment remains asset movement, never income or trading profit", async () => {
    bars([["2026-02-09", 60.25]]);
    const action = await postCapitalReduction(app.persistence, capitalReductionInput());
    await retryCapitalReductionGeneration(app.persistence, ownerContext(), action.id);
    for (const path of ["/reports/portfolio", "/reports/daily-review", "/reports/market"]) {
      const response = await app.inject({ method: "GET", url: `${path}?scope=TW` });
      expect(response.statusCode, response.body).toBe(200);
      const report = response.json();
      expect(report.capitalReductions).toMatchObject({ outstandingRepaymentAmount: 4579, pendingFractionValueAmount: 2, fractionalRealizedAmount: 0, confirmedFeeAmount: 0 });
      expect(report.summary).toMatchObject({ realizedPnlAmount: 0, incomeAmount: 0 });
    }
  });
});
