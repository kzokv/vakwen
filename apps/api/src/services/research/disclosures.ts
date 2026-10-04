import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
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
  const maxStart = new Date(end); maxStart.setUTCFullYear(maxStart.getUTCFullYear() - 2);
  if (Date.parse(start) > Date.parse(end) || Date.parse(start) < maxStart.getTime() || Date.parse(end) > Date.parse(query.context.effectiveAt)
    || (query.range?.eventFrom && query.range.eventTo && query.range.eventFrom > query.range.eventTo)) {
    throw new DisclosureServiceError("research_range_invalid", "Publication range must be ordered, no wider than two years, and bounded by effectiveAt.");
  }
  const storeQuery = { issuerId: summary.issuer.id, knowledgeAt: query.context.knowledgeAt, effectiveAt: query.context.effectiveAt };
  const applicable = eligible(summary);
  const [issuerAnnouncements, scans] = applicable ? await Promise.all([persistence.listResearchAnnouncements(storeQuery), persistence.listResearchDisclosureScans(storeQuery)]) : [[], []];
  const all = issuerAnnouncements.filter((record) => record.listingId === summary.listing.id && record.venue === summary.listing.venue);
  const orderedScans = scans.filter((scan) => scan.listingId === summary.listing.id && scan.venue === summary.listing.venue)
    .sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt) || b.id.localeCompare(a.id));
  const latestAttempt = orderedScans[0];
  const selectedScan = orderedScans.find((scan) => scan.status === "success") ?? latestAttempt;
  const exhaustive = selectedScan?.status === "success" && selectedScan.exhaustive && Date.parse(selectedScan.publicationStart) <= Date.parse(start) && Date.parse(selectedScan.publicationEnd) >= Date.parse(end);
  const superseded = new Set(all.filter((record) => record.quality === "available").flatMap((record) => record.relations.filter((relation) => relation.kind === "supersedes").map((relation) => relation.targetAnnouncementId)));
  const selectedRecords = all.filter((record) => !superseded.has(record.id));
  const groups = new Map<string, string[]>();
  for (const record of selectedRecords) { const key = record.collectionRecordId ?? record.id; groups.set(key, [...(groups.get(key) ?? []), record.id]); }
  const conflictIds = new Set([...groups.values()].filter((ids) => ids.length > 1).flat());
  const viewRecords = query.evidenceView === "all_observations" ? all : selectedRecords;
  const rows = viewRecords.filter((record) => Date.parse(record.publishedAt) >= Date.parse(start) && Date.parse(record.publishedAt) <= Date.parse(end)
    && (!query.range?.eventFrom || (record.eventDate !== null && record.eventDate >= query.range.eventFrom))
    && (!query.range?.eventTo || (record.eventDate !== null && record.eventDate <= query.range.eventTo)))
    .sort((a, b) => (Date.parse(a.publishedAt) - Date.parse(b.publishedAt) || a.id.localeCompare(b.id)) * (query.order === "asc" ? 1 : -1));
  const offset = cursor ? rows.findIndex((row) => row.id === cursor.after) + 1 : 0;
  if (cursor && offset === 0) throw new DisclosureServiceError("research_cursor_invalid", "Announcement cursor boundary no longer matches retained evidence.");
  const items: MaterialAnnouncementsOutput["items"] = [];
  let bytes = 0;
  let budgetTruncated = false;
  for (const record of rows.slice(offset, offset + query.limit)) {
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
  const quality: MaterialAnnouncementsOutput["quality"] = {
    freshness: status === "current" ? "current" : status === "stale" ? "stale" : !applicable ? "not_applicable" : "indeterminate",
    completeness: !applicable ? "not_applicable" : exhaustive ? more ? "partial" : "complete" : "indeterminate",
    confidence: selectedScan?.status === "success" ? "supported" : "indeterminate",
    readiness: { factualUse: !applicable ? "not_applicable" : items.some((item) => item.quality === "available") ? "degraded" : "blocked", currentAssessment: !applicable ? "not_applicable" : status === "current" ? latestAttempt?.status === "success" ? "ready" : "degraded" : "blocked", exhaustiveConclusion: !applicable ? "not_applicable" : exhaustive && !more ? "ready" : "blocked" },
    versions: { contract: VERSION, freshnessPolicy: "official-scan/1.0.0", exposurePolicy: "retained-disclosures/1.0.0" },
    status: !applicable ? "not_applicable" : status === "not_acquired" ? "not_acquired" : status === "restricted" || status === "processing_failed" ? status : status === "current" ? "available" : "indeterminate",
    reasonCodes: [...(latestAttempt && latestAttempt.status !== "success" ? ["latest_refresh_failed"] : []), ...(!exhaustive ? ["non_exhaustive_window"] : []), ...(status !== "current" ? [`official_scan_${status}`] : [])],
    recovery: applicable && (status !== "current" || latestAttempt?.status !== "success") ? ["Wait for a successful scheduled official announcement scan."] : [],
  };
  const output = materialAnnouncementsOutputSchema.parse({ contractVersion: "material-announcements/1.0.0", selector: identity.selector, context: identity.context, identity: summary,
    selection: evidenceSelection(query, quality.readiness, items.filter((item) => !superseded.has(item.id)).map((item) => item.id), items.filter((item) => conflictIds.has(item.id)).map((item) => item.id), query.evidenceView === "all_observations" ? 0 : all.length - selectedRecords.length, [query.evidenceView === "all_observations" ? "audit_all_retained_observations" : "authoritative_supersession_selected", ...(conflictIds.size > 0 ? ["open_equal_authority_conflict_retained"] : [])]),
    window: { publishedFrom: start, publishedTo: end, ...(query.range?.eventFrom ? { eventFrom: query.range.eventFrom } : {}), ...(query.range?.eventTo ? { eventTo: query.range.eventTo } : {}), exhaustive }, quality,
    scan: { status, checkedAt: selectedScan?.checkedAt ?? null, record: selectedScan ?? null, latestAttempt: latestAttempt ?? null, eventFactFreshness: "not_applicable" }, items,
    relationIndex: all.flatMap((row) => row.relations.filter((relation) => items.some((item) => item.id === row.id || item.id === relation.targetAnnouncementId)).map((relation) => ({ announcementId: row.id, ...relation }))),
    page: { nextCursor, order: query.order, limit: query.limit, truncatedBy: more ? budgetTruncated ? "response_budget" : "page_limit" : null },
    provenance: [...new Map(items.map((item) => [item.provenance.id, item.provenance])).values()],
  });
  while (Buffer.byteLength(JSON.stringify(output)) > RESPONSE_BYTES && output.items.length > 1) {
    output.items.pop();
    const retainedIds = new Set(output.items.map((item) => item.id));
    output.relationIndex = output.relationIndex.filter((relation) => retainedIds.has(relation.announcementId) || retainedIds.has(relation.targetAnnouncementId));
    output.provenance = [...new Map(output.items.map((item) => [item.provenance.id, item.provenance])).values()];
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
  const [artifacts, issuerAnnouncements] = eligible(summary) ? await Promise.all([persistence.listResearchDisclosureArtifacts(storeQuery), persistence.listResearchAnnouncements(storeQuery)]) : [[], []];
  const announcements = issuerAnnouncements.filter((record) => record.listingId === summary.listing.id && record.venue === summary.listing.venue);
  const artifact = artifacts.find((record) => record.id === query.artifactId);
  const materialReferences = artifact?.reference.kind === "investor_material" ? await persistence.listResearchDisclosureMaterialReferences(storeQuery) : [];
  const announcementReferenced = announcements.some((record) => record.attachments.some((attachment) => attachment.artifactId === query.artifactId));
  const materialReferenced = artifact?.reference.kind !== "investor_material" || materialReferences.some((reference) => reference.id === artifact.reference.id && reference.listingId === summary.listing.id && reference.venue === summary.listing.venue && reference.artifactIds.includes(artifact.id));
  if (eligible(summary) && ((!artifact && !announcementReferenced) || !materialReferenced || (artifact !== undefined && /xbrl/i.test(artifact.mediaType)) || (artifact?.reference.kind === "announcement_attachment" && !announcements.some((record) => record.id === artifact.reference.id && record.attachments.some((attachment) => attachment.artifactId === artifact.id))))) {
    throw new DisclosureServiceError("research_artifact_not_referenced", "Artifact must be retained evidence referenced by this subject's announcement or material.");
  }
  const attempts = !artifact && announcementReferenced ? (await persistence.listResearchDisclosureScans(storeQuery)).filter((scan) => scan.listingId === summary.listing.id && scan.venue === summary.listing.venue).flatMap((scan) => scan.artifactAttempts ?? [])
    .filter((attempt) => attempt.artifactId === query.artifactId && Date.parse(attempt.attemptedAt) <= Date.parse(query.context.knowledgeAt)).sort((a, b) => Date.parse(b.attemptedAt) - Date.parse(a.attemptedAt)) : [];
  const unavailableState = attempts[0]?.status === "restricted" ? "restricted" : attempts[0]?.status === "processing_failed" ? "processing_failed" : "not_acquired";
  const binding = artifact ? `${artifact.id}:${artifact.contentHash}:${artifact.extractionVersion}` : "";
  if (cursor && cursor.artifactBinding !== binding) throw new DisclosureServiceError("research_cursor_invalid", "Artifact hash or extraction version does not match cursor.");
  const available = artifact?.state === "available";
  const pages = artifact && available ? Array.from({ length: artifact.totalPages }, (_, index) => index + 1).sort((a, b) => (a - b) * (query.order === "asc" ? 1 : -1)) : [];
  const offset = cursor ? pages.indexOf(Number(cursor.after)) + 1 : 0;
  if (cursor && offset === 0) throw new DisclosureServiceError("research_cursor_invalid", "Artifact page boundary is invalid.");
  const selectedPages: number[] = [];
  let count = 0;
  for (const page of pages.slice(offset, offset + query.limit)) {
    const pageBlocks = artifact!.blocks.filter((block) => block.page === page);
    const size = pageBlocks.reduce((total, block) => total + Array.from(block.text).length, 0)
      + artifact!.verifiedClaims.filter((claim) => claim.page === page).reduce((total, claim) => total + Array.from(claim.text).length, 0);
    if (size > 50_000 && selectedPages.length === 0) throw new DisclosureServiceError("record_too_large", "Retained page exceeds 50,000 characters; a narrower retained artifact is required.");
    if (count + size > 50_000) break;
    count += size; selectedPages.push(page);
  }
  const blocks = available ? artifact!.blocks.filter((block) => selectedPages.includes(block.page) && block.subject === summary.issuer.id) : [];
  const blockIds = new Set(blocks.filter((block) => block.extractionState === "retained_text").map((block) => block.id));
  const verifiedClaims = available ? artifact!.verifiedClaims.filter((claim) => claim.subject === summary.issuer.id && Date.parse(claim.verifiedAt) <= Date.parse(query.context.knowledgeAt) && claim.blockIds.every((id) => blockIds.has(id) && blocks.some((block) => block.id === id && block.page === claim.page && block.table === claim.table && block.period === claim.period && block.unit === claim.unit))) : [];
  const missingPages = selectedPages.some((page) => !blocks.some((block) => block.page === page));
  const provisional = blocks.some((block) => block.extractionState === "provisional_ocr");
  const retainedCharacters = blocks.reduce((total, block) => total + Array.from(block.text).length, 0) + verifiedClaims.reduce((total, claim) => total + Array.from(claim.text).length, 0);
  const more = offset + selectedPages.length < pages.length;
  const nextCursor = more ? encode({ version: VERSION, purpose: "artifact", auth: options.authorizationBinding ?? "internal", issuedAt: cursor?.issuedAt ?? Date.now(), query: { ...query, subject: identity.selector }, requestedSubject: cursor?.requestedSubject ?? parsed.subject, after: String(selectedPages.at(-1)), artifactBinding: binding }, options) : null;
  const artifactReadiness: MaterialAnnouncementsOutput["quality"]["readiness"] = { factualUse: !eligible(summary) ? "not_applicable" : available ? more || missingPages || provisional ? "degraded" : "ready" : "blocked", currentAssessment: "not_applicable", exhaustiveConclusion: !eligible(summary) ? "not_applicable" : available && !more && offset === 0 && !missingPages ? "ready" : "blocked" };
  const exposedArtifact = artifact ? Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== "retainedBytesBase64")) : null;
  const output = disclosureArtifactOutputSchema.parse({ contractVersion: "disclosure-artifact/1.0.0", selector: identity.selector, context: identity.context, identity: summary,
    selection: evidenceSelection(query, artifactReadiness, [...blocks.map((block) => block.id), ...verifiedClaims.map((claim) => claim.id)], [], 0, ["immutable_retained_artifact_selected"]),
    quality: {
      freshness: "not_applicable", completeness: !eligible(summary) ? "not_applicable" : available && !missingPages ? more || offset > 0 ? "partial" : "complete" : "indeterminate", confidence: !available || missingPages ? "indeterminate" : provisional ? "provisional" : verifiedClaims.length > 0 ? "verified" : "supported",
      readiness: artifactReadiness,
      versions: { contract: VERSION, freshnessPolicy: "official-scan/1.0.0", exposurePolicy: "retained-disclosures/1.0.0" },
      status: !eligible(summary) ? "not_applicable" : artifact?.state === "unavailable" ? "not_acquired" : artifact?.state ?? unavailableState, reasonCodes: available ? [] : [artifact?.state ?? (eligible(summary) ? unavailableState : "not_applicable_subject")], recovery: available ? [] : ["Retained artifact content is unavailable; dependent claims must remain withheld."] },
    artifact: exposedArtifact ? { ...exposedArtifact,
      blocks: blocks.map((block) => ({ ...block, qualifiers: { period: qualifier(block.period), unit: qualifier(block.unit) } })),
      verifiedClaims: verifiedClaims.map((claim) => ({ ...claim, qualifiers: { period: qualifier(claim.period), unit: qualifier(claim.unit) } })),
    } : null,
    page: { nextCursor, returnedPages: selectedPages, totalPages: artifact?.totalPages ?? 0, retainedCharacters,
      originalCharacters: artifact ? artifact.blocks.reduce((total, block) => total + Array.from(block.text).length, 0) + artifact.verifiedClaims.reduce((total, claim) => total + Array.from(claim.text).length, 0) : 0,
      pageTruncated: missingPages, totalTruncated: more || offset > 0 || !available || missingPages },
  });
  if (Buffer.byteLength(JSON.stringify(output)) > RESPONSE_BYTES) throw new DisclosureServiceError("record_too_large", "Artifact response exceeds byte budget; request fewer pages.");
  return output;
}
