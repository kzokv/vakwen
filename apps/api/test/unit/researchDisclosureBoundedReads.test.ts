import { describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { getResearchIdentity } from "../../src/services/research/service.js";
import { getDisclosureArtifact, listMaterialAnnouncements } from "../../src/services/research/disclosures.js";
import { composeFocusedDisclosureResearchReport } from "../../src/services/research/disclosureReport.js";
import type { ResearchAnnouncementRecord, ResearchDisclosureArtifact } from "../../src/services/research/disclosureContracts.js";

async function fixture(venue: "TWSE" | "TPEX" = "TWSE") {
  const persistence = new MemoryPersistence();
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-08-31", retrievedAt: "2026-08-31T00:00:00.000Z",
    artifact: { contentHash: "bounded-fixture", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
    row: { kind: "company", ticker: "2330", legalName: "研究公司", displayName: "研究公司", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "2000-01-01" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const context = { knowledgeAt: "2026-09-02T02:00:00.000Z", effectiveAt: "2026-09-02T02:00:00.000Z", assessmentMode: "effective" as const };
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const provenance: ResearchAnnouncementRecord["provenance"] = { id: "bounded_provenance", publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative",
    sourceUrl: "https://mops.twse.com.tw/retained", contentHash: "a".repeat(64), retrievedAt: "2026-09-02T01:59:00.000Z", processedAt: "2026-09-02T01:59:00.000Z", acquisitionRunId: "bounded_run", parserVersion: "disclosures/1.0.0", usagePolicyVersion: "taiwan-open-data/1.0.0" };
  const announcement: ResearchAnnouncementRecord = { id: "parent", issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: identity.listing.ticker, venue,
    publishedAt: "2026-09-01T01:00:00.000Z", publicationPrecision: "second", subject: "重大訊息", ruleClause: "51", eventDate: "2026-09-01", explanation: "官方已公告產能計畫。",
    sourceUrl: provenance.sourceUrl, attachments: [{ id: "attachment", artifactId: "artifact", title: "附件", sourceUrl: provenance.sourceUrl, mediaType: "text/plain" }], relations: [], quality: "available", provenance };
  const artifact: ResearchDisclosureArtifact = { id: "artifact", issuerId: identity.issuer.id, contentHash: provenance.contentHash, extractionVersion: "extract/1", publishedAt: announcement.publishedAt,
    sourceUrl: provenance.sourceUrl, mediaType: "text/plain", reference: { kind: "announcement_attachment", id: announcement.id }, state: "available", totalPages: 1,
    blocks: [{ id: "block", page: 1, table: null, text: "留存證據", extractionState: "retained_text", subject: identity.issuer.id, period: null, unit: null }], verifiedClaims: [], provenance };
  const range = { publishedFrom: "2026-09-01T00:00:00.000Z", publishedTo: "2026-09-01T12:00:00.000Z" };
  await persistence.appendResearchDisclosureScans([{ id: "scan", issuerId: identity.issuer.id, listingId: identity.listing.id, venue, checkedAt: context.knowledgeAt,
    publicationStart: "2025-09-02T02:00:00.000Z", publicationEnd: context.knowledgeAt, knowledgeAt: context.knowledgeAt, status: "success", exhaustive: true, provenance }]);
  const history = Array.from({ length: 240 }, (_, index) => ({ ...announcement, id: `irrelevant_${index}`, publishedAt: "2025-01-01T00:00:00.000Z",
    explanation: `unrelated-large-history-${index}:` + "文".repeat(16_000), attachments: [], relations: [] }));
  await persistence.appendResearchAnnouncements(history);
  return { persistence, identity, subject, context, announcement, artifact, range, provenance };
}

function rejectHistoryReads(persistence: MemoryPersistence) {
  return [
    vi.spyOn(persistence, "listResearchAnnouncements").mockRejectedValue(new Error("Whole announcement history must not be transferred")),
    vi.spyOn(persistence, "listResearchDisclosureMaterialReferences").mockRejectedValue(new Error("Whole material reference history must not be transferred")),
    vi.spyOn(persistence, "listResearchDisclosureScans").mockRejectedValue(new Error("Whole scan history must not be transferred")),
  ];
}

describe("bounded disclosure reads", () => {
  it.each(["TWSE", "TPEX"] as const)("%s publication window: large irrelevant history → transfer only page-selected payloads with complete cursor chain", async (venue) => {
    const f = await fixture(venue);
    await f.persistence.appendResearchAnnouncements(Array.from({ length: 125 }, (_, index) => ({ ...f.announcement, id: `window_${String(index).padStart(3, "0")}`, attachments: [] })));
    const broadReads = rejectHistoryReads(f.persistence);
    const payloads = vi.spyOn(f.persistence, "getResearchAnnouncementsByIds");
    const metadata = vi.spyOn(f.persistence, "listResearchAnnouncementSelectionMetadata");
    const range = { publishedFrom: "2025-09-02T02:00:00.000Z", publishedTo: f.context.effectiveAt };
    const pages: Awaited<ReturnType<typeof listMaterialAnnouncements>>[] = [];
    let cursor: string | null = null;
    do {
      const page = await listMaterialAnnouncements(f.persistence, cursor ? { subject: f.subject, cursor } : { subject: f.subject, context: f.context, range, limit: 100 });
      pages.push(page); cursor = page.page.nextCursor;
      expect(page.page.continuity.totalCount).toBe(125);
      expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(255 * 1024);
    } while (cursor);
    expect(pages.flatMap((page) => page.items.map((item) => item.id))).toEqual(Array.from({ length: 125 }, (_, index) => `window_${String(124 - index).padStart(3, "0")}`));
    expect(new Set(pages.map((page) => page.page.continuity.queryHash)).size).toBe(1);
    expect(payloads.mock.calls).toHaveLength(pages.length);
    for (const [query] of payloads.mock.calls) {
      expect(query.ids.length).toBeLessThanOrEqual(100);
      expect(query.ids.every((id) => id.startsWith("window_"))).toBe(true);
      expect(query).toMatchObject({ issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue });
    }
    for (const result of metadata.mock.results) {
      const rows = await result.value;
      expect(JSON.stringify(rows)).not.toContain("unrelated-large-history");
      expect(rows).toHaveLength(125);
      for (const row of rows) { expect(row).not.toHaveProperty("explanation"); expect(row).not.toHaveProperty("attachments"); }
    }
    const identity = await getResearchIdentity(f.persistence, { subject: f.subject, context: f.context, history: { limit: 1 } });
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages: pages, mode: "standard" });
    expect(report.reportStatus).toBe("complete");
    expect(report.window.exhaustive).toBe(true);
    expect(pages.every((page) => page.quality.completeness === "partial" && page.quality.readiness.exhaustiveConclusion === "blocked")).toBe(true);
    expect(() => composeFocusedDisclosureResearchReport({ identity, announcementPages: [pages.at(-1)!], mode: "standard" })).toThrow(/page continuity/);
    for (const spy of broadReads) expect(spy).not.toHaveBeenCalled();
  });
  it("exact attachment authorization: known, missing, unknown and foreign parent → no unrelated history payloads", async () => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement,
      { ...f.announcement, id: "missing_parent", attachments: [{ ...f.announcement.attachments[0]!, artifactId: "missing_artifact" }] },
      { ...f.announcement, id: "foreign_parent", listingId: "foreign_listing", attachments: [{ ...f.announcement.attachments[0]!, artifactId: "foreign_artifact" }] }]);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact,
      { ...f.artifact, id: "foreign_artifact", reference: { kind: "announcement_attachment", id: "foreign_parent" } },
      { ...f.artifact, id: "wrong_parent_artifact", reference: { kind: "announcement_attachment", id: f.announcement.id } }]);
    const broadReads = rejectHistoryReads(f.persistence);
    const artifacts = vi.spyOn(f.persistence, "listResearchDisclosureArtifacts");
    const references = vi.spyOn(f.persistence, "hasResearchDisclosureArtifactReference");
    const read = (artifactId: string) => getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId });
    expect((await read(f.artifact.id)).artifact?.id).toBe(f.artifact.id);
    expect((await read("missing_artifact")).artifact).toBeNull();
    for (const id of ["unknown", "foreign_artifact", "wrong_parent_artifact"]) {
      await expect(read(id)).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
    }
    expect(artifacts.mock.calls.map(([query]) => query.artifactId)).toEqual(["artifact", "missing_artifact", "unknown", "foreign_artifact", "wrong_parent_artifact"]);
    expect(references.mock.calls.map(([query]) => ({ id: query.artifactId, reference: query.reference }))).toEqual([
      { id: "artifact", reference: { kind: "announcement_attachment", id: "parent" } },
      { id: "missing_artifact", reference: undefined }, { id: "unknown", reference: undefined },
      { id: "foreign_artifact", reference: { kind: "announcement_attachment", id: "foreign_parent" } },
      { id: "wrong_parent_artifact", reference: { kind: "announcement_attachment", id: "parent" } },
    ]);
    for (const [query] of references.mock.calls) expect(query).toMatchObject({ issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue,
      knowledgeAt: f.context.knowledgeAt, effectiveAt: f.context.effectiveAt });
    for (const spy of broadReads) expect(spy).not.toHaveBeenCalled();
  });

  it("exact material authorization: large unrelated reference history → require both reference ID and artifact membership", async () => {
    const f = await fixture();
    const material = { ...f.artifact, id: "material_artifact", reference: { kind: "investor_material" as const, id: "material_reference" } };
    await f.persistence.appendResearchDisclosureArtifacts([material]);
    const reference = { id: "material_reference", issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue,
      publishedAt: material.publishedAt, artifactIds: [material.id], provenance: f.provenance };
    await f.persistence.appendResearchDisclosureMaterialReferences(Array.from({ length: 240 }, (_, index) => ({ ...reference, id: `irrelevant_reference_${index}`, artifactIds: [`unrelated_artifact_${index}`] })));
    await f.persistence.appendResearchDisclosureMaterialReferences([{ ...reference, id: "wrong_reference" }]);
    const broadReads = rejectHistoryReads(f.persistence);
    const references = vi.spyOn(f.persistence, "hasResearchDisclosureArtifactReference");
    const input = { subject: f.subject, context: f.context, artifactId: material.id };
    await expect(getDisclosureArtifact(f.persistence, input)).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
    await f.persistence.appendResearchDisclosureMaterialReferences([reference]);
    expect((await getDisclosureArtifact(f.persistence, input)).artifact?.id).toBe(material.id);
    expect(references).toHaveBeenCalledTimes(2);
    for (const [query] of references.mock.calls) expect(query).toMatchObject({ issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue,
      artifactId: material.id, reference: material.reference });
    await f.persistence.appendResearchDisclosureArtifacts([{ ...material, id: "wrong_membership", reference: { kind: "investor_material", id: "wrong_membership_reference" } }]);
    await f.persistence.appendResearchDisclosureMaterialReferences([{ ...reference, id: "wrong_membership_reference", artifactIds: ["another_artifact"] }]);
    await expect(getDisclosureArtifact(f.persistence, { ...input, artifactId: "wrong_membership" })).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
    for (const spy of broadReads) expect(spy).not.toHaveBeenCalled();
  });

  it("window selection: out-of-window correction, supersession and conflict siblings → retain lineage without inflating payload counts", async () => {
    const f = await fixture();
    const outside = "2026-09-01T23:00:00.000Z";
    await f.persistence.appendResearchAnnouncements([
      { ...f.announcement, id: "corrected_target", attachments: [] },
      { ...f.announcement, id: "superseded_target", attachments: [] },
      { ...f.announcement, id: "conflict_target", collectionRecordId: "conflict_collection", attachments: [] },
      { ...f.announcement, id: "outside_correction", publishedAt: outside, relations: [{ kind: "corrects", targetAnnouncementId: "corrected_target" }], attachments: [] },
      { ...f.announcement, id: "outside_successor", publishedAt: outside, relations: [{ kind: "supersedes", targetAnnouncementId: "superseded_target" }], attachments: [] },
      { ...f.announcement, id: "outside_conflict", publishedAt: outside, collectionRecordId: "conflict_collection", attachments: [] },
    ]);
    const broadReads = rejectHistoryReads(f.persistence);
    const payloads = vi.spyOn(f.persistence, "getResearchAnnouncementsByIds");
    const input = { subject: f.subject, context: f.context, range: f.range };
    const selected = await listMaterialAnnouncements(f.persistence, input);
    expect(selected.items.map((item) => item.id).sort()).toEqual(["conflict_target", "corrected_target"]);
    expect(selected.page.continuity.totalCount).toBe(2);
    expect(selected.selection.excludedObservationCount).toBe(1);
    expect(selected.selection.conflictObservationIds).toEqual(["conflict_target"]);
    expect(selected.relationIndex).toContainEqual({ provenanceId: expect.any(String), announcementId: "outside_correction", kind: "corrects", targetAnnouncementId: "corrected_target" });
    const identity = await getResearchIdentity(f.persistence, { subject: f.subject, context: f.context, history: { limit: 1 } });
    const candidates = ["corrected_target", "conflict_target"].map((id) => ({ id, kind: "risk" as const, status: "conditional" as const,
      statement: f.announcement.explanation, statusEvidence: { reference: { kind: "announcement" as const, announcementId: id }, excerpt: f.announcement.explanation },
      triggeringEvidence: [{ kind: "announcement" as const, announcementId: id }], confirmingEvidence: [], disconfirmingEvidence: [],
      materialMechanism: "Capacity affects output", affectedMetricOrAssumption: "revenue", horizon: "2027", condition: "Commissioning proceeds",
      confirmationCondition: "Official commissioning disclosure", disconfirmationCondition: "Official cancellation" }));
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages: [selected], candidates });
    expect(report.assessments.map((assessment) => assessment.sourceSupport)).toEqual(["withheld", "withheld"]);
    expect(report.assessments[0]!.reasonCodes).toContain("announcement_corrected_or_retracted");
    expect(report.assessments[1]!.reasonCodes).toContain("announcement_conflict_unresolved");
    const audit = await listMaterialAnnouncements(f.persistence, { ...input, evidenceView: "all_observations" });
    expect(audit.items.map((item) => item.id).sort()).toEqual(["conflict_target", "corrected_target", "superseded_target"]);
    expect(audit.page.continuity.totalCount).toBe(3);
    expect(audit.selection.excludedObservationCount).toBe(0);
    expect(audit.relationIndex).toContainEqual({ provenanceId: expect.any(String), announcementId: "outside_successor", kind: "supersedes", targetAnnouncementId: "superseded_target" });
    expect(payloads.mock.calls.flatMap(([query]) => query.ids).some((id) => id.startsWith("outside_") || id.startsWith("irrelevant_"))).toBe(false);
    for (const spy of broadReads) expect(spy).not.toHaveBeenCalled();
  });

  it("conflict companion lineage: outside-window sibling superseded later → no manufactured unresolved conflict", async () => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([
      { ...f.announcement, id: "target", collectionRecordId: "collection", attachments: [] },
      { ...f.announcement, id: "old_sibling", collectionRecordId: "collection", publishedAt: "2026-08-01T00:00:00.000Z", attachments: [] },
      { ...f.announcement, id: "sibling_successor", publishedAt: "2026-09-01T23:00:00.000Z", relations: [{ kind: "supersedes", targetAnnouncementId: "old_sibling" }], attachments: [] },
    ]);
    const broadReads = rejectHistoryReads(f.persistence);
    const result = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context, range: f.range });
    expect(result.items.map((item) => item.id)).toEqual(["target"]);
    expect(result.selection.conflictObservationIds).toEqual([]);
    expect(result.selection.reasonCodes).not.toContain("open_equal_authority_conflict_retained");
    expect(result.page.continuity.totalCount).toBe(1);
    expect(result.selection.excludedObservationCount).toBe(0);
    for (const spy of broadReads) expect(spy).not.toHaveBeenCalled();
  });

  it.each(["corrects", "retracts"] as const)("outside-window %s arrives between pages: changed relevant lineage → reject mixed continuity while ignoring unrelated history", async (kind) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "z_target", attachments: [] }, { ...f.announcement, id: "a_target", attachments: [] }]);
    const broadReads = rejectHistoryReads(f.persistence);
    const input = { subject: f.subject, context: f.context, range: f.range, limit: 1 };
    const first = await listMaterialAnnouncements(f.persistence, input);
    expect(first.items.map((item) => item.id)).toEqual(["z_target"]);
    const continuation = { subject: f.subject, cursor: first.page.nextCursor! };
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "unrelated_late_history", publishedAt: "2025-01-01T00:00:00.000Z", attachments: [] }]);
    const stable = await listMaterialAnnouncements(f.persistence, continuation);
    expect(stable.page.continuity.queryHash).toBe(first.page.continuity.queryHash);
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "outside_revision", publishedAt: "2026-09-01T23:00:00.000Z", relations: [{ kind, targetAnnouncementId: "z_target" }], attachments: [] }]);
    const changed = await listMaterialAnnouncements(f.persistence, continuation);
    expect(changed.items.map((item) => item.id)).toEqual(stable.items.map((item) => item.id));
    expect(changed.page.continuity.totalCount).toBe(2);
    expect(changed.page.continuity.queryHash).not.toBe(first.page.continuity.queryHash);
    const identity = await getResearchIdentity(f.persistence, { subject: f.subject, context: f.context, history: { limit: 1 } });
    expect(() => composeFocusedDisclosureResearchReport({ identity, announcementPages: [first, changed] })).toThrow(/page continuity/);
    for (const spy of broadReads) expect(spy).not.toHaveBeenCalled();
  });

});
