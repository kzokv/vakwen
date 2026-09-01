import { z } from "zod";
import type { Persistence } from "../../persistence/types.js";
import {
  MARKET_CONTEXT_SCOPE_STATEMENT,
  researchFocusedMarketReportSchema,
  researchFinancialStatementsOutputSchema,
  researchRevenueFocusedReportSchema,
  IDENTITY_ONLY_SCOPE_STATEMENT,
  researchIdentityOnlyReportSchema,
  type ResearchFocusedMarketReport,
  type ResearchFinancialStatementsOutput,
  type ResearchIdentityOnlyReport,
  type ResearchPriceSession,
  type ResearchPriceSeriesQuery,
  type ResearchQuery,
  type ResearchRevenueFocusedReport,
} from "./contracts.js";
import {
  getFinancialStatements,
  getMonthlyRevenue,
  getPriceSeries,
  getResearchIdentity,
  getResearchManifest,
  ResearchServiceError,
} from "./service.js";

function presentFactValue(
  facts: Awaited<ReturnType<typeof getResearchIdentity>>["identity"]["facts"],
  field: string,
): string | null {
  const normalized = facts.find((fact) => fact.field === field)?.normalized;
  return normalized?.state === "present" ? normalized.value : null;
}

export async function buildIdentityOnlyResearchReport(
  persistence: Persistence,
  query: ResearchQuery,
) {
  const result = await getResearchIdentity(persistence, {
    ...query,
    history: { limit: 100 },
  });
  return researchIdentityOnlyReportSchema.parse({
    contractVersion: "research-report/1.0.0" as const,
    profile: "identity_only" as const,
    selector: result.selector,
    context: result.context,
    generatedAt: result.context.knowledgeAt,
    sections: [
      {
        id: "identity" as const,
        issuer: result.identity.issuer,
        security: result.identity.security,
        listing: result.identity.listing,
        legalName: presentFactValue(result.identity.facts, "legal_name"),
        displayName: presentFactValue(result.identity.facts, "display_name"),
        industryCode: presentFactValue(result.identity.facts, "industry_code"),
      },
      {
        id: "eligibility" as const,
        ...result.identity.eligibility,
      },
      {
        id: "unsupported_scope" as const,
        reasonCode: "identity_only_release" as const,
        statement: IDENTITY_ONLY_SCOPE_STATEMENT,
      },
    ] as const,
    evidence: {
      observationIds: result.identity.facts.map((fact) => fact.id),
      provenanceIds: [...new Set(result.identity.provenance.map((item) => item.id))],
    },
  });
}

export type IdentityOnlyResearchReport = ResearchIdentityOnlyReport;
export type FocusedMarketResearchReport = ResearchFocusedMarketReport;
export type RevenueFocusedResearchReport = ResearchRevenueFocusedReport;

const FUNDAMENTALS_MINIMUM_WINDOWS = {
  latestYearOverYear: "latest_due_plus_prior_year_comparable",
  multiYearTrendAnnualPeriods: 3,
  quarterlyTrendDiscreteQuarters: 8,
} as const;

const financialConclusionSchema = z.object({
  id: z.enum(["latest_revenue_yoy", "multi_year_revenue_trend", "quarterly_revenue_trend"]),
  status: z.enum(["supported", "withheld"]),
  statement: z.string(),
  reasonCodes: z.array(z.string()),
}).strict();

const financialFundamentalsReportSchema = z.object({
  contractVersion: z.literal("research-report/3.0.0"),
  profile: z.literal("financial_statement_fundamentals"),
  selector: z.object({ kind: z.literal("listing_id"), listingId: z.string() }).strict(),
  context: z.object({
    knowledgeAt: z.string().datetime({ offset: true }),
    effectiveAt: z.string().datetime({ offset: true }),
    assessmentMode: z.enum(["effective", "as_recorded", "re_evaluate"]),
    policySetVersion: z.string().optional(),
  }).strict(),
  generatedAt: z.string().datetime({ offset: true }),
  sections: z.array(z.object({
    id: z.string(),
  }).passthrough()).length(3),
  conclusions: z.array(financialConclusionSchema).length(3),
  evidence: z.object({
    provenanceIds: z.array(z.string()),
  }).strict(),
}).strict();

export type FinancialStatementFundamentalsResearchReport = z.infer<typeof financialFundamentalsReportSchema>;
type FinancialStatementsReader = typeof getFinancialStatements;

interface FinancialReportDeps {
  getResearchManifestImpl?: typeof getResearchManifest;
  getResearchIdentityImpl?: typeof getResearchIdentity;
  getFinancialStatementsImpl?: FinancialStatementsReader;
}

function markdownValue(value: string | null): string {
  return value === null ? "Not reported" : value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

export function renderIdentityOnlyResearchReportMarkdown(input: IdentityOnlyResearchReport): string {
  const report = researchIdentityOnlyReportSchema.parse(input);
  const [identity, eligibility, unsupported] = report.sections;
  return [
    `# Taiwan Identity Research: ${markdownValue(identity.displayName)}`,
    "",
    `- Listing: ${identity.listing.venue}:${identity.listing.ticker}`,
    `- Listing ID: ${identity.listing.id}`,
    `- Legal name: ${markdownValue(identity.legalName)}`,
    `- Security type: ${identity.security.type}`,
    `- Industry code: ${markdownValue(identity.industryCode)}`,
    `- Eligibility: ${eligibility.state} (${eligibility.profile}; ${eligibility.reasonCode})`,
    `- Effective at: ${report.context.effectiveAt}`,
    `- Knowledge at: ${report.context.knowledgeAt}`,
    "",
    "## Scope",
    "",
    unsupported.statement,
    "",
    "## Provenance",
    "",
    ...report.evidence.provenanceIds.map((id) => `- ${id}`),
  ].join("\n");
}

export async function buildFocusedMarketResearchReport(
  persistence: Persistence,
  query: ResearchPriceSeriesQuery,
) {
  const manifest = await getResearchManifest(persistence, {
    subject: query.subject,
    context: query.context,
  });
  const priceSeriesDataset = manifest.datasets.find((dataset) => dataset.id === "price_series")!;
  if (priceSeriesDataset.status !== "available") {
    throw new ResearchServiceError(
      "research_dataset_unavailable",
      "Focused market research requires an available authoritative price series",
      { datasetId: "price_series", reasonCode: priceSeriesDataset.reasonCode },
    );
  }
  const frozenQuery = {
    ...query,
    subject: manifest.selector,
    context: manifest.context,
  };
  const priceSeries = await getPriceSeries(persistence, frozenQuery);
  const identity = await getResearchIdentity(persistence, {
    subject: manifest.selector,
    context: manifest.context,
    history: { limit: 1 },
  });
  const provenanceIds = [...new Set([
    ...identity.identity.provenance.map((item) => item.id),
    ...priceSeries.sessions
      .flatMap((session: ResearchPriceSession) => ("provenance" in session ? [session.provenance.provenanceId] : [])),
    ...priceSeries.metrics.flatMap((metric) => metric.status === "returned" ? metric.provenanceIds : []),
  ])];
  return researchFocusedMarketReportSchema.parse({
    contractVersion: "research-report/1.0.0" as const,
    profile: "focused_market" as const,
    selector: priceSeries.selector,
    context: priceSeries.context,
    generatedAt: priceSeries.context.knowledgeAt,
    sections: [
      {
        id: "identity" as const,
        issuer: identity.identity.issuer,
        security: identity.identity.security,
        listing: identity.identity.listing,
        displayName: presentFactValue(identity.identity.facts, "display_name"),
      },
      {
        id: "market_context" as const,
        statement: MARKET_CONTEXT_SCOPE_STATEMENT,
        priceSeries,
        indicativePricesExcluded: true as const,
        intradayPricesExcluded: true as const,
        technicalSignalsExcluded: true as const,
      },
    ] as const,
    evidence: {
      provenanceIds,
      sessionDates: priceSeries.sessions.map((session) => session.sessionDate),
    },
  });
}

export function renderFocusedMarketResearchReportMarkdown(input: FocusedMarketResearchReport): string {
  const report = researchFocusedMarketReportSchema.parse(input);
  const [identity, marketContext] = report.sections;
  return [
    `# Taiwan Market Research: ${markdownValue(identity.displayName)}`,
    "",
    `- Listing: ${identity.listing.venue}:${identity.listing.ticker}`,
    `- Listing ID: ${identity.listing.id}`,
    `- Effective at: ${report.context.effectiveAt}`,
    `- Knowledge at: ${report.context.knowledgeAt}`,
    "",
    "## Market Context",
    "",
    marketContext.statement,
    "",
    ...marketContext.priceSeries.sessions.map((session: ResearchPriceSession) => {
      if (session.state === "settled_full_bar") {
        return `- Session ${session.sessionDate}: settled_full_bar close ${session.prices.close}`;
      }
      if (session.state === "settled_close_only") {
        return `- Session ${session.sessionDate}: settled_close_only close ${session.prices.close}`;
      }
      if (session.state === "no_trade") {
        return `- Session ${session.sessionDate}: no_trade close ${session.prices.close ?? "not reported"}`;
      }
      if (session.state === "suspended") {
        return `- Session ${session.sessionDate}: suspended`;
      }
      if (session.state === "corporate_action_incomplete") {
        return `- Session ${session.sessionDate}: corporate_action_incomplete`;
      }
      if (session.state === "stale") {
        return `- Session ${session.sessionDate}: stale`;
      }
      return `- Session ${session.sessionDate}: missing`;
    }),
    "",
    "## Provenance",
    "",
    ...report.evidence.provenanceIds.map((id) => `- ${id}`),
  ].join("\n");
}

function periodLabel(period: ResearchFinancialStatementsOutput["periods"][number]): "annual" | "q1" | "q2" | "q3" | "q4" {
  switch (period.fiscalQuarter) {
    case null:
      return "annual";
    case 1:
      return "q1";
    case 2:
      return "q2";
    case 3:
      return "q3";
    case 4:
      return "q4";
  }
  throw new Error(`Unsupported fiscal quarter: ${String(period.fiscalQuarter)}`);
}

function factMatchesSelectedBasis(
  fact: ResearchFinancialStatementsOutput["periods"][number]["sourceFacts"][number],
): boolean {
  return Object.entries(fact.dimensions).every(([dimension, member]) => {
    if (!/statementbasis|consolidated|separate|individual/i.test(`${dimension}:${member}`)) return false;
    if (fact.filingBasis.normalized.state !== "present") return false;
    return fact.filingBasis.normalized.value === "consolidated"
      ? /consolidated/i.test(member) && !/separate|individual/i.test(member)
      : /separate|individual/i.test(member) && !/consolidated/i.test(member);
  });
}

function findFact(
  period: ResearchFinancialStatementsOutput["periods"][number],
  metricId: string,
): ResearchFinancialStatementsOutput["periods"][number]["sourceFacts"][number] | undefined {
  const expectedStartDate = period.fiscalQuarter === null
    ? `${period.fiscalYear}-01-01`
    : `${period.fiscalYear}-${String(((period.fiscalQuarter - 1) * 3) + 1).padStart(2, "0")}-01`;
  return period.sourceFacts.find((fact) => (
    fact.metricId === metricId
    && factMatchesSelectedBasis(fact)
    && fact.period.endDate === period.periodEndDate
    && (fact.period.startDate === null || fact.period.startDate === expectedStartDate)
  ));
}

function numericFact(period: ResearchFinancialStatementsOutput["periods"][number], metricId: string): number | null {
  const fact = findFact(period, metricId);
  if (!fact) return null;
  if (fact.value.state !== "present") return null;
  const value = Number(fact.value.value);
  return Number.isFinite(value) ? value : null;
}

function quarterlyRevenueObservation(
  period: ResearchFinancialStatementsOutput["periods"][number],
  periods: readonly ResearchFinancialStatementsOutput["periods"][number][],
): { value: number; unit: string } | null {
  const direct = findFact(period, "revenue");
  if (direct?.value.state === "present" && direct.unit.normalized.state === "present") {
    const value = Number(direct.value.value);
    return Number.isFinite(value) ? { value, unit: direct.unit.normalized.value } : null;
  }
  if (period.fiscalQuarter !== 4) return null;
  const cumulative = period.sourceFacts.find((fact) => (
    fact.metricId === "revenue"
    && factMatchesSelectedBasis(fact)
    && fact.period.startDate === `${period.fiscalYear}-01-01`
    && fact.period.endDate === period.periodEndDate
    && fact.value.state === "present"
    && fact.unit.normalized.state === "present"
  ));
  const thirdQuarter = periods.find((candidate) => candidate.fiscalYear === period.fiscalYear && candidate.fiscalQuarter === 3);
  const priorCumulative = thirdQuarter?.sourceFacts.find((fact) => (
    fact.metricId === "revenue"
    && factMatchesSelectedBasis(fact)
    && fact.period.startDate === `${period.fiscalYear}-01-01`
    && fact.period.endDate === thirdQuarter.periodEndDate
    && fact.value.state === "present"
    && fact.unit.normalized.state === "present"
  ));
  if (
    cumulative?.value.state !== "present"
    || cumulative.unit.normalized.state !== "present"
    || priorCumulative?.value.state !== "present"
    || priorCumulative.unit.normalized.state !== "present"
    || cumulative.unit.normalized.value !== priorCumulative.unit.normalized.value
  ) return null;
  const value = Number(cumulative.value.value) - Number(priorCumulative.value.value);
  return Number.isFinite(value) ? { value, unit: cumulative.unit.normalized.value } : null;
}

function formatPercent(value: number): string {
  return `${value.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function quarterSortValue(period: ResearchFinancialStatementsOutput["periods"][number]): number {
  const quarter = period.fiscalQuarter ?? 4;
  return (period.fiscalYear * 10) + quarter;
}

function periodHasRequiredStatements(period: ResearchFinancialStatementsOutput["periods"][number]): boolean {
  const roles = new Set(period.statements);
  return roles.has("balance_sheet") && roles.has("income") && roles.has("cash_flow");
}

function firstAmbiguityReason(periods: readonly ResearchFinancialStatementsOutput["periods"][number][]): string | null {
  const revenueFacts = periods
    .map((period) => findFact(period, "revenue"))
    .filter((fact): fact is NonNullable<typeof fact> => fact !== undefined);
  if (revenueFacts.some((fact) => fact.unit.normalized.state === "missing")) return "unknown_unit";
  if (periods.some((period) => period.quality.ambiguousBasis.status === "present")) return "basis_ambiguity";
  if (periods.some((period) => period.quality.taxonomyChanges.status === "present")) return "taxonomy_ambiguity";
  if (revenueFacts.some((fact) => fact.ambiguity.status === "duplicate_context")) return "context_ambiguity";
  if (periods.some((period) => !periodHasRequiredStatements(period))) return "missing_required_statement";
  return null;
}

function buildSupportedOrWithheldConclusions(
  annuals: readonly ResearchFinancialStatementsOutput["periods"][number][],
  quarters: readonly ResearchFinancialStatementsOutput["periods"][number][],
  annualFreshness: ResearchFinancialStatementsOutput["freshness"]["state"],
) {
  const orderedAnnuals = [...annuals].sort((left, right) => left.fiscalYear - right.fiscalYear);
  const orderedQuarters = [...quarters].sort((left, right) => quarterSortValue(left) - quarterSortValue(right));
  const annualReason = firstAmbiguityReason(orderedAnnuals);
  const quarterlyReason = firstAmbiguityReason(orderedQuarters);
  const latestAnnual = orderedAnnuals.at(-1);
  const priorAnnual = latestAnnual
    ? orderedAnnuals.find((period) => period.fiscalYear === latestAnnual.fiscalYear - 1)
    : undefined;
  const latestAnnualRevenue = latestAnnual ? numericFact(latestAnnual, "revenue") : null;
  const priorAnnualRevenue = priorAnnual ? numericFact(priorAnnual, "revenue") : null;
  const latestAnnualRevenueFact = latestAnnual ? findFact(latestAnnual, "revenue") : undefined;
  const priorAnnualRevenueFact = priorAnnual ? findFact(priorAnnual, "revenue") : undefined;
  const annualRevenueUnitsMatch = latestAnnualRevenueFact?.unit.normalized.state === "present"
    && priorAnnualRevenueFact?.unit.normalized.state === "present"
    && latestAnnualRevenueFact.unit.normalized.value === priorAnnualRevenueFact.unit.normalized.value;
  const yoyConclusion = !annualReason && annualFreshness !== "stale" && annualRevenueUnitsMatch && latestAnnual && priorAnnual && latestAnnualRevenue !== null && priorAnnualRevenue !== null && priorAnnualRevenue !== 0
    ? {
        id: "latest_revenue_yoy" as const,
        status: "supported" as const,
        statement: `Latest due annual revenue for ${latestAnnual.fiscalYear} changed ${formatPercent(((latestAnnualRevenue - priorAnnualRevenue) / priorAnnualRevenue) * 100)} from ${priorAnnual.fiscalYear}.`,
        reasonCodes: [],
      }
    : {
        id: "latest_revenue_yoy" as const,
        status: "withheld" as const,
        statement: "Latest due year-over-year financial statement conclusion is withheld.",
        reasonCodes: [annualReason ?? (annualFreshness === "stale" ? "stale_financial_statements" : "insufficient_yoy_window")],
      };
  const annualYearsAreConsecutive = orderedAnnuals.every((period, index) => (
    index === 0 || period.fiscalYear === orderedAnnuals[index - 1]!.fiscalYear + 1
  ));
  const annualRevenueUnits = orderedAnnuals.map((period) => {
    const fact = findFact(period, "revenue");
    return numericFact(period, "revenue") !== null && fact?.unit.normalized.state === "present"
      ? fact.unit.normalized.value
      : null;
  });
  const annualRevenueIsComparable = annualRevenueUnits.every((unit): unit is string => unit !== null)
    && new Set(annualRevenueUnits).size === 1;
  const multiYearConclusion = orderedAnnuals.length >= FUNDAMENTALS_MINIMUM_WINDOWS.multiYearTrendAnnualPeriods
    && !annualReason
    && annualYearsAreConsecutive
    && annualRevenueIsComparable
    ? {
        id: "multi_year_revenue_trend" as const,
        status: "supported" as const,
        statement: `Multi-year annual revenue trend covers ${orderedAnnuals.length} complete periods through ${orderedAnnuals.at(-1)!.fiscalYear}.`,
        reasonCodes: [],
      }
    : {
        id: "multi_year_revenue_trend" as const,
        status: "withheld" as const,
        statement: "Multi-year financial statement trend is withheld.",
        reasonCodes: [annualReason ?? "insufficient_multi_year_window"],
      };
  const quartersAreConsecutive = orderedQuarters.every((period, index) => {
    if (index === 0) return true;
    const prior = orderedQuarters[index - 1]!;
    return ((period.fiscalYear * 4) + period.fiscalQuarter!) === ((prior.fiscalYear * 4) + prior.fiscalQuarter! + 1);
  });
  const quarterlyRevenueUnits = orderedQuarters.map((period) => {
    return quarterlyRevenueObservation(period, orderedQuarters)?.unit ?? null;
  });
  const quarterlyRevenueIsComparable = quarterlyRevenueUnits.every((unit): unit is string => unit !== null)
    && new Set(quarterlyRevenueUnits).size === 1;
  const quarterlyConclusion = orderedQuarters.length >= FUNDAMENTALS_MINIMUM_WINDOWS.quarterlyTrendDiscreteQuarters
    && !quarterlyReason
    && quartersAreConsecutive
    && quarterlyRevenueIsComparable
    ? {
        id: "quarterly_revenue_trend" as const,
        status: "supported" as const,
        statement: `Quarterly revenue trend covers ${orderedQuarters.length} comparable discrete quarters through ${orderedQuarters.at(-1)!.fiscalYear}-${periodLabel(orderedQuarters.at(-1)!).toUpperCase()}.`,
        reasonCodes: [],
      }
    : {
        id: "quarterly_revenue_trend" as const,
        status: "withheld" as const,
        statement: "Quarterly financial statement trend is withheld.",
        reasonCodes: [quarterlyReason ?? "insufficient_quarterly_window"],
      };
  return [yoyConclusion, multiYearConclusion, quarterlyConclusion];
}

export async function buildFinancialStatementFundamentalsResearchReport(
  persistence: Persistence,
  query: ResearchQuery,
  deps: FinancialReportDeps = {},
) {
  const getManifest = deps.getResearchManifestImpl ?? getResearchManifest;
  const getIdentity = deps.getResearchIdentityImpl ?? getResearchIdentity;
  const getFinancialStatementsImpl: FinancialStatementsReader = deps.getFinancialStatementsImpl
    ?? getFinancialStatements;
  const manifest = await getManifest(persistence, query);
  const identity = await getIdentity(persistence, {
    subject: manifest.selector,
    context: manifest.context,
    history: { limit: 1 },
  });
  const dataset = manifest.datasets.find((item) => item.id === "financial_statements");
  if (dataset?.status !== "available") {
    throw new ResearchServiceError(
      "research_dataset_unavailable",
      "Financial statement fundamentals require available canonical financial statements",
      { datasetId: "financial_statements", reasonCode: dataset?.reasonCode ?? "not_available" },
    );
  }
  const annualStatements = researchFinancialStatementsOutputSchema.parse(await getFinancialStatementsImpl(persistence, {
    subject: manifest.selector,
    context: manifest.context,
    periodicity: "annual",
    range: { kind: "latest_periods", count: 3 },
    filingBasis: "policy_selected",
    statements: ["income", "balance_sheet", "cash_flow"],
    metricSelection: { base: "required_core", groups: [], explicitMetricIds: [] },
    derivedMetrics: [],
    page: { limit: 3, order: "desc" },
  }));
  const quarterlyStatements = researchFinancialStatementsOutputSchema.parse(await getFinancialStatementsImpl(persistence, {
    subject: manifest.selector,
    context: manifest.context,
    periodicity: "quarterly",
    range: { kind: "latest_periods", count: 8 },
    filingBasis: "policy_selected",
    statements: ["income", "balance_sheet", "cash_flow"],
    metricSelection: { base: "required_core", groups: [], explicitMetricIds: [] },
    derivedMetrics: [],
    page: { limit: 8, order: "desc" },
  }));
  const unsupportedSector = annualStatements.identity.issuer.classification !== "operating_company";
  const conclusions = unsupportedSector
    ? [
        {
          id: "latest_revenue_yoy" as const,
          status: "withheld" as const,
          statement: "Latest due year-over-year financial statement conclusion is withheld.",
          reasonCodes: ["unsupported_sector"],
        },
        {
          id: "multi_year_revenue_trend" as const,
          status: "withheld" as const,
          statement: "Multi-year financial statement trend is withheld.",
          reasonCodes: ["unsupported_sector"],
        },
        {
          id: "quarterly_revenue_trend" as const,
          status: "withheld" as const,
          statement: "Quarterly financial statement trend is withheld.",
          reasonCodes: ["unsupported_sector"],
        },
      ]
    : buildSupportedOrWithheldConclusions(annualStatements.periods, quarterlyStatements.periods, annualStatements.freshness.state);
  const evidenceProvenanceIds = [...new Set([
    ...annualStatements.provenanceIndex.map((item) => item.provenanceId),
    ...quarterlyStatements.provenanceIndex.map((item) => item.provenanceId),
  ])];
  return financialFundamentalsReportSchema.parse({
    contractVersion: "research-report/3.0.0" as const,
    profile: "financial_statement_fundamentals" as const,
    selector: manifest.selector,
    context: manifest.context,
    generatedAt: manifest.context.knowledgeAt,
    sections: [
      {
        id: "identity",
        issuer: identity.identity.issuer,
        security: identity.identity.security,
        listing: identity.identity.listing,
        displayName: presentFactValue(identity.identity.facts, "display_name"),
      },
      {
        id: "minimum_windows",
        windows: FUNDAMENTALS_MINIMUM_WINDOWS,
      },
      {
        id: "independent_facts",
        sector: annualStatements.identity.issuer.classification,
        periods: [...annualStatements.periods, ...quarterlyStatements.periods].map((period) => ({
          fiscalYear: period.fiscalYear,
          fiscalPeriod: periodLabel(period),
          basis: period.filingBasis,
          taxonomyVersion: period.sourceFacts[0]?.taxonomy.taxonomyVersion ?? null,
          requiredStatementsPresent: periodHasRequiredStatements(period),
          issues: {
            basisAmbiguity: period.quality.ambiguousBasis.status === "present",
            taxonomyAmbiguity: period.quality.taxonomyChanges.status === "present",
            contextAmbiguity: period.quality.duplicateContexts.status === "present",
            unknownUnitIds: period.sourceFacts
              .filter((fact) => fact.unit.normalized.state === "missing")
              .map((fact) => fact.unit.raw ?? "unknown"),
          },
          facts: period.sourceFacts.filter((fact) =>
            ["revenue", "net_income", "assets", "operating_cash_flow"].includes(fact.metricId)
          ),
        })),
      },
    ],
    conclusions,
    evidence: {
      provenanceIds: evidenceProvenanceIds,
    },
  });
}

export function renderFinancialStatementFundamentalsResearchReportMarkdown(
  input: FinancialStatementFundamentalsResearchReport,
): string {
  const report = financialFundamentalsReportSchema.parse(input);
  const [identity, windows, facts] = report.sections as Array<Record<string, unknown>>;
  const listing = identity.listing as { venue: string; ticker: string; id: string };
  const displayName = identity.displayName as string | null;
  const periods = (facts.periods as Array<Record<string, unknown>>);
  return [
    `# Taiwan Financial Statement Fundamentals: ${markdownValue(displayName ?? `${listing.venue}:${listing.ticker}`)}`,
    "",
    `- Listing: ${listing.venue}:${listing.ticker}`,
    `- Listing ID: ${listing.id}`,
    `- Effective at: ${report.context.effectiveAt}`,
    `- Knowledge at: ${report.context.knowledgeAt}`,
    "",
    "## Minimum Windows",
    "",
    `- YoY: ${String((windows.windows as Record<string, unknown>).latestYearOverYear)}`,
    `- Multi-year annual periods: ${String((windows.windows as Record<string, unknown>).multiYearTrendAnnualPeriods)}`,
    `- Quarterly discrete quarters: ${String((windows.windows as Record<string, unknown>).quarterlyTrendDiscreteQuarters)}`,
    "",
    "## Conclusions",
    "",
    ...report.conclusions.flatMap((conclusion) => [
      `- ${conclusion.id}: ${conclusion.status}`,
      `  ${conclusion.statement}`,
      ...(conclusion.reasonCodes.length > 0 ? [`  Reasons: ${conclusion.reasonCodes.join(", ")}`] : []),
    ]),
    "",
    "## Independent Facts",
    "",
    ...periods.map((period) =>
      `- ${String(period.fiscalYear)} ${String(period.fiscalPeriod).toUpperCase()} basis=${String(period.basis)} taxonomy=${String(period.taxonomyVersion)}`
    ),
    "",
    "## Provenance",
    "",
    ...report.evidence.provenanceIds.map((id) => `- ${id}`),
  ].join("\n");
}

export async function buildRevenueFocusedResearchReport(
  persistence: Persistence,
  query: ResearchQuery,
) {
  const manifest = await getResearchManifest(persistence, query);
  const monthlyRevenueDataset = manifest.datasets.find((dataset) => dataset.id === "monthly_revenue")!;
  if (monthlyRevenueDataset.status !== "available") {
    throw new ResearchServiceError(
      "research_dataset_unavailable",
      "Monthly-revenue research requires available canonical monthly revenue",
      { datasetId: "monthly_revenue", reasonCode: monthlyRevenueDataset.reasonCode },
    );
  }
  const frozenQuery = {
    subject: manifest.selector,
    context: manifest.context,
  };
  const identity = await getResearchIdentity(persistence, {
    ...frozenQuery,
    history: { limit: 1 },
  });
  const monthlyRevenue = await getMonthlyRevenue(persistence, {
    ...frozenQuery,
    page: { limit: 24, order: "desc" },
  });
  const latestItem = monthlyRevenue.items[0] ?? null;
  const latestYoy = latestItem?.derivedMetrics.yearOverYearPercent;
  return researchRevenueFocusedReportSchema.parse({
    contractVersion: "research-report/2.0.0" as const,
    profile: "monthly_revenue" as const,
    selector: identity.selector,
    context: identity.context,
    generatedAt: identity.context.knowledgeAt,
    sections: [
      {
        id: "identity" as const,
        issuer: identity.identity.issuer,
        security: identity.identity.security,
        listing: identity.identity.listing,
        displayName: presentFactValue(identity.identity.facts, "display_name"),
      },
      {
        id: "eligibility" as const,
        profile: identity.identity.eligibility.profile,
        state: identity.identity.eligibility.state,
        reasonCode: identity.identity.eligibility.reasonCode,
      },
      {
        id: "monthly_revenue" as const,
        freshness: monthlyRevenue.freshness,
        latestMonth: latestItem?.revenueMonth ?? null,
        latestRecord: latestItem,
        latestYearOverYearPercent: latestYoy ?? null,
      },
    ],
    conclusion: monthlyRevenue.conclusion,
    evidence: {
      provenanceIds: [...new Set([
        ...identity.identity.provenance.map((item) => item.id),
        ...monthlyRevenue.evidence.provenanceIds,
      ])],
    },
  });
}
