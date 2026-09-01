import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  applyResearchFinancialStatementTransform,
  normalizeResearchFinancialStatementFact,
  resolveLatestResearchFinancialStatementRecords,
  type ResearchFinancialStatementRecord,
} from "../../src/services/research/financialStatements.js";

function makeRecord(overrides: Partial<ResearchFinancialStatementRecord> = {}): ResearchFinancialStatementRecord {
  const filingId = overrides.publicationContext?.filingId ?? "mops-2026q2";
  const revisionId = overrides.publicationContext?.revisionId ?? "mops-2026q2-r0";
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
      processingId: "proc-1",
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
            contextId: "ctx-duration",
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
            contextId: "ctx-instant",
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
            contextId: "ctx-cf",
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
      id: "prv_fin_stmt_2330_q2",
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      authorityRole: "authoritative",
      canonicalDatasetId: "financial_statements",
      publisherDataset: "mops_xbrl_ifrs",
      sourceUrl: "https://mops.twse.com.tw/mops/web/ajax_t164sb03",
      contentHash: "sha256:fin-stmt-q2",
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: "run-fin-stmt-q2",
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

describe("research financial statements", () => {
  it("iXBRL transforms preserve decimal precision while applying scale and sign", () => {
    expect(applyResearchFinancialStatementTransform("1,234", "3", null)).toBe("1234000");
    expect(applyResearchFinancialStatementTransform("0.001", "3", null)).toBe("1");
    expect(applyResearchFinancialStatementTransform("1.23", "-1", "-")).toBe("-0.123");
    expect(applyResearchFinancialStatementTransform("-25", null, "-")).toBe("-25");
  });

  it("blank sentinels stay missing while explicit zero remains numeric zero", () => {
    const missing = normalizeResearchFinancialStatementFact({
      listingId: "lst_2330",
      issuerId: "iss_2330",
      filingId: "mops-2026q2",
      revisionId: "mops-2026q2-r0",
      statementKind: "income",
      concept: { qname: "ifrs-full:GrossProfit", label: "Gross profit" },
      metric: { state: "mapped", metricId: "gross_profit" },
      contextId: "ctx-missing",
      period: {
        kind: "duration",
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-06-30T23:59:59.999Z",
      },
      valueKind: "cumulative",
      rawValue: "-",
      unit: { state: "known", unitId: "TWD" },
    });
    const zero = normalizeResearchFinancialStatementFact({
      listingId: "lst_2330",
      issuerId: "iss_2330",
      filingId: "mops-2026q2",
      revisionId: "mops-2026q2-r0",
      statementKind: "income",
      concept: { qname: "ifrs-full:OperatingIncomeLoss", label: "Operating income" },
      metric: { state: "mapped", metricId: "operating_income" },
      contextId: "ctx-zero",
      period: {
        kind: "duration",
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-06-30T23:59:59.999Z",
      },
      valueKind: "cumulative",
      rawValue: "0",
      unit: { state: "known", unitId: "TWD" },
    });

    expect(missing.raw).toEqual({ state: "present", value: "-" });
    expect(missing.normalized).toEqual({ state: "missing", reason: "not_reported" });
    expect(zero.normalized).toEqual({ state: "present", value: "0" });
  });

  it("fact identity distinguishes otherwise identical observations reported in different units", () => {
    const baseInput = {
      listingId: "lst_2330",
      issuerId: "iss_2330",
      filingId: "mops-2026q2",
      revisionId: "mops-2026q2-r0",
      statementKind: "income" as const,
      concept: { qname: "ifrs-full:Revenue", label: "Revenue" },
      metric: { state: "mapped" as const, metricId: "revenue" as const },
      contextId: "ctx-duration",
      period: {
        kind: "duration" as const,
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-06-30T23:59:59.999Z",
      },
      valueKind: "cumulative" as const,
      rawValue: "1",
    };
    const twd = normalizeResearchFinancialStatementFact({
      ...baseInput,
      unit: { state: "known", unitId: "TWD" },
    });
    const usd = normalizeResearchFinancialStatementFact({
      ...baseInput,
      unit: { state: "known", unitId: "USD" },
    });

    expect(twd.id).not.toBe(usd.id);
  });

  it("latest revision selection follows explicit publication and revision sequence instead of retrieval order", () => {
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
        id: "prv_fin_stmt_2330_q2_amended",
        contentHash: "sha256:fin-stmt-q2-amended",
        retrievedAt: "2026-08-15T01:00:00.000Z",
        processedAt: "2026-08-15T01:05:00.000Z",
      },
      relations: [{ kind: "supersedes", targetRecordKey: "iss_2330:lst_2330:2026-Q2:consolidated:mops-2026q2:mops-2026q2-r0:proc-1" }],
    });

    expect(resolveLatestResearchFinancialStatementRecords([original, amendment])).toEqual([amendment]);
  });

  it("effective-time reads do not expose revisions before their own publication", async () => {
    const persistence = new MemoryPersistence();
    const original = makeRecord();
    const amendment = makeRecord({
      publicationContext: {
        ...original.publicationContext,
        revisionId: "mops-2026q2-r1",
        revisionPublishedAt: "2026-08-16T09:00:00.000Z",
        revisionSequence: 1,
        processingId: "proc-2",
        amendment: true,
      },
      provenance: {
        ...original.provenance,
        id: "prv_fin_stmt_2330_q2_amended",
        contentHash: "sha256:fin-stmt-q2-amended",
        retrievedAt: "2026-08-17T01:00:00.000Z",
        processedAt: "2026-08-17T01:05:00.000Z",
      },
    });
    await persistence.appendResearchFinancialStatementRecords([original, amendment]);

    const [latest] = await persistence.listLatestResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: original.listingId },
      effectiveAt: "2026-08-15T00:00:00.000Z",
      knowledgeAt: "2026-08-20T00:00:00.000Z",
      periodicity: "quarterly",
    });

    expect(latest?.publicationContext.revisionId).toBe(original.publicationContext.revisionId);
  });

  it("validation requires core statements but still preserves sector-extension and unmapped metadata", async () => {
    const persistence = new MemoryPersistence();
    const record = makeRecord({
      statements: [
        ...makeRecord().statements,
        {
          kind: "sector_extension",
          metadata: { disclosureRole: "banking_capital_adequacy" },
          facts: [
            normalizeResearchFinancialStatementFact({
              listingId: "lst_2330",
              issuerId: "iss_2330",
              filingId: "mops-2026q2",
              revisionId: "mops-2026q2-r0",
              statementKind: "sector_extension",
              concept: { qname: "tw-gaap-ci:BankCapitalAdequacyRatio", label: "Capital adequacy ratio" },
              metric: { state: "unmapped", reason: "no_core_metric_mapping" },
              contextId: "ctx-sector",
              period: { kind: "instant", instantAt: "2026-06-30T23:59:59.999Z" },
              valueKind: "instant",
              rawValue: "13.4",
              unit: { state: "unknown", rawUnitId: "pure" },
            }),
          ],
        },
      ],
      ambiguityFlags: ["taxonomy_change"],
    });

    await persistence.appendResearchFinancialStatementRecords([record]);
    const [stored] = await persistence.listLatestResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId: record.listingId },
      effectiveAt: "2026-08-20T00:00:00.000Z",
      knowledgeAt: "2026-08-20T00:00:00.000Z",
      periodicity: "quarterly",
    });

    expect(stored?.statements.find((section) => section.kind === "sector_extension")).toMatchObject({
      metadata: { disclosureRole: "banking_capital_adequacy" },
      facts: [
        {
          concept: { qname: "tw-gaap-ci:BankCapitalAdequacyRatio", label: "Capital adequacy ratio" },
          metric: { state: "unmapped", reason: "no_core_metric_mapping" },
          ambiguityFlags: ["unknown_unit", "unmapped_concept"],
        },
      ],
    });
  });

  it("equal explicit precedence keeps replay immutable and marks the survivor as ambiguous", () => {
    const processedFirst = makeRecord();
    const reprocessed = makeRecord({
      publicationContext: {
        ...processedFirst.publicationContext,
        processingId: "proc-2",
        processingSequence: 2,
      },
      provenance: {
        ...processedFirst.provenance,
        id: "prv_fin_stmt_2330_q2_reprocessed",
        contentHash: "sha256:fin-stmt-q2-reprocessed",
        retrievedAt: "2026-08-18T00:00:00.000Z",
        processedAt: "2026-08-18T00:05:00.000Z",
      },
    });
    const [latest] = resolveLatestResearchFinancialStatementRecords([processedFirst, reprocessed]);

    expect(latest?.publicationContext.processingId).toBe("proc-2");
    expect(latest?.ambiguityFlags).toContain("duplicate_context");
  });
});
