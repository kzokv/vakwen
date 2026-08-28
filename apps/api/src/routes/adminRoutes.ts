import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type {
  AiConnectorPolicySettingsDto,
  AppConfigDto,
  ProviderActivityItemDto,
  ProviderActivityResponse,
  ProviderFixerDashboardDiagnosticsResponse,
  ProviderFixerDashboardEvidenceSampleDto,
  ProviderFixerDashboardGuardrailSettingsDto,
  ProviderFixerDashboardLogEntryDto,
  ProviderFixerDashboardLogsResponse,
  ProviderFixerDashboardOperationDto,
  ProviderFixerDashboardOperationsResponse,
  ProviderFixerDashboardPreviewDto,
  ProviderFixerDashboardSummaryResponse,
  ProviderIncidentDto,
  ProviderIncidentsResponse,
  ProviderLogPurgeExecuteResponse,
  ProviderLogPurgePreviewResponse,
  ProviderOperationCandidateAttemptDto,
  ProviderOperationOutcomeDto,
  ProviderOperationOutcomeResult,
  ProviderOperationOutcomeSummaryDto,
  ProviderOperationOutcomesResponse,
  ProviderResolutionMappingDto,
  ProviderResolutionMappingsResponse,
  ProviderUnresolvedItemDto,
  ProviderUnresolvedItemUpdateResponse,
  ProviderUnresolvedItemsResponse,
  AdminInstrumentDto,
  AdminInstrumentStatus,
  AdminInstrumentSupportState,
  AdminMarketCode,
  AdminMarketDataActionDto,
  AdminMarketDataActionExecuteRequest,
  AdminMarketDataActionExecuteResponse,
  AdminMarketDataActionsResponse,
  AdminMarketDataBackfillUnresolvedSelectionDto,
  AdminMarketDataBackfillDateRangeDto,
  AdminMarketDataBackfillExecuteRequest,
  AdminMarketDataBackfillExecuteResponse,
  AdminMarketDataSnapshotRepairExecuteRequest,
  AdminMarketDataSnapshotRepairExecuteResponse,
  AdminMarketDataBackfillTargetDto,
  AdminMarketDataValuationRepairOperationDto,
  AdminMarketDataValuationRepairReason,
  AdminMarketDataValuationRepairStatusResponse,
  AdminMarketDataValuationRepairTickerStatusDto,
  AdminMarketDataDelistingOverrideRequest,
  AdminMarketDataDelistingOverrideResponse,
  AdminMarketDataActivityResponse,
  AdminMarketDataOperationDetailValue,
  AdminMarketDataOperationDto,
  AdminMarketDataOperationBlockerDto,
  AdminMarketDataOperationDetailsDto,
  AdminMarketDataOperationLogsResponse,
  AdminMarketDataBackfillPreviewRequest,
  AdminMarketDataBackfillPreviewResponse,
  AdminMarketCalendarConfirmRequest,
  AdminMarketCalendarConfirmResponse,
  AdminMarketCalendarHistoryResponse,
  AdminMarketCalendarInvalidateRequest,
  AdminMarketCalendarPreviewRequest,
  AdminMarketCalendarPreviewResponse,
  AdminMarketCalendarSourceConfigDto,
  AdminMarketCalendarStatusResponse,
  AdminMarketDataInstrumentDto,
  AdminMarketDataInstrumentsResponse,
  AdminMarketDataLandingResponse,
  AdminMarketDataOperationsResponse,
  AdminMarketDataOverviewResponse,
  AdminMarketDataProviderChipDto,
  AdminMarketDataPurgeDisabledReasonCode,
  AdminMarketDataPurgeExecuteRequest,
  AdminMarketDataPurgeExecuteResponse,
  AdminMarketDataPurgePreviewRequest,
  AdminMarketDataPurgePreviewResponse,
  AdminMarketDataSupportStateRequest,
  AdminMarketDataSupportStateResponse,
  AdminMarketDataUnresolvedBulkStateRequest,
  AdminMarketDataUnresolvedBulkStateResponse,
  AdminMarketDataUnresolvedItemDto,
  AdminMarketDataUnresolvedResponse,
  AdminMarketDataUnresolvedSort,
  AdminMarketDataUnresolvedStateResponse,
  AdminMarketWorkspaceTab,
  JpCatalogStockType,
  ProviderOperationAction,
  QuoteFallbackPolicyDto,
  QuoteFallbackPolicyRefreshResponse,
  QuoteFallbackPolicyResponse,
  QuoteFallbackPolicyUpsertRequest,
  QuoteFallbackSnapshotDto,
} from "@vakwen/shared-types";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  DEFAULT_DASHBOARD_PERFORMANCE_RANGES,
  JP_CATALOG_STOCK_TYPES,
  JP_CATALOG_STRICT_STOCK_TYPES,
  dashboardPerformanceRangesSchema,
} from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import { signImpersonationCookie } from "../auth/googleOAuth.js";
import { routeError } from "../lib/routeError.js";
import { requireAdminRole } from "../lib/routeGuards.js";
// KZO-198 Fix 3 — DTO is built directly from the post-write row + Env. The
// `getEffective*()` resolvers are NOT imported here because they read from
// the TTL cache, which may briefly be cold immediately after a PATCH
// `invalidate()` and would return env-fallback values for fields the user
// just wrote. The resolver-based cache path is the source of truth for
// source-code paths (rate-limit handlers, providers, etc.) — only the
// admin DTO bypasses it. KZO-197: the `getEffectiveProviderRerunCooldownMs()`
// import below remains for the `/admin/providers/:id/rerun` cooldown gate
// AND the `GET /admin/providers` per-row `rerunCooldownMs` field
// (cache-correct for both paths — the cache value is the same the rerun
// gate consults, so DB ⇄ UI stay coherent under live PATCHes).
import { getEffectiveProviderRerunCooldownMs } from "../services/appConfig/providerHealth.js";
import { PROVIDER_FIXER_DEFAULTS } from "../services/appConfig/providerFixer.js";
import {
  resolveTickerPriceFreshnessConfig,
  TICKER_PRICE_FRESHNESS_YAHOO_CHART_INTERVALS,
  TICKER_PRICE_FRESHNESS_YAHOO_CHART_RANGES,
} from "../services/appConfig/tickerPriceFreshness.js";
import {
  DEFAULT_VALUATION_HEALTH_THRESHOLDS,
  resolveRouteCachePolicyFromRow,
} from "../services/appConfig/valuationHealth.js";
import { enqueueAuCatalogBarsBackfill } from "../services/market-data/enqueueAuCatalogBarsBackfill.js";
import {
  buildAdminMarketCalendarHistory,
  buildAdminMarketCalendarStatus,
  confirmAdminMarketCalendarImport,
  isOfficialCalendarMarketCode,
  previewAdminMarketCalendarImport,
  updateAdminMarketCalendarSource,
} from "../services/market-data/marketCalendarService.js";
import { APP_CONFIG_BOUNDS, APP_CONFIG_SECRET_LENGTH } from "../services/appConfig/bounds.js";
import {
  invalidate as invalidateAppConfigCache,
  refresh as refreshAppConfigCache,
} from "../services/appConfig/cache.js";

const PROVIDER_MIN_REQUEST_INTERVAL_DEFAULTS = {
  finmindProviderMinRequestIntervalMs: 0,
  twelveDataProviderMinRequestIntervalMs: 0,
  yahooAuProviderMinRequestIntervalMs: 0,
  yahooKrProviderMinRequestIntervalMs: 1_000,
  yahooJpProviderMinRequestIntervalMs: 0,
  frankfurterProviderMinRequestIntervalMs: 0,
  asxGicsProviderMinRequestIntervalMs: 0,
} as const;
import type {
  AppConfigPlainField,
  ProviderOperationOutcomeRecord,
  ProviderOperationOutcomeState,
  ProviderOperationPhase,
  ProviderOperationRecord,
  SaveAiConnectorPolicySettingsInput,
} from "../persistence/types.js";
import {
  assertFreshAuth,
  createMcpFreshAuthToken,
  toAiConnectorPolicySettingsDto,
  updateAiConnectorPolicySettings,
} from "../services/mcpConnectorLifecycle.js";
import {
  FX_REFRESH_QUEUE,
  STORED_QUOTES,
} from "../services/market-data/fxRefreshWorker.js";
import { today_utc } from "../services/market-data/deriveFetchWindow.js";
import { enqueueDailyRefresh } from "../services/market-data/dailyRefreshEnqueue.js";
import { CATALOG_SYNC_QUEUE } from "../services/market-data/registerCatalogSyncWorker.js";
import { ASX_GICS_SYNC_QUEUE, ASX_GICS_SYNC_SINGLETON_KEY } from "../services/market-data/asxGicsSyncWorker.js";
import {
  PROVIDER_OPERATION_EXECUTION_QUEUE,
  providerOperationExecutionSingletonKey,
} from "../services/market-data/providerOperationExecutionWorker.js";
import {
  BACKFILL_QUEUE,
  getBackfillJobSingletonKey,
  getBackfillSingletonKey,
  type BackfillJobData,
} from "../services/market-data/backfillWorker.js";
import {
  defaultSnapshotRepairScanFromDate,
  getSnapshotRepairSingletonKey,
  SNAPSHOT_REPAIR_QUEUE,
  type SnapshotRepairJobData,
} from "../services/snapshotRepair.js";
import { historyStartFor, RateLimitedError, type MarketDataResolverMode, type ProviderSymbolVerificationResult } from "../services/market-data/types.js";
import { yahooSuffixHintFromKrCatalogEvidence } from "../services/market-data/providers/twelveDataKr.js";
import {
  QUOTE_FALLBACK_REFRESH_QUEUE,
  quoteFallbackRefreshSingletonKey,
} from "../services/market-data/quoteFallbackRefreshWorker.js";
import type { MarketCode } from "@vakwen/domain";
import type {
  AdminProvidersResponse,
  ProviderHealthStatusDto,
  ProviderErrorTrailEntryDto,
} from "@vakwen/shared-types";
import {
  calendarMarketForProvider,
  computeStatus,
  type ProviderId,
} from "../services/market-data/providerHealth.js";
import { listProviderOperationCapabilities } from "../services/market-data/providerOperationCapabilities.js";
import {
  impersonationClearCookieString,
  impersonationSetCookieString,
  requireSessionUserId,
  userRoleSchema,
  userScopedIdSchema,
} from "./registerRoutes.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const ISO_DATE_ONLY_FILTER = /^\d{4}-\d{2}-\d{2}$/;
const isoDateTimeFilterSchema = z.string().trim().max(40).refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}, "Must be an ISO date or datetime");
const fxBaseCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);

type StoppedProviderOperationPhase = Extract<ProviderOperationPhase, "cancelled" | "paused">;

const YAHOO_KR_OPERATION_RATE_SAFETY_MULTIPLIER = 0.75;
const RESUMABLE_PROVIDER_OUTCOME_STATES = new Set<ProviderOperationOutcomeState>([
  "pending",
  "running",
  "rate_limited",
]);

class ProviderOperationStoppedError extends Error {
  constructor(public readonly operation: ProviderOperationRecord & { phase: StoppedProviderOperationPhase }) {
    super(`Provider operation ${operation.phase}.`);
    this.name = "ProviderOperationStoppedError";
  }
}

function catalogSyncRerunSingletonKey(marketCode: MarketCode): string {
  return `${CATALOG_SYNC_QUEUE}:${marketCode}`;
}

function duplicateProviderUnresolvedOutcomeSourceSymbols(
  items: readonly {
    sourceSymbol: string;
  }[],
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const sourceSymbol = item.sourceSymbol.trim().toUpperCase();
    counts.set(sourceSymbol, (counts.get(sourceSymbol) ?? 0) + 1);
  }
  return new Set([...counts].filter(([, count]) => count > 1).map(([sourceSymbol]) => sourceSymbol));
}

function providerUnresolvedOutcomeSourceSymbol(
  item: {
    providerId: string;
    errorCode: string;
    sourceSymbol: string;
  },
  duplicateSourceSymbols: ReadonlySet<string>,
): string {
  const sourceSymbol = item.sourceSymbol.trim().toUpperCase();
  if (!duplicateSourceSymbols.has(sourceSymbol)) return sourceSymbol;
  return [
    sourceSymbol,
    item.providerId.trim().toUpperCase(),
    item.errorCode.trim().toUpperCase(),
  ].join("::");
}

function providerUnresolvedOutcomeEvidence(
  item: {
    providerId: string;
    marketCode: string;
    errorCode: string;
    sourceSymbol: string;
  },
  evidence: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...evidence,
    unresolvedIdentity: {
      providerId: item.providerId,
      marketCode: item.marketCode,
      errorCode: item.errorCode,
      sourceSymbol: item.sourceSymbol,
    },
  };
}

const fxRefreshBodySchema = z
  .object({
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    bases: z.array(fxBaseCurrencySchema).min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.startDate && value.endDate && value.startDate > value.endDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "startDate must be before or equal to endDate",
        path: ["startDate"],
      });
    }
  });

const adminProviderRerunBodySchema = z
  .object({
    resolverMode: z.enum(["chart_probe_v1", "quote_first"]).optional(),
    resolverModeRiskAccepted: z.boolean().optional(),
  })
  .strict();

/**
 * KZO-198: a Tier 1 plain field accepts an integer within `APP_CONFIG_BOUNDS`,
 * or `null` to clear the override (falls back to env). Single source of truth
 * for `min`/`max` is `bounds.ts` — never inline here.
 */
function plainBoundedField(key: keyof typeof APP_CONFIG_BOUNDS) {
  const { min, max } = APP_CONFIG_BOUNDS[key];
  return z.union([z.number().int().min(min).max(max), z.null()]).optional();
}

/**
 * KZO-195 — non-int variant for `catalogAbsenceGuardPercent`. Zod's `.int()`
 * is too strict for a percentage that may legitimately be 1.0 / 0.5 / etc.
 */
function plainBoundedDecimalField(key: keyof typeof APP_CONFIG_BOUNDS) {
  const { min, max } = APP_CONFIG_BOUNDS[key];
  return z.union([z.number().min(min).max(max), z.null()]).optional();
}

/**
 * KZO-198 Tier 0: a Tier 0 secret accepts a plaintext string within
 * `APP_CONFIG_SECRET_LENGTH` (denoting a rotation), or `null` to clear.
 * The plaintext is encrypted at the persistence boundary (never logged).
 */
const tier0SecretField = z
  .union([
    z.string().min(APP_CONFIG_SECRET_LENGTH.min).max(APP_CONFIG_SECRET_LENGTH.max),
    z.null(),
  ])
  .optional();

const jpCatalogStockTypeSchema = z.enum(JP_CATALOG_STOCK_TYPES);

function uniqueJpCatalogStockTypes(values: JpCatalogStockType[]): JpCatalogStockType[] {
  return [...new Set(values)];
}

const jpCatalogAllowedStockTypesField = z
  .union([
    z
      .array(jpCatalogStockTypeSchema)
      .min(1)
      .max(JP_CATALOG_STOCK_TYPES.length)
      .transform(uniqueJpCatalogStockTypes),
    z.null(),
  ])
  .optional();

function resolveEffectiveJpCatalogAllowedStockTypes(
  value: JpCatalogStockType[] | null,
): JpCatalogStockType[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...JP_CATALOG_STRICT_STOCK_TYPES];
  }
  return uniqueJpCatalogStockTypes(value);
}

function normalizeMcpOAuthIssuer(value: string): string {
  const url = new URL(value);
  url.pathname = "";
  url.search = "";
  url.hash = "";
  const localRuntime = Env.NODE_ENV === "test" || Env.NODE_ENV === "development";
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localRuntime && localHost)) {
    throw routeError(400, "mcp_oauth_issuer_https_required", "MCP OAuth public issuer must use HTTPS");
  }
  return url.toString().replace(/\/$/, "");
}

function normalizeMcpOAuthRedirectUri(value: string): string {
  const url = new URL(value);
  const localRuntime = Env.NODE_ENV === "test" || Env.NODE_ENV === "development";
  const localHost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(localRuntime && localHost)) {
    throw routeError(400, "mcp_oauth_redirect_https_required", "MCP OAuth redirect URIs must use HTTPS");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname === "/" || url.pathname === "") {
    throw routeError(400, "mcp_oauth_redirect_invalid", "MCP OAuth redirect URIs must be exact path URLs without query or hash");
  }
  return url.toString();
}

const aiConnectorPolicySettingsPatchSchema = z
  .object({
    enabled: z.boolean().optional(),
    maxActiveConnectionsPerUser: z.number().int().min(1).max(25).optional(),
    postedTransactionMutationBatchLimit: z.number().int().positive().optional(),
    allowedProviders: z
      .object({
        chatgpt: z.boolean().optional(),
        self_hosted: z.boolean().optional(),
      })
      .strict()
      .optional(),
    allowedClientKinds: z
      .object({
        chatgpt_app: z.boolean().optional(),
        claude_ai_connector: z.boolean().optional(),
        claude_code: z.boolean().optional(),
        codex_cli: z.boolean().optional(),
        gemini_cli: z.boolean().optional(),
        copilot_mcp: z.boolean().optional(),
        generic_mcp: z.boolean().optional(),
      })
      .strict()
      .optional(),
    groupToggles: z
      .object({
        read: z.boolean().optional(),
        research: z.boolean().optional(),
        drafts: z.boolean().optional(),
        write: z.boolean().optional(),
      })
      .strict()
      .optional(),
    bearerFallback: z
      .object({
        enabled: z.boolean().optional(),
        allowedClientKinds: z
          .array(z.enum(["chatgpt_app", "claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"]))
          .max(6)
          .transform((values) => [...new Set(values)])
          .optional(),
        maxLifetimeDays: z.number().int().min(1).max(365).optional(),
        maxActiveConnectorsPerUser: z.number().int().min(1).max(25).optional(),
        allowedToolGroups: z
          .array(z.enum(["read", "research", "drafts", "write"]))
          .max(4)
          .transform((values) => [...new Set(values)])
          .optional(),
      })
      .strict()
      .optional(),
    inactivityExpiryDays: z.number().int().min(1).max(365).optional(),
    expirationWarningDays: z.number().int().min(1).max(60).optional(),
    freshAuthMaxAgeMs: z.number().int().min(60_000).max(86_400_000).optional(),
    maxConnectorLifetimeDays: z.number().int().min(1).max(365).optional(),
    oauthPublicIssuer: z.union([
      z.string().url().transform((value) => normalizeMcpOAuthIssuer(value)),
      z.null(),
    ]).optional(),
    oauthRedirectUriAllowlist: z
      .array(z.string().url().transform((value) => normalizeMcpOAuthRedirectUri(value)))
      .max(100)
      .transform((values) => [...new Set(values)])
      .optional(),
    mcpOauthTokenSecret: tier0SecretField,
  })
  .strict();

const tickerPriceFreshnessPatchSchema = z
  .object({
    closeRefreshGraceMinutes: plainBoundedField("tickerPriceCloseRefreshGraceMinutes"),
    intradayEnabled: z.union([z.boolean(), z.null()]).optional(),
    intradayRefreshIntervalMinutes: plainBoundedField("tickerPriceIntradayRefreshIntervalMinutes"),
    intradayFreshnessToleranceMinutes: plainBoundedField("tickerPriceIntradayFreshnessToleranceMinutes"),
    yahooChartRequestLimitPerMinute: plainBoundedField("tickerPriceYahooChartRequestLimitPerMinute"),
    queueConcurrency: plainBoundedField("tickerPriceQueueConcurrency"),
    maxTickersPerRefreshCycle: plainBoundedField("tickerPriceMaxTickersPerRefreshCycle"),
    supportedMarkets: z.union([
      z.array(z.enum(MARKET_CODES)).min(1).max(MARKET_CODES.length).transform((values) => [...new Set(values)]),
      z.null(),
    ]).optional(),
    regularSessionOnly: z.union([z.boolean(), z.null()]).optional(),
    yahooChartRange: z.union([z.enum(TICKER_PRICE_FRESHNESS_YAHOO_CHART_RANGES), z.null()]).optional(),
    yahooChartInterval: z.union([z.enum(TICKER_PRICE_FRESHNESS_YAHOO_CHART_INTERVALS), z.null()]).optional(),
    refreshCloseRateLimitWindowMs: plainBoundedField("tickerPriceRefreshCloseRateLimitWindowMs"),
    refreshCloseRateLimitMax: plainBoundedField("tickerPriceRefreshCloseRateLimitMax"),
    syncTickerCap: plainBoundedField("tickerPriceSyncTickerCap"),
    activityDetailedRetentionDays: plainBoundedField("tickerPriceActivityDetailedRetentionDays"),
    activitySummaryRetentionDays: plainBoundedField("tickerPriceActivitySummaryRetentionDays"),
    calendarHistoryRetentionDays: plainBoundedField("tickerPriceCalendarHistoryRetentionDays"),
  })
  .strict();

export const patchAdminSettingsSchema = z
  .object({
    // KZO-133 — pre-existing
    repairCooldownMinutes: plainBoundedField("repairCooldownMinutes"),
    // KZO-159 (158A): admin override for the user-facing timeframe picker.
    // `null` clears the override (falls back to the hardcoded default list).
    dashboardPerformanceRanges: z
      .union([dashboardPerformanceRangesSchema, z.null()])
      .optional(),
    // KZO-189: admin override for AU metadata enrichment mode.
    // `null` clears the override (falls back to Env.METADATA_ENRICHMENT_MODE).
    metadataEnrichmentMode: z
      .union([z.enum(["unconditional", "conditional"]), z.null()])
      .optional(),

    // ── KZO-198 Tier 1 — rate limits ────────────────────────────────────
    marketDataPriceWindowMs: plainBoundedField("marketDataPriceWindowMs"),
    marketDataPriceLimit: plainBoundedField("marketDataPriceLimit"),
    marketDataSearchWindowMs: plainBoundedField("marketDataSearchWindowMs"),
    marketDataSearchLimit: plainBoundedField("marketDataSearchLimit"),
    inviteStatusWindowMs: plainBoundedField("inviteStatusWindowMs"),
    inviteStatusLimit: plainBoundedField("inviteStatusLimit"),

    // ── KZO-198 Tier 1 — provider health ────────────────────────────────
    providerDownNotificationSuppressionMs: plainBoundedField("providerDownNotificationSuppressionMs"),
    providerErrorTrailRetentionDays: plainBoundedField("providerErrorTrailRetentionDays"),
    providerRerunCooldownMs: plainBoundedField("providerRerunCooldownMs"),
    // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
    yahooAuRerunCooldownMs: plainBoundedField("yahooAuRerunCooldownMs"),
    providerFixerDangerousMatchThreshold: plainBoundedField("providerFixerDangerousMatchThreshold"),
    providerFixerPreviewSampleLimit: plainBoundedField("providerFixerPreviewSampleLimit"),
    providerFixerUiPageSize: plainBoundedField("providerFixerUiPageSize"),
    providerFixerAutoPauseFailuresPerMinute: plainBoundedField("providerFixerAutoPauseFailuresPerMinute"),
    providerFixerPreviewTokenTtlMinutes: plainBoundedField("providerFixerPreviewTokenTtlMinutes"),
    providerOperationAutoRenewIntervalMinutes: plainBoundedField("providerOperationAutoRenewIntervalMinutes"),
    providerIncidentRecurrenceWindowMinutes: plainBoundedField("providerIncidentRecurrenceWindowMinutes"),
    providerHealthWarningUnresolvedThreshold: plainBoundedField("providerHealthWarningUnresolvedThreshold"),
    providerHealthCriticalUnresolvedThreshold: plainBoundedField("providerHealthCriticalUnresolvedThreshold"),
    providerOperationStaleHeartbeatMinutes: plainBoundedField("providerOperationStaleHeartbeatMinutes"),
    providerOperationSummaryRetentionDays: plainBoundedField("providerOperationSummaryRetentionDays"),
    providerOperationLogRetentionDays: plainBoundedField("providerOperationLogRetentionDays"),
    providerIncidentRetentionDays: plainBoundedField("providerIncidentRetentionDays"),
    providerResolvedItemRetentionDays: plainBoundedField("providerResolvedItemRetentionDays"),
    finmindProviderRateLimitPerHour: plainBoundedField("finmindProviderRateLimitPerHour"),
    twelveDataProviderRateLimitPerMinute: plainBoundedField("twelveDataProviderRateLimitPerMinute"),
    yahooAuProviderRateLimitPerMinute: plainBoundedField("yahooAuProviderRateLimitPerMinute"),
    yahooKrProviderRateLimitPerMinute: plainBoundedField("yahooKrProviderRateLimitPerMinute"),
    yahooJpProviderRateLimitPerMinute: plainBoundedField("yahooJpProviderRateLimitPerMinute"),
    frankfurterProviderRateLimitPerMinute: plainBoundedField("frankfurterProviderRateLimitPerMinute"),
    asxGicsProviderRateLimitPerHour: plainBoundedField("asxGicsProviderRateLimitPerHour"),
    finmindProviderMinRequestIntervalMs: plainBoundedField("finmindProviderMinRequestIntervalMs"),
    twelveDataProviderMinRequestIntervalMs: plainBoundedField("twelveDataProviderMinRequestIntervalMs"),
    yahooAuProviderMinRequestIntervalMs: plainBoundedField("yahooAuProviderMinRequestIntervalMs"),
    yahooKrProviderMinRequestIntervalMs: plainBoundedField("yahooKrProviderMinRequestIntervalMs"),
    yahooJpProviderMinRequestIntervalMs: plainBoundedField("yahooJpProviderMinRequestIntervalMs"),
    frankfurterProviderMinRequestIntervalMs: plainBoundedField("frankfurterProviderMinRequestIntervalMs"),
    asxGicsProviderMinRequestIntervalMs: plainBoundedField("asxGicsProviderMinRequestIntervalMs"),

    // ── KZO-198 Tier 1/2 — backfill ─────────────────────────────────────
    backfillRetryLimit: plainBoundedField("backfillRetryLimit"),
    backfillRetryDelaySeconds: plainBoundedField("backfillRetryDelaySeconds"),
    backfillFinmind402RetryMs: plainBoundedField("backfillFinmind402RetryMs"),
    tickerPriceFreshness: tickerPriceFreshnessPatchSchema.optional(),

    // Tier 2 (`dailyRefreshLookbackDays`, `dailyRefreshPriority`,
    // `sseHeartbeatIntervalMs`, `sseMaxConnectionsPerUser`,
    // `sseBufferDefaultTtlMs`) is DB+SQL only per scope-todo — operators
    // override via direct SQL. `.strict()` below rejects them with a 400.

    // ── KZO-198 Tier 0 — encrypted secrets (rotation flow) ──────────────
    finmindApiToken: tier0SecretField,
    twelveDataApiKey: tier0SecretField,
    eodhdApiKey: tier0SecretField,
    eodhdDailyCallLimit: plainBoundedField("eodhdDailyCallLimit"),

    // ── KZO-195 Tier 2 — absence-based delisting detection ─────────────
    catalogAbsenceThreshold: plainBoundedField("catalogAbsenceThreshold"),
    catalogAbsenceGuardPercent: plainBoundedDecimalField("catalogAbsenceGuardPercent"),
    catalogAbsenceGuardFloor: plainBoundedField("catalogAbsenceGuardFloor"),
    jpCatalogAllowedStockTypes: jpCatalogAllowedStockTypesField,
    jpCatalogIncludeDepositaryReceipts: z.union([z.boolean(), z.null()]).optional(),
    jpCatalogIncludeAtSymbols: z.union([z.boolean(), z.null()]).optional(),

    // ── KZO-199 Tier 1 — sharing knobs ──────────────────────────────────
    anonymousShareTokenCap: plainBoundedField("anonymousShareTokenCap"),
    anonymousShareRateLimitMax: plainBoundedField("anonymousShareRateLimitMax"),
    anonymousShareRateLimitWindowMs: plainBoundedField("anonymousShareRateLimitWindowMs"),

    // ── ui-enhancement Tier B — account lifecycle ───────────────────────
    accountHardPurgeDays: plainBoundedField("accountHardPurgeDays"),
    valuationHealthRelativeBps: plainBoundedField("valuationHealthRelativeBps"),
    valuationHealthAbsoluteAud: plainBoundedDecimalField("valuationHealthAbsoluteAud"),
    valuationHealthAbsoluteUsd: plainBoundedDecimalField("valuationHealthAbsoluteUsd"),
    valuationHealthAbsoluteTwd: plainBoundedDecimalField("valuationHealthAbsoluteTwd"),
    valuationHealthAbsoluteKrw: plainBoundedDecimalField("valuationHealthAbsoluteKrw"),
    valuationHealthAbsoluteJpy: plainBoundedDecimalField("valuationHealthAbsoluteJpy"),
    routeCachePolicyMode: z.union([z.enum(["fresh", "balanced", "low_load", "custom"]), z.null()]).optional(),
    routeCacheDashboardPrimaryTtlMs: plainBoundedField("routeCacheDashboardPrimaryTtlMs"),
    routeCacheDashboardEnrichmentTtlMs: plainBoundedField("routeCacheDashboardEnrichmentTtlMs"),
    routeCacheDashboardPerformanceTtlMs: plainBoundedField("routeCacheDashboardPerformanceTtlMs"),
    routeCachePortfolioTtlMs: plainBoundedField("routeCachePortfolioTtlMs"),
    routeCacheReportsTtlMs: plainBoundedField("routeCacheReportsTtlMs"),
    routeCacheStaleUsableTtlMs: plainBoundedField("routeCacheStaleUsableTtlMs"),

    // KZO-199 Tier 2 fields (anonymousShareTokenRetentionMs,
    // userPreferencesMaxBytes) are deliberately NOT in this PATCH schema —
    // DB+SQL only. `.strict()` rejects them with a 400.
  })
  .strict();

/**
 * KZO-198 — list of plain camelCase fields handled by the generic per-field
 * setter `setAppConfigField`. Order does not matter; the PATCH handler walks
 * this list and only writes when the request body has a defined value that
 * differs from the current state.
 */
/**
 * KZO-198 — Tier 1 plain camelCase fields handled by the PATCH route. Tier 2
 * (daily refresh + SSE) fields are deliberately absent — DB+SQL only. The
 * literal tuple type is keyed off the PATCH schema so indexing `body[field]`
 * type-checks without `any` casts.
 */
const TIER1_PLAIN_FIELDS = [
  "marketDataPriceWindowMs",
  "marketDataPriceLimit",
  "marketDataSearchWindowMs",
  "marketDataSearchLimit",
  "inviteStatusWindowMs",
  "inviteStatusLimit",
  "providerDownNotificationSuppressionMs",
  "providerErrorTrailRetentionDays",
  "providerRerunCooldownMs",
  // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
  "yahooAuRerunCooldownMs",
  "providerFixerDangerousMatchThreshold",
  "providerFixerPreviewSampleLimit",
  "providerFixerUiPageSize",
  "providerFixerAutoPauseFailuresPerMinute",
  "providerFixerPreviewTokenTtlMinutes",
  "providerOperationAutoRenewIntervalMinutes",
  "providerIncidentRecurrenceWindowMinutes",
  "providerHealthWarningUnresolvedThreshold",
  "providerHealthCriticalUnresolvedThreshold",
  "providerOperationStaleHeartbeatMinutes",
  "providerOperationSummaryRetentionDays",
  "providerOperationLogRetentionDays",
  "providerIncidentRetentionDays",
  "providerResolvedItemRetentionDays",
  "finmindProviderRateLimitPerHour",
  "twelveDataProviderRateLimitPerMinute",
  "yahooAuProviderRateLimitPerMinute",
  "yahooKrProviderRateLimitPerMinute",
  "yahooJpProviderRateLimitPerMinute",
  "frankfurterProviderRateLimitPerMinute",
  "asxGicsProviderRateLimitPerHour",
  "finmindProviderMinRequestIntervalMs",
  "twelveDataProviderMinRequestIntervalMs",
  "yahooAuProviderMinRequestIntervalMs",
  "yahooKrProviderMinRequestIntervalMs",
  "yahooJpProviderMinRequestIntervalMs",
  "frankfurterProviderMinRequestIntervalMs",
  "asxGicsProviderMinRequestIntervalMs",
  "backfillRetryLimit",
  "backfillRetryDelaySeconds",
  "backfillFinmind402RetryMs",
  "tickerPriceCloseRefreshGraceMinutes",
  "tickerPriceIntradayEnabled",
  "tickerPriceIntradayRefreshIntervalMinutes",
  "tickerPriceIntradayFreshnessToleranceMinutes",
  "tickerPriceYahooChartRequestLimitPerMinute",
  "tickerPriceQueueConcurrency",
  "tickerPriceMaxTickersPerRefreshCycle",
  "tickerPriceSupportedMarkets",
  "tickerPriceRegularSessionOnly",
  "tickerPriceYahooChartRange",
  "tickerPriceYahooChartInterval",
  "tickerPriceRefreshCloseRateLimitWindowMs",
  "tickerPriceRefreshCloseRateLimitMax",
  "tickerPriceSyncTickerCap",
  "tickerPriceActivityDetailedRetentionDays",
  "tickerPriceActivitySummaryRetentionDays",
  "tickerPriceCalendarHistoryRetentionDays",
  // KZO-195 — Tier 2 absence detection fields (admin-tunable via PATCH).
  "catalogAbsenceThreshold",
  "catalogAbsenceGuardPercent",
  "catalogAbsenceGuardFloor",
  "jpCatalogAllowedStockTypes",
  "jpCatalogIncludeDepositaryReceipts",
  "jpCatalogIncludeAtSymbols",
  // KZO-199 — Tier 1 sharing knobs (admin-tunable via PATCH).
  "anonymousShareTokenCap",
  "anonymousShareRateLimitMax",
  "anonymousShareRateLimitWindowMs",
  // ui-enhancement — Tier B account-soft-delete grace period.
  "accountHardPurgeDays",
  "valuationHealthRelativeBps",
  "valuationHealthAbsoluteAud",
  "valuationHealthAbsoluteUsd",
  "valuationHealthAbsoluteTwd",
  "valuationHealthAbsoluteKrw",
  "valuationHealthAbsoluteJpy",
  "routeCacheDashboardPrimaryTtlMs",
  "routeCacheDashboardEnrichmentTtlMs",
  "routeCacheDashboardPerformanceTtlMs",
  "routeCachePortfolioTtlMs",
  "routeCacheReportsTtlMs",
  "routeCacheStaleUsableTtlMs",
  "eodhdDailyCallLimit",
] as const satisfies ReadonlyArray<AppConfigPlainField>;

function flattenTickerPriceFreshnessPatch(
  value: z.infer<typeof tickerPriceFreshnessPatchSchema> | undefined,
): Partial<Record<AppConfigPlainField, import("../persistence/types.js").AppConfigPlainValue>> {
  if (!value) return {};
  return {
    tickerPriceCloseRefreshGraceMinutes: value.closeRefreshGraceMinutes,
    tickerPriceIntradayEnabled: value.intradayEnabled,
    tickerPriceIntradayRefreshIntervalMinutes: value.intradayRefreshIntervalMinutes,
    tickerPriceIntradayFreshnessToleranceMinutes: value.intradayFreshnessToleranceMinutes,
    tickerPriceYahooChartRequestLimitPerMinute: value.yahooChartRequestLimitPerMinute,
    tickerPriceQueueConcurrency: value.queueConcurrency,
    tickerPriceMaxTickersPerRefreshCycle: value.maxTickersPerRefreshCycle,
    tickerPriceSupportedMarkets: value.supportedMarkets,
    tickerPriceRegularSessionOnly: value.regularSessionOnly,
    tickerPriceYahooChartRange: value.yahooChartRange,
    tickerPriceYahooChartInterval: value.yahooChartInterval,
    tickerPriceRefreshCloseRateLimitWindowMs: value.refreshCloseRateLimitWindowMs,
    tickerPriceRefreshCloseRateLimitMax: value.refreshCloseRateLimitMax,
    tickerPriceSyncTickerCap: value.syncTickerCap,
    tickerPriceActivityDetailedRetentionDays: value.activityDetailedRetentionDays,
    tickerPriceActivitySummaryRetentionDays: value.activitySummaryRetentionDays,
    tickerPriceCalendarHistoryRetentionDays: value.calendarHistoryRetentionDays,
  };
}

function appConfigValuesEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) return false;
    return left.length === right.length && left.every((value, index) => value === right[index]);
  }
  return left === right;
}

function resolveAdminContext(req: FastifyRequest, _app: FastifyInstance) {
  const sessionUserId = requireSessionUserId(req);
  return {
    sessionUserId,
    ipAddress: req.ip,
    email: req.authContext?.email ?? null,
  };
}

function assertNotSelf(sessionUserId: string, targetUserId: string): void {
  if (targetUserId === sessionUserId) {
    throw routeError(403, "self_operation_blocked", "Cannot perform this action on your own account");
  }
}

function resolveEffectiveDashboardPerformanceRanges(
  override: string[] | null,
): string[] {
  if (Array.isArray(override) && override.length > 0) {
    return [...override];
  }
  return [...DEFAULT_DASHBOARD_PERFORMANCE_RANGES];
}

function appConfigBoundsForEnv(): AppConfigDto["bounds"] {
  const strictOverrideMax = (ceiling: number): number => Math.max(1, ceiling - 1);
  return {
    ...APP_CONFIG_BOUNDS,
    finmindProviderRateLimitPerHour: {
      min: APP_CONFIG_BOUNDS.finmindProviderRateLimitPerHour.min,
      max: strictOverrideMax(Env.FINMIND_RATE_LIMIT_PER_HOUR),
    },
    twelveDataProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.twelveDataProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE),
    },
    yahooAuProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.yahooAuProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.YAHOO_AU_RATE_LIMIT_PER_MINUTE),
    },
    yahooKrProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.yahooKrProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.YAHOO_KR_RATE_LIMIT_PER_MINUTE),
    },
    yahooJpProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.yahooJpProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.YAHOO_JP_RATE_LIMIT_PER_MINUTE),
    },
    frankfurterProviderRateLimitPerMinute: {
      min: APP_CONFIG_BOUNDS.frankfurterProviderRateLimitPerMinute.min,
      max: strictOverrideMax(Env.FRANKFURTER_RATE_LIMIT_PER_MINUTE),
    },
    asxGicsProviderRateLimitPerHour: {
      min: APP_CONFIG_BOUNDS.asxGicsProviderRateLimitPerHour.min,
      max: strictOverrideMax(Env.ASX_GICS_RATE_LIMIT_PER_HOUR),
    },
  };
}

function assertProviderRateBudgetOverrides(body: z.infer<typeof patchAdminSettingsSchema>): void {
  const checks: Array<{ field: keyof typeof body; value: unknown; max: number }> = [
    { field: "finmindProviderRateLimitPerHour", value: body.finmindProviderRateLimitPerHour, max: Env.FINMIND_RATE_LIMIT_PER_HOUR },
    { field: "twelveDataProviderRateLimitPerMinute", value: body.twelveDataProviderRateLimitPerMinute, max: Env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE },
    { field: "yahooAuProviderRateLimitPerMinute", value: body.yahooAuProviderRateLimitPerMinute, max: Env.YAHOO_AU_RATE_LIMIT_PER_MINUTE },
    { field: "yahooKrProviderRateLimitPerMinute", value: body.yahooKrProviderRateLimitPerMinute, max: Env.YAHOO_KR_RATE_LIMIT_PER_MINUTE },
    { field: "yahooJpProviderRateLimitPerMinute", value: body.yahooJpProviderRateLimitPerMinute, max: Env.YAHOO_JP_RATE_LIMIT_PER_MINUTE },
    { field: "frankfurterProviderRateLimitPerMinute", value: body.frankfurterProviderRateLimitPerMinute, max: Env.FRANKFURTER_RATE_LIMIT_PER_MINUTE },
    { field: "asxGicsProviderRateLimitPerHour", value: body.asxGicsProviderRateLimitPerHour, max: Env.ASX_GICS_RATE_LIMIT_PER_HOUR },
  ];
  for (const check of checks) {
    if (typeof check.value === "number" && check.value >= check.max) {
      throw routeError(
        400,
        "provider_rate_budget_exceeded",
        `${String(check.field)} must be greater than 0 and below the configured provider budget (${check.max}).`,
      );
    }
  }
}

function hourlyBudgetToPerMinute(value: number): number {
  return Math.max(0.01, Math.round((value / 60) * 100) / 100);
}

function providerOperationRateCapPerMinute(providerId: string, config: AppConfigDto): number {
  if (providerId === "finmind-tw" || providerId === "finmind-us") {
    return hourlyBudgetToPerMinute(config.effectiveFinmindProviderRateLimitPerHour);
  }
  if (providerId === "twelve-data-au" || providerId === "twelve-data-kr" || providerId === "twelve-data-jp") {
    return config.effectiveTwelveDataProviderRateLimitPerMinute;
  }
  if (providerId === "yahoo-finance-au") {
    return config.effectiveYahooAuProviderRateLimitPerMinute;
  }
  if (providerId === "yahoo-finance-kr") {
    return Math.max(
      0.01,
      Math.round(config.effectiveYahooKrProviderRateLimitPerMinute * YAHOO_KR_OPERATION_RATE_SAFETY_MULTIPLIER * 100) / 100,
    );
  }
  if (providerId === "yahoo-finance-jp") {
    return config.effectiveYahooJpProviderRateLimitPerMinute;
  }
  if (providerId === "frankfurter") {
    return config.effectiveFrankfurterProviderRateLimitPerMinute;
  }
  if (providerId === "asx-gics-csv") {
    return hourlyBudgetToPerMinute(config.effectiveAsxGicsProviderRateLimitPerHour);
  }
  return 250;
}

function effectiveProviderMinRequestIntervalMs(
  key: keyof typeof PROVIDER_MIN_REQUEST_INTERVAL_DEFAULTS,
  override: number | null,
): number {
  return override ?? PROVIDER_MIN_REQUEST_INTERVAL_DEFAULTS[key];
}

function assertProviderHealthThresholdOverrides(
  body: z.infer<typeof patchAdminSettingsSchema>,
  current: Awaited<ReturnType<FastifyInstance["persistence"]["getAppConfig"]>>,
): void {
  const hasWarningPatch = Object.prototype.hasOwnProperty.call(body, "providerHealthWarningUnresolvedThreshold");
  const hasCriticalPatch = Object.prototype.hasOwnProperty.call(body, "providerHealthCriticalUnresolvedThreshold");
  const nextWarning = hasWarningPatch
    ? body.providerHealthWarningUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold
    : current.providerHealthWarningUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold;
  const nextCritical = hasCriticalPatch
    ? body.providerHealthCriticalUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold
    : current.providerHealthCriticalUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold;
  if (nextWarning >= nextCritical) {
    throw routeError(
      400,
      "provider_health_threshold_order_invalid",
      "providerHealthWarningUnresolvedThreshold must be below providerHealthCriticalUnresolvedThreshold.",
    );
  }
}

function assertRouteCachePolicyPatch(
  body: z.infer<typeof patchAdminSettingsSchema>,
  current: Awaited<ReturnType<FastifyInstance["persistence"]["getAppConfig"]>>,
): void {
  const mode = body.routeCachePolicyMode !== undefined
    ? body.routeCachePolicyMode ?? "balanced"
    : current.routeCachePolicyMode ?? "balanced";
  const effective = resolveRouteCachePolicyFromRow({
    routeCachePolicyMode: mode,
    routeCacheDashboardPrimaryTtlMs: valueOrCurrent(body.routeCacheDashboardPrimaryTtlMs, current.routeCacheDashboardPrimaryTtlMs),
    routeCacheDashboardEnrichmentTtlMs: valueOrCurrent(body.routeCacheDashboardEnrichmentTtlMs, current.routeCacheDashboardEnrichmentTtlMs),
    routeCacheDashboardPerformanceTtlMs: valueOrCurrent(body.routeCacheDashboardPerformanceTtlMs, current.routeCacheDashboardPerformanceTtlMs),
    routeCachePortfolioTtlMs: valueOrCurrent(body.routeCachePortfolioTtlMs, current.routeCachePortfolioTtlMs),
    routeCacheReportsTtlMs: valueOrCurrent(body.routeCacheReportsTtlMs, current.routeCacheReportsTtlMs),
    routeCacheStaleUsableTtlMs: valueOrCurrent(body.routeCacheStaleUsableTtlMs, current.routeCacheStaleUsableTtlMs),
  });
  const largestTtl = Math.max(
    effective.dashboardPrimaryTtlMs,
    effective.dashboardEnrichmentTtlMs,
    effective.dashboardPerformanceTtlMs,
    effective.portfolioTtlMs,
    effective.reportsTtlMs,
  );
  if (effective.staleUsableTtlMs < largestTtl) {
    throw routeError(
      400,
      "route_cache_stale_window_invalid",
      "routeCacheStaleUsableTtlMs must be greater than or equal to the largest configured TTL.",
    );
  }
}

function valueOrCurrent<T>(value: T | null | undefined, current: T | null): T | null {
  return value === undefined ? current : value;
}

/**
 * KZO-198 Fix 3 — derive `AppConfigDto` directly from the freshly-fetched
 * row + env, NOT from `getEffective*()` resolvers (which read from the TTL
 * cache and may return env-fallback values immediately after `invalidate()`
 * before the background refresh completes).
 *
 * This bypasses the cache for the response path so a PATCH always returns
 * the post-write effective values. Cache invalidation stays fire-and-forget
 * for subsequent reads — the response itself does not depend on it.
 */
export function buildAppConfigDtoFromRow(
  row: Awaited<ReturnType<FastifyInstance["persistence"]["getAppConfig"]>>,
): AppConfigDto {
  const bounds = appConfigBoundsForEnv();
  return {
    repairCooldownMinutes: row.repairCooldownMinutes,
    effectiveRepairCooldownMinutes: row.repairCooldownMinutes ?? Env.REPAIR_COOLDOWN_MINUTES,
    dashboardPerformanceRanges: row.dashboardPerformanceRanges,
    effectiveDashboardPerformanceRanges: resolveEffectiveDashboardPerformanceRanges(
      row.dashboardPerformanceRanges,
    ),
    metadataEnrichmentMode: row.metadataEnrichmentMode,
    effectiveMetadataEnrichmentMode: row.metadataEnrichmentMode ?? Env.METADATA_ENRICHMENT_MODE,
    tickerPriceFreshness: resolveTickerPriceFreshnessConfig(
      row as Awaited<ReturnType<FastifyInstance["persistence"]["getAppConfig"]>>
        & import("../services/appConfig/tickerPriceFreshness.js").TickerPriceFreshnessRowFields,
      bounds,
    ),
    eodhdFallback: {
      dailyCallLimit: row.eodhdDailyCallLimit,
      effectiveDailyCallLimit: row.eodhdDailyCallLimit ?? Env.EODHD_DAILY_CALL_LIMIT,
      apiKeySet: row.eodhdApiKeyEncrypted !== null,
      validatedMarkets: ["AU"],
      bounds: {
        dailyCallLimit: {
          min: bounds.eodhdDailyCallLimit.min,
          max: bounds.eodhdDailyCallLimit.max,
        },
      },
    },

    // KZO-198 Tier 1 — rate limits
    marketDataPriceWindowMs: row.marketDataPriceWindowMs,
    effectiveMarketDataPriceWindowMs: row.marketDataPriceWindowMs ?? Env.MARKET_DATA_PRICE_WINDOW_MS,
    marketDataPriceLimit: row.marketDataPriceLimit,
    effectiveMarketDataPriceLimit: row.marketDataPriceLimit ?? Env.MARKET_DATA_PRICE_LIMIT,
    marketDataSearchWindowMs: row.marketDataSearchWindowMs,
    effectiveMarketDataSearchWindowMs: row.marketDataSearchWindowMs ?? Env.MARKET_DATA_SEARCH_WINDOW_MS,
    marketDataSearchLimit: row.marketDataSearchLimit,
    effectiveMarketDataSearchLimit: row.marketDataSearchLimit ?? Env.MARKET_DATA_SEARCH_RATE_LIMIT_PER_MINUTE,
    inviteStatusWindowMs: row.inviteStatusWindowMs,
    effectiveInviteStatusWindowMs: row.inviteStatusWindowMs ?? Env.INVITE_STATUS_WINDOW_MS,
    inviteStatusLimit: row.inviteStatusLimit,
    effectiveInviteStatusLimit: row.inviteStatusLimit ?? Env.INVITE_STATUS_LIMIT,

    // KZO-198 Tier 1 — provider health
    providerDownNotificationSuppressionMs: row.providerDownNotificationSuppressionMs,
    effectiveProviderDownNotificationSuppressionMs:
      row.providerDownNotificationSuppressionMs ?? Env.PROVIDER_DOWN_NOTIFICATION_SUPPRESSION_MS,
    providerErrorTrailRetentionDays: row.providerErrorTrailRetentionDays,
    effectiveProviderErrorTrailRetentionDays:
      row.providerErrorTrailRetentionDays ?? Env.PROVIDER_ERROR_TRAIL_RETENTION_DAYS,
    providerRerunCooldownMs: row.providerRerunCooldownMs,
    effectiveProviderRerunCooldownMs: row.providerRerunCooldownMs ?? Env.PROVIDER_RERUN_COOLDOWN_MS,
    // KZO-197 (surfaced in KZO-199 Phase 4): yahoo-finance-au-specific override.
    yahooAuRerunCooldownMs: row.yahooAuRerunCooldownMs,
    effectiveYahooAuRerunCooldownMs: row.yahooAuRerunCooldownMs ?? Env.YAHOO_AU_RERUN_COOLDOWN_MS,
    providerFixerDangerousMatchThreshold: row.providerFixerDangerousMatchThreshold,
    effectiveProviderFixerDangerousMatchThreshold:
      row.providerFixerDangerousMatchThreshold ?? PROVIDER_FIXER_DEFAULTS.dangerousMatchThreshold,
    providerFixerPreviewSampleLimit: row.providerFixerPreviewSampleLimit,
    effectiveProviderFixerPreviewSampleLimit:
      row.providerFixerPreviewSampleLimit ?? PROVIDER_FIXER_DEFAULTS.previewSampleLimit,
    providerFixerUiPageSize: row.providerFixerUiPageSize,
    effectiveProviderFixerUiPageSize: row.providerFixerUiPageSize ?? PROVIDER_FIXER_DEFAULTS.uiPageSize,
    providerFixerAutoPauseFailuresPerMinute: row.providerFixerAutoPauseFailuresPerMinute,
    effectiveProviderFixerAutoPauseFailuresPerMinute:
      row.providerFixerAutoPauseFailuresPerMinute ?? PROVIDER_FIXER_DEFAULTS.autoPauseFailuresPerMinute,
    providerFixerPreviewTokenTtlMinutes: row.providerFixerPreviewTokenTtlMinutes,
    effectiveProviderFixerPreviewTokenTtlMinutes:
      row.providerFixerPreviewTokenTtlMinutes ?? PROVIDER_FIXER_DEFAULTS.previewTokenTtlMinutes,
    providerOperationAutoRenewIntervalMinutes: row.providerOperationAutoRenewIntervalMinutes,
    effectiveProviderOperationAutoRenewIntervalMinutes:
      row.providerOperationAutoRenewIntervalMinutes ?? PROVIDER_FIXER_DEFAULTS.autoRenewIntervalMinutes,
    providerIncidentRecurrenceWindowMinutes: row.providerIncidentRecurrenceWindowMinutes,
    effectiveProviderIncidentRecurrenceWindowMinutes:
      row.providerIncidentRecurrenceWindowMinutes ?? PROVIDER_FIXER_DEFAULTS.incidentRecurrenceWindowMinutes,
    providerHealthWarningUnresolvedThreshold: row.providerHealthWarningUnresolvedThreshold,
    effectiveProviderHealthWarningUnresolvedThreshold:
      row.providerHealthWarningUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthWarningUnresolvedThreshold,
    providerHealthCriticalUnresolvedThreshold: row.providerHealthCriticalUnresolvedThreshold,
    effectiveProviderHealthCriticalUnresolvedThreshold:
      row.providerHealthCriticalUnresolvedThreshold ?? PROVIDER_FIXER_DEFAULTS.healthCriticalUnresolvedThreshold,
    providerOperationStaleHeartbeatMinutes: row.providerOperationStaleHeartbeatMinutes,
    effectiveProviderOperationStaleHeartbeatMinutes:
      row.providerOperationStaleHeartbeatMinutes ?? PROVIDER_FIXER_DEFAULTS.staleHeartbeatMinutes,
    providerOperationSummaryRetentionDays: row.providerOperationSummaryRetentionDays,
    effectiveProviderOperationSummaryRetentionDays:
      row.providerOperationSummaryRetentionDays ?? PROVIDER_FIXER_DEFAULTS.operationSummaryRetentionDays,
    providerOperationLogRetentionDays: row.providerOperationLogRetentionDays,
    effectiveProviderOperationLogRetentionDays:
      row.providerOperationLogRetentionDays ?? PROVIDER_FIXER_DEFAULTS.operationLogRetentionDays,
    providerIncidentRetentionDays: row.providerIncidentRetentionDays,
    effectiveProviderIncidentRetentionDays:
      row.providerIncidentRetentionDays ?? PROVIDER_FIXER_DEFAULTS.incidentRetentionDays,
    providerResolvedItemRetentionDays: row.providerResolvedItemRetentionDays,
    effectiveProviderResolvedItemRetentionDays:
      row.providerResolvedItemRetentionDays ?? PROVIDER_FIXER_DEFAULTS.resolvedItemRetentionDays,
    finmindProviderRateLimitPerHour: row.finmindProviderRateLimitPerHour,
    effectiveFinmindProviderRateLimitPerHour:
      row.finmindProviderRateLimitPerHour ?? Env.FINMIND_RATE_LIMIT_PER_HOUR,
    twelveDataProviderRateLimitPerMinute: row.twelveDataProviderRateLimitPerMinute,
    effectiveTwelveDataProviderRateLimitPerMinute:
      row.twelveDataProviderRateLimitPerMinute ?? Env.TWELVE_DATA_RATE_LIMIT_PER_MINUTE,
    yahooAuProviderRateLimitPerMinute: row.yahooAuProviderRateLimitPerMinute,
    effectiveYahooAuProviderRateLimitPerMinute:
      row.yahooAuProviderRateLimitPerMinute ?? Env.YAHOO_AU_RATE_LIMIT_PER_MINUTE,
    yahooKrProviderRateLimitPerMinute: row.yahooKrProviderRateLimitPerMinute,
    effectiveYahooKrProviderRateLimitPerMinute:
      row.yahooKrProviderRateLimitPerMinute ?? Env.YAHOO_KR_RATE_LIMIT_PER_MINUTE,
    yahooJpProviderRateLimitPerMinute: row.yahooJpProviderRateLimitPerMinute,
    effectiveYahooJpProviderRateLimitPerMinute:
      row.yahooJpProviderRateLimitPerMinute ?? Env.YAHOO_JP_RATE_LIMIT_PER_MINUTE,
    frankfurterProviderRateLimitPerMinute: row.frankfurterProviderRateLimitPerMinute,
    effectiveFrankfurterProviderRateLimitPerMinute:
      row.frankfurterProviderRateLimitPerMinute ?? Env.FRANKFURTER_RATE_LIMIT_PER_MINUTE,
    asxGicsProviderRateLimitPerHour: row.asxGicsProviderRateLimitPerHour,
    effectiveAsxGicsProviderRateLimitPerHour:
      row.asxGicsProviderRateLimitPerHour ?? Env.ASX_GICS_RATE_LIMIT_PER_HOUR,
    finmindProviderMinRequestIntervalMs: row.finmindProviderMinRequestIntervalMs,
    effectiveFinmindProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("finmindProviderMinRequestIntervalMs", row.finmindProviderMinRequestIntervalMs),
    twelveDataProviderMinRequestIntervalMs: row.twelveDataProviderMinRequestIntervalMs,
    effectiveTwelveDataProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("twelveDataProviderMinRequestIntervalMs", row.twelveDataProviderMinRequestIntervalMs),
    yahooAuProviderMinRequestIntervalMs: row.yahooAuProviderMinRequestIntervalMs,
    effectiveYahooAuProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("yahooAuProviderMinRequestIntervalMs", row.yahooAuProviderMinRequestIntervalMs),
    yahooKrProviderMinRequestIntervalMs: row.yahooKrProviderMinRequestIntervalMs,
    effectiveYahooKrProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("yahooKrProviderMinRequestIntervalMs", row.yahooKrProviderMinRequestIntervalMs),
    yahooJpProviderMinRequestIntervalMs: row.yahooJpProviderMinRequestIntervalMs,
    effectiveYahooJpProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("yahooJpProviderMinRequestIntervalMs", row.yahooJpProviderMinRequestIntervalMs),
    frankfurterProviderMinRequestIntervalMs: row.frankfurterProviderMinRequestIntervalMs,
    effectiveFrankfurterProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("frankfurterProviderMinRequestIntervalMs", row.frankfurterProviderMinRequestIntervalMs),
    asxGicsProviderMinRequestIntervalMs: row.asxGicsProviderMinRequestIntervalMs,
    effectiveAsxGicsProviderMinRequestIntervalMs:
      effectiveProviderMinRequestIntervalMs("asxGicsProviderMinRequestIntervalMs", row.asxGicsProviderMinRequestIntervalMs),
    jpCatalogAllowedStockTypes: row.jpCatalogAllowedStockTypes,
    effectiveJpCatalogAllowedStockTypes:
      resolveEffectiveJpCatalogAllowedStockTypes(row.jpCatalogAllowedStockTypes),
    jpCatalogIncludeDepositaryReceipts: row.jpCatalogIncludeDepositaryReceipts,
    effectiveJpCatalogIncludeDepositaryReceipts:
      row.jpCatalogIncludeDepositaryReceipts ?? false,
    jpCatalogIncludeAtSymbols: row.jpCatalogIncludeAtSymbols,
    effectiveJpCatalogIncludeAtSymbols:
      row.jpCatalogIncludeAtSymbols ?? false,

    // KZO-198 Tier 1 — backfill
    backfillRetryLimit: row.backfillRetryLimit,
    effectiveBackfillRetryLimit: row.backfillRetryLimit ?? Env.BACKFILL_RETRY_LIMIT,
    backfillRetryDelaySeconds: row.backfillRetryDelaySeconds,
    effectiveBackfillRetryDelaySeconds: row.backfillRetryDelaySeconds ?? Env.BACKFILL_RETRY_DELAY_SECONDS,
    backfillFinmind402RetryMs: row.backfillFinmind402RetryMs,
    effectiveBackfillFinmind402RetryMs: row.backfillFinmind402RetryMs ?? Env.BACKFILL_FINMIND_402_RETRY_MS,

    // KZO-195 Tier 2 — absence-based delisting detection (UI-editable)
    catalogAbsenceThreshold: row.catalogAbsenceThreshold,
    effectiveCatalogAbsenceThreshold:
      row.catalogAbsenceThreshold ?? Env.CATALOG_ABSENCE_THRESHOLD,
    catalogAbsenceGuardPercent: row.catalogAbsenceGuardPercent,
    effectiveCatalogAbsenceGuardPercent:
      row.catalogAbsenceGuardPercent ?? Env.CATALOG_ABSENCE_GUARD_PERCENT,
    catalogAbsenceGuardFloor: row.catalogAbsenceGuardFloor,
    effectiveCatalogAbsenceGuardFloor:
      row.catalogAbsenceGuardFloor ?? Env.CATALOG_ABSENCE_GUARD_FLOOR,

    // KZO-199 Tier 1 — sharing knobs (UI-editable)
    anonymousShareTokenCap: row.anonymousShareTokenCap,
    effectiveAnonymousShareTokenCap:
      row.anonymousShareTokenCap ?? Env.ANONYMOUS_SHARE_TOKEN_CAP,
    anonymousShareRateLimitMax: row.anonymousShareRateLimitMax,
    effectiveAnonymousShareRateLimitMax:
      row.anonymousShareRateLimitMax ?? Env.ANONYMOUS_SHARE_RATE_LIMIT_MAX,
    anonymousShareRateLimitWindowMs: row.anonymousShareRateLimitWindowMs,
    effectiveAnonymousShareRateLimitWindowMs:
      row.anonymousShareRateLimitWindowMs ?? Env.ANONYMOUS_SHARE_RATE_LIMIT_WINDOW_MS,

    // ui-enhancement — Tier B account-soft-delete grace period (UI-editable)
    accountHardPurgeDays: row.accountHardPurgeDays,
    effectiveAccountHardPurgeDays: row.accountHardPurgeDays ?? Env.ACCOUNT_HARD_PURGE_DAYS,
    valuationHealthRelativeBps: row.valuationHealthRelativeBps,
    effectiveValuationHealthRelativeBps:
      row.valuationHealthRelativeBps ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.relativeBps,
    valuationHealthAbsoluteAud: row.valuationHealthAbsoluteAud,
    effectiveValuationHealthAbsoluteAud:
      row.valuationHealthAbsoluteAud ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteAud,
    valuationHealthAbsoluteUsd: row.valuationHealthAbsoluteUsd,
    effectiveValuationHealthAbsoluteUsd:
      row.valuationHealthAbsoluteUsd ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteUsd,
    valuationHealthAbsoluteTwd: row.valuationHealthAbsoluteTwd,
    effectiveValuationHealthAbsoluteTwd:
      row.valuationHealthAbsoluteTwd ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteTwd,
    valuationHealthAbsoluteKrw: row.valuationHealthAbsoluteKrw,
    effectiveValuationHealthAbsoluteKrw:
      row.valuationHealthAbsoluteKrw ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteKrw,
    valuationHealthAbsoluteJpy: row.valuationHealthAbsoluteJpy,
    effectiveValuationHealthAbsoluteJpy:
      row.valuationHealthAbsoluteJpy
      ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteJpy
      ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteTwd,
    effectiveValuationHealthThresholds: {
      relativeBps: row.valuationHealthRelativeBps ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.relativeBps,
      absoluteAud: row.valuationHealthAbsoluteAud ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteAud,
      absoluteUsd: row.valuationHealthAbsoluteUsd ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteUsd,
      absoluteTwd: row.valuationHealthAbsoluteTwd ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteTwd,
      absoluteKrw: row.valuationHealthAbsoluteKrw ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteKrw,
      absoluteJpy:
        row.valuationHealthAbsoluteJpy
        ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteJpy
        ?? DEFAULT_VALUATION_HEALTH_THRESHOLDS.absoluteTwd,
    },
    routeCachePolicyMode: row.routeCachePolicyMode,
    effectiveRouteCachePolicy: resolveRouteCachePolicyFromRow(row),
    routeCacheDashboardPrimaryTtlMs: row.routeCacheDashboardPrimaryTtlMs,
    routeCacheDashboardEnrichmentTtlMs: row.routeCacheDashboardEnrichmentTtlMs,
    routeCacheDashboardPerformanceTtlMs: row.routeCacheDashboardPerformanceTtlMs,
    routeCachePortfolioTtlMs: row.routeCachePortfolioTtlMs,
    routeCacheReportsTtlMs: row.routeCacheReportsTtlMs,
    routeCacheStaleUsableTtlMs: row.routeCacheStaleUsableTtlMs,
    eodhdDailyCallLimit: row.eodhdDailyCallLimit,
    effectiveEodhdDailyCallLimit: row.eodhdDailyCallLimit ?? Env.EODHD_DAILY_CALL_LIMIT,

    // KZO-198 Tier 2 fields are intentionally absent (DB+SQL only — see DTO type)

    // KZO-198 Tier 0 — encrypted secret presence sentinels (NEVER ciphertext or plaintext)
    finmindApiTokenSet: row.finmindApiTokenEncrypted !== null,
    twelveDataApiKeySet: row.twelveDataApiKeyEncrypted !== null,
    eodhdApiKeySet: row.eodhdApiKeyEncrypted !== null,

    // KZO-198 — bounds (single source of truth for UI form constraints)
    bounds,
    secretLengthBounds: APP_CONFIG_SECRET_LENGTH,

    updatedAt: row.updatedAt,
  };
}

async function loadAppConfigDto(app: FastifyInstance): Promise<AppConfigDto> {
  // Fetch the post-write row directly. The DTO is derived from this row
  // (Fix 3) so the response always reflects the latest persisted state,
  // independent of cache TTL or in-flight refresh state.
  const row = await app.persistence.getAppConfig();
  return buildAppConfigDtoFromRow(row);
}

const providerFixerResolverModeSchema = z.enum(["quote_first", "chart_probe_v1"]);
const providerFixerPhaseSchema = z.enum([
  "diagnose",
  "preparing_preview",
  "preview",
  "staged",
  "queued",
  "running",
  "paused",
  "completed",
  "failed",
  "cancelled",
]);
const providerFixerProviderSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9-]+$/);
const providerFixerErrorCodeSchema = z.string().trim().min(1).max(160);
const providerFixerMarketCodeSchema = z.enum(MARKET_CODES);
type ProviderFixerMarketCode = z.infer<typeof providerFixerMarketCodeSchema>;
const providerFixerSelectedItemSchema = z
  .object({
    providerId: providerFixerProviderSchema,
    marketCode: providerFixerMarketCodeSchema,
    errorCode: providerFixerErrorCodeSchema,
    sourceSymbol: z.string().trim().min(1).max(80),
  })
  .strict();
const providerFixerScopeSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("selected_items"),
      items: z.array(providerFixerSelectedItemSchema).min(1).max(200),
    })
    .strict(),
  z
    .object({
      type: z.literal("filter"),
      marketCode: providerFixerMarketCodeSchema.optional(),
      errorCode: providerFixerErrorCodeSchema,
      state: z.literal("active").default("active"),
      search: z.string().trim().max(120).optional(),
    })
    .strict(),
]);
const providerFixerPreviewBodySchema = z
  .object({
    providerId: providerFixerProviderSchema,
    marketCode: providerFixerMarketCodeSchema.optional(),
    resolverMode: providerFixerResolverModeSchema.default("quote_first"),
    errorCode: providerFixerErrorCodeSchema.default("symbol_unresolved"),
    scope: providerFixerScopeSchema.optional(),
  })
  .strict();
const providerFixerOperationBodySchema = z
  .object({
    operationId: z.string().trim().min(1).max(120),
    previewToken: z.string().trim().min(1).max(160).optional(),
    acknowledged: z.boolean().optional(),
    typedConfirmation: z.string().trim().max(160).optional(),
  })
  .strict();

const PROVIDER_FIXER_DEFAULT_PROVIDER_IDS = [
  "yahoo-finance-kr",
  "finmind-tw",
  "finmind-us",
] as const;

interface MarketDataWorkspaceDefinition {
  marketCode: AdminMarketCode;
  label: string;
  tabs: AdminMarketWorkspaceTab[];
  providers: AdminMarketDataProviderChipDto[];
  defaultBackfillProviderId?: string;
}

const MARKET_DATA_WORKSPACES: Record<AdminMarketCode, MarketDataWorkspaceDefinition> = {
  TW: {
    marketCode: "TW",
    label: "Taiwan",
    tabs: ["overview", "calendar", "instruments", "unresolved", "backfill", "purge", "operations", "activity"],
    providers: [{ providerId: "finmind-tw", label: "FinMind TW", role: "Catalog and historical data" }],
    defaultBackfillProviderId: "finmind-tw",
  },
  US: {
    marketCode: "US",
    label: "United States",
    tabs: ["overview", "calendar", "instruments", "unresolved", "backfill", "purge", "operations", "activity"],
    providers: [{ providerId: "finmind-us", label: "FinMind US", role: "Catalog and historical data" }],
    defaultBackfillProviderId: "finmind-us",
  },
  AU: {
    marketCode: "AU",
    label: "Australia",
    tabs: ["overview", "calendar", "instruments", "unresolved", "backfill", "purge", "operations", "activity"],
    providers: [
      { providerId: "twelve-data-au", label: "Twelve Data AU", role: "Catalog" },
      { providerId: "yahoo-finance-au", label: "Yahoo Finance AU", role: "Bars, dividends, metadata" },
      { providerId: "asx-gics-csv", label: "ASX GICS CSV", role: "GICS enrichment" },
    ],
    defaultBackfillProviderId: "yahoo-finance-au",
  },
  KR: {
    marketCode: "KR",
    label: "Korea",
    tabs: ["overview", "calendar", "instruments", "unresolved", "backfill", "purge", "operations", "activity"],
    providers: [
      { providerId: "twelve-data-kr", label: "Twelve Data KR", role: "Catalog evidence" },
      { providerId: "yahoo-finance-kr", label: "Yahoo Finance KR", role: "Mappings, bars, dividends" },
    ],
    defaultBackfillProviderId: "yahoo-finance-kr",
  },
  JP: {
    marketCode: "JP",
    label: "Japan",
    tabs: ["overview", "calendar", "instruments", "unresolved", "backfill", "purge", "operations", "activity"],
    providers: [
      { providerId: "twelve-data-jp", label: "Twelve Data JP", role: "Catalog" },
      { providerId: "yahoo-finance-jp", label: "Yahoo Finance JP", role: "Bars, dividends, metadata" },
    ],
    defaultBackfillProviderId: "yahoo-finance-jp",
  },
  FX: {
    marketCode: "FX",
    label: "Foreign exchange",
    tabs: ["overview", "refresh-rates", "operations"],
    providers: [{ providerId: "frankfurter", label: "Frankfurter", role: "FX rates" }],
  },
};

const MARKET_DATA_PURGE_CATEGORIES = [
  "price_bars",
  "dividends",
  "backfill_jobs",
  "provider_operation_outcomes",
  "provider_error_trail",
  "provider_resolution_mappings",
  "asx_gics_enrichment",
  "admin_state_reset",
] as const;

function marketDataPurgeDisabledReason(
  marketCode: string,
  category: (typeof MARKET_DATA_PURGE_CATEGORIES)[number],
): { code: AdminMarketDataPurgeDisabledReasonCode; reason: string } | null {
  if (category === "provider_resolution_mappings" && marketCode !== "KR") {
    return {
      code: "kr_mappings_only",
      reason: "Only KR Yahoo mappings support durable provider mappings in this scope.",
    };
  }
  if (category === "asx_gics_enrichment" && marketCode !== "AU") {
    return {
      code: "au_gics_only",
      reason: "ASX GICS enrichment is AU-only.",
    };
  }
  if (category === "backfill_jobs") {
    return {
      code: "backfill_jobs_not_target_safe",
      reason: "Refresh batch records are aggregate job history; target-safe deletion needs batch-item provenance and is intentionally skipped.",
    };
  }
  return null;
}

function marketDataPurgeCategoryCapabilities(
  marketCode: AdminMarketCode,
): AdminMarketDataOverviewResponse["purgeCategories"] {
  if (marketCode === "FX") return [];
  return MARKET_DATA_PURGE_CATEGORIES.map((category) => {
    const disabled = marketDataPurgeDisabledReason(marketCode, category);
    return {
      category,
      supported: disabled === null,
      disabledReasonCode: disabled?.code ?? null,
      disabledReason: disabled?.reason ?? null,
    };
  });
}

const marketDataWorkspaceParamSchema = z.object({
  marketCode: z.enum(["TW", "US", "AU", "KR", "JP", "FX"]),
});

const quoteFallbackPolicyBodySchema = z
  .object({
    ticker: z.string().trim().min(1).max(40),
    marketCode: providerFixerMarketCodeSchema,
    provider: z.literal("eodhd"),
    priceType: z.literal("eod_close"),
    providerSymbol: z.string().trim().min(1).max(80),
    active: z.boolean().optional(),
    reason: z.union([z.string().trim().max(500), z.null()]).optional(),
  })
  .strict();

const quoteFallbackPolicyTargetSchema = z
  .object({
    ticker: z.string().trim().min(1).max(40),
    marketCode: providerFixerMarketCodeSchema,
  })
  .strict();

function assertQuoteFallbackMarketSupported(marketCode: MarketCode): void {
  if (marketCode !== "AU") {
    throw routeError(400, "quote_fallback_market_not_validated", "EODHD quote fallback is validated for AU only.");
  }
}

function requireOfficialCalendarMarketCode(marketCode: AdminMarketCode): asserts marketCode is Exclude<AdminMarketCode, "FX"> {
  if (!isOfficialCalendarMarketCode(marketCode)) {
    throw routeError(404, "market_calendar_not_supported", "Calendar management is only supported for TW, US, AU, KR, and JP");
  }
}

const calendarImportRowSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["open", "closed"]),
  name: z.string().trim().min(1),
  evidence: z.string().trim().min(1),
  overrideReason: z.string().trim().min(1),
  notes: z.string().trim().nullable().optional(),
});

const calendarImportPayloadSchema = z.object({
  calendarYear: z.number().int().min(2000).max(2100),
  sourceId: z.string().trim().min(1).nullable().optional(),
  sourceType: z.enum(["official_source", "manual_ai_assisted"]).optional(),
  label: z.string().trim().min(1).nullable().optional(),
  sourceUrl: z.string().trim().url().nullable().optional(),
  retrievedAt: z.string().datetime({ offset: true }).optional(),
  coverage: z.object({
    scope: z.literal("full_year"),
    evidence: z.string().trim().min(1),
    notes: z.string().trim().nullable().optional(),
  }).strict(),
  exceptions: z.array(calendarImportRowSchema).default([]),
  replaceConfirmed: z.boolean().optional(),
  replacementReason: z.string().trim().nullable().optional(),
});

function parseCalendarImportRequest(body: unknown): AdminMarketCalendarPreviewRequest {
  const envelope = z.object({
    sourceId: z.string().trim().min(1).nullable().optional(),
    normalizedPayload: z.string().trim().optional(),
    replaceConfirmed: z.boolean().optional(),
    replacementReason: z.string().trim().nullable().optional(),
  }).passthrough().parse(body ?? {});
  const rawPayload = envelope.normalizedPayload;
  let parsedPayload: unknown = body ?? {};
  if (rawPayload) {
    try {
      parsedPayload = JSON.parse(rawPayload);
    } catch {
      throw routeError(400, "market_calendar_payload_invalid_json", "Calendar normalized payload must be valid JSON");
    }
  }
  const payload = calendarImportPayloadSchema.parse(parsedPayload);
  return {
    ...payload,
    sourceId: envelope.sourceId ?? payload.sourceId ?? null,
    retrievedAt: payload.retrievedAt ?? new Date().toISOString(),
    replaceConfirmed: envelope.replaceConfirmed ?? payload.replaceConfirmed,
    replacementReason: envelope.replacementReason ?? payload.replacementReason,
  };
}
const marketDataInstrumentStatusSchema = z.enum(["listed", "delisted", "excluded", "all"]);
const marketDataSupportStateSchema = z.enum(["supported", "retired_by_admin", "unsupported_by_provider"]);
const marketDataBackfillStatusSchema = z.enum(["pending", "backfilling", "ready", "failed", "all"]);
const marketDataInstrumentSortSchema = z.enum(["ticker_asc", "ticker_desc", "updated_desc", "updated_asc"]);
const marketDataBackfillScopeSchema = z.enum([
  "user_owned_or_monitored",
  "selected_catalog_rows",
  "all_matching",
  "selected_unresolved_rows",
]);
const marketDataSnapshotRepairExecuteBodySchema = z.object({
  tickers: z.array(z.string().trim().min(1).max(40)).min(1).max(20),
  fromDate: isoDateSchema.optional(),
});
const marketDataTargetSchema = z.object({
  ticker: z.string().trim().min(1).max(40),
  marketCode: providerFixerMarketCodeSchema,
}).strict();
const marketDataActionExecuteBodySchema = z
  .object({
    action: z.enum([
      "sync_catalog",
      "backfill_catalog_rows",
      "refresh_fx_rates",
      "sync_asx_gics",
      "repair_mapping",
    ]),
    providerId: providerFixerProviderSchema.optional(),
    acknowledged: z.boolean().optional(),
    resolverMode: providerFixerResolverModeSchema.optional(),
    resolverModeRiskAccepted: z.boolean().optional(),
  })
  .strict();

function providerIdsForMarket(marketCode: AdminMarketCode): string[] {
  return MARKET_DATA_WORKSPACES[marketCode].providers.map((provider) => provider.providerId);
}

function resolveActivityOccurredAfter(timeRange: "24h" | "48h" | "7d" | "30d" | "all", now: Date): string | undefined {
  const hoursByRange = {
    "24h": 24,
    "48h": 48,
    "7d": 24 * 7,
    "30d": 24 * 30,
    all: null,
  } as const;
  const hours = hoursByRange[timeRange];
  if (hours === null) return undefined;
  return new Date(now.getTime() - (hours * 60 * 60 * 1000)).toISOString();
}

function marketDataProviderForAction(marketCode: AdminMarketCode, action: ProviderOperationAction): string | null {
  if (action === "refresh_fx_rates") return marketCode === "FX" ? "frankfurter" : null;
  if (action === "sync_asx_gics") return marketCode === "AU" ? "asx-gics-csv" : null;
  if (action === "sync_catalog") {
    if (marketCode === "TW") return "finmind-tw";
    if (marketCode === "US") return "finmind-us";
    if (marketCode === "AU") return "twelve-data-au";
    if (marketCode === "KR") return "twelve-data-kr";
    if (marketCode === "JP") return "twelve-data-jp";
  }
  if (action === "repair_mapping") return marketCode === "KR" ? "yahoo-finance-kr" : null;
  if (action === "backfill_catalog_rows") {
    return MARKET_DATA_WORKSPACES[marketCode].defaultBackfillProviderId ?? null;
  }
  return null;
}

function marketDataActionLabel(action: ProviderOperationAction): string {
  switch (action) {
    case "sync_catalog":
      return "Sync catalog";
    case "backfill_catalog_rows":
      return "Backfill catalog rows";
    case "refresh_fx_rates":
      return "Refresh FX rates";
    case "sync_asx_gics":
      return "Sync ASX GICS";
    case "repair_mapping":
      return "Repair KR mappings";
    default:
      return action.replaceAll("_", " ");
  }
}

function marketDataActionDescription(action: ProviderOperationAction): string {
  switch (action) {
    case "sync_catalog":
      return "Fetch the provider-owned instrument catalog for this market.";
    case "backfill_catalog_rows":
      return "Queue historical data backfill for an explicit previewed scope.";
    case "refresh_fx_rates":
      return "Queue a Frankfurter FX-rate refresh.";
    case "sync_asx_gics":
      return "Refresh ASX GICS enrichment for AU catalog rows.";
    case "repair_mapping":
      return "Persist verified Yahoo Finance KR mappings only; backfill remains a separate action.";
    default:
      return "Provider-owned operation.";
  }
}

function marketDataProviderBudgetNotes(marketCode: AdminMarketCode, action: ProviderOperationAction): string[] {
  if (marketCode === "US" && action === "backfill_catalog_rows") {
    return ["Broad US history is storage-heavy; selected/manual/all-matching scopes require preview."];
  }
  if (marketCode === "KR" && action === "repair_mapping") {
    return ["Mapping repair does not enqueue historical bars or dividends."];
  }
  if ((marketCode === "AU" || marketCode === "KR" || marketCode === "JP") && action === "backfill_catalog_rows") {
    return ["Pending/failed catalog-row repair is allowed only after preview."];
  }
  if (marketCode === "FX") return ["FX has no instruments, backfill, purge, or retirement controls in this scope."];
  return [];
}

function adminInstrumentRowStatus(row: import("../persistence/types.js").AdminInstrumentRow): AdminInstrumentStatus {
  if (row.delistedAt) return "delisted";
  return row.delistingDetectionExcluded ? "excluded" : "listed";
}

function adminInstrumentRowToDto(row: import("../persistence/types.js").AdminInstrumentRow): AdminInstrumentDto {
  return {
    ticker: row.ticker,
    marketCode: row.marketCode as import("@vakwen/shared-types").MarketCode,
    name: row.name,
    instrumentType: (row.instrumentType ?? "STOCK") as import("@vakwen/domain").InstrumentType,
    status: adminInstrumentRowStatus(row),
    supportState: row.supportState,
    statusReason: row.statusReason,
    absenceStreak: row.absenceStreak,
    lastSeenInCatalogAt: row.lastSeenInCatalogAt,
    delistedAt: row.delistedAt,
    delistingDetectionExcluded: row.delistingDetectionExcluded,
  };
}

function quoteFallbackSnapshotToDto(
  snapshot: import("../persistence/types.js").QuoteFallbackSnapshotRecord | null,
): QuoteFallbackSnapshotDto | null {
  if (!snapshot) return null;
  return {
    id: snapshot.id,
    policyId: snapshot.policyId,
    marketCode: snapshot.marketCode as import("@vakwen/shared-types").MarketCode,
    ticker: snapshot.ticker,
    provider: snapshot.provider,
    priceType: snapshot.priceType,
    providerSymbol: snapshot.providerSymbol,
    marketDate: snapshot.marketDate,
    close: snapshot.close,
    previousClose: snapshot.previousClose,
    currency: snapshot.currency,
    currencySource: snapshot.currencySource,
    source: snapshot.source,
    fetchedAt: snapshot.fetchedAt,
    providerMetadata: snapshot.providerMetadata,
    createdAt: snapshot.createdAt,
  };
}

function quoteFallbackPolicyToDto(
  policy: import("../persistence/types.js").QuoteFallbackPolicyWithSnapshotRecord | null,
): QuoteFallbackPolicyDto | null {
  if (!policy) return null;
  return {
    id: policy.id,
    marketCode: policy.marketCode as import("@vakwen/shared-types").MarketCode,
    ticker: policy.ticker,
    provider: policy.provider,
    priceType: policy.priceType,
    providerSymbol: policy.providerSymbol,
    active: policy.active,
    reason: policy.reason,
    createdAt: policy.createdAt,
    updatedAt: policy.updatedAt,
    deactivatedAt: policy.deactivatedAt,
    lastRefreshStatus: policy.lastRefreshStatus,
    lastRefreshAt: policy.lastRefreshAt,
    lastRefreshError: policy.lastRefreshError,
    lastRefreshErrorCode: policy.lastRefreshErrorCode,
    latestSnapshot: quoteFallbackSnapshotToDto(policy.latestSnapshot),
  };
}

function adminInstrumentRowToMarketDataDto(
  row: import("../persistence/types.js").AdminInstrumentRow,
  quoteFallbackPolicy: import("../persistence/types.js").QuoteFallbackPolicyWithSnapshotRecord | null = null,
): AdminMarketDataInstrumentDto {
  return {
    ...adminInstrumentRowToDto(row),
    providerIds: providerIdsForMarket(row.marketCode as AdminMarketCode),
    backfillStatus: row.barsBackfillStatus,
    quoteFallbackPolicy: quoteFallbackPolicyToDto(quoteFallbackPolicy),
  };
}

function providerFixerMarketCode(providerId: string, requested?: MarketCode): ProviderFixerMarketCode {
  const parsed = providerFixerMarketCodeSchema.safeParse(requested);
  if (parsed.success) return parsed.data;
  if (providerId.endsWith("-kr")) return "KR";
  if (providerId.endsWith("-tw")) return "TW";
  if (providerId.endsWith("-us")) return "US";
  if (providerId.endsWith("-au")) return "AU";
  return "KR";
}

function providerFixerMarketLabel(marketCode: MarketCode): string {
  if (marketCode === "KR") return "KRX";
  if (marketCode === "TW") return "TWSE";
  if (marketCode === "US") return "NYSE/NASDAQ";
  return "ASX";
}

function providerFixerGuardrailsFromConfig(config: AppConfigDto): ProviderFixerDashboardGuardrailSettingsDto {
  return {
    dangerousMatchThreshold: config.effectiveProviderFixerDangerousMatchThreshold,
    previewSampleLimit: config.effectiveProviderFixerPreviewSampleLimit,
    uiPageSize: config.effectiveProviderFixerUiPageSize,
    autoPauseFailureThresholdPerMinute: config.effectiveProviderFixerAutoPauseFailuresPerMinute,
    previewTokenTtlSeconds: config.effectiveProviderFixerPreviewTokenTtlMinutes * 60,
    healthWarningUnresolvedThreshold: config.effectiveProviderHealthWarningUnresolvedThreshold,
    healthCriticalUnresolvedThreshold: config.effectiveProviderHealthCriticalUnresolvedThreshold,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberField(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function providerFixerMarketCodeField(value: unknown, fallback: ProviderFixerMarketCode): ProviderFixerMarketCode {
  const parsed = providerFixerMarketCodeSchema.safeParse(value);
  return parsed.success ? parsed.data : fallback;
}

type ProviderFixerScopeInput = z.infer<typeof providerFixerScopeSchema>;
type ProviderFixerSelectedItemInput = z.infer<typeof providerFixerSelectedItemSchema>;
type DurableProviderScopeItem = Awaited<
  ReturnType<FastifyInstance["persistence"]["listProviderUnresolvedItems"]>
>["items"][number];
const providerOperationProgressEventState = new Map<string, number>();

function providerFixerScopeFingerprint(scope: ProviderFixerScopeInput): string {
  if (scope.type === "filter") {
    return JSON.stringify({
      type: scope.type,
      marketCode: scope.marketCode ?? null,
      errorCode: scope.errorCode,
      state: scope.state,
      search: scope.search?.trim() || null,
    });
  }
  const items = [...scope.items]
    .map((item) => `${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`)
    .sort();
  return JSON.stringify({ type: scope.type, items });
}

function providerFixerScopeLabel(scope: ProviderFixerScopeInput, providerId: string): string {
  if (scope.type === "filter") {
    const searchSuffix = scope.search?.trim() ? ` search=${scope.search.trim()}` : "";
    return `${providerId}:${scope.marketCode ?? providerFixerMarketCode(providerId)}:${scope.errorCode}:active${searchSuffix}`;
  }
  return `${providerId}:selected:${scope.items.length}`;
}

function providerFixerScopeSummary(scope: ProviderFixerScopeInput, matchCount: number): string {
  if (scope.type === "filter") {
    return `${matchCount} active unresolved rows matching the current filter`;
  }
  return `${matchCount} selected unresolved row${matchCount === 1 ? "" : "s"}`;
}

function providerBulkUnresolvedStateConfirmationText(
  targetState: "unsupported" | "ignored",
  scope: ProviderFixerScopeInput,
  matchCount: number,
): string {
  if (targetState === "unsupported") {
    return scope.type === "filter"
      ? `MARK ${matchCount} MATCHING UNSUPPORTED`
      : `MARK ${matchCount} UNSUPPORTED`;
  }
  return scope.type === "filter"
    ? `IGNORE ${matchCount} MATCHING ACTIVE`
    : `IGNORE ${matchCount} ACTIVE`;
}

function providerFixerFrozenScopeMetadata(
  providerId: string,
  scope: ProviderFixerScopeInput,
  scopeItems: DurableProviderScopeItem[],
): {
  type: "selected_items" | "filter";
  filterFingerprint: string;
  matchCount: number;
  selectedItems: ProviderFixerSelectedItemInput[];
  filter: { providerId: string; marketCode: ProviderFixerMarketCode; errorCode: string; state: "active"; search: string | null } | null;
} {
  const selectedItems = scopeItems.map((item) => ({
    providerId: item.providerId,
    marketCode: providerFixerMarketCodeField(item.marketCode, providerFixerMarketCode(providerId)),
    errorCode: item.errorCode,
    sourceSymbol: item.sourceSymbol,
  }));
  return {
    type: scope.type,
    filterFingerprint: providerFixerScopeFingerprint(scope),
    matchCount: scopeItems.length,
    selectedItems,
    filter: scope.type === "filter"
      ? {
          providerId,
          marketCode: providerFixerMarketCodeField(
            scopeItems[0]?.marketCode ?? scope.marketCode,
            providerFixerMarketCode(providerId),
          ),
          errorCode: scope.errorCode,
          state: "active",
          search: scope.search?.trim() || null,
        }
      : null,
  };
}

function providerFixerScopeFromMetadata(
  providerId: string,
  metadata: Record<string, unknown> | null,
  fallback: { marketCode: ProviderFixerMarketCode; errorCode: string | null },
): ProviderFixerScopeInput {
  const record = asRecord(metadata) ?? {};
  const stored = asRecord(record.scope);
  if (stored?.type === "selected_items" && Array.isArray(stored.items)) {
    return providerFixerScopeSchema.parse({
      type: "selected_items",
      items: stored.items,
    });
  }
  if (stored?.type === "filter") {
    return providerFixerScopeSchema.parse({
      type: "filter",
      marketCode: providerFixerMarketCodeField(stored.marketCode, fallback.marketCode),
      errorCode: stringField(stored.errorCode) ?? fallback.errorCode ?? "symbol_unresolved",
      state: "active",
      search: stringField(stored.search) ?? undefined,
    });
  }
  return {
    type: "filter",
    marketCode: fallback.marketCode,
    errorCode: fallback.errorCode ?? "symbol_unresolved",
    state: "active",
  };
}

function providerFixerFrozenSelectedItemsFromMetadata(
  metadata: Record<string, unknown> | null,
): ProviderFixerSelectedItemInput[] {
  const frozenScope = asRecord(asRecord(metadata)?.frozenScope);
  if (!frozenScope || !Array.isArray(frozenScope.selectedItems)) return [];
  return frozenScope.selectedItems.flatMap((item) => {
    const parsed = providerFixerSelectedItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

async function listProviderUnresolvedScopeItems(
  app: FastifyInstance,
  providerId: string,
  scope: ProviderFixerScopeInput,
): Promise<DurableProviderScopeItem[]> {
  if (scope.type === "selected_items") {
    const requested = new Map<string, ProviderFixerSelectedItemInput>();
    for (const item of scope.items) {
      if (item.providerId !== providerId) {
        throw routeError(400, "provider_scope_provider_mismatch", "Selected scope item does not match the target provider");
      }
      requested.set(`${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`, item);
    }
    const result: DurableProviderScopeItem[] = [];
    let page = 1;
    const limit = 200;
    while (requested.size > 0) {
      const rows = await app.persistence.listProviderUnresolvedItems({
        providerId,
        state: "active",
        page,
        limit,
      });
      for (const row of rows.items) {
        const key = `${row.marketCode}:${row.errorCode}:${row.sourceSymbol}`;
        if (requested.has(key)) {
          result.push(row);
          requested.delete(key);
        }
      }
      if (page * limit >= rows.total || rows.items.length === 0) break;
      page += 1;
    }
    if (requested.size > 0) {
      throw routeError(409, "provider_scope_items_not_active", "One or more selected unresolved rows are no longer active");
    }
    return result.sort((a, b) => a.sourceSymbol.localeCompare(b.sourceSymbol));
  }

  const items: DurableProviderScopeItem[] = [];
  let page = 1;
  const limit = 200;
  while (true) {
    const rows = await app.persistence.listProviderUnresolvedItems({
      providerId,
      marketCode: scope.marketCode,
      state: "active",
      errorCode: scope.errorCode,
      search: scope.search?.trim() || undefined,
      sort: "last_seen_desc",
      page,
      limit,
    });
    items.push(...rows.items);
    if (page * limit >= rows.total || rows.items.length === 0) break;
    page += 1;
  }
  return items;
}

async function reserveProviderOperationBudget(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  requestCount = 1,
): Promise<void> {
  const latest = await app.persistence.getProviderOperation(operation.id);
  if (latest?.phase === "cancelled" || latest?.phase === "paused") {
    throw new ProviderOperationStoppedError(latest as ProviderOperationRecord & { phase: StoppedProviderOperationPhase });
  }
  const metadata = asRecord(latest?.metadata) ?? asRecord(operation.metadata) ?? {};
  const capPerMinute = numberField(metadata.effectiveRateCapPerMinute) ?? 250;
  const safeCapPerMinute = Math.max(0.01, capPerMinute);
  const windowMs = safeCapPerMinute >= 1 ? 60_000 : Math.ceil(60_000 / safeCapPerMinute);
  const capPerWindow = Math.max(1, Math.floor(safeCapPerMinute >= 1 ? safeCapPerMinute : 1));
  const now = Date.now();
  const startedAtRaw = stringField(metadata.operationBudgetWindowStartedAt);
  const startedAtMs = startedAtRaw ? Date.parse(startedAtRaw) : NaN;
  const windowStartedAt = Number.isFinite(startedAtMs) && now - startedAtMs < windowMs ? startedAtMs : now;
  const consumed = windowStartedAt === startedAtMs ? Math.max(0, Math.floor(numberField(metadata.operationBudgetConsumed) ?? 0)) : 0;

  if (consumed + requestCount > capPerWindow) {
    const msUntilAvailable = Math.max(1, windowStartedAt + windowMs - now);
    await app.persistence.updateProviderOperation({
      id: operation.id,
      metadata: {
        ...metadata,
        operationBudgetConsumed: consumed,
        operationBudgetWindowStartedAt: new Date(windowStartedAt).toISOString(),
        operationBudgetWindowMs: windowMs,
        operationBudgetCapPerWindow: capPerWindow,
        operationBudgetPausedUntil: new Date(now + msUntilAvailable).toISOString(),
      },
    });
    throw new RateLimitedError({ msUntilAvailable });
  }

  await app.persistence.updateProviderOperation({
    id: operation.id,
    metadata: {
      ...metadata,
      operationBudgetConsumed: consumed + requestCount,
      operationBudgetWindowStartedAt: new Date(windowStartedAt).toISOString(),
      operationBudgetWindowMs: windowMs,
      operationBudgetCapPerWindow: capPerWindow,
      operationBudgetPausedUntil: null,
    },
  });
}

function hashProviderFixerToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function newProviderFixerToken(): string {
  return `PF-${randomBytes(9).toString("base64url").toUpperCase()}`;
}

async function publishProviderOperationProgress(
  app: FastifyInstance,
  actorUserId: string,
  payload: {
    operationId: string;
    providerId: string;
    processed: number;
    total: number;
    progressPercent: number;
  },
): Promise<void> {
  const now = Date.now();
  const lastPublishedAt = providerOperationProgressEventState.get(payload.operationId) ?? 0;
  if (payload.progressPercent < 100 && now - lastPublishedAt < 1_000) return;
  providerOperationProgressEventState.set(payload.operationId, now);
  await app.eventBus.publishEvent(actorUserId, "provider_operation_progress", payload);
}

async function verifyProviderFixerCandidate(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  ticker: string,
  candidateSymbol: string,
  resolverMode: MarketDataResolverMode,
): Promise<ProviderSymbolVerificationResult> {
  const provider = app.marketDataRegistry.marketData.get(marketCode);
  if (provider?.providerId !== providerId || !provider.verifyResolvedSymbol) {
    return {
      verified: false,
      checkedSymbol: candidateSymbol,
      resolverMode,
      reason: "provider_symbol_verifier_unavailable",
    };
  }
  return provider.verifyResolvedSymbol(ticker, candidateSymbol, { resolverMode });
}

class ProviderFixerCandidateRateLimitedError extends RateLimitedError {
  readonly evidence: ProviderFixerDashboardEvidenceSampleDto;

  constructor(cause: RateLimitedError, evidence: ProviderFixerDashboardEvidenceSampleDto) {
    super({ msUntilAvailable: cause.msUntilAvailable });
    this.evidence = evidence;
  }
}

function alternateYahooKrSuffix(suffix: ".KS" | ".KQ" | null): ".KS" | ".KQ" | null {
  if (suffix === ".KS") return ".KQ";
  if (suffix === ".KQ") return ".KS";
  return null;
}

async function buildProviderFixerEvidenceSample(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  scopeItems: DurableProviderScopeItem[],
  resolverMode: MarketDataResolverMode,
  limit: number,
  options: { verifyCandidate?: boolean; operationBudget?: ProviderOperationRecord } = {},
): Promise<{ sample: ProviderFixerDashboardEvidenceSampleDto[]; total: number }> {
  const page = scopeItems.slice(0, limit);
  const rows: ProviderFixerDashboardEvidenceSampleDto[] = [];
  for (const item of page) {
    rows.push(await buildProviderFixerEvidenceSampleRow(app, providerId, marketCode, item, resolverMode, options));
  }
  return {
    sample: rows,
    total: scopeItems.length,
  };
}

async function buildProviderFixerEvidenceSampleRow(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  item: DurableProviderScopeItem,
  resolverMode: MarketDataResolverMode,
  options: { verifyCandidate?: boolean; operationBudget?: ProviderOperationRecord } = {},
): Promise<ProviderFixerDashboardEvidenceSampleDto> {
  const bareTicker = item.sourceSymbol.replace(/\.(KS|KQ)$/i, "").toUpperCase();
  let candidateSymbol: string | null = null;
  let exchangeHint: string | null = null;
  let verificationStatus: ProviderFixerDashboardEvidenceSampleDto["verificationStatus"] = "pending";
  let verificationReason: string | null = null;
  let attemptedCandidates: ProviderOperationCandidateAttemptDto[] = [];

  if (providerId === "yahoo-finance-kr" && marketCode === "KR") {
    const existing = await app.persistence.getProviderResolutionMapping(providerId, "KR", bareTicker);
    if (existing) {
      candidateSymbol = existing.resolvedSymbol;
      exchangeHint = "durable provider_resolution_mappings row";
      verificationStatus = "verified";
      verificationReason = "mapping_already_exists";
      attemptedCandidates = [{ symbol: existing.resolvedSymbol, status: "verified", reason: "mapping_already_exists" }];
    } else {
      const instrument = await app.persistence.getInstrument(bareTicker, "KR");
      const suffix = yahooSuffixHintFromKrCatalogEvidence(
        instrument?.catalogExchangeRaw ?? instrument?.typeRaw ?? null,
        instrument?.catalogMicCode ?? null,
      );
      if (suffix) {
        const orderedCandidates = [`${bareTicker}${suffix}`];
        const alternateSuffix = alternateYahooKrSuffix(suffix);
        if (alternateSuffix) orderedCandidates.push(`${bareTicker}${alternateSuffix}`);
        candidateSymbol = orderedCandidates[0] ?? null;
        exchangeHint = [
          instrument?.catalogExchangeRaw ? `Twelve Data exchange=${instrument.catalogExchangeRaw}` : null,
          instrument?.catalogMicCode ? `mic=${instrument.catalogMicCode}` : null,
        ].filter(Boolean).join(" / ") || "Twelve Data catalog hint";
        if (options.verifyCandidate) {
          attemptedCandidates = [];
          for (const orderedCandidate of orderedCandidates) {
            if (options.operationBudget) {
              try {
                await reserveProviderOperationBudget(app, options.operationBudget, 1);
              } catch (err) {
                if (err instanceof RateLimitedError) {
                  throw new ProviderFixerCandidateRateLimitedError(err, {
                    symbol: bareTicker,
                    providerSymbol: item.providerSymbol ?? bareTicker,
                    candidateSymbol,
                    exchangeHint,
                    verificationStatus: attemptedCandidates.length > 0 ? "rejected" : "pending",
                    verificationReason,
                    attemptedCandidates,
                    note: "Provider verification paused by rate-limit guardrails.",
                  });
                }
                throw err;
              }
            }
            try {
              const verification = await verifyProviderFixerCandidate(
                app,
                providerId,
                marketCode,
                bareTicker,
                orderedCandidate,
                resolverMode,
              );
              if (verification.verified) {
                candidateSymbol = verification.checkedSymbol;
                verificationStatus = "verified";
                verificationReason = null;
                attemptedCandidates.push({ symbol: verification.checkedSymbol, status: "verified", reason: null });
                break;
              }
              verificationStatus = "rejected";
              verificationReason = verification.reason ?? "candidate_rejected";
              attemptedCandidates.push({
                symbol: verification.checkedSymbol,
                status: "rejected",
                reason: verification.reason ?? "candidate_rejected",
              });
            } catch (err) {
              if (err instanceof RateLimitedError) {
                throw new ProviderFixerCandidateRateLimitedError(err, {
                  symbol: bareTicker,
                  providerSymbol: item.providerSymbol ?? bareTicker,
                  candidateSymbol,
                  exchangeHint,
                  verificationStatus: attemptedCandidates.length > 0 ? "rejected" : "pending",
                  verificationReason,
                  attemptedCandidates,
                  note: "Provider verification paused by rate-limit guardrails.",
                });
              }
              throw err;
            }
          }
        }
      }
    }
  }

  return {
    symbol: bareTicker,
    providerSymbol: item.providerSymbol ?? bareTicker,
    candidateSymbol,
    exchangeHint,
    verificationStatus,
    verificationReason,
    attemptedCandidates,
    note: candidateSymbol
      ? verificationStatus === "verified"
        ? "Candidate verified against the provider for this frozen unresolved scope."
        : options.verifyCandidate
          ? "All provider symbol candidates were rejected during execution."
          : "Candidate is display-only until execution re-verifies the frozen unresolved scope."
      : "No catalog exchange/MIC hint was available; leave unresolved for manual review.",
  };
}

async function buildProviderFixerScopeSnapshot(
  _app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  scope: ProviderFixerScopeInput,
  scopeItems: DurableProviderScopeItem[],
): Promise<{ matchCount: number; snapshotHash: string }> {
  const entries = scopeItems.map((row) => {
    return `${row.providerId}:${row.marketCode}:${row.errorCode}:${row.sourceSymbol}:${row.updatedAt}:${row.occurrenceCount}`;
  });
  entries.sort();
  return {
    matchCount: scopeItems.length,
    snapshotHash: hashProviderFixerToken(JSON.stringify({
      providerId,
      marketCode,
      fingerprint: providerFixerScopeFingerprint(scope),
      matchCount: scopeItems.length,
      entries,
    })).slice(0, 12),
  };
}

function evidenceSampleFromOperation(operation: ProviderOperationRecord): ProviderFixerDashboardEvidenceSampleDto[] {
  const sample = Array.isArray(operation.sample) ? operation.sample : [];
  return sample
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null)
    .map((item): ProviderFixerDashboardEvidenceSampleDto => {
      const attemptedCandidates = Array.isArray(item.attemptedCandidates)
        ? item.attemptedCandidates
          .map((attempt) => asRecord(attempt))
          .filter((attempt): attempt is Record<string, unknown> => attempt !== null)
          .map((attempt): ProviderOperationCandidateAttemptDto | null => {
            const symbol = stringField(attempt.symbol);
            const status = attempt.status === "verified" || attempt.status === "rejected" ? attempt.status : null;
            if (!symbol || !status) return null;
            return { symbol, status, reason: stringField(attempt.reason) };
          })
          .filter((attempt): attempt is ProviderOperationCandidateAttemptDto => attempt !== null)
        : [];
      return {
        symbol: stringField(item.symbol) ?? "",
        providerSymbol: stringField(item.providerSymbol) ?? "",
        candidateSymbol: stringField(item.candidateSymbol),
        exchangeHint: stringField(item.exchangeHint),
        verificationStatus:
          item.verificationStatus === "verified" || item.verificationStatus === "rejected"
            ? item.verificationStatus
            : "pending",
        verificationReason: stringField(item.verificationReason),
        attemptedCandidates,
        note: stringField(item.note) ?? "",
      };
    })
    .filter((item) => item.symbol.length > 0 && item.providerSymbol.length > 0);
}

function isKrMappingProviderOperation(operation: Pick<ProviderOperationRecord, "marketCode" | "operationType">): boolean {
  return operation.marketCode === "KR" && (
    operation.operationType === "repair_mapping"
    || operation.operationType === "resolver_repair"
    || operation.operationType === "reverify_mapping"
    || operation.operationType === "revert_mapping"
  );
}

function providerOperationOutcomeResultFromCounts(input: {
  total: number;
  processed: number;
  pending: number;
  running: number;
  succeeded: number;
  failed: number;
  skipped: number;
  rateLimited: number;
  cancelled: number;
}): ProviderOperationOutcomeResult {
  if (input.total === 0) return "none";
  if (input.running > 0 || input.pending > 0) return "running";
  if (input.rateLimited > 0) return "rate_limited";
  if (input.failed > 0) return input.succeeded > 0 ? "partial" : "failed";
  if (input.succeeded > 0 && (input.skipped > 0 || input.cancelled > 0)) return "partial";
  if (input.succeeded > 0) return "all_succeeded";
  if (input.processed > 0) return "none_applied";
  return "none";
}

function providerOperationOutcomeSummaryFromMetadata(operation: ProviderOperationRecord): ProviderOperationOutcomeSummaryDto {
  const metadata = asRecord(operation.metadata) ?? {};
  const total = numberField(metadata.outcomeTotalCount) ?? operation.matchCount ?? 0;
  const processed = numberField(metadata.outcomeProcessedCount) ?? 0;
  const pending = numberField(metadata.outcomePendingCount) ?? Math.max(0, total - processed);
  const running = numberField(metadata.outcomeRunningCount) ?? 0;
  const succeeded = numberField(metadata.outcomeSucceededCount) ?? 0;
  const failed = numberField(metadata.outcomeFailedCount) ?? 0;
  const skipped = numberField(metadata.outcomeSkippedCount) ?? 0;
  const rateLimited = numberField(metadata.outcomeRateLimitedCount) ?? 0;
  const cancelled = numberField(metadata.outcomeCancelledCount) ?? 0;
  const progressPercent = total > 0 ? Math.min(100, Math.round((processed / total) * 100)) : 0;
  return {
    total,
    processed,
    pending,
    running,
    succeeded,
    failed,
    skipped,
    rateLimited,
    cancelled,
    progressPercent,
    result: providerOperationOutcomeResultFromCounts({
      total,
      processed,
      pending,
      running,
      succeeded,
      failed,
      skipped,
      rateLimited,
      cancelled,
    }),
  };
}

function normalizeDateOnlyEndFilter(value: string | undefined): string | undefined {
  if (!value || !ISO_DATE_ONLY_FILTER.test(value)) return value;
  return new Date(Date.parse(`${value}T00:00:00.000Z`) + 24 * 60 * 60 * 1000 - 1).toISOString();
}

function providerFixerOperationToDto(
  operation: ProviderOperationRecord,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
): ProviderFixerDashboardOperationDto {
  const metadata = asRecord(operation.metadata) ?? {};
  const frozenScope = asRecord(metadata.frozenScope);
  const matchCount = operation.matchCount ?? 0;
  const dangerous = matchCount >= guardrails.dangerousMatchThreshold;
  const token = stringField(metadata.previewTokenDisplay) ?? operation.id;
  const scopeTypeRaw = stringField(metadata.scopeType);
  const scopeType =
    scopeTypeRaw === "row" || scopeTypeRaw === "selected_items" || scopeTypeRaw === "filter"
      ? scopeTypeRaw
      : "legacy";
  const previewExpired = operation.previewExpiresAt
    ? new Date(operation.previewExpiresAt).getTime() <= Date.now()
    : false;
  const confirmationText =
    stringField(metadata.confirmationText) ?? (dangerous ? `EXECUTE ${matchCount}` : null);
  const sample = evidenceSampleFromOperation(operation);
  const pageSize = guardrails.uiPageSize;
  return {
    id: operation.id,
    providerId: operation.providerId,
    market: providerFixerMarketLabel(operation.marketCode),
    phase: operation.phase,
    matchCount,
    preview: {
      scopeType,
      scopeLabel: operation.scopeQuery ?? `${operation.providerId}:${operation.errorCode ?? "all"}`,
      queryBacked: matchCount > sample.length,
      page: 1,
      totalPages: Math.max(1, Math.ceil(Math.max(matchCount, sample.length) / Math.max(pageSize, 1))),
      token,
      tokenExpiresAt: operation.previewExpiresAt ?? operation.createdAt,
      snapshotHash: operation.snapshotHash ?? "unavailable",
      matchCount,
      sampleCount: sample.length,
      confirmationMode: dangerous ? "typed" : "standard",
      confirmationText: dangerous ? confirmationText : null,
      acknowledgementLabel: "I understand this can write provider rows",
      scopeSummary: stringField(metadata.scopeSummary) ?? `${matchCount} unresolved rows`,
      search: stringField(metadata.scopeSearch),
      state: (stringField(metadata.scopeState) as ProviderFixerDashboardPreviewDto["state"] | null) ?? null,
      frozenScope: frozenScope ? {
        type: frozenScope.type === "selected_items" ? "selected_items" : "filter",
        filterFingerprint: stringField(frozenScope.filterFingerprint) ?? stringField(metadata.scopeFingerprint) ?? "",
        matchCount: numberField(frozenScope.matchCount) ?? matchCount,
        selectedItems: providerFixerFrozenSelectedItemsFromMetadata(metadata),
        filter: asRecord(frozenScope.filter)
          ? {
              providerId: stringField(asRecord(frozenScope.filter)?.providerId) ?? operation.providerId,
              marketCode: (stringField(asRecord(frozenScope.filter)?.marketCode) ?? operation.marketCode) as ProviderUnresolvedItemDto["marketCode"],
              errorCode: stringField(asRecord(frozenScope.filter)?.errorCode) ?? operation.errorCode ?? "symbol_unresolved",
              state: "active",
              search: stringField(asRecord(frozenScope.filter)?.search),
            }
          : null,
      } : null,
      evidenceSample: sample,
    },
    canExecute: (operation.phase === "preview" || operation.phase === "staged") && !previewExpired,
    canPause: operation.phase === "running",
    canResume: operation.phase === "paused",
    canCancel:
      operation.phase === "preparing_preview"
      || operation.phase === "preview"
      || operation.phase === "staged"
      || operation.phase === "queued"
      || operation.phase === "running"
      || operation.phase === "paused",
    canRetry: !isKrMappingProviderOperation(operation)
      && (operation.phase === "paused" || operation.phase === "failed" || operation.phase === "cancelled" || operation.phase === "completed"),
    dangerous,
    progressPercent: numberField(metadata.progressPercent),
    autoPauseFailureCount: numberField(metadata.autoPauseFailureCount),
    autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
    effectiveRateCapPerMinute: numberField(metadata.effectiveRateCapPerMinute) ?? 250,
    outcomeSummary: providerOperationOutcomeSummaryFromMetadata(operation),
  };
}

const MARKET_DATA_OPERATION_DEBUG_ALLOWLIST = new Set([
  "queuedBehindOperationId",
  "failureReason",
  "failureName",
  "msUntilAvailable",
  "batchId",
  "retryOfOperationId",
  "retryAttempt",
]);

const MARKET_DATA_OPERATION_DETAIL_ALLOWLIST = new Set([
  "scope",
  "scopeType",
  "scopeSummary",
  "source",
  "categories",
  "dateRange",
  "batchId",
  "enqueuedJobCount",
  "skippedExistingJobCount",
  "deletedRows",
  "succeeded",
  "failed",
  "mappingSourceSymbol",
  "mappingResolvedSymbol",
  "mappingPreviousVerifiedAt",
  "mappingPreviousEvidence",
  "resolverMode",
  "unsupportedRows",
  "unsupportedCategories",
  "linkedRefillAvailable",
  "linkedRefillMode",
  "linkedRefillRequested",
]);

const MARKET_DATA_LOG_CONTEXT_ALLOWLIST = new Set([
  "providerId",
  "marketCode",
  "operationType",
  "sourceSymbol",
  "resolvedSymbol",
  "reason",
  "batchId",
  "jobId",
  "matchCount",
  "enqueuedJobCount",
  "skippedExistingJobCount",
  "deletedRows",
  "scope",
  "categories",
  "action",
  "msUntilAvailable",
]);

function sanitizeAllowlistedRecord(
  value: Record<string, unknown> | null | undefined,
  allowlist: Set<string>,
): Record<string, unknown> | null {
  if (!value) return null;
  const next = Object.fromEntries(Object.entries(value).filter(([key]) => allowlist.has(key)));
  return Object.keys(next).length > 0 ? next : null;
}

function marketDataOperationDetailValue(value: unknown): AdminMarketDataOperationDetailValue | undefined {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value;
  }
  if (asRecord(value)) {
    const entries = Object.entries(asRecord(value) ?? {}).filter(([, item]) =>
      item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean",
    );
    return Object.keys(Object.fromEntries(entries)).length > 0
      ? Object.fromEntries(entries) as Record<string, string | number | boolean | null>
      : undefined;
  }
  return undefined;
}

function marketDataOperationDetails(
  operationType: string,
  record: Record<string, unknown> | null,
): AdminMarketDataOperationDetailsDto | null {
  if (!record) return null;
  const fields = Object.fromEntries(
    Object.entries(record)
      .map(([key, value]) => [key, marketDataOperationDetailValue(value)] as const)
      .filter((entry): entry is readonly [string, AdminMarketDataOperationDetailValue] => entry[1] !== undefined),
  );
  if (Object.keys(fields).length === 0) return null;
  if (operationType === "backfill_catalog_rows") {
    return { kind: "backfill_catalog_rows", operationType, fields };
  }
  if (operationType === "purge_market_data") {
    return { kind: "purge_market_data", operationType, fields };
  }
  if (marketDataOperationHasItemOutcomes(operationType)) {
    return { kind: "mapping", operationType, fields };
  }
  if (operationType === "sync_catalog") {
    return { kind: "sync_catalog", operationType, fields };
  }
  if (operationType === "refresh_rates" || operationType === "refresh_fx_rates") {
    return { kind: "refresh_rates", operationType, fields };
  }
  if (operationType === "sync_asx_gics") {
    return { kind: "sync_asx_gics", operationType, fields };
  }
  return { kind: "generic", operationType, fields };
}

function marketDataOperationMatchesListFilters(
  operation: ProviderOperationRecord,
  filters: {
    workspaceProviderIds: string[];
    providerId?: string;
    marketCode: AdminMarketCode;
    operationType?: string;
    phase?: ProviderOperationPhase;
    search?: string;
    from?: string;
    to?: string;
  },
): boolean {
  if (!filters.workspaceProviderIds.includes(operation.providerId)) return false;
  if (filters.providerId && operation.providerId !== filters.providerId) return false;
  if (filters.operationType && operation.operationType !== filters.operationType) return false;
  if (filters.phase && operation.phase !== filters.phase) return false;
  if (filters.marketCode !== "FX" && operation.marketCode !== filters.marketCode) return false;
  if (filters.marketCode === "FX" && operation.marketCode !== "FX") return false;
  if (filters.from && Date.parse(operation.createdAt) < Date.parse(filters.from)) return false;
  if (filters.to && Date.parse(operation.createdAt) > Date.parse(filters.to)) return false;
  const search = filters.search?.trim().toLowerCase();
  if (search) {
    const haystack = JSON.stringify([
      operation.id,
      operation.providerId,
      operation.marketCode,
      operation.operationType,
      operation.scopeQuery,
      operation.errorCode,
    ]).toLowerCase();
    if (!haystack.includes(search)) return false;
  }
  return true;
}

function marketDataOperationHasItemOutcomes(operationType: string): boolean {
  return operationType === "repair_mapping"
    || operationType === "resolver_repair"
    || operationType === "renew_evidence"
    || operationType === "rerun_backfill"
    || operationType === "reverify_mapping"
    || operationType === "revert_mapping"
    || operationType === "ignore_unresolved"
    || operationType === "mark_unsupported"
    || operationType === "reopen_unresolved";
}

function providerOperationSupportsPauseResume(operationType: string): boolean {
  return operationType === "renew_evidence"
    || operationType === "rerun_backfill"
    || operationType === "reverify_mapping"
    || operationType === "revert_mapping"
    || operationType === "resolver_repair"
    || operationType === "repair_mapping";
}

function marketDataOperationToDto(operation: ProviderOperationRecord, config: AppConfigDto): AdminMarketDataOperationDto {
  const metadata = asRecord(operation.metadata) ?? {};
  const previewExpired = operation.previewExpiresAt ? Date.parse(operation.previewExpiresAt) <= Date.now() : false;
  const categories = Array.isArray(metadata.categories)
    ? metadata.categories.filter((value): value is string => typeof value === "string")
    : [];
  const summary: AdminMarketDataOperationDto["summary"] = {
    kind: operation.operationType,
    previewParts: [
      { kind: "scope" as const, value: stringField(metadata.scope) },
      { kind: "source" as const, value: stringField(metadata.source) },
      { kind: "source_symbol" as const, value: stringField(metadata.mappingSourceSymbol) },
      { kind: "resolved_symbol" as const, value: stringField(metadata.mappingResolvedSymbol) },
    ].filter((part): part is { kind: "scope" | "source" | "source_symbol" | "resolved_symbol"; value: string } => Boolean(part.value)),
    counts: {
      matchCount: operation.matchCount ?? 0,
      enqueuedJobCount: numberField(metadata.enqueuedJobCount) ?? 0,
      skippedExistingJobCount: numberField(metadata.skippedExistingJobCount) ?? 0,
      deletedRows: numberField(metadata.deletedRows) ?? 0,
      succeeded: numberField(metadata.succeeded) ?? 0,
      failed: numberField(metadata.failed) ?? 0,
    },
    dateRange: asRecord(metadata.dateRange)
      ? {
          startDate: stringField(asRecord(metadata.dateRange)?.startDate) ?? null,
          endDate: stringField(asRecord(metadata.dateRange)?.endDate) ?? null,
        }
      : null,
    batchId: stringField(metadata.batchId) ?? operation.legacyBatchId,
    categories,
    rateLimit: {
      requestsPerMinute: providerOperationRateCapPerMinute(operation.providerId, config),
    },
    pacing: {
      minRequestIntervalMs:
        operation.providerId === "yahoo-finance-kr"
          ? config.effectiveYahooKrProviderMinRequestIntervalMs
          : operation.providerId === "yahoo-finance-au"
            ? config.effectiveYahooAuProviderMinRequestIntervalMs
            : operation.providerId === "twelve-data-kr" || operation.providerId === "twelve-data-au"
              ? config.effectiveTwelveDataProviderMinRequestIntervalMs
              : operation.providerId === "frankfurter"
                ? config.effectiveFrankfurterProviderMinRequestIntervalMs
                : operation.providerId === "asx-gics-csv"
                  ? config.effectiveAsxGicsProviderMinRequestIntervalMs
                  : config.effectiveFinmindProviderMinRequestIntervalMs,
      enforced: operation.providerId === "yahoo-finance-kr",
    },
    outcomeSummary: providerOperationOutcomeSummaryFromMetadata(operation),
  };
  return {
    id: operation.id,
    providerId: operation.providerId,
    market: operation.marketCode,
    marketCode: operation.marketCode as AdminMarketDataOperationDto["marketCode"],
    operationType: operation.operationType,
    phase: operation.phase,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    cancelledAt: operation.cancelledAt,
    matchCount: operation.matchCount ?? 0,
    progressPercent: numberField(metadata.progressPercent),
    previewExpiresAt: operation.previewExpiresAt,
    canPause: operation.phase === "running" && providerOperationSupportsPauseResume(operation.operationType),
    canResume: operation.phase === "paused" && providerOperationSupportsPauseResume(operation.operationType),
    canCancel:
      operation.phase === "preparing_preview"
      || operation.phase === "preview"
      || operation.phase === "staged"
      || operation.phase === "queued"
      || operation.phase === "running"
      || operation.phase === "paused",
    execute: {
      canExecute: (operation.phase === "preview" || operation.phase === "staged") && !previewExpired,
      executeMode:
        operation.operationType === "backfill_catalog_rows" || operation.operationType === "purge_market_data"
          ? "preview"
          : operation.phase === "preview" || operation.phase === "staged"
            ? "direct"
            : "none",
      confirmationLevel:
        stringField(metadata.confirmationText) ? "typed" : (operation.phase === "preview" || operation.phase === "staged") ? "checkbox" : "none",
      confirmationText: stringField(metadata.confirmationText),
      acknowledgementLabel: stringField(metadata.acknowledgementLabel) ?? null,
      previewToken: stringField(metadata.previewTokenDisplay),
      previewExpired,
      blockedReason: previewExpired ? "preview_expired" : null,
      endpoint:
        operation.operationType === "backfill_catalog_rows"
          ? "market_backfill_execute"
          : operation.operationType === "purge_market_data"
            ? "market_purge_execute"
            : operation.metadata && metadata.marketDataBff === true
              ? "market_action"
              : "provider_operation",
    },
    summary,
    details: marketDataOperationDetails(
      operation.operationType,
      sanitizeAllowlistedRecord(metadata, MARKET_DATA_OPERATION_DETAIL_ALLOWLIST),
    ),
    debug: sanitizeAllowlistedRecord(metadata, MARKET_DATA_OPERATION_DEBUG_ALLOWLIST),
    outcomes: {
      available: marketDataOperationHasItemOutcomes(operation.operationType),
      reason: marketDataOperationHasItemOutcomes(operation.operationType) ? null : "operation_has_no_item_level_outcomes",
    },
  };
}

function providerOperationOutcomeToDto(record: ProviderOperationOutcomeRecord): ProviderOperationOutcomeDto {
  return {
    operationId: record.operationId,
    providerId: record.providerId,
    marketCode: record.marketCode as ProviderOperationOutcomeDto["marketCode"],
    sourceSymbol: record.sourceSymbol,
    providerSymbol: record.providerSymbol,
    action: record.action,
    state: record.state,
    message: record.message,
    errorCode: record.errorCode,
    jobId: record.jobId,
    evidence: record.evidence,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    updatedAt: record.updatedAt,
  };
}

async function latestProviderRepairOutcomeForUnresolvedItem(
  app: FastifyInstance,
  item: {
    providerId: string;
    marketCode: MarketCode;
    sourceSymbol: string;
  },
): Promise<ProviderOperationOutcomeDto | null> {
  if (item.providerId !== "yahoo-finance-kr" || item.marketCode !== "KR") return null;
  const outcome = await app.persistence.getLatestProviderOperationOutcome({
    providerId: item.providerId,
    marketCode: item.marketCode,
    sourceSymbol: item.sourceSymbol.replace(/\.(KS|KQ)$/i, ""),
    actions: ["repair_mapping"],
  });
  return outcome ? providerOperationOutcomeToDto(outcome) : null;
}

async function listProviderOperationOutcomeStates(
  app: FastifyInstance,
  operationId: string,
  action: string,
): Promise<Map<string, ProviderOperationOutcomeState>> {
  const states = new Map<string, ProviderOperationOutcomeState>();
  let page = 1;
  const limit = 500;
  while (true) {
    const outcomes = await app.persistence.listProviderOperationOutcomes({ operationId, action, page, limit });
    for (const outcome of outcomes.items) {
      states.set(outcome.sourceSymbol, outcome.state);
    }
    if (page * limit >= outcomes.total || outcomes.items.length === 0) break;
    page += 1;
  }
  return states;
}

async function refreshProviderOperationProgressFromOutcomes(
  app: FastifyInstance,
  operationId: string,
): Promise<ProviderOperationRecord | null> {
  const operation = await app.persistence.getProviderOperation(operationId);
  if (!operation) return null;
  const outcomes = await app.persistence.listProviderOperationOutcomes({ operationId, page: 1, limit: 1 });
  const expectedTotal = Math.max(operation.matchCount ?? 0, outcomes.summary.total);
  const progressPercent = expectedTotal > 0
    ? Math.min(100, Math.round((outcomes.summary.processed / expectedTotal) * 100))
    : outcomes.summary.progressPercent;
  return app.persistence.updateProviderOperation({
    id: operation.id,
    metadata: {
      ...(asRecord(operation.metadata) ?? {}),
      progressPercent,
      outcomeTotalCount: expectedTotal,
      outcomeRecordedCount: outcomes.summary.total,
      outcomeProcessedCount: outcomes.summary.processed,
      outcomePendingCount: Math.max(0, expectedTotal - outcomes.summary.processed),
      outcomeRunningCount: outcomes.summary.running,
      outcomeSucceededCount: outcomes.summary.succeeded,
      outcomeFailedCount: outcomes.summary.failed,
      outcomeSkippedCount: outcomes.summary.skipped,
      outcomeRateLimitedCount: outcomes.summary.rateLimited,
      outcomeCancelledCount: outcomes.summary.cancelled,
      outcomeResult: outcomes.summary.result,
    },
  });
}

function isExpiredProviderOperationPreview(operation: ProviderOperationRecord, now = Date.now()): boolean {
  return (
    (operation.phase === "preview" || operation.phase === "staged")
    && operation.previewExpiresAt != null
    && new Date(operation.previewExpiresAt).getTime() <= now
  );
}

async function getStoppedProviderOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
): Promise<(ProviderOperationRecord & { phase: StoppedProviderOperationPhase }) | null> {
  const current = await app.persistence.getProviderOperation(operation.id);
  if (current?.phase !== "cancelled" && current?.phase !== "paused") return null;
  return current as ProviderOperationRecord & { phase: StoppedProviderOperationPhase };
}

async function throwIfProviderOperationStopped(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
): Promise<void> {
  const stopped = await getStoppedProviderOperation(app, operation);
  if (stopped) throw new ProviderOperationStoppedError(stopped);
}

async function returnStoppedProviderOperationIfStopped(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
  message: string,
  result: Record<string, unknown>,
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> } | null> {
  const current = await getStoppedProviderOperation(app, operation);
  if (!current) return null;
  const refreshed = await refreshProviderOperationProgressFromOutcomes(app, current.id) ?? current;
  await app.persistence.createProviderOperationLog({
    operationId: refreshed.id,
    phase: refreshed.phase,
    level: "warning",
    message,
    context: {
      providerId: refreshed.providerId,
      marketCode: refreshed.marketCode,
      ...result,
    },
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
    operationId: refreshed.id,
    providerId: refreshed.providerId,
    phase: refreshed.phase,
  });
  return {
    operation: providerFixerOperationToDto(refreshed, context.guardrails),
    result: { status: refreshed.phase, ...result },
  };
}

function assertProviderFixerPreviewToken(operation: ProviderOperationRecord, previewToken: string | undefined): void {
  if (operation.previewExpiresAt && new Date(operation.previewExpiresAt).getTime() <= Date.now()) {
    throw routeError(400, "provider_fixer_preview_token_expired", "Preview token has expired; run preview again");
  }
  if (operation.previewTokenHash && (!previewToken || hashProviderFixerToken(previewToken) !== operation.previewTokenHash)) {
    throw routeError(400, "provider_fixer_preview_token_mismatch", "Preview token does not match the selected operation");
  }
}

async function findOtherActiveProviderOperationExecution(
  app: FastifyInstance,
  scope: { providerId: string; marketCode: MarketCode; operationId?: string | null },
): Promise<ProviderOperationRecord | null> {
  const active = await app.persistence.listProviderOperations({
    providerId: scope.providerId,
    marketCode: scope.marketCode,
    phases: ["preparing_preview", "preview", "queued", "running", "paused"],
    page: 1,
    limit: 50,
  });
  const now = Date.now();
  return active.items.find((row) => {
    if (row.id === scope.operationId) return false;
    if (isExpiredProviderOperationPreview(row, now)) return false;
    return true;
  }) ?? null;
}

function providerOperationBlockerDto(operation: ProviderOperationRecord): AdminMarketDataOperationBlockerDto {
  return {
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode as AdminMarketDataOperationBlockerDto["marketCode"],
    operationType: operation.operationType,
    phase: operation.phase,
    createdAt: operation.createdAt,
    updatedAt: operation.updatedAt,
    startedAt: operation.startedAt,
    completedAt: operation.completedAt,
    cancelledAt: operation.cancelledAt,
  };
}

async function assertNoOtherProviderOperationExecution(
  app: FastifyInstance,
  scope: { providerId: string; marketCode: MarketCode; operationId?: string | null },
): Promise<void> {
  const other = await findOtherActiveProviderOperationExecution(app, scope);
  if (other) {
    throw routeError(
      409,
      "provider_fixer_active_execution_exists",
      "Another provider operation is already active for this provider and market",
      {
        blockingOperation: providerOperationBlockerDto(other),
      },
    );
  }
}

async function pauseStaleProviderOperations(
  app: FastifyInstance,
  staleHeartbeatMinutes: number,
  context?: { actorUserId: string; ipAddress?: string },
): Promise<number> {
  const running = await app.persistence.listProviderOperations({
    phases: ["running"],
    page: 1,
    limit: 500,
  });
  const nowMs = Date.now();
  const staleAfterMs = Math.max(1, staleHeartbeatMinutes) * 60_000;
  let paused = 0;
  for (const operation of running.items) {
    const heartbeatAt = new Date(operation.updatedAt).getTime();
    if (!Number.isFinite(heartbeatAt) || nowMs - heartbeatAt <= staleAfterMs) continue;
    const staleDetectedAt = new Date(nowMs).toISOString();
    const updated = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "paused",
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        pauseReason: "stale_operation",
        staleDetectedAt,
        staleHeartbeatMinutes,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "paused",
      level: "warning",
      message: `auto_paused_stale_operation provider=${operation.providerId} market=${operation.marketCode} stale_minutes=${staleHeartbeatMinutes}`,
      context: {
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        previousUpdatedAt: operation.updatedAt,
        staleDetectedAt,
        staleHeartbeatMinutes,
      },
    });
    if (context) {
      await app.persistence.appendAuditLog({
        actorUserId: context.actorUserId,
        action: "provider_fixer_operation",
        ipAddress: context.ipAddress,
        metadata: {
          operationId: operation.id,
          action: "auto_pause_stale",
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          previousUpdatedAt: operation.updatedAt,
          staleDetectedAt,
          staleHeartbeatMinutes,
        },
      });
      await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId: operation.providerId,
        phase: updated.phase,
        pauseReason: "stale_operation",
      });
    }
    paused += 1;
  }
  return paused;
}

async function providerFixerDiagnostics(
  app: FastifyInstance,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
  providerId: string,
  marketCode: MarketCode,
  resolverMode: "quote_first" | "chart_probe_v1",
  errorCode: string,
): Promise<ProviderFixerDashboardDiagnosticsResponse> {
  const healthRows = await app.persistence.getAllProviderHealthStatuses();
  const providerIds = [...new Set([
    providerId,
    ...PROVIDER_FIXER_DEFAULT_PROVIDER_IDS,
    ...healthRows.map((row) => row.providerId),
  ])];
  const rows = await Promise.all(providerIds.map(async (id) => {
    const inferredMarketCode = providerFixerMarketCode(id, id === providerId ? marketCode : undefined);
    const code =
      id === "yahoo-finance-kr"
        ? "yahoo_finance_kr_symbol_unresolved"
        : id === "finmind-us" || id === "finmind-tw"
          ? "provider_symbol_unresolved"
          : errorCode;
    const page = await app.persistence.listProviderErrorTrailPage({
      providerId: id,
      marketCode: inferredMarketCode,
      errorMessageLike: code,
      excludeResolvedMappings: id === "yahoo-finance-kr" && inferredMarketCode === "KR",
      page: 1,
      limit: 1,
    });
    return {
      providerId: id,
      market: providerFixerMarketLabel(inferredMarketCode),
      unresolvedCount: page.total,
      resolverStatus:
        id === "yahoo-finance-kr" ? "enabled" as const : page.total > 0 ? "disabled" as const : "auto" as const,
      severity:
        page.total >= guardrails.dangerousMatchThreshold ? "critical" as const : page.total > 0 ? "warning" as const : "ok" as const,
      errorCode: code,
    };
  }));
  return {
    diagnostics: {
      resolverMode,
      providerId,
      errorCode,
      recommendation:
        "Run preview first; execute remains disabled until the preview token and confirmation match the selected operation.",
      rows: rows.filter((row) => row.unresolvedCount > 0 || PROVIDER_FIXER_DEFAULT_PROVIDER_IDS.includes(row.providerId as typeof PROVIDER_FIXER_DEFAULT_PROVIDER_IDS[number])),
      guardrails,
    },
  };
}

async function providerFixerSummary(
  app: FastifyInstance,
  guardrails: ProviderFixerDashboardGuardrailSettingsDto,
  config: AppConfigDto,
): Promise<ProviderFixerDashboardSummaryResponse> {
  const diagnostics = await providerFixerDiagnostics(
    app,
    guardrails,
    "yahoo-finance-kr",
    "KR",
    "quote_first",
    "yahoo_finance_kr_symbol_unresolved",
  );
  const operations = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["preview", "staged", "queued", "running", "paused"],
  });
  const running = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["running"],
  });
  const staged = await app.persistence.listProviderOperations({
    page: 1,
    limit: 1,
    phases: ["preview", "staged", "queued"],
  });
  const unresolvedRows = diagnostics.diagnostics.rows.filter((row) => row.unresolvedCount > 0);
  return {
    summary: {
      criticalUnresolvedCount: unresolvedRows.reduce((sum, row) => sum + row.unresolvedCount, 0),
      affectedProviders: unresolvedRows.map((row) => row.providerId),
      activeOperationsCount: operations.total,
      queuedOperationsCount: staged.total,
      runningOperationsCount: running.total,
      guardrailsEnabled: true,
      effectiveRateCapPerMinute: providerOperationRateCapPerMinute("yahoo-finance-kr", config),
    },
    guardrails,
  };
}

async function executeProviderFixerMappings(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  actorUserId: string,
): Promise<{ applied: number; skipped: number; scanned: number; mappedTickers: string[] }> {
  if (operation.providerId !== "yahoo-finance-kr" || operation.marketCode !== "KR") {
    return { applied: 0, skipped: 0, scanned: 0, mappedTickers: [] };
  }
  let applied = 0;
  let skipped = 0;
  let scanned = 0;
  const mappedTickers: string[] = [];
  const scopeItems = await listProviderUnresolvedScopeItems(app, operation.providerId, {
    type: "selected_items",
    items: providerFixerFrozenSelectedItemsFromMetadata(operation.metadata),
  });
  const priorOutcomeStates = await listProviderOperationOutcomeStates(app, operation.id, "repair_mapping");
  for (const row of scopeItems) {
    await throwIfProviderOperationStopped(app, operation);
    const sourceSymbol = row.sourceSymbol.replace(/\.(KS|KQ)$/i, "").toUpperCase();
    const priorState = priorOutcomeStates.get(sourceSymbol);
    if (priorState && !RESUMABLE_PROVIDER_OUTCOME_STATES.has(priorState)) {
      continue;
    }
    scanned += 1;
    const providerSymbol = row.providerSymbol ?? sourceSymbol;
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol,
      action: "repair_mapping",
      state: "running",
      message: "Verifying provider symbol candidate.",
      evidence: { unresolvedIdentity: { providerId: row.providerId, marketCode: row.marketCode, errorCode: row.errorCode, sourceSymbol: row.sourceSymbol } },
    });
    try {
      const existingMapping = await app.persistence.getProviderResolutionMapping(operation.providerId, "KR", sourceSymbol);
      if (existingMapping) {
        applied += 1;
        mappedTickers.push(sourceSymbol);
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          providerSymbol: existingMapping.resolvedSymbol,
          action: "repair_mapping",
          state: "succeeded",
          message: `Existing durable mapping resolves ${sourceSymbol} to ${existingMapping.resolvedSymbol}.`,
          errorCode: "mapping_already_exists",
          evidence: {
            candidateSymbol: existingMapping.resolvedSymbol,
            exchangeHint: "durable provider_resolution_mappings row",
            verificationStatus: "verified",
            verificationReason: "mapping_already_exists",
            attemptedCandidates: [
              { symbol: existingMapping.resolvedSymbol, status: "verified", reason: "mapping_already_exists" },
            ],
          },
        });
        await refreshProviderOperationProgressFromOutcomes(app, operation.id);
        continue;
      }
      const [evidence] = (
        await buildProviderFixerEvidenceSample(
          app,
          operation.providerId,
          operation.marketCode,
          [row],
          operation.resolverMode ?? "quote_first",
          1,
          { verifyCandidate: true, operationBudget: operation },
        )
      ).sample;
      if (!evidence?.candidateSymbol || evidence.verificationStatus !== "verified") {
        skipped += 1;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          providerSymbol,
          action: "repair_mapping",
          state: "skipped",
          message: evidence?.note ?? "No verified provider symbol candidate.",
          errorCode: evidence?.verificationStatus === "rejected" ? "candidate_rejected" : "candidate_missing",
          evidence: evidence
            ? {
                candidateSymbol: evidence.candidateSymbol,
                exchangeHint: evidence.exchangeHint,
                verificationStatus: evidence.verificationStatus,
                verificationReason: evidence.verificationReason ?? null,
                attemptedCandidates: evidence.attemptedCandidates ?? [],
              }
            : null,
        });
        await refreshProviderOperationProgressFromOutcomes(app, operation.id);
        continue;
      }
      await app.persistence.upsertProviderResolutionMapping({
        providerId: operation.providerId,
        marketCode: "KR",
        sourceSymbol: evidence.symbol,
        resolvedSymbol: evidence.candidateSymbol,
        resolverMode: operation.resolverMode ?? "quote_first",
        evidence: {
          exchangeHint: evidence.exchangeHint,
          note: evidence.note,
          operationId: operation.id,
        },
        verifiedByUserId: actorUserId,
      });
      applied += 1;
      mappedTickers.push(evidence.symbol);
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol: evidence.symbol,
        providerSymbol: evidence.providerSymbol,
        action: "repair_mapping",
        state: "succeeded",
        message: `Resolved ${evidence.symbol} to ${evidence.candidateSymbol}.`,
        evidence: {
          candidateSymbol: evidence.candidateSymbol,
          exchangeHint: evidence.exchangeHint,
          verificationStatus: evidence.verificationStatus,
          verificationReason: evidence.verificationReason ?? null,
          attemptedCandidates: evidence.attemptedCandidates ?? [],
          note: evidence.note,
        },
      });
      await refreshProviderOperationProgressFromOutcomes(app, operation.id);
    } catch (err) {
      const isRateLimited = err instanceof RateLimitedError;
      const rateLimitedEvidence = err instanceof ProviderFixerCandidateRateLimitedError ? err.evidence : null;
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol,
        action: "repair_mapping",
        state: isRateLimited ? "rate_limited" : "failed",
        message: err instanceof Error ? err.message : "Provider verification failed.",
        errorCode: isRateLimited ? "provider_rate_limited" : "provider_verification_failed",
        evidence: {
          unresolvedIdentity: { providerId: row.providerId, marketCode: row.marketCode, errorCode: row.errorCode, sourceSymbol: row.sourceSymbol },
          ...(rateLimitedEvidence
            ? {
                candidateSymbol: rateLimitedEvidence.candidateSymbol,
                exchangeHint: rateLimitedEvidence.exchangeHint,
                verificationStatus: rateLimitedEvidence.verificationStatus,
                verificationReason: rateLimitedEvidence.verificationReason ?? null,
                attemptedCandidates: rateLimitedEvidence.attemptedCandidates ?? [],
              }
            : {}),
        },
      });
      await refreshProviderOperationProgressFromOutcomes(app, operation.id);
      throw err;
    }
    await throwIfProviderOperationStopped(app, operation);
  }
  if (mappedTickers.length > 0) {
    await app.persistence.resolveProviderUnresolvedItems({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      items: scopeItems
        .filter((row) => mappedTickers.includes(row.sourceSymbol.replace(/\.(KS|KQ)$/i, "").toUpperCase()))
        .map((row) => ({
          providerId: row.providerId,
          marketCode: row.marketCode,
          errorCode: row.errorCode,
          sourceSymbol: row.sourceSymbol,
        })),
      operationId: operation.id,
    });
  }
  return { applied, skipped, scanned, mappedTickers };
}

async function enqueueProviderFixerBackfills(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  tickers: string[],
): Promise<{ enqueued: number; skippedExisting: number }> {
  if (!app.boss || operation.marketCode !== "KR" || tickers.length === 0) {
    return { enqueued: 0, skippedExisting: 0 };
  }
  let enqueued = 0;
  let skippedExisting = 0;
  for (const ticker of [...new Set(tickers)]) {
    await throwIfProviderOperationStopped(app, operation);
    const payload = {
      ticker,
      marketCode: "KR",
      trigger: "admin_rerun",
      resolverMode: operation.resolverMode ?? "quote_first",
      providerOperationId: operation.id,
    } satisfies BackfillJobData;
    const jobId = await app.boss.send(
      BACKFILL_QUEUE,
      payload,
      {
        singletonKey: getBackfillSingletonKey(ticker, "KR", payload.resolverMode),
        priority: 10,
      },
    );
    if (jobId === null) {
      skippedExisting += 1;
    } else {
      enqueued += 1;
    }
  }
  return { enqueued, skippedExisting };
}

async function completeProviderFixerOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    dangerous: boolean;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  let result: Awaited<ReturnType<typeof executeProviderFixerMappings>>;
  const backfills: Awaited<ReturnType<typeof enqueueProviderFixerBackfills>> = {
    enqueued: 0,
    skippedExisting: 0,
  };
  try {
    result = await executeProviderFixerMappings(app, operation, context.actorUserId);
    const stopped = await returnStoppedProviderOperationIfStopped(
      app,
      operation,
      context,
      `execute_stopped provider=${operation.providerId} market=${operation.marketCode} phase=stopped applied=${result.applied} skipped=${result.skipped} scanned=${result.scanned}`,
      { ...result, backfills: { enqueued: 0, skippedExisting: 0 } },
    );
    if (stopped) return stopped;
  } catch (err) {
    if (err instanceof ProviderOperationStoppedError) {
      const actionLabel = err.operation.phase === "cancelled" ? "execute_cancelled" : "execute_stopped";
      const stopped = await returnStoppedProviderOperationIfStopped(
        app,
        err.operation,
        context,
        `${actionLabel} provider=${err.operation.providerId} market=${err.operation.marketCode} phase=${err.operation.phase}`,
        { applied: 0, skipped: 0, scanned: 0, backfills: { enqueued: 0, skippedExisting: 0 } },
      );
      return stopped ?? {
        operation: providerFixerOperationToDto(err.operation, context.guardrails),
        result: { status: err.operation.phase },
      };
    }
    const message = err instanceof Error ? err.message : "Provider fixer execution failed";
    const isRateLimited = err instanceof RateLimitedError;
    const latestMetadata = asRecord((await app.persistence.getProviderOperation(operation.id))?.metadata) ?? asRecord(operation.metadata) ?? {};
    const interrupted = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: isRateLimited ? "paused" : "failed",
      completedAt: isRateLimited ? null : new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        progressPercent: 0,
        pauseReason: isRateLimited ? "paused_rate_limit" : undefined,
        autoPauseFailureCount: isRateLimited ? 1 : undefined,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : undefined,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: interrupted.id,
      phase: interrupted.phase,
      level: isRateLimited ? "warning" : "error",
      message: `${isRateLimited ? "execute_auto_paused_rate_limited" : "execute_failed"} provider=${interrupted.providerId} market=${interrupted.marketCode} reason=${message}`,
      context: {
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        errorCode: interrupted.errorCode,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: interrupted.id,
        action: isRateLimited ? "execute_auto_pause" : "execute_failed",
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        dangerous: context.dangerous,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await refreshProviderOperationProgressFromOutcomes(app, interrupted.id);
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: interrupted.id,
      providerId: interrupted.providerId,
      phase: interrupted.phase,
      pauseReason: isRateLimited ? "paused_rate_limit" : null,
    });
    if (!isRateLimited) {
      await maybeStartNextQueuedProviderOperation(app, interrupted.providerId, interrupted.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
    }
    if (context.throwOnFailure) {
      if (isRateLimited) {
        throw routeError(503, "provider_rate_limited", message);
      }
      throw err;
    }
    return {
      operation: providerFixerOperationToDto(interrupted, context.guardrails),
      result: { status: interrupted.phase, errorMessage: message },
    };
  }
  const outcomeProgress = await refreshProviderOperationProgressFromOutcomes(app, operation.id);
  const completed = await app.persistence.updateProviderOperation({
    id: operation.id,
    phase: "completed",
    completedAt: new Date().toISOString(),
    metadata: {
      ...(asRecord(outcomeProgress?.metadata) ?? asRecord(operation.metadata) ?? {}),
      progressPercent: 100,
      appliedMappingCount: result.applied,
      skippedMappingCount: result.skipped,
      scannedRowCount: result.scanned,
      enqueuedBackfillCount: backfills.enqueued,
      skippedExistingBackfillCount: backfills.skippedExisting,
      mappingOnly: true,
    },
  });
  await app.persistence.createProviderOperationLog({
    operationId: completed.id,
    phase: "completed",
    level: result.skipped > 0 ? "warning" : "info",
    message: `execute_completed provider=${completed.providerId} market=${completed.marketCode} applied=${result.applied} skipped=${result.skipped} scanned=${result.scanned} mapping_only=true enqueued_backfills=0`,
    context: { providerId: completed.providerId, marketCode: completed.marketCode, ...result, backfills },
  });
  await app.persistence.appendAuditLog({
    actorUserId: context.actorUserId,
    action: "provider_fixer_operation",
    ipAddress: context.ipAddress,
    metadata: {
      operationId: completed.id,
      action: "execute",
      providerId: completed.providerId,
      marketCode: completed.marketCode,
      dangerous: context.dangerous,
      ...result,
      backfills,
    },
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
    operationId: completed.id,
    providerId: completed.providerId,
    phase: completed.phase,
  });
  await publishProviderOperationProgress(app, context.actorUserId, {
    operationId: completed.id,
    providerId: completed.providerId,
    processed: result.applied + result.skipped,
    total: result.scanned,
    progressPercent: 100,
  });
  await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
    actorUserId: context.actorUserId,
    ipAddress: context.ipAddress,
    guardrails: context.guardrails,
  });
  return { operation: providerFixerOperationToDto(completed, context.guardrails), result: { ...result, backfills } };
}

async function renewProviderFixerEvidence(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
): Promise<{ succeeded: number; skipped: number; scanned: number }> {
  let succeeded = 0;
  let skipped = 0;
  let scanned = 0;
  const scope = providerFixerScopeFromMetadata(operation.providerId, operation.metadata, {
    marketCode: providerFixerMarketCodeField(operation.marketCode, providerFixerMarketCode(operation.providerId)),
    errorCode: operation.errorCode,
  });
  const rows = await listProviderUnresolvedScopeItems(app, operation.providerId, scope);
  const priorOutcomeStates = await listProviderOperationOutcomeStates(app, operation.id, "renew_evidence");
  for (const row of rows) {
      await throwIfProviderOperationStopped(app, operation);
      const sourceSymbol = row.sourceSymbol.replace(/\.(KS|KQ)$/i, "").toUpperCase();
      const priorState = priorOutcomeStates.get(sourceSymbol);
      if (priorState && !RESUMABLE_PROVIDER_OUTCOME_STATES.has(priorState)) {
        continue;
      }
      scanned += 1;
      const providerSymbol = row.providerSymbol ?? sourceSymbol;
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol,
        action: "renew_evidence",
        state: "running",
        message: "Renewing provider evidence.",
        evidence: { unresolvedIdentity: { providerId: row.providerId, marketCode: row.marketCode, errorCode: row.errorCode, sourceSymbol: row.sourceSymbol } },
      });
      try {
        const [evidence] = (
        await buildProviderFixerEvidenceSample(
          app,
          operation.providerId,
          operation.marketCode,
          [row],
          operation.resolverMode ?? "quote_first",
          1,
          { verifyCandidate: true, operationBudget: operation },
        )
      ).sample;
        if (evidence?.candidateSymbol && evidence.verificationStatus === "verified") {
          succeeded += 1;
          await app.persistence.upsertProviderOperationOutcome({
            operationId: operation.id,
            providerId: operation.providerId,
            marketCode: operation.marketCode,
            sourceSymbol: evidence.symbol,
            providerSymbol: evidence.providerSymbol,
            action: "renew_evidence",
            state: "succeeded",
            message: `Renewed evidence for ${evidence.symbol}: ${evidence.candidateSymbol}.`,
            evidence: {
              candidateSymbol: evidence.candidateSymbol,
              exchangeHint: evidence.exchangeHint,
              note: evidence.note,
            },
          });
        } else {
          skipped += 1;
          await app.persistence.upsertProviderOperationOutcome({
            operationId: operation.id,
            providerId: operation.providerId,
            marketCode: operation.marketCode,
            sourceSymbol,
            providerSymbol,
            action: "renew_evidence",
            state: "skipped",
            message: evidence?.note ?? "No verified provider evidence candidate.",
            errorCode: evidence?.verificationStatus === "rejected" ? "candidate_rejected" : "candidate_missing",
            evidence: evidence ? { candidateSymbol: evidence.candidateSymbol, exchangeHint: evidence.exchangeHint } : null,
          });
        }
      } catch (err) {
        const isRateLimited = err instanceof RateLimitedError;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          providerSymbol,
          action: "renew_evidence",
          state: isRateLimited ? "rate_limited" : "failed",
          message: err instanceof Error ? err.message : "Provider evidence renewal failed.",
          errorCode: isRateLimited ? "provider_rate_limited" : "provider_evidence_renewal_failed",
          evidence: { unresolvedIdentity: { providerId: row.providerId, marketCode: row.marketCode, errorCode: row.errorCode, sourceSymbol: row.sourceSymbol } },
        });
        await refreshProviderOperationProgressFromOutcomes(app, operation.id);
        throw err;
      }
      await refreshProviderOperationProgressFromOutcomes(app, operation.id);
      await throwIfProviderOperationStopped(app, operation);
  }
  return { succeeded, skipped, scanned };
}

async function completeProviderRenewEvidenceOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  let result: Awaited<ReturnType<typeof renewProviderFixerEvidence>>;
  try {
    result = await renewProviderFixerEvidence(app, operation);
  } catch (err) {
    if (err instanceof ProviderOperationStoppedError) {
      const stopped = await returnStoppedProviderOperationIfStopped(
        app,
        err.operation,
        context,
        `renew_stopped provider=${err.operation.providerId} market=${err.operation.marketCode} phase=${err.operation.phase}`,
        { succeeded: 0, skipped: 0, scanned: 0 },
      );
      return stopped ?? {
        operation: providerFixerOperationToDto(err.operation, context.guardrails),
        result: { status: err.operation.phase },
      };
    }
    const message = err instanceof Error ? err.message : "Provider evidence renewal failed.";
    const isRateLimited = err instanceof RateLimitedError;
    const latestMetadata = asRecord((await app.persistence.getProviderOperation(operation.id))?.metadata) ?? asRecord(operation.metadata) ?? {};
    const interrupted = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: isRateLimited ? "paused" : "failed",
      completedAt: isRateLimited ? null : new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        progressPercent: 0,
        pauseReason: isRateLimited ? "paused_rate_limit" : undefined,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : undefined,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: interrupted.id,
      phase: interrupted.phase,
      level: isRateLimited ? "warning" : "error",
      message: `${isRateLimited ? "renew_auto_paused_rate_limited" : "renew_failed"} provider=${interrupted.providerId} market=${interrupted.marketCode} reason=${message}`,
      context: {
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        errorCode: interrupted.errorCode,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: interrupted.id,
        action: isRateLimited ? "renew_auto_pause" : "renew_failed",
        providerId: interrupted.providerId,
        marketCode: interrupted.marketCode,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await refreshProviderOperationProgressFromOutcomes(app, interrupted.id);
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: interrupted.id,
      providerId: interrupted.providerId,
      phase: interrupted.phase,
      pauseReason: isRateLimited ? "paused_rate_limit" : null,
    });
    if (!isRateLimited) {
      await maybeStartNextQueuedProviderOperation(app, interrupted.providerId, interrupted.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
    }
    if (context.throwOnFailure) {
      if (isRateLimited) {
        throw routeError(503, "provider_rate_limited", message);
      }
      throw err;
    }
    return {
      operation: providerFixerOperationToDto(interrupted, context.guardrails),
      result: { status: interrupted.phase, errorMessage: message },
    };
  }
  const outcomeProgress = await refreshProviderOperationProgressFromOutcomes(app, operation.id);
  const completed = await app.persistence.updateProviderOperation({
    id: operation.id,
    phase: "completed",
    completedAt: new Date().toISOString(),
    metadata: {
      ...(asRecord(outcomeProgress?.metadata) ?? asRecord(operation.metadata) ?? {}),
      progressPercent: 100,
      renewedEvidenceCount: result.succeeded,
      skippedEvidenceCount: result.skipped,
      scannedRowCount: result.scanned,
    },
  });
  await app.persistence.createProviderOperationLog({
    operationId: completed.id,
    phase: "completed",
    level: result.skipped > 0 ? "warning" : "info",
    message: `renew_completed provider=${completed.providerId} market=${completed.marketCode} renewed=${result.succeeded} skipped=${result.skipped} scanned=${result.scanned}`,
    context: { providerId: completed.providerId, marketCode: completed.marketCode, ...result },
  });
  await app.persistence.appendAuditLog({
    actorUserId: context.actorUserId,
    action: "provider_fixer_operation",
    ipAddress: context.ipAddress,
    metadata: {
      operationId: completed.id,
      action: "renew_evidence",
      providerId: completed.providerId,
      marketCode: completed.marketCode,
      ...result,
    },
  });
  await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
    operationId: completed.id,
    providerId: completed.providerId,
    phase: completed.phase,
  });
  await publishProviderOperationProgress(app, context.actorUserId, {
    operationId: completed.id,
    providerId: completed.providerId,
    processed: result.succeeded + result.skipped,
    total: result.scanned,
    progressPercent: 100,
  });
  await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
    actorUserId: context.actorUserId,
    ipAddress: context.ipAddress,
    guardrails: context.guardrails,
  });
  return { operation: providerFixerOperationToDto(completed, context.guardrails), result };
}

async function completeProviderRerunBackfillOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  const metadata = asRecord(operation.metadata) ?? {};
  const sourceSymbol = stringField(metadata.mappingSourceSymbol);
  const resolvedSymbol = stringField(metadata.mappingResolvedSymbol);
  if (!sourceSymbol || !resolvedSymbol) {
    const message = "Provider rerun operation is missing mapping metadata.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: { ...metadata, progressPercent: 100, failureReason: message },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `rerun_failed provider=${operation.providerId} market=${operation.marketCode} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, errorMessage: message },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) {
      throw routeError(400, "provider_rerun_metadata_missing", message);
    }
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }

  await app.persistence.upsertProviderOperationOutcome({
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    sourceSymbol,
    providerSymbol: resolvedSymbol,
    action: "rerun_backfill",
    state: "running",
    message: "Enqueuing provider backfill rerun.",
    evidence: {
      resolvedSymbol,
      resolverMode: operation.resolverMode ?? null,
    },
  });

  try {
    await throwIfProviderOperationStopped(app, operation);
    const backfills = await enqueueProviderFixerBackfills(app, operation, [sourceSymbol]);
    const succeeded = backfills.enqueued > 0;
    const state = succeeded ? "succeeded" : "skipped";
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "rerun_backfill",
      state,
      message: succeeded
        ? `Queued backfill rerun for ${sourceSymbol}.`
        : `Backfill rerun for ${sourceSymbol} was skipped because a matching job already exists or the queue is unavailable.`,
      errorCode: succeeded ? null : "backfill_rerun_skipped_existing_or_unavailable",
      evidence: backfills,
    });
    const completedAt = new Date().toISOString();
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt,
      metadata: {
        ...metadata,
        progressPercent: 100,
        enqueuedBackfillCount: backfills.enqueued,
        skippedExistingBackfillCount: backfills.skippedExisting,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: succeeded ? "info" : "warning",
      message: `rerun_completed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} enqueued_backfills=${backfills.enqueued} skipped_existing=${backfills.skippedExisting}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, resolvedSymbol, backfills },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "rerun_backfill",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        backfills,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: completed.phase,
    });
    await publishProviderOperationProgress(app, context.actorUserId, {
      operationId: operation.id,
      providerId: operation.providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    return { operation: providerFixerOperationToDto(completed, context.guardrails), result: { status: "completed", backfills } };
  } catch (err) {
    if (err instanceof ProviderOperationStoppedError) {
      const stopped = await returnStoppedProviderOperationIfStopped(
        app,
        err.operation,
        context,
        `rerun_stopped provider=${err.operation.providerId} market=${err.operation.marketCode} phase=${err.operation.phase}`,
        { sourceSymbol, resolvedSymbol },
      );
      return stopped ?? {
        operation: providerFixerOperationToDto(err.operation, context.guardrails),
        result: { status: err.operation.phase, sourceSymbol, resolvedSymbol },
      };
    }
    const message = err instanceof Error ? err.message : "Provider backfill rerun failed.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        progressPercent: 100,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
      },
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "rerun_backfill",
      state: "failed",
      message,
      errorCode: "provider_rerun_backfill_failed",
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `rerun_failed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, errorMessage: message },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) throw err;
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }
}

function runProviderFixerOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderFixerOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderFixerOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_operation_background_execution_failed",
      );
    });
  });
}

function runProviderPreviewPreparationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
): void {
  setImmediate(() => {
    void (async () => {
      const frozenItems = providerFixerFrozenSelectedItemsFromMetadata(operation.metadata);
      const scopeItems = await listProviderUnresolvedScopeItems(app, operation.providerId, {
        type: "selected_items",
        items: frozenItems,
      });
      const latest = await app.persistence.getProviderOperation(operation.id);
      if (latest?.phase === "cancelled") {
        return;
      }
      const sample = (
        await buildProviderFixerEvidenceSample(
          app,
          operation.providerId,
          operation.marketCode,
          scopeItems,
          operation.resolverMode ?? "quote_first",
          context.guardrails.previewSampleLimit,
          { verifyCandidate: false },
        )
      ).sample;
      const refreshed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "preview",
        sample,
        metadata: {
          ...(asRecord(latest?.metadata) ?? asRecord(operation.metadata) ?? {}),
          progressPercent: 100,
        },
      });
      await app.persistence.createProviderOperationLog({
        operationId: refreshed.id,
        phase: "preview",
        level: "info",
        message: `preview_ready provider=${refreshed.providerId} market=${refreshed.marketCode} matched=${refreshed.matchCount ?? 0} sample=${sample.length}`,
        context: { providerId: refreshed.providerId, marketCode: refreshed.marketCode, matchCount: refreshed.matchCount ?? 0 },
      });
      await publishProviderOperationProgress(app, context.actorUserId, {
        operationId: refreshed.id,
        providerId: refreshed.providerId,
        processed: sample.length,
        total: Math.max(refreshed.matchCount ?? sample.length, sample.length),
        progressPercent: 100,
      });
      await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
        operationId: refreshed.id,
        providerId: refreshed.providerId,
        phase: refreshed.phase,
      });
    })().catch(async (err) => {
      const message = err instanceof Error ? err.message : "Provider preview preparation failed.";
      const failed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "failed",
        completedAt: new Date().toISOString(),
        metadata: {
          ...(asRecord(operation.metadata) ?? {}),
          progressPercent: 100,
          failureReason: message,
        },
      });
      await app.persistence.createProviderOperationLog({
        operationId: failed.id,
        phase: "failed",
        level: "error",
        message: `preview_preparation_failed provider=${failed.providerId} market=${failed.marketCode} reason=${message}`,
        context: { providerId: failed.providerId, marketCode: failed.marketCode, errorMessage: message },
      });
      await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
        operationId: failed.id,
        providerId: failed.providerId,
        phase: failed.phase,
      });
      app.log.error({ operationId: operation.id, providerId: operation.providerId, err }, "provider_preview_preparation_failed");
    });
  });
}

function runProviderRenewEvidenceOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderRenewEvidenceOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderRenewEvidenceOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_renew_evidence_background_failed",
      );
    });
  });
}

function runProviderRerunBackfillOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderRerunBackfillOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderRerunBackfillOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_rerun_backfill_background_failed",
      );
    });
  });
}

async function completeProviderMappingReverifyOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  const metadata = asRecord(operation.metadata) ?? {};
  const sourceSymbol = stringField(metadata.mappingSourceSymbol);
  const resolvedSymbol = stringField(metadata.mappingResolvedSymbol);
  const resolverMode = operation.resolverMode ?? "quote_first";
  if (!sourceSymbol || !resolvedSymbol) {
    const message = "Provider mapping reverify operation is missing mapping metadata.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        progressPercent: 100,
        failureReason: message,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `reverify_failed provider=${operation.providerId} market=${operation.marketCode} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, errorMessage: message },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "reverify_failed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        errorMessage: message,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) {
      throw routeError(400, "provider_mapping_reverify_metadata_missing", message);
    }
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }

  await app.persistence.upsertProviderOperationOutcome({
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    sourceSymbol,
    providerSymbol: resolvedSymbol,
    action: "reverify_mapping",
    state: "running",
    message: "Reverifying durable provider mapping.",
    evidence: { previousVerifiedAt: metadata.mappingPreviousVerifiedAt ?? null },
  });

  try {
    const mapping = await app.persistence.getProviderResolutionMapping(operation.providerId, operation.marketCode, sourceSymbol);
    await reserveProviderOperationBudget(app, operation, 1);
    const verification = await verifyProviderFixerCandidate(
      app,
      operation.providerId,
      operation.marketCode,
      sourceSymbol,
      resolvedSymbol,
      resolverMode,
    );
    if (!verification.verified) {
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        providerSymbol: resolvedSymbol,
        action: "reverify_mapping",
        state: "failed",
        message: `Mapping verification failed for ${resolvedSymbol}: ${verification.reason ?? "unknown"}.`,
        errorCode: verification.reason ?? "provider_mapping_reverify_failed",
        evidence: { checkedSymbol: verification.checkedSymbol, resolverMode: verification.resolverMode },
      });
      const failed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "failed",
        completedAt: new Date().toISOString(),
        metadata: {
          ...metadata,
          progressPercent: 100,
          failureReason: verification.reason ?? "provider_mapping_reverify_failed",
        },
      });
      await app.persistence.createProviderOperationLog({
        operationId: operation.id,
        phase: "failed",
        level: "warning",
        message: `reverify_failed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${verification.reason ?? "unknown"}`,
        context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, verification },
      });
      await app.persistence.appendAuditLog({
        actorUserId: context.actorUserId,
        action: "provider_fixer_operation",
        ipAddress: context.ipAddress,
        metadata: {
          operationId: operation.id,
          action: "reverify_failed",
          providerId: operation.providerId,
          marketCode: operation.marketCode,
          sourceSymbol,
          resolvedSymbol,
          reason: verification.reason ?? "provider_mapping_reverify_failed",
        },
      });
      await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId: operation.providerId,
        phase: failed.phase,
      });
      await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
      if (context.throwOnFailure) {
        throw routeError(502, "provider_mapping_reverify_failed", verification.reason ?? "Provider mapping verification failed");
      }
      return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", verification } };
    }

    const verifiedAt = new Date().toISOString();
    await app.persistence.upsertProviderResolutionMapping({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      resolvedSymbol,
      resolverMode,
      evidence: {
        ...(mapping?.evidence ?? {}),
        reverifiedAt: verifiedAt,
        reverifiedByOperationId: operation.id,
        checkedSymbol: verification.checkedSymbol,
        resolverMode: verification.resolverMode,
      },
      verifiedAt,
      verifiedByUserId: context.actorUserId,
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "reverify_mapping",
      state: "succeeded",
      message: `Reverified ${sourceSymbol} -> ${resolvedSymbol}.`,
      evidence: { checkedSymbol: verification.checkedSymbol, resolverMode: verification.resolverMode },
    });
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt: verifiedAt,
      metadata: { ...metadata, progressPercent: 100 },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: "info",
      message: `reverify_completed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${resolvedSymbol}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, resolvedSymbol },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "reverify_completed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: completed.phase,
    });
    await publishProviderOperationProgress(app, context.actorUserId, {
      operationId: operation.id,
      providerId: operation.providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    return { operation: providerFixerOperationToDto(completed, context.guardrails), result: { status: "completed", verification } };
  } catch (err) {
    if (err instanceof ProviderOperationStoppedError) {
      const stopped = await returnStoppedProviderOperationIfStopped(
        app,
        err.operation,
        context,
        `reverify_stopped provider=${err.operation.providerId} market=${err.operation.marketCode} phase=${err.operation.phase}`,
        { sourceSymbol, resolvedSymbol },
      );
      return stopped ?? {
        operation: providerFixerOperationToDto(err.operation, context.guardrails),
        result: { status: err.operation.phase, sourceSymbol, resolvedSymbol },
      };
    }
    const isRateLimited = err instanceof RateLimitedError;
    const message = err instanceof Error ? err.message : "Provider mapping reverify failed.";
    const latestMetadata = asRecord((await app.persistence.getProviderOperation(operation.id))?.metadata) ?? metadata;
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "reverify_mapping",
      state: isRateLimited ? "rate_limited" : "failed",
      message,
      errorCode: isRateLimited ? "provider_rate_limited" : "provider_mapping_reverify_failed",
    });
    const interrupted = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: isRateLimited ? "paused" : "failed",
      completedAt: isRateLimited ? null : new Date().toISOString(),
      metadata: {
        ...latestMetadata,
        progressPercent: 100,
        pauseReason: isRateLimited ? "paused_rate_limit" : undefined,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : undefined,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: interrupted.phase,
      level: isRateLimited ? "warning" : "error",
      message: `${isRateLimited ? "reverify_auto_paused_rate_limited" : "reverify_failed"} provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, errorMessage: message },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: isRateLimited ? "reverify_auto_pause" : "reverify_failed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
        msUntilAvailable: isRateLimited ? err.msUntilAvailable : null,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: interrupted.phase,
      pauseReason: isRateLimited ? "paused_rate_limit" : null,
    });
    if (!isRateLimited) {
      await maybeStartNextQueuedProviderOperation(app, interrupted.providerId, interrupted.marketCode, {
        actorUserId: context.actorUserId,
        ipAddress: context.ipAddress,
        guardrails: context.guardrails,
      });
    }
    if (context.throwOnFailure) {
      if (isRateLimited) {
        throw routeError(503, "provider_rate_limited", message);
      }
      throw err;
    }
    return {
      operation: providerFixerOperationToDto(interrupted, context.guardrails),
      result: { status: interrupted.phase, errorMessage: message },
    };
  }
}

function runProviderMappingReverifyOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderMappingReverifyOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderMappingReverifyOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_mapping_reverify_background_failed",
      );
    });
  });
}

function providerMappingRevertConfirmationText(sourceSymbol: string): string {
  return `REVERT ${sourceSymbol.trim().toUpperCase()}`;
}

async function completeProviderMappingRevertOperation(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
    throwOnFailure: boolean;
  },
): Promise<{ operation: ProviderFixerDashboardOperationDto; result: Record<string, unknown> }> {
  const metadata = asRecord(operation.metadata) ?? {};
  const sourceSymbol = stringField(metadata.mappingSourceSymbol);
  const resolvedSymbol = stringField(metadata.mappingResolvedSymbol);
  if (!sourceSymbol || !resolvedSymbol) {
    const message = "Provider mapping revert operation is missing mapping metadata.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: { ...metadata, progressPercent: 100, failureReason: message },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `revert_failed provider=${operation.providerId} market=${operation.marketCode} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, errorMessage: message },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) {
      throw routeError(400, "provider_mapping_revert_metadata_missing", message);
    }
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }

  await app.persistence.upsertProviderOperationOutcome({
    operationId: operation.id,
    providerId: operation.providerId,
    marketCode: operation.marketCode,
    sourceSymbol,
    providerSymbol: resolvedSymbol,
    action: "revert_mapping",
    state: "running",
    message: "Removing durable provider mapping.",
    evidence: { previousEvidence: metadata.mappingPreviousEvidence ?? null },
  });

  try {
    await throwIfProviderOperationStopped(app, operation);
    const deleted = await app.persistence.deleteProviderResolutionMapping({
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
    });
    const state = deleted ? "succeeded" : "skipped";
    const message = deleted
      ? `Reverted ${sourceSymbol} -> ${resolvedSymbol}.`
      : `Mapping ${sourceSymbol} -> ${resolvedSymbol} was already absent.`;
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "revert_mapping",
      state,
      message,
      evidence: {
        deletedMapping: deleted
          ? {
              resolvedSymbol: deleted.resolvedSymbol,
              resolverMode: deleted.resolverMode,
              verifiedAt: deleted.verifiedAt,
              evidence: deleted.evidence,
            }
          : null,
      },
    });
    const completedAt = new Date().toISOString();
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt,
      metadata: {
        ...metadata,
        progressPercent: 100,
        revertedMappingCount: deleted ? 1 : 0,
        skippedMappingCount: deleted ? 0 : 1,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "completed",
      level: deleted ? "warning" : "info",
      message: `revert_completed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${resolvedSymbol} deleted=${deleted ? 1 : 0}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, resolvedSymbol, deleted: Boolean(deleted) },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "revert_mapping",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        deleted: Boolean(deleted),
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: completed.phase,
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_mapping_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      resolvedSymbol,
      action: "revert_mapping",
    });
    await publishProviderOperationProgress(app, context.actorUserId, {
      operationId: operation.id,
      providerId: operation.providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await maybeStartNextQueuedProviderOperation(app, completed.providerId, completed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    return {
      operation: providerFixerOperationToDto(completed, context.guardrails),
      result: { status: "completed", deleted: Boolean(deleted) },
    };
  } catch (err) {
    if (err instanceof ProviderOperationStoppedError) {
      const stopped = await returnStoppedProviderOperationIfStopped(
        app,
        err.operation,
        context,
        `revert_stopped provider=${err.operation.providerId} market=${err.operation.marketCode} phase=${err.operation.phase}`,
        { sourceSymbol, resolvedSymbol },
      );
      return stopped ?? {
        operation: providerFixerOperationToDto(err.operation, context.guardrails),
        result: { status: err.operation.phase, sourceSymbol, resolvedSymbol },
      };
    }
    const message = err instanceof Error ? err.message : "Provider mapping revert failed.";
    const failed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "failed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...metadata,
        progressPercent: 100,
        failureReason: message,
        failureName: err instanceof Error ? err.name : "UnknownError",
      },
    });
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      sourceSymbol,
      providerSymbol: resolvedSymbol,
      action: "revert_mapping",
      state: "failed",
      message,
      errorCode: "provider_mapping_revert_failed",
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "failed",
      level: "error",
      message: `revert_failed provider=${operation.providerId} market=${operation.marketCode} source_symbol=${sourceSymbol} reason=${message}`,
      context: { providerId: operation.providerId, marketCode: operation.marketCode, sourceSymbol, errorMessage: message },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "revert_mapping_failed",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        sourceSymbol,
        resolvedSymbol,
        errorName: err instanceof Error ? err.name : "UnknownError",
        errorMessage: message,
      },
    });
    await app.eventBus.publishEvent(context.actorUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: failed.phase,
    });
    await maybeStartNextQueuedProviderOperation(app, failed.providerId, failed.marketCode, {
      actorUserId: context.actorUserId,
      ipAddress: context.ipAddress,
      guardrails: context.guardrails,
    });
    if (context.throwOnFailure) throw err;
    return { operation: providerFixerOperationToDto(failed, context.guardrails), result: { status: "failed", errorMessage: message } };
  }
}

function runProviderMappingRevertOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: Omit<Parameters<typeof completeProviderMappingRevertOperation>[2], "throwOnFailure">,
): void {
  setImmediate(() => {
    void completeProviderMappingRevertOperation(app, operation, { ...context, throwOnFailure: false }).catch((err) => {
      app.log.error(
        {
          operationId: operation.id,
          providerId: operation.providerId,
          err,
        },
        "provider_mapping_revert_background_failed",
      );
    });
  });
}

function runProviderOperationInBackground(
  app: FastifyInstance,
  operation: ProviderOperationRecord,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
): void {
  if (operation.operationType === "renew_evidence") {
    runProviderRenewEvidenceOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "rerun_backfill") {
    runProviderRerunBackfillOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "reverify_mapping") {
    runProviderMappingReverifyOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "revert_mapping") {
    runProviderMappingRevertOperationInBackground(app, operation, context);
    return;
  }
  if (operation.operationType === "resolver_repair" || operation.operationType === "repair_mapping") {
    runProviderFixerOperationInBackground(app, operation, {
      ...context,
      dangerous: providerFixerOperationToDto(operation, context.guardrails).dangerous,
    });
  }
}

async function maybeStartNextQueuedProviderOperation(
  app: FastifyInstance,
  providerId: string,
  marketCode: MarketCode,
  context: {
    actorUserId: string;
    ipAddress?: string;
    guardrails: ProviderFixerDashboardGuardrailSettingsDto;
  },
): Promise<ProviderOperationRecord | null> {
  const now = Date.now();
  const active = (
    await app.persistence.listProviderOperations({
      providerId,
      marketCode,
      phases: ["preparing_preview", "preview", "running", "paused"],
      page: 1,
      limit: 50,
    })
  ).items.find((row) => !isExpiredProviderOperationPreview(row, now)) ?? null;
  if (active) return null;
  const queued = await app.persistence.listProviderOperations({
    providerId,
    marketCode,
    phases: ["queued"],
    page: 1,
    limit: 50,
  });
  const next = queued.items.sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
  if (!next) return null;
  const startedAt = new Date().toISOString();
  const actorUserId = next.actorUserId ?? context.actorUserId;
  const running = await app.persistence.updateProviderOperation({
    id: next.id,
    phase: "running",
    startedAt,
    metadata: {
      ...(asRecord(next.metadata) ?? {}),
      progressPercent: 0,
      queuedUntilStart: startedAt,
    },
  });
  await app.persistence.createProviderOperationLog({
    operationId: running.id,
    phase: "running",
    level: "info",
    message: `queued_operation_started provider=${running.providerId} market=${running.marketCode} operation_type=${running.operationType}`,
    context: {
      providerId: running.providerId,
      marketCode: running.marketCode,
      operationType: running.operationType,
    },
  });
  await app.persistence.appendAuditLog({
    actorUserId,
    action: "provider_fixer_operation",
    ipAddress: context.ipAddress,
    metadata: {
      operationId: running.id,
      action: "queued_operation_started",
      providerId: running.providerId,
      marketCode: running.marketCode,
      operationType: running.operationType,
    },
  });
  await app.eventBus.publishEvent(actorUserId, "provider_operation_phase_changed", {
    operationId: running.id,
    providerId: running.providerId,
    phase: running.phase,
  });
  runProviderOperationInBackground(app, running, { ...context, actorUserId });
  return running;
}

function registerProviderFixerAdminRoutes(app: FastifyInstance): void {
  const providerConsoleParamsSchema = z.object({
    providerId: providerFixerProviderSchema,
  });
  const providerConsoleOperationParamsSchema = providerConsoleParamsSchema.extend({
    operationId: z.string().trim().min(1).max(120),
  });

  async function loadProviderOperationSummary(req: FastifyRequest): Promise<ProviderFixerDashboardSummaryResponse> {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const config = await loadAppConfigDto(app);
    await pauseStaleProviderOperations(app, config.effectiveProviderOperationStaleHeartbeatMinutes, { actorUserId: sessionUserId, ipAddress });
    const guardrails = providerFixerGuardrailsFromConfig(config);
    return providerFixerSummary(app, guardrails, config);
  }

  async function loadProviderDiagnostics(
    req: FastifyRequest,
    providerIdOverride?: string,
  ): Promise<ProviderFixerDashboardDiagnosticsResponse> {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerIdOverride
          ? providerFixerProviderSchema.optional()
          : providerFixerProviderSchema.default("yahoo-finance-kr"),
        marketCode: providerFixerMarketCodeSchema.optional(),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        errorCode: providerFixerErrorCodeSchema.default("yahoo_finance_kr_symbol_unresolved"),
      })
      .parse(req.query ?? {});
    const providerId = providerIdOverride ?? query.providerId ?? "yahoo-finance-kr";
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    return providerFixerDiagnostics(
      app,
      guardrails,
      providerId,
      providerFixerMarketCode(providerId, query.marketCode),
      query.resolverMode,
      query.errorCode,
    );
  }

  async function createProviderOperationPreview(
    req: FastifyRequest,
    reply: FastifyReply,
    providerIdOverride?: string,
  ) {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = providerIdOverride
      ? providerFixerPreviewBodySchema.partial({ providerId: true }).parse(req.body ?? {})
      : providerFixerPreviewBodySchema.parse(req.body ?? {});
    const providerId = providerIdOverride ?? body.providerId ?? "yahoo-finance-kr";
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const defaultMarketCode = providerFixerMarketCodeField(body.marketCode, providerFixerMarketCode(providerId));
    const scope = body.scope ?? {
      type: "filter",
      marketCode: defaultMarketCode,
      errorCode: body.errorCode,
      state: "active",
    } satisfies ProviderFixerScopeInput;
    const selectedScopeMarketCodes = scope.type === "selected_items"
      ? [...new Set(scope.items.map((item) => item.marketCode))]
      : [];
    if (selectedScopeMarketCodes.length > 1) {
      throw routeError(400, "provider_scope_market_mismatch", "Selected scope items must belong to a single market");
    }
    const requestedMarketCode = scope.type === "selected_items"
      ? selectedScopeMarketCodes[0] ?? defaultMarketCode
      : providerFixerMarketCode(providerId, scope.marketCode ?? defaultMarketCode);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: requestedMarketCode });
    if (activeOperation) {
      throw routeError(
        409,
        "provider_fixer_active_operation_conflict",
        "Another provider operation is already active for this provider and market",
        { blockingOperation: providerOperationBlockerDto(activeOperation) },
      );
    }
    const scopeItems = await listProviderUnresolvedScopeItems(app, providerId, scope);
    const scopeMarketCodes = [...new Set(scopeItems.map((item) => item.marketCode))];
    const marketCode = scopeMarketCodes[0] ?? requestedMarketCode;
    const scopeErrorCodes = [...new Set(scopeItems.map((item) => item.errorCode))];
    const operationErrorCode = scope.type === "filter"
      ? scope.errorCode
      : scopeErrorCodes.length === 1
        ? scopeErrorCodes[0]!
        : body.errorCode;
    const scopeSnapshot = await buildProviderFixerScopeSnapshot(app, providerId, marketCode, scope, scopeItems);
    const token = newProviderFixerToken();
    const dangerous = scopeSnapshot.matchCount >= guardrails.dangerousMatchThreshold;
    const initialPhase: ProviderOperationPhase = dangerous && scope.type === "filter" ? "preparing_preview" : "preview";
    const sample = initialPhase === "preview"
      ? (await buildProviderFixerEvidenceSample(
          app,
          providerId,
          marketCode,
          scopeItems,
          body.resolverMode,
          guardrails.previewSampleLimit,
          { verifyCandidate: false },
        )).sample
      : [];
    const confirmationText = dangerous
      ? scope.type === "filter"
        ? `EXECUTE ${scopeSnapshot.matchCount} MATCHING`
        : `EXECUTE ${scopeSnapshot.matchCount} SELECTED`
      : null;
    const scopeLabel = providerFixerScopeLabel(scope, providerId);
    const scopeSummary = providerFixerScopeSummary(scope, scopeSnapshot.matchCount);
    const now = Date.now();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode,
      operationType: "resolver_repair",
      phase: initialPhase,
      errorCode: operationErrorCode,
      resolverMode: body.resolverMode,
      scopeQuery: scopeLabel,
      snapshotHash: scopeSnapshot.snapshotHash,
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: new Date(now + guardrails.previewTokenTtlSeconds * 1000).toISOString(),
      matchCount: scopeSnapshot.matchCount,
      sample,
      metadata: {
        previewTokenDisplay: token,
        confirmationText,
        effectiveRateCapPerMinute,
        autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
        scope,
        frozenScope: providerFixerFrozenScopeMetadata(providerId, scope, scopeItems),
        scopeType: scope.type,
        scopeFingerprint: providerFixerScopeFingerprint(scope),
        scopeSummary,
        scopeSearch: scope.type === "filter" ? scope.search?.trim() || null : null,
        scopeState: scope.type === "filter" ? scope.state : "active",
        progressPercent: initialPhase === "preparing_preview" ? 0 : null,
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: scopeSnapshot.matchCount > 0 ? "info" : "warning",
      message: `${initialPhase === "preparing_preview" ? "preparing_preview" : "preview"} provider=${providerId} market=${marketCode} error_code=${operationErrorCode ?? "mixed"} scope=${scope.type} matched=${scopeSnapshot.matchCount} sample=${sample.length}`,
      context: {
        providerId,
        marketCode,
        errorCode: operationErrorCode,
        resolverMode: body.resolverMode,
        scope,
        scopeFingerprint: providerFixerScopeFingerprint(scope),
        dangerous,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: "preview",
        providerId,
        marketCode,
        errorCode: operationErrorCode,
        resolverMode: body.resolverMode,
        scope,
        scopeFingerprint: providerFixerScopeFingerprint(scope),
        matchCount: scopeSnapshot.matchCount,
        dangerous,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (initialPhase === "preparing_preview") {
      runProviderPreviewPreparationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
      reply.code(202);
      return { operation: providerFixerOperationToDto(operation, guardrails), result: { status: "preparing_preview" } };
    }
    reply.code(201);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  }

  app.get("/providers/:providerId/operations/summary", async (req) => {
    providerConsoleParamsSchema.parse(req.params);
    return loadProviderOperationSummary(req);
  });

  app.get("/providers/:providerId/diagnostics", (req) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return loadProviderDiagnostics(req, providerId);
  });

  app.post("/providers/:providerId/operations/renew", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        errorCode: providerFixerErrorCodeSchema.default("symbol_unresolved"),
        scope: providerFixerScopeSchema.optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const capability = listProviderOperationCapabilities([providerId])[0];
    if (!capability?.actions.some((action) => action.action === "renew_evidence" && action.supported)) {
      throw routeError(400, "provider_operation_not_supported", "Renew evidence is not supported for this provider");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const marketCode = providerFixerMarketCodeField(body.marketCode, providerFixerMarketCode(providerId));
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const scope = body.scope ?? {
      type: "filter",
      marketCode,
      errorCode: body.errorCode,
      state: "active",
    } satisfies ProviderFixerScopeInput;
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const scopeItems = await listProviderUnresolvedScopeItems(app, providerId, scope);
    const sample = scopeItems.slice(0, guardrails.previewSampleLimit).map((row): ProviderFixerDashboardEvidenceSampleDto => ({
      symbol: row.sourceSymbol.replace(/\.(KS|KQ)$/i, "").toUpperCase(),
      providerSymbol: row.providerSymbol ?? row.sourceSymbol,
      candidateSymbol: null,
      exchangeHint: null,
      verificationStatus: "pending",
      note: "Renew evidence pending.",
    }));
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode,
      operationType: "renew_evidence",
      phase: initialPhase,
      errorCode: body.errorCode,
      resolverMode: body.resolverMode,
      scopeQuery: providerFixerScopeLabel(scope, providerId),
      snapshotHash: hashProviderFixerToken(`${providerId}:${marketCode}:${providerFixerScopeFingerprint(scope)}:renew:${scopeItems.length}:${Date.now()}`).slice(0, 12),
      matchCount: scopeItems.length,
      sample,
      metadata: {
        progressPercent: 0,
        previewSampleLimit: guardrails.previewSampleLimit,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
        scope,
        scopeType: scope.type === "selected_items" && scope.items.length === 1 ? "row" : scope.type,
        scopeFingerprint: providerFixerScopeFingerprint(scope),
        scopeSummary: providerFixerScopeSummary(scope, scopeItems.length),
        scopeSearch: scope.type === "filter" ? scope.search?.trim() || null : null,
        scopeState: "active",
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "renew_queued" : "renew_started"} provider=${providerId} market=${marketCode} error_code=${body.errorCode} scope=${scope.type} matched=${scopeItems.length}`,
      context: { providerId, marketCode, errorCode: body.errorCode, resolverMode: body.resolverMode, queuedBehindOperationId: activeOperation?.id ?? null, scopeType: scope.type },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "renew_evidence_queued" : "renew_evidence_started",
        providerId,
        marketCode,
        errorCode: body.errorCode,
        resolverMode: body.resolverMode,
        matchCount: scopeItems.length,
        queuedBehindOperationId: activeOperation?.id ?? null,
        scopeType: scope.type,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderRenewEvidenceOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails), result: { status: activeOperation ? "queued" : "started" } };
  });

  app.get("/providers/:providerId/unresolved", async (req): Promise<ProviderUnresolvedItemsResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        state: z.enum(["all", "active", "resolved", "unsupported", "ignored"]).default("active"),
        errorCode: providerFixerErrorCodeSchema.optional(),
        search: z.string().trim().max(120).optional(),
        sort: z.enum(["last_seen_desc", "updated_desc", "source_symbol_asc", "occurrence_count_desc"]).default("last_seen_desc"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderUnresolvedItems({
      providerId,
      marketCode: query.marketCode,
      state: query.state,
      errorCode: query.errorCode,
      search: query.search,
      sort: query.sort,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: await Promise.all(result.items.map(async (item) => ({
        providerId: item.providerId,
        marketCode: item.marketCode as ProviderUnresolvedItemDto["marketCode"],
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        providerSymbol: item.providerSymbol,
        state: item.state,
        severity: item.severity,
        occurrenceCount: item.occurrenceCount,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        lastErrorTrailId: item.lastErrorTrailId,
        evidence: item.evidence,
        resolvedAt: item.resolvedAt,
        resolvedByOperationId: item.resolvedByOperationId,
        latestOperationOutcome: await latestProviderRepairOutcomeForUnresolvedItem(app, item),
        updatedAt: item.updatedAt,
      }))),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.post("/providers/:providerId/unresolved/state", async (req): Promise<ProviderUnresolvedItemUpdateResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        errorCode: providerFixerErrorCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        state: z.enum(["active", "unsupported", "ignored"]),
        reason: z.string().trim().max(240).optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const action = body.state === "active" ? "reopen_unresolved" : body.state === "ignored" ? "ignore_unresolved" : "mark_unsupported";
    const startedAt = new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: action,
      phase: "running",
      errorCode: body.errorCode,
      scopeQuery: `${providerId}:unresolved:${action}:${body.sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${body.errorCode}:${body.sourceSymbol}:${body.state}`).slice(0, 12),
      previewTokenHash: null,
      previewExpiresAt: null,
      matchCount: 1,
      sample: [],
      metadata: {
        sourceSymbol: body.sourceSymbol,
        targetState: body.state,
        reason: body.reason ?? null,
        progressPercent: 0,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    let item: Awaited<ReturnType<typeof app.persistence.updateProviderUnresolvedItemState>>;
    try {
      item = await app.persistence.updateProviderUnresolvedItemState({
        providerId,
        marketCode: body.marketCode,
        errorCode: body.errorCode,
        sourceSymbol: body.sourceSymbol,
        state: body.state,
        actorUserId: sessionUserId,
        reason: body.reason ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Provider unresolved lifecycle update failed.";
      const failed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "failed",
        completedAt: new Date().toISOString(),
        metadata: {
          ...(asRecord(operation.metadata) ?? {}),
          progressPercent: 100,
          failureReason: message,
          failureName: err instanceof Error ? err.name : "UnknownError",
        },
      });
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId,
        marketCode: body.marketCode,
        sourceSymbol: body.sourceSymbol,
        providerSymbol: body.sourceSymbol,
        action,
        state: "failed",
        message,
        errorCode: "provider_unresolved_state_update_failed",
        evidence: { targetState: body.state, reason: body.reason ?? null },
      });
      await app.persistence.createProviderOperationLog({
        operationId: operation.id,
        phase: failed.phase,
        level: "error",
        message: `${action}_failed provider=${providerId} market=${body.marketCode} source_symbol=${body.sourceSymbol} reason=${message}`,
        context: { providerId, marketCode: body.marketCode, errorCode: body.errorCode, sourceSymbol: body.sourceSymbol, errorMessage: message },
      });
      await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId,
        phase: failed.phase,
      });
      throw err;
    }
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId,
      marketCode: item.marketCode,
      sourceSymbol: item.sourceSymbol,
      providerSymbol: item.providerSymbol,
      action,
      state: "succeeded",
      message: `Set unresolved item ${item.sourceSymbol} to ${item.state}.`,
      evidence: { targetState: item.state, reason: body.reason ?? null },
    });
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 100,
        completedState: item.state,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: completed.phase,
      level: item.state === "unsupported" ? "warning" : "info",
      message: `${action}_completed provider=${providerId} market=${item.marketCode} source_symbol=${item.sourceSymbol} state=${item.state}`,
      context: { providerId, marketCode: item.marketCode, errorCode: item.errorCode, sourceSymbol: item.sourceSymbol, state: item.state, reason: body.reason ?? null },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: completed.phase,
    });
    await publishProviderOperationProgress(app, sessionUserId, {
      operationId: operation.id,
      providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action,
        providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        state: item.state,
        reason: body.reason ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_unresolved_item_changed", {
      providerId,
      marketCode: item.marketCode,
      errorCode: item.errorCode,
      sourceSymbol: item.sourceSymbol,
      state: item.state,
    });
    return {
      item: {
        providerId: item.providerId,
        marketCode: item.marketCode as ProviderUnresolvedItemDto["marketCode"],
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
        providerSymbol: item.providerSymbol,
        state: item.state,
        severity: item.severity,
        occurrenceCount: item.occurrenceCount,
        firstSeenAt: item.firstSeenAt,
        lastSeenAt: item.lastSeenAt,
        lastErrorTrailId: item.lastErrorTrailId,
        evidence: item.evidence,
        resolvedAt: item.resolvedAt,
        resolvedByOperationId: item.resolvedByOperationId,
        updatedAt: item.updatedAt,
      },
    };
  });

  app.post("/providers/:providerId/unresolved/state/bulk", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        scope: providerFixerScopeSchema,
        state: z.enum(["unsupported", "ignored"]),
        acknowledged: z.boolean().optional(),
        typedConfirmation: z.string().trim().max(160).optional(),
        reason: z.string().trim().max(240).optional(),
      })
      .strict()
      .parse(req.body ?? {});
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const scopeItems = await listProviderUnresolvedScopeItems(app, providerId, body.scope);
    const matchCount = scopeItems.length;
    if (matchCount === 0) {
      throw routeError(409, "provider_scope_items_not_active", "No active unresolved rows match this scope");
    }
    const dangerous = matchCount >= guardrails.dangerousMatchThreshold || body.scope.type === "filter";
    const confirmationText = providerBulkUnresolvedStateConfirmationText(body.state, body.scope, matchCount);
    if (dangerous) {
      if (body.typedConfirmation?.trim() !== confirmationText) {
        throw routeError(400, "provider_fixer_typed_confirmation_required", "Bulk unresolved state change requires matching typed confirmation");
      }
    } else if (body.acknowledged !== true) {
      throw routeError(400, "provider_fixer_acknowledgement_required", "Bulk unresolved state change requires explicit acknowledgement");
    }
    const action = body.state === "ignored" ? "ignore_unresolved" : "mark_unsupported";
    const marketCode = providerFixerMarketCodeField(scopeItems[0]?.marketCode, providerFixerMarketCode(providerId));
    const duplicateOutcomeSourceSymbols = duplicateProviderUnresolvedOutcomeSourceSymbols(scopeItems);
    const startedAt = new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode,
      operationType: action,
      phase: "running",
      errorCode: body.scope.type === "filter" ? body.scope.errorCode : scopeItems[0]?.errorCode ?? null,
      scopeQuery: providerFixerScopeLabel(body.scope, providerId),
      snapshotHash: hashProviderFixerToken(`${providerId}:${providerFixerScopeFingerprint(body.scope)}:${body.state}:${matchCount}`).slice(0, 12),
      previewTokenHash: null,
      previewExpiresAt: null,
      matchCount,
      sample: scopeItems.slice(0, guardrails.previewSampleLimit).map((item): ProviderFixerDashboardEvidenceSampleDto => ({
        symbol: item.sourceSymbol,
        providerSymbol: item.providerSymbol ?? item.sourceSymbol,
        candidateSymbol: null,
        exchangeHint: null,
        verificationStatus: "pending",
        note: `Bulk ${body.state} scope item.`,
      })),
      metadata: {
        confirmationText: dangerous ? confirmationText : null,
        frozenScope: providerFixerFrozenScopeMetadata(providerId, body.scope, scopeItems),
        scope: body.scope,
        scopeType: body.scope.type,
        scopeFingerprint: providerFixerScopeFingerprint(body.scope),
        scopeSummary: providerFixerScopeSummary(body.scope, matchCount),
        targetState: body.state,
        reason: body.reason ?? null,
        progressPercent: 0,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    let succeeded = 0;
    let failed = 0;
    for (const item of scopeItems) {
      try {
        const updated = await app.persistence.updateProviderUnresolvedItemState({
          providerId,
          marketCode: providerFixerMarketCodeField(item.marketCode, marketCode),
          errorCode: item.errorCode,
          sourceSymbol: item.sourceSymbol,
          state: body.state,
          actorUserId: sessionUserId,
          reason: body.reason ?? null,
        });
        succeeded += 1;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId,
          marketCode: updated.marketCode,
          sourceSymbol: providerUnresolvedOutcomeSourceSymbol(updated, duplicateOutcomeSourceSymbols),
          providerSymbol: updated.providerSymbol,
          action,
          state: "succeeded",
          message: `Set unresolved item ${updated.sourceSymbol} to ${updated.state}.`,
          evidence: providerUnresolvedOutcomeEvidence(updated, { targetState: updated.state, reason: body.reason ?? null }),
        });
        await app.eventBus.publishEvent(sessionUserId, "provider_unresolved_item_changed", {
          providerId,
          marketCode: updated.marketCode,
          errorCode: updated.errorCode,
          sourceSymbol: updated.sourceSymbol,
          state: updated.state,
        });
      } catch (err) {
        failed += 1;
        const message = err instanceof Error ? err.message : "Provider unresolved lifecycle update failed.";
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId,
          marketCode: item.marketCode,
          sourceSymbol: providerUnresolvedOutcomeSourceSymbol(item, duplicateOutcomeSourceSymbols),
          providerSymbol: item.providerSymbol ?? item.sourceSymbol,
          action,
          state: "failed",
          message,
          errorCode: "provider_unresolved_state_update_failed",
          evidence: providerUnresolvedOutcomeEvidence(item, { targetState: body.state, reason: body.reason ?? null }),
        });
      }
      await publishProviderOperationProgress(app, sessionUserId, {
        operationId: operation.id,
        providerId,
        processed: succeeded + failed,
        total: matchCount,
        progressPercent: Math.round(((succeeded + failed) / Math.max(matchCount, 1)) * 100),
      });
    }
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: failed > 0 ? "failed" : "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 100,
        succeeded,
        failed,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: completed.phase,
      level: failed > 0 ? "error" : body.state === "unsupported" ? "warning" : "info",
      message: `${action}_bulk_${completed.phase} provider=${providerId} scope=${body.scope.type} state=${body.state} succeeded=${succeeded} failed=${failed}`,
      context: { providerId, scope: body.scope, state: body.state, succeeded, failed, reason: body.reason ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: `${action}_bulk`,
        providerId,
        scope: body.scope,
        matchCount,
        state: body.state,
        succeeded,
        failed,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: completed.phase,
    });
    reply.code(202);
    return {
      operation: providerFixerOperationToDto(completed, guardrails),
      result: { status: completed.phase, updatedCount: succeeded, succeeded, failed },
    };
  });

  app.get("/providers/:providerId/incidents", async (req): Promise<ProviderIncidentsResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        status: z.enum(["open", "acknowledged", "resolved", "ignored"]).optional(),
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderIncidents({
      providerId,
      marketCode: query.marketCode,
      status: query.status,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map((incident): ProviderIncidentDto => ({
        id: incident.id,
        providerId: incident.providerId,
        marketCode: incident.marketCode as ProviderIncidentDto["marketCode"],
        incidentKey: incident.incidentKey,
        status: incident.status,
        severity: incident.severity,
        title: incident.title,
        summary: incident.summary,
        errorClass: incident.errorClass,
        errorCode: incident.errorCode,
        occurrenceCount: incident.occurrenceCount,
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        lastErrorTrailId: incident.lastErrorTrailId,
        linkedOperationId: incident.linkedOperationId,
        metadata: incident.metadata,
        acknowledgedAt: incident.acknowledgedAt,
        acknowledgedByUserId: incident.acknowledgedByUserId,
        resolvedAt: incident.resolvedAt,
        resolvedByUserId: incident.resolvedByUserId,
        ignoredAt: incident.ignoredAt,
        ignoredByUserId: incident.ignoredByUserId,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.patch("/providers/:providerId/incidents/:incidentId", async (req): Promise<{ incident: ProviderIncidentDto }> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const { incidentId } = z.object({ incidentId: z.string().trim().min(1).max(120) }).parse(req.params);
    const body = z
      .object({
        status: z.enum(["open", "acknowledged", "resolved", "ignored"]),
      })
      .parse(req.body);
    const incident = await app.persistence.updateProviderIncidentStatus({
      providerId,
      incidentId,
      status: body.status,
      actorUserId: sessionUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      metadata: {
        targetType: "provider_incident",
        targetId: incident.id,
        providerId,
        incidentId: incident.id,
        incidentKey: incident.incidentKey,
        status: body.status,
      },
      ipAddress,
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_incident_changed", {
      providerId,
      incidentId: incident.id,
      status: incident.status,
    });
    return {
      incident: {
        id: incident.id,
        providerId: incident.providerId,
        marketCode: incident.marketCode as ProviderIncidentDto["marketCode"],
        incidentKey: incident.incidentKey,
        status: incident.status,
        severity: incident.severity,
        title: incident.title,
        summary: incident.summary,
        errorClass: incident.errorClass,
        errorCode: incident.errorCode,
        occurrenceCount: incident.occurrenceCount,
        firstSeenAt: incident.firstSeenAt,
        lastSeenAt: incident.lastSeenAt,
        lastErrorTrailId: incident.lastErrorTrailId,
        linkedOperationId: incident.linkedOperationId,
        metadata: incident.metadata,
        acknowledgedAt: incident.acknowledgedAt,
        acknowledgedByUserId: incident.acknowledgedByUserId,
        resolvedAt: incident.resolvedAt,
        resolvedByUserId: incident.resolvedByUserId,
        ignoredAt: incident.ignoredAt,
        ignoredByUserId: incident.ignoredByUserId,
        createdAt: incident.createdAt,
        updatedAt: incident.updatedAt,
      },
    };
  });

  app.get("/providers/:providerId/mappings", async (req): Promise<ProviderResolutionMappingsResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        marketCode: providerFixerMarketCodeSchema.optional(),
        search: z.string().trim().max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderResolutionMappings({
      providerId,
      marketCode: query.marketCode,
      search: query.search,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map((mapping): ProviderResolutionMappingDto => ({
        providerId: mapping.providerId,
        marketCode: mapping.marketCode as ProviderResolutionMappingDto["marketCode"],
        sourceSymbol: mapping.sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        resolverMode: mapping.resolverMode as ProviderResolutionMappingDto["resolverMode"],
        evidence: mapping.evidence,
        verifiedAt: mapping.verifiedAt,
        verifiedByUserId: mapping.verifiedByUserId,
        createdAt: mapping.createdAt,
        updatedAt: mapping.updatedAt,
      })),
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.post("/providers/:providerId/mappings/reverify", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        resolvedSymbol: z.string().trim().min(1).max(80).optional(),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
      })
      .strict()
      .parse(req.body ?? {});
    const sourceSymbol = body.sourceSymbol.trim().toUpperCase();
    const mapping = await app.persistence.getProviderResolutionMapping(providerId, body.marketCode, sourceSymbol);
    if (!mapping) {
      throw routeError(404, "provider_resolution_mapping_not_found", "Provider resolution mapping not found");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: body.marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: "reverify_mapping",
      phase: initialPhase,
      resolverMode: body.resolverMode,
      scopeQuery: `${providerId}:${body.marketCode}:${sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${sourceSymbol}:${mapping.resolvedSymbol}:${Date.now()}`).slice(0, 12),
      matchCount: 1,
      sample: [{
        symbol: mapping.sourceSymbol,
        providerSymbol: mapping.sourceSymbol,
        candidateSymbol: mapping.resolvedSymbol,
        exchangeHint: "durable provider_resolution_mappings row",
        verificationStatus: "pending",
        note: "Reverify existing durable provider mapping.",
      }],
      metadata: {
        progressPercent: 0,
        mappingSourceSymbol: mapping.sourceSymbol,
        mappingResolvedSymbol: mapping.resolvedSymbol,
        mappingPreviousVerifiedAt: mapping.verifiedAt,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "reverify_queued" : "reverify_started"} provider=${providerId} market=${body.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${mapping.resolvedSymbol}`,
      context: { providerId, marketCode: body.marketCode, sourceSymbol, resolvedSymbol: mapping.resolvedSymbol, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "reverify_mapping_queued" : "reverify_mapping",
        providerId,
        marketCode: body.marketCode,
        sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderMappingReverifyOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  });

  app.post("/providers/:providerId/mappings/revert", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        resolvedSymbol: z.string().trim().min(1).max(80).optional(),
        typedConfirmation: z.string().trim().min(1).max(120),
      })
      .strict()
      .parse(req.body ?? {});
    const sourceSymbol = body.sourceSymbol.trim().toUpperCase();
    const confirmationText = providerMappingRevertConfirmationText(sourceSymbol);
    if (body.typedConfirmation.trim() !== confirmationText) {
      throw routeError(400, "provider_mapping_revert_confirmation_required", "Revert requires the exact typed confirmation phrase");
    }
    const mapping = await app.persistence.getProviderResolutionMapping(providerId, body.marketCode, sourceSymbol);
    if (!mapping) {
      throw routeError(404, "provider_resolution_mapping_not_found", "Provider resolution mapping not found");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: body.marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: "revert_mapping",
      phase: initialPhase,
      resolverMode: mapping.resolverMode,
      scopeQuery: `${providerId}:${body.marketCode}:${sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${sourceSymbol}:${mapping.resolvedSymbol}:${Date.now()}`).slice(0, 12),
      matchCount: 1,
      sample: [{
        symbol: mapping.sourceSymbol,
        providerSymbol: mapping.resolvedSymbol,
        candidateSymbol: null,
        exchangeHint: "durable provider_resolution_mappings row",
        verificationStatus: "pending",
        note: "Revert existing durable provider mapping.",
      }],
      metadata: {
        progressPercent: 0,
        confirmationText,
        mappingSourceSymbol: mapping.sourceSymbol,
        mappingResolvedSymbol: mapping.resolvedSymbol,
        mappingPreviousVerifiedAt: mapping.verifiedAt,
        mappingPreviousEvidence: mapping.evidence,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "warning",
      message: `${activeOperation ? "revert_queued" : "revert_started"} provider=${providerId} market=${body.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${mapping.resolvedSymbol}`,
      context: { providerId, marketCode: body.marketCode, sourceSymbol, resolvedSymbol: mapping.resolvedSymbol, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "revert_mapping_queued" : "revert_mapping_started",
        providerId,
        marketCode: body.marketCode,
        sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderMappingRevertOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails) };
  });

  app.post("/providers/:providerId/mappings/rerun", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        marketCode: providerFixerMarketCodeSchema,
        sourceSymbol: z.string().trim().min(1).max(80),
        resolverMode: providerFixerResolverModeSchema.default("quote_first"),
        acknowledged: z.literal(true),
      })
      .strict()
      .parse(req.body ?? {});
    const sourceSymbol = body.sourceSymbol.trim().toUpperCase();
    const mapping = await app.persistence.getProviderResolutionMapping(providerId, body.marketCode, sourceSymbol);
    if (!mapping) {
      throw routeError(404, "provider_resolution_mapping_not_found", "Provider resolution mapping not found");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(providerId, config);
    const activeOperation = await findOtherActiveProviderOperationExecution(app, { providerId, marketCode: body.marketCode });
    const initialPhase: ProviderOperationPhase = activeOperation ? "queued" : "running";
    const startedAt = activeOperation ? null : new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: body.marketCode,
      operationType: "rerun_backfill",
      phase: initialPhase,
      resolverMode: body.resolverMode,
      scopeQuery: `${providerId}:${body.marketCode}:${sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${providerId}:${body.marketCode}:${sourceSymbol}:${mapping.resolvedSymbol}:rerun:${Date.now()}`).slice(0, 12),
      matchCount: 1,
      sample: [{
        symbol: mapping.sourceSymbol,
        providerSymbol: mapping.resolvedSymbol,
        candidateSymbol: mapping.resolvedSymbol,
        exchangeHint: "durable provider_resolution_mappings row",
        verificationStatus: "verified",
        note: "Rerun mapped provider backfill.",
      }],
      metadata: {
        progressPercent: 0,
        mappingSourceSymbol: mapping.sourceSymbol,
        mappingResolvedSymbol: mapping.resolvedSymbol,
        mappingPreviousVerifiedAt: mapping.verifiedAt,
        effectiveRateCapPerMinute,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
      actorUserId: sessionUserId,
      startedAt,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: initialPhase,
      level: "info",
      message: `${activeOperation ? "rerun_queued" : "rerun_started"} provider=${providerId} market=${body.marketCode} source_symbol=${sourceSymbol} resolved_symbol=${mapping.resolvedSymbol}`,
      context: { providerId, marketCode: body.marketCode, sourceSymbol, resolvedSymbol: mapping.resolvedSymbol, queuedBehindOperationId: activeOperation?.id ?? null },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: activeOperation ? "rerun_backfill_queued" : "rerun_backfill_started",
        providerId,
        marketCode: body.marketCode,
        sourceSymbol,
        resolvedSymbol: mapping.resolvedSymbol,
        queuedBehindOperationId: activeOperation?.id ?? null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId,
      phase: operation.phase,
    });
    if (!activeOperation) {
      runProviderRerunBackfillOperationInBackground(app, operation, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
      });
    }
    reply.code(202);
    return { operation: providerFixerOperationToDto(operation, guardrails), result: { status: activeOperation ? "queued" : "started" } };
  });

  app.get("/providers/:providerId/activity", async (req): Promise<ProviderActivityResponse> => {
    requireAdminRole(req);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const query = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const fetchLimit = Math.max(query.limit, 50);
    const [incidents, operations, unresolved, mappings] = await Promise.all([
      app.persistence.listProviderIncidents({ providerId, page: 1, limit: fetchLimit }),
      app.persistence.listProviderOperations({ providerId, page: 1, limit: fetchLimit }),
      app.persistence.listProviderUnresolvedItems({ providerId, page: 1, limit: fetchLimit }),
      app.persistence.listProviderResolutionMappings({ providerId, page: 1, limit: fetchLimit }),
    ]);
    const operationLogs = (
      await Promise.all(
        operations.items.map((operation) =>
          app.persistence.listProviderOperationLogs({ operationId: operation.id, page: 1, limit: 10 }),
        ),
      )
    ).flatMap((result) => result.items);
    const items: ProviderActivityItemDto[] = [
      ...incidents.items.map((incident): ProviderActivityItemDto => ({
        id: `incident:${incident.id}`,
        providerId: incident.providerId,
        kind: "incident",
        occurredAt: incident.updatedAt,
        title: `Incident ${incident.status}`,
        detail: incident.title,
        refId: incident.id,
      })),
      ...operations.items.map((operation): ProviderActivityItemDto => ({
        id: `operation:${operation.id}`,
        providerId: operation.providerId,
        kind: "operation",
        occurredAt: operation.updatedAt,
        title: `Operation ${operation.phase}`,
        detail: operation.operationType,
        refId: operation.id,
      })),
      ...operationLogs.map((log): ProviderActivityItemDto => ({
        id: `log:${log.id}`,
        providerId,
        kind: "log",
        occurredAt: log.createdAt,
        title: `Log ${log.phase}`,
        detail: log.message,
        refId: log.operationId,
      })),
      ...unresolved.items.map((item): ProviderActivityItemDto => ({
        id: `unresolved:${item.providerId}:${item.marketCode}:${item.errorCode}:${item.sourceSymbol}`,
        providerId: item.providerId,
        kind: "unresolved",
        occurredAt: item.updatedAt,
        title: `Unresolved ${item.state}`,
        detail: `${item.sourceSymbol} ${item.errorCode}`,
        refId: item.lastErrorTrailId == null ? null : String(item.lastErrorTrailId),
      })),
      ...mappings.items.map((mapping): ProviderActivityItemDto => ({
        id: `mapping:${mapping.providerId}:${mapping.marketCode}:${mapping.sourceSymbol}`,
        providerId: mapping.providerId,
        kind: "mapping",
        occurredAt: mapping.updatedAt,
        title: "Mapping verified",
        detail: `${mapping.sourceSymbol} -> ${mapping.resolvedSymbol}`,
        refId: mapping.sourceSymbol,
      })),
    ].sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const offset = (query.page - 1) * query.limit;
    return {
      items: items.slice(offset, offset + query.limit),
      total: items.length,
      page: query.page,
      limit: query.limit,
    };
  });

  app.post("/providers/:providerId/operations/preview", (req, reply) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return createProviderOperationPreview(req, reply, providerId);
  });

  async function executeProviderFixerOperation(
    req: FastifyRequest,
    operationId: string,
    body: z.infer<typeof providerFixerOperationBodySchema>,
    providerIdOverride?: string,
    options: { background?: boolean } = {},
  ) {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const existing = await app.persistence.getProviderOperation(operationId);
    if (!existing) throw routeError(404, "provider_operation_not_found", "Provider operation not found");
    if (providerIdOverride && existing.providerId !== providerIdOverride) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
    }
    const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
    const operationDto = providerFixerOperationToDto(existing, guardrails);
    if (existing.phase === "preparing_preview") {
      throw routeError(409, "provider_preview_still_preparing", "Preview is still preparing; wait for the frozen scope preview to finish");
    }
    if (existing.phase !== "preview" && existing.phase !== "staged") {
      throw routeError(400, "provider_operation_not_executable", "Selected operation cannot be executed");
    }
    assertProviderFixerPreviewToken(existing, body.previewToken);
    if (body.acknowledged !== true) {
      throw routeError(400, "provider_fixer_acknowledgement_required", "Execution requires explicit acknowledgement");
    }
    if (operationDto.dangerous && body.typedConfirmation !== operationDto.preview.confirmationText) {
      throw routeError(400, "provider_fixer_typed_confirmation_required", "Dangerous operation requires matching typed confirmation");
    }
    if (!asRecord(asRecord(existing.metadata)?.frozenScope)) {
      throw routeError(409, "provider_legacy_preview_stale", "Legacy previews cannot execute; create a new scoped preview");
    }
    const scope = providerFixerScopeFromMetadata(existing.providerId, existing.metadata, {
      marketCode: providerFixerMarketCodeField(existing.marketCode, providerFixerMarketCode(existing.providerId)),
      errorCode: existing.errorCode,
    });
    const scopeItems = await listProviderUnresolvedScopeItems(app, existing.providerId, scope);
    const currentScope = await buildProviderFixerScopeSnapshot(
      app,
      existing.providerId,
      existing.marketCode,
      scope,
      scopeItems,
    );
    if (currentScope.matchCount !== (existing.matchCount ?? 0) || currentScope.snapshotHash !== existing.snapshotHash) {
      throw routeError(409, "provider_fixer_snapshot_drift", "Provider fixer scope changed; run preview again");
    }
    const activeOperation = await findOtherActiveProviderOperationExecution(app, {
      providerId: existing.providerId,
      marketCode: existing.marketCode,
      operationId: existing.id,
    });
    if (activeOperation) {
      throw routeError(
        409,
        "provider_fixer_active_operation_conflict",
        "Another provider operation is already active for this provider and market",
        { blockingOperation: providerOperationBlockerDto(activeOperation) },
      );
    }
    const initialPhase: ProviderOperationPhase = "running";

    const running = await app.persistence.updateProviderOperation({
      id: existing.id,
      phase: initialPhase,
      actorUserId: sessionUserId,
      startedAt: activeOperation ? null : new Date().toISOString(),
      metadata: {
        ...(asRecord(existing.metadata) ?? {}),
        progressPercent: 0,
        queuedBehindOperationId: null,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: running.id,
      phase: initialPhase,
      level: "info",
      message: `execute_started provider=${running.providerId} market=${running.marketCode} matched=${running.matchCount ?? 0}`,
      context: {
        providerId: running.providerId,
        marketCode: running.marketCode,
        errorCode: running.errorCode,
        queuedBehindOperationId: null,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: running.id,
      providerId: running.providerId,
      phase: running.phase,
    });

    if (options.background) {
      runProviderFixerOperationInBackground(app, running, {
        actorUserId: sessionUserId,
        ipAddress,
        guardrails,
        dangerous: operationDto.dangerous,
      });
      return {
        operation: providerFixerOperationToDto(running, guardrails),
        result: {
          status: "started",
          applied: 0,
          skipped: 0,
          scanned: 0,
          mappedTickers: [],
          backfills: { enqueued: 0, skippedExisting: 0 },
        },
      };
    }

    return completeProviderFixerOperation(app, running, {
      actorUserId: sessionUserId,
      ipAddress,
      guardrails,
      dangerous: operationDto.dangerous,
      throwOnFailure: true,
    });
  }

  app.post("/providers/:providerId/operations/:operationId/execute", async (req, reply) => {
    const params = providerConsoleOperationParamsSchema.parse(req.params);
    const body = providerFixerOperationBodySchema.partial({ operationId: true }).parse(req.body ?? {});
    const response = await executeProviderFixerOperation(
      req,
      params.operationId,
      { ...body, operationId: params.operationId },
      params.providerId,
      { background: true },
    );
    reply.code(202);
    return response;
  });

  for (const [action, from, to] of [
    ["pause", "running", "paused"],
    ["resume", "paused", "running"],
    ["cancel", null, "cancelled"],
  ] as const) {
    app.post(`/providers/:providerId/operations/:operationId/${action}`, async (req) => {
      requireAdminRole(req);
      const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
      const { providerId, operationId } = providerConsoleOperationParamsSchema.parse(req.params);
      const existing = await app.persistence.getProviderOperation(operationId);
      if (!existing || existing.providerId !== providerId) {
        throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
      }
      if (from && existing.phase !== from) {
        throw routeError(400, `provider_operation_not_${action}able`, `Selected operation cannot be ${action}d`);
      }
      if (action === "cancel" && !["preparing_preview", "preview", "staged", "queued", "running", "paused"].includes(existing.phase)) {
        throw routeError(400, "provider_operation_not_cancellable", "Selected operation cannot be cancelled");
      }
      if (
        action === "resume" &&
        !providerOperationSupportsPauseResume(existing.operationType)
      ) {
        throw routeError(400, "provider_operation_resume_not_supported", "Resume is not supported for this provider operation type");
      }
      if (action === "resume") {
        await assertNoOtherProviderOperationExecution(app, {
          providerId: existing.providerId,
          marketCode: existing.marketCode,
          operationId: existing.id,
        });
      }
      const updated = await app.persistence.updateProviderOperation({
        id: operationId,
        phase: to,
        ...(action === "cancel" ? { cancelledAt: new Date().toISOString() } : {}),
      });
      await app.persistence.createProviderOperationLog({
        operationId,
        phase: to,
        level: action === "resume" ? "info" : "warning",
        message: `${action}d provider=${updated.providerId} market=${updated.marketCode}`,
        context: { providerId: updated.providerId, marketCode: updated.marketCode },
      });
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "provider_fixer_operation",
        ipAddress,
        metadata: { operationId, action, providerId: updated.providerId, marketCode: updated.marketCode },
      });
      const guardrails = providerFixerGuardrailsFromConfig(await loadAppConfigDto(app));
      const operationDto = providerFixerOperationToDto(updated, guardrails);
      await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
        operationId,
        providerId: updated.providerId,
        phase: updated.phase,
      });
      if (action === "cancel") {
        await maybeStartNextQueuedProviderOperation(app, updated.providerId, updated.marketCode, {
          actorUserId: sessionUserId,
          ipAddress,
          guardrails,
        });
      }
      if (action === "resume") {
        if (updated.operationType === "renew_evidence") {
          runProviderRenewEvidenceOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "rerun_backfill") {
          runProviderRerunBackfillOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "reverify_mapping") {
          runProviderMappingReverifyOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "revert_mapping") {
          runProviderMappingRevertOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
          });
        } else if (updated.operationType === "resolver_repair" || updated.operationType === "repair_mapping") {
          runProviderFixerOperationInBackground(app, updated, {
            actorUserId: sessionUserId,
            ipAddress,
            guardrails,
            dangerous: operationDto.dangerous,
          });
        }
      }
      return { operation: operationDto };
    });
  }

  app.post("/providers/:providerId/operations/:operationId/retry", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId, operationId } = providerConsoleOperationParamsSchema.parse(req.params);
    const existing = await app.persistence.getProviderOperation(operationId);
    if (!existing || existing.providerId !== providerId) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
    }
    if (!["paused", "failed", "cancelled", "completed"].includes(existing.phase)) {
      throw routeError(400, "provider_operation_not_retryable", "Selected operation cannot be retried yet");
    }
    if (
      existing.providerId === "yahoo-finance-kr"
      && (
        existing.operationType === "repair_mapping"
        || existing.operationType === "resolver_repair"
        || existing.operationType === "reverify_mapping"
        || existing.operationType === "revert_mapping"
      )
    ) {
      throw routeError(400, "provider_operation_not_retryable", "KR mapping operations must use resume or dedicated mapping actions");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const effectiveRateCapPerMinute = providerOperationRateCapPerMinute(existing.providerId, config);
    const matchCount = existing.matchCount ?? 0;
    const dangerous = matchCount >= guardrails.dangerousMatchThreshold;
    const token = newProviderFixerToken();
    const retryAttempt = (numberField(asRecord(existing.metadata)?.retryAttempt) ?? 0) + 1;
    const operation = await app.persistence.createProviderOperation({
      providerId: existing.providerId,
      marketCode: existing.marketCode,
      operationType: existing.operationType,
      phase: "preview",
      errorCode: existing.errorCode,
      resolverMode: existing.resolverMode,
      scopeQuery: existing.scopeQuery,
      snapshotHash: hashProviderFixerToken(`${existing.id}:retry:${retryAttempt}:${Date.now()}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: new Date(Date.now() + guardrails.previewTokenTtlSeconds * 1000).toISOString(),
      matchCount,
      sample: existing.sample,
      metadata: {
        previewTokenDisplay: token,
        confirmationText: dangerous ? `EXECUTE ${matchCount}` : null,
        retryOfOperationId: existing.id,
        retryAttempt,
        effectiveRateCapPerMinute,
        autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "preview",
      level: "info",
      message: `retry_created provider=${operation.providerId} market=${operation.marketCode} retry_of=${existing.id}`,
      context: {
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        retryOfOperationId: existing.id,
        retryAttempt,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: "retry",
        providerId: operation.providerId,
        marketCode: operation.marketCode,
        retryOfOperationId: existing.id,
        retryAttempt,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      operationId: operation.id,
      providerId: operation.providerId,
      phase: operation.phase,
      retryOfOperationId: existing.id,
    });
    reply.code(201);
    return { operation: providerFixerOperationToDto(operation, guardrails), retryOfOperationId: existing.id };
  });

  async function listProviderOperations(
    req: FastifyRequest,
    providerIdOverride?: string,
  ): Promise<ProviderFixerDashboardOperationsResponse> {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerFixerProviderSchema.optional(),
        marketCode: providerFixerMarketCodeSchema.optional(),
        phase: providerFixerPhaseSchema.optional(),
        includeOperationId: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const providerId = providerIdOverride ?? query.providerId;
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const config = await loadAppConfigDto(app);
    await pauseStaleProviderOperations(app, config.effectiveProviderOperationStaleHeartbeatMinutes, { actorUserId: sessionUserId, ipAddress });
    const result = await app.persistence.listProviderOperations({
      providerId,
      marketCode: query.marketCode,
      phases: query.phase ? [query.phase as ProviderOperationPhase] : undefined,
      includeOperationId: query.includeOperationId,
      page: query.page,
      limit: query.limit,
    });
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const selectedOperationRecord = query.includeOperationId
      ? result.items.find((operation) => operation.id === query.includeOperationId)
        ?? await app.persistence.getProviderOperation(query.includeOperationId)
      : null;
    const selectedOperation = selectedOperationRecord
      && (!providerId || selectedOperationRecord.providerId === providerId)
      && (!query.marketCode || selectedOperationRecord.marketCode === query.marketCode)
      && (!query.phase || selectedOperationRecord.phase === query.phase)
        ? providerFixerOperationToDto(selectedOperationRecord, guardrails)
        : null;
    const operations = result.items
      .filter((operation) => operation.id !== query.includeOperationId)
      .map((operation) => providerFixerOperationToDto(operation, guardrails));
    const stagedOperation = operations.find((operation) => operation.phase === "preview" || operation.phase === "staged")
      ?? (selectedOperation && (selectedOperation.phase === "preview" || selectedOperation.phase === "staged") ? selectedOperation : null);
    return {
      stagedOperation,
      selectedOperation,
      operations,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  }

  app.get("/providers/:providerId/operations", (req) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return listProviderOperations(req, providerId);
  });

  app.get("/providers/:providerId/operations/:operationId/outcomes", async (req): Promise<ProviderOperationOutcomesResponse> => {
    requireAdminRole(req);
    const { providerId, operationId } = providerConsoleOperationParamsSchema.parse(req.params);
    const operation = await app.persistence.getProviderOperation(operationId);
    if (!operation || operation.providerId !== providerId) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found for this provider");
    }
    const query = z
      .object({
        state: z.enum(["all", "pending", "running", "succeeded", "failed", "skipped", "rate_limited", "cancelled"]).optional(),
        action: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const result = await app.persistence.listProviderOperationOutcomes({
      operationId,
      state: query.state === "all" ? undefined : query.state,
      action: query.action,
      page: query.page,
      limit: query.limit,
    });
    return {
      items: result.items.map(providerOperationOutcomeToDto),
      summary: result.summary,
      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  async function listProviderLogs(
    req: FastifyRequest,
    providerIdOverride?: string,
  ): Promise<ProviderFixerDashboardLogsResponse> {
    requireAdminRole(req);
    const query = z
      .object({
        providerId: providerFixerProviderSchema.optional(),
        marketCode: providerFixerMarketCodeSchema.optional(),
        operationId: z.string().trim().min(1).max(120).optional(),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(25),
      })
      .parse(req.query ?? {});
    const providerId = providerIdOverride ?? query.providerId;
    const operationIds = query.operationId
      ? [query.operationId]
      : (await app.persistence.listProviderOperations({
          providerId,
          marketCode: query.marketCode,
          page: 1,
          limit: Math.max(query.limit, 25),
        })).items.map((operation) => operation.id);
    const entries = (
      await Promise.all(operationIds.map(async (operationId) => {
        const logs = await app.persistence.listProviderOperationLogs({ operationId, page: 1, limit: query.limit });
        return logs.items.map((log): ProviderFixerDashboardLogEntryDto => ({
          id: String(log.id),
          occurredAt: log.createdAt,
          phase: log.phase,
          message: log.message,
          operationId: log.operationId,
        }));
      }))
    ).flat().sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    const offset = (query.page - 1) * query.limit;
    return {
      items: entries.slice(offset, offset + query.limit),
      total: entries.length,
      page: query.page,
      limit: query.limit,
    };
  }

  app.get("/providers/:providerId/logs", (req) => {
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    return listProviderLogs(req, providerId);
  });

  app.post("/providers/:providerId/logs/purge/preview", async (req, reply): Promise<ProviderLogPurgePreviewResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const counts = await app.persistence.countProviderLogsForPurge(providerId);
    const matchCount = counts.errorTrailCount + counts.operationLogCount;
    const token = newProviderFixerToken();
    const now = new Date();
    const tokenExpiresAt = new Date(now.getTime() + guardrails.previewTokenTtlSeconds * 1000).toISOString();
    const confirmationText = `PURGE ${providerId}`;
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: providerFixerMarketCode(providerId),
      operationType: "purge_logs",
      phase: "preview",
      errorCode: "provider_logs_purge",
      scopeQuery: `${providerId}:logs:purge`,
      snapshotHash: hashProviderFixerToken(`${providerId}:logs:${matchCount}:${now.toISOString()}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: tokenExpiresAt,
      matchCount,
      sample: [],
      metadata: {
        errorTrailCount: counts.errorTrailCount,
        operationLogCount: counts.operationLogCount,
        confirmationText,
        destructiveBoundary: "Deletes provider_error_trail rows and provider_operation_logs only.",
      },
      actorUserId: sessionUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      metadata: {
        operationId: operation.id,
        action: "purge_logs_preview",
        providerId,
        matchCount,
        errorTrailCount: counts.errorTrailCount,
        operationLogCount: counts.operationLogCount,
      },
      ipAddress,
    });
    reply.code(201);
    return {
      preview: {
        operationId: operation.id,
        providerId,
        previewToken: token,
        tokenExpiresAt,
        confirmationText,
        errorTrailCount: counts.errorTrailCount,
        operationLogCount: counts.operationLogCount,
        matchCount,
        canExecute: matchCount > 0,
        boundary: "Deletes provider_error_trail rows and provider_operation_logs only. Incidents, unresolved items, mappings, operation summaries, audit logs, and pg-boss history are retained.",
      },
    };
  });

  app.post("/providers/:providerId/logs/purge/execute", async (req): Promise<ProviderLogPurgeExecuteResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { providerId } = providerConsoleParamsSchema.parse(req.params);
    const body = z
      .object({
        operationId: z.string().trim().min(1).max(120),
        previewToken: z.string().trim().min(1).max(160),
        typedConfirmation: z.string().trim().max(160),
      })
      .strict()
      .parse(req.body ?? {});
    const operation = await app.persistence.getProviderOperation(body.operationId);
    if (!operation || operation.providerId !== providerId || operation.operationType !== "purge_logs") {
      throw routeError(404, "provider_purge_operation_not_found", "Provider purge operation not found");
    }
    if (operation.phase !== "preview" && operation.phase !== "staged") {
      throw routeError(400, "provider_purge_operation_not_executable", "Provider purge operation cannot be executed");
    }
    assertProviderFixerPreviewToken(operation, body.previewToken);
    const expectedConfirmation = `PURGE ${providerId}`;
    if (body.typedConfirmation !== expectedConfirmation) {
      throw routeError(400, "provider_purge_typed_confirmation_required", "Provider log purge requires matching typed confirmation");
    }
    const counts = await app.persistence.countProviderLogsForPurge(providerId);
    const currentMatchCount = counts.errorTrailCount + counts.operationLogCount;
    if (currentMatchCount !== (operation.matchCount ?? 0)) {
      throw routeError(409, "snapshot_changed", "Provider log purge scope changed; run purge preview again");
    }
    const running = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "running",
      startedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 0,
      },
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      providerId,
      operationId: running.id,
      phase: running.phase,
    });
    const deleted = await app.persistence.purgeProviderLogs(providerId);
    await app.persistence.upsertProviderOperationOutcome({
      operationId: running.id,
      providerId,
      marketCode: running.marketCode,
      sourceSymbol: "provider_logs",
      providerSymbol: providerId,
      action: "purge_logs",
      state: "succeeded",
      message: `Purged ${deleted.errorTrailCount} provider error rows and ${deleted.operationLogCount} operation log rows.`,
      evidence: {
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
        boundary: "provider_error_trail and provider_operation_logs only",
      },
    });
    const completed = await app.persistence.updateProviderOperation({
      id: running.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(running.metadata) ?? {}),
        progressPercent: 100,
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: completed.id,
      phase: completed.phase,
      level: "warning",
      message: `purge_logs_completed provider=${providerId} error_trail_deleted=${deleted.errorTrailCount} operation_logs_deleted=${deleted.operationLogCount}`,
      context: {
        providerId,
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
        boundary: "provider_error_trail and provider_operation_logs only",
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      metadata: {
        operationId: completed.id,
        action: "purge_logs_execute",
        providerId,
        errorTrailDeleted: deleted.errorTrailCount,
        operationLogDeleted: deleted.operationLogCount,
      },
      ipAddress,
    });
    await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
      providerId,
      operationId: completed.id,
      phase: completed.phase,
    });
    await publishProviderOperationProgress(app, sessionUserId, {
      operationId: completed.id,
      providerId,
      processed: 1,
      total: 1,
      progressPercent: 100,
    });
    return {
      operationId: completed.id,
      providerId,
      errorTrailDeleted: deleted.errorTrailCount,
      operationLogDeleted: deleted.operationLogCount,
    };
  });
}

function registerMarketDataAdminRoutes(app: FastifyInstance): void {
  const marketDataBackfillBodySchema = z
    .object({
      scope: marketDataBackfillScopeSchema,
      providerId: providerFixerProviderSchema.optional(),
      selectedCatalogRows: z.array(marketDataTargetSchema).optional(),
      selectedUnresolvedRows: z.array(z.object({
        providerId: providerFixerProviderSchema,
        marketCode: providerFixerMarketCodeSchema,
        errorCode: z.string().trim().min(1).max(120),
        sourceSymbol: z.string().trim().min(1).max(80),
      }).strict()).optional(),
      filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
      includeDemoUsers: z.boolean().optional(),
      startDate: isoDateSchema.optional(),
      endDate: isoDateSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.startDate && value.endDate && value.startDate > value.endDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDate must be before or equal to endDate",
          path: ["startDate"],
        });
      }
    });
  const marketDataBackfillExecuteBodySchema = z
    .object({
      operationId: userScopedIdSchema,
      previewToken: z.string().trim().min(1).max(80),
      acknowledged: z.boolean().optional(),
      typedConfirmation: z.string().trim().max(160).optional(),
    })
    .strict();
  const marketDataValuationRepairStatusQuerySchema = z
    .object({
      tickers: z.string().trim().min(1).max(512),
      targetDate: isoDateSchema,
      operationId: userScopedIdSchema.optional(),
    })
    .strict();

  const marketDataPurgePreviewBodySchema = z
    .object({
      providerId: providerFixerProviderSchema.optional(),
      categories: z.array(z.enum([
        "price_bars",
        "dividends",
        "backfill_jobs",
        "provider_operation_outcomes",
        "provider_error_trail",
        "provider_resolution_mappings",
        "asx_gics_enrichment",
        "admin_state_reset",
      ])).min(1),
      targets: z.array(marketDataTargetSchema).optional(),
      fullHistory: z.boolean().optional(),
      startDate: isoDateSchema.optional(),
      endDate: isoDateSchema.optional(),
      enqueueBackfillAfterPurge: z.boolean().optional(),
      filters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (value.fullHistory === false && value.startDate && value.endDate && value.startDate > value.endDate) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "startDate must be before or equal to endDate",
          path: ["startDate"],
        });
      }
    });
  const marketDataPurgeExecuteBodySchema = z
    .object({
      operationId: userScopedIdSchema,
      previewToken: z.string().trim().min(1).max(80),
      typedConfirmation: z.string().trim().min(1).max(160),
    })
    .strict();

  type MarketDataBackfillBody = z.infer<typeof marketDataBackfillBodySchema>;
  type MarketDataPurgeBody = z.infer<typeof marketDataPurgePreviewBodySchema>;
  type MarketDataWorkspaceMarketCode = Exclude<AdminMarketCode, "FX">;
  type MarketDataTarget = AdminMarketDataBackfillTargetDto & { marketCode: MarketDataWorkspaceMarketCode };
  type MarketDataBackfillPreviewDraft =
    Omit<AdminMarketDataBackfillPreviewResponse, "operationId" | "previewToken" | "tokenExpiresAt" | "targets">
    & { targets: MarketDataTarget[] };
  type MarketDataPurgePreviewDraft =
    Omit<AdminMarketDataPurgePreviewResponse, "operationId" | "previewToken" | "tokenExpiresAt">
    & {
      targets: MarketDataTarget[];
      deletedRows: number;
      fullHistory?: boolean;
      startDate?: string;
      endDate?: string;
      enqueueBackfillAfterPurge?: boolean;
    };
  const maxBackfillPreviewTargets = 5_000;

  function uniqueMarketDataTargets(targets: readonly MarketDataTarget[]): MarketDataTarget[] {
    const seen = new Set<string>();
    const out: MarketDataTarget[] = [];
    for (const target of targets) {
      const ticker = target.ticker.trim().toUpperCase();
      const key = `${ticker}|${target.marketCode}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...target, ticker, marketCode: target.marketCode });
    }
    return out;
  }

  function marketDataBackfillTargetFromInstrument(row: Awaited<ReturnType<typeof app.persistence.instrumentAdminGet>>): MarketDataTarget | null {
    if (!row) return null;
    const dto = adminInstrumentRowToMarketDataDto(row);
    return {
      ticker: dto.ticker,
      marketCode: dto.marketCode as MarketDataWorkspaceMarketCode,
      name: dto.name,
      instrumentType: dto.instrumentType,
      status: dto.status,
      supportState: dto.supportState,
      backfillStatus: dto.backfillStatus,
      providerIds: dto.providerIds,
    };
  }

  function compactBackfillTarget(target: MarketDataTarget): MarketDataTarget {
    return {
      ticker: target.ticker,
      marketCode: target.marketCode,
      name: target.name ?? null,
      instrumentType: target.instrumentType ?? null,
      status: target.status ?? null,
      supportState: target.supportState ?? null,
      backfillStatus: target.backfillStatus ?? null,
      providerIds: target.providerIds ?? [],
    };
  }

  function marketUnresolvedIdentityKey(item: {
    providerId: string;
    marketCode: string;
    errorCode: string;
    sourceSymbol: string;
  }): string {
    return [
      item.providerId,
      item.marketCode,
      item.errorCode.trim(),
      item.sourceSymbol.trim().toUpperCase(),
    ].join("::");
  }

  function marketUnresolvedSortComparator(sort: AdminMarketDataUnresolvedSort) {
    return (
      a: Awaited<ReturnType<typeof listAllProviderUnresolvedItemsForMarket>>[number],
      b: Awaited<ReturnType<typeof listAllProviderUnresolvedItemsForMarket>>[number],
    ) => {
      if (sort === "updated_desc") return b.updatedAt.localeCompare(a.updatedAt);
      if (sort === "source_symbol_asc") return a.sourceSymbol.localeCompare(b.sourceSymbol);
      if (sort === "occurrence_count_desc") {
        return b.occurrenceCount - a.occurrenceCount || b.lastSeenAt.localeCompare(a.lastSeenAt);
      }
      return b.lastSeenAt.localeCompare(a.lastSeenAt);
    };
  }

  async function marketUnresolvedItemToDto(
    item: Awaited<ReturnType<typeof listAllProviderUnresolvedItemsForMarket>>[number],
  ): Promise<AdminMarketDataUnresolvedItemDto> {
    const instrument = await app.persistence.instrumentAdminGet(item.sourceSymbol, item.marketCode);
    const instrumentDto = instrument ? adminInstrumentRowToMarketDataDto(instrument) : null;
    const latestOperationOutcome = await latestProviderRepairOutcomeForUnresolvedItem(app, item);
    const evidence = asRecord(item.evidence);
    const errorMessage = stringField(evidence?.errorMessage)?.toLowerCase() ?? "";
    const recommendedAction: AdminMarketDataUnresolvedItemDto["recommendedAction"] =
      item.state !== "active"
        ? "reopen"
        : item.marketCode === "KR"
          ? "repair_mapping"
          : errorMessage.includes("no data found") || errorMessage.includes("delisted") || errorMessage.includes("unsupported")
            ? "mark_unsupported"
            : instrumentDto?.supportState && instrumentDto.supportState !== "supported"
            ? "mark_unsupported"
            : "retry_via_backfill";
    const recommendedActionReason =
      recommendedAction === "reopen"
        ? "Inactive unresolved rows can be reopened if they should count toward provider health again."
        : recommendedAction === "repair_mapping"
          ? "KR unresolved rows need a verified Yahoo Finance mapping before backfill."
          : recommendedAction === "mark_unsupported"
            ? "Provider evidence or instrument support state suggests this row may be unavailable for this provider."
            : "Retryable provider errors should be rechecked through the guarded backfill flow.";
    return {
      providerId: item.providerId,
      marketCode: item.marketCode as AdminMarketDataUnresolvedItemDto["marketCode"],
      errorCode: item.errorCode,
      sourceSymbol: item.sourceSymbol,
      providerSymbol: item.providerSymbol,
      state: item.state,
      severity: item.severity,
      occurrenceCount: item.occurrenceCount,
      firstSeenAt: item.firstSeenAt,
      lastSeenAt: item.lastSeenAt,
      lastErrorTrailId: item.lastErrorTrailId,
      evidence: item.evidence,
      resolvedAt: item.resolvedAt,
      resolvedByOperationId: item.resolvedByOperationId,
      latestOperationOutcome,
      updatedAt: item.updatedAt,
      instrumentName: instrumentDto?.name ?? null,
      instrumentType: instrumentDto?.instrumentType ?? null,
      supportState: instrumentDto?.supportState ?? null,
      backfillStatus: instrumentDto?.backfillStatus ?? null,
      providerIds: instrumentDto?.providerIds ?? [],
      recommendedAction,
      recommendedActionReason,
    };
  }

  async function listMarketUnresolvedScopeItems(input: {
    marketCode: MarketDataWorkspaceMarketCode;
    scope: AdminMarketDataUnresolvedBulkStateRequest["scope"];
  }) {
    if (input.scope.type === "selected_items") {
      const selected = input.scope.items ?? [];
      if (selected.length === 0) return [];
      const items = await listAllProviderUnresolvedItemsForMarket({ marketCode: input.marketCode, state: "all" });
      const selectedKeys = new Set(selected.map(marketUnresolvedIdentityKey));
      return items.filter((item) => selectedKeys.has(marketUnresolvedIdentityKey(item)));
    }
    const filter = input.scope.filter ?? {};
    return listAllProviderUnresolvedItemsForMarket({
      marketCode: input.marketCode,
      providerId: filter.providerId,
      state: filter.state ?? "active",
      errorCode: filter.errorCode,
      search: filter.search,
    });
  }

  function marketBulkUnresolvedStateConfirmationText(
    state: AdminMarketDataUnresolvedBulkStateRequest["state"],
    matchCount: number,
  ): string {
    return `${state.toUpperCase()} ${matchCount}`;
  }

  function assertMarketDataProvider(marketCode: AdminMarketCode, providerId: string | undefined): string {
    const resolved = providerId ?? MARKET_DATA_WORKSPACES[marketCode].defaultBackfillProviderId ?? providerIdsForMarket(marketCode)[0];
    if (!resolved || !providerIdsForMarket(marketCode).includes(resolved)) {
      throw routeError(400, "provider_market_mismatch", "Provider does not belong to this market workspace");
    }
    return resolved;
  }

  async function ensureProviderHealthRow(providerId: string): Promise<void> {
    const existing = await app.persistence.getProviderHealthStatus(providerId);
    if (existing) return;
    await app.persistence.upsertProviderHealthStatus({ providerId, status: "healthy" });
  }

  async function allMatchingTargets(
    marketCode: MarketDataWorkspaceMarketCode,
    filters: Record<string, string | number | boolean | null> | undefined,
  ): Promise<MarketDataTarget[]> {
    const filterBackfillStatus = typeof filters?.backfillStatus === "string"
      ? filters.backfillStatus as "pending" | "backfilling" | "ready" | "failed" | "all"
      : undefined;
    const defaultBackfillStatuses: Array<"pending" | "failed"> =
      filterBackfillStatus === undefined && (marketCode === "AU" || marketCode === "KR" || marketCode === "JP")
        ? ["pending", "failed"]
        : [];
    const statuses = defaultBackfillStatuses.length > 0
      ? defaultBackfillStatuses
      : [filterBackfillStatus ?? "all"];
    const targets: MarketDataTarget[] = [];
    for (const backfillStatus of statuses) {
      let page = 1;
      while (true) {
        const result = await app.persistence.listAdminInstruments({
          marketCode,
          page,
          limit: 500,
          status: typeof filters?.status === "string" ? filters.status as "listed" | "delisted" | "excluded" | "all" : "listed",
          supportState: typeof filters?.supportState === "string"
            ? filters.supportState as AdminInstrumentSupportState | "all"
            : "supported",
          search: typeof filters?.search === "string" ? filters.search : undefined,
          instrumentType: typeof filters?.instrumentType === "string"
            ? filters.instrumentType as import("@vakwen/domain").InstrumentType | "all"
            : "all",
          backfillStatus,
          sort: "ticker_asc",
        });
        targets.push(...result.items.map((row) => compactBackfillTarget(adminInstrumentRowToMarketDataDto(row) as MarketDataTarget)));
        if (page * result.limit >= result.total) break;
        page += 1;
      }
    }
    return uniqueMarketDataTargets(targets);
  }

  async function validateExplicitTargets(
    marketCode: MarketDataWorkspaceMarketCode,
    targets: readonly MarketDataTarget[],
    options: { requireSupported: boolean },
  ): Promise<{ targets: MarketDataTarget[]; unsupportedRows: AdminMarketDataBackfillPreviewResponse["unsupportedRows"] }> {
    const valid: MarketDataTarget[] = [];
    const unsupportedRows: AdminMarketDataBackfillPreviewResponse["unsupportedRows"] = [];
    for (const target of uniqueMarketDataTargets(targets)) {
      if (target.marketCode !== marketCode) {
        throw routeError(400, "target_market_mismatch", "Backfill targets must match the route market");
      }
      const row = marketDataBackfillTargetFromInstrument(await app.persistence.instrumentAdminGet(target.ticker, target.marketCode));
      if (!row) {
        unsupportedRows.push({ ...target, reason: "Instrument is not present in the provider catalog." });
        continue;
      }
      if (row.status === "delisted") {
        unsupportedRows.push({ ...row, reason: "Instrument is delisted; undelete or select another target before backfill." });
        continue;
      }
      if (options.requireSupported && row.supportState !== "supported") {
        unsupportedRows.push({ ...row, reason: `Instrument support state is ${row.supportState}.` });
        continue;
      }
      valid.push(row);
    }
    return { targets: valid, unsupportedRows };
  }

  async function buildBackfillPreview(
    marketCode: MarketDataWorkspaceMarketCode,
    body: MarketDataBackfillBody,
  ): Promise<MarketDataBackfillPreviewDraft> {
    const providerId = assertMarketDataProvider(marketCode, body.providerId);
    let targets: MarketDataTarget[] = [];
    let unsupportedRows: AdminMarketDataBackfillPreviewResponse["unsupportedRows"] = [];
    let unresolvedSelection: AdminMarketDataBackfillUnresolvedSelectionDto | undefined;
    if (body.scope === "user_owned_or_monitored") {
      const listedTargets = (await app.persistence.listAdminMarketDataBackfillTargets({
        marketCode,
        includeDemoUsers: body.includeDemoUsers,
      })).map((target) => ({ ticker: target.ticker, marketCode: target.marketCode as MarketDataWorkspaceMarketCode }));
      const validated = await validateExplicitTargets(marketCode, listedTargets, { requireSupported: true });
      targets = validated.targets;
      unsupportedRows = validated.unsupportedRows;
    } else if (body.scope === "selected_unresolved_rows") {
      if (marketCode === "KR") {
        throw routeError(400, "market_unresolved_retry_not_supported", "KR unresolved rows must use mapping repair, not generic backfill retry");
      }
      const defaultBackfillProviderId = MARKET_DATA_WORKSPACES[marketCode].defaultBackfillProviderId;
      if (!defaultBackfillProviderId || providerId !== defaultBackfillProviderId) {
        throw routeError(
          400,
          "market_unresolved_retry_provider_not_supported",
          "Unresolved retry is only supported for the market backfill provider; use provider-specific repair for catalog or enrichment providers.",
        );
      }
      const selectedRows = body.selectedUnresolvedRows ?? [];
      if (selectedRows.length === 0) {
        throw routeError(400, "market_unresolved_rows_required", "selectedUnresolvedRows is required for unresolved retry previews");
      }
      const matchingRows = await listMarketUnresolvedScopeItems({
        marketCode,
        scope: { type: "selected_items", items: selectedRows },
      });
      const unsupportedProviderRows = matchingRows.filter((row) => row.state === "active" && row.providerId !== providerId);
      if (unsupportedProviderRows.length > 0) {
        throw routeError(
          400,
          "market_unresolved_retry_provider_not_supported",
          "Selected unresolved rows include provider-owned catalog or enrichment issues that cannot be retried through market backfill.",
        );
      }
      const activeRows = matchingRows.filter((row) => row.state === "active" && row.providerId === providerId);
      const dedupedTargets = uniqueMarketDataTargets(activeRows.map((row) => ({
        ticker: row.sourceSymbol,
        marketCode,
      })));
      const validated = await validateExplicitTargets(marketCode, dedupedTargets, { requireSupported: true });
      targets = validated.targets;
      unsupportedRows = validated.unsupportedRows;
      unresolvedSelection = {
        selectedRowCount: selectedRows.length,
        dedupedTargetCount: targets.length,
        dedupedAwayRowCount: Math.max(0, activeRows.length - dedupedTargets.length),
        skippedRowCount: Math.max(0, selectedRows.length - activeRows.length) + validated.unsupportedRows.length,
      };
    } else if (body.scope === "all_matching") {
      targets = await allMatchingTargets(marketCode, body.filters);
    } else {
      const explicitTargets = body.selectedCatalogRows ?? [];
      const validated = await validateExplicitTargets(marketCode, explicitTargets, { requireSupported: true });
      targets = validated.targets;
      unsupportedRows = validated.unsupportedRows;
    }
    if (targets.length > maxBackfillPreviewTargets) {
      throw routeError(400, "market_backfill_preview_too_large", `Backfill preview matched ${targets.length} targets; narrow filters below ${maxBackfillPreviewTargets}`);
    }
    const ownership = await app.persistence.countAdminMarketDataTargetOwnership({ targets });
    const matchCount = targets.length;
    const dangerous = body.scope === "all_matching" || matchCount >= 100;
    const dateRange = resolveBackfillDateRange(marketCode, body);
    return {
      marketCode,
      providerId,
      scope: body.scope,
      matchCount,
      affectedUserCount: ownership.userCount,
      affectedAccountCount: ownership.accountCount,
      estimatedJobCount: matchCount,
      estimatedStorageRows: matchCount === 0 ? 0 : matchCount * 2,
      dateRange,
      providerBudgetNotes: marketDataProviderBudgetNotes(marketCode, "backfill_catalog_rows"),
      unsupportedRows,
      unresolvedSelection,
      confirmation: {
        level: dangerous ? "typed" : "checkbox",
        text: dangerous ? `BACKFILL ${marketCode} ${matchCount}` : null,
        reason: dangerous ? "Broad backfill requires typed confirmation." : "Preview is required before enqueue.",
      },
      targets,
    };
  }

  function backfillPreviewMetadata(preview: MarketDataBackfillPreviewDraft, body: MarketDataBackfillBody): Record<string, unknown> {
    return {
      marketDataBff: true,
      source: "preview",
      scope: preview.scope,
      filters: body.filters ?? null,
      includeDemoUsers: body.includeDemoUsers === true,
      selectedCatalogRows: body.selectedCatalogRows?.map((target) => ({ ticker: target.ticker, marketCode: target.marketCode })) ?? null,
      selectedUnresolvedRows: body.selectedUnresolvedRows?.map((item) => ({
        providerId: item.providerId,
        marketCode: item.marketCode,
        errorCode: item.errorCode,
        sourceSymbol: item.sourceSymbol,
      })) ?? null,
      frozenBackfillTargets: preview.targets.map(compactBackfillTarget),
      unsupportedRows: preview.unsupportedRows,
      unresolvedSelection: preview.unresolvedSelection ?? null,
      estimatedStorageRows: preview.estimatedStorageRows,
      dateRange: preview.dateRange,
      affectedUserCount: preview.affectedUserCount,
      affectedAccountCount: preview.affectedAccountCount,
      providerBudgetNotes: preview.providerBudgetNotes,
      confirmationText: preview.confirmation.text,
      confirmationLevel: preview.confirmation.level,
      confirmationReason: preview.confirmation.reason,
      progressPercent: null,
    };
  }

  function backfillTargetsFromMetadata(metadata: Record<string, unknown> | null): MarketDataTarget[] {
    const rows = asRecord(metadata)?.frozenBackfillTargets;
    if (!Array.isArray(rows)) return [];
    return uniqueMarketDataTargets(rows.flatMap((item) => {
      const row = asRecord(item);
      const ticker = stringField(row?.ticker);
      const parsedMarket = providerFixerMarketCodeSchema.safeParse(row?.marketCode);
      if (!ticker || !parsedMarket.success) return [];
      return [compactBackfillTarget({
        ticker,
        marketCode: parsedMarket.data,
        name: stringField(row?.name),
        instrumentType: stringField(row?.instrumentType) as MarketDataTarget["instrumentType"],
        status: stringField(row?.status) as MarketDataTarget["status"],
        supportState: stringField(row?.supportState) as MarketDataTarget["supportState"],
        backfillStatus: stringField(row?.backfillStatus) as MarketDataTarget["backfillStatus"],
        providerIds: Array.isArray(row?.providerIds) ? row.providerIds.flatMap((providerId) => stringField(providerId) ?? []) : [],
      })];
    }));
  }

  function backfillPreviewFromOperation(operation: ProviderOperationRecord): MarketDataBackfillPreviewDraft {
    const metadata = asRecord(operation.metadata);
    const scope = marketDataBackfillScopeSchema.parse(metadata?.scope);
    const targets = backfillTargetsFromMetadata(metadata);
    const unsupportedRows = Array.isArray(metadata?.unsupportedRows)
      ? metadata.unsupportedRows.flatMap((item) => {
          const row = asRecord(item);
          const ticker = stringField(row?.ticker);
          const parsedMarket = providerFixerMarketCodeSchema.safeParse(row?.marketCode);
          const reason = stringField(row?.reason);
          if (!ticker || !parsedMarket.success || !reason) return [];
          return [{ ...compactBackfillTarget({ ticker, marketCode: parsedMarket.data as MarketDataWorkspaceMarketCode }), reason }];
        })
      : [];
    const confirmationLevel = metadata?.confirmationLevel === "typed" || metadata?.confirmationLevel === "none" ? metadata.confirmationLevel : "checkbox";
    return {
      marketCode: operation.marketCode as MarketDataWorkspaceMarketCode,
      providerId: operation.providerId,
      scope,
      matchCount: operation.matchCount ?? targets.length,
      affectedUserCount: numberField(metadata?.affectedUserCount) ?? 0,
      affectedAccountCount: numberField(metadata?.affectedAccountCount) ?? 0,
      estimatedJobCount: targets.length,
      estimatedStorageRows: numberField(metadata?.estimatedStorageRows),
      dateRange: backfillDateRangeFromMetadata(operation.marketCode as MarketDataWorkspaceMarketCode, metadata),
      providerBudgetNotes: Array.isArray(metadata?.providerBudgetNotes)
        ? metadata.providerBudgetNotes.flatMap((note) => stringField(note) ?? [])
        : [],
      unsupportedRows,
      unresolvedSelection: asRecord(metadata?.unresolvedSelection)
        ? {
            selectedRowCount: numberField(asRecord(metadata?.unresolvedSelection)?.selectedRowCount) ?? 0,
            dedupedTargetCount: numberField(asRecord(metadata?.unresolvedSelection)?.dedupedTargetCount) ?? targets.length,
            dedupedAwayRowCount: numberField(asRecord(metadata?.unresolvedSelection)?.dedupedAwayRowCount) ?? 0,
            skippedRowCount: numberField(asRecord(metadata?.unresolvedSelection)?.skippedRowCount) ?? unsupportedRows.length,
          }
        : undefined,
      confirmation: {
        level: confirmationLevel,
        text: stringField(metadata?.confirmationText),
        reason: stringField(metadata?.confirmationReason),
      },
      targets,
    };
  }

  function resolveBackfillDateRange(
    marketCode: MarketDataWorkspaceMarketCode,
    body: Pick<MarketDataBackfillBody, "startDate" | "endDate">,
  ): AdminMarketDataBackfillDateRangeDto {
    const providerStartDate = historyStartFor(marketCode);
    const requestedStartDate = body.startDate ?? null;
    const requestedEndDate = body.endDate ?? null;
    const effectiveStartDate = requestedStartDate && requestedStartDate >= providerStartDate
      ? requestedStartDate
      : providerStartDate;
    if (requestedEndDate !== null && requestedEndDate < effectiveStartDate) {
      throw routeError(
        400,
        "market_backfill_range_before_provider_history",
        `Backfill end date ${requestedEndDate} is before the earliest supported ${marketCode} provider date ${effectiveStartDate}`,
      );
    }
    return {
      requestedStartDate,
      requestedEndDate,
      effectiveStartDate,
      effectiveEndDate: requestedEndDate,
      providerStartDate,
      clampedStartDate: requestedStartDate !== null && requestedStartDate < providerStartDate,
    };
  }

  function backfillDateRangeFromMetadata(
    marketCode: MarketDataWorkspaceMarketCode,
    metadata: Record<string, unknown> | null,
  ): AdminMarketDataBackfillDateRangeDto {
    const row = asRecord(metadata?.dateRange);
    const providerStartDate = historyStartFor(marketCode);
    const requestedStartDate = stringField(row?.requestedStartDate);
    const requestedEndDate = stringField(row?.requestedEndDate);
    return {
      requestedStartDate,
      requestedEndDate,
      effectiveStartDate: stringField(row?.effectiveStartDate) ?? providerStartDate,
      effectiveEndDate: stringField(row?.effectiveEndDate),
      providerStartDate: stringField(row?.providerStartDate) ?? providerStartDate,
      clampedStartDate: typeof row?.clampedStartDate === "boolean" ? row.clampedStartDate : false,
    };
  }

  async function buildValuationRepairStatus(input: {
    marketCode: MarketDataWorkspaceMarketCode;
    tickers: string[];
    targetRepairDate: string;
    operationId?: string;
  }): Promise<AdminMarketDataValuationRepairStatusResponse> {
    const uniqueTickers = [...new Set(input.tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))].slice(0, 20);
    const targetRepairDate = input.targetRepairDate.slice(0, 10);
    const marketTradingDay = await app.tradingCalendarCache.isTradingDay(input.marketCode, targetRepairDate);
    const latestBarByKey = await app.persistence.getLatestBarDatesForReconciliation(
      uniqueTickers.map((ticker) => ({ ticker, marketCode: input.marketCode })),
    );
    const tickers = await Promise.all(uniqueTickers.map(async (ticker): Promise<AdminMarketDataValuationRepairTickerStatusDto> => {
      const instrument = await app.persistence.getInstrument(ticker, input.marketCode);
      if (!instrument) {
        return {
          ticker,
          marketCode: input.marketCode,
          targetRepairDate,
          latestBarDate: null,
          latestSnapshotDate: null,
          scopeCount: 0,
          eligibleForSnapshotRepair: false,
          completed: false,
          reasons: ["instrument_not_found"],
        };
      }
      const latestBarDate = latestBarByKey.get(`${ticker}:${input.marketCode}`) ?? null;
      const scopes = await app.persistence.listHoldingSnapshotRepairScopesForTickerMarket(ticker, input.marketCode);
      const latestSnapshotDate = await latestSnapshotDateForRepairScopes(scopes);
      const reasons = valuationRepairReasons({
        latestBarDate,
        latestSnapshotDate,
        marketTradingDay,
        scopeCount: scopes.length,
        targetRepairDate,
      });
      const completed = latestSnapshotDate !== null && latestSnapshotDate >= targetRepairDate && scopes.length > 0;
      return {
        ticker,
        marketCode: input.marketCode,
        targetRepairDate,
        latestBarDate,
        latestSnapshotDate,
        scopeCount: scopes.length,
        eligibleForSnapshotRepair: reasons.includes("ready"),
        completed,
        reasons,
      };
    }));
    const operation = input.operationId
      ? valuationRepairOperationDto(await app.persistence.getProviderOperation(input.operationId))
      : null;

    return {
      marketCode: input.marketCode,
      targetRepairDate,
      marketTradingDay,
      operation,
      tickers,
      summary: {
        total: tickers.length,
        eligibleForSnapshotRepair: tickers.filter((ticker) => ticker.eligibleForSnapshotRepair).length,
        completed: tickers.filter((ticker) => ticker.completed).length,
        blocked: tickers.filter((ticker) => !ticker.eligibleForSnapshotRepair && !ticker.completed).length,
      },
    };
  }

  async function latestSnapshotDateForRepairScopes(
    scopes: Awaited<ReturnType<typeof app.persistence.listHoldingSnapshotRepairScopesForTickerMarket>>,
  ): Promise<string | null> {
    const scopesByUser = new Map<string, typeof scopes>();
    for (const scope of scopes) {
      scopesByUser.set(scope.userId, [...(scopesByUser.get(scope.userId) ?? []), scope]);
    }
    const latestDates: Array<string | null> = [];
    for (const [userId, userScopes] of scopesByUser) {
      const dates = await app.persistence.getLatestHoldingSnapshotDatesByScope(
        userId,
        userScopes.map((scope) => ({
          accountId: scope.accountId,
          ticker: scope.ticker,
          marketCode: scope.marketCode,
        })),
      );
      latestDates.push(...[...dates.values()]);
    }
    if (latestDates.length === 0 || latestDates.some((date) => date === null)) return null;
    return latestDates.reduce<string | null>((min, date) => (min === null || (date !== null && date < min) ? date : min), null);
  }

  function valuationRepairReasons(input: {
    latestBarDate: string | null;
    latestSnapshotDate: string | null;
    marketTradingDay: boolean;
    scopeCount: number;
    targetRepairDate: string;
  }): AdminMarketDataValuationRepairReason[] {
    if (!input.marketTradingDay) return ["market_closed"];
    if (input.latestBarDate === null) return ["latest_bar_missing"];
    if (input.latestBarDate < input.targetRepairDate) return ["latest_bar_before_target"];
    if (input.scopeCount === 0) return ["no_active_snapshot_scopes"];
    if (input.latestSnapshotDate !== null && input.latestSnapshotDate >= input.targetRepairDate) return ["snapshot_ready"];
    if (input.latestSnapshotDate === null) return ["ready", "snapshot_missing"];
    return ["ready", "snapshot_stale"];
  }

  function valuationRepairOperationDto(
    operation: ProviderOperationRecord | null,
  ): AdminMarketDataValuationRepairOperationDto | null {
    if (!operation) return null;
    const metadata = asRecord(operation.metadata) ?? {};
    return {
      operationId: operation.id,
      phase: operation.phase,
      progressPercent: numberField(metadata.progressPercent),
      enqueuedJobCount: numberField(metadata.enqueuedJobCount),
      skippedExistingJobCount: numberField(metadata.skippedExistingJobCount),
      completedAt: operation.completedAt,
    };
  }

  async function cancelActiveMarketDataPreviews(input: {
    providerId: string;
    marketCode: MarketDataWorkspaceMarketCode;
    operationType: string;
  }): Promise<void> {
    const active = await app.persistence.listProviderOperations({
      providerId: input.providerId,
      marketCode: input.marketCode,
      phases: ["preparing_preview", "preview", "staged"],
      page: 1,
      limit: 100,
    });
    const nowMs = Date.now();
    const cancelledAt = new Date(nowMs).toISOString();
    for (const operation of active.items) {
      if (operation.operationType !== input.operationType) continue;
      if (isExpiredProviderOperationPreview(operation, nowMs)) continue;
      const cancelled = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "cancelled",
        cancelledAt,
        previewTokenHash: null,
        previewExpiresAt: null,
        metadata: {
          ...(asRecord(operation.metadata) ?? {}),
          supersededByPreview: true,
          supersededAt: cancelledAt,
        },
      });
      await app.persistence.createProviderOperationLog({
        operationId: cancelled.id,
        phase: "cancelled",
        level: "info",
        message: `market_data_preview_superseded provider=${cancelled.providerId} market=${cancelled.marketCode} action=${cancelled.operationType}`,
        context: {
          providerId: cancelled.providerId,
          marketCode: cancelled.marketCode,
          operationType: cancelled.operationType,
        },
      });
    }
  }

  async function createBackfillPreviewOperation(
    context: { actorUserId: string; ipAddress?: string },
    preview: MarketDataBackfillPreviewDraft,
    body: MarketDataBackfillBody,
  ): Promise<AdminMarketDataBackfillPreviewResponse> {
    await ensureProviderHealthRow(preview.providerId);
    await cancelActiveMarketDataPreviews({
      providerId: preview.providerId,
      marketCode: preview.marketCode,
      operationType: "backfill_catalog_rows",
    });
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const token = newProviderFixerToken();
    const now = Date.now();
    const tokenExpiresAt = new Date(now + guardrails.previewTokenTtlSeconds * 1000).toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId: preview.providerId,
      marketCode: preview.marketCode,
      operationType: "backfill_catalog_rows",
      phase: "preview",
      errorCode: "admin_market_data_backfill",
      scopeQuery: `${preview.marketCode}:${preview.scope}`,
      snapshotHash: hashProviderFixerToken(`${preview.marketCode}:${preview.providerId}:${preview.scope}:${preview.matchCount}:${JSON.stringify(body.filters ?? {})}:${now}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: tokenExpiresAt,
      matchCount: preview.matchCount,
      sample: preview.targets.slice(0, 20),
      metadata: {
        previewTokenDisplay: token,
        ...backfillPreviewMetadata(preview, body),
      },
      actorUserId: context.actorUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "preview",
      level: preview.matchCount > 0 ? "info" : "warning",
      message: `market_data_backfill_preview provider=${preview.providerId} market=${preview.marketCode} scope=${preview.scope} matched=${preview.matchCount}`,
      context: {
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        scope: preview.scope,
        matchCount: preview.matchCount,
        unsupportedCount: preview.unsupportedRows.length,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "market_data_backfill_preview",
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        scope: preview.scope,
        matchCount: preview.matchCount,
      },
    });
    return {
      ...preview,
      operationId: operation.id,
      previewToken: token,
      tokenExpiresAt,
      targets: preview.targets,
    };
  }

  async function enqueueMarketDataBackfillTargets(
    operation: ProviderOperationRecord,
    targets: readonly MarketDataTarget[],
    dateRange: AdminMarketDataBackfillDateRangeDto,
  ): Promise<{ batchId: string | null; enqueuedJobCount: number; skippedExistingJobCount: number }> {
    if (!app.boss || targets.length === 0) {
      return { batchId: null, enqueuedJobCount: 0, skippedExistingJobCount: 0 };
    }
    const batchId = await app.persistence.createRefreshBatch(null, targets.length);
    let enqueuedJobCount = 0;
    let skippedExistingJobCount = 0;
    for (const target of targets) {
      const resolverMode: MarketDataResolverMode | undefined = target.marketCode === "KR" ? "quote_first" : undefined;
      const payload = {
        ticker: target.ticker,
        marketCode: target.marketCode,
        trigger: "admin_rerun",
        includeBars: true,
        includeDividends: true,
        startDate: dateRange.effectiveStartDate,
        ...(dateRange.effectiveEndDate ? { endDate: dateRange.effectiveEndDate } : {}),
        batchId,
        providerOperationId: operation.id,
        ...(resolverMode ? { resolverMode } : {}),
      } satisfies BackfillJobData;
      const jobId = await app.boss.send(
        BACKFILL_QUEUE,
        payload,
        {
          singletonKey: getBackfillJobSingletonKey(payload),
          priority: 10,
        },
      );
      if (jobId === null) {
        skippedExistingJobCount += 1;
      } else {
        enqueuedJobCount += 1;
      }
    }
    return { batchId, enqueuedJobCount, skippedExistingJobCount };
  }

  async function createBackfillOperation(
    context: { actorUserId: string; ipAddress?: string },
    preview: MarketDataBackfillPreviewDraft,
    source: "manual_execute" | "linked_refill",
    options: { ignoreActiveOperationId?: string } = {},
  ): Promise<{ operation: ProviderOperationRecord; batchId: string | null; enqueuedJobCount: number; skippedExistingJobCount: number }> {
    await ensureProviderHealthRow(preview.providerId);
    await assertNoOtherProviderOperationExecution(app, {
      providerId: preview.providerId,
      marketCode: preview.marketCode,
      operationId: options.ignoreActiveOperationId,
    });
    const now = new Date().toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId: preview.providerId,
      marketCode: preview.marketCode,
      operationType: "backfill_catalog_rows",
      phase: app.boss && preview.targets.length > 0 ? "running" : "completed",
      errorCode: "admin_market_data_backfill",
      scopeQuery: `${preview.marketCode}:${preview.scope}`,
      snapshotHash: hashProviderFixerToken(`${preview.marketCode}:${preview.providerId}:${preview.scope}:${preview.matchCount}:${now}`).slice(0, 12),
      matchCount: preview.matchCount,
      sample: preview.targets.slice(0, 20),
      metadata: {
        marketDataBff: true,
        source,
        scope: preview.scope,
        unresolvedSelection: preview.unresolvedSelection ?? null,
        estimatedStorageRows: preview.estimatedStorageRows,
        affectedUserCount: preview.affectedUserCount,
        affectedAccountCount: preview.affectedAccountCount,
        dateRange: preview.dateRange,
        providerBudgetNotes: preview.providerBudgetNotes,
        progressPercent: preview.targets.length === 0 || !app.boss ? 100 : 0,
      },
      actorUserId: context.actorUserId,
      startedAt: now,
      completedAt: app.boss && preview.targets.length > 0 ? null : now,
    });
    const queued = await enqueueMarketDataBackfillTargets(operation, preview.targets, preview.dateRange);
    const finalPhase = queued.enqueuedJobCount > 0 ? "running" : "completed";
    const updated = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: finalPhase,
      completedAt: finalPhase === "completed" ? new Date().toISOString() : null,
      legacyBatchId: queued.batchId,
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        batchId: queued.batchId,
        enqueuedJobCount: queued.enqueuedJobCount,
        skippedExistingJobCount: queued.skippedExistingJobCount,
        unresolvedSelection: preview.unresolvedSelection ?? null,
        progressPercent: finalPhase === "completed" ? 100 : 0,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: updated.id,
      phase: updated.phase,
      level: "info",
      message: `market_data_backfill_${finalPhase} provider=${preview.providerId} market=${preview.marketCode} scope=${preview.scope} matched=${preview.matchCount} enqueued=${queued.enqueuedJobCount}`,
      context: {
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        scope: preview.scope,
        matchCount: preview.matchCount,
        batchId: queued.batchId,
        enqueuedJobCount: queued.enqueuedJobCount,
        skippedExistingJobCount: queued.skippedExistingJobCount,
        source,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: updated.id,
        action: "market_data_backfill_execute",
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        scope: preview.scope,
        matchCount: preview.matchCount,
        batchId: queued.batchId,
        enqueuedJobCount: queued.enqueuedJobCount,
        skippedExistingJobCount: queued.skippedExistingJobCount,
        source,
      },
    });
    return { operation: updated, ...queued };
  }

  async function executeBackfillPreviewOperation(
    context: { actorUserId: string; ipAddress?: string },
    operation: ProviderOperationRecord,
    preview: MarketDataBackfillPreviewDraft,
  ): Promise<{ operation: ProviderOperationRecord; batchId: string | null; enqueuedJobCount: number; skippedExistingJobCount: number }> {
    await assertNoOtherProviderOperationExecution(app, {
      providerId: operation.providerId,
      marketCode: operation.marketCode,
      operationId: operation.id,
    });
    const startedAt = new Date().toISOString();
    const running = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: app.boss && preview.targets.length > 0 ? "running" : "completed",
      startedAt,
      completedAt: app.boss && preview.targets.length > 0 ? null : startedAt,
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        source: "manual_execute",
        progressPercent: preview.targets.length === 0 || !app.boss ? 100 : 0,
      },
    });
    const queued = await enqueueMarketDataBackfillTargets(running, preview.targets, preview.dateRange);
    const finalPhase = queued.enqueuedJobCount > 0 ? "running" : "completed";
    const updated = await app.persistence.updateProviderOperation({
      id: running.id,
      phase: finalPhase,
      completedAt: finalPhase === "completed" ? new Date().toISOString() : null,
      legacyBatchId: queued.batchId,
      previewTokenHash: null,
      previewExpiresAt: null,
      metadata: {
        ...(asRecord(running.metadata) ?? {}),
        batchId: queued.batchId,
        enqueuedJobCount: queued.enqueuedJobCount,
        skippedExistingJobCount: queued.skippedExistingJobCount,
        unresolvedSelection: preview.unresolvedSelection ?? null,
        progressPercent: finalPhase === "completed" ? 100 : 0,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: updated.id,
      phase: updated.phase,
      level: "info",
      message: `market_data_backfill_${finalPhase} provider=${preview.providerId} market=${preview.marketCode} scope=${preview.scope} matched=${preview.matchCount} enqueued=${queued.enqueuedJobCount}`,
      context: {
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        scope: preview.scope,
        matchCount: preview.matchCount,
        batchId: queued.batchId,
        enqueuedJobCount: queued.enqueuedJobCount,
        skippedExistingJobCount: queued.skippedExistingJobCount,
        source: "manual_execute",
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: updated.id,
        action: "market_data_backfill_execute",
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        scope: preview.scope,
        matchCount: preview.matchCount,
        batchId: queued.batchId,
        enqueuedJobCount: queued.enqueuedJobCount,
        skippedExistingJobCount: queued.skippedExistingJobCount,
        source: "manual_execute",
      },
    });
    return { operation: updated, ...queued };
  }

  async function resolvePurgeTargets(
    marketCode: MarketDataWorkspaceMarketCode,
    body: MarketDataPurgeBody,
  ): Promise<MarketDataTarget[]> {
    if (body.targets && body.targets.length > 0) {
      const validated = await validateExplicitTargets(marketCode, body.targets, { requireSupported: false });
      return uniqueMarketDataTargets([...validated.targets, ...validated.unsupportedRows.map((row) => ({
        ticker: row.ticker,
        marketCode: row.marketCode,
      }))]);
    }
    const filters = body.categories.includes("admin_state_reset")
      ? { ...(body.filters ?? {}), supportState: body.filters?.supportState ?? "all" }
      : body.filters;
    return allMatchingTargets(marketCode, filters);
  }

	  function unsupportedPurgeCategories(marketCode: MarketCode, body: MarketDataPurgeBody): AdminMarketDataPurgePreviewResponse["unsupportedCategories"] {
	    const unsupported: AdminMarketDataPurgePreviewResponse["unsupportedCategories"] = [];
	    for (const category of body.categories) {
	      const disabled = marketDataPurgeDisabledReason(marketCode, category);
	      if (disabled) {
	        unsupported.push({
	          category,
	          reason: disabled.reason,
	        });
	      }
	    }
	    return unsupported;
	  }

  async function buildPurgePreview(
    marketCode: MarketDataWorkspaceMarketCode,
    body: MarketDataPurgeBody,
  ): Promise<MarketDataPurgePreviewDraft> {
    const providerId = assertMarketDataProvider(marketCode, body.providerId);
    const targets = await resolvePurgeTargets(marketCode, body);
    const unsupportedCategories = unsupportedPurgeCategories(marketCode, body);
    const supportedCategorySet = new Set(body.categories.filter((category) =>
      !unsupportedCategories.some((unsupported) => unsupported.category === category),
    ));
    const counts = await app.persistence.purgeAdminMarketData({
      providerId,
      marketCode,
      categories: [...supportedCategorySet],
      targets,
      fullHistory: body.fullHistory,
      startDate: body.startDate ?? null,
      endDate: body.endDate ?? null,
      dryRun: true,
    });
    const ownership = await app.persistence.countAdminMarketDataTargetOwnership({ targets });
    const linkedRefillAvailable =
      body.enqueueBackfillAfterPurge === true
      && (body.categories.includes("price_bars") || body.categories.includes("dividends"))
      && targets.length > 0;
    return {
      marketCode,
      providerId,
      categories: body.categories,
      affectedInstrumentCount: targets.length,
      affectedUserCount: ownership.userCount,
      affectedAccountCount: ownership.accountCount,
      estimatedRows: counts.total,
      unsupportedCategories,
      linkedRefill: {
        available: linkedRefillAvailable,
        mode: linkedRefillAvailable && body.fullHistory === false ? "same_range" : linkedRefillAvailable ? "full_history" : null,
        warning: linkedRefillAvailable ? null : "Linked refill is available only when price bars or dividends are selected and the preview has targets.",
      },
      confirmation: {
        level: "typed",
        text: `PURGE ${marketCode}`,
        reason: "Purge is destructive and requires typed confirmation.",
      },
      targets,
      deletedRows: counts.total,
      fullHistory: body.fullHistory,
      startDate: body.startDate,
      endDate: body.endDate,
      enqueueBackfillAfterPurge: body.enqueueBackfillAfterPurge,
    };
  }

  function purgePreviewMetadata(preview: MarketDataPurgePreviewDraft): Record<string, unknown> {
    return {
      marketDataBff: true,
      source: "preview",
      categories: preview.categories,
      frozenPurgeTargets: preview.targets.map(compactBackfillTarget),
      estimatedRows: preview.estimatedRows,
      deletedRows: preview.deletedRows,
      unsupportedCategories: preview.unsupportedCategories,
      linkedRefill: preview.linkedRefill,
      affectedUserCount: preview.affectedUserCount,
      affectedAccountCount: preview.affectedAccountCount,
      confirmationText: preview.confirmation.text,
      confirmationLevel: preview.confirmation.level,
      confirmationReason: preview.confirmation.reason,
      linkedRefillRequested: preview.enqueueBackfillAfterPurge === true,
      fullHistory: preview.fullHistory,
      dateRange: preview.fullHistory === false ? { startDate: preview.startDate ?? null, endDate: preview.endDate ?? null } : null,
      progressPercent: null,
    };
  }

  function purgeTargetsFromMetadata(metadata: Record<string, unknown> | null): MarketDataTarget[] {
    const rows = asRecord(metadata)?.frozenPurgeTargets;
    if (!Array.isArray(rows)) return [];
    return uniqueMarketDataTargets(rows.flatMap((item) => {
      const row = asRecord(item);
      const ticker = stringField(row?.ticker);
      const parsedMarket = providerFixerMarketCodeSchema.safeParse(row?.marketCode);
      if (!ticker || !parsedMarket.success) return [];
      return [compactBackfillTarget({
        ticker,
        marketCode: parsedMarket.data,
        name: stringField(row?.name),
        instrumentType: stringField(row?.instrumentType) as MarketDataTarget["instrumentType"],
        status: stringField(row?.status) as MarketDataTarget["status"],
        supportState: stringField(row?.supportState) as MarketDataTarget["supportState"],
        backfillStatus: stringField(row?.backfillStatus) as MarketDataTarget["backfillStatus"],
        providerIds: Array.isArray(row?.providerIds) ? row.providerIds.flatMap((providerId) => stringField(providerId) ?? []) : [],
      })];
    }));
  }

  function purgePreviewFromOperation(operation: ProviderOperationRecord): MarketDataPurgePreviewDraft {
    const metadata = asRecord(operation.metadata);
    const categories = Array.isArray(metadata?.categories)
      ? metadata.categories.flatMap((category) => {
          const parsed = z.enum([
            "price_bars",
            "dividends",
            "backfill_jobs",
            "provider_operation_outcomes",
            "provider_error_trail",
            "provider_resolution_mappings",
            "asx_gics_enrichment",
            "admin_state_reset",
          ]).safeParse(category);
          return parsed.success ? [parsed.data] : [];
        })
      : [];
    const unsupportedCategories = Array.isArray(metadata?.unsupportedCategories)
      ? metadata.unsupportedCategories.flatMap((item) => {
          const row = asRecord(item);
          const category = categories.find((value) => value === row?.category);
          const reason = stringField(row?.reason);
          return category && reason ? [{ category, reason }] : [];
        })
      : [];
    const linkedRefillRecord = asRecord(metadata?.linkedRefill);
    const targets = purgeTargetsFromMetadata(metadata);
    const dateRange = asRecord(metadata?.dateRange);
    return {
      marketCode: operation.marketCode as MarketDataWorkspaceMarketCode,
      providerId: operation.providerId,
      categories,
      affectedInstrumentCount: operation.matchCount ?? targets.length,
      affectedUserCount: numberField(metadata?.affectedUserCount) ?? 0,
      affectedAccountCount: numberField(metadata?.affectedAccountCount) ?? 0,
      estimatedRows: numberField(metadata?.estimatedRows),
      unsupportedCategories,
      linkedRefill: {
        available: linkedRefillRecord?.available === true,
        mode: linkedRefillRecord?.mode === "same_range" || linkedRefillRecord?.mode === "full_history" ? linkedRefillRecord.mode : null,
        warning: stringField(linkedRefillRecord?.warning),
      },
      confirmation: {
        level: metadata?.confirmationLevel === "typed" || metadata?.confirmationLevel === "checkbox" || metadata?.confirmationLevel === "none"
          ? metadata.confirmationLevel
          : "typed",
        text: stringField(metadata?.confirmationText),
        reason: stringField(metadata?.confirmationReason),
      },
      targets,
      deletedRows: numberField(metadata?.deletedRows) ?? 0,
      fullHistory: metadata?.fullHistory === false ? false : metadata?.fullHistory === true ? true : undefined,
      startDate: stringField(dateRange?.startDate) ?? undefined,
      endDate: stringField(dateRange?.endDate) ?? undefined,
      enqueueBackfillAfterPurge: metadata?.linkedRefillRequested === true,
    };
  }

  async function createPurgePreviewOperation(
    context: { actorUserId: string; ipAddress?: string },
    preview: MarketDataPurgePreviewDraft,
  ): Promise<AdminMarketDataPurgePreviewResponse> {
    await ensureProviderHealthRow(preview.providerId);
    await cancelActiveMarketDataPreviews({
      providerId: preview.providerId,
      marketCode: preview.marketCode,
      operationType: "purge_market_data",
    });
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const token = newProviderFixerToken();
    const now = Date.now();
    const tokenExpiresAt = new Date(now + guardrails.previewTokenTtlSeconds * 1000).toISOString();
    const operation = await app.persistence.createProviderOperation({
      providerId: preview.providerId,
      marketCode: preview.marketCode,
      operationType: "purge_market_data",
      phase: "preview",
      errorCode: "admin_market_data_purge",
      scopeQuery: `${preview.marketCode}:purge`,
      snapshotHash: hashProviderFixerToken(`${preview.marketCode}:${preview.providerId}:purge:${preview.deletedRows}:${now}`).slice(0, 12),
      previewTokenHash: hashProviderFixerToken(token),
      previewExpiresAt: tokenExpiresAt,
      matchCount: preview.affectedInstrumentCount,
      sample: preview.targets.slice(0, 20),
      metadata: {
        previewTokenDisplay: token,
        ...purgePreviewMetadata(preview),
      },
      actorUserId: context.actorUserId,
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: "preview",
      level: preview.deletedRows > 0 ? "warning" : "info",
      message: `market_data_purge_preview provider=${preview.providerId} market=${preview.marketCode} categories=${preview.categories.join(",")} rows=${preview.deletedRows}`,
      context: {
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        categories: preview.categories,
        deletedRows: preview.deletedRows,
        matchCount: preview.affectedInstrumentCount,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: operation.id,
        action: "market_data_purge_preview",
        providerId: preview.providerId,
        marketCode: preview.marketCode,
        categories: preview.categories,
        deletedRows: preview.deletedRows,
      },
    });
    return {
      operationId: operation.id,
      previewToken: token,
      tokenExpiresAt,
      marketCode: preview.marketCode,
      providerId: preview.providerId,
      categories: preview.categories,
      affectedInstrumentCount: preview.affectedInstrumentCount,
      affectedUserCount: preview.affectedUserCount,
      affectedAccountCount: preview.affectedAccountCount,
      estimatedRows: preview.estimatedRows,
      unsupportedCategories: preview.unsupportedCategories,
      linkedRefill: preview.linkedRefill,
      confirmation: preview.confirmation,
    };
  }

  async function listAllProviderUnresolvedItemsForMarket(input: {
    marketCode: MarketDataWorkspaceMarketCode;
    providerId?: string;
    state?: "all" | "active" | "resolved" | "unsupported" | "ignored";
    errorCode?: string;
    search?: string;
  }) {
    const providerIds = input.providerId ? [input.providerId] : providerIdsForMarket(input.marketCode);
    const pages = await Promise.all(providerIds.map(async (providerId) => {
      const items: Awaited<ReturnType<typeof app.persistence.listProviderUnresolvedItems>>["items"] = [];
      let page = 1;
      while (true) {
        const result = await app.persistence.listProviderUnresolvedItems({
          providerId,
          marketCode: input.marketCode,
          state: input.state ?? "all",
          errorCode: input.errorCode,
          search: input.search,
          sort: "last_seen_desc",
          page,
          limit: 500,
        });
        items.push(...result.items);
        if (page * result.limit >= result.total || result.items.length === 0) break;
        page += 1;
      }
      return items;
    }));
    return pages.flat();
  }

  function summarizeMarketUnresolvedRows(
    rows: Awaited<ReturnType<typeof listAllProviderUnresolvedItemsForMarket>>,
  ): AdminMarketDataUnresolvedResponse["summary"] {
    const activeRows = rows.filter((row) => row.state === "active");
    const bucket = (groupedRows: typeof rows) => ({
      count: groupedRows.length,
      activeCount: groupedRows.filter((row) => row.state === "active").length,
    });
    const groupMap = <T extends string>(values: T[]) => [...new Set(values)].sort();
    const byProvider = groupMap(rows.map((row) => row.providerId)).map((key) => ({
      key,
      ...bucket(rows.filter((row) => row.providerId === key)),
    }));
    const byErrorCode = groupMap(rows.map((row) => row.errorCode)).map((key) => ({
      key,
      ...bucket(rows.filter((row) => row.errorCode === key)),
    }));
    const byState = groupMap(rows.map((row) => row.state)).map((key) => ({
      key,
      ...bucket(rows.filter((row) => row.state === key)),
    }));
    return {
      activeRowCount: activeRows.length,
      affectedInstrumentCount: new Set(activeRows.map((row) => row.sourceSymbol)).size,
      oldestUnresolvedAt: activeRows.length > 0
        ? activeRows.reduce((oldest, row) => row.firstSeenAt < oldest ? row.firstSeenAt : oldest, activeRows[0]!.firstSeenAt)
        : null,
      byProvider,
      byErrorCode,
      byState,
    };
  }

  async function unresolvedStatsForProviders(
    providerIds: string[],
    marketCode: AdminMarketCode,
  ): Promise<{ unresolvedCount: number; affectedInstrumentCount: number }> {
    if (marketCode === "FX") return { unresolvedCount: 0, affectedInstrumentCount: 0 };
    const rows = await listAllProviderUnresolvedItemsForMarket({ marketCode, state: "active" });
    return {
      unresolvedCount: rows.filter((row) => providerIds.includes(row.providerId)).length,
      affectedInstrumentCount: new Set(
        rows.filter((row) => providerIds.includes(row.providerId)).map((row) => row.sourceSymbol),
      ).size,
    };
  }

  async function backfillCount(marketCode: AdminMarketCode, status: "pending" | "failed"): Promise<number> {
    if (marketCode === "FX") return 0;
    const result = await app.persistence.listAdminInstruments({
      marketCode,
      page: 1,
      limit: 1,
      backfillStatus: status,
    });
    return result.total;
  }

  async function latestMarketOperation(marketCode: AdminMarketCode): Promise<AdminMarketDataLandingResponse["markets"][number]["latestOperation"]> {
    const workspace = MARKET_DATA_WORKSPACES[marketCode];
    const byProvider = await Promise.all(
      workspace.providers.map(async (provider) => {
        const result = await app.persistence.listProviderOperations({
          providerId: provider.providerId,
          page: 1,
          limit: 1,
        });
        return result.items[0] ?? null;
      }),
    );
    const latest = byProvider
      .filter((operation): operation is ProviderOperationRecord => operation !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    if (!latest) return null;
    return {
      id: latest.id,
      providerId: latest.providerId,
      action: latest.operationType as ProviderOperationAction,
      phase: latest.phase,
      updatedAt: latest.updatedAt,
    };
  }

  async function healthStatusForProviders(providerIds: string[]): Promise<ProviderHealthStatusDto["status"]> {
    const rows = await Promise.all(providerIds.map((providerId) => app.persistence.getProviderHealthStatus(providerId)));
    const statuses = rows.map((row) => row?.status ?? "awaiting");
    if (statuses.includes("down")) return "down";
    if (statuses.includes("degraded")) return "degraded";
    if (statuses.includes("awaiting")) return "awaiting";
    return "healthy";
  }

  async function marketTile(marketCode: AdminMarketCode): Promise<AdminMarketDataLandingResponse["markets"][number]> {
    const workspace = MARKET_DATA_WORKSPACES[marketCode];
    const providerIds = providerIdsForMarket(marketCode);
    const [healthStatus, unresolvedStats, pendingBackfillCount, failedBackfillCount, latestOperation] =
      await Promise.all([
        healthStatusForProviders(providerIds),
        unresolvedStatsForProviders(providerIds, marketCode),
        backfillCount(marketCode, "pending"),
        backfillCount(marketCode, "failed"),
        latestMarketOperation(marketCode),
      ]);
    return {
      marketCode,
      label: workspace.label,
      href: `/admin/market-data/${marketCode}/overview`,
      providers: workspace.providers,
      healthStatus,
      unresolvedCount: unresolvedStats.unresolvedCount,
      affectedInstrumentCount: unresolvedStats.affectedInstrumentCount,
      pendingBackfillCount,
      failedBackfillCount,
      latestOperation,
      nextAction:
        marketCode === "FX"
          ? "Refresh FX rates"
          : failedBackfillCount > 0
            ? "Preview failed backfill"
            : pendingBackfillCount > 0
              ? "Preview pending backfill"
              : "Inspect instruments",
    };
  }

  async function marketOverview(marketCode: AdminMarketCode): Promise<AdminMarketDataOverviewResponse> {
    const tile = await marketTile(marketCode);
    return {
      marketCode,
      label: tile.label,
      tabs: MARKET_DATA_WORKSPACES[marketCode].tabs,
      providers: tile.providers,
      purgeCategories: marketDataPurgeCategoryCapabilities(marketCode),
      healthStatus: tile.healthStatus,
      unresolvedCount: tile.unresolvedCount,
      affectedInstrumentCount: tile.affectedInstrumentCount,
      pendingBackfillCount: tile.pendingBackfillCount,
      failedBackfillCount: tile.failedBackfillCount,
      latestOperation: tile.latestOperation,
      guidance:
        marketCode === "KR"
          ? ["KR mapping repair only persists verified mappings. Backfill is a separate explicit action."]
          : marketCode === "FX"
            ? ["FX supports refresh, operations, and logs only in this scope."]
            : ["Catalog sync and historical backfill are separate provider-owned actions."],
    };
  }

  function marketDataActions(marketCode: AdminMarketCode): AdminMarketDataActionDto[] {
    const actionSet: ProviderOperationAction[] =
      marketCode === "FX"
        ? ["refresh_fx_rates"]
        : marketCode === "AU"
          ? ["sync_catalog", "sync_asx_gics", "backfill_catalog_rows"]
          : marketCode === "KR"
            ? ["sync_catalog", "repair_mapping", "backfill_catalog_rows"]
            : ["sync_catalog", "backfill_catalog_rows"];
    return actionSet.map((action) => {
      const providerId = marketDataProviderForAction(marketCode, action);
      const capability = providerId ? listProviderOperationCapabilities([providerId])[0] : null;
      const actionCapability = capability?.actions.find((item) => item.action === action);
      const supported = actionCapability?.supported === true;
      return {
        action,
        providerId: providerId ?? "unassigned",
        label: marketDataActionLabel(action),
        description: marketDataActionDescription(action),
        supported,
        disabledReason: supported ? null : actionCapability?.reason ?? "No provider owns this action for the selected market.",
        guardrail: actionCapability?.guardrail ?? "none",
        providerBudgetNotes: marketDataProviderBudgetNotes(marketCode, action),
      };
    });
  }

  async function createMarketDataProviderOperation(input: {
    marketCode: AdminMarketCode;
    providerId: string;
    action: ProviderOperationAction;
    actorUserId: string;
    matchCount?: number;
    sample?: unknown[];
    metadata?: Record<string, unknown>;
    phase?: ProviderOperationPhase;
  }): Promise<ProviderOperationRecord> {
    await ensureProviderHealthRow(input.providerId);
    if (input.marketCode !== "FX") {
      await assertNoOtherProviderOperationExecution(app, {
        providerId: input.providerId,
        marketCode: input.marketCode,
      });
    }
    const now = new Date().toISOString();
    return app.persistence.createProviderOperation({
      providerId: input.providerId,
      marketCode: input.marketCode,
      operationType: input.action,
      phase: input.phase ?? (app.boss ? "queued" : "completed"),
      errorCode: `admin_market_data_${input.action}`,
      scopeQuery: `${input.marketCode}:${input.action}`,
      snapshotHash: hashProviderFixerToken(`${input.marketCode}:${input.providerId}:${input.action}:${now}`).slice(0, 12),
      matchCount: input.matchCount ?? 0,
      sample: input.sample ?? [],
      metadata: {
        marketDataBff: true,
        progressPercent: app.boss ? 0 : 100,
        ...(input.metadata ?? {}),
      },
      actorUserId: input.actorUserId,
      startedAt: app.boss ? null : now,
      completedAt: app.boss ? null : now,
    });
  }

  async function finalizeCollapsedMarketActionOperation(
    operation: ProviderOperationRecord,
    context: { actorUserId: string; ipAddress?: string; jobId: string | null; singletonKey: string; queueAvailable: boolean },
  ): Promise<ProviderOperationRecord> {
    if (context.jobId !== null || !context.queueAvailable) return operation;
    const completed = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 100,
        skippedExistingJobCount: 1,
        singletonKey: context.singletonKey,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: completed.id,
      phase: "completed",
      level: "warning",
      message: `market_data_action_skipped_existing_job provider=${completed.providerId} market=${completed.marketCode} action=${completed.operationType}`,
      context: { providerId: completed.providerId, marketCode: completed.marketCode, singletonKey: context.singletonKey },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: completed.id,
        action: "market_data_action_skipped_existing_job",
        providerId: completed.providerId,
        marketCode: completed.marketCode,
        operationType: completed.operationType,
        singletonKey: context.singletonKey,
      },
    });
    return completed;
  }

  async function createKrMappingRepairOperation(
    body: AdminMarketDataActionExecuteRequest,
    context: { actorUserId: string; ipAddress?: string },
  ): Promise<ProviderOperationRecord> {
    const providerId = "yahoo-finance-kr";
    const resolverMode = body.resolverMode ?? "quote_first";
    if (body.resolverModeRiskAccepted !== undefined && resolverMode !== "chart_probe_v1") {
      throw routeError(400, "resolver_mode_risk_acceptance_unexpected", "resolverModeRiskAccepted is only valid with chart_probe_v1");
    }
    if (resolverMode === "chart_probe_v1" && body.resolverModeRiskAccepted !== true) {
      throw routeError(400, "resolver_mode_risk_acceptance_required", "chart_probe_v1 requires explicit resolverModeRiskAccepted=true");
    }
    const config = await loadAppConfigDto(app);
    const guardrails = providerFixerGuardrailsFromConfig(config);
    const scope = {
      type: "filter",
      marketCode: "KR",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      state: "active",
    } satisfies ProviderFixerScopeInput;
    await assertNoOtherProviderOperationExecution(app, { providerId, marketCode: "KR" });
    const scopeItems = await listProviderUnresolvedScopeItems(app, providerId, scope);
    const scopeSnapshot = await buildProviderFixerScopeSnapshot(app, providerId, "KR", scope, scopeItems);
    const sample = await buildProviderFixerEvidenceSample(
      app,
      providerId,
      "KR",
      scopeItems,
      resolverMode,
      guardrails.previewSampleLimit,
      { verifyCandidate: false },
    );
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode: "KR",
      operationType: "repair_mapping",
      phase: app.boss ? "queued" : "running",
      errorCode: "yahoo_finance_kr_symbol_unresolved",
      resolverMode,
      scopeQuery: providerFixerScopeLabel(scope, providerId),
      snapshotHash: scopeSnapshot.snapshotHash,
      matchCount: scopeSnapshot.matchCount,
      sample: sample.sample,
      metadata: {
        marketDataBff: true,
        mappingOnly: true,
        scope,
        frozenScope: providerFixerFrozenScopeMetadata(providerId, scope, scopeItems),
        scopeType: scope.type,
        scopeFingerprint: providerFixerScopeFingerprint(scope),
        scopeSummary: providerFixerScopeSummary(scope, scopeSnapshot.matchCount),
        effectiveRateCapPerMinute: providerOperationRateCapPerMinute(providerId, config),
        autoPauseFailureThresholdPerMinute: guardrails.autoPauseFailureThresholdPerMinute,
        progressPercent: app.boss ? 0 : null,
      },
      actorUserId: context.actorUserId,
      startedAt: app.boss ? null : new Date().toISOString(),
    });
    await app.persistence.createProviderOperationLog({
      operationId: operation.id,
      phase: operation.phase,
      level: scopeSnapshot.matchCount > 0 ? "info" : "warning",
      message: `market_data_mapping_repair_${operation.phase} provider=${providerId} market=KR matched=${scopeSnapshot.matchCount} mapping_only=true`,
      context: { providerId, marketCode: "KR", matchCount: scopeSnapshot.matchCount, resolverMode, mappingOnly: true },
    });
    return operation;
  }

  async function executeMarketDataAction(
    marketCode: AdminMarketCode,
    body: AdminMarketDataActionExecuteRequest,
    context: { actorUserId: string; ipAddress?: string },
  ): Promise<AdminMarketDataActionExecuteResponse> {
    if (body.action === "backfill_catalog_rows") {
      throw routeError(400, "market_action_uses_preview_execute", "Backfill requires the preview/execute backfill flow");
    }
    if (body.acknowledged !== true) {
      throw routeError(400, "market_action_acknowledgement_required", "Action execution requires acknowledgement");
    }
    const providerId = marketDataProviderForAction(marketCode, body.action);
    if (!providerId) {
      throw routeError(400, "market_action_unsupported", "Action is not supported for this market");
    }
    if (body.providerId && body.providerId !== providerId) {
      throw routeError(400, "provider_market_mismatch", "Provider does not own this action for the selected market");
    }

    if (body.action === "repair_mapping") {
      const operation = await createKrMappingRepairOperation(body, context);
      if (!app.boss) {
        const config = await loadAppConfigDto(app);
        await completeProviderFixerOperation(app, operation, {
          actorUserId: context.actorUserId,
          ipAddress: context.ipAddress,
          guardrails: providerFixerGuardrailsFromConfig(config),
          dangerous: false,
          throwOnFailure: true,
        });
        return {
          operationId: operation.id,
          marketCode,
          providerId,
          action: body.action,
          status: "completed",
          jobId: null,
          message: "KR mapping repair completed without queue dispatch.",
        };
      }
      const jobId = await app.boss.send(
        PROVIDER_OPERATION_EXECUTION_QUEUE,
        { operationId: operation.id, actorUserId: context.actorUserId, ipAddress: context.ipAddress },
        { singletonKey: providerOperationExecutionSingletonKey(operation.id), priority: 10 },
      );
      const updated = await finalizeCollapsedMarketActionOperation(operation, {
        ...context,
        jobId,
        singletonKey: providerOperationExecutionSingletonKey(operation.id),
        queueAvailable: true,
      });
      return {
        operationId: updated.id,
        marketCode,
        providerId,
        action: body.action,
        status: updated.phase === "completed" ? "completed" : "queued",
        jobId,
        message: "KR mapping repair queued; it persists mappings only and does not backfill price data.",
      };
    }

    const operation = await createMarketDataProviderOperation({
      marketCode,
      providerId,
      action: body.action,
      actorUserId: context.actorUserId,
      metadata: { providerBudgetNotes: marketDataProviderBudgetNotes(marketCode, body.action) },
    });
    let jobId: string | null = null;
    let singletonKey = "";
    if (app.boss) {
      if (body.action === "sync_catalog") {
        singletonKey = catalogSyncRerunSingletonKey(marketCode);
        jobId = await app.boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: [marketCode], providerOperationId: operation.id },
          { singletonKey, priority: 5 },
        );
      } else if (body.action === "refresh_fx_rates") {
        const today = today_utc();
        singletonKey = "fx-refresh";
        jobId = await app.boss.send(
          FX_REFRESH_QUEUE,
          {
            trigger: "manual" as const,
            startDate: today,
            endDate: today,
            bases: [...STORED_QUOTES],
            providerOperationId: operation.id,
          },
          { singletonKey, priority: 5 },
        );
      } else if (body.action === "sync_asx_gics") {
        singletonKey = ASX_GICS_SYNC_SINGLETON_KEY;
        jobId = await app.boss.send(
          ASX_GICS_SYNC_QUEUE,
          { providerOperationId: operation.id },
          { singletonKey, priority: 5 },
        );
      }
    }
    const updated = await finalizeCollapsedMarketActionOperation(operation, {
      ...context,
      jobId,
      singletonKey: singletonKey || `${marketCode}:${body.action}`,
      queueAvailable: app.boss !== null,
    });
    await app.persistence.createProviderOperationLog({
      operationId: updated.id,
      phase: updated.phase,
      level: "info",
      message: `market_data_action_${updated.phase} provider=${providerId} market=${marketCode} action=${body.action}`,
      context: { providerId, marketCode, action: body.action, jobId, singletonKey },
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "provider_fixer_operation",
      ipAddress: context.ipAddress,
      metadata: {
        operationId: updated.id,
        action: "market_data_action_execute",
        providerId,
        marketCode,
        operationType: body.action,
        jobId,
        singletonKey,
      },
    });
    return {
      operationId: updated.id,
      marketCode,
      providerId,
      action: body.action,
      status: updated.phase === "completed" ? "completed" : "queued",
      jobId,
      message: app.boss === null
        ? "Queue unavailable; operation recorded without dispatch."
        : jobId === null
          ? "Existing singleton job already covers this action."
          : "Provider-owned action queued.",
    };
  }

  app.get("/market-data", async (req): Promise<AdminMarketDataLandingResponse> => {
    requireAdminRole(req);
    const markets = await Promise.all((["TW", "US", "AU", "KR", "JP", "FX"] as const).map(marketTile));
    return { markets };
  });

  app.get("/market-data/:marketCode/overview", async (req): Promise<AdminMarketDataOverviewResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    return marketOverview(marketCode);
  });

  app.get("/market-data/:marketCode/unresolved", async (req): Promise<AdminMarketDataUnresolvedResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_unresolved_not_supported", "FX does not expose unresolved rows in this scope");
    }
    const query = z.object({
      providerId: providerFixerProviderSchema.optional(),
      state: z.enum(["all", "active", "resolved", "unsupported", "ignored"]).default("active"),
      errorCode: z.string().trim().min(1).max(120).optional(),
      search: z.string().trim().max(120).optional(),
      sort: z.enum(["last_seen_desc", "updated_desc", "source_symbol_asc", "occurrence_count_desc"]).default("last_seen_desc"),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(25),
    }).parse(req.query ?? {});
    if (query.providerId && !providerIdsForMarket(marketCode).includes(query.providerId)) {
      throw routeError(400, "provider_market_mismatch", "Provider does not belong to this market workspace");
    }
    const rows = await listAllProviderUnresolvedItemsForMarket({
      marketCode,
      providerId: query.providerId,
      state: query.state,
      errorCode: query.errorCode,
      search: query.search,
    });
    const sorted = rows.sort(marketUnresolvedSortComparator(query.sort));
    const offset = (query.page - 1) * query.limit;
    const items = await Promise.all(sorted.slice(offset, offset + query.limit).map(marketUnresolvedItemToDto));
    return {
      marketCode,
      providers: MARKET_DATA_WORKSPACES[marketCode].providers,
      filters: {
        providerId: query.providerId ?? null,
        state: query.state,
        errorCode: query.errorCode ?? null,
        search: query.search ?? null,
        sort: query.sort,
      },
      summary: summarizeMarketUnresolvedRows(rows),
      items,
      total: sorted.length,
      page: query.page,
      limit: query.limit,
    };
  });

  app.post("/market-data/:marketCode/unresolved/state", async (req): Promise<AdminMarketDataUnresolvedStateResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_unresolved_not_supported", "FX does not expose unresolved rows in this scope");
    }
    const body = z.object({
      providerId: providerFixerProviderSchema,
      errorCode: z.string().trim().min(1).max(120),
      sourceSymbol: z.string().trim().min(1).max(80),
      state: z.enum(["active", "ignored", "unsupported"]),
      reason: z.string().trim().max(240).optional(),
    }).strict().parse(req.body ?? {});
    if (!providerIdsForMarket(marketCode).includes(body.providerId)) {
      throw routeError(400, "provider_market_mismatch", "Provider does not belong to this market workspace");
    }
    const action = body.state === "active" ? "reopen_unresolved" : body.state === "ignored" ? "ignore_unresolved" : "mark_unsupported";
    const operation = await app.persistence.createProviderOperation({
      providerId: body.providerId,
      marketCode,
      operationType: action,
      phase: "running",
      errorCode: body.errorCode,
      scopeQuery: `${marketCode}:unresolved:${action}:${body.sourceSymbol}`,
      snapshotHash: hashProviderFixerToken(`${body.providerId}:${marketCode}:${body.errorCode}:${body.sourceSymbol}:${body.state}`).slice(0, 12),
      matchCount: 1,
      metadata: {
        marketDataBff: true,
        sourceSymbol: body.sourceSymbol,
        targetState: body.state,
        reason: body.reason ?? null,
        progressPercent: 0,
      },
      actorUserId: sessionUserId,
      startedAt: new Date().toISOString(),
    });
    let updated: Awaited<ReturnType<typeof app.persistence.updateProviderUnresolvedItemState>>;
    try {
      updated = await app.persistence.updateProviderUnresolvedItemState({
        providerId: body.providerId,
        marketCode,
        errorCode: body.errorCode,
        sourceSymbol: body.sourceSymbol,
        state: body.state,
        actorUserId: sessionUserId,
        reason: body.reason ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Provider unresolved lifecycle update failed.";
      const failed = await app.persistence.updateProviderOperation({
        id: operation.id,
        phase: "failed",
        completedAt: new Date().toISOString(),
        metadata: {
          ...(asRecord(operation.metadata) ?? {}),
          progressPercent: 100,
          failureReason: message,
          failureName: err instanceof Error ? err.name : "UnknownError",
        },
      });
      await app.persistence.upsertProviderOperationOutcome({
        operationId: operation.id,
        providerId: body.providerId,
        marketCode,
        sourceSymbol: body.sourceSymbol,
        providerSymbol: body.sourceSymbol,
        action,
        state: "failed",
        message,
        errorCode: "provider_unresolved_state_update_failed",
        evidence: { targetState: body.state, reason: body.reason ?? null },
      });
      await app.persistence.createProviderOperationLog({
        operationId: operation.id,
        phase: failed.phase,
        level: "error",
        message: `${action}_failed provider=${body.providerId} market=${marketCode} source_symbol=${body.sourceSymbol} reason=${message}`,
        context: { providerId: body.providerId, marketCode, errorCode: body.errorCode, sourceSymbol: body.sourceSymbol, errorMessage: message },
      });
      await app.eventBus.publishEvent(sessionUserId, "provider_operation_phase_changed", {
        operationId: operation.id,
        providerId: body.providerId,
        phase: failed.phase,
      });
      throw err;
    }
    await app.persistence.upsertProviderOperationOutcome({
      operationId: operation.id,
      providerId: body.providerId,
      marketCode,
      sourceSymbol: updated.sourceSymbol,
      providerSymbol: updated.providerSymbol,
      action,
      state: "succeeded",
      message: `Set unresolved item ${updated.sourceSymbol} to ${updated.state}.`,
      evidence: { targetState: updated.state, reason: body.reason ?? null },
    });
    await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 100,
        completedState: updated.state,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action,
        providerId: body.providerId,
        marketCode,
        errorCode: updated.errorCode,
        sourceSymbol: updated.sourceSymbol,
        state: updated.state,
      },
    });
    return {
      operationId: operation.id,
      item: await marketUnresolvedItemToDto(updated),
    };
  });

  app.post("/market-data/:marketCode/unresolved/state/bulk", async (req): Promise<AdminMarketDataUnresolvedBulkStateResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_unresolved_not_supported", "FX does not expose unresolved rows in this scope");
    }
    const body = z.object({
      scope: z.object({
        type: z.enum(["selected_items", "filter"]),
        items: z.array(z.object({
          providerId: providerFixerProviderSchema,
          marketCode: providerFixerMarketCodeSchema,
          errorCode: z.string().trim().min(1).max(120),
          sourceSymbol: z.string().trim().min(1).max(80),
        }).strict()).optional(),
        filter: z.object({
          providerId: providerFixerProviderSchema.optional(),
          state: z.enum(["all", "active", "resolved", "unsupported", "ignored"]).optional(),
          errorCode: z.string().trim().min(1).max(120).optional(),
          search: z.string().trim().max(120).optional(),
        }).strict().optional(),
      }).strict(),
      state: z.enum(["active", "ignored", "unsupported"]),
      acknowledged: z.boolean().optional(),
      typedConfirmation: z.string().trim().max(160).optional(),
      reason: z.string().trim().max(240).optional(),
    }).strict().parse(req.body ?? {}) satisfies AdminMarketDataUnresolvedBulkStateRequest;
    const scopeItems = (await listMarketUnresolvedScopeItems({ marketCode, scope: body.scope }))
      .filter((item) => item.marketCode === marketCode)
      .filter((item) => body.scope.type === "filter" || item.state === "active" || body.state === "active");
    if (scopeItems.length === 0) {
      throw routeError(409, "provider_scope_items_not_active", "No unresolved rows match this scope");
    }
    const dangerous = body.scope.type === "filter" || scopeItems.length >= 100;
    const confirmationText = marketBulkUnresolvedStateConfirmationText(body.state, scopeItems.length);
    if (dangerous) {
      if (body.typedConfirmation !== confirmationText) {
        throw routeError(400, "provider_fixer_typed_confirmation_required", "Bulk unresolved state change requires matching typed confirmation");
      }
    } else if (body.acknowledged !== true) {
      throw routeError(400, "provider_fixer_acknowledgement_required", "Bulk unresolved state change requires explicit acknowledgement");
    }
    const action = body.state === "active" ? "reopen_unresolved" : body.state === "ignored" ? "ignore_unresolved" : "mark_unsupported";
    const providerId = body.scope.filter?.providerId ?? scopeItems[0]!.providerId;
    const duplicateOutcomeSourceSymbols = duplicateProviderUnresolvedOutcomeSourceSymbols(scopeItems);
    const operation = await app.persistence.createProviderOperation({
      providerId,
      marketCode,
      operationType: action,
      phase: "running",
      errorCode: body.scope.filter?.errorCode ?? null,
      scopeQuery: `${marketCode}:unresolved:${body.scope.type}:${body.state}`,
      snapshotHash: hashProviderFixerToken(`${marketCode}:${body.state}:${scopeItems.length}:${confirmationText}`).slice(0, 12),
      matchCount: scopeItems.length,
      metadata: {
        marketDataBff: true,
        targetState: body.state,
        confirmationText: dangerous ? confirmationText : null,
        progressPercent: 0,
      },
      actorUserId: sessionUserId,
      startedAt: new Date().toISOString(),
    });
    let succeeded = 0;
    let failed = 0;
    for (const item of scopeItems) {
      try {
        const updated = await app.persistence.updateProviderUnresolvedItemState({
          providerId: item.providerId,
          marketCode: item.marketCode,
          errorCode: item.errorCode,
          sourceSymbol: item.sourceSymbol,
          state: body.state,
          actorUserId: sessionUserId,
          reason: body.reason ?? null,
        });
        succeeded += 1;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: item.providerId,
          marketCode: item.marketCode,
          sourceSymbol: providerUnresolvedOutcomeSourceSymbol(updated, duplicateOutcomeSourceSymbols),
          providerSymbol: updated.providerSymbol,
          action,
          state: "succeeded",
          message: `Set unresolved item ${updated.sourceSymbol} to ${updated.state}.`,
          evidence: providerUnresolvedOutcomeEvidence(updated, { targetState: updated.state, reason: body.reason ?? null }),
        });
      } catch (err) {
        failed += 1;
        await app.persistence.upsertProviderOperationOutcome({
          operationId: operation.id,
          providerId: item.providerId,
          marketCode: item.marketCode,
          sourceSymbol: providerUnresolvedOutcomeSourceSymbol(item, duplicateOutcomeSourceSymbols),
          providerSymbol: item.providerSymbol,
          action,
          state: "failed",
          message: err instanceof Error ? err.message : "Provider unresolved lifecycle update failed.",
          errorCode: "provider_unresolved_state_update_failed",
          evidence: providerUnresolvedOutcomeEvidence(item, { targetState: body.state, reason: body.reason ?? null }),
        });
      }
    }
    await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: failed > 0 ? "failed" : "completed",
      completedAt: new Date().toISOString(),
      metadata: {
        ...(asRecord(operation.metadata) ?? {}),
        progressPercent: 100,
        succeeded,
        failed,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: operation.id,
        action: `${action}_bulk`,
        marketCode,
        state: body.state,
        succeeded,
        failed,
      },
    });
    return {
      operationId: operation.id,
      updatedCount: succeeded,
      succeeded,
      failed,
    };
  });

  app.get("/market-data/:marketCode/actions", async (req): Promise<AdminMarketDataActionsResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    return { marketCode, actions: marketDataActions(marketCode) };
  });

  app.post("/market-data/:marketCode/actions/execute", async (req): Promise<AdminMarketDataActionExecuteResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    const body = marketDataActionExecuteBodySchema.parse(req.body ?? {}) satisfies AdminMarketDataActionExecuteRequest;
    return executeMarketDataAction(marketCode, body, { actorUserId: sessionUserId, ipAddress });
  });

  app.get("/market-data/:marketCode/instruments", async (req): Promise<AdminMarketDataInstrumentsResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_instruments_not_supported", "FX does not expose instruments in this scope");
    }
    const query = z
      .object({
        status: marketDataInstrumentStatusSchema.default("all"),
        supportState: z.union([marketDataSupportStateSchema, z.literal("all")]).default("all"),
        search: z.string().trim().max(120).optional(),
        instrumentType: z.union([z.enum(["STOCK", "ETF", "BOND_ETF"]), z.literal("all")]).default("all"),
        backfillStatus: marketDataBackfillStatusSchema.default("all"),
        sort: marketDataInstrumentSortSchema.default("ticker_asc"),
        page: z.coerce.number().int().min(1).default(1),
        limit: z.coerce.number().int().min(1).max(200).default(50),
      })
      .parse(req.query ?? {});

    const { items, total, page, limit } = await app.persistence.listAdminInstruments({
      marketCode,
      page: query.page,
      limit: query.limit,
      status: query.status,
      supportState: query.supportState,
      search: query.search,
      instrumentType: query.instrumentType,
      backfillStatus: query.backfillStatus,
      sort: query.sort,
    });
    const fallbackPolicies = await app.persistence.listQuoteFallbackPoliciesForTickerMarkets(
      items.map((item) => ({
        ticker: item.ticker,
        marketCode: item.marketCode as MarketCode,
      })),
    );
    const fallbackPolicyByTickerMarket = new Map(
      fallbackPolicies.map((policy) => [`${policy.marketCode}:${policy.ticker}`, policy] as const),
    );
    const {
      getEffectiveCatalogAbsenceThreshold,
      getEffectiveCatalogAbsenceGuardPercent,
      getEffectiveCatalogAbsenceGuardFloor,
    } = await import("../services/appConfig/catalogAbsence.js");

    return {
      marketCode,
      items: items.map((item) => adminInstrumentRowToMarketDataDto(
        item,
        fallbackPolicyByTickerMarket.get(`${item.marketCode}:${item.ticker}`) ?? null,
      )),
      total,
      page,
      limit,
      thresholds: {
        catalogAbsenceThreshold: getEffectiveCatalogAbsenceThreshold(),
        catalogAbsenceGuardPercent: getEffectiveCatalogAbsenceGuardPercent(),
        catalogAbsenceGuardFloor: getEffectiveCatalogAbsenceGuardFloor(),
      },
      filters: {
        status: ["all", "listed", "delisted", "excluded"],
        supportState: ["all", "supported", "retired_by_admin", "unsupported_by_provider"],
        backfillStatus: ["all", "pending", "backfilling", "ready", "failed"],
        instrumentType: ["all", "STOCK", "ETF", "BOND_ETF"],
        sort: ["ticker_asc", "ticker_desc", "updated_desc", "updated_asc"],
      },
    };
  });

  app.post("/market-data/:marketCode/quote-fallback-policies/upsert", async (req): Promise<QuoteFallbackPolicyResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_instruments_not_supported", "FX does not expose quote fallback policies");
    }
    const body = quoteFallbackPolicyBodySchema.parse(req.body ?? {}) satisfies QuoteFallbackPolicyUpsertRequest;
    if (body.marketCode !== marketCode) {
      throw routeError(400, "market_code_mismatch", "Request body marketCode must match the route marketCode.");
    }
    assertQuoteFallbackMarketSupported(body.marketCode);
    const ticker = body.ticker.trim().toUpperCase();
    const instrument = await app.persistence.getInstrument(ticker, body.marketCode);
    if (!instrument) {
      throw routeError(404, "instrument_not_found", "Instrument not found.");
    }
    const before = await app.persistence.getQuoteFallbackPolicy(ticker, body.marketCode);
    const policy = await app.persistence.upsertQuoteFallbackPolicy({
      marketCode: body.marketCode,
      ticker,
      provider: body.provider,
      priceType: body.priceType,
      providerSymbol: body.providerSymbol,
      active: body.active ?? true,
      reason: body.reason ?? null,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: before ? "quote_fallback_policy_updated" : "quote_fallback_policy_created",
      metadata: {
        marketCode: body.marketCode,
        ticker,
        provider: body.provider,
        priceType: body.priceType,
        before: before ? quoteFallbackPolicyToDto(before) : null,
        after: quoteFallbackPolicyToDto(policy),
      },
      ipAddress,
    });
    return { policy: quoteFallbackPolicyToDto(policy)! };
  });

  app.post("/market-data/:marketCode/quote-fallback-policies/deactivate", async (req): Promise<QuoteFallbackPolicyResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_instruments_not_supported", "FX does not expose quote fallback policies");
    }
    const body = quoteFallbackPolicyTargetSchema.parse(req.body ?? {});
    if (body.marketCode !== marketCode) {
      throw routeError(400, "market_code_mismatch", "Request body marketCode must match the route marketCode.");
    }
    assertQuoteFallbackMarketSupported(body.marketCode);
    const before = await app.persistence.getQuoteFallbackPolicy(body.ticker, body.marketCode);
    const policy = await app.persistence.deactivateQuoteFallbackPolicy(body);
    if (!policy) {
      throw routeError(404, "quote_fallback_policy_not_found", "Quote fallback policy not found.");
    }
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "quote_fallback_policy_deactivated",
      metadata: {
        marketCode: body.marketCode,
        ticker: body.ticker.trim().toUpperCase(),
        before: before ? quoteFallbackPolicyToDto(before) : null,
        after: quoteFallbackPolicyToDto(policy),
      },
      ipAddress,
    });
    return { policy: quoteFallbackPolicyToDto(policy)! };
  });

  app.post("/market-data/:marketCode/quote-fallback-policies/refresh", async (req): Promise<QuoteFallbackPolicyRefreshResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_instruments_not_supported", "FX does not expose quote fallback policies");
    }
    const body = quoteFallbackPolicyTargetSchema.parse(req.body ?? {});
    if (body.marketCode !== marketCode) {
      throw routeError(400, "market_code_mismatch", "Request body marketCode must match the route marketCode.");
    }
    assertQuoteFallbackMarketSupported(body.marketCode);
    const ticker = body.ticker.trim().toUpperCase();
    const policy = await app.persistence.getQuoteFallbackPolicy(ticker, body.marketCode);
    if (!policy || !policy.active) {
      throw routeError(404, "quote_fallback_policy_not_found", "Active quote fallback policy not found.");
    }
    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available.");
    }
    const config = await app.persistence.getAppConfig();
    const budget = await app.persistence.getEodhdCallBudgetStatus({
      budgetDate: new Date().toISOString().slice(0, 10),
      limit: config.eodhdDailyCallLimit ?? Env.EODHD_DAILY_CALL_LIMIT,
    });
    const jobId = await app.boss.send(
      QUOTE_FALLBACK_REFRESH_QUEUE,
      {
        kind: "policy_refresh" as const,
        ticker,
        marketCode: body.marketCode,
        requestedAt: new Date().toISOString(),
        trigger: "manual" as const,
      },
      {
        singletonKey: quoteFallbackRefreshSingletonKey(ticker, body.marketCode),
        priority: 5,
      },
    );
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "quote_fallback_manual_refresh_requested",
      metadata: {
        marketCode: body.marketCode,
        ticker,
        policyId: policy.id,
        queued: jobId !== null,
        jobId,
        remainingCalls: budget.remaining,
      },
      ipAddress,
    });
    return {
      policy: quoteFallbackPolicyToDto(policy)!,
      refreshed: false,
      remainingCalls: budget.remaining,
      message: jobId === null ? "Refresh already queued." : "Refresh queued.",
    };
  });

  app.post("/market-data/:marketCode/instruments/support-state", async (req): Promise<AdminMarketDataSupportStateResponse> => {
    requireAdminRole(req);
    const { sessionUserId } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") {
      throw routeError(404, "market_instruments_not_supported", "FX does not expose instruments in this scope");
    }
    const body = z
      .object({
        ticker: z.string().trim().min(1).max(40),
        marketCode: providerFixerMarketCodeSchema,
        supportState: marketDataSupportStateSchema,
      })
      .strict()
      .parse(req.body ?? {}) satisfies AdminMarketDataSupportStateRequest;
    if (body.marketCode !== marketCode) {
      throw routeError(400, "market_mismatch", "Instrument marketCode must match the route market");
    }
    const row = await app.persistence.setInstrumentSupportState(
      body.ticker,
      body.marketCode,
      body.supportState as AdminInstrumentSupportState,
      sessionUserId,
    );
    await app.persistence.createMarketCalendarActivityEvent({
      marketCode,
      category: "instrument",
      result: "success",
      sourceKind: "system",
      sourceId: "admin-market-data",
      eventType: "instrument_support_state_updated",
      title: "Instrument support state updated",
      message: `${body.ticker} support state set to ${body.supportState}.`,
      ticker: body.ticker,
      dedupeKey: `instrument-support-state:${marketCode}:${body.ticker}:${body.supportState}:${Date.now()}`,
      detail: { actorUserId: sessionUserId, supportState: body.supportState },
    });
    return { instrument: adminInstrumentRowToMarketDataDto(row) };
  });

  app.post("/market-data/:marketCode/instruments/delisting-override", async (req): Promise<AdminMarketDataDelistingOverrideResponse> => {
    requireAdminRole(req);
    const { sessionUserId } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode !== "AU" && marketCode !== "KR") {
      throw routeError(400, "delisting_override_not_supported", "Delisting overrides are only available for AU and KR instruments");
    }
    const body = z
      .object({
        ticker: z.string().trim().min(1).max(40),
        marketCode: providerFixerMarketCodeSchema,
        action: z.enum([
          "exclude_from_delisting_detection",
          "include_in_delisting_detection",
          "clear_delisted_state",
        ]),
      })
      .strict()
      .parse(req.body ?? {}) satisfies AdminMarketDataDelistingOverrideRequest;
    if (body.marketCode !== marketCode) {
      throw routeError(400, "market_mismatch", "Instrument marketCode must match the route market");
    }
    const row =
      body.action === "clear_delisted_state"
        ? await app.persistence.undeleteInstrument(body.ticker, body.marketCode, sessionUserId)
        : await app.persistence.setInstrumentDelistingDetectionExcluded(
            body.ticker,
            body.marketCode,
            body.action === "exclude_from_delisting_detection",
            sessionUserId,
          );
    await app.persistence.createMarketCalendarActivityEvent({
      marketCode,
      category: "instrument",
      result: "success",
      sourceKind: "system",
      sourceId: "admin-market-data",
      eventType: "instrument_delisting_override_updated",
      title: "Instrument delisting override updated",
      message: `${body.ticker} delisting override action ${body.action}.`,
      ticker: body.ticker,
      dedupeKey: `instrument-delisting-override:${marketCode}:${body.ticker}:${body.action}:${Date.now()}`,
      detail: { actorUserId: sessionUserId, action: body.action },
    });
    return { instrument: adminInstrumentRowToMarketDataDto(row) };
  });

  app.get("/market-data/:marketCode/operations", async (req): Promise<AdminMarketDataOperationsResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
	    const query = z
	      .object({
	        providerId: providerFixerProviderSchema.optional(),
	        operationType: z.string().trim().min(1).max(120).optional(),
	        phase: providerFixerPhaseSchema.optional(),
	        search: z.string().trim().max(120).optional(),
	        from: isoDateTimeFilterSchema.optional(),
	        to: isoDateTimeFilterSchema.optional(),
	        includeOperationId: z.string().trim().min(1).max(120).optional(),
	        page: z.coerce.number().int().min(1).default(1),
	        limit: z.coerce.number().int().min(1).max(200).default(25),
	      })
	      .superRefine((value, ctx) => {
	        const normalizedTo = normalizeDateOnlyEndFilter(value.to);
	        if (value.from && normalizedTo && Date.parse(value.from) > Date.parse(normalizedTo)) {
	          ctx.addIssue({
	            code: z.ZodIssueCode.custom,
	            message: "from must be before or equal to to",
	            path: ["from"],
	          });
	        }
	      })
	      .parse(req.query ?? {});
    const workspace = MARKET_DATA_WORKSPACES[marketCode];
    const workspaceProviderIds = providerIdsForMarket(marketCode);
    const providerId = query.providerId ?? (marketCode === "FX" ? workspace.defaultBackfillProviderId ?? workspaceProviderIds[0] : undefined);
    if (providerId && !workspaceProviderIds.includes(providerId)) {
      throw routeError(400, "provider_market_mismatch", "Provider does not belong to this market workspace");
    }
    const config = await loadAppConfigDto(app);
    const createdBefore = normalizeDateOnlyEndFilter(query.to);
	    const result = await app.persistence.listProviderOperations({
	      providerId,
	      marketCode: marketCode === "FX" ? undefined : marketCode,
	      operationTypes: query.operationType ? [query.operationType] : undefined,
	      phases: query.phase ? [query.phase as ProviderOperationPhase] : undefined,
      search: query.search,
      createdAfter: query.from,
      createdBefore,
      includeOperationId: query.includeOperationId,
	      page: query.page,
	      limit: query.limit,
	    });
	    const availableFilterItems: ProviderOperationRecord[] = [];
	    let availableFilterPage = 1;
	    let availableFilterTotal = Number.POSITIVE_INFINITY;
	    while (availableFilterItems.length < availableFilterTotal) {
	      const availableFilterResult = await app.persistence.listProviderOperations({
	        providerId,
	        marketCode: marketCode === "FX" ? undefined : marketCode,
	        search: query.search,
	        createdAfter: query.from,
	        createdBefore,
	        page: availableFilterPage,
	        limit: 500,
	      });
	      availableFilterTotal = availableFilterResult.total;
	      if (availableFilterResult.items.length === 0) break;
	      availableFilterItems.push(...availableFilterResult.items);
	      availableFilterPage += 1;
	    }
	    const availableFilterScopedItems = availableFilterItems.filter((operation) =>
	      marketDataOperationMatchesListFilters(operation, {
	        workspaceProviderIds,
	        providerId,
	        marketCode,
	        search: query.search,
	        from: query.from,
	        to: createdBefore,
	      }),
	    );
	    const availableOperationTypes = Array.from(new Set([
	      ...availableFilterScopedItems.map((operation) => operation.operationType),
	      ...(query.operationType ? [query.operationType] : []),
	    ])).sort((a, b) => a.localeCompare(b));
	    const availablePhases = Array.from(new Set([
	      ...availableFilterScopedItems.map((operation) => operation.phase),
	      ...(query.phase ? [query.phase as ProviderOperationPhase] : []),
	    ])).sort((a, b) => a.localeCompare(b));
	    const items = result.items
	      .filter((operation) => workspaceProviderIds.includes(operation.providerId))
	      .map((operation) => marketDataOperationToDto(operation, config));
    const selectedOperationRecord = query.includeOperationId
      ? result.items.find((operation) => operation.id === query.includeOperationId)
        ?? await app.persistence.getProviderOperation(query.includeOperationId)
      : null;
	    const selectedOperation = selectedOperationRecord
	      && marketDataOperationMatchesListFilters(selectedOperationRecord, {
	        workspaceProviderIds,
	        providerId,
	        marketCode,
	        operationType: query.operationType,
	        phase: query.phase as ProviderOperationPhase | undefined,
	        search: query.search,
	        from: query.from,
	        to: createdBefore,
	      })
	        ? marketDataOperationToDto(selectedOperationRecord, config)
	        : null;
    return {
      marketCode,
      providers: workspace.providers,
      selectedOperation,
      selectedOperationIsOffPage:
        selectedOperation !== null && !items.some((operation) => operation.id === selectedOperation.id),
      items,
      filters: {
        providerId: providerId ?? null,
        operationType: query.operationType ?? null,
        phase: query.phase ?? null,
	        search: query.search ?? null,
	        from: query.from ?? null,
	        to: query.to ?? null,
	      },
	      availableFilters: {
	        operationTypes: availableOperationTypes,
	        phases: availablePhases as AdminMarketDataOperationsResponse["availableFilters"]["phases"],
	      },
	      total: result.total,
      page: result.page,
      limit: result.limit,
    };
  });

  app.get("/market-data/:marketCode/operations/:operationId/logs", async (req): Promise<AdminMarketDataOperationLogsResponse> => {
    requireAdminRole(req);
    const { marketCode, operationId } = marketDataWorkspaceParamSchema.extend({
      operationId: z.string().trim().min(1).max(120),
    }).parse(req.params);
	    const query = z.object({
	      page: z.coerce.number().int().min(1).default(1),
	      limit: z.coerce.number().int().min(1).max(200).default(25),
	    }).parse(req.query ?? {});
	    const operation = await app.persistence.getProviderOperation(operationId);
	    const workspaceProviderIds = providerIdsForMarket(marketCode);
	    if (
	      !operation
	      || !workspaceProviderIds.includes(operation.providerId)
	      || (marketCode === "FX" ? operation.marketCode !== "FX" : operation.marketCode !== marketCode)
	    ) {
	      throw routeError(404, "market_operation_not_found", "Market data operation not found");
	    }
    const logs = await app.persistence.listProviderOperationLogs({ operationId, page: query.page, limit: query.limit });
    return {
      marketCode: marketCode as AdminMarketDataOperationLogsResponse["marketCode"],
      operationId,
      items: logs.items.map((item) => ({
        id: String(item.id),
        operationId: item.operationId,
        level: item.level,
        occurredAt: item.createdAt,
        phase: item.phase,
        message: item.message,
        detail: item.detail,
        context: sanitizeAllowlistedRecord(item.context, MARKET_DATA_LOG_CONTEXT_ALLOWLIST),
      })),
      total: logs.total,
      page: logs.page,
      limit: logs.limit,
    };
  });

  app.get("/market-data/:marketCode/logs", async (req) => {
    requireAdminRole(req);
    marketDataWorkspaceParamSchema.parse(req.params);
    throw routeError(404, "market_logs_retired", "Market Data logs were replaced by Activity");
  });

  app.get("/market-data/:marketCode/activity", async (req): Promise<AdminMarketDataActivityResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (!isOfficialCalendarMarketCode(marketCode)) {
      throw routeError(404, "market_activity_not_supported", "Activity is only supported for TW, US, AU, KR, and JP");
    }
    const query = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(200).default(25),
      search: z.string().trim().optional(),
      category: z.string().trim().optional(),
      categories: z.string().trim().optional(),
      result: z.string().trim().optional(),
      results: z.string().trim().optional(),
      source: z.string().trim().optional(),
      sourceId: z.string().trim().optional(),
      sourceIds: z.string().trim().optional(),
      sourceKind: z.string().trim().optional(),
      sources: z.string().trim().optional(),
      timeRange: z.enum(["24h", "48h", "7d", "30d", "all"]).default("24h"),
    }).parse(req.query ?? {});
    const parseCsv = (value?: string) => value
      ? value.split(",").map((item) => item.trim()).filter((item) => item.length > 0 && item !== "all")
      : undefined;
    const categories = parseCsv(query.categories ?? query.category) as AdminMarketDataActivityResponse["filters"]["categories"] | undefined;
    const results = parseCsv(query.results ?? query.result) as AdminMarketDataActivityResponse["filters"]["results"] | undefined;
    const sourceKinds = parseCsv(query.sourceKind ?? query.sources ?? query.source) as AdminMarketDataActivityResponse["filters"]["sourceKinds"] | undefined;
    const sourceIds = parseCsv(query.sourceIds ?? query.sourceId);
    const occurredAfter = resolveActivityOccurredAfter(query.timeRange, new Date());
    const baseActivityQuery = {
      marketCode,
      search: query.search,
      categories,
      sourceKinds,
      sourceIds,
      occurredAfter,
    };
    const activity = await app.persistence.listMarketCalendarActivity({
      ...baseActivityQuery,
      page: query.page,
      limit: query.limit,
      results,
    });
    const config = await loadAppConfigDto(app);
    const retentionConfig = config.tickerPriceFreshness;
    const [successCount, warningCount, errorCount, skippedCount, rateLimitedCount] = await Promise.all([
      app.persistence.listMarketCalendarActivity({ ...baseActivityQuery, page: 1, limit: 1, results: ["success"] }),
      app.persistence.listMarketCalendarActivity({ ...baseActivityQuery, page: 1, limit: 1, results: ["warning"] }),
      app.persistence.listMarketCalendarActivity({ ...baseActivityQuery, page: 1, limit: 1, results: ["error"] }),
      app.persistence.listMarketCalendarActivity({ ...baseActivityQuery, page: 1, limit: 1, results: ["skipped"] }),
      app.persistence.listMarketCalendarActivity({ ...baseActivityQuery, page: 1, limit: 1, results: ["rate_limited"] }),
    ]);
    const selectedResults = results ? new Set(results) : null;
    const visibleResultCount = (value: "success" | "warning" | "error" | "skipped" | "rate_limited", count: number) =>
      selectedResults && !selectedResults.has(value) ? 0 : count;
    const summary: AdminMarketDataActivityResponse["summary"] = {
      success: visibleResultCount("success", successCount.total),
      warning: visibleResultCount("warning", warningCount.total),
      error: visibleResultCount("error", errorCount.total),
      skipped: visibleResultCount("skipped", skippedCount.total),
      rateLimited: visibleResultCount("rate_limited", rateLimitedCount.total),
      total: activity.total,
      hiddenSuccessCount: selectedResults && !selectedResults.has("success") ? successCount.total : 0,
    };
    return {
      marketCode,
      filters: {
        categories: ["intraday_price", "daily_close", "calendar", "provider_operation", "provider_error", "instrument", "system"],
        results: ["success", "warning", "error", "skipped", "rate_limited"],
        sourceKinds: ["yahoo_chart", "official_calendar", "twse_close", "finmind", "provider", "system"],
        timeRanges: ["24h", "48h", "7d", "30d", "all"],
      },
      summary,
      retention: {
        detailedDays: retentionConfig.effectiveActivityDetailedRetentionDays,
        summaryDays: retentionConfig.effectiveActivitySummaryRetentionDays,
        calendarHistoryDays: retentionConfig.effectiveCalendarHistoryRetentionDays,
      },
      items: activity.items.map((item) => ({
        ...item,
        marketCode,
        detail: { ...item.detail },
      })),
      total: activity.total,
      page: activity.page,
      limit: activity.limit,
    };
  });

  app.get("/market-data/:marketCode/calendar/status", async (req): Promise<AdminMarketCalendarStatusResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (!isOfficialCalendarMarketCode(marketCode)) {
      throw routeError(404, "market_calendar_not_supported", "Calendar management is only supported for TW, US, AU, KR, and JP");
    }
    return buildAdminMarketCalendarStatus(app.persistence, marketCode, new Date());
  });

  app.get("/market-data/:marketCode/calendar", async (req) => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (!isOfficialCalendarMarketCode(marketCode)) {
      throw routeError(404, "market_calendar_not_supported", "Calendar management is only supported for TW, US, AU, KR, and JP");
    }
    const [status, history] = await Promise.all([
      buildAdminMarketCalendarStatus(app.persistence, marketCode, new Date()),
      buildAdminMarketCalendarHistory(app.persistence, marketCode),
    ]);
    const defaultSource = status.sources.find((source) => source.isDefault) ?? status.sources[0] ?? null;
    const activeCalendarYears = [...new Set([
      ...status.years.map((year) => year.calendarYear),
      ...history.items.map((item) => item.calendarYear),
    ])].sort((left, right) => right - left);
    const activeCalendarVersions = (await Promise.all(activeCalendarYears.map((calendarYear) =>
      app.persistence.getActiveMarketCalendarVersion(marketCode, calendarYear))))
      .filter((version): version is NonNullable<typeof version> => version !== null && version.status === "confirmed" && version.isActive);
    return {
      marketCode,
      marketLabel: MARKET_DATA_WORKSPACES[marketCode].label,
      defaultSourceLabel: defaultSource?.label ?? null,
      defaultSourceUrl: defaultSource?.suggestedSourceUrl ?? null,
      years: status.years.map((year) => ({
        calendarYear: year.calendarYear,
        status: year.status,
        sourceLabel: year.sourceLabel,
        sourceUrl: year.sourceLabel ? defaultSource?.suggestedSourceUrl ?? null : null,
        versionLabel: year.activeVersionId,
        updatedAt: year.updatedAt,
        note: year.status === "missing"
          ? `${marketCode} market calendar for ${year.calendarYear} is missing. Today is ${status.localDate}.`
          : null,
      })),
      sources: status.sources.map((source) => ({
        sourceId: source.id,
        label: source.label,
        sourceType: source.sourceType,
        suggestedSourceUrl: source.suggestedSourceUrl,
        isDefault: source.isDefault,
        isActive: source.enabled,
        years: status.years
          .filter((year) => year.sourceLabel === source.label)
          .map((year) => year.calendarYear),
      })),
      activeCalendars: activeCalendarVersions.map((version) => ({
        marketCode,
        calendarYear: version.calendarYear,
        versionId: version.versionId,
        importOperationId: version.importOperationId,
        sourceLabel: version.sourceLabel,
        sourceType: version.sourceType,
        sourceUrl: version.sourceUrl,
        retrievedAt: version.retrievedAt,
        confirmedAt: version.confirmedAt,
        annualCounts: version.annualCounts,
        exceptions: version.exceptions,
        coverage: version.coverage,
      })),
      preview: null,
      history: history.items.map((item) => ({
        id: item.versionId,
        importOperationId: item.importOperationId,
        calendarYear: item.calendarYear,
        sourceLabel: item.sourceLabel ?? "Unknown source",
        importedAt: item.confirmedAt ?? item.retrievedAt,
        importedBy: null,
        status: item.status,
        note: item.invalidationReason,
      })),
      statusNote: `Today in ${marketCode} local market time is ${status.localDate}.`,
    };
  });

  app.get("/market-data/:marketCode/calendar/sources", async (req): Promise<AdminMarketCalendarSourceConfigDto[]> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (!isOfficialCalendarMarketCode(marketCode)) {
      throw routeError(404, "market_calendar_not_supported", "Calendar management is only supported for TW, US, AU, KR, and JP");
    }
    return (await app.persistence.listMarketCalendarSources(marketCode)).map((source) => ({
      ...source,
      marketCode,
    }));
  });

  app.post("/market-data/:marketCode/calendar/source", async (req) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    requireOfficialCalendarMarketCode(marketCode);
    const body = z.object({
      defaultSourceId: z.string().trim().min(1),
    }).parse(req.body ?? {});
    const source = (await app.persistence.listMarketCalendarSources(marketCode))
      .find((candidate) => candidate.id === body.defaultSourceId);
    if (!source) {
      throw routeError(404, "market_calendar_source_not_found", "Market calendar source not found");
    }
    const { previous, saved } = await updateAdminMarketCalendarSource(app.persistence, marketCode, source.id, {
      label: source.label,
      sourceType: source.sourceType,
      suggestedSourceUrl: source.suggestedSourceUrl,
      enabled: source.enabled,
      isDefault: true,
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "market_calendar_source_updated",
      ipAddress,
      metadata: { marketCode, sourceId: saved.id, previous, next: saved, mode: "default_source" },
    });
    await app.persistence.createMarketCalendarActivityEvent({
      marketCode,
      category: "calendar",
      result: "success",
      sourceKind: "official_calendar",
      sourceId: saved.id,
      eventType: "calendar_default_source_updated",
      title: "Default calendar source updated",
      message: `${saved.label} set as default source for ${marketCode}.`,
      calendarYear: null,
      dedupeKey: `calendar-default-source:${marketCode}:${saved.id}:${Date.now()}`,
      detail: { sourceId: saved.id },
    });
    const status = await buildAdminMarketCalendarStatus(app.persistence, marketCode, new Date());
    const history = await buildAdminMarketCalendarHistory(app.persistence, marketCode);
    const defaultSource = status.sources.find((item) => item.isDefault) ?? status.sources[0] ?? null;
    return {
      marketCode,
      marketLabel: MARKET_DATA_WORKSPACES[marketCode].label,
      defaultSourceLabel: defaultSource?.label ?? null,
      defaultSourceUrl: defaultSource?.suggestedSourceUrl ?? null,
      years: status.years.map((year) => ({
        calendarYear: year.calendarYear,
        status: year.status,
        sourceLabel: year.sourceLabel,
        sourceUrl: defaultSource?.suggestedSourceUrl ?? null,
        versionLabel: year.activeVersionId,
        updatedAt: year.updatedAt,
        note: year.status === "missing"
          ? `${marketCode} market calendar for ${year.calendarYear} is missing. Today is ${status.localDate}.`
          : null,
      })),
      sources: status.sources.map((item) => ({
        sourceId: item.id,
        label: item.label,
        sourceType: item.sourceType,
        suggestedSourceUrl: item.suggestedSourceUrl,
        isDefault: item.isDefault,
        isActive: item.enabled,
        years: status.years.filter((year) => year.sourceLabel === item.label).map((year) => year.calendarYear),
      })),
      preview: null,
      history: history.items.map((item) => ({
        id: item.versionId,
        importOperationId: item.importOperationId,
        calendarYear: item.calendarYear,
        sourceLabel: item.sourceLabel ?? "Unknown source",
        importedAt: item.confirmedAt ?? item.retrievedAt,
        importedBy: null,
        status: item.status,
        note: item.invalidationReason,
      })),
      statusNote: `Today in ${marketCode} local market time is ${status.localDate}.`,
    };
  });

  app.patch("/market-data/:marketCode/calendar/sources/:sourceId", async (req): Promise<AdminMarketCalendarSourceConfigDto> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode, sourceId } = z.object({
    marketCode: z.enum(["TW", "US", "AU", "KR", "JP"]),
      sourceId: z.string().trim().min(1),
    }).parse(req.params);
    const body = z.object({
      label: z.string().trim().min(1),
      sourceType: z.enum(["official_source", "manual_ai_assisted"]),
      suggestedSourceUrl: z.string().trim().url().nullable().optional(),
      enabled: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }).parse(req.body ?? {});
    const { previous, saved } = await updateAdminMarketCalendarSource(app.persistence, marketCode, sourceId, body);
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "market_calendar_source_updated",
      ipAddress,
      metadata: {
        marketCode,
        sourceId: saved.id,
        previous,
        next: saved,
      },
    });
    await app.persistence.createMarketCalendarActivityEvent({
      marketCode,
      category: "calendar",
      result: "success",
      sourceKind: "official_calendar",
      sourceId: saved.id,
      eventType: "calendar_source_updated",
      title: "Calendar source updated",
      message: `${saved.label} source updated for ${marketCode}.`,
      calendarYear: null,
      dedupeKey: `calendar-source-updated:${saved.id}:${Date.now()}`,
      detail: {
        sourceId: saved.id,
        previous,
        next: saved,
      },
    });
    return {
      ...saved,
      marketCode,
    };
  });

  app.post("/market-data/:marketCode/calendar/preview", async (req): Promise<AdminMarketCalendarPreviewResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    requireOfficialCalendarMarketCode(marketCode);
    const body = parseCalendarImportRequest(req.body);
    const preview = await previewAdminMarketCalendarImport(app.persistence, marketCode, body);
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "market_calendar_previewed",
      ipAddress,
      metadata: { marketCode, calendarYear: body.calendarYear, previewToken: preview.previewToken },
    });
    return preview;
  });

  app.post("/market-data/:marketCode/calendar/confirm", async (req): Promise<AdminMarketCalendarConfirmResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    requireOfficialCalendarMarketCode(marketCode);
    const confirmBody = z.object({
      previewToken: z.string().trim().min(1),
      replaceConfirmed: z.boolean().optional(),
      replacementReason: z.string().trim().nullable().optional(),
    }).safeParse(req.body ?? {});
    let body: AdminMarketCalendarConfirmRequest;
    if (confirmBody.success) {
      body = confirmBody.data;
    } else {
      const importRequest = parseCalendarImportRequest(req.body);
      const preview = await previewAdminMarketCalendarImport(app.persistence, marketCode, importRequest);
      body = {
        previewToken: preview.previewToken,
        replaceConfirmed: importRequest.replaceConfirmed,
        replacementReason: importRequest.replacementReason,
      };
    }
    const confirmed = await confirmAdminMarketCalendarImport(
      app.persistence,
      marketCode,
      body.previewToken,
      body.replaceConfirmed,
      body.replacementReason,
    );
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "market_calendar_confirmed",
      ipAddress,
      metadata: { marketCode, calendarYear: confirmed.calendarYear, versionId: confirmed.versionId },
    });
    await app.persistence.createMarketCalendarActivityEvent({
      marketCode,
      category: "calendar",
      result: "success",
      sourceKind: "official_calendar",
      sourceId: "market-calendar",
      eventType: "calendar_confirmed",
      title: "Calendar confirmed",
      message: `${marketCode} ${confirmed.calendarYear} calendar confirmed.`,
      calendarYear: confirmed.calendarYear,
      dedupeKey: `calendar-confirmed:${confirmed.versionId}`,
      detail: { versionId: confirmed.versionId },
    });
    return confirmed;
  });

  app.post("/market-data/:marketCode/calendar/invalidate", async (req): Promise<AdminMarketCalendarConfirmResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    requireOfficialCalendarMarketCode(marketCode);
    const body = z.object({
      calendarYear: z.number().int().min(2000).max(2100),
      reason: z.string().trim().min(1),
    }).parse(req.body ?? {}) as AdminMarketCalendarInvalidateRequest & { calendarYear: number };
    const invalidated = await app.persistence.invalidateMarketCalendarVersion({
      marketCode,
      calendarYear: body.calendarYear,
      reason: body.reason,
    });
    if (!invalidated) {
      throw routeError(404, "market_calendar_not_found", "No active calendar version found for that market-year");
    }
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "market_calendar_invalidated",
      ipAddress,
      metadata: { marketCode, calendarYear: body.calendarYear, versionId: invalidated.versionId, reason: body.reason },
    });
    await app.persistence.createMarketCalendarActivityEvent({
      marketCode,
      category: "calendar",
      result: "warning",
      sourceKind: "official_calendar",
      sourceId: "market-calendar",
      eventType: "calendar_invalidated",
      title: "Calendar invalidated",
      message: `${marketCode} ${body.calendarYear} calendar invalidated.`,
      calendarYear: body.calendarYear,
      dedupeKey: `calendar-invalidated:${invalidated.versionId}`,
      detail: { versionId: invalidated.versionId, reason: body.reason },
    });
    return {
      marketCode,
      calendarYear: body.calendarYear,
      versionId: invalidated.versionId,
      activeVersionId: invalidated.versionId,
      confirmedAt: invalidated.confirmedAt ?? invalidated.updatedAt,
    };
  });

  app.get("/market-data/:marketCode/calendar/history", async (req): Promise<AdminMarketCalendarHistoryResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    requireOfficialCalendarMarketCode(marketCode);
    const query = z.object({
      calendarYear: z.coerce.number().int().min(2000).max(2100).optional(),
    }).parse(req.query ?? {});
    return buildAdminMarketCalendarHistory(app.persistence, marketCode, query.calendarYear);
  });

  app.post("/market-data/:marketCode/backfill/preview", async (req): Promise<AdminMarketDataBackfillPreviewResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") throw routeError(404, "market_backfill_not_supported", "FX backfill is out of scope");
    const market = providerFixerMarketCodeSchema.parse(marketCode);
    const body = marketDataBackfillBodySchema.parse(req.body ?? {}) satisfies AdminMarketDataBackfillPreviewRequest;
    const preview = await buildBackfillPreview(market, body);
    return createBackfillPreviewOperation({ actorUserId: sessionUserId, ipAddress }, preview, body);
  });

  app.post("/market-data/:marketCode/backfill/execute", async (req): Promise<AdminMarketDataBackfillExecuteResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") throw routeError(404, "market_backfill_not_supported", "FX backfill is out of scope");
    const market = providerFixerMarketCodeSchema.parse(marketCode);
    const body = marketDataBackfillExecuteBodySchema.parse(req.body ?? {}) satisfies AdminMarketDataBackfillExecuteRequest;
    const operation = await app.persistence.getProviderOperation(body.operationId);
    if (!operation) {
      throw routeError(404, "market_backfill_preview_not_found", "Backfill preview operation was not found");
    }
    if (operation.marketCode !== market || operation.operationType !== "backfill_catalog_rows") {
      throw routeError(400, "market_backfill_preview_mismatch", "Backfill preview operation does not belong to this market");
    }
    if (operation.phase !== "preview" && operation.phase !== "staged") {
      throw routeError(400, "market_backfill_preview_stale", "Backfill preview is no longer executable; run preview again");
    }
    assertProviderFixerPreviewToken(operation, body.previewToken);
    const preview = backfillPreviewFromOperation(operation);
    if (preview.confirmation.level === "typed") {
      if (body.typedConfirmation !== preview.confirmation.text) {
        throw routeError(400, "market_backfill_typed_confirmation_required", "Backfill requires the matching typed confirmation");
      }
    } else if (body.acknowledged !== true) {
      throw routeError(400, "market_backfill_acknowledgement_required", "Backfill requires acknowledgement after preview");
    }
    const result = await executeBackfillPreviewOperation(
      { actorUserId: sessionUserId, ipAddress },
      operation,
      preview,
    );
    return {
      operationId: result.operation.id,
      marketCode: market,
      providerId: preview.providerId,
      scope: preview.scope,
      status: result.operation.phase === "running" ? "queued" : "completed",
      matchCount: preview.matchCount,
      dateRange: preview.dateRange,
      enqueuedJobCount: result.enqueuedJobCount,
      skippedExistingJobCount: result.skippedExistingJobCount,
      batchId: result.batchId,
      unresolvedSelection: preview.unresolvedSelection,
    };
  });

  app.get("/market-data/:marketCode/valuation-repair/status", async (req): Promise<AdminMarketDataValuationRepairStatusResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") throw routeError(404, "market_valuation_repair_not_supported", "FX valuation repair is out of scope");
    const market = providerFixerMarketCodeSchema.parse(marketCode);
    const query = marketDataValuationRepairStatusQuerySchema.parse(req.query ?? {});
    const tickers = query.tickers
      .split(",")
      .map((ticker) => ticker.trim().toUpperCase())
      .filter((ticker) => ticker.length > 0);
    if (tickers.length === 0 || tickers.length > 20) {
      throw routeError(400, "market_valuation_repair_ticker_limit", "Valuation repair status requires 1-20 tickers");
    }
    return buildValuationRepairStatus({
      marketCode: market,
      tickers,
      targetRepairDate: query.targetDate,
      operationId: query.operationId,
    });
  });

  app.post("/market-data/:marketCode/snapshot-repair/execute", async (req): Promise<AdminMarketDataSnapshotRepairExecuteResponse> => {
    requireAdminRole(req);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") throw routeError(404, "market_snapshot_repair_not_supported", "FX snapshot repair is out of scope");
    if (!app.boss) throw routeError(503, "queue_unavailable", "Job queue is not available");

    const market = providerFixerMarketCodeSchema.parse(marketCode);
    const body = marketDataSnapshotRepairExecuteBodySchema.parse(req.body ?? {}) satisfies AdminMarketDataSnapshotRepairExecuteRequest;
    const fromDate = body.fromDate ?? defaultSnapshotRepairScanFromDate();
    const queued: string[] = [];
    const rejected: Array<{ ticker: string; reason: string }> = [];

    for (const rawTicker of body.tickers) {
      const ticker = rawTicker.trim().toUpperCase();
      const instrument = await app.persistence.getInstrument(ticker, market);
      if (!instrument) {
        rejected.push({ ticker, reason: "instrument_not_found" });
        continue;
      }

      const payload: SnapshotRepairJobData = {
        ticker,
        marketCode: market,
        fromDate,
        trigger: "admin_rerun",
      };
      const jobId = await app.boss.send(SNAPSHOT_REPAIR_QUEUE, payload, {
        singletonKey: getSnapshotRepairSingletonKey(payload),
      });
      if (jobId === null) {
        rejected.push({ ticker, reason: "existing_snapshot_repair_job" });
        continue;
      }
      queued.push(ticker);
    }

    return { marketCode: market, queued, rejected };
  });

  app.post("/market-data/:marketCode/purge/preview", async (req): Promise<AdminMarketDataPurgePreviewResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") throw routeError(404, "market_purge_not_supported", "FX purge is out of scope");
    const market = providerFixerMarketCodeSchema.parse(marketCode);
    const body = marketDataPurgePreviewBodySchema.parse(req.body ?? {}) satisfies AdminMarketDataPurgePreviewRequest;
    const preview = await buildPurgePreview(market, body);
    return createPurgePreviewOperation({ actorUserId: sessionUserId, ipAddress }, preview);
  });

  app.post("/market-data/:marketCode/purge/execute", async (req): Promise<AdminMarketDataPurgeExecuteResponse> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { marketCode } = marketDataWorkspaceParamSchema.parse(req.params);
    if (marketCode === "FX") throw routeError(404, "market_purge_not_supported", "FX purge is out of scope");
    const market = providerFixerMarketCodeSchema.parse(marketCode);
    const body = marketDataPurgeExecuteBodySchema.parse(req.body ?? {}) satisfies AdminMarketDataPurgeExecuteRequest;
    const operation = await app.persistence.getProviderOperation(body.operationId);
    if (!operation) {
      throw routeError(404, "market_purge_preview_not_found", "Purge preview operation was not found");
    }
    if (operation.marketCode !== market || operation.operationType !== "purge_market_data") {
      throw routeError(400, "market_purge_preview_mismatch", "Purge preview operation does not belong to this market");
    }
    if (operation.phase !== "preview" && operation.phase !== "staged") {
      throw routeError(400, "market_purge_preview_stale", "Purge preview is no longer executable; run preview again");
    }
    assertProviderFixerPreviewToken(operation, body.previewToken);
    const preview = purgePreviewFromOperation(operation);
    if (body.typedConfirmation !== preview.confirmation.text) {
      throw routeError(400, "market_purge_typed_confirmation_required", "Purge requires the matching typed confirmation");
    }
    await ensureProviderHealthRow(preview.providerId);
    await assertNoOtherProviderOperationExecution(app, {
      providerId: preview.providerId,
      marketCode: market,
      operationId: operation.id,
    });
    const startedAt = new Date().toISOString();
    const running = await app.persistence.updateProviderOperation({
      id: operation.id,
      phase: "running",
      startedAt,
      metadata: {
        marketDataBff: true,
        ...(asRecord(operation.metadata) ?? {}),
        source: "manual_execute",
        progressPercent: 0,
      },
    });
    const supportedCategories: MarketDataPurgeBody["categories"] = preview.categories.filter((category: MarketDataPurgeBody["categories"][number]) =>
      !preview.unsupportedCategories.some((unsupported) => unsupported.category === category),
    );
    const counts = await app.persistence.purgeAdminMarketData({
      providerId: preview.providerId,
      marketCode: market,
      categories: supportedCategories,
      targets: preview.targets,
      fullHistory: preview.fullHistory,
      startDate: preview.startDate ?? null,
      endDate: preview.endDate ?? null,
      dryRun: false,
    });
    let linkedBackfillOperationId: string | null = null;
    if (preview.enqueueBackfillAfterPurge === true && preview.linkedRefill.available) {
      const refillPreview: MarketDataBackfillPreviewDraft = {
        marketCode,
        providerId: preview.providerId,
        scope: "selected_catalog_rows",
        matchCount: preview.targets.length,
        affectedUserCount: preview.affectedUserCount,
        affectedAccountCount: preview.affectedAccountCount,
        estimatedJobCount: preview.targets.length,
        estimatedStorageRows: preview.targets.length * 2,
        dateRange: resolveBackfillDateRange(market, {
          startDate: preview.fullHistory === false ? preview.startDate : undefined,
          endDate: preview.fullHistory === false ? preview.endDate : undefined,
        }),
        providerBudgetNotes: marketDataProviderBudgetNotes(market, "backfill_catalog_rows"),
        unsupportedRows: [],
        confirmation: { level: "checkbox", text: null, reason: "Linked refill follows a confirmed purge." },
        targets: preview.targets,
      };
      const refill = await createBackfillOperation(
        { actorUserId: sessionUserId, ipAddress },
        refillPreview,
        "linked_refill",
        { ignoreActiveOperationId: running.id },
      );
      linkedBackfillOperationId = refill.operation.id;
    }
    const completed = await app.persistence.updateProviderOperation({
      id: running.id,
      phase: "completed",
      completedAt: new Date().toISOString(),
      previewTokenHash: null,
      previewExpiresAt: null,
      metadata: {
        ...(asRecord(running.metadata) ?? {}),
        progressPercent: 100,
        deletedRows: counts.total,
        deleteCounts: counts,
        linkedBackfillOperationId,
      },
    });
    await app.persistence.createProviderOperationLog({
      operationId: completed.id,
      phase: "completed",
      level: "warning",
      message: `market_data_purge_completed provider=${preview.providerId} market=${market} deleted_rows=${counts.total}`,
      context: {
        providerId: preview.providerId,
        marketCode: market,
        categories: supportedCategories,
        deletedRows: counts.total,
        deleteCounts: counts,
        unsupportedCategories: preview.unsupportedCategories,
        linkedBackfillOperationId,
      },
    });
    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_fixer_operation",
      ipAddress,
      metadata: {
        operationId: completed.id,
        action: "market_data_purge_execute",
        providerId: preview.providerId,
        marketCode: market,
        categories: supportedCategories,
        deletedRows: counts.total,
        linkedBackfillOperationId,
      },
    });
    return {
      operationId: completed.id,
      marketCode: market,
      providerId: preview.providerId,
      status: "completed",
      categories: preview.categories,
      affectedInstrumentCount: preview.affectedInstrumentCount,
      deletedRows: counts.total,
      linkedBackfillOperationId,
    };
  });
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.providerOperationExecutor = async ({ operationId, actorUserId, ipAddress }) => {
    const operation = await app.persistence.getProviderOperation(operationId);
    if (!operation) {
      throw routeError(404, "provider_operation_not_found", "Provider operation not found");
    }
    const config = await loadAppConfigDto(app);
    await completeProviderFixerOperation(app, operation, {
      actorUserId,
      ipAddress,
      guardrails: providerFixerGuardrailsFromConfig(config),
      dangerous: (operation.matchCount ?? 0) >= config.effectiveProviderFixerDangerousMatchThreshold,
      throwOnFailure: true,
    });
  };
  registerProviderFixerAdminRoutes(app);
  registerMarketDataAdminRoutes(app);

  app.get("/users", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listUsers({
      page,
      limit,
      search: query.search,
      role: query.role ? userRoleSchema.parse(query.role) : undefined,
      status: z.enum(["active", "disabled", "deleted"]).optional().parse(query.status || undefined),
    });
  });

  app.patch("/users/:id/role", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({ role: userRoleSchema }).parse(req.body);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside changeUserRole transaction

    const result = await app.persistence.changeUserRole(id, body.role, {
      actorUserId: sessionUserId,
      ipAddress,
    });

    // Force logout when removing admin role
    if (target.role === "admin" && body.role !== "admin") {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "session_force_logout",
        targetUserId: id,
        ipAddress,
        metadata: { targetEmail: target.email, reason: "admin_role_change" },
      });
    }

    return result;
  });

  app.post("/users/:id/disable", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside disableUser transaction
    await app.persistence.disableUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.post("/users/:id/enable", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    await app.persistence.enableUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.delete("/users/:id", async (req) => {
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");

    // Last-admin guard is enforced atomically inside softDeleteUser transaction
    await app.persistence.softDeleteUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    return { status: "ok" };
  });

  app.delete("/users/:id/purge", async (req, reply) => {
    const { sessionUserId, ipAddress, email: adminEmail } = resolveAdminContext(req, app);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      confirmation: z.string(),
      adminEmail: z.string().email(),
    }).parse(req.body);

    assertNotSelf(sessionUserId, id);

    const target = await app.persistence.getAuthUserById(id);
    if (!target) throw routeError(404, "user_not_found", "User not found");
    if (!target.email) {
      throw routeError(400, "no_email_for_purge", "Cannot purge a user with no email address");
    }

    // Validate confirmation strings
    const expectedConfirmation = `PURGE ${target.email}`;
    if (body.confirmation !== expectedConfirmation) {
      throw routeError(400, "invalid_confirmation", `Confirmation must be "${expectedConfirmation}"`);
    }
    if (body.adminEmail.toLowerCase() !== (adminEmail ?? "").toLowerCase()) {
      throw routeError(400, "invalid_admin_email", "Admin email does not match");
    }

    // Last-admin guard is enforced atomically inside hardPurgeUser transaction

    // Check for active jobs
    const hasJobs = await app.persistence.hasActiveJobs(id);
    if (hasJobs) {
      throw routeError(409, "active_jobs_blocked", "User has active background jobs — wait for completion before purging");
    }

    await app.persistence.hardPurgeUser(id, {
      actorUserId: sessionUserId,
      ipAddress,
    });
    reply.code(204);
    return null;
  });

  app.post("/users/:id/impersonate", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const { id: targetUserId } = z.object({ id: userScopedIdSchema }).parse(req.params);

    if (req.authContext?.isDemo) {
      throw routeError(403, "demo_cannot_impersonate", "Demo sessions cannot impersonate users");
    }
    if (targetUserId === sessionUserId) {
      throw routeError(400, "cannot_impersonate_self", "Cannot impersonate yourself");
    }

    const targetUser = await app.persistence.getAuthUserById(targetUserId);
    if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
      throw routeError(404, "user_not_found", "User not found");
    }

    if (req.authContext?.isImpersonating && req.authContext.impersonation) {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "impersonation_end",
        targetUserId: req.authContext.impersonation.targetUserId,
        ipAddress,
        metadata: {
          reason: "replaced",
          targetUserId: req.authContext.impersonation.targetUserId,
          targetEmail: req.authContext.impersonation.targetEmail,
        },
      });
    }

    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for impersonation cookie signing");
    }

    const ttlMinutes = Env.ADMIN_IMPERSONATION_TTL_MINUTES;
    const expiresAtMs = Date.now() + ttlMinutes * 60_000;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const cookieValue = signImpersonationCookie(sessionUserId, targetUserId, expiresAtMs, sessionSecret);

    req.__clearImpersonationCookie = false;
    reply.header("set-cookie", impersonationSetCookieString(cookieValue, ttlMinutes));

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "impersonation_start",
      targetUserId,
      ipAddress,
      metadata: {
        targetUserId,
        targetEmail: targetUser.email ?? null,
        expiresAt,
      },
    });

    return {
      expiresAt,
      targetEmail: targetUser.email ?? null,
    };
  });

  app.delete("/impersonation", async (req, reply) => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    if (req.authContext?.isImpersonating && req.authContext.impersonation) {
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "impersonation_end",
        targetUserId: req.authContext.impersonation.targetUserId,
        ipAddress,
        metadata: {
          reason: "manual",
          targetUserId: req.authContext.impersonation.targetUserId,
          targetEmail: req.authContext.impersonation.targetEmail,
        },
      });
    }

    req.__clearImpersonationCookie = false;
    reply.header("set-cookie", impersonationClearCookieString());
    reply.code(204);
    return null;
  });

  app.get("/invites", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listInvites({
      page,
      limit,
      status: z.enum(["pending", "used", "expired", "revoked"]).optional().parse(query.status || undefined),
      email: query.email,
    });
  });

  app.get("/audit-log", async (req) => {
    const query = req.query as Record<string, string | undefined>;
    const page = Math.max(1, parseInt(query.page ?? "1", 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit ?? "50", 10) || 50));
    return app.persistence.listAuditLog({
      page,
      limit,
      actorUserId: query.actorUserId,
      targetUserId: query.targetUserId,
      actions: query.action ? query.action.split(",").map((a) => a.trim()).filter(Boolean) : undefined,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  });

  // ── Admin settings (KZO-142) ───────────────────────────────────────────────

  app.get("/settings", async (req): Promise<AppConfigDto> => {
    requireAdminRole(req);
    return loadAppConfigDto(app);
  });

  app.patch("/settings", async (req): Promise<AppConfigDto> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const body = patchAdminSettingsSchema.parse(req.body);
    assertProviderRateBudgetOverrides(body);

    const current = await app.persistence.getAppConfig();
    assertProviderHealthThresholdOverrides(body, current);
    assertRouteCachePolicyPatch(body, current);

    // KZO-159 (158A): diff each tracked field independently — a PATCH may
    // carry one, the other, both, or neither. `undefined` means "no change",
    // `null` means "clear override", array means "set override".
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};

    if (
      body.repairCooldownMinutes !== undefined
      && body.repairCooldownMinutes !== current.repairCooldownMinutes
    ) {
      before.repairCooldownMinutes = current.repairCooldownMinutes;
      after.repairCooldownMinutes = body.repairCooldownMinutes;
      await app.persistence.setRepairCooldownMinutes(body.repairCooldownMinutes);
    }

    if (body.dashboardPerformanceRanges !== undefined) {
      const currentList = current.dashboardPerformanceRanges;
      const nextList = body.dashboardPerformanceRanges;
      // Treat [a,b,c] vs [a,b,c] as equal (same length, same elements).
      const unchanged =
        currentList === nextList
        || (Array.isArray(currentList)
          && Array.isArray(nextList)
          && currentList.length === nextList.length
          && currentList.every((v, i) => v === nextList[i]));
      if (!unchanged) {
        before.dashboardPerformanceRanges = currentList;
        after.dashboardPerformanceRanges = nextList;
        await app.persistence.setDashboardPerformanceRanges(nextList);
      }
    }

    if (
      body.metadataEnrichmentMode !== undefined
      && body.metadataEnrichmentMode !== current.metadataEnrichmentMode
    ) {
      before.metadataEnrichmentMode = current.metadataEnrichmentMode;
      after.metadataEnrichmentMode = body.metadataEnrichmentMode;
      await app.persistence.setMetadataEnrichmentMode(body.metadataEnrichmentMode);
    }

    if (
      body.routeCachePolicyMode !== undefined
      && body.routeCachePolicyMode !== current.routeCachePolicyMode
    ) {
      before.routeCachePolicyMode = current.routeCachePolicyMode;
      after.routeCachePolicyMode = body.routeCachePolicyMode;
      await app.persistence.setRouteCachePolicyMode(body.routeCachePolicyMode);
    }

    const tickerPriceFreshnessPatch = flattenTickerPriceFreshnessPatch(body.tickerPriceFreshness);
    const plainBody = body as Record<string, unknown>;

    // KZO-198 — diff Tier 1/2 plain fields. Only changed fields are added to
    // `patch` so a no-op PATCH does not bump `updated_at`.
    const patch: import("../persistence/types.js").AppConfigPatch = {};
    for (const field of TIER1_PLAIN_FIELDS) {
      const next = Object.prototype.hasOwnProperty.call(tickerPriceFreshnessPatch, field)
        ? tickerPriceFreshnessPatch[field]
        : plainBody[field] as import("../persistence/types.js").AppConfigPlainValue | undefined;
      if (next === undefined) continue;
      const currentVal = current[field] ?? null;
      if (appConfigValuesEqual(next, currentVal)) continue;
      before[field] = currentVal;
      after[field] = next;
      patch[field] = next;
    }

    // KZO-198 — Tier 0 rotations. Plaintext goes onto the patch under the
    // camelCase key; persistence encrypts inline. Audit metadata uses the
    // `rotation` discriminator and NEVER carries the plaintext value. Each
    // rotation gets its own audit row so a partial PATCH cannot co-mingle
    // plaintext-changes with rotations in a single `before/after` diff.
    const rotations: Array<{
      field: "finmindApiToken" | "twelveDataApiKey" | "eodhdApiKey";
      action: "rotate" | "clear";
    }> = [];
    if (body.finmindApiToken !== undefined) {
      patch.finmindApiToken = body.finmindApiToken;
      rotations.push({
        field: "finmindApiToken",
        action: body.finmindApiToken === null ? "clear" : "rotate",
      });
    }
    if (body.twelveDataApiKey !== undefined) {
      patch.twelveDataApiKey = body.twelveDataApiKey;
      rotations.push({
        field: "twelveDataApiKey",
        action: body.twelveDataApiKey === null ? "clear" : "rotate",
      });
    }
    if (body.eodhdApiKey !== undefined) {
      patch.eodhdApiKey = body.eodhdApiKey;
      rotations.push({
        field: "eodhdApiKey",
        action: body.eodhdApiKey === null ? "clear" : "rotate",
      });
    }

    if (Object.keys(patch).length > 0) {
      await app.persistence.setAppConfigPatch(patch);
    }

    const hasPlaintextDiff = Object.keys(after).length > 0;

    if (!hasPlaintextDiff && rotations.length === 0) {
      return loadAppConfigDto(app);
    }

    if (hasPlaintextDiff) {
      // KZO-198: explicit `value_change` discriminator on the metadata object.
      // Legacy rows (pre-KZO-198) without `type` are read as `value_change` by
      // the UI per design.md §6 — no backfill migration needed.
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "app_config_updated",
        metadata: { type: "value_change", before, after },
        ipAddress,
      });
    }

    for (const rotation of rotations) {
      // Tier 0 rotation audit — the value is NEVER part of the metadata. The
      // operator audit trail records who rotated which secret and when.
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "app_config_updated",
        metadata: {
          type: "rotation",
          field: rotation.field,
          action: rotation.action,
          actorUserId: sessionUserId,
        },
        ipAddress,
      });
    }

    // KZO-198 — invalidate the TTL cache so the next read on this instance
    // sees the new value immediately. Cross-instance pub/sub is a KZO-121
    // follow-up; peers see stale values up to TTL.
    invalidateAppConfigCache();
    await refreshAppConfigCache();

    return loadAppConfigDto(app);
  });

  app.get("/mcp/settings", async (req): Promise<AiConnectorPolicySettingsDto> => {
    requireAdminRole(req);
    return toAiConnectorPolicySettingsDto(await app.persistence.getAiConnectorPolicySettings());
  });

  app.post("/mcp/fresh-auth", async (req): Promise<{ freshAuthToken: string }> => {
    requireAdminRole(req);
    return { freshAuthToken: createMcpFreshAuthToken(app, req) };
  });

  app.patch("/mcp/settings", async (req): Promise<AiConnectorPolicySettingsDto> => {
    requireAdminRole(req);
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);
    const current = await app.persistence.getAiConnectorPolicySettings();
    assertFreshAuth(app, req, current);
    const body = aiConnectorPolicySettingsPatchSchema.parse(req.body);
    if (body.mcpOauthTokenSecret !== undefined) {
      await app.persistence.setAppConfigEncryptedSecret("mcpOauthTokenSecret", body.mcpOauthTokenSecret);
      const secretAction = body.mcpOauthTokenSecret === null ? "clear" : "rotate";
      const revokedConnectionCount = await app.persistence.revokeAiConnectorConnectionsForProvider(
        "chatgpt",
        body.mcpOauthTokenSecret === null ? "mcp_oauth_secret_cleared" : "mcp_oauth_secret_rotated",
        sessionUserId,
      );
      await app.persistence.appendAuditLog({
        actorUserId: sessionUserId,
        action: "app_config_updated",
        metadata: {
          type: "rotation",
          field: "mcpOauthTokenSecret",
          action: secretAction,
          actorUserId: sessionUserId,
          revokedConnectionCount,
        },
        ipAddress,
      });
      invalidateAppConfigCache();
    }
    const policyPatch = Object.fromEntries(
      Object.entries(body).filter(([key]) => key !== "mcpOauthTokenSecret"),
    ) as SaveAiConnectorPolicySettingsInput;
    if (Object.keys(policyPatch).length === 0) {
      return toAiConnectorPolicySettingsDto(await app.persistence.getAiConnectorPolicySettings());
    }
    return updateAiConnectorPolicySettings(app, policyPatch, {
      actorUserId: sessionUserId,
      ipAddress,
    });
  });

  // ── KZO-164: FX rates admin surface ───────────────────────────────────────
  // POST /admin/fx-rates/refresh — manually enqueue an FX refresh job (e.g.
  //   to backfill a missed window after an outage). Only this path emits
  //   `admin_fx_rates_refresh` audit; cron runs do NOT (precedent: catalog-sync).
  //
  //   AUTH: This route is intentionally NOT in `ADMIN_ROUTE_KEYS`
  //   (registerRoutes.ts) so the demo-restricted 403 fires before the
  //   admin-required 403 for non-admin demo callers — see scope-todo §5.1
  //   "Auth: admin-only; demo blocked" + the [auth]: demo_restricted HTTP/AAA
  //   spec assertion. The inline `requireAdminRole(req)` below is therefore the
  //   SOLE admin gate for this route. DO NOT REMOVE without also adding the
  //   route key to `ADMIN_ROUTE_KEYS` and adjusting the demo-precedence test.
  app.post("/fx-rates/refresh", async (req) => {
    if (req.authContext?.isDemo) {
      throw routeError(403, "demo_restricted", "FX refresh is not available for demo users");
    }
    requireAdminRole(req); // sole admin gate — see header comment
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);

    const body = fxRefreshBodySchema.parse(req.body ?? {});
    const today = today_utc();
    const startDate = body.startDate ?? today;
    const endDate = body.endDate ?? today;
    const bases = body.bases ?? [...STORED_QUOTES];

    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    const jobId = await app.boss.send(
      FX_REFRESH_QUEUE,
      { trigger: "manual" as const, startDate, endDate, bases },
      { singletonKey: "fx-refresh", priority: 5 },
    );

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "admin_fx_rates_refresh",
      metadata: { startDate, endDate, bases },
      ipAddress,
    });

    if (jobId === null) {
      // Singleton policy collapsed our send into an existing in-flight job.
      return {
        status: "skipped_existing_job" as const,
        reason: "another fx-refresh job is already enqueued or running (singleton policy)",
      };
    }
    return { status: "queued" as const, jobId };
  });

  // GET /admin/fx-rates/freshness — read-only freshness summary per (base, quote).
  // No audit log (read-only). `ageInDays` is computed against today_utc() so
  // any slow ingestion shows up immediately in the response.
  app.get("/fx-rates/freshness", async (req) => {
    requireAdminRole(req);
    const queriedAt = new Date().toISOString();
    const today = today_utc();
    const todayMs = new Date(`${today}T00:00:00Z`).getTime();
    const rows = await app.persistence.getFxRateFreshness();
    const pairs = rows.map((row) => {
      const latestMs = new Date(`${row.latestDate}T00:00:00Z`).getTime();
      const ageInDays = Math.max(0, Math.round((todayMs - latestMs) / 86_400_000));
      return {
        baseCurrency: row.baseCurrency,
        quoteCurrency: row.quoteCurrency,
        latestDate: row.latestDate,
        ageInDays,
      };
    });
    return { pairs, queriedAt };
  });

  // ── KZO-177: provider health admin surface ────────────────────────────────

  // GET /admin/providers — read-only snapshot of every provider health row
  // with computed counters and the last 10 trail entries each.
  app.get("/providers", async (req): Promise<AdminProvidersResponse> => {
    if (req.authContext?.role !== "admin") {
      throw routeError(403, "admin_required", "Admin role required");
    }
    // KZO-177 (P2 Fix 2): recompute `status` against the current trading
    // calendar for each row. The persisted `row.status` lags reality when the
    // queue stalls — a provider with `last_successful_run < latestSettled`
    // should report `down` even if no error trail rows have landed since.
    const rows = await app.persistence.getAllProviderHealthStatuses();
    const now = new Date();
    const providers: ProviderHealthStatusDto[] = await Promise.all(
      rows.map(async (row) => {
        const market = calendarMarketForProvider(row.providerId as ProviderId);
        const [errorCount24h, errorCount7d, rateLimitCount24h, recentErrors, latestSettled] =
          await Promise.all([
            app.persistence.computeErrorCount24h(row.providerId),
            app.persistence.computeErrorCount7d(row.providerId),
            app.persistence.computeRateLimitCount24h(row.providerId),
            app.persistence.getRecentProviderErrors(row.providerId, 10),
            app.tradingCalendarCache.latestSettledTradingDay(market, now),
          ]);
        const computedStatus = computeStatus({
          lastSuccessfulRun: row.lastSuccessfulRun,
          latestSettledTradingDay: latestSettled,
          errorCount24h,
        });
        // KZO-197 — derive `'awaiting'` purely at the route layer when the
        // provider has neither a successful nor a failed run on record (fresh
        // deploy). Persistence row shape, `provider_health_status` table CHECK,
        // and `recordOutcome` CAS reads remain unchanged — only the DTO gains
        // the 4th state. Any single failed_run record flips the row to
        // `computedStatus`, so there is no "awaiting + degraded" hybrid.
        const status =
          row.lastSuccessfulRun === null && row.lastFailedRun === null
            ? "awaiting"
            : computedStatus;
        const recentErrorDtos: ProviderErrorTrailEntryDto[] = recentErrors.map((e) => ({
          id: e.id,
          occurredAt: e.occurredAt,
          errorClass: e.errorClass,
          errorMessage: e.errorMessage,
        }));
        return {
          providerId: row.providerId,
          status,
          lastSuccessfulRun: row.lastSuccessfulRun,
          lastFailedRun: row.lastFailedRun,
          errorCount24h,
          errorCount7d,
          rateLimitCount24h,
          lastErrorMessage: row.lastErrorMessage,
          lastManualRerunAt: row.lastManualRerunAt,
          // KZO-197 — server-resolved per-provider rerun cooldown (ms).
          // Frontend uses this to render the live tooltip-cooldown label
          // and the 429 countdown fallback.
          rerunCooldownMs: getEffectiveProviderRerunCooldownMs(row.providerId),
          updatedAt: row.updatedAt,
          recentErrors: recentErrorDtos,
        };
      }),
    );
    return {
      providers,
      capabilities: listProviderOperationCapabilities(providers.map((provider) => provider.providerId)),
    };
  });

  // POST /admin/providers/:providerId/rerun — admin "Re-run now" button.
  // 60s per-provider cooldown via `last_manual_rerun_at`. Returns `429
  // rate_limit_exceeded` with `Retry-After` header if clicked within cooldown.
  app.post("/providers/:providerId/rerun", async (req, reply) => {
    // (1) admin guard — 403 fires before any other branch so unauthenticated
    // callers can't probe path-param shape or queue availability.
    if (req.authContext?.role !== "admin") {
      throw routeError(403, "admin_required", "Admin role required");
    }
    const { sessionUserId, ipAddress } = resolveAdminContext(req, app);

    // (2) provider exists 404 — path param parsed as a free string so an
    // unknown id lands as 404 (not Zod 400). The provider's existence in
    // `provider_health_status` is the authoritative gate.
    const params = z.object({ providerId: z.string() }).parse(req.params);
    const providerId = params.providerId as
      | "finmind-tw"
      | "finmind-us"
      | "yahoo-finance-au"
      | "twelve-data-au"
      | "yahoo-finance-kr"
      | "twelve-data-kr"
      | "yahoo-finance-jp"
      | "twelve-data-jp"
      | "frankfurter"
      // KZO-196 — ASX GICS catalog provider; admin "Run now" enqueues the
      // singleton-keyed `asx-gics-sync` queue (same job pg-boss runs on cron).
      | "asx-gics-csv";
    const existing = await app.persistence.getProviderHealthStatus(providerId);
    if (!existing) {
      throw routeError(404, "provider_not_found", "Unknown provider id");
    }
    const body = adminProviderRerunBodySchema.parse(req.body ?? {});

    if ((body.resolverMode || body.resolverModeRiskAccepted !== undefined) && providerId !== "yahoo-finance-kr") {
      throw routeError(
        400,
        "resolver_mode_provider_mismatch",
        "resolverMode is only supported for yahoo-finance-kr",
      );
    }

    const effectiveKrResolverMode =
      providerId === "yahoo-finance-kr" ? body.resolverMode ?? "quote_first" : undefined;
    if (body.resolverModeRiskAccepted !== undefined && effectiveKrResolverMode !== "chart_probe_v1") {
      throw routeError(
        400,
        "resolver_mode_risk_acceptance_unexpected",
        "resolverModeRiskAccepted is only valid with chart_probe_v1",
      );
    }
    if (effectiveKrResolverMode === "chart_probe_v1" && body.resolverModeRiskAccepted !== true) {
      throw routeError(
        400,
        "resolver_mode_risk_acceptance_required",
        "chart_probe_v1 requires explicit resolverModeRiskAccepted=true",
      );
    }

    // (3) cooldown per provider — read live (KZO-198: DB override → env).
    // KZO-197/KR — per-provider cooldown dispatch. Yahoo market reruns read
    // the longer Yahoo cooldown; other providers use the generic cooldown.
    const cooldownMs = getEffectiveProviderRerunCooldownMs(providerId);
    if (existing.lastManualRerunAt) {
      const elapsedMs = Date.now() - new Date(existing.lastManualRerunAt).getTime();
      if (elapsedMs < cooldownMs) {
        const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsedMs) / 1000));
        reply.header("Retry-After", String(retryAfterSec));
        throw routeError(429, "rate_limit_exceeded", "Re-run cooldown active for this provider");
      }
    }

    if (providerId === "yahoo-finance-kr" && effectiveKrResolverMode) {
      app.log.info(
        {
          providerId,
          resolverMode: effectiveKrResolverMode,
          resolverModeRiskAccepted: body.resolverModeRiskAccepted === true,
          marketAwareHint: "KR",
        },
        "provider_health_rerun_diagnostic_request",
      );
    }

    // (4) queue dispatch — checked LAST so auth/404/cooldown branches fire
    // first. When `app.boss` is null (memory backend / E2E tests with no
    // pg-boss), we skip the dispatch but still stamp the audit + cooldown
    // so the route stays observable end-to-end. Returns `tickerCount=0` and
    // `jobId=null` to signal the no-op.

    // Stamp the cooldown column BEFORE dispatching so a successful enqueue is
    // protected. If the dispatch throws, the cooldown is still in effect (a
    // small operator inconvenience), which is the safer default.
    await app.persistence.upsertProviderHealthStatus({
      providerId,
      lastManualRerunAt: new Date().toISOString(),
    });

    let tickerCount = 0;
    let marketCode: MarketCode | "FX" = "FX";
    let jobId: string | null = null;
    // Yahoo market providers use nested audit metadata. The two sub-paths
    // (catalog warm-up + monitored refresh) ship as `{tickerCount, jobId}`
    // each so the audit-log spec can verify both branches independently.
    // Top-level `tickerCount` and `jobId` remain populated as the back-compat
    // sum / first-non-null — KZO-177's audit spec asserts the flat shape and
    // must keep passing for every other provider.
    let marketCatalogBackfill: { tickerCount: number; jobId: string | null } | null = null;
    let marketMonitoredRefresh: { tickerCount: number; jobId: string | null } | null = null;

    if (providerId === "frankfurter") {
      if (app.boss) {
        const today = today_utc();
        jobId = await app.boss.send(
          FX_REFRESH_QUEUE,
          { trigger: "manual" as const, startDate: today, endDate: today, bases: [...STORED_QUOTES] },
          { singletonKey: "fx-refresh", priority: 5 },
        );
      }
      tickerCount = STORED_QUOTES.length;
    } else if (providerId === "asx-gics-csv") {
      // KZO-196: enqueue the asx-gics-sync queue. Singleton policy means a
      // concurrent admin click while a sync is in flight (or alongside the
      // weekly cron tick) coalesces — `boss.send` returns null when an
      // existing singleton job covers this work.
      const { ASX_GICS_SYNC_QUEUE, ASX_GICS_SYNC_SINGLETON_KEY } = await import(
        "../services/market-data/asxGicsSyncWorker.js"
      );
      marketCode = "AU";
      if (app.boss) {
        jobId = await app.boss.send(
          ASX_GICS_SYNC_QUEUE,
          {},
          { singletonKey: ASX_GICS_SYNC_SINGLETON_KEY, priority: 5 },
        );
      }
      tickerCount = 0;
    } else if (providerId === "twelve-data-au") {
      // KZO-200: Twelve Data is the AU catalog provider (KZO-194). Re-run
      // dispatches the catalog-sync queue for AU only — `pendingMarkets=["AU"]`
      // skips TW/US so we don't re-enumerate FinMind catalogs on this button.
      // Singleton policy collapses same-market concurrent kicks without letting
      // an AU-only rerun suppress a KR-only rerun, or vice versa.
      marketCode = "AU";
      if (app.boss) {
        jobId = await app.boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: ["AU"] },
          { singletonKey: catalogSyncRerunSingletonKey("AU"), priority: 5 },
        );
      }
      // tickerCount intentionally 0 — the catalog-sync worker enumerates the
      // upstream universe and reports `rawCount` in its own log lines; no
      // per-rerun count is meaningful at the route layer.
      tickerCount = 0;
    } else if (providerId === "twelve-data-kr") {
      marketCode = "KR";
      if (app.boss) {
        jobId = await app.boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: ["KR"] },
          { singletonKey: catalogSyncRerunSingletonKey("KR"), priority: 5 },
        );
      }
      tickerCount = 0;
    } else if (providerId === "twelve-data-jp") {
      marketCode = "JP";
      if (app.boss) {
        jobId = await app.boss.send(
          CATALOG_SYNC_QUEUE,
          { pendingMarkets: ["JP"] },
          { singletonKey: catalogSyncRerunSingletonKey("JP"), priority: 5 },
        );
      }
      tickerCount = 0;
    } else if (providerId === "yahoo-finance-au") {
      // KZO-197 — UNION of catalog warm-up + monitored refresh. The two sets
      // are disjoint by definition: catalog warm-up enumerates `(pending,
      // failed)` rows; monitored refresh consumes `ready` rows from the
      // monitored set. Both run unconditionally (not gated on whether the
      // other has any work).
      //
      // Single source of truth for audit metadata = helper return values.
      // Memory-backend / E2E (`app.boss === null`) → both helpers return
      // `{tickerCount:0, batchId:null}`, matching the locked scope-todo
      // (line 23) and the FinMind/twelve-data/asx-gics-csv memory-mode shape.
      marketCode = "AU";
      const [catalog, monitored] = app.boss
        ? await Promise.all([
            enqueueAuCatalogBarsBackfill(app.boss, app.persistence, app.log, {
              trigger: "admin_rerun",
            }),
            enqueueDailyRefresh(app.boss, app.persistence, app.log, {
              marketFilter: "AU",
              trigger: "admin_rerun",
            }),
          ])
        : [
            { tickerCount: 0, batchId: null as string | null },
            { tickerCount: 0, batchId: null as string | null },
          ];
      marketCatalogBackfill = { tickerCount: catalog.tickerCount, jobId: catalog.batchId };
      marketMonitoredRefresh = { tickerCount: monitored.tickerCount, jobId: monitored.batchId };
      tickerCount = catalog.tickerCount + monitored.tickerCount;
      // Top-level `jobId` = first non-null. Preserves the back-compat single-id
      // field that KZO-177 audit-log specs assert against; nested blocks carry
      // both ids when both branches dispatched.
      jobId = catalog.batchId ?? monitored.batchId ?? null;
    } else if (providerId === "yahoo-finance-kr") {
      marketCode = "KR";
      const [catalog, monitored] = app.boss
        ? await Promise.all([
            enqueueAuCatalogBarsBackfill(app.boss, app.persistence, app.log, {
              trigger: "admin_rerun",
              marketCode: "KR",
              resolverMode: effectiveKrResolverMode,
            }),
            enqueueDailyRefresh(app.boss, app.persistence, app.log, {
              marketFilter: "KR",
              trigger: "admin_rerun",
              resolverMode: effectiveKrResolverMode,
            }),
          ])
        : [
            { tickerCount: 0, batchId: null as string | null },
            { tickerCount: 0, batchId: null as string | null },
          ];
      marketCatalogBackfill = { tickerCount: catalog.tickerCount, jobId: catalog.batchId };
      marketMonitoredRefresh = { tickerCount: monitored.tickerCount, jobId: monitored.batchId };
      tickerCount = catalog.tickerCount + monitored.tickerCount;
      jobId = catalog.batchId ?? monitored.batchId ?? null;
    } else if (providerId === "yahoo-finance-jp") {
      marketCode = "JP";
      const [catalog, monitored] = app.boss
        ? await Promise.all([
            enqueueAuCatalogBarsBackfill(app.boss, app.persistence, app.log, {
              trigger: "admin_rerun",
              marketCode: "JP",
            }),
            enqueueDailyRefresh(app.boss, app.persistence, app.log, {
              marketFilter: "JP",
              trigger: "admin_rerun",
            }),
          ])
        : [
            { tickerCount: 0, batchId: null as string | null },
            { tickerCount: 0, batchId: null as string | null },
          ];
      marketCatalogBackfill = { tickerCount: catalog.tickerCount, jobId: catalog.batchId };
      marketMonitoredRefresh = { tickerCount: monitored.tickerCount, jobId: monitored.batchId };
      tickerCount = catalog.tickerCount + monitored.tickerCount;
      jobId = catalog.batchId ?? monitored.batchId ?? null;
    } else {
      marketCode = providerId === "finmind-tw" ? "TW" : "US";
      if (app.boss) {
        const result = await enqueueDailyRefresh(
          app.boss,
          app.persistence,
          app.log,
          { marketFilter: marketCode, trigger: "admin_rerun" },
        );
        tickerCount = result.tickerCount;
        jobId = result.batchId;
      }
    }

    // Yahoo market providers append the nested `catalogBackfill` +
    // `monitoredRefresh` blocks. Other providers keep the flat audit shape so
    // existing KZO-177 audit-log assertions stay green.
    const auditMetadata: Record<string, unknown> = {
      providerId,
      marketCode: marketCode === "FX" ? null : marketCode,
      tickerCount,
      jobId,
    };
    if (providerId === "yahoo-finance-kr" && effectiveKrResolverMode) {
      auditMetadata.resolverMode = effectiveKrResolverMode;
      auditMetadata.resolverModeRiskAccepted = body.resolverModeRiskAccepted === true;
    }
    if (marketCatalogBackfill !== null) {
      auditMetadata.catalogBackfill = marketCatalogBackfill;
    }
    if (marketMonitoredRefresh !== null) {
      auditMetadata.monitoredRefresh = marketMonitoredRefresh;
    }

    await app.persistence.appendAuditLog({
      actorUserId: sessionUserId,
      action: "provider_health_rerun",
      metadata: auditMetadata,
      ipAddress,
    });

    reply.code(202);
    return { status: "queued" as const, providerId, tickerCount, jobId };
  });

};
