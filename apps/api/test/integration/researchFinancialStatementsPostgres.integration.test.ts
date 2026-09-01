import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  normalizeResearchFinancialStatementFact,
  type ResearchFinancialStatementRecord,
} from "../../src/services/research/financialStatements.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}

const describePostgres = runPostgresIntegration && databaseUrl && redisUrl ? describe : describe.skip;

function makeRecord(overrides: Partial<ResearchFinancialStatementRecord> = {}): ResearchFinancialStatementRecord {
  const filingId = overrides.publicationContext?.filingId ?? "mops-2026q2";
  const revisionId = overrides.publicationContext?.revisionId ?? "mops-2026q2-r0";
  const processingId = overrides.publicationContext?.processingId ?? "proc-1";
  const listingId = overrides.listingId ?? "lst_2330";
  const issuerId = overrides.issuerId ?? "iss_2330";
  return {
    listingId,
    issuerId,
    ticker: overrides.ticker ?? "2330",
    venue: overrides.venue ?? "TWSE",
    periodicity: overrides.periodicity ?? "quarterly",
    fiscalPeriod: overrides.fiscalPeriod ?? {
      fiscalYear: 2026,
      fiscalQuarter: 2,
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
    },
    filingBasis: overrides.filingBasis ?? "consolidated",
    publicationContext: overrides.publicationContext ?? {
      filingId,
      revisionId,
      publishedAt: "2026-08-14T10:00:00.000Z",
      revisionPublishedAt: null,
      filingSequence: 1,
      revisionSequence: 0,
      processingId,
      processingSequence: 1,
      restatement: false,
      amendment: false,
    },
    statements: overrides.statements ?? [
      {
        kind: "income",
        facts: [
          normalizeResearchFinancialStatementFact({
            listingId,
            issuerId,
            filingId,
            revisionId,
            statementKind: "income",
            concept: { qname: "ifrs-full:Revenue", label: "Revenue" },
            metric: { state: "mapped", metricId: "revenue" },
            contextId: "ctx-income",
            period: {
              kind: "duration",
              startAt: "2026-04-01T00:00:00.000Z",
              endAt: "2026-06-30T23:59:59.999Z",
            },
            valueKind: "cumulative",
            rawValue: "1,234",
            unit: { state: "known", unitId: "TWD" },
          }),
        ],
      },
      {
        kind: "balance_sheet",
        facts: [
          normalizeResearchFinancialStatementFact({
            listingId,
            issuerId,
            filingId,
            revisionId,
            statementKind: "balance_sheet",
            concept: { qname: "ifrs-full:Assets", label: "Assets" },
            metric: { state: "mapped", metricId: "assets" },
            contextId: "ctx-assets",
            period: { kind: "instant", instantAt: "2026-06-30T23:59:59.999Z" },
            valueKind: "instant",
            rawValue: "9,999",
            unit: { state: "known", unitId: "TWD" },
          }),
        ],
      },
      {
        kind: "cash_flow",
        facts: [
          normalizeResearchFinancialStatementFact({
            listingId,
            issuerId,
            filingId,
            revisionId,
            statementKind: "cash_flow",
            concept: { qname: "ifrs-full:NetCashFlowsFromUsedInOperatingActivities", label: "Operating cash flow" },
            metric: { state: "mapped", metricId: "operating_cash_flow" },
            contextId: "ctx-cash",
            period: {
              kind: "duration",
              startAt: "2026-04-01T00:00:00.000Z",
              endAt: "2026-06-30T23:59:59.999Z",
            },
            valueKind: "cumulative",
            rawValue: "456",
            unit: { state: "known", unitId: "TWD" },
          }),
        ],
      },
    ],
    relations: overrides.relations ?? [],
    ambiguityFlags: overrides.ambiguityFlags ?? [],
    provenance: overrides.provenance ?? {
      id: `prv_${revisionId}_${processingId}`,
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      authorityRole: "authoritative",
      canonicalDatasetId: "financial_statements",
      publisherDataset: "mops_xbrl_ifrs",
      sourceUrl: "https://mops.twse.com.tw/mops/web/ajax_t164sb03",
      contentHash: `sha256:${revisionId}:${processingId}`,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: "run-financial-statements",
      retrievedAt: "2026-08-14T11:00:00.000Z",
      processedAt: "2026-08-14T11:05:00.000Z",
      parserVersion: "research-financial-statements-parser/1.0.0",
      taxonomyVersion: "ifrs-full-2026",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  };
}

describePostgres("research financial statements memory/Postgres parity", () => {
  let pool: Pool;
  let postgres: PostgresPersistence;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA IF EXISTS research CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
    postgres = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await postgres.init();
  });

  afterEach(async () => {
    await postgres.close();
    await pool.end();
  });

  it("keeps immutable replay rows and selects latest periods by explicit filing revision precedence", async () => {
    const memory = new MemoryPersistence();
    const original = makeRecord();
    const amendment = makeRecord({
      publicationContext: {
        ...original.publicationContext,
        revisionId: "mops-2026q2-r1",
        revisionPublishedAt: "2026-08-16T09:00:00.000Z",
        revisionSequence: 1,
        processingId: "proc-2",
        processingSequence: 1,
        amendment: true,
      },
      provenance: {
        ...original.provenance,
        id: "prv_mops-2026q2-r1_proc-2",
        contentHash: "sha256:amended",
        retrievedAt: "2026-08-15T01:00:00.000Z",
        processedAt: "2026-08-15T01:05:00.000Z",
      },
      relations: [
        { kind: "supersedes", targetRecordKey: "iss_2330:lst_2330:2026-Q2:consolidated:mops-2026q2:mops-2026q2-r0:proc-1" },
      ],
    });
    const reprocessed = makeRecord({
      publicationContext: {
        ...original.publicationContext,
        processingId: "proc-3",
        processingSequence: 2,
      },
      provenance: {
        ...original.provenance,
        id: "prv_mops-2026q2-r0_proc-3",
        contentHash: "sha256:reprocessed",
        retrievedAt: "2026-08-18T01:00:00.000Z",
        processedAt: "2026-08-18T01:05:00.000Z",
      },
    });
    const annual = makeRecord({
      periodicity: "annual",
      fiscalPeriod: {
        fiscalYear: 2025,
        fiscalQuarter: null,
        periodStart: "2025-01-01",
        periodEnd: "2025-12-31",
      },
      publicationContext: {
        ...original.publicationContext,
        filingId: "mops-2025-annual",
        revisionId: "mops-2025-annual-r0",
        publishedAt: "2026-03-31T10:00:00.000Z",
        processingId: "proc-annual-1",
      },
      provenance: {
        ...original.provenance,
        id: "prv_annual",
        contentHash: "sha256:annual",
        retrievedAt: "2026-03-31T11:00:00.000Z",
        processedAt: "2026-03-31T11:05:00.000Z",
      },
    });

    await memory.appendResearchFinancialStatementRecords([original, amendment, reprocessed, annual]);
    await postgres.appendResearchFinancialStatementRecords([original, amendment, reprocessed, annual]);

    const quarterlyQuery = {
      subject: { kind: "listing_id" as const, listingId: original.listingId },
      effectiveAt: "2026-08-20T00:00:00.000Z",
      knowledgeAt: "2026-08-20T00:00:00.000Z",
      periodicity: "quarterly" as const,
      startPeriod: "2026-Q2",
      endPeriod: "2026-Q2",
      filingBasis: "consolidated" as const,
    };
    expect(await postgres.listResearchFinancialStatementRecords(quarterlyQuery)).toEqual(
      await memory.listResearchFinancialStatementRecords(quarterlyQuery),
    );
    expect(await postgres.listLatestResearchFinancialStatementRecords(quarterlyQuery)).toEqual(
      await memory.listLatestResearchFinancialStatementRecords(quarterlyQuery),
    );
    const [latestQuarterly] = await postgres.listLatestResearchFinancialStatementRecords(quarterlyQuery);
    expect(latestQuarterly?.publicationContext.revisionId).toBe("mops-2026q2-r1");

    const issuerAnnualQuery = {
      subject: { kind: "issuer_id" as const, issuerId: annual.issuerId },
      effectiveAt: "2026-08-20T00:00:00.000Z",
      knowledgeAt: "2026-08-20T00:00:00.000Z",
      periodicity: "annual" as const,
      startPeriod: "2025",
      endPeriod: "2025",
    };
    expect(await postgres.listLatestResearchFinancialStatementRecords(issuerAnnualQuery)).toEqual(
      await memory.listLatestResearchFinancialStatementRecords(issuerAnnualQuery),
    );

    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM research.financial_statement_records WHERE listing_id = $1",
      [original.listingId],
    );
    expect(count.rows[0]?.count).toBe("4");

    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'research'
          AND indexname = ANY($1::text[])
        ORDER BY indexname`,
      [[
        "research_financial_statement_records_issuer_latest_idx",
        "research_financial_statement_records_issuer_temporal_idx",
        "research_financial_statement_records_listing_latest_idx",
        "research_financial_statement_records_listing_temporal_idx",
      ]],
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "research_financial_statement_records_issuer_latest_idx",
      "research_financial_statement_records_issuer_temporal_idx",
      "research_financial_statement_records_listing_latest_idx",
      "research_financial_statement_records_listing_temporal_idx",
    ]);
  });
});
