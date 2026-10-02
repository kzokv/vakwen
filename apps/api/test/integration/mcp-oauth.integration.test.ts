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
import { resetMcpRateLimitBucketsForTest } from "../../src/mcp/policy.js";
import { buildApp } from "../../src/app.js";
import {
  hashMcpOAuthToken,
  setMcpOAuthClientMetadataNetworkForTest,
} from "../../src/mcp/oauth.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";

const authorizationWrites = vi.hoisted(() => ({ enabled: true }));
vi.mock("@vakwen/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@vakwen/config")>();
  return { ...actual, Env: { ...actual.Env, AUTH_MODE: "dev_bypass" as const, get MCP_OAUTH_NEW_AUTHORIZATIONS_ENABLED() { return authorizationWrites.enabled; } } };
});

let app: Awaited<ReturnType<typeof buildApp>>;
let requestIpSequence = 0;
let testIp = "127.0.0.1";
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
  const response = await app.inject({ remoteAddress: testIp,
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
  clientId?: string;
}) {
  const authorize = await app.inject({ remoteAddress: testIp,
    method: "GET",
    url: `/oauth/authorize?${new URLSearchParams({
      response_type: "code",
      client_id: input.clientId ?? "chatgpt",
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
  const consent = await app.inject({ remoteAddress: testIp, method: "GET", url: `/oauth/consent/${requestId}` });
  expect(consent.statusCode).toBe(200);
  const consentBody = consent.json<{ csrfToken: string; scopes: string[] }>();
  return { requestId: String(requestId), csrfToken: consentBody.csrfToken, connectionAction: "create", scopes: consentBody.scopes };
}

function registerIndependentOAuthRegressions() {
  describe.each(["chatgpt", "claude"])("independent OAuth regression: %s", (kind) => {
    const headers = { host: "localhost:4000" };
    const resource = "http://localhost:4000/mcp";
    const verifier = "regression-verifier-123456789012345678901234567890123";
    const clientId = kind === "chatgpt" ? "chatgpt" : "https://claude.ai/oauth/mcp-oauth-client-metadata";
    const redirectUri = kind === "chatgpt" ? "http://localhost:5555/callback" : "https://claude.ai/api/mcp/auth_callback";
    beforeEach(async () => {
      authorizationWrites.enabled = true;
      resetMcpRateLimitBucketsForTest();
      if (kind === "claude") {
        await app.persistence.saveAiConnectorPolicySettings({ oauthRedirectUriAllowlist: [redirectUri] });
        resetClientMetadataNetwork = setMcpOAuthClientMetadataNetworkForTest({
          resolveHost: async () => [{ address: "203.0.113.10", family: 4 }],
          readDocument: async (url) => {
            const body = JSON.stringify({ client_id: url.toString(), client_name: "Claude.ai", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" });
            return { statusCode: 200, contentLength: Buffer.byteLength(body), body };
          },
        });
      }
    });
    async function prepare(replacementConnectionId?: string, options: { clientId?: string; scopes?: string[] } = {}) {
      const selectedClientId = options.clientId ?? clientId;
      const scopes = options.scopes ?? ["portfolio:mcp_read"];
      const request = await createAuthorizationRequest({ headers, resource, verifier, redirectUri, clientId: selectedClientId, scope: scopes.join(" ") });
      const approve = await app.inject({ remoteAddress: testIp, method: "POST", url: `/oauth/consent/${request.requestId}/approve`, headers,
        payload: { csrfToken: request.csrfToken, connectionAction: "create", scopes, lifetimeDays: 7,
          ...(replacementConnectionId ? { connectionAction: "replace", replacementConnectionId } : {}) } });
      expect(approve.statusCode).toBe(200);
      const callback = await resolveOAuthRedirectBridge(approve.json().redirectUrl);
      return () => app.inject({ remoteAddress: testIp, method: "POST", url: "/oauth/token", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, payload: form({ grant_type: "authorization_code", code: String(callback.searchParams.get("code")), client_id: selectedClientId, redirect_uri: redirectUri, code_verifier: verifier, resource }) });
    }
    async function authorize(replacementConnectionId?: string) { return (await prepare(replacementConnectionId))(); }
    function connectionId(token: string): string {
      return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString()).connectionId;
    }
    async function refresh(token: string) {
      return app.inject({ remoteAddress: testIp, method: "POST", url: "/oauth/token", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, payload: form({ grant_type: "refresh_token", refresh_token: token, client_id: clientId, resource }) });
    }
    async function read(token: string, existingSession?: string, expectError = false, toolName = "list_portfolio_contexts") {
      const auth = { ...headers, authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
      let session = existingSession;
      if (!session) {
        const init = await app.inject({ remoteAddress: testIp, method: "POST", url: "/mcp", headers: auth, payload: { jsonrpc: "2.0", id: "init", method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: kind, version: "1" } } } });
        expect(init.statusCode).toBe(200);
        session = String(init.headers["mcp-session-id"]);
      }
      const response = await app.inject({ remoteAddress: testIp, method: "POST", url: "/mcp", headers: { ...auth, "mcp-session-id": session }, payload: { jsonrpc: "2.0", id: "read", method: "tools/call", params: { name: toolName, arguments: {} } } });
      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body.startsWith("{") ? response.body : response.body.split("\n").find(line => line.startsWith("data: "))!.slice(6));
      expect(body.result.isError === true, "Independent B must not challenge A").toBe(expectError);
      return session;
    }
    async function profile(token: string): Promise<string> {
      const session = await read(token);
      const response = await app.inject({ remoteAddress: testIp, method: "POST", url: "/mcp", headers: { ...headers, authorization: `Bearer ${token}`, accept: "application/json, text/event-stream", "mcp-session-id": session }, payload: { jsonrpc: "2.0", id: "profile", method: "tools/call", params: { name: "get_profile", arguments: {} } } });
      const body = JSON.parse(response.body.startsWith("{") ? response.body : response.body.split("\n").find(line => line.startsWith("data: "))!.slice(6));
      expect(body.result.isError).not.toBe(true);
      return body.result.structuredContent.id;
    }
    it.each([1, 2, 3])("create B: preserves A existing session and both refresh independently (run %i)", async () => {
      const a = (await authorize()).json();
      const session = await read(a.access_token);
      const b = (await authorize()).json();
      await read(a.access_token, session);
      await read(b.access_token);
      const identity = await profile(a.access_token);
      expect(await profile(b.access_token)).toBe(identity);
      const refreshedA = await refresh(a.refresh_token);
      const refreshedB = await refresh(b.refresh_token);
      expect(refreshedA.statusCode).toBe(200);
      expect(refreshedB.statusCode).toBe(200);
      expect(await profile(refreshedA.json().access_token)).toBe(identity);
      expect(await profile(refreshedB.json().access_token)).toBe(identity);
    });
    it("selected replacement: C replaces only A and preserves B", async () => {
      const a = (await authorize()).json();
      const sessionA = await read(a.access_token);
      const b = (await authorize()).json();
      const c = await authorize(connectionId(a.access_token));
      expect(c.statusCode).toBe(200);
      await read(c.json().access_token);
      await read(b.access_token);
      await read(a.access_token, sessionA, true);
      const rejected = await refresh(a.refresh_token);
      expect(rejected.statusCode).toBe(400);
      expect(rejected.json().reason).toBe("replaced_by_oauth_authorization");
      expect(await app.persistence.getAiConnectorConnection(connectionId(a.access_token))).toMatchObject({ replacedByConnectionId: connectionId(c.json().access_token) });
      expect((await app.persistence.getAiConnectorConnection(connectionId(b.access_token)))?.replacedByConnectionId).toBeFalsy();
      const history = (await app.persistence.getAiConnectorConnection(connectionId(a.access_token)))!;
      const savedHistory = await app.persistence.saveAiConnectorConnection({ ...history, displayName: "Renamed historical connection" });
      expect(savedHistory.replacedByConnectionId).toBe(connectionId(c.json().access_token));
    });
    it("precommit credential failure: preserves the selected A", async () => {
      const a = (await authorize()).json();
      const spy = vi.spyOn(app.persistence, "saveAiConnectorCredential").mockRejectedValueOnce(Object.assign(new Error("injected private SQL failure detail"), { code: "P0001" }));
      try {
        const failed = await authorize(connectionId(a.access_token));
        expect(failed.statusCode).toBe(503);
        expect(failed.body).not.toContain("private SQL");
        expect(failed.body).not.toContain("P0001");
      } finally { spy.mockRestore(); }
      await read(a.access_token);
      expect((await refresh(a.refresh_token)).statusCode).toBe(200);
    });
    it("expiry processing failure: leaves completion unset and retries terminal effects", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ inactivityExpiryDays: 1 });
      const a = (await authorize()).json();
      const original = (await app.persistence.getAiConnectorConnection(connectionId(a.access_token)))!;
      await app.persistence.saveAiConnectorConnection({ ...original, lastUsedAt: new Date(Date.now() - 2 * 86400000).toISOString() });
      const failure = vi.spyOn(app.persistence, "appendAuditLog").mockRejectedValueOnce(new Error("expiry audit unavailable"));
      try { expect((await refresh(a.refresh_token)).statusCode).toBe(500); } finally { failure.mockRestore(); }
      expect((await app.persistence.getAiConnectorConnection(original.id))?.expiryProcessedAt).toBeFalsy();
      expect((await refresh(a.refresh_token)).statusCode).toBe(400);
      expect((await app.persistence.getAiConnectorConnection(original.id))?.expiryProcessedAt).toBeTruthy();
    });
    it("refresh diagnostics: inactivity expiry is distinct from absolute lifetime expiry", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ inactivityExpiryDays: 1 });
      const a = (await authorize()).json();
      const original = (await app.persistence.getAiConnectorConnection(connectionId(a.access_token)))!;
      await app.persistence.saveAiConnectorConnection({ ...original, createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), lastUsedAt: new Date(Date.now() - 2 * 86400000).toISOString() });
      const expired = await refresh(a.refresh_token);
      expect(expired.statusCode).toBe(400);
      expect(expired.json().reason).toBe("inactivity_expiry");
      const finalized = (await app.persistence.getAiConnectorConnection(original.id))!;
      expect(finalized.expiryProcessedAt).toBeTruthy();
      expect(finalized.expiresAt).toBe(original.expiresAt);
      expect((await app.persistence.getAiConnectorCredentialByHash(hashMcpOAuthToken(mcpOAuthTokenSecret, a.refresh_token)))?.revokedAt).toBeTruthy();
      const repeatedAudit = vi.spyOn(app.persistence, "appendAuditLog");
      try {
        expect((await refresh(a.refresh_token)).statusCode).toBe(400);
        expect(repeatedAudit.mock.calls.some(([entry]) => entry.action === "ai_connector_expired")).toBe(false);
      } finally { repeatedAudit.mockRestore(); }
    });
    it("inactivity expiry: stale A frees capacity but a delayed touch cannot revive it", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 1, inactivityExpiryDays: 1 });
      const stale = await app.persistence.saveAiConnectorConnection({ id: "stale-active", userId: "user-1", provider: "chatgpt", displayName: "Old", status: "active", scopes: ["portfolio:mcp_read"],
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(), lastUsedAt: new Date(Date.now() - 2 * 86400000).toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString() });
      expect((await app.persistence.getAiConnectorConnection(stale.id))?.status).toBe("expired");
      const b = await authorize();
      expect(b.statusCode).toBe(200);
      await expect(app.persistence.saveAiConnectorConnection({ ...stale, status: "active", lastUsedAt: new Date().toISOString() })).rejects.toMatchObject({ code: "mcp_connection_inactive" });
      const listed = (await app.inject({ remoteAddress: testIp, method: "GET", url: "/ai/connectors/history" })).json();
      expect(listed.connections).toEqual(expect.arrayContaining([expect.objectContaining({ id: stale.id, status: "expired" })]));
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(1);
    });
    it("legacy consent: omitted action is rejected and in-flight code cannot implicitly replace A", async () => {
      const a = (await authorize()).json();
      const request = await createAuthorizationRequest({ headers, resource, verifier, redirectUri, clientId });
      const omitted = await app.inject({ remoteAddress: testIp, method: "POST", url: `/oauth/consent/${request.requestId}/approve`, headers, payload: { csrfToken: request.csrfToken, scopes: ["portfolio:mcp_read"] } });
      expect(omitted.statusCode).toBe(400);
      await app.persistence.saveAiConnectorConnection({ id: "legacy-pending", userId: "user-1", provider: "chatgpt", vendor: kind === "chatgpt" ? "openai" : "anthropic", clientKind: kind === "chatgpt" ? "chatgpt_app" : "claude_ai_connector", authMode: "oauth", displayName: "Legacy", status: "pending", scopes: ["portfolio:mcp_read"], expiresAt: new Date(Date.now() + 86400000).toISOString() });
      await app.persistence.saveMcpOAuthAuthorizationCode({ id: "legacy-code", codeHash: hashMcpOAuthToken(mcpOAuthTokenSecret, "legacy-unbound-code"), connectionId: "legacy-pending", userId: "user-1", clientId, redirectUri, resource, scopes: ["portfolio:mcp_read"], codeChallenge: codeChallenge(verifier), codeChallengeMethod: "S256", expiresAt: new Date(Date.now() + 600000).toISOString() });
      const exchange = await app.inject({ remoteAddress: testIp, method: "POST", url: "/oauth/token", headers: { ...headers, "content-type": "application/x-www-form-urlencoded" }, payload: form({ grant_type: "authorization_code", code: "legacy-unbound-code", client_id: clientId, redirect_uri: redirectUri, code_verifier: verifier, resource }) });
      expect(exchange.statusCode).toBe(400);
      expect(exchange.json().reason).toBe("mcp_oauth_consent_required");
      await read(a.access_token);
    });
    it("consent binding: decision and selected target persist on request and consumed code", async () => {
      const a = (await authorize()).json();
      const target = connectionId(a.access_token);
      const request = await createAuthorizationRequest({ headers, resource, verifier, redirectUri, clientId });
      const approved = await app.inject({ remoteAddress: testIp, method: "POST", url: `/oauth/consent/${request.requestId}/approve`, headers, payload: { csrfToken: request.csrfToken, scopes: ["portfolio:mcp_read"], connectionAction: "replace", replacementConnectionId: target } });
      expect(approved.statusCode).toBe(200);
      expect(await app.persistence.getMcpOAuthAuthorizationRequest(request.requestId)).toMatchObject({ connectionAction: "replace", replacementConnectionId: target });
      const callback = await resolveOAuthRedirectBridge(approved.json().redirectUrl);
      const code = await app.persistence.consumeMcpOAuthAuthorizationCode(hashMcpOAuthToken(mcpOAuthTokenSecret, String(callback.searchParams.get("code"))));
      expect(code).toMatchObject({ authorizationRequestId: request.requestId, connectionAction: "replace", replacementConnectionId: target });
      expect(await app.persistence.saveMcpOAuthAuthorizationCode({ ...code! })).toMatchObject({ authorizationRequestId: request.requestId, connectionAction: "replace", replacementConnectionId: target });
      const boundRequest = (await app.persistence.getMcpOAuthAuthorizationRequest(request.requestId))!;
      expect(await app.persistence.saveMcpOAuthAuthorizationRequest({ ...boundRequest })).toMatchObject({ connectionAction: "replace", replacementConnectionId: target });
      await read(a.access_token);
    });
    it("scope expansion and distinct OAuth client IDs: preserve A credentials and stable profile", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { drafts: true } });
      const a = (await authorize()).json();
      const otherClientId = kind === "chatgpt" ? "chatgpt-other-entry" : "https://claude.ai/.well-known/mcp-client.json";
      const b = await (await prepare(undefined, { clientId: otherClientId, scopes: ["portfolio:mcp_read", "transaction_draft:create"] }))();
      expect(b.statusCode).toBe(200);
      expect((await app.persistence.getAiConnectorConnection(connectionId(a.access_token)))?.scopes).toEqual(["portfolio:mcp_read"]);
      expect((await app.persistence.getAiConnectorConnection(connectionId(b.json().access_token)))?.scopes).toContain("transaction_draft:create");
      expect(await profile(a.access_token)).toBe(await profile(b.json().access_token));
      expect((await refresh(a.refresh_token)).statusCode).toBe(200);
    });
    it("foreign and other-client targets: consent rejects selection without changing either grant", async () => {
      const foreign = await app.persistence.resolveOrCreateUser("google", "replacement-foreign", { email: "replacement-foreign@example.com", name: "Foreign" });
      const a = (await authorize()).json();
      const original = (await app.persistence.getAiConnectorConnection(connectionId(a.access_token)))!;
      for (const target of [
        { ...original, id: "foreign-target", userId: foreign.userId },
        { ...original, id: "other-client-target", vendor: kind === "chatgpt" ? "anthropic" as const : "openai" as const, clientKind: kind === "chatgpt" ? "claude_ai_connector" as const : "chatgpt_app" as const },
        { ...original, id: "pending-target", status: "pending" as const },
        { ...original, id: "expired-target", expiresAt: new Date(Date.now() - 1000).toISOString() },
        { ...original, id: "revoked-target", status: "revoked" as const },
      ]) {
        await app.persistence.saveAiConnectorConnection(target);
        const expectedState = (await app.persistence.getAiConnectorConnection(target.id))!.status;
        const request = await createAuthorizationRequest({ headers, resource, verifier, redirectUri, clientId });
        const response = await app.inject({ remoteAddress: testIp, method: "POST", url: `/oauth/consent/${request.requestId}/approve`, headers, payload: { csrfToken: request.csrfToken, scopes: ["portfolio:mcp_read"], connectionAction: "replace", replacementConnectionId: target.id } });
        expect(response.statusCode).toBe(409);
        expect(response.json().error).toBe("mcp_oauth_replacement_target_invalid");
        expect((await app.persistence.getAiConnectorConnection(target.id))?.status).toBe(expectedState);
      }
      await read(a.access_token);
    });
    it("authorization freeze: access and refresh survive while create and pending exchange are paused", async () => {
      const a = (await authorize()).json();
      const exchange = await prepare(connectionId(a.access_token));
      const request = await createAuthorizationRequest({ headers, resource, verifier, redirectUri, clientId });
      authorizationWrites.enabled = false;
      try {
        const started = await app.inject({ remoteAddress: testIp, method: "GET", url: "/oauth/authorize" });
        expect(started.statusCode).toBe(503);
        const approved = await app.inject({ remoteAddress: testIp, method: "POST", url: `/oauth/consent/${request.requestId}/approve`, headers, payload: { csrfToken: request.csrfToken, scopes: ["portfolio:mcp_read"], connectionAction: "create" } });
        expect(approved.statusCode).toBe(503);
        expect((await exchange()).statusCode).toBe(503);
        await read(a.access_token);
        expect((await refresh(a.refresh_token)).statusCode).toBe(200);
      } finally { authorizationWrites.enabled = true; }
      expect((await exchange()).statusCode).toBe(200);
    });
    it("postcommit response failure: only A is replaced and repeated code preserves B", async () => {
      const a = (await authorize()).json();
      const b = (await authorize()).json();
      const exchange = await prepare(connectionId(a.access_token));
      const audit = vi.spyOn(app.persistence, "appendAuditLog").mockRejectedValueOnce(new Error("postcommit audit unavailable"));
      try { expect((await exchange()).statusCode).toBe(500); } finally { audit.mockRestore(); }
      expect((await app.persistence.getAiConnectorConnection(connectionId(a.access_token)))?.status).toBe("revoked");
      expect((await exchange()).statusCode).toBe(400);
      await read(b.access_token);
      expect((await refresh(b.refresh_token)).statusCode).toBe(200);
    });
    it("profile catalog: write-only grants remain available when portfolio-read policy is disabled", async () => {
      await app.persistence.saveAiConnectorConnection({ id: "write-only-profile", userId: "user-1", provider: "chatgpt", displayName: "Write only", status: "active", scopes: ["transaction:write"] });
      await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { read: false, write: true } });
      const summary = await app.inject({ remoteAddress: testIp, method: "GET", url: "/ai/connectors/summary" });
      const profileTool = summary.json().toolCatalog.find((tool: { name: string }) => tool.name === "get_profile");
      expect(profileTool).toMatchObject({ enabledByPolicy: true, availability: "available", effectiveAccess: [expect.objectContaining({ connectionId: "write-only-profile", status: "available", blockerCode: null })] });
      const disabled = await app.inject({ remoteAddress: testIp, method: "PATCH", url: "/ai/connectors/write-only-profile", payload: { toolToggles: { get_profile: false } } });
      expect(disabled.statusCode).toBe(200);
      await app.persistence.saveAiConnectorConnection({ id: "disabled-bearer-profile", userId: "user-1", provider: "self_hosted", authMode: "bearer", clientKind: "generic_mcp", vendor: "generic", displayName: "Disabled CLI", status: "active", scopes: ["transaction:write"] });
      await app.persistence.saveAiConnectorPolicySettings({ bearerFallback: { enabled: false } });
      const blockedSummary = await app.inject({ remoteAddress: testIp, method: "GET", url: "/ai/connectors/summary" });
      const blockedProfile = blockedSummary.json().toolCatalog.find((tool: { name: string }) => tool.name === "get_profile");
      expect(blockedProfile.effectiveAccess).toEqual(expect.arrayContaining([
        expect.objectContaining({ connectionId: "write-only-profile", blockerCode: "connector_override_disabled" }),
        expect.objectContaining({ connectionId: "disabled-bearer-profile", blockerCode: "admin_tool_policy_disabled" }),
      ]));
    });
    it("security reset during credential persistence: pending grant is never revived", async () => {
      if (app.persistence instanceof PostgresPersistence) return;
      const a = (await authorize()).json();
      const originalSave = app.persistence.saveAiConnectorCredential.bind(app.persistence);
      const save = vi.spyOn(app.persistence, "saveAiConnectorCredential").mockImplementationOnce(async (input) => {
        const credential = await originalSave(input);
        await app.persistence.revokeAiConnectorConnectionsForProvider("chatgpt", "mcp_oauth_secret_rotated", "user-1");
        return credential;
      });
      try { expect((await authorize(connectionId(a.access_token))).statusCode).toBe(400); }
      finally { save.mockRestore(); }
      const connections = await app.persistence.listAiConnectorConnectionsForUser("user-1");
      expect(connections.every(c => c.status === "revoked" && c.revocationReason === "mcp_oauth_secret_rotated")).toBe(true);
    });
    it.each(["absolute", "inactivity"])("expired bearer successor: %s expiry frees the retained unique-index slot", async (expiryKind) => {
      await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 1, inactivityExpiryDays: 1 });
      const old = { id: "expired-bearer", userId: "user-1", provider: "self_hosted" as const, vendor: "generic" as const, clientKind: "generic_mcp" as const,
        authMode: "bearer" as const, displayName: "Old CLI", status: "active" as const, scopes: ["portfolio:mcp_read" as const],
        expiresAt: new Date(Date.now() + (expiryKind === "absolute" ? -1000 : 86400000)).toISOString(),
        createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
        lastUsedAt: new Date(Date.now() - (expiryKind === "inactivity" ? 2 * 86400000 : 0)).toISOString() };
      await app.persistence.saveAiConnectorConnection(old);
      const successor = await app.persistence.saveAiConnectorConnection({ ...old, id: "successor-bearer", expiresAt: new Date(Date.now() + 86400000).toISOString(), createdAt: new Date().toISOString(), lastUsedAt: new Date().toISOString() });
      expect(successor.status).toBe("active");
      expect((await app.persistence.getAiConnectorConnection(old.id))?.status).toBe("expired");
    });
    it("bearer uniqueness: concurrent same-client creates retain the existing single bearer rule", async () => {
      const input = { userId: "user-1", provider: "self_hosted" as const, vendor: "generic" as const, clientKind: "generic_mcp" as const,
        authMode: "bearer" as const, displayName: "CLI", status: "active" as const, scopes: ["portfolio:mcp_read" as const] };
      const results = await Promise.allSettled([
        app.persistence.saveAiConnectorConnection({ ...input, id: "bearer-race-1" }),
        app.persistence.saveAiConnectorConnection({ ...input, id: "bearer-race-2" }),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(1);
    });
    it("database insert failure: transaction leaves A active and no partial refresh credential", async () => {
      if (!(app.persistence instanceof PostgresPersistence)) return;
      const a = (await authorize()).json();
      const exchange = await prepare(connectionId(a.access_token));
      const faultPool = new Pool({ connectionString: databaseUrl });
      try {
        await faultPool.query(`CREATE FUNCTION fail_oauth_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected credential persistence failure'; END $$;
          CREATE TRIGGER fail_oauth_insert BEFORE INSERT ON ai_connector_credentials FOR EACH ROW EXECUTE FUNCTION fail_oauth_insert()`);
        expect((await exchange()).statusCode).toBe(503);
        expect((await faultPool.query("SELECT id FROM ai_connector_credentials")).rowCount).toBe(1);
      } finally {
        await faultPool.query("DROP TRIGGER IF EXISTS fail_oauth_insert ON ai_connector_credentials; DROP FUNCTION IF EXISTS fail_oauth_insert()");
        await faultPool.end();
      }
      await read(a.access_token);
      expect((await refresh(a.refresh_token)).statusCode).toBe(200);
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(1);
    });
    it("OAuth/bearer capacity: concurrent grants share one total allowance", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 1 });
      const exchange = await prepare();
      const results = await Promise.allSettled([exchange(), app.persistence.saveAiConnectorConnection({
        id: "racing-bearer", userId: "user-1", provider: "self_hosted", vendor: "generic", clientKind: "generic_mcp", authMode: "bearer",
        displayName: "CLI", status: "active", scopes: ["portfolio:mcp_read"], expiresAt: new Date(Date.now() + 86400000).toISOString(),
      })]);
      expect(results).toHaveLength(2);
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(1);
    });
    it("create/replace concurrency: unrelated B survives and total capacity holds", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 2 });
      const a = (await authorize()).json();
      const [create, replace] = await Promise.all([prepare(), prepare(connectionId(a.access_token))]);
      const [b, c] = await Promise.all([create(), replace()]);
      expect([b.statusCode, c.statusCode]).toEqual([200, 200]);
      await read(b.json().access_token);
      await read(c.json().access_token);
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(2);
    });
    it("cancel and expired code: preserve the explicitly selected existing grant", async () => {
      const a = (await authorize()).json();
      const request = await createAuthorizationRequest({ headers, resource, verifier, redirectUri, clientId });
      const denied = await app.inject({ remoteAddress: testIp, method: "POST", url: `/oauth/consent/${request.requestId}/deny`, payload: { csrfToken: request.csrfToken } });
      expect(denied.statusCode).toBe(200);
      const exchange = await prepare(connectionId(a.access_token));
      const now = Date.now();
      const clock = vi.spyOn(Date, "now").mockReturnValue(now + 11 * 60 * 1000);
      if (app.persistence instanceof PostgresPersistence) {
        const expiryPool = new Pool({ connectionString: databaseUrl });
        try { await expiryPool.query("UPDATE mcp_oauth_authorization_codes SET expires_at = NOW() - INTERVAL '1 second' WHERE consumed_at IS NULL"); }
        finally { await expiryPool.end(); }
      }
      expect((await exchange()).statusCode).toBe(400);
      const expiredPending = (await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.id !== connectionId(a.access_token));
      expect(expiredPending).toHaveLength(1);
      expect(expiredPending[0]?.status).toBe("expired");
      clock.mockRestore();
      await read(a.access_token);
      expect((await refresh(a.refresh_token)).statusCode).toBe(200);
    });
    it("capacity: concurrent create/create cannot exceed the total and replacement succeeds at cap", async () => {
      await app.persistence.saveAiConnectorPolicySettings({ maxActiveConnectionsPerUser: 1 });
      const [a, b] = await Promise.all([prepare(), prepare()]);
      const results = await Promise.all([a(), b()]);
      expect(results.map(r => r.statusCode).sort()).toEqual([200, 400]);
      const winner = results.find(r => r.statusCode === 200)!.json();
      const replacement = await authorize(connectionId(winner.access_token));
      expect(replacement.statusCode).toBe(200);
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(1);
    });
    it("competing replacement: only one exchange may replace the selected target", async () => {
      const a = (await authorize()).json();
      const [c, d] = await Promise.all([prepare(connectionId(a.access_token)), prepare(connectionId(a.access_token))]);
      const responses = await Promise.all([c(), d()]);
      expect(responses.map(r => r.statusCode).sort()).toEqual([200, 400]);
      expect(responses.find(r => r.statusCode === 400)!.json().reason).toBe("mcp_oauth_replacement_target_invalid");
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(1);
    });
    it("stale target: revocation after consent rejects exchange without activating another connection", async () => {
      const a = (await authorize()).json();
      const exchange = await prepare(connectionId(a.access_token));
      await app.inject({ remoteAddress: testIp, method: "DELETE", url: `/ai/connectors/${connectionId(a.access_token)}` });
      const result = await exchange();
      expect(result.statusCode).toBe(400);
      expect(result.json().reason).toBe("mcp_oauth_replacement_target_invalid");
      expect((await app.persistence.listAiConnectorConnectionsForUser("user-1")).filter(c => c.status === "active")).toHaveLength(0);
    });
    it("committed replacement: retrying the consumed code never revokes unrelated B", async () => {
      const a = (await authorize()).json();
      const b = (await authorize()).json();
      const exchange = await prepare(connectionId(a.access_token));
      expect((await exchange()).statusCode).toBe(200);
      expect((await exchange()).statusCode).toBe(400);
      await read(b.access_token);
      expect((await refresh(b.refresh_token)).statusCode).toBe(200);
    });
    it("labels: independent labels differ and rename preserves credentials and expiry", async () => {
      const a = (await authorize()).json();
      const b = (await authorize()).json();
      const old = await app.persistence.getAiConnectorConnection(connectionId(a.access_token));
      expect(old?.displayName).not.toBe((await app.persistence.getAiConnectorConnection(connectionId(b.access_token)))?.displayName);
      const identity = await profile(a.access_token);
      const renamed = await app.inject({ remoteAddress: testIp, method: "PATCH", url: `/ai/connectors/${old!.id}`, payload: { displayName: "Research" } });
      expect(renamed.statusCode).toBe(200);
      expect(await profile(a.access_token)).toBe(identity);
      expect(renamed.json()).toMatchObject({ displayName: "Research", expiresAt: old!.expiresAt, scopes: old!.scopes });
      await read(a.access_token);
      expect((await refresh(a.refresh_token)).statusCode).toBe(200);
    });
  });

}

describe("MCP OAuth for ChatGPT", () => {
  beforeEach(async () => {
    resetMcpRateLimitBucketsForTest();
    testIp = `127.0.0.${++requestIpSequence}`;
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

  registerIndependentOAuthRegressions();

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

    const authorizationServer = await app.inject({ remoteAddress: testIp,
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
    const pathScopedAuthorizationServer = await app.inject({ remoteAddress: testIp,
      method: "GET",
      url: "/.well-known/oauth-authorization-server/mcp",
      headers,
    });
    expect(pathScopedAuthorizationServer.statusCode).toBe(200);
    expect(pathScopedAuthorizationServer.json()).toMatchObject({
      issuer: "http://localhost:4000",
      client_id_metadata_document_supported: true,
    });
    const openIdConfiguration = await app.inject({ remoteAddress: testIp,
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
    const pathScopedOpenIdConfiguration = await app.inject({ remoteAddress: testIp,
      method: "GET",
      url: "/.well-known/openid-configuration/mcp",
      headers,
    });
    expect(pathScopedOpenIdConfiguration.statusCode).toBe(200);
    expect(pathScopedOpenIdConfiguration.json()).toMatchObject({
      issuer: "http://localhost:4000",
      authorization_endpoint: "http://localhost:4000/oauth/authorize",
    });

    const mcpPreflight = await app.inject({ remoteAddress: testIp,
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

    const tokenPreflight = await app.inject({ remoteAddress: testIp,
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

    const protectedResource = await app.inject({ remoteAddress: testIp,
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
    const pathScopedProtectedResource = await app.inject({ remoteAddress: testIp,
      method: "GET",
      url: "/.well-known/oauth-protected-resource/mcp",
      headers,
    });
    expect(pathScopedProtectedResource.statusCode).toBe(200);
    expect(pathScopedProtectedResource.json()).toMatchObject({
      resource,
      authorization_servers: ["http://localhost:4000"],
    });

    const authorize = await app.inject({ remoteAddress: testIp,
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

    const consent = await app.inject({ remoteAddress: testIp,
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

    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: {
        csrfToken: consentBody.csrfToken,
        connectionAction: "create", scopes: ["portfolio:mcp_read"],
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

    const token = await app.inject({ remoteAddress: testIp,
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
      status: "active",
      revocationReason: null,
    });

    const patched = await app.inject({ remoteAddress: testIp,
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

    const initialize = await app.inject({ remoteAddress: testIp,
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

    const oldTokenDraftCall = await app.inject({ remoteAddress: testIp,
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

    const replay = await app.inject({ remoteAddress: testIp,
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

    const refreshed = await app.inject({ remoteAddress: testIp,
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

    const reuse = await app.inject({ remoteAddress: testIp,
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

    const authorizationServer = await app.inject({ remoteAddress: testIp,
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
    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host },
      payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
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
    const deny = await app.inject({ remoteAddress: testIp,
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
    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    expect(approveRedirect.searchParams.has("iss")).toBe(false);
    const code = approveRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({ remoteAddress: testIp,
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

    const refreshed = await app.inject({ remoteAddress: testIp,
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
    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    expect(approveRedirect.searchParams.has("iss")).toBe(false);
    const code = approveRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({ remoteAddress: testIp,
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
    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers,
      payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    expect(approveRedirect.searchParams.has("iss")).toBe(false);
    const code = approveRedirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({ remoteAddress: testIp,
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
      const patched = await app.inject({ remoteAddress: testIp,
        method: "PATCH",
        url: `/ai/connectors/${connection.id}`,
        payload: { expiresAt },
      });
      expect(patched.statusCode).toBe(400);
      expect(patched.json()).toMatchObject({ error: "mcp_oauth_connector_lifetime_immutable" });
    }

    const current = await app.persistence.getAiConnectorConnection(connection.id);
    expect(current?.expiresAt).toBe(originalExpiresAt);

    const refreshed = await app.inject({ remoteAddress: testIp,
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
    const badRedirect = await app.inject({ remoteAddress: testIp,
      method: "GET",
      url: `/oauth/authorize?${new URLSearchParams(base).toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(badRedirect.statusCode).toBe(400);
    expect(badRedirect.json()).toMatchObject({ error: "invalid_request" });

    const badResource = await app.inject({ remoteAddress: testIp,
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

    const rejected = await app.inject({ remoteAddress: testIp,
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

    const accepted = await app.inject({ remoteAddress: testIp,
      method: "GET",
      url: `/oauth/authorize?${authorizeParams.toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(accepted.statusCode).toBe(302);
    expect(String(accepted.headers.location)).toContain("/connectors/chatgpt/authorize?requestId=");
  });

  it("accepts OAuth authorization extension parameters from ChatGPT", async () => {
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const response = await app.inject({ remoteAddress: testIp,
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

    const response = await app.inject({ remoteAddress: testIp,
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

    const response = await app.inject({ remoteAddress: testIp,
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

    const authorize = await app.inject({ remoteAddress: testIp,
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
    const consent = await app.inject({ remoteAddress: testIp, method: "GET", url: `/oauth/consent/${requestId}` });
    expect(consent.statusCode).toBe(200);
    expect(consent.json()).toMatchObject({
      clientId,
      clientKind: "claude_ai_connector",
      clientLabel: "Claude.ai",
      vendor: "anthropic",
    });
    const { csrfToken } = consent.json<{ csrfToken: string }>();

    const approved = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host: "localhost:4000" },
      payload: {
        csrfToken,
        connectionAction: "create", scopes: ["portfolio:mcp_read"],
      },
    });
    expect(approved.statusCode).toBe(200);
    const redirect = await resolveOAuthRedirectBridge(approved.json<{ redirectUrl: string }>().redirectUrl);
    const code = redirect.searchParams.get("code");
    expect(code).toBeTruthy();

    const token = await app.inject({ remoteAddress: testIp,
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
      displayName: expect.stringMatching(/^Claude\.ai · /),
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

    const response = await app.inject({ remoteAddress: testIp,
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

    const valid = await app.inject({ remoteAddress: testIp,
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
    const mismatch = await app.inject({ remoteAddress: testIp,
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

    const authorize = await app.inject({ remoteAddress: testIp,
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

    const consent = await app.inject({ remoteAddress: testIp, method: "GET", url: `/oauth/consent/${requestId}` });
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

    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host: "localhost:4000" },
      payload: {
        csrfToken: consentBody.csrfToken,
        connectionAction: "create", scopes: ["portfolio:mcp_read", "account:manage"],
        lifetimeDays: 7,
      },
    });
    expect(approve.statusCode).toBe(200);
    const approveRedirect = await resolveOAuthRedirectBridge(approve.json<{ redirectUrl: string }>().redirectUrl);
    const code = approveRedirect.searchParams.get("code");
    expect(approveRedirect.origin + approveRedirect.pathname).toBe(redirectUri);
    expect(code).toBeTruthy();

    const missingAssertion = await app.inject({ remoteAddress: testIp,
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

    const token = await app.inject({ remoteAddress: testIp,
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

    const missingAssertion = await app.inject({ remoteAddress: testIp,
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

    const mismatchedSubject = await app.inject({ remoteAddress: testIp,
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

    const badAudience = await app.inject({ remoteAddress: testIp,
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

    const expiredAssertion = await app.inject({ remoteAddress: testIp,
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

    const badSignature = await app.inject({ remoteAddress: testIp,
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

    const directPrivate = await app.inject({ remoteAddress: testIp,
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
    const resolvedPrivate = await app.inject({ remoteAddress: testIp,
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
    const oversized = await app.inject({ remoteAddress: testIp,
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
      const response = await app.inject({ remoteAddress: testIp,
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
    const authorize = await app.inject({ remoteAddress: testIp,
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
    const consent = await app.inject({ remoteAddress: testIp, method: "GET", url: `/oauth/consent/${requestId}` });
    const { csrfToken } = consent.json<{ csrfToken: string }>();
    const approve = await app.inject({ remoteAddress: testIp,
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
    });
    expect(approve.statusCode).toBe(200);

    const deny = await app.inject({ remoteAddress: testIp,
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
      app.inject({ remoteAddress: testIp,
        method: "POST",
        url: `/oauth/consent/${requestId}/approve`,
        payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
      }),
      app.inject({ remoteAddress: testIp,
        method: "POST",
        url: `/oauth/consent/${requestId}/approve`,
        payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
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
      app.inject({ remoteAddress: testIp,
        method: "POST",
        url: `/oauth/consent/${requestId}/approve`,
        payload: { csrfToken, connectionAction: "create", scopes: ["portfolio:mcp_read"], lifetimeDays: 7 },
      }),
      app.inject({ remoteAddress: testIp,
        method: "POST",
        url: `/oauth/consent/${requestId}/deny`,
        payload: { csrfToken },
      }),
    ]);
    expect([approve.statusCode, deny.statusCode].sort()).toEqual([200, 410]);
    const connections = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    const pendingConnections = connections.filter((connection) => connection.provider === "chatgpt" && connection.status === "pending");
    expect(pendingConnections).toHaveLength(approve.statusCode === 200 ? 1 : 0);
    const staleConsent = await app.inject({ remoteAddress: testIp, method: "GET", url: `/oauth/consent/${requestId}` });
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
    testIp = `127.0.0.${++requestIpSequence}`;
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase();
    await applyNumberedMigrations();
    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();
    await persistence.ensureDevBypassUser();
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig, appBaseUrl: "http://localhost:3000" });
    await app.persistence.close();
    app.persistence = persistence;
    await persistence.setAppConfigEncryptedSecret("mcpOauthTokenSecret", mcpOAuthTokenSecret);
  });

  afterEach(async () => {
    resetClientMetadataNetwork?.();
    resetClientMetadataNetwork = null;
    await app.close();
    if (persistence) {
      persistence = null;
    }
    await pool.end();
  });

  registerIndependentOAuthRegressions();

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

    const result = await persistence!.activateAiConnectorOAuthConnection({
      connectionId: "new-chatgpt-connection",
      connectionAction: "replace",
      replacementConnectionId: "old-chatgpt-connection",
      vendor: "openai", clientKind: "chatgpt_app", authMode: "oauth",
      refreshCredential: { id: "new-refresh", connectionId: "new-chatgpt-connection", credentialType: "oauth_refresh_token", tokenHash: "new-refresh-hash" },
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
