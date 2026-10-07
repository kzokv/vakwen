import { assessArtifactRevalidation } from "./disclosureFreshness.js";
import { disclosureNoticeMayAffectPublication } from "./disclosureContracts.js";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { Env } from "@vakwen/config";
import type { Persistence } from "../../persistence/types.js";
import {
  researchAnnouncementsQuerySchema, researchAnnouncementsInitialQuerySchema,
  researchDisclosureArtifactQuerySchema, researchDisclosureArtifactInitialQuerySchema,
  materialAnnouncementsOutputSchema, disclosureArtifactOutputSchema,
  type ResearchAnnouncementsQueryInput, type ResearchDisclosureArtifactQueryInput,
  type MaterialAnnouncementsOutput, type DisclosureArtifactOutput,
} from "./contracts.js";
import { getResearchIdentity } from "./service.js";
export * from "./disclosureContracts.js";

const processSecret = randomBytes(32).toString("hex");
const VERSION = "disclosures/1.0.0";
const DAY = 86_400_000;
const RESPONSE_BYTES = 255 * 1024;
export interface DisclosureReadOptions { authorizationBinding?: string; cursorSecret?: string }
export class DisclosureServiceError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode = 422) { super(message); }
}
type AnnouncementQuery = ReturnType<typeof researchAnnouncementsInitialQuerySchema.parse>;
type ArtifactQuery = ReturnType<typeof researchDisclosureArtifactInitialQuerySchema.parse>;
interface Cursor { requestedSubject: unknown; version: string; purpose: string; auth: string; issuedAt: number; query: AnnouncementQuery | ArtifactQuery; after: string; artifactBinding?: string }
function continuityHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function secret(options: DisclosureReadOptions) { return options.cursorSecret ?? Env.SESSION_SECRET ?? processSecret; }
function encode(value: Cursor, options: DisclosureReadOptions): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${createHmac("sha256", secret(options)).update(payload).digest("base64url")}`;
}
function decode(cursor: string, purpose: string, subject: unknown, options: DisclosureReadOptions): Cursor {
  try {
    const [payload, signature, extra] = cursor.split(".");
    if (!payload || !signature || extra) throw new Error();
    const expected = createHmac("sha256", secret(options)).update(payload).digest();
    const actual = Buffer.from(signature, "base64url");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    const value = JSON.parse(Buffer.from(payload, "base64url").toString()) as Cursor;
    if (value.version !== VERSION || value.purpose !== purpose || value.auth !== (options.authorizationBinding ?? "internal")
      || !Number.isFinite(value.issuedAt) || Date.now() - value.issuedAt > DAY || value.issuedAt > Date.now()
      || JSON.stringify(value.requestedSubject) !== JSON.stringify(subject)) throw new Error();
    return value;
  } catch { throw new DisclosureServiceError("research_cursor_invalid", "Disclosure cursor is invalid or expired; restart the bounded read."); }
}
function evidenceSelection(query: AnnouncementQuery | ArtifactQuery, readiness: MaterialAnnouncementsOutput["quality"]["readiness"], selectedIds: string[], conflictIds: string[], excludedCount: number, reasonCodes: string[]) {
  const statuses = { factual_use: readiness.factualUse, current_assessment: readiness.currentAssessment, exhaustive_conclusion: readiness.exhaustiveConclusion };
  return { evidenceView: query.evidenceView, purposes: query.purposes, policyVersion: "disclosure-selection/1.0.0" as const, purposeRegistryVersion: "disclosure-purposes/1.0.0" as const,
    selectedObservationIds: selectedIds, conflictObservationIds: conflictIds, excludedObservationCount: excludedCount, reasonCodes,
    readinessByPurpose: query.purposes.map((purposeId) => ({ purposeId, status: statuses[purposeId], reasonCodes: statuses[purposeId] === "ready" ? [] : [`${purposeId}_${statuses[purposeId]}`] })),
  };
}
function identitySummary(identity: Awaited<ReturnType<typeof getResearchIdentity>>) {
  const { issuer, security, listing, eligibility } = identity.identity;
  return { issuer, security, listing, eligibility };
}
function qualifier(value: string | null) {
  return value === null ? { state: "missing" as const, reason: "unknown" as const } : value === "not_applicable" ? { state: "not_applicable" as const } : { state: "present" as const, value };
}
function eligible(identity: ReturnType<typeof identitySummary>) {
  return identity.security.type === "common_equity" && identity.eligibility.state === "eligible" && identity.eligibility.profile === "operating_company";
}
function scanState(scan: Awaited<ReturnType<Persistence["listResearchDisclosureScans"]>>[number] | undefined, effectiveAt: string): MaterialAnnouncementsOutput["scan"]["status"] {
  if (!scan) return "not_acquired";
  if (scan.status !== "success") return scan.status;
  const age = Date.parse(effectiveAt) - Date.parse(scan.checkedAt);
  return age <= 30 * 60_000 ? "current" : age <= 2 * 3_600_000 ? "indeterminate" : "stale";
}
export async function listMaterialAnnouncements(persistence: Persistence, input: ResearchAnnouncementsQueryInput, options: DisclosureReadOptions = {}): Promise<MaterialAnnouncementsOutput> {
  const parsed = researchAnnouncementsQuerySchema.parse(input);
  const cursor = "cursor" in parsed ? decode(parsed.cursor, "announcements", parsed.subject, options) : null;
  const query = researchAnnouncementsInitialQuerySchema.parse(cursor?.query ?? parsed);
  const identity = await getResearchIdentity(persistence, { subject: query.subject, context: query.context, history: { limit: 1 } });
  const summary = identitySummary(identity);
  const end = query.range?.publishedTo ?? query.context.effectiveAt;
  const start = query.range?.publishedFrom ?? new Date(Date.parse(end) - 90 * DAY).toISOString();
  const maxStart = new Date(end);
  const endMonth = maxStart.getUTCMonth();
  maxStart.setUTCFullYear(maxStart.getUTCFullYear() - 2);
  if (maxStart.getUTCMonth() !== endMonth) maxStart.setUTCDate(0);
  if (Date.parse(start) > Date.parse(end) || Date.parse(start) < maxStart.getTime() || Date.parse(end) > Date.parse(query.context.effectiveAt)
    || (query.range?.eventFrom && query.range.eventTo && query.range.eventFrom > query.range.eventTo)) {
    throw new DisclosureServiceError("research_range_invalid", "Publication range must be ordered, no wider than two years, and bounded by effectiveAt.");
  }
  const storeQuery = { issuerId: summary.issuer.id, knowledgeAt: query.context.knowledgeAt, effectiveAt: query.context.effectiveAt };
  const applicable = eligible(summary);
  const scope = { ...storeQuery, listingId: summary.listing.id, venue: summary.listing.venue };
  const [issuerAnnouncements, scans] = applicable ? await Promise.all([persistence.listResearchAnnouncementSelectionMetadata({ ...scope, publishedFrom: start, publishedTo: end, eventFrom: query.range?.eventFrom, eventTo: query.range?.eventTo }), persistence.listLatestResearchDisclosureScans(scope)]) : [[], []];
  const all = issuerAnnouncements.filter((record) => record.listingId === summary.listing.id && record.venue === summary.listing.venue);
  const orderedScans = scans.filter((scan) => scan.listingId === summary.listing.id && scan.venue === summary.listing.venue)
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt) || b.id.localeCompare(a.id));
  const latestAttempt = orderedScans[0];
  const selectedScan = orderedScans.find((scan) => scan.status === "success") ?? latestAttempt;
  const exhaustive = selectedScan?.status === "success" && selectedScan.exhaustive && Date.parse(selectedScan.publicationStart) <= Date.parse(start) && Date.parse(selectedScan.publicationEnd) >= Date.parse(end);
  const superseded = new Set(all.filter((record) => record.quality === "available").flatMap((record) => record.relations.filter((relation) => relation.kind === "supersedes").map((relation) => relation.targetAnnouncementId)));
  const selectedRecords = all.filter((record) => !superseded.has(record.id));
  const groups = new Map<string, string[]>();
  for (const record of selectedRecords) { const key = record.publisherRecordId ?? record.collectionRecordId ?? record.id; groups.set(key, [...(groups.get(key) ?? []), record.id]); }
  const conflictIds = new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
  // Resolve lineage across retained listing evidence before restricting metadata
  // to the requested window: an out-of-window revision still invalidates its target.
  const inRange = (record: (typeof all)[number]) => Date.parse(record.publishedAt) >= Date.parse(start) && Date.parse(record.publishedAt) <= Date.parse(end)
    && (!query.range?.eventFrom || (record.eventDate !== null && record.eventDate >= query.range.eventFrom))
    && (!query.range?.eventTo || (record.eventDate !== null && record.eventDate <= query.range.eventTo));
  const scopedAll = all.filter(inRange);
  const scopedSelected = selectedRecords.filter(inRange);
  const rows = (query.evidenceView === "all_observations" ? scopedAll : scopedSelected)
    .sort((a, b) => (Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.id.localeCompare(b.id)) * (query.order === "asc" ? 1 : -1));
  const queryHash = continuityHash({ purpose: "announcements", version: VERSION, query: { ...query, subject: identity.selector, context: identity.context }, range: { start, end }, rows, lineage: [...all].sort((a, b) => a.id.localeCompare(b.id)) });
  const offset = cursor ? rows.findIndex((row) => row.id === cursor.after) + 1 : 0;
  if (cursor && offset === 0) throw new DisclosureServiceError("research_cursor_invalid", "Announcement cursor boundary no longer matches retained evidence.");
  const items: MaterialAnnouncementsOutput["items"] = [];
  let bytes = 0;
  let budgetTruncated = false;
  const pageIds = rows.slice(offset, offset + query.limit).map((record) => record.id);
  const payloads = new Map((await persistence.getResearchAnnouncementsByIds({ ...scope, ids: pageIds })).map((record) => [record.id, record]));
  for (const id of pageIds) {
    const record = payloads.get(id);
    if (!record) throw new DisclosureServiceError("research_cursor_invalid", "Selected immutable announcement is no longer available.");
    const characters = Array.from(record.explanation);
    const text = record.quality === "available" ? characters.slice(0, 20_000).join("") : "";
    const item = { ...record, explanation: { text, originalCharacters: characters.length, retainedCharacters: Array.from(text).length,
      truncated: Array.from(text).length !== characters.length, contentHash: record.provenance.contentHash, sourceUrl: record.sourceUrl, location: "issuer_explanation" as const } };
    const size = Buffer.byteLength(JSON.stringify(item));
    if (size > RESPONSE_BYTES - 16_384 && items.length === 0) throw new DisclosureServiceError("record_too_large", "Announcement exceeds response budget; narrow the retained evidence view.");
    if (bytes + size > RESPONSE_BYTES - 16_384) { budgetTruncated = true; break; }
    bytes += size; items.push(item);
  }
  const more = offset + items.length < rows.length;
  const nextCursor = more ? encode({ version: VERSION, purpose: "announcements", auth: options.authorizationBinding ?? "internal", issuedAt: cursor?.issuedAt ?? Date.now(), query: { ...query, subject: identity.selector }, requestedSubject: cursor?.requestedSubject ?? parsed.subject, after: items.at(-1)!.id }, options) : null;
  const status = applicable ? scanState(selectedScan, query.context.effectiveAt) : "not_applicable";
  const attachmentRefreshMissing = items.some((item) => item.attachments.some((attachment) => attachment.artifactId !== null
    && !["current", "not_applicable"].includes(assessArtifactRevalidation({ id: attachment.artifactId, reference: { kind: "announcement_attachment", id: item.id }, sourceUrl: attachment.sourceUrl }, selectedScan, query.context))));
  const attachmentRefreshFailed = latestAttempt?.artifactAttempts?.some((attempt) => attempt.status !== "retained") ?? false;
  const quality: MaterialAnnouncementsOutput["quality"] = {
    freshness: status === "current" ? "current" : status === "stale" ? "stale" : !applicable ? "not_applicable" : "indeterminate",
    completeness: !applicable ? "not_applicable" : exhaustive ? more || offset > 0 ? "partial" : "complete" : "indeterminate",
    confidence: selectedScan?.status === "success" ? "supported" : "indeterminate",
    readiness: { factualUse: !applicable ? "not_applicable" : items.some((item) => item.quality === "available") ? "degraded" : "blocked", currentAssessment: !applicable ? "not_applicable" : status === "current" ? latestAttempt?.status === "success" && !attachmentRefreshFailed && !attachmentRefreshMissing ? "ready" : "degraded" : "blocked", exhaustiveConclusion: !applicable ? "not_applicable" : exhaustive && !more && offset === 0 ? "ready" : "blocked" },
    versions: { contract: VERSION, freshnessPolicy: "official-scan/1.0.0", exposurePolicy: "retained-disclosures/1.0.0" },
    status: !applicable ? "not_applicable" : status === "not_acquired" ? "not_acquired" : status === "restricted" || status === "processing_failed" ? status : status === "current" ? "available" : "indeterminate",
    reasonCodes: [...(attachmentRefreshMissing ? ["attachment_current_revalidation_missing"] : []), ...(attachmentRefreshFailed ? ["attachment_refresh_failed"] : []), ...(latestAttempt && latestAttempt.status !== "success" ? ["latest_refresh_failed"] : []), ...(!exhaustive ? ["non_exhaustive_window"] : []), ...(status !== "current" ? [`official_scan_${status}`] : [])],
    recovery: [...(applicable && (status !== "current" || latestAttempt?.status !== "success") ? ["Wait for a successful scheduled official announcement scan."] : []), ...(attachmentRefreshFailed ? ["Retained artifact content is unavailable; dependent claims must remain withheld."] : []), ...(attachmentRefreshMissing ? ["Current interpretations require successful revalidation of this source locator; retained historical facts remain available."] : [])],
  };
  const provenanceById = new Map(all.map((record) => [record.provenance.id, record.provenance]));
  const pageProvenance = (page: Pick<MaterialAnnouncementsOutput, "items" | "relationIndex" | "unresolvedRelationIndex" | "unknownRelationIndex">) => {
    const ids = new Set([...page.items.map((item) => item.provenance.id), ...page.relationIndex.map((entry) => entry.provenanceId), ...page.unresolvedRelationIndex.map((entry) => entry.provenanceId), ...page.unknownRelationIndex.map((entry) => entry.provenanceId)]);
    return [...ids].sort().map((id) => provenanceById.get(id)!);
  };
  const relationIndex = all.filter((row) => row.quality === "available").flatMap((row) => row.relations.filter((relation) => (relation.kind === "supersedes" || !superseded.has(row.id)) && items.some((item) => item.id === row.id || item.id === relation.targetAnnouncementId)).map((relation) => ({ announcementId: row.id, provenanceId: row.provenance.id, ...relation })));
  const unknownRelationIndex = all.filter((row) => row.quality === "available" && !superseded.has(row.id) && items.some((item) => disclosureNoticeMayAffectPublication(row, item.publishedAt))).flatMap((row) => (row.unknownRelationTargets ?? []).map((relation) => ({ sourceAnnouncementId: row.id, provenanceId: row.provenance.id, kind: relation.kind, publishedAt: row.publishedAt, publicationPrecision: row.publicationPrecision }))).sort((a, b) => a.sourceAnnouncementId.localeCompare(b.sourceAnnouncementId) || a.kind.localeCompare(b.kind));
  const unresolvedRelationIndex = all.filter((row) => row.quality === "available" && !superseded.has(row.id)).flatMap((row) => (row.unresolvedRelations ?? []).map((relation) => ({ sourceAnnouncementId: row.id, provenanceId: row.provenance.id, kind: relation.kind, candidateAnnouncementIds: relation.candidateAnnouncementIds.filter((id) => items.some((item) => item.id === id)) })).filter((relation) => relation.candidateAnnouncementIds.length > 0)).sort((a, b) => a.sourceAnnouncementId.localeCompare(b.sourceAnnouncementId) || a.kind.localeCompare(b.kind));
  const output = materialAnnouncementsOutputSchema.parse({ contractVersion: "material-announcements/1.0.0", selector: identity.selector, context: identity.context, identity: summary,
    selection: evidenceSelection(query, quality.readiness, items.filter((item) => !superseded.has(item.id)).map((item) => item.id), items.filter((item) => conflictIds.has(item.id)).map((item) => item.id), query.evidenceView === "all_observations" ? 0 : scopedAll.length - scopedSelected.length, [query.evidenceView === "all_observations" ? "audit_all_retained_observations" : "authoritative_supersession_selected", ...(rows.some((row) => conflictIds.has(row.id)) ? ["open_equal_authority_conflict_retained"] : [])]),
    window: { publishedFrom: start, publishedTo: end, ...(query.range?.eventFrom ? { eventFrom: query.range.eventFrom } : {}), ...(query.range?.eventTo ? { eventTo: query.range.eventTo } : {}), exhaustive }, quality,
    scan: { status, checkedAt: selectedScan?.checkedAt ?? null, record: selectedScan ? Object.fromEntries(Object.entries(selectedScan).filter(([key]) => key !== "acquisitionContinuation")) : null, latestAttempt: latestAttempt ? Object.fromEntries(Object.entries(latestAttempt).filter(([key]) => key !== "acquisitionContinuation")) : null, eventFactFreshness: "not_applicable" }, items,
    relationIndex,
    unknownRelationIndex,
    unresolvedRelationIndex,
    page: { continuity: { queryHash, offset, returnedCount: items.length, totalCount: rows.length, requestCursor: "cursor" in parsed ? parsed.cursor : null }, nextCursor, order: query.order, limit: query.limit, truncatedBy: more ? budgetTruncated ? "response_budget" : "page_limit" : null },
    provenance: pageProvenance({ items, relationIndex, unknownRelationIndex, unresolvedRelationIndex }),
  });
  while (Buffer.byteLength(JSON.stringify(output)) > RESPONSE_BYTES && output.items.length > 1) {
    output.items.pop();
    output.page.continuity.returnedCount = output.items.length;
    const retainedIds = new Set(output.items.map((item) => item.id));
    output.unknownRelationIndex = output.unknownRelationIndex.filter((notice) => output.items.some((item) => disclosureNoticeMayAffectPublication(notice, item.publishedAt)));
    output.unresolvedRelationIndex = output.unresolvedRelationIndex.map((relation) => ({ ...relation, candidateAnnouncementIds: relation.candidateAnnouncementIds.filter((id) => retainedIds.has(id)) })).filter((relation) => relation.candidateAnnouncementIds.length > 0);
    output.relationIndex = output.relationIndex.filter((relation) => retainedIds.has(relation.announcementId) || retainedIds.has(relation.targetAnnouncementId));
    output.provenance = pageProvenance(output);
    output.page.nextCursor = encode({ version: VERSION, purpose: "announcements", auth: options.authorizationBinding ?? "internal", issuedAt: cursor?.issuedAt ?? Date.now(), query: { ...query, subject: identity.selector }, requestedSubject: cursor?.requestedSubject ?? parsed.subject, after: output.items.at(-1)!.id }, options);
    output.page.truncatedBy = "response_budget";
    output.quality.completeness = "partial";
    output.quality.readiness.exhaustiveConclusion = "blocked";
    output.selection = evidenceSelection(query, output.quality.readiness, output.items.filter((item) => !superseded.has(item.id)).map((item) => item.id), output.items.filter((item) => conflictIds.has(item.id)).map((item) => item.id), output.selection.excludedObservationCount, output.selection.reasonCodes);
  }
  if (Buffer.byteLength(JSON.stringify(output)) > RESPONSE_BYTES) throw new DisclosureServiceError("record_too_large", "A complete announcement and its lineage exceed the response budget.");
  return output;
}
export async function getDisclosureArtifact(persistence: Persistence, input: ResearchDisclosureArtifactQueryInput, options: DisclosureReadOptions = {}): Promise<DisclosureArtifactOutput> {
  const parsed = researchDisclosureArtifactQuerySchema.parse(input);
  const cursor = "cursor" in parsed ? decode(parsed.cursor, "artifact", parsed.subject, options) : null;
  const query = researchDisclosureArtifactInitialQuerySchema.parse(cursor?.query ?? parsed);
  const identity = await getResearchIdentity(persistence, { subject: query.subject, context: query.context, history: { limit: 1 } });
  const summary = identitySummary(identity);
  const storeQuery = { issuerId: summary.issuer.id, knowledgeAt: query.context.knowledgeAt, effectiveAt: query.context.effectiveAt };
  const artifacts = eligible(summary) ? await persistence.listResearchDisclosureArtifacts({ ...storeQuery, artifactId: query.artifactId }) : [];
  const artifact = artifacts.find((record) => record.id === query.artifactId);
  const announcementReferenced = eligible(summary) ? await persistence.hasResearchDisclosureArtifactReference({ ...storeQuery, listingId: summary.listing.id, venue: summary.listing.venue, artifactId: query.artifactId, ...(artifact ? { reference: artifact.reference } : {}) }) : false;
  if (eligible(summary) && (!announcementReferenced || (artifact !== undefined && /xbrl/i.test(artifact.mediaType)))) {
    throw new DisclosureServiceError("research_artifact_not_referenced", "Artifact must be retained evidence referenced by this subject's announcement or material.");
  }
  const latestArtifactAttempt = !artifact && announcementReferenced ? await persistence.getLatestResearchDisclosureArtifactAttempt({ ...storeQuery, listingId: summary.listing.id, venue: summary.listing.venue, artifactId: query.artifactId }) : null;
  const attempts = latestArtifactAttempt ? [latestArtifactAttempt] : [];
  const unavailableState = attempts[0]?.status === "restricted" ? "restricted" : attempts[0]?.status === "processing_failed" ? "processing_failed" : "not_acquired";
  const binding = artifact ? `${artifact.id}:${artifact.contentHash}:${artifact.extractionVersion}` : "";
  if (cursor && cursor.artifactBinding !== binding) throw new DisclosureServiceError("research_cursor_invalid", "Artifact hash or extraction version does not match cursor.");
  const available = artifact?.state === "available";
  const scans = available ? await persistence.listLatestResearchDisclosureScans({ ...storeQuery, listingId: summary.listing.id, venue: summary.listing.venue }) : [];
  const selectedScan = scans.filter((scan) => scan.listingId === summary.listing.id && scan.venue === summary.listing.venue && scan.status === "success")
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt) || b.id.localeCompare(a.id))[0];
  const revalidation = artifact ? assessArtifactRevalidation(artifact, selectedScan, query.context) : "not_applicable";
  const revalidationFailed = revalidation !== "current" && revalidation !== "not_applicable";
  const pages = artifact && available ? Array.from({ length: artifact.totalPages }, (_, index) => index + 1).sort((a, b) => (a - b) * (query.order === "asc" ? 1 : -1)) : [];
  const queryHash = continuityHash({ purpose: "artifact", version: VERSION, query: { ...query, subject: identity.selector, context: identity.context }, binding, artifact, pages, revalidation });
  const offset = cursor ? pages.indexOf(Number(cursor.after)) + 1 : 0;
  if (cursor && offset === 0) throw new DisclosureServiceError("research_cursor_invalid", "Artifact page boundary is invalid.");
  const eligibleBlocks = available ? artifact!.blocks.filter((block) => block.subject === summary.issuer.id) : [];
  const retainedBlockIds = new Set(eligibleBlocks.filter((block) => block.extractionState === "retained_text").map((block) => block.id));
  const eligibleClaims = available ? artifact!.verifiedClaims.filter((claim) => claim.subject === summary.issuer.id
    && Date.parse(claim.verifiedAt) <= Date.parse(query.context.knowledgeAt)
    && claim.blockIds.every((id) => retainedBlockIds.has(id) && eligibleBlocks.some((block) => block.id === id && block.page === claim.page
      && block.table === claim.table && block.period === claim.period && block.unit === claim.unit))) : [];
  const selectedPages: number[] = [];
  let count = 0;
  for (const page of pages.slice(offset, offset + query.limit)) {
    const pageBlocks = eligibleBlocks.filter((block) => block.page === page);
    const size = pageBlocks.reduce((total, block) => total + Array.from(block.text).length, 0)
      + eligibleClaims.filter((claim) => claim.page === page).reduce((total, claim) => total + Array.from(claim.text).length, 0);
    if (size > 50_000 && selectedPages.length === 0) throw new DisclosureServiceError("record_too_large", "Retained page exceeds 50,000 characters; a narrower retained artifact is required.");
    if (count + size > 50_000) break;
    count += size; selectedPages.push(page);
  }
  const blocks = eligibleBlocks.filter((block) => selectedPages.includes(block.page));
  const verifiedClaims = eligibleClaims.filter((claim) => selectedPages.includes(claim.page));
  const missingPages = selectedPages.some((page) => !blocks.some((block) => block.page === page) && !artifact?.confirmedEmptyPages?.includes(page));
  const provisional = blocks.some((block) => block.extractionState === "provisional_ocr");
  const retainedCharacters = blocks.reduce((total, block) => total + Array.from(block.text).length, 0) + verifiedClaims.reduce((total, claim) => total + Array.from(claim.text).length, 0);
  const more = offset + selectedPages.length < pages.length;
  const nextCursor = more ? encode({ version: VERSION, purpose: "artifact", auth: options.authorizationBinding ?? "internal", issuedAt: cursor?.issuedAt ?? Date.now(), query: { ...query, subject: identity.selector }, requestedSubject: cursor?.requestedSubject ?? parsed.subject, after: String(selectedPages.at(-1)), artifactBinding: binding }, options) : null;
  const artifactReadiness: MaterialAnnouncementsOutput["quality"]["readiness"] = { factualUse: !eligible(summary) ? "not_applicable" : available ? more || missingPages || provisional ? "degraded" : "ready" : "blocked", currentAssessment: !available || revalidation === "not_applicable" ? "not_applicable" : revalidationFailed ? "blocked" : "ready", exhaustiveConclusion: !eligible(summary) ? "not_applicable" : available && !more && offset === 0 && !missingPages ? "ready" : "blocked" };
  const exposedArtifact = artifact ? Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "retainedBytesBase64")) : null;
  const output = disclosureArtifactOutputSchema.parse({ contractVersion: "disclosure-artifact/1.0.0", selector: identity.selector, context: identity.context, identity: summary,
    selection: evidenceSelection(query, artifactReadiness, [...blocks.map((block) => block.id), ...verifiedClaims.map((claim) => claim.id)], [], 0, ["immutable_retained_artifact_selected"]),
    quality: {
      freshness: revalidation === "not_applicable" ? "not_applicable" : revalidation === "current" ? "current" : revalidation === "artifact_current_revalidation_stale" ? "stale" : "indeterminate", completeness: !eligible(summary) ? "not_applicable" : available && !missingPages ? more || offset > 0 ? "partial" : "complete" : "indeterminate", confidence: !available || missingPages ? "indeterminate" : provisional ? "provisional" : verifiedClaims.length > 0 ? "verified" : "supported",
      readiness: artifactReadiness,
      versions: { contract: VERSION, freshnessPolicy: "official-scan/1.0.0", exposurePolicy: "retained-disclosures/1.0.0" },
      status: !eligible(summary) ? "not_applicable" : artifact?.state === "unavailable" ? "not_acquired" : artifact?.state ?? unavailableState, reasonCodes: available ? revalidationFailed ? [revalidation] : [] : [artifact?.state ?? (eligible(summary) ? unavailableState : "not_applicable_subject"), ...(attempts[0]?.reasonCode ? [attempts[0].reasonCode] : [])], recovery: available ? revalidationFailed ? ["Current interpretations require successful revalidation of this source locator; retained historical facts remain available."] : [] : [attempts[0]?.reasonCode === "disclosure_extraction_physical_page_limit" ? "Operator action required: a physical PDF page exceeds retrieval limits; retain a supported source preserving physical page locations. Dependent claims remain withheld." : attempts[0]?.reasonCode === "disclosure_source_too_large" ? "Operator action required: review the official attachment size against acquisition limits and retain a supported bounded source; dependent claims remain withheld." : "Retained artifact content is unavailable; dependent claims must remain withheld."] },
    artifact: exposedArtifact ? { ...exposedArtifact,
      blocks: blocks.map((block) => ({ ...block, qualifiers: { period: qualifier(block.period), unit: qualifier(block.unit) } })),
      verifiedClaims: verifiedClaims.map((claim) => ({ ...claim, qualifiers: { period: qualifier(claim.period), unit: qualifier(claim.unit) } })),
    } : null,
    page: { continuity: { queryHash, offset, returnedCount: selectedPages.length, totalCount: pages.length, requestCursor: "cursor" in parsed ? parsed.cursor : null }, nextCursor, returnedPages: selectedPages, totalPages: artifact?.totalPages ?? 0, retainedCharacters,
      originalCharacters: artifact ? artifact.blocks.reduce((total, block) => total + Array.from(block.text).length, 0) + artifact.verifiedClaims.reduce((total, claim) => total + Array.from(claim.text).length, 0) : 0,
      pageTruncated: missingPages, totalTruncated: more || offset > 0 || !available || missingPages },
  });
  if (Buffer.byteLength(JSON.stringify(output)) > RESPONSE_BYTES) throw new DisclosureServiceError("record_too_large", "Artifact response exceeds byte budget; request fewer pages.");
  return output;
}
