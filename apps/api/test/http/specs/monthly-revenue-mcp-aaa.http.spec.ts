import { Buffer } from "node:buffer";
import type { APIRequestContext } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "../fixtures.js";
import { createOauthSession } from "./helpers/sharing.js";

const mcpUrl = new URL("/mcp", TestEnv.apiBaseUrl).href;
const mcpAdminFreshAuthUrl = new URL("/admin/mcp/fresh-auth", TestEnv.apiBaseUrl).href;
const mcpAdminSettingsUrl = new URL("/admin/mcp/settings", TestEnv.apiBaseUrl).href;

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

function mcpStructuredContent<T>(body: string, label: string): T {
  const envelope = parseMcpJson<{
    result?: {
      structuredContent?: unknown;
      content?: Array<{ type: string; text?: string }>;
      isError?: boolean;
    };
    error?: unknown;
  }>(body);
  if (envelope.result?.structuredContent) return envelope.result.structuredContent as T;
  const text = envelope.result?.content?.find((item) => item.type === "text" && typeof item.text === "string")?.text;
  if (text?.trim().startsWith("{")) return JSON.parse(text) as T;
  throw new Error(`Unexpected MCP ${label} response: ${body}`);
}

async function initializeMcpSession(
  request: APIRequestContext,
  headers: Record<string, string>,
): Promise<string> {
  const response = await request.post(mcpUrl, {
    headers,
    data: {
      jsonrpc: "2.0",
      id: "init-monthly-revenue-aaa",
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "Playwright", version: "1.0.0" },
      },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP initialize failed: ${response.status()} ${await response.text()}`);
  }
  const sessionId = response.headers()["mcp-session-id"];
  if (!sessionId) throw new Error("MCP initialize did not return mcp-session-id");
  return sessionId;
}

async function callMcpTool(
  request: APIRequestContext,
  headers: Record<string, string>,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
) {
  const response = await request.post(mcpUrl, {
    headers: {
      ...headers,
      "mcp-session-id": sessionId,
    },
    data: {
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  if (response.status() !== 200) {
    throw new Error(`MCP ${name} failed: ${response.status()} ${await response.text()}`);
  }
  return response.text();
}

test.describe("MCP monthly revenue", () => {
  test("[mcp research]: get_monthly_revenue accepts a TPEX selector and returns a wrapped read-only result", async ({ request, adminApi }) => {
    const admin = await createOauthSession(request, {
      sub: "http-monthly-revenue-admin-sub",
      email: "http-monthly-revenue-admin@example.com",
      name: "HTTP Monthly Revenue Admin",
      role: "admin",
    });
    const reader = await createOauthSession(request, {
      sub: "http-monthly-revenue-reader-sub",
      email: "http-monthly-revenue-reader@example.com",
      name: "HTTP Monthly Revenue Reader",
      role: "member",
    });
    const freshAuthResponse = await request.post(mcpAdminFreshAuthUrl, {
      headers: { cookie: admin.cookieHeader },
    });
    await adminApi.assert.statusIs(freshAuthResponse, 200);
    const freshAuthBody = await freshAuthResponse.json() as { freshAuthToken: string };
    const settingsResponse = await request.patch(mcpAdminSettingsUrl, {
      headers: {
        cookie: admin.cookieHeader,
        "content-type": "application/json",
        "x-vakwen-fresh-auth-at": freshAuthBody.freshAuthToken,
      },
      data: { groupToggles: { research: true } },
    });
    await adminApi.assert.statusIs(settingsResponse, 200);

    const headers = {
      authorization: `Bearer ${devToken({ userId: reader.userId, scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(request, headers);

    const firstBody = await callMcpTool(request, headers, sessionId, "get_monthly_revenue", {
      subject: { kind: "ticker_venue", ticker: "0000", listingVenue: "TPEX" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      page: { limit: 2, order: "desc" },
    });
    const secondBody = await callMcpTool(request, headers, sessionId, "get_monthly_revenue", {
      subject: { kind: "ticker_venue", ticker: "0000", listingVenue: "TPEX" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      page: { limit: 2, order: "desc" },
    });

    const first = parseMcpJson<{
      result: {
        isError?: boolean;
      };
    }>(firstBody);
    const second = parseMcpJson<{
      result: {
        isError?: boolean;
      };
    }>(secondBody);
    const firstStructured = mcpStructuredContent<{
      result?: {
        code?: string;
        message?: string;
        statusCode?: number;
      };
      code?: string;
      message?: string;
      statusCode?: number;
    }>(firstBody, "get_monthly_revenue first call");
    const secondStructured = mcpStructuredContent<{
      result?: {
        code?: string;
        message?: string;
        statusCode?: number;
      };
      code?: string;
      message?: string;
      statusCode?: number;
    }>(secondBody, "get_monthly_revenue second call");

    await adminApi.assert.mxAssertEqual(first.result.isError, true, firstBody);
    await adminApi.assert.mxAssertEqual(second.result.isError, true, secondBody);
    await adminApi.assert.mxAssertDeepEqual(firstStructured, secondStructured, "deterministic store-only result");
    await adminApi.assert.mxAssertEqual(firstStructured.result?.code, "research_subject_not_found", "wrapped error code");
    await adminApi.assert.mxAssertEqual(firstStructured.result?.statusCode, 422, "wrapped error status");
    await adminApi.assert.mxAssertEqual(JSON.stringify(firstStructured).includes("confirmationSummary"), false, "no write confirmation summary");
    await adminApi.assert.mxAssertEqual(JSON.stringify(firstStructured).includes("confirmationDigest"), false, "no write confirmation digest");
  });
});
