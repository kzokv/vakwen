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
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { canonicalizeOfficialMonthlyRevenueRow } from "../../src/services/research/monthlyRevenue.js";

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

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
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

  it("monthly revenue MCP: return wrapped structured results from the canonical store without write side effects", async () => {
    const identity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-revenue-identity", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await app.persistence.appendResearchIdentityRecords([identity]);
    for (const [index, revenueMonth] of ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].entries()) {
      const [year, month] = revenueMonth.split("-").map(Number);
      const rocYear = year - 1911;
      await app.persistence.appendResearchMonthlyRevenueRecords([canonicalizeOfficialMonthlyRevenueRow({
        venue: "TWSE",
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: "2330",
        companyName: "台積電",
        industryName: "半導體業",
        revenueMonth,
        rawRevenueMonth: `${rocYear}${String(month).padStart(2, "0")}`,
        publishedAt: revenueMonth === "2026-07" ? "2026-08-10" : `${year}-${String((month % 12) + 1).padStart(2, "0")}-10`,
        rawPublishedAt: revenueMonth === "2026-07" ? "1150810" : `${rocYear}${String((month % 12) + 1).padStart(2, "0")}10`,
        retrievedAt: `2026-08-${String((index % 9) + 1).padStart(2, "0")}T02:00:00.000Z`,
        artifact: {
          contentHash: `sha256:mcp-${revenueMonth}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
          publisherDataset: "t187ap05_L",
          accessProvider: "TWSE_OPENAPI",
        },
        source: {
          currentMonthRevenue: String(1000 + index * 10),
          priorMonthRevenue: String(990 + index * 10),
          priorYearSameMonthRevenue: String(900 + index * 10),
          monthOverMonthPercent: "1.01",
          yearOverYearPercent: "11.11",
          currentYearToDateRevenue: String(7000 + index * 100),
          priorYearToDateRevenue: String(6300 + index * 100),
          yearToDateYearOverYearPercent: "11.11",
          note: "-",
        },
      })]);
    }
    const appendIdentitySpy = vi.spyOn(app.persistence, "appendResearchIdentityRecords");
    const appendRevenueSpy = vi.spyOn(app.persistence, "appendResearchMonthlyRevenueRecords");

    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: "localhost:4000",
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "init-revenue",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "Vitest", version: "1.0.0" },
        },
      },
    });
    expect(initialize.statusCode).toBe(200);
    const sessionId = String(initialize.headers["mcp-session-id"]);

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: "localhost:4000",
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
        "mcp-session-id": sessionId,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-monthly-revenue",
        method: "tools/call",
        params: {
          name: "get_monthly_revenue",
          arguments: {
            subject: { kind: "listing_id", listingId: identity.listing.id },
            context: {
              knowledgeAt: "2026-08-28T00:00:00.000Z",
              effectiveAt: "2026-08-28T00:00:00.000Z",
              assessmentMode: "effective",
            },
            page: { limit: 2, order: "desc" },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(appendIdentitySpy).not.toHaveBeenCalled();
    expect(appendRevenueSpy).not.toHaveBeenCalled();
    const body = parseMcpJson<{
      result: {
        content: Array<{ text: string }>;
        structuredContent: {
          result: {
            selector: { listingId: string };
            freshness: { latestExpectedMonth: string; latestDueStatus: string };
            items: Array<{ revenueMonth: string }>;
          };
        };
        isError?: boolean;
      };
    }>(response.body);
    expect(body.result.isError, response.body).not.toBe(true);
    expect(body.result.structuredContent.result).toMatchObject({
      selector: { listingId: identity.listing.id },
      freshness: { latestExpectedMonth: "2026-07", latestDueStatus: "reported" },
      items: [{ revenueMonth: "2026-07" }, { revenueMonth: "2026-06" }],
    });
    expect(body.result.content[0]?.text).toContain("Monthly revenue");
  });

  it("monthly revenue MCP: resolve a TPEX ticker_venue query through the public research-only surface", async () => {
    const identity = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-01",
      retrievedAt: "2026-08-01T02:00:00.000Z",
      artifact: { contentHash: "sha256:mcp-tpex-revenue-identity", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company",
        ticker: "5274",
        legalName: "信驊科技股份有限公司",
        displayName: "信驊",
        unifiedBusinessNumber: "27490748",
        industryCode: "24",
        listedAt: "2013-04-30",
      },
    });
    await app.persistence.appendResearchIdentityRecords([identity]);
    for (const [index, revenueMonth] of ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07"].entries()) {
      const [year, month] = revenueMonth.split("-").map(Number);
      const rocYear = year - 1911;
      await app.persistence.appendResearchMonthlyRevenueRecords([canonicalizeOfficialMonthlyRevenueRow({
        venue: "TPEX",
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: "5274",
        companyName: "信驊",
        industryName: "24",
        revenueMonth,
        rawRevenueMonth: `${rocYear}${String(month).padStart(2, "0")}`,
        publishedAt: revenueMonth === "2026-07" ? "2026-08-11" : `${year}-${String((month % 12) + 1).padStart(2, "0")}-11`,
        rawPublishedAt: revenueMonth === "2026-07" ? "1150811" : `${rocYear}${String((month % 12) + 1).padStart(2, "0")}11`,
        retrievedAt: `2026-08-${String((index % 9) + 1).padStart(2, "0")}T02:00:00.000Z`,
        artifact: {
          contentHash: `sha256:mcp-tpex-${revenueMonth}`,
          sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O",
          publisherDataset: "mopsfin_t187ap05_O",
          accessProvider: "TPEX_OPENAPI",
        },
        source: {
          currentMonthRevenue: String(2000 + index * 10),
          priorMonthRevenue: String(1990 + index * 10),
          priorYearSameMonthRevenue: String(1800 + index * 10),
          monthOverMonthPercent: "1.01",
          yearOverYearPercent: "11.11",
          currentYearToDateRevenue: String(12000 + index * 100),
          priorYearToDateRevenue: String(10800 + index * 100),
          yearToDateYearOverYearPercent: "11.11",
          note: "個別自結數",
        },
      })]);
    }

    const initialize = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: "localhost:4000",
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "init-revenue-tpex",
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "Vitest", version: "1.0.0" },
        },
      },
    });
    expect(initialize.statusCode).toBe(200);
    const sessionId = String(initialize.headers["mcp-session-id"]);

    const response = await app.inject({
      method: "POST",
      url: "/mcp",
      headers: {
        host: "localhost:4000",
        authorization: `Bearer ${devToken({ userId: "user-1", scopes: ["research:read"] })}`,
        "mcp-session-id": sessionId,
        accept: "application/json, text/event-stream",
      },
      payload: {
        jsonrpc: "2.0",
        id: "call-monthly-revenue-tpex",
        method: "tools/call",
        params: {
          name: "get_monthly_revenue",
          arguments: {
            subject: { kind: "ticker_venue", ticker: "5274", listingVenue: "TPEX" },
            context: {
              knowledgeAt: "2026-08-28T00:00:00.000Z",
              effectiveAt: "2026-08-28T00:00:00.000Z",
              assessmentMode: "effective",
            },
            page: { limit: 1, order: "desc" },
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    const body = parseMcpJson<{
      result: {
        structuredContent: {
          result: {
            selector: { listingId: string };
            items: Array<{
              revenueMonth: string;
              publicationContext: { publishedAt: string; basis: string; qualifier: string };
            }>;
          };
        };
        isError?: boolean;
      };
    }>(response.body);
    expect(body.result.isError, response.body).not.toBe(true);
    expect(body.result.structuredContent.result).toMatchObject({
      selector: { listingId: identity.listing.id },
      items: [{
        revenueMonth: "2026-07",
        publicationContext: {
          publishedAt: "2026-08-11",
          basis: "individual",
          qualifier: "estimated",
        },
      }],
    });
  });
});
