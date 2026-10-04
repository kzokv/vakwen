import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "oauth" as const,
      NODE_ENV: "test",
      PERSISTENCE_BACKEND: "memory" as const,
    },
  };
});

const { buildApp } = await import("../../src/app.js");
const { signSessionCookie } = await import("../../src/auth/googleOAuth.js");

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-at-least-32-chars",
};

const mcpOAuthTokenSecret = "test-mcp-oauth-token-secret-that-is-long-enough";
const SESSION_COOKIE_NAME = "g_auth_session";

let app: Awaited<ReturnType<typeof buildApp>>;

function codeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

async function resolveOAuthRedirectBridge(redirectUrl: string): Promise<URL> {
  const bridge = new URL(redirectUrl);
  expect(bridge.origin + bridge.pathname).toBe("http://localhost:4000/oauth/redirect");
  expect(bridge.searchParams.get("payload")).toBeTruthy();
  const response = await app.inject({
    method: "GET",
    url: `${bridge.pathname}${bridge.search}`,
    headers: { host: "localhost:4000" },
  });
  expect(response.statusCode).toBe(302);
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers.pragma).toBe("no-cache");
  return new URL(String(response.headers.location));
}

describe("MCP OAuth consent under AUTH_MODE=oauth", () => {
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
    await app.close();
  });

  it("bridges ChatGPT authorize through the real session cookie consent flow", async () => {
    const { userId } = await app.persistence.resolveOrCreateUser("google", "chatgpt-oauth-sub", {
      email: "chatgpt-oauth@example.com",
      name: "ChatGPT OAuth",
    });
    const authUser = await app.persistence.getAuthUserById(userId);
    expect(authUser).toBeTruthy();
    const sessionCookie = signSessionCookie(
      userId,
      testOAuthConfig.sessionSecret,
      authUser!.sessionVersion,
    );
    const cookieHeader = `${SESSION_COOKIE_NAME}=${sessionCookie}`;
    const verifier = "verifier-1234567890123456789012345678901234567890123";
    const authorizeParams = new URLSearchParams({
      response_type: "code",
      client_id: "chatgpt",
      redirect_uri: "http://localhost:5555/callback",
      resource: "http://localhost:4000/mcp",
      scope: "portfolio:mcp_read transaction_draft:create",
      code_challenge: codeChallenge(verifier),
      code_challenge_method: "S256",
      state: "state-123",
    });

    const unauthenticated = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${authorizeParams.toString()}`,
      headers: { host: "localhost:4000" },
    });
    expect(unauthenticated.statusCode).toBe(302);
    const loginLocation = new URL(String(unauthenticated.headers.location));
    expect(loginLocation.origin + loginLocation.pathname).toBe("http://localhost:3000/login");
    const returnTo = loginLocation.searchParams.get("returnTo");
    expect(returnTo).toContain("/connectors/chatgpt/authorize?");
    expect(returnTo).toContain("client_id=chatgpt");

    const authorize = await app.inject({
      method: "GET",
      url: `/oauth/authorize?${authorizeParams.toString()}`,
      headers: { host: "localhost:4000", cookie: cookieHeader },
    });
    expect(authorize.statusCode).toBe(302);
    const requestId = new URL(String(authorize.headers.location)).searchParams.get("requestId");
    expect(requestId).toBeTruthy();

    const consentWithoutCookie = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
    });
    expect(consentWithoutCookie.statusCode).toBe(401);

    const consent = await app.inject({
      method: "GET",
      url: `/oauth/consent/${requestId}`,
      headers: { cookie: cookieHeader },
    });
    expect(consent.statusCode).toBe(200);
    const consentBody = consent.json<{ csrfToken: string; scopes: string[] }>();
    expect(consentBody.scopes).toEqual(["portfolio:mcp_read", "transaction_draft:create"]);

    const approve = await app.inject({
      method: "POST",
      url: `/oauth/consent/${requestId}/approve`,
      headers: { host: "localhost:4000", cookie: cookieHeader },
      payload: {
        csrfToken: consentBody.csrfToken,
        connectionAction: "create", scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    expect(approve.statusCode).toBe(200);
    const redirectUrl = approve.json<{ redirectUrl: string }>().redirectUrl;
    const callback = await resolveOAuthRedirectBridge(redirectUrl);
    expect(callback.origin + callback.pathname).toBe("http://localhost:5555/callback");
    expect(callback.searchParams.get("code")).toBeTruthy();
    expect(callback.searchParams.get("state")).toBe("state-123");
  });
});
