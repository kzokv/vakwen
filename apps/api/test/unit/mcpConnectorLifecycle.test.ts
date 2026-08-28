import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import {
  defaultClientCapabilities,
  getMcpClientByKind,
  getMcpClientByLegacyProvider,
  legacyProviderForClientKind,
  MCP_CLIENT_REGISTRY,
} from "../../src/mcp/clientRegistry.js";
import {
  createAiConnectorBearerFallback,
  hashGeneratedBearerToken,
  isGeneratedBearerToken,
  createAiConnectorConnection,
  toAiConnectorPolicySettingsDto,
} from "../../src/services/mcpConnectorLifecycle.js";
import {
  researchAcquisitionEnabled,
  researchMcpExposureEnabled,
  researchSkillExposureEnabled,
  setResearchRolloutOverrideForTest,
} from "../../src/mcp/tools.js";

let app: Awaited<ReturnType<typeof buildApp>>;

describe("MCP connector registry and lifecycle", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest(null);
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    await app.close();
    setResearchRolloutOverrideForTest(null);
  });

  it("maps supported client kinds and legacy providers through the shared registry", () => {
    expect(MCP_CLIENT_REGISTRY.map((client) => client.clientKind)).toEqual([
      "chatgpt_app",
      "claude_ai_connector",
      "claude_code",
      "codex_cli",
      "gemini_cli",
      "copilot_mcp",
      "generic_mcp",
    ]);
    expect(getMcpClientByKind("chatgpt_app")).toMatchObject({
      vendor: "openai",
      legacyProvider: "chatgpt",
      supportedAuthModes: ["oauth"],
      capabilities: ["oauth", "widgets", "interactive_ops", "deep_link_fallback"],
    });
    expect(getMcpClientByLegacyProvider("chatgpt").clientKind).toBe("chatgpt_app");
    expect(getMcpClientByLegacyProvider("self_hosted").clientKind).toBe("generic_mcp");
    expect(legacyProviderForClientKind("claude_code")).toBe("self_hosted");
    expect(defaultClientCapabilities("codex_cli")).toEqual(["bearer_fallback", "deep_link_fallback"]);
  });

  it("builds policy DTO readiness from client-kind policy and deployment state", async () => {
    const settings = await app.persistence.saveAiConnectorPolicySettings({
      enabled: false,
      oauthPublicIssuer: "https://vakwen.example.com",
      allowedClientKinds: {
        chatgpt_app: false,
        claude_ai_connector: false,
        claude_code: false,
        codex_cli: false,
        gemini_cli: false,
        copilot_mcp: false,
        generic_mcp: false,
      },
      groupToggles: { read: false, research: false, drafts: false, write: false },
      bearerFallback: { enabled: true },
    });
    const dto = toAiConnectorPolicySettingsDto(settings);

    expect(dto.readiness).toMatchObject({
      status: "disabled",
      endpoint: "https://vakwen.example.com/mcp",
      deploymentEnabled: false,
      publicIssuerConfigured: true,
      enabledClientKindCount: 0,
      totalClientKindCount: 7,
      highRiskToolsEnabled: false,
      bearerFallbackEnabled: true,
    });
    expect(dto.readiness.checks).toEqual(
      expect.arrayContaining([
        { key: "deployment", status: "blocked" },
        { key: "client_kind_policy", status: "blocked" },
        { key: "bearer_fallback", status: "warning" },
      ]),
    );
  });

  it("creates scoped bearer fallback connector instances and stores only token hashes", async () => {
    const authUser = await app.persistence.resolveOrCreateUser("google", "mcp-unit-user", {
      email: "mcp-unit-user@example.com",
      name: "MCP Unit User",
    });
    await app.persistence.saveAiConnectorPolicySettings({
      maxConnectorLifetimeDays: 10,
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["claude_code"],
        maxLifetimeDays: 5,
        maxActiveConnectorsPerUser: 1,
        allowedToolGroups: ["read"],
      },
    });

    const result = await createAiConnectorBearerFallback(
      app,
      {
        userId: authUser.userId,
        clientKind: "claude_code",
        displayName: "Claude Code laptop",
        scopes: ["portfolio:mcp_read", "transaction:write"],
        lifetimeDays: 90,
      },
      { actorUserId: authUser.userId, ipAddress: "127.0.0.1" },
    );

    expect(result.connection).toMatchObject({
      provider: "self_hosted",
      vendor: "anthropic",
      clientKind: "claude_code",
      authMode: "bearer",
      displayName: "Claude Code laptop",
      scopes: ["portfolio:mcp_read"],
    });
    expect(result.connection.capabilities).toEqual(["bearer_fallback", "deep_link_fallback"]);
    expect(isGeneratedBearerToken(result.bearerToken)).toBe(true);
    expect(result.tokenHint).toBe(result.bearerToken.slice(-8));
    const lifetimeMs = Date.parse(result.expiresAt) - Date.now();
    expect(lifetimeMs).toBeGreaterThan(4 * 24 * 60 * 60 * 1000);
    expect(lifetimeMs).toBeLessThanOrEqual(5 * 24 * 60 * 60 * 1000);

    const credential = await app.persistence.getAiConnectorCredentialByHash(hashGeneratedBearerToken(result.bearerToken));
    expect(credential).toMatchObject({
      connectionId: result.connection.id,
      credentialType: "bearer_token",
      tokenHint: result.tokenHint,
      scopes: ["portfolio:mcp_read"],
    });
  });

  it("does not mint research:read on new OAuth-style connector creation when research acquisition is disabled", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: false,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    const authUser = await app.persistence.resolveOrCreateUser("google", "mcp-unit-oauth-user", {
      email: "mcp-unit-oauth-user@example.com",
      name: "MCP Unit OAuth User",
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { read: true, research: true },
    });

    const connection = await createAiConnectorConnection(
      app,
      {
        userId: authUser.userId,
        provider: "chatgpt",
        vendor: "openai",
        clientKind: "chatgpt_app",
        authMode: "oauth",
        capabilities: ["oauth", "widgets", "interactive_ops", "deep_link_fallback"],
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "research:read"],
        oauthClientId: "chatgpt",
        oauthSubject: "oauth-user-1",
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      },
      { actorUserId: authUser.userId, ipAddress: "127.0.0.1" },
    );

    expect(connection.scopes).toEqual(["portfolio:mcp_read"]);
  });

  it("does not mint research:read on new bearer connectors when research MCP exposure is disabled", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: false,
      skillExposureEnabled: false,
    });
    const authUser = await app.persistence.resolveOrCreateUser("google", "mcp-unit-research-bearer-user", {
      email: "mcp-unit-research-bearer-user@example.com",
      name: "MCP Unit Research Bearer User",
    });
    await app.persistence.saveAiConnectorPolicySettings({
      maxConnectorLifetimeDays: 10,
      groupToggles: { read: true, research: true },
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["claude_code"],
        maxLifetimeDays: 5,
        maxActiveConnectorsPerUser: 1,
        allowedToolGroups: ["read", "research"],
      },
    });

    const result = await createAiConnectorBearerFallback(
      app,
      {
        userId: authUser.userId,
        clientKind: "claude_code",
        displayName: "Claude Code laptop",
        scopes: ["portfolio:mcp_read", "research:read"],
        lifetimeDays: 90,
      },
      { actorUserId: authUser.userId, ipAddress: "127.0.0.1" },
    );

    expect(result.connection.scopes).toEqual(["portfolio:mcp_read"]);
    const credential = await app.persistence.getAiConnectorCredentialByHash(hashGeneratedBearerToken(result.bearerToken));
    expect(credential?.scopes).toEqual(["portfolio:mcp_read"]);
  });

  it("keeps the three research rollout helpers independent and defaulted off", () => {
    setResearchRolloutOverrideForTest(null);
    expect(researchAcquisitionEnabled()).toBe(false);
    expect(researchMcpExposureEnabled()).toBe(false);
    expect(researchSkillExposureEnabled()).toBe(false);

    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    expect(researchAcquisitionEnabled()).toBe(true);
    expect(researchMcpExposureEnabled()).toBe(false);
    expect(researchSkillExposureEnabled()).toBe(false);

    setResearchRolloutOverrideForTest({ mcpExposureEnabled: true });
    expect(researchAcquisitionEnabled()).toBe(false);
    expect(researchMcpExposureEnabled()).toBe(true);
    expect(researchSkillExposureEnabled()).toBe(false);

    setResearchRolloutOverrideForTest({ skillExposureEnabled: true });
    expect(researchAcquisitionEnabled()).toBe(false);
    expect(researchMcpExposureEnabled()).toBe(false);
    expect(researchSkillExposureEnabled()).toBe(true);
  });

  it("rejects duplicate active bearer fallback connectors for the same client identity", async () => {
    const authUser = await app.persistence.resolveOrCreateUser("google", "mcp-duplicate-bearer-user", {
      email: "mcp-duplicate-bearer-user@example.com",
      name: "MCP Duplicate Bearer User",
    });
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        maxActiveConnectorsPerUser: 2,
        allowedToolGroups: ["read"],
      },
    });

    await createAiConnectorBearerFallback(
      app,
      {
        userId: authUser.userId,
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
      { actorUserId: authUser.userId, ipAddress: "127.0.0.1" },
    );

    await expect(createAiConnectorBearerFallback(
      app,
      {
        userId: authUser.userId,
        clientKind: "codex_cli",
        displayName: "Codex CLI second device",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
      { actorUserId: authUser.userId, ipAddress: "127.0.0.1" },
    )).rejects.toMatchObject({
      statusCode: 409,
      code: "mcp_bearer_connection_exists",
    });
  });

  it("filters connector access logs by result, connection, search, and pagination", async () => {
    const authUser = await app.persistence.resolveOrCreateUser("google", "mcp-log-user", {
      email: "mcp-log-user@example.com",
      name: "MCP Log User",
    });
    const connection = await app.persistence.saveAiConnectorConnection({
      id: "mcp-log-connection",
      userId: authUser.userId,
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
    });
    await app.persistence.appendAiConnectorAccessLog({
      connectionId: connection.id,
      userId: authUser.userId,
      portfolioContextUserId: authUser.userId,
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
      createdAt: "2026-06-27T00:00:03.000Z",
    });
    await app.persistence.appendAiConnectorAccessLog({
      connectionId: connection.id,
      userId: authUser.userId,
      portfolioContextUserId: authUser.userId,
      toolName: "post_transaction_draft_rows",
      accessKind: "write",
      result: "denied",
      denialReason: "scope missing",
      createdAt: "2026-06-27T00:00:02.000Z",
    });
    await app.persistence.appendAiConnectorAccessLog({
      connectionId: null,
      userId: authUser.userId,
      portfolioContextUserId: authUser.userId,
      toolName: "admin_market_calendar_preview",
      accessKind: "write",
      result: "error",
      createdAt: "2026-06-27T00:00:01.000Z",
    });

    const denied = await app.persistence.listAiConnectorAccessLogsForUser(authUser.userId, { result: "denied" });
    expect(denied.map((log) => log.toolName)).toEqual(["post_transaction_draft_rows"]);

    const searched = await app.persistence.listAiConnectorAccessLogsForUser(authUser.userId, { search: "scope" });
    expect(searched.map((log) => log.result)).toEqual(["denied"]);

    const connectedOnly = await app.persistence.listAiConnectorAccessLogsForUser(authUser.userId, {
      connectionIds: [connection.id],
      limit: 1,
      offset: 1,
    });
    expect(connectedOnly.map((log) => log.toolName)).toEqual(["post_transaction_draft_rows"]);
  });
});
