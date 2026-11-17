import { randomUUID } from "node:crypto";
import { applyBuyToLots, allocateSellLots, roundToDecimal, type Lot } from "@vakwen/domain";
import { capitalReductionInput, capitalReductionValuation, registeredCapitalReductionValuation } from "./capitalReductionValuation.js";
import { applyPositionActionToLots, compareReplayEntries } from "./replayPositionHistory.js";
import type { PositionAction } from "../types/store.js";
import type { AccountCapitalReductionDto, CapitalReductionAnnouncementDto } from "@vakwen/shared-types";
import type { DailyBar, MarketCode } from "@vakwen/domain";
import type {
  Persistence,
  HoldingSnapshot,
  SnapshotDividendInput,
  SnapshotTradeInput,
} from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";

export interface SnapshotGenerationOptions {
  generationRunId?: string;
}

export interface SnapshotGenerationResult {
  totalRows: number;
  provisionalRows: number;
  dateRange: { from: string; to: string } | null;
  generationRunId: string;
  // KZO-185: walker emits (ticker, marketCode) pairs so producers can stamp
  // `marketCode` on enqueued backfill jobs without per-ticker resolution.
  // Same-ticker-different-market (e.g. BHP/AU + BHP/US in one user) surfaces
  // as two distinct entries because the Map key is composite.
  tickersNeedingBackfill: { ticker: string; marketCode: string }[];
}

/**
 * Generate holding snapshots for all (account, ticker) pairs.
 * Walks trade events chronologically per pair and joins with daily_bars
 * for close prices on each trading day.
 */
export async function generateHoldingSnapshots(
  userId: string,
  persistence: Persistence,
  options: SnapshotGenerationOptions = {},
): Promise<SnapshotGenerationResult> {
  const generationRunId = options.generationRunId ?? randomUUID();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Delete all existing snapshots for full regeneration
  await persistence.deleteAllHoldingSnapshots(userId);

  // Fetch only the inputs the walker needs — avoids loadStore's full blast radius.
  const inputs = await persistence.getSnapshotGenerationInputs(userId);

  // Group trades by (accountId, ticker, marketCode). Nested Map keeps the
  // account boundary explicit while the inner key prevents cross-listed tickers
  // from sharing price history or overwriting snapshots.
  const tradesByAccountTicker = groupTrades(inputs.trades);
  const dividendsByAccountTicker = groupDividends(inputs.postedDividends);

  // Batch-fetch daily bars for every unique (ticker, market) up-front to avoid
  // N+1 while preserving market identity.
  const uniquePairs = uniqueTickerMarketPairs(inputs.trades);
  const earliestTradeDate = inputs.trades.length > 0
    ? inputs.trades.reduce((min, t) => t.tradeDate < min ? t.tradeDate : min, inputs.trades[0].tradeDate)
    : today;
  const barsByTickerMarket = uniquePairs.length > 0
    ? await persistence.getDailyBarsForTickerMarkets(uniquePairs, earliestTradeDate, today)
    : new Map<string, DailyBar[]>();

  const allSnapshots: HoldingSnapshot[] = [];
  // KZO-185: composite key `${ticker}:${marketCode}` so cross-listed tickers
  // (BHP/AU + BHP/US in one user) surface as TWO distinct entries instead of
  // collapsing on `ticker`. Producers (snapshots/generate, recompute/confirm)
  // stamp `marketCode` on each enqueued backfill job from these entries.
  const tickersNeedingBackfill = new Map<string, { ticker: string; marketCode: string }>();

  for (const [accountId, byTicker] of tradesByAccountTicker) {
    for (const [pairKey, groupTrades] of byTicker) {
      // KZO-185: the (account, ticker) pair has a single marketCode by the
      // currency-coupling rule (walkPositionHistory enforces single
      // priceCurrency at line 193 below; marketCode tracks priceCurrency 1:1).
      const ticker = groupTrades[0].ticker;
      const marketCode = groupTrades[0].marketCode;
      const bars = barsByTickerMarket.get(pairKey) ?? [];
      const dividends = dividendsByAccountTicker.get(accountId)?.get(pairKey) ?? [];
      const compositeKey = `${ticker}:${marketCode}`;

      const snapshots = walkPositionHistory({
        userId,
        accountId,
        ticker,
        trades: groupTrades,
        marketCode,
        bars,
        dividends,
        positionActions: inputs.positionActions,
        capitalReductions: inputs.capitalReductions,
        capitalReductionAnnouncements: inputs.capitalReductionAnnouncements,
        generationRunId,
        generatedAt: now,
        fromDate: null,
      });

      for (const s of snapshots) {
        if (s.isProvisional) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode });
        allSnapshots.push(s);
      }

      // If the ticker has no bars at all, flag for backfill even when the
      // walker didn't emit a provisional row (e.g., no dates to walk).
      if (bars.length === 0) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode });
    }
  }

  if (allSnapshots.length > 0) {
    await persistence.bulkUpsertHoldingSnapshots(userId, allSnapshots);
  }

  const dates = allSnapshots.map(s => s.snapshotDate).sort();
  return {
    totalRows: allSnapshots.length,
    provisionalRows: allSnapshots.filter(s => s.isProvisional).length,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    generationRunId,
    tickersNeedingBackfill: [...tickersNeedingBackfill.values()],
  };
}

/**
 * Scoped recompute: delete snapshots for a specific (account, ticker) from
 * `fromDate`, then regenerate from that date forward. Position state is
 * rebuilt by walking all trades from the beginning so cumulative values at
 * `fromDate` are correct, but only snapshots on or after `fromDate` are
 * written back.
 */
export async function recomputeSnapshotsForTicker(
  userId: string,
  accountId: string,
  ticker: string,
  fromDate: string,
  persistence: Persistence,
  marketCode?: MarketCode,
): Promise<SnapshotGenerationResult> {
  const generationRunId = randomUUID();
  const now = new Date().toISOString();
  const today = now.slice(0, 10);

  // Delete existing snapshots from the affected date forward
  const inputs = await persistence.getSnapshotGenerationInputs(userId, { accountId, ticker, marketCode });
  const inputMarketCode = inputs.trades[0]?.marketCode ?? marketCode;
  await persistence.deleteHoldingSnapshotsForTicker(userId, accountId, ticker, fromDate, inputMarketCode);

  if (inputs.trades.length === 0) {
    return { totalRows: 0, provisionalRows: 0, dateRange: null, generationRunId, tickersNeedingBackfill: [] };
  }

  const scopedMarketCode = inputs.trades[0].marketCode;
  const firstTradeDate = inputs.trades[0].tradeDate;
  const bars = await persistence.getDailyBarsForTickerMarket(ticker, scopedMarketCode, firstTradeDate, today);

  const snapshots = walkPositionHistory({
    userId,
    accountId,
    ticker,
    trades: inputs.trades,
    marketCode: scopedMarketCode,
    bars,
    positionActions: inputs.positionActions,
    capitalReductions: inputs.capitalReductions,
        capitalReductionAnnouncements: inputs.capitalReductionAnnouncements,
    dividends: inputs.postedDividends.filter((dividend) => dividend.marketCode === scopedMarketCode),
    generationRunId,
    generatedAt: now,
    fromDate,
  });

  // KZO-185: composite-key Map mirrors the full-regen walker. We know
  // `inputs.trades.length > 0` from the early return above, so reading
  // `inputs.trades[0].marketCode` is safe.
  const compositeKey = `${ticker}:${scopedMarketCode}`;
  const tickersNeedingBackfill = new Map<string, { ticker: string; marketCode: string }>();
  if (bars.length === 0) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode: scopedMarketCode });
  for (const s of snapshots) {
    if (s.isProvisional) tickersNeedingBackfill.set(compositeKey, { ticker, marketCode: scopedMarketCode });
  }

  if (snapshots.length > 0) {
    await persistence.bulkUpsertHoldingSnapshots(userId, snapshots);
  }

  const dates = snapshots.map(s => s.snapshotDate).sort();
  return {
    totalRows: snapshots.length,
    provisionalRows: snapshots.filter(s => s.isProvisional).length,
    dateRange: dates.length > 0 ? { from: dates[0], to: dates[dates.length - 1] } : null,
    generationRunId,
    tickersNeedingBackfill: [...tickersNeedingBackfill.values()],
  };
}

// ── Walker ──────────────────────────────────────────────────────────────────

interface WalkerParams {
  userId: string;
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
  trades: SnapshotTradeInput[];
  bars: DailyBar[];
  dividends: SnapshotDividendInput[];
  positionActions?: PositionAction[];
  capitalReductions?: AccountCapitalReductionDto[];
  capitalReductionAnnouncements?: CapitalReductionAnnouncementDto[];
  generationRunId: string;
  generatedAt: string;
  /** When non-null, only emit snapshots whose date ≥ fromDate. */
  fromDate: string | null;
}

export function walkPositionHistory(params: WalkerParams): HoldingSnapshot[] {
  const { userId, accountId, ticker, marketCode, trades, bars, dividends, generationRunId, generatedAt, fromDate } = params;

  // KZO-165: validate single priceCurrency across all trades for this (account, ticker).
  // Mixed values are an upstream data bug — an instrument has one quote currency, and the
  // walker must surface this clearly rather than silently picking the first/last value.
  // No-op when trades is empty (the loop in generateHoldingSnapshots only enters this
  // function for groups with at least one trade).
  if (trades.length === 0) {
    // Defensive — walker isn't called with empty trades today, but keep the guard so
    // future callers don't trip over `trades[0]` below.
    return [];
  }
  const nativeCurrency = trades[0].priceCurrency;
  for (const t of trades) {
    if (t.priceCurrency !== nativeCurrency) {
      throw routeError(
        500,
        "snapshot_mixed_currency",
        `Mixed priceCurrency for (account=${accountId}, ticker=${ticker}): saw "${nativeCurrency}" and "${t.priceCurrency}"`,
      );
    }
  }

  const barByDate = new Map(bars.map(b => [b.barDate, b]));
  const tradingDays = bars.map(b => b.barDate);
  const hasBars = tradingDays.length > 0;

  // Walk every date on which *something* could happen: a trading day or a
  // trade date. Snapshots are only emitted on trading days (unless the ticker
  // has no bars at all, in which case we emit a provisional row on each trade
  // date so the user still gets a visible data point).
  const actions = (params.positionActions ?? []).filter((action) => action.accountId === accountId && action.ticker === ticker && action.marketCode === marketCode && !action.supersededAt && !action.reversalOfPositionActionId);
  const capitalActions = (params.capitalReductions ?? []).filter((action) => action.accountId === accountId && action.ticker === ticker && action.status === "POSTED");
  const allDates = new Set([...tradingDays, ...trades.map(t => t.tradeDate), ...actions.map(action => action.actionDate), ...capitalActions.flatMap((action) => {
    const input = action.revisions[action.revisions.length - 1].input;
    const dates = [input.announcement.suspensionStartDate, input.announcement.conversionDate, ...input.repaymentReceipts.map((receipt) => receipt.receivedDate), ...(input.fractionSettlement ? [input.fractionSettlement.receivedDate] : []), ...(input.fractionAdjustments ?? []).map((row) => row.occurredDate)];
    // Suspension must remain visible even when the exchange publishes no bars.
    for (let cursor = new Date(`${input.announcement.suspensionStartDate}T00:00:00Z`); cursor.toISOString().slice(0, 10) < input.announcement.conversionDate && cursor.toISOString().slice(0, 10) <= generatedAt.slice(0, 10); cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(cursor.toISOString().slice(0, 10));
    return dates.filter((date) => date <= generatedAt.slice(0, 10));
  })]);
  const registeredAnnouncements = (params.capitalReductionAnnouncements ?? []).filter((row) => marketCode === "TW" && row.ticker === ticker && !capitalActions.some((action) => action.eventId === row.eventId));
  for (const announcement of registeredAnnouncements) {
    for (let cursor = new Date(`${announcement.suspensionStartDate}T00:00:00Z`); cursor.toISOString().slice(0, 10) <= announcement.conversionDate && cursor.toISOString().slice(0, 10) <= generatedAt.slice(0, 10); cursor.setUTCDate(cursor.getUTCDate() + 1)) allDates.add(cursor.toISOString().slice(0, 10));
  }
  const stream = [...trades.map((trade) => ({ kind: "trade" as const, trade })), ...actions.map((action) => ({ kind: "action" as const, action }))].sort(compareReplayEntries);
  let lots: Lot[] = [];
  let streamIndex = 0;
  const sortedDates = [...allDates].sort();

  let quantity = 0;
  let costBasis = 0;
  let cumulativeRealizedPnl = 0;
  let dividendIdx = 0;
  let cumulativeDividends = 0;

  const snapshots: HoldingSnapshot[] = [];
  const suspensionValues = new Map<string, { price: number; date: string; value: number }>();
  let lastDatedValue: { price: number; date: string; value: number } | undefined;
  let lastBar: DailyBar | undefined;

  for (const date of sortedDates) {
    while (streamIndex < stream.length) {
      const entry = stream[streamIndex];
      if ((entry.kind === "trade" ? entry.trade.tradeDate : entry.action.actionDate) > date) break;
      if (entry.kind === "action") lots = applyPositionActionToLots(lots, entry.action);
      else {
        const trade = entry.trade;
        if (trade.type === "BUY") lots = applyBuyToLots(lots, { id: `lot-${trade.id}`, accountId, ticker, openQuantity: trade.quantity,
          totalCostAmount: roundToDecimal(trade.quantity * trade.unitPrice, 2) + trade.commissionAmount + trade.taxAmount,
          costCurrency: trade.priceCurrency, openedAt: trade.tradeDate, openedSequence: trade.bookingSequence ?? 1 }).updatedLots;
        else {
          const allocation = allocateSellLots(lots.filter((lot) => lot.openQuantity > 0), trade.quantity);
          lots = lots.map((lot) => allocation.updatedLots.find((next) => next.id === lot.id) ?? lot);
          cumulativeRealizedPnl = roundToDecimal(cumulativeRealizedPnl + roundToDecimal(trade.quantity * trade.unitPrice, 2) - trade.commissionAmount - trade.taxAmount - allocation.allocatedCostAmount, 2);
        }
      }
      streamIndex++;
    }
    quantity = lots.reduce((sum, lot) => sum + lot.openQuantity, 0);
    costBasis = roundToDecimal(lots.reduce((sum, lot) => sum + lot.totalCostAmount, 0), 2);

    // Accumulate dividends paid on or before this date.
    while (dividendIdx < dividends.length && dividends[dividendIdx].paymentDate <= date) {
      cumulativeDividends = roundToDecimal(cumulativeDividends + dividends[dividendIdx].amount, 2);
      dividendIdx++;
    }

    const bar = barByDate.get(date);
    const related = capitalActions.filter((action) => capitalReductionInput(action).announcement.suspensionStartDate <= date);
    const capitalAction = related.filter((action) => capitalReductionInput(action).announcement.conversionDate <= date).sort((a, b) => capitalReductionInput(b).announcement.conversionDate.localeCompare(capitalReductionInput(a).announcement.conversionDate))[0]
      ?? related.sort((a, b) => capitalReductionInput(a).announcement.conversionDate.localeCompare(capitalReductionInput(b).announcement.conversionDate))[0];
    if (capitalAction && !suspensionValues.has(capitalAction.id) && lastDatedValue) suspensionValues.set(capitalAction.id, { ...lastDatedValue });
    const registered = registeredAnnouncements.filter((row) => row.suspensionStartDate <= date).sort((a, b) => b.suspensionStartDate.localeCompare(a.suspensionStartDate) || b.version - a.version)[0];
    const registrationApplies = registered && (!capitalAction || registered.suspensionStartDate > capitalReductionInput(capitalAction).announcement.suspensionStartDate);
    const registeredKey = registered ? `${registered.eventId}:${registered.version}` : undefined;
    if (registeredKey && !suspensionValues.has(registeredKey) && lastDatedValue) suspensionValues.set(registeredKey, { ...lastDatedValue });
    const componentDate = !!(registered && date <= registered.conversionDate) || capitalActions.some((action) => {
      const input = capitalReductionInput(action);
      return date >= input.announcement.suspensionStartDate && date <= input.announcement.conversionDate
        || input.repaymentReceipts.some((row) => row.receivedDate === date)
        || input.fractionSettlement?.receivedDate === date
        || input.fractionAdjustments?.some((row) => row.occurredDate === date);
    });
    if (bar) lastBar = bar;
    // Capital components also need a snapshot on actual dates without an exchange bar.
    if (!bar && hasBars && !actions.some((action) => action.actionDate === date) && !componentDate) continue;
    const actionValuation = capitalAction ? capitalReductionValuation(capitalAction, date, {
      remainingQuantity: quantity,
      quote: lastBar ? { price: lastBar.close, date: lastBar.barDate } : undefined,
      preConversion: suspensionValues.get(capitalAction.id),
    }) : undefined;
    const capitalValuation = registrationApplies ? registeredCapitalReductionValuation(registered, date, registeredKey ? suspensionValues.get(registeredKey) : undefined) : actionValuation;
    const closePrice = capitalValuation ? capitalValuation.sharePrice : bar?.close ?? null;
    if (bar && (!capitalValuation || capitalValuation.status === "MARKET")) lastDatedValue = { price: bar.close, date: bar.barDate, value: roundToDecimal(bar.close * quantity, 4) };
    if (fromDate !== null && date < fromDate) continue;
    // KZO-165: compute native columns at the precision specified in D9.
    // value_native: 4-decimal precision (matches close_price * quantity granularity).
    // cost_basis_native: walker already accumulates in native — assign directly.
    // unrealized_pnl_native: 2-decimal precision; null when valueNative is null.
    const valueNative = capitalValuation ? capitalValuation.deliveredShareValue : closePrice !== null && quantity > 0
      ? roundToDecimal(closePrice * quantity, 4)
      : quantity === 0 ? 0 : null;
    const costBasisNative = costBasis;
    const unrealizedPnlNative = valueNative !== null
      ? roundToDecimal(valueNative - costBasisNative, 2)
      : null;
    const providerSource = capitalValuation && capitalValuation.status !== "MARKET" ? `capital_reduction:${capitalValuation.status.toLowerCase()}:${capitalValuation.valuationDate ?? "unknown"}` : (bar ?? lastBar)?.source ?? null;
    const isProvisional = valueNative === null;

    // KZO-165 D6: dual-write legacy columns from native source values. For TWD-only
    // data this is a no-op behavioral change (legacy values were already native);
    // sets the precedent so KZO-176 can drop the legacy columns cleanly.
    snapshots.push({
      id: randomUUID(),
      userId,
      accountId,
      ticker,
      marketCode,
      snapshotDate: date,
      quantity,
      closePrice,
      // Dual-write: legacy `marketValue` mirrors `valueNative` exactly until
      // KZO-176 removes the legacy column.
      marketValue: valueNative,
      costBasis: costBasisNative,
      unrealizedPnl: unrealizedPnlNative,
      cumulativeRealizedPnl,
      cumulativeDividends,
      isProvisional,
      currency: nativeCurrency,
      valueNative,
      costBasisNative,
      unrealizedPnlNative,
      providerSource,
      generatedAt,
      generationRunId,
    });
  }

  return snapshots;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function groupTrades(trades: SnapshotTradeInput[]): Map<string, Map<string, SnapshotTradeInput[]>> {
  const result = new Map<string, Map<string, SnapshotTradeInput[]>>();
  for (const trade of trades) {
    let byTicker = result.get(trade.accountId);
    if (!byTicker) {
      byTicker = new Map();
      result.set(trade.accountId, byTicker);
    }
    const key = snapshotPairKey(trade.ticker, trade.marketCode);
    const list = byTicker.get(key) ?? [];
    list.push(trade);
    byTicker.set(key, list);
  }
  return result;
}

function groupDividends(dividends: SnapshotDividendInput[]): Map<string, Map<string, SnapshotDividendInput[]>> {
  const result = new Map<string, Map<string, SnapshotDividendInput[]>>();
  for (const div of dividends) {
    let byTicker = result.get(div.accountId);
    if (!byTicker) {
      byTicker = new Map();
      result.set(div.accountId, byTicker);
    }
    const key = snapshotPairKey(div.ticker, div.marketCode);
    const list = byTicker.get(key) ?? [];
    list.push(div);
    byTicker.set(key, list);
  }
  return result;
}

function uniqueTickerMarketPairs(trades: SnapshotTradeInput[]): { ticker: string; marketCode: MarketCode }[] {
  const byKey = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const trade of trades) {
    byKey.set(snapshotPairKey(trade.ticker, trade.marketCode), {
      ticker: trade.ticker,
      marketCode: trade.marketCode,
    });
  }
  return [...byKey.values()];
}

function snapshotPairKey(ticker: string, marketCode: MarketCode): string {
  return `${ticker}\0${marketCode}`;
}
