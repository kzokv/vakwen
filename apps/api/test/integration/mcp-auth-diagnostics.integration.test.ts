import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revokeAiConnectorConnection } from "../../src/services/mcpConnectorLifecycle.js";
import { buildApp } from "../../src/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;
const secret = "test-diagnostic-signing-secret-at-least-32-chars";
function signedToken(overrides: Record<string, unknown> = {}, signingSecret = secret) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const input = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({
    iss: "http://localhost:4000", aud: "http://localhost:4000/mcp", resource: "http://localhost:4000/mcp",
    sub: "user-1", connectionId: "diagnostic-connection", client_id: "chatgpt", sv: 1,
    scope: "portfolio:mcp_read", iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 900,
    jti: "diagnostic-token", ...overrides,
  })}`;
  return `${input}.${createHmac("sha256", signingSecret).update(input).digest("base64url")}`;
}
async function request(token: string, method = "initialize", sessionId?: string) {
  return app.inject({ method: "POST", url: "/mcp", headers: {
    host: "localhost:4000", "x-request-id": "Bearer secret-caller-supplied-correlation", authorization: `Bearer ${token}`, accept: "application/json, text/event-stream",
    ...(sessionId ? { "mcp-session-id": sessionId } : {}),
  }, payload: { jsonrpc: "2.0", id: "diagnostics", method, params: method === "initialize"
    ? { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "test", version: "1" } }
    : { name: "list_portfolio_contexts", arguments: {} },
  } });
}
describe("trusted MCP authentication diagnostics", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
    await app.persistence.setAppConfigEncryptedSecret("mcpOauthTokenSecret", secret);
    await app.persistence.saveAiConnectorConnection({ id: "diagnostic-connection", userId: "user-1",
      provider: "chatgpt", vendor: "openai", clientKind: "chatgpt_app", authMode: "oauth", oauthClientId: "chatgpt",
      displayName: "Personal connection", status: "active", scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
  });
  afterEach(async () => { vi.restoreAllMocks(); await app.close(); });

  it("signed expired token: initialize denied → attributable expired history without credentials", async () => {
    const token = signedToken({ exp: 1 });
    expect((await request(token)).statusCode).toBe(401);
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ connectionId: "diagnostic-connection", result: "denied", denialReason: "mcp_auth_expired" });
    expect(logs[0]?.requestId).toBeTruthy();
    expect(JSON.stringify(logs)).not.toContain(token);
    expect(JSON.stringify(logs)).not.toContain("secret-caller-supplied-correlation");
  });

  it("selected replacement: existing session call → challenge and precise connection history", async () => {
    const token = signedToken();
    const initialized = await request(token);
    expect(initialized.statusCode).toBe(200);
    await revokeAiConnectorConnection(app, "diagnostic-connection", { reason: "replaced_by_oauth_authorization", revokedByUserId: "user-1" });
    const response = await request(token, "tools/call", String(initialized.headers["mcp-session-id"]));
    expect(response.json().result._meta["mcp/www_authenticate"]).toBeDefined();
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ toolName: "list_portfolio_contexts", denialReason: "mcp_connection_replaced" });
  });

  it("audit persistence outage: rejected signed token → original authentication error", async () => {
    vi.spyOn(app.persistence, "appendAiConnectorAccessLog").mockRejectedValueOnce(new Error("audit unavailable"));
    const response = await request(signedToken({ exp: 1 }));
    expect(response.statusCode).toBe(401);
    expect(response.json().error).toBe("mcp_auth_expired");
  });

  it.each(["forged", "audience", "client"])("untrusted %s binding: failure → no guessed user history", async (kind) => {
    const token = kind === "forged" ? signedToken({}, "wrong-secret")
      : signedToken(kind === "audience" ? { aud: "https://foreign.invalid/mcp" } : { client_id: "foreign-client" });
    expect((await request(token)).statusCode).not.toBe(200);
    expect(await app.persistence.listAiConnectorAccessLogsForUser("user-1")).toEqual([]);
  });
});
