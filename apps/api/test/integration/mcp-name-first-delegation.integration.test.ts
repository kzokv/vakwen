import { Buffer } from "node:buffer";
import type { AiConnectorScope } from "@vakwen/shared-types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { listMcpToolDefinitions } from "../../src/mcp/tools.js";
import { createAiConnectorConnection } from "../../src/services/mcpConnectorLifecycle.js";

let app: Awaited<ReturnType<typeof buildApp>>;

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-at-least-32-chars",
};

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

async function initializeMcpSession(headers: Record<string, string>) {
  const initialize = await app.inject({
    method: "POST",
    url: "/mcp",
    headers,
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
  return String(sessionId);
}

async function callMcpTool(
  headers: Record<string, string>,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/mcp",
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    payload: {
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
}

async function setupDelegatedMcp(options: {
  key: string;
  shareCapabilities: Array<Exclude<AiConnectorScope, "research:read">>;
  connectionScopes?: AiConnectorScope[];
}) {
  await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
  const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", options.key, {
    email: `${options.key}@example.com`,
    name: options.key
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" "),
  });
  const share = await app.persistence.createShareGrant({
    ownerUserId: "user-1",
    granteeUserId: sharedUserId,
    auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
  });
  await app.persistence.setShareCapabilities({
    shareId: share.id,
    capabilities: options.shareCapabilities,
    grantedByUserId: "user-1",
  });
  const connection = await createAiConnectorConnection(
    app,
    {
      userId: sharedUserId,
      provider: "chatgpt",
      displayName: "ChatGPT",
      scopes: options.connectionScopes ?? options.shareCapabilities,
    },
    { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
  );
  const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
  const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
  const sessionId = await initializeMcpSession(headers);
  const contexts = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
  const contextsBody = parseMcpJson<{
    result: {
      structuredContent: {
        portfolios: Array<{ label: string; email: string | null; isSelf: boolean }>;
      };
    };
  }>(contexts.body);
  const delegated = contextsBody.result.structuredContent.portfolios.find((portfolio) => !portfolio.isSelf);
  expect(delegated).toBeDefined();
  return {
    sharedUserId,
    headers,
    sessionId,
    portfolio: { label: delegated!.label, ...(delegated!.email ? { email: delegated!.email } : {}) },
  };
}

describe("mcp name-first delegation", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    await app.close();
  });

  it("[catalog]: name-first tools are model-visible while legacy lifecycle tools are app-visible", async () => {
    const definitionsByName = new Map(listMcpToolDefinitions().map((tool) => [tool.name, tool]));
    expect(definitionsByName.get("list_portfolio_contexts")?.scope).toBe("portfolio:mcp_read");
    expect(definitionsByName.get("create_account_by_name")?.scope).toBe("account:manage");
    expect(definitionsByName.get("create_transaction_draft_batch_by_name")?.scope).toBe("transaction_draft:create");
    expect(definitionsByName.get("post_transaction_draft_rows_by_name")?.scope).toBe("transaction:write");

    for (const legacyName of [
      "create_account",
      "update_account",
      "soft_delete_account",
      "restore_account",
      "create_transaction_draft_batch",
      "update_transaction_draft_rows",
      "post_transaction_draft_rows",
    ] as const) {
      expect(definitionsByName.get(legacyName)?._meta).toMatchObject({
        ui: { visibility: ["app"] },
      });
    }

    const token = devToken({ userId: "user-1", scopes: ["portfolio:mcp_read", "account:manage", "transaction_draft:create", "transaction:write"] });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
    const sessionId = await initializeMcpSession(headers);
    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: { ...headers, "mcp-session-id": sessionId },
      payload: { jsonrpc: "2.0", id: "list-1", method: "tools/list" },
    });
    expect(listTools.statusCode).toBe(200);
    const body = parseMcpJson<{ result: { tools: Array<{ name: string; _meta?: { ui?: { visibility?: string[] } } }> } }>(listTools.body);
    const listedByName = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    expect(listedByName.get("create_account")?._meta?.ui?.visibility).toEqual(["app"]);
    expect(listedByName.get("create_account_by_name")?._meta?.ui?.visibility).toEqual(["model", "app"]);
    expect(listedByName.get("get_recent_transactions")?._meta?.ui?.visibility).toEqual(["model", "app"]);
  });

  it("[portfolio contexts]: delegated labels/emails/capabilities are discoverable without exposing ids in content", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "name-first-context-user", {
      email: "name-first-context@example.com",
      name: "Name First Context User",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "account:manage"],
      grantedByUserId: "user-1",
    });
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "account:manage"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
    const sessionId = await initializeMcpSession(headers);

    const response = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        structuredContent: {
          portfolios: Array<{ label: string; email: string | null; isSelf: boolean; capabilities: string[] }>;
        };
        _meta?: { portfolios?: Array<{ userId: string; shareId: string | null }> };
      };
    }>(response.body);
    expect(body.result.structuredContent.portfolios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          isSelf: false,
          capabilities: expect.arrayContaining(["portfolio:mcp_read", "account:manage"]),
        }),
      ]),
    );
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("userId");
    expect(JSON.stringify(body.result.structuredContent)).not.toContain("shareId");
    expect(body.result._meta?.portfolios).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ userId: "user-1", shareId: share.id }),
      ]),
    );
  });

  it("[account wrappers]: delegated preview requires portfolio selector and returns digest by human account name", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "name-first-account-user", {
      email: "name-first-account@example.com",
      name: "Name First Account User",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "account:manage"],
      grantedByUserId: "user-1",
    });
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "account:manage"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
    const sessionId = await initializeMcpSession(headers);

    const missingPortfolio = await callMcpTool(headers, sessionId, "preview_create_account_by_name", {
      name: "Delegated Name First Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(missingPortfolio.statusCode).toBe(200);
    expect(missingPortfolio.body).toContain("Model-facing delegated MCP write tools require portfolio");

    const rawIdSelector = await callMcpTool(headers, sessionId, "preview_create_account_by_name", {
      portfolioContextUserId: "user-1",
      name: "Delegated Name First Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(rawIdSelector.statusCode).toBe(200);
    expect(rawIdSelector.body).toContain("portfolioContextUserId is only supported by legacy widget/internal tools");

    const contexts = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
    const contextsBody = parseMcpJson<{
      result: {
        structuredContent: {
          portfolios: Array<{ label: string; email: string | null; isSelf: boolean }>;
        };
      };
    }>(contexts.body);
    const delegated = contextsBody.result.structuredContent.portfolios.find((portfolio) => !portfolio.isSelf);
    expect(delegated).toBeDefined();

    const mixedRawIdSelector = await callMcpTool(headers, sessionId, "preview_create_account_by_name", {
      portfolio: { label: delegated!.label, ...(delegated!.email ? { email: delegated!.email } : {}) },
      portfolioContextUserId: "user-1",
      name: "Delegated Name First Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(mixedRawIdSelector.statusCode).toBe(200);
    expect(mixedRawIdSelector.body).toContain("portfolioContextUserId is only supported by legacy widget/internal tools");

    const preview = await callMcpTool(headers, sessionId, "preview_create_account_by_name", {
      portfolio: { label: delegated!.label, ...(delegated!.email ? { email: delegated!.email } : {}) },
      name: "Delegated Name First Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = parseMcpJson<{
      result: {
        structuredContent: {
          portfolio: { label: string; isDelegated: boolean };
          account: { name: string };
          confirmationSummary: string;
          confirmationDigest: string;
        };
      };
    }>(preview.body);
    expect(previewBody.result.structuredContent).toMatchObject({
      portfolio: { label: delegated!.label, isDelegated: true },
      account: { name: "Delegated Name First Account" },
    });
    expect(previewBody.result.structuredContent.confirmationSummary).toContain("Delegated Name First Account");
    expect(previewBody.result.structuredContent.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(previewBody.result.structuredContent)).not.toContain("accountId");
  });

  it("[read selectors]: legacy context id disambiguates duplicate portfolio labels", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "duplicate-label-grantee", {
      email: "duplicate-label-grantee@example.com",
      name: "Duplicate Label Grantee",
    });
    const { userId: firstOwnerId } = await app.persistence.resolveOrCreateUser("google", "duplicate-label-owner-a", {
      email: "duplicate-label-owner-a@example.com",
      name: "Duplicate Portfolio",
    });
    const { userId: secondOwnerId } = await app.persistence.resolveOrCreateUser("google", "duplicate-label-owner-b", {
      email: "duplicate-label-owner-b@example.com",
      name: "Duplicate Portfolio",
    });
    for (const ownerUserId of [firstOwnerId, secondOwnerId]) {
      const share = await app.persistence.createShareGrant({
        ownerUserId,
        granteeUserId: sharedUserId,
        auditInput: { actorUserId: ownerUserId, ipAddress: "127.0.0.1" },
      });
      await app.persistence.setShareCapabilities({
        shareId: share.id,
        capabilities: ["portfolio:mcp_read"],
        grantedByUserId: ownerUserId,
      });
    }
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
    const sessionId = await initializeMcpSession(headers);

    const ambiguous = await callMcpTool(headers, sessionId, "get_recent_transactions", {
      portfolio: { label: "Duplicate Portfolio" },
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      limit: 10,
      offset: 0,
    });
    expect(ambiguous.statusCode).toBe(200);
    expect(ambiguous.body).toContain("matched multiple portfolios");

    const disambiguated = await callMcpTool(headers, sessionId, "get_recent_transactions", {
      portfolio: { label: "Duplicate Portfolio" },
      portfolioContextUserId: firstOwnerId,
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      limit: 10,
      offset: 0,
    });
    expect(disambiguated.statusCode).toBe(200);
    const disambiguatedBody = parseMcpJson<{
      result: { structuredContent: { portfolioContextUserId: string; total: number } };
    }>(disambiguated.body);
    expect(disambiguatedBody.result.structuredContent).toMatchObject({
      portfolioContextUserId: firstOwnerId,
      total: 0,
    });
  });

  it("[draft accounts]: edit-only delegates can list draftable account names", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "draftable-edit-user", {
      email: "draftable-edit@example.com",
      name: "Draftable Edit User",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction_draft:edit"],
      grantedByUserId: "user-1",
    });
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:edit"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
    const sessionId = await initializeMcpSession(headers);
    const contexts = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
    const contextsBody = parseMcpJson<{
      result: { structuredContent: { portfolios: Array<{ label: string; email: string | null; isSelf: boolean }> } };
    }>(contexts.body);
    const delegated = contextsBody.result.structuredContent.portfolios.find((portfolio) => !portfolio.isSelf);
    expect(delegated).toBeDefined();

    const listed = await callMcpTool(headers, sessionId, "list_draftable_account_names", {
      portfolio: { label: delegated!.label, ...(delegated!.email ? { email: delegated!.email } : {}) },
    });
    expect(listed.statusCode).toBe(200);
    const listedBody = parseMcpJson<{ result: { structuredContent: { accounts: Array<{ name: string }> } } }>(listed.body);
    expect(listedBody.result.structuredContent.accounts.length).toBeGreaterThan(0);
  });

  it("[account wrappers]: delegated create, update, soft-delete, and restore report human names", async () => {
    const { headers, sessionId, portfolio } = await setupDelegatedMcp({
      key: "account-lifecycle-delegate",
      shareCapabilities: ["portfolio:mcp_read", "account:manage"],
    });
    const originalName = "Lifecycle Name First Account";
    const renamed = "Lifecycle Name First Account Renamed";

    const createPreview = await callMcpTool(headers, sessionId, "preview_create_account_by_name", {
      portfolio,
      name: originalName,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(createPreview.statusCode).toBe(200);
    const createPreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(createPreview.body);
    const created = await callMcpTool(headers, sessionId, "create_account_by_name", {
      portfolio,
      name: originalName,
      defaultCurrency: "TWD",
      accountType: "broker",
      confirmationSummary: createPreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: createPreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(created.statusCode).toBe(200);
    expect(JSON.stringify(parseMcpJson<{ result: { structuredContent: unknown } }>(created.body).result.structuredContent)).not.toContain("accountId");

    const updatePreview = await callMcpTool(headers, sessionId, "preview_update_account_by_name", {
      portfolio,
      accountName: originalName,
      name: renamed,
      accountType: "wallet",
    });
    const updatePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(updatePreview.body);
    const updated = await callMcpTool(headers, sessionId, "update_account_by_name", {
      portfolio,
      accountName: originalName,
      name: renamed,
      accountType: "wallet",
      confirmationSummary: updatePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: updatePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(updated.statusCode).toBe(200);
    const updatedBody = parseMcpJson<{ result: { structuredContent: { account: { name: string; accountType: string } } } }>(updated.body);
    expect(updatedBody.result.structuredContent.account).toMatchObject({ name: renamed, accountType: "wallet" });

    const deletePreview = await callMcpTool(headers, sessionId, "preview_soft_delete_account_by_name", {
      portfolio,
      accountName: renamed,
    });
    const deletePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(deletePreview.body);
    const deleted = await callMcpTool(headers, sessionId, "soft_delete_account_by_name", {
      portfolio,
      accountName: renamed,
      confirmationSummary: deletePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: deletePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(deleted.statusCode).toBe(200);

    const collisionPreview = await callMcpTool(headers, sessionId, "preview_create_account_by_name", {
      portfolio,
      name: renamed,
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    const collisionPreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(collisionPreview.body);
    const collision = await callMcpTool(headers, sessionId, "create_account_by_name", {
      portfolio,
      name: renamed,
      defaultCurrency: "TWD",
      accountType: "broker",
      confirmationSummary: collisionPreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: collisionPreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(collision.statusCode).toBe(200);

    const restorePreview = await callMcpTool(headers, sessionId, "preview_restore_account_by_name", {
      portfolio,
      accountName: renamed,
    });
    expect(restorePreview.statusCode).toBe(200);
    const restorePreviewBody = parseMcpJson<{
      result: {
        structuredContent: {
          account: { deletedName: string; finalName: string };
          confirmationSummary: string;
          confirmationDigest: string;
        };
      };
    }>(restorePreview.body);
    expect(restorePreviewBody.result.structuredContent.account).toMatchObject({
      deletedName: renamed,
      finalName: `${renamed} (restored)`,
    });
    const restored = await callMcpTool(headers, sessionId, "restore_account_by_name", {
      portfolio,
      accountName: renamed,
      confirmationSummary: restorePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: restorePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(restored.statusCode).toBe(200);
    const restoredBody = parseMcpJson<{ result: { structuredContent: { account: { requestedName: string; finalName: string } } } }>(restored.body);
    expect(restoredBody.result.structuredContent.account).toMatchObject({
      requestedName: renamed,
      finalName: `${renamed} (restored)`,
    });
    expect(JSON.stringify(restoredBody.result.structuredContent)).not.toContain("accountId");
  });

  it("[account wrappers]: blocks ambiguous names and missing delegated account capability", async () => {
    const { headers, sessionId, portfolio } = await setupDelegatedMcp({
      key: "account-ambiguity-delegate",
      shareCapabilities: ["portfolio:mcp_read", "account:manage"],
    });
    const store = await app.persistence.loadStore("user-1");
    const base = store.accounts[0]!;
    store.accounts.push({
      ...base,
      id: "duplicate-active-account-for-mcp-name-test",
      name: base.name,
      feeProfileId: base.feeProfileId,
    });

    const ambiguousActive = await callMcpTool(headers, sessionId, "preview_update_account_by_name", {
      portfolio,
      accountName: base.name,
      accountType: "wallet",
    });
    expect(ambiguousActive.statusCode).toBe(200);
    expect(ambiguousActive.body).toContain("matched multiple accounts");

    await app.persistence.softDeleteAccount(base.id, "user-1", {
      actorUserId: "user-1",
      ipAddress: "127.0.0.1",
      metadata: {},
    });
    await app.persistence.softDeleteAccount("duplicate-active-account-for-mcp-name-test", "user-1", {
      actorUserId: "user-1",
      ipAddress: "127.0.0.1",
      metadata: {},
    });

    const ambiguousDeleted = await callMcpTool(headers, sessionId, "preview_restore_account_by_name", {
      portfolio,
      accountName: base.name,
    });
    expect(ambiguousDeleted.statusCode).toBe(200);
    expect(ambiguousDeleted.body).toContain("matched multiple accounts");

    const denied = await setupDelegatedMcp({
      key: "account-capability-denied-delegate",
      shareCapabilities: ["portfolio:mcp_read"],
      connectionScopes: ["portfolio:mcp_read", "account:manage"],
    });
    const deniedPreview = await callMcpTool(denied.headers, denied.sessionId, "preview_create_account_by_name", {
      portfolio: denied.portfolio,
      name: "Should Not Create",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(deniedPreview.statusCode).toBe(200);
    expect(deniedPreview.body).toContain("shared_capability_required");
    expect(deniedPreview.body).toContain("requiredCapabilities");
    expect(deniedPreview.body).not.toContain("shareId");
    expect(deniedPreview.body).not.toContain("sessionUserId");
    expect(deniedPreview.body).not.toContain("contextUserId");
  });

  it("[draft wrappers]: delegated row and batch lifecycle uses batch labels and row numbers", async () => {
    const { headers, sessionId, portfolio } = await setupDelegatedMcp({
      key: "draft-lifecycle-delegate",
      shareCapabilities: [
        "portfolio:mcp_read",
        "transaction_draft:create",
        "transaction_draft:edit",
        "transaction_draft:archive",
        "transaction_draft:delete",
      ],
    });
    const ownerStore = await app.persistence.loadStore("user-1");
    const accountName = ownerStore.accounts[0]!.name;
    const candidates = [
      {
        rowNumber: 1,
        recordType: "trade",
        accountName,
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 2,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-02-03",
      },
      {
        rowNumber: 2,
        recordType: "trade",
        accountName,
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 3,
        unitPrice: 101,
        priceCurrency: "TWD",
        tradeDate: "2026-02-04",
      },
    ];

    const preflight = await callMcpTool(headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
      portfolio,
      sourceLabel: "row lifecycle import",
      candidates,
    });
    const preflightBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(preflight.body);
    const created = await callMcpTool(headers, sessionId, "create_transaction_draft_batch_by_name", {
      portfolio,
      sourceLabel: "row lifecycle import",
      candidates,
      confirmationSummary: preflightBody.result.structuredContent.confirmationSummary,
      confirmationDigest: preflightBody.result.structuredContent.confirmationDigest,
    });
    expect(created.statusCode).toBe(200);
    const batchLabel = "row lifecycle import";

    const initialBatch = await callMcpTool(headers, sessionId, "get_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel,
    });
    expect(initialBatch.statusCode).toBe(200);
    const initialBatchBody = parseMcpJson<{
      result: { structuredContent: { rows: Array<{ rowNumber: number; state: string }> } };
    }>(initialBatch.body);
    expect(initialBatchBody.result.structuredContent.rows.map((row) => row.rowNumber)).toEqual([1, 2]);
    expect(JSON.stringify(initialBatchBody.result.structuredContent)).not.toContain("rowId");

    const shown = await callMcpTool(headers, sessionId, "show_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel,
    });
    expect(shown.statusCode).toBe(200);
    const shownBody = parseMcpJson<{
      result: { structuredContent: { summary: { rowCount: number; readyRowCount: number } } };
    }>(shown.body);
    expect(shownBody.result.structuredContent.summary).toMatchObject({ rowCount: 2, readyRowCount: 2 });

    const updatePreview = await callMcpTool(headers, sessionId, "update_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rows: [{ rowNumber: 1, patch: { unitPrice: 102 } }],
    });
    const updatePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(updatePreview.body);
    const updated = await callMcpTool(headers, sessionId, "update_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rows: [{ rowNumber: 1, patch: { unitPrice: 102 } }],
      confirmationSummary: updatePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: updatePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(updated.statusCode).toBe(200);

    const excludePreview = await callMcpTool(headers, sessionId, "exclude_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [1],
    });
    const excludePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(excludePreview.body);
    const excluded = await callMcpTool(headers, sessionId, "exclude_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [1],
      confirmationSummary: excludePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: excludePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(excluded.statusCode).toBe(200);

    const reincludePreview = await callMcpTool(headers, sessionId, "reinclude_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [1],
    });
    const reincludePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(reincludePreview.body);
    const reincluded = await callMcpTool(headers, sessionId, "reinclude_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [1],
      confirmationSummary: reincludePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: reincludePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(reincluded.statusCode).toBe(200);

    const rejectPreview = await callMcpTool(headers, sessionId, "reject_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [2],
    });
    const rejectPreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(rejectPreview.body);
    const rejected = await callMcpTool(headers, sessionId, "reject_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [2],
      confirmationSummary: rejectPreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: rejectPreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(rejected.statusCode).toBe(200);

    const afterRows = await callMcpTool(headers, sessionId, "get_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel,
    });
    const afterRowsBody = parseMcpJson<{
      result: { structuredContent: { rows: Array<{ rowNumber: number; state: string; unitPrice: number | null }> } };
    }>(afterRows.body);
    expect(afterRowsBody.result.structuredContent.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ rowNumber: 1, state: "ready", unitPrice: 102 }),
        expect.objectContaining({ rowNumber: 2, state: "rejected" }),
      ]),
    );

    const deletePreflight = await callMcpTool(headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
      portfolio,
      sourceLabel: "delete lifecycle import",
      candidates: [{ ...candidates[0], rowNumber: 1, unitPrice: 110 }],
    });
    const deletePreflightBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(deletePreflight.body);
    await callMcpTool(headers, sessionId, "create_transaction_draft_batch_by_name", {
      portfolio,
      sourceLabel: "delete lifecycle import",
      candidates: [{ ...candidates[0], rowNumber: 1, unitPrice: 110 }],
      confirmationSummary: deletePreflightBody.result.structuredContent.confirmationSummary,
      confirmationDigest: deletePreflightBody.result.structuredContent.confirmationDigest,
    });
    const deletePreview = await callMcpTool(headers, sessionId, "delete_unconfirmed_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel: "delete lifecycle import",
    });
    const deletePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(deletePreview.body);
    const deleted = await callMcpTool(headers, sessionId, "delete_unconfirmed_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel: "delete lifecycle import",
      confirmationSummary: deletePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: deletePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(deleted.statusCode).toBe(200);

    const archivePreview = await callMcpTool(headers, sessionId, "archive_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel,
    });
    const archivePreviewBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(archivePreview.body);
    const archived = await callMcpTool(headers, sessionId, "archive_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel,
      confirmationSummary: archivePreviewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: archivePreviewBody.result.structuredContent.confirmationDigest,
    });
    expect(archived.statusCode).toBe(200);
    const archivedBody = parseMcpJson<{ result: { structuredContent: { batch: { status: string } } } }>(archived.body);
    expect(archivedBody.result.structuredContent.batch.status).toBe("archived");
    expect(JSON.stringify(archivedBody.result.structuredContent)).not.toContain("batchId");
  });

  it("[draft wrappers]: rejects account ids, blocks ambiguous batch labels, and compacts large confirmation summaries", async () => {
    const { headers, sessionId, portfolio } = await setupDelegatedMcp({
      key: "draft-ambiguity-delegate",
      shareCapabilities: ["portfolio:mcp_read", "transaction_draft:create", "transaction_draft:edit"],
    });
    const ownerStore = await app.persistence.loadStore("user-1");
    const account = ownerStore.accounts[0]!;
    const accountName = account.name;

    const forbiddenAccountId = await callMcpTool(headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
      portfolio,
      sourceLabel: "forbidden account id import",
      candidates: [
        {
          rowNumber: 1,
          recordType: "trade",
          accountId: account.id,
          type: "BUY",
          ticker: "2330",
          marketCode: "TW",
          quantity: 1,
          unitPrice: 100,
          priceCurrency: "TWD",
          tradeDate: "2026-03-01",
        },
      ],
    });
    expect(forbiddenAccountId.statusCode).toBe(200);
    expect(forbiddenAccountId.body).toContain("Unrecognized key(s)");
    expect(forbiddenAccountId.body).toContain("accountId");

    const manyCandidates = Array.from({ length: 21 }, (_, index) => ({
      rowNumber: index + 1,
      recordType: "trade",
      accountName,
      type: "BUY",
      ticker: "2330",
      marketCode: "TW",
      quantity: 1,
      unitPrice: 100 + index,
      priceCurrency: "TWD",
      tradeDate: "2026-03-01",
    }));
    const bulkPreflight = await callMcpTool(headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
      portfolio,
      sourceLabel: "bulk compact import",
      candidates: manyCandidates,
    });
    expect(bulkPreflight.statusCode).toBe(200);
    const bulkPreflightBody = parseMcpJson<{
      result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
    }>(bulkPreflight.body);
    expect(bulkPreflightBody.result.structuredContent.confirmationSummary).toContain("21 rows");
    expect(bulkPreflightBody.result.structuredContent.confirmationSummary).toContain("Review the batch carefully");
    expect(bulkPreflightBody.result.structuredContent.confirmationSummary).not.toContain("Row 1:");

    for (const unitPrice of [110, 111]) {
      const sourceLabel = "duplicate human batch label";
      const candidates = [{
        rowNumber: 1,
        recordType: "trade",
        accountName,
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice,
        priceCurrency: "TWD",
        tradeDate: "2026-03-02",
      }];
      const preflight = await callMcpTool(headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
        portfolio,
        sourceLabel,
        candidates,
      });
      const preflightBody = parseMcpJson<{
        result: { structuredContent: { confirmationSummary: string; confirmationDigest: string } };
      }>(preflight.body);
      const created = await callMcpTool(headers, sessionId, "create_transaction_draft_batch_by_name", {
        portfolio,
        sourceLabel,
        candidates,
        confirmationSummary: preflightBody.result.structuredContent.confirmationSummary,
        confirmationDigest: preflightBody.result.structuredContent.confirmationDigest,
      });
      expect(created.statusCode).toBe(200);
    }

    const listed = await callMcpTool(headers, sessionId, "list_transaction_draft_batches_by_name", {
      portfolio,
      status: "open",
      limit: 10,
    });
    const listedBody = parseMcpJson<{
      result: { structuredContent: { batches: Array<{ batchLabel: string }> } };
    }>(listed.body);
    const duplicateLabels = listedBody.result.structuredContent.batches
      .map((batch) => batch.batchLabel)
      .filter((label) => label.startsWith("duplicate human batch label"));
    expect(duplicateLabels).toHaveLength(2);
    expect(duplicateLabels.every((label) => /\(\d{4}-\d{2}-\d{2} \d{2}:\d{2} #[12]\)$/.test(label))).toBe(true);

    const ambiguous = await callMcpTool(headers, sessionId, "get_transaction_draft_batch_by_name", {
      portfolio,
      batchLabel: "duplicate human batch label",
    });
    expect(ambiguous.statusCode).toBe(200);
    expect(ambiguous.body).toContain("matched multiple draft batches");
  });

  it("[draft wrappers]: posting preview by batch label and row number keeps ids out of model-visible content", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "name-first-draft-user", {
      email: "name-first-draft@example.com",
      name: "Name First Draft User",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction_draft:create", "transaction_draft:edit", "transaction:write"],
      grantedByUserId: "user-1",
    });
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: sharedUserId,
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:create", "transaction_draft:edit", "transaction:write"],
      },
      { actorUserId: sharedUserId, ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: sharedUserId, connectionId: connection.id, clientId: "chatgpt" });
    const headers = { authorization: `Bearer ${token}`, accept: "application/json, text/event-stream" };
    const sessionId = await initializeMcpSession(headers);
    const ownerStore = await app.persistence.loadStore("user-1");
    const account = ownerStore.accounts[0]!;
    const accountName = account.name;
    const contexts = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
    const contextsBody = parseMcpJson<{
      result: {
        structuredContent: {
          portfolios: Array<{ label: string; email: string | null; isSelf: boolean }>;
        };
      };
    }>(contexts.body);
    const delegated = contextsBody.result.structuredContent.portfolios.find((portfolio) => !portfolio.isSelf);
    expect(delegated).toBeDefined();
    const portfolio = { label: delegated!.label, ...(delegated!.email ? { email: delegated!.email } : {}) };

    const candidates = [
      {
        rowNumber: 1,
        recordType: "trade",
        accountName,
        type: "BUY",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-05",
      },
    ];

    const preflight = await callMcpTool(headers, sessionId, "preflight_transaction_draft_candidates_by_name", {
      portfolio,
      sourceLabel: "name-first preview import",
      candidates,
    });
    expect(preflight.statusCode).toBe(200);
    const preflightBody = parseMcpJson<{
      result: {
        structuredContent: {
          confirmationSummary: string;
          confirmationDigest: string;
          rows: Array<{ rowNumber: number; normalized: { accountName: string | null } }>;
        };
      };
    }>(preflight.body);
    expect(preflightBody.result.structuredContent.rows[0]).toMatchObject({
      rowNumber: 1,
      normalized: { accountName },
    });
    expect(JSON.stringify(preflightBody.result.structuredContent)).not.toContain("accountId");

    const staleCreate = await callMcpTool(headers, sessionId, "create_transaction_draft_batch_by_name", {
      portfolio,
      sourceLabel: "name-first preview import",
      candidates,
      confirmationSummary: preflightBody.result.structuredContent.confirmationSummary,
      confirmationDigest: "0".repeat(64),
    });
    expect(staleCreate.statusCode).toBe(200);
    expect(staleCreate.body).toContain("confirmationSummary or confirmationDigest is stale");

    const created = await callMcpTool(headers, sessionId, "create_transaction_draft_batch_by_name", {
      portfolio,
      sourceLabel: "name-first preview import",
      candidates,
      confirmationSummary: preflightBody.result.structuredContent.confirmationSummary,
      confirmationDigest: preflightBody.result.structuredContent.confirmationDigest,
    });
    expect(created.statusCode).toBe(200);
    const createdBody = parseMcpJson<{ result: { structuredContent: { batch: { batchLabel: string } } } }>(created.body);
    expect(createdBody.result.structuredContent.batch.batchLabel).toBe("name-first preview import");
    expect(JSON.stringify(createdBody.result.structuredContent)).not.toContain("batchId");

    const listed = await callMcpTool(headers, sessionId, "list_transaction_draft_batches_by_name", {
      portfolio,
      status: "open",
      limit: 10,
    });
    const listedBody = parseMcpJson<{
      result: {
        structuredContent: {
          batches: Array<{ batchLabel: string }>;
        };
      };
    }>(listed.body);
    const batchLabel = listedBody.result.structuredContent.batches[0]?.batchLabel;
    expect(batchLabel).toBe("name-first preview import");

    const preview = await callMcpTool(headers, sessionId, "get_transaction_draft_posting_preview_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [1],
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = parseMcpJson<{
      result: {
        structuredContent: {
          batchLabel: string;
          rowNumbers: number[];
          preview: { rows: Array<{ rowNumber: number; accountName: string }>; groups: Array<{ accountName: string }> };
          confirmationSummary: string;
          confirmationDigest: string;
        };
        _meta?: { batchId?: string; rowIds?: string[] };
      };
    }>(preview.body);
    expect(previewBody.result.structuredContent.preview.rows[0]).toMatchObject({ rowNumber: 1, accountName });
    expect(previewBody.result.structuredContent.confirmationDigest).toMatch(/^[a-f0-9]{64}$/);
    const visibleJson = JSON.stringify(previewBody.result.structuredContent);
    expect(visibleJson).not.toContain("batchId");
    expect(visibleJson).not.toContain("rowId");
    expect(visibleJson).not.toContain("accountId");
    expect(previewBody.result._meta?.batchId).toBeTruthy();
    expect(previewBody.result._meta?.rowIds?.length).toBe(1);

    const posted = await callMcpTool(headers, sessionId, "post_transaction_draft_rows_by_name", {
      portfolio,
      batchLabel,
      rowNumbers: [1],
      idempotencyKey: "name-first-post-1",
      confirmationSummary: previewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(posted.statusCode).toBe(200);
    const postedBody = parseMcpJson<{
      result: {
        structuredContent: {
          outcome: string;
          batchLabel: string;
          postedRowNumbers: number[];
          createdTransactionCount: number;
        };
        _meta?: { postedRowIds?: string[]; createdTransactionIds?: string[] };
      };
    }>(posted.body);
    expect(postedBody.result.structuredContent).toMatchObject({
      outcome: "posted",
      batchLabel,
      postedRowNumbers: [1],
      createdTransactionCount: 1,
    });
    const postedVisibleJson = JSON.stringify(postedBody.result.structuredContent);
    expect(postedVisibleJson).not.toContain("batchId");
    expect(postedVisibleJson).not.toContain("rowId");
    expect(postedVisibleJson).not.toContain("accountId");
    expect(postedBody.result._meta?.postedRowIds?.length).toBe(1);
    expect(postedBody.result._meta?.createdTransactionIds?.length).toBe(1);

    const recentByName = await callMcpTool(headers, sessionId, "get_recent_transactions", {
      portfolio,
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      limit: 10,
      offset: 0,
      accountNames: [accountName],
    });
    expect(recentByName.statusCode).toBe(200);
    const recentByNameBody = parseMcpJson<{
      result: { structuredContent: { total: number; items: Array<{ accountName: string }> } };
    }>(recentByName.body);
    expect(recentByNameBody.result.structuredContent.total).toBe(1);
    expect(recentByNameBody.result.structuredContent.items[0]?.accountName).toBe(accountName);

    const cashByName = await callMcpTool(headers, sessionId, "get_cash_balance_summary", {
      portfolio,
      accountNames: [accountName],
    });
    expect(cashByName.statusCode).toBe(200);
    const cashByNameBody = parseMcpJson<{
      result: { structuredContent: { balances: Array<{ accountName: string; balanceAmount: number }> } };
    }>(cashByName.body);
    expect(cashByNameBody.result.structuredContent.balances.length).toBeGreaterThan(0);
    expect(cashByNameBody.result.structuredContent.balances.every((balance) => balance.accountName === accountName)).toBe(true);

    const recentById = await callMcpTool(headers, sessionId, "get_recent_transactions", {
      portfolioContextUserId: "user-1",
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      limit: 10,
      offset: 0,
      accountIds: [account.id],
    });
    expect(recentById.statusCode).toBe(200);
    const recentByIdBody = parseMcpJson<{ result: { structuredContent: { total: number } } }>(recentById.body);
    expect(recentByIdBody.result.structuredContent.total).toBe(1);

    const selectorConflict = await callMcpTool(headers, sessionId, "get_recent_transactions", {
      portfolio,
      portfolioContextUserId: sharedUserId,
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      limit: 10,
      offset: 0,
    });
    expect(selectorConflict.statusCode).toBe(200);
    expect(selectorConflict.body).toContain("portfolio and portfolioContextUserId resolved to different portfolios");

    const accountFilterConflict = await callMcpTool(headers, sessionId, "get_recent_transactions", {
      portfolio,
      fromDate: "2026-01-01",
      toDate: "2026-12-31",
      limit: 10,
      offset: 0,
      accountIds: ["not-the-account"],
      accountNames: [accountName],
    });
    expect(accountFilterConflict.statusCode).toBe(200);
    expect(accountFilterConflict.body).toContain("accountIds and accountNames resolved to different accounts");
  });
});
