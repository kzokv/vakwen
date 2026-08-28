import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DefaultMcpPolicyService,
  getMcpRateLimitBucketCountForTest,
  resetMcpRateLimitBucketsForTest,
} from "../../src/mcp/policy.js";
import type { McpAuthContext } from "../../src/mcp/types.js";

function authContext(): McpAuthContext {
  return {
    token: "vakwen-dev.test",
    clientId: "vakwen-dev-client",
    sessionUserId: "user-1",
    connection: { id: "conn-1", provider: "chatgpt" } as McpAuthContext["connection"],
    scopes: ["portfolio:mcp_read"],
    toolToggles: {},
    expiresAt: null,
    authMode: "dev_token",
  };
}


function fakeApp() {
  return {
    persistence: {
      listInboundSharesForGrantee: async () => ({
        active: [{ id: "share-1", ownerUserId: "owner-2" }],
        revoked: [],
      }),
      getShareCapabilities: async () => ["portfolio:mcp_read"],
      getAiConnectorPolicySettings: async () => ({
        enabled: true,
        maxActiveConnectionsPerUser: 3,
        allowedProviders: { chatgpt: true, self_hosted: true },
        groupToggles: { read: true, research: false, drafts: true, write: false },
        inactivityExpiryDays: 90,
        expirationWarningDays: 7,
        freshAuthMaxAgeMs: 600_000,
        maxConnectorLifetimeDays: 90,
        oauthPublicIssuer: null,
        oauthRedirectUriAllowlist: [],
        oauthTokenSecretSet: false,
        updatedAt: new Date(0).toISOString(),
      }),
    },
  };
}


function fakeAppWithGroupDisabled() {
  const app = fakeApp() as ReturnType<typeof fakeApp>;
  app.persistence.getAiConnectorPolicySettings = async () => ({
    enabled: true,
    maxActiveConnectionsPerUser: 3,
    allowedProviders: { chatgpt: true, self_hosted: true },
    groupToggles: { read: false, research: false, drafts: true, write: false },
    inactivityExpiryDays: 90,
    expirationWarningDays: 7,
    freshAuthMaxAgeMs: 600_000,
    maxConnectorLifetimeDays: 90,
    oauthPublicIssuer: null,
    oauthRedirectUriAllowlist: [],
    oauthTokenSecretSet: false,
    updatedAt: new Date(0).toISOString(),
  });
  return app;
}

describe("DefaultMcpPolicyService", () => {
  beforeEach(() => {
    resetMcpRateLimitBucketsForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    resetMcpRateLimitBucketsForTest();
  });

  it("rate limits reads by connector, user, IP, and portfolio context", async () => {
    const policy = new DefaultMcpPolicyService({ get_portfolio_overview: "portfolio:mcp_read" });
    const req = { ip: "127.0.0.1" };

    for (let index = 0; index < 120; index += 1) {
      await policy.assertToolAccess(
        fakeApp() as never,
        req as never,
        authContext(),
        "get_portfolio_overview",
        "read",
        "user-1",
      );
    }

    for (let index = 0; index < 120; index += 1) {
      await policy.assertToolAccess(
        fakeApp() as never,
        req as never,
        authContext(),
        "get_portfolio_overview",
        "read",
        "owner-2",
      );
    }

    await expect(policy.assertToolAccess(
      fakeApp() as never,
      req as never,
      authContext(),
      "get_portfolio_overview",
      "read",
      "owner-2",
    )).rejects.toMatchObject({ code: "mcp_rate_limited" });
  });

  it("prunes expired rate-limit buckets opportunistically", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-22T00:00:00.000Z"));
    const policy = new DefaultMcpPolicyService({ get_portfolio_overview: "portfolio:mcp_read" });

    for (let index = 0; index < 5; index += 1) {
      await policy.assertToolAccess(
        fakeApp() as never,
        { ip: `127.0.0.${index + 1}` } as never,
        authContext(),
        "get_portfolio_overview",
        "read",
        "user-1",
      );
    }
    expect(getMcpRateLimitBucketCountForTest()).toBe(5);

    vi.advanceTimersByTime(60_001);
    await policy.assertToolAccess(
      fakeApp() as never,
      { ip: "127.0.0.99" } as never,
      authContext(),
      "get_portfolio_overview",
      "read",
      "user-1",
    );

    expect(getMcpRateLimitBucketCountForTest()).toBe(1);
  });

  it("blocks a tool when the admin connector group is disabled", async () => {
    const policy = new DefaultMcpPolicyService({ get_portfolio_overview: "portfolio:mcp_read" });

    await expect(policy.assertToolAccess(
      fakeAppWithGroupDisabled() as never,
      { ip: "127.0.0.1" } as never,
      authContext(),
      "get_portfolio_overview",
      "read",
      "user-1",
    )).rejects.toMatchObject({ code: "mcp_tool_group_disabled" });
  });
});
