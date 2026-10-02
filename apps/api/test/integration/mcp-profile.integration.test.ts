import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";

let app: Awaited<ReturnType<typeof buildApp>>;
const headers = (userId = "user-1", scopes: string[] = []) => ({
  authorization: `Bearer vakwen-dev.${Buffer.from(JSON.stringify({ userId, scopes })).toString("base64url")}`,
  accept: "application/json, text/event-stream",
});
async function session(authorization = headers()) {
  const response = await app.inject({ method: "POST", url: "/mcp", headers: authorization, payload: {
    jsonrpc: "2.0", id: "init", method: "initialize", params: {
      protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "profile-test", version: "1" },
    },
  } });
  expect(response.statusCode).toBe(200);
  return String(response.headers["mcp-session-id"]);
}
async function profile(sessionId: string, args = {}, authorization = headers()) {
  const response = await app.inject({ method: "POST", url: "/mcp", headers: {
    ...authorization, "mcp-session-id": sessionId,
  }, payload: { jsonrpc: "2.0", id: "profile", method: "tools/call", params: { name: "get_profile", arguments: args } } });
  expect(response.statusCode).toBe(200);
  return response.json();
}
describe("connected profile", () => {
  beforeEach(async () => { app = await buildApp({ persistenceBackend: "memory" }); });
  afterEach(async () => { await app.close(); });

  it("authenticated credentials: reconnect without portfolio scopes → same opaque profile", async () => {
    const first = await profile(await session());
    expect(first.result?.isError).not.toBe(true);
    expect(first.result?.structuredContent).toMatchObject({ id: expect.stringMatching(/^prf_[a-f0-9]{64}$/) });
    const second = await profile(await session());
    expect(second.result.structuredContent.id).toBe(first.result.structuredContent.id);
    expect(JSON.parse(first.result.content[0].text)).toEqual(first.result.structuredContent);
  });

  it("generated bearer: admin removes all granted groups → profile works and data remains denied", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ bearerFallback: {
      enabled: true, allowedClientKinds: ["codex_cli"], allowedToolGroups: ["read"],
      maxLifetimeDays: 7, maxActiveConnectorsPerUser: 1,
    } });
    const created = await app.inject({ method: "POST", url: "/ai/connectors/bearer", payload: {
      clientKind: "codex_cli", displayName: "Profile regression", scopes: ["portfolio:mcp_read"], lifetimeDays: 7,
    } });
    expect(created.statusCode).toBe(200);
    const authorization = { ...headers(), authorization: `Bearer ${created.json().bearerToken}` };
    const before = await profile(await session(authorization), {}, authorization);
    expect(before.result.isError).not.toBe(true);
    await app.persistence.saveAiConnectorPolicySettings({ bearerFallback: { allowedToolGroups: [] } });
    const sessionId = await session(authorization);
    const after = await profile(sessionId, {}, authorization);
    expect(after.result.isError).not.toBe(true);
    expect(after.result.structuredContent.id).toBe(before.result.structuredContent.id);
    const denied = await app.inject({ method: "POST", url: "/mcp", headers: {
      ...authorization, "mcp-session-id": sessionId,
    }, payload: { jsonrpc: "2.0", id: "read-denied", method: "tools/call", params: {
      name: "get_portfolio_overview", arguments: {},
    } } });
    expect(denied.statusCode).toBe(200);
    expect(denied.json().result.isError).toBe(true);
    expect(denied.body).toContain("mcp_bearer_tool_group_disabled");
    await app.persistence.saveAiConnectorPolicySettings({ bearerFallback: { enabled: false } });
    const disabled = await profile(sessionId, {}, authorization);
    expect(disabled.result.isError).toBe(true);
    expect(disabled.result.structuredContent).toBeUndefined();
    expect(disabled.result._meta["mcp/www_authenticate"].join(" ")).toContain("MCP bearer fallback is disabled");
  });

  it("distinct users and display changes: same session → credential-bound stable identities", async () => {
    const sessionId = await session();
    const first = await profile(sessionId);
    const other = await app.persistence.resolveOrCreateUser("google", "profile-other-subject", {
      email: "profile-other@example.com", name: "Original name",
    });
    const second = await profile(sessionId, {}, headers(other.userId));
    expect(second.result.isError).not.toBe(true);
    expect(second.result.structuredContent.id).not.toBe(first.result.structuredContent.id);
    await app.persistence.resolveOrCreateUser("google", "profile-other-subject", {
      email: "profile-other@example.com", name: "Changed name",
    });
    const renamed = await profile(sessionId, {}, headers(other.userId));
    expect(renamed.result.structuredContent.id).toBe(second.result.structuredContent.id);
    expect(renamed.result.structuredContent.name).toBe("Changed name");
  });

  it("delegated portfolio read: same MCP session → profile remains the authenticated user", async () => {
    const owner = await app.persistence.resolveOrCreateUser("google", "profile-portfolio-owner", {
      email: "profile-owner@example.com", name: "Portfolio owner",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: owner.userId, granteeUserId: "user-1",
      auditInput: { actorUserId: owner.userId, ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id, capabilities: ["portfolio:mcp_read"], grantedByUserId: owner.userId,
    });
    const sessionId = await session();
    const before = await profile(sessionId);
    const authorization = headers("user-1", ["portfolio:mcp_read"]);
    const delegated = await app.inject({
      method: "POST", url: "/mcp", headers: { ...authorization, "mcp-session-id": sessionId },
      payload: { jsonrpc: "2.0", id: "delegated-read", method: "tools/call", params: {
        name: "get_portfolio_overview", arguments: { portfolioContextUserId: owner.userId },
      } },
    });
    expect(delegated.statusCode).toBe(200);
    expect(delegated.json().result.isError).not.toBe(true);
    expect(await app.persistence.listAiConnectorAccessLogsForUser("user-1")).toEqual(expect.arrayContaining([
      expect.objectContaining({ toolName: "get_portfolio_overview", portfolioContextUserId: owner.userId, shareId: share.id, result: "ok" }),
    ]));
    const after = await profile(sessionId, {}, authorization);
    const ownerProfile = await profile(sessionId, {}, headers(owner.userId));
    expect(after.result.structuredContent.id).toBe(before.result.structuredContent.id);
    expect(after.result.structuredContent.id).not.toBe(ownerProfile.result.structuredContent.id);
  });

  it("profile discovery: list tools → profile marker and strict response schema", async () => {
    const response = await app.inject({ method: "POST", url: "/mcp", headers: {
      ...headers(), "mcp-session-id": await session(),
    }, payload: { jsonrpc: "2.0", id: "tools", method: "tools/list", params: {} } });
    const tool = response.json().result.tools.find((item: { name: string }) => item.name === "get_profile");
    expect(tool).toBeDefined();
    expect(tool._meta["openai/profile"]).toBe(true);
    expect(tool.securitySchemes).toEqual([{ type: "oauth2", scopes: [] }]);
    expect(tool.outputSchema.required).toContain("id");
    expect(tool.outputSchema.additionalProperties).toBe(false);
  });

  it("profile selector injection: foreign user arguments → rejected", async () => {
    const result = await profile(await session(), { portfolioContextUserId: "foreign-user" });
    expect(result.result?.isError ?? Boolean(result.error)).toBe(true);
  });

  it("profile authentication: missing credential → challenge without identity", async () => {
    const result = await profile(await session(), {}, { accept: "application/json, text/event-stream" } as ReturnType<typeof headers>);
    expect(result.result.isError).toBe(true);
    expect(result.result.structuredContent).toBeUndefined();
    expect(result.result._meta["mcp/www_authenticate"]).toBeDefined();
    expect(result.result._meta["mcp/www_authenticate"].join(" ")).not.toContain('scope=');
  });
});
