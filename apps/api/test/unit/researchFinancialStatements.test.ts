import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  applyResearchFinancialStatementTransform,
  materializeResearchFinancialStatementRecord,
  normalizeResearchFinancialStatementFact,
  researchFinancialStatementProcessingId,
  researchFinancialStatementProcessingSequence,
  resolveLatestResearchFinancialStatementRecords,
  type ResearchFinancialStatementRecord,
  validateResearchFinancialStatementRecord,
} from "../../src/services/research/financialStatements.js";
import type { MopsFinancialStatementArtifact } from "../../src/services/research/providers/mopsXbrl.js";

function makeRawArtifact(facts: MopsFinancialStatementArtifact["facts"]): MopsFinancialStatementArtifact {
  return {
    listingId: "lst_2330",
    issuerId: "iss_2330",
    ticker: "2330",
    venue: "TWSE",
    sector: "operating_company",
    filing: {
      filingId: "mops-2026q2-raw",
      fiscalYear: 2026,
      fiscalPeriod: "q2",
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
      filingBasis: "consolidated",
      publishedAt: "2026-08-14",
      revision: 0,
      amendmentType: "original",
    },
    artifact: {
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      sourceUrl: "https://mops.twse.com.tw/server-java/t164sb01",
      contentHash: "sha256:raw-artifact",
      retrievedAt: "2026-08-14T11:00:00.000Z",
      acquisitionRunId: "run-raw-artifact",
      artifactKind: "ixbrl",
      taxonomyVersions: ["2026"],
      primaryNamespace: "https://xbrl.ifrs.org/taxonomy/2026",
    },
    contexts: [],
    units: [{ id: "twd", measures: ["iso4217:TWD"], numeratorMeasures: [], denominatorMeasures: [] }],
    facts,
    issues: {
      duplicateContextGroups: [],
      unknownUnitIds: [],
      unmappedConcepts: [],
      basisAmbiguity: false,
      taxonomyAmbiguity: false,
      contextAmbiguity: false,
      missingStatementRoles: [],
    },
  };
}

function makeRawRevenueFact(): MopsFinancialStatementArtifact["facts"][number] {
  return {
    id: "raw-revenue",
    inlineType: null,
    statementRole: "income_statement",
    concept: {
      qname: "ifrs-full:Revenue",
      prefix: "ifrs-full",
      localName: "Revenue",
      namespaceUri: "https://xbrl.ifrs.org/taxonomy/2026",
    },
    contextRef: "duration",
    unitRef: "twd",
    decimals: "0",
    scale: null,
    sign: null,
    format: null,
    rawValue: "1234",
    normalizedValue: "1234",
    periodEnd: "2026-06-30",
    periodStart: "2026-04-01",
    contextDimensions: [],
  };
}

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
  it("processing identity changes with the canonical parser version", () => {
    expect(researchFinancialStatementProcessingId("sha256:same", "research-financial-statements-parser/1.0.1"))
      .not.toBe(researchFinancialStatementProcessingId("sha256:same", "research-financial-statements-parser/1.0.2"));
    expect(researchFinancialStatementProcessingSequence("research-financial-statements-parser/1.0.2"))
      .toBeGreaterThan(researchFinancialStatementProcessingSequence("research-financial-statements-parser/1.0.1"));
  });

  it("iXBRL transforms preserve decimal precision while applying scale and sign", () => {
    expect(applyResearchFinancialStatementTransform("1,234", "3", null)).toBe("1234000");
    expect(applyResearchFinancialStatementTransform("0.001", "3", null)).toBe("1");
    expect(applyResearchFinancialStatementTransform("1.23", "-1", "-")).toBe("-0.123");
    expect(applyResearchFinancialStatementTransform("-25", null, "-")).toBe("-25");
  });

  it("iXBRL transforms reject scales that would allocate an oversized decimal string", () => {
    expect(() => applyResearchFinancialStatementTransform("1", "1000000", null)).toThrow(RangeError);
    expect(() => applyResearchFinancialStatementTransform("1", "-1000000", null)).toThrow(RangeError);
  });

  it("iXBRL format metadata preserves transformed values through record validation", () => {
    const record = makeRecord();
    const transformedFact = normalizeResearchFinancialStatementFact({
      listingId: record.listingId,
      issuerId: record.issuerId,
      filingId: record.publicationContext.filingId,
      revisionId: record.publicationContext.revisionId,
      statementKind: "income",
      concept: { qname: "ifrs-full:BasicEarningsLossPerShare", label: "Basic earnings per share" },
      metric: { state: "unmapped", reason: "no_core_metric_mapping" },
      contextId: "ctx-formatted",
      period: {
        kind: "duration",
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-06-30T23:59:59.999Z",
      },
      valueKind: "cumulative",
      rawValue: "1.234,5",
      normalizedValue: "1234.5",
      unit: { state: "known", unitId: "TWD" },
      declaredFormat: "ixt:num-comma-decimal",
    });
    record.statements[0]!.facts.push(transformedFact);

    expect(() => validateResearchFinancialStatementRecord(record)).not.toThrow();
    expect(transformedFact.declaredFormat).toBe("ixt:num-comma-decimal");
  });

  it("raw artifact materialization: retains value-changing iXBRL format metadata", () => {
    const formatted = {
      ...makeRawRevenueFact(),
      format: "ixt:num-comma-decimal",
      rawValue: "1.234,5",
      normalizedValue: "1234.5",
    };

    const record = materializeResearchFinancialStatementRecord(makeRawArtifact([formatted]));

    expect(record.statements[0]?.facts[0]).toMatchObject({
      raw: { state: "present", value: "1.234,5" },
      normalized: { state: "present", value: "1234.5" },
      declaredFormat: "ixt:num-comma-decimal",
    });
  });

  it("raw artifact materialization: deduplicates repeated identical facts", () => {
    const repeated = makeRawRevenueFact();

    const record = materializeResearchFinancialStatementRecord(makeRawArtifact([repeated, { ...repeated }]));

    expect(record.statements[0]?.facts).toHaveLength(1);
  });

  it("raw amendment materialization: preserves original and revision publication timestamps", () => {
    const artifact = makeRawArtifact([makeRawRevenueFact()]);
    artifact.filing = {
      ...artifact.filing,
      revision: 1,
      amendmentType: "amendment",
      publishedAt: "2026-08-14T10:00:00.000Z",
    };
    artifact.artifact = {
      ...artifact.artifact,
      retrievedAt: "2026-08-20T11:00:00.000Z",
    };

    expect(materializeResearchFinancialStatementRecord(artifact).publicationContext).toMatchObject({
      publishedAt: "2026-08-14T10:00:00.000Z",
      revisionPublishedAt: "2026-08-20T11:00:00.000Z",
      revisionSequence: 1,
      amendment: true,
    });
  });

  it("raw artifact materialization: preserves artifact-wide unit and mapping flags", () => {
    const artifact = makeRawArtifact([makeRawRevenueFact()]);
    artifact.issues = {
      ...artifact.issues,
      unknownUnitIds: ["mystery_unit"],
      unmappedConcepts: ["custom:UnmappedDisclosure"],
    };

    expect(materializeResearchFinancialStatementRecord(artifact).ambiguityFlags).toEqual([
      "unknown_unit",
      "unmapped_concept",
    ]);
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

  it("fact identity distinguishes lexical QNames rebound to different taxonomy namespaces", () => {
    const baseInput = {
      listingId: "lst_2330",
      issuerId: "iss_2330",
      filingId: "mops-2026q2",
      revisionId: "mops-2026q2-r0",
      statementKind: "income" as const,
      concept: { qname: "ifrs:Revenue", label: "Revenue" },
      metric: { state: "mapped" as const, metricId: "revenue" as const },
      contextId: "ctx-duration",
      period: {
        kind: "duration" as const,
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-06-30T23:59:59.999Z",
      },
      valueKind: "cumulative" as const,
      rawValue: "1",
      unit: { state: "known" as const, unitId: "TWD" },
    };
    const first = normalizeResearchFinancialStatementFact({
      ...baseInput,
      taxonomy: { namespaceUri: "https://example.test/taxonomy/2025/ifrs", version: "2025" },
    });
    const second = normalizeResearchFinancialStatementFact({
      ...baseInput,
      taxonomy: { namespaceUri: "https://example.test/taxonomy/2026/ifrs", version: "2026" },
    });

    expect(first.id).not.toBe(second.id);
  });

  it("fact identity distinguishes otherwise identical displays with different numeric transformations", () => {
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
      unit: { state: "known" as const, unitId: "TWD" },
    };
    const unscaled = normalizeResearchFinancialStatementFact({
      ...baseInput,
      normalizedValue: "1",
      declaredScale: "0",
    });
    const scaled = normalizeResearchFinancialStatementFact({
      ...baseInput,
      normalizedValue: "1000",
      declaredScale: "3",
    });

    expect(unscaled.id).not.toBe(scaled.id);
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

  it("successive parser processing revisions do not create source-context ambiguity", () => {
    const processedFirst = makeRecord();
    const reprocessed = makeRecord({
      publicationContext: {
        ...processedFirst.publicationContext,
        processingId: "proc-parser-v2",
        processingSequence: processedFirst.publicationContext.processingSequence + 1,
      },
      provenance: {
        ...processedFirst.provenance,
        id: "prv_fin_stmt_2330_q2_parser_v2",
        retrievedAt: "2026-08-18T00:00:00.000Z",
        processedAt: "2026-08-18T00:05:00.000Z",
        parserVersion: "research-financial-statements-parser/1.0.1",
      },
    });

    const [latest] = resolveLatestResearchFinancialStatementRecords([processedFirst, reprocessed]);

    expect(latest?.publicationContext.processingId).toBe("proc-parser-v2");
    expect(latest?.ambiguityFlags).not.toContain("duplicate_context");
  });

  it("canonical timestamps require an explicit UTC designator or numeric offset", () => {
    const offsetless = "2026-08-14T11:00:00";
    const base = makeRecord();
    expect(() => validateResearchFinancialStatementRecord({
      ...base,
      publicationContext: { ...base.publicationContext, publishedAt: offsetless },
    })).toThrow(/ISO datetime/);
    expect(() => validateResearchFinancialStatementRecord({
      ...base,
      publicationContext: { ...base.publicationContext, revisionPublishedAt: offsetless },
    })).toThrow(/ISO datetime/);
    expect(() => validateResearchFinancialStatementRecord({
      ...base,
      provenance: { ...base.provenance, retrievedAt: offsetless },
    })).toThrow(/ISO datetime/);
    expect(() => validateResearchFinancialStatementRecord({
      ...base,
      provenance: { ...base.provenance, processedAt: offsetless },
    })).toThrow(/ISO datetime/);
  });
});
