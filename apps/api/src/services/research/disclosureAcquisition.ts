import { isMopsAccessDenial } from "./providers/mopsAccessDenial.js";
import { enrichOfficialAnnouncement } from "./providers/mopsAnnouncementDetails.js";
import { extractDisclosureContent } from "./providers/disclosureExtraction.js";
import { createHash } from "node:crypto";
import type { Persistence } from "../../persistence/types.js";
import type { ResearchDisclosureScan, ResearchDisclosureArtifact } from "./disclosureContracts.js";
import { ResearchAcquisitionDisabledError } from "./acquisition.js";
import { researchAcquisitionEnabled, researchDisclosureAcquisitionEnabled } from "./rollout.js";
import { DISCLOSURE_PARSER_VERSION, OFFICIAL_ANNOUNCEMENT_SOURCES, disclosureHash, disclosureId, parseOfficialAnnouncementSnapshot, retainAnnouncementExplanation, safeDisclosureUrl } from "./providers/mopsAnnouncements.js";

interface AcquisitionOptions { fetchImpl?: typeof fetch; retrievedAt?: string; acquisitionRunId?: string }
// Source requests are bounded and redirects are rejected so attachment locations
// cannot turn internal ingestion into a generic URL fetcher.
async function officialResponse(fetchImpl: typeof fetch, url: string) {
  if (!safeDisclosureUrl(url)) throw new Error("disclosure_source_url_rejected");
  const response = await fetchImpl(url, { headers: { accept: "application/json,text/plain,text/html,application/pdf" }, redirect: "error", signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 || response.status === 429 ? "disclosure_access_restricted" : "disclosure_source_unavailable");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > 8 * 1024 * 1024) throw new Error("disclosure_source_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("disclosure_source_unavailable");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > 8 * 1024 * 1024) { await reader.cancel(); throw new Error("disclosure_source_too_large"); }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  const body = new TextDecoder().decode(bytes);
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error("disclosure_source_too_large");
  if (isMopsAccessDenial(body)) throw new Error("disclosure_access_restricted");
  return { body, bytes, mediaType: response.headers.get("content-type") ?? "application/octet-stream" };
}
export async function runOfficialDisclosureAcquisition(persistence: Persistence, options: AcquisitionOptions = {}) {
  if (!researchAcquisitionEnabled()) throw new ResearchAcquisitionDisabledError();
  const at = options.retrievedAt ?? new Date().toISOString();
  const acquisitionRunId = options.acquisitionRunId ?? disclosureId("run", at);
  const fetchImpl = options.fetchImpl ?? fetch;
  const outcomes: { venue: "TWSE" | "TPEX"; status: ResearchDisclosureScan["status"]; announcementCount: number }[] = [];
  for (const venue of ["TWSE", "TPEX"] as const) {
    if (!researchDisclosureAcquisitionEnabled(venue)) continue;
    const sourceUrl = OFFICIAL_ANNOUNCEMENT_SOURCES[venue];
    const identities = await persistence.listLatestResearchIdentityRecords({ subject: { kind: "venue", venue }, effectiveAt: at, knowledgeAt: at });
    const eligibleIdentities = identities.filter((identity) => identity.security.type === "common_equity" && identity.eligibility.profile === "operating_company" && identity.eligibility.state === "eligible");
    if (eligibleIdentities.length === 0) { outcomes.push({ venue, status: "failed", announcementCount: 0 }); continue; }
    let status: ResearchDisclosureScan["status"] = "success";
    let contentHash: string | null = null;
    let count = 0;
    let publicationStart = at;
    const artifactAttempts: NonNullable<ResearchDisclosureScan["artifactAttempts"]> = [];
    const artifactOwners = new Map<string, string>();
    const detailAttemptsByListing = new Map<string, NonNullable<ResearchDisclosureScan["detailAttempts"]>>();
    try {
      const response = await officialResponse(fetchImpl, sourceUrl); contentHash = disclosureHash(response.body);
      const observedAt = options.retrievedAt ?? new Date().toISOString();
      const records = parseOfficialAnnouncementSnapshot(JSON.parse(response.body), { retrievedAt: observedAt, contentHash, sourceUrl, acquisitionRunId }, venue, identities);
      const existingByListing = new Map<string, Awaited<ReturnType<Persistence["listResearchAnnouncements"]>>>();
      for (const sourceRecord of records) {
        let record = sourceRecord;
        const listingKey = JSON.stringify([record.issuerId, record.listingId, record.venue]);
        if (!existingByListing.has(listingKey)) {
          const issuerRecords = await persistence.listResearchAnnouncements({ issuerId: record.issuerId, effectiveAt: at, knowledgeAt: at });
          existingByListing.set(listingKey, issuerRecords.filter((prior) => prior.listingId === record.listingId && prior.venue === record.venue));
        }
        const existing = existingByListing.get(listingKey)!;
        const enriched = await enrichOfficialAnnouncement(record, { fetchImpl, previousRecords: existing, retrievedAt: options.retrievedAt ?? new Date().toISOString() });
        const detailAttempts = detailAttemptsByListing.get(listingKey) ?? [];
        detailAttempts.push({ announcementId: sourceRecord.id, attemptedAt: options.retrievedAt ?? new Date().toISOString(), status: enriched.detailStatus, reasonCodes: enriched.reasonCodes });
        detailAttemptsByListing.set(listingKey, detailAttempts);
        const priorSuccessfulDetail = enriched.detailStatus !== "available" ? existing.filter((prior) => prior.collectionRecordId === sourceRecord.id && prior.detailQuality?.status === "available")
          .sort((a, b) => Date.parse(b.provenance.processedAt) - Date.parse(a.provenance.processedAt))[0] : undefined;
        record = priorSuccessfulDetail ? structuredClone(priorSuccessfulDetail) : enriched.record;
        const collectionRecordId = sourceRecord.id;
        if (!priorSuccessfulDetail) {
          const variant = disclosureHash(JSON.stringify({ content: [record.subject, record.ruleClause, record.eventDate, record.explanation], parserVersion: record.provenance.parserVersion, detailQuality: record.detailQuality, attachments: record.attachments, relations: record.relations }));
          record = { ...record, collectionRecordId, id: disclosureId("ann", collectionRecordId, variant) };
          record.attachments = record.attachments.map((attachment) => attachment.id === disclosureId("att", collectionRecordId, "explanation")
            ? { ...attachment, id: disclosureId("att", record.id, "explanation"), artifactId: disclosureId("art", record.id, "explanation") }
            : { ...attachment, id: disclosureId("att", record.id, attachment.sourceUrl), artifactId: attachment.artifactId ? disclosureId("art", record.id, attachment.sourceUrl) : null });
        }
        detailAttempts[detailAttempts.length - 1]!.announcementId = record.id;
        const retainedRecord = existing.find((prior) => prior.id === record.id);
        // Content-changing observations retain both records and their explicit
        // revision relation; the previous evidence is never updated in place.
        const previous = existing.filter((prior) => prior.id !== record.id && prior.publishedAt === record.publishedAt && (prior.collectionRecordId === collectionRecordId || prior.subject === record.subject));
        if (!retainedRecord) for (const prior of previous) record.relations.push({ kind: "supersedes", targetAnnouncementId: prior.id });
        if (!retainedRecord) await persistence.appendResearchAnnouncements([record]);
        const stableRecord = retainedRecord ?? record;
        const explanation = retainAnnouncementExplanation(stableRecord);
        const retainedArtifacts = await persistence.listResearchDisclosureArtifacts({ issuerId: record.issuerId, effectiveAt: at, knowledgeAt: at });
        if (!retainedArtifacts.some((artifact) => artifact.id === explanation.id)) await persistence.appendResearchDisclosureArtifacts([explanation]);
        for (const attachment of record.attachments.filter((item) => item.artifactId !== explanation.id && item.artifactId !== null)) {
          artifactOwners.set(attachment.artifactId!, listingKey);
          if (retainedArtifacts.some((artifact) => artifact.id === attachment.artifactId && artifact.state === "available")) continue;
          let attemptStatus: NonNullable<ResearchDisclosureScan["artifactAttempts"]>[number]["status"] = "unavailable";
          let fetched = false;
          let artifact: ResearchDisclosureArtifact | undefined;
          try {
            const retained = await officialResponse(fetchImpl, attachment.sourceUrl);
            fetched = true;
            const extracted = await extractDisclosureContent(retained.bytes, retained.mediaType, record.issuerId, attachment.artifactId!);
            artifact = { ...explanation, ...extracted, id: attachment.artifactId!, sourceUrl: attachment.sourceUrl,
              contentHash: createHash("sha256").update(retained.bytes).digest("hex"), retainedBytesBase64: Buffer.from(retained.bytes).toString("base64"), mediaType: retained.mediaType, state: "available", verifiedClaims: [],
              parentProvenance: record.provenance,
              provenance: { ...record.provenance, id: disclosureId("pr", attachment.artifactId!, createHash("sha256").update(retained.bytes).digest("hex")), sourceUrl: attachment.sourceUrl, contentHash: createHash("sha256").update(retained.bytes).digest("hex"), parserVersion: extracted.extractionVersion, retrievedAt: options.retrievedAt ?? new Date().toISOString(), processedAt: options.retrievedAt ?? new Date().toISOString(), acquisitionRunId } };
            attemptStatus = "retained";
          } catch (error) {
            attemptStatus = error instanceof Error && error.message === "disclosure_access_restricted" ? "restricted" : fetched ? "processing_failed" : "unavailable";
          }
          if (artifact) await persistence.appendResearchDisclosureArtifacts([artifact]);
          // A failed request is an acquisition attempt, never a retained empty
          // artifact. Subsequent scheduled runs retry unresolved references.
          artifactAttempts.push({ artifactId: attachment.artifactId!, sourceUrl: attachment.sourceUrl, attemptedAt: at, status: attemptStatus });
        }
        if (!retainedRecord) { existing.push(record); count++; }
      }
      publicationStart = records.reduce((start, record) => record.publishedAt < start ? record.publishedAt : start, at);
    } catch (error) {
      status = error instanceof Error && error.message === "disclosure_access_restricted" ? "restricted" : error instanceof SyntaxError ? "processing_failed" : "failed";
    }
    const checkedAt = options.retrievedAt ?? new Date().toISOString();
    const scans: ResearchDisclosureScan[] = eligibleIdentities.map((identity) => ({
      id: disclosureId("scan", acquisitionRunId, checkedAt, venue, identity.listing.id), listingId: identity.listing.id, issuerId: identity.issuer.id, venue, checkedAt, publicationStart, publicationEnd: checkedAt, knowledgeAt: checkedAt, status,
      // Daily snapshots are not historical collection coverage or a guarantee
      // that attachment discovery is exhaustive.
      exhaustive: false, detailAttempts: detailAttemptsByListing.get(JSON.stringify([identity.issuer.id, identity.listing.id, venue])) ?? [], artifactAttempts: artifactAttempts.filter((attempt) => artifactOwners.get(attempt.artifactId) === JSON.stringify([identity.issuer.id, identity.listing.id, venue])), provenance: { id: disclosureId("pr", acquisitionRunId, checkedAt, venue, contentHash ?? "no_retained_response"), publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative", sourceUrl, contentHash, retrievedAt: checkedAt, processedAt: checkedAt, acquisitionRunId, parserVersion: DISCLOSURE_PARSER_VERSION, usagePolicyVersion: "taiwan-open-data/1.0.0" },
    }));
    await persistence.appendResearchDisclosureScans(scans);
    outcomes.push({ venue, status, announcementCount: count });
  }
  return { outcomes };
}
