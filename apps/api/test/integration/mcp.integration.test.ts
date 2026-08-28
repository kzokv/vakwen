import { Buffer } from "node:buffer";
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
  createAiConnectorConnection,
  hashGeneratedBearerToken,
} from "../../src/services/mcpConnectorLifecycle.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import { createTransactionDraftBatch } from "../../src/services/mcpDrafts.js";
import type { McpRequestContext } from "../../src/mcp/types.js";
import { mcpDevTokenAllowedForRuntime } from "../../src/mcp/auth.js";
import { listMcpToolDefinitions, setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { resetMcpRateLimitBucketsForTest } from "../../src/mcp/policy.js";
import { createDividendEvent } from "../../src/services/dividends.js";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  researchIdentityOutputSchema,
  researchIdentityToolOutputSchema,
  researchManifestOutputSchema,
  researchManifestToolOutputSchema,
} from "../../src/services/research/contracts.js";

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
  if (body.trim().startsWith("{")) {
    return JSON.parse(body) as T;
  }
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

function expectChatGptSafeSchema(schema: unknown): void {
  // ChatGPT drops the action list when descriptors contain unsupported schema keywords.
  const serialized = JSON.stringify(schema);
  expect(serialized).not.toContain("\"$ref\"");
  expect(serialized).not.toContain("\"$schema\"");
  expect(serialized).not.toContain("\"default\"");
  expect(serialized).not.toContain("\"exclusiveMinimum\"");
  expect(serialized).not.toContain("\"format\"");
  expect(serialized).not.toContain("\"multipleOf\"");
  expect(serialized).not.toContain("\"pattern\"");
}

function expectedToolOutputTemplate(toolName: string): string {
  if (toolName === "get_account_manager_component") return `${app.appBaseUrl}/connectors/chatgpt/account-manager`;
  if (toolName === "get_transaction_draft_batch_component") return `${app.appBaseUrl}/connectors/chatgpt/transaction-draft`;
  return "ui://widget/vakwen.html";
}

function expectedToolWidgetAccessible(toolName: string): boolean {
  return toolName === "get_account_manager_component" || toolName === "get_transaction_draft_batch_component";
}

function calendarImportPayload(year: number) {
  return {
    calendarYear: year,
    retrievedAt: `${year}-01-01T00:00:00.000Z`,
    coverage: {
      scope: "full_year" as const,
      evidence: `official calendar ${year}`,
    },
    exceptions: [],
  };
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
      id: "call-1",
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
  });
}

function createRequestContext(): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: "user-1",
      connection: null,
      scopes: [
        "portfolio:mcp_read",
        "transaction_draft:create",
        "transaction_draft:edit",
        "transaction_draft:archive",
        "transaction_draft:delete",
        "transaction:write",
      ],
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "test-request",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

async function createTrade(
  appInstance: Awaited<ReturnType<typeof buildApp>>,
  overrides: Partial<{
    accountId: string;
    ticker: string;
    marketCode: "TW" | "US" | "AU" | "KR" | "JP";
    type: "BUY" | "SELL";
    quantity: number;
    unitPrice: number;
    tradeDate: string;
    commissionAmount: number;
    taxAmount: number;
  }> = {},
) {
  const response = await appInstance.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `mcp-posted-trade-${Math.random().toString(36).slice(2)}` },
    payload: {
      accountId: overrides.accountId ?? "acc-1",
      ticker: overrides.ticker ?? "2330",
      marketCode: overrides.marketCode ?? "TW",
      type: overrides.type ?? "BUY",
      quantity: overrides.quantity ?? 10,
      unitPrice: overrides.unitPrice ?? 100,
      tradeDate: overrides.tradeDate ?? "2026-01-05",
      commissionAmount: overrides.commissionAmount ?? 0,
      taxAmount: overrides.taxAmount ?? 0,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ id: string }>();
}

async function seedMcpSharedDividendForOwner() {
  const store = await app.persistence.loadStore("user-1");
  const transactionIds = ["mcp-shared-dividend-buy-1", "mcp-shared-dividend-buy-2"];
  store.accounting.facts.tradeEvents.push({
    id: transactionIds[0],
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 1_000,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-02",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: store.feeProfiles[0]!,
  }, {
    id: transactionIds[1],
    userId: "user-1",
    accountId: "acc-1",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 500,
    unitPrice: 102,
    priceCurrency: "TWD",
    tradeDate: "2026-01-03",
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    feeSnapshot: store.feeProfiles[0]!,
  });
  createDividendEvent(store, {
    id: "mcp-shared-dividend-event",
    ticker: "2330",
    marketCode: "TW",
    eventType: "CASH",
    exDividendDate: "2026-02-01",
    paymentDate: "2026-02-20",
    cashDividendPerShare: 1,
    cashDividendCurrency: "TWD",
    stockDividendPerShare: 0,
    stockDistributionAmountRaw: 0,
    stockDistributionRatio: 0,
    source: "test",
  });
  await app.persistence.saveStore(store);
  await replayPositionHistory(app.persistence, "user-1", "acc-1", "2330", { marketCode: "TW" });
  return transactionIds;
}

async function getSelfPortfolio(
  headers: Record<string, string>,
  sessionId: string,
) {
  const portfolios = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
  expect(portfolios.statusCode).toBe(200);
  const portfoliosBody = parseMcpJson<{
    result: {
      structuredContent: {
        portfolios: Array<{ label: string; email: string | null; isSelf: boolean }>;
      };
      isError?: boolean;
    };
  }>(portfolios.body);
  expect(portfoliosBody.result.isError).not.toBe(true);
  const selfPortfolio = portfoliosBody.result.structuredContent.portfolios.find((portfolio) => portfolio.isSelf);
  expect(selfPortfolio).toBeTruthy();
  return selfPortfolio!;
}

describe("mcp routes", () => {
  beforeEach(async () => {
    resetMcpRateLimitBucketsForTest();
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
  });

  afterEach(async () => {
    setResearchRolloutOverrideForTest(null);
    await app.close();
  });

  it("exposes MCP health and protected-resource metadata without cookie auth", async () => {
    const health = await app.inject({ method: "GET", url: "/mcp/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json().transport).toBe("streamable_http");

    const metadata = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource" });
    expect(metadata.statusCode).toBe(200);
    expect(metadata.json().resource).toMatch(/\/mcp$/);
    expect(metadata.json().bearer_methods_supported).toEqual(["header"]);

    const pathScopedMetadata = await app.inject({ method: "GET", url: "/.well-known/oauth-protected-resource/mcp" });
    expect(pathScopedMetadata.statusCode).toBe(200);
    expect(pathScopedMetadata.json()).toMatchObject(metadata.json());
  });

  it("mirrors legacy provider policy patches into client-kind policy", async () => {
    const settings = await app.persistence.saveAiConnectorPolicySettings({
      allowedProviders: { chatgpt: false, self_hosted: false },
    });

    expect(settings.allowedProviders).toMatchObject({ chatgpt: false, self_hosted: false });
    expect(settings.allowedClientKinds).toMatchObject({
      chatgpt_app: false,
      claude_ai_connector: false,
      claude_code: false,
      codex_cli: false,
      gemini_cli: false,
      copilot_mcp: false,
      generic_mcp: false,
    });

    const overridden = await app.persistence.saveAiConnectorPolicySettings({
      allowedProviders: { self_hosted: true },
      allowedClientKinds: { codex_cli: false },
    });
    expect(overridden.allowedClientKinds).toMatchObject({
      claude_code: true,
      codex_cli: false,
      gemini_cli: true,
      copilot_mcp: true,
      generic_mcp: true,
    });
  });

  it("allows unauthenticated MCP discovery but rejects unauthenticated tool execution", async () => {
    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        origin: "https://chatgpt.com",
      },
      payload: {
        jsonrpc: "2.0",
        id: "init-1",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      },
    });

    expect(initialize.statusCode).toBe(200);
    expect(initialize.headers["content-type"]).toContain("application/json");
    expect(initialize.headers["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(initialize.headers["access-control-expose-headers"]).toContain("mcp-session-id");
    const sessionId = initialize.headers["mcp-session-id"];
    expect(typeof sessionId).toBe("string");

    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        origin: "https://chatgpt.com",
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
      },
    });

    expect(listTools.statusCode).toBe(200);
    expect(listTools.headers["content-type"]).toContain("application/json");
    expect(listTools.headers["access-control-allow-origin"]).toBe("https://chatgpt.com");
    expect(listTools.headers["access-control-expose-headers"]).toContain("mcp-session-id");
    const body = parseMcpJson<{
      result: {
        tools: Array<{
          name: string;
          title?: string;
          inputSchema?: unknown;
          securitySchemes?: unknown;
          outputSchema?: { type?: string };
          annotations?: unknown;
          execution?: unknown;
          _meta?: {
            securitySchemes?: unknown;
            ui?: { resourceUri?: string; visibility?: string[] };
            "openai/outputTemplate"?: string;
            "openai/widgetAccessible"?: boolean;
          };
        }>;
      };
    }>(listTools.body);
    const overviewTool = body.result.tools.find((tool) => tool.name === "get_portfolio_overview");
    expect(overviewTool?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["portfolio:mcp_read"] },
    ]);
    expect(overviewTool?.execution).toBeUndefined();
    expect(overviewTool?.title).toBe("Get Portfolio Overview");
    expect(overviewTool?.outputSchema).toMatchObject({ type: "object" });
    expectChatGptSafeSchema(overviewTool?.inputSchema);
    expectChatGptSafeSchema(overviewTool?.outputSchema);
    expect(overviewTool?.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });
    expect(overviewTool?._meta?.ui).toEqual({
      resourceUri: "ui://widget/vakwen.html",
      visibility: ["model", "app"],
    });
    expect(overviewTool?._meta?.["openai/outputTemplate"]).toBe("ui://widget/vakwen.html");
    expect(body.result.tools.find((tool) => tool.name === "update_posted_transactions")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
    });
    expect(body.result.tools.find((tool) => tool.name === "delete_posted_transactions")?.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    });

    const readWidget = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "resource-1",
        method: "resources/read",
        params: { uri: "ui://widget/vakwen.html" },
      },
    });
    expect(readWidget.statusCode).toBe(200);
    const widgetBody = parseMcpJson<{
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
          text?: string;
        }>;
      };
    }>(readWidget.body);
    expect(widgetBody.result.contents[0]).toMatchObject({
      uri: "ui://widget/vakwen.html",
      mimeType: "text/html;profile=mcp-app",
    });
    expect(widgetBody.result.contents[0]?.text).toContain("<title>Vakwen</title>");

    const call = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        accept: "application/json, text/event-stream",
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "get_portfolio_overview",
          arguments: {},
        },
      },
    });

    expect(call.statusCode).toBe(200);
    const callBody = parseMcpJson<{
      result: {
        isError?: boolean;
        content?: Array<{ type: string; text?: string }>;
        _meta?: { "mcp/www_authenticate"?: string[] };
      };
    }>(call.body);
    expect(callBody.result.isError).toBe(true);
    expect(callBody.result.content?.[0]?.text).toContain("Authentication required");
    expect(callBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("/.well-known/oauth-protected-resource/mcp");
    expect(callBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("scope=\"portfolio:mcp_read\"");
    expect(callBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("error=\"invalid_token\"");
  });

  it("keeps unsigned dev MCP bearer tokens out of production runtime", () => {
    expect(mcpDevTokenAllowedForRuntime("production")).toBe(false);
    expect(mcpDevTokenAllowedForRuntime("development")).toBe(true);
    expect(mcpDevTokenAllowedForRuntime("test")).toBe(true);
  });

  it("advertises OAuth security schemes on MCP tool descriptors", async () => {
    const token = devToken({
      userId: "user-1",
      scopes: [
        "portfolio:mcp_read",
        "transaction_draft:create",
        "transaction_draft:edit",
        "transaction_draft:archive",
        "transaction_draft:delete",
        "transaction:write",
      ],
    });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
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

    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
      },
    });
    expect(listTools.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        tools: Array<{
          name: string;
          inputSchema?: unknown;
          securitySchemes?: unknown;
          execution?: unknown;
          outputSchema?: { type?: string };
          annotations?: unknown;
          _meta?: {
            securitySchemes?: unknown;
            ui?: { resourceUri?: string; visibility?: string[] };
            "openai/outputTemplate"?: string;
            "openai/widgetAccessible"?: boolean;
          };
        }>;
      };
    }>(listTools.body);
    const toolsByName = new Map(body.result.tools.map((tool) => [tool.name, tool]));
    for (const tool of listMcpToolDefinitions()) {
      const listedTool = toolsByName.get(tool.name);
      const expectedSecuritySchemes = (tool.alternativeScopes ? [tool.scope, ...tool.alternativeScopes] : [tool.scope])
        .map((scope) => ({ type: "oauth2", scopes: [scope] }));
      expect(listedTool?.securitySchemes).toEqual(expectedSecuritySchemes);
      expect(listedTool?.execution).toBeUndefined();
      expect(listedTool?._meta?.securitySchemes).toEqual(expectedSecuritySchemes);
      expect(listedTool?.outputSchema).toMatchObject({ type: "object" });
      expectChatGptSafeSchema(listedTool?.inputSchema);
      expectChatGptSafeSchema(listedTool?.outputSchema);
      expect(listedTool?.annotations).toEqual(tool.annotations);
      const expectedOutputTemplate = expectedToolOutputTemplate(tool.name);
      const expectedVisibility = (
        tool._meta?.ui
        && typeof tool._meta.ui === "object"
        && "visibility" in tool._meta.ui
        && Array.isArray(tool._meta.ui.visibility)
      )
        ? tool._meta.ui.visibility
        : ["model", "app"];
      expect(listedTool?._meta?.ui).toEqual({
        resourceUri: expectedOutputTemplate,
        visibility: expectedVisibility,
      });
      expect(listedTool?._meta?.["openai/outputTemplate"]).toBe(expectedOutputTemplate);
      expect(listedTool?._meta?.["openai/widgetAccessible"]).toBe(expectedToolWidgetAccessible(tool.name));
    }

    const readWidget = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "resource-1",
        method: "resources/read",
        params: { uri: "ui://widget/vakwen.html" },
      },
    });
    expect(readWidget.statusCode).toBe(200);
    const widgetBody = parseMcpJson<{
      result: {
        contents: Array<{
          uri: string;
          mimeType?: string;
          text?: string;
          _meta?: {
            ui?: { csp?: { connectDomains?: string[]; resourceDomains?: string[] } };
            "openai/widgetDescription"?: string;
          };
        }>;
      };
    }>(readWidget.body);
    expect(widgetBody.result.contents[0]).toMatchObject({
      uri: "ui://widget/vakwen.html",
      mimeType: "text/html;profile=mcp-app",
    });
    expect(widgetBody.result.contents[0]?.text).toContain("<title>Vakwen</title>");
    expect(widgetBody.result.contents[0]?._meta?.ui?.csp).toEqual({
      connectDomains: [],
      resourceDomains: [],
    });
  });

  it("keeps legacy search_instruments discovery unchanged when the research MCP gate is off", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: false,
      mcpExposureEnabled: false,
      skillExposureEnabled: false,
    });
    const sessionId = await initializeMcpSession({
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read"] })}`,
      accept: "application/json, text/event-stream",
    });

    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read"] })}`,
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      payload: { jsonrpc: "2.0", id: "legacy-search-list", method: "tools/list" },
    });
    expect(listTools.statusCode).toBe(200);
    const body = parseMcpJson<{ result: { tools: Array<{ name: string; securitySchemes?: unknown }> } }>(listTools.body);
    expect(body.result.tools.find((tool) => tool.name === "search_instruments")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["portfolio:mcp_read"] },
    ]);
  });

  it("advertises additive research scope metadata for search_instruments when the research MCP gate is on", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: true },
    });
    const sessionId = await initializeMcpSession({
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    });

    const listTools = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
        accept: "application/json, text/event-stream",
        "mcp-session-id": sessionId,
      },
      payload: { jsonrpc: "2.0", id: "research-search-list", method: "tools/list" },
    });
    expect(listTools.statusCode).toBe(200);
    const body = parseMcpJson<{ result: { tools: Array<{ name: string; securitySchemes?: unknown }> } }>(listTools.body);
    expect(body.result.tools.find((tool) => tool.name === "search_instruments")?.securitySchemes).toEqual([
      { type: "oauth2", scopes: ["portfolio:mcp_read"] },
      { type: "oauth2", scopes: ["research:read"] },
    ]);
  });

  it("serves canonical manifest and identity structured content through research-only MCP authorization", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: true,
    });
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { research: true } });
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-identity", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "2330", legalName: "台灣積體電路製造股份有限公司", displayName: "台積電",
        unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05",
      },
    });
    await app.persistence.appendResearchIdentityRecords([record]);
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const query = {
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    };

    const manifestResponse = await callMcpTool(headers, sessionId, "get_research_manifest", query);
    expect(manifestResponse.statusCode).toBe(200);
    const manifest = parseMcpJson<{ result: { content: Array<{ text: string }>; structuredContent: Record<string, unknown>; isError?: boolean } }>(manifestResponse.body);
    expect(manifest.result.isError, manifestResponse.body).not.toBe(true);
    expect(researchManifestOutputSchema.parse(manifest.result.structuredContent)).toEqual(
      manifest.result.structuredContent,
    );
    expect(manifest.result.structuredContent).toMatchObject({
      selector: { kind: "listing_id", listingId: record.listing.id },
      orchestration: { skillExposure: "enabled" },
    });
    expect(manifest.result.content[0]?.text).toContain("1 of 11 datasets available");

    const identityResponse = await callMcpTool(headers, sessionId, "get_research_identity", {
      ...query,
      subject: { kind: "listing_id", listingId: record.listing.id },
      history: { limit: 25 },
    });
    expect(identityResponse.statusCode).toBe(200);
    const identity = parseMcpJson<{ result: { content: Array<{ text: string }>; structuredContent: Record<string, unknown>; isError?: boolean } }>(identityResponse.body);
    expect(identity.result.isError).not.toBe(true);
    expect(researchIdentityOutputSchema.parse(identity.result.structuredContent)).toEqual(
      identity.result.structuredContent,
    );
    expect(identity.result.structuredContent).toMatchObject({
      selector: { kind: "listing_id", listingId: record.listing.id },
      identity: { listing: { ticker: "2330", venue: "TWSE" } },
    });
    expect(identity.result.content[0]?.text).toContain("Research identity for TWSE:2330");

    const missingResponse = await callMcpTool(headers, sessionId, "get_research_identity", {
      ...query,
      subject: { kind: "ticker_venue", ticker: "0000", listingVenue: "TWSE" },
      history: { limit: 25 },
    });
    expect(missingResponse.statusCode).toBe(200);
    const missing = parseMcpJson<{
      result: { structuredContent: Record<string, unknown>; isError?: boolean };
    }>(missingResponse.body);
    expect(missing.result.isError).toBe(true);
    expect(researchIdentityToolOutputSchema.parse(missing.result.structuredContent)).toMatchObject({
      code: "research_subject_not_found",
      statusCode: 422,
    });

    const reEvaluateResponse = await callMcpTool(headers, sessionId, "get_research_identity", {
      ...query,
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        ...query.context,
        assessmentMode: "re_evaluate",
        policySetVersion: "policy-set/not-implemented",
      },
      history: { limit: 25 },
    });
    const reEvaluate = parseMcpJson<{
      result: { structuredContent: Record<string, unknown>; isError?: boolean };
    }>(reEvaluateResponse.body);
    expect(reEvaluate.result.isError, reEvaluateResponse.body).toBe(true);
    expect(researchIdentityToolOutputSchema.parse(reEvaluate.result.structuredContent)).toMatchObject({
      code: "research_assessment_mode_unsupported",
      statusCode: 422,
    });
  });

  it("returns shared MCP policy errors through research tool output validation", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { research: true } });
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { research: false } });

    const response = await callMcpTool(headers, sessionId, "get_research_manifest", {
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: { structuredContent: Record<string, unknown>; isError?: boolean };
    }>(response.body);
    expect(body.result.isError, response.body).toBe(true);
    expect(researchManifestToolOutputSchema.parse(body.result.structuredContent)).toMatchObject({
      code: "mcp_tool_group_disabled",
      statusCode: 403,
    });
  });

  it("rejects mixed-market search_instruments requests through MCP when authorized only by research:read", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: true },
    });

    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "search_instruments", {
      query: "Tesla",
      markets: ["TW", "US"],
      limit: 10,
    });

    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: { isError?: boolean; structuredContent: { code: string; statusCode: number } };
    }>(response.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({
      code: "mcp_research_market_unsupported",
      statusCode: 400,
    });
  });

  it("returns combined multi-market search results with additive researchIdentity through MCP", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: true },
    });
    const persistence = app.persistence as MemoryPersistence;
    persistence._seedInstrument({
      ticker: "2330",
      name: "Tesla Taiwan",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "TSLA",
      name: "Tesla",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "9105",
      name: "Tesla Delisted TW",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "failed",
      delistedAt: "2026-08-01T00:00:00.000Z",
    });

    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read", "research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "search_instruments", {
      query: "Tesla",
      markets: ["TW", "US"],
      limit: 10,
      includeInactive: true,
    });

    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          markets: string[];
          items: Array<{
            ticker: string;
            marketCode: string;
            researchIdentity?: { availability: string };
          }>;
        };
      };
    }>(response.body);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.markets).toEqual(["TW", "US"]);
    expect(body.result.structuredContent.items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
        researchIdentity: { availability: "available" },
      }),
      expect.objectContaining({
        ticker: "9105",
        marketCode: "TW",
        researchIdentity: { availability: "unavailable" },
      }),
      expect.objectContaining({
        ticker: "TSLA",
        marketCode: "US",
        researchIdentity: { availability: "not_applicable" },
      }),
    ]));
  });

  it("does not grant additive research output to a portfolio-only connector", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { read: true, research: true },
    });
    const persistence = app.persistence as MemoryPersistence;
    persistence._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "9105",
      name: "Delisted TW",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "failed",
      delistedAt: "2026-08-01T00:00:00.000Z",
    });

    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "search_instruments", {
      query: "T",
      markets: ["TW"],
      limit: 10,
      includeInactive: true,
    });

    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          items: Array<{ ticker: string; researchIdentity?: { availability: string } }>;
        };
      };
    }>(response.body);
    expect(body.result.isError).not.toBe(true);
    expect(body.result.structuredContent.items.map((item) => item.ticker)).toContain("2330");
    expect(body.result.structuredContent.items.map((item) => item.ticker)).not.toContain("9105");
    expect(body.result.structuredContent.items.every((item) => item.researchIdentity === undefined)).toBe(true);
  });

  it("constrains posted transaction mutation quantities and prices at the MCP boundary", () => {
    const tool = listMcpToolDefinitions().find(({ name }) => name === "preview_update_posted_transactions");
    expect(tool).toBeDefined();
    const baseInput = {
      portfolio: { label: "Self" },
      reason: "Invalid precision regression",
      items: [{ transactionId: "trade-1", patch: { quantity: 12 } }],
    };

    expect(tool!.inputSchema.safeParse(baseInput).success).toBe(true);
    expect(tool!.inputSchema.safeParse({
      ...baseInput,
      items: [{ transactionId: "trade-1", patch: { quantity: 1.5 } }],
    }).success).toBe(false);
    expect(tool!.inputSchema.safeParse({
      ...baseInput,
      items: [{ transactionId: "trade-1", patch: { unitPrice: 10.123 } }],
    }).success).toBe(false);
  });

  it("requires fresh auth for high-risk MCP admin settings changes", async () => {
    const missingFreshAuth = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      payload: { groupToggles: { read: false } },
    });
    expect(missingFreshAuth.statusCode).toBe(403);
    expect(missingFreshAuth.json()).toMatchObject({ error: "mcp_fresh_auth_required" });

    const forgedFreshAuth = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      headers: { "x-vakwen-fresh-auth-at": new Date().toISOString() },
      payload: { groupToggles: { read: false } },
    });
    expect(forgedFreshAuth.statusCode).toBe(400);
    expect(forgedFreshAuth.json()).toMatchObject({ error: "mcp_fresh_auth_invalid" });

    const freshAuth = await app.inject({
      method: "POST",
      url: "/admin/mcp/fresh-auth",
    });
    expect(freshAuth.statusCode).toBe(200);
    const { freshAuthToken } = freshAuth.json<{ freshAuthToken: string }>();

    const response = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      headers: { "x-vakwen-fresh-auth-at": freshAuthToken },
      payload: {
        groupToggles: { read: false },
        maxActiveConnectionsPerUser: 2,
        oauthRedirectUriAllowlist: ["https://connector.example.com/oauth/callback"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      maxActiveConnectionsPerUser: 2,
      groupToggles: { read: false, drafts: true, write: false },
      oauthRedirectUriAllowlist: ["https://connector.example.com/oauth/callback"],
    });
  });

  it("revokes existing ChatGPT OAuth connectors when the MCP OAuth token secret changes", async () => {
    await app.persistence.saveAiConnectorConnection({
      id: "chatgpt-connection-1",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      scopes: ["portfolio:mcp_read"],
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await app.persistence.saveAiConnectorCredential({
      id: "refresh-credential-1",
      connectionId: "chatgpt-connection-1",
      credentialType: "oauth_refresh_token",
      tokenHash: "token-hash-1",
      tokenFamilyId: "family-1",
      oauthClientId: "chatgpt",
      resource: "http://localhost:4000/mcp",
      scopes: ["portfolio:mcp_read"],
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const freshAuth = await app.inject({ method: "POST", url: "/admin/mcp/fresh-auth" });
    const { freshAuthToken } = freshAuth.json<{ freshAuthToken: string }>();
    const response = await app.inject({
      method: "PATCH",
      url: "/admin/mcp/settings",
      headers: { "x-vakwen-fresh-auth-at": freshAuthToken },
      payload: { mcpOauthTokenSecret: "rotated-mcp-oauth-token-secret-that-is-long-enough" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      oauthTokenSecretSet: true,
      readiness: {
        endpoint: "/mcp",
        oauthTokenSecretConfigured: true,
      },
    });

    const connection = await app.persistence.getAiConnectorConnection("chatgpt-connection-1");
    expect(connection).toMatchObject({
      status: "revoked",
      revocationReason: "mcp_oauth_secret_rotated",
    });
    const credential = await app.persistence.getAiConnectorCredentialByHash("token-hash-1");
    expect(credential?.revokedAt).toBeTruthy();
  });

  it("records access logs for MCP policy denials", async () => {
    const token = devToken({ userId: "user-1", scopes: [] });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
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
          clientInfo: { name: "vitest", version: "1.0.0" },
        },
      },
    });
    expect(initialize.statusCode).toBe(200);
    const sessionId = initialize.headers["mcp-session-id"];
    expect(typeof sessionId).toBe("string");

    const call = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "get_portfolio_overview",
          arguments: {},
        },
      },
    });
    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("MCP scope portfolio:mcp_read is not enabled");

    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]).toMatchObject({
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "denied",
      denialReason: "mcp_scope_denied",
    });
  });

  it("gates admin calendar MCP tools to admin users and supports preview-confirm imports", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });

    const member = await app.persistence.resolveOrCreateUser(
      "google",
      "member-calendar-user",
      { email: "member-calendar-user@example.com", name: "Member Calendar User" },
      { role: "member" },
    );
    const memberHeaders = {
      authorization: `Bearer ${devToken({ userId: member.userId, scopes: ["transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const memberSessionId = await initializeMcpSession(memberHeaders);
    const denied = await callMcpTool(memberHeaders, memberSessionId, "get_admin_market_calendar_status", {
      marketCode: "TW",
    });
    expect(denied.statusCode).toBe(200);
    const deniedBody = parseMcpJson<{
      result: { structuredContent: { code: string; statusCode: number } };
    }>(denied.body);
    expect(deniedBody.result.structuredContent).toMatchObject({
      code: "admin_required",
      statusCode: 403,
    });

    const adminHeaders = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const adminSessionId = await initializeMcpSession(adminHeaders);
    const preview = await callMcpTool(adminHeaders, adminSessionId, "manage_admin_market_calendar_import", {
      mode: "preview",
      marketCode: "TW",
      payload: calendarImportPayload(2026),
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = parseMcpJson<{
      result: {
        structuredContent: {
          previewToken: string;
          source: { id: string } | null;
          exceptionCount: number;
          replaceConfirmedRequired: boolean;
        };
      };
    }>(preview.body);
    expect(previewBody.result.structuredContent.source?.id).toBe("official-tw");
    expect(previewBody.result.structuredContent.exceptionCount).toBe(0);
    expect(previewBody.result.structuredContent.replaceConfirmedRequired).toBe(false);

    const confirmed = await callMcpTool(adminHeaders, adminSessionId, "manage_admin_market_calendar_import", {
      mode: "confirm",
      marketCode: "TW",
      previewToken: previewBody.result.structuredContent.previewToken,
    });
    expect(confirmed.statusCode).toBe(200);
    const confirmedBody = parseMcpJson<{
      result: {
        structuredContent: {
          marketCode: string;
          calendarYear: number;
          versionId: string;
        };
      };
    }>(confirmed.body);
    expect(confirmedBody.result.structuredContent).toMatchObject({
      marketCode: "TW",
      calendarYear: 2026,
    });
    expect(confirmedBody.result.structuredContent.versionId).toBeTruthy();

    const active = await app.persistence.getActiveMarketCalendarVersion("TW", 2026);
    expect(active?.status).toBe("confirmed");
  });

  it("authenticates an active ChatGPT connector and records successful MCP tool access", async () => {
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: "user-1", connectionId: connection.id, clientId: "chatgpt" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };

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

    const call = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        ...headers,
        "mcp-session-id": String(sessionId),
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-1",
        method: "tools/call",
        params: {
          name: "get_portfolio_overview",
          arguments: {},
        },
      },
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("portfolio");
    expect(call.body).not.toContain("mcp_scope_denied");

    const saved = await app.persistence.getAiConnectorConnection(connection.id);
    expect(saved?.lastUsedAt).not.toBeNull();
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]).toMatchObject({
      connectionId: connection.id,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
    });
  });

  it("keeps legacy ChatGPT connector IDs usable after client identity defaults are applied", async () => {
    const connection = await app.persistence.saveAiConnectorConnection({
      id: "legacy-chatgpt-direct",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "Legacy ChatGPT",
      status: "active",
      oauthClientId: "chatgpt",
      oauthSubject: "legacy-subject",
      scopes: ["portfolio:mcp_read"],
      toolToggles: {},
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(connection).toMatchObject({
      id: "legacy-chatgpt-direct",
      provider: "chatgpt",
      vendor: "openai",
      clientKind: "chatgpt_app",
      authMode: "oauth",
    });
    expect(connection.capabilities).toEqual(expect.arrayContaining(["oauth", "widgets", "interactive_ops"]));

    const token = devToken({ userId: "user-1", connectionId: connection.id, clientId: "chatgpt" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const call = await callMcpTool(headers, sessionId, "get_portfolio_overview", {});

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("portfolio");
    expect(call.body).not.toContain("mcp_scope_denied");

    const saved = await app.persistence.getAiConnectorConnection(connection.id);
    expect(saved).toMatchObject({
      id: "legacy-chatgpt-direct",
      vendor: "openai",
      clientKind: "chatgpt_app",
      authMode: "oauth",
    });
    expect(saved?.lastUsedAt).not.toBeNull();
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]).toMatchObject({
      connectionId: connection.id,
      toolName: "get_portfolio_overview",
      result: "ok",
      metadata: expect.objectContaining({ source: "chatgpt_component" }),
    });
  });

  it("exposes and revokes ChatGPT connector connections through the user API", async () => {
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
        toolToggles: { get_portfolio_overview: true },
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    const list = await app.inject({ method: "GET", url: "/ai/connectors" });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toMatchObject({
      connections: [
        {
          id: connection.id,
          provider: "chatgpt",
          displayName: "ChatGPT",
          status: "active",
          scopes: ["portfolio:mcp_read", "transaction_draft:create"],
        },
      ],
      policy: {
        enabled: true,
        allowedProviders: { chatgpt: true },
        readiness: {
          endpoint: "/mcp",
          deploymentEnabled: true,
          enabledClientKindCount: 7,
          totalClientKindCount: 7,
        },
      },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connection.id}`,
      payload: {
        scopes: ["portfolio:mcp_read"],
        toolToggles: { get_portfolio_overview: false },
        expiresAt: null,
      },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      id: connection.id,
      scopes: ["portfolio:mcp_read"],
      toolToggles: { get_portfolio_overview: false },
      expiresAt: null,
    });

    const revoked = await app.inject({
      method: "DELETE",
      url: `/ai/connectors/${connection.id}`,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      id: connection.id,
      status: "revoked",
      revocationReason: "user_revoked",
    });

    const history = await app.inject({ method: "GET", url: "/ai/connectors/history" });
    expect(history.statusCode).toBe(200);
    expect(history.json()).toMatchObject({
      connections: [
        expect.objectContaining({
          id: connection.id,
          status: "revoked",
        }),
      ],
    });

    const hidden = await app.inject({
      method: "POST",
      url: `/ai/connectors/${connection.id}/hide`,
    });
    expect(hidden.statusCode).toBe(200);
    expect(hidden.json<{ hiddenAt: string | null }>().hiddenAt).toEqual(expect.any(String));

    const hiddenHistory = await app.inject({ method: "GET", url: "/ai/connectors/history" });
    expect(hiddenHistory.statusCode).toBe(200);
    expect(hiddenHistory.json()).toEqual({ connections: [] });

    const hiddenHistoryExcluded = await app.inject({
      method: "GET",
      url: "/ai/connectors/history?includeHidden=false",
    });
    expect(hiddenHistoryExcluded.statusCode).toBe(200);
    expect(hiddenHistoryExcluded.json()).toEqual({ connections: [] });

    const hiddenHistoryIncluded = await app.inject({
      method: "GET",
      url: "/ai/connectors/history?includeHidden=true",
    });
    expect(hiddenHistoryIncluded.statusCode).toBe(200);
    expect(hiddenHistoryIncluded.json()).toMatchObject({
      connections: [
        expect.objectContaining({
          id: connection.id,
          status: "revoked",
          hiddenAt: expect.any(String),
        }),
      ],
    });
  });

  it("rejects hide for active connectors and keeps the row unchanged", async () => {
    const active = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "Still active",
        scopes: ["portfolio:mcp_read"],
        toolToggles: {},
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    const hidden = await app.inject({
      method: "POST",
      url: `/ai/connectors/${active.id}/hide`,
    });
    expect(hidden.statusCode).toBe(409);
    expect(hidden.json()).toMatchObject({
      error: "ai_connector_hide_requires_history",
    });

    const persisted = await app.persistence.getAiConnectorConnection(active.id);
    expect(persisted).toMatchObject({
      id: active.id,
      status: "active",
      hiddenAt: null,
    });
  });

  it("derives Tool Catalog effective access and blocker priority on the server", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      maxActiveConnectionsPerUser: 4,
      groupToggles: { read: true, drafts: true, write: true },
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli", "claude_code"],
        allowedToolGroups: ["read"],
        maxLifetimeDays: 30,
        maxActiveConnectorsPerUser: 3,
      },
    });
    const readable = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "Readable ChatGPT",
        scopes: ["portfolio:mcp_read"],
        toolToggles: {},
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const writeOnly = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "self_hosted",
        clientKind: "codex_cli",
        vendor: "openai_codex",
        authMode: "bearer",
        capabilities: ["bearer_fallback", "deep_link_fallback"],
        displayName: "Write-only Codex",
        scopes: ["transaction:write"],
        toolToggles: {},
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const draftEditOnly = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "Draft editor ChatGPT",
        scopes: ["portfolio:mcp_read", "transaction_draft:edit"],
        toolToggles: {},
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const expiredReadable = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "self_hosted",
        clientKind: "claude_code",
        vendor: "anthropic",
        authMode: "bearer",
        capabilities: ["bearer_fallback", "deep_link_fallback"],
        displayName: "Expired Claude",
        scopes: ["portfolio:mcp_read"],
        toolToggles: {},
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    const summary = await app.inject({ method: "GET", url: "/ai/connectors/summary" });
    expect(summary.statusCode).toBe(200);
    const body = summary.json<{
      toolCatalog: Array<{
        name: string;
        inputSchema: {
          fields: Array<{ name: string; type: string; required: boolean }>;
          rawSchema: Record<string, unknown>;
        };
        effectiveAccess: Array<{
          connectionId: string;
          connectionDisplayName: string;
          status: string;
          blockerCode: string | null;
        }>;
      }>;
    }>();
    const overview = body.toolCatalog.find((tool) => tool.name === "get_portfolio_overview");
    expect(overview?.inputSchema.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "portfolioContextUserId", type: "string", required: false }),
    ]));
    expect(overview?.inputSchema.rawSchema).toMatchObject({
      type: "object",
      properties: {
        portfolioContextUserId: { type: "string" },
      },
    });
    expect(overview?.effectiveAccess).toEqual(expect.arrayContaining([
      expect.objectContaining({
        connectionId: readable.id,
        connectionDisplayName: "Readable ChatGPT",
        status: "available",
        blockerCode: null,
      }),
      expect.objectContaining({
        connectionId: writeOnly.id,
        connectionDisplayName: "Write-only Codex",
        status: "blocked",
        blockerCode: "missing_scope",
      }),
    ]));
    expect(overview?.effectiveAccess.some((entry) => entry.connectionId === expiredReadable.id)).toBe(false);
    const posting = body.toolCatalog.find((tool) => tool.name === "post_transaction_draft_rows");
    expect(posting?.effectiveAccess).toEqual(expect.arrayContaining([
      expect.objectContaining({
        connectionId: writeOnly.id,
        connectionDisplayName: "Write-only Codex",
        status: "blocked",
        blockerCode: "admin_tool_policy_disabled",
      }),
    ]));
    const draftableAccounts = body.toolCatalog.find((tool) => tool.name === "list_draftable_account_names");
    expect(draftableAccounts?.effectiveAccess).toEqual(expect.arrayContaining([
      expect.objectContaining({
        connectionId: draftEditOnly.id,
        connectionDisplayName: "Draft editor ChatGPT",
        status: "available",
        blockerCode: null,
      }),
    ]));
  });

  it("rejects bearer connector scope expansion after token creation", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read", "drafts"],
        maxLifetimeDays: 14,
        maxActiveConnectorsPerUser: 2,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    expect(created.statusCode).toBe(200);
    const connectionId = created.json<{ connection: { id: string } }>().connection.id;

    const expanded = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connectionId}`,
      payload: {
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
      },
    });
    expect(expanded.statusCode).toBe(400);
    expect(expanded.json()).toMatchObject({
      error: "mcp_bearer_scope_expansion_requires_recreate",
    });

    const reduced = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connectionId}`,
      payload: { scopes: [] },
    });
    expect(reduced.statusCode).toBe(200);
    expect(reduced.json()).toMatchObject({ scopes: [] });
  });

  it("rejects bearer connector expansion to research:read after token creation", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read", "research"],
        maxLifetimeDays: 14,
        maxActiveConnectorsPerUser: 2,
      },
      groupToggles: { research: true },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    expect(created.statusCode).toBe(200);
    const connectionId = created.json<{ connection: { id: string } }>().connection.id;

    const expanded = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connectionId}`,
      payload: { scopes: ["portfolio:mcp_read", "research:read"] },
    });
    expect(expanded.statusCode).toBe(400);
    expect(expanded.json()).toMatchObject({
      error: "mcp_bearer_scope_expansion_requires_recreate",
    });
  });

  it("rejects OAuth connector scope expansion after consent", async () => {
    const connection = await app.persistence.saveAiConnectorConnection({
      id: "chatgpt-oauth-scope-lock",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      oauthClientId: "chatgpt",
      oauthSubject: "chatgpt-user-1",
      scopes: ["portfolio:mcp_read"],
      toolToggles: {},
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const expanded = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connection.id}`,
      payload: {
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
      },
    });
    expect(expanded.statusCode).toBe(400);
    expect(expanded.json()).toMatchObject({
      error: "mcp_oauth_scope_expansion_requires_reconnect",
    });

    const reduced = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connection.id}`,
      payload: { scopes: [] },
    });
    expect(reduced.statusCode).toBe(200);
    expect(reduced.json()).toMatchObject({ scopes: [] });
  });

  it("rejects OAuth connector expansion to research:read after consent", async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: true },
    });
    const connection = await app.persistence.saveAiConnectorConnection({
      id: "chatgpt-oauth-research-lock",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      oauthClientId: "chatgpt",
      oauthSubject: "chatgpt-user-1",
      scopes: ["portfolio:mcp_read"],
      toolToggles: {},
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    const expanded = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connection.id}`,
      payload: { scopes: ["portfolio:mcp_read", "research:read"] },
    });
    expect(expanded.statusCode).toBe(400);
    expect(expanded.json()).toMatchObject({
      error: "mcp_oauth_scope_expansion_requires_reconnect",
    });
  });

  it("preserves an existing research grant when rollout policy is disabled during an unrelated connector edit", async () => {
    const connection = await app.persistence.saveAiConnectorConnection({
      id: "chatgpt-oauth-research-rollback",
      userId: "user-1",
      provider: "chatgpt",
      displayName: "ChatGPT",
      status: "active",
      oauthClientId: "chatgpt",
      oauthSubject: "chatgpt-user-1",
      scopes: ["portfolio:mcp_read", "research:read"],
      toolToggles: {},
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: false },
    });

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connection.id}`,
      payload: { toolToggles: { search_instruments: false } },
    });

    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({
      scopes: ["portfolio:mcp_read", "research:read"],
      toolToggles: { search_instruments: false },
    });
  });

  it("rejects bearer connector lifetime edits after token creation", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read"],
        maxLifetimeDays: 14,
        maxActiveConnectorsPerUser: 2,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    expect(created.statusCode).toBe(200);
    const connectionId = created.json<{ connection: { id: string } }>().connection.id;

    const extended = await app.inject({
      method: "PATCH",
      url: `/ai/connectors/${connectionId}`,
      payload: { expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString() },
    });
    expect(extended.statusCode).toBe(400);
    expect(extended.json()).toMatchObject({
      error: "mcp_bearer_connector_lifetime_immutable",
    });
  });

  it("creates a bearer fallback connector and returns the token once", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read", "drafts"],
        maxLifetimeDays: 14,
        maxActiveConnectorsPerUser: 2,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
        lifetimeDays: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{
      connection: {
        id: string;
        provider: string;
        vendor: string;
        clientKind: string;
        authMode: string;
        scopes: string[];
      };
      bearerToken: string;
      tokenHint: string;
      expiresAt: string;
    }>();
    expect(body.connection).toMatchObject({
      provider: "self_hosted",
      vendor: "openai_codex",
      clientKind: "codex_cli",
      authMode: "bearer",
      scopes: ["portfolio:mcp_read", "transaction_draft:create"],
    });
    expect(body.bearerToken.startsWith("vakwen-mcpb.")).toBe(true);
    expect(body.tokenHint).toBe(body.bearerToken.slice(-8));

    const credential = await app.persistence.getAiConnectorCredentialByHash(hashGeneratedBearerToken(body.bearerToken));
    expect(credential).toMatchObject({
      connectionId: body.connection.id,
      credentialType: "bearer_token",
      tokenHint: body.tokenHint,
      scopes: body.connection.scopes,
      expiresAt: body.expiresAt,
    });
  });

  it("revokes the bearer connector if bearer credential creation fails", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read"],
        maxLifetimeDays: 14,
        maxActiveConnectorsPerUser: 2,
      },
    });

    const originalSaveCredential = app.persistence.saveAiConnectorCredential.bind(app.persistence);
    app.persistence.saveAiConnectorCredential = async () => {
      throw new Error("credential write failed");
    };

    const response = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    expect(response.statusCode).toBe(500);

    app.persistence.saveAiConnectorCredential = originalSaveCredential;
    const connections = await app.persistence.listAiConnectorConnectionsForUser("user-1");
    const connector = connections.find((connection) =>
      connection.clientKind === "codex_cli"
      && connection.authMode === "bearer"
    );
    expect(connector).toMatchObject({
      status: "revoked",
      revocationReason: "bearer_credential_create_failed",
    });
  });

  it("blocks viewer-role sessions from creating write-scoped bearer fallback connectors", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read", "drafts", "write"],
        maxLifetimeDays: 14,
        maxActiveConnectorsPerUser: 2,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      headers: { "x-user-id": "viewer-bearer-user", "x-user-role": "viewer" },
      payload: {
        clientKind: "codex_cli",
        displayName: "Viewer Codex CLI",
        scopes: ["portfolio:mcp_read", "transaction_draft:create", "transaction:write"],
        lifetimeDays: 7,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "write_blocked_viewer_role" });
    const connections = await app.persistence.listAiConnectorConnectionsForUser("viewer-bearer-user");
    expect(connections).toEqual([]);
  });

  it("denies bearer fallback creation when admin policy disables it", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: false,
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ error: "mcp_bearer_fallback_disabled" });
  });

  it("authenticates generated bearer fallback tokens for MCP requests", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read"],
        maxLifetimeDays: 7,
        maxActiveConnectorsPerUser: 1,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    const bearerToken = created.json<{ bearerToken: string }>().bearerToken;
    const headers = {
      authorization: `Bearer ${bearerToken}`,
      accept: "application/json, text/event-stream",
    };

    const sessionId = await initializeMcpSession(headers);
    const call = await callMcpTool(headers, sessionId, "get_portfolio_overview", {});

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("portfolio");
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]).toMatchObject({
      userId: "user-1",
      toolName: "get_portfolio_overview",
      result: "ok",
    });
  });

  it("expires bearer fallback connectors when generated bearer credentials expire", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read"],
        maxLifetimeDays: 7,
        maxActiveConnectorsPerUser: 1,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    const { bearerToken, connection } = created.json<{ bearerToken: string; connection: { id: string } }>();
    const credential = await app.persistence.getAiConnectorCredentialByHash(hashGeneratedBearerToken(bearerToken));
    expect(credential).toBeTruthy();
    await app.persistence.saveAiConnectorCredential({
      ...credential!,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "init-expired-bearer",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "Codex CLI", version: "1.0.0" },
        },
      },
    });

    expect(initialize.statusCode).toBe(401);
    expect(initialize.body).toContain("mcp_auth_invalid");
    const expiredConnection = await app.persistence.getAiConnectorConnection(connection.id);
    expect(expiredConnection).toMatchObject({
      status: "expired",
    });
    expect(expiredConnection?.expiryNotifiedAt).toBeTruthy();
    const expiredCredential = await app.persistence.getAiConnectorCredentialByHash(hashGeneratedBearerToken(bearerToken));
    expect(expiredCredential?.revokedAt).toBeTruthy();
  });

  it("rejects existing bearer fallback tokens after admin disables bearer fallback", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read"],
        maxLifetimeDays: 7,
        maxActiveConnectorsPerUser: 1,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read"],
        lifetimeDays: 7,
      },
    });
    const bearerToken = created.json<{ bearerToken: string }>().bearerToken;
    const connectionId = created.json<{ connection: { id: string } }>().connection.id;

    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: { enabled: false },
    });
    const beforeDenied = await app.persistence.getAiConnectorConnection(connectionId);

    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        authorization: `Bearer ${bearerToken}`,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "init-disabled-bearer",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "Codex CLI", version: "1.0.0" },
        },
      },
    });

    expect(initialize.statusCode).toBe(403);
    expect(initialize.body).toContain("mcp_bearer_fallback_disabled");
    const afterDenied = await app.persistence.getAiConnectorConnection(connectionId);
    expect(afterDenied?.lastUsedAt).toBe(beforeDenied?.lastUsedAt);
  });

  it("blocks existing bearer fallback tokens from tool groups removed by admin policy", async () => {
    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: {
        enabled: true,
        allowedClientKinds: ["codex_cli"],
        allowedToolGroups: ["read", "drafts"],
        maxLifetimeDays: 7,
        maxActiveConnectorsPerUser: 1,
      },
    });

    const created = await app.inject({
      method: "POST",
      url: "/ai/connectors/bearer",
      payload: {
        clientKind: "codex_cli",
        displayName: "Codex CLI",
        scopes: ["portfolio:mcp_read", "transaction_draft:create"],
        lifetimeDays: 7,
      },
    });
    const bearerToken = created.json<{ bearerToken: string }>().bearerToken;

    await app.persistence.saveAiConnectorPolicySettings({
      bearerFallback: { allowedToolGroups: ["read"] },
    });

    const headers = {
      authorization: `Bearer ${bearerToken}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const readCall = await callMcpTool(headers, sessionId, "get_portfolio_overview", {});
    expect(readCall.statusCode).toBe(200);

    const draftCall = await callMcpTool(headers, sessionId, "get_transaction_draft_template", {});
    expect(draftCall.statusCode).toBe(200);
    expect(draftCall.body).toContain("mcp_bearer_tool_group_disabled");
  });

  it("filters and paginates connector access logs for the Activity feed", async () => {
    await app.persistence.appendAiConnectorAccessLog({
      id: "log-ok-read",
      connectionId: null,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
      createdAt: "2026-06-02T00:00:00.000Z",
    });
    await app.persistence.appendAiConnectorAccessLog({
      id: "log-denied-old",
      connectionId: null,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "post_transaction_draft_rows",
      accessKind: "write",
      result: "denied",
      denialReason: "blocked by write policy",
      createdAt: "2026-06-03T00:00:00.000Z",
    });
    await app.persistence.appendAiConnectorAccessLog({
      id: "log-denied-new",
      connectionId: null,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "delete_draft",
      accessKind: "draft_delete",
      result: "denied",
      denialReason: "blocked by draft policy",
      createdAt: "2026-06-04T00:00:00.000Z",
    });

    const first = await app.inject({
      method: "GET",
      url: "/ai/connectors/logs?limit=1&result=denied&search=blocked",
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      hasMore: true,
      nextOffset: 1,
      accessLogs: [{ id: "log-denied-new", result: "denied" }],
    });

    const second = await app.inject({
      method: "GET",
      url: "/ai/connectors/logs?limit=1&offset=1&result=denied&search=blocked",
    });
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({
      hasMore: false,
      nextOffset: null,
      accessLogs: [{ id: "log-denied-old", result: "denied" }],
    });
  });

  it("filters connector access logs by connectionId", async () => {
    const firstConnection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT Alpha",
        scopes: ["portfolio:mcp_read"],
        toolToggles: {},
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const secondConnection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "self_hosted",
        clientKind: "claude_code",
        vendor: "anthropic",
        authMode: "bearer",
        capabilities: ["bearer_fallback", "deep_link_fallback"],
        displayName: "Claude Beta",
        scopes: ["portfolio:mcp_read"],
        toolToggles: {},
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );

    await app.persistence.appendAiConnectorAccessLog({
      id: "log-connection-alpha",
      connectionId: firstConnection.id,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
      createdAt: "2026-06-05T00:00:00.000Z",
    });
    await app.persistence.appendAiConnectorAccessLog({
      id: "log-connection-beta",
      connectionId: secondConnection.id,
      userId: "user-1",
      portfolioContextUserId: "user-1",
      toolName: "get_portfolio_report",
      accessKind: "read",
      result: "ok",
      createdAt: "2026-06-06T00:00:00.000Z",
    });

    const filtered = await app.inject({
      method: "GET",
      url: `/ai/connectors/logs?limit=5&connectionId=${firstConnection.id}`,
    });
    expect(filtered.statusCode).toBe(200);
    expect(filtered.json()).toMatchObject({
      hasMore: false,
      nextOffset: null,
      accessLogs: [
        expect.objectContaining({
          id: "log-connection-alpha",
          connectionId: firstConnection.id,
          connectionDisplayName: firstConnection.displayName,
        }),
      ],
    });
    expect(filtered.json<{ accessLogs: Array<{ id: string }> }>().accessLogs).toHaveLength(1);

    const missing = await app.inject({
      method: "GET",
      url: "/ai/connectors/logs?limit=5&connectionId=conn-user-1-missing",
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toEqual({
      accessLogs: [],
      hasMore: false,
      nextOffset: null,
    });
  });

  it("preserves null draft-row patches so optional values can be cleared from the review UI", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
            commissionAmount: 5,
            taxAmount: 1,
            note: "remove me",
            sourceSnippet: "raw row",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeDefined();

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/transaction-drafts/${created.batch.id}/rows/${row!.id}`,
      payload: {
        expectedVersion: row!.version,
        patch: {
          commissionAmount: null,
          taxAmount: null,
          note: null,
          sourceSnippet: null,
        },
      },
    });

    expect(patched.statusCode).toBe(200);
    const body = patched.json<{ rows: Array<{ id: string; commissionAmount: number | null; taxAmount: number | null; note: string | null; sourceSnippet: string | null }> }>();
    expect(body.rows[0]).toMatchObject({
      id: row!.id,
      commissionAmount: null,
      taxAmount: null,
      note: null,
      sourceSnippet: null,
    });
  });

  it("accepts AI draft-row decimal booked charges with up to 4 decimal places", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            marketCode: "TW",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeDefined();

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/transaction-drafts/${created.batch.id}/rows/${row!.id}`,
      payload: {
        expectedVersion: row!.version,
        patch: {
          commissionAmount: 1.2345,
          taxAmount: 0.4321,
        },
      },
    });

    expect(patched.statusCode).toBe(200);
    const patchedBody = patched.json();
    expect(patchedBody.rows[0]).toMatchObject({
      commissionAmount: 1.2345,
      taxAmount: 0.4321,
    });
  });

  it("rejects AI draft-row decimal booked charges with more than 4 decimal places", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            marketCode: "TW",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-03",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeDefined();

    const patched = await app.inject({
      method: "PATCH",
      url: `/ai/transaction-drafts/${created.batch.id}/rows/${row!.id}`,
      payload: {
        expectedVersion: row!.version,
        patch: {
          commissionAmount: 1.23456,
        },
      },
    });

    expect(patched.statusCode).toBe(400);
    expect(patched.json()).toMatchObject({
      error: "validation_error",
    });
    expect(patched.body).toContain("at most 4 decimal places");
  });

  it("attributes shared-context MCP access logs to the owner context and share record", async () => {
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-mcp-user", {
      email: "shared-mcp@example.com",
      name: "Shared MCP User",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });
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
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const call = await callMcpTool(headers, sessionId, "get_portfolio_overview", {
      portfolioContextUserId: "user-1",
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("portfolio");

    const logs = await app.persistence.listAiConnectorAccessLogsForUser(sharedUserId);
    expect(logs[0]).toMatchObject({
      connectionId: connection.id,
      userId: sharedUserId,
      portfolioContextUserId: "user-1",
      shareId: share.id,
      toolName: "get_portfolio_overview",
      accessKind: "read",
      result: "ok",
    });
  });

  it("requires shared account:manage for MCP account create, update, soft-delete, and restore", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });

    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-account-manager-user", {
      email: "shared-account-manager@example.com",
      name: "Shared Account Manager",
    });
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
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
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const denied = await callMcpTool(headers, sessionId, "create_account", {
      portfolioContextUserId: "user-1",
      name: "Delegated MCP Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(denied.statusCode).toBe(200);
    expect(denied.body).toContain("Shared portfolio capability account:manage is not enabled");

    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "account:manage"],
      grantedByUserId: "user-1",
    });

    const created = await callMcpTool(headers, sessionId, "create_account", {
      portfolioContextUserId: "user-1",
      name: "Delegated MCP Account",
      defaultCurrency: "TWD",
      accountType: "broker",
    });
    expect(created.statusCode).toBe(200);
    expect(created.body).toContain("Delegated MCP Account");

    const ownerStore = await app.persistence.loadStore("user-1");
    const account = ownerStore.accounts.find((item) => item.name === "Delegated MCP Account");
    expect(account).toBeDefined();

    const updated = await callMcpTool(headers, sessionId, "update_account", {
      portfolioContextUserId: "user-1",
      accountId: account!.id,
      name: "Delegated MCP Account Updated",
      accountType: "wallet",
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.body).toContain("Delegated MCP Account Updated");

    const deleted = await callMcpTool(headers, sessionId, "soft_delete_account", {
      portfolioContextUserId: "user-1",
      accountId: account!.id,
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.body).toContain(account!.id);

    const restored = await callMcpTool(headers, sessionId, "restore_account", {
      portfolioContextUserId: "user-1",
      accountId: account!.id,
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.body).toContain(account!.id);

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; targetUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog;
    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delegated_portfolio_write",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            source: "mcp_tool",
            shareId: share.id,
            ownerUserId: "user-1",
            mutation: "account_created",
          }),
        }),
        expect.objectContaining({
          action: "account_soft_deleted",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            source: "mcp_tool",
            shareId: share.id,
          }),
        }),
        expect.objectContaining({
          action: "account_restored",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            source: "mcp_tool",
            shareId: share.id,
          }),
        }),
      ]),
    );
  });

  it("requires transaction:write for shared-context AI draft posting and allows it once the share enables write", async () => {
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-write-user", {
      email: "shared-write@example.com",
      name: "Shared Write User",
    });
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "shared review",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-05",
          },
        ],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeDefined();

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

    const denied = await app.inject({
      method: "POST",
      url: `/ai/transaction-drafts/${created.batch.id}/confirm`,
      headers: {
        "x-user-id": sharedUserId,
        "x-context-user-id": "user-1",
      },
      payload: {
        rowIds: [row!.id],
        expectedRowVersions: [{ rowId: row!.id, expectedVersion: row!.version }],
        expectedBatchVersion: created.batch.version,
        idempotencyKey: "shared-denied-post-1",
      },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "POST /ai/transaction-drafts/:batchId/confirm",
      },
    });

    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction_draft:edit", "transaction:write"],
      grantedByUserId: "user-1",
    });

    const allowed = await app.inject({
      method: "POST",
      url: `/ai/transaction-drafts/${created.batch.id}/confirm`,
      headers: {
        "x-user-id": sharedUserId,
        "x-context-user-id": "user-1",
      },
      payload: {
        rowIds: [row!.id],
        expectedRowVersions: [{ rowId: row!.id, expectedVersion: row!.version }],
        expectedBatchVersion: created.batch.version,
        idempotencyKey: "shared-allowed-post-1",
      },
    });
    expect(allowed.statusCode).toBe(200);
    const body = allowed.json<{ rows: Array<{ id: string; state: string; confirmedTradeEventId: string | null }> }>();
    expect(body.rows[0]).toMatchObject({
      id: row!.id,
      state: "confirmed",
    });
    expect(body.rows[0]?.confirmedTradeEventId).toBeTruthy();

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; targetUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog;
    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "delegated_portfolio_write",
          actorUserId: sharedUserId,
          targetUserId: "user-1",
          metadata: expect.objectContaining({
            mutation: "transaction_draft_rows_posted",
            routeKey: "POST /ai/transaction-drafts/:batchId/confirm",
            batchId: created.batch.id,
            rowIds: [row!.id],
            shareId: share.id,
            source: "shared_context",
          }),
        }),
      ]),
    );
  });

  it("requires an explicit portfolio selector for posted-transaction mutation tools", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const trade = await createTrade(app);
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "preview_update_posted_transactions", {
      reason: "Correct booked quantity",
      items: [{ transactionId: trade.id, patch: { quantity: 12 } }],
    });
    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: { isError?: boolean; structuredContent: { code: string; statusCode: number } };
    }>(response.body);
    expect(body.result.isError).toBe(true);
    expect(body.result.structuredContent).toMatchObject({
      code: "mcp_portfolio_required",
      statusCode: 400,
    });
  });

  it("requires delegated dividend access before persisting dividend-impacting MCP previews", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-mcp-preview-user", {
      email: "shared-mcp-preview@example.com",
      name: "Shared MCP Preview User",
    });
    const transactionIds = await seedMcpSharedDividendForOwner();
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction:write"],
      grantedByUserId: "user-1",
    });
    const savePreview = vi.spyOn(app.persistence, "savePostedTransactionMutationPreview");
    const headers = {
      authorization: `Bearer ${devToken({ userId: sharedUserId, scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const contexts = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
    const contextsBody = parseMcpJson<{
      result: { structuredContent: { portfolios: Array<{ label: string; isSelf: boolean }> } };
    }>(contexts.body);
    const delegatedPortfolio = contextsBody.result.structuredContent.portfolios.find((portfolio) => !portfolio.isSelf);
    expect(delegatedPortfolio).toBeTruthy();

    const deniedForScope = await callMcpTool(headers, sessionId, "preview_update_posted_transactions", {
      portfolio: { label: delegatedPortfolio!.label },
      reason: "Move purchases beyond dividend eligibility",
      items: [
        { transactionId: transactionIds[0], patch: { tradeDate: "2026-02-02" } },
        { transactionId: transactionIds[1], patch: { tradeDate: "2026-02-03" } },
      ],
    });
    const deniedForScopeBody = parseMcpJson<{
      result: {
        isError?: boolean;
        content?: Array<{ text?: string }>;
        _meta?: { "mcp/www_authenticate"?: string[] };
      };
    }>(deniedForScope.body);
    expect(deniedForScopeBody.result.content?.[0]?.text ?? "").toContain("Authorization");
    expect(deniedForScopeBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("error=\"insufficient_scope\"");
    expect(savePreview).not.toHaveBeenCalled();

    const dividendScopeHeaders = {
      authorization: `Bearer ${devToken({
        userId: sharedUserId,
        scopes: ["portfolio:mcp_read", "transaction:write", "dividend:write"],
      })}`,
      accept: "application/json, text/event-stream",
    };
    const dividendScopeSessionId = await initializeMcpSession(dividendScopeHeaders);
    const deniedForShare = await callMcpTool(
      dividendScopeHeaders,
      dividendScopeSessionId,
      "preview_delete_posted_transactions",
      {
        portfolio: { label: delegatedPortfolio!.label },
        reason: "Remove dividend-eligible transactions",
        items: transactionIds.map((transactionId) => ({ transactionId })),
      },
    );
    const deniedForShareBody = parseMcpJson<{
      result: { isError?: boolean; structuredContent: { code: string; statusCode: number } };
    }>(deniedForShare.body);
    expect(deniedForShareBody.result.isError).toBe(true);
    expect(deniedForShareBody.result.structuredContent).toMatchObject({
      code: "shared_capability_required",
      statusCode: 403,
    });
    expect(savePreview).not.toHaveBeenCalled();

    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction:write", "dividend:write"],
      grantedByUserId: "user-1",
    });
    const allowed = await callMcpTool(
      dividendScopeHeaders,
      dividendScopeSessionId,
      "preview_delete_posted_transactions",
      {
        portfolio: { label: delegatedPortfolio!.label },
        reason: "Remove dividend-eligible transactions",
        items: transactionIds.map((transactionId) => ({ transactionId })),
      },
    );
    const allowedBody = parseMcpJson<{ result: { isError?: boolean } }>(allowed.body);
    expect(allowedBody.result.isError).not.toBe(true);
    expect(savePreview).toHaveBeenCalledTimes(1);
  });

  it("previews, confirms, and reports posted-transaction MCP update runs", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const trade = await createTrade(app, { quantity: 10, unitPrice: 100, tradeDate: "2026-01-05" });
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const selfPortfolio = await getSelfPortfolio(headers, sessionId);

    const previewResponse = await callMcpTool(headers, sessionId, "preview_update_posted_transactions", {
      portfolio: { label: selfPortfolio.label },
      reason: "Correct booked quantity",
      items: [{ transactionId: trade.id, patch: { quantity: 12 } }],
    });
    expect(previewResponse.statusCode).toBe(200);
    const previewBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          previewId: string;
          previewVersion: number;
          operation: string;
          status: string;
          fingerprint: string;
          confirmationSummary: string;
          confirmationDigest: string;
          page: { items: Array<{ after: { quantity: number } | null }> };
        };
      };
    }>(previewResponse.body);
    expect(previewBody.result.isError).not.toBe(true);
    expect(previewBody.result.structuredContent.operation).toBe("update");
    expect(previewBody.result.structuredContent.status).toBe("ready");
    expect(previewBody.result.structuredContent.page.items[0]?.after?.quantity).toBe(12);

    const getPreviewResponse = await callMcpTool(headers, sessionId, "get_posted_transaction_mutation_preview", {
      portfolio: { label: selfPortfolio.label },
      previewId: previewBody.result.structuredContent.previewId,
      limit: 10,
      offset: 0,
    });
    expect(getPreviewResponse.statusCode).toBe(200);
    const getPreviewBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          previewId: string;
          confirmationDigest: string;
          page: { total: number };
        };
      };
    }>(getPreviewResponse.body);
    expect(getPreviewBody.result.isError).not.toBe(true);
    expect(getPreviewBody.result.structuredContent).toMatchObject({
      previewId: previewBody.result.structuredContent.previewId,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(getPreviewBody.result.structuredContent.page.total).toBe(1);

    const confirmResponse = await callMcpTool(headers, sessionId, "update_posted_transactions", {
      portfolio: { label: selfPortfolio.label },
      previewId: previewBody.result.structuredContent.previewId,
      previewVersion: previewBody.result.structuredContent.previewVersion,
      operation: "update",
      fingerprint: previewBody.result.structuredContent.fingerprint,
      confirmationSummary: previewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(confirmResponse.statusCode).toBe(200);
    const confirmBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          runId: string;
          operation: string;
          previewId: string;
        };
      };
    }>(confirmResponse.body);
    expect(confirmBody.result.isError).not.toBe(true);
    expect(confirmBody.result.structuredContent.operation).toBe("update");

    const runResponse = await callMcpTool(headers, sessionId, "get_posted_transaction_mutation_run", {
      portfolio: { label: selfPortfolio.label },
      runId: confirmBody.result.structuredContent.runId,
    });
    expect(runResponse.statusCode).toBe(200);
    const runBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          runId: string;
          previewId: string;
          status: string;
          rebuildStatus: string;
        };
      };
    }>(runResponse.body);
    expect(runBody.result.isError).not.toBe(true);
    expect(runBody.result.structuredContent.runId).toBe(confirmBody.result.structuredContent.runId);
    expect(runBody.result.structuredContent.previewId).toBe(previewBody.result.structuredContent.previewId);
    expect(runBody.result.structuredContent.status).toBe("completed");
    expect(runBody.result.structuredContent.rebuildStatus).toBe("completed");

    const transactions = await app.persistence.loadStore("user-1");
    const updatedTrade = transactions.accounting.facts.tradeEvents.find((entry) => entry.id === trade.id);
    expect(updatedTrade?.quantity).toBe(12);
  });

  it("requires delegated dividend:write before confirming posted-transaction deletes for shared portfolios", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const { userId: sharedUserId } = await app.persistence.resolveOrCreateUser("google", "shared-mcp-delete-user", {
      email: "shared-mcp-delete@example.com",
      name: "Shared MCP Delete User",
    });
    const trade = await createTrade(app);
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: sharedUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction:write"],
      grantedByUserId: "user-1",
    });

    const previewHeaders = {
      authorization: `Bearer ${devToken({ userId: sharedUserId, scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const previewSessionId = await initializeMcpSession(previewHeaders);
    const sharedPortfolio = await callMcpTool(previewHeaders, previewSessionId, "list_portfolio_contexts", {});
    const sharedPortfolioBody = parseMcpJson<{
      result: { structuredContent: { portfolios: Array<{ label: string; isSelf: boolean }> } };
    }>(sharedPortfolio.body);
    const delegatedPortfolio = sharedPortfolioBody.result.structuredContent.portfolios.find((portfolio) => !portfolio.isSelf);
    expect(delegatedPortfolio).toBeTruthy();

    const previewResponse = await callMcpTool(previewHeaders, previewSessionId, "preview_delete_posted_transactions", {
      portfolio: { label: delegatedPortfolio!.label },
      reason: "Remove incorrect posted trade",
      items: [{ transactionId: trade.id }],
    });
    expect(previewResponse.statusCode).toBe(200);
    const previewBody = parseMcpJson<{
      result: {
        structuredContent: {
          previewId: string;
          previewVersion: number;
          fingerprint: string;
          confirmationSummary: string;
          confirmationDigest: string;
        };
      };
    }>(previewResponse.body);
    const savedPreview = await app.persistence.getPostedTransactionMutationPreview(
      previewBody.result.structuredContent.previewId,
    );
    expect(savedPreview).toBeTruthy();
    await app.persistence.savePostedTransactionMutationPreview({
      ...savedPreview!,
      summary: {
        ...savedPreview!.summary,
        deletedDividendCount: 1,
      },
    });

    const deniedConfirm = await callMcpTool(previewHeaders, previewSessionId, "delete_posted_transactions", {
      portfolio: { label: delegatedPortfolio!.label },
      previewId: previewBody.result.structuredContent.previewId,
      previewVersion: previewBody.result.structuredContent.previewVersion,
      operation: "delete",
      fingerprint: previewBody.result.structuredContent.fingerprint,
      confirmationSummary: previewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(deniedConfirm.statusCode).toBe(200);
    const deniedBody = parseMcpJson<{
      result: {
        isError?: boolean;
        content?: Array<{ text?: string }>;
        _meta?: { "mcp/www_authenticate"?: string[] };
      };
    }>(deniedConfirm.body);
    expect(deniedBody.result.content?.[0]?.text ?? "").toContain("Authorization");
    expect(deniedBody.result._meta?.["mcp/www_authenticate"]?.[0]).toContain("error=\"insufficient_scope\"");

    const allowedHeaders = {
      authorization: `Bearer ${devToken({ userId: sharedUserId, scopes: ["portfolio:mcp_read", "transaction:write", "dividend:write"] })}`,
      accept: "application/json, text/event-stream",
    };
    const allowedSessionId = await initializeMcpSession(allowedHeaders);
    const stillDenied = await callMcpTool(allowedHeaders, allowedSessionId, "delete_posted_transactions", {
      portfolio: { label: delegatedPortfolio!.label },
      previewId: previewBody.result.structuredContent.previewId,
      previewVersion: previewBody.result.structuredContent.previewVersion,
      operation: "delete",
      fingerprint: previewBody.result.structuredContent.fingerprint,
      confirmationSummary: previewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(stillDenied.statusCode).toBe(200);
    const stillDeniedBody = parseMcpJson<{
      result: { isError?: boolean; structuredContent: { code: string; statusCode: number } };
    }>(stillDenied.body);
    expect(stillDeniedBody.result.isError).toBe(true);
    expect(stillDeniedBody.result.structuredContent).toMatchObject({
      code: "shared_capability_required",
      statusCode: 403,
    });

    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read", "transaction:write", "dividend:write"],
      grantedByUserId: "user-1",
    });
    const allowedConfirm = await callMcpTool(allowedHeaders, allowedSessionId, "delete_posted_transactions", {
      portfolio: { label: delegatedPortfolio!.label },
      previewId: previewBody.result.structuredContent.previewId,
      previewVersion: previewBody.result.structuredContent.previewVersion,
      operation: "delete",
      fingerprint: previewBody.result.structuredContent.fingerprint,
      confirmationSummary: previewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(allowedConfirm.statusCode).toBe(200);
    const allowedBody = parseMcpJson<{
      result: { isError?: boolean; structuredContent: { operation: string } };
    }>(allowedConfirm.body);
    expect(allowedBody.result.isError).not.toBe(true);
    expect(allowedBody.result.structuredContent.operation).toBe("delete");
  });

  it("rate limits posted-transaction mutation writes after sixty calls per minute", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const trade = await createTrade(app);
    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "Rate Limit Connector",
        scopes: ["portfolio:mcp_read", "transaction:write"],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", connectionId: connection.id, clientId: "chatgpt", scopes: ["portfolio:mcp_read", "transaction:write"] })}`,
      accept: "application/json, text/event-stream",
      "x-user-id": "mcp-rate-limit-test",
    };
    const sessionId = await initializeMcpSession(headers);
    const selfPortfolio = await getSelfPortfolio(headers, sessionId);

    for (let attempt = 1; attempt <= 60; attempt += 1) {
      const response = await callMcpTool(headers, sessionId, "preview_update_posted_transactions", {
        portfolio: { label: selfPortfolio.label },
        reason: `Rate limit attempt ${attempt}`,
        items: [{ transactionId: trade.id, patch: { quantity: 10 + attempt } }],
      });
      expect(response.statusCode).toBe(200);
      const body = parseMcpJson<{
        result: { isError?: boolean; structuredContent?: { code?: string } };
      }>(response.body);
      expect(body.result.isError).not.toBe(true);
    }

    const limited = await callMcpTool(headers, sessionId, "preview_update_posted_transactions", {
      portfolio: { label: selfPortfolio.label },
      reason: "Rate limit attempt 61",
      items: [{ transactionId: trade.id, patch: { quantity: 1000 } }],
    });
    expect(limited.statusCode).toBe(200);
    const limitedBody = parseMcpJson<{
      result: { isError?: boolean; structuredContent: { code: string; statusCode: number } };
    }>(limited.body);
    expect(limitedBody.result.isError).toBe(true);
    expect(limitedBody.result.structuredContent).toMatchObject({
      code: "mcp_rate_limited",
      statusCode: 429,
    });

    resetMcpRateLimitBucketsForTest();
  });

  it("omits internal raw and normalized payloads from AI draft detail DTOs", async () => {
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        candidates: [
          {
            rowNumber: 1,
            recordType: "trade",
            accountId: "acc-1",
            type: "BUY",
            ticker: "2330",
            quantity: 1,
            unitPrice: 100,
            tradeDate: "2026-01-06",
            sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "BUY,2330,1,100" },
          },
          {
            rowNumber: 2,
            recordType: "unsupported",
            sourceSnippet: "cash transfer row",
            sourceMetadata: { fileId: "file-1", rowRef: "2", snippet: "cash transfer details" },
          },
        ],
      },
    );

    const detail = await app.inject({
      method: "GET",
      url: `/ai/transaction-drafts/${created.batch.id}`,
    });

    expect(detail.statusCode).toBe(200);
    const body = detail.json<{
      rows: Array<Record<string, unknown>>;
      unsupportedItems: Array<Record<string, unknown>>;
    }>();
    expect(body.rows[0]).not.toHaveProperty("normalizedPayload");
    expect(body.rows[0]).not.toHaveProperty("rawPayload");
    expect(body.unsupportedItems[0]).not.toHaveProperty("rawPayload");
  });

  it("rejects connector-mediated raw source payloads for draft batch creation", async () => {
    const token = devToken({
      userId: "user-1",
      scopes: ["transaction_draft:create"],
    });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const call = await callMcpTool(headers, sessionId, "create_transaction_draft_batch", {
      provenance: {
        sourceType: "csv",
        files: [{ fileId: "file-1", sourceType: "csv", snippet: "2330,1" }],
      },
      candidates: [{
        rowNumber: 1,
        recordType: "trade",
        accountId: "acc-1",
        type: "BUY",
        ticker: "2330",
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-03",
        rawPayload: { csv: "ticker,qty\n2330,1" },
      }],
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("Unrecognized key");
    expect(call.body).toContain("rawPayload");
  });

  it("posts draft rows over MCP with compact results and ChatGPT component audit metadata", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "chatgpt import",
        provenance: {
          sourceType: "csv",
          files: [{ fileId: "file-1", sourceType: "csv", displayName: "import.csv", snippet: "2330,BUY,1,100" }],
        },
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
          sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "2330,BUY,1,100" },
        }],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeTruthy();

    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "chatgpt",
        displayName: "ChatGPT",
        scopes: [
          "transaction_draft:create",
          "transaction_draft:edit",
          "transaction:write",
        ],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: "user-1", connectionId: connection.id, clientId: "chatgpt" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const component = await callMcpTool(headers, sessionId, "get_transaction_draft_batch_component", {
      batchId: created.batch.id,
    });
    expect(component.statusCode).toBe(200);
    expect(component.body).toContain("\"widget\"");
    expect(component.body).toContain("\"get_transaction_draft_batch_component\"");
    expect(component.body).toContain("\"openai/outputTemplate\"");
    expect(component.body).toContain("/connectors/chatgpt/transaction-draft");

    const call = await callMcpTool(headers, sessionId, "post_transaction_draft_rows", {
      batchId: created.batch.id,
      rowIds: [row!.id],
      expectedBatchVersion: aggregate!.batch.version,
      expectedRowVersions: [{ rowId: row!.id, expectedVersion: row!.version }],
      idempotencyKey: "chatgpt-post-1",
    });

    expect(call.statusCode).toBe(200);
    expect(call.body).toContain("\"outcome\":\"posted\"");
    expect(call.body).toContain(`"postedRowIds":["${row!.id}"]`);

    const saved = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    expect(saved?.rows[0]).toMatchObject({ state: "confirmed" });
    expect(saved?.events.at(-1)).toMatchObject({
      eventType: "rows_confirmed",
      metadata: expect.objectContaining({
        source: "chatgpt_component",
        postedRowIds: [row!.id],
      }),
    });
    const logs = await app.persistence.listAiConnectorAccessLogsForUser("user-1");
    expect(logs[0]?.metadata).toMatchObject({ source: "chatgpt_component" });
  });

  it("returns authenticated web fallback links for non-widget MCP draft clients", async () => {
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { write: true } });
    const created = await createTransactionDraftBatch(
      { app, requestContext: createRequestContext() },
      {
        sourceLabel: "claude import",
        provenance: {
          sourceType: "csv",
          files: [{ fileId: "file-1", sourceType: "csv", displayName: "import.csv", snippet: "2330,BUY,1,100" }],
        },
        candidates: [{
          rowNumber: 1,
          recordType: "trade",
          accountId: "acc-1",
          type: "BUY",
          ticker: "2330",
          quantity: 1,
          unitPrice: 100,
          tradeDate: "2026-01-03",
          sourceMetadata: { fileId: "file-1", rowRef: "1", snippet: "2330,BUY,1,100" },
        }],
      },
    );
    const aggregate = await app.persistence.getAiTransactionDraftBatch(created.batch.id);
    const row = aggregate?.rows[0];
    expect(row).toBeTruthy();

    const connection = await createAiConnectorConnection(
      app,
      {
        userId: "user-1",
        provider: "self_hosted",
        vendor: "anthropic",
        clientKind: "claude_code",
        authMode: "bearer",
        displayName: "Claude Code",
        scopes: [
          "portfolio:mcp_read",
          "transaction_draft:create",
          "transaction_draft:edit",
          "transaction:write",
        ],
      },
      { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    );
    const token = devToken({ userId: "user-1", connectionId: connection.id, clientId: "claude_code" });
    const headers = {
      authorization: `Bearer ${token}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);

    const component = await callMcpTool(headers, sessionId, "get_transaction_draft_batch_component", {
      batchId: created.batch.id,
    });
    expect(component.statusCode).toBe(200);
    expect(component.body).not.toContain("\"openai/outputTemplate\"");
    const componentBody = parseMcpJson<{
      result: {
        structuredContent: {
          operation: string;
          batch: { id: string };
          webFallback: {
            url: string;
            requiresAuthenticatedSession: boolean;
            mode: string;
            operation: string;
          };
        };
        _meta?: {
          "vakwen/webFallback"?: {
            url: string;
            requiresAuthenticatedSession: boolean;
          };
        };
      };
    }>(component.body);
    expect(componentBody.result.structuredContent.operation).toBe("transaction_draft_review");
    expect(componentBody.result.structuredContent.batch.id).toBe(created.batch.id);
    expect(componentBody.result.structuredContent.webFallback).toMatchObject({
      requiresAuthenticatedSession: true,
      mode: "vakwen_web",
      operation: "transaction_draft_review",
    });
    expect(componentBody.result.structuredContent.webFallback.url).toContain("/transactions?tab=ai-inbox");
    expect(componentBody.result.structuredContent.webFallback.url).toContain(`batch=${created.batch.id}`);
    expect(componentBody.result._meta?.["vakwen/webFallback"]?.url).toBe(componentBody.result.structuredContent.webFallback.url);

    const portfolios = await callMcpTool(headers, sessionId, "list_portfolio_contexts", {});
    expect(portfolios.statusCode).toBe(200);
    const portfoliosBody = parseMcpJson<{
      result: {
        structuredContent: {
          portfolios: Array<{ label: string; email: string | null; isSelf: boolean }>;
        };
        isError?: boolean;
      };
    }>(portfolios.body);
    expect(portfoliosBody.result.isError).not.toBe(true);
    const selfPortfolio = portfoliosBody.result.structuredContent.portfolios.find((portfolio) => portfolio.isSelf);
    expect(selfPortfolio).toBeTruthy();

    const batchLabel = created.batch.sourceLabel ?? created.batch.id;
    const preview = await callMcpTool(headers, sessionId, "get_transaction_draft_posting_preview_by_name", {
      portfolio: { label: selfPortfolio!.label },
      batchLabel,
      rowNumbers: [1],
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          confirmationSummary: string;
          confirmationDigest: string;
        };
      };
    }>(preview.body);
    expect(previewBody.result.isError).not.toBe(true);

    resetMcpRateLimitBucketsForTest();

    const posted = await callMcpTool(headers, sessionId, "post_transaction_draft_rows_by_name", {
      portfolio: { label: selfPortfolio!.label },
      batchLabel,
      rowNumbers: [1],
      idempotencyKey: "claude-post-by-name-1",
      confirmationSummary: previewBody.result.structuredContent.confirmationSummary,
      confirmationDigest: previewBody.result.structuredContent.confirmationDigest,
    });
    expect(posted.statusCode).toBe(200);
    const postedBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          outcome: string;
          deepLinkUrl?: string;
          webFallback: {
            url: string;
            requiresAuthenticatedSession: boolean;
            operation: string;
          };
          _meta?: Record<string, unknown>;
        };
        _meta?: {
          "vakwen/webFallback"?: {
            url: string;
          };
          deepLinkUrl?: string;
        };
      };
    }>(posted.body);
    expect(postedBody.result.isError).not.toBe(true);
    expect(postedBody.result.structuredContent.outcome).toBe("posted");
    expect(postedBody.result.structuredContent.deepLinkUrl).toBeUndefined();
    expect(postedBody.result.structuredContent.webFallback).toMatchObject({
      requiresAuthenticatedSession: true,
      operation: "transaction_draft_posting",
    });
    expect(postedBody.result.structuredContent.webFallback.url).toContain("/transactions?tab=ai-inbox");
    expect(postedBody.result.structuredContent.webFallback.url).toContain(`batch=${created.batch.id}`);
    expect(postedBody.result._meta?.deepLinkUrl).toContain(`batch=${created.batch.id}`);
    expect(postedBody.result._meta?.["vakwen/webFallback"]?.url).toBe(postedBody.result.structuredContent.webFallback.url);
  });
});
