import { Buffer } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "dev_bypass" as const,
      SESSION_SECRET: "research-financial-statements-test-secret",
    },
  };
});

import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  normalizeResearchFinancialStatementFact,
  type ResearchFinancialStatementRecord,
} from "../../src/services/research/financialStatements.js";

let app: Awaited<ReturnType<typeof import("../../src/app.js").buildApp>>;

function devToken(payload: Record<string, unknown>): string {
  return `vakwen-dev.${Buffer.from(JSON.stringify(payload)).toString("base64url")}`;
}

function parseMcpJson<T>(body: string): T {
  if (body.trim().startsWith("{")) return JSON.parse(body) as T;
  const dataLine = body.split("\n").find((line) => line.startsWith("data: "));
  if (!dataLine) throw new Error(`Missing MCP SSE data line: ${body}`);
  return JSON.parse(dataLine.slice("data: ".length)) as T;
}

function makeIdentity() {
  return canonicalizeOfficialIdentityRow({
    venue: "TWSE",
    snapshotDate: "2026-08-31",
    retrievedAt: "2026-08-31T02:00:00.000Z",
    artifact: { contentHash: "sha256:fs-mcp-identity", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
}

function fact(
  record: Omit<ResearchFinancialStatementRecord, "statements">,
  metricId: "revenue" | "gross_profit",
  rawValue: string,
  valueKind: "cumulative" | "discrete",
) {
  return normalizeResearchFinancialStatementFact({
    listingId: record.listingId,
    issuerId: record.issuerId,
    filingId: record.publicationContext.filingId,
    revisionId: record.publicationContext.revisionId,
    statementKind: "income",
    concept: metricId === "revenue"
      ? { qname: "ifrs-full:Revenue", label: "Revenue" }
      : { qname: "ifrs-full:GrossProfit", label: "Gross profit" },
    metric: { state: "mapped", metricId },
    contextId: `${record.publicationContext.revisionId}:${metricId}`,
    period: {
      kind: "duration",
      startAt: `${record.fiscalPeriod.periodStart}T00:00:00.000Z`,
      endAt: `${record.fiscalPeriod.periodEnd}T23:59:59.999Z`,
    },
    valueKind,
    rawValue,
    unit: { state: "known", unitId: "TWD" },
  });
}

function makeQuarterRecord(
  listingId: string,
  issuerId: string,
  fiscalQuarter: 1 | 2,
  values: { revenue: string; grossProfit: string },
): ResearchFinancialStatementRecord {
  const fiscalYear = 2026;
  const periodStart = fiscalQuarter === 1 ? "2026-01-01" : "2026-04-01";
  const periodEnd = fiscalQuarter === 1 ? "2026-03-31" : "2026-06-30";
  const record = {
    listingId,
    issuerId,
    ticker: "2330",
    venue: "TWSE",
    periodicity: "quarterly",
    fiscalPeriod: { fiscalYear, fiscalQuarter, periodStart, periodEnd },
    filingBasis: "consolidated",
    publicationContext: {
      filingId: `mops-2026-q${fiscalQuarter}`,
      revisionId: `mops-2026-q${fiscalQuarter}-r0`,
      publishedAt: fiscalQuarter === 1 ? "2026-05-15T10:00:00.000Z" : "2026-08-15T10:00:00.000Z",
      revisionPublishedAt: null,
      filingSequence: 1,
      revisionSequence: 0,
      processingId: `proc-q${fiscalQuarter}`,
      processingSequence: 1,
      restatement: false,
      amendment: false,
    },
    relations: [],
    ambiguityFlags: [],
    provenance: {
      id: `prv-q${fiscalQuarter}`,
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      authorityRole: "authoritative",
      canonicalDatasetId: "financial_statements",
      publisherDataset: "mops_xbrl",
      sourceUrl: "https://mops.twse.com.tw/mops/web/ajax_t164sb03",
      contentHash: `sha256:q${fiscalQuarter}`,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: `run-q${fiscalQuarter}`,
      retrievedAt: "2026-08-15T11:00:00.000Z",
      processedAt: "2026-08-15T11:05:00.000Z",
      parserVersion: "research-financial-statements-parser/1.0.0",
      taxonomyVersion: "ifrs-full-2026",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  } satisfies Omit<ResearchFinancialStatementRecord, "statements">;
  return {
    ...record,
    statements: [
      {
        kind: "income",
        facts: [
          fact(record, "revenue", values.revenue, "cumulative"),
          fact(record, "gross_profit", values.grossProfit, "cumulative"),
        ],
      },
      { kind: "balance_sheet", facts: [] },
      { kind: "cash_flow", facts: [] },
    ],
  };
}

describe("financial statements MCP tool", () => {
  beforeEach(async () => {
    setResearchRolloutOverrideForTest({
      acquisitionEnabled: true,
      mcpExposureEnabled: true,
      skillExposureEnabled: true,
    });
    const { buildApp } = await import("../../src/app.js");
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    setResearchRolloutOverrideForTest(null);
    await app.close();
  });

  it("returns wrapped read-only results, emits derived metrics only on the first page, and rejects cursor mutations", async () => {
    const identity = makeIdentity();
    await app.persistence.appendResearchIdentityRecords([identity]);
    await app.persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity.listing.id, identity.issuer.id, 1, { revenue: "28", grossProfit: "11.2" }),
      makeQuarterRecord(identity.listing.id, identity.issuer.id, 2, { revenue: "60", grossProfit: "24" }),
    ]);
    await app.persistence.saveAiConnectorPolicySettings({
      groupToggles: { research: true },
      bearerFallback: { allowedToolGroups: ["read", "research"] },
    });
    const appendIdentitySpy = vi.spyOn(app.persistence, "appendResearchIdentityRecords");
    const appendStatementsSpy = vi.spyOn(app.persistence, "appendResearchFinancialStatementRecords");

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
        id: "init-financial-statements",
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

    const first = await app.inject({
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
        id: "call-financial-statements-first",
        method: "tools/call",
        params: {
          name: "get_financial_statements",
          arguments: {
            subject: { kind: "listing_id", listingId: identity.listing.id },
            context: {
              knowledgeAt: "2026-09-01T00:00:00.000Z",
              effectiveAt: "2026-09-01T00:00:00.000Z",
              assessmentMode: "effective",
            },
            periodicity: "quarterly",
            range: { kind: "latest_periods", count: 2 },
            page: { limit: 1, order: "desc" },
            derivedMetrics: [{ metricId: "gross_margin", parameters: {} }],
          },
        },
      },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          result: {
            periods: Array<{ fiscalYear: number; fiscalQuarter: number | null }>;
            derivedOutcomes: Array<{ metricId: string; status: string; value?: string }>;
            page: { nextCursor: string | null };
          };
        };
      };
    }>(first.body);
    expect(firstBody.result.isError, first.body).not.toBe(true);
    expect(firstBody.result.structuredContent.result).toMatchObject({
      periods: [{ fiscalYear: 2026, fiscalQuarter: 2 }],
      derivedOutcomes: [{ metricId: "gross_margin", status: "returned", value: "0.4" }],
    });
    expect(firstBody.result.structuredContent.result.page.nextCursor).toBeTruthy();

    const second = await app.inject({
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
        id: "call-financial-statements-second",
        method: "tools/call",
        params: {
          name: "get_financial_statements",
          arguments: {
            subject: { kind: "listing_id", listingId: identity.listing.id },
            context: {
              knowledgeAt: "2026-09-01T00:00:00.000Z",
              effectiveAt: "2026-09-01T00:00:00.000Z",
              assessmentMode: "effective",
            },
            periodicity: "quarterly",
            range: { kind: "latest_periods", count: 2 },
            page: { limit: 1, order: "desc", cursor: firstBody.result.structuredContent.result.page.nextCursor },
            derivedMetrics: [{ metricId: "gross_margin", parameters: {} }],
          },
        },
      },
    });
    const secondBody = parseMcpJson<{
      result: {
        structuredContent: {
          result: { derivedOutcomes: unknown[] };
        };
      };
    }>(second.body);
    expect(second.statusCode).toBe(200);
    expect(secondBody.result.structuredContent.result.derivedOutcomes).toEqual([]);
    expect(appendIdentitySpy).not.toHaveBeenCalled();
    expect(appendStatementsSpy).not.toHaveBeenCalled();

    const invalid = await app.inject({
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
        id: "call-financial-statements-invalid",
        method: "tools/call",
        params: {
          name: "get_financial_statements",
          arguments: {
            subject: { kind: "listing_id", listingId: identity.listing.id },
            context: {
              knowledgeAt: "2026-09-01T00:00:00.000Z",
              effectiveAt: "2026-09-01T00:00:00.000Z",
              assessmentMode: "effective",
            },
            periodicity: "quarterly",
            range: { kind: "latest_periods", count: 2 },
            page: { limit: 2, order: "desc", cursor: firstBody.result.structuredContent.result.page.nextCursor },
            derivedMetrics: [{ metricId: "gross_margin", parameters: {} }],
          },
        },
      },
    });
    const invalidBody = parseMcpJson<{
      result: {
        isError?: boolean;
        structuredContent: {
          result: { code: string; statusCode: number };
        };
      };
    }>(invalid.body);
    expect(invalid.statusCode).toBe(200);
    expect(invalidBody.result.isError).toBe(true);
    expect(invalidBody.result.structuredContent.result).toMatchObject({
      code: "research_cursor_invalid",
      statusCode: 422,
    });
  });
});
