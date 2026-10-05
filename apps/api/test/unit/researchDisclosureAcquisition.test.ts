import { twoPagePdf } from "../fixtures/research/disclosurePdf.js";
import { getResearchManifest } from "../../src/services/research/service.js";
import { getDisclosureArtifact, listMaterialAnnouncements } from "../../src/services/research/disclosures.js";
import { researchQuerySchema } from "../../src/services/research/contracts.js";
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { appendOfficialListingStatusRevision, canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { parseOfficialAnnouncementSnapshot, retainAnnouncementExplanation, disclosureHash, OFFICIAL_ANNOUNCEMENT_SOURCES } from "../../src/services/research/providers/mopsAnnouncements.js";
import { runOfficialDisclosureAcquisition } from "../../src/services/research/disclosureAcquisition.js";
import { setResearchRolloutOverrideForTest } from "../../src/services/research/rollout.js";
const at = "2026-10-04T05:00:00.000Z";
function fixture(venue: "TWSE" | "TPEX") {
  const rows = JSON.parse(readFileSync(new URL(`../fixtures/research/${venue.toLowerCase()}-announcements.json`, import.meta.url), "utf8"));
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z", artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], contentHash: "identity" }, row: { kind: "company", ticker: venue === "TWSE" ? "2072" : "4530", legalName: "公司", displayName: "公司", unifiedBusinessNumber: venue === "TWSE" ? "11111111" : "22222222", industryCode: "24", listedAt: "2000-01-01" } });
  return { rows, identity };
}
afterEach(() => setResearchRolloutOverrideForTest(null));
describe("official disclosure routes", () => {
  it.each(["TWSE", "TPEX"] as const)("%s authentic snapshot: native aliases and unpadded timestamp → lossless canonical record", (venue) => {
    const { rows, identity } = fixture(venue);
    const result = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: disclosureHash(JSON.stringify(rows)), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "fixture" }, venue, [identity]);
    expect(result).toHaveLength(1); expect(result[0]?.publishedAt).toBe("2026-10-02T23:00:04.000Z"); expect(result[0]?.publicationPrecision).toBe("second");
    expect(result[0]?.explanation).toBe(rows[0].說明); expect(result[0]?.ruleClause).toBe(rows[0].符合條款);
    const artifact = retainAnnouncementExplanation(result[0]!); expect(artifact.blocks.map((block) => block.text).join("")).toBe(rows[0].說明); expect(artifact.verifiedClaims).toEqual([]);
  });
  it("rollout disabled: ingestion → no upstream read", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: false }); const fetchImpl = vi.fn();
    await expect(runOfficialDisclosureAcquisition(new MemoryPersistence(), { fetchImpl })).rejects.toMatchObject({ code: "research_acquisition_disabled" }); expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("both boards: scheduled acquisition → immutable records, retained artifacts and nonexhaustive scans", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: true }); const persistence = new MemoryPersistence();
    const twse = fixture("TWSE"), tpex = fixture("TPEX"); await persistence.appendResearchIdentityRecords([twse.identity,tpex.identity]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => new Response(JSON.stringify(String(url).includes("t187ap04_L") ? twse.rows : tpex.rows), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "run1" }); expect(result.outcomes.every((item) => item.status === "success")).toBe(true);
    await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:15:00.000Z", acquisitionRunId: "run2" });
    for (const {identity} of [twse,tpex]) {
      const query = { issuerId: identity.issuer.id, effectiveAt: "2026-10-04T06:00:00.000Z", knowledgeAt: "2026-10-04T06:00:00.000Z" };
      expect(await persistence.listResearchAnnouncements(query)).toHaveLength(1); expect(await persistence.listResearchDisclosureArtifacts(query)).toHaveLength(1);
      expect((await persistence.listResearchDisclosureScans(query)).every((scan) => scan.exhaustive === false)).toBe(true);
    }
  });
});

it("board switches: global on with both defaults off → no provider reads", async () => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: false, announcementsTpexEnabled: false });
  const fetchImpl = vi.fn();
  expect((await runOfficialDisclosureAcquisition(new MemoryPersistence(), { fetchImpl })).outcomes).toEqual([]);
  expect(fetchImpl).not.toHaveBeenCalled();
});
it("minute publication: colon clock → preserved minute precision", () => {
  const { rows, identity } = fixture("TWSE"); rows[0].發言時間 = "09:30";
  const record = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: "b".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE, acquisitionRunId: "minute" }, "TWSE", [identity])[0]!;
  expect(record.publishedAt).toBe("2026-10-03T01:30:00.000Z"); expect(record.publicationPrecision).toBe("minute");
  const artifact = retainAnnouncementExplanation(record);
  expect(artifact.provenance.contentHash).toBe(artifact.contentHash); expect(artifact.parentProvenance?.contentHash).toBe("b".repeat(64));
});

it("attachment retry: official detail reference with restricted first fetch → later immutable retained content", async () => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const {rows, identity} = fixture("TWSE"); await persistence.appendResearchIdentityRecords([identity]);
  const siblingIdentity = canonicalizeOfficialIdentityRow({ venue: "TWSE", snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z", artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE, contentHash: "sibling-identity" }, row: { kind: "company", ticker: "9998", legalName: "公司", displayName: "公司", unifiedBusinessNumber: "11111111", industryCode: "24", listedAt: "2001-01-01" } });
  expect(siblingIdentity.issuer.id).toBe(identity.issuer.id);
  await persistence.appendResearchIdentityRecords([siblingIdentity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  // Mutation follows the official renderer's {url,fileName} attachment cell.
  detail.result.titles.push({ main: "附件", sub: [] });
  detail.result.data[0].push({ url: "https://mops.twse.com.tw/retained-example.txt", fileName: "original.txt" });
  let restricted = true;
  let detailRestricted = false;
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const source = String(url);
    if (detailRestricted && source.endsWith("t05st01")) return new Response("denied", { status: 403 });
    if (source.endsWith("retained-example.txt")) return restricted ? new Response("denied", { status: 403 }) : new Response("retained evidence", { headers: { "content-type": "text/plain" } });
    const payload = source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows;
    return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "job1" });
  const query = { issuerId: identity.issuer.id, effectiveAt: "2026-10-04T06:00:00.000Z", knowledgeAt: "2026-10-04T06:00:00.000Z" };
  const records = await persistence.listResearchAnnouncements(query); expect(records).toHaveLength(1); expect(records[0]?.detailQuality?.status).toBe("available");
  expect((await persistence.listResearchDisclosureScans(query)).find((scan) => scan.listingId === identity.listing.id)?.artifactAttempts?.[0]?.status).toBe("restricted");
  expect(await persistence.listResearchDisclosureArtifacts(query)).toHaveLength(1);
  restricted = false;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:15:00.000Z", acquisitionRunId: "job1" });
  expect(await persistence.listResearchAnnouncements(query)).toHaveLength(1);
  const artifacts = await persistence.listResearchDisclosureArtifacts(query); expect(artifacts).toHaveLength(2);
  const attachment = artifacts.find((artifact) => artifact.sourceUrl.endsWith("retained-example.txt"))!;
  expect(attachment.blocks[0]?.text).toBe("retained evidence");
  expect(attachment.provenance.contentHash).toBe(attachment.contentHash); expect(attachment.provenance.sourceUrl).toBe(attachment.sourceUrl);
  expect(attachment.parentProvenance?.accessProvider).toBe("MOPS_API");
  const allScans = await persistence.listResearchDisclosureScans(query);
  const siblingScans = allScans.filter((scan) => scan.listingId === siblingIdentity.listing.id);
  expect(siblingScans).toHaveLength(2);
  expect(siblingScans.every((scan) => scan.detailAttempts?.length === 0 && scan.artifactAttempts?.length === 0)).toBe(true);
  const scans = allScans.filter((scan) => scan.listingId === identity.listing.id);
  expect(scans).toHaveLength(2); expect(new Set(scans.map((scan) => scan.provenance.id)).size).toBe(2);
  detailRestricted = true;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:30:00.000Z", acquisitionRunId: "job1" });
  const afterFailure = await persistence.listResearchAnnouncements(query);
  expect(afterFailure).toEqual(records);
  expect(await persistence.listResearchDisclosureArtifacts(query)).toEqual(artifacts);
  const finalScans = (await persistence.listResearchDisclosureScans(query)).filter((scan) => scan.listingId === identity.listing.id);
  expect(finalScans).toHaveLength(3); expect(new Set(finalScans.map((scan) => scan.provenance.id)).size).toBe(3);
  expect(finalScans.at(-1)?.detailAttempts?.[0]).toMatchObject({ status: "restricted", reasonCodes: ["detail_access_restricted"] });
});

it.each(["TWSE", "TPEX"] as const)("%s inactive listing: scheduled scan and manifest → no fresh coverage or available dataset", async (venue) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  const persistence = new MemoryPersistence(); const { identity } = fixture(venue);
  await persistence.appendResearchIdentityRecords([identity]);
  const fetchImpl = vi.fn(async () => new Response("[]", { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "before-inactive" });
  const inactive = appendOfficialListingStatusRevision(identity, { status: "inactive", effectiveDate: "2026-10-04", retrievedAt: "2026-10-04T05:05:00.000Z", artifact: { contentHash: "inactive-event", sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], publisherDataset: "official_listing_status" } });
  await persistence.appendResearchIdentityRecords([inactive]);
  expect(parseOfficialAnnouncementSnapshot(fixture(venue).rows, { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "inactive-provider" }, venue, [inactive])).toEqual([]);
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:15:00.000Z", acquisitionRunId: "after-inactive" });
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const context = { knowledgeAt: "2026-10-04T05:16:00.000Z" };
  const scans = await persistence.listResearchDisclosureScans({ issuerId: identity.issuer.id, effectiveAt: context.knowledgeAt, knowledgeAt: context.knowledgeAt });
  expect(scans).toHaveLength(1); expect(scans[0]?.checkedAt).toBe(at);
  const manifest = await getResearchManifest(persistence, researchQuerySchema.parse({ subject, context }));
  expect(manifest.datasets.find((dataset) => dataset.id === "material_announcements")).toMatchObject({ status: "unavailable", reasonCode: "not_applicable_subject" });
  expect((await listMaterialAnnouncements(persistence, { subject, context })).scan.status).toBe("not_applicable");
});

it.each([["TWSE", "2026-10-02"], ["TWSE", "2026-10-03"], ["TPEX", "2026-10-02"], ["TPEX", "2026-10-03"]] as const)("%s mixed feed: known inactive row ending %s → skipped without poisoning eligible issuer scan", async (venue, inactiveOn) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  const persistence = new MemoryPersistence(); const { identity, rows } = fixture(venue);
  const otherIdentity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-02", retrievedAt: "2026-10-02T00:00:00.000Z", artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], contentHash: "inactive-identity" }, row: { kind: "company", ticker: "9999", legalName: "已下市公司", displayName: "已下市公司", unifiedBusinessNumber: "99999999", industryCode: "24", listedAt: "2000-01-01" } });
  const inactive = appendOfficialListingStatusRevision(otherIdentity, { status: "inactive", effectiveDate: inactiveOn, retrievedAt: "2026-10-02T01:00:00.000Z", artifact: { contentHash: "inactive-status", sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], publisherDataset: "official_listing_status" } });
  await persistence.appendResearchIdentityRecords([identity, otherIdentity, inactive]);
  const mixedRows = [rows[0], { ...rows[0], 公司代號: "9999", SecuritiesCompanyCode: "9999" }];
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(mixedRows), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "mixed-feed" });
  expect(result.outcomes).toEqual([{ venue, status: "success", announcementCount: 1 }]);
  const query = { issuerId: identity.issuer.id, effectiveAt: at, knowledgeAt: at };
  expect(await persistence.listResearchDisclosureScans(query)).toHaveLength(1);
  expect(await persistence.listResearchAnnouncements(query)).toHaveLength(1);
  expect(await persistence.listResearchDisclosureScans({ ...query, issuerId: inactive.issuer.id })).toEqual([]);
  expect(await persistence.listResearchAnnouncements({ ...query, issuerId: inactive.issuer.id })).toEqual([]);
});

it("identity resolution: unknown or overlapping eligible listings → source rejection remains explicit", () => {
  const { rows, identity } = fixture("TWSE");
  const metadata = { retrievedAt: at, contentHash: "c".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE, acquisitionRunId: "ambiguous" };
  expect(() => parseOfficialAnnouncementSnapshot(rows, metadata, "TWSE", [])).toThrow("announcement_identity_unresolved");
  expect(() => parseOfficialAnnouncementSnapshot(rows, metadata, "TWSE", [identity, { ...identity, listing: { ...identity.listing, id: "overlapping_listing" } }])).toThrow("announcement_identity_unresolved");
});

it.each(["TWSE", "TPEX"] as const)("%s issuer-wide history: identical title/time on another listing → supersession stays listing-bound", async (venue) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  const persistence = new MemoryPersistence(); const { identity, rows } = fixture(venue);
  await persistence.appendResearchIdentityRecords([identity]);
  const source = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: "d".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "prior" }, venue, [identity])[0]!;
  const foreign = { ...source, id: "foreign_observation", listingId: "another_listing", venue: venue === "TWSE" ? "TPEX" as const : "TWSE" as const };
  const local = { ...source, id: "local_observation" };
  await persistence.appendResearchAnnouncements([foreign, local]);
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
  const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "lineage" });
  expect(result.outcomes).toEqual([{ venue, status: "success", announcementCount: 1 }]);
  const retained = await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, effectiveAt: at, knowledgeAt: at });
  const acquired = retained.find((record) => record.id !== foreign.id && record.id !== local.id)!;
  expect(acquired.relations).toEqual([{ kind: "supersedes", targetAnnouncementId: local.id }]);
  expect(retained.find((record) => record.id === foreign.id)).toEqual(foreign);
});

it("detail retry: accepted whitespace-normalized title → same collection supersedes failed observation", async () => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.data[0][6] = String(detail.result.data[0][6]).replace(/\s+/g, " ");
  let restricted = true;
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const source = String(url);
    if (restricted && source.endsWith("t05st01")) return new Response("denied", { status: 403 });
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  }) as unknown as typeof fetch;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "detail_retry_1" });
  restricted = false;
  const later = "2026-10-04T05:15:00.000Z";
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: later, acquisitionRunId: "detail_retry_2" });
  const records = await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, knowledgeAt: later, effectiveAt: later });
  expect(records).toHaveLength(2);
  const success = records.find((record) => record.detailQuality?.status === "available")!;
  const failed = records.find((record) => record.detailQuality?.status === "restricted")!;
  expect(success.subject).not.toBe(failed.subject);
  expect(success.collectionRecordId).toBe(failed.collectionRecordId);
  expect(success.relations).toContainEqual({ kind: "supersedes", targetAnnouncementId: failed.id });
  const selected = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: later } });
  expect(selected.items.map((record) => record.id)).toEqual([success.id]);
  expect(selected.selection.conflictObservationIds).toEqual([]);
  const retryAt = "2026-10-04T05:20:00.000Z";
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: retryAt, acquisitionRunId: "detail_retry_3" });
  expect(await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, knowledgeAt: retryAt, effectiveAt: retryAt })).toEqual(records);
});

it.each([
  ["text/html", "<html><head><title>FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.</title></head><body>Please try again.</body></html>", "restricted"],
  ["text/html", "<html><head><title>Security policy update</title></head><body>因安全性考量，公司將更新存取權限。</body></html>", "retained"],
  ["application/octet-stream", "<html><body>FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.</body></html>", "restricted"],
  ["text/html", "<html><body>FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED.</body></html>", "restricted"],
  ["text/html", "<html><body>因為安全性考量，您所執行的頁面無法呈現。</body></html>", "restricted"],
  ["application/pdf", "<html><body>安全性考量，無法存取本網頁。</body></html>", "restricted"],
  ["application/pdf", Buffer.from(twoPagePdf()), "retained"],
  ["text/html", "<html><body>因安全性考量，公司將更新存取權限。</body></html>", "retained"],
  ["text/plain", "For security reasons, this page can not be accessed.", "restricted"],
  ["text/html", "<html><body><h1>重大訊息</h1><p>董事會決議通過。</p></body></html>", "retained"],
] as const)("HTTP200 attachment case %# (%s): content classification", async (mediaType, body, expected) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.titles.push({ main: "附件", sub: [] });
  detail.result.data[0].push({ url: "https://mops.twse.com.tw/attachment.pdf", fileName: "attachment.pdf" });
  let recovered = false;
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const source = String(url);
    if (source.endsWith("attachment.pdf")) return new Response(recovered ? "<html><body>Recovered issuer evidence</body></html>" : body, { headers: { "content-type": recovered ? "text/html" : mediaType } });
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  }) as unknown as typeof fetch;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "body_classification" });
  const query = { issuerId: identity.issuer.id, knowledgeAt: at, effectiveAt: at };
  const scans = await persistence.listResearchDisclosureScans(query);
  expect(scans[0]?.artifactAttempts?.[0]?.status).toBe(expected);
  const artifacts = await persistence.listResearchDisclosureArtifacts(query);
  expect(artifacts).toHaveLength(expected === "retained" ? 2 : 1);
  if (expected === "restricted") {
    expect(artifacts.every((artifact) => !artifact.blocks.some((block) => /SECURITY REASONS|安全性考量/.test(block.text)))).toBe(true);
    recovered = true;
    const later = "2026-10-04T05:15:00.000Z";
    await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: later, acquisitionRunId: "body_recovery" });
    const afterRetry = await persistence.listResearchDisclosureArtifacts({ ...query, knowledgeAt: later, effectiveAt: later });
    expect(afterRetry).toHaveLength(2);
    expect(afterRetry.find((artifact) => artifact.sourceUrl.endsWith("attachment.pdf"))?.blocks[0]?.text).toBe("Recovered issuer evidence");
  }
});

it.each(["declared", "streamed", "physical_page"] as const)("oversized %s attachment: body limit → processing failure and operator recovery", async (mode) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.titles.push({ main: "附件", sub: [] });
  detail.result.data[0].push({ url: "https://mops.twse.com.tw/oversized.pdf", fileName: "oversized.pdf" });
  const cancel = vi.fn();
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const source = String(url);
    if (source.endsWith("oversized.pdf")) return mode === "physical_page" ? new Response(Buffer.from(twoPagePdf([`BT /F1 0.001 Tf 40 700 Td (${"a".repeat(50_001)}) Tj ET`, "q Q"])), { headers: { "content-type": "application/pdf" } }) : mode === "declared" ? new Response("", { headers: { "content-length": String(8 * 1024 * 1024 + 1) } }) : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(8 * 1024 * 1024 + 1)); }, cancel }));
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  }) as unknown as typeof fetch;
  const reads = vi.spyOn(persistence, "listResearchDisclosureArtifacts");
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "oversized" });
  expect(reads.mock.calls.every(([query]) => typeof query.artifactId === "string")).toBe(true);
  const query = { issuerId: identity.issuer.id, knowledgeAt: at, effectiveAt: at };
  const attempts = (await persistence.listResearchDisclosureScans(query))[0]!.artifactAttempts!;
  const reasonCode = mode === "physical_page" ? "disclosure_extraction_physical_page_limit" : "disclosure_source_too_large";
  expect(attempts[0]).toMatchObject({ status: "processing_failed", reasonCode });
  expect(await persistence.listResearchDisclosureArtifacts(query)).toHaveLength(1);
  const result = await getDisclosureArtifact(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: at }, artifactId: attempts[0]!.artifactId });
  expect(result.artifact).toBeNull();
  expect(result.quality.status).toBe("processing_failed");
  expect(result.quality.reasonCodes).toContain(reasonCode);
  expect(result.quality.recovery[0]).toContain("Operator action required");
  if (mode === "streamed") expect(cancel).toHaveBeenCalledOnce();
  const explanation = (await persistence.listResearchDisclosureArtifacts(query))[0]!;
  const retained = { ...explanation, id: attempts[0]!.artifactId, sourceUrl: attempts[0]!.sourceUrl };
  await persistence.appendResearchDisclosureArtifacts([retained]);
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:15:00.000Z", acquisitionRunId: "retained_retry" });
  expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("oversized.pdf"))).toHaveLength(1);
  const preserved = await getDisclosureArtifact(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: "2026-10-04T05:15:00.000Z" }, artifactId: retained.id });
  expect(preserved.quality.status).toBe("available");
  expect(preserved.quality.reasonCodes).toEqual([]);
});

it.each(["collection", "detail", "attachment"] as const)("lease abort during %s request → stop acquisition without a completed scan", async (stage) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const controller = new AbortController();
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.titles.push({ main: "附件", sub: [] }); detail.result.data[0].push({ url: "https://mops.twse.com.tw/lease.txt", fileName: "lease.txt" });
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const source = String(url);
    const abortHere = stage === "collection" ? source.includes("t187ap04") : stage === "detail" ? source.endsWith("t05st01") : source.endsWith("lease.txt");
    if (abortHere) { controller.abort(new Error("lease_expired")); expect(init?.signal?.aborted).toBe(true); throw controller.signal.reason; }
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  }) as unknown as typeof fetch;
  await expect(runOfficialDisclosureAcquisition(persistence, { fetchImpl, signal: controller.signal, retrievedAt: at })).rejects.toThrow("lease_expired");
  expect(await persistence.listResearchDisclosureScans({ issuerId: identity.issuer.id, knowledgeAt: at, effectiveAt: at })).toEqual([]);
});

it.each([
  ["download.bin", Buffer.from(twoPagePdf()), "application/pdf"],
  ["download-no-header.bin", Buffer.from(twoPagePdf()), "application/pdf"],
  ["fake.pdf", Buffer.from("not a PDF"), null],
  ["official.txt", Buffer.from("官方說明\nconfirmed text"), "text/plain"],
  ["official.html", Buffer.from("<html><body>Official statement</body></html>"), "text/html"],
  ["official.xhtml", Buffer.from('<?xml version="1.0" encoding="UTF-8"?><html xmlns="http://www.w3.org/1999/xhtml"><body>Official statement</body></html>'), "application/xhtml+xml"],
  ["unknown.bin", Buffer.from("untyped bytes"), null],
  ["binary.txt", Buffer.from([0, 1, 2, 3]), null],
] as const)("generic MIME: official attachment %s → evidence-specific extraction or explicit failure", async (fileName, bytes, expectedType) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.titles.push({ main: "附件", sub: [] }); detail.result.data[0].push({ url: "https://mops.twse.com.tw/download", fileName });
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const source = String(url);
    if (source.endsWith("/download")) return new Response(bytes, { headers: fileName.includes("no-header") ? {} : { "content-type": "application/octet-stream" } });
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  }) as unknown as typeof fetch;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at });
  const query = { issuerId: identity.issuer.id, knowledgeAt: at, effectiveAt: at };
  const attempt = (await persistence.listResearchDisclosureScans(query))[0]!.artifactAttempts![0]!;
  expect(attempt.status).toBe(expectedType ? "retained" : "processing_failed");
  const artifacts = await persistence.listResearchDisclosureArtifacts(query);
  expect(artifacts).toHaveLength(expectedType ? 2 : 1);
  if (expectedType) {
    const artifact = artifacts.find((item) => item.id === attempt.artifactId)!;
    expect(artifact.mediaType).toBe(expectedType);
    expect(artifact.sourceMediaType).toBe("application/octet-stream");
    expect(artifact.retainedBytesBase64).toBe(bytes.toString("base64"));
    expect(artifact.blocks.length).toBeGreaterThan(0);
    expect(artifact.verifiedClaims).toEqual([]);
  }
});

it.each([31, 121])("delayed enrichment %i minutes: snapshot freshness → observation clock with completion knowledge", async (minutes) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  const completed = new Date(Date.parse(at) + minutes * 60_000).toISOString();
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  try {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const source = String(url);
      if (source.endsWith("t05st01_detail")) { vi.setSystemTime(new Date(completed)); return new Response(JSON.stringify(detail)); }
      return new Response(JSON.stringify(source.endsWith("t05st01") ? history : rows));
    }) as unknown as typeof fetch;
    await runOfficialDisclosureAcquisition(persistence, { fetchImpl, acquisitionRunId: "delayed" });
    const query = { issuerId: identity.issuer.id, effectiveAt: completed, knowledgeAt: completed };
    const scan = (await persistence.listResearchDisclosureScans(query))[0]!;
    expect(scan).toMatchObject({ checkedAt: at, publicationEnd: at, knowledgeAt: completed, provenance: { retrievedAt: at, processedAt: completed } });
    const result = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: completed } });
    expect(result.scan.status).toBe(minutes > 120 ? "stale" : "indeterminate");
    expect(result.quality.readiness.currentAssessment).toBe("blocked");
    expect(result.items).toHaveLength(1);
    const before = { issuerId: identity.issuer.id, effectiveAt: at, knowledgeAt: at };
    expect(await persistence.listResearchDisclosureScans(before)).toEqual([]);
    expect(await persistence.listResearchAnnouncements(before)).toEqual([]);
    expect(await persistence.listResearchDisclosureArtifacts(before)).toEqual([]);
  } finally { vi.useRealTimers(); }
});

it("delayed failed refresh: no response snapshot → failure completion timestamp preserves cached success", async () => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl: vi.fn(async () => new Response("[]")) as unknown as typeof fetch, retrievedAt: at, acquisitionRunId: "prior" });
  const failedAt = "2026-10-04T05:05:00.000Z";
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  try {
    await runOfficialDisclosureAcquisition(persistence, { acquisitionRunId: "failure", fetchImpl: vi.fn(async () => { vi.setSystemTime(new Date(failedAt)); return new Response("unavailable", { status: 503 }); }) as unknown as typeof fetch });
    const result = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: failedAt } });
    expect(result.scan).toMatchObject({ status: "current", checkedAt: at, latestAttempt: { checkedAt: failedAt, knowledgeAt: failedAt, status: "failed", provenance: { contentHash: null, processedAt: failedAt } } });
  } finally { vi.useRealTimers(); }
});
