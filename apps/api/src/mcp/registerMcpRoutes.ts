import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { AiConnectorScope } from "@vakwen/shared-types";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import {
  buildToolAuthChallengeResult,
  challengeErrorFor,
  getMcpRequestMethod,
  isPublicMcpDiscoveryRequest,
  shouldReturnToolAuthChallenge,
  toToolTitle,
} from "./mcpCompatibility.js";
import {
  attachOpenAiAppsToolMetadata,
  registerOpenAiAppsResource,
  setOpenAiAppsMcpTransportCorsHeaders,
} from "./openAiAppsAdapter.js";
import { DefaultMcpAuthService } from "./auth.js";
import { adaptMcpToolResultForHost } from "./hostAdapter.js";
import { routeError } from "../lib/routeError.js";
import {
  approveMcpOAuthConsent,
  buildMcpWwwAuthenticateHeader,
  denyMcpOAuthConsent,
  getMcpAuthorizationServerMetadata,
  getMcpOAuthConsentRequest,
  getMcpProtectedResourceMetadataUrl,
  handleMcpOAuthAuthorize,
  handleMcpOAuthRedirect,
  handleMcpOAuthToken,
  setMcpOAuthNoStoreHeaders,
} from "./oauth.js";
import {
  assertMcpScopesGranted,
  assertMcpShareCapabilities,
  DefaultMcpPolicyService,
} from "./policy.js";
import { getMcpToolDefinition, listMcpToolDefinitions, type McpToolName } from "./tools.js";
import type {
  McpAuthContext,
  McpAuthService,
  McpPolicyService,
  McpRequestContext,
  McpResolvedContext,
} from "./types.js";
import { resolvePortfolioSelector } from "../services/mcpNameResolution.js";
import {
  archiveTransactionDraftBatchByName,
  createAccountByName,
  createTransactionDraftBatchByName,
  deleteUnconfirmedTransactionDraftBatchByName,
  excludeTransactionDraftRowsByName,
  getTransactionDraftBatchByName,
  getTransactionDraftPostingPreviewByName,
  listAccountNames,
  listDraftableAccountNames,
  listPortfolioContexts,
  listTransactionDraftBatchesByName,
  postTransactionDraftRowsByName,
  preflightTransactionDraftCandidatesByName,
  previewCreateAccountByName,
  previewRestoreAccountByName,
  previewSoftDeleteAccountByName,
  previewUpdateAccountByName,
  reincludeTransactionDraftRowsByName,
  rejectTransactionDraftRowsByName,
  restoreAccountByName,
  showTransactionDraftBatchByName,
  softDeleteAccountByName,
  updateAccountByName,
  updateTransactionDraftRowsByName,
} from "../services/mcpNameTools.js";
import {
  createAccount,
  getAccountManagerComponent,
  listAccounts,
  restoreAccount,
  softDeleteAccount,
  updateAccount,
} from "../services/mcpAccounts.js";
import {
  archiveTransactionDraftBatch,
  createTransactionDraftBatch,
  deleteUnconfirmedTransactionDraftBatch,
  excludeTransactionDraftRows,
  getTransactionDraftBatch,
  getTransactionDraftBatchComponent,
  getTransactionDraftPostingPreview,
  getTransactionDraftTemplate,
  listTransactionDraftBatches,
  postTransactionDraftRows,
  preflightTransactionDraftCandidates,
  rejectTransactionDraftRows,
  reincludeTransactionDraftRows,
  updateTransactionDraftRows,
} from "../services/mcpDrafts.js";
import {
  getCashBalanceSummary,
  getDividendsOverview,
  getHoldings,
  getPerformance,
  getPortfolioOverview,
  getQuoteFreshness,
  getRecentTransactions,
  searchInstruments,
} from "../services/mcpPortfolioRead.js";
import {
  amendDividendReceipt,
  getDividendReview,
  postDividendReceipt,
  previewAmendDividendReceipt,
  previewPostDividendReceipt,
  previewUpdateDividendReconciliation,
  updateDividendReconciliation,
} from "../services/mcpDividends.js";
import { buildUnrealizedPnlAnalysis } from "../services/unrealizedPnlAnalysis.js";
import {
  backfillTickers,
  getDailySnapshots,
  getReplayPortfolioPositionsRun,
  previewRecomputePortfolioFees,
  previewReplayPortfolioPositions,
  recomputePortfolioFees,
  refreshPortfolioPrices,
  replayPortfolioPositions,
} from "../services/mcpPortfolioMaintenance.js";
import { buildDailyReviewReport, buildMarketReport, buildPortfolioReport } from "../services/reports.js";
import type { BuildReportInput } from "../services/reports.js";
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
import {
  getAdminMarketCalendarStatusTool,
  listAdminMarketCalendarSourcesTool,
  manageAdminMarketCalendarImportTool,
  updateAdminMarketCalendarSourceTool,
} from "./adminCalendarTools.js";
import { getResearchIdentity, getResearchManifest } from "../services/research/service.js";
import type { ResearchIdentityQuery, ResearchQuery } from "../services/research/contracts.js";

interface RegisterMcpRoutesOptions {
  authService?: McpAuthService;
  policyService?: McpPolicyService;
}

interface PendingToolRequestContext {
  auth: Awaited<ReturnType<McpAuthService["authenticateRequest"]>> | null;
  authError?: unknown;
  requestId: string;
  sourceIp: string | null;
  userAgent: string | null;
  req: FastifyRequest;
}

function getRequestId(req: FastifyRequest): string {
  const header = req.headers["x-request-id"];
  if (typeof header === "string" && header.length > 0) return header;
  return req.id;
}

function asStructuredContent(value: unknown): Record<string, unknown> {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return { value };
}

function buildToolResult(value: unknown, compactText?: string) {
  const { _meta, ...structuredContent } = asStructuredContent(value);
  return {
    content: [{ type: "text" as const, text: compactText ?? JSON.stringify(structuredContent) }],
    structuredContent,
    ...(_meta && typeof _meta === "object" && !Array.isArray(_meta) ? { _meta: _meta as Record<string, unknown> } : {}),
  };
}

function researchToolSummary(toolName: McpToolName, value: Record<string, unknown>): string | undefined {
  if (toolName === "get_research_manifest") {
    const selector = value.selector as { listingId?: string } | undefined;
    const datasets = Array.isArray(value.datasets) ? value.datasets as Array<{ status?: string }> : [];
    const available = datasets.filter((dataset) => dataset.status === "available").length;
    return `Research manifest for ${selector?.listingId ?? "the selected listing"}: ${available} of ${datasets.length} datasets available.`;
  }
  if (toolName === "get_research_identity") {
    const selector = value.selector as { listingId?: string } | undefined;
    const identity = value.identity as { listing?: { venue?: string; ticker?: string }; eligibility?: { profile?: string } } | undefined;
    return `Research identity for ${identity?.listing?.venue ?? "unknown"}:${identity?.listing?.ticker ?? "unknown"} (${selector?.listingId ?? "unknown listing"}); profile ${identity?.eligibility?.profile ?? "unknown"}.`;
  }
  return undefined;
}

function buildToolErrorResult(
  error: Error & { statusCode?: unknown; code?: unknown; metadata?: unknown },
  wrapResearchResult = false,
) {
  const code = typeof error.code === "string" ? error.code : "mcp_tool_error";
  const statusCode = typeof error.statusCode === "number" ? error.statusCode : 500;
  const structuredContent = {
    code,
    message: error.message,
    statusCode,
    ...(error.metadata && typeof error.metadata === "object" && !Array.isArray(error.metadata)
      ? { metadata: error.metadata as Record<string, unknown> }
      : {}),
  };
  return {
    content: [{ type: "text" as const, text: `${code}: ${error.message}` }],
    structuredContent: wrapResearchResult ? { result: structuredContent } : structuredContent,
    isError: true,
  };
}

function extractRequestedContextUserId(args: unknown): string | undefined {
  if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
  const value = (args as Record<string, unknown>).portfolioContextUserId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function requiresExplicitPortfolioSelector(toolName: McpToolName): boolean {
  return [
    "list_account_names",
    "preview_create_account_by_name",
    "create_account_by_name",
    "preview_update_account_by_name",
    "update_account_by_name",
    "preview_soft_delete_account_by_name",
    "soft_delete_account_by_name",
    "preview_restore_account_by_name",
    "restore_account_by_name",
    "list_draftable_account_names",
    "preflight_transaction_draft_candidates_by_name",
    "create_transaction_draft_batch_by_name",
    "list_transaction_draft_batches_by_name",
    "get_transaction_draft_batch_by_name",
    "show_transaction_draft_batch_by_name",
    "update_transaction_draft_rows_by_name",
    "exclude_transaction_draft_rows_by_name",
    "reinclude_transaction_draft_rows_by_name",
    "reject_transaction_draft_rows_by_name",
    "archive_transaction_draft_batch_by_name",
    "delete_unconfirmed_transaction_draft_batch_by_name",
    "get_transaction_draft_posting_preview_by_name",
    "post_transaction_draft_rows_by_name",
    "refresh_portfolio_prices",
    "preview_recompute_portfolio_fees",
    "recompute_portfolio_fees",
    "preview_replay_portfolio_positions",
    "replay_portfolio_positions",
    "backfill_tickers",
    "preview_post_dividend_receipt",
    "post_dividend_receipt",
    "preview_amend_dividend_receipt",
    "amend_dividend_receipt",
    "preview_update_dividend_reconciliation",
    "update_dividend_reconciliation",
    "preview_update_posted_transactions",
    "update_posted_transactions",
    "preview_delete_posted_transactions",
    "delete_posted_transactions",
    "get_posted_transaction_mutation_preview",
    "get_posted_transaction_mutation_run",
  ].includes(toolName);
}

function extractPendingContext(extra: unknown): PendingToolRequestContext | undefined {
  if (!extra || typeof extra !== "object") return undefined;
  const authInfo = (extra as { authInfo?: unknown }).authInfo;
  if (!authInfo || typeof authInfo !== "object") return undefined;
  const extraPayload = (authInfo as { extra?: unknown }).extra;
  if (!extraPayload || typeof extraPayload !== "object") return undefined;
  return (extraPayload as { pendingContext?: PendingToolRequestContext }).pendingContext;
}

async function requireDelegatedDividendWriteForPostedMutation(
  app: FastifyInstance,
  auth: McpAuthContext,
  resolvedContext: McpResolvedContext,
  args: unknown,
): Promise<void> {
  if (!resolvedContext.shareId || !args || typeof args !== "object" || Array.isArray(args)) return;
  const previewId = (args as { previewId?: unknown }).previewId;
  if (typeof previewId !== "string" || previewId.length === 0) return;
  const preview = await getPostedTransactionMutationPreview(app.persistence, {
    ownerUserId: resolvedContext.portfolioContextUserId,
    actorUserId: auth.sessionUserId,
    previewId,
    appBaseUrl: app.appBaseUrl,
  });
  const requiresDividendWrite = preview.summary.deletedDividendCount > 0 || preview.summary.reopenedDividendCount > 0;
  if (!requiresDividendWrite) return;
  assertMcpScopesGranted(auth, ["dividend:write"]);
  assertMcpShareCapabilities(resolvedContext, ["dividend:write"]);
}

async function requireDelegatedDividendWriteForPostedMutationPreview(
  app: FastifyInstance,
  auth: McpAuthContext,
  resolvedContext: McpResolvedContext,
  input:
    | { operation: "update"; previewInput: Parameters<typeof previewPostedTransactionUpdateBatch>[1] }
    | { operation: "delete"; previewInput: Parameters<typeof previewPostedTransactionDeleteBatch>[1] },
): Promise<void> {
  if (!resolvedContext.shareId) return;
  if (
    auth.scopes.includes("dividend:write")
    && resolvedContext.shareCapabilities.includes("dividend:write")
  ) return;
  const simulation = input.operation === "update"
    ? await simulatePostedTransactionUpdateBatch(app.persistence, input.previewInput)
    : await simulatePostedTransactionDeleteBatch(app.persistence, input.previewInput);
  if (simulation.summary.deletedDividendCount === 0 && simulation.summary.reopenedDividendCount === 0) return;
  assertMcpScopesGranted(auth, ["dividend:write"]);
  assertMcpShareCapabilities(resolvedContext, ["dividend:write"]);
}

export function toReportInput(args: unknown): BuildReportInput {
  if (!args || typeof args !== "object" || Array.isArray(args)) return {};
  const input = args as BuildReportInput & { reportingCurrency?: string };
  const currency = input.currency ?? input.reportingCurrency;
  return {
    ...input,
    currency,
    currencyMode: input.currencyMode ?? (currency ? "specified" : undefined),
  };
}

export function buildMcpPolicyToolScopes(): Record<string, AiConnectorScope> {
  return Object.fromEntries(
    listMcpToolDefinitions({ includeRolloutDisabled: true }).map((tool) => [tool.name, tool.scope]),
  );
}

export async function registerMcpRoutes(
  app: FastifyInstance,
  options: RegisterMcpRoutesOptions = {},
): Promise<void> {
  const authService = options.authService ?? new DefaultMcpAuthService();
  const policyService = options.policyService ?? new DefaultMcpPolicyService(
    // Authorization must know the complete registry even when discovery hides a
    // policy-disabled tool at startup. Admin policy changes take effect without
    // requiring an API restart.
    buildMcpPolicyToolScopes(),
  );
  const sessions = new Map<string, StreamableHTTPServerTransport>();

  const challengeScopeForTool = async (toolName: McpToolName) => {
    if (toolName !== "search_instruments") return getMcpToolDefinition(toolName).scope;
    const settings = await app.persistence.getAiConnectorPolicySettings();
    if (!settings.groupToggles.read && settings.groupToggles.research) return "research:read" as const;
    return "portfolio:mcp_read" as const;
  };

  if (!app.hasContentTypeParser("application/x-www-form-urlencoded")) {
    app.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string" },
      (_req, body, done) => {
        try {
          done(null, Object.fromEntries(new URLSearchParams(String(body))));
        } catch (error) {
          done(error as Error);
        }
      },
    );
  }

  const executeTool = async (toolName: McpToolName, args: unknown, extra: unknown) => {
    const tool = getMcpToolDefinition(toolName);
    const pending = extractPendingContext(extra);
    if (!pending) throw new Error("Missing MCP request context");
    if (!pending.auth) {
      const description = pending.authError instanceof Error
        ? pending.authError.message
        : "No valid MCP access token was provided.";
      return buildToolAuthChallengeResult({
        app,
        req: pending.req,
        scope: await challengeScopeForTool(toolName),
        error: challengeErrorFor(pending.authError),
        description,
        text: `Authentication required for ${toToolTitle(toolName)}.`,
      });
    }
    const auth = pending.auth;
    let requestedContextUserId = extractRequestedContextUserId(args);
    let selectedPortfolio: Awaited<ReturnType<typeof resolvePortfolioSelector>> = { descriptor: null };
    let resolvedContext: McpResolvedContext | undefined;

    const logAccess = async (result: "ok" | "denied" | "error", denialReason?: string) => {
      await app.persistence.appendAiConnectorAccessLog({
        connectionId: auth.connection?.id ?? null,
        userId: auth.sessionUserId,
        portfolioContextUserId: resolvedContext?.portfolioContextUserId ?? auth.sessionUserId,
        shareId: resolvedContext?.shareId ?? null,
        toolName,
        accessKind: tool.accessKind,
        result,
        denialReason: denialReason ?? null,
        requestId: pending.requestId,
        sourceIp: pending.sourceIp,
        userAgent: pending.userAgent,
        metadata: {
          source: auth.connection?.provider === "chatgpt" ? "chatgpt_component" : "mcp_tool",
          ...(requestedContextUserId ? { requestedPortfolioContextUserId: requestedContextUserId } : {}),
        },
      });
    };

    try {
      const hasModelFacingPortfolioSelector = Boolean(
        args
        && typeof args === "object"
        && !Array.isArray(args)
        && (args as { portfolio?: unknown }).portfolio,
      );
      const hasLegacyPortfolioContextUserId = Boolean(
        args
        && typeof args === "object"
        && !Array.isArray(args)
        && typeof (args as { portfolioContextUserId?: unknown }).portfolioContextUserId === "string"
        && ((args as { portfolioContextUserId?: string }).portfolioContextUserId ?? "").trim().length > 0,
      );
      if (requiresExplicitPortfolioSelector(toolName) && hasLegacyPortfolioContextUserId) {
        throw routeError(
          400,
          "mcp_portfolio_context_id_forbidden",
          "Model-facing delegated MCP write tools require portfolio: { label, email? }. portfolioContextUserId is only supported by legacy widget/internal tools.",
        );
      }
      selectedPortfolio = await resolvePortfolioSelector(app, auth, args);
      if (requiresExplicitPortfolioSelector(toolName) && !hasModelFacingPortfolioSelector) {
        throw routeError(
          400,
          "mcp_portfolio_required",
          "Model-facing delegated MCP write tools require portfolio: { label, email? }. portfolioContextUserId is only supported by legacy widget/internal tools.",
        );
      }
      if (requiresExplicitPortfolioSelector(toolName) && !selectedPortfolio.descriptor) {
        throw routeError(
          400,
          "mcp_portfolio_required",
          "Model-facing delegated MCP write tools require portfolio: { label, email? }. Call list_portfolio_contexts first.",
        );
      }
      requestedContextUserId = selectedPortfolio.requestedContextUserId ?? requestedContextUserId;
      resolvedContext = await policyService.assertToolAccess(
        app,
        pending.req,
        auth,
        toolName,
        tool.accessKind,
        requestedContextUserId,
      );
      const requestContext: McpRequestContext = {
        auth,
        resolvedContext,
        ...(selectedPortfolio.descriptor
          ? {
              portfolioContextDescriptor: {
                label: selectedPortfolio.descriptor.label,
                email: selectedPortfolio.descriptor.email,
                isSelf: selectedPortfolio.descriptor.isSelf,
              },
            }
          : {}),
        requestId: pending.requestId,
        sourceIp: pending.sourceIp,
        userAgent: pending.userAgent,
        logger: pending.req.log,
      };
      let result: unknown;
      switch (toolName) {
        case "get_research_manifest":
          result = await getResearchManifest(app.persistence, args as ResearchQuery);
          break;
        case "get_research_identity":
          result = await getResearchIdentity(app.persistence, args as ResearchIdentityQuery);
          break;
        case "get_portfolio_overview":
          result = await getPortfolioOverview(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_holdings":
          result = await getHoldings(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { tickers?: string[]; reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_performance":
          result = await getPerformance(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { range?: string; reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_recent_transactions":
          result = await getRecentTransactions(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as {
              fromDate?: string;
              toDate?: string;
              limit: number;
              offset: number;
              tickers?: string[];
              accountIds?: string[];
              accountNames?: string[];
            },
          );
          break;
        case "preview_update_posted_transactions": {
          const previewInput = {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            items: (args as { items: Parameters<typeof previewPostedTransactionUpdateBatch>[1]["items"] }).items,
            reason: (args as { reason: string }).reason,
            appBaseUrl: app.appBaseUrl,
          };
          await requireDelegatedDividendWriteForPostedMutationPreview(app, auth, resolvedContext, {
            operation: "update",
            previewInput,
          });
          result = await previewPostedTransactionUpdateBatch(app.persistence, previewInput);
          break;
        }
        case "update_posted_transactions":
          await requireDelegatedDividendWriteForPostedMutation(app, auth, resolvedContext, args);
          result = await confirmPostedTransactionMutation(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            appBaseUrl: app.appBaseUrl,
            confirmation: args as Parameters<typeof confirmPostedTransactionMutation>[1]["confirmation"],
          }, { eventBus: app.eventBus });
          await dispatchPostedTransactionMutationRebuild(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            runId: (result as { runId: string }).runId,
            boss: app.boss ?? undefined,
            eventBus: app.eventBus,
          });
          result = await getPostedTransactionMutationRun(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            runId: (result as { runId: string }).runId,
            appBaseUrl: app.appBaseUrl,
          });
          break;
        case "preview_delete_posted_transactions": {
          const previewInput = {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            items: (args as { items: Parameters<typeof previewPostedTransactionDeleteBatch>[1]["items"] }).items,
            reason: (args as { reason: string }).reason,
            appBaseUrl: app.appBaseUrl,
          };
          await requireDelegatedDividendWriteForPostedMutationPreview(app, auth, resolvedContext, {
            operation: "delete",
            previewInput,
          });
          result = await previewPostedTransactionDeleteBatch(app.persistence, previewInput);
          break;
        }
        case "delete_posted_transactions":
          await requireDelegatedDividendWriteForPostedMutation(app, auth, resolvedContext, args);
          result = await confirmPostedTransactionMutation(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            appBaseUrl: app.appBaseUrl,
            confirmation: args as Parameters<typeof confirmPostedTransactionMutation>[1]["confirmation"],
          }, { eventBus: app.eventBus });
          await dispatchPostedTransactionMutationRebuild(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            runId: (result as { runId: string }).runId,
            boss: app.boss ?? undefined,
            eventBus: app.eventBus,
          });
          result = await getPostedTransactionMutationRun(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            runId: (result as { runId: string }).runId,
            appBaseUrl: app.appBaseUrl,
          });
          break;
        case "get_posted_transaction_mutation_preview":
          result = await getPostedTransactionMutationPreview(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            previewId: (args as { previewId: string }).previewId,
            appBaseUrl: app.appBaseUrl,
            query: {
              limit: (args as { limit?: number }).limit,
              offset: (args as { offset?: number }).offset,
              accountId: (args as { accountId?: string }).accountId,
              ticker: (args as { ticker?: string }).ticker,
              marketCode: (args as { marketCode?: "TW" | "US" | "AU" | "KR" | "JP" }).marketCode,
              status: (args as { status?: "changed" | "deleted" | "unchanged" | "warning" | "blocked" }).status,
            },
          });
          break;
        case "get_posted_transaction_mutation_run":
          result = await getPostedTransactionMutationRun(app.persistence, {
            ownerUserId: requestContext.resolvedContext.portfolioContextUserId,
            actorUserId: requestContext.auth.sessionUserId,
            runId: (args as { runId: string }).runId,
            appBaseUrl: app.appBaseUrl,
          });
          break;
        case "get_dividends_overview":
          result = await getDividendsOverview(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { reportingCurrency?: never; locale?: string },
          );
          break;
        case "get_dividend_review":
          result = await getDividendReview(
            { app, requestContext },
            args as Parameters<typeof getDividendReview>[1],
          );
          break;
        case "get_daily_review_report":
          result = await buildDailyReviewReport(
            app,
            requestContext.resolvedContext.portfolioContextUserId,
            toReportInput(args),
          );
          break;
        case "get_portfolio_report":
          result = await buildPortfolioReport(
            app,
            requestContext.resolvedContext.portfolioContextUserId,
            toReportInput(args),
          );
          break;
        case "get_market_report":
          result = await buildMarketReport(
            app,
            requestContext.resolvedContext.portfolioContextUserId,
            toReportInput(args),
          );
          break;
        case "get_unrealized_pnl_report":
          result = await (async () => {
            const report = await buildUnrealizedPnlAnalysis(
              app,
              requestContext.resolvedContext.portfolioContextUserId,
              args as Parameters<typeof buildUnrealizedPnlAnalysis>[2],
            );
            const deepLinkUrl = `${app.appBaseUrl.replace(/\/$/, "")}${report.deepLink}`;
            return {
              ...report,
              deepLinkUrl,
              _meta: { deepLinkUrl },
            };
          })();
          break;
        case "get_quote_freshness":
          result = await getQuoteFreshness(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { tickers?: string[]; reportingCurrency?: never; locale?: string },
          );
          break;
        case "refresh_portfolio_prices":
          result = await refreshPortfolioPrices({ app, requestContext }, args as Parameters<typeof refreshPortfolioPrices>[1]);
          break;
        case "preview_recompute_portfolio_fees":
          result = await previewRecomputePortfolioFees({ app, requestContext }, args as Parameters<typeof previewRecomputePortfolioFees>[1]);
          break;
        case "recompute_portfolio_fees":
          result = await recomputePortfolioFees({ app, requestContext }, args as Parameters<typeof recomputePortfolioFees>[1]);
          break;
        case "preview_replay_portfolio_positions":
          result = await previewReplayPortfolioPositions({ app, requestContext }, args as Parameters<typeof previewReplayPortfolioPositions>[1]);
          break;
        case "replay_portfolio_positions":
          result = await replayPortfolioPositions({ app, requestContext }, args as Parameters<typeof replayPortfolioPositions>[1]);
          break;
        case "get_replay_portfolio_positions_run":
          result = await getReplayPortfolioPositionsRun({ app, requestContext }, args as Parameters<typeof getReplayPortfolioPositionsRun>[1]);
          break;
        case "backfill_tickers":
          result = await backfillTickers({ app, requestContext }, args as Parameters<typeof backfillTickers>[1]);
          break;
        case "get_daily_snapshots":
          result = await getDailySnapshots({ app, requestContext }, args as Parameters<typeof getDailySnapshots>[1]);
          break;
        case "get_admin_market_calendar_status":
          result = await getAdminMarketCalendarStatusTool(
            { app, requestContext },
            args as Parameters<typeof getAdminMarketCalendarStatusTool>[1],
          );
          break;
        case "list_admin_market_calendar_sources":
          result = await listAdminMarketCalendarSourcesTool(
            { app, requestContext },
            args as Parameters<typeof listAdminMarketCalendarSourcesTool>[1],
          );
          break;
        case "update_admin_market_calendar_source":
          result = await updateAdminMarketCalendarSourceTool({ app, requestContext }, args);
          break;
        case "manage_admin_market_calendar_import":
          result = await manageAdminMarketCalendarImportTool({ app, requestContext }, args);
          break;
        case "get_cash_balance_summary":
          result = await getCashBalanceSummary(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { accountIds?: string[]; accountNames?: string[]; locale?: string },
          );
          break;
        case "list_portfolio_contexts":
          result = await listPortfolioContexts({ app, requestContext, tradingCalendar: app.tradingCalendarCache });
          break;
        case "search_instruments":
          result = await searchInstruments(
            { app, requestContext, tradingCalendar: app.tradingCalendarCache },
            args as { query: string; markets?: Array<"TW" | "US" | "AU" | "KR" | "JP">; limit: number },
          );
          break;
        case "list_accounts":
          result = await listAccounts(
            { app, requestContext },
            args as { includeDeleted?: boolean },
          );
          break;
        case "create_account":
          result = await createAccount(
            { app, requestContext },
            args as Parameters<typeof createAccount>[1],
          );
          break;
        case "update_account":
          result = await updateAccount(
            { app, requestContext },
            args as Parameters<typeof updateAccount>[1],
          );
          break;
        case "soft_delete_account":
          result = await softDeleteAccount(
            { app, requestContext },
            args as Parameters<typeof softDeleteAccount>[1],
          );
          break;
        case "restore_account":
          result = await restoreAccount(
            { app, requestContext },
            args as Parameters<typeof restoreAccount>[1],
          );
          break;
        case "get_account_manager_component":
          result = await getAccountManagerComponent({ app, requestContext });
          break;
        case "list_account_names":
          result = await listAccountNames(
            { app, requestContext },
            args as Parameters<typeof listAccountNames>[1],
          );
          break;
        case "preview_create_account_by_name":
          result = await previewCreateAccountByName(
            { app, requestContext },
            args as Parameters<typeof previewCreateAccountByName>[1],
          );
          break;
        case "create_account_by_name":
          result = await createAccountByName(
            { app, requestContext },
            args as Parameters<typeof createAccountByName>[1],
          );
          break;
        case "preview_update_account_by_name":
          result = await previewUpdateAccountByName(
            { app, requestContext },
            args as Parameters<typeof previewUpdateAccountByName>[1],
          );
          break;
        case "update_account_by_name":
          result = await updateAccountByName(
            { app, requestContext },
            args as Parameters<typeof updateAccountByName>[1],
          );
          break;
        case "preview_soft_delete_account_by_name":
          result = await previewSoftDeleteAccountByName(
            { app, requestContext },
            args as Parameters<typeof previewSoftDeleteAccountByName>[1],
          );
          break;
        case "soft_delete_account_by_name":
          result = await softDeleteAccountByName(
            { app, requestContext },
            args as Parameters<typeof softDeleteAccountByName>[1],
          );
          break;
        case "preview_restore_account_by_name":
          result = await previewRestoreAccountByName(
            { app, requestContext },
            args as Parameters<typeof previewRestoreAccountByName>[1],
          );
          break;
        case "restore_account_by_name":
          result = await restoreAccountByName(
            { app, requestContext },
            args as Parameters<typeof restoreAccountByName>[1],
          );
          break;
        case "get_transaction_draft_template":
          result = await getTransactionDraftTemplate();
          break;
        case "list_draftable_account_names":
          result = await listDraftableAccountNames({ app, requestContext });
          break;
        case "preflight_transaction_draft_candidates":
          result = await preflightTransactionDraftCandidates(
            { app, requestContext },
            args as Parameters<typeof preflightTransactionDraftCandidates>[1],
          );
          break;
        case "preflight_transaction_draft_candidates_by_name":
          result = await preflightTransactionDraftCandidatesByName(
            { app, requestContext },
            args as Parameters<typeof preflightTransactionDraftCandidatesByName>[1],
          );
          break;
        case "create_transaction_draft_batch":
          result = await createTransactionDraftBatch(
            { app, requestContext },
            args as Parameters<typeof createTransactionDraftBatch>[1],
          );
          break;
        case "create_transaction_draft_batch_by_name":
          result = await createTransactionDraftBatchByName(
            { app, requestContext },
            args as Parameters<typeof createTransactionDraftBatchByName>[1],
          );
          break;
        case "list_transaction_draft_batches":
          result = await listTransactionDraftBatches(
            { app, requestContext },
            args as Parameters<typeof listTransactionDraftBatches>[1],
          );
          break;
        case "list_transaction_draft_batches_by_name":
          result = await listTransactionDraftBatchesByName(
            { app, requestContext },
            args as Parameters<typeof listTransactionDraftBatchesByName>[1],
          );
          break;
        case "get_transaction_draft_batch": {
          const { batchId } = args as { batchId: string };
          result = await getTransactionDraftBatch({ app, requestContext }, batchId);
          break;
        }
        case "get_transaction_draft_batch_by_name":
          result = await getTransactionDraftBatchByName(
            { app, requestContext },
            args as Parameters<typeof getTransactionDraftBatchByName>[1],
          );
          break;
        case "show_transaction_draft_batch_by_name":
          result = await showTransactionDraftBatchByName(
            { app, requestContext },
            args as Parameters<typeof showTransactionDraftBatchByName>[1],
          );
          break;
        case "get_transaction_draft_batch_component":
          result = await getTransactionDraftBatchComponent(
            { app, requestContext },
            args as Parameters<typeof getTransactionDraftBatchComponent>[1],
          );
          break;
        case "update_transaction_draft_rows":
          result = await updateTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof updateTransactionDraftRows>[1],
          );
          break;
        case "update_transaction_draft_rows_by_name":
          result = await updateTransactionDraftRowsByName(
            { app, requestContext },
            args as Parameters<typeof updateTransactionDraftRowsByName>[1],
          );
          break;
        case "exclude_transaction_draft_rows":
          result = await excludeTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof excludeTransactionDraftRows>[1],
          );
          break;
        case "exclude_transaction_draft_rows_by_name":
          result = await excludeTransactionDraftRowsByName(
            { app, requestContext },
            args as Parameters<typeof excludeTransactionDraftRowsByName>[1],
          );
          break;
        case "reinclude_transaction_draft_rows":
          result = await reincludeTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof reincludeTransactionDraftRows>[1],
          );
          break;
        case "reinclude_transaction_draft_rows_by_name":
          result = await reincludeTransactionDraftRowsByName(
            { app, requestContext },
            args as Parameters<typeof reincludeTransactionDraftRowsByName>[1],
          );
          break;
        case "reject_transaction_draft_rows":
          result = await rejectTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof rejectTransactionDraftRows>[1],
          );
          break;
        case "reject_transaction_draft_rows_by_name":
          result = await rejectTransactionDraftRowsByName(
            { app, requestContext },
            args as Parameters<typeof rejectTransactionDraftRowsByName>[1],
          );
          break;
        case "archive_transaction_draft_batch":
          result = await archiveTransactionDraftBatch(
            { app, requestContext },
            args as Parameters<typeof archiveTransactionDraftBatch>[1],
          );
          break;
        case "archive_transaction_draft_batch_by_name":
          result = await archiveTransactionDraftBatchByName(
            { app, requestContext },
            args as Parameters<typeof archiveTransactionDraftBatchByName>[1],
          );
          break;
        case "delete_unconfirmed_transaction_draft_batch":
          result = await deleteUnconfirmedTransactionDraftBatch(
            { app, requestContext },
            args as Parameters<typeof deleteUnconfirmedTransactionDraftBatch>[1],
          );
          break;
        case "delete_unconfirmed_transaction_draft_batch_by_name":
          result = await deleteUnconfirmedTransactionDraftBatchByName(
            { app, requestContext },
            args as Parameters<typeof deleteUnconfirmedTransactionDraftBatchByName>[1],
          );
          break;
        case "get_transaction_draft_posting_preview":
          result = await getTransactionDraftPostingPreview(
            { app, requestContext },
            args as Parameters<typeof getTransactionDraftPostingPreview>[1],
          );
          break;
        case "get_transaction_draft_posting_preview_by_name":
          result = await getTransactionDraftPostingPreviewByName(
            { app, requestContext },
            args as Parameters<typeof getTransactionDraftPostingPreviewByName>[1],
          );
          break;
        case "post_transaction_draft_rows":
          result = await postTransactionDraftRows(
            { app, requestContext },
            args as Parameters<typeof postTransactionDraftRows>[1],
          );
          break;
        case "post_transaction_draft_rows_by_name":
          result = await postTransactionDraftRowsByName(
            { app, requestContext },
            args as Parameters<typeof postTransactionDraftRowsByName>[1],
          );
          break;
        case "preview_post_dividend_receipt":
          result = await previewPostDividendReceipt(
            { app, requestContext },
            args as Parameters<typeof previewPostDividendReceipt>[1],
          );
          break;
        case "post_dividend_receipt":
          result = await postDividendReceipt(
            { app, requestContext },
            args as Parameters<typeof postDividendReceipt>[1],
          );
          break;
        case "preview_amend_dividend_receipt":
          result = await previewAmendDividendReceipt(
            { app, requestContext },
            args as Parameters<typeof previewAmendDividendReceipt>[1],
          );
          break;
        case "amend_dividend_receipt":
          result = await amendDividendReceipt(
            { app, requestContext },
            args as Parameters<typeof amendDividendReceipt>[1],
          );
          break;
        case "preview_update_dividend_reconciliation":
          result = await previewUpdateDividendReconciliation(
            { app, requestContext },
            args as Parameters<typeof previewUpdateDividendReconciliation>[1],
          );
          break;
        case "update_dividend_reconciliation":
          result = await updateDividendReconciliation(
            { app, requestContext },
            args as Parameters<typeof updateDividendReconciliation>[1],
          );
          break;
      }
      await logAccess("ok");
      const adapted = adaptMcpToolResultForHost({ toolName, auth, result }) as Record<string, unknown>;
      const isResearchTool = toolName === "get_research_manifest" || toolName === "get_research_identity";
      return buildToolResult(
        isResearchTool ? { result: adapted } : adapted,
        researchToolSummary(toolName, adapted),
      );
    } catch (error) {
      const denialReason = error instanceof Error && "code" in error
        ? String((error as { code?: unknown }).code)
        : error instanceof Error
          ? error.message
          : String(error);
      const result = error instanceof Error && "statusCode" in error && Number((error as { statusCode?: unknown }).statusCode) < 500
        ? "denied"
        : "error";
      await logAccess(result, denialReason);
      if (shouldReturnToolAuthChallenge(error)) {
        const description = error instanceof Error ? error.message : "MCP authorization failed.";
        return buildToolAuthChallengeResult({
          app,
          req: pending.req,
          scope: await challengeScopeForTool(toolName),
          error: challengeErrorFor(error),
          description,
          text: `Authorization required for ${toToolTitle(toolName)}.`,
        });
      }
      if (error instanceof Error && "statusCode" in error && Number((error as { statusCode?: unknown }).statusCode) < 500) {
        return buildToolErrorResult(
          error as Error & { statusCode?: unknown; code?: unknown; metadata?: unknown },
          toolName === "get_research_manifest" || toolName === "get_research_identity",
        );
      }
      throw error;
    }
  };

  const createServer = async () => {
    const settings = await app.persistence.getAiConnectorPolicySettings();
    const listedTools = listMcpToolDefinitions({ legacyReadGroupEnabled: settings.groupToggles.read });
    const server = new McpServer(
      {
        name: "vakwen-mcp",
        version: "1.0.0",
      },
      {
        capabilities: {
          logging: {},
        },
      },
    );

    registerOpenAiAppsResource(server);

    for (const tool of listedTools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: tool.inputSchema.shape,
          outputSchema: tool.outputSchema,
          annotations: tool.annotations,
          _meta: tool._meta
            ? Object.fromEntries(
              Object.entries(tool._meta).map(([key, value]) => [
                key,
                key === "openai/outputTemplate" && typeof value === "string" && value.startsWith("/")
                  ? `${app.appBaseUrl}${value}`
                  : value,
              ]),
            )
            : undefined,
        },
        async (args: unknown, extra: unknown) => executeTool(tool.name, args, extra),
      );
    }
    attachOpenAiAppsToolMetadata(server);
    return server;
  };

  const handleMcpRequest = async (req: FastifyRequest, reply: FastifyReply) => {
    let tokenContext: Awaited<ReturnType<McpAuthService["authenticateRequest"]>> | undefined;
    let tokenAuthError: unknown;
    const method = getMcpRequestMethod(req.body);
    const isToolCall = method === "tools/call";
    if (!isPublicMcpDiscoveryRequest(req)) {
      try {
        tokenContext = await authService.authenticateRequest(app, req);
      } catch (error) {
        if (isToolCall) {
          tokenAuthError = error;
        } else {
          reply.header("www-authenticate", buildMcpWwwAuthenticateHeader(await getMcpProtectedResourceMetadataUrl(app, req)));
          throw error;
        }
      }
    }

    const sessionIdHeader = req.headers["mcp-session-id"];
    const sessionId = typeof sessionIdHeader === "string" ? sessionIdHeader : undefined;
    let transport = sessionId ? sessions.get(sessionId) : undefined;
    if (!transport) {
      const initializeBody = req.body;
      if (!initializeBody || !isInitializeRequest(initializeBody)) {
        return reply.code(400).send({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Bad Request: No valid MCP session ID provided" },
          id: null,
        });
      }
      const server = await createServer();
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        enableJsonResponse: true,
        onsessioninitialized: (newSessionId) => {
          sessions.set(newSessionId, transport!);
        },
      });
      transport.onclose = () => {
        const currentSessionId = transport?.sessionId;
        if (currentSessionId) {
          sessions.delete(currentSessionId);
        }
      };
      await server.connect(transport);
    }

    if (tokenContext || isToolCall) {
      (req.raw as typeof req.raw & { auth?: { token: string; clientId: string; scopes: string[]; extra: Record<string, unknown> } }).auth = {
        token: tokenContext?.token ?? "",
        clientId: tokenContext?.clientId ?? "anonymous",
        scopes: [...(tokenContext?.scopes ?? [])],
        extra: {
          pendingContext: {
            auth: tokenContext ?? null,
            authError: tokenAuthError,
            requestId: getRequestId(req),
            sourceIp: req.ip ?? null,
            userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : null,
            req,
          } satisfies PendingToolRequestContext,
        },
      };
    }
    const socket = req.raw.socket as typeof req.raw.socket & { destroy?: () => void; destroySoon?: () => void };
    if (typeof socket.destroySoon !== "function") {
      socket.destroySoon = () => {
        if (typeof socket.destroy === "function") socket.destroy();
      };
    }
    setOpenAiAppsMcpTransportCorsHeaders(req, reply);
    await transport.handleRequest(req.raw, reply.raw, req.body);
    reply.hijack();
  };

  app.addHook("onClose", async () => {
    const activeTransports = [...new Set(sessions.values())];
    sessions.clear();
    await Promise.all(activeTransports.map((transport) => transport.close()));
  });

  app.get("/mcp/health", async (req) => ({
    status: "ok",
    transport: "streamable_http",
    sessionCount: sessions.size,
    protectedResourceMetadata: await authService.getProtectedResourceMetadata(app, req),
    tools: listMcpToolDefinitions({
      legacyReadGroupEnabled: (await app.persistence.getAiConnectorPolicySettings()).groupToggles.read,
    }).map((tool) => ({
      name: tool.name,
      scope: tool.scope,
      alternativeScopes: tool.alternativeScopes,
      accessKind: tool.accessKind,
    })),
  }));

  app.get("/.well-known/oauth-protected-resource", async (req) => authService.getProtectedResourceMetadata(app, req));
  app.get("/.well-known/oauth-protected-resource/mcp", async (req) => authService.getProtectedResourceMetadata(app, req));
  app.get("/.well-known/oauth-authorization-server", async (req) => getMcpAuthorizationServerMetadata(app, req));
  app.get("/.well-known/oauth-authorization-server/mcp", async (req) => getMcpAuthorizationServerMetadata(app, req));
  app.get("/.well-known/openid-configuration", async (req) => getMcpAuthorizationServerMetadata(app, req));
  app.get("/.well-known/openid-configuration/mcp", async (req) => getMcpAuthorizationServerMetadata(app, req));
  app.get("/oauth/authorize", async (req, reply) => handleMcpOAuthAuthorize(app, req, reply));
  app.get("/oauth/redirect", async (req, reply) => handleMcpOAuthRedirect(app, req, reply));
  app.post("/oauth/token", async (req, reply) => handleMcpOAuthToken(app, req, reply));
  app.get("/oauth/consent/:requestId", async (req, reply) => {
    setMcpOAuthNoStoreHeaders(reply);
    const params = req.params as { requestId: string };
    return getMcpOAuthConsentRequest(app, req, params.requestId);
  });
  app.post("/oauth/consent/:requestId/approve", async (req, reply) => {
    setMcpOAuthNoStoreHeaders(reply);
    const params = req.params as { requestId: string };
    return approveMcpOAuthConsent(app, req, params.requestId, req.body);
  });
  app.post("/oauth/consent/:requestId/deny", async (req, reply) => {
    setMcpOAuthNoStoreHeaders(reply);
    const params = req.params as { requestId: string };
    return denyMcpOAuthConsent(app, req, params.requestId, req.body);
  });

  app.post("/mcp", async (req, reply) => handleMcpRequest(req, reply));
  app.get("/mcp", async (req, reply) => handleMcpRequest(req, reply));
  app.delete("/mcp", async (req, reply) => handleMcpRequest(req, reply));
}
