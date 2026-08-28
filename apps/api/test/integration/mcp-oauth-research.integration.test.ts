import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "dev_bypass" as const,
    },
  };
});

import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;
const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-at-least-32-chars",
};
const mcpOAuthTokenSecret = "test-mcp-oauth-token-secret-that-is-long-enough";

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

describe("MCP OAuth research scope", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: true,
    });
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
    await app.persistence.setAppConfigEncryptedSecret("mcpOauthTokenSecret", mcpOAuthTokenSecret);
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: {
        research: true,
      },
    });
  });

  afterEach(async () => {
    setResearchRolloutOverrideForTest(null);
    await app.close();
  });

  it("preserves an explicit research-only scope request through consent and persisted connection scopes", async () => {
    const verifier = "research-only-verifier-1234567890123456789012345678901234567";
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "http://localhost:5555/callback",
        resource: "http://localhost:4000/mcp",
        scope: "research:read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
        state: "state-123",
      }).toString()}`,
      headers: {
        host: "localhost:4000",
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      },
    });

    expect(authorize.statusCode).toBe(302);
    const requestId = new URL(String(authorize.headers.location), "http://localhost:3000").searchParams.get("requestId");
    expect(requestId).toBeTruthy();

    const authHeaders = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
    };
    const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}`, headers: authHeaders });
    expect(consent.statusCode).toBe(200);
    const consentBody = consent.json<{ csrfToken: string; scopes: string[] }>();
    expect(consentBody.scopes).toEqual(["research:read"]);

    const approved = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: authHeaders,
      payload: {
        csrfToken: consentBody.csrfToken,
        scopes: ["research:read"],
        lifetimeDays: 7,
      },
    });
    expect(approved.statusCode).toBe(200);

    const connections = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connections).toHaveLength(1);
    expect(connections[0]?.scopes).toEqual(["research:read"]);
  });

  it("uses research:read as the default OAuth scope when research is the only enabled read path", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { read: false, research: true },
    });
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "http://localhost:5555/callback",
        resource: "http://localhost:4000/mcp",
        code_challenge: codeChallenge("research-default-verifier-123456789012345678901234567890123"),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });

    expect(authorize.statusCode).toBe(302);
    const requestId = new URL(String(authorize.headers.location), "http://localhost:3000").searchParams.get("requestId");
    const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}` });
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({ scopes: ["research:read"] });
  });

  it("does not advertise research:read until acquisition is also enabled", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: false,
      mcpExposureEnabled: true,
      skillExposureEnabled: true,
    });

    const [authorizationServer, protectedResource] = await Promise.all([
      app.inject({ method: "GET", url: "/.well-known/oauth-authorization-server", headers: { host: "localhost:4000" } }),
      app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource", headers: { host: "localhost:4000" } }),
    ]);

    expect(authorizationServer.statusCode).toBe(200);
    expect(authorizationServer.json<{ scopes_supported: string[] }>().scopes_supported).not.toContain("research:read");
    expect(protectedResource.statusCode).toBe(200);
    expect(protectedResource.json<{ scopes_supported: string[] }>().scopes_supported).not.toContain("research:read");
  });
});
