import { roundToDecimal } from "@vakwen/domain";
import type { AccountCapitalReductionDto, CapitalReductionAnnouncementDto, CapitalReductionValuationDto } from "@vakwen/shared-types";
import type { Persistence } from "../persistence/types.js";
import type { Store } from "../types/store.js";
import { buildReplayLotsBeforeBoundary } from "./replayPositionHistory.js";

export interface CapitalReductionQuote { price: number; date: string }
export interface CapitalReductionValuationContext {
  remainingQuantity?: number;
  quote?: CapitalReductionQuote;
  preConversion?: { value: number; date: string; price?: number };
}
/** Event calendar dates belong to the Taiwan exchange, regardless of timestamp offset. */
export function capitalReductionAsOfDate(asOf: string): string {
  return asOf.length === 10 ? asOf : new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(asOf));
}

export function capitalReductionInput(action: AccountCapitalReductionDto) {
  // Amendments explicitly restate history at source effective dates; confirmation time
  // is audit metadata, never the recognition date of conversion or settlement.
  return action.revisions[action.revisions.length - 1].input;
}
export function capitalReductionIsEffective(action: AccountCapitalReductionDto, asOf: string): boolean {
  const terms = capitalReductionInput(action).announcement;
  return action.status === "POSTED" && terms.conversionDate <= capitalReductionAsOfDate(asOf)
    && (asOf.length === 10 || !terms.conversionTimestamp || Date.parse(terms.conversionTimestamp) <= Date.parse(asOf));
}
export function capitalReductionComponentsAtDate(action: AccountCapitalReductionDto, asOf: string) {
  const input = capitalReductionInput(action), calculation = action.calculation;
  const zero = { repayment: 0, receivable: 0, pendingCost: 0, pendingValue: 0 as number | null, settledCost: 0, fractionalResult: 0, fees: 0, unpaidFees: 0, unpaidProceeds: 0, cash: 0, unresolvedFees: false };
  if (!capitalReductionIsEffective(action, asOf)) return zero;
  const date = capitalReductionAsOfDate(asOf);
  const receipts = input.repaymentReceipts.filter((row) => row.receivedDate <= date);
  const settlement = input.fractionSettlement && input.fractionSettlement.receivedDate <= date ? input.fractionSettlement : undefined;
  const adjustments = settlement ? (input.fractionAdjustments ?? []).filter((row) => row.occurredDate <= date) : [];
  const sum = (field: "processingFeeAmount" | "feeOffsetAmount" | "cashAmount" | "feeCashPaidAmount") =>
    (settlement?.[field] ?? 0) + adjustments.reduce((total, row) => total + row[field], 0);
  const pending = !settlement && calculation.fractionalQuantity !== "0";
  return {
    repayment: calculation.grossRepaymentAmount,
    receivable: roundToDecimal(calculation.grossRepaymentAmount - receipts.reduce((total, row) => total + row.grossAmount, 0), 2),
    pendingCost: pending ? calculation.fractionalCostAmount : 0,
    pendingValue: pending ? calculation.estimatedFractionAmount : 0,
    settledCost: settlement ? calculation.fractionalCostAmount : 0,
    fractionalResult: settlement ? roundToDecimal(settlement.grossAmount - calculation.fractionalCostAmount, 2) : 0,
    fees: roundToDecimal(receipts.reduce((total, row) => total + row.feeAmount, 0) + sum("processingFeeAmount"), 2),
    unpaidFees: roundToDecimal(sum("processingFeeAmount") - sum("feeOffsetAmount") - sum("feeCashPaidAmount"), 2),
    unpaidProceeds: roundToDecimal((settlement?.grossAmount ?? 0) - sum("feeOffsetAmount") - sum("cashAmount"), 2),
    cash: roundToDecimal(receipts.reduce((total, row) => total + row.cashAmount, 0) + sum("cashAmount") - sum("feeCashPaidAmount"), 2),
    unresolvedFees: pending || sum("processingFeeAmount") > sum("feeOffsetAmount") + sum("feeCashPaidAmount"),
  };
}

export function capitalReductionValuation(
  action: AccountCapitalReductionDto,
  asOf = capitalReductionAsOfDate(new Date().toISOString()),
  context: CapitalReductionValuationContext = {},
): CapitalReductionValuationDto {
  const terms = capitalReductionInput(action).announcement, date = capitalReductionAsOfDate(asOf);
  const effective = capitalReductionIsEffective(action, asOf);
  const effects = capitalReductionComponentsAtDate(action, asOf);
  const suspended = action.status === "POSTED" && date >= terms.suspensionStartDate && !effective;
  const quote = context.quote;
  const bounded = quote && Number.isFinite(quote.price) && quote.price >= 0 && capitalReductionAsOfDate(quote.date) <= date
    && (asOf.length === 10 || (quote.date.length === 10 ? quote.date < date : Date.parse(quote.date) <= Date.parse(asOf)));
  const matching = bounded && (!effective || (capitalReductionAsOfDate(quote.date) >= terms.conversionDate
    && (!terms.conversionTimestamp || (quote.date.length > 10 && Date.parse(quote.date) >= Date.parse(terms.conversionTimestamp)) || capitalReductionAsOfDate(quote.date) > terms.conversionDate || (quote.date.length === 10 && asOf.length === 10))));
  const reference = effective && terms.officialReferencePrice !== undefined ? Number(terms.officialReferencePrice) : null;
  const price = suspended ? context.preConversion?.price ?? null : matching ? quote.price : reference !== null && Number.isFinite(reference) && reference >= 0 ? reference : null;
  // A missing quantity context must not silently reuse the original entitlement after sales.
  const quantity = context.remainingQuantity;
  const delivered = suspended ? context.preConversion?.value ?? null : quantity === 0 ? 0 : price !== null && quantity !== undefined ? roundToDecimal(price * quantity, 2) : null;
  const status = suspended ? "SUSPENDED" : matching ? "MARKET" : effective && price !== null ? "OFFICIAL_REFERENCE" : "INCOMPLETE";
  return {
    status,
    valuationDate: suspended ? context.preConversion?.date ?? null : matching ? quote.date : price !== null ? terms.conversionDate : null,
    sharePrice: price,
    deliveredShareValue: delivered,
    repaymentReceivableValue: effects.receivable,
    pendingFractionValue: effects.pendingValue,
    totalAssetValue: delivered === null || effects.pendingValue === null ? null : roundToDecimal(delivered + effects.receivable + effects.pendingValue + effects.unpaidProceeds - effects.unpaidFees, 2),
    unresolvedFees: effects.unresolvedFees,
  };
}

export function capitalReductionLotsAtDate(store: Store, accountId: string, ticker: string, asOf: string) {
  const trades = store.accounting.facts.tradeEvents.filter((row) => row.accountId === accountId && row.ticker === ticker && row.marketCode === "TW");
  const actions = store.accounting.facts.positionActions.filter((row) => row.accountId === accountId && row.ticker === ticker && row.marketCode === "TW");
  if (asOf.length > 10) return buildReplayLotsBeforeBoundary(trades, actions, { tradeDate: capitalReductionAsOfDate(asOf), tradeTimestamp: new Date(asOf).toISOString() });
  const tomorrow = new Date(`${asOf}T00:00:00Z`); tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return buildReplayLotsBeforeBoundary(trades, actions, { tradeDate: tomorrow.toISOString().slice(0, 10) });
}
export function buildCapitalReductionValuation(store: Store, action: AccountCapitalReductionDto, asOf: string, quote?: CapitalReductionQuote, preConversion?: CapitalReductionValuationContext["preConversion"]) {
  const remainingQuantity = capitalReductionLotsAtDate(store, action.accountId, action.ticker, asOf).reduce((sum, lot) => sum + lot.openQuantity, 0);
  return capitalReductionValuation(action, asOf, { remainingQuantity, quote, preConversion });
}

export async function loadCapitalReductionValuations(store: Store, persistence: Pick<Persistence, "getDailyBarsForTickerMarket">, asOf = capitalReductionAsOfDate(new Date().toISOString())): Promise<Map<string, CapitalReductionValuationDto>> {
  const result = new Map<string, CapitalReductionValuationDto>();
  const barsByTicker = new Map<string, Awaited<ReturnType<Persistence["getDailyBarsForTickerMarket"]>>>();
  const accountIds = new Set(store.accounts.map((row) => row.id));
  for (const action of store.accounting.facts.capitalReductions?.actions ?? []) {
    if (action.status !== "POSTED" || !accountIds.has(action.accountId)) continue;
    const terms = capitalReductionInput(action).announcement;
    let bars = barsByTicker.get(action.ticker);
    if (!bars) {
      const first = store.accounting.facts.tradeEvents.filter((row) => accountIds.has(row.accountId) && row.ticker === action.ticker && row.marketCode === "TW").map((row) => row.tradeDate).sort()[0] ?? terms.suspensionStartDate;
      bars = await persistence.getDailyBarsForTickerMarket(action.ticker, "TW", first, capitalReductionAsOfDate(asOf));
      barsByTicker.set(action.ticker, bars);
    }
    const quoteBar = bars.filter((row) => row.barDate <= capitalReductionAsOfDate(asOf)).sort((a, b) => b.barDate.localeCompare(a.barDate))[0];
    const preBar = bars.filter((row) => row.barDate < terms.suspensionStartDate && row.barDate < terms.conversionDate).sort((a, b) => b.barDate.localeCompare(a.barDate))[0];
    const preQuantity = preBar ? capitalReductionLotsAtDate(store, action.accountId, action.ticker, preBar.barDate).reduce((sum, lot) => sum + lot.openQuantity, 0) : 0;
    result.set(action.id, buildCapitalReductionValuation(store, action, asOf,
      quoteBar ? { price: quoteBar.close, date: quoteBar.barDate } : undefined,
      preBar ? { price: preBar.close, date: preBar.barDate, value: roundToDecimal(preQuantity * preBar.close, 2) } : undefined));
  }
  for (const announcement of store.accounting.facts.capitalReductions?.announcements ?? []) {
    if (announcement.suspensionStartDate > capitalReductionAsOfDate(asOf)) continue;
    const accounts = store.accounts.filter((account) => store.accounting.facts.tradeEvents.some((row) => row.accountId === account.id && row.ticker === announcement.ticker && row.marketCode === "TW"));
    for (const account of accounts) {
      if (store.accounting.facts.capitalReductions?.actions.some((row) => row.accountId === account.id && row.eventId === announcement.eventId && row.status === "POSTED")) continue;
      let bars = barsByTicker.get(announcement.ticker);
      if (!bars) {
        const first = store.accounting.facts.tradeEvents.filter((row) => accountIds.has(row.accountId) && row.ticker === announcement.ticker && row.marketCode === "TW").map((row) => row.tradeDate).sort()[0] ?? announcement.suspensionStartDate;
        bars = await persistence.getDailyBarsForTickerMarket(announcement.ticker, "TW", first, capitalReductionAsOfDate(asOf));
        barsByTicker.set(announcement.ticker, bars);
      }
      const preBar = bars.filter((row) => row.barDate < announcement.suspensionStartDate && row.barDate < announcement.conversionDate).sort((a, b) => b.barDate.localeCompare(a.barDate))[0];
      const quantity = preBar ? capitalReductionLotsAtDate(store, account.id, announcement.ticker, preBar.barDate).reduce((sum, lot) => sum + lot.openQuantity, 0) : 0;
      result.set(registeredCapitalReductionValuationKey(account.id, announcement), registeredCapitalReductionValuation(announcement, asOf, preBar ? { price: preBar.close, date: preBar.barDate, value: roundToDecimal(quantity * preBar.close, 2) } : undefined));
    }
  }
  return result;
}

export function registeredCapitalReductionValuationKey(accountId: string, announcement: CapitalReductionAnnouncementDto): string {
  return `${accountId}:${announcement.eventId}:${announcement.version}`;
}
export function registeredCapitalReductionValuation(announcement: CapitalReductionAnnouncementDto, asOf: string, preConversion?: CapitalReductionValuationContext["preConversion"]): CapitalReductionValuationDto {
  // Public terms establish a suspension, never an account conversion or receivable.
  // Once conversion is due, withhold old-quantity/new-price mixtures until posting.
  const converted = announcement.conversionDate <= capitalReductionAsOfDate(asOf) && (asOf.length === 10 || !announcement.conversionTimestamp || Date.parse(announcement.conversionTimestamp) <= Date.parse(asOf));
  return {
    status: converted ? "INCOMPLETE" : "SUSPENDED", valuationDate: converted ? null : preConversion?.date ?? null,
    sharePrice: converted ? null : preConversion?.price ?? null, deliveredShareValue: converted ? null : preConversion?.value ?? null,
    repaymentReceivableValue: 0, pendingFractionValue: 0, totalAssetValue: converted ? null : preConversion?.value ?? null, unresolvedFees: false,
  };
}

/** A report group can span accounts; retain every affected account's value. */
export function aggregateCapitalReductionValuations(values: ReadonlyArray<CapitalReductionValuationDto>): CapitalReductionValuationDto | undefined {
  if (values.length === 0) return undefined;
  const sum = (field: "deliveredShareValue" | "pendingFractionValue" | "totalAssetValue") => values.some((row) => row[field] === null) ? null : roundToDecimal(values.reduce((total, row) => total + (row[field] ?? 0), 0), 2);
  const status = values.some((row) => row.status === "INCOMPLETE") ? "INCOMPLETE" : values.some((row) => row.status === "SUSPENDED") ? "SUSPENDED" : values.some((row) => row.status === "OFFICIAL_REFERENCE") ? "OFFICIAL_REFERENCE" : "MARKET";
  return {
    status,
    valuationDate: values.some((row) => row.valuationDate === null) ? null : values.map((row) => row.valuationDate!).sort()[0],
    sharePrice: values.every((row) => row.sharePrice === values[0].sharePrice) ? values[0].sharePrice : null,
    deliveredShareValue: sum("deliveredShareValue"), repaymentReceivableValue: roundToDecimal(values.reduce((total, row) => total + row.repaymentReceivableValue, 0), 2), pendingFractionValue: sum("pendingFractionValue"), totalAssetValue: sum("totalAssetValue"), unresolvedFees: values.some((row) => row.unresolvedFees),
  };
}
