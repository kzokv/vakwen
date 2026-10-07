import { isMopsAccessDenial } from "./providers/mopsAccessDenial.js";
import { enrichOfficialAnnouncement, announcementCitationSelectors } from "./providers/mopsAnnouncementDetails.js";
import { extractDisclosureContent, resolveDisclosureMediaType } from "./providers/disclosureExtraction.js";
import { createHash } from "node:crypto";
import type { Persistence } from "../../persistence/types.js";
import type { ResearchDisclosureScan, ResearchDisclosureArtifact, ResearchAnnouncementRecord } from "./disclosureContracts.js";
import { ResearchAcquisitionDisabledError } from "./acquisition.js";
import { researchAcquisitionEnabled, researchDisclosureAcquisitionEnabled } from "./rollout.js";
import { DISCLOSURE_PARSER_VERSION, OFFICIAL_ANNOUNCEMENT_SOURCES, disclosureHash, disclosureId, parseOfficialAnnouncementSnapshot, retainAnnouncementExplanation, safeDisclosureUrl } from "./providers/mopsAnnouncements.js";

// Leave headroom inside the 30-minute scan freshness window for persistence.
// Deferred rows remain explicit failures; this is not a scheduling fairness policy.
const BOARD_WORK_BUDGET_MS = 20 * 60 * 1000;
class DisclosureBoardBudgetExhausted extends Error {}

interface AcquisitionOptions { signal?: AbortSignal; fetchImpl?: typeof fetch; retrievedAt?: string; acquisitionRunId?: string }
// Source requests are bounded and redirects are rejected so attachment locations
// cannot turn internal ingestion into a generic URL fetcher.
async function officialResponse(fetchImpl: typeof fetch, url: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!safeDisclosureUrl(url)) throw new Error("disclosure_source_url_rejected");
  const response = await fetchImpl(url, { headers: { accept: "application/json,text/plain,text/html,application/pdf" }, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000) });
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
function announcementContentVariant(record: ResearchAnnouncementRecord): string {
  return disclosureHash(JSON.stringify({
    publisherRecordId: record.publisherRecordId, content: [record.subject, record.ruleClause, record.eventDate, record.explanation], parserVersion: record.provenance.parserVersion,
    detailQuality: record.detailQuality ? { ...record.detailQuality, reasonCodes: [...record.detailQuality.reasonCodes].sort() } : undefined,
    attachments: record.attachments.map((attachment) => ({ title: attachment.title, sourceUrl: attachment.sourceUrl,
      mediaType: attachment.mediaType, contentIdentity: attachment.contentIdentity, hasArtifact: attachment.artifactId !== null })).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    relations: record.relations.filter((relation) => relation.kind !== "supersedes").sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    unresolvedRelations: record.unresolvedRelations, unknownRelationTargets: record.unknownRelationTargets,
  }));
}
export async function runOfficialDisclosureAcquisition(persistence: Persistence, options: AcquisitionOptions = {}) {
  options.signal?.throwIfAborted();
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
    let observedAt: string | undefined;
    const artifactAttempts: NonNullable<ResearchDisclosureScan["artifactAttempts"]> = [];
    const artifactOwners = new Map<string, string>();
    const failedListings = new Set<string>();
    const detailAttemptsByListing = new Map<string, NonNullable<ResearchDisclosureScan["detailAttempts"]>>();
    const pendingRecords = new Set<ResearchAnnouncementRecord>();
    let deadline = Infinity;
    let budgetSignal: AbortSignal | undefined;
    let workSignal = options.signal;
    const checkWorkBudget = () => {
      options.signal?.throwIfAborted();
      if (performance.now() >= deadline || budgetSignal?.aborted) throw new DisclosureBoardBudgetExhausted();
    };
    try {
      const response = await officialResponse(fetchImpl, sourceUrl, options.signal); contentHash = disclosureHash(response.bytes);
      observedAt = options.retrievedAt ?? new Date().toISOString();
      deadline = performance.now() + BOARD_WORK_BUDGET_MS;
      budgetSignal = AbortSignal.timeout(BOARD_WORK_BUDGET_MS);
      workSignal = options.signal ? AbortSignal.any([options.signal, budgetSignal]) : budgetSignal;
      let snapshotText: string;
      try { snapshotText = new TextDecoder("utf-8", { fatal: true }).decode(response.bytes); }
      catch { throw new Error("disclosure_response_invalid_utf8"); }
      const records = parseOfficialAnnouncementSnapshot(JSON.parse(snapshotText), { retrievedAt: observedAt, contentHash, sourceUrl, acquisitionRunId }, venue, identities);
      publicationStart = records.reduce((start, record) => record.publishedAt < start ? record.publishedAt : start, observedAt);
      for (const record of records) pendingRecords.add(record);
      for (const sourceRecord of records) {
        checkWorkBudget();
        let record = sourceRecord;
        const listingKey = JSON.stringify([record.issuerId, record.listingId, record.venue]);
        const readAt = options.retrievedAt ?? new Date().toISOString();
        const scope = { issuerId: record.issuerId, listingId: record.listingId, venue: record.venue, effectiveAt: readAt, knowledgeAt: readAt };
        const enriched = await enrichOfficialAnnouncement(record, { fetchImpl, signal: workSignal, retrievedAt: readAt, resolvePreviousRecords: async (detailRecord) => {
          const selectors = announcementCitationSelectors(detailRecord);
          return selectors.titles.length && selectors.days.length ? persistence.findResearchAnnouncementCandidates({ ...scope, kind: "citation", before: detailRecord.publishedAt, ...selectors }) : [];
        } });
        checkWorkBudget();
        const detailCompletedAt = options.retrievedAt ?? new Date().toISOString();
        enriched.record = { ...enriched.record, provenance: { ...enriched.record.provenance, processedAt: detailCompletedAt, ...(enriched.detailStatus === "available" ? { retrievedAt: detailCompletedAt } : {}) } };
        const detailAttempts = detailAttemptsByListing.get(listingKey) ?? [];
        detailAttempts.push({ announcementId: sourceRecord.id, attemptedAt: detailCompletedAt, status: enriched.detailStatus, reasonCodes: enriched.reasonCodes });
        detailAttemptsByListing.set(listingKey, detailAttempts);
        const markLineageFailure = () => {
          failedListings.add(listingKey);
          const attempt = detailAttempts[detailAttempts.length - 1]!;
          attempt.status = "processing_failed";
          attempt.reasonCodes = [...new Set([...attempt.reasonCodes, "disclosure_revision_lineage_unresolved"])];
        };
        const collectionRecordId = sourceRecord.id;
        const previous = await persistence.findResearchAnnouncementCandidates({ ...scope, kind: "revision", collectionRecordId, publisherRecordId: enriched.record.publisherRecordId,
          publishedAt: enriched.record.publishedAt, subject: enriched.record.subject });
        const superseded = new Set(previous.flatMap((prior) => prior.relations.filter((relation) => relation.kind === "supersedes").map((relation) => relation.targetAnnouncementId)));
        const tips = previous.filter((prior) => !superseded.has(prior.id)).sort((a, b) => a.id.localeCompare(b.id));
        if ((previous.length > 0 && tips.length === 0) || tips.length > 100 || (enriched.detailStatus !== "available" && tips.length > 1)) {
          markLineageFailure();
          pendingRecords.delete(sourceRecord);
          continue;
        }
        checkWorkBudget();
        const activeRecords = tips.length ? await persistence.getResearchAnnouncementsByIds({ ...scope, ids: tips.map((tip) => tip.id) }) : [];
        if (activeRecords.length !== tips.length) { markLineageFailure(); pendingRecords.delete(sourceRecord); continue; }
        const current = activeRecords.length === 1 ? activeRecords[0] : undefined;
        const priorSuccessfulDetail = enriched.detailStatus !== "available" && current?.collectionRecordId === collectionRecordId && current.detailQuality?.status === "available" ? current : undefined;
        // Refresh every external attachment before deciding whether this observation
        // is a replay. A locator is not immutable source content.
        const candidate = structuredClone(priorSuccessfulDetail ?? enriched.record);
        const candidateExplanationId = retainAnnouncementExplanation(candidate).id;
        const fetchedAttachments = new Map<string, {
          bytes?: Uint8Array; extracted?: Awaited<ReturnType<typeof extractDisclosureContent>>;
          observedAt?: string; processedAt: string;
          identity: NonNullable<ResearchAnnouncementRecord["attachments"][number]["contentIdentity"]>;
        }>();
        for (const attachment of candidate.attachments.filter((item) => item.artifactId !== candidateExplanationId && item.artifactId !== null)) {
          const alreadyFetched = fetchedAttachments.get(attachment.sourceUrl);
          if (alreadyFetched) { attachment.contentIdentity = alreadyFetched.identity; continue; }
          checkWorkBudget();
          let fetched = false;
          try {
            const retained = await officialResponse(fetchImpl, attachment.sourceUrl, workSignal);
            checkWorkBudget();
            const artifactObservedAt = options.retrievedAt ?? new Date().toISOString();
            fetched = true;
            const mediaType = resolveDisclosureMediaType(retained.bytes, retained.mediaType, attachment.mediaType);
            const extracted = await extractDisclosureContent(retained.bytes, `${mediaType}${retained.mediaType.includes(";") ? retained.mediaType.slice(retained.mediaType.indexOf(";")) : ""}`, candidate.issuerId, attachment.artifactId!);
            attachment.contentIdentity = { status: "retained", contentHash: createHash("sha256").update(retained.bytes).digest("hex"),
              extractionVersion: extracted.extractionVersion, mediaType, sourceMediaType: retained.mediaType };
            fetchedAttachments.set(attachment.sourceUrl, { bytes: retained.bytes, extracted, observedAt: artifactObservedAt,
              processedAt: options.retrievedAt ?? new Date().toISOString(), identity: attachment.contentIdentity });
          } catch (error) {
            checkWorkBudget();
            const reasonCode = error instanceof Error && (error.message === "disclosure_source_too_large" || error.message === "disclosure_extraction_physical_page_limit") ? error.message : undefined;
            const status = error instanceof Error && error.message === "disclosure_access_restricted" ? "restricted" : fetched || reasonCode ? "processing_failed" : "unavailable";
            attachment.contentIdentity = { status, ...(reasonCode ? { reasonCode } : {}) };
            fetchedAttachments.set(attachment.sourceUrl, { processedAt: options.retrievedAt ?? new Date().toISOString(), identity: attachment.contentIdentity });
          }
        }
        checkWorkBudget();
        const variant = announcementContentVariant(candidate);
        const retainedRecord = current?.collectionRecordId === collectionRecordId && announcementContentVariant(current) === variant ? current : undefined;
        record = retainedRecord ? structuredClone(retainedRecord) : { ...candidate, collectionRecordId,
          id: disclosureId("ann", collectionRecordId, variant, ...tips.map((tip) => tip.id)) };
        if (!retainedRecord) {
          record.provenance = { ...record.provenance, id: disclosureId("pr", record.id, record.provenance.id), processedAt: options.retrievedAt ?? new Date().toISOString() };
          if (record.collectionProvenance) record.collectionProvenance = { ...record.collectionProvenance,
            id: disclosureId("pr", record.id, record.collectionProvenance.id, "collection") };
          record.attachments = record.attachments.map((attachment) => attachment.artifactId === candidateExplanationId
            ? { ...attachment, id: disclosureId("att", record.id, "explanation"), artifactId: disclosureId("art", record.id, "explanation") }
            : { ...attachment, id: disclosureId("att", record.id, attachment.sourceUrl), artifactId: attachment.artifactId ? disclosureId("art", record.id, attachment.sourceUrl) : null });
          record.relations = record.relations.filter((relation) => relation.kind !== "supersedes");
          for (const prior of tips) record.relations.push({ kind: "supersedes", targetAnnouncementId: prior.id });
        }
        detailAttempts[detailAttempts.length - 1]!.announcementId = record.id;
        checkWorkBudget();
        if (!retainedRecord) await persistence.appendResearchAnnouncements([record]);
        checkWorkBudget();
        const explanation = retainAnnouncementExplanation(record);
        const artifactReadAt = options.retrievedAt ?? new Date().toISOString();
        const artifactQuery = { issuerId: record.issuerId, effectiveAt: artifactReadAt, knowledgeAt: artifactReadAt };
        if ((await persistence.listResearchDisclosureArtifacts({ ...artifactQuery, artifactId: explanation.id })).length === 0) { checkWorkBudget(); await persistence.appendResearchDisclosureArtifacts([explanation]); }
        for (const attachment of record.attachments.filter((item) => item.artifactId !== explanation.id && item.artifactId !== null)) {
          checkWorkBudget();
          const retained = fetchedAttachments.get(attachment.sourceUrl)!;
          const identity = retained.identity;
          artifactOwners.set(attachment.artifactId!, listingKey);
          if (identity.status === "retained" && (await persistence.listResearchDisclosureArtifacts({ ...artifactQuery, artifactId: attachment.artifactId! })).length === 0) {
            const artifact: ResearchDisclosureArtifact = { ...explanation, ...retained.extracted!, id: attachment.artifactId!, sourceUrl: attachment.sourceUrl,
              blocks: retained.extracted!.blocks.map((block, index) => ({ ...block, id: disclosureId("block", attachment.artifactId!, JSON.stringify([block.page, block.table, index, block.text])) })),
              contentHash: identity.contentHash, retainedBytesBase64: Buffer.from(retained.bytes!).toString("base64"), mediaType: identity.mediaType, sourceMediaType: identity.sourceMediaType, state: "available", verifiedClaims: [],
              parentProvenance: record.provenance,
              provenance: { ...record.provenance, id: disclosureId("pr", attachment.artifactId!, identity.contentHash), sourceUrl: attachment.sourceUrl, contentHash: identity.contentHash,
                parserVersion: identity.extractionVersion, retrievedAt: retained.observedAt!, processedAt: retained.processedAt, acquisitionRunId } };
            checkWorkBudget();
            await persistence.appendResearchDisclosureArtifacts([artifact]);
          }
          // Failure gets an unresolved reference in its own immutable observation,
          // not an empty artifact or a claim that cached bytes are still current.
          artifactAttempts.push({ artifactId: attachment.artifactId!, sourceUrl: attachment.sourceUrl, attemptedAt: retained.processedAt, status: identity.status,
            ...(identity.status !== "retained" && identity.reasonCode ? { reasonCode: identity.reasonCode } : {}) });
        }
        checkWorkBudget();
        pendingRecords.delete(sourceRecord);
        if (!retainedRecord) count++;
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      if (error instanceof DisclosureBoardBudgetExhausted || (budgetSignal?.aborted && error === budgetSignal.reason)) {
        for (const record of pendingRecords) {
          const key = JSON.stringify([record.issuerId, record.listingId, record.venue]);
          failedListings.add(key);
          const attempts = detailAttemptsByListing.get(key) ?? [];
          attempts.push({ announcementId: record.id, attemptedAt: options.retrievedAt ?? new Date().toISOString(), status: "processing_failed", reasonCodes: ["disclosure_board_work_budget_exhausted"] });
          detailAttemptsByListing.set(key, attempts);
        }
      } else status = error instanceof Error && error.message === "disclosure_access_restricted" ? "restricted" : (error instanceof SyntaxError || (error instanceof Error && ["disclosure_source_too_large", "disclosure_response_invalid_utf8"].includes(error.message))) ? "processing_failed" : "failed";
    }
    const completedAt = options.retrievedAt ?? new Date().toISOString();
    const checkedAt = observedAt ?? completedAt;
    const scans: ResearchDisclosureScan[] = eligibleIdentities.map((identity) => ({
      id: disclosureId("scan", acquisitionRunId, checkedAt, completedAt, venue, identity.listing.id), listingId: identity.listing.id, issuerId: identity.issuer.id, venue, checkedAt, publicationStart, publicationEnd: checkedAt, knowledgeAt: completedAt, status: status === "success" && failedListings.has(JSON.stringify([identity.issuer.id, identity.listing.id, venue])) ? "failed" : status,
      // Daily snapshots are not historical collection coverage or a guarantee
      // that attachment discovery is exhaustive.
      exhaustive: false, detailAttempts: detailAttemptsByListing.get(JSON.stringify([identity.issuer.id, identity.listing.id, venue])) ?? [], artifactAttempts: artifactAttempts.filter((attempt) => artifactOwners.get(attempt.artifactId) === JSON.stringify([identity.issuer.id, identity.listing.id, venue])), provenance: { id: disclosureId("pr", acquisitionRunId, checkedAt, completedAt, venue, contentHash ?? "no_retained_response"), publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative", sourceUrl, contentHash, retrievedAt: checkedAt, processedAt: completedAt, acquisitionRunId, parserVersion: DISCLOSURE_PARSER_VERSION, usagePolicyVersion: "taiwan-open-data/1.0.0" },
    }));
    options.signal?.throwIfAborted();
    await persistence.appendResearchDisclosureScans(scans);
    outcomes.push({ venue, status: status === "success" && failedListings.size > 0 ? "failed" : status, announcementCount: count });
  }
  return { outcomes };
}
