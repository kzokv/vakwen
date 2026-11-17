import { describe, expect, it } from "vitest";
import { calculateCashCapitalReduction, calculateCapitalReductionSettlement, type DailyBarWithMarket } from "@vakwen/domain";
import type { AccountCapitalReductionDto, CapitalReductionInputDto } from "@vakwen/shared-types";
import { capitalReductionComponentsAtDate, capitalReductionValuation, buildCapitalReductionValuation, loadCapitalReductionValuations, registeredCapitalReductionValuationKey } from "../../src/services/capitalReductionValuation.js";
import { buildCapitalReductionPortfolioSummary, capitalReductionEffectsAtDate } from "../../src/services/capitalReductionReporting.js";
import { buildDashboardOverview } from "../../src/services/dashboard.js";
import { translatePerformancePoints } from "../../src/services/dashboardReportingCurrency.js";
import { walkPositionHistory } from "../../src/services/snapshotGeneration.js";
import { createStore, createDefaultFeeProfile } from "../../src/services/store.js";
import type { BookedTradeEvent } from "../../src/types/store.js";
import type { AggregatedSnapshotPoint, Persistence } from "../../src/persistence/types.js";

function fixture() {
  const store = createStore();
  const input: CapitalReductionInputDto = { operation: "POST", accountId: "acc-1", ticker: "SYNTH", confirmedWholeQuantity: 542, evidenceReference: "synthetic-delivery", reason: "synthetic test", repaymentReceipts: [], announcement: { eventId: "synthetic-event", version: 1, ticker: "SYNTH", marketCode: "TW", venue: "TWSE", instrumentType: "STOCK", currency: "TWD", officialReference: "synthetic-reference", sourceUrl: "https://example.test/synthetic", publishedDate: "2026-01-01", reductionDate: "2026-02-01", suspensionStartDate: "2026-02-02", suspensionEndDate: "2026-02-05", exchangeRecordDate: "2026-02-04", conversionDate: "2026-02-06", scheduledPaymentDate: "2026-02-10", ratioNumerator: "542.0491512", ratioDenominator: "1000", repaymentPerOldShare: "4.579", payoutRounding: "FLOOR", officialReferencePrice: "56.70", fractionReferencePrice: "56.70" } };
  const calculation = calculateCashCapitalReduction({ lots: [{ id: "lot-buy", accountId: "acc-1", ticker: "SYNTH", openQuantity: 1000, totalCostAmount: 30000, costCurrency: "TWD", openedAt: "2026-01-02" }], ...input.announcement, confirmedWholeQuantity: 542 });
  const reconciliation = calculateCapitalReductionSettlement(calculation, input);
  const action: AccountCapitalReductionDto = { id: "synthetic-action", accountId: "acc-1", ticker: "SYNTH", eventId: input.announcement.eventId, revision: 1, status: "POSTED", calculation, reconciliation, revisions: [{ revision: 1, operation: "POST", actorId: "synthetic-actor", confirmedAt: "2026-02-07T00:00:00Z", reason: "synthetic", input, calculation, reconciliation, supersededFactIds: [] }], valuation: { status: "INCOMPLETE", valuationDate: null, sharePrice: null, deliveredShareValue: null, repaymentReceivableValue: 4579, pendingFractionValue: 2, totalAssetValue: null, unresolvedFees: true }, generation: { status: "current", fromDate: "2026-02-06", updatedAt: "2026-02-07T00:00:00Z", retryable: false } };
  const trade: BookedTradeEvent = { id: "buy", userId: "user-1", accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", instrumentType: "STOCK", type: "BUY", quantity: 1000, unitPrice: 30, priceCurrency: "TWD", tradeDate: "2026-01-02", commissionAmount: 0, taxAmount: 0, isDayTrade: false, feeSnapshot: createDefaultFeeProfile("acc-1") };
  store.accounting.facts.tradeEvents = [trade];
  store.accounting.facts.positionActions = [{ id: "pa-synthetic-action", accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", actionType: "CASH_CAPITAL_REDUCTION", actionDate: "2026-02-06", quantity: 542, source: "capital_reduction", sourceReference: action.id, capitalReduction: input }];
  store.accounting.facts.capitalReductions = { actions: [action], announcements: [input.announcement], previews: [] };
  store.accounting.projections.holdings = [{ accountId: "acc-1", ticker: "SYNTH", quantity: 542, costBasisAmount: 25418.69, currency: "TWD" }];
  return { store, input, action, trade };
}
function bar(barDate: string, close: number): DailyBarWithMarket {
  return { ticker: "SYNTH", barDate, close, open: close, high: close, low: close, volume: 1, source: "synthetic", quality: "full_bar", marketCode: "TW", ingestedAt: `${barDate}T06:00:00Z` };
}
const settlement = { id: "fraction", evidenceReference: "synthetic-fraction", receivedDate: "2026-02-12", grossAmount: 2, processingFeeAmount: 3, feeOffsetAmount: 2, cashAmount: 0, feeCashPaidAmount: 0 };
describe("capital reduction valuation helpers", () => {
  it("later sale: replay remaining shares → value 442 instead of original 542", () => {
    const { store, action, trade } = fixture();
    store.accounting.facts.tradeEvents.push({ ...trade, id: "later-sale", type: "SELL", quantity: 100, unitPrice: 60, tradeDate: "2026-02-08" });
    expect(buildCapitalReductionValuation(store, action, "2026-02-09", { price: 60, date: "2026-02-09" })).toMatchObject({ status: "MARKET", deliveredShareValue: 26520, totalAssetValue: 31101 });
  });
  it("partial receipt: dated gross 2000 → remaining receivable 2579", () => {
    const { action, input } = fixture();
    input.repaymentReceipts.push({ id: "partial", evidenceReference: "synthetic-credit", receivedDate: "2026-02-10", grossAmount: 2000, cashAmount: 1995, feeAmount: 5 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-09")).toMatchObject({ receivable: 4579, cash: 0, fees: 0 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-10")).toMatchObject({ receivable: 2579, cash: 1995, fees: 5 });
  });
  it("bank deduction: later classification → no duplicate cash", () => {
    const { action, input } = fixture();
    input.repaymentReceipts.push({ id: "credit", evidenceReference: "synthetic-credit", receivedDate: "2026-02-10", grossAmount: 4574, cashAmount: 4574, feeAmount: 0 }, { id: "fee", evidenceReference: "synthetic-fee", receivedDate: "2026-02-11", grossAmount: 5, cashAmount: 0, feeAmount: 5 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-10")).toMatchObject({ receivable: 5, cash: 4574, fees: 0 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-11")).toMatchObject({ receivable: 0, cash: 4574, fees: 5 });
  });
  it("suspension: carry prior value → original quote date without conversion assets", () => {
    const { action } = fixture();
    expect(capitalReductionValuation(action, "2026-02-04", { remainingQuantity: 1000, preConversion: { price: 31, date: "2026-01-30", value: 31000 }, quote: { price: 56.7, date: "2026-02-06" } })).toMatchObject({ status: "SUSPENDED", deliveredShareValue: 31000, valuationDate: "2026-01-30", repaymentReceivableValue: 0, pendingFractionValue: 0, totalAssetValue: 31000 });
  });
  it("new-share basis: reject old and future quotes → reference then matching quote", () => {
    const { action } = fixture();
    for (const date of ["2026-01-30", "2026-02-20"]) expect(capitalReductionValuation(action, "2026-02-09", { remainingQuantity: 442, quote: { price: 31, date } })).toMatchObject({ status: "OFFICIAL_REFERENCE", deliveredShareValue: 25061.4 });
    expect(capitalReductionValuation(action, "2026-02-09", { remainingQuantity: 442, quote: { price: 60, date: "2026-02-09" } }).status).toBe("MARKET");
  });
  it("effective timestamp: earlier same-day quote → cannot price converted shares", () => {
    const { action, input } = fixture(); input.announcement.conversionTimestamp = "2026-02-06T04:00:00Z";
    expect(capitalReductionValuation(action, "2026-02-06T05:00:00Z", { remainingQuantity: 542, quote: { price: 31, date: "2026-02-06T03:00:00Z" } }).status).toBe("OFFICIAL_REFERENCE");
    expect(capitalReductionValuation(action, "2026-02-06T03:00:00Z", { remainingQuantity: 1000, preConversion: { value: 31000, date: "2026-01-30", price: 31 } })).toMatchObject({ repaymentReceivableValue: 0, pendingFractionValue: 0, status: "SUSPENDED" });
  });
  it("pending fraction: confirmation then fee payment → gross result and fee only once", () => {
    const { action, input } = fixture(); input.fractionSettlement = { ...settlement };
    input.fractionAdjustments = [{ id: "payment", evidenceReference: "synthetic-payment", occurredDate: "2026-02-13", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 0, feeCashPaidAmount: 1 }];
    expect(capitalReductionComponentsAtDate(action, "2026-02-11")).toMatchObject({ pendingValue: 2, fractionalResult: 0, fees: 0, cash: 0 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-12")).toMatchObject({ pendingValue: 0, settledCost: 2.31, fractionalResult: -0.31, fees: 3, cash: 0, unpaidFees: 1 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-13")).toMatchObject({ fractionalResult: -0.31, fees: 3, cash: -1, unpaidFees: 0 });
  });
  it("unpaid fractional proceeds: later deposit → owned asset transferred once", () => {
    const { action, input } = fixture(); input.fractionSettlement = { ...settlement, processingFeeAmount: 0, feeOffsetAmount: 0 };
    input.fractionAdjustments = [{ id: "deposit", evidenceReference: "synthetic-deposit", occurredDate: "2026-02-14", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 2, feeCashPaidAmount: 0 }];
    expect(capitalReductionComponentsAtDate(action, "2026-02-12")).toMatchObject({ unpaidProceeds: 2, cash: 0, fractionalResult: -0.31 });
    expect(capitalReductionComponentsAtDate(action, "2026-02-14")).toMatchObject({ unpaidProceeds: 0, cash: 2, fractionalResult: -0.31 });
  });
  it("zero whole and missing fraction formula: zero delivered value → incomplete fraction", () => {
    const { action } = fixture(); action.calculation.wholeQuantity = 0; action.calculation.estimatedFractionAmount = null;
    expect(capitalReductionValuation(action, "2026-02-09", { remainingQuantity: 0 })).toMatchObject({ deliveredShareValue: 0, pendingFractionValue: null, totalAssetValue: null });
    action.calculation.fractionalQuantity = "0";
    expect(capitalReductionValuation(action, "2026-02-09", { remainingQuantity: 0 })).toMatchObject({ deliveredShareValue: 0, pendingFractionValue: 0, totalAssetValue: 4579 });
  });
  it("failed generation: assets visible → affected return completeness withheld", () => {
    const { store, action } = fixture(); action.generation.status = "failed";
    expect(buildCapitalReductionPortfolioSummary(store, [], "2026-02-09")).toMatchObject({ outstandingRepaymentAmount: 4579, pendingFractionValueAmount: 2, navAmount: 35312.4, generationStatus: "failed", returnsComplete: false });
    expect(capitalReductionEffectsAtDate(store, "2026-02-05")).toMatchObject({ repayments: 0, receivable: 0, pendingValue: 0, fees: 0 });
  });
  it("account scope: unrelated actions and cash → excluded from summary", () => {
    const { store, action } = fixture(); store.accounting.facts.capitalReductions!.actions.push({ ...action, id: "other-action", accountId: "other-account" });
    store.accounting.facts.cashLedgerEntries.push({ id: "other-cash", userId: "other-user", accountId: "other-account", entryDate: "2026-02-01", amount: 9999, currency: "TWD", source: "manual", entryType: "MANUAL_ADJUSTMENT" });
    expect(buildCapitalReductionPortfolioSummary(store, [], "2026-02-09")).toMatchObject({ outstandingRepaymentAmount: 4579, cashBalanceAmount: 0 });
  });
  it("real bar loading: suspension → original pre-suspension value and date", async () => {
    const { store, action } = fixture();
    const persistence = { getDailyBarsForTickerMarket: async () => [bar("2026-01-30", 31), bar("2026-02-06", 56.7)] } as unknown as Persistence;
    expect((await loadCapitalReductionValuations(store, persistence, "2026-02-04")).get(action.id)).toMatchObject({ status: "SUSPENDED", valuationDate: "2026-01-30", deliveredShareValue: 31000 });
  });
  it("historical source walker: suspension, conversion, sale and component dates → correct stock snapshots", () => {
    const { action, input, trade, store } = fixture();
    input.repaymentReceipts = [{ id: "partial", evidenceReference: "synthetic-credit", receivedDate: "2026-02-10", grossAmount: 2000, cashAmount: 1995, feeAmount: 5 }];
    input.fractionSettlement = { ...settlement };
    input.fractionAdjustments = [{ id: "payment", evidenceReference: "synthetic-payment", occurredDate: "2026-02-13", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 0, feeCashPaidAmount: 1 }];
    const rows = walkPositionHistory({ userId: "user-1", accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", trades: [trade, { ...trade, id: "sell", type: "SELL", quantity: 100, unitPrice: 60, tradeDate: "2026-02-09" }], positionActions: store.accounting.facts.positionActions, capitalReductions: [action], dividends: [], bars: [bar("2026-01-30", 31), bar("2026-02-09", 60)], generationRunId: "synthetic-run", generatedAt: "2026-02-14T00:00:00Z", fromDate: null });
    expect(rows.find((row) => row.snapshotDate === "2026-02-04")).toMatchObject({ quantity: 1000, valueNative: 31000, providerSource: "capital_reduction:suspended:2026-01-30", cumulativeDividends: 0, cumulativeRealizedPnl: 0 });
    expect(rows.find((row) => row.snapshotDate === "2026-02-06")).toMatchObject({ quantity: 542, closePrice: 56.7, valueNative: 30731.4, costBasisNative: 25418.69 });
    expect(rows.find((row) => row.snapshotDate === "2026-02-10")).toMatchObject({ quantity: 442, valueNative: 26520, costBasisNative: 20728.89 });
    expect(468980 + Math.round(rows.find((row) => row.snapshotDate === "2026-02-10")!.costBasisNative * 100)).toBe(2541869);
    expect(rows.find((row) => row.snapshotDate === "2026-02-12")).toBeDefined();
    expect(rows.find((row) => row.snapshotDate === "2026-02-13")).toBeDefined();
  });

  it("performance replay: pending fraction then fee settlement/payment → net return changes only on fee recognition", async () => {
    const { store, action, input, trade } = fixture();
    store.accounting.facts.tradeEvents.push({ ...trade, id: "sell", type: "SELL", quantity: 100, unitPrice: 60, tradeDate: "2026-02-09", realizedPnlAmount: 1310.2, realizedPnlCurrency: "TWD" });
    store.accounting.projections.lotAllocations = [{ id: "allocation", userId: "user-1", accountId: "acc-1", tradeEventId: "sell", ticker: "SYNTH", lotId: "lot-buy", lotOpenedAt: "2026-01-02", lotOpenedSequence: 1, allocatedQuantity: 100, allocatedCostAmount: 4689.8, costCurrency: "TWD" }];
    input.fractionSettlement = { ...settlement };
    input.fractionAdjustments = [{ id: "payment", evidenceReference: "synthetic-payment", occurredDate: "2026-02-13", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 0, feeCashPaidAmount: 1 }];
    const dates = ["2026-02-11", "2026-02-12", "2026-02-13"];
    const points: AggregatedSnapshotPoint[] = dates.map((date) => ({ date, totalCostBasis: 20728.89, totalMarketValue: 26520, totalUnrealizedPnl: 5791.11, cumulativeRealizedPnl: 1310.2, cumulativeDividends: 0, totalReturnAmount: 7101.31, totalReturnPercent: 1, fxAvailable: true, isProvisional: false, snapshotContributorKeys: ["acc-1:TW:SYNTH"] }));
    const persistence = { getAggregatedSnapshotsInReportingCurrency: async () => points } as unknown as Persistence;
    const keys = new Map(dates.map((date) => [date, new Set(["acc-1:TW:SYNTH"])]));
    const result = await translatePerformancePoints("user-1", "1M", "2026-02-13", "TWD", persistence, store, [], { expectedContributorKeysByDate: keys, strictExpectedContributorKeysByDate: keys });
    expect(result.points.map((point) => point.totalReturnAmount)).toEqual([7101, 7098, 7098]);
    expect(result.points.map((point) => point.cumulativeDividendsAmount)).toEqual([0, 0, 0]);
    action.generation.status = "failed";
    expect((await translatePerformancePoints("user-1", "1M", "2026-02-13", "TWD", persistence, store, [], { expectedContributorKeysByDate: keys, strictExpectedContributorKeysByDate: keys })).points.every((point) => point.totalReturnAmount === null)).toBe(true);
  });

  it("registered announcement before conversion: suspension carry → no premature financial action or receivable", async () => {
    const { store, input } = fixture();
    store.accounting.facts.capitalReductions!.actions = []; store.accounting.facts.positionActions = [];
    store.accounting.projections.holdings[0] = { accountId: "acc-1", ticker: "SYNTH", quantity: 1000, costBasisAmount: 30000, currency: "TWD" };
    const persistence = { getDailyBarsForTickerMarket: async () => [bar("2026-01-30", 31)] } as unknown as Persistence;
    const valuations = await loadCapitalReductionValuations(store, persistence, "2026-02-04");
    store.accounting.facts.capitalReductions!.announcementGenerations = [{ accountId: "acc-1", eventId: input.announcement.eventId, version: 1, generation: { status: "failed", fromDate: "2026-02-02", updatedAt: "2026-02-04T00:00:00Z", retryable: true } }];
    expect(valuations.get(registeredCapitalReductionValuationKey("acc-1", input.announcement))).toMatchObject({ status: "SUSPENDED", deliveredShareValue: 31000, valuationDate: "2026-01-30", repaymentReceivableValue: 0, pendingFractionValue: 0 });
    expect(buildCapitalReductionPortfolioSummary(store, [], "2026-02-04", valuations)).toMatchObject({ outstandingRepaymentAmount: 0, pendingFractionValueAmount: 0, deliveredStockValueAmount: 31000, navAmount: 31000, generationStatus: "failed", returnsComplete: false });
    const due = await loadCapitalReductionValuations(store, persistence, "2026-02-06");
    expect(due.get(registeredCapitalReductionValuationKey("acc-1", input.announcement))).toMatchObject({ status: "INCOMPLETE", deliveredShareValue: null, repaymentReceivableValue: 0 });
  });
  it("registered announcement snapshot: no financial posting → preserve old shares and dated suspension value", () => {
    const { trade, input } = fixture();
    const rows = walkPositionHistory({ userId: "user-1", accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", trades: [trade], positionActions: [], capitalReductions: [], capitalReductionAnnouncements: [input.announcement], dividends: [], bars: [bar("2026-01-30", 31), bar("2026-02-06", 56.7)], generationRunId: "synthetic-run", generatedAt: "2026-02-07T00:00:00Z", fromDate: null });
    expect(rows.find((row) => row.snapshotDate === "2026-02-04")).toMatchObject({ quantity: 1000, costBasisNative: 30000, valueNative: 31000, providerSource: "capital_reduction:suspended:2026-01-30" });
    expect(rows.find((row) => row.snapshotDate === "2026-02-06")).toMatchObject({ quantity: 1000, costBasisNative: 30000, valueNative: null, isProvisional: true });
  });

  it("offset timestamp: same Taiwan conversion instant → compare instants instead of strings", () => {
    const { action, input } = fixture(); input.announcement.conversionTimestamp = "2026-02-06T00:00:00+08:00";
    expect(capitalReductionValuation(action, "2026-02-05T17:00:00Z", { remainingQuantity: 542, quote: { price: 60, date: "2026-02-06T00:30:00+08:00" } })).toMatchObject({ status: "MARKET", repaymentReceivableValue: 4579, deliveredShareValue: 32520 });
  });
  it("no matching quote and no official reference: required share value → incomplete total", () => {
    const { action, input } = fixture(); delete input.announcement.officialReferencePrice;
    expect(capitalReductionValuation(action, "2026-02-09", { remainingQuantity: 442, quote: { price: 31, date: "2026-01-30" } })).toMatchObject({ status: "INCOMPLETE", deliveredShareValue: null, totalAssetValue: null });
  });
  it("NAV partial receipt: actual cash ledger date → fee reduces assets once", () => {
    const { store, input } = fixture();
    input.repaymentReceipts = [{ id: "receipt", evidenceReference: "synthetic-receipt", receivedDate: "2026-02-10", grossAmount: 2000, cashAmount: 1995, feeAmount: 5 }];
    store.accounting.facts.cashLedgerEntries = [{ id: "cash", userId: "user-1", accountId: "acc-1", entryDate: "2026-02-10", entryType: "MANUAL_ADJUSTMENT", source: "capital_repayment", amount: 1995, currency: "TWD" }];
    expect(buildCapitalReductionPortfolioSummary(store, [], "2026-02-09")).toMatchObject({ navAmount: 35312.4, cashBalanceAmount: 0 });
    expect(buildCapitalReductionPortfolioSummary(store, [], "2026-02-10")).toMatchObject({ navAmount: 35307.4, outstandingRepaymentAmount: 2579, cashBalanceAmount: 1995, confirmedFeeAmount: 5 });
  });

  it("recurring rational entitlement: pending one third → retain estimate without Number coercion", () => {
    const { action } = fixture(); action.calculation.fractionalQuantity = "1/3"; action.calculation.estimatedFractionAmount = 18; action.calculation.fractionalCostAmount = 30;
    expect(capitalReductionComponentsAtDate(action, "2026-02-09")).toMatchObject({ pendingValue: 18, pendingCost: 30, fractionalResult: 0 });
  });

  it("dashboard stale old-basis quote: new-share daily valuation → cannot reuse old quote changes or date", () => {
    const { store, action } = fixture();
    const current = buildCapitalReductionValuation(store, action, "2026-02-09", { price: 60, date: "2026-02-09" });
    const overview = buildDashboardOverview(store, { integrityIssue: null, summaryAsOf: "2026-02-09", capitalReductionValuations: new Map([[action.id, current]]), quotes: [{ ticker: "SYNTH", marketCode: "TW", asOf: "2026-01-30", close: 31, change: 1, changePercent: 3.33, previousClose: 30, isProvisional: false, source: "synthetic" }] });
    expect(overview.holdings[0]).toMatchObject({ currentUnitPrice: 60, marketValueAmount: 32520, change: null, changePercent: null, capitalReductionValuation: { status: "MARKET", valuationDate: "2026-02-09" }, priceState: { asOfDate: "2026-02-09" } });
  });

});
