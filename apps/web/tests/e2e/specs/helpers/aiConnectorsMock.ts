import type { Page } from "@playwright/test";

export async function mockAiConnectorApi(page: Page) {
  const policy = {
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    allowedProviders: { chatgpt: true, self_hosted: true },
    allowedClientKinds: {
      chatgpt_app: true,
      claude_ai_connector: true,
      claude_code: true,
      codex_cli: true,
      gemini_cli: true,
      copilot_mcp: true,
      generic_mcp: true,
    },
    groupToggles: { read: true, drafts: true, write: true },
    bearerFallback: {
      enabled: true,
      allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
      maxLifetimeDays: 30,
      maxActiveConnectorsPerUser: 3,
      allowedToolGroups: ["read"],
    },
    inactivityExpiryDays: 90,
    expirationWarningDays: 7,
    freshAuthMaxAgeMs: 600000,
    maxConnectorLifetimeDays: 90,
    oauthPublicIssuer: "https://api.example.com",
    oauthRedirectUriAllowlist: [],
    oauthTokenSecretSet: true,
    readiness: {
      status: "ready",
      endpoint: "https://api.example.com/mcp",
      deploymentEnabled: true,
      publicIssuerConfigured: true,
      oauthTokenSecretConfigured: true,
      mcpUrlReady: true,
      enabledClientKindCount: 7,
      totalClientKindCount: 7,
      highRiskToolsEnabled: true,
      bearerFallbackEnabled: true,
      checks: [
        { key: "deployment", status: "ok" },
        { key: "public_issuer", status: "ok" },
        { key: "oauth_token_secret", status: "ok" },
        { key: "mcp_url", status: "ok" },
        { key: "client_kind_policy", status: "ok" },
        { key: "high_risk_tools", status: "ok" },
        { key: "bearer_fallback", status: "ok" },
      ],
    },
    updatedAt: "2026-06-28T00:00:00.000Z",
  };
  const activeConnections = [
    {
      id: "conn-chatgpt-active",
      provider: "chatgpt",
      vendor: "openai",
      clientKind: "chatgpt_app",
      authMode: "oauth",
      capabilities: ["oauth", "widgets", "interactive_ops", "deep_link_fallback"],
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      toolToggles: {},
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      expiryNotifiedAt: null,
      lastUsedAt: "2026-06-28T00:00:00.000Z",
      revokedAt: null,
      revocationReason: null,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    },
    {
      id: "conn-claude-active",
      provider: "self_hosted",
      vendor: "anthropic",
      clientKind: "claude_ai_connector",
      authMode: "oauth",
      capabilities: ["oauth", "deep_link_fallback"],
      displayName: "Claude.ai",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      toolToggles: {},
      expiresAt: new Date(Date.now() + 30 * 86400000).toISOString(),
      expiryNotifiedAt: null,
      lastUsedAt: "2026-06-28T00:00:00.000Z",
      revokedAt: null,
      revocationReason: null,
      createdAt: "2026-06-20T00:00:00.000Z",
      updatedAt: "2026-06-28T00:00:00.000Z",
    },
  ];
  const historyConnections = [
    {
      ...activeConnections[1],
      id: "conn-claude-revoked",
      displayName: "Claude.ai Old",
      status: "revoked",
      revokedAt: "2026-06-27T00:00:00.000Z",
      revocationReason: "User revoked",
      updatedAt: "2026-06-27T00:00:00.000Z",
    },
  ];
  const accessLogs = [
    {
      id: "log-claude-1",
      connectionId: "conn-claude-revoked",
      connectionDisplayName: "Claude.ai Old",
      clientKind: "claude_ai_connector",
      portfolioContextUserId: "user-1",
      shareId: null,
      toolName: "get_portfolio_report",
      accessKind: "read",
      result: "ok",
      denialReason: null,
      createdAt: "2026-06-28T00:00:00.000Z",
    },
  ];

  await page.route("**/ai/connectors/summary", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ connections: activeConnections, policy, toolCatalog: [] }),
    });
  });
  await page.route("**/ai/connectors/history**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ connections: historyConnections }),
    });
  });
  await page.route("**/ai/connectors/logs**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ accessLogs, nextOffset: null, hasMore: false }),
    });
  });
  await page.route("**/ai/connectors/*/hide", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(historyConnections[0]),
    });
  });
  return { activeConnections, historyConnections, policy };
}
