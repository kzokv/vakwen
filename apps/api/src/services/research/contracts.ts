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
  cursor: z.string().min(1).max(200).optional(),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();

export const researchIdentityQuerySchema = researchQuerySchema.extend({
  history: researchHistoryPageSchema.default({ limit: 25 }),
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
  }).strict()).length(11),
}).strict();

export const IDENTITY_ONLY_SCOPE_STATEMENT =
  "This release supports canonical identity research only; market, financial, ownership, trading, dividend, announcement, and investor-material claims are not included.";

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

export type ResearchSubjectSelector = z.infer<typeof researchSubjectSelectorSchema>;
export type ResearchTemporalContext = z.infer<typeof researchTemporalContextSchema>;
export type ResearchQuery = z.infer<typeof researchQuerySchema>;
export type ResearchIdentityQuery = z.infer<typeof researchIdentityQuerySchema>;
export type ResearchIdentityOnlyReport = z.infer<typeof researchIdentityOnlyReportSchema>;
