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
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  researchPriceSeriesOutputSchema,
  researchPriceSeriesToolOutputSchema,
} from "../../src/services/research/contracts.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";

let app: Awaited<ReturnType<typeof buildApp>>;

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
  return String(initialize.headers["mcp-session-id"]);
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

describe("MCP get_price_series QA", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: false,
    });
    app = await buildApp({
      persistenceBackend: "memory",
      oauthConfig: {
        clientId: "test-client",
        clientSecret: "test-secret",
        redirectUri: "http://localhost/auth/google/callback",
        sessionSecret: "test-session-secret-that-is-at-least-32-chars",
      },
      appBaseUrl: "http://localhost:3000",
    });
    await app.persistence.saveAiConnectorPolicySettings({ groupToggles: { research: true } });
  });

  afterEach(async () => {
    setResearchRolloutOverrideForTest(null);
    await app.close();
  });

  it("success path: return structured series for the public get_price_series tool", async () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2330",
        legalName: "台灣積體電路製造股份有限公司",
        displayName: "台積電",
        unifiedBusinessNumber: "22099131",
        industryCode: "24",
        listedAt: "1994-09-05",
      },
    });
    await app.persistence.appendResearchIdentityRecords([record]);
    await app.persistence.appendResearchPriceRecords([canonicalizeOfficialPriceRow({
      listingId: record.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      retrievedAt: "2026-08-27T10:00:00.000Z",
      artifact: {
        contentHash: "sha256:mcp-price",
        sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        publisherDataset: "STOCK_DAY_ALL",
        accessProvider: "TWSE_OPENAPI",
      },
      row: {
        state: "full_bar",
        open: "100",
        high: "102",
        low: "99",
        close: "101",
        volume: "1000",
        tradedValue: "101000",
        tradeCount: "100",
      },
    })]);

    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 10 },
      metrics: [],
    });

    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; content: Array<{ text: string }>; isError?: boolean } }>(response.body);
    expect(body.result.isError).not.toBe(true);
    const priceResult = (body.result.structuredContent as { result: unknown }).result;
    expect(researchPriceSeriesOutputSchema.parse(priceResult)).toEqual(priceResult);
    expect(priceResult).toMatchObject({
      selector: { kind: "listing_id", listingId: record.listing.id },
      page: { recordCount: 1, truncatedByBudget: false },
    });
    expect(body.result.content[0]?.text).toContain("Research price series for TWSE:2330");
  });

  it("error path: return structured cursor and record-size errors for get_price_series", async () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-error-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2330",
        legalName: "台灣積體電路製造股份有限公司",
        displayName: "台積電",
        unifiedBusinessNumber: "22099131",
        industryCode: "24",
        listedAt: "1994-09-05",
      },
    });
    await app.persistence.appendResearchIdentityRecords([record]);
    await app.persistence.appendResearchPriceRecords([
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        retrievedAt: "2026-08-27T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:page-1",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: { state: "full_bar", open: "100", high: "101", low: "99", close: "100", volume: "1000", tradedValue: "100000", tradeCount: "10" },
      }),
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-28",
        retrievedAt: "2026-08-28T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:page-2",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: { state: "full_bar", open: "101", high: "102", low: "100", close: "101", volume: "1100", tradedValue: "111100", tradeCount: "11" },
      }),
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-28",
        retrievedAt: "2026-08-28T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:oversized",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: { state: "suspended", note: "X".repeat(300_000) },
      }),
    ]);

    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const firstPage = await callMcpTool(headers, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });
    const firstBody = parseMcpJson<{ result: { structuredContent: { result: { page: { nextCursor: string } } } } }>(firstPage.body);
    const cursor = firstBody.result.structuredContent.result.page.nextCursor;

    const invalid = await callMcpTool(headers, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "asc",
      page: { limit: 1, cursor },
      metrics: [],
    });
    const invalidBody = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; isError?: boolean } }>(invalid.body);
    expect(invalidBody.result.isError).toBe(true);
    expect(researchPriceSeriesToolOutputSchema.parse(invalidBody.result.structuredContent)).toMatchObject({
      result: { code: "research_cursor_invalid", statusCode: 422 },
    });

    const oversizedRecord = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-oversized-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2317",
        legalName: "鴻海精密工業股份有限公司",
        displayName: "鴻海",
        unifiedBusinessNumber: "04541302",
        industryCode: "24",
        listedAt: "1991-06-18",
      },
    });
    await app.persistence.appendResearchIdentityRecords([oversizedRecord]);
    await app.persistence.appendResearchPriceRecords([canonicalizeOfficialPriceRow({
      listingId: oversizedRecord.listing.id,
      ticker: "2317",
      venue: "TWSE",
      sessionDate: "2026-08-28",
      retrievedAt: "2026-08-28T10:00:00.000Z",
      artifact: {
        contentHash: "sha256:oversized-only",
        sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        publisherDataset: "STOCK_DAY_ALL",
        accessProvider: "TWSE_OPENAPI",
      },
      row: { state: "suspended", note: "X".repeat(300_000) },
    })]);

    const oversized = await callMcpTool(headers, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: oversizedRecord.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });
    const oversizedBody = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; isError?: boolean } }>(oversized.body);
    expect(oversizedBody.result.isError).toBe(true);
    expect(researchPriceSeriesToolOutputSchema.parse(oversizedBody.result.structuredContent)).toMatchObject({
      result: { code: "research_record_too_large", statusCode: 422 },
    });
  });

  it("cursor isolation: invalidate get_price_series cursors across auth, purpose, and version changes", async () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-cursor-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2330",
        legalName: "台灣積體電路製造股份有限公司",
        displayName: "台積電",
        unifiedBusinessNumber: "22099131",
        industryCode: "24",
        listedAt: "1994-09-05",
      },
    });
    await app.persistence.appendResearchIdentityRecords([record]);
    await app.persistence.appendResearchPriceRecords([
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        retrievedAt: "2026-08-27T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:cursor-1",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: { state: "full_bar", open: "100", high: "101", low: "99", close: "100", volume: "1000", tradedValue: "100000", tradeCount: "10" },
      }),
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-28",
        retrievedAt: "2026-08-28T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:cursor-2",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: { state: "full_bar", open: "101", high: "102", low: "100", close: "101", volume: "1100", tradedValue: "111100", tradeCount: "11" },
      }),
    ]);

    const userOneHeaders = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(userOneHeaders);
    const firstPage = await callMcpTool(userOneHeaders, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });
    const firstBody = parseMcpJson<{ result: { structuredContent: { result: { page: { nextCursor: string } } } } }>(firstPage.body);
    const cursor = firstBody.result.structuredContent.result.page.nextCursor;
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as {
      version: number;
      binding: string;
      issuedAt: string;
      sessionDate: string;
    };

    const userTwoHeaders = {
      authorization: `Bearer ${devToken({ userId: "user-2", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    await app.persistence.ensureDefaultPortfolioData("user-2");
    const userTwoSession = await initializeMcpSession(userTwoHeaders);
    const authChanged = await callMcpTool(userTwoHeaders, userTwoSession, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1, cursor },
      metrics: [],
    });
    const authBody = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; isError?: boolean } }>(authChanged.body);
    expect(authBody.result.isError).toBe(true);
    expect(researchPriceSeriesToolOutputSchema.parse(authBody.result.structuredContent)).toMatchObject({
      result: { code: "research_cursor_invalid", statusCode: 422 },
    });

    const purposeCursor = Buffer.from(JSON.stringify({
      ...decoded,
      sessionDate: "2026-08-26",
    }), "utf8").toString("base64url");
    const purposeChanged = await callMcpTool(userOneHeaders, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1, cursor: purposeCursor },
      metrics: [],
    });
    const purposeBody = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; isError?: boolean } }>(purposeChanged.body);
    expect(purposeBody.result.isError).toBe(true);
    expect(researchPriceSeriesToolOutputSchema.parse(purposeBody.result.structuredContent)).toMatchObject({
      result: { code: "research_cursor_invalid", statusCode: 422 },
    });

    const versionCursor = Buffer.from(JSON.stringify({
      ...decoded,
      version: 999,
    }), "utf8").toString("base64url");
    const versionChanged = await callMcpTool(userOneHeaders, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1, cursor: versionCursor },
      metrics: [],
    });
    const versionBody = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; isError?: boolean } }>(versionChanged.body);
    expect(versionBody.result.isError).toBe(true);
    expect(researchPriceSeriesToolOutputSchema.parse(versionBody.result.structuredContent)).toMatchObject({
      result: { code: "research_cursor_invalid", statusCode: 422 },
    });
  });

  it("budget boundary: keep the public structured get_price_series envelope within 256 KiB", async () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-budget-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2303",
        legalName: "聯華電子股份有限公司",
        displayName: "聯電",
        unifiedBusinessNumber: "47217677",
        industryCode: "24",
        listedAt: "1985-07-08",
      },
    });
    await app.persistence.appendResearchIdentityRecords([record]);
    await app.persistence.appendResearchPriceRecords(
      Array.from({ length: 31 }, (_, index) => canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2303",
        venue: "TWSE",
        sessionDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        retrievedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
        artifact: {
          contentHash: `sha256:mcp-budget-${index}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: { state: "suspended", note: "budget-note-".repeat(1600) },
      })),
    );

    const headers = {
      authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
      accept: "application/json, text/event-stream",
    };
    const sessionId = await initializeMcpSession(headers);
    const response = await callMcpTool(headers, sessionId, "get_price_series", {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 31 },
      basis: "raw",
      order: "desc",
      page: { limit: 31 },
      metrics: [],
    });

    const body = parseMcpJson<{ result: { structuredContent: Record<string, unknown>; isError?: boolean } }>(response.body);
    expect(body.result.isError).not.toBe(true);
    expect(Buffer.byteLength(JSON.stringify(body.result.structuredContent), "utf8")).toBeLessThanOrEqual(256 * 1024);
    expect(researchPriceSeriesToolOutputSchema.parse(body.result.structuredContent)).toMatchObject({
      result: {
        page: {
          truncatedByBudget: true,
          nextCursor: expect.any(String),
        },
      },
    });
  });
});
