import { z } from "zod";

const id = z.string().min(1).max(120).regex(/^[\w-]+$/);
const safeUrl = z.string().url().refine((value) => {
  const url = new URL(value);
  return url.protocol === "https:" && !url.username && !url.password && !/[?&](?:token|key|secret|signature|auth)=/i.test(url.search);
}, "Disclosure source links must be HTTPS and contain no credentials");
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
export const researchDisclosureArtifactSchema = z.object({
  id, issuerId: id, contentHash: z.string().regex(/^[a-f0-9]{64}$/), extractionVersion: z.string().min(1),
  publishedAt: time, sourceUrl: safeUrl, mediaType: z.string(),
  reference: z.object({ kind: z.enum(["announcement_attachment", "investor_material"]), id }).strict(),
  state: z.enum(["available", "restricted", "processing_failed", "indeterminate", "unavailable"]),
  parentProvenance: disclosureProvenanceSchema.optional(),
  retainedBytesBase64: z.string().optional(),
  totalPages: z.number().int().nonnegative(), blocks: z.array(disclosureBlockSchema), verifiedClaims: z.array(disclosureClaimSchema),
  provenance: disclosureProvenanceSchema,
}).strict();
export const researchDisclosureScanSchema = z.object({
  id, listingId: id, issuerId: id, venue: z.enum(["TWSE", "TPEX"]), checkedAt: time,
  publicationStart: time, publicationEnd: time, knowledgeAt: time,
  status: z.enum(["success", "failed", "restricted", "processing_failed"]), exhaustive: z.boolean(),
  detailAttempts: z.array(z.object({ announcementId: id, attemptedAt: time, status: z.enum(["available", "restricted", "unavailable", "processing_failed"]), reasonCodes: z.array(z.string()) }).strict()).optional(),
  artifactAttempts: z.array(z.object({ artifactId: id, sourceUrl: safeUrl, attemptedAt: time, status: z.enum(["retained", "restricted", "unavailable", "processing_failed"]) }).strict()).optional(),
  provenance: disclosureProvenanceSchema.extend({ contentHash: z.string().regex(/^[a-f0-9]{64}$/).nullable() }).strict(),
}).strict();
export type ResearchAnnouncementRecord = z.infer<typeof researchAnnouncementRecordSchema>;
export type ResearchDisclosureArtifact = z.infer<typeof researchDisclosureArtifactSchema>;
export type ResearchDisclosureScan = z.infer<typeof researchDisclosureScanSchema>;
export interface ResearchDisclosureStoreQuery { issuerId: string; knowledgeAt: string; effectiveAt: string }

// A material reference is admitted by internal ingestion independently of an
// artifact. This is a narrow authorization seam, not a discovery endpoint.
export const researchDisclosureMaterialReferenceSchema = z.object({
  id, issuerId: id, publishedAt: time, artifactIds: z.array(id).min(1), provenance: disclosureProvenanceSchema,
}).strict();
export type ResearchDisclosureMaterialReference = z.infer<typeof researchDisclosureMaterialReferenceSchema>;

export function validateResearchDisclosureStoreQuery(query: ResearchDisclosureStoreQuery): void {
  z.object({ issuerId: id, effectiveAt: time, knowledgeAt: time }).strict()
    .refine((value) => Date.parse(value.effectiveAt) <= Date.parse(value.knowledgeAt), "effectiveAt must not exceed knowledgeAt").parse(query);
}
