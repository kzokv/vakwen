import { createHash } from "node:crypto";
import {
  marketCodeFor,
  type AiConnectorScope,
  type ShareCapability,
} from "@vakwen/shared-types";
import type { FastifyInstance } from "fastify";
import { routeError } from "../lib/routeError.js";
import type {
  AiTransactionDraftBatchAggregate,
  AiTransactionDraftBatchRecord,
  AiTransactionDraftRowRecord,
  ShareGrantRecord,
} from "../persistence/types.js";
import type { McpAuthContext, McpRequestContext } from "../mcp/types.js";

export interface PortfolioSelectorInput {
  label: string;
  email?: string;
}

export interface PortfolioContextDescriptor {
  userId: string;
  label: string;
  email: string | null;
  isSelf: boolean;
  shareId: string | null;
  capabilities: AiConnectorScope[];
}

export interface ResolvedPortfolioSelector {
  requestedContextUserId?: string;
  descriptor: PortfolioContextDescriptor | null;
}

export interface ResolvedDraftBatchLabel {
  batch: AiTransactionDraftBatchRecord;
  batchLabel: string;
}

export interface ResolvedDraftRowNumbers {
  rowIds: string[];
  rowNumbers: number[];
  rows: AiTransactionDraftRowRecord[];
}

const AI_CONNECTOR_SCOPE_VALUES = [
  "portfolio:mcp_read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
  "dividend:write",
] as const satisfies readonly AiConnectorScope[];

const AI_CONNECTOR_SCOPE_SET: ReadonlySet<ShareCapability> = new Set(AI_CONNECTOR_SCOPE_VALUES);

function isAiConnectorShareCapability(
  capability: ShareCapability,
): capability is Exclude<AiConnectorScope, "research:read"> {
  return AI_CONNECTOR_SCOPE_SET.has(capability);
}

export function toAiConnectorScopes(capabilities: readonly ShareCapability[]): AiConnectorScope[] {
  return capabilities.filter(isAiConnectorShareCapability);
}

function normalizeLabel(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function resolvePortfolioLabel(displayName: string | null, email: string | null, isSelf: boolean): string {
  const display = displayName?.trim();
  if (display) return display;
  const normalizedEmail = email?.trim();
  if (normalizedEmail) return normalizedEmail.split("@")[0] ?? normalizedEmail;
  return isSelf ? "My portfolio" : "Shared portfolio";
}

function intersectCapabilities(
  authScopes: readonly AiConnectorScope[],
  shareCapabilities: readonly ShareCapability[],
): AiConnectorScope[] {
  const shareSet = new Set(toAiConnectorScopes(shareCapabilities));
  return authScopes.filter((scope) => shareSet.has(scope));
}

async function selfPortfolioDescriptor(
  app: FastifyInstance,
  auth: McpAuthContext,
): Promise<PortfolioContextDescriptor> {
  const selfUser = await app.persistence.getAuthUserById(auth.sessionUserId);
  return {
    userId: auth.sessionUserId,
    label: resolvePortfolioLabel(selfUser?.displayName ?? null, selfUser?.email ?? null, true),
    email: selfUser?.email ?? null,
    isSelf: true,
    shareId: null,
    capabilities: [...auth.scopes],
  };
}

function toSharedPortfolioDescriptor(
  auth: McpAuthContext,
  record: ShareGrantRecord,
  shareCapabilities: ShareCapability[],
): PortfolioContextDescriptor {
  return {
    userId: record.ownerUserId,
    label: resolvePortfolioLabel(record.ownerDisplayName, record.ownerEmail, false),
    email: record.ownerEmail,
    isSelf: false,
    shareId: record.id,
    capabilities: intersectCapabilities(auth.scopes, shareCapabilities),
  };
}

export async function listAccessiblePortfolioContexts(
  app: FastifyInstance,
  auth: McpAuthContext,
): Promise<PortfolioContextDescriptor[]> {
  const inbound = await app.persistence.listInboundSharesForGrantee(auth.sessionUserId);
  const self = await selfPortfolioDescriptor(app, auth);
  const shared = await Promise.all(
    inbound.active.map(async (record) => toSharedPortfolioDescriptor(
      auth,
      record,
      await app.persistence.getShareCapabilities(record.id),
    )),
  );
  return [self, ...shared]
    .filter((context) => context.capabilities.length > 0 || context.isSelf)
    .sort((left, right) => {
      if (left.isSelf && !right.isSelf) return -1;
      if (!left.isSelf && right.isSelf) return 1;
      return left.label.localeCompare(right.label);
    });
}

export async function resolvePortfolioSelector(
  app: FastifyInstance,
  auth: McpAuthContext,
  args: unknown,
): Promise<ResolvedPortfolioSelector> {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    return { descriptor: null };
  }

  const input = args as {
    portfolioContextUserId?: unknown;
    portfolio?: PortfolioSelectorInput;
  };
  const requestedById = typeof input.portfolioContextUserId === "string" && input.portfolioContextUserId.trim().length > 0
    ? input.portfolioContextUserId.trim()
    : undefined;
  const requestedBySelector = input.portfolio && typeof input.portfolio === "object"
    ? input.portfolio
    : undefined;

  if (!requestedById && !requestedBySelector) {
    return { descriptor: null };
  }

  const contexts = await listAccessiblePortfolioContexts(app, auth);
  let matched: PortfolioContextDescriptor | null = null;
  const byId = requestedById
    ? contexts.find((candidate) => candidate.userId === requestedById) ?? null
    : null;

  if (requestedById && !byId) {
    throw routeError(403, "mcp_shared_context_denied", "Shared portfolio MCP access is not available for that context");
  }

  if (requestedBySelector) {
    const requestedLabel = normalizeLabel(requestedBySelector.label);
    const requestedEmail = requestedBySelector.email ? normalizeEmail(requestedBySelector.email) : null;
    const matches = contexts.filter((candidate) => {
      if (normalizeLabel(candidate.label) !== requestedLabel) return false;
      if (!requestedEmail) return true;
      return candidate.email !== null && normalizeEmail(candidate.email) === requestedEmail;
    });
    if (byId) {
      if (matches.some((candidate) => candidate.userId === byId.userId)) {
        matched = byId;
      } else if (matches.length > 0) {
        throw routeError(
          409,
          "mcp_portfolio_selector_conflict",
          "portfolio and portfolioContextUserId resolved to different portfolios",
        );
      } else {
        throw routeError(
          409,
          "mcp_portfolio_selector_conflict",
          "portfolio did not match the portfolioContextUserId context",
        );
      }
    } else if (matches.length === 0) {
      throw routeError(
        404,
        "mcp_portfolio_not_found",
        requestedEmail
          ? `Portfolio ${requestedBySelector.label} <${requestedEmail}> was not found`
          : `Portfolio ${requestedBySelector.label} was not found`,
      );
    } else if (matches.length > 1) {
      throw routeError(
        409,
        "mcp_portfolio_ambiguous",
        `Portfolio label ${requestedBySelector.label} matched multiple portfolios. Provide portfolio.email or call list_portfolio_contexts first.`,
      );
    } else {
      matched = matches[0] ?? null;
    }
  }

  if (requestedById) {
    const idMatch = byId!;
    if (matched && matched.userId !== idMatch.userId) {
      throw routeError(
        409,
        "mcp_portfolio_selector_conflict",
        "portfolio and portfolioContextUserId resolved to different portfolios",
      );
    }
    matched = idMatch;
  }

  return {
    requestedContextUserId: matched?.userId,
    descriptor: matched,
  };
}

export function buildConfirmationDigest(payload: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function inferDefaultMarketCode(defaultCurrency: string): string | null {
  try {
    return marketCodeFor(defaultCurrency);
  } catch {
    return null;
  }
}

function buildBatchLabelBase(batch: AiTransactionDraftBatchRecord): string {
  const sourceLabel = batch.sourceLabel?.trim();
  if (sourceLabel) return sourceLabel;
  const sourceFilename = batch.sourceFilename?.trim();
  if (sourceFilename) return sourceFilename.replace(/\.[^.]+$/, "");
  return `Draft ${batch.createdAt.slice(0, 16).replace("T", " ")}`;
}

export function buildDraftBatchLabels(
  batches: readonly AiTransactionDraftBatchRecord[],
): Map<string, string> {
  const grouped = new Map<string, AiTransactionDraftBatchRecord[]>();
  for (const batch of batches) {
    const base = buildBatchLabelBase(batch);
    const bucket = grouped.get(base) ?? [];
    bucket.push(batch);
    grouped.set(base, bucket);
  }

  const labels = new Map<string, string>();
  for (const [base, bucket] of grouped.entries()) {
    if (bucket.length === 1) {
      labels.set(bucket[0]!.id, base);
      continue;
    }
    bucket
      .slice()
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id))
      .forEach((batch, index) => {
        const timestamp = batch.createdAt.slice(0, 16).replace("T", " ");
        labels.set(batch.id, `${base} (${timestamp} #${index + 1})`);
      });
  }
  return labels;
}

export function resolveDraftBatchByLabel(
  batches: readonly AiTransactionDraftBatchRecord[],
  batchLabel: string,
): ResolvedDraftBatchLabel {
  const labels = buildDraftBatchLabels(batches);
  const requested = normalizeLabel(batchLabel);
  const exact = batches.filter((batch) => normalizeLabel(labels.get(batch.id) ?? "") === requested);
  if (exact.length === 1) {
    return { batch: exact[0]!, batchLabel: labels.get(exact[0]!.id)! };
  }

  const baseMatches = batches.filter((batch) => normalizeLabel(buildBatchLabelBase(batch)) === requested);
  if (baseMatches.length > 1) {
    throw routeError(
      409,
      "mcp_batch_label_ambiguous",
      `Batch label ${batchLabel} matched multiple draft batches. Call list_transaction_draft_batches_by_name and retry with the exact batchLabel.`,
    );
  }
  if (baseMatches.length === 1) {
    const batch = baseMatches[0]!;
    return { batch, batchLabel: labels.get(batch.id)! };
  }

  throw routeError(404, "mcp_batch_not_found", `Draft batch ${batchLabel} was not found`);
}

export function resolveRowsByRowNumber(
  aggregate: AiTransactionDraftBatchAggregate,
  requestedRowNumbers: number[],
): ResolvedDraftRowNumbers {
  const duplicate = requestedRowNumbers.find((value, index) => requestedRowNumbers.indexOf(value) !== index);
  if (duplicate !== undefined) {
    throw routeError(400, "mcp_duplicate_row_number", `Row number ${duplicate} was selected more than once`);
  }

  const rowByNumber = new Map<number, AiTransactionDraftRowRecord>();
  for (const row of aggregate.rows) {
    if (rowByNumber.has(row.rowNumber)) {
      throw routeError(409, "mcp_duplicate_batch_row_number", `Draft batch contains duplicate row number ${row.rowNumber}`);
    }
    rowByNumber.set(row.rowNumber, row);
  }

  const rows = requestedRowNumbers.map((rowNumber) => {
    const row = rowByNumber.get(rowNumber);
    if (!row) {
      throw routeError(404, "mcp_draft_row_not_found", `Draft row ${rowNumber} was not found`);
    }
    return row;
  });
  return {
    rowIds: rows.map((row) => row.id),
    rowNumbers: rows.map((row) => row.rowNumber),
    rows,
  };
}

export function requireMutableRows(rows: readonly AiTransactionDraftRowRecord[], actionLabel: string): void {
  for (const row of rows) {
    if (row.state === "confirmed") {
      throw routeError(409, "mcp_draft_row_confirmed", `Draft row ${row.rowNumber} is already confirmed and cannot be ${actionLabel}`);
    }
  }
}

export function portfolioDescriptorForResolvedContext(
  requestContext: McpRequestContext,
  descriptor: PortfolioContextDescriptor | null,
): { label: string; email: string | null; isDelegated: boolean } {
  if (descriptor) {
    return {
      label: descriptor.label,
      email: descriptor.email,
      isDelegated: !descriptor.isSelf,
    };
  }
  return {
    label: requestContext.resolvedContext.portfolioContextUserId,
    email: null,
    isDelegated: requestContext.resolvedContext.shareId !== null,
  };
}
