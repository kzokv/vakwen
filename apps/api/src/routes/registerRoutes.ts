import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { registerSSERoute } from "./sseRoute.js";
import { adminRoutes } from "./adminRoutes.js";
import {
  buildAuthorizationUrl,
  decodeIdTokenPayload,
  exchangeCodeForTokens,
  extractInviteCode,
  extractReturnTo,
  generateState,
  IMPERSONATION_COOKIE_NAME,
  isValidReturnTo,
  refreshAccessToken,
  signImpersonationCookie,
  signSessionCookie,
  verifyImpersonationCookie,
  verifySessionCookie,
  verifyState,
  type GoogleTokenResponse,
  type ImpersonationCookieIdentity,
  type SessionIdentity,
} from "../auth/googleOAuth.js";
import {
  calculateBuyFees,
  calculateDividendStockEntitlement,
  calculateSellFees,
  classifyInstrument,
  derivePortfolioCapabilities,
  resolveRangeBounds,
  roundToDecimal,
  type FeeProfile,
} from "@vakwen/domain";
import type {
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
  AccountDefaultCurrency,
  AiConnectorAccessKind,
  AiConnectorToolBlockerCode,
  AiConnectorPolicySettingsDto,
  AiConnectorSummaryDto,
  AiConnectorScope,
  AiConnectorToolInputSchemaDto,
  CurrencyCode,
  DashboardOverviewDto,
  DashboardMarketStateDto,
  DashboardOverviewHoldingGroupDto,
  DashboardPerformanceRange,
  IntegrityIssueDto,
  InstrumentOptionDto,
  MarketCode as SharedMarketCode,
  TickerEnrichmentDto,
  TickerPrimaryDto,
  ShareCapability,
  ShellPortfolioConfigDto,
  TransactionAiInboxBadgeDto,
  TransactionAccountOptionDto,
  TransactionDraftBatchDetailDto,
  TransactionDraftBatchDto,
  TransactionDraftRowDto,
  TransactionDraftUnsupportedItemDto,
  TransactionHistoryItemDto,
  TransactionHistoryPageDto,
  TransactionPrimaryDto,
} from "@vakwen/shared-types";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  MARKET_FILTER_CODES,
  REPORT_CURRENCY_MODES,
  REPORT_SCOPES,
  adminMarketDataTableSettingsPreferenceSchema,
  dashboardHoldingFocusPreferenceSchema,
  dashboardPerformanceRangesSchema,
  densityModeSchema,
  holdingAllocationBasisSchema,
  holdingsSelectionPreferenceSchema,
  holdingsTableSettingsPreferenceSchema,
  priceColorConventionSchema,
  themeAccentSchema,
  unrealizedPnlAnalysisSettingsPreferenceSchema,
  currencyFor,
  marketCodeFor,
} from "@vakwen/shared-types";
import { resolveEffectiveRanges, resolveHoldingAllocationBasis, resolveReportingCurrency } from "../services/userPreferences.js";
import { getEffectiveRouteCachePolicy } from "../services/appConfig/valuationHealth.js";
import {
  buildExpectedSnapshotContributorKeysForTrades,
  buildOverviewMarketValues,
  translateDailyCompatibleCurrentValue,
  translateOverviewHoldingGroups,
  translateOverviewSummary,
  translatePerformancePoints,
} from "../services/dashboardReportingCurrency.js";
import { createRealizedPnlBreakdownResolver } from "../services/realizedPnlBreakdown.js";
import type { ImpersonationDto } from "@vakwen/shared-types";
import { Env } from "@vakwen/config";
import {
  buildMissingPriceState,
  resolveQuoteSnapshots,
  type QuoteSnapshotPair,
  type ResolvedQuoteSnapshot,
} from "../services/market-data/quoteSnapshotService.js";
import { enqueueDemandIntradayRefreshes } from "../services/market-data/intradayDemandRefresh.js";
import { getRegularSessionState, isRegularSessionMarketCode } from "../services/market-data/marketRegularSession.js";
import { getMarketLocalDate } from "../services/market-data/tradingCalendar.js";
import {
  appendTradeEvent,
  listPositionActions,
  listTradeEvents,
  syncAccountingPolicy,
} from "../services/accountingStore.js";
import { buildDashboardOverview, buildOverviewHoldingGroups, withTickerPriceFreshnessSettings } from "../services/dashboard.js";
import { buildValuationHealthSnapshotPerformance, buildValuationHealth } from "../services/valuationHealth.js";
import { resolveAccountDisplayName } from "../services/mcpAccountHelpers.js";
import {
  buildDividendEventListItems,
  buildDividendLedgerEntryDetails,
  createDividendEvent,
  deriveEligibleQuantity,
  postDividend,
  preparePostedCashDividendUpdate,
  resolveDividendEventMarketCode,
  resolveDividendPostingDate,
} from "../services/dividends.js";
import { getDividendUpdateReplayScope } from "../services/dividendReplayPreflight.js";
import {
  confirmAccountCutoffPurge,
  confirmTradeDividendDeletion,
  previewAccountCutoffPurge,
  previewTradeDividendDeletion,
} from "../services/dividendDestructivePreview.js";
import {
  applyCorporateAction,
  buildTransactionRecord,
  createPositionAction,
  createTransaction,
  listHoldings,
  previewPositionAction,
  resolveBookingSequence,
} from "../services/portfolio.js";
import { resolveSellAvailability } from "../services/sellAvailability.js";
import {
  archiveTransactionDraftBatch,
  deleteUnconfirmedTransactionDraftBatch,
  excludeTransactionDraftRows,
  listTransactionDraftBatches,
  postTransactionDraftRows,
  rejectTransactionDraftRows,
  reincludeTransactionDraftRows,
  updateTransactionDraftRows,
} from "../services/mcpDrafts.js";
import {
  connectorGroupForScope,
  createAiConnectorBearerFallback,
  revokeAiConnectorConnection,
  toAiConnectorPolicySettingsDto,
} from "../services/mcpConnectorLifecycle.js";
import { confirmRecompute, previewRecompute } from "../services/recompute.js";
import {
  ReplayError,
  replayPositionHistory,
  scheduleCommittedReplayFollowUp,
  scheduleReplayWithRetry,
} from "../services/replayPositionHistory.js";
import { MemoryPersistence } from "../persistence/memory.js";
import {
  confirmPostedTransactionMutation,
  dispatchPostedTransactionMutationRebuild,
  getPostedTransactionMutationPreview,
  getPostedTransactionMutationRun,
  previewPostedTransactionDeleteBatch,
  previewPostedTransactionUpdateBatch,
  simulatePostedTransactionDeleteBatch,
  simulatePostedTransactionUpdateBatch,
} from "../services/postedTransactionMutations.js";
import { generateHoldingSnapshots, recomputeSnapshotsForTicker } from "../services/snapshotGeneration.js";
import { generateCurrencyWalletSnapshots } from "../services/currencyWalletSnapshotGeneration.js";
import { ReadPathTiming } from "../services/readPathTiming.js";
import { bookedChargeFieldSchema } from "../validation/bookedCharge.js";
import {
  createFxTransfer,
  estimateFxTransfer,
  reverseFxTransfer,
  updateFxTransfer,
  type CashBalanceChange,
  type CreateFxTransferResult,
  type ReverseFxTransferResult,
  type UpdateFxTransferResult,
} from "../services/fxTransferService.js";
import { MissingFxRateError } from "../services/currencyWalletAccounting.js";
import { buildFxConversionRateRows } from "../services/fxConversionRates.js";
import { seedDemoTransactions } from "../services/demoData.js";
import { scheduleTickerFundamentalsRefresh } from "../services/fundamentals/refresh.js";
import { REPORT_HOLDINGS_MAX_LIMIT, buildDailyReviewReport, buildMarketReport, buildPortfolioReport } from "../services/reports.js";
import {
  buildUnrealizedPnlAnalysis,
  unrealizedPnlAnalysisRouteQuerySchema,
} from "../services/unrealizedPnlAnalysis.js";
import {
  publishAccountMutationEventToOwnerAndActiveGrantees,
  publishLifecycleEventToOwnerAndActiveGrantees,
} from "../services/accountMutationEvents.js";
import { createStore, setStoreInstruments } from "../services/store.js";
import { ensureInstrumentDefinition, isInstrumentQuoteable, listTransactionInstruments, upsertInstrumentDefinitions } from "../services/instrumentRegistry.js";
import {
  BACKFILL_QUEUE,
  getBackfillSingletonKey,
  type BackfillJobData,
} from "../services/market-data/backfillWorker.js";
import { deriveRepairAvailableAt, getEffectiveRepairCooldownMinutes, remainingCooldownMinutes } from "../services/appConfig/repairCooldown.js";
import { getEffectiveAccountHardPurgeDays } from "../services/appConfig/accountLifecycle.js";
import { getEffectiveUserPreferencesMaxBytes } from "../services/appConfig/requestLimits.js";
import { getEffectiveAnonymousShareRateLimitWindowMs } from "../services/appConfig/sharing.js";
import { APP_CONFIG_BOUNDS } from "../services/appConfig/bounds.js";
import { RateLimitedError } from "../services/market-data/types.js";
import { upsertDailyBars } from "../services/market-data/upserts.js";
import { getEffectiveTickerPriceFreshnessConfig } from "../services/appConfig/tickerPriceFreshness.js";
import { runCloseRefresh, type CloseRefreshResult } from "../services/market-data/closeRefreshService.js";
import { enqueueCloseRefresh } from "../services/market-data/closeRefreshWorker.js";
import { TwseStockDayCloseProvider, YahooChartCloseProvider } from "../services/market-data/providers/index.js";
import { MockTwelveDataAuCatalogProvider } from "../services/market-data/providers/mockTwelveDataAu.js";
import { routeError } from "../lib/routeError.js";
import { listMcpToolDefinitions } from "../mcp/tools.js";
import { scopesForToolAccess } from "../mcp/policy.js";
import {
  requireAdminRole,
  requireSharedCapability,
  requireShareGrantorRole,
  requireWriteableContext,
  requireWriterRole,
  resolveActiveSharedCapabilityContext,
} from "../lib/routeGuards.js";
import type { RecomputeJob, Store, Transaction } from "../types/store.js";
import type {
  AiConnectorAccessLogRecord,
  AiConnectorConnectionRecord,
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftBatchRecord,
  AiTransactionDraftRowRecord,
  AiTransactionDraftUnsupportedItemRecord,
  AnonymousShareTokenRecord,
  PendingShareInviteRecord,
  Persistence,
  AuditLogInput,
  SnapshotTradeInput,
  ShareGrantRecord,
  UserRole,
} from "../persistence/types.js";
import type { McpRequestContext, McpResolvedContext } from "../mcp/types.js";
import {
  ANONYMOUS_SHARE_TOKEN_REGEX,
  generateAnonymousShareToken,
} from "../lib/anonymousShareToken.js";
import { assertInviteStatusRateLimit, registerInviteStatusEviction } from "../lib/inviteStatusRateLimit.js";
import { _resetAnonymousShareRateBuckets, assertAnonymousShareRateLimit, deleteAnonymousShareRateBucket, registerAnonymousShareEviction } from "../lib/anonymousShareRateLimit.js";
import { assertMarketDataPriceRateLimit, registerMarketDataPriceEviction } from "../lib/marketDataPriceRateLimit.js";
import { _resetMarketDataSearchBuckets, assertMarketDataSearchRateLimit, registerMarketDataSearchEviction } from "../lib/marketDataSearchRateLimit.js";
import {
  assertTickerPriceRefreshCloseRateLimit,
  registerTickerPriceRefreshCloseEviction,
} from "../lib/tickerPriceRefreshCloseRateLimit.js";
import { registerProviderErrorTrailPurge } from "../lib/providerErrorTrailPurge.js";
import { buildPublicShareView } from "../services/publicShareView.js";
import {
  buildHoldingActivityDividends,
  buildTickerDetails,
  buildTickerDividendOpenReconciliationPage,
  buildTickerDividendPostedHistoryPage,
  buildTickerDividendUpcomingPage,
  resolveTickerReadScope,
} from "../services/tickerDetails.js";
import type { AnonymousShareTokenDto, AnonymousShareTokenStatus } from "@vakwen/shared-types";
import type { DailyBar, InstrumentType, MarketCode } from "@vakwen/domain";

export const userScopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const tickerSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1);

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z.string().refine(isIsoCalendarDate, {
  message: "Expected a valid ISO calendar date (YYYY-MM-DD)",
});
const TICKER_CHART_RANGES = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL"] as const;
const tickerChartRangeSchema = z.enum(TICKER_CHART_RANGES);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const aiConnectorScopeValues = [
  "portfolio:mcp_read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
  "dividend:write",
] as const satisfies readonly AiConnectorScope[];
const shareCapabilityValues = [
  ...aiConnectorScopeValues,
  "sharing:manage",
] as const satisfies readonly ShareCapability[];
const shareCapabilitySchema = z.enum(shareCapabilityValues);
const shareCapabilitiesSchema = z.array(shareCapabilitySchema).max(shareCapabilityValues.length).default([]);
const aiConnectorScopesSchema = z.array(z.enum(aiConnectorScopeValues)).max(aiConnectorScopeValues.length);
const aiConnectorBearerClientKindSchema = z.enum([
  "claude_code",
  "codex_cli",
  "gemini_cli",
  "copilot_mcp",
  "generic_mcp",
]);
const queryBooleanSchema = z.preprocess((rawValue) => {
  const value = Array.isArray(rawValue) ? rawValue[rawValue.length - 1] : rawValue;
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return value;
}, z.boolean());

function normalizeAccountIdsQueryValue(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const accountIds = rawValues
    .flatMap((item) => typeof item === "string" ? item.split(",") : [])
    .map((item) => item.trim())
    .filter(Boolean);
  return accountIds.length > 0 ? accountIds : undefined;
}

function normalizeTickerQueryValue(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const tickers = rawValues
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return tickers.length > 0 ? [...new Set(tickers)] : undefined;
}

function normalizeRepeatedStringQueryValue(value: unknown): string[] | undefined {
  const rawValues = Array.isArray(value) ? value : [value];
  const values = rawValues
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function sortDividendDailyHighlightItems<T extends {
  applicableLocalDate: string;
  marketCode: SharedMarketCode;
  accountId: string;
  ticker: string;
  id: string;
}>(items: readonly T[]): T[] {
  return [...items].sort((left, right) =>
    left.applicableLocalDate.localeCompare(right.applicableLocalDate)
    || left.marketCode.localeCompare(right.marketCode)
    || left.accountId.localeCompare(right.accountId)
    || left.ticker.localeCompare(right.ticker)
    || left.id.localeCompare(right.id));
}

// KZO-169: closed-set MarketCode chip ("ALL" not allowed at the route layer —
// transactions must commit to a specific market).
const marketCodeSchema = z.enum(MARKET_CODES);
const accountDefaultCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);
const tickerChartQuerySchema = z.object({
  accountId: userScopedIdSchema.optional(),
  accountIds: z.preprocess(normalizeAccountIdsQueryValue, z.array(userScopedIdSchema).max(50).optional()),
  marketCode: marketCodeSchema.optional(),
  range: tickerChartRangeSchema.optional(),
  startDate: isoDateSchema.optional(),
  endDate: isoDateSchema.optional(),
  includeProvisional: queryBooleanSchema.optional(),
}).superRefine((value, ctx) => {
  const hasCustomStart = Boolean(value.startDate);
  const hasCustomEnd = Boolean(value.endDate);
  const hasCustomRange = hasCustomStart || hasCustomEnd;

  if (value.range && hasCustomRange) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Provide either range or startDate/endDate, not both",
      path: ["range"],
    });
  }

  if (hasCustomStart !== hasCustomEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Both startDate and endDate are required for a custom range",
      path: [hasCustomStart ? "endDate" : "startDate"],
    });
  }

  if (value.startDate && value.endDate && value.startDate > value.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "startDate must be before or equal to endDate",
      path: ["startDate"],
    });
  }
});

const transactionSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  // KZO-169: required body field — every trade pins to (ticker, marketCode).
  // Backfilled to "TW" for legacy fixtures via Slice 12 (G4) audit; new client
  // code path always supplies it (form chip default derived from accounts).
  marketCode: marketCodeSchema,
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive().multipleOf(0.01),
  priceCurrency: currencyCodeSchema.default("TWD"),
  tradeDate: isoDateSchema,
  tradeTimestamp: isoDateTimeSchema.optional(),
  bookingSequence: z.number().int().positive().optional(),
  commissionAmount: bookedChargeFieldSchema("Commission").optional(),
  taxAmount: bookedChargeFieldSchema("Tax").optional(),
  type: z.enum(["BUY", "SELL"]),
  isDayTrade: z.boolean().default(false),
});

const feeProfilePayloadSchema = z.object({
  name: z.string().trim().min(1).max(80),
  boardCommissionRate: z.number().nonnegative(),
  commissionDiscountPercent: z.number().min(0).max(100),
  minimumCommissionAmount: z.number().int().nonnegative(),
  commissionCurrency: currencyCodeSchema.default("TWD"),
  commissionRoundingMode: z.enum(["FLOOR", "ROUND", "CEIL"]),
  taxRoundingMode: z.enum(["FLOOR", "ROUND", "CEIL"]),
  stockSellTaxRateBps: z.number().int().nonnegative(),
  stockDayTradeTaxRateBps: z.number().int().nonnegative(),
  etfSellTaxRateBps: z.number().int().nonnegative(),
  bondEtfSellTaxRateBps: z.number().int().nonnegative(),
  commissionChargeMode: z.enum(["CHARGED_UPFRONT", "CHARGED_UPFRONT_REBATED_LATER"]),
});

// KZO-183 → ui-reshape Phase 3d S8: `feeProfileDraftSchema` validated bulk
// `PUT /settings/full` payloads (every draft.accountId had to resolve to one
// of the accounts in the body, AND every account.feeProfileRef had to
// resolve to a profile owned by that same account). The bulk-save endpoint
// is now retired; the schema is removed alongside the handler.

const feeBindingSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  feeProfileId: userScopedIdSchema,
});

const corporateActionSchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  actionType: z.enum(["DIVIDEND", "SPLIT", "REVERSE_SPLIT"]),
  numerator: z.number().int().positive().default(1),
  denominator: z.number().int().positive().default(1),
  actionDate: isoDateSchema,
  actionTimestamp: isoDateTimeSchema.optional(),
  cashInLieuAmount: z.number().nonnegative().optional(),
  cashInLieuCurrency: currencyCodeSchema.optional(),
});

const dividendDeductionSchema = z.object({
  deductionType: z.enum([
    "NHI_SUPPLEMENTAL_PREMIUM",
    "WITHHOLDING_TAX",
    "BROKER_FEE",
    "BANK_FEE",
    "TRANSFER_FEE",
    "CASH_IN_LIEU_ADJUSTMENT",
    "ROUNDING_ADJUSTMENT",
    "OTHER",
  ]),
  amount: z.number().int().positive(),
  currencyCode: currencyCodeSchema.default("TWD"),
  withheldAtSource: z.boolean().default(true),
  source: userScopedIdSchema.default("dividend_posting"),
  sourceReference: userScopedIdSchema.optional(),
  note: z.string().trim().min(1).max(200).optional(),
});

const dividendSourceLineSchema = z.object({
  id: userScopedIdSchema.optional(),
  sourceBucket: z.enum([
    "DIVIDEND_INCOME",
    "INTEREST_INCOME",
    "SECURITIES_GAIN_INCOME",
    "REVENUE_EQUALIZATION",
    "CAPITAL_EQUALIZATION",
    "CAPITAL_RETURN",
    "OTHER",
  ]),
  amount: z.number().positive(),
  currencyCode: z.literal("TWD").default("TWD"),
  source: userScopedIdSchema.default("dividend_posting"),
  sourceReference: userScopedIdSchema.optional(),
  note: z.string().trim().min(1).max(200).optional(),
});

function isPositiveDecimalWithinPrecision(
  value: string,
  maxIntegerDigits: number,
  maxFractionDigits: number,
): boolean {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return false;
  const integerDigits = (match[1] ?? "").replace(/^0+(?=\d)/, "");
  const fractionDigits = match[2] ?? "";
  return integerDigits.length <= maxIntegerDigits
    && fractionDigits.length <= maxFractionDigits
    && /[1-9]/.test(value);
}

function positiveDecimalTextSchema(
  fieldName: string,
  maxIntegerDigits: number,
  maxFractionDigits: number,
) {
  return z.string().trim().superRefine((value, ctx) => {
    if (!isPositiveDecimalWithinPrecision(value, maxIntegerDigits, maxFractionDigits)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${fieldName} must be a positive decimal with at most ${maxIntegerDigits} integer and ${maxFractionDigits} fractional digits`,
      });
    }
  });
}

const selectedParValueSchema = positiveDecimalTextSchema("selectedParValue", 14, 6);
const customRatioSchema = positiveDecimalTextSchema("customRatio", 8, 12);

const dividendPostingSchema = z
  .object({
    accountId: userScopedIdSchema,
    dividendEventId: userScopedIdSchema,
    receivedCashAmount: z.number().int().nonnegative().default(0),
    receivedStockQuantity: z.number().int().nonnegative().default(0),
    deductions: z.array(dividendDeductionSchema).max(20).default([]),
    sourceLines: z.array(dividendSourceLineSchema).max(20).default([]),
    sourceCompositionStatus: z.enum(["provided", "unknown_pending_disclosure"]).default("unknown_pending_disclosure"),
    dividendLedgerEntryId: userScopedIdSchema.optional(),
    expectedVersion: z.number().int().positive().optional(),
    calculation: z.object({
      method: z.enum(["provider_ratio", "derived_from_par_value", "custom_ratio"]),
      selectedParValue: selectedParValueSchema.nullable().optional(),
      customRatio: customRatioSchema.nullable().optional(),
      acknowledgeHighRatio: z.boolean().optional(),
      acknowledgeDrift: z.boolean().optional(),
    }).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.dividendLedgerEntryId && value.expectedVersion === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedVersion"],
        message: "expectedVersion is required when dividendLedgerEntryId is present",
      });
    }
    if (!value.dividendLedgerEntryId && value.expectedVersion !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expectedVersion"],
        message: "expectedVersion is only allowed when editing an existing dividend posting",
      });
    }
  });

const dividendDateRangeQuerySchema = z.object({
  fromPaymentDate: isoDateSchema.optional(),
  toPaymentDate: isoDateSchema.optional(),
  limit: z.coerce.number().int().positive().max(500).default(500),
});

// Standalone schema (NOT extending dividendDateRangeQuerySchema) because
// the default limit changes 500 → 50 for paginated dividend ledger listing.
const dividendLedgerQuerySchema = z.object({
  fromPaymentDate: isoDateSchema.optional(),
  toPaymentDate: isoDateSchema.optional(),
  accountId: userScopedIdSchema.optional(),
  reconciliationStatus: z.enum(["open", "matched", "explained", "resolved"]).optional(),
  postingStatus: z.enum(["expected", "posted", "adjusted"]).optional(),
  excludeExpected: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  ticker: tickerSchema.optional(),
  marketCode: marketCodeSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(50),
  sortBy: z
    .enum([
      "paymentDate",
      "ticker",
      "account",
      "expectedCashAmount",
      "receivedCashAmount",
      "reconciliationStatus",
    ])
    .default("paymentDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const dividendReviewQuerySchema = z.object({
  fromPaymentDate: isoDateSchema.optional(),
  toPaymentDate: isoDateSchema.optional(),
  accountId: z.preprocess(normalizeRepeatedStringQueryValue, z.array(userScopedIdSchema).max(50).optional()),
  cashStatus: z.preprocess(
    normalizeRepeatedStringQueryValue,
    z.array(z.enum(["open", "matched", "explained", "resolved"])).max(50).optional(),
  ),
  stockStatus: z.preprocess(
    normalizeRepeatedStringQueryValue,
    z.array(z.enum(["needs_calculation", "pending_receipt", "matched", "variance", "explained"])).max(50).optional(),
  ),
  reconciliationStatus: z.enum(["open", "matched", "explained", "resolved"]).optional(),
  postingStatus: z.enum(["expected", "posted", "adjusted"]).optional(),
  excludeExpected: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  ticker: z.preprocess(normalizeTickerQueryValue, z.array(tickerSchema).max(50).optional()),
  marketCode: marketCodeSchema.optional(),
  sourceComposition: z.literal("pending").optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().refine((value) => value === 10 || value === 25 || value === 50, {
    message: "limit must be one of 10, 25, or 50",
  }).default(10),
  sortBy: z.enum([
    "paymentDate",
    "ticker",
    "account",
    "expectedNetAmount",
    "nhiAmount",
    "bankFeeAmount",
    "otherDeductionAmount",
    "actualNetAmount",
    "varianceAmount",
    "reconciliationStatus",
  ]).default("paymentDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const sellAvailabilityQuerySchema = z.object({
  accountId: userScopedIdSchema,
  ticker: tickerSchema,
  marketCode: marketCodeSchema,
  tradeDate: isoDateSchema,
  tradeTimestamp: isoDateTimeSchema.optional(),
  bookingSequence: z.coerce.number().int().positive().optional(),
});

const dividendReviewFilterQuerySchema = dividendReviewQuerySchema.omit({
  page: true,
  limit: true,
  sortBy: true,
  sortOrder: true,
});

const pagedDividendLimitSchema = z.coerce.number().int().refine((value) => value === 10 || value === 25 || value === 50, {
  message: "limit must be one of 10, 25, or 50",
});

const holdingActivityDividendsQuerySchema = z.object({
  accountId: userScopedIdSchema.optional(),
  accountIds: z.preprocess(normalizeAccountIdsQueryValue, z.array(userScopedIdSchema).max(50).optional()),
  marketCode: marketCodeSchema.optional(),
  positionActionsPage: z.coerce.number().int().positive().default(1),
  positionActionsLimit: pagedDividendLimitSchema.default(10),
  upcomingPage: z.coerce.number().int().positive().default(1),
  upcomingLimit: pagedDividendLimitSchema.default(10),
  postedPage: z.coerce.number().int().positive().default(1),
  postedLimit: pagedDividendLimitSchema.default(10),
});

const tickerDividendListQuerySchema = z.object({
  accountId: userScopedIdSchema.optional(),
  accountIds: z.preprocess(normalizeAccountIdsQueryValue, z.array(userScopedIdSchema).max(50).optional()),
  marketCode: marketCodeSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: pagedDividendLimitSchema.default(10),
});

const dividendDailyHighlightsQuerySchema = z.object({
  accountId: userScopedIdSchema.optional(),
  marketCode: marketCodeSchema.optional(),
  at: isoDateTimeSchema.optional(),
});

const dividendReconciliationSchema = z.object({
  status: z.enum(["open", "matched", "explained", "resolved"]),
  note: z.string().trim().max(500).optional(),
});

const dividendStockReconciliationSchema = z.object({
  status: z.enum(["needs_calculation", "pending_receipt", "matched", "variance", "explained"]),
  note: z.string().trim().max(500).nullable().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

const dividendSettingsPatchSchema = z.object({
  expectedVersion: z.number().int().nonnegative().optional(),
  fallbackParValue: selectedParValueSchema.nullable(),
});

const dividendCalculationPreviewSchema = z.object({
  accountId: userScopedIdSchema,
  dividendEventId: userScopedIdSchema,
  method: z.enum(["provider_ratio", "derived_from_par_value", "custom_ratio"]),
  selectedParValue: selectedParValueSchema.nullable().optional(),
  customRatio: customRatioSchema.nullable().optional(),
});

const dividendCalculationExpectationFields = {
  expectedActiveCalculationId: userScopedIdSchema.nullable().optional(),
  expectedCalculationVersion: z.number().int().positive().nullable().optional(),
} as const;

function requireDividendCalculationExpectation(
  value: {
    expectedActiveCalculationId?: string | null;
    expectedCalculationVersion?: number | null;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.expectedActiveCalculationId === undefined && value.expectedCalculationVersion === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "expectedActiveCalculationId or expectedCalculationVersion is required",
      path: ["expectedActiveCalculationId"],
    });
  }
}

const dividendCalculationConfirmSchema = z.object({
  ...dividendCalculationPreviewSchema.shape,
  ...dividendCalculationExpectationFields,
  acknowledgeHighRatio: z.boolean().optional(),
  acknowledgeDrift: z.boolean().optional(),
}).superRefine(requireDividendCalculationExpectation);

const dividendCalculationResetSchema = z.object({
  accountId: userScopedIdSchema,
  dividendEventId: userScopedIdSchema,
  ...dividendCalculationExpectationFields,
}).superRefine(requireDividendCalculationExpectation);

const dividendCalculationAmendSchema = z.object({
  ...dividendCalculationPreviewSchema.shape,
  ...dividendCalculationExpectationFields,
  acknowledgeHighRatio: z.boolean().optional(),
  acknowledgeDrift: z.boolean().optional(),
  dividendLedgerEntryId: userScopedIdSchema,
}).superRefine(requireDividendCalculationExpectation);

const cashLedgerEntryTypes = [
  "TRADE_SETTLEMENT_IN",
  "TRADE_SETTLEMENT_OUT",
  "DIVIDEND_RECEIPT",
  "DIVIDEND_DEDUCTION",
  "MANUAL_ADJUSTMENT",
  "FX_TRANSFER_OUT",
  "FX_TRANSFER_IN",
  "REVERSAL",
] as const;

const cashLedgerQuerySchema = z.object({
  fromEntryDate: isoDateSchema.optional(),
  toEntryDate: isoDateSchema.optional(),
  accountId: userScopedIdSchema.optional(),
  entryType: z.union([
    z.enum(cashLedgerEntryTypes),
    z.array(z.enum(cashLedgerEntryTypes)),
  ]).optional().transform(v => v ? (Array.isArray(v) ? v : [v]) : undefined),
  limit: z.coerce.number().int().positive().max(500).default(50),
  page: z.coerce.number().int().min(1).default(1),
  sortBy: z.enum(["entryDate", "entryType", "amount", "currency", "accountId"]).default("entryDate"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

const fxTransferSchema = z.object({
  fromAccountId: userScopedIdSchema,
  toAccountId: userScopedIdSchema,
  fromAmount: z.number().positive(),
  toAmount: z.number().positive(),
  effectiveRate: z.number().positive(),
  entryDate: isoDateSchema,
  notes: z.string().trim().max(500).optional(),
});

const fxTransferUpdateSchema = z
  .object({
    fromAmount: z.number().positive().optional(),
    toAmount: z.number().positive().optional(),
    effectiveRate: z.number().positive().optional(),
    entryDate: isoDateSchema.optional(),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((value, ctx) => {
    const economicCount = [value.fromAmount, value.toAmount, value.effectiveRate]
      .filter((field) => field !== undefined).length;
    if (economicCount > 0 && economicCount < 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveRate"],
        message: "fromAmount, toAmount, and effectiveRate must be provided together",
      });
    }
    if (
      value.fromAmount === undefined &&
      value.toAmount === undefined &&
      value.effectiveRate === undefined &&
      value.entryDate === undefined &&
      value.notes === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "at least one field required",
      });
    }
  });

const fxTransferParamsSchema = z.object({ id: z.string().uuid() });
const fxTransferReverseSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

function buildCookieAttrs(cookieName: string, isProduction: boolean, cookieDomain?: string): string {
  const secure = isProduction || cookieName.startsWith("__Host-");
  // __Host- prefix prohibits Domain attribute per RFC 6265bis; skip it for prefixed names.
  const domain = cookieDomain && !cookieName.startsWith("__Host-") ? `; Domain=${cookieDomain}` : "";
  return `Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}${domain}`;
}

function parseCookieValue(cookieHeader: string | undefined, cookieName: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const eqIdx = part.indexOf("=");
    if (eqIdx <= 0) continue;
    if (part.slice(0, eqIdx).trim() === cookieName) {
      const value = part.slice(eqIdx + 1).trim();
      return value || null;
    }
  }
  return null;
}

export function sessionClearCookieString(): string {
  const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  return `${Env.SESSION_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
}

export function impersonationClearCookieString(): string {
  const attrs = buildCookieAttrs(IMPERSONATION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  return `${IMPERSONATION_COOKIE_NAME}=; ${attrs}; Max-Age=0`;
}

export function impersonationSetCookieString(cookieValue: string, ttlMinutes: number): string {
  const attrs = buildCookieAttrs(IMPERSONATION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  const maxAgeSeconds = ttlMinutes * 60 + 5 * 60;
  return `${IMPERSONATION_COOKIE_NAME}=${cookieValue}; ${attrs}; Max-Age=${maxAgeSeconds}`;
}

const VALID_USER_ROLES = ["admin", "member", "viewer"] as const;
export const userRoleSchema = z.enum(VALID_USER_ROLES);
const PUBLIC_ROUTE_KEYS = new Set([
  "GET /health/live",
  "GET /health/ready",
  "GET /mcp/health",
  "GET /.well-known/oauth-protected-resource",
  "GET /.well-known/oauth-protected-resource/mcp",
  "GET /.well-known/oauth-authorization-server",
  "GET /.well-known/oauth-authorization-server/mcp",
  "GET /.well-known/openid-configuration",
  "GET /.well-known/openid-configuration/mcp",
  "GET /oauth/authorize",
  "GET /oauth/redirect",
  "POST /oauth/token",
  "POST /mcp",
  "GET /mcp",
  "DELETE /mcp",
  "GET /auth/logout",
  "GET /auth/google/start",
  "GET /auth/google/callback",
  "POST /auth/token/refresh",
  "POST /auth/demo/start",
  "POST /__e2e/oauth-session",
  "POST /__e2e/demo-session",
  "POST /__e2e/impersonation-session",
  "POST /__e2e/reset-demo-rate-buckets",
  "POST /__e2e/reset-market-data-search-rate-limit",
  "POST /__e2e/inject-search-error",
  "POST /__e2e/reset-app-config",
  "POST /__e2e/seed-anonymous-share-token",
  "POST /__e2e/anon-share-rate-reset",
  "POST /__e2e/anon-share-deactivate-owner",
  "GET /invites/:code/status",
  "GET /share/:token",
]);
const WRITER_ROLE_ROUTE_KEYS = new Set([
  "PATCH /settings",
  // ui-reshape Phase 3d S8 — `PUT /settings/full` retired; per-resource PATCH.
  "PUT /settings/fee-config",
  "PATCH /profile",
  "POST /accounts",
  "PATCH /accounts/:id",
  "PATCH /accounts/:id/dividend-settings/:marketCode",
  "POST /fx-transfers",
  "PATCH /fx-transfers/:id",
  "POST /fx-transfers/:id/reverse",
  "POST /fee-profiles",
  "PATCH /fee-profiles/:id",
  "DELETE /fee-profiles/:id",
  "PUT /fee-profile-bindings",
  "POST /portfolio/transactions",
  "GET /portfolio/transactions/sell-availability",
  "DELETE /portfolio/transactions/:tradeEventId",
  "PATCH /portfolio/transactions/:tradeEventId",
  "POST /portfolio/transactions/:tradeEventId/dividend-delete-preview",
  "POST /portfolio/transactions/:tradeEventId/dividend-delete-confirm",
  "POST /portfolio/transactions/mutations/update-preview",
  "POST /portfolio/transactions/mutations/delete-preview",
  "POST /portfolio/transactions/mutations/previews/:previewId/confirm",
  "POST /portfolio/dividends/postings",
  "POST /portfolio/dividends/calculations/confirm",
  "POST /portfolio/dividends/calculations/reset",
  "POST /portfolio/dividends/calculations/amend",
  "POST /portfolio/accounts/:accountId/purge-rebuild-preview",
  "POST /portfolio/accounts/:accountId/purge-rebuild-confirm",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/stock-reconciliation",
  "POST /corporate-actions",
  "POST /portfolio/snapshots/generate",
  "POST /portfolio/refresh-closes",
  "POST /portfolio/recompute/preview",
  "POST /portfolio/recompute/confirm",
  "POST /ai/transactions/confirm",
  "POST /ai/connectors/bearer",
  "PATCH /ai/transaction-drafts/:batchId/rows/:rowId",
  "POST /ai/transaction-drafts/:batchId/exclude",
  "POST /ai/transaction-drafts/:batchId/reinclude",
  "POST /ai/transaction-drafts/:batchId/reject",
  "POST /ai/transaction-drafts/:batchId/archive",
  "DELETE /ai/transaction-drafts/:batchId",
  "POST /ai/transaction-drafts/:batchId/confirm",
  "PATCH /ai/connectors/:id",
  "DELETE /ai/connectors/:id",
  "POST /ai/connectors/:id/hide",
  "POST /shares",
  "PATCH /shares/:id/capabilities",
  "PATCH /shares/pending/:code/capabilities",
  "DELETE /shares/pending/:code",
  "DELETE /shares/:id",
  "POST /share-tokens",
  "DELETE /share-tokens/:id",
  "PUT /monitored-tickers",
  "POST /backfill/retry",
  "POST /backfill/repair",
  "PATCH /notifications/:id/read",
  "PATCH /notifications/read-all",
  "DELETE /notifications/:id",
  "PATCH /notifications/:id/escalate",
  // ui-enhancement — account lifecycle mutations.
  "DELETE /accounts/:id",
  "POST /accounts/:id/restore",
  "POST /accounts/:id/purge",
]);

/**
 * Routes that mutate the portfolio backing store. When the viewer is in a
 * shared-context session (`isSharedContext=true`) these MUST 403 so the
 * grantee cannot write through to the owner's portfolio.
 *
 * Subset of `WRITER_ROLE_ROUTE_KEYS`. Identity-surface writes
 * (`PATCH /profile`, notification CUD) are intentionally excluded: they act
 * on the session user's own record regardless of viewing context.
 */
const SHARED_CONTEXT_WRITE_ROUTE_KEYS = new Set([
  "PATCH /settings",
  // ui-reshape Phase 3d S8 — `PUT /settings/full` retired; per-resource PATCH.
  "PUT /settings/fee-config",
  "POST /accounts",
  "PATCH /accounts/:id",
  "PATCH /accounts/:id/dividend-settings/:marketCode",
  "DELETE /accounts/:id",
  "POST /accounts/:id/restore",
  "POST /accounts/:id/purge",
  "POST /fx-transfers",
  "PATCH /fx-transfers/:id",
  "POST /fx-transfers/:id/reverse",
  "POST /fee-profiles",
  "PATCH /fee-profiles/:id",
  "DELETE /fee-profiles/:id",
  "PUT /fee-profile-bindings",
  "POST /portfolio/transactions",
  "GET /portfolio/transactions/sell-availability",
  "DELETE /portfolio/transactions/:tradeEventId",
  "PATCH /portfolio/transactions/:tradeEventId",
  "POST /portfolio/transactions/:tradeEventId/dividend-delete-preview",
  "POST /portfolio/transactions/:tradeEventId/dividend-delete-confirm",
  "POST /portfolio/transactions/mutations/update-preview",
  "POST /portfolio/transactions/mutations/delete-preview",
  "POST /portfolio/transactions/mutations/previews/:previewId/confirm",
  "POST /portfolio/dividends/postings",
  "POST /portfolio/dividends/calculations/confirm",
  "POST /portfolio/dividends/calculations/reset",
  "POST /portfolio/dividends/calculations/amend",
  "POST /portfolio/accounts/:accountId/purge-rebuild-preview",
  "POST /portfolio/accounts/:accountId/purge-rebuild-confirm",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/stock-reconciliation",
  "POST /corporate-actions",
  "POST /share-tokens",
  "DELETE /share-tokens/:id",
  "POST /portfolio/snapshots/generate",
  "POST /portfolio/refresh-closes",
  "POST /portfolio/recompute/preview",
  "POST /portfolio/recompute/confirm",
  "POST /ai/transactions/confirm",
  "PATCH /ai/transaction-drafts/:batchId/rows/:rowId",
  "POST /ai/transaction-drafts/:batchId/exclude",
  "POST /ai/transaction-drafts/:batchId/reinclude",
  "POST /ai/transaction-drafts/:batchId/reject",
  "POST /ai/transaction-drafts/:batchId/archive",
  "DELETE /ai/transaction-drafts/:batchId",
  "POST /ai/transaction-drafts/:batchId/confirm",
  "POST /shares",
  "PATCH /shares/:id/capabilities",
  "PATCH /shares/pending/:code/capabilities",
  "DELETE /shares/pending/:code",
  "DELETE /shares/:id",
  "PUT /monitored-tickers",
  "POST /backfill/retry",
  "POST /backfill/repair",
]);
const SHARED_CONTEXT_WRITE_CAPABILITY_MATRIX: Readonly<Record<string, ShareCapability>> = {
  "PUT /settings/fee-config": "account:manage",
  "POST /accounts": "account:manage",
  "PATCH /accounts/:id": "account:manage",
  "PATCH /accounts/:id/dividend-settings/:marketCode": "account:manage",
  "DELETE /accounts/:id": "account:manage",
  "POST /accounts/:id/restore": "account:manage",
  "POST /fee-profiles": "account:manage",
  "PATCH /fee-profiles/:id": "account:manage",
  "DELETE /fee-profiles/:id": "account:manage",
  "PUT /fee-profile-bindings": "account:manage",
  "POST /portfolio/transactions": "transaction:write",
  "GET /portfolio/transactions/sell-availability": "transaction:write",
  "DELETE /portfolio/transactions/:tradeEventId": "transaction:write",
  "PATCH /portfolio/transactions/:tradeEventId": "transaction:write",
  "POST /portfolio/transactions/:tradeEventId/dividend-delete-preview": "transaction:write",
  "POST /portfolio/transactions/:tradeEventId/dividend-delete-confirm": "transaction:write",
  "POST /portfolio/transactions/mutations/update-preview": "transaction:write",
  "POST /portfolio/transactions/mutations/delete-preview": "transaction:write",
  "POST /portfolio/transactions/mutations/previews/:previewId/confirm": "transaction:write",
  "POST /portfolio/dividends/postings": "dividend:write",
  "POST /portfolio/dividends/calculations/confirm": "dividend:write",
  "POST /portfolio/dividends/calculations/reset": "dividend:write",
  "POST /portfolio/dividends/calculations/amend": "dividend:write",
  "POST /portfolio/accounts/:accountId/purge-rebuild-preview": "transaction:write",
  "POST /portfolio/accounts/:accountId/purge-rebuild-confirm": "transaction:write",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation": "dividend:write",
  "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/stock-reconciliation": "dividend:write",
  "POST /ai/transactions/confirm": "transaction:write",
  "POST /ai/transaction-drafts/:batchId/confirm": "transaction:write",
  "PATCH /ai/transaction-drafts/:batchId/rows/:rowId": "transaction_draft:edit",
  "POST /ai/transaction-drafts/:batchId/exclude": "transaction_draft:edit",
  "POST /ai/transaction-drafts/:batchId/reinclude": "transaction_draft:edit",
  "POST /ai/transaction-drafts/:batchId/reject": "transaction_draft:edit",
  "POST /ai/transaction-drafts/:batchId/archive": "transaction_draft:archive",
  "DELETE /ai/transaction-drafts/:batchId": "transaction_draft:delete",
  "POST /shares": "sharing:manage",
  "PATCH /shares/:id/capabilities": "sharing:manage",
  "PATCH /shares/pending/:code/capabilities": "sharing:manage",
  "DELETE /shares/pending/:code": "sharing:manage",
  "DELETE /shares/:id": "sharing:manage",
};

function requireDelegatedDividendWriteForHistoryRewrite(
  sharedContext: Awaited<ReturnType<typeof resolveActiveSharedCapabilityContext>>,
  routeKey: string,
): void {
  if (!sharedContext || sharedContext.shareCapabilities.includes("dividend:write")) return;
  throw routeError(
    403,
    "shared_capability_required",
    "Shared portfolio capability dividend:write is required when a history rewrite can purge dividends.",
    {
      routeKey,
      requiredCapability: "dividend:write",
      shareId: sharedContext.shareId,
      sessionUserId: sharedContext.sessionUserId,
      contextUserId: sharedContext.ownerUserId,
    },
  );
}
const ADMIN_ROUTE_KEYS = new Set([
  "POST /invites",
  "DELETE /invites/:code",
  "GET /admin/users",
  "PATCH /admin/users/:id/role",
  "POST /admin/users/:id/disable",
  "POST /admin/users/:id/enable",
  "DELETE /admin/users/:id",
  "DELETE /admin/users/:id/purge",
  "POST /admin/users/:id/impersonate",
  "DELETE /admin/impersonation",
  "GET /admin/invites",
  "GET /admin/audit-log",
  "GET /admin/settings",
  "PATCH /admin/settings",
  "GET /admin/mcp/settings",
  "POST /admin/mcp/fresh-auth",
  "PATCH /admin/mcp/settings",
  // KZO-164: FX rate ingestion admin surface.
  // POST /admin/fx-rates/refresh has a route-local demo-before-admin guard.
  "GET /admin/fx-rates/freshness",
  // KZO-177: provider health admin surface.
  "GET /admin/providers",
  "POST /admin/providers/:providerId/rerun",
  "GET /admin/providers/:providerId/operations/summary",
  "GET /admin/providers/:providerId/diagnostics",
  "GET /admin/providers/:providerId/unresolved",
  "POST /admin/providers/:providerId/unresolved/state",
  "GET /admin/providers/:providerId/operations",
  "GET /admin/providers/:providerId/operations/:operationId/outcomes",
  "GET /admin/providers/:providerId/logs",
  "POST /admin/providers/:providerId/operations/preview",
  "POST /admin/providers/:providerId/operations/:operationId/execute",
  "POST /admin/providers/:providerId/operations/:operationId/pause",
  "POST /admin/providers/:providerId/operations/:operationId/resume",
  "POST /admin/providers/:providerId/operations/:operationId/cancel",
  "POST /admin/providers/:providerId/operations/:operationId/retry",
  "POST /admin/market-data/:marketCode/snapshot-repair/execute",
]);
const IMPERSONATION_WRITE_ALLOWLIST = new Set([
  "POST /admin/users/:id/impersonate",
  "DELETE /admin/impersonation",
]);
const IMPERSONATION_BLOCKED_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

type ResolvedRequestIdentity = {
  sessionUserId: string;
  contextUserId: string;
  role: UserRole;
  sessionVersion: number;
  isDemo: boolean;
  isImpersonating: boolean;
  isSharedContext: boolean;
  email?: string | null;
  impersonation: ImpersonationDto | null;
  userId: string;
};

function normalizeEmailAddress(email: string): string {
  return email.trim().toLowerCase();
}

function buildShareInviteUrl(app: FastifyInstance, code: string): string {
  return `${app.appBaseUrl}/invite/${code}`;
}

async function materializePendingSharesPostLogin(
  app: FastifyInstance,
  req: FastifyRequest,
  userId: string,
  email: string,
) {
  try {
    const materializedShares = await app.persistence.materializePendingSharesForEmail({
      userId,
      email,
      auditInput: {
        actorUserId: null,
        ipAddress: req.ip,
      },
    });
    for (const share of materializedShares) {
      await app.eventBus.publishEvent(userId, "sharing_notification", { shareId: share.id });
    }
  } catch (error) {
    req.log.warn({ err: error, userId }, "share materialization failed post-login");
  }
}

function toShareGrantDto(record: ShareGrantRecord, capabilities: ShareCapability[] = []) {
  return {
    id: record.id,
    status: record.revokedAt ? "revoked" as const : "active" as const,
    ownerUserId: record.ownerUserId,
    ownerEmail: record.ownerEmail,
    ownerDisplayName: record.ownerDisplayName,
    granteeUserId: record.granteeUserId,
    granteeEmail: record.granteeEmail,
    granteeDisplayName: record.granteeDisplayName,
    createdAt: record.createdAt,
    revokedAt: record.revokedAt,
    revokedByUserId: record.revokedByUserId,
    capabilities,
  };
}

function toPendingShareInviteDto(
  app: FastifyInstance,
  record: PendingShareInviteRecord,
  status: "pending" | "expired" | "revoked",
  capabilities: ShareCapability[] = [],
) {
  return {
    code: record.code,
    status,
    email: record.email,
    role: record.role,
    shareOwnerUserId: record.shareOwnerUserId,
    ownerEmail: record.ownerEmail,
    ownerDisplayName: record.ownerDisplayName,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    usedAt: record.usedAt,
    inviteUrl: buildShareInviteUrl(app, record.code),
    capabilities,
  };
}

async function toShareGrantDtoWithCapabilities(app: FastifyInstance, record: ShareGrantRecord) {
  return toShareGrantDto(record, await app.persistence.getShareCapabilities(record.id));
}

async function toPendingShareInviteDtoWithCapabilities(
  app: FastifyInstance,
  record: PendingShareInviteRecord,
  status: "pending" | "expired" | "revoked",
) {
  return toPendingShareInviteDto(
    app,
    record,
    status,
    await app.persistence.getPendingShareInviteCapabilities(record.code),
  );
}

type NamedShareManagementContext = {
  actorUserId: string;
  ownerUserId: string;
  isDelegated: boolean;
  delegationShareId: string | null;
  activeGrantCapabilities: ShareCapability[];
};

function buildDelegatedShareAuditMetadata(context: NamedShareManagementContext): Record<string, unknown> {
  if (!context.isDelegated) {
    return {};
  }

  return {
    delegatedByUserId: context.actorUserId,
    ownerUserId: context.ownerUserId,
    contextUserId: context.ownerUserId,
    source: "shared_context",
    ...(context.delegationShareId ? { delegationShareId: context.delegationShareId } : {}),
  };
}

async function resolveNamedShareManagementContext(
  req: FastifyRequest,
): Promise<NamedShareManagementContext> {
  const actorUserId = requireSessionUserId(req);

  if (!req.authContext?.isSharedContext) {
    requireShareGrantorRole(req);
    return {
      actorUserId,
      ownerUserId: actorUserId,
      isDelegated: false,
      delegationShareId: null,
      activeGrantCapabilities: [],
    };
  }

  const sharedContext = await resolveActiveSharedCapabilityContext(req);
  const routeUrl = req.routeOptions.url ?? req.url.split("?")[0] ?? req.url;
  const key = routeKey(req.method, routeUrl);
  if (!sharedContext || !sharedContext.shareCapabilities.includes("sharing:manage")) {
    throw routeError(
      403,
      "shared_capability_required",
      "Shared portfolio capability sharing:manage is required for this route.",
      {
        routeKey: key,
        requiredCapability: "sharing:manage",
        shareId: sharedContext?.shareId ?? null,
        sessionUserId: actorUserId,
        contextUserId: req.authContext.contextUserId,
      },
    );
  }

  return {
    actorUserId,
    ownerUserId: sharedContext.ownerUserId,
    isDelegated: true,
    delegationShareId: sharedContext.shareId,
    activeGrantCapabilities: sharedContext.shareCapabilities,
  };
}

async function resolveNamedShareListContext(
  req: FastifyRequest,
): Promise<NamedShareManagementContext> {
  const actorUserId = requireSessionUserId(req);

  if (!req.authContext?.isSharedContext) {
    return {
      actorUserId,
      ownerUserId: actorUserId,
      isDelegated: false,
      delegationShareId: null,
      activeGrantCapabilities: [],
    };
  }

  const sharedContext = await resolveActiveSharedCapabilityContext(req);
  const routeUrl = req.routeOptions.url ?? req.url.split("?")[0] ?? req.url;
  const key = routeKey(req.method, routeUrl);
  if (!sharedContext || !sharedContext.shareCapabilities.includes("sharing:manage")) {
    throw routeError(
      403,
      "shared_capability_required",
      "Shared portfolio capability sharing:manage is required for this route.",
      {
        routeKey: key,
        requiredCapability: "sharing:manage",
        shareId: sharedContext?.shareId ?? null,
        sessionUserId: actorUserId,
        contextUserId: req.authContext.contextUserId,
      },
    );
  }

  return {
    actorUserId,
    ownerUserId: sharedContext.ownerUserId,
    isDelegated: true,
    delegationShareId: sharedContext.shareId,
    activeGrantCapabilities: sharedContext.shareCapabilities,
  };
}

function assertDelegableShareCapabilities(
  context: NamedShareManagementContext,
  capabilities: readonly ShareCapability[],
): void {
  if (!context.isDelegated) {
    return;
  }

  const forbiddenCapabilities = capabilities.filter(
    (capability) => capability === "sharing:manage" || !context.activeGrantCapabilities.includes(capability),
  );
  if (forbiddenCapabilities.length === 0) {
    return;
  }

  throw routeError(
    403,
    "share_capability_assignment_forbidden",
    "Delegated share managers cannot assign capabilities they do not hold or grant sharing:manage onward.",
    {
      forbiddenCapabilities,
      assignableCapabilities: context.activeGrantCapabilities.filter((capability) => capability !== "sharing:manage"),
      ownerUserId: context.ownerUserId,
      delegatedByUserId: context.actorUserId,
      delegationShareId: context.delegationShareId,
    },
  );
}

function toAiConnectorConnectionDto(record: AiConnectorConnectionRecord) {
  return {
    id: record.id,
    provider: record.provider,
    vendor: record.vendor,
    clientKind: record.clientKind,
    authMode: record.authMode,
    capabilities: record.capabilities,
    displayName: record.displayName,
    status: record.status,
    hiddenAt: record.hiddenAt ?? null,
    scopes: record.scopes,
    toolToggles: record.toolToggles,
    expiresAt: record.expiresAt,
    expiryNotifiedAt: record.expiryNotifiedAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    revocationReason: record.revocationReason,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

function connectorVisibleInOperationalView(connection: AiConnectorConnectionRecord): boolean {
  return !connection.hiddenAt && (connection.status === "active" || connection.status === "pending");
}

function connectorVisibleInHistoryView(connection: AiConnectorConnectionRecord): boolean {
  return !connection.hiddenAt && (connection.status === "expired" || connection.status === "revoked");
}

function connectorEligibleForEffectiveAccess(connection: AiConnectorConnectionRecord): boolean {
  return connectorVisibleInOperationalView(connection)
    && connection.status === "active"
    && (!connection.expiresAt || Date.parse(connection.expiresAt) > Date.now());
}

function toAiConnectorAccessLogDto(record: AiConnectorAccessLogRecord, connection?: AiConnectorConnectionRecord | null) {
  return {
    id: record.id,
    connectionId: record.connectionId,
    connectionDisplayName: connection?.displayName ?? null,
    clientKind: connection?.clientKind ?? null,
    portfolioContextUserId: record.portfolioContextUserId,
    shareId: record.shareId,
    toolName: record.toolName,
    accessKind: record.accessKind,
    result: record.result,
    denialReason: record.denialReason,
    createdAt: record.createdAt,
  };
}

function buildAiConnectorToolCatalog(
  policy: Pick<AiConnectorPolicySettingsDto, "enabled" | "allowedClientKinds" | "groupToggles" | "bearerFallback">,
  connections: AiConnectorConnectionRecord[] = [],
) {
  return listMcpToolDefinitions().map((tool) => {
    const group = connectorGroupForScope(tool.scope);
    const enabledByPolicy = policy.enabled && policy.groupToggles[group];
    const unavailableReason = !policy.enabled
      ? "AI connector deployment is disabled by admin policy."
      : !policy.groupToggles[group]
        ? `${group === "read" ? "Read" : group === "drafts" ? "Draft" : "Write"} MCP tools are disabled by admin policy.`
        : null;
    return {
      name: tool.name,
      description: tool.description,
      scope: tool.scope,
      accessKind: tool.accessKind,
      group,
      inputSchema: summarizeMcpInputSchema(tool.inputSchema),
      enabledByPolicy,
      availability: enabledByPolicy ? "available" as const : "unavailable" as const,
      unavailableReason,
      annotations: tool.annotations,
      effectiveAccess: connections.map((connection) => {
        const blockerCode = getToolEffectiveAccessBlocker(policy, connection, tool.scope, tool.name, tool.accessKind, enabledByPolicy);
        return {
          connectionId: connection.id,
          connectionDisplayName: connection.displayName,
          clientKind: connection.clientKind,
          status: blockerCode === null ? "available" as const : "blocked" as const,
          blockerCode,
        };
      }),
    };
  });
}

function summarizeMcpInputSchema(schema: unknown): AiConnectorToolInputSchemaDto {
  const objectShape = getZodObjectShape(schema);
  const fields = Object.entries(objectShape).map(([name, fieldSchema]) => {
    const unwrapped = unwrapZodSchema(fieldSchema);
    return {
      name,
      type: describeZodSchema(unwrapped),
      required: !isOptionalZodSchema(fieldSchema),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  return {
    fields,
    rawSchema: {
      type: "object",
      properties: Object.fromEntries(fields.map((field) => [field.name, { type: field.type }])),
      required: fields.filter((field) => field.required).map((field) => field.name),
    },
  };
}

function getZodObjectShape(schema: unknown): Record<string, unknown> {
  if (typeof schema !== "object" || schema === null) return {};
  const maybeShape = (schema as { shape?: unknown }).shape;
  if (typeof maybeShape === "function") {
    const result = maybeShape();
    return typeof result === "object" && result !== null ? result as Record<string, unknown> : {};
  }
  return typeof maybeShape === "object" && maybeShape !== null ? maybeShape as Record<string, unknown> : {};
}

function getZodTypeName(schema: unknown): string {
  return typeof schema === "object" && schema !== null && "_def" in schema
    ? String((schema as { _def?: { typeName?: unknown } })._def?.typeName ?? "unknown")
    : "unknown";
}

function unwrapZodSchema(schema: unknown): unknown {
  let current = schema;
  while (["ZodOptional", "ZodDefault", "ZodNullable"].includes(getZodTypeName(current))) {
    const inner = (current as { _def?: { innerType?: unknown; schema?: unknown } })._def?.innerType
      ?? (current as { _def?: { innerType?: unknown; schema?: unknown } })._def?.schema;
    if (!inner || inner === current) break;
    current = inner;
  }
  return current;
}

function isOptionalZodSchema(schema: unknown): boolean {
  const typeName = getZodTypeName(schema);
  if (typeName === "ZodOptional" || typeName === "ZodDefault") return true;
  const inner = (schema as { _def?: { innerType?: unknown; schema?: unknown } } | null)?._def?.innerType
    ?? (schema as { _def?: { innerType?: unknown; schema?: unknown } } | null)?._def?.schema;
  return inner ? isOptionalZodSchema(inner) : false;
}

function describeZodSchema(schema: unknown): string {
  const typeName = getZodTypeName(schema);
  if (typeName === "ZodString") return "string";
  if (typeName === "ZodNumber") return "number";
  if (typeName === "ZodBoolean") return "boolean";
  if (typeName === "ZodArray") return "array";
  if (typeName === "ZodObject") return "object";
  if (typeName === "ZodEnum" || typeName === "ZodNativeEnum") return "enum";
  if (typeName === "ZodLiteral") return "literal";
  if (typeName === "ZodUnion" || typeName === "ZodDiscriminatedUnion") return "union";
  return typeName.replace(/^Zod/, "").toLowerCase() || "unknown";
}

function getToolEffectiveAccessBlocker(
  policy: Pick<AiConnectorPolicySettingsDto, "enabled" | "allowedClientKinds" | "groupToggles" | "bearerFallback">,
  connection: AiConnectorConnectionRecord,
  scope: AiConnectorScope,
  toolName: string,
  accessKind: AiConnectorAccessKind,
  enabledByPolicy: boolean,
): AiConnectorToolBlockerCode | null {
  const group = connectorGroupForScope(scope);
  if (!policy.enabled) return "global_mcp_disabled";
  if (!policy.allowedClientKinds[connection.clientKind]) return "client_kind_disabled";
  if (connection.status !== "active") return "connector_inactive";
  if (connection.expiresAt && Date.parse(connection.expiresAt) <= Date.now()) return "connector_inactive";
  const requiredScopes = scopesForToolAccess(accessKind, toolName, scope);
  if (!requiredScopes.some((requiredScope) => connection.scopes.includes(requiredScope))) return "missing_scope";
  if (!enabledByPolicy || !policy.groupToggles[group]) return "admin_tool_policy_disabled";
  if (connection.authMode === "bearer") {
    if (!policy.bearerFallback.enabled) return "admin_tool_policy_disabled";
    if (!policy.bearerFallback.allowedClientKinds.includes(connection.clientKind)) return "client_kind_disabled";
    if (!policy.bearerFallback.allowedToolGroups.includes(group)) return "admin_tool_policy_disabled";
  }
  if (connection.toolToggles[toolName] === false) return "connector_override_disabled";
  return null;
}

function buildAiDraftDeepLink(app: FastifyInstance, batchId: string, contextUserId: string): string {
  return `${app.appBaseUrl}/transactions?tab=ai-inbox&batch=${encodeURIComponent(batchId)}&context=${encodeURIComponent(contextUserId)}`;
}

function toTransactionDraftBatchDto(app: FastifyInstance, batch: AiTransactionDraftBatchRecord): TransactionDraftBatchDto & { deepLinkUrl: string } {
  return {
    id: batch.id,
    ownerUserId: batch.ownerUserId,
    createdByUserId: batch.createdByUserId,
    connectorConnectionId: batch.connectorConnectionId,
    shareId: batch.shareId,
    sourceChannel: batch.sourceChannel,
    status: batch.status,
    version: batch.version,
    sourceLabel: batch.sourceLabel,
    sourceFilename: batch.sourceFilename,
    note: batch.note,
    rowCount: batch.rowCount,
    unsupportedCount: batch.unsupportedCount,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    archivedAt: batch.archivedAt,
    deletedAt: batch.deletedAt,
    deepLinkUrl: buildAiDraftDeepLink(app, batch.id, batch.ownerUserId),
  };
}

function toTransactionDraftRowDto(row: AiTransactionDraftRowRecord & {
  deletedPostedTransaction?: {
    deletedAt: string;
    deletedByUserId: string | null;
    mutationRunId: string;
  } | null;
}): TransactionDraftRowDto & {
  tradeTimestamp: string | null;
  bookingSequence: number | null;
  note: string | null;
  deletedPostedTransaction: {
    deletedAt: string;
    deletedByUserId: string | null;
    mutationRunId: string;
  } | null;
} {
  const lineage = row.deletedPostedTransaction ?? null;
  return {
    id: row.id,
    batchId: row.batchId,
    rowNumber: row.rowNumber,
    state: row.state,
    displayState: lineage ? "posted_transaction_deleted" : row.state,
    statusCopy: lineage ? "Posted transaction deleted" : row.state === "confirmed" ? "Posted transaction confirmed" : row.state,
    version: row.version,
    accountId: row.accountId,
    accountName: row.accountNameInput,
    accountNameInput: row.accountNameInput,
    type: row.tradeType,
    ticker: row.ticker,
    marketCode: row.marketCode as SharedMarketCode | null,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    priceCurrency: row.priceCurrency,
    tradeDate: row.tradeDate,
    tradeTimestamp: row.tradeTimestamp,
    bookingSequence: row.bookingSequence,
    isDayTrade: row.isDayTrade,
    commissionAmount: row.commissionAmount,
    taxAmount: row.taxAmount,
    feesSource: row.feesSource,
    note: row.note,
    sourceRowRef: row.sourceRowRef,
    sourceSnippet: row.sourceSnippet,
    preflightIssues: row.preflightIssues,
    warnings: row.warnings,
    confirmedTradeEventId: row.confirmedTradeEventId,
    confirmedAt: row.confirmedAt,
    deletedPostedTransaction: lineage,
    updatedAt: row.updatedAt,
  } as TransactionDraftRowDto & {
    tradeTimestamp: string | null;
    bookingSequence: number | null;
    note: string | null;
    deletedPostedTransaction: {
      deletedAt: string;
      deletedByUserId: string | null;
      mutationRunId: string;
    } | null;
  };
}

function toTransactionDraftUnsupportedDto(item: AiTransactionDraftUnsupportedItemRecord): TransactionDraftUnsupportedItemDto {
  return {
    id: item.id,
    batchId: item.batchId,
    rowNumber: item.rowNumber,
    category: item.category,
    reason: item.reason,
    sourceSnippet: item.sourceSnippet,
    createdAt: item.createdAt,
  };
}

async function toTransactionDraftDetailDto(
  app: FastifyInstance,
  aggregate: AiTransactionDraftBatchAggregate,
): Promise<TransactionDraftBatchDetailDto & { deepLinkUrl: string }> {
  const deletedDraftLineages = await app.persistence.listPostedTransactionMutationDeletedDraftLineage(
    aggregate.batch.ownerUserId,
    aggregate.rows.flatMap((row) => row.confirmedTradeEventId ? [row.confirmedTradeEventId] : []),
    aggregate.rows.map((row) => row.id),
  );
  const deletedDraftLineageByTradeId = new Map(deletedDraftLineages.map((lineage) => [lineage.tradeEventId, lineage] as const));
  const deletedDraftLineageByRowId = new Map(deletedDraftLineages.map((lineage) => [lineage.rowId, lineage] as const));
  return {
    batch: toTransactionDraftBatchDto(app, aggregate.batch),
    rows: aggregate.rows.map((row) => toTransactionDraftRowDto({
      ...row,
      deletedPostedTransaction: (
        row.confirmedTradeEventId ? deletedDraftLineageByTradeId.get(row.confirmedTradeEventId) : undefined
      ) ?? deletedDraftLineageByRowId.get(row.id) ?? null,
    })),
    unsupportedItems: aggregate.unsupportedItems.map(toTransactionDraftUnsupportedDto),
    deepLinkUrl: buildAiDraftDeepLink(app, aggregate.batch.id, aggregate.batch.ownerUserId),
  };
}

function draftActionRows(rows: AiTransactionDraftRowRecord[]) {
  return rows.filter((row) =>
    row.state === "needs_clarification"
    || row.state === "pending_validation"
    || row.state === "invalid"
    || row.state === "duplicate_blocked",
  );
}

async function loadWebMcpContext(
  app: FastifyInstance,
  req: FastifyRequest,
): Promise<McpRequestContext> {
  const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
  let resolvedContext: McpResolvedContext = {
      sessionUserId: identity.sessionUserId,
      portfolioContextUserId: identity.contextUserId,
      shareId: null,
      shareCapabilities: [],
  };
  const sharedContext = await resolveActiveSharedCapabilityContext(req);
  if (identity.isSharedContext) {
    if (!sharedContext) {
      throw routeError(404, "ai_draft_context_not_found", "AI draft context not found");
    }
    resolvedContext = {
      ...resolvedContext,
      shareId: sharedContext.shareId,
      shareCapabilities: sharedContext.shareCapabilities,
    };
  }

  return {
    auth: {
      token: "web-session",
      clientId: "vakwen-web",
      sessionUserId: identity.sessionUserId,
      connection: null,
      scopes: [...aiConnectorScopeValues],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext,
    requestId: req.id,
    sourceIp: req.ip,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
    logger: req.log,
  };
}

async function buildDelegatedAuditMetadata(req: FastifyRequest): Promise<Record<string, unknown>> {
  const sharedContext = await resolveActiveSharedCapabilityContext(req);
  if (!sharedContext) {
    return {};
  }

  return {
    delegatedByUserId: sharedContext.sessionUserId,
    ownerUserId: sharedContext.ownerUserId,
    contextUserId: sharedContext.ownerUserId,
    shareId: sharedContext.shareId,
    source: "shared_context",
  };
}

async function appendDelegatedWriteAudit(
  app: FastifyInstance,
  req: FastifyRequest,
  metadata: Record<string, unknown>,
): Promise<void> {
  const sharedContext = await resolveActiveSharedCapabilityContext(req);
  if (!sharedContext) {
    return;
  }

  try {
    await app.persistence.appendAuditLog({
      actorUserId: sharedContext.sessionUserId,
      action: "delegated_portfolio_write",
      targetUserId: sharedContext.ownerUserId,
      ipAddress: req.ip,
      metadata: {
        ...metadata,
        delegatedByUserId: sharedContext.sessionUserId,
        ownerUserId: sharedContext.ownerUserId,
        contextUserId: sharedContext.ownerUserId,
        shareId: sharedContext.shareId,
        source: "shared_context",
      },
    });
  } catch (error) {
    req.log.error(
      { error, action: "delegated_portfolio_write", metadata },
      "delegated write audit append failed",
    );
  }
}

function requireIdempotencyKey(req: FastifyRequest): string {
  const idempotencyKey = req.headers["idempotency-key"];
  if (!idempotencyKey || Array.isArray(idempotencyKey)) {
    throw routeError(400, "idempotency_key_required", "idempotency-key header required");
  }
  return idempotencyKey;
}

async function buildPortfolioAuditInput(
  req: FastifyRequest,
  routeKeyValue: string,
): Promise<Pick<AuditLogInput, "actorUserId" | "ipAddress" | "metadata">> {
  return {
    actorUserId: requireSessionUserId(req),
    ipAddress: req.ip,
    metadata: {
      routeKey: routeKeyValue,
      ...(await buildDelegatedAuditMetadata(req)),
    },
  };
}

async function buildAccountMutationResponse(
  app: FastifyInstance,
  sessionUserId: string,
  payload: {
    account: AccountMutationResponseDto["account"];
    feeProfile: AccountMutationResponseDto["feeProfile"];
    capabilities: AccountMutationResponseDto["capabilities"];
    changedFields?: string[];
  },
): Promise<AccountMutationResponseDto> {
  const prefs = await app.persistence.getUserPreferences(sessionUserId);
  const requested = resolveReportingCurrency(prefs);
  const configuredCurrencies = payload.capabilities.configuredCurrencies;
  const effective = configuredCurrencies.includes(requested)
    ? requested
    : configuredCurrencies[0] ?? null;
  const reason =
    effective === requested
      ? null
      : configuredCurrencies.length === 0
        ? "no_configured_currencies"
        : "unconfigured_currency";

  return {
    ...payload.account,
    account: payload.account,
    feeProfile: payload.feeProfile,
    capabilities: payload.capabilities,
    reportingCurrency: {
      requested,
      effective,
      reason,
    },
    ...(payload.changedFields && payload.changedFields.length > 0
      ? { changedFields: payload.changedFields }
      : {}),
  };
}

async function buildLifecycleReportingCurrencyForContext(
  app: FastifyInstance,
  payload: import("../persistence/types.js").AccountLifecyclePersistenceResult,
  sessionUserId: string,
  useAuthoritativeOwnerPreference: boolean,
): Promise<AccountLifecycleMutationResponseDto["reportingCurrency"]> {
  if (useAuthoritativeOwnerPreference) {
    return payload.reportingCurrency;
  }
  const prefs = await app.persistence.getUserPreferences(sessionUserId);
  const requested = resolveReportingCurrency(prefs);
  const effective = payload.capabilities.configuredCurrencies.includes(requested)
    ? requested
    : payload.capabilities.configuredCurrencies[0] ?? null;
  return {
    requested,
    effective,
    reason:
      effective === requested
        ? null
        : payload.capabilities.configuredCurrencies.length === 0
          ? "no_configured_currencies"
          : "unconfigured_currency",
  };
}

async function buildAccountLifecycleResponse(
  app: FastifyInstance,
  payload: import("../persistence/types.js").AccountLifecyclePersistenceResult,
  sessionUserId: string,
  useAuthoritativeOwnerPreference: boolean,
): Promise<AccountLifecycleMutationResponseDto> {
  return {
    accountId: payload.account.id,
    account: payload.account,
    deletedAt: payload.deletedAt,
    finalName: payload.finalName,
    capabilities: payload.capabilities,
    reportingCurrency: await buildLifecycleReportingCurrencyForContext(
      app,
      payload,
      sessionUserId,
      useAuthoritativeOwnerPreference,
    ),
    ...(payload.feeProfiles ? { feeProfiles: payload.feeProfiles } : {}),
    ...(payload.feeProfileBindings
      ? { feeProfileBindings: payload.feeProfileBindings }
      : {}),
  };
}

function requireWebDraftCapability(context: McpResolvedContext, capability: ShareCapability): void {
  if (!context.shareId) return;
  if (!context.shareCapabilities.includes(capability)) {
    throw routeError(403, "ai_draft_share_capability_denied", `Shared portfolio capability ${capability} is not enabled`);
  }
}

function assertDraftAggregateInWebContext(
  context: McpResolvedContext,
  aggregate: AiTransactionDraftBatchAggregate | null,
): AiTransactionDraftBatchAggregate {
  if (!aggregate || aggregate.batch.ownerUserId !== context.portfolioContextUserId) {
    throw routeError(404, "ai_draft_batch_not_found", "AI draft batch not found");
  }
  return aggregate;
}

function isShareGrantRecord(value: ShareGrantRecord | PendingShareInviteRecord): value is ShareGrantRecord {
  return "granteeUserId" in value;
}

function deriveAnonymousShareTokenStatus(
  record: AnonymousShareTokenRecord,
  now: number = Date.now(),
): AnonymousShareTokenStatus {
  if (record.revokedAt) return "revoked";
  if (Date.parse(record.expiresAt) <= now) return "expired";
  return "active";
}

function toAnonymousShareTokenDto(
  app: FastifyInstance,
  record: AnonymousShareTokenRecord,
  now: number = Date.now(),
): AnonymousShareTokenDto {
  return {
    id: record.id,
    token: record.token,
    url: `${app.appBaseUrl}/share/${record.token}`,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    status: deriveAnonymousShareTokenStatus(record, now),
  };
}

function routeKey(method: string, routeUrl: string): string {
  return `${method.toUpperCase()} ${routeUrl}`;
}

function authRequired(): never {
  throw routeError(401, "auth_required", "authentication required");
}

function markSessionCleanup(req: FastifyRequest): void {
  req.__clearSessionCookie = true;
  req.__clearImpersonationCookie = true;
}

function markImpersonationCleanup(req: FastifyRequest): void {
  req.__clearImpersonationCookie = true;
}

async function appendImpersonationEndAudit(
  app: FastifyInstance,
  req: FastifyRequest,
  input: {
    actorUserId: string;
    targetUserId?: string | null;
    targetEmail?: string | null;
    reason: string;
  },
): Promise<void> {
  await app.persistence.appendAuditLog({
    actorUserId: input.actorUserId,
    action: "impersonation_end",
    targetUserId: input.targetUserId ?? null,
    ipAddress: req.ip,
    metadata: {
      reason: input.reason,
      ...(input.targetUserId ? { targetUserId: input.targetUserId } : {}),
      ...(input.targetEmail !== undefined ? { targetEmail: input.targetEmail } : {}),
    },
  });
}

async function resolveImpersonationState(
  app: FastifyInstance,
  req: FastifyRequest,
  sessionUserId: string,
): Promise<{ active: false } | { active: true; impersonation: ImpersonationDto }> {
  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  const cookieValue = parseCookieValue(req.headers.cookie, IMPERSONATION_COOKIE_NAME);
  if (!cookieValue) {
    return { active: false };
  }
  if (!sessionSecret) {
    markImpersonationCleanup(req);
    return { active: false };
  }

  const parsed = verifyImpersonationCookie(cookieValue, sessionSecret);
  if (!parsed) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, { actorUserId: sessionUserId, reason: "invalid_hmac" });
    return { active: false };
  }

  return validateResolvedImpersonationState(app, req, sessionUserId, parsed);
}

async function validateResolvedImpersonationState(
  app: FastifyInstance,
  req: FastifyRequest,
  sessionUserId: string,
  parsed: ImpersonationCookieIdentity,
): Promise<{ active: false } | { active: true; impersonation: ImpersonationDto }> {
  if (parsed.adminId !== sessionUserId) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, {
      actorUserId: sessionUserId,
      targetUserId: parsed.targetUserId,
      reason: "session_mismatch",
    });
    return { active: false };
  }

  if (parsed.expiresAtMs <= Date.now()) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, {
      actorUserId: sessionUserId,
      targetUserId: parsed.targetUserId,
      reason: "expired",
    });
    return { active: false };
  }

  const targetUser = await app.persistence.getAuthUserById(parsed.targetUserId);
  if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
    markImpersonationCleanup(req);
    await appendImpersonationEndAudit(app, req, {
      actorUserId: sessionUserId,
      targetUserId: parsed.targetUserId,
      targetEmail: targetUser?.email ?? null,
      reason: "target_invalid",
    });
    return { active: false };
  }

  return {
    active: true,
    impersonation: {
      active: true,
      targetUserId: targetUser.userId,
      targetEmail: targetUser.email ?? null,
      expiresAt: new Date(parsed.expiresAtMs).toISOString(),
    },
  };
}

export function parseSessionCookie(cookieHeader: string | undefined, sessionSecret: string | undefined): SessionIdentity | null {
  const value = parseCookieValue(cookieHeader, Env.SESSION_COOKIE_NAME);
  if (!value || !sessionSecret) return null;
  return verifySessionCookie(value, sessionSecret);
}

export function isPublicRoute(method: string, routeUrl: string): boolean {
  return PUBLIC_ROUTE_KEYS.has(routeKey(method, routeUrl));
}

export {
  CONTEXT_COOKIE_NAME,
  CONTEXT_FALLBACK_HEADER,
  CONTEXT_HEADER_NAME,
  contextClearCookieString,
  shouldStampContextFallback,
} from "./contextFallback.js";

import {
  CONTEXT_HEADER_NAME,
  contextClearCookieString,
  markContextFallback,
} from "./contextFallback.js";

async function resolveContextOverride(
  app: FastifyInstance,
  req: FastifyRequest,
  sessionUserId: string,
): Promise<{ contextUserId: string; isSharedContext: boolean }> {
  const raw = req.headers[CONTEXT_HEADER_NAME];
  if (!raw || Array.isArray(raw)) {
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  const parsed = userScopedIdSchema.safeParse(raw);
  if (!parsed.success) {
    markContextFallback(req);
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  const headerUserId = parsed.data;
  if (headerUserId === sessionUserId) {
    markContextFallback(req);
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  const active = await app.persistence.validateActiveShare(headerUserId, sessionUserId);
  if (!active) {
    markContextFallback(req);
    return { contextUserId: sessionUserId, isSharedContext: false };
  }

  return { contextUserId: headerUserId, isSharedContext: true };
}

function resolveDevBypassFallback(req: FastifyRequest): ResolvedRequestIdentity {
  const rawUserId = req.headers["x-user-id"];
  const rawRole = req.headers["x-user-role"];
  const sessionUserId = userScopedIdSchema.parse(
    !rawUserId || Array.isArray(rawUserId) ? "user-1" : rawUserId,
  );
  const role = rawRole && !Array.isArray(rawRole) ? userRoleSchema.parse(rawRole) : "admin";
  return {
    sessionUserId,
    contextUserId: sessionUserId,
    role,
    sessionVersion: 1,
    isDemo: false,
    isImpersonating: false,
    isSharedContext: false,
    email: null,
    impersonation: null,
    userId: sessionUserId,
  };
}

export function resolveUserId(req: FastifyRequest, _sessionSecret?: string): ResolvedRequestIdentity {
  if (req.authContext) {
    return {
      ...req.authContext,
      userId: req.authContext.contextUserId,
    };
  }

  if (Env.AUTH_MODE === "dev_bypass") {
    return resolveDevBypassFallback(req);
  }

  authRequired();
}

/**
 * Return the session-owner user id (never the shared-context viewer target).
 * Use this for identity/cross-user endpoints (`/profile`, `/notifications/*`,
 * `/sse`, `/admin/*`, invites, audit-log) that must always act on
 * the authenticated session — not on whichever portfolio the user is viewing.
 */
export function requireSessionUserId(req: FastifyRequest): string {
  if (req.authContext) {
    return req.authContext.sessionUserId;
  }
  if (Env.AUTH_MODE === "dev_bypass") {
    return resolveDevBypassFallback(req).sessionUserId;
  }
  authRequired();
}

async function loadUserStoreForUserId(app: FastifyInstance, userId: string) {
  const store = await app.persistence.loadStore(userId);
  syncAccountingPolicy(store);
  return { userId, store };
}

async function loadOverviewReadStoreForUserId(app: FastifyInstance, userId: string) {
  const store = await app.persistence.loadOverviewReadStore(userId);
  syncAccountingPolicy(store);
  return { userId, store };
}

async function loadUserStore(app: FastifyInstance, req: FastifyRequest) {
  const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  return loadUserStoreForUserId(app, contextUserId);
}

async function loadOverviewReadStore(app: FastifyInstance, req: FastifyRequest) {
  const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
  return loadOverviewReadStoreForUserId(app, contextUserId);
}

async function withReadPathTiming<T>(
  req: FastifyRequest,
  reply: FastifyReply,
  route: string,
  handler: (timing: ReadPathTiming) => Promise<T>,
): Promise<T> {
  const timing = new ReadPathTiming();
  const payload = await handler(timing);
  timing.attach(req, reply, route, payload);
  return payload;
}

async function resolveCookieBackedAuthContext(
  app: FastifyInstance,
  req: FastifyRequest,
  identity: SessionIdentity,
): Promise<void> {
  const authUser = await app.persistence.getAuthUserById(userScopedIdSchema.parse(identity.userId));
  if (!authUser || authUser.deactivatedAt || authUser.deletedAt) {
    markSessionCleanup(req);
    authRequired();
  }
  if (!identity.isDemo && identity.sessionVersion !== authUser.sessionVersion) {
    markSessionCleanup(req);
    authRequired();
  }
  req.__sessionType = identity.isDemo ? "demo" : "oauth";
  const hadImpersonationCookie = Boolean(parseCookieValue(req.headers.cookie, IMPERSONATION_COOKIE_NAME));
  const impersonation = await resolveImpersonationState(app, req, authUser.userId);
  if (impersonation.active) {
    req.authContext = {
      sessionUserId: authUser.userId,
      contextUserId: impersonation.impersonation.targetUserId,
      role: authUser.role,
      sessionVersion: authUser.sessionVersion,
      isDemo: identity.isDemo,
      isImpersonating: true,
      isSharedContext: false,
      email: authUser.email,
      impersonation: impersonation.impersonation,
    };
    return;
  }
  if (hadImpersonationCookie) {
    req.authContext = {
      sessionUserId: authUser.userId,
      contextUserId: authUser.userId,
      role: authUser.role,
      sessionVersion: authUser.sessionVersion,
      isDemo: identity.isDemo,
      isImpersonating: false,
      isSharedContext: false,
      email: authUser.email,
      impersonation: null,
    };
    return;
  }

  const { contextUserId, isSharedContext } = await resolveContextOverride(app, req, authUser.userId);
  req.authContext = {
    sessionUserId: authUser.userId,
    contextUserId,
    role: authUser.role,
    sessionVersion: authUser.sessionVersion,
    isDemo: identity.isDemo,
    isImpersonating: false,
    isSharedContext,
    email: authUser.email,
    impersonation: null,
  };
}

export async function hydrateAuthContext(app: FastifyInstance, req: FastifyRequest): Promise<void> {
  if (req.authContext) return;

  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET;
  const hasSessionCookie = Boolean(parseCookieValue(req.headers.cookie, Env.SESSION_COOKIE_NAME));
  const cookieIdentity = parseSessionCookie(req.headers.cookie, sessionSecret);
  if (cookieIdentity) {
    await resolveCookieBackedAuthContext(app, req, cookieIdentity);
    return;
  }
  if (hasSessionCookie) {
    markSessionCleanup(req);
  }

  if (Env.AUTH_MODE === "oauth") {
    authRequired();
  }

  const rawUserId = req.headers["x-user-id"];
  const rawRole = req.headers["x-user-role"];
  const sessionUserId = userScopedIdSchema.parse(
    !rawUserId || Array.isArray(rawUserId) ? "user-1" : rawUserId,
  );
  const overrideRole = rawRole && !Array.isArray(rawRole) ? userRoleSchema.parse(rawRole) : undefined;
  const authUser = await app.persistence.getAuthUserById(sessionUserId);
  const hadImpersonationCookie = Boolean(parseCookieValue(req.headers.cookie, IMPERSONATION_COOKIE_NAME));
  const impersonation = await resolveImpersonationState(app, req, sessionUserId);
  if (impersonation.active) {
    req.authContext = {
      sessionUserId,
      contextUserId: impersonation.impersonation.targetUserId,
      role: authUser && !authUser.deactivatedAt && !authUser.deletedAt ? (overrideRole ?? authUser.role) : (overrideRole ?? "admin"),
      sessionVersion: authUser?.sessionVersion ?? 1,
      isDemo: false,
      isImpersonating: true,
      isSharedContext: false,
      email: authUser?.email ?? null,
      impersonation: impersonation.impersonation,
    };
    return;
  }
  if (hadImpersonationCookie) {
    req.authContext = {
      sessionUserId,
      contextUserId: sessionUserId,
      role: authUser && !authUser.deactivatedAt && !authUser.deletedAt ? (overrideRole ?? authUser.role) : (overrideRole ?? "admin"),
      sessionVersion: authUser?.sessionVersion ?? 1,
      isDemo: false,
      isImpersonating: false,
      isSharedContext: false,
      email: authUser?.email ?? null,
      impersonation: null,
    };
    return;
  }

  const { contextUserId, isSharedContext } = await resolveContextOverride(app, req, sessionUserId);

  req.authContext = {
    sessionUserId,
    contextUserId,
    role: authUser && !authUser.deactivatedAt && !authUser.deletedAt ? (overrideRole ?? authUser.role) : (overrideRole ?? "admin"),
    sessionVersion: authUser?.sessionVersion ?? 1,
    isDemo: false,
    isImpersonating: false,
    isSharedContext,
    email: authUser?.email ?? null,
    impersonation: null,
  };
}

export async function enforceRouteRole(req: FastifyRequest): Promise<void> {
  const routeUrl = req.routeOptions.url;
  if (!routeUrl) return;
  const key = routeKey(req.method, routeUrl);
  if (
    req.authContext?.isImpersonating
    && IMPERSONATION_BLOCKED_METHODS.has(req.method.toUpperCase())
    && !IMPERSONATION_WRITE_ALLOWLIST.has(key)
  ) {
    await req.server.persistence.appendAuditLog({
      actorUserId: req.authContext.sessionUserId,
      action: "impersonation_blocked_write",
      targetUserId: req.authContext.impersonation?.targetUserId ?? null,
      ipAddress: req.ip,
      metadata: {
        targetUserId: req.authContext.impersonation?.targetUserId ?? null,
        method: req.method.toUpperCase(),
        path: req.url.split("?")[0] ?? req.url,
      },
    });
    throw routeError(403, "impersonation_write_blocked", "Writes are disabled while impersonating.");
  }
  if (ADMIN_ROUTE_KEYS.has(key)) {
    requireAdminRole(req);
    return;
  }
  if (req.authContext?.isSharedContext && SHARED_CONTEXT_WRITE_ROUTE_KEYS.has(key)) {
    await requireSharedCapability(req, key, SHARED_CONTEXT_WRITE_CAPABILITY_MATRIX);
    return;
  }
  if (WRITER_ROLE_ROUTE_KEYS.has(key)) {
    requireWriterRole(req);
  }
  if (SHARED_CONTEXT_WRITE_ROUTE_KEYS.has(key)) {
    requireWriteableContext(req);
  }
}

/** Guard for `/__e2e/reset` — allowed in development and test with dev_bypass + memory, blocked in production. */
function assertE2EResetEnabled(): void {
  if ((Env.NODE_ENV !== "development" && Env.NODE_ENV !== "test") || Env.AUTH_MODE !== "dev_bypass" || Env.PERSISTENCE_BACKEND !== "memory") {
    throw routeError(404, "not_found", "not found");
  }
}

/** Guard for `/__e2e/oauth-session` — allowed in development and test, blocked in production. */
/** Guard for test-only seed endpoints — allowed in dev/test with memory backend, any auth mode. */
function assertE2ESeedEnabled(): void {
  if ((Env.NODE_ENV !== "development" && Env.NODE_ENV !== "test") || Env.PERSISTENCE_BACKEND !== "memory") {
    throw routeError(404, "not_found", "not found");
  }
}

export function assertE2EOauthSessionEnabled(nodeEnv: string = Env.NODE_ENV): void {
  if (nodeEnv !== "development" && nodeEnv !== "test") {
    throw routeError(404, "not_found", "not found");
  }
}

/**
 * Creates a demo user session: resolves user, marks as demo, seeds transactions,
 * signs cookie, and sets the Set-Cookie header on the reply.
 *
 * Shared between POST /auth/demo/start (production, rate-limited) and
 * POST /__e2e/demo-session (test-only, bypasses rate limiter).
 */
async function createDemoSession(
  app: FastifyInstance,
  reply: FastifyReply,
): Promise<{ userId: string; expiresAt: string }> {
  const demoId = randomUUID();
  const email = `demo-${demoId}@demo.local`;
  const ttlSeconds = Env.DEMO_SESSION_TTL_SECONDS;

  const { userId } = await app.persistence.resolveOrCreateUser(
    "demo",
    demoId,
    {
      email,
      name: "Demo User",
    },
    { role: "member" },
  );

  await app.persistence.markDemoUser(userId, ttlSeconds);
  await seedDemoTransactions(app.persistence, userId);

  const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
  if (!sessionSecret) {
    throw routeError(500, "missing_secret", "SESSION_SECRET is required");
  }

  const signedCookie = signSessionCookie(userId, sessionSecret, true);
  const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);
  reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}; Max-Age=${ttlSeconds}`);

  const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
  return { userId, expiresAt };
}

function createSeededStoreForUser(userId: string): Store {
  const store = createStore();
  store.userId = userId;
  store.settings.userId = userId;
  store.accounts = store.accounts.map((account) => ({ ...account, userId }));
  syncAccountingPolicy(store);
  return store;
}

function getStoreIntegrityIssue(store: Store): IntegrityIssueDto | null {
  if (store.feeProfiles.length === 0) {
    return {
      code: "missing_fee_profiles",
      message: "No fee profile exists. Create one in settings before trading.",
    };
  }

  // KZO-183: per-account scope check — `account.feeProfileId` must reference
  // a profile whose `accountId` equals `account.id`. The same ownership check
  // applies to per-symbol bindings.
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));
  for (const account of store.accounts) {
    const profile = account.feeProfileId ? profilesById.get(account.feeProfileId) : undefined;
    if (!profile) {
      return {
        code: "missing_account_profile",
        message: `Account ${account.id} is missing a valid fee profile binding.`,
      };
    }
    if (profile.accountId !== account.id) {
      return {
        code: "missing_account_profile",
        message: `Account ${account.id} references fee profile ${profile.id} owned by another account.`,
      };
    }
  }

  for (const binding of store.feeProfileBindings) {
    const profile = profilesById.get(binding.feeProfileId);
    if (!profile) {
      return {
        code: "invalid_fee_profile_binding",
        message: `Fee profile override for ${binding.accountId}/${binding.ticker} references missing profile ${binding.feeProfileId}.`,
      };
    }

    const account = store.accounts.find((item) => item.id === binding.accountId);
    if (!account) {
      return {
        code: "invalid_fee_profile_binding",
        message: `Fee profile override references missing account ${binding.accountId}.`,
      };
    }
    if (profile.accountId !== binding.accountId) {
      return {
        code: "invalid_fee_profile_binding",
        message: `Fee profile override for ${binding.accountId}/${binding.ticker} references profile ${profile.id} owned by another account.`,
      };
    }
  }

  return null;
}

function assertStoreIntegrity(store: Store): void {
  const issue = getStoreIntegrityIssue(store);
  if (!issue) return;
  throw routeError(409, issue.code, issue.message);
}

function normalizeBindings(rawBindings: Array<z.infer<typeof feeBindingSchema>>) {
  const deduped = new Map<string, z.infer<typeof feeBindingSchema>>();
  for (const binding of rawBindings) {
    const normalized = {
      accountId: binding.accountId,
      ticker: binding.ticker,
      feeProfileId: binding.feeProfileId,
    };
    deduped.set(`${normalized.accountId}:${normalized.ticker}`, normalized);
  }

  return [...deduped.values()];
}

function mapTransactionHistoryItem(
  trade: Transaction,
  accountById: ReadonlyMap<string, { id: string; name: string }>,
  buildRealizedPnlBreakdown: (trade: Transaction) => TransactionHistoryItemDto["realizedPnlBreakdown"],
): TransactionHistoryItemDto {
  const grossTradeValueAmount = roundToDecimal(trade.quantity * trade.unitPrice, 2);
  const settlementAmount = trade.type === "BUY"
    ? roundToDecimal(grossTradeValueAmount + trade.commissionAmount + trade.taxAmount, 2)
    : roundToDecimal(grossTradeValueAmount - trade.commissionAmount - trade.taxAmount, 2);
  return {
    id: trade.id,
    accountId: trade.accountId,
    accountName: resolveAccountDisplayName(accountById, trade.accountId),
    ticker: trade.ticker,
    marketCode: trade.marketCode,
    instrumentType: trade.instrumentType,
    type: trade.type,
    quantity: trade.quantity,
    unitPrice: trade.unitPrice,
    priceCurrency: trade.priceCurrency,
    tradeDate: trade.tradeDate,
    tradeTimestamp: trade.tradeTimestamp ?? null,
    bookingSequence: trade.bookingSequence ?? null,
    grossTradeValueAmount,
    commissionAmount: trade.commissionAmount,
    taxAmount: trade.taxAmount,
    settlementAmount,
    settlementAvailable: true,
    bookedCostAmount: trade.type === "BUY" ? settlementAmount : null,
    isDayTrade: trade.isDayTrade,
    realizedPnlAmount: trade.realizedPnlAmount ?? null,
    realizedPnlCurrency: trade.realizedPnlCurrency ?? null,
    realizedPnlBreakdown: buildRealizedPnlBreakdown(trade),
    feeProfileId: trade.feeSnapshot.id,
    feeProfileName: trade.feeSnapshot.name,
    bookedAt: trade.bookedAt ?? null,
    feesSource: trade.feesSource ?? "CALCULATED",
  };
}

function buildTransactionHistoryItems(
  store: Store,
  query: {
    ticker?: string;
    accountId?: string;
    accountIds?: string[];
    marketCode?: string;
    limit?: number;
  } = {},
): TransactionHistoryItemDto[] {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const buildRealizedPnlBreakdown = createRealizedPnlBreakdownResolver(store.accounting);
  const accountIds = query.accountId ? new Set([query.accountId]) : new Set(query.accountIds ?? []);
  const sortedTrades = listTradeEvents(store)
    .filter((trade) => (query.ticker ? trade.ticker === query.ticker : true))
    .filter((trade) => (accountIds.size > 0 ? accountIds.has(trade.accountId) : true))
    .filter((trade) => (query.marketCode ? trade.marketCode === query.marketCode : true))
    .sort(compareTransactionsForHistory);
  const visibleTrades = query.limit ? sortedTrades.slice(0, query.limit) : sortedTrades;
  return visibleTrades.map((trade) => mapTransactionHistoryItem(trade, accountById, buildRealizedPnlBreakdown));
}

type TransactionHistorySortBy = "tradeDate" | "type" | "ticker" | "account" | "realizedPnl";
type TransactionHistorySortOrder = "asc" | "desc";

interface TransactionHistoryPageQuery {
  type: "BUY" | "SELL" | "ALL";
  pnl: "realized" | "any";
  ticker?: string;
  accountId?: string;
  marketCode?: SharedMarketCode;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  sortBy: TransactionHistorySortBy;
  sortOrder: TransactionHistorySortOrder;
}

function buildTransactionHistoryPage(
  store: Store,
  query: TransactionHistoryPageQuery,
): TransactionHistoryPageDto {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const buildRealizedPnlBreakdown = createRealizedPnlBreakdownResolver(store.accounting);
  const effectiveType = query.pnl === "realized" ? "SELL" : query.type;
  const filteredTrades = listTradeEvents(store)
    .filter((trade) => (effectiveType === "ALL" ? true : trade.type === effectiveType))
    .filter((trade) => (query.pnl === "realized" ? trade.realizedPnlAmount !== undefined && trade.realizedPnlAmount !== null : true))
    .filter((trade) => (query.ticker ? trade.ticker === query.ticker : true))
    .filter((trade) => (query.accountId ? trade.accountId === query.accountId : true))
    .filter((trade) => (query.marketCode ? trade.marketCode === query.marketCode : true))
    .filter((trade) => (query.from ? trade.tradeDate >= query.from : true))
    .filter((trade) => (query.to ? trade.tradeDate <= query.to : true));
  const aggregates = buildTransactionHistoryAggregates(filteredTrades);
  const sortedTrades = [...filteredTrades].sort((left, right) =>
    compareTransactionsForHistorySort(left, right, accountById, query.sortBy, query.sortOrder));
  const visibleTrades = sortedTrades.slice(query.offset, query.offset + query.limit);
  return {
    items: visibleTrades.map((trade) => mapTransactionHistoryItem(trade, accountById, buildRealizedPnlBreakdown)),
    total: filteredTrades.length,
    limit: query.limit,
    offset: query.offset,
    aggregates,
  };
}

function buildTransactionHistoryAggregates(
  trades: Transaction[],
): TransactionHistoryPageDto["aggregates"] {
  const byCurrency = new Map<CurrencyCode, number>();
  for (const trade of trades) {
    if (trade.realizedPnlAmount === undefined || trade.realizedPnlAmount === null) continue;
    const currency = trade.realizedPnlCurrency ?? trade.priceCurrency;
    byCurrency.set(currency, roundToDecimal((byCurrency.get(currency) ?? 0) + trade.realizedPnlAmount, 2));
  }
  return {
    realizedPnlByCurrency: [...byCurrency.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([currency, amount]) => ({ currency, amount })),
  };
}

function compareTransactionsForHistorySort(
  left: Transaction,
  right: Transaction,
  accountById: ReadonlyMap<string, { id: string; name: string }>,
  sortBy: TransactionHistorySortBy,
  sortOrder: TransactionHistorySortOrder,
): number {
  if (sortBy === "tradeDate") {
    const dateResult = sortOrder === "desc"
      ? right.tradeDate.localeCompare(left.tradeDate)
      : left.tradeDate.localeCompare(right.tradeDate);
    return dateResult !== 0 ? dateResult : compareTransactionsForHistory(left, right);
  }

  let result = 0;
  if (sortBy === "type") {
    result = left.type.localeCompare(right.type);
  } else if (sortBy === "ticker") {
    result = left.ticker.localeCompare(right.ticker) || left.marketCode.localeCompare(right.marketCode);
  } else if (sortBy === "account") {
    result = resolveAccountDisplayName(accountById, left.accountId)
      .localeCompare(resolveAccountDisplayName(accountById, right.accountId));
  } else {
    const leftValue = left.realizedPnlAmount;
    const rightValue = right.realizedPnlAmount;
    if (leftValue === undefined || leftValue === null) return rightValue === undefined || rightValue === null ? compareTransactionsForHistory(left, right) : 1;
    if (rightValue === undefined || rightValue === null) return -1;
    result = leftValue - rightValue;
  }

  if (result === 0) return compareTransactionsForHistory(left, right);
  return sortOrder === "asc" ? result : -result;
}

function compareTransactionsForHistory(left: Transaction, right: Transaction): number {
  return (
    right.tradeDate.localeCompare(left.tradeDate)
    || (right.bookingSequence ?? 0) - (left.bookingSequence ?? 0)
    || (right.tradeTimestamp ?? "").localeCompare(left.tradeTimestamp ?? "")
    || (right.bookedAt ?? "").localeCompare(left.bookedAt ?? "")
    || right.id.localeCompare(left.id)
  );
}

function ensureBindingsAreValid(store: Store, bindings: Array<z.infer<typeof feeBindingSchema>>): void {
  const accountIds = new Set(store.accounts.map((account) => account.id));
  const profilesById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));

  for (const binding of bindings) {
    if (!accountIds.has(binding.accountId)) {
      throw routeError(400, "invalid_account", `Unknown account ${binding.accountId}`);
    }
    const profile = profilesById.get(binding.feeProfileId);
    if (!profile) {
      throw routeError(400, "invalid_fee_profile", `Unknown fee profile ${binding.feeProfileId}`);
    }
    // KZO-183: per-account scope check. Override must point at a profile
    // owned by the binding's account.
    if (profile.accountId !== binding.accountId) {
      throw routeError(
        400,
        "invalid_fee_profile",
        `Fee profile ${binding.feeProfileId} is not owned by account ${binding.accountId}`,
      );
    }
  }
}

function requireProfile(store: Store, profileId: string): FeeProfile {
  const profile = store.feeProfiles.find((item) => item.id === profileId);
  if (!profile) {
    throw routeError(404, "fee_profile_not_found", `Fee profile ${profileId} was not found.`);
  }
  return profile;
}

function requireAccount(store: Store, accountId: string) {
  const account = store.accounts.find((item) => item.id === accountId);
  if (!account) {
    throw routeError(404, "account_not_found", `Account ${accountId} was not found.`);
  }
  return account;
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBeforeIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - days);
  return value.toISOString().slice(0, 10);
}

function findMostRecentBar(bars: DailyBar[], requestedDate: string): DailyBar | null {
  const eligible = bars.filter((bar) => bar.barDate <= requestedDate);
  return eligible.at(-1) ?? null;
}

// KZO-191: `reason` discriminator is now market-aware. `requestedDateIsTradingDay`
// is resolved at the route handler via `tradingCalendarCache.isTradingDay(market, date)`
// and threaded in. The `"weekend"` literal is retained for backwards compatibility
// but its semantics widen to "non-trading day" (weekend OR holiday). When the cache
// is empty (tests), `isTradingDayPure` falls through to a weekday check, so
// existing weekend-fixture assertions stay green.
function buildPriceLookupResponse(bar: DailyBar, requestedDate: string, requestedDateIsTradingDay: boolean) {
  if (bar.barDate === requestedDate) {
    return {
      close: bar.close,
      date: bar.barDate,
      source: bar.source,
      match: "exact" as const,
    };
  }

  return {
    close: bar.close,
    date: bar.barDate,
    source: bar.source,
    match: "previous" as const,
    reason: requestedDateIsTradingDay ? "no_bar" as const : "weekend" as const,
  };
}

// Provider-fallback responses always carry match: "previous" — even when the
// returned bar's date matches the requested date — so the client treats every
// FinMind hit as "we filled a gap" rather than "the DB had it." This is the
// scope-locked behavior from KZO-160 §F2 step 4 (refined scope-todo).
function buildFetchedPriceLookupResponse(bar: DailyBar, requestedDate: string, requestedDateIsTradingDay: boolean) {
  return {
    close: bar.close,
    date: bar.barDate,
    source: bar.source,
    match: "previous" as const,
    reason: requestedDateIsTradingDay ? "no_bar" as const : "weekend" as const,
  };
}

// KZO-191: helper for the 3 callers that have `store` context. Builds
// `(ticker, marketCode?)` pairs from `store.instruments` and pre-resolves
// `latestSettledTradingDay` once per distinct market.
async function buildQuoteSnapshotInputs(
  app: FastifyInstance,
  store: Store,
  tickers: ReadonlyArray<string>,
  now: Date = new Date(),
): Promise<{ pairs: QuoteSnapshotPair[]; settledByMarket: Map<MarketCode, string> }> {
  const tickerToMarkets = new Map<string, Set<MarketCode>>();
  for (const inst of store.instruments) {
    if ((MARKET_CODES as readonly string[]).includes(inst.marketCode)) {
      const markets = tickerToMarkets.get(inst.ticker) ?? new Set<MarketCode>();
      markets.add(inst.marketCode);
      tickerToMarkets.set(inst.ticker, markets);
    }
  }
  const pairs: QuoteSnapshotPair[] = tickers.flatMap((ticker) => {
    const markets = tickerToMarkets.get(ticker);
    return markets ? [...markets].map((marketCode) => ({ ticker, marketCode })) : [{ ticker }];
  });
  const distinctMarkets = new Set<MarketCode>();
  for (const pair of pairs) {
    if (pair.marketCode) distinctMarkets.add(pair.marketCode);
  }
  const settledByMarket = new Map<MarketCode, string>();
  for (const market of distinctMarkets) {
    settledByMarket.set(market, await app.tradingCalendarCache.latestSettledTradingDay(market, now));
  }
  return { pairs, settledByMarket };
}

async function resolveDisplayedQuoteSnapshotsForHeldPairs(
  app: FastifyInstance,
  store: Store,
  tickers: ReadonlyArray<string>,
  now: Date = new Date(),
  options: { skipEnqueue?: boolean } = {},
): Promise<Record<string, ResolvedQuoteSnapshot | null>> {
  const pairs = buildHeldTickerMarketPairsForDisplayedQuotes(store, tickers);
  const settledByMarket = await buildSettledTradingDayMap(app, pairs, now);
  if (!options.skipEnqueue) {
    await enqueueDisplayedQuoteRefreshes(app, pairs, now);
  }
  return resolveQuoteSnapshots(pairs, app.persistence, settledByMarket, {
    mode: "displayed",
    now,
    tradingCalendar: app.tradingCalendarCache,
    heldPairs: new Set(pairs
      .filter((pair): pair is { ticker: string; marketCode: MarketCode } => pair.marketCode !== undefined)
      .map((pair) => `${pair.ticker}:${pair.marketCode}`)),
    refreshCadenceMinutes: store.settings.effectiveTickerPriceIntradayRefreshIntervalMinutes ?? undefined,
  });
}

function buildHeldTickerMarketPairsForDisplayedQuotes(
  store: Store,
  tickers: ReadonlyArray<string>,
): QuoteSnapshotPair[] {
  const requestedTickers = new Set(tickers);
  const accountMarketById = new Map(store.accounts.map((account) => [
    account.id,
    marketCodeFor(account.defaultCurrency),
  ]));
  const pairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const holding of store.accounting.projections.holdings) {
    if (holding.quantity <= 0 || !requestedTickers.has(holding.ticker)) continue;
    const marketCode = resolveHeldMarketCodeForStoreHolding(store, holding, accountMarketById);
    if (!marketCode || !(MARKET_CODES as readonly string[]).includes(marketCode)) continue;
    const key = `${holding.ticker}:${marketCode}`;
    pairs.set(key, { ticker: holding.ticker, marketCode });
  }
  return [...pairs.values()];
}

async function buildSettledTradingDayMap(
  app: FastifyInstance,
  pairs: ReadonlyArray<QuoteSnapshotPair>,
  now: Date,
): Promise<Map<MarketCode, string>> {
  const settledByMarket = new Map<MarketCode, string>();
  const distinctMarkets = new Set<MarketCode>();
  for (const pair of pairs) {
    if (pair.marketCode) distinctMarkets.add(pair.marketCode);
  }
  for (const market of distinctMarkets) {
    settledByMarket.set(market, await app.tradingCalendarCache.latestSettledTradingDay(market, now));
  }
  return settledByMarket;
}

async function enqueueDisplayedQuoteRefreshes(
  app: FastifyInstance,
  pairs: ReadonlyArray<QuoteSnapshotPair>,
  now: Date = new Date(),
): Promise<{
  requestedAt: string;
  consideredPairs: number;
  openPairs: number;
  staleOrMissingPairs: number;
  enqueuedPairs: number;
  cappedPairs: number;
  queueUnavailablePairs: number;
  failedPairs: number;
  calendarUnknownPairs: number;
  pending: boolean;
}> {
  try {
    const result = await enqueueDemandIntradayRefreshes({
      pairs,
      boss: app.boss,
      persistence: app.persistence,
      tradingCalendar: app.tradingCalendarCache,
      log: app.log,
      now,
    });
    return {
      requestedAt: now.toISOString(),
      consideredPairs: result.considered,
      openPairs: result.open,
      staleOrMissingPairs: result.staleOrMissing,
      enqueuedPairs: result.enqueued,
      cappedPairs: result.capped,
      queueUnavailablePairs: result.queueUnavailable,
      failedPairs: result.failed,
      calendarUnknownPairs: result.calendarUnknownSkips,
      pending: result.enqueued > 0 || result.capped > 0,
    };
  } catch (error) {
    app.log.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        pairCount: pairs.length,
      },
      "intraday_demand_refresh_failed_degrading_to_daily_bars",
    );
    return {
      requestedAt: now.toISOString(),
      consideredPairs: pairs.length,
      openPairs: 0,
      staleOrMissingPairs: 0,
      enqueuedPairs: 0,
      cappedPairs: 0,
      queueUnavailablePairs: 0,
      failedPairs: pairs.length,
      calendarUnknownPairs: 0,
      pending: false,
    };
  }
}

async function enqueueDisplayedTickerRefresh(
  app: FastifyInstance,
  pair: { ticker: string; marketCode: MarketCode; now: Date },
): Promise<void> {
  await enqueueDisplayedQuoteRefreshes(app, [{ ticker: pair.ticker, marketCode: pair.marketCode }], pair.now);
}

async function buildDashboardHeldMarketStates(
  app: FastifyInstance,
  holdings: ReadonlyArray<{ marketCode: SharedMarketCode }>,
  regularSessionOnly: boolean,
  now: Date = new Date(),
): Promise<DashboardMarketStateDto[]> {
  const order: MarketCode[] = ["TW", "US", "AU", "KR", "JP"];
  const marketCodes = [...new Set(holdings.map((holding) => holding.marketCode as MarketCode))]
    .filter(isRegularSessionMarketCode)
    .sort((left, right) => order.indexOf(left) - order.indexOf(right));

  return Promise.all(marketCodes.map(async (marketCode) => {
    const state = await getRegularSessionState(marketCode, app.tradingCalendarCache, now);
    return {
      marketCode,
      marketState: state.isOpen ? "open" as const : "closed" as const,
      marketStateReason: state.marketStateReason,
      calendarStatus: state.calendarStatus,
      marketLocalDate: state.localDate,
      asOf: now.toISOString(),
      marketTimeZone: state.marketTimeZone,
      regularSessionOnly,
    };
  }));
}

async function buildHeldMarketStatesForStoreHoldings(
  app: FastifyInstance,
  store: Store,
  holdings: ReadonlyArray<{ accountId: string; ticker: string; quantity: number; currency: string; marketCode?: SharedMarketCode | null }>,
  regularSessionOnly: boolean,
  now: Date = new Date(),
): Promise<DashboardMarketStateDto[]> {
  const accountMarketById = new Map(store.accounts.map((account) => [
    account.id,
    marketCodeFor(account.defaultCurrency),
  ]));
  return buildDashboardHeldMarketStates(
    app,
    holdings
      .filter((holding) => holding.quantity > 0)
      .flatMap((holding) => {
        const marketCode = resolveHeldMarketCodeForStoreHolding(store, holding, accountMarketById);
        return marketCode ? [{ marketCode }] : [];
      }),
    regularSessionOnly,
    now,
  );
}

function resolveHeldMarketCodeForStoreHolding(
  store: Store,
  holding: { accountId: string; ticker: string; currency: string; marketCode?: SharedMarketCode | null },
  accountMarketById: ReadonlyMap<string, SharedMarketCode>,
): SharedMarketCode | null {
  if (holding.marketCode && isSharedMarketCode(holding.marketCode)) return holding.marketCode;

  const tradeMarkets = uniqueSharedMarketCodes(
    (store.accounting.facts.tradeEvents ?? [])
      .filter((trade) => trade.accountId === holding.accountId && trade.ticker === holding.ticker)
      .map((trade) => trade.marketCode),
  );
  if (tradeMarkets.length === 1) return tradeMarkets[0]!;

  const instrumentMarkets = uniqueSharedMarketCodes(
    store.instruments
      .filter((instrument) => instrument.ticker === holding.ticker && isInstrumentQuoteable(instrument))
      .map((instrument) => instrument.marketCode),
  );
  if (instrumentMarkets.length === 1) return instrumentMarkets[0]!;

  return accountMarketById.get(holding.accountId) ?? marketCodeFor(holding.currency as AccountDefaultCurrency);
}

function uniqueSharedMarketCodes(values: ReadonlyArray<string | null | undefined>): SharedMarketCode[] {
  return [...new Set(values)]
    .filter((market): market is SharedMarketCode => isSharedMarketCode(market));
}

function isSharedMarketCode(value: string | null | undefined): value is SharedMarketCode {
  return typeof value === "string" && (MARKET_CODES as readonly string[]).includes(value);
}

function buildHeldTickerMarketPairsForCloseRefresh(
  store: Store,
  holdings: ReadonlyArray<{ accountId: string; ticker: string; quantity: number; currency: string; marketCode?: SharedMarketCode | null }>,
): Array<{ ticker: string; marketCode: MarketCode }> {
  const quoteablePairs = new Set<string>();
  for (const instrument of store.instruments) {
    if (!isInstrumentQuoteable(instrument)) continue;
    quoteablePairs.add(`${instrument.ticker}:${instrument.marketCode}`);
  }
  const accountMarketById = new Map(store.accounts.map((account) => [
    account.id,
    marketCodeFor(account.defaultCurrency),
  ]));
  const pairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const holding of holdings) {
    if (holding.quantity <= 0) continue;
    const marketCode = resolveHeldMarketCodeForStoreHolding(store, holding, accountMarketById);
    if (!marketCode || !isRegularSessionMarketCode(marketCode)) continue;
    const key = `${holding.ticker}:${marketCode}`;
    if (!quoteablePairs.has(key)) continue;
    pairs.set(key, { ticker: holding.ticker, marketCode });
  }
  return [...pairs.values()];
}

const reportQuerySchema = z.object({
  scope: z.enum(REPORT_SCOPES).optional(),
  currencyMode: z.enum(REPORT_CURRENCY_MODES).optional(),
  currency: z.enum(ACCOUNT_DEFAULT_CURRENCIES).optional(),
  range: z.string().trim().min(1).max(20).optional(),
  limit: z.coerce.number().int().min(1).max(REPORT_HOLDINGS_MAX_LIMIT).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

function mapPortfolioInstrumentOptions(store: Store): InstrumentOptionDto[] {
  return listTransactionInstruments(store.instruments)
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

function buildShellPortfolioConfig(store: Store): ShellPortfolioConfigDto {
  const capabilities = derivePortfolioCapabilities(store.accounts);
  return {
    accounts: store.accounts,
    feeProfiles: store.feeProfiles,
    feeProfileBindings: store.feeProfileBindings,
    integrityIssue: getStoreIntegrityIssue(store),
    capabilities,
  };
}

function buildTransactionAccountOptions(store: Store): TransactionAccountOptionDto[] {
  return store.accounts.map((account) => ({
    id: account.id,
    name: account.name,
    feeProfileName: store.feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
    defaultCurrency: account.defaultCurrency,
    accountType: account.accountType,
  }));
}

function buildInstrumentNameLookup(store: Pick<Store, "marketData" | "instruments">): ReadonlyMap<string, string> {
  const namesByKey = new Map<string, string>();
  const addName = (instrument: { ticker: string; marketCode: string; name?: string | null }) => {
    const name = instrument.name?.trim();
    if (!name) return;
    if (!MARKET_CODES.includes(instrument.marketCode as SharedMarketCode)) return;
    namesByKey.set(`${instrument.marketCode}:${instrument.ticker}`, name);
    if (!namesByKey.has(instrument.ticker)) {
      namesByKey.set(instrument.ticker, name);
    }
  };

  for (const instrument of store.marketData.instruments) {
    addName(instrument);
  }
  for (const instrument of store.instruments as ReadonlyArray<{ ticker: string; marketCode: SharedMarketCode; name?: string | null }>) {
    addName(instrument);
  }
  return namesByKey;
}

const CATALOG_NAME_LOOKUP_BATCH_SIZE = 25;

async function resolveMissingCatalogInstrumentNames<T extends { ticker: string; marketCode: SharedMarketCode; instrumentName?: string | null }>(
  groups: T[],
  existingNames: ReadonlyMap<string, string>,
  persistence: Pick<Persistence, "getInstrument">,
): Promise<ReadonlyMap<string, string>> {
  const missingPairs = new Map<string, { ticker: string; marketCode: SharedMarketCode }>();
  for (const group of groups) {
    if (group.instrumentName) continue;
    if (existingNames.has(`${group.marketCode}:${group.ticker}`) || existingNames.has(group.ticker)) continue;
    missingPairs.set(`${group.marketCode}:${group.ticker}`, {
      ticker: group.ticker,
      marketCode: group.marketCode,
    });
  }
  const resolvedNames = new Map<string, string>();
  const pairs = [...missingPairs.values()];
  for (let index = 0; index < pairs.length; index += CATALOG_NAME_LOOKUP_BATCH_SIZE) {
    const chunk = pairs.slice(index, index + CATALOG_NAME_LOOKUP_BATCH_SIZE);
    const instruments = await Promise.all(chunk.map(async (pair) => ({
      ...pair,
      instrument: await persistence.getInstrument(pair.ticker, pair.marketCode),
    })));
    for (const { ticker, marketCode, instrument } of instruments) {
      const name = instrument?.name?.trim();
      if (!name) continue;
      resolvedNames.set(`${marketCode}:${ticker}`, name);
      if (!resolvedNames.has(ticker)) {
        resolvedNames.set(ticker, name);
      }
    }
  }
  return resolvedNames;
}

async function attachInstrumentNamesToHoldingGroups<T extends DashboardOverviewHoldingGroupDto>(
  store: Pick<Store, "marketData" | "instruments">,
  persistence: Pick<Persistence, "getInstrument">,
  groups: T[],
): Promise<T[]> {
  const storeNamesByKey = buildInstrumentNameLookup(store);
  const catalogNamesByKey = await resolveMissingCatalogInstrumentNames(groups, storeNamesByKey, persistence);
  const namesByKey = new Map([...storeNamesByKey, ...catalogNamesByKey]);
  return groups.map((group) => {
    const instrumentName = namesByKey.get(`${group.marketCode}:${group.ticker}`)
      ?? namesByKey.get(group.ticker)
      ?? group.instrumentName
      ?? null;
    return {
      ...group,
      instrumentName,
      children: group.children.map((child) => ({
        ...child,
        instrumentName: child.instrumentName ?? instrumentName,
      })),
    };
  });
}

function buildPortfolioPrimaryHoldings(store: Store, userId: string) {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const instrumentNameByKey = buildInstrumentNameLookup(store);
  const holdings = listHoldings(store, userId);
  const totalCostAmount = holdings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);

  return holdings
    .map((holding) => {
      const marketCode = marketCodeFor(holding.currency);
      const instrumentName = instrumentNameByKey.get(`${marketCode}:${holding.ticker}`)
        ?? instrumentNameByKey.get(holding.ticker)
        ?? null;
      return {
        accountId: holding.accountId,
        accountName: accountById.get(holding.accountId)?.name ?? holding.accountId,
        ticker: holding.ticker,
        instrumentName,
        marketCode,
        quantity: holding.quantity,
        costBasisAmount: holding.costBasisAmount,
        currency: holding.currency,
        averageCostPerShare: holding.quantity > 0 ? roundToDecimal(holding.costBasisAmount / holding.quantity, 2) : 0,
        currentUnitPrice: null,
        marketValueAmount: null,
        unrealizedPnlAmount: null,
        allocationPct: totalCostAmount > 0 ? (holding.costBasisAmount / totalCostAmount) * 100 : null,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: "missing" as const,
        nextDividendDate: null,
        lastDividendPostedDate: null,
        priceState: buildMissingPriceState(marketCode),
      };
    })
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.ticker.localeCompare(right.ticker));
}

async function attachInstrumentNamesToPrimaryHoldings<T extends ReturnType<typeof buildPortfolioPrimaryHoldings>[number]>(
  store: Pick<Store, "marketData" | "instruments">,
  persistence: Pick<Persistence, "getInstrument">,
  holdings: T[],
): Promise<T[]> {
  const storeNamesByKey = buildInstrumentNameLookup(store);
  const catalogNamesByKey = await resolveMissingCatalogInstrumentNames(holdings, storeNamesByKey, persistence);
  const namesByKey = new Map([...storeNamesByKey, ...catalogNamesByKey]);
  return holdings.map((holding) => ({
    ...holding,
    instrumentName: namesByKey.get(`${holding.marketCode}:${holding.ticker}`)
      ?? namesByKey.get(holding.ticker)
      ?? holding.instrumentName
      ?? null,
  }));
}

async function buildDashboardPrimaryOverview(
  store: Store,
  userId: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Pick<Persistence, "getInstrument">,
): Promise<DashboardOverviewDto> {
  const capabilities = derivePortfolioCapabilities(store.accounts);
  const holdings = await attachInstrumentNamesToPrimaryHoldings(
    store,
    persistence,
    buildPortfolioPrimaryHoldings(store, userId),
  );
  const holdingGroups = await attachInstrumentNamesToHoldingGroups(
    store,
    persistence,
    buildOverviewHoldingGroups(store, holdings),
  );
  const sourceCurrencies = new Set(holdings.map((holding) => holding.currency));
  const isReportingNative = [...sourceCurrencies].every((currency) => currency === reportingCurrency);
  const totalCostAmount = isReportingNative
    ? holdings.reduce((sum, holding) => sum + holding.costBasisAmount, 0)
    : 0;
  const integrityIssue = getStoreIntegrityIssue(store);

  return {
    capabilities,
    settings: withTickerPriceFreshnessSettings(store.settings),
    summary: {
      asOf: new Date().toISOString(),
      accountCount: store.accounts.length,
      holdingCount: holdings.length,
      totalCostAmount,
      reportingCurrency,
      fxStatus: isReportingNative ? "complete" : "missing",
      marketValueAmount: null,
      unrealizedPnlAmount: null,
      dailyChangeAmount: null,
      dailyChangePercent: null,
      upcomingDividendCount: 0,
      upcomingDividendAmount: null,
      openIssueCount: integrityIssue ? 1 : 0,
      priceStateRollup: {
        holdingCount: holdings.length,
        currentPriceCount: 0,
        nonCurrentPriceCount: 0,
        missingPriceCount: holdings.length,
        basisCounts: [{ basis: "missing", count: holdings.length }],
      },
    },
    marketStates: [],
    fxRates: [],
    marketValues: [],
    holdings,
    holdingGroups,
    dividends: {
      upcoming: [],
      recent: [],
    },
    actions: {
      integrityIssue,
      recomputeAvailable: true,
    },
    instruments: mapPortfolioInstrumentOptions(store),
    accounts: store.accounts,
    feeProfiles: store.feeProfiles,
    feeProfileBindings: store.feeProfileBindings,
  };
}

async function opportunisticUpsertDailyBars(
  app: FastifyInstance,
  bars: DailyBar[],
  marketCode: MarketCode,
): Promise<void> {
  if (bars.length === 0) return;

  const distinctDates = [...new Set(bars.map((bar) => bar.barDate))];
  const persistence = app.persistence;

  if ("getPool" in persistence && typeof persistence.getPool === "function") {
    await upsertDailyBars(
      persistence.getPool(),
      bars.map((bar) => ({
        ticker: bar.ticker,
        marketCode,
        barDate: bar.barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        quality: bar.quality,
        // KZO-163 D7: propagate DailyBar.source → RawDailyBar.sourceId so the
        // upsert preserves provider attribution. Without this the SQL fell back
        // to 'finmind' for every row, masking future multi-provider sources.
        sourceId: bar.source,
      })),
    );
    app.tradingCalendarCache.notifyBarsUpserted(marketCode, distinctDates);
    return;
  }

  if ("_seedDailyBars" in persistence && typeof persistence._seedDailyBars === "function") {
    persistence._seedDailyBars(bars.map((bar) => ({ ...bar, marketCode })));
    app.tradingCalendarCache.notifyBarsUpserted(marketCode, distinctDates);
  }
}

type FxTransferMutationResult =
  | CreateFxTransferResult
  | UpdateFxTransferResult
  | ReverseFxTransferResult;

// KZO-168 D11: emit a dedicated `currency_wallet_recomputed` event after FX
// transfer mutations. Reusing the trade-event `recompute_complete` shape would
// feed `undefined` into transaction-mutation consumers that read
// `event.accountId` / `event.ticker`, so the payload-shape contract is
// intentionally distinct.
async function publishFxTransferRecompute(
  app: FastifyInstance,
  userId: string,
  cashBalanceChanges: CashBalanceChange[],
): Promise<void> {
  await generateCurrencyWalletSnapshots(userId, app.persistence);
  await app.eventBus.publishEvent(userId, "currency_wallet_recomputed", {
    cashBalanceChanges,
  });
}

function stripFxTransferSideEffects<T extends FxTransferMutationResult>(
  result: T,
): Omit<T, "cashBalanceChanges"> {
  // Drop the side-effect channel before returning to the HTTP layer; the
  // route already published the SSE event with the same payload, so the
  // synchronous response only carries identifiers.
  const response: Record<string, unknown> = { ...result };
  delete response.cashBalanceChanges;
  return response as Omit<T, "cashBalanceChanges">;
}

function rethrowFxTransferError(error: unknown): never {
  if (error instanceof MissingFxRateError) {
    throw routeError(400, "fx_rate_unavailable", error.message);
  }
  throw error;
}

function resolveTransactionFeeProfile(
  store: Store,
  accountId: string,
  ticker: string,
): FeeProfile {
  // KZO-183: bindings no longer carry marketCode — resolution by (accountId, ticker)
  // only. Market enforcement is handled separately via the trade booking guard.
  const override = store.feeProfileBindings.find(
    (binding) => binding.accountId === accountId && binding.ticker === ticker,
  );

  if (override) {
    return requireProfile(store, override.feeProfileId);
  }

  const account = requireAccount(store, accountId);
  return requireProfile(store, account.feeProfileId);
}

const demoRateBuckets = new Map<string, { count: number; windowStartedAt: number }>();

/** @internal — test-only helper to reset the demo rate limiter between test runs. */
export function _resetDemoRateBuckets(): void {
  demoRateBuckets.clear();
}

async function resolveDashboardPerformanceAsOfFromTrades(
  persistence: Persistence,
  trades: ReadonlyArray<SnapshotTradeInput>,
): Promise<string> {
  const fallbackAsOf = new Date().toISOString();
  const activeQuantities = new Map<string, { ticker: string; marketCode: SharedMarketCode; quantity: number }>();

  for (const trade of sortSnapshotTradesForPerformance(trades)) {
    const key = `${trade.accountId}:${trade.marketCode}:${trade.ticker}`;
    const current = activeQuantities.get(key)?.quantity ?? 0;
    const next = trade.type === "BUY"
      ? current + trade.quantity
      : Math.max(0, current - trade.quantity);
    if (next === 0) activeQuantities.delete(key);
    else activeQuantities.set(key, { ticker: trade.ticker, marketCode: trade.marketCode as SharedMarketCode, quantity: next });
  }

  const pairsByKey = new Map<string, { ticker: string; marketCode: SharedMarketCode }>();
  for (const holding of activeQuantities.values()) {
    if (holding.quantity <= 0) continue;
    pairsByKey.set(`${holding.ticker}:${holding.marketCode}`, {
      ticker: holding.ticker,
      marketCode: holding.marketCode,
    });
  }

  if (pairsByKey.size === 0) return fallbackAsOf;

  const latestBarDates = await persistence.getLatestBarDatesForReconciliation([...pairsByKey.values()]);
  let latestDate: string | null = null;
  for (const date of latestBarDates.values()) {
    if (date !== null && (latestDate === null || date > latestDate)) {
      latestDate = date;
    }
  }

  return latestDate === null ? fallbackAsOf : `${latestDate}T00:00:00.000Z`;
}

function sortSnapshotTradesForPerformance<T extends SnapshotTradeInput>(trades: ReadonlyArray<T>): T[] {
  return [...trades].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0) ||
      (a.tradeTimestamp ?? "").localeCompare(b.tradeTimestamp ?? "") ||
      a.id.localeCompare(b.id),
  );
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  registerInviteStatusEviction(app);
  registerAnonymousShareEviction(app);
  registerMarketDataPriceEviction(app);
  registerMarketDataSearchEviction(app);
  registerTickerPriceRefreshCloseEviction(app);
  registerProviderErrorTrailPurge(app);

  app.post("/__e2e/reset", async (req) => {
    assertE2EResetEnabled();
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const store = createSeededStoreForUser(identity.userId);
    await app.persistence.saveStore(store);

    // Ensure user identity exists for server-side getProfile()
    await app.persistence.ensureDefaultPortfolioData(identity.userId);

    // Set role to match the resolved identity (default: admin in dev_bypass)
    const role = identity.role ?? "admin";
    const user = await app.persistence.getAuthUserById(identity.userId);
    if (user && user.role !== role) {
      await app.persistence.changeUserRole(identity.userId, role, { actorUserId: "system" });
    }

    return { status: "reset", userId: identity.userId };
  });

  app.post("/__e2e/seed-instruments", async (req) => {
    // KZO-169 (Fix-P1): seed-class endpoints must use the seed guard so that
    // API HTTP tests (suite 8 — AUTH_MODE=oauth) can call them. The reset
    // guard requires AUTH_MODE=dev_bypass and would block oauth-mode HTTP
    // suites. Per `.claude/rules/e2e-seed-vs-reset-guards.md`.
    assertE2ESeedEnabled();
    const body = z
      .object({
        instruments: z.array(
          z.object({
            ticker: z.string(),
            name: z.string().nullable(),
            instrumentType: z.string().nullable(),
            marketCode: z.string(),
            barsBackfillStatus: z.string(),
            lastRepairAt: z.string().nullable().optional(),
            delistedAt: z.string().optional(),
            industryCategoryRaw: z.string().nullable().optional(),
            // KZO-196 — optional GICS industry-group label (AU only). Lets E2E
            // specs seed the column without invoking the asx-gics-sync worker.
            gicsIndustryGroup: z.string().nullable().optional(),
          }),
        ),
      })
      .parse(req.body);

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const mem = app.persistence as import("../persistence/memory.js").MemoryPersistence;
    mem._replaceInstruments(body.instruments, userId);
    return { status: "seeded", count: body.instruments.length };
  });

  app.post("/__e2e/seed-notification", async (req) => {
    assertE2ESeedEnabled();
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z
      .object({
        severity: z.enum(["info", "warning", "error"]),
        source: z.string().default("daily_refresh"),
        title: z.string(),
        body: z.string().optional(),
        detail: z.unknown().optional(),
      })
      .parse(req.body);

    const id = await app.persistence.createNotification({
      userId,
      severity: body.severity,
      source: body.source,
      title: body.title,
      body: body.body,
      detail: body.detail,
    });
    return { status: "seeded", id };
  });

  // KZO-159 (158A): test-only helper that lets E2E/integration suites drop
  // a fully-formed preferences row onto the active user (or a specific user
  // when provided). Uses `_setUserPreferences` which does a shallow merge at
  // the top-level key (preserves unmentioned keys like `reportingCurrency`
  // when seeding `cardOrder`, and vice versa). Gated behind the seed guard
  // (NODE_ENV + PERSISTENCE_BACKEND=memory) per KZO-132 pattern.
  app.post("/__e2e/seed-user-preferences", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        userId: userScopedIdSchema.optional(),
        preferences: z.record(z.string(), z.unknown()),
      })
      .parse(req.body);
    const targetUserId = body.userId
      ?? resolveUserId(req, app.oauthConfig?.sessionSecret).userId;
    await app.persistence._setUserPreferences(targetUserId, body.preferences);
    return { status: "seeded", userId: targetUserId };
  });

  // KZO-177 — test-only seed for provider health rows. Lets E2E/HTTP suites
  // jump the row to a specific status without driving full backfill flows.
  // Gated with `assertE2ESeedEnabled()` (NOT reset guard) so it works in oauth
  // mode for HTTP tests.
  app.post("/__e2e/seed-provider-health-status", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        providerId: z.enum([
          "finmind-tw",
          "finmind-us",
          "yahoo-finance-au",
          "twelve-data-au",
          "yahoo-finance-kr",
          "twelve-data-kr",
          "yahoo-finance-jp",
          "twelve-data-jp",
          "frankfurter",
          // KZO-196 — ASX GICS catalog provider for E2E seed of the admin
          // /providers row (run-now button + status badge tests).
          "asx-gics-csv",
        ]),
        status: z.enum(["healthy", "degraded", "down"]).optional(),
        lastSuccessfulRun: z.string().nullable().optional(),
        lastFailedRun: z.string().nullable().optional(),
        lastErrorMessage: z.string().nullable().optional(),
        lastDownNotificationAt: z.string().nullable().optional(),
        lastManualRerunAt: z.string().nullable().optional(),
      })
      .parse(req.body);
    const row = await app.persistence.upsertProviderHealthStatus(body);
    return { status: "seeded", row };
  });

  app.post("/__e2e/seed-daily-bars", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        bars: z.array(
          z.object({
            ticker: z.string(),
            marketCode: marketCodeSchema.default("TW"),
            barDate: z.string(),
            open: z.number(),
            high: z.number(),
            low: z.number(),
            close: z.number(),
            volume: z.number(),
            source: z.string().default("e2e-seed"),
            ingestedAt: z.string().default(new Date().toISOString()),
          }),
        ),
      })
      .parse(req.body);

    const { MemoryPersistence } = await import("../persistence/memory.js");
    if (!(app.persistence instanceof MemoryPersistence)) {
      throw routeError(400, "memory_only", "seed-daily-bars is only available with memory persistence");
    }
    app.persistence._seedDailyBars(body.bars);
    const distinctByMarket = new Map<MarketCode, Set<string>>();
    for (const bar of body.bars) {
      let dates = distinctByMarket.get(bar.marketCode);
      if (!dates) {
        dates = new Set<string>();
        distinctByMarket.set(bar.marketCode, dates);
      }
      dates.add(bar.barDate);
    }
    for (const [marketCode, dates] of distinctByMarket) {
      app.tradingCalendarCache.notifyBarsUpserted(marketCode, [...dates]);
    }
    return { status: "seeded", count: body.bars.length };
  });

  // KZO-164: test-only seed for FX rates. Used by HTTP/AAA + integration suites
  // to populate `getFxRateFreshness()` and the freshness route without spinning
  // up the worker / Frankfurter mock.
  app.post("/__e2e/seed-fx-rates", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        rates: z.array(
          z.object({
            date: isoDateSchema,
            baseCurrency: z.string().regex(/^[A-Z]{3}$/),
            quoteCurrency: z.string().regex(/^[A-Z]{3}$/),
            rate: z.number().positive(),
            source: z.string().default("frankfurter"),
          }),
        ),
      })
      .parse(req.body);

    const inserted = await app.persistence.upsertFxRates(body.rates);
    return { inserted };
  });

  // KZO-164: test-only reset for FX rates. Per-test isolation for HTTP/AAA
  // freshness specs that share a single in-memory persistence across the
  // serial worker. Uses `assertE2ESeedEnabled()` (NODE_ENV + memory backend)
  // so it works under AUTH_MODE=oauth like the seed endpoint.
  app.post("/__e2e/reset-fx-rates", async () => {
    assertE2ESeedEnabled();
    const mem = app.persistence as import("../persistence/memory.js").MemoryPersistence;
    mem._resetFxRates();
    return { status: "reset" };
  });

  app.post("/__e2e/seed-dividend-event", async (req) => {
    assertE2ESeedEnabled();
    const body = z
      .object({
        accountId: userScopedIdSchema.default("acc-1"),
        ticker: tickerSchema.default("2330"),
        eventType: z.enum(["CASH", "STOCK", "CASH_AND_STOCK"]).default("CASH"),
        exDividendDate: isoDateSchema,
        paymentDate: isoDateSchema.nullable().optional(),
        cashDividendPerShare: z.number().nonnegative().default(0),
        cashDividendCurrency: currencyCodeSchema.default("TWD"),
        stockDividendPerShare: z.number().nonnegative().default(0),
        stockDistributionAmountRaw: z.number().nonnegative().nullable().optional(),
        stockProviderValueUnit: z.enum(["RATIO", "TWD_PER_SHARE", "UNKNOWN"]).nullable().optional(),
        stockProviderSource: z.string().nullable().optional(),
        stockProviderDataset: z.string().nullable().optional(),
        stockDistributionRatio: z.number().nonnegative().nullable().optional(),
        stockDistributionRatioState: z.enum(["authoritative", "derived_non_authoritative", "unresolved"]).optional(),
        stockParValueAmount: z.number().nonnegative().nullable().optional(),
        stockParValueCurrency: currencyCodeSchema.nullable().optional(),
        source: z.string().default("e2e_seed_dividend_event"),
        eligibleQuantity: z.number().int().nonnegative().default(1000),
        tradeDate: isoDateSchema.optional(),
      })
      .parse(req.body);

    const { userId, store } = await loadUserStore(app, req);
    const account = requireAccount(store, body.accountId);
    if (account.userId !== userId) {
      throw routeError(403, "account_forbidden", `Account ${account.id} does not belong to the authenticated user`);
    }

    if (body.eligibleQuantity > 0) {
      const tradeDate = body.tradeDate ?? new Date(Date.parse(`${body.exDividendDate}T00:00:00.000Z`) - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const marketCode = marketCodeFor(account.defaultCurrency);
      ensureInstrumentDefinition(store, body.ticker, marketCode);

      createTransaction(store, userId, {
        id: randomUUID(),
        accountId: body.accountId,
        ticker: body.ticker,
        marketCode,
        quantity: body.eligibleQuantity,
        unitPrice: 100,
        priceCurrency: body.cashDividendCurrency,
        tradeDate,
        type: "BUY",
        isDayTrade: false,
      });
    }
    const dividendMarketCode = marketCodeFor(account.defaultCurrency);

    const dividendEvent = createDividendEvent(store, {
      id: randomUUID(),
      ticker: body.ticker,
      marketCode: dividendMarketCode,
      eventType: body.eventType,
      exDividendDate: body.exDividendDate,
      paymentDate: body.paymentDate ?? null,
      cashDividendPerShare: body.cashDividendPerShare,
      cashDividendCurrency: body.cashDividendCurrency,
      stockDividendPerShare: body.stockDividendPerShare,
      stockDistributionAmountRaw: body.stockDistributionAmountRaw,
      stockProviderValueUnit: body.stockProviderValueUnit,
      stockProviderSource: body.stockProviderSource,
      stockProviderDataset: body.stockProviderDataset,
      stockDistributionRatio: body.stockDistributionRatio,
      stockDistributionRatioState: body.stockDistributionRatioState,
      stockParValueAmount: body.stockParValueAmount,
      stockParValueCurrency: body.stockParValueCurrency,
      source: body.source,
    });

    await app.persistence.saveStore(store);
    return {
      status: "seeded",
      accountId: body.accountId,
      eligibleQuantity: body.eligibleQuantity,
      dividendEvent,
    };
  });

  app.post("/__e2e/reset-demo-rate-buckets", async () => {
    assertE2EOauthSessionEnabled();
    _resetDemoRateBuckets();
    return { status: "reset" };
  });

  // KZO-172: per-IP search rate-limit bucket reset for HTTP-suite isolation.
  // Uses the seed guard (NOT reset guard) because the HTTP suite runs in oauth
  // mode — `assertE2EResetEnabled()` requires `AUTH_MODE=dev_bypass` and would
  // 404 the endpoint in suite 8. Per `.claude/rules/e2e-seed-vs-reset-guards.md`.
  app.post("/__e2e/reset-market-data-search-rate-limit", async () => {
    assertE2ESeedEnabled();
    _resetMarketDataSearchBuckets();
    return { ok: true };
  });

  // KZO-188: inject a single-use upstream-failure error into the AU mock
  // provider's `searchInstruments` path so the discovery UI's degraded-state
  // E2E spec can assert the "search temporarily unavailable" affordance.
  // The mock auto-clears the injected error after one fire.
  // Uses the seed guard (additive, not destructive) per
  // `.claude/rules/e2e-seed-vs-reset-guards.md`.
  //
  // KZO-194: AU catalog ownership moved to `MockTwelveDataAuCatalogProvider` (which
  // delegates `searchInstruments` to the Yahoo mock). The injected error fires at
  // the TD-mock seam — its `_setNextSearchError` mirrors the Yahoo mock pattern.
  app.post("/__e2e/inject-search-error", async (_req, reply) => {
    assertE2ESeedEnabled();
    const provider = app.marketDataRegistry.catalog.get("AU");
    if (!(provider instanceof MockTwelveDataAuCatalogProvider)) {
      throw routeError(
        409,
        "au_mock_provider_unavailable",
        "AU catalog provider is not the TD mock fixture; cannot inject search error",
      );
    }
    provider._setNextSearchError(new Error("simulated_upstream_failure"));
    reply.code(204);
    return reply.send();
  });

  // KZO-142: reset the repair cooldown override so each E2E settings spec
  // starts from a clean "env default" state.
  app.post("/__e2e/reset-app-config", async () => {
    assertE2EResetEnabled();
    await app.persistence.setRepairCooldownMinutes(null);
    return { ok: true };
  });

  // KZO-147: seed an anonymous share token row directly (bypasses the normal
  // create path) so E2E tests can exercise revoked/expired edge cases.
  app.post("/__e2e/seed-anonymous-share-token", async (req) => {
    assertE2ESeedEnabled();
    const body = z.object({
      userId: userScopedIdSchema.optional(),
      ownerUserId: userScopedIdSchema.optional(),
      token: z.string().regex(ANONYMOUS_SHARE_TOKEN_REGEX).optional(),
      expiresAt: isoDateTimeSchema.optional(),
      expiresInDays: z.number().int().min(1).max(365).optional(),
      expiredAt: isoDateTimeSchema.optional(),
      revokedAt: isoDateTimeSchema.nullable().optional(),
    }).parse(req.body);
    const ownerUserId = body.ownerUserId ?? body.userId;
    if (!ownerUserId) {
      throw routeError(400, "validation_error", "ownerUserId is required");
    }

    const token = body.token ?? generateAnonymousShareToken();
    const expiresAt = body.expiredAt
      ?? body.expiresAt
      ?? new Date(Date.now() + (body.expiresInDays ?? 7) * 24 * 60 * 60 * 1000).toISOString();
    const ttlDays = body.expiresInDays
      ?? Math.max(1, Math.ceil((Date.parse(expiresAt) - Date.now()) / (24 * 60 * 60 * 1000)));

    const created = await app.persistence.createAnonymousShareToken({
      ownerUserId,
      token,
      expiresAt,
      ttlDays,
      auditInput: { actorUserId: null, ipAddress: req.ip },
    });

    if (created.status !== "ok") {
      throw routeError(409, "seed_failed", `seed failed: ${created.status}`);
    }

    let record = created.record;
    if (body.revokedAt !== undefined && body.revokedAt !== null) {
      const revoked = await app.persistence.revokeAnonymousShareToken({
        id: record.id,
        ownerUserId,
        auditInput: { actorUserId: null, ipAddress: req.ip },
      });
      if (revoked.status === "revoked") {
        record = revoked.record;
      }
    }

    return toAnonymousShareTokenDto(app, record);
  });

  app.post("/__e2e/anon-share-rate-reset", async (req) => {
    assertE2ESeedEnabled();
    const body = z.object({ ip: z.string().trim().min(1).optional() }).parse(req.body ?? {});
    if (body.ip) {
      deleteAnonymousShareRateBucket(body.ip);
    } else {
      _resetAnonymousShareRateBuckets();
    }
    return { status: "reset" };
  });

  app.post("/__e2e/anon-share-deactivate-owner", async (req) => {
    assertE2ESeedEnabled();
    const body = z.object({ userId: userScopedIdSchema }).parse(req.body);
    await app.persistence.disableUser(body.userId, {
      actorUserId: null,
      ipAddress: req.ip,
      metadata: { reason: "anon_share_test_owner_deactivate" },
    });
    return { status: "deactivated", userId: body.userId };
  });

  app.post("/__e2e/oauth-session", async (req, reply) => {
    assertE2EOauthSessionEnabled();

    const body = z.object({ id_token: z.string().min(1).optional() }).nullable().parse(req.body ?? {});
    const query = z.object({
      role: userRoleSchema.default("admin"),
      sessionVersion: z.coerce.number().int().positive().default(1),
    }).parse(req.query);

    let sub: string;
    let email: string;
    let name: string | undefined;
    let picture: string | undefined;

    if (body?.id_token) {
      const claims = decodeIdTokenPayload(body.id_token);
      sub = claims.sub;
      email = claims.email ?? `${claims.sub}@e2e.local`;
      name = claims.name;
      picture = claims.picture;
    } else {
      sub = "e2e-ci-google-sub-001";
      email = "e2e-ci@e2e.local";
      name = "E2E CI User";
    }

    const normalizedEmail = normalizeEmailAddress(email);
    const authUser = await app.persistence.resolveOrCreateUser(
      "google",
      sub,
      { email: normalizedEmail, name, picture },
      { role: query.role, sessionVersion: query.sessionVersion },
    );

    await materializePendingSharesPostLogin(app, req, authUser.userId, normalizedEmail);

    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for session cookie signing");
    }
    const signedCookie = signSessionCookie(authUser.userId, sessionSecret, authUser.sessionVersion);
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, (Env.NODE_ENV as string) === "production", Env.COOKIE_DOMAIN);
    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}`);
    return {
      status: "ok",
      sub,
      userId: authUser.userId,
      role: query.role,
      sessionVersion: authUser.sessionVersion,
    };
  });

  /**
   * E2E-only: create a demo session without going through the rate limiter.
   *
   * Tests that verify data visibility (e.g. demo-ticker-history-aaa.spec.ts) need
   * a demo session but don't test sign-in UI mechanics. auth-demo.spec.ts
   * exhausts the 5/60s demoRateBuckets limit, so subsequent specs would get 429.
   * This endpoint bypasses that coupling entirely.
   *
   * The global mutationBuckets (120/60s in app.ts) is NOT bypassed — current
   * E2E volume (~8 calls) is well within the 120 limit.
   */
  app.post("/__e2e/demo-session", async (_req, reply) => {
    assertE2EOauthSessionEnabled();
    const { userId, expiresAt } = await createDemoSession(app, reply);
    return { status: "ok", userId, expiresAt, sessionType: "demo" };
  });

  app.post("/__e2e/impersonation-session", async (req, reply) => {
    assertE2ESeedEnabled();
    const body = z.object({
      adminUserId: userScopedIdSchema,
      targetUserId: userScopedIdSchema,
      ttlMinutes: z.coerce.number().int().positive().optional(),
    }).parse(req.body);

    const [adminUser, targetUser] = await Promise.all([
      app.persistence.getAuthUserById(body.adminUserId),
      app.persistence.getAuthUserById(body.targetUserId),
    ]);
    if (!adminUser || adminUser.role !== "admin" || adminUser.deactivatedAt || adminUser.deletedAt) {
      throw routeError(404, "admin_not_found", "Admin user not found");
    }
    if (!targetUser || targetUser.deactivatedAt || targetUser.deletedAt) {
      throw routeError(404, "user_not_found", "User not found");
    }
    if (body.adminUserId === body.targetUserId) {
      throw routeError(400, "cannot_impersonate_self", "Cannot impersonate yourself");
    }

    const ttlMinutes = body.ttlMinutes ?? Env.ADMIN_IMPERSONATION_TTL_MINUTES;
    const expiresAtMs = Date.now() + ttlMinutes * 60_000;
    const sessionSecret = app.oauthConfig?.sessionSecret ?? Env.SESSION_SECRET ?? "";
    if (!sessionSecret) {
      throw routeError(500, "missing_secret", "SESSION_SECRET is required for impersonation cookie signing");
    }

    const signedCookie = signImpersonationCookie(body.adminUserId, body.targetUserId, expiresAtMs, sessionSecret);
    reply.header("set-cookie", impersonationSetCookieString(signedCookie, ttlMinutes));
    return {
      status: "ok",
      expiresAt: new Date(expiresAtMs).toISOString(),
      targetEmail: targetUser.email ?? null,
    };
  });

  app.post("/auth/demo/start", async (req, reply) => {
    if (Env.DEMO_MODE_ENABLED !== "true") {
      throw routeError(404, "not_found", "not found");
    }

    // Per-IP rate limit: 5 requests per minute
    const demoRateKey = `${req.ip}:POST:/auth/demo/start`;
    const now = Date.now();
    const windowMs = 60_000;
    const demoLimit = 5;
    const existing = demoRateBuckets.get(demoRateKey);

    if (existing && now - existing.windowStartedAt < windowMs && existing.count >= demoLimit) {
      return reply.code(429).send({ error: "rate_limit_exceeded" });
    }

    if (!existing || now - existing.windowStartedAt >= windowMs) {
      demoRateBuckets.set(demoRateKey, { count: 1, windowStartedAt: now });
    } else {
      existing.count += 1;
    }

    const { userId, expiresAt } = await createDemoSession(app, reply);
    return { userId, expiresAt, sessionType: "demo" };
  });

  app.get("/health/live", async () => ({ status: "ok" }));
  app.get("/health/ready", async () => {
    const dependencies = await app.persistence.readiness();
    return {
      status: dependencies.postgres && dependencies.redis ? "ready" : "degraded",
      dependencies,
    };
  });

  app.get("/auth/logout", async (req, reply) => {
    // Two Set-Cookie headers: the signed session cookie and the unsigned
    // context-switcher cookie. Both must clear on logout regardless of which
    // path triggered it (UI click, direct navigation, server-initiated force-logout).
    reply.header("set-cookie", [
      sessionClearCookieString(),
      impersonationClearCookieString(),
      contextClearCookieString(),
    ]);
    const rawQuery = req.query as Record<string, string | undefined>;
    const returnTo = rawQuery.returnTo && isValidReturnTo(rawQuery.returnTo) ? rawQuery.returnTo : undefined;
    const destination = returnTo ? `${app.appBaseUrl}${returnTo}` : `${app.appBaseUrl}/login`;
    return reply.redirect(destination, 302);
  });

  app.get("/invites/:code/status", async (req) => {
    assertInviteStatusRateLimit(req.ip);
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);
    return { status: await app.persistence.getInviteStatus(params.code) };
  });

  app.post("/invites", async (req, reply) => {
    const body = z.object({
      email: z.string().trim().email().transform((value) => value.toLowerCase()),
      role: userRoleSchema,
      expiresAt: z.string().datetime({ offset: true }).optional(),
    }).parse(req.body);

    const existingUser = await app.persistence.getAuthUserByEmail(body.email);
    if (existingUser) {
      throw routeError(409, "invite_email_registered", "A user with that email already exists");
    }

    const invite = await app.persistence.createInvite({
      email: body.email,
      role: body.role,
      expiresAt: body.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: req.authContext?.sessionUserId ?? null,
    });

    await app.persistence.appendAuditLog({
      actorUserId: req.authContext?.sessionUserId ?? null,
      action: "admin_invite_issued",
      metadata: { targetEmail: body.email, inviteCode: invite.code, role: body.role },
      ipAddress: req.ip,
    });

    reply.code(201);
    return {
      code: invite.code,
      url: `${app.appBaseUrl}/invite/${invite.code}`,
    };
  });

  app.delete("/invites/:code", async (req, reply) => {
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);

    // Look up invite email for audit metadata before revoking
    const invite = await app.persistence.getInviteRecord(params.code);
    await app.persistence.revokeInvite(params.code);

    let shareOwnerEmail: string | null = null;
    let shareOwnerDisplayName: string | null = null;
    if (invite?.shareOwnerUserId) {
      const shareOwner = await app.persistence.getAuthUserById(invite.shareOwnerUserId);
      shareOwnerEmail = shareOwner?.email ?? null;
      shareOwnerDisplayName = shareOwner?.displayName ?? null;
    }

    await app.persistence.appendAuditLog({
      actorUserId: req.authContext?.sessionUserId ?? null,
      action: "admin_invite_revoked",
      metadata: {
        inviteCode: params.code,
        targetEmail: invite?.email ?? null,
        ...(invite?.shareOwnerUserId
          ? {
            shareCoupled: true,
            shareOwnerEmail,
            shareOwnerDisplayName,
          }
          : {}),
      },
      ipAddress: req.ip,
    });

    reply.code(204);
    return null;
  });

  app.get("/auth/google/start", async (req, reply) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }
    const rawQuery = req.query as Record<string, string | undefined>;
    const returnTo = rawQuery.returnTo && isValidReturnTo(rawQuery.returnTo) ? rawQuery.returnTo : undefined;
    const inviteCode = rawQuery.invite_code?.trim().toUpperCase() || undefined;
    const state = generateState(app.oauthConfig.sessionSecret, returnTo, inviteCode);
    const url = buildAuthorizationUrl(app.oauthConfig, state);
    return reply.redirect(url, 302);
  });

  app.get("/auth/google/callback", async (req, reply) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }

    const errorRedirect = (reason: string) =>
      reply.redirect(`${app.appBaseUrl}/auth/error?reason=${encodeURIComponent(reason)}`, 302);

    const rawQuery = req.query as Record<string, string | undefined>;

    if (rawQuery.error) return errorRedirect("oauth_error");

    let query: { code: string; state: string };
    try {
      query = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(rawQuery);
    } catch {
      return errorRedirect("invalid_state");
    }

    if (!verifyState(query.state, app.oauthConfig.sessionSecret)) {
      return errorRedirect("invalid_state");
    }

    let tokens: GoogleTokenResponse;
    try {
      tokens = await exchangeCodeForTokens(app.oauthConfig, query.code);
    } catch (err) {
      const code = (err as { code?: string }).code;
      return errorRedirect(code === "oauth_client_error" ? "oauth_error" : "server_error");
    }

    const claims = decodeIdTokenPayload(tokens.id_token);
    if (!claims.email || claims.email_verified === false) {
      return errorRedirect("oauth_error");
    }

    const normalizedEmail = normalizeEmailAddress(claims.email);
    const initialAdminEmail = Env.INITIAL_ADMIN_EMAIL ? normalizeEmailAddress(Env.INITIAL_ADMIN_EMAIL) : null;
    const inviteCode = extractInviteCode(query.state)?.toUpperCase() ?? null;
    const returnTo = extractReturnTo(query.state);

    const existingUser = await app.persistence.getAuthUserByEmail(normalizedEmail);
    if (existingUser?.deactivatedAt || existingUser?.deletedAt) {
      return errorRedirect("account_disabled");
    }

    let authUser: Awaited<ReturnType<typeof app.persistence.resolveOrCreateUser>>;
    try {
      if (initialAdminEmail && normalizedEmail === initialAdminEmail) {
        authUser = await app.persistence.resolveOrCreateUser("google", claims.sub, {
          email: normalizedEmail,
          name: claims.name,
          picture: claims.picture,
          emailVerified: claims.email_verified,
        }, { role: "admin" });
        if (!existingUser || existingUser.role !== "admin") {
          await app.persistence.appendAuditLog({
            action: "admin_promote_first_signin",
            targetUserId: authUser.userId,
            metadata: { email: normalizedEmail, targetEmail: normalizedEmail },
          });
        }
      } else if (existingUser) {
        authUser = await app.persistence.resolveOrCreateUser("google", claims.sub, {
          email: normalizedEmail,
          name: claims.name,
          picture: claims.picture,
          emailVerified: claims.email_verified,
        });
      } else {
        if (!inviteCode) {
          return errorRedirect("invite_required");
        }
        // Validate invite (read-only) before creating user — if user creation
        // fails, the invite stays unused and the user can retry.
        const invite = await app.persistence.getInviteRecord(inviteCode);
        if (!invite) return errorRedirect("invalid_code");
        if (invite.revokedAt) return errorRedirect("revoked");
        if (invite.usedAt) return errorRedirect("already_used");
        if (new Date(invite.expiresAt).getTime() <= Date.now()) return errorRedirect("expired_code");
        if (invite.email.toLowerCase() !== normalizedEmail) return errorRedirect("email_mismatch");

        authUser = await app.persistence.resolveOrCreateUser("google", claims.sub, {
          email: normalizedEmail,
          name: claims.name,
          picture: claims.picture,
          emailVerified: claims.email_verified,
        }, { role: invite.role });

        // Consume after user creation succeeds — atomic UPDATE handles races
        // where another request consumed between validate and consume.
        const consumeResult = await app.persistence.consumeInvite(inviteCode, normalizedEmail);
        if (consumeResult.status !== "consumed") {
          // Race: invite was consumed between validate and consume.
          // User already exists (created above), so they can log in on next attempt.
        }
      }

    } catch {
      return errorRedirect("oauth_error");
    }

    await materializePendingSharesPostLogin(app, req, authUser.userId, normalizedEmail);

    const signedCookie = signSessionCookie(authUser.userId, app.oauthConfig.sessionSecret, authUser.sessionVersion);
    const attrs = buildCookieAttrs(Env.SESSION_COOKIE_NAME, Env.NODE_ENV === "production", Env.COOKIE_DOMAIN);

    // Detect misconfigured Docker local: NODE_ENV=production sets the Secure
    // cookie flag, but HTTP transport means the browser silently drops it.
    if (Env.NODE_ENV === "production" && app.appBaseUrl?.startsWith("http://")) {
      return errorRedirect("insecure_transport");
    }

    reply.header("set-cookie", `${Env.SESSION_COOKIE_NAME}=${signedCookie}; ${attrs}`);
    const destination = returnTo ? `${app.appBaseUrl}${returnTo}` : `${app.appBaseUrl}/dashboard`;
    return reply.redirect(destination, 302);
  });

  app.post("/auth/token/refresh", async (req) => {
    if (!app.oauthConfig) {
      throw routeError(503, "oauth_not_configured", "Google OAuth is not configured");
    }

    const body = z.object({
      refreshToken: z.string().min(1),
    }).parse(req.body);

    const result = await refreshAccessToken(app.oauthConfig, body.refreshToken);
    return {
      accessToken: result.access_token,
      expiresIn: result.expires_in,
    };
  });

  app.get("/settings", async (req, reply) => {
    // ui-enhancement — surface the effective account-hard-purge grace period
    // (Tier B) to the user-facing client so the "Recently deleted" countdown
    // renders the admin-overridden value, not a hardcoded 30. The resolver
    // walks DB override → env default; admin tunes via PATCH /admin/settings.
    return withReadPathTiming(req, reply, "/settings", async (timing) => {
      const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const settings = await timing.measure("user_settings", "db", () =>
        app.persistence.getUserSettings(contextUserId));
      return {
        ...settings,
        effectiveAccountHardPurgeDays: getEffectiveAccountHardPurgeDays(),
        effectiveRouteCachePolicy: getEffectiveRouteCachePolicy(),
      };
    });
  });

  app.patch("/settings", async (req) => {
    const body = z
      .object({
        locale: z.enum(["en", "zh-TW"]).optional(),
        costBasisMethod: z.literal("WEIGHTED_AVERAGE").optional(),
        quotePollIntervalSeconds: z.number().int().positive().max(86_400).optional(),
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);
    store.settings = { ...store.settings, ...body };
    await app.persistence.saveStore(store);
    // ui-enhancement — keep PATCH response shape in lockstep with GET /settings
    // so client `bodiesEqual` round-trip assertions hold.
    return {
      ...store.settings,
      effectiveAccountHardPurgeDays: getEffectiveAccountHardPurgeDays(),
      effectiveRouteCachePolicy: getEffectiveRouteCachePolicy(),
    };
  });

  app.get("/profile", async (req) => {
    const userId = requireSessionUserId(req);
    const profile = await app.persistence.getProfile(userId);
    return {
      ...profile,
      impersonation: req.authContext?.impersonation ?? null,
    };
  });

  // ui-reshape Phase 3d S7 — PATCH /profile now accepts partial updates for
  // email AND user-overridable identity fields (`displayName`, `pictureUrl`).
  // All three keys are optional and independent:
  //   - `email` absent → leave; present → update (existing semantics)
  //   - `displayName` absent → leave; null → clear override; "" → null;
  //     non-empty string ≤256 chars → set override
  //   - `pictureUrl` absent → leave; null → clear override; "" → null;
  //     HTTPS-only string → set override
  //
  // The Zod parse happens BEFORE any try block per
  // `.claude/rules/typed-transient-error-catch-audit.md`; there are no inner
  // try/catch sites here, so the parse error propagates straight to the
  // Fastify handler as a 400 (via `routeError` from our pre-checks).
  //
  // HTTPS-only validation per `.claude/rules/provider-url-sanitization.md`:
  // reject `http:`, `data:`, `javascript:`, file paths. Empty string is
  // treated as a clear (null) so the UI can wire a "Remove picture" button
  // to the same field by submitting "".
  app.patch("/profile", async (req) => {
    const userId = requireSessionUserId(req);

    const profilePatchSchema = z
      .object({
        email: z.string().email().max(254).optional(),
        displayName: z
          .union([
            z.string().max(256, "display_name_too_long"),
            z.null(),
          ])
          .optional(),
        pictureUrl: z
          .union([z.string().max(2048, "picture_url_too_long"), z.null()])
          .optional(),
      })
      .strict();

    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const message = issue?.message ?? "Invalid profile patch";
      const code = message === "display_name_too_long"
        ? "invalid_display_name"
        : message === "picture_url_too_long"
        ? "invalid_picture_url"
        : "invalid_profile_patch";
      throw routeError(400, code, message);
    }
    const body = parsed.data;

    // Coerce empty strings to null (clear semantics). For pictureUrl, ALSO
    // perform HTTPS-only validation after coercion — only non-empty strings
    // reach the URL check.
    const fields: { displayName?: string | null; pictureUrl?: string | null } = {};
    if (body.displayName !== undefined) {
      if (body.displayName === null || body.displayName.trim() === "") {
        fields.displayName = null;
      } else {
        fields.displayName = body.displayName.trim();
      }
    }
    if (body.pictureUrl !== undefined) {
      if (body.pictureUrl === null || body.pictureUrl.trim() === "") {
        fields.pictureUrl = null;
      } else {
        const candidate = body.pictureUrl.trim();
        // HTTPS-only: reject http://, data:, javascript:, file paths.
        if (!/^https:\/\//i.test(candidate)) {
          throw routeError(
            400,
            "invalid_picture_url",
            "Picture URL must use https://",
          );
        }
        fields.pictureUrl = candidate;
      }
    }

    // Email update path goes first; if both email and override fields are
    // supplied, both apply in a single PATCH. `updateProfileEmail` returns
    // the full ProfileDto, but we re-fetch via `updateProfileFields` if
    // either override field changed to ensure the response reflects the
    // final state.
    let appliedEmail = false;
    if (body.email !== undefined) {
      await app.persistence.updateProfileEmail(userId, body.email);
      appliedEmail = true;
    }
    if (fields.displayName !== undefined || fields.pictureUrl !== undefined) {
      return app.persistence.updateProfileFields(userId, fields);
    }
    if (appliedEmail) {
      return app.persistence.getProfile(userId);
    }
    // No-op PATCH (empty body or only-unknown keys filtered by `.strict()`).
    return app.persistence.getProfile(userId);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // User preferences (KZO-159 / 158A) — per-session identity. Keys other than
  // `dashboardPerformanceRanges` are accepted as opaque values (forward-compat
  // for 158C/158B). Null deletes a key. PATCH body is capped to bound JSONB
  // bloat; anything larger rejects with `payload_too_large`.
  //
  // KZO-199 (per `.claude/rules/fastify-eviction-lifecycle-pattern.md` §
  // "schedule static, parameter live"): the Fastify route's `bodyLimit` is
  // pinned to the bound max (1 MiB hard ceiling); the inner runtime check
  // reads the resolver live so admin SQL overrides take effect on the next
  // request.
  // ─────────────────────────────────────────────────────────────────────────

  const USER_PREFERENCES_BODY_LIMIT_MAX = APP_CONFIG_BOUNDS.userPreferencesMaxBytes.max;

  // Strict per-key validation: every known top-level key gets an explicit
  // schema here. Unknown keys are rejected (`.strict()`). When 158B/158C add
  // a new preference, extend this schema.
  //
  // KZO-161 (158C) adds `cardOrder` — JSONB sub-object keyed by page slug. The
  // canonical JSONB key is camelCase (`cardOrder`), matching the existing
  // `dashboardPerformanceRanges`. Null at the top level clears the entire
  // `cardOrder` sub-object; null at any sub-key clears just that page's
  // saved order while preserving the others (KZO-162).
  const cardOrderSlugListSchema = z.union([
    z.array(z.string().min(1).max(64)).max(50),
    z.null(),
  ]);
  const cardOrderSchema = z
    .object({
      dashboard: cardOrderSlugListSchema.optional(),
      transactions: cardOrderSlugListSchema.optional(),
      portfolio: cardOrderSlugListSchema.optional(),
    })
    .strict();
  const userPreferencePatchSchema = z
    .object({
      dashboardPerformanceRanges: z
        .union([dashboardPerformanceRangesSchema, z.null()])
        .optional(),
      cardOrder: z
        .union([cardOrderSchema, z.null()])
        .optional(),
      // KZO-180: user-level reporting currency. Stored as a JSONB key (no
      // migration); enum mirrors `AccountDefaultCurrency` from
      // `@vakwen/shared-types`. `null` clears the key
      // and the resolver falls back to the `'TWD'` default.
      reportingCurrency: z
        .union([accountDefaultCurrencySchema, z.null()])
        .optional(),
      holdingAllocationBasis: z
        .union([holdingAllocationBasisSchema, z.null()])
        .optional(),
      dashboardHoldingFocus: z
        .union([dashboardHoldingFocusPreferenceSchema, z.null()])
        .optional(),
      analysisUnrealizedPnlSettings: z
        .union([unrealizedPnlAnalysisSettingsPreferenceSchema, z.null()])
        .optional(),
      analysisUnrealizedPnlDefaults: z.null().optional(),
      holdingsTableSettings: z
        .union([holdingsTableSettingsPreferenceSchema, z.null()])
        .optional(),
      holdingsSelection: z
        .union([holdingsSelectionPreferenceSchema, z.null()])
        .optional(),
      adminMarketDataTableSettings: z
        .union([adminMarketDataTableSettingsPreferenceSchema, z.null()])
        .optional(),
      // ui-reshape Phase 2 — user-level theme accent + density. Stored as
      // JSONB keys (no migration); shape validated by Zod from shared-types.
      themeAccent: z
        .union([themeAccentSchema, z.null()])
        .optional(),
      density: z
        .union([densityModeSchema, z.null()])
        .optional(),
      priceColorConvention: z
        .union([priceColorConventionSchema, z.null()])
        .optional(),
    })
    .strict();

  app.get("/user-preferences", async (req) => {
    const userId = requireSessionUserId(req);
    const preferences = await app.persistence.getUserPreferences(userId);
    return { preferences };
  });

  app.patch("/user-preferences", {
    bodyLimit: USER_PREFERENCES_BODY_LIMIT_MAX,
  }, async (req) => {
    const userId = requireSessionUserId(req);
    // Enforce the byte budget explicitly here even though Fastify's bodyLimit
    // rejects at parse time — serializing the parsed body again gives a tight
    // upper bound and a predictable error shape for clients (Fastify's own
    // rejection surfaces as a 413 from the runtime, not a `routeError`).
    //
    // KZO-199: read the runtime cap LIVE from the resolver (DB override → env)
    // so an admin SQL override takes effect on the next request. The Fastify
    // bodyLimit above stays at the bound ceiling.
    const effectiveCap = getEffectiveUserPreferencesMaxBytes();
    const rawBytes = Buffer.byteLength(JSON.stringify(req.body ?? {}), "utf8");
    if (rawBytes > effectiveCap) {
      throw routeError(
        413,
        "payload_too_large",
        `Request body exceeds ${effectiveCap} bytes`,
      );
    }
    const parsed = userPreferencePatchSchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const code = issue?.message === "ranges_list_too_short"
        || issue?.message === "ranges_list_too_long"
        || issue?.message === "ranges_list_invalid_element"
        || issue?.message === "ranges_list_duplicate"
        ? "invalid_range_list"
        : "invalid_preference";
      throw routeError(400, code, issue?.message ?? "Invalid preference patch");
    }

    // Convert `undefined` → skip, `null` → delete. Pass only defined keys.
    const patch: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(parsed.data)) {
      if (value !== undefined) {
        patch[key] = value;
      }
    }
    const preferences = await app.persistence.setUserPreferencePatch(userId, patch);
    return { preferences };
  });

  app.get("/user-preferences/effective-ranges", async (req) => {
    const userId = requireSessionUserId(req);
    const result = await resolveEffectiveRanges(app.persistence, userId);
    return result;
  });

  app.get("/shares", async (req) => {
    const context = await resolveNamedShareListContext(req);
    const outbound = await app.persistence.listSharesForOwner(context.ownerUserId);
    const inbound = context.isDelegated
      ? { active: [], revoked: [] }
      : await app.persistence.listInboundSharesForGrantee(context.actorUserId);

    return {
      outbound: {
        active: await Promise.all(outbound.active.map((record) => toShareGrantDtoWithCapabilities(app, record))),
        pending: await Promise.all(outbound.pending.map((record) => toPendingShareInviteDtoWithCapabilities(app, record, "pending"))),
        expired: await Promise.all(outbound.expired.map((record) => toPendingShareInviteDtoWithCapabilities(app, record, "expired"))),
        revoked: await Promise.all(outbound.revoked.map((record) =>
          isShareGrantRecord(record)
            ? toShareGrantDtoWithCapabilities(app, record)
            : toPendingShareInviteDtoWithCapabilities(app, record, "revoked"))),
      },
      inbound: {
        active: await Promise.all(inbound.active.map((record) => toShareGrantDtoWithCapabilities(app, record))),
        revoked: await Promise.all(inbound.revoked.map((record) => toShareGrantDtoWithCapabilities(app, record))),
      },
    };
  });

  app.post("/shares", async (req, reply) => {
    const context = await resolveNamedShareManagementContext(req);
    const body = z.object({
      email: z.string().trim().email().transform((value) => value.toLowerCase()),
      capabilities: shareCapabilitiesSchema,
    }).parse(req.body);
    assertDelegableShareCapabilities(context, body.capabilities);

    const owner = await app.persistence.getAuthUserById(context.ownerUserId);
    if (!owner) {
      throw routeError(404, "user_not_found", "User not found");
    }
    if (owner.email && normalizeEmailAddress(owner.email) === body.email) {
      throw routeError(400, "cannot_share_with_self", "cannot share with self");
    }

    const existingUser = await app.persistence.getAuthUserByEmail(body.email);
    if (existingUser && !existingUser.deletedAt && !existingUser.deactivatedAt) {
      const share = await app.persistence.createShareGrant({
        ownerUserId: context.ownerUserId,
        granteeUserId: existingUser.userId,
        auditInput: {
          actorUserId: context.actorUserId,
          ipAddress: req.ip,
          metadata: buildDelegatedShareAuditMetadata(context),
        },
      });
      const capabilities = await app.persistence.setShareCapabilities({
        shareId: share.id,
        capabilities: body.capabilities,
        grantedByUserId: context.actorUserId,
      });
      await app.eventBus.publishEvent(share.granteeUserId, "sharing_notification", { shareId: share.id });
      reply.code(201);
      return {
        type: "resolved" as const,
        share: toShareGrantDto(share, capabilities),
      };
    }

    const invite = await app.persistence.createShareCoupledInvite({
      ownerUserId: context.ownerUserId,
      email: body.email,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: context.actorUserId,
    });
    const capabilities = await app.persistence.setPendingShareInviteCapabilities({
      inviteCode: invite.code,
      capabilities: body.capabilities,
      grantedByUserId: context.actorUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "admin_invite_issued",
      metadata: {
        targetEmail: body.email,
        inviteCode: invite.code,
        role: invite.role,
        shareCoupled: true,
        shareOwnerEmail: owner.email,
        shareOwnerDisplayName: owner.displayName,
        ...buildDelegatedShareAuditMetadata(context),
      },
      ipAddress: req.ip,
    });

    reply.code(201);
    return {
      type: "pending" as const,
      invite: toPendingShareInviteDto(app, invite, "pending", capabilities),
    };
  });

  app.patch("/shares/:id/capabilities", async (req) => {
    const context = await resolveNamedShareManagementContext(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({ capabilities: shareCapabilitiesSchema }).strict().parse(req.body);
    assertDelegableShareCapabilities(context, body.capabilities);
    const outbound = await app.persistence.listSharesForOwner(context.ownerUserId);
    const share = [...outbound.active, ...outbound.revoked.filter(isShareGrantRecord)]
      .find((record) => record.id === params.id) ?? null;
    if (!share) {
      throw routeError(404, "share_not_found", "Share not found");
    }
    const oldCapabilities = await app.persistence.getShareCapabilities(params.id);
    const capabilities = await app.persistence.setShareCapabilities({
      shareId: params.id,
      capabilities: body.capabilities,
      grantedByUserId: context.actorUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "share_capabilities_updated",
      targetUserId: share.granteeUserId,
      ipAddress: req.ip,
      metadata: {
        shareId: params.id,
        oldCapabilities,
        newCapabilities: capabilities,
        ...buildDelegatedShareAuditMetadata(context),
      },
    });
    await app.eventBus.publishEvent(share.granteeUserId, "sharing_notification", { shareId: share.id });
    return toShareGrantDto(share, capabilities);
  });

  app.patch("/shares/pending/:code/capabilities", async (req) => {
    const context = await resolveNamedShareManagementContext(req);
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);
    const body = z.object({ capabilities: shareCapabilitiesSchema }).strict().parse(req.body);
    assertDelegableShareCapabilities(context, body.capabilities);
    const outbound = await app.persistence.listSharesForOwner(context.ownerUserId);
    const invite = [...outbound.pending, ...outbound.expired, ...outbound.revoked.filter((record): record is PendingShareInviteRecord => !isShareGrantRecord(record))]
      .find((record) => !isShareGrantRecord(record) && record.code === params.code) ?? null;
    if (!invite) {
      throw routeError(404, "share_pending_not_found", "Pending share invite not found");
    }
    const oldCapabilities = await app.persistence.getPendingShareInviteCapabilities(params.code);
    const capabilities = await app.persistence.setPendingShareInviteCapabilities({
      inviteCode: params.code,
      capabilities: body.capabilities,
      grantedByUserId: context.actorUserId,
    });
    await app.persistence.appendAuditLog({
      actorUserId: context.actorUserId,
      action: "share_capabilities_updated",
      targetUserId: null,
      ipAddress: req.ip,
      metadata: {
        inviteCode: params.code,
        oldCapabilities,
        newCapabilities: capabilities,
        ...buildDelegatedShareAuditMetadata(context),
      },
    });
    const status = invite.revokedAt
      ? "revoked" as const
      : Date.parse(invite.expiresAt) <= Date.now()
        ? "expired" as const
        : "pending" as const;
    return toPendingShareInviteDto(app, invite, status, capabilities);
  });

  app.delete("/shares/pending/:code", async (req, reply) => {
    const context = await resolveNamedShareManagementContext(req);
    const params = z.object({
      code: z.string().trim().min(1).max(32).transform((value) => value.toUpperCase()),
    }).parse(req.params);

    await app.persistence.revokePendingShareInvite(params.code, context.ownerUserId, {
      actorUserId: context.actorUserId,
      ipAddress: req.ip,
      metadata: buildDelegatedShareAuditMetadata(context),
    });

    reply.code(204);
    return null;
  });

  app.delete("/shares/:id", async (req, reply) => {
    const context = await resolveNamedShareManagementContext(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);

    const outcome = await app.persistence.revokeShareGrant(params.id, {
      ownerUserId: context.ownerUserId,
      revokedByUserId: context.actorUserId,
      auditInput: {
        actorUserId: context.actorUserId,
        ipAddress: req.ip,
        metadata: buildDelegatedShareAuditMetadata(context),
      },
    });
    if (outcome) {
      await app.eventBus.publishEvent(outcome.granteeUserId, "sharing_notification", { shareId: params.id });
    }

    reply.code(204);
    return null;
  });

  // ── Anonymous share tokens (KZO-147) ──────────────────────────────────────
  // POST /share-tokens — create a fresh token. Capped at 20 active per owner.
  // Plaintext 22-char base62 tokens: the API returns the token exactly once
  // here (and again on GET /share-tokens list until revoked/expired).
  app.post("/share-tokens", async (req, reply) => {
    requireShareGrantorRole(req);
    requireWriteableContext(req);
    const sessionUserId = requireSessionUserId(req);
    const body = z.object({
      expiresInDays: z.number().int().min(1).max(365),
    }).parse(req.body);

    const expiresAt = new Date(Date.now() + body.expiresInDays * 24 * 60 * 60 * 1000).toISOString();

    // 3-retry loop on 23505 UNIQUE violation (rare; base62^22 keyspace).
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const token = generateAnonymousShareToken();
      const result = await app.persistence.createAnonymousShareToken({
        ownerUserId: sessionUserId,
        token,
        expiresAt,
        ttlDays: body.expiresInDays,
        auditInput: {
          actorUserId: sessionUserId,
          ipAddress: req.ip,
        },
      });
      if (result.status === "ok") {
        reply.code(201);
        return toAnonymousShareTokenDto(app, result.record);
      }
      if (result.status === "cap_exceeded") {
        throw routeError(
          429,
          "anonymous_token_cap_exceeded",
          "anonymous share token cap (20 active) reached",
        );
      }
      // collision — retry
    }
    throw routeError(500, "token_collision_retry_exhausted", "token collision retry exhausted");
  });

  // GET /share-tokens — list the session user's own tokens (created within
  // the 30-day retention window). Status is derived server-side.
  app.get("/share-tokens", async (req) => {
    requireWriteableContext(req);
    const sessionUserId = requireSessionUserId(req);
    const records = await app.persistence.listAnonymousShareTokensForOwner(sessionUserId);
    const now = Date.now();
    return {
      tokens: records.map((record) => toAnonymousShareTokenDto(app, record, now)),
    };
  });

  // DELETE /share-tokens/:id — revoke an active token, or 204 no-op if
  // already revoked/expired. Wrong-owner returns 404 — no existence leak.
  app.delete("/share-tokens/:id", async (req, reply) => {
    requireShareGrantorRole(req);
    requireWriteableContext(req);
    const sessionUserId = requireSessionUserId(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);

    const result = await app.persistence.revokeAnonymousShareToken({
      id: params.id,
      ownerUserId: sessionUserId,
      auditInput: {
        actorUserId: sessionUserId,
        ipAddress: req.ip,
      },
    });

    if (result.status === "not_found") {
      throw routeError(404, "token_not_found", "token not found");
    }

    reply.code(204);
    return null;
  });

  // GET /share/:token — public read-only view. No auth. Rate-limited per-IP
  // BEFORE the DB lookup so brute-forcers cannot burn persistence throughput.
  // Every failure after the rate check returns the same opaque 404.
  app.get("/share/:token", async (req, reply) => {
    // Step 1 — rate limit first (even invalid tokens count).
    try {
      assertAnonymousShareRateLimit(req.ip);
    } catch (error) {
      if ((error as { statusCode?: number; code?: string }).statusCode === 429) {
        // KZO-199 Phase 4: read effective window LIVE so admin overrides via
        // PATCH /admin/settings { anonymousShareRateLimitWindowMs } take effect
        // for the Retry-After header. Per
        // `.claude/rules/fastify-eviction-lifecycle-pattern.md` parameter-live.
        reply.header(
          "retry-after",
          String(Math.ceil(getEffectiveAnonymousShareRateLimitWindowMs() / 1000)),
        );
      }
      throw error;
    }

    // Step 2 — cheap regex pre-check (malformed strings never hit the DB).
    const rawToken = (req.params as { token?: unknown }).token;
    if (typeof rawToken !== "string" || !ANONYMOUS_SHARE_TOKEN_REGEX.test(rawToken)) {
      throw routeError(404, "token_not_found", "token not found");
    }

    // Step 3 — find an active (not revoked, not expired) token row.
    const record = await app.persistence.findActiveAnonymousShareTokenByToken(rawToken);
    if (!record) {
      throw routeError(404, "token_not_found", "token not found");
    }

    // Step 4 — owner must be active (not soft-deleted, not deactivated).
    const owner = await app.persistence.getAuthUserById(record.ownerUserId);
    if (!owner || owner.deletedAt || owner.deactivatedAt) {
      throw routeError(404, "token_not_found", "token not found");
    }

    // Step 5 — load the owner's store and resolve quote snapshots.
    const { store } = await loadUserStoreForUserId(app, record.ownerUserId);
    const tickers = [
      ...new Set(
        store.accounting.projections.holdings
          .filter((holding) => holding.quantity > 0)
          .map((holding) => holding.ticker),
      ),
    ];
    const { pairs, settledByMarket } = await buildQuoteSnapshotInputs(app, store, tickers);
    const quotes = await resolveQuoteSnapshots(pairs, app.persistence, settledByMarket);

    // Owner display name fallback chain.
    const ownerDisplayName = owner.displayName
      ?? (owner.email ? owner.email.split("@")[0]! : "Portfolio owner");

    const view = buildPublicShareView(store, quotes, ownerDisplayName, record.expiresAt);

    // Step 6 — response headers. Never cache and never expose the token/id.
    reply.header("cache-control", "private, no-store, max-age=0");
    return view;
  });

  // ui-reshape Phase 3d S8 — `PUT /settings/full` was the omnibus settings
  // save endpoint. Retired in favor of per-resource PATCH:
  //   - PATCH /settings        (locale, quotePollIntervalSeconds)
  //   - PATCH /profile         (displayName, pictureUrl, email)
  //   - PATCH /user-preferences (themeAccent, density, performanceRanges, ...)
  //   - PATCH /accounts/:id    (account renames, currency changes)
  //   - POST /fee-profiles + PATCH /fee-profiles/:id (fee profile mutations)
  //   - PUT /settings/fee-config (account→fee-profile bindings + ticker overrides)
  //
  // The deleted handler accepted `{settings, feeProfiles, accounts, feeProfileBindings}`
  // and full-replaced fee profiles, account fee-profile assignments, and
  // bindings in one transaction. Migration path for callers: split into the
  // per-resource calls above. See architect-design.md §7.2 + scope-todo
  // "API surface (§5.1)". Tests previously using `PUT /settings/full` for
  // setup (e.g. `portfolio.integration.test.ts`) now use `PUT /settings/fee-config`
  // for the same purpose.
  //
  // No 410 Gone stub is registered; any in-flight client receives Fastify's
  // default 404 which is the correct semantics for a removed endpoint. The
  // route key is also removed from `WRITER_ROLE_ROUTE_KEYS` and
  // `WRITE_CONTEXT_GUARD_ROUTE_KEYS` above (it would otherwise be dead config).

  app.get("/settings/fee-config", async (req, reply) => {
    return withReadPathTiming(req, reply, "/settings/fee-config", async (timing) => {
      const { store } = await timing.measure("load_store", "db", () => loadUserStore(app, req));
      return buildShellPortfolioConfig(store);
    });
  });

  app.put("/settings/fee-config", async (req) => {
    const body = z
      .object({
        accounts: z
          .array(
            z.object({
              id: userScopedIdSchema,
              feeProfileId: userScopedIdSchema,
            }),
          )
          .max(200),
        feeProfileBindings: z.array(feeBindingSchema).max(500),
      })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);
    const draftStore = structuredClone(store);
    const feeProfileIds = new Set(draftStore.feeProfiles.map((profile) => profile.id));

    for (const update of body.accounts) {
      const account = draftStore.accounts.find((item) => item.id === update.id);
      if (!account) {
        throw routeError(404, "account_not_found", `Account ${update.id} was not found.`);
      }
      if (!feeProfileIds.has(update.feeProfileId)) {
        throw routeError(400, "invalid_fee_profile", `Fee profile ${update.feeProfileId} was not found.`);
      }
      const profile = draftStore.feeProfiles.find((item) => item.id === update.feeProfileId);
      if (profile?.accountId !== account.id) {
        throw routeError(
          400,
          "invalid_fee_profile",
          `Fee profile ${update.feeProfileId} is not owned by account ${account.id}.`,
        );
      }
      account.feeProfileId = update.feeProfileId;
    }

    const normalizedBindings = normalizeBindings(body.feeProfileBindings);
    ensureBindingsAreValid(draftStore, normalizedBindings);
    draftStore.feeProfileBindings = normalizedBindings;

    assertStoreIntegrity(draftStore);
    await app.persistence.saveStore(draftStore);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "fee_config_updated",
      routeKey: "PUT /settings/fee-config",
    });

    return {
      accounts: draftStore.accounts,
      feeProfileBindings: draftStore.feeProfileBindings,
    };
  });

  app.get("/accounts", async (req, reply) => {
    const query = z.object({
      includeBalances: z.coerce.boolean().default(false),
    }).parse(req.query);
    if (query.includeBalances) {
      return withReadPathTiming(req, reply, "/accounts?includeBalances=true", async (timing) => {
        const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
        return timing.measure("accounts_with_balances", "db", () =>
          app.persistence.listAccountsWithLiveBalances(contextUserId),
        );
      });
    }
    const { store } = await loadUserStore(app, req);
    return store.accounts;
  });

  app.post("/accounts", async (req) => {
    const body = z
      .object({
        name: z.string().trim().min(1).max(80),
        defaultCurrency: accountDefaultCurrencySchema,
        accountType: z.enum(["broker", "bank", "wallet"]),
      })
      .parse(req.body);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const userId = identity.contextUserId;
    const sessionUserId = requireSessionUserId(req);
    const result = await app.persistence.createAccount({
      userId,
      name: body.name,
      defaultCurrency: body.defaultCurrency,
      accountType: body.accountType,
      auditInput: await buildPortfolioAuditInput(req, "POST /accounts"),
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "account_created",
      routeKey: "POST /accounts",
      accountId: result.account.id,
    });
    await publishAccountMutationEventToOwnerAndActiveGrantees(app, userId, "account_created", result);
    return buildAccountMutationResponse(app, sessionUserId, result);
  });

  app.patch("/accounts/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z
      .object({
        name: z.string().trim().min(1).max(80).optional(),
        feeProfileId: userScopedIdSchema.optional(),
        // KZO-167: per-account default currency + account type metadata.
        // Enum values match the migration 040 CHECK constraint.
        defaultCurrency: accountDefaultCurrencySchema.optional(),
        accountType: z.enum(["broker", "bank", "wallet"]).optional(),
      })
      .refine(
        (value) =>
          value.name !== undefined ||
          value.feeProfileId !== undefined ||
          value.defaultCurrency !== undefined ||
          value.accountType !== undefined,
        { message: "at least one field required" },
      )
      .parse(req.body);

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sessionUserId = requireSessionUserId(req);
    const result = await app.persistence.updateAccount({
      userId,
      accountId: params.id,
      ...body,
      auditInput: await buildPortfolioAuditInput(req, "PATCH /accounts/:id"),
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "account_updated",
      routeKey: "PATCH /accounts/:id",
      accountId: result.account.id,
      changedFields: result.changedFields ?? Object.keys(body),
    });
    await publishAccountMutationEventToOwnerAndActiveGrantees(app, userId, "account_updated", result);
    return buildAccountMutationResponse(app, sessionUserId, result);
  });

  app.get("/accounts/:id/dividend-settings/:marketCode", async (req) => {
    const params = z.object({
      id: userScopedIdSchema,
      marketCode: z.enum(MARKET_CODES),
    }).parse(req.params);
    const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return app.persistence.getAccountMarketDividendSettings(contextUserId, params.id, params.marketCode);
  });

  app.patch("/accounts/:id/dividend-settings/:marketCode", async (req) => {
    const params = z.object({
      id: userScopedIdSchema,
      marketCode: z.enum(MARKET_CODES),
    }).parse(req.params);
    const body = dividendSettingsPatchSchema.parse(req.body);
    const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return app.persistence.patchAccountMarketDividendSettings(contextUserId, {
      accountId: params.id,
      marketCode: params.marketCode,
      fallbackParValue: body.fallbackParValue,
      expectedVersion: body.expectedVersion,
      auditInput: await buildPortfolioAuditInput(req, "PATCH /accounts/:id/dividend-settings/:marketCode"),
    });
  });

  // ── ui-enhancement — account lifecycle routes ────────────────────────────
  // DELETE /accounts/:id — soft-delete an active account. Stamps
  // `accounts.deleted_at = NOW()`; the row is filtered out of subsequent
  // active reads (loadStore filters `deleted_at IS NULL`) and surfaced via
  // GET /accounts/deleted for the "Recently deleted" UI section. The daily
  // hard-purge cron promotes the row to fully-purged after the configured
  // grace period (default 30d; admin override via
  // `app_config.account_hard_purge_days`).
  app.delete("/accounts/:id", async (req, reply) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const userId = identity.contextUserId;
    const sessionUserId = requireSessionUserId(req);
    const result = await app.persistence.softDeleteAccount(params.id, userId, {
      actorUserId: sessionUserId,
      ipAddress: req.ip,
      metadata: await buildDelegatedAuditMetadata(req),
    });
    const useAuthoritativeOwnerPreference = identity.sessionUserId === identity.contextUserId;
    const response = await buildAccountLifecycleResponse(
      app,
      result,
      identity.sessionUserId,
      useAuthoritativeOwnerPreference,
    );
    await publishLifecycleEventToOwnerAndActiveGrantees(app, userId, "account_soft_deleted", result);
    return reply.code(200).send(response);
  });

  // POST /accounts/:id/restore — restore a soft-deleted account. On
  // collision with an active account's name, persistence auto-renames to
  // `"{name} (restored)"`, then `" (restored 2)"`, etc. up to 20 attempts;
  // the route returns the resolved final name.
  app.post("/accounts/:id/restore", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const userId = identity.contextUserId;
    const sessionUserId = requireSessionUserId(req);
    const result = await app.persistence.restoreAccount(params.id, userId, {
      actorUserId: sessionUserId,
      ipAddress: req.ip,
      metadata: await buildDelegatedAuditMetadata(req),
    });
    const useAuthoritativeOwnerPreference = identity.sessionUserId === identity.contextUserId;
    const response = await buildAccountLifecycleResponse(
      app,
      result,
      identity.sessionUserId,
      useAuthoritativeOwnerPreference,
    );
    await publishLifecycleEventToOwnerAndActiveGrantees(app, userId, "account_restored", result);
    return response;
  });

  // POST /accounts/:id/purge — typed-name confirmation hard-purge. Accepts
  // active OR soft-deleted accounts (mustBeSoftDeleted=false). Mirrors the
  // admin hard-purge-user typed-name UX. Cron path uses mustBeSoftDeleted=true.
  app.post("/accounts/:id/purge", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({ confirmationName: z.string().min(1).max(80) }).parse(req.body);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const userId = identity.contextUserId;
    const sessionUserId = requireSessionUserId(req);

    const account = await app.persistence.getAccountIncludingDeleted(params.id, userId);
    if (!account) throw routeError(404, "account_not_found", "Account not found.");
    if (account.name !== body.confirmationName) {
      throw routeError(
        400,
        "confirmation_name_mismatch",
        "Confirmation name does not match the account name.",
      );
    }
    // ui-enhancement scope-grill Q4 — typed-name "Permanently delete now"
    // applies to active accounts too (skip-wait shortcut per Mockup C).
    // `mustBeSoftDeleted: false` is INTENTIONAL — not a bug. The cron path
    // separately calls hardPurgeAccount with `mustBeSoftDeleted: true`.
    const result = await app.persistence.hardPurgeAccount(
      params.id,
      userId,
      {
        actorUserId: sessionUserId,
        ipAddress: req.ip,
        metadata: await buildDelegatedAuditMetadata(req),
      },
      { mustBeSoftDeleted: false },
    );
    const response = await buildAccountLifecycleResponse(
      app,
      result,
      identity.sessionUserId,
      identity.sessionUserId === identity.contextUserId,
    );
    await publishLifecycleEventToOwnerAndActiveGrantees(app, userId, "account_hard_purged", result);
    return response;
  });

  // GET /accounts/deleted — list soft-deleted accounts for "Recently deleted".
  app.get("/accounts/deleted", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return app.persistence.listSoftDeletedAccounts(userId);
  });

  app.post("/fx-transfers/estimate", async (req) => {
    const body = fxTransferSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      return await estimateFxTransfer(app.persistence, userId, body);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.post("/fx-transfers", async (req) => {
    const body = fxTransferSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      const result = await createFxTransfer(app.persistence, userId, body);
      await publishFxTransferRecompute(app, userId, result.cashBalanceChanges);
      return stripFxTransferSideEffects(result);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.patch("/fx-transfers/:id", async (req) => {
    const params = fxTransferParamsSchema.parse(req.params);
    const body = fxTransferUpdateSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      const result = await updateFxTransfer(app.persistence, userId, params.id, body);
      await publishFxTransferRecompute(app, userId, result.cashBalanceChanges);
      return stripFxTransferSideEffects(result);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.post("/fx-transfers/:id/reverse", async (req) => {
    const params = fxTransferParamsSchema.parse(req.params);
    const body = fxTransferReverseSchema.parse(req.body ?? {});
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    try {
      const result = await reverseFxTransfer(app.persistence, userId, params.id, body);
      await publishFxTransferRecompute(app, userId, result.cashBalanceChanges);
      return stripFxTransferSideEffects(result);
    } catch (error) {
      rethrowFxTransferError(error);
    }
  });

  app.get("/fee-profiles", async (req) => {
    const query = z
      .object({
        account_id: userScopedIdSchema.optional(),
      })
      .parse(req.query);
    const { store } = await loadUserStore(app, req);
    if (!query.account_id) {
      return store.feeProfiles;
    }
    if (!store.accounts.some((account) => account.id === query.account_id)) {
      throw routeError(404, "account_not_found", `Account ${query.account_id} was not found.`);
    }
    return store.feeProfiles.filter((profile) => profile.accountId === query.account_id);
  });

  app.post("/fee-profiles", async (req) => {
    // KZO-183: fee profiles are now account-scoped — `accountId` is required.
    const body = feeProfilePayloadSchema
      .extend({ accountId: userScopedIdSchema })
      .parse(req.body);

    const { store } = await loadUserStore(app, req);

    if (!store.accounts.some((account) => account.id === body.accountId)) {
      throw routeError(404, "account_not_found", `Account ${body.accountId} was not found.`);
    }

    const { accountId, ...rest } = body;
    const profile: FeeProfile = {
      id: randomUUID(),
      accountId,
      ...rest,
    };

    store.feeProfiles.push(profile);
    await app.persistence.saveStore(store);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "fee_profile_created",
      routeKey: "POST /fee-profiles",
      accountId,
      feeProfileId: profile.id,
    });
    return profile;
  });

  app.patch("/fee-profiles/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = feeProfilePayloadSchema.parse(req.body);

    const { store } = await loadUserStore(app, req);
    const profile = requireProfile(store, params.id);

    Object.assign(profile, body);
    await app.persistence.saveStore(store);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "fee_profile_updated",
      routeKey: "PATCH /fee-profiles/:id",
      accountId: profile.accountId,
      feeProfileId: profile.id,
    });
    return profile;
  });

  app.delete("/fee-profiles/:id", async (req) => {
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const { store } = await loadUserStore(app, req);

    const target = store.feeProfiles.find((profile) => profile.id === params.id);
    if (!target) {
      throw routeError(404, "fee_profile_not_found", `Fee profile ${params.id} was not found.`);
    }

    // KZO-183: must_keep_one_profile is now per-account. Each account must
    // retain at least one profile so the composite-FK ownership invariant
    // holds.
    const profilesForAccount = store.feeProfiles.filter((profile) => profile.accountId === target.accountId);
    if (profilesForAccount.length <= 1) {
      throw routeError(400, "must_keep_one_profile", "Each account must keep at least one fee profile.");
    }

    const isDefaultInUse = store.accounts.some((account) => account.feeProfileId === params.id);
    const isOverrideInUse = store.feeProfileBindings.some((binding) => binding.feeProfileId === params.id);
    const isTransactionInUse = listTradeEvents(store).some((tx) => tx.feeSnapshot.id === params.id);
    if (isDefaultInUse || isOverrideInUse || isTransactionInUse) {
      throw routeError(
        409,
        "fee_profile_in_use",
        "Fee profile is still used by accounts, bindings, or historical transactions.",
      );
    }

    store.feeProfiles = store.feeProfiles.filter((profile) => profile.id !== params.id);
    await app.persistence.saveStore(store);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "fee_profile_deleted",
      routeKey: "DELETE /fee-profiles/:id",
      accountId: target.accountId,
      feeProfileId: params.id,
    });
    return { deletedId: params.id };
  });

  app.get("/fee-profile-bindings", async (req) => {
    const { store } = await loadUserStore(app, req);
    return store.feeProfileBindings;
  });

  app.put("/fee-profile-bindings", async (req) => {
    const body = z.object({ bindings: z.array(feeBindingSchema).max(500) }).parse(req.body);
    const { store } = await loadUserStore(app, req);

    const normalizedBindings = normalizeBindings(body.bindings);
    ensureBindingsAreValid(store, normalizedBindings);

    store.feeProfileBindings = normalizedBindings;
    assertStoreIntegrity(store);
    await app.persistence.saveStore(store);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "fee_profile_bindings_updated",
      routeKey: "PUT /fee-profile-bindings",
      bindingCount: normalizedBindings.length,
    });
    return store.feeProfileBindings;
  });

  app.get("/market-data/price", async (req, reply) => {
    // Authenticate-only: this route has no per-user state. The resolveUserId
    // call throws on missing/invalid auth in oauth mode, then we discard the id.
    resolveUserId(req, app.oauthConfig?.sessionSecret);
    assertMarketDataPriceRateLimit(req.ip);

    // KZO-170 S7: clients now pin `marketCode` explicitly. The previous `resolveMarketCode(ticker)`
    // heuristic returned `'TW'` for every ticker — fine when the codebase only knew TW, but
    // structurally wrong now that US/AU markets exist. Web callers (`fetchMarketDataPrice`)
    // pass `marketCode` from the form's account-derived market.
    const query = z.object({
      ticker: tickerSchema,
      date: isoDateSchema,
      market_code: marketCodeSchema,
    }).parse(req.query);

    if (query.date > todayIsoDate()) {
      throw routeError(400, "invalid_date", "date must not be in the future");
    }

    // KZO-191: resolve once, thread into both response builders. Replaces the
    // weekend-only `isWeekendIsoDate` helper with the market-aware calendar.
    const requestedDateIsTradingDay = await app.tradingCalendarCache.isTradingDay(
      query.market_code,
      query.date,
    );

    const lookbackStartDate = daysBeforeIsoDate(query.date, 7);
    const storedBars = await app.persistence.getDailyBarsForTickerMarket(
      query.ticker,
      query.market_code,
      lookbackStartDate,
      query.date,
    );
    const storedMatch = findMostRecentBar(storedBars, query.date);
    if (storedMatch) {
      return buildPriceLookupResponse(storedMatch, query.date, requestedDateIsTradingDay);
    }

    // KZO-163: route through the per-market provider registry. The provider's internal rate
    // limiter throws RateLimitedError when the shared FinMind budget is exhausted; surface
    // that as 503 + Retry-After so clients can back off intelligently. Distinct from the
    // per-IP 429 emitted by `assertMarketDataPriceRateLimit` above. (N8 behavioral delta.)
    const market = query.market_code;
    const provider = app.marketDataRegistry.marketData.get(market);
    if (!provider) {
      throw routeError(404, "price_not_found", "price not found");
    }

    let fetchedBars: DailyBar[];
    try {
      const rawBars = await provider.fetchBars(query.ticker, lookbackStartDate, query.date);
      fetchedBars = rawBars
        .filter((bar) => bar.barDate >= lookbackStartDate && bar.barDate <= query.date)
        .sort((left, right) => left.barDate.localeCompare(right.barDate))
        .map((bar) => ({
          ...bar,
          quality: "full_bar" as const,
          // KZO-163 D7: forward provider's sourceId so KZO-164/170 providers report correctly.
          // Today every TW bar has sourceId='finmind'; the fallback preserves that behavior.
          source: bar.sourceId ?? "finmind",
          ingestedAt: new Date().toISOString(),
        }));
    } catch (err) {
      if (err instanceof RateLimitedError) {
        reply.header("Retry-After", String(err.retryAfterSeconds));
        throw routeError(503, "provider_rate_limited", "market data provider rate limit exceeded");
      }
      throw routeError(404, "price_not_found", "price not found");
    }

    const fetchedMatch = findMostRecentBar(fetchedBars, query.date);
    if (!fetchedMatch) {
      throw routeError(404, "price_not_found", "price not found");
    }

    await opportunisticUpsertDailyBars(app, fetchedBars, market);
    return buildFetchedPriceLookupResponse(fetchedMatch, query.date, requestedDateIsTradingDay);
  });

  /**
   * KZO-172 — bounded autocomplete for instrument lookup. AU is the primary consumer
   * (Yahoo's per-query `search()` over the ASX universe); TW/US implement
   * `searchInstruments` as no-ops (their UI uses the persisted catalog dump). KZO-188
   * wires a web-side fallback that calls this endpoint when the catalog returns no
   * matches.
   *
   * Two distinct rate-limit gates per `.claude/rules/service-error-pattern.md`:
   *   - Per-IP 429 (`assertMarketDataSearchRateLimit`) — client identity throttle.
   *   - Per-provider 503 + Retry-After — Yahoo's bounded budget exhausted.
   *
   * Generic upstream failures (e.g. Yahoo HTML breakage per spike issue #967) collapse
   * to 503 + `X-Search-Degraded: true` so the web UI can render a "search temporarily
   * unavailable" affordance without leaking provider internals.
   */
  app.get("/market-data/search", async (req, reply) => {
    resolveUserId(req, app.oauthConfig?.sessionSecret);
    assertMarketDataSearchRateLimit(req.ip);

    const query = z.object({
      // Tight allow-list — alphanumerics + a small set of common name punctuation
      // (`.`, `&`, `'`, `()`, `-`, space). Rejects path-traversal / SQL-meta /
      // NUL / non-ASCII to keep abuse off Yahoo's upstream search.
      q: z.string().trim().min(2).max(50).regex(/^[A-Za-z0-9 .&'()-]+$/),
      market_code: marketCodeSchema,
    }).parse(req.query);

    const provider = app.marketDataRegistry.catalog.get(query.market_code);
    if (!provider) {
      throw routeError(404, "market_not_supported", "market not supported");
    }

    if (query.market_code === "JP") {
      const catalogMatches = await app.persistence.listInstrumentsCatalog(query.q, undefined, "JP");
      if (catalogMatches.length > 0) {
        return {
          instruments: catalogMatches.map((row) => ({
            ticker: row.ticker,
            name: row.name,
            instrumentType: row.instrumentType ?? classifyInstrument(null, row.ticker, "JP"),
            sector: row.sector,
            marketCode: "JP" as const,
            barsBackfillStatus: row.barsBackfillStatus,
            lastRepairAt: row.lastRepairAt,
            repairAvailableAt: null,
          })),
        };
      }
    }

    let raws: Awaited<ReturnType<typeof provider.searchInstruments>>;
    try {
      raws = await provider.searchInstruments(query.q);
    } catch (err) {
      if (err instanceof RateLimitedError) {
        reply.header("Retry-After", String(err.retryAfterSeconds));
        throw routeError(503, "provider_rate_limited", "market data search rate limit exceeded");
      }
      app.log.warn({ err, q: query.q, market: query.market_code }, "search_provider_error");
      reply.header("X-Search-Degraded", "true");
      throw routeError(503, "search_unavailable", "search temporarily unavailable");
    }

    return {
      instruments: raws.map((r) => ({
        ticker: r.ticker,
        name: r.name,
        instrumentType: classifyInstrument(r.industryCategory, r.ticker, query.market_code),
        sector: null,
        marketCode: query.market_code,
        // Search results are upstream candidates, not yet persisted catalog rows.
        // The DTO requires these fields; null/"pending" are the truthful defaults
        // (the actual catalog row, if any, is reachable via `/instruments/catalog`).
        barsBackfillStatus: "pending" as const,
        lastRepairAt: null,
        repairAvailableAt: null,
      })),
    };
  });

  app.post("/portfolio/transactions", async (req) => {
    const body = transactionSchema.parse(req.body);

    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      throw routeError(400, "idempotency_key_required", "idempotency-key header required");
    }

    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const claimed = await app.persistence.claimIdempotencyKey(userId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }

    let tx;
    let transactionReplaySummary: Awaited<ReturnType<typeof replayPositionHistory>>;
    try {
      const committed = await app.persistence.withTransactionWriteLock(
        userId,
        async (writer) => {
          const latestStore = await writer.loadStore(userId);
          const draftStore = structuredClone(latestStore);
          assertStoreIntegrity(draftStore);

          const account = draftStore.accounts.find((item) => item.id === body.accountId);
          if (!account) {
            throw routeError(404, "account_not_found", "Account not found");
          }
          const tradeCurrency = currencyFor(body.marketCode);
          if (account.defaultCurrency !== tradeCurrency) {
            throw routeError(
              400,
              "currency_mismatch",
              `Trade currency ${tradeCurrency} does not match account currency ${account.defaultCurrency}`,
            );
          }

          const persistedInstrument = await writer.getInstrument(body.ticker, body.marketCode);
          if (persistedInstrument) {
            setStoreInstruments(
              draftStore,
              upsertInstrumentDefinitions(draftStore.instruments, [{
                ticker: persistedInstrument.ticker,
                type: persistedInstrument.instrumentType ?? null,
                marketCode: persistedInstrument.marketCode,
                isProvisional: persistedInstrument.isProvisional,
                lastSyncedAt: null,
              }]),
            );
          }

          const ensured = ensureInstrumentDefinition(draftStore, body.ticker, body.marketCode);
          if (ensured.instrument.type === null) {
            throw routeError(400, "unclassified_instrument", "Cannot create trades for unclassified instruments");
          }
          if (ensured.created) {
            await writer.upsertInstruments(userId, [ensured.instrument]);
          }

          const transactionInput = {
            ...body,
            id: randomUUID(),
            feesSource: body.commissionAmount !== undefined || body.taxAmount !== undefined
              ? "MANUAL" as const
              : "CALCULATED" as const,
          };

          if (body.type === "SELL") {
            const candidateTx = buildTransactionRecord(draftStore, userId, transactionInput);
            const availability = resolveSellAvailability(draftStore, userId, {
              accountId: body.accountId,
              ticker: body.ticker,
              marketCode: body.marketCode,
              tradeDate: body.tradeDate,
              tradeTimestamp: candidateTx.tradeTimestamp,
              bookingSequence: candidateTx.bookingSequence,
            });
            if (availability.status === "unavailable") {
              throw routeError(
                409,
                "sell_availability_unavailable",
                "Sell availability is unavailable for the requested history scope",
                { reason: availability.reason },
              );
            }
            if (availability.availableQuantity < body.quantity) {
              throw routeError(409, "insufficient_quantity", "Insufficient quantity to sell", {
                requestedQuantity: body.quantity,
                availableQuantity: availability.availableQuantity,
              });
            }

            appendTradeEvent(draftStore, candidateTx);
            const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
            await simulation.saveStore(structuredClone(draftStore));
            try {
              const replaySummary = await replayPositionHistory(simulation, userId, candidateTx.accountId, candidateTx.ticker, {
                marketCode: candidateTx.marketCode,
              });
              const replayedStore = await simulation.loadStore(userId);
              assertStoreIntegrity(replayedStore);
              const appliedDividendChanges = await writer.saveReplayedPositionScope(userId, replayedStore.accounting, {
                accountId: candidateTx.accountId,
                ticker: candidateTx.ticker,
                marketCode: candidateTx.marketCode,
                newTradeEventId: candidateTx.id,
                dividendLedgerChanges: replaySummary.dividendLedgerChanges,
              });
              const persistedTx = replayedStore.accounting.facts.tradeEvents.find((trade) => trade.id === candidateTx.id);
              if (!persistedTx) {
                throw new Error(`trade event ${candidateTx.id} missing after replay persistence`);
              }
              return {
                tx: persistedTx,
                replaySummary: { ...replaySummary, dividendLedgerChanges: appliedDividendChanges },
              };
            } catch (error) {
              if (error instanceof ReplayError) {
                throw routeError(
                  409,
                  "sell_availability_unavailable",
                  "Sell availability is unavailable for the requested history scope",
                  { reason: "unreplayable_history" },
                );
              }
              throw error;
            }
          }

          try {
            const candidateTx = createTransaction(draftStore, userId, transactionInput);
            const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
            await simulation.saveStore(structuredClone(draftStore));
            const replaySummary = await replayPositionHistory(
              simulation,
              userId,
              candidateTx.accountId,
              candidateTx.ticker,
              { marketCode: candidateTx.marketCode },
            );
            const replayedStore = await simulation.loadStore(userId);
            assertStoreIntegrity(replayedStore);
            const appliedDividendChanges = await writer.saveReplayedPositionScope(userId, replayedStore.accounting, {
              accountId: candidateTx.accountId,
              ticker: candidateTx.ticker,
              marketCode: candidateTx.marketCode,
              newTradeEventId: candidateTx.id,
              dividendLedgerChanges: replaySummary.dividendLedgerChanges,
            });
            return {
              tx: candidateTx,
              replaySummary: { ...replaySummary, dividendLedgerChanges: appliedDividendChanges },
            };
          } catch (error) {
            if (error instanceof ReplayError) {
              throw routeError(
                409,
                "position_history_unreplayable",
                "Position history is unavailable for replay",
                { reason: "unreplayable_history" },
              );
            }
            throw error;
          }
        },
      );
      tx = committed.tx;
      transactionReplaySummary = committed.replaySummary;
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(userId, idempotencyKey);
      throw error;
    }
    await appendDelegatedWriteAudit(app, req, {
      mutation: "transaction_created",
      routeKey: "POST /portfolio/transactions",
      tradeEventId: tx.id,
      accountId: tx.accountId,
      ticker: tx.ticker,
      marketCode: tx.marketCode,
    });

    scheduleCommittedReplayFollowUp(app.persistence, app.eventBus, userId, transactionReplaySummary, {
      snapshotFromDate: tx.tradeDate,
      marketCode: tx.marketCode,
    });

    // KZO-126: First-trade backfill trigger
    if (app.boss && !isDemo) {
      // KZO-169/KZO-197: lookup by composite (ticker, marketCode); singletonKey
      // uses the canonical helper so market and KR repair scopes stay distinct.
      const instrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
      // Skip if ticker not in catalog, or already ready
      if (instrument && instrument.barsBackfillStatus !== "ready") {
        await app.boss.send(
          BACKFILL_QUEUE,
          {
            ticker: body.ticker,
            marketCode: body.marketCode,
            userId,
            trigger: "first_trade",
          } satisfies BackfillJobData,
          { singletonKey: getBackfillSingletonKey(body.ticker, body.marketCode), priority: 0 },
        );
      }
    }

    return tx;
  });

  app.get("/portfolio/transactions/sell-availability", async (req) => {
    const query = sellAvailabilityQuerySchema.parse(req.query);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const store = await app.persistence.loadStore(userId);
    const bookingSequence = resolveBookingSequence(store, query.accountId, query.tradeDate, query.bookingSequence);
    return resolveSellAvailability(store, userId, {
      ...query,
      bookingSequence,
    });
  });

  app.post("/portfolio/transactions/estimate", async (req) => {
    const body = z.object({
      ticker: tickerSchema,
      // KZO-169 (G2): estimate body now requires marketCode so the trade
      // currency derives from the instrument's market_code via currencyFor().
      // Replaces the previous fee-profile-currency derivation.
      marketCode: marketCodeSchema,
      quantity: z.number().int().positive(),
      unitPrice: z.number().positive().multipleOf(0.01),
      type: z.enum(["BUY", "SELL"]),
      isDayTrade: z.boolean().default(false),
      accountId: userScopedIdSchema,
    }).parse(req.body);

    const { store } = await loadUserStore(app, req);
    const account = store.accounts.find((item) => item.id === body.accountId);
    if (!account) {
      throw routeError(404, "account_not_found", "Account not found");
    }

    // KZO-169: resolve instrument by composite (ticker, marketCode); fall
    // back to a STOCK assumption when the catalog row is absent (the form
    // can request an estimate before the instrument is committed).
    const instrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
    const marketCode = body.marketCode;
    const instrumentType: InstrumentType = instrument?.instrumentType ?? "STOCK";
    const profile = resolveTransactionFeeProfile(store, account.id, body.ticker);
    // KZO-169 (D3): trade currency derives from instrument.market_code via
    // `currencyFor()`. The previous `profile.commissionCurrency ?? "TWD"`
    // was a provider-stamping audit (G1) target.
    const tradeCurrency = currencyFor(marketCode);
    if (account.defaultCurrency !== tradeCurrency) {
      throw routeError(
        400,
        "currency_mismatch",
        `Trade currency ${tradeCurrency} does not match account currency ${account.defaultCurrency}`,
      );
    }
    const commissionCurrency = profile.commissionCurrency ?? "TWD";
    if (commissionCurrency !== tradeCurrency) {
      throw routeError(
        400,
        "currency_mismatch",
        `Trade currency ${tradeCurrency} does not match fee profile commission currency ${commissionCurrency}`,
      );
    }
    const tradeValueAmount = roundToDecimal(body.quantity * body.unitPrice, 2);

    const fees = body.type === "BUY"
      ? calculateBuyFees(profile, tradeValueAmount, tradeCurrency)
      : calculateSellFees(profile, {
          tradeValueAmount,
          tradeCurrency,
          instrumentType,
          isDayTrade: body.isDayTrade,
          marketCode,
        });

    return {
      commissionAmount: fees.commissionAmount,
      taxAmount: fees.taxAmount,
    };
  });

  // --- Transaction Mutation Routes (KZO-114) ---

  const patchTransactionSchema = z.object({
    date: isoDateSchema.optional(),
    quantity: z.number().int().positive().optional(),
    price: z.number().positive().multipleOf(0.01).optional(),
    side: z.enum(["BUY", "SELL"]).optional(),
    isDayTrade: z.boolean().optional(),
    commissionAmount: bookedChargeFieldSchema("Commission").optional(),
    taxAmount: bookedChargeFieldSchema("Tax").optional(),
    confirmFeeRecalculation: z.boolean().optional(),
    keepManualFees: z.boolean().optional(),
  }).refine(
    (data) =>
      data.date !== undefined
      || data.quantity !== undefined
      || data.price !== undefined
      || data.side !== undefined
      || data.isDayTrade !== undefined
      || data.commissionAmount !== undefined
      || data.taxAmount !== undefined,
    { message: "At least one field must be provided" },
  );

  const destructivePreviewReasonSchema = z.object({
    reason: z.string().trim().min(1).max(500),
  });
  const destructiveConfirmSchema = z.object({
    previewId: userScopedIdSchema,
    previewVersion: z.coerce.number().int().positive(),
    fingerprint: z.string().trim().min(16).max(128),
  });
  const deleteTransactionAliasSchema = z.object({
    previewId: userScopedIdSchema.optional(),
    previewVersion: z.coerce.number().int().positive().optional(),
    fingerprint: z.string().trim().min(16).max(128).optional(),
  });

  function scheduleDestructiveSnapshotRebuild(
    userId: string,
    scopes: Array<{ accountId: string; ticker: string; marketCode: string; fromDate: string }>,
  ): void {
    if (scopes.length === 0) return;
    const generationRunId = randomUUID();
    setImmediate(async () => {
      try {
        const results = [];
        for (const scope of scopes) {
          results.push(await recomputeSnapshotsForTicker(
            userId,
            scope.accountId,
            scope.ticker,
            scope.fromDate,
            app.persistence,
            scope.marketCode as SharedMarketCode,
          ));
        }
        if (app.boss) {
          for (const result of results) {
            for (const { ticker, marketCode } of result.tickersNeedingBackfill) {
              try {
                await app.boss.send(
                  BACKFILL_QUEUE,
                  {
                    ticker,
                    marketCode: marketCode as BackfillJobData["marketCode"],
                    trigger: "first_trade",
                    includeBars: true,
                  } satisfies BackfillJobData,
                  { singletonKey: getBackfillSingletonKey(ticker, marketCode) },
                );
              } catch {
                // Provisional snapshots remain usable when the backfill queue is unavailable.
              }
            }
          }
        }
        await app.eventBus.publishEvent(userId, "snapshots_generated", {
          status: "ok",
          totalRows: results.reduce((sum, result) => sum + result.totalRows, 0),
          provisionalRows: results.reduce((sum, result) => sum + result.provisionalRows, 0),
          dateRange: null,
          generationRunId,
          trigger: "dividend_destructive_replay",
          scopes: scopes.map(({ accountId, ticker, marketCode }) => ({ accountId, ticker, marketCode })),
        });
        try {
          await generateCurrencyWalletSnapshots(userId, app.persistence);
        } catch (walletError) {
          const walletMessage = walletError instanceof Error ? walletError.message : String(walletError);
          console.error("[dividend-destructive-confirm:wallet] Failed:", walletMessage);
          try {
            await app.eventBus.publishEvent(userId, "wallet_generation_failed", { error: walletMessage });
          } catch { /* best effort */ }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[dividend-destructive-confirm:snapshots] Failed:", message);
        try {
          await app.eventBus.publishEvent(userId, "snapshots_generated", {
            status: "error",
            totalRows: 0,
            provisionalRows: 0,
            dateRange: null,
            generationRunId,
            error: message,
            trigger: "dividend_destructive_replay",
            scopes: scopes.map(({ accountId, ticker, marketCode }) => ({ accountId, ticker, marketCode })),
          });
        } catch { /* best effort */ }
      }
    });
  }

  function isRouteErrorCode(error: unknown, code: string): error is Error & { code: string } {
    return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === code;
  }

  app.post("/portfolio/transactions/:tradeEventId/dividend-delete-preview", async (req) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const body = destructivePreviewReasonSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    requireDelegatedDividendWriteForHistoryRewrite(
      sharedContext,
      "POST /portfolio/transactions/:tradeEventId/dividend-delete-preview",
    );
    return previewTradeDividendDeletion(app.persistence, {
      ownerUserId: userId,
      actorUserId: sharedContext?.sessionUserId ?? userId,
      tradeEventId,
      reason: body.reason,
      ipAddress: req.ip,
    });
  });

  app.post("/portfolio/transactions/:tradeEventId/dividend-delete-confirm", async (req) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const body = destructiveConfirmSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    requireDelegatedDividendWriteForHistoryRewrite(
      sharedContext,
      "POST /portfolio/transactions/:tradeEventId/dividend-delete-confirm",
    );
    const result = await confirmTradeDividendDeletion(app.persistence, {
      ownerUserId: userId,
      actorUserId: sharedContext?.sessionUserId ?? userId,
      previewId: body.previewId,
      previewVersion: body.previewVersion,
      fingerprint: body.fingerprint,
      tradeEventId,
      ipAddress: req.ip,
    });
    scheduleDestructiveSnapshotRebuild(userId, result.operation.replayScopes);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "dividend_trade_delete_confirmed",
      routeKey: "POST /portfolio/transactions/:tradeEventId/dividend-delete-confirm",
      previewId: body.previewId,
      accountId: result.preview.accountId,
      tradeEventId: result.preview.targetTradeEventId,
    });
    return result;
  });

  app.delete("/portfolio/transactions/:tradeEventId", async (req, reply) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const body = deleteTransactionAliasSchema.parse(req.body ?? {});
    if (!body.previewId || !body.previewVersion || !body.fingerprint) {
      throw routeError(
        409,
        "dividend_destructive_preview_required",
        "Transaction deletion now requires a dividend delete preview and confirm token.",
      );
    }
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    requireDelegatedDividendWriteForHistoryRewrite(
      sharedContext,
      "DELETE /portfolio/transactions/:tradeEventId",
    );
    const actorUserId = sharedContext?.sessionUserId ?? userId;
    const mutationPreview = await app.persistence.getPostedTransactionMutationPreview(body.previewId);
    if (!mutationPreview) {
      const result = await confirmTradeDividendDeletion(app.persistence, {
        ownerUserId: userId,
        actorUserId,
        previewId: body.previewId,
        previewVersion: body.previewVersion,
        fingerprint: body.fingerprint,
        tradeEventId,
        ipAddress: req.ip,
      });
      scheduleDestructiveSnapshotRebuild(userId, result.operation.replayScopes);
      await appendDelegatedWriteAudit(app, req, {
        mutation: "dividend_trade_delete_confirmed",
        routeKey: "DELETE /portfolio/transactions/:tradeEventId",
        previewId: body.previewId,
        accountId: result.preview.accountId,
        tradeEventId: result.preview.targetTradeEventId,
      });
      reply.code(200);
      return result;
    }
    const preview = await getPostedTransactionMutationPreview(app.persistence, {
      ownerUserId: userId,
      actorUserId,
      previewId: body.previewId,
      appBaseUrl: app.appBaseUrl,
    });
    if (
      preview.operation !== "delete"
      || preview.page.total !== 1
      || preview.page.items[0]?.transactionId !== tradeEventId
    ) {
      throw routeError(
        409,
        "posted_transaction_mutation_target_mismatch",
        "The deletion preview does not match the transaction in this request.",
      );
    }
    const result = await confirmPostedTransactionMutation(app.persistence, {
      ownerUserId: userId,
      actorUserId,
      appBaseUrl: app.appBaseUrl,
      confirmation: {
        previewId: body.previewId,
        previewVersion: body.previewVersion,
        operation: "delete",
        fingerprint: body.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    }, { eventBus: app.eventBus });
    await dispatchPostedTransactionMutationRebuild(app.persistence, {
      ownerUserId: userId,
      runId: result.runId,
      boss: app.boss ?? undefined,
      eventBus: app.eventBus,
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "dividend_trade_delete_confirmed",
      routeKey: "DELETE /portfolio/transactions/:tradeEventId",
      previewId: body.previewId,
      accountId: preview.page.items[0]?.before?.accountId ?? null,
      tradeEventId,
    });
    reply.code(200);
    return {
      accountId: preview.page.items[0]?.before?.accountId ?? null,
      ticker: preview.page.items[0]?.before?.ticker ?? null,
      deletedTradeEventId: tradeEventId,
      deletedChildRows: {
        cashLedgerEntries: Math.abs(result.summary.cashDelta) > 0 ? 1 : 0,
        lotAllocations: 0,
      },
    };
  });

  app.post("/portfolio/accounts/:accountId/purge-rebuild-preview", async (req) => {
    const { accountId } = z.object({ accountId: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      cutoffDate: isoDateSchema,
      reason: z.string().trim().min(1).max(500),
    }).parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    requireDelegatedDividendWriteForHistoryRewrite(
      sharedContext,
      "POST /portfolio/accounts/:accountId/purge-rebuild-preview",
    );
    return previewAccountCutoffPurge(app.persistence, {
      ownerUserId: userId,
      actorUserId: sharedContext?.sessionUserId ?? userId,
      accountId,
      cutoffDate: body.cutoffDate,
      reason: body.reason,
      ipAddress: req.ip,
    });
  });

  app.post("/portfolio/accounts/:accountId/purge-rebuild-confirm", async (req) => {
    const { accountId } = z.object({ accountId: userScopedIdSchema }).parse(req.params);
    const body = destructiveConfirmSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    requireDelegatedDividendWriteForHistoryRewrite(
      sharedContext,
      "POST /portfolio/accounts/:accountId/purge-rebuild-confirm",
    );
    const result = await confirmAccountCutoffPurge(app.persistence, {
      ownerUserId: userId,
      actorUserId: sharedContext?.sessionUserId ?? userId,
      previewId: body.previewId,
      previewVersion: body.previewVersion,
      fingerprint: body.fingerprint,
      accountId,
      ipAddress: req.ip,
    });
    scheduleDestructiveSnapshotRebuild(userId, result.operation.replayScopes);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "dividend_cutoff_purge_confirmed",
      routeKey: "POST /portfolio/accounts/:accountId/purge-rebuild-confirm",
      previewId: body.previewId,
      accountId: result.preview.accountId,
      cutoffDate: result.preview.cutoffDate,
    });
    return result;
  });

  app.patch("/portfolio/transactions/:tradeEventId", async (req, reply) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const body = patchTransactionSchema.parse(req.body);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const userId = identity.contextUserId;
    const sharedContext = await resolveActiveSharedCapabilityContext(req);

    const trade = await app.persistence.getTradeEvent(userId, tradeEventId);
    if (!trade) throw routeError(404, "trade_event_not_found", "Trade event not found");
    const changedFields = Object.entries({
      date: body.date !== undefined && body.date !== trade.tradeDate,
      quantity: body.quantity !== undefined && body.quantity !== trade.quantity,
      price: body.price !== undefined && body.price !== trade.unitPrice,
      side: body.side !== undefined && body.side !== trade.type,
      isDayTrade: body.isDayTrade !== undefined && body.isDayTrade !== trade.isDayTrade,
      commissionAmount: body.commissionAmount !== undefined && body.commissionAmount !== trade.commissionAmount,
      taxAmount: body.taxAmount !== undefined && body.taxAmount !== trade.taxAmount,
    }).filter(([, changed]) => changed).map(([field]) => field);
    const feeSensitiveChange = changedFields.some((field) =>
      field === "quantity" || field === "price" || field === "isDayTrade");
    if (
      feeSensitiveChange
      && !body.keepManualFees
      && !body.confirmFeeRecalculation
      && body.commissionAmount === undefined
      && body.taxAmount === undefined
      && (trade.feesSource === "MANUAL" || trade.feesSource === "SOURCE_PROVIDED")
    ) {
      reply.code(200);
      return {
        requiresFeeConfirmation: true,
        tradeEventId,
      };
    }

    let result;
    try {
      const previewInput = {
        ownerUserId: userId,
        actorUserId: identity.sessionUserId,
        reason: "User requested posted transaction correction",
        appBaseUrl: app.appBaseUrl,
        items: [{
          transactionId: tradeEventId,
          patch: {
            tradeDate: body.date,
            quantity: body.quantity,
            unitPrice: body.price,
            side: body.side,
            isDayTrade: body.isDayTrade,
            commissionAmount: body.commissionAmount,
            taxAmount: body.taxAmount,
            feeOverrideMode: body.confirmFeeRecalculation
              ? "recalculate" as const
              : "preserve_recorded" as const,
          },
        }],
      };
      if (sharedContext && !sharedContext.shareCapabilities.includes("dividend:write")) {
        const simulation = await simulatePostedTransactionUpdateBatch(app.persistence, previewInput);
        if (simulation.summary.deletedDividendCount > 0 || simulation.summary.reopenedDividendCount > 0) {
          requireDelegatedDividendWriteForHistoryRewrite(
            sharedContext,
            "PATCH /portfolio/transactions/:tradeEventId",
          );
        }
      }
      const preview = await previewPostedTransactionUpdateBatch(app.persistence, previewInput);
      result = await confirmPostedTransactionMutation(app.persistence, {
        ownerUserId: userId,
        actorUserId: identity.sessionUserId,
        appBaseUrl: app.appBaseUrl,
        confirmation: {
          previewId: preview.previewId,
          previewVersion: preview.previewVersion,
          operation: "update",
          fingerprint: preview.fingerprint,
          confirmationSummary: preview.confirmationSummary,
          confirmationDigest: preview.confirmationDigest,
        },
      }, { eventBus: app.eventBus });
      await dispatchPostedTransactionMutationRebuild(app.persistence, {
        ownerUserId: userId,
        runId: result.runId,
        boss: app.boss ?? undefined,
        eventBus: app.eventBus,
      });
    } catch (error) {
      if (isRouteErrorCode(error, "posted_transaction_mutation_no_changes")) {
        throw routeError(400, "no_changes", "No changes requested");
      }
      if (isRouteErrorCode(error, "posted_transaction_mutation_inventory_conflict")) {
        try {
          await app.eventBus.publishEvent(userId, "recompute_failed", {
            accountId: trade.accountId,
            ticker: trade.ticker,
            reason: error.message,
            retriesExhausted: true,
          });
        } catch {
          // Event delivery is best-effort.
        }
      }
      throw error;
    }
    try {
      await app.eventBus.publishEvent(userId, "recompute_complete", {
        accountId: trade.accountId,
        ticker: trade.ticker,
        updatedHoldings: null,
        changedFields,
        mutationRunId: result.runId,
      });
    } catch {
      // Event delivery is best-effort.
    }
    await appendDelegatedWriteAudit(app, req, {
      mutation: "transaction_updated",
      routeKey: "PATCH /portfolio/transactions/:tradeEventId",
      tradeEventId,
      accountId: trade.accountId,
      ticker: trade.ticker,
      changedFields,
    });

    reply.code(202);
    return {
      accountId: trade.accountId,
      ticker: trade.ticker,
      updatedTradeEventId: tradeEventId,
      changedFields,
    };
  });

  app.get("/portfolio/transactions/:tradeEventId/preview-impact", async (req) => {
    const { tradeEventId } = z.object({ tradeEventId: userScopedIdSchema }).parse(req.params);
    const query = z.object({
      action: z.enum(["delete", "patch"]),
      quantity: z.coerce.number().int().positive().optional(),
      price: z.coerce.number().int().positive().optional(),
      side: z.enum(["BUY", "SELL"]).optional(),
      date: isoDateSchema.optional(),
    }).parse(req.query);

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const trade = await app.persistence.getTradeEvent(userId, tradeEventId);
    if (!trade) throw routeError(404, "trade_event_not_found", "Trade event not found");
    const effectiveSnapshotFromDate = query.action === "patch" && query.date && query.date < trade.tradeDate
      ? query.date
      : trade.tradeDate;
    const holdingSnapshots = await app.persistence.countHoldingSnapshotsAfterDate(
      userId,
      trade.accountId,
      trade.ticker,
      effectiveSnapshotFromDate,
      trade.marketCode,
    );
    const store = await app.persistence.loadStore(userId);
    const currentOpenQuantity = store.accounting.projections.lots
      .filter((lot) =>
        lot.accountId === trade.accountId
        && lot.ticker === trade.ticker
        && lot.openQuantity > 0)
      .reduce((sum, lot) => sum + lot.openQuantity, 0);
    const currentSignedQuantity = trade.type === "BUY" ? trade.quantity : -trade.quantity;
    const nextSignedQuantity = query.action === "delete"
      ? 0
      : ((query.side ?? trade.type) === "BUY" ? (query.quantity ?? trade.quantity) : -(query.quantity ?? trade.quantity));
    const resultingQuantity = currentOpenQuantity + (nextSignedQuantity - currentSignedQuantity);
    try {
      const preview = query.action === "delete"
        ? await simulatePostedTransactionDeleteBatch(app.persistence, {
            ownerUserId: userId,
            items: [{ transactionId: tradeEventId }],
            reason: "Preview posted transaction deletion impact",
            appBaseUrl: app.appBaseUrl,
          })
        : await simulatePostedTransactionUpdateBatch(app.persistence, {
            ownerUserId: userId,
            reason: "Preview posted transaction correction impact",
            appBaseUrl: app.appBaseUrl,
            items: [{
              transactionId: tradeEventId,
              patch: {
                tradeDate: query.date,
                quantity: query.quantity,
                unitPrice: query.price,
                side: query.side,
              },
            }],
          });
      return {
        affectedRows: {
          cashLedgerEntries: Math.abs(preview.summary.cashDelta) > 0 ? 1 : 0,
          lotAllocations: 0,
          feePolicySnapshots: 1,
          holdingSnapshots,
        },
        negativeLots: {
          wouldOccur: resultingQuantity < 0 || preview.blockers.length > 0,
          resultingQuantity,
          ticker: trade.ticker,
        },
        ...(preview.blockers.length > 0 ? { blockers: preview.blockers } : {}),
      };
    } catch (error) {
      if (!isRouteErrorCode(error, "posted_transaction_mutation_inventory_conflict")) throw error;
      return {
        affectedRows: {
          cashLedgerEntries: 1,
          lotAllocations: 0,
          feePolicySnapshots: 1,
          holdingSnapshots,
        },
        negativeLots: {
          wouldOccur: true,
          resultingQuantity,
          ticker: trade.ticker,
        },
        blockers: [error.message],
      };
    }
  });

  app.post("/portfolio/transactions/mutations/update-preview", async (req) => {
    const body = z.object({
      reason: z.string().trim().min(1).max(500),
      items: z.array(z.object({
        transactionId: userScopedIdSchema,
        note: z.string().trim().max(500).optional(),
        patch: z.object({
          tradeDate: isoDateSchema.optional(),
          quantity: z.number().int().positive().optional(),
          unitPrice: z.number().positive().multipleOf(0.01).optional(),
          side: z.enum(["BUY", "SELL"]).optional(),
          isDayTrade: z.boolean().optional(),
          commissionAmount: z.number().min(0).optional(),
          taxAmount: z.number().min(0).optional(),
          feeOverrideMode: z.enum(["preserve_recorded", "recalculate"]).optional(),
        }).strict(),
      }).strict()).min(1),
    }).parse(req.body);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const previewInput = {
      ownerUserId: identity.contextUserId,
      actorUserId: identity.sessionUserId,
      items: body.items,
      reason: body.reason,
      appBaseUrl: app.appBaseUrl,
    };
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    if (sharedContext && !sharedContext.shareCapabilities.includes("dividend:write")) {
      const simulation = await simulatePostedTransactionUpdateBatch(app.persistence, previewInput);
      if (simulation.summary.deletedDividendCount > 0 || simulation.summary.reopenedDividendCount > 0) {
        requireDelegatedDividendWriteForHistoryRewrite(
          sharedContext,
          "POST /portfolio/transactions/mutations/update-preview",
        );
      }
    }
    return previewPostedTransactionUpdateBatch(app.persistence, previewInput);
  });

  app.post("/portfolio/transactions/mutations/delete-preview", async (req) => {
    const body = z.object({
      reason: z.string().trim().min(1).max(500),
      items: z.array(z.object({
        transactionId: userScopedIdSchema,
        note: z.string().trim().max(500).optional(),
      }).strict()).min(1),
    }).parse(req.body);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const previewInput = {
      ownerUserId: identity.contextUserId,
      actorUserId: identity.sessionUserId,
      items: body.items,
      reason: body.reason,
      appBaseUrl: app.appBaseUrl,
    };
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    if (sharedContext && !sharedContext.shareCapabilities.includes("dividend:write")) {
      const simulation = await simulatePostedTransactionDeleteBatch(app.persistence, previewInput);
      if (simulation.summary.deletedDividendCount > 0 || simulation.summary.reopenedDividendCount > 0) {
        requireDelegatedDividendWriteForHistoryRewrite(
          sharedContext,
          "POST /portfolio/transactions/mutations/delete-preview",
        );
      }
    }
    return previewPostedTransactionDeleteBatch(app.persistence, previewInput);
  });

  app.get("/portfolio/transactions/mutations/previews/:previewId", async (req) => {
    const { previewId } = z.object({ previewId: userScopedIdSchema }).parse(req.params);
    const query = z.object({
      limit: z.coerce.number().int().positive().max(200).optional(),
      offset: z.coerce.number().int().min(0).optional(),
      accountId: userScopedIdSchema.optional(),
      ticker: tickerSchema.optional(),
      marketCode: marketCodeSchema.optional(),
      status: z.enum(["changed", "deleted", "unchanged", "warning", "blocked"]).optional(),
    }).parse(req.query);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return getPostedTransactionMutationPreview(app.persistence, {
      ownerUserId: identity.contextUserId,
      actorUserId: identity.sessionUserId,
      previewId,
      query,
      appBaseUrl: app.appBaseUrl,
    });
  });

  app.post("/portfolio/transactions/mutations/previews/:previewId/confirm", async (req) => {
    const { previewId } = z.object({ previewId: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      previewVersion: z.number().int().positive(),
      operation: z.enum(["update", "delete"]),
      fingerprint: z.string().trim().min(1),
      confirmationSummary: z.string().trim().min(1),
      confirmationDigest: z.string().trim().min(1),
    }).parse(req.body);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const sharedContext = await resolveActiveSharedCapabilityContext(req);
    if (sharedContext) {
      const preview = await getPostedTransactionMutationPreview(app.persistence, {
        ownerUserId: identity.contextUserId,
        actorUserId: identity.sessionUserId,
        previewId,
        appBaseUrl: app.appBaseUrl,
      });
      if (preview.summary.deletedDividendCount > 0 || preview.summary.reopenedDividendCount > 0) {
        requireDelegatedDividendWriteForHistoryRewrite(
          sharedContext,
          "POST /portfolio/transactions/mutations/previews/:previewId/confirm",
        );
      }
    }
    let result = await confirmPostedTransactionMutation(app.persistence, {
      ownerUserId: identity.contextUserId,
      actorUserId: identity.sessionUserId,
      appBaseUrl: app.appBaseUrl,
      confirmation: {
        previewId,
        previewVersion: body.previewVersion,
        operation: body.operation,
        fingerprint: body.fingerprint,
        confirmationSummary: body.confirmationSummary,
        confirmationDigest: body.confirmationDigest,
      },
    }, { eventBus: app.eventBus });
    await dispatchPostedTransactionMutationRebuild(app.persistence, {
      ownerUserId: identity.contextUserId,
      runId: result.runId,
      boss: app.boss ?? undefined,
      eventBus: app.eventBus,
    });
    result = await getPostedTransactionMutationRun(app.persistence, {
      ownerUserId: identity.contextUserId,
      actorUserId: identity.sessionUserId,
      runId: result.runId,
      appBaseUrl: app.appBaseUrl,
    });
    return result;
  });

  app.get("/portfolio/transactions/mutations/runs/:runId", async (req) => {
    const { runId } = z.object({ runId: userScopedIdSchema }).parse(req.params);
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return getPostedTransactionMutationRun(app.persistence, {
      ownerUserId: identity.contextUserId,
      actorUserId: identity.sessionUserId,
      runId,
      appBaseUrl: app.appBaseUrl,
    });
  });

  app.get("/portfolio/transactions", async (req, reply) => {
    const query = z.object({
      ticker: tickerSchema.optional(),
      accountId: userScopedIdSchema.optional(),
      accountIds: z.preprocess(normalizeAccountIdsQueryValue, z.array(userScopedIdSchema).max(50).optional()),
      marketCode: marketCodeSchema.optional(),
      limit: z.coerce.number().int().positive().max(100).optional(),
    }).parse(req.query);
    return withReadPathTiming(req, reply, "/portfolio/transactions", async (timing) => {
      const { store } = await timing.measure("load_store", "db", () => loadUserStore(app, req));
      return timing.measure("map_transactions", "app", () => Promise.resolve(buildTransactionHistoryItems(store, query)));
    });
  });

  app.get("/transactions/history", async (req, reply): Promise<TransactionHistoryPageDto> => {
    const query = z.object({
      type: z.enum(["BUY", "SELL", "ALL"]).default("ALL"),
      pnl: z.enum(["realized", "any"]).default("any"),
      ticker: tickerSchema.optional(),
      accountId: z.union([userScopedIdSchema, z.literal("ALL")]).optional(),
      marketCode: z.enum(MARKET_FILTER_CODES).default("ALL"),
      from: isoDateSchema.optional(),
      to: isoDateSchema.optional(),
      limit: z.coerce.number().int().positive().max(100).default(50),
      offset: z.coerce.number().int().min(0).default(0),
      sortBy: z.enum(["tradeDate", "type", "ticker", "account", "realizedPnl"]).default("tradeDate"),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
    }).superRefine((value, ctx) => {
      if (value.from && value.to && value.from > value.to) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "from must be before or equal to to",
          path: ["from"],
        });
      }
    }).parse(req.query);
    return withReadPathTiming(req, reply, "/transactions/history", async (timing) => {
      const { store } = await timing.measure("load_store", "db", () => loadUserStore(app, req));
      return timing.measure("map_transactions_history", "app", () => Promise.resolve(buildTransactionHistoryPage(store, {
        ...query,
        accountId: query.accountId === "ALL" ? undefined : query.accountId,
        marketCode: query.marketCode === "ALL" ? undefined : query.marketCode,
      })));
    });
  });

  app.get("/transactions/primary", async (req, reply): Promise<TransactionPrimaryDto> => {
    return withReadPathTiming(req, reply, "/transactions/primary", async (timing) => {
      const { store } = await timing.measure("load_store", "db", () => loadUserStore(app, req));
      const [recentTransactions, accountOptions, portfolioConfig] = await Promise.all([
        timing.measure("list_recent_transactions", "app", () =>
          Promise.resolve(buildTransactionHistoryItems(store, { limit: 12 }))),
        timing.measure("map_account_options", "app", () => Promise.resolve(buildTransactionAccountOptions(store))),
        timing.measure("map_portfolio_config", "app", () => Promise.resolve(buildShellPortfolioConfig(store))),
      ]);
      const capabilities = portfolioConfig.capabilities;
      return {
        recentTransactions,
        accountOptions,
        capabilities,
        portfolioConfig,
      };
    });
  });

  app.get("/portfolio/page-data", async (req, reply) => {
    return withReadPathTiming(req, reply, "/portfolio/page-data", async (timing) => {
      const { store, userId } = await timing.measure("load_store", "db", () => loadUserStore(app, req));
      const holdings = await timing.measure("list_holdings", "app", () => Promise.resolve(listHoldings(store, userId)));
      const symbols = [...new Set(
        holdings
          .map((holding) => holding.ticker)
          .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
      )];
      const snapshotMap = await timing.measure("load_quotes", "db", async () => {
        return resolveDisplayedQuoteSnapshotsForHeldPairs(app, store, symbols);
      });
      const quotes = Object.values(snapshotMap).filter((s): s is ResolvedQuoteSnapshot => s !== null);
      const marketStates = await timing.measure("build_market_states", "app", () =>
        buildHeldMarketStatesForStoreHoldings(app, store, holdings, true));
      const summaryAsOf = new Date().toISOString().slice(0, 10);
      const overview = await timing.measure("build_portfolio_page_data", "app", () =>
        Promise.resolve(buildDashboardOverview(store, {
          integrityIssue: null,
          marketStates,
          quotes,
          regularSessionOnly: true,
          summaryAsOf,
        })));
      const holdingGroups = await timing.measure("build_holding_groups", "app", () =>
        Promise.resolve(buildOverviewHoldingGroups(store, overview.holdings)));

      return {
        settings: overview.settings,
        holdings: overview.holdings,
        holdingGroups,
        dividends: overview.dividends,
        instruments: overview.instruments,
        accounts: overview.accounts,
        feeProfiles: overview.feeProfiles,
        feeProfileBindings: overview.feeProfileBindings,
        integrityIssue: getStoreIntegrityIssue(store),
      };
    });
  });

  app.get("/portfolio/primary", async (req, reply) => {
    return withReadPathTiming(req, reply, "/portfolio/primary", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const store = await timing.measure("load_primary_read_store", "db", () => app.persistence.loadPrimaryReadStore(userId));
      const prefs = await timing.measure("load_prefs", "db", () => app.persistence.getUserPreferences(userId));
      const reportingCurrency = resolveReportingCurrency(prefs);
      const holdingAllocationBasis = resolveHoldingAllocationBasis(prefs);
      const primaryHoldings = await timing.measure("list_primary_holdings", "app", () =>
        Promise.resolve(buildPortfolioPrimaryHoldings(store, userId)));
      const holdings = await timing.measure("attach_primary_holding_names", "db", () =>
        attachInstrumentNamesToPrimaryHoldings(store, app.persistence, primaryHoldings));
      const holdingGroups = await timing.measure("build_holding_groups", "app", () =>
        Promise.resolve(buildOverviewHoldingGroups(store, holdings)));
      const asOf = new Date().toISOString();
      const baseTranslatedHoldingGroups = await timing.measure("translate_holding_groups", "db", () =>
        translateOverviewHoldingGroups(
          holdingGroups,
          reportingCurrency,
          holdingAllocationBasis,
          asOf,
          app.persistence,
        ));
      const translatedHoldingGroups = await timing.measure("attach_instrument_names", "db", () => attachInstrumentNamesToHoldingGroups(
        store,
        app.persistence,
        baseTranslatedHoldingGroups,
      ));
      const fxRates = await timing.measure("load_fx_rates", "db", () =>
        buildFxConversionRateRows(
          app.persistence,
          holdings.map((holding) => holding.currency as AccountDefaultCurrency),
          reportingCurrency,
          asOf,
        ));
      const instruments = await timing.measure("map_instruments", "app", () =>
        Promise.resolve(mapPortfolioInstrumentOptions(store)));

      return {
        settings: withTickerPriceFreshnessSettings(store.settings),
        holdings,
        holdingGroups: translatedHoldingGroups,
        fxRates,
        marketValues: buildOverviewMarketValues(translatedHoldingGroups, reportingCurrency),
        dividends: {
          upcoming: [],
          recent: [],
        },
        instruments,
        accounts: store.accounts,
        feeProfiles: store.feeProfiles,
        feeProfileBindings: store.feeProfileBindings,
        integrityIssue: getStoreIntegrityIssue(store),
      };
    });
  });

  app.get("/portfolio/enrichment", async (req, reply) => {
    return withReadPathTiming(req, reply, "/portfolio/enrichment", async (timing) => {
      const { store, userId } = await timing.measure("load_overview_read_store", "db", () => loadOverviewReadStore(app, req));
      const holdings = await timing.measure("list_holdings", "app", () => Promise.resolve(listHoldings(store, userId)));
      const symbols = [...new Set(
        holdings
          .map((holding) => holding.ticker)
          .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
      )];
      const [refreshPending, snapshotMap, prefs] = await timing.measure("quotes_and_prefs", "db", () => Promise.all([
        enqueueDisplayedQuoteRefreshes(app, buildHeldTickerMarketPairsForDisplayedQuotes(store, symbols)),
        resolveDisplayedQuoteSnapshotsForHeldPairs(app, store, symbols, new Date(), { skipEnqueue: true }),
        app.persistence.getUserPreferences(userId),
      ]));
      const quotes = Object.values(snapshotMap).filter((s): s is ResolvedQuoteSnapshot => s !== null);
      const marketStates = await timing.measure("build_market_states", "app", () =>
        buildHeldMarketStatesForStoreHoldings(app, store, holdings, true));
      const summaryAsOf = new Date().toISOString().slice(0, 10);
      const overview = await timing.measure("build_portfolio_enrichment", "app", () =>
        Promise.resolve(buildDashboardOverview(store, {
          integrityIssue: null,
          marketStates,
          quotes,
          regularSessionOnly: true,
          summaryAsOf,
        })));
      const reportingCurrency = resolveReportingCurrency(prefs);
      const holdingAllocationBasis = resolveHoldingAllocationBasis(prefs);
      const holdingGroups = await timing.measure("build_holding_groups", "app", () =>
        Promise.resolve(buildOverviewHoldingGroups(store, overview.holdings)));
      const baseTranslatedHoldingGroups = await timing.measure("translate_holding_groups", "db", () =>
        translateOverviewHoldingGroups(
          holdingGroups,
          reportingCurrency,
          holdingAllocationBasis,
          overview.summary.asOf,
          app.persistence,
        ));
      const translatedHoldingGroups = await timing.measure("attach_instrument_names", "db", () => attachInstrumentNamesToHoldingGroups(
        store,
        app.persistence,
        baseTranslatedHoldingGroups,
      ));
      const fxRates = await timing.measure("load_fx_rates", "db", () =>
        buildFxConversionRateRows(
          app.persistence,
          [
            ...overview.holdings.map((holding) => holding.currency as AccountDefaultCurrency),
            ...overview.dividends.upcoming.map((dividend) => dividend.currency as AccountDefaultCurrency),
          ],
          reportingCurrency,
          overview.summary.asOf,
        ));

      return {
        settings: overview.settings,
        refreshPending,
        holdings: overview.holdings,
        holdingGroups: translatedHoldingGroups,
        fxRates,
        marketValues: buildOverviewMarketValues(translatedHoldingGroups, reportingCurrency),
        dividends: overview.dividends,
        instruments: overview.instruments,
        accounts: overview.accounts,
        feeProfiles: overview.feeProfiles,
        feeProfileBindings: overview.feeProfileBindings,
        integrityIssue: getStoreIntegrityIssue(store),
      };
    });
  });

  app.post("/portfolio/refresh-closes", async (req, reply): Promise<CloseRefreshResult> => {
    const identity = resolveUserId(req, app.oauthConfig?.sessionSecret);
    if (identity.isDemo) {
      throw routeError(403, "demo_restricted", "Close refresh is not available for demo users");
    }
    const { store, userId } = await loadUserStore(app, req);
    assertTickerPriceRefreshCloseRateLimit(`user:${userId}`);
    assertTickerPriceRefreshCloseRateLimit(`ip:${req.ip}`);

    const holdings = listHoldings(store, userId);
    const pairs = buildHeldTickerMarketPairsForCloseRefresh(store, holdings);
    const config = getEffectiveTickerPriceFreshnessConfig();
    const syncPairs = pairs.slice(0, config.syncTickerCap);
    const queuedPairs = pairs.slice(config.syncTickerCap);
    const fallbackProviders = {
      twseStockDay: new TwseStockDayCloseProvider(),
      ...(app.tickerPriceChartRequestBudget
        ? {
            yahooChartClose: new YahooChartCloseProvider({
              range: config.yahooChartRange,
              interval: config.yahooChartInterval,
              persistence: app.persistence,
              requestBudget: app.tickerPriceChartRequestBudget,
            }),
          }
        : {}),
    };

    const result = await (async () => {
      try {
        return await runCloseRefresh({
          pairs: syncPairs,
          persistence: app.persistence,
          activityPersistence: app.persistence,
          tradingCalendar: app.tradingCalendarCache,
          marketDataProviders: app.marketDataRegistry.marketData,
          fallbackProviders,
          upsertBars: (bars, marketCode) => opportunisticUpsertDailyBars(app, bars, marketCode),
          closeRefreshGraceMinutes: config.closeRefreshGraceMinutes,
          supportedMarkets: config.supportedMarkets,
          log: app.log,
        });
      } catch (err) {
        if (err instanceof RateLimitedError) {
          reply.header("Retry-After", String(err.retryAfterSeconds));
          throw routeError(503, "provider_rate_limited", "close refresh provider rate limit exceeded");
        }
        throw err;
      }
    })();

    for (const pair of queuedPairs) {
      if (!app.boss) {
        result.items.push({
          ticker: pair.ticker,
          marketCode: pair.marketCode,
          status: "failed",
          barDate: null,
          source: null,
          quality: null,
          error: "close_refresh_queue_unavailable",
        });
        result.summary.failed += 1;
        continue;
      }
      await enqueueCloseRefresh(app.boss, {
        ticker: pair.ticker,
        marketCode: pair.marketCode,
        requestedAt: new Date().toISOString(),
      });
      result.items.push({
        ticker: pair.ticker,
        marketCode: pair.marketCode,
        status: "queued",
        barDate: null,
        source: null,
        quality: null,
      });
      result.summary.queued += 1;
    }

    reply.header("Cache-Control", "no-store");
    return result;
  });

  app.get("/portfolio/instrument-index", async (req, reply) => {
    return withReadPathTiming(req, reply, "/portfolio/instrument-index", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const instruments = await timing.measure("list_transaction_instruments", "db", () =>
        app.persistence.listTransactionInstrumentOptions(userId));

      return { instruments };
    });
  });

  app.get("/portfolio/holdings", async (req) => {
    const { store, userId } = await loadUserStore(app, req);
    assertStoreIntegrity(store);
    return listHoldings(store, userId);
  });

  app.get("/portfolio/holdings/:ticker/activity-dividends", async (req) => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = holdingActivityDividendsQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const scope = await resolveTickerReadScope({
      persistence: app.persistence,
      store,
      userId,
      ticker: params.ticker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
    });
    return buildHoldingActivityDividends(store, {
      ticker: scope.normalizedTicker,
      marketCode: scope.resolvedMarketCode,
      scopedAccountIds: scope.scopedAccountIds,
      positionActionsPage: query.positionActionsPage,
      positionActionsLimit: query.positionActionsLimit,
      upcomingPage: query.upcomingPage,
      upcomingLimit: query.upcomingLimit,
      postedPage: query.postedPage,
      postedLimit: query.postedLimit,
    });
  });

  app.get("/tickers/:ticker/dividends/upcoming", async (req) => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = tickerDividendListQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const scope = await resolveTickerReadScope({
      persistence: app.persistence,
      store,
      userId,
      ticker: params.ticker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
    });
    return {
      upcomingDividends: buildTickerDividendUpcomingPage(
        store,
        scope.normalizedTicker,
        scope.resolvedMarketCode,
        scope.scopedAccountIds,
        { page: query.page, limit: query.limit },
      ),
    };
  });

  app.get("/tickers/:ticker/dividends/open-reconciliation", async (req) => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = tickerDividendListQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const scope = await resolveTickerReadScope({
      persistence: app.persistence,
      store,
      userId,
      ticker: params.ticker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
    });
    return {
      openReconciliation: buildTickerDividendOpenReconciliationPage(
        store,
        scope.normalizedTicker,
        scope.resolvedMarketCode,
        scope.scopedAccountIds,
        { page: query.page, limit: query.limit },
      ),
    };
  });

  app.get("/tickers/:ticker/dividends/posted-history", async (req) => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = tickerDividendListQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const scope = await resolveTickerReadScope({
      persistence: app.persistence,
      store,
      userId,
      ticker: params.ticker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
    });
    return {
      postedHistory: buildTickerDividendPostedHistoryPage(
        store,
        scope.normalizedTicker,
        scope.resolvedMarketCode,
        scope.scopedAccountIds,
        { page: query.page, limit: query.limit },
      ),
    };
  });

  app.get("/tickers/:ticker/primary", async (req): Promise<TickerPrimaryDto> => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = tickerChartQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const reportingCurrency = resolveReportingCurrency(await app.persistence.getUserPreferences(userId));
    const resolvedTicker = params.ticker.trim().toUpperCase();
    const { details } = await buildTickerDetails({
      persistence: app.persistence,
      store,
      userId,
      ticker: resolvedTicker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
      reportingCurrency,
      includeProvisional: query.includeProvisional,
      range: query.range,
      startDate: query.startDate,
      endDate: query.endDate,
      loadChart: false,
      fundamentalsRecord: null,
      getSettledTradingDay: async (resolvedMarket) => app.tradingCalendarCache.latestSettledTradingDay(resolvedMarket, new Date()),
      tradingCalendar: app.tradingCalendarCache,
      enqueueIntradayRefresh: (pair) => enqueueDisplayedTickerRefresh(app, pair),
    });
    return {
      identity: details.identity,
      quote: details.quote,
      position: details.position,
      unrealizedPnlHistory: details.unrealizedPnlHistory,
      transactions: details.transactions,
      dividends: details.dividends,
      holdingGroup: details.holdingGroup,
      accountBreakdown: details.accountBreakdown,
    };
  });

  app.get("/tickers/:ticker/enrichment", async (req): Promise<TickerEnrichmentDto> => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = tickerChartQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const reportingCurrency = resolveReportingCurrency(await app.persistence.getUserPreferences(userId));
    const resolvedTicker = params.ticker.trim().toUpperCase();
    const preferredMarketCode = query.marketCode
      ?? (query.accountId
        ? (() => {
          const account = store.accounts.find((item) => item.id === query.accountId);
          return account ? marketCodeFor(account.defaultCurrency) : undefined;
        })()
        : undefined);
    const fundamentalsRecord = preferredMarketCode
      ? await app.persistence.getTickerFundamentals(resolvedTicker, preferredMarketCode)
      : null;
    const { details, marketCode } = await buildTickerDetails({
      persistence: app.persistence,
      store,
      userId,
      ticker: resolvedTicker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
      reportingCurrency,
      includeProvisional: query.includeProvisional,
      range: query.range,
      startDate: query.startDate,
      endDate: query.endDate,
      fundamentalsRecord,
      getSettledTradingDay: async (resolvedMarket) => app.tradingCalendarCache.latestSettledTradingDay(resolvedMarket, new Date()),
      tradingCalendar: app.tradingCalendarCache,
      enqueueIntradayRefresh: (pair) => enqueueDisplayedTickerRefresh(app, pair),
    });
    const latestFundamentals = preferredMarketCode === marketCode
      ? fundamentalsRecord
      : await app.persistence.getTickerFundamentals(resolvedTicker, marketCode);
    const response = {
      identity: details.identity,
      chart: details.chart,
      unrealizedPnlHistory: details.unrealizedPnlHistory,
      fundamentals: latestFundamentals?.fundamentals ?? details.fundamentals,
      fundamentalsRefresh: latestFundamentals
        ? {
          providerId: latestFundamentals.providerId,
          refreshedAt: latestFundamentals.refreshedAt,
          nextRefreshAt: latestFundamentals.nextRefreshAt,
          lastAttemptedAt: latestFundamentals.lastAttemptedAt,
          lastError: latestFundamentals.lastError,
          status: !latestFundamentals.refreshedAt
            ? "missing" as const
            : latestFundamentals.nextRefreshAt && latestFundamentals.nextRefreshAt <= new Date().toISOString()
              ? "stale" as const
              : "fresh" as const,
        }
        : details.fundamentalsRefresh,
    };

    scheduleTickerFundamentalsRefresh(
      {
        persistence: app.persistence,
        fundamentalsRegistry: app.fundamentalsRegistry,
        log: app.log,
      },
      {
        ticker: resolvedTicker,
        marketCode,
        current: latestFundamentals ?? fundamentalsRecord,
      },
    );

    return response;
  });

  app.get("/tickers/:ticker/details", async (req) => {
    const params = z.object({ ticker: tickerSchema }).parse(req.params);
    const query = tickerChartQuerySchema.parse(req.query);
    const { store, userId } = await loadUserStore(app, req);
    const reportingCurrency = resolveReportingCurrency(await app.persistence.getUserPreferences(userId));

    const resolvedTicker = params.ticker.trim().toUpperCase();
    const preferredMarketCode = query.marketCode
      ?? (query.accountId
        ? (() => {
          const account = store.accounts.find((item) => item.id === query.accountId);
          return account ? marketCodeFor(account.defaultCurrency) : undefined;
        })()
        : undefined);
    const fundamentalsRecord = preferredMarketCode
      ? await app.persistence.getTickerFundamentals(resolvedTicker, preferredMarketCode)
      : null;

    const { details, marketCode } = await buildTickerDetails({
      persistence: app.persistence,
      store,
      userId,
      ticker: resolvedTicker,
      accountId: query.accountId,
      accountIds: query.accountIds,
      marketCode: query.marketCode,
      reportingCurrency,
      includeProvisional: query.includeProvisional,
      range: query.range,
      startDate: query.startDate,
      endDate: query.endDate,
      fundamentalsRecord,
      getSettledTradingDay: async (resolvedMarket) => app.tradingCalendarCache.latestSettledTradingDay(resolvedMarket, new Date()),
      tradingCalendar: app.tradingCalendarCache,
      enqueueIntradayRefresh: (pair) => enqueueDisplayedTickerRefresh(app, pair),
    });

    const latestFundamentals = preferredMarketCode === marketCode
      ? fundamentalsRecord
      : await app.persistence.getTickerFundamentals(resolvedTicker, marketCode);
    const response = latestFundamentals && latestFundamentals !== fundamentalsRecord
      ? {
        ...details,
        fundamentals: latestFundamentals.fundamentals,
        fundamentalsRefresh: {
          providerId: latestFundamentals.providerId,
          refreshedAt: latestFundamentals.refreshedAt,
          nextRefreshAt: latestFundamentals.nextRefreshAt,
          lastAttemptedAt: latestFundamentals.lastAttemptedAt,
          lastError: latestFundamentals.lastError,
          status: !latestFundamentals.refreshedAt
            ? "missing" as const
            : latestFundamentals.nextRefreshAt && latestFundamentals.nextRefreshAt <= new Date().toISOString()
              ? "stale" as const
              : "fresh" as const,
        },
      }
      : details;

    scheduleTickerFundamentalsRefresh(
      {
        persistence: app.persistence,
        fundamentalsRegistry: app.fundamentalsRegistry,
        log: app.log,
      },
      {
        ticker: resolvedTicker,
        marketCode,
        current: latestFundamentals ?? fundamentalsRecord,
      },
    );

    return response;
  });

  app.get("/dashboard/overview", async (req, reply) => {
    return withReadPathTiming(req, reply, "/dashboard/overview", async (timing) => {
      const { store, userId } = await timing.measure("load_overview_read_store", "db", () => loadOverviewReadStore(app, req));
      const holdings = await timing.measure("list_holdings", "app", () => Promise.resolve(listHoldings(store, userId)));
      const symbols = [...new Set(
        holdings
          .map((holding) => holding.ticker)
          .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
      )];
      const [refreshPending, snapshotMap, prefs] = await timing.measure("quotes_and_prefs", "db", () => Promise.all([
        enqueueDisplayedQuoteRefreshes(app, buildHeldTickerMarketPairsForDisplayedQuotes(store, symbols)),
        resolveDisplayedQuoteSnapshotsForHeldPairs(app, store, symbols, new Date(), { skipEnqueue: true }),
        app.persistence.getUserPreferences(userId),
      ]));
      const quotes = Object.values(snapshotMap).filter((s): s is ResolvedQuoteSnapshot => s !== null);

      const marketStates = await timing.measure("build_market_states", "app", () =>
        buildHeldMarketStatesForStoreHoldings(app, store, holdings, true));
      const summaryAsOf = new Date().toISOString().slice(0, 10);
      const overview = await timing.measure("build_overview", "app", () => Promise.resolve(buildDashboardOverview(store, {
        integrityIssue: getStoreIntegrityIssue(store),
        marketStates,
        quotes,
        regularSessionOnly: true,
        summaryAsOf,
      })));
      const reportingCurrency = resolveReportingCurrency(prefs);
      const holdingAllocationBasis = resolveHoldingAllocationBasis(prefs);
      const translatedSummary = await timing.measure("translate_summary", "db", () => translateOverviewSummary(
        overview.summary,
        overview.holdings,
        overview.dividends,
        reportingCurrency,
        overview.summary.asOf,
        app.persistence,
      ));
      const holdingGroups = await timing.measure("build_holding_groups", "app", () =>
        Promise.resolve(buildOverviewHoldingGroups(store, overview.holdings)));
      const translatedHoldingGroups = await timing.measure("translate_holding_groups", "db", () =>
        translateOverviewHoldingGroups(
          holdingGroups,
          reportingCurrency,
          holdingAllocationBasis,
          overview.summary.asOf,
          app.persistence,
        ));
      const fxRates = await timing.measure("load_fx_rates", "db", () =>
        buildFxConversionRateRows(
          app.persistence,
          [
            ...overview.holdings.map((holding) => holding.currency as AccountDefaultCurrency),
            ...overview.dividends.upcoming.map((dividend) => dividend.currency as AccountDefaultCurrency),
          ],
          reportingCurrency,
          overview.summary.asOf,
        ));
      const dailyCompatibleCurrentValueAmount = await timing.measure("daily_compatible_current_value", "db", () =>
        translateDailyCompatibleCurrentValue(
          translatedHoldingGroups,
          quotes,
          reportingCurrency,
          overview.summary.asOf,
          app.persistence,
        ));
      const valuationPerformance = translatedHoldingGroups.length > 0
        ? await timing.measure("valuation_health_performance", "db", () =>
            buildValuationHealthSnapshotPerformance(app, userId, store, reportingCurrency, overview.summary.asOf))
        : null;
      const valuationHealth = translatedHoldingGroups.length > 0
        ? await timing.measure("valuation_health", "app", () =>
            buildValuationHealth({
              app,
              userId,
              store,
              reportingCurrency,
              currentValueAmount: dailyCompatibleCurrentValueAmount,
              holdingGroups: translatedHoldingGroups,
              performance: valuationPerformance!,
              asOf: overview.summary.asOf,
            }))
        : undefined;
      return {
        ...overview,
        marketStates,
        refreshPending,
        summary: translatedSummary,
        fxRates,
        marketValues: buildOverviewMarketValues(translatedHoldingGroups, reportingCurrency),
        holdingGroups: translatedHoldingGroups,
        ...(valuationHealth ? { valuationHealth } : {}),
      };
    });
  });

  app.get("/dashboard/primary", async (req, reply) => {
    return withReadPathTiming(req, reply, "/dashboard/primary", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const store = await timing.measure("load_primary_read_store", "db", () => app.persistence.loadPrimaryReadStore(userId));
      const prefs = await timing.measure("load_prefs", "db", () => app.persistence.getUserPreferences(userId));
      const reportingCurrency = resolveReportingCurrency(prefs);
      return timing.measure("build_primary_overview", "app", () =>
        buildDashboardPrimaryOverview(store, userId, reportingCurrency, app.persistence));
    });
  });

  app.get("/dashboard/enrichment", async (req, reply) => {
    return withReadPathTiming(req, reply, "/dashboard/enrichment", async (timing) => {
      const { store, userId } = await timing.measure("load_overview_read_store", "db", () => loadOverviewReadStore(app, req));
      const holdings = await timing.measure("list_holdings", "app", () => Promise.resolve(listHoldings(store, userId)));
      const symbols = [...new Set(
        holdings
          .map((holding) => holding.ticker)
          .filter((symbol) => isInstrumentQuoteable(store.instruments.find((item) => item.ticker === symbol))),
      )];
      const now = new Date();
      const heldPairs = buildHeldTickerMarketPairsForDisplayedQuotes(store, symbols);
      const [refreshPending, snapshotMap, prefs] = await timing.measure("quotes_and_prefs", "db", () => Promise.all([
        enqueueDisplayedQuoteRefreshes(app, heldPairs, now),
        resolveDisplayedQuoteSnapshotsForHeldPairs(app, store, symbols, now, { skipEnqueue: true }),
        app.persistence.getUserPreferences(userId),
      ]));
      const quotes = Object.values(snapshotMap).filter((s): s is ResolvedQuoteSnapshot => s !== null);

      const marketStates = await timing.measure("build_market_states", "app", () =>
        buildHeldMarketStatesForStoreHoldings(app, store, holdings, true));
      const summaryAsOf = new Date().toISOString().slice(0, 10);
      const overview = await timing.measure("build_overview", "app", () => Promise.resolve(buildDashboardOverview(store, {
        integrityIssue: getStoreIntegrityIssue(store),
        marketStates,
        quotes,
        regularSessionOnly: true,
        summaryAsOf,
      })));
      const reportingCurrency = resolveReportingCurrency(prefs);
      const holdingAllocationBasis = resolveHoldingAllocationBasis(prefs);
      const translatedSummary = await timing.measure("translate_summary", "db", () => translateOverviewSummary(
        overview.summary,
        overview.holdings,
        overview.dividends,
        reportingCurrency,
        overview.summary.asOf,
        app.persistence,
      ));
      const holdingGroups = await timing.measure("build_holding_groups", "app", () =>
        Promise.resolve(buildOverviewHoldingGroups(store, overview.holdings)));
      const translatedHoldingGroups = await timing.measure("translate_holding_groups", "db", () =>
        translateOverviewHoldingGroups(
          holdingGroups,
          reportingCurrency,
          holdingAllocationBasis,
          overview.summary.asOf,
          app.persistence,
        ));
      const fxRates = await timing.measure("load_fx_rates", "db", () =>
        buildFxConversionRateRows(
          app.persistence,
          [
            ...overview.holdings.map((holding) => holding.currency as AccountDefaultCurrency),
            ...overview.dividends.upcoming.map((dividend) => dividend.currency as AccountDefaultCurrency),
          ],
          reportingCurrency,
          overview.summary.asOf,
        ));
      const dailyCompatibleCurrentValueAmount = await timing.measure("daily_compatible_current_value", "db", () =>
        translateDailyCompatibleCurrentValue(
          translatedHoldingGroups,
          quotes,
          reportingCurrency,
          overview.summary.asOf,
          app.persistence,
        ));
      const valuationPerformance = translatedHoldingGroups.length > 0
        ? await timing.measure("valuation_health_performance", "db", () =>
            buildValuationHealthSnapshotPerformance(app, userId, store, reportingCurrency, overview.summary.asOf))
        : null;
      const valuationHealth = translatedHoldingGroups.length > 0
        ? await timing.measure("valuation_health", "app", () =>
            buildValuationHealth({
              app,
              userId,
              store,
              reportingCurrency,
              currentValueAmount: dailyCompatibleCurrentValueAmount,
              holdingGroups: translatedHoldingGroups,
              performance: valuationPerformance!,
              asOf: overview.summary.asOf,
            }))
        : undefined;
      return {
        ...overview,
        marketStates,
        summary: translatedSummary,
        fxRates,
        marketValues: buildOverviewMarketValues(translatedHoldingGroups, reportingCurrency),
        holdingGroups: translatedHoldingGroups,
        ...(valuationHealth ? { valuationHealth } : {}),
        refreshPending,
      };
    });
  });

  app.get("/dashboard/performance", async (req, reply) => {
    // KZO-159 (158A): validate `range` against the per-user effective list
    // (user pref → admin → hardcoded default). Requests with a `range` value
    // that's not in the effective list are rejected with 400.
    return withReadPathTiming(req, reply, "/dashboard/performance", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const prefs = await timing.measure("load_prefs", "db", () => app.persistence.getUserPreferences(userId));
      const { ranges } = await timing.measure("resolve_ranges", "db", () =>
        resolveEffectiveRanges(app.persistence, userId, prefs));
      const reportingCurrency = resolveReportingCurrency(prefs);
      const rangeEnumValues = ranges as [string, ...string[]];
      const query = z.object({
        range: z.enum(rangeEnumValues).default(rangeEnumValues[0]),
      }).parse(req.query);
      const performanceInputs = await timing.measure("load_performance_inputs", "db", () =>
        app.persistence.getSnapshotGenerationInputs(userId));
      const earliestTradeDate = performanceInputs.trades.map((trade) => trade.tradeDate).sort()[0];
      const asOf = await timing.measure("resolve_as_of", "db", () =>
        resolveDashboardPerformanceAsOfFromTrades(app.persistence, performanceInputs.trades));
      const { startDate, endDate } = resolveRangeBounds(query.range, asOf, earliestTradeDate);
      const expectedContributorKeysByDate = await timing.measure("coverage_inputs", "db", () =>
        buildExpectedSnapshotContributorKeysForTrades(performanceInputs.trades, startDate, endDate, app.persistence));
      const strictExpectedContributorKeysByDate = await timing.measure("strict_coverage_inputs", "app", () =>
        buildExpectedSnapshotContributorKeysForTrades(performanceInputs.trades, startDate, endDate, app.persistence, {
          omitNonTradingContributors: false,
        }));
      return timing.measure("translate_performance", "db", () => translatePerformancePoints(
        userId,
        query.range as DashboardPerformanceRange,
        asOf,
        reportingCurrency,
        app.persistence,
        undefined,
        undefined,
        {
          earliestTradeDate,
          expectedContributorKeysByDate,
          strictExpectedContributorKeysByDate,
          financeTrades: performanceInputs.trades,
          financeDividends: performanceInputs.postedDividends,
          financeLotAllocations: performanceInputs.lotAllocations,
        },
      ));
    });
  });

  app.get("/reports/daily-review", async (req, reply) => {
    return withReadPathTiming(req, reply, "/reports/daily-review", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const query = reportQuerySchema.parse(req.query);
      return timing.measure("build_daily_review_report", "app", () => buildDailyReviewReport(app, userId, query));
    });
  });

  app.get("/reports/portfolio", async (req, reply) => {
    return withReadPathTiming(req, reply, "/reports/portfolio", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const query = reportQuerySchema.parse(req.query);
      return timing.measure("build_portfolio_report", "app", () => buildPortfolioReport(app, userId, query));
    });
  });

  app.get("/reports/market", async (req, reply) => {
    return withReadPathTiming(req, reply, "/reports/market", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const query = reportQuerySchema.parse(req.query);
      return timing.measure("build_market_report", "app", () => buildMarketReport(app, userId, query));
    });
  });

  app.get("/analysis/unrealized-pnl", async (req, reply) => {
    return withReadPathTiming(req, reply, "/analysis/unrealized-pnl", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const query = unrealizedPnlAnalysisRouteQuerySchema.parse(req.query);
      return timing.measure("build_unrealized_pnl_analysis", "app", () => buildUnrealizedPnlAnalysis(app, userId, query));
    });
  });

  app.get("/dividend-events", async (req) => {
    const query = dividendDateRangeQuerySchema.parse(req.query);
    const { userId, store } = await loadUserStore(app, req);
    const dividendEvents = await app.persistence.listDividendEventsByPaymentDate(
      userId,
      query.fromPaymentDate,
      query.toPaymentDate,
      query.limit,
    );

    return {
      dividendEvents: buildDividendEventListItems(store, dividendEvents),
    };
  });

  app.get("/portfolio/dividends/calendar", async (req) => {
    const query = dividendLedgerQuerySchema.parse(req.query);
    const { contextUserId: userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const snapshot = await app.persistence.listDividendCalendarSnapshot(userId, {
      accountId: query.accountId,
      fromPaymentDate: query.fromPaymentDate,
      toPaymentDate: query.toPaymentDate,
      marketCode: query.marketCode,
      limit: query.limit,
    });
    const snapshotStore = createStore();
    snapshotStore.userId = userId;
    snapshotStore.settings.userId = userId;
    snapshotStore.accounts = snapshot.accounts;
    snapshotStore.marketData.dividendEvents = snapshot.dividendEvents;
    snapshotStore.accounting.facts.tradeEvents = snapshot.tradeEvents;
    snapshotStore.accounting.facts.positionActions = snapshot.positionActions ?? [];
    snapshotStore.accounting.facts.dividendLedgerEntries = snapshot.ledgerEntries;
    snapshotStore.accounting.facts.dividendDeductionEntries = snapshot.ledgerEntries.flatMap((entry) => entry.deductions);
    snapshotStore.accounting.facts.dividendSourceLines = snapshot.ledgerEntries.flatMap((entry) => entry.sourceLines);
    setStoreInstruments(snapshotStore, snapshot.instruments);

    return {
      events: buildDividendEventListItems(snapshotStore, snapshot.dividendEvents),
      ledgerEntries: buildDividendLedgerEntryDetails(snapshotStore, snapshot.ledgerEntries, { preserveOrder: true }),
    };
  });

  app.get("/portfolio/dividends/daily-highlights", async (req) => {
    const query = dividendDailyHighlightsQuerySchema.parse(req.query);
    const { contextUserId: userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const now = query.at ? new Date(query.at) : new Date();
    const localDates = [...new Set((query.marketCode ? [query.marketCode] : MARKET_CODES)
      .map((marketCode) => getMarketLocalDate(marketCode, now)))];
    const snapshot = await app.persistence.listDividendDailyHighlightsSnapshot(userId, {
      accountId: query.accountId,
      marketCode: query.marketCode,
      localDates,
    });
    const scopedStore = createStore();
    scopedStore.userId = userId;
    scopedStore.settings.userId = userId;
    scopedStore.accounts = snapshot.accounts;
    scopedStore.marketData.dividendEvents = snapshot.dividendEvents;
    scopedStore.accounting.facts.tradeEvents = snapshot.tradeEvents;
    scopedStore.accounting.facts.positionActions = snapshot.positionActions ?? [];
    scopedStore.accounting.facts.dividendLedgerEntries = snapshot.ledgerEntries;
    scopedStore.accounting.facts.dividendDeductionEntries = snapshot.ledgerEntries.flatMap((entry) => entry.deductions);
    scopedStore.accounting.facts.dividendSourceLines = snapshot.ledgerEntries.flatMap((entry) => entry.sourceLines);
    setStoreInstruments(scopedStore, snapshot.instruments);
    const localDateByEventId = new Map<string, string>();

    const matchesDailyHighlight = (
      event: Store["marketData"]["dividendEvents"][number],
      dateField: "paymentDate" | "exDividendDate",
    ): boolean => {
      const marketCode = resolveDividendEventMarketCode(event);
      if (query.marketCode && marketCode !== query.marketCode) return false;
      const localDate = getMarketLocalDate(marketCode, now);
      localDateByEventId.set(event.id, localDate);
      const eventDate = dateField === "paymentDate" ? event.paymentDate : event.exDividendDate;
      return eventDate === localDate;
    };

    const payingToday = sortDividendDailyHighlightItems(
      buildDividendEventListItems(
        scopedStore,
        scopedStore.marketData.dividendEvents.filter((event) => matchesDailyHighlight(event, "paymentDate")),
      ).map((item) => ({
        ...item,
        applicableLocalDate: localDateByEventId.get(item.id) ?? item.paymentDate ?? "",
      })),
    );
    const exDividendToday = sortDividendDailyHighlightItems(
      buildDividendEventListItems(
        scopedStore,
        scopedStore.marketData.dividendEvents.filter((event) => matchesDailyHighlight(event, "exDividendDate")),
      ).map((item) => ({
        ...item,
        applicableLocalDate: localDateByEventId.get(item.id) ?? item.exDividendDate,
      })),
    );

    return { payingToday, exDividendToday };
  });

  app.get("/portfolio/dividends/review/primary", async (req, reply) => {
    const query = dividendReviewQuerySchema.parse(req.query);
    const { ticker, accountId, cashStatus, stockStatus, ...reviewQuery } = query;
    return withReadPathTiming(req, reply, "/portfolio/dividends/review/primary", async (timing) => {
      const { contextUserId: userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const [accounts, primary, metadata] = await Promise.all([
        timing.measure("active_accounts", "db", () => app.persistence.listActiveAccounts(userId)),
        app.persistence.listDividendReviewPrimary(userId, {
          ...reviewQuery,
          accountIds: accountId,
          cashStatuses: cashStatus,
          stockStatuses: stockStatus,
          tickers: ticker,
        }),
        timing.measure("review_primary_metadata", "db", () =>
          app.persistence.listDividendReviewMetadata(userId, {
            accountIds: accountId,
            fromPaymentDate: query.fromPaymentDate,
            toPaymentDate: query.toPaymentDate,
          })),
      ]);
      const capabilities = derivePortfolioCapabilities(accounts);
      timing.record("review_primary_db", "db", primary.phaseTimings?.dbMs ?? 0);
      timing.record("review_primary_hydration", "app", primary.phaseTimings?.hydrationMs ?? 0);
      return {
        capabilities,
        reviewRows: primary.rows,
        total: primary.total,
        years: metadata.years,
        accounts: metadata.accounts,
        eligibleTickers: metadata.eligibleTickers,
      };
    });
  });

  app.get("/portfolio/dividends/review/enrichment", async (req, reply) => {
    const filters = dividendReviewFilterQuerySchema.parse(req.query);
    const { ticker, accountId, cashStatus, stockStatus, ...reviewFilters } = filters;
    return withReadPathTiming(req, reply, "/portfolio/dividends/review/enrichment", async (timing) => {
      const { contextUserId: userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const enrichment = await app.persistence.getDividendReviewEnrichment(userId, {
        ...reviewFilters,
        accountIds: accountId,
        cashStatuses: cashStatus,
        stockStatuses: stockStatus,
        tickers: ticker,
      });
      timing.record("review_enrichment_db", "db", enrichment.phaseTimings?.dbMs ?? 0);
      timing.record("review_enrichment_aggregate", "phase", enrichment.phaseTimings?.aggregateMs ?? 0);
      return {
        aggregates: enrichment.aggregates,
        nhiRollup: enrichment.nhiRollup,
        sourceComposition: enrichment.sourceComposition,
        hero: enrichment.hero,
      };
    });
  });

  app.get("/portfolio/dividends/review", async (req) => {
    const query = dividendReviewQuerySchema.parse(req.query);
    const { contextUserId: userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const result = await app.persistence.listDividendReviewRows(userId, {
      accountIds: query.accountId,
      fromPaymentDate: query.fromPaymentDate,
      toPaymentDate: query.toPaymentDate,
      cashStatuses: query.cashStatus,
      stockStatuses: query.stockStatus,
      reconciliationStatus: query.reconciliationStatus,
      postingStatus: query.postingStatus,
      excludeExpected: query.excludeExpected,
      tickers: query.ticker,
      marketCode: query.marketCode,
      sourceComposition: query.sourceComposition,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });
    return {
      reviewRows: result.rows,
      total: result.total,
      aggregates: result.aggregates,
    };
  });

  app.get("/portfolio/dividends/ledger", async (req) => {
    const query = dividendLedgerQuerySchema.parse(req.query);
    const { userId, store } = await loadUserStore(app, req);
    const result = await app.persistence.listDividendLedgerEntries(userId, {
      accountId: query.accountId,
      fromPaymentDate: query.fromPaymentDate,
      toPaymentDate: query.toPaymentDate,
      reconciliationStatus: query.reconciliationStatus,
      postingStatus: query.postingStatus,
      ticker: query.ticker,
      marketCode: query.marketCode,
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    });

    return {
      ledgerEntries: buildDividendLedgerEntryDetails(store, result.ledgerEntries, { preserveOrder: true }),
      total: result.total,
      aggregates: result.aggregates,
    };
  });

  app.get("/portfolio/dividends/ledger/years", async (req) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return app.persistence.listDividendLedgerYears(userId);
  });

  app.get("/portfolio/cash-ledger", async (req, reply) => {
    const query = cashLedgerQuerySchema.parse(req.query);
    return withReadPathTiming(req, reply, "/portfolio/cash-ledger", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const result = await timing.measure("list_cash_ledger", "db", () => app.persistence.listCashLedgerEntries(userId, {
        fromEntryDate: query.fromEntryDate,
        toEntryDate: query.toEntryDate,
        accountId: query.accountId,
        entryType: query.entryType,
        page: query.page,
        limit: query.limit,
        sortBy: query.sortBy,
        sortOrder: query.sortOrder,
      }));

      const enrichment = await timing.measure("cash_ledger_enrichment", "db", () => app.persistence.getCashLedgerEnrichment(userId, {
        accountIds: [...new Set(result.entries.map((entry) => entry.accountId))],
        relatedTradeEventIds: result.entries
          .map((entry) => entry.relatedTradeEventId)
          .filter((value): value is string => Boolean(value)),
        relatedDividendLedgerEntryIds: result.entries
          .map((entry) => entry.relatedDividendLedgerEntryId)
          .filter((value): value is string => Boolean(value)),
        fxTransferIds: result.entries
          .map((entry) => entry.fxTransferId)
          .filter((value): value is string => Boolean(value)),
      }));

      const enriched = await timing.measure("map_response", "app", () => Promise.resolve(result.entries.map((entry) => {
        let ticker: string | null = null;
        let side: "BUY" | "SELL" | null = null;
        let tradeDetail: {
          quantity: number;
          unitPrice: number;
          commissionAmount: number;
          taxAmount: number;
        } | undefined;
        let dividendDetail: {
          expectedCashAmount: number;
          receivedCashAmount: number;
          deductionTotal: number;
        } | undefined;
        let fxTransferDetail: {
          pairedAccountId: string;
          pairedAccountName: string;
          pairedAmount: number;
          pairedCurrency: string;
          effectiveRate: number;
        } | undefined;
        let fxTransferReversed: boolean | undefined;

        if (entry.relatedTradeEventId) {
          const trade = enrichment.tradesById.get(entry.relatedTradeEventId);
          if (trade) {
            ticker = trade.ticker;
            side = trade.side;
            tradeDetail = {
              quantity: trade.quantity,
              unitPrice: trade.unitPrice,
              commissionAmount: trade.commissionAmount,
              taxAmount: trade.taxAmount,
            };
          }
        }

        if (entry.relatedDividendLedgerEntryId) {
          const dividend = enrichment.dividendsById.get(entry.relatedDividendLedgerEntryId);
          if (dividend) {
            ticker = dividend.ticker;
            dividendDetail = {
              expectedCashAmount: dividend.expectedCashAmount,
              receivedCashAmount: dividend.receivedCashAmount,
              deductionTotal: dividend.deductionTotal,
            };
          }
        }

        if (entry.fxTransferId) {
          fxTransferReversed = enrichment.reversedFxTransferIds.has(entry.fxTransferId);
          const legs = enrichment.fxTransferLegsByTransferId.get(entry.fxTransferId) ?? [];
          const outLeg = legs.find((leg) => leg.entryType === "FX_TRANSFER_OUT" && !leg.reversalOfCashLedgerEntryId);
          const inLeg = legs.find((leg) => leg.entryType === "FX_TRANSFER_IN" && !leg.reversalOfCashLedgerEntryId);
          if (outLeg && inLeg && (entry.entryType === "FX_TRANSFER_OUT" || entry.entryType === "FX_TRANSFER_IN")) {
            const paired = entry.entryType === "FX_TRANSFER_OUT" ? inLeg : outLeg;
            fxTransferDetail = {
              pairedAccountId: paired.accountId,
              pairedAccountName: paired.accountName,
              pairedAmount: Math.abs(paired.amount),
              pairedCurrency: paired.currency,
              effectiveRate: roundToDecimal(inLeg.amount / Math.abs(outLeg.amount), 8),
            };
          }
        }

        return { ...entry, ticker, side, tradeDetail, dividendDetail, fxTransferDetail, fxTransferReversed };
      })));

      const summary = result.summary.map((item) => ({
        ...item,
        amount: roundToDecimal(item.amount, 2),
      }));

      return { entries: enriched, summary, total: result.total };
    });
  });

  app.post("/portfolio/dividends/postings", async (req) => {
    const body = dividendPostingSchema.parse(req.body);
    const idempotencyKey = req.headers["idempotency-key"];
    if (!idempotencyKey || Array.isArray(idempotencyKey)) {
      throw routeError(400, "idempotency_key_required", "idempotency-key header required");
    }

    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const claimed = await app.persistence.claimIdempotencyKey(userId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }

    try {
      if (body.dividendLedgerEntryId) {
        const { prepared, replayScope, replaySummary } = await app.persistence.withTransactionWriteLock(userId, async (writer) => {
          const draftStore = structuredClone(await writer.loadStore(userId));
          assertStoreIntegrity(draftStore);
          requireAccount(draftStore, body.accountId);
          const prepared = preparePostedCashDividendUpdate(draftStore, userId, {
            accountId: body.accountId,
            dividendEventId: body.dividendEventId,
            dividendLedgerEntryId: body.dividendLedgerEntryId!,
            expectedVersion: body.expectedVersion!,
            receivedCashAmount: body.receivedCashAmount,
            receivedStockQuantity: body.receivedStockQuantity,
            deductions: body.deductions.map((entry) => ({
              id: randomUUID(),
              deductionType: entry.deductionType,
              amount: entry.amount,
              currencyCode: entry.currencyCode,
              withheldAtSource: entry.withheldAtSource,
              source: entry.source,
              sourceReference: entry.sourceReference,
              note: entry.note,
            })),
            sourceLines: body.sourceLines.map((entry) => ({
              id: entry.id ?? randomUUID(),
              sourceBucket: entry.sourceBucket,
              amount: entry.amount,
              currencyCode: entry.currencyCode,
              source: entry.source,
              sourceReference: entry.sourceReference,
              note: entry.note,
            })),
            sourceCompositionStatus: body.sourceCompositionStatus,
          });

          const replayScope = getDividendUpdateReplayScope(prepared);
          let replayedStore: Store | null = null;
          let replaySummary: Awaited<ReturnType<typeof replayPositionHistory>> | null = null;
          if (replayScope) {
            const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
            await simulation.saveStore(structuredClone(draftStore));
            replaySummary = await replayPositionHistory(simulation, userId, replayScope.accountId, replayScope.ticker, {
              marketCode: replayScope.marketCode,
            });
            replayedStore = await simulation.loadStore(userId);
            assertStoreIntegrity(replayedStore);
          }
          await writer.updatePostedCashDividend(userId, prepared.persistenceInput);
          if (replayScope && replayedStore && replaySummary) {
            const appliedDividendChanges = await writer.saveReplayedPositionScope(userId, replayedStore.accounting, {
              accountId: replayScope.accountId,
              ticker: replayScope.ticker,
              marketCode: replayScope.marketCode as MarketCode,
              dividendLedgerChanges: replaySummary.dividendLedgerChanges,
            });
            replaySummary = { ...replaySummary, dividendLedgerChanges: appliedDividendChanges };
          }
          return { prepared, replayScope, replaySummary };
        });
        await app.eventBus.publishEvent(userId, "dividend_updated", {
          dividendLedgerEntryId: prepared.response.dividendLedgerEntry.id,
          dividendEventId: prepared.response.dividendEvent.id,
          accountId: prepared.response.dividendLedgerEntry.accountId,
          version: prepared.response.dividendLedgerEntry.version,
        });
        if (replayScope && replaySummary) {
          scheduleCommittedReplayFollowUp(app.persistence, app.eventBus, userId, replaySummary, {
            snapshotFromDate: replayScope.actionDate,
            marketCode: replayScope.marketCode,
          });
        }
        await appendDelegatedWriteAudit(app, req, {
          mutation: "dividend_posting_updated",
          routeKey: "POST /portfolio/dividends/postings",
          dividendLedgerEntryId: prepared.response.dividendLedgerEntry.id,
          dividendEventId: prepared.response.dividendEvent.id,
        });
        return prepared.response;
      }

      let calculationPreview: Awaited<ReturnType<typeof buildDividendCalculationPreview>> | null = null;
      if (body.calculation) {
        calculationPreview = await buildDividendCalculationPreview(userId, {
          accountId: body.accountId,
          dividendEventId: body.dividendEventId,
          method: body.calculation.method,
          selectedParValue: body.calculation.selectedParValue ?? null,
          customRatio: body.calculation.customRatio ?? null,
        });
        if (calculationPreview.requiresHighRatioConfirmation && !body.calculation.acknowledgeHighRatio) {
          throw routeError(409, "dividend_calculation_high_ratio_confirmation_required", "High stock ratios require explicit confirmation.");
        }
        if (calculationPreview.drift?.hasDrift && !body.calculation.acknowledgeDrift) {
          throw routeError(409, "dividend_calculation_drift_confirmation_required", "Provider drift requires explicit reconfirmation.");
        }
      }

      const committed = await app.persistence.withTransactionWriteLock(userId, async (writer) => {
        const draftStore = structuredClone(await writer.loadStore(userId));
        assertStoreIntegrity(draftStore);
        requireAccount(draftStore, body.accountId);
        if (body.calculation && calculationPreview) {
          appendConfirmedDividendCalculationToStore(draftStore, userId, {
            accountId: body.accountId,
            dividendEventId: body.dividendEventId,
            method: body.calculation.method,
            selectedParValue: body.calculation.selectedParValue ?? null,
            customRatio: body.calculation.customRatio ?? null,
          }, calculationPreview);
        }

        const result = postDividend(draftStore, userId, {
          id: randomUUID(),
          accountId: body.accountId,
          dividendEventId: body.dividendEventId,
          receivedCashAmount: body.receivedCashAmount,
          receivedStockQuantity: body.receivedStockQuantity,
          deductions: body.deductions.map((entry) => ({
            id: randomUUID(),
            deductionType: entry.deductionType,
            amount: entry.amount,
            currencyCode: entry.currencyCode,
            withheldAtSource: entry.withheldAtSource,
            source: entry.source,
            sourceReference: entry.sourceReference,
            note: entry.note,
          })),
          sourceLines: body.sourceLines.map((entry) => ({
            id: entry.id ?? randomUUID(),
            sourceBucket: entry.sourceBucket,
            amount: entry.amount,
            currencyCode: entry.currencyCode,
            source: entry.source,
            sourceReference: entry.sourceReference,
            note: entry.note,
          })),
          sourceCompositionStatus: body.sourceCompositionStatus,
        });
        const activeCalculation = getStoreActiveDividendCalculation(
          draftStore,
          userId,
          body.accountId,
          body.dividendEventId,
        );
        if (activeCalculation) {
          applyDividendCalculationSnapshotToLedgerEntry(result.dividendLedgerEntry, activeCalculation);
          const persistedLedgerEntry = draftStore.accounting.facts.dividendLedgerEntries.find(
            (entry) => entry.id === result.dividendLedgerEntry.id,
          );
          if (persistedLedgerEntry) {
            applyDividendCalculationSnapshotToLedgerEntry(persistedLedgerEntry, activeCalculation);
          }
        }

        let replayedStore: Store | null = null;
        let replaySummary: Awaited<ReturnType<typeof replayPositionHistory>> | null = null;
        if (result.positionAction || result.dividendEvent.eventType !== "CASH") {
          const marketCode = result.positionAction?.marketCode ?? resolveDividendEventMarketCode(result.dividendEvent);
          const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
          await simulation.saveStore(structuredClone(draftStore));
          replaySummary = await replayPositionHistory(
            simulation,
            userId,
            result.dividendLedgerEntry.accountId,
            result.dividendEvent.ticker,
            { marketCode },
          );
          replayedStore = await simulation.loadStore(userId);
          assertStoreIntegrity(replayedStore);
        }
        await writer.savePostedDividend(
          userId,
          draftStore.accounting,
          draftStore.marketData,
          result.dividendLedgerEntry.id,
        );
        if (replayedStore && replaySummary) {
          const appliedDividendChanges = await writer.saveReplayedPositionScope(userId, replayedStore.accounting, {
            accountId: result.dividendLedgerEntry.accountId,
            ticker: result.dividendEvent.ticker,
            marketCode: result.positionAction?.marketCode ?? resolveDividendEventMarketCode(result.dividendEvent),
            dividendLedgerChanges: replaySummary.dividendLedgerChanges,
          });
          replaySummary = { ...replaySummary, dividendLedgerChanges: appliedDividendChanges };
        }
        return { result, replaySummary };
      });
      const { result, replaySummary } = committed;
      await app.eventBus.publishEvent(userId, "dividend_posted", {
        dividendLedgerEntryId: result.dividendLedgerEntry.id,
        dividendEventId: result.dividendEvent.id,
        accountId: result.dividendLedgerEntry.accountId,
        version: result.dividendLedgerEntry.version,
      });
      if ((result.positionAction || result.dividendEvent.eventType !== "CASH") && replaySummary) {
        const marketCode = result.positionAction?.marketCode ?? resolveDividendEventMarketCode(result.dividendEvent);
        const actionDate = result.positionAction?.actionDate
          ?? resolveDividendPostingDate(result.dividendEvent.paymentDate, result.dividendLedgerEntry.bookedAt);
        scheduleCommittedReplayFollowUp(app.persistence, app.eventBus, userId, replaySummary, {
          snapshotFromDate: actionDate,
          marketCode,
        });
      }
      await appendDelegatedWriteAudit(app, req, {
        mutation: "dividend_posted",
        routeKey: "POST /portfolio/dividends/postings",
        dividendLedgerEntryId: result.dividendLedgerEntry.id,
        dividendEventId: result.dividendEvent.id,
      });
      return result;
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(userId, idempotencyKey);
      throw error;
    }
  });

  app.get("/portfolio/dividends/postings/:dividendLedgerEntryId", async (req, reply) => {
    const params = z.object({ dividendLedgerEntryId: userScopedIdSchema }).parse(req.params);
    return withReadPathTiming(req, reply, "/portfolio/dividends/postings/:dividendLedgerEntryId", async (timing) => {
      const { contextUserId: userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const ledgerEntry = await timing.measure("review_detail_db", "db", () =>
        app.persistence.getDividendReviewRowDetail(userId, params.dividendLedgerEntryId));
      if (!ledgerEntry) {
        throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
      }
      return ledgerEntry;
    });
  });

  app.patch("/portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation", async (req) => {
    const params = z.object({ dividendLedgerEntryId: userScopedIdSchema }).parse(req.params);
    const body = dividendReconciliationSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const ownedEntry = await app.persistence.findDividendLedgerEntryById(userId, params.dividendLedgerEntryId);
    if (!ownedEntry) {
      throw routeError(403, "forbidden", "Dividend ledger entry does not belong to the authenticated user");
    }

    await app.persistence.updateDividendReconciliationStatus(
      userId,
      params.dividendLedgerEntryId,
      body.status,
      body.note?.trim() || undefined,
    );

    // Direct primary-key lookup — safe regardless of how many historical
    // rows the account has accumulated. Replaces a former scan-and-filter
    // over a 500-entry page which could falsely 404 on large accounts.
    const detailedEntry = await app.persistence.getDividendLedgerEntryWithDetails(
      userId,
      params.dividendLedgerEntryId,
    );
    if (!detailedEntry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    const store = await app.persistence.loadStore(userId);
    const ledgerEntry = buildDividendLedgerEntryDetails(store, [detailedEntry])[0];
    if (!ledgerEntry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    await app.eventBus.publishEvent(userId, "dividend_reconciliation_changed", {
      dividendLedgerEntryId: ledgerEntry.id,
      dividendEventId: ledgerEntry.dividendEventId,
      accountId: ledgerEntry.accountId,
      reconciliationStatus: ledgerEntry.reconciliationStatus,
      version: ledgerEntry.version,
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "dividend_reconciliation_updated",
      routeKey: "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
      dividendLedgerEntryId: ledgerEntry.id,
      dividendEventId: ledgerEntry.dividendEventId,
      reconciliationStatus: ledgerEntry.reconciliationStatus,
    });

    return { ledgerEntry };
  });

  app.patch("/portfolio/dividends/postings/:dividendLedgerEntryId/stock-reconciliation", async (req) => {
    const params = z.object({ dividendLedgerEntryId: userScopedIdSchema }).parse(req.params);
    const body = dividendStockReconciliationSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);

    const ownedEntry = await app.persistence.findDividendLedgerEntryById(userId, params.dividendLedgerEntryId);
    if (!ownedEntry) {
      throw routeError(403, "forbidden", "Dividend ledger entry does not belong to the authenticated user");
    }

    await app.persistence.updateDividendStockReconciliationStatus(
      userId,
      params.dividendLedgerEntryId,
      body.status,
      body.note === undefined ? undefined : (body.note?.trim() || null),
      body.expectedVersion,
      await buildPortfolioAuditInput(req, "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/stock-reconciliation"),
    );

    const ledgerEntry = await app.persistence.getDividendReviewRowDetail(userId, params.dividendLedgerEntryId);
    if (!ledgerEntry) {
      throw routeError(404, "dividend_ledger_entry_not_found", "Dividend ledger entry not found");
    }
    await app.eventBus.publishEvent(userId, "dividend_stock_reconciliation_changed", {
      dividendLedgerEntryId: ledgerEntry.id,
      dividendEventId: ledgerEntry.dividendEventId,
      accountId: ledgerEntry.accountId,
      stockReconciliationStatus: ledgerEntry.stockReconciliationStatus,
      version: ledgerEntry.version,
    });
    return { ledgerEntry };
  });

  const normalizeProviderDecimal = (
    value: string | number | null | undefined,
    fieldName: "value" | "authoritative ratio",
  ): string | null => {
    if (value == null) return null;
    const text = typeof value === "number" ? String(value) : value.trim();
    if (!isPositiveDecimalWithinPrecision(text, 8, 12)) {
      throw routeError(
        400,
        "dividend_stock_provider_value_invalid",
        `Provider stock ${fieldName} must be a finite positive decimal within NUMERIC(20,12) precision.`,
      );
    }
    return text;
  };

  const comparableProviderDecimal = (value: string | null): string | null => {
    if (value === null) return null;
    const [whole = "0", fraction = ""] = value.split(".");
    const normalizedWhole = whole.replace(/^0+(?=\d)/, "");
    const normalizedFraction = fraction.replace(/0+$/, "");
    return normalizedFraction.length > 0
      ? `${normalizedWhole}.${normalizedFraction}`
      : normalizedWhole;
  };

  const providerDecimalsEqual = (left: string | null, right: string | null): boolean =>
    comparableProviderDecimal(left) === comparableProviderDecimal(right);

  const buildDividendCalculationPreview = async (
    contextUserId: string,
    body: z.infer<typeof dividendCalculationPreviewSchema>,
  ) => {
    const store = await app.persistence.loadStore(contextUserId);
    const account = store.accounts.find((item) => item.id === body.accountId);
    if (!account) {
      throw routeError(404, "account_not_found", "Account not found");
    }
    const event = store.marketData.dividendEvents.find((item) => item.id === body.dividendEventId);
    if (!event) {
      throw routeError(404, "dividend_event_not_found", "Dividend event not found");
    }
    const marketCode = resolveDividendEventMarketCode(event);
    const eligibleQuantity = deriveEligibleQuantity(
      store,
      body.accountId,
      event.ticker,
      event.exDividendDate,
      marketCode,
    );
    const selectedParValue = body.selectedParValue
      ?? (
        body.method === "derived_from_par_value"
          ? (await app.persistence.getAccountMarketDividendSettings(contextUserId, body.accountId, marketCode)).fallbackParValue
          : null
      );
    if (body.method === "derived_from_par_value" && marketCode !== "TW") {
      throw routeError(400, "unsupported_dividend_settings_market", "Par-value derivation is only supported for TW.");
    }
    const hasNormalizedProviderFields =
      event.stockProviderValue !== undefined
      || event.stockProviderAuthoritativeRatio !== undefined;
    const providerUnit = event.stockProviderValueUnit
      ?? (!hasNormalizedProviderFields && event.stockDistributionRatio != null ? "RATIO" : null);
    const providerValue = normalizeProviderDecimal(
      event.stockProviderValue !== undefined
        ? event.stockProviderValue
        : providerUnit === "RATIO"
          ? event.stockDistributionRatio
          : event.stockDistributionAmountRaw,
      "value",
    );
    const providerAuthoritativeRatio = normalizeProviderDecimal(
      event.stockProviderAuthoritativeRatio !== undefined
        ? event.stockProviderAuthoritativeRatio
        : !hasNormalizedProviderFields && providerUnit === "RATIO"
          ? event.stockDistributionRatio
          : null,
      "authoritative ratio",
    );
    const activeCalculation = await app.persistence.getLatestDividendCalculation(
      contextUserId,
      body.accountId,
      body.dividendEventId,
    );
    const previousAuthoritativeRatio = activeCalculation
      ? activeCalculation.provider.authoritativeRatio
        ?? (activeCalculation.method === "provider_ratio" ? activeCalculation.ratio : null)
      : null;
    const drift = activeCalculation
      ? {
          hasDrift:
            !providerDecimalsEqual(activeCalculation.provider.value, providerValue)
            || activeCalculation.provider.unit !== providerUnit
            || !providerDecimalsEqual(previousAuthoritativeRatio, providerAuthoritativeRatio),
          previousProviderValue: activeCalculation.provider.value,
          previousProviderUnit: activeCalculation.provider.unit,
          currentProviderValue: providerValue,
          currentProviderUnit: providerUnit,
          previousAuthoritativeRatio,
          currentAuthoritativeRatio: providerAuthoritativeRatio,
        }
      : null;
    try {
      const calculation = calculateDividendStockEntitlement({
        eligibleQuantity,
        method: body.method,
        providerValue: body.method === "provider_ratio" ? providerAuthoritativeRatio : providerValue,
        providerUnit,
        selectedParValue,
        customRatio: body.customRatio ?? null,
      });
      return {
        accountId: body.accountId,
        dividendEventId: body.dividendEventId,
        marketCode,
        eligibleQuantity,
        ...calculation,
        providerValue,
        providerAuthoritativeRatio,
        providerSource: event.stockProviderSource ?? event.source ?? null,
        providerDataset: event.stockProviderDataset ?? null,
        drift,
        activeCalculation,
      };
    } catch (error) {
      if (error instanceof Error && error.message === "provider_unit_incompatible") {
        throw routeError(
          400,
          "dividend_stock_provider_ratio_unavailable",
          "Provider stock values are present but not in a usable authoritative ratio unit.",
        );
      }
      if (error instanceof Error && error.message === "provider_value_must_be_finite_positive") {
        throw routeError(400, "dividend_stock_provider_value_invalid", "Provider stock value must be finite and positive.");
      }
      if (error instanceof Error && error.message === "par_value_must_be_finite_positive") {
        throw routeError(400, "dividend_stock_selected_par_value_invalid", "Selected par value must be finite and positive.");
      }
      if (error instanceof Error && error.message === "ratio_must_be_positive") {
        throw routeError(400, "dividend_stock_custom_ratio_invalid", "Custom ratio must be finite and positive.");
      }
      if (error instanceof Error && error.message === "expected_whole_shares_overflow") {
        throw routeError(400, "dividend_stock_calculation_overflow", "Expected stock quantity exceeds the supported range.");
      }
      throw error;
    }
  };

  function appendConfirmedDividendCalculationToStore(
    store: Awaited<ReturnType<typeof app.persistence.loadStore>>,
    userId: string,
    input: {
      accountId: string;
      dividendEventId: string;
      method: "provider_ratio" | "derived_from_par_value" | "custom_ratio";
      selectedParValue: string | null;
      customRatio: string | null;
    },
    preview: Awaited<ReturnType<typeof buildDividendCalculationPreview>>,
  ) {
    const now = new Date().toISOString();
    for (const calculation of store.accounting.facts.dividendCalculationVersions) {
      if (
        calculation.userId === userId
        && calculation.accountId === input.accountId
        && calculation.dividendEventId === input.dividendEventId
        && !calculation.supersededAt
        && (calculation.status === "confirmed" || calculation.status === "amended")
      ) {
        calculation.supersededAt = now;
      }
    }
    const nextVersion = store.accounting.facts.dividendCalculationVersions
      .filter((item) =>
        item.userId === userId
        && item.accountId === input.accountId
        && item.dividendEventId === input.dividendEventId,
      )
      .reduce((max, item) => Math.max(max, item.calculationVersion), 0) + 1;
    store.accounting.facts.dividendCalculationVersions.push({
      id: randomUUID(),
      userId,
      accountId: input.accountId,
      dividendEventId: input.dividendEventId,
      calculationVersion: nextVersion,
      status: "confirmed",
      method: input.method,
      providerValue: preview.providerValue,
      providerUnit: preview.providerUnit,
      providerSource: preview.providerSource,
      providerDataset: preview.providerDataset,
      providerAuthoritativeRatio: preview.providerAuthoritativeRatio,
      selectedParValue: input.selectedParValue,
      customRatio: input.customRatio,
      ratio: preview.ratio,
      theoreticalShares: preview.theoreticalShares,
      expectedWholeShares: preview.expectedWholeShares,
      fractionalRemainder: preview.fractionalRemainder,
      requiresHighRatioConfirmation: preview.requiresHighRatioConfirmation,
      confirmedAt: now,
      priorCalculationId: preview.activeCalculation?.id ?? null,
      dividendLedgerEntryId: null,
      drift: preview.drift ?? null,
      createdAt: now,
    });
  }

  function getStoreActiveDividendCalculation(
    store: Awaited<ReturnType<typeof app.persistence.loadStore>>,
    userId: string,
    accountId: string,
    dividendEventId: string,
  ) {
    return [...store.accounting.facts.dividendCalculationVersions]
      .filter((item) =>
        item.userId === userId
        && item.accountId === accountId
        && item.dividendEventId === dividendEventId
        && !item.supersededAt
        && (item.status === "confirmed" || item.status === "amended"),
      )
      .sort((left, right) => right.calculationVersion - left.calculationVersion || right.id.localeCompare(left.id))[0] ?? null;
  }

  function applyDividendCalculationSnapshotToLedgerEntry(
    ledgerEntry: {
      expectedStockQuantity: number;
      expectedStockCalcState?: "resolved" | "needs_action";
      expectedStockDistributionRatio?: number | null;
      expectedStockParValueAmount?: number | null;
      activeCalculationId?: string | null;
      stockReconciliationStatus?: "needs_calculation" | "pending_receipt" | "matched" | "variance" | "explained" | null;
      receivedStockQuantity: number;
      postingStatus: "expected" | "posted" | "adjusted";
    },
    calculation: {
      id: string;
      ratio: string;
      selectedParValue?: string | null;
      expectedWholeShares: number | null;
    },
  ) {
    if (calculation.expectedWholeShares == null) return;
    ledgerEntry.expectedStockQuantity = calculation.expectedWholeShares;
    ledgerEntry.expectedStockCalcState = "resolved";
    ledgerEntry.expectedStockDistributionRatio = Number(calculation.ratio);
    ledgerEntry.expectedStockParValueAmount = calculation.selectedParValue == null ? null : Number(calculation.selectedParValue);
    ledgerEntry.activeCalculationId = calculation.id;
    if (ledgerEntry.stockReconciliationStatus !== "explained") {
      ledgerEntry.stockReconciliationStatus =
        ledgerEntry.postingStatus === "expected"
          ? "pending_receipt"
          : ledgerEntry.receivedStockQuantity === 0
            ? "pending_receipt"
            : ledgerEntry.receivedStockQuantity === calculation.expectedWholeShares
              ? "matched"
              : "variance";
    }
  }

  app.post("/portfolio/dividends/calculations/preview", async (req) => {
    const body = dividendCalculationPreviewSchema.parse(req.body);
    const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    return buildDividendCalculationPreview(contextUserId, body);
  });

  app.post("/portfolio/dividends/calculations/confirm", async (req) => {
    const body = dividendCalculationConfirmSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const claimed = await app.persistence.claimIdempotencyKey(contextUserId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }
    try {
    const payload = await buildDividendCalculationPreview(contextUserId, {
      accountId: body.accountId,
      dividendEventId: body.dividendEventId,
      method: body.method,
      selectedParValue: body.selectedParValue ?? null,
      customRatio: body.customRatio ?? null,
    });
    if (payload.requiresHighRatioConfirmation && !body.acknowledgeHighRatio) {
      throw routeError(409, "dividend_calculation_high_ratio_confirmation_required", "High stock ratios require explicit confirmation.");
    }
    if (payload.drift?.hasDrift && !body.acknowledgeDrift) {
      throw routeError(409, "dividend_calculation_drift_confirmation_required", "Provider drift requires explicit reconfirmation.");
    }
    return app.persistence.confirmDividendCalculation(contextUserId, {
      ...body,
      providerValue: payload.providerValue,
      providerUnit: payload.providerUnit,
      providerSource: payload.providerSource,
      providerDataset: payload.providerDataset,
      providerAuthoritativeRatio: payload.providerAuthoritativeRatio,
      ratio: payload.ratio,
      theoreticalShares: payload.theoreticalShares,
      expectedWholeShares: payload.expectedWholeShares,
      fractionalRemainder: payload.fractionalRemainder,
      requiresHighRatioConfirmation: payload.requiresHighRatioConfirmation,
      drift: payload.drift ?? null,
      auditInput: await buildPortfolioAuditInput(req, "POST /portfolio/dividends/calculations/confirm"),
    });
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(contextUserId, idempotencyKey);
      throw error;
    }
  });

  app.post("/portfolio/dividends/calculations/reset", async (req) => {
    const body = dividendCalculationResetSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const claimed = await app.persistence.claimIdempotencyKey(contextUserId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }
    try {
      await app.persistence.resetDividendCalculation(contextUserId, {
        ...body,
        auditInput: await buildPortfolioAuditInput(req, "POST /portfolio/dividends/calculations/reset"),
      });
      return { status: "ok" as const };
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(contextUserId, idempotencyKey);
      throw error;
    }
  });

  app.post("/portfolio/dividends/calculations/amend", async (req) => {
    const body = dividendCalculationAmendSchema.parse(req.body);
    const idempotencyKey = requireIdempotencyKey(req);
    const { contextUserId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const claimed = await app.persistence.claimIdempotencyKey(contextUserId, idempotencyKey);
    if (!claimed) {
      throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
    }
    try {
    const payload = await buildDividendCalculationPreview(contextUserId, {
      accountId: body.accountId,
      dividendEventId: body.dividendEventId,
      method: body.method,
      selectedParValue: body.selectedParValue ?? null,
      customRatio: body.customRatio ?? null,
    });
    if (payload.requiresHighRatioConfirmation && !body.acknowledgeHighRatio) {
      throw routeError(409, "dividend_calculation_high_ratio_confirmation_required", "High stock ratios require explicit confirmation.");
    }
    if (payload.drift?.hasDrift && !body.acknowledgeDrift) {
      throw routeError(409, "dividend_calculation_drift_confirmation_required", "Provider drift requires explicit reconfirmation.");
    }
    return app.persistence.amendDividendCalculation(contextUserId, {
      ...body,
      providerValue: payload.providerValue,
      providerUnit: payload.providerUnit,
      providerSource: payload.providerSource,
      providerDataset: payload.providerDataset,
      providerAuthoritativeRatio: payload.providerAuthoritativeRatio,
      ratio: payload.ratio,
      theoreticalShares: payload.theoreticalShares,
      expectedWholeShares: payload.expectedWholeShares,
      fractionalRemainder: payload.fractionalRemainder,
      requiresHighRatioConfirmation: payload.requiresHighRatioConfirmation,
      drift: payload.drift ?? null,
      auditInput: await buildPortfolioAuditInput(req, "POST /portfolio/dividends/calculations/amend"),
    });
    } catch (error) {
      await app.persistence.releaseIdempotencyKey(contextUserId, idempotencyKey);
      throw error;
    }
  });

  app.get("/corporate-actions", async (req) => {
    const { store } = await loadUserStore(app, req);
    return listPositionActions(store);
  });

  app.post("/corporate-actions", async (req) => {
    const body = corporateActionSchema.parse(req.body);
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const result = await app.persistence.withTransactionWriteLock(userId, async (writer) => {
      const latestStore = await writer.loadStore(userId);
      const draftStore = structuredClone(latestStore);
      assertStoreIntegrity(draftStore);
      requireAccount(draftStore, body.accountId);
      const id = randomUUID();
      let preview = null;
      const responseAction = body.actionType === "DIVIDEND"
        ? applyCorporateAction(draftStore, { id, ...body })
        : (() => {
            const input = {
              id,
              accountId: body.accountId,
              ticker: body.ticker,
              actionType: body.actionType,
              numerator: body.numerator,
              denominator: body.denominator,
              actionDate: body.actionDate,
              actionTimestamp: body.actionTimestamp,
              cashInLieuAmount: body.cashInLieuAmount,
              cashInLieuCurrency: body.cashInLieuCurrency,
            };
            preview = previewPositionAction(draftStore, input);
            return createPositionAction(draftStore, input);
          })();
      const positionAction = draftStore.accounting.facts.positionActions.find((action) => action.id === id);
      if (!positionAction) throw new Error(`position action ${id} missing before replay`);

      const simulation = new MemoryPersistence({ seedCatalog: false, seedDevBypassUser: false });
      await simulation.saveStore(structuredClone(draftStore));
      const replaySummary = await replayPositionHistory(
        simulation,
        userId,
        positionAction.accountId,
        positionAction.ticker,
        { marketCode: positionAction.marketCode },
      );
      const replayedStore = await simulation.loadStore(userId);
      assertStoreIntegrity(replayedStore);
      const appliedDividendChanges = await writer.saveReplayedPositionScope(userId, replayedStore.accounting, {
        accountId: positionAction.accountId,
        ticker: positionAction.ticker,
        marketCode: positionAction.marketCode,
        newPositionActionId: positionAction.id,
        dividendLedgerChanges: replaySummary.dividendLedgerChanges,
      });
      return {
        responseAction,
        positionAction,
        preview,
        replaySummary: { ...replaySummary, dividendLedgerChanges: appliedDividendChanges },
      };
    });
    if (body.actionType === "DIVIDEND") {
      return result.responseAction;
    }

    const action = result.positionAction;
    scheduleCommittedReplayFollowUp(app.persistence, app.eventBus, userId, result.replaySummary, {
      snapshotFromDate: action.actionDate,
      marketCode: action.marketCode,
    });
    await app.eventBus.publishEvent(userId, "position_action_posted", {
      positionActionId: action.id,
      accountId: action.accountId,
      ticker: action.ticker,
      marketCode: action.marketCode,
      actionDate: action.actionDate,
    });
    return {
      ...action,
      numerator: action.ratioNumerator,
      denominator: action.ratioDenominator,
      preview: result.preview,
      replaySummary: result.replaySummary,
    };
  });

  app.post("/portfolio/snapshots/generate", async (req, reply) => {
    const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const generationRunId = randomUUID();

    reply.code(202).send({ generationRunId });

    setImmediate(async () => {
      try {
        const result = await generateHoldingSnapshots(userId, app.persistence, { generationRunId });

        // KZO-185/KZO-197: producer stamps marketCode from the walker's result.
        // The canonical singleton key keeps sibling markets and KR repair modes distinct.
        if (app.boss && result.tickersNeedingBackfill.length > 0) {
          for (const { ticker, marketCode } of result.tickersNeedingBackfill) {
            try {
              await app.boss.send(
                BACKFILL_QUEUE,
                {
                  ticker,
                  marketCode: marketCode as BackfillJobData["marketCode"],
                  trigger: "first_trade",
                  includeBars: true,
                } satisfies BackfillJobData,
                { singletonKey: getBackfillSingletonKey(ticker, marketCode) },
              );
            } catch {
              // Backfill queue unavailable — provisional data remains
            }
          }
        }

        await app.eventBus.publishEvent(userId, "snapshots_generated", {
          status: "ok",
          totalRows: result.totalRows,
          provisionalRows: result.provisionalRows,
          dateRange: result.dateRange ?? null,
          generationRunId: result.generationRunId,
        });

        // KZO-165: run the wallet aggregator AFTER the holding snapshots succeed.
        // Wrap in its own try/catch so a wallet failure does not mask a successful
        // holding-snapshot generation. Emit a distinct SSE event so the client can
        // render the wallet-stub failure separately if KZO-176's dashboard reads it.
        try {
          await generateCurrencyWalletSnapshots(userId, app.persistence);
        } catch (walletError) {
          const walletMessage = walletError instanceof Error ? walletError.message : String(walletError);
          console.error("[snapshot-generate:wallet] Failed:", walletMessage);
          try {
            await app.eventBus.publishEvent(userId, "wallet_generation_failed", {
              error: walletMessage,
            });
          } catch { /* swallow — best effort */ }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[snapshot-generate] Failed:", message);
        // Surface the failure with a distinct status so the client can render
        // an error state instead of "0 snapshots generated" success text.
        try {
          await app.eventBus.publishEvent(userId, "snapshots_generated", {
            status: "error",
            totalRows: 0,
            provisionalRows: 0,
            dateRange: null,
            generationRunId,
            error: message,
          });
        } catch { /* swallow — best effort */ }
      }
    });

    return reply;
  });

  app.post("/portfolio/recompute/preview", async (req) => {
    const body = z
      .object({
        profileId: userScopedIdSchema.optional(),
        accountId: userScopedIdSchema.optional(),
        useFallbackBindings: z.boolean().default(true),
        forceProfileOnly: z.boolean().default(false),
        mode: z.enum(["KEEP_RECORDED", "RECALCULATE_CALCULATED"]).default("KEEP_RECORDED"),
      })
      .parse(req.body);

    if (body.forceProfileOnly && !body.profileId) {
      throw routeError(400, "profile_required", "profileId is required when forceProfileOnly is enabled.");
    }

    const { userId, store } = await loadUserStore(app, req);
    assertStoreIntegrity(store);

    if (body.accountId) {
      const account = store.accounts.find((item) => item.id === body.accountId);
      if (!account) throw routeError(404, "account_not_found", `Account ${body.accountId} was not found.`);
    }

    if (body.profileId) {
      requireProfile(store, body.profileId);
    }

    const selectedAccountIds = [...new Set(store.accounting.facts.tradeEvents
      .filter((trade) => trade.userId === userId && (!body.accountId || trade.accountId === body.accountId))
      .map((trade) => trade.accountId))];
    const accountRevisions = Object.fromEntries(await Promise.all(selectedAccountIds.map(async (accountId) => [
      accountId,
      await app.persistence.getAccountAccountingRevision(userId, accountId),
    ] as const)));
    const job = previewRecompute(store, {
      userId,
      profileId: body.profileId,
      accountId: body.accountId,
      useFallbackBindings: body.forceProfileOnly ? false : body.useFallbackBindings,
      mode: body.mode,
      accountRevisions,
    });

    await app.persistence.saveRecomputeJob(job);
    return {
      id: job.id,
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      fingerprint: job.fingerprint,
      expiresAt: job.expiresAt,
      counts: job.counts,
      impactsByCurrency: job.impactsByCurrency,
    };
  });

  app.post("/portfolio/recompute/confirm", async (req) => {
    const body = z.object({
      jobId: userScopedIdSchema,
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }).parse(req.body);
    const { userId, store } = await loadUserStore(app, req);
    const workingStore = structuredClone(store);
    let job: RecomputeJob;
    let ownsRunningJob = false;
    try {
      job = await confirmRecompute(workingStore, userId, body.jobId, body.fingerprint, new Date(), {
        onRunning: async (runningJob) => {
          const started = await app.persistence.startRecomputeJob(
            userId,
            runningJob.id,
            runningJob.startedAt ?? new Date().toISOString(),
          );
          if (!started) throw routeError(409, "recompute_preview_consumed", "Recompute preview is no longer confirmable");
          ownsRunningJob = true;
        },
        onFailed: async (failedJob) => {
          await app.persistence.failRecomputeJob(userId, failedJob.id, {
            startedAt: failedJob.startedAt!,
            completedAt: failedJob.completedAt ?? new Date().toISOString(),
            errorCode: failedJob.errorCode ?? "recompute_failed",
            errorMessage: failedJob.errorMessage ?? "Recompute failed",
          });
        },
      });
      const committed = await app.persistence.commitRecomputeStore(userId, workingStore.accounting, job);
      if (!committed) throw routeError(409, "recompute_preview_consumed", "Recompute preview is no longer confirmable");
    } catch (error) {
      const failedJob = workingStore.recomputeJobs.find((candidate) => candidate.id === body.jobId);
      if (ownsRunningJob && failedJob?.startedAt) {
        await app.persistence.failRecomputeJob(userId, body.jobId, {
          startedAt: failedJob.startedAt,
          completedAt: new Date().toISOString(),
          errorCode: typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
            ? error.code
            : "recompute_failed",
          errorMessage: error instanceof Error ? error.message : String(error),
        }).catch(() => false);
        failedJob.status = "FAILED";
      }
      throw error;
    }

    // The scoped atomic replay updates canonical accounting while leaving
    // daily_holding_snapshots stale. Trigger a full regeneration
    // asynchronously so the caller doesn't block on the walker. Mirrors the
    // pattern in POST /portfolio/snapshots/generate.
    const snapshotRunId = randomUUID();
    setImmediate(async () => {
      try {
        const result = await generateHoldingSnapshots(userId, app.persistence, {
          generationRunId: snapshotRunId,
        });
        // KZO-185/KZO-197: producer stamps marketCode + canonical singletonKey
        // (parity with snapshots/generate at line 3899 above and the
        // daily-refresh cron in dailyRefreshEnqueue.ts).
        if (app.boss && result.tickersNeedingBackfill.length > 0) {
          for (const { ticker, marketCode } of result.tickersNeedingBackfill) {
            try {
              await app.boss.send(
                BACKFILL_QUEUE,
                {
                  ticker,
                  marketCode: marketCode as BackfillJobData["marketCode"],
                  trigger: "first_trade",
                  includeBars: true,
                } satisfies BackfillJobData,
                { singletonKey: getBackfillSingletonKey(ticker, marketCode) },
              );
            } catch {
              // Backfill queue unavailable — provisional data remains.
            }
          }
        }
        await app.eventBus.publishEvent(userId, "snapshots_generated", {
          status: "ok",
          totalRows: result.totalRows,
          provisionalRows: result.provisionalRows,
          dateRange: result.dateRange ?? null,
          generationRunId: result.generationRunId,
        });

        // KZO-165: wallet aggregator runs sequentially after holding snapshots.
        // Isolated try/catch — a wallet failure must not mask a successful
        // holding-snapshot generation.
        try {
          await generateCurrencyWalletSnapshots(userId, app.persistence);
        } catch (walletError) {
          const walletMessage = walletError instanceof Error ? walletError.message : String(walletError);
          console.error("[recompute-confirm:wallet] Failed:", walletMessage);
          try {
            await app.eventBus.publishEvent(userId, "wallet_generation_failed", {
              error: walletMessage,
            });
          } catch { /* swallow — best effort */ }
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("[recompute-confirm:snapshots] Failed:", message);
        try {
          await app.eventBus.publishEvent(userId, "snapshots_generated", {
            status: "error",
            totalRows: 0,
            provisionalRows: 0,
            dateRange: null,
            generationRunId: snapshotRunId,
            error: message,
          });
        } catch { /* swallow — best effort */ }
      }
    });

    return {
      jobId: job.id,
      status: job.status,
      mode: job.mode,
      counts: job.counts,
      holdingSnapshotGenerationRunId: snapshotRunId,
      walletSnapshotRefreshQueued: true,
    };
  });

  app.get("/quotes", async (req) => {
    resolveUserId(req, app.oauthConfig?.sessionSecret);
    const query = z.object({ tickers: z.string().max(200) }).parse(req.query);
    const tickers = query.tickers
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((symbol) => tickerSchema.parse(symbol));

    if (tickers.length === 0) {
      throw routeError(400, "tickers_required", "At least one ticker is required.");
    }
    if (tickers.length > 20) {
      throw routeError(400, "too_many_symbols", "No more than 20 symbols are allowed per request.");
    }

    // KZO-191: /quotes has no `store` context — pass pairs with no marketCode.
    // Per the tolerant-pair contract in resolveQuoteSnapshots, missing
    // marketCode → isProvisional=false (same fallback as manual instruments).
    return resolveQuoteSnapshots(
      tickers.map((ticker) => ({ ticker })),
      app.persistence,
      new Map(),
    );
  });

  app.get("/ai/transaction-drafts/badge", async (req): Promise<TransactionAiInboxBadgeDto> => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "portfolio:mcp_read");
    const batches = await app.persistence.listAiTransactionDraftBatchesForOwner(
      requestContext.resolvedContext.portfolioContextUserId,
    );
    const openBatches = batches.filter((batch) => batch.status === "open");
    const rowsByBatch = await Promise.all(
      openBatches.map((batch) => app.persistence.listAiTransactionDraftRows(batch.id)),
    );
    const rows = rowsByBatch.flat();
    return {
      openBatchCount: openBatches.length,
      actionRequiredRowCount: draftActionRows(rows).length,
      readyRowCount: rows.filter((row) => row.state === "ready").length,
      latestBatchId: openBatches[0]?.id ?? null,
    };
  });

  app.get("/ai/transaction-drafts", async (req) => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "portfolio:mcp_read");
    const query = z.object({
      status: z.enum(["open", "archived", "deleted"]).optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }).parse(req.query);
    const batches = await listTransactionDraftBatches({ app, requestContext }, {
      status: query.status,
      limit: query.limit,
    });
    return {
      batches: batches.map((batch) => toTransactionDraftBatchDto(app, batch)),
    };
  });

  app.get("/ai/transaction-drafts/:batchId", async (req) => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "portfolio:mcp_read");
    const params = z.object({ batchId: userScopedIdSchema }).parse(req.params);
    const aggregate = assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    return await toTransactionDraftDetailDto(app, aggregate);
  });

  const draftRowPatchSchema = z.object({
    expectedVersion: z.number().int().min(1),
    patch: z.object({
      accountId: userScopedIdSchema.nullish(),
      accountName: z.string().trim().min(1).max(200).nullish(),
      type: z.enum(["BUY", "SELL"]).nullish(),
      ticker: tickerSchema.nullish(),
      marketCode: marketCodeSchema.nullish(),
      quantity: z.number().positive().nullish(),
      unitPrice: z.number().positive().nullish(),
      priceCurrency: currencyCodeSchema.nullish(),
      tradeDate: isoDateSchema.nullish(),
      tradeTimestamp: isoDateTimeSchema.nullish(),
      bookingSequence: z.number().int().positive().nullish(),
      isDayTrade: z.boolean().nullish(),
      commissionAmount: bookedChargeFieldSchema("Commission").nullish(),
      taxAmount: bookedChargeFieldSchema("Tax").nullish(),
      note: z.string().trim().max(1_000).nullish(),
      sourceSnippet: z.string().trim().max(500).nullish(),
    }).strict(),
  }).strict();

  app.patch("/ai/transaction-drafts/:batchId/rows/:rowId", async (req) => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "transaction_draft:edit");
    const params = z.object({ batchId: userScopedIdSchema, rowId: userScopedIdSchema }).parse(req.params);
    assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    const body = draftRowPatchSchema.parse(req.body);
    await updateTransactionDraftRows({ app, requestContext }, {
      batchId: params.batchId,
      rows: [{
        rowId: params.rowId,
        expectedVersion: body.expectedVersion,
        patch: Object.fromEntries(
          Object.entries(body.patch).filter(([, value]) => value !== undefined),
        ),
      }],
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "transaction_draft_row_updated",
      routeKey: "PATCH /ai/transaction-drafts/:batchId/rows/:rowId",
      batchId: params.batchId,
      rowId: params.rowId,
    });
    const updated = assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    await app.eventBus.publishEvent(requestContext.resolvedContext.portfolioContextUserId, "ai_transaction_draft_updated", {
      batchId: params.batchId,
      rowId: params.rowId,
    });
    return await toTransactionDraftDetailDto(app, updated);
  });

  const draftRowIdsBodySchema = z.object({
    rowIds: z.array(userScopedIdSchema).min(1).max(200),
    expectedBatchVersion: z.number().int().min(1),
  }).strict();

  async function transitionDraftRowsFromWeb(
    req: FastifyRequest,
    capability: ShareCapability,
    mutation: string,
    routeKey: string,
    run: (requestContext: McpRequestContext, input: { batchId: string; rowIds: string[]; expectedBatchVersion: number }) => Promise<unknown>,
  ) {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, capability);
    const params = z.object({ batchId: userScopedIdSchema }).parse(req.params);
    assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    const body = draftRowIdsBodySchema.parse(req.body);
    await run(requestContext, { batchId: params.batchId, rowIds: body.rowIds, expectedBatchVersion: body.expectedBatchVersion });
    await appendDelegatedWriteAudit(app, req, {
      mutation,
      routeKey,
      batchId: params.batchId,
      rowIds: body.rowIds,
    });
    const updated = assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    await app.eventBus.publishEvent(requestContext.resolvedContext.portfolioContextUserId, "ai_transaction_draft_updated", {
      batchId: params.batchId,
      rowIds: body.rowIds,
    });
    return await toTransactionDraftDetailDto(app, updated);
  }

  app.post("/ai/transaction-drafts/:batchId/exclude", (req) =>
    transitionDraftRowsFromWeb(req, "transaction_draft:edit", "transaction_draft_rows_excluded", "POST /ai/transaction-drafts/:batchId/exclude", (requestContext, input) =>
      excludeTransactionDraftRows({ app, requestContext }, input)));

  app.post("/ai/transaction-drafts/:batchId/reinclude", (req) =>
    transitionDraftRowsFromWeb(req, "transaction_draft:edit", "transaction_draft_rows_reincluded", "POST /ai/transaction-drafts/:batchId/reinclude", (requestContext, input) =>
      reincludeTransactionDraftRows({ app, requestContext }, input)));

  app.post("/ai/transaction-drafts/:batchId/reject", (req) =>
    transitionDraftRowsFromWeb(req, "transaction_draft:edit", "transaction_draft_rows_rejected", "POST /ai/transaction-drafts/:batchId/reject", (requestContext, input) =>
      rejectTransactionDraftRows({ app, requestContext }, input)));

  const draftBatchVersionBodySchema = z.object({
    expectedBatchVersion: z.number().int().min(1),
  }).strict();

  app.post("/ai/transaction-drafts/:batchId/archive", async (req) => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "transaction_draft:archive");
    const params = z.object({ batchId: userScopedIdSchema }).parse(req.params);
    assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    const body = draftBatchVersionBodySchema.parse(req.body);
    await archiveTransactionDraftBatch({ app, requestContext }, {
      batchId: params.batchId,
      expectedBatchVersion: body.expectedBatchVersion,
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "transaction_draft_batch_archived",
      routeKey: "POST /ai/transaction-drafts/:batchId/archive",
      batchId: params.batchId,
    });
    const updated = assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    await app.eventBus.publishEvent(requestContext.resolvedContext.portfolioContextUserId, "ai_transaction_draft_updated", {
      batchId: params.batchId,
      status: updated.batch.status,
    });
    return await toTransactionDraftDetailDto(app, updated);
  });

  app.delete("/ai/transaction-drafts/:batchId", async (req) => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "transaction_draft:delete");
    const params = z.object({ batchId: userScopedIdSchema }).parse(req.params);
    assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    const body = draftBatchVersionBodySchema.parse(req.body ?? {});
    await deleteUnconfirmedTransactionDraftBatch({ app, requestContext }, {
      batchId: params.batchId,
      expectedBatchVersion: body.expectedBatchVersion,
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "transaction_draft_batch_deleted",
      routeKey: "DELETE /ai/transaction-drafts/:batchId",
      batchId: params.batchId,
    });
    await app.eventBus.publishEvent(requestContext.resolvedContext.portfolioContextUserId, "ai_transaction_draft_updated", {
      batchId: params.batchId,
      status: "deleted",
    });
    return { ok: true };
  });

  app.post("/ai/transaction-drafts/:batchId/confirm", async (req) => {
    const requestContext = await loadWebMcpContext(app, req);
    requireWebDraftCapability(requestContext.resolvedContext, "transaction:write");
    const params = z.object({ batchId: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedRowVersions: z.array(z.object({
        rowId: userScopedIdSchema,
        expectedVersion: z.number().int().min(1),
      }).strict()).min(1).max(200),
      expectedBatchVersion: z.number().int().min(1),
      idempotencyKey: z.string().trim().min(8).max(200),
      typedConfirmation: z.string().trim().max(100).optional(),
    }).strict().parse(req.body);
    assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    const posting = await postTransactionDraftRows({ app, requestContext }, {
      batchId: params.batchId,
      rowIds: body.rowIds,
      expectedBatchVersion: body.expectedBatchVersion,
      expectedRowVersions: body.expectedRowVersions,
      idempotencyKey: body.idempotencyKey,
      typedConfirmation: body.typedConfirmation,
    });
    await appendDelegatedWriteAudit(app, req, {
      mutation: "transaction_draft_rows_posted",
      routeKey: "POST /ai/transaction-drafts/:batchId/confirm",
      batchId: params.batchId,
      rowIds: body.rowIds,
    });
    const updated = assertDraftAggregateInWebContext(
      requestContext.resolvedContext,
      await app.persistence.getAiTransactionDraftBatch(params.batchId),
    );
    return {
      ...(await toTransactionDraftDetailDto(app, updated)),
      posting,
    };
  });

  app.get("/ai/connectors", async (req) => {
    const userId = requireSessionUserId(req);
    const [connections, accessLogs, policy] = await Promise.all([
      app.persistence.listAiConnectorConnectionsForUser(userId),
      app.persistence.listAiConnectorAccessLogsForUser(userId, { limit: 50 }),
      app.persistence.getAiConnectorPolicySettings(),
    ]);
    const visibleConnections = connections.filter(connectorVisibleInOperationalView);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    return {
      connections: visibleConnections.map(toAiConnectorConnectionDto),
      historyCount: connections.filter(connectorVisibleInHistoryView).length,
      accessLogs: accessLogs.map((log) => toAiConnectorAccessLogDto(log, log.connectionId ? connectionById.get(log.connectionId) : null)),
      policy: toAiConnectorPolicySettingsDto(policy),
    };
  });

  app.get("/ai/connectors/history", async (req) => {
    const userId = requireSessionUserId(req);
    const query = z.object({
      status: z.enum(["expired", "revoked"]).optional(),
      clientKind: z.enum(["chatgpt_app", "claude_ai_connector", "claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"]).optional(),
      includeHidden: queryBooleanSchema.default(false),
    }).parse(req.query);
    const connections = await app.persistence.listAiConnectorConnectionsForUser(userId);
    return {
      connections: connections
        .filter((connection) => query.includeHidden || !connection.hiddenAt)
        .filter((connection) => connection.status === "expired" || connection.status === "revoked")
        .filter((connection) => query.status === undefined || connection.status === query.status)
        .filter((connection) => query.clientKind === undefined || connection.clientKind === query.clientKind)
        .map(toAiConnectorConnectionDto),
    };
  });

  app.get("/ai/connectors/summary", async (req, reply) => {
    return withReadPathTiming(req, reply, "/ai/connectors/summary", async (timing) => {
      const userId = requireSessionUserId(req);
      const [connections, policy] = await timing.measure("load_connector_summary", "db", () => Promise.all([
        app.persistence.listAiConnectorConnectionsForUser(userId),
        app.persistence.getAiConnectorPolicySettings(),
      ]));
      const visibleConnections = connections.filter(connectorVisibleInOperationalView);
      const activeConnections = connections.filter(connectorEligibleForEffectiveAccess);
      return {
        connections: visibleConnections.map(toAiConnectorConnectionDto),
        policy: toAiConnectorPolicySettingsDto(policy),
        toolCatalog: buildAiConnectorToolCatalog(policy, activeConnections),
      } satisfies AiConnectorSummaryDto;
    });
  });

  app.get("/ai/connectors/logs", async (req, reply) => {
    return withReadPathTiming(req, reply, "/ai/connectors/logs", async (timing) => {
      const userId = requireSessionUserId(req);
      const query = z.object({
        limit: z.coerce.number().int().min(1).max(50).default(12),
        offset: z.coerce.number().int().min(0).default(0),
        result: z.enum(["ok", "denied", "error"]).optional(),
        search: z.string().trim().max(120).optional(),
        connectionId: userScopedIdSchema.optional(),
        clientKind: z.enum(["chatgpt_app", "claude_ai_connector", "claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"]).optional(),
      }).parse(req.query);
      const connections = await timing.measure("load_connector_log_connections", "db", () =>
        app.persistence.listAiConnectorConnectionsForUser(userId));
      let connectionIds: string[] | undefined;
      if (query.connectionId || query.clientKind) {
        connectionIds = connections
          .filter((connection) => query.connectionId === undefined || connection.id === query.connectionId)
          .filter((connection) => query.clientKind === undefined || connection.clientKind === query.clientKind)
          .map((connection) => connection.id);
      }
      const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
      const accessLogs = await timing.measure("load_connector_logs", "db", () =>
        app.persistence.listAiConnectorAccessLogsForUser(userId, {
          limit: query.limit + 1,
          offset: query.offset,
          result: query.result,
          search: query.search,
          connectionIds,
        }));
      const pageLogs = accessLogs.slice(0, query.limit);
      return {
        accessLogs: pageLogs.map((log) => toAiConnectorAccessLogDto(log, log.connectionId ? connectionById.get(log.connectionId) : null)),
        nextOffset: accessLogs.length > query.limit ? query.offset + pageLogs.length : null,
        hasMore: accessLogs.length > query.limit,
      };
    });
  });

  app.post("/ai/connectors/bearer", async (req) => {
    const userId = requireSessionUserId(req);
    const body = z.object({
      clientKind: aiConnectorBearerClientKindSchema,
      displayName: z.string().trim().min(1).max(120),
      scopes: aiConnectorScopesSchema.min(1),
      lifetimeDays: z.number().int().min(1).max(365),
    }).strict().parse(req.body);

    const created = await createAiConnectorBearerFallback(
      app,
      {
        userId,
        clientKind: body.clientKind,
        displayName: body.displayName,
        scopes: body.scopes,
        lifetimeDays: body.lifetimeDays,
      },
      { actorUserId: userId, ipAddress: req.ip ?? null },
    );

    return {
      connection: toAiConnectorConnectionDto(created.connection),
      bearerToken: created.bearerToken,
      tokenHint: created.tokenHint,
      expiresAt: created.expiresAt,
    };
  });

  app.patch("/ai/connectors/:id", async (req) => {
    const userId = requireSessionUserId(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const body = z.object({
      scopes: aiConnectorScopesSchema.optional(),
      toolToggles: z.record(z.string().min(1).max(120), z.boolean()).optional(),
      expiresAt: z.union([isoDateTimeSchema, z.null()]).optional(),
    }).strict().parse(req.body);
    const connection = await app.persistence.getAiConnectorConnection(params.id);
    if (!connection || connection.userId !== userId) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    const settings = await app.persistence.getAiConnectorPolicySettings();
    const requestedScopes = body.scopes ?? connection.scopes;
    const nextExpiresAt = body.expiresAt === undefined ? connection.expiresAt : body.expiresAt;
    if (
      connection.authMode === "bearer"
      && body.scopes !== undefined
      && requestedScopes.some((scope) => !connection.scopes.includes(scope))
    ) {
      throw routeError(
        400,
        "mcp_bearer_scope_expansion_requires_recreate",
        "Bearer connector scopes cannot be expanded after token creation; create a new bearer connector with the required scopes",
      );
    }
    if (
      connection.authMode === "oauth"
      && body.scopes !== undefined
      && requestedScopes.some((scope) => !connection.scopes.includes(scope))
    ) {
      throw routeError(
        400,
        "mcp_oauth_scope_expansion_requires_reconnect",
        "OAuth connector scopes cannot be expanded after consent; reconnect the connector with the required scopes",
      );
    }
    if (connection.authMode === "bearer" && body.expiresAt !== undefined && nextExpiresAt !== connection.expiresAt) {
      throw routeError(
        400,
        "mcp_bearer_connector_lifetime_immutable",
        "Bearer connector lifetime is fixed at token creation; create a new bearer connector to choose a different lifetime",
      );
    }
    const allowedScopes = requestedScopes.filter((scope) => settings.groupToggles[connectorGroupForScope(scope)]);
    if (connection.oauthClientId && nextExpiresAt !== connection.expiresAt) {
      throw routeError(
        400,
        "mcp_oauth_connector_lifetime_immutable",
        "OAuth connector lifetime is fixed at consent; revoke and reconnect to choose a different lifetime",
      );
    }
    const updated = await app.persistence.saveAiConnectorConnection({
      ...connection,
      scopes: allowedScopes,
      toolToggles: body.toolToggles ?? connection.toolToggles,
      expiresAt: nextExpiresAt,
      updatedAt: new Date().toISOString(),
    });
    await app.persistence.appendAuditLog({
      actorUserId: userId,
      action: "app_config_updated",
      targetUserId: userId,
      ipAddress: req.ip,
      metadata: {
        type: "ai_connector_connection",
        connectionId: updated.id,
        scopes: updated.scopes,
        toolToggles: updated.toolToggles,
        expiresAt: updated.expiresAt,
      },
    });
    return toAiConnectorConnectionDto(updated);
  });

  app.delete("/ai/connectors/:id", async (req) => {
    const userId = requireSessionUserId(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const connection = await app.persistence.getAiConnectorConnection(params.id);
    if (!connection || connection.userId !== userId) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    const revoked = await revokeAiConnectorConnection(app, params.id, {
      revokedByUserId: userId,
      reason: "user_revoked",
      ipAddress: req.ip,
    });
    return toAiConnectorConnectionDto(revoked);
  });

  app.post("/ai/connectors/:id/hide", async (req) => {
    const userId = requireSessionUserId(req);
    const params = z.object({ id: userScopedIdSchema }).parse(req.params);
    const connection = await app.persistence.getAiConnectorConnection(params.id);
    if (!connection || connection.userId !== userId) {
      throw routeError(404, "ai_connector_connection_not_found", "AI connector connection not found");
    }
    if (connection.status !== "revoked" && connection.status !== "expired") {
      throw routeError(409, "ai_connector_hide_requires_history", "Only expired or revoked AI connector history can be hidden");
    }
    const hidden = await app.persistence.saveAiConnectorConnection({
      ...connection,
      hiddenAt: connection.hiddenAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    await app.persistence.appendAuditLog({
      actorUserId: userId,
      action: "app_config_updated",
      targetUserId: userId,
      ipAddress: req.ip,
      metadata: {
        type: "ai_connector_connection_hidden",
        connectionId: hidden.id,
        hiddenAt: hidden.hiddenAt,
      },
    });
    return toAiConnectorConnectionDto(hidden);
  });

  app.post("/ai/transactions/parse", async (req) => {
    const body = z.object({ text: z.string().min(1).max(5_000) }).parse(req.body);
    const proposals = body.text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 200)
      .map((line, idx) => {
        const [type = "BUY", symbol = "2330", qty = "1", price = "100", tradeDate = "2026-01-01"] = line.split(/\s+/);

        const proposalType = z.enum(["BUY", "SELL"]).parse(type.toUpperCase());
        return {
          id: `proposal-${idx + 1}`,
          type: proposalType,
          ticker: tickerSchema.parse(symbol),
          quantity: z.coerce.number().int().positive().parse(qty),
          unitPrice: z.coerce.number().positive().multipleOf(0.01).parse(price),
          priceCurrency: "TWD",
          tradeDate: isoDateSchema.parse(tradeDate),
        };
      });

    return { proposals };
  });

  app.post("/ai/transactions/confirm", async (req) => {
    const body = z
      .object({
        accountId: userScopedIdSchema,
        proposals: z
          .array(
            z.object({
              type: z.enum(["BUY", "SELL"]),
              ticker: tickerSchema,
              quantity: z.number().int().positive(),
              unitPrice: z.number().positive().multipleOf(0.01),
              priceCurrency: currencyCodeSchema.default("TWD"),
              tradeDate: isoDateSchema,
              isDayTrade: z.boolean().optional(),
            }),
          )
          .min(1)
          .max(200),
      })
      .parse(req.body);

    const { store, userId } = await loadUserStore(app, req);
    const draftStore = structuredClone(store);
    assertStoreIntegrity(draftStore);
    const account = requireAccount(draftStore, body.accountId);
    const marketCode = marketCodeFor(account.defaultCurrency);

    const created = body.proposals.map((proposal, idx) =>
      createTransaction(draftStore, userId, {
        id: `${randomUUID()}-${idx}`,
        accountId: body.accountId,
        ticker: proposal.ticker,
        marketCode,
        quantity: proposal.quantity,
        unitPrice: proposal.unitPrice,
        priceCurrency: proposal.priceCurrency,
        tradeDate: proposal.tradeDate,
        type: proposal.type,
        isDayTrade: proposal.isDayTrade ?? false,
      }),
    );

    await app.persistence.saveAccountingStore(userId, draftStore.accounting);
    await appendDelegatedWriteAudit(app, req, {
      mutation: "ai_transaction_confirmed",
      routeKey: "POST /ai/transactions/confirm",
      accountId: body.accountId,
      tradeEventIds: created.map((transaction) => transaction.id),
    });

    // KZO-37 Invariant 5: each new trade may retroactively change the
    // eligibility of existing dividend ledger entries. Schedule a replay
    // per unique (accountId, ticker, market) affected by this batch, scoped to
    // the earliest trade date for that market-qualified ticker so snapshot
    // recompute stays narrow and never mixes cross-listed symbols.
    const earliestByTicker = new Map<string, { ticker: string; marketCode: typeof marketCode; fromDate: string }>();
    for (const proposal of body.proposals) {
      const key = `${proposal.ticker}:${marketCode}`;
      const prev = earliestByTicker.get(key);
      if (!prev || proposal.tradeDate < prev.fromDate) {
        earliestByTicker.set(key, { ticker: proposal.ticker, marketCode, fromDate: proposal.tradeDate });
      }
    }
    for (const item of earliestByTicker.values()) {
      scheduleReplayWithRetry(app.persistence, app.eventBus, userId, body.accountId, item.ticker, {
        snapshotFromDate: item.fromDate,
        marketCode: item.marketCode,
      });
    }

    return { created };
  });

  // --- Monitored Symbols ---

  app.get("/instruments", async (req, reply) => {
    return withReadPathTiming(req, reply, "/instruments", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const query = z
        .object({
          search: z.string().trim().min(1).max(100).optional(),
          type: z.enum(["STOCK", "ETF", "BOND_ETF"]).optional(),
          // KZO-169: optional `market_code` filter; "ALL" disables filtering.
          // Default ALL preserves back-compat with existing consumers.
          market_code: z.enum(MARKET_FILTER_CODES).default("ALL").optional(),
        })
        .parse(req.query);

      const cooldown = getEffectiveRepairCooldownMinutes();
      // KZO-169: pass `market_code` through to persistence; treat ALL/undefined
      // as "no filter".
      const marketFilter = query.market_code && query.market_code !== "ALL" ? query.market_code : undefined;
      const rows = await timing.measure("list_instruments_catalog", "db", () =>
        app.persistence.listInstrumentsCatalog(query.search, query.type, marketFilter, userId));
      return { instruments: rows.map((r) => ({ ...r, repairAvailableAt: deriveRepairAvailableAt(r.lastRepairAt, cooldown) })) };
    });
  });

  app.get("/monitored-tickers", async (req, reply) => {
    return withReadPathTiming(req, reply, "/monitored-tickers", async (timing) => {
      const { userId } = resolveUserId(req, app.oauthConfig?.sessionSecret);
      const cooldown = getEffectiveRepairCooldownMinutes();
      const rows = await timing.measure("get_monitored_set", "db", () => app.persistence.getMonitoredSet(userId));
      return { tickers: rows.map((r) => ({ ...r, repairAvailableAt: deriveRepairAvailableAt(r.lastRepairAt, cooldown) })) };
    });
  });

  app.put("/monitored-tickers", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    // KZO-169 (D7a): body shape change from `[ticker]` → `[{ticker, marketCode}]`.
    // KZO-188: optional `name` + `instrumentType` accompany live-sourced picks
    // (the AU live-search fallback in `InstrumentCatalogSheet`). When present
    // they are forwarded to `replaceManualSelections`, which upserts the
    // catalog row before the FK insert so un-catalogued AU tickers (e.g. CBA)
    // can be saved on Postgres without violating
    // `user_monitored_tickers_*_fkey`.
    const body = z
      .object({
        tickers: z
          .array(
            z.object({
              ticker: tickerSchema,
              marketCode: marketCodeSchema,
              name: z.string().trim().min(1).max(200).nullish(),
              instrumentType: z.enum(["STOCK", "ETF", "BOND_ETF"]).nullish(),
            }),
          )
          .max(500),
      })
      .parse(req.body);

    const result = await app.persistence.replaceManualSelections(userId, body.tickers);

    // KZO-126 / KZO-169 / KZO-197: enqueue backfill for genuinely new tickers
    // (demo users skip FinMind). Canonical singleton key keeps sibling-market
    // and KR repair scopes distinct.
    if (app.boss && !isDemo && result.newTickers.length > 0) {
      for (const sel of body.tickers) {
        if (!result.newTickers.includes(sel.ticker)) continue;
        await app.boss.send(
          BACKFILL_QUEUE,
          {
            ticker: sel.ticker,
            marketCode: sel.marketCode,
            userId,
            trigger: "user_selection",
          } satisfies BackfillJobData,
          { singletonKey: getBackfillSingletonKey(sel.ticker, sel.marketCode), priority: 0 },
        );
      }
    }

    const cooldown = getEffectiveRepairCooldownMinutes();
    const monitored = await app.persistence.getMonitoredSet(userId);
    const decorated = monitored.map((r) => ({
      ...r,
      repairAvailableAt: deriveRepairAvailableAt(r.lastRepairAt, cooldown),
    }));
    return { tickers: decorated, newTickers: result.newTickers };
  });

  // --- Backfill Retry (KZO-126) ---

  app.post("/backfill/retry", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z.object({ ticker: tickerSchema, marketCode: marketCodeSchema.optional() }).parse(req.body);

    if (isDemo) {
      throw routeError(403, "demo_restricted", "Backfill is not available for demo users");
    }
    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    // KZO-169: legacy retry route accepts ticker only; market is resolved via
    // the persisted instrument (TW priority on ticker-only lookup). The
    // resolved marketCode is stamped on the enqueued job + singleton key so
    // the worker doesn't have to re-derive.
    const instrument = await app.persistence.getInstrument(body.ticker, body.marketCode);
    if (!instrument) {
      throw routeError(404, "instrument_not_found", "Instrument not found in catalog");
    }
    if (instrument.barsBackfillStatus !== "failed") {
      throw routeError(400, "not_failed", "Backfill can only be retried for failed instruments");
    }

    // Reset status to pending before enqueuing
    await app.persistence.updateBackfillStatus(
      body.ticker,
      instrument.marketCode as import("@vakwen/domain").MarketCode,
      "pending",
    );

    await app.boss.send(
      BACKFILL_QUEUE,
      {
        ticker: body.ticker,
        marketCode: instrument.marketCode as import("@vakwen/domain").MarketCode,
        userId,
        trigger: "retry",
      } satisfies BackfillJobData,
      {
        singletonKey: getBackfillSingletonKey(
          body.ticker,
          instrument.marketCode as MarketCode,
        ),
        priority: 0,
      },
    );

    return { ticker: body.ticker, barsBackfillStatus: "pending" };
  });

  // --- Backfill Repair (KZO-86) ---

  app.post("/backfill/repair", async (req) => {
    const { userId, isDemo } = resolveUserId(req, app.oauthConfig?.sessionSecret);
    const body = z
      .object({
        tickers: z.array(tickerSchema).max(20).default([]),
        targets: z.array(z.object({
          ticker: tickerSchema,
          marketCode: marketCodeSchema.optional(),
        })).max(20).default([]),
        startDate: isoDateSchema.optional(),
        endDate: isoDateSchema.optional(),
        includeBars: z.boolean().default(true),
        includeDividends: z.boolean().default(true),
      })
      .superRefine((value, ctx) => {
        if (!value.includeBars && !value.includeDividends) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "includeBars and includeDividends cannot both be false",
            path: ["includeBars"],
          });
        }
        if (value.tickers.length === 0 && value.targets.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "tickers or targets is required",
            path: ["tickers"],
          });
        }
        if (value.tickers.length + value.targets.length > 20) {
          ctx.addIssue({
            code: z.ZodIssueCode.too_big,
            maximum: 20,
            type: "array",
            inclusive: true,
            message: "At most 20 repair targets are allowed",
            path: ["targets"],
          });
        }
        if (value.startDate && value.endDate && value.startDate > value.endDate) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "startDate must be before or equal to endDate",
            path: ["startDate"],
          });
        }
      })
      .parse(req.body);

    if (isDemo) {
      throw routeError(403, "demo_restricted", "Repair is not available for demo users");
    }
    if (!app.boss) {
      throw routeError(503, "queue_unavailable", "Job queue is not available");
    }

    const nowMs = Date.now();
    const effectiveCooldown = getEffectiveRepairCooldownMinutes();
    const queued: string[] = [];
    const rejected: Array<{ ticker: string; reason: string }> = [];
    const repairTargets = [
      ...body.tickers.map((ticker) => ({ ticker, marketCode: undefined })),
      ...body.targets,
    ];

    for (const target of repairTargets) {
      const { ticker, marketCode } = target;
      const responseTicker = marketCode ? `${ticker}|${marketCode}` : ticker;
      // KZO-169: same as retry — resolve market from persisted instrument.
      const instrument = await app.persistence.getInstrument(ticker, marketCode);
      if (!instrument) {
        rejected.push({ ticker: responseTicker, reason: "instrument_not_found" });
        continue;
      }

      if (instrument.barsBackfillStatus === "pending" || instrument.barsBackfillStatus === "backfilling") {
        rejected.push({ ticker: responseTicker, reason: `status_${instrument.barsBackfillStatus}` });
        continue;
      }

      if (instrument.lastRepairAt) {
        const minutes = remainingCooldownMinutes(instrument.lastRepairAt, effectiveCooldown, nowMs);
        if (minutes > 0) {
          rejected.push({ ticker: responseTicker, reason: `cooldown_active:${minutes}` });
          continue;
        }
      }

      await app.boss.send(
        BACKFILL_QUEUE,
        {
          ticker,
          marketCode: instrument.marketCode as import("@vakwen/domain").MarketCode,
          userId,
          trigger: "repair",
          startDate: body.startDate,
          endDate: body.endDate,
          includeBars: body.includeBars,
          includeDividends: body.includeDividends,
        } satisfies BackfillJobData,
        {
          singletonKey: getBackfillSingletonKey(ticker, instrument.marketCode as MarketCode),
          priority: 5,
        },
      );
      queued.push(responseTicker);
    }

    return { queued, rejected };
  });

  // --- Notifications (KZO-132) ---

  app.get("/notifications", async (req) => {
    const userId = requireSessionUserId(req);
    const query = z
      .object({
        page: z.coerce.number().int().positive().default(1),
        limit: z.coerce.number().int().positive().max(100).default(20),
      })
      .parse(req.query);
    const { notifications, total } = await app.persistence.getNotificationsForUser(userId, query);
    return { notifications, total, page: query.page, limit: query.limit };
  });

  app.get("/notifications/unread-count", async (req) => {
    const userId = requireSessionUserId(req);
    const count = await app.persistence.getUnreadCount(userId);
    return { count };
  });

  app.patch("/notifications/:id/read", async (req) => {
    const userId = requireSessionUserId(req);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.markNotificationRead(userId, id);
    return { status: "ok" };
  });

  app.patch("/notifications/read-all", async (req) => {
    const userId = requireSessionUserId(req);
    await app.persistence.markAllRead(userId);
    return { status: "ok" };
  });

  app.delete("/notifications/:id", async (req) => {
    const userId = requireSessionUserId(req);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.dismissNotification(userId, id);
    return { status: "ok" };
  });

  app.patch("/notifications/:id/escalate", async (req) => {
    const userId = requireSessionUserId(req);
    const { id } = z.object({ id: userScopedIdSchema }).parse(req.params);
    await app.persistence.markNotificationEscalated(userId, id);
    return { status: "ok" };
  });

  // ── Admin portal routes (KZO-144 / KZO-142) ───────────────────────────────
  await app.register(adminRoutes, { prefix: "/admin" });

  registerSSERoute(app, requireSessionUserId);
}

// assertNotLastAdmin moved to persistence layer (assertNotLastAdminTx) for atomic check+mutation
