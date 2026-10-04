import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
});
