import type { AiConnectorScope, LocaleCode } from "@vakwen/shared-types";

export const aiConnectorScopeLabels: Record<LocaleCode, Record<string, string>> = {
  en: {
    "portfolio:mcp_read": "Read portfolio data",
    "research:read": "Research identities for Taiwan additive workflows",
    "account:manage": "Manage accounts",
    "transaction_draft:create": "Create transaction drafts",
    "transaction_draft:edit": "Edit transaction drafts",
    "transaction_draft:archive": "Archive transaction drafts",
    "transaction_draft:delete": "Delete transaction drafts",
    "transaction:write": "Post, update, and delete confirmed transactions",
    "dividend:write": "Write dividends and related portfolio accounting adjustments",
  },
  "zh-TW": {
    "portfolio:mcp_read": "讀取投資組合資料",
    "research:read": "讀取台股研究身分與加值研究流程",
    "account:manage": "管理帳戶",
    "transaction_draft:create": "建立交易草稿",
    "transaction_draft:edit": "編輯交易草稿",
    "transaction_draft:archive": "封存交易草稿",
    "transaction_draft:delete": "刪除交易草稿",
    "transaction:write": "送出、更新與刪除已確認交易",
    "dividend:write": "寫入股利與相關投資組合帳務調整",
  },
};

export const chatGptConnectorAuthorizeCopy: Record<LocaleCode, {
  title: string;
  description: string;
  client: string;
  detectedClient: string;
  resource: string;
  redirect: string;
  permissions: string;
  permissionGroups: string;
  connectorLifetime: string;
  connectorApprovalBusy: string;
  connectorDenialBusy: string;
  retryRequest: string;
  startAgainInClient: string;
  loadingRequest: string;
  approve: string;
  approving: string;
  deny: string;
  missingRequestError: string;
  loadError: string;
  approveError: string;
  denyError: string;
  policyDisabled: string;
  disabledByPolicy: string;
  advancedScope: string;
  postingOptIn: string;
  researchOptIn: string;
  researchReconnect: string;
  requiresManageReconsent: string;
  consentIdentity: string;
  redirectRepairTitle: string;
  redirectRepairBody: string;
  exactCallback: string;
  suggestedAdminFix: string;
}> = {
  en: {
    title: "AI connector authorization",
    description: "Review the detected AI client, requested MCP access, and callback details before approving.",
    client: "Client",
    detectedClient: "Detected client",
    resource: "MCP resource",
    redirect: "Redirect",
    permissions: "Permissions",
    permissionGroups: "Permission groups",
    connectorLifetime: "Connector lifetime",
    connectorApprovalBusy: "Approving connector request",
    connectorDenialBusy: "Denying connector request",
    retryRequest: "Retry request",
    startAgainInClient: "Start again in your AI client",
    loadingRequest: "Loading authorization request...",
    approve: "Approve",
    approving: "Approving...",
    deny: "Deny",
    missingRequestError: "Connector authorization request could not be loaded.",
    loadError: "Connector authorization request could not be loaded.",
    approveError: "Connector approval failed.",
    denyError: "Connector denial failed.",
    policyDisabled: "Admin policy has disabled every requested MCP tool group. Deny this request or ask an admin to re-enable at least one MCP tool group before approving.",
    disabledByPolicy: "Disabled by admin policy",
    advancedScope: "Advanced scope. Off by default and requires fresh auth or re-consent to grant.",
    postingOptIn: "Financial writes are advanced opt-in scopes. Leave them unchecked unless you want this AI client to preview, post, update, or delete confirmed transactions and dividend actions after explicit confirmation.",
    researchOptIn: "Research access is additive. Leave it unchecked unless you want Taiwan research identity lookups; existing connectors do not gain it silently.",
    researchReconnect: "Research access is additive and off by default. Existing OAuth connectors keep their current scopes; reconnect and re-consent later if you want to add research access.",
    requiresManageReconsent: "Reconnect in ChatGPT and grant `account:manage` before this widget can create or change accounts.",
    consentIdentity: "Authorization request",
    redirectRepairTitle: "This callback is not allowlisted yet",
    redirectRepairBody: "Vakwen rejected the OAuth callback before consent. Ask an admin to add this exact redirect callback in Admin MCP settings, then retry from the same AI client.",
    exactCallback: "Exact callback URI",
    suggestedAdminFix: "Suggested admin fix",
  },
  "zh-TW": {
    title: "AI 連接器授權",
    description: "核對偵測到的 AI 客戶端、要求的 MCP 存取，以及回呼設定後再決定是否核准。",
    client: "Client",
    detectedClient: "偵測到的客戶端",
    resource: "MCP 資源",
    redirect: "重新導向",
    permissions: "權限",
    permissionGroups: "權限群組",
    connectorLifetime: "連接器有效天數",
    connectorApprovalBusy: "正在核准連接器請求",
    connectorDenialBusy: "正在拒絕連接器請求",
    retryRequest: "重試請求",
    startAgainInClient: "回到 AI 客戶端重新開始",
    loadingRequest: "正在載入授權請求...",
    approve: "核准",
    approving: "核准中...",
    deny: "拒絕",
    missingRequestError: "無法載入連接器授權請求。",
    loadError: "無法載入連接器授權請求。",
    approveError: "連接器核准失敗。",
    denyError: "連接器拒絕失敗。",
    policyDisabled: "管理員策略已停用所有要求的 MCP 工具群組。請拒絕此請求，或先請管理員重新啟用至少一個 MCP 工具群組後再核准。",
    disabledByPolicy: "已被管理員策略停用",
    advancedScope: "進階權限。預設關閉，需重新授權或重新同意後才能啟用。",
    postingOptIn: "財務寫入屬於進階自選權限。除非你希望此 AI 客戶端在明確確認後預覽、送出、更新或刪除已確認交易與股利動作，否則請保持未勾選。",
    researchOptIn: "研究權限屬於加值授權。只有在你要啟用台股研究身分查詢時才勾選；現有連接器不會被靜默升級。",
    researchReconnect: "研究權限屬於加值且預設關閉。現有 OAuth 連接器會維持原本 scope；若之後要加入研究權限，請重新連線並重新同意。",
    requiresManageReconsent: "請在 ChatGPT 重新連線並授權 `account:manage`，此元件才能建立或修改帳戶。",
    consentIdentity: "授權請求",
    redirectRepairTitle: "此回呼網址尚未加入允許清單",
    redirectRepairBody: "Vakwen 在同意頁前就拒絕了此 OAuth 回呼。請管理員到 Admin MCP settings 加入完全相符的回呼網址，之後再從相同 AI 客戶端重試。",
    exactCallback: "完整回呼 URI",
    suggestedAdminFix: "建議的管理員修復",
  },
};

export function getAiConnectorScopeLabel(locale: LocaleCode, scope: AiConnectorScope): string {
  return aiConnectorScopeLabels[locale][scope];
}
