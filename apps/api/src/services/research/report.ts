import type { Persistence } from "../../persistence/types.js";
import {
  MARKET_CONTEXT_SCOPE_STATEMENT,
  researchFocusedMarketReportSchema,
  researchRevenueFocusedReportSchema,
  IDENTITY_ONLY_SCOPE_STATEMENT,
  researchIdentityOnlyReportSchema,
  type ResearchFocusedMarketReport,
  type ResearchIdentityOnlyReport,
  type ResearchPriceSession,
  type ResearchPriceSeriesQuery,
  type ResearchQuery,
  type ResearchRevenueFocusedReport,
} from "./contracts.js";
import { getMonthlyRevenue, getPriceSeries, getResearchIdentity, getResearchManifest, ResearchServiceError } from "./service.js";

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
  const latestDueGap = monthlyRevenue.freshness.latestDueStatus === "missing";
  const supported = latestItem !== null
    && latestYoy?.status === "available"
    && !latestDueGap;
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
        latestYearOverYearPercent: latestYoy ?? null,
      },
    ],
    conclusion: supported
      ? {
          status: "supported" as const,
          statement: `Monthly revenue trend remains descriptive only: latest available month ${latestItem!.revenueMonth} shows YoY ${latestYoy.value}% with authoritative MOPS lineage.`,
          reasonCodes: [],
        }
      : {
          status: "withheld" as const,
          statement: latestDueGap
            ? `Monthly revenue conclusion withheld because the latest due month ${monthlyRevenue.freshness.latestExpectedMonth} is not yet present in the canonical store.`
            : `Monthly revenue conclusion withheld because the current window does not pass the required comparability gates.`,
          reasonCodes: latestDueGap
            ? ["latest_due_gap"]
            : [
                ...(latestYoy?.status === "withheld" ? [latestYoy.reasonCode] : latestItem === null ? ["not_acquired"] : []),
              ],
        },
    evidence: {
      provenanceIds: [...new Set([
        ...identity.identity.provenance.map((item) => item.id),
        ...monthlyRevenue.evidence.provenanceIds,
      ])],
    },
  });
}
