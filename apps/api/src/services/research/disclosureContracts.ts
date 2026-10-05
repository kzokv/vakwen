import { z } from "zod";
import { isCredentialFreeDisclosureUrl } from "./disclosureSourceUrl.js";

const id = z.string().min(1).max(120).regex(/^[\w-]+$/);
const safeUrl = z.string().url().refine(isCredentialFreeDisclosureUrl, "Disclosure source links must be HTTPS and contain no credentials");
const time = z.string().datetime({ offset: true });
export const disclosureProvenanceSchema = z.object({
  id, publisher: z.literal("MOPS"), accessProvider: z.enum(["TWSE_OPENAPI", "TPEX_OPENAPI", "MOPS_API"]),
  authorityRole: z.literal("authoritative"), sourceUrl: safeUrl, contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  retrievedAt: time, processedAt: time, acquisitionRunId: z.string().min(1),
  parserVersion: z.string().min(1), usagePolicyVersion: z.literal("taiwan-open-data/1.0.0"),
}).strict();
export const disclosureRelationSchema = z.object({ kind: z.enum(["corrects", "retracts", "supersedes"]), targetAnnouncementId: id }).strict();
export const disclosureAttachmentSchema = z.object({ id, artifactId: id.nullable(), title: z.string(), sourceUrl: safeUrl, mediaType: z.string() }).strict();
export const researchAnnouncementRecordSchema = z.object({
  id, collectionRecordId: id.optional(), issuerId: id, listingId: id, ticker: z.string(), venue: z.enum(["TWSE", "TPEX"]),
  publishedAt: time, publicationPrecision: z.enum(["second", "minute", "date"]), subject: z.string(), ruleClause: z.string(),
  eventDate: z.string().nullable(), explanation: z.string(), sourceUrl: safeUrl,
  rawPublication: z.object({ date: z.string(), time: z.string() }).strict().optional(),
  rawEventDate: z.string().optional(),
  detailQuality: z.object({ status: z.enum(["available", "restricted", "processing_failed", "unavailable"]), reasonCodes: z.array(z.string()) }).strict().optional(),
  collectionProvenance: disclosureProvenanceSchema.optional(),
  attachments: z.array(disclosureAttachmentSchema), relations: z.array(disclosureRelationSchema),
  quality: z.enum(["available", "restricted", "processing_failed", "indeterminate"]),
  provenance: disclosureProvenanceSchema,
}).strict();
export const disclosureBlockSchema = z.object({
  id, page: z.number().int().positive(), table: z.string().nullable(), text: z.string(),
  extractionState: z.enum(["retained_text", "provisional_ocr"]), subject: id,
  period: z.string().nullable(), unit: z.string().nullable(),
}).strict();
export const disclosureClaimSchema = z.object({
  id, kind: z.literal("source_fact"), text: z.string(), blockIds: z.array(id).min(1),
  page: z.number().int().positive(), table: z.string().nullable(), subject: id,
  period: z.string().nullable(), unit: z.string().nullable(), verification: z.literal("verified"),
  publisher: z.literal("MOPS"), verifiedAt: time,
}).strict();
export const researchDisclosureArtifactBaseSchema = z.object({
  id, issuerId: id, contentHash: z.string().regex(/^[a-f0-9]{64}$/), extractionVersion: z.string().min(1),
  publishedAt: time, sourceUrl: safeUrl, mediaType: z.string(), sourceMediaType: z.string().optional(),
  reference: z.object({ kind: z.enum(["announcement_attachment", "investor_material"]), id }).strict(),
  state: z.enum(["available", "restricted", "processing_failed", "indeterminate", "unavailable"]),
  parentProvenance: disclosureProvenanceSchema.optional(),
  retainedBytesBase64: z.string().optional(),
  confirmedEmptyPages: z.array(z.number().int().positive()).max(1000).optional(),
  totalPages: z.number().int().nonnegative(), blocks: z.array(disclosureBlockSchema), verifiedClaims: z.array(disclosureClaimSchema),
  provenance: disclosureProvenanceSchema,
}).strict();
export function validateDisclosureEmptyPages(artifact: { totalPages: number; confirmedEmptyPages?: number[]; blocks: { page: number }[] }, ctx: z.RefinementCtx): void {
  const pages = artifact.confirmedEmptyPages ?? [];
  if (new Set(pages).size !== pages.length || pages.some((page) => page > artifact.totalPages || artifact.blocks.some((block) => block.page === page))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["confirmedEmptyPages"], message: "Confirmed empty pages must be unique physical pages without retained or provisional blocks." });
  }
}
export const researchDisclosureArtifactSchema = researchDisclosureArtifactBaseSchema.superRefine(validateDisclosureEmptyPages);
export const researchDisclosureScanSchema = z.object({
  id, listingId: id, issuerId: id, venue: z.enum(["TWSE", "TPEX"]), checkedAt: time,
  publicationStart: time, publicationEnd: time, knowledgeAt: time,
  status: z.enum(["success", "failed", "restricted", "processing_failed"]), exhaustive: z.boolean(),
  detailAttempts: z.array(z.object({ announcementId: id, attemptedAt: time, status: z.enum(["available", "restricted", "unavailable", "processing_failed"]), reasonCodes: z.array(z.string()) }).strict()).optional(),
  artifactAttempts: z.array(z.object({ artifactId: id, sourceUrl: safeUrl, attemptedAt: time, status: z.enum(["retained", "restricted", "unavailable", "processing_failed"]), reasonCode: z.literal("disclosure_source_too_large").optional() }).strict()).optional(),
  provenance: disclosureProvenanceSchema.extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
}).strict();
export type ResearchAnnouncementRecord = z.infer<typeof researchAnnouncementRecordSchema>;
export type ResearchDisclosureArtifact = z.infer<typeof researchDisclosureArtifactSchema>;
export type ResearchDisclosureScan = z.infer<typeof researchDisclosureScanSchema>;
export interface ResearchDisclosureStoreQuery { issuerId: string; knowledgeAt: string; effectiveAt: string }

// A material reference is admitted by internal ingestion independently of an
// artifact. This is a narrow authorization seam, not a discovery endpoint.
// The effective listing and venue are required even when the artifact belongs to its issuer.
export const researchDisclosureMaterialReferenceSchema = z.object({
  id, issuerId: id, listingId: id, venue: z.enum(["TWSE", "TPEX"]), publishedAt: time, artifactIds: z.array(id).min(1), provenance: disclosureProvenanceSchema,
}).strict();
export type ResearchDisclosureMaterialReference = z.infer<typeof researchDisclosureMaterialReferenceSchema>;

export function validateResearchDisclosureStoreQuery(query: ResearchDisclosureStoreQuery): void {
  z.object({ issuerId: id, effectiveAt: time, knowledgeAt: time }).strict()
    .refine((value) => Date.parse(value.effectiveAt) <= Date.parse(value.knowledgeAt), "effectiveAt must not exceed knowledgeAt").parse(query);
}

export function validateResearchDisclosureArtifactStoreQuery(query: ResearchDisclosureStoreQuery & { artifactId?: string }): void {
  z.object({ issuerId: id, effectiveAt: time, knowledgeAt: time, artifactId: id.optional() }).strict()
    .refine((value) => Date.parse(value.effectiveAt) <= Date.parse(value.knowledgeAt), "effectiveAt must not exceed knowledgeAt").parse(query);
}

export type ResearchDisclosureScanLookup = ResearchDisclosureStoreQuery & { listingId: string; venue: "TWSE" | "TPEX" };
export type ResearchDisclosureArtifactAttempt = NonNullable<ResearchDisclosureScan["artifactAttempts"]>[number];
export function validateResearchDisclosureScanLookup(query: ResearchDisclosureScanLookup, artifact = false): void {
  z.object({ issuerId: id, listingId: id, venue: z.enum(["TWSE", "TPEX"]), effectiveAt: time, knowledgeAt: time, ...(artifact ? { artifactId: id } : {}) }).strict()
    .refine((value) => Date.parse(value.effectiveAt) <= Date.parse(value.knowledgeAt), "effectiveAt must not exceed knowledgeAt").parse(query);
}

export const researchAnnouncementMetadataSchema = researchAnnouncementRecordSchema.omit({ explanation: true, attachments: true });
export type ResearchAnnouncementMetadata = z.infer<typeof researchAnnouncementMetadataSchema>;
export type ResearchAnnouncementWindowQuery = ResearchDisclosureScanLookup & { publishedFrom: string; publishedTo: string; eventFrom?: string; eventTo?: string };
export type ResearchAnnouncementCandidateQuery = ResearchDisclosureScanLookup & ({ kind: "revision"; collectionRecordId: string; publishedAt: string; subject: string } | { kind: "citation"; before: string; titles: string[]; days: string[] });
export type ResearchDisclosureReferenceQuery = ResearchDisclosureScanLookup & { artifactId: string; reference?: { kind: "announcement_attachment" | "investor_material"; id: string } };
export function disclosureMetadata(record: ResearchAnnouncementRecord): ResearchAnnouncementMetadata {
  return researchAnnouncementMetadataSchema.parse(Object.fromEntries(Object.entries(record).filter(([key]) => key !== "explanation" && key !== "attachments")));
}

// ECMAScript \s, explicitly shared with PostgreSQL instead of locale-dependent [:space:].
export const disclosureWhitespacePattern = "[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]";
export function validateDisclosureReadScope(query: ResearchDisclosureScanLookup): void {
  validateResearchDisclosureScanLookup({ issuerId: query.issuerId, listingId: query.listingId, venue: query.venue, effectiveAt: query.effectiveAt, knowledgeAt: query.knowledgeAt });
}

const disclosureLookupFields = { issuerId: id, listingId: id, venue: z.enum(["TWSE", "TPEX"]), effectiveAt: time, knowledgeAt: time };
const disclosureDay = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, "Invalid calendar date");
export function validateResearchAnnouncementWindowQuery(query: ResearchAnnouncementWindowQuery): void {
  validateDisclosureReadScope(query);
  z.object({ ...disclosureLookupFields, publishedFrom: time, publishedTo: time, eventFrom: disclosureDay.optional(), eventTo: disclosureDay.optional() }).strict()
    .refine((value) => Date.parse(value.publishedFrom) <= Date.parse(value.publishedTo) && Date.parse(value.publishedTo) <= Date.parse(value.effectiveAt), "Invalid publication window")
    .refine((value) => !value.eventFrom || !value.eventTo || value.eventFrom <= value.eventTo, "Invalid event window").parse(query);
}
export function validateResearchAnnouncementIdsQuery(query: ResearchDisclosureScanLookup & { ids: string[] }): void {
  validateDisclosureReadScope(query);
  z.object({ ...disclosureLookupFields, ids: z.array(id).max(100) }).strict().parse(query);
}
export function validateResearchDisclosureReferenceQuery(query: ResearchDisclosureReferenceQuery): void {
  validateDisclosureReadScope(query);
  z.object({ ...disclosureLookupFields, artifactId: id, reference: z.object({ kind: z.enum(["announcement_attachment", "investor_material"]), id }).strict().optional() }).strict().parse(query);
}
export function validateResearchAnnouncementCandidateQuery(query: ResearchAnnouncementCandidateQuery): void {
  validateDisclosureReadScope(query);
  z.discriminatedUnion("kind", [
    z.object({ ...disclosureLookupFields, kind: z.literal("revision"), collectionRecordId: id, publishedAt: time, subject: z.string() }).strict(),
    z.object({ ...disclosureLookupFields, kind: z.literal("citation"), before: time, titles: z.array(z.string().min(1)), days: z.array(disclosureDay) }).strict(),
  ]).refine((value) => Date.parse(value.kind === "revision" ? value.publishedAt : value.before) <= Date.parse(value.effectiveAt), "Candidate time exceeds effectiveAt").parse(query);
}
export function validateResearchSuccessfulDetailQuery(query: ResearchDisclosureScanLookup & { collectionRecordId: string }): void {
  validateDisclosureReadScope(query);
  z.object({ ...disclosureLookupFields, collectionRecordId: id }).strict().parse(query);
}
