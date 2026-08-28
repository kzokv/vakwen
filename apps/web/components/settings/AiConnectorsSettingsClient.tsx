"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  Bot,
  Cable,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Search,
  Shield,
  Wrench,
} from "lucide-react";
import type {
  AiConnectorAccessKind,
  AiConnectorAccessLogDto,
  AiConnectorClientKind,
  AiConnectorConnectionDto,
  AiConnectorReadinessCheckKey,
  AiConnectorScope,
  AiConnectorStatus,
  AiConnectorToolAvailability,
  AiConnectorToolBlockerCode,
  AiConnectorToolCatalogEntryDto,
  AiConnectorToolGroup,
} from "@vakwen/shared-types";
import { cn } from "../../lib/utils";
import { useOptionalAppShellData } from "../layout/AppShellDataContext";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/shadcn/sheet";
import {
  createAiConnectorBearer,
  fetchAiConnectorHistory,
  fetchAiConnectorLogs,
  fetchAiConnectorSummary,
  hideAiConnectorHistory,
  revokeAiConnector,
  updateAiConnector,
  type AiConnectorSummaryResponse,
} from "../../features/ai-inbox/service";
import { getAiConnectorScopeLabel } from "../connectors/i18n";
import { McpStatusChip, mcpStatusTone } from "../connectors/McpUiPrimitives";
import {
  AiClientGlyph,
  getAiClientMetadata,
  getAiClientMetadataFromConnection,
  type CompatibleAiClientKind,
} from "../connectors/clientMetadata";

type SectionId = "overview" | "connect" | "connections" | "history" | "permissions" | "tool-catalog" | "activity";
type ExtendedAiConnectorScope = AiConnectorScope | "research:read";
type ExtendedAiConnectorToolGroup = AiConnectorToolGroup | "research";
type ScopeGroupKey = "read" | "research" | "accounts" | "drafts" | "posting";
type ToolGroupFilter = "all" | ExtendedAiConnectorToolGroup;
type ToolAvailabilityFilter = "all" | AiConnectorToolAvailability;
type ToolScopeFilter = "all" | ExtendedAiConnectorScope;
type ToolOverrideFilter = "all" | "explicit" | "inherited";
type ActivityResultFilter = "all" | "ok" | "denied" | "error";
type HistoryAuthFilter = "all" | "oauth" | "bearer";
type HistoryEndedFilter = "all" | "7d" | "30d" | "90d";
type BearerClientKind = Exclude<AiConnectorClientKind, "chatgpt_app" | "claude_ai_connector">;

type LocalizedCopy = {
  pageEyebrow: string;
  pageTitle: string;
  pageDescription: string;
  refresh: string;
  copyUrl: string;
  copySnippet: string;
  copied: string;
  policyAlert: string;
  loading: string;
  loadError: string;
  emptyConnections: string;
  emptyConnectionsBody: string;
  firstRunTitle: string;
  firstRunBody: string;
  firstRunAction: string;
  repairTitle: string;
  repairAdminBody: string;
  repairUserBody: string;
  openAdminMcpSettings: string;
  active: string;
  inactive: string;
  pending: string;
  expired: string;
  revoked: string;
  available: string;
  unavailable: string;
  never: string;
  sectionOverview: string;
  sectionConnect: string;
  sectionConnections: string;
  sectionHistory: string;
  sectionPermissions: string;
  sectionToolCatalog: string;
  sectionActivity: string;
  overviewTitle: string;
  overviewBody: string;
  endpoint: string;
  readiness: string;
  activeClients: string;
  bearerFallback: string;
  highRisk: string;
  oauthReady: string;
  tokenSecretReady: string;
  postingOn: string;
  postingOff: string;
  connectTitle: string;
  connectBody: string;
  connectionsTitle: string;
  connectionsBody: string;
  permissionsTitle: string;
  permissionsBody: string;
  permissionsMatrixHint: string;
  mobilePermissionsHint: string;
  emptyPermissions: string;
  emptyPermissionsBody: string;
  toolCatalogTitle: string;
  toolCatalogBody: string;
  emptyToolCatalog: string;
  emptyToolCatalogBody: string;
  toolDetailTitle: string;
  toolDetailEmpty: string;
  schemaSummary: string;
  rawSchema: string;
  requiredField: string;
  optionalField: string;
  riskAnnotations: string;
  activityTitle: string;
  activityBody: string;
  searchTools: string;
  searchActivity: string;
  filterGroup: string;
  filterAvailability: string;
  filterScope: string;
  filterOverride: string;
  filterResult: string;
  filterAll: string;
  loadMore: string;
  recentActivity: string;
  recentOutcomes: string;
  revoke: string;
  reconnect: string;
  reconnectBody: string;
  reconnectPrompt: string;
  connectorRevoked: string;
  permissionSaved: string;
  toolSaved: string;
  updateError: string;
  revokeError: string;
  toolError: string;
  revokeConfirm: string;
  currentConnections: string;
  historicalConnections: string;
  historyFilters: string;
  searchHistory: string;
  historyStatus: string;
  historyAuth: string;
  oauthAuthMode: string;
  bearerAuthMode: string;
  historyEnded: string;
  endedLast7: string;
  endedLast30: string;
  endedLast90: string;
  removeHistoryItem: string;
  removeSelectedHistory: string;
  selectedHistoryRows: string;
  selectVisibleHistory: string;
  historyRemoveConfirm: string;
  historyBulkRemoveConfirm: string;
  historyAuditRetained: string;
  historyLabel: string;
  noHistory: string;
  noMatchingHistory: string;
  details: string;
  connectionDetails: string;
  statusReason: string;
  connectorId: string;
  permissions: string;
  backToConnection: string;
  viewActivityForConnection: string;
  clientKind: string;
  vendor: string;
  authMode: string;
  scopes: string;
  lastUsed: string;
  expires: string;
  created: string;
  docs: string;
  setup: string;
  tier: string;
  connected: string;
  inspect: string;
  readGroup: string;
  researchGroup: string;
  accountsGroup: string;
  draftGroup: string;
  postingGroup: string;
  draftCreate: string;
  draftUpdate: string;
  draftArchive: string;
  draftDelete: string;
  writeAccess: string;
  readAccess: string;
  toolOverrides: string;
  scopeLabel: string;
  alternativeScopesLabel: string;
  alternativeScopesBody: string;
  accessLabel: string;
  noMatchingTools: string;
  noActivity: string;
  hiddenByPolicy: string;
  bearerScopeLocked: string;
  oauthScopeLocked: string;
  researchScope: string;
  researchScopeLocked: string;
  advancedWriteScope: string;
  requiresScope: string;
  connectorInactive: string;
  disabledByOverride: string;
  inheritedDefault: string;
  explicitOverride: string;
  explicitOverrides: string;
  inheritedOnly: string;
  highestPriorityBlocker: string;
  canUse: string;
  unavailableFor: string;
  recentCalls: string;
  viewAllCalls: string;
  loadActivityError: string;
  createBearer: string;
  bearerName: string;
  bearerLifetime: string;
  bearerScopes: string;
  bearerCreated: string;
  bearerCreateError: string;
  bearerTokenOneTime: string;
  bearerUnavailable: string;
  bearerSecondary: string;
  bearerBlockedReasons: string;
  bearerBlockedGlobal: string;
  bearerBlockedClientDisabled: string;
  bearerBlockedClientNotAllowed: string;
  bearerBlockedNoToolGroups: string;
  bearerBlockedDuplicate: string;
  bearerBlockedLimit: string;
  bearerRepairLink: string;
  closeToken: string;
  webSession: string;
};

const COPY: Record<"en" | "zh-TW", LocalizedCopy> = {
  en: {
    pageEyebrow: "AI settings",
    pageTitle: "AI Connectors",
    pageDescription: "One MCP command center for setup, connection health, permissions, tool access, and recent activity.",
    refresh: "Refresh",
    copyUrl: "Copy MCP URL",
    copySnippet: "Copy snippet",
    copied: "MCP URL copied.",
    policyAlert: "Admin policy has disabled all MCP tool groups. Connector permissions stay read-only until at least one group is re-enabled.",
    loading: "Loading AI connector command center...",
    loadError: "AI connector settings could not be loaded.",
    emptyConnections: "No AI connectors are connected yet.",
    emptyConnectionsBody: "Use one of the client setup cards below, then return here to review status and access.",
    firstRunTitle: "Start with a client setup card",
    firstRunBody: "MCP readiness is available. Connect ChatGPT, Claude Code, or Codex first, then return to tune OAuth scopes, advanced write tools, and effective access.",
    firstRunAction: "View Connect cards",
    repairTitle: "Admin setup is required before connectors can use MCP tools",
    repairAdminBody: "Open Admin MCP settings to repair readiness, client-kind allowlists, bearer fallback, or disabled tool groups.",
    repairUserBody: "Ask an admin to repair MCP readiness or re-enable at least one tool group before connecting a client.",
    openAdminMcpSettings: "Open Admin MCP settings",
    active: "Active",
    inactive: "Inactive",
    pending: "Pending",
    expired: "Expired",
    revoked: "Revoked",
    available: "Available",
    unavailable: "Unavailable",
    never: "Never",
    sectionOverview: "Overview",
    sectionConnect: "Connect",
    sectionConnections: "Connections",
    sectionHistory: "History",
    sectionPermissions: "Permissions",
    sectionToolCatalog: "Tool Catalog",
    sectionActivity: "Activity",
    overviewTitle: "Command center",
    overviewBody: "Monitor shared MCP readiness, copy the endpoint, and see how many live clients can reach the server right now.",
    endpoint: "MCP endpoint",
    readiness: "Readiness",
    activeClients: "Live clients",
    bearerFallback: "Bearer fallback",
    highRisk: "High-risk tools",
    oauthReady: "OAuth ready",
    tokenSecretReady: "Token secret set",
    postingOn: "Posting allowed",
    postingOff: "Posting off",
    connectTitle: "Connect clients",
    connectBody: "Tier 1 clients are the supported first path. Tier 2 clients use the same MCP endpoint with thinner setup guidance.",
    connectionsTitle: "Connections",
    connectionsBody: "Grouped connector inventory with current state, expiry, and quick repair actions.",
    permissionsTitle: "Permissions",
    permissionsBody: "Per-client controls narrow OAuth/share scopes and individual MCP tools. Tool overrides never grant access beyond granted scopes or admin policy.",
    permissionsMatrixHint: "Desktop keeps a compact client-by-risk-group matrix. Advanced financial write scopes and tool overrides stay nested under each client row.",
    mobilePermissionsHint: "On mobile, each client expands into its own accordion to avoid a squeezed matrix.",
    emptyPermissions: "No connector permissions to review yet.",
    emptyPermissionsBody: "Connect a client first. Permission controls appear here after a connector exists.",
    toolCatalogTitle: "Standalone MCP tool catalog",
    toolCatalogBody: "Inspect the shared tool inventory once, then drill into effective availability and which clients are blocked.",
    emptyToolCatalog: "No MCP tools are registered.",
    emptyToolCatalogBody: "The MCP server is reachable, but it did not return a tool catalog for this policy state.",
    toolDetailTitle: "Tool detail",
    toolDetailEmpty: "Select a tool to inspect availability, required scope, and affected clients.",
    schemaSummary: "Schema summary",
    rawSchema: "Raw schema",
    requiredField: "Required",
    optionalField: "Optional",
    riskAnnotations: "Risk annotations",
    activityTitle: "Recent activity",
    activityBody: "Filtered recent feed derived from connector access logs.",
    searchTools: "Search tools",
    searchActivity: "Search activity",
    filterGroup: "Group",
    filterAvailability: "Availability",
    filterScope: "Required scope",
    filterOverride: "Override state",
    filterResult: "Result",
    filterAll: "All",
    loadMore: "Load more",
    recentActivity: "Recent activity",
    recentOutcomes: "Recent outcomes",
    revoke: "Revoke",
    reconnect: "Reconnect",
    reconnectBody: "OAuth clients can reconnect to refresh consent or recover missing scopes.",
    reconnectPrompt: "Hosted OAuth clients should reconnect in their source client if account management or posting is missing.",
    connectorRevoked: "Connector revoked.",
    permissionSaved: "Connector permissions saved.",
    toolSaved: "Tool override saved.",
    updateError: "Connector update failed.",
    revokeError: "Connector revoke failed.",
    toolError: "Tool toggle update failed.",
    revokeConfirm: "Revoke {name}?",
    currentConnections: "Operational connections",
    historicalConnections: "History and revoked",
    historyFilters: "History filters",
    searchHistory: "Search by name, client, or connector ID",
    historyStatus: "Status",
    historyAuth: "Auth mode",
    oauthAuthMode: "OAuth",
    bearerAuthMode: "Bearer",
    historyEnded: "Ended",
    endedLast7: "Last 7 days",
    endedLast30: "Last 30 days",
    endedLast90: "Last 90 days",
    removeHistoryItem: "Remove from history",
    removeSelectedHistory: "Remove selected",
    selectedHistoryRows: "{count} selected",
    selectVisibleHistory: "Select visible history rows",
    historyRemoveConfirm: "Remove {name} from your visible connection history? Audit records are retained.",
    historyBulkRemoveConfirm: "Remove {count} visible selected connection(s) from your history? Audit records are retained.",
    historyAuditRetained: "Removed rows disappear from this history view. Audit records are retained.",
    historyLabel: "{count} historical connection(s)",
    noHistory: "No revoked or expired connection history.",
    noMatchingHistory: "No history rows match the current filters.",
    details: "Details",
    connectionDetails: "Connection details",
    statusReason: "Status reason",
    connectorId: "Connector ID",
    permissions: "Permissions",
    backToConnection: "Back to connection",
    viewActivityForConnection: "View all calls in Activity",
    clientKind: "Client",
    vendor: "Vendor",
    authMode: "Auth",
    scopes: "Scopes",
    lastUsed: "Last used",
    expires: "Expires",
    created: "Created",
    docs: "Docs",
    setup: "Setup",
    tier: "Tier",
    connected: "Connected",
    inspect: "Inspect",
    readGroup: "Read",
    researchGroup: "Research",
    accountsGroup: "Accounts",
    draftGroup: "Drafts",
    postingGroup: "Posting",
    draftCreate: "Draft create",
    draftUpdate: "Draft update",
    draftArchive: "Draft archive",
    draftDelete: "Draft delete",
    writeAccess: "Write",
    readAccess: "Read",
    toolOverrides: "Tool overrides",
    scopeLabel: "Scope",
    alternativeScopesLabel: "Alternative scopes",
    alternativeScopesBody: "This tool also authorizes through these additive scopes when the API exposes them.",
    accessLabel: "Access",
    noMatchingTools: "No tools match the current filters.",
    noActivity: "No recent connector activity recorded.",
    hiddenByPolicy: "Blocked by admin MCP policy.",
    bearerScopeLocked: "Bearer token grants are fixed. Create a new bearer connector to add this scope.",
    oauthScopeLocked: "OAuth consent is fixed. Reconnect this connector to add this scope.",
    researchScope: "Research access is additive and limited to Taiwan research workflows.",
    researchScopeLocked: "Research access is additive. Reconnect this OAuth connector or recreate this bearer connector to add it.",
    advancedWriteScope: "Advanced financial write. Keep this scope off unless you want preview, post, update, delete, or dividend mutation tools enabled after explicit confirmation.",
    requiresScope: "Requires {scope}.",
    connectorInactive: "Blocked because the connector is {status}.",
    disabledByOverride: "Disabled by connector override.",
    inheritedDefault: "Inherited default",
    explicitOverride: "Connector override",
    explicitOverrides: "Has overrides",
    inheritedOnly: "Inherited only",
    highestPriorityBlocker: "Highest-priority blocker",
    canUse: "Can use",
    unavailableFor: "Unavailable for",
    recentCalls: "Recent calls",
    viewAllCalls: "View all calls in Activity",
    loadActivityError: "Recent access logs could not be refreshed.",
    createBearer: "Create bearer connector",
    bearerName: "Connector name",
    bearerLifetime: "Lifetime days",
    bearerScopes: "Scopes",
    bearerCreated: "Bearer connector created. Copy this token now; it will not be shown again.",
    bearerCreateError: "Bearer connector could not be created.",
    bearerTokenOneTime: "One-time bearer token",
    bearerUnavailable: "Bearer fallback is disabled for this client by admin policy.",
    bearerSecondary: "Bearer fallback is for developer MCP clients when OAuth is unavailable. Keep tokens scoped, expiring, and revocable.",
    bearerBlockedReasons: "Why creation is unavailable",
    bearerBlockedGlobal: "Bearer fallback is disabled globally.",
    bearerBlockedClientDisabled: "This AI client is disabled in the client-kind allowlist.",
    bearerBlockedClientNotAllowed: "This AI client is not enabled in the bearer fallback allowlist.",
    bearerBlockedNoToolGroups: "No bearer tool groups are enabled for the currently available MCP tool groups.",
    bearerBlockedDuplicate: "An active bearer connector already exists for this client. Revoke it before creating another token.",
    bearerBlockedLimit: "You have reached the active bearer connector limit.",
    bearerRepairLink: "Open admin setting",
    closeToken: "Hide token",
    webSession: "Web session",
  },
  "zh-TW": {
    pageEyebrow: "AI 設定",
    pageTitle: "AI 連接器",
    pageDescription: "以單一 MCP 指揮台集中管理設定、連線狀態、權限、工具存取與最近活動。",
    refresh: "重新整理",
    copyUrl: "複製 MCP URL",
    copySnippet: "複製片段",
    copied: "已複製 MCP URL。",
    policyAlert: "管理員目前停用了所有 MCP 工具群組。在重新啟用至少一個群組前，連接器權限會維持唯讀。",
    loading: "正在載入 AI 連接器指揮台...",
    loadError: "無法載入 AI 連接器設定。",
    emptyConnections: "目前沒有已連接的 AI 連接器。",
    emptyConnectionsBody: "請先使用下方任一客戶端設定卡完成連線，再回到此處檢視狀態與存取。",
    firstRunTitle: "先從客戶端設定卡開始",
    firstRunBody: "MCP 已可使用。先連接 ChatGPT、Claude Code 或 Codex，再回來調整權限並檢視工具存取。",
    firstRunAction: "查看連線設定卡",
    repairTitle: "需要管理員先完成設定，連接器才能使用 MCP 工具",
    repairAdminBody: "請開啟管理員 MCP 設定，修復就緒狀態、客戶端允許清單、Bearer 備援或已停用的工具群組。",
    repairUserBody: "請管理員修復 MCP 就緒狀態，或至少重新啟用一個工具群組後再連接客戶端。",
    openAdminMcpSettings: "開啟管理員 MCP 設定",
    active: "啟用中",
    inactive: "未啟用",
    pending: "待完成",
    expired: "已到期",
    revoked: "已撤銷",
    available: "可用",
    unavailable: "不可用",
    never: "從未",
    sectionOverview: "總覽",
    sectionConnect: "連線設定",
    sectionConnections: "連線清單",
    sectionHistory: "歷史",
    sectionPermissions: "權限",
    sectionToolCatalog: "工具目錄",
    sectionActivity: "活動",
    overviewTitle: "指揮台",
    overviewBody: "檢視共享 MCP 就緒狀態、複製端點，並確認目前有哪些客戶端可直接使用。",
    endpoint: "MCP 端點",
    readiness: "就緒狀態",
    activeClients: "可用客戶端",
    bearerFallback: "Bearer 備援",
    highRisk: "高風險工具",
    oauthReady: "OAuth 就緒",
    tokenSecretReady: "權杖密鑰已設定",
    postingOn: "允許送出",
    postingOff: "送出關閉",
    connectTitle: "連線客戶端",
    connectBody: "Tier 1 客戶端是主要支援路徑；Tier 2 客戶端共用相同 MCP 端點，但設定指引較精簡。",
    connectionsTitle: "連線",
    connectionsBody: "依客戶端分組檢視連線狀態、到期資訊與快速修復操作。",
    permissionsTitle: "權限",
    permissionsBody: "每個客戶端的控制都只會縮減 OAuth／分享 scope 與個別 MCP 工具。工具覆寫不會超出既有 scope 或管理策略。",
    permissionsMatrixHint: "桌面版維持緊湊的客戶端風險群組矩陣，進階財務寫入 scope 與工具覆寫則收在每列之下。",
    mobilePermissionsHint: "手機版以每個客戶端的展開區塊呈現，避免擠壓矩陣。",
    emptyPermissions: "目前沒有可檢視的連接器權限。",
    emptyPermissionsBody: "請先連接客戶端。建立連接器後，權限控制會顯示在這裡。",
    toolCatalogTitle: "獨立 MCP 工具目錄",
    toolCatalogBody: "共享工具只顯示一次，再往下檢視有效可用性與被阻擋的客戶端。",
    emptyToolCatalog: "目前沒有已註冊的 MCP 工具。",
    emptyToolCatalogBody: "MCP 伺服器可連線，但在目前策略狀態下沒有回傳工具目錄。",
    toolDetailTitle: "工具詳情",
    toolDetailEmpty: "請選擇工具以檢視可用性、所需 scope 與受影響客戶端。",
    schemaSummary: "Schema 摘要",
    rawSchema: "原始 schema",
    requiredField: "必填",
    optionalField: "選填",
    riskAnnotations: "風險註記",
    activityTitle: "最近活動",
    activityBody: "以連接器存取紀錄為基礎的近期活動篩選檢視。",
    searchTools: "搜尋工具",
    searchActivity: "搜尋活動",
    filterGroup: "群組",
    filterAvailability: "可用狀態",
    filterScope: "所需 scope",
    filterOverride: "覆寫狀態",
    filterResult: "結果",
    filterAll: "全部",
    loadMore: "載入更多",
    recentActivity: "最近活動",
    recentOutcomes: "最近結果",
    revoke: "撤銷",
    reconnect: "重新連線",
    reconnectBody: "OAuth 客戶端可重新連線以更新同意授權或補齊缺少的 scope。",
    reconnectPrompt: "若帳戶管理或送出權限缺失，OAuth 客戶端應回到原始客戶端重新同意。",
    connectorRevoked: "已撤銷連接器。",
    permissionSaved: "已儲存連接器權限。",
    toolSaved: "已儲存工具覆寫。",
    updateError: "連接器更新失敗。",
    revokeError: "撤銷連接器失敗。",
    toolError: "工具覆寫更新失敗。",
    revokeConfirm: "要撤銷 {name} 嗎？",
    currentConnections: "操作中的連線",
    historicalConnections: "歷史與已撤銷",
    historyFilters: "歷史篩選",
    searchHistory: "依名稱、客戶端或連接器 ID 搜尋",
    historyStatus: "狀態",
    historyAuth: "驗證模式",
    oauthAuthMode: "OAuth",
    bearerAuthMode: "Bearer",
    historyEnded: "結束時間",
    endedLast7: "最近 7 天",
    endedLast30: "最近 30 天",
    endedLast90: "最近 90 天",
    removeHistoryItem: "從歷史移除",
    removeSelectedHistory: "移除已選取",
    selectedHistoryRows: "已選取 {count} 筆",
    selectVisibleHistory: "選取目前顯示的歷史列",
    historyRemoveConfirm: "要從可見連線歷史移除 {name} 嗎？稽核紀錄會保留。",
    historyBulkRemoveConfirm: "要從歷史移除目前顯示且已選取的 {count} 筆連線嗎？稽核紀錄會保留。",
    historyAuditRetained: "移除後會從此歷史檢視消失；稽核紀錄仍會保留。",
    historyLabel: "{count} 個歷史連線",
    noHistory: "目前沒有已撤銷或已到期的連線歷史。",
    noMatchingHistory: "目前篩選條件沒有符合的歷史列。",
    details: "詳情",
    connectionDetails: "連線詳情",
    statusReason: "狀態原因",
    connectorId: "連接器 ID",
    permissions: "權限",
    backToConnection: "回到連線",
    viewActivityForConnection: "在活動中檢視所有呼叫",
    clientKind: "客戶端",
    vendor: "供應商",
    authMode: "驗證",
    scopes: "Scopes",
    lastUsed: "上次使用",
    expires: "到期時間",
    created: "建立時間",
    docs: "文件",
    setup: "設定",
    tier: "Tier",
    connected: "已連線",
    inspect: "檢視",
    readGroup: "讀取",
    researchGroup: "研究",
    accountsGroup: "帳戶",
    draftGroup: "草稿",
    postingGroup: "送出",
    draftCreate: "建立草稿",
    draftUpdate: "更新草稿",
    draftArchive: "封存草稿",
    draftDelete: "刪除草稿",
    writeAccess: "寫入",
    readAccess: "讀取",
    toolOverrides: "工具覆寫",
    scopeLabel: "權限範圍",
    alternativeScopesLabel: "替代 scope",
    alternativeScopesBody: "當 API 有明確提供時，這個工具也可透過以下加值 scope 授權。",
    accessLabel: "存取類型",
    noMatchingTools: "目前篩選條件沒有符合的工具。",
    noActivity: "最近沒有連接器活動。",
    hiddenByPolicy: "已被管理員 MCP 策略封鎖。",
    bearerScopeLocked: "Bearer 權杖授權範圍建立後即固定。若要新增此 scope，請建立新的 Bearer 連接器。",
    oauthScopeLocked: "OAuth 同意授權建立後即固定。若要新增此 scope，請重新連線此連接器。",
    researchScope: "研究權限屬於加值授權，且只適用於台股研究流程。",
    researchScopeLocked: "研究權限屬於加值授權。若要加入此權限，請重新連線 OAuth 連接器，或重新建立 Bearer 連接器。",
    advancedWriteScope: "進階財務寫入。除非你希望在明確確認後啟用預覽、送出、更新、刪除或股利異動工具，否則請保持關閉。",
    requiresScope: "需要 {scope}。",
    connectorInactive: "因連接器狀態為 {status} 而被封鎖。",
    disabledByOverride: "已被連接器覆寫停用。",
    inheritedDefault: "沿用預設",
    explicitOverride: "連接器覆寫",
    explicitOverrides: "有覆寫",
    inheritedOnly: "僅沿用",
    highestPriorityBlocker: "最高優先阻擋原因",
    canUse: "可使用",
    unavailableFor: "以下客戶端不可用",
    recentCalls: "最近呼叫",
    viewAllCalls: "在活動中檢視所有呼叫",
    loadActivityError: "無法重新整理最近存取紀錄。",
    createBearer: "建立 Bearer 連接器",
    bearerName: "連接器名稱",
    bearerLifetime: "有效天數",
    bearerScopes: "Scopes",
    bearerCreated: "已建立 Bearer 連接器。請立即複製此權杖，之後不會再次顯示。",
    bearerCreateError: "無法建立 Bearer 連接器。",
    bearerTokenOneTime: "一次性 Bearer 權杖",
    bearerUnavailable: "管理員策略未允許此客戶端使用 Bearer 備援。",
    bearerSecondary: "Bearer 備援僅供 OAuth 不可用時的開發者 MCP 客戶端使用。請維持最小權限、到期與可撤銷。",
    bearerBlockedReasons: "無法建立的原因",
    bearerBlockedGlobal: "全域 Bearer 備援已停用。",
    bearerBlockedClientDisabled: "此 AI 客戶端已在客戶端允許清單中停用。",
    bearerBlockedClientNotAllowed: "此 AI 客戶端尚未在 Bearer 備援允許清單中啟用。",
    bearerBlockedNoToolGroups: "目前可用的 MCP 工具群組沒有任何 Bearer 工具群組可用。",
    bearerBlockedDuplicate: "此客戶端已有啟用中的 Bearer 連接器。請先撤銷後再建立新的權杖。",
    bearerBlockedLimit: "已達啟用中 Bearer 連接器數量上限。",
    bearerRepairLink: "開啟管理員設定",
    closeToken: "隱藏權杖",
    webSession: "Web 工作階段",
  },
};

const BASE_GROUPED_SCOPES: Array<{ key: Exclude<ScopeGroupKey, "research">; scopes: ExtendedAiConnectorScope[] }> = [
  { key: "read", scopes: ["portfolio:mcp_read"] },
  { key: "accounts", scopes: ["account:manage"] },
  { key: "drafts", scopes: ["transaction_draft:create", "transaction_draft:edit", "transaction_draft:archive", "transaction_draft:delete"] },
  { key: "posting", scopes: ["transaction:write", "dividend:write"] },
];

const RESEARCH_SCOPE = "research:read" as ExtendedAiConnectorScope;

function groupTogglesRecord(policy: AiConnectorSummaryResponse["policy"]): Record<string, boolean> {
  return policy.groupToggles as Record<string, boolean>;
}

function bearerAllowedToolGroups(policy: AiConnectorSummaryResponse["policy"]): ExtendedAiConnectorToolGroup[] {
  return policy.bearerFallback.allowedToolGroups as ExtendedAiConnectorToolGroup[];
}

function toolGroupValue(tool: AiConnectorToolCatalogEntryDto): ExtendedAiConnectorToolGroup {
  return tool.group as ExtendedAiConnectorToolGroup;
}

function toolScopeValue(tool: AiConnectorToolCatalogEntryDto): ExtendedAiConnectorScope {
  return tool.scope as ExtendedAiConnectorScope;
}

function toolScopeValues(tool: AiConnectorToolCatalogEntryDto): ExtendedAiConnectorScope[] {
  return [toolScopeValue(tool), ...(tool.alternativeScopes ?? []) as ExtendedAiConnectorScope[]];
}

function groupForScope(scope: ExtendedAiConnectorScope): ExtendedAiConnectorToolGroup {
  if (scope === "portfolio:mcp_read") return "read";
  if (scope === RESEARCH_SCOPE) return "research";
  if (isDraftScope(scope)) return "drafts";
  return "write";
}

function toolGroupValues(tool: AiConnectorToolCatalogEntryDto): ExtendedAiConnectorToolGroup[] {
  return [...new Set([toolGroupValue(tool), ...toolScopeValues(tool).map(groupForScope)])];
}

function isResearchScope(scope: string): scope is ExtendedAiConnectorScope {
  return scope === RESEARCH_SCOPE;
}

function isDraftScope(scope: ExtendedAiConnectorScope): boolean {
  return scope === "transaction_draft:create"
    || scope === "transaction_draft:edit"
    || scope === "transaction_draft:archive"
    || scope === "transaction_draft:delete";
}

function supportsResearchScopeFromState(input: {
  connections: AiConnectorConnectionDto[];
  policy: AiConnectorSummaryResponse["policy"] | null;
  toolCatalog?: AiConnectorToolCatalogEntryDto[];
}): boolean {
  if (input.policy && groupTogglesRecord(input.policy).research === true) return true;
  if (input.policy && bearerAllowedToolGroups(input.policy).includes("research")) return true;
  if (input.connections.some((connection) => connection.scopes.includes(RESEARCH_SCOPE as AiConnectorScope))) return true;
  return (input.toolCatalog ?? []).some((tool) =>
    toolScopeValues(tool).includes(RESEARCH_SCOPE) || toolGroupValues(tool).includes("research"));
}

function groupedScopes(summary: AiConnectorSummaryResponse | null): Array<{ key: ScopeGroupKey; scopes: ExtendedAiConnectorScope[] }> {
  const groups: Array<{ key: ScopeGroupKey; scopes: ExtendedAiConnectorScope[] }> = [...BASE_GROUPED_SCOPES];
  if (summary && supportsResearchScopeFromState(summary)) {
    groups.splice(1, 0, { key: "research", scopes: [RESEARCH_SCOPE] });
  }
  return groups;
}

function isAdvancedFinancialWriteScope(scope: AiConnectorScope): boolean {
  return scope === "transaction:write" || scope === "dividend:write";
}

const SECTION_ORDER: SectionId[] = ["overview", "connect", "connections", "history", "permissions", "tool-catalog", "activity"];
const CLIENT_REGISTRY: CompatibleAiClientKind[] = [
  "chatgpt_app",
  "claude_ai_connector",
  "claude_code",
  "codex_cli",
  "gemini_cli",
  "copilot_mcp",
  "generic_mcp",
];

function formatMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
}

function formatTime(value: string | null, copy: LocalizedCopy): string {
  return value ? new Date(value).toLocaleString(copy === COPY["zh-TW"] ? "zh-TW" : "en-US") : copy.never;
}

function statusClassName(status: AiConnectorStatus): string {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "pending") return "border-sky-200 bg-sky-50 text-sky-700";
  if (status === "expired") return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

function scopeGroupLabel(copy: LocalizedCopy, key: ScopeGroupKey): string {
  if (key === "read") return copy.readGroup;
  if (key === "research") return copy.researchGroup;
  if (key === "accounts") return copy.accountsGroup;
  if (key === "drafts") return copy.draftGroup;
  return copy.postingGroup;
}

function accessKindLabel(copy: LocalizedCopy, kind: AiConnectorAccessKind): string {
  if (kind === "draft_create") return copy.draftCreate;
  if (kind === "draft_update") return copy.draftUpdate;
  if (kind === "draft_archive") return copy.draftArchive;
  if (kind === "draft_delete") return copy.draftDelete;
  if (kind === "write") return copy.writeAccess;
  return copy.readAccess;
}

function readinessStatusLabel(copy: LocalizedCopy, status: AiConnectorSummaryResponse["policy"]["readiness"]["status"] | undefined): string {
  if (status === "ready") return copy.available;
  if (status === "degraded") return copy.reconnect;
  if (status === "disabled") return copy.inactive;
  return copy.loading;
}

function readinessCheckLabel(copy: LocalizedCopy, locale: "en" | "zh-TW", key: AiConnectorReadinessCheckKey): string {
  if (key === "deployment") return copy.readiness;
  if (key === "public_issuer") return locale === "zh-TW" ? "公開發行者" : "Public issuer";
  if (key === "oauth_token_secret") return copy.tokenSecretReady;
  if (key === "mcp_url") return copy.endpoint;
  if (key === "client_kind_policy") return copy.clientKind;
  if (key === "high_risk_tools") return copy.highRisk;
  return copy.bearerFallback;
}

function vendorLabel(connection: AiConnectorConnectionDto): string {
  return getAiClientMetadataFromConnection(connection).vendor ?? connection.vendor;
}

function clientKindLabel(connection: AiConnectorConnectionDto): string {
  return getAiClientMetadataFromConnection(connection).label ?? connection.clientKind;
}

function authModeLabel(connection: AiConnectorConnectionDto): string {
  if (connection.authMode === "oauth") return "OAuth";
  if (connection.authMode === "bearer") return "Bearer";
  return "Dev token";
}

function matchesHistorySearch(connection: AiConnectorConnectionDto, search: string): boolean {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  const metadata = getAiClientMetadataFromConnection(connection);
  return [
    connection.displayName,
    connection.id,
    connection.clientKind,
    metadata.label,
    metadata.vendor,
    connection.vendor,
  ].some((value) => value.toLowerCase().includes(query));
}

function matchesHistoryEndedFilter(connection: AiConnectorConnectionDto, filter: HistoryEndedFilter): boolean {
  if (filter === "all") return true;
  const endedAt = connection.revokedAt ?? connection.expiresAt ?? connection.updatedAt;
  const endedMs = new Date(endedAt).getTime();
  if (!Number.isFinite(endedMs)) return false;
  const days = filter === "7d" ? 7 : filter === "30d" ? 30 : 90;
  return Date.now() - endedMs <= days * 24 * 60 * 60 * 1000;
}

function sortConnections(connections: AiConnectorConnectionDto[]): AiConnectorConnectionDto[] {
  const rank = (connection: AiConnectorConnectionDto): number => {
    if (connection.clientKind === "chatgpt_app" && connection.status === "active") return 0;
    if (connection.vendor === "anthropic" && connection.authMode === "oauth" && connection.status === "active") return 0;
    if (connection.status === "active") return 1;
    if (connection.status === "pending") return 2;
    if (connection.status === "expired") return 3;
    return 4;
  };
  return [...connections].sort((left, right) => {
    const rankDiff = rank(left) - rank(right);
    if (rankDiff !== 0) return rankDiff;
    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function effectiveAccessForConnection(tool: AiConnectorToolCatalogEntryDto, connectionId: string) {
  return tool.effectiveAccess.find((access) => access.connectionId === connectionId) ?? null;
}

function toolToggleChecked(connection: AiConnectorConnectionDto, tool: AiConnectorToolCatalogEntryDto): boolean {
  return effectiveAccessForConnection(tool, connection.id)?.status === "available"
    && connection.toolToggles[tool.name] !== false;
}

function isGroupEnabled(policy: AiConnectorSummaryResponse["policy"], scope: ExtendedAiConnectorScope): boolean {
  if (scope === "portfolio:mcp_read") return policy.groupToggles.read;
  if (isResearchScope(scope)) return groupTogglesRecord(policy).research === true;
  if (isDraftScope(scope)) return policy.groupToggles.drafts;
  return policy.groupToggles.write;
}

function bearerToolGroupForScope(scope: ExtendedAiConnectorScope): ExtendedAiConnectorToolGroup {
  if (scope === "portfolio:mcp_read") return "read";
  if (isResearchScope(scope)) return "research";
  if (isDraftScope(scope)) return "drafts";
  return "write";
}

function isBearerScopeAllowed(policy: AiConnectorSummaryResponse["policy"], scope: ExtendedAiConnectorScope): boolean {
  return isGroupEnabled(policy, scope)
    && bearerAllowedToolGroups(policy).includes(bearerToolGroupForScope(scope));
}

function getBearerAllowedScopes(policy: AiConnectorSummaryResponse["policy"] | null, summary: AiConnectorSummaryResponse | null): ExtendedAiConnectorScope[] {
  if (!policy) return [];
  return groupedScopes(summary)
    .flatMap((group) => group.scopes)
    .filter((scope) => isBearerScopeAllowed(policy, scope));
}

function allVisibleToolGroupsDisabled(summary: AiConnectorSummaryResponse | null): boolean {
  if (!summary) return false;
  return groupedScopes(summary).every((group) => group.scopes.every((scope) => !isGroupEnabled(summary.policy, scope)));
}

function toolBlockerLabel(
  copy: LocalizedCopy,
  code: AiConnectorToolBlockerCode | null,
  connection: AiConnectorConnectionDto,
  tool: AiConnectorToolCatalogEntryDto,
  locale: "en" | "zh-TW",
): string | null {
  if (code === null) return null;
  if (code === "global_mcp_disabled" || code === "client_kind_disabled") return copy.hiddenByPolicy;
  if (code === "connector_inactive") return formatMessage(copy.connectorInactive, { status: connection.status });
  if (code === "missing_scope") return formatMessage(copy.requiresScope, { scope: getAiConnectorScopeLabel(locale, toolScopeValue(tool)) });
  if (code === "admin_tool_policy_disabled") return tool.unavailableReason ?? copy.hiddenByPolicy;
  if (code === "connector_override_disabled") return copy.disabledByOverride;
  if (code === "delegated_share_capability_blocked") return copy.hiddenByPolicy;
  return null;
}

function toolAccessBlocker(
  copy: LocalizedCopy,
  connection: AiConnectorConnectionDto,
  tool: AiConnectorToolCatalogEntryDto,
  locale: "en" | "zh-TW",
): string | null {
  const access = effectiveAccessForConnection(tool, connection.id);
  if (!access) return copy.hiddenByPolicy;
  return toolBlockerLabel(copy, access?.blockerCode ?? null, connection, tool, locale);
}

function endpointFromSummary(summary: AiConnectorSummaryResponse | null): string {
  return summary?.policy.readiness.endpoint ?? "/mcp";
}

function setupSnippetForClient(clientKind: CompatibleAiClientKind, endpoint: string): string {
  if (clientKind === "chatgpt_app") {
    return [
      "MCP URL",
      endpoint,
      "",
      "Auth",
      "Complete OAuth in ChatGPT / OpenAI Apps.",
    ].join("\n");
  }
  if (clientKind === "claude_ai_connector") {
    return [
      "MCP URL",
      endpoint,
      "",
      "Auth",
      "Complete OAuth in Claude.ai.",
    ].join("\n");
  }
  if (clientKind === "claude_code") {
    return `claude mcp add --transport http vakwen ${endpoint} --header "Authorization: Bearer <one-time-vakwen-token>"`;
  }
  if (clientKind === "codex_cli") {
    return [
      "[mcp_servers.vakwen]",
      `url = "${endpoint}"`,
      "",
      "[mcp_servers.vakwen.headers]",
      "Authorization = \"Bearer <one-time-vakwen-token>\"",
    ].join("\n");
  }
  if (clientKind === "gemini_cli") {
    return [
      "{",
      "  \"mcpServers\": {",
      "    \"vakwen\": {",
      "      \"httpUrl\": \"" + endpoint + "\",",
      "      \"headers\": {",
      "        \"Authorization\": \"Bearer <one-time-vakwen-token>\"",
      "      }",
      "    }",
      "  }",
      "}",
    ].join("\n");
  }
  if (clientKind === "copilot_mcp") {
    return [
      "{",
      "  \"servers\": {",
      "    \"vakwen\": {",
      "      \"type\": \"http\",",
      "      \"url\": \"" + endpoint + "\",",
      "      \"headers\": {",
      "        \"Authorization\": \"Bearer ${input:vakwen-mcp-token}\"",
      "      }",
      "    }",
      "  },",
      "  \"inputs\": [",
      "    {",
      "      \"id\": \"vakwen-mcp-token\",",
      "      \"type\": \"promptString\",",
      "      \"description\": \"Vakwen MCP bearer token\",",
      "      \"password\": true",
      "    }",
      "  ]",
      "}",
    ].join("\n");
  }
  return [
    "{",
    "  \"mcpServers\": {",
    "    \"vakwen\": {",
    "      \"url\": \"" + endpoint + "\",",
    "      \"headers\": {",
    "        \"Authorization\": \"Bearer <one-time-vakwen-token>\"",
    "      }",
    "    }",
    "  }",
    "}",
  ].join("\n");
}

function recentLogsForTool(accessLogs: AiConnectorAccessLogDto[], toolName: string, limit = 5): AiConnectorAccessLogDto[] {
  return accessLogs
    .filter((log) => log.toolName === toolName)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, limit);
}

function accessLogContextLabel(copy: LocalizedCopy, log: AiConnectorAccessLogDto): string {
  return `${log.connectionDisplayName ?? copy.webSession} · ${log.clientKind ?? "web"}`;
}

function accessLogDetailLabel(copy: LocalizedCopy, log: AiConnectorAccessLogDto): string {
  return `${accessKindLabel(copy, log.accessKind)} · ${formatTime(log.createdAt, copy)} · ${log.portfolioContextUserId ? `user:${log.portfolioContextUserId}` : "global"}`;
}

function isBearerClientKind(clientKind: AiConnectorClientKind): clientKind is Exclude<AiConnectorClientKind, "chatgpt_app"> {
  return clientKind !== "chatgpt_app";
}

function toolHasExplicitOverride(connections: AiConnectorConnectionDto[], toolName: string): boolean {
  return connections.some((connection) =>
    (connection.status === "active" || connection.status === "pending")
    && Object.prototype.hasOwnProperty.call(connection.toolToggles, toolName));
}

function ConnectorRecoveryCard({
  copy,
  isAdmin,
  needsAdminSetup,
  onOpenConnect,
}: {
  copy: LocalizedCopy;
  isAdmin: boolean;
  needsAdminSetup: boolean;
  onOpenConnect: () => void;
}) {
  if (needsAdminSetup) {
    return (
      <Card className="rounded-2xl border-amber-200 bg-amber-50" data-testid="ai-connectors-repair-state">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-amber-950">{copy.repairTitle}</p>
            <p className="mt-1 text-sm text-amber-900">{isAdmin ? copy.repairAdminBody : copy.repairUserBody}</p>
          </div>
          {isAdmin ? (
            <Button variant="outline" size="sm" asChild>
              <a href="/admin/settings?tab=mcp" data-testid="ai-connectors-admin-repair-link">
                <Wrench className="h-4 w-4" aria-hidden="true" />
                {copy.openAdminMcpSettings}
              </a>
            </Button>
          ) : null}
        </div>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl border-dashed" data-testid="ai-connectors-first-run-state">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{copy.firstRunTitle}</p>
          <p className="mt-1 text-sm text-muted-foreground">{copy.firstRunBody}</p>
        </div>
        <Button variant="outline" size="sm" onClick={onOpenConnect}>
          <Cable className="h-4 w-4" aria-hidden="true" />
          {copy.firstRunAction}
        </Button>
      </div>
    </Card>
  );
}

export function AiConnectorsSettingsClient() {
  const shellData = useOptionalAppShellData();
  const locale = shellData?.locale === "zh-TW" ? "zh-TW" : "en";
  const copy = COPY[locale];
  const [summary, setSummary] = useState<AiConnectorSummaryResponse | null>(null);
  const [historyConnections, setHistoryConnections] = useState<AiConnectorConnectionDto[]>([]);
  const [accessLogs, setAccessLogs] = useState<AiConnectorAccessLogDto[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingLogs, setIsLoadingLogs] = useState(false);
  const [section, setSection] = useState<SectionId>("overview");
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [toolDetailSheetOpen, setToolDetailSheetOpen] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [toolSearch, setToolSearch] = useState("");
  const [toolGroupFilter, setToolGroupFilter] = useState<ToolGroupFilter>("all");
  const [toolAvailabilityFilter, setToolAvailabilityFilter] = useState<ToolAvailabilityFilter>("all");
  const [toolScopeFilter, setToolScopeFilter] = useState<ToolScopeFilter>("all");
  const [toolOverrideFilter, setToolOverrideFilter] = useState<ToolOverrideFilter>("all");
  const [activitySearch, setActivitySearch] = useState("");
  const [activityResultFilter, setActivityResultFilter] = useState<ActivityResultFilter>("all");
  const [activityConnectionId, setActivityConnectionId] = useState<string | null>(null);
  const [activityNextOffset, setActivityNextOffset] = useState<number | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [historySearch, setHistorySearch] = useState("");
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | AiConnectorStatus>("all");
  const [historyClientFilter, setHistoryClientFilter] = useState<"all" | CompatibleAiClientKind>("all");
  const [historyAuthFilter, setHistoryAuthFilter] = useState<HistoryAuthFilter>("all");
  const [historyEndedFilter, setHistoryEndedFilter] = useState<HistoryEndedFilter>("all");
  const [selectedHistoryIds, setSelectedHistoryIds] = useState<string[]>([]);
  const [hiddenHistoryIds, setHiddenHistoryIds] = useState<string[]>([]);
  const [selectedConnectionIdForDetails, setSelectedConnectionIdForDetails] = useState<string | null>(null);
  const [connectionDetailSheetOpen, setConnectionDetailSheetOpen] = useState(false);
  const [connectionDetailLogs, setConnectionDetailLogs] = useState<AiConnectorAccessLogDto[]>([]);
  const [isLoadingConnectionDetailLogs, setIsLoadingConnectionDetailLogs] = useState(false);
  const [bearerDraft, setBearerDraft] = useState<{
    clientKind: BearerClientKind | null;
    displayName: string;
    lifetimeDays: number;
    scopes: AiConnectorScope[];
  }>({
    clientKind: null,
    displayName: "",
    lifetimeDays: 30,
    scopes: ["portfolio:mcp_read"],
  });
  const [oneTimeBearerToken, setOneTimeBearerToken] = useState<{
    clientKind: BearerClientKind;
    connectionId: string;
    token: string;
    hint: string;
    expiresAt: string;
  } | null>(null);

  async function load() {
    setIsLoading(true);
    setIsLoadingLogs(true);
    setError("");
    try {
      const [nextSummary, history, logs] = await Promise.all([
        fetchAiConnectorSummary(),
        fetchAiConnectorHistory(),
        fetchAiConnectorLogs({
          limit: 12,
          result: activityResultFilter === "all" ? undefined : activityResultFilter,
          search: activitySearch,
          connectionId: activityConnectionId ?? undefined,
        }).catch(() => {
          throw new Error(copy.loadActivityError);
        }),
      ]);
      setSummary(nextSummary);
      setHistoryConnections(history.connections);
      setAccessLogs(logs.accessLogs);
      setActivityNextOffset(logs.nextOffset);
      setActivityHasMore(logs.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadError);
      setHistoryConnections([]);
      setAccessLogs([]);
      setActivityNextOffset(null);
      setActivityHasMore(false);
    } finally {
      setIsLoading(false);
      setIsLoadingLogs(false);
    }
  }

  async function loadActivityPage(mode: "replace" | "append" = "replace") {
    setIsLoadingLogs(true);
    setError("");
    try {
      const logs = await fetchAiConnectorLogs({
        limit: 12,
        offset: mode === "append" ? activityNextOffset ?? 0 : 0,
        result: activityResultFilter === "all" ? undefined : activityResultFilter,
        search: activitySearch,
        connectionId: activityConnectionId ?? undefined,
      });
      setAccessLogs((current) => mode === "append" ? [...current, ...logs.accessLogs] : logs.accessLogs);
      setActivityNextOffset(logs.nextOffset);
      setActivityHasMore(logs.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.loadActivityError);
    } finally {
      setIsLoadingLogs(false);
    }
  }

  useEffect(() => {
    void load();
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const nextSection = params.get("section");
    const nextTool = params.get("tool");
    const nextClient = params.get("client");
    const nextConnectionId = params.get("connectionId");
    const nextActivitySearch = params.get("activitySearch");
    if (SECTION_ORDER.includes(nextSection as SectionId)) setSection(nextSection as SectionId);
    if (nextTool) setSelectedToolName(nextTool);
    if (nextClient) setSelectedClientId(nextClient);
    if (nextConnectionId) setActivityConnectionId(nextConnectionId);
    if (nextActivitySearch) setActivitySearch(nextActivitySearch);
  }, []);

  useEffect(() => {
    void loadActivityPage("replace");
  }, [activityConnectionId, activityResultFilter, activitySearch]);

  useEffect(() => {
    updateQuery({
      activitySearch: activitySearch.trim() || null,
      connectionId: activityConnectionId,
    });
  }, [activityConnectionId, activitySearch]);

  useEffect(() => {
    const tools = summary?.toolCatalog ?? [];
    if (!selectedToolName && tools[0]) setSelectedToolName(tools[0].name);
    const connections = summary?.connections ?? [];
    if (!selectedClientId && connections[0]) setSelectedClientId(connections[0].id);
  }, [selectedClientId, selectedToolName, summary]);

  function updateQuery(next: Partial<{
    section: SectionId;
    tool: string | null;
    client: string | null;
    activitySearch: string | null;
    connectionId: string | null;
  }>) {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (next.section) params.set("section", next.section);
    if (next.tool === null) params.delete("tool");
    else if (next.tool) params.set("tool", next.tool);
    if (next.client === null) params.delete("client");
    else if (next.client) params.set("client", next.client);
    if (next.activitySearch === null) params.delete("activitySearch");
    else if (next.activitySearch) params.set("activitySearch", next.activitySearch);
    if (next.connectionId === null) params.delete("connectionId");
    else if (next.connectionId) params.set("connectionId", next.connectionId);
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
  }

  function selectToolForInspection(toolName: string) {
    setSelectedToolName(toolName);
    updateQuery({ section: "tool-catalog", tool: toolName });
    if (typeof window !== "undefined" && window.matchMedia?.("(max-width: 1279px)").matches) {
      setToolDetailSheetOpen(true);
    }
  }

  const connections = useMemo(() => sortConnections(summary?.connections ?? []), [summary?.connections]);
  const activeConnections = connections.filter((connection) => connection.status === "active");
  const activeBearerConnections = activeConnections.filter((connection) => connection.authMode === "bearer");
  const currentConnections = connections.filter((connection) =>
    connection.status === "active"
    || connection.status === "pending"
    || (connection.status === "expired" && connection.authMode === "oauth"));
  const visibleHistoryCount = useMemo(() => historyConnections.filter((connection) =>
    (connection.status === "expired" || connection.status === "revoked") && !hiddenHistoryIds.includes(connection.id)).length, [
    hiddenHistoryIds,
    historyConnections,
  ]);
  const historicalConnections = useMemo(() => sortConnections(historyConnections)
    .filter((connection) => (connection.status === "expired" || connection.status === "revoked") && !hiddenHistoryIds.includes(connection.id))
    .filter((connection) => matchesHistorySearch(connection, historySearch))
    .filter((connection) => historyStatusFilter === "all" ? true : connection.status === historyStatusFilter)
    .filter((connection) => historyClientFilter === "all"
      ? true
      : (getAiClientMetadataFromConnection(connection).clientKind === historyClientFilter))
    .filter((connection) => historyAuthFilter === "all" ? true : connection.authMode === historyAuthFilter)
    .filter((connection) => matchesHistoryEndedFilter(connection, historyEndedFilter)), [
    hiddenHistoryIds,
    historyAuthFilter,
    historyClientFilter,
    historyConnections,
    historyEndedFilter,
    historySearch,
    historyStatusFilter,
  ]);
  const selectedHistoryConnections = historicalConnections.filter((connection) => selectedHistoryIds.includes(connection.id));
  const selectedConnectionForDetails = selectedConnectionIdForDetails
    ? [...connections, ...historyConnections].find((connection) => connection.id === selectedConnectionIdForDetails) ?? null
    : null;

  useEffect(() => {
    setSelectedHistoryIds((current) => current.filter((id) => historicalConnections.some((connection) => connection.id === id)));
  }, [historicalConnections]);
  const allScopeGroupsDisabled = allVisibleToolGroupsDisabled(summary);
  const isAdmin = shellData?.sessionUserRole === "admin";
  const noConnectorHistory = !isLoading && summary !== null && connections.length === 0 && historyConnections.length === 0;
  const needsAdminSetup = summary !== null && (summary.policy.readiness.status !== "ready" || allScopeGroupsDisabled);
  const showRecoveryState = noConnectorHistory || needsAdminSetup;
  const filteredTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase();
    return (summary?.toolCatalog ?? []).filter((tool) => {
      if (toolGroupFilter !== "all" && !toolGroupValues(tool).includes(toolGroupFilter)) return false;
      if (toolAvailabilityFilter !== "all" && tool.availability !== toolAvailabilityFilter) return false;
      if (toolScopeFilter !== "all" && !toolScopeValues(tool).includes(toolScopeFilter)) return false;
      const hasExplicitOverride = toolHasExplicitOverride(connections, tool.name);
      if (toolOverrideFilter === "explicit" && !hasExplicitOverride) return false;
      if (toolOverrideFilter === "inherited" && hasExplicitOverride) return false;
      if (!query) return true;
      return tool.name.toLowerCase().includes(query)
        || tool.description.toLowerCase().includes(query)
        || toolScopeValues(tool).some((scope) => getAiConnectorScopeLabel(locale, scope).toLowerCase().includes(query));
    });
  }, [connections, locale, summary?.toolCatalog, toolAvailabilityFilter, toolGroupFilter, toolOverrideFilter, toolScopeFilter, toolSearch]);
  const selectedTool = filteredTools.find((tool) => tool.name === selectedToolName)
    ?? (summary?.toolCatalog ?? []).find((tool) => tool.name === selectedToolName)
    ?? filteredTools[0]
    ?? null;
  const toolCatalogIsEmpty = !isLoading && summary !== null && (summary.toolCatalog?.length ?? 0) === 0;
  const filteredActivity = accessLogs;

  async function copyEndpoint() {
    try {
      await navigator.clipboard.writeText(endpointFromSummary(summary));
      setMessage(copy.copied);
      setError("");
    } catch {
      setError(copy.loadError);
    }
  }

  async function copySetupSnippet(clientKind: CompatibleAiClientKind) {
    try {
      await navigator.clipboard.writeText(setupSnippetForClient(clientKind, endpointFromSummary(summary)));
      setMessage(copy.copied);
      setError("");
    } catch {
      setError(copy.loadError);
    }
  }

  async function toggleScope(connection: AiConnectorConnectionDto, scope: AiConnectorScope, checked: boolean) {
    if ((connection.authMode === "bearer" || connection.authMode === "oauth") && checked && !connection.scopes.includes(scope)) {
      return;
    }
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const nextScopes = checked
        ? [...new Set([...connection.scopes, scope])]
        : connection.scopes.filter((item) => item !== scope);
      await updateAiConnector(connection.id, { scopes: nextScopes });
      await load();
      setMessage(copy.permissionSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.updateError);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleTool(connection: AiConnectorConnectionDto, toolName: string, checked: boolean) {
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      await updateAiConnector(connection.id, {
        toolToggles: { ...connection.toolToggles, [toolName]: checked },
      });
      await load();
      setMessage(copy.toolSaved);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.toolError);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(connection: AiConnectorConnectionDto) {
    if (!window.confirm(formatMessage(copy.revokeConfirm, { name: connection.displayName }))) return;
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      const updated = await revokeAiConnector(connection.id);
      setSummary((current) => current ? {
        ...current,
        connections: current.connections.filter((item) => item.id !== updated.id),
      } : current);
      setHistoryConnections((current) => sortConnections([...current.filter((item) => item.id !== updated.id), updated]));
      setMessage(copy.connectorRevoked);
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.revokeError);
    } finally {
      setBusyId(null);
    }
  }

  async function hideHistoryConnection(connection: AiConnectorConnectionDto) {
    if (!window.confirm(formatMessage(copy.historyRemoveConfirm, { name: connection.displayName }))) return;
    setBusyId(connection.id);
    setError("");
    setMessage("");
    try {
      await hideAiConnectorHistory(connection.id);
      setHiddenHistoryIds((current) => [...new Set([...current, connection.id])]);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.revokeError);
    } finally {
      setBusyId(null);
    }
  }

  async function hideSelectedHistoryConnections() {
    if (selectedHistoryConnections.length === 0) return;
    if (!window.confirm(formatMessage(copy.historyBulkRemoveConfirm, { count: String(selectedHistoryConnections.length) }))) return;
    setBusyId("history-bulk-remove");
    setError("");
    setMessage("");
    try {
      const results = await Promise.allSettled(selectedHistoryConnections.map((connection) => hideAiConnectorHistory(connection.id)));
      const failed = results.filter((result) => result.status === "rejected");
      const hiddenIds = selectedHistoryConnections
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((connection) => connection.id);
      setHiddenHistoryIds((current) => [...new Set([...current, ...hiddenIds])]);
      setSelectedHistoryIds([]);
      await load();
      if (failed.length > 0) {
        setError(copy.revokeError);
      } else {
        setMessage(copy.historyAuditRetained);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.revokeError);
    } finally {
      setBusyId(null);
    }
  }

  async function openConnectionDetails(connection: AiConnectorConnectionDto, sourceSection: SectionId) {
    setSelectedConnectionIdForDetails(connection.id);
    setSelectedClientId(connection.id);
    setConnectionDetailSheetOpen(true);
    updateQuery({ section: sourceSection, client: connection.id });
    setIsLoadingConnectionDetailLogs(true);
    try {
      const logs = await fetchAiConnectorLogs({ limit: 5, connectionId: connection.id });
      setConnectionDetailLogs(logs.accessLogs);
    } catch {
      setConnectionDetailLogs([]);
    } finally {
      setIsLoadingConnectionDetailLogs(false);
    }
  }

  function openPermissionsForConnection(connection: AiConnectorConnectionDto) {
    setSelectedClientId(connection.id);
    setSection("permissions");
    updateQuery({ section: "permissions", client: connection.id });
  }

  function openActivityForConnection(connection: AiConnectorConnectionDto) {
    setActivityConnectionId(connection.id);
    setActivitySearch("");
    setSection("activity");
    setConnectionDetailSheetOpen(false);
    updateQuery({
      section: "activity",
      client: null,
      connectionId: connection.id,
      activitySearch: null,
      tool: null,
    });
  }

  async function createBearer(client: { clientKind: BearerClientKind; label: string }) {
    if (!isBearerClientKind(client.clientKind)) return;
    const allowedScopes = summary?.policy
      ? bearerDraft.scopes.filter((scope) => isBearerScopeAllowed(summary.policy, scope))
      : [];
    if (allowedScopes.length === 0) return;
    setBusyId(`bearer-${client.clientKind}`);
    setError("");
    setMessage("");
    try {
      const response = await createAiConnectorBearer({
        clientKind: client.clientKind,
        displayName: bearerDraft.displayName.trim() || client.label,
        lifetimeDays: bearerDraft.lifetimeDays,
        scopes: allowedScopes,
      });
      setOneTimeBearerToken({
        clientKind: client.clientKind,
        connectionId: response.connection.id,
        token: response.bearerToken,
        hint: response.tokenHint,
        expiresAt: response.expiresAt,
      });
      setMessage(copy.bearerCreated);
      setSelectedClientId(response.connection.id);
      updateQuery({ section: "connect", client: response.connection.id });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : copy.bearerCreateError);
    } finally {
      setBusyId(null);
    }
  }

  const sectionItems: Array<{ id: SectionId; label: string; icon: typeof Bot; count?: string }> = [
    { id: "overview", label: copy.sectionOverview, icon: Bot },
    { id: "connect", label: copy.sectionConnect, icon: Cable, count: String(CLIENT_REGISTRY.length) },
    { id: "connections", label: copy.sectionConnections, icon: Activity, count: String(currentConnections.length) },
    { id: "history", label: copy.sectionHistory, icon: EyeOff, count: String(visibleHistoryCount) },
    { id: "permissions", label: copy.sectionPermissions, icon: Shield, count: String(activeConnections.length) },
    { id: "tool-catalog", label: copy.sectionToolCatalog, icon: Wrench, count: String(summary?.toolCatalog?.length ?? 0) },
    { id: "activity", label: copy.sectionActivity, icon: Activity, count: String(accessLogs.length) },
  ];

  function openConnectSection() {
    setSection("connect");
    updateQuery({ section: "connect" });
  }

  return (
    <div className="min-w-0 space-y-4 sm:space-y-5" data-testid="settings-ai-connectors-page">
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-4 shadow-sm sm:flex-row sm:items-end sm:justify-between sm:px-5">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{copy.pageEyebrow}</p>
          <h1 className="mt-2 text-2xl font-semibold text-foreground">{copy.pageTitle}</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{copy.pageDescription}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="outline" size="sm" onClick={() => void copyEndpoint()}>
            <Copy className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.copyUrl}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.refresh}
          </Button>
        </div>
      </div>

      {message ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status" aria-live="polite">
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
          {error}
        </div>
      ) : null}
      {allScopeGroupsDisabled ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">
          {copy.policyAlert}
        </div>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[240px_minmax(0,1fr)]">
        <Card className="rounded-2xl px-3 py-3 sm:px-4">
          <nav aria-label="AI Connectors sections" className="space-y-1">
            {sectionItems.map((item) => {
              const Icon = item.icon;
              const active = section === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-testid={`ai-connectors-tab-${item.id}`}
                  onClick={() => {
                    setSection(item.id);
                    updateQuery({ section: item.id });
                  }}
                  className={cn(
                    "flex w-full items-center justify-between rounded-xl px-3 py-2 text-left transition",
                    active ? "bg-foreground text-background" : "hover:bg-muted/70",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="flex items-center gap-2">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    <span className="text-sm font-medium">{item.label}</span>
                  </span>
                  {item.count ? (
                    <span className={cn("rounded-full px-2 py-0.5 text-[11px]", active ? "bg-background/15 text-background" : "bg-muted text-muted-foreground")}>
                      {item.count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
        </Card>

        <div className="space-y-4">
          {section === "overview" ? (
            <section id="overview" className="space-y-4">
              <Card className="rounded-2xl">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">{copy.overviewTitle}</h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{copy.overviewBody}</p>
                  </div>
                  <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{copy.endpoint}</p>
                    <p className="mt-1 break-all font-mono text-sm text-foreground">{endpointFromSummary(summary)}</p>
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <OverviewStat label={copy.readiness} value={readinessStatusLabel(copy, summary?.policy.readiness.status)} />
                  <OverviewStat label={copy.activeClients} value={String(currentConnections.filter((item) => item.status === "active").length)} />
                  <OverviewStat label={copy.bearerFallback} value={summary?.policy.readiness.bearerFallbackEnabled ? copy.available : copy.unavailable} />
                  <OverviewStat label={copy.highRisk} value={summary?.policy.readiness.highRiskToolsEnabled ? copy.postingOn : copy.postingOff} />
                </div>
              </Card>

              {showRecoveryState ? (
                <ConnectorRecoveryCard
                  copy={copy}
                  isAdmin={isAdmin}
                  needsAdminSetup={needsAdminSetup}
                  onOpenConnect={openConnectSection}
                />
              ) : null}

              <Card className="rounded-2xl">
                <div className="flex flex-wrap gap-2">
                  {summary?.policy.readiness.checks.map((check) => (
                    <McpStatusChip key={check.key} tone={mcpStatusTone(check.status)}>
                      {readinessCheckLabel(copy, locale, check.key)}
                    </McpStatusChip>
                  ))}
                </div>
              </Card>
            </section>
          ) : null}

          {section === "connect" ? (
            <section id="connect" className="space-y-4">
              <Card className="rounded-2xl">
                <h2 className="text-lg font-semibold text-foreground">{copy.connectTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.connectBody}</p>
              </Card>
              <div className="grid gap-4 lg:grid-cols-2">
                {CLIENT_REGISTRY.map((clientKind) => {
                  const client = getAiClientMetadata(clientKind);
                  const connectedCount = currentConnections.filter((connection) =>
                    getAiClientMetadataFromConnection(connection).clientKind === client.clientKind).length;
                  const allowed = client.clientKind === "claude_ai_connector"
                    ? ((summary?.policy.allowedClientKinds as Record<string, boolean> | undefined)?.claude_ai_connector ?? true)
                    : (summary?.policy.allowedClientKinds[client.clientKind] ?? false);
                  const bearerClientKind = client.clientKind !== "claude_ai_connector" && isBearerClientKind(client.clientKind)
                    ? client.clientKind
                    : null;
                  const allowedBearerScopes = getBearerAllowedScopes(summary?.policy ?? null, summary);
                  const bearerActiveForClient = bearerClientKind !== null && activeBearerConnections.some((connection) =>
                    connection.clientKind === bearerClientKind);
                  const bearerLimitReached = Boolean(summary?.policy)
                    && activeBearerConnections.length >= (summary?.policy.bearerFallback.maxActiveConnectorsPerUser ?? 0);
                  const bearerBlockers: Array<{ reason: string; adminHref?: string }> = [];
                  if (bearerClientKind !== null) {
                    if (!summary?.policy.bearerFallback.enabled) {
                      bearerBlockers.push({
                        reason: copy.bearerBlockedGlobal,
                        adminHref: "/admin/settings?tab=mcp#bearer-fallback-policy",
                      });
                    }
                    if (!(summary?.policy.allowedClientKinds as Record<string, boolean> | undefined)?.[bearerClientKind]) {
                      bearerBlockers.push({
                        reason: copy.bearerBlockedClientDisabled,
                        adminHref: "/admin/settings?tab=mcp#client-kind-allowlist",
                      });
                    }
                    if (!summary?.policy.bearerFallback.allowedClientKinds.includes(bearerClientKind)) {
                      bearerBlockers.push({
                        reason: copy.bearerBlockedClientNotAllowed,
                        adminHref: "/admin/settings?tab=mcp#bearer-fallback-policy",
                      });
                    }
                    if (allowedBearerScopes.length === 0) {
                      bearerBlockers.push({
                        reason: copy.bearerBlockedNoToolGroups,
                        adminHref: "/admin/settings?tab=mcp#bearer-tool-groups",
                      });
                    }
                    if (bearerActiveForClient) bearerBlockers.push({ reason: copy.bearerBlockedDuplicate });
                    if (bearerLimitReached) bearerBlockers.push({ reason: copy.bearerBlockedLimit });
                  }
                  const bearerAllowed = bearerClientKind !== null && bearerBlockers.length === 0;
                  const bearerOpen = bearerDraft.clientKind === client.clientKind;
                  const bearerLifetimeMax = summary?.policy.bearerFallback.maxLifetimeDays ?? 30;
                  return (
                    <Card key={client.clientKind} className="rounded-2xl">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="flex min-w-0 items-start gap-3">
                          <AiClientGlyph clientKind={client.clientKind} className="h-11 w-11 rounded-xl" />
                          <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="text-base font-semibold text-foreground">{client.label}</h3>
                            <McpStatusChip tone={client.tier === "Tier 1" ? "emerald" : "slate"}>{client.tier}</McpStatusChip>
                            <McpStatusChip tone={allowed ? "emerald" : "amber"}>{allowed ? copy.available : copy.unavailable}</McpStatusChip>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">{client.vendor} · {client.authModes}</p>
                          </div>
                        </div>
                        <div className="rounded-xl border border-border px-3 py-2 text-right">
                          <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{copy.connected}</p>
                          <p className="text-lg font-semibold text-foreground">{connectedCount}</p>
                        </div>
                      </div>
                      <p className="mt-4 text-sm text-muted-foreground">{client.snippet}</p>
                      <details className="mt-4 rounded-xl border border-border bg-muted/30 px-3 py-3">
                        <summary className="cursor-pointer text-sm font-semibold text-foreground">{copy.setup}</summary>
                        <div className="mt-3 space-y-3">
                          <div>
                            <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{copy.endpoint}</p>
                            <p className="mt-1 break-all font-mono text-sm text-foreground">{endpointFromSummary(summary)}</p>
                          </div>
                          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-background px-3 py-3 text-xs text-foreground">
                            <code>{setupSnippetForClient(client.clientKind, endpointFromSummary(summary))}</code>
                          </pre>
                          <div className="flex flex-wrap gap-2">
                            <Button variant="outline" size="sm" onClick={() => void copySetupSnippet(client.clientKind)}>
                              <Copy className="h-4 w-4" aria-hidden="true" />
                              {copy.copySnippet}
                            </Button>
                            <Button variant="outline" size="sm" asChild>
                              <a href={client.docsUrl} target="_blank" rel="noreferrer">
                                <ExternalLink className="h-4 w-4" aria-hidden="true" />
                                {copy.docs}
                              </a>
                            </Button>
                          </div>
                        </div>
                      </details>
                      {bearerClientKind !== null ? (
                        <div className="mt-4 rounded-xl border border-border bg-background px-3 py-3">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-foreground">{copy.bearerFallback}</p>
                              <p className="mt-1 text-sm text-muted-foreground">{bearerAllowed ? copy.bearerSecondary : copy.bearerUnavailable}</p>
                              {!bearerAllowed && bearerBlockers.length > 0 ? (
                                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                                  <p className="font-semibold">{copy.bearerBlockedReasons}</p>
                                  <ul className="mt-1 list-disc space-y-1 pl-4">
                                    {bearerBlockers.map((blocker) => (
                                      <li key={blocker.reason}>
                                        <span>{blocker.reason}</span>
                                        {isAdmin && blocker.adminHref ? (
                                          <a className="ml-1 font-medium underline underline-offset-2" href={blocker.adminHref}>
                                            {copy.bearerRepairLink}
                                          </a>
                                        ) : null}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                            <Button
                              variant="outline"
                              size="sm"
                              data-testid={`ai-connectors-bearer-open-${client.clientKind}`}
                              disabled={!bearerAllowed || busyId === `bearer-${client.clientKind}`}
                              onClick={() => {
                                setOneTimeBearerToken((current) => current?.clientKind === bearerClientKind ? current : null);
                                const defaultScopes = allowedBearerScopes.includes("portfolio:mcp_read")
                                  ? ["portfolio:mcp_read" as AiConnectorScope]
                                  : [];
                                setBearerDraft({
                                  clientKind: bearerClientKind,
                                  displayName: client.label,
                                  lifetimeDays: Math.min(30, bearerLifetimeMax),
                                  scopes: defaultScopes,
                                });
                              }}
                            >
                              {copy.createBearer}
                            </Button>
                          </div>
                          {bearerOpen ? (
                            <div className="mt-4 space-y-3 border-t border-border pt-4">
                              <label className="block text-sm">
                                <span className="font-medium text-foreground">{copy.bearerName}</span>
                                <Input
                                  value={bearerDraft.displayName}
                                  className="mt-1"
                                  onChange={(event) => setBearerDraft((current) => ({ ...current, displayName: event.target.value }))}
                                />
                              </label>
                              <label className="block text-sm">
                                <span className="font-medium text-foreground">{copy.bearerLifetime}</span>
                                <Input
                                  type="number"
                                  min={1}
                                  max={bearerLifetimeMax}
                                  value={String(bearerDraft.lifetimeDays)}
                                  className="mt-1"
                                  onChange={(event) => {
                                    const value = Number.parseInt(event.target.value, 10);
                                    setBearerDraft((current) => ({
                                      ...current,
                                      lifetimeDays: Number.isFinite(value) ? Math.min(Math.max(value, 1), bearerLifetimeMax) : current.lifetimeDays,
                                    }));
                                  }}
                                />
                              </label>
                              <div>
                                <p className="text-sm font-medium text-foreground">{copy.bearerScopes}</p>
                                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                  {groupedScopes(summary).flatMap((group) => group.scopes).map((scope) => {
                                    const scopeAllowed = summary?.policy ? isBearerScopeAllowed(summary.policy, scope) : false;
                                    return (
                                      <label key={`${client.clientKind}-${scope}`} className="flex items-start gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                                        <input
                                          type="checkbox"
                                          checked={bearerDraft.scopes.includes(scope)}
                                          disabled={!scopeAllowed}
                                          onChange={(event) => {
                                            setBearerDraft((current) => ({
                                              ...current,
                                              scopes: event.target.checked
                                                ? [...new Set([...current.scopes, scope])]
                                                : current.scopes.filter((item) => item !== scope),
                                            }));
                                          }}
                                        />
                                        <span className="min-w-0">
                                          <span className="block text-foreground">{getAiConnectorScopeLabel(locale, scope)}</span>
                                          {isResearchScope(scope) ? (
                                            <span className="mt-1 block text-xs text-amber-700">{copy.researchScope}</span>
                                          ) : null}
                                          {isAdvancedFinancialWriteScope(scope as AiConnectorScope) ? (
                                            <span className="mt-1 block text-xs text-amber-700">{copy.advancedWriteScope}</span>
                                          ) : null}
                                          {!scopeAllowed ? <span className="text-xs text-amber-700">{copy.hiddenByPolicy}</span> : null}
                                        </span>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                data-testid={`ai-connectors-bearer-submit-${client.clientKind}`}
                                disabled={
                                  busyId === `bearer-${client.clientKind}`
                                  || (summary?.policy ? bearerDraft.scopes.filter((scope) => isBearerScopeAllowed(summary.policy, scope)).length === 0 : true)
                                }
                                onClick={() => bearerClientKind ? void createBearer({ clientKind: bearerClientKind, label: client.label }) : undefined}
                              >
                                {copy.createBearer}
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {oneTimeBearerToken && bearerOpen && oneTimeBearerToken.clientKind === client.clientKind ? (
                        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900" role="status" aria-live="polite">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="font-semibold">{copy.bearerTokenOneTime}</p>
                              <p className="mt-1">{copy.expires}: {formatTime(oneTimeBearerToken.expiresAt, copy)}</p>
                              <p className="mt-2 break-all font-mono text-xs">{oneTimeBearerToken.token}</p>
                            </div>
                            <Button variant="outline" size="sm" onClick={() => setOneTimeBearerToken(null)}>
                              {copy.closeToken}
                            </Button>
                          </div>
                        </div>
                      ) : null}
                      <div className="mt-4 flex flex-wrap gap-2">
                        <a
                          href={client.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm font-medium text-foreground transition hover:bg-muted/50"
                        >
                          <ExternalLink className="h-4 w-4" aria-hidden="true" />
                          {copy.docs}
                        </a>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </section>
          ) : null}

          {section === "connections" ? (
            <section id="connections" className="space-y-4">
              <Card className="rounded-2xl">
                <h2 className="text-lg font-semibold text-foreground">{copy.connectionsTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.connectionsBody}</p>
              </Card>
              {isLoading ? (
                <Card className="rounded-2xl" role="status" aria-live="polite" aria-busy="true">
                  <p className="text-sm text-muted-foreground">{copy.loading}</p>
                </Card>
              ) : connections.length === 0 && historicalConnections.length === 0 ? (
                <ConnectorRecoveryCard
                  copy={copy}
                  isAdmin={isAdmin}
                  needsAdminSetup={needsAdminSetup}
                  onOpenConnect={openConnectSection}
                />
              ) : (
                <>
                  {currentConnections.length > 0 ? (
                    <Card className="rounded-2xl">
                      <h3 className="text-sm font-semibold text-foreground">{copy.currentConnections}</h3>
                      <div className="mt-4 space-y-4">
                        {currentConnections.map((connection) => (
                          <ConnectionSummaryCard
                            key={connection.id}
                            busy={busyId === connection.id}
                            connection={connection}
                            copy={copy}
                            selected={selectedClientId === connection.id}
                            onDetails={() => void openConnectionDetails(connection, "connections")}
                            onInspect={() => openPermissionsForConnection(connection)}
                            onRevoke={() => void revoke(connection)}
                          />
                        ))}
                      </div>
                    </Card>
                  ) : null}
                </>
              )}
            </section>
          ) : null}

          {section === "history" ? (
            <section id="history" className="space-y-4">
              <Card className="rounded-2xl">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-foreground">{copy.historicalConnections}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.historyAuditRetained}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    <span className="text-sm text-muted-foreground">{formatMessage(copy.selectedHistoryRows, { count: String(selectedHistoryConnections.length) })}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={selectedHistoryConnections.length === 0 || busyId === "history-bulk-remove"}
                      onClick={() => void hideSelectedHistoryConnections()}
                    >
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                      {copy.removeSelectedHistory}
                    </Button>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_150px_190px_150px_150px]">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={historySearch}
                      aria-label={copy.searchHistory}
                      data-testid="ai-connectors-history-search"
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder={copy.searchHistory}
                      className="pl-9"
                    />
                  </label>
                  <Select value={historyStatusFilter} onValueChange={(value) => setHistoryStatusFilter(value as "all" | AiConnectorStatus)}>
                    <SelectTrigger aria-label={copy.historyStatus} data-testid="ai-connectors-history-status-filter">
                      <SelectValue placeholder={copy.historyStatus} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="expired">{copy.expired}</SelectItem>
                      <SelectItem value="revoked">{copy.revoked}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={historyClientFilter} onValueChange={(value) => setHistoryClientFilter(value as "all" | CompatibleAiClientKind)}>
                    <SelectTrigger aria-label={copy.clientKind} data-testid="ai-connectors-history-client-filter">
                      <SelectValue placeholder={copy.clientKind} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      {CLIENT_REGISTRY.map((kind) => (
                        <SelectItem key={`history-${kind}`} value={kind}>{getAiClientMetadata(kind).label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={historyAuthFilter} onValueChange={(value) => setHistoryAuthFilter(value as HistoryAuthFilter)}>
                    <SelectTrigger aria-label={copy.historyAuth} data-testid="ai-connectors-history-auth-filter">
                      <SelectValue placeholder={copy.historyAuth} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="oauth">{copy.oauthAuthMode}</SelectItem>
                      <SelectItem value="bearer">{copy.bearerAuthMode}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={historyEndedFilter} onValueChange={(value) => setHistoryEndedFilter(value as HistoryEndedFilter)}>
                    <SelectTrigger aria-label={copy.historyEnded} data-testid="ai-connectors-history-ended-filter">
                      <SelectValue placeholder={copy.historyEnded} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="7d">{copy.endedLast7}</SelectItem>
                      <SelectItem value="30d">{copy.endedLast30}</SelectItem>
                      <SelectItem value="90d">{copy.endedLast90}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Card>

              {isLoading ? (
                <Card className="rounded-2xl" role="status" aria-live="polite" aria-busy="true">
                  <p className="text-sm text-muted-foreground">{copy.loading}</p>
                </Card>
              ) : visibleHistoryCount === 0 ? (
                <Card className="rounded-2xl border-dashed" data-testid="ai-connectors-history-empty">
                  <p className="text-sm text-muted-foreground">{copy.noHistory}</p>
                </Card>
              ) : historicalConnections.length === 0 ? (
                <Card className="rounded-2xl border-dashed">
                  <p className="text-sm text-muted-foreground">{copy.noMatchingHistory}</p>
                </Card>
              ) : (
                <HistoryConnectionsTable
                  busyId={busyId}
                  connections={historicalConnections}
                  copy={copy}
                  selectedIds={selectedHistoryIds}
                  onDetails={(connection) => void openConnectionDetails(connection, "history")}
                  onRemove={(connection) => void hideHistoryConnection(connection)}
                  onSelectionChange={setSelectedHistoryIds}
                />
              )}
            </section>
          ) : null}

          {section === "permissions" ? (
            <section id="permissions" className="space-y-4">
              <Card className="rounded-2xl">
                <h2 className="text-lg font-semibold text-foreground">{copy.permissionsTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.permissionsBody}</p>
                <p className="mt-3 hidden text-xs text-muted-foreground md:block">{copy.permissionsMatrixHint}</p>
                <p className="mt-3 text-xs text-muted-foreground md:hidden">{copy.mobilePermissionsHint}</p>
              </Card>
              {isLoading ? (
                <Card className="rounded-2xl" role="status" aria-live="polite" aria-busy="true">
                  <p className="text-sm text-muted-foreground">{copy.loading}</p>
                </Card>
              ) : activeConnections.length === 0 ? (
                <>
                  <Card className="rounded-2xl border-dashed" data-testid="ai-connectors-permissions-empty">
                    <p className="text-sm font-medium text-foreground">{copy.emptyPermissions}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{copy.emptyPermissionsBody}</p>
                  </Card>
                  <ConnectorRecoveryCard
                    copy={copy}
                    isAdmin={isAdmin}
                    needsAdminSetup={needsAdminSetup}
                    onOpenConnect={openConnectSection}
                  />
                </>
              ) : (
                <>
                  <div className="hidden gap-4 md:grid">
                    {activeConnections.map((connection) => (
                      <PermissionRow
                        key={connection.id}
                        busy={busyId === connection.id}
                        connection={connection}
                        copy={copy}
                        locale={locale}
                        policy={summary?.policy ?? null}
                        tools={summary?.toolCatalog ?? []}
                        compact
                        selected={selectedClientId === connection.id}
                        onBackToConnection={() => {
                          setSection("connections");
                          updateQuery({ section: "connections", client: connection.id });
                        }}
                        onDetails={() => void openConnectionDetails(connection, "permissions")}
                        onToggleScope={(scope, checked) => void toggleScope(connection, scope, checked)}
                        onToggleTool={(toolName, checked) => void toggleTool(connection, toolName, checked)}
                      />
                    ))}
                  </div>
                  <div className="space-y-3 md:hidden">
                    {activeConnections.map((connection) => (
                      <details key={connection.id} className="rounded-2xl border border-border bg-card px-4 py-4">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                          <div>
                            <p className="font-semibold text-foreground">{connection.displayName}</p>
                            <p className="text-sm text-muted-foreground">{clientKindLabel(connection)}</p>
                          </div>
                          <McpStatusChip tone={connection.status === "active" ? "emerald" : connection.status === "pending" ? "sky" : "slate"}>
                            {connection.status}
                          </McpStatusChip>
                        </summary>
                        <div className="mt-4">
                          <PermissionRow
                            busy={busyId === connection.id}
                            connection={connection}
                            copy={copy}
                            locale={locale}
                            policy={summary?.policy ?? null}
                            tools={summary?.toolCatalog ?? []}
                            compact
                            selected={selectedClientId === connection.id}
                            onBackToConnection={() => {
                              setSection("connections");
                              updateQuery({ section: "connections", client: connection.id });
                            }}
                            onDetails={() => void openConnectionDetails(connection, "permissions")}
                            onToggleScope={(scope, checked) => void toggleScope(connection, scope, checked)}
                            onToggleTool={(toolName, checked) => void toggleTool(connection, toolName, checked)}
                          />
                        </div>
                      </details>
                    ))}
                  </div>
                </>
              )}
            </section>
          ) : null}

          {section === "tool-catalog" ? (
            <section id="tool-catalog" className="space-y-4">
              <Card className="rounded-2xl">
                <h2 className="text-lg font-semibold text-foreground">{copy.toolCatalogTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.toolCatalogBody}</p>
                <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_150px_170px_170px_160px]">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={toolSearch}
                      data-testid="ai-connectors-tool-search"
                      aria-label={copy.searchTools}
                      onChange={(event) => setToolSearch(event.target.value)}
                      placeholder={copy.searchTools}
                      className="pl-9"
                    />
                  </label>
                  <Select value={toolGroupFilter} onValueChange={(value) => setToolGroupFilter(value as ToolGroupFilter)}>
                    <SelectTrigger data-testid="ai-connectors-tool-group-filter" aria-label={copy.filterGroup}>
                      <SelectValue placeholder={copy.filterGroup} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="read">{copy.readGroup}</SelectItem>
                      {summary && supportsResearchScopeFromState(summary) ? <SelectItem value="research">{copy.researchGroup}</SelectItem> : null}
                      <SelectItem value="drafts">{copy.draftGroup}</SelectItem>
                      <SelectItem value="write">{copy.postingGroup}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={toolAvailabilityFilter} onValueChange={(value) => setToolAvailabilityFilter(value as ToolAvailabilityFilter)}>
                    <SelectTrigger data-testid="ai-connectors-tool-availability-filter" aria-label={copy.filterAvailability}>
                      <SelectValue placeholder={copy.filterAvailability} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="available">{copy.available}</SelectItem>
                      <SelectItem value="unavailable">{copy.unavailable}</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={toolScopeFilter} onValueChange={(value) => setToolScopeFilter(value as ToolScopeFilter)}>
                    <SelectTrigger data-testid="ai-connectors-tool-scope-filter" aria-label={copy.filterScope}>
                      <SelectValue placeholder={copy.filterScope} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      {groupedScopes(summary).flatMap((group) => group.scopes).map((scope) => (
                        <SelectItem key={scope} value={scope}>{getAiConnectorScopeLabel(locale, scope)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={toolOverrideFilter} onValueChange={(value) => setToolOverrideFilter(value as ToolOverrideFilter)}>
                    <SelectTrigger data-testid="ai-connectors-tool-override-filter" aria-label={copy.filterOverride}>
                      <SelectValue placeholder={copy.filterOverride} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="explicit">{copy.explicitOverrides}</SelectItem>
                      <SelectItem value="inherited">{copy.inheritedOnly}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Card>

              {isLoading ? (
                <Card className="rounded-2xl" role="status" aria-live="polite" aria-busy="true">
                  <p className="text-sm text-muted-foreground">{copy.loading}</p>
                </Card>
              ) : toolCatalogIsEmpty ? (
                <Card className="rounded-2xl border-dashed" data-testid="ai-connectors-tool-catalog-empty">
                  <p className="text-sm font-medium text-foreground">{copy.emptyToolCatalog}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{copy.emptyToolCatalogBody}</p>
                </Card>
              ) : filteredTools.length === 0 ? (
                <Card className="rounded-2xl border-dashed">
                  <p className="text-sm text-muted-foreground">{copy.noMatchingTools}</p>
                </Card>
              ) : (
                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]">
                  <Card className="rounded-2xl px-0 py-0">
                    <div className="divide-y divide-border">
                      {filteredTools.map((tool) => {
                        const availableConnections = tool.effectiveAccess.filter((access) => access.status === "available").length;
                        const latestOutcome = recentLogsForTool(accessLogs, tool.name, 1)[0] ?? null;
                        return (
                          <button
                            key={tool.name}
                            type="button"
                            onClick={() => selectToolForInspection(tool.name)}
                            className={cn(
                              "flex w-full items-start justify-between gap-4 px-4 py-3 text-left transition hover:bg-muted/40 sm:px-5",
                              selectedTool?.name === tool.name ? "bg-muted/40" : "",
                            )}
                          >
                            <div className="flex min-w-0 items-start gap-3">
                              <span className={cn(
                                "mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl",
                                tool.availability === "available" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800",
                              )}>
                                <Wrench className="h-4 w-4" aria-hidden="true" />
                              </span>
                              <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="break-all font-mono text-sm font-semibold text-foreground">{tool.name}</span>
                                <McpStatusChip tone={tool.availability === "available" ? "emerald" : "amber"}>{tool.availability}</McpStatusChip>
                                <McpStatusChip tone="slate">{toolGroupValue(tool)}</McpStatusChip>
                              </div>
                              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{tool.description}</p>
                              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                                <span>{getAiConnectorScopeLabel(locale, toolScopeValue(tool))}</span>
                                <span>{accessKindLabel(copy, tool.accessKind)}</span>
                                <span>{availableConnections} {copy.canUse.toLowerCase()}</span>
                              </div>
                              {latestOutcome ? (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  {copy.recentOutcomes}: {latestOutcome.result} · {accessLogContextLabel(copy, latestOutcome)} · {accessKindLabel(copy, latestOutcome.accessKind)}
                                </p>
                              ) : null}
                              </div>
                            </div>
                            <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                          </button>
                        );
                      })}
                    </div>
                  </Card>

                  <Card className="hidden rounded-2xl xl:sticky xl:top-6 xl:block">
                    <h3 className="text-base font-semibold text-foreground">{copy.toolDetailTitle}</h3>
                    {selectedTool ? (
                      <ToolDetailPanel
                        accessLogs={accessLogs}
                        connections={connections}
                        copy={copy}
                        locale={locale}
                        onViewActivity={(toolName) => {
                          setSection("activity");
                          setActivitySearch(toolName);
                          updateQuery({ section: "activity", activitySearch: toolName, tool: null });
                        }}
                        tool={selectedTool}
                      />
                    ) : (
                      <p className="mt-3 text-sm text-muted-foreground">{copy.toolDetailEmpty}</p>
                    )}
                  </Card>
                  <Sheet open={toolDetailSheetOpen} onOpenChange={setToolDetailSheetOpen}>
                    <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-2xl xl:hidden">
                      <SheetHeader>
                        <SheetTitle>{copy.toolDetailTitle}</SheetTitle>
                        <SheetDescription>{selectedTool?.name ?? copy.toolDetailEmpty}</SheetDescription>
                      </SheetHeader>
                      {selectedTool ? (
                        <ToolDetailPanel
                          accessLogs={accessLogs}
                          connections={connections}
                          copy={copy}
                          locale={locale}
                          onViewActivity={(toolName) => {
                            setToolDetailSheetOpen(false);
                            setSection("activity");
                            setActivitySearch(toolName);
                            updateQuery({ section: "activity", activitySearch: toolName, tool: null });
                          }}
                          tool={selectedTool}
                        />
                      ) : null}
                    </SheetContent>
                  </Sheet>
                </div>
              )}
            </section>
          ) : null}

          {section === "activity" ? (
            <section id="activity" className="space-y-4">
              <Card className="rounded-2xl">
                <h2 className="text-lg font-semibold text-foreground">{copy.activityTitle}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{copy.activityBody}</p>
                <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px]">
                  <label className="relative block">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={activitySearch}
                      data-testid="ai-connectors-activity-search"
                      aria-label={copy.searchActivity}
                      onChange={(event) => setActivitySearch(event.target.value)}
                      placeholder={copy.searchActivity}
                      className="pl-9"
                    />
                  </label>
                  <Select value={activityResultFilter} onValueChange={(value) => setActivityResultFilter(value as ActivityResultFilter)}>
                    <SelectTrigger aria-label={copy.filterResult}>
                      <SelectValue placeholder={copy.filterResult} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{copy.filterAll}</SelectItem>
                      <SelectItem value="ok">ok</SelectItem>
                      <SelectItem value="denied">denied</SelectItem>
                      <SelectItem value="error">error</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </Card>
              {activityConnectionId ? (
                <div className="rounded-2xl border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  {copy.connectorId}: <code className="break-all">{activityConnectionId}</code>
                  <Button
                    variant="outline"
                    size="sm"
                    className="ml-0 mt-3 sm:ml-3 sm:mt-0"
                    onClick={() => {
                      setActivityConnectionId(null);
                      updateQuery({ connectionId: null });
                    }}
                  >
                    {copy.filterAll}
                  </Button>
                </div>
              ) : null}
              {isLoadingLogs ? (
                <Card className="rounded-2xl" role="status" aria-live="polite" aria-busy="true">
                  <p className="text-sm text-muted-foreground">{copy.loading}</p>
                </Card>
              ) : filteredActivity.length === 0 ? (
                <Card className="rounded-2xl border-dashed">
                  <p className="text-sm text-muted-foreground">{copy.noActivity}</p>
                </Card>
              ) : (
                <Card className="rounded-2xl px-0 py-0">
                  <div className="divide-y divide-border">
                    {filteredActivity.map((log) => (
                      <div key={log.id} className="flex flex-col gap-2 px-5 py-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="break-all font-mono text-sm font-semibold text-foreground">{log.toolName}</span>
                            <McpStatusChip tone={log.result === "ok" ? "emerald" : log.result === "denied" ? "amber" : "rose"}>{log.result}</McpStatusChip>
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {accessLogContextLabel(copy, log)} · {accessLogDetailLabel(copy, log)}
                          </p>
                          {log.denialReason ? (
                            <p className="mt-1 text-sm text-amber-800">{log.denialReason}</p>
                          ) : null}
                        </div>
                        <div className="text-sm text-muted-foreground">
                          {log.portfolioContextUserId ? `user:${log.portfolioContextUserId}` : "global"}
                        </div>
                      </div>
                    ))}
                  </div>
                  {activityHasMore ? (
                    <div className="border-t border-border px-5 py-4">
                      <Button variant="outline" size="sm" onClick={() => void loadActivityPage("append")} disabled={isLoadingLogs || activityNextOffset === null}>
                        {copy.loadMore}
                      </Button>
                    </div>
                  ) : null}
                </Card>
              )}
            </section>
          ) : null}
        </div>
      </div>
      <Sheet open={connectionDetailSheetOpen} onOpenChange={setConnectionDetailSheetOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle>{copy.connectionDetails}</SheetTitle>
            <SheetDescription>{selectedConnectionForDetails?.displayName ?? copy.details}</SheetDescription>
          </SheetHeader>
          {selectedConnectionForDetails ? (
            <ConnectionDetailPanel
              connection={selectedConnectionForDetails}
              copy={copy}
              isLoadingLogs={isLoadingConnectionDetailLogs}
              logs={connectionDetailLogs}
              onActivity={() => openActivityForConnection(selectedConnectionForDetails)}
              onPermissions={selectedConnectionForDetails.status === "active"
                ? () => {
                  setConnectionDetailSheetOpen(false);
                  openPermissionsForConnection(selectedConnectionForDetails);
                }
                : undefined}
            />
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function OverviewStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function ConnectionSummaryCard({
  busy,
  connection,
  copy,
  selected,
  onDetails,
  onInspect,
  onRevoke,
}: {
  busy: boolean;
  connection: AiConnectorConnectionDto;
  copy: LocalizedCopy;
  selected: boolean;
  onDetails: () => void;
  onInspect: () => void;
  onRevoke: () => void;
}) {
  const metadata = getAiClientMetadataFromConnection(connection);
  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-4",
        selected ? "border-foreground/20 bg-muted/30" : "border-border bg-background",
      )}
      data-testid={`ai-connector-${connection.id}`}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <AiClientGlyph connection={connection} className="h-9 w-9 rounded-xl" />
            <h3 className="text-base font-semibold text-foreground">{connection.displayName}</h3>
            <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
              {connection.status}
            </span>
            <McpStatusChip tone="slate">{clientKindLabel(connection)}</McpStatusChip>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">{copy.vendor}: {vendorLabel(connection)} · {copy.authMode}: {authModeLabel(connection)}</p>
          <div className="mt-2 grid gap-1 text-sm text-muted-foreground sm:grid-cols-3">
            <span>{copy.lastUsed}: {formatTime(connection.lastUsedAt, copy)}</span>
            <span>{copy.expires}: {formatTime(connection.expiresAt, copy)}</span>
            <span>{copy.created}: {formatTime(connection.createdAt, copy)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onDetails}>
            <Eye className="h-4 w-4" aria-hidden="true" />
            {copy.details}
          </Button>
          <Button variant="outline" size="sm" onClick={onInspect}>
            <Shield className="h-4 w-4" aria-hidden="true" />
            {copy.permissions}
          </Button>
          <Button variant="destructive" size="sm" onClick={onRevoke} disabled={busy || connection.status === "revoked"}>
            <RotateCcw className="mr-2 h-4 w-4" aria-hidden="true" />
            {copy.revoke}
          </Button>
        </div>
      </div>
      {connection.authMode === "oauth" ? (
        <div className="mt-4 rounded-2xl border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <p>{copy.reconnectPrompt}</p>
          {metadata.reconnectUrl ? (
            <a
              href={metadata.reconnectUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 font-medium text-foreground transition hover:bg-background"
            >
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
              {copy.reconnect}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function HistoryConnectionsTable({
  busyId,
  connections,
  copy,
  selectedIds,
  onDetails,
  onRemove,
  onSelectionChange,
}: {
  busyId: string | null;
  connections: AiConnectorConnectionDto[];
  copy: LocalizedCopy;
  selectedIds: string[];
  onDetails: (connection: AiConnectorConnectionDto) => void;
  onRemove: (connection: AiConnectorConnectionDto) => void;
  onSelectionChange: (ids: string[]) => void;
}) {
  const visibleIds = connections.map((connection) => connection.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.includes(id));
  function toggleVisible(checked: boolean) {
    onSelectionChange(checked ? visibleIds : selectedIds.filter((id) => !visibleIds.includes(id)));
  }
  function toggleOne(id: string, checked: boolean) {
    onSelectionChange(checked
      ? [...new Set([...selectedIds, id])]
      : selectedIds.filter((selectedId) => selectedId !== id));
  }

  return (
    <Card className="rounded-2xl px-0 py-0" data-testid="ai-connectors-history">
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[900px] text-left text-sm">
          <thead className="border-b border-border bg-muted/20 text-xs uppercase tracking-[0.08em] text-muted-foreground">
            <tr>
              <th className="w-12 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label={copy.selectVisibleHistory}
                  checked={allVisibleSelected}
                  onChange={(event) => toggleVisible(event.target.checked)}
                />
              </th>
              <th className="px-4 py-3">{copy.connected}</th>
              <th className="px-4 py-3">{copy.statusReason}</th>
              <th className="px-4 py-3">{copy.authMode}</th>
              <th className="px-4 py-3">{copy.lastUsed}</th>
              <th className="px-4 py-3">{copy.connectorId}</th>
              <th className="px-4 py-3 text-right">{copy.details}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {connections.map((connection) => (
              <tr key={connection.id} className="align-top">
                <td className="px-4 py-4">
                  <input
                    type="checkbox"
                    aria-label={`${copy.selectVisibleHistory}: ${connection.displayName}`}
                    checked={selectedIds.includes(connection.id)}
                    onChange={(event) => toggleOne(connection.id, event.target.checked)}
                  />
                </td>
                <td className="px-4 py-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <AiClientGlyph connection={connection} className="h-9 w-9 rounded-xl" />
                    <div className="min-w-0">
                      <p className="break-words font-medium text-foreground">{connection.displayName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">{clientKindLabel(connection)} · {vendorLabel(connection)}</p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-4">
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
                    {connection.status}
                  </span>
                  <p className="mt-2 text-xs text-muted-foreground">{connection.revocationReason ?? "-"}</p>
                </td>
                <td className="px-4 py-4 text-muted-foreground">{authModeLabel(connection)}</td>
                <td className="px-4 py-4 text-muted-foreground">
                  <p>{formatTime(connection.lastUsedAt, copy)}</p>
                  <p className="mt-1 text-xs">{copy.expires}: {formatTime(connection.expiresAt, copy)}</p>
                </td>
                <td className="max-w-[180px] px-4 py-4">
                  <code className="break-all rounded bg-muted/40 px-1.5 py-1 text-xs text-muted-foreground">{connection.id}</code>
                </td>
                <td className="px-4 py-4">
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onDetails(connection)}>
                      {copy.details}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyId === connection.id}
                      onClick={() => onRemove(connection)}
                    >
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                      {copy.removeHistoryItem}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="divide-y divide-border lg:hidden">
        {connections.map((connection) => (
          <div key={connection.id} className="px-4 py-4">
            <div className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-3"
                aria-label={`${copy.selectVisibleHistory}: ${connection.displayName}`}
                checked={selectedIds.includes(connection.id)}
                onChange={(event) => toggleOne(connection.id, event.target.checked)}
              />
              <AiClientGlyph connection={connection} className="h-10 w-10 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="break-words font-medium text-foreground">{connection.displayName}</p>
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
                    {connection.status}
                  </span>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{clientKindLabel(connection)} · {authModeLabel(connection)}</p>
                <p className="mt-2 break-all text-xs text-muted-foreground">{copy.connectorId}: {connection.id}</p>
                <p className="mt-2 text-xs text-muted-foreground">{copy.lastUsed}: {formatTime(connection.lastUsedAt, copy)}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => onDetails(connection)}>
                    {copy.details}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busyId === connection.id}
                    onClick={() => onRemove(connection)}
                  >
                    <EyeOff className="h-4 w-4" aria-hidden="true" />
                    {copy.removeHistoryItem}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ConnectionDetailPanel({
  connection,
  copy,
  isLoadingLogs,
  logs,
  onActivity,
  onPermissions,
}: {
  connection: AiConnectorConnectionDto;
  copy: LocalizedCopy;
  isLoadingLogs: boolean;
  logs: AiConnectorAccessLogDto[];
  onActivity: () => void;
  onPermissions?: () => void;
}) {
  return (
    <div className="mt-5 space-y-4">
      <div className="rounded-2xl border border-border px-4 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <AiClientGlyph connection={connection} className="h-11 w-11 rounded-xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="break-words text-base font-semibold text-foreground">{connection.displayName}</h3>
              <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
                {connection.status}
              </span>
              <McpStatusChip tone="slate">{clientKindLabel(connection)}</McpStatusChip>
            </div>
            <p className="mt-1 break-all text-sm text-muted-foreground">{copy.connectorId}: {connection.id}</p>
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <DetailItem label={copy.vendor} value={vendorLabel(connection)} />
        <DetailItem label={copy.authMode} value={authModeLabel(connection)} />
        <DetailItem label={copy.clientKind} value={clientKindLabel(connection)} />
        <DetailItem label={copy.statusReason} value={connection.revocationReason ?? "-"} />
        <DetailItem label={copy.created} value={formatTime(connection.createdAt, copy)} />
        <DetailItem label={copy.lastUsed} value={formatTime(connection.lastUsedAt, copy)} />
        <DetailItem label={copy.expires} value={formatTime(connection.expiresAt, copy)} />
        <DetailItem label={copy.scopes} value={connection.scopes.length > 0 ? connection.scopes.join(", ") : "-"} />
      </div>

      <div className="rounded-2xl border border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{copy.toolOverrides}</p>
        {Object.keys(connection.toolToggles).length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-2">
            {Object.entries(connection.toolToggles).map(([toolName, enabled]) => (
              <McpStatusChip key={toolName} tone={enabled ? "emerald" : "amber"}>
                {toolName}: {enabled ? copy.available : copy.unavailable}
              </McpStatusChip>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">{copy.inheritedDefault}</p>
        )}
      </div>

      <div className="rounded-2xl border border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{copy.recentCalls}</p>
          <Button variant="outline" size="sm" onClick={onActivity}>
            {copy.viewActivityForConnection}
          </Button>
        </div>
        <div className="mt-3 space-y-2">
          {isLoadingLogs ? (
            <p className="text-sm text-muted-foreground">{copy.loading}</p>
          ) : logs.length > 0 ? logs.slice(0, 5).map((log) => (
            <div key={log.id} className="rounded-xl bg-muted/20 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-foreground">{log.toolName}</span>
                <McpStatusChip tone={log.result === "ok" ? "emerald" : log.result === "denied" ? "amber" : "rose"}>{log.result}</McpStatusChip>
              </div>
              <p className="mt-1 text-muted-foreground">{accessLogDetailLabel(copy, log)}</p>
              {log.denialReason ? <p className="mt-1 text-amber-800">{log.denialReason}</p> : null}
            </div>
          )) : (
            <p className="text-sm text-muted-foreground">{copy.noActivity}</p>
          )}
        </div>
      </div>

      {onPermissions ? (
        <Button variant="outline" onClick={onPermissions}>
          <Shield className="h-4 w-4" aria-hidden="true" />
          {copy.permissions}
        </Button>
      ) : null}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-border bg-muted/20 px-3 py-3 text-sm">
      <p className="font-medium text-foreground">{label}</p>
      <p className="mt-1 break-words text-muted-foreground">{value}</p>
    </div>
  );
}

function PermissionRow({
  busy,
  connection,
  copy,
  locale,
  policy,
  selected,
  tools,
  compact = false,
  onBackToConnection,
  onDetails,
  onToggleScope,
  onToggleTool,
}: {
  busy: boolean;
  connection: AiConnectorConnectionDto;
  copy: LocalizedCopy;
  locale: "en" | "zh-TW";
  policy: AiConnectorSummaryResponse["policy"] | null;
  selected?: boolean;
  tools: AiConnectorToolCatalogEntryDto[];
  compact?: boolean;
  onBackToConnection?: () => void;
  onDetails?: () => void;
  onToggleScope: (scope: AiConnectorScope, checked: boolean) => void;
  onToggleTool: (toolName: string, checked: boolean) => void;
}) {
  return (
    <Card className={cn(
      "rounded-2xl",
      compact ? "px-0 py-0 shadow-none hover:translate-y-0 hover:border-border" : "",
      selected ? "border-foreground/20" : "",
    )}>
      <div className={cn("space-y-4", compact ? "px-4 py-4" : "")}>
        <div
          className="flex flex-col gap-3 rounded-2xl border border-border bg-muted/20 px-3 py-3 lg:flex-row lg:items-start lg:justify-between"
          data-testid="ai-connectors-permission-identity-header"
        >
          <div className="flex min-w-0 items-start gap-3">
            <AiClientGlyph connection={connection} className="h-10 w-10 rounded-xl" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="break-words text-base font-semibold text-foreground">{connection.displayName}</h3>
                <span className={cn("rounded-full border px-2 py-0.5 text-xs capitalize", statusClassName(connection.status))}>
                  {connection.status}
                </span>
                <McpStatusChip tone="slate">{clientKindLabel(connection)}</McpStatusChip>
                <McpStatusChip tone="slate">{authModeLabel(connection)}</McpStatusChip>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span>{copy.lastUsed}: {formatTime(connection.lastUsedAt, copy)}</span>
                <span>{copy.expires}: {formatTime(connection.expiresAt, copy)}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {onDetails ? (
              <Button variant="outline" size="sm" onClick={onDetails}>
                <Eye className="h-4 w-4" aria-hidden="true" />
                {copy.details}
              </Button>
            ) : null}
            {onBackToConnection ? (
              <Button variant="outline" size="sm" onClick={onBackToConnection}>
                {copy.backToConnection}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 xl:grid-cols-4">
          {(supportsResearchScopeFromState({ connections: [connection], policy, toolCatalog: tools })
            ? [...BASE_GROUPED_SCOPES.slice(0, 1), { key: "research" as const, scopes: [RESEARCH_SCOPE] }, ...BASE_GROUPED_SCOPES.slice(1)]
            : BASE_GROUPED_SCOPES
          ).map((group) => (
            <div key={group.key} className="rounded-2xl border border-border bg-muted/20 px-3 py-3">
              <p className="text-sm font-semibold text-foreground">{scopeGroupLabel(copy, group.key)}</p>
              <div className="mt-3 space-y-2">
                {group.scopes.map((scope) => {
                  const disabledByPolicy = policy ? !isGroupEnabled(policy, scope) : false;
                  const checked = connection.scopes.includes(scope);
                  const bearerScopeLocked = connection.authMode === "bearer" && !checked;
                  const oauthScopeLocked = connection.authMode === "oauth" && !checked;
                  const disabled = busy || connection.status !== "active" || disabledByPolicy || bearerScopeLocked || oauthScopeLocked;
                  return (
                    <label key={scope} className="flex items-start justify-between gap-3 rounded-xl bg-background px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <span className="block text-foreground">{getAiConnectorScopeLabel(locale, scope)}</span>
                        {isResearchScope(scope) ? (
                          <span className="mt-1 block text-xs text-amber-700">{copy.researchScope}</span>
                        ) : null}
                        {isAdvancedFinancialWriteScope(scope as AiConnectorScope) ? (
                          <span className="mt-1 block text-xs text-amber-700">{copy.advancedWriteScope}</span>
                        ) : null}
                        {disabledByPolicy ? (
                          <span className="mt-1 block text-xs text-amber-700">{copy.hiddenByPolicy}</span>
                        ) : null}
                        {bearerScopeLocked ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {isResearchScope(scope) ? copy.researchScopeLocked : copy.bearerScopeLocked}
                          </span>
                        ) : null}
                        {oauthScopeLocked ? (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {isResearchScope(scope) ? copy.researchScopeLocked : copy.oauthScopeLocked}
                          </span>
                        ) : null}
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={(event) => onToggleScope(scope, event.target.checked)}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <details className="rounded-2xl border border-border bg-muted/20 px-4 py-3">
          <summary className="cursor-pointer list-none text-sm font-semibold text-foreground">{copy.toolOverrides}</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {tools.filter((tool) => effectiveAccessForConnection(tool, connection.id)?.blockerCode !== "missing_scope").map((tool) => {
              const access = effectiveAccessForConnection(tool, connection.id);
              const blockerCode = access?.blockerCode ?? null;
              const blocker = toolAccessBlocker(copy, connection, tool, locale);
              const canToggleOverride = access !== null && (blockerCode === null || blockerCode === "connector_override_disabled");
              return (
                <label key={`${connection.id}-${tool.name}`} className="rounded-2xl border border-border bg-background px-3 py-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-all font-mono font-medium text-foreground">{tool.name}</span>
                        <McpStatusChip tone={tool.availability === "available" ? "emerald" : "amber"}>
                          {tool.availability}
                        </McpStatusChip>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{tool.description}</p>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {Object.prototype.hasOwnProperty.call(connection.toolToggles, tool.name) ? copy.explicitOverride : copy.inheritedDefault}
                      </p>
                      {blocker ? (
                        <p className="mt-1 text-xs text-amber-800">{blocker}</p>
                      ) : null}
                    </div>
                    <input
                      type="checkbox"
                      checked={toolToggleChecked(connection, tool)}
                      disabled={busy || !canToggleOverride}
                      onChange={(event) => onToggleTool(tool.name, event.target.checked)}
                    />
                  </div>
                </label>
              );
            })}
          </div>
        </details>
      </div>
    </Card>
  );
}

function ToolDetailPanel({
  accessLogs,
  connections,
  copy,
  locale,
  onViewActivity,
  tool,
}: {
  accessLogs: AiConnectorAccessLogDto[];
  connections: AiConnectorConnectionDto[];
  copy: LocalizedCopy;
  locale: "en" | "zh-TW";
  onViewActivity: (toolName: string) => void;
  tool: AiConnectorToolCatalogEntryDto;
}) {
  const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
  const allowedAccess = tool.effectiveAccess.filter((access) => access.status === "available");
  const blockedAccess = tool.effectiveAccess.filter((access) =>
    access.status === "blocked" && connectionById.get(access.connectionId)?.status !== "revoked");
  const recentOutcomes = recentLogsForTool(accessLogs, tool.name, 5);
  const alternativeScopes = tool.alternativeScopes ?? [];

  return (
    <div className="mt-4 space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="break-all font-mono text-sm font-semibold text-foreground">{tool.name}</span>
          <McpStatusChip tone={tool.availability === "available" ? "emerald" : "amber"}>{tool.availability}</McpStatusChip>
          <McpStatusChip tone="slate">{toolGroupValue(tool)}</McpStatusChip>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{tool.description}</p>
      </div>
      <div className="grid gap-3">
        <div className="rounded-2xl border border-border bg-muted/20 px-3 py-3 text-sm">
          <p className="font-medium text-foreground">{copy.scopeLabel}</p>
          <p className="mt-1 text-muted-foreground">{getAiConnectorScopeLabel(locale, toolScopeValue(tool))}</p>
        </div>
        {alternativeScopes.length > 0 ? (
          <div className="rounded-2xl border border-border bg-muted/20 px-3 py-3 text-sm">
            <p className="font-medium text-foreground">{copy.alternativeScopesLabel}</p>
            <p className="mt-1 text-muted-foreground">{copy.alternativeScopesBody}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {alternativeScopes.map((scope) => (
                <McpStatusChip key={scope} tone="slate">{getAiConnectorScopeLabel(locale, scope)}</McpStatusChip>
              ))}
            </div>
          </div>
        ) : null}
        <div className="rounded-2xl border border-border bg-muted/20 px-3 py-3 text-sm">
          <p className="font-medium text-foreground">{copy.accessLabel}</p>
          <p className="mt-1 text-muted-foreground">{accessKindLabel(copy, tool.accessKind)}</p>
        </div>
        <div className="rounded-2xl border border-border bg-muted/20 px-3 py-3 text-sm">
          <p className="font-medium text-foreground">{copy.recentCalls}</p>
          <p className="mt-1 text-muted-foreground">{recentOutcomes.length}</p>
        </div>
      </div>
      <div className="rounded-2xl border border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-foreground">{copy.schemaSummary}</p>
          <div className="flex flex-wrap gap-2">
            <McpStatusChip tone={tool.annotations.readOnlyHint ? "emerald" : "amber"}>
              {tool.annotations.readOnlyHint ? copy.readAccess : copy.writeAccess}
            </McpStatusChip>
            {tool.annotations.destructiveHint ? <McpStatusChip tone="rose">{copy.riskAnnotations}</McpStatusChip> : null}
          </div>
        </div>
        {tool.inputSchema.fields.length > 0 ? (
          <div className="mt-3 divide-y divide-border rounded-xl border border-border">
            {tool.inputSchema.fields.map((field) => (
              <div key={field.name} className="grid gap-2 px-3 py-2 text-sm sm:grid-cols-[minmax(0,1fr)_80px_90px]">
                <span className="min-w-0 break-all font-mono text-foreground">{field.name}</span>
                <span className="text-muted-foreground">{field.type}</span>
                <span className="text-muted-foreground">{field.required ? copy.requiredField : copy.optionalField}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">0</p>
        )}
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">{copy.rawSchema}</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-muted/30 px-3 py-3 text-xs text-foreground">
            <code>{JSON.stringify(tool.inputSchema.rawSchema, null, 2)}</code>
          </pre>
        </details>
      </div>
      <div className="rounded-2xl border border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{copy.canUse} ({allowedAccess.length})</p>
        <div className="mt-2 space-y-2">
          {allowedAccess.length > 0 ? allowedAccess.map((access) => {
            const connection = connectionById.get(access.connectionId);
            if (!connection || connection.status === "revoked") return null;
            return (
              <div key={`allow-${access.connectionId}`} className="flex items-center justify-between gap-3 text-sm">
                <span className="flex min-w-0 items-center gap-2 truncate text-foreground">
                  <AiClientGlyph connection={connection} className="h-7 w-7 rounded-lg" />
                  <span className="truncate">{access.connectionDisplayName}</span>
                </span>
                <McpStatusChip tone="emerald">{connection?.status ?? "active"}</McpStatusChip>
              </div>
            );
          }).filter(Boolean) : <p className="text-sm text-muted-foreground">0</p>}
        </div>
      </div>
      <div className="rounded-2xl border border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{copy.unavailableFor} ({blockedAccess.length})</p>
        <div className="mt-2 space-y-2">
          {blockedAccess.map((access) => {
            const connection = connectionById.get(access.connectionId);
            if (!connection) return null;
            return (
              <div key={`block-${access.connectionId}`} className="rounded-xl bg-muted/20 px-3 py-2 text-sm">
                <p className="flex items-center gap-2 font-medium text-foreground">
                  <AiClientGlyph connection={connection} className="h-7 w-7 rounded-lg" />
                  <span>{access.connectionDisplayName}</span>
                </p>
                <p className="mt-1 text-muted-foreground">
                  {copy.highestPriorityBlocker}: {connection ? toolBlockerLabel(copy, access.blockerCode, connection, tool, locale) : "-"}
                </p>
              </div>
            );
          }).filter(Boolean)}
        </div>
      </div>
      <div className="rounded-2xl border border-border px-4 py-3">
        <p className="text-sm font-semibold text-foreground">{copy.recentOutcomes} ({recentOutcomes.length})</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => onViewActivity(tool.name)}>
          {copy.viewAllCalls}
        </Button>
        <div className="mt-2 space-y-2">
          {recentOutcomes.length > 0 ? recentOutcomes.map((log) => (
            <div key={`outcome-${log.id}`} className="rounded-xl bg-muted/20 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <McpStatusChip tone={log.result === "ok" ? "emerald" : log.result === "denied" ? "amber" : "rose"}>{log.result}</McpStatusChip>
                <span className="text-muted-foreground">{accessLogContextLabel(copy, log)}</span>
              </div>
              <p className="mt-1 text-muted-foreground">{accessLogDetailLabel(copy, log)}</p>
              {log.denialReason ? <p className="mt-1 text-amber-800">{log.denialReason}</p> : null}
            </div>
          )) : <p className="text-sm text-muted-foreground">0</p>}
        </div>
      </div>
    </div>
  );
}
