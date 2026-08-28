import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { McpAuthContext } from "../../src/mcp/types.js";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

function authContext(scopes: McpAuthContext["scopes"]): McpAuthContext {
  return {
    token: "vakwen-dev.test",
    clientId: "vakwen-dev-client",
    sessionUserId: "user-1",
    connection: { id: "conn-1", provider: "chatgpt" } as McpAuthContext["connection"],
    scopes,
    toolToggles: {},
    expiresAt: null,
    authMode: "dev_token",
  };
}

describe("DefaultMcpPolicyService research search path", () => {
  beforeEach(() => {
    setResearchRolloutOverrideForTest({ mcpExposureEnabled: true });
  });

  afterEach(() => {
    setResearchRolloutOverrideForTest(null);
  });

  it("denies research-only search when the research tool group is disabled even if read stays enabled", async () => {
    const { DefaultMcpPolicyService } = await import("../../src/mcp/policy.js");
    const policy = new DefaultMcpPolicyService({ search_instruments: "portfolio:mcp_read" });
    const app = {
      persistence: {
        getAiConnectorPolicySettings: async () => ({
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
          groupToggles: { read: true, research: false, drafts: true, write: false },
          bearerFallback: {
            enabled: true,
            allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
            maxLifetimeDays: 30,
            maxActiveConnectorsPerUser: 3,
            allowedToolGroups: ["read", "research"],
          },
          inactivityExpiryDays: 90,
          expirationWarningDays: 7,
          freshAuthMaxAgeMs: 600_000,
          maxConnectorLifetimeDays: 90,
          oauthPublicIssuer: null,
          oauthRedirectUriAllowlist: [],
          oauthTokenSecretSet: false,
          updatedAt: new Date(0).toISOString(),
          postedTransactionMutationBatchLimit: 50,
        }),
        listInboundSharesForGrantee: async () => ({ active: [], revoked: [] }),
      },
    };

    await expect(policy.assertToolAccess(
      app as never,
      { ip: "127.0.0.1" } as never,
      authContext(["research:read"]),
      "search_instruments",
      "read",
      "user-1",
    )).rejects.toMatchObject({ code: "mcp_tool_group_disabled" });
  });

  it("allows combined search scope to fall back to research when the read group is disabled", async () => {
    const { DefaultMcpPolicyService } = await import("../../src/mcp/policy.js");
    const policy = new DefaultMcpPolicyService({ search_instruments: "portfolio:mcp_read" });
    const app = {
      persistence: {
        getAiConnectorPolicySettings: async () => ({
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
          groupToggles: { read: false, research: true, drafts: true, write: false },
          bearerFallback: {
            enabled: true,
            allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
            maxLifetimeDays: 30,
            maxActiveConnectorsPerUser: 3,
            allowedToolGroups: ["read", "research"],
          },
          inactivityExpiryDays: 90,
          expirationWarningDays: 7,
          freshAuthMaxAgeMs: 600_000,
          maxConnectorLifetimeDays: 90,
          oauthPublicIssuer: null,
          oauthRedirectUriAllowlist: [],
          oauthTokenSecretSet: false,
          updatedAt: new Date(0).toISOString(),
          postedTransactionMutationBatchLimit: 50,
        }),
        listInboundSharesForGrantee: async () => ({ active: [], revoked: [] }),
      },
    };

    await expect(policy.assertToolAccess(
      app as never,
      { ip: "127.0.0.1" } as never,
      authContext(["portfolio:mcp_read", "research:read"]),
      "search_instruments",
      "read",
      "user-1",
    )).resolves.toMatchObject({
      portfolioContextUserId: "user-1",
      sessionUserId: "user-1",
    });
  });

  it("allows bearer search scope to fall back to research when bearer read access is disabled", async () => {
    const { DefaultMcpPolicyService } = await import("../../src/mcp/policy.js");
    const policy = new DefaultMcpPolicyService({ search_instruments: "portfolio:mcp_read" });
    const app = {
      persistence: {
        getAiConnectorPolicySettings: async () => ({
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
          groupToggles: { read: false, research: true, drafts: true, write: false },
          bearerFallback: {
            enabled: true,
            allowedClientKinds: ["claude_code", "codex_cli", "gemini_cli", "copilot_mcp", "generic_mcp"],
            maxLifetimeDays: 30,
            maxActiveConnectorsPerUser: 3,
            allowedToolGroups: ["research"],
          },
          inactivityExpiryDays: 90,
          expirationWarningDays: 7,
          freshAuthMaxAgeMs: 600_000,
          maxConnectorLifetimeDays: 90,
          oauthPublicIssuer: null,
          oauthRedirectUriAllowlist: [],
          oauthTokenSecretSet: false,
          updatedAt: new Date(0).toISOString(),
          postedTransactionMutationBatchLimit: 50,
        }),
        listInboundSharesForGrantee: async () => ({ active: [], revoked: [] }),
      },
    };

    await expect(policy.assertToolAccess(
      app as never,
      { ip: "127.0.0.1" } as never,
      {
        ...authContext(["portfolio:mcp_read", "research:read"]),
        authMode: "bearer",
      },
      "search_instruments",
      "read",
      "user-1",
    )).resolves.toMatchObject({
      portfolioContextUserId: "user-1",
      sessionUserId: "user-1",
    });
  });
});
