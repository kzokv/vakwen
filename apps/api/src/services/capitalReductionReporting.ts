import { roundToDecimal, type QuoteSnapshot } from "@vakwen/domain";
import type { AccountCapitalReductionDto, CapitalReductionAnnouncementDto, CapitalReductionGenerationDto, CapitalReductionPortfolioSummaryDto, CapitalReductionValuationDto } from "@vakwen/shared-types";
import type { Store } from "../types/store.js";
import { buildCapitalReductionValuation, capitalReductionComponentsAtDate, capitalReductionInput, capitalReductionIsEffective, capitalReductionAsOfDate, registeredCapitalReductionValuation, registeredCapitalReductionValuationKey } from "./capitalReductionValuation.js";

export function selectCapitalReductionAction(store: Store, accountId: string, ticker: string, date: string): AccountCapitalReductionDto | undefined {
  const actions = (store.accounting?.facts?.capitalReductions?.actions ?? []).filter((row) => row.status === "POSTED" && row.accountId === accountId && row.ticker === ticker);
  const converted = actions.filter((row) => capitalReductionIsEffective(row, date)).sort((a, b) => capitalReductionInput(b).announcement.conversionDate.localeCompare(capitalReductionInput(a).announcement.conversionDate));
  return converted[0] ?? actions.filter((row) => capitalReductionInput(row).announcement.suspensionStartDate <= capitalReductionAsOfDate(date)).sort((a, b) => capitalReductionInput(a).announcement.conversionDate.localeCompare(capitalReductionInput(b).announcement.conversionDate))[0];
}

export function selectRegisteredCapitalReductionAnnouncement(store: Store, accountId: string, ticker: string, date: string): CapitalReductionAnnouncementDto | undefined {
  const facts = store.accounting.facts.capitalReductions;
  return facts?.announcements.filter((announcement) => announcement.ticker === ticker && announcement.suspensionStartDate <= capitalReductionAsOfDate(date)
    && !facts.actions.some((action) => action.status === "POSTED" && action.accountId === accountId && action.eventId === announcement.eventId))
    .sort((a, b) => b.suspensionStartDate.localeCompare(a.suspensionStartDate) || b.version - a.version)[0];
}

export function capitalReductionGenerationStates(store: Store, date: string): CapitalReductionGenerationDto[] {
  const facts = store.accounting?.facts?.capitalReductions;
  if (!facts) return [];
  const accounts = new Set((store.accounts ?? []).map((row) => row.id));
  const states = facts.actions.filter((row) => accounts.has(row.accountId) && row.generation.fromDate <= capitalReductionAsOfDate(date)).map((row) => row.generation);
  for (const row of facts.announcementGenerations ?? []) {
    if (!accounts.has(row.accountId) || row.generation.fromDate > capitalReductionAsOfDate(date)) continue;
    if (facts.actions.some((action) => action.status === "POSTED" && action.accountId === row.accountId && action.eventId === row.eventId)) continue;
    const latestVersion = Math.max(...facts.announcements.filter((announcement) => announcement.eventId === row.eventId).map((announcement) => announcement.version));
    if (row.version === latestVersion) states.push(row.generation);
  }
  return states;
}

/** Reconstruct each component at its effective date, including later classifications/payments. */
export function capitalReductionEffectsAtDate(store: Store, date: string) {
  let repayments = 0, receivable = 0, pendingCost = 0, pendingValue = 0, settledCost = 0, fractionalResult = 0, fees = 0, unpaidFees = 0, unpaidProceeds = 0;
  let complete = true;
  const generationCurrent = capitalReductionGenerationStates(store, date).every((row) => row.status === "current");
  const accountIds = new Set((store.accounts ?? []).map((row) => row.id));
  for (const action of store.accounting?.facts?.capitalReductions?.actions ?? []) {
    if (!accountIds.has(action.accountId)) continue;
    if (!capitalReductionIsEffective(action, date)) continue;
    const effects = capitalReductionComponentsAtDate(action, date);
    repayments += effects.repayment; receivable += effects.receivable; pendingCost += effects.pendingCost;
    settledCost += effects.settledCost; fractionalResult += effects.fractionalResult; fees += effects.fees;
    unpaidFees += effects.unpaidFees; unpaidProceeds += effects.unpaidProceeds;
    if (effects.pendingValue === null) complete = false;
    else pendingValue += effects.pendingValue;
  }
  return {
    repayments: roundToDecimal(repayments, 2), receivable: roundToDecimal(receivable, 2), pendingCost: roundToDecimal(pendingCost, 2), pendingValue: complete ? roundToDecimal(pendingValue, 2) : null,
    settledCost: roundToDecimal(settledCost, 2), fractionalResult: roundToDecimal(fractionalResult, 2), fees: roundToDecimal(fees, 2), unpaidFees: roundToDecimal(unpaidFees, 2), unpaidProceeds: roundToDecimal(unpaidProceeds, 2), complete, generationCurrent,
  };
}
export function buildCapitalReductionPortfolioSummary(
  store: Store,
  quotes: ReadonlyArray<QuoteSnapshot>,
  date = capitalReductionAsOfDate(new Date().toISOString()),
  valuations?: ReadonlyMap<string, CapitalReductionValuationDto>,
): CapitalReductionPortfolioSummaryDto | undefined {
  const accountIds = new Set((store.accounts ?? []).map((row) => row.id));
  const actions = (store.accounting?.facts?.capitalReductions?.actions ?? []).filter((row) => accountIds.has(row.accountId));
  if (!actions.length && !store.accounting.facts.capitalReductions?.announcements.some((row) => row.suspensionStartDate <= capitalReductionAsOfDate(date))) return undefined;
  const scopedStore = { ...store, accounting: { ...store.accounting, facts: { ...store.accounting.facts, capitalReductions: { ...store.accounting.facts.capitalReductions!, actions } } } };
  const effects = capitalReductionEffectsAtDate(scopedStore, date);
  let stockValue = 0, complete = effects.complete;
  for (const holding of store.accounting.projections.holdings.filter((row) => row.currency === "TWD" && accountIds.has(row.accountId))) {
    const action = selectCapitalReductionAction(scopedStore, holding.accountId, holding.ticker, date);
    const quote = quotes.filter((row) => row.ticker === holding.ticker && (!row.marketCode || row.marketCode === "TW") && row.asOf.slice(0, 10) <= capitalReductionAsOfDate(date)).sort((a, b) => b.asOf.localeCompare(a.asOf))[0];
    const registered = selectRegisteredCapitalReductionAnnouncement(scopedStore, holding.accountId, holding.ticker, date);
    const registrationApplies = registered && (!action || registered.suspensionStartDate > capitalReductionInput(action).announcement.suspensionStartDate);
    const quoted = action && quote ? buildCapitalReductionValuation(store, action, date, { price: quote.close, date: quote.asOf }) : undefined;
    const valuation = action ? quoted?.status === "MARKET" ? quoted : valuations?.get(action.id) ?? quoted ?? buildCapitalReductionValuation(store, action, date) : undefined;
    const effectiveValuation = registrationApplies ? valuations?.get(registeredCapitalReductionValuationKey(holding.accountId, registered)) ?? registeredCapitalReductionValuation(registered, date) : valuation;
    const value = effectiveValuation ? effectiveValuation.deliveredShareValue : quote ? holding.quantity * quote.close : holding.quantity === 0 ? 0 : null;
    if (value === null) complete = false; else stockValue += value;
  }
  // Zero-whole entitlements have no holding row; their fraction/receivable remain in effects.
  const cash = roundToDecimal(store.accounting.facts.cashLedgerEntries.filter((row) => row.currency === "TWD" && accountIds.has(row.accountId) && row.entryDate <= capitalReductionAsOfDate(date)).reduce((sum, row) => sum + row.amount, 0), 2);
  const relevant = capitalReductionGenerationStates(scopedStore, date);
  const generation = relevant.find((row) => row.status === "failed")?.status ?? relevant.find((row) => row.status !== "current")?.status ?? "current";
  return {
    currency: "TWD", outstandingRepaymentAmount: effects.receivable, pendingFractionValueAmount: effects.pendingValue, pendingFractionCostAmount: effects.pendingCost,
    confirmedFeeAmount: effects.fees, fractionalRealizedAmount: effects.fractionalResult, outstandingFractionFeeAmount: effects.unpaidFees, outstandingFractionProceedsAmount: effects.unpaidProceeds, cashBalanceAmount: cash,
    deliveredStockValueAmount: complete ? roundToDecimal(stockValue, 2) : null,
    navAmount: complete && effects.pendingValue !== null ? roundToDecimal(stockValue + effects.receivable + effects.pendingValue + effects.unpaidProceeds + cash - effects.unpaidFees, 2) : null,
    valuationComplete: complete, generationStatus: generation, returnsComplete: complete && effects.generationCurrent,
  };
}
