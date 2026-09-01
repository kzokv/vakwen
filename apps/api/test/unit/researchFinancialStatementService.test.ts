import { describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  normalizeResearchFinancialStatementFact,
  researchFinancialStatementPeriodKey,
  type ResearchFinancialStatementMetricId,
  type ResearchFinancialStatementRecord,
} from "../../src/services/research/financialStatements.js";
import { getFinancialStatements, getResearchManifest, ResearchServiceError } from "../../src/services/research/service.js";

type Identity = ReturnType<typeof makeIdentity>;

type StatementKind = "income" | "balance_sheet" | "cash_flow";

const metricDefinitions: Record<ResearchFinancialStatementMetricId, {
  statementKind: StatementKind;
  qname: string;
  label: string;
  period: "duration" | "instant";
  defaultValueKind: "cumulative" | "discrete" | "instant";
}> = {
  revenue: { statementKind: "income", qname: "ifrs-full:Revenue", label: "Revenue", period: "duration", defaultValueKind: "cumulative" },
  gross_profit: { statementKind: "income", qname: "ifrs-full:GrossProfit", label: "Gross profit", period: "duration", defaultValueKind: "cumulative" },
  operating_income: { statementKind: "income", qname: "ifrs-full:OperatingIncomeLoss", label: "Operating income", period: "duration", defaultValueKind: "cumulative" },
  net_income: { statementKind: "income", qname: "ifrs-full:ProfitLoss", label: "Net income", period: "duration", defaultValueKind: "cumulative" },
  assets: { statementKind: "balance_sheet", qname: "ifrs-full:Assets", label: "Assets", period: "instant", defaultValueKind: "instant" },
  liabilities: { statementKind: "balance_sheet", qname: "ifrs-full:Liabilities", label: "Liabilities", period: "instant", defaultValueKind: "instant" },
  equity: { statementKind: "balance_sheet", qname: "ifrs-full:Equity", label: "Equity", period: "instant", defaultValueKind: "instant" },
  current_assets: { statementKind: "balance_sheet", qname: "ifrs-full:CurrentAssets", label: "Current assets", period: "instant", defaultValueKind: "instant" },
  current_liabilities: { statementKind: "balance_sheet", qname: "ifrs-full:CurrentLiabilities", label: "Current liabilities", period: "instant", defaultValueKind: "instant" },
  cash_and_cash_equivalents: { statementKind: "balance_sheet", qname: "ifrs-full:CashAndCashEquivalents", label: "Cash and cash equivalents", period: "instant", defaultValueKind: "instant" },
  interest_bearing_debt: { statementKind: "balance_sheet", qname: "ifrs-full:InterestBearingBorrowings", label: "Interest-bearing debt", period: "instant", defaultValueKind: "instant" },
  operating_cash_flow: { statementKind: "cash_flow", qname: "ifrs-full:NetCashFlowsFromUsedInOperatingActivities", label: "Operating cash flow", period: "duration", defaultValueKind: "cumulative" },
  investing_cash_flow: { statementKind: "cash_flow", qname: "ifrs-full:NetCashFlowsFromUsedInInvestingActivities", label: "Investing cash flow", period: "duration", defaultValueKind: "cumulative" },
  capital_expenditure: { statementKind: "cash_flow", qname: "ifrs-full:PurchaseOfPropertyPlantAndEquipment", label: "Capex", period: "duration", defaultValueKind: "cumulative" },
};

function makeIdentity() {
  return canonicalizeOfficialIdentityRow({
    venue: "TWSE",
    snapshotDate: "2026-08-31",
    retrievedAt: "2026-08-31T02:00:00.000Z",
    artifact: { contentHash: "sha256:fs-service-identity", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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

function makeRecord(overrides: Partial<ResearchFinancialStatementRecord> = {}): ResearchFinancialStatementRecord {
  const filingId = overrides.publicationContext?.filingId ?? "mops-2026q2";
  const revisionId = overrides.publicationContext?.revisionId ?? "mops-2026q2:r0";
  const listingId = overrides.listingId ?? "lst_2330";
  const issuerId = overrides.issuerId ?? "iss_2330";
  return {
    listingId,
    issuerId,
    ticker: "2330",
    venue: "TWSE",
    periodicity: "quarterly",
    fiscalPeriod: {
      fiscalYear: 2026,
      fiscalQuarter: 2,
      periodStart: "2026-04-01",
      periodEnd: "2026-06-30",
    },
    filingBasis: "consolidated",
    publicationContext: {
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
      ...overrides.publicationContext,
    },
    statements: [
      { kind: "income", facts: [] },
      { kind: "balance_sheet", facts: [] },
      { kind: "cash_flow", facts: [] },
    ],
    relations: [],
    ambiguityFlags: [],
    provenance: {
      id: `prv-${filingId}`,
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      authorityRole: "authoritative",
      canonicalDatasetId: "financial_statements",
      publisherDataset: "mops_xbrl",
      sourceUrl: "https://mops.twse.com.tw/mops/web/ajax_t164sb03",
      contentHash: `sha256:${filingId}`,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: `run-${filingId}`,
      retrievedAt: "2026-08-14T11:00:00.000Z",
      processedAt: "2026-08-14T11:05:00.000Z",
      parserVersion: "research-financial-statements-parser/1.0.0",
      taxonomyVersion: "ifrs-full-2026",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
    ...overrides,
  };
}

function quarterBounds(fiscalYear: number, fiscalQuarter: 1 | 2 | 3 | 4) {
  if (fiscalQuarter === 1) return { periodStart: `${fiscalYear}-01-01`, periodEnd: `${fiscalYear}-03-31` };
  if (fiscalQuarter === 2) return { periodStart: `${fiscalYear}-04-01`, periodEnd: `${fiscalYear}-06-30` };
  if (fiscalQuarter === 3) return { periodStart: `${fiscalYear}-07-01`, periodEnd: `${fiscalYear}-09-30` };
  return { periodStart: `${fiscalYear}-10-01`, periodEnd: `${fiscalYear}-12-31` };
}

function metricFact(
  record: ResearchFinancialStatementRecord,
  metricId: ResearchFinancialStatementMetricId,
  rawValue: string,
  overrides?: {
    valueKind?: "cumulative" | "discrete" | "instant";
    unitId?: string;
    taxonomyVersion?: string;
  },
) {
  const definition = metricDefinitions[metricId];
  return normalizeResearchFinancialStatementFact({
    listingId: record.listingId,
    issuerId: record.issuerId,
    filingId: record.publicationContext.filingId,
    revisionId: record.publicationContext.revisionId,
    statementKind: definition.statementKind,
    concept: { qname: definition.qname, label: definition.label },
    ...(overrides?.taxonomyVersion ? {
      taxonomy: { namespaceUri: "https://xbrl.ifrs.org/taxonomy", version: overrides.taxonomyVersion },
    } : {}),
    metric: { state: "mapped", metricId },
    contextId: `${researchFinancialStatementPeriodKey(record)}:${metricId}`,
    period: definition.period === "instant"
      ? { kind: "instant", instantAt: `${record.fiscalPeriod.periodEnd}T23:59:59.999Z` }
      : {
          kind: "duration",
          startAt: `${record.fiscalPeriod.periodStart}T00:00:00.000Z`,
          endAt: `${record.fiscalPeriod.periodEnd}T23:59:59.999Z`,
        },
    valueKind: overrides?.valueKind ?? definition.defaultValueKind,
    rawValue,
    unit: { state: "known", unitId: overrides?.unitId ?? "TWD" },
  });
}

function assembleStatements(
  record: ResearchFinancialStatementRecord,
  values: Partial<Record<ResearchFinancialStatementMetricId, string>>,
  overrides: Partial<Record<ResearchFinancialStatementMetricId, {
    valueKind?: "cumulative" | "discrete" | "instant";
    unitId?: string;
    taxonomyVersion?: string;
  }>> = {},
) {
  const statements: Record<StatementKind, ReturnType<typeof metricFact>[]> = {
    income: [],
    balance_sheet: [],
    cash_flow: [],
  };
  for (const [metricId, rawValue] of Object.entries(values) as [ResearchFinancialStatementMetricId, string][]) {
    statements[metricDefinitions[metricId].statementKind].push(metricFact(record, metricId, rawValue, overrides[metricId]));
  }
  return [
    { kind: "income" as const, facts: statements.income },
    { kind: "balance_sheet" as const, facts: statements.balance_sheet },
    { kind: "cash_flow" as const, facts: statements.cash_flow },
  ];
}

function makeQuarterRecord(
  identity: Identity,
  fiscalYear: number,
  fiscalQuarter: 1 | 2 | 3 | 4,
  values: Partial<Record<ResearchFinancialStatementMetricId, string>>,
  options: {
    filingBasis?: "consolidated" | "individual" | "unknown";
    valueKinds?: Partial<Record<ResearchFinancialStatementMetricId, {
      valueKind?: "cumulative" | "discrete" | "instant";
      unitId?: string;
      taxonomyVersion?: string;
    }>>;
    publicationContext?: Partial<ResearchFinancialStatementRecord["publicationContext"]>;
    ambiguityFlags?: ResearchFinancialStatementRecord["ambiguityFlags"];
    extraFacts?: ResearchFinancialStatementRecord["statements"][number]["facts"];
  } = {},
): ResearchFinancialStatementRecord {
  const { periodStart, periodEnd } = quarterBounds(fiscalYear, fiscalQuarter);
  const record = makeRecord({
    listingId: identity.listing.id,
    issuerId: identity.issuer.id,
    filingBasis: options.filingBasis ?? "consolidated",
    fiscalPeriod: { fiscalYear, fiscalQuarter, periodStart, periodEnd },
    publicationContext: {
      filingId: `mops-${fiscalYear}-q${fiscalQuarter}-${options.filingBasis ?? "consolidated"}`,
      revisionId: `mops-${fiscalYear}-q${fiscalQuarter}-${options.filingBasis ?? "consolidated"}-r0`,
      publishedAt: `${fiscalQuarter === 4 ? fiscalYear + 1 : fiscalYear}-${fiscalQuarter === 1 ? "05" : fiscalQuarter === 2 ? "08" : fiscalQuarter === 3 ? "11" : "03"}-15T10:00:00.000Z`,
      revisionPublishedAt: null,
      filingSequence: 1,
      revisionSequence: 0,
      processingId: `proc-${fiscalYear}-q${fiscalQuarter}-${options.filingBasis ?? "consolidated"}`,
      processingSequence: 1,
      restatement: false,
      amendment: false,
      ...options.publicationContext,
    },
    ambiguityFlags: options.ambiguityFlags ?? [],
  });
  const statements = assembleStatements(record, values, options.valueKinds);
  if (options.extraFacts?.length) statements[0]!.facts.push(...options.extraFacts);
  return { ...record, statements };
}

function makeAnnualRecord(
  identity: Identity,
  fiscalYear: number,
  values: Partial<Record<ResearchFinancialStatementMetricId, string>>,
  options: {
    filingBasis?: "consolidated" | "individual";
    publicationContext?: Partial<ResearchFinancialStatementRecord["publicationContext"]>;
  } = {},
): ResearchFinancialStatementRecord {
  const record = makeRecord({
    listingId: identity.listing.id,
    issuerId: identity.issuer.id,
    periodicity: "annual",
    filingBasis: options.filingBasis ?? "consolidated",
    fiscalPeriod: { fiscalYear, fiscalQuarter: null, periodStart: `${fiscalYear}-01-01`, periodEnd: `${fiscalYear}-12-31` },
    publicationContext: {
      filingId: `mops-${fiscalYear}-annual-${options.filingBasis ?? "consolidated"}`,
      revisionId: `mops-${fiscalYear}-annual-${options.filingBasis ?? "consolidated"}-r0`,
      publishedAt: `${fiscalYear + 1}-03-15T10:00:00.000Z`,
      revisionPublishedAt: null,
      filingSequence: 1,
      revisionSequence: 0,
      processingId: `proc-${fiscalYear}-annual-${options.filingBasis ?? "consolidated"}`,
      processingSequence: 1,
      restatement: false,
      amendment: false,
      ...options.publicationContext,
    },
  });
  return { ...record, statements: assembleStatements(record, values) };
}

describe("research financial-statement service", () => {
  it("freshness: marks an older filing stale when a later statutory period is due", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2025, 3, { revenue: "40" }),
    ]);

    const statements = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [],
    });

    expect(statements.freshness.state).toBe("stale");
  });

  it("quarterly-only store: manifest reports financial statements available", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 2, { revenue: "60" }),
    ]);

    const manifest = await getResearchManifest(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });

    expect(manifest.datasets.find((dataset) => dataset.id === "financial_statements")).toMatchObject({
      status: "available",
    });
  });

  it("unknown-basis store: policy reads preserve the filing and withhold basis-dependent readiness", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, { revenue: "28" }, { filingBasis: "consolidated" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "60" }, { filingBasis: "unknown" }),
    ]);

    const manifest = await getResearchManifest(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });
    const statements = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 2 },
      filingBasis: "policy_selected",
      derivedMetrics: [{ metricId: "period_over_period_change", parameters: { baseMetricId: "revenue" } }],
    });

    expect(manifest.datasets.find((dataset) => dataset.id === "financial_statements")).toMatchObject({ status: "available" });
    expect(statements.periods).toHaveLength(2);
    expect(statements.periods.map((period) => period.filingBasis)).toEqual(["unknown", "consolidated"]);
    expect(statements.readiness).toMatchObject({ status: "usable_with_gaps", reasonCodes: expect.arrayContaining(["ambiguous_basis"]) });
    expect(statements.derivedOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "withheld", metricId: "period_over_period_change", reasonCode: "ambiguous_inputs" }),
    ]));
    expect(statements.derivedOutcomes.every((outcome) => outcome.status === "withheld")).toBe(true);
  });

  it("comparative filing contexts: derived metrics select facts for the target filing period", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const record = makeQuarterRecord(identity, 2026, 2, { revenue: "60", gross_profit: "24" }, {
      valueKinds: {
        revenue: { valueKind: "discrete" },
        gross_profit: { valueKind: "discrete" },
      },
    });
    const comparativeRevenue = metricFact(record, "revenue", "50", { valueKind: "discrete" });
    const comparativeGrossProfit = metricFact(record, "gross_profit", "20", { valueKind: "discrete" });
    const segmentRevenue = metricFact(record, "revenue", "15", { valueKind: "discrete" });
    const segmentGrossProfit = metricFact(record, "gross_profit", "6", { valueKind: "discrete" });
    const cumulativeRevenue = metricFact(record, "revenue", "110", { valueKind: "cumulative" });
    const cumulativeGrossProfit = metricFact(record, "gross_profit", "44", { valueKind: "cumulative" });
    comparativeRevenue.context = {
      ...comparativeRevenue.context,
      contextId: "2025-Q2:revenue",
      period: { kind: "duration", startAt: "2025-04-01T00:00:00.000Z", endAt: "2025-06-30T23:59:59.999Z" },
    };
    comparativeGrossProfit.context = {
      ...comparativeGrossProfit.context,
      contextId: "2025-Q2:gross-profit",
      period: { kind: "duration", startAt: "2025-04-01T00:00:00.000Z", endAt: "2025-06-30T23:59:59.999Z" },
    };
    segmentRevenue.context = {
      ...segmentRevenue.context,
      contextId: "2026-Q2:segment-revenue",
      dimensions: { OperatingSegmentsAxis: "FoundryMember" },
    };
    segmentGrossProfit.context = {
      ...segmentGrossProfit.context,
      contextId: "2026-Q2:segment-gross-profit",
      dimensions: { OperatingSegmentsAxis: "FoundryMember" },
    };
    cumulativeRevenue.context = { ...cumulativeRevenue.context, contextId: "2026-YTD:revenue", period: { kind: "duration", startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-06-30T23:59:59.999Z" } };
    cumulativeGrossProfit.context = { ...cumulativeGrossProfit.context, contextId: "2026-YTD:gross-profit", period: { kind: "duration", startAt: "2026-01-01T00:00:00.000Z", endAt: "2026-06-30T23:59:59.999Z" } };
    record.statements[0]!.facts.push(comparativeRevenue, comparativeGrossProfit, segmentRevenue, segmentGrossProfit, cumulativeRevenue, cumulativeGrossProfit);
    await persistence.appendResearchFinancialStatementRecords([record]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "gross_margin", parameters: {} }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "gross_margin", value: "0.4" }),
    ]);
    expect(result.periods[0]?.sourceFacts.find((fact) => fact.observationId === cumulativeRevenue.id)?.period.durationMonths).toBe(6);
    expect(result.periods[0]?.sourceFacts.find((fact) => fact.observationId === comparativeRevenue.id)?.period).toMatchObject({
      fiscalYear: 2025,
      fiscalQuarter: 2,
    });
  });

  it("cumulative reconstruction: subtracts prior YTD when the prior filing also has a discrete fact", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const q2 = makeQuarterRecord(identity, 2026, 2, { revenue: "60" });
    q2.statements[0]!.facts.push(metricFact(q2, "revenue", "32", { valueKind: "discrete" }));
    const q3 = makeQuarterRecord(identity, 2026, 3, { revenue: "100" });
    await persistence.appendResearchFinancialStatementRecords([q2, q3]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-11-20T00:00:00.000Z",
        effectiveAt: "2026-11-20T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "reconstructed_discrete_quarter", parameters: { baseMetricId: "revenue" } }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "reconstructed_discrete_quarter", value: "40" }),
    ]);
  });

  it("worker filing IDs: maps colon-delimited source identifiers to canonical output IDs", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const workerRecord = makeQuarterRecord(identity, 2026, 2, { revenue: "60" }, {
      publicationContext: {
        filingId: "mops:2330:2026:q2",
        revisionId: "mops:2330:2026:q2:r0",
      },
    });
    workerRecord.provenance = { ...workerRecord.provenance, id: "prv_worker_filing" };
    await persistence.appendResearchFinancialStatementRecords([workerRecord]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [],
    });

    expect(result.periods[0]?.sourceFacts[0]?.revision).toMatchObject({
      filingId: expect.stringMatching(/^filing_[0-9a-f]{32}$/),
      revisionTag: "mops:2330:2026:q2:r0",
    });
  });

  it("average-balance ratios: withhold when the immediately preceding annual period is missing", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeAnnualRecord(identity, 2022, { net_income: "10", equity: "70" }),
      makeAnnualRecord(identity, 2024, { net_income: "18", equity: "90" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: { knowledgeAt: "2026-09-01T00:00:00.000Z", effectiveAt: "2026-09-01T00:00:00.000Z", assessmentMode: "effective" },
      periodicity: "annual",
      range: { kind: "latest_periods", count: 2 },
      derivedMetrics: [{ metricId: "return_on_equity", parameters: {} }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "withheld", metricId: "return_on_equity", reasonCode: "missing_inputs" }),
      expect.objectContaining({ status: "withheld", metricId: "return_on_equity", reasonCode: "missing_inputs" }),
    ]);
    expect(result.derivedOutcomes.map((outcome) => outcome.filingPeriodId)).toEqual(
      result.periods.map((period) => period.filingPeriodId),
    );
  });

  it("signed capital expenditure: free cash flow adds the negative outflow", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 2, { operating_cash_flow: "66", capital_expenditure: "-25" }, {
        valueKinds: {
          operating_cash_flow: { valueKind: "discrete" },
          capital_expenditure: { valueKind: "discrete" },
        },
      }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "free_cash_flow", parameters: {} }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "free_cash_flow", value: "41" }),
    ]);
  });

  it("first-quarter change: compares Q1 with the prior-year Q4", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2025, 4, { revenue: "40" }, { valueKinds: { revenue: { valueKind: "discrete" } } }),
      makeQuarterRecord(identity, 2026, 1, { revenue: "50" }, { valueKinds: { revenue: { valueKind: "discrete" } } }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "period_over_period_change", parameters: { baseMetricId: "revenue" } }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "period_over_period_change", value: "0.25" }),
    ]);
  });

  it("period-over-period change: withholds facts from different taxonomy versions", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const prior = makeQuarterRecord(identity, 2025, 4, { revenue: "40" }, { valueKinds: { revenue: { valueKind: "discrete" } } });
    const current = makeQuarterRecord(identity, 2026, 1, { revenue: "50" }, { valueKinds: { revenue: { valueKind: "discrete" } } });
    prior.statements.flatMap((section) => section.facts).find((fact) => fact.metric.state === "mapped" && fact.metric.metricId === "revenue")!.taxonomy = {
      namespaceUri: "http://xbrl.ifrs.org/taxonomy/2025/ifrs-full",
      version: "2025",
    };
    current.statements.flatMap((section) => section.facts).find((fact) => fact.metric.state === "mapped" && fact.metric.metricId === "revenue")!.taxonomy = {
      namespaceUri: "http://xbrl.ifrs.org/taxonomy/2026/ifrs-full",
      version: "2026",
    };
    await persistence.appendResearchFinancialStatementRecords([prior, current]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "period_over_period_change", parameters: { baseMetricId: "revenue" } }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "withheld", metricId: "period_over_period_change", reasonCode: "incomparable_inputs" }),
    ]);
  });

  it("same-period formulas: withhold inputs from different taxonomy versions", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, {
        equity: "90",
        assets: "180",
      }, {
        valueKinds: {
          equity: { taxonomyVersion: "2025" },
          assets: { taxonomyVersion: "2025" },
        },
      }),
      makeQuarterRecord(identity, 2026, 2, {
        revenue: "100",
        gross_profit: "40",
        net_income: "20",
        assets: "200",
        interest_bearing_debt: "50",
        equity: "100",
        current_assets: "120",
        current_liabilities: "60",
        operating_cash_flow: "30",
        capital_expenditure: "10",
      }, {
        ambiguityFlags: ["taxonomy_change"],
        valueKinds: {
          revenue: { valueKind: "discrete", taxonomyVersion: "2026" },
          gross_profit: { valueKind: "discrete", taxonomyVersion: "2025" },
          net_income: { valueKind: "discrete", taxonomyVersion: "2026" },
          assets: { taxonomyVersion: "2025" },
          interest_bearing_debt: { taxonomyVersion: "2026" },
          equity: { taxonomyVersion: "2025" },
          current_assets: { taxonomyVersion: "2026" },
          current_liabilities: { taxonomyVersion: "2025" },
          operating_cash_flow: { valueKind: "discrete", taxonomyVersion: "2026" },
          capital_expenditure: { valueKind: "discrete", taxonomyVersion: "2025" },
        },
      }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [
        { metricId: "gross_margin", parameters: {} },
        { metricId: "debt_to_equity", parameters: {} },
        { metricId: "current_ratio", parameters: {} },
        { metricId: "free_cash_flow", parameters: {} },
        { metricId: "return_on_equity", parameters: {} },
        { metricId: "return_on_assets", parameters: {} },
      ],
    });

    expect(result.derivedOutcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "withheld", metricId: "gross_margin", reasonCode: "incomparable_inputs" }),
      expect.objectContaining({ status: "withheld", metricId: "debt_to_equity", reasonCode: "incomparable_inputs" }),
      expect.objectContaining({ status: "withheld", metricId: "current_ratio", reasonCode: "incomparable_inputs" }),
      expect.objectContaining({ status: "withheld", metricId: "free_cash_flow", reasonCode: "incomparable_inputs" }),
      expect.objectContaining({ status: "withheld", metricId: "return_on_equity", reasonCode: "incomparable_inputs" }),
      expect.objectContaining({ status: "withheld", metricId: "return_on_assets", reasonCode: "incomparable_inputs" }),
    ]));
  });

  it("negative CAGR endpoint: withholds instead of returning NaN", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeAnnualRecord(identity, 2023, { net_income: "10" }),
      makeAnnualRecord(identity, 2024, { net_income: "5" }),
      makeAnnualRecord(identity, 2025, { net_income: "-2" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "annual",
      range: { kind: "latest_periods", count: 3 },
      derivedMetrics: [{ metricId: "compound_annual_growth_rate", parameters: { baseMetricId: "net_income", windowPeriods: 3 } }],
    });

    expect(result.derivedOutcomes[0]).toEqual(
      expect.objectContaining({ status: "withheld", metricId: "compound_annual_growth_rate" }),
    );
    expect(JSON.stringify(result)).not.toContain("NaN");
  });

  it("ascending pagination: freshness remains anchored to the latest selected filing", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, { revenue: "28" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "60" }),
    ]);
    const query = {
      subject: { kind: "listing_id" as const, listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective" as const,
      },
      periodicity: "quarterly" as const,
      range: { kind: "latest_periods" as const, count: 2 },
      derivedMetrics: [],
    };
    const firstPage = await getFinancialStatements(persistence, {
      ...query,
      page: { limit: 1, order: "asc" },
    });
    const secondPage = await getFinancialStatements(persistence, {
      ...query,
      page: { limit: 1, order: "asc", cursor: firstPage.page.nextCursor ?? undefined },
    });

    expect(firstPage.periods[0]).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 1 });
    expect(firstPage.freshness).toEqual({
      state: "current",
      authoritativeAsOf: "2026-08-15",
      latestAcceptedAt: "2026-08-15T10:00:00.000Z",
    });
    expect(secondPage.freshness).toEqual(firstPage.freshness);
  });

  it("maps canonical records to paged periods and derives ratios from source facts only", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    const record = makeRecord({ listingId: identity.listing.id, issuerId: identity.issuer.id });
    record.statements = assembleStatements(record, {
      revenue: "100",
      gross_profit: "40",
      current_assets: "120",
      current_liabilities: "60",
      operating_cash_flow: "25",
      capital_expenditure: "10",
    }, {
      revenue: { valueKind: "discrete" },
      gross_profit: { valueKind: "discrete" },
      operating_cash_flow: { valueKind: "discrete" },
      capital_expenditure: { valueKind: "discrete" },
    });
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([record]);
    const appendIdentitySpy = vi.spyOn(persistence, "appendResearchIdentityRecords");
    const appendStatementsSpy = vi.spyOn(persistence, "appendResearchFinancialStatementRecords");

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 4 },
      page: { limit: 1, order: "desc" },
      statements: ["income"],
      derivedMetrics: [
        { metricId: "gross_margin", parameters: {} },
        { metricId: "current_ratio", parameters: {} },
        { metricId: "free_cash_flow", parameters: {} },
      ],
    });

    expect(result.identity.availability).toEqual({ status: "eligible", reasonCode: "operating_company" });
    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]?.sourceFacts.every((fact) => fact.statement === "income")).toBe(true);
    expect(result.periods[0]?.sourceFacts.some((fact) => fact.value.state === "present" && fact.value.value === "0")).toBe(false);
    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "gross_margin", value: "0.4" }),
      expect.objectContaining({ status: "returned", metricId: "current_ratio", value: "2" }),
      expect.objectContaining({ status: "returned", metricId: "free_cash_flow", value: "15" }),
    ]);
    expect(appendIdentitySpy).not.toHaveBeenCalled();
    expect(appendStatementsSpy).not.toHaveBeenCalled();
  });

  it("derives all quarterly metric families from stored source facts across the selected range", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2025, 3, {
        revenue: "35",
        gross_profit: "14",
        operating_income: "10.5",
        net_income: "7",
        assets: "180",
        equity: "90",
        current_assets: "70",
        current_liabilities: "35",
        interest_bearing_debt: "45",
        operating_cash_flow: "9",
        capital_expenditure: "3",
      }, { valueKinds: { revenue: { valueKind: "discrete" }, gross_profit: { valueKind: "discrete" }, operating_income: { valueKind: "discrete" }, net_income: { valueKind: "discrete" }, operating_cash_flow: { valueKind: "discrete" }, capital_expenditure: { valueKind: "discrete" } } }),
      makeQuarterRecord(identity, 2025, 4, {
        revenue: "40",
        gross_profit: "16",
        operating_income: "12",
        net_income: "8",
        assets: "185",
        equity: "92",
        current_assets: "74",
        current_liabilities: "37",
        interest_bearing_debt: "46",
        operating_cash_flow: "10",
        capital_expenditure: "4",
      }, { valueKinds: { revenue: { valueKind: "discrete" }, gross_profit: { valueKind: "discrete" }, operating_income: { valueKind: "discrete" }, net_income: { valueKind: "discrete" }, operating_cash_flow: { valueKind: "discrete" }, capital_expenditure: { valueKind: "discrete" } } }),
      makeQuarterRecord(identity, 2026, 1, {
        revenue: "28",
        gross_profit: "11.2",
        operating_income: "8.4",
        net_income: "5.6",
        assets: "190",
        equity: "95",
        current_assets: "78",
        current_liabilities: "39",
        interest_bearing_debt: "48",
        operating_cash_flow: "7",
        capital_expenditure: "2",
      }),
      makeQuarterRecord(identity, 2026, 2, {
        revenue: "60",
        gross_profit: "24",
        operating_income: "18",
        net_income: "12",
        assets: "210",
        equity: "105",
        current_assets: "84",
        current_liabilities: "42",
        interest_bearing_debt: "52",
        operating_cash_flow: "15",
        capital_expenditure: "5",
      }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [
        { metricId: "reconstructed_discrete_quarter", parameters: { baseMetricId: "revenue" } },
        { metricId: "trailing_twelve_month", parameters: { baseMetricId: "revenue" } },
        { metricId: "period_over_period_change", parameters: { baseMetricId: "revenue" } },
        { metricId: "gross_margin", parameters: {} },
        { metricId: "operating_margin", parameters: {} },
        { metricId: "net_margin", parameters: {} },
        { metricId: "debt_to_equity", parameters: {} },
        { metricId: "current_ratio", parameters: {} },
        { metricId: "free_cash_flow", parameters: {} },
        { metricId: "return_on_equity", parameters: {} },
        { metricId: "return_on_assets", parameters: {} },
      ],
    });

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 2 });
    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "reconstructed_discrete_quarter", value: "32" }),
      expect.objectContaining({ status: "returned", metricId: "trailing_twelve_month", value: "135" }),
      expect.objectContaining({ status: "returned", metricId: "period_over_period_change", value: "0.142857" }),
      expect.objectContaining({ status: "returned", metricId: "gross_margin", value: "0.4" }),
      expect.objectContaining({ status: "returned", metricId: "operating_margin", value: "0.3" }),
      expect.objectContaining({ status: "returned", metricId: "net_margin", value: "0.2" }),
      expect.objectContaining({ status: "returned", metricId: "debt_to_equity", value: "0.495238" }),
      expect.objectContaining({ status: "returned", metricId: "current_ratio", value: "2" }),
      expect.objectContaining({ status: "returned", metricId: "free_cash_flow", value: "5" }),
      expect.objectContaining({ status: "returned", metricId: "return_on_equity", value: "0.064" }),
      expect.objectContaining({ status: "returned", metricId: "return_on_assets", value: "0.032" }),
    ]);
    expect(result.derivedOutcomes[1]?.periodObservationIds.length).toBe(5);
    expect(result.derivedOutcomes.every((metric) => metric.status === "returned" && metric.calculatedAt === "2026-09-01T00:00:00.000Z")).toBe(true);
  });

  it("trailing-twelve-month: withholds instant balance-sheet metrics", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 2, { assets: "210" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "trailing_twelve_month", parameters: { baseMetricId: "assets" } }],
    });

    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "withheld", metricId: "trailing_twelve_month", reasonCode: "incomparable_inputs" }),
    ]);
  });

  it("derives annual CAGR and isolates annual from quarterly records", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeAnnualRecord(identity, 2023, { revenue: "100", net_income: "10", assets: "150", equity: "70" }),
      makeAnnualRecord(identity, 2024, { revenue: "121", net_income: "12", assets: "180", equity: "80" }),
      makeAnnualRecord(identity, 2025, { revenue: "144", net_income: "18", assets: "210", equity: "90" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "60", net_income: "12", assets: "210", equity: "105" }),
    ]);

    const annual = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "annual",
      range: { kind: "latest_periods", count: 3 },
      page: { limit: 1, order: "desc" },
      derivedMetrics: [
        { metricId: "compound_annual_growth_rate", parameters: { baseMetricId: "revenue", windowPeriods: 3 } },
        { metricId: "return_on_equity", parameters: {} },
        { metricId: "return_on_assets", parameters: {} },
      ],
    });
    const quarterly = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [],
    });

    expect(annual.periods).toHaveLength(1);
    expect(annual.periods[0]).toMatchObject({ fiscalYear: 2025, fiscalQuarter: null });
    expect(annual.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "compound_annual_growth_rate", value: "0.2" }),
      expect.objectContaining({ status: "returned", metricId: "return_on_equity", value: "0.211765" }),
      expect.objectContaining({ status: "returned", metricId: "return_on_assets", value: "0.092308" }),
    ]);
    expect(quarterly.periods[0]).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 2 });
  });

  it("recomputes from the latest amended revision without mutating historical source rows", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const q1 = makeQuarterRecord(identity, 2026, 1, { revenue: "28", gross_profit: "11.2" });
    const original = makeQuarterRecord(identity, 2026, 2, { revenue: "50", gross_profit: "20" });
    const amended = makeQuarterRecord(identity, 2026, 2, { revenue: "60", gross_profit: "24" }, {
      publicationContext: {
        revisionId: "mops-2026-q2-consolidated-r1",
        revisionPublishedAt: "2026-08-20T08:00:00.000Z",
        publishedAt: "2026-08-20T08:00:00.000Z",
        revisionSequence: 1,
        amendment: true,
      },
    });
    await persistence.appendResearchFinancialStatementRecords([q1, original, amended]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 2 },
      page: { limit: 1, order: "desc" },
      derivedMetrics: [
        { metricId: "reconstructed_discrete_quarter", parameters: { baseMetricId: "revenue" } },
        { metricId: "gross_margin", parameters: {} },
      ],
    });

    expect(result.periods[0]).toMatchObject({
      publishedAt: "2026-08-20",
      acceptedAt: "2026-08-20T08:00:00.000Z",
      quality: {
        amendmentsRestatements: { status: "present", reasonCodes: ["amendmentsRestatements"] },
      },
    });
    expect(result.periods[0]?.sourceFacts.every((fact) => fact.revision.revisionTag === "mops-2026-q2-consolidated-r1")).toBe(true);
    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "reconstructed_discrete_quarter", value: "32" }),
      expect.objectContaining({ status: "returned", metricId: "gross_margin", value: "0.4" }),
    ]);
  });

  it("does not fallback across explicit bases and prefers a complete policy-selected basis without merging", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, { revenue: "28", equity: "95" }, { filingBasis: "consolidated" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "60", equity: "105" }, { filingBasis: "consolidated" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "58", equity: "104" }, { filingBasis: "individual" }),
    ]);

    const policySelected = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 2 },
      derivedMetrics: [],
    });
    const explicitIndividual = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      filingBasis: "individual",
      range: { kind: "period_end_range", startDate: "2026-01-01", endDate: "2026-03-31" },
      derivedMetrics: [],
    });

    expect(policySelected.basisPolicy.selected).toBe("consolidated");
    expect(policySelected.periods.map((period) => period.filingBasis)).toEqual(["consolidated", "consolidated"]);
    expect(explicitIndividual.basisPolicy.selected).toBe("individual");
    expect(explicitIndividual.periods).toEqual([]);
    expect(explicitIndividual.readiness).toEqual({ status: "withheld", reasonCodes: ["no_authoritative_filing"] });
  });

  it("latest-period basis policy: selects coverage within the requested newest window", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2023, 1, { revenue: "10" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2023, 2, { revenue: "20" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2023, 3, { revenue: "30" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2023, 4, { revenue: "40" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2024, 1, { revenue: "50" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2024, 2, { revenue: "60" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2024, 3, { revenue: "70" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2024, 4, { revenue: "80" }, { filingBasis: "individual" }),
      makeQuarterRecord(identity, 2025, 1, { revenue: "90" }, { filingBasis: "consolidated" }),
      makeQuarterRecord(identity, 2025, 2, { revenue: "100" }, { filingBasis: "consolidated" }),
      makeQuarterRecord(identity, 2025, 3, { revenue: "110" }, { filingBasis: "consolidated" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 3 },
      filingBasis: "policy_selected",
      derivedMetrics: [],
    });

    expect(result.basisPolicy.selected).toBe("consolidated");
    expect(result.periods.map((period) => [period.fiscalYear, period.fiscalQuarter, period.filingBasis])).toEqual([
      [2025, 3, "consolidated"],
      [2025, 2, "consolidated"],
      [2025, 1, "consolidated"],
    ]);
  });

  it("period-end range: does not widen dates inside a fiscal period", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, { revenue: "28" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "period_end_range", startDate: "2026-02-01", endDate: "2026-02-28" },
      derivedMetrics: [],
    });

    expect(result.periods).toEqual([]);
    expect(result.readiness).toEqual({ status: "withheld", reasonCodes: ["no_authoritative_filing"] });
  });

  it("period-end range: loads predecessor lookback for derived metrics without widening output", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, { revenue: "28" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "60" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "period_end_range", startDate: "2026-06-30", endDate: "2026-06-30" },
      derivedMetrics: [{ metricId: "period_over_period_change", parameters: { baseMetricId: "revenue" } }],
    });

    expect(result.periods).toHaveLength(1);
    expect(result.periods[0]).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 2 });
    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "period_over_period_change", value: "0.142857" }),
    ]);
  });

  it("quarterly freshness: treats Q4 as due once the annual filing deadline passes", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 3, { revenue: "90" }),
      makeQuarterRecord(identity, 2026, 4, { revenue: "130" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2027-04-15T00:00:00.000Z",
        effectiveAt: "2027-04-15T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [],
    });

    expect(result.periods[0]).toMatchObject({ fiscalYear: 2026, fiscalQuarter: 4 });
    expect(result.freshness.state).toBe("current");
  });

  it("optional statement section: returns no periods when the selected filing has no requested section", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 2, { revenue: "60" }),
    ]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      statements: ["equity"],
      derivedMetrics: [],
    });

    expect(result.periods).toEqual([]);
    expect(result.readiness).toEqual({ status: "withheld", reasonCodes: ["no_authoritative_filing"] });
  });

  it("equity statement: required-core selection returns unmapped equity facts", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const record = makeQuarterRecord(identity, 2026, 2, { revenue: "60" });
    const equityFact = metricFact(record, "equity", "90");
    equityFact.statementKind = "equity";
    equityFact.concept = { qname: "tifrs-bsci-ci:EquityAtBeginningOfPeriod", label: "Equity at beginning of period" };
    equityFact.metric = { state: "unmapped", reason: "no_core_metric_mapping" };
    record.statements.push({ kind: "equity", facts: [equityFact] });
    await persistence.appendResearchFinancialStatementRecords([record]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      statements: ["equity"],
      derivedMetrics: [],
    });

    expect(result.periods[0]?.statements).toEqual(["equity"]);
    expect(result.periods[0]?.sourceFacts).toEqual([
      expect.objectContaining({ statement: "equity", metricId: "unmapped" }),
    ]);
  });

  it("completeness: counts required requested facts that are absent from a returned period", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const record = makeQuarterRecord(identity, 2026, 2, { revenue: "60" });
    const comparativeGrossProfit = metricFact(record, "gross_profit", "20", { valueKind: "discrete" });
    comparativeGrossProfit.context = {
      ...comparativeGrossProfit.context,
      contextId: "2025-Q2:gross-profit",
      period: { kind: "duration", startAt: "2025-04-01T00:00:00.000Z", endAt: "2025-06-30T23:59:59.999Z" },
    };
    record.statements[0]!.facts.push(comparativeGrossProfit);
    await persistence.appendResearchFinancialStatementRecords([record]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      statements: ["income"],
      derivedMetrics: [],
    });

    expect(result.periods).toHaveLength(1);
    expect(result.completeness).toMatchObject({
      status: "partial",
      missingFactCount: 3,
    });
    expect(result.periods[0]?.sourceFacts.some((fact) => fact.observationId === comparativeGrossProfit.id)).toBe(true);
  });

  it("sector-extension group: returns unmapped extension facts from the requested section", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const record = makeQuarterRecord(identity, 2026, 2, { revenue: "60" });
    const extensionFacts = Array.from({ length: 105 }, (_, index) => normalizeResearchFinancialStatementFact({
      listingId: identity.listing.id,
      issuerId: identity.issuer.id,
      filingId: record.publicationContext.filingId,
      revisionId: record.publicationContext.revisionId,
      statementKind: "sector_extension",
      concept: { qname: `tifrs:BankCapitalAdequacyRatio${index}`, label: `Capital adequacy ratio ${index}` },
      metric: { state: "unmapped", reason: "no_core_metric_mapping" },
      contextId: `sector-extension-${index}`,
      period: { kind: "instant", instantAt: "2026-06-30T23:59:59.999Z" },
      valueKind: "instant",
      rawValue: index === 0 ? "Tier 1 capital disclosure" : String(13.4 + index),
      taxonomy: index === 0
        ? { namespaceUri: "https://mops.twse.com.tw/taxonomy/2025/tifrs-bank", version: "2025" }
        : { namespaceUri: "https://mops.twse.com.tw/taxonomy/2026/tifrs-bank", version: "2026" },
      unit: { state: "known", unitId: "pure" },
    }));
    record.statements.push({ kind: "sector_extension", facts: extensionFacts, metadata: { sector: "financial_institution" } });
    await persistence.appendResearchFinancialStatementRecords([record]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      statements: ["sector_extension"],
      metricSelection: { base: "required_core", groups: ["sector_extension"], explicitMetricIds: [] },
      derivedMetrics: [],
    });

    expect(result.periods[0]?.sourceFacts).toHaveLength(100);
    expect(result.periods[0]?.sourceFacts[0]).toEqual(
      expect.objectContaining({
        statement: "sector_extension",
        concept: expect.objectContaining({ raw: "tifrs:BankCapitalAdequacyRatio0" }),
        value: { state: "present", value: "Tier 1 capital disclosure" },
        taxonomy: {
          namespace: "https://mops.twse.com.tw/taxonomy/2025/tifrs-bank",
          conceptName: "BankCapitalAdequacyRatio0",
          taxonomyVersion: "2025",
        },
      }),
    );
    expect(result.periods[0]?.quality.unmappedConcepts.observationIds).toHaveLength(100);
    expect(result.page.truncatedByBudget).toBe(true);
  });

  it("filters output facts by metric selection, preserves quality flags, and withholds missing derived inputs without zero fill", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const record = makeQuarterRecord(identity, 2026, 2, {
      revenue: "60",
      current_assets: "84",
    }, {
      extraFacts: [normalizeResearchFinancialStatementFact({
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        filingId: "mops-2026-q2-consolidated",
        revisionId: "mops-2026-q2-consolidated-r0",
        statementKind: "income",
        concept: { qname: "vakwen:CustomMetric", label: "Custom metric" },
        metric: { state: "unmapped", reason: "no_core_metric_mapping" },
        contextId: "custom-metric",
        period: { kind: "duration", startAt: "2026-04-01T00:00:00.000Z", endAt: "2026-06-30T23:59:59.999Z" },
        valueKind: "discrete",
        rawValue: "777",
        unit: { state: "unknown", rawUnitId: "mystery" },
      })],
    });
    await persistence.appendResearchFinancialStatementRecords([record]);

    const result = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 1 },
      derivedMetrics: [{ metricId: "current_ratio", parameters: {} }],
    });

    expect(result.periods[0]?.sourceFacts.map((fact) => fact.metricId)).toEqual(expect.arrayContaining(["revenue", "current_assets"]));
    expect(result.periods[0]?.sourceFacts.some((fact) => fact.metricId === "unmapped")).toBe(false);
    expect(result.periods[0]?.quality.unmappedConcepts.status).toBe("present");
    expect(result.periods[0]?.quality.unknownUnits.status).toBe("present");
    expect(result.periods[0]?.sourceFacts.some((fact) => fact.value.state === "present" && fact.value.value === "0")).toBe(false);
    expect(result.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "withheld", metricId: "current_ratio", reasonCode: "missing_inputs" }),
    ]);
  });

  it("returns derived metrics only on the first page and rejects bound-cursor mutations", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    await persistence.appendResearchFinancialStatementRecords([
      makeQuarterRecord(identity, 2026, 1, { revenue: "28", gross_profit: "11.2" }),
      makeQuarterRecord(identity, 2026, 2, { revenue: "60", gross_profit: "24" }),
    ]);

    const firstPage = await getFinancialStatements(persistence, {
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
    });
    const secondPage = await getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 2 },
      page: { limit: 1, order: "desc", cursor: firstPage.page.nextCursor ?? undefined },
      derivedMetrics: [{ metricId: "gross_margin", parameters: {} }],
    });

    expect(firstPage.page.nextCursor).toBeTruthy();
    expect(firstPage.derivedOutcomes).toEqual([
      expect.objectContaining({ status: "returned", metricId: "gross_margin", value: "0.4" }),
    ]);
    expect(secondPage.periods).toHaveLength(1);
    expect(secondPage.derivedOutcomes).toEqual([]);

    await expect(getFinancialStatements(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-09-01T00:00:00.000Z",
        effectiveAt: "2026-09-01T00:00:00.000Z",
        assessmentMode: "effective",
      },
      periodicity: "quarterly",
      range: { kind: "latest_periods", count: 2 },
      page: { limit: 2, order: "desc", cursor: firstPage.page.nextCursor ?? undefined },
      derivedMetrics: [{ metricId: "gross_margin", parameters: {} }],
    })).rejects.toMatchObject({ code: "research_cursor_invalid" } satisfies Partial<ResearchServiceError>);
  });
});
