import { calculateCashCapitalReduction } from "@vakwen/domain";
import { applyBuyToLots, allocateSellLots, roundToDecimal } from "@vakwen/domain";
import type { Lot, MarketCode } from "@vakwen/domain";
import { currencyFor, MARKET_CODES, type MarketCode as SharedMarketCode } from "@vakwen/shared-types";
import type { Persistence } from "../persistence/types.js";
import { MemoryPersistence } from "../persistence/memory.js";
import type { BookedTradeEvent, CashLedgerEntry, DividendEvent, LotAllocationProjection, PositionAction } from "../types/store.js";
import type { EventBus } from "../events/types.js";
import { reconcileDividendEntitlementsForScope, type DividendLedgerRecomputeChange } from "./dividends.js";
import { recomputeSnapshotsForTicker } from "./snapshotGeneration.js";

export interface ReplaySummary {
  accountId: string;
  ticker: string;
  updatedHoldings: {
    openQuantity: number;
    averageCost: number;
    totalRealizedPnl: number;
    totalCommission: number;
    totalTax: number;
  };
  cashBalanceChange: number;
  lotsRecalculated: number;
  affectedTradeCount: number;
  /**
   * Dividend ledger entries whose eligible quantity / expected amounts
   * changed as part of this replay pass (Rule B recompute). Callers use
   * this list to emit dividend_reconciliation_changed / dividend_updated
   * SSE events per entry.
   */
  dividendLedgerChanges: DividendLedgerRecomputeChange[];
}

export class ReplayError extends Error {
  constructor(
    message: string,
    public readonly failedTradeEventId: string,
  ) {
    super(message);
    this.name = "ReplayError";
  }
}

export interface ReplayPositionHistoryOptions {
  marketCode?: MarketCode;
  deletedTradeEventIds?: readonly string[];
  preserveTradeCashEntries?: boolean;
}

export async function commitPositionReplay(
  persistence: Persistence,
  userId: string,
  accountId: string,
  ticker: string,
  options: ReplayPositionHistoryOptions = {},
): Promise<ReplaySummary> {
  return persistence.withTransactionWriteLock(userId, async (writer) => {
    const authoritativeStore = structuredClone(await writer.loadStore(userId));
    const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
    await simulation.saveStore(structuredClone(authoritativeStore));
    const summary = await replayPositionHistory(simulation, userId, accountId, ticker, options);
    const replayedStore = await simulation.loadStore(userId);
    const appliedDividendChanges = await writer.saveReplayedPositionScope(userId, replayedStore.accounting, {
      accountId,
      ticker,
      marketCode: options.marketCode ?? inferScopeMarketCode(authoritativeStore, accountId, ticker),
      deletedTradeEventIds: options.deletedTradeEventIds,
      dividendLedgerChanges: summary.dividendLedgerChanges,
    });
    return {
      ...summary,
      dividendLedgerChanges: appliedDividendChanges,
    };
  });
}

function inferScopeMarketCode(
  store: Awaited<ReturnType<Persistence["loadStore"]>>,
  accountId: string,
  ticker: string,
): MarketCode {
  const trade = store.accounting.facts.tradeEvents.find(
    (item) => item.accountId === accountId && item.ticker === ticker,
  );
  const action = store.accounting.facts.positionActions.find(
    (item) => item.accountId === accountId && item.ticker === ticker,
  );
  const marketCode = trade?.marketCode ?? action?.marketCode;
  if (!marketCode) throw new Error(`marketCode is required to commit replay for ${accountId}/${ticker}`);
  return marketCode;
}

export interface ReplayBoundary {
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
}

export async function replayPositionHistory(
  persistence: Persistence,
  userId: string,
  accountId: string,
  ticker: string,
  options: ReplayPositionHistoryOptions = {},
): Promise<ReplaySummary> {
  // 1. Load all trade events for account+ticker, ordered by trade_date ASC, booking_sequence ASC
  const trades = await persistence.getTradeEventsForAccountTicker(userId, accountId, ticker, options.marketCode);
  const positionActions = await persistence.getPositionActionsForAccountTicker(userId, accountId, ticker, options.marketCode);

  // 2. Delete lots for account+ticker (CRITICAL — blocker from debate)
  await persistence.deleteLotsForAccountTicker(userId, accountId, ticker, options.marketCode, options.deletedTradeEventIds);

  // 3. Delete lot_allocations for account+ticker
  await persistence.deleteLotAllocationsForAccountTicker(userId, accountId, ticker, options.marketCode, options.deletedTradeEventIds);

  // 4. Delete TRADE_SETTLEMENT_IN/OUT cash entries for account+ticker unless
  // the caller already replaced only the settlements whose amounts changed.
  if (!options.preserveTradeCashEntries) {
    await persistence.deleteTradeCashEntriesForAccountTicker(
      userId,
      accountId,
      ticker,
      options.marketCode,
      options.deletedTradeEventIds,
    );
  }

  // 5. Replay each trade / position action in deterministic order
  let lots: Lot[] = [];
  const allAllocations: LotAllocationProjection[] = [];
  const allCashEntries: CashLedgerEntry[] = [];
  let totalRealizedPnl = 0;
  let totalCommission = 0;
  let totalTax = 0;
  let cashBalanceChange = 0;

  const stream = [...trades.map((trade) => ({ kind: "trade" as const, trade })), ...positionActions.map((action) => ({ kind: "action" as const, action }))]
    .sort(compareReplayEntries);

  for (const entry of stream) {
    if (entry.kind === "action") {
      lots = applyPositionActionToLots(lots, entry.action);
      continue;
    }

    const trade = entry.trade;
    // Use the trade's stored commission/tax (replay does NOT recalculate fees)
    totalCommission += trade.commissionAmount;
    totalTax += trade.taxAmount;

    if (trade.type === "BUY") {
      const lot: Lot = {
        id: `lot-${trade.id}`,
        accountId: trade.accountId,
        ticker: trade.ticker,
        openQuantity: trade.quantity,
        totalCostAmount: roundToDecimal(trade.unitPrice * trade.quantity, 2) + trade.commissionAmount + trade.taxAmount,
        costCurrency: trade.priceCurrency,
        openedAt: trade.tradeDate,
        openedSequence: trade.bookingSequence ?? 1,
      };
      const result = applyBuyToLots(lots, lot);
      lots = result.updatedLots;
    } else {
      // SELL — allocate from lots
      const openLots = lots.filter((l) => l.openQuantity > 0);
      try {
        const result = allocateSellLots(openLots, trade.quantity);
        lots = lots.map((l) => {
          const updated = result.updatedLots.find((u) => u.id === l.id);
          return updated ?? l;
        });
        // Build lot allocation projections
        const allocProjections = result.matchedAllocations.map((alloc) => ({
          id: `${trade.id}:${alloc.lotId}`,
          userId,
          accountId: trade.accountId,
          tradeEventId: trade.id,
          ticker: trade.ticker,
          lotId: alloc.lotId,
          lotOpenedAt: alloc.openedAt,
          lotOpenedSequence: alloc.openedSequence ?? 1,
          allocatedQuantity: alloc.quantity,
          allocatedCostAmount: alloc.allocatedCostAmount,
          costCurrency: alloc.costCurrency,
          createdAt: new Date().toISOString(),
        }));
        allAllocations.push(...allocProjections);

        // Derive realized PnL for this sell
        const allocatedCost = allocProjections.reduce((sum, a) => sum + a.allocatedCostAmount, 0);
        const netProceeds = roundToDecimal(trade.quantity * trade.unitPrice, 2) - trade.commissionAmount - trade.taxAmount;
        const pnl = roundToDecimal(netProceeds - allocatedCost, 2);
        totalRealizedPnl += pnl;
        trade.realizedPnlAmount = pnl;
        trade.realizedPnlCurrency = trade.priceCurrency;
      } catch (error) {
        // "Insufficient quantity to sell" — wrap with trade context
        const message = error instanceof Error ? error.message : String(error);
        throw new ReplayError(
          `Replay failed at trade ${trade.id} (${trade.type} ${trade.quantity}x${trade.ticker} on ${trade.tradeDate}): ${message}`,
          trade.id,
        );
      }
    }

    // Generate cash ledger entry (settlement)
    const grossTradeValue = roundToDecimal(trade.quantity * trade.unitPrice, 2);
    const settlementAmount =
      trade.type === "BUY"
        ? -(grossTradeValue + trade.commissionAmount + trade.taxAmount)
        : grossTradeValue - trade.commissionAmount - trade.taxAmount;

    // Skip zero-amount entries (CHECK constraint: amount <> 0)
    if (settlementAmount !== 0) {
      cashBalanceChange += settlementAmount;
    }
    if (!options.preserveTradeCashEntries && settlementAmount !== 0) {
      allCashEntries.push({
        id: `cash-replay-${trade.id}`,
        userId,
        accountId: trade.accountId,
        entryDate: trade.tradeDate,
        entryType: trade.type === "BUY" ? "TRADE_SETTLEMENT_OUT" : "TRADE_SETTLEMENT_IN",
        amount: settlementAmount,
        currency: trade.priceCurrency,
        relatedTradeEventId: trade.id,
        source: "trade_settlement",
        sourceReference: trade.id,
        bookedAt: new Date().toISOString(),
      });
    }
  }

  // 6. Persist replayed state
  if (lots.length > 0) {
    await persistence.bulkUpsertLots(userId, lots);
  }
  if (allAllocations.length > 0) {
    await persistence.bulkInsertLotAllocations(userId, allAllocations);
  }
  if (allCashEntries.length > 0) {
    // KZO-167 D8 — Path 4 explicit invariant continuation. The cash-entry
    // currency-match guard (`assertCashEntryCurrencyMatchesAccount` in
    // `cashLedgerService.ts`) is intentionally NOT invoked on this replay
    // path. Replay re-derives entries from already-validated `trade_events`
    // whose currency was guarded at booking time (Path 1) or recompute time
    // (Path 3); combined with KZO-167 D7's PATCH /accounts/:id lockdown
    // (cannot mutate `defaultCurrency` while cash entries or trade events
    // exist), no source-data drift can introduce a mismatch here.
    // See `docs/004-notes/kzo-167/scope-todo-202604271700-account-currency-and-type.md`
    // and `.claude/rules/replay-position-history-invariants.md`.
    await persistence.bulkInsertCashLedgerEntries(userId, allCashEntries);
  }

  // 7. Recompute dividend ledger entries (Invariant 5 / Rule B).
  //
  // Load a fresh store AFTER step 6 so the plan sees the current trade set
  // persisted by this replay, then apply the changes under a row lock.
  // Reconciliation is reset (matched/explained → open, note preserved) per
  // Rule B because this path represents a runtime trade mutation.
  const storeAfterReplay = await persistence.loadStore(userId);
  const dividendDraft = structuredClone(storeAfterReplay);
  const dividendChanges = reconcileDividendEntitlementsForScope(dividendDraft, accountId, ticker, {
    reopenChangedReconciliation: true,
    marketCode: toSharedMarketCode(options.marketCode),
    eligibleQuantityResolver: (dividendEvent, dividendMarketCode) => deriveEligibleQuantityFromReplayStream(
      trades,
      positionActions,
      accountId,
      ticker,
      dividendMarketCode,
      dividendEvent,
    ),
  });
  const appliedChanges = await persistence.applyDividendLedgerRecompute(userId, dividendChanges);

  // 8. Build summary
  const openLots = lots.filter((l) => l.openQuantity > 0);
  const openQuantity = openLots.reduce((sum, l) => sum + l.openQuantity, 0);
  const totalCost = openLots.reduce((sum, l) => sum + l.totalCostAmount, 0);
  const averageCost = openQuantity > 0 ? totalCost / openQuantity : 0;

  return {
    accountId,
    ticker,
    updatedHoldings: {
      openQuantity,
      averageCost,
      totalRealizedPnl,
      totalCommission,
      totalTax,
    },
    cashBalanceChange,
    lotsRecalculated: lots.length,
    affectedTradeCount: trades.length,
    dividendLedgerChanges: appliedChanges,
  };
}

export function applyPositionActionToLots(currentLots: Lot[], action: PositionAction): Lot[] {
  if (action.reversalOfPositionActionId || action.supersededAt) {
    return currentLots;
  }

  if (action.actionType === "CASH_CAPITAL_REDUCTION") {
    const detail = action.capitalReduction;
    if (!detail) throw new Error(`Capital reduction ${action.id} is missing source details`);
    const eligible = currentLots.filter((lot) => lot.accountId === action.accountId && lot.ticker === action.ticker);
    const calculation = calculateCashCapitalReduction({ lots: eligible, ...detail.announcement, confirmedWholeQuantity: detail.confirmedWholeQuantity });
    return currentLots.map((lot) => calculation.lots.find((updated) => updated.id === lot.id) ?? lot);
  }
  if (action.actionType === "STOCK_DIVIDEND") {
    const nextSequence =
      currentLots
        .filter((lot) => lot.accountId === action.accountId && lot.ticker === action.ticker && lot.openedAt === action.actionDate)
        .reduce((max, lot) => Math.max(max, lot.openedSequence ?? 0), 0) + 1;
    const stockDividendLot: Lot = {
      id: `lot-pa-${action.id}`,
      accountId: action.accountId,
      ticker: action.ticker,
      openQuantity: action.quantity,
      totalCostAmount: 0,
      costCurrency: currencyFor(action.marketCode),
      openedAt: action.actionDate,
      openedSequence: nextSequence,
    };
    return [
      ...currentLots.filter((lot) => lot.id !== stockDividendLot.id),
      stockDividendLot,
    ];
  }

  const numerator = action.ratioNumerator ?? 1;
  const denominator = action.ratioDenominator ?? 1;
  if (numerator <= 0 || denominator <= 0) {
    return currentLots;
  }
  const splitRatio = numerator / denominator;
  return currentLots.map((lot) => {
    if (lot.accountId !== action.accountId || lot.ticker !== action.ticker || lot.openQuantity <= 0) {
      return lot;
    }
    const adjustedQuantity = lot.openQuantity * splitRatio;
    const retainedQuantity = Math.floor(adjustedQuantity);
    const hasFractionalQuantity = adjustedQuantity !== retainedQuantity;
    if (hasFractionalQuantity && (action.cashInLieuAmount ?? 0) <= 0) {
      throw new Error(`Position action ${action.id} creates fractional shares without cash-in-lieu`);
    }
    return {
      ...lot,
      openQuantity: hasFractionalQuantity ? retainedQuantity : adjustedQuantity,
    };
  });
}

export function deriveEligibleQuantityFromReplayStream(
  trades: readonly BookedTradeEvent[],
  positionActions: readonly PositionAction[],
  accountId: string,
  ticker: string,
  marketCode: SharedMarketCode,
  dividendEvent: Pick<DividendEvent, "exDividendDate">,
): number {
  let lots: Lot[] = [];
  const reversedTradeIds = new Set(
    trades
      .map((trade) => trade.reversalOfTradeEventId)
      .filter((id): id is string => Boolean(id)),
  );
  const reversedPositionActionIds = new Set(
    positionActions
      .map((action) => action.reversalOfPositionActionId)
      .filter((id): id is string => Boolean(id)),
  );
  const stream = [
    ...trades.map((trade) => ({ kind: "trade" as const, trade })),
    ...positionActions.map((action) => ({ kind: "action" as const, action })),
  ]
    .filter((entry) => {
      if (entry.kind === "trade") {
        if (entry.trade.reversalOfTradeEventId || reversedTradeIds.has(entry.trade.id)) return false;
      } else if (
        entry.action.reversalOfPositionActionId
        || entry.action.supersededAt
        || reversedPositionActionIds.has(entry.action.id)
      ) {
        return false;
      }
      const entryDate = entry.kind === "trade" ? entry.trade.tradeDate : entry.action.actionDate;
      const entryMarketCode = entry.kind === "trade" ? entry.trade.marketCode : entry.action.marketCode;
      return entryDate < dividendEvent.exDividendDate && entryMarketCode === marketCode;
    })
    .sort(compareReplayEntries);

  for (const entry of stream) {
    if (entry.kind === "action") {
      lots = applyPositionActionToLots(lots, entry.action);
      continue;
    }

    const trade = entry.trade;
    if (trade.type === "BUY") {
      const lot: Lot = {
        id: `lot-${trade.id}`,
        accountId: trade.accountId,
        ticker: trade.ticker,
        openQuantity: trade.quantity,
        totalCostAmount: roundToDecimal(trade.unitPrice * trade.quantity, 2) + trade.commissionAmount + trade.taxAmount,
        costCurrency: trade.priceCurrency,
        openedAt: trade.tradeDate,
        openedSequence: trade.bookingSequence ?? 1,
      };
      lots = applyBuyToLots(lots, lot).updatedLots;
      continue;
    }

    const openLots = lots.filter((lot) => lot.openQuantity > 0);
    const result = allocateSellLots(openLots, trade.quantity);
    lots = lots.map((lot) => result.updatedLots.find((updated) => updated.id === lot.id) ?? lot);
  }

  return Math.max(
    0,
    lots
      .filter((lot) => lot.accountId === accountId && lot.ticker === ticker && lot.openQuantity > 0)
      .reduce((sum, lot) => sum + lot.openQuantity, 0),
  );
}

export function buildReplayLotsBeforeBoundary(
  trades: readonly BookedTradeEvent[],
  positionActions: readonly PositionAction[],
  boundary: ReplayBoundary,
): Lot[] {
  let lots: Lot[] = [];
  const reversedTradeIds = new Set(
    trades
      .map((trade) => trade.reversalOfTradeEventId)
      .filter((id): id is string => Boolean(id)),
  );
  const reversedPositionActionIds = new Set(
    positionActions
      .map((action) => action.reversalOfPositionActionId)
      .filter((id): id is string => Boolean(id)),
  );
  const stream = [
    ...trades.map((trade) => ({ kind: "trade" as const, trade })),
    ...positionActions.map((action) => ({ kind: "action" as const, action })),
  ]
    .filter((entry) => {
      if (entry.kind === "trade") {
        if (entry.trade.reversalOfTradeEventId || reversedTradeIds.has(entry.trade.id)) return false;
      } else if (
        entry.action.reversalOfPositionActionId
        || entry.action.supersededAt
        || reversedPositionActionIds.has(entry.action.id)
      ) {
        return false;
      }
      return compareReplayEntriesWithBoundary(entry, { kind: "boundary", boundary }) < 0;
    })
    .sort(compareReplayEntriesWithBoundary);

  for (const entry of stream) {
    if (entry.kind === "action") {
      lots = applyPositionActionToLots(lots, entry.action);
      continue;
    }

    if (entry.trade.type === "BUY") {
      lots = applyBuyToLots(lots, {
        id: `lot-${entry.trade.id}`,
        accountId: entry.trade.accountId,
        ticker: entry.trade.ticker,
        openQuantity: entry.trade.quantity,
        totalCostAmount:
          roundToDecimal(entry.trade.unitPrice * entry.trade.quantity, 2)
          + entry.trade.commissionAmount
          + entry.trade.taxAmount,
        costCurrency: entry.trade.priceCurrency,
        openedAt: entry.trade.tradeDate,
        openedSequence: entry.trade.bookingSequence ?? 1,
      }).updatedLots;
      continue;
    }

    const openLots = lots.filter((lot) => lot.openQuantity > 0);
    const result = allocateSellLots(openLots, entry.trade.quantity);
    lots = lots.map((lot) => result.updatedLots.find((updated) => updated.id === lot.id) ?? lot);
  }

  return lots;
}

async function emitDividendLedgerChangeEvents(
  eventBus: EventBus,
  userId: string,
  changes: DividendLedgerRecomputeChange[],
): Promise<void> {
  for (const change of changes) {
    try {
      if (change.reconciliationReset) {
        await eventBus.publishEvent(userId, "dividend_reconciliation_changed", {
          dividendLedgerEntryId: change.ledgerEntryId,
          dividendEventId: change.dividendEventId,
          accountId: change.accountId,
          reconciliationStatus: change.nextReconciliationStatus,
          version: change.nextVersion,
        });
      } else {
        await eventBus.publishEvent(userId, "dividend_updated", {
          dividendLedgerEntryId: change.ledgerEntryId,
          dividendEventId: change.dividendEventId,
          accountId: change.accountId,
          version: change.nextVersion,
        });
      }
    } catch {
      // EventBus unavailable — client will pick up the change on next poll.
    }
  }
}

/**
 * Options for scheduling a scoped replay after a trade mutation.
 *
 * `snapshotFromDate` is the earliest date whose snapshots need to be
 * regenerated for this (accountId, ticker). Callers should pass the trade's
 * tradeDate for create/delete; for patches that move a trade across dates,
 * pass the earlier of (oldTradeDate, newTradeDate). Omitting it regenerates
 * from the ticker's earliest snapshot (functionally correct but slower).
 */
export interface ScheduleReplayOptions {
  snapshotFromDate?: string;
  marketCode?: MarketCode;
  deletedTradeEventIds?: readonly string[];
}

/**
 * Recompute snapshots for (accountId, ticker) from `fromDate`, but only if
 * snapshots already exist for that ticker. Logs (doesn't throw) on failure —
 * snapshot recompute is advisory and must not block the recompute_complete
 * path.
 */
async function recomputeSnapshotsIfExists(
  persistence: Persistence,
  userId: string,
  accountId: string,
  ticker: string,
  fromDate: string,
  marketCode?: MarketCode,
): Promise<void> {
  try {
    if (!marketCode) {
      console.warn(`[snapshot-recompute] Skipped for ${ticker}: marketCode is required for scoped recompute`);
      return;
    }
    const existingCount = await persistence.countHoldingSnapshotsAfterDate(userId, accountId, ticker, "1970-01-01", marketCode);
    if (existingCount > 0) {
      await recomputeSnapshotsForTicker(userId, accountId, ticker, fromDate, persistence, marketCode);
    }
  } catch (snapshotError) {
    console.warn(`[snapshot-recompute] Failed for ${ticker}:`, snapshotError instanceof Error ? snapshotError.message : snapshotError);
  }
}

export function scheduleCommittedReplayFollowUp(
  persistence: Persistence,
  eventBus: EventBus,
  userId: string,
  summary: ReplaySummary,
  options: Pick<ScheduleReplayOptions, "snapshotFromDate" | "marketCode"> = {},
): void {
  const fromDate = options.snapshotFromDate ?? "1970-01-01";
  void emitDividendLedgerChangeEvents(eventBus, userId, summary.dividendLedgerChanges);
  setImmediate(async () => {
    try {
      await recomputeSnapshotsIfExists(
        persistence,
        userId,
        summary.accountId,
        summary.ticker,
        fromDate,
        options.marketCode,
      );
      await eventBus.publishEvent(userId, "recompute_complete", {
        accountId: summary.accountId,
        ticker: summary.ticker,
        updatedHoldings: summary.updatedHoldings,
        cashBalanceChange: summary.cashBalanceChange,
        lotsRecalculated: summary.lotsRecalculated,
        affectedTradeCount: summary.affectedTradeCount,
      });
    } catch {
      // Persistence is already committed; clients will observe it on their next poll.
    }
  });
}

export function scheduleReplayWithRetry(
  persistence: Persistence,
  eventBus: EventBus,
  userId: string,
  accountId: string,
  ticker: string,
  options: ScheduleReplayOptions = {},
): void {
  // Default to epoch only as a conservative fallback; callers should pass a
  // real fromDate so the scoped recompute is actually scoped.
  const fromDate = options.snapshotFromDate ?? "1970-01-01";

  setImmediate(async () => {
    try {
      const summary = await commitPositionReplay(persistence, userId, accountId, ticker, {
        marketCode: options.marketCode,
        deletedTradeEventIds: options.deletedTradeEventIds,
      });

      await recomputeSnapshotsIfExists(persistence, userId, accountId, ticker, fromDate, options.marketCode);

      await eventBus.publishEvent(userId, "recompute_complete", {
        accountId: summary.accountId,
        ticker: summary.ticker,
        updatedHoldings: summary.updatedHoldings,
        cashBalanceChange: summary.cashBalanceChange,
        lotsRecalculated: summary.lotsRecalculated,
        affectedTradeCount: summary.affectedTradeCount,
      });
      await emitDividendLedgerChangeEvents(eventBus, userId, summary.dividendLedgerChanges);
    } catch (firstError) {
      const firstReason = firstError instanceof Error ? firstError.message : String(firstError);
      try {
        await eventBus.publishEvent(userId, "recompute_failed", {
          accountId,
          ticker,
          reason: firstReason,
          retriesExhausted: false,
        });
      } catch {
        // EventBus unavailable — client will hit safety net timeout
      }

      // One automatic retry — same guard as the primary path so we never
      // begin populating partial snapshots for a ticker the user didn't opt
      // into.
      setImmediate(async () => {
        try {
          const summary = await commitPositionReplay(persistence, userId, accountId, ticker, {
            marketCode: options.marketCode,
            deletedTradeEventIds: options.deletedTradeEventIds,
          });

          await recomputeSnapshotsIfExists(persistence, userId, accountId, ticker, fromDate, options.marketCode);

          await eventBus.publishEvent(userId, "recompute_complete", {
            accountId: summary.accountId,
            ticker: summary.ticker,
            updatedHoldings: summary.updatedHoldings,
            cashBalanceChange: summary.cashBalanceChange,
            lotsRecalculated: summary.lotsRecalculated,
            affectedTradeCount: summary.affectedTradeCount,
          });
          await emitDividendLedgerChangeEvents(eventBus, userId, summary.dividendLedgerChanges);
        } catch (retryError) {
          const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
          try {
            await eventBus.publishEvent(userId, "recompute_failed", {
              accountId,
              ticker,
              reason: retryReason,
              retriesExhausted: true,
            });
          } catch {
            // EventBus unavailable — client will hit safety net timeout
          }
        }
      });
    }
  });
}

function toSharedMarketCode(marketCode: MarketCode | undefined): SharedMarketCode | undefined {
  if (marketCode && (MARKET_CODES as readonly string[]).includes(marketCode)) {
    return marketCode as SharedMarketCode;
  }
  return undefined;
}

type ReplayStreamEntry =
  | { kind: "trade"; trade: Parameters<typeof compareTrades>[0] }
  | { kind: "action"; action: PositionAction };

type ReplayBoundaryStreamEntry =
  | ReplayStreamEntry
  | { kind: "boundary"; boundary: ReplayBoundary };

export function compareReplayEntries(left: ReplayStreamEntry, right: ReplayStreamEntry): number {
  const leftDate = left.kind === "trade" ? left.trade.tradeDate : left.action.actionDate;
  const rightDate = right.kind === "trade" ? right.trade.tradeDate : right.action.actionDate;
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftTimestamp = left.kind === "trade" ? left.trade.tradeTimestamp ?? null : left.action.actionTimestamp ?? null;
  const rightTimestamp = right.kind === "trade" ? right.trade.tradeTimestamp ?? null : right.action.actionTimestamp ?? null;
  if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }
  if (left.kind !== right.kind && (!leftTimestamp || !rightTimestamp)) {
    return left.kind === "action" ? -1 : 1;
  }

  if (left.kind === "trade" && right.kind === "trade") {
    return compareTrades(left.trade, right.trade);
  }
  if (left.kind === "action" && right.kind === "action") {
    return (
      (left.action.bookedAt ?? "").localeCompare(right.action.bookedAt ?? "")
      || left.action.id.localeCompare(right.action.id)
    );
  }
  return left.kind === "action" ? -1 : 1;
}

function compareReplayEntriesWithBoundary(left: ReplayBoundaryStreamEntry, right: ReplayBoundaryStreamEntry): number {
  const leftDate = left.kind === "trade" ? left.trade.tradeDate : left.kind === "action" ? left.action.actionDate : left.boundary.tradeDate;
  const rightDate = right.kind === "trade" ? right.trade.tradeDate : right.kind === "action" ? right.action.actionDate : right.boundary.tradeDate;
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftTimestamp = left.kind === "trade"
    ? left.trade.tradeTimestamp ?? null
    : left.kind === "action"
      ? left.action.actionTimestamp ?? null
      : left.boundary.tradeTimestamp ?? null;
  const rightTimestamp = right.kind === "trade"
    ? right.trade.tradeTimestamp ?? null
    : right.kind === "action"
      ? right.action.actionTimestamp ?? null
      : right.boundary.tradeTimestamp ?? null;
  if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }
  if (left.kind !== right.kind && (!leftTimestamp || !rightTimestamp)) {
    if (left.kind === "action") return -1;
    if (right.kind === "action") return 1;
    if (left.kind === "boundary") return 1;
    if (right.kind === "boundary") return -1;
  }

  if (left.kind === "trade" && right.kind === "trade") {
    return compareTrades(left.trade, right.trade);
  }
  if (left.kind === "action" && right.kind === "action") {
    return (
      (left.action.bookedAt ?? "").localeCompare(right.action.bookedAt ?? "")
      || left.action.id.localeCompare(right.action.id)
    );
  }
  if (left.kind === "boundary" && right.kind === "trade") {
    return (
      ((left.boundary.bookingSequence ?? Number.MAX_SAFE_INTEGER) - (right.trade.bookingSequence ?? 0))
      || 1
    );
  }
  if (left.kind === "trade" && right.kind === "boundary") {
    return (
      ((left.trade.bookingSequence ?? 0) - (right.boundary.bookingSequence ?? Number.MAX_SAFE_INTEGER))
      || -1
    );
  }
  return left.kind === "boundary" ? 1 : -1;
}

export function compareTrades(
  left: Pick<BookedTradeEvent, "id" | "tradeDate" | "tradeTimestamp" | "bookingSequence" | "bookedAt">,
  right: Pick<BookedTradeEvent, "id" | "tradeDate" | "tradeTimestamp" | "bookingSequence" | "bookedAt">,
): number {
  return (
    (left.tradeTimestamp ?? "").localeCompare(right.tradeTimestamp ?? "")
    || (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0)
    || (left.bookedAt ?? "").localeCompare(right.bookedAt ?? "")
    || left.id.localeCompare(right.id)
  );
}
