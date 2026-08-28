import { randomUUID } from "node:crypto";
import {
  currencyFor,
  type McpAccountDisplayDto,
  type McpTransactionDraftPostingPreviewDto,
  marketCodeFor,
  type AiConnectorImportCandidateSourceDto,
  type AiConnectorImportProvenanceDto,
  type AiTransactionDraftEventType,
  type ChatGptTransactionDraftWidgetAuditItemDto,
  type ChatGptTransactionDraftWidgetDto,
  type MarketCode,
  type McpPostTransactionDraftRowsInputDto,
  type McpPostTransactionDraftRowsResultDto,
  type TransactionDraftBatchDto,
  type TransactionDraftRowDto,
  type TransactionDraftUnsupportedItemDto,
} from "@vakwen/shared-types";
import { calculateBuyFees, calculateSellFees } from "@vakwen/domain";
import type {
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftBatchRecord,
  AiTransactionDraftEventRecord,
  AiTransactionDraftRowRecord,
  AiTransactionDraftUnsupportedItemRecord,
} from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import type { McpDraftServiceDeps, McpMutationBatchResult } from "../mcp/types.js";
import { bookedChargeMessage, isValidBookedCharge } from "../validation/bookedCharge.js";
import { connectorGroupForScope } from "./mcpConnectorLifecycle.js";
import { resolveAccountDisplayName, toMcpAccountDisplayDto } from "./mcpAccountHelpers.js";
import { syncAccountingPolicy } from "./accountingStore.js";
import { createTransaction } from "./portfolio.js";
import { scheduleReplayWithRetry } from "./replayPositionHistory.js";
import {
  BACKFILL_QUEUE,
  getBackfillSingletonKey,
  type BackfillJobData,
} from "./market-data/backfillWorker.js";

type TradeType = "BUY" | "SELL";
type RowState = AiTransactionDraftRowRecord["state"];
type DraftRowDisplayState = RowState | "posted_transaction_deleted";

export interface DraftCandidateInput {
  rowNumber: number;
  recordType: "trade" | "unsupported";
  accountId?: string | null;
  accountName?: string | null;
  type?: TradeType | null;
  ticker?: string | null;
  marketCode?: MarketCode | null;
  quantity?: number | null;
  unitPrice?: number | null;
  priceCurrency?: string | null;
  tradeDate?: string | null;
  tradeTimestamp?: string | null;
  bookingSequence?: number | null;
  isDayTrade?: boolean | null;
  commissionAmount?: number | null;
  taxAmount?: number | null;
  note?: string | null;
  sourceRowRef?: string | null;
  sourceSnippet?: string | null;
  sourceMetadata?: AiConnectorImportCandidateSourceDto | null;
  rawPayload?: Record<string, unknown> | null;
}

interface DraftBatchMetadataInput {
  sourceLabel?: string;
  sourceFilename?: string;
  note?: string;
  provenance?: AiConnectorImportProvenanceDto;
}

interface PreflightRowResult {
  rowNumber: number;
  state: RowState;
  blocking: boolean;
  normalized: {
    accountId: string | null;
    accountNameInput: string | null;
    tradeType: TradeType | null;
    ticker: string | null;
    marketCode: MarketCode | null;
    quantity: number | null;
    unitPrice: number | null;
    priceCurrency: string | null;
    tradeDate: string | null;
    tradeTimestamp: string | null;
    bookingSequence: number | null;
    isDayTrade: boolean | null;
    commissionAmount: number | null;
    taxAmount: number | null;
    note: string | null;
    sourceRowRef: string | null;
    sourceSnippet: string | null;
    normalizedPayload: Record<string, unknown>;
  };
  issues: Array<{ code: string; message: string }>;
  warnings: string[];
  unsupported?: {
    category: string;
    reason: string;
    sourceSnippet: string | null;
    rawPayload: Record<string, unknown>;
  };
}

interface PreflightResult {
  rows: PreflightRowResult[];
  blockingRowCount: number;
  unsupportedCount: number;
}

function buildDeepLink(appBaseUrl: string, batchId: string, contextUserId: string): string {
  return `${appBaseUrl}/transactions?tab=ai-inbox&batch=${encodeURIComponent(batchId)}&context=${encodeURIComponent(contextUserId)}`;
}

function buildChatGptTransactionDraftComponentUrl(appBaseUrl: string): string {
  return `${appBaseUrl}/connectors/chatgpt/transaction-draft`;
}

function requestSourceLabel(deps: McpDraftServiceDeps): "chatgpt_component" | "mcp_tool" {
  return deps.requestContext.auth.connection?.provider === "chatgpt" ? "chatgpt_component" : "mcp_tool";
}

async function enqueueFirstTradeBackfillsForDraftRows(
  deps: McpDraftServiceDeps,
  input: {
    rows: ReadonlyArray<AiTransactionDraftRowRecord>;
    userId: string;
  },
): Promise<void> {
  if (!deps.app.boss) return;
  const authUser = await deps.app.persistence.getAuthUserById(input.userId);
  if (authUser?.isDemo) return;
  const requested = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const row of input.rows) {
    if (!row.ticker || !row.marketCode) continue;
    requested.set(`${row.ticker}:${row.marketCode}`, {
      ticker: row.ticker,
      marketCode: row.marketCode as MarketCode,
    });
  }

  for (const { ticker, marketCode } of requested.values()) {
    const instrument = await deps.app.persistence.getInstrument(ticker, marketCode);
    if (!instrument || instrument.barsBackfillStatus === "ready") continue;
    await deps.app.boss.send(
      BACKFILL_QUEUE,
      {
        ticker,
        marketCode,
        userId: input.userId,
        trigger: "first_trade",
      } satisfies BackfillJobData,
      { singletonKey: getBackfillSingletonKey(ticker, marketCode), priority: 0 },
    );
  }
}

function assertNoRawSourcePayload(candidates: DraftCandidateInput[]): void {
  const offending = candidates.find((candidate) => candidate.rawPayload && Object.keys(candidate.rawPayload).length > 0);
  if (offending) {
    throw routeError(400, "mcp_raw_source_payload_forbidden", `raw source payloads are not allowed for row ${offending.rowNumber}`);
  }
}

function assertCandidateSourceMetadataCaps(candidates: DraftCandidateInput[]): void {
  for (const candidate of candidates) {
    const sourceMetadata = candidate.sourceMetadata;
    if (!sourceMetadata) continue;
    if ((sourceMetadata.fileId?.length ?? 0) > 200) throw routeError(400, "mcp_source_file_id_too_long", "sourceMetadata.fileId exceeds 200 characters");
    if ((sourceMetadata.rowRef?.length ?? 0) > 200) throw routeError(400, "mcp_source_row_ref_too_long", "sourceMetadata.rowRef exceeds 200 characters");
    if ((sourceMetadata.snippet?.length ?? 0) > 500) throw routeError(400, "mcp_source_snippet_too_long", "sourceMetadata.snippet exceeds 500 characters");
    if ((sourceMetadata.cellRefs?.length ?? 0) > 20) throw routeError(400, "mcp_source_cell_refs_too_many", "sourceMetadata.cellRefs exceeds 20 items");
    for (const cellRef of sourceMetadata.cellRefs ?? []) {
      if (cellRef.length > 40) throw routeError(400, "mcp_source_cell_ref_too_long", "sourceMetadata.cellRefs entries exceed 40 characters");
    }
    if (sourceMetadata.page !== null && sourceMetadata.page !== undefined && sourceMetadata.page <= 0) {
      throw routeError(400, "mcp_source_page_invalid", "sourceMetadata.page must be positive");
    }
    if (
      sourceMetadata.confidence !== null
      && sourceMetadata.confidence !== undefined
      && (sourceMetadata.confidence < 0 || sourceMetadata.confidence > 1)
    ) {
      throw routeError(400, "mcp_source_confidence_invalid", "sourceMetadata.confidence must be between 0 and 1");
    }
  }
}

function assertBatchProvenanceCaps(provenance?: AiConnectorImportProvenanceDto): void {
  if (!provenance || !("files" in provenance) || !Array.isArray(provenance.files)) return;
  if (provenance.files.length === 0 || provenance.files.length > 10) {
    throw routeError(400, "mcp_provenance_file_count_invalid", "provenance.files must contain 1 to 10 items");
  }
  for (const file of provenance.files) {
    if (file.fileId.length > 200) throw routeError(400, "mcp_provenance_file_id_too_long", "provenance.files[].fileId exceeds 200 characters");
    if ((file.displayName?.length ?? 0) > 200) throw routeError(400, "mcp_provenance_display_name_too_long", "provenance.files[].displayName exceeds 200 characters");
    if ((file.mediaType?.length ?? 0) > 120) throw routeError(400, "mcp_provenance_media_type_too_long", "provenance.files[].mediaType exceeds 120 characters");
    if ((file.sha256Prefix?.length ?? 0) > 32) throw routeError(400, "mcp_provenance_sha_prefix_too_long", "provenance.files[].sha256Prefix exceeds 32 characters");
    if ((file.snippet?.length ?? 0) > 500) throw routeError(400, "mcp_provenance_snippet_too_long", "provenance.files[].snippet exceeds 500 characters");
  }
  for (const warning of provenance.warnings ?? []) {
    if (warning.length > 200) throw routeError(400, "mcp_provenance_warning_too_long", "provenance.warnings entries exceed 200 characters");
  }
  if ((provenance.warnings?.length ?? 0) > 10) {
    throw routeError(400, "mcp_provenance_warning_count_invalid", "provenance.warnings exceeds 10 items");
  }
  if ((provenance.extractor?.provider?.length ?? 0) > 120) throw routeError(400, "mcp_provenance_provider_too_long", "provenance.extractor.provider exceeds 120 characters");
  if ((provenance.extractor?.model?.length ?? 0) > 120) throw routeError(400, "mcp_provenance_model_too_long", "provenance.extractor.model exceeds 120 characters");
  if ((provenance.extractor?.runId?.length ?? 0) > 200) throw routeError(400, "mcp_provenance_run_id_too_long", "provenance.extractor.runId exceeds 200 characters");
}

function ensureMetadataCaps(input: DraftBatchMetadataInput): void {
  if ((input.sourceLabel?.length ?? 0) > 200) throw routeError(400, "mcp_source_label_too_long", "sourceLabel exceeds 200 characters");
  if ((input.sourceFilename?.length ?? 0) > 200) throw routeError(400, "mcp_source_filename_too_long", "sourceFilename exceeds 200 characters");
  if ((input.note?.length ?? 0) > 1_000) throw routeError(400, "mcp_note_too_long", "note exceeds 1,000 characters");
  assertBatchProvenanceCaps(input.provenance);
}

async function loadDraftStore(deps: McpDraftServiceDeps) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const store = await deps.app.persistence.loadStore(contextUserId);
  syncAccountingPolicy(store);
  return { store, contextUserId };
}

function cloneWarnings(warnings: string[]): string[] {
  return warnings.slice(0, 10);
}

function deriveDraftFeesSource(row: {
  state: RowState;
  commissionAmount: number | null;
  taxAmount: number | null;
}): AiTransactionDraftRowRecord["feesSource"] {
  if (row.state === "unsupported") return null;
  return row.commissionAmount !== null && row.taxAmount !== null ? "SOURCE_PROVIDED" : "CALCULATED";
}

function effectiveDraftFeesSource(row: Pick<
  AiTransactionDraftRowRecord,
  "state" | "commissionAmount" | "taxAmount" | "feesSource"
>): AiTransactionDraftRowRecord["feesSource"] {
  const derived = deriveDraftFeesSource(row);
  if (derived !== "SOURCE_PROVIDED") return derived;
  return row.feesSource ?? derived;
}

function getCurrentQuantity(
  holdings: Array<{ accountId: string; ticker: string; quantity: number }>,
  accountId: string,
  ticker: string,
): number {
  return holdings.find((holding) => holding.accountId === accountId && holding.ticker === ticker)?.quantity ?? 0;
}

async function runPreflight(
  deps: McpDraftServiceDeps,
  candidates: DraftCandidateInput[],
): Promise<PreflightResult> {
  assertNoRawSourcePayload(candidates);
  assertCandidateSourceMetadataCaps(candidates);
  if (candidates.length === 0 || candidates.length > 200) {
    throw routeError(400, "mcp_invalid_candidate_count", "Draft candidate batches must contain 1 to 200 rows");
  }
  const { store } = await loadDraftStore(deps);
  const accountsById = new Map(store.accounts.map((account) => [account.id, account]));
  const accountsByName = new Map<string, typeof store.accounts>();
  for (const account of store.accounts) {
    const key = account.name.trim().toLowerCase();
    const bucket = accountsByName.get(key) ?? [];
    bucket.push(account);
    accountsByName.set(key, bucket);
  }

  const baseRows: PreflightRowResult[] = [];
  for (const candidate of candidates.slice().sort((left, right) => left.rowNumber - right.rowNumber)) {
    if (candidate.recordType === "unsupported") {
      baseRows.push({
        rowNumber: candidate.rowNumber,
        state: "unsupported",
        blocking: false,
        normalized: {
          accountId: null,
          accountNameInput: candidate.accountName ?? null,
          tradeType: null,
          ticker: candidate.ticker?.trim().toUpperCase() ?? null,
          marketCode: candidate.marketCode ?? null,
          quantity: candidate.quantity ?? null,
          unitPrice: candidate.unitPrice ?? null,
          priceCurrency: candidate.priceCurrency?.trim().toUpperCase() ?? null,
          tradeDate: candidate.tradeDate ?? null,
          tradeTimestamp: candidate.tradeTimestamp ?? null,
          bookingSequence: candidate.bookingSequence ?? null,
          isDayTrade: candidate.isDayTrade ?? null,
          commissionAmount: candidate.commissionAmount ?? null,
          taxAmount: candidate.taxAmount ?? null,
          note: candidate.note ?? null,
          sourceRowRef: candidate.sourceRowRef ?? null,
          sourceSnippet: candidate.sourceSnippet ?? null,
          normalizedPayload: { ...(candidate.sourceMetadata ?? {}) },
        },
        issues: [],
        warnings: [],
        unsupported: {
          category: "non_trade",
          reason: "Only BUY and SELL trade rows are draftable in V1",
          sourceSnippet: candidate.sourceSnippet ?? null,
          rawPayload: { ...(candidate.sourceMetadata ?? {}) },
        },
      });
      continue;
    }

    const issues: Array<{ code: string; message: string }> = [];
    const warnings: string[] = [];
    let accountId = candidate.accountId?.trim() || null;
    const accountNameInput = candidate.accountName?.trim() || null;
    let marketCode = candidate.marketCode ?? null;
    let priceCurrency = candidate.priceCurrency?.trim().toUpperCase() ?? null;
    const ticker = candidate.ticker?.trim().toUpperCase() || null;
    const normalizedPayload = { ...(candidate.sourceMetadata ?? {}) };

    if (!accountId && accountNameInput) {
      const matches = accountsByName.get(accountNameInput.toLowerCase()) ?? [];
      if (matches.length === 1) {
        accountId = matches[0]!.id;
        warnings.push("account inferred from unique account name");
      } else if (matches.length > 1) {
        issues.push({ code: "ambiguous_account", message: "Account name matches multiple accounts" });
      }
    }

    const account = accountId ? accountsById.get(accountId) ?? null : null;
    if (!accountId) {
      issues.push({ code: "missing_account", message: "accountId or uniquely resolvable accountName is required" });
    } else if (!account) {
      issues.push({ code: "inactive_or_missing_account", message: "Account is missing, inactive, or unavailable" });
    }

    if (account) {
      const inferredMarket = marketCodeFor(account.defaultCurrency);
      const inferredCurrency = currencyFor(inferredMarket);
      if (!marketCode) {
        marketCode = inferredMarket;
        warnings.push("marketCode inferred from account");
      }
      if (!priceCurrency) {
        priceCurrency = inferredCurrency;
        warnings.push("priceCurrency inferred from account");
      }
    }

    if (!candidate.type) issues.push({ code: "missing_type", message: "type is required" });
    if (!ticker) issues.push({ code: "missing_ticker", message: "ticker is required" });
    if (!candidate.quantity) issues.push({ code: "missing_quantity", message: "quantity is required" });
    if (!candidate.unitPrice) issues.push({ code: "missing_unit_price", message: "unitPrice is required" });
    if (!candidate.tradeDate) issues.push({ code: "missing_trade_date", message: "tradeDate is required" });
    if (!marketCode) issues.push({ code: "missing_market_code", message: "marketCode is required" });
    if (!priceCurrency) issues.push({ code: "missing_price_currency", message: "priceCurrency is required" });

    if (candidate.sourceSnippet && candidate.sourceSnippet.length > 500) {
      issues.push({ code: "source_snippet_too_long", message: "sourceSnippet exceeds 500 characters" });
    }

    if (candidate.tradeTimestamp && !candidate.tradeDate) {
      issues.push({ code: "missing_trade_date", message: "tradeDate is required when tradeTimestamp is provided" });
    }
    if (candidate.commissionAmount !== null && candidate.commissionAmount !== undefined && !isValidBookedCharge(candidate.commissionAmount)) {
      issues.push({ code: "invalid_commission_amount", message: bookedChargeMessage("Commission") });
    }
    if (candidate.taxAmount !== null && candidate.taxAmount !== undefined && !isValidBookedCharge(candidate.taxAmount)) {
      issues.push({ code: "invalid_tax_amount", message: bookedChargeMessage("Tax") });
    }
    const hasCommissionAmount = candidate.commissionAmount !== null && candidate.commissionAmount !== undefined;
    const hasTaxAmount = candidate.taxAmount !== null && candidate.taxAmount !== undefined;
    if (hasCommissionAmount !== hasTaxAmount) {
      issues.push({
        code: "incomplete_fee_pair",
        message: "commissionAmount and taxAmount must be provided together or both omitted",
      });
    }

    const storeInstrument = ticker && marketCode
      ? store.instruments.find((instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode) ?? null
      : null;
    const catalogInstrument = !storeInstrument && ticker && marketCode
      ? await deps.app.persistence.getInstrument(ticker, marketCode)
      : null;
    const instrumentType = storeInstrument?.type ?? catalogInstrument?.instrumentType ?? null;
    if (ticker && marketCode && !storeInstrument && !catalogInstrument) {
      issues.push({ code: "unknown_instrument", message: "Instrument is unknown or not yet classified" });
    } else if (ticker && marketCode && instrumentType === null) {
      issues.push({ code: "unclassified_instrument", message: "Instrument is not classified for trading" });
    }

    baseRows.push({
      rowNumber: candidate.rowNumber,
      state: issues.length > 0 ? "invalid" : "ready",
      blocking: issues.length > 0,
      normalized: {
        accountId,
        accountNameInput,
        tradeType: candidate.type ?? null,
        ticker,
        marketCode,
        quantity: candidate.quantity ?? null,
        unitPrice: candidate.unitPrice ?? null,
        priceCurrency,
        tradeDate: candidate.tradeDate ?? null,
        tradeTimestamp: candidate.tradeTimestamp ?? null,
        bookingSequence: candidate.bookingSequence ?? null,
        isDayTrade: candidate.isDayTrade ?? false,
        commissionAmount: candidate.commissionAmount ?? null,
        taxAmount: candidate.taxAmount ?? null,
        note: candidate.note ?? null,
        sourceRowRef: candidate.sourceRowRef ?? null,
        sourceSnippet: candidate.sourceSnippet ?? null,
        normalizedPayload,
      },
      issues,
      warnings,
    });
  }

  const exactDuplicateKeys = new Set<string>();
  const existingSameDayKeys = new Set<string>();
  for (const trade of store.accounting.facts.tradeEvents) {
    exactDuplicateKeys.add([
      trade.accountId,
      trade.ticker,
      trade.marketCode,
      trade.type,
      trade.quantity,
      trade.unitPrice,
      trade.priceCurrency,
      trade.tradeDate,
      trade.tradeTimestamp ?? "",
      trade.bookingSequence ?? "",
    ].join("|"));
    existingSameDayKeys.add([
      trade.accountId,
      trade.ticker,
      trade.marketCode,
      trade.tradeDate,
    ].join("|"));
  }

  const pendingByDateKey = new Map<string, number>();
  const runningInventory = new Map<string, number>();
  for (const row of baseRows) {
    if (row.normalized.accountId && row.normalized.ticker) {
      const inventoryKey = `${row.normalized.accountId}:${row.normalized.ticker}`;
      if (!runningInventory.has(inventoryKey)) {
        runningInventory.set(
          inventoryKey,
          getCurrentQuantity(store.accounting.projections.holdings, row.normalized.accountId, row.normalized.ticker),
        );
      }
    }

    if (row.state === "unsupported" || row.normalized.accountId === null || row.normalized.ticker === null || row.normalized.marketCode === null) {
      continue;
    }

    const duplicateKey = [
      row.normalized.accountId,
      row.normalized.ticker,
      row.normalized.marketCode,
      row.normalized.tradeType ?? "",
      row.normalized.quantity ?? "",
      row.normalized.unitPrice ?? "",
      row.normalized.priceCurrency ?? "",
      row.normalized.tradeDate ?? "",
      row.normalized.tradeTimestamp ?? "",
      row.normalized.bookingSequence ?? "",
    ].join("|");
    if (exactDuplicateKeys.has(duplicateKey)) {
      row.state = "duplicate_blocked";
      row.blocking = true;
      row.issues.push({ code: "exact_duplicate", message: "Exact duplicate of an existing posted transaction" });
      continue;
    }

    const dateKey = [
      row.normalized.accountId,
      row.normalized.ticker,
      row.normalized.marketCode,
      row.normalized.tradeDate ?? "",
    ].join("|");
    if (!row.normalized.tradeTimestamp && !row.normalized.bookingSequence && existingSameDayKeys.has(dateKey)) {
      row.state = "invalid";
      row.blocking = true;
      row.issues.push({ code: "same_day_collision", message: "Same-day trades require tradeTimestamp or bookingSequence when posted trades already exist" });
      continue;
    }
    pendingByDateKey.set(dateKey, (pendingByDateKey.get(dateKey) ?? 0) + 1);

    if (!row.normalized.tradeTimestamp && !row.normalized.bookingSequence && pendingByDateKey.get(dateKey)! > 1) {
      row.state = "invalid";
      row.blocking = true;
      row.issues.push({ code: "ambiguous_same_day_order", message: "Same-day trades require tradeTimestamp or bookingSequence to avoid ambiguous ordering" });
      continue;
    }

    if (row.normalized.tradeType === "SELL" && row.normalized.accountId && row.normalized.ticker && row.normalized.quantity) {
      const inventoryKey = `${row.normalized.accountId}:${row.normalized.ticker}`;
      const available = runningInventory.get(inventoryKey) ?? 0;
      if (available < row.normalized.quantity) {
        row.state = "invalid";
        row.blocking = true;
        row.issues.push({ code: "negative_inventory", message: "SELL candidate would create negative inventory" });
        continue;
      }
      runningInventory.set(inventoryKey, available - row.normalized.quantity);
    } else if (row.normalized.tradeType === "BUY" && row.normalized.accountId && row.normalized.ticker && row.normalized.quantity) {
      const inventoryKey = `${row.normalized.accountId}:${row.normalized.ticker}`;
      const available = runningInventory.get(inventoryKey) ?? 0;
      runningInventory.set(inventoryKey, available + row.normalized.quantity);
    }

    row.warnings = cloneWarnings(row.warnings);
  }

  return {
    rows: baseRows,
    blockingRowCount: baseRows.filter((row) => row.blocking).length,
    unsupportedCount: baseRows.filter((row) => row.state === "unsupported").length,
  };
}

function assertBatchEditable(batch: AiTransactionDraftBatchAggregate["batch"]): void {
  if (batch.status !== "open") {
    throw routeError(409, "mcp_draft_batch_closed", "Draft batch is not open");
  }
}

function requireOwnedBatch(
  deps: McpDraftServiceDeps,
  aggregate: AiTransactionDraftBatchAggregate | null,
  batchId: string,
): AiTransactionDraftBatchAggregate {
  if (!aggregate) {
    throw routeError(404, "mcp_draft_batch_not_found", `Draft batch ${batchId} not found`);
  }
  if (aggregate.batch.ownerUserId !== deps.requestContext.resolvedContext.portfolioContextUserId) {
    throw routeError(403, "mcp_draft_batch_denied", "Draft batch is outside the active portfolio context");
  }
  return aggregate;
}

async function appendDraftEvent(
  deps: McpDraftServiceDeps,
  batchId: string,
  eventType: AiTransactionDraftEventType,
  input: {
    rowId?: string | null;
    summary?: string | null;
    beforeState?: Record<string, unknown> | null;
    afterState?: Record<string, unknown> | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  return deps.app.persistence.appendAiTransactionDraftEvent({
    batchId,
    rowId: input.rowId ?? null,
    ownerUserId: deps.requestContext.resolvedContext.portfolioContextUserId,
    actorUserId: deps.requestContext.auth.sessionUserId,
    connectorConnectionId: deps.requestContext.auth.connection?.id ?? null,
    eventType,
    summary: input.summary ?? null,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    metadata: {
      source: requestSourceLabel(deps),
      ...(input.metadata ?? {}),
    },
    sourceIp: deps.requestContext.sourceIp,
  });
}

export async function getTransactionDraftTemplate() {
  return {
    supportedRecordTypes: ["trade"],
    supportedTradeTypes: ["BUY", "SELL"],
    maxRowsPerBatch: 200,
    requiredFields: ["accountId|accountName", "type", "ticker", "quantity", "unitPrice", "tradeDate"],
    optionalFields: [
      "marketCode",
      "priceCurrency",
      "tradeTimestamp",
      "bookingSequence",
      "isDayTrade",
      "commissionAmount",
      "taxAmount",
      "note",
      "sourceRowRef",
      "sourceSnippet",
    ],
    allowedInference: [
      "marketCode from unambiguous account",
      "priceCurrency from unambiguous account",
      "ticker normalization",
      "isDayTrade defaults to false",
    ],
    blockingChecks: [
      "missing required fields",
      "exact duplicate transactions",
      "same-day collisions without timestamp or sequence",
      "inactive or unknown accounts",
      "unknown or unclassified instruments",
      "commissionAmount and taxAmount supplied separately",
      "negative-inventory SELLs",
      "ambiguous same-day ordering",
    ],
    unsupportedRows: [
      "dividends",
      "cash ledger movements",
      "FX transfers",
      "corporate actions",
      "non-trade rows",
    ],
  };
}

export async function preflightTransactionDraftCandidates(
  deps: McpDraftServiceDeps,
  input: DraftBatchMetadataInput & { candidates: DraftCandidateInput[] },
) {
  ensureMetadataCaps(input);
  const result = await runPreflight(deps, input.candidates);
  return {
    summary: {
      rowCount: input.candidates.length,
      blockingRowCount: result.blockingRowCount,
      unsupportedCount: result.unsupportedCount,
      readyRowCount: result.rows.filter((row) => row.state === "ready").length,
    },
    rows: result.rows.map((row) => ({
      rowNumber: row.rowNumber,
      state: row.state,
      issues: row.issues,
      warnings: row.warnings,
      normalized: row.normalized,
    })),
    unsupportedItems: result.rows
      .filter((row) => row.unsupported)
      .map((row) => ({
        rowNumber: row.rowNumber,
        ...row.unsupported!,
      })),
  };
}

export async function createTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  input: DraftBatchMetadataInput & { candidates: DraftCandidateInput[] },
): Promise<McpMutationBatchResult> {
  ensureMetadataCaps(input);
  const preflight = await runPreflight(deps, input.candidates);
  if (preflight.blockingRowCount > 0) {
    throw routeError(409, "mcp_draft_preflight_failed", "Draft batch creation blocked by deterministic preflight");
  }
  const batchId = randomUUID();
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const batch = await deps.app.persistence.saveAiTransactionDraftBatch({
    id: batchId,
    ownerUserId: contextUserId,
    createdByUserId: deps.requestContext.auth.sessionUserId,
    connectorConnectionId: deps.requestContext.auth.connection?.id ?? null,
    shareId: deps.requestContext.resolvedContext.shareId,
    sourceChannel: "mcp",
    status: "open",
    version: 1,
    sourceLabel: input.sourceLabel ?? null,
    sourceFilename: input.sourceFilename ?? null,
    note: input.note ?? null,
    provenance: {
      source: requestSourceLabel(deps),
      connectorImportMode: "structured_candidates",
      ...(input.provenance ?? {}),
    },
    rowCount: input.candidates.length,
    unsupportedCount: preflight.unsupportedCount,
  });
  if (!batch) {
    throw routeError(409, "mcp_draft_batch_conflict", "Draft batch could not be created");
  }

  await Promise.all(preflight.rows.map((row) => deps.app.persistence.saveAiTransactionDraftRow({
    id: randomUUID(),
    batchId,
    ownerUserId: contextUserId,
    rowNumber: row.rowNumber,
    state: row.state,
    version: 1,
    accountId: row.normalized.accountId,
    accountNameInput: row.normalized.accountNameInput,
    tradeType: row.normalized.tradeType,
    ticker: row.normalized.ticker,
    marketCode: row.normalized.marketCode,
    quantity: row.normalized.quantity,
    unitPrice: row.normalized.unitPrice,
    priceCurrency: row.normalized.priceCurrency,
    tradeDate: row.normalized.tradeDate,
    tradeTimestamp: row.normalized.tradeTimestamp,
    bookingSequence: row.normalized.bookingSequence,
    isDayTrade: row.normalized.isDayTrade,
    commissionAmount: row.normalized.commissionAmount,
    taxAmount: row.normalized.taxAmount,
    feesSource: deriveDraftFeesSource({
      state: row.state,
      commissionAmount: row.normalized.commissionAmount,
      taxAmount: row.normalized.taxAmount,
    }),
    note: row.normalized.note,
    sourceRowRef: row.normalized.sourceRowRef,
    sourceSnippet: row.normalized.sourceSnippet,
    normalizedPayload: row.normalized.normalizedPayload,
    preflightIssues: row.issues,
    warnings: cloneWarnings(row.warnings),
  })));

  const unsupportedItems = preflight.rows
    .filter((row) => row.unsupported)
    .map((row) => ({
      id: randomUUID(),
      batchId,
      rowNumber: row.rowNumber,
      category: row.unsupported!.category,
      reason: row.unsupported!.reason,
      sourceSnippet: row.unsupported!.sourceSnippet,
      rawPayload: row.unsupported!.rawPayload,
    }));
  if (unsupportedItems.length > 0) {
    await deps.app.persistence.replaceAiTransactionDraftUnsupportedItems(batchId, unsupportedItems);
  }

  await appendDraftEvent(deps, batchId, "batch_created", {
    summary: "Transaction draft batch created over MCP",
    afterState: {
      rowCount: batch.rowCount,
      unsupportedCount: batch.unsupportedCount,
      sourceLabel: batch.sourceLabel,
    },
  });
  await appendDraftEvent(deps, batchId, "preflight_run", {
    summary: "Server-side deterministic preflight completed",
    metadata: {
      blockingRowCount: preflight.blockingRowCount,
      unsupportedCount: preflight.unsupportedCount,
    },
  });
  const notificationId = await deps.app.persistence.createNotification({
    userId: contextUserId,
    severity: "info",
    source: "ai_transaction_draft",
    sourceRef: batchId,
    title: "AI transaction draft ready",
    body: `${batch.rowCount} transaction row${batch.rowCount === 1 ? "" : "s"} are ready for review.`,
    detail: {
      batchId,
      contextUserId,
      readyRowCount: preflight.rows.filter((row) => row.state === "ready").length,
      unsupportedCount: preflight.unsupportedCount,
    },
  });
  await deps.app.eventBus.publishEvent(contextUserId, "ai_transaction_draft_created", {
    batchId,
    contextUserId,
    notificationId,
  });

  return {
    batch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, batchId, contextUserId),
  };
}

export async function listTransactionDraftBatches(
  deps: McpDraftServiceDeps,
  input: { status?: "open" | "archived" | "deleted"; limit: number },
) {
  const ownerUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const batches = await deps.app.persistence.listAiTransactionDraftBatchesForOwner(ownerUserId);
  return batches
    .filter((batch) => !input.status || batch.status === input.status)
    .slice(0, input.limit)
    .map((batch) => ({
      ...batch,
      deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, batch.id, ownerUserId),
    }));
}

export async function getTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  batchId: string,
) {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(batchId), batchId);
  const deletedDraftLineages = await deps.app.persistence.listPostedTransactionMutationDeletedDraftLineage(
    aggregate.batch.ownerUserId,
    aggregate.rows.flatMap((row) => row.confirmedTradeEventId ? [row.confirmedTradeEventId] : []),
    aggregate.rows.map((row) => row.id),
  );
  const lineageByTradeId = buildDeletedDraftLineageByTradeId(deletedDraftLineages);
  const lineageByRowId = buildDeletedDraftLineageByRowId(deletedDraftLineages);
  return {
    ...aggregate,
    rows: aggregate.rows.map((row) => ({
      ...row,
      deletedPostedTransaction: findDeletedDraftLineage(row, lineageByTradeId, lineageByRowId) ?? null,
    })),
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, batchId, aggregate.batch.ownerUserId),
  };
}

function toTransactionDraftBatchDto(batch: AiTransactionDraftBatchRecord): TransactionDraftBatchDto {
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
  };
}

function toTransactionDraftRowDto(
  row: AiTransactionDraftRowRecord,
  accountById: ReadonlyMap<string, { id: string; name: string }>,
  lineageByTradeId: ReadonlyMap<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord>,
  lineageByRowId: ReadonlyMap<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord>,
): TransactionDraftRowDto {
  const lineage = findDeletedDraftLineage(row, lineageByTradeId, lineageByRowId);
  const { displayState, statusCopy } = resolveDraftRowDisplay(row, lineage);
  return {
    id: row.id,
    batchId: row.batchId,
    rowNumber: row.rowNumber,
    state: row.state,
    displayState,
    statusCopy,
    version: row.version,
    accountId: row.accountId,
    accountName: row.accountId ? resolveAccountDisplayName(accountById, row.accountId) : row.accountNameInput,
    accountNameInput: row.accountNameInput,
    type: row.tradeType,
    ticker: row.ticker,
    marketCode: row.marketCode as MarketCode | null,
    quantity: row.quantity,
    unitPrice: row.unitPrice,
    priceCurrency: row.priceCurrency,
    tradeDate: row.tradeDate,
    tradeTimestamp: row.tradeTimestamp,
    bookingSequence: row.bookingSequence,
    isDayTrade: row.isDayTrade,
    commissionAmount: row.commissionAmount,
    taxAmount: row.taxAmount,
    feesSource: effectiveDraftFeesSource(row),
    note: row.note,
    sourceRowRef: row.sourceRowRef,
    sourceSnippet: row.sourceSnippet,
    preflightIssues: row.preflightIssues,
    warnings: row.warnings,
    confirmedTradeEventId: row.confirmedTradeEventId,
    confirmedAt: row.confirmedAt,
    deletedPostedTransaction: lineage
      ? {
          deletedAt: lineage.deletedAt,
          deletedByUserId: lineage.deletedByUserId,
          mutationRunId: lineage.mutationRunId,
        }
      : null,
    updatedAt: row.updatedAt,
  } as TransactionDraftRowDto;
}

function buildDeletedDraftLineageByTradeId(
  lineages: readonly import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord[],
): ReadonlyMap<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord> {
  return new Map(lineages.map((lineage) => [lineage.tradeEventId, lineage] as const));
}

function buildDeletedDraftLineageByRowId(
  lineages: readonly import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord[],
): ReadonlyMap<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord> {
  return new Map(lineages.map((lineage) => [lineage.rowId, lineage] as const));
}

function findDeletedDraftLineage(
  row: AiTransactionDraftRowRecord,
  lineageByTradeId: ReadonlyMap<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord>,
  lineageByRowId: ReadonlyMap<string, import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord>,
): import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord | undefined {
  return (row.confirmedTradeEventId ? lineageByTradeId.get(row.confirmedTradeEventId) : undefined)
    ?? lineageByRowId.get(row.id);
}

function resolveDraftRowDisplay(
  row: AiTransactionDraftRowRecord,
  lineage?: import("../persistence/types.js").PostedTransactionMutationDeletedDraftLineageRecord,
): { displayState: DraftRowDisplayState; statusCopy: string } {
  if (lineage) {
    return {
      displayState: "posted_transaction_deleted",
      statusCopy: "Posted transaction deleted",
    };
  }

  const copyByState: Record<AiTransactionDraftRowRecord["state"], string> = {
    needs_clarification: "Needs clarification",
    pending_validation: "Pending validation",
    ready: "Ready to post",
    invalid: "Invalid",
    duplicate_blocked: "Duplicate blocked",
    excluded: "Excluded",
    rejected: "Rejected",
    confirmed: "Posted transaction confirmed",
    unsupported: "Unsupported",
  };
  return {
    displayState: row.state,
    statusCopy: copyByState[row.state],
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

function sourceChannelLabel(provenance: Record<string, unknown>): string {
  return provenance.source === "chatgpt_component" ? "ChatGPT connector import" : "MCP connector import";
}

function countRowMappings(aggregate: AiTransactionDraftBatchAggregate): number {
  return aggregate.rows.length + aggregate.unsupportedItems.length;
}

function collectWidgetAccounts(
  store: Awaited<ReturnType<typeof loadDraftStore>>["store"],
): McpAccountDisplayDto[] {
  const feeProfileById = new Map(store.feeProfiles.map((profile) => [profile.id, profile]));
  return store.accounts
    .map((account) => toMcpAccountDisplayDto(account, feeProfileById.get(account.feeProfileId)?.name ?? null))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function collectPreviewWarnings(
  row: AiTransactionDraftRowRecord,
  calculatedCommissionAmount: number,
  calculatedTaxAmount: number,
): { warnings: string[]; suggestions: string[] } {
  const warnings = row.warnings.filter((warning): warning is string => typeof warning === "string");
  const suggestions: string[] = [];
  if (row.commissionAmount === 0 && calculatedCommissionAmount > 0) {
    warnings.push(`Commission was explicitly set to 0; profile would calculate ${calculatedCommissionAmount}.`);
  } else if (row.commissionAmount !== null && row.commissionAmount !== calculatedCommissionAmount) {
    warnings.push(`Manual commission ${row.commissionAmount} differs from calculated ${calculatedCommissionAmount}.`);
  }
  if (row.taxAmount === 0 && calculatedTaxAmount > 0) {
    warnings.push(`Tax was explicitly set to 0; profile would calculate ${calculatedTaxAmount}.`);
  } else if (row.taxAmount !== null && row.taxAmount !== calculatedTaxAmount) {
    warnings.push(`Manual tax ${row.taxAmount} differs from calculated ${calculatedTaxAmount}.`);
  }
  if (warnings.some((warning) => warning.includes("Manual") || warning.includes("explicitly set to 0"))) {
    suggestions.push("Confirm the manual fee override before posting; Vakwen will preserve the submitted values.");
  }
  return { warnings: cloneWarnings(warnings), suggestions };
}

function feeProfileForPreview(
  store: Awaited<ReturnType<typeof loadDraftStore>>["store"],
  account: Awaited<ReturnType<typeof loadDraftStore>>["store"]["accounts"][number],
  ticker: string,
) {
  const binding = store.feeProfileBindings.find((item) => item.accountId === account.id && item.ticker === ticker);
  const feeProfileId = binding?.feeProfileId ?? account.feeProfileId;
  return store.feeProfiles.find((profile) => profile.id === feeProfileId) ?? null;
}

function buildPostingPreview(
  store: Awaited<ReturnType<typeof loadDraftStore>>["store"],
  aggregate: AiTransactionDraftBatchAggregate,
  selectedRows: AiTransactionDraftRowRecord[],
): McpTransactionDraftPostingPreviewDto {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const previewRows = selectedRows.map((row) => {
    const account = accountById.get(row.accountId ?? "");
    if (!account || !row.accountId || !row.tradeType || !row.marketCode || row.quantity === null || row.unitPrice === null || !row.priceCurrency || !row.ticker || !row.tradeDate) {
      throw routeError(409, "mcp_draft_preview_blocked", `Draft row ${row.id} is missing required posting fields`);
    }
    const profile = feeProfileForPreview(store, account, row.ticker);
    if (!profile) {
      throw routeError(409, "mcp_draft_preview_missing_fee_profile", `Draft row ${row.id} references a missing fee profile`);
    }
    const tradeValueAmount = row.quantity * row.unitPrice;
    const fees = row.tradeType === "BUY"
      ? calculateBuyFees(profile, tradeValueAmount, row.priceCurrency)
      : calculateSellFees(profile, {
          tradeValueAmount,
          tradeCurrency: row.priceCurrency,
          instrumentType: store.instruments.find((instrument) => instrument.ticker === row.ticker && instrument.marketCode === row.marketCode)?.type ?? "STOCK",
          isDayTrade: row.isDayTrade ?? false,
          marketCode: row.marketCode,
        });
    const feeSource = effectiveDraftFeesSource(row) as "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED";
    const commissionAmount = row.commissionAmount ?? fees.commissionAmount;
    const taxAmount = row.taxAmount ?? fees.taxAmount;
    const { warnings, suggestions } = collectPreviewWarnings(row, fees.commissionAmount, fees.taxAmount);
    return {
      rowId: row.id,
      rowNumber: row.rowNumber,
      accountId: account.id,
      accountName: account.name,
      accountType: account.accountType,
      accountDefaultCurrency: account.defaultCurrency,
      ticker: row.ticker,
      marketCode: row.marketCode as MarketCode,
      type: row.tradeType,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      priceCurrency: row.priceCurrency,
      tradeDate: row.tradeDate,
      grossValueAmount: tradeValueAmount,
      commissionAmount,
      taxAmount,
      calculatedCommissionAmount: fees.commissionAmount,
      calculatedTaxAmount: fees.taxAmount,
      feesSource: feeSource,
      netCashImpactAmount: row.tradeType === "BUY"
        ? -(tradeValueAmount + commissionAmount + taxAmount)
        : tradeValueAmount - commissionAmount - taxAmount,
      warnings,
      suggestions,
      sourceSnippet: row.sourceSnippet,
    };
  });
  const grouped = new Map<string, McpTransactionDraftPostingPreviewDto["groups"][number]>();
  for (const row of previewRows) {
    const key = `${row.accountId}:${row.priceCurrency}`;
    const current = grouped.get(key) ?? {
      accountId: row.accountId,
      accountName: row.accountName,
      currency: row.priceCurrency,
      rowCount: 0,
      totalGrossBuyAmount: 0,
      totalGrossSellAmount: 0,
      totalCommissionAmount: 0,
      totalTaxAmount: 0,
      netCashImpactAmount: 0,
    };
    current.rowCount += 1;
    if (row.type === "BUY") current.totalGrossBuyAmount += row.grossValueAmount;
    if (row.type === "SELL") current.totalGrossSellAmount += row.grossValueAmount;
    current.totalCommissionAmount += row.commissionAmount;
    current.totalTaxAmount += row.taxAmount;
    current.netCashImpactAmount += row.netCashImpactAmount;
    grouped.set(key, current);
  }
  return {
    batchId: aggregate.batch.id,
    batchVersion: aggregate.batch.version,
    selectedRowIds: selectedRows.map((row) => row.id),
    rows: previewRows,
    groups: [...grouped.values()].sort((left, right) => left.accountName.localeCompare(right.accountName) || left.currency.localeCompare(right.currency)),
    warnings: previewRows.flatMap((row) => row.warnings).slice(0, 20),
    suggestions: [...new Set(previewRows.flatMap((row) => row.suggestions))].slice(0, 10),
    typedPhraseRequired: confirmationSummary(selectedRows).typedPhraseRequired,
  };
}

function formatGrossValue(rows: AiTransactionDraftRowRecord[], locale = "en"): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.state !== "ready" || !row.priceCurrency || row.quantity === null || row.unitPrice === null) continue;
    totals.set(row.priceCurrency, (totals.get(row.priceCurrency) ?? 0) + row.quantity * row.unitPrice);
  }
  if (totals.size === 0) return "0";
  return [...totals.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([currency, value]) => {
      try {
        return new Intl.NumberFormat(locale, {
          style: "currency",
          currency,
          notation: "compact",
          maximumFractionDigits: 2,
        }).format(value);
      } catch {
        return `${currency} ${value.toFixed(2)}`;
      }
    })
    .join(" + ");
}

function eventTone(event: AiTransactionDraftEventRecord): ChatGptTransactionDraftWidgetAuditItemDto["tone"] {
  if (event.eventType === "rows_confirmed") return "success";
  if (event.eventType === "rows_rejected" || event.eventType === "batch_archived" || event.eventType === "batch_deleted") return "warning";
  return "info";
}

function auditPreview(aggregate: AiTransactionDraftBatchAggregate): ChatGptTransactionDraftWidgetAuditItemDto[] {
  const unresolvedCount = aggregate.rows.filter((row) =>
    row.state === "needs_clarification"
    || row.state === "pending_validation"
    || row.state === "invalid"
    || row.state === "duplicate_blocked",
  ).length;
  const preview = aggregate.events.slice(-3).map((event) => ({
    tone: eventTone(event),
    message: event.summary ?? event.eventType.replace(/_/g, " "),
  }));
  if (unresolvedCount > 0) {
    preview.push({
      tone: "warning",
      message: `${unresolvedCount} row${unresolvedCount === 1 ? "" : "s"} still need review before posting.`,
    });
  }
  if (preview.length === 0) {
    preview.push({
      tone: "info",
      message: "Draft batch loaded through the MCP Apps bridge.",
    });
  }
  return preview.slice(-4);
}

function canUseScope(
  deps: McpDraftServiceDeps,
  settings: { groupToggles: Record<"read" | "research" | "drafts" | "write", boolean> },
  scope: "transaction_draft:edit" | "transaction_draft:archive" | "transaction_draft:delete" | "transaction:write",
  toolName: string,
): boolean {
  if (!settings.groupToggles[connectorGroupForScope(scope)]) return false;
  if (!deps.requestContext.auth.scopes.includes(scope)) return false;
  if (deps.requestContext.auth.toolToggles[toolName] === false) return false;
  const { shareId, shareCapabilities } = deps.requestContext.resolvedContext;
  return !shareId || shareCapabilities.includes(scope);
}

export async function getTransactionDraftBatchComponent(
  deps: McpDraftServiceDeps,
  input: { batchId: string; locale?: string },
): Promise<{ widget: ChatGptTransactionDraftWidgetDto; _meta: Record<string, unknown> }> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  const { store } = await loadDraftStore(deps);
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const deletedDraftLineages = await deps.app.persistence.listPostedTransactionMutationDeletedDraftLineage(
    aggregate.batch.ownerUserId,
    aggregate.rows.flatMap((row) => row.confirmedTradeEventId ? [row.confirmedTradeEventId] : []),
    aggregate.rows.map((row) => row.id),
  );
  const lineageByTradeId = buildDeletedDraftLineageByTradeId(deletedDraftLineages);
  const lineageByRowId = buildDeletedDraftLineageByRowId(deletedDraftLineages);
  const settings = await deps.app.persistence.getAiConnectorPolicySettings();
  const selectedRows = aggregate.rows.filter((row) => row.state === "ready");
  const postingPreview = selectedRows.length > 0 ? buildPostingPreview(store, aggregate, selectedRows) : null;
  const widget: ChatGptTransactionDraftWidgetDto = {
    mode: "review",
    title: "Review transaction draft rows",
    subtitle: "Vakwen received structured candidates through the AI connector and validated them before this component rendered.",
    batch: toTransactionDraftBatchDto(aggregate.batch),
    rows: aggregate.rows.map((row) => toTransactionDraftRowDto(row, accountById, lineageByTradeId, lineageByRowId)),
    unsupportedItems: aggregate.unsupportedItems.map(toTransactionDraftUnsupportedDto),
    accounts: collectWidgetAccounts(store),
    selectedRowIds: selectedRows.map((row) => row.id),
    grossValueText: formatGrossValue(selectedRows, input.locale),
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, aggregate.batch.id, aggregate.batch.ownerUserId),
    postingPreview,
    suggestions: postingPreview?.suggestions ?? [],
    provenance: {
      sourceLabel: aggregate.batch.sourceLabel,
      sourceFilename: aggregate.batch.sourceFilename,
      sourceSummary: "Vakwen stored structured row candidates, capped snippets, row mappings, and provenance metadata only. Raw image/PDF/OCR source files remain outside the app storage path.",
      sourceChannelLabel: sourceChannelLabel(aggregate.batch.provenance),
      structuredCandidatesOnly: true,
      snippetCharacterCap: 500,
      rowMappingCount: countRowMappings(aggregate),
    },
    permissions: {
      canEdit: canUseScope(deps, settings, "transaction_draft:edit", "update_transaction_draft_rows"),
      canArchive: canUseScope(deps, settings, "transaction_draft:archive", "archive_transaction_draft_batch"),
      canDelete: canUseScope(deps, settings, "transaction_draft:delete", "delete_unconfirmed_transaction_draft_batch"),
      canPost: aggregate.batch.status === "open"
        && selectedRows.length > 0
        && canUseScope(deps, settings, "transaction:write", "post_transaction_draft_rows"),
      writeScopeGranted: deps.requestContext.auth.scopes.includes("transaction:write"),
      requiresWriteReconsent: settings.groupToggles.write && !deps.requestContext.auth.scopes.includes("transaction:write"),
      adminWritePolicyEnabled: settings.groupToggles.write,
    },
    auditPreview: auditPreview(aggregate),
    postingResult: null,
    tools: {
      refresh: "get_transaction_draft_batch_component",
      previewPosting: "get_transaction_draft_posting_preview",
      updateRow: "update_transaction_draft_rows",
      excludeRows: "exclude_transaction_draft_rows",
      reincludeRows: "reinclude_transaction_draft_rows",
      rejectRows: "reject_transaction_draft_rows",
      archiveBatch: "archive_transaction_draft_batch",
      deleteBatch: "delete_unconfirmed_transaction_draft_batch",
      postRows: "post_transaction_draft_rows",
    },
  };
  return {
    widget,
    _meta: {
      widget,
      "openai/outputTemplate": buildChatGptTransactionDraftComponentUrl(deps.app.appBaseUrl),
      "openai/widgetAccessible": true,
    },
  };
}

export async function getTransactionDraftPostingPreview(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds?: string[]; expectedBatchVersion?: number },
): Promise<McpTransactionDraftPostingPreviewDto> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  if (input.expectedBatchVersion !== undefined && aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", `Draft batch ${input.batchId} version conflict`);
  }
  const rowById = new Map(aggregate.rows.map((row) => [row.id, row]));
  for (const rowId of input.rowIds ?? []) {
    if (!rowById.has(rowId)) {
      throw routeError(404, "mcp_draft_row_not_found", `Draft row ${rowId} not found`);
    }
  }
  const { store } = await loadDraftStore(deps);
  const selectedRows = aggregate.rows
    .filter((row) => row.state === "ready")
    .filter((row) => !input.rowIds || input.rowIds.includes(row.id));
  if (selectedRows.length === 0) {
    throw routeError(409, "mcp_draft_preview_empty_selection", "No ready draft rows were selected for preview");
  }
  return buildPostingPreview(store, aggregate, selectedRows);
}

function confirmationSummary(rows: AiTransactionDraftRowRecord[]) {
  const grossValueTwd = rows
    .filter((row) => row.priceCurrency === "TWD" && row.quantity !== null && row.unitPrice !== null)
    .reduce((sum, row) => sum + row.quantity! * row.unitPrice!, 0);
  const typedPhraseRequired = rows.length >= 6 || grossValueTwd >= 1_000_000
    ? `POST ${rows.length} TRADES`
    : null;
  return { grossValueTwd, typedPhraseRequired };
}

function firstDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) return value;
    seen.add(value);
  }
  return null;
}

export async function postTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: McpPostTransactionDraftRowsInputDto,
): Promise<McpPostTransactionDraftRowsResultDto> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }

  const rowById = new Map(aggregate.rows.map((row) => [row.id, row]));
  const duplicateRowId = firstDuplicate(input.rowIds);
  if (duplicateRowId) {
    throw routeError(400, "mcp_draft_duplicate_row_id", `Draft row ${duplicateRowId} was selected more than once`);
  }
  const expectedRowIds = input.expectedRowVersions.map((item) => item.rowId);
  const duplicateExpectedRowId = firstDuplicate(expectedRowIds);
  if (duplicateExpectedRowId) {
    throw routeError(400, "mcp_draft_duplicate_expected_row_version", `Draft row ${duplicateExpectedRowId} has duplicate expected versions`);
  }
  const selectedRowIdSet = new Set(input.rowIds);
  const unexpectedVersionRowId = expectedRowIds.find((rowId) => !selectedRowIdSet.has(rowId));
  if (unexpectedVersionRowId) {
    throw routeError(400, "mcp_draft_unselected_expected_row_version", `Draft row ${unexpectedVersionRowId} has a version but was not selected`);
  }
  const expectedByRowId = new Map(input.expectedRowVersions.map((item) => [item.rowId, item.expectedVersion]));
  const selectedRows = input.rowIds.map((rowId) => {
    const row = rowById.get(rowId);
    if (!row) throw routeError(404, "mcp_draft_row_not_found", `Draft row ${rowId} not found`);
    const expectedVersion = expectedByRowId.get(rowId);
    if (expectedVersion === undefined) throw routeError(409, "mcp_draft_row_version_missing", `Draft row ${rowId} expected version missing`);
    if (row.version !== expectedVersion) {
      throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${rowId} version conflict`);
    }
    if (row.state === "confirmed") {
      throw routeError(409, "mcp_draft_row_confirmed", `Draft row ${rowId} is already confirmed`);
    }
    if (row.state !== "ready") {
      throw routeError(409, "mcp_draft_row_not_ready", `Draft row ${rowId} is not ready`);
    }
    return row;
  });

  const confirmation = confirmationSummary(selectedRows);
  if (confirmation.typedPhraseRequired && input.typedConfirmation !== confirmation.typedPhraseRequired) {
    return {
      outcome: "confirmation_required",
      batchId: aggregate.batch.id,
      batchVersion: aggregate.batch.version,
      postedRowIds: [],
      createdTransactionIds: [],
      remainingUnresolvedRowIds: [],
      confirmation: {
        selectedRowCount: selectedRows.length,
        totalRowsRequested: input.rowIds.length,
        typedPhraseRequired: confirmation.typedPhraseRequired,
        typedPhraseSatisfied: false,
        grossValueTwd: confirmation.grossValueTwd,
      },
      deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, aggregate.batch.id, aggregate.batch.ownerUserId),
      eventIds: [],
      rowErrors: [],
    };
  }

  const revalidated = await runPreflight(deps, mapDraftRowsToCandidates(selectedRows));
  const revalidatedByRowNumber = new Map(revalidated.rows.map((row) => [row.rowNumber, row]));
  const blockedRows = selectedRows.flatMap((row) => {
    const next = revalidatedByRowNumber.get(row.rowNumber);
    if (!next || next.state !== "ready" || next.blocking) {
      return [{
        rowId: row.id,
        state: next?.state ?? row.state,
        issues: next?.issues ?? row.preflightIssues,
      }];
    }
    return [];
  });
  if (blockedRows.length > 0) {
    return {
      outcome: "blocked",
      batchId: aggregate.batch.id,
      batchVersion: aggregate.batch.version,
      postedRowIds: [],
      createdTransactionIds: [],
      remainingUnresolvedRowIds: blockedRows.map((row) => row.rowId),
      confirmation: {
        selectedRowCount: selectedRows.length,
        totalRowsRequested: input.rowIds.length,
        typedPhraseRequired: confirmation.typedPhraseRequired,
        typedPhraseSatisfied: true,
        grossValueTwd: confirmation.grossValueTwd,
      },
      deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, aggregate.batch.id, aggregate.batch.ownerUserId),
      eventIds: [],
      rowErrors: blockedRows,
    };
  }

  const claimed = await deps.app.persistence.claimIdempotencyKey(
    deps.requestContext.resolvedContext.portfolioContextUserId,
    input.idempotencyKey,
  );
  if (!claimed) {
    throw routeError(409, "duplicate_idempotency_key", "duplicate idempotency key");
  }

  const { store, contextUserId } = await loadDraftStore(deps);
  const draftStore = structuredClone(store);
  const createdAt = new Date().toISOString();
  const createdTransactionIds: string[] = [];
  const postedRowIds: string[] = [];
  const eventIds: string[] = [];
  let updatedBatchVersion = aggregate.batch.version + 1;

  try {
    for (const row of selectedRows) {
      const tx = createTransaction(draftStore, contextUserId, {
        id: randomUUID(),
        accountId: row.accountId!,
        ticker: row.ticker!,
        marketCode: row.marketCode as MarketCode,
        quantity: row.quantity!,
        unitPrice: row.unitPrice!,
        priceCurrency: row.priceCurrency!,
        tradeDate: row.tradeDate!,
        tradeTimestamp: row.tradeTimestamp ?? undefined,
        bookingSequence: row.bookingSequence ?? undefined,
        commissionAmount: row.commissionAmount ?? undefined,
        taxAmount: row.taxAmount ?? undefined,
        feesSource: effectiveDraftFeesSource(row) as "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED",
        type: row.tradeType!,
        isDayTrade: row.isDayTrade ?? false,
      });
      createdTransactionIds.push(tx.id);
      postedRowIds.push(row.id);
    }

    const eventId = randomUUID();
    const confirmed = await deps.app.persistence.confirmAiTransactionDraftPosting({
      ownerUserId: contextUserId,
      accounting: draftStore.accounting,
      rows: selectedRows.map((row, index) => ({
        ...row,
        state: "confirmed",
        version: row.version + 1,
        feesSource: effectiveDraftFeesSource(row),
        confirmedTradeEventId: createdTransactionIds[index]!,
        confirmedAt: createdAt,
        confirmedByUserId: deps.requestContext.auth.sessionUserId,
        updatedAt: createdAt,
        expectedVersion: row.version,
      })),
      batch: {
        ...aggregate.batch,
        version: aggregate.batch.version + 1,
        updatedAt: createdAt,
        expectedVersion: aggregate.batch.version,
      },
      event: {
        id: eventId,
        batchId: aggregate.batch.id,
        ownerUserId: contextUserId,
        actorUserId: deps.requestContext.auth.sessionUserId,
        connectorConnectionId: deps.requestContext.auth.connection?.id ?? null,
        eventType: "rows_confirmed",
        summary: `${createdTransactionIds.length} draft rows posted`,
        metadata: {
          source: requestSourceLabel(deps),
          idempotencyKey: input.idempotencyKey,
          postedRowIds,
          createdTransactionIds,
        },
        sourceIp: deps.requestContext.sourceIp,
      },
    });
    if (!confirmed) {
      throw routeError(409, "mcp_draft_post_version_conflict", "Draft posting version conflict");
    }
    eventIds.push(confirmed.event.id);
    updatedBatchVersion = confirmed.batch.version;
  } catch (error) {
    await deps.app.persistence.releaseIdempotencyKey(
      deps.requestContext.resolvedContext.portfolioContextUserId,
      input.idempotencyKey,
    );
    throw error;
  }

  try {
    await enqueueFirstTradeBackfillsForDraftRows(deps, {
      rows: selectedRows,
      userId: contextUserId,
    });
  } catch (error) {
    deps.requestContext.logger.warn(
      { error, userId: contextUserId, rowCount: selectedRows.length },
      "mcp_draft_first_trade_backfill_enqueue_failed",
    );
  }

  const earliestByAccountTicker = new Map<string, { accountId: string; ticker: string; marketCode: MarketCode; fromDate: string }>();
  for (const row of selectedRows) {
    if (!row.marketCode) continue;
    const key = `${row.accountId}:${row.ticker}:${row.marketCode}`;
    const current = earliestByAccountTicker.get(key);
    if (!current || row.tradeDate! < current.fromDate) {
      earliestByAccountTicker.set(key, { accountId: row.accountId!, ticker: row.ticker!, marketCode: row.marketCode as MarketCode, fromDate: row.tradeDate! });
    }
  }
  for (const item of earliestByAccountTicker.values()) {
    scheduleReplayWithRetry(deps.app.persistence, deps.app.eventBus, contextUserId, item.accountId, item.ticker, {
      snapshotFromDate: item.fromDate,
      marketCode: item.marketCode,
    });
  }
  await deps.app.eventBus.publishEvent(contextUserId, "ai_transaction_draft_confirmed", {
    batchId: aggregate.batch.id,
    rowIds: postedRowIds,
    tradeEventIds: createdTransactionIds,
    source: requestSourceLabel(deps),
  });

  const refreshed = await deps.app.persistence.getAiTransactionDraftBatch(aggregate.batch.id);
  const remainingUnresolvedRowIds = (refreshed?.rows ?? [])
    .filter((row) =>
      row.state === "needs_clarification"
      || row.state === "pending_validation"
      || row.state === "invalid"
      || row.state === "duplicate_blocked",
    )
    .map((row) => row.id);
  return {
    outcome: "posted",
    batchId: aggregate.batch.id,
    batchVersion: updatedBatchVersion,
    postedRowIds,
    createdTransactionIds,
    remainingUnresolvedRowIds,
    confirmation: {
      selectedRowCount: selectedRows.length,
      totalRowsRequested: input.rowIds.length,
      typedPhraseRequired: confirmation.typedPhraseRequired,
      typedPhraseSatisfied: true,
      grossValueTwd: confirmation.grossValueTwd,
    },
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, aggregate.batch.id, aggregate.batch.ownerUserId),
    eventIds,
    rowErrors: [],
  };
}

function mapDraftRowsToCandidates(rows: AiTransactionDraftRowRecord[]): DraftCandidateInput[] {
  return rows.map((row) => ({
    rowNumber: row.rowNumber,
    recordType: row.state === "unsupported" ? "unsupported" : "trade",
    accountId: row.accountId ?? undefined,
    accountName: row.accountNameInput ?? undefined,
    type: row.tradeType ?? undefined,
    ticker: row.ticker ?? undefined,
    marketCode: row.marketCode as MarketCode | undefined,
    quantity: row.quantity ?? undefined,
    unitPrice: row.unitPrice ?? undefined,
    priceCurrency: row.priceCurrency ?? undefined,
    tradeDate: row.tradeDate ?? undefined,
    tradeTimestamp: row.tradeTimestamp ?? undefined,
    bookingSequence: row.bookingSequence ?? undefined,
    isDayTrade: row.isDayTrade ?? undefined,
    commissionAmount: row.commissionAmount ?? undefined,
    taxAmount: row.taxAmount ?? undefined,
    note: row.note ?? undefined,
    sourceRowRef: row.sourceRowRef ?? undefined,
    sourceSnippet: row.sourceSnippet ?? undefined,
    sourceMetadata: { ...row.normalizedPayload },
  }));
}

export async function updateTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: {
    batchId: string;
    rows: Array<{
      rowId: string;
      expectedVersion: number;
      patch: Partial<Omit<DraftCandidateInput, "rowNumber">>;
    }>;
  },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  const rowById = new Map(aggregate.rows.map((row) => [row.id, row]));
  const patchById = new Map(input.rows.map((item) => [item.rowId, item]));
  for (const item of input.rows) {
    const current = rowById.get(item.rowId);
    if (!current) throw routeError(404, "mcp_draft_row_not_found", `Draft row ${item.rowId} not found`);
    if (current.version !== item.expectedVersion) {
      throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${item.rowId} version conflict`);
    }
    if (current.state === "confirmed") {
      throw routeError(409, "mcp_draft_row_confirmed", `Draft row ${item.rowId} is already confirmed`);
    }
  }

  const nextCandidates = mapDraftRowsToCandidates(aggregate.rows).map((candidate, index) => {
    const current = aggregate.rows[index]!;
    const patch = patchById.get(current.id)?.patch;
    return patch ? { ...candidate, ...patch, rowNumber: candidate.rowNumber } : candidate;
  });
  const preflight = await runPreflight(deps, nextCandidates);
  const preflightByRowNumber = new Map(preflight.rows.map((row) => [row.rowNumber, row]));

  for (const current of aggregate.rows) {
    if (!patchById.has(current.id)) continue;
    const next = preflightByRowNumber.get(current.rowNumber)!;
    if (next.blocking || next.state === "unsupported") {
      throw routeError(409, "mcp_draft_update_blocked", `Draft row ${current.id} failed deterministic preflight`);
    }
  }

  for (const current of aggregate.rows) {
    const patchItem = patchById.get(current.id);
    if (!patchItem) continue;
    const next = preflightByRowNumber.get(current.rowNumber)!;
    const feeFieldsPatched = Object.hasOwn(patchItem.patch, "commissionAmount") || Object.hasOwn(patchItem.patch, "taxAmount");
    let feesSource = effectiveDraftFeesSource({
      state: next.state,
      commissionAmount: next.normalized.commissionAmount,
      taxAmount: next.normalized.taxAmount,
      feesSource: current.feesSource,
    });
    if (feeFieldsPatched) {
      feesSource = deriveDraftFeesSource({
        state: next.state,
        commissionAmount: next.normalized.commissionAmount,
        taxAmount: next.normalized.taxAmount,
      }) === "SOURCE_PROVIDED" ? "MANUAL" : "CALCULATED";
    }
    const saved = await deps.app.persistence.saveAiTransactionDraftRow({
      id: current.id,
      batchId: current.batchId,
      ownerUserId: current.ownerUserId,
      rowNumber: current.rowNumber,
      state: next.state,
      version: current.version + 1,
      accountId: next.normalized.accountId,
      accountNameInput: next.normalized.accountNameInput,
      tradeType: next.normalized.tradeType,
      ticker: next.normalized.ticker,
      marketCode: next.normalized.marketCode,
      quantity: next.normalized.quantity,
      unitPrice: next.normalized.unitPrice,
      priceCurrency: next.normalized.priceCurrency,
      tradeDate: next.normalized.tradeDate,
      tradeTimestamp: next.normalized.tradeTimestamp,
      bookingSequence: next.normalized.bookingSequence,
      isDayTrade: next.normalized.isDayTrade,
      commissionAmount: next.normalized.commissionAmount,
      taxAmount: next.normalized.taxAmount,
      feesSource,
      note: next.normalized.note,
      sourceRowRef: next.normalized.sourceRowRef,
      sourceSnippet: next.normalized.sourceSnippet,
      normalizedPayload: next.normalized.normalizedPayload,
      preflightIssues: next.issues,
      warnings: cloneWarnings(next.warnings),
      expectedVersion: current.version,
    });
    if (!saved) {
      throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${current.id} version conflict`);
    }
    await appendDraftEvent(deps, current.batchId, "row_updated", {
      rowId: current.id,
      summary: "Draft row updated over MCP",
      beforeState: {
        state: current.state,
        accountId: current.accountId,
        ticker: current.ticker,
        quantity: current.quantity,
        unitPrice: current.unitPrice,
        tradeDate: current.tradeDate,
      },
      afterState: {
        state: saved.state,
        accountId: saved.accountId,
        ticker: saved.ticker,
        quantity: saved.quantity,
        unitPrice: saved.unitPrice,
        tradeDate: saved.tradeDate,
      },
    });
  }

  const updatedBatch = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    version: aggregate.batch.version + 1,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!updatedBatch) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  return {
    batch: updatedBatch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, updatedBatch.id, updatedBatch.ownerUserId),
  };
}

async function transitionRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
  state: "excluded" | "rejected",
  eventType: AiTransactionDraftEventType,
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  const rowIds = new Set(input.rowIds);
  for (const row of aggregate.rows) {
    if (!rowIds.has(row.id)) continue;
    if (row.state === "confirmed") throw routeError(409, "mcp_draft_row_confirmed", `Draft row ${row.id} is already confirmed`);
    const saved = await deps.app.persistence.saveAiTransactionDraftRow({
      ...row,
      state,
      version: row.version + 1,
      expectedVersion: row.version,
    });
    if (!saved) throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${row.id} version conflict`);
  }
  const updatedBatch = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    version: aggregate.batch.version + 1,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!updatedBatch) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, eventType, {
    summary: `${input.rowIds.length} draft rows moved to ${state}`,
    metadata: { rowIds: input.rowIds },
  });
  return {
    batch: updatedBatch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, updatedBatch.id, updatedBatch.ownerUserId),
  };
}

export async function excludeTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
) {
  return transitionRows(deps, input, "excluded", "rows_excluded");
}

export async function rejectTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
) {
  return transitionRows(deps, input, "rejected", "rows_rejected");
}

export async function reincludeTransactionDraftRows(
  deps: McpDraftServiceDeps,
  input: { batchId: string; rowIds: string[]; expectedBatchVersion: number },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  assertBatchEditable(aggregate.batch);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  const rowIds = new Set(input.rowIds);
  const nextCandidates = mapDraftRowsToCandidates(aggregate.rows).map((candidate, index) => {
    const current = aggregate.rows[index]!;
    if (!rowIds.has(current.id)) return candidate;
    return { ...candidate, recordType: "trade" as const };
  });
  const preflight = await runPreflight(deps, nextCandidates);
  const byRowNumber = new Map(preflight.rows.map((row) => [row.rowNumber, row]));
  for (const row of aggregate.rows) {
    if (!rowIds.has(row.id)) continue;
    const next = byRowNumber.get(row.rowNumber)!;
    if (next.blocking || next.state === "unsupported") {
      throw routeError(409, "mcp_draft_reinclude_blocked", `Draft row ${row.id} failed deterministic preflight`);
    }
    const saved = await deps.app.persistence.saveAiTransactionDraftRow({
      ...row,
      state: next.state,
      version: row.version + 1,
      accountId: next.normalized.accountId,
      accountNameInput: next.normalized.accountNameInput,
      tradeType: next.normalized.tradeType,
      ticker: next.normalized.ticker,
      marketCode: next.normalized.marketCode,
      quantity: next.normalized.quantity,
      unitPrice: next.normalized.unitPrice,
      priceCurrency: next.normalized.priceCurrency,
      tradeDate: next.normalized.tradeDate,
      tradeTimestamp: next.normalized.tradeTimestamp,
      bookingSequence: next.normalized.bookingSequence,
      isDayTrade: next.normalized.isDayTrade,
      commissionAmount: next.normalized.commissionAmount,
      taxAmount: next.normalized.taxAmount,
      feesSource: deriveDraftFeesSource({
        state: next.state,
        commissionAmount: next.normalized.commissionAmount,
        taxAmount: next.normalized.taxAmount,
      }),
      note: next.normalized.note,
      sourceRowRef: next.normalized.sourceRowRef,
      sourceSnippet: next.normalized.sourceSnippet,
      normalizedPayload: next.normalized.normalizedPayload,
      preflightIssues: next.issues,
      warnings: cloneWarnings(next.warnings),
      expectedVersion: row.version,
    });
    if (!saved) throw routeError(409, "mcp_draft_row_version_conflict", `Draft row ${row.id} version conflict`);
  }
  const updatedBatch = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    version: aggregate.batch.version + 1,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!updatedBatch) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, "rows_reincluded", {
    summary: `${input.rowIds.length} draft rows re-included`,
    metadata: { rowIds: input.rowIds },
  });
  return {
    batch: updatedBatch,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, updatedBatch.id, updatedBatch.ownerUserId),
  };
}

export async function archiveTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  input: { batchId: string; expectedBatchVersion: number },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  const archived = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    status: "archived",
    version: aggregate.batch.version + 1,
    archivedAt: new Date().toISOString(),
    archivedByUserId: deps.requestContext.auth.sessionUserId,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!archived) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, "batch_archived", {
    summary: "Draft batch archived over MCP",
  });
  return {
    batch: archived,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, archived.id, archived.ownerUserId),
  };
}

export async function deleteUnconfirmedTransactionDraftBatch(
  deps: McpDraftServiceDeps,
  input: { batchId: string; expectedBatchVersion: number },
): Promise<McpMutationBatchResult> {
  const aggregate = requireOwnedBatch(deps, await deps.app.persistence.getAiTransactionDraftBatch(input.batchId), input.batchId);
  if (aggregate.batch.version !== input.expectedBatchVersion) {
    throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  }
  if (aggregate.rows.some((row) => row.state === "confirmed" || row.confirmedTradeEventId)) {
    throw routeError(409, "mcp_draft_batch_has_confirmed_rows", "Draft batch contains confirmed rows and cannot be deleted");
  }
  const deleted = await deps.app.persistence.saveAiTransactionDraftBatch({
    ...aggregate.batch,
    status: "deleted",
    version: aggregate.batch.version + 1,
    deletedAt: new Date().toISOString(),
    deletedByUserId: deps.requestContext.auth.sessionUserId,
    updatedAt: new Date().toISOString(),
    expectedVersion: aggregate.batch.version,
  });
  if (!deleted) throw routeError(409, "mcp_draft_batch_version_conflict", "Draft batch version conflict");
  await appendDraftEvent(deps, input.batchId, "batch_deleted", {
    summary: "Never-confirmed draft batch deleted over MCP",
  });
  return {
    batch: deleted,
    deepLinkUrl: buildDeepLink(deps.app.appBaseUrl, deleted.id, deleted.ownerUserId),
  };
}
