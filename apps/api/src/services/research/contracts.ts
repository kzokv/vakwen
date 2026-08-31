import { z } from "zod";

const taiwanTickerSchema = z
  .string()
  .min(1)
  .max(32)
  .regex(/^[0-9A-Za-z]+$/, "Ticker must contain only ASCII letters and digits");

export const researchSubjectSelectorSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("listing_id"),
    listingId: z.string().min(1).max(120).regex(/^[0-9A-Za-z_-]+$/),
  }).strict(),
  z.object({
    kind: z.literal("ticker_venue"),
    ticker: taiwanTickerSchema,
    listingVenue: z.enum(["TWSE", "TPEX"]),
  }).strict(),
]);

const temporalContextInputSchema = z.object({
  knowledgeAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }).optional(),
  assessmentMode: z.enum(["effective", "as_recorded", "re_evaluate"]).default("effective"),
  policySetVersion: z.string().min(1).max(120).optional(),
}).strict();

export const researchTemporalContextSchema = temporalContextInputSchema
  .superRefine((context, refinement) => {
    const effectiveAt = context.effectiveAt ?? context.knowledgeAt;
    if (Date.parse(effectiveAt) > Date.parse(context.knowledgeAt)) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveAt"],
        message: "effectiveAt must be no later than knowledgeAt",
      });
    }
    if (context.assessmentMode === "re_evaluate" && !context.policySetVersion) {
      refinement.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["policySetVersion"],
        message: "policySetVersion is required when assessmentMode is re_evaluate",
      });
    }
  })
  .transform((context) => ({
    assessmentMode: context.assessmentMode,
    effectiveAt: new Date(context.effectiveAt ?? context.knowledgeAt).toISOString(),
    knowledgeAt: new Date(context.knowledgeAt).toISOString(),
    ...(context.policySetVersion ? { policySetVersion: context.policySetVersion } : {}),
  }));

export const researchQuerySchema = z.object({
  subject: researchSubjectSelectorSchema,
  context: researchTemporalContextSchema,
}).strict();

export const researchHistoryPageSchema = z.object({
  cursor: z.string().min(1).max(512).optional(),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export const researchIdentityQuerySchema = researchQuerySchema.extend({
  history: researchHistoryPageSchema.default({ limit: 25 }),
}).strict();

const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Date must be a valid calendar date");
const researchPriceSeriesPageSchema = z.object({
  cursor: z.string().min(1).max(1024).optional(),
  limit: z.number().int().min(1).max(260).default(60),
}).strict();
const researchPriceSeriesScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("latest") }).strict(),
  z.object({
    kind: z.literal("latest_sessions"),
    count: z.number().int().min(1).max(260),
  }).strict(),
  z.object({
    kind: z.literal("date_range"),
    startDate: isoDateSchema,
    endDate: isoDateSchema,
  }).strict(),
]).superRefine((scope, refinement) => {
  if (scope.kind !== "date_range") return;
  if (scope.startDate > scope.endDate) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "endDate must be on or after startDate",
    });
  }
  const spanDays = Math.floor(
    (Date.parse(`${scope.endDate}T00:00:00.000Z`) - Date.parse(`${scope.startDate}T00:00:00.000Z`)) / 86_400_000,
  );
  if (spanDays > 366 * 5) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["endDate"],
      message: "date ranges must be no wider than five years",
    });
  }
});
const researchMetricSchema = z.object({
  id: z.enum([
    "simple_price_return",
    "total_shareholder_return",
    "annualized_realized_volatility",
    "maximum_drawdown",
    "average_daily_volume",
    "average_daily_traded_value",
  ]),
  windowSessions: z.number().int().min(1).max(1260).optional(),
}).strict();
export const researchPriceSeriesQuerySchema = researchQuerySchema.extend({
  scope: researchPriceSeriesScopeSchema.default({ kind: "latest" }),
  basis: z.enum(["raw", "corporate_action_adjusted"]).default("raw"),
  order: z.enum(["asc", "desc"]).default("desc"),
  page: researchPriceSeriesPageSchema.default({ limit: 60 }),
  metrics: z.array(researchMetricSchema).max(6).default([]),
}).strict();

const canonicalIdSchema = z.string().min(1).max(120).regex(/^[0-9A-Za-z_-]+$/);
const fixedResearchContextSchema = z.object({
  knowledgeAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }),
  assessmentMode: z.enum(["effective", "as_recorded", "re_evaluate"]),
  policySetVersion: z.string().min(1).max(120).optional(),
}).strict();
const immutableListingSelectorSchema = z.object({
  kind: z.literal("listing_id"),
  listingId: canonicalIdSchema,
}).strict();
const missingReasonSchema = z.enum(["not_reported", "unparseable"]);
const isoMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const canonicalObservationSchema = z.object({
  id: canonicalIdSchema,
  kind: z.literal("source_fact"),
  subject: z.object({
    kind: z.enum(["issuer", "security", "listing"]),
    id: canonicalIdSchema,
  }).strict(),
  field: z.string().min(1).max(120),
  raw: z.discriminatedUnion("state", [
    z.object({ state: z.literal("present"), label: z.string(), value: z.string() }).strict(),
    z.object({ state: z.literal("missing"), label: z.string(), reason: z.literal("not_reported") }).strict(),
  ]),
  normalized: z.discriminatedUnion("state", [
    z.object({ state: z.literal("present"), value: z.string() }).strict(),
    z.object({ state: z.literal("missing"), reason: missingReasonSchema }).strict(),
  ]),
  effectiveAt: z.string().datetime({ offset: true }),
  publishedAt: z.object({ state: z.literal("missing"), reason: z.literal("unknown") }).strict(),
  retrievedAt: z.string().datetime({ offset: true }),
  processedAt: z.string().datetime({ offset: true }),
  provenanceId: canonicalIdSchema,
  contractVersion: z.literal("research-observation/1.0.0"),
  normalizationVersion: z.literal("identity-normalization/1.0.0"),
}).strict();
const eligibilitySchema = z.object({
  profile: z.enum(["operating_company", "etf_limited", "identity_only", "unknown"]),
  state: z.enum(["eligible", "ineligible", "indeterminate"]),
  reasonCode: z.string().min(1).max(120),
}).strict();
const issuerSchema = z.object({
  id: canonicalIdSchema,
  classification: z.enum(["operating_company", "investment_fund", "financial_institution", "unknown"]),
}).strict();
const securitySchema = z.object({
  id: canonicalIdSchema,
  issuerId: canonicalIdSchema,
  type: z.enum(["common_equity", "etf", "etn", "unknown"]),
  rights: z.enum(["common_shares", "fund_units", "senior_unsecured_note", "unknown"]),
}).strict();
const listingSchema = z.object({
  id: canonicalIdSchema,
  securityId: canonicalIdSchema,
  venue: z.enum(["TWSE", "TPEX"]),
  ticker: taiwanTickerSchema,
  listedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  status: z.enum(["active", "inactive"]),
  predecessorListingId: canonicalIdSchema.optional(),
  inactiveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
}).strict();
const provenanceSchema = z.object({
  id: canonicalIdSchema,
  publisher: z.enum(["TWSE", "TPEX"]),
  accessProvider: z.enum(["TWSE_OPENAPI", "TPEX_OPENAPI", "TWSE_WEB_JSON", "TPEX_WEB_JSON"]),
  authorityRole: z.literal("authoritative"),
  canonicalDatasetId: z.literal("research_identity"),
  publisherDataset: z.string().min(1),
  sourceUrl: z.string().url(),
  contentHash: z.string().min(1),
  acquisitionPath: z.literal("scheduled_official_snapshot"),
  acquisitionRunId: z.string().min(1).max(200),
  retrievedAt: z.string().datetime({ offset: true }),
  parserVersion: z.literal("research-identity-parser/1.0.0"),
  usagePolicyVersion: z.literal("taiwan-open-data/1.0.0"),
  retentionStatus: z.literal("retained"),
  contentExposure: z.literal("allowed"),
}).strict();
const identityRecordSchema = z.object({
  issuer: issuerSchema,
  security: securitySchema,
  listing: listingSchema,
  eligibility: eligibilitySchema,
  observations: z.array(canonicalObservationSchema),
  provenance: provenanceSchema,
}).strict();

export const researchIdentityOutputSchema = z.object({
  contractVersion: z.literal("research-identity/1.0.0"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  identity: z.object({
    issuer: issuerSchema,
    security: securitySchema,
    listing: listingSchema,
    eligibility: eligibilitySchema,
    facts: z.array(canonicalObservationSchema),
    provenance: z.array(provenanceSchema),
  }).strict(),
  history: z.object({
    items: z.array(identityRecordSchema),
    nextCursor: z.string().nullable(),
  }).strict(),
}).strict();

export const researchManifestOutputSchema = z.object({
  contractVersion: z.literal("research-manifest/1.0.0"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  eligibility: eligibilitySchema,
  orchestration: z.object({
    skillExposure: z.enum(["enabled", "disabled"]),
  }).strict(),
  datasets: z.array(z.object({
    id: z.enum([
      "research_identity",
      "price_series",
      "exchange_valuation_references",
      "monthly_revenue",
      "financial_statements",
      "institutional_trading",
      "foreign_ownership",
      "margin_and_short_balances",
      "dividend_events",
      "material_announcements",
      "investor_materials",
    ]),
    status: z.enum(["available", "unavailable"]),
    reasonCode: z.string().min(1).max(120).optional(),
    capabilities: z.object({
      scopeKinds: z.array(z.enum(["latest", "latest_sessions", "date_range"])).min(1),
      basis: z.array(z.enum(["raw", "corporate_action_adjusted"])).min(1),
      metrics: z.array(researchMetricSchema.shape.id).min(1),
      pageDefault: z.number().int().min(1).max(260),
      pageMax: z.number().int().min(1).max(260),
      maxWindowSessions: z.number().int().min(1).max(1260),
      maxSpanYears: z.number().int().min(1).max(5),
    }).optional(),
  }).strict()).length(11),
}).strict();

const researchPriceProvenanceSchema = z.object({
  provenanceId: canonicalIdSchema,
  publisher: z.enum(["TWSE", "TPEX"]),
  accessProvider: z.enum(["TWSE_OPENAPI", "TPEX_OPENAPI", "TWSE_WEB_JSON", "TPEX_WEB_JSON"]),
  sourceUrl: z.string().url(),
  contentHash: z.string().min(1),
  barDate: isoDateSchema,
  retrievedAt: z.string().datetime({ offset: true }),
}).strict();
const researchPriceSessionSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("settled_full_bar"),
    sessionDate: isoDateSchema,
    prices: z.object({
      open: z.number(),
      high: z.number(),
      low: z.number(),
      close: z.number(),
      volume: z.number().nonnegative(),
      tradedValue: z.number().nonnegative(),
      tradeCount: z.number().nonnegative(),
    }).strict(),
    basisClose: z.number(),
    provenance: researchPriceProvenanceSchema,
  }).strict(),
  z.object({
    state: z.literal("settled_close_only"),
    sessionDate: isoDateSchema,
    prices: z.object({
      close: z.number(),
    }).strict(),
    basisClose: z.number(),
    provenance: researchPriceProvenanceSchema,
  }).strict(),
  z.object({
    state: z.literal("no_trade"),
    sessionDate: isoDateSchema,
    prices: z.object({
      close: z.number().nullable(),
      volume: z.number().nonnegative().nullable(),
      tradedValue: z.number().nonnegative().nullable(),
      tradeCount: z.number().nonnegative().nullable(),
    }).strict(),
    basisClose: z.number().nullable(),
    provenance: researchPriceProvenanceSchema,
  }).strict(),
  z.object({
    state: z.literal("suspended"),
    sessionDate: isoDateSchema,
    reasonCode: z.literal("official_trading_suspension"),
    note: z.string().nullable(),
    provenance: researchPriceProvenanceSchema,
  }).strict(),
  z.object({
    state: z.literal("missing"),
    sessionDate: isoDateSchema,
    reasonCode: z.enum(["missing_authoritative_price", "listing_inactive"]),
  }).strict(),
  z.object({
    state: z.literal("stale"),
    sessionDate: isoDateSchema,
    latestAvailableDate: isoDateSchema.nullable(),
    reasonCode: z.literal("authoritative_close_overdue"),
  }).strict(),
  z.object({
    state: z.literal("corporate_action_incomplete"),
    sessionDate: isoDateSchema,
    close: z.number().nullable(),
    missingInputs: z.array(z.string().min(1)).min(1),
    provenance: researchPriceProvenanceSchema,
  }).strict(),
]);
const researchMetricResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("returned"),
    id: researchMetricSchema.shape.id,
    windowSessions: z.number().int().min(1).max(1260),
    value: z.number(),
    units: z.string().min(1),
    formulaId: z.string().min(1).max(120),
    formulaVersion: z.string().min(1).max(120),
    parameters: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
    observationInputs: z.array(isoDateSchema).min(1).max(64),
    observationIds: z.array(canonicalIdSchema).min(1).max(64),
    provenanceIds: z.array(canonicalIdSchema).min(1),
    lineage: z.object({
      state: z.enum(["complete", "bounded"]),
      totalObservationCount: z.number().int().min(1).max(1260),
      returnedObservationCount: z.number().int().min(1).max(64),
      totalProvenanceCount: z.number().int().min(1).max(1260),
      maxReturnedObservations: z.literal(64),
      digestAlgorithm: z.literal("sha256"),
      digest: z.string().regex(/^[a-f0-9]{64}$/),
    }).strict(),
    calculatedAt: z.string().datetime({ offset: true }),
    rounding: z.string().min(1).max(120),
  }).strict(),
  z.object({
    status: z.literal("withheld"),
    id: researchMetricSchema.shape.id,
    windowSessions: z.number().int().min(1).max(1260),
    reasonCode: z.enum(["insufficient_basis_history", "close_only_series", "corporate_action_incomplete"]),
  }).strict(),
  z.object({
    status: z.literal("not_applicable"),
    id: researchMetricSchema.shape.id,
    windowSessions: z.number().int().min(1).max(1260),
    reasonCode: z.enum(["identity_only_profile"]),
  }).strict(),
]);

export const researchPriceSeriesOutputSchema = z.object({
  contractVersion: z.literal("research-price-series/1.0.0"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  listing: listingSchema,
  scope: researchPriceSeriesScopeSchema,
  basis: z.enum(["raw", "corporate_action_adjusted"]),
  basisPolicy: z.object({
    id: z.literal("taiwan-authoritative-stock-actions/1.0.0"),
    status: z.enum(["raw", "applied", "incomplete"]),
  }).strict(),
  order: z.enum(["asc", "desc"]),
  freshness: z.object({
    state: z.enum(["current", "stale", "due_pending", "not_yet_due", "not_applicable"]),
    authoritativeAsOf: isoDateSchema.nullable(),
  }).strict(),
  page: z.object({
    limit: z.number().int().min(1).max(260),
    nextCursor: z.string().nullable(),
    recordCount: z.number().int().min(0).max(260),
    truncatedByBudget: z.boolean(),
  }).strict(),
  sessions: z.array(researchPriceSessionSchema).max(260),
  metrics: z.array(researchMetricResultSchema).max(6),
}).strict();

const researchToolErrorOutputShape = {
  code: z.string().regex(
    /^(?:research_subject_not_found|research_subject_ambiguous|research_cursor_invalid|research_assessment_mode_unsupported|research_dataset_unavailable|research_calendar_unavailable|research_record_too_large|research_window_invalid|mcp_[a-z0-9_]+)$/,
  ),
  message: z.string().min(1),
  statusCode: z.number().int().min(400).max(499),
  metadata: z.record(z.string(), z.unknown()).optional(),
} as const;

export const researchToolErrorOutputSchema = z.object(researchToolErrorOutputShape).strict();

export const researchIdentityToolOutputSchema = z.object({
  result: z.union([
    researchIdentityOutputSchema,
    researchToolErrorOutputSchema,
  ]),
}).strict();

export const researchManifestToolOutputSchema = z.object({
  result: z.union([
    researchManifestOutputSchema,
    researchToolErrorOutputSchema,
  ]),
}).strict();

export const researchPriceSeriesToolOutputSchema = z.object({
  result: z.union([
    researchPriceSeriesOutputSchema,
    researchToolErrorOutputSchema,
  ]),
}).strict();

export const researchMonthlyRevenueQuerySchema = researchQuerySchema.extend({
  range: z.object({
    startMonth: isoMonthSchema.optional(),
    endMonth: isoMonthSchema.optional(),
  }).strict().optional(),
  page: z.object({
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(60).default(24),
    order: z.enum(["asc", "desc"]).default("desc"),
  }).strict().default({ limit: 24, order: "desc" }),
}).strict();

const researchMonthlyRevenueMetricSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    value: z.string(),
    lineageMonths: z.array(isoMonthSchema).min(1),
  }).strict(),
  z.object({
    status: z.literal("withheld"),
    reasonCode: z.enum([
      "unknown_unit",
      "unknown_basis",
      "missing_comparable_month",
      "basis_change",
      "short_window",
      "latest_due_gap",
    ]),
    lineageMonths: z.array(isoMonthSchema),
  }).strict(),
]);

const researchMonthlyRevenueSourceValueSchema = z.object({
  raw: z.string(),
  normalized: z.discriminatedUnion("state", [
    z.object({ state: z.literal("present"), value: z.string() }).strict(),
    z.object({ state: z.literal("missing"), reason: z.literal("unparseable") }).strict(),
  ]),
}).strict();

const researchMonthlyRevenueFreshnessSchema = z.object({
  basis: z.enum(["standard_10th", "insurance_15th"]),
  gracePolicy: z.literal("next_taiwan_business_day"),
  latestExpectedMonth: isoMonthSchema,
  statutoryDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  latestDueStatus: z.enum(["reported", "missing"]),
}).strict();

const researchMonthlyRevenueSourceFactsSchema = z.object({
  companyName: z.string(),
  industryName: z.string(),
  currentMonthRevenue: researchMonthlyRevenueSourceValueSchema,
  priorMonthRevenue: researchMonthlyRevenueSourceValueSchema,
  priorYearSameMonthRevenue: researchMonthlyRevenueSourceValueSchema,
  publisherComparisons: z.object({
    monthOverMonthPercent: researchMonthlyRevenueSourceValueSchema,
    yearOverYearPercent: researchMonthlyRevenueSourceValueSchema,
    currentYearToDateRevenue: researchMonthlyRevenueSourceValueSchema,
    priorYearToDateRevenue: researchMonthlyRevenueSourceValueSchema,
    yearToDateYearOverYearPercent: researchMonthlyRevenueSourceValueSchema,
  }).strict(),
  note: z.string().nullable(),
}).strict();

const researchMonthlyRevenueItemSchema = z.object({
  revenueMonth: isoMonthSchema,
  publicationContext: z.object({
    publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    rawPublishedAt: z.string().min(1),
    declaredUnit: z.enum(["TWD_THOUSANDS", "UNKNOWN"]),
    basis: z.enum(["consolidated", "individual", "unknown"]),
    qualifier: z.enum(["estimated", "final", "unknown"]),
  }).strict(),
  sourceFacts: researchMonthlyRevenueSourceFactsSchema,
  basisChange: z.object({
    state: z.enum(["present", "absent"]),
    reasonCode: z.enum(["merged_entity_change", "comparative_restatement", "scope_change"]).nullable(),
  }).strict(),
  derivedMetrics: z.object({
    yearOverYearPercent: researchMonthlyRevenueMetricSchema,
    rolling3MonthRevenue: researchMonthlyRevenueMetricSchema,
    trailing12MonthRevenue: researchMonthlyRevenueMetricSchema,
    currentYearToDateRevenue: researchMonthlyRevenueMetricSchema,
    priorYearToDateRevenue: researchMonthlyRevenueMetricSchema,
    yearToDateYearOverYearPercent: researchMonthlyRevenueMetricSchema,
    seasonalityShareOfTrailing12MonthRevenue: researchMonthlyRevenueMetricSchema,
  }).strict(),
}).strict();

const researchMonthlyRevenueConclusionSchema = z.object({
  status: z.enum(["supported", "withheld"]),
  statement: z.string().min(1),
  reasonCodes: z.array(z.string()).max(8),
}).strict();

const researchMonthlyRevenueOutputSchema = z.object({
  contractVersion: z.literal("monthly-revenue/1.0.0"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  window: z.object({
    startMonth: isoMonthSchema,
    endMonth: isoMonthSchema,
    requestedOrder: z.enum(["asc", "desc"]),
    pageLimit: z.number().int().min(1).max(60),
    defaultMonths: z.literal(24),
    maxMonths: z.literal(120),
  }).strict(),
  freshness: researchMonthlyRevenueFreshnessSchema,
  conclusion: researchMonthlyRevenueConclusionSchema,
  items: z.array(researchMonthlyRevenueItemSchema),
  page: z.object({
    nextCursor: z.string().nullable(),
  }).strict(),
  evidence: z.object({
    provenanceIds: z.array(canonicalIdSchema),
  }).strict(),
}).strict();

export const researchMonthlyRevenueToolOutputSchema = z.object({
  result: z.union([
    researchMonthlyRevenueOutputSchema,
    researchToolErrorOutputSchema,
  ]),
}).strict();

export const IDENTITY_ONLY_SCOPE_STATEMENT =
  "This release supports canonical identity research only; market, financial, ownership, trading, dividend, announcement, and investor-material claims are not included.";

export const MARKET_CONTEXT_SCOPE_STATEMENT =
  "Market-context research distinguishes settled authoritative closes from intraday and indicative prices, and excludes technical signals, targets, and attractiveness claims.";

export const researchIdentityOnlyReportSchema = z.object({
  contractVersion: z.literal("research-report/1.0.0"),
  profile: z.literal("identity_only"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  generatedAt: z.string().datetime({ offset: true }),
  sections: z.tuple([
    z.object({
      id: z.literal("identity"),
      issuer: issuerSchema,
      security: securitySchema,
      listing: listingSchema,
      legalName: z.string().nullable(),
      displayName: z.string().nullable(),
      industryCode: z.string().nullable(),
    }).strict(),
    z.object({
      id: z.literal("eligibility"),
      profile: eligibilitySchema.shape.profile,
      state: eligibilitySchema.shape.state,
      reasonCode: eligibilitySchema.shape.reasonCode,
    }).strict(),
    z.object({
      id: z.literal("unsupported_scope"),
      reasonCode: z.literal("identity_only_release"),
      statement: z.literal(IDENTITY_ONLY_SCOPE_STATEMENT),
    }).strict(),
  ]),
  evidence: z.object({
    observationIds: z.array(canonicalIdSchema),
    provenanceIds: z.array(canonicalIdSchema),
  }).strict(),
}).strict().superRefine((report, refinement) => {
  if (report.generatedAt !== report.context.knowledgeAt) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generatedAt"],
      message: "generatedAt must equal the fixed knowledgeAt timestamp",
    });
  }
});

export const researchFocusedMarketReportSchema = z.object({
  contractVersion: z.literal("research-report/1.0.0"),
  profile: z.literal("focused_market"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  generatedAt: z.string().datetime({ offset: true }),
  sections: z.tuple([
    z.object({
      id: z.literal("identity"),
      issuer: issuerSchema,
      security: securitySchema,
      listing: listingSchema,
      displayName: z.string().nullable(),
    }).strict(),
    z.object({
      id: z.literal("market_context"),
      statement: z.literal(MARKET_CONTEXT_SCOPE_STATEMENT),
      priceSeries: researchPriceSeriesOutputSchema,
      indicativePricesExcluded: z.literal(true),
      intradayPricesExcluded: z.literal(true),
      technicalSignalsExcluded: z.literal(true),
    }).strict(),
  ]),
  evidence: z.object({
    provenanceIds: z.array(canonicalIdSchema),
    sessionDates: z.array(isoDateSchema),
  }).strict(),
}).strict().superRefine((report, refinement) => {
  if (report.generatedAt !== report.context.knowledgeAt) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generatedAt"],
      message: "generatedAt must equal the fixed knowledgeAt timestamp",
    });
  }
});

export const researchRevenueFocusedReportSchema = z.object({
  contractVersion: z.literal("research-report/2.0.0"),
  profile: z.literal("monthly_revenue"),
  selector: immutableListingSelectorSchema,
  context: fixedResearchContextSchema,
  generatedAt: z.string().datetime({ offset: true }),
  sections: z.tuple([
    z.object({
      id: z.literal("identity"),
      issuer: issuerSchema,
      security: securitySchema,
      listing: listingSchema,
      displayName: z.string().nullable(),
    }).strict(),
    z.object({
      id: z.literal("eligibility"),
      profile: eligibilitySchema.shape.profile,
      state: eligibilitySchema.shape.state,
      reasonCode: eligibilitySchema.shape.reasonCode,
    }).strict(),
    z.object({
      id: z.literal("monthly_revenue"),
      freshness: researchMonthlyRevenueFreshnessSchema,
      latestMonth: isoMonthSchema.nullable(),
      latestRecord: researchMonthlyRevenueItemSchema.nullable(),
      latestYearOverYearPercent: researchMonthlyRevenueMetricSchema.nullable(),
    }).strict(),
  ]),
  conclusion: researchMonthlyRevenueConclusionSchema,
  evidence: z.object({
    provenanceIds: z.array(canonicalIdSchema),
  }).strict(),
}).strict().superRefine((report, refinement) => {
  if (report.generatedAt !== report.context.knowledgeAt) {
    refinement.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["generatedAt"],
      message: "generatedAt must equal the fixed knowledgeAt timestamp",
    });
  }
});

export type ResearchSubjectSelector = z.infer<typeof researchSubjectSelectorSchema>;
export type ResearchTemporalContext = z.infer<typeof researchTemporalContextSchema>;
export type ResearchQuery = z.infer<typeof researchQuerySchema>;
export type ResearchIdentityQuery = z.infer<typeof researchIdentityQuerySchema>;
export type ResearchPriceSeriesQuery = z.infer<typeof researchPriceSeriesQuerySchema>;
export type ResearchPriceSeriesOutput = z.infer<typeof researchPriceSeriesOutputSchema>;
export type ResearchPriceSession = ResearchPriceSeriesOutput["sessions"][number];
export type ResearchPriceMetricResult = ResearchPriceSeriesOutput["metrics"][number];
export type ResearchIdentityOnlyReport = z.infer<typeof researchIdentityOnlyReportSchema>;
export type ResearchFocusedMarketReport = z.infer<typeof researchFocusedMarketReportSchema>;
export type ResearchMonthlyRevenueQuery = z.infer<typeof researchMonthlyRevenueQuerySchema>;
export type ResearchRevenueFocusedReport = z.infer<typeof researchRevenueFocusedReportSchema>;
