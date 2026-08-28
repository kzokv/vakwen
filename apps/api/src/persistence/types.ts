import type { BackfillStatus, CurrencyCode, InstrumentRef, InstrumentType, Lot, VerificationStatus } from "@vakwen/domain";
import type {
  AccountMarketDividendSettingsDto,
  DividendCalculationAmendRequestDto,
  DividendCalculationConfirmRequestDto,
  DividendCalculationResetRequestDto,
  DividendCalculationVersionDto,
  AiConnectorAccessKind,
  AiConnectorAccessResult,
  AiConnectorAuthMode,
  AiConnectorCapability,
  AiConnectorClientKind,
  AiConnectorConnectionDto,
  AiConnectorPolicySettingsDto,
  AiConnectorProvider,
  AiConnectorScope,
  AiConnectorStatus,
  AiConnectorVendor,
  AiTransactionDraftBatchStatus,
  AiTransactionDraftEventType,
  AiTransactionDraftRowState,
  AiTransactionDraftSourceChannel,
  DividendLedgerAggregates,
  DividendReviewAccountOptionDto,
  DividendReviewEnrichmentDto,
  DividendReviewFilterDto,
  DividendReviewPrimaryQueryDto,
  DividendReviewRowSummaryDto,
  DividendReviewSortColumn,
  DividendReviewTickerOptionDto,
  DividendSourceLine,
  ShareCapability,
  InstrumentOptionDto,
  TickerFundamentalsDto,
} from "@vakwen/shared-types";
import type { DividendLedgerRecomputeChange } from "../services/dividends.js";
import type { FxRate, MarketDataResolverMode } from "../services/market-data/types.js";
import type {
  ResearchIdentityRecord,
  ResearchIdentityRecordQuery,
} from "../services/research/identity.js";
import type {
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  DividendLedgerEntry,
  DividendPostingStatus,
  LotAllocationProjection,
  MarketDataFacts,
  PositionAction,
  RecomputeJob,
  Store,
  InstrumentDef,
} from "../types/store.js";

export interface SaveStoreOptions {
  expectedAccountRevisions?: Record<string, number>;
}
import type { DailyBar, DailyBarWithMarket, IntradayPriceOverlay, MarketCode } from "@vakwen/domain";
import type {
  AdminAuditLogResponse,
  AdminInviteListResponse,
  AdminUserListResponse,
  AdminUserStatus,
  InstrumentCatalogItemDto,
  InviteListStatus,
  JpCatalogStockType,
  MarketCode as SharedMarketCode,
  MonitoredTickerDto,
  NotificationDto,
  ProfileDto,
  UserSettings,
} from "@vakwen/shared-types";

/**
 * KZO-198 — names of the plain (non-encrypted) Tier 1/2 columns that can be
 * written via `setAppConfigField`. The set MUST stay in lockstep with the
 * `app_config` schema (migration 047) and `AppConfigCacheEntry`.
 */
export type AppConfigPlainField =
  | "marketDataPriceWindowMs"
  | "marketDataPriceLimit"
  | "marketDataSearchWindowMs"
  | "marketDataSearchLimit"
  | "inviteStatusWindowMs"
  | "inviteStatusLimit"
  | "providerDownNotificationSuppressionMs"
  | "providerErrorTrailRetentionDays"
  | "providerRerunCooldownMs"
  // KZO-197 — yahoo-finance-au rerun cooldown override (Tier 1).
  | "yahooAuRerunCooldownMs"
  | "providerFixerDangerousMatchThreshold"
  | "providerFixerPreviewSampleLimit"
  | "providerFixerUiPageSize"
  | "providerFixerAutoPauseFailuresPerMinute"
  | "providerFixerPreviewTokenTtlMinutes"
  | "providerOperationAutoRenewIntervalMinutes"
  | "providerIncidentRecurrenceWindowMinutes"
  | "providerHealthWarningUnresolvedThreshold"
  | "providerHealthCriticalUnresolvedThreshold"
  | "providerOperationStaleHeartbeatMinutes"
  | "providerOperationSummaryRetentionDays"
  | "providerOperationLogRetentionDays"
  | "providerIncidentRetentionDays"
  | "providerResolvedItemRetentionDays"
  | "finmindProviderRateLimitPerHour"
  | "twelveDataProviderRateLimitPerMinute"
  | "yahooAuProviderRateLimitPerMinute"
  | "yahooKrProviderRateLimitPerMinute"
  | "yahooJpProviderRateLimitPerMinute"
  | "frankfurterProviderRateLimitPerMinute"
  | "asxGicsProviderRateLimitPerHour"
  | "finmindProviderMinRequestIntervalMs"
  | "twelveDataProviderMinRequestIntervalMs"
  | "yahooAuProviderMinRequestIntervalMs"
  | "yahooKrProviderMinRequestIntervalMs"
  | "yahooJpProviderMinRequestIntervalMs"
  | "frankfurterProviderMinRequestIntervalMs"
  | "asxGicsProviderMinRequestIntervalMs"
  | "jpCatalogAllowedStockTypes"
  | "jpCatalogIncludeDepositaryReceipts"
  | "jpCatalogIncludeAtSymbols"
  | "backfillRetryLimit"
  | "backfillRetryDelaySeconds"
  | "backfillFinmind402RetryMs"
  | "tickerPriceCloseRefreshGraceMinutes"
  | "tickerPriceIntradayEnabled"
  | "tickerPriceIntradayRefreshIntervalMinutes"
  | "tickerPriceIntradayFreshnessToleranceMinutes"
  | "tickerPriceYahooChartRequestLimitPerMinute"
  | "tickerPriceQueueConcurrency"
  | "tickerPriceMaxTickersPerRefreshCycle"
  | "tickerPriceSupportedMarkets"
  | "tickerPriceRegularSessionOnly"
  | "tickerPriceYahooChartRange"
  | "tickerPriceYahooChartInterval"
  | "tickerPriceRefreshCloseRateLimitWindowMs"
  | "tickerPriceRefreshCloseRateLimitMax"
  | "tickerPriceSyncTickerCap"
  | "tickerPriceActivityDetailedRetentionDays"
  | "tickerPriceActivitySummaryRetentionDays"
  | "tickerPriceCalendarHistoryRetentionDays"
  | "dailyRefreshLookbackDays"
  | "dailyRefreshPriority"
  | "sseHeartbeatIntervalMs"
  | "sseMaxConnectionsPerUser"
  | "sseBufferDefaultTtlMs"
  // KZO-195 — Tier 2 hybrid env+app_config delisting-detection knobs.
  | "catalogAbsenceThreshold"
  | "catalogAbsenceGuardPercent"
  | "catalogAbsenceGuardFloor"
  // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
  | "anonymousShareTokenCap"
  | "anonymousShareRateLimitMax"
  | "anonymousShareRateLimitWindowMs"
  // ui-enhancement — Tier B account-soft-delete grace period.
  | "accountHardPurgeDays"
  | "valuationHealthRelativeBps"
  | "valuationHealthAbsoluteAud"
  | "valuationHealthAbsoluteUsd"
  | "valuationHealthAbsoluteTwd"
  | "valuationHealthAbsoluteKrw"
  | "valuationHealthAbsoluteJpy"
  | "routeCacheDashboardPrimaryTtlMs"
  | "routeCacheDashboardEnrichmentTtlMs"
  | "routeCacheDashboardPerformanceTtlMs"
  | "routeCachePortfolioTtlMs"
  | "routeCacheReportsTtlMs"
  | "routeCacheStaleUsableTtlMs"
  | "eodhdDailyCallLimit";

export type AppConfigPlainValue =
  | number
  | boolean
  | SharedMarketCode[]
  | JpCatalogStockType[]
  | "1d"
  | "5d"
  | "1m"
  | "2m"
  | "5m"
  | "15m"
  | null;

/**
 * KZO-198 — aggregate patch shape accepted by `setAppConfigPatch`. Each key
 * is optional; absent keys are not touched. Tier 0 secret keys carry the
 * plaintext (the implementation encrypts inline) or `null` to clear.
 */
export type AppConfigPatch = Partial<Record<AppConfigPlainField, AppConfigPlainValue>> & {
  finmindApiToken?: string | null;
  twelveDataApiKey?: string | null;
  eodhdApiKey?: string | null;
  mcpOauthTokenSecret?: string | null;
};

/**
 * Mapping from `AppConfigPlainField` to its underlying `app_config` column.
 * Used by Postgres + Memory persistence to translate the camelCase API into
 * snake_case SQL identifiers. Exported so route-layer audit metadata can echo
 * the canonical column names if needed.
 */
export const APP_CONFIG_PLAIN_COLUMNS: Record<AppConfigPlainField, string> = {
  marketDataPriceWindowMs: "market_data_price_window_ms",
  marketDataPriceLimit: "market_data_price_limit",
  marketDataSearchWindowMs: "market_data_search_window_ms",
  marketDataSearchLimit: "market_data_search_limit",
  inviteStatusWindowMs: "invite_status_window_ms",
  inviteStatusLimit: "invite_status_limit",
  providerDownNotificationSuppressionMs: "provider_down_notification_suppression_ms",
  providerErrorTrailRetentionDays: "provider_error_trail_retention_days",
  providerRerunCooldownMs: "provider_rerun_cooldown_ms",
  // KZO-197 — yahoo-finance-au rerun cooldown override.
  yahooAuRerunCooldownMs: "yahoo_au_rerun_cooldown_ms",
  providerFixerDangerousMatchThreshold: "provider_fixer_dangerous_match_threshold",
  providerFixerPreviewSampleLimit: "provider_fixer_preview_sample_limit",
  providerFixerUiPageSize: "provider_fixer_ui_page_size",
  providerFixerAutoPauseFailuresPerMinute: "provider_fixer_auto_pause_failures_per_minute",
  providerFixerPreviewTokenTtlMinutes: "provider_fixer_preview_token_ttl_minutes",
  providerOperationAutoRenewIntervalMinutes: "provider_operation_auto_renew_interval_minutes",
  providerIncidentRecurrenceWindowMinutes: "provider_incident_recurrence_window_minutes",
  providerHealthWarningUnresolvedThreshold: "provider_health_warning_unresolved_threshold",
  providerHealthCriticalUnresolvedThreshold: "provider_health_critical_unresolved_threshold",
  providerOperationStaleHeartbeatMinutes: "provider_operation_stale_heartbeat_minutes",
  providerOperationSummaryRetentionDays: "provider_operation_summary_retention_days",
  providerOperationLogRetentionDays: "provider_operation_log_retention_days",
  providerIncidentRetentionDays: "provider_incident_retention_days",
  providerResolvedItemRetentionDays: "provider_resolved_item_retention_days",
  finmindProviderRateLimitPerHour: "finmind_provider_rate_limit_per_hour",
  twelveDataProviderRateLimitPerMinute: "twelve_data_provider_rate_limit_per_minute",
  yahooAuProviderRateLimitPerMinute: "yahoo_au_provider_rate_limit_per_minute",
  yahooKrProviderRateLimitPerMinute: "yahoo_kr_provider_rate_limit_per_minute",
  yahooJpProviderRateLimitPerMinute: "yahoo_jp_provider_rate_limit_per_minute",
  frankfurterProviderRateLimitPerMinute: "frankfurter_provider_rate_limit_per_minute",
  asxGicsProviderRateLimitPerHour: "asx_gics_provider_rate_limit_per_hour",
  finmindProviderMinRequestIntervalMs: "finmind_provider_min_request_interval_ms",
  twelveDataProviderMinRequestIntervalMs: "twelve_data_provider_min_request_interval_ms",
  yahooAuProviderMinRequestIntervalMs: "yahoo_au_provider_min_request_interval_ms",
  yahooKrProviderMinRequestIntervalMs: "yahoo_kr_provider_min_request_interval_ms",
  yahooJpProviderMinRequestIntervalMs: "yahoo_jp_provider_min_request_interval_ms",
  frankfurterProviderMinRequestIntervalMs: "frankfurter_provider_min_request_interval_ms",
  asxGicsProviderMinRequestIntervalMs: "asx_gics_provider_min_request_interval_ms",
  jpCatalogAllowedStockTypes: "jp_catalog_allowed_stock_types",
  jpCatalogIncludeDepositaryReceipts: "jp_catalog_include_depositary_receipts",
  jpCatalogIncludeAtSymbols: "jp_catalog_include_at_symbols",
  backfillRetryLimit: "backfill_retry_limit",
  backfillRetryDelaySeconds: "backfill_retry_delay_seconds",
  backfillFinmind402RetryMs: "backfill_finmind_402_retry_ms",
  tickerPriceCloseRefreshGraceMinutes: "ticker_price_close_refresh_grace_minutes",
  tickerPriceIntradayEnabled: "ticker_price_intraday_enabled",
  tickerPriceIntradayRefreshIntervalMinutes: "ticker_price_intraday_refresh_interval_minutes",
  tickerPriceIntradayFreshnessToleranceMinutes: "ticker_price_intraday_freshness_tolerance_minutes",
  tickerPriceYahooChartRequestLimitPerMinute: "ticker_price_yahoo_chart_request_limit_per_minute",
  tickerPriceQueueConcurrency: "ticker_price_queue_concurrency",
  tickerPriceMaxTickersPerRefreshCycle: "ticker_price_max_tickers_per_refresh_cycle",
  tickerPriceSupportedMarkets: "ticker_price_supported_markets",
  tickerPriceRegularSessionOnly: "ticker_price_regular_session_only",
  tickerPriceYahooChartRange: "ticker_price_yahoo_chart_range",
  tickerPriceYahooChartInterval: "ticker_price_yahoo_chart_interval",
  tickerPriceRefreshCloseRateLimitWindowMs: "ticker_price_refresh_close_rate_limit_window_ms",
  tickerPriceRefreshCloseRateLimitMax: "ticker_price_refresh_close_rate_limit_max",
  tickerPriceSyncTickerCap: "ticker_price_sync_ticker_cap",
  tickerPriceActivityDetailedRetentionDays: "ticker_price_activity_detailed_retention_days",
  tickerPriceActivitySummaryRetentionDays: "ticker_price_activity_summary_retention_days",
  tickerPriceCalendarHistoryRetentionDays: "ticker_price_calendar_history_retention_days",
  dailyRefreshLookbackDays: "daily_refresh_lookback_days",
  dailyRefreshPriority: "daily_refresh_priority",
  sseHeartbeatIntervalMs: "sse_heartbeat_interval_ms",
  sseMaxConnectionsPerUser: "sse_max_connections_per_user",
  sseBufferDefaultTtlMs: "sse_buffer_default_ttl_ms",
  // KZO-195 — delisting detection knobs (Tier 2 hybrid).
  catalogAbsenceThreshold: "catalog_absence_threshold",
  catalogAbsenceGuardPercent: "catalog_absence_guard_percent",
  catalogAbsenceGuardFloor: "catalog_absence_guard_floor",
  // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
  anonymousShareTokenCap: "anonymous_share_token_cap",
  anonymousShareRateLimitMax: "anonymous_share_rate_limit_max",
  anonymousShareRateLimitWindowMs: "anonymous_share_rate_limit_window_ms",
  // ui-enhancement — Tier B account-soft-delete grace period.
  accountHardPurgeDays: "account_hard_purge_days",
  valuationHealthRelativeBps: "valuation_health_relative_bps",
  valuationHealthAbsoluteAud: "valuation_health_absolute_aud",
  valuationHealthAbsoluteUsd: "valuation_health_absolute_usd",
  valuationHealthAbsoluteTwd: "valuation_health_absolute_twd",
  valuationHealthAbsoluteKrw: "valuation_health_absolute_krw",
  valuationHealthAbsoluteJpy: "valuation_health_absolute_jpy",
  routeCacheDashboardPrimaryTtlMs: "route_cache_dashboard_primary_ttl_ms",
  routeCacheDashboardEnrichmentTtlMs: "route_cache_dashboard_enrichment_ttl_ms",
  routeCacheDashboardPerformanceTtlMs: "route_cache_dashboard_performance_ttl_ms",
  routeCachePortfolioTtlMs: "route_cache_portfolio_ttl_ms",
  routeCacheReportsTtlMs: "route_cache_reports_ttl_ms",
  routeCacheStaleUsableTtlMs: "route_cache_stale_usable_ttl_ms",
  eodhdDailyCallLimit: "eodhd_daily_call_limit",
};

export type RouteCachePolicyMode = "fresh" | "balanced" | "low_load" | "custom";

export interface ReadinessStatus {
  backend: "postgres" | "memory";
  postgres: boolean;
  redis: boolean;
}

/** Claims from the OAuth provider's ID token, used for identity resolution. */
export interface OAuthClaims {
  email: string;
  name?: string;
  picture?: string;
  emailVerified?: boolean;
}

export type UserRole = "admin" | "member" | "viewer";

export interface AuthUserRecord {
  userId: string;
  email: string | null;
  displayName: string | null;
  role: UserRole;
  sessionVersion: number;
  isDemo: boolean;
  deactivatedAt: string | null;
  deletedAt: string | null;
}

export interface ResolveOrCreateUserOptions {
  role?: UserRole;
  sessionVersion?: number;
}

export interface ResolveOrCreateUserResult {
  userId: string;
  role: UserRole;
  sessionVersion: number;
}

export interface ReplayedPositionScopeInput {
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
  newTradeEventId?: string;
  newPositionActionId?: string;
  deletedTradeEventIds?: readonly string[];
  dividendLedgerChanges?: DividendLedgerRecomputeChange[];
}

export interface TransactionWriteContext {
  loadStore(userId: string): Promise<Store>;
  getInstrument(ticker: string, marketCode?: string): Promise<InstrumentRow | null>;
  upsertInstruments(userId: string, instruments: Store["instruments"]): Promise<void>;
  savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void>;
  savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    marketData: MarketDataFacts,
    dividendLedgerEntryId: string,
  ): Promise<void>;
  updatePostedCashDividend(
    userId: string,
    input: UpdatePostedCashDividendInput,
  ): Promise<DividendLedgerEntry>;
  saveReplayedPositionScope(
    userId: string,
    accounting: AccountingStore,
    input: ReplayedPositionScopeInput,
  ): Promise<DividendLedgerRecomputeChange[]>;
}

export type InviteStatus = "valid" | "invalid" | "expired" | "used" | "revoked";
export type InviteConsumeFailure = InviteStatus | "email_mismatch";

export interface InviteRecord {
  code: string;
  email: string;
  role: UserRole;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
  issuedByUserId: string | null;
  shareOwnerUserId: string | null;
  createdAt: string;
}

export interface CreateInviteInput {
  email: string;
  role: UserRole;
  expiresAt: string;
  issuedByUserId: string | null;
}

export interface ConsumeInviteResult {
  status: "consumed" | InviteConsumeFailure;
  invite?: InviteRecord;
}

export type AuditLogAction =
  | "admin_promote_cli"
  | "admin_promote_startup"
  | "admin_promote_first_signin"
  | "admin_role_change"
  | "admin_disable_user"
  | "admin_enable_user"
  | "admin_delete_user"
  | "admin_hard_purge_user"
  | "admin_invite_issued"
  | "admin_invite_revoked"
  | "share_granted"
  | "share_revoked"
  | "share_capabilities_updated"
  | "ai_connector_connected"
  | "ai_connector_revoked"
  | "ai_connector_expired"
  | "share_token_created"
  | "share_token_revoked"
  | "impersonation_start"
  | "impersonation_end"
  | "impersonation_blocked_write"
  | "session_force_logout"
  | "app_config_updated"
  | "admin_fx_rates_refresh"
  | "fx_transfer_created"
  | "fx_transfer_updated"
  | "fx_transfer_reversed"
  | "provider_health_rerun"
  | "provider_fixer_operation"
  // KZO-195 — admin overrides for absence-based delisting detection.
  | "instrument_undelete"
  | "instrument_exclusion_toggle"
  // KZO-195 — persistence-side audit rows for absence-based stamps, streak
  // bumps, and guard trips.
  | "instrument_delisted_via_absence"
  | "instrument_absence_streak_bumped"
  | "instrument_absence_guard_tripped"
  | "delegated_portfolio_write"
  | "market_calendar_previewed"
  | "market_calendar_confirmed"
  | "market_calendar_invalidated"
  | "market_calendar_source_updated"
  | "quote_fallback_policy_created"
  | "quote_fallback_policy_updated"
  | "quote_fallback_policy_deactivated"
  | "quote_fallback_manual_refresh_requested"
  | "account_created"
  | "account_updated"
  // ui-enhancement — account lifecycle audit actions.
  | "account_soft_deleted"
  | "account_restored"
  | "account_hard_purged"
  | "account_market_dividend_settings_updated"
  | "dividend_calculation_confirmed"
  | "dividend_calculation_reset"
  | "dividend_calculation_amended"
  | "dividend_stock_reconciliation_updated"
  | "dividend_destructive_preview_created"
  | "dividend_destructive_confirmed"
  | "dividend_destructive_failed"
  | "dividend_legacy_stock_purge_migrated";

export interface ShareGrantRecord {
  id: string;
  ownerUserId: string;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  granteeUserId: string;
  granteeEmail: string | null;
  granteeDisplayName: string | null;
  createdAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface PendingShareInviteRecord {
  code: string;
  email: string;
  role: UserRole;
  shareOwnerUserId: string | null;
  ownerEmail: string | null;
  ownerDisplayName: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  usedAt: string | null;
}

export interface CreateShareGrantInput {
  ownerUserId: string;
  granteeUserId: string;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export interface CreateShareCoupledInviteInput {
  ownerUserId: string;
  email: string;
  expiresAt: string;
  issuedByUserId: string | null;
}

export interface ListSharesForOwnerResult {
  active: ShareGrantRecord[];
  pending: PendingShareInviteRecord[];
  expired: PendingShareInviteRecord[];
  revoked: Array<ShareGrantRecord | PendingShareInviteRecord>;
}

export interface ListInboundSharesForGranteeResult {
  active: ShareGrantRecord[];
  revoked: ShareGrantRecord[];
}

export interface MaterializePendingSharesInput {
  userId: string;
  email: string;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export interface SetShareCapabilitiesInput {
  shareId: string;
  capabilities: ShareCapability[];
  grantedByUserId: string | null;
}

export interface SetPendingShareInviteCapabilitiesInput {
  inviteCode: string;
  capabilities: ShareCapability[];
  grantedByUserId: string | null;
}

export interface AiConnectorConnectionRecord extends AiConnectorConnectionDto {
  userId: string;
  oauthClientId: string | null;
  oauthSubject: string | null;
  revokedByUserId: string | null;
}

export interface McpOAuthAuthorizationRequestRecord {
  id: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  state: string | null;
  resource: string;
  scopes: AiConnectorScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  csrfTokenHash: string;
  expiresAt: string;
  approvedAt: string | null;
  deniedAt: string | null;
  createdAt: string;
}

export interface SaveMcpOAuthAuthorizationRequestInput {
  id: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  state?: string | null;
  resource: string;
  scopes: AiConnectorScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  csrfTokenHash: string;
  expiresAt: string;
  approvedAt?: string | null;
  deniedAt?: string | null;
  createdAt?: string;
}

export interface McpOAuthAuthorizationCodeRecord {
  id: string;
  codeHash: string;
  connectionId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: AiConnectorScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: string;
  consumedAt: string | null;
  createdAt: string;
}

export interface SaveMcpOAuthAuthorizationCodeInput {
  id: string;
  codeHash: string;
  connectionId: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  resource: string;
  scopes: AiConnectorScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  expiresAt: string;
  consumedAt?: string | null;
  createdAt?: string;
}

export interface AiConnectorCredentialRecord {
  id: string;
  connectionId: string;
  credentialType: "oauth_refresh_token" | "self_hosted_token" | "bearer_token";
  tokenHash: string;
  tokenHint: string | null;
  tokenFamilyId: string | null;
  predecessorCredentialId: string | null;
  replacedByCredentialId: string | null;
  oauthClientId: string | null;
  resource: string | null;
  scopes: AiConnectorScope[];
  sessionVersion: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface SaveAiConnectorCredentialInput {
  id: string;
  connectionId: string;
  credentialType: "oauth_refresh_token" | "self_hosted_token" | "bearer_token";
  tokenHash: string;
  tokenHint?: string | null;
  tokenFamilyId?: string | null;
  predecessorCredentialId?: string | null;
  replacedByCredentialId?: string | null;
  oauthClientId?: string | null;
  resource?: string | null;
  scopes?: AiConnectorScope[];
  sessionVersion?: number | null;
  expiresAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string;
  lastUsedAt?: string | null;
}

export interface SaveAiConnectorConnectionInput {
  id: string;
  userId: string;
  provider: AiConnectorProvider;
  vendor?: AiConnectorVendor;
  clientKind?: AiConnectorClientKind;
  authMode?: AiConnectorAuthMode;
  capabilities?: AiConnectorCapability[];
  displayName: string;
  status: AiConnectorStatus;
  oauthClientId?: string | null;
  oauthSubject?: string | null;
  scopes: AiConnectorScope[];
  toolToggles?: Record<string, boolean>;
  expiresAt?: string | null;
  expiryNotifiedAt?: string | null;
  lastUsedAt?: string | null;
  hiddenAt?: string | null;
  revokedAt?: string | null;
  revokedByUserId?: string | null;
  revocationReason?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ActivateAiConnectorConnectionReplacingProviderInput {
  connectionId: string;
  userId: string;
  provider: AiConnectorProvider;
  vendor?: AiConnectorVendor;
  clientKind?: AiConnectorClientKind;
  authMode?: AiConnectorAuthMode;
  maxActiveConnectionsPerUser: number;
  oauthClientId?: string | null;
  oauthSubject?: string | null;
  lastUsedAt?: string | null;
  revokedByUserId?: string | null;
  revocationReason: string;
}

export interface ActivateAiConnectorConnectionReplacingProviderResult {
  connection: AiConnectorConnectionRecord;
  revokedConnectionIds: string[];
}

export interface ApproveMcpOAuthAuthorizationRequestInput {
  requestId: string;
  userId: string;
  approvedAt: string;
  connection: SaveAiConnectorConnectionInput;
  code: SaveMcpOAuthAuthorizationCodeInput;
}

export interface ApproveMcpOAuthAuthorizationRequestResult {
  request: McpOAuthAuthorizationRequestRecord;
  connection: AiConnectorConnectionRecord;
}

export type AiConnectorPolicySettingsRecord = Omit<AiConnectorPolicySettingsDto, "readiness">;

export type SaveAiConnectorPolicySettingsInput = Partial<
  Omit<
    AiConnectorPolicySettingsDto,
    "updatedAt" | "allowedProviders" | "allowedClientKinds" | "groupToggles" | "bearerFallback" | "oauthTokenSecretSet" | "readiness"
  >
> & {
  allowedProviders?: Partial<AiConnectorPolicySettingsDto["allowedProviders"]>;
  allowedClientKinds?: Partial<AiConnectorPolicySettingsDto["allowedClientKinds"]>;
  groupToggles?: Partial<AiConnectorPolicySettingsDto["groupToggles"]>;
  bearerFallback?: Partial<AiConnectorPolicySettingsDto["bearerFallback"]>;
};

export interface AppendAiConnectorAccessLogInput {
  id?: string;
  connectionId: string | null;
  userId: string;
  portfolioContextUserId: string;
  shareId?: string | null;
  toolName: string;
  accessKind: AiConnectorAccessKind;
  result: AiConnectorAccessResult;
  denialReason?: string | null;
  requestId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface AiConnectorAccessLogRecord {
  id: string;
  connectionId: string | null;
  userId: string;
  portfolioContextUserId: string;
  shareId: string | null;
  toolName: string;
  accessKind: AiConnectorAccessKind;
  result: AiConnectorAccessResult;
  denialReason: string | null;
  requestId: string | null;
  sourceIp: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ListAiConnectorAccessLogsOptions {
  limit?: number;
  offset?: number;
  result?: AiConnectorAccessResult;
  search?: string;
  connectionIds?: string[];
}

export interface AiTransactionDraftBatchRecord {
  id: string;
  ownerUserId: string;
  createdByUserId: string | null;
  connectorConnectionId: string | null;
  shareId: string | null;
  sourceChannel: AiTransactionDraftSourceChannel;
  status: AiTransactionDraftBatchStatus;
  version: number;
  sourceLabel: string | null;
  sourceFilename: string | null;
  note: string | null;
  provenance: Record<string, unknown>;
  rowCount: number;
  unsupportedCount: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
  archivedByUserId: string | null;
  deletedAt: string | null;
  deletedByUserId: string | null;
}

export interface SaveAiTransactionDraftBatchInput {
  id: string;
  ownerUserId: string;
  createdByUserId: string | null;
  connectorConnectionId?: string | null;
  shareId?: string | null;
  sourceChannel: AiTransactionDraftSourceChannel;
  status: AiTransactionDraftBatchStatus;
  version: number;
  sourceLabel?: string | null;
  sourceFilename?: string | null;
  note?: string | null;
  provenance?: Record<string, unknown>;
  rowCount: number;
  unsupportedCount: number;
  archivedAt?: string | null;
  archivedByUserId?: string | null;
  deletedAt?: string | null;
  deletedByUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expectedVersion?: number | null;
}

export interface AiTransactionDraftRowRecord {
  id: string;
  batchId: string;
  ownerUserId: string;
  rowNumber: number;
  state: AiTransactionDraftRowState;
  version: number;
  accountId: string | null;
  accountNameInput: string | null;
  tradeType: "BUY" | "SELL" | null;
  ticker: string | null;
  marketCode: string | null;
  quantity: number | null;
  unitPrice: number | null;
  priceCurrency: string | null;
  tradeDate: string | null;
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  isDayTrade: boolean | null;
  commissionAmount: number | null;
  taxAmount: number | null;
  feesSource: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
  note: string | null;
  sourceRowRef: string | null;
  sourceSnippet: string | null;
  normalizedPayload: Record<string, unknown>;
  preflightIssues: unknown[];
  warnings: unknown[];
  duplicateTradeEventId: string | null;
  confirmedTradeEventId: string | null;
  confirmedAt: string | null;
  confirmedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveAiTransactionDraftRowInput {
  id: string;
  batchId: string;
  ownerUserId: string;
  rowNumber: number;
  state: AiTransactionDraftRowState;
  version: number;
  accountId?: string | null;
  accountNameInput?: string | null;
  tradeType?: "BUY" | "SELL" | null;
  ticker?: string | null;
  marketCode?: string | null;
  quantity?: number | null;
  unitPrice?: number | null;
  priceCurrency?: string | null;
  tradeDate?: string | null;
  tradeTimestamp?: string | null;
  bookingSequence?: number | null;
  isDayTrade?: boolean | null;
  commissionAmount?: number | null;
  taxAmount?: number | null;
  feesSource?: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED" | null;
  note?: string | null;
  sourceRowRef?: string | null;
  sourceSnippet?: string | null;
  normalizedPayload?: Record<string, unknown>;
  preflightIssues?: unknown[];
  warnings?: unknown[];
  duplicateTradeEventId?: string | null;
  confirmedTradeEventId?: string | null;
  confirmedAt?: string | null;
  confirmedByUserId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  expectedVersion?: number | null;
}

export interface AiTransactionDraftUnsupportedItemRecord {
  id: string;
  batchId: string;
  rowNumber: number | null;
  category: string;
  reason: string;
  sourceSnippet: string | null;
  rawPayload: Record<string, unknown>;
  createdAt: string;
}

export interface SaveAiTransactionDraftUnsupportedItemInput {
  id: string;
  batchId: string;
  rowNumber?: number | null;
  category: string;
  reason: string;
  sourceSnippet?: string | null;
  rawPayload?: Record<string, unknown>;
  createdAt?: string;
}

export interface AiTransactionDraftEventRecord {
  id: string;
  batchId: string;
  rowId: string | null;
  ownerUserId: string | null;
  actorUserId: string | null;
  connectorConnectionId: string | null;
  eventType: AiTransactionDraftEventType;
  summary: string | null;
  beforeState: Record<string, unknown> | null;
  afterState: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  sourceIp: string | null;
  createdAt: string;
}

export interface AppendAiTransactionDraftEventInput {
  id?: string;
  batchId: string;
  rowId?: string | null;
  ownerUserId?: string | null;
  actorUserId?: string | null;
  connectorConnectionId?: string | null;
  eventType: AiTransactionDraftEventType;
  summary?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  metadata?: Record<string, unknown>;
  sourceIp?: string | null;
  createdAt?: string;
}

export interface AiTransactionDraftBatchAggregate {
  batch: AiTransactionDraftBatchRecord;
  rows: AiTransactionDraftRowRecord[];
  unsupportedItems: AiTransactionDraftUnsupportedItemRecord[];
  events: AiTransactionDraftEventRecord[];
}

export interface ConfirmAiTransactionDraftPostingInput {
  ownerUserId: string;
  accounting: AccountingStore;
  rows: SaveAiTransactionDraftRowInput[];
  batch: SaveAiTransactionDraftBatchInput;
  event: AppendAiTransactionDraftEventInput;
}

export interface ConfirmAiTransactionDraftPostingResult {
  rows: AiTransactionDraftRowRecord[];
  batch: AiTransactionDraftBatchRecord;
  event: AiTransactionDraftEventRecord;
}

export interface AnonymousShareTokenRecord {
  id: string;
  token: string;
  ownerUserId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

export interface CreateAnonymousShareTokenInput {
  ownerUserId: string;
  token: string;
  expiresAt: string;
  ttlDays: number;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export interface RevokeAnonymousShareTokenInput {
  id: string;
  ownerUserId: string;
  auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
}

export type CreateAnonymousShareTokenResult =
  | { status: "ok"; record: AnonymousShareTokenRecord }
  | { status: "cap_exceeded" }
  | { status: "collision" };

export type RevokeAnonymousShareTokenResult =
  | { status: "revoked"; record: AnonymousShareTokenRecord }
  | { status: "noop" }
  | { status: "not_found" };

export interface AuditLogInput {
  actorUserId?: string | null;
  action: AuditLogAction;
  targetUserId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

export interface TradeEventPatch {
  date?: string;
  quantity?: number;
  price?: number;
  side?: "BUY" | "SELL";
  isDayTrade?: boolean;
  commissionAmount?: number;
  taxAmount?: number;
  feesSource?: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED";
}

export interface DeleteTradeEventResult {
  accountId: string;
  ticker: string;
  feePolicySnapshotId: string;
  deletedChildRows: {
    cashLedgerEntries: number;
    lotAllocations: number;
  };
}

export type DividendDestructiveOperationKind = "trade_delete" | "account_cutoff_purge";
export type DividendDestructivePreviewResult = "previewed" | "confirmed" | "failed";

export interface DividendDestructiveAffectedCounts {
  tradeEvents: number;
  positionActions: number;
  dividendLedgerEntries: number;
  cashLedgerEntries: number;
  dividendDeductionEntries: number;
  dividendSourceLines: number;
  lotAllocations: number;
  stockDividendPositionActions: number;
  holdingSnapshots: number;
}

export interface AccountingStoreAuditOptions {
  accountIds?: string[];
  expectedAccountRevision?: {
    accountId: string;
    revision: number;
  };
  expectedAccountRevisions?: Record<string, number>;
  deleteHoldingSnapshotScopes?: Array<{
    accountId: string;
    ticker: string;
    marketCode: MarketCode;
    fromDate: string;
  }>;
  clearDividendPreviewPayloadId?: string;
}

export interface DividendDestructiveReviewedArtifacts {
  source: {
    tradeEventIds: string[];
    positionActionIds: string[];
    lotAllocationIds: string[];
    lotAllocationTradeEventIds: string[];
  };
  derived: {
    dividendEventIds: string[];
    dividendLedgerEntryIds: string[];
    cashLedgerEntryIds: string[];
    dividendDeductionEntryIds: string[];
    dividendSourceLineIds: string[];
    stockDividendPositionActionIds: string[];
    holdingSnapshotIds: string[];
  };
}

export interface DividendDestructiveDividendImpactRecord {
  accountId: string;
  dividendEventId: string;
  dividendLedgerEntryId: string | null;
  postingStatus: DividendLedgerEntry["postingStatus"] | null;
  beforeEligibleQuantity: number;
  afterEligibleQuantity: number;
  beforeExpectedCashAmount: number;
  afterExpectedCashAmount: number;
  beforeExpectedStockQuantity: number;
  afterExpectedStockQuantity: number;
  cashLedgerEntryIds: string[];
  dividendDeductionEntryIds: string[];
  dividendSourceLineIds: string[];
  stockDividendPositionActionIds: string[];
  requiresManualReceiptReentry: boolean;
}

export interface DividendDestructivePreviewRecord {
  previewId: string;
  previewVersion: number;
  fingerprint: string;
  operationKind: DividendDestructiveOperationKind;
  operationKey: string;
  ownerUserId: string;
  actorUserId: string | null;
  accountId: string;
  accountRevision: number;
  targetTradeEventId?: string | null;
  cutoffDate?: string | null;
  reason: string;
  expiresAt: string;
  createdAt: string;
  affectedCounts: DividendDestructiveAffectedCounts;
  affectedDividends: DividendDestructiveDividendImpactRecord[];
  manualReceiptReentryLedgerEntryIds: string[];
  reviewedArtifacts: DividendDestructiveReviewedArtifacts;
}

export interface DividendDestructivePreviewState extends DividendDestructivePreviewRecord {
  consumedAt: string | null;
  consumedResult: Exclude<DividendDestructivePreviewResult, "previewed"> | null;
}

export interface SaveDividendDestructivePreviewInput {
  record: DividendDestructivePreviewRecord;
  ipAddress?: string | null;
}

export interface RecordDividendDestructiveOutcomeInput {
  previewId: string;
  ownerUserId: string;
  actorUserId?: string | null;
  accountId: string;
  operationKind: DividendDestructiveOperationKind;
  operationKey: string;
  previewVersion: number;
  fingerprint: string;
  targetTradeEventId?: string | null;
  cutoffDate?: string | null;
  reason: string;
  result: Exclude<DividendDestructivePreviewResult, "previewed">;
  affectedCounts: DividendDestructiveAffectedCounts;
  affectedDividends: DividendDestructiveDividendImpactRecord[];
  manualReceiptReentryLedgerEntryIds: string[];
  reviewedArtifacts: DividendDestructiveReviewedArtifacts;
  errorCode?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  completedAt: string;
  ipAddress?: string | null;
}

export interface UpdatePostedCashDividendInput {
  expectedVersion: number;
  originalDividendLedgerEntryId?: string;
  dividendLedgerEntry: DividendLedgerEntry;
  dividendLedgerEntries?: DividendLedgerEntry[];
  linkedCashEntries: CashLedgerEntry[];
  dividendDeductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
  dividendSourceLines: DividendSourceLine[];
  positionActions: PositionAction[];
  lots: Lot[];
  replaceChildRowsForDividendLedgerEntryIds?: string[];
  replacePositionActionsForDividendLedgerEntryIds?: string[];
}

export interface PersistedTickerFundamentalsRecord {
  ticker: string;
  marketCode: MarketCode;
  providerId: string | null;
  fundamentals: TickerFundamentalsDto;
  refreshedAt: string | null;
  nextRefreshAt: string | null;
  lastAttemptedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTickerFundamentalsSnapshotInput {
  ticker: string;
  marketCode: MarketCode;
  providerId: string;
  fundamentals: TickerFundamentalsDto;
  refreshedAt: string;
  nextRefreshAt: string;
}

export interface RecordTickerFundamentalsRefreshFailureInput {
  ticker: string;
  marketCode: MarketCode;
  providerId: string;
  attemptedAt: string;
  nextRefreshAt: string;
  errorMessage: string;
}

export interface InstrumentRow extends InstrumentRef {
  typeRaw?: string;
  industryCategoryRaw?: string;
  finmindDate?: string;
  delistedAt?: string;
  lastRepairAt?: string;
  statusReason?: string;
  catalogExchangeRaw?: string | null;
  catalogMicCode?: string | null;
  barsBackfillStatus: BackfillStatus;
  verificationStatus: VerificationStatus;
  verificationNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogInstrument {
  ticker: string;
  name: string;
  typeRaw: string;
  industryCategoryRaw: string;
  finmindDate: string;
  instrumentType: import("@vakwen/domain").InstrumentType | null;
  // KZO-170 S4: per-row market code now required. The persistence layer threads
  // this through `unnest($N::text[])` (postgres.ts) and as the second composite-PK
  // column on `market_data.instruments` (post-KZO-169). Previously every row was
  // hardcoded `'TW'` at the SQL layer (`array_fill('TW'::text, ...)`); the stamp
  // now comes from the catalog source.
  marketCode: import("@vakwen/domain").MarketCode;
  catalogExchangeRaw?: string | null;
  catalogMicCode?: string | null;
}

/**
 * KZO-195 — options bag for `upsertInstrumentCatalog`. Backward-compatible:
 * callers that omit `absenceDetection` (TW provider-feed path) get the legacy
 * upsert + delistings flow. The AU path (and US once flipped on) wires
 * `absenceDetection.categorize` to the pure detector so the persistence layer
 * can fold the diff-based detection into the same transaction.
 */
export interface UpsertInstrumentCatalogOptions {
  absenceDetection?: {
    marketCode: import("@vakwen/domain").MarketCode;
    /**
     * Decide which absent rows should bump streak / cross threshold / trip the
     * guard. See `apps/api/src/services/market-data/detectDelistingsByAbsence.ts`.
     */
    categorize: (
      absent: import("../services/market-data/detectDelistingsByAbsence.js").AbsentRow[],
      prevCatalogSize: number,
    ) => import("../services/market-data/detectDelistingsByAbsence.js").DetectionPlan;
    /** Audit actor for absence-stamped rows. Optional — `null` skips the actor field. */
    actorUserId?: string | null;
  };
}

export interface DelistingRecord {
  ticker: string;
  name: string;
  date: string;
  // KZO-170 S4: optional market code for delisting target isolation. Without this,
  // a TW delisting for ticker X would also flip a US instrument with the same ticker.
  // `runCatalogSync` stamps this from the per-market sync invocation; older callers
  // that omit it preserve the legacy TW-only behavior via the postgres branch.
  marketCode?: import("@vakwen/domain").MarketCode;
  // KZO-195 — provenance discriminator. `provider_feed` (default) is the legacy
  // TW path where the upstream provider explicitly publishes a delisting row.
  // `absence_detected` is the diff-based path used by AU (and US once flipped on)
  // where consecutive absence from the catalog sync triggers the stamp. Optional
  // so callers that omit it default to `provider_feed` semantics.
  source?: "provider_feed" | "absence_detected";
}

// ── Cash ledger listing (KZO-137) ────────────────────────────────────────────

export type CashLedgerSortColumn = "entryDate" | "entryType" | "amount" | "currency" | "accountId";

export interface CashLedgerListOptions {
  fromEntryDate?: string;
  toEntryDate?: string;
  accountId?: string;
  entryType?: string[];
  page: number;
  limit: number;
  sortBy: CashLedgerSortColumn;
  sortOrder: "asc" | "desc";
}

export interface CashLedgerListResult {
  entries: CashLedgerEntry[];
  total: number;
  summary: { accountId: string; currency: string; amount: number }[];
}

export interface AccountWithLiveBalancesRecord {
  id: string;
  userId: string;
  name: string;
  feeProfileId: string;
  defaultCurrency: import("@vakwen/shared-types").AccountDefaultCurrency;
  accountType: import("@vakwen/shared-types").AccountType;
  liveBalance: Array<{ currency: string; amount: number }>;
}

export interface CashLedgerEntryTradeDetailRecord {
  id: string;
  ticker: string;
  side: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  commissionAmount: number;
  taxAmount: number;
}

export interface CashLedgerEntryDividendDetailRecord {
  id: string;
  ticker: string | null;
  expectedCashAmount: number;
  receivedCashAmount: number;
  deductionTotal: number;
}

export interface CashLedgerFxTransferLegRecord {
  entryId: string;
  accountId: string;
  accountName: string;
  entryType: import("../types/store.js").CashLedgerEntryType;
  amount: number;
  currency: string;
  reversalOfCashLedgerEntryId?: string;
}

export interface CashLedgerEnrichmentResult {
  accountNamesById: Map<string, string>;
  tradesById: Map<string, CashLedgerEntryTradeDetailRecord>;
  dividendsById: Map<string, CashLedgerEntryDividendDetailRecord>;
  fxTransferLegsByTransferId: Map<string, CashLedgerFxTransferLegRecord[]>;
  reversedFxTransferIds: Set<string>;
}

// ── Dividend ledger listing (KZO-135) ─────────────────────────────────────────

export type DividendLedgerSortColumn =
  | "paymentDate"
  | "ticker"
  | "account"
  | "expectedCashAmount"
  | "receivedCashAmount"
  | "reconciliationStatus";

export interface DividendLedgerListOptions {
  accountId?: string;
  fromPaymentDate?: string;
  toPaymentDate?: string;
  reconciliationStatus?: DividendLedgerEntry["reconciliationStatus"];
  postingStatus?: DividendPostingStatus;
  excludeExpected?: boolean;
  ticker?: string;
  marketCode?: MarketCode;
  page: number;
  limit: number;
  sortBy: DividendLedgerSortColumn;
  sortOrder: "asc" | "desc";
}

export interface DividendReviewListOptions extends Omit<DividendLedgerListOptions, "sortBy" | "ticker"> {
  sortBy: DividendReviewSortColumn;
  sourceComposition?: DividendReviewPrimaryQueryDto["sourceComposition"];
  accountIds?: string[];
  cashStatuses?: DividendReviewPrimaryQueryDto["cashStatuses"];
  stockStatuses?: DividendReviewPrimaryQueryDto["stockStatuses"];
  /** @deprecated Prefer `tickers`; retained for programmatic caller compatibility. */
  ticker?: string;
  tickers?: string[];
}

export type DividendReviewPrimaryResult = {
  rows: DividendReviewRowSummaryDto[];
  total: number;
  phaseTimings?: { dbMs: number; hydrationMs: number };
};

export type DividendReviewEnrichmentResult = DividendReviewEnrichmentDto & {
  // aggregateMs covers the complete aggregation phase and may overlap dbMs.
  phaseTimings?: { dbMs: number; aggregateMs: number };
};

export type DividendReviewMetadataResult = {
  years: number[];
  accounts: DividendReviewAccountOptionDto[];
  eligibleTickers: DividendReviewTickerOptionDto[];
};

export type DividendLedgerEntryWithDetails = DividendLedgerEntry & {
  deductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
  sourceLines: DividendSourceLine[];
};

export interface DividendLedgerListResult {
  ledgerEntries: DividendLedgerEntryWithDetails[];
  total: number;
  aggregates: DividendLedgerAggregates;
}

export interface DividendCalendarSnapshotOptions {
  accountId?: string;
  fromPaymentDate?: string;
  toPaymentDate?: string;
  marketCode?: MarketCode;
  ticker?: string;
  includeUndated?: boolean;
  /** Internal targeted-read selector used by daily highlights. */
  highlightLocalDates?: string[];
  limit: number;
}

export interface DividendDailyHighlightsSnapshotOptions {
  accountId?: string;
  marketCode?: MarketCode;
  localDates: string[];
}

export interface DividendCalendarSnapshotResult {
  dividendEvents: Store["marketData"]["dividendEvents"];
  ledgerEntries: DividendLedgerEntryWithDetails[];
  accounts: Store["accounts"];
  instruments: Store["instruments"];
  tradeEvents: Store["accounting"]["facts"]["tradeEvents"];
  positionActions?: Store["accounting"]["facts"]["positionActions"];
}

export type DividendReviewRowKind = "ledger" | "expected";

export type DividendReviewRowWithDetails = DividendLedgerEntryWithDetails & {
  rowKind: DividendReviewRowKind;
  ticker: string;
  tickerName: string | null;
  marketCode: MarketCode;
  instrumentType: InstrumentType;
  eventType: Store["marketData"]["dividendEvents"][number]["eventType"];
  exDividendDate: string;
  paymentDate: string | null;
  cashCurrency: CurrencyCode;
  cashDividendPerShare: number;
  stockDistributionRatio?: number | null;
  stockDistributionRatioState?: import("@vakwen/shared-types").StockDistributionRatioState;
  expectedStockCalcState?: import("@vakwen/shared-types").ExpectedStockCalcState;
  nhiAmount?: number | null;
  bankFeeAmount?: number | null;
  otherDeductionAmount?: number | null;
  expectedGrossAmount?: number | null;
  expectedNetAmount?: number | null;
  actualNetAmount?: number | null;
  varianceAmount?: number | null;
  correctionMode?: "in_place" | "amend" | "reversal_replacement" | null;
  amendmentBlockedReason?: string | null;
  linkedPositionActionId?: string | null;
  linkedPositionActionStatus?: string | null;
  cashInLieuAmount?: number | null;
  parValueBaseAmount?: number | null;
  premiumBaseAmount?: number | null;
  nhiPremiumBaseAmount?: number | null;
  portfolioCostBasisAddedAmount?: number | null;
  calculationHistory?: DividendCalculationVersionDto[];
  activeCalculation?: DividendCalculationVersionDto | null;
  provider?: DividendCalculationVersionDto["provider"] | null;
  stockVarianceQuantity?: number | null;
  snapshotRefreshStatus?: "idle" | "queued" | "running" | "complete" | "failed" | null;
};

export type DividendReviewResponseRowWithDetails = Omit<DividendReviewRowWithDetails, "expectedStockQuantity"> & {
  expectedStockQuantity: number | null;
};

export interface DividendReviewListResult {
  rows: DividendReviewResponseRowWithDetails[];
  total: number;
  aggregates: DividendLedgerAggregates;
}

/**
 * KZO-195 — row shape returned by the admin instrument override routes.
 * Carries the absence-detection state the admin UI needs to render the
 * undelete/exclude controls.
 */
export interface AdminInstrumentRow {
  ticker: string;
  marketCode: string;
  name: string | null;
  instrumentType: string | null;
  supportState: "supported" | "retired_by_admin" | "unsupported_by_provider";
  barsBackfillStatus: "pending" | "backfilling" | "ready" | "failed";
  delistedAt: string | null;
  statusReason: string | null;
  lastSeenInCatalogAt: string | null;
  absenceStreak: number;
  delistingDetectionExcluded: boolean;
  updatedAt: string;
}

export interface AdminMarketDataBackfillTargetRow {
  ticker: string;
  marketCode: MarketCode;
}

export interface ListAdminMarketDataBackfillTargetsOptions {
  marketCode: MarketCode;
  includeDemoUsers?: boolean;
}

export interface CountAdminMarketDataTargetOwnershipOptions {
  targets: AdminMarketDataBackfillTargetRow[];
}

export interface AdminMarketDataTargetOwnershipCounts {
  userCount: number;
  accountCount: number;
}

export type AdminMarketDataPurgeCategory =
  | "price_bars"
  | "dividends"
  | "backfill_jobs"
  | "provider_operation_outcomes"
  | "provider_error_trail"
  | "provider_resolution_mappings"
  | "asx_gics_enrichment"
  | "admin_state_reset";

export interface AdminMarketDataPurgeInput {
  providerId: string;
  marketCode: MarketCode;
  categories: AdminMarketDataPurgeCategory[];
  targets: AdminMarketDataBackfillTargetRow[];
  fullHistory?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  dryRun: boolean;
}

export interface AdminMarketDataPurgeCounts {
  priceBars: number;
  dividends: number;
  backfillJobs: number;
  providerOperationOutcomes: number;
  providerErrorTrail: number;
  providerResolutionMappings: number;
  asxGicsEnrichment: number;
  adminStateReset: number;
  total: number;
}

export interface CatalogSyncResult {
  upserted: number;
  delisted: number;
  // KZO-195 — counters for the diff-based delisting path. Always present in the
  // result shape (zero when the sync ran without `absenceDetection` wired in,
  // i.e. TW provider-feed path). When the mass-delisting guard trips, `delisted`
  // is 0 and `guardTripped` is true; `absent` reports the candidate count and
  // `absentTickers` lists them (truncated for log/notification readability).
  absent: number;
  guardTripped: boolean;
  absentTickers: string[];
}

// ── Provider health (KZO-177) ────────────────────────────────────────────────

export type ProviderHealthStatus = "healthy" | "degraded" | "down";
export type ProviderErrorClass =
  | "rate_limit"
  | "http_4xx"
  | "http_5xx"
  | "network"
  | "parse"
  | "other";

/** Row shape for `market_data.provider_health_status`. */
export interface ProviderHealthRow {
  providerId: string;
  status: ProviderHealthStatus;
  lastSuccessfulRun: string | null;
  lastFailedRun: string | null;
  lastErrorMessage: string | null;
  lastDownNotificationAt: string | null;
  lastManualRerunAt: string | null;
  updatedAt: string;
}

/** Row shape for `market_data.provider_error_trail`. */
export interface ProviderErrorTrailRow {
  id: number;
  providerId: string;
  occurredAt: string;
  errorClass: ProviderErrorClass;
  errorMessage: string | null;
  context: Record<string, unknown> | null;
}

export interface ProviderHealthUpsert {
  providerId: string;
  status?: ProviderHealthStatus;
  lastSuccessfulRun?: string | null;
  lastFailedRun?: string | null;
  lastErrorMessage?: string | null;
  lastDownNotificationAt?: string | null;
  lastManualRerunAt?: string | null;
}

export interface ProviderErrorTrailInput {
  providerId: string;
  errorClass: ProviderErrorClass;
  errorMessage?: string | null;
  context?: Record<string, unknown> | null;
}

export type ProviderIncidentStatus = "open" | "acknowledged" | "resolved" | "ignored";
export type ProviderIncidentSeverity = "info" | "warning" | "critical";

export interface ProviderIncidentRecord {
  id: string;
  providerId: string;
  marketCode: MarketCode | null;
  incidentKey: string;
  status: ProviderIncidentStatus;
  severity: ProviderIncidentSeverity;
  title: string;
  summary: string | null;
  errorClass: ProviderErrorClass;
  errorCode: string | null;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastErrorTrailId: number | null;
  linkedOperationId: string | null;
  metadata: Record<string, unknown>;
  acknowledgedAt: string | null;
  acknowledgedByUserId: string | null;
  resolvedAt: string | null;
  resolvedByUserId: string | null;
  ignoredAt: string | null;
  ignoredByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProviderIncidentInput {
  providerId: string;
  marketCode?: MarketCode | null;
  incidentKey: string;
  severity?: ProviderIncidentSeverity;
  title: string;
  summary?: string | null;
  errorClass: ProviderErrorClass;
  errorCode?: string | null;
  lastErrorTrailId?: number | null;
  linkedOperationId?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface ListProviderIncidentsOptions {
  providerId?: string;
  marketCode?: MarketCode;
  status?: ProviderIncidentStatus;
  search?: string;
  page: number;
  limit: number;
}

export interface ListProviderIncidentsResult {
  items: ProviderIncidentRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface UpdateProviderIncidentStatusInput {
  providerId: string;
  incidentId: string;
  status: ProviderIncidentStatus;
  actorUserId: string;
}

export type ProviderOperationPhase =
  | "diagnose"
  | "preparing_preview"
  | "preview"
  | "staged"
  | "queued"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled";

export type ProviderOperationLogLevel = "info" | "warning" | "error";
export type ProviderOperationMarketCode = MarketCode | "FX";

export type ProviderOperationScopeType = "selected_items" | "filter";

export interface ProviderOperationScopeItem {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  sourceSymbol: string;
}

export interface ProviderOperationFilterScope {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  state: "active";
  search: string | null;
}

export interface ProviderOperationRecord {
  id: string;
  providerId: string;
  marketCode: ProviderOperationMarketCode;
  operationType: string;
  phase: ProviderOperationPhase;
  errorCode: string | null;
  resolverMode: MarketDataResolverMode | null;
  scopeQuery: string | null;
  snapshotHash: string | null;
  previewTokenHash: string | null;
  previewExpiresAt: string | null;
  matchCount: number | null;
  sample: unknown[] | null;
  metadata: Record<string, unknown> | null;
  legacyBatchId: string | null;
  actorUserId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProviderOperationInput {
  id?: string;
  providerId: string;
  marketCode: ProviderOperationMarketCode;
  operationType: string;
  phase: ProviderOperationPhase;
  errorCode?: string | null;
  resolverMode?: MarketDataResolverMode | null;
  scopeQuery?: string | null;
  snapshotHash?: string | null;
  previewTokenHash?: string | null;
  previewExpiresAt?: string | null;
  matchCount?: number | null;
  sample?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
  legacyBatchId?: string | null;
  actorUserId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface UpdateProviderOperationInput {
  id: string;
  phase?: ProviderOperationPhase;
  errorCode?: string | null;
  resolverMode?: MarketDataResolverMode | null;
  scopeQuery?: string | null;
  snapshotHash?: string | null;
  previewTokenHash?: string | null;
  previewExpiresAt?: string | null;
  matchCount?: number | null;
  sample?: unknown[] | null;
  metadata?: Record<string, unknown> | null;
  legacyBatchId?: string | null;
  actorUserId?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  cancelledAt?: string | null;
}

export interface ListProviderOperationsOptions {
  providerId?: string;
  marketCode?: ProviderOperationMarketCode;
  operationTypes?: string[];
  phases?: ProviderOperationPhase[];
  search?: string;
  createdAfter?: string;
  createdBefore?: string;
  includeOperationId?: string;
  page: number;
  limit: number;
}

export interface ListProviderOperationsResult {
  items: ProviderOperationRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderOperationLogRecord {
  id: number;
  operationId: string;
  providerId: string | null;
  marketCode: ProviderOperationMarketCode | null;
  phase: ProviderOperationPhase;
  level: ProviderOperationLogLevel;
  eventKind: string | null;
  batchId: string | null;
  jobId: string | null;
  successCount: number | null;
  warningCount: number | null;
  errorCount: number | null;
  detail: string | null;
  rawContext: Record<string, unknown> | null;
  message: string;
  context: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateProviderOperationLogInput {
  operationId: string;
  providerId?: string | null;
  marketCode?: ProviderOperationMarketCode | null;
  phase: ProviderOperationPhase;
  level: ProviderOperationLogLevel;
  eventKind?: string | null;
  batchId?: string | null;
  jobId?: string | null;
  successCount?: number | null;
  warningCount?: number | null;
  errorCount?: number | null;
  detail?: string | null;
  rawContext?: Record<string, unknown> | null;
  message: string;
  context?: Record<string, unknown> | null;
}

export interface ListProviderOperationLogsOptions {
  operationId: string;
  page: number;
  limit: number;
}

export interface ListProviderOperationLogsResult {
  items: ProviderOperationLogRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface ProviderLogPurgeCounts {
  providerId: string;
  errorTrailCount: number;
  operationLogCount: number;
}

export type MarketCalendarSourceType = "official_source" | "manual_ai_assisted";
export type MarketCalendarVersionStatus = "confirmed" | "invalidated";
export type MarketCalendarActivityCategory =
  | "intraday_price"
  | "daily_close"
  | "calendar"
  | "provider_operation"
  | "provider_error"
  | "instrument"
  | "system";
export type MarketCalendarActivityResult =
  | "success"
  | "warning"
  | "error"
  | "skipped"
  | "rate_limited";
export type MarketCalendarActivitySourceKind =
  | "yahoo_chart"
  | "official_calendar"
  | "twse_close"
  | "finmind"
  | "provider"
  | "system";

export interface MarketCalendarSourceConfigRecord {
  id: string;
  marketCode: MarketCode;
  label: string;
  sourceType: MarketCalendarSourceType;
  suggestedSourceUrl: string | null;
  enabled: boolean;
  isDefault: boolean;
  updatedAt: string;
}

export interface SaveMarketCalendarSourceConfigInput {
  marketCode: MarketCode;
  sourceId?: string;
  label: string;
  sourceType: MarketCalendarSourceType;
  suggestedSourceUrl?: string | null;
  enabled?: boolean;
  isDefault?: boolean;
}

export interface MarketCalendarCoverageAssertionRecord {
  scope: "full_year";
  evidence: string;
  notes?: string | null;
}

export interface MarketCalendarExceptionInput {
  date: string;
  status: "open" | "closed";
  name: string;
  evidence: string;
  overrideReason: string;
  notes?: string | null;
}

export interface MarketCalendarPreviewRecord {
  previewToken: string;
  importOperationId: string;
  marketCode: MarketCode;
  calendarYear: number;
  sourceId: string | null;
  sourceType: MarketCalendarSourceType;
  label: string | null;
  sourceUrl: string | null;
  retrievedAt: string;
  coverage: MarketCalendarCoverageAssertionRecord;
  replaceConfirmedRequired: boolean;
  warnings: string[];
  diff: {
    addedExceptions: string[];
    removedExceptions: string[];
    changedExceptions: string[];
  };
  annualCounts: {
    tradingDayCount: number;
    nonTradingDayCount: number;
    weekdayClosedCount: number;
    weekendOpenCount: number;
  };
  exceptions: MarketCalendarExceptionInput[];
  createdAt: string;
}

export interface MarketCalendarVersionRecord {
  versionId: string;
  importOperationId: string;
  marketCode: MarketCode;
  calendarYear: number;
  sourceId: string | null;
  sourceLabel: string | null;
  sourceType: MarketCalendarSourceType;
  sourceUrl: string | null;
  retrievedAt: string;
  coverage: MarketCalendarCoverageAssertionRecord;
  confirmedAt: string | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  status: MarketCalendarVersionStatus;
  isActive: boolean;
  annualCounts: {
    tradingDayCount: number;
    nonTradingDayCount: number;
    weekdayClosedCount: number;
    weekendOpenCount: number;
  };
  exceptions: MarketCalendarExceptionInput[];
  createdAt: string;
  updatedAt: string;
}

export interface ConfirmMarketCalendarPreviewInput {
  previewToken: string;
  replaceConfirmed?: boolean;
  replacementReason?: string | null;
}

export interface InvalidateMarketCalendarVersionInput {
  marketCode: MarketCode;
  calendarYear: number;
  reason: string;
}

export interface MarketCalendarActivityEventRecord {
  id: string;
  marketCode: MarketCode;
  occurredAt: string;
  category: MarketCalendarActivityCategory;
  result: MarketCalendarActivityResult;
  sourceKind: MarketCalendarActivitySourceKind;
  sourceId: string | null;
  eventType: string;
  title: string;
  message: string;
  ticker: string | null;
  providerSymbol: string | null;
  operationId: string | null;
  jobId: string | null;
  calendarYear: number | null;
  dedupeKey: string | null;
  detail: Record<string, unknown>;
}

export interface CreateMarketCalendarActivityEventInput {
  marketCode: MarketCode;
  occurredAt?: string;
  category: MarketCalendarActivityCategory;
  result: MarketCalendarActivityResult;
  sourceKind: MarketCalendarActivitySourceKind;
  sourceId?: string | null;
  eventType: string;
  title: string;
  message: string;
  ticker?: string | null;
  providerSymbol?: string | null;
  operationId?: string | null;
  jobId?: string | null;
  calendarYear?: number | null;
  dedupeKey?: string | null;
  detail?: Record<string, unknown>;
}

export interface ListMarketCalendarActivityOptions {
  marketCode: MarketCode;
  page: number;
  limit: number;
  search?: string;
  categories?: MarketCalendarActivityCategory[];
  results?: MarketCalendarActivityResult[];
  sourceKinds?: MarketCalendarActivitySourceKind[];
  sourceIds?: string[];
  occurredAfter?: string;
}

export interface ListMarketCalendarActivityResult {
  items: MarketCalendarActivityEventRecord[];
  total: number;
  page: number;
  limit: number;
}

export type ProviderOperationOutcomeState =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped"
  | "rate_limited"
  | "cancelled";

export interface ProviderOperationOutcomeRecord {
  operationId: string;
  providerId: string;
  marketCode: ProviderOperationMarketCode;
  sourceSymbol: string;
  providerSymbol: string | null;
  action: string;
  state: ProviderOperationOutcomeState;
  message: string | null;
  errorCode: string | null;
  jobId: string | null;
  evidence: Record<string, unknown> | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProviderOperationOutcomeInput {
  operationId: string;
  providerId: string;
  marketCode: ProviderOperationMarketCode;
  sourceSymbol: string;
  providerSymbol?: string | null;
  action: string;
  state: ProviderOperationOutcomeState;
  message?: string | null;
  errorCode?: string | null;
  jobId?: string | null;
  evidence?: Record<string, unknown> | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface ListProviderOperationOutcomesOptions {
  operationId: string;
  state?: ProviderOperationOutcomeState;
  action?: string;
  page: number;
  limit: number;
}

export interface ProviderOperationOutcomeSummary {
  total: number;
  processed: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rateLimited: number;
  cancelled: number;
  progressPercent: number;
  result: "none" | "running" | "all_succeeded" | "partial" | "none_applied" | "failed" | "rate_limited";
}

export interface ListProviderOperationOutcomesResult {
  items: ProviderOperationOutcomeRecord[];
  summary: ProviderOperationOutcomeSummary;
  total: number;
  page: number;
  limit: number;
}

export interface LatestProviderOperationOutcomeOptions {
  providerId: string;
  marketCode: MarketCode;
  sourceSymbol: string;
  actions?: string[];
}

export interface ProviderResolutionMappingRecord {
  providerId: string;
  marketCode: MarketCode;
  sourceSymbol: string;
  resolvedSymbol: string;
  resolverMode: MarketDataResolverMode | null;
  evidence: Record<string, unknown> | null;
  verifiedAt: string;
  verifiedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UpsertProviderResolutionMappingInput {
  providerId: string;
  marketCode: MarketCode;
  sourceSymbol: string;
  resolvedSymbol: string;
  resolverMode?: MarketDataResolverMode | null;
  evidence?: Record<string, unknown> | null;
  verifiedAt?: string;
  verifiedByUserId?: string | null;
}

export interface ListProviderResolutionMappingsOptions {
  providerId?: string;
  marketCode?: MarketCode;
  search?: string;
  page: number;
  limit: number;
}

export interface ListProviderResolutionMappingsResult {
  items: ProviderResolutionMappingRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface DeleteProviderResolutionMappingInput {
  providerId: string;
  marketCode: MarketCode;
  sourceSymbol: string;
}

export interface ListProviderErrorTrailOptions {
  providerId?: string;
  marketCode?: MarketCode;
  errorMessageLike?: string;
  excludeResolvedMappings?: boolean;
  page: number;
  limit: number;
}

export interface ListProviderErrorTrailResult {
  items: ProviderErrorTrailRow[];
  total: number;
  page: number;
  limit: number;
}

export type ProviderUnresolvedItemState = "active" | "resolved" | "unsupported" | "ignored";
export type ProviderUnresolvedItemSeverity = "ok" | "warning" | "critical";

export interface ProviderUnresolvedItemRecord {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  sourceSymbol: string;
  providerSymbol: string | null;
  state: ProviderUnresolvedItemState;
  severity: ProviderUnresolvedItemSeverity;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  lastErrorTrailId: number | null;
  evidence: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedByOperationId: string | null;
  updatedAt: string;
}

export interface UpsertProviderUnresolvedItemInput {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  sourceSymbol: string;
  providerSymbol?: string | null;
  severity?: ProviderUnresolvedItemSeverity;
  lastErrorTrailId?: number | null;
  evidence?: Record<string, unknown> | null;
}

export interface ListProviderUnresolvedItemsOptions {
  providerId?: string;
  marketCode?: MarketCode;
  state?: ProviderUnresolvedItemState | "all";
  errorCode?: string;
  search?: string;
  sort?: "last_seen_desc" | "updated_desc" | "source_symbol_asc" | "occurrence_count_desc";
  page: number;
  limit: number;
}

export interface ListProviderUnresolvedItemsResult {
  items: ProviderUnresolvedItemRecord[];
  total: number;
  page: number;
  limit: number;
}

export interface UpdateProviderUnresolvedItemStateInput {
  providerId: string;
  marketCode: MarketCode;
  errorCode: string;
  sourceSymbol: string;
  state: ProviderUnresolvedItemState;
  actorUserId?: string | null;
  reason?: string | null;
}

export interface ResolveProviderUnresolvedItemsInput {
  providerId: string;
  marketCode: MarketCode;
  items: ProviderOperationScopeItem[];
  operationId?: string | null;
}

export interface AutoResolveProviderUnresolvedItemsBySourceSymbolInput {
  providerId: string;
  marketCode: MarketCode;
  sourceSymbol: string;
  operationId?: string | null;
}

// ── Holding snapshots (KZO-115, extended in KZO-165) ──────────────────────────

/**
 * Per-(account, ticker, market, date) holding snapshot row.
 *
 * KZO-165 extensions:
 * - `currency` is now the **native** currency of the holding (no fallback default).
 *   Writers must always supply it; the walker derives it from `trades[0].priceCurrency`
 *   and fails fast on mixed-currency rows for the same (account, ticker).
 * - `valueNative`, `costBasisNative`, `unrealizedPnlNative` carry the same numeric
 *   meaning as `marketValue`, `costBasis`, `unrealizedPnl` but in the native currency.
 *   For TWD-only data they equal the legacy columns by design (dual-write per D6).
 * - `providerSource` denormalizes the `daily_bars.source` of the bar that supplied
 *   `closePrice`. NULL on provisional rows.
 *
 * The legacy `marketValue`/`costBasis`/`unrealizedPnl` columns are retained and
 * dual-written pending KZO-176's dashboard rewrite + drop.
 */
export interface HoldingSnapshot {
  id: string;
  userId: string;
  accountId: string;
  ticker: string;
  /** Market that owns this ticker position. Required so cross-listed tickers do not collide. */
  marketCode: MarketCode;
  snapshotDate: string;
  quantity: number;
  closePrice: number | null;
  marketValue: number | null;
  costBasis: number;
  unrealizedPnl: number | null;
  cumulativeRealizedPnl: number;
  cumulativeDividends: number;
  isProvisional: boolean;
  currency: string;
  /** KZO-165: market value in native currency (4-decimal precision). NULL when closePrice is null. */
  valueNative: number | null;
  /** KZO-165: cost basis in native currency (2-decimal precision). */
  costBasisNative: number;
  /** KZO-165: unrealized P&L in native currency (2-decimal precision). NULL when valueNative is null. */
  unrealizedPnlNative: number | null;
  /** KZO-165: denormalized `daily_bars.source` for the bar that supplied closePrice. NULL on provisional rows. */
  providerSource: string | null;
  generatedAt: string;
  generationRunId: string;
}

export interface HoldingSnapshotListRow extends HoldingSnapshot {
  accountName: string | null;
}

export interface ListHoldingSnapshotsOptions {
  accountIds?: readonly string[];
  pairs?: readonly HoldingSnapshotScopePair[];
  startDate?: string;
  endDate?: string;
  includeProvisional?: boolean;
  limit: number;
  offset: number;
}

export interface ListHoldingSnapshotsResult {
  rows: HoldingSnapshotListRow[];
  total: number;
  provisionalCount: number;
}

export interface UnrealizedPnlAnalysisSnapshotOptions {
  accountIds?: readonly string[];
  markets?: readonly MarketCode[];
  tickers?: readonly string[];
  startDate: string;
  endDate: string;
  includeProvisional: boolean;
  reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency;
}

export interface UnrealizedPnlAnalysisSnapshotRow {
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
  snapshotDate: string;
  quantity: number;
  closePrice: number | null;
  providerSource: string | null;
  nativeCurrency: CurrencyCode;
  reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency;
  costBasisAmount: number | null;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  isProvisional: boolean;
  fxAvailable: boolean;
  fxAsOfDate: string | null;
}

export interface ResolvedFxRate {
  rate: number;
  asOfDate: string;
}

export interface McpReplayScopeRecord {
  accountId: string;
  accountName: string;
  ticker: string;
  marketCode: MarketCode;
}

export interface McpReplayPreviewRecord {
  id: string;
  sessionUserId: string;
  portfolioContextUserId: string;
  scopes: McpReplayScopeRecord[];
  warnings: string[];
  confirmationSummary: string;
  confirmationDigest: string;
  expiresAt: string;
  createdAt: string;
}

export type McpReplayRunStatus = "queued" | "running" | "completed" | "completed_with_failures" | "failed";
export type McpReplayRunScopeStatus = "pending" | "running" | "succeeded" | "failed";

export interface McpReplayRunScopeRecord extends McpReplayScopeRecord {
  status: McpReplayRunScopeStatus;
  errorMessage: string | null;
  replayedTradeCount: number | null;
  snapshotGenerationRunId: string | null;
  earliestReplayDate?: string;
  deletedTradeEventIds?: string[];
  updatedAt: string;
}

export interface McpReplayRunRecord {
  id: string;
  previewId: string;
  sessionUserId: string;
  portfolioContextUserId: string;
  status: McpReplayRunStatus;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  scopes: McpReplayRunScopeRecord[];
}

export type PostedTransactionMutationOperationRecord = "update" | "delete";
export type PostedTransactionMutationPreviewStatusRecord = "ready" | "expired" | "stale" | "confirmed" | "failed";
export type PostedTransactionMutationRunStatusRecord = "queued" | "running" | "completed" | "partially_failed" | "failed";
export type PostedTransactionMutationRebuildStatusRecord = "pending" | "running" | "completed" | "partially_failed" | "failed";
export type PostedTransactionMutationItemStatusRecord = "changed" | "deleted" | "unchanged" | "blocked";

export interface PostedTransactionMutationErrorRecord {
  code: string;
  message: string;
  transactionId?: string | null;
}

export interface PostedTransactionMutationScopeRecord {
  accountId: string;
  accountName: string;
  ticker: string;
  marketCode: MarketCode;
  earliestReplayDate: string;
  accountRevision: number;
  fingerprint: string;
  status?: PostedTransactionMutationRunStatusRecord | PostedTransactionMutationItemStatusRecord;
  errorMessage?: string | null;
  replayRunId?: string | null;
}

export interface PostedTransactionMutationPreviewItemRecord {
  transactionId: string;
  status: PostedTransactionMutationItemStatusRecord;
  note?: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  impacts: {
    quantityDelta: number;
    costBasisDelta: number;
    realizedPnlDelta: number;
    cashDelta: number;
    reopenedDividendCount: number;
    deletedDividendCount: number;
  };
  warnings: string[];
  blockers: string[];
  errors: PostedTransactionMutationErrorRecord[];
}

export interface PostedTransactionMutationPreviewRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string | null;
  operation: PostedTransactionMutationOperationRecord;
  status: PostedTransactionMutationPreviewStatusRecord;
  version: number;
  reason: string;
  confirmationSummary: string;
  confirmationDigest: string;
  fingerprint: string;
  batchLimit: number;
  summary: {
    quantityDelta: number;
    costBasisDelta: number;
    realizedPnlDelta: number;
    cashDelta: number;
    reopenedDividendCount: number;
    deletedDividendCount: number;
  };
  warnings: string[];
  blockers: string[];
  errors: PostedTransactionMutationErrorRecord[];
  affectedAccountIds: string[];
  affectedTickers: Array<{ ticker: string; marketCode: MarketCode }>;
  scopes: PostedTransactionMutationScopeRecord[];
  accountRevisions: Record<string, number>;
  items: PostedTransactionMutationPreviewItemRecord[];
  finalAccounting: AccountingStore;
  replayScopes: Array<{
    accountId: string;
    ticker: string;
    marketCode: MarketCode;
    fromDate: string;
    deletedTradeEventIds?: string[];
  }>;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  confirmedRunId: string | null;
}

export interface PostedTransactionMutationRunRecord {
  id: string;
  previewId: string;
  ownerUserId: string;
  actorUserId: string | null;
  operation: PostedTransactionMutationOperationRecord;
  status: PostedTransactionMutationRunStatusRecord;
  rebuildStatus: PostedTransactionMutationRebuildStatusRecord;
  reason: string;
  warnings: string[];
  blockers: string[];
  errors: PostedTransactionMutationErrorRecord[];
  summary: PostedTransactionMutationPreviewRecord["summary"];
  affectedAccountIds: string[];
  affectedTickers: Array<{ ticker: string; marketCode: MarketCode }>;
  scopes: PostedTransactionMutationScopeRecord[];
  fingerprint: string;
  confirmationDigest: string;
  replayRunId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface PostedTransactionMutationDeletedDraftLineageRecord {
  tradeEventId: string;
  ownerUserId: string;
  batchId: string;
  rowId: string;
  deletedAt: string;
  deletedByUserId: string | null;
  mutationRunId: string;
}

// ── Currency wallet snapshots (KZO-165) ───────────────────────────────────────

/**
 * Per-(account, currency, date) cash balance snapshot row.
 *
 * KZO-165 ships this as a minimal aggregator stub: rows are emitted for every date
 * with cash-ledger activity per (account, currency), with `wacFxToUsd = null`,
 * `realizedFxPnlLifetime = 0`, and `providerSource = null`. The real WAC math +
 * realized FX P&L crystallization is owned by KZO-166; the read-side dashboard
 * rewrite is owned by KZO-176.
 */
export interface CurrencyWalletSnapshot {
  userId: string;
  accountId: string;
  currency: string;
  date: string;
  balanceNative: number;
  wacFxToUsd: number | null;
  realizedFxPnlLifetime: number;
  providerSource: string | null;
  generatedAt: string;
  generationRunId: string;
}

/**
 * Trimmed cash-ledger row used by the wallet aggregator. We project only the four
 * fields the aggregator reads — keeps the persistence boundary narrow and avoids
 * shipping fee-policy snapshots, dividend metadata, etc., that the walker doesn't need.
 */
export interface CashLedgerEntryForBalance {
  accountId: string;
  currency: string;
  entryDate: string;
  amount: number;
}

/**
 * KZO-166: extended cash-ledger projection for the wallet WAC walker.
 * Includes fxRateToUsd and reversal-pair fields needed by the WAC engine.
 * Reversal pairs are filtered out upstream by getCashLedgerEntriesForWalletReplay.
 */
export interface CashLedgerEntryForWalletReplay {
  id: string;
  accountId: string;
  currency: string;
  entryDate: string;
  amount: number;
  fxRateToUsd: number | null;
  fxTransferId?: string | null;
  entryType: import("../types/store.js").CashLedgerEntryType;
  reversalOfCashLedgerEntryId?: string;
  bookedAt?: string;
}

export interface AggregatedSnapshotPoint {
  date: string;
  totalCostBasis: number;
  totalMarketValue: number | null;
  totalUnrealizedPnl: number | null;
  cumulativeRealizedPnl: number;
  cumulativeDividends: number;
  totalReturnAmount: number | null;
  totalReturnPercent: number | null;
  isProvisional: boolean;
  /**
   * KZO-180: per-snapshot-date FX availability rollup. `true` when every
   * contributing row's source currency either matches the requested reporting
   * currency (self-pair shortcut, fx = 1.0) OR has an FX rate at or before the
   * snapshot date. `false` when at least one contributing row's pair has no
   * forward-fillable FX rate.
   *
   * The legacy `getAggregatedSnapshots(...)` method (no reporting-currency
   * argument) does not perform FX translation and always emits `true`.
   */
  fxAvailable: boolean;
  /**
   * Internal coverage keys for rows that contributed to this snapshot date,
   * formatted as `${accountId}:${marketCode}:${ticker}`. Dashboard/report
   * performance services use these keys to reject partial all-market dates
   * instead of presenting a subset total as the whole portfolio.
   */
  snapshotContributorKeys?: string[];
}

export interface HoldingSnapshotScopePair {
  accountId: string;
  ticker: string;
  marketCode?: MarketCode;
}

export interface SnapshotScopeDiagnostics {
  latestSnapshotDate: string | null;
  missingProviderSourceCount: number;
  markets: Array<{
    marketCode: MarketCode;
    latestSnapshotDate: string | null;
    missingProviderSourceCount: number;
    providerSources: string[];
  }>;
}

export interface HoldingSnapshotLatestDateScopePair {
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
}

/**
 * Flat dividend record for snapshot generation: the walker accumulates these
 * by (accountId, ticker) in payment-date order. Filtering (posted, not
 * reversed, not superseded) is done server-side so the walker stays simple.
 */
export interface SnapshotDividendInput {
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
  paymentDate: string;
  amount: number;
  currency: CurrencyCode;
}

/**
 * Narrow trade shape for the snapshot walker — only the fields it actually
 * reads. Avoids loading fee policy snapshots, market data, etc., that the
 * walker does not need.
 */
export interface SnapshotTradeInput {
  id: string;
  accountId: string;
  ticker: string;
  type: "BUY" | "SELL";
  quantity: number;
  unitPrice: number;
  tradeDate: string;
  tradeTimestamp?: string;
  bookingSequence?: number;
  commissionAmount: number;
  taxAmount: number;
  realizedPnlAmount?: number | null;
  realizedPnlCurrency?: string | null;
  /** KZO-165: native currency of the trade. Walker uses trades[0].priceCurrency
   *  as the holding's native currency and fails fast on mixed values for the
   *  same (account, ticker). */
  priceCurrency: string;
  /** KZO-185: market code that owns this (ticker, market_code) row. Walker
   *  groups (account, ticker) and forwards `marketCode` into the
   *  `tickersNeedingBackfill` payload so downstream `boss.send` calls stamp
   *  the producer-validated `marketCode` directly — no per-ticker fallback. */
  marketCode: MarketCode;
}

export interface SnapshotLotAllocationInput {
  tradeEventId: string;
  allocatedCostAmount: number;
  costCurrency: string;
  lotOpenedAt: string;
}

export interface SnapshotGenerationInputs {
  trades: SnapshotTradeInput[];
  postedDividends: SnapshotDividendInput[];
  lotAllocations: SnapshotLotAllocationInput[];
}

export interface SnapshotGenerationScope {
  accountId: string;
  ticker: string;
  marketCode?: MarketCode;
}

export interface HoldingSnapshotRepairScope {
  userId: string;
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
}

export interface HoldingSnapshotRepairTargetOptions {
  fromDate: string;
  toDate: string;
  limit: number;
}

export interface HoldingSnapshotRepairTarget {
  ticker: string;
  marketCode: MarketCode;
  fromDate: string;
  affectedScopeCount: number;
  repairableRows: number;
  missingRows: number;
  incompleteRows: number;
}

// ── Admin portal list options (KZO-144) ────────────────────────────────────

export interface AdminUserListOptions {
  page: number;
  limit: number;
  search?: string;
  role?: UserRole;
  status?: AdminUserStatus;
}

export interface AdminInviteListOptions {
  page: number;
  limit: number;
  status?: InviteListStatus;
  email?: string;
}

export interface AdminAuditLogListOptions {
  page: number;
  limit: number;
  actorUserId?: string;
  targetUserId?: string;
  actions?: string[];
  fromDate?: string;
  toDate?: string;
}

export type QuoteFallbackProvider = "eodhd";
export type QuoteFallbackPriceType = "eod_close";
export type QuoteFallbackRefreshStatus = "success" | "warning" | "error" | "skipped" | "rate_limited";
export type QuoteFallbackCurrencySource = "provider" | "market_default";

export interface QuoteFallbackPolicyRecord {
  id: string;
  marketCode: MarketCode;
  ticker: string;
  provider: QuoteFallbackProvider;
  priceType: QuoteFallbackPriceType;
  providerSymbol: string;
  active: boolean;
  reason: string | null;
  createdAt: string;
  updatedAt: string;
  deactivatedAt: string | null;
  lastRefreshStatus: QuoteFallbackRefreshStatus | null;
  lastRefreshAt: string | null;
  lastRefreshError: string | null;
  lastRefreshErrorCode: string | null;
}

export interface QuoteFallbackSnapshotRecord {
  id: string;
  policyId: string;
  marketCode: MarketCode;
  ticker: string;
  provider: QuoteFallbackProvider;
  priceType: QuoteFallbackPriceType;
  providerSymbol: string;
  marketDate: string;
  close: number;
  previousClose: number | null;
  currency: string;
  currencySource: QuoteFallbackCurrencySource;
  source: string;
  fetchedAt: string;
  providerPayloadHash: string | null;
  providerMetadata: Record<string, unknown>;
  createdAt: string;
}

export interface QuoteFallbackPolicyWithSnapshotRecord extends QuoteFallbackPolicyRecord {
  latestSnapshot: QuoteFallbackSnapshotRecord | null;
}

export interface UpsertQuoteFallbackPolicyInput {
  marketCode: MarketCode;
  ticker: string;
  provider: QuoteFallbackProvider;
  priceType: QuoteFallbackPriceType;
  providerSymbol: string;
  active?: boolean;
  reason?: string | null;
}

export interface UpsertQuoteFallbackSnapshotInput {
  policyId: string;
  marketCode: MarketCode;
  ticker: string;
  provider: QuoteFallbackProvider;
  priceType: QuoteFallbackPriceType;
  providerSymbol: string;
  marketDate: string;
  close: number;
  previousClose: number | null;
  currency: string;
  currencySource: QuoteFallbackCurrencySource;
  source: string;
  fetchedAt: string;
  providerPayloadHash?: string | null;
  providerMetadata?: Record<string, unknown>;
}

export interface EodhdCallBudgetStatus {
  budgetDate: string;
  limit: number;
  used: number;
  remaining: number;
}

export interface CreateAccountInput {
  userId: string;
  name: string;
  defaultCurrency: import("@vakwen/shared-types").AccountDefaultCurrency;
  accountType: import("@vakwen/shared-types").AccountType;
  auditInput: Omit<AuditLogInput, "action">;
}

export interface UpdateAccountInput {
  userId: string;
  accountId: string;
  name?: string;
  feeProfileId?: string;
  defaultCurrency?: import("@vakwen/shared-types").AccountDefaultCurrency;
  accountType?: import("@vakwen/shared-types").AccountType;
  auditInput: Omit<AuditLogInput, "action">;
}

export interface AccountMutationPersistenceResult {
  account: import("@vakwen/shared-types").AccountDto;
  feeProfile: import("@vakwen/shared-types").FeeProfileDto;
  capabilities: import("@vakwen/shared-types").PortfolioCapabilitiesDto;
  changedFields?: string[];
}

export interface AccountLifecyclePersistenceResult {
  account: import("@vakwen/shared-types").AccountDto;
  deletedAt: string | null;
  finalName: string | null;
  capabilities: import("@vakwen/shared-types").PortfolioCapabilitiesDto;
  reportingCurrency: import("@vakwen/shared-types").PortfolioSelectionNormalizationResult<
    import("@vakwen/shared-types").AccountDefaultCurrency
  >;
  feeProfiles?: import("@vakwen/shared-types").FeeProfileDto[];
  feeProfileBindings?: import("@vakwen/shared-types").FeeProfileBindingDto[];
}

export interface Persistence {
  init(): Promise<void>;
  close(): Promise<void>;
  appendResearchIdentityRecords(records: ResearchIdentityRecord[]): Promise<void>;
  listResearchIdentityRecords(query: ResearchIdentityRecordQuery): Promise<ResearchIdentityRecord[]>;
  listLatestResearchIdentityRecords(query: ResearchIdentityRecordQuery): Promise<ResearchIdentityRecord[]>;
  /**
   * Resolve an existing user by email or create a new one.
   * Returns the internal UUID for the user.
   *
   * Field sync rules:
   * - First login: seed all fields from claims
   * - Subsequent login: update display_name, provider fields, last_seen_at; never touch email
   */
  resolveOrCreateUser(
    provider: string,
    providerSubject: string,
    claims: OAuthClaims,
    options?: ResolveOrCreateUserOptions,
  ): Promise<ResolveOrCreateUserResult>;
  /** @internal — used by resolveOrCreateUser and dev_bypass loadStore. Not for direct use from routes. */
  ensureDefaultPortfolioData(userId: string): Promise<void>;
  getAuthUserById(userId: string): Promise<AuthUserRecord | null>;
  getAuthUserByEmail(email: string): Promise<AuthUserRecord | null>;
  ensureDevBypassUser(): Promise<void>;
  promoteUserToAdminByEmail(
    email: string,
    action: AuditLogInput["action"],
    metadata?: Record<string, unknown>,
  ): Promise<AuthUserRecord | null>;
  appendAuditLog(input: AuditLogInput): Promise<void>;
  saveDividendDestructivePreview(input: SaveDividendDestructivePreviewInput): Promise<void>;
  getDividendDestructivePreview(previewId: string): Promise<DividendDestructivePreviewState | null>;
  countDividendDestructivePreviews(ownerUserId: string, operationKey: string): Promise<number>;
  recordDividendDestructiveOutcome(input: RecordDividendDestructiveOutcomeInput): Promise<void>;
  withDividendDestructiveLock<T>(ownerUserId: string, accountId: string, execute: () => Promise<T>): Promise<T>;
  /**
   * Runs a transaction write behind an owner lock. The scoped writer persists
   * the candidate through the same backend transaction that owns the lock.
   */
  withTransactionWriteLock<T>(
    ownerUserId: string,
    execute: (writer: TransactionWriteContext) => Promise<T>,
  ): Promise<T>;
  bumpSessionVersion(userId: string): Promise<number>;
  createInvite(input: CreateInviteInput): Promise<InviteRecord>;
  insertBootstrapInvite(input: CreateInviteInput): Promise<InviteRecord>;
  revokeInvite(code: string): Promise<void>;
  getInviteStatus(code: string): Promise<InviteStatus>;
  getInviteRecord(code: string): Promise<InviteRecord | null>;
  consumeInvite(code: string, email: string): Promise<ConsumeInviteResult>;
  createShareGrant(input: CreateShareGrantInput): Promise<ShareGrantRecord>;
  /**
   * Revoke a share grant owned by `ownerUserId`. Idempotent — already-revoked
   * shares silently succeed without re-emitting audit or notification. Records
   * `revokedByUserId` as the actor that revoked the row. Returns the grantee user
   * id when the revoke flipped the row from active to revoked, or null when the
   * call was a no-op (already revoked). Caller uses the return to decide whether
   * to publish an SSE event.
   */
  revokeShareGrant(
    shareId: string,
    input: {
      ownerUserId: string;
      revokedByUserId: string;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<{ granteeUserId: string } | null>;
  createShareCoupledInvite(input: CreateShareCoupledInviteInput): Promise<PendingShareInviteRecord>;
  countActivePendingShareInvites(ownerUserId: string): Promise<number>;
  listSharesForOwner(ownerUserId: string): Promise<ListSharesForOwnerResult>;
  listInboundSharesForGrantee(granteeUserId: string): Promise<ListInboundSharesForGranteeResult>;
  /**
   * Return `true` iff there is an active (non-revoked) share grant from `ownerUserId`
   * to `granteeUserId`. Used by the auth middleware to validate the `x-context-user-id`
   * header before hydrating `contextUserId`. Must be cheap (single indexed lookup).
   */
  validateActiveShare(ownerUserId: string, granteeUserId: string): Promise<boolean>;
  revokePendingShareInvite(
    code: string,
    ownerUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<void>;
  materializePendingSharesForEmail(input: MaterializePendingSharesInput): Promise<ShareGrantRecord[]>;
  getShareCapabilities(shareId: string): Promise<ShareCapability[]>;
  setShareCapabilities(input: SetShareCapabilitiesInput): Promise<ShareCapability[]>;
  getPendingShareInviteCapabilities(inviteCode: string): Promise<ShareCapability[]>;
  setPendingShareInviteCapabilities(input: SetPendingShareInviteCapabilitiesInput): Promise<ShareCapability[]>;
  saveAiConnectorConnection(input: SaveAiConnectorConnectionInput): Promise<AiConnectorConnectionRecord>;
  getAiConnectorConnection(id: string): Promise<AiConnectorConnectionRecord | null>;
  listAiConnectorConnectionsForUser(userId: string): Promise<AiConnectorConnectionRecord[]>;
  getAiConnectorPolicySettings(): Promise<AiConnectorPolicySettingsRecord>;
  saveAiConnectorPolicySettings(input: SaveAiConnectorPolicySettingsInput): Promise<AiConnectorPolicySettingsRecord>;
  saveMcpOAuthAuthorizationRequest(input: SaveMcpOAuthAuthorizationRequestInput): Promise<McpOAuthAuthorizationRequestRecord>;
  getMcpOAuthAuthorizationRequest(id: string): Promise<McpOAuthAuthorizationRequestRecord | null>;
  approveMcpOAuthAuthorizationRequest(
    input: ApproveMcpOAuthAuthorizationRequestInput,
  ): Promise<ApproveMcpOAuthAuthorizationRequestResult | null>;
  settleMcpOAuthAuthorizationRequest(
    id: string,
    userId: string,
    decision: "approved" | "denied",
    decidedAt: string,
  ): Promise<McpOAuthAuthorizationRequestRecord | null>;
  saveMcpOAuthAuthorizationCode(input: SaveMcpOAuthAuthorizationCodeInput): Promise<McpOAuthAuthorizationCodeRecord>;
  consumeMcpOAuthAuthorizationCode(codeHash: string): Promise<McpOAuthAuthorizationCodeRecord | null>;
  activateAiConnectorConnectionReplacingProvider(
    input: ActivateAiConnectorConnectionReplacingProviderInput,
  ): Promise<ActivateAiConnectorConnectionReplacingProviderResult | null>;
  saveAiConnectorCredential(input: SaveAiConnectorCredentialInput): Promise<AiConnectorCredentialRecord>;
  getAiConnectorCredentialByHash(tokenHash: string): Promise<AiConnectorCredentialRecord | null>;
  consumeAiConnectorCredential(id: string): Promise<AiConnectorCredentialRecord | null>;
  revokeAiConnectorCredential(id: string, replacedByCredentialId?: string | null): Promise<AiConnectorCredentialRecord | null>;
  revokeAiConnectorCredentialsForConnection(connectionId: string): Promise<void>;
  revokeAiConnectorConnectionsForProvider(
    provider: AiConnectorProvider,
    reason: string,
    revokedByUserId?: string | null,
  ): Promise<number>;
  appendAiConnectorAccessLog(input: AppendAiConnectorAccessLogInput): Promise<AiConnectorAccessLogRecord>;
  listAiConnectorAccessLogsForUser(
    userId: string,
    options?: ListAiConnectorAccessLogsOptions,
  ): Promise<AiConnectorAccessLogRecord[]>;
  saveAiTransactionDraftBatch(input: SaveAiTransactionDraftBatchInput): Promise<AiTransactionDraftBatchRecord | null>;
  getAiTransactionDraftBatch(id: string): Promise<AiTransactionDraftBatchAggregate | null>;
  listAiTransactionDraftBatchesForOwner(ownerUserId: string): Promise<AiTransactionDraftBatchRecord[]>;
  saveAiTransactionDraftRow(input: SaveAiTransactionDraftRowInput): Promise<AiTransactionDraftRowRecord | null>;
  listAiTransactionDraftRows(batchId: string): Promise<AiTransactionDraftRowRecord[]>;
  replaceAiTransactionDraftUnsupportedItems(
    batchId: string,
    items: SaveAiTransactionDraftUnsupportedItemInput[],
  ): Promise<AiTransactionDraftUnsupportedItemRecord[]>;
  listAiTransactionDraftUnsupportedItems(batchId: string): Promise<AiTransactionDraftUnsupportedItemRecord[]>;
  appendAiTransactionDraftEvent(input: AppendAiTransactionDraftEventInput): Promise<AiTransactionDraftEventRecord>;
  listAiTransactionDraftEvents(batchId: string): Promise<AiTransactionDraftEventRecord[]>;
  /**
   * Atomically persists posted AI draft rows with the accounting snapshot,
   * enclosing row version checks, batch version check, and confirmation event in
   * one transaction where the backend supports it. Returns null on optimistic
   * version conflict before any write is committed.
   */
  confirmAiTransactionDraftPosting(
    input: ConfirmAiTransactionDraftPostingInput,
  ): Promise<ConfirmAiTransactionDraftPostingResult | null>;
  /**
   * Atomically create an anonymous share token, enforcing the per-owner active-token
   * cap from `getEffectiveAnonymousShareTokenCap()` (DB override → env-fallback,
   * default 20; KZO-199). On Postgres, serialised with a
   * transaction-scoped advisory lock keyed by owner; on memory, with a per-owner
   * async mutex. Returns `"cap_exceeded"` when the owner already holds the maximum
   * number of active tokens, or `"collision"` on a UNIQUE violation against the
   * plaintext token (caller retries with a freshly minted token).
   */
  createAnonymousShareToken(input: CreateAnonymousShareTokenInput): Promise<CreateAnonymousShareTokenResult>;
  /**
   * List tokens for the owner with the 30-day retention filter applied — active
   * rows always visible; revoked/expired rows visible for 30 days after
   * termination. Sorted `created_at DESC`.
   */
  listAnonymousShareTokensForOwner(ownerUserId: string): Promise<AnonymousShareTokenRecord[]>;
  /**
   * Resolve a plaintext token to its active record (non-revoked, not expired).
   * Returns null in all other cases — callers must not distinguish between
   * missing, expired, and revoked in their responses.
   */
  findActiveAnonymousShareTokenByToken(token: string): Promise<AnonymousShareTokenRecord | null>;
  /**
   * Revoke a token owned by `ownerUserId`. Flips `revoked_at = NOW()` only when
   * the row is currently active (`revoked_at IS NULL AND expires_at > NOW()`);
   * otherwise returns `"noop"` without writing an audit entry. Wrong-owner
   * returns `"not_found"` (no existence leak).
   */
  revokeAnonymousShareToken(input: RevokeAnonymousShareTokenInput): Promise<RevokeAnonymousShareTokenResult>;
  /** Count active (non-revoked, non-expired) tokens for the owner. */
  countActiveAnonymousShareTokensForOwner(ownerUserId: string): Promise<number>;
  /**
   * Delete terminal (revoked or expired) anonymous_share_tokens whose
   * terminality is older than `olderThanMs`. Returns the number of rows
   * deleted. Memory backend is a no-op (returns 0).
   */
  purgeTerminalAnonymousShareTokens(olderThanMs: number): Promise<number>;
  getAccountMarketDividendSettings(
    userId: string,
    accountId: string,
    marketCode: MarketCode,
  ): Promise<AccountMarketDividendSettingsDto>;
  patchAccountMarketDividendSettings(
    userId: string,
    input: {
      accountId: string;
      marketCode: MarketCode;
      fallbackParValue: string | null;
      expectedVersion?: number;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<AccountMarketDividendSettingsDto>;
  getLatestDividendCalculation(
    userId: string,
    accountId: string,
    dividendEventId: string,
  ): Promise<DividendCalculationVersionDto | null>;
  confirmDividendCalculation(
    userId: string,
    input: DividendCalculationConfirmRequestDto & {
      providerValue: string | null;
      providerUnit: "RATIO" | "TWD_PER_SHARE" | "UNKNOWN" | null;
      providerSource: string | null;
      providerDataset: string | null;
      providerAuthoritativeRatio: string | null;
      ratio: string;
      theoreticalShares: string;
      expectedWholeShares: number;
      fractionalRemainder: string;
      requiresHighRatioConfirmation: boolean;
      drift: import("@vakwen/shared-types").DividendCalculationDriftDto | null;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<DividendCalculationVersionDto>;
  resetDividendCalculation(
    userId: string,
    input: DividendCalculationResetRequestDto & {
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<void>;
  amendDividendCalculation(
    userId: string,
    input: DividendCalculationAmendRequestDto & {
      providerValue: string | null;
      providerUnit: "RATIO" | "TWD_PER_SHARE" | "UNKNOWN" | null;
      providerSource: string | null;
      providerDataset: string | null;
      providerAuthoritativeRatio: string | null;
      ratio: string;
      theoreticalShares: string;
      expectedWholeShares: number;
      fractionalRemainder: string;
      requiresHighRatioConfirmation: boolean;
      drift: import("@vakwen/shared-types").DividendCalculationDriftDto | null;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<DividendCalculationVersionDto>;
  loadStore(userId: string): Promise<Store>;
  /**
   * Load the narrow store shape required by first-paint portfolio/dashboard
   * primary routes. Implementations should include user settings, active
   * accounts, fee config, open lots-derived holdings, and instrument metadata,
   * while skipping broad facts such as trades, cash ledger, dividend events,
   * recompute jobs, and lot allocations.
   */
  loadPrimaryReadStore(userId: string): Promise<Store>;
  /**
   * Load the store shape required by dashboard/portfolio enrichment reads.
   * This includes the accounting facts needed for overview dividends,
   * freshness, quote inputs, and valuation health while avoiding broad market
   * catalog hydration.
   */
  loadOverviewReadStore(userId: string): Promise<Store>;
  /**
   * Load the small transaction instrument option set used by portfolio forms.
   * This must not hydrate the full user store or full instrument catalog.
   */
  listTransactionInstrumentOptions(userId: string): Promise<InstrumentOptionDto[]>;
  saveStore(store: Store, options?: SaveStoreOptions): Promise<void>;
  saveRecomputeJob(job: RecomputeJob): Promise<void>;
  startRecomputeJob(userId: string, jobId: string, startedAt: string): Promise<boolean>;
  failRecomputeJob(
    userId: string,
    jobId: string,
    failure: { startedAt: string; completedAt: string; errorCode: string; errorMessage: string },
  ): Promise<boolean>;
  commitRecomputeStore(
    userId: string,
    accounting: AccountingStore,
    job: RecomputeJob,
  ): Promise<boolean>;
  upsertInstruments(userId: string, instruments: InstrumentDef[]): Promise<void>;
  loadAccountingStore(userId: string): Promise<AccountingStore>;
  saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void>;
  /**
   * KZO-168 D8: persist a full accounting snapshot together with one audit-log
   * row in a single DB transaction. Postgres opens BEGIN/COMMIT around both
   * writes; memory backend simply chains the two inserts (no real transaction
   * semantics). Used by the FX-transfer service so the cash-ledger legs and
   * the lifecycle audit row never diverge on partial failure.
   */
  saveAccountingStoreWithAudit(
    userId: string,
    accounting: AccountingStore,
    auditEntry: AuditLogInput,
    options?: AccountingStoreAuditOptions,
  ): Promise<void>;
  commitPostedTransactionMutation(input: {
    userId: string;
    accounting: AccountingStore;
    auditEntry: AuditLogInput;
    preview: PostedTransactionMutationPreviewRecord;
    replayPreview: McpReplayPreviewRecord;
    run: PostedTransactionMutationRunRecord;
    replayRun: McpReplayRunRecord;
    options: AccountingStoreAuditOptions & {
      deletedDraftLineage?: PostedTransactionMutationDeletedDraftLineageRecord[];
    };
  }): Promise<void>;
  getAccountAccountingRevision(userId: string, accountId: string): Promise<number>;
  savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void>;
  savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    marketData: MarketDataFacts,
    dividendLedgerEntryId: string,
  ): Promise<void>;
  replaceDividendSourceLinesForLedger(userId: string, ledgerEntryId: string, sourceLines: DividendSourceLine[]): Promise<void>;
  findDividendLedgerEntryById(userId: string, dividendLedgerEntryId: string): Promise<DividendLedgerEntry | null>;
  /**
   * Fetch a single dividend ledger entry with its deductions + source lines
   * eagerly attached, keyed by its primary id and scoped to the owning user.
   *
   * Used by the PATCH reconciliation route handler so it can return the
   * nested entry shape without scanning a paginated list — safe regardless
   * of how many historical rows the account has accumulated.
   */
  getDividendLedgerEntryWithDetails(
    userId: string,
    dividendLedgerEntryId: string,
  ): Promise<
    | (DividendLedgerEntry & {
        deductions: Store["accounting"]["facts"]["dividendDeductionEntries"];
        sourceLines: DividendSourceLine[];
      })
    | null
  >;
  getDividendReviewRowDetail(
    userId: string,
    dividendLedgerEntryId: string,
  ): Promise<DividendReviewResponseRowWithDetails | null>;
  updateDividendReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: DividendLedgerEntry["reconciliationStatus"],
    note?: string,
    expectedVersion?: number,
  ): Promise<DividendLedgerEntry>;
  updateDividendStockReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: NonNullable<DividendLedgerEntry["stockReconciliationStatus"]>,
    note?: string | null,
    expectedVersion?: number,
    auditInput?: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<DividendLedgerEntry>;
  updatePostedCashDividend(userId: string, input: UpdatePostedCashDividendInput): Promise<DividendLedgerEntry>;
  /**
   * Apply a pre-computed set of dividend ledger recompute changes atomically.
   * Caller computes the change plan via planDividendLedgerRecompute; this
   * method persists it under a row lock. Returns the set of entries that
   * were actually updated (input minus rows that drifted due to concurrent
   * writes — currently best-effort, version mismatches are ignored since
   * recompute is idempotent against itself).
   */
  applyDividendLedgerRecompute(
    userId: string,
    changes: DividendLedgerRecomputeChange[],
  ): Promise<DividendLedgerRecomputeChange[]>;
  /**
   * Enumerate the distinct (userId, accountId, ticker) scopes with at least
   * one non-superseded, non-reversed dividend ledger entry. Used by the
   * startup backfill to iterate exactly the scopes that need a recompute.
   */
  listDividendLedgerScopes(): Promise<Array<{ userId: string; accountId: string; ticker: string }>>;
  listDividendEventsByPaymentDate(
    userId: string,
    fromPaymentDate?: string,
    toPaymentDate?: string,
    limit?: number,
    marketCode?: MarketCode,
  ): Promise<Store["marketData"]["dividendEvents"]>;
  listDividendCalendarSnapshot(
    userId: string,
    opts: DividendCalendarSnapshotOptions,
  ): Promise<DividendCalendarSnapshotResult>;
  listDividendDailyHighlightsSnapshot(
    userId: string,
    opts: DividendDailyHighlightsSnapshotOptions,
  ): Promise<DividendCalendarSnapshotResult>;
  listDividendLedgerEntries(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendLedgerListResult>;
  listDividendReviewRows(
    userId: string,
    opts: DividendReviewListOptions,
  ): Promise<DividendReviewListResult>;
  listDividendReviewPrimary(
    userId: string,
    query: DividendReviewPrimaryQueryDto,
  ): Promise<DividendReviewPrimaryResult>;
  getDividendReviewEnrichment(
    userId: string,
    filters: DividendReviewFilterDto,
  ): Promise<DividendReviewEnrichmentResult>;
  listDividendReviewMetadata(
    userId: string,
    filters?: Partial<Pick<DividendReviewFilterDto, "accountIds" | "fromPaymentDate" | "toPaymentDate">>,
  ): Promise<DividendReviewMetadataResult>;
  listDividendLedgerYears(userId: string): Promise<{ years: number[] }>;
  getTickerFundamentals(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<PersistedTickerFundamentalsRecord | null>;
  saveTickerFundamentalsSnapshot(
    input: SaveTickerFundamentalsSnapshotInput,
  ): Promise<PersistedTickerFundamentalsRecord>;
  recordTickerFundamentalsRefreshFailure(
    input: RecordTickerFundamentalsRefreshFailureInput,
  ): Promise<PersistedTickerFundamentalsRecord>;
  listCashLedgerEntries(userId: string, opts: CashLedgerListOptions): Promise<CashLedgerListResult>;
  listAccountsWithLiveBalances(userId: string): Promise<AccountWithLiveBalancesRecord[]>;
  /** Narrow account metadata read used by bounded account mutations. */
  listActiveAccounts(userId: string): Promise<import("@vakwen/shared-types").AccountDto[]>;
  getCashLedgerEnrichment(
    userId: string,
    input: {
      accountIds: string[];
      relatedTradeEventIds: string[];
      relatedDividendLedgerEntryIds: string[];
      fxTransferIds: string[];
    },
  ): Promise<CashLedgerEnrichmentResult>;
  claimIdempotencyKey(userId: string, key: string): Promise<boolean>;
  releaseIdempotencyKey(userId: string, key: string): Promise<void>;
  getProfile(userId: string): Promise<ProfileDto>;
  getUserSettings(userId: string): Promise<UserSettings>;
  updateProfileEmail(userId: string, email: string): Promise<ProfileDto>;
  /**
   * ui-reshape Phase 3d S7 — set the user-overridable profile fields
   * (`userDisplayName`, `userPictureUrl`). Each field is independently
   * controlled:
   *   - `undefined` (key absent) → leave unchanged
   *   - `null` → clear the override (resolver falls back to provider value)
   *   - non-null string → set the override
   *
   * Storage (LOCKED per architect-design §7.1): JSONB under
   * `user_preferences.preferences.userProfile.{displayName, pictureUrl}`.
   * No DB migration. Validation (HTTPS-only on `pictureUrl`, length on
   * `displayName`) is enforced at the route layer per
   * `.claude/rules/provider-url-sanitization.md`.
   */
  updateProfileFields(
    userId: string,
    fields: { displayName?: string | null; pictureUrl?: string | null },
  ): Promise<ProfileDto>;
  getLatestBars(tickers: string[], limit: number): Promise<DailyBar[]>;
  getLatestBarsByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
    limit: number,
  ): Promise<DailyBarWithMarket[]>;
  getLatestIntradayOverlay(ticker: string, marketCode: MarketCode): Promise<IntradayPriceOverlay | null>;
  getLatestIntradayOverlays(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, IntradayPriceOverlay>>;
  setLatestIntradayOverlay(overlay: IntradayPriceOverlay): Promise<void>;
  deleteLatestIntradayOverlay(ticker: string, marketCode: MarketCode): Promise<void>;
  getLatestBarDatesForReconciliation(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>>;
  /**
   * KZO-173: distinct `bar_date` values from `market_data.daily_bars` for the
   * given market, on or after `fromDate` inclusive. Ordered ascending.
   */
  getDistinctBarDates(market: MarketCode, fromDate: string): Promise<string[]>;
  /**
   * KZO-177 (P2 Fix 3): batched latest-bar-date lookup keyed by composite
   * `(ticker, marketCode)`. Returns `null` for keys with no bar data. Used by
   * the dashboard freshness classifier — required so cross-listed instruments
   * (e.g. BHP/AU vs BHP/US) get classified against the correct market's data
   * rather than being collapsed under the bare ticker.
   *
   * Returned map keys are `${ticker}:${marketCode}`.
   */
  getLatestBarDatesByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>>;
  readiness(): Promise<ReadinessStatus>;
  markDemoUser(userId: string, ttlSeconds: number): Promise<void>;

  // Transaction mutation methods
  getTradeEvent(userId: string, tradeEventId: string): Promise<BookedTradeEvent | null>;
  deleteTradeEvent(userId: string, tradeEventId: string): Promise<DeleteTradeEventResult>;
  updateTradeEvent(userId: string, tradeEventId: string, patch: TradeEventPatch): Promise<{ accountId: string; ticker: string }>;
  getTradeEventsForAccountTicker(userId: string, accountId: string, ticker: string, marketCode?: MarketCode): Promise<BookedTradeEvent[]>;
  getPositionActionsForAccountTicker(userId: string, accountId: string, ticker: string, marketCode?: MarketCode): Promise<PositionAction[]>;
  deleteLotsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds?: readonly string[],
  ): Promise<number>;
  deleteLotAllocationsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds?: readonly string[],
  ): Promise<number>;
  deleteTradeCashEntriesForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds?: readonly string[],
  ): Promise<number>;
  bulkUpsertLots(userId: string, lots: Lot[]): Promise<void>;
  bulkInsertLotAllocations(userId: string, allocations: LotAllocationProjection[]): Promise<void>;
  bulkInsertCashLedgerEntries(userId: string, entries: CashLedgerEntry[]): Promise<void>;
  compactBookingSequence(userId: string, accountId: string, tradeDate: string): Promise<void>;

  // Instruments
  // KZO-169: `marketCode` becomes part of the lookup key after migration 044.
  // Optional for back-compat in legacy callers (read-only consumers that
  // haven't yet been threaded with market context); when present, the
  // implementation matches against the composite `(ticker, market_code)` PK.
  // When absent, the implementation falls back to ticker-only lookup which is
  // safe for monomarket TW deployments and degrades to the first match
  // otherwise.
  getInstrument(ticker: string, marketCode?: string): Promise<InstrumentRow | null>;
  // KZO-197 P2-2: scope status updates by (ticker, marketCode). The previous
  // bare-ticker form silently mutated cross-listed sibling rows (e.g. BHP/AU
  // vs BHP/US) when the AU catalog warm-up bulk-stamped statuses. All callers
  // already have `marketCode` in scope via job data, instrument lookups, etc.
  updateBackfillStatus(
    ticker: string,
    marketCode: MarketCode,
    status: BackfillStatus,
  ): Promise<void>;
  updateLastRepairAt(ticker: string): Promise<void>;

  // Quote fallback policies — global market-data configuration used by
  // displayed valuation only. Normal historical bars/reports stay unchanged.
  getQuoteFallbackPolicy(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<QuoteFallbackPolicyWithSnapshotRecord | null>;
  listQuoteFallbackPoliciesForTickerMarkets(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<QuoteFallbackPolicyWithSnapshotRecord[]>;
  listActiveQuoteFallbackPolicies(
    marketCode?: MarketCode,
  ): Promise<QuoteFallbackPolicyRecord[]>;
  upsertQuoteFallbackPolicy(
    input: UpsertQuoteFallbackPolicyInput,
  ): Promise<QuoteFallbackPolicyWithSnapshotRecord>;
  deactivateQuoteFallbackPolicy(
    input: { ticker: string; marketCode: MarketCode },
  ): Promise<QuoteFallbackPolicyWithSnapshotRecord | null>;
  getLatestQuoteFallbackSnapshot(policyId: string): Promise<QuoteFallbackSnapshotRecord | null>;
  upsertQuoteFallbackSnapshot(input: UpsertQuoteFallbackSnapshotInput): Promise<QuoteFallbackSnapshotRecord>;
  updateQuoteFallbackPolicyRefreshStatus(input: {
    policyId: string;
    status: QuoteFallbackRefreshStatus;
    refreshedAt: string | null;
    error?: string | null;
    errorCode?: string | null;
  }): Promise<QuoteFallbackPolicyRecord | null>;
  consumeEodhdCallBudget(input: {
    budgetDate: string;
    limit: number;
    calls?: number;
  }): Promise<EodhdCallBudgetStatus & { allowed: boolean }>;
  getEodhdCallBudgetStatus(input: {
    budgetDate: string;
    limit: number;
  }): Promise<EodhdCallBudgetStatus>;

  // App config (KZO-133) — global settings. Returns null when unset (callers
  // fall back to Env defaults via getEffectiveRepairCooldownMinutes()).
  getRepairCooldownMinutes(): Promise<number | null>;

  // App config (KZO-142 / KZO-159 / KZO-189 / KZO-198) — read the raw DB overrides +
  // updatedAt stamp. Routes combine this with getEffectiveRepairCooldownMinutes(),
  // the 3-tier range resolver, and getEffectiveMetadataEnrichmentMode() to
  // expose the full AppConfigDto to clients. KZO-198 added 19 nullable columns
  // covering Tier 0 secrets (encrypted) + Tier 1/2 plain incident levers; the
  // shape mirrors `AppConfigCacheEntry` so the cache can store the row directly.
  getAppConfig(): Promise<{
    repairCooldownMinutes: number | null;
    dashboardPerformanceRanges: string[] | null;
    metadataEnrichmentMode: "unconditional" | "conditional" | null;
    finmindApiTokenEncrypted: string | null;
    twelveDataApiKeyEncrypted: string | null;
    eodhdApiKeyEncrypted: string | null;
    mcpOauthTokenSecretEncrypted: string | null;
    marketDataPriceWindowMs: number | null;
    marketDataPriceLimit: number | null;
    marketDataSearchWindowMs: number | null;
    marketDataSearchLimit: number | null;
    inviteStatusWindowMs: number | null;
    inviteStatusLimit: number | null;
    providerDownNotificationSuppressionMs: number | null;
    providerErrorTrailRetentionDays: number | null;
    providerRerunCooldownMs: number | null;
    /** KZO-197 — yahoo-finance-au rerun cooldown override (ms). NULL = use Env.YAHOO_AU_RERUN_COOLDOWN_MS (30 min default). */
    yahooAuRerunCooldownMs: number | null;
    providerFixerDangerousMatchThreshold: number | null;
    providerFixerPreviewSampleLimit: number | null;
    providerFixerUiPageSize: number | null;
    providerFixerAutoPauseFailuresPerMinute: number | null;
    providerFixerPreviewTokenTtlMinutes: number | null;
    providerOperationAutoRenewIntervalMinutes: number | null;
    providerIncidentRecurrenceWindowMinutes: number | null;
    providerHealthWarningUnresolvedThreshold: number | null;
    providerHealthCriticalUnresolvedThreshold: number | null;
    providerOperationStaleHeartbeatMinutes: number | null;
    providerOperationSummaryRetentionDays: number | null;
    providerOperationLogRetentionDays: number | null;
    providerIncidentRetentionDays: number | null;
    providerResolvedItemRetentionDays: number | null;
    finmindProviderRateLimitPerHour: number | null;
    twelveDataProviderRateLimitPerMinute: number | null;
    yahooAuProviderRateLimitPerMinute: number | null;
    yahooKrProviderRateLimitPerMinute: number | null;
    yahooJpProviderRateLimitPerMinute: number | null;
    frankfurterProviderRateLimitPerMinute: number | null;
    asxGicsProviderRateLimitPerHour: number | null;
    finmindProviderMinRequestIntervalMs: number | null;
    twelveDataProviderMinRequestIntervalMs: number | null;
    yahooAuProviderMinRequestIntervalMs: number | null;
    yahooKrProviderMinRequestIntervalMs: number | null;
    yahooJpProviderMinRequestIntervalMs: number | null;
    frankfurterProviderMinRequestIntervalMs: number | null;
    asxGicsProviderMinRequestIntervalMs: number | null;
    jpCatalogAllowedStockTypes: JpCatalogStockType[] | null;
    jpCatalogIncludeDepositaryReceipts: boolean | null;
    jpCatalogIncludeAtSymbols: boolean | null;
    backfillRetryLimit: number | null;
    backfillRetryDelaySeconds: number | null;
    backfillFinmind402RetryMs: number | null;
    tickerPriceCloseRefreshGraceMinutes: number | null;
    tickerPriceIntradayEnabled: boolean | null;
    tickerPriceIntradayRefreshIntervalMinutes: number | null;
    tickerPriceIntradayFreshnessToleranceMinutes: number | null;
    tickerPriceYahooChartRequestLimitPerMinute: number | null;
    tickerPriceQueueConcurrency: number | null;
    tickerPriceMaxTickersPerRefreshCycle: number | null;
    tickerPriceSupportedMarkets: SharedMarketCode[] | null;
    tickerPriceRegularSessionOnly: boolean | null;
    tickerPriceYahooChartRange: import("@vakwen/shared-types").TickerPriceFreshnessYahooChartRange | null;
    tickerPriceYahooChartInterval: import("@vakwen/shared-types").TickerPriceFreshnessYahooChartInterval | null;
    tickerPriceRefreshCloseRateLimitWindowMs: number | null;
    tickerPriceRefreshCloseRateLimitMax: number | null;
    tickerPriceSyncTickerCap: number | null;
    tickerPriceActivityDetailedRetentionDays: number | null;
    tickerPriceActivitySummaryRetentionDays: number | null;
    tickerPriceCalendarHistoryRetentionDays: number | null;
    dailyRefreshLookbackDays: number | null;
    dailyRefreshPriority: number | null;
    sseHeartbeatIntervalMs: number | null;
    sseMaxConnectionsPerUser: number | null;
    sseBufferDefaultTtlMs: number | null;
    // KZO-195 — Tier 2 absence-based delisting detection knobs.
    catalogAbsenceThreshold: number | null;
    catalogAbsenceGuardPercent: number | null;
    catalogAbsenceGuardFloor: number | null;
    // KZO-196 — Tier A AU GICS sync cron schedule override (NULL = use env).
    asxGicsRefreshCron: string | null;
    // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
    anonymousShareTokenCap: number | null;
    anonymousShareRateLimitMax: number | null;
    anonymousShareRateLimitWindowMs: number | null;
    // KZO-199 — Tier 2 (DB+SQL only; NOT in PATCH or UI).
    anonymousShareTokenRetentionMs: number | null;
    userPreferencesMaxBytes: number | null;
    // ui-enhancement — Tier B account-soft-delete grace period (NULL → env).
    accountHardPurgeDays: number | null;
    valuationHealthRelativeBps: number | null;
    valuationHealthAbsoluteAud: number | null;
    valuationHealthAbsoluteUsd: number | null;
    valuationHealthAbsoluteTwd: number | null;
    valuationHealthAbsoluteKrw: number | null;
    valuationHealthAbsoluteJpy: number | null;
    routeCachePolicyMode: RouteCachePolicyMode | null;
    routeCacheDashboardPrimaryTtlMs: number | null;
    routeCacheDashboardEnrichmentTtlMs: number | null;
    routeCacheDashboardPerformanceTtlMs: number | null;
    routeCachePortfolioTtlMs: number | null;
    routeCacheReportsTtlMs: number | null;
    routeCacheStaleUsableTtlMs: number | null;
    eodhdDailyCallLimit: number | null;
    updatedAt: string;
  }>;

  // App config (KZO-142) — set (or clear) the repair cooldown override and
  // stamp the `updated_at` column. The route layer wraps this in an audit log.
  setRepairCooldownMinutes(value: number | null): Promise<void>;

  // App config (KZO-159 / 158A) — set (or clear, when `null`) the admin
  // override for the user-facing dashboard timeframe picker. The route layer
  // validates the list shape via `dashboardPerformanceRangesSchema` from
  // `@vakwen/shared-types` and wraps this in an `app_config_updated`
  // audit entry (see adminRoutes.ts).
  setDashboardPerformanceRanges(value: string[] | null): Promise<void>;

  // App config (KZO-189) — read the raw DB override for AU metadata enrichment
  // mode. Returns null when unset; callers fall back to Env.METADATA_ENRICHMENT_MODE
  // via getEffectiveMetadataEnrichmentMode().
  getMetadataEnrichmentMode(): Promise<"unconditional" | "conditional" | null>;

  // App config (KZO-189) — set (or clear, when `null`) the admin override for
  // AU metadata enrichment mode. The route layer wraps this in an audit log
  // (action `app_config_updated`).
  setMetadataEnrichmentMode(value: "unconditional" | "conditional" | null): Promise<void>;
  setRouteCachePolicyMode(value: RouteCachePolicyMode | null): Promise<void>;

  // App config (KZO-198) — generic per-field setter for Tier 1/2 plain
  // overrides. `field` is the camelCase key matching `getAppConfig()`'s
  // return shape; `value` is `null` to clear or the new value to set.
  // Stamps `updated_at`. The route layer wraps this in an `app_config_updated`
  // audit entry. Setters must be atomic (single UPSERT).
  setAppConfigField(
    field: AppConfigPlainField,
    value: AppConfigPlainValue,
  ): Promise<void>;

  // App config (KZO-198 Tier 0) — set (or clear, when `null`) an encrypted
  // secret. Implementations call `encryptSecret(plaintext)` from
  // `apps/api/src/services/appConfig/encryption.ts` inline so the plaintext
  // never lives outside the persistence boundary. `null` clears the column.
  // Stamps `updated_at`.
  setAppConfigEncryptedSecret(
    field: "finmindApiToken" | "twelveDataApiKey" | "eodhdApiKey" | "mcpOauthTokenSecret",
    plaintext: string | null,
  ): Promise<void>;

  // App config (KZO-198) — aggregate patch setter. Applies any subset of the
  // 17 Tier 1/2 plain fields and the 2 Tier 0 secrets in a single atomic
  // write (Postgres: one UPSERT). Tier 0 secrets are passed as plaintext on
  // the `finmindApiToken` / `twelveDataApiKey` keys; the implementation
  // encrypts them inline so plaintext never crosses the persistence boundary.
  // `null` on any key clears the column. Stamps `updated_at`. Route layer
  // wraps the resulting diff in an `app_config_updated` audit entry.
  setAppConfigPatch(patch: AppConfigPatch): Promise<void>;

  // User preferences (KZO-159 / 158A) — per-user JSONB preferences row.
  // `getUserPreferences` returns `{}` when no row exists (lazy — no insert
  // on read). `setUserPreferencePatch` performs a single-UPDATE top-level
  // merge: non-null keys replace existing values, `null` deletes the key.
  // Implementations must be atomic (INSERT ... ON CONFLICT DO UPDATE on
  // Postgres; equivalent guarantee on memory). See design doc D3 for the
  // canonical Postgres SQL shape.
  getUserPreferences(userId: string): Promise<Record<string, unknown>>;
  setUserPreferencePatch(
    userId: string,
    patch: Record<string, unknown | null>,
  ): Promise<Record<string, unknown>>;

  // Test-only helper — used by POST /__e2e/seed-user-preferences to seed a
  // full preferences object for a user. Must never be called from production
  // code paths. Guarded at the route layer by `assertE2ESeedEnabled()`.
  _setUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<void>;

  // Monitored tickers
  // KZO-133: persistence returns DTOs without `repairAvailableAt` — route layer
  // decorates using getEffectiveRepairCooldownMinutes() + deriveRepairAvailableAt().
  getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]>;
  // KZO-185: returns `(ticker, marketCode)` pairs so producers (daily refresh,
  // post-recompute auto-backfill) can stamp `marketCode` on `BackfillJobData`
  // directly. The Zod gatekeeper at the worker entry validates the value; the
  // catalog `i.market_code` join in postgres.ts is the authoritative source.
  getAllMonitoredTickers(): Promise<{ ticker: string; marketCode: string }[]>;
  // Ticker price freshness: returns active, non-demo open-position pairs only.
  // Unlike `getAllMonitoredTickers`, this intentionally excludes manual/watchlist
  // selections so scheduled close refreshes stay scoped to held tickers.
  listHeldTickerMarketPairs(): Promise<{ ticker: string; marketCode: MarketCode }[]>;
  listHeldTickerMarketPairsForQuoteFallback(): Promise<{ ticker: string; marketCode: MarketCode }[]>;
  /**
   * KZO-197 — return AU instruments that need a bars-backfill (status `pending`
   * or `failed`, not delisted). Used by the AU "Re-run now" button's catalog
   * warm-up path. Read directly from `market_data.instruments` (NOT from the
   * monitored set) so a fresh-deploy AU catalog can warm without any user
   * having added a monitored ticker yet. Postgres impl uses the
   * schema-qualified table name; memory impl reads from the canonical
   * in-memory catalog map.
   */
  listAuCatalogBarsBackfillCandidates(): Promise<Array<{ ticker: string; marketCode: "AU" }>>;
  listCatalogBarsBackfillCandidates(marketCode: MarketCode): Promise<Array<{ ticker: string; marketCode: MarketCode }>>;
  getUsersMonitoringTicker(ticker: string): Promise<string[]>;
  getManualSelections(userId: string): Promise<{ ticker: string; marketCode: string; addedAt: string }[]>;
  // KZO-169: signature change — entries are now keyed by `(ticker, market_code)`
  // composite to honor migration 044's PK. The newTickers field continues to
  // return the keys that were not previously monitored (manual or position).
  // KZO-188: optional `name` + `instrumentType` carry metadata for live-search
  // picks that are not yet in `market_data.instruments`. When both are
  // provided, the implementation upserts the catalog row (ON CONFLICT DO
  // NOTHING) before the FK insert so an un-catalogued AU pick like CBA can be
  // saved on Postgres without violating `user_monitored_tickers_*_fkey`.
  replaceManualSelections(
    userId: string,
    selections: ReadonlyArray<{
      ticker: string;
      marketCode: string;
      name?: string | null;
      instrumentType?: InstrumentType | null;
    }>,
  ): Promise<{ newTickers: string[] }>;
  listInstrumentsCatalog(
    search?: string,
    type?: string,
    marketCode?: string,
    userId?: string,
    options?: { includeInactive?: boolean },
  ): Promise<Array<Omit<InstrumentCatalogItemDto, "repairAvailableAt"> & {
    delistedAt?: string | null;
    supportState?: "supported" | "retired_by_admin" | "unsupported_by_provider";
  }>>;

  // Catalog sync
  upsertInstrumentCatalog(
    instruments: CatalogInstrument[],
    delistings: DelistingRecord[],
    options?: UpsertInstrumentCatalogOptions,
  ): Promise<CatalogSyncResult>;

  // Admin overrides for absence-based delisting detection and support state.
  // Route handlers supply the explicit marketCode so mutations never spill
  // across exchanges that share a ticker.
  instrumentAdminGet(ticker: string, marketCode: string): Promise<AdminInstrumentRow | null>;
  undeleteInstrument(
    ticker: string,
    marketCode: string,
    actorUserId: string,
  ): Promise<AdminInstrumentRow>;
  setInstrumentDelistingDetectionExcluded(
    ticker: string,
    marketCode: string,
    excluded: boolean,
    actorUserId: string,
  ): Promise<AdminInstrumentRow>;
  setInstrumentSupportState(
    ticker: string,
    marketCode: string,
    supportState: AdminInstrumentRow["supportState"],
    actorUserId: string,
  ): Promise<AdminInstrumentRow>;
  // Paginated admin market-data instrument listing. Filters by marketCode;
  // returns items + total count + page/limit echo. Caller layers the
  // `thresholds` block on top of this.
  listAdminInstruments(opts: {
    marketCode: string;
    page: number;
    limit: number;
    status?: "listed" | "delisted" | "excluded" | "all";
    supportState?: AdminInstrumentRow["supportState"] | "all";
    search?: string;
    instrumentType?: InstrumentType | "all";
    backfillStatus?: "pending" | "backfilling" | "ready" | "failed" | "all";
    sort?: "ticker_asc" | "ticker_desc" | "updated_desc" | "updated_asc";
  }): Promise<{
    items: AdminInstrumentRow[];
    total: number;
    page: number;
    limit: number;
  }>;
  listAdminMarketDataBackfillTargets(
    options: ListAdminMarketDataBackfillTargetsOptions,
  ): Promise<AdminMarketDataBackfillTargetRow[]>;
  countAdminMarketDataTargetOwnership(
    options: CountAdminMarketDataTargetOwnershipOptions,
  ): Promise<AdminMarketDataTargetOwnershipCounts>;
  purgeAdminMarketData(input: AdminMarketDataPurgeInput): Promise<AdminMarketDataPurgeCounts>;

  // KZO-164: FX rates (Frankfurter v2 ingestion). All three methods are required because
  // `fxRefreshWorker.ts` and the admin routes consume them through the `Persistence`
  // interface (no direct Postgres pool access — keeps the worker testable on memory).
  /**
   * Bulk upsert FX rates. Postgres uses `ON CONFLICT (date, base_currency, quote_currency)
   * DO UPDATE SET rate, source, ingested_at`. Memory uses `Map<dateKey, FxRate>` keyed
   * by `${date}:${base}:${quote}`. Returns the row count actually upserted.
   *
   * Caller (worker) MUST filter self-pairs (`r.quoteCurrency !== r.baseCurrency`) before
   * calling — schema CHECK rejects them and would crash the entire batch in Postgres.
   */
  upsertFxRates(rates: ReadonlyArray<FxRate>): Promise<number>;
  /** Returns the maximum `date` across all FX rate rows, or `null` for an empty table. */
  getLatestFxRateDate(): Promise<string | null>;
  /**
   * Per-pair freshness summary — one row per `(baseCurrency, quoteCurrency)` with the
   * most recent date for that pair. Ordered by base, then quote, ascending.
   */
  getFxRateFreshness(): Promise<Array<{ baseCurrency: string; quoteCurrency: string; latestDate: string }>>;
  /**
   * KZO-166 read helper. Returns the latest FX rate for the (base → quote) pair
   * with `date <= asOfDate` (forward-fill semantics).
   *
   * Self-pair shortcut: when `base === quote`, returns `1.0` without touching the DB.
   *
   * Returns `null` when no rate exists for the pair at or before `asOfDate`.
   *
   * Backed by `idx_fx_rates_pair_date_desc` for O(log N) lookup.
   *
   * Caller contract:
   *   - Write-path callers (wallet generator) MUST throw
   *     `MissingFxRateError(base, quote, asOfDate)` on `null`.
   *   - Read-path callers (future dashboard JOINs) MAY degrade to native-only.
   */
  getFxRate(base: CurrencyCode, quote: CurrencyCode, asOfDate: string): Promise<number | null>;
  getResolvedFxRate?(base: CurrencyCode, quote: CurrencyCode, asOfDate: string): Promise<ResolvedFxRate | null>;
  getFxTransferById(
    userId: string,
    fxTransferId: string,
  ): Promise<{ legs: CashLedgerEntry[]; reversed: boolean } | null>;
  getAccountAvailableBalance(userId: string, accountId: string, currency: CurrencyCode): Promise<number>;
  /**
   * KZO-166: deterministic cash-ledger projection for the wallet WAC walker.
   *
   * Returns entries in `(entry_date ASC, booked_at ASC, id ASC)` order. Both
   * the reversed entry and its REVERSAL counterpart are filtered out — they
   * still contribute to `balance_native` via getCashLedgerEntriesForBalances
   * (which sums them and ends at 0), but they are invisible to the WAC and
   * realized-FX state.
   */
  getCashLedgerEntriesForWalletReplay(userId: string): Promise<CashLedgerEntryForWalletReplay[]>;

  // Notifications (KZO-132)
  createNotification(notification: {
    userId: string;
    severity: "info" | "warning" | "error";
    source: string;
    sourceRef?: string;
    title: string;
    body?: string;
    detail?: unknown;
  }): Promise<string>;
  getNotificationsForUser(userId: string, opts: { page: number; limit: number }): Promise<{ notifications: NotificationDto[]; total: number }>;
  getUnreadCount(userId: string): Promise<number>;
  markNotificationRead(userId: string, notificationId: string): Promise<void>;
  markAllRead(userId: string): Promise<void>;
  dismissNotification(userId: string, notificationId: string): Promise<void>;
  markNotificationEscalated(userId: string, notificationId: string): Promise<void>;

  // Holding snapshots (KZO-115)
  bulkUpsertHoldingSnapshots(userId: string, snapshots: HoldingSnapshot[]): Promise<void>;
  deleteHoldingSnapshotsForTicker(
    userId: string,
    accountId: string,
    ticker: string,
    fromDate: string,
    marketCode?: MarketCode,
  ): Promise<number>;
  deleteAllHoldingSnapshots(userId: string): Promise<void>;
  getAggregatedSnapshots(userId: string, startDate: string, endDate: string): Promise<AggregatedSnapshotPoint[]>;
  /**
   * KZO-180: FX-aware variant of `getAggregatedSnapshots`. Translates each
   * contributing row's per-currency native columns (`value_native`,
   * `cost_basis_native`, `unrealized_pnl_native`) plus the legacy
   * `cumulative_realized_pnl` and `cumulative_dividends` columns into
   * `reportingCurrency` using the per-snapshot-date FX rate from
   * `market_data.fx_rates` (forward-fill via `date <= snapshot_date`).
   *
   * Self-pair shortcut: rows whose `currency = reportingCurrency` translate
   * with `fx = 1.0` (no DB JOIN, no NULL propagation). This is the **D8**
   * SQL guard — without it, every TWD-only row produces NULL aggregates and
   * silently degrades the entire production user base.
   *
   * Convention: translate-then-sum. `fxAvailable` per snapshot date is true
   * iff every contributing row's pair resolved (or self-pair). When false,
   * the translated cumulative/total fields are NULL.
   *
   * **v1 deviation from KZO-166 D4 / KZO-180 D4:** `cumulative_realized_pnl`
   * is translated at `snapshot_date` FX, not the original sale-date FX. The
   * denormalized cumulative column doesn't preserve per-trade sale dates;
   * strict adherence requires a JOIN-to-trades aggregation owned by KZO-176.
   * For TWD-only users (today's user base) this is exact. For mixed-currency
   * users it's an approximation until KZO-176.
   */
  getAggregatedSnapshotsInReportingCurrency(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
  ): Promise<AggregatedSnapshotPoint[]>;
  /**
   * Scoped FX-aware aggregate for report charts. Aggregates only the provided
   * `(accountId, ticker, marketCode)` snapshot contributors in one read so
   * single-market reports do not fan out into one query per holding.
   */
  getAggregatedSnapshotsInReportingCurrencyForScope(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
    pairs: readonly HoldingSnapshotScopePair[],
  ): Promise<AggregatedSnapshotPoint[]>;
  countHoldingSnapshotsAfterDate(
    userId: string,
    accountId: string,
    ticker: string,
    fromDate: string,
    marketCode?: MarketCode,
  ): Promise<number>;
  getLatestSnapshotDiagnostics(
    userId: string,
    pairs?: readonly HoldingSnapshotScopePair[],
  ): Promise<SnapshotScopeDiagnostics>;
  getLatestHoldingSnapshotDatesByScope(
    userId: string,
    pairs: readonly HoldingSnapshotLatestDateScopePair[],
  ): Promise<Map<string, string | null>>;
  getHoldingSnapshotsForTicker(userId: string, accountId: string, ticker: string, startDate: string, endDate: string): Promise<HoldingSnapshot[]>;
  listHoldingSnapshots(userId: string, options: ListHoldingSnapshotsOptions): Promise<ListHoldingSnapshotsResult>;
  listUnrealizedPnlAnalysisSnapshots(
    userId: string,
    options: UnrealizedPnlAnalysisSnapshotOptions,
  ): Promise<UnrealizedPnlAnalysisSnapshotRow[]>;
  saveMcpReplayPreview(record: McpReplayPreviewRecord): Promise<void>;
  getMcpReplayPreview(id: string): Promise<McpReplayPreviewRecord | null>;
  createMcpReplayRun(record: McpReplayRunRecord): Promise<void>;
  getMcpReplayRun(id: string): Promise<McpReplayRunRecord | null>;
  updateMcpReplayRunScope(input: {
    runId: string;
    accountId: string;
    ticker: string;
    marketCode: MarketCode;
    status: McpReplayRunScopeStatus;
    errorMessage?: string | null;
    replayedTradeCount?: number | null;
    snapshotGenerationRunId?: string | null;
    updatedAt?: string;
  }): Promise<void>;
  updateMcpReplayRunStatus(input: {
    runId: string;
    status: McpReplayRunStatus;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): Promise<void>;
  savePostedTransactionMutationPreview(record: PostedTransactionMutationPreviewRecord): Promise<void>;
  getPostedTransactionMutationPreview(id: string): Promise<PostedTransactionMutationPreviewRecord | null>;
  savePostedTransactionMutationRun(record: PostedTransactionMutationRunRecord): Promise<void>;
  getPostedTransactionMutationRun(id: string): Promise<PostedTransactionMutationRunRecord | null>;
  savePostedTransactionMutationDeletedDraftLineage(record: PostedTransactionMutationDeletedDraftLineageRecord): Promise<void>;
  listPostedTransactionMutationDeletedDraftLineage(
    ownerUserId: string,
    tradeEventIds: readonly string[],
    draftRowIds?: readonly string[],
  ): Promise<PostedTransactionMutationDeletedDraftLineageRecord[]>;

  // Currency wallet snapshots (KZO-165) — minimal aggregator stub. WAC + FX is KZO-166.
  /**
   * Bulk upsert currency wallet snapshot rows. PK is (account_id, currency, date).
   * Mirrors the unnest-arrays pattern used by `bulkUpsertHoldingSnapshots`.
   */
  bulkUpsertCurrencyWalletSnapshots(userId: string, snapshots: CurrencyWalletSnapshot[]): Promise<void>;
  /** Delete all wallet snapshots for a user. Called before a fresh aggregator run. */
  deleteAllCurrencyWalletSnapshots(userId: string): Promise<void>;
  /**
   * Forward-compatibility scaffolding for KZO-176's dashboard read path. The
   * KZO-165 scope explicitly adds this reader; its current callers are
   * integration tests plus the future dashboard rewrite.
   */
  getCurrencyWalletSnapshotsForAccount(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<CurrencyWalletSnapshot[]>;
  /**
   * Trimmed cash-ledger projection used by the wallet aggregator. Returns rows in
   * (accountId ASC, currency ASC, entryDate ASC) order so the running-balance
   * walker can stream without an extra sort.
   */
  getCashLedgerEntriesForBalances(userId: string): Promise<CashLedgerEntryForBalance[]>;
  getDailyBarsForTicker(ticker: string, startDate: string, endDate: string): Promise<DailyBar[]>;
  getDailyBarsForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
    startDate: string,
    endDate: string,
  ): Promise<DailyBar[]>;
  /**
   * Batched variant of getDailyBarsForTickerMarket: fetches bars for N
   * `(ticker, marketCode)` pairs in a single query. Returned map is keyed by
   * `${ticker}\0${marketCode}`; missing pairs yield an empty array.
   * Used by the full-generation path to avoid N+1 queries without mixing
   * cross-listed tickers.
   */
  getDailyBarsForTickerMarkets(
    pairs: readonly { ticker: string; marketCode: MarketCode }[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, DailyBar[]>>;
  /**
   * Legacy bare-ticker batch reader. Do not use for market-sensitive snapshot
   * generation because cross-listed tickers can share symbols.
   */
  getDailyBarsForTickers(tickers: string[], startDate: string, endDate: string): Promise<Map<string, DailyBar[]>>;
  listHoldingSnapshotRepairScopesForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<HoldingSnapshotRepairScope[]>;
  listHoldingSnapshotRepairTargets(
    options: HoldingSnapshotRepairTargetOptions,
  ): Promise<HoldingSnapshotRepairTarget[]>;
  /**
   * Fetch the inputs needed to generate holding snapshots — trade events and
   * posted dividend ledger entries pre-joined with their dividend events.
   * Avoids the broader cost of loadStore (which pulls accounts, lots, fee
   * policies, source lines, etc.).
   *
   * When `scope` is provided, results are filtered to that (accountId, ticker)
   * pair; dividends are filtered by ticker (not accountId) because the ticker
   * lives on the event, not the ledger entry.
   */
  getSnapshotGenerationInputs(userId: string, scope?: SnapshotGenerationScope): Promise<SnapshotGenerationInputs>;

  // Refresh batches (KZO-132)
  createRefreshBatch(userId: string | null, jobsTotal: number): Promise<string>;
  updateBatchTickerResult(
    batchId: string,
    ticker: string,
    result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ): Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null>;
  getRefreshBatch(batchId: string): Promise<{
    id: string;
    status: string;
    jobsTotal: number;
    jobsSucceeded: number;
    jobsFailed: number;
    tickerResults: Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>;
  } | null>;
  completeRefreshBatch(batchId: string, status: "completed" | "failed"): Promise<void>;

  // ── Admin portal methods (KZO-144) ──────────────────────────────────────────

  listUsers(options: AdminUserListOptions): Promise<AdminUserListResponse>;
  changeUserRole(userId: string, newRole: UserRole, auditInput: Omit<AuditLogInput, "action">): Promise<AuthUserRecord>;
  disableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  enableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  softDeleteUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  hardPurgeUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void>;
  hasActiveJobs(userId: string): Promise<boolean>;
  createAccount(input: CreateAccountInput): Promise<AccountMutationPersistenceResult>;
  updateAccount(input: UpdateAccountInput): Promise<AccountMutationPersistenceResult>;

  // ── ui-enhancement — Account lifecycle (soft-delete / restore / hard-purge) ──
  /**
   * Soft-delete an account: stamps `accounts.deleted_at = NOW()`. Idempotent
   * (returns the existing `deletedAt` ISO if already soft-deleted). Throws
   * `routeError(404, "account_not_found", ...)` when `(id, userId)` does not
   * resolve. Account-scoped data is preserved; only the row's `deleted_at`
   * column changes. Does NOT cancel pgboss jobs — daily-refresh etc. continue
   * to fire and become silent no-ops because read paths filter `deleted_at`.
   *
   * Audit-log row `action="account_soft_deleted"` with metadata snapshot
   * `{ accountName, accountType, defaultCurrency }` is inserted in the same
   * transaction.
   */
  softDeleteAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<AccountLifecyclePersistenceResult>;

  /**
   * Restore a soft-deleted account: clears `accounts.deleted_at`. If an
   * *active* account already owns the same name, auto-rename to
   * `"{originalName} (restored)"`. If that string ALSO collides, append
   * `" (restored 2)"`, `" (restored 3)"`, ... up to N=20 (then throw
   * `routeError(409, "account_restore_name_unresolvable", ...)`). The route
   * layer surfaces the final name in the response payload + SSE event.
   *
   * Throws `routeError(404, ...)` if account not found or not soft-deleted.
   * Audit: `"account_restored"` with metadata `{ priorName, finalName }`.
   */
  restoreAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<AccountLifecyclePersistenceResult>;

  /**
   * Hard-purge a single account: deletes the account row and all
   * account-scoped child data in dependency order. The user row is NOT
   * touched. Audit `"account_hard_purged"` is inserted BEFORE row deletion
   * (FK ON DELETE SET NULL on `audit_log.target_user_id` preserves the entry).
   *
   * Operates in a single transaction. Throws `routeError(404, ...)` if not
   * found OR if `mustBeSoftDeleted=true` (default) AND `deleted_at IS NULL`.
   *
   * The cron path uses `mustBeSoftDeleted=true`; the "Permanently delete now"
   * route uses `false` (soft-delete is applied inline by the route as a
   * one-step transition).
   */
  hardPurgeAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
    options?: { mustBeSoftDeleted?: boolean },
  ): Promise<AccountLifecyclePersistenceResult>;

  /**
   * List soft-deleted accounts for the given user, ordered by `deleted_at`
   * DESC. Returns `AccountDto`-shaped rows plus `deletedAt`. Used by the
   * "Recently deleted" UI section. Does NOT include hard-purged rows.
   */
  listSoftDeletedAccounts(
    userId: string,
  ): Promise<Array<import("@vakwen/shared-types").AccountDto & { deletedAt: string }>>;

  /**
   * Single-row helper that bypasses the `deleted_at IS NULL` filter. Used by
   * the "Permanently delete now" route to load an already-active account or
   * a soft-deleted one for typed-name confirmation. Returns `null` if not
   * found.
   */
  getAccountIncludingDeleted(
    accountId: string,
    userId: string,
  ): Promise<(import("@vakwen/shared-types").AccountDto & { deletedAt: string | null }) | null>;

  /**
   * Bulk hard-purge candidate selection for the daily cron. Returns rows
   * where `deleted_at < NOW() - INTERVAL '<graceDays> days'`. The worker
   * iterates and calls `hardPurgeAccount` in its own transaction per row.
   * Worker reads `graceDays` via `getEffectiveAccountHardPurgeDays()` so
   * admin overrides take effect on each tick (sweep-parameter-live per
   * `fastify-eviction-lifecycle-pattern.md`).
   */
  selectAccountsForHardPurge(
    graceDays: number,
  ): Promise<Array<{ accountId: string; userId: string }>>;

  countActiveAdmins(): Promise<number>;
  listInvites(options: AdminInviteListOptions): Promise<AdminInviteListResponse>;
  listAuditLog(options: AdminAuditLogListOptions): Promise<AdminAuditLogResponse>;

  // ── Provider health (KZO-177) ──────────────────────────────────────────────
  /**
   * Fetch one provider health status row. Returns null if the providerId is
   * unknown (i.e. not seeded by migration 046).
   */
  getProviderHealthStatus(providerId: string): Promise<ProviderHealthRow | null>;
  /** Fetch every provider health status row, ordered by providerId ASC. */
  getAllProviderHealthStatuses(): Promise<ProviderHealthRow[]>;
  /**
   * Update a provider health row in-place. Only the fields explicitly set in
   * `patch` are written; others are preserved. `updated_at` is bumped to NOW().
   */
  upsertProviderHealthStatus(patch: ProviderHealthUpsert): Promise<ProviderHealthRow>;
  /**
   * CAS-clear `last_down_notification_at` IFF the row's previously-recorded
   * value matches `expectedPreviousNotificationAt`. Returns true when the
   * worker won the CAS (and therefore SHOULD fire recovery notifications).
   * Used to ensure only one worker fires recovery notifications across
   * concurrent successes.
   */
  clearProviderDownNotificationCas(
    providerId: string,
    expectedPreviousNotificationAt: string,
  ): Promise<boolean>;
  /**
   * KZO-177 (P2 Fix 5) — atomic claim for the down-notification fan-out slot.
   * Returns true iff this caller wins the slot: only the winner should fire
   * the `provider_down` admin fan-out. Implemented as a conditional UPDATE
   * `WHERE last_down_notification_at IS NULL OR last_down_notification_at <
   * NOW() - <suppressionWindow>` so concurrent workers never double-fire
   * within the suppression window.
   */
  claimProviderDownNotificationSlot(
    providerId: string,
    suppressionWindowMs: number,
  ): Promise<boolean>;
  /** Insert a new error trail row. */
  insertProviderErrorTrailEntry(input: ProviderErrorTrailInput): Promise<ProviderErrorTrailRow>;
  /**
   * Fetch the most recent N error trail rows for the given providerId,
   * ordered occurredAt DESC.
   */
  getRecentProviderErrors(
    providerId: string,
    limit: number,
  ): Promise<ProviderErrorTrailRow[]>;
  /**
   * Count error trail rows for the providerId where `error_class != 'rate_limit'`
   * AND occurredAt within the last 24 hours.
   */
  computeErrorCount24h(providerId: string): Promise<number>;
  /** Count error trail rows where error_class != 'rate_limit' within the last 7 days. */
  computeErrorCount7d(providerId: string): Promise<number>;
  /** Count error trail rows where error_class = 'rate_limit' within the last 24 hours. */
  computeRateLimitCount24h(providerId: string): Promise<number>;
  listProviderErrorTrailPage(options: ListProviderErrorTrailOptions): Promise<ListProviderErrorTrailResult>;
  upsertProviderIncident(input: UpsertProviderIncidentInput): Promise<ProviderIncidentRecord>;
  listProviderIncidents(options: ListProviderIncidentsOptions): Promise<ListProviderIncidentsResult>;
  updateProviderIncidentStatus(input: UpdateProviderIncidentStatusInput): Promise<ProviderIncidentRecord>;
  upsertProviderUnresolvedItem(input: UpsertProviderUnresolvedItemInput): Promise<ProviderUnresolvedItemRecord>;
  listProviderUnresolvedItems(options: ListProviderUnresolvedItemsOptions): Promise<ListProviderUnresolvedItemsResult>;
  updateProviderUnresolvedItemState(input: UpdateProviderUnresolvedItemStateInput): Promise<ProviderUnresolvedItemRecord>;
  resolveProviderUnresolvedItems(input: ResolveProviderUnresolvedItemsInput): Promise<number>;
  autoResolveProviderUnresolvedItemsBySourceSymbol(input: AutoResolveProviderUnresolvedItemsBySourceSymbolInput): Promise<number>;
  /**
   * Delete error trail rows older than `olderThanDays` days. Memory backend
   * may behave as a no-op (returns 0). Returns the number of rows deleted.
   */
  pruneOldProviderErrorTrail(olderThanDays: number): Promise<number>;
  createProviderOperation(input: CreateProviderOperationInput): Promise<ProviderOperationRecord>;
  updateProviderOperation(input: UpdateProviderOperationInput): Promise<ProviderOperationRecord>;
  getProviderOperation(id: string): Promise<ProviderOperationRecord | null>;
  listProviderOperations(options: ListProviderOperationsOptions): Promise<ListProviderOperationsResult>;
  hasActiveProviderExecution(providerId: string, marketCode: MarketCode): Promise<boolean>;
  createProviderOperationLog(input: CreateProviderOperationLogInput): Promise<ProviderOperationLogRecord>;
  listProviderOperationLogs(options: ListProviderOperationLogsOptions): Promise<ListProviderOperationLogsResult>;
  listMarketCalendarSources(marketCode: MarketCode): Promise<MarketCalendarSourceConfigRecord[]>;
  saveMarketCalendarSource(input: SaveMarketCalendarSourceConfigInput): Promise<MarketCalendarSourceConfigRecord>;
  saveMarketCalendarPreview(preview: MarketCalendarPreviewRecord): Promise<MarketCalendarPreviewRecord>;
  getMarketCalendarPreview(previewToken: string): Promise<MarketCalendarPreviewRecord | null>;
  confirmMarketCalendarPreview(input: ConfirmMarketCalendarPreviewInput): Promise<MarketCalendarVersionRecord>;
  invalidateMarketCalendarVersion(input: InvalidateMarketCalendarVersionInput): Promise<MarketCalendarVersionRecord | null>;
  getActiveMarketCalendarVersion(marketCode: MarketCode, calendarYear: number): Promise<MarketCalendarVersionRecord | null>;
  listMarketCalendarHistory(marketCode: MarketCode, calendarYear?: number): Promise<MarketCalendarVersionRecord[]>;
  createMarketCalendarActivityEvent(input: CreateMarketCalendarActivityEventInput): Promise<MarketCalendarActivityEventRecord>;
  listMarketCalendarActivity(options: ListMarketCalendarActivityOptions): Promise<ListMarketCalendarActivityResult>;
  countProviderLogsForPurge(providerId: string): Promise<ProviderLogPurgeCounts>;
  purgeProviderLogs(providerId: string): Promise<ProviderLogPurgeCounts>;
  upsertProviderOperationOutcome(input: UpsertProviderOperationOutcomeInput): Promise<ProviderOperationOutcomeRecord>;
  listProviderOperationOutcomes(
    options: ListProviderOperationOutcomesOptions,
  ): Promise<ListProviderOperationOutcomesResult>;
  getLatestProviderOperationOutcome(
    options: LatestProviderOperationOutcomeOptions,
  ): Promise<ProviderOperationOutcomeRecord | null>;
  getProviderResolutionMapping(
    providerId: string,
    marketCode: MarketCode,
    sourceSymbol: string,
  ): Promise<ProviderResolutionMappingRecord | null>;
  upsertProviderResolutionMapping(
    input: UpsertProviderResolutionMappingInput,
  ): Promise<ProviderResolutionMappingRecord>;
  deleteProviderResolutionMapping(
    input: DeleteProviderResolutionMappingInput,
  ): Promise<ProviderResolutionMappingRecord | null>;
  listProviderResolutionMappings(
    options: ListProviderResolutionMappingsOptions,
  ): Promise<ListProviderResolutionMappingsResult>;
  /** Return user IDs of all active admins (role='admin', not deactivated/deleted). */
  listAdminUserIds(): Promise<string[]>;
}
