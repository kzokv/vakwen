import type { AiConnectorScope, LocaleCode } from "@vakwen/shared-types";

export const aiConnectorScopeLabels: Record<LocaleCode, Record<string, string>> = {
  en: {
    "portfolio:mcp_read": "Read portfolio data",
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

export const connectionLifecycleCopy = {
  en: {
    choice: "Connection action", create: "Create another connection", replace: "Replace an existing connection",
    cap: "The active connection limit has been reached. Select an eligible connection to replace, or revoke an unused connection in settings.",
    capacity: "Active connections", select: "Select the connection to replace", noTargets: "No eligible connections are available for this AI client.",
    impact: "Only the selected authorization stops working after the new connection is activated. Other connections keep working. Cancellation preserves the existing connection. Vakwen cannot remove the old entry from your AI client's settings.",
    name: "Connection name (optional)", nameHint: "Leave blank for an automatic name. This label is for Vakwen and may differ from the name in your AI client.",
    created: "Created", lastUsed: "Last used", expires: "Expires", never: "Never", active: "Active", permissions: "Permissions",
    refresh: "Refresh available connections", capacityChanged: "Connection capacity changed. Refresh available connections and select a replacement or free a slot in settings.",
    targetChanged: "The selected connection is no longer eligible. Refresh available connections and choose a target again.",
    rename: "Rename", save: "Save name", cancel: "Cancel", label: "Connection name", saved: "Connection name saved.",
  },
  "zh-TW": {
    choice: "連線操作", create: "建立另一個連線", replace: "取代現有連線",
    cap: "已達有效連線數上限。請選擇可取代的連線，或在設定中撤銷不再使用的連線。",
    capacity: "有效連線", select: "選擇要取代的連線", noTargets: "此 AI 客戶端沒有可取代的連線。",
    impact: "新連線啟用後，只有所選的舊授權會停止運作，其他連線不受影響。取消會保留原有連線。Vakwen 無法移除 AI 客戶端設定中的舊項目。",
    name: "連線名稱（選填）", nameHint: "留空會自動命名。此名稱用於 Vakwen，可能與 AI 客戶端顯示的名稱不同。",
    created: "建立時間", lastUsed: "上次使用", expires: "到期時間", never: "無", active: "有效", permissions: "權限",
    refresh: "重新整理可用連線", capacityChanged: "連線容量已變更。請重新整理可用連線並選擇取代，或在設定中釋出空間。",
    targetChanged: "所選連線已無法取代。請重新整理可用連線，再重新選擇。",
    rename: "重新命名", save: "儲存名稱", cancel: "取消", label: "連線名稱", saved: "已儲存連線名稱。",
  },
} as const;

const connectionReasonCopy: Record<LocaleCode, Record<string, string>> = {
  en: {
    mcp_connection_replaced: "This connection was replaced by a new authorization.",
    mcp_connection_revoked: "This connection was revoked. Reconnect to authorize access again.",
    mcp_connection_expired: "This connection has expired. Reconnect to renew access.",
    mcp_auth_expired: "The access token expired. Your AI client needs to refresh its credentials.",
    mcp_auth_invalid_session: "Your account session changed. Reconnect to authorize access again.",
    mcp_auth_invalid_user: "The account is no longer available for this connection.",
    replaced_by_oauth_authorization: "Replaced by a new authorization.",
    manual: "Revoked by the user.",
    absolute_expiry: "The connection lifetime ended.",
    inactivity_expiry: "The connection expired after inactivity.",
    session_version_changed: "Revoked after an account session security change.",
    refresh_token_reuse: "Revoked because a previously used refresh token was replayed.",
  },
  "zh-TW": {
    mcp_connection_replaced: "此連線已由新的授權取代。",
    mcp_connection_revoked: "此連線已撤銷。請重新連線以再次授權存取。",
    mcp_connection_expired: "此連線已到期。請重新連線以更新存取權。",
    mcp_auth_expired: "存取權杖已到期。AI 客戶端需要更新驗證資訊。",
    mcp_auth_invalid_session: "帳戶工作階段已變更。請重新連線以再次授權存取。",
    mcp_auth_invalid_user: "此連線使用的帳戶已無法使用。",
    replaced_by_oauth_authorization: "已由新的授權取代。",
    manual: "由使用者撤銷。",
    absolute_expiry: "連線有效期限已結束。",
    inactivity_expiry: "連線因長時間未使用而到期。",
    session_version_changed: "因帳戶工作階段安全性變更而撤銷。",
    refresh_token_reuse: "因重複使用已用過的更新權杖而撤銷。",
  },
};

export function getConnectionReasonLabel(locale: LocaleCode, reason: string | null): string {
  return reason ? connectionReasonCopy[locale][reason] ?? reason : "-";
}
