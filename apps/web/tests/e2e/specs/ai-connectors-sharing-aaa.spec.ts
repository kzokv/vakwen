import type { Locator, Page } from "@playwright/test";
import { test } from "@vakwen/test-e2e/fixtures/appPages";

async function assertToggleChecked(toggle: Locator, label: string): Promise<void> {
  if (!(await toggle.isChecked())) {
    throw new Error(`Expected ${label} to be checked`);
  }
}

async function mockAiConnectorApi(page: Page): Promise<void> {
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
    groupToggles: { read: true, research: true, drafts: true, write: true },
    bearerFallback: {
      enabled: true,
      allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
      maxLifetimeDays: 30,
      maxActiveConnectorsPerUser: 3,
      allowedToolGroups: ["read", "research"],
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
      expiresAt: "2026-07-28T00:00:00.000Z",
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
      expiresAt: "2026-07-28T00:00:00.000Z",
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
      body: JSON.stringify({
        connections: activeConnections,
        policy,
        toolCatalog: [
          {
            name: "search_instruments",
            description: "Search Taiwan research identities without broadening legacy read access.",
            scope: "portfolio:mcp_read",
            alternativeScopes: ["research:read"],
            accessKind: "read",
            group: "read",
            inputSchema: {
              fields: [
                { name: "includeInactive", type: "boolean", required: false },
                { name: "query", type: "string", required: true },
              ],
              rawSchema: {
                type: "object",
                properties: {
                  includeInactive: { type: "boolean" },
                  query: { type: "string" },
                },
                required: ["query"],
              },
            },
            enabledByPolicy: true,
            availability: "available",
            unavailableReason: null,
            annotations: {
              readOnlyHint: true,
              destructiveHint: false,
              idempotentHint: true,
              openWorldHint: false,
            },
            effectiveAccess: [
              {
                connectionId: "conn-chatgpt-active",
                connectionDisplayName: "ChatGPT",
                clientKind: "chatgpt_app",
                status: "blocked",
                blockerCode: "missing_scope",
              },
            ],
          },
        ],
      }),
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
}

test.describe("ai connectors and sharing", () => {
  test("[ai connectors]: settings route renders deployment summary and empty-state", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/settings/ai-connectors");
    await appShell.assert.appIsReady();

    await page.getByTestId("settings-ai-connectors-page").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "AI Connectors" }).waitFor({ state: "visible" });
    await page.getByText("MCP endpoint").first().waitFor({ state: "visible" });
    await page.getByText("Readiness").first().waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-tab-connections").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-tab-tool-catalog").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-tab-connect").click();
    await page.getByRole("heading", { name: "ChatGPT / OpenAI Apps" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Claude.ai" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Claude Code" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Codex CLI / IDE" }).waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-tab-tool-catalog").click();
    const searchInstrumentsTool = page.getByRole("button", { name: /search_instruments/ });
    await searchInstrumentsTool.waitFor({ state: "visible" });
    await searchInstrumentsTool.getByText("Read portfolio data").waitFor({ state: "visible" });
    await searchInstrumentsTool.click();
    await page.getByText("includeInactive", { exact: true }).waitFor({ state: "visible" });
  });

  test("[admin mcp settings]: settings route renders deployment and policy controls", async ({
    appShell,
    page,
  }) => {
    await appShell.actions.navigateToRoute("/admin/settings?tab=mcp");
    await appShell.assert.appIsReady();

    await page.getByTestId("admin-settings-panel-mcp").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "MCP settings" }).waitFor({ state: "visible" });
    await page.getByText("MCP readiness").waitFor({ state: "visible" });
    await page.getByText("Audit impact").waitFor({ state: "visible" });
    await page.getByText("Client-kind allowlist").waitFor({ state: "visible" });
    await page.getByText("Claude.ai").first().waitFor({ state: "visible" });
    await page.getByText("Bearer fallback policy").waitFor({ state: "visible" });
    await page.getByText("MCP deployment").waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Tool groups" }).waitFor({ state: "visible" });
    await page.getByRole("heading", { name: "Redirect callbacks" }).waitFor({ state: "visible" });
    await page.getByText("Quick-add Claude.ai").waitFor({ state: "visible" });
    await page.getByText("Copy callback").first().waitFor({ state: "visible" });
    await page.getByTestId("admin-settings-panel-mcp")
      .getByText(/^Global AI connector policy\./)
      .waitFor({ state: "visible" });
    await page.getByText("Max active connectors").waitFor({ state: "visible" });
    await page.getByTestId("admin-settings-mcp-oauth-token-secret-row").waitFor({ state: "visible" });
  });

  test("[sharing]: grant dialog → Delegate manager preset checks delegated write capability", async ({
    appShell,
    page,
    sharing,
  }) => {
    await appShell.actions.navigateToRoute("/sharing");
    await appShell.assert.appIsReady();

    await sharing.actions.openGrantDialog();
    await page.getByText("Delegated permissions").waitFor({ state: "visible" });
    await page.getByText("ChatGPT portfolio read").waitFor({ state: "visible" });
    await page.getByText("Manage accounts and fee settings").waitFor({ state: "visible" });
    await page.getByText("Create AI drafts").waitFor({ state: "visible" });
    await page.getByText("Post, update, and delete confirmed transactions").waitFor({ state: "visible" });

    await page.getByRole("button", { name: "Delegate manager" }).click();

    const transactionWriteToggle = page.getByRole("checkbox", {
      name: "Post, update, and delete confirmed transactions",
    });
    await assertToggleChecked(transactionWriteToggle, "Transaction write");
  });

  test("[ai connectors]: History tab supports filtering, details, and remove controls when rows exist", async ({
    appShell,
    page,
  }) => {
    await mockAiConnectorApi(page);
    await appShell.actions.navigateToRoute("/settings/ai-connectors?section=history");
    await appShell.assert.appIsReady();

    await page.getByTestId("ai-connectors-tab-history").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-search").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-status-filter").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-client-filter").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-auth-filter").waitFor({ state: "visible" });
    await page.getByTestId("ai-connectors-history-ended-filter").waitFor({ state: "visible" });

    await page.getByTestId("ai-connectors-history-search").fill("Claude");
    await page.getByTestId("ai-connectors-history").getByText("Claude.ai Old").first().waitFor({ state: "visible" });
    await page.getByRole("button", { name: "Details" }).first().click();
    await page.getByRole("dialog").waitFor({ state: "visible" });
    await page.getByText("get_portfolio_report").waitFor({ state: "visible" });
    await page.getByRole("button", { name: "View all calls in Activity" }).click();
    await page.waitForURL(/section=activity/);

    await page.getByTestId("ai-connectors-tab-history").click();
    page.once("dialog", (dialog) => dialog.dismiss().catch(() => undefined));
    await page.getByRole("button", { name: "Remove from history" }).first().click();
    await page.getByRole("checkbox", { name: "Select visible history rows", exact: true }).click();
    page.once("dialog", (dialog) => dialog.dismiss().catch(() => undefined));
    await page.getByRole("button", { name: "Remove selected" }).click();
  });

  test("[ai connectors]: Permissions section shows identity headers or an active-empty state", async ({
    appShell,
    page,
  }) => {
    await mockAiConnectorApi(page);
    await appShell.actions.navigateToRoute("/settings/ai-connectors?section=permissions");
    await appShell.assert.appIsReady();

    await page.getByTestId("ai-connectors-tab-permissions").waitFor({ state: "visible" });
    const identityHeaders = page.getByTestId("ai-connectors-permission-identity-header");
    await identityHeaders.filter({ hasText: "ChatGPT" }).first().waitFor({ state: "visible" });
    await identityHeaders.filter({ hasText: "Claude.ai" }).first().waitFor({ state: "visible" });
    await identityHeaders.first().getByRole("button", { name: "Details" }).waitFor({ state: "visible" });
    await identityHeaders.first().getByRole("button", { name: "Back to connection" }).waitFor({ state: "visible" });
    await page.getByText("Research identities for Taiwan additive workflows").first().waitFor({ state: "visible" });
    await page.getByText("Reconnect this OAuth connector or recreate this bearer connector to add it.").first().waitFor({ state: "visible" });
  });
});
