import { disclosureMetadata } from "../../src/services/research/disclosureContracts.js";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { materialAnnouncementsOutputSchema, disclosureArtifactOutputSchema } from "../../src/services/research/contracts.js";
import { getDisclosureArtifact, listMaterialAnnouncements } from "../../src/services/research/disclosures.js";
import type { ResearchAnnouncementRecord, ResearchDisclosureArtifact, ResearchDisclosureScan } from "../../src/services/research/disclosureContracts.js";

export async function disclosureFixture(venue: "TWSE" | "TPEX" = "TWSE") {
  const persistence = new MemoryPersistence();
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-08-31", retrievedAt: "2026-08-31T02:00:00.000Z", artifact: { contentHash: "fixture", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" }, row: { kind: "company", ticker: "2330", legalName: "公司", displayName: "公司", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const context = { knowledgeAt: "2026-09-01T02:00:00.000Z" };
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const provenance: ResearchAnnouncementRecord["provenance"] = { id: "pr1", publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative", sourceUrl: "https://mops.twse.com.tw/a", contentHash: "a".repeat(64), retrievedAt: "2026-09-01T01:59:00.000Z", processedAt: "2026-09-01T01:59:00.000Z", acquisitionRunId: "run1", parserVersion: "disclosures/1.0.0", usagePolicyVersion: "taiwan-open-data/1.0.0" };
  const announcement: ResearchAnnouncementRecord = { id: "ann1", issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: "2330", venue, publishedAt: "2026-09-01T01:00:00.000Z", publicationPrecision: "second", subject: "重大訊息", ruleClause: "51", eventDate: "2026-09-01", explanation: "😀".repeat(20_001), sourceUrl: provenance.sourceUrl, attachments: [{ id: "attachment1", artifactId: "artifact1", title: "說明", mediaType: "text/plain", sourceUrl: provenance.sourceUrl }], relations: [], quality: "available", provenance };
  const artifact: ResearchDisclosureArtifact = { id: "artifact1", issuerId: identity.issuer.id, publishedAt: announcement.publishedAt, contentHash: provenance.contentHash, extractionVersion: "extract/1", sourceUrl: provenance.sourceUrl, mediaType: "text/plain", reference: { kind: "announcement_attachment", id: announcement.id }, state: "available", totalPages: 4, blocks: Array.from({length: 4}, (_,i) => ({ id: `block${i}`, page: i+1, table: null, text: "證據", extractionState: "retained_text", subject: identity.issuer.id, period: null, unit: null })), verifiedClaims: [], provenance };
  const scan: ResearchDisclosureScan = { id: "scan1", listingId: identity.listing.id, issuerId: identity.issuer.id, venue, checkedAt: "2026-09-01T01:59:00.000Z", publicationStart: "2026-09-01T00:00:00.000Z", publicationEnd: context.knowledgeAt, knowledgeAt: context.knowledgeAt, status: "success", exhaustive: false, provenance };
  await persistence.appendResearchAnnouncements([announcement]); await persistence.appendResearchDisclosureArtifacts([artifact]); await persistence.appendResearchDisclosureScans([scan]);
  return { persistence, identity, subject, context, announcement, artifact, scan };
}
describe("retained disclosure reads", () => {
  it.each(["TWSE", "TPEX"] as const)("%s: bounded evidence → exact Unicode and current nonexhaustive scan", async (venue) => {
    const f = await disclosureFixture(venue); const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("read must not fetch"));
    const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context });
    expect(result.items[0]?.explanation).toMatchObject({ originalCharacters: 20001, retainedCharacters: 20000, truncated: true });
    expect(result.scan.status).toBe("current"); expect(result.window.exhaustive).toBe(false); expect(fetchSpy).not.toHaveBeenCalled(); fetchSpy.mockRestore();
  });
  it("cursor: continuation → bound authorization and stable complete records", async () => {
    const f = await disclosureFixture(); await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2" }]);
    const options = { authorizationBinding: "alice", cursorSecret: "secret" };
    const first = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, limit: 1 }, options);
    const second = await listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! }, options);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
    await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! }, { ...options, authorizationBinding: "bob" })).rejects.toMatchObject({ code: "research_cursor_invalid" });
  });
  it("temporal read: later retraction → absent before knowledge cutoff, cross-page relation afterward", async () => {
    const f = await disclosureFixture(); await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "retraction", publishedAt: "2026-09-01T01:30:00.000Z", relations: [{ kind: "retracts", targetAnnouncementId: "ann1" }] }]);
    const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, limit: 1 });
    expect(result.relationIndex).toContainEqual({ announcementId: "retraction", kind: "retracts", targetAnnouncementId: "ann1" });
    const earlier = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: { knowledgeAt: "2026-09-01T01:00:00.000Z" } }); expect(earlier.items).toEqual([]);
  });
  it("artifact: retained reference → complete pages, rejected generic lookup and immutable conflict", async () => {
    const f = await disclosureFixture(); const first = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "artifact1" });
    expect(first.page.returnedPages).toEqual([1,2,3]);
    const second = await getDisclosureArtifact(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! }); expect(second.page.returnedPages).toEqual([4]);
    await expect(getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "unknown" })).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
    await expect(f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, extractionVersion: "altered" }])).rejects.toThrow("immutable_conflict");
  });
  it.each(["restricted", "processing_failed", "indeterminate"] as const)("%s: unavailable artifact → safe metadata without content", async (state) => {
    const f = await disclosureFixture(); await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2", attachments: [{ ...f.announcement.attachments[0]!, artifactId: "restricted" }] }]);
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "restricted", reference: { kind: "announcement_attachment", id: "ann2" }, state }]);
    const result = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "restricted" });
    expect(result.artifact?.blocks).toEqual([]); expect(result.artifact?.verifiedClaims).toEqual([]); expect(result.quality.status).toBe(state);
  });
});

describe("disclosure invariant boundaries", () => {
  it("material reference: artifact self-assertion → rejected until independently retained reference exists", async () => {
    const f = await disclosureFixture();
    const artifact = { ...f.artifact, id: "material_artifact", reference: { kind: "investor_material" as const, id: "material1" } };
    await f.persistence.appendResearchDisclosureArtifacts([artifact]);
    const input = { subject: f.subject, context: f.context, artifactId: artifact.id };
    await expect(getDisclosureArtifact(f.persistence, input)).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
    await f.persistence.appendResearchDisclosureMaterialReferences([{ id: "material1", issuerId: artifact.issuerId, listingId: f.identity.listing.id, venue: f.identity.listing.venue, publishedAt: artifact.publishedAt, artifactIds: [artifact.id], provenance: artifact.provenance }]);
    expect((await getDisclosureArtifact(f.persistence, input)).artifact?.id).toBe(artifact.id);
  });
  it("missing attachment: retained reference and restricted acquisition attempt → typed metadata without invented artifact", async () => {
    const f = await disclosureFixture();
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "missing_announcement", attachments: [{ ...f.announcement.attachments[0]!, artifactId: "missing_artifact" }] }]);
    await f.persistence.appendResearchDisclosureScans([{ ...f.scan, id: "restricted_scan", artifactAttempts: [{ artifactId: "missing_artifact", sourceUrl: f.announcement.sourceUrl, attemptedAt: f.scan.checkedAt, status: "restricted" }] }]);
    const result = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "missing_artifact" });
    expect(result.quality.status).toBe("restricted"); expect(result.artifact).toBeNull();
  });
  it.each([["2026-09-01T02:29:00.000Z", "current"], ["2026-09-01T02:29:00.001Z", "indeterminate"], ["2026-09-01T03:59:00.000Z", "indeterminate"], ["2026-09-01T03:59:00.001Z", "stale"]])("scan freshness at %s → %s", async (knowledgeAt, expected) => {
    const f = await disclosureFixture(); const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: { knowledgeAt: knowledgeAt! } }); expect(result.scan.status).toBe(expected);
  });
  it("publication range: oversized or future bound → rejected before dataset read", async () => {
    const f = await disclosureFixture(); const read = vi.spyOn(f.persistence, "listResearchAnnouncements");
    await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, range: { publishedFrom: "2024-08-31T00:00:00.000Z", publishedTo: f.context.knowledgeAt } })).rejects.toMatchObject({ code: "research_range_invalid" });
    expect(read).not.toHaveBeenCalled();
  });
});

it("artifact coverage: four declared physical pages with one extracted page → explicit missing-page coverage", async () => {
  const f = await disclosureFixture();
  const artifact = { ...f.artifact, id: "partial_pages", blocks: f.artifact.blocks.slice(0, 1) };
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "partial_parent", attachments: [{ ...f.announcement.attachments[0]!, artifactId: artifact.id }] }]);
  artifact.reference = { kind: "announcement_attachment", id: "partial_parent" };
  await f.persistence.appendResearchDisclosureArtifacts([artifact]);
  const result = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: artifact.id });
  expect(result.page).toMatchObject({ returnedPages: [1,2,3], totalPages: 4, pageTruncated: true, totalTruncated: true });
  expect(result.quality.completeness).toBe("indeterminate"); expect(result.page.nextCursor).not.toBeNull();
  const last = await getDisclosureArtifact(f.persistence, { subject: f.subject, cursor: result.page.nextCursor! });
  expect(last.page).toMatchObject({ returnedPages: [4], pageTruncated: true, totalTruncated: true });
});
it("artifact character counts: wrong-subject block and invalid-location claim → emitted Unicode only", async () => {
  const f = await disclosureFixture();
  const artifact: ResearchDisclosureArtifact = { ...f.artifact, id: "filtered_counts", totalPages: 1,
    blocks: [f.artifact.blocks[0]!, { ...f.artifact.blocks[1]!, page: 1, text: "😀excluded", subject: "unrelated_issuer" }],
    verifiedClaims: [{ id: "invalid_claim", kind: "source_fact", text: "must not count this", blockIds: [f.artifact.blocks[0]!.id], page: 1, table: "wrong_table", subject: f.identity.issuer.id, period: null, unit: null, verification: "verified", publisher: "MOPS", verifiedAt: f.artifact.provenance.processedAt }],
    reference: { kind: "announcement_attachment", id: "filtered_parent" } };
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "filtered_parent", attachments: [{ ...f.announcement.attachments[0]!, artifactId: artifact.id }] }]);
  await f.persistence.appendResearchDisclosureArtifacts([artifact]);
  const result = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: artifact.id });
  expect(result.artifact?.blocks).toHaveLength(1); expect(result.artifact?.verifiedClaims).toEqual([]);
  expect(result.page.retainedCharacters).toBe(2);
});

it("evidence views: authoritative supersession → policy-selected current record or explicit immutable audit history", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "successor", relations: [{ kind: "supersedes", targetAnnouncementId: f.announcement.id }] }]);
  const selected = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, purposes: ["factual_use"] });
  expect(selected.items.map((item) => item.id)).toEqual(["successor"]);
  expect(selected.selection).toMatchObject({ evidenceView: "selected_with_conflicts", purposes: ["factual_use"], excludedObservationCount: 1, selectedObservationIds: ["successor"] });
  expect(selected.relationIndex).toContainEqual({ announcementId: "successor", kind: "supersedes", targetAnnouncementId: f.announcement.id });
  const audit = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, evidenceView: "all_observations", limit: 1, purposes: ["factual_use"] });
  const next = await listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: audit.page.nextCursor! });
  expect(next.selection.evidenceView).toBe("all_observations"); expect(next.selection.purposes).toEqual(["factual_use"]);
  expect(new Set([...audit.items, ...next.items].map((item) => item.id))).toEqual(new Set(["successor", "ann1"]));
  await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: audit.page.nextCursor!, purposes: ["current_assessment"] } as never)).rejects.toThrow();
});
it("equal-authority conflict: unresolved sibling observations → all conflict participants and selection reason", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "conflict_a", collectionRecordId: "observation" }, { ...f.announcement, id: "conflict_b", collectionRecordId: "observation" }]);
  const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context });
  expect(new Set(result.selection.conflictObservationIds)).toEqual(new Set(["conflict_a", "conflict_b"]));
  expect(result.selection.reasonCodes).toContain("open_equal_authority_conflict_retained");
});
it("failed refresh: current successful scan → retained until its own freshness boundary", async () => {
  const f = await disclosureFixture();
  const failedAt = "2026-09-01T02:04:00.000Z";
  await f.persistence.appendResearchDisclosureScans([{ ...f.scan, id: "new_failure", checkedAt: failedAt, knowledgeAt: failedAt, status: "failed", provenance: { ...f.scan.provenance, id: "failed_provenance", retrievedAt: failedAt, processedAt: failedAt } }]);
  const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: { knowledgeAt: failedAt } });
  expect(result.scan).toMatchObject({ status: "current", checkedAt: f.scan.checkedAt, latestAttempt: { status: "failed" } });
  expect(result.quality.readiness.currentAssessment).toBe("degraded");
  expect((await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: { knowledgeAt: "2026-09-01T02:30:00.000Z" } })).scan.status).toBe("indeterminate");
  expect((await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: { knowledgeAt: "2026-09-01T04:00:00.000Z" } })).scan.status).toBe("stale");
});
it("cursor defense: altered signature, subject, tool and 24-hour expiry → rejected", async () => {
  const f = await disclosureFixture(); await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2" }]);
  const options = { cursorSecret: "defense-secret", authorizationBinding: "alice" };
  const first = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, limit: 1 }, options);
  const cursor = first.page.nextCursor!;
  const [payload] = cursor.split(".");
  await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: `${payload}.invalid` }, options)).rejects.toMatchObject({ code: "research_cursor_invalid" });
  await expect(listMaterialAnnouncements(f.persistence, { subject: { kind: "listing_id", listingId: "different_listing" }, cursor }, options)).rejects.toMatchObject({ code: "research_cursor_invalid" });
  await expect(getDisclosureArtifact(f.persistence, { subject: f.subject, cursor }, options)).rejects.toMatchObject({ code: "research_cursor_invalid" });
  const now = Date.now(); const clock = vi.spyOn(Date, "now").mockReturnValue(now + 86_400_001);
  try { await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor }, options)).rejects.toMatchObject({ code: "research_cursor_invalid" }); } finally { clock.mockRestore(); }
});
it.each(["contentHash", "extractionVersion"] as const)("artifact cursor: changed %s behind retained selector → rejected", async (field) => {
  const f = await disclosureFixture(); const first = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: f.artifact.id });
  vi.spyOn(f.persistence, "listResearchDisclosureArtifacts").mockResolvedValue([{ ...f.artifact, [field]: field === "contentHash" ? "b".repeat(64) : "extract/2" }]);
  await expect(getDisclosureArtifact(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! })).rejects.toMatchObject({ code: "research_cursor_invalid" });
});

it("cursor contract: correctly signed retired version → rejected independently of signature", async () => {
  const f = await disclosureFixture(); await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2" }]);
  const options = { cursorSecret: "version-test-secret" };
  const first = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, limit: 1 }, options);
  const payload = JSON.parse(Buffer.from(first.page.nextCursor!.split(".")[0]!, "base64url").toString("utf8"));
  payload.version = "disclosures/retired";
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const cursor = `${encoded}.${createHmac("sha256", options.cursorSecret).update(encoded).digest("base64url")}`;
  await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor }, options)).rejects.toMatchObject({ code: "research_cursor_invalid" });
});
it("purpose registry: unknown or excessive purpose IDs → strict input rejection", async () => {
  const f = await disclosureFixture();
  await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, purposes: ["invented_purpose"] } as never)).rejects.toThrow();
  await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, purposes: Array(21).fill("factual_use") } as never)).rejects.toThrow();
});

it.each(["TWSE", "TPEX"] as const)("%s listing scope: shared issuer across boards → no implicit announcement or attachment transfer", async (venue) => {
  const f = await disclosureFixture(venue);
  const otherVenue = venue === "TWSE" ? "TPEX" : "TWSE";
  const otherIdentity = canonicalizeOfficialIdentityRow({ venue: otherVenue, snapshotDate: "2026-08-31", retrievedAt: "2026-08-31T02:00:00.000Z", artifact: { contentHash: "other-board-identity", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" }, row: { kind: "company", ticker: "2330", legalName: "公司", displayName: "公司", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05" } });
  expect(otherIdentity.issuer.id).toBe(f.identity.issuer.id); expect(otherIdentity.listing.id).not.toBe(f.identity.listing.id);
  await f.persistence.appendResearchIdentityRecords([otherIdentity]);
  const otherAnnouncement: ResearchAnnouncementRecord = { ...f.announcement, id: "other_board_announcement", listingId: otherIdentity.listing.id, venue: otherVenue,
    attachments: [{ ...f.announcement.attachments[0]!, artifactId: "other_board_artifact" }],
    relations: [{ kind: "supersedes" as const, targetAnnouncementId: f.announcement.id }] };
  await f.persistence.appendResearchAnnouncements([otherAnnouncement]);
  await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "other_board_artifact", reference: { kind: "announcement_attachment", id: otherAnnouncement.id } }]);
  const query = { subject: f.subject, context: f.context };
  const selected = await listMaterialAnnouncements(f.persistence, query);
  const audit = await listMaterialAnnouncements(f.persistence, { ...query, evidenceView: "all_observations" });
  expect(selected.items.map((item) => item.id)).toEqual([f.announcement.id]); expect(audit.items.map((item) => item.id)).toEqual([f.announcement.id]);
  expect(selected.relationIndex).toEqual([]);
  await expect(getDisclosureArtifact(f.persistence, { ...query, artifactId: "other_board_artifact" })).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
  expect((await getDisclosureArtifact(f.persistence, { ...query, artifactId: f.artifact.id })).artifact?.id).toBe(f.artifact.id);
  const otherSubject = { kind: "listing_id" as const, listingId: otherIdentity.listing.id };
  expect((await listMaterialAnnouncements(f.persistence, { subject: otherSubject, context: f.context })).items.map((item) => item.id)).toEqual([otherAnnouncement.id]);
  expect((await getDisclosureArtifact(f.persistence, { subject: otherSubject, context: f.context, artifactId: "other_board_artifact" })).artifact?.id).toBe("other_board_artifact");
});
it.each(["listing", "venue"] as const)("material reference scope: mismatched %s despite issuer match → rejected", async (mismatch) => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "material_cross_listing", reference: { kind: "investor_material", id: "material_cross_reference" } }]);
  await f.persistence.appendResearchDisclosureMaterialReferences([{ id: "material_cross_reference", issuerId: f.identity.issuer.id, listingId: mismatch === "listing" ? "other_listing" : f.identity.listing.id, venue: mismatch === "venue" ? "TPEX" : f.identity.listing.venue, publishedAt: f.artifact.publishedAt, artifactIds: ["material_cross_listing"], provenance: f.artifact.provenance }]);
  await expect(getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "material_cross_listing" })).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
});

it("leap-day publication bound: two calendar years → clamp to February28 without accepting earlier day", async () => {
  const f = await disclosureFixture();
  const context = { knowledgeAt: "2028-02-29T02:00:00.000Z" };
  const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context, range: { publishedFrom: "2026-02-28T02:00:00.000Z", publishedTo: context.knowledgeAt } });
  expect(result.window.publishedFrom).toBe("2026-02-28T02:00:00.000Z");
  await expect(listMaterialAnnouncements(f.persistence, { subject: f.subject, context, range: { publishedFrom: "2026-02-27T02:00:00.000Z", publishedTo: context.knowledgeAt } })).rejects.toMatchObject({ code: "research_range_invalid" });
});

it("announcement continuity: complete cursor chain → stable query/content binding and exact offsets", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2" }, { ...f.announcement, id: "foreign", listingId: "other_listing" }]);
  const initial = { subject: f.subject, context: f.context, limit: 1 };
  const first = await listMaterialAnnouncements(f.persistence, initial);
  const repeated = await listMaterialAnnouncements(f.persistence, initial);
  const last = await listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! });
  expect(first.page.continuity).toEqual({ queryHash: expect.stringMatching(/^[a-f0-9]{64}$/), offset: 0, returnedCount: 1, totalCount: 2, requestCursor: null });
  expect(repeated.page.continuity.queryHash).toBe(first.page.continuity.queryHash);
  expect(last.page.continuity).toEqual({ ...first.page.continuity, offset: 1, requestCursor: first.page.nextCursor });
  expect(last.page.nextCursor).toBeNull();
  const differentOrder = await listMaterialAnnouncements(f.persistence, { ...initial, order: "asc" });
  expect(differentOrder.page.continuity.queryHash).not.toBe(first.page.continuity.queryHash);
  const changedRows = vi.spyOn(f.persistence, "listResearchAnnouncementSelectionMetadata").mockResolvedValue([disclosureMetadata({ ...f.announcement, provenance: { ...f.announcement.provenance, contentHash: "b".repeat(64) } }), disclosureMetadata({ ...f.announcement, id: "ann2" })]);
  expect((await listMaterialAnnouncements(f.persistence, initial)).page.continuity.queryHash).not.toBe(first.page.continuity.queryHash);
  changedRows.mockRestore();
  for (const page of [{ ...first.page, nextCursor: null }, { ...first.page, continuity: { ...first.page.continuity, returnedCount: 0 } }]) {
    expect(materialAnnouncementsOutputSchema.safeParse({ ...first, page }).success).toBe(false);
  }
});
it("artifact continuity: physical pages and empty reads → exact returned and total counts", async () => {
  const f = await disclosureFixture();
  const first = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: f.artifact.id });
  const last = await getDisclosureArtifact(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! });
  expect(first.page.continuity).toEqual({ queryHash: expect.stringMatching(/^[a-f0-9]{64}$/), offset: 0, returnedCount: 3, totalCount: 4, requestCursor: null });
  expect(last.page.continuity).toEqual({ ...first.page.continuity, offset: 3, returnedCount: 1, requestCursor: first.page.nextCursor });
  expect(disclosureArtifactOutputSchema.safeParse({ ...last, page: { ...last.page, continuity: { ...last.page.continuity, totalCount: 5 } } }).success).toBe(false);
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "missing_ref", attachments: [{ ...f.announcement.attachments[0]!, artifactId: "missing_artifact" }] }]);
  const missing = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "missing_artifact" });
  expect(missing.page.continuity).toMatchObject({ offset: 0, returnedCount: 0, totalCount: 0, requestCursor: null });
  const empty = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, range: { publishedFrom: "2026-08-31T00:00:00.000Z", publishedTo: "2026-08-31T23:59:59.000Z" } });
  expect(empty.page.continuity).toMatchObject({ offset: 0, returnedCount: 0, totalCount: 0, requestCursor: null });
});
it("response budget: metadata and echoed cursors → capped payload with final returned count", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchAnnouncements(Array.from({ length: 7 }, (_, index) => ({ ...f.announcement, id: `budget_${index}` })));
  let page = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, limit: 100 });
  let seen = 0;
  for (;;) {
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(255 * 1024);
    expect(page.page.continuity).toMatchObject({ offset: seen, returnedCount: page.items.length, totalCount: 8 });
    seen += page.items.length;
    if (page.page.nextCursor === null) break;
    page = await listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: page.page.nextCursor });
  }
  expect(seen).toBe(8);
});

it("exhaustive pagination: terminal continuation → page remains partial and exhaustive judgment blocked", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "second" }]);
  await f.persistence.appendResearchDisclosureScans([{ ...f.scan, id: "exhaustive_scan", exhaustive: true, publicationStart: "2026-01-01T00:00:00.000Z", checkedAt: f.context.knowledgeAt }]);
  const initial = { subject: f.subject, context: f.context, limit: 1, purposes: ["exhaustive_conclusion" as const] };
  const first = await listMaterialAnnouncements(f.persistence, initial);
  const last = await listMaterialAnnouncements(f.persistence, { subject: f.subject, cursor: first.page.nextCursor! });
  expect(last.window.exhaustive).toBe(true);
  expect(last.page.nextCursor).toBeNull();
  expect(last.quality.completeness).toBe("partial");
  expect(last.quality.readiness.exhaustiveConclusion).toBe("blocked");
  expect(last.selection.readinessByPurpose[0]?.status).toBe("blocked");
  const whole = await listMaterialAnnouncements(f.persistence, { ...initial, limit: 100 });
  expect(whole.quality.completeness).toBe("complete");
  expect(whole.quality.readiness.exhaustiveConclusion).toBe("ready");
});
it.each(["publication", "event"] as const)("selection metadata: excluded %s range → unrelated supersession and conflicts omitted", async (filter) => {
  const f = await disclosureFixture();
  const outside = { ...f.announcement, publishedAt: filter === "publication" ? "2026-08-01T01:00:00.000Z" : f.announcement.publishedAt, eventDate: "2026-08-01" };
  await f.persistence.appendResearchAnnouncements([
    { ...outside, id: "outside_old" },
    { ...outside, id: "outside_new", relations: [{ kind: "supersedes", targetAnnouncementId: "outside_old" }] },
    { ...outside, id: "outside_conflict_a", collectionRecordId: "outside_collection" },
    { ...outside, id: "outside_conflict_b", collectionRecordId: "outside_collection" },
  ]);
  const range = { publishedFrom: filter === "publication" ? "2026-09-01T00:00:00.000Z" : "2026-08-01T00:00:00.000Z", publishedTo: f.context.knowledgeAt, ...(filter === "event" ? { eventFrom: "2026-09-01" } : {}) };
  const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, range });
  expect(result.items.map((item) => item.id)).toEqual([f.announcement.id]);
  expect(result.selection.excludedObservationCount).toBe(0);
  expect(result.selection.conflictObservationIds).toEqual([]);
  expect(result.selection.reasonCodes).not.toContain("open_equal_authority_conflict_retained");
});

it("range-local metadata: out-of-window revision → in-window predecessor stays superseded", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "outside_revision", eventDate: "2026-08-31", relations: [{ kind: "supersedes", targetAnnouncementId: f.announcement.id }] }]);
  const initial = { subject: f.subject, context: f.context, range: { publishedFrom: "2026-08-01T00:00:00.000Z", publishedTo: f.context.knowledgeAt, eventFrom: "2026-09-01" } };
  const selected = await listMaterialAnnouncements(f.persistence, initial);
  expect(selected.items).toEqual([]);
  expect(selected.selection.excludedObservationCount).toBe(1);
  const audit = await listMaterialAnnouncements(f.persistence, { ...initial, evidenceView: "all_observations" });
  expect(audit.items.map((record) => record.id)).toEqual([f.announcement.id]);
  expect(audit.selection.excludedObservationCount).toBe(0);
  expect(audit.relationIndex).toContainEqual({ announcementId: "outside_revision", kind: "supersedes", targetAnnouncementId: f.announcement.id });
});

it("artifact ID bound: requested or unknown ID → persistence never bulk-loads issuer payloads", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "large_unrelated", retainedBytesBase64: "YQ==".repeat(250_000) }]);
  const reads = vi.spyOn(f.persistence, "listResearchDisclosureArtifacts");
  expect((await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: f.artifact.id })).artifact?.id).toBe(f.artifact.id);
  await expect(getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: "unknown" })).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
  expect(reads.mock.calls.map(([query]) => query.artifactId)).toEqual([f.artifact.id, "unknown"]);
  const query = { issuerId: f.identity.issuer.id, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt, artifactId: f.artifact.id };
  expect(await f.persistence.listResearchDisclosureArtifacts(query)).toEqual([f.artifact]);
  expect(await f.persistence.listResearchDisclosureArtifacts({ ...query, issuerId: "other" })).toEqual([]);
  expect(await f.persistence.listResearchDisclosureArtifacts({ ...query, knowledgeAt: "2026-09-01T01:00:00.000Z", effectiveAt: "2026-09-01T01:00:00.000Z" })).toEqual([]);
});

it("bounded scan selection: failed refresh and older artifact failure → independent listing/cutoff-safe lookups", async () => {
  const f = await disclosureFixture();
  const lookup = { issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt };
  const attempt = { artifactId: "missing_artifact", sourceUrl: f.announcement.sourceUrl, attemptedAt: "2026-09-01T01:30:00.000Z", status: "processing_failed" as const, reasonCode: "disclosure_source_too_large" as const };
  await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "missing_parent", attachments: [{ ...f.announcement.attachments[0]!, artifactId: attempt.artifactId }] }]);
  await f.persistence.appendResearchDisclosureScans([
    { ...f.scan, id: "older_artifact_failure", checkedAt: "2026-09-01T01:30:00.000Z", status: "failed", artifactAttempts: [attempt] },
    { ...f.scan, id: "latest_failed", checkedAt: f.context.knowledgeAt, status: "failed" },
    { ...f.scan, id: "wrong_listing", listingId: "different_listing", checkedAt: f.context.knowledgeAt },
    { ...f.scan, id: "wrong_venue", venue: "TPEX", checkedAt: f.context.knowledgeAt },
    { ...f.scan, id: "future_knowledge", checkedAt: f.context.knowledgeAt, knowledgeAt: "2026-09-02T00:00:00.000Z" },
  ]);
  expect((await f.persistence.listLatestResearchDisclosureScans(lookup)).map((scan) => scan.id)).toEqual(["latest_failed", f.scan.id]);
  expect(await f.persistence.getLatestResearchDisclosureArtifactAttempt({ ...lookup, artifactId: attempt.artifactId })).toEqual(attempt);
  expect(await f.persistence.getLatestResearchDisclosureArtifactAttempt({ ...lookup, artifactId: "unknown" })).toBeNull();
  const bulk = vi.spyOn(f.persistence, "listResearchDisclosureScans").mockRejectedValue(new Error("bulk scan read forbidden"));
  const announcements = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context });
  expect(announcements.scan).toMatchObject({ status: "current", record: { id: f.scan.id }, latestAttempt: { id: "latest_failed" } });
  const artifact = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: attempt.artifactId });
  expect(artifact.quality.reasonCodes).toContain("disclosure_source_too_large");
  expect(bulk).not.toHaveBeenCalled();
});

it("bounded query validation: invalid method-specific selectors → rejected before memory filtering", async () => {
  const f = await disclosureFixture();
  const scope = { issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt };
  await expect(f.persistence.getResearchAnnouncementsByIds({ ...scope, ids: ["invalid/id"] })).rejects.toThrow();
  await expect(f.persistence.hasResearchDisclosureArtifactReference({ ...scope, artifactId: "invalid/id" })).rejects.toThrow();
  await expect(f.persistence.hasResearchDisclosureArtifactReference({ ...scope, artifactId: f.artifact.id, reference: { kind: "announcement_attachment", id: "invalid/id" } })).rejects.toThrow();
  await expect(f.persistence.listResearchAnnouncementSelectionMetadata({ ...scope, publishedFrom: scope.effectiveAt, publishedTo: "2026-08-01T00:00:00.000Z" })).rejects.toThrow();
  await expect(f.persistence.listResearchAnnouncementSelectionMetadata({ ...scope, publishedFrom: "2026-08-01T00:00:00.000Z", publishedTo: scope.effectiveAt, eventFrom: "2026-02-31" })).rejects.toThrow();
  await expect(f.persistence.findResearchAnnouncementCandidates({ ...scope, kind: "citation", before: scope.effectiveAt, titles: [""], days: ["2026-09-01"] })).rejects.toThrow();
  await expect(f.persistence.findResearchAnnouncementCandidates({ ...scope, kind: "revision", collectionRecordId: "invalid/id", publishedAt: scope.effectiveAt, subject: "title" })).rejects.toThrow();
  await expect(f.persistence.getLatestSuccessfulDisclosureDetail({ ...scope, collectionRecordId: "invalid/id" })).rejects.toThrow();
});

it("confirmed PDF empty pages: inconsistent stored coverage → rejected without masking blocks", async () => {
  const f = await disclosureFixture();
  for (const confirmedEmptyPages of [[2, 2], [5], [1]]) {
    await expect(f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "invalid_empty", blocks: [f.artifact.blocks[0]!], confirmedEmptyPages }])).rejects.toThrow("Confirmed empty pages");
  }
  await expect(f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "invalid_provisional_empty", blocks: [{ ...f.artifact.blocks[0]!, extractionState: "provisional_ocr" }], confirmedEmptyPages: [1] }])).rejects.toThrow("Confirmed empty pages");
});

it.each(["corrects", "retracts"] as const)("outside-window ambiguous %s: target projection → recursive resolved revision retires only old ambiguity", async (kind) => {
  const f = await disclosureFixture();
  const other = { ...f.announcement, id: "ann2" };
  const notice: ResearchAnnouncementRecord = { ...f.announcement, id: "ambiguous_notice", collectionRecordId: "notice_collection", publishedAt: "2026-09-01T01:30:00.000Z", unresolvedRelations: [{ kind, candidateAnnouncementIds: ["ann1", "ann2"] }], detailQuality: { status: "available", reasonCodes: ["unresolved_correction_reference"] } };
  await f.persistence.appendResearchAnnouncements([other, notice]);
  const input = { subject: f.subject, context: f.context, range: { publishedFrom: f.announcement.publishedAt, publishedTo: f.announcement.publishedAt } };
  const ambiguous = await listMaterialAnnouncements(f.persistence, input);
  expect(ambiguous.items.map((item) => item.id).sort()).toEqual(["ann1", "ann2"]);
  expect(ambiguous.relationIndex).toEqual([]);
  expect(ambiguous.unresolvedRelationIndex).toEqual([{ sourceAnnouncementId: notice.id, kind, candidateAnnouncementIds: ["ann1", "ann2"] }]);
  const first = await listMaterialAnnouncements(f.persistence, { ...input, limit: 1 });
  expect(first.unresolvedRelationIndex[0]?.candidateAnnouncementIds).toEqual(first.items.map((item) => item.id));
  // This revision targets an outside-window original, so only the second-hop
  // supersession edge can connect it back to the visible ambiguity candidates.
  await f.persistence.appendResearchAnnouncements([{ ...notice, id: "resolved_notice", unresolvedRelations: [], relations: [{ kind, targetAnnouncementId: "outside_target" }, { kind: "supersedes", targetAnnouncementId: notice.id }] }]);
  const resolved = await listMaterialAnnouncements(f.persistence, input);
  expect(resolved.unresolvedRelationIndex).toEqual([]);
  expect(resolved.items.map((item) => item.id).sort()).toEqual(["ann1", "ann2"]);
  expect(resolved.page.continuity.queryHash).not.toBe(ambiguous.page.continuity.queryHash);
  // A separate unresolved observation has not been superseded and remains active.
  await f.persistence.appendResearchAnnouncements([{ ...notice, id: "independent_notice", collectionRecordId: "independent_collection" }]);
  expect((await listMaterialAnnouncements(f.persistence, input)).unresolvedRelationIndex).toEqual([{ sourceAnnouncementId: "independent_notice", kind, candidateAnnouncementIds: ["ann1", "ann2"] }]);
});

it("missing material artifact: retained scoped membership → typed unavailable, explicit wrong parent still rejected", async () => {
  const f = await disclosureFixture();
  await f.persistence.appendResearchDisclosureMaterialReferences([{ id: "material_missing", issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue, publishedAt: f.artifact.publishedAt, artifactIds: ["missing_material_artifact"], provenance: f.artifact.provenance }]);
  const input = { subject: f.subject, context: f.context, artifactId: "missing_material_artifact" };
  const result = await getDisclosureArtifact(f.persistence, input);
  expect(result.artifact).toBeNull(); expect(result.quality.status).toBe("not_acquired");
  await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: input.artifactId, reference: { kind: "announcement_attachment", id: f.announcement.id } }]);
  await expect(getDisclosureArtifact(f.persistence, input)).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
});

it.each(["corrects", "retracts"] as const)("superseded %s notice: effective index → old target restored while audit lineage survives", async (kind) => {
  for (const evidenceView of ["selected_with_conflicts", "all_observations"] as const) {
    for (const repoint of [false, true]) {
      const f = await disclosureFixture();
      const target = { ...f.announcement, id: "new_target" };
      const old: ResearchAnnouncementRecord = { ...f.announcement, id: "old_notice", publishedAt: "2026-09-01T01:10:00.000Z", relations: [{ kind, targetAnnouncementId: f.announcement.id }] };
      const middle: ResearchAnnouncementRecord = { ...old, id: "middle_notice", relations: [{ kind: "supersedes", targetAnnouncementId: old.id }] };
      const latest: ResearchAnnouncementRecord = { ...middle, id: "latest_notice", relations: [{ kind: "supersedes", targetAnnouncementId: middle.id }, ...(repoint ? [{ kind, targetAnnouncementId: target.id }] : [])] };
      await f.persistence.appendResearchAnnouncements([target, old, middle, latest]);
      const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, evidenceView });
      expect(result.relationIndex.filter((relation) => relation.kind === kind)).toEqual(repoint ? [{ announcementId: latest.id, kind, targetAnnouncementId: target.id }] : []);
      expect(result.selection.selectedObservationIds).not.toContain(old.id);
      expect(result.selection.selectedObservationIds).not.toContain(middle.id);
      if (evidenceView === "all_observations") {
        expect(result.items.find((item) => item.id === old.id)?.relations).toEqual(old.relations);
        expect(result.relationIndex).toContainEqual({ announcementId: middle.id, kind: "supersedes", targetAnnouncementId: old.id });
      }
      const windowed = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, evidenceView, range: { publishedFrom: f.announcement.publishedAt, publishedTo: f.announcement.publishedAt } });
      expect(windowed.relationIndex.filter((relation) => relation.kind === kind)).toEqual(repoint ? [{ announcementId: latest.id, kind, targetAnnouncementId: target.id }] : []);
    }
  }
});
