import {
  createHash,
  generateKeyPairSync,
  sign as signCrypto,
} from "node:crypto";
import type { KeyObject } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
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

import { buildApp } from "../../src/app.js";
import {
  hashMcpOAuthToken,
  setMcpOAuthClientMetadataNetworkForTest,
} from "../../src/mcp/oauth.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

let app: Awaited<ReturnType<typeof buildApp>>;
let resetClientMetadataNetwork: (() => void) | null = null;

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-at-least-32-chars",
};
const mcpOAuthTokenSecret = "test-mcp-oauth-token-secret-that-is-long-enough";
const clientAssertionType = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";
const advertisedMcpScopes = [
  "portfolio:mcp_read",
  "account:manage",
  "transaction_draft:create",
  "transaction_draft:edit",
  "transaction_draft:archive",
  "transaction_draft:delete",
  "transaction:write",
  "dividend:write",
];

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function form(body: Record<string, string>): string {
  return new URLSearchParams(body).toString();
}

async function resolveOAuthRedirectBridgeWithOrigin(
  redirectUrl: string,
  expectedOrigin = "http://localhost:4000",
  host = "localhost:4000",
): Promise<URL> {
  const bridge = new URL(redirectUrl);
  expect(bridge.origin + bridge.pathname).toBe(`${expectedOrigin}/oauth/redirect`);
  expect(bridge.searchParams.get("payload")).toBeTruthy();
  const response = await app.inject({
    method: "GET",
    url: `${bridge.pathname}${bridge.search}`,
    headers: { host },
  });
  expect(response.statusCode).toBe(302);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers.pragma).toBe("no-cache");
  return new URL(String(response.headers.location));
}

async function resolveOAuthRedirectBridge(redirectUrl: string): Promise<URL> {
  return resolveOAuthRedirectBridgeWithOrigin(redirectUrl);
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signClientAssertion(input: {
  clientId: string;
  tokenEndpoint: string;
  privateKey: KeyObject;
  kid?: string;
  subject?: string;
  audience?: string;
  expiresAt?: number;
  issuedAt?: number;
  notBefore?: number;
}): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: input.clientId,
    sub: input.subject ?? input.clientId,
    aud: input.audience ?? input.tokenEndpoint,
    iat: input.issuedAt ?? nowSeconds,
    exp: input.expiresAt ?? nowSeconds + 300,
    jti: "client-assertion-jti",
  };
  if (input.notBefore !== undefined) payload.nbf = input.notBefore;
  const encodedHeader = base64UrlJson({
    alg: "RS256",
    typ: "JWT",
    kid: input.kid ?? "test-key",
  });
  const encodedPayload = base64UrlJson(payload);
  const signature = signCrypto(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`, "utf8"),
    input.privateKey,
  ).toString("base64url");
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";
if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}
const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;
const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

async function createAuthorizationRequest(input: {
  headers: Record<string, string>;
  resource: string;
  verifier: string;
  redirectUri: string;
  scope?: string;
}) {
  const authorize = await app.inject({
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: "chatgpt",
      redirect_uri: input.redirectUri,
      resource: input.resource,
      scope: input.scope ?? "portfolio:mcp_read",
      code_challenge: codeChallenge(input.verifier),
      code_challenge_method: "S256",
      state: "state-123",
    }).toString()}`,
    headers: input.headers,
  });
  expect(authorize.statusCode).toBe(302);
  const requestId = new URL(String(authorize.headers.location)).searchParams.get("requestId");
  expect(requestId).toBeTruthy();
  const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}` });
  expect(consent.statusCode).toBe(200);
  const consentBody = consent.json<{ csrfToken: string; scopes: string[] }>();
  return { requestId: String(requestId), csrfToken: consentBody.csrfToken, scopes: consentBody.scopes };
}

describe("MCP OAuth for ChatGPT", () => {
  beforeEach(async () => {
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: testOAuthConfig,
      appBaseUrl: "http://localhost:3000",
    });
    await app.persistence.setAppConfigEncryptedSecret(
      "mcpOauthTokenSecret",
      mcpOAuthTokenSecret,
    );
  });

  afterEach(async () => {
    resetClientMetadataNetwork?.();
    resetClientMetadataNetwork = null;
    await app.close();
  });

  it("advertises OAuth metadata and completes authorization-code plus refresh rotation", async () => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    await app.persistence.saveAiConnectorConnection({
      id: "old-chatgpt-connection",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const authorizationServer = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
      headers,
    });
    expect(authorizationServer.statusCode).toBe(200);
    expect(authorizationServer.json()).toMatchObject({
      issuer: "http://localhost:4000",
      authorization_endpoint: "http://localhost:4000/oauth/authorize",
      token_endpoint: "http://localhost:4000/oauth/token",
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
      token_endpoint_auth_signing_alg_values_supported: ["RS256"],
      client_id_metadata_document_supported: true,
      scopes_supported: advertisedMcpScopes,
    });
    expect(authorizationServer.json()).not.toHaveProperty("authorization_response_iss_parameter_supported");
    const pathScopedAuthorizationServer = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server/mcp",
      headers,
    });
    expect(pathScopedAuthorizationServer.statusCode).toBe(200);
    expect(pathScopedAuthorizationServer.json()).toMatchObject({
      issuer: "http://localhost:4000",
      client_id_metadata_document_supported: true,
    });
    const openIdConfiguration = await app.inject({
      method: "GET",
      url: "/.well-known/openid-configuration",
      headers,
    });
    expect(openIdConfiguration.statusCode).toBe(200);
    expect(openIdConfiguration.json()).toMatchObject({
      issuer: "http://localhost:4000",
      token_endpoint: "http://localhost:4000/oauth/token",
      client_id_metadata_document_supported: true,
    });
    const pathScopedOpenIdConfiguration = await app.inject({
      method: "GET",
      url: "/.well-known/openid-configuration/mcp",
      headers,
    });
    expect(pathScopedOpenIdConfiguration.statusCode).toBe(200);
    expect(pathScopedOpenIdConfiguration.json()).toMatchObject({
      issuer: "http://localhost:4000",
      authorization_endpoint: "http://localhost:4000/oauth/authorize",
    });

    const mcpPreflight = await app.inject({
      method: "OPTIONS",
      url: "/mcp",
      headers: {
        origin: "https://chatgpt.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,mcp-session-id",
      },
    });
    expect(mcpPreflight.statusCode).toBe(204);
    expect(mcpPreflight.headers["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(mcpPreflight.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(mcpPreflight.headers["access-control-allow-methods"]).toContain("POST");

    const tokenPreflight = await app.inject({
      method: "OPTIONS",
      url: "/oauth/token",
      headers: {
        origin: "https://chatgpt.com",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type,authorization",
      },
    });
    expect(tokenPreflight.statusCode).toBe(204);
    expect(tokenPreflight.headers["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(tokenPreflight.headers["access-control-allow-credentials"]).toBeUndefined();

    const protectedResource = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource",
      headers,
    });
    expect(protectedResource.statusCode).toBe(200);
    expect(protectedResource.json()).toMatchObject({
      resource,
      authorization_servers: ["http://localhost:4000"],
      scopes_supported: advertisedMcpScopes,
    });
    const pathScopedProtectedResource = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp",
      headers,
    });
    expect(pathScopedProtectedResource.statusCode).toBe(200);
    expect(pathScopedProtectedResource.json()).toMatchObject({
      resource,
      authorization_servers: ["http://localhost:4000"],
    });

    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: redirectUri,
        resource,
        scope: "portfolio:mcp_read transaction_draft:create",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
        state: "state-123",
      }).toString()}`,
      headers,
    });
    expect(authorize.statusCode).toBe(302);
    expect(authorize.headers["cache-control"]).toBe("no-store");
    expect(authorize.headers.pragma).toBe("no-cache");
    const consentLocation = authorize.headers.location;
    expect(consentLocation).toContain("http://localhost:3000/connectors/chatgpt/authorize?requestId=");
    const requestId = new URL(String(consentLocation)).searchParams.get("requestId");
    expect(requestId).toBeTruthy();

    const consent = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
    });
    expect(consent.statusCode).toBe(200);
    expect(consent.headers["cache-control"]).toBe("no-store");
    expect(consent.headers.pragma).toBe("no-cache");
    const consentBody = consent.json<{
      csrfToken: string;
      scopes: string[];
      policy: { maxConnectorLifetimeDays: number };
    }>();
    expect(consentBody.scopes).toEqual(["portfolio:mcp_read", "transaction_draft:create"]);
    expect(consentBody.policy.maxConnectorLifetimeDays).toBe(90);

    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: {
        csrfToken: consentBody.csrfToken,
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.headers["cache-control"]).toBe("no-store");
    expect(approve.headers.pragma).toBe("no-cache");
    const approveRedirect = approve.json<{ redirectUrl: string }>().redirectUrl;
    const callback = await resolveOAuthRedirectBridge(approveRedirect);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("state-123");
    expect(callback.searchParams.has("iss")).toBe(false);
    const code = callback.searchParams.get("code");
    expect(code).toBeTruthy();
    const connectionsAfterApproval = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connectionsAfterApproval.find((connection) => connection.id === "old-chatgpt-connection")).toMatchObject({
      status: "active",
    });
    const pendingConnection = connectionsAfterApproval.find((connection) => connection.id !== "old-chatgpt-connection");
    expect(pendingConnection).toMatchObject({
      provider: "chatgpt",
      vendor: "openai",
      clientKind: "chatgpt_app",
      authMode: "oauth",
      capabilities: ["deep_link_fallback", "interactive_ops", "oauth", "widgets"],
      status: "pending",
      scopes: ["portfolio:mcp_read"],
    });

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: "chatgpt",
        code_verifier: verifier,
        resource,
      }),
    });
    expect(token.statusCode).toBe(200);
    expect(token.headers["cache-control"]).toBe("no-store");
    expect(token.headers.pragma).toBe("no-cache");
    const tokenBody = token.json<{ access_token: string; refresh_token: string; scope: string }>();
    expect(tokenBody.access_token.split(".")).toHaveLength(3);
    expect(tokenBody.scope).toBe("portfolio:mcp_read");
    const connectionsAfterToken = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connectionsAfterToken.find((connection) => connection.id === pendingConnection?.id)).toMatchObject({
      vendor: "openai",
      clientKind: "chatgpt_app",
      authMode: "oauth",
      status: "active",
    });
    expect(connectionsAfterToken.find((connection) => connection.id === "old-chatgpt-connection")).toMatchObject({
      status: "revoked",
      revocationReason: "replaced_by_oauth_authorization",
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${pendingConnection?.id}`,
      payload: {
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
      },
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json()).toMatchObject({
      error: "mcp_oauth_scope_expansion_requires_reconnect",
    });

    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/json, text/event-stream",
        ...headers,
      },
      payload: {
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "ChatGPT", version: "1.0.0" },
        },
      },
    });
    expect(initialize.statusCode).toBe(200);
    const sessionId = initialize.headers["mcp-session-id"];
    expect(typeof sessionId).toBe("string");

    const oldTokenDraftCall = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${tokenBody.access_token}`,
        accept: "application/json, text/event-stream",
        "mcp-session-id": String(sessionId),
        ...headers,
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "create_transaction_draft_batch",
          arguments: {
            candidates: [
              {
                rowNumber: 1,
                type: "BUY",
                ticker: "2330",
                marketCode: "TW",
                quantity: 1,
                unitPrice: 100,
                priceCurrency: "TWD",
                tradeDate: "2026-01-01",
              },
            ],
          },
        },
      },
    });
    expect(oldTokenDraftCall.statusCode).toBe(200);
    expect(oldTokenDraftCall.body).toContain("MCP scope transaction_draft:create is not enabled");

    const replay = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: "chatgpt",
        code_verifier: verifier,
        resource,
      }),
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toMatchObject({ error: "invalid_grant" });

    const refreshed = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
        client_id: "chatgpt",
        resource,
      }),
    });
    expect(refreshed.statusCode).toBe(200);
    const refreshedBody = refreshed.json<{ refresh_token: string }>();
    expect(refreshedBody.refresh_token).not.toBe(tokenBody.refresh_token);

    const reuse = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
        client_id: "chatgpt",
        resource,
      }),
    });
    expect(reuse.statusCode).toBe(400);
    expect(reuse.json()).toMatchObject({ error: "invalid_grant" });
    const [connection] = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connection).toMatchObject({ status: "revoked", revocationReason: "refresh_token_reuse" });
  });

  it("advertises and returns the OAuth authorization response issuer for HTTPS ChatGPT callbacks", async () => {
    const issuer = "https://vakwen-dev-api.kzokvdevs.dpdns.org";
    const host = "vakwen-dev-api.kzokvdevs.dpdns.org";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "https://chatgpt.com/connector/oauth/callback-id";
    await app.persistence.saveAiConnectorPolicySettings({ oauthPublicIssuer: issuer });

    const authorizationServer = await app.inject({
      method: "GET",
      url: "/.well-known/oauth-authorization-server",
      headers: { host },
    });
    expect(authorizationServer.statusCode).toBe(200);
    expect(authorizationServer.json()).toMatchObject({
      issuer,
      authorization_response_iss_parameter_supported: true,
    });

    const { requestId, csrfToken } = await createAuthorizationRequest({
      headers: { host },
      resource: `${issuer}/mcp`,
      verifier,
      redirectUri,
    });
    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host },
      payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const callback = await resolveOAuthRedirectBridgeWithOrigin(
      approve.json<{ redirectUrl: string }>().redirectUrl,
      issuer,
      host,
    );
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get("state")).toBe("state-123");
    expect(callback.searchParams.get("iss")).toBe(issuer);
    expect(callback.searchParams.get("code")).toBeTruthy();

    const denied = await createAuthorizationRequest({
      headers: { host },
      resource: `${issuer}/mcp`,
      verifier,
      redirectUri,
    });
    const deny = await app.inject({
      method: "POST",
      url: `/oauth/consent/${denied.requestId}/deny`,
      headers: { host },
      payload: { csrfToken: denied.csrfToken },
    });
    expect(deny.statusCode).toBe(200);
    const deniedCallback = await resolveOAuthRedirectBridgeWithOrigin(
      deny.json<{ redirectUrl: string }>().redirectUrl,
      issuer,
      host,
    );
    expect(deniedCallback.origin + deniedCallback.pathname).toBe(redirectUri);
    expect(deniedCallback.searchParams.get("error")).toBe("access_denied");
    expect(deniedCallback.searchParams.get("state")).toBe("state-123");
    expect(deniedCallback.searchParams.get("iss")).toBe(issuer);
  });

  it("accepts token exchanges with extra parameters and stored resource bindings", async () => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    const { requestId, csrfToken } = await createAuthorizationRequest({
      headers,
      resource,
      verifier,
      redirectUri,
    });
    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    expect(approveRedirect.searchParams.has("iss")).toBe(false);
    const code = approveRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        client_id: "chatgpt",
        code_verifier: verifier,
        scope: "portfolio:mcp_read transaction:write",
        audience: resource,
      }),
    });
    expect(token.statusCode, token.body).toBe(200);
    expect(token.json<{ scope: string }>().scope).toBe("portfolio:mcp_read");
    const [connection] = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connection).toMatchObject({ status: "active" });

    const refreshed = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "refresh_token",
        refresh_token: token.json<{ refresh_token: string }>().refresh_token,
        client_id: "chatgpt",
        scope: "portfolio:mcp_read",
      }),
    });
    expect(refreshed.statusCode, refreshed.body).toBe(200);
    const refreshedCredential = await app.persistence.getAiConnectorCredentialByHash(
      hashMcpOAuthToken(mcpOAuthTokenSecret, refreshed.json<{ refresh_token: string }>().refresh_token),
    );
    expect(refreshedCredential?.resource).toBe(resource);
  });

  it("enforces the active connection cap when ChatGPT exchanges the authorization code", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 1 });
    await app.persistence.saveAiConnectorConnection({
      id: "self-hosted-connection",
      userId: "user-1",
      provider: "self_hosted",
      displayName: "Self-hosted",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    const { requestId, csrfToken } = await createAuthorizationRequest({
      headers,
      resource,
      verifier,
      redirectUri,
    });
    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    expect(approveRedirect.searchParams.has("iss")).toBe(false);
    const code = approveRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: "chatgpt",
        code_verifier: verifier,
        resource,
      }),
    });
    expect(token.statusCode).toBe(400);
    expect(token.json()).toMatchObject({ error: "invalid_grant" });
  });

  it("keeps OAuth connector lifetime immutable through user settings patches", async () => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    const { requestId, csrfToken } = await createAuthorizationRequest({
      headers,
      resource,
      verifier,
      redirectUri,
    });
    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    expect(approveRedirect.searchParams.has("iss")).toBe(false);
    const code = approveRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: "chatgpt",
        code_verifier: verifier,
        resource,
      }),
    });
    expect(token.statusCode).toBe(200);
    const tokenBody = token.json<{ refresh_token: string }>();
    const [connection] = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connection?.oauthClientId).toBe("chatgpt");
    const originalExpiresAt = connection.expiresAt;
    expect(originalExpiresAt).toBeTruthy();

    for (const expiresAt of [
      null,
      new Date(Date.parse(String(originalExpiresAt)) + 86_400_000).toISOString(),
    ]) {
      const patched = await app.inject({
        method: "PATCH",
        url: `/ai/connectors/${connection.id}`,
        payload: { expiresAt },
      });
      expect(patched.statusCode).toBe(400);
      expect(patched.json()).toMatchObject({ error: "mcp_oauth_connector_lifetime_immutable" });
    }

    const current = await app.persistence.getAiConnectorConnection(connection.id);
    expect(current?.expiresAt).toBe(originalExpiresAt);

    const refreshed = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
      payload: form({
        grant_type: "refresh_token",
        refresh_token: tokenBody.refresh_token,
        client_id: "chatgpt",
        resource,
      }),
    });
    expect(refreshed.statusCode).toBe(200);
    const refreshedBody = refreshed.json<{ refresh_token: string }>();
    const refreshedCredential = await app.persistence.getAiConnectorCredentialByHash(
      hashMcpOAuthToken(mcpOAuthTokenSecret, refreshedBody.refresh_token),
    );
    expect(refreshedCredential?.expiresAt).toBe(originalExpiresAt);
  });

  it("rejects invalid redirect and resource bindings before consent", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const base = {
      response_type: "code",
      client_id: "chatgpt",
      redirect_uri: "https://evil.example/callback",
      resource: "http://localhost:4000/mcp",
      scope: "portfolio:mcp_read",
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
    };
    const badRedirect = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams(base).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(badRedirect.statusCode).toBe(400);
    expect(badRedirect.json()).toMatchObject({ error: "invalid_request" });

    const badResource = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        ...base,
        redirect_uri: "http://localhost:5555/callback",
        resource: "http://localhost:4001/mcp",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(badResource.statusCode).toBe(400);
    expect(badResource.json()).toMatchObject({ error: "invalid_target" });
  });

  it("rejects Claude.ai callbacks before allowlist repair and accepts the exact callback after allowlisting", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://claude.ai/.well-known/mcp-client.json";
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    const authorizeParams = new URLSearchParams({
      response_type: "code",
      client_id: clientId,
      redirect_uri: redirectUri,
      resource: "http://localhost:4000/mcp",
      scope: "portfolio:mcp_read",
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
    });

    const rejected = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${authorizeParams.toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      error: "invalid_request",
      error_description: "OAuth redirect_uri is not allowed",
    });

    await app.persistence.saveAiConnectorPolicySettings({
      oauthRedirectUriAllowlist: [redirectUri],
    });
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async () => {
        const body = JSON.stringify({
          client_id: clientId,
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });

    const accepted = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${authorizeParams.toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(accepted.statusCode).toBe(302);
    expect(String(accepted.headers.location)).toContain("/connectors/chatgpt/authorize?requestId=");
  });

  it("accepts OAuth authorization extension parameters from ChatGPT", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const response = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "http://localhost:5555/callback",
        resource: "http://localhost:4000/mcp",
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
        state: "state-123",
        ui_locales: "en-US",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain("/connectors/chatgpt/authorize?requestId=");
  });

  it("accepts admin-configured exact OAuth redirect URI additions", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://connector.example.com/oauth-client.json";
    const redirectUri = "https://connector.example.com/oauth/callback";
    await app.persistence.saveAiConnectorPolicySettings({
      oauthRedirectUriAllowlist: [redirectUri],
    });
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async () => {
        const body = JSON.stringify({
          client_id: clientId,
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: "http://localhost:4000/mcp",
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(response.statusCode).toBe(302);
    expect(String(response.headers.location)).toContain("/connectors/chatgpt/authorize?requestId=");
  });

  it("returns Claude.ai-specific redirect repair data for missing callback allowlist entries", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async () => {
        const body = JSON.stringify({
          client_id: clientId,
          client_name: "Claude.ai",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });

    const response = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: "http://localhost:4000/mcp",
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_request",
      redirectUriRepair: {
        clientId,
        clientKind: "claude_ai_connector",
        clientLabel: "Claude.ai",
        vendor: "anthropic",
        requestedRedirectUri: redirectUri,
        suggestedRedirectUris: [redirectUri],
      },
    });
  });

  it("denies research-only OAuth scope requests while research rollout gates stay off", async () => {
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: "http://localhost:5555/callback",
        resource: "http://localhost:4000/mcp",
        scope: "research:read",
        code_challenge: codeChallenge("research-off-verifier-123456789012345678901234567890123456"),
        code_challenge_method: "S256",
        state: "state-123",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });

    expect(authorize.statusCode).toBe(403);
    expect(authorize.json()).toMatchObject({
      error: "access_denied",
      error_description: "All requested MCP scope groups are disabled",
    });
  });

  it("stores Claude.ai OAuth approvals as a dedicated client kind", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const redirectUri = "https://claude.ai/api/mcp/auth_callback";
    await app.persistence.saveAiConnectorPolicySettings({
      oauthRedirectUriAllowlist: [redirectUri],
    });
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async () => {
        const body = JSON.stringify({
          client_id: clientId,
          client_name: "Claude.ai",
          redirect_uris: [redirectUri],
          grant_types: ["authorization_code"],
          response_types: ["code"],
          token_endpoint_auth_method: "none",
        });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });

    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        resource: "http://localhost:4000/mcp",
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(authorize.statusCode).toBe(302);

    const requestId = new URL(String(authorize.headers.location)).searchParams.get("requestId");
    const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}` });
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({
      clientId,
      clientKind: "claude_ai_connector",
      clientLabel: "Claude.ai",
      vendor: "anthropic",
    });
    const { csrfToken } = consent.json<{ csrfToken: string }>();

    const approved = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host: "localhost:4000" },
      payload: {
        csrfToken,
        scopes: ["portfolio:mcp_read"],
      },
    });
    expect(approved.statusCode).toBe(200);
    const redirect = await resolveOAuthRedirectBridge(approved.json<{ redirectUrl: string }>().redirectUrl);
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        client_id: clientId,
        redirect_uri: redirectUri,
        code_verifier: verifier,
        resource: "http://localhost:4000/mcp",
      }),
    });
    expect(token.statusCode).toBe(200);

    const [connection] = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connection).toMatchObject({
      provider: "chatgpt",
      vendor: "anthropic",
      clientKind: "claude_ai_connector",
      authMode: "oauth",
      displayName: "Claude.ai",
      oauthClientId: clientId,
      status: "active",
    });
  });

  it("rejects admin-configured redirect URI additions for arbitrary non-URL clients", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "https://connector.example.com/oauth/callback";
    await app.persistence.saveAiConnectorPolicySettings({
      oauthRedirectUriAllowlist: [redirectUri],
    });

    const response = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: redirectUri,
        resource: "http://localhost:4000/mcp",
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Custom OAuth redirect URIs require URL client metadata",
    });
  });

  it("validates URL client_id metadata documents against redirect bindings", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://client.example/oauth-client.json";
    const redirectUri = "http://localhost:5555/callback";
    const resource = "http://localhost:4000/mcp";
    let metadataBody = JSON.stringify({
      client_id: clientId,
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    const fetchAddresses: string[] = [];
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async (_url, address) => {
        fetchAddresses.push(address.address);
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(metadataBody, "utf8"),
          body: metadataBody,
        };
      },
    });

    const valid = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        resource,
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(valid.statusCode).toBe(302);
    expect(fetchAddresses).toEqual(["203.0.113.10"]);

    metadataBody = JSON.stringify({
      client_id: clientId,
      redirect_uris: ["http://localhost:5555/other-callback"],
    });
    const mismatch = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        resource,
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(mismatch.statusCode).toBe(400);
    expect(mismatch.json()).toMatchObject({ error: "invalid_request" });
  });

  it("accepts ChatGPT URL client metadata with token auth method choices and root JWKS URI", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://chatgpt.com/oauth/qJslh6tN1MVz/client.json";
    const redirectUri = "https://chatgpt.com/connector/oauth/qJslh6tN1MVz";
    const jwksUri = "https://chatgpt.com/";
    const resource = "http://localhost:4000/mcp";
    const tokenEndpoint = "http://localhost:4000/oauth/token";
    const fetchedUrls: string[] = [];
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "chatgpt-test-key",
      use: "sig",
      alg: "RS256",
    };
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async (url) => {
        fetchedUrls.push(url.toString());
        const body = url.toString() === clientId
          ? JSON.stringify({
            client_id: clientId,
            client_uri: "https://chatgpt.com/",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "ChatGPT",
            token_endpoint_auth_methods_supported: ["none", "private_key_jwt"],
            token_endpoint_auth_signing_alg: "RS256",
            jwks_uri: jwksUri,
          })
          : JSON.stringify({ keys: [publicJwk] });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });

    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        resource,
        scope: "portfolio:mcp_read account:manage transaction_draft:create transaction_draft:edit transaction_draft:archive transaction_draft:delete transaction:write",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
        state: "oauth_s_test",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(authorize.statusCode).toBe(302);
    const requestId = new URL(String(authorize.headers.location)).searchParams.get("requestId");
    expect(requestId).toBeTruthy();

    const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}` });
    expect(consent.statusCode).toBe(200);
    const consentBody = consent.json<{ csrfToken: string; scopes: string[] }>();
    expect(new Set(consentBody.scopes)).toEqual(new Set([
      "portfolio:mcp_read",
      "account:manage",
      "transaction_draft:create",
      "transaction_draft:edit",
      "transaction_draft:archive",
      "transaction_draft:delete",
      "transaction:write",
    ]));

    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host: "localhost:4000" },
      payload: {
        csrfToken: consentBody.csrfToken,
        scopes: ["portfolio:mcp_read", "account:manage"],
        lifetimeDays: 7,
      },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    const code = approveRedirect.searchParams.get("code");
    expect(approveRedirect.origin + approveRedirect.pathname).toBe(redirectUri);
    expect(code).toBeTruthy();

    const missingAssertion = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    });
    expect(missingAssertion.statusCode).toBe(400);
    expect(missingAssertion.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Client private_key_jwt assertion is required",
    });

    const token = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        grant_type: "authorization_code",
        code: String(code),
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier,
        resource,
        client_assertion_type: clientAssertionType,
        client_assertion: signClientAssertion({
          clientId,
          tokenEndpoint,
          privateKey,
          kid: "chatgpt-test-key",
        }),
      }),
    });
    expect(token.statusCode, token.body).toBe(200);
    expect(new Set(token.json<{ scope: string }>().scope.split(" "))).toEqual(
      new Set(["portfolio:mcp_read", "account:manage"]),
    );
    expect(fetchedUrls).toContain(jwksUri);
  });

  it("rejects private_key_jwt token requests with missing assertions, bad signatures, and bad claims", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const clientId = "https://chatgpt.com/oauth/qJslh6tN1MVz/client.json";
    const redirectUri = "https://chatgpt.com/connector/oauth/qJslh6tN1MVz";
    const jwksUri = "https://chatgpt.com/oauth/jwks.json";
    const resource = "http://localhost:4000/mcp";
    const tokenEndpoint = "http://localhost:4000/oauth/token";
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const { privateKey: wrongPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const publicJwk = {
      ...publicKey.export({ format: "jwk" }),
      kid: "chatgpt-test-key",
      use: "sig",
      alg: "RS256",
    };
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async (url) => {
        const body = url.toString() === clientId
          ? JSON.stringify({
            client_id: clientId,
            client_uri: "https://chatgpt.com/",
            redirect_uris: [redirectUri],
            grant_types: ["authorization_code", "refresh_token"],
            response_types: ["code"],
            client_name: "ChatGPT",
            token_endpoint_auth_method: "private_key_jwt",
            token_endpoint_auth_signing_alg: "RS256",
            jwks_uri: jwksUri,
          })
          : JSON.stringify({ keys: [publicJwk] });
        return {
          statusCode: 200,
          contentLength: Buffer.byteLength(body, "utf8"),
          body,
        };
      },
    });
    const basePayload = {
      grant_type: "authorization_code",
      code: "unused-code",
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: verifier,
      resource,
    };

    const missingAssertion = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form(basePayload),
    });
    expect(missingAssertion.statusCode).toBe(400);
    expect(missingAssertion.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Client private_key_jwt assertion is required",
    });

    const mismatchedSubject = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        ...basePayload,
        client_assertion_type: clientAssertionType,
        client_assertion: signClientAssertion({
          clientId,
          tokenEndpoint,
          privateKey,
          kid: "chatgpt-test-key",
          subject: "https://chatgpt.com/oauth/other-client.json",
        }),
      }),
    });
    expect(mismatchedSubject.statusCode).toBe(400);
    expect(mismatchedSubject.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Client assertion issuer or subject is invalid",
    });

    const badAudience = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        ...basePayload,
        client_assertion_type: clientAssertionType,
        client_assertion: signClientAssertion({
          clientId,
          tokenEndpoint,
          privateKey,
          kid: "chatgpt-test-key",
          audience: "http://localhost:4000/not-token",
        }),
      }),
    });
    expect(badAudience.statusCode).toBe(400);
    expect(badAudience.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Client assertion audience is invalid",
    });

    const expiredAssertion = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        ...basePayload,
        client_assertion_type: clientAssertionType,
        client_assertion: signClientAssertion({
          clientId,
          tokenEndpoint,
          privateKey,
          kid: "chatgpt-test-key",
          expiresAt: Math.floor(Date.now() / 1000) - 120,
        }),
      }),
    });
    expect(expiredAssertion.statusCode).toBe(400);
    expect(expiredAssertion.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Client assertion has expired",
    });

    const badSignature = await app.inject({
      method: "POST",
      url: "/oauth/token",
      headers: { "content-type": "application/x-www-form-urlencoded", host: "localhost:4000" },
      payload: form({
        ...basePayload,
        client_assertion_type: clientAssertionType,
        client_assertion: signClientAssertion({
          clientId,
          tokenEndpoint,
          privateKey: wrongPrivateKey,
          kid: "chatgpt-test-key",
        }),
      }),
    });
    expect(badSignature.statusCode).toBe(400);
    expect(badSignature.json()).toMatchObject({
      error: "invalid_client",
      error_description: "Client assertion signature is invalid",
    });
  });

  it("rejects unsafe or oversized URL client_id metadata documents", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const resource = "http://localhost:4000/mcp";
    const queryBase = {
      response_type: "code",
      redirect_uri: "http://localhost:5555/callback",
      resource,
      scope: "portfolio:mcp_read",
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
    };

    const directPrivate = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        ...queryBase,
        client_id: "https://127.0.0.1/oauth-client.json",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(directPrivate.statusCode).toBe(400);
    expect(directPrivate.json()).toMatchObject({ error: "invalid_client" });

    let readCalled = false;
    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "10.0.0.5", family: 4 }],
      readDocument: async () => {
        readCalled = true;
        throw new Error("unsafe host should not be fetched");
      },
    });
    const resolvedPrivate = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        ...queryBase,
        client_id: "https://client.example/oauth-client.json",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(resolvedPrivate.statusCode).toBe(400);
    expect(resolvedPrivate.json()).toMatchObject({ error: "invalid_client" });
    expect(readCalled).toBe(false);
    resetClientMetadataNetwork();

    resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
      resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
      readDocument: async () => ({
        statusCode: 200,
        contentLength: 70_000,
        body: "{}",
      }),
    });
    const oversized = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        ...queryBase,
        client_id: "https://client.example/oauth-client.json",
      }).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(oversized.statusCode).toBe(400);
    expect(oversized.json()).toMatchObject({
      error: "invalid_client",
      error_description: "URL client_id metadata document is too large",
    });
  });

  it("accepts ChatGPT OAuth callback variants including GPT-scoped callback paths", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const queryBase = {
      response_type: "code",
      client_id: "chatgpt",
      resource: "http://localhost:4000/mcp",
      scope: "portfolio:mcp_read",
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
    };
    for (const redirectUri of [
      "https://chat.openai.com/aip/oauth/callback",
      "https://chat.openai.com/aip/g-vakwen/oauth/callback",
      "https://chatgpt.com/aip/oauth/callback",
      "https://chatgpt.com/aip/g-vakwen/oauth/callback",
      "https://chatgpt.com/connector/oauth/qJslh6tN1MVz",
      "https://chat.openai.com/connector/oauth/qJslh6tN1MVz",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/oauth/authorize?${new URLSearchParams({
          ...queryBase,
          redirect_uri: redirectUri,
        }).toString()}`,
        headers: { host: "localhost:4000" },
      });
      expect(response.statusCode, redirectUri).toBe(302);
      expect(String(response.headers.location)).toContain("/connectors/chatgpt/authorize?requestId=");
    }
  });

  it("rejects deny after approval without mutating completed consent", async () => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams({
        response_type: "code",
        client_id: "chatgpt",
        redirect_uri: redirectUri,
        resource,
        scope: "portfolio:mcp_read",
        code_challenge: codeChallenge(verifier),
        code_challenge_method: "S256",
      }).toString()}`,
      headers,
    });
    const requestId = new URL(String(authorize.headers.location)).searchParams.get("requestId");
    const consent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}` });
    const { csrfToken } = consent.json<{ csrfToken: string }>();
    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);

    const deny = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/deny`,
      payload: { csrfToken },
    });
    expect(deny.statusCode).toBe(410);
    expect(deny.json()).toMatchObject({ error: "mcp_oauth_request_expired" });
  });

  it("settles concurrent approval attempts only once", async () => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    const { requestId, csrfToken } = await createAuthorizationRequest({
      headers,
      resource,
      verifier,
      redirectUri,
    });

    const approvals = await Promise.all([
      app.inject({
        method: "POST",
        url: `/oauth/consent/${requestId}/approve`,
        payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
      }),
      app.inject({
        method: "POST",
        url: `/oauth/consent/${requestId}/approve`,
        payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
      }),
    ]);
    expect(approvals.map((response) => response.statusCode).sort()).toEqual([200, 410]);
    const connections = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    expect(connections.filter((connection) => connection.provider === "chatgpt" && connection.status === "pending")).toHaveLength(1);
  });

  it("settles concurrent approval versus denial with one terminal winner", async () => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const redirectUri = "http://localhost:5555/callback";
    const { requestId, csrfToken } = await createAuthorizationRequest({
      headers,
      resource,
      verifier,
      redirectUri,
    });

    const [approve, deny] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/oauth/consent/${requestId}/approve`,
        payload: { csrfToken, scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
      }),
      app.inject({
        method: "POST",
        url: `/oauth/consent/${requestId}/deny`,
        payload: { csrfToken },
      }),
    ]);
    expect([approve.statusCode, deny.statusCode].sort()).toEqual([200, 410]);
    const connections = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    const pendingConnections = connections.filter((connection) => connection.provider === "chatgpt" && connection.status === "pending");
    expect(pendingConnections).toHaveLength(approve.statusCode === 200 ? 1 : 0);
    const staleConsent = await app.inject({ method: "GET", url: `/oauth/consent/${requestId}` });
    expect(staleConsent.statusCode).toBe(410);
  });
});

describePostgres("MCP OAuth Postgres replacement semantics", () => {
  let pool: Pool;
  let persistence: PostgresPersistence | null = null;

  async function resetDatabase(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
      await client.query("DROP SCHEMA IF EXISTS public CASCADE");
      await client.query("CREATE SCHEMA public");
      await client.query("GRANT ALL ON SCHEMA public TO public");
    } finally {
      client.release();
    }
  }

  async function applyNumberedMigrations(): Promise<void> {
    const manifest = await migrationManifestPromise;
    const client = await pool.connect();
    try {
      for (const file of manifest.numberedMigrations) {
        const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
        await client.query(sql);
      }
    } finally {
      client.release();
    }
  }

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    await persistence.ensureDevBypassUser();
  });

  afterEach(async () => {
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("revokes an existing active ChatGPT connector before activating the pending replacement", async () => {
    await persistence!.saveAiConnectorConnection({
      id: "old-chatgpt-connection",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await persistence!.saveAiConnectorConnection({
      id: "new-chatgpt-connection",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "pending",
      oauthClientId: "chatgpt",
      oauthSubject: "user-1",
      scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const result = await persistence!.activateAiConnectorConnectionReplacingProvider({
      connectionId: "new-chatgpt-connection",
      userId: "user-1",
      provider: "chatgpt",
      maxActiveConnectionsPerUser: 3,
      oauthClientId: "chatgpt",
      oauthSubject: "user-1",
      revocationReason: "replaced_by_oauth_authorization",
      revokedByUserId: "user-1",
    });

    expect(result?.connection).toMatchObject({ id: "new-chatgpt-connection", status: "active" });
    expect(result?.revokedConnectionIds).toEqual(["old-chatgpt-connection"]);
    const connections = await persistence!.listAiConnectorConnectionsForUser("user-1");
    expect(connections.filter((connection) => connection.provider === "chatgpt" && connection.status === "active")).toHaveLength(1);
    expect(connections.find((connection) => connection.id === "old-chatgpt-connection")).toMatchObject({
      status: "revoked",
      revocationReason: "replaced_by_oauth_authorization",
    });
  });

  it("persists account-management connector scopes", async () => {
    await persistence!.saveAiConnectorConnection({
      id: "account-manage-connection",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read", "account:manage"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const connection = await persistence!.getAiConnectorConnection("account-manage-connection");
    expect(connection?.scopes).toEqual(["account:manage", "portfolio:mcp_read"]);
  });
});
