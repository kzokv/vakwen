import { z } from "zod";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  REPORT_CURRENCY_MODES,
  REPORT_SCOPES,
  type AiConnectorToolGroup,
  type AiConnectorAccessKind,
  type AiConnectorScope,
} from "@vakwen/shared-types";
import { unrealizedPnlAnalysisMcpInputSchema } from "../services/unrealizedPnlAnalysis.js";
import { bookedChargeFieldSchema } from "../validation/bookedCharge.js";
import {
  researchIdentityOutputSchema,
  researchIdentityQuerySchema,
  researchManifestOutputSchema,
  researchQuerySchema,
} from "../services/research/contracts.js";
import {
  researchMcpExposureEnabled,
  researchScopeAcquisitionAllowed,
} from "../services/research/rollout.js";
export {
  researchAcquisitionEnabled,
  researchMcpExposureEnabled,
  researchScopeAcquisitionAllowed,
  researchSkillExposureEnabled,
  setResearchRolloutOverrideForTest,
} from "../services/research/rollout.js";

const adviceBoundary =
  "Descriptive portfolio and draft workflow only. Do not use this tool for investment, tax, suitability, target-price, buy/sell/hold, or rebalancing advice.";

const genericMcpToolOutputSchema = z.object({}).passthrough();

export interface McpToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

const readOnlyToolAnnotations: McpToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const boundedWriteToolAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const idempotentBoundedWriteToolAnnotations: McpToolAnnotations = {
  ...boundedWriteToolAnnotations,
  idempotentHint: true,
};

const destructiveWriteToolAnnotations: McpToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
};

const idempotentDestructiveWriteToolAnnotations: McpToolAnnotations = {
  ...destructiveWriteToolAnnotations,
  idempotentHint: true,
};

const userScopedIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^[A-Za-z0-9._:-]+$/);

const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);
const accountDefaultCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);
const marketCodeSchema = z.enum(MARKET_CODES);
const reportScopeSchema = z.enum(REPORT_SCOPES);
const reportCurrencyModeSchema = z.enum(REPORT_CURRENCY_MODES);
const adminCalendarMarketCodeSchema = z.enum(["TW", "US", "AU", "KR", "JP"]);
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const isoDateTimeSchema = z.string().datetime({ offset: true });
const importSourceTypeSchema = z.enum(["csv", "image", "pdf"]);
const portfolioSelectorSchema = z.object({
  label: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200).optional(),
}).strict();
const accountNameSchema = z.string().trim().min(1).max(120);
const accountNameListSchema = z.array(accountNameSchema).max(100);
const tickerMarketSchema = z.object({
  ticker: z.string().trim().min(1).max(32),
  marketCode: marketCodeSchema,
}).strict();
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
  currencyCode: currencyCodeSchema.optional(),
  withheldAtSource: z.boolean().optional(),
  source: userScopedIdSchema.optional(),
  sourceReference: userScopedIdSchema.optional(),
  note: z.string().trim().min(1).max(200).optional(),
}).strict();
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
  currencyCode: z.literal("TWD").optional(),
  source: userScopedIdSchema.optional(),
  sourceReference: userScopedIdSchema.optional(),
  note: z.string().trim().min(1).max(200).optional(),
}).strict();
const maintenanceScopeShape = {
  accountIds: z.array(userScopedIdSchema).max(50).optional(),
  accountNames: accountNameListSchema.optional(),
  tickerMarkets: z.array(tickerMarketSchema).max(100).optional(),
} as const;
const accountScopeShape = {
  accountIds: z.array(userScopedIdSchema).max(50).optional(),
  accountNames: accountNameListSchema.optional(),
} as const;
const batchLabelSchema = z.string().trim().min(1).max(200);
const confirmationSummarySchema = z.string().trim().min(1).max(10_000);
const confirmationDigestSchema = z.string().trim().regex(/^[a-f0-9]{64}$/i);
const appOnlyVisibilityMeta = { ui: { visibility: ["app"] as const } };
const postedTransactionMutationReasonSchema = z.string().trim().min(1).max(500);
const postedTransactionMutationNoteSchema = z.string().trim().max(500);

const candidateSourceMetadataSchema = z.object({
  fileId: userScopedIdSchema.nullish(),
  page: z.number().int().positive().nullish(),
  rowRef: z.string().trim().max(200).nullish(),
  cellRefs: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  snippet: z.string().trim().max(500).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
}).strict();

const importProvenanceSchema = z.object({
  sourceType: importSourceTypeSchema,
  files: z.array(z.object({
    fileId: userScopedIdSchema,
    sourceType: importSourceTypeSchema,
    displayName: z.string().trim().max(200).nullish(),
    mediaType: z.string().trim().max(120).nullish(),
    pageCount: z.number().int().positive().nullish().optional(),
    rowCount: z.number().int().positive().nullish().optional(),
    sha256Prefix: z.string().trim().max(32).nullish().optional(),
    snippet: z.string().trim().max(500).nullish().optional(),
  }).strict()).min(1).max(10),
  extractor: z.object({
    provider: z.string().trim().max(120).nullish().optional(),
    model: z.string().trim().max(120).nullish().optional(),
    runId: z.string().trim().max(200).nullish().optional(),
  }).strict().optional(),
  warnings: z.array(z.string().trim().max(200)).max(10).optional(),
}).strict();

const postedTransactionMutationUpdatePatchSchema = z.object({
  tradeDate: isoDateSchema.optional(),
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().positive().multipleOf(0.01).optional(),
  side: z.enum(["BUY", "SELL"]).optional(),
  isDayTrade: z.boolean().optional(),
  commissionAmount: z.number().min(0).optional(),
  taxAmount: z.number().min(0).optional(),
  feeOverrideMode: z.enum(["preserve_recorded", "recalculate"]).optional(),
}).strict();

const postedTransactionMutationUpdateItemSchema = z.object({
  transactionId: userScopedIdSchema,
  note: postedTransactionMutationNoteSchema.optional(),
  patch: postedTransactionMutationUpdatePatchSchema,
}).strict();

const postedTransactionMutationDeleteItemSchema = z.object({
  transactionId: userScopedIdSchema,
  note: postedTransactionMutationNoteSchema.optional(),
}).strict();

const postedTransactionMutationConfirmationSchema = z.object({
  previewId: userScopedIdSchema,
  previewVersion: z.number().int().positive(),
  operation: z.enum(["update", "delete"]),
  fingerprint: confirmationDigestSchema,
  confirmationSummary: confirmationSummarySchema,
  confirmationDigest: confirmationDigestSchema,
}).strict();

export const mcpSharedInputShape = {
  portfolioContextUserId: userScopedIdSchema.optional(),
  portfolio: portfolioSelectorSchema.optional(),
  reportingCurrency: currencyCodeSchema.optional(),
  locale: z.string().trim().min(2).max(32).optional(),
} as const;

const postedTransactionMutationPreviewQuerySchema = z.object({
  ...mcpSharedInputShape,
  previewId: userScopedIdSchema,
  limit: z.number().int().positive().max(200).optional(),
  offset: z.number().int().min(0).optional(),
  accountId: userScopedIdSchema.optional(),
  ticker: z.string().trim().min(1).max(32).optional(),
  marketCode: marketCodeSchema.optional(),
  status: z.enum(["changed", "deleted", "unchanged", "warning", "blocked"]).optional(),
}).strict();

export const mcpDraftCandidateSchema = z.object({
  rowNumber: z.number().int().positive(),
  recordType: z.enum(["trade", "unsupported"]).default("trade"),
  accountId: userScopedIdSchema.optional(),
  accountName: accountNameSchema.optional(),
  type: z.enum(["BUY", "SELL"]).optional(),
  ticker: z.string().trim().min(1).max(32).optional(),
  marketCode: marketCodeSchema.optional(),
  quantity: z.number().int().positive().optional(),
  unitPrice: z.number().positive().multipleOf(0.01).optional(),
  priceCurrency: currencyCodeSchema.optional(),
  tradeDate: isoDateSchema.optional(),
  tradeTimestamp: isoDateTimeSchema.optional(),
  bookingSequence: z.number().int().positive().optional(),
  isDayTrade: z.boolean().optional(),
  commissionAmount: bookedChargeFieldSchema("Commission").optional(),
  taxAmount: bookedChargeFieldSchema("Tax").optional(),
  note: z.string().trim().max(1_000).optional(),
  sourceRowRef: z.string().trim().max(200).optional(),
  sourceSnippet: z.string().trim().max(500).optional(),
  sourceMetadata: candidateSourceMetadataSchema.optional(),
}).strict();

const toolDefinitions = {
  get_research_manifest: {
    description: "Return the unpaginated availability status of the eleven canonical Taiwan research datasets for one immutable listing and fixed temporal context. Reads the canonical store only.",
    inputSchema: researchQuerySchema,
    outputSchema: researchManifestOutputSchema,
    scope: "research:read" as const,
    accessKind: "read" as const,
  },
  get_research_identity: {
    description: "Return canonical Taiwan issuer, security, effective-dated listing, eligibility, identity observations, provenance, and paginated identity history. Reads the canonical store only.",
    inputSchema: researchIdentityQuerySchema,
    outputSchema: researchIdentityOutputSchema,
    scope: "research:read" as const,
    accessKind: "read" as const,
  },
  get_portfolio_overview: {
    description: `Return descriptive portfolio overview data with the user's default locale and reporting currency unless overridden. ${adviceBoundary}`,
    inputSchema: z.object({ ...mcpSharedInputShape }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_holdings: {
    description: `Return holdings, quote state, and factual priceState for the selected portfolio context. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      tickers: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_performance: {
    description: `Return descriptive performance time series and totals for a validated dashboard range. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      range: z.string().trim().min(1).max(20).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_recent_transactions: {
    description: `Return recent posted transactions with a default 90-day window, up to one year and 500 rows per call. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      fromDate: isoDateSchema.optional(),
      toDate: isoDateSchema.optional(),
      limit: z.number().int().positive().max(500).default(100),
      offset: z.number().int().min(0).default(0),
      tickers: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
      accountIds: z.array(userScopedIdSchema).max(100).optional(),
      accountNames: accountNameListSchema.optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  preview_update_posted_transactions: {
    description: `Preview explicit-ID updates to one or more posted transactions in one selected portfolio. Present the impact, then wait for explicit post-preview approval before calling update_posted_transactions. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      reason: postedTransactionMutationReasonSchema,
      items: z.array(postedTransactionMutationUpdateItemSchema).min(1),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  update_posted_transactions: {
    description: `Confirm one posted-transaction update preview for a selected portfolio using the exact previewId, previewVersion, fingerprint, confirmationSummary, and confirmationDigest returned by the latest preview. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...postedTransactionMutationConfirmationSchema.shape,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  preview_delete_posted_transactions: {
    description: `Preview explicit-ID deletion of one or more posted transactions in one selected portfolio. Deletion is permanent and may require manual dividend receipt re-entry. Present the impact, then wait for explicit post-preview approval before calling delete_posted_transactions. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      reason: postedTransactionMutationReasonSchema,
      items: z.array(postedTransactionMutationDeleteItemSchema).min(1),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  delete_posted_transactions: {
    description: `Confirm one posted-transaction delete preview for a selected portfolio using the exact previewId, previewVersion, fingerprint, confirmationSummary, and confirmationDigest returned by the latest preview. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...postedTransactionMutationConfirmationSchema.shape,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  get_posted_transaction_mutation_preview: {
    description: `Return the factual status, pagination, filters, warnings, blockers, and confirmation fields for one posted-transaction mutation preview in the selected portfolio. ${adviceBoundary}`,
    inputSchema: postedTransactionMutationPreviewQuerySchema,
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_posted_transaction_mutation_run: {
    description: `Return the factual commit and rebuild status for one posted-transaction mutation run in the selected portfolio. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      runId: userScopedIdSchema,
    }).strict(),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_dividends_overview: {
    description: `Return descriptive upcoming and recent dividend information for the selected portfolio context. ${adviceBoundary}`,
    inputSchema: z.object({ ...mcpSharedInputShape }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_dividend_review: {
    description: `Return dividend review rows for expected and posted dividend events with operational reconciliation context and deep links. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      fromPaymentDate: isoDateSchema.optional(),
      toPaymentDate: isoDateSchema.optional(),
      accountIds: z.array(userScopedIdSchema).max(50).optional(),
      accountNames: accountNameListSchema.optional(),
      tickerMarkets: z.array(tickerMarketSchema).max(100).optional(),
      postingStatus: z.enum(["expected", "posted", "adjusted"]).optional(),
      reconciliationStatus: z.enum(["open", "matched", "explained", "resolved"]).optional(),
      limit: z.number().int().positive().max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }).strict(),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_daily_review_report: {
    description: `Return a descriptive daily review report with bounded holdings detail and deterministic observations only. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      scope: reportScopeSchema.optional(),
      currencyMode: reportCurrencyModeSchema.optional(),
      currency: z.enum(ACCOUNT_DEFAULT_CURRENCIES).optional(),
      range: z.string().trim().min(1).max(20).optional(),
      limit: z.number().int().positive().max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_portfolio_report: {
    description: `Return a descriptive portfolio report with summary, performance, allocation, concentration, income, and bounded holdings detail. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      scope: reportScopeSchema.optional(),
      currencyMode: reportCurrencyModeSchema.optional(),
      currency: z.enum(ACCOUNT_DEFAULT_CURRENCIES).optional(),
      range: z.string().trim().min(1).max(20).optional(),
      limit: z.number().int().positive().max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_market_report: {
    description: `Return a descriptive market report with scoped performance support and bounded detail rows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      scope: reportScopeSchema.optional(),
      currencyMode: reportCurrencyModeSchema.optional(),
      currency: z.enum(ACCOUNT_DEFAULT_CURRENCIES).optional(),
      range: z.string().trim().min(1).max(20).optional(),
      limit: z.number().int().positive().max(100).default(25),
      offset: z.number().int().min(0).default(0),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_unrealized_pnl_report: {
    description: `Return a descriptive unrealized P&L analysis report with filtered point-in-time trends, rankings, full tickerComposition rows for the Total unrealized card, and trade markers. ` +
      `The periodChangeAmount is the selected-period end minus start unrealized P&L. endUnrealizedPnlAmount is the period-end snapshot amount and startUnrealizedPnlAmount is the period-start snapshot amount. positionStatus uses open_position for open holdings and closed_position for sold-out holdings. ` +
      `The deepLink is route-relative and deepLinkUrl is the absolute app URL. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...unrealizedPnlAnalysisMcpInputSchema.shape,
    }).strict(),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_quote_freshness: {
    description: `Return priceState diagnostics, non-current price facts, and latest quote dates without inferring trade execution prices. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      tickers: z.array(z.string().trim().min(1).max(32)).max(100).optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  refresh_portfolio_prices: {
    description: "Refresh close prices for held ticker-market pairs in the selected portfolio, queue overflow work, and optionally enqueue intraday refreshes. Does not accept arbitrary provider-wide refreshes.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...maintenanceScopeShape,
      includeIntraday: z.boolean().optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  preview_recompute_portfolio_fees: {
    description: "Create a server-owned preview for recomputing fees, taxes, realized gain fields, and settlement cash entries in the selected portfolio scope.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...accountScopeShape,
      profileId: userScopedIdSchema.optional(),
      useFallbackBindings: z.boolean().optional(),
      mode: z.enum(["KEEP_RECORDED", "RECALCULATE_CALCULATED"]).optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  recompute_portfolio_fees: {
    description: "Confirm a server-owned fee recompute preview and enqueue holding and wallet snapshot refresh follow-up work.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      jobId: userScopedIdSchema,
      confirmationSummary: z.string().min(1).max(500),
      confirmationDigest: z.string().regex(/^[a-f0-9]{64}$/),
      fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  preview_replay_portfolio_positions: {
    description: "Create a 15-minute server-owned confirmation preview for replaying position lots, allocations, settlement cash, and scoped holding snapshots.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...maintenanceScopeShape,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  replay_portfolio_positions: {
    description: "Confirm a replay preview and start an asynchronous position replay run with per-scope status.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      previewId: userScopedIdSchema,
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  get_replay_portfolio_positions_run: {
    description: "Return the factual status and per-scope outcomes for a portfolio position replay run.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      runId: userScopedIdSchema,
    }).strict(),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  backfill_tickers: {
    description: "Queue portfolio-scoped market-data backfills for held or monitored ticker-market pairs only. No provider override or force bypass is supported.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...maintenanceScopeShape,
      startDate: isoDateSchema.optional(),
      endDate: isoDateSchema.optional(),
      includeBars: z.boolean().optional(),
      includeDividends: z.boolean().optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  get_daily_snapshots: {
    description: `Return holding snapshot rows for the selected portfolio with filters, pagination, and summary counts. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      ...maintenanceScopeShape,
      startDate: isoDateSchema.optional(),
      endDate: isoDateSchema.optional(),
      includeProvisional: z.boolean().optional(),
      limit: z.number().int().positive().max(200).default(100),
      offset: z.number().int().min(0).default(0),
    }).strict(),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  get_admin_market_calendar_status: {
    description: "Admin-only. Return official calendar year coverage and configured sources for one runtime market.",
    inputSchema: z.object({
      marketCode: adminCalendarMarketCodeSchema,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  list_admin_market_calendar_sources: {
    description: "Admin-only. List configured official calendar sources for one runtime market.",
    inputSchema: z.object({
      marketCode: adminCalendarMarketCodeSchema,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  update_admin_market_calendar_source: {
    description: "Admin-only. Update one market calendar source config with minimal provenance fields.",
    inputSchema: z.object({
      marketCode: adminCalendarMarketCodeSchema,
      sourceId: z.string().trim().min(1).max(120),
      label: z.string().trim().min(1).max(200).optional(),
      sourceType: z.enum(["official_source", "manual_ai_assisted"]).optional(),
      suggestedSourceUrl: z.string().trim().url().nullable().optional(),
      enabled: z.boolean().optional(),
      isDefault: z.boolean().optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  manage_admin_market_calendar_import: {
    description: "Admin-only. Preview or confirm an exceptions-only market calendar import using one tool with mode=preview|confirm.",
    inputSchema: z.object({
      mode: z.enum(["preview", "confirm"]),
      marketCode: adminCalendarMarketCodeSchema,
      payload: z.object({
        calendarYear: z.number().int().min(2000).max(2100),
        sourceId: z.string().trim().min(1).max(120).nullable().optional(),
        sourceType: z.enum(["official_source", "manual_ai_assisted"]).optional(),
        label: z.string().trim().min(1).max(200).nullable().optional(),
        sourceUrl: z.string().trim().url().nullable().optional(),
        retrievedAt: z.string().datetime({ offset: true }),
        coverage: z.object({
          scope: z.literal("full_year"),
          evidence: z.string().trim().min(1).max(500),
          notes: z.string().trim().max(1_000).nullable().optional(),
        }).strict(),
        exceptions: z.array(z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          status: z.enum(["open", "closed"]),
          name: z.string().trim().min(1).max(200),
          evidence: z.string().trim().min(1).max(500),
          overrideReason: z.string().trim().min(1).max(500),
          notes: z.string().trim().max(1_000).nullable().optional(),
        }).strict()).max(366),
        replaceConfirmed: z.boolean().optional(),
        replacementReason: z.string().trim().max(500).nullable().optional(),
      }).strict().optional(),
      previewToken: z.string().trim().min(1).max(120).optional(),
      replaceConfirmed: z.boolean().optional(),
      replacementReason: z.string().trim().max(500).nullable().optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  get_cash_balance_summary: {
    description: `Return cash balance summaries only. This tool must not expose the full cash ledger. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountIds: z.array(userScopedIdSchema).max(100).optional(),
      accountNames: accountNameListSchema.optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  list_portfolio_contexts: {
    description: "List the self portfolio and active delegated portfolios visible to this MCP connection, including the model-facing label/email/capabilities selectors for follow-up calls.",
    inputSchema: z.object({}),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  search_instruments: {
    description: `Search supported instruments across TW, US, AU, KR, and JP catalogs for descriptive analysis workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      query: z.string().trim().min(1).max(100),
      markets: z.array(marketCodeSchema).max(MARKET_CODES.length).optional(),
      limit: z.number().int().positive().max(100).default(25),
      includeInactive: z.boolean().optional(),
    }),
    scope: "portfolio:mcp_read" as const,
    accessKind: "read" as const,
  },
  list_accounts: {
    description: "Widget/internal account listing. Returns account IDs, fee profile IDs, and balances for existing app components.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      includeDeleted: z.boolean().optional(),
    }),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: appOnlyVisibilityMeta,
  },
  create_account: {
    description: "Widget/internal account create tool. Prefer preview_create_account_by_name and create_account_by_name for model-facing delegated workflows.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      name: z.string().trim().min(1).max(80),
      defaultCurrency: accountDefaultCurrencySchema,
      accountType: z.enum(["broker", "bank", "wallet"]),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: appOnlyVisibilityMeta,
  },
  update_account: {
    description: "Widget/internal account update tool. Prefer preview_update_account_by_name and update_account_by_name for model-facing delegated workflows.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountId: userScopedIdSchema.optional(),
      accountName: accountNameSchema.optional(),
      name: z.string().trim().min(1).max(80).optional(),
      accountType: z.enum(["broker", "bank", "wallet"]).optional(),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: appOnlyVisibilityMeta,
  },
  soft_delete_account: {
    description: "Widget/internal account soft-delete tool. Prefer preview_soft_delete_account_by_name and soft_delete_account_by_name for model-facing delegated workflows.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountId: userScopedIdSchema.optional(),
      accountName: accountNameSchema.optional(),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: appOnlyVisibilityMeta,
  },
  restore_account: {
    description: "Widget/internal account restore tool by account ID. Prefer preview_restore_account_by_name and restore_account_by_name for model-facing delegated workflows.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountId: userScopedIdSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: appOnlyVisibilityMeta,
  },
  get_account_manager_component: {
    description: "Return the ChatGPT Apps account manager component state with active and deleted accounts plus MCP tool bindings.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
    _meta: {
      ...appOnlyVisibilityMeta,
      "openai/outputTemplate": "/connectors/chatgpt/account-manager",
      "openai/widgetAccessible": true,
    },
  },
  list_account_names: {
    description: "List active account names and optional deleted account names for the selected portfolio without exposing balances. Use this before name-first account lifecycle actions.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      includeDeleted: z.boolean().optional(),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  preview_create_account_by_name: {
    description: "Preview creating an account in the explicitly selected portfolio using a name-first confirmation payload.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      name: z.string().trim().min(1).max(80),
      defaultCurrency: accountDefaultCurrencySchema,
      accountType: z.enum(["broker", "bank", "wallet"]),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  create_account_by_name: {
    description: "Create an account in the explicitly selected portfolio after confirming the latest preview confirmationSummary and confirmationDigest.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      name: z.string().trim().min(1).max(80),
      defaultCurrency: accountDefaultCurrencySchema,
      accountType: z.enum(["broker", "bank", "wallet"]),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  preview_update_account_by_name: {
    description: "Preview a name-first account update in the explicitly selected portfolio.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountName: accountNameSchema,
      name: z.string().trim().min(1).max(80).optional(),
      accountType: z.enum(["broker", "bank", "wallet"]).optional(),
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  update_account_by_name: {
    description: "Commit a name-first account update in the explicitly selected portfolio using the latest preview confirmationSummary and confirmationDigest.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountName: accountNameSchema,
      name: z.string().trim().min(1).max(80).optional(),
      accountType: z.enum(["broker", "bank", "wallet"]).optional(),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  preview_soft_delete_account_by_name: {
    description: "Preview soft-deleting an account by name in the explicitly selected portfolio.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountName: accountNameSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  soft_delete_account_by_name: {
    description: "Commit a name-first account soft-delete in the explicitly selected portfolio using the latest preview confirmationSummary and confirmationDigest.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountName: accountNameSchema,
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  preview_restore_account_by_name: {
    description: "Preview restoring a deleted account by name in the explicitly selected portfolio, including the final auto-renamed name when needed.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountName: accountNameSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  restore_account_by_name: {
    description: "Commit restoring a deleted account by name in the explicitly selected portfolio using the latest preview confirmationSummary and confirmationDigest.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      accountName: accountNameSchema,
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "account:manage" as const,
    accessKind: "write" as const,
  },
  get_transaction_draft_template: {
    description: `Widget/internal draft template tool. Prefer list_draftable_account_names plus preflight_transaction_draft_candidates_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({ ...mcpSharedInputShape }),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
    _meta: appOnlyVisibilityMeta,
  },
  preflight_transaction_draft_candidates: {
    description: `Widget/internal draft preflight tool with account IDs still allowed. Prefer preflight_transaction_draft_candidates_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      sourceLabel: z.string().trim().max(200).optional(),
      sourceFilename: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1_000).optional(),
      provenance: importProvenanceSchema.optional(),
      candidates: z.array(mcpDraftCandidateSchema).min(1).max(200),
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
    _meta: appOnlyVisibilityMeta,
  },
  create_transaction_draft_batch: {
    description: `Widget/internal draft batch create tool with ID-heavy outputs. Prefer create_transaction_draft_batch_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      sourceLabel: z.string().trim().max(200).optional(),
      sourceFilename: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1_000).optional(),
      provenance: importProvenanceSchema.optional(),
      candidates: z.array(mcpDraftCandidateSchema).min(1).max(200),
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
    _meta: appOnlyVisibilityMeta,
  },
  list_draftable_account_names: {
    description: "List active account names that can be used in name-first draft tools, including minimal drafting metadata and duplicate-name warnings.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
  },
  preflight_transaction_draft_candidates_by_name: {
    description: `Validate candidate trade rows using accountName only before creating a draft batch in the explicitly selected portfolio. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      sourceLabel: z.string().trim().max(200).optional(),
      sourceFilename: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1_000).optional(),
      provenance: importProvenanceSchema.optional(),
      candidates: z.array(mcpDraftCandidateSchema.omit({ accountId: true })).min(1).max(200),
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
  },
  create_transaction_draft_batch_by_name: {
    description: `Create a transaction draft batch using accountName only after confirming the latest preflight confirmationSummary and confirmationDigest. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      sourceLabel: z.string().trim().max(200).optional(),
      sourceFilename: z.string().trim().max(200).optional(),
      note: z.string().trim().max(1_000).optional(),
      provenance: importProvenanceSchema.optional(),
      candidates: z.array(mcpDraftCandidateSchema.omit({ accountId: true })).min(1).max(200),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "transaction_draft:create" as const,
    accessKind: "draft_create" as const,
  },
  list_transaction_draft_batches: {
    description: `Widget/internal draft batch list tool with batch IDs. Prefer list_transaction_draft_batches_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      status: z.enum(["open", "archived", "deleted"]).optional(),
      limit: z.number().int().positive().max(100).default(50),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  list_transaction_draft_batches_by_name: {
    description: `List draft batches using human batchLabel selectors for the explicitly selected portfolio. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      status: z.enum(["open", "archived", "deleted"]).optional(),
      limit: z.number().int().positive().max(100).default(50),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  get_transaction_draft_batch: {
    description: `Widget/internal draft batch get tool with batch IDs and row IDs. Prefer get_transaction_draft_batch_by_name or show_transaction_draft_batch_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  get_transaction_draft_batch_by_name: {
    description: `Return one draft batch using a human batchLabel selector. Output stays ID-free except internal _meta. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  show_transaction_draft_batch_by_name: {
    description: `Return a concise human-readable draft batch review view using a human batchLabel selector. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  get_transaction_draft_batch_component: {
    description: `Return the ChatGPT Apps component state for one transaction draft batch. The component can refresh, edit, and post only through MCP tools. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: {
      ...appOnlyVisibilityMeta,
      "openai/outputTemplate": "/connectors/chatgpt/transaction-draft",
      "openai/widgetAccessible": true,
    },
  },
  update_transaction_draft_rows: {
    description: `Widget/internal draft row update tool with row IDs. Prefer update_transaction_draft_rows_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rows: z.array(z.object({
        rowId: userScopedIdSchema,
        expectedVersion: z.number().int().positive(),
        patch: mcpDraftCandidateSchema.omit({ rowNumber: true }).partial(),
      })).min(1).max(200),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  update_transaction_draft_rows_by_name: {
    description: `Update draft rows by rowNumber in the explicitly selected portfolio. The first call may return a confirmation payload; retry with confirmationSummary and confirmationDigest to commit. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      rows: z.array(z.object({
        rowNumber: z.number().int().positive(),
        patch: mcpDraftCandidateSchema.omit({ rowNumber: true, accountId: true }).partial(),
      }).strict()).min(1).max(200),
      confirmationSummary: confirmationSummarySchema.optional(),
      confirmationDigest: confirmationDigestSchema.optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  exclude_transaction_draft_rows: {
    description: `Widget/internal draft row exclusion tool with row IDs. Prefer exclude_transaction_draft_rows_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  exclude_transaction_draft_rows_by_name: {
    description: `Exclude draft rows by rowNumber. The first call may return a confirmation payload; retry with confirmationSummary and confirmationDigest to commit. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      rowNumbers: z.array(z.number().int().positive()).min(1).max(200),
      confirmationSummary: confirmationSummarySchema.optional(),
      confirmationDigest: confirmationDigestSchema.optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  reinclude_transaction_draft_rows: {
    description: `Widget/internal draft row reinclude tool with row IDs. Prefer reinclude_transaction_draft_rows_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  reinclude_transaction_draft_rows_by_name: {
    description: `Reinclude previously excluded draft rows by rowNumber. The first call may return a confirmation payload; retry with confirmationSummary and confirmationDigest to commit. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      rowNumbers: z.array(z.number().int().positive()).min(1).max(200),
      confirmationSummary: confirmationSummarySchema.optional(),
      confirmationDigest: confirmationDigestSchema.optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  reject_transaction_draft_rows: {
    description: `Widget/internal draft row reject tool with row IDs. Prefer reject_transaction_draft_rows_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      expectedBatchVersion: z.number().int().positive(),
    }),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  reject_transaction_draft_rows_by_name: {
    description: `Reject draft rows by rowNumber. The first call may return a confirmation payload; retry with confirmationSummary and confirmationDigest to commit. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      rowNumbers: z.array(z.number().int().positive()).min(1).max(200),
      confirmationSummary: confirmationSummarySchema.optional(),
      confirmationDigest: confirmationDigestSchema.optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  archive_transaction_draft_batch: {
    description: `Widget/internal draft batch archive tool with batch IDs. Prefer archive_transaction_draft_batch_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive(),
    }).strict(),
    scope: "transaction_draft:archive" as const,
    accessKind: "draft_archive" as const,
    _meta: appOnlyVisibilityMeta,
  },
  archive_transaction_draft_batch_by_name: {
    description: `Archive a draft batch by batchLabel. The first call may return a confirmation payload; retry with confirmationSummary and confirmationDigest to commit. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      confirmationSummary: confirmationSummarySchema.optional(),
      confirmationDigest: confirmationDigestSchema.optional(),
    }).strict(),
    scope: "transaction_draft:archive" as const,
    accessKind: "draft_archive" as const,
  },
  delete_unconfirmed_transaction_draft_batch: {
    description: `Widget/internal draft batch delete tool with batch IDs. Prefer delete_unconfirmed_transaction_draft_batch_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive(),
    }).strict(),
    scope: "transaction_draft:delete" as const,
    accessKind: "draft_delete" as const,
    _meta: appOnlyVisibilityMeta,
  },
  delete_unconfirmed_transaction_draft_batch_by_name: {
    description: `Delete a never-confirmed draft batch by batchLabel. The first call may return a confirmation payload; retry with confirmationSummary and confirmationDigest to commit. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      confirmationSummary: confirmationSummarySchema.optional(),
      confirmationDigest: confirmationDigestSchema.optional(),
    }).strict(),
    scope: "transaction_draft:delete" as const,
    accessKind: "draft_delete" as const,
  },
  get_transaction_draft_posting_preview: {
    description: "Widget/internal posting preview tool with batch IDs and row IDs. Prefer get_transaction_draft_posting_preview_by_name for model-facing delegated workflows.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive().optional(),
      rowIds: z.array(userScopedIdSchema).min(1).max(200).optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
    _meta: appOnlyVisibilityMeta,
  },
  get_transaction_draft_posting_preview_by_name: {
    description: "Return a deterministic posting preview using portfolio label/email, batchLabel, and rowNumbers. Output stays ID-free except internal _meta.",
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      rowNumbers: z.array(z.number().int().positive()).min(1).max(200).optional(),
    }).strict(),
    scope: "transaction_draft:edit" as const,
    accessKind: "draft_update" as const,
  },
  post_transaction_draft_rows: {
    description: `Widget/internal draft posting tool with batch IDs and row IDs. Prefer post_transaction_draft_rows_by_name for model-facing delegated workflows. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchId: userScopedIdSchema,
      expectedBatchVersion: z.number().int().positive(),
      expectedRowVersions: z.array(z.object({
        rowId: userScopedIdSchema,
        expectedVersion: z.number().int().positive(),
      }).strict()).min(1).max(200),
      rowIds: z.array(userScopedIdSchema).min(1).max(200),
      idempotencyKey: z.string().trim().min(8).max(200),
      typedConfirmation: z.string().trim().max(100).optional(),
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
    _meta: appOnlyVisibilityMeta,
  },
  post_transaction_draft_rows_by_name: {
    description: `Post selected ready draft rows using portfolio label/email, batchLabel, and rowNumbers. Requires transaction:write plus the latest preview confirmationSummary and confirmationDigest. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      batchLabel: batchLabelSchema,
      rowNumbers: z.array(z.number().int().positive()).min(1).max(200).optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
      typedConfirmation: z.string().trim().max(100).optional(),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "transaction:write" as const,
    accessKind: "write" as const,
  },
  preview_post_dividend_receipt: {
    description: `Preview posting a cash, stock, or mixed dividend receipt for one exact dividend review row. Requires explicit portfolio selection. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      rowId: userScopedIdSchema,
      receivedCashAmount: z.number().int().nonnegative().optional(),
      receivedStockQuantity: z.number().int().nonnegative().optional(),
      deductions: z.array(dividendDeductionSchema).max(20).optional(),
      sourceLines: z.array(dividendSourceLineSchema).max(20).optional(),
      sourceCompositionStatus: z.enum(["provided", "unknown_pending_disclosure"]).optional(),
    }).strict(),
    scope: "dividend:write" as const,
    accessKind: "write" as const,
  },
  post_dividend_receipt: {
    description: `Post one dividend receipt after confirming the latest preview confirmationSummary and confirmationDigest. Requires idempotencyKey. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      rowId: userScopedIdSchema,
      receivedCashAmount: z.number().int().nonnegative().optional(),
      receivedStockQuantity: z.number().int().nonnegative().optional(),
      deductions: z.array(dividendDeductionSchema).max(20).optional(),
      sourceLines: z.array(dividendSourceLineSchema).max(20).optional(),
      sourceCompositionStatus: z.enum(["provided", "unknown_pending_disclosure"]).optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "dividend:write" as const,
    accessKind: "write" as const,
  },
  preview_amend_dividend_receipt: {
    description: `Preview amending one posted cash, stock, or mixed dividend receipt. Stock quantity changes are blocked when a later sell requires reversal plus replacement. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      rowId: userScopedIdSchema,
      receivedCashAmount: z.number().int().nonnegative().optional(),
      receivedStockQuantity: z.number().int().nonnegative().optional(),
      deductions: z.array(dividendDeductionSchema).max(20).optional(),
      sourceLines: z.array(dividendSourceLineSchema).max(20).optional(),
      sourceCompositionStatus: z.enum(["provided", "unknown_pending_disclosure"]).optional(),
    }).strict(),
    scope: "dividend:write" as const,
    accessKind: "write" as const,
  },
  amend_dividend_receipt: {
    description: `Amend one posted dividend receipt after confirming the latest preview confirmationSummary and confirmationDigest. Requires idempotencyKey. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      rowId: userScopedIdSchema,
      receivedCashAmount: z.number().int().nonnegative().optional(),
      receivedStockQuantity: z.number().int().nonnegative().optional(),
      deductions: z.array(dividendDeductionSchema).max(20).optional(),
      sourceLines: z.array(dividendSourceLineSchema).max(20).optional(),
      sourceCompositionStatus: z.enum(["provided", "unknown_pending_disclosure"]).optional(),
      idempotencyKey: z.string().trim().min(8).max(200),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "dividend:write" as const,
    accessKind: "write" as const,
  },
  preview_update_dividend_reconciliation: {
    description: `Preview updating one posted dividend ledger row reconciliation status. Explained status requires a note. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      rowId: userScopedIdSchema,
      status: z.enum(["open", "matched", "explained", "resolved"]),
      note: z.string().trim().max(500).optional(),
    }).strict(),
    scope: "dividend:write" as const,
    accessKind: "write" as const,
  },
  update_dividend_reconciliation: {
    description: `Update one posted dividend ledger row reconciliation status after confirming the latest preview confirmationSummary and confirmationDigest. ${adviceBoundary}`,
    inputSchema: z.object({
      ...mcpSharedInputShape,
      rowId: userScopedIdSchema,
      status: z.enum(["open", "matched", "explained", "resolved"]),
      note: z.string().trim().max(500).optional(),
      confirmationSummary: confirmationSummarySchema,
      confirmationDigest: confirmationDigestSchema,
    }).strict(),
    scope: "dividend:write" as const,
    accessKind: "write" as const,
  },
} as const;

export type McpToolName = keyof typeof toolDefinitions;
export type McpToolDefinition = typeof toolDefinitions[McpToolName];
type ListedMcpToolDefinition = {
  name: McpToolName;
  description: string;
  inputSchema: McpToolDefinition["inputSchema"];
  outputSchema: z.AnyZodObject;
  annotations: McpToolAnnotations;
  scope: AiConnectorScope;
  alternativeScopes?: AiConnectorScope[];
  accessKind: AiConnectorAccessKind;
  _meta?: Record<string, unknown>;
};

export function scopesForListedTool(tool: Pick<ListedMcpToolDefinition, "scope" | "alternativeScopes">): AiConnectorScope[] {
  return tool.alternativeScopes ? [tool.scope, ...tool.alternativeScopes] : [tool.scope];
}

export function groupsForListedTool(tool: Pick<ListedMcpToolDefinition, "scope" | "alternativeScopes">): AiConnectorToolGroup[] {
  return scopesForListedTool(tool).map((scope) => (
    scope === "portfolio:mcp_read" ? "read"
      : scope === "research:read" ? "research"
        : scope === "transaction:write" || scope === "dividend:write" || scope === "account:manage" ? "write"
          : "drafts"
  ));
}

function getToolAnnotations(name: McpToolName, accessKind: AiConnectorAccessKind): McpToolAnnotations {
  if (name === "get_admin_market_calendar_status" || name === "list_admin_market_calendar_sources") {
    return readOnlyToolAnnotations;
  }
  if (accessKind === "read") return readOnlyToolAnnotations;
  if (name === "update_posted_transactions") return idempotentBoundedWriteToolAnnotations;
  if (name === "delete_posted_transactions") return idempotentDestructiveWriteToolAnnotations;
  if (
    name === "delete_unconfirmed_transaction_draft_batch"
    || name === "delete_unconfirmed_transaction_draft_batch_by_name"
    || name === "preview_delete_posted_transactions"
    || name === "soft_delete_account"
    || name === "soft_delete_account_by_name"
  ) {
    return destructiveWriteToolAnnotations;
  }
  return boundedWriteToolAnnotations;
}

export function getMcpToolDefinition(toolName: McpToolName): McpToolDefinition {
  return toolDefinitions[toolName];
}

export function listMcpToolDefinitions(options: {
  legacyReadGroupEnabled?: boolean;
  includeRolloutDisabled?: boolean;
} = {}): ListedMcpToolDefinition[] {
  const legacyReadGroupEnabled = options.legacyReadGroupEnabled ?? true;
  const includeRolloutDisabled = options.includeRolloutDisabled ?? false;
  return Object.entries(toolDefinitions)
    .map(([name, value]) => ({
    name: name as McpToolName,
    description: value.description,
    inputSchema: value.inputSchema,
    outputSchema: "outputSchema" in value ? value.outputSchema : genericMcpToolOutputSchema,
    annotations: getToolAnnotations(name as McpToolName, value.accessKind),
    scope: value.scope,
    alternativeScopes: name === "search_instruments" && researchMcpExposureEnabled()
      ? ["research:read"] as AiConnectorScope[]
      : undefined,
    accessKind: value.accessKind,
    _meta: "_meta" in value ? value._meta : undefined,
  }))
    .filter((tool) => {
      if (tool.name === "get_research_manifest" || tool.name === "get_research_identity") {
        return includeRolloutDisabled || researchScopeAcquisitionAllowed();
      }
      return tool.name !== "search_instruments" || legacyReadGroupEnabled || researchMcpExposureEnabled();
    });
}

export const ALL_MCP_SCOPES: AiConnectorScope[] = [
  "portfolio:mcp_read",
  "research:read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
  "dividend:write",
];
