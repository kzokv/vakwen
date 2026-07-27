import type {
  AccountDefaultCurrency,
  AccountDto,
  PortfolioCapabilitiesDto,
  PortfolioSelectionNormalizationResult,
} from "./index.js";

// System event types
export interface HeartbeatEvent {
  type: "heartbeat";
}

export interface SSEErrorEvent {
  type: "error";
  code: string;
  message?: string;
}

// Domain event types
export interface RecomputeCompleteEvent {
  type: "recompute_complete";
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
}

export interface RecomputeFailedEvent {
  type: "recompute_failed";
  accountId: string;
  ticker: string;
  reason: string;
  retriesExhausted: boolean;
}

// Backfill event types (KZO-126)
export interface BackfillStartedEvent {
  type: "backfill_started";
  ticker: string;
}

export interface BackfillCompleteEvent {
  type: "backfill_complete";
  ticker: string;
  barsCount: number;
  dividendsCount: number;
}

export interface BackfillFailedEvent {
  type: "backfill_failed";
  ticker: string;
  reason: string;
  retriesExhausted: boolean;
}

export interface RepairStartedEvent {
  type: "repair_started";
  ticker: string;
}

export interface RepairCompleteEvent {
  type: "repair_complete";
  ticker: string;
  barsCount: number;
  dividendsCount: number;
}

export interface RepairFailedEvent {
  type: "repair_failed";
  ticker: string;
  reason: string;
  retriesExhausted: boolean;
}

export interface DailyRefreshCompleteEvent {
  type: "daily_refresh_complete";
  ticker: string;
  barsCount: number;
  dividendsCount: number;
}

export interface DailyRefreshFailedEvent {
  type: "daily_refresh_failed";
  ticker: string;
  reason: string;
}

export interface DailyRefreshSummaryEvent {
  type: "daily_refresh_summary";
  batchId: string;
  totalTickers: number;
  succeeded: number;
  failed: number;
  severity: "info" | "warning" | "error";
}

export interface DividendPostedEvent {
  type: "dividend_posted";
  dividendLedgerEntryId: string;
  dividendEventId: string;
  accountId: string;
  version: number;
}

export interface DividendUpdatedEvent {
  type: "dividend_updated";
  dividendLedgerEntryId: string;
  dividendEventId: string;
  accountId: string;
  version: number;
}

export interface DividendReconciliationChangedEvent {
  type: "dividend_reconciliation_changed";
  dividendLedgerEntryId: string;
  dividendEventId: string;
  accountId: string;
  reconciliationStatus: "open" | "matched" | "explained" | "resolved";
  version: number;
}

export interface SnapshotsGeneratedEvent {
  type: "snapshots_generated";
  /** "ok" when generation succeeded; "error" when it failed — totals will be 0 and `error` holds the reason. */
  status: "ok" | "error";
  totalRows: number;
  provisionalRows: number;
  dateRange: { from: string; to: string } | null;
  generationRunId: string;
  error?: string;
  trigger?: "dividend_destructive_replay";
  scopes?: Array<{ accountId: string; ticker: string; marketCode: string }>;
}

/**
 * KZO-165: emitted when the currency wallet snapshot aggregator fails AFTER
 * `generateHoldingSnapshots` already succeeded. Distinct event so the holding
 * snapshot success isn't silently masked by the wallet failure.
 */
export interface WalletGenerationFailedEvent {
  type: "wallet_generation_failed";
  error: string;
}

/**
 * KZO-168: emitted by FX-transfer create / update / reverse routes after the
 * paired cash-ledger legs are persisted and currency-wallet snapshots have
 * been regenerated. The payload carries one entry per affected wallet so
 * cash-ledger / dashboard / account-balance consumers can refetch precisely
 * the wallets that changed without scanning every account.
 *
 * This is **not** the same shape as `RecomputeCompleteEvent`, which is keyed
 * by `(accountId, ticker)` for trade-event recomputes. Reusing that event
 * here would silently feed `undefined` into transaction-mutation consumers
 * that read `event.accountId` / `event.ticker`.
 */
export interface CurrencyWalletRecomputedEvent {
  type: "currency_wallet_recomputed";
  cashBalanceChanges: Array<{
    accountId: string;
    currency: string;
    delta: number;
  }>;
}

export interface PortfolioTransactionsChangedEvent {
  type: "portfolio_transactions_changed";
  reason: "posted_transaction_mutation_committed";
  runId: string;
  previewId: string;
  operation: "update" | "delete";
  affectedAccountIds: string[];
  affectedTickers: Array<{ ticker: string; marketCode: string }>;
  invalidatedReads: string[];
  invalidatedRoutes: string[];
}

export interface PortfolioHoldingsChangedEvent {
  type: "portfolio_holdings_changed";
  reason: "posted_transaction_mutation_committed";
  runId: string;
  previewId: string;
  operation: "update" | "delete";
  affectedAccountIds: string[];
  affectedTickers: Array<{ ticker: string; marketCode: string }>;
  invalidatedReads: string[];
  invalidatedRoutes: string[];
}

export interface PortfolioDividendsChangedEvent {
  type: "portfolio_dividends_changed";
  reason: "posted_transaction_mutation_committed";
  runId: string;
  previewId: string;
  operation: "update" | "delete";
  affectedAccountIds: string[];
  affectedTickers: Array<{ ticker: string; marketCode: string }>;
  invalidatedReads: string[];
  invalidatedRoutes: string[];
}

export interface AuditLogChangedEvent {
  type: "audit_log_changed";
  reason: "posted_transaction_mutation_committed";
  runId: string;
  previewId: string;
  action: "delegated_portfolio_write";
  invalidatedReads: string[];
  invalidatedRoutes: string[];
}

export interface PostedTransactionMutationRebuildEvent {
  type: "posted_transaction_mutation_rebuild";
  runId: string;
  previewId: string;
  operation: "update" | "delete";
  status: "queued" | "running" | "completed" | "partially_failed" | "failed";
  affectedAccountIds: string[];
  affectedTickers: Array<{ ticker: string; marketCode: string }>;
}

/**
 * ui-enhancement — account lifecycle events.
 *
 * Account soft-delete is a row mutation (sets `accounts.deleted_at`); the
 * client refetches `GET /accounts` + `GET /accounts/deleted` on receipt.
 * Restore and hard-purge follow the same refetch contract. `finalName` on
 * restore lets the UI surface the post-collision-resolution name without a
 * round-trip to `GET /accounts/deleted`.
 */
export interface AccountSoftDeletedEvent {
  type: "account_soft_deleted";
  accountId: string;
  deletedAt: string; // ISO
  account: AccountDto;
  capabilities: PortfolioCapabilitiesDto;
  reportingCurrency: PortfolioSelectionNormalizationResult<AccountDefaultCurrency>;
}

export interface AccountRestoredEvent {
  type: "account_restored";
  accountId: string;
  finalName: string; // post-collision-resolution
  account: AccountDto;
  capabilities: PortfolioCapabilitiesDto;
  reportingCurrency: PortfolioSelectionNormalizationResult<AccountDefaultCurrency>;
}

export interface AccountHardPurgedEvent {
  type: "account_hard_purged";
  accountId: string;
  deletedAt: string | null;
  account: AccountDto;
  capabilities: PortfolioCapabilitiesDto;
  reportingCurrency: PortfolioSelectionNormalizationResult<AccountDefaultCurrency>;
}

export interface AccountCreatedEvent {
  type: "account_created";
  accountId: string;
  account: AccountDto;
  feeProfile: import("./index.js").FeeProfileDto;
  capabilities: PortfolioCapabilitiesDto;
  reportingCurrency: PortfolioSelectionNormalizationResult<AccountDefaultCurrency>;
}

export interface AccountUpdatedEvent {
  type: "account_updated";
  accountId: string;
  account: AccountDto;
  feeProfile: import("./index.js").FeeProfileDto;
  capabilities: PortfolioCapabilitiesDto;
  reportingCurrency: PortfolioSelectionNormalizationResult<AccountDefaultCurrency>;
  changedFields?: string[];
}

// Discriminated union
export type SSEEvent =
  | HeartbeatEvent
  | SSEErrorEvent
  | RecomputeCompleteEvent
  | RecomputeFailedEvent
  | BackfillStartedEvent
  | BackfillCompleteEvent
  | BackfillFailedEvent
  | RepairStartedEvent
  | RepairCompleteEvent
  | RepairFailedEvent
  | DailyRefreshCompleteEvent
  | DailyRefreshFailedEvent
  | DailyRefreshSummaryEvent
  | DividendPostedEvent
  | DividendUpdatedEvent
  | DividendReconciliationChangedEvent
  | SnapshotsGeneratedEvent
  | WalletGenerationFailedEvent
  | CurrencyWalletRecomputedEvent
  | PortfolioTransactionsChangedEvent
  | PortfolioHoldingsChangedEvent
  | PortfolioDividendsChangedEvent
  | AuditLogChangedEvent
  | PostedTransactionMutationRebuildEvent
  | AccountCreatedEvent
  | AccountUpdatedEvent
  | AccountSoftDeletedEvent
  | AccountRestoredEvent
  | AccountHardPurgedEvent;

// System types (used internally for SSE wire format)
export type SSESystemEventType = "heartbeat" | "error";
export type SSEDomainEventType =
  | "recompute_complete"
  | "recompute_failed"
  | "backfill_started"
  | "backfill_complete"
  | "backfill_failed"
  | "repair_started"
  | "repair_complete"
  | "repair_failed"
  | "daily_refresh_complete"
  | "daily_refresh_failed"
  | "daily_refresh_summary"
  | "dividend_posted"
  | "dividend_updated"
  | "dividend_reconciliation_changed"
  | "snapshots_generated"
  | "wallet_generation_failed"
  | "currency_wallet_recomputed"
  | "portfolio_transactions_changed"
  | "portfolio_holdings_changed"
  | "portfolio_dividends_changed"
  | "audit_log_changed"
  | "posted_transaction_mutation_rebuild"
  | "account_created"
  | "account_updated"
  | "account_soft_deleted"
  | "account_restored"
  | "account_hard_purged";
export type SSEEventType = SSESystemEventType | SSEDomainEventType;
