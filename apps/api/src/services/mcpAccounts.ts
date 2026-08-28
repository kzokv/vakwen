import { roundToDecimal } from "@vakwen/domain";
import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountType,
  ChatGptAccountManagerWidgetDto,
  McpAccountDisplayDto,
} from "@vakwen/shared-types";
import type { McpDraftServiceDeps } from "../mcp/types.js";
import type { Store } from "../types/store.js";
import { resolveUniqueActiveAccount } from "./mcpAccountHelpers.js";
import { syncAccountingPolicy } from "./accountingStore.js";
import { connectorGroupForScope } from "./mcpConnectorLifecycle.js";
import {
  publishAccountMutationEventToOwnerAndActiveGrantees,
  publishLifecycleEventToOwnerAndActiveGrantees,
} from "./accountMutationEvents.js";

interface AccountMutationAudit {
  actorUserId: string;
  ipAddress: string | null;
  metadata: Record<string, unknown>;
}

async function appendDelegatedAccountWriteAudit(
  deps: McpDraftServiceDeps,
  metadata: Record<string, unknown>,
): Promise<void> {
  const { shareId, portfolioContextUserId } = deps.requestContext.resolvedContext;
  if (!shareId) {
    return;
  }
  try {
    await deps.app.persistence.appendAuditLog({
      actorUserId: deps.requestContext.auth.sessionUserId,
      action: "delegated_portfolio_write",
      targetUserId: portfolioContextUserId,
      ipAddress: deps.requestContext.sourceIp,
      metadata: {
        ...metadata,
        delegatedByUserId: deps.requestContext.auth.sessionUserId,
        ownerUserId: portfolioContextUserId,
        contextUserId: portfolioContextUserId,
        shareId,
        source: "mcp_tool",
      },
    });
  } catch (error) {
    deps.requestContext.logger?.error(
      { error, action: "delegated_portfolio_write", metadata },
      "delegated account write audit append failed",
    );
  }
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

async function loadAccountStore(deps: McpDraftServiceDeps) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const store = await deps.app.persistence.loadStore(contextUserId);
  syncAccountingPolicy(store);
  return { store, contextUserId };
}

function toAccountDisplay(
  store: Store,
  account: AccountDto & { deletedAt?: string | null },
  balancesByAccount: Map<string, Array<{ currency: string; amount: number }>>,
): McpAccountDisplayDto {
  const profile = store.feeProfiles.find((item) => item.id === account.feeProfileId) ?? null;
  return {
    id: account.id,
    name: account.name,
    defaultCurrency: account.defaultCurrency,
    accountType: account.accountType,
    feeProfileId: account.feeProfileId,
    feeProfileName: profile?.name ?? null,
    status: account.deletedAt ? "deleted" : "active",
    deletedAt: account.deletedAt ?? null,
    liveBalance: account.deletedAt ? [] : balancesByAccount.get(account.id) ?? [],
  };
}

export async function listMcpAccountDisplays(
  deps: McpDraftServiceDeps,
  input: { includeDeleted?: boolean } = {},
): Promise<{ accounts: McpAccountDisplayDto[]; deletedAccounts: McpAccountDisplayDto[] }> {
  const { store, contextUserId } = await loadAccountStore(deps);
  const balancesByAccount = buildLiveBalancesByAccount(store);
  const accounts = store.accounts
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((account) => toAccountDisplay(store, account, balancesByAccount));
  const deletedAccounts = input.includeDeleted
    ? (await deps.app.persistence.listSoftDeletedAccounts(contextUserId))
      .map((account) => toAccountDisplay(store, account, balancesByAccount))
    : [];
  return { accounts, deletedAccounts };
}

function accountSuggestions(accounts: McpAccountDisplayDto[], deletedAccounts: McpAccountDisplayDto[]): string[] {
  const suggestions: string[] = [];
  if (accounts.length === 0) suggestions.push("Create an account before drafting or posting transactions.");
  if (deletedAccounts.length > 0) suggestions.push("Recently deleted accounts can be restored before posting attached transactions.");
  const duplicateNames = new Set<string>();
  const seen = new Set<string>();
  for (const account of accounts) {
    const key = account.name.trim().toLowerCase();
    if (seen.has(key)) duplicateNames.add(account.name);
    seen.add(key);
  }
  for (const name of duplicateNames) {
    suggestions.push(`Rename duplicate account "${name}" to keep MCP account-name resolution unambiguous.`);
  }
  return suggestions;
}

const ACCOUNT_MANAGER_TOOLS = {
  refresh: "get_account_manager_component",
  createAccount: "create_account",
  updateAccount: "update_account",
  softDeleteAccount: "soft_delete_account",
  restoreAccount: "restore_account",
} as const;

function canUseAccountManageScope(deps: McpDraftServiceDeps, settings: { groupToggles: Record<"read" | "research" | "drafts" | "write", boolean> }): boolean {
  if (!settings.groupToggles[connectorGroupForScope("account:manage")]) return false;
  if (!deps.requestContext.auth.scopes.includes("account:manage")) return false;
  const { shareId, shareCapabilities } = deps.requestContext.resolvedContext;
  return !shareId || shareCapabilities.includes("account:manage");
}

function canUseAccountTool(deps: McpDraftServiceDeps, toolName: string, canUseManageScope: boolean): boolean {
  return canUseManageScope && deps.requestContext.auth.toolToggles[toolName] !== false;
}

export async function getAccountManagerComponent(
  deps: McpDraftServiceDeps,
): Promise<{ widget: ChatGptAccountManagerWidgetDto; _meta: Record<string, unknown> }> {
  const settings = await deps.app.persistence.getAiConnectorPolicySettings();
  const { accounts, deletedAccounts } = await listMcpAccountDisplays(deps, { includeDeleted: true });
  const canManage = canUseAccountManageScope(deps, settings);
  const permissions = {
    canCreate: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.createAccount, canManage),
    canEdit: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.updateAccount, canManage),
    canSoftDelete: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.softDeleteAccount, canManage),
    canRestore: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.restoreAccount, canManage),
    manageScopeGranted: deps.requestContext.auth.scopes.includes("account:manage"),
    adminWritePolicyEnabled: settings.groupToggles.write,
  };
  const widget: ChatGptAccountManagerWidgetDto = {
    title: "Manage accounts",
    subtitle: "Create, edit, soft-delete, and restore portfolio accounts through MCP tools.",
    accounts,
    deletedAccounts,
    permissions,
    suggestions: accountSuggestions(accounts, deletedAccounts),
    tools: {
      refresh: canUseAccountTool(deps, ACCOUNT_MANAGER_TOOLS.refresh, canManage) ? ACCOUNT_MANAGER_TOOLS.refresh : null,
      createAccount: permissions.canCreate ? ACCOUNT_MANAGER_TOOLS.createAccount : null,
      updateAccount: permissions.canEdit ? ACCOUNT_MANAGER_TOOLS.updateAccount : null,
      softDeleteAccount: permissions.canSoftDelete ? ACCOUNT_MANAGER_TOOLS.softDeleteAccount : null,
      restoreAccount: permissions.canRestore ? ACCOUNT_MANAGER_TOOLS.restoreAccount : null,
    },
  };
  return {
    widget,
    _meta: {
      widget,
      "openai/outputTemplate": `${deps.app.appBaseUrl}/connectors/chatgpt/account-manager`,
      "openai/widgetAccessible": true,
    },
  };
}

export async function listAccounts(
  deps: McpDraftServiceDeps,
  input: { includeDeleted?: boolean } = {},
) {
  return listMcpAccountDisplays(deps, input);
}

export async function createAccount(
  deps: McpDraftServiceDeps,
  input: { name: string; defaultCurrency: AccountDefaultCurrency; accountType: AccountType },
) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const name = input.name.trim();
  const result = await deps.app.persistence.createAccount({
    userId: contextUserId,
    name,
    defaultCurrency: input.defaultCurrency,
    accountType: input.accountType,
    auditInput: auditForMutation(deps),
  });
  await appendDelegatedAccountWriteAudit(deps, {
    mutation: "account_created",
    toolName: ACCOUNT_MANAGER_TOOLS.createAccount,
    accountId: result.account.id,
  });
  await publishAccountMutationEventToOwnerAndActiveGrantees(
    deps.app,
    contextUserId,
    "account_created",
    result,
  );
  return { account: result.account };
}

export async function updateAccount(
  deps: McpDraftServiceDeps,
  input: { accountId?: string | null; accountName?: string | null; name?: string; feeProfileId?: string; accountType?: AccountType },
) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const accounts = await deps.app.persistence.listActiveAccounts(contextUserId);
  const account = resolveUniqueActiveAccount(accounts, input);
  const result = await deps.app.persistence.updateAccount({
    userId: contextUserId,
    accountId: account.id,
    ...(input.name !== undefined ? { name: input.name.trim() } : {}),
    ...(input.feeProfileId !== undefined ? { feeProfileId: input.feeProfileId } : {}),
    ...(input.accountType !== undefined ? { accountType: input.accountType } : {}),
    auditInput: auditForMutation(deps),
  });
  await appendDelegatedAccountWriteAudit(deps, {
    mutation: "account_updated",
    toolName: ACCOUNT_MANAGER_TOOLS.updateAccount,
    accountId: result.account.id,
    changedFields: Object.keys(input).filter((key) => input[key as keyof typeof input] !== undefined),
  });
  await publishAccountMutationEventToOwnerAndActiveGrantees(
    deps.app,
    contextUserId,
    "account_updated",
    result,
  );
  return { account: result.account };
}

function auditForMutation(deps: McpDraftServiceDeps): AccountMutationAudit {
  const { shareId, portfolioContextUserId } = deps.requestContext.resolvedContext;
  return {
    actorUserId: deps.requestContext.auth.sessionUserId,
    ipAddress: deps.requestContext.sourceIp,
    metadata: {
      source: "mcp_tool",
      ...(shareId
        ? {
            delegatedByUserId: deps.requestContext.auth.sessionUserId,
            ownerUserId: portfolioContextUserId,
            contextUserId: portfolioContextUserId,
            shareId,
          }
        : {}),
    },
  };
}

export async function softDeleteAccount(
  deps: McpDraftServiceDeps,
  input: { accountId?: string | null; accountName?: string | null },
) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const { store } = await loadAccountStore(deps);
  const account = resolveUniqueActiveAccount(store.accounts, input);
  const deleted = await deps.app.persistence.softDeleteAccount(account.id, contextUserId, auditForMutation(deps));
  await publishLifecycleEventToOwnerAndActiveGrantees(deps.app, contextUserId, "account_soft_deleted", deleted);
  return { accountId: account.id, accountName: account.name, deletedAt: deleted.deletedAt };
}

export async function restoreAccount(
  deps: McpDraftServiceDeps,
  input: { accountId: string },
) {
  const contextUserId = deps.requestContext.resolvedContext.portfolioContextUserId;
  const restored = await deps.app.persistence.restoreAccount(input.accountId, contextUserId, auditForMutation(deps));
  await publishLifecycleEventToOwnerAndActiveGrantees(deps.app, contextUserId, "account_restored", restored);
  return { accountId: input.accountId, finalName: restored.finalName };
}
