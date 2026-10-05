import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import type { Persistence } from "../../src/persistence/types.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { getDisclosureArtifact, listMaterialAnnouncements } from "../../src/services/research/disclosures.js";
import type { ResearchAnnouncementRecord, ResearchDisclosureArtifact, ResearchDisclosureScan } from "../../src/services/research/disclosureContracts.js";
const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const enabled = process.env.RUN_POSTGRES_INTEGRATION === "1";
if (enabled && process.env.VAKWEN_MANAGED_CI_STACK !== "1") throw new Error("Use npm run test:integration:full:host for managed Postgres tests");
const describePostgres = enabled && databaseUrl && redisUrl ? describe : describe.skip;
async function disclosureFixture(persistence: Persistence, venue: "TWSE" | "TPEX" = "TWSE") {
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
describePostgres("disclosure memory/Postgres conformance", () => {
  let pool: Pool;
  let postgres: PostgresPersistence;
  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA IF EXISTS research CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
    postgres = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await postgres.init();
  });
  afterEach(async () => { await postgres.close(); await pool.end(); });
  it.each(["TWSE", "TPEX"] as const)("%s: retained correction and artifact → backend parity and knowledge cutoff", async (venue) => {
    const memory = new MemoryPersistence();
    const fixtures = await Promise.all([disclosureFixture(memory, venue), disclosureFixture(postgres, venue)]);
    const results = [];
    for (const f of fixtures) {
      const correction = { ...f.announcement, id: "correction", publishedAt: "2026-09-02T01:00:00.000Z", relations: [{ kind: "corrects" as const, targetAnnouncementId: f.announcement.id }], provenance: { ...f.announcement.provenance, id: "correction_provenance", retrievedAt: "2026-09-02T01:01:00.000Z", processedAt: "2026-09-02T01:02:00.000Z" } };
      await f.persistence.appendResearchAnnouncements([correction]);
      const early = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context });
      expect(early.items.map(item => item.id)).toEqual(["ann1"]);
      const late = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: { knowledgeAt: "2026-09-02T02:00:00.000Z" } });
      expect(late.relationIndex).toContainEqual({ announcementId: "correction", kind: "corrects", targetAnnouncementId: "ann1" });
      const artifact = await getDisclosureArtifact(f.persistence, { subject: f.subject, context: f.context, artifactId: f.artifact.id, limit: 10 });
      expect(artifact.artifact?.contentHash).toBe(f.artifact.contentHash);
      expect(artifact.page.returnedPages).toEqual([1, 2, 3, 4]);
      results.push({ early, late, artifact });
    }
    expect(results[1]).toEqual(results[0]);
  });
  it("durable evidence: replay and conflicting revision → immutable rows survive restart", async () => {
    const f = await disclosureFixture(postgres);
    await postgres.appendResearchAnnouncements([f.announcement]);
    await expect(postgres.appendResearchAnnouncements([{ ...f.announcement, explanation: "rewritten" }])).rejects.toThrow();
    await expect(postgres.appendResearchDisclosureArtifacts([{ ...f.artifact, extractionVersion: "changed" }])).rejects.toThrow();
    await expect(postgres.appendResearchDisclosureScans([{ ...f.scan, exhaustive: true }])).rejects.toThrow();
    await postgres.close();
    postgres = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await postgres.init();
    const query = { issuerId: f.identity.issuer.id, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt };
    expect(await postgres.listResearchAnnouncements(query)).toEqual([f.announcement]);
    expect(await postgres.listResearchDisclosureArtifacts(query)).toEqual([f.artifact]);
    expect(await postgres.listResearchDisclosureScans(query)).toEqual([f.scan]);
    expect(await postgres.listResearchAnnouncements({ ...query, issuerId: "unrelated_issuer" })).toEqual([]);
  });
  it("shared issuer across boards: listing-scoped announcements and artifacts → memory/Postgres parity", async () => {
    const results = [];
    for (const persistence of [new MemoryPersistence(), postgres]) {
      const f = await disclosureFixture(persistence);
      const otherIdentity = canonicalizeOfficialIdentityRow({ venue: "TPEX", snapshotDate: "2026-08-31", retrievedAt: "2026-08-31T02:00:00.000Z", artifact: { contentHash: "other-board-identity", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" }, row: { kind: "company", ticker: "2330", legalName: "公司", displayName: "公司", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05" } });
      expect(otherIdentity.issuer.id).toBe(f.identity.issuer.id);
      await persistence.appendResearchIdentityRecords([otherIdentity]);
      const otherAnnouncement = { ...f.announcement, id: "other_listing_announcement", listingId: otherIdentity.listing.id, venue: "TPEX" as const, attachments: [{ ...f.announcement.attachments[0]!, artifactId: "other_listing_artifact" }], relations: [{ kind: "supersedes" as const, targetAnnouncementId: f.announcement.id }] };
      await persistence.appendResearchAnnouncements([otherAnnouncement]);
      await persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "other_listing_artifact", reference: { kind: "announcement_attachment", id: otherAnnouncement.id } }]);
      const result = await listMaterialAnnouncements(persistence, { subject: f.subject, context: f.context });
      expect(result.items.map((item) => item.id)).toEqual([f.announcement.id]); expect(result.relationIndex).toEqual([]);
      await expect(getDisclosureArtifact(persistence, { subject: f.subject, context: f.context, artifactId: "other_listing_artifact" })).rejects.toMatchObject({ code: "research_artifact_not_referenced" });
      const otherSubject = { kind: "listing_id" as const, listingId: otherIdentity.listing.id };
      const otherResult = await listMaterialAnnouncements(persistence, { subject: otherSubject, context: f.context });
      expect(otherResult.items.map((item) => item.id)).toEqual([otherAnnouncement.id]);
      const otherArtifact = await getDisclosureArtifact(persistence, { subject: otherSubject, context: f.context, artifactId: "other_listing_artifact", limit: 10 });
      expect(otherArtifact.artifact?.id).toBe("other_listing_artifact");
      results.push({ result, otherResult, otherArtifact });
    }
    expect(results[1]).toEqual(results[0]);
  });

  it("artifact lookup: ID-bounded SQL → no unrelated JSONB payload transfer with temporal parity", async () => {
    const f = await disclosureFixture(postgres);
    await postgres.appendResearchDisclosureArtifacts([{ ...f.artifact, id: "unrelated_large", retainedBytesBase64: "YQ==".repeat(250_000) }]);
    const query = { issuerId: f.identity.issuer.id, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt, artifactId: f.artifact.id };
    const sql = vi.spyOn(Pool.prototype, "query");
    try {
      expect(await postgres.listResearchDisclosureArtifacts(query)).toEqual([f.artifact]);
      expect(await postgres.listResearchDisclosureArtifacts({ ...query, artifactId: "unknown" })).toEqual([]);
      expect(await postgres.listResearchDisclosureArtifacts({ ...query, issuerId: "other_issuer" })).toEqual([]);
      expect(await postgres.listResearchDisclosureArtifacts({ ...query, knowledgeAt: "2026-09-01T01:00:00.000Z", effectiveAt: "2026-09-01T01:00:00.000Z" })).toEqual([]);
      const selects = sql.mock.calls.filter(([statement]) => typeof statement === "string" && statement.includes("SELECT record FROM research.disclosure_artifacts"));
      expect(selects).toHaveLength(4);
      expect(selects.every(([statement]) => String(statement).includes("AND id=$4"))).toBe(true);
    } finally { sql.mockRestore(); }
  });

  it("bounded scan SQL: latest failure plus cached success and older artifact attempt → memory parity", async () => {
    const results = [];
    for (const persistence of [new MemoryPersistence(), postgres]) {
      const f = await disclosureFixture(persistence);
      const query = { issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt };
      const attempt = { artifactId: "missing", sourceUrl: f.announcement.sourceUrl, attemptedAt: "2026-09-01T01:30:00.000Z", status: "processing_failed" as const, reasonCode: "disclosure_source_too_large" as const };
      await persistence.appendResearchDisclosureScans([
        { ...f.scan, id: "older_attempt", checkedAt: "2026-09-01T01:30:00.000Z", status: "failed", artifactAttempts: [attempt] },
        { ...f.scan, id: "latest_failed", checkedAt: f.context.knowledgeAt, status: "failed" },
        { ...f.scan, id: "wrong_listing", listingId: "different_listing", checkedAt: f.context.knowledgeAt },
        { ...f.scan, id: "wrong_venue", venue: "TPEX", checkedAt: f.context.knowledgeAt },
        { ...f.scan, id: "future_knowledge", checkedAt: f.context.knowledgeAt, knowledgeAt: "2026-09-02T00:00:00.000Z" },
      ]);
      const sql = vi.spyOn(Pool.prototype, "query");
      try {
        const scans = await persistence.listLatestResearchDisclosureScans(query);
        const artifactAttempt = await persistence.getLatestResearchDisclosureArtifactAttempt({ ...query, artifactId: attempt.artifactId });
        expect(scans.map((scan) => scan.id)).toEqual(["latest_failed", f.scan.id]);
        expect(artifactAttempt).toEqual(attempt);
        expect(await persistence.getLatestResearchDisclosureArtifactAttempt({ ...query, artifactId: "unknown" })).toBeNull();
        expect(await persistence.listLatestResearchDisclosureScans({ ...query, effectiveAt: "2026-09-01T01:00:00.000Z" })).toEqual([]);
        if (persistence === postgres) {
          const statements = sql.mock.calls.map(([statement]) => String(statement));
          expect(statements.every((statement) => statement.includes("LIMIT 1"))).toBe(true);
          expect(statements.some((statement) => statement.startsWith("SELECT attempt.value AS attempt"))).toBe(true);
        }
        results.push({ scans, artifactAttempt });
      } finally { sql.mockRestore(); }
    }
    expect(results[1]).toEqual(results[0]);
  });

  it("bounded announcement SQL: window companions, exact references, page IDs and Unicode candidates → memory parity", async () => {
    const results = [];
    for (const persistence of [new MemoryPersistence(), postgres]) {
      const f = await disclosureFixture(persistence);
      const scope = { issuerId: f.identity.issuer.id, listingId: f.identity.listing.id, venue: f.identity.listing.venue, effectiveAt: f.context.knowledgeAt, knowledgeAt: f.context.knowledgeAt };
      const correction = { ...f.announcement, id: "outside_correction", publishedAt: "2026-09-01T01:30:00.000Z", relations: [{ kind: "corrects" as const, targetAnnouncementId: f.announcement.id }] };
      const unicode = { ...f.announcement, id: "unicode_candidate", collectionRecordId: "collection", subject: "公司\u3000資本\ufeff支出", detailQuality: { status: "available" as const, reasonCodes: [] } };
      await persistence.appendResearchAnnouncements([correction, unicode, { ...f.announcement, id: "large_unrelated_history", publishedAt: "2026-08-01T00:00:00.000Z", explanation: "x".repeat(1_000_000) }]);
      const sql = vi.spyOn(Pool.prototype, "query");
      try {
        const metadata = await persistence.listResearchAnnouncementSelectionMetadata({ ...scope, publishedFrom: f.announcement.publishedAt, publishedTo: f.announcement.publishedAt });
        expect(metadata.map((record) => record.id).sort()).toEqual([f.announcement.id, correction.id, unicode.id].sort());
        expect(metadata.every((record) => !("explanation" in record) && !("attachments" in record))).toBe(true);
        expect(await persistence.getResearchAnnouncementsByIds({ ...scope, ids: [f.announcement.id] })).toEqual([f.announcement]);
        expect(await persistence.hasResearchDisclosureArtifactReference({ ...scope, artifactId: f.artifact.id, reference: f.artifact.reference })).toBe(true);
        expect(await persistence.hasResearchDisclosureArtifactReference({ ...scope, listingId: "wrong_listing", artifactId: f.artifact.id })).toBe(false);
        const candidates = await persistence.findResearchAnnouncementCandidates({ ...scope, kind: "citation", before: scope.effectiveAt, titles: ["公司資本支出"], days: ["2026-09-01"] });
        expect(candidates.map((record) => record.id)).toEqual([unicode.id]);
        expect((await persistence.getLatestSuccessfulDisclosureDetail({ ...scope, collectionRecordId: "collection" }))?.id).toBe(unicode.id);
        if (persistence === postgres) {
          const statements = sql.mock.calls.map(([statement]) => String(statement));
          expect(statements.some((statement) => statement.includes("record - 'explanation' - 'attachments'"))).toBe(true);
          expect(statements.some((statement) => statement.includes("AND id=ANY($6::text[])"))).toBe(true);
          expect(statements.some((statement) => statement.startsWith("SELECT EXISTS"))).toBe(true);
        }
        results.push({ metadata: metadata.sort((a, b) => a.id.localeCompare(b.id)), candidates });
        const invalid = { ...scope, knowledgeAt: "2026-09-01T00:00:00.000Z" };
        await expect(persistence.getResearchAnnouncementsByIds({ ...invalid, ids: [] })).rejects.toThrow("effectiveAt");
        await expect(persistence.hasResearchDisclosureArtifactReference({ ...invalid, artifactId: f.artifact.id })).rejects.toThrow("effectiveAt");
        await expect(persistence.listResearchAnnouncementSelectionMetadata({ ...invalid, publishedFrom: f.announcement.publishedAt, publishedTo: f.announcement.publishedAt })).rejects.toThrow("effectiveAt");
        await expect(persistence.findResearchAnnouncementCandidates({ ...invalid, kind: "citation", before: scope.effectiveAt, titles: [], days: [] })).rejects.toThrow("effectiveAt");
        await expect(persistence.getLatestSuccessfulDisclosureDetail({ ...invalid, collectionRecordId: "collection" })).rejects.toThrow("effectiveAt");
        await expect(persistence.getResearchAnnouncementsByIds({ ...scope, ids: ["invalid/id"] })).rejects.toThrow();
        await expect(persistence.hasResearchDisclosureArtifactReference({ ...scope, artifactId: "invalid/id" })).rejects.toThrow();
        await expect(persistence.listResearchAnnouncementSelectionMetadata({ ...scope, publishedFrom: scope.effectiveAt, publishedTo: "2026-08-01T00:00:00.000Z" })).rejects.toThrow();
        await expect(persistence.findResearchAnnouncementCandidates({ ...scope, kind: "citation", before: scope.effectiveAt, titles: [""], days: ["2026-02-31"] })).rejects.toThrow();
        await expect(persistence.getLatestSuccessfulDisclosureDetail({ ...scope, collectionRecordId: "invalid/id" })).rejects.toThrow();
      } finally { sql.mockRestore(); }
    }
    expect(results[1]).toEqual(results[0]);
  });

  it("ambiguous reverse lineage: out-of-window notice and superseding revision → recursive memory/Postgres parity", async () => {
    const results = [];
    for (const persistence of [new MemoryPersistence(), postgres]) {
      const f = await disclosureFixture(persistence);
      const notice: ResearchAnnouncementRecord = { ...f.announcement, id: "ambiguous_notice", publishedAt: "2026-09-01T01:30:00.000Z", unresolvedRelations: [{ kind: "corrects", candidateAnnouncementIds: ["ann1", "ann2"] }] };
      await persistence.appendResearchAnnouncements([{ ...f.announcement, id: "ann2" }, notice,
        { ...notice, id: "wrong_listing_notice", listingId: "other_listing" },
        { ...notice, id: "future_notice", provenance: { ...notice.provenance, processedAt: "2026-09-02T00:00:00.000Z" } }]);
      const input = { subject: f.subject, context: f.context, range: { publishedFrom: f.announcement.publishedAt, publishedTo: f.announcement.publishedAt } };
      const before = await listMaterialAnnouncements(persistence, input);
      expect(before.unresolvedRelationIndex).toEqual([{ sourceAnnouncementId: notice.id, kind: "corrects", candidateAnnouncementIds: ["ann1", "ann2"] }]);
      await persistence.appendResearchAnnouncements([{ ...notice, id: "resolved_notice", unresolvedRelations: [], relations: [{ kind: "corrects", targetAnnouncementId: "outside_target" }, { kind: "supersedes", targetAnnouncementId: notice.id }] }]);
      const after = await listMaterialAnnouncements(persistence, input);
      expect(after.unresolvedRelationIndex).toEqual([]);
      results.push({ before, after });
    }
    expect(results[1]).toEqual(results[0]);
  });

});
