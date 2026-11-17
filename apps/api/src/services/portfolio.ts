import { calculateCashCapitalReduction } from "@vakwen/domain";
import {
  applyBuyToLots,
  allocateSellLots,
  calculateBuyFees,
  calculateSellFees,
  roundToDecimal,
  type FeeProfile,
  type Lot,
} from "@vakwen/domain";
import { marketCodeFor } from "@vakwen/shared-types";
import type { AccountDto, MarketCode } from "@vakwen/shared-types";
import {
  appendCorporateAction,
  appendTradeEvent,
  deriveRealizedPnlForTrade,
  listInventoryLots,
  listPositionActions,
  listTradeEvents,
  replaceLotAllocationsForTrade,
  replaceInventoryLots,
  upsertPositionAction,
} from "./accountingStore.js";
import { bookCashLedgerEntry, buildTradeSettlementCashEntry } from "./cashLedgerService.js";
import { routeError } from "../lib/routeError.js";
import { assertBookedCharge } from "../validation/bookedCharge.js";
import type {
  BookedTradeEvent,
  CorporateAction,
  LotAllocationProjection,
  PositionAction,
  Store,
  Transaction,
} from "../types/store.js";

// KZO-183: trade market guard — every trade booking must hit an instrument
// whose market matches the booking account's market (derived from
// account.defaultCurrency). 1:1 currency↔market mapping. The DB-level
// trigger on `trade_events` is defense-in-depth; this is the user-facing
// surface that produces the 400 error envelope.
export function assertTradeMarketMatchesAccount(
  account: Pick<AccountDto, "id" | "defaultCurrency">,
  tradeMarketCode: string,
): void {
  // marketCodeFor throws a plain Error if account.defaultCurrency falls outside
  // the supported account currencies. Catch it here so callers see a stable 400
  // routeError envelope instead of a 500 (CHECK constraint on
  // accounts.default_currency makes this branch unreachable in practice; this
  // is defense-in-depth per service-error-pattern.md).
  let expected: string;
  try {
    expected = marketCodeFor(account.defaultCurrency);
  } catch {
    throw routeError(
      400,
      "trade_market_mismatch",
      `Account ${account.id} has unsupported defaultCurrency ${account.defaultCurrency}`,
    );
  }
  if (tradeMarketCode !== expected) {
    throw routeError(
      400,
      "trade_market_mismatch",
      `Trade market ${tradeMarketCode} does not match account ${account.id} market ${expected}`,
    );
  }
}

export interface CreateTransactionInput {
  id: string;
  accountId: string;
  ticker: string;
  // KZO-169: provided by the caller as part of the body payload — server
  // rejects mismatches via the `currency_mismatch` guard in the route handler.
  marketCode: MarketCode;
  quantity: number;
  unitPrice: number;
  priceCurrency: string;
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  commissionAmount?: number;
  taxAmount?: number;
  feesSource?: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED";
  type: "BUY" | "SELL";
  isDayTrade: boolean;
}

export interface HoldingsRow {
  accountId: string;
  ticker: string;
  quantity: number;
  costBasisAmount: number;
  currency: string;
}

export function createTransaction(
  store: Store,
  userId: string,
  input: CreateTransactionInput,
): Transaction {
  const tx = buildTransactionRecord(store, userId, input);
  commitPreparedTransaction(store, tx);
  return tx;
}

export function buildTransactionRecord(
  store: Store,
  userId: string,
  input: CreateTransactionInput,
): Transaction {
  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) throw routeError(404, "account_not_found", "Account not found");

  const instrument = store.instruments.find((item) => item.ticker === input.ticker && item.marketCode === input.marketCode);
  if (!instrument) throw routeError(400, "unsupported_ticker", "Unsupported ticker");
  if (instrument.type === null) throw routeError(400, "unclassified_instrument", "Cannot create trades for unclassified instruments");
  // KZO-183: enforce account market binding BEFORE running fee resolution
  // or any side effects. The instrument's market_code must match the
  // market derived from the booking account's defaultCurrency.
  assertTradeMarketMatchesAccount(account, instrument.marketCode);

  const profile = resolveFeeProfileForTransaction(
    store,
    account.id,
    input.ticker,
    account.feeProfileId,
  );
  if (input.priceCurrency !== profile.commissionCurrency) {
    throw routeError(400, "currency_mismatch", "Trade currency must match fee profile commission currency");
  }

  const tradeValueAmount = roundToDecimal(input.quantity * input.unitPrice, 2);
  assertTradeTimestampMatchesTradeDate(input.tradeDate, input.tradeTimestamp);
  assertBookedCharge(input.commissionAmount, "Commission");
  assertBookedCharge(input.taxAmount, "Tax");
  const bookingSequence = resolveBookingSequence(store, input.accountId, input.tradeDate, input.bookingSequence);
  const suggestedFees =
    input.type === "BUY"
      ? calculateBuyFees(profile, tradeValueAmount, input.priceCurrency)
      : calculateSellFees(profile, {
          tradeValueAmount,
          tradeCurrency: input.priceCurrency,
          instrumentType: instrument.type,
          isDayTrade: input.isDayTrade,
          marketCode: instrument.marketCode,
        });
  const commissionAmount = input.commissionAmount ?? suggestedFees.commissionAmount;
  const taxAmount = input.taxAmount ?? suggestedFees.taxAmount;

  return {
    id: input.id,
    userId,
    accountId: input.accountId,
    ticker: input.ticker,
    marketCode: instrument.marketCode,
    instrumentType: instrument.type,
    type: input.type,
    quantity: input.quantity,
    unitPrice: input.unitPrice,
    priceCurrency: input.priceCurrency,
    tradeDate: input.tradeDate,
    tradeTimestamp: input.tradeTimestamp ?? new Date(`${input.tradeDate}T00:00:00.000Z`).toISOString(),
    commissionAmount,
    taxAmount,
    isDayTrade: input.isDayTrade,
    feeSnapshot: { ...profile },
    bookingSequence,
    source: "portfolio_transaction_api",
    sourceReference: input.id,
    bookedAt: new Date().toISOString(),
    feesSource: input.feesSource ?? (input.commissionAmount !== undefined || input.taxAmount !== undefined ? "MANUAL" : "CALCULATED"),
  };
}

export function commitPreparedTransaction(store: Store, tx: Transaction): void {
  applyToLots(store, tx);
  appendTradeEvent(store, tx);
  // KZO-167: route through cashLedgerService so the currency-match guard
  // fires on path 1 (initial trade booking) before delegating to
  // appendCashLedgerEntry.
  bookCashLedgerEntry(store, buildTradeSettlementCashEntry(tx));
}

function applyToLots(store: Store, tx: Transaction): void {
  const relevantLots = listInventoryLots(store).filter((lot) => lot.accountId === tx.accountId && lot.ticker === tx.ticker);

  if (tx.type === "BUY") {
    const lot: Lot = {
      id: `lot-${tx.id}`,
      accountId: tx.accountId,
      ticker: tx.ticker,
      openQuantity: tx.quantity,
      totalCostAmount: roundToDecimal(tx.unitPrice * tx.quantity, 2) + tx.commissionAmount + tx.taxAmount,
      costCurrency: tx.priceCurrency,
      openedAt: tx.tradeDate,
      openedSequence: tx.bookingSequence,
    };
    const applied = applyBuyToLots(relevantLots, lot);
    replaceLots(store, tx.accountId, tx.ticker, applied.updatedLots);
    return;
  }

  const allocation = allocateSellLots(relevantLots, tx.quantity);

  replaceLots(store, tx.accountId, tx.ticker, allocation.updatedLots);
  replaceLotAllocationsForTrade(store, tx.id, buildLotAllocationProjections(tx, allocation.matchedAllocations));
  tx.realizedPnlAmount = deriveRealizedPnlForTrade(store.accounting, tx);
  tx.realizedPnlCurrency = tx.priceCurrency;
}

function mustGetFeeProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) throw routeError(404, "fee_profile_not_found", `Fee profile ${profileId} not found`);
  return profile;
}

function resolveFeeProfileForTransaction(
  store: Store,
  accountId: string,
  ticker: string,
  fallbackProfileId: string,
): FeeProfile {
  // KZO-183: bindings no longer carry `marketCode` — resolution is keyed
  // solely by (accountId, ticker). Market enforcement happens at the trade
  // booking guard, not in fee-profile resolution.
  const symbolBinding = store.feeProfileBindings.find(
    (binding) => binding.accountId === accountId && binding.ticker === ticker,
  );

  if (symbolBinding) {
    return mustGetFeeProfile(store, symbolBinding.feeProfileId);
  }

  return mustGetFeeProfile(store, fallbackProfileId);
}

export function listHoldings(store: Store, userId: string): HoldingsRow[] {
  const accountIds = new Set(store.accounts.filter((item) => item.userId === userId).map((item) => item.id));
  return store.accounting.projections.holdings.filter((holding) => accountIds.has(holding.accountId));
}

export interface PositionActionInput {
  id: string;
  accountId: string;
  ticker: string;
  actionType: "SPLIT" | "REVERSE_SPLIT";
  numerator: number;
  denominator: number;
  actionDate: string;
  actionTimestamp?: string;
  cashInLieuAmount?: number;
  cashInLieuCurrency?: string;
  source?: string;
  sourceReference?: string;
}

export interface PositionActionPreview {
  accountId: string;
  ticker: string;
  actionType: "SPLIT" | "REVERSE_SPLIT";
  beforeQuantity: number;
  afterQuantity: number;
  fractionalQuantity: number;
  blocked: boolean;
  blockingReason: "cash_in_lieu_required" | null;
}

export function previewPositionAction(store: Store, input: PositionActionInput): PositionActionPreview {
  const account = store.accounts.find((item) => item.id === input.accountId);
  if (!account) throw routeError(404, "account_not_found", "Account not found");

  validatePositionActionInput(input);
  const scopedLots = listInventoryLots(store).filter(
    (lot) => lot.accountId === input.accountId && lot.ticker === input.ticker && lot.openQuantity > 0,
  );
  const hasReplayFacts = hasPositionReplayFacts(store, input);
  const actionDateLots = buildLotsBeforePositionAction(store, input).filter((lot) => lot.openQuantity > 0);
  const previewLots = hasReplayFacts || scopedLots.length === 0 ? actionDateLots : scopedLots;
  const ratio = input.numerator / input.denominator;
  const beforeQuantity = roundToDecimal(previewLots.reduce((sum, lot) => sum + lot.openQuantity, 0), 6);
  const afterQuantity = previewLots.reduce((sum, lot) => {
    const adjustedQuantity = lot.openQuantity * ratio;
    const retainedQuantity = Math.floor(adjustedQuantity);
    return sum + (adjustedQuantity !== retainedQuantity ? retainedQuantity : adjustedQuantity);
  }, 0);
  const fractionalQuantity = roundToDecimal(
    previewLots.reduce((sum, lot) => {
      const adjustedQuantity = lot.openQuantity * ratio;
      const retainedQuantity = Math.floor(adjustedQuantity);
      return sum + (adjustedQuantity - retainedQuantity);
    }, 0),
    6,
  );
  const hasCashInLieu = (input.cashInLieuAmount ?? 0) > 0;

  return {
    accountId: input.accountId,
    ticker: input.ticker,
    actionType: input.actionType,
    beforeQuantity,
    afterQuantity: roundToDecimal(afterQuantity, 6),
    fractionalQuantity,
    blocked: fractionalQuantity > 0 && !hasCashInLieu,
    blockingReason: fractionalQuantity > 0 && !hasCashInLieu ? "cash_in_lieu_required" : null,
  };
}

function hasPositionReplayFacts(store: Store, input: PositionActionInput): boolean {
  const account = store.accounts.find((item) => item.id === input.accountId);
  if (!account) return false;
  const marketCode = marketCodeFor(account.defaultCurrency);
  return listTradeEvents(store).some((trade) =>
    trade.accountId === input.accountId &&
    trade.ticker === input.ticker &&
    trade.marketCode === marketCode)
    || listPositionActions(store).some((action) =>
      action.accountId === input.accountId &&
      action.ticker === input.ticker &&
      action.marketCode === marketCode);
}

type PositionReplayEntry =
  | { kind: "trade"; trade: BookedTradeEvent }
  | { kind: "action"; action: PositionAction }
  | { kind: "candidate"; action: PositionActionInput };

function buildLotsBeforePositionAction(store: Store, input: PositionActionInput): Lot[] {
  const account = store.accounts.find((item) => item.id === input.accountId);
  if (!account) throw routeError(404, "account_not_found", "Account not found");
  const marketCode = marketCodeFor(account.defaultCurrency);
  const candidate: PositionReplayEntry = { kind: "candidate", action: input };
  const stream: PositionReplayEntry[] = [
    ...listTradeEvents(store)
      .filter((trade) =>
        trade.accountId === input.accountId &&
        trade.ticker === input.ticker &&
        trade.marketCode === marketCode)
      .map((trade) => ({ kind: "trade" as const, trade })),
    ...listPositionActions(store)
      .filter((action) =>
        action.accountId === input.accountId &&
        action.ticker === input.ticker &&
        action.marketCode === marketCode)
      .map((action) => ({ kind: "action" as const, action })),
    candidate,
  ].sort(comparePositionReplayEntries);

  let lots: Lot[] = [];
  for (const entry of stream) {
    if (entry.kind === "candidate") return lots;
    if (entry.kind === "action") {
      lots = applyPositionActionPreviewToLots(lots, entry.action);
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
    const allocation = allocateSellLots(lots.filter((lot) => lot.openQuantity > 0), trade.quantity);
    lots = lots.map((lot) => allocation.updatedLots.find((updated) => updated.id === lot.id) ?? lot);
  }
  return lots;
}

function applyPositionActionPreviewToLots(currentLots: Lot[], action: PositionAction): Lot[] {
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
    return [
      ...currentLots.filter((lot) => lot.id !== `lot-pa-${action.id}`),
      {
        id: `lot-pa-${action.id}`,
        accountId: action.accountId,
        ticker: action.ticker,
        openQuantity: action.quantity,
        totalCostAmount: 0,
        costCurrency: action.cashInLieuCurrency ?? "TWD",
        openedAt: action.actionDate,
        openedSequence: nextSequence,
      },
    ];
  }
  const ratio = (action.ratioNumerator ?? 1) / (action.ratioDenominator ?? 1);
  return currentLots.map((lot) => {
    if (lot.accountId !== action.accountId || lot.ticker !== action.ticker || lot.openQuantity <= 0) {
      return lot;
    }
    const adjustedQuantity = lot.openQuantity * ratio;
    const retainedQuantity = Math.floor(adjustedQuantity);
    return {
      ...lot,
      openQuantity: adjustedQuantity !== retainedQuantity ? retainedQuantity : adjustedQuantity,
    };
  });
}

function comparePositionReplayEntries(left: PositionReplayEntry, right: PositionReplayEntry): number {
  const leftDate = left.kind === "trade" ? left.trade.tradeDate : left.action.actionDate;
  const rightDate = right.kind === "trade" ? right.trade.tradeDate : right.action.actionDate;
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftTimestamp = left.kind === "trade" ? left.trade.tradeTimestamp ?? null : left.action.actionTimestamp ?? null;
  const rightTimestamp = right.kind === "trade" ? right.trade.tradeTimestamp ?? null : right.action.actionTimestamp ?? null;
  if (leftTimestamp && rightTimestamp && leftTimestamp !== rightTimestamp) {
    return leftTimestamp.localeCompare(rightTimestamp);
  }
  if (left.kind === "trade" && right.kind === "trade") {
    return (
      (left.trade.tradeTimestamp ?? "").localeCompare(right.trade.tradeTimestamp ?? "")
      || (left.trade.bookingSequence ?? 0) - (right.trade.bookingSequence ?? 0)
      || (left.trade.bookedAt ?? "").localeCompare(right.trade.bookedAt ?? "")
      || left.trade.id.localeCompare(right.trade.id)
    );
  }
  if (left.kind !== "trade" && right.kind !== "trade") {
    return (
      positionReplayActionBookedAt(left.action).localeCompare(positionReplayActionBookedAt(right.action))
      || left.action.id.localeCompare(right.action.id)
    );
  }
  if (!leftTimestamp || !rightTimestamp) {
    return left.kind === "trade" ? 1 : -1;
  }
  return left.kind === "trade" ? 1 : -1;
}

function positionReplayActionBookedAt(action: PositionAction | PositionActionInput): string {
  return "bookedAt" in action ? action.bookedAt ?? "" : "";
}

export function createPositionAction(store: Store, input: PositionActionInput): PositionAction {
  const account = store.accounts.find((item) => item.id === input.accountId);
  if (!account) throw routeError(404, "account_not_found", "Account not found");

  const preview = previewPositionAction(store, input);
  if (preview.blocked) {
    throw routeError(
      422,
      "position_action_fractional_cash_in_lieu_required",
      "Split or reverse split creates fractional shares and requires explicit cash-in-lieu handling",
    );
  }

  const marketCode = marketCodeFor(account.defaultCurrency);
  const bookedAt = new Date().toISOString();
  const positionAction: PositionAction = {
    id: input.id,
    accountId: input.accountId,
    ticker: input.ticker,
    marketCode,
    actionType: input.actionType,
    actionDate: input.actionDate,
    actionTimestamp: input.actionTimestamp,
    quantity: 0,
    ratioNumerator: input.numerator,
    ratioDenominator: input.denominator,
    cashInLieuQuantity: preview.fractionalQuantity > 0 ? preview.fractionalQuantity : undefined,
    cashInLieuAmount: input.cashInLieuAmount,
    cashInLieuCurrency: input.cashInLieuCurrency ?? account.defaultCurrency,
    source: input.source ?? "position_action_api",
    sourceReference: input.sourceReference ?? input.id,
    bookedAt,
  };

  upsertPositionAction(store, positionAction);
  return positionAction;
}

export function applyCorporateAction(store: Store, action: CorporateAction): CorporateAction {
  if (action.actionType === "DIVIDEND") {
    const account = store.accounts.find((item) => item.id === action.accountId);
    if (!account) throw routeError(404, "account_not_found", "Account not found");
    const bookedAt = new Date().toISOString();
    upsertPositionAction(store, {
      id: action.id,
      accountId: action.accountId,
      ticker: action.ticker,
      marketCode: marketCodeFor(account.defaultCurrency),
      actionType: "STOCK_DIVIDEND",
      actionDate: action.actionDate,
      quantity: action.numerator / action.denominator,
      source: "legacy_corporate_action_api",
      sourceReference: action.id,
      bookedAt,
    });
    appendCorporateAction(store, action);
    return action;
  }

  createPositionAction(store, {
    id: action.id,
    accountId: action.accountId,
    ticker: action.ticker,
    actionType: action.actionType,
    numerator: action.numerator,
    denominator: action.denominator,
    actionDate: action.actionDate,
    source: "legacy_corporate_action_api",
    sourceReference: action.id,
  });
  appendCorporateAction(store, action);
  return action;
}

function validatePositionActionInput(input: PositionActionInput): void {
  if (input.denominator <= 0 || input.numerator <= 0) {
    throw routeError(400, "invalid_split_ratio", "Invalid split ratio");
  }
  if (input.actionTimestamp && input.actionTimestamp.slice(0, 10) !== input.actionDate) {
    throw routeError(400, "timestamp_date_mismatch", "Action timestamp must match action date");
  }
  if (input.cashInLieuAmount !== undefined && input.cashInLieuAmount < 0) {
    throw routeError(400, "invalid_cash_in_lieu", "Cash-in-lieu amount cannot be negative");
  }
}

function replaceLots(store: Store, accountId: string, ticker: string, nextLots: Lot[]): void {
  replaceInventoryLots(store, accountId, ticker, nextLots);
}

function buildLotAllocationProjections(
  tx: BookedTradeEvent,
  matchedAllocations: Array<{
    lotId: string;
    quantity: number;
    allocatedCostAmount: number;
    costCurrency: string;
    openedAt: string;
    openedSequence?: number;
  }>,
): LotAllocationProjection[] {
  return matchedAllocations.map((allocation) => ({
    id: `${tx.id}:${allocation.lotId}`,
    userId: tx.userId,
    accountId: tx.accountId,
    tradeEventId: tx.id,
    ticker: tx.ticker,
    lotId: allocation.lotId,
    lotOpenedAt: allocation.openedAt,
    lotOpenedSequence: allocation.openedSequence ?? 1,
    allocatedQuantity: allocation.quantity,
    allocatedCostAmount: allocation.allocatedCostAmount,
    costCurrency: allocation.costCurrency,
    createdAt: tx.bookedAt,
  }));
}

function nextBookingSequence(store: Store, accountId: string, tradeDate: string): number {
  const sameDayTrades = listTradeEvents(store).filter(
    (trade) => trade.accountId === accountId && trade.tradeDate === tradeDate,
  );

  const highestSequence = sameDayTrades.reduce((max, trade) => Math.max(max, trade.bookingSequence ?? 0), 0);
  return highestSequence + 1;
}

export function resolveBookingSequence(
  store: Store,
  accountId: string,
  tradeDate: string,
  requestedSequence?: number,
): number {
  if (requestedSequence === undefined) {
    return nextBookingSequence(store, accountId, tradeDate);
  }

  const collides = listTradeEvents(store).some(
    (trade) =>
      trade.accountId === accountId && trade.tradeDate === tradeDate && trade.bookingSequence === requestedSequence,
  );
  if (collides) {
    throw routeError(409, "duplicate_booking_sequence", "Booking sequence already exists for the same account and trade date");
  }

  return requestedSequence;
}

function assertTradeTimestampMatchesTradeDate(tradeDate: string, tradeTimestamp?: string): void {
  if (!tradeTimestamp) return;
  if (tradeTimestamp.slice(0, 10) !== tradeDate) {
    throw routeError(400, "timestamp_date_mismatch", "Trade timestamp must match trade date");
  }
}

// KZO-167: `buildTradeSettlementCashEntry` lives in `cashLedgerService.ts`
// and is imported above. The local copy was removed to consolidate the
// builder shared with `recompute.ts`.
