import { randomUUID } from "node:crypto";
import {
  allocateSellLots,
  applyBuyToLots,
  calculateDividendCashReconciliation,
  derivePortfolioCapabilities,
  resolveDividendStockEntitlement,
  roundToDecimal,
  type Lot,
} from "@vakwen/domain";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  currencyFor,
  marketCodeFor,
  normalizeInstrumentSector,
  type MarketCode as SharedMarketCode,
} from "@vakwen/shared-types";
import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountMarketDividendSettingsDto,
  AiConnectorAccessResult,
  AiConnectorProvider,
  DividendCalculationAmendRequestDto,
  DividendCalculationConfirmRequestDto,
  DividendCalculationDriftDto,
  DividendCalculationResetRequestDto,
  DividendCalculationVersionDto,
  DividendLedgerAggregates,
  DividendReviewFilterDto,
  DividendReviewPrimaryQueryDto,
  DividendReviewRowSummaryDto,
  DividendSourceLine,
  FeeProfileDto,
  InstrumentOptionDto,
  PortfolioCapabilitiesDto,
  PortfolioSelectionNormalizationResult,
  ShareCapability,
  TickerFundamentalsDto,
} from "@vakwen/shared-types";
import { defaultClientCapabilities, getMcpClientByLegacyProvider } from "../mcp/clientRegistry.js";
import { createDefaultFeeProfile, createStore, setStoreInstruments, syncInstruments } from "../services/store.js";
import { createDefaultInstruments, upsertInstrumentDefinitions } from "../services/instrumentRegistry.js";
import { createEmptyTickerFundamentals, normalizeTickerFundamentals } from "../services/fundamentals/types.js";
import {
  recomputeFeeConfigFingerprint,
  recomputeReferencedProfileIds,
} from "../services/recomputeFeeConfigFingerprint.js";
import { isRecomputeRunningLeaseExpired } from "../services/recomputeLifecycle.js";
import type {
  AccountingStore,
  BookedTradeEvent,
  CashLedgerEntry,
  DividendCalculationVersion,
  DividendEvent,
  InstrumentDef,
  LotAllocationProjection,
  MarketDataFacts,
  PositionAction,
  Store,
} from "../types/store.js";
import type {
  DailyBar,
  DailyBarWithMarket,
  InstrumentType,
  IntradayPriceOverlay,
  MarketCode,
} from "@vakwen/domain";
import type { FxRate } from "../services/market-data/types.js";
import {
  compareResearchIdentityHistoryPosition,
  researchIdentityHistoryPosition,
  researchIdentityRecordKey,
  researchIdentityRecordSortOrder,
  researchIdentityRevisionPrecedence,
  resolveResearchIdentityLatestState,
  type ResearchIdentityHistoryPageQuery,
  type ResearchIdentityRecord,
  type ResearchIdentityRecordQuery,
} from "../services/research/identity.js";
import {
  latestResearchPriceRecord,
  researchPriceRecordKey,
  researchPriceRecordSortOrder,
  validateResearchPriceRecord,
  type ResearchPriceRecord,
  type ResearchPriceRecordQuery,
} from "../services/research/price.js";
import type {
  AdminAuditLogResponse,
  AdminInviteListResponse,
  AdminUserListResponse,
  AdminUserStatus,
  InstrumentCatalogItemDto,
  InviteListStatus,
  MonitoredTickerDto,
  NotificationDto,
  ProfileDto,
} from "@vakwen/shared-types";
import { routeError } from "../lib/routeError.js";
import {
  buildShareAuditMetadata,
  buildShareGrantedNotification,
  buildShareRevokedNotification,
} from "./shareHelpers.js";
import { rebuildHoldingProjection } from "../services/accountingStore.js";
import { enrichDividendReviewRows } from "../services/dividendReviewDetails.js";
import type {
  AdminAuditLogListOptions,
  AdminInviteListOptions,
  AdminUserListOptions,
  AnonymousShareTokenRecord,
  AccountingStoreAuditOptions,
  AuditLogInput,
  AuthUserRecord,
  ConfirmAiTransactionDraftPostingInput,
  ConfirmAiTransactionDraftPostingResult,
  CreateAnonymousShareTokenInput,
  CreateAnonymousShareTokenResult,
  CreateShareCoupledInviteInput,
  CreateShareGrantInput,
  ConsumeInviteResult,
  CreateInviteInput,
  AccountWithLiveBalancesRecord,
  AccountLifecyclePersistenceResult,
  CashLedgerEnrichmentResult,
  CashLedgerListOptions,
  CashLedgerListResult,
  CatalogInstrument,
  CatalogSyncResult,
  DelistingRecord,
  DeleteTradeEventResult,
  DividendDestructivePreviewState,
  DividendDestructivePreviewRecord,
  DividendDestructivePreviewResult,
  DividendLedgerListOptions,
  DividendLedgerListResult,
  DividendCalendarSnapshotOptions,
  DividendDailyHighlightsSnapshotOptions,
  DividendReviewListOptions,
  DividendReviewListResult,
  DividendReviewMetadataResult,
  DividendReviewEnrichmentResult,
  DividendReviewPrimaryResult,
  DividendReviewRowWithDetails,
  InviteRecord,
  InviteStatus,
  OAuthClaims,
  Persistence,
  ReadinessStatus,
  ResolveOrCreateUserOptions,
  ResolveOrCreateUserResult,
  ReplayedPositionScopeInput,
  TransactionWriteContext,
  TradeEventPatch,
  UpdatePostedCashDividendInput,
  HoldingSnapshot,
  CurrencyWalletSnapshot,
  CashLedgerEntryForBalance,
  ListInboundSharesForGranteeResult,
  ListSharesForOwnerResult,
  MaterializePendingSharesInput,
  McpOAuthAuthorizationCodeRecord,
  McpOAuthAuthorizationRequestRecord,
  PendingShareInviteRecord,
  PersistedTickerFundamentalsRecord,
  RecordDividendDestructiveOutcomeInput,
  RevokeAnonymousShareTokenInput,
  RecordTickerFundamentalsRefreshFailureInput,
  SaveDividendDestructivePreviewInput,
  SaveTickerFundamentalsSnapshotInput,
  RevokeAnonymousShareTokenResult,
  ShareGrantRecord,
  AggregatedSnapshotPoint,
  ActivateAiConnectorConnectionReplacingProviderInput,
  AiConnectorAccessLogRecord,
  AiConnectorCredentialRecord,
  AiConnectorConnectionRecord,
  AiConnectorPolicySettingsRecord,
  AdminMarketDataBackfillTargetRow,
  AdminMarketDataPurgeCounts,
  AdminMarketDataPurgeInput,
  AiTransactionDraftBatchAggregate,
  ApproveMcpOAuthAuthorizationRequestInput,
  ApproveMcpOAuthAuthorizationRequestResult,
  AiTransactionDraftBatchRecord,
  AiTransactionDraftEventRecord,
  AiTransactionDraftRowRecord,
  AiTransactionDraftUnsupportedItemRecord,
  AppendAiConnectorAccessLogInput,
  AppendAiTransactionDraftEventInput,
  ConfirmMarketCalendarPreviewInput,
  CreateMarketCalendarActivityEventInput,
  CreateProviderOperationInput,
  CreateProviderOperationLogInput,
  DeleteProviderResolutionMappingInput,
  InvalidateMarketCalendarVersionInput,
  ListProviderErrorTrailOptions,
  ListProviderErrorTrailResult,
  ListProviderIncidentsOptions,
  ListProviderIncidentsResult,
  ListProviderOperationLogsOptions,
  ListProviderOperationLogsResult,
  ListProviderOperationOutcomesOptions,
  ListProviderOperationOutcomesResult,
  LatestProviderOperationOutcomeOptions,
  ListProviderOperationsOptions,
  ListProviderOperationsResult,
  ListProviderResolutionMappingsOptions,
  ListProviderResolutionMappingsResult,
  ListProviderUnresolvedItemsOptions,
  ListProviderUnresolvedItemsResult,
  ListMarketCalendarActivityOptions,
  ListMarketCalendarActivityResult,
  MarketCalendarActivityResult,
  MarketCalendarActivitySourceKind,
  MarketCalendarActivityEventRecord,
  MarketCalendarPreviewRecord,
  MarketCalendarSourceConfigRecord,
  MarketCalendarVersionRecord,
  ProviderErrorTrailInput,
  ProviderErrorTrailRow,
  ProviderHealthRow,
  ProviderHealthUpsert,
  ProviderIncidentRecord,
  ProviderLogPurgeCounts,
  ProviderOperationLogRecord,
  ProviderOperationLogLevel,
  ProviderOperationOutcomeRecord,
  ProviderOperationOutcomeState,
  ProviderOperationRecord,
  ProviderResolutionMappingRecord,
  ProviderUnresolvedItemRecord,
  ResolveProviderUnresolvedItemsInput,
  SaveAiConnectorCredentialInput,
  SaveAiConnectorConnectionInput,
  SaveAiConnectorPolicySettingsInput,
  SaveMarketCalendarSourceConfigInput,
  SaveMcpOAuthAuthorizationCodeInput,
  SaveMcpOAuthAuthorizationRequestInput,
  SaveAiTransactionDraftBatchInput,
  SaveAiTransactionDraftRowInput,
  SaveAiTransactionDraftUnsupportedItemInput,
  SetPendingShareInviteCapabilitiesInput,
  SetShareCapabilitiesInput,
  UpdateProviderIncidentStatusInput,
  UpdateProviderOperationInput,
  UpdateProviderUnresolvedItemStateInput,
  UpsertProviderOperationOutcomeInput,
  UpsertProviderIncidentInput,
  UpsertProviderUnresolvedItemInput,
  UpsertProviderResolutionMappingInput,
  ResolvedFxRate,
  UserRole,
} from "./types.js";
// KZO-199: anonymous-share token cap and retention are now resolver-backed
// (DB override → env-fallback). Read at method invocation time so admin
// PATCHes take effect on the next call without restart.
import {
  getEffectiveAnonymousShareTokenCap,
  getEffectiveAnonymousShareTokenRetentionMs,
} from "../services/appConfig/sharing.js";
import type { DividendLedgerRecomputeChange } from "../services/dividends.js";
import {
  providerIncidentInputFromErrorTrail,
  providerUnresolvedItemInputFromErrorTrail,
} from "../services/market-data/providerErrorNormalization.js";

interface MemoryNotification {
  id: string;
  userId: string;
  severity: "info" | "warning" | "error";
  source: string;
  sourceRef: string | null;
  title: string;
  body: string | null;
  detail: unknown;
  readAt: string | null;
  escalatedAt: string | null;
  dismissedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function buildLiveBalancesByAccount(store: Store): Map<string, Array<{ currency: string; amount: number }>> {
  const reversedIds = new Set<string>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (entry.reversalOfCashLedgerEntryId) {
      reversedIds.add(entry.reversalOfCashLedgerEntryId);
    }
  }

  const balances = new Map<string, Map<string, number>>();
  for (const entry of store.accounting.facts.cashLedgerEntries) {
    if (entry.reversalOfCashLedgerEntryId) continue;
    if (reversedIds.has(entry.id)) continue;
    const currencyMap = balances.get(entry.accountId) ?? new Map<string, number>();
    currencyMap.set(entry.currency, (currencyMap.get(entry.currency) ?? 0) + entry.amount);
    balances.set(entry.accountId, currencyMap);
  }

  const result = new Map<string, Array<{ currency: string; amount: number }>>();
  for (const [accountId, currencyMap] of balances.entries()) {
    result.set(
      accountId,
      [...currencyMap.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([currency, amount]) => ({ currency, amount: roundToDecimal(amount, 2) })),
    );
  }
  return result;
}

interface MemoryInstrument {
  ticker: string;
  name: string | null;
  instrumentType: string | null;
  marketCode: string;
  typeRaw?: string | null;
  industryCategoryRaw?: string | null;
  catalogExchangeRaw?: string | null;
  catalogMicCode?: string | null;
  barsBackfillStatus: string;
  supportState?: "supported" | "retired_by_admin" | "unsupported_by_provider";
  lastRepairAt?: string | null;
  delistedAt?: string;
  /** KZO-196 — GICS industry-group label (AU only); null on non-AU and pre-sync rows. */
  gicsIndustryGroup?: string | null;
}

function memoryInstrumentToDef(instrument: MemoryInstrument): InstrumentDef {
  return {
    ticker: instrument.ticker,
    name: instrument.name,
    type: instrument.instrumentType as InstrumentType | null,
    marketCode: instrument.marketCode as MarketCode,
    typeRaw: instrument.typeRaw ?? null,
    industryCategoryRaw: instrument.industryCategoryRaw ?? null,
    lastSyncedAt: null,
  };
}

type MemoryDailyBar = DailyBar & { marketCode: MarketCode };
type SeedDailyBar = Omit<DailyBar, "quality"> & { quality?: DailyBar["quality"]; marketCode?: MarketCode };

interface MemoryTickerFundamentalsRecord {
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

interface MemoryPersistenceOptions {
  seedCatalog?: boolean;
  seedDevBypassUser?: boolean;
}

interface MemoryInvite {
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

interface MemoryShare {
  id: string;
  ownerUserId: string;
  granteeUserId: string;
  revokedByUserId: string | null;
  createdAt: string;
  revokedAt: string | null;
}

interface MemoryCapabilityGrant {
  capability: ShareCapability;
  grantedByUserId: string | null;
  grantedAt: string;
}

interface MemoryAnonymousShareToken {
  id: string;
  token: string;
  ownerUserId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  revokedByUserId: string | null;
}

interface MemoryAuditLogEntry {
  id: string;
  actorUserId: string | null;
  action: AuditLogInput["action"];
  targetUserId: string | null;
  metadata: Record<string, unknown>;
  ipAddress: string | null;
  createdAt: string;
}

const INVITE_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const INVITE_CODE_LENGTH = 8;
const PENDING_SHARE_INVITE_LIMIT = 10;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function generateInviteCode(): string {
  let code = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i += 1) {
    const index = Math.floor(Math.random() * INVITE_CODE_ALPHABET.length);
    code += INVITE_CODE_ALPHABET[index]!;
  }
  return code;
}

function mapMemoryUser(user: MemoryUser): AuthUserRecord {
  return {
    userId: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    sessionVersion: user.sessionVersion,
    isDemo: user.isDemo ?? false,
    deactivatedAt: user.deactivatedAt ?? null,
    deletedAt: user.deletedAt ?? null,
  };
}

function toFeeProfileDto(profile: import("@vakwen/domain").FeeProfile): FeeProfileDto {
  return {
    id: profile.id,
    accountId: profile.accountId,
    name: profile.name,
    boardCommissionRate: profile.boardCommissionRate,
    commissionDiscountPercent: profile.commissionDiscountPercent,
    minimumCommissionAmount: profile.minimumCommissionAmount,
    commissionCurrency: profile.commissionCurrency,
    commissionRoundingMode: profile.commissionRoundingMode,
    taxRoundingMode: profile.taxRoundingMode,
    stockSellTaxRateBps: profile.stockSellTaxRateBps,
    stockDayTradeTaxRateBps: profile.stockDayTradeTaxRateBps,
    etfSellTaxRateBps: profile.etfSellTaxRateBps,
    bondEtfSellTaxRateBps: profile.bondEtfSellTaxRateBps,
    commissionChargeMode: profile.commissionChargeMode,
  };
}

function deriveCapabilitiesDto(
  accounts: ReadonlyArray<Pick<AccountDto, "defaultCurrency">>,
): PortfolioCapabilitiesDto {
  const capabilities = derivePortfolioCapabilities(accounts);
  return {
    configuredMarkets: capabilities.configuredMarkets as PortfolioCapabilitiesDto["configuredMarkets"],
    configuredCurrencies: capabilities.configuredCurrencies as PortfolioCapabilitiesDto["configuredCurrencies"],
  };
}

function getStoredReportingCurrencyPreference(
  prefs: Record<string, unknown>,
): AccountDefaultCurrency | null {
  const value = prefs.reportingCurrency;
  return typeof value === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(value)
    ? value as AccountDefaultCurrency
    : null;
}

function buildReportingCurrencyNormalization(
  configuredCurrencies: readonly AccountDefaultCurrency[],
  requested: AccountDefaultCurrency | null,
): PortfolioSelectionNormalizationResult<AccountDefaultCurrency> {
  if (configuredCurrencies.length === 0) {
    return { requested, effective: null, reason: "no_configured_currencies" };
  }
  if (requested === null) {
    return { requested: null, effective: configuredCurrencies[0]!, reason: null };
  }
  if (configuredCurrencies.includes(requested)) {
    return { requested, effective: requested, reason: null };
  }
  return {
    requested,
    effective: configuredCurrencies[0]!,
    reason: "unconfigured_currency",
  };
}

function buildLifecyclePersistenceResult(
  account: AccountDto,
  deletedAt: string | null,
  finalName: string | null,
  capabilities: PortfolioCapabilitiesDto,
  prefs: Record<string, unknown>,
  feeConfig?: {
    feeProfiles: FeeProfileDto[];
    feeProfileBindings: import("@vakwen/shared-types").FeeProfileBindingDto[];
  },
): AccountLifecyclePersistenceResult {
  return {
    account,
    deletedAt,
    finalName,
    capabilities,
    reportingCurrency: buildReportingCurrencyNormalization(
      capabilities.configuredCurrencies,
      getStoredReportingCurrencyPreference(prefs),
    ),
    ...feeConfig,
  };
}

const DEFAULT_MEMORY_CATALOG: MemoryInstrument[] = [
  { ticker: "2330", name: "台積電", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "2317", name: "鴻海", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" },
  { ticker: "0050", name: "元大台灣50", instrumentType: "ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "00679B", name: "元大美債20年", instrumentType: "BOND_ETF", marketCode: "TW", barsBackfillStatus: "pending" },
  { ticker: "020000", name: "富邦臺灣加權ETN", instrumentType: null, marketCode: "TW", barsBackfillStatus: "pending" },
];

interface MemoryUser {
  id: string;
  email: string;
  displayName: string | null;
  providerSubject: string;
  providerDisplayName: string | null;
  providerPictureUrl: string | null;
  role: UserRole;
  sessionVersion: number;
  createdAt: string;
  deactivatedAt?: string | null;
  deletedAt?: string | null;
  isDemo?: boolean;
  demoExpiresAt?: Date;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** KZO-169: composite key for the memory instrument catalog (mirrors the
 *  Postgres PK shape on `market_data.instruments`). */
function instrumentCatalogKey(ticker: string, marketCode: string): string {
  return `${ticker}|${marketCode}`;
}

function tickerFundamentalsKey(ticker: string, marketCode: MarketCode): string {
  return `${ticker}|${marketCode}`;
}

function providerUnresolvedItemKey(
  providerId: string,
  marketCode: MarketCode,
  errorCode: string,
  sourceSymbol: string,
): string {
  return `${providerId}:${marketCode}:${errorCode}:${sourceSymbol.toUpperCase()}`;
}

function providerIncidentKey(providerId: string, incidentKey: string): string {
  return `${providerId}:${incidentKey}`;
}

function providerOperationOutcomeKey(operationId: string, action: string, sourceSymbol: string): string {
  return `${operationId}:${action}:${sourceSymbol.toUpperCase()}`;
}

function isMarketCalendarActivityMarket(marketCode: MarketCode): marketCode is "TW" | "US" | "AU" | "JP" | "KR" {
  return marketCode === "TW" || marketCode === "US" || marketCode === "AU" || marketCode === "KR" || marketCode === "JP";
}

function providerOperationLogLevelToActivityResult(level: ProviderOperationLogLevel): MarketCalendarActivityResult {
  if (level === "error") return "error";
  if (level === "warning") return "warning";
  return "success";
}

function providerIdToActivitySourceKind(providerId: string): MarketCalendarActivitySourceKind {
  if (providerId.includes("yahoo")) return "yahoo_chart";
  if (providerId.includes("finmind")) return "finmind";
  if (providerId.includes("twse")) return "twse_close";
  return "provider";
}

function summarizeProviderOperationOutcomes(rows: ProviderOperationOutcomeRecord[]): ListProviderOperationOutcomesResult["summary"] {
  const counts: Record<ProviderOperationOutcomeState, number> = {
    pending: 0,
    running: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    rate_limited: 0,
    cancelled: 0,
  };
  for (const row of rows) counts[row.state] += 1;
  const processed = counts.succeeded + counts.failed + counts.skipped + counts.rate_limited + counts.cancelled;
  const total = rows.length;
  const result =
    total === 0
      ? "none"
      : counts.running > 0 || counts.pending > 0
        ? "running"
        : counts.rate_limited > 0
          ? "rate_limited"
          : counts.failed > 0
            ? counts.succeeded > 0 ? "partial" : "failed"
            : counts.succeeded > 0 && (counts.skipped > 0 || counts.cancelled > 0)
              ? "partial"
              : counts.succeeded > 0
                ? "all_succeeded"
                : processed > 0
                  ? "none_applied"
                  : "none";
  return {
    total,
    processed,
    pending: counts.pending,
    running: counts.running,
    succeeded: counts.succeeded,
    failed: counts.failed,
    skipped: counts.skipped,
    rateLimited: counts.rate_limited,
    cancelled: counts.cancelled,
    progressPercent: total > 0 ? Math.round((processed / total) * 100) : 0,
    result,
  };
}

function mapMemoryTickerFundamentals(
  row: MemoryTickerFundamentalsRecord,
): PersistedTickerFundamentalsRecord {
  return {
    ticker: row.ticker,
    marketCode: row.marketCode,
    providerId: row.providerId,
    fundamentals: normalizeTickerFundamentals(row.fundamentals),
    refreshedAt: row.refreshedAt,
    nextRefreshAt: row.nextRefreshAt,
    lastAttemptedAt: row.lastAttemptedAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function stockDividendLotIdsForScope(
  store: Store,
  accountId: string,
  ticker: string,
  marketCode: MarketCode,
): string[] {
  return store.accounting.facts.positionActions
    .filter((action) =>
      action.accountId === accountId
      && action.ticker === ticker
      && action.marketCode === marketCode
      && action.actionType === "STOCK_DIVIDEND",
    )
    .flatMap((action) => [
      `lot-pa-${action.id}`,
      ...(action.relatedDividendLedgerEntryId ? [`lot-${action.relatedDividendLedgerEntryId}`] : []),
    ]);
}

export class MemoryPersistence implements Persistence {
  private readonly researchIdentityRecords = new Map<string, ResearchIdentityRecord>();
  private readonly researchPriceRecords = new Map<string, ResearchPriceRecord>();
  private readonly stores = new Map<string, Store>();
  private readonly idempotencyKeys = new Map<string, Set<string>>();
  private readonly dailyBars: MemoryDailyBar[] = [];
  private readonly researchDividendEvents: DividendEvent[] = [];
  private readonly intradayOverlays = new Map<string, IntradayPriceOverlay>();
  private readonly tickerFundamentals = new Map<string, MemoryTickerFundamentalsRecord>();
  /** email → MemoryUser (identity resolution index) */
  private readonly usersByEmail = new Map<string, MemoryUser>();
  /**
   * KZO-169: per-user manual monitoring selections keyed by composite
   * `${ticker}|${marketCode}` (mirrors `user_monitored_tickers` PK shape after
   * migration 044). Inner value carries the structured tuple so callers don't
   * have to re-parse the key.
   */
  private readonly monitoredTickers = new Map<
    string,
    Map<string, { ticker: string; marketCode: string; addedAt: string }>
  >();
  /** userId → NotificationDto[] (in-memory notification store for E2E) */
  private readonly notifications = new Map<string, MemoryNotification[]>();
  /**
   * `${ticker}|${marketCode}` → MemoryInstrument. KZO-169 widened the key to
   * the composite (ticker, market_code) tuple to mirror migration 044's PK
   * shape — the memory backend now supports two BHP rows on different markets,
   * which is required by the E2E disambiguation spec for KZO-169.
   */
  private readonly instruments = new Map<string, MemoryInstrument>();
  /** userId → composite catalog map (mirrors `instruments` per user). */
  private readonly instrumentsByUser = new Map<string, Map<string, MemoryInstrument>>();
  /** Holding snapshots (KZO-115) */
  private readonly holdingSnapshots: HoldingSnapshot[] = [];
  /** KZO-165: currency wallet snapshots (cash balance per account+currency+date). */
  private readonly currencyWalletSnapshots: CurrencyWalletSnapshot[] = [];
  /** KZO-164: in-memory FX rates keyed by `${date}:${baseCurrency}:${quoteCurrency}`. */
  private readonly fxRates = new Map<string, FxRate>();
  private readonly invites = new Map<string, MemoryInvite>();
  private readonly portfolioShares: MemoryShare[] = [];
  private readonly portfolioShareCapabilities = new Map<string, MemoryCapabilityGrant[]>();
  private readonly pendingShareInviteCapabilities = new Map<string, MemoryCapabilityGrant[]>();
  private readonly aiConnectorConnections = new Map<string, AiConnectorConnectionRecord>();
  private readonly mcpOAuthAuthorizationRequests = new Map<string, McpOAuthAuthorizationRequestRecord>();
  private readonly mcpOAuthAuthorizationCodes = new Map<string, McpOAuthAuthorizationCodeRecord>();
  private readonly aiConnectorCredentials = new Map<string, AiConnectorCredentialRecord>();
  private readonly aiConnectorAccessLogs: AiConnectorAccessLogRecord[] = [];
  private aiConnectorPolicySettings: AiConnectorPolicySettingsRecord = {
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    postedTransactionMutationBatchLimit: 50,
    allowedProviders: { chatgpt: true, self_hosted: true },
    allowedClientKinds: {
      chatgpt_app: true,
      claude_ai_connector: true,
      claude_code: true,
      codex_cli: true,
      gemini_cli: true,
      copilot_mcp: true,
      generic_mcp: true,
    },
    groupToggles: { read: true, research: false, drafts: true, write: false },
    bearerFallback: {
      enabled: false,
      allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
      maxLifetimeDays: 30,
      maxActiveConnectorsPerUser: 3,
      allowedToolGroups: ["read"],
    },
    inactivityExpiryDays: 90,
    expirationWarningDays: 7,
    freshAuthMaxAgeMs: 600_000,
    maxConnectorLifetimeDays: 90,
    oauthPublicIssuer: null,
    oauthRedirectUriAllowlist: [],
    oauthTokenSecretSet: false,
    updatedAt: new Date(0).toISOString(),
  };
  private readonly aiTransactionDraftBatches = new Map<string, AiTransactionDraftBatchRecord>();
  private readonly aiTransactionDraftRows = new Map<string, AiTransactionDraftRowRecord[]>();
  private readonly aiTransactionDraftUnsupportedItems = new Map<string, AiTransactionDraftUnsupportedItemRecord[]>();
  private readonly aiTransactionDraftEvents = new Map<string, AiTransactionDraftEventRecord[]>();
  private readonly anonymousShareTokens: MemoryAnonymousShareToken[] = [];
  /** Per-owner async mutex — ensures cap-check + insert is atomic for concurrent callers. */
  private readonly anonymousShareTokenLocks = new Map<string, Promise<unknown>>();
  /** Per-account async mutex for destructive dividend confirmation. */
  private readonly dividendDestructiveLocks = new Map<string, Promise<void>>();
  /** Per-owner async mutex for full-store transaction writes. */
  private readonly transactionWriteLocks = new Map<string, Promise<void>>();
  private readonly accountAccountingRevisions = new Map<string, number>();
  private readonly dividendDestructivePreviews = new Map<string, DividendDestructivePreviewRecord>();
  private readonly dividendDestructiveOutcomes = new Map<string, {
    consumedAt: string;
    consumedResult: Exclude<DividendDestructivePreviewResult, "previewed">;
  }>();
  private readonly auditLog: MemoryAuditLogEntry[] = [];
  /** App config: repair cooldown override (KZO-133). null = unset, fall back to Env. */
  private _repairCooldownMinutes: number | null = null;
  /** App config: admin override for dashboard performance ranges (KZO-159 / 158A).
   *  null = unset, callers fall back to the hardcoded DEFAULT list. */
  private _dashboardPerformanceRanges: string[] | null = null;
  /** App config: AU metadata enrichment mode override (KZO-189).
   *  null = unset, callers fall back to Env.METADATA_ENRICHMENT_MODE. */
  private _metadataEnrichmentMode: "unconditional" | "conditional" | null = null;
  /** App config: route DTO cache policy preset override. */
  private _routeCachePolicyMode: import("./types.js").RouteCachePolicyMode | null = null;
  /** KZO-198: Tier 0 encrypted secrets — stored as `nonce_b64:ct+tag_b64`.
   *  null = unset, callers (resolvers) fall back to env. */
  private _finmindApiTokenEncrypted: string | null = null;
  private _twelveDataApiKeyEncrypted: string | null = null;
  private _eodhdApiKeyEncrypted: string | null = null;
  private _mcpOauthTokenSecretEncrypted: string | null = null;
  /** KZO-198: Tier 1/2 plain overrides — keyed by AppConfigPlainField. */
  private _appConfigPlain: Partial<Record<import("./types.js").AppConfigPlainField, import("./types.js").AppConfigPlainValue>> = {};
  private readonly quoteFallbackPolicies = new Map<string, import("./types.js").QuoteFallbackPolicyRecord>();
  private readonly quoteFallbackSnapshots = new Map<string, import("./types.js").QuoteFallbackSnapshotRecord>();
  private readonly eodhdCallBudgetUsage = new Map<string, number>();
  /** KZO-196: AU GICS sync cron override. null = use Env.ASX_GICS_REFRESH_CRON. */
  private _asxGicsRefreshCron: string | null = null;
  /** KZO-199: Tier 2 SQL-only override for anonymous-share retention window.
   *  null = use Env.ANONYMOUS_SHARE_TOKEN_RETENTION_MS. Memory backend exposes
   *  no public setter; tests can mutate via `_anonymousShareTokenRetentionMs`
   *  directly if needed. */
  _anonymousShareTokenRetentionMs: number | null = null;
  /** KZO-199: Tier 2 SQL-only override for PATCH /user-preferences body cap.
   *  null = use Env.USER_PREFERENCES_MAX_BYTES. */
  _userPreferencesMaxBytes: number | null = null;
  /** KZO-142: timestamp of the last app_config write (ISO 8601). Stamped at
   *  construction so a fresh MemoryPersistence always has a non-null value. */
  private _appConfigUpdatedAt: string = new Date().toISOString();
  /** KZO-159 / 158A: per-user preferences keyed by user id. Lazy — absent key
   *  == empty preferences. Top-level merge semantics mirror the Postgres
   *  `||` / `- key[]` update shape (see design D3). */
  private readonly userPreferences = new Map<string, Record<string, unknown>>();
  private readonly accountMarketDividendSettings = new Map<string, AccountMarketDividendSettingsDto>();
  /** KZO-177: provider health rows keyed by providerId. Pre-seeded in `init()`. */
  private readonly providerHealth = new Map<string, ProviderHealthRow>();
  /** KZO-177: provider error trail rows; auto-incrementing id stamped at insert. */
  private readonly providerErrorTrail: ProviderErrorTrailRow[] = [];
  private _providerErrorTrailNextId = 1;
  private readonly providerIncidents = new Map<string, ProviderIncidentRecord>();
  private readonly providerUnresolvedItems = new Map<string, ProviderUnresolvedItemRecord>();
  private readonly providerOperations = new Map<string, ProviderOperationRecord>();
  private readonly providerOperationLogs: ProviderOperationLogRecord[] = [];
  private readonly mcpReplayPreviews = new Map<string, import("./types.js").McpReplayPreviewRecord>();
  private readonly mcpReplayRuns = new Map<string, import("./types.js").McpReplayRunRecord>();
  private readonly postedTransactionMutationPreviews = new Map<string, import("./types.js").PostedTransactionMutationPreviewRecord>();
  private readonly postedTransactionMutationRuns = new Map<string, import("./types.js").PostedTransactionMutationRunRecord>();
  private readonly postedTransactionMutationDeletedDraftLineage = new Map<string, import("./types.js").PostedTransactionMutationDeletedDraftLineageRecord>();
  private readonly marketCalendarSources = new Map<string, MarketCalendarSourceConfigRecord>();
  private readonly marketCalendarPreviews = new Map<string, MarketCalendarPreviewRecord>();
  private readonly marketCalendarVersions = new Map<string, MarketCalendarVersionRecord>();
  private readonly marketCalendarActivityEvents: MarketCalendarActivityEventRecord[] = [];
  private _providerOperationLogNextId = 1;
  private readonly providerOperationOutcomes = new Map<string, ProviderOperationOutcomeRecord>();
  private readonly providerResolutionMappings = new Map<string, ProviderResolutionMappingRecord>();
  /**
   * KZO-177 (M2): per-provider promise-chain mutex for the recovery CAS.
   * MemoryPersistence is single-threaded but JS microtasks interleave; without
   * this, two concurrent `recordOutcome({kind:"success"})` calls on a `down`
   * row could both observe `lastDownNotificationAt !== null` and both win the
   * CAS. The Postgres backend gets atomicity from the conditional UPDATE row
   * count; this mutex matches that semantics in memory.
   */
  private readonly _providerCasLocks = new Map<string, Promise<void>>();
  /**
   * ui-enhancement — soft-deleted account shadow store, keyed by
   * `${userId}:${accountId}`. The active `store.accounts` array (in `stores`)
   * filters these out; the shadow stores the original AccountDto + `deletedAt`
   * ISO so restore can roundtrip the row back into the active set.
   */
  private readonly softDeletedAccounts = new Map<
    string,
    import("@vakwen/shared-types").AccountDto & { deletedAt: string }
  >();

  constructor(private readonly options: MemoryPersistenceOptions = {}) {}

  async appendResearchIdentityRecords(records: ResearchIdentityRecord[]): Promise<void> {
    for (const record of records) {
      const key = researchIdentityRecordKey(record);
      if (!this.researchIdentityRecords.has(key)) {
        this.researchIdentityRecords.set(key, structuredClone(record));
      }
    }
  }

  async listResearchIdentityRecords(query: ResearchIdentityRecordQuery): Promise<ResearchIdentityRecord[]> {
    return [...this.researchIdentityRecords.values()]
      .filter((record) => {
        const subjectMatches = query.subject.kind === "listing_id"
          ? record.listing.id === query.subject.listingId
          : query.subject.kind === "security_id"
            ? record.security.id === query.subject.securityId
            : query.subject.kind === "ticker_venue"
              ? record.listing.ticker === query.subject.ticker
                && record.listing.venue === query.subject.venue
              : record.listing.venue === query.subject.venue;
        const effectiveAt = record.observations[0]?.effectiveAt;
        return subjectMatches
          && effectiveAt !== undefined
          && effectiveAt <= query.effectiveAt
          && record.provenance.retrievedAt <= query.knowledgeAt;
      })
      .sort(researchIdentityRecordSortOrder)
      .map((record) => structuredClone(record));
  }

  async listLatestResearchIdentityRecords(query: ResearchIdentityRecordQuery): Promise<ResearchIdentityRecord[]> {
    const revisions = await this.listResearchIdentityLatestRevisions(query);
    const recordsByListing = new Map<string, ResearchIdentityRecord[]>();
    for (const record of revisions) {
      const records = recordsByListing.get(record.listing.id) ?? [];
      records.push(record);
      recordsByListing.set(record.listing.id, records);
    }
    return [...recordsByListing.values()]
      .map((records) => resolveResearchIdentityLatestState(records)!)
      .sort(researchIdentityRecordSortOrder)
      .map((record) => structuredClone(record));
  }

  async listResearchIdentityLatestRevisions(
    query: ResearchIdentityRecordQuery,
  ): Promise<ResearchIdentityRecord[]> {
    const tickerSubject = query.subject.kind === "ticker_venue" ? query.subject : null;
    const candidateListingIds = tickerSubject
      ? new Set([...this.researchIdentityRecords.values()]
          .filter((record) => {
            const effectiveAt = record.observations[0]?.effectiveAt;
            return record.listing.ticker === tickerSubject.ticker
              && record.listing.venue === tickerSubject.venue
              && effectiveAt !== undefined
              && effectiveAt <= query.effectiveAt
              && record.provenance.retrievedAt <= query.knowledgeAt;
          })
          .map((record) => record.listing.id))
      : null;
    const recordsByListing = new Map<string, ResearchIdentityRecord[]>();
    for (const record of this.researchIdentityRecords.values()) {
      const subjectMatches = query.subject.kind === "listing_id"
        ? record.listing.id === query.subject.listingId
        : query.subject.kind === "security_id"
          ? record.security.id === query.subject.securityId
          : query.subject.kind === "ticker_venue"
            ? candidateListingIds!.has(record.listing.id)
            : record.listing.venue === query.subject.venue;
      const effectiveAt = record.observations[0]?.effectiveAt;
      if (
        !subjectMatches
        || effectiveAt === undefined
        || effectiveAt > query.effectiveAt
        || record.provenance.retrievedAt > query.knowledgeAt
      ) continue;
      const records = recordsByListing.get(record.listing.id) ?? [];
      records.push(record);
      recordsByListing.set(record.listing.id, records);
    }
    return [...recordsByListing.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .flatMap(([, records]) => {
        const latestByPrecedence = new Map<number, ResearchIdentityRecord>();
        for (const record of [...records].sort(researchIdentityRecordSortOrder)) {
          latestByPrecedence.set(
            researchIdentityRevisionPrecedence(record),
            record,
          );
        }
        return [...latestByPrecedence.entries()]
          .sort(([left], [right]) => right - left)
          .map(([, record]) => structuredClone(record));
      });
  }

  async listResearchIdentityHistoryPage(
    query: ResearchIdentityHistoryPageQuery,
  ): Promise<ResearchIdentityRecord[]> {
    return [...this.researchIdentityRecords.values()]
      .filter((record) => {
        const effectiveAt = record.observations[0]?.effectiveAt;
        return record.listing.id === query.subject.listingId
          && effectiveAt !== undefined
          && effectiveAt <= query.effectiveAt
          && record.provenance.retrievedAt <= query.knowledgeAt
          && (query.after === undefined
            || compareResearchIdentityHistoryPosition(
              researchIdentityHistoryPosition(record),
              query.after,
            ) > 0);
      })
      .sort(researchIdentityRecordSortOrder)
      .slice(0, query.limit)
      .map((record) => structuredClone(record));
  }

  async appendResearchPriceRecords(records: ResearchPriceRecord[]): Promise<void> {
    for (const record of records) {
      validateResearchPriceRecord(record);
    }
    for (const record of records) {
      const key = researchPriceRecordKey(record);
      if (!this.researchPriceRecords.has(key)) {
        this.researchPriceRecords.set(key, structuredClone(record));
      }
    }
  }

  async listResearchPriceRecords(query: ResearchPriceRecordQuery): Promise<ResearchPriceRecord[]> {
    return [...this.researchPriceRecords.values()]
      .filter((record) => {
        const subjectMatches = query.subject.kind === "listing_id"
          ? record.listingId === query.subject.listingId
          : record.venue === query.subject.venue;
        return subjectMatches
          && record.sessionDate >= query.startDate
          && record.sessionDate <= query.endDate
          && record.provenance.retrievedAt <= query.knowledgeAt;
      })
      .sort(researchPriceRecordSortOrder)
      .map((record) => structuredClone(record));
  }

  async listLatestResearchPriceRecords(query: {
    subject: { kind: "listing_id"; listingId: string };
    startDate: string;
    endDate: string;
    knowledgeAt: string;
  }): Promise<ResearchPriceRecord[]> {
    const grouped = new Map<string, ResearchPriceRecord[]>();
    for (const record of await this.listResearchPriceRecords(query)) {
      const current = grouped.get(record.sessionDate) ?? [];
      current.push(record);
      grouped.set(record.sessionDate, current);
    }
    return [...grouped.values()]
      .map((records) => latestResearchPriceRecord(records))
      .filter((record): record is ResearchPriceRecord => record !== undefined)
      .sort(researchPriceRecordSortOrder)
      .map((record) => structuredClone(record));
  }

  async getDistinctResearchPriceSessionDates(
    venue: import("../services/research/identity.js").ResearchListingVenue,
    fromDate: string,
    knowledgeAt: string,
  ): Promise<string[]> {
    const dates = new Set<string>();
    for (const record of this.researchPriceRecords.values()) {
      if (record.venue !== venue) continue;
      if (record.sessionDate < fromDate) continue;
      if (record.provenance.retrievedAt > knowledgeAt) continue;
      dates.add(record.sessionDate);
    }
    return [...dates].sort((left, right) => left.localeCompare(right));
  }

  async init(): Promise<void> {
    // KZO-177: pre-seed the canonical providers, mirroring migration 046's
    // seed insert. The aggregator assumes every providerId exists when the
    // workers start logging outcomes.
    // KZO-200: `twelve-data-au` added (migration 048) — separate from
    // `yahoo-finance-au` because it owns the AU catalog path (KZO-194) on a
    // distinct cadence + budget.
    if (this.providerHealth.size === 0) {
      const now = new Date().toISOString();
      for (const providerId of [
        "finmind-tw",
        "finmind-us",
        "yahoo-finance-au",
        "twelve-data-au",
        "yahoo-finance-kr",
        "twelve-data-kr",
        "yahoo-finance-jp",
        "twelve-data-jp",
        "frankfurter",
        // KZO-196 — ASX GICS catalog provider seed row.
        "asx-gics-csv",
      ]) {
        this.providerHealth.set(providerId, {
          providerId,
          status: "down",
          lastSuccessfulRun: null,
          lastFailedRun: null,
          lastErrorMessage: null,
          lastDownNotificationAt: null,
          lastManualRerunAt: null,
          updatedAt: now,
        });
      }
    }
    if (this.options.seedCatalog === true && this.instruments.size === 0) {
      this._replaceInstruments(DEFAULT_MEMORY_CATALOG);
    }
    if (this.options.seedDevBypassUser === true && this.usersByEmail.size === 0) {
      this.usersByEmail.set("user-1@placeholder.local", {
        id: "user-1",
        email: "user-1@placeholder.local",
        displayName: "Dev User",
        providerSubject: "dev-bypass",
        providerDisplayName: "Dev User",
        providerPictureUrl: null,
        role: "admin",
        sessionVersion: 1,
        createdAt: new Date().toISOString(),
      });
    }
  }

  async close(): Promise<void> {}

  async resolveOrCreateUser(
    provider: string,
    providerSubject: string,
    claims: OAuthClaims,
    options: ResolveOrCreateUserOptions = {},
  ): Promise<ResolveOrCreateUserResult> {
    const normalizedEmail = normalizeEmail(claims.email);
    const existing = this.usersByEmail.get(normalizedEmail);
    const targetRole = options.role;
    const targetSessionVersion = options.sessionVersion;

    if (existing) {
      // Subsequent login: update mutable fields, never touch email
      existing.displayName = claims.name ?? existing.displayName;
      existing.providerSubject = providerSubject;
      existing.providerDisplayName = claims.name ?? existing.providerDisplayName;
      existing.providerPictureUrl = claims.picture ?? existing.providerPictureUrl;
      if (targetRole) {
        existing.role = targetRole;
      }
      if (targetSessionVersion) {
        existing.sessionVersion = targetSessionVersion;
      }
      // Sync displayName to already-cached store settings so callers see the updated name.
      if (claims.name) {
        const cachedStore = this.stores.get(existing.id);
        if (cachedStore) cachedStore.settings.displayName = claims.name;
      }
      return {
        userId: existing.id,
        role: existing.role,
        sessionVersion: existing.sessionVersion,
      };
    }

    // New user: generate UUID, seed all fields
    const userId = randomUUID();
    this.usersByEmail.set(normalizedEmail, {
      id: userId,
      email: normalizedEmail,
      displayName: claims.name ?? null,
      providerSubject,
      providerDisplayName: claims.name ?? null,
      providerPictureUrl: claims.picture ?? null,
      role: targetRole ?? "member",
      sessionVersion: targetSessionVersion ?? 1,
      createdAt: new Date().toISOString(),
    });

    // Ensure default portfolio data for the new user
    await this.ensureDefaultPortfolioData(userId);

    return {
      userId,
      role: targetRole ?? "member",
      sessionVersion: targetSessionVersion ?? 1,
    };
  }

  async ensureDefaultPortfolioData(userId: string): Promise<void> {
    // Ensure user identity exists (matches postgres behavior: INSERT ... ON CONFLICT DO NOTHING)
    const existingUser = this.getUserById(userId);
    if (!existingUser) {
      const email = normalizeEmail(`${userId}@placeholder.local`);
      if (!this.usersByEmail.has(email)) {
        this.usersByEmail.set(email, {
          id: userId,
          email,
          displayName: null,
          providerSubject: userId,
          providerDisplayName: null,
          providerPictureUrl: null,
          role: "member",
          sessionVersion: 1,
          createdAt: new Date().toISOString(),
        });
      }
    }
    // In memory persistence, loadStore already creates default data (fee profile, account, etc.)
    await this.loadStore(userId);
  }

  async getAuthUserById(userId: string): Promise<AuthUserRecord | null> {
    const user = this.getUserById(userId);
    return user ? mapMemoryUser(user) : null;
  }

  async getAuthUserByEmail(email: string): Promise<AuthUserRecord | null> {
    const user = this.usersByEmail.get(normalizeEmail(email));
    return user ? mapMemoryUser(user) : null;
  }

  async ensureDevBypassUser(): Promise<void> {
    const existing = this.getUserById("user-1");
    if (existing?.deactivatedAt || existing?.deletedAt || existing) {
      return;
    }

    this.usersByEmail.set("user-1@placeholder.local", {
      id: "user-1",
      email: "user-1@placeholder.local",
      displayName: "Dev User",
      providerSubject: "dev-bypass",
      providerDisplayName: "Dev User",
      providerPictureUrl: null,
      role: "admin",
      sessionVersion: 1,
      createdAt: new Date().toISOString(),
    });
    await this.ensureDefaultPortfolioData("user-1");
  }

  async promoteUserToAdminByEmail(
    email: string,
    action: AuditLogInput["action"],
    metadata: Record<string, unknown> = {},
  ): Promise<AuthUserRecord | null> {
    const user = this.usersByEmail.get(normalizeEmail(email));
    if (!user || user.deactivatedAt || user.deletedAt) {
      return null;
    }
    user.role = "admin";
    await this.appendAuditLog({
      action,
      targetUserId: user.id,
      metadata: { email: user.email, targetEmail: user.email, ...metadata },
    });
    return mapMemoryUser(user);
  }

  async appendAuditLog(input: AuditLogInput): Promise<void> {
    this.auditLog.push({
      id: randomUUID(),
      actorUserId: input.actorUserId ?? null,
      action: input.action,
      targetUserId: input.targetUserId ?? null,
      metadata: input.metadata ?? {},
      ipAddress: input.ipAddress ?? null,
      createdAt: new Date().toISOString(),
    });
  }

  async saveDividendDestructivePreview(input: SaveDividendDestructivePreviewInput): Promise<void> {
    const now = Date.now();
    for (const [previewId, preview] of this.dividendDestructivePreviews) {
      if (Date.parse(preview.expiresAt) <= now) {
        this.dividendDestructivePreviews.set(previewId, {
          ...preview,
          affectedDividends: [],
          manualReceiptReentryLedgerEntryIds: [],
          reviewedArtifacts: {
            source: {
              tradeEventIds: [],
              positionActionIds: [],
              lotAllocationIds: [],
              lotAllocationTradeEventIds: [],
            },
            derived: {
              dividendEventIds: [],
              dividendLedgerEntryIds: [],
              cashLedgerEntryIds: [],
              dividendDeductionEntryIds: [],
              dividendSourceLineIds: [],
              stockDividendPositionActionIds: [],
              holdingSnapshotIds: [],
            },
          },
        });
      }
    }
    this.dividendDestructivePreviews.set(input.record.previewId, structuredClone(input.record));
    await this.appendAuditLog({
      actorUserId: input.record.actorUserId,
      action: "dividend_destructive_preview_created",
      targetUserId: input.record.ownerUserId,
      ipAddress: input.ipAddress ?? null,
      metadata: {
        previewId: input.record.previewId,
        previewVersion: input.record.previewVersion,
        operationKind: input.record.operationKind,
        operationKey: input.record.operationKey,
        ownerUserId: input.record.ownerUserId,
        actorUserId: input.record.actorUserId,
        accountId: input.record.accountId,
        targetTradeEventId: input.record.targetTradeEventId ?? null,
        cutoffDate: input.record.cutoffDate ?? null,
        reason: input.record.reason,
        affectedCounts: input.record.affectedCounts,
        result: "previewed",
      },
    });
  }

  async getDividendDestructivePreview(previewId: string): Promise<DividendDestructivePreviewState | null> {
    const stored = this.dividendDestructivePreviews.get(previewId);
    if (!stored) return null;
    let preview = stored;
    if (Date.parse(stored.expiresAt) <= Date.now() && stored.affectedDividends.length > 0) {
      preview = {
        ...stored,
        affectedDividends: [],
        manualReceiptReentryLedgerEntryIds: [],
        reviewedArtifacts: {
          source: { tradeEventIds: [], positionActionIds: [], lotAllocationIds: [], lotAllocationTradeEventIds: [] },
          derived: {
            dividendEventIds: [],
            dividendLedgerEntryIds: [],
            cashLedgerEntryIds: [],
            dividendDeductionEntryIds: [],
            dividendSourceLineIds: [],
            stockDividendPositionActionIds: [],
            holdingSnapshotIds: [],
          },
        },
      };
      this.dividendDestructivePreviews.set(previewId, preview);
    }
    const outcome = this.dividendDestructiveOutcomes.get(previewId);
    return {
      ...structuredClone(preview),
      consumedAt: outcome?.consumedAt ?? null,
      consumedResult: outcome?.consumedResult ?? null,
    };
  }

  async countDividendDestructivePreviews(ownerUserId: string, operationKey: string): Promise<number> {
    return [...this.dividendDestructivePreviews.values()].filter((preview) =>
      preview.ownerUserId === ownerUserId && preview.operationKey === operationKey).length;
  }

  async recordDividendDestructiveOutcome(input: RecordDividendDestructiveOutcomeInput): Promise<void> {
    this.dividendDestructiveOutcomes.set(input.previewId, {
      consumedAt: input.completedAt,
      consumedResult: input.result,
    });
    const preview = this.dividendDestructivePreviews.get(input.previewId);
    if (preview) {
      this.dividendDestructivePreviews.set(input.previewId, {
        ...preview,
        affectedDividends: [],
        manualReceiptReentryLedgerEntryIds: [],
        reviewedArtifacts: {
          source: { tradeEventIds: [], positionActionIds: [], lotAllocationIds: [], lotAllocationTradeEventIds: [] },
          derived: {
            dividendEventIds: [],
            dividendLedgerEntryIds: [],
            cashLedgerEntryIds: [],
            dividendDeductionEntryIds: [],
            dividendSourceLineIds: [],
            stockDividendPositionActionIds: [],
            holdingSnapshotIds: [],
          },
        },
      });
    }
    await this.appendAuditLog({
      actorUserId: input.actorUserId ?? null,
      action: input.result === "confirmed" ? "dividend_destructive_confirmed" : "dividend_destructive_failed",
      targetUserId: input.ownerUserId,
      ipAddress: input.ipAddress ?? null,
      metadata: {
        previewId: input.previewId,
        previewVersion: input.previewVersion,
        operationKind: input.operationKind,
        operationKey: input.operationKey,
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId ?? null,
        accountId: input.accountId,
        targetTradeEventId: input.targetTradeEventId ?? null,
        cutoffDate: input.cutoffDate ?? null,
        reason: input.reason,
        result: input.result,
        affectedCounts: input.affectedCounts,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        startedAt: input.startedAt,
        completedAt: input.completedAt,
      },
    });
  }

  async withDividendDestructiveLock<T>(ownerUserId: string, accountId: string, execute: () => Promise<T>): Promise<T> {
    const key = `${ownerUserId}:${accountId}`;
    const previous = this.dividendDestructiveLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.dividendDestructiveLocks.set(key, queued);
    await previous;
    try {
      return await execute();
    } finally {
      release();
      if (this.dividendDestructiveLocks.get(key) === queued) {
        this.dividendDestructiveLocks.delete(key);
      }
    }
  }

  async withTransactionWriteLock<T>(
    ownerUserId: string,
    execute: (writer: TransactionWriteContext) => Promise<T>,
  ): Promise<T> {
    const key = ownerUserId;
    const previous = this.transactionWriteLocks.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queued = previous.then(() => current);
    this.transactionWriteLocks.set(key, queued);
    await previous;
    const previousStore = this.stores.has(ownerUserId)
      ? structuredClone(this.stores.get(ownerUserId)!)
      : undefined;
    const previousInstruments = this.instrumentsByUser.has(ownerUserId)
      ? structuredClone(this.instrumentsByUser.get(ownerUserId)!)
      : undefined;
    const revisionPrefix = `${ownerUserId}:`;
    const previousRevisions = new Map(
      [...this.accountAccountingRevisions.entries()].filter(([revisionKey]) => revisionKey.startsWith(revisionPrefix)),
    );
    try {
      return await execute({
        loadStore: async (userId) => {
          if (userId !== ownerUserId) throw new Error("transaction writer owner mismatch");
          return this.loadStore(userId);
        },
        getInstrument: (ticker, marketCode) => this.getInstrument(ticker, marketCode),
        upsertInstruments: async (userId, instruments) => {
          if (userId !== ownerUserId) throw new Error("transaction writer owner mismatch");
          await this.upsertInstruments(userId, instruments);
        },
        savePostedTrade: async (userId, accounting, tradeEventId) => {
          if (userId !== ownerUserId) throw new Error("transaction writer owner mismatch");
          await this.savePostedTrade(userId, accounting, tradeEventId);
        },
        savePostedDividend: async (userId, accounting, marketData, dividendLedgerEntryId) => {
          if (userId !== ownerUserId) throw new Error("transaction writer owner mismatch");
          await this.savePostedDividend(userId, accounting, marketData, dividendLedgerEntryId);
        },
        updatePostedCashDividend: async (userId, input) => {
          if (userId !== ownerUserId) throw new Error("transaction writer owner mismatch");
          return this.updatePostedCashDividend(userId, input);
        },
        saveReplayedPositionScope: async (userId, accounting, input) => {
          if (userId !== ownerUserId) throw new Error("transaction writer owner mismatch");
          return this.saveReplayedPositionScope(userId, accounting, input);
        },
      });
    } catch (error) {
      if (previousStore) this.stores.set(ownerUserId, previousStore);
      else this.stores.delete(ownerUserId);
      if (previousInstruments) this.instrumentsByUser.set(ownerUserId, previousInstruments);
      else this.instrumentsByUser.delete(ownerUserId);
      for (const revisionKey of [...this.accountAccountingRevisions.keys()]) {
        if (revisionKey.startsWith(revisionPrefix)) this.accountAccountingRevisions.delete(revisionKey);
      }
      for (const [revisionKey, revision] of previousRevisions) {
        this.accountAccountingRevisions.set(revisionKey, revision);
      }
      throw error;
    } finally {
      release();
      if (this.transactionWriteLocks.get(key) === queued) {
        this.transactionWriteLocks.delete(key);
      }
    }
  }

  async bumpSessionVersion(userId: string): Promise<number> {
    const user = this.getUserById(userId);
    if (!user) {
      throw routeError(404, "not_found", "User not found");
    }
    user.sessionVersion += 1;
    return user.sessionVersion;
  }

  async createInvite(input: CreateInviteInput): Promise<InviteRecord> {
    return this.insertInvite(input);
  }

  async insertBootstrapInvite(input: CreateInviteInput): Promise<InviteRecord> {
    return this.insertInvite(input);
  }

  async revokeInvite(code: string): Promise<void> {
    const invite = this.invites.get(code);
    if (!invite || invite.revokedAt) return;
    invite.revokedAt = new Date().toISOString();
  }

  async getInviteStatus(code: string): Promise<InviteStatus> {
    const invite = this.invites.get(code);
    if (!invite) return "invalid";
    if (invite.revokedAt) return "revoked";
    if (invite.usedAt) return "used";
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return "expired";
    return "valid";
  }

  async getInviteRecord(code: string): Promise<InviteRecord | null> {
    const invite = this.invites.get(code);
    return invite ? { ...invite } : null;
  }

  async consumeInvite(code: string, email: string): Promise<ConsumeInviteResult> {
    const invite = this.invites.get(code);
    const normalizedEmail = normalizeEmail(email);
    if (!invite) return { status: "invalid" };
    if (invite.revokedAt) return { status: "revoked" };
    if (invite.usedAt) return { status: "used" };
    if (new Date(invite.expiresAt).getTime() <= Date.now()) return { status: "expired" };
    if (invite.email !== normalizedEmail) return { status: "email_mismatch" };
    invite.usedAt = new Date().toISOString();
    return { status: "consumed", invite: { ...invite } };
  }

  async createShareGrant(input: CreateShareGrantInput): Promise<ShareGrantRecord> {
    const owner = this.getUserById(input.ownerUserId);
    const grantee = this.getUserById(input.granteeUserId);
    if (!owner || !grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const existing = this.portfolioShares.find(
      (share) =>
        share.ownerUserId === input.ownerUserId &&
        share.granteeUserId === input.granteeUserId &&
        share.revokedAt === null,
    );

    if (existing) {
      return toShareGrantRecord(existing, owner, grantee);
    }

    const share: MemoryShare = {
      id: randomUUID(),
      ownerUserId: input.ownerUserId,
      granteeUserId: input.granteeUserId,
      revokedByUserId: null,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    this.portfolioShares.push(share);

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_granted",
      targetUserId: input.granteeUserId,
      metadata: {
        ...buildShareAuditMetadata(share.id, owner, grantee),
        ...(input.auditInput.metadata ?? {}),
      },
    });
    const granteeLocale = this.stores.get(grantee.id)?.settings.locale ?? "en";
    await this.createNotification(
      buildShareGrantedNotification(share.id, owner, grantee.id, granteeLocale),
    );

    return toShareGrantRecord(share, owner, grantee);
  }

  async revokeShareGrant(
    shareId: string,
    input: {
      ownerUserId: string;
      revokedByUserId: string;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<{ granteeUserId: string } | null> {
    const share = this.portfolioShares.find((candidate) => candidate.id === shareId);
    if (!share || share.ownerUserId !== input.ownerUserId) {
      throw routeError(404, "share_not_found", "Share not found");
    }
    if (share.revokedAt !== null) {
      return null;
    }

    const owner = this.getUserById(share.ownerUserId);
    const grantee = this.getUserById(share.granteeUserId);
    if (!owner || !grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    share.revokedAt = new Date().toISOString();
    share.revokedByUserId = input.revokedByUserId;

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_revoked",
      targetUserId: share.granteeUserId,
      metadata: {
        ...buildShareAuditMetadata(share.id, owner, grantee),
        ...(input.auditInput.metadata ?? {}),
      },
    });
    const granteeLocale = this.stores.get(share.granteeUserId)?.settings.locale ?? "en";
    await this.createNotification(
      buildShareRevokedNotification(share.id, owner, grantee.id, granteeLocale),
    );
    return { granteeUserId: share.granteeUserId };
  }

  async createShareCoupledInvite(input: CreateShareCoupledInviteInput): Promise<PendingShareInviteRecord> {
    const normalizedEmail = normalizeEmail(input.email);
    const owner = this.getUserById(input.ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const existing = [...this.invites.values()]
      .filter(
        (invite) =>
          invite.email === normalizedEmail &&
          invite.usedAt === null &&
          invite.revokedAt === null &&
          new Date(invite.expiresAt).getTime() > Date.now() &&
          (invite.shareOwnerUserId === null || invite.shareOwnerUserId === input.ownerUserId),
      )
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];

    if (existing) {
      existing.shareOwnerUserId = input.ownerUserId;
      return toPendingShareInviteRecord(existing, owner);
    }

    // Rate limit only applies when a new invite row is about to be inserted —
    // dedup updates existing rows in place and does not contribute to growth.
    const activePending = await this.countActivePendingShareInvites(input.ownerUserId);
    if (activePending >= PENDING_SHARE_INVITE_LIMIT) {
      throw routeError(429, "share_invite_rate_limited", "share invite rate limited");
    }

    const invite = await this.insertInvite({
      email: normalizedEmail,
      role: "viewer",
      expiresAt: input.expiresAt,
      issuedByUserId: input.issuedByUserId,
    });
    const stored = this.invites.get(invite.code);
    if (!stored) {
      throw new Error("Expected invite to exist after insert");
    }
    stored.shareOwnerUserId = input.ownerUserId;
    return toPendingShareInviteRecord(stored, owner);
  }

  async countActivePendingShareInvites(ownerUserId: string): Promise<number> {
    return [...this.invites.values()].filter(
      (invite) =>
        invite.shareOwnerUserId === ownerUserId &&
        invite.usedAt === null &&
        invite.revokedAt === null &&
        new Date(invite.expiresAt).getTime() > Date.now(),
    ).length;
  }

  async listSharesForOwner(ownerUserId: string): Promise<ListSharesForOwnerResult> {
    const owner = this.getUserById(ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const active: ShareGrantRecord[] = [];
    const revokedShares: ShareGrantRecord[] = [];
    for (const share of this.portfolioShares.filter((candidate) => candidate.ownerUserId === ownerUserId)) {
      const grantee = this.getUserById(share.granteeUserId);
      if (!grantee) {
        continue;
      }
      const record = toShareGrantRecord(share, owner, grantee);
      if (share.revokedAt) {
        revokedShares.push(record);
      } else {
        active.push(record);
      }
    }

    const pending: PendingShareInviteRecord[] = [];
    const expired: PendingShareInviteRecord[] = [];
    const revokedInvites: PendingShareInviteRecord[] = [];
    for (const invite of [...this.invites.values()].filter((candidate) => candidate.shareOwnerUserId === ownerUserId)) {
      const record = toPendingShareInviteRecord(invite, owner);
      if (invite.revokedAt) {
        revokedInvites.push(record);
      } else if (invite.usedAt) {
        continue;
      } else if (new Date(invite.expiresAt).getTime() <= Date.now()) {
        expired.push(record);
      } else {
        pending.push(record);
      }
    }

    return {
      active: active.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      pending: pending.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      expired: expired.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revoked: [...revokedShares, ...revokedInvites].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async listInboundSharesForGrantee(granteeUserId: string): Promise<ListInboundSharesForGranteeResult> {
    const grantee = this.getUserById(granteeUserId);
    if (!grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const active: ShareGrantRecord[] = [];
    const revoked: ShareGrantRecord[] = [];
    for (const share of this.portfolioShares.filter((candidate) => candidate.granteeUserId === granteeUserId)) {
      const owner = this.getUserById(share.ownerUserId);
      if (!owner) {
        continue;
      }
      const record = toShareGrantRecord(share, owner, grantee);
      if (share.revokedAt) {
        revoked.push(record);
      } else {
        active.push(record);
      }
    }

    return {
      active: active.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      revoked: revoked.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    };
  }

  async validateActiveShare(ownerUserId: string, granteeUserId: string): Promise<boolean> {
    return this.portfolioShares.some(
      (candidate) =>
        candidate.ownerUserId === ownerUserId &&
        candidate.granteeUserId === granteeUserId &&
        candidate.revokedAt === null,
    );
  }

  async revokePendingShareInvite(
    code: string,
    ownerUserId: string,
    auditInput: Omit<AuditLogInput, "action" | "targetUserId">,
  ): Promise<void> {
    const invite = this.invites.get(code);
    if (!invite || invite.shareOwnerUserId !== ownerUserId) {
      throw routeError(404, "share_pending_not_found", "Pending share invite not found");
    }
    if (invite.usedAt !== null) {
      throw routeError(409, "share_pending_already_used", "Pending share invite already used");
    }
    if (invite.revokedAt !== null) {
      return;
    }

    const owner = this.getUserById(ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    invite.revokedAt = new Date().toISOString();

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_invite_revoked",
      metadata: {
        inviteCode: code,
        targetEmail: invite.email,
        shareCoupled: true,
        shareOwnerEmail: owner.email,
        shareOwnerDisplayName: owner.displayName,
        ...(auditInput.metadata ?? {}),
      },
    });
  }

  async materializePendingSharesForEmail(input: MaterializePendingSharesInput): Promise<ShareGrantRecord[]> {
    const normalizedEmail = normalizeEmail(input.email);
    const grantee = this.getUserById(input.userId);
    if (!grantee) {
      throw routeError(404, "user_not_found", "User not found");
    }

    const matches = [...this.invites.values()].filter(
      (invite) =>
        invite.email === normalizedEmail &&
        invite.shareOwnerUserId !== null &&
        invite.usedAt === null &&
        invite.revokedAt === null &&
        new Date(invite.expiresAt).getTime() > Date.now(),
    );

    const materialized: ShareGrantRecord[] = [];
    for (const invite of matches) {
      invite.usedAt = new Date().toISOString();
      // Owner was hard-purged (FK set to NULL). Invite is marked used above so
      // subsequent logins don't retry materialization for this orphan record.
      if (!invite.shareOwnerUserId) {
        continue;
      }
      const owner = this.getUserById(invite.shareOwnerUserId);
      if (!owner) {
        continue;
      }
      const existing = this.portfolioShares.find(
        (share) =>
          share.ownerUserId === owner.id &&
          share.granteeUserId === input.userId &&
          share.revokedAt === null,
      );
      if (existing) {
        continue;
      }

      const share: MemoryShare = {
        id: randomUUID(),
        ownerUserId: owner.id,
        granteeUserId: input.userId,
        revokedByUserId: null,
        createdAt: new Date().toISOString(),
        revokedAt: null,
      };
      this.portfolioShares.push(share);
      this.portfolioShareCapabilities.set(
        share.id,
        this.cloneCapabilityGrants(this.pendingShareInviteCapabilities.get(invite.code) ?? []),
      );

      await this.appendAuditLog({
        ...input.auditInput,
        action: "share_granted",
        targetUserId: input.userId,
        metadata: buildShareAuditMetadata(share.id, owner, grantee),
      });
      const granteeLocale = this.stores.get(input.userId)?.settings.locale ?? "en";
      await this.createNotification(
        buildShareGrantedNotification(share.id, owner, input.userId, granteeLocale),
      );

      materialized.push(toShareGrantRecord(share, owner, grantee));
    }

    return materialized;
  }

  async getShareCapabilities(shareId: string): Promise<ShareCapability[]> {
    return this.listCapabilityValues(this.portfolioShareCapabilities.get(shareId) ?? []);
  }

  async setShareCapabilities(input: SetShareCapabilitiesInput): Promise<ShareCapability[]> {
    this.assertShareExists(input.shareId);
    const grants = this.buildCapabilityGrants(input.capabilities, input.grantedByUserId);
    this.portfolioShareCapabilities.set(input.shareId, grants);
    return this.listCapabilityValues(grants);
  }

  async getPendingShareInviteCapabilities(inviteCode: string): Promise<ShareCapability[]> {
    return this.listCapabilityValues(this.pendingShareInviteCapabilities.get(inviteCode) ?? []);
  }

  async setPendingShareInviteCapabilities(input: SetPendingShareInviteCapabilitiesInput): Promise<ShareCapability[]> {
    if (!this.invites.has(input.inviteCode)) {
      throw routeError(404, "share_pending_not_found", "Pending share invite not found");
    }
    const grants = this.buildCapabilityGrants(input.capabilities, input.grantedByUserId);
    this.pendingShareInviteCapabilities.set(input.inviteCode, grants);
    return this.listCapabilityValues(grants);
  }

  async saveAiConnectorConnection(input: SaveAiConnectorConnectionInput): Promise<AiConnectorConnectionRecord> {
    this.assertUserExists(input.userId);
    if (input.revokedByUserId) this.assertUserExists(input.revokedByUserId);
    const now = new Date().toISOString();
    const legacyClient = getMcpClientByLegacyProvider(input.provider);
    const clientKind = input.clientKind ?? legacyClient.clientKind;
    const record: AiConnectorConnectionRecord = {
      id: input.id,
      userId: input.userId,
      provider: input.provider,
      vendor: input.vendor ?? legacyClient.vendor,
      clientKind,
      authMode: input.authMode ?? legacyClient.defaultAuthMode,
      capabilities: [...new Set(input.capabilities ?? defaultClientCapabilities(clientKind))].sort(),
      displayName: input.displayName,
      status: input.status,
      oauthClientId: input.oauthClientId ?? null,
      oauthSubject: input.oauthSubject ?? null,
      scopes: [...new Set(input.scopes)].sort(),
      toolToggles: this.normalizeToolToggles(input.toolToggles ?? {}),
      expiresAt: input.expiresAt ?? null,
      expiryNotifiedAt: input.expiryNotifiedAt ?? null,
      lastUsedAt: input.lastUsedAt ?? null,
      hiddenAt: input.hiddenAt ?? null,
      revokedAt: input.revokedAt ?? null,
      revokedByUserId: input.revokedByUserId ?? null,
      revocationReason: input.revocationReason ?? null,
      createdAt: input.createdAt ?? this.aiConnectorConnections.get(input.id)?.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    this.aiConnectorConnections.set(record.id, record);
    return { ...record, capabilities: [...record.capabilities], scopes: [...record.scopes], toolToggles: { ...record.toolToggles } };
  }

  async getAiConnectorConnection(id: string): Promise<AiConnectorConnectionRecord | null> {
    const record = this.aiConnectorConnections.get(id);
    return record ? { ...record, capabilities: [...record.capabilities], scopes: [...record.scopes], toolToggles: { ...record.toolToggles } } : null;
  }

  async listAiConnectorConnectionsForUser(userId: string): Promise<AiConnectorConnectionRecord[]> {
    return [...this.aiConnectorConnections.values()]
      .filter((record) => record.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((record) => ({ ...record, capabilities: [...record.capabilities], scopes: [...record.scopes], toolToggles: { ...record.toolToggles } }));
  }

  async getAiConnectorPolicySettings(): Promise<AiConnectorPolicySettingsRecord> {
    return {
      ...this.aiConnectorPolicySettings,
      allowedProviders: { ...this.aiConnectorPolicySettings.allowedProviders },
      allowedClientKinds: { ...this.aiConnectorPolicySettings.allowedClientKinds },
      groupToggles: { ...this.aiConnectorPolicySettings.groupToggles },
      bearerFallback: {
        ...this.aiConnectorPolicySettings.bearerFallback,
        allowedClientKinds: [...this.aiConnectorPolicySettings.bearerFallback.allowedClientKinds],
        allowedToolGroups: [...this.aiConnectorPolicySettings.bearerFallback.allowedToolGroups],
      },
      oauthRedirectUriAllowlist: [...this.aiConnectorPolicySettings.oauthRedirectUriAllowlist],
      oauthTokenSecretSet: this._mcpOauthTokenSecretEncrypted !== null,
    };
  }

  async saveAiConnectorPolicySettings(input: SaveAiConnectorPolicySettingsInput): Promise<AiConnectorPolicySettingsRecord> {
    const allowedProviders = {
      ...this.aiConnectorPolicySettings.allowedProviders,
      ...(input.allowedProviders ?? {}),
    };
    this.aiConnectorPolicySettings = {
      ...this.aiConnectorPolicySettings,
      ...input,
      oauthTokenSecretSet: this._mcpOauthTokenSecretEncrypted !== null,
      allowedProviders,
      allowedClientKinds: {
        ...this.aiConnectorPolicySettings.allowedClientKinds,
        ...(input.allowedProviders?.chatgpt === undefined ? {} : { chatgpt_app: input.allowedProviders.chatgpt }),
        ...(input.allowedProviders?.chatgpt === undefined ? {} : { claude_ai_connector: input.allowedProviders.chatgpt }),
        ...(input.allowedProviders?.self_hosted === undefined
          ? {}
          : {
              claude_code: input.allowedProviders.self_hosted,
              codex_cli: input.allowedProviders.self_hosted,
              gemini_cli: input.allowedProviders.self_hosted,
              copilot_mcp: input.allowedProviders.self_hosted,
              generic_mcp: input.allowedProviders.self_hosted,
            }),
        ...(input.allowedClientKinds ?? {}),
      },
      groupToggles: {
        ...this.aiConnectorPolicySettings.groupToggles,
        ...(input.groupToggles ?? {}),
      },
      bearerFallback: {
        ...this.aiConnectorPolicySettings.bearerFallback,
        ...(input.bearerFallback ?? {}),
        allowedClientKinds:
          input.bearerFallback?.allowedClientKinds === undefined
            ? [...this.aiConnectorPolicySettings.bearerFallback.allowedClientKinds]
            : [...input.bearerFallback.allowedClientKinds],
        allowedToolGroups:
          input.bearerFallback?.allowedToolGroups === undefined
            ? [...this.aiConnectorPolicySettings.bearerFallback.allowedToolGroups]
            : [...input.bearerFallback.allowedToolGroups],
      },
      oauthRedirectUriAllowlist:
        input.oauthRedirectUriAllowlist === undefined
          ? [...this.aiConnectorPolicySettings.oauthRedirectUriAllowlist]
          : [...input.oauthRedirectUriAllowlist],
      updatedAt: new Date().toISOString(),
    };
    return this.getAiConnectorPolicySettings();
  }

  async saveMcpOAuthAuthorizationRequest(
    input: SaveMcpOAuthAuthorizationRequestInput,
  ): Promise<McpOAuthAuthorizationRequestRecord> {
    this.assertUserExists(input.userId);
    const existing = this.mcpOAuthAuthorizationRequests.get(input.id);
    const record: McpOAuthAuthorizationRequestRecord = {
      id: input.id,
      userId: input.userId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      state: input.state ?? null,
      resource: input.resource,
      scopes: [...new Set(input.scopes)].sort(),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      csrfTokenHash: input.csrfTokenHash,
      expiresAt: input.expiresAt,
      approvedAt: input.approvedAt ?? existing?.approvedAt ?? null,
      deniedAt: input.deniedAt ?? existing?.deniedAt ?? null,
      createdAt: input.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
    };
    this.mcpOAuthAuthorizationRequests.set(record.id, record);
    return { ...record, scopes: [...record.scopes] };
  }

  async getMcpOAuthAuthorizationRequest(id: string): Promise<McpOAuthAuthorizationRequestRecord | null> {
    const record = this.mcpOAuthAuthorizationRequests.get(id);
    return record ? { ...record, scopes: [...record.scopes] } : null;
  }

  async approveMcpOAuthAuthorizationRequest(
    input: ApproveMcpOAuthAuthorizationRequestInput,
  ): Promise<ApproveMcpOAuthAuthorizationRequestResult | null> {
    this.assertUserExists(input.userId);
    const request = this.mcpOAuthAuthorizationRequests.get(input.requestId);
    if (!request || request.userId !== input.userId) return null;
    if (request.approvedAt || request.deniedAt || Date.parse(request.expiresAt) <= Date.now()) return null;

    const connectionInput = input.connection;
    if (
      connectionInput.userId !== request.userId
      || input.code.userId !== request.userId
      || input.code.connectionId !== connectionInput.id
    ) {
      throw routeError(400, "mcp_oauth_invalid_transition", "OAuth approval artifacts do not match the pending request");
    }

    const now = new Date().toISOString();
    const legacyClient = getMcpClientByLegacyProvider(connectionInput.provider);
    const clientKind = connectionInput.clientKind ?? legacyClient.clientKind;
    const connection: AiConnectorConnectionRecord = {
      id: connectionInput.id,
      userId: connectionInput.userId,
      provider: connectionInput.provider,
      vendor: connectionInput.vendor ?? legacyClient.vendor,
      clientKind,
      authMode: connectionInput.authMode ?? legacyClient.defaultAuthMode,
      capabilities: [...new Set(connectionInput.capabilities ?? defaultClientCapabilities(clientKind))].sort(),
      displayName: connectionInput.displayName,
      status: connectionInput.status,
      oauthClientId: connectionInput.oauthClientId ?? null,
      oauthSubject: connectionInput.oauthSubject ?? null,
      scopes: [...new Set(connectionInput.scopes)].sort(),
      toolToggles: this.normalizeToolToggles(connectionInput.toolToggles ?? {}),
      expiresAt: connectionInput.expiresAt ?? null,
      expiryNotifiedAt: connectionInput.expiryNotifiedAt ?? null,
      lastUsedAt: connectionInput.lastUsedAt ?? null,
      hiddenAt: connectionInput.hiddenAt ?? null,
      revokedAt: connectionInput.revokedAt ?? null,
      revokedByUserId: connectionInput.revokedByUserId ?? null,
      revocationReason: connectionInput.revocationReason ?? null,
      createdAt: connectionInput.createdAt ?? now,
      updatedAt: connectionInput.updatedAt ?? now,
    };
    this.aiConnectorConnections.set(connection.id, connection);

    const codeInput = input.code;
    const code: McpOAuthAuthorizationCodeRecord = {
      id: codeInput.id,
      codeHash: codeInput.codeHash,
      connectionId: codeInput.connectionId,
      userId: codeInput.userId,
      clientId: codeInput.clientId,
      redirectUri: codeInput.redirectUri,
      resource: codeInput.resource,
      scopes: [...new Set(codeInput.scopes)].sort(),
      codeChallenge: codeInput.codeChallenge,
      codeChallengeMethod: codeInput.codeChallengeMethod,
      expiresAt: codeInput.expiresAt,
      consumedAt: codeInput.consumedAt ?? null,
      createdAt: codeInput.createdAt ?? now,
    };
    this.mcpOAuthAuthorizationCodes.set(code.id, code);

    const settled: McpOAuthAuthorizationRequestRecord = {
      ...request,
      approvedAt: input.approvedAt,
      deniedAt: null,
    };
    this.mcpOAuthAuthorizationRequests.set(request.id, settled);
    return {
      request: { ...settled, scopes: [...settled.scopes] },
      connection: { ...connection, capabilities: [...connection.capabilities], scopes: [...connection.scopes], toolToggles: { ...connection.toolToggles } },
    };
  }

  async settleMcpOAuthAuthorizationRequest(
    id: string,
    userId: string,
    decision: "approved" | "denied",
    decidedAt: string,
  ): Promise<McpOAuthAuthorizationRequestRecord | null> {
    const record = this.mcpOAuthAuthorizationRequests.get(id);
    if (!record || record.userId !== userId) return null;
    if (record.approvedAt || record.deniedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
    const next: McpOAuthAuthorizationRequestRecord = {
      ...record,
      approvedAt: decision === "approved" ? decidedAt : null,
      deniedAt: decision === "denied" ? decidedAt : null,
    };
    this.mcpOAuthAuthorizationRequests.set(id, next);
    return { ...next, scopes: [...next.scopes] };
  }

  async saveMcpOAuthAuthorizationCode(
    input: SaveMcpOAuthAuthorizationCodeInput,
  ): Promise<McpOAuthAuthorizationCodeRecord> {
    this.assertUserExists(input.userId);
    if (!this.aiConnectorConnections.has(input.connectionId)) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    const existing = this.mcpOAuthAuthorizationCodes.get(input.id);
    const record: McpOAuthAuthorizationCodeRecord = {
      id: input.id,
      codeHash: input.codeHash,
      connectionId: input.connectionId,
      userId: input.userId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      resource: input.resource,
      scopes: [...new Set(input.scopes)].sort(),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: input.expiresAt,
      consumedAt: input.consumedAt ?? existing?.consumedAt ?? null,
      createdAt: input.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
    };
    this.mcpOAuthAuthorizationCodes.set(record.id, record);
    return { ...record, scopes: [...record.scopes] };
  }

  async consumeMcpOAuthAuthorizationCode(codeHash: string): Promise<McpOAuthAuthorizationCodeRecord | null> {
    const now = new Date().toISOString();
    for (const [id, record] of this.mcpOAuthAuthorizationCodes.entries()) {
      if (record.codeHash !== codeHash) continue;
      if (record.consumedAt || Date.parse(record.expiresAt) <= Date.now()) return null;
      const next = { ...record, consumedAt: now };
      this.mcpOAuthAuthorizationCodes.set(id, next);
      return { ...next, scopes: [...next.scopes] };
    }
    return null;
  }

  async activateAiConnectorConnectionReplacingProvider(input: ActivateAiConnectorConnectionReplacingProviderInput) {
    const current = this.aiConnectorConnections.get(input.connectionId);
    const legacyClient = getMcpClientByLegacyProvider(input.provider);
    const targetVendor = input.vendor ?? legacyClient.vendor;
    const targetClientKind = input.clientKind ?? legacyClient.clientKind;
    const targetAuthMode = input.authMode ?? legacyClient.defaultAuthMode;
    if (
      !current
      || current.userId !== input.userId
      || current.provider !== input.provider
      || current.vendor !== targetVendor
      || current.clientKind !== targetClientKind
      || current.authMode !== targetAuthMode
      || current.status !== "pending"
    ) {
      return null;
    }

    const now = new Date().toISOString();
    const activeOtherProviderCount = [...this.aiConnectorConnections.values()].filter((connection) =>
      connection.userId === input.userId
      && connection.id !== input.connectionId
      && !(connection.vendor === targetVendor && connection.clientKind === targetClientKind && connection.authMode === targetAuthMode)
      && connection.status === "active"
      && (!connection.expiresAt || Date.parse(connection.expiresAt) > Date.now())
    ).length;
    if (activeOtherProviderCount >= input.maxActiveConnectionsPerUser) {
      return null;
    }

    const revokedConnectionIds: string[] = [];
    for (const [id, connection] of this.aiConnectorConnections.entries()) {
      if (id === input.connectionId) continue;
      if (connection.userId !== input.userId) continue;
      if (
        connection.vendor !== targetVendor
        || connection.clientKind !== targetClientKind
        || connection.authMode !== targetAuthMode
      ) continue;
      if (connection.status === "revoked" || connection.status === "expired") continue;
      revokedConnectionIds.push(id);
      this.aiConnectorConnections.set(id, {
        ...connection,
        status: "revoked",
        revokedAt: now,
        revokedByUserId: input.revokedByUserId ?? null,
        revocationReason: input.revocationReason,
        updatedAt: now,
      });
      for (const [credentialId, credential] of this.aiConnectorCredentials.entries()) {
        if (credential.connectionId !== id || credential.revokedAt) continue;
        this.aiConnectorCredentials.set(credentialId, {
          ...credential,
          revokedAt: now,
        });
      }
    }

    const activated: AiConnectorConnectionRecord = {
      ...current,
      status: "active",
      oauthClientId: input.oauthClientId ?? current.oauthClientId,
      oauthSubject: input.oauthSubject ?? current.oauthSubject,
      lastUsedAt: input.lastUsedAt ?? now,
      updatedAt: now,
    };
    this.aiConnectorConnections.set(input.connectionId, activated);
    return {
      connection: { ...activated, capabilities: [...activated.capabilities], scopes: [...activated.scopes], toolToggles: { ...activated.toolToggles } },
      revokedConnectionIds,
    };
  }

  async saveAiConnectorCredential(input: SaveAiConnectorCredentialInput): Promise<AiConnectorCredentialRecord> {
    if (!this.aiConnectorConnections.has(input.connectionId)) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    const existing = this.aiConnectorCredentials.get(input.id);
    const record: AiConnectorCredentialRecord = {
      id: input.id,
      connectionId: input.connectionId,
      credentialType: input.credentialType,
      tokenHash: input.tokenHash,
      tokenHint: input.tokenHint ?? existing?.tokenHint ?? null,
      tokenFamilyId: input.tokenFamilyId ?? existing?.tokenFamilyId ?? null,
      predecessorCredentialId: input.predecessorCredentialId ?? existing?.predecessorCredentialId ?? null,
      replacedByCredentialId: input.replacedByCredentialId ?? existing?.replacedByCredentialId ?? null,
      oauthClientId: input.oauthClientId ?? existing?.oauthClientId ?? null,
      resource: input.resource ?? existing?.resource ?? null,
      scopes: [...new Set(input.scopes ?? existing?.scopes ?? [])].sort(),
      sessionVersion: input.sessionVersion ?? existing?.sessionVersion ?? null,
      expiresAt: input.expiresAt ?? existing?.expiresAt ?? null,
      revokedAt: input.revokedAt ?? existing?.revokedAt ?? null,
      createdAt: input.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
      lastUsedAt: input.lastUsedAt ?? existing?.lastUsedAt ?? null,
    };
    this.aiConnectorCredentials.set(record.id, record);
    return { ...record, scopes: [...record.scopes] };
  }

  async getAiConnectorCredentialByHash(tokenHash: string): Promise<AiConnectorCredentialRecord | null> {
    const record = [...this.aiConnectorCredentials.values()].find((item) => item.tokenHash === tokenHash);
    return record ? { ...record, scopes: [...record.scopes] } : null;
  }

  async consumeAiConnectorCredential(id: string): Promise<AiConnectorCredentialRecord | null> {
    const record = this.aiConnectorCredentials.get(id);
    if (!record || record.revokedAt || record.replacedByCredentialId) return null;
    const now = new Date().toISOString();
    const next: AiConnectorCredentialRecord = {
      ...record,
      revokedAt: now,
      lastUsedAt: now,
    };
    this.aiConnectorCredentials.set(id, next);
    return { ...next, scopes: [...next.scopes] };
  }

  async revokeAiConnectorCredential(
    id: string,
    replacedByCredentialId: string | null = null,
  ): Promise<AiConnectorCredentialRecord | null> {
    const record = this.aiConnectorCredentials.get(id);
    if (!record) return null;
    const next: AiConnectorCredentialRecord = {
      ...record,
      revokedAt: record.revokedAt ?? new Date().toISOString(),
      replacedByCredentialId: replacedByCredentialId ?? record.replacedByCredentialId,
      lastUsedAt: new Date().toISOString(),
    };
    this.aiConnectorCredentials.set(id, next);
    return { ...next, scopes: [...next.scopes] };
  }

  async revokeAiConnectorCredentialsForConnection(connectionId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const [id, record] of this.aiConnectorCredentials.entries()) {
      if (record.connectionId !== connectionId || record.revokedAt) continue;
      this.aiConnectorCredentials.set(id, { ...record, revokedAt: now });
    }
  }

  async revokeAiConnectorConnectionsForProvider(
    provider: AiConnectorProvider,
    reason: string,
    revokedByUserId: string | null = null,
  ): Promise<number> {
    const now = new Date().toISOString();
    const revokedConnectionIds = new Set<string>();
    for (const [id, connection] of this.aiConnectorConnections.entries()) {
      if (connection.provider !== provider || (connection.status !== "active" && connection.status !== "pending")) continue;
      revokedConnectionIds.add(id);
      this.aiConnectorConnections.set(id, {
        ...connection,
        status: "revoked",
        revokedAt: connection.revokedAt ?? now,
        revokedByUserId,
        revocationReason: reason,
        updatedAt: now,
      });
    }
    for (const [id, credential] of this.aiConnectorCredentials.entries()) {
      if (!revokedConnectionIds.has(credential.connectionId) || credential.revokedAt) continue;
      this.aiConnectorCredentials.set(id, { ...credential, revokedAt: now });
    }
    return revokedConnectionIds.size;
  }

  async appendAiConnectorAccessLog(input: AppendAiConnectorAccessLogInput): Promise<AiConnectorAccessLogRecord> {
    this.assertUserExists(input.userId);
    this.assertUserExists(input.portfolioContextUserId);
    if (input.connectionId && !this.aiConnectorConnections.has(input.connectionId)) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    if (input.shareId) this.assertShareExists(input.shareId);
    const record: AiConnectorAccessLogRecord = {
      id: input.id ?? randomUUID(),
      connectionId: input.connectionId,
      userId: input.userId,
      portfolioContextUserId: input.portfolioContextUserId,
      shareId: input.shareId ?? null,
      toolName: input.toolName,
      accessKind: input.accessKind,
      result: input.result,
      denialReason: input.denialReason ?? null,
      requestId: input.requestId ?? null,
      sourceIp: input.sourceIp ?? null,
      userAgent: input.userAgent ?? null,
      metadata: { ...(input.metadata ?? {}) },
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.aiConnectorAccessLogs.push(record);
    this.aiConnectorAccessLogs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return { ...record, metadata: { ...record.metadata } };
  }

  async listAiConnectorAccessLogsForUser(
    userId: string,
    options?: { limit?: number; offset?: number; result?: AiConnectorAccessResult; search?: string; connectionIds?: string[] },
  ): Promise<AiConnectorAccessLogRecord[]> {
    const limit = options?.limit ?? Number.POSITIVE_INFINITY;
    const offset = options?.offset ?? 0;
    const search = options?.search?.trim().toLowerCase() ?? "";
    const connectionIds = options?.connectionIds ? new Set(options.connectionIds) : null;
    const logs: AiConnectorAccessLogRecord[] = [];
    let skipped = 0;
    for (const record of this.aiConnectorAccessLogs) {
      if (record.userId !== userId) continue;
      if (options?.result && record.result !== options.result) continue;
      if (connectionIds && (record.connectionId === null || !connectionIds.has(record.connectionId))) continue;
      if (
        search
        && !record.toolName.toLowerCase().includes(search)
        && !record.accessKind.toLowerCase().includes(search)
        && !(record.denialReason ?? "").toLowerCase().includes(search)
      ) continue;
      if (skipped < offset) {
        skipped += 1;
        continue;
      }
      logs.push({ ...record, metadata: { ...record.metadata } });
      if (logs.length >= limit) break;
    }
    return logs;
  }

  async saveAiTransactionDraftBatch(input: SaveAiTransactionDraftBatchInput): Promise<AiTransactionDraftBatchRecord | null> {
    this.assertUserExists(input.ownerUserId);
    if (input.createdByUserId) this.assertUserExists(input.createdByUserId);
    if (input.connectorConnectionId && !this.aiConnectorConnections.has(input.connectorConnectionId)) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    if (input.shareId) this.assertShareExists(input.shareId);
    if (input.archivedByUserId) this.assertUserExists(input.archivedByUserId);
    if (input.deletedByUserId) this.assertUserExists(input.deletedByUserId);
    const existing = this.aiTransactionDraftBatches.get(input.id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      if (!existing || existing.version !== input.expectedVersion) return null;
    }
    const now = new Date().toISOString();
    const record: AiTransactionDraftBatchRecord = {
      id: input.id,
      ownerUserId: input.ownerUserId,
      createdByUserId: input.createdByUserId,
      connectorConnectionId: input.connectorConnectionId ?? null,
      shareId: input.shareId ?? null,
      sourceChannel: input.sourceChannel,
      status: input.status,
      version: input.version,
      sourceLabel: input.sourceLabel ?? null,
      sourceFilename: input.sourceFilename ?? null,
      note: input.note ?? null,
      provenance: { ...(input.provenance ?? {}) },
      rowCount: input.rowCount,
      unsupportedCount: input.unsupportedCount,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
      archivedAt: input.archivedAt ?? null,
      archivedByUserId: input.archivedByUserId ?? null,
      deletedAt: input.deletedAt ?? null,
      deletedByUserId: input.deletedByUserId ?? null,
    };
    this.aiTransactionDraftBatches.set(record.id, record);
    return { ...record, provenance: { ...record.provenance } };
  }

  async getAiTransactionDraftBatch(id: string): Promise<AiTransactionDraftBatchAggregate | null> {
    const batch = this.aiTransactionDraftBatches.get(id);
    if (!batch) return null;
    return {
      batch: { ...batch, provenance: { ...batch.provenance } },
      rows: await this.listAiTransactionDraftRows(id),
      unsupportedItems: await this.listAiTransactionDraftUnsupportedItems(id),
      events: await this.listAiTransactionDraftEvents(id),
    };
  }

  async listAiTransactionDraftBatchesForOwner(ownerUserId: string): Promise<AiTransactionDraftBatchRecord[]> {
    return [...this.aiTransactionDraftBatches.values()]
      .filter((batch) => batch.ownerUserId === ownerUserId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((batch) => ({ ...batch, provenance: { ...batch.provenance } }));
  }

  async saveAiTransactionDraftRow(input: SaveAiTransactionDraftRowInput): Promise<AiTransactionDraftRowRecord | null> {
    const batch = this.aiTransactionDraftBatches.get(input.batchId);
    if (!batch) {
      throw routeError(404, "ai_transaction_draft_batch_not_found", "AI transaction draft batch not found");
    }
    if (input.ownerUserId !== batch.ownerUserId) {
      throw routeError(409, "ai_transaction_draft_owner_mismatch", "AI transaction draft owner mismatch");
    }
    if (input.confirmedByUserId) this.assertUserExists(input.confirmedByUserId);
    const existingRows = this.aiTransactionDraftRows.get(input.batchId) ?? [];
    const existing = existingRows.find((row) => row.id === input.id) ?? null;
    if (input.expectedVersion !== undefined && input.expectedVersion !== null) {
      if (!existing || existing.version !== input.expectedVersion) return null;
    }
    const now = new Date().toISOString();
    const record: AiTransactionDraftRowRecord = {
      id: input.id,
      batchId: input.batchId,
      ownerUserId: input.ownerUserId,
      rowNumber: input.rowNumber,
      state: input.state,
      version: input.version,
      accountId: input.accountId ?? null,
      accountNameInput: input.accountNameInput ?? null,
      tradeType: input.tradeType ?? null,
      ticker: input.ticker ?? null,
      marketCode: input.marketCode ?? null,
      quantity: input.quantity ?? null,
      unitPrice: input.unitPrice ?? null,
      priceCurrency: input.priceCurrency ?? null,
      tradeDate: input.tradeDate ?? null,
      tradeTimestamp: input.tradeTimestamp ?? null,
      bookingSequence: input.bookingSequence ?? null,
      isDayTrade: input.isDayTrade ?? null,
      commissionAmount: input.commissionAmount ?? null,
      taxAmount: input.taxAmount ?? null,
      feesSource: input.feesSource ?? null,
      note: input.note ?? null,
      sourceRowRef: input.sourceRowRef ?? null,
      sourceSnippet: input.sourceSnippet ?? null,
      normalizedPayload: { ...(input.normalizedPayload ?? {}) },
      preflightIssues: [...(input.preflightIssues ?? [])],
      warnings: [...(input.warnings ?? [])],
      duplicateTradeEventId: input.duplicateTradeEventId ?? null,
      confirmedTradeEventId: input.confirmedTradeEventId ?? null,
      confirmedAt: input.confirmedAt ?? null,
      confirmedByUserId: input.confirmedByUserId ?? null,
      createdAt: input.createdAt ?? existing?.createdAt ?? now,
      updatedAt: input.updatedAt ?? now,
    };
    const nextRows = existingRows.filter((row) => row.id !== record.id);
    nextRows.push(record);
    nextRows.sort((left, right) => left.rowNumber - right.rowNumber || left.createdAt.localeCompare(right.createdAt));
    this.aiTransactionDraftRows.set(input.batchId, nextRows);
    return this.cloneDraftRow(record);
  }

  async listAiTransactionDraftRows(batchId: string): Promise<AiTransactionDraftRowRecord[]> {
    return (this.aiTransactionDraftRows.get(batchId) ?? []).map((row) => this.cloneDraftRow(row));
  }

  async replaceAiTransactionDraftUnsupportedItems(
    batchId: string,
    items: SaveAiTransactionDraftUnsupportedItemInput[],
  ): Promise<AiTransactionDraftUnsupportedItemRecord[]> {
    if (!this.aiTransactionDraftBatches.has(batchId)) {
      throw routeError(404, "ai_transaction_draft_batch_not_found", "AI transaction draft batch not found");
    }
    const records = items
      .map((item) => ({
        id: item.id,
        batchId,
        rowNumber: item.rowNumber ?? null,
        category: item.category,
        reason: item.reason,
        sourceSnippet: item.sourceSnippet ?? null,
        rawPayload: { ...(item.rawPayload ?? {}) },
        createdAt: item.createdAt ?? new Date().toISOString(),
      }))
      .sort((left, right) => {
        const leftRow = left.rowNumber ?? Number.MAX_SAFE_INTEGER;
        const rightRow = right.rowNumber ?? Number.MAX_SAFE_INTEGER;
        return leftRow - rightRow || left.createdAt.localeCompare(right.createdAt);
      });
    this.aiTransactionDraftUnsupportedItems.set(batchId, records);
    return records.map((record) => ({ ...record, rawPayload: { ...record.rawPayload } }));
  }

  async listAiTransactionDraftUnsupportedItems(batchId: string): Promise<AiTransactionDraftUnsupportedItemRecord[]> {
    return (this.aiTransactionDraftUnsupportedItems.get(batchId) ?? []).map((record) => ({
      ...record,
      rawPayload: { ...record.rawPayload },
    }));
  }

  async appendAiTransactionDraftEvent(input: AppendAiTransactionDraftEventInput): Promise<AiTransactionDraftEventRecord> {
    if (!this.aiTransactionDraftBatches.has(input.batchId)) {
      throw routeError(404, "ai_transaction_draft_batch_not_found", "AI transaction draft batch not found");
    }
    if (input.ownerUserId) this.assertUserExists(input.ownerUserId);
    if (input.actorUserId) this.assertUserExists(input.actorUserId);
    if (input.connectorConnectionId && !this.aiConnectorConnections.has(input.connectorConnectionId)) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    const record: AiTransactionDraftEventRecord = {
      id: input.id ?? randomUUID(),
      batchId: input.batchId,
      rowId: input.rowId ?? null,
      ownerUserId: input.ownerUserId ?? null,
      actorUserId: input.actorUserId ?? null,
      connectorConnectionId: input.connectorConnectionId ?? null,
      eventType: input.eventType,
      summary: input.summary ?? null,
      beforeState: input.beforeState ? { ...input.beforeState } : null,
      afterState: input.afterState ? { ...input.afterState } : null,
      metadata: { ...(input.metadata ?? {}) },
      sourceIp: input.sourceIp ?? null,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const events = this.aiTransactionDraftEvents.get(input.batchId) ?? [];
    events.push(record);
    events.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    this.aiTransactionDraftEvents.set(input.batchId, events);
    return this.cloneDraftEvent(record);
  }

  async listAiTransactionDraftEvents(batchId: string): Promise<AiTransactionDraftEventRecord[]> {
    return (this.aiTransactionDraftEvents.get(batchId) ?? []).map((record) => this.cloneDraftEvent(record));
  }

  async confirmAiTransactionDraftPosting(
    input: ConfirmAiTransactionDraftPostingInput,
  ): Promise<ConfirmAiTransactionDraftPostingResult | null> {
    const existingBatch = this.aiTransactionDraftBatches.get(input.batch.id);
    if (!existingBatch || existingBatch.version !== input.batch.expectedVersion) return null;
    const existingRows = this.aiTransactionDraftRows.get(input.batch.id) ?? [];
    for (const row of input.rows) {
      const existing = existingRows.find((candidate) => candidate.id === row.id);
      if (!existing || existing.version !== row.expectedVersion) return null;
    }

    await this.saveAccountingStore(input.ownerUserId, input.accounting);
    const savedRows: AiTransactionDraftRowRecord[] = [];
    for (const row of input.rows) {
      const saved = await this.saveAiTransactionDraftRow(row);
      if (!saved) return null;
      savedRows.push(saved);
    }
    const savedBatch = await this.saveAiTransactionDraftBatch(input.batch);
    if (!savedBatch) return null;
    const event = await this.appendAiTransactionDraftEvent(input.event);
    return { rows: savedRows, batch: savedBatch, event };
  }

  async createAnonymousShareToken(
    input: CreateAnonymousShareTokenInput,
  ): Promise<CreateAnonymousShareTokenResult> {
    // Per-owner mutex keeps cap-check + insert atomic across concurrent callers.
    const previous = this.anonymousShareTokenLocks.get(input.ownerUserId) ?? Promise.resolve();
    const next = previous.then(() => this._createAnonymousShareTokenLocked(input));
    this.anonymousShareTokenLocks.set(
      input.ownerUserId,
      next.catch(() => undefined),
    );
    return next;
  }

  private async _createAnonymousShareTokenLocked(
    input: CreateAnonymousShareTokenInput,
  ): Promise<CreateAnonymousShareTokenResult> {
    const owner = this.getUserById(input.ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }

    if (this.anonymousShareTokens.some((row) => row.token === input.token)) {
      return { status: "collision" };
    }

    const activeCount = this._countActiveAnonymousShareTokens(input.ownerUserId);
    if (activeCount >= getEffectiveAnonymousShareTokenCap()) {
      return { status: "cap_exceeded" };
    }

    const record: MemoryAnonymousShareToken = {
      id: randomUUID(),
      token: input.token,
      ownerUserId: input.ownerUserId,
      createdAt: new Date().toISOString(),
      expiresAt: input.expiresAt,
      revokedAt: null,
      revokedByUserId: null,
    };
    this.anonymousShareTokens.push(record);

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_token_created",
      targetUserId: null,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        tokenId: record.id,
        expiresAt: record.expiresAt,
        ttlDays: input.ttlDays,
      },
    });

    return { status: "ok", record: toAnonymousShareTokenRecord(record) };
  }

  async listAnonymousShareTokensForOwner(ownerUserId: string): Promise<AnonymousShareTokenRecord[]> {
    const now = Date.now();
    const cutoff = now - getEffectiveAnonymousShareTokenRetentionMs();
    return this.anonymousShareTokens
      .filter((row) => row.ownerUserId === ownerUserId)
      .filter((row) => {
        if (row.revokedAt === null) {
          const expiresAtMs = new Date(row.expiresAt).getTime();
          if (expiresAtMs > now) return true;
          return expiresAtMs >= cutoff;
        }
        return new Date(row.revokedAt).getTime() >= cutoff;
      })
      .slice()
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map(toAnonymousShareTokenRecord);
  }

  async findActiveAnonymousShareTokenByToken(token: string): Promise<AnonymousShareTokenRecord | null> {
    const row = this.anonymousShareTokens.find((candidate) => candidate.token === token);
    if (!row) return null;
    if (row.revokedAt !== null) return null;
    if (new Date(row.expiresAt).getTime() <= Date.now()) return null;
    return toAnonymousShareTokenRecord(row);
  }

  async revokeAnonymousShareToken(
    input: RevokeAnonymousShareTokenInput,
  ): Promise<RevokeAnonymousShareTokenResult> {
    const row = this.anonymousShareTokens.find((candidate) => candidate.id === input.id);
    if (!row || row.ownerUserId !== input.ownerUserId) {
      return { status: "not_found" };
    }
    const isActive =
      row.revokedAt === null && new Date(row.expiresAt).getTime() > Date.now();
    if (!isActive) {
      return { status: "noop" };
    }
    row.revokedAt = new Date().toISOString();
    row.revokedByUserId = input.ownerUserId;

    await this.appendAuditLog({
      ...input.auditInput,
      action: "share_token_revoked",
      targetUserId: null,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        tokenId: row.id,
      },
    });

    return { status: "revoked", record: toAnonymousShareTokenRecord(row) };
  }

  async countActiveAnonymousShareTokensForOwner(ownerUserId: string): Promise<number> {
    return this._countActiveAnonymousShareTokens(ownerUserId);
  }

  async getAccountMarketDividendSettings(
    userId: string,
    accountId: string,
    marketCode: SharedMarketCode,
  ): Promise<AccountMarketDividendSettingsDto> {
    const store = await this.loadStore(userId);
    const account = store.accounts.find((item) => item.id === accountId);
    if (!account) {
      throw routeError(404, "account_not_found", "Account not found");
    }
    if (marketCode !== marketCodeFor(account.defaultCurrency)) {
      const defaultSettings: AccountMarketDividendSettingsDto = {
        accountId,
        marketCode,
        version: 0,
        fallbackParValue: null,
        updatedAt: null,
      };
      return defaultSettings;
    }
    const existing = this.accountMarketDividendSettings.get(`${accountId}:${marketCode}`);
    if (existing) return existing;
    const defaultSettings: AccountMarketDividendSettingsDto = {
      accountId,
      marketCode,
      version: 0,
      fallbackParValue: null,
      updatedAt: null,
    };
    return defaultSettings;
  }

  async patchAccountMarketDividendSettings(
    userId: string,
    input: {
      accountId: string;
      marketCode: SharedMarketCode;
      fallbackParValue: string | null;
      expectedVersion?: number;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<AccountMarketDividendSettingsDto> {
    const store = await this.loadStore(userId);
    const account = store.accounts.find((item) => item.id === input.accountId);
    if (!account) {
      throw routeError(404, "account_not_found", "Account not found");
    }
    if (input.marketCode !== marketCodeFor(account.defaultCurrency)) {
      throw routeError(400, "unsupported_dividend_settings_market", "Dividend settings market must match the account market.");
    }
    const key = `${input.accountId}:${input.marketCode}`;
    const current: AccountMarketDividendSettingsDto = this.accountMarketDividendSettings.get(key) ?? {
      accountId: input.accountId,
      marketCode: input.marketCode,
      version: 0,
      fallbackParValue: null,
      updatedAt: null,
    };
    if (input.expectedVersion !== undefined && input.expectedVersion !== current.version) {
      throw routeError(409, "account_market_dividend_settings_version_conflict", "Dividend settings version conflict.");
    }
    const next: AccountMarketDividendSettingsDto = {
      accountId: input.accountId,
      marketCode: input.marketCode,
      version: current.version + 1,
      fallbackParValue: input.fallbackParValue,
      updatedAt: new Date().toISOString(),
    };
    this.accountMarketDividendSettings.set(key, next);
    await this.appendAuditLog({
      ...input.auditInput,
      action: "account_market_dividend_settings_updated",
      targetUserId: userId,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        accountId: input.accountId,
        marketCode: input.marketCode,
        fallbackParValue: input.fallbackParValue,
      },
    });
    return next;
  }

  async getLatestDividendCalculation(
    userId: string,
    accountId: string,
    dividendEventId: string,
  ): Promise<DividendCalculationVersionDto | null> {
    const store = await this.loadStore(userId);
    assertOwnedDividendCalculationAccount(store, accountId);
    const active = findActiveDividendCalculationVersion(store, accountId, dividendEventId);
    return active ? mapDividendCalculationVersionDto(active) : null;
  }

  async confirmDividendCalculation(
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
      drift: DividendCalculationDriftDto | null;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<DividendCalculationVersionDto> {
    const store = await this.loadStore(userId);
    assertOwnedDividendCalculationAccount(store, input.accountId);
    const now = new Date().toISOString();
    const currentActive = findActiveDividendCalculationVersion(store, input.accountId, input.dividendEventId);
    assertDividendCalculationMutationExpectation(currentActive, input);
    if (currentActive) currentActive.supersededAt = now;
    const next: DividendCalculationVersion = {
      id: randomUUID(),
      userId,
      accountId: input.accountId,
      dividendEventId: input.dividendEventId,
      calculationVersion: nextDividendCalculationVersionNumber(store, userId, input.accountId, input.dividendEventId),
      status: "confirmed",
      method: input.method,
      providerValue: input.providerValue,
      providerUnit: input.providerUnit,
      providerSource: input.providerSource,
      providerDataset: input.providerDataset,
      providerAuthoritativeRatio: input.providerAuthoritativeRatio,
      selectedParValue: input.selectedParValue ?? null,
      customRatio: input.customRatio ?? null,
      ratio: input.ratio,
      theoreticalShares: input.theoreticalShares,
      expectedWholeShares: input.expectedWholeShares,
      fractionalRemainder: input.fractionalRemainder,
      requiresHighRatioConfirmation: input.requiresHighRatioConfirmation,
      confirmedAt: now,
      supersededAt: undefined,
      priorCalculationId: currentActive?.id ?? null,
      dividendLedgerEntryId: null,
      drift: input.drift,
      createdAt: now,
    };
    store.accounting.facts.dividendCalculationVersions.push(next);
    await this.appendAuditLog({
      ...input.auditInput,
      action: "dividend_calculation_confirmed",
      targetUserId: userId,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        mutation: "dividend_calculation_confirmed",
        accountId: input.accountId,
        dividendEventId: input.dividendEventId,
        calculationId: next.id,
      },
    });
    return mapDividendCalculationVersionDto(next);
  }

  async resetDividendCalculation(
    userId: string,
    input: DividendCalculationResetRequestDto & {
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<void> {
    const store = await this.loadStore(userId);
    assertOwnedDividendCalculationAccount(store, input.accountId);
    const active = findActiveDividendCalculationVersion(store, input.accountId, input.dividendEventId);
    assertDividendCalculationMutationExpectation(active, input);
    if (!active) return;
    const postedLedger = store.accounting.facts.dividendLedgerEntries.find(
      (entry) =>
        entry.accountId === input.accountId &&
        entry.dividendEventId === input.dividendEventId &&
        !entry.supersededAt &&
        !entry.reversalOfDividendLedgerEntryId &&
        entry.postingStatus !== "expected",
    );
    if (postedLedger) {
      throw routeError(
        409,
        "dividend_calculation_reset_requires_unposted",
        "Posted dividend expectations must be corrected with an amendment.",
      );
    }
    const now = new Date().toISOString();
    active.supersededAt = now;
    store.accounting.facts.dividendCalculationVersions.push({
      ...active,
      id: randomUUID(),
      calculationVersion: nextDividendCalculationVersionNumber(store, userId, input.accountId, input.dividendEventId),
      status: "reset",
      confirmedAt: null,
      supersededAt: undefined,
      priorCalculationId: active.id,
      dividendLedgerEntryId: null,
      drift: null,
      createdAt: now,
    });
    await this.appendAuditLog({
      ...input.auditInput,
      action: "dividend_calculation_reset",
      targetUserId: userId,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        mutation: "dividend_calculation_reset",
        accountId: input.accountId,
        dividendEventId: input.dividendEventId,
      },
    });
  }

  async amendDividendCalculation(
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
      drift: DividendCalculationDriftDto | null;
      auditInput: Omit<AuditLogInput, "action" | "targetUserId">;
    },
  ): Promise<DividendCalculationVersionDto> {
    const store = await this.loadStore(userId);
    assertOwnedDividendCalculationAccount(store, input.accountId);
    const ledgerEntry = store.accounting.facts.dividendLedgerEntries.find(
      (entry) =>
        entry.id === input.dividendLedgerEntryId &&
        entry.accountId === input.accountId &&
        entry.dividendEventId === input.dividendEventId &&
        !entry.supersededAt &&
        !entry.reversalOfDividendLedgerEntryId,
    );
    if (!ledgerEntry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    if (ledgerEntry.postingStatus === "expected") {
      throw routeError(
        409,
        "dividend_calculation_amend_requires_posted",
        "Expectation-only amendments require a posted dividend receipt.",
      );
    }
    const now = new Date().toISOString();
    const currentActive = findActiveDividendCalculationVersion(store, input.accountId, input.dividendEventId);
    assertDividendCalculationMutationExpectation(currentActive, input);
    if (currentActive) currentActive.supersededAt = now;
    const next: DividendCalculationVersion = {
      id: randomUUID(),
      userId,
      accountId: input.accountId,
      dividendEventId: input.dividendEventId,
      calculationVersion: nextDividendCalculationVersionNumber(store, userId, input.accountId, input.dividendEventId),
      status: "amended",
      method: input.method,
      providerValue: input.providerValue,
      providerUnit: input.providerUnit,
      providerSource: input.providerSource,
      providerDataset: input.providerDataset,
      providerAuthoritativeRatio: input.providerAuthoritativeRatio,
      selectedParValue: input.selectedParValue ?? null,
      customRatio: input.customRatio ?? null,
      ratio: input.ratio,
      theoreticalShares: input.theoreticalShares,
      expectedWholeShares: input.expectedWholeShares,
      fractionalRemainder: input.fractionalRemainder,
      requiresHighRatioConfirmation: input.requiresHighRatioConfirmation,
      confirmedAt: now,
      supersededAt: undefined,
      priorCalculationId: currentActive?.id ?? null,
      dividendLedgerEntryId: ledgerEntry.id,
      drift: input.drift,
      createdAt: now,
    };
    store.accounting.facts.dividendCalculationVersions.push(next);
    ledgerEntry.expectedStockQuantity = input.expectedWholeShares;
    ledgerEntry.expectedStockCalcState = "resolved";
    ledgerEntry.expectedStockDistributionRatio = Number(input.ratio);
    ledgerEntry.expectedStockParValueAmount = input.selectedParValue == null ? null : Number(input.selectedParValue);
    ledgerEntry.activeCalculationId = next.id;
    ledgerEntry.stockReconciliationStatus =
      ledgerEntry.stockReconciliationStatus === "explained"
        ? "explained"
        : deriveStockReconciliationStatusFromExpectation(
            ledgerEntry.receivedStockQuantity,
            input.expectedWholeShares,
          );
    await this.appendAuditLog({
      ...input.auditInput,
      action: "dividend_calculation_amended",
      targetUserId: userId,
      metadata: {
        ...(input.auditInput.metadata ?? {}),
        mutation: "dividend_calculation_amended",
        accountId: input.accountId,
        dividendEventId: input.dividendEventId,
        calculationId: next.id,
        dividendLedgerEntryId: ledgerEntry.id,
      },
    });
    return mapDividendCalculationVersionDto(next);
  }

  async purgeTerminalAnonymousShareTokens(_olderThanMs: number): Promise<number> {
    return 0;
  }

  private _countActiveAnonymousShareTokens(ownerUserId: string): number {
    const now = Date.now();
    return this.anonymousShareTokens.filter(
      (row) =>
        row.ownerUserId === ownerUserId &&
        row.revokedAt === null &&
        new Date(row.expiresAt).getTime() > now,
    ).length;
  }

  async loadStore(userId: string) {
    return this.getOrCreateStore(userId);
  }

  private getOrCreateStore(userId: string): Store {
    const existing = this.stores.get(userId);
    if (existing) return existing;

    const store = createStore();
    store.userId = userId;
    store.settings.userId = userId;
    store.accounts = store.accounts.map((account) => ({ ...account, userId }));
    const userCatalog = this.instrumentsByUser.get(userId);
    if (userCatalog && userCatalog.size > 0) {
      setStoreInstruments(store, [...userCatalog.values()].map(memoryInstrumentToDef));
    }

    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (memUser?.displayName) {
      store.settings.displayName = memUser.displayName;
    }

    this.stores.set(userId, store);
    return store;
  }

  async loadPrimaryReadStore(userId: string): Promise<Store> {
    return this.loadStore(userId);
  }

  async loadOverviewReadStore(userId: string): Promise<Store> {
    return this.loadStore(userId);
  }

  async listTransactionInstrumentOptions(userId: string): Promise<InstrumentOptionDto[]> {
    const instruments = [...this._catalogForUser(userId).values()]
      .filter((row) => /^[A-Za-z0-9]{1,16}$/.test(row.ticker))
      .map((row): Store["instruments"][number] => ({
        ticker: row.ticker,
        type: row.instrumentType as InstrumentType | null,
        marketCode: row.marketCode as MarketCode,
        isProvisional: false,
        lastSyncedAt: null,
        typeRaw: row.typeRaw ?? null,
        industryCategoryRaw: row.industryCategoryRaw ?? null,
        finmindDate: null,
      }));
    return upsertInstrumentDefinitions(instruments, createDefaultInstruments())
      .map((instrument): InstrumentOptionDto | null => {
        if (instrument.type === null) return null;
        return {
          ticker: instrument.ticker,
          instrumentType: instrument.type,
          marketCode: instrument.marketCode,
          isProvisional: instrument.isProvisional === true,
        };
      })
      .filter((instrument): instrument is InstrumentOptionDto => instrument !== null);
  }

  async getUserSettings(userId: string) {
    const store = await this.loadStore(userId);
    return store.settings;
  }

  async saveStore(store: Store, options?: import("./types.js").SaveStoreOptions): Promise<void> {
    // KZO-183: enforce the composite-FK ownership invariant in application
    // code. Postgres enforces it via the (id, account_id) composite FKs from
    // accounts and account_fee_profile_overrides; the memory backend cannot
    // express that declaratively, so this mirror runs on every saveStore so
    // memory-backed unit tests catch the same class of cross-account
    // ownership violation that integration tests catch via Postgres.
    validateMemoryStoreOwnership(store);
    for (const [accountId, expectedRevision] of Object.entries(options?.expectedAccountRevisions ?? {})) {
      const currentRevision = await this.getAccountAccountingRevision(store.userId, accountId);
      if (currentRevision !== expectedRevision) {
        throw routeError(409, "recompute_preview_drift", "Underlying records changed after preview");
      }
    }
    // Recompute jobs have their own lifecycle methods. Preserve their current
    // durable state when an older full-store snapshot is saved so a PREVIEWED
    // snapshot cannot delete or downgrade a RUNNING/CONFIRMED job.
    const recomputeJobs = structuredClone(this.stores.get(store.userId)?.recomputeJobs ?? []);
    syncInstruments(store);
    store.recomputeJobs = recomputeJobs;
    this.stores.set(store.userId, store);
    for (const account of store.accounts) {
      const key = `${store.userId}:${account.id}`;
      this.accountAccountingRevisions.set(key, (this.accountAccountingRevisions.get(key) ?? 0) + 1);
    }
  }

  async saveRecomputeJob(job: import("../types/store.js").RecomputeJob): Promise<void> {
    const store = await this.loadStore(job.userId);
    const index = store.recomputeJobs.findIndex((candidate) => candidate.id === job.id);
    const cloned = structuredClone(job);
    if (index === -1) store.recomputeJobs.push(cloned);
    else if (store.recomputeJobs[index]!.status === "PREVIEWED" && cloned.status === "PREVIEWED") {
      store.recomputeJobs[index] = cloned;
    }
  }

  async startRecomputeJob(userId: string, jobId: string, startedAt: string): Promise<boolean> {
    const store = await this.loadStore(userId);
    const job = store.recomputeJobs.find((candidate) => candidate.id === jobId && candidate.userId === userId);
    const canStart = job?.status === "PREVIEWED"
      || (job?.status === "RUNNING" && isRecomputeRunningLeaseExpired(job.startedAt, new Date(startedAt)));
    if (!job || !canStart) return false;
    job.status = "RUNNING";
    job.startedAt = startedAt;
    delete job.errorCode;
    delete job.errorMessage;
    return true;
  }

  async failRecomputeJob(
    userId: string,
    jobId: string,
    failure: { startedAt: string; completedAt: string; errorCode: string; errorMessage: string },
  ): Promise<boolean> {
    const store = await this.loadStore(userId);
    const job = store.recomputeJobs.find((candidate) => candidate.id === jobId && candidate.userId === userId);
    if (!job || job.status !== "RUNNING" || job.startedAt !== failure.startedAt) return false;
    job.status = "FAILED";
    job.completedAt = failure.completedAt;
    job.errorCode = failure.errorCode;
    job.errorMessage = failure.errorMessage;
    return true;
  }

  async commitRecomputeStore(
    userId: string,
    accounting: AccountingStore,
    job: import("../types/store.js").RecomputeJob,
  ): Promise<boolean> {
    const store = await this.loadStore(userId);
    const durableJob = store.recomputeJobs.find((candidate) => candidate.id === job.id && candidate.userId === userId);
    if (!durableJob || durableJob.status !== "RUNNING" || durableJob.startedAt !== job.startedAt) return false;

    const accountIds = new Set(Object.keys(job.accountRevisions));
    const currentFeeConfigFingerprint = recomputeFeeConfigFingerprint({
      accounts: store.accounts,
      feeProfiles: store.feeProfiles,
      bindings: store.feeProfileBindings,
    }, [...accountIds], recomputeReferencedProfileIds(job));
    if (currentFeeConfigFingerprint !== job.feeConfigFingerprint) {
      throw routeError(409, "recompute_preview_drift", "Fee configuration changed after preview");
    }
    for (const [accountId, expectedRevision] of Object.entries(job.accountRevisions)) {
      const currentRevision = this.accountAccountingRevisions.get(`${userId}:${accountId}`) ?? 0;
      if (currentRevision !== expectedRevision) {
        throw routeError(409, "recompute_preview_drift", "Underlying records changed after preview");
      }
    }

    const current = store.accounting;
    const selectedCurrentLedgerIds = new Set(current.facts.dividendLedgerEntries
      .filter((entry) => accountIds.has(entry.accountId)).map((entry) => entry.id));
    const selectedNextLedgerIds = new Set(accounting.facts.dividendLedgerEntries
      .filter((entry) => accountIds.has(entry.accountId)).map((entry) => entry.id));
    const selectedLedgerIds = new Set([...selectedCurrentLedgerIds, ...selectedNextLedgerIds]);
    const replaceAccountRows = <T extends { accountId: string }>(existing: T[], next: T[]): T[] => [
      ...existing.filter((row) => !accountIds.has(row.accountId)),
      ...next.filter((row) => accountIds.has(row.accountId)),
    ];

    store.accounting = {
      facts: {
        tradeEvents: replaceAccountRows(current.facts.tradeEvents, accounting.facts.tradeEvents),
        cashLedgerEntries: replaceAccountRows(current.facts.cashLedgerEntries, accounting.facts.cashLedgerEntries),
        dividendLedgerEntries: replaceAccountRows(current.facts.dividendLedgerEntries, accounting.facts.dividendLedgerEntries),
        dividendCalculationVersions: current.facts.dividendCalculationVersions,
        dividendDeductionEntries: [
          ...current.facts.dividendDeductionEntries.filter((row) => !selectedLedgerIds.has(row.dividendLedgerEntryId)),
          ...accounting.facts.dividendDeductionEntries.filter((row) => selectedNextLedgerIds.has(row.dividendLedgerEntryId)),
        ],
        dividendSourceLines: [
          ...current.facts.dividendSourceLines.filter((row) => !selectedLedgerIds.has(row.dividendLedgerEntryId)),
          ...accounting.facts.dividendSourceLines.filter((row) => selectedNextLedgerIds.has(row.dividendLedgerEntryId)),
        ],
        positionActions: replaceAccountRows(current.facts.positionActions, accounting.facts.positionActions),
        corporateActions: replaceAccountRows(current.facts.corporateActions, accounting.facts.corporateActions),
      },
      projections: {
        lots: replaceAccountRows(current.projections.lots, accounting.projections.lots),
        lotAllocations: replaceAccountRows(current.projections.lotAllocations, accounting.projections.lotAllocations),
        holdings: replaceAccountRows(current.projections.holdings, accounting.projections.holdings),
        dailyPortfolioSnapshots: current.projections.dailyPortfolioSnapshots,
      },
      policy: current.policy,
    };
    Object.assign(durableJob, structuredClone(job), { status: "CONFIRMED" });
    for (const accountId of accountIds) {
      const key = `${userId}:${accountId}`;
      this.accountAccountingRevisions.set(key, (this.accountAccountingRevisions.get(key) ?? 0) + 1);
    }
    return true;
  }

  async upsertInstruments(userId: string, instruments: Store["instruments"]): Promise<void> {
    if (instruments.length === 0) return;
    const store = await this.loadStore(userId);
    setStoreInstruments(store, upsertInstrumentDefinitions(store.instruments, instruments));
    this.stores.set(userId, store);
  }

  async loadAccountingStore(userId: string): Promise<AccountingStore> {
    const store = await this.loadStore(userId);
    return store.accounting;
  }

  async saveAccountingStore(userId: string, accounting: AccountingStore): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting = accounting;
    this.stores.set(userId, store);
    for (const account of store.accounts) {
      const key = `${userId}:${account.id}`;
      this.accountAccountingRevisions.set(key, (this.accountAccountingRevisions.get(key) ?? 0) + 1);
    }
  }

  async saveAccountingStoreWithAudit(
    userId: string,
    accounting: AccountingStore,
    auditEntry: AuditLogInput,
    options?: AccountingStoreAuditOptions,
  ): Promise<void> {
    const store = await this.loadStore(userId);
    if (options?.expectedAccountRevision) {
      const currentRevision = await this.getAccountAccountingRevision(userId, options.expectedAccountRevision.accountId);
      if (currentRevision !== options.expectedAccountRevision.revision) {
        throw routeError(409, "dividend_destructive_preview_row_drift", "Underlying records changed after preview");
      }
    }
    for (const [accountId, expectedRevision] of Object.entries(options?.expectedAccountRevisions ?? {})) {
      const currentRevision = await this.getAccountAccountingRevision(userId, accountId);
      if (currentRevision !== expectedRevision) {
        throw routeError(409, "posted_transaction_mutation_preview_stale", "Underlying records changed after preview");
      }
    }
    const previousAccounting = structuredClone(store.accounting);
    const previousHoldingSnapshots = options?.deleteHoldingSnapshotScopes?.length
      ? structuredClone(this.holdingSnapshots)
      : null;
    store.accounting = accounting;
    this.stores.set(userId, store);
    try {
      for (const scope of options?.deleteHoldingSnapshotScopes ?? []) {
        await this.deleteHoldingSnapshotsForTicker(
          userId,
          scope.accountId,
          scope.ticker,
          scope.fromDate,
          scope.marketCode,
        );
      }
      await this.appendAuditLog(auditEntry);
      if (options?.clearDividendPreviewPayloadId) {
        const preview = this.dividendDestructivePreviews.get(options.clearDividendPreviewPayloadId);
        if (preview) {
          this.dividendDestructivePreviews.set(options.clearDividendPreviewPayloadId, {
            ...preview,
            affectedDividends: [],
            manualReceiptReentryLedgerEntryIds: [],
            reviewedArtifacts: {
              source: { tradeEventIds: [], positionActionIds: [], lotAllocationIds: [], lotAllocationTradeEventIds: [] },
              derived: {
                dividendEventIds: [],
                dividendLedgerEntryIds: [],
                cashLedgerEntryIds: [],
                dividendDeductionEntryIds: [],
                dividendSourceLineIds: [],
                stockDividendPositionActionIds: [],
                holdingSnapshotIds: [],
              },
            },
          });
        }
        this.dividendDestructiveOutcomes.set(options.clearDividendPreviewPayloadId, {
          consumedAt: typeof auditEntry.metadata?.completedAt === "string"
            ? auditEntry.metadata.completedAt
            : new Date().toISOString(),
          consumedResult: "confirmed",
        });
      }
      for (const account of store.accounts) {
        const key = `${userId}:${account.id}`;
        this.accountAccountingRevisions.set(key, (this.accountAccountingRevisions.get(key) ?? 0) + 1);
      }
    } catch (error) {
      store.accounting = previousAccounting;
      this.stores.set(userId, store);
      if (previousHoldingSnapshots) {
        this.holdingSnapshots.splice(0, this.holdingSnapshots.length, ...previousHoldingSnapshots);
      }
      throw error;
    }
  }

  async commitPostedTransactionMutation(input: {
    userId: string;
    accounting: AccountingStore;
    auditEntry: AuditLogInput;
    preview: import("./types.js").PostedTransactionMutationPreviewRecord;
    replayPreview: import("./types.js").McpReplayPreviewRecord;
    run: import("./types.js").PostedTransactionMutationRunRecord;
    replayRun: import("./types.js").McpReplayRunRecord;
    options: AccountingStoreAuditOptions & {
      deletedDraftLineage?: import("./types.js").PostedTransactionMutationDeletedDraftLineageRecord[];
    };
  }): Promise<void> {
    const previousPreview = this.postedTransactionMutationPreviews.get(input.preview.id);
    const previousReplayPreview = this.mcpReplayPreviews.get(input.replayPreview.id);
    const previousRun = this.postedTransactionMutationRuns.get(input.run.id);
    const previousReplayRun = this.mcpReplayRuns.get(input.replayRun.id);
    try {
      await this.saveAccountingStoreWithAudit(
        input.userId,
        input.accounting,
        input.auditEntry,
        input.options,
      );
      this.postedTransactionMutationPreviews.set(input.preview.id, structuredClone(input.preview));
      this.mcpReplayPreviews.set(input.replayPreview.id, structuredClone(input.replayPreview));
      this.postedTransactionMutationRuns.set(input.run.id, structuredClone(input.run));
      this.mcpReplayRuns.set(input.replayRun.id, structuredClone(input.replayRun));
      for (const record of input.options.deletedDraftLineage ?? []) {
        this.postedTransactionMutationDeletedDraftLineage.set(record.tradeEventId, structuredClone(record));
      }
    } catch (error) {
      if (previousPreview) this.postedTransactionMutationPreviews.set(input.preview.id, previousPreview);
      else this.postedTransactionMutationPreviews.delete(input.preview.id);
      if (previousReplayPreview) this.mcpReplayPreviews.set(input.replayPreview.id, previousReplayPreview);
      else this.mcpReplayPreviews.delete(input.replayPreview.id);
      if (previousRun) this.postedTransactionMutationRuns.set(input.run.id, previousRun);
      else this.postedTransactionMutationRuns.delete(input.run.id);
      if (previousReplayRun) this.mcpReplayRuns.set(input.replayRun.id, previousReplayRun);
      else this.mcpReplayRuns.delete(input.replayRun.id);
      throw error;
    }
  }

  async getAccountAccountingRevision(userId: string, accountId: string): Promise<number> {
    const store = await this.loadStore(userId);
    if (!store.accounts.some((account) => account.id === accountId)) {
      throw routeError(404, "account_not_found", "Account not found");
    }
    return this.accountAccountingRevisions.get(`${userId}:${accountId}`) ?? 0;
  }

  async savePostedTrade(userId: string, accounting: AccountingStore, tradeEventId: string): Promise<void> {
    const trade = accounting.facts.tradeEvents.find((item) => item.id === tradeEventId);
    if (!trade) {
      throw new Error(`trade event ${tradeEventId} not found in accounting store`);
    }
    const cashEntry = accounting.facts.cashLedgerEntries.find((entry) => entry.relatedTradeEventId === tradeEventId);
    if (!cashEntry) {
      throw new Error(`cash ledger entry for trade event ${tradeEventId} not found in accounting store`);
    }

    const store = await this.loadStore(userId);
    store.accounting.facts.tradeEvents.push(structuredClone(trade));
    store.accounting.facts.cashLedgerEntries.push(structuredClone(cashEntry));
    store.accounting.projections.lotAllocations = [
      ...store.accounting.projections.lotAllocations.filter((allocation) => allocation.tradeEventId !== tradeEventId),
      ...structuredClone(accounting.projections.lotAllocations.filter(
        (allocation) => allocation.tradeEventId === tradeEventId,
      )),
    ];
    store.accounting.projections.lots = [
      ...store.accounting.projections.lots.filter(
        (lot) => lot.accountId !== trade.accountId || lot.ticker !== trade.ticker,
      ),
      ...structuredClone(accounting.projections.lots.filter(
        (lot) => lot.accountId === trade.accountId && lot.ticker === trade.ticker,
      )),
    ];
    rebuildHoldingProjection(store);
    this.stores.set(userId, store);
    const revisionKey = `${userId}:${trade.accountId}`;
    this.accountAccountingRevisions.set(
      revisionKey,
      (this.accountAccountingRevisions.get(revisionKey) ?? 0) + 1,
    );
  }

  private async saveReplayedPositionScope(
    userId: string,
    accounting: AccountingStore,
    input: ReplayedPositionScopeInput,
  ): Promise<DividendLedgerRecomputeChange[]> {
    const currentStore = await this.loadStore(userId);
    if (!currentStore.accounts.some((account) => account.id === input.accountId && account.userId === userId)) {
      throw new Error("replayed position scope account does not belong to writer owner");
    }
    const isScopedTrade = (trade: BookedTradeEvent) =>
      trade.userId === userId
      && trade.accountId === input.accountId
      && trade.ticker === input.ticker
      && trade.marketCode === input.marketCode;
    const scopedTrades = accounting.facts.tradeEvents.filter(isScopedTrade);
    const replayedTradesById = new Map(scopedTrades.map((trade) => [trade.id, trade]));
    const candidate = input.newTradeEventId
      ? replayedTradesById.get(input.newTradeEventId)
      : undefined;
    if (input.newTradeEventId && !candidate) {
      throw new Error(`trade event ${input.newTradeEventId} not found in replayed scope`);
    }
    if (
      input.newTradeEventId
      && currentStore.accounting.facts.tradeEvents.some((trade) => trade.id === input.newTradeEventId)
    ) {
      throw new Error(`trade event ${input.newTradeEventId} already exists`);
    }
    const candidateCashEntry = input.newTradeEventId
      ? accounting.facts.cashLedgerEntries.find((entry) =>
          entry.userId === userId
          && entry.accountId === input.accountId
          && entry.relatedTradeEventId === input.newTradeEventId)
      : undefined;
    if (input.newTradeEventId && !candidateCashEntry) {
      throw new Error(`cash ledger entry for trade event ${input.newTradeEventId} not found`);
    }
    const newAction = input.newPositionActionId
      ? accounting.facts.positionActions.find((action) => action.id === input.newPositionActionId)
      : undefined;
    if (
      input.newPositionActionId
      && (!newAction
        || newAction.accountId !== input.accountId
        || newAction.ticker !== input.ticker
        || newAction.marketCode !== input.marketCode)
    ) {
      throw new Error(`position action ${input.newPositionActionId} not found in replayed scope`);
    }
    if (
      input.newPositionActionId
      && currentStore.accounting.facts.positionActions.some((action) => action.id === input.newPositionActionId)
    ) {
      throw new Error(`position action ${input.newPositionActionId} already exists`);
    }
    const scopeLots = accounting.projections.lots.filter(
      (lot) => lot.accountId === input.accountId && lot.ticker === input.ticker,
    );
    const scopeLotIds = new Set(scopeLots.map((lot) => lot.id));
    const scopeTradeIds = new Set(scopedTrades.map((trade) => trade.id));
    const scopeAllocations = accounting.projections.lotAllocations.filter(
      (allocation) => allocation.accountId === input.accountId && allocation.ticker === input.ticker,
    );
    for (const allocation of scopeAllocations) {
      if (
        allocation.userId !== userId
        || !scopeTradeIds.has(allocation.tradeEventId)
        || !scopeLotIds.has(allocation.lotId)
      ) {
        throw new Error(`lot allocation ${allocation.id} does not match replayed scope`);
      }
    }

    const store = structuredClone(currentStore);
    const isStoredScopedTrade = (trade: BookedTradeEvent) =>
      trade.accountId === input.accountId
      && trade.ticker === input.ticker
      && trade.marketCode === input.marketCode;

    store.accounting.facts.tradeEvents = store.accounting.facts.tradeEvents.map((trade) => {
      const replayed = isStoredScopedTrade(trade) ? replayedTradesById.get(trade.id) : undefined;
      if (!replayed) return trade;
      return {
        ...trade,
        realizedPnlAmount: replayed.realizedPnlAmount,
        realizedPnlCurrency: replayed.realizedPnlCurrency,
      };
    });
    if (candidate && candidateCashEntry) {
      store.accounting.facts.tradeEvents.push(structuredClone(candidate));
    }
    if (newAction) {
      store.accounting.facts.positionActions.push(structuredClone(newAction));
    }
    const replacedTradeIds = new Set([
      ...currentStore.accounting.facts.tradeEvents.filter(isStoredScopedTrade).map((trade) => trade.id),
      ...scopeTradeIds,
      ...(input.deletedTradeEventIds ?? []),
    ]);
    store.accounting.facts.cashLedgerEntries = [
      ...store.accounting.facts.cashLedgerEntries.filter(
        (entry) => !entry.relatedTradeEventId || !replacedTradeIds.has(entry.relatedTradeEventId),
      ),
      ...structuredClone(accounting.facts.cashLedgerEntries.filter(
        (entry) => entry.relatedTradeEventId && scopeTradeIds.has(entry.relatedTradeEventId),
      )),
    ];

    store.accounting.projections.lotAllocations = [
      ...store.accounting.projections.lotAllocations.filter(
        (allocation) => allocation.accountId !== input.accountId || allocation.ticker !== input.ticker,
      ),
      ...structuredClone(scopeAllocations),
    ];
    store.accounting.projections.lots = [
      ...store.accounting.projections.lots.filter(
        (lot) => lot.accountId !== input.accountId || lot.ticker !== input.ticker,
      ),
      ...structuredClone(scopeLots),
    ];
    const appliedDividendChanges: DividendLedgerRecomputeChange[] = [];
    for (const change of input.dividendLedgerChanges ?? []) {
      const entryIndex = store.accounting.facts.dividendLedgerEntries.findIndex(
        (entry) => entry.id === change.ledgerEntryId && entry.accountId === change.accountId,
      );
      if (change.changeKind === "created") {
        if (entryIndex >= 0) throw new Error(`dividend ledger entry ${change.ledgerEntryId} already exists`);
        store.accounting.facts.dividendLedgerEntries.push(structuredClone(change.nextEntry));
        appliedDividendChanges.push(change);
        continue;
      }
      if (entryIndex < 0) throw new Error(`dividend ledger entry ${change.ledgerEntryId} not found`);
      if (store.accounting.facts.dividendLedgerEntries[entryIndex]!.version !== change.previousVersion) {
        throw new Error(`dividend ledger entry ${change.ledgerEntryId} version changed before replay commit`);
      }
      store.accounting.facts.dividendLedgerEntries[entryIndex] = structuredClone(change.nextEntry);
      appliedDividendChanges.push(change);
    }
    rebuildHoldingProjection(store);
    const assertUniqueIds = <T extends { id: string }>(records: T[], kind: string) => {
      const ids = new Set<string>();
      for (const record of records) {
        if (ids.has(record.id)) throw new Error(`duplicate ${kind} id ${record.id}`);
        ids.add(record.id);
      }
    };
    assertUniqueIds(store.accounting.facts.tradeEvents, "trade event");
    assertUniqueIds(store.accounting.facts.cashLedgerEntries, "cash ledger entry");
    assertUniqueIds(store.accounting.facts.positionActions, "position action");
    assertUniqueIds(store.accounting.projections.lots, "lot");
    assertUniqueIds(store.accounting.projections.lotAllocations, "lot allocation");
    const accountIds = new Set(store.accounts.map((account) => account.id));
    const tradeIds = new Set(store.accounting.facts.tradeEvents.map((trade) => trade.id));
    const lotIds = new Set(store.accounting.projections.lots.map((lot) => lot.id));
    if (store.accounting.facts.tradeEvents.some((trade) => !accountIds.has(trade.accountId))) {
      throw new Error("trade event references unknown account");
    }
    if (store.accounting.facts.cashLedgerEntries.some((entry) => !accountIds.has(entry.accountId))) {
      throw new Error("cash ledger entry references unknown account");
    }
    if (store.accounting.facts.positionActions.some((action) => !accountIds.has(action.accountId))) {
      throw new Error("position action references unknown account");
    }
    if (store.accounting.projections.lots.some((lot) => !accountIds.has(lot.accountId))) {
      throw new Error("lot references unknown account");
    }
    if (store.accounting.projections.lotAllocations.some((allocation) =>
      !accountIds.has(allocation.accountId)
      || !tradeIds.has(allocation.tradeEventId)
      || !lotIds.has(allocation.lotId))) {
      throw new Error("lot allocation references unknown accounting fact");
    }
    this.stores.set(userId, store);
    const revisionKey = `${userId}:${input.accountId}`;
    this.accountAccountingRevisions.set(
      revisionKey,
      (this.accountAccountingRevisions.get(revisionKey) ?? 0) + 1,
    );
    return appliedDividendChanges;
  }

  async savePostedDividend(
    userId: string,
    accounting: AccountingStore,
    marketData: MarketDataFacts,
    dividendLedgerEntryId: string,
  ): Promise<void> {
    const store = await this.loadStore(userId);
    const existingDividendLedgerEntry = store.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === dividendLedgerEntryId,
    );
    if (existingDividendLedgerEntry && existingDividendLedgerEntry.postingStatus !== "expected") {
      throw routeError(409, "dividend_conflict", "Dividend posting requires an active expected entry");
    }

    store.accounting = accounting;
    store.marketData = marketData;
    syncInstruments(store);
    this.stores.set(userId, store);
  }

  async replaceDividendSourceLinesForLedger(userId: string, ledgerEntryId: string, sourceLines: DividendSourceLine[]): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting.facts.dividendSourceLines = [
      ...store.accounting.facts.dividendSourceLines.filter((entry) => entry.dividendLedgerEntryId !== ledgerEntryId),
      ...sourceLines,
    ];
  }

  async findDividendLedgerEntryById(userId: string, dividendLedgerEntryId: string) {
    const store = await this.loadStore(userId);
    const accountIds = new Set(store.accounts.filter((account) => account.userId === userId).map((account) => account.id));
    return store.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === dividendLedgerEntryId && accountIds.has(entry.accountId),
    ) ?? null;
  }

  async getDividendLedgerEntryWithDetails(userId: string, dividendLedgerEntryId: string) {
    const store = await this.loadStore(userId);
    const accountIds = new Set(store.accounts.filter((account) => account.userId === userId).map((account) => account.id));
    const entry = store.accounting.facts.dividendLedgerEntries.find(
      (candidate) => candidate.id === dividendLedgerEntryId && accountIds.has(candidate.accountId),
    );
    if (!entry) return null;
    return {
      ...entry,
      deductions: store.accounting.facts.dividendDeductionEntries.filter(
        (deduction) => deduction.dividendLedgerEntryId === entry.id,
      ),
      sourceLines: store.accounting.facts.dividendSourceLines.filter(
        (line) => line.dividendLedgerEntryId === entry.id,
      ),
    };
  }

  async getDividendReviewRowDetail(userId: string, dividendLedgerEntryId: string) {
    const { rows, store } = await this.buildDividendReviewRows(userId, {});
    const row = rows.find((candidate) => candidate.id === dividendLedgerEntryId && candidate.rowKind === "ledger");
    if (!row) return null;
    const detail = enrichDividendReviewRows(store, [row])[0] ?? null;
    if (!detail) return null;
    const calculationHistory = store.accounting.facts.dividendCalculationVersions
      .filter((item) =>
        item.userId === userId
        && item.accountId === detail.accountId
        && item.dividendEventId === detail.dividendEventId,
      )
      .sort(compareDividendCalculationVersionsDesc)
      .map(mapDividendCalculationVersionDto);
    detail.calculationHistory = calculationHistory;
    detail.activeCalculation = calculationHistory.find(
      (item) => item.status === "confirmed" || item.status === "amended",
    ) ?? null;
    detail.provider = detail.activeCalculation?.provider ?? null;
    const expectedStockQuantity =
      detail.eventType !== "CASH" && detail.expectedStockCalcState === "needs_action"
        ? null
        : detail.expectedStockQuantity;
    return {
      ...detail,
      expectedStockQuantity,
      stockVarianceQuantity:
        detail.eventType !== "CASH" && expectedStockQuantity != null
          ? detail.receivedStockQuantity - expectedStockQuantity
          : null,
    };
  }

  async updateDividendReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: Store["accounting"]["facts"]["dividendLedgerEntries"][number]["reconciliationStatus"],
    note?: string | null,
    expectedVersion?: number,
  ) {
    const entry = await this.findDividendLedgerEntryById(userId, dividendLedgerEntryId);
    if (!entry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }

    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      throw routeError(409, "dividend_version_conflict", "Dividend has been updated by another request");
    }

    if (!["posted", "adjusted"].includes(entry.postingStatus)) {
      throw routeError(409, "reconciliation_requires_posted_status", "Dividend must be posted before reconciliation changes");
    }

    const normalizedNote = note?.trim();
    if (status === "explained" && !normalizedNote) {
      throw routeError(400, "reconciliation_note_required", "A note is required when reconciliation stays explained");
    }

    entry.reconciliationStatus = status;
    entry.version += 1;
    entry.reconciliationNote = normalizedNote || entry.reconciliationNote;

    return entry;
  }

  async updateDividendStockReconciliationStatus(
    userId: string,
    dividendLedgerEntryId: string,
    status: NonNullable<Store["accounting"]["facts"]["dividendLedgerEntries"][number]["stockReconciliationStatus"]>,
    note?: string | null,
    expectedVersion?: number,
    auditInput?: Omit<AuditLogInput, "action" | "targetUserId">,
  ) {
    const store = await this.loadStore(userId);
    const entry = await this.findDividendLedgerEntryById(userId, dividendLedgerEntryId);
    if (!entry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    if (expectedVersion !== undefined && entry.version !== expectedVersion) {
      throw routeError(409, "dividend_version_conflict", "Dividend has been updated by another request");
    }
    if (!["posted", "adjusted"].includes(entry.postingStatus)) {
      throw routeError(409, "stock_reconciliation_requires_posted_status", "Dividend must be posted before stock reconciliation changes");
    }
    const event = store.marketData.dividendEvents.find((candidate) => candidate.id === entry.dividendEventId);
    if (!event || event.eventType === "CASH") {
      throw routeError(409, "stock_reconciliation_requires_stock_event", "Stock reconciliation is only available for stock-bearing dividends");
    }
    const normalizedNote = note?.trim();
    if (status === "explained" && !normalizedNote) {
      throw routeError(400, "stock_reconciliation_note_required", "A note is required when stock reconciliation stays explained");
    }
    entry.stockReconciliationStatus = status;
    entry.stockReconciliationNote = note === undefined
      ? (entry.stockReconciliationNote ?? null)
      : (normalizedNote || null);
    entry.version += 1;
    if (auditInput) {
      await this.appendAuditLog({
        ...auditInput,
        action: "dividend_stock_reconciliation_updated",
        targetUserId: userId,
        metadata: {
          ...(auditInput.metadata ?? {}),
          mutation: "dividend_stock_reconciliation_updated",
          dividendLedgerEntryId,
          dividendEventId: entry.dividendEventId,
          accountId: entry.accountId,
          stockReconciliationStatus: entry.stockReconciliationStatus,
        },
      });
    }
    return entry;
  }

  async updatePostedCashDividend(userId: string, input: UpdatePostedCashDividendInput) {
    const store = await this.loadStore(userId);
    const originalDividendLedgerEntryId = input.originalDividendLedgerEntryId ?? input.dividendLedgerEntry.id;
    const entryIndex = store.accounting.facts.dividendLedgerEntries.findIndex((entry) => entry.id === originalDividendLedgerEntryId);
    if (entryIndex === -1) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    const currentEntry = store.accounting.facts.dividendLedgerEntries[entryIndex]!;
    if (currentEntry.version !== input.expectedVersion) {
      throw routeError(409, "dividend_version_conflict", "Dividend has been updated by another request");
    }
    if (currentEntry.postingStatus !== "posted") {
      throw routeError(409, "dividend_update_requires_posted_status", "Only posted dividends can be edited in place");
    }

    const dividendEvent = store.marketData.dividendEvents.find((event) => event.id === currentEntry.dividendEventId);
    if (!dividendEvent) {
      throw routeError(404, "dividend_event_not_found", "Dividend event not found");
    }

    const nextEntries = input.dividendLedgerEntries ?? [{
      ...input.dividendLedgerEntry,
      version: input.expectedVersion + 1,
      reconciliationStatus: "open" as const,
      reconciliationNote: undefined,
    }];
    const nextEntryIds = new Set(nextEntries.map((entry) => entry.id));
    store.accounting.facts.dividendLedgerEntries = [
      ...store.accounting.facts.dividendLedgerEntries.filter((entry) => !nextEntryIds.has(entry.id)),
      ...nextEntries,
    ];
    const childLedgerEntryIdsToReplace = new Set(input.replaceChildRowsForDividendLedgerEntryIds ?? [input.dividendLedgerEntry.id]);
    store.accounting.facts.dividendDeductionEntries = [
      ...store.accounting.facts.dividendDeductionEntries.filter((entry) => !childLedgerEntryIdsToReplace.has(entry.dividendLedgerEntryId)),
      ...input.dividendDeductions,
    ];
    store.accounting.facts.dividendSourceLines = [
      ...store.accounting.facts.dividendSourceLines.filter((entry) => !childLedgerEntryIdsToReplace.has(entry.dividendLedgerEntryId)),
      ...input.dividendSourceLines,
    ];
    store.accounting.facts.cashLedgerEntries = [
      ...store.accounting.facts.cashLedgerEntries.filter((entry) => !entry.relatedDividendLedgerEntryId || !childLedgerEntryIdsToReplace.has(entry.relatedDividendLedgerEntryId)),
      ...input.linkedCashEntries,
    ];
    const positionActionLedgerEntryIdsToReplace = new Set(input.replacePositionActionsForDividendLedgerEntryIds ?? [input.dividendLedgerEntry.id]);
    const positionActionIdsToUpsert = new Set(input.positionActions.map((action) => action.id));
    store.accounting.facts.positionActions = [
      ...store.accounting.facts.positionActions.filter((action) => {
        if (positionActionIdsToUpsert.has(action.id)) return false;
        if (!action.relatedDividendLedgerEntryId) return true;
        return !positionActionLedgerEntryIdsToReplace.has(action.relatedDividendLedgerEntryId);
      }),
      ...input.positionActions,
    ];
    if (dividendEvent) {
      store.accounting.projections.lots = [
        ...store.accounting.projections.lots.filter(
          (lot) => lot.accountId !== input.dividendLedgerEntry.accountId || lot.ticker !== dividendEvent.ticker,
        ),
        ...input.lots,
      ];
      rebuildHoldingProjection(store);
    }
    return input.dividendLedgerEntry;
  }

  async listDividendLedgerScopes(): Promise<Array<{ userId: string; accountId: string; ticker: string }>> {
    const out: Array<{ userId: string; accountId: string; ticker: string }> = [];
    const seen = new Set<string>();
    for (const [userId, store] of this.stores.entries()) {
      const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event.ticker]));
      const supersededIds = new Set(
        store.accounting.facts.dividendLedgerEntries
          .map((entry) => entry.reversalOfDividendLedgerEntryId)
          .filter((id): id is string => Boolean(id)),
      );
      for (const entry of store.accounting.facts.dividendLedgerEntries) {
        if (entry.reversalOfDividendLedgerEntryId) continue;
        if (entry.supersededAt) continue;
        if (supersededIds.has(entry.id)) continue;
        const ticker = eventById.get(entry.dividendEventId);
        if (!ticker) continue;
        const key = `${userId}:${entry.accountId}:${ticker}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ userId, accountId: entry.accountId, ticker });
      }
    }
    return out;
  }

  async applyDividendLedgerRecompute(
    userId: string,
    changes: DividendLedgerRecomputeChange[],
  ): Promise<DividendLedgerRecomputeChange[]> {
    if (changes.length === 0) return [];
    const store = await this.loadStore(userId);
    const applied: DividendLedgerRecomputeChange[] = [];

    for (const change of changes) {
      const entryIndex = store.accounting.facts.dividendLedgerEntries.findIndex(
        (candidate) => candidate.id === change.ledgerEntryId && candidate.accountId === change.accountId,
      );
      if (change.changeKind === "created") {
        if (entryIndex >= 0) continue;
        store.accounting.facts.dividendLedgerEntries.push(structuredClone(change.nextEntry));
        applied.push(change);
        continue;
      }
      if (entryIndex < 0) continue;
      const entry = store.accounting.facts.dividendLedgerEntries[entryIndex]!;
      // Idempotency guard: if a concurrent write already moved the entry
      // forward past our previousVersion, skip — the next replay will
      // resynchronize.
      if (entry.version !== change.previousVersion) continue;

      store.accounting.facts.dividendLedgerEntries[entryIndex] = structuredClone(change.nextEntry);
      applied.push(change);
    }

    return applied;
  }

  async listDividendEventsByPaymentDate(
    userId: string,
    fromPaymentDate?: string,
    toPaymentDate?: string,
    limit: number = 500,
    marketCode?: MarketCode,
  ) {
    const store = await this.loadStore(userId);
    void userId;
    return store.marketData.dividendEvents
      .filter((event) => matchesNullableDateRange(event.paymentDate, fromPaymentDate, toPaymentDate))
      .filter((event) => !marketCode || (event.marketCode ?? marketCodeFor(event.cashDividendCurrency)) === marketCode)
      .sort(compareNullablePaymentDates)
      .slice(0, limit);
  }

  async listDividendCalendarSnapshot(
    userId: string,
    opts: DividendCalendarSnapshotOptions,
  ) {
    const store = this.stores.get(userId) ?? await this.loadStore(userId);
    const reversedIds = new Set(
      store.accounting.facts.dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );
    const reversedTradeIds = new Set(
      store.accounting.facts.tradeEvents
        .map((trade) => trade.reversalOfTradeEventId)
        .filter((id): id is string => Boolean(id)),
    );
    const eligibleAccountIds = store.accounts
      .filter((account) => account.userId === userId)
      .filter((account) => !opts.accountId || account.id === opts.accountId)
      .map((account) => account.id);
    const accountHasCalendarEvent = (event: Store["marketData"]["dividendEvents"][number]): boolean => {
      if (eligibleAccountIds.length === 0) return false;
      const hasActiveLedgerEntry = store.accounting.facts.dividendLedgerEntries.some((entry) =>
        eligibleAccountIds.includes(entry.accountId) &&
        entry.dividendEventId === event.id &&
        !entry.reversalOfDividendLedgerEntryId &&
        !entry.supersededAt &&
        !reversedIds.has(entry.id),
      );
      if (hasActiveLedgerEntry) return true;
      const eventMarketCode = dividendEventMarketCode(event);
      return eligibleAccountIds.some((accountId) => {
        const eligibleQuantity = store.accounting.facts.tradeEvents
          .filter((trade) => trade.accountId === accountId)
          .filter((trade) => trade.ticker === event.ticker && trade.marketCode === eventMarketCode)
          .filter((trade) => trade.tradeDate < event.exDividendDate)
          .filter((trade) => !trade.reversalOfTradeEventId)
          .filter((trade) => !reversedTradeIds.has(trade.id))
          .reduce((sum, trade) => sum + (trade.type === "BUY" ? trade.quantity : -trade.quantity), 0);
        if (eligibleQuantity > 0) return true;
        return store.accounting.facts.positionActions.some((action) =>
          action.accountId === accountId
          && action.ticker === event.ticker
          && action.marketCode === eventMarketCode
          && action.actionDate < event.exDividendDate
          && !action.reversalOfPositionActionId
          && !action.supersededAt,
        );
      });
    };
    const highlightDates = opts.highlightLocalDates == null ? null : new Set(opts.highlightLocalDates);
    const dividendEvents = store.marketData.dividendEvents
      .filter((event) => highlightDates
        ? (event.paymentDate != null && highlightDates.has(event.paymentDate)) || highlightDates.has(event.exDividendDate)
        : event.paymentDate != null || opts.includeUndated)
      .filter((event) => highlightDates || matchesNullableDateRange(event.paymentDate, opts.fromPaymentDate, opts.toPaymentDate))
      .filter((event) => !opts.marketCode || dividendEventMarketCode(event) === opts.marketCode)
      .filter((event) => !opts.ticker || event.ticker === opts.ticker)
      .filter((event) => accountHasCalendarEvent(event))
      .sort(compareNullablePaymentDates)
      .slice(0, opts.limit);
    const eventIds = new Set(dividendEvents.map((event) => event.id));

    const receivedByLedgerId = new Map<string, number>();
    for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
      if (cashEntry.entryType !== "DIVIDEND_RECEIPT") continue;
      const ledgerId = cashEntry.relatedDividendLedgerEntryId;
      if (!ledgerId) continue;
      receivedByLedgerId.set(ledgerId, (receivedByLedgerId.get(ledgerId) ?? 0) + cashEntry.amount);
    }

    const ledgerEntries = store.accounting.facts.dividendLedgerEntries
      .filter((entry) => {
        if (!eventIds.has(entry.dividendEventId)) return false;
        if (entry.reversalOfDividendLedgerEntryId) return false;
        if (entry.supersededAt) return false;
        if (reversedIds.has(entry.id)) return false;
        if (opts.accountId && entry.accountId !== opts.accountId) return false;
        return true;
      })
      .sort((left, right) => {
        const leftEvent = dividendEvents.find((event) => event.id === left.dividendEventId);
        const rightEvent = dividendEvents.find((event) => event.id === right.dividendEventId);
        return compareNullablePaymentDates(leftEvent, rightEvent) || left.id.localeCompare(right.id);
      })
      .map((entry) => ({
        ...entry,
        receivedCashAmount: receivedByLedgerId.get(entry.id) ?? 0,
        deductions: store.accounting.facts.dividendDeductionEntries.filter(
          (deduction) => deduction.dividendLedgerEntryId === entry.id,
        ),
        sourceLines: store.accounting.facts.dividendSourceLines.filter(
          (line) => line.dividendLedgerEntryId === entry.id,
        ),
      }));

    const eventPairs = new Set(dividendEvents.map((event) => `${dividendEventMarketCode(event)}:${event.ticker}`));
    const accountIds = opts.accountId ? new Set([opts.accountId]) : new Set(store.accounts.map((account) => account.id));

    return {
      dividendEvents,
      ledgerEntries,
      accounts: store.accounts.filter((account) => accountIds.has(account.id)),
      instruments: store.instruments.filter((instrument) => eventPairs.has(`${instrument.marketCode}:${instrument.ticker}`)),
      tradeEvents: store.accounting.facts.tradeEvents
        .filter((trade) => accountIds.has(trade.accountId))
        .filter((trade) => eventPairs.has(`${trade.marketCode}:${trade.ticker}`))
        .filter((trade) => !trade.reversalOfTradeEventId)
        .filter((trade) => !reversedTradeIds.has(trade.id)),
      positionActions: store.accounting.facts.positionActions
        .filter((action) => accountIds.has(action.accountId))
        .filter((action) => eventPairs.has(`${action.marketCode}:${action.ticker}`)),
    };
  }

  async listDividendDailyHighlightsSnapshot(
    userId: string,
    opts: DividendDailyHighlightsSnapshotOptions,
  ) {
    return this.listDividendCalendarSnapshot(userId, {
      accountId: opts.accountId,
      marketCode: opts.marketCode,
      highlightLocalDates: opts.localDates,
      limit: 500,
    });
  }

  async listDividendLedgerEntries(
    userId: string,
    opts: DividendLedgerListOptions,
  ): Promise<DividendLedgerListResult> {
    const store = await this.loadStore(userId);
    const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    const accountById = new Map(store.accounts.map((account) => [account.id, account]));

    // Sum received cash amounts from DIVIDEND_RECEIPT cash ledger entries,
    // keyed by relatedDividendLedgerEntryId. Matches postgres receipts subquery.
    const receivedByLedgerId = new Map<string, number>();
    for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
      if (cashEntry.entryType !== "DIVIDEND_RECEIPT") continue;
      const ledgerId = cashEntry.relatedDividendLedgerEntryId;
      if (!ledgerId) continue;
      receivedByLedgerId.set(ledgerId, (receivedByLedgerId.get(ledgerId) ?? 0) + cashEntry.amount);
    }

    // Entries reversed by a later entry are inactive even if their own
    // supersededAt is still null — matches the NOT EXISTS reversal subquery.
    const reversedIds = new Set(
      store.accounting.facts.dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );

    const filtered = store.accounting.facts.dividendLedgerEntries.filter((entry) => {
      if (entry.reversalOfDividendLedgerEntryId) return false;
      if (entry.supersededAt) return false;
      if (reversedIds.has(entry.id)) return false;
      if (opts.accountId && entry.accountId !== opts.accountId) return false;
      const event = eventById.get(entry.dividendEventId);
      if (opts.marketCode && (!event || dividendEventMarketCode(event) !== opts.marketCode)) return false;
      const hasDates = opts.fromPaymentDate != null || opts.toPaymentDate != null;
      if (hasDates) {
        if (!matchesNullableDateRange(event?.paymentDate ?? null, opts.fromPaymentDate, opts.toPaymentDate)) return false;
      } else {
        // No date params: exclude TBD entries (null payment_date)
        if ((event?.paymentDate ?? null) == null) return false;
      }
      if (opts.reconciliationStatus && entry.reconciliationStatus !== opts.reconciliationStatus) return false;
      if (opts.postingStatus && entry.postingStatus !== opts.postingStatus) return false;
      if (opts.ticker && event?.ticker !== opts.ticker) return false;
      return true;
    });

    // Compute aggregates over the full filtered set BEFORE slicing.
    const aggregates: DividendLedgerAggregates = {
      totalExpectedCashAmount: {},
      totalReceivedCashAmount: {},
      openCount: 0,
      byMonth: {},
      byTicker: {},
    };
    for (const entry of filtered) {
      const event = eventById.get(entry.dividendEventId);
      if (!event) continue;
      const currency = event.cashDividendCurrency;
      const expected = entry.expectedCashAmount;
      const received = receivedByLedgerId.get(entry.id) ?? 0;

      aggregates.totalExpectedCashAmount[currency] =
        (aggregates.totalExpectedCashAmount[currency] ?? 0) + expected;
      aggregates.totalReceivedCashAmount[currency] =
        (aggregates.totalReceivedCashAmount[currency] ?? 0) + received;
      if (entry.reconciliationStatus === "open") aggregates.openCount += 1;

      if (event.paymentDate) {
        const monthKey = event.paymentDate.substring(0, 7);
        const monthBucket = (aggregates.byMonth[monthKey] ??= {});
        const monthCurrencyBucket = (monthBucket[currency] ??= { expected: 0, received: 0 });
        monthCurrencyBucket.expected += expected;
        monthCurrencyBucket.received += received;
      }

      const tickerBucket = (aggregates.byTicker[event.ticker] ??= {});
      const tickerCurrencyBucket = (tickerBucket[currency] ??= { expected: 0, received: 0 });
      tickerCurrencyBucket.expected += expected;
      tickerCurrencyBucket.received += received;
    }

    // Sort full filtered set before pagination slice.
    const orderFactor = opts.sortOrder === "asc" ? 1 : -1;
    const sorted = filtered.slice().sort((left, right) => {
      const leftEvent = eventById.get(left.dividendEventId);
      const rightEvent = eventById.get(right.dividendEventId);
      let cmp = 0;
      switch (opts.sortBy) {
        case "paymentDate":
          cmp = compareNullablePaymentDates(leftEvent, rightEvent);
          break;
        case "ticker":
          cmp = (leftEvent?.ticker ?? "").localeCompare(rightEvent?.ticker ?? "");
          break;
        case "account": {
          const leftName = accountById.get(left.accountId)?.name ?? "";
          const rightName = accountById.get(right.accountId)?.name ?? "";
          cmp = leftName.localeCompare(rightName);
          break;
        }
        case "expectedCashAmount":
          cmp = left.expectedCashAmount - right.expectedCashAmount;
          break;
        case "receivedCashAmount": {
          const leftReceived = receivedByLedgerId.get(left.id) ?? 0;
          const rightReceived = receivedByLedgerId.get(right.id) ?? 0;
          cmp = leftReceived - rightReceived;
          break;
        }
        case "reconciliationStatus":
          cmp = left.reconciliationStatus.localeCompare(right.reconciliationStatus);
          break;
      }
      if (cmp !== 0) return cmp * orderFactor;
      // Stable final tiebreaker by id (direction-independent — matches
      // postgres `ORDER BY ..., dle.id ASC` tiebreaker).
      return left.id.localeCompare(right.id);
    });

    const total = sorted.length;
    const startIndex = (opts.page - 1) * opts.limit;
    const pageRows = sorted.slice(startIndex, startIndex + opts.limit);

    const ledgerEntries = pageRows.map((entry) => ({
      ...entry,
      receivedCashAmount: receivedByLedgerId.get(entry.id) ?? 0,
      deductions: store.accounting.facts.dividendDeductionEntries.filter(
        (deduction) => deduction.dividendLedgerEntryId === entry.id,
      ),
      sourceLines: store.accounting.facts.dividendSourceLines.filter(
        (line) => line.dividendLedgerEntryId === entry.id,
      ),
    }));

    return { ledgerEntries, total, aggregates };
  }

  private async buildDividendReviewRows(
    userId: string,
    opts: Omit<DividendReviewListOptions, "page" | "limit" | "sortBy" | "sortOrder">,
  ) {
    const store = await this.loadStore(userId);
    const selectedAccountIds = new Set(
      opts.accountIds?.length
        ? opts.accountIds
        : opts.accountId
          ? [opts.accountId]
          : [],
    );
    const selectedCashStatuses = new Set(
      opts.cashStatuses?.length
        ? opts.cashStatuses
        : [],
    );
    const selectedStockStatuses = new Set(
      opts.stockStatuses?.length
        ? opts.stockStatuses
        : [],
    );
    const selectedTickers = opts.tickers ?? ("ticker" in opts && typeof opts.ticker === "string" ? [opts.ticker] : undefined);
    const eventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    const accountById = new Map(store.accounts.map((account) => [account.id, account]));
    const receivedByLedgerId = new Map<string, number>();

    for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
      if (cashEntry.entryType !== "DIVIDEND_RECEIPT") continue;
      const ledgerId = cashEntry.relatedDividendLedgerEntryId;
      if (!ledgerId) continue;
      receivedByLedgerId.set(ledgerId, (receivedByLedgerId.get(ledgerId) ?? 0) + cashEntry.amount);
    }

    const reversedIds = new Set(
      store.accounting.facts.dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );

    const activeLedgerEntries = store.accounting.facts.dividendLedgerEntries.filter((entry) => {
      if (entry.reversalOfDividendLedgerEntryId) return false;
      if (entry.supersededAt) return false;
      if (reversedIds.has(entry.id)) return false;
      return true;
    });
    const activeLedgerKey = new Set(activeLedgerEntries.map((entry) => `${entry.accountId}:${entry.dividendEventId}`));
    const reversedTradeIds = new Set(
      store.accounting.facts.tradeEvents
        .map((trade) => trade.reversalOfTradeEventId)
        .filter((id): id is string => Boolean(id)),
    );

    const instrumentTypeFor = (ticker: string, cashCurrency: string): InstrumentType => {
      try {
        const marketCode = marketCodeFor(cashCurrency);
        return store.instruments.find(
          (instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode,
        )?.type ?? "STOCK";
      } catch {
        return "STOCK";
      }
    };
    const instrumentNameFor = (ticker: string, marketCode: MarketCode): string | null =>
      store.instruments.find((instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode)?.name
      ?? store.marketData.instruments.find((instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode)?.name
      ?? null;

    const dateFilterActive = opts.fromPaymentDate != null || opts.toPaymentDate != null;
    const matchesDateFilter = (paymentDate: string | null | undefined): boolean => {
      if (dateFilterActive) {
        return matchesNullableDateRange(paymentDate, opts.fromPaymentDate, opts.toPaymentDate);
      }
      return paymentDate != null;
    };

    const ledgerRows: DividendReviewRowWithDetails[] = activeLedgerEntries.flatMap((entry) => {
      if (selectedAccountIds.size > 0 && !selectedAccountIds.has(entry.accountId)) return [];
      if (opts.excludeExpected && entry.postingStatus === "expected") return [];
      if (opts.reconciliationStatus && entry.reconciliationStatus !== opts.reconciliationStatus) return [];
      if (opts.postingStatus && entry.postingStatus !== opts.postingStatus) return [];
      const event = eventById.get(entry.dividendEventId);
      if (!event) return [];
      const eventMarketCode = dividendEventMarketCode(event);
      const instrumentType = instrumentTypeFor(event.ticker, event.cashDividendCurrency);
      if (opts.sourceComposition === "pending" && !(
        (instrumentType === "ETF" || instrumentType === "BOND_ETF")
        && entry.sourceCompositionStatus === "unknown_pending_disclosure"
      )) return [];
      if (opts.marketCode && eventMarketCode !== opts.marketCode) return [];
      if (!matchesDateFilter(event.paymentDate)) return [];
      if (selectedTickers?.length && !selectedTickers.includes(event.ticker)) return [];
      const deductions = store.accounting.facts.dividendDeductionEntries.filter(
        (deduction) => deduction.dividendLedgerEntryId === entry.id,
      );
      const cashReconciliation = calculateDividendCashReconciliation({
        expectedGrossAmount: entry.expectedCashAmount,
        actualNetAmount: receivedByLedgerId.get(entry.id) ?? 0,
        deductions: this.summarizeDividendDeductions(deductions),
      });
      const stockEntitlement = resolveDividendStockEntitlement({
        eligibleQuantity: entry.eligibleQuantity,
        stockEntitlementRequired: event.eventType !== "CASH",
        stockDistributionRatio: event.stockDistributionRatio ?? null,
        stockDistributionRatioState: event.stockDistributionRatioState ?? "unresolved",
      });
      const activeCalculation = entry.activeCalculationId
        ? store.accounting.facts.dividendCalculationVersions.find((item) =>
            item.id === entry.activeCalculationId
            && !item.supersededAt
            && (item.status === "confirmed" || item.status === "amended"))
          ?? findActiveDividendCalculationVersion(store, entry.accountId, entry.dividendEventId)
        : findActiveDividendCalculationVersion(store, entry.accountId, entry.dividendEventId);
      const row: DividendReviewRowWithDetails = {
        ...entry,
        rowKind: "ledger",
        ticker: event.ticker,
        tickerName: instrumentNameFor(event.ticker, eventMarketCode),
        marketCode: eventMarketCode,
        instrumentType,
        eventType: event.eventType,
        exDividendDate: event.exDividendDate,
        paymentDate: event.paymentDate,
        cashCurrency: event.cashDividendCurrency,
        cashDividendPerShare: event.cashDividendPerShare,
        receivedCashAmount: receivedByLedgerId.get(entry.id) ?? 0,
        deductions,
        sourceLines: store.accounting.facts.dividendSourceLines.filter(
          (line) => line.dividendLedgerEntryId === entry.id,
        ),
        expectedStockQuantity: activeCalculation?.expectedWholeShares ?? entry.expectedStockQuantity,
        expectedStockDistributionRatio:
          activeCalculation?.ratio == null ? entry.expectedStockDistributionRatio : Number(activeCalculation.ratio),
        expectedStockParValueAmount:
          activeCalculation?.selectedParValue == null
            ? entry.expectedStockParValueAmount
            : Number(activeCalculation.selectedParValue),
        stockDistributionRatio:
          activeCalculation?.ratio == null ? stockEntitlement.stockDistributionRatio : Number(activeCalculation.ratio),
        stockDistributionRatioState: stockEntitlement.stockDistributionRatioState,
        expectedStockCalcState: activeCalculation ? "resolved" : stockEntitlement.expectedStockCalcState,
        nhiAmount: cashReconciliation.deductions.nhiAmount,
        bankFeeAmount: cashReconciliation.deductions.bankFeeAmount,
        otherDeductionAmount: cashReconciliation.deductions.otherDeductionAmount,
        expectedGrossAmount: cashReconciliation.expectedGrossAmount,
        expectedNetAmount: cashReconciliation.expectedNetAmount,
        actualNetAmount: cashReconciliation.actualNetAmount,
        varianceAmount: cashReconciliation.varianceAmount,
        provider: {
          value: event.stockProviderValue
            ?? (event.stockDistributionAmountRaw == null ? null : String(event.stockDistributionAmountRaw)),
          unit: event.stockProviderValueUnit ?? null,
          source: event.stockProviderSource ?? null,
          dataset: event.stockProviderDataset ?? null,
          authoritativeRatio: event.stockProviderAuthoritativeRatio ?? null,
        },
        activeCalculation: activeCalculation ? mapDividendCalculationVersionDto(activeCalculation) : null,
      };
      if (selectedCashStatuses.size > 0 && !selectedCashStatuses.has(row.cashReconciliationStatus ?? row.reconciliationStatus)) return [];
      const ledgerStockStatus = deriveDividendReviewStockStatus(row);
      if (selectedStockStatuses.size > 0 && (!ledgerStockStatus || !selectedStockStatuses.has(ledgerStockStatus))) return [];
      return [row];
    });

    const expectedRows: DividendReviewRowWithDetails[] = [];
    if (!opts.excludeExpected) {
      for (const account of store.accounts) {
        if (account.userId !== userId) continue;
        if (selectedAccountIds.size > 0 && !selectedAccountIds.has(account.id)) continue;

        for (const event of store.marketData.dividendEvents) {
          let eventMarketCode: MarketCode;
          try {
            eventMarketCode = dividendEventMarketCode(event);
          } catch {
            continue;
          }
          if (account.defaultCurrency !== event.cashDividendCurrency) continue;
          if (opts.marketCode && eventMarketCode !== opts.marketCode) continue;
          if (!matchesDateFilter(event.paymentDate)) continue;
          if (selectedTickers?.length && !selectedTickers.includes(event.ticker)) continue;
          if (opts.reconciliationStatus && opts.reconciliationStatus !== "open") continue;
          if (opts.postingStatus && opts.postingStatus !== "expected") continue;
          if (activeLedgerKey.has(`${account.id}:${event.id}`)) continue;
          const instrumentType = instrumentTypeFor(event.ticker, event.cashDividendCurrency);
          if (opts.sourceComposition === "pending" && instrumentType !== "ETF" && instrumentType !== "BOND_ETF") continue;

          const eligibleQuantity = deriveGeneratedDividendReviewEligibleQuantity(
            store,
            userId,
            account.id,
            event.ticker,
            eventMarketCode,
            event.exDividendDate,
            reversedTradeIds,
          );
          if (eligibleQuantity <= 0) continue;

          const cashReconciliation = calculateDividendCashReconciliation({
            expectedGrossAmount: Math.max(0, Math.round(eligibleQuantity * event.cashDividendPerShare + Number.EPSILON)),
            actualNetAmount: 0,
          });
          const stockEntitlement = resolveDividendStockEntitlement({
            eligibleQuantity,
            stockEntitlementRequired: event.eventType !== "CASH",
            stockDistributionRatio: event.stockDistributionRatio ?? null,
            stockDistributionRatioState: event.stockDistributionRatioState ?? "unresolved",
          });
          const activeCalculation = findActiveDividendCalculationVersion(store, account.id, event.id);
          const row: DividendReviewRowWithDetails = {
            id: `expected:${account.id}:${event.id}`,
            rowKind: "expected",
            accountId: account.id,
            dividendEventId: event.id,
            ticker: event.ticker,
            tickerName: instrumentNameFor(event.ticker, eventMarketCode),
            marketCode: eventMarketCode,
            instrumentType,
            eventType: event.eventType,
            exDividendDate: event.exDividendDate,
            paymentDate: event.paymentDate,
            cashCurrency: event.cashDividendCurrency,
            cashDividendPerShare: event.cashDividendPerShare,
            eligibleQuantity,
            expectedCashAmount: cashReconciliation.expectedGrossAmount,
            expectedStockQuantity: activeCalculation?.expectedWholeShares ?? stockEntitlement.expectedStockQuantity,
            receivedCashAmount: 0,
            receivedStockQuantity: 0,
            postingStatus: "expected",
            reconciliationStatus: "open",
            cashReconciliationStatus: "open",
            version: 0,
            sourceCompositionStatus: "unknown_pending_disclosure",
            deductions: [],
            sourceLines: [],
            activeCalculationId: activeCalculation?.id ?? null,
            stockDistributionRatio:
              activeCalculation?.ratio == null ? stockEntitlement.stockDistributionRatio : Number(activeCalculation.ratio),
            stockDistributionRatioState: stockEntitlement.stockDistributionRatioState,
            expectedStockCalcState: activeCalculation ? "resolved" : stockEntitlement.expectedStockCalcState,
            expectedStockDistributionRatio:
              activeCalculation?.ratio == null ? null : Number(activeCalculation.ratio),
            expectedStockParValueAmount:
              activeCalculation?.selectedParValue == null ? null : Number(activeCalculation.selectedParValue),
            nhiAmount: cashReconciliation.deductions.nhiAmount,
            bankFeeAmount: cashReconciliation.deductions.bankFeeAmount,
            otherDeductionAmount: cashReconciliation.deductions.otherDeductionAmount,
            expectedGrossAmount: cashReconciliation.expectedGrossAmount,
            expectedNetAmount: cashReconciliation.expectedNetAmount,
            actualNetAmount: cashReconciliation.actualNetAmount,
            varianceAmount: cashReconciliation.varianceAmount,
            provider: {
              value: event.stockProviderValue
                ?? (event.stockDistributionAmountRaw == null ? null : String(event.stockDistributionAmountRaw)),
              unit: event.stockProviderValueUnit ?? null,
              source: event.stockProviderSource ?? null,
              dataset: event.stockProviderDataset ?? null,
              authoritativeRatio: event.stockProviderAuthoritativeRatio ?? null,
            },
            activeCalculation: activeCalculation ? mapDividendCalculationVersionDto(activeCalculation) : null,
          };
          if (selectedCashStatuses.size > 0 && !selectedCashStatuses.has("open")) continue;
          const expectedStockStatus = deriveDividendReviewStockStatus(row);
          if (selectedStockStatuses.size > 0 && (!expectedStockStatus || !selectedStockStatuses.has(expectedStockStatus))) continue;
          expectedRows.push(row);
        }
      }
    }

    const rows = [...ledgerRows, ...expectedRows];
    const aggregates: DividendLedgerAggregates = {
      totalExpectedCashAmount: {},
      totalReceivedCashAmount: {},
      openCount: 0,
      byMonth: {},
      byTicker: {},
    };

    for (const row of rows) {
      const currency = row.cashCurrency;
      aggregates.totalExpectedCashAmount[currency] =
        (aggregates.totalExpectedCashAmount[currency] ?? 0) + row.expectedCashAmount;
      aggregates.totalReceivedCashAmount[currency] =
        (aggregates.totalReceivedCashAmount[currency] ?? 0) + row.receivedCashAmount;
      if (row.reconciliationStatus === "open") aggregates.openCount += 1;

      if (row.paymentDate) {
        const monthKey = row.paymentDate.substring(0, 7);
        const monthBucket = (aggregates.byMonth[monthKey] ??= {});
        const monthCurrencyBucket = (monthBucket[currency] ??= { expected: 0, received: 0 });
        monthCurrencyBucket.expected += row.expectedCashAmount;
        monthCurrencyBucket.received += row.receivedCashAmount;
      }

      const tickerBucket = (aggregates.byTicker[row.ticker] ??= {});
      const tickerCurrencyBucket = (tickerBucket[currency] ??= { expected: 0, received: 0 });
      tickerCurrencyBucket.expected += row.expectedCashAmount;
      tickerCurrencyBucket.received += row.receivedCashAmount;
    }

    return { rows, aggregates, store, accountById };
  }

  async listDividendReviewRows(
    userId: string,
    opts: DividendReviewListOptions,
  ): Promise<DividendReviewListResult> {
    const { rows, aggregates, store, accountById } = await this.buildDividendReviewRows(userId, opts);
    const sorted = rows.slice().sort((left, right) => {
      const cmp = compareDividendReviewRows(left, right, accountById, opts);
      if (cmp !== 0) return cmp;
      return left.id.localeCompare(right.id);
    });
    const total = sorted.length;
    const startIndex = (opts.page - 1) * opts.limit;
    const pageRows = sorted.slice(startIndex, startIndex + opts.limit);
    const enrichedRowsById = new Map(
      enrichDividendReviewRows(store, pageRows).map((row) => [row.id, row]),
    );
    const enrichedRows = pageRows.map((baseRow) => {
      const enrichedRow = enrichedRowsById.get(baseRow.id);
      if (!enrichedRow) return baseRow;
      return {
        ...baseRow,
        expectedStockQuantity:
          baseRow.eventType !== "CASH" && baseRow.expectedStockCalcState === "needs_action"
            ? null
            : baseRow.expectedStockQuantity,
        correctionMode: enrichedRow.correctionMode,
        amendmentBlockedReason: enrichedRow.amendmentBlockedReason,
        linkedPositionActionId: enrichedRow.linkedPositionActionId ?? null,
        linkedPositionActionStatus: enrichedRow.linkedPositionActionStatus ?? null,
        cashInLieuAmount: enrichedRow.cashInLieuAmount ?? null,
        parValueBaseAmount: enrichedRow.parValueBaseAmount ?? null,
        premiumBaseAmount: enrichedRow.premiumBaseAmount ?? null,
        nhiPremiumBaseAmount: enrichedRow.nhiPremiumBaseAmount ?? null,
        portfolioCostBasisAddedAmount: enrichedRow.portfolioCostBasisAddedAmount ?? null,
        snapshotRefreshStatus: enrichedRow.snapshotRefreshStatus ?? null,
        stockVarianceQuantity:
          baseRow.eventType !== "CASH" && baseRow.expectedStockCalcState !== "needs_action"
            ? baseRow.receivedStockQuantity - baseRow.expectedStockQuantity
            : null,
      };
    });
    return {
      rows: enrichedRows,
      total,
      aggregates,
    };
  }

  async listDividendReviewPrimary(
    userId: string,
    query: DividendReviewPrimaryQueryDto,
  ): Promise<DividendReviewPrimaryResult> {
    const dbStartedAt = performance.now();
    const { rows: allRows, accountById } = await this.buildDividendReviewRows(userId, query);
    const dbMs = performance.now() - dbStartedAt;
    const hydrationStartedAt = performance.now();
    const sorted = allRows.slice().sort((left, right) => {
      const cmp = compareDividendReviewRows(left, right, accountById, query);
      return cmp !== 0 ? cmp : left.id.localeCompare(right.id);
    });
    const startIndex = (query.page - 1) * query.limit;
    const rows = sorted.slice(startIndex, startIndex + query.limit).map((row): DividendReviewRowSummaryDto => ({
      rowKind: row.rowKind,
      id: row.id,
      version: row.version,
      accountId: row.accountId,
      accountName: accountById.get(row.accountId)?.name ?? null,
      dividendEventId: row.dividendEventId,
      ticker: row.ticker,
      tickerName: row.tickerName,
      marketCode: row.marketCode as DividendReviewRowSummaryDto["marketCode"],
      instrumentType: row.instrumentType,
      eventType: row.eventType,
      exDividendDate: row.exDividendDate,
      paymentDate: row.paymentDate,
      cashCurrency: row.cashCurrency,
      cashDividendPerShare: row.cashDividendPerShare,
      eligibleQuantity: row.eligibleQuantity,
      expectedCashAmount: row.expectedCashAmount,
      receivedCashAmount: row.receivedCashAmount,
      expectedStockQuantity: row.eventType !== "CASH" && row.expectedStockCalcState === "needs_action"
        ? null
        : row.expectedStockQuantity,
      receivedStockQuantity: row.receivedStockQuantity,
      postingStatus: row.postingStatus,
      cashReconciliationStatus: row.reconciliationStatus,
      stockReconciliationStatus: deriveDividendReviewStockStatus(row),
      stockReconciliationNote: row.reconciliationStatus === "explained" ? (row.reconciliationNote ?? null) : null,
      reconciliationStatus: row.reconciliationStatus,
      sourceCompositionStatus: row.sourceCompositionStatus,
      expectedGrossAmount: row.expectedGrossAmount,
      expectedNetAmount: row.expectedNetAmount,
      actualNetAmount: row.actualNetAmount,
      varianceAmount: row.varianceAmount,
      nhiAmount: row.nhiAmount,
      bankFeeAmount: row.bankFeeAmount,
      otherDeductionAmount: row.otherDeductionAmount,
      stockDistributionRatio: row.stockDistributionRatio,
      stockDistributionRatioState: row.stockDistributionRatioState,
      expectedStockCalcState: row.expectedStockCalcState,
      expectedStockParValueAmount: row.expectedStockParValueAmount,
      stockVarianceQuantity:
        row.eventType !== "CASH" && row.expectedStockCalcState !== "needs_action"
          ? row.receivedStockQuantity - row.expectedStockQuantity
          : null,
      cashInLieuAmount: row.cashInLieuAmount,
      provider: row.provider ?? null,
      activeCalculation: row.activeCalculation ?? null,
    }));
    return {
      rows,
      total: sorted.length,
      phaseTimings: { dbMs, hydrationMs: performance.now() - hydrationStartedAt },
    };
  }

  async getDividendReviewEnrichment(
    userId: string,
    filters: DividendReviewFilterDto,
  ): Promise<DividendReviewEnrichmentResult> {
    const dbStartedAt = performance.now();
    const { rows, aggregates } = await this.buildDividendReviewRows(userId, filters);
    const dbMs = performance.now() - dbStartedAt;
    const aggregateStartedAt = performance.now();

    const etfRows = rows.filter((row) => row.instrumentType === "ETF" || row.instrumentType === "BOND_ETF");
    const pendingCount = etfRows.filter(
      (row) => row.sourceCompositionStatus === "unknown_pending_disclosure",
    ).length;
    const nhiSubjectBuckets = new Set(["DIVIDEND_INCOME", "INTEREST_INCOME"]);
    const sourceBucketOrder = [
      "DIVIDEND_INCOME",
      "INTEREST_INCOME",
      "SECURITIES_GAIN_INCOME",
      "REVENUE_EQUALIZATION",
      "CAPITAL_EQUALIZATION",
      "CAPITAL_RETURN",
      "OTHER",
    ] as const;
    const amountByBucket = new Map<string, number>();
    let projectedPremium = 0;
    for (const row of etfRows) {
      for (const line of row.sourceLines) {
        amountByBucket.set(line.sourceBucket, (amountByBucket.get(line.sourceBucket) ?? 0) + line.amount);
      }
      if (row.sourceCompositionStatus !== "provided") continue;
      const perEntryNhiSubject = row.sourceLines
        .filter((line) => nhiSubjectBuckets.has(line.sourceBucket))
        .reduce((sum, line) => sum + line.amount, 0);
      if (perEntryNhiSubject >= 20_000) {
        projectedPremium += Math.round(perEntryNhiSubject * 0.0211 + Number.EPSILON);
      }
    }
    const bucketAggregates = sourceBucketOrder
      .filter((sourceBucket) => (amountByBucket.get(sourceBucket) ?? 0) > 0)
      .map((sourceBucket) => ({
        sourceBucket,
        totalAmount: amountByBucket.get(sourceBucket) ?? 0,
        isNhiSubject: nhiSubjectBuckets.has(sourceBucket),
      }));
    const enrichment: DividendReviewEnrichmentResult = {
      aggregates,
      nhiRollup: {
        bucketAggregates,
        nhiSubjectTotal: bucketAggregates
          .filter((bucket) => bucket.isNhiSubject)
          .reduce((sum, bucket) => sum + bucket.totalAmount, 0),
        projectedPremium,
        pendingCount,
        hasEtfEntries: etfRows.length > 0,
      },
      sourceComposition: {
        providedCount: rows.filter((row) => row.sourceCompositionStatus === "provided").length,
        pendingCount: rows.filter((row) => row.sourceCompositionStatus === "unknown_pending_disclosure").length,
      },
      hero: buildDividendReviewHeroAggregates(rows),
    };
    enrichment.phaseTimings = {
      dbMs,
      aggregateMs: performance.now() - aggregateStartedAt,
    };
    return enrichment;
  }

  async listDividendReviewMetadata(
    userId: string,
    filters: Partial<Pick<DividendReviewFilterDto, "accountIds" | "fromPaymentDate" | "toPaymentDate">> = {},
  ): Promise<DividendReviewMetadataResult> {
    const [store, { years }] = await Promise.all([
      this.loadStore(userId),
      this.listDividendLedgerYears(userId),
    ]);
    const { rows } = await this.buildDividendReviewRows(userId, filters);
    const eligibleTickers = [...new Set(rows.map((row) => row.ticker))]
      .map((ticker) => ({
        ticker,
        name: store.instruments.find((instrument) => instrument.ticker === ticker && instrument.name)?.name
          ?? rows.find((row) => row.ticker === ticker)?.tickerName
          ?? null,
      }))
      .sort((left, right) => left.ticker.localeCompare(right.ticker));
    return {
      years,
      accounts: store.accounts
        .filter((account) => account.userId === userId)
        .map(({ id, name }) => ({ id, name })),
      eligibleTickers,
    };
  }

  private summarizeDividendDeductions(
    deductions: readonly { deductionType: string; amount: number }[],
  ): { nhiAmount: number; bankFeeAmount: number; otherDeductionAmount: number } {
    let nhiAmount = 0;
    let bankFeeAmount = 0;
    let otherDeductionAmount = 0;

    for (const deduction of deductions) {
      if (deduction.deductionType === "NHI_SUPPLEMENTAL_PREMIUM") {
        nhiAmount += deduction.amount;
        continue;
      }
      if (deduction.deductionType === "BANK_FEE") {
        bankFeeAmount += deduction.amount;
        continue;
      }
      otherDeductionAmount += deduction.amount;
    }

    return { nhiAmount, bankFeeAmount, otherDeductionAmount };
  }

  async listCashLedgerEntries(
    userId: string,
    opts: CashLedgerListOptions,
  ): Promise<CashLedgerListResult> {
    const store = await this.loadStore(userId);

    // 1. Filter
    const filtered = store.accounting.facts.cashLedgerEntries.filter((entry) => {
      if (entry.userId !== userId) return false;
      if (opts.fromEntryDate && entry.entryDate < opts.fromEntryDate) return false;
      if (opts.toEntryDate && entry.entryDate > opts.toEntryDate) return false;
      if (opts.accountId && entry.accountId !== opts.accountId) return false;
      if (opts.entryType && !opts.entryType.includes(entry.entryType)) return false;
      return true;
    });

    // 2. Summary over full filtered set (NOT page slice)
    const summaryMap = new Map<string, { accountId: string; currency: string; amount: number }>();
    for (const entry of filtered) {
      const key = `${entry.accountId}:${entry.currency}`;
      const existing = summaryMap.get(key);
      if (existing) {
        existing.amount += entry.amount;
      } else {
        summaryMap.set(key, { accountId: entry.accountId, currency: entry.currency, amount: entry.amount });
      }
    }
    const summary = [...summaryMap.values()];

    // 3. Sort with tiebreaker
    const orderFactor = opts.sortOrder === "asc" ? 1 : -1;
    const sorted = filtered.slice().sort((left, right) => {
      let cmp = 0;
      switch (opts.sortBy) {
        case "entryDate":
          cmp = left.entryDate.localeCompare(right.entryDate);
          break;
        case "entryType":
          cmp = left.entryType.localeCompare(right.entryType);
          break;
        case "amount":
          cmp = left.amount - right.amount;
          break;
        case "currency":
          cmp = left.currency.localeCompare(right.currency);
          break;
        case "accountId":
          cmp = left.accountId.localeCompare(right.accountId);
          break;
      }
      if (cmp !== 0) return cmp * orderFactor;
      // Tiebreaker: bookedAt DESC NULLS LAST
      const leftBookedAt = left.bookedAt ?? "";
      const rightBookedAt = right.bookedAt ?? "";
      if (leftBookedAt || rightBookedAt) {
        if (!leftBookedAt) return 1; // null sorts last
        if (!rightBookedAt) return -1;
        const bookedCmp = rightBookedAt.localeCompare(leftBookedAt); // DESC
        if (bookedCmp !== 0) return bookedCmp;
      }
      // Final tiebreaker: id ASC
      return left.id.localeCompare(right.id);
    });

    // 4. Paginate
    const total = sorted.length;
    const startIndex = (opts.page - 1) * opts.limit;
    const entries = sorted.slice(startIndex, startIndex + opts.limit);

    return { entries, total, summary };
  }

  async listAccountsWithLiveBalances(userId: string): Promise<AccountWithLiveBalancesRecord[]> {
    const store = await this.loadStore(userId);
    const balancesByAccount = buildLiveBalancesByAccount(store);
    return store.accounts.map((account) => ({
      ...account,
      liveBalance: balancesByAccount.get(account.id) ?? [],
    }));
  }

  async listActiveAccounts(userId: string): Promise<import("@vakwen/shared-types").AccountDto[]> {
    const store = this.getOrCreateStore(userId);
    return store.accounts.map((account) => ({ ...account }));
  }

  async getCashLedgerEnrichment(
    userId: string,
    input: {
      accountIds: string[];
      relatedTradeEventIds: string[];
      relatedDividendLedgerEntryIds: string[];
      fxTransferIds: string[];
    },
  ): Promise<CashLedgerEnrichmentResult> {
    const store = await this.loadStore(userId);
    const requestedTradeIds = new Set(input.relatedTradeEventIds);
    const requestedDividendIds = new Set(input.relatedDividendLedgerEntryIds);
    const requestedFxTransferIds = new Set(input.fxTransferIds);

    const accountNamesById = new Map(
      store.accounts.map((account) => [account.id, account.name] as const),
    );

    const tradesById = new Map(
      store.accounting.facts.tradeEvents
        .filter((trade) => trade.userId === userId && requestedTradeIds.has(trade.id))
        .map((trade) => [trade.id, {
          id: trade.id,
          ticker: trade.ticker,
          side: trade.type,
          quantity: trade.quantity,
          unitPrice: trade.unitPrice,
          commissionAmount: trade.commissionAmount,
          taxAmount: trade.taxAmount,
        }] as const),
    );

    const dividendEventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
    const deductionTotals = new Map<string, number>();
    for (const deduction of store.accounting.facts.dividendDeductionEntries) {
      if (!requestedDividendIds.has(deduction.dividendLedgerEntryId)) continue;
      deductionTotals.set(
        deduction.dividendLedgerEntryId,
        (deductionTotals.get(deduction.dividendLedgerEntryId) ?? 0) + deduction.amount,
      );
    }
    const dividendsById = new Map(
      store.accounting.facts.dividendLedgerEntries
        .filter((entry) => requestedDividendIds.has(entry.id))
        .map((entry) => [entry.id, {
          id: entry.id,
          ticker: dividendEventById.get(entry.dividendEventId)?.ticker ?? null,
          expectedCashAmount: entry.expectedCashAmount,
          receivedCashAmount: entry.receivedCashAmount,
          deductionTotal: roundToDecimal(deductionTotals.get(entry.id) ?? 0, 2),
        }] as const),
    );

    const fxTransferLegsByTransferId = new Map<string, Array<{
      entryId: string;
      accountId: string;
      accountName: string;
      entryType: CashLedgerEntry["entryType"];
      amount: number;
      currency: string;
      reversalOfCashLedgerEntryId?: string;
    }>>();
    const reversedFxTransferIds = new Set<string>();
    for (const entry of store.accounting.facts.cashLedgerEntries) {
      if (!entry.fxTransferId || !requestedFxTransferIds.has(entry.fxTransferId)) continue;
      if (entry.reversalOfCashLedgerEntryId) {
        reversedFxTransferIds.add(entry.fxTransferId);
      }
      const legs = fxTransferLegsByTransferId.get(entry.fxTransferId) ?? [];
      legs.push({
        entryId: entry.id,
        accountId: entry.accountId,
        accountName: accountNamesById.get(entry.accountId) ?? entry.accountId,
        entryType: entry.entryType,
        amount: entry.amount,
        currency: entry.currency,
        reversalOfCashLedgerEntryId: entry.reversalOfCashLedgerEntryId,
      });
      fxTransferLegsByTransferId.set(entry.fxTransferId, legs);
    }

    return {
      accountNamesById,
      tradesById,
      dividendsById,
      fxTransferLegsByTransferId,
      reversedFxTransferIds,
    };
  }

  async listDividendLedgerYears(userId: string): Promise<{ years: number[] }> {
    const store = await this.loadStore(userId);
    const activeAccountIds = new Set(
      store.accounts
        .filter((account) => account.userId === userId)
        .map((account) => account.id),
    );
    const earliestOpenLotYear = store.accounting.projections.lots
      .filter((lot) => activeAccountIds.has(lot.accountId) && lot.openQuantity > 0)
      .map((lot) => parseInt(lot.openedAt.substring(0, 4), 10))
      .filter((year) => Number.isInteger(year))
      .sort((a, b) => a - b)[0];
    if (earliestOpenLotYear === undefined) return { years: [] };

    const currentYear = new Date().getUTCFullYear();
    const startYear = Math.min(earliestOpenLotYear, currentYear);
    return {
      years: Array.from({ length: currentYear - startYear + 1 }, (_, index) => startYear + index),
    };
  }

  async getTickerFundamentals(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<PersistedTickerFundamentalsRecord | null> {
    const record = this.tickerFundamentals.get(tickerFundamentalsKey(ticker, marketCode));
    return record ? mapMemoryTickerFundamentals(record) : null;
  }

  async saveTickerFundamentalsSnapshot(
    input: SaveTickerFundamentalsSnapshotInput,
  ): Promise<PersistedTickerFundamentalsRecord> {
    const key = tickerFundamentalsKey(input.ticker, input.marketCode);
    const existing = this.tickerFundamentals.get(key);
    const now = new Date().toISOString();
    const nextRecord: MemoryTickerFundamentalsRecord = {
      ticker: input.ticker,
      marketCode: input.marketCode,
      providerId: input.providerId,
      fundamentals: normalizeTickerFundamentals(input.fundamentals),
      refreshedAt: input.refreshedAt,
      nextRefreshAt: input.nextRefreshAt,
      lastAttemptedAt: input.refreshedAt,
      lastError: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.tickerFundamentals.set(key, nextRecord);
    return mapMemoryTickerFundamentals(nextRecord);
  }

  async recordTickerFundamentalsRefreshFailure(
    input: RecordTickerFundamentalsRefreshFailureInput,
  ): Promise<PersistedTickerFundamentalsRecord> {
    const key = tickerFundamentalsKey(input.ticker, input.marketCode);
    const existing = this.tickerFundamentals.get(key);
    const now = new Date().toISOString();
    const nextRecord: MemoryTickerFundamentalsRecord = {
      ticker: input.ticker,
      marketCode: input.marketCode,
      providerId: input.providerId,
      fundamentals: existing?.fundamentals ?? createEmptyTickerFundamentals(),
      refreshedAt: existing?.refreshedAt ?? null,
      nextRefreshAt: input.nextRefreshAt,
      lastAttemptedAt: input.attemptedAt,
      lastError: input.errorMessage,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.tickerFundamentals.set(key, nextRecord);
    return mapMemoryTickerFundamentals(nextRecord);
  }

  async claimIdempotencyKey(userId: string, key: string): Promise<boolean> {
    const existing = this.idempotencyKeys.get(userId) ?? new Set<string>();
    if (existing.has(key)) return false;
    existing.add(key);
    this.idempotencyKeys.set(userId, existing);
    return true;
  }

  async releaseIdempotencyKey(userId: string, key: string): Promise<void> {
    const existing = this.idempotencyKeys.get(userId);
    if (!existing) return;
    existing.delete(key);
    if (existing.size === 0) this.idempotencyKeys.delete(userId);
  }

  async getProfile(userId: string): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    // ui-reshape Phase 3d S7 — read user overrides from
    // user_preferences.preferences.userProfile JSONB. Returns null when
    // unset; the route/UI resolver falls back to provider values.
    const prefs = this.userPreferences.get(userId) ?? {};
    const userProfile = isPlainObject(prefs.userProfile) ? prefs.userProfile : {};
    const userDisplayName = typeof userProfile.displayName === "string"
      ? userProfile.displayName
      : null;
    const userPictureUrl = typeof userProfile.pictureUrl === "string"
      ? userProfile.pictureUrl
      : null;
    return {
      userId: memUser.id,
      email: memUser.email,
      displayName: memUser.displayName,
      providerPictureUrl: memUser.providerPictureUrl,
      providerDisplayName: memUser.providerDisplayName,
      userDisplayName,
      userPictureUrl,
      linkedAt: null,
      lastSeenAt: null,
      role: memUser.role,
      impersonation: null,
    };
  }

  async updateProfileEmail(userId: string, email: string): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    const normalizedEmail = normalizeEmail(email);
    // Re-key the map if email changed
    if (memUser.email !== normalizedEmail) {
      const existing = this.usersByEmail.get(normalizedEmail);
      if (existing && existing.id !== userId) {
        throw routeError(409, "email_conflict", "Email is already in use");
      }
      this.usersByEmail.delete(memUser.email);
      memUser.email = normalizedEmail;
      this.usersByEmail.set(normalizedEmail, memUser);
    }
    return this.getProfile(userId);
  }

  /**
   * ui-reshape Phase 3d S7 — store user-overridable profile fields in the
   * user_preferences JSONB blob under `userProfile`. Independent per-field
   * semantics: undefined = leave, null = clear, string = set.
   */
  async updateProfileFields(
    userId: string,
    fields: { displayName?: string | null; pictureUrl?: string | null },
  ): Promise<ProfileDto> {
    const memUser = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (!memUser) {
      throw routeError(404, "not_found", "Profile not found");
    }
    const prefs = this.userPreferences.get(userId) ?? {};
    const existingUserProfile = isPlainObject(prefs.userProfile)
      ? { ...prefs.userProfile }
      : {};
    if (fields.displayName !== undefined) {
      if (fields.displayName === null) {
        delete existingUserProfile.displayName;
      } else {
        existingUserProfile.displayName = fields.displayName;
      }
    }
    if (fields.pictureUrl !== undefined) {
      if (fields.pictureUrl === null) {
        delete existingUserProfile.pictureUrl;
      } else {
        existingUserProfile.pictureUrl = fields.pictureUrl;
      }
    }
    const next: Record<string, unknown> = { ...prefs };
    if (Object.keys(existingUserProfile).length === 0) {
      delete next.userProfile;
    } else {
      next.userProfile = existingUserProfile;
    }
    this.userPreferences.set(userId, next);
    return this.getProfile(userId);
  }

  async getLatestBars(tickers: string[], limit: number): Promise<DailyBar[]> {
    const tickerSet = new Set(tickers);
    const grouped = new Map<string, MemoryDailyBar[]>();
    for (const bar of this.dailyBars) {
      if (!tickerSet.has(bar.ticker)) continue;
      const list = grouped.get(bar.ticker) ?? [];
      list.push(bar);
      grouped.set(bar.ticker, list);
    }
    const result: DailyBar[] = [];
    for (const bars of grouped.values()) {
      bars.sort((a, b) => b.barDate.localeCompare(a.barDate));
      result.push(...bars.slice(0, limit));
    }
    return result;
  }

  async getLatestBarsByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
    limit: number,
  ): Promise<DailyBarWithMarket[]> {
    const pairKeys = new Set(pairs.map((pair) => `${pair.ticker}:${pair.marketCode}`));
    const grouped = new Map<string, MemoryDailyBar[]>();
    for (const bar of this.dailyBars) {
      const key = `${bar.ticker}:${bar.marketCode}`;
      if (!pairKeys.has(key)) continue;
      const list = grouped.get(key) ?? [];
      list.push(bar);
      grouped.set(key, list);
    }
    const result: DailyBarWithMarket[] = [];
    for (const bars of grouped.values()) {
      bars.sort((a, b) => b.barDate.localeCompare(a.barDate));
      result.push(...bars.slice(0, limit));
    }
    return result;
  }

  async getLatestIntradayOverlay(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<IntradayPriceOverlay | null> {
    return this.intradayOverlays.get(`${ticker}:${marketCode}`) ?? null;
  }

  async getLatestIntradayOverlays(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, IntradayPriceOverlay>> {
    const overlays = new Map<string, IntradayPriceOverlay>();
    for (const pair of pairs) {
      const key = `${pair.ticker}:${pair.marketCode}`;
      const overlay = this.intradayOverlays.get(key);
      if (overlay) overlays.set(key, overlay);
    }
    return overlays;
  }

  async setLatestIntradayOverlay(overlay: IntradayPriceOverlay): Promise<void> {
    this.intradayOverlays.set(`${overlay.ticker}:${overlay.marketCode}`, overlay);
  }

  async deleteLatestIntradayOverlay(ticker: string, marketCode: MarketCode): Promise<void> {
    this.intradayOverlays.delete(`${ticker}:${marketCode}`);
  }

  async getLatestBarDatesByTickerMarket(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    for (const p of pairs) result.set(`${p.ticker}:${p.marketCode}`, null);
    for (const bar of this.dailyBars) {
      const key = `${bar.ticker}:${bar.marketCode}`;
      if (!result.has(key)) continue;
      const current = result.get(key) ?? null;
      if (!current || bar.barDate > current) {
        result.set(key, bar.barDate);
      }
    }
    return result;
  }

  async getLatestBarDatesForReconciliation(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<Map<string, string | null>> {
    return this.getLatestBarDatesByTickerMarket(pairs);
  }

  async getDistinctBarDates(market: MarketCode, fromDate: string): Promise<string[]> {
    const dates = new Set<string>();
    for (const bar of this.dailyBars) {
      if (bar.marketCode !== market) continue;
      if (bar.barDate < fromDate) continue;
      dates.add(bar.barDate);
    }
    return [...dates].sort((a, b) => a.localeCompare(b));
  }

  _seedDailyBars(bars: SeedDailyBar[]): void {
    for (const bar of bars) {
      const next = {
        ...bar,
        marketCode: bar.marketCode ?? "TW",
        quality: bar.quality ?? "full_bar",
      };
      const existingIndex = this.dailyBars.findIndex((current) => (
        current.ticker === next.ticker
        && current.marketCode === next.marketCode
        && current.barDate === next.barDate
      ));
      if (existingIndex >= 0) {
        const existing = this.dailyBars[existingIndex]!;
        if (existing.quality === "full_bar" && next.quality === "close_only") continue;
        this.dailyBars[existingIndex] = next;
      } else {
        this.dailyBars.push(next);
      }
    }
  }
  _seedDividendEvents(events: DividendEvent[]): void {
    this.researchDividendEvents.length = 0;
    this.researchDividendEvents.push(...events.map((event) => ({ ...event })));
  }
  _clearDailyBars(): void { this.dailyBars.length = 0; }
  _seedHoldingSnapshots(snapshots: HoldingSnapshot[]): void { this.holdingSnapshots.push(...snapshots); }
  _clearHoldingSnapshots(): void { this.holdingSnapshots.length = 0; }
  _seedCurrencyWalletSnapshots(snapshots: CurrencyWalletSnapshot[]): void {
    this.currencyWalletSnapshots.push(...snapshots);
  }
  _clearCurrencyWalletSnapshots(): void { this.currencyWalletSnapshots.length = 0; }
  _getCurrencyWalletSnapshotsForUser(userId: string): CurrencyWalletSnapshot[] {
    return this.currencyWalletSnapshots
      .filter((snapshot) => snapshot.userId === userId)
      .slice()
      .sort((a, b) =>
        a.accountId.localeCompare(b.accountId)
        || a.currency.localeCompare(b.currency)
        || a.date.localeCompare(b.date),
      );
  }

  // KZO-164: FX rates (Frankfurter v2 ingestion). Memory backend is keyed by
  // `${date}:${baseCurrency}:${quoteCurrency}` so subsequent upserts overwrite
  // prior rows (matches Postgres `ON CONFLICT DO UPDATE` semantics).
  async upsertFxRates(rates: ReadonlyArray<FxRate>): Promise<number> {
    let count = 0;
    for (const r of rates) {
      // Mirror schema CHECK: callers must filter self-pairs first; defensive guard
      // keeps the in-memory store from accepting invalid rows that would crash Postgres.
      if (r.baseCurrency === r.quoteCurrency) continue;
      const key = `${r.date}:${r.baseCurrency}:${r.quoteCurrency}`;
      this.fxRates.set(key, { ...r });
      count++;
    }
    return count;
  }

  async getLatestFxRateDate(): Promise<string | null> {
    let latest: string | null = null;
    for (const r of this.fxRates.values()) {
      if (!latest || r.date > latest) latest = r.date;
    }
    return latest;
  }

  async getFxRateFreshness(): Promise<Array<{ baseCurrency: string; quoteCurrency: string; latestDate: string }>> {
    const grouped = new Map<string, { baseCurrency: string; quoteCurrency: string; latestDate: string }>();
    for (const r of this.fxRates.values()) {
      const key = `${r.baseCurrency}:${r.quoteCurrency}`;
      const existing = grouped.get(key);
      if (!existing || r.date > existing.latestDate) {
        grouped.set(key, { baseCurrency: r.baseCurrency, quoteCurrency: r.quoteCurrency, latestDate: r.date });
      }
    }
    return [...grouped.values()].sort((a, b) =>
      a.baseCurrency === b.baseCurrency
        ? a.quoteCurrency.localeCompare(b.quoteCurrency)
        : a.baseCurrency.localeCompare(b.baseCurrency),
    );
  }

  /** KZO-164 test-only — clear all FX rates (`beforeEach` use). */
  _resetFxRates(): void {
    this.fxRates.clear();
  }

  async getFxRate(base: string, quote: string, asOfDate: string): Promise<number | null> {
    return (await this.getResolvedFxRate(base, quote, asOfDate))?.rate ?? null;
  }

  async getResolvedFxRate(base: string, quote: string, asOfDate: string): Promise<ResolvedFxRate | null> {
    if (base === quote) return { rate: 1.0, asOfDate };
    const directRate = this.findLatestFxRateRow(base, quote, asOfDate);
    if (directRate !== null) return { rate: directRate.rate, asOfDate: directRate.date };

    const inverseRate = this.findLatestFxRateRow(quote, base, asOfDate);
    if (inverseRate !== null && inverseRate.rate !== 0) return { rate: 1 / inverseRate.rate, asOfDate: inverseRate.date };

    const pivot = "TWD";
    const baseToPivot = this.getFxRateToPivotRow(base, pivot, asOfDate);
    const quoteToPivot = this.getFxRateToPivotRow(quote, pivot, asOfDate);
    if (baseToPivot !== null && quoteToPivot !== null && quoteToPivot.rate !== 0) {
      return {
        rate: baseToPivot.rate / quoteToPivot.rate,
        asOfDate: minIsoDate(baseToPivot.date, quoteToPivot.date),
      };
    }
    return null;
  }

  private findLatestFxRateRow(base: string, quote: string, asOfDate: string): { rate: number; date: string } | null {
    let bestDate: string | null = null;
    let bestRate: number | null = null;
    for (const r of this.fxRates.values()) {
      if (r.baseCurrency !== base || r.quoteCurrency !== quote) continue;
      if (r.date > asOfDate) continue;
      if (bestDate === null || r.date > bestDate) {
        bestDate = r.date;
        bestRate = r.rate;
      }
    }
    return bestDate !== null && bestRate !== null ? { rate: bestRate, date: bestDate } : null;
  }

  private getFxRateToPivotRow(currency: string, pivot: string, asOfDate: string): { rate: number; date: string } | null {
    if (currency === pivot) return { rate: 1.0, date: asOfDate };
    const directRate = this.findLatestFxRateRow(currency, pivot, asOfDate);
    if (directRate !== null) return directRate;
    const inverseRate = this.findLatestFxRateRow(pivot, currency, asOfDate);
    if (inverseRate !== null && inverseRate.rate !== 0) {
      return { rate: 1 / inverseRate.rate, date: inverseRate.date };
    }
    return null;
  }

  async getFxTransferById(
    userId: string,
    fxTransferId: string,
  ): Promise<{ legs: CashLedgerEntry[]; reversed: boolean } | null> {
    const store = await this.loadStore(userId);
    const legs = store.accounting.facts.cashLedgerEntries
      .filter((entry) => entry.userId === userId && entry.fxTransferId === fxTransferId)
      .sort((left, right) =>
        (left.reversalOfCashLedgerEntryId ?? "").localeCompare(right.reversalOfCashLedgerEntryId ?? "")
        || left.entryType.localeCompare(right.entryType)
        || left.id.localeCompare(right.id),
      );
    if (legs.length === 0) return null;
    return {
      legs,
      reversed: legs.some((leg) => Boolean(leg.reversalOfCashLedgerEntryId)),
    };
  }

  async getAccountAvailableBalance(userId: string, accountId: string, currency: string): Promise<number> {
    const store = await this.loadStore(userId);
    const reversedIds = new Set<string>();
    for (const entry of store.accounting.facts.cashLedgerEntries) {
      if (entry.reversalOfCashLedgerEntryId) {
        reversedIds.add(entry.reversalOfCashLedgerEntryId);
      }
    }
    let total = 0;
    for (const entry of store.accounting.facts.cashLedgerEntries) {
      if (entry.accountId !== accountId) continue;
      if (entry.currency !== currency) continue;
      if (entry.reversalOfCashLedgerEntryId) continue;
      if (reversedIds.has(entry.id)) continue;
      total += entry.amount;
    }
    return total;
  }

  async getCashLedgerEntriesForWalletReplay(
    userId: string,
  ): Promise<import("./types.js").CashLedgerEntryForWalletReplay[]> {
    const store = await this.loadStore(userId);
    const entries = store.accounting.facts.cashLedgerEntries;
    const reversedIds = new Set<string>();
    for (const e of entries) {
      if (e.reversalOfCashLedgerEntryId) reversedIds.add(e.reversalOfCashLedgerEntryId);
    }
    return entries
      .filter((e) => !e.reversalOfCashLedgerEntryId && !reversedIds.has(e.id))
      .map((e) => ({
        id: e.id,
        accountId: e.accountId,
        currency: e.currency,
        entryDate: e.entryDate,
        amount: e.amount,
        fxRateToUsd: e.fxRateToUsd ?? null,
        fxTransferId: e.fxTransferId ?? null,
        entryType: e.entryType,
        reversalOfCashLedgerEntryId: e.reversalOfCashLedgerEntryId,
        bookedAt: e.bookedAt,
      }))
      .sort(
        (a, b) =>
          a.entryDate.localeCompare(b.entryDate)
          || (a.bookedAt ?? "").localeCompare(b.bookedAt ?? "")
          || a.id.localeCompare(b.id),
      );
  }

  async getDailyBarsForTicker(ticker: string, startDate: string, endDate: string): Promise<DailyBar[]> {
    return this.dailyBars
      .filter(b => b.ticker === ticker && b.barDate >= startDate && b.barDate <= endDate)
      .sort((a, b) => a.barDate.localeCompare(b.barDate));
  }

  async getDailyBarsForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
    startDate: string,
    endDate: string,
  ): Promise<DailyBar[]> {
    return this.dailyBars
      .filter((bar) => (
        bar.ticker === ticker
        && bar.marketCode === marketCode
        && bar.barDate >= startDate
        && bar.barDate <= endDate
      ))
      .sort((left, right) => left.barDate.localeCompare(right.barDate));
  }

  async listDividendEventsForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
    startDate: string,
    endDate: string,
  ): Promise<DividendEvent[]> {
    return this.researchDividendEvents
      .filter((event) => (
        event.ticker === ticker
        && (event.marketCode ?? "TW") === marketCode
        && event.exDividendDate >= startDate
        && event.exDividendDate <= endDate
      ))
      .sort((left, right) =>
        left.exDividendDate.localeCompare(right.exDividendDate)
        || left.id.localeCompare(right.id),
      )
      .map((event) => ({ ...event }));
  }

  async getDailyBarsForTickerMarkets(
    pairs: readonly { ticker: string; marketCode: MarketCode }[],
    startDate: string,
    endDate: string,
  ): Promise<Map<string, DailyBar[]>> {
    const result = new Map<string, DailyBar[]>();
    const wanted = new Set<string>();
    for (const pair of pairs) {
      const key = `${pair.ticker}\0${pair.marketCode}`;
      wanted.add(key);
      result.set(key, []);
    }
    const sorted = [...this.dailyBars]
      .filter((bar) => wanted.has(`${bar.ticker}\0${bar.marketCode}`) && bar.barDate >= startDate && bar.barDate <= endDate)
      .sort((a, b) =>
        a.ticker.localeCompare(b.ticker)
        || a.marketCode.localeCompare(b.marketCode)
        || a.barDate.localeCompare(b.barDate),
      );
    for (const bar of sorted) {
      const key = `${bar.ticker}\0${bar.marketCode}`;
      const list = result.get(key) ?? [];
      list.push(bar);
      result.set(key, list);
    }
    return result;
  }

  async getDailyBarsForTickers(tickers: string[], startDate: string, endDate: string): Promise<Map<string, DailyBar[]>> {
    const result = new Map<string, DailyBar[]>();
    for (const t of tickers) result.set(t, []);
    const wanted = new Set(tickers);
    const sorted = [...this.dailyBars]
      .filter(b => wanted.has(b.ticker) && b.barDate >= startDate && b.barDate <= endDate)
      .sort((a, b) => a.barDate.localeCompare(b.barDate));
    for (const bar of sorted) {
      const list = result.get(bar.ticker) ?? [];
      list.push(bar);
      result.set(bar.ticker, list);
    }
    return result;
  }

  async getSnapshotGenerationInputs(
    userId: string,
    scope?: { accountId: string; ticker: string; marketCode?: MarketCode },
  ): Promise<import("./types.js").SnapshotGenerationInputs> {
    const store = await this.loadStore(userId);

    // Trades — apply optional scope filter, then sort by trade_date → booking_sequence → timestamp → id.
    const trades = store.accounting.facts.tradeEvents
      .filter(t => (
        !scope
        || (
          t.accountId === scope.accountId
          && t.ticker === scope.ticker
          && (scope.marketCode === undefined || t.marketCode === scope.marketCode)
        )
      ))
      .slice()
      .sort((a, b) =>
        a.tradeDate.localeCompare(b.tradeDate)
        || (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0)
        || (a.tradeTimestamp ?? "").localeCompare(b.tradeTimestamp ?? "")
        || a.id.localeCompare(b.id),
      )
      .map(t => ({
        id: t.id,
        accountId: t.accountId,
        ticker: t.ticker,
        type: t.type as "BUY" | "SELL",
        quantity: t.quantity,
        unitPrice: t.unitPrice,
        tradeDate: t.tradeDate,
        tradeTimestamp: t.tradeTimestamp,
        bookingSequence: t.bookingSequence,
        commissionAmount: t.commissionAmount,
        taxAmount: t.taxAmount,
        realizedPnlAmount: t.realizedPnlAmount ?? null,
        realizedPnlCurrency: t.realizedPnlCurrency ?? null,
        // KZO-165: project the trade's native currency. BookedTradeEvent always
        // carries a non-null priceCurrency (DB CHECK + TS required field).
        priceCurrency: t.priceCurrency,
        // KZO-185: forward marketCode so the walker can stamp it on
        // `tickersNeedingBackfill` entries. BookedTradeEvent has carried this
        // field since KZO-169 / migration 044.
        marketCode: t.marketCode,
      }));

    // Dividends — filter posted, active, non-superseded entries; join with events for paymentDate+ticker.
    const eventById = new Map(store.marketData.dividendEvents.map(e => [e.id, e]));
    const dividendLedgerEntries = store.accounting.facts.dividendLedgerEntries;
    const reversedDividendLedgerIds = new Set(
      dividendLedgerEntries
        .map((entry) => entry.reversalOfDividendLedgerEntryId)
        .filter((id): id is string => Boolean(id)),
    );
    const postedDividends = dividendLedgerEntries
      .filter(e =>
        e.postingStatus === "posted"
        && !e.reversalOfDividendLedgerEntryId
        && !e.supersededAt
        && !reversedDividendLedgerIds.has(e.id))
      .map(entry => {
        const event = eventById.get(entry.dividendEventId);
        if (!event) return null;
        const paymentDate = event.paymentDate ?? entry.bookedAt?.slice(0, 10);
        if (!paymentDate) return null;
        const eventMarketCode = (event as { marketCode?: MarketCode }).marketCode ?? marketCodeFor(event.cashDividendCurrency);
        if (
          scope
          && (
            entry.accountId !== scope.accountId
            || event.ticker !== scope.ticker
            || (scope.marketCode !== undefined && eventMarketCode !== scope.marketCode)
          )
        ) return null;
        return {
          accountId: entry.accountId,
          ticker: event.ticker,
          marketCode: eventMarketCode,
          paymentDate,
          amount: entry.receivedCashAmount,
          currency: event.cashDividendCurrency,
        };
      })
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate));

    const tradeIds = new Set(trades.map((trade) => trade.id));
    const lotAllocations = store.accounting.projections.lotAllocations
      .filter((allocation) => tradeIds.has(allocation.tradeEventId))
      .map((allocation) => ({
        tradeEventId: allocation.tradeEventId,
        allocatedCostAmount: allocation.allocatedCostAmount,
        costCurrency: allocation.costCurrency,
        lotOpenedAt: allocation.lotOpenedAt,
      }));

    return { trades, postedDividends, lotAllocations };
  }

  async listHoldingSnapshotRepairScopesForTickerMarket(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<import("./types.js").HoldingSnapshotRepairScope[]> {
    const scopes = new Map<string, import("./types.js").HoldingSnapshotRepairScope>();
    for (const [userId, store] of this.stores) {
      const user = this.getUserById(userId);
      if (user && (user.isDemo === true || user.deactivatedAt || user.deletedAt)) continue;
      const activeAccountIds = new Set(store.accounts.map((account) => account.id));

      for (const trade of store.accounting.facts.tradeEvents) {
        if (!activeAccountIds.has(trade.accountId) || trade.ticker !== ticker || trade.marketCode !== marketCode) continue;
        const key = `${userId}\0${trade.accountId}\0${trade.ticker}\0${trade.marketCode}`;
        scopes.set(key, {
          userId,
          accountId: trade.accountId,
          ticker: trade.ticker,
          marketCode: trade.marketCode,
        });
      }
    }
    return [...scopes.values()].sort((a, b) =>
      a.userId.localeCompare(b.userId)
      || a.accountId.localeCompare(b.accountId)
      || a.ticker.localeCompare(b.ticker)
      || a.marketCode.localeCompare(b.marketCode),
    );
  }

  async listHoldingSnapshotRepairTargets(
    options: import("./types.js").HoldingSnapshotRepairTargetOptions,
  ): Promise<import("./types.js").HoldingSnapshotRepairTarget[]> {
    const aggregates = new Map<string, {
      ticker: string;
      marketCode: MarketCode;
      fromDate: string;
      affectedScopes: Set<string>;
      repairableRows: number;
      missingRows: number;
      incompleteRows: number;
    }>();

    for (const [userId, store] of this.stores) {
      const activeAccountIds = new Set(store.accounts.map((account) => account.id));
      const firstTradeByScope = new Map<string, {
        userId: string;
        accountId: string;
        ticker: string;
        marketCode: MarketCode;
        firstTradeDate: string;
      }>();

      for (const trade of store.accounting.facts.tradeEvents) {
        if (!activeAccountIds.has(trade.accountId)) continue;
        const key = `${userId}\0${trade.accountId}\0${trade.ticker}\0${trade.marketCode}`;
        const existing = firstTradeByScope.get(key);
        if (!existing || trade.tradeDate < existing.firstTradeDate) {
          firstTradeByScope.set(key, {
            userId,
            accountId: trade.accountId,
            ticker: trade.ticker,
            marketCode: trade.marketCode,
            firstTradeDate: trade.tradeDate,
          });
        }
      }

      for (const scope of firstTradeByScope.values()) {
        const scanFromDate = scope.firstTradeDate > options.fromDate ? scope.firstTradeDate : options.fromDate;
        for (const bar of this.dailyBars) {
          if (bar.ticker !== scope.ticker || bar.marketCode !== scope.marketCode) continue;
          if (bar.barDate < scanFromDate || bar.barDate > options.toDate) continue;
          const snapshot = this.holdingSnapshots.find((candidate) =>
            candidate.userId === scope.userId
            && candidate.accountId === scope.accountId
            && candidate.ticker === scope.ticker
            && candidate.marketCode === scope.marketCode
            && candidate.snapshotDate === bar.barDate,
          );
          const missing = snapshot === undefined;
          const incomplete = snapshot !== undefined && (
            snapshot.isProvisional
            || snapshot.closePrice === null
            || (snapshot.quantity > 0 && (snapshot.marketValue === null || snapshot.valueNative === null))
            || snapshot.providerSource === null
          );
          if (!missing && !incomplete) continue;

          const targetKey = `${scope.ticker}\0${scope.marketCode}`;
          const current = aggregates.get(targetKey) ?? {
            ticker: scope.ticker,
            marketCode: scope.marketCode,
            fromDate: bar.barDate,
            affectedScopes: new Set<string>(),
            repairableRows: 0,
            missingRows: 0,
            incompleteRows: 0,
          };
          if (bar.barDate < current.fromDate) current.fromDate = bar.barDate;
          current.affectedScopes.add(`${scope.userId}\0${scope.accountId}`);
          current.repairableRows += 1;
          if (missing) current.missingRows += 1;
          if (incomplete) current.incompleteRows += 1;
          aggregates.set(targetKey, current);
        }
      }
    }

    return [...aggregates.values()]
      .sort((a, b) =>
        a.fromDate.localeCompare(b.fromDate)
        || a.ticker.localeCompare(b.ticker)
        || a.marketCode.localeCompare(b.marketCode),
      )
      .slice(0, options.limit)
      .map((target) => ({
        ticker: target.ticker,
        marketCode: target.marketCode,
        fromDate: target.fromDate,
        affectedScopeCount: target.affectedScopes.size,
        repairableRows: target.repairableRows,
        missingRows: target.missingRows,
        incompleteRows: target.incompleteRows,
      }));
  }

  async bulkUpsertHoldingSnapshots(_userId: string, snapshots: HoldingSnapshot[]): Promise<void> {
    for (const s of snapshots) {
      const idx = this.holdingSnapshots.findIndex(
        e => (
          e.userId === s.userId
          && e.accountId === s.accountId
          && e.ticker === s.ticker
          && e.marketCode === s.marketCode
          && e.snapshotDate === s.snapshotDate
        ),
      );
      if (idx >= 0) {
        this.holdingSnapshots[idx] = s;
      } else {
        this.holdingSnapshots.push(s);
      }
    }
  }

  async deleteHoldingSnapshotsForTicker(
    userId: string,
    accountId: string,
    ticker: string,
    fromDate: string,
    marketCode?: MarketCode,
  ): Promise<number> {
    let deleted = 0;
    for (let i = this.holdingSnapshots.length - 1; i >= 0; i--) {
      const s = this.holdingSnapshots[i];
      if (
        s.userId === userId
        && s.accountId === accountId
        && s.ticker === ticker
        && (marketCode === undefined || s.marketCode === marketCode)
        && s.snapshotDate >= fromDate
      ) {
        this.holdingSnapshots.splice(i, 1);
        deleted++;
      }
    }
    return deleted;
  }

  async deleteAllHoldingSnapshots(userId: string): Promise<void> {
    for (let i = this.holdingSnapshots.length - 1; i >= 0; i--) {
      if (this.holdingSnapshots[i].userId === userId) {
        this.holdingSnapshots.splice(i, 1);
      }
    }
  }

  async getAggregatedSnapshots(userId: string, startDate: string, endDate: string): Promise<AggregatedSnapshotPoint[]> {
    const byDate = new Map<string, HoldingSnapshot[]>();
    for (const s of this.holdingSnapshots) {
      if (s.userId !== userId || s.snapshotDate < startDate || s.snapshotDate > endDate) continue;
      const list = byDate.get(s.snapshotDate) ?? [];
      list.push(s);
      byDate.set(s.snapshotDate, list);
    }
    const dates = [...byDate.keys()].sort();
    return dates.map(date => {
      const rows = byDate.get(date)!;
      const totalCostBasis = rows.reduce((sum, r) => sum + r.costBasis, 0);
      const isProvisional = rows.some(r => r.isProvisional);
      const totalMarketValue = isProvisional ? null : rows.reduce((sum, r) => sum + (r.marketValue ?? 0), 0);
      const totalUnrealizedPnl = isProvisional ? null : rows.reduce((sum, r) => sum + (r.unrealizedPnl ?? 0), 0);
      const cumulativeRealizedPnl = rows.reduce((sum, r) => sum + r.cumulativeRealizedPnl, 0);
      const cumulativeDividends = rows.reduce((sum, r) => sum + r.cumulativeDividends, 0);
      const totalReturnAmount = totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;
      return {
        date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional,
        // Legacy method does no FX translation — every row is trivially "available".
        fxAvailable: true,
      };
    });
  }

  // KZO-180 — FX-aware aggregator (memory mirror of the Postgres method).
  //
  // Mirrors the Postgres SQL semantics: per-row translate-then-sum with the D8
  // self-pair shortcut. Self-pair rows multiply by 1.0; non-self-pair rows
  // call `getFxRate(currency, reportingCurrency, snapshotDate)` (forward-fill
  // is encoded inside `getFxRate`'s memory impl). When ANY contributing row's
  // pair fails, `fxAvailable=false` and the translated SUMs become null.
  async getAggregatedSnapshotsInReportingCurrency(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
  ): Promise<AggregatedSnapshotPoint[]> {
    return this.aggregateSnapshotsInReportingCurrency(
      this.holdingSnapshots.filter(s => s.userId === userId && s.snapshotDate >= startDate && s.snapshotDate <= endDate),
      reportingCurrency,
    );
  }

  async getAggregatedSnapshotsInReportingCurrencyForScope(
    userId: string,
    startDate: string,
    endDate: string,
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
    pairs: readonly import("./types.js").HoldingSnapshotScopePair[],
  ): Promise<AggregatedSnapshotPoint[]> {
    if (pairs.length === 0) return [];
    const pairKeys = new Set(pairs.map((pair) => `${pair.accountId}\0${pair.ticker}\0${pair.marketCode ?? ""}`));
    return this.aggregateSnapshotsInReportingCurrency(
      this.holdingSnapshots.filter(s =>
        s.userId === userId
        && s.snapshotDate >= startDate
        && s.snapshotDate <= endDate
        && (
          pairKeys.has(`${s.accountId}\0${s.ticker}\0${s.marketCode}`)
          || pairKeys.has(`${s.accountId}\0${s.ticker}\0`)
        )),
      reportingCurrency,
    );
  }

  private async aggregateSnapshotsInReportingCurrency(
    snapshots: readonly HoldingSnapshot[],
    reportingCurrency: import("@vakwen/shared-types").AccountDefaultCurrency,
  ): Promise<AggregatedSnapshotPoint[]> {
    const byDate = new Map<string, HoldingSnapshot[]>();
    for (const s of snapshots) {
      const list = byDate.get(s.snapshotDate) ?? [];
      list.push(s);
      byDate.set(s.snapshotDate, list);
    }
    const dates = [...byDate.keys()].sort();
    const out: AggregatedSnapshotPoint[] = [];
    for (const date of dates) {
      const rows = byDate.get(date)!;
      const isProvisional = rows.some(r => r.isProvisional);
      let costSum = 0;
      let marketSum = 0;
      let unrealizedSum = 0;
      let cumRealSum = 0;
      let cumDivSum = 0;
      let allFxResolved = true;
      // Cache per-currency FX lookups within this snapshot date to avoid
      // re-querying the in-memory store for the same pair across rows.
      const fxCache = new Map<string, number | null>();

      for (const r of rows) {
        let fxRate: number | null;
        if (r.currency === reportingCurrency) {
          fxRate = 1.0;
        } else {
          if (fxCache.has(r.currency)) {
            fxRate = fxCache.get(r.currency) ?? null;
          } else {
            fxRate = await this.getFxRate(r.currency, reportingCurrency, r.snapshotDate);
            fxCache.set(r.currency, fxRate);
          }
        }
        if (fxRate === null) {
          allFxResolved = false;
          // Don't add to running sums — when fxAvailable=false the translated
          // outputs are nulled regardless. We still enumerate remaining rows
          // to flip allFxResolved on the first miss but skipping the math is fine.
          continue;
        }
        costSum += (r.costBasisNative ?? r.costBasis) * fxRate;
        marketSum += (r.valueNative ?? r.marketValue ?? 0) * fxRate;
        unrealizedSum += (r.unrealizedPnlNative ?? r.unrealizedPnl ?? 0) * fxRate;
        cumRealSum += r.cumulativeRealizedPnl * fxRate;
        cumDivSum += r.cumulativeDividends * fxRate;
      }

      const totalCostBasis = allFxResolved ? costSum : 0;
      const totalMarketValue = !allFxResolved || isProvisional ? null : marketSum;
      const totalUnrealizedPnl = !allFxResolved || isProvisional ? null : unrealizedSum;
      const cumulativeRealizedPnl = allFxResolved ? cumRealSum : 0;
      const cumulativeDividends = allFxResolved ? cumDivSum : 0;
      const totalReturnAmount = allFxResolved && totalMarketValue !== null
        ? totalMarketValue + cumulativeRealizedPnl + cumulativeDividends - totalCostBasis
        : null;
      const totalReturnPercent = totalReturnAmount !== null && totalCostBasis > 0
        ? (totalReturnAmount / totalCostBasis) * 100
        : null;

      out.push({
        date,
        totalCostBasis,
        totalMarketValue,
        totalUnrealizedPnl,
        cumulativeRealizedPnl,
        cumulativeDividends,
        totalReturnAmount,
        totalReturnPercent,
        isProvisional,
        fxAvailable: allFxResolved,
        snapshotContributorKeys: rows
          .map((row) => `${row.accountId}:${row.marketCode ?? ""}:${row.ticker}`)
          .sort(),
      });
    }
    return out;
  }

  async countHoldingSnapshotsAfterDate(
    userId: string,
    accountId: string,
    ticker: string,
    fromDate: string,
    marketCode?: MarketCode,
  ): Promise<number> {
    return this.holdingSnapshots.filter(
      s => (
        s.userId === userId
        && s.accountId === accountId
        && s.ticker === ticker
        && (marketCode === undefined || s.marketCode === marketCode)
        && s.snapshotDate >= fromDate
      ),
    ).length;
  }

  async getLatestSnapshotDiagnostics(
    userId: string,
    pairs?: readonly import("./types.js").HoldingSnapshotScopePair[],
  ): Promise<import("./types.js").SnapshotScopeDiagnostics> {
    const scopedKeys = pairs && pairs.length > 0
      ? new Set(pairs.map((pair) => `${pair.accountId}\0${pair.ticker}\0${pair.marketCode ?? ""}`))
      : null;
    const activeAccountIds = new Set((this.stores.get(userId)?.accounts ?? []).map((account) => account.id));
    const snapshots = this.holdingSnapshots.filter((snapshot) =>
      snapshot.userId === userId
      && activeAccountIds.has(snapshot.accountId)
      && (
        scopedKeys === null
        || scopedKeys.has(`${snapshot.accountId}\0${snapshot.ticker}\0${snapshot.marketCode}`)
        || scopedKeys.has(`${snapshot.accountId}\0${snapshot.ticker}\0`)
      ));

    let latestSnapshotDate: string | null = null;
    for (const snapshot of snapshots) {
      if (latestSnapshotDate === null || snapshot.snapshotDate > latestSnapshotDate) {
        latestSnapshotDate = snapshot.snapshotDate;
      }
    }

    if (latestSnapshotDate === null) {
      return {
        latestSnapshotDate: null,
        missingProviderSourceCount: 0,
        markets: [],
      };
    }

    const markets = new Map<MarketCode, {
      marketCode: MarketCode;
      latestSnapshotDate: string | null;
      missingProviderSourceCount: number;
      providerSources: Set<string>;
    }>();
    for (const snapshot of snapshots) {
      const current = markets.get(snapshot.marketCode) ?? {
        marketCode: snapshot.marketCode,
        latestSnapshotDate: null,
        missingProviderSourceCount: 0,
        providerSources: new Set<string>(),
      };
      if (current.latestSnapshotDate === null || snapshot.snapshotDate > current.latestSnapshotDate) {
        current.latestSnapshotDate = snapshot.snapshotDate;
        current.missingProviderSourceCount = snapshot.providerSource === null ? 1 : 0;
        current.providerSources = new Set(snapshot.providerSource ? [snapshot.providerSource] : []);
      } else if (snapshot.snapshotDate === current.latestSnapshotDate) {
        if (snapshot.providerSource === null) {
          current.missingProviderSourceCount += 1;
        } else {
          current.providerSources.add(snapshot.providerSource);
        }
      }
      markets.set(snapshot.marketCode, current);
    }

    return {
      latestSnapshotDate,
      missingProviderSourceCount: snapshots.filter((snapshot) =>
        snapshot.snapshotDate === latestSnapshotDate
        && snapshot.providerSource === null).length,
      markets: [...markets.values()]
        .map((market) => ({
          marketCode: market.marketCode,
          latestSnapshotDate: market.latestSnapshotDate,
          missingProviderSourceCount: market.missingProviderSourceCount,
          providerSources: [...market.providerSources].sort(),
        }))
        .sort((left, right) => left.marketCode.localeCompare(right.marketCode)),
    };
  }

  async getHoldingSnapshotsForTicker(
    userId: string, accountId: string, ticker: string, startDate: string, endDate: string,
  ): Promise<HoldingSnapshot[]> {
    return this.holdingSnapshots
      .filter(s => s.userId === userId && s.accountId === accountId && s.ticker === ticker
        && s.snapshotDate >= startDate && s.snapshotDate <= endDate)
      .sort((a, b) => a.snapshotDate.localeCompare(b.snapshotDate) || a.marketCode.localeCompare(b.marketCode));
  }

  async listHoldingSnapshots(
    userId: string,
    options: import("./types.js").ListHoldingSnapshotsOptions,
  ): Promise<import("./types.js").ListHoldingSnapshotsResult> {
    const scopedKeys = options.pairs && options.pairs.length > 0
      ? new Set(options.pairs.map((pair) => `${pair.accountId}\0${pair.ticker}\0${pair.marketCode ?? ""}`))
      : null;
    const accountNames = new Map(
      (this.stores.get(userId)?.accounts ?? []).map((account) => [account.id, account.name] as const),
    );
    const filtered = this.holdingSnapshots.filter((snapshot) => {
      if (snapshot.userId !== userId) return false;
      if (options.accountIds && options.accountIds.length > 0 && !options.accountIds.includes(snapshot.accountId)) return false;
      if (options.startDate && snapshot.snapshotDate < options.startDate) return false;
      if (options.endDate && snapshot.snapshotDate > options.endDate) return false;
      if (options.includeProvisional === false && snapshot.isProvisional) return false;
      if (scopedKeys) {
        return (
          scopedKeys.has(`${snapshot.accountId}\0${snapshot.ticker}\0${snapshot.marketCode}`)
          || scopedKeys.has(`${snapshot.accountId}\0${snapshot.ticker}\0`)
        );
      }
      return true;
    }).sort((left, right) =>
      right.snapshotDate.localeCompare(left.snapshotDate)
      || left.accountId.localeCompare(right.accountId)
      || left.ticker.localeCompare(right.ticker)
      || left.marketCode.localeCompare(right.marketCode));

    return {
      rows: filtered.slice(options.offset, options.offset + options.limit).map((row) => ({
        ...row,
        accountName: accountNames.get(row.accountId) ?? null,
      })),
      total: filtered.length,
      provisionalCount: filtered.filter((row) => row.isProvisional).length,
    };
  }

  async listUnrealizedPnlAnalysisSnapshots(
    userId: string,
    options: import("./types.js").UnrealizedPnlAnalysisSnapshotOptions,
  ): Promise<import("./types.js").UnrealizedPnlAnalysisSnapshotRow[]> {
    const accountIdFilter = options.accountIds && options.accountIds.length > 0 ? new Set(options.accountIds) : null;
    const marketFilter = options.markets && options.markets.length > 0 ? new Set(options.markets) : null;
    const tickerFilter = options.tickers && options.tickers.length > 0
      ? new Set(options.tickers.map((ticker) => ticker.trim().toUpperCase()))
      : null;
    const rows = this.holdingSnapshots
      .filter((snapshot) => {
        if (snapshot.userId !== userId) return false;
        if (snapshot.snapshotDate < options.startDate || snapshot.snapshotDate > options.endDate) return false;
        if (!options.includeProvisional && snapshot.isProvisional) return false;
        if (accountIdFilter && !accountIdFilter.has(snapshot.accountId)) return false;
        if (marketFilter && !marketFilter.has(snapshot.marketCode)) return false;
        if (tickerFilter && !tickerFilter.has(snapshot.ticker.toUpperCase())) return false;
        return true;
      })
      .sort((left, right) =>
        left.snapshotDate.localeCompare(right.snapshotDate)
        || left.marketCode.localeCompare(right.marketCode)
        || left.ticker.localeCompare(right.ticker)
        || left.accountId.localeCompare(right.accountId),
      );

    const result: import("./types.js").UnrealizedPnlAnalysisSnapshotRow[] = [];
    for (const row of rows) {
      const fxResolution = row.currency === options.reportingCurrency
        ? { rate: 1, asOfDate: row.snapshotDate }
        : await this.getResolvedFxRate(row.currency, options.reportingCurrency, row.snapshotDate);
      const fxRate = fxResolution?.rate ?? null;
      const fxAvailable = fxRate !== null;
      result.push({
        accountId: row.accountId,
        ticker: row.ticker,
        marketCode: row.marketCode,
        snapshotDate: row.snapshotDate,
        quantity: row.quantity,
        closePrice: row.closePrice,
        providerSource: row.providerSource,
        nativeCurrency: row.currency,
        reportingCurrency: options.reportingCurrency,
        costBasisAmount: fxAvailable ? roundToDecimal((row.costBasisNative ?? row.costBasis) * fxRate, 2) : null,
        marketValueAmount: fxAvailable && row.valueNative !== null
          ? roundToDecimal(row.valueNative * fxRate, 2)
          : null,
        unrealizedPnlAmount: fxAvailable && row.unrealizedPnlNative !== null
          ? roundToDecimal(row.unrealizedPnlNative * fxRate, 2)
          : null,
        isProvisional: row.isProvisional,
        fxAvailable,
        fxAsOfDate: fxResolution?.asOfDate ?? null,
      });
    }
    return result;
  }

  async saveMcpReplayPreview(record: import("./types.js").McpReplayPreviewRecord): Promise<void> {
    this.mcpReplayPreviews.set(record.id, structuredClone(record));
  }

  async getMcpReplayPreview(id: string): Promise<import("./types.js").McpReplayPreviewRecord | null> {
    const record = this.mcpReplayPreviews.get(id);
    return record ? structuredClone(record) : null;
  }

  async createMcpReplayRun(record: import("./types.js").McpReplayRunRecord): Promise<void> {
    const existingRun = [...this.mcpReplayRuns.values()].find((run) => run.previewId === record.previewId);
    if (existingRun) {
      throw routeError(409, "mcp_replay_preview_consumed", "Replay preview has already been confirmed");
    }
    this.mcpReplayRuns.set(record.id, structuredClone(record));
  }

  async getMcpReplayRun(id: string): Promise<import("./types.js").McpReplayRunRecord | null> {
    const record = this.mcpReplayRuns.get(id);
    return record ? structuredClone(record) : null;
  }

  async updateMcpReplayRunScope(input: {
    runId: string;
    accountId: string;
    ticker: string;
    marketCode: MarketCode;
    status: import("./types.js").McpReplayRunScopeStatus;
    errorMessage?: string | null;
    replayedTradeCount?: number | null;
    snapshotGenerationRunId?: string | null;
    updatedAt?: string;
  }): Promise<void> {
    const run = this.mcpReplayRuns.get(input.runId);
    if (!run) throw routeError(404, "mcp_replay_run_not_found", "Replay run not found");
    const scope = run.scopes.find((item) =>
      item.accountId === input.accountId
      && item.ticker === input.ticker
      && item.marketCode === input.marketCode);
    if (!scope) throw routeError(404, "mcp_replay_run_scope_not_found", "Replay run scope not found");
    scope.status = input.status;
    if (input.errorMessage !== undefined) scope.errorMessage = input.errorMessage;
    if (input.replayedTradeCount !== undefined) scope.replayedTradeCount = input.replayedTradeCount;
    if (input.snapshotGenerationRunId !== undefined) scope.snapshotGenerationRunId = input.snapshotGenerationRunId;
    scope.updatedAt = input.updatedAt ?? new Date().toISOString();
  }

  async updateMcpReplayRunStatus(input: {
    runId: string;
    status: import("./types.js").McpReplayRunStatus;
    startedAt?: string | null;
    finishedAt?: string | null;
  }): Promise<void> {
    const run = this.mcpReplayRuns.get(input.runId);
    if (!run) throw routeError(404, "mcp_replay_run_not_found", "Replay run not found");
    run.status = input.status;
    if (input.startedAt !== undefined) run.startedAt = input.startedAt;
    if (input.finishedAt !== undefined) run.finishedAt = input.finishedAt;
  }

  async savePostedTransactionMutationPreview(
    record: import("./types.js").PostedTransactionMutationPreviewRecord,
  ): Promise<void> {
    this.postedTransactionMutationPreviews.set(record.id, structuredClone(record));
  }

  async getPostedTransactionMutationPreview(
    id: string,
  ): Promise<import("./types.js").PostedTransactionMutationPreviewRecord | null> {
    const record = this.postedTransactionMutationPreviews.get(id);
    return record ? structuredClone(record) : null;
  }

  async savePostedTransactionMutationRun(
    record: import("./types.js").PostedTransactionMutationRunRecord,
  ): Promise<void> {
    this.postedTransactionMutationRuns.set(record.id, structuredClone(record));
  }

  async getPostedTransactionMutationRun(
    id: string,
  ): Promise<import("./types.js").PostedTransactionMutationRunRecord | null> {
    const record = this.postedTransactionMutationRuns.get(id);
    return record ? structuredClone(record) : null;
  }

  async savePostedTransactionMutationDeletedDraftLineage(
    record: import("./types.js").PostedTransactionMutationDeletedDraftLineageRecord,
  ): Promise<void> {
    this.postedTransactionMutationDeletedDraftLineage.set(record.tradeEventId, structuredClone(record));
  }

  async listPostedTransactionMutationDeletedDraftLineage(
    ownerUserId: string,
    tradeEventIds: readonly string[],
    draftRowIds: readonly string[] = [],
  ): Promise<import("./types.js").PostedTransactionMutationDeletedDraftLineageRecord[]> {
    const tradeEventIdSet = new Set(tradeEventIds);
    const draftRowIdSet = new Set(draftRowIds);
    return [...this.postedTransactionMutationDeletedDraftLineage.values()]
      .filter((record) =>
        record.ownerUserId === ownerUserId
        && (tradeEventIdSet.has(record.tradeEventId) || draftRowIdSet.has(record.rowId)))
      .map((record) => structuredClone(record));
  }

  // ── Currency wallet snapshots (KZO-165) ───────────────────────────────────
  // Memory mirror. Note: MemoryPersistence does NOT enforce the composite FK or
  // ISO CHECK that Postgres does — those gaps are documented in
  // `.claude/rules/test-placement-persistence-backend.md` and integration tests
  // assert them with the Postgres backend.

  async bulkUpsertCurrencyWalletSnapshots(
    _userId: string,
    snapshots: CurrencyWalletSnapshot[],
  ): Promise<void> {
    for (const s of snapshots) {
      const idx = this.currencyWalletSnapshots.findIndex(
        (e) => e.accountId === s.accountId && e.currency === s.currency && e.date === s.date,
      );
      if (idx >= 0) {
        this.currencyWalletSnapshots[idx] = s;
      } else {
        this.currencyWalletSnapshots.push(s);
      }
    }
  }

  async getLatestHoldingSnapshotDatesByScope(
    userId: string,
    pairs: readonly import("./types.js").HoldingSnapshotLatestDateScopePair[],
  ): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();
    for (const pair of pairs) {
      result.set(`${pair.accountId}\0${pair.ticker}\0${pair.marketCode}`, null);
    }
    for (const snapshot of this.holdingSnapshots) {
      if (snapshot.userId !== userId) continue;
      if (!isCompleteHoldingSnapshot(snapshot)) continue;
      const key = `${snapshot.accountId}\0${snapshot.ticker}\0${snapshot.marketCode}`;
      if (!result.has(key)) continue;
      const current = result.get(key) ?? null;
      if (current === null || snapshot.snapshotDate > current) {
        result.set(key, snapshot.snapshotDate);
      }
    }
    return result;
  }

  async deleteAllCurrencyWalletSnapshots(userId: string): Promise<void> {
    for (let i = this.currencyWalletSnapshots.length - 1; i >= 0; i--) {
      if (this.currencyWalletSnapshots[i].userId === userId) {
        this.currencyWalletSnapshots.splice(i, 1);
      }
    }
  }

  async getCurrencyWalletSnapshotsForAccount(
    userId: string,
    accountId: string,
    startDate: string,
    endDate: string,
  ): Promise<CurrencyWalletSnapshot[]> {
    return this.currencyWalletSnapshots
      .filter(
        (s) =>
          s.userId === userId
          && s.accountId === accountId
          && s.date >= startDate
          && s.date <= endDate,
      )
      .sort((a, b) =>
        a.date.localeCompare(b.date) || a.currency.localeCompare(b.currency),
      );
  }

  async getCashLedgerEntriesForBalances(userId: string): Promise<CashLedgerEntryForBalance[]> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.cashLedgerEntries
      .map((e) => ({
        accountId: e.accountId,
        currency: e.currency,
        entryDate: e.entryDate,
        amount: e.amount,
      }))
      .sort((a, b) =>
        a.accountId.localeCompare(b.accountId)
        || a.currency.localeCompare(b.currency)
        || a.entryDate.localeCompare(b.entryDate),
      );
  }

  async readiness(): Promise<ReadinessStatus> {
    return { backend: "memory", postgres: true, redis: true };
  }

  async markDemoUser(userId: string, ttlSeconds: number): Promise<void> {
    const user = [...this.usersByEmail.values()].find((u) => u.id === userId);
    if (user) {
      user.isDemo = true;
      user.demoExpiresAt = new Date(Date.now() + ttlSeconds * 1000);
    }
  }

  async getTradeEvent(userId: string, tradeEventId: string): Promise<BookedTradeEvent | null> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.tradeEvents.find((t) => t.id === tradeEventId && t.userId === userId) ?? null;
  }

  async deleteTradeEvent(userId: string, tradeEventId: string): Promise<DeleteTradeEventResult> {
    const store = await this.loadStore(userId);
    const tradeIndex = store.accounting.facts.tradeEvents.findIndex((t) => t.id === tradeEventId && t.userId === userId);
    if (tradeIndex === -1) {
      throw routeError(404, "trade_event_not_found", "Trade event not found");
    }
    const trade = store.accounting.facts.tradeEvents[tradeIndex];

    // Count child rows
    const cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) => e.relatedTradeEventId === tradeEventId,
    ).length;
    const lotAllocations = store.accounting.projections.lotAllocations.filter(
      (a) => a.tradeEventId === tradeEventId,
    ).length;

    // Remove trade
    store.accounting.facts.tradeEvents.splice(tradeIndex, 1);

    // Remove related cash ledger entries (CASCADE equivalent)
    store.accounting.facts.cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) => e.relatedTradeEventId !== tradeEventId,
    );

    // Remove related lot allocations (CASCADE equivalent)
    store.accounting.projections.lotAllocations = store.accounting.projections.lotAllocations.filter(
      (a) => a.tradeEventId !== tradeEventId,
    );

    return {
      accountId: trade.accountId,
      ticker: trade.ticker,
      feePolicySnapshotId: `trade-fee-snapshot:${tradeEventId}`,
      deletedChildRows: { cashLedgerEntries, lotAllocations },
    };
  }

  async updateTradeEvent(userId: string, tradeEventId: string, patch: TradeEventPatch): Promise<{ accountId: string; ticker: string }> {
    const store = await this.loadStore(userId);
    const trade = store.accounting.facts.tradeEvents.find((t) => t.id === tradeEventId && t.userId === userId);
    if (!trade) {
      throw routeError(404, "trade_event_not_found", "Trade event not found");
    }

    const oldTradeDate = trade.tradeDate;

    if (patch.date !== undefined) {
      trade.tradeDate = patch.date;
      trade.tradeTimestamp = new Date(`${patch.date}T00:00:00.000Z`).toISOString();
    }
    if (patch.quantity !== undefined) trade.quantity = patch.quantity;
    if (patch.price !== undefined) trade.unitPrice = patch.price;
    if (patch.side !== undefined) trade.type = patch.side;
    if (patch.isDayTrade !== undefined) trade.isDayTrade = patch.isDayTrade;
    if (patch.commissionAmount !== undefined) trade.commissionAmount = patch.commissionAmount;
    if (patch.taxAmount !== undefined) trade.taxAmount = patch.taxAmount;
    if (patch.feesSource !== undefined) trade.feesSource = patch.feesSource;

    // Handle date change: assign new booking sequence + compact old date
    if (patch.date && patch.date !== oldTradeDate) {
      // Find next available sequence for new date
      const tradesOnNewDate = store.accounting.facts.tradeEvents.filter(
        (t) => t.accountId === trade.accountId && t.tradeDate === patch.date && t.id !== tradeEventId,
      );
      trade.bookingSequence = tradesOnNewDate.length + 1;

      // Compact old date's booking sequence
      const tradesOnOldDate = store.accounting.facts.tradeEvents
        .filter((t) => t.accountId === trade.accountId && t.tradeDate === oldTradeDate)
        .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
      tradesOnOldDate.forEach((t, i) => {
        t.bookingSequence = i + 1;
      });
    }

    return { accountId: trade.accountId, ticker: trade.ticker };
  }

  async getTradeEventsForAccountTicker(userId: string, accountId: string, ticker: string, marketCode?: MarketCode): Promise<BookedTradeEvent[]> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.tradeEvents
      .filter((t) => t.userId === userId && t.accountId === accountId && t.ticker === ticker && (!marketCode || t.marketCode === marketCode))
      .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
  }

  async getPositionActionsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
  ): Promise<PositionAction[]> {
    const store = await this.loadStore(userId);
    return store.accounting.facts.positionActions
      .filter((action) =>
        action.accountId === accountId
        && action.ticker === ticker
        && (!marketCode || action.marketCode === marketCode)
        && !action.reversalOfPositionActionId
        && !action.supersededAt,
      )
      .sort((left, right) =>
        left.actionDate.localeCompare(right.actionDate)
        || (left.actionTimestamp ?? "").localeCompare(right.actionTimestamp ?? "")
        || (left.bookedAt ?? "").localeCompare(right.bookedAt ?? "")
        || left.id.localeCompare(right.id),
      );
  }

  async deleteLotsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds: readonly string[] = [],
  ): Promise<number> {
    const store = await this.loadStore(userId);
    const scopedTradeEventIds = marketCode
      ? [
          ...store.accounting.facts.tradeEvents
            .filter((t) => t.userId === userId && t.accountId === accountId && t.ticker === ticker && t.marketCode === marketCode)
            .map((t) => t.id),
          ...additionalTradeEventIds,
        ]
      : [];
    const scopedLotIds = marketCode
      ? new Set([
          ...scopedTradeEventIds.map((id) => `lot-${id}`),
          ...stockDividendLotIdsForScope(store, accountId, ticker, marketCode),
        ])
      : null;
    const before = store.accounting.projections.lots.length;
    store.accounting.projections.lots = store.accounting.projections.lots.filter(
      (l) => !(l.accountId === accountId && l.ticker === ticker && (!scopedLotIds || scopedLotIds.has(l.id))),
    );
    rebuildHoldingProjection(store);
    return before - store.accounting.projections.lots.length;
  }

  async deleteLotAllocationsForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds: readonly string[] = [],
  ): Promise<number> {
    const store = await this.loadStore(userId);
    const scopedTradeEventIds = marketCode
      ? new Set([
          ...store.accounting.facts.tradeEvents
            .filter((t) => t.userId === userId && t.accountId === accountId && t.ticker === ticker && t.marketCode === marketCode)
            .map((t) => t.id),
          ...additionalTradeEventIds,
        ])
      : null;
    const scopedLotIds = marketCode
      ? new Set([
          ...Array.from(scopedTradeEventIds ?? []).map((id) => `lot-${id}`),
          ...stockDividendLotIdsForScope(store, accountId, ticker, marketCode),
        ])
      : null;
    const before = store.accounting.projections.lotAllocations.length;
    store.accounting.projections.lotAllocations = store.accounting.projections.lotAllocations.filter(
      (a) => !(a.userId === userId && a.accountId === accountId && a.ticker === ticker
        && (!scopedTradeEventIds || scopedTradeEventIds.has(a.tradeEventId) || scopedLotIds?.has(a.lotId))),
    );
    return before - store.accounting.projections.lotAllocations.length;
  }

  async deleteTradeCashEntriesForAccountTicker(
    userId: string,
    accountId: string,
    ticker: string,
    marketCode?: MarketCode,
    additionalTradeEventIds: readonly string[] = [],
  ): Promise<number> {
    const store = await this.loadStore(userId);
    // Collect trade event IDs for the given account+ticker
    const tradeEventIds = new Set([
      ...store.accounting.facts.tradeEvents
        .filter((t) => t.userId === userId && t.accountId === accountId && t.ticker === ticker && (!marketCode || t.marketCode === marketCode))
        .map((t) => t.id),
      ...additionalTradeEventIds,
    ]);

    const before = store.accounting.facts.cashLedgerEntries.length;
    store.accounting.facts.cashLedgerEntries = store.accounting.facts.cashLedgerEntries.filter(
      (e) =>
        !(
          e.userId === userId &&
          e.accountId === accountId &&
          (e.entryType === "TRADE_SETTLEMENT_IN" || e.entryType === "TRADE_SETTLEMENT_OUT") &&
          e.relatedTradeEventId &&
          tradeEventIds.has(e.relatedTradeEventId)
        ),
    );
    return before - store.accounting.facts.cashLedgerEntries.length;
  }

  async bulkUpsertLots(userId: string, lots: Lot[]): Promise<void> {
    if (lots.length === 0) return;
    const store = await this.loadStore(userId);
    for (const lot of lots) {
      const existingIndex = store.accounting.projections.lots.findIndex((l) => l.id === lot.id);
      if (existingIndex >= 0) {
        store.accounting.projections.lots[existingIndex] = lot;
      } else {
        store.accounting.projections.lots.push(lot);
      }
    }
    rebuildHoldingProjection(store);
  }

  async bulkInsertLotAllocations(userId: string, allocations: LotAllocationProjection[]): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting.projections.lotAllocations.push(...allocations);
  }

  async bulkInsertCashLedgerEntries(userId: string, entries: CashLedgerEntry[]): Promise<void> {
    const store = await this.loadStore(userId);
    store.accounting.facts.cashLedgerEntries.push(...entries);
  }

  async compactBookingSequence(userId: string, accountId: string, tradeDate: string): Promise<void> {
    const store = await this.loadStore(userId);
    const trades = store.accounting.facts.tradeEvents
      .filter((t) => t.accountId === accountId && t.tradeDate === tradeDate)
      .sort((a, b) => (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0));
    trades.forEach((t, i) => {
      t.bookingSequence = i + 1;
    });
  }

  // --- Instruments ---

  async getInstrument(ticker: string, marketCode?: string): Promise<import("./types.js").InstrumentRow | null> {
    // KZO-169: composite (ticker, market_code) lookup. When `marketCode` is
    // provided we read directly via the composite key. When omitted (legacy
    // callers), we scan for the first matching ticker — preferring TW for
    // back-compat with monomarket deployments.
    const findInCatalog = (catalog: Map<string, MemoryInstrument>): MemoryInstrument | undefined => {
      if (marketCode) {
        return catalog.get(instrumentCatalogKey(ticker, marketCode));
      }
      let twMatch: MemoryInstrument | undefined;
      let firstMatch: MemoryInstrument | undefined;
      for (const item of catalog.values()) {
        if (item.ticker !== ticker) continue;
        firstMatch ??= item;
        if (item.marketCode === "TW") {
          twMatch = item;
          break;
        }
      }
      return twMatch ?? firstMatch;
    };
    let instrument: MemoryInstrument | undefined = findInCatalog(this.instruments);
    if (!instrument) {
      for (const catalog of this.instrumentsByUser.values()) {
        instrument = findInCatalog(catalog);
        if (instrument) break;
      }
    }
    if (!instrument) return null;
    const now = new Date().toISOString();
    return {
      ticker: instrument.ticker,
      instrumentType: (instrument.instrumentType as import("@vakwen/domain").InstrumentType) ?? null,
      marketCode: instrument.marketCode,
      name: instrument.name ?? undefined,
      isProvisional: false,
      typeRaw: instrument.typeRaw ?? undefined,
      industryCategoryRaw: instrument.industryCategoryRaw ?? undefined,
      catalogExchangeRaw: instrument.catalogExchangeRaw ?? null,
      catalogMicCode: instrument.catalogMicCode ?? null,
      barsBackfillStatus: instrument.barsBackfillStatus as import("@vakwen/domain").BackfillStatus,
      lastRepairAt: instrument.lastRepairAt ?? undefined,
      verificationStatus: "unverified",
      createdAt: now,
      updatedAt: now,
    };
  }

  async updateBackfillStatus(
    _ticker: string,
    _marketCode: import("@vakwen/domain").MarketCode,
    _status: import("@vakwen/domain").BackfillStatus,
  ): Promise<void> {
    // No-op in memory mode (matches pre-KZO-197 behavior). Signature widened
    // for P2-2 to scope by composite (ticker, marketCode) — the Postgres impl
    // is the load-bearing path; memory keeps the no-op shape.
  }

  async updateLastRepairAt(ticker: string): Promise<void> {
    // KZO-169: update every market_code entry that shares this ticker — repair
    // operations trigger cross-market regardless of which row was the trigger
    // (provider-side rate limiter is per-symbol; we record the action against
    // every matching catalog row).
    const now = new Date().toISOString();
    for (const catalog of [this.instruments, ...this.instrumentsByUser.values()]) {
      for (const [key, current] of catalog.entries()) {
        if (current.ticker === ticker) {
          catalog.set(key, { ...current, lastRepairAt: now });
        }
      }
    }
  }

  private quoteFallbackPolicyKey(input: {
    marketCode: MarketCode;
    ticker: string;
    provider: import("./types.js").QuoteFallbackProvider;
    priceType: import("./types.js").QuoteFallbackPriceType;
  }): string {
    return `${input.marketCode}:${input.ticker.trim().toUpperCase()}:${input.provider}:${input.priceType}`;
  }

  private cloneQuoteFallbackPolicy(
    policy: import("./types.js").QuoteFallbackPolicyRecord,
  ): import("./types.js").QuoteFallbackPolicyRecord {
    return { ...policy };
  }

  private cloneQuoteFallbackSnapshot(
    snapshot: import("./types.js").QuoteFallbackSnapshotRecord,
  ): import("./types.js").QuoteFallbackSnapshotRecord {
    return {
      ...snapshot,
      providerMetadata: { ...snapshot.providerMetadata },
    };
  }

  private latestQuoteFallbackSnapshotForPolicy(policyId: string): import("./types.js").QuoteFallbackSnapshotRecord | null {
    let latest: import("./types.js").QuoteFallbackSnapshotRecord | null = null;
    for (const snapshot of this.quoteFallbackSnapshots.values()) {
      if (snapshot.policyId !== policyId) continue;
      if (
        latest === null
        || snapshot.marketDate > latest.marketDate
        || (snapshot.marketDate === latest.marketDate && snapshot.fetchedAt > latest.fetchedAt)
      ) {
        latest = snapshot;
      }
    }
    return latest ? this.cloneQuoteFallbackSnapshot(latest) : null;
  }

  private quoteFallbackPolicyWithSnapshot(
    policy: import("./types.js").QuoteFallbackPolicyRecord,
  ): import("./types.js").QuoteFallbackPolicyWithSnapshotRecord {
    return {
      ...this.cloneQuoteFallbackPolicy(policy),
      latestSnapshot: this.latestQuoteFallbackSnapshotForPolicy(policy.id),
    };
  }

  async getQuoteFallbackPolicy(
    ticker: string,
    marketCode: MarketCode,
  ): Promise<import("./types.js").QuoteFallbackPolicyWithSnapshotRecord | null> {
    const normalizedTicker = ticker.trim().toUpperCase();
    const matches = [...this.quoteFallbackPolicies.values()]
      .filter((policy) => policy.ticker === normalizedTicker && policy.marketCode === marketCode)
      .sort((left, right) => Number(right.active) - Number(left.active) || right.updatedAt.localeCompare(left.updatedAt));
    return matches[0] ? this.quoteFallbackPolicyWithSnapshot(matches[0]) : null;
  }

  async listQuoteFallbackPoliciesForTickerMarkets(
    pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  ): Promise<import("./types.js").QuoteFallbackPolicyWithSnapshotRecord[]> {
    if (pairs.length === 0) return [];
    const requested = new Set(pairs.map((pair) => `${pair.marketCode}:${pair.ticker.trim().toUpperCase()}`));
    return [...this.quoteFallbackPolicies.values()]
      .filter((policy) => requested.has(`${policy.marketCode}:${policy.ticker}`))
      .sort((left, right) => left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker))
      .map((policy) => this.quoteFallbackPolicyWithSnapshot(policy));
  }

  async listActiveQuoteFallbackPolicies(
    marketCode?: MarketCode,
  ): Promise<import("./types.js").QuoteFallbackPolicyRecord[]> {
    return [...this.quoteFallbackPolicies.values()]
      .filter((policy) => policy.active && (!marketCode || policy.marketCode === marketCode))
      .sort((left, right) => left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker))
      .map((policy) => this.cloneQuoteFallbackPolicy(policy));
  }

  async upsertQuoteFallbackPolicy(
    input: import("./types.js").UpsertQuoteFallbackPolicyInput,
  ): Promise<import("./types.js").QuoteFallbackPolicyWithSnapshotRecord> {
    const now = new Date().toISOString();
    const ticker = input.ticker.trim().toUpperCase();
    const providerSymbol = input.providerSymbol.trim().toUpperCase();
    const key = this.quoteFallbackPolicyKey({
      marketCode: input.marketCode,
      ticker,
      provider: input.provider,
      priceType: input.priceType,
    });
    const existing = this.quoteFallbackPolicies.get(key);
    const active = input.active ?? true;
    const providerSymbolChanged = Boolean(existing && existing.providerSymbol !== providerSymbol);
    const next: import("./types.js").QuoteFallbackPolicyRecord = {
      id: existing?.id ?? randomUUID(),
      marketCode: input.marketCode,
      ticker,
      provider: input.provider,
      priceType: input.priceType,
      providerSymbol,
      active,
      reason: input.reason ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      deactivatedAt: active ? null : existing?.deactivatedAt ?? now,
      lastRefreshStatus: providerSymbolChanged ? null : existing?.lastRefreshStatus ?? null,
      lastRefreshAt: providerSymbolChanged ? null : existing?.lastRefreshAt ?? null,
      lastRefreshError: providerSymbolChanged ? null : existing?.lastRefreshError ?? null,
      lastRefreshErrorCode: providerSymbolChanged ? null : existing?.lastRefreshErrorCode ?? null,
    };
    this.quoteFallbackPolicies.set(key, next);
    if (providerSymbolChanged) {
      for (const [snapshotKey, snapshot] of this.quoteFallbackSnapshots.entries()) {
        if (snapshot.policyId === next.id) {
          this.quoteFallbackSnapshots.delete(snapshotKey);
        }
      }
    }
    return this.quoteFallbackPolicyWithSnapshot(next);
  }

  async deactivateQuoteFallbackPolicy(input: {
    ticker: string;
    marketCode: MarketCode;
  }): Promise<import("./types.js").QuoteFallbackPolicyWithSnapshotRecord | null> {
    const existing = await this.getQuoteFallbackPolicy(input.ticker, input.marketCode);
    if (!existing) return null;
    const key = this.quoteFallbackPolicyKey(existing);
    const now = new Date().toISOString();
    const next: import("./types.js").QuoteFallbackPolicyRecord = {
      ...existing,
      active: false,
      updatedAt: now,
      deactivatedAt: existing.deactivatedAt ?? now,
    };
    this.quoteFallbackPolicies.set(key, next);
    return this.quoteFallbackPolicyWithSnapshot(next);
  }

  async getLatestQuoteFallbackSnapshot(policyId: string): Promise<import("./types.js").QuoteFallbackSnapshotRecord | null> {
    return this.latestQuoteFallbackSnapshotForPolicy(policyId);
  }

  async upsertQuoteFallbackSnapshot(
    input: import("./types.js").UpsertQuoteFallbackSnapshotInput,
  ): Promise<import("./types.js").QuoteFallbackSnapshotRecord> {
    const key = `${input.policyId}:${input.marketDate}`;
    const existing = this.quoteFallbackSnapshots.get(key);
    const snapshot: import("./types.js").QuoteFallbackSnapshotRecord = {
      id: existing?.id ?? randomUUID(),
      policyId: input.policyId,
      marketCode: input.marketCode,
      ticker: input.ticker.trim().toUpperCase(),
      provider: input.provider,
      priceType: input.priceType,
      providerSymbol: input.providerSymbol.trim().toUpperCase(),
      marketDate: input.marketDate,
      close: input.close,
      previousClose: input.previousClose,
      currency: input.currency,
      currencySource: input.currencySource,
      source: input.source,
      fetchedAt: input.fetchedAt,
      providerPayloadHash: input.providerPayloadHash ?? null,
      providerMetadata: { ...(input.providerMetadata ?? {}) },
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };
    this.quoteFallbackSnapshots.set(key, snapshot);
    return this.cloneQuoteFallbackSnapshot(snapshot);
  }

  async updateQuoteFallbackPolicyRefreshStatus(input: {
    policyId: string;
    status: import("./types.js").QuoteFallbackRefreshStatus;
    refreshedAt: string | null;
    error?: string | null;
    errorCode?: string | null;
  }): Promise<import("./types.js").QuoteFallbackPolicyRecord | null> {
    for (const [key, policy] of this.quoteFallbackPolicies.entries()) {
      if (policy.id !== input.policyId) continue;
      const next: import("./types.js").QuoteFallbackPolicyRecord = {
        ...policy,
        updatedAt: new Date().toISOString(),
        lastRefreshStatus: input.status,
        lastRefreshAt: input.refreshedAt ?? policy.lastRefreshAt,
        lastRefreshError: input.error ?? null,
        lastRefreshErrorCode: input.errorCode ?? null,
      };
      this.quoteFallbackPolicies.set(key, next);
      return this.cloneQuoteFallbackPolicy(next);
    }
    return null;
  }

  async consumeEodhdCallBudget(input: {
    budgetDate: string;
    limit: number;
    calls?: number;
  }): Promise<import("./types.js").EodhdCallBudgetStatus & { allowed: boolean }> {
    const calls = input.calls ?? 1;
    const used = this.eodhdCallBudgetUsage.get(input.budgetDate) ?? 0;
    const limit = Math.max(0, Math.floor(input.limit));
    if (calls <= 0) {
      return { budgetDate: input.budgetDate, limit, used, remaining: Math.max(0, limit - used), allowed: true };
    }
    if (used + calls > limit) {
      return { budgetDate: input.budgetDate, limit, used, remaining: Math.max(0, limit - used), allowed: false };
    }
    const nextUsed = used + calls;
    this.eodhdCallBudgetUsage.set(input.budgetDate, nextUsed);
    return {
      budgetDate: input.budgetDate,
      limit,
      used: nextUsed,
      remaining: Math.max(0, limit - nextUsed),
      allowed: true,
    };
  }

  async getEodhdCallBudgetStatus(input: {
    budgetDate: string;
    limit: number;
  }): Promise<import("./types.js").EodhdCallBudgetStatus> {
    const used = this.eodhdCallBudgetUsage.get(input.budgetDate) ?? 0;
    const limit = Math.max(0, Math.floor(input.limit));
    return {
      budgetDate: input.budgetDate,
      limit,
      used,
      remaining: Math.max(0, limit - used),
    };
  }

  // --- App Config (KZO-133) ---

  async getRepairCooldownMinutes(): Promise<number | null> {
    return this._repairCooldownMinutes;
  }

  async getAppConfig(): Promise<{
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
    jpCatalogAllowedStockTypes: import("@vakwen/shared-types").JpCatalogStockType[] | null;
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
    tickerPriceSupportedMarkets: import("@vakwen/shared-types").MarketCode[] | null;
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
    catalogAbsenceThreshold: number | null;
    catalogAbsenceGuardPercent: number | null;
    catalogAbsenceGuardFloor: number | null;
    asxGicsRefreshCron: string | null;
    anonymousShareTokenCap: number | null;
    anonymousShareRateLimitMax: number | null;
    anonymousShareRateLimitWindowMs: number | null;
    anonymousShareTokenRetentionMs: number | null;
    userPreferencesMaxBytes: number | null;
    accountHardPurgeDays: number | null;
    valuationHealthRelativeBps: number | null;
    valuationHealthAbsoluteAud: number | null;
    valuationHealthAbsoluteUsd: number | null;
    valuationHealthAbsoluteTwd: number | null;
    valuationHealthAbsoluteKrw: number | null;
    valuationHealthAbsoluteJpy: number | null;
    routeCachePolicyMode: import("./types.js").RouteCachePolicyMode | null;
    routeCacheDashboardPrimaryTtlMs: number | null;
    routeCacheDashboardEnrichmentTtlMs: number | null;
    routeCacheDashboardPerformanceTtlMs: number | null;
    routeCachePortfolioTtlMs: number | null;
    routeCacheReportsTtlMs: number | null;
    routeCacheStaleUsableTtlMs: number | null;
    eodhdDailyCallLimit: number | null;
    updatedAt: string;
  }> {
    const p = this._appConfigPlain;
    const numberOrNull = (value: import("./types.js").AppConfigPlainValue | undefined): number | null =>
      typeof value === "number" ? value : null;
    const booleanOrNull = (value: import("./types.js").AppConfigPlainValue | undefined): boolean | null =>
      typeof value === "boolean" ? value : null;
    const isMarketCode = (value: unknown): value is import("@vakwen/shared-types").MarketCode =>
      typeof value === "string" && value in { TW: null, US: null, AU: null, KR: null, JP: null };
    const isJpCatalogStockType = (value: unknown): value is import("@vakwen/shared-types").JpCatalogStockType => {
      return typeof value === "string" && value in {
        "Common Stock": null,
        "Preferred Stock": null,
        REIT: null,
        "Depositary Receipt": null,
      };
    };
    const marketsOrNull = (
      value: import("./types.js").AppConfigPlainValue | undefined,
    ): import("@vakwen/shared-types").MarketCode[] | null =>
      Array.isArray(value) && value.every(isMarketCode) ? [...value] : null;
    const jpCatalogStockTypesOrNull = (
      value: import("./types.js").AppConfigPlainValue | undefined,
    ): import("@vakwen/shared-types").JpCatalogStockType[] | null =>
      Array.isArray(value) && value.every(isJpCatalogStockType)
        ? [...value]
        : null;
    const textOrNull = (value: import("./types.js").AppConfigPlainValue | undefined): string | null =>
      typeof value === "string" ? value : null;
    return {
      repairCooldownMinutes: this._repairCooldownMinutes,
      dashboardPerformanceRanges: this._dashboardPerformanceRanges
        ? [...this._dashboardPerformanceRanges]
        : null,
      metadataEnrichmentMode: this._metadataEnrichmentMode,
      finmindApiTokenEncrypted: this._finmindApiTokenEncrypted,
      twelveDataApiKeyEncrypted: this._twelveDataApiKeyEncrypted,
      eodhdApiKeyEncrypted: this._eodhdApiKeyEncrypted,
      mcpOauthTokenSecretEncrypted: this._mcpOauthTokenSecretEncrypted,
      marketDataPriceWindowMs: numberOrNull(p.marketDataPriceWindowMs),
      marketDataPriceLimit: numberOrNull(p.marketDataPriceLimit),
      marketDataSearchWindowMs: numberOrNull(p.marketDataSearchWindowMs),
      marketDataSearchLimit: numberOrNull(p.marketDataSearchLimit),
      inviteStatusWindowMs: numberOrNull(p.inviteStatusWindowMs),
      inviteStatusLimit: numberOrNull(p.inviteStatusLimit),
      providerDownNotificationSuppressionMs: numberOrNull(p.providerDownNotificationSuppressionMs),
      providerErrorTrailRetentionDays: numberOrNull(p.providerErrorTrailRetentionDays),
      providerRerunCooldownMs: numberOrNull(p.providerRerunCooldownMs),
      // KZO-197 — yahoo-finance-au rerun cooldown override (Tier 1).
      yahooAuRerunCooldownMs: numberOrNull(p.yahooAuRerunCooldownMs),
      providerFixerDangerousMatchThreshold: numberOrNull(p.providerFixerDangerousMatchThreshold),
      providerFixerPreviewSampleLimit: numberOrNull(p.providerFixerPreviewSampleLimit),
      providerFixerUiPageSize: numberOrNull(p.providerFixerUiPageSize),
      providerFixerAutoPauseFailuresPerMinute: numberOrNull(p.providerFixerAutoPauseFailuresPerMinute),
      providerFixerPreviewTokenTtlMinutes: numberOrNull(p.providerFixerPreviewTokenTtlMinutes),
      providerOperationAutoRenewIntervalMinutes: numberOrNull(p.providerOperationAutoRenewIntervalMinutes),
      providerIncidentRecurrenceWindowMinutes: numberOrNull(p.providerIncidentRecurrenceWindowMinutes),
      providerHealthWarningUnresolvedThreshold: numberOrNull(p.providerHealthWarningUnresolvedThreshold),
      providerHealthCriticalUnresolvedThreshold: numberOrNull(p.providerHealthCriticalUnresolvedThreshold),
      providerOperationStaleHeartbeatMinutes: numberOrNull(p.providerOperationStaleHeartbeatMinutes),
      providerOperationSummaryRetentionDays: numberOrNull(p.providerOperationSummaryRetentionDays),
      providerOperationLogRetentionDays: numberOrNull(p.providerOperationLogRetentionDays),
      providerIncidentRetentionDays: numberOrNull(p.providerIncidentRetentionDays),
      providerResolvedItemRetentionDays: numberOrNull(p.providerResolvedItemRetentionDays),
      finmindProviderRateLimitPerHour: numberOrNull(p.finmindProviderRateLimitPerHour),
      twelveDataProviderRateLimitPerMinute: numberOrNull(p.twelveDataProviderRateLimitPerMinute),
      yahooAuProviderRateLimitPerMinute: numberOrNull(p.yahooAuProviderRateLimitPerMinute),
      yahooKrProviderRateLimitPerMinute: numberOrNull(p.yahooKrProviderRateLimitPerMinute),
      yahooJpProviderRateLimitPerMinute: numberOrNull(p.yahooJpProviderRateLimitPerMinute),
      frankfurterProviderRateLimitPerMinute: numberOrNull(p.frankfurterProviderRateLimitPerMinute),
      asxGicsProviderRateLimitPerHour: numberOrNull(p.asxGicsProviderRateLimitPerHour),
      finmindProviderMinRequestIntervalMs: numberOrNull(p.finmindProviderMinRequestIntervalMs),
      twelveDataProviderMinRequestIntervalMs: numberOrNull(p.twelveDataProviderMinRequestIntervalMs),
      yahooAuProviderMinRequestIntervalMs: numberOrNull(p.yahooAuProviderMinRequestIntervalMs),
      yahooKrProviderMinRequestIntervalMs: numberOrNull(p.yahooKrProviderMinRequestIntervalMs),
      yahooJpProviderMinRequestIntervalMs: numberOrNull(p.yahooJpProviderMinRequestIntervalMs),
      frankfurterProviderMinRequestIntervalMs: numberOrNull(p.frankfurterProviderMinRequestIntervalMs),
      asxGicsProviderMinRequestIntervalMs: numberOrNull(p.asxGicsProviderMinRequestIntervalMs),
      jpCatalogAllowedStockTypes: jpCatalogStockTypesOrNull(p.jpCatalogAllowedStockTypes),
      jpCatalogIncludeDepositaryReceipts: booleanOrNull(p.jpCatalogIncludeDepositaryReceipts),
      jpCatalogIncludeAtSymbols: booleanOrNull(p.jpCatalogIncludeAtSymbols),
      backfillRetryLimit: numberOrNull(p.backfillRetryLimit),
      backfillRetryDelaySeconds: numberOrNull(p.backfillRetryDelaySeconds),
      backfillFinmind402RetryMs: numberOrNull(p.backfillFinmind402RetryMs),
      tickerPriceCloseRefreshGraceMinutes: numberOrNull(p.tickerPriceCloseRefreshGraceMinutes),
      tickerPriceIntradayEnabled: booleanOrNull(p.tickerPriceIntradayEnabled),
      tickerPriceIntradayRefreshIntervalMinutes: numberOrNull(p.tickerPriceIntradayRefreshIntervalMinutes),
      tickerPriceIntradayFreshnessToleranceMinutes: numberOrNull(p.tickerPriceIntradayFreshnessToleranceMinutes),
      tickerPriceYahooChartRequestLimitPerMinute: numberOrNull(p.tickerPriceYahooChartRequestLimitPerMinute),
      tickerPriceQueueConcurrency: numberOrNull(p.tickerPriceQueueConcurrency),
      tickerPriceMaxTickersPerRefreshCycle: numberOrNull(p.tickerPriceMaxTickersPerRefreshCycle),
      tickerPriceSupportedMarkets: marketsOrNull(p.tickerPriceSupportedMarkets),
      tickerPriceRegularSessionOnly: booleanOrNull(p.tickerPriceRegularSessionOnly),
      tickerPriceYahooChartRange: textOrNull(p.tickerPriceYahooChartRange) as import("@vakwen/shared-types").TickerPriceFreshnessYahooChartRange | null,
      tickerPriceYahooChartInterval: textOrNull(p.tickerPriceYahooChartInterval) as import("@vakwen/shared-types").TickerPriceFreshnessYahooChartInterval | null,
      tickerPriceRefreshCloseRateLimitWindowMs: numberOrNull(p.tickerPriceRefreshCloseRateLimitWindowMs),
      tickerPriceRefreshCloseRateLimitMax: numberOrNull(p.tickerPriceRefreshCloseRateLimitMax),
      tickerPriceSyncTickerCap: numberOrNull(p.tickerPriceSyncTickerCap),
      tickerPriceActivityDetailedRetentionDays: numberOrNull(p.tickerPriceActivityDetailedRetentionDays),
      tickerPriceActivitySummaryRetentionDays: numberOrNull(p.tickerPriceActivitySummaryRetentionDays),
      tickerPriceCalendarHistoryRetentionDays: numberOrNull(p.tickerPriceCalendarHistoryRetentionDays),
      dailyRefreshLookbackDays: numberOrNull(p.dailyRefreshLookbackDays),
      dailyRefreshPriority: numberOrNull(p.dailyRefreshPriority),
      sseHeartbeatIntervalMs: numberOrNull(p.sseHeartbeatIntervalMs),
      sseMaxConnectionsPerUser: numberOrNull(p.sseMaxConnectionsPerUser),
      sseBufferDefaultTtlMs: numberOrNull(p.sseBufferDefaultTtlMs),
      catalogAbsenceThreshold: numberOrNull(p.catalogAbsenceThreshold),
      catalogAbsenceGuardPercent: numberOrNull(p.catalogAbsenceGuardPercent),
      catalogAbsenceGuardFloor: numberOrNull(p.catalogAbsenceGuardFloor),
      // KZO-196 — AU GICS sync cron override (NULL = use env default).
      asxGicsRefreshCron: this._asxGicsRefreshCron ?? null,
      // KZO-199 — Tier 1 sharing knobs (in PATCH schema, in UI).
      anonymousShareTokenCap: numberOrNull(p.anonymousShareTokenCap),
      anonymousShareRateLimitMax: numberOrNull(p.anonymousShareRateLimitMax),
      anonymousShareRateLimitWindowMs: numberOrNull(p.anonymousShareRateLimitWindowMs),
      // KZO-199 — Tier 2 (DB+SQL only). Memory persistence doesn't surface a
      // setter for these; they always resolve null and the resolver layer
      // falls back to env. Postgres backend exposes them via direct SQL.
      anonymousShareTokenRetentionMs: this._anonymousShareTokenRetentionMs ?? null,
      userPreferencesMaxBytes: this._userPreferencesMaxBytes ?? null,
      // ui-enhancement — Tier B account-soft-delete grace period (uses the
      // plain-fields map; setAppConfigField/Patch route through it).
      accountHardPurgeDays: numberOrNull(p.accountHardPurgeDays),
      valuationHealthRelativeBps: numberOrNull(p.valuationHealthRelativeBps),
      valuationHealthAbsoluteAud: numberOrNull(p.valuationHealthAbsoluteAud),
      valuationHealthAbsoluteUsd: numberOrNull(p.valuationHealthAbsoluteUsd),
      valuationHealthAbsoluteTwd: numberOrNull(p.valuationHealthAbsoluteTwd),
      valuationHealthAbsoluteKrw: numberOrNull(p.valuationHealthAbsoluteKrw),
      valuationHealthAbsoluteJpy: numberOrNull(p.valuationHealthAbsoluteJpy),
      routeCachePolicyMode: this._routeCachePolicyMode,
      routeCacheDashboardPrimaryTtlMs: numberOrNull(p.routeCacheDashboardPrimaryTtlMs),
      routeCacheDashboardEnrichmentTtlMs: numberOrNull(p.routeCacheDashboardEnrichmentTtlMs),
      routeCacheDashboardPerformanceTtlMs: numberOrNull(p.routeCacheDashboardPerformanceTtlMs),
      routeCachePortfolioTtlMs: numberOrNull(p.routeCachePortfolioTtlMs),
      routeCacheReportsTtlMs: numberOrNull(p.routeCacheReportsTtlMs),
      routeCacheStaleUsableTtlMs: numberOrNull(p.routeCacheStaleUsableTtlMs),
      eodhdDailyCallLimit: numberOrNull(p.eodhdDailyCallLimit),
      updatedAt: this._appConfigUpdatedAt,
    };
  }

  async setAppConfigField(
    field: import("./types.js").AppConfigPlainField,
    value: import("./types.js").AppConfigPlainValue,
  ): Promise<void> {
    if (value === null) {
      delete this._appConfigPlain[field];
    } else {
      this._appConfigPlain[field] = Array.isArray(value)
        ? [...value] as import("./types.js").AppConfigPlainValue
        : value;
    }
    this._bumpAppConfigUpdatedAt();
  }

  async setAppConfigEncryptedSecret(
    field: "finmindApiToken" | "twelveDataApiKey" | "eodhdApiKey" | "mcpOauthTokenSecret",
    plaintext: string | null,
  ): Promise<void> {
    const { encryptSecret } = await import("../services/appConfig/encryption.js");
    const stored = plaintext === null ? null : encryptSecret(plaintext);
    if (field === "finmindApiToken") {
      this._finmindApiTokenEncrypted = stored;
    } else if (field === "twelveDataApiKey") {
      this._twelveDataApiKeyEncrypted = stored;
    } else if (field === "eodhdApiKey") {
      this._eodhdApiKeyEncrypted = stored;
    } else {
      this._mcpOauthTokenSecretEncrypted = stored;
      this.aiConnectorPolicySettings = {
        ...this.aiConnectorPolicySettings,
        oauthTokenSecretSet: stored !== null,
      };
    }
    this._bumpAppConfigUpdatedAt();
  }

  async setAppConfigPatch(patch: import("./types.js").AppConfigPatch): Promise<void> {
    const { APP_CONFIG_PLAIN_COLUMNS } = await import("./types.js");
    let touched = false;
    for (const key of Object.keys(APP_CONFIG_PLAIN_COLUMNS) as Array<
      import("./types.js").AppConfigPlainField
    >) {
      if (Object.prototype.hasOwnProperty.call(patch, key)) {
        const value = patch[key] ?? null;
        if (value === null) {
          delete this._appConfigPlain[key];
        } else {
          this._appConfigPlain[key] = Array.isArray(value)
            ? [...value] as import("./types.js").AppConfigPlainValue
            : value;
        }
        touched = true;
      }
    }

    if (
      Object.prototype.hasOwnProperty.call(patch, "finmindApiToken") ||
      Object.prototype.hasOwnProperty.call(patch, "twelveDataApiKey") ||
      Object.prototype.hasOwnProperty.call(patch, "eodhdApiKey") ||
      Object.prototype.hasOwnProperty.call(patch, "mcpOauthTokenSecret")
    ) {
      const { encryptSecret } = await import("../services/appConfig/encryption.js");
      if (Object.prototype.hasOwnProperty.call(patch, "finmindApiToken")) {
        this._finmindApiTokenEncrypted =
          patch.finmindApiToken == null ? null : encryptSecret(patch.finmindApiToken);
        touched = true;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "twelveDataApiKey")) {
        this._twelveDataApiKeyEncrypted =
          patch.twelveDataApiKey == null ? null : encryptSecret(patch.twelveDataApiKey);
        touched = true;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "eodhdApiKey")) {
        this._eodhdApiKeyEncrypted =
          patch.eodhdApiKey == null ? null : encryptSecret(patch.eodhdApiKey);
        touched = true;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "mcpOauthTokenSecret")) {
        this._mcpOauthTokenSecretEncrypted =
          patch.mcpOauthTokenSecret == null ? null : encryptSecret(patch.mcpOauthTokenSecret);
        this.aiConnectorPolicySettings = {
          ...this.aiConnectorPolicySettings,
          oauthTokenSecretSet: this._mcpOauthTokenSecretEncrypted !== null,
        };
        touched = true;
      }
    }

    if (touched) this._bumpAppConfigUpdatedAt();
  }

  async setRepairCooldownMinutes(value: number | null): Promise<void> {
    this._repairCooldownMinutes = value;
    this._bumpAppConfigUpdatedAt();
  }

  async setDashboardPerformanceRanges(value: string[] | null): Promise<void> {
    // KZO-159 (158A) — sibling setter per D6. Route layer validates the
    // list shape via `dashboardPerformanceRangesSchema` before calling.
    this._dashboardPerformanceRanges = value ? [...value] : null;
    this._bumpAppConfigUpdatedAt();
  }

  // KZO-189: AU metadata enrichment mode override.
  async getMetadataEnrichmentMode(): Promise<"unconditional" | "conditional" | null> {
    return this._metadataEnrichmentMode;
  }

  async setMetadataEnrichmentMode(value: "unconditional" | "conditional" | null): Promise<void> {
    this._metadataEnrichmentMode = value;
    this._bumpAppConfigUpdatedAt();
  }

  async setRouteCachePolicyMode(value: import("./types.js").RouteCachePolicyMode | null): Promise<void> {
    this._routeCachePolicyMode = value;
    this._bumpAppConfigUpdatedAt();
  }

  private _bumpAppConfigUpdatedAt(): void {
    const prevMs = Date.parse(this._appConfigUpdatedAt);
    const nextMs = Math.max(Date.now(), Number.isFinite(prevMs) ? prevMs + 1 : Date.now());
    this._appConfigUpdatedAt = new Date(nextMs).toISOString();
  }

  /** Test-only: override the in-memory repair cooldown (null = use env fallback). */
  _setRepairCooldownMinutes(n: number | null): void {
    this._repairCooldownMinutes = n;
  }

  // --- User preferences (KZO-159 / 158A) ---

  async getUserPreferences(userId: string): Promise<Record<string, unknown>> {
    const row = this.userPreferences.get(userId);
    // Lazy: never insert on read, return an empty object when unset.
    return row ? { ...row } : {};
  }

  async setUserPreferencePatch(
    userId: string,
    patch: Record<string, unknown | null>,
  ): Promise<Record<string, unknown>> {
    // Top-level merge with explicit null-delete semantics — mirrors the
    // canonical Postgres shape in design D3:
    //   (user_preferences.preferences || EXCLUDED.preferences) - $3::text[]
    // Non-null keys replace existing values (arrays/objects assigned whole).
    // Null-valued keys are dropped from the merged object.
    //
    // KZO-162: `cardOrder` is special-cased — it is sub-key-merged so that
    // PATCH `{cardOrder:{transactions:[...]}}` does not wipe `cardOrder.dashboard`.
    // A null sub-key value (e.g. `{cardOrder:{transactions:null}}`) deletes
    // just that sub-key; the empty `cardOrder` object is preserved (caller
    // can still PATCH `{cardOrder:null}` to clear the whole top-level key).
    //
    // Holdings table settings and admin market-data table settings are
    // context-merged so one mounted table cannot overwrite sibling contexts
    // from a stale hook.
    const current = this.userPreferences.get(userId) ?? {};
    const next: Record<string, unknown> = { ...current };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null || value === undefined) {
        delete next[key];
      } else if (
        key === "cardOrder"
        && isPlainObject(value)
      ) {
        const currentCardOrder = isPlainObject(next.cardOrder) ? next.cardOrder : {};
        const merged: Record<string, unknown> = { ...currentCardOrder };
        for (const [subKey, subValue] of Object.entries(value)) {
          if (subValue === null || subValue === undefined) {
            delete merged[subKey];
          } else {
            merged[subKey] = subValue;
          }
        }
        next.cardOrder = merged;
      } else if (
        key === "holdingsTableSettings"
        && isPlainObject(value)
      ) {
        const currentSettings = isPlainObject(next.holdingsTableSettings)
          ? next.holdingsTableSettings
          : {};
        const currentContexts = isPlainObject(currentSettings.contexts)
          ? currentSettings.contexts
          : {};
        const patchContexts = isPlainObject(value.contexts) ? value.contexts : {};
        const mergedContexts: Record<string, unknown> = { ...currentContexts };
        for (const [contextKey, patchContext] of Object.entries(patchContexts)) {
          const currentContext = currentContexts[contextKey];
          const mergedContext = isPlainObject(currentContext) && isPlainObject(patchContext)
            ? { ...currentContext, ...patchContext }
            : patchContext;
          if (isPlainObject(mergedContext) && isPlainObject(patchContext) && patchContext.sortMode === "custom") {
            delete mergedContext.sortField;
            delete mergedContext.sortDirection;
          }
          mergedContexts[contextKey] = mergedContext;
        }
        next.holdingsTableSettings = {
          ...currentSettings,
          ...value,
          contexts: mergedContexts,
        };
      } else if (
        key === "adminMarketDataTableSettings"
        && isPlainObject(value)
      ) {
        const currentSettings = isPlainObject(next.adminMarketDataTableSettings)
          ? next.adminMarketDataTableSettings
          : {};
        const currentContexts = isPlainObject(currentSettings.contexts)
          ? currentSettings.contexts
          : {};
        const patchContexts = isPlainObject(value.contexts) ? value.contexts : {};
        next.adminMarketDataTableSettings = {
          ...currentSettings,
          ...value,
          contexts: {
            ...currentContexts,
            ...patchContexts,
          },
        };
      } else {
        next[key] = value;
      }
    }
    this.userPreferences.set(userId, next);
    return { ...next };
  }

  /** Test-only: full-replace the preferences row for a user (used by the
   *  `/__e2e/seed-user-preferences` endpoint; bypasses merge semantics). */
  async _setUserPreferences(userId: string, preferences: Record<string, unknown>): Promise<void> {
    const existing = this.userPreferences.get(userId) ?? {};
    this.userPreferences.set(userId, { ...existing, ...preferences });
  }

  // --- Monitored Tickers ---

  async getMonitoredSet(userId: string): Promise<Omit<MonitoredTickerDto, "repairAvailableAt">[]> {
    const manualSelections = this.monitoredTickers.get(userId) ?? new Map();
    const store = this.stores.get(userId);
    const catalog = this._catalogForUser(userId);

    // Collect position-derived (ticker, marketCode) pairs from open lots.
    // KZO-169: lots don't store market_code; derive from a representative
    // trade event (per-(account, ticker) market is invariant after KZO-169).
    type PositionKey = { ticker: string; marketCode: string };
    const positions: PositionKey[] = [];
    const positionSeen = new Set<string>();
    if (store) {
      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity <= 0) continue;
        const trade = store.accounting.facts.tradeEvents.find(
          (te) => te.accountId === lot.accountId && te.ticker === lot.ticker,
        );
        if (!trade?.marketCode) {
          throw routeError(
            500,
            "market_code_missing",
            `Open lot ${lot.ticker} is missing a source trade market_code`,
          );
        }
        const marketCode = trade.marketCode;
        const key = instrumentCatalogKey(lot.ticker, marketCode);
        if (positionSeen.has(key)) continue;
        positionSeen.add(key);
        positions.push({ ticker: lot.ticker, marketCode });
      }
    }

    // Manual selections take precedence; persistence omits `repairAvailableAt`
    // (KZO-133 — route layer decorates).
    const result: Omit<MonitoredTickerDto, "repairAvailableAt">[] = [];
    const seen = new Set<string>();

    for (const sel of manualSelections.values()) {
      const key = instrumentCatalogKey(sel.ticker, sel.marketCode);
      seen.add(key);
      const instrument = catalog.get(key);
      result.push({
        ticker: sel.ticker,
        marketCode: sel.marketCode,
        source: "manual",
        name: instrument?.name ?? null,
        instrumentType: (instrument?.instrumentType as MonitoredTickerDto["instrumentType"]) ?? null,
        barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        lastRepairAt: instrument?.lastRepairAt ?? null,
      });
    }

    for (const pos of positions) {
      const key = instrumentCatalogKey(pos.ticker, pos.marketCode);
      if (seen.has(key)) continue;
      seen.add(key);
      const instrument = catalog.get(key);
      result.push({
        ticker: pos.ticker,
        marketCode: pos.marketCode,
        source: "position",
        name: instrument?.name ?? null,
        instrumentType: (instrument?.instrumentType as MonitoredTickerDto["instrumentType"]) ?? null,
        barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
        lastRepairAt: instrument?.lastRepairAt ?? null,
      });
    }

    return result;
  }

  async getAllMonitoredTickers(): Promise<{ ticker: string; marketCode: string }[]> {
    // KZO-185: shape change to `{ticker, marketCode}` pairs.
    //
    // KZO-197: enumerate the per-user `monitoredTickers` map so the AU rerun
    // union path can count monitored AU rows on the memory backend. Pre-KZO-197
    // this returned `[]` unconditionally (documented as "memory backend has no
    // users-monitored-tickers state"), which was correct only for the cron /
    // daily-refresh callers (those call paths still no-op on memory because
    // `app.boss === null`). The KZO-197 admin route now reads this directly to
    // populate audit metadata regardless of `app.boss` state, so the empty
    // return silently dropped the monitored-AU count to 0.
    //
    // De-duplicate across users (the persistence interface returns DISTINCT
    // (ticker, marketCode) pairs — same contract as the Postgres impl).
    //
    // KZO-197 P3: mirror the Postgres filter `bars_backfill_status='ready'
    // AND delisted_at IS NULL`. Without it, memory-backed E2E (with
    // `app.boss` set) would enqueue work production excludes — pending /
    // failed / delisted rows that the real refresh cron skips.
    const seen = new Set<string>();
    const out: { ticker: string; marketCode: string }[] = [];
    for (const userMap of this.monitoredTickers.values()) {
      for (const sel of userMap.values()) {
        const key = `${sel.ticker}|${sel.marketCode}`;
        if (seen.has(key)) continue;
        const instrument = this.instruments.get(
          instrumentCatalogKey(sel.ticker, sel.marketCode),
        );
        if (!instrument) continue;
        if (instrument.barsBackfillStatus !== "ready") continue;
        if (instrument.delistedAt) continue;
        seen.add(key);
        out.push({ ticker: sel.ticker, marketCode: sel.marketCode });
      }
    }
    out.sort((a, b) => {
      const t = a.ticker.localeCompare(b.ticker);
      return t !== 0 ? t : a.marketCode.localeCompare(b.marketCode);
    });
    return out;
  }

  async listHeldTickerMarketPairs(): Promise<{ ticker: string; marketCode: MarketCode }[]> {
    const seen = new Set<string>();
    const out: { ticker: string; marketCode: MarketCode }[] = [];

    for (const [userId, store] of this.stores.entries()) {
      const user = [...this.usersByEmail.values()].find((candidate) => candidate.id === userId);
      if (user?.isDemo === true || user?.deactivatedAt || user?.deletedAt) continue;

      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity <= 0) continue;
        const tradeMarketCodes = new Set(
          store.accounting.facts.tradeEvents
            .filter((trade) => trade.accountId === lot.accountId && trade.ticker === lot.ticker)
            .map((trade) => trade.marketCode),
        );
        const marketCodes = tradeMarketCodes.size > 0
          ? tradeMarketCodes
          : new Set(
            [...this.instruments.values()]
              .filter((instrument) => instrument.ticker === lot.ticker)
              .map((instrument) => instrument.marketCode as MarketCode),
          );
        for (const marketCode of marketCodes) {
          const key = instrumentCatalogKey(lot.ticker, marketCode);
          if (seen.has(key)) continue;
          const instrument = this.instruments.get(key);
          if (!instrument) continue;
          if (instrument.barsBackfillStatus !== "ready") continue;
          if (instrument.delistedAt) continue;
          seen.add(key);
          out.push({ ticker: lot.ticker, marketCode });
        }
      }
    }

    out.sort((a, b) => {
      const t = a.ticker.localeCompare(b.ticker);
      return t !== 0 ? t : a.marketCode.localeCompare(b.marketCode);
    });
    return out;
  }

  async listHeldTickerMarketPairsForQuoteFallback(): Promise<{ ticker: string; marketCode: MarketCode }[]> {
    const seen = new Set<string>();
    const out: { ticker: string; marketCode: MarketCode }[] = [];

    for (const [userId, store] of this.stores.entries()) {
      const user = [...this.usersByEmail.values()].find((candidate) => candidate.id === userId);
      if (user?.isDemo === true || user?.deactivatedAt || user?.deletedAt) continue;

      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity <= 0) continue;
        const tradeMarketCodes = new Set(
          store.accounting.facts.tradeEvents
            .filter((trade) => trade.accountId === lot.accountId && trade.ticker === lot.ticker)
            .map((trade) => trade.marketCode),
        );
        const marketCodes = tradeMarketCodes.size > 0
          ? tradeMarketCodes
          : new Set(
            [...this.instruments.values()]
              .filter((instrument) => instrument.ticker === lot.ticker)
              .map((instrument) => instrument.marketCode as MarketCode),
          );
        for (const marketCode of marketCodes) {
          const key = instrumentCatalogKey(lot.ticker, marketCode);
          if (seen.has(key)) continue;
          const instrument = this.instruments.get(key);
          if (!instrument) continue;
          if (instrument.delistedAt) continue;
          seen.add(key);
          out.push({ ticker: lot.ticker, marketCode });
        }
      }
    }

    out.sort((a, b) => {
      const t = a.ticker.localeCompare(b.ticker);
      return t !== 0 ? t : a.marketCode.localeCompare(b.marketCode);
    });
    return out;
  }

  async getUsersMonitoringTicker(_ticker: string): Promise<string[]> {
    return [];
  }

  async listAuCatalogBarsBackfillCandidates(): Promise<Array<{ ticker: string; marketCode: "AU" }>> {
    // KZO-197 — fresh-deploy AU warm-up. Read directly from the canonical
    // in-memory catalog map (`this.instruments`), filter to AU instruments
    // whose `barsBackfillStatus` is `pending` or `failed` and that aren't
    // delisted. This is the memory-backend mirror of the Postgres
    // `SELECT ticker FROM market_data.instruments WHERE market_code='AU'
    // AND bars_backfill_status IN ('pending','failed') AND delisted_at IS NULL`.
    //
    // Per `.claude/rules/test-placement-persistence-backend.md` "MemoryPersistence
    // dual-store mirror": the unconditional mirror in `_seedInstrument`
    // (KZO-195 iter 8) keeps the admin store in lockstep, but this method
    // reads from `this.instruments` because it's the source-of-truth that
    // carries the live `barsBackfillStatus` field. The admin-row mirror
    // does not track backfill status.
    const rows: Array<{ ticker: string; marketCode: "AU" }> = [];
    for (const inst of this.instruments.values()) {
      if (inst.marketCode !== "AU") continue;
      if (inst.delistedAt) continue;
      if (inst.barsBackfillStatus !== "pending" && inst.barsBackfillStatus !== "failed") continue;
      rows.push({ ticker: inst.ticker, marketCode: "AU" });
    }
    rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
    return rows;
  }

  async listCatalogBarsBackfillCandidates(marketCode: MarketCode): Promise<Array<{ ticker: string; marketCode: MarketCode }>> {
    const rows: Array<{ ticker: string; marketCode: MarketCode }> = [];
    for (const inst of this.instruments.values()) {
      if (inst.marketCode !== marketCode) continue;
      if (inst.delistedAt) continue;
      if (inst.barsBackfillStatus !== "pending" && inst.barsBackfillStatus !== "failed") continue;
      rows.push({ ticker: inst.ticker, marketCode });
    }
    rows.sort((a, b) => a.ticker.localeCompare(b.ticker));
    return rows;
  }

  async getManualSelections(userId: string): Promise<{ ticker: string; marketCode: string; addedAt: string }[]> {
    const selections = this.monitoredTickers.get(userId);
    if (!selections) return [];
    return [...selections.values()].map(({ ticker, marketCode, addedAt }) => ({
      ticker,
      marketCode,
      addedAt,
    }));
  }

  async replaceManualSelections(
    userId: string,
    selections: ReadonlyArray<{
      ticker: string;
      marketCode: string;
      name?: string | null;
      instrumentType?: InstrumentType | null;
    }>,
  ): Promise<{ newTickers: string[] }> {
    // KZO-169: diff by composite key so a switch from BHP/AU → BHP/US shows up
    // as a "new" entry. The returned `newTickers` is still a flat list of
    // tickers (back-compat with KZO-132 refresh-batch consumers).
    const currentSet = await this.getMonitoredSet(userId);
    const currentKeys = new Set(currentSet.map((s) => instrumentCatalogKey(s.ticker, s.marketCode)));

    // KZO-188: mirror the postgres-side instrument upsert. When the client
    // provides metadata for a live-sourced pick (e.g. CBA/AU) we add the row
    // to the same catalog map the user reads from in `getMonitoredSet` /
    // `listInstrumentsCatalog` so the next reload renders name + type
    // correctly. Write to the existing per-user map when one exists, else the
    // shared catalog — matching `_catalogForUser`'s read precedence — to
    // avoid creating an empty per-user catalog that would shadow the shared
    // default rows.
    const targetCatalog = this.instrumentsByUser.get(userId) ?? this.instruments;
    for (const sel of selections) {
      if (sel.name === undefined || sel.instrumentType === undefined) continue;
      const key = instrumentCatalogKey(sel.ticker, sel.marketCode);
      if (targetCatalog.has(key)) continue;
      targetCatalog.set(key, {
        ticker: sel.ticker,
        name: sel.name ?? null,
        instrumentType: sel.instrumentType ?? null,
        marketCode: sel.marketCode,
        barsBackfillStatus: "pending",
      });
    }

    const now = new Date().toISOString();
    const next = new Map<string, { ticker: string; marketCode: string; addedAt: string }>();
    for (const sel of selections) {
      next.set(instrumentCatalogKey(sel.ticker, sel.marketCode), {
        ticker: sel.ticker,
        marketCode: sel.marketCode,
        addedAt: now,
      });
    }
    this.monitoredTickers.set(userId, next);

    const newTickers = selections
      .filter((sel) => !currentKeys.has(instrumentCatalogKey(sel.ticker, sel.marketCode)))
      .map((sel) => sel.ticker);
    return { newTickers };
  }

  async listInstrumentsCatalog(
    search?: string,
    type?: string,
    marketCode?: string,
    userId?: string,
    options?: { includeInactive?: boolean },
  ): Promise<Array<Omit<InstrumentCatalogItemDto, "repairAvailableAt"> & {
    delistedAt?: string | null;
    supportState?: "supported" | "retired_by_admin" | "unsupported_by_provider";
  }>> {
    let results = [...this._catalogForUser(userId).values()].filter((instrument) => options?.includeInactive || !instrument.delistedAt);

    if (search) {
      const q = search.toLowerCase();
      results = results.filter(
        (i) => i.ticker.toLowerCase().includes(q) || (i.name?.toLowerCase().includes(q) ?? false),
      );
    }

    if (type) {
      results = results.filter((i) => i.instrumentType === type);
    }

    // KZO-169: optional market_code filter mirrors the Postgres behavior.
    if (marketCode) {
      results = results.filter((i) => i.marketCode === marketCode);
    }

    // Stable sort: ticker ASC, then marketCode ASC. Mirrors the Postgres
    // `ORDER BY ticker, market_code` so HTTP-layer assertions can compare
    // the two backends without re-sorting.
    results.sort((a, b) =>
      a.ticker === b.ticker ? a.marketCode.localeCompare(b.marketCode) : a.ticker.localeCompare(b.ticker),
    );

    return results.map((i) => ({
      ticker: i.ticker,
      name: i.name,
      instrumentType: i.instrumentType as InstrumentCatalogItemDto["instrumentType"],
      sector: normalizeInstrumentSector({
        marketCode: i.marketCode,
        instrumentType: (i.instrumentType as InstrumentCatalogItemDto["instrumentType"]) ?? null,
        industryCategoryRaw: i.industryCategoryRaw ?? null,
        gicsIndustryGroup: i.gicsIndustryGroup ?? null,
      }),
      marketCode: i.marketCode,
      barsBackfillStatus: i.barsBackfillStatus,
      lastRepairAt: i.lastRepairAt ?? null,
      delistedAt: i.delistedAt ?? null,
      supportState: i.supportState ?? "supported",
      // KZO-196 — GICS industry-group projection. Memory catalog mirrors the
      // Postgres SELECT shape so suite-3/4/6 tests see the same DTO.
      gicsIndustryGroup: i.gicsIndustryGroup ?? null,
    }));
  }

  async upsertInstrumentCatalog(
    _instruments: CatalogInstrument[],
    _delistings: DelistingRecord[],
    _options?: import("./types.js").UpsertInstrumentCatalogOptions,
  ): Promise<CatalogSyncResult> {
    // KZO-195 — MemoryPersistence intentionally does not model the instrument
    // catalog table (no integration concerns). Service-layer unit tests assert
    // against the pure detector directly; the Postgres-backed integration
    // suite (`auCatalogDelistingDetector.integration.test.ts`) is authoritative
    // per `.claude/rules/test-placement-persistence-backend.md`.
    return { upserted: 0, delisted: 0, absent: 0, guardTripped: false, absentTickers: [] };
  }

  // KZO-195 — admin instrument overrides. MemoryPersistence does not model
  // the catalog table; HTTP/E2E suites that need real assertions run against
  // Postgres. These no-ops let the route layer compile/run on memory backend
  // (returning a synthetic row for "found", or null for "not found"). Per
  // `.claude/rules/test-placement-persistence-backend.md`, behavioral tests
  // for these methods MUST be Postgres-backed integration tests.
  private _adminInstrumentMemRows: Map<
    string,
    import("./types.js").AdminInstrumentRow
  > = new Map();

  private _adminInstrumentKey(ticker: string, marketCode: string): string {
    return `${ticker}::${marketCode}`;
  }

  async instrumentAdminGet(
    ticker: string,
    marketCode: string,
  ): Promise<import("./types.js").AdminInstrumentRow | null> {
    return this._adminInstrumentMemRows.get(this._adminInstrumentKey(ticker, marketCode)) ?? null;
  }

  async listAdminInstruments(opts: {
    marketCode: string;
    page: number;
    limit: number;
    status?: "listed" | "delisted" | "excluded" | "all";
    supportState?: import("./types.js").AdminInstrumentRow["supportState"] | "all";
    search?: string;
    instrumentType?: import("@vakwen/domain").InstrumentType | "all";
    backfillStatus?: "pending" | "backfilling" | "ready" | "failed" | "all";
    sort?: "ticker_asc" | "ticker_desc" | "updated_desc" | "updated_asc";
  }): Promise<{
    items: import("./types.js").AdminInstrumentRow[];
    total: number;
    page: number;
    limit: number;
  }> {
    const page = Math.max(1, Math.floor(opts.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(opts.limit) || 50));
    const search = opts.search?.trim().toLowerCase() ?? "";
    const all = [...this._adminInstrumentMemRows.values()]
      .filter((row) => row.marketCode === opts.marketCode)
      .filter((row) => {
        const status = row.delistedAt ? "delisted" : row.delistingDetectionExcluded ? "excluded" : "listed";
        if (opts.status && opts.status !== "all" && status !== opts.status) return false;
        if (opts.supportState && opts.supportState !== "all" && row.supportState !== opts.supportState) {
          return false;
        }
        if (opts.instrumentType && opts.instrumentType !== "all" && row.instrumentType !== opts.instrumentType) {
          return false;
        }
        if (opts.backfillStatus && opts.backfillStatus !== "all" && row.barsBackfillStatus !== opts.backfillStatus) {
          return false;
        }
        if (search && !row.ticker.toLowerCase().includes(search) && !(row.name ?? "").toLowerCase().includes(search)) {
          return false;
        }
        return true;
      })
      .sort((a, b) => {
        switch (opts.sort) {
          case "ticker_desc":
            return b.ticker.localeCompare(a.ticker);
          case "updated_asc":
            return a.updatedAt.localeCompare(b.updatedAt);
          case "updated_desc":
            return b.updatedAt.localeCompare(a.updatedAt);
          case "ticker_asc":
          default:
            return a.ticker.localeCompare(b.ticker);
        }
      });
    const offset = (page - 1) * limit;
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, page, limit };
  }

  async listAdminMarketDataBackfillTargets(options: {
    marketCode: MarketCode;
    includeDemoUsers?: boolean;
  }): Promise<AdminMarketDataBackfillTargetRow[]> {
    const targets = new Map<string, AdminMarketDataBackfillTargetRow>();
    for (const [userId, selections] of this.monitoredTickers.entries()) {
      const user = [...this.usersByEmail.values()].find((candidate) => candidate.id === userId);
      if (!options.includeDemoUsers && user?.isDemo === true) continue;
      for (const selection of selections.values()) {
        if (selection.marketCode !== options.marketCode) continue;
        const instrument = this.instruments.get(instrumentCatalogKey(selection.ticker, selection.marketCode));
        if (!instrument || instrument.delistedAt || instrument.supportState === "retired_by_admin" || instrument.supportState === "unsupported_by_provider") {
          continue;
        }
        targets.set(instrumentCatalogKey(selection.ticker, selection.marketCode), {
          ticker: selection.ticker,
          marketCode: selection.marketCode as MarketCode,
        });
      }
    }
    for (const [userId, store] of this.stores.entries()) {
      const user = [...this.usersByEmail.values()].find((candidate) => candidate.id === userId);
      if (!options.includeDemoUsers && user?.isDemo === true) continue;
      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity <= 0) continue;
        const trade = store.accounting.facts.tradeEvents.find(
          (candidate) => candidate.accountId === lot.accountId && candidate.ticker === lot.ticker,
        );
        const marketCode = trade?.marketCode;
        if (marketCode !== options.marketCode) continue;
        const instrument = this.instruments.get(instrumentCatalogKey(lot.ticker, marketCode));
        if (!instrument || instrument.delistedAt || instrument.supportState === "retired_by_admin" || instrument.supportState === "unsupported_by_provider") {
          continue;
        }
        targets.set(instrumentCatalogKey(lot.ticker, marketCode), {
          ticker: lot.ticker,
          marketCode: marketCode as MarketCode,
        });
      }
    }
    return [...targets.values()].sort((a, b) => {
      const ticker = a.ticker.localeCompare(b.ticker);
      return ticker !== 0 ? ticker : a.marketCode.localeCompare(b.marketCode);
    });
  }

  async countAdminMarketDataTargetOwnership(options: {
    targets: AdminMarketDataBackfillTargetRow[];
  }): Promise<{ userCount: number; accountCount: number }> {
    const targetKeys = new Set(options.targets.map((target) => instrumentCatalogKey(target.ticker, target.marketCode)));
    const userIds = new Set<string>();
    const accountIds = new Set<string>();
    for (const [userId, selections] of this.monitoredTickers.entries()) {
      if ([...selections.values()].some((selection) => targetKeys.has(instrumentCatalogKey(selection.ticker, selection.marketCode)))) {
        userIds.add(userId);
      }
    }
    for (const [userId, store] of this.stores.entries()) {
      for (const lot of store.accounting.projections.lots) {
        if (lot.openQuantity <= 0) continue;
        const trade = store.accounting.facts.tradeEvents.find(
          (candidate) => candidate.accountId === lot.accountId && candidate.ticker === lot.ticker,
        );
        if (!trade?.marketCode || !targetKeys.has(instrumentCatalogKey(lot.ticker, trade.marketCode))) continue;
        userIds.add(userId);
        accountIds.add(lot.accountId);
      }
    }
    return { userCount: userIds.size, accountCount: accountIds.size };
  }

  async purgeAdminMarketData(input: AdminMarketDataPurgeInput): Promise<AdminMarketDataPurgeCounts> {
    const targetKeys = new Set(input.targets.map((target) => instrumentCatalogKey(target.ticker, target.marketCode)));
    const targetTickers = new Set(input.targets.map((target) => target.ticker));
    const inDateRange = (date: string): boolean => {
      if (input.fullHistory !== false) return true;
      if (input.startDate && date < input.startDate) return false;
      if (input.endDate && date > input.endDate) return false;
      return true;
    };
    const counts: AdminMarketDataPurgeCounts = {
      priceBars: 0,
      dividends: 0,
      backfillJobs: 0,
      providerOperationOutcomes: 0,
      providerErrorTrail: 0,
      providerResolutionMappings: 0,
      asxGicsEnrichment: 0,
      adminStateReset: 0,
      total: 0,
    };
    const shouldDeleteBars = input.categories.includes("price_bars");
    const shouldDeleteDividends = input.categories.includes("dividends");
    if (shouldDeleteBars) {
      for (let i = this.dailyBars.length - 1; i >= 0; i--) {
        const row = this.dailyBars[i]!;
        if (!targetKeys.has(instrumentCatalogKey(row.ticker, row.marketCode))) continue;
        if (!inDateRange(row.barDate)) continue;
        counts.priceBars++;
        if (!input.dryRun) this.dailyBars.splice(i, 1);
      }
    }
    if (shouldDeleteDividends) {
      for (const store of this.stores.values()) {
        for (let i = store.marketData.dividendEvents.length - 1; i >= 0; i--) {
          const event = store.marketData.dividendEvents[i]!;
          if (!targetTickers.has(event.ticker)) continue;
          if (!inDateRange(event.exDividendDate)) continue;
          const linked = store.accounting.facts.dividendLedgerEntries.some((entry) => entry.dividendEventId === event.id);
          if (linked) continue;
          counts.dividends++;
          if (!input.dryRun) store.marketData.dividendEvents.splice(i, 1);
        }
      }
    }
    if (input.categories.includes("provider_operation_outcomes")) {
      for (const [key, row] of [...this.providerOperationOutcomes.entries()]) {
        if (row.providerId !== input.providerId || row.marketCode !== input.marketCode) continue;
        if (targetTickers.size > 0 && !targetTickers.has(row.sourceSymbol)) continue;
        counts.providerOperationOutcomes++;
        if (!input.dryRun) this.providerOperationOutcomes.delete(key);
      }
    }
    if (input.categories.includes("provider_error_trail")) {
      for (let i = this.providerErrorTrail.length - 1; i >= 0; i--) {
        const row = this.providerErrorTrail[i]!;
        if (row.providerId !== input.providerId) continue;
        const context = row.context ?? {};
        if (context.marketCode && context.marketCode !== input.marketCode) continue;
        const symbol = String(context.ticker ?? context.symbol ?? context.sourceSymbol ?? "");
        if (targetTickers.size > 0 && symbol && !targetTickers.has(symbol)) continue;
        counts.providerErrorTrail++;
        if (!input.dryRun) this.providerErrorTrail.splice(i, 1);
      }
    }
    if (input.categories.includes("provider_resolution_mappings")) {
      for (const [key, row] of [...this.providerResolutionMappings.entries()]) {
        if (row.providerId !== input.providerId || row.marketCode !== input.marketCode) continue;
        if (targetTickers.size > 0 && !targetTickers.has(row.sourceSymbol)) continue;
        counts.providerResolutionMappings++;
        if (!input.dryRun) this.providerResolutionMappings.delete(key);
      }
    }
    if (input.categories.includes("asx_gics_enrichment") && input.marketCode === "AU") {
      for (const [key, instrument] of this.instruments.entries()) {
        if (instrument.marketCode !== "AU" || !instrument.gicsIndustryGroup) continue;
        if (targetKeys.size > 0 && !targetKeys.has(instrumentCatalogKey(instrument.ticker, instrument.marketCode))) continue;
        counts.asxGicsEnrichment++;
        if (!input.dryRun) this.instruments.set(key, { ...instrument, gicsIndustryGroup: null });
      }
    }
    if (input.categories.includes("admin_state_reset")) {
      for (const [key, row] of this._adminInstrumentMemRows.entries()) {
        if (row.marketCode !== input.marketCode) continue;
        if (targetKeys.size > 0 && !targetKeys.has(instrumentCatalogKey(row.ticker, row.marketCode))) continue;
        counts.adminStateReset++;
        if (!input.dryRun) {
          this._adminInstrumentMemRows.set(key, {
            ...row,
            supportState: "supported",
            barsBackfillStatus: "pending",
            updatedAt: new Date().toISOString(),
          });
        }
      }
    }
    counts.total =
      counts.priceBars
      + counts.dividends
      + counts.backfillJobs
      + counts.providerOperationOutcomes
      + counts.providerErrorTrail
      + counts.providerResolutionMappings
      + counts.asxGicsEnrichment
      + counts.adminStateReset;
    return counts;
  }

  async undeleteInstrument(
    ticker: string,
    marketCode: string,
    _actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const key = this._adminInstrumentKey(ticker, marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    const next: import("./types.js").AdminInstrumentRow = existing
      ? {
          ...existing,
          delistedAt: null,
          statusReason: null,
          absenceStreak: 0,
          lastSeenInCatalogAt: now,
          updatedAt: now,
        }
      : {
          ticker,
          marketCode,
          name: null,
          instrumentType: null,
          supportState: "supported",
          barsBackfillStatus: "pending",
          delistedAt: null,
          statusReason: null,
          lastSeenInCatalogAt: now,
          absenceStreak: 0,
          delistingDetectionExcluded: false,
          updatedAt: now,
        };
    this._adminInstrumentMemRows.set(key, next);
    return next;
  }

  async setInstrumentDelistingDetectionExcluded(
    ticker: string,
    marketCode: string,
    excluded: boolean,
    _actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const key = this._adminInstrumentKey(ticker, marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    const next: import("./types.js").AdminInstrumentRow = existing
      ? { ...existing, delistingDetectionExcluded: excluded, updatedAt: now }
      : {
          ticker,
          marketCode,
          name: null,
          instrumentType: null,
          supportState: "supported",
          barsBackfillStatus: "pending",
          delistedAt: null,
          statusReason: null,
          lastSeenInCatalogAt: null,
          absenceStreak: 0,
          delistingDetectionExcluded: excluded,
          updatedAt: now,
        };
    this._adminInstrumentMemRows.set(key, next);
    return next;
  }

  async setInstrumentSupportState(
    ticker: string,
    marketCode: string,
    supportState: import("./types.js").AdminInstrumentRow["supportState"],
    _actorUserId: string,
  ): Promise<import("./types.js").AdminInstrumentRow> {
    const key = this._adminInstrumentKey(ticker, marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    const next: import("./types.js").AdminInstrumentRow = existing
      ? { ...existing, supportState, updatedAt: now }
      : {
          ticker,
          marketCode,
          name: null,
          instrumentType: null,
          supportState,
          barsBackfillStatus: "pending",
          delistedAt: null,
          statusReason: null,
          lastSeenInCatalogAt: null,
          absenceStreak: 0,
          delistingDetectionExcluded: false,
          updatedAt: now,
        };
    this._adminInstrumentMemRows.set(key, next);
    return next;
  }

  // --- Notifications (KZO-132) — functional in-memory impl for E2E ---

  async createNotification(notification: {
    userId: string;
    severity: "info" | "warning" | "error";
    source: string;
    sourceRef?: string;
    title: string;
    body?: string;
    detail?: unknown;
  }): Promise<string> {
    const id = randomUUID();
    const now = new Date().toISOString();
    const entry: MemoryNotification = {
      id,
      userId: notification.userId,
      severity: notification.severity,
      source: notification.source,
      sourceRef: notification.sourceRef ?? null,
      title: notification.title,
      body: notification.body ?? null,
      detail: notification.detail ?? null,
      readAt: null,
      escalatedAt: null,
      dismissedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const list = this.notifications.get(notification.userId) ?? [];
    list.push(entry);
    this.notifications.set(notification.userId, list);
    return id;
  }

  async getNotificationsForUser(userId: string, opts: { page: number; limit: number }): Promise<{ notifications: NotificationDto[]; total: number }> {
    const all = (this.notifications.get(userId) ?? [])
      .filter((n) => n.dismissedAt === null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (opts.page - 1) * opts.limit;
    const page = all.slice(offset, offset + opts.limit);
    return { notifications: page.map(toNotificationDto), total: all.length };
  }

  async getUnreadCount(userId: string): Promise<number> {
    return (this.notifications.get(userId) ?? [])
      .filter((n) => n.readAt === null && n.dismissedAt === null)
      .length;
  }

  async markNotificationRead(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const n = list.find((x) => x.id === notificationId && x.dismissedAt === null);
    if (!n) throw routeError(404, "notification_not_found", "Notification not found");
    n.readAt = new Date().toISOString();
    n.updatedAt = n.readAt;
  }

  async markAllRead(userId: string): Promise<void> {
    const now = new Date().toISOString();
    for (const n of this.notifications.get(userId) ?? []) {
      if (n.readAt === null && n.dismissedAt === null) {
        n.readAt = now;
        n.updatedAt = now;
      }
    }
  }

  async dismissNotification(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const n = list.find((x) => x.id === notificationId && x.dismissedAt === null);
    if (!n) throw routeError(404, "notification_not_found", "Notification not found");
    n.dismissedAt = new Date().toISOString();
    n.updatedAt = n.dismissedAt;
  }

  async markNotificationEscalated(userId: string, notificationId: string): Promise<void> {
    const list = this.notifications.get(userId) ?? [];
    const n = list.find((x) => x.id === notificationId && x.dismissedAt === null);
    if (!n) throw routeError(404, "notification_not_found", "Notification not found");
    n.escalatedAt = new Date().toISOString();
    n.updatedAt = n.escalatedAt;
  }

  // --- Refresh Batches (KZO-132) — no-op stubs ---

  async createRefreshBatch(_userId: string | null, _jobsTotal: number): Promise<string> {
    return "";
  }

  async updateBatchTickerResult(
    _batchId: string,
    _ticker: string,
    _result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
  ): Promise<{ jobsSucceeded: number; jobsFailed: number; jobsTotal: number } | null> {
    return null;
  }

  async getRefreshBatch(_batchId: string): Promise<{
    id: string;
    status: string;
    jobsTotal: number;
    jobsSucceeded: number;
    jobsFailed: number;
    tickerResults: Record<string, { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string }>;
  } | null> {
    return null;
  }

  async completeRefreshBatch(_batchId: string, _status: "completed" | "failed"): Promise<void> {}

  // --- Test helpers ---

  /** @internal Test-only: seed an instrument into the in-memory catalog. */
  _seedInstrument(instrument: MemoryInstrument, userId?: string): void {
    // KZO-169: store under the composite (ticker|marketCode) key so two BHP
    // rows on different markets can coexist in MemoryPersistence.
    this._catalogForWrite(userId).set(
      instrumentCatalogKey(instrument.ticker, instrument.marketCode),
      instrument,
    );
    // Mirror into the admin instrument map so `listAdminInstruments`
    // (and the admin market-data instruments route) sees rows seeded via test
    // helpers, including the E2E `/__e2e/seed-instruments` endpoint which
    // passes a userId. Catalog instruments are global by design; the admin-row
    // store is independent of the per-user catalog. Iter 8 (KZO-195) removed
    // the iter-4 `if (!userId)` gate that suppressed mirror writes whenever
    // the seeder threaded a userId — it left the admin endpoint blind to
    // E2E-seeded rows. The lockstep clear in `_replaceInstruments` (also
    // unconditional now) preserves the iter-4 invariant that admin overrides
    // (exclusion, undelete) carry across re-seeds for matching keys.
    const key = this._adminInstrumentKey(instrument.ticker, instrument.marketCode);
    const existing = this._adminInstrumentMemRows.get(key);
    const now = new Date().toISOString();
    this._adminInstrumentMemRows.set(key, {
      ticker: instrument.ticker,
      marketCode: instrument.marketCode,
      name: instrument.name,
      instrumentType: instrument.instrumentType,
      supportState: existing?.supportState ?? "supported",
      barsBackfillStatus: (instrument.barsBackfillStatus ?? existing?.barsBackfillStatus ?? "pending") as
        | "pending"
        | "backfilling"
        | "ready"
        | "failed",
      delistedAt: instrument.delistedAt ?? existing?.delistedAt ?? null,
      statusReason: existing?.statusReason ?? null,
      // Preserve admin-set absence-detection state across re-seeds
      // (undelete / exclusion / streak) so test scenarios that seed catalog
      // rows AFTER calling `setInstrumentDelistingDetectionExcluded` don't
      // lose the admin override.
      lastSeenInCatalogAt: existing?.lastSeenInCatalogAt ?? now,
      absenceStreak: existing?.absenceStreak ?? 0,
      delistingDetectionExcluded: existing?.delistingDetectionExcluded ?? false,
      updatedAt: now,
    });
  }

  /** @internal Test-only: replace the in-memory catalog with the provided instruments. */
  _replaceInstruments(instruments: MemoryInstrument[], userId?: string): void {
    const catalog = this._catalogForWrite(userId);
    catalog.clear();
    // KZO-195 (iter 8) — snapshot admin overrides BEFORE clearing so the
    // per-row `existing?.*` carry-over inside `_seedInstrument` can still
    // restore exclusion / undelete / streak state for tickers present in
    // the new replacement set. Tickers absent from `instruments` are
    // intentionally dropped to keep the admin map in lockstep with the
    // catalog. Catalog instruments are global by design — userId scope
    // applies to the legacy per-user catalog map only, not the admin store.
    const overrideSnapshot = new Map(this._adminInstrumentMemRows);
    this._adminInstrumentMemRows.clear();
    for (const instrument of instruments) {
      const key = this._adminInstrumentKey(instrument.ticker, instrument.marketCode);
      const carry = overrideSnapshot.get(key);
      if (carry) {
        // Re-stamp the override so `_seedInstrument`'s `existing?.*` lookup
        // sees it. `_seedInstrument` overwrites name / instrumentType /
        // updatedAt but preserves absenceStreak / delistingDetectionExcluded
        // / lastSeenInCatalogAt / statusReason via the same carry pattern.
        this._adminInstrumentMemRows.set(key, carry);
      }
      this._seedInstrument(instrument, userId);
    }
    if (userId) {
      const store = this.stores.get(userId);
      if (store) {
        setStoreInstruments(store, [...catalog.values()].map(memoryInstrumentToDef));
        this.stores.set(userId, store);
      }
    }
  }

  private _catalogForUser(userId?: string): Map<string, MemoryInstrument> {
    return (userId ? this.instrumentsByUser.get(userId) : undefined) ?? this.instruments;
  }

  private _catalogForWrite(userId?: string): Map<string, MemoryInstrument> {
    if (!userId) {
      return this.instruments;
    }

    let catalog = this.instrumentsByUser.get(userId);
    if (!catalog) {
      catalog = new Map<string, MemoryInstrument>();
      this.instrumentsByUser.set(userId, catalog);
    }
    return catalog;
  }

  private getUserById(userId: string): MemoryUser | undefined {
    return [...this.usersByEmail.values()].find((user) => user.id === userId);
  }

  private assertUserExists(userId: string): void {
    if (!this.getUserById(userId)) {
      throw routeError(404, "user_not_found", "User not found");
    }
  }

  private assertShareExists(shareId: string): void {
    if (!this.portfolioShares.some((share) => share.id === shareId)) {
      throw routeError(404, "share_not_found", "Share not found");
    }
  }

  private buildCapabilityGrants(capabilities: ShareCapability[], grantedByUserId: string | null): MemoryCapabilityGrant[] {
    if (grantedByUserId) this.assertUserExists(grantedByUserId);
    const grantedAt = new Date().toISOString();
    return [...new Set(capabilities)].sort().map((capability) => ({
      capability,
      grantedByUserId,
      grantedAt,
    }));
  }

  private cloneCapabilityGrants(grants: MemoryCapabilityGrant[]): MemoryCapabilityGrant[] {
    return grants.map((grant) => ({ ...grant }));
  }

  private listCapabilityValues(grants: MemoryCapabilityGrant[]): ShareCapability[] {
    return grants.map((grant) => grant.capability).sort();
  }

  private normalizeToolToggles(toolToggles: Record<string, boolean>): Record<string, boolean> {
    return Object.fromEntries(
      Object.entries(toolToggles)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([toolName, enabled]) => [toolName, Boolean(enabled)]),
    );
  }

  private cloneDraftRow(row: AiTransactionDraftRowRecord): AiTransactionDraftRowRecord {
    return {
      ...row,
      normalizedPayload: { ...row.normalizedPayload },
      preflightIssues: [...row.preflightIssues],
      warnings: [...row.warnings],
    };
  }

  private cloneDraftEvent(event: AiTransactionDraftEventRecord): AiTransactionDraftEventRecord {
    return {
      ...event,
      beforeState: event.beforeState ? { ...event.beforeState } : null,
      afterState: event.afterState ? { ...event.afterState } : null,
      metadata: { ...event.metadata },
    };
  }

  private async insertInvite(input: CreateInviteInput): Promise<InviteRecord> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const code = generateInviteCode();
      if (this.invites.has(code)) {
        continue;
      }
      const invite: MemoryInvite = {
        code,
        email: normalizeEmail(input.email),
        role: input.role,
        expiresAt: input.expiresAt,
        revokedAt: null,
        usedAt: null,
        issuedByUserId: input.issuedByUserId,
        shareOwnerUserId: null,
        createdAt: new Date().toISOString(),
      };
      this.invites.set(code, invite);
      return { ...invite };
    }
    throw new Error("Failed to generate a unique invite code after 3 attempts");
  }

  // ── Admin portal methods (KZO-144) ──────────────────────────────────────────

  async listUsers(options: AdminUserListOptions): Promise<AdminUserListResponse> {
    const { page, limit, search, role, status } = options;
    let users = [...this.usersByEmail.values()];

    // Filter by status (default: active + disabled)
    if (status) {
      users = users.filter((u) => deriveUserStatus(u) === status);
    }
    // When status is undefined (e.g. "All" tab), no status filter — returns all users

    if (role) {
      users = users.filter((u) => u.role === role);
    }

    if (search) {
      const lower = search.toLowerCase();
      users = users.filter(
        (u) =>
          u.email.toLowerCase().includes(lower) ||
          (u.displayName && u.displayName.toLowerCase().includes(lower)),
      );
    }

    // Sort by createdAt DESC
    users.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = users.length;
    const offset = (page - 1) * limit;
    const pageItems = users.slice(offset, offset + limit);

    return {
      items: pageItems.map((u) => ({
        userId: u.id,
        email: u.email,
        displayName: u.displayName,
        role: u.role,
        status: deriveUserStatus(u),
        lastSeenAt: null,
        createdAt: u.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  async changeUserRole(userId: string, newRole: UserRole, auditInput: Omit<AuditLogInput, "action">): Promise<AuthUserRecord> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    const fromRole = user.role;

    // Atomic last-admin guard when demoting an admin
    if (fromRole === "admin" && newRole !== "admin") {
      this.assertNotLastAdminMem();
    }

    user.role = newRole;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_role_change",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, fromRole, toRole: newRole, targetEmail: user.email },
    });

    return mapMemoryUser(user);
  }

  async disableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    if (user.role === "admin") {
      this.assertNotLastAdminMem();
    }

    user.deactivatedAt = new Date().toISOString();
    user.sessionVersion += 1;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_disable_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email },
    });
    await this.appendAuditLog({
      ...auditInput,
      action: "session_force_logout",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, reason: "admin_disable_user" },
    });
  }

  async enableUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    user.deactivatedAt = null;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_enable_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email },
    });
  }

  async softDeleteUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    if (user.role === "admin") {
      this.assertNotLastAdminMem();
    }

    user.deletedAt = new Date().toISOString();
    user.sessionVersion += 1;

    await this.appendAuditLog({
      ...auditInput,
      action: "admin_delete_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email },
    });
    await this.appendAuditLog({
      ...auditInput,
      action: "session_force_logout",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, reason: "admin_delete_user" },
    });
  }

  async hardPurgeUser(userId: string, auditInput: Omit<AuditLogInput, "action">): Promise<void> {
    const user = this.getUserById(userId);
    if (!user) throw routeError(404, "user_not_found", "User not found");

    if (user.role === "admin") {
      this.assertNotLastAdminMem();
    }

    // Emit audit entries BEFORE deletion (FK ON DELETE SET NULL preserves them)
    await this.appendAuditLog({
      ...auditInput,
      action: "admin_hard_purge_user",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, targetDisplayName: user.displayName },
    });
    await this.appendAuditLog({
      ...auditInput,
      action: "session_force_logout",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, targetEmail: user.email, reason: "admin_hard_purge_user" },
    });

    // Cascade delete user data
    this.stores.delete(userId);
    this.idempotencyKeys.delete(userId);
    this.monitoredTickers.delete(userId);
    this.notifications.delete(userId);
    this.instrumentsByUser.delete(userId);
    // ui-enhancement — drop any soft-deleted account shadows owned by this user.
    for (const key of [...this.softDeletedAccounts.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.softDeletedAccounts.delete(key);
      }
    }

    // Remove holding snapshots for user
    const snapshotsToRemove = this.holdingSnapshots.filter((s) => s.userId === userId);
    for (const s of snapshotsToRemove) {
      const idx = this.holdingSnapshots.indexOf(s);
      if (idx >= 0) this.holdingSnapshots.splice(idx, 1);
    }

    // KZO-165: Remove currency wallet snapshots for user (mirrors postgres cascade).
    for (let i = this.currencyWalletSnapshots.length - 1; i >= 0; i -= 1) {
      if (this.currencyWalletSnapshots[i].userId === userId) {
        this.currencyWalletSnapshots.splice(i, 1);
      }
    }

    // Remove owned or grantee share records.
    for (let i = this.portfolioShares.length - 1; i >= 0; i -= 1) {
      const share = this.portfolioShares[i];
      if (share.ownerUserId === userId || share.granteeUserId === userId) {
        this.portfolioShares.splice(i, 1);
        continue;
      }
      if (share.revokedByUserId === userId) {
        share.revokedByUserId = null;
      }
    }

    this.anonymousShareTokenLocks.delete(userId);
    for (let i = this.anonymousShareTokens.length - 1; i >= 0; i -= 1) {
      if (this.anonymousShareTokens[i].ownerUserId === userId) {
        this.anonymousShareTokens.splice(i, 1);
      }
    }

    // SET NULL on invites.issued_by_user_id and invites.share_owner_user_id
    for (const invite of this.invites.values()) {
      if (invite.issuedByUserId === userId) {
        invite.issuedByUserId = null;
      }
      if (invite.shareOwnerUserId === userId) {
        invite.shareOwnerUserId = null;
      }
    }

    for (const [batchId, batch] of this.aiTransactionDraftBatches) {
      if (batch.ownerUserId === userId) {
        this.aiTransactionDraftBatches.delete(batchId);
        this.aiTransactionDraftRows.delete(batchId);
        this.aiTransactionDraftUnsupportedItems.delete(batchId);
      } else if (batch.createdByUserId === userId) {
        batch.createdByUserId = null;
      }
    }
    for (const events of this.aiTransactionDraftEvents.values()) {
      for (const event of events) {
        if (event.ownerUserId === userId) event.ownerUserId = null;
        if (event.actorUserId === userId) event.actorUserId = null;
      }
    }

    const deletedMutationPreviewIds = new Set<string>();
    for (const [previewId, preview] of this.postedTransactionMutationPreviews) {
      if (preview.ownerUserId === userId) {
        this.postedTransactionMutationPreviews.delete(previewId);
        deletedMutationPreviewIds.add(previewId);
      } else if (preview.actorUserId === userId) {
        preview.actorUserId = null;
      }
    }
    const deletedMutationRunIds = new Set<string>();
    for (const [runId, run] of this.postedTransactionMutationRuns) {
      if (run.ownerUserId === userId || deletedMutationPreviewIds.has(run.previewId)) {
        this.postedTransactionMutationRuns.delete(runId);
        deletedMutationRunIds.add(runId);
      } else if (run.actorUserId === userId) {
        run.actorUserId = null;
      }
    }
    for (const [tradeEventId, lineage] of this.postedTransactionMutationDeletedDraftLineage) {
      if (lineage.ownerUserId === userId || deletedMutationRunIds.has(lineage.mutationRunId)) {
        this.postedTransactionMutationDeletedDraftLineage.delete(tradeEventId);
      } else if (lineage.deletedByUserId === userId) {
        lineage.deletedByUserId = null;
      }
    }

    // SET NULL on audit_log actor/target
    for (const entry of this.auditLog) {
      if (entry.actorUserId === userId) entry.actorUserId = null;
      if (entry.targetUserId === userId) entry.targetUserId = null;
    }

    // Remove user
    this.usersByEmail.delete(user.email);
  }

  // ── ui-enhancement — Account lifecycle ──────────────────────────────────

  async createAccount(
    input: import("./types.js").CreateAccountInput,
  ): Promise<import("./types.js").AccountMutationPersistenceResult> {
    const store = this.getOrCreateStore(input.userId);
    const name = input.name.trim();
    const hadActiveAccounts = store.accounts.length > 0;

    if (store.accounts.some((account) => account.name === name)) {
      throw routeError(409, "account_name_in_use", "An account with that name already exists.");
    }

    const accountId = randomUUID();
    const feeProfile = createDefaultFeeProfile(accountId, input.defaultCurrency);
    const account: AccountDto = {
      id: accountId,
      userId: input.userId,
      name,
      feeProfileId: feeProfile.id,
      defaultCurrency: input.defaultCurrency,
      accountType: input.accountType,
    };
    store.feeProfiles.push(feeProfile);
    store.accounts.push(account);
    if (!hadActiveAccounts) {
      const currentPreferences = this.userPreferences.get(input.userId) ?? {};
      this.userPreferences.set(input.userId, {
        ...currentPreferences,
        reportingCurrency: input.defaultCurrency,
      });
    }

    await this.appendAuditLog({
      ...input.auditInput,
      action: "account_created",
      targetUserId: input.userId,
      metadata: {
        ...input.auditInput.metadata,
        accountId,
        accountName: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        feeProfileId: feeProfile.id,
      },
    });

    return {
      account,
      feeProfile: toFeeProfileDto(feeProfile),
      capabilities: deriveCapabilitiesDto(store.accounts),
    };
  }

  async updateAccount(
    input: import("./types.js").UpdateAccountInput,
  ): Promise<import("./types.js").AccountMutationPersistenceResult> {
    const store = this.getOrCreateStore(input.userId);
    const accountIndex = store.accounts.findIndex((item) => item.id === input.accountId);
    const account = store.accounts[accountIndex];
    if (!account) {
      throw routeError(404, "account_not_found", `Account ${input.accountId} was not found.`);
    }

    const nextAccount = { ...account };
    const changedFields: string[] = [];

    if (input.feeProfileId !== undefined) {
      const profile = store.feeProfiles.find((item) => item.id === input.feeProfileId);
      if (!profile) {
        throw routeError(404, "fee_profile_not_found", `Fee profile ${input.feeProfileId} was not found.`);
      }
      if (profile.accountId !== account.id) {
        throw routeError(
          400,
          "invalid_fee_profile",
          `Fee profile ${input.feeProfileId} is not owned by account ${account.id}.`,
        );
      }
      nextAccount.feeProfileId = input.feeProfileId;
      changedFields.push("feeProfileId");
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (store.accounts.some((item) => item.id !== account.id && item.name === name)) {
        throw routeError(409, "account_name_in_use", "An account with that name already exists.");
      }
      nextAccount.name = name;
      changedFields.push("name");
    }

    if (input.defaultCurrency !== undefined && input.defaultCurrency !== account.defaultCurrency) {
      const hasCashEntries = store.accounting.facts.cashLedgerEntries.some((entry) => entry.accountId === account.id);
      const hasTradeEvents = store.accounting.facts.tradeEvents.some((event) => event.accountId === account.id);
      if (hasCashEntries || hasTradeEvents) {
        throw routeError(
          409,
          "currency_change_blocked",
          "Cannot change default currency: account has existing cash entries or trade events. Open a new account or contact support.",
        );
      }
      nextAccount.defaultCurrency = input.defaultCurrency;
      changedFields.push("defaultCurrency");
    }

    if (input.accountType !== undefined) {
      nextAccount.accountType = input.accountType;
      changedFields.push("accountType");
    }

    const feeProfile = store.feeProfiles.find((item) => item.id === nextAccount.feeProfileId);
    if (!feeProfile) {
      throw routeError(404, "fee_profile_not_found", `Fee profile ${nextAccount.feeProfileId} was not found.`);
    }

    store.accounts[accountIndex] = nextAccount;

    if (changedFields.includes("defaultCurrency")) {
      const previousMarketCode = marketCodeFor(account.defaultCurrency);
      const nextMarketCode = marketCodeFor(nextAccount.defaultCurrency);
      if (previousMarketCode !== nextMarketCode) {
        const key = `${account.id}:${previousMarketCode}`;
        const previousSettings = this.accountMarketDividendSettings.get(key);
        if (previousSettings && previousSettings.fallbackParValue !== null) {
          this.accountMarketDividendSettings.set(key, {
            ...previousSettings,
            fallbackParValue: null,
            version: previousSettings.version + 1,
            updatedAt: new Date().toISOString(),
          });
          await this.appendAuditLog({
            ...input.auditInput,
            action: "account_market_dividend_settings_updated",
            targetUserId: input.userId,
            metadata: {
              ...input.auditInput.metadata,
              accountId: input.accountId,
              marketCode: previousMarketCode,
              fallbackParValue: null,
            },
          });
        }
      }
    }

    await this.appendAuditLog({
      ...input.auditInput,
      action: "account_updated",
      targetUserId: input.userId,
      metadata: {
        ...input.auditInput.metadata,
        accountId: nextAccount.id,
        accountName: nextAccount.name,
        accountType: nextAccount.accountType,
        defaultCurrency: nextAccount.defaultCurrency,
        feeProfileId: nextAccount.feeProfileId,
        changedFields,
      },
    });

    const capabilities = deriveCapabilitiesDto(store.accounts);
    if (changedFields.includes("defaultCurrency")) {
      const prefsBefore = await this.getUserPreferences(input.userId);
      const reportingCurrencyBefore = getStoredReportingCurrencyPreference(prefsBefore);
      const effectiveReportingCurrencyBefore = reportingCurrencyBefore ?? "TWD";
      const reportingCurrencyAfter = capabilities.configuredCurrencies.length === 0
        ? null
        : capabilities.configuredCurrencies.includes(effectiveReportingCurrencyBefore)
          ? reportingCurrencyBefore
          : capabilities.configuredCurrencies[0]!;
      if (reportingCurrencyBefore !== reportingCurrencyAfter) {
        const nextPrefs = { ...prefsBefore };
        if (reportingCurrencyAfter === null) {
          delete nextPrefs.reportingCurrency;
        } else {
          nextPrefs.reportingCurrency = reportingCurrencyAfter;
        }
        if (Object.keys(nextPrefs).length === 0) {
          this.userPreferences.delete(input.userId);
        } else {
          this.userPreferences.set(input.userId, nextPrefs);
        }
      }
    }

    return {
      account: nextAccount,
      feeProfile: toFeeProfileDto(feeProfile),
      capabilities,
      changedFields,
    };
  }

  async softDeleteAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<AccountLifecyclePersistenceResult> {
    const shadowKey = `${userId}:${accountId}`;
    const existingShadow = this.softDeletedAccounts.get(shadowKey);
    if (existingShadow) {
      // Idempotent — already soft-deleted.
      const store = this.stores.get(userId);
      const capabilities = deriveCapabilitiesDto(store?.accounts ?? []);
      const prefs = await this.getUserPreferences(userId);
      const { deletedAt, ...accountFields } = existingShadow;
      return buildLifecyclePersistenceResult(accountFields, deletedAt, null, capabilities, prefs);
    }
    const store = this.stores.get(userId);
    if (!store) {
      throw routeError(404, "account_not_found", "Account not found.");
    }
    const idx = store.accounts.findIndex((acc) => acc.id === accountId);
    if (idx === -1) {
      throw routeError(404, "account_not_found", "Account not found.");
    }
    const account = store.accounts[idx];
    const deletedAt = new Date().toISOString();
    this.softDeletedAccounts.set(shadowKey, { ...account, deletedAt });
    store.accounts.splice(idx, 1);
    const capabilities = deriveCapabilitiesDto(store.accounts);
    const prefsBefore = await this.getUserPreferences(userId);
    const reportingCurrencyBefore = getStoredReportingCurrencyPreference(prefsBefore);
    const effectiveReportingCurrencyBefore = reportingCurrencyBefore ?? "TWD";
    const reportingCurrencyAfter = capabilities.configuredCurrencies.length === 0
      ? null
      : capabilities.configuredCurrencies.includes(effectiveReportingCurrencyBefore)
        ? reportingCurrencyBefore
        : capabilities.configuredCurrencies[0]!;
    if (reportingCurrencyBefore !== reportingCurrencyAfter) {
      const nextPrefs = { ...prefsBefore };
      if (reportingCurrencyAfter === null) {
        delete nextPrefs.reportingCurrency;
      } else {
        nextPrefs.reportingCurrency = reportingCurrencyAfter;
      }
      if (Object.keys(nextPrefs).length === 0) {
        this.userPreferences.delete(userId);
      } else {
        this.userPreferences.set(userId, nextPrefs);
      }
    }
    const prefsAfter = await this.getUserPreferences(userId);

    await this.appendAuditLog({
      ...auditInput,
      action: "account_soft_deleted",
      targetUserId: userId,
      metadata: {
        ...auditInput.metadata,
        accountId,
        accountName: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        reportingCurrencyBefore,
        reportingCurrencyAfter,
      },
    });

    return buildLifecyclePersistenceResult(account, deletedAt, null, capabilities, prefsAfter);
  }

  async restoreAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
  ): Promise<AccountLifecyclePersistenceResult> {
    const shadowKey = `${userId}:${accountId}`;
    const shadow = this.softDeletedAccounts.get(shadowKey);
    if (!shadow) {
      throw routeError(404, "account_not_found", "Account not found or not soft-deleted.");
    }
    const store = this.stores.get(userId);
    if (!store) {
      throw routeError(404, "account_not_found", "Account not found.");
    }

    const priorName = shadow.name;
    const activeNames = new Set(store.accounts.map((acc) => acc.name));
    let finalName = priorName;
    if (activeNames.has(priorName)) {
      finalName = `${priorName} (restored)`;
      let suffix = 2;
      while (activeNames.has(finalName) && suffix <= 20) {
        finalName = `${priorName} (restored ${suffix})`;
        suffix += 1;
      }
      if (activeNames.has(finalName)) {
        throw routeError(
          409,
          "account_restore_name_unresolvable",
          "Could not auto-rename restored account: too many name collisions (>20 candidates tried).",
        );
      }
    }

    // Strip deletedAt and adopt the final (possibly renamed) name.
    const { deletedAt: _deletedAt, ...accountFields } = shadow;
    void _deletedAt;
    const restoredAccount = { ...accountFields, name: finalName };
    store.accounts.push(restoredAccount);
    this.softDeletedAccounts.delete(shadowKey);
    const capabilities = deriveCapabilitiesDto(store.accounts);
    const prefsBefore = await this.getUserPreferences(userId);
    const reportingCurrencyBefore = getStoredReportingCurrencyPreference(prefsBefore);
    const effectiveReportingCurrencyBefore = reportingCurrencyBefore ?? "TWD";
    const reportingCurrencyAfter = capabilities.configuredCurrencies.length === 0
      ? null
      : capabilities.configuredCurrencies.includes(effectiveReportingCurrencyBefore)
        ? reportingCurrencyBefore
        : capabilities.configuredCurrencies[0]!;
    if (reportingCurrencyBefore !== reportingCurrencyAfter) {
      const nextPrefs = { ...prefsBefore };
      if (reportingCurrencyAfter === null) {
        delete nextPrefs.reportingCurrency;
      } else {
        nextPrefs.reportingCurrency = reportingCurrencyAfter;
      }
      if (Object.keys(nextPrefs).length === 0) {
        this.userPreferences.delete(userId);
      } else {
        this.userPreferences.set(userId, nextPrefs);
      }
    }
    const prefsAfter = await this.getUserPreferences(userId);
    const feeProfiles = store.feeProfiles
      .filter((profile) => profile.accountId === accountId)
      .map(toFeeProfileDto);
    const feeProfileBindings = store.feeProfileBindings
      .filter((binding) => binding.accountId === accountId);

    await this.appendAuditLog({
      ...auditInput,
      action: "account_restored",
      targetUserId: userId,
      metadata: { ...auditInput.metadata, accountId, priorName, finalName },
    });

    return buildLifecyclePersistenceResult(
      restoredAccount,
      null,
      finalName,
      capabilities,
      prefsAfter,
      { feeProfiles, feeProfileBindings },
    );
  }

  async hardPurgeAccount(
    accountId: string,
    userId: string,
    auditInput: Omit<AuditLogInput, "action">,
    options: { mustBeSoftDeleted?: boolean } = {},
  ): Promise<AccountLifecyclePersistenceResult> {
    const mustBeSoftDeleted = options.mustBeSoftDeleted ?? true;
    const shadowKey = `${userId}:${accountId}`;
    const shadow = this.softDeletedAccounts.get(shadowKey);
    const store = this.stores.get(userId);
    const activeIdx = store
      ? store.accounts.findIndex((acc) => acc.id === accountId)
      : -1;

    if (!shadow && activeIdx === -1) {
      throw routeError(404, "account_not_found", "Account not found.");
    }
    if (mustBeSoftDeleted && !shadow) {
      throw routeError(
        404,
        "account_not_soft_deleted",
        "Account must be soft-deleted before cron-driven hard-purge.",
      );
    }

    const account = shadow ?? store!.accounts[activeIdx];

    // Audit BEFORE removal so the entry survives.
    await this.appendAuditLog({
      ...auditInput,
      action: "account_hard_purged",
      targetUserId: userId,
      metadata: {
        ...auditInput.metadata,
        accountId,
        accountName: account.name,
        accountType: account.accountType,
        defaultCurrency: account.defaultCurrency,
        deletedAt: shadow ? shadow.deletedAt : null,
      },
    });

    // Cascade account-scoped data from the in-memory store (mirrors Postgres
    // explicit-DELETE list). fee profiles + overrides cascade with the
    // account row.
    if (store) {
      const facts = store.accounting.facts;
      const projections = store.accounting.projections;
      facts.cashLedgerEntries = facts.cashLedgerEntries.filter((e) => e.accountId !== accountId);
      facts.tradeEvents = facts.tradeEvents.filter((e) => e.accountId !== accountId);
      const removedDividendIds = new Set(
        facts.dividendLedgerEntries.filter((e) => e.accountId === accountId).map((e) => e.id),
      );
      facts.dividendLedgerEntries = facts.dividendLedgerEntries.filter(
        (e) => e.accountId !== accountId,
      );
      facts.dividendDeductionEntries = facts.dividendDeductionEntries.filter(
        (e) => !removedDividendIds.has(e.dividendLedgerEntryId),
      );
      facts.dividendSourceLines = facts.dividendSourceLines.filter(
        (e) => !removedDividendIds.has(e.dividendLedgerEntryId),
      );
      facts.positionActions = facts.positionActions.filter((action) => action.accountId !== accountId);
      facts.corporateActions = facts.corporateActions.filter((c) => c.accountId !== accountId);
      const removedLotIds = new Set(
        projections.lots.filter((l) => l.accountId === accountId).map((l) => l.id),
      );
      projections.lots = projections.lots.filter((l) => l.accountId !== accountId);
      projections.lotAllocations = projections.lotAllocations.filter(
        (l) => !removedLotIds.has(l.lotId),
      );
      store.feeProfiles = store.feeProfiles.filter((p) => p.accountId !== accountId);
      store.feeProfileBindings = store.feeProfileBindings.filter(
        (b) => b.accountId !== accountId,
      );
      if (activeIdx !== -1) {
        store.accounts.splice(activeIdx, 1);
      }
    }

    // KZO-115 / KZO-165 — top-level snapshot arrays scoped by accountId.
    for (let i = this.holdingSnapshots.length - 1; i >= 0; i -= 1) {
      if (this.holdingSnapshots[i].accountId === accountId) {
        this.holdingSnapshots.splice(i, 1);
      }
    }
    for (let i = this.currencyWalletSnapshots.length - 1; i >= 0; i -= 1) {
      if (this.currencyWalletSnapshots[i].accountId === accountId) {
        this.currencyWalletSnapshots.splice(i, 1);
      }
    }

    this.softDeletedAccounts.delete(shadowKey);

    const capabilities = deriveCapabilitiesDto(store?.accounts ?? []);
    const prefsBefore = await this.getUserPreferences(userId);
    const reportingCurrencyBefore = getStoredReportingCurrencyPreference(prefsBefore);
    const effectiveReportingCurrencyBefore = reportingCurrencyBefore ?? "TWD";
    const reportingCurrencyAfter = capabilities.configuredCurrencies.length === 0
      ? null
      : capabilities.configuredCurrencies.includes(effectiveReportingCurrencyBefore)
        ? reportingCurrencyBefore
        : capabilities.configuredCurrencies[0]!;
    if (reportingCurrencyBefore !== reportingCurrencyAfter) {
      const nextPrefs = { ...prefsBefore };
      if (reportingCurrencyAfter === null) {
        delete nextPrefs.reportingCurrency;
      } else {
        nextPrefs.reportingCurrency = reportingCurrencyAfter;
      }
      if (Object.keys(nextPrefs).length === 0) {
        this.userPreferences.delete(userId);
      } else {
        this.userPreferences.set(userId, nextPrefs);
      }
    }
    const prefsAfter = await this.getUserPreferences(userId);
    return buildLifecyclePersistenceResult(
      account,
      shadow?.deletedAt ?? null,
      null,
      capabilities,
      prefsAfter,
    );
  }

  async listSoftDeletedAccounts(
    userId: string,
  ): Promise<Array<import("@vakwen/shared-types").AccountDto & { deletedAt: string }>> {
    const result: Array<import("@vakwen/shared-types").AccountDto & { deletedAt: string }> = [];
    for (const [key, account] of this.softDeletedAccounts.entries()) {
      if (key.startsWith(`${userId}:`)) {
        result.push({ ...account });
      }
    }
    // Sort by deletedAt DESC (most recent first).
    result.sort((a, b) => (a.deletedAt < b.deletedAt ? 1 : a.deletedAt > b.deletedAt ? -1 : 0));
    return result;
  }

  async getAccountIncludingDeleted(
    accountId: string,
    userId: string,
  ): Promise<
    | (import("@vakwen/shared-types").AccountDto & { deletedAt: string | null })
    | null
  > {
    const shadow = this.softDeletedAccounts.get(`${userId}:${accountId}`);
    if (shadow) {
      return { ...shadow };
    }
    const store = this.stores.get(userId);
    const active = store?.accounts.find((acc) => acc.id === accountId);
    if (active) {
      return { ...active, deletedAt: null };
    }
    return null;
  }

  async selectAccountsForHardPurge(
    graceDays: number,
  ): Promise<Array<{ accountId: string; userId: string }>> {
    const cutoff = Date.now() - graceDays * 24 * 60 * 60 * 1000;
    const result: Array<{ accountId: string; userId: string; deletedAt: string }> = [];
    for (const [key, account] of this.softDeletedAccounts.entries()) {
      if (new Date(account.deletedAt).getTime() < cutoff) {
        const sepIdx = key.indexOf(":");
        result.push({
          userId: key.slice(0, sepIdx),
          accountId: key.slice(sepIdx + 1),
          deletedAt: account.deletedAt,
        });
      }
    }
    result.sort((a, b) => (a.deletedAt < b.deletedAt ? -1 : a.deletedAt > b.deletedAt ? 1 : 0));
    return result.map(({ accountId, userId }) => ({ accountId, userId }));
  }

  async hasActiveJobs(_userId: string): Promise<boolean> {
    return false;
  }

  async countActiveAdmins(): Promise<number> {
    let count = 0;
    for (const user of this.usersByEmail.values()) {
      if (user.role === "admin" && !user.deactivatedAt && !user.deletedAt) {
        count++;
      }
    }
    return count;
  }

  private resolveActorEmail(actorUserId: string | null, metadata?: Record<string, unknown>): string | null {
    // Try users table first (mirrors Postgres LEFT JOIN fallback)
    if (actorUserId) {
      for (const user of this.usersByEmail.values()) {
        if (user.id === actorUserId) return user.email;
      }
    }
    // Fall back to metadata
    return (metadata?.actorEmail as string) ?? (metadata?.email as string) ?? null;
  }

  private assertNotLastAdminMem(): void {
    let count = 0;
    for (const user of this.usersByEmail.values()) {
      if (user.role === "admin" && !user.deactivatedAt && !user.deletedAt) {
        count++;
      }
    }
    if (count <= 1) {
      throw routeError(409, "last_admin_blocked", "Cannot modify the last remaining admin");
    }
  }

  async listInvites(options: AdminInviteListOptions): Promise<AdminInviteListResponse> {
    const { page, limit, status, email } = options;
    let inviteList = [...this.invites.values()];

    if (status) {
      inviteList = inviteList.filter((inv) => deriveInviteStatus(inv) === status);
    }

    if (email) {
      const lower = email.toLowerCase();
      inviteList = inviteList.filter((inv) => inv.email.toLowerCase().includes(lower));
    }

    // Sort by createdAt DESC
    inviteList.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = inviteList.length;
    const offset = (page - 1) * limit;
    const pageItems = inviteList.slice(offset, offset + limit);

    return {
      items: pageItems.map((inv) => {
        const issuer = inv.issuedByUserId ? this.getUserById(inv.issuedByUserId) : null;
        return {
          code: inv.code,
          email: inv.email,
          role: inv.role,
          status: deriveInviteStatus(inv),
          expiresAt: inv.expiresAt,
          usedAt: inv.usedAt,
          revokedAt: inv.revokedAt,
          issuedByEmail: issuer?.email ?? null,
          issuedByDisplayName: issuer?.displayName ?? null,
          createdAt: inv.createdAt,
        };
      }),
      total,
      page,
      limit,
    };
  }

  async listAuditLog(options: AdminAuditLogListOptions): Promise<AdminAuditLogResponse> {
    const { page, limit, actorUserId, targetUserId, actions, fromDate, toDate } = options;
    let entries = [...this.auditLog];

    if (actorUserId) {
      entries = entries.filter((e) => e.actorUserId === actorUserId);
    }
    if (targetUserId) {
      entries = entries.filter((e) => e.targetUserId === targetUserId);
    }
    if (actions && actions.length > 0) {
      const actionSet = new Set(actions);
      entries = entries.filter((e) => actionSet.has(e.action));
    }
    if (fromDate) {
      entries = entries.filter((e) => e.createdAt >= fromDate);
    }
    if (toDate) {
      entries = entries.filter((e) => e.createdAt <= toDate);
    }

    // Sort by createdAt DESC
    entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const total = entries.length;
    const offset = (page - 1) * limit;
    const pageItems = entries.slice(offset, offset + limit);

    return {
      items: pageItems.map((e) => ({
        id: e.id,
        actorUserId: e.actorUserId,
        actorEmail: this.resolveActorEmail(e.actorUserId, e.metadata) ?? null,
        action: e.action,
        targetUserId: e.targetUserId,
        targetEmail: (e.metadata?.targetEmail as string) ?? (e.metadata?.email as string) ?? null,
        targetDisplayName: (e.metadata?.targetDisplayName as string) ?? null,
        metadata: e.metadata,
        ipAddress: e.ipAddress,
        createdAt: e.createdAt,
      })),
      total,
      page,
      limit,
    };
  }

  // ── Provider health (KZO-177) ─────────────────────────────────────────────

  async getProviderHealthStatus(providerId: string): Promise<ProviderHealthRow | null> {
    const row = this.providerHealth.get(providerId);
    return row ? { ...row } : null;
  }

  async getAllProviderHealthStatuses(): Promise<ProviderHealthRow[]> {
    return [...this.providerHealth.values()]
      .map((row) => ({ ...row }))
      .sort((a, b) => a.providerId.localeCompare(b.providerId));
  }

  async upsertProviderHealthStatus(patch: ProviderHealthUpsert): Promise<ProviderHealthRow> {
    const now = new Date().toISOString();
    const existing = this.providerHealth.get(patch.providerId) ?? {
      providerId: patch.providerId,
      status: "down" as const,
      lastSuccessfulRun: null,
      lastFailedRun: null,
      lastErrorMessage: null,
      lastDownNotificationAt: null,
      lastManualRerunAt: null,
      updatedAt: now,
    };
    const merged: ProviderHealthRow = {
      ...existing,
      status: patch.status ?? existing.status,
      lastSuccessfulRun:
        patch.lastSuccessfulRun !== undefined ? patch.lastSuccessfulRun : existing.lastSuccessfulRun,
      lastFailedRun:
        patch.lastFailedRun !== undefined ? patch.lastFailedRun : existing.lastFailedRun,
      lastErrorMessage:
        patch.lastErrorMessage !== undefined ? patch.lastErrorMessage : existing.lastErrorMessage,
      lastDownNotificationAt:
        patch.lastDownNotificationAt !== undefined
          ? patch.lastDownNotificationAt
          : existing.lastDownNotificationAt,
      lastManualRerunAt:
        patch.lastManualRerunAt !== undefined ? patch.lastManualRerunAt : existing.lastManualRerunAt,
      updatedAt: now,
    };
    this.providerHealth.set(patch.providerId, merged);
    return { ...merged };
  }

  async clearProviderDownNotificationCas(
    providerId: string,
    expectedPreviousNotificationAt: string,
  ): Promise<boolean> {
    // KZO-177 (M2): per-provider promise-chain CAS lock — chains the read /
    // check / write through a single in-flight slot so concurrent winners are
    // serialized. Loser sees `lastDownNotificationAt === null` and returns
    // false. Mirrors Postgres's atomic-UPDATE rowcount semantics.
    const prev = this._providerCasLocks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this._providerCasLocks.set(providerId, prev.then(() => next));
    await prev;
    try {
      const row = this.providerHealth.get(providerId);
      if (!row) return false;
      if (row.lastDownNotificationAt !== expectedPreviousNotificationAt) return false;
      this.providerHealth.set(providerId, {
        ...row,
        lastDownNotificationAt: null,
        updatedAt: new Date().toISOString(),
      });
      return true;
    } finally {
      release();
    }
  }

  async claimProviderDownNotificationSlot(
    providerId: string,
    suppressionWindowMs: number,
  ): Promise<boolean> {
    // KZO-177 (P2 Fix 5): chain through the same per-provider mutex used by
    // `clearProviderDownNotificationCas` so concurrent claim attempts are
    // serialized. The Postgres backend gets atomicity from the conditional
    // UPDATE row count; this matches the semantics in memory.
    const prev = this._providerCasLocks.get(providerId) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((r) => { release = r; });
    this._providerCasLocks.set(providerId, prev.then(() => next));
    await prev;
    try {
      const row = this.providerHealth.get(providerId);
      if (!row) return false;
      const lastNotifMs = row.lastDownNotificationAt
        ? new Date(row.lastDownNotificationAt).getTime()
        : 0;
      if (Date.now() - lastNotifMs < suppressionWindowMs) {
        return false;
      }
      const nowIso = new Date().toISOString();
      this.providerHealth.set(providerId, {
        ...row,
        lastDownNotificationAt: nowIso,
        updatedAt: nowIso,
      });
      return true;
    } finally {
      release();
    }
  }

  async insertProviderErrorTrailEntry(input: ProviderErrorTrailInput): Promise<ProviderErrorTrailRow> {
    const row: ProviderErrorTrailRow = {
      id: this._providerErrorTrailNextId++,
      providerId: input.providerId,
      occurredAt: new Date().toISOString(),
      errorClass: input.errorClass,
      errorMessage: input.errorMessage ?? null,
      context: input.context ?? null,
    };
    this.providerErrorTrail.push(row);
    await this.upsertProviderIncident(providerIncidentInputFromErrorTrail(row));
    const unresolvedItem = providerUnresolvedItemInputFromErrorTrail(row);
    if (unresolvedItem) {
      await this.upsertProviderUnresolvedItem(unresolvedItem);
    }
    const marketCode = typeof row.context?.marketCode === "string" ? row.context.marketCode : null;
    if (marketCode && isMarketCalendarActivityMarket(marketCode)) {
      await this.createMarketCalendarActivityEvent({
        marketCode,
        category: "provider_error",
        result: row.errorClass === "rate_limit" ? "rate_limited" : "error",
        sourceKind: providerIdToActivitySourceKind(row.providerId),
        sourceId: row.providerId,
        eventType: "provider_error_recorded",
        title: "Provider error recorded",
        message: row.errorMessage ?? `${row.providerId} recorded ${row.errorClass}.`,
        ticker: typeof row.context?.ticker === "string" ? row.context.ticker : null,
        providerSymbol: typeof row.context?.providerSymbol === "string" ? row.context.providerSymbol : null,
        dedupeKey: `provider-error:${row.id}`,
        detail: {
          errorClass: row.errorClass,
          context: row.context ?? {},
        },
      });
    }
    return { ...row };
  }

  async getRecentProviderErrors(
    providerId: string,
    limit: number,
  ): Promise<ProviderErrorTrailRow[]> {
    return this.providerErrorTrail
      .filter((row) => row.providerId === providerId)
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .slice(0, Math.max(0, limit))
      .map((row) => ({ ...row }));
  }

  async computeErrorCount24h(providerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return this.providerErrorTrail.filter(
      (row) =>
        row.providerId === providerId &&
        row.errorClass !== "rate_limit" &&
        row.occurredAt >= cutoff,
    ).length;
  }

  async computeErrorCount7d(providerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    return this.providerErrorTrail.filter(
      (row) =>
        row.providerId === providerId &&
        row.errorClass !== "rate_limit" &&
        row.occurredAt >= cutoff,
    ).length;
  }

  async computeRateLimitCount24h(providerId: string): Promise<number> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    return this.providerErrorTrail.filter(
      (row) =>
        row.providerId === providerId &&
        row.errorClass === "rate_limit" &&
        row.occurredAt >= cutoff,
    ).length;
  }

  async pruneOldProviderErrorTrail(olderThanDays: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
    let removed = 0;
    for (let i = this.providerErrorTrail.length - 1; i >= 0; i--) {
      if (this.providerErrorTrail[i]!.occurredAt < cutoff) {
        this.providerErrorTrail.splice(i, 1);
        removed++;
      }
    }
    return removed;
  }

  async listProviderErrorTrailPage(
    options: ListProviderErrorTrailOptions,
  ): Promise<ListProviderErrorTrailResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const marketCode = options.marketCode?.toUpperCase();
    const errorMessageLike = options.errorMessageLike?.toLowerCase();
    const filtered = this.providerErrorTrail
      .filter((row) => {
        if (options.providerId && row.providerId !== options.providerId) return false;
        if (marketCode) {
          const rowMarketCode = typeof row.context?.marketCode === "string" ? row.context.marketCode.toUpperCase() : null;
          if (rowMarketCode !== marketCode) return false;
        }
        if (errorMessageLike && !(row.errorMessage ?? "").toLowerCase().includes(errorMessageLike)) return false;
        if (options.excludeResolvedMappings && options.providerId && marketCode) {
          const sourceSymbol =
            typeof row.context?.ticker === "string"
              ? row.context.ticker
              : typeof row.context?.symbol === "string"
                ? row.context.symbol
                : (row.errorMessage ?? "").replace(/^.*: /, "");
          if (sourceSymbol.trim().length > 0) {
            const key = this._providerResolutionMappingKey(options.providerId, marketCode as MarketCode, sourceSymbol);
            if (this.providerResolutionMappings.has(key)) return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || b.id - a.id);
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({ ...row })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async upsertProviderIncident(input: UpsertProviderIncidentInput): Promise<ProviderIncidentRecord> {
    const now = new Date().toISOString();
    const key = providerIncidentKey(input.providerId, input.incidentKey);
    const existing = this.providerIncidents.get(key);
    const metadata = input.metadata ?? {};
    const row: ProviderIncidentRecord = existing
      ? {
          ...existing,
          marketCode: input.marketCode ?? existing.marketCode,
          status: "open",
          severity: input.severity ?? existing.severity,
          title: input.title,
          summary: input.summary ?? existing.summary,
          errorClass: input.errorClass,
          errorCode: input.errorCode ?? existing.errorCode,
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now,
          lastErrorTrailId: input.lastErrorTrailId ?? existing.lastErrorTrailId,
          linkedOperationId: input.linkedOperationId ?? existing.linkedOperationId,
          metadata: { ...existing.metadata, ...metadata },
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          resolvedAt: null,
          resolvedByUserId: null,
          ignoredAt: null,
          ignoredByUserId: null,
          updatedAt: now,
        }
      : {
          id: randomUUID(),
          providerId: input.providerId,
          marketCode: input.marketCode ?? null,
          incidentKey: input.incidentKey,
          status: "open",
          severity: input.severity ?? "warning",
          title: input.title,
          summary: input.summary ?? null,
          errorClass: input.errorClass,
          errorCode: input.errorCode ?? null,
          occurrenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          lastErrorTrailId: input.lastErrorTrailId ?? null,
          linkedOperationId: input.linkedOperationId ?? null,
          metadata,
          acknowledgedAt: null,
          acknowledgedByUserId: null,
          resolvedAt: null,
          resolvedByUserId: null,
          ignoredAt: null,
          ignoredByUserId: null,
          createdAt: now,
          updatedAt: now,
        };
    this.providerIncidents.set(key, row);
    return { ...row, metadata: { ...row.metadata } };
  }

  async listProviderIncidents(options: ListProviderIncidentsOptions): Promise<ListProviderIncidentsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const marketCode = options.marketCode?.toUpperCase();
    const search = options.search?.trim().toLowerCase();
    const filtered = [...this.providerIncidents.values()]
      .filter((row) => {
        if (options.providerId && row.providerId !== options.providerId) return false;
        if (marketCode && row.marketCode !== marketCode) return false;
        if (options.status && row.status !== options.status) return false;
        if (search) {
          const haystack = `${row.title} ${row.summary ?? ""} ${row.errorCode ?? ""} ${row.incidentKey}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({ ...row, metadata: { ...row.metadata } })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async updateProviderIncidentStatus(input: UpdateProviderIncidentStatusInput): Promise<ProviderIncidentRecord> {
    const existing = [...this.providerIncidents.values()].find(
      (row) => row.id === input.incidentId && row.providerId === input.providerId,
    );
    if (!existing) throw routeError(404, "provider_incident_not_found", "Provider incident not found");
    const now = new Date().toISOString();
    const next: ProviderIncidentRecord = {
      ...existing,
      status: input.status,
      acknowledgedAt: input.status === "acknowledged" ? now : input.status === "open" ? null : existing.acknowledgedAt,
      acknowledgedByUserId: input.status === "acknowledged" ? input.actorUserId : input.status === "open" ? null : existing.acknowledgedByUserId,
      resolvedAt: input.status === "resolved" ? now : input.status === "open" ? null : existing.resolvedAt,
      resolvedByUserId: input.status === "resolved" ? input.actorUserId : input.status === "open" ? null : existing.resolvedByUserId,
      ignoredAt: input.status === "ignored" ? now : input.status === "open" ? null : existing.ignoredAt,
      ignoredByUserId: input.status === "ignored" ? input.actorUserId : input.status === "open" ? null : existing.ignoredByUserId,
      updatedAt: now,
    };
    this.providerIncidents.set(providerIncidentKey(next.providerId, next.incidentKey), next);
    return { ...next, metadata: { ...next.metadata } };
  }

  async upsertProviderUnresolvedItem(input: UpsertProviderUnresolvedItemInput): Promise<ProviderUnresolvedItemRecord> {
    const now = new Date().toISOString();
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const key = providerUnresolvedItemKey(input.providerId, input.marketCode, input.errorCode, sourceSymbol);
    const existing = this.providerUnresolvedItems.get(key);
    const row: ProviderUnresolvedItemRecord = existing
      ? {
          ...existing,
          providerSymbol: input.providerSymbol ?? existing.providerSymbol,
          state: "active",
          severity: input.severity ?? existing.severity,
          occurrenceCount: existing.occurrenceCount + 1,
          lastSeenAt: now,
          lastErrorTrailId: input.lastErrorTrailId ?? existing.lastErrorTrailId,
          evidence: { ...(existing.evidence ?? {}), ...(input.evidence ?? {}) },
          resolvedAt: null,
          resolvedByOperationId: null,
          updatedAt: now,
        }
      : {
          providerId: input.providerId,
          marketCode: input.marketCode,
          errorCode: input.errorCode,
          sourceSymbol,
          providerSymbol: input.providerSymbol ?? sourceSymbol,
          state: "active",
          severity: input.severity ?? "warning",
          occurrenceCount: 1,
          firstSeenAt: now,
          lastSeenAt: now,
          lastErrorTrailId: input.lastErrorTrailId ?? null,
          evidence: input.evidence ?? null,
          resolvedAt: null,
          resolvedByOperationId: null,
          updatedAt: now,
        };
    this.providerUnresolvedItems.set(key, row);
    return { ...row, evidence: row.evidence ? { ...row.evidence } : null };
  }

  async listProviderUnresolvedItems(
    options: ListProviderUnresolvedItemsOptions,
  ): Promise<ListProviderUnresolvedItemsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const search = options.search?.trim().toUpperCase();
    const filtered = [...this.providerUnresolvedItems.values()]
      .filter((row) => {
        if (options.providerId && row.providerId !== options.providerId) return false;
        if (options.marketCode && row.marketCode !== options.marketCode) return false;
        if (options.state && options.state !== "all" && row.state !== options.state) return false;
        if (options.errorCode && row.errorCode !== options.errorCode) return false;
        if (search && !`${row.sourceSymbol} ${row.providerSymbol ?? ""} ${row.errorCode}`.toUpperCase().includes(search)) return false;
        return true;
      })
      .sort((a, b) => {
        if (options.sort === "updated_desc") return b.updatedAt.localeCompare(a.updatedAt);
        if (options.sort === "source_symbol_asc") return a.sourceSymbol.localeCompare(b.sourceSymbol);
        if (options.sort === "occurrence_count_desc") {
          return b.occurrenceCount - a.occurrenceCount || b.lastSeenAt.localeCompare(a.lastSeenAt);
        }
        return b.lastSeenAt.localeCompare(a.lastSeenAt);
      });
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({
        ...row,
        evidence: row.evidence ? { ...row.evidence } : null,
      })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async resolveProviderUnresolvedItems(input: ResolveProviderUnresolvedItemsInput): Promise<number> {
    const now = new Date().toISOString();
    const identities = new Set(
      input.items
        .map((item) => `${item.marketCode}::${item.errorCode}::${item.sourceSymbol.trim().toUpperCase()}`)
        .filter((item) => item !== "::"),
    );
    let updated = 0;
    for (const [key, row] of this.providerUnresolvedItems.entries()) {
      if (row.providerId !== input.providerId || row.marketCode !== input.marketCode) continue;
      if (!identities.has(`${row.marketCode}::${row.errorCode}::${row.sourceSymbol}`)) continue;
      this.providerUnresolvedItems.set(key, {
        ...row,
        state: "resolved",
        resolvedAt: now,
        resolvedByOperationId: input.operationId ?? null,
        updatedAt: now,
      });
      updated++;
    }
    return updated;
  }

  async autoResolveProviderUnresolvedItemsBySourceSymbol(
    input: import("./types.js").AutoResolveProviderUnresolvedItemsBySourceSymbolInput,
  ): Promise<number> {
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    if (sourceSymbol.length === 0) return 0;
    const now = new Date().toISOString();
    let updated = 0;
    for (const [key, row] of this.providerUnresolvedItems.entries()) {
      if (row.providerId !== input.providerId || row.marketCode !== input.marketCode) continue;
      if (row.sourceSymbol !== sourceSymbol || row.state !== "active") continue;
      this.providerUnresolvedItems.set(key, {
        ...row,
        state: "resolved",
        resolvedAt: now,
        resolvedByOperationId: input.operationId ?? null,
        updatedAt: now,
      });
      updated += 1;
    }
    return updated;
  }

  async updateProviderUnresolvedItemState(
    input: UpdateProviderUnresolvedItemStateInput,
  ): Promise<ProviderUnresolvedItemRecord> {
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const key = providerUnresolvedItemKey(input.providerId, input.marketCode, input.errorCode, sourceSymbol);
    const existing = this.providerUnresolvedItems.get(key);
    if (!existing) throw routeError(404, "provider_unresolved_item_not_found", "provider unresolved item not found");
    const now = new Date().toISOString();
    const evidence = {
      ...(existing.evidence ?? {}),
      stateChange: {
        state: input.state,
        reason: input.reason ?? null,
        actorUserId: input.actorUserId ?? null,
        changedAt: now,
      },
    };
    const row: ProviderUnresolvedItemRecord = {
      ...existing,
      state: input.state,
      evidence,
      resolvedAt: input.state === "resolved" ? now : null,
      resolvedByOperationId: input.state === "active" ? null : existing.resolvedByOperationId,
      updatedAt: now,
    };
    this.providerUnresolvedItems.set(key, row);
    return { ...row, evidence: { ...evidence } };
  }

  async createProviderOperation(input: CreateProviderOperationInput): Promise<ProviderOperationRecord> {
    const now = new Date().toISOString();
    const row: ProviderOperationRecord = {
      id: input.id ?? randomUUID(),
      providerId: input.providerId,
      marketCode: input.marketCode,
      operationType: input.operationType,
      phase: input.phase,
      errorCode: input.errorCode ?? null,
      resolverMode: input.resolverMode ?? null,
      scopeQuery: input.scopeQuery ?? null,
      snapshotHash: input.snapshotHash ?? null,
      previewTokenHash: input.previewTokenHash ?? null,
      previewExpiresAt: input.previewExpiresAt ?? null,
      matchCount: input.matchCount ?? null,
      sample: input.sample ?? null,
      metadata: input.metadata ?? null,
      legacyBatchId: input.legacyBatchId ?? null,
      actorUserId: input.actorUserId ?? null,
      startedAt: input.startedAt ?? null,
      completedAt: input.completedAt ?? null,
      cancelledAt: input.cancelledAt ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.providerOperations.set(row.id, row);
    return { ...row };
  }

  async updateProviderOperation(input: UpdateProviderOperationInput): Promise<ProviderOperationRecord> {
    const existing = this.providerOperations.get(input.id);
    if (!existing) throw routeError(404, "provider_operation_not_found", "provider operation not found");
    const next: ProviderOperationRecord = {
      ...existing,
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
      ...(input.errorCode !== undefined ? { errorCode: input.errorCode } : {}),
      ...(input.resolverMode !== undefined ? { resolverMode: input.resolverMode } : {}),
      ...(input.scopeQuery !== undefined ? { scopeQuery: input.scopeQuery } : {}),
      ...(input.snapshotHash !== undefined ? { snapshotHash: input.snapshotHash } : {}),
      ...(input.previewTokenHash !== undefined ? { previewTokenHash: input.previewTokenHash } : {}),
      ...(input.previewExpiresAt !== undefined ? { previewExpiresAt: input.previewExpiresAt } : {}),
      ...(input.matchCount !== undefined ? { matchCount: input.matchCount } : {}),
      ...(input.sample !== undefined ? { sample: input.sample } : {}),
      ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
      ...(input.legacyBatchId !== undefined ? { legacyBatchId: input.legacyBatchId } : {}),
      ...(input.actorUserId !== undefined ? { actorUserId: input.actorUserId } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      ...(input.cancelledAt !== undefined ? { cancelledAt: input.cancelledAt } : {}),
      updatedAt: new Date().toISOString(),
    };
    this.providerOperations.set(input.id, next);
    return { ...next };
  }

  async getProviderOperation(id: string): Promise<ProviderOperationRecord | null> {
    const row = this.providerOperations.get(id);
    return row ? { ...row } : null;
  }

  async listProviderOperations(
    options: ListProviderOperationsOptions,
  ): Promise<ListProviderOperationsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const phases = options.phases ? new Set(options.phases) : null;
    const operationTypes = options.operationTypes ? new Set(options.operationTypes) : null;
    const search = options.search?.trim().toLowerCase() ?? "";
    const createdAfterMs = options.createdAfter ? Date.parse(options.createdAfter) : Number.NaN;
    const createdBeforeMs = options.createdBefore ? Date.parse(options.createdBefore) : Number.NaN;
    const filtered = [...this.providerOperations.values()]
      .filter((row) => {
        if (options.providerId && row.providerId !== options.providerId) return false;
        if (options.marketCode && row.marketCode !== options.marketCode) return false;
        if (operationTypes && !operationTypes.has(row.operationType)) return false;
        if (phases && !phases.has(row.phase)) return false;
        if (Number.isFinite(createdAfterMs) && Date.parse(row.createdAt) < createdAfterMs) return false;
        if (Number.isFinite(createdBeforeMs) && Date.parse(row.createdAt) > createdBeforeMs) return false;
        if (search) {
          const haystack = JSON.stringify([
            row.id,
            row.providerId,
            row.marketCode,
            row.operationType,
            row.scopeQuery,
            row.errorCode,
          ]).toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (page - 1) * limit;
    const items = filtered.slice(offset, offset + limit);
    if (options.includeOperationId) {
      const selected = filtered.find((row) => row.id === options.includeOperationId);
      if (selected && !items.some((row) => row.id === selected.id)) {
        // Keep page order truthful; selected off-page is returned separately by the route layer.
      }
    }
    return {
      items: items.map((row) => ({ ...row })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async hasActiveProviderExecution(providerId: string, marketCode: MarketCode): Promise<boolean> {
    return [...this.providerOperations.values()].some((row) =>
      row.providerId === providerId
      && row.marketCode === marketCode
      && (row.phase === "preparing_preview"
        || row.phase === "preview"
        || row.phase === "staged"
        || row.phase === "queued"
        || row.phase === "running"
        || row.phase === "paused")
    );
  }

  async createProviderOperationLog(input: CreateProviderOperationLogInput): Promise<ProviderOperationLogRecord> {
    const operation = this.providerOperations.get(input.operationId);
    const rawContext = input.rawContext ?? input.context ?? null;
    const row: ProviderOperationLogRecord = {
      id: this._providerOperationLogNextId++,
      operationId: input.operationId,
      providerId: input.providerId ?? operation?.providerId ?? null,
      marketCode: input.marketCode ?? operation?.marketCode ?? null,
      phase: input.phase,
      level: input.level,
      eventKind: input.eventKind ?? (typeof rawContext?.eventKind === "string" ? rawContext.eventKind : null),
      batchId: input.batchId ?? (typeof rawContext?.batchId === "string" ? rawContext.batchId : null),
      jobId: input.jobId ?? (typeof rawContext?.jobId === "string" ? rawContext.jobId : null),
      successCount: input.successCount ?? (typeof rawContext?.successCount === "number" ? rawContext.successCount : null),
      warningCount: input.warningCount ?? (typeof rawContext?.warningCount === "number" ? rawContext.warningCount : null),
      errorCount: input.errorCount ?? (typeof rawContext?.errorCount === "number" ? rawContext.errorCount : null),
      detail: input.detail ?? (typeof rawContext?.detail === "string" ? rawContext.detail : input.message),
      rawContext,
      message: input.message,
      context: input.context ?? null,
      createdAt: new Date().toISOString(),
    };
    this.providerOperationLogs.push(row);
    if (operation && isMarketCalendarActivityMarket(operation.marketCode)) {
      await this.createMarketCalendarActivityEvent({
        marketCode: operation.marketCode,
        category: "provider_operation",
        result: providerOperationLogLevelToActivityResult(input.level),
        sourceKind: providerIdToActivitySourceKind(operation.providerId),
        sourceId: operation.providerId,
        eventType: `provider_operation_${input.phase}`,
        title: "Provider operation milestone",
        message: input.message,
        operationId: input.operationId,
        dedupeKey: `provider-log:${row.id}`,
        detail: {
          providerId: operation.providerId,
          operationType: operation.operationType,
          phase: input.phase,
          context: input.context ?? null,
        },
      });
    }
    return { ...row };
  }

  async listProviderOperationLogs(
    options: ListProviderOperationLogsOptions,
  ): Promise<ListProviderOperationLogsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const filtered = this.providerOperationLogs
      .filter((row) => row.operationId === options.operationId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({ ...row })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async listMarketCalendarSources(marketCode: MarketCode): Promise<MarketCalendarSourceConfigRecord[]> {
    this.seedDefaultMarketCalendarSource(marketCode);
    return [...this.marketCalendarSources.values()]
      .filter((row) => row.marketCode === marketCode)
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((row) => ({ ...row }));
  }

  async saveMarketCalendarSource(input: SaveMarketCalendarSourceConfigInput): Promise<MarketCalendarSourceConfigRecord> {
    const now = new Date().toISOString();
    const sourceId = input.sourceId ?? randomUUID();
    const next: MarketCalendarSourceConfigRecord = {
      id: sourceId,
      marketCode: input.marketCode,
      label: input.label,
      sourceType: input.sourceType,
      suggestedSourceUrl: input.suggestedSourceUrl ?? null,
      enabled: input.enabled ?? true,
      isDefault: input.isDefault ?? false,
      updatedAt: now,
    };
    if (next.isDefault) {
      for (const [key, row] of this.marketCalendarSources.entries()) {
        if (row.marketCode === input.marketCode) {
          this.marketCalendarSources.set(key, { ...row, isDefault: false, updatedAt: now });
        }
      }
    }
    this.marketCalendarSources.set(sourceId, next);
    return { ...next };
  }

  async saveMarketCalendarPreview(preview: MarketCalendarPreviewRecord): Promise<MarketCalendarPreviewRecord> {
    const copy: MarketCalendarPreviewRecord = {
      ...preview,
      warnings: [...preview.warnings],
      diff: {
        addedExceptions: [...preview.diff.addedExceptions],
        removedExceptions: [...preview.diff.removedExceptions],
        changedExceptions: [...preview.diff.changedExceptions],
      },
      coverage: { ...preview.coverage },
      annualCounts: { ...preview.annualCounts },
      exceptions: preview.exceptions.map((row) => ({ ...row })),
    };
    this.marketCalendarPreviews.set(preview.previewToken, copy);
    return {
      ...copy,
      warnings: [...copy.warnings],
      diff: {
        addedExceptions: [...copy.diff.addedExceptions],
        removedExceptions: [...copy.diff.removedExceptions],
        changedExceptions: [...copy.diff.changedExceptions],
      },
      coverage: { ...copy.coverage },
      annualCounts: { ...copy.annualCounts },
      exceptions: copy.exceptions.map((row) => ({ ...row })),
    };
  }

  async getMarketCalendarPreview(previewToken: string): Promise<MarketCalendarPreviewRecord | null> {
    const preview = this.marketCalendarPreviews.get(previewToken);
    if (!preview) return null;
    return {
      ...preview,
      warnings: [...preview.warnings],
      diff: {
        addedExceptions: [...preview.diff.addedExceptions],
        removedExceptions: [...preview.diff.removedExceptions],
        changedExceptions: [...preview.diff.changedExceptions],
      },
      coverage: { ...preview.coverage },
      annualCounts: { ...preview.annualCounts },
      exceptions: preview.exceptions.map((row) => ({ ...row })),
    };
  }

  async confirmMarketCalendarPreview(input: ConfirmMarketCalendarPreviewInput): Promise<MarketCalendarVersionRecord> {
    const preview = this.marketCalendarPreviews.get(input.previewToken);
    if (!preview) {
      throw routeError(404, "market_calendar_preview_not_found", "Market calendar preview not found");
    }
    const active = await this.getActiveMarketCalendarVersion(preview.marketCode, preview.calendarYear);
    if (active && preview.replaceConfirmedRequired && !input.replaceConfirmed) {
      throw routeError(400, "market_calendar_replace_required", "Replacing the confirmed calendar requires explicit confirmation");
    }
    const now = new Date().toISOString();
    if (active) {
      this.marketCalendarVersions.set(active.versionId, {
        ...active,
        isActive: false,
        updatedAt: now,
      });
    }
    const source = preview.sourceId ? this.marketCalendarSources.get(preview.sourceId) ?? null : null;
    const version: MarketCalendarVersionRecord = {
      versionId: randomUUID(),
      importOperationId: preview.importOperationId,
      marketCode: preview.marketCode,
      calendarYear: preview.calendarYear,
      sourceId: preview.sourceId,
      sourceLabel: source?.label ?? preview.label ?? null,
      sourceType: preview.sourceType,
      sourceUrl: preview.sourceUrl,
      retrievedAt: preview.retrievedAt,
      coverage: { ...preview.coverage },
      confirmedAt: now,
      invalidatedAt: null,
      invalidationReason: input.replacementReason ?? null,
      status: "confirmed",
      isActive: true,
      annualCounts: { ...preview.annualCounts },
      exceptions: preview.exceptions.map((row) => ({ ...row })),
      createdAt: now,
      updatedAt: now,
    };
    this.marketCalendarVersions.set(version.versionId, version);
    return { ...version, coverage: { ...version.coverage }, annualCounts: { ...version.annualCounts }, exceptions: version.exceptions.map((row) => ({ ...row })) };
  }

  async invalidateMarketCalendarVersion(input: InvalidateMarketCalendarVersionInput): Promise<MarketCalendarVersionRecord | null> {
    const active = await this.getActiveMarketCalendarVersion(input.marketCode, input.calendarYear);
    if (!active) return null;
    const next: MarketCalendarVersionRecord = {
      ...active,
      status: "invalidated",
      isActive: false,
      invalidatedAt: new Date().toISOString(),
      invalidationReason: input.reason,
      updatedAt: new Date().toISOString(),
    };
    this.marketCalendarVersions.set(next.versionId, next);
    return { ...next, coverage: { ...next.coverage }, annualCounts: { ...next.annualCounts }, exceptions: next.exceptions.map((row) => ({ ...row })) };
  }

  async getActiveMarketCalendarVersion(marketCode: MarketCode, calendarYear: number): Promise<MarketCalendarVersionRecord | null> {
    const active = [...this.marketCalendarVersions.values()].find((row) =>
      row.marketCode === marketCode && row.calendarYear === calendarYear && row.isActive && row.status === "confirmed");
    return active ? { ...active, coverage: { ...active.coverage }, annualCounts: { ...active.annualCounts }, exceptions: active.exceptions.map((row) => ({ ...row })) } : null;
  }

  async listMarketCalendarHistory(marketCode: MarketCode, calendarYear?: number): Promise<MarketCalendarVersionRecord[]> {
    return [...this.marketCalendarVersions.values()]
      .filter((row) => row.marketCode === marketCode && (calendarYear === undefined || row.calendarYear === calendarYear))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((row) => ({ ...row, coverage: { ...row.coverage }, annualCounts: { ...row.annualCounts }, exceptions: row.exceptions.map((calendarRow) => ({ ...calendarRow })) }));
  }

  async createMarketCalendarActivityEvent(input: CreateMarketCalendarActivityEventInput): Promise<MarketCalendarActivityEventRecord> {
    if (input.dedupeKey) {
      const existingIndex = this.marketCalendarActivityEvents.findIndex((row) =>
        row.marketCode === input.marketCode && row.dedupeKey === input.dedupeKey);
      if (existingIndex >= 0) {
        const existing = this.marketCalendarActivityEvents[existingIndex]!;
        const updated: MarketCalendarActivityEventRecord = {
          ...existing,
          occurredAt: input.occurredAt ?? existing.occurredAt,
          category: input.category,
          result: input.result,
          sourceKind: input.sourceKind,
          sourceId: input.sourceId ?? null,
          eventType: input.eventType,
          title: input.title,
          message: input.message,
          ticker: input.ticker ?? null,
          providerSymbol: input.providerSymbol ?? null,
          operationId: input.operationId ?? null,
          jobId: input.jobId ?? null,
          calendarYear: input.calendarYear ?? null,
          detail: { ...(input.detail ?? {}) },
        };
        this.marketCalendarActivityEvents[existingIndex] = updated;
        return { ...updated, detail: { ...updated.detail } };
      }
    }
    const row: MarketCalendarActivityEventRecord = {
      id: randomUUID(),
      marketCode: input.marketCode,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      category: input.category,
      result: input.result,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId ?? null,
      eventType: input.eventType,
      title: input.title,
      message: input.message,
      ticker: input.ticker ?? null,
      providerSymbol: input.providerSymbol ?? null,
      operationId: input.operationId ?? null,
      jobId: input.jobId ?? null,
      calendarYear: input.calendarYear ?? null,
      dedupeKey: input.dedupeKey ?? null,
      detail: { ...(input.detail ?? {}) },
    };
    this.marketCalendarActivityEvents.push(row);
    return { ...row, detail: { ...row.detail } };
  }

  async listMarketCalendarActivity(options: ListMarketCalendarActivityOptions): Promise<ListMarketCalendarActivityResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const categories = options.categories ? new Set(options.categories) : null;
    const results = options.results ? new Set(options.results) : null;
    const sourceKinds = options.sourceKinds ? new Set(options.sourceKinds) : null;
    const sourceIds = options.sourceIds ? new Set(options.sourceIds) : null;
    const query = options.search?.trim().toLowerCase() ?? "";
    const filtered = this.marketCalendarActivityEvents
      .filter((row) => row.marketCode === options.marketCode)
      .filter((row) => (categories ? categories.has(row.category) : true))
      .filter((row) => (results ? results.has(row.result) : true))
      .filter((row) => (sourceKinds ? sourceKinds.has(row.sourceKind) : true))
      .filter((row) => (sourceIds ? (row.sourceId ? sourceIds.has(row.sourceId) : false) : true))
      .filter((row) => (options.occurredAfter ? row.occurredAt >= options.occurredAfter : true))
      .filter((row) => {
        if (!query) return true;
        return [
          row.ticker,
          row.providerSymbol,
          row.operationId,
          row.jobId,
          row.sourceKind,
          row.sourceId,
          row.title,
          row.message,
          row.eventType,
          row.calendarYear?.toString() ?? null,
          typeof row.detail.sourceHost === "string" ? row.detail.sourceHost : null,
          typeof row.detail.host === "string" ? row.detail.host : null,
        ].some((value) => value?.toLowerCase().includes(query));
      })
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({ ...row, detail: { ...row.detail } })),
      total: filtered.length,
      page,
      limit,
    };
  }

  async countProviderLogsForPurge(providerId: string): Promise<ProviderLogPurgeCounts> {
    const operationIds = new Set(
      [...this.providerOperations.values()]
        .filter((operation) => operation.providerId === providerId)
        .map((operation) => operation.id),
    );
    return {
      providerId,
      errorTrailCount: this.providerErrorTrail.filter((row) => row.providerId === providerId).length,
      operationLogCount: this.providerOperationLogs.filter((row) => operationIds.has(row.operationId)).length,
    };
  }

  async purgeProviderLogs(providerId: string): Promise<ProviderLogPurgeCounts> {
    const errorTrailIds = new Set(
      this.providerErrorTrail.filter((row) => row.providerId === providerId).map((row) => row.id),
    );
    let errorTrailCount = 0;
    for (let i = this.providerErrorTrail.length - 1; i >= 0; i--) {
      if (this.providerErrorTrail[i]!.providerId === providerId) {
        this.providerErrorTrail.splice(i, 1);
        errorTrailCount++;
      }
    }
    for (const [key, row] of this.providerUnresolvedItems.entries()) {
      if (row.providerId === providerId && row.lastErrorTrailId != null && errorTrailIds.has(row.lastErrorTrailId)) {
        this.providerUnresolvedItems.set(key, { ...row, lastErrorTrailId: null });
      }
    }
    for (const [key, row] of this.providerIncidents.entries()) {
      if (row.providerId === providerId && row.lastErrorTrailId != null && errorTrailIds.has(row.lastErrorTrailId)) {
        this.providerIncidents.set(key, { ...row, lastErrorTrailId: null });
      }
    }
    const operationIds = new Set(
      [...this.providerOperations.values()]
        .filter((operation) => operation.providerId === providerId)
        .map((operation) => operation.id),
    );
    let operationLogCount = 0;
    for (let i = this.providerOperationLogs.length - 1; i >= 0; i--) {
      if (operationIds.has(this.providerOperationLogs[i]!.operationId)) {
        this.providerOperationLogs.splice(i, 1);
        operationLogCount++;
      }
    }
    return { providerId, errorTrailCount, operationLogCount };
  }

  private seedDefaultMarketCalendarSource(marketCode: MarketCode): void {
    const hasSource = [...this.marketCalendarSources.values()].some((row) => row.marketCode === marketCode);
    if (hasSource) return;
    const suggestedSourceUrls: Partial<Record<MarketCode, string>> = {
      TW: "https://www.twse.com.tw/en/trading/holiday.html",
      US: "https://www.nasdaqtrader.com/trader.aspx?id=Calendar",
      AU: "https://www.asx.com.au/markets/market-resources/trading-hours-calendar/cash-market-trading-hours/trading-calendar",
      KR: "https://global.krx.co.kr/contents/GLB/05/0501/0501110000/GLB0501110000.jsp",
    };
    const sourceId = `official-${marketCode.toLowerCase()}`;
    this.marketCalendarSources.set(sourceId, {
      id: sourceId,
      marketCode,
      label: `${marketCode} official calendar`,
      sourceType: "official_source",
      suggestedSourceUrl: suggestedSourceUrls[marketCode] ?? null,
      enabled: true,
      isDefault: true,
      updatedAt: new Date().toISOString(),
    });
  }

  async upsertProviderOperationOutcome(
    input: UpsertProviderOperationOutcomeInput,
  ): Promise<ProviderOperationOutcomeRecord> {
    const now = new Date().toISOString();
    const sourceSymbol = input.sourceSymbol.trim().toUpperCase();
    const key = providerOperationOutcomeKey(input.operationId, input.action, sourceSymbol);
    const existing = this.providerOperationOutcomes.get(key);
    const row: ProviderOperationOutcomeRecord = existing
      ? {
          ...existing,
          providerSymbol: input.providerSymbol ?? existing.providerSymbol,
          state: input.state,
          message: input.message ?? existing.message,
          errorCode: input.errorCode ?? existing.errorCode,
          jobId: input.jobId ?? existing.jobId,
          evidence: { ...(existing.evidence ?? {}), ...(input.evidence ?? {}) },
          startedAt: input.startedAt ?? existing.startedAt,
          completedAt: input.completedAt ?? existing.completedAt,
          updatedAt: now,
        }
      : {
          operationId: input.operationId,
          providerId: input.providerId,
          marketCode: input.marketCode,
          sourceSymbol,
          providerSymbol: input.providerSymbol ?? null,
          action: input.action,
          state: input.state,
          message: input.message ?? null,
          errorCode: input.errorCode ?? null,
          jobId: input.jobId ?? null,
          evidence: input.evidence ?? null,
          startedAt: input.startedAt ?? (input.state === "running" ? now : null),
          completedAt: input.completedAt ?? (["succeeded", "failed", "skipped", "rate_limited", "cancelled"].includes(input.state) ? now : null),
          createdAt: now,
          updatedAt: now,
        };
    this.providerOperationOutcomes.set(key, row);
    return { ...row, evidence: row.evidence ? { ...row.evidence } : null };
  }

  async listProviderOperationOutcomes(
    options: ListProviderOperationOutcomesOptions,
  ): Promise<ListProviderOperationOutcomesResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const filtered = [...this.providerOperationOutcomes.values()]
      .filter((row) => row.operationId === options.operationId)
      .filter((row) => !options.state || row.state === options.state)
      .filter((row) => !options.action || row.action === options.action)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const allForOperation = [...this.providerOperationOutcomes.values()]
      .filter((row) => row.operationId === options.operationId);
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({
        ...row,
        evidence: row.evidence ? { ...row.evidence } : null,
      })),
      summary: summarizeProviderOperationOutcomes(allForOperation),
      total: filtered.length,
      page,
      limit,
    };
  }

  async getLatestProviderOperationOutcome(
    options: LatestProviderOperationOutcomeOptions,
  ): Promise<ProviderOperationOutcomeRecord | null> {
    const sourceSymbol = options.sourceSymbol.trim().toUpperCase();
    const actions = new Set(options.actions ?? []);
    const row = [...this.providerOperationOutcomes.values()]
      .filter((outcome) => outcome.providerId === options.providerId)
      .filter((outcome) => outcome.marketCode === options.marketCode)
      .filter((outcome) => outcome.sourceSymbol.toUpperCase() === sourceSymbol)
      .filter((outcome) => actions.size === 0 || actions.has(outcome.action))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    return row
      ? {
          ...row,
          evidence: row.evidence ? { ...row.evidence } : null,
        }
      : null;
  }

  async getProviderResolutionMapping(
    providerId: string,
    marketCode: MarketCode,
    sourceSymbol: string,
  ): Promise<ProviderResolutionMappingRecord | null> {
    const row = this.providerResolutionMappings.get(
      this._providerResolutionMappingKey(providerId, marketCode, sourceSymbol),
    );
    return row ? { ...row } : null;
  }

  async upsertProviderResolutionMapping(
    input: UpsertProviderResolutionMappingInput,
  ): Promise<ProviderResolutionMappingRecord> {
    const key = this._providerResolutionMappingKey(input.providerId, input.marketCode, input.sourceSymbol);
    const now = new Date().toISOString();
    const existing = this.providerResolutionMappings.get(key);
    const row: ProviderResolutionMappingRecord = {
      providerId: input.providerId,
      marketCode: input.marketCode,
      sourceSymbol: input.sourceSymbol.trim().toUpperCase(),
      resolvedSymbol: input.resolvedSymbol.trim().toUpperCase(),
      resolverMode: input.resolverMode ?? null,
      evidence: input.evidence ?? null,
      verifiedAt: input.verifiedAt ?? now,
      verifiedByUserId: input.verifiedByUserId ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.providerResolutionMappings.set(key, row);
    return { ...row };
  }

  async deleteProviderResolutionMapping(
    input: DeleteProviderResolutionMappingInput,
  ): Promise<ProviderResolutionMappingRecord | null> {
    const key = this._providerResolutionMappingKey(input.providerId, input.marketCode, input.sourceSymbol);
    const existing = this.providerResolutionMappings.get(key);
    if (!existing) return null;
    this.providerResolutionMappings.delete(key);
    return {
      ...existing,
      evidence: existing.evidence ? { ...existing.evidence } : null,
    };
  }

  async listProviderResolutionMappings(
    options: ListProviderResolutionMappingsOptions,
  ): Promise<ListProviderResolutionMappingsResult> {
    const page = Math.max(1, Math.floor(options.page) || 1);
    const limit = Math.min(500, Math.max(1, Math.floor(options.limit) || 50));
    const marketCode = options.marketCode?.toUpperCase();
    const search = options.search?.trim().toLowerCase();
    const filtered = [...this.providerResolutionMappings.values()]
      .filter((row) => {
        if (options.providerId && row.providerId !== options.providerId) return false;
        if (marketCode && row.marketCode !== marketCode) return false;
        if (search) {
          const haystack = `${row.sourceSymbol} ${row.resolvedSymbol} ${row.resolverMode ?? ""} ${JSON.stringify(row.evidence ?? {})}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      })
      .sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt));
    const offset = (page - 1) * limit;
    return {
      items: filtered.slice(offset, offset + limit).map((row) => ({
        ...row,
        evidence: row.evidence ? { ...row.evidence } : null,
      })),
      total: filtered.length,
      page,
      limit,
    };
  }

  private _providerResolutionMappingKey(providerId: string, marketCode: MarketCode, sourceSymbol: string): string {
    return `${providerId}::${marketCode}::${sourceSymbol.trim().toUpperCase()}`;
  }

  async listAdminUserIds(): Promise<string[]> {
    return [...this.usersByEmail.values()]
      .filter((u) => u.role === "admin" && !u.deactivatedAt && !u.deletedAt)
      .map((u) => u.id);
  }

  // ── Test-only helpers (KZO-177) ─────────────────────────────────────────
  // Used by unit / integration tests to seed and inspect provider-health
  // state without going through `recordOutcome`. NOT part of the production
  // Persistence contract.

  /** @internal */
  async _seedProviderHealthStatus(input: {
    providerId: string;
    status?: "healthy" | "degraded" | "down";
    lastSuccessfulRun?: string | null;
    lastFailedRun?: string | null;
    lastErrorMessage?: string | null;
    lastDownNotificationAt?: string | null;
    lastManualRerunAt?: string | null;
    /** Ignored by memory backend (counters are computed-on-read). */
    errorCount24h?: number;
    /** Ignored by memory backend (counters are computed-on-read). */
    errorCount7d?: number;
    /** Ignored by memory backend (counters are computed-on-read). */
    rateLimitCount24h?: number;
  }): Promise<void> {
    await this.upsertProviderHealthStatus({
      providerId: input.providerId,
      status: input.status,
      lastSuccessfulRun: input.lastSuccessfulRun ?? undefined,
      lastFailedRun: input.lastFailedRun ?? undefined,
      lastErrorMessage: input.lastErrorMessage ?? undefined,
      lastDownNotificationAt: input.lastDownNotificationAt ?? undefined,
      lastManualRerunAt: input.lastManualRerunAt ?? undefined,
    });
  }

  /** @internal — returns the row plus computed counters for test convenience. */
  async _getProviderHealthStatus(providerId: string): Promise<{
    providerId: string;
    status: "healthy" | "degraded" | "down";
    lastSuccessfulRun: string | null;
    lastFailedRun: string | null;
    lastErrorMessage: string | null;
    lastDownNotificationAt: string | null;
    lastManualRerunAt: string | null;
    errorCount24h: number;
    errorCount7d: number;
    rateLimitCount24h: number;
  } | null> {
    const row = await this.getProviderHealthStatus(providerId);
    if (!row) return null;
    const [errorCount24h, errorCount7d, rateLimitCount24h] = await Promise.all([
      this.computeErrorCount24h(providerId),
      this.computeErrorCount7d(providerId),
      this.computeRateLimitCount24h(providerId),
    ]);
    return {
      providerId: row.providerId,
      status: row.status,
      lastSuccessfulRun: row.lastSuccessfulRun,
      lastFailedRun: row.lastFailedRun,
      lastErrorMessage: row.lastErrorMessage,
      lastDownNotificationAt: row.lastDownNotificationAt,
      lastManualRerunAt: row.lastManualRerunAt,
      errorCount24h,
      errorCount7d,
      rateLimitCount24h,
    };
  }

  /** @internal — list admin notifications by source category for tests. */
  async _listAdminNotifications(category: string): Promise<Array<{ category: string; payload: unknown }>> {
    const out: Array<{ category: string; payload: unknown }> = [];
    for (const list of this.notifications.values()) {
      for (const n of list) {
        if (n.source === "provider_health") {
          // Map each in-app notification to a category by inspecting title.
          const inferred = /down/i.test(n.title) ? "provider_down" : "provider_recovered";
          if (inferred === category) {
            out.push({ category: inferred, payload: n.detail });
          }
        }
      }
    }
    return out;
  }
}

function deriveUserStatus(user: { deactivatedAt?: string | null; deletedAt?: string | null }): AdminUserStatus {
  if (user.deletedAt) return "deleted";
  if (user.deactivatedAt) return "disabled";
  return "active";
}

function deriveInviteStatus(invite: { usedAt: string | null; revokedAt: string | null; expiresAt: string }): InviteListStatus {
  if (invite.usedAt) return "used";
  if (invite.revokedAt) return "revoked";
  if (new Date(invite.expiresAt) < new Date()) return "expired";
  return "pending";
}

function matchesNullableDateRange(value: string | null | undefined, fromDate?: string, toDate?: string): boolean {
  if (value == null) return true;
  if (fromDate && value < fromDate) return false;
  if (toDate && value > toDate) return false;
  return true;
}

function dividendEventMarketCode(
  event: Pick<Store["marketData"]["dividendEvents"][number], "marketCode" | "cashDividendCurrency">,
): MarketCode {
  return event.marketCode ?? marketCodeFor(event.cashDividendCurrency);
}

function compareNullablePaymentDates(
  left: { paymentDate?: string | null } | undefined,
  right: { paymentDate?: string | null } | undefined,
): number {
  const leftDate = left?.paymentDate ?? "";
  const rightDate = right?.paymentDate ?? "";
  return leftDate.localeCompare(rightDate);
}

function compareNullableIsoDateNullLast(
  left: string | null | undefined,
  right: string | null | undefined,
  sortOrder: "asc" | "desc",
): number {
  const leftValue = left ?? null;
  const rightValue = right ?? null;
  if (leftValue === null && rightValue === null) return 0;
  if (leftValue === null) return 1;
  if (rightValue === null) return -1;
  const cmp = leftValue.localeCompare(rightValue);
  return sortOrder === "asc" ? cmp : -cmp;
}

function compareAscNullableIsoDateNullLast(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  return compareNullableIsoDateNullLast(left, right, "asc");
}

function compareNumberByOrder(left: number, right: number, sortOrder: "asc" | "desc"): number {
  return sortOrder === "asc" ? left - right : right - left;
}

function compareStringByOrder(left: string, right: string, sortOrder: "asc" | "desc"): number {
  const cmp = left.localeCompare(right);
  return sortOrder === "asc" ? cmp : -cmp;
}

function deriveDividendReviewStockStatus(row: {
  eventType: DividendReviewRowWithDetails["eventType"];
  postingStatus: DividendReviewRowWithDetails["postingStatus"];
  expectedStockCalcState?: DividendReviewRowWithDetails["expectedStockCalcState"];
  expectedStockQuantity: number;
  receivedStockQuantity: number;
  reconciliationStatus: DividendReviewRowWithDetails["reconciliationStatus"];
}): DividendReviewRowSummaryDto["stockReconciliationStatus"] {
  if (row.eventType === "CASH") return null;
  if (row.expectedStockCalcState === "needs_action") return "needs_calculation";
  if (row.postingStatus === "expected") return "pending_receipt";
  if (row.reconciliationStatus === "explained") return "explained";
  return row.receivedStockQuantity === row.expectedStockQuantity ? "matched" : "variance";
}

function assertOwnedDividendCalculationAccount(store: Store, accountId: string): void {
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw routeError(404, "account_not_found", "Account not found");
  }
}

function findActiveDividendCalculationVersion(
  store: Store,
  accountId: string,
  dividendEventId: string,
): DividendCalculationVersion | null {
  return [...store.accounting.facts.dividendCalculationVersions]
    .filter(
      (item) =>
        item.accountId === accountId &&
        item.dividendEventId === dividendEventId &&
        !item.supersededAt &&
        (item.status === "confirmed" || item.status === "amended"),
    )
    .sort(compareDividendCalculationVersionsDesc)[0] ?? null;
}

function nextDividendCalculationVersionNumber(
  store: Store,
  userId: string,
  accountId: string,
  dividendEventId: string,
): number {
  return [...store.accounting.facts.dividendCalculationVersions]
    .filter(
      (item) =>
        item.userId === userId &&
        item.accountId === accountId &&
        item.dividendEventId === dividendEventId,
    )
    .reduce((max, item) => Math.max(max, item.calculationVersion), 0) + 1;
}

function compareDividendCalculationVersionsDesc(
  left: DividendCalculationVersion,
  right: DividendCalculationVersion,
): number {
  return right.calculationVersion - left.calculationVersion
    || Date.parse(right.createdAt ?? "1970-01-01T00:00:00.000Z")
      - Date.parse(left.createdAt ?? "1970-01-01T00:00:00.000Z")
    || right.id.localeCompare(left.id);
}

function assertDividendCalculationMutationExpectation(
  currentActive: DividendCalculationVersion | null,
  input: {
    expectedActiveCalculationId?: string | null;
    expectedCalculationVersion?: number | null;
  },
): void {
  const actualActiveCalculationId = currentActive?.id ?? null;
  const actualCalculationVersion = currentActive?.calculationVersion ?? null;
  if (input.expectedActiveCalculationId === undefined && input.expectedCalculationVersion === undefined) {
    throw routeError(
      400,
      "dividend_calculation_expectation_required",
      "expectedActiveCalculationId or expectedCalculationVersion is required.",
    );
  }
  if (
    input.expectedActiveCalculationId !== undefined
    && input.expectedActiveCalculationId !== actualActiveCalculationId
  ) {
    throw routeError(
      409,
      "dividend_calculation_conflict",
      "The active dividend calculation changed. Refresh and retry.",
      { actualActiveCalculationId, actualCalculationVersion },
    );
  }
  if (
    input.expectedCalculationVersion !== undefined
    && (input.expectedCalculationVersion ?? null) !== actualCalculationVersion
  ) {
    throw routeError(
      409,
      "dividend_calculation_conflict",
      "The active dividend calculation changed. Refresh and retry.",
      { actualActiveCalculationId, actualCalculationVersion },
    );
  }
}

function mapDividendCalculationVersionDto(
  version: DividendCalculationVersion,
): DividendCalculationVersionDto {
  return {
    id: version.id,
    accountId: version.accountId,
    dividendEventId: version.dividendEventId,
    calculationVersion: version.calculationVersion,
    status: version.status,
    method: version.method,
    provider: {
      value: version.providerValue ?? null,
      unit: version.providerUnit ?? null,
      source: version.providerSource ?? null,
      dataset: version.providerDataset ?? null,
      authoritativeRatio: version.providerAuthoritativeRatio ?? null,
    },
    ratio: version.ratio,
    selectedParValue: version.selectedParValue ?? null,
    theoreticalShares: version.theoreticalShares,
    expectedWholeShares: version.expectedWholeShares ?? null,
    fractionalRemainder: version.fractionalRemainder ?? null,
    requiresHighRatioConfirmation: version.requiresHighRatioConfirmation,
    confirmedAt: version.confirmedAt ?? null,
    supersededAt: version.supersededAt ?? null,
    priorCalculationId: version.priorCalculationId ?? null,
    dividendLedgerEntryId: version.dividendLedgerEntryId ?? null,
    drift: version.drift ?? null,
  };
}

function deriveStockReconciliationStatusFromExpectation(
  receivedStockQuantity: number,
  expectedWholeShares: number,
): DividendReviewRowSummaryDto["stockReconciliationStatus"] {
  if (expectedWholeShares <= 0) return receivedStockQuantity > 0 ? "variance" : "pending_receipt";
  if (receivedStockQuantity === 0) return "pending_receipt";
  return receivedStockQuantity === expectedWholeShares ? "matched" : "variance";
}

function buildDividendReviewHeroAggregates(
  rows: readonly DividendReviewRowWithDetails[],
): import("@vakwen/shared-types").DividendReviewHeroAggregatesDto {
  const expectedByTicker = new Map<string, {
    marketCode: SharedMarketCode;
    ticker: string;
    expectedWholeShares: number | null;
    receivedShares: number | null;
    unresolvedEventCount: number;
  }>();
  const receivedByTicker = new Map<string, {
    marketCode: SharedMarketCode;
    ticker: string;
    expectedWholeShares: number | null;
    receivedShares: number | null;
    unresolvedEventCount: number;
  }>();
  let needsCalculationCount = 0;
  let cashAttentionCount = 0;
  let stockAttentionCount = 0;
  let needsAttentionCount = 0;

  for (const row of rows) {
    const cashNeedsAttention = row.cashReconciliationStatus === "open" || row.cashReconciliationStatus === "explained";
    if (cashNeedsAttention) {
      cashAttentionCount += 1;
    }
    const stockStatus = deriveDividendReviewStockStatus(row);
    if (stockStatus === "needs_calculation") needsCalculationCount += 1;
    const stockNeedsAttention = Boolean(stockStatus && stockStatus !== "matched");
    if (stockNeedsAttention) stockAttentionCount += 1;
    if (cashNeedsAttention || stockNeedsAttention) needsAttentionCount += 1;
    if (row.eventType === "CASH") continue;
    const key = `${row.marketCode}:${row.ticker}`;
    const expectedBucket = expectedByTicker.get(key) ?? {
      marketCode: row.marketCode as SharedMarketCode,
      ticker: row.ticker,
      expectedWholeShares: 0,
      receivedShares: null,
      unresolvedEventCount: 0,
    };
    if (row.expectedStockCalcState === "needs_action" || row.expectedStockQuantity == null) {
      expectedBucket.expectedWholeShares = expectedBucket.expectedWholeShares === 0 ? null : expectedBucket.expectedWholeShares;
      expectedBucket.unresolvedEventCount += 1;
    } else {
      expectedBucket.expectedWholeShares = (expectedBucket.expectedWholeShares ?? 0) + row.expectedStockQuantity;
    }
    expectedByTicker.set(key, expectedBucket);

    const receivedBucket = receivedByTicker.get(key) ?? {
      marketCode: row.marketCode as SharedMarketCode,
      ticker: row.ticker,
      expectedWholeShares: null,
      receivedShares: 0,
      unresolvedEventCount: 0,
    };
    receivedBucket.receivedShares = (receivedBucket.receivedShares ?? 0) + row.receivedStockQuantity;
    if (row.expectedStockCalcState === "needs_action" || row.expectedStockQuantity == null) {
      receivedBucket.unresolvedEventCount += 1;
    }
    receivedByTicker.set(key, receivedBucket);
  }

  const sortTickerAggregates = (
    items: Iterable<{
      marketCode: SharedMarketCode;
      ticker: string;
      expectedWholeShares: number | null;
      receivedShares: number | null;
      unresolvedEventCount: number;
    }>,
  ) => [...items].sort((left, right) =>
    left.marketCode.localeCompare(right.marketCode)
    || left.ticker.localeCompare(right.ticker)
  );

  const expectedSorted = sortTickerAggregates(expectedByTicker.values());
  const receivedSorted = sortTickerAggregates(receivedByTicker.values());
  return {
    expectedStockTickers: expectedSorted,
    expectedStockTopTickers: expectedSorted.slice(0, 3),
    expectedStockRemainingTickerCount: Math.max(0, expectedSorted.length - 3),
    receivedStockTickers: receivedSorted,
    receivedStockTopTickers: receivedSorted.slice(0, 3),
    receivedStockRemainingTickerCount: Math.max(0, receivedSorted.length - 3),
    needsCalculationCount,
    cashAttentionCount,
    stockAttentionCount,
    needsAttentionCount,
  };
}

function compareDividendReviewRows(
  left: DividendReviewRowWithDetails,
  right: DividendReviewRowWithDetails,
  accountById: ReadonlyMap<string, { name: string }>,
  opts: Pick<DividendReviewListOptions, "sortBy" | "sortOrder">,
): number {
  const leftAccountName = accountById.get(left.accountId)?.name ?? "";
  const rightAccountName = accountById.get(right.accountId)?.name ?? "";
  let cmp = 0;

  switch (opts.sortBy) {
    case "paymentDate":
      cmp = compareNullableIsoDateNullLast(left.paymentDate, right.paymentDate, opts.sortOrder);
      break;
    case "ticker":
      cmp = compareStringByOrder(left.ticker, right.ticker, opts.sortOrder);
      break;
    case "account":
      cmp = compareStringByOrder(leftAccountName, rightAccountName, opts.sortOrder);
      break;
    case "expectedNetAmount":
      cmp = compareNumberByOrder(left.expectedNetAmount ?? 0, right.expectedNetAmount ?? 0, opts.sortOrder);
      break;
    case "nhiAmount":
      cmp = compareNumberByOrder(left.nhiAmount ?? 0, right.nhiAmount ?? 0, opts.sortOrder);
      break;
    case "bankFeeAmount":
      cmp = compareNumberByOrder(left.bankFeeAmount ?? 0, right.bankFeeAmount ?? 0, opts.sortOrder);
      break;
    case "otherDeductionAmount":
      cmp = compareNumberByOrder(left.otherDeductionAmount ?? 0, right.otherDeductionAmount ?? 0, opts.sortOrder);
      break;
    case "actualNetAmount":
      cmp = compareNumberByOrder(left.actualNetAmount ?? 0, right.actualNetAmount ?? 0, opts.sortOrder);
      break;
    case "varianceAmount":
      cmp = compareNumberByOrder(left.varianceAmount ?? 0, right.varianceAmount ?? 0, opts.sortOrder);
      break;
    case "reconciliationStatus":
      cmp = compareStringByOrder(left.reconciliationStatus, right.reconciliationStatus, opts.sortOrder);
      break;
  }
  if (cmp !== 0) return cmp;

  cmp = compareAscNullableIsoDateNullLast(left.paymentDate, right.paymentDate);
  if (cmp !== 0) return cmp;

  cmp = left.ticker.localeCompare(right.ticker);
  if (cmp !== 0) return cmp;

  cmp = leftAccountName.localeCompare(rightAccountName);
  if (cmp !== 0) return cmp;

  return 0;
}

type DividendReviewReplayEntry =
  | { kind: "trade"; trade: BookedTradeEvent }
  | { kind: "action"; action: PositionAction };

function compareDividendReviewReplayEntries(left: DividendReviewReplayEntry, right: DividendReviewReplayEntry): number {
  const leftDate = left.kind === "trade" ? left.trade.tradeDate : left.action.actionDate;
  const rightDate = right.kind === "trade" ? right.trade.tradeDate : right.action.actionDate;
  if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

  const leftTimestamp = left.kind === "trade" ? left.trade.tradeTimestamp ?? null : left.action.actionTimestamp ?? null;
  const rightTimestamp = right.kind === "trade" ? right.trade.tradeTimestamp ?? null : right.action.actionTimestamp ?? null;
  if (Boolean(leftTimestamp) !== Boolean(rightTimestamp)) return leftTimestamp ? 1 : -1;
  if (leftTimestamp !== rightTimestamp) return (leftTimestamp ?? "").localeCompare(rightTimestamp ?? "");
  if (left.kind !== right.kind) return left.kind === "action" ? -1 : 1;

  const leftBookingSequence = left.kind === "trade" ? left.trade.bookingSequence ?? 0 : 0;
  const rightBookingSequence = right.kind === "trade" ? right.trade.bookingSequence ?? 0 : 0;
  if (leftBookingSequence !== rightBookingSequence) return leftBookingSequence - rightBookingSequence;
  const leftBookedAt = left.kind === "trade" ? left.trade.bookedAt ?? "" : left.action.bookedAt ?? "";
  const rightBookedAt = right.kind === "trade" ? right.trade.bookedAt ?? "" : right.action.bookedAt ?? "";
  if (leftBookedAt !== rightBookedAt) return leftBookedAt.localeCompare(rightBookedAt);
  const leftId = left.kind === "trade" ? left.trade.id : left.action.id;
  const rightId = right.kind === "trade" ? right.trade.id : right.action.id;
  return leftId.localeCompare(rightId);
}

function applyDividendReviewPositionActionToLots(currentLots: Lot[], action: PositionAction): Lot[] {
  if (action.reversalOfPositionActionId || action.supersededAt) {
    return currentLots;
  }

  if (action.actionType === "STOCK_DIVIDEND") {
    const nextSequence =
      currentLots
        .filter((lot) => lot.accountId === action.accountId && lot.ticker === action.ticker && lot.openedAt === action.actionDate)
        .reduce((max, lot) => Math.max(max, lot.openedSequence ?? 0), 0) + 1;
    return [
      ...currentLots,
      {
        id: `review-pa-${action.id}`,
        accountId: action.accountId,
        ticker: action.ticker,
        openQuantity: action.quantity,
        totalCostAmount: 0,
        costCurrency: currencyFor(action.marketCode),
        openedAt: action.actionDate,
        openedSequence: nextSequence,
      },
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

function deriveGeneratedDividendReviewEligibleQuantity(
  store: Store,
  userId: string,
  accountId: string,
  ticker: string,
  marketCode: MarketCode,
  exDividendDate: string,
  reversedTradeIds: ReadonlySet<string>,
): number {
  let lots: Lot[] = [];
  const stream: DividendReviewReplayEntry[] = [
    ...store.accounting.facts.tradeEvents
      .filter((trade) =>
        trade.userId === userId
        && trade.accountId === accountId
        && trade.ticker === ticker
        && trade.marketCode === marketCode
        && trade.tradeDate < exDividendDate
        && !trade.reversalOfTradeEventId
        && !reversedTradeIds.has(trade.id))
      .map((trade) => ({ kind: "trade" as const, trade })),
    ...store.accounting.facts.positionActions
      .filter((action) =>
        action.accountId === accountId
        && action.ticker === ticker
        && action.marketCode === marketCode
        && action.actionDate < exDividendDate)
      .map((action) => ({ kind: "action" as const, action })),
  ].sort(compareDividendReviewReplayEntries);

  try {
    for (const entry of stream) {
      if (entry.kind === "action") {
        lots = applyDividendReviewPositionActionToLots(lots, entry.action);
        continue;
      }

      if (entry.trade.type === "BUY") {
        lots = applyBuyToLots(lots, {
          id: `review-lot-${entry.trade.id}`,
          accountId: entry.trade.accountId,
          ticker: entry.trade.ticker,
          openQuantity: entry.trade.quantity,
          totalCostAmount: roundToDecimal(entry.trade.unitPrice * entry.trade.quantity, 2)
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
  } catch {
    return 0;
  }

  return Math.max(
    0,
    lots
      .filter((lot) => lot.accountId === accountId && lot.ticker === ticker && lot.openQuantity > 0)
      .reduce((sum, lot) => sum + lot.openQuantity, 0),
  );
}

function toShareGrantRecord(share: MemoryShare, owner: MemoryUser, grantee: MemoryUser): ShareGrantRecord {
  return {
    id: share.id,
    ownerUserId: owner.id,
    ownerEmail: owner.email,
    ownerDisplayName: owner.displayName,
    granteeUserId: grantee.id,
    granteeEmail: grantee.email,
    granteeDisplayName: grantee.displayName,
    createdAt: share.createdAt,
    revokedAt: share.revokedAt,
    revokedByUserId: share.revokedByUserId,
  };
}

function toAnonymousShareTokenRecord(row: MemoryAnonymousShareToken): AnonymousShareTokenRecord {
  return {
    id: row.id,
    token: row.token,
    ownerUserId: row.ownerUserId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    revokedAt: row.revokedAt,
    revokedByUserId: row.revokedByUserId,
  };
}

function toPendingShareInviteRecord(invite: MemoryInvite, owner: MemoryUser): PendingShareInviteRecord {
  return {
    code: invite.code,
    email: invite.email,
    role: invite.role,
    shareOwnerUserId: invite.shareOwnerUserId,
    ownerEmail: owner.email,
    ownerDisplayName: owner.displayName,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    revokedAt: invite.revokedAt,
    usedAt: invite.usedAt,
  };
}

// Share audit metadata + notification helpers live in shareHelpers.ts to keep
// memory and postgres backends aligned on shape.

function toNotificationDto(n: MemoryNotification): NotificationDto {
  return {
    id: n.id,
    userId: n.userId,
    severity: n.severity,
    source: n.source,
    sourceRef: n.sourceRef,
    title: n.title,
    body: n.body,
    detail: n.detail,
    readAt: n.readAt,
    escalatedAt: n.escalatedAt,
    dismissedAt: n.dismissedAt,
    createdAt: n.createdAt,
    updatedAt: n.updatedAt,
  };
}

function isCompleteHoldingSnapshot(snapshot: HoldingSnapshot): boolean {
  return !snapshot.isProvisional
    && snapshot.closePrice !== null
    && (
      snapshot.quantity <= 0
      || (
        snapshot.marketValue !== null
        && snapshot.valueNative !== null
      )
    )
    && snapshot.providerSource !== null;
}

function minIsoDate(left: string, right: string): string {
  return left <= right ? left : right;
}

// KZO-183 — application-layer mirror of the composite-FK ownership invariant
// that Postgres enforces via FK (fee_profile_id, account_id) → fee_profiles
// (id, account_id). Run inside `MemoryPersistence.saveStore` so memory-backed
// tests catch cross-account ownership violations that would be silently
// allowed by the unscoped FK in `MemoryPersistence` alone.
function validateMemoryStoreOwnership(store: Store): void {
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));
  for (const account of store.accounts) {
    const profile = profilesById.get(account.feeProfileId);
    if (!profile) {
      throw new Error(
        `account ${account.id} references missing fee profile ${account.feeProfileId}`,
      );
    }
    if (profile.accountId !== account.id) {
      throw new Error(
        `account ${account.id} references fee profile ${profile.id} owned by account ${profile.accountId}`,
      );
    }
  }
  for (const binding of store.feeProfileBindings) {
    const profile = profilesById.get(binding.feeProfileId);
    if (!profile) {
      throw new Error(
        `fee profile binding (${binding.accountId},${binding.ticker}) references missing profile ${binding.feeProfileId}`,
      );
    }
    if (profile.accountId !== binding.accountId) {
      throw new Error(
        `fee profile binding (${binding.accountId},${binding.ticker}) references profile ${profile.id} owned by account ${profile.accountId}`,
      );
    }
  }
}
