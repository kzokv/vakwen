import { disclosureNoticeMayAffectPublication } from "./disclosureContracts.js";
import { z } from "zod";
import type { Persistence } from "../../persistence/types.js";
import {
  disclosureArtifactOutputSchema, materialAnnouncementsOutputSchema, researchIdentityOutputSchema, researchManifestOutputSchema,
  type DisclosureArtifactOutput, type MaterialAnnouncementsOutput, type ResearchQuery,
} from "./contracts.js";
import { DisclosureServiceError, getDisclosureArtifact, listMaterialAnnouncements } from "./disclosures.js";
import { getResearchIdentity, getResearchManifest, ResearchServiceError } from "./service.js";

const evidenceReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("announcement"), announcementId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("artifact_claim"), artifactId: z.string().min(1), claimId: z.string().min(1) }).strict(),
]);

// Scope trading commands to imperative/advisory contexts, not ordinary issuer operations.
function hasTradingAdvice(text: string): boolean {
  const object = String.raw`(?:(?:the|this|these|those|your|more|some|all|its|company)\s+)?(?:[A-Za-z0-9][\w.-]*(?:['’]s)?\s+){0,2}(?:stock|stocks|shares?|securit(?:y|ies)|holdings?|position)\b`;
  const imperative = String.raw`(?:buy|sell|hold|purchase|accumulate|short|reduce|exit|liquidate|add\s+to)\s+${object}`;
  const inflected = String.raw`(?:buy(?:ing)?|sell(?:ing)?|hold(?:ing)?|purchas(?:e|ing)|accumulat(?:e|ing)|short(?:ing)?|reduc(?:e|ing)|exit(?:ing)?|liquidat(?:e|ing)|add(?:ing)?\s+to)\s+${object}`;
  // Direct commands do not need a security suffix: names/tickers are open-ended.
  // Keep this broader object rule in directive contexts so issuer descriptions survive.
  const directiveStart = String.raw`(?:^|[.!?;:。！？；：\n])\s*(?:(?:[-*+>]|\d+[.)])\s*)?["'“‘「]*`;
  const namedAction = String.raw`(?:buy|sell|hold|purchase|accumulate|short|liquidate)\s+[\p{L}\p{N}$]`;
  const operationalObject = String.raw`(?:(?:the|our|its|their)\s+)?(?:inventory|shipments?|equipment|machinery|assets?|business(?:es)?|subsidiar(?:y|ies)|supplies|materials?)\b`;
  const bareNamedAction = String.raw`(?:buy|sell|hold|purchase|accumulate|short|liquidate)\s+(?!${operationalObject})[\p{L}\p{N}$]`;
  const namedInflection = String.raw`(?:buy(?:ing)?|sell(?:ing)?|hold(?:ing)?|purchas(?:e|ing)|accumulat(?:e|ing)|short(?:ing)?|liquidat(?:e|ing))\s+[\p{L}\p{N}$]`;
  if (new RegExp(String.raw`${directiveStart}(?:please\s+)?${bareNamedAction}`, "iu").test(text)
    || new RegExp(String.raw`(?:${directiveStart}|\b(?:I|we)\s+)(?:recommend(?:ed|ing)?|advis(?:e|ed|ing)|suggest(?:ed|ing)?)\s+(?:(?:that\s+)?(?:you|investors?|traders?)\s+)?(?:to\s+)?${namedInflection}`, "iu").test(text)
    || new RegExp(String.raw`\b(?:you|investors?|traders?)\s+(?:(?:should|must|can|could|ought\s+to|need\s+to)\s+)?${namedAction}`, "iu").test(text)
    || new RegExp(String.raw`${directiveStart}(?:my\s+advice\s+is\s+to|should|must|ought\s+to)\s+${namedAction}`, "iu").test(text)
    || new RegExp(String.raw`${directiveStart}(?:請|立即|現在|應該)?(?:買進|買入|賣出|持有|加碼|減碼|放空)(?!(?:庫存|設備|機器|資產|企業|原料|貨物))[\p{L}\p{N}]`, "u").test(text)) return true;
  return new RegExp(String.raw`(?:^|[.!?;:\n])\s*(?:(?:[-*+>]|\d+[.)])\s*)?["'“‘]*(?:please\s+)?${imperative}`, "i").test(text)
    || new RegExp(String.raw`\b(?:recommend(?:ed|ing)?|advis(?:e|ed|ing)|suggest(?:ed|ing)?|advice\s+is|should|must|ought\s+to|need\s+to)\s+(?:(?:that\s+)?(?:you|investors?|traders?)\s+)?(?:to\s+)?${inflected}`, "i").test(text)
    || new RegExp(String.raw`\b(?:you|investors?|traders?)\s+(?:(?:should|must|can|could)\s+)?${imperative}`, "i").test(text)
    || /(?:^|[。！？；：\n])\s*(?:(?:[-*+>]|\d+[.)])\s*)?["'“‘「]*(?:請|立即|現在|應該)?(?:買進|買入|賣出|持有|加碼|減碼|放空)(?:這檔|該公司|這些|你的|手中)?[\p{Script=Han}A-Za-z0-9]{0,12}(?:股票|股份|持股|證券)/u.test(text)
    || /(?:建議|推薦|應該|應當|務必)(?:投資人|投資者|你|您)?(?:買進|買入|賣出|持有|加碼|減碼|放空)/.test(text);
}

/** Analytical judgments belong to this report seam, never the canonical dataset tool. */
export const disclosureCandidateSchema = z.object({
  id: z.string().min(1).max(120).regex(/^[A-Za-z0-9_-]+$/),
  kind: z.enum(["catalyst", "risk"]),
  status: z.enum(["observed", "scheduled", "conditional", "speculative"]),
  statement: z.string().trim().min(1),
  statusEvidence: z.object({
    reference: evidenceReferenceSchema,
    excerpt: z.string().trim().min(1),
    eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    eventDateText: z.string().min(1).optional(),
  }).strict(),
  materialMechanism: z.string().trim().min(1),
  affectedMetricOrAssumption: z.string().trim().min(1),
  horizon: z.string().trim().min(1),
  triggeringEvidence: z.array(evidenceReferenceSchema).min(1),
  confirmingEvidence: z.array(evidenceReferenceSchema),
  disconfirmingEvidence: z.array(evidenceReferenceSchema),
  confirmationCondition: z.string().trim().min(1),
  disconfirmationCondition: z.string().trim().min(1),
  condition: z.string().trim().min(1).optional(),
  requiresExhaustiveCoverage: z.boolean().default(false),
}).strict().superRefine((candidate, ctx) => {
  if (["observed", "scheduled"].includes(candidate.status) && (!candidate.statusEvidence.eventDate || !candidate.statusEvidence.eventDateText)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statusEvidence"], message: "Observed/scheduled classifications require a dated publisher assertion" });
  }
  if (candidate.statement !== candidate.statusEvidence.excerpt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["statement"], message: "The factual statement must equal its publisher excerpt; interpretation belongs in analytical judgment fields" });
  }
  // Validate every rendered analyst-prose field independently; exact publisher
  // statement/excerpt text remains source evidence rather than analyst advice.
  const analyticalFields = ["materialMechanism", "affectedMetricOrAssumption", "horizon", "condition", "confirmationCondition", "disconfirmationCondition"] as const;
  for (const field of analyticalFields) {
    if (/(?:bullish|bearish|(?:investor|market|trading)\s+sentiment|guarantee[sd]?\s+(?:profits?|returns?|price)|看漲|看跌|保證獲利)/i.test(candidate[field] ?? "") || hasTradingAdvice(candidate[field] ?? "")) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: "Unsupported sentiment and action wording are excluded from the disclosure specialist" });
    }
  }
  if (candidate.status === "conditional" && !candidate.condition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["condition"], message: "Conditional judgments require an explicit unmet condition" });
  }
});
export type DisclosureCandidate = z.infer<typeof disclosureCandidateSchema>;
export type DisclosureEvidenceReference = z.infer<typeof evidenceReferenceSchema>;


const assessmentSchema = z.object({
  candidate: disclosureCandidateSchema,
  support: z.enum(["provisional", "withheld"]),
  sourceSupport: z.enum(["supported", "withheld"]),
  interpretationType: z.literal("analytical_judgment"),
  statement: z.string(),
  reasonCodes: z.array(z.string()),
  failedDependencies: z.array(evidenceReferenceSchema),
}).strict();
export const focusedDisclosureReportSchema = z.object({
  contractVersion: z.literal("research-report/4.0.0"),
  profile: z.literal("focused_disclosures"),
  selector: researchIdentityOutputSchema.shape.selector,
  context: researchIdentityOutputSchema.shape.context,
  generatedAt: z.string().datetime({ offset: true }),
  identity: researchIdentityOutputSchema.shape.identity,
  window: z.object({ mode: z.enum(["standard", "focused"]), publishedFrom: z.string(), publishedTo: z.string(), exhaustive: z.boolean(),
    extension: z.object({ months: z.number().int().min(13).max(24), reason: z.enum(["unresolved_corporate_action", "litigation", "financing", "restructuring", "unresolved_long_lived_thesis"]), thesisItem: z.string().min(1) }).strict().optional(),
  }).strict(),
  reportStatus: z.enum(["complete", "partial"]),
  officialScanGate: z.object({
    purpose: z.literal("final_recommendation"),
    status: z.enum(["passed", "withheld", "not_applicable"]),
    reasonCodes: z.array(z.string()),
    statement: z.string(),
  }).strict(),
  finalRecommendation: z.object({ state: z.literal("not_requested"), statement: z.string() }).strict(),
  announcementPages: z.array(materialAnnouncementsOutputSchema).min(1),
  artifactPages: z.array(disclosureArtifactOutputSchema),
  assessments: z.array(assessmentSchema),
  limitations: z.array(z.string()),
  recoveryRequirements: z.array(z.string()),
  evidence: z.object({ provenanceIds: z.array(z.string()) }).strict(),
}).strict();
export type FocusedDisclosureResearchReport = z.infer<typeof focusedDisclosureReportSchema>;

/** Preserve UTC time and clamp month-end dates instead of rolling into the next month. */
function subtractUtcCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() - months);
  const lastDay = new Date(result);
  lastDay.setUTCMonth(lastDay.getUTCMonth() + 1, 0);
  result.setUTCDate(Math.min(day, lastDay.getUTCDate()));
  return result;
}

/** Normalize only explicit Gregorian/ROC calendar dates, without Date.parse rollover. */
function normalizePublisherCalendarDate(literal: string | undefined): string | null {
  if (!literal) return null;
  const patterns = [/^(\d{3,4})-(\d{1,2})-(\d{1,2})$/, /^(\d{3,4})\/(\d{1,2})\/(\d{1,2})$/, /^(\d{3,4})年(\d{1,2})月(\d{1,2})日?$/];
  const match = patterns.map((pattern) => pattern.exec(literal)).find((result) => result !== null);
  if (!match) return null;
  const sourceYear = Number(match[1]);
  const year = sourceYear + (match[1]!.length === 3 ? 1911 : 0);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthLengths = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (sourceYear < 1 || month < 1 || month > 12 || day < 1 || day > monthLengths[month - 1]!) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function sameContext(left: MaterialAnnouncementsOutput["context"], right: MaterialAnnouncementsOutput["context"]): boolean {
  return left.knowledgeAt === right.knowledgeAt && left.effectiveAt === right.effectiveAt
    && left.assessmentMode === right.assessmentMode && left.policySetVersion === right.policySetVersion;
}

/** Check the structural continuity of service responses, not the authenticity of caller-authored data. */
function validateDisclosurePageChain(pages: Array<{
  nextCursor: string | null;
  continuity: { queryHash: string; offset: number; returnedCount: number; totalCount: number; requestCursor: string | null };
}>, counts: number[]): boolean {
  const first = pages[0];
  if (!first) throw new Error("Disclosure report page continuity is missing");
  let offset = 0;
  let requestCursor: string | null = null;
  for (const [index, page] of pages.entries()) {
    const c = page.continuity;
    const end = offset + counts[index]!;
    if (c.offset !== offset || c.requestCursor !== requestCursor || c.queryHash !== first.continuity.queryHash
      || c.totalCount !== first.continuity.totalCount || c.returnedCount !== counts[index]
      || end > c.totalCount || (end < c.totalCount) !== (page.nextCursor !== null)
      || (c.returnedCount === 0 && (c.totalCount !== 0 || index !== 0))
      || (index > 0 && requestCursor === null)) {
      throw new Error("Disclosure report page continuity does not match retained boundaries");
    }
    offset = end;
    requestCursor = page.nextCursor;
  }
  return offset < first.continuity.totalCount;
}

/** Expand every exact quote occurrence to source-derived sentence boundaries. */
function publisherAssertionContexts(source: string | undefined, excerpt: string): string[] {
  if (!source || !excerpt) return [];
  // Line wrapping is not an assertion boundary; normalization preserves UTF-16 offsets.
  const sentences = [...new Intl.Segmenter("en", { granularity: "sentence" }).segment(source.replace(/[\r\n\u2028\u2029]/g, " "))];
  const contexts = new Set<string>();
  let from = 0;
  while (from < source.length) {
    const start = source.indexOf(excerpt, from);
    if (start < 0) break;
    const end = start + excerpt.length;
    const containing = sentences.filter((sentence) => sentence.index < end && sentence.index + sentence.segment.length > start);
    if (containing.length) contexts.add(source.slice(containing[0]!.index, containing.at(-1)!.index + containing.at(-1)!.segment.length));
    from = start + 1;
  }
  return [...contexts];
}

// Status excerpts are conservative evidence anchors: negated, conditional, or revoked
// assertions cannot establish an affirmative occurrence or schedule by keyword alone.
function hasUncertainStatusAssertion(excerpt: string): boolean {
  return /(?:未|無法|並無|尚無|無(?:完成|發生|決議|通過|批准)|沒有|否認|並非|並不|不是|不曾|不會|不再|不予|不排除|不(?:完成|發生|決議|通過|批准|預計|預定|訂於)|取消|撤回|撤銷|否決|暫緩|中止|終止|尚待|如果|假如|假設|倘若|若|可能|如獲)|\b(?:not|never|no|cannot|can't|isn't|wasn't|weren't|hasn't|haven't|hadn't|won't|wouldn't|didn't|doesn't|don't|denied|cancelled|canceled|rescinded|withdrawn|unapproved|uncompleted|incomplete|unscheduled|unplanned|if|unless|pending|will|shall|should|would|could|might|may)\b|\b(?:failed\s+to|subject\s+to)\b/i.test(excerpt.replaceAll("’", "'"));
}

function artifactReportScopeFailure(artifact: NonNullable<DisclosureArtifactOutput["artifact"]>, pages: MaterialAnnouncementsOutput[]): string | null {
  const window = pages[0]!.window;
  const publishedAt = Date.parse(artifact.publishedAt);
  if (!Number.isFinite(publishedAt) || publishedAt < Date.parse(window.publishedFrom) || publishedAt > Date.parse(window.publishedTo)) {
    return "artifact_outside_report_window";
  }
  if (artifact.reference.kind === "announcement_attachment") {
    if (pages.some((page) => page.unresolvedRelationIndex.some((relation) => relation.candidateAnnouncementIds.includes(artifact.reference.id)))) {
      return "artifact_parent_unresolved_relation_target";
    }
    const parent = pages.flatMap((page) => page.items).find((item) => item.id === artifact.reference.id);
    if (!parent) return "artifact_parent_not_returned";
    if (parent.detailQuality?.reasonCodes.includes("unresolved_correction_reference")) return "artifact_parent_unresolved_correction_reference";
    if (parent.quality !== "available") return `artifact_parent_${parent.quality}`;
  }
  return null;
}

/** Validate a specialist fragment against retained evidence without making new publisher assertions. */
export function composeFocusedDisclosureResearchReport(input: {
  identity: z.infer<typeof researchIdentityOutputSchema>;
  announcementPages: MaterialAnnouncementsOutput[];
  artifactPages?: DisclosureArtifactOutput[];
  candidates?: z.input<typeof disclosureCandidateSchema>[];
  mode?: "standard" | "focused";
  extension?: FocusedDisclosureResearchReport["window"]["extension"];
}): FocusedDisclosureResearchReport {
  const identity = researchIdentityOutputSchema.parse(input.identity);
  const pages = input.announcementPages.map((page) => materialAnnouncementsOutputSchema.parse(page));
  const artifacts = (input.artifactPages ?? []).map((page) => disclosureArtifactOutputSchema.parse(page));
  const first = pages[0];
  if (!first) throw new Error("A disclosure report requires an official collection result");
  const mode = input.mode ?? "focused";
  if (input.extension) {
    focusedDisclosureReportSchema.shape.window.shape.extension.parse(input.extension);
    if (mode !== "standard") throw new Error("Long-lived thesis extensions require standard disclosure research");
  }
  for (const result of [...pages, ...artifacts]) {
    if (result.selector.listingId !== identity.selector.listingId
      || result.identity.issuer.id !== identity.identity.issuer.id
      || result.identity.security.id !== identity.identity.security.id
      || !sameContext(result.context, identity.context)) {
      throw new Error("Disclosure report evidence subject or fixed context mismatch");
    }
  }
  if (pages.some((page) => page.window.publishedFrom !== first.window.publishedFrom
    || page.window.publishedTo !== first.window.publishedTo)) {
    throw new Error("Disclosure report collection window mismatch");
  }
  const lineageSources = new Map<string, string>();
  const provenanceRecords = new Map<string, string>();
  for (const page of pages) {
    for (const provenance of page.provenance) {
      const retained = JSON.stringify(provenance);
      if (provenanceRecords.has(provenance.id) && provenanceRecords.get(provenance.id) !== retained) throw new Error("Disclosure lineage provenance content mismatch");
      provenanceRecords.set(provenance.id, retained);
    }
    for (const entry of [...page.relationIndex, ...page.unresolvedRelationIndex, ...page.unknownRelationIndex]) {
      const sourceId = "announcementId" in entry ? entry.announcementId : entry.sourceAnnouncementId;
      const source = pages.flatMap((result) => result.items).find((item) => item.id === sourceId);
      if ((source && source.provenance.id !== entry.provenanceId)
        || (lineageSources.has(sourceId) && lineageSources.get(sourceId) !== entry.provenanceId)) throw new Error("Disclosure lineage source provenance mapping mismatch");
      lineageSources.set(sourceId, entry.provenanceId);
    }
  }
  const collectionIncomplete = validateDisclosurePageChain(pages.map((page) => page.page), pages.map((page) => page.items.length));
  if (pages.some((page) => page.page.order !== first.page.order || page.page.limit !== first.page.limit)) {
    throw new Error("Disclosure report page continuity query order or limit mismatch");
  }
  const orderedAnnouncements = pages.flatMap((page) => page.items);
  const uniqueAnnouncements = new Set(orderedAnnouncements.map((item) => item.id));
  if (uniqueAnnouncements.size !== orderedAnnouncements.length || orderedAnnouncements.some((item, index) => {
    const previous = orderedAnnouncements[index - 1];
    if (!previous) return false;
    const comparison = Date.parse(item.publishedAt) - Date.parse(previous.publishedAt) || item.id.localeCompare(previous.id);
    return comparison * (first.page.order === "asc" ? 1 : -1) <= 0;
  })) throw new Error("Disclosure report announcement page continuity contains repeated or unordered records");
  const artifactGroups = new Map<string, DisclosureArtifactOutput[]>();
  for (const page of artifacts) {
    const key = page.artifact?.id ?? page.page.continuity.queryHash;
    artifactGroups.set(key, [...(artifactGroups.get(key) ?? []), page]);
  }
  for (const group of artifactGroups.values()) {
    validateDisclosurePageChain(group.map((page) => page.page), group.map((page) => page.page.returnedPages.length));
    const firstArtifact = group[0]!;
    const total = firstArtifact.artifact?.state === "available" ? firstArtifact.page.totalPages : 0;
    const ascending = firstArtifact.page.returnedPages[0] !== total || total <= 1;
    for (const page of group) {
      if (page.page.totalPages !== firstArtifact.page.totalPages || page.page.continuity.totalCount !== total
        || page.artifact?.contentHash !== firstArtifact.artifact?.contentHash
        || page.artifact?.extractionVersion !== firstArtifact.artifact?.extractionVersion
        || page.page.returnedPages.some((number, index) => number !== (ascending
          ? page.page.continuity.offset + index + 1 : total - page.page.continuity.offset - index))) {
        throw new Error("Disclosure report artifact page continuity does not match retained page numbers");
      }
    }
  }
  const requiredStart = subtractUtcCalendarMonths(new Date(identity.context.effectiveAt), input.extension?.months ?? 12);
  const exhaustive = mode === "standard" && !collectionIncomplete && pages.every((page) => page.window.exhaustive)
    && Date.parse(first.window.publishedFrom) <= requiredStart.getTime()
    && first.window.publishedTo === identity.context.effectiveAt;
  const applicable = first.quality.status !== "not_applicable";
  const scan = first.scan.record;
  const scanAge = scan ? Date.parse(identity.context.effectiveAt) - Date.parse(scan.checkedAt) : Number.NaN;
  const current = first.scan.status === "current" && scan?.status === "success"
    && scan.listingId === identity.selector.listingId && scan.issuerId === identity.identity.issuer.id
    && scanAge >= 0 && scanAge <= 30 * 60_000
    && first.quality.freshness === "current"
    && ["verified", "supported"].includes(first.quality.confidence)
    && ["ready", "degraded"].includes(first.quality.readiness.currentAssessment);
  const scanFailure = first.scan.status === "current" && !current ? "official_scan_evidence_invalid" : `official_scan_${first.scan.status}`;
  const invalidated = new Set(pages.flatMap((page) => page.relationIndex.map((relation) => relation.targetAnnouncementId)));
  const conflicted = new Set(pages.flatMap((page) => page.selection.conflictObservationIds));
  const ambiguousTargets = new Set(pages.flatMap((page) => page.unresolvedRelationIndex.flatMap((relation) => relation.candidateAnnouncementIds)));
  const announcements = pages.flatMap((page) => page.items);
  function failedReason(reference: DisclosureEvidenceReference): string | null {
    if (reference.kind === "announcement") {
      const announcement = announcements.find((item) => item.id === reference.announcementId);
      if (invalidated.has(reference.announcementId)) return "announcement_corrected_or_retracted";
      if (ambiguousTargets.has(reference.announcementId)) return "announcement_unresolved_relation_target";
      if (conflicted.has(reference.announcementId)) return "announcement_conflict_unresolved";
      if (!announcement) return "announcement_not_returned";
      if (announcement.detailQuality?.reasonCodes.includes("unresolved_correction_reference")) return "unresolved_correction_reference";
      if (announcement.quality !== "available") return `announcement_${announcement.quality}`;
      if (announcement.explanation.truncated) return "announcement_text_truncated";
      if (!announcement.explanation.text.trim()) return "announcement_content_unavailable";
      return null;
    }
    const artifactResults = artifacts.filter((page) => page.artifact?.id === reference.artifactId);
    const retained = artifactResults[0]?.artifact;
    if (!retained) return "artifact_not_returned";
    if (retained.state !== "available") return `artifact_${retained.state}`;
    if (retained.reference.kind === "announcement_attachment" && invalidated.has(retained.reference.id)) return "artifact_parent_corrected_or_retracted";
    if (retained.reference.kind === "announcement_attachment" && conflicted.has(retained.reference.id)) return "artifact_parent_conflict_unresolved";
    const scopeFailure = artifactReportScopeFailure(retained, pages);
    if (scopeFailure) return scopeFailure;
    const claimResult = artifactResults.find((page) => page.artifact?.verifiedClaims.some((claim) => claim.id === reference.claimId));
    const claim = claimResult?.artifact?.verifiedClaims.find((entry) => entry.id === reference.claimId);
    if (!claim || !claimResult) return "verified_artifact_claim_unavailable";
    const blocks = artifactResults.flatMap((page) => page.artifact?.blocks ?? []);
    if (claim.subject !== identity.identity.issuer.id || claim.period === null || claim.unit === null
      || Date.parse(claim.verifiedAt) > Date.parse(identity.context.knowledgeAt)
      || claim.blockIds.some((id) => !blocks.some((block) => block.id === id && block.page === claim.page
        && block.table === claim.table && block.subject === claim.subject && block.period === claim.period && block.unit === claim.unit))) {
      return "artifact_claim_location_subject_period_or_unit_unverified";
    }
    if (blocks.some((block) => claim.blockIds.includes(block.id) && block.extractionState !== "retained_text")) return "artifact_claim_extraction_unverified";
    if (claimResult.page.pageTruncated) return "artifact_claim_page_truncated";
    return null;
  }
  const unknownNotices = pages.flatMap((page) => page.unknownRelationIndex);
  function hasUnknownCorrectionScope(reference: DisclosureEvidenceReference): boolean {
    const parentId = reference.kind === "announcement" ? reference.announcementId
      : artifacts.find((page) => page.artifact?.id === reference.artifactId)?.artifact?.reference;
    const announcementId = typeof parentId === "string" ? parentId : parentId?.kind === "announcement_attachment" ? parentId.id : null;
    const parent = announcements.find((item) => item.id === announcementId);
    if (!parent) return false;
    return unknownNotices.some((notice) => disclosureNoticeMayAffectPublication(notice, parent.publishedAt));
  }
  function sourceText(reference: DisclosureEvidenceReference): string | undefined {
    if (reference.kind === "announcement") return announcements.find((item) => item.id === reference.announcementId)?.explanation.text;
    return artifacts.flatMap((page) => page.artifact?.id === reference.artifactId ? page.artifact.verifiedClaims : []).find((claim) => claim.id === reference.claimId)?.text;
  }
  const candidates = (input.candidates ?? []).map((candidate) => disclosureCandidateSchema.parse(candidate));
  if (new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length) throw new Error("Duplicate disclosure judgment ID");
  const requiredArtifactIds = new Set(candidates.flatMap((candidate) => [
    ...candidate.triggeringEvidence, ...candidate.confirmingEvidence, ...candidate.disconfirmingEvidence, candidate.statusEvidence.reference,
  ]).flatMap((reference) => reference.kind === "artifact_claim" ? [reference.artifactId] : []));
  const lastArtifactPages = new Map(artifacts.flatMap((page) => page.artifact ? [[page.artifact.id, page] as const] : []));
  const artifactIncomplete = [...requiredArtifactIds].some((id) => !lastArtifactPages.has(id))
    || [...lastArtifactPages.values()].some((page) => page.page.nextCursor !== null);
  const assessments = candidates.map((candidate) => {
    const refs = [...candidate.triggeringEvidence, ...candidate.confirmingEvidence, ...candidate.disconfirmingEvidence, candidate.statusEvidence.reference];
    const anchor = candidate.statusEvidence;
    const assertionContexts = publisherAssertionContexts(sourceText(anchor.reference), anchor.excerpt);
    const excerptMatches = assertionContexts.length > 0;
    const date = anchor.eventDate ? Date.parse(`${anchor.eventDate}T00:00:00+08:00`) : Number.NaN;
    const literalDate = anchor.eventDateText?.trim();
    const normalizedDate = normalizePublisherCalendarDate(literalDate);
    const datedStatus = candidate.status === "observed" || candidate.status === "scheduled";
    const dateVerified = !datedStatus || (Number.isFinite(date) && !!literalDate && anchor.excerpt.includes(literalDate)
      && normalizedDate === anchor.eventDate
      && (candidate.status === "observed" ? date <= Date.parse(identity.context.effectiveAt) : date > Date.parse(identity.context.effectiveAt)));
    const anchorAnnouncementId = anchor.reference.kind === "announcement" ? anchor.reference.announcementId : null;
    const occurrenceVerified = candidate.status !== "observed" || (
      /(?:完成|決議|發生|批准|通過|\b(?:approved|completed|occurred)\b)/i.test(anchor.excerpt)
      && assertionContexts.length > 0
      && assertionContexts.every((assertion) => !hasUncertainStatusAssertion(assertion)
        && !/(?:預計|預定|預估|預期|計畫|擬|將於|scheduled|planned|expected)/i.test(assertion))
      && (anchorAnnouncementId === null || announcements.find((item) => item.id === anchorAnnouncementId)?.eventDate === anchor.eventDate)
    );
    const scheduleVerified = candidate.status !== "scheduled" || (assertionContexts.length > 0
      && assertionContexts.every((assertion) => !hasUncertainStatusAssertion(assertion))
      && /(?:預計|預定|訂於|將於|\b(?:scheduled|planned|expected)\b)/i.test(anchor.excerpt));
    const failures = refs.map((reference) => ({ reference, reason: failedReason(reference) })).filter((failure) => failure.reason !== null);
    const sourceReasons = [...new Set([
      ...(!applicable ? ["disclosures_not_applicable"] : !current ? [scanFailure] : []),
      ...(candidate.requiresExhaustiveCoverage && !exhaustive ? ["non_exhaustive_window"] : []),
      ...(!excerptMatches ? ["publisher_excerpt_not_verified"] : []),
      ...(!dateVerified ? ["classification_date_not_verified"] : []),
      ...(!occurrenceVerified || !scheduleVerified ? ["classification_status_not_verified"] : []),
      ...failures.map((failure) => failure.reason!),
    ])];
    const reasons = [...sourceReasons, ...(refs.some(hasUnknownCorrectionScope) ? ["unknown_correction_scope"] : [])];
    return {
      candidate,
      support: reasons.length > 0 ? "withheld" as const : "provisional" as const,
      sourceSupport: sourceReasons.length > 0 ? "withheld" as const : "supported" as const,
      interpretationType: "analytical_judgment" as const,
      statement: reasons.length > 0 ? "This catalyst/risk judgment is withheld because its required evidence is unavailable or insufficient." : candidate.statement,
      reasonCodes: reasons,
      failedDependencies: failures.map((failure) => failure.reference),
    };
  });
  const latestAttempt = first.scan.latestAttempt;
  const limitations = [
    ...(unknownNotices.length ? ["An active correction or retraction has an unknown target. Potentially earlier disclosure interpretations remain withheld; retained source facts are preserved."] : []),
    ...(latestAttempt && latestAttempt.status !== "success" ? [
      scan?.status === "success"
        ? "The latest acquisition attempt did not succeed. The selected successful scan retains its own timestamp and freshness boundary."
        : "The latest acquisition attempt did not succeed. No successful official scan is available at this cutoff.",
    ] : []),
    ...(!exhaustive ? ["Coverage is non-exhaustive; this report cannot establish the absence of other material disclosures."] : []),
    ...(collectionIncomplete ? ["Announcement reads are incomplete; not all collection pages were retrieved."] : []),
    ...(artifactIncomplete ? ["Artifact reads are incomplete; missing dependencies remain withheld."] : []),
    ...(artifacts.some((page) => page.page.totalTruncated) ? ["Retained artifact coverage is bounded; only returned verified claims can support judgments."] : []),
  ];
  return focusedDisclosureReportSchema.parse({
    contractVersion: "research-report/4.0.0", profile: "focused_disclosures",
    selector: identity.selector, context: identity.context, generatedAt: identity.context.knowledgeAt, identity: identity.identity,
    window: { mode, publishedFrom: first.window.publishedFrom, publishedTo: first.window.publishedTo, exhaustive, ...(input.extension ? { extension: input.extension } : {}) },
    reportStatus: collectionIncomplete || artifactIncomplete ? "partial" : "complete",
    officialScanGate: {
      purpose: "final_recommendation", status: !applicable ? "not_applicable" : current ? "passed" : "withheld",
      reasonCodes: !applicable ? ["disclosures_not_applicable"] : current ? [] : [scanFailure],
      statement: !applicable ? "Operating-company disclosure conclusions do not apply to this security."
        : current ? "The current official announcement scan satisfies the disclosure prerequisite only."
          : "A current official announcement scan is required before current catalyst/risk assessment or final recommendation.",
    },
    finalRecommendation: { state: "not_requested", statement: "This focused report does not evaluate the other mandatory recommendation gates and issues no final recommendation." },
    announcementPages: pages, artifactPages: artifacts, assessments, limitations,
    recoveryRequirements: [...new Set([
      ...pages.flatMap((page) => page.quality.recovery), ...artifacts.flatMap((page) => page.quality.recovery),
      ...(!current && applicable ? ["Await a successful current official announcement collection check."] : []),
      ...(assessments.some((assessment) => assessment.support === "withheld") ? ["Obtain the exact failed evidence dependencies before reevaluating withheld judgments."] : []),
    ])],
    evidence: { provenanceIds: [...new Set([
      ...identity.identity.provenance.map((record) => record.id),
      ...pages.flatMap((page) => page.provenance.map((record) => record.id)),
      ...artifacts.flatMap((page) => page.artifact ? [page.artifact.provenance.id] : []),
    ])] },
  });
}

interface DisclosureReportDeps {
  getResearchManifestImpl?: (...args: Parameters<typeof getResearchManifest>) => Promise<z.infer<typeof researchManifestOutputSchema>>;
  getResearchIdentityImpl?: (...args: Parameters<typeof getResearchIdentity>) => Promise<z.infer<typeof researchIdentityOutputSchema>>;
  listMaterialAnnouncementsImpl?: typeof listMaterialAnnouncements;
  getDisclosureArtifactImpl?: typeof getDisclosureArtifact;
}

export async function buildFocusedDisclosureResearchReport(
  persistence: Persistence,
  query: ResearchQuery,
  options: {
    mode?: "standard" | "focused";
    candidates?: z.input<typeof disclosureCandidateSchema>[];
    extension?: FocusedDisclosureResearchReport["window"]["extension"];
    /** Caller-owned orchestration policy bounds all collection/artifact reads. */
    readBudget: number;
  },
  deps: DisclosureReportDeps = {},
): Promise<FocusedDisclosureResearchReport> {
  if (!Number.isSafeInteger(options.readBudget) || options.readBudget < 1) throw new Error("Disclosure read budget must be a positive integer");
  const manifest = await (deps.getResearchManifestImpl ?? getResearchManifest)(persistence, query);
  if (manifest.orchestration.skillExposure !== "enabled") throw new ResearchServiceError("research_dataset_unavailable", "Research skill exposure is disabled");
  const frozen = { subject: manifest.selector, context: manifest.context };
  const identity = await (deps.getResearchIdentityImpl ?? getResearchIdentity)(persistence, { ...frozen, history: { limit: 1 } });
  const mode = options.mode ?? "focused";
  const end = new Date(manifest.context.effectiveAt);
  let start = new Date(end);
  if (options.extension) {
    focusedDisclosureReportSchema.shape.window.shape.extension.parse(options.extension);
    if (mode !== "standard") throw new Error("Long-lived thesis extensions require standard disclosure research");
    start = subtractUtcCalendarMonths(end, options.extension.months);
  } else if (mode === "standard") start = subtractUtcCalendarMonths(end, 12);
  else start.setUTCDate(start.getUTCDate() - 90);
  const readAnnouncements = deps.listMaterialAnnouncementsImpl ?? listMaterialAnnouncements;
  const readArtifact = deps.getDisclosureArtifactImpl ?? getDisclosureArtifact;
  const announcementPages: MaterialAnnouncementsOutput[] = [];
  const artifactPages: DisclosureArtifactOutput[] = [];
  let remaining = options.readBudget;
  let nextCursor: string | null = null;
  do {
    const page: MaterialAnnouncementsOutput = await readAnnouncements(persistence, nextCursor
      ? { subject: manifest.selector, cursor: nextCursor }
      : { ...frozen, range: { publishedFrom: start.toISOString(), publishedTo: end.toISOString() }, limit: 100 });
    announcementPages.push(page);
    nextCursor = page.page.nextCursor;
    remaining -= 1;
  } while (nextCursor && remaining > 0);
  const candidates = (options.candidates ?? []).map((candidate) => disclosureCandidateSchema.parse(candidate));
  const artifactIds = [...new Set(candidates.flatMap((candidate) => [
    ...candidate.triggeringEvidence, ...candidate.confirmingEvidence, ...candidate.disconfirmingEvidence,
    candidate.statusEvidence.reference,
  ]).flatMap((reference) => reference.kind === "artifact_claim" ? [reference.artifactId] : []))];
  for (const artifactId of artifactIds) {
    if (remaining === 0) break;
    let artifactCursor: string | null = null;
    do {
      let page: DisclosureArtifactOutput;
      try {
        page = await readArtifact(persistence, artifactCursor
          ? { subject: manifest.selector, cursor: artifactCursor }
          : { ...frozen, artifactId, limit: 10 });
      } catch (error) {
        // A missing retained dependency withholds its claim; store/context failures still abort.
        if (error instanceof DisclosureServiceError && error.code === "research_artifact_not_referenced") {
          remaining -= 1;
          break;
        }
        throw error;
      }
      artifactPages.push(page);
      artifactCursor = page.page.nextCursor;
      remaining -= 1;
    } while (artifactCursor && remaining > 0);
  }
  return composeFocusedDisclosureResearchReport({ identity, announcementPages, artifactPages, candidates, mode,
    extension: options.extension });
}

function markdown(value: string): string {
  // Entities render as literal punctuation without enabling Markdown syntax or
  // GFM bare-URL autolinking. Encode the original characters in one pass so
  // backslashes and preexisting entity spellings cannot bypass escaping.
  return value.replace(/[\r\n\u2028\u2029]/g, " ")
    .replace(/[\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]/g, (character) => `&#${character.charCodeAt(0)};`);
}

export function renderFocusedDisclosureResearchReportMarkdown(input: FocusedDisclosureResearchReport, locale: "en" | "zh-TW" = "en"): string {
  const translations: Record<string, string> = {
    "Taiwan Disclosure Research": "台灣重大訊息研究", "Listing ID": "上市櫃識別碼", "Knowledge at": "資訊截止時間", "Effective at": "評估基準時間",
    "Publication window": "公告發布期間", "Official scan prerequisite": "官方公告掃描必要條件", "Official disclosures": "官方重大訊息",
    "Evidence excluded from report conclusions": "此證據不納入報告結論",
    "Retained artifact evidence": "留存文件證據", "Catalysts and risks": "催化因素與風險", "Limitations and recovery": "限制與補足條件", "Provenance": "來源沿革",
    "passed": "通過", "withheld": "暫不提出", "not_applicable": "不適用", "available": "可用", "restricted": "存取受限", "processing_failed": "處理失敗", "unavailable": "不可用", "indeterminate": "無法判定",
    "observed": "已觀察", "scheduled": "已排程", "conditional": "有條件", "speculative": "推測", "provisional": "暫定", "supported": "有證據支持", "catalyst": "催化因素", "risk": "風險",
    "Latest acquisition attempt": "最近擷取嘗試", "failed": "失敗", "Selected successful scan": "採用的成功掃描", "Collection quality": "公告集合品質",
    "freshness": "時效", "completeness": "完整性", "confidence": "證據支持程度", "current assessment": "當前評估", "current": "符合時效", "stale": "已過期", "degraded": "降級", "ready": "可用", "partial": "部分", "complete": "完整", "blocked": "受阻",
    "The latest acquisition attempt did not succeed. The selected successful scan retains its own timestamp and freshness boundary.": "最近一次擷取未成功；仍依採用的成功掃描原有時間戳記與時效界線評估。",
    "The latest acquisition attempt did not succeed. No successful official scan is available at this cutoff.": "最近一次擷取未成功；截至資訊截止時間尚無可用的成功官方掃描。",
    "An active correction or retraction has an unknown target. Potentially earlier disclosure interpretations remain withheld; retained source facts are preserved.": "目前有更正或撤回公告尚無法確認指向；可能較早公告的分析判斷暫不提出，原始留存事實仍予保留。",
    "Unresolved source conflict": "來源衝突尚未解決",
    "Unresolved correction/retraction target": "更正／撤回公告之指向尚未確定",
    "Quality": "品質", "text truncated": "內文截斷", "rule": "適用條款", "event": "事件日期", "not reported": "未揭露", "hash": "內容雜湊", "extraction": "擷取版本", "source": "來源",
    "page": "頁", "table": "表", "subject": "主體", "period": "期間", "unit": "單位", "not applicable": "不適用", "unknown": "未知", "Reasons": "原因",
    "Analytical judgment (provisional); source assertion": "分析判斷（暫定）；原始陳述", "Mechanism": "作用機制", "affected": "影響指標或假設", "horizon": "時間範圍",
    "Confirm": "確認條件", "disconfirm": "否定條件", "Condition": "前提條件", "Evidence": "證據", "Status anchor": "狀態依據", "Failed dependency": "未滿足的證據依賴",
    "This catalyst/risk judgment is withheld because its required evidence is unavailable or insufficient.": "所需證據不可用或不足，因此暫不提出此催化因素／風險判斷。",
    "Operating-company disclosure conclusions do not apply to this security.": "營運公司重大訊息結論不適用於此證券。",
    "The current official announcement scan satisfies the disclosure prerequisite only.": "本次官方公告掃描符合時效要求，僅通過重大訊息這一項必要條件。",
    "A current official announcement scan is required before current catalyst/risk assessment or final recommendation.": "提出當前催化因素／風險評估或最終建議前，必須完成符合時效要求的官方公告掃描。",
    "This focused report does not evaluate the other mandatory recommendation gates and issues no final recommendation.": "本專題報告未評估其他必要條件，因此不提出最終建議。",
    "Coverage is non-exhaustive; this report cannot establish the absence of other material disclosures.": "涵蓋範圍並不完整；本報告無法證明不存在其他重大訊息。",
    "Announcement reads are incomplete; not all collection pages were retrieved.": "公告讀取尚未完成，尚未取得全部頁面。",
    "Artifact reads are incomplete; missing dependencies remain withheld.": "文件讀取尚未完成；依賴缺漏證據的判斷仍暫不提出。",
    "Retained artifact coverage is bounded; only returned verified claims can support judgments.": "留存文件讀取範圍有限；僅能使用已回傳並經驗證的陳述支持判斷。",
    "Await a successful current official announcement collection check.": "等待成功且符合時效要求的官方公告掃描。",
    "Obtain the exact failed evidence dependencies before reevaluating withheld judgments.": "補齊缺漏的必要證據後，再重新評估暫不提出的判斷。",
    "Wait for a successful scheduled official announcement scan.": "等待排程的官方公告掃描成功完成。",
    "Operator action required: a physical PDF page exceeds retrieval limits; retain a supported source preserving physical page locations. Dependent claims remain withheld.": "需由維運人員處理：PDF 實體頁面超出讀取上限；請留存系統支援且保留實體頁面位置的來源。依賴該內容的判斷仍暫不提出。",
    "Operator action required: review the official attachment size against acquisition limits and retain a supported bounded source; dependent claims remain withheld.": "需由維運人員處理：依擷取上限檢查官方附件大小，並留存系統支援且大小受限的來源；依賴該附件的判斷仍暫不提出。",
    "Retained artifact content is unavailable; dependent claims must remain withheld.": "留存文件內容不可用；依賴此內容的判斷須暫不提出。",
  };
  const t = (value: string) => locale === "zh-TW" ? translations[value] ?? value : value;
  const report = focusedDisclosureReportSchema.parse(input);
  const verified = composeFocusedDisclosureResearchReport({
    identity: { contractVersion: "research-identity/1.0.0", selector: report.selector, context: report.context,
      identity: report.identity, history: { items: [], nextCursor: null } },
    announcementPages: report.announcementPages, artifactPages: report.artifactPages,
    candidates: report.assessments.map((assessment) => assessment.candidate), mode: report.window.mode,
    extension: report.window.extension,
  });
  if (JSON.stringify(verified.assessments) !== JSON.stringify(report.assessments)
    || JSON.stringify(verified.officialScanGate) !== JSON.stringify(report.officialScanGate)
    || JSON.stringify(verified.finalRecommendation) !== JSON.stringify(report.finalRecommendation)
    || JSON.stringify(verified.window) !== JSON.stringify(report.window)
    || JSON.stringify(verified.limitations) !== JSON.stringify(report.limitations)
    || JSON.stringify(verified.recoveryRequirements) !== JSON.stringify(report.recoveryRequirements)
    || JSON.stringify(verified.evidence) !== JSON.stringify(report.evidence)
    || verified.generatedAt !== report.generatedAt
    || verified.reportStatus !== report.reportStatus) {
    throw new Error("Disclosure report claims or readiness do not match retained evidence");
  }
  const displayedItems = new Set(report.announcementPages.flatMap((page) => page.items.map((item) => item.id)));
  const lineageAudit = new Map<string, string>();
  for (const page of report.announcementPages) {
    for (const entry of [...page.relationIndex, ...page.unresolvedRelationIndex, ...page.unknownRelationIndex]) {
      const sourceId = "announcementId" in entry ? entry.announcementId : entry.sourceAnnouncementId;
      if (displayedItems.has(sourceId)) continue;
      const provenance = page.provenance.find((record) => record.id === entry.provenanceId)!;
      lineageAudit.set(sourceId, `- ${markdown(sourceId)} [${markdown(provenance.id)}]; ${t("source")}: ${markdown(provenance.sourceUrl)}; ${t("hash")}: ${markdown(provenance.contentHash ?? t("unknown"))}; ${t("extraction")}: ${markdown(provenance.parserVersion)}`);
    }
  }
  function assessmentEvidence(assessment: FocusedDisclosureResearchReport["assessments"][number]): string[] {
    const key = (reference: DisclosureEvidenceReference) => JSON.stringify(reference.kind === "announcement"
      ? [reference.kind, reference.announcementId] : [reference.kind, reference.artifactId, reference.claimId]);
    const anchorKey = key(assessment.candidate.statusEvidence.reference);
    const failed = new Set(assessment.failedDependencies.map(key));
    const references = new Map([...assessment.candidate.triggeringEvidence, ...assessment.candidate.confirmingEvidence,
      ...assessment.candidate.disconfirmingEvidence, assessment.candidate.statusEvidence.reference, ...assessment.failedDependencies]
      .map((reference) => [key(reference), reference]));
    return [...references].map(([id, reference]) => {
      const roles = [...(id === anchorKey ? [t("Status anchor")] : []), ...(failed.has(id) ? [t("Failed dependency")] : [])];
      const label = reference.kind === "announcement" ? reference.announcementId : `${reference.artifactId}/${reference.claimId}`;
      return `  ${t("Evidence")}: ${markdown(label)}${roles.length ? ` (${roles.join("; ")})` : ""}`;
    });
  }
  return [
    `# ${t("Taiwan Disclosure Research")}: ${report.identity.listing.venue}:${markdown(report.identity.listing.ticker)}`,
    "", `- ${t("Listing ID")}: ${markdown(report.selector.listingId)}`, `- ${t("Knowledge at")}: ${markdown(report.context.knowledgeAt)}`, `- ${t("Effective at")}: ${markdown(report.context.effectiveAt)}`,
    `- ${t("Publication window")}: ${markdown(report.window.publishedFrom)} – ${markdown(report.window.publishedTo)}`,
    `- ${t("Official scan prerequisite")}: ${t(report.officialScanGate.status)}`,
    `- ${t("Collection quality")}: ${t("freshness")}=${t(report.announcementPages[0]!.quality.freshness)}, ${t("completeness")}=${t(report.announcementPages[0]!.quality.completeness)}, ${t("confidence")}=${t(report.announcementPages[0]!.quality.confidence)}, ${t("current assessment")}=${t(report.announcementPages[0]!.quality.readiness.currentAssessment)}`,
    ...(report.announcementPages[0]!.scan.record?.status === "success" ? [`- ${t("Selected successful scan")}: ${markdown(report.announcementPages[0]!.scan.record.checkedAt)}`] : []),
    ...(report.announcementPages[0]!.scan.latestAttempt ? [`- ${t("Latest acquisition attempt")}: ${t(report.announcementPages[0]!.scan.latestAttempt.status)} (${markdown(report.announcementPages[0]!.scan.latestAttempt.checkedAt)})`] : []),
    t(report.officialScanGate.statement), t(report.finalRecommendation.statement),
    "", `## ${t("Official disclosures")}`, "",
    ...report.announcementPages.flatMap((page) => page.items.flatMap((item) => [
      `- ${markdown(item.publishedAt)}: ${markdown(item.subject)} [${markdown(item.id)}; ${markdown(item.provenance.id)}]`,
      `  ${markdown(item.explanation.text)}`,
      `  ${t("Quality")}: ${t(item.quality)}; ${t("text truncated")}: ${item.explanation.truncated}; ${t("rule")}: ${markdown(item.ruleClause)}; ${t("event")}: ${markdown(item.eventDate ?? t("not reported"))}`,
      ...(page.selection.conflictObservationIds.includes(item.id) ? [`  ${t("Unresolved source conflict")}: ${markdown(item.id)}`] : []),
      ...page.unresolvedRelationIndex.filter((relation) => relation.candidateAnnouncementIds.includes(item.id))
        .map((relation) => `  ${t("Unresolved correction/retraction target")}: ${markdown(relation.sourceAnnouncementId)} (${relation.kind})`),
      ...item.relations.map((relation) => `  ${relation.kind}: ${markdown(relation.targetAnnouncementId)}`),
      ...page.relationIndex.filter((relation) => relation.targetAnnouncementId === item.id)
        .map((relation) => `  ${relation.kind}: ${markdown(relation.announcementId)} → ${markdown(item.id)}`),
      ...(item.detailQuality ? [`  ${t("Quality")} (${t("source")}): ${t(item.detailQuality.status)}; ${markdown(item.detailQuality.reasonCodes.join(", "))}`] : []),
    ])),
    "", `## ${t("Retained artifact evidence")}`, "",
    ...report.artifactPages.flatMap((page) => page.artifact ? [
      ...(artifactReportScopeFailure(page.artifact, report.announcementPages) ? [`- ${t("Evidence excluded from report conclusions")}: ${markdown(artifactReportScopeFailure(page.artifact, report.announcementPages)!)}`] : []),
      `- ${markdown(page.artifact.id)}: ${t(page.artifact.state)}; ${t("hash")} ${markdown(page.artifact.contentHash)}; ${t("extraction")} ${markdown(page.artifact.extractionVersion)}; ${t("source")} ${markdown(page.artifact.sourceUrl)}`,
      ...page.artifact.verifiedClaims.map((claim) => `  ${markdown(claim.text)} [${markdown(claim.id)}; ${t("page")} ${claim.page}; ${t("table")} ${markdown(claim.table ?? t("not applicable"))}; ${t("subject")} ${markdown(claim.subject)}; ${t("period")} ${markdown(claim.period ?? t("unknown"))}; ${t("unit")} ${markdown(claim.unit ?? t("unknown"))}; ${markdown(page.artifact!.provenance.id)}]`),
    ] : []),
    "", `## ${t("Catalysts and risks")}`, "",
    ...report.assessments.flatMap((assessment) => [
      `- ${t(assessment.candidate.kind)} / ${t(assessment.candidate.status)} / ${t(assessment.support)}: ${markdown(assessment.support === "withheld" ? t(assessment.statement) : assessment.statement)} [${markdown(assessment.candidate.id)}]`,
      ...(assessment.support === "withheld" ? [`  ${t("Reasons")}: ${markdown(assessment.reasonCodes.join(", "))}`] : [
        `  ${t("Analytical judgment (provisional); source assertion")}: ${t(assessment.sourceSupport)}. ${t("Mechanism")}: ${markdown(assessment.candidate.materialMechanism)}; ${t("affected")}: ${markdown(assessment.candidate.affectedMetricOrAssumption)}; ${t("horizon")}: ${markdown(assessment.candidate.horizon)}`,
        `  ${t("Confirm")}: ${markdown(assessment.candidate.confirmationCondition)}; ${t("disconfirm")}: ${markdown(assessment.candidate.disconfirmationCondition)}`,
        ...(assessment.candidate.condition ? [`  ${t("Condition")}: ${markdown(assessment.candidate.condition)}`] : []),
      ]),
      ...assessmentEvidence(assessment),
    ]),
    "", `## ${t("Limitations and recovery")}`, "", ...report.limitations.map((item) => `- ${markdown(t(item))}`),
    ...report.recoveryRequirements.map((item) => `- ${markdown(t(item))}`),
    "", `## ${t("Provenance")}`, "", ...report.evidence.provenanceIds.map((id) => `- ${markdown(id)}`), ...lineageAudit.values(),
  ].join("\n");
}
