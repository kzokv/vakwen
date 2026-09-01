import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  buildFinancialStatementFundamentalsResearchReport,
  renderFinancialStatementFundamentalsResearchReportMarkdown,
} from "../../src/services/research/report.js";
import type { ResearchFinancialStatementsOutput, ResearchFinancialStatementsQueryInput } from "../../src/services/research/contracts.js";

function makeIdentity() {
  return canonicalizeOfficialIdentityRow({
    venue: "TWSE",
    snapshotDate: "2026-08-31",
    retrievedAt: "2026-08-31T02:00:00.000Z",
    artifact: { contentHash: "sha256:financial-report", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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

function makeFact(periodEndDate: string, fiscalYear: number, fiscalQuarter: 1 | 2 | 3 | 4 | null, metricId: string, value: string, statement: "income" | "balance_sheet" | "cash_flow") {
  return {
    observationId: `obs_${metricId}_${fiscalYear}_${fiscalQuarter ?? "annual"}`,
    statement,
    metricId,
    concept: { raw: `ifrs-full:${metricId}`, normalized: { state: "present" as const, value: `ifrs-full:${metricId}` } },
    label: { raw: metricId, normalized: { state: "present" as const, value: metricId } },
    value: { state: "present" as const, value },
    unit: { raw: "iso4217:TWD", normalized: { state: "present" as const, value: "iso4217:TWD" } },
    scale: { raw: null, normalized: { state: "missing" as const, reasonCode: "not_reported" } },
    precision: { raw: null, normalized: { state: "missing" as const, reasonCode: "not_reported" } },
    filingBasis: { raw: "consolidated", normalized: { state: "present" as const, value: "consolidated" as const } },
    dimensions: {},
    period: {
      startDate: fiscalQuarter === null ? `${fiscalYear}-01-01` : `${fiscalYear}-${String(((fiscalQuarter - 1) * 3) + 1).padStart(2, "0")}-01`,
      endDate: periodEndDate,
      fiscalYear,
      fiscalQuarter,
      durationMonths: fiscalQuarter === null ? 12 : 3,
    },
    taxonomy: { namespace: "ifrs-full", conceptName: metricId, taxonomyVersion: "2026" },
    provenanceId: `prv_${fiscalYear}_${fiscalQuarter ?? "annual"}`,
    ambiguity: { status: "none" as const, relatedObservationIds: [] },
    relations: { comparableObservationIds: [], supersededByObservationIds: [] },
    revision: {
      filingId: `filing_${fiscalYear}_${fiscalQuarter ?? "annual"}`,
      accessionNumber: null,
      amended: false,
      restated: false,
      revisionTag: `r0`,
    },
  };
}

function makePeriod(fiscalYear: number, fiscalQuarter: 1 | 2 | 3 | 4 | null, revenue: string): ResearchFinancialStatementsOutput["periods"][number] {
  const periodEndDate = fiscalQuarter === null
    ? `${fiscalYear}-12-31`
    : `${fiscalYear}-${String(fiscalQuarter * 3).padStart(2, "0")}-${fiscalQuarter === 1 ? "31" : fiscalQuarter === 2 ? "30" : fiscalQuarter === 3 ? "30" : "31"}`;
  return {
    filingPeriodId: `period_${fiscalYear}_${fiscalQuarter ?? "annual"}`,
    fiscalYear,
    fiscalQuarter,
    periodStartDate: fiscalQuarter === null ? `${fiscalYear}-01-01` : `${fiscalYear}-${String(((fiscalQuarter - 1) * 3) + 1).padStart(2, "0")}-01`,
    periodEndDate,
    publishedAt: periodEndDate,
    filingDate: periodEndDate,
    acceptedAt: `${periodEndDate}T12:00:00.000Z`,
    filingBasis: "consolidated",
    statements: ["income", "balance_sheet", "cash_flow"],
    sourceFacts: [
      makeFact(periodEndDate, fiscalYear, fiscalQuarter, "revenue", revenue, "income"),
      makeFact(periodEndDate, fiscalYear, fiscalQuarter, "assets", "100", "balance_sheet"),
      makeFact(periodEndDate, fiscalYear, fiscalQuarter, "operating_cash_flow", "10", "cash_flow"),
    ],
    quality: {
      taxonomyChanges: { status: "clear", reasonCodes: [], observationIds: [] },
      amendmentsRestatements: { status: "clear", reasonCodes: [], observationIds: [] },
      duplicateContexts: { status: "clear", reasonCodes: [], observationIds: [] },
      unmappedConcepts: { status: "clear", reasonCodes: [], observationIds: [] },
      unknownUnits: { status: "clear", reasonCodes: [], observationIds: [] },
      ambiguousBasis: { status: "clear", reasonCodes: [], observationIds: [] },
    },
  };
}

function buildStatementsOutput(
  listingId: string,
  periodicity: "annual" | "quarterly",
  periods: ResearchFinancialStatementsOutput["periods"],
  classification: "operating_company" | "financial_institution" = "operating_company",
): ResearchFinancialStatementsOutput {
  return {
    contractVersion: "research-financial-statements/1.0.0",
    selector: { kind: "listing_id", listingId },
    context: {
      knowledgeAt: "2026-09-01T00:00:00.000Z",
      effectiveAt: "2026-09-01T00:00:00.000Z",
      assessmentMode: "effective",
    },
    identity: {
      issuer: { id: "iss_2330", classification },
      security: { id: "sec_2330", issuerId: "iss_2330", type: "common_equity", rights: "common_shares" },
      listing: { id: listingId, securityId: "sec_2330", venue: "TWSE", ticker: "2330", listedAt: "1994-09-05", status: "active" },
      displayName: "台積電",
      eligibility: { profile: "operating_company", state: "eligible", reasonCode: "supported_common_equity" },
      availability: { status: "eligible", reasonCode: "operating_company" },
    },
    periodicity,
    range: { kind: "latest_periods", count: periodicity === "annual" ? 3 : 8 },
    basisPolicy: {
      requested: "policy_selected",
      selected: "consolidated",
      policyId: "mops-xbrl-basis-selection/1.0.0",
      fallbackApplied: false,
    },
    statements: ["income", "balance_sheet", "cash_flow"],
    metricSelection: { base: "required_core", groups: [], explicitMetricIds: [] },
    derivedMetricRequests: [],
    coverage: { status: "complete", requestedPeriodCount: periodicity === "annual" ? 3 : 8, returnedPeriodCount: periods.length },
    freshness: { state: "current", authoritativeAsOf: periods[0]?.filingDate ?? null, latestAcceptedAt: periods[0]?.acceptedAt ?? null },
    completeness: { status: "complete", missingFactCount: 0, missingMetricCount: 0 },
    confidence: { status: "high", reasonCodes: [] },
    readiness: { status: "ready", reasonCodes: [] },
    periods,
    derivedOutcomes: [],
    gaps: [],
    conflicts: [],
    recovery: [],
    provenanceIndex: periods.map((period) => ({
      provenanceId: period.sourceFacts[0]!.provenanceId,
      publisher: "MOPS" as const,
      accessProvider: "MOPS_XBRL" as const,
      authorityRole: "authoritative" as const,
      publisherDataset: "mops_xbrl",
      sourceUrl: "https://mops.twse.com.tw/server-java/t164sb01",
      contentHash: `sha256:${period.filingPeriodId}`,
      retrievedAt: "2026-09-01T00:00:00.000Z",
    })),
    page: { limit: periodicity === "annual" ? 3 : 8, order: "desc", nextCursor: null, recordCount: periods.length, truncatedByBudget: false },
  };
}

function availableFinancialStatementManifest(identity: ReturnType<typeof makeIdentity>) {
  return {
    contractVersion: "research-manifest/1.0.0",
    selector: { kind: "listing_id" as const, listingId: identity.listing.id },
    context: {
      knowledgeAt: "2026-09-01T00:00:00.000Z",
      effectiveAt: "2026-09-01T00:00:00.000Z",
      assessmentMode: "effective" as const,
    },
    eligibility: identity.eligibility,
    orchestration: { skillExposure: "enabled" as const },
    datasets: [
      { id: "research_identity", status: "available" as const },
      { id: "price_series", status: "unavailable" as const, reasonCode: "no_authoritative_price_history" },
      { id: "exchange_valuation_references", status: "unavailable" as const, reasonCode: "identity_only_release" },
      { id: "monthly_revenue", status: "unavailable" as const, reasonCode: "not_acquired" },
      { id: "financial_statements", status: "available" as const },
      { id: "institutional_trading", status: "unavailable" as const, reasonCode: "identity_only_release" },
      { id: "foreign_ownership", status: "unavailable" as const, reasonCode: "identity_only_release" },
      { id: "margin_and_short_balances", status: "unavailable" as const, reasonCode: "identity_only_release" },
      { id: "dividend_events", status: "unavailable" as const, reasonCode: "identity_only_release" },
      { id: "material_announcements", status: "unavailable" as const, reasonCode: "identity_only_release" },
      { id: "investor_materials", status: "unavailable" as const, reasonCode: "identity_only_release" },
    ],
  };
}

describe("financial statement fundamentals report", () => {
  it("operating company fixture: support YoY, annual trend, and quarterly trend from canonical statements only", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      {
        subject: { kind: "listing_id", listingId: identity.listing.id },
        context: {
          knowledgeAt: "2026-09-01T00:00:00.000Z",
          effectiveAt: "2026-09-01T00:00:00.000Z",
          assessmentMode: "effective",
        },
      },
      {
        getResearchManifestImpl: async () => ({
          contractVersion: "research-manifest/1.0.0",
          selector: { kind: "listing_id", listingId: identity.listing.id },
          context: {
            knowledgeAt: "2026-09-01T00:00:00.000Z",
            effectiveAt: "2026-09-01T00:00:00.000Z",
            assessmentMode: "effective",
          },
          eligibility: identity.eligibility,
          orchestration: { skillExposure: "enabled" as const },
          datasets: [
            { id: "research_identity", status: "available" as const },
            { id: "price_series", status: "unavailable" as const, reasonCode: "no_authoritative_price_history" },
            { id: "exchange_valuation_references", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "monthly_revenue", status: "unavailable" as const, reasonCode: "not_acquired" },
            { id: "financial_statements", status: "available" as const },
            { id: "institutional_trading", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "foreign_ownership", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "margin_and_short_balances", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "dividend_events", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "material_announcements", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "investor_materials", status: "unavailable" as const, reasonCode: "identity_only_release" },
          ],
        }) as never,
        getFinancialStatementsImpl: async (_persistence, financialQuery: ResearchFinancialStatementsQueryInput) => (
          financialQuery.periodicity === "annual"
            ? buildStatementsOutput(identity.listing.id, "annual", [
                makePeriod(2023, null, "140"),
                makePeriod(2024, null, "160"),
                makePeriod(2025, null, "200"),
              ])
            : buildStatementsOutput(identity.listing.id, "quarterly", [
                makePeriod(2024, 1, "35"),
                makePeriod(2024, 2, "38"),
                makePeriod(2024, 3, "39"),
                makePeriod(2024, 4, "48"),
                makePeriod(2025, 1, "46"),
                makePeriod(2025, 2, "49"),
                makePeriod(2025, 3, "50"),
                makePeriod(2025, 4, "55"),
              ])
        ),
      },
    );

    expect(report.conclusions.map((item) => item.status)).toEqual(["supported", "supported", "supported"]);
    expect(report.conclusions[0]?.statement).toContain("2025 changed 25%");
    expect(report.conclusions[1]?.statement).toContain("3 complete periods");
    expect(report.conclusions[2]?.statement).toContain("8 comparable discrete quarters");
    const markdown = renderFinancialStatementFundamentalsResearchReportMarkdown(report);
    expect(markdown).toContain("# Taiwan Financial Statement Fundamentals: 台積電");
    expect(markdown).toContain("- latest_revenue_yoy: supported");
  });

  it("comparative filing facts: report calculations select the current filing context", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const latestAnnual = makePeriod(2025, null, "200");
    const comparativeRevenue = makeFact("2024-12-31", 2024, null, "revenue", "999", "income");
    const segmentRevenue = makeFact("2025-12-31", 2025, null, "revenue", "777", "income");
    segmentRevenue.dimensions = { OperatingSegmentsAxis: "FoundryMember" };
    latestAnnual.sourceFacts.unshift(segmentRevenue, comparativeRevenue);
    const quarters = [
      makePeriod(2024, 1, "35"), makePeriod(2024, 2, "38"), makePeriod(2024, 3, "39"), makePeriod(2024, 4, "48"),
      makePeriod(2025, 1, "46"), makePeriod(2025, 2, "49"), makePeriod(2025, 3, "50"), makePeriod(2025, 4, "55"),
    ];

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      {
        subject: { kind: "listing_id", listingId: identity.listing.id },
        context: availableFinancialStatementManifest(identity).context,
      },
      {
        getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
        getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
          query.periodicity === "annual"
            ? buildStatementsOutput(identity.listing.id, "annual", [
                makePeriod(2023, null, "140"),
                makePeriod(2024, null, "160"),
                latestAnnual,
              ])
            : buildStatementsOutput(identity.listing.id, "quarterly", quarters)
        ),
      },
    );

    expect(report.conclusions.find((conclusion) => conclusion.id === "latest_revenue_yoy")?.statement).toContain("changed 25%");
  });

  it("stale annual history: withholds the latest-due YoY conclusion", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const annualOutput = buildStatementsOutput(identity.listing.id, "annual", [
      makePeriod(2020, null, "100"), makePeriod(2021, null, "120"), makePeriod(2022, null, "140"),
    ]);
    annualOutput.freshness.state = "stale";

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      { subject: { kind: "listing_id", listingId: identity.listing.id }, context: availableFinancialStatementManifest(identity).context },
      {
        getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
        getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
          query.periodicity === "annual"
            ? annualOutput
            : buildStatementsOutput(identity.listing.id, "quarterly", [])
        ),
      },
    );

    expect(report.conclusions.find((conclusion) => conclusion.id === "latest_revenue_yoy")).toMatchObject({
      status: "withheld",
      reasonCodes: ["stale_financial_statements"],
    });
  });

  it("annual YoY: withholds revenue values with mismatched known units", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const annuals = [makePeriod(2023, null, "140"), makePeriod(2024, null, "160"), makePeriod(2025, null, "200")];
    const priorRevenue = annuals[1]!.sourceFacts.find((fact) => fact.metricId === "revenue")!;
    priorRevenue.unit = { raw: "iso4217:USD", normalized: { state: "present", value: "iso4217:USD" } };

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      { subject: { kind: "listing_id", listingId: identity.listing.id }, context: availableFinancialStatementManifest(identity).context },
      {
        getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
        getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
          query.periodicity === "annual"
            ? buildStatementsOutput(identity.listing.id, "annual", annuals)
            : buildStatementsOutput(identity.listing.id, "quarterly", [])
        ),
      },
    );

    expect(report.conclusions.find((conclusion) => conclusion.id === "latest_revenue_yoy")?.status).toBe("withheld");
  });

  it("quarterly trend: withholds nonconsecutive or cumulative-only quarter windows", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const annuals = [makePeriod(2023, null, "140"), makePeriod(2024, null, "160"), makePeriod(2025, null, "200")];
    const nonconsecutive = Array.from({ length: 8 }, (_, index) => makePeriod(2018 + index, 1, String(100 + index)));
    const cumulativeOnly = [
      makePeriod(2024, 1, "35"), makePeriod(2024, 2, "38"), makePeriod(2024, 3, "39"), makePeriod(2024, 4, "48"),
      makePeriod(2025, 1, "46"), makePeriod(2025, 2, "49"), makePeriod(2025, 3, "50"), makePeriod(2025, 4, "55"),
    ];
    for (const period of cumulativeOnly.filter((item) => item.fiscalQuarter !== 1)) {
      const revenue = period.sourceFacts.find((fact) => fact.metricId === "revenue")!;
      revenue.period.startDate = `${period.fiscalYear}-01-01`;
    }

    for (const quarters of [nonconsecutive, cumulativeOnly]) {
      const report = await buildFinancialStatementFundamentalsResearchReport(
        persistence,
        { subject: { kind: "listing_id", listingId: identity.listing.id }, context: availableFinancialStatementManifest(identity).context },
        {
          getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
          getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
            query.periodicity === "annual"
              ? buildStatementsOutput(identity.listing.id, "annual", annuals)
              : buildStatementsOutput(identity.listing.id, "quarterly", quarters)
          ),
        },
      );

      expect(report.conclusions.find((conclusion) => conclusion.id === "quarterly_revenue_trend")).toMatchObject({
        status: "withheld",
        reasonCodes: ["insufficient_quarterly_window"],
      });
    }
  });

  it("quarterly ambiguity: does not suppress clean annual conclusions", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const annuals = [makePeriod(2023, null, "140"), makePeriod(2024, null, "160"), makePeriod(2025, null, "200")];
    const quarters = [
      makePeriod(2024, 1, "35"), makePeriod(2024, 2, "38"), makePeriod(2024, 3, "39"), makePeriod(2024, 4, "48"),
      makePeriod(2025, 1, "46"), makePeriod(2025, 2, "49"), makePeriod(2025, 3, "50"), makePeriod(2025, 4, "55"),
    ];
    quarters[0]!.quality.unknownUnits = { status: "present", reasonCodes: ["unknownUnits"], observationIds: [] };

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      { subject: { kind: "listing_id", listingId: identity.listing.id }, context: availableFinancialStatementManifest(identity).context },
      {
        getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
        getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
          query.periodicity === "annual"
            ? buildStatementsOutput(identity.listing.id, "annual", annuals)
            : buildStatementsOutput(identity.listing.id, "quarterly", quarters)
        ),
      },
    );

    expect(report.conclusions.map((conclusion) => [conclusion.id, conclusion.status])).toEqual([
      ["latest_revenue_yoy", "supported"],
      ["multi_year_revenue_trend", "supported"],
      ["quarterly_revenue_trend", "withheld"],
    ]);
  });

  it("season-four filing: reconstructs discrete Q4 revenue from annual less Q3 cumulative facts", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const annuals = [makePeriod(2023, null, "140"), makePeriod(2024, null, "160"), makePeriod(2025, null, "200")];
    const quarters = [
      makePeriod(2024, 1, "35"), makePeriod(2024, 2, "38"), makePeriod(2024, 3, "39"), makePeriod(2024, 4, "160"),
      makePeriod(2025, 1, "46"), makePeriod(2025, 2, "49"), makePeriod(2025, 3, "50"), makePeriod(2025, 4, "200"),
    ];
    for (const [year, q3Cumulative] of [[2024, "112"], [2025, "145"]] as const) {
      const q3 = quarters.find((period) => period.fiscalYear === year && period.fiscalQuarter === 3)!;
      const cumulative = makeFact(q3.periodEndDate, year, 3, "revenue", q3Cumulative, "income");
      cumulative.period.startDate = `${year}-01-01`;
      q3.sourceFacts.push(cumulative);
      const q4Revenue = quarters.find((period) => period.fiscalYear === year && period.fiscalQuarter === 4)!
        .sourceFacts.find((fact) => fact.metricId === "revenue")!;
      q4Revenue.period.startDate = `${year}-01-01`;
    }

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      { subject: { kind: "listing_id", listingId: identity.listing.id }, context: availableFinancialStatementManifest(identity).context },
      {
        getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
        getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
          query.periodicity === "annual"
            ? buildStatementsOutput(identity.listing.id, "annual", annuals)
            : buildStatementsOutput(identity.listing.id, "quarterly", quarters)
        ),
      },
    );

    expect(report.conclusions.find((conclusion) => conclusion.id === "quarterly_revenue_trend")?.status).toBe("supported");
  });

  it("annual trend: withholds nonconsecutive years and periods without usable revenue", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);
    const quarters = [
      makePeriod(2024, 1, "35"), makePeriod(2024, 2, "38"), makePeriod(2024, 3, "39"), makePeriod(2024, 4, "48"),
      makePeriod(2025, 1, "46"), makePeriod(2025, 2, "49"), makePeriod(2025, 3, "50"), makePeriod(2025, 4, "55"),
    ];
    const missingRevenue = makePeriod(2024, null, "160");
    missingRevenue.sourceFacts = missingRevenue.sourceFacts.filter((fact) => fact.metricId !== "revenue");
    const scenarios = [
      [makePeriod(2022, null, "100"), makePeriod(2024, null, "160"), makePeriod(2025, null, "200")],
      [makePeriod(2023, null, "140"), missingRevenue, makePeriod(2025, null, "200")],
    ];

    for (const annuals of scenarios) {
      const report = await buildFinancialStatementFundamentalsResearchReport(
        persistence,
        {
          subject: { kind: "listing_id", listingId: identity.listing.id },
          context: availableFinancialStatementManifest(identity).context,
        },
        {
          getResearchManifestImpl: async () => availableFinancialStatementManifest(identity) as never,
          getFinancialStatementsImpl: async (_persistence, query: ResearchFinancialStatementsQueryInput) => (
            query.periodicity === "annual"
              ? buildStatementsOutput(identity.listing.id, "annual", annuals)
              : buildStatementsOutput(identity.listing.id, "quarterly", quarters)
          ),
        },
      );

      expect(report.conclusions.find((conclusion) => conclusion.id === "multi_year_revenue_trend")).toMatchObject({
        status: "withheld",
        reasonCodes: ["insufficient_multi_year_window"],
      });
    }
  });

  it("unsupported sector fixture: withhold every conclusion explicitly", async () => {
    const persistence = new MemoryPersistence();
    const identity = makeIdentity();
    await persistence.appendResearchIdentityRecords([identity]);

    const report = await buildFinancialStatementFundamentalsResearchReport(
      persistence,
      {
        subject: { kind: "listing_id", listingId: identity.listing.id },
        context: {
          knowledgeAt: "2026-09-01T00:00:00.000Z",
          effectiveAt: "2026-09-01T00:00:00.000Z",
          assessmentMode: "effective",
        },
      },
      {
        getResearchManifestImpl: async () => ({
          contractVersion: "research-manifest/1.0.0",
          selector: { kind: "listing_id", listingId: identity.listing.id },
          context: {
            knowledgeAt: "2026-09-01T00:00:00.000Z",
            effectiveAt: "2026-09-01T00:00:00.000Z",
            assessmentMode: "effective",
          },
          eligibility: identity.eligibility,
          orchestration: { skillExposure: "enabled" as const },
          datasets: [
            { id: "research_identity", status: "available" as const },
            { id: "price_series", status: "unavailable" as const, reasonCode: "no_authoritative_price_history" },
            { id: "exchange_valuation_references", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "monthly_revenue", status: "unavailable" as const, reasonCode: "not_acquired" },
            { id: "financial_statements", status: "available" as const },
            { id: "institutional_trading", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "foreign_ownership", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "margin_and_short_balances", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "dividend_events", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "material_announcements", status: "unavailable" as const, reasonCode: "identity_only_release" },
            { id: "investor_materials", status: "unavailable" as const, reasonCode: "identity_only_release" },
          ],
        }) as never,
        getFinancialStatementsImpl: async (_persistence, financialQuery: ResearchFinancialStatementsQueryInput) => (
          financialQuery.periodicity === "annual"
            ? buildStatementsOutput(identity.listing.id, "annual", [
                makePeriod(2023, null, "140"),
                makePeriod(2024, null, "160"),
                makePeriod(2025, null, "200"),
              ], "financial_institution")
            : buildStatementsOutput(identity.listing.id, "quarterly", [
                makePeriod(2024, 1, "35"),
                makePeriod(2024, 2, "38"),
                makePeriod(2024, 3, "39"),
                makePeriod(2024, 4, "48"),
                makePeriod(2025, 1, "46"),
                makePeriod(2025, 2, "49"),
                makePeriod(2025, 3, "50"),
                makePeriod(2025, 4, "55"),
              ], "financial_institution")
        ),
      },
    );

    expect(report.conclusions).toEqual([
      expect.objectContaining({ id: "latest_revenue_yoy", status: "withheld", reasonCodes: ["unsupported_sector"] }),
      expect.objectContaining({ id: "multi_year_revenue_trend", status: "withheld", reasonCodes: ["unsupported_sector"] }),
      expect.objectContaining({ id: "quarterly_revenue_trend", status: "withheld", reasonCodes: ["unsupported_sector"] }),
    ]);
  });
});
