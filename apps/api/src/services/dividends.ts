import { deriveEligibleQuantityFromReplayStream } from "./replayPositionHistory.js";
import { randomUUID } from "node:crypto";
import {
  calculateDividendCashReconciliation,
  resolveDividendStockEntitlement,
  roundToDecimal,
  validateSourceLineReconciliation,
  type InstrumentType,
} from "@vakwen/domain";
import type {
  AccountDto,
  DividendSourceBucket,
  DividendSourceLine,
  StockDistributionRatioState,
  SourceCompositionStatus,
} from "@vakwen/shared-types";
import { MARKET_CODES, marketCodeFor, type MarketCode } from "@vakwen/shared-types";
import {
  listCashLedgerEntries,
  listDividendDeductionEntries,
  listDividendLedgerEntries,
  listDividendSourceLines,
  listInventoryLots,
  listPositionActions,
  listTradeEvents,
  replaceCashLedgerEntriesForDividend,
  replaceDividendDeductionsForLedger,
  replaceDividendSourceLinesForLedger,
  replaceInventoryLots,
  upsertPositionAction,
  upsertDividendLedgerEntry,
} from "./accountingStore.js";
import { listDividendEvents, upsertDividendEvent } from "./marketDataStore.js";
import { assertCashEntryCurrencyMatchesAccount } from "./cashLedgerService.js";
import { routeError } from "../lib/routeError.js";
import type {
  CashLedgerEntry,
  DividendDeductionEntry,
  DividendDeductionType,
  DividendEvent,
  DividendEventType,
  DividendLedgerEntry,
  PositionAction,
  Store,
} from "../types/store.js";
import type { UpdatePostedCashDividendInput } from "../persistence/types.js";

export interface CreateDividendEventInput {
  id: string;
  ticker: string;
  marketCode?: MarketCode;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string | null;
  cashDividendPerShare: number;
  cashDividendCurrency: string;
  stockDividendPerShare: number;
  stockDistributionAmountRaw?: number | null;
  stockProviderValueUnit?: "RATIO" | "TWD_PER_SHARE" | "UNKNOWN" | null;
  stockProviderSource?: string | null;
  stockProviderDataset?: string | null;
  stockDistributionRatio?: number | null;
  stockDistributionRatioState?: StockDistributionRatioState;
  stockParValueAmount?: number | null;
  stockParValueCurrency?: string | null;
  source: string;
  sourceReference?: string;
}

export interface DividendDeductionInput {
  id: string;
  deductionType: DividendDeductionType;
  amount: number;
  currencyCode: string;
  withheldAtSource: boolean;
  source: string;
  sourceReference?: string;
  note?: string;
}

export interface DividendSourceLineInput {
  id: string;
  sourceBucket: DividendSourceBucket;
  amount: number;
  currencyCode: string;
  source: string;
  sourceReference?: string;
  note?: string;
}

export interface PostDividendInput {
  id: string;
  accountId: string;
  dividendEventId: string;
  receivedCashAmount: number;
  receivedStockQuantity: number;
  deductions: DividendDeductionInput[];
  sourceLines?: DividendSourceLineInput[];
  sourceCompositionStatus?: SourceCompositionStatus;
}

export interface UpdatePostedCashDividendRequest {
  accountId: string;
  dividendEventId: string;
  dividendLedgerEntryId: string;
  expectedVersion: number;
  receivedCashAmount: number;
  receivedStockQuantity: number;
  deductions: DividendDeductionInput[];
  sourceLines: DividendSourceLineInput[];
  sourceCompositionStatus: SourceCompositionStatus;
}

export interface DividendPostingComparison {
  expectedCashAmount: number;
  actualCashEconomicAmount: number;
  cashVarianceAmount: number;
  expectedStockQuantity: number;
  actualStockQuantity: number;
  stockVarianceQuantity: number;
}

export interface PostDividendResult {
  dividendEvent: DividendEvent;
  dividendLedgerEntry: DividendLedgerEntry;
  positionAction: PositionAction | null;
  dividendDeductionEntries: DividendDeductionEntry[];
  dividendSourceLines: DividendSourceLine[];
  linkedCashLedgerEntries: CashLedgerEntry[];
  comparison: DividendPostingComparison;
}

export interface PreparedDividendUpdate {
  persistenceInput: UpdatePostedCashDividendInput;
  response: PostDividendResult;
}

/**
 * A single ledger entry that needs to be rewritten by the recompute step.
 * Callers persist the new values and emit SSE for entries whose
 * reconciliation_status was reset (true variance changes only).
 */
export interface DividendLedgerRecomputeChange {
  changeKind?: "created" | "updated" | "retired";
  ledgerEntryId: string;
  accountId: string;
  dividendEventId: string;
  previousVersion: number;
  nextVersion: number;
  previousEligibleQuantity: number;
  nextEligibleQuantity: number;
  previousExpectedCashAmount: number;
  nextExpectedCashAmount: number;
  previousExpectedStockQuantity: number;
  nextExpectedStockQuantity: number;
  reconciliationReset: boolean;
  nextReconciliationStatus: DividendLedgerEntry["reconciliationStatus"];
  previousReconciliationStatus: DividendLedgerEntry["reconciliationStatus"];
  reconciliationNote?: string;
  nextEntry: DividendLedgerEntry;
}

type DividendLedgerEligibleQuantityResolver = (
  dividendEvent: DividendEvent,
  dividendMarketCode: MarketCode,
) => number;

export interface DividendEventListItem {
  id: string;
  accountId: string;
  accountName: string;
  ticker: string;
  tickerName: string | null;
  marketCode: MarketCode;
  instrumentType: InstrumentType;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string | null;
  cashDividendCurrency: string;
  expectedCashAmount: number;
  expectedStockQuantity: number;
  stockDistributionRatio: number | null;
  stockDistributionRatioState: StockDistributionRatioState;
  eligibleQuantity: number;
  parValuePerShare: number | null;
  hasPostedLedgerEntry: boolean;
  dividendLedgerEntryId: string | null;
}

export interface DividendLedgerEntryDetails extends DividendLedgerEntry {
  accountName: string;
  ticker: string;
  tickerName: string | null;
  marketCode: MarketCode;
  instrumentType: InstrumentType;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string | null;
  cashCurrency: string;
  deductions: DividendDeductionEntry[];
  sourceLines: DividendSourceLine[];
  correctionMode?: "in_place" | "amend" | "reversal_replacement" | null;
  amendmentBlockedReason?: string | null;
  linkedPositionActionId?: string | null;
  linkedPositionActionStatus?: string | null;
  cashInLieuAmount?: number | null;
  parValueBaseAmount?: number | null;
  premiumBaseAmount?: number | null;
  nhiPremiumBaseAmount?: number | null;
  portfolioCostBasisAddedAmount?: number | null;
  snapshotRefreshStatus?: "idle" | "queued" | "running" | "complete" | "failed" | null;
}

export function createDividendEvent(store: Store, input: CreateDividendEventInput): DividendEvent {
  assertDividendEventShape(input);

  const dividendEvent: DividendEvent = {
    ...input,
    stockDistributionAmountRaw:
      input.stockDistributionAmountRaw === undefined
        ? input.stockDividendPerShare
        : input.stockDistributionAmountRaw,
    stockProviderValueUnit: input.stockProviderValueUnit ?? null,
    stockProviderSource: input.stockProviderSource ?? input.source,
    stockProviderDataset: input.stockProviderDataset ?? null,
    stockDistributionRatio:
      input.stockDistributionRatio === undefined
        ? (input.stockDividendPerShare > 0 ? input.stockDividendPerShare : null)
        : input.stockDistributionRatio,
    stockDistributionRatioState:
      input.stockDistributionRatioState === undefined
        ? (input.stockDividendPerShare > 0 ? "authoritative" : "unresolved")
        : input.stockDistributionRatioState,
    stockParValueAmount: input.stockParValueAmount ?? null,
    stockParValueCurrency: input.stockParValueCurrency ?? null,
    sourceReference: input.sourceReference,
    createdAt: new Date().toISOString(),
  };
  upsertDividendEvent(store, dividendEvent);
  return dividendEvent;
}

// KZO-183: dividend market guard — a posted dividend's cashDividendCurrency
// must equal the booking account's defaultCurrency (1:1 currency↔market).
// The DB-level trigger on `dividend_ledger_entries` is defense-in-depth;
// this is the user-facing surface that produces the 400 error envelope.
export function assertDividendMarketMatchesAccount(
  account: Pick<AccountDto, "id" | "defaultCurrency">,
  dividendEvent: Pick<DividendEvent, "id" | "cashDividendCurrency">,
): void {
  if (dividendEvent.cashDividendCurrency !== account.defaultCurrency) {
    throw routeError(
      400,
      "dividend_market_mismatch",
      `Dividend event ${dividendEvent.id} currency ${dividendEvent.cashDividendCurrency} does not match account ${account.id} default currency ${account.defaultCurrency}`,
    );
  }
}

export function postDividend(store: Store, userId: string, input: PostDividendInput): PostDividendResult {
  assertDividendPostingPayload(input);

  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) {
    throw routeError(404, "account_not_found", "Account not found");
  }

  const dividendEvent = listDividendEvents(store).find((entry) => entry.id === input.dividendEventId);
  if (!dividendEvent) {
    throw routeError(404, "dividend_event_not_found", "Dividend event not found");
  }

  // KZO-183: enforce the dividend market guard before any side effects.
  assertDividendMarketMatchesAccount(account, dividendEvent);

  const activeEntry = findActiveDividendLedgerEntry(store, input.accountId, input.dividendEventId);
  if (activeEntry && activeEntry.postingStatus !== "expected") {
    throw routeError(409, "dividend_conflict", "Dividend posting requires an active expected entry");
  }

  const expectedEntry = activeEntry ?? materializeExpectedDividendEntry(store, input.id, input.accountId, dividendEvent);
  if (dividendEvent.eventType === "CASH" && input.receivedStockQuantity > 0) {
    throw routeError(400, "cash_dividend_stock_quantity_not_allowed", "Cash dividends cannot receive stock quantity");
  }
  const bookedAt = new Date().toISOString();
  const deductions = buildDividendDeductions(expectedEntry.id, bookedAt, input.deductions);
  const actualCashEconomicAmount = calculateActualCashEconomicAmount(input.receivedCashAmount, deductions);
  const sourceComposition = materializeDividendSourceComposition(
    store,
    dividendEvent,
    expectedEntry.id,
    bookedAt,
    input.sourceCompositionStatus ?? "unknown_pending_disclosure",
    input.sourceLines ?? [],
    actualCashEconomicAmount,
  );

  const postedEntry: DividendLedgerEntry = {
    ...expectedEntry,
    receivedCashAmount: input.receivedCashAmount,
    receivedStockQuantity: input.receivedStockQuantity,
    postingStatus: "posted",
    reconciliationStatus: "open",
    version: expectedEntry.version > 0 ? expectedEntry.version : 1,
    sourceCompositionStatus: sourceComposition.status,
    reconciliationNote: undefined,
    bookedAt,
  };

  upsertDividendLedgerEntry(store, postedEntry);
  replaceDividendDeductionsForLedger(store, postedEntry.id, deductions);
  replaceDividendSourceLinesForLedger(store, postedEntry.id, sourceComposition.sourceLines);

  const linkedCashLedgerEntries = buildDividendCashLedgerEntries(userId, account, dividendEvent, postedEntry, deductions);
  replaceCashLedgerEntriesForDividend(store, postedEntry.id, linkedCashLedgerEntries);

  const positionAction = postedEntry.receivedStockQuantity > 0
    ? buildStockDividendPositionAction(account.defaultCurrency, dividendEvent, postedEntry, deductions)
    : null;

  if (positionAction) {
    upsertPositionAction(store, positionAction);
  } else {
    removePositionActionForDividend(store, postedEntry.id);
    replaceInventoryLots(
      store,
      account.id,
      dividendEvent.ticker,
      listInventoryLots(store).filter((lot) => lot.accountId === account.id && lot.ticker === dividendEvent.ticker),
    );
  }

  return buildPostingResult(
    dividendEvent,
    postedEntry,
    positionAction,
    deductions,
    sourceComposition.sourceLines,
    linkedCashLedgerEntries,
  );
}

export function preparePostedCashDividendUpdate(
  store: Store,
  userId: string,
  input: UpdatePostedCashDividendRequest,
): PreparedDividendUpdate {
  const account = store.accounts.find((item) => item.id === input.accountId && item.userId === userId);
  if (!account) {
    throw routeError(404, "account_not_found", "Account not found");
  }

  const currentEntry = listDividendLedgerEntries(store).find((entry) => entry.id === input.dividendLedgerEntryId);
  if (!currentEntry) {
    throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
  }

  if (currentEntry.accountId !== input.accountId) {
    throw routeError(400, "dividend_account_mismatch", "Dividend ledger entry does not belong to the requested account");
  }

  const dividendEvent = listDividendEvents(store).find((entry) => entry.id === currentEntry.dividendEventId);
  if (!dividendEvent) {
    throw routeError(404, "dividend_event_not_found", "Dividend event not found");
  }

  if (input.dividendEventId !== dividendEvent.id) {
    throw routeError(400, "dividend_event_mismatch", "Dividend event does not match the existing ledger entry");
  }

  // KZO-183: defense-in-depth — pre-existing posted entries should already
  // pass this guard, but enforce on every update path so any drift surfaces
  // here rather than in the DB trigger.
  assertDividendMarketMatchesAccount(account, dividendEvent);

  if (currentEntry.postingStatus !== "posted") {
    throw routeError(409, "dividend_update_requires_posted_status", "Only posted dividends can be edited in place");
  }

  if (dividendEvent.eventType === "CASH" && input.receivedStockQuantity > 0) {
    throw routeError(400, "cash_dividend_stock_quantity_not_allowed", "Cash dividends cannot receive stock quantity");
  }

  if (input.expectedVersion !== currentEntry.version) {
    throw routeError(409, "dividend_version_conflict", "Dividend has been updated by another request");
  }

  const existingPositionAction = listPositionActions(store).find(
    (action) => action.relatedDividendLedgerEntryId === currentEntry.id && !action.reversalOfPositionActionId && !action.supersededAt,
  );
  const blockingSell = dividendEvent.eventType !== "CASH" && input.receivedStockQuantity !== currentEntry.receivedStockQuantity
    ? findBlockingSellAfterStockDividend(store, dividendEvent, currentEntry, existingPositionAction)
    : undefined;

  const bookedAt = new Date().toISOString();
  const correctionLedgerEntryId = blockingSell
    ? `${currentEntry.id}:replacement:${randomUUID()}`
    : currentEntry.id;
  const deductions = buildDividendDeductions(correctionLedgerEntryId, bookedAt, input.deductions);
  const actualCashEconomicAmount = calculateActualCashEconomicAmount(input.receivedCashAmount, deductions);
  const sourceComposition = materializeDividendSourceComposition(
    store,
    dividendEvent,
    correctionLedgerEntryId,
    bookedAt,
    input.sourceCompositionStatus,
    input.sourceLines,
    actualCashEconomicAmount,
  );

  if (blockingSell) {
    return prepareStockDividendReversalReplacementUpdate({
      store,
      userId,
      account,
      dividendEvent,
      currentEntry,
      existingPositionAction,
      input,
      bookedAt,
      replacementLedgerEntryId: correctionLedgerEntryId,
      deductions,
      sourceLines: sourceComposition.sourceLines,
      sourceCompositionStatus: sourceComposition.status,
    });
  }

  const updatedEntry: DividendLedgerEntry = {
    ...currentEntry,
    receivedCashAmount: input.receivedCashAmount,
    receivedStockQuantity: input.receivedStockQuantity,
    postingStatus: currentEntry.postingStatus,
    reconciliationStatus: "open",
    version: currentEntry.version + 1,
    sourceCompositionStatus: sourceComposition.status,
    reconciliationNote: undefined,
    bookedAt,
  };

  upsertDividendLedgerEntry(store, updatedEntry);
  replaceDividendDeductionsForLedger(store, updatedEntry.id, deductions);
  replaceDividendSourceLinesForLedger(store, updatedEntry.id, sourceComposition.sourceLines);

  const linkedCashLedgerEntries = buildDividendCashLedgerEntries(userId, account, dividendEvent, updatedEntry, deductions);
  replaceCashLedgerEntriesForDividend(store, updatedEntry.id, linkedCashLedgerEntries);

  const positionAction = updatedEntry.receivedStockQuantity > 0
    ? buildStockDividendPositionAction(account.defaultCurrency, dividendEvent, updatedEntry, deductions)
    : null;
  if (positionAction) {
    upsertPositionAction(store, positionAction);
  } else if (existingPositionAction) {
    upsertPositionAction(store, { ...existingPositionAction, supersededAt: bookedAt });
  } else {
    removePositionActionForDividend(store, updatedEntry.id);
  }

  const lots = listInventoryLots(store).filter((lot) => lot.accountId === account.id && lot.ticker === dividendEvent.ticker);
  replaceInventoryLots(store, account.id, dividendEvent.ticker, lots);

  return {
    persistenceInput: {
      expectedVersion: input.expectedVersion,
      originalDividendLedgerEntryId: currentEntry.id,
      dividendLedgerEntry: updatedEntry,
      dividendLedgerEntries: [updatedEntry],
      linkedCashEntries: linkedCashLedgerEntries,
      dividendDeductions: deductions,
      dividendSourceLines: sourceComposition.sourceLines,
      positionActions: listPositionActions(store).filter((action) => action.relatedDividendLedgerEntryId === updatedEntry.id),
      lots,
      replaceChildRowsForDividendLedgerEntryIds: [updatedEntry.id],
      replacePositionActionsForDividendLedgerEntryIds: [updatedEntry.id],
    },
    response: buildPostingResult(
      dividendEvent,
      updatedEntry,
      positionAction,
      deductions,
      sourceComposition.sourceLines,
      linkedCashLedgerEntries,
    ),
  };
}

function prepareStockDividendReversalReplacementUpdate(input: {
  store: Store;
  userId: string;
  account: AccountDto;
  dividendEvent: DividendEvent;
  currentEntry: DividendLedgerEntry;
  existingPositionAction?: PositionAction;
  input: UpdatePostedCashDividendRequest;
  bookedAt: string;
  replacementLedgerEntryId: string;
  deductions: DividendDeductionEntry[];
  sourceLines: DividendSourceLine[];
  sourceCompositionStatus: SourceCompositionStatus;
}): PreparedDividendUpdate {
  const {
    store,
    userId,
    account,
    dividendEvent,
    currentEntry,
    existingPositionAction,
    bookedAt,
    replacementLedgerEntryId,
    deductions,
    sourceLines,
    sourceCompositionStatus,
  } = input;
  const reversalLedgerEntryId = `${currentEntry.id}:reversal:${randomUUID()}`;
  const originalSuperseded: DividendLedgerEntry = {
    ...currentEntry,
    version: currentEntry.version + 1,
    supersededAt: bookedAt,
  };
  const reversalEntry: DividendLedgerEntry = {
    ...currentEntry,
    id: reversalLedgerEntryId,
    postingStatus: "posted",
    reconciliationStatus: "resolved",
    version: 1,
    reconciliationNote: "Reversal row for stock dividend correction after blocking sell",
    reversalOfDividendLedgerEntryId: currentEntry.id,
    supersededAt: undefined,
    bookedAt,
  };
  const replacementEntry: DividendLedgerEntry = {
    ...currentEntry,
    id: replacementLedgerEntryId,
    receivedCashAmount: input.input.receivedCashAmount,
    receivedStockQuantity: input.input.receivedStockQuantity,
    postingStatus: "adjusted",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus,
    reconciliationNote: undefined,
    reversalOfDividendLedgerEntryId: undefined,
    supersededAt: undefined,
    bookedAt,
  };

  upsertDividendLedgerEntry(store, originalSuperseded);
  upsertDividendLedgerEntry(store, reversalEntry);
  upsertDividendLedgerEntry(store, replacementEntry);

  const existingDeductions = listDividendDeductionEntries(store)
    .filter((entry) => entry.dividendLedgerEntryId === currentEntry.id)
    .map((entry) => ({
      ...entry,
      id: `${reversalLedgerEntryId}:deduction:${entry.id}`,
      dividendLedgerEntryId: reversalLedgerEntryId,
      source: "dividend_correction",
      sourceReference: entry.id,
      note: entry.note ?? "Reversal detail for corrected stock dividend",
      bookedAt,
    }));
  const existingSourceLines = listDividendSourceLines(store)
    .filter((entry) => entry.dividendLedgerEntryId === currentEntry.id)
    .map((entry) => ({
      ...entry,
      id: `${reversalLedgerEntryId}:source:${entry.id}`,
      dividendLedgerEntryId: reversalLedgerEntryId,
      source: "dividend_correction",
      sourceReference: entry.id,
      note: entry.note ?? "Reversal source detail for corrected stock dividend",
      bookedAt,
    }));

  replaceDividendDeductionsForLedger(store, reversalLedgerEntryId, existingDeductions);
  replaceDividendDeductionsForLedger(store, replacementLedgerEntryId, deductions);
  replaceDividendSourceLinesForLedger(store, reversalLedgerEntryId, existingSourceLines);
  replaceDividendSourceLinesForLedger(store, replacementLedgerEntryId, sourceLines);

  const activeCashEntryIds = new Set(
    listCashLedgerEntries(store)
      .filter((entry) => entry.reversalOfCashLedgerEntryId)
      .map((entry) => entry.reversalOfCashLedgerEntryId)
      .filter((id): id is string => Boolean(id)),
  );
  const reversalCashEntries = listCashLedgerEntries(store)
    .filter((entry) => entry.relatedDividendLedgerEntryId === currentEntry.id)
    .filter((entry) => !entry.reversalOfCashLedgerEntryId && !activeCashEntryIds.has(entry.id))
    .map((entry) => ({
      ...entry,
      id: `${entry.id}:reversal:${randomUUID()}`,
      entryType: "REVERSAL" as const,
      amount: -entry.amount,
      relatedDividendLedgerEntryId: reversalLedgerEntryId,
      source: "dividend_correction",
      sourceReference: entry.id,
      note: entry.note ?? "Reversal for corrected stock dividend",
      reversalOfCashLedgerEntryId: entry.id,
      bookedAt,
    }));
  const replacementCashEntries = buildDividendCashLedgerEntries(userId, account, dividendEvent, replacementEntry, deductions);
  replaceCashLedgerEntriesForDividend(store, reversalLedgerEntryId, reversalCashEntries);
  replaceCashLedgerEntriesForDividend(store, replacementLedgerEntryId, replacementCashEntries);

  const positionActions: PositionAction[] = [];
  if (existingPositionAction) {
    const supersededOriginalAction: PositionAction = {
      ...existingPositionAction,
      supersededAt: bookedAt,
    };
    const reversalPositionAction: PositionAction = {
      ...existingPositionAction,
      id: `${existingPositionAction.id}:reversal:${randomUUID()}`,
      relatedDividendLedgerEntryId: reversalLedgerEntryId,
      source: "dividend_correction",
      sourceReference: existingPositionAction.id,
      reversalOfPositionActionId: existingPositionAction.id,
      supersededAt: undefined,
      bookedAt,
    };
    upsertPositionAction(store, supersededOriginalAction);
    upsertPositionAction(store, reversalPositionAction);
    positionActions.push(supersededOriginalAction, reversalPositionAction);
  }

  const replacementPositionAction = replacementEntry.receivedStockQuantity > 0
    ? buildStockDividendPositionAction(account.defaultCurrency, dividendEvent, replacementEntry, deductions)
    : null;
  if (replacementPositionAction) {
    upsertPositionAction(store, replacementPositionAction);
    positionActions.push(replacementPositionAction);
  }

  const lots = listInventoryLots(store).filter((lot) => lot.accountId === account.id && lot.ticker === dividendEvent.ticker);
  replaceInventoryLots(store, account.id, dividendEvent.ticker, lots);

  return {
    persistenceInput: {
      expectedVersion: input.input.expectedVersion,
      originalDividendLedgerEntryId: currentEntry.id,
      dividendLedgerEntry: replacementEntry,
      dividendLedgerEntries: [originalSuperseded, reversalEntry, replacementEntry],
      linkedCashEntries: [...reversalCashEntries, ...replacementCashEntries],
      dividendDeductions: [...existingDeductions, ...deductions],
      dividendSourceLines: [...existingSourceLines, ...sourceLines],
      positionActions,
      lots,
      replaceChildRowsForDividendLedgerEntryIds: [reversalLedgerEntryId, replacementLedgerEntryId],
      replacePositionActionsForDividendLedgerEntryIds: [replacementLedgerEntryId],
    },
    response: buildPostingResult(
      dividendEvent,
      replacementEntry,
      replacementPositionAction,
      deductions,
      sourceLines,
      replacementCashEntries,
    ),
  };
}

export function updateDividendReconciliationStatus(
  store: Store,
  userId: string,
  dividendLedgerEntryId: string,
  status: DividendLedgerEntry["reconciliationStatus"],
  note?: string,
): DividendLedgerEntry {
  const currentEntry = listDividendLedgerEntries(store).find((entry) => entry.id === dividendLedgerEntryId);
  if (!currentEntry) {
    throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
  }

  const account = store.accounts.find((item) => item.id === currentEntry.accountId && item.userId === userId);
  if (!account) {
    throw routeError(403, "forbidden", "Dividend ledger entry does not belong to the authenticated user");
  }

  if (!["posted", "adjusted"].includes(currentEntry.postingStatus)) {
    throw routeError(
      409,
      "reconciliation_requires_posted_status",
      "Dividend reconciliation can only update posted or adjusted entries",
    );
  }

  const normalizedNote = note?.trim();
  if (status === "explained" && !normalizedNote) {
    throw routeError(400, "reconciliation_note_required", "A note is required when reconciliation stays explained");
  }

  const updatedEntry: DividendLedgerEntry = {
    ...currentEntry,
    reconciliationStatus: status,
    reconciliationNote: normalizedNote || currentEntry.reconciliationNote,
    version: currentEntry.version + 1,
  };
  upsertDividendLedgerEntry(store, updatedEntry);
  return updatedEntry;
}

export function buildDividendEventListItems(
  store: Store,
  dividendEvents: DividendEvent[],
): DividendEventListItem[] {
  const items: DividendEventListItem[] = [];

  for (const account of store.accounts) {
    for (const dividendEvent of dividendEvents) {
      const activeEntry = findActiveDividendLedgerEntry(store, account.id, dividendEvent.id);
      // When an active ledger entry exists, use its stored snapshot — recompute
      // runs from replayPositionHistory on trade mutations so the stored value
      // is kept in sync with current trades per Rule B.
      // When no ledger entry exists, fall back to deriving from current trades.
      const dividendMarketCode = resolveDividendEventMarketCode(dividendEvent);
      const eligibleQuantity = activeEntry?.eligibleQuantity
        ?? deriveEligibleQuantity(store, account.id, dividendEvent.ticker, dividendEvent.exDividendDate, dividendMarketCode);
      if (!activeEntry && eligibleQuantity <= 0) {
        continue;
      }

      items.push({
        id: dividendEvent.id,
        accountId: account.id,
        accountName: account.name,
        ticker: dividendEvent.ticker,
        tickerName: resolveDividendTickerName(store, dividendEvent.ticker, dividendMarketCode),
        marketCode: dividendMarketCode,
        instrumentType: resolveDividendInstrumentType(store, dividendEvent.ticker),
        eventType: dividendEvent.eventType,
        exDividendDate: dividendEvent.exDividendDate,
        paymentDate: dividendEvent.paymentDate,
        cashDividendCurrency: dividendEvent.cashDividendCurrency,
        expectedCashAmount: activeEntry?.expectedCashAmount
          ?? calculateExpectedCashAmount(eligibleQuantity, dividendEvent.cashDividendPerShare),
        expectedStockQuantity: activeEntry?.expectedStockQuantity
          ?? resolveExpectedStockEntitlement(eligibleQuantity, dividendEvent).expectedStockQuantity,
        stockDistributionRatio: dividendEvent.stockDistributionRatio ?? null,
        stockDistributionRatioState: dividendEvent.stockDistributionRatioState ?? "unresolved",
        eligibleQuantity,
        parValuePerShare: activeEntry?.expectedStockParValueAmount
          ?? dividendEvent.stockParValueAmount
          ?? null,
        hasPostedLedgerEntry: activeEntry ? activeEntry.postingStatus !== "expected" : false,
        dividendLedgerEntryId: activeEntry?.id ?? null,
      });
    }
  }

  return items.sort(
    (left, right) =>
      compareNullableDates(left.paymentDate, right.paymentDate) ||
      left.accountId.localeCompare(right.accountId) ||
      left.ticker.localeCompare(right.ticker) ||
      left.id.localeCompare(right.id),
  );
}

export function buildDividendLedgerEntryDetails(
  store: Store,
  ledgerEntries: Array<DividendLedgerEntry & { deductions: DividendDeductionEntry[]; sourceLines: DividendSourceLine[] }>,
  options: { preserveOrder?: boolean } = {},
): DividendLedgerEntryDetails[] {
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));

  const mapped = ledgerEntries
    .map((entry) => {
      const dividendEvent = eventById.get(entry.dividendEventId);
      if (!dividendEvent) {
        return null;
      }

      // Stored values are authoritative: replayPositionHistory keeps them
      // aligned with current trades via Rule B recompute.
      const positionAction = listPositionActions(store).find(
        (action) => action.relatedDividendLedgerEntryId === entry.id && !action.reversalOfPositionActionId && !action.supersededAt,
      );
      const blockingSell = dividendEvent.eventType === "CASH"
        ? undefined
        : findBlockingSellAfterStockDividend(store, dividendEvent, entry, positionAction);
      const receivedStockQuantity = positionAction?.quantity ?? entry.receivedStockQuantity;
      const parValuePerShare = positionAction?.parValuePerShare ?? 0;
      const detail: DividendLedgerEntryDetails = {
        ...entry,
        accountName: accountById.get(entry.accountId)?.name ?? entry.accountId,
        ticker: dividendEvent.ticker,
        tickerName: resolveDividendTickerName(store, dividendEvent.ticker, resolveDividendEventMarketCode(dividendEvent)),
        marketCode: resolveDividendEventMarketCode(dividendEvent),
        instrumentType: resolveDividendInstrumentType(store, dividendEvent.ticker),
        eventType: dividendEvent.eventType,
        exDividendDate: dividendEvent.exDividendDate,
        paymentDate: dividendEvent.paymentDate,
        cashCurrency: dividendEvent.cashDividendCurrency,
        correctionMode: dividendEvent.eventType === "CASH"
          ? "in_place"
          : blockingSell
            ? "reversal_replacement"
            : "amend",
        amendmentBlockedReason: blockingSell
          ? `sell:${blockingSell.id}`
          : null,
        linkedPositionActionId: positionAction?.id ?? null,
        linkedPositionActionStatus: positionAction ? "posted" : null,
        cashInLieuAmount: positionAction?.cashInLieuAmount ?? null,
        parValueBaseAmount: parValuePerShare > 0 ? roundToDecimal(receivedStockQuantity * parValuePerShare, 2) : null,
        premiumBaseAmount: positionAction?.premiumBaseAmount ?? null,
        nhiPremiumBaseAmount: positionAction?.nhiPremiumBaseAmount ?? null,
        portfolioCostBasisAddedAmount: positionAction?.actionType === "STOCK_DIVIDEND" ? 0 : null,
        snapshotRefreshStatus: positionAction ? "queued" : null,
      };
      return detail;
    })
    .filter((entry): entry is DividendLedgerEntryDetails => Boolean(entry));

  // Caller may have already sorted by user-selected column (paginated listing);
  // preserveOrder keeps that ordering instead of the default paymentDate sort.
  if (options.preserveOrder) return mapped;

  return mapped.sort(
    (left, right) =>
      compareNullableDates(left.paymentDate, right.paymentDate) ||
      left.accountId.localeCompare(right.accountId) ||
      left.ticker.localeCompare(right.ticker) ||
      left.id.localeCompare(right.id),
  );
}

export function buildDividendReviewRowDetails<
  T extends {
    dividendEventId: string;
    ticker: string;
    cashCurrency: string;
  },
>(
  store: Store,
  rows: readonly T[],
): Array<T & { tickerName: string | null; marketCode: MarketCode }> {
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  return rows.map((row) => {
    const marketCode = eventById.get(row.dividendEventId)
      ? resolveDividendEventMarketCode(eventById.get(row.dividendEventId)!)
      : marketCodeFor(row.cashCurrency) as MarketCode;
    return {
      ...row,
      tickerName: resolveDividendTickerName(store, row.ticker, marketCode),
      marketCode,
    };
  });
}

function materializeExpectedDividendEntry(
  store: Store,
  id: string,
  accountId: string,
  dividendEvent: DividendEvent,
  eligibleQuantityOverride?: number,
): DividendLedgerEntry {
  const dividendMarketCode = resolveDividendEventMarketCode(dividendEvent);
  const eligibleQuantity = eligibleQuantityOverride ?? deriveEligibleQuantity(
    store,
    accountId,
    dividendEvent.ticker,
    dividendEvent.exDividendDate,
    dividendMarketCode,
  );
  const expectedEntitlement = buildExpectedDividendEntitlement(eligibleQuantity, dividendEvent);
  const expectedEntry: DividendLedgerEntry = {
    id,
    accountId,
    dividendEventId: dividendEvent.id,
    eligibleQuantity,
    ...expectedEntitlement,
    receivedCashAmount: 0,
    receivedStockQuantity: 0,
    postingStatus: "expected",
    reconciliationStatus: "open",
    version: 1,
    sourceCompositionStatus: "unknown_pending_disclosure",
    reconciliationNote: undefined,
    bookedAt: new Date().toISOString(),
  };
  upsertDividendLedgerEntry(store, expectedEntry);
  return expectedEntry;
}

function findActiveDividendLedgerEntry(
  store: Store,
  accountId: string,
  dividendEventId: string,
): DividendLedgerEntry | undefined {
  const supersededIds = new Set(
    listDividendLedgerEntries(store)
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((entry): entry is string => Boolean(entry)),
  );

  return listDividendLedgerEntries(store).find(
    (entry) =>
      entry.accountId === accountId &&
      entry.dividendEventId === dividendEventId &&
      !entry.reversalOfDividendLedgerEntryId &&
      !entry.supersededAt &&
      !supersededIds.has(entry.id),
  );
}

function buildDividendDeductions(
  dividendLedgerEntryId: string,
  bookedAt: string,
  deductions: DividendDeductionInput[],
): DividendDeductionEntry[] {
  return deductions.map((entry) => ({
    id: entry.id,
    dividendLedgerEntryId,
    deductionType: entry.deductionType,
    amount: entry.amount,
    currencyCode: entry.currencyCode,
    withheldAtSource: entry.withheldAtSource,
    source: entry.source,
    sourceReference: entry.sourceReference,
    note: entry.note,
    bookedAt,
  }));
}

function materializeDividendSourceComposition(
  store: Store,
  dividendEvent: DividendEvent,
  dividendLedgerEntryId: string,
  bookedAt: string,
  requestedStatus: SourceCompositionStatus,
  requestedSourceLines: DividendSourceLineInput[],
  actualCashEconomicAmount: number,
): {
  status: SourceCompositionStatus;
  sourceLines: DividendSourceLine[];
} {
  const instrumentType = resolveDividendInstrumentType(store, dividendEvent.ticker);
  const shouldAutoFillSingleLine =
    instrumentType === "STOCK" &&
    actualCashEconomicAmount > 0 &&
    requestedSourceLines.length === 0;

  if (requestedStatus === "unknown_pending_disclosure" && !shouldAutoFillSingleLine) {
    return {
      status: "unknown_pending_disclosure",
      sourceLines: [],
    };
  }

  const sourceLines = shouldAutoFillSingleLine
    ? [
        {
          id: randomUUID(),
          dividendLedgerEntryId,
          sourceBucket: "DIVIDEND_INCOME",
          amount: actualCashEconomicAmount,
          // KZO-170 D1b: derive from the dividend event's stored currency rather than
          // hardcoding `"TWD"`. The event's `cashDividendCurrency` is stamped at upsert
          // time via `currencyFor(marketCode)` (see `upserts.ts:139`), so this auto-fill
          // path now correctly mirrors the event's currency for every market.
          currencyCode: dividendEvent.cashDividendCurrency,
          source: "dividend_posting",
          sourceReference: dividendEvent.id,
          bookedAt,
        } satisfies DividendSourceLine,
      ]
    : buildDividendSourceLines(dividendLedgerEntryId, bookedAt, requestedSourceLines);

  const reconciliation = validateSourceLineReconciliation(sourceLines, actualCashEconomicAmount);
  if (!reconciliation.ok) {
    throw routeError(
      400,
      "dividend_source_line_mismatch",
      `Dividend source lines must reconcile to gross cash within NT$1 (variance ${reconciliation.variance})`,
    );
  }

  return {
    status: "provided",
    sourceLines,
  };
}

function buildDividendSourceLines(
  dividendLedgerEntryId: string,
  bookedAt: string,
  sourceLines: DividendSourceLineInput[],
): DividendSourceLine[] {
  return sourceLines.map((entry) => ({
    id: entry.id,
    dividendLedgerEntryId,
    sourceBucket: entry.sourceBucket,
    amount: entry.amount,
    currencyCode: entry.currencyCode,
    source: entry.source,
    sourceReference: entry.sourceReference,
    note: entry.note,
    bookedAt,
  }));
}

function buildDividendCashLedgerEntries(
  userId: string,
  account: AccountDto,
  dividendEvent: DividendEvent,
  dividendLedgerEntry: DividendLedgerEntry,
  deductions: DividendDeductionEntry[],
): CashLedgerEntry[] {
  const entries: CashLedgerEntry[] = [];
  const entryDate = resolveDividendPostingDate(dividendEvent.paymentDate, dividendLedgerEntry.bookedAt);
  const bookedAt = dividendLedgerEntry.bookedAt ?? new Date(`${entryDate}T00:00:00.000Z`).toISOString();

  if (dividendLedgerEntry.receivedCashAmount > 0) {
    const receiptEntry: CashLedgerEntry = {
      id: `${dividendLedgerEntry.id}:receipt`,
      userId,
      accountId: account.id,
      entryDate,
      entryType: "DIVIDEND_RECEIPT",
      amount: dividendLedgerEntry.receivedCashAmount,
      currency: dividendEvent.cashDividendCurrency,
      relatedDividendLedgerEntryId: dividendLedgerEntry.id,
      source: "dividend_posting",
      sourceReference: dividendLedgerEntry.id,
      bookedAt,
    };
    // KZO-167 path 2: assert each built dividend cash entry's currency
    // matches the booking account's defaultCurrency. The intra-dividend
    // deduction-vs-cashDividendCurrency check below stays — it is a
    // separate invariant.
    assertCashEntryCurrencyMatchesAccount(receiptEntry, account);
    entries.push(receiptEntry);
  }

  for (const deduction of deductions) {
    if (deduction.currencyCode !== dividendEvent.cashDividendCurrency) {
      throw routeError(400, "currency_mismatch", "Dividend deduction currency must match dividend cash currency");
    }

    const deductionEntry: CashLedgerEntry = {
      id: `${dividendLedgerEntry.id}:deduction:${deduction.id}`,
      userId,
      accountId: account.id,
      entryDate,
      entryType: "DIVIDEND_DEDUCTION",
      amount: -deduction.amount,
      currency: dividendEvent.cashDividendCurrency,
      relatedDividendLedgerEntryId: dividendLedgerEntry.id,
      source: deduction.source,
      sourceReference: deduction.sourceReference ?? deduction.id,
      note: deduction.note,
      bookedAt,
    };
    // KZO-167 path 2: also assert each built deduction entry's currency.
    assertCashEntryCurrencyMatchesAccount(deductionEntry, account);
    entries.push(deductionEntry);
  }

  return entries;
}

function buildPostingResult(
  dividendEvent: DividendEvent,
  dividendLedgerEntry: DividendLedgerEntry,
  positionAction: PositionAction | null,
  dividendDeductionEntries: DividendDeductionEntry[],
  dividendSourceLines: DividendSourceLine[],
  linkedCashLedgerEntries: CashLedgerEntry[],
): PostDividendResult {
  dividendLedgerEntry.cashReconciliation = calculateCashReconciliationFromLedger(dividendLedgerEntry, dividendDeductionEntries);
  const comparison = calculateDividendPostingComparison(dividendLedgerEntry, dividendDeductionEntries);
  return {
    dividendEvent,
    dividendLedgerEntry,
    positionAction,
    dividendDeductionEntries,
    dividendSourceLines,
    linkedCashLedgerEntries,
    comparison,
  };
}

function calculateDividendPostingComparison(
  dividendLedgerEntry: DividendLedgerEntry,
  deductions: DividendDeductionEntry[],
): DividendPostingComparison {
  const actualCashEconomicAmount = calculateActualCashEconomicAmount(dividendLedgerEntry.receivedCashAmount, deductions);
  return {
    expectedCashAmount: dividendLedgerEntry.expectedCashAmount,
    actualCashEconomicAmount,
    cashVarianceAmount: actualCashEconomicAmount - dividendLedgerEntry.expectedCashAmount,
    expectedStockQuantity: dividendLedgerEntry.expectedStockQuantity,
    actualStockQuantity: dividendLedgerEntry.receivedStockQuantity,
    stockVarianceQuantity: dividendLedgerEntry.receivedStockQuantity - dividendLedgerEntry.expectedStockQuantity,
  };
}

function calculateActualCashEconomicAmount(receivedCashAmount: number, deductions: DividendDeductionEntry[]): number {
  return (
    receivedCashAmount +
    deductions
      .filter((entry) => entry.withheldAtSource)
      .reduce((sum, entry) => sum + entry.amount, 0)
  );
}

function buildStockDividendPositionAction(
  defaultCurrency: AccountDto["defaultCurrency"],
  dividendEvent: DividendEvent,
  dividendLedgerEntry: DividendLedgerEntry,
  dividendDeductionEntries: DividendDeductionEntry[],
): PositionAction {
  const parValuePerShare = dividendEvent.stockParValueAmount ?? undefined;
  const receivedStockQuantity = dividendLedgerEntry.receivedStockQuantity;
  const parBaseAmount = parValuePerShare == null
    ? 0
    : roundToDecimal(receivedStockQuantity * parValuePerShare, 2);
  const premiumBaseAmount = roundToDecimal(Math.max(0, dividendLedgerEntry.expectedCashAmount), 2);
  const nhiPremiumBaseAmount = roundToDecimal(parBaseAmount + premiumBaseAmount, 2);
  const cashInLieuDeductions = dividendDeductionEntries.filter(
    (entry) => entry.deductionType === "CASH_IN_LIEU_ADJUSTMENT",
  );
  const cashInLieuAmount = roundToDecimal(
    cashInLieuDeductions.reduce((sum, entry) => sum + entry.amount, 0),
    2,
  );
  const cashInLieuCurrency = cashInLieuDeductions[0]?.currencyCode ?? defaultCurrency;

  return {
    id: `position-action-${dividendLedgerEntry.id}`,
    accountId: dividendLedgerEntry.accountId,
    ticker: dividendEvent.ticker,
    marketCode: resolveDividendEventMarketCode(dividendEvent),
    actionType: "STOCK_DIVIDEND",
    actionDate: resolveDividendPostingDate(dividendEvent.paymentDate, dividendLedgerEntry.bookedAt),
    bookedAt: dividendLedgerEntry.bookedAt,
    quantity: receivedStockQuantity,
    cashInLieuAmount: cashInLieuAmount > 0 ? cashInLieuAmount : undefined,
    cashInLieuCurrency: cashInLieuAmount > 0 ? cashInLieuCurrency : undefined,
    parValuePerShare,
    premiumBaseAmount,
    nhiPremiumBaseAmount,
    relatedDividendLedgerEntryId: dividendLedgerEntry.id,
    source: "dividend_posting",
    sourceReference: dividendLedgerEntry.id,
  };
}

function removePositionActionForDividend(store: Store, dividendLedgerEntryId: string): void {
  store.accounting.facts.positionActions = listPositionActions(store).filter(
    (action) => action.relatedDividendLedgerEntryId !== dividendLedgerEntryId,
  );
}

function findBlockingSellAfterStockDividend(
  store: Store,
  dividendEvent: DividendEvent,
  currentEntry: DividendLedgerEntry,
  existingPositionAction?: PositionAction,
) {
  const actionDate = existingPositionAction?.actionDate ?? resolveDividendPostingDate(dividendEvent.paymentDate, currentEntry.bookedAt);
  const actionTimestamp = existingPositionAction?.actionTimestamp ?? null;
  return listTradeEvents(store).find((trade) => {
    if (
      trade.accountId !== currentEntry.accountId ||
      trade.ticker !== dividendEvent.ticker ||
      trade.type !== "SELL" ||
      trade.reversalOfTradeEventId
    ) {
      return false;
    }
    if (trade.tradeDate > actionDate) return true;
    if (trade.tradeDate < actionDate) return false;
    if (trade.tradeTimestamp && actionTimestamp) {
      return trade.tradeTimestamp >= actionTimestamp;
    }
    return true;
  });
}

/**
 * Derive eligible quantity for a dividend event from the CURRENT set of
 * trade events at the ex-dividend boundary (strictly earlier than ex-div —
 * matches the TWSE "held at close of T-1" rule).
 *
 * Used by:
 * - planDividendLedgerRecompute (Rule B recompute on trade mutations)
 * - buildDividendEventListItems when no ledger entry exists yet
 * - buildUpcomingDividends for the dashboard upcoming widget
 */
export function deriveEligibleQuantity(
  store: Store,
  accountId: string,
  ticker: string,
  exDividendDate: string,
  marketCode: MarketCode,
): number {
  const actions = store.accounting.facts.positionActions.filter((action) => action.accountId === accountId && action.ticker === ticker && action.marketCode === marketCode && action.actionDate < exDividendDate);
  if (actions.some((action) => action.actionType === "CASH_CAPITAL_REDUCTION")) return deriveEligibleQuantityFromReplayStream(
    store.accounting.facts.tradeEvents.filter((trade) => trade.accountId === accountId && trade.ticker === ticker && trade.marketCode === marketCode), actions,
    accountId, ticker, marketCode, { exDividendDate },
  );
  return Math.max(
    0,
    store.accounting.facts.tradeEvents
      .filter((entry) => entry.accountId === accountId
        && entry.ticker === ticker
        && entry.marketCode === marketCode
        && entry.tradeDate < exDividendDate)
      .reduce((sum, entry) => sum + (entry.type === "BUY" ? entry.quantity : -entry.quantity), 0),
  );
}

export function resolveDividendEventMarketCode(
  event: Pick<DividendEvent, "marketCode" | "cashDividendCurrency">,
): MarketCode {
  if (event.marketCode && (MARKET_CODES as readonly string[]).includes(event.marketCode)) {
    return event.marketCode as MarketCode;
  }
  return marketCodeFor(event.cashDividendCurrency);
}

export function resolveDividendTickerName(
  store: Store,
  ticker: string,
  marketCode?: MarketCode,
): string | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const matchesTicker = (entry: { ticker: string; marketCode?: string; name?: string | null }): boolean =>
    entry.ticker.trim().toUpperCase() === normalizedTicker
      && (!marketCode || entry.marketCode === marketCode)
      && Boolean(entry.name?.trim());
  const marketInstrument = store.instruments.find(matchesTicker)
    ?? store.marketData.instruments.find(matchesTicker);

  return marketInstrument?.name?.trim() ?? null;
}

/**
 * Compute the set of dividend ledger entry changes required to bring the
 * stored snapshot in line with current trades (Rule B recompute).
 *
 * Pure — produces a change plan without touching persistence. Callers apply
 * the plan via persistence.applyDividendLedgerRecompute() and emit SSE for
 * any entry whose reconciliation_status was reset.
 *
 * @param store             in-memory store reflecting the current trade set
 * @param accountId         scope of the recompute (one account)
 * @param ticker            scope of the recompute (one ticker)
 * @param resetReconciliation
 *   When `true` (runtime trade mutation path): matched/explained rows whose
 *   expected_* actually changed are reset to 'open' (note preserved per 1a).
 *   When `false` (startup backfill path): reconciliation is left alone.
 */
/**
 * Startup backfill entry point. Iterates every distinct
 * (userId, accountId, ticker) scope with at least one active dividend
 * ledger entry, recomputes expected_* from current trades, and applies any
 * changes WITHOUT resetting reconciliation_status (4b — retroactive
 * correction should not silently flip previously-matched rows).
 *
 * Returns the total number of ledger rows rewritten. Logs nothing (callers
 * pass their own logger).
 */
export async function runDividendLedgerBackfill(persistence: {
  listDividendLedgerScopes: () => Promise<Array<{ userId: string; accountId: string; ticker: string }>>;
  loadStore: (userId: string) => Promise<Store>;
  applyDividendLedgerRecompute: (
    userId: string,
    changes: DividendLedgerRecomputeChange[],
  ) => Promise<DividendLedgerRecomputeChange[]>;
}): Promise<number> {
  const scopes = await persistence.listDividendLedgerScopes();
  if (scopes.length === 0) return 0;

  // Group by userId so we only load each user's store once.
  const byUser = new Map<string, Array<{ accountId: string; ticker: string }>>();
  for (const scope of scopes) {
    const list = byUser.get(scope.userId) ?? [];
    list.push({ accountId: scope.accountId, ticker: scope.ticker });
    byUser.set(scope.userId, list);
  }

  let totalApplied = 0;
  for (const [userId, userScopes] of byUser) {
    const store = await persistence.loadStore(userId);
    for (const { accountId, ticker } of userScopes) {
      const changes = planDividendLedgerRecompute(store, accountId, ticker, {
        resetReconciliation: false,
      });
      if (changes.length === 0) continue;
      const applied = await persistence.applyDividendLedgerRecompute(userId, changes);
      totalApplied += applied.length;
    }
  }
  return totalApplied;
}

export function reconcileDividendEntitlementsForScope(
  store: Store,
  accountId: string,
  ticker: string,
  options: {
    marketCode?: MarketCode;
    reopenChangedReconciliation: boolean;
    eligibleQuantityResolver?: DividendLedgerEligibleQuantityResolver;
    now?: string;
  },
): DividendLedgerRecomputeChange[] {
  const now = options.now ?? new Date().toISOString();
  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  const ledgerEntries = listDividendLedgerEntries(store);
  const reversedLedgerEntryIds = new Set(
    ledgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((value): value is string => Boolean(value)),
  );
  const activeEntries = ledgerEntries.filter((entry) => {
    if (entry.accountId !== accountId) return false;
    if (entry.reversalOfDividendLedgerEntryId || entry.supersededAt || reversedLedgerEntryIds.has(entry.id)) return false;
    const dividendEvent = eventById.get(entry.dividendEventId);
    if (!dividendEvent) return false;
    if (dividendEvent.ticker !== ticker) return false;
    const dividendMarketCode = resolveDividendEventMarketCode(dividendEvent);
    return options.marketCode === undefined || dividendMarketCode === options.marketCode;
  });
  const activeEntryByEventId = new Map(activeEntries.map((entry) => [entry.dividendEventId, entry]));
  const seenEventIds = new Set<string>();
  const changes: DividendLedgerRecomputeChange[] = [];

  for (const dividendEvent of store.marketData.dividendEvents) {
    if (dividendEvent.ticker !== ticker) continue;
    const dividendMarketCode = resolveDividendEventMarketCode(dividendEvent);
    if (options.marketCode !== undefined && dividendMarketCode !== options.marketCode) continue;

    seenEventIds.add(dividendEvent.id);
    const eligibleQuantity = options.eligibleQuantityResolver
      ? options.eligibleQuantityResolver(dividendEvent, dividendMarketCode)
      : deriveEligibleQuantity(store, accountId, ticker, dividendEvent.exDividendDate, dividendMarketCode);
    const nextExpected = buildExpectedDividendEntitlement(eligibleQuantity, dividendEvent);
    const activeEntry = activeEntryByEventId.get(dividendEvent.id);

    if (!activeEntry) {
      if (eligibleQuantity <= 0) continue;
      const createdEntry = materializeExpectedDividendEntry(store, randomUUID(), accountId, dividendEvent, eligibleQuantity);
      changes.push({
        changeKind: "created",
        ledgerEntryId: createdEntry.id,
        accountId,
        dividendEventId: dividendEvent.id,
        previousVersion: 0,
        nextVersion: createdEntry.version,
        previousEligibleQuantity: 0,
        nextEligibleQuantity: createdEntry.eligibleQuantity,
        previousExpectedCashAmount: 0,
        nextExpectedCashAmount: createdEntry.expectedCashAmount,
        previousExpectedStockQuantity: 0,
        nextExpectedStockQuantity: createdEntry.expectedStockQuantity,
        reconciliationReset: false,
        previousReconciliationStatus: "open",
        nextReconciliationStatus: createdEntry.reconciliationStatus,
        reconciliationNote: createdEntry.reconciliationNote,
        nextEntry: createdEntry,
      });
      continue;
    }

    const expectedChanged =
      activeEntry.eligibleQuantity !== eligibleQuantity
      || activeEntry.expectedCashAmount !== nextExpected.expectedCashAmount
      || activeEntry.expectedStockQuantity !== nextExpected.expectedStockQuantity
      || activeEntry.expectedStockCalcState !== nextExpected.expectedStockCalcState
      || (activeEntry.expectedStockDistributionRatio ?? null) !== (nextExpected.expectedStockDistributionRatio ?? null)
      || (activeEntry.expectedStockParValueAmount ?? null) !== (nextExpected.expectedStockParValueAmount ?? null);

    if (activeEntry.postingStatus === "expected" && eligibleQuantity <= 0) {
      const retiredEntry: DividendLedgerEntry = {
        ...activeEntry,
        ...nextExpected,
        eligibleQuantity,
        version: activeEntry.version + 1,
        supersededAt: now,
      };
      upsertDividendLedgerEntry(store, retiredEntry);
      changes.push({
        changeKind: "retired",
        ledgerEntryId: retiredEntry.id,
        accountId,
        dividendEventId: dividendEvent.id,
        previousVersion: activeEntry.version,
        nextVersion: retiredEntry.version,
        previousEligibleQuantity: activeEntry.eligibleQuantity,
        nextEligibleQuantity: eligibleQuantity,
        previousExpectedCashAmount: activeEntry.expectedCashAmount,
        nextExpectedCashAmount: retiredEntry.expectedCashAmount,
        previousExpectedStockQuantity: activeEntry.expectedStockQuantity,
        nextExpectedStockQuantity: retiredEntry.expectedStockQuantity,
        reconciliationReset: false,
        previousReconciliationStatus: activeEntry.reconciliationStatus,
        nextReconciliationStatus: retiredEntry.reconciliationStatus,
        reconciliationNote: retiredEntry.reconciliationNote,
        nextEntry: retiredEntry,
      });
      continue;
    }

    if (!expectedChanged) continue;

    const shouldReopen = options.reopenChangedReconciliation
      && activeEntry.postingStatus !== "expected"
      && activeEntry.reconciliationStatus !== "open";
    const updatedEntry: DividendLedgerEntry = {
      ...activeEntry,
      ...nextExpected,
      eligibleQuantity,
      reconciliationStatus: shouldReopen ? "open" : activeEntry.reconciliationStatus,
      version: activeEntry.version + 1,
    };
    upsertDividendLedgerEntry(store, updatedEntry);
    changes.push({
      changeKind: "updated",
      ledgerEntryId: updatedEntry.id,
      accountId,
      dividendEventId: dividendEvent.id,
      previousVersion: activeEntry.version,
      nextVersion: updatedEntry.version,
      previousEligibleQuantity: activeEntry.eligibleQuantity,
      nextEligibleQuantity: updatedEntry.eligibleQuantity,
      previousExpectedCashAmount: activeEntry.expectedCashAmount,
      nextExpectedCashAmount: updatedEntry.expectedCashAmount,
      previousExpectedStockQuantity: activeEntry.expectedStockQuantity,
      nextExpectedStockQuantity: updatedEntry.expectedStockQuantity,
      reconciliationReset: shouldReopen,
      previousReconciliationStatus: activeEntry.reconciliationStatus,
      nextReconciliationStatus: updatedEntry.reconciliationStatus,
      reconciliationNote: updatedEntry.reconciliationNote,
      nextEntry: updatedEntry,
    });
  }

  return changes;
}

export function planDividendLedgerRecompute(
  store: Store,
  accountId: string,
  ticker: string,
  options: {
    resetReconciliation: boolean;
    marketCode?: MarketCode;
    eligibleQuantityResolver?: DividendLedgerEligibleQuantityResolver;
  },
): DividendLedgerRecomputeChange[] {
  const supersededIds = new Set(
    store.accounting.facts.dividendLedgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((id): id is string => Boolean(id)),
  );

  const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));

  const changes: DividendLedgerRecomputeChange[] = [];

  for (const entry of store.accounting.facts.dividendLedgerEntries) {
    if (entry.accountId !== accountId) continue;
    if (entry.reversalOfDividendLedgerEntryId) continue;
    if (entry.supersededAt) continue;
    if (supersededIds.has(entry.id)) continue;

    const dividendEvent = eventById.get(entry.dividendEventId);
    if (!dividendEvent) continue;
    if (dividendEvent.ticker !== ticker) continue;
    const dividendMarketCode = resolveDividendEventMarketCode(dividendEvent);
    if (options.marketCode !== undefined && dividendMarketCode !== options.marketCode) continue;

    const nextEligibleQuantity = options.eligibleQuantityResolver
      ? options.eligibleQuantityResolver(dividendEvent, dividendMarketCode)
      : deriveEligibleQuantity(store, accountId, ticker, dividendEvent.exDividendDate, dividendMarketCode);
    const nextExpected = buildExpectedDividendEntitlement(nextEligibleQuantity, dividendEvent);
    const nextExpectedCashAmount = nextExpected.expectedCashAmount;
    const nextExpectedStockQuantity = nextExpected.expectedStockQuantity;

    // 1b: full no-op when every expected field matches the stored snapshot.
    if (
      entry.eligibleQuantity === nextEligibleQuantity
      && entry.expectedCashAmount === nextExpectedCashAmount
      && entry.expectedStockQuantity === nextExpectedStockQuantity
      && entry.expectedStockCalcState === nextExpected.expectedStockCalcState
      && (entry.expectedStockDistributionRatio ?? null) === (nextExpected.expectedStockDistributionRatio ?? null)
      && (entry.expectedStockParValueAmount ?? null) === (nextExpected.expectedStockParValueAmount ?? null)
    ) {
      continue;
    }

    const previousStatus = entry.reconciliationStatus;
    const shouldResetReconciliation
      = options.resetReconciliation
      && (previousStatus === "matched" || previousStatus === "explained");
    const nextStatus = shouldResetReconciliation ? ("open" as const) : previousStatus;

    const nextEntry: DividendLedgerEntry = {
      ...entry,
      ...nextExpected,
      eligibleQuantity: nextEligibleQuantity,
      reconciliationStatus: nextStatus,
      version: entry.version + 1,
    };
    changes.push({
      ledgerEntryId: entry.id,
      accountId: entry.accountId,
      dividendEventId: entry.dividendEventId,
      previousVersion: entry.version,
      nextVersion: entry.version + 1,
      previousEligibleQuantity: entry.eligibleQuantity,
      nextEligibleQuantity,
      previousExpectedCashAmount: entry.expectedCashAmount,
      nextExpectedCashAmount,
      previousExpectedStockQuantity: entry.expectedStockQuantity,
      nextExpectedStockQuantity,
      reconciliationReset: shouldResetReconciliation,
      previousReconciliationStatus: previousStatus,
      nextReconciliationStatus: nextStatus,
      // 1a: preserve the note even on explained → open transitions so the
      // user can reuse it when re-reconciling.
      reconciliationNote: entry.reconciliationNote,
      nextEntry,
    });
  }

  return changes;
}

function resolveDividendInstrumentType(store: Store, ticker: string): InstrumentType {
  return (
    store.instruments.find((entry) => entry.ticker === ticker)?.type ??
    store.marketData.instruments.find((entry) => entry.ticker === ticker)?.instrumentType ??
    "STOCK"
  );
}

export function resolveDividendPostingDate(paymentDate: string | null | undefined, bookedAt?: string): string {
  if (paymentDate) {
    return paymentDate;
  }
  if (bookedAt) {
    return bookedAt.slice(0, 10);
  }
  return new Date().toISOString().slice(0, 10);
}

function compareNullableDates(left: string | null | undefined, right: string | null | undefined): number {
  return (left ?? "").localeCompare(right ?? "");
}

function calculateExpectedCashAmount(eligibleQuantity: number, cashDividendPerShare: number): number {
  return roundCurrencyAmount(eligibleQuantity * cashDividendPerShare);
}

function buildExpectedDividendEntitlement(
  eligibleQuantity: number,
  dividendEvent: Pick<
    DividendEvent,
    "eventType" | "cashDividendPerShare" | "stockDistributionRatio" | "stockDistributionRatioState" | "stockParValueAmount"
  >,
): Pick<
  DividendLedgerEntry,
  | "expectedCashAmount"
  | "expectedStockQuantity"
  | "expectedStockCalcState"
  | "expectedStockDistributionRatio"
  | "expectedStockParValueAmount"
  | "cashReconciliation"
> {
  const expectedCashAmount = calculateExpectedCashAmount(eligibleQuantity, dividendEvent.cashDividendPerShare);
  return {
    expectedCashAmount,
    ...resolveExpectedStockEntitlement(eligibleQuantity, dividendEvent),
    expectedStockParValueAmount: dividendEvent.stockParValueAmount ?? null,
    cashReconciliation: calculateDividendCashReconciliation({
      expectedGrossAmount: expectedCashAmount,
      actualNetAmount: 0,
    }),
  };
}

function roundCurrencyAmount(value: number): number {
  return Math.max(0, Math.round(value + Number.EPSILON));
}

function assertDividendPostingPayload(
  input: Pick<PostDividendInput, "receivedCashAmount" | "receivedStockQuantity" | "deductions">,
): void {
  if (input.receivedCashAmount === 0 && input.receivedStockQuantity === 0 && input.deductions.length === 0) {
    throw routeError(400, "invalid_dividend_posting", "Dividend posting must include cash, stock, or deductions");
  }
}

function assertDividendEventShape(input: CreateDividendEventInput): void {
  if (input.paymentDate && input.paymentDate < input.exDividendDate) {
    throw routeError(400, "invalid_dividend_dates", "Payment date must not be earlier than ex-dividend date");
  }

  if (input.cashDividendPerShare < 0 || input.stockDividendPerShare < 0) {
    throw routeError(400, "invalid_dividend_values", "Dividend per-share values must be non-negative");
  }

  if (input.stockDistributionRatio != null && input.stockDistributionRatio < 0) {
    throw routeError(400, "invalid_dividend_values", "Dividend stock ratio must be non-negative");
  }

  if (input.stockParValueAmount != null && input.stockParValueAmount < 0) {
    throw routeError(400, "invalid_dividend_values", "Dividend stock par value must be non-negative");
  }

  const hasCash = input.cashDividendPerShare > 0;
  const hasStock = input.stockDividendPerShare > 0;

  if (input.eventType === "CASH" && (!hasCash || hasStock)) {
    throw routeError(400, "invalid_dividend_shape", "Cash dividend events must only include cash per-share value");
  }

  if (input.eventType === "STOCK" && (hasCash || !hasStock)) {
    throw routeError(400, "invalid_dividend_shape", "Stock dividend events must only include stock per-share value");
  }

  if (input.eventType === "CASH_AND_STOCK" && (!hasCash || !hasStock)) {
    throw routeError(400, "invalid_dividend_shape", "Cash-and-stock dividend events must include both per-share values");
  }
}

function resolveExpectedStockEntitlement(
  eligibleQuantity: number,
  dividendEvent: Pick<DividendEvent, "eventType" | "stockDistributionRatio" | "stockDistributionRatioState">,
): Pick<DividendLedgerEntry, "expectedStockQuantity" | "expectedStockCalcState" | "expectedStockDistributionRatio"> {
  const resolved = resolveDividendStockEntitlement({
    eligibleQuantity,
    stockEntitlementRequired: dividendEvent.eventType !== "CASH",
    stockDistributionRatio: dividendEvent.stockDistributionRatio ?? null,
    stockDistributionRatioState: dividendEvent.stockDistributionRatioState ?? "unresolved",
  });
  return {
    expectedStockQuantity: resolved.expectedStockQuantity,
    expectedStockCalcState: resolved.expectedStockCalcState,
    expectedStockDistributionRatio: resolved.stockDistributionRatio,
  };
}

function calculateCashReconciliationFromLedger(
  dividendLedgerEntry: Pick<DividendLedgerEntry, "expectedCashAmount" | "receivedCashAmount">,
  deductions: readonly DividendDeductionEntry[],
) {
  return calculateDividendCashReconciliation({
    expectedGrossAmount: dividendLedgerEntry.expectedCashAmount,
    actualNetAmount: dividendLedgerEntry.receivedCashAmount,
    deductions: {
      nhiAmount: sumDeductionAmounts(deductions, new Set(["NHI_SUPPLEMENTAL_PREMIUM"])),
      bankFeeAmount: sumDeductionAmounts(deductions, new Set(["BANK_FEE"])),
      otherDeductionAmount: sumDeductionAmounts(
        deductions,
        new Set(["BROKER_FEE", "TRANSFER_FEE", "WITHHOLDING_TAX", "CASH_IN_LIEU_ADJUSTMENT", "ROUNDING_ADJUSTMENT", "OTHER"]),
      ),
    },
  });
}

function sumDeductionAmounts(
  deductions: readonly DividendDeductionEntry[],
  kinds: ReadonlySet<DividendDeductionType>,
): number {
  return deductions
    .filter((entry) => kinds.has(entry.deductionType))
    .reduce((sum, entry) => sum + entry.amount, 0);
}
