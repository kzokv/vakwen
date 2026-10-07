import { disclosureContinuationScenario } from "../fixtures/research/disclosureContinuationScenario.js";
import * as announcementDetails from "../../src/services/research/providers/mopsAnnouncementDetails.js";
import { disclosureAttachmentRevisionScenario } from "../fixtures/research/disclosureAttachmentRevisionScenario.js";
import { disclosureReversionScenario } from "../fixtures/research/disclosureRevisionScenario.js";
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
  const recoveredRecords = await persistence.listResearchAnnouncements(query); expect(recoveredRecords).toHaveLength(2);
  const artifacts = await persistence.listResearchDisclosureArtifacts(query); expect(artifacts).toHaveLength(3);
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
  expect(afterFailure).toEqual(recoveredRecords);
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

it.each(["TWSE", "TPEX"] as const)("%s identity resolution: absent catalog listing → skipped while overlapping or ineffective known listings fail closed", (venue) => {
  const { rows, identity } = fixture(venue);
  const metadata = { retrievedAt: at, contentHash: "c".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "ambiguous" };
  expect(parseOfficialAnnouncementSnapshot(rows, metadata, venue, [])).toEqual([]);
  expect(() => parseOfficialAnnouncementSnapshot(rows, metadata, venue, [{ ...identity, listing: { ...identity.listing, listedAt: "2026-10-04" } }])).toThrow("announcement_identity_unresolved");
  expect(() => parseOfficialAnnouncementSnapshot(rows, metadata, venue, [identity, { ...identity, listing: { ...identity.listing, id: "overlapping_listing" } }])).toThrow("announcement_identity_unresolved");
});

it.each(["TWSE", "TPEX"] as const)("%s issuer-wide history: identical title/time on another listing → supersession stays listing-bound", async (venue) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  const persistence = new MemoryPersistence(); const { identity, rows } = fixture(venue);
  await persistence.appendResearchIdentityRecords([identity]);
  const source = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: "d".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "prior" }, venue, [identity])[0]!;
  const foreign = { ...source, collectionRecordId: source.id, id: "foreign_observation", listingId: "another_listing", venue: venue === "TWSE" ? "TPEX" as const : "TWSE" as const };
  const local = { ...source, collectionRecordId: source.id, id: "local_observation" };
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
    expect(afterRetry).toHaveLength(3);
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
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:15:00.000Z", acquisitionRunId: "retained_retry" });
  expect(vi.mocked(fetchImpl).mock.calls.filter(([url]) => String(url).endsWith("oversized.pdf"))).toHaveLength(2);
  expect(await persistence.listResearchDisclosureArtifacts(query)).toHaveLength(1);
  const retried = await getDisclosureArtifact(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: "2026-10-04T05:15:00.000Z" }, artifactId: attempts[0]!.artifactId });
  expect(retried.quality.status).toBe("processing_failed");
  expect(retried.quality.reasonCodes).toContain(reasonCode);
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

it.each(["TWSE", "TPEX"] as const)("%s optional event dates: mixed missing/invalid dates → all records retained and current scan", async (venue) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  const { rows, identity } = fixture(venue);
  const values = [rows[0].事實發生日, "", "不適用", "1150230", "2026/10/03", undefined, null];
  const mixed = values.map((value, index) => ({ ...rows[0], 主旨: `事件日期案例${index}`, 事實發生日: value, 說明: `事件日期案例${index}` }));
  const parsed = parseOfficialAnnouncementSnapshot(mixed, { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "event_dates" }, venue, [identity]);
  expect(parsed).toHaveLength(values.length);
  expect(parsed[0]?.eventDate).not.toBeNull();
  expect(parsed.slice(1).every((record) => record.eventDate === null)).toBe(true);
  expect(parsed.map((record) => record.rawEventDate)).toEqual(values.map((value) => value ?? undefined));
  expect(() => parseOfficialAnnouncementSnapshot([{ ...mixed[0], 發言日期: "" }], { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "invalid_publication" }, venue, [identity])).toThrow();
  const persistence = new MemoryPersistence(); await persistence.appendResearchIdentityRecords([identity]);
  const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url) === OFFICIAL_ANNOUNCEMENT_SOURCES[venue] ? new Response(JSON.stringify(mixed)) : new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
  const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "mixed_event_dates" });
  expect(result.outcomes).toEqual([{ venue, status: "success", announcementCount: values.length }]);
  const input = { subject: { kind: "listing_id" as const, listingId: identity.listing.id }, context: { knowledgeAt: at } };
  const page = await listMaterialAnnouncements(persistence, input);
  expect(page.scan.status).toBe("current"); expect(page.items).toHaveLength(values.length);
  const filtered = await listMaterialAnnouncements(persistence, { ...input, range: { publishedFrom: "2026-10-01T00:00:00.000Z", publishedTo: at, eventFrom: "2000-01-01", eventTo: "2026-10-04" } });
  expect(filtered.items).toHaveLength(1); expect(filtered.items[0]?.eventDate).not.toBeNull();
});


it.each((["TWSE", "TPEX"] as const).flatMap((venue) => [false, true].map((malformedUnknown) => ({ venue, malformedUnknown }))))(
  "$venue board with malformed unknown=$malformedUnknown: retain known rows → current nonexhaustive listing scan", async ({ venue, malformedUnknown }) => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
    const { identity, rows } = fixture(venue);
    const unknown = malformedUnknown ? { 公司代號: " 999X ", SecuritiesCompanyCode: " 999X ", 發言日期: "invalid", 說明: 42 }
      : { ...rows[0], 公司代號: " 999X ", SecuritiesCompanyCode: " 999X " };
    const mixed = [unknown, ...rows.map((row: Record<string, unknown>) => ({ ...row, 公司代號: ` ${identity.listing.ticker} ` })), unknown];
    const metadata = { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "mixed_identity" };
    const parsed = parseOfficialAnnouncementSnapshot(mixed, metadata, venue, [identity]);
    expect(parsed).toHaveLength(1); expect(parsed[0]!.ticker).toBe(identity.listing.ticker);
    expect(parsed[0]!.provenance.parserVersion).toBe("mops-announcements/1.0.4");
    const persistence = new MemoryPersistence(); await persistence.appendResearchIdentityRecords([identity]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url) === OFFICIAL_ANNOUNCEMENT_SOURCES[venue]
      ? new Response(JSON.stringify(mixed)) : new Response("restricted", { status: 403 })) as unknown as typeof fetch;
    expect((await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "mixed_identity" })).outcomes)
      .toEqual([{ venue, status: "success", announcementCount: 1 }]);
    const page = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: at } });
    expect(page.items).toHaveLength(1); expect(page.items[0]!.ticker).toBe(identity.listing.ticker);
    expect(page.scan.status).toBe("current"); expect(page.scan.record!.exhaustive).toBe(false);
    for (const ticker of [undefined, null, "", "  ", 9999, "???", "99-99", "99/9"]) expect(() => parseOfficialAnnouncementSnapshot([{ 公司代號: ticker }], metadata, venue, [identity])).toThrow();
    expect(() => parseOfficialAnnouncementSnapshot([null], metadata, venue, [identity])).toThrow();
    expect(() => parseOfficialAnnouncementSnapshot([{ 公司代號: identity.listing.ticker, 發言日期: "invalid" }], metadata, venue, [identity])).toThrow();
  });


it.each(["TWSE", "TPEX"] as const)("%s detail A→B→A→A: reversion gets new immutable observation → replay and failed refresh retain active A", async (venue) => {
  const result = await disclosureReversionScenario(new MemoryPersistence(), venue);
  expect(result.counts).toEqual([1, 1, 1, 0, 0]);
  expect(result.records.map((records) => records.length)).toEqual([1, 2, 3, 3, 3]);
  const a = result.pages[0]!.items[0]!, b = result.pages[1]!.items[0]!, reverted = result.pages[2]!.items[0]!;
  expect(new Set([a.id, b.id, reverted.id]).size).toBe(3);
  expect(new Set([a.provenance.id, b.provenance.id, reverted.provenance.id]).size).toBe(3);
  expect(new Set(result.records[4]!.map((record) => record.collectionProvenance!.id)).size).toBe(3);
  expect(result.auditReport.announcementPages).toHaveLength(3);
  expect(result.auditReport.evidence.provenanceIds).toEqual(expect.arrayContaining([a.provenance.id, b.provenance.id, reverted.provenance.id]));
  expect(b.relations).toEqual([{ kind: "supersedes", targetAnnouncementId: a.id }]);
  expect(reverted.relations).toEqual([{ kind: "supersedes", targetAnnouncementId: b.id }]);
  expect(result.pages.slice(2).map((page) => page.items.map((item) => item.id))).toEqual([[reverted.id], [reverted.id], [reverted.id]]);
  expect(reverted.explanation.text).toBe(a.explanation.text);
  expect(result.records[4]!.find((record) => record.id === a.id)).toEqual(result.records[0]![0]);
  expect(result.historical.items.map((item) => item.id)).toEqual([b.id]);
  expect(result.artifacts.filter((artifact) => artifact.reference.id === reverted.id).map((artifact) => artifact.blocks.map((block) => block.text).join(""))).toContain(result.original);
  expect(result.pages[4]!.scan.latestAttempt!.detailAttempts![0]).toMatchObject({ announcementId: reverted.id, status: "restricted" });
});

it.each(["reconcile", "restricted", "over_limit", "cycle"] as const)("revision tips %s: deterministic graph boundary → reconcile success or fail closed", async (state) => {
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const ids = state === "over_limit" ? Array.from({ length: 101 }, (_, index) => `tip_${index}`) : ["tip_z", "tip_a"];
  const results = [];
  for (const order of [ids, [...ids].reverse()]) {
    const { rows, identity } = fixture("TWSE");
    const persistence = new MemoryPersistence(); await persistence.appendResearchIdentityRecords([identity]);
    const source = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE, acquisitionRunId: "tips" }, "TWSE", [identity])[0]!;
    const prior = order.map((id) => ({ ...source, id, collectionRecordId: source.id, explanation: `Prior detail ${id}`,
      detailQuality: { status: "available" as const, reasonCodes: [] }, provenance: { ...source.provenance, id: `pr_${id}` },
      relations: state === "cycle" ? [{ kind: "supersedes" as const, targetAnnouncementId: ids.find((other) => other !== id)! }] : [] }));
    await persistence.appendResearchAnnouncements(prior);
    const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
    const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
    const fetchImpl: typeof fetch = async (url) => state === "restricted" && String(url).endsWith("t05st01") ? new Response("restricted", { status: 403 })
      : new Response(JSON.stringify(String(url).endsWith("t05st01_detail") ? detail : String(url).endsWith("t05st01") ? history : rows));
    const payloadReads = vi.spyOn(persistence, "getResearchAnnouncementsByIds");
    const cacheRead = vi.spyOn(persistence, "getLatestSuccessfulDisclosureDetail");
    const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: "2026-10-04T05:15:00.000Z", acquisitionRunId: "tips_next" });
    expect(cacheRead).not.toHaveBeenCalled();
    const retained = await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, knowledgeAt: "2026-10-04T05:15:00.000Z", effectiveAt: "2026-10-04T05:15:00.000Z" });
    if (state === "reconcile") {
      expect(result.outcomes).toEqual([{ venue: "TWSE", status: "success", announcementCount: 1 }]);
      const next = retained.find((record) => !ids.includes(record.id))!;
      expect(next.relations).toEqual([...ids].sort().map((id) => ({ kind: "supersedes", targetAnnouncementId: id })));
      expect(payloadReads.mock.calls.every(([query]) => query.ids.length <= 100)).toBe(true);
      results.push(next);
    } else {
      expect(result.outcomes).toEqual([{ venue: "TWSE", status: "failed", announcementCount: 0 }]);
      expect(retained.map((record) => record.id).sort()).toEqual([...ids].sort());
      expect(payloadReads).not.toHaveBeenCalled();
    }
  }
  if (state === "reconcile") expect(results[1]).toEqual(results[0]);
});

it.each([
  ["text/html; charset=big5", "adaba46ab054aea7", "retained"],
  ["application/octet-stream; charset=big5", "adaba46ab054aea7", "retained"],
  ["text/html; charset=unknown-encoding", "adaba46ab054aea7", "processing_failed"],
  ["text/html; charset=big5", "a4", "processing_failed"],
  ["text/html; charset=big5", "a65dacb0a677a5fea9caa6d2b671a141b17aa9d2b0f5a6e6aabaadb6adb1b54caa6ba765b27ba143", "restricted"],
] as const)("declared attachment encoding %s: strict acquisition → %s %s", async (mediaType, hex, expected) => {
  const bytes = Buffer.concat([Buffer.from("<html><body>"), Buffer.from(hex, "hex"), Buffer.from("</body></html>")]);
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture("TWSE");
  await persistence.appendResearchIdentityRecords([identity]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.titles.push({ main: "附件", sub: [] }); detail.result.data[0].push({ url: "https://mops.twse.com.tw/download", fileName: "official.html" });
  const fetchImpl = vi.fn(async (url: string | URL | Request) => {
    const source = String(url);
    if (source.endsWith("/download")) return new Response(bytes, { headers: { "content-type": mediaType } });
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  }) as unknown as typeof fetch;
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at });
  const query = { issuerId: identity.issuer.id, knowledgeAt: at, effectiveAt: at };
  const attempt = (await persistence.listResearchDisclosureScans(query))[0]!.artifactAttempts![0]!;
  expect(attempt.status).toBe(expected);
  const artifacts = await persistence.listResearchDisclosureArtifacts(query);
  expect(artifacts).toHaveLength(expected === "retained" ? 2 : 1);
  if (expected === "retained") {
    const artifact = artifacts.find((item) => item.id === attempt.artifactId)!;
    expect(artifact.mediaType).toBe("text/html");
    expect(artifact.sourceMediaType).toBe(mediaType);
    expect(artifact.retainedBytesBase64).toBe(bytes.toString("base64"));
    expect(artifact.blocks[0]?.text).toBe("重大訊息");
    expect(artifact.verifiedClaims).toEqual([]);
    const read = await getDisclosureArtifact(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: at }, artifactId: artifact.id });
    expect(read.artifact?.blocks[0]?.text).toBe("重大訊息");
  }
});

  it.each(["TWSE", "TPEX"] as const)("%s same URL attachment A→B→B→failure→failure→A: immutable revisions and replay", async (venue) => {
    for (const persistence of [new MemoryPersistence()]) {
      const result = await disclosureAttachmentRevisionScenario(persistence, venue);
      expect(result.requests).toBe(7);
      expect(result.agedPage.scan.status).toBe("current");
      expect(result.agedPage.quality.readiness.currentAssessment).toBe("degraded");
      expect(result.agedRead.artifact).toEqual(result.reads[6]!.artifact);
      expect(result.reads[6]!.quality.readiness.currentAssessment).toBe("ready");
      expect(result.agedRead.quality.readiness.currentAssessment).toBe("blocked");
      expect(result.agedRead.quality.reasonCodes).toContain("artifact_current_revalidation_missing");
      expect(result.failureReport.assessments.map((assessment) => assessment.support)).toEqual(["provisional", "withheld", "withheld"]);
      expect(result.failureReport.assessments[0]!.sourceSupport).toBe("supported");
      expect(result.failureReport.assessments[1]!.reasonCodes).toContain("artifact_not_returned");
      expect(result.failureReport.assessments[2]!.reasonCodes).toContain("artifact_parent_not_returned");
      expect(result.counts).toEqual([1, 1, 0, 1, 0, 1, 0]);
      expect(result.records).toHaveLength(4);
      expect(result.artifacts).toHaveLength(7);
      expect(result.reads.map((read) => read.artifact?.blocks[0]?.text ?? null)).toEqual(["A", "B", "B", null, null, "A", "A"]);
      expect(result.reads[0]!.artifact!.id).not.toBe(result.reads[5]!.artifact!.id);
      expect(result.reads[0]!.artifact!.contentHash).toBe(result.reads[5]!.artifact!.contentHash);
      expect(result.reads[2]).toMatchObject({ artifact: result.reads[1]!.artifact });
      expect(result.reads[6]).toMatchObject({ artifact: result.reads[5]!.artifact });
      expect(result.oldRead.artifact).toEqual(result.reads[0]!.artifact);
      expect(result.historical.items[0]!.id).toBe(result.pages[1]!.items[0]!.id);
      for (const step of [3, 4]) {
        expect(result.pages[step]!.scan.status).toBe("current");
        expect(result.pages[step]!.quality.readiness.currentAssessment).toBe("degraded");
        expect(result.pages[step]!.quality.reasonCodes).toContain("attachment_refresh_failed");
        expect(result.pages[step]!.items[0]!.quality).toBe("available");
        expect(result.pages[step]!.items[0]!.explanation.text).toBe(result.pages[0]!.items[0]!.explanation.text);
        expect(result.reads[step]!.quality.status).toBe("restricted");
        expect(result.reads[step]!.artifact).toBeNull();
      }
      for (const step of [1, 3, 5]) {
        expect(result.pages[step]!.items[0]!.relations).toEqual([{ kind: "supersedes", targetAnnouncementId: result.pages[step - 1]!.items[0]!.id }]);
      }
      expect(result.pages[6]!.quality.readiness.currentAssessment).toBe("ready");
    }
  });

it("duplicate attachment locator: one response per scan → consistent content identities", async () => {
  const original = announcementDetails.enrichOfficialAnnouncement;
  const spy = vi.spyOn(announcementDetails, "enrichOfficialAnnouncement").mockImplementation(async (...args) => {
    const result = await original(...args);
    const attachment = result.record.attachments.find((entry) => entry.sourceUrl.endsWith("unchanged.txt"));
    if (attachment) result.record.attachments.push({ ...attachment, id: "duplicate_locator" });
    return result;
  });
  try {
    const result = await disclosureAttachmentRevisionScenario(new MemoryPersistence(), "TWSE");
    expect(result.requests).toBe(7);
    for (const page of result.pages) {
      const attachments = page.items[0]!.attachments.filter((entry) => entry.sourceUrl.endsWith("unchanged.txt"));
      expect(attachments).toHaveLength(2);
      expect(attachments[0]!.contentIdentity).toEqual(attachments[1]!.contentIdentity);
    }
  } finally { spy.mockRestore(); }
});

it.each(["TWSE", "TPEX"] as const)("%s changed snapshot event/rule with failed identity → preserve fresh source without unproven supersession", async (venue) => {
  const persistence = new MemoryPersistence(); const { rows, identity } = fixture(venue);
  await persistence.appendResearchIdentityRecords([identity]);
  const ticker = venue === "TWSE" ? "2072" : "4530";
  const history = JSON.parse(readFileSync(new URL(`../fixtures/research/mops-history-${ticker}.json`, import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL(`../fixtures/research/mops-detail-${ticker}.json`, import.meta.url), "utf8"));
  let failDetail = false;
  const fetchImpl: typeof fetch = async (url) => {
    const source = String(url);
    if (failDetail && source.endsWith("t05st01")) return new Response("restricted", { status: 403 });
    return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
  };
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: "original" });
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const original = (await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: at } })).items[0]!;
  rows[0].事實發生日 = "1151002"; rows[0].符合條款 = "第20款"; failDetail = true;
  const next = "2026-10-04T05:15:00.000Z";
  await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: next, acquisitionRunId: "changed" });
  const selected = (await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: next } })).items;
  expect(selected).toHaveLength(2);
  const current = selected.find((item) => item.collectionRecordId !== original.collectionRecordId)!;
  expect(current).toMatchObject({ eventDate: "2026-10-02", rawEventDate: "1151002", ruleClause: "第20款", detailQuality: { status: "restricted" } });
  expect(current.collectionRecordId).not.toBe(original.collectionRecordId);
  expect(current.relations).toEqual([]);
  expect(current.provenance.contentHash).toBe(disclosureHash(Buffer.from(JSON.stringify(rows))));
  expect((await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: at } })).items[0]).toEqual(original);
});

it.each(["TWSE", "TPEX"] as const)("%s snapshot decoding: malformed UTF8 → processing failure with raw-byte hash; BOM UTF8 → valid", async (venue) => {
  for (const malformed of [true, false]) {
    const persistence = new MemoryPersistence(); const { rows, identity } = fixture(venue);
    await persistence.appendResearchIdentityRecords([identity]); rows[0].說明 = "marker";
    const json = Buffer.from(JSON.stringify(rows));
    const bytes = malformed ? Buffer.from(json) : Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), json]);
    if (malformed) bytes[bytes.indexOf("marker")] = 0xff;
    const fetchImpl: typeof fetch = async (url) => String(url).includes("t05st01") ? new Response("restricted", { status: 403 }) : new Response(bytes);
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
    const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at });
    expect(result.outcomes[0]!.status).toBe(malformed ? "processing_failed" : "success");
    const query = { issuerId: identity.issuer.id, knowledgeAt: at, effectiveAt: at };
    const records = await persistence.listResearchAnnouncements(query);
    expect(records).toHaveLength(malformed ? 0 : 1);
    expect((await persistence.listResearchDisclosureScans(query))[0]!.provenance.contentHash).toBe(disclosureHash(bytes));
    expect(disclosureHash(bytes)).not.toBe(disclosureHash(new TextDecoder().decode(bytes)));
    if (!malformed) expect(records[0]!.explanation).toBe("marker");
  }
});

it("snapshot semantic identity: each retained field changes → distinct observation; unrelated feed metadata stays stable", () => {
  const { rows, identity } = fixture("TWSE");
  const metadata = { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE, acquisitionRunId: "identity" };
  const parse = (row: Record<string, unknown>) => parseOfficialAnnouncementSnapshot([row], metadata, "TWSE", [identity])[0]!;
  const original = parse(rows[0]);
  for (const patch of [{ 事實發生日: "1151002" }, { 事實發生日: "不適用" }, { 符合條款: "第20款" },
    { 發言時間: "07:00:04" }, { 網址: "https://mops.twse.com.tw/source" }, { 附件: [{ url: "https://mops.twse.com.tw/new.txt", title: "attachment" }] }]) {
    expect(parse({ ...rows[0], ...patch }).id).not.toBe(original.id);
  }
  expect(parse({ ...rows[0], 出表日期: "1151005", unrelated: "value" }).id).toBe(original.id);
});

it.each(["TWSE", "TPEX"] as const)("%s minute-colliding unknown rows: differing source evidence → neither row supersedes the other in either order", async (venue) => {
  const results: string[][] = [];
  for (const reverse of [false, true]) {
    const persistence = new MemoryPersistence(); const { rows, identity } = fixture(venue); await persistence.appendResearchIdentityRecords([identity]);
    const a = { ...rows[0], 發言時間: "07:00", 事實發生日: "1151001", 符合條款: "第20款", 說明: "First independent disclosure." };
    const b = { ...a, 事實發生日: "1151002", 符合條款: "第21款", 說明: "Second independent disclosure." };
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
    await runOfficialDisclosureAcquisition(persistence, { retrievedAt: at, fetchImpl: async (url) => String(url) === OFFICIAL_ANNOUNCEMENT_SOURCES[venue]
      ? new Response(JSON.stringify(reverse ? [b, a] : [a, b])) : new Response("restricted", { status: 403 }) });
    const page = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: at } });
    expect(page.items).toHaveLength(2); expect(page.items.every((item) => item.relations.length === 0)).toBe(true);
    expect(page.items.map((item) => item.ruleClause).sort()).toEqual(["第20款", "第21款"]);
    results.push(page.items.map((item) => item.id).sort());
  }
  expect(results[1]).toEqual(results[0]);
});

it.each(["TWSE", "TPEX"] as const)("%s verified publisher identity: same row across changed snapshot links; different serial does not", async (venue) => {
  for (const differentSerial of [false, true]) {
    const persistence = new MemoryPersistence(); const { rows, identity } = fixture(venue); await persistence.appendResearchIdentityRecords([identity]);
    const ticker = venue === "TWSE" ? "2072" : "4530";
    const history = JSON.parse(readFileSync(new URL(`../fixtures/research/mops-history-${ticker}.json`, import.meta.url), "utf8"));
    const detail = JSON.parse(readFileSync(new URL(`../fixtures/research/mops-detail-${ticker}.json`, import.meta.url), "utf8"));
    const fetchImpl: typeof fetch = async (url) => new Response(JSON.stringify(String(url).endsWith("t05st01_detail") ? detail : String(url).endsWith("t05st01") ? history : rows));
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
    await runOfficialDisclosureAcquisition(persistence, { retrievedAt: at, fetchImpl });
    const query = { subject: { kind: "listing_id" as const, listingId: identity.listing.id }, context: { knowledgeAt: at } };
    const first = (await listMaterialAnnouncements(persistence, query)).items[0]!;
    expect(first.publisherRecordId).toMatch(/^mops_/);
    if (differentSerial) history.result.data[0][5].parameters.serialNumber = "2";
    else { rows[0].符合條款 = "第20款"; rows[0].事實發生日 = "1151002"; }
    await runOfficialDisclosureAcquisition(persistence, { retrievedAt: "2026-10-04T05:15:00.000Z", fetchImpl });
    const page = await listMaterialAnnouncements(persistence, { ...query, context: { knowledgeAt: "2026-10-04T05:15:00.000Z" } });
    expect(page.items).toHaveLength(differentSerial ? 2 : 1);
    if (differentSerial) { expect(page.items.every((item) => item.relations.length === 0)).toBe(true); expect(new Set(page.items.map((item) => item.publisherRecordId)).size).toBe(2); }
    else { expect(page.items[0]!.publisherRecordId).toBe(first.publisherRecordId); expect(page.items[0]!.relations).toEqual([{ kind: "supersedes", targetAnnouncementId: first.id }]); }
  }
});

it.each((["TWSE", "TPEX"] as const).flatMap((venue) => (["cycle", "over_limit", "multiple_detail_failure", "missing_payload"] as const).map((failure) => ({ venue, failure }))))(
  "$venue $failure: affected listing fails → other rows continue and later success cannot clear failure", async ({ venue, failure }) => {
    for (const reverse of [false, true]) {
      const persistence = new MemoryPersistence(); const { rows, identity } = fixture(venue);
      const unrelated = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z",
        artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], contentHash: "unrelated_identity" },
        row: { kind: "company", ticker: "9997", legalName: "其他公司", displayName: "其他公司", unifiedBusinessNumber: "99999997", industryCode: "24", listedAt: "2000-01-01" } });
      await persistence.appendResearchIdentityRecords([identity, unrelated]);
      const source = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "prior" }, venue, [identity])[0]!;
      const ids = Array.from({ length: failure === "over_limit" ? 101 : failure === "missing_payload" ? 1 : 2 }, (_, index) => `blocked_tip_${index}`);
      const prior = ids.map((id) => ({ ...source, id, collectionRecordId: source.id,
        relations: failure === "cycle" ? [{ kind: "supersedes" as const, targetAnnouncementId: ids.find((other) => other !== id)! }] : [] }));
      await persistence.appendResearchAnnouncements(prior);
      if (failure === "missing_payload") {
        const read = persistence.getResearchAnnouncementsByIds.bind(persistence);
        vi.spyOn(persistence, "getResearchAnnouncementsByIds").mockImplementation((query) => query.ids.some((id) => ids.includes(id)) ? Promise.resolve([]) : read(query));
      }
      const goodSameListing = { ...rows[0], 主旨: "獨立可用公告", 說明: "Independent available source facts." };
      const goodOtherListing = { ...rows[0], 公司代號: "9997", SecuritiesCompanyCode: "9997", 說明: "Other issuer source facts." };
      const mixed = [rows[0], goodSameListing, goodOtherListing]; if (reverse) mixed.reverse();
      setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
      const result = await runOfficialDisclosureAcquisition(persistence, { retrievedAt: at, fetchImpl: async (url) => String(url) === OFFICIAL_ANNOUNCEMENT_SOURCES[venue]
        ? new Response(JSON.stringify(mixed)) : new Response("restricted", { status: 403 }) });
      expect(result.outcomes).toEqual([{ venue, status: "failed", announcementCount: 2 }]);
      const query = { effectiveAt: at, knowledgeAt: at };
      const affectedRecords = await persistence.listResearchAnnouncements({ ...query, issuerId: identity.issuer.id });
      expect(affectedRecords).toHaveLength(prior.length + 1);
      expect(affectedRecords.filter((record) => ids.includes(record.id))).toEqual(prior);
      expect(affectedRecords.find((record) => record.subject === "獨立可用公告")?.explanation).toBe("Independent available source facts.");
      const affectedScan = (await persistence.listResearchDisclosureScans({ ...query, issuerId: identity.issuer.id }))[0]!;
      expect(affectedScan.status).toBe("failed");
      expect(affectedScan.detailAttempts).toHaveLength(2);
      expect(affectedScan.detailAttempts!.find((attempt) => attempt.reasonCodes.includes("disclosure_revision_lineage_unresolved"))?.status).toBe("processing_failed");
      const unaffectedPage = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: unrelated.listing.id }, context: { knowledgeAt: at } });
      expect(unaffectedPage.scan.status).toBe("current");
      expect(unaffectedPage.scan.record?.status).toBe("success");
      expect(unaffectedPage.items).toHaveLength(1);
      expect(unaffectedPage.items[0]!.explanation.text).toBe("Other issuer source facts.");
      expect(unaffectedPage.scan.record!.detailAttempts!.every((attempt) => !attempt.reasonCodes.includes("disclosure_revision_lineage_unresolved"))).toBe(true);
    }
  });

it.each(["TWSE", "TPEX"] as const)("%s source clocks: explicit minute/second forms → exact timestamp and preserved raw precision", (venue) => {
  const { rows, identity } = fixture(venue);
  const metadata = { retrievedAt: at, contentHash: "a".repeat(64), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "clock" };
  for (const value of ["9:30", "09:30", "930", "0930", " 9:30 "]) {
    const record = parseOfficialAnnouncementSnapshot([{ ...rows[0], 發言時間: value }], metadata, venue, [identity])[0]!;
    expect(record).toMatchObject({ publishedAt: "2026-10-03T01:30:00.000Z", publicationPrecision: "minute", rawPublication: { time: value } });
  }
  for (const value of ["9:30:47", "09:30:47", "93047", "093047"]) {
    expect(parseOfficialAnnouncementSnapshot([{ ...rows[0], 發言時間: value }], metadata, venue, [identity])[0]).toMatchObject({ publishedAt: "2026-10-03T01:30:47.000Z", publicationPrecision: "second", rawPublication: { time: value } });
  }
  for (const value of ["", "9", "93", "9:3", "9:30:4", "09:3047", "24:00", "2400", "960", "2360", "93060", "093060", "1234567", "-930", "9.30"]) {
    expect(() => parseOfficialAnnouncementSnapshot([{ ...rows[0], 發言時間: value }], metadata, venue, [identity])).toThrow("announcement_publication_time_invalid");
  }
});


it.each((["TWSE", "TPEX"] as const).flatMap((venue) => [false, true].map((fixedMetadataClock) => ({ venue, fixedMetadataClock })) ))(
  "$venue board work deadline (fixed metadata $fixedMetadataClock): completed and empty listings → current; unfinished listings → failed", async ({ venue, fixedMetadataClock }) => {
    const { rows, identity } = fixture(venue); const persistence = new MemoryPersistence();
    const others = ["9997", "9998", "9999"].map((ticker) => canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z",
      artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], contentHash: ticker },
      row: { kind: "company", ticker, legalName: ticker, displayName: ticker, unifiedBusinessNumber: `9999${ticker}`, industryCode: "24", listedAt: "2000-01-01" } }));
    await persistence.appendResearchIdentityRecords([identity, ...others]);
    const mixed = [rows[0], { ...rows[0], 公司代號: "9997", SecuritiesCompanyCode: "9997" },
      { ...rows[0], 說明: "Deferred second row for the first listing." }, { ...rows[0], 公司代號: "9998", SecuritiesCompanyCode: "9998" }];
    const ordered = parseOfficialAnnouncementSnapshot(mixed, { retrievedAt: at, contentHash: disclosureHash(JSON.stringify(mixed)), sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], acquisitionRunId: "order" }, venue, [identity, ...others]).sort((a, b) => a.id < b.id ? -1 : 1);
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
    vi.useFakeTimers({ toFake: ["Date", "performance"] }); vi.setSystemTime(new Date(at));
    let details = 0;
    try {
      const fetchImpl: typeof fetch = async (url, init) => {
        if (String(url) === OFFICIAL_ANNOUNCEMENT_SOURCES[venue]) return new Response(JSON.stringify(mixed));
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        if (++details === 3) vi.advanceTimersByTime(20 * 60 * 1000);
        return new Response("restricted", { status: 403 });
      };
      const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, ...(fixedMetadataClock ? { retrievedAt: at } : {}) });
      expect(result.outcomes).toEqual([{ venue, status: "failed", announcementCount: 2 }]); expect(details).toBe(3);
      const completedAt = fixedMetadataClock ? at : "2026-10-04T05:20:00.000Z";
      for (const subject of [identity, ...others]) {
        const unfinished = ordered.slice(2).filter((record) => record.listingId === subject.listing.id);
        const scan = (await persistence.listResearchDisclosureScans({ issuerId: subject.issuer.id, effectiveAt: completedAt, knowledgeAt: completedAt }))[0]!;
        expect(scan).toMatchObject({ checkedAt: at, publicationEnd: at, knowledgeAt: completedAt, status: unfinished.length ? "failed" : "success", exhaustive: false });
        expect(scan.provenance).toMatchObject({ retrievedAt: at, processedAt: completedAt });
        const deferred = scan.detailAttempts!.filter((attempt) => attempt.reasonCodes.includes("disclosure_board_work_budget_exhausted"));
        expect(deferred).toHaveLength(unfinished.length);
        if (!unfinished.length) {
          const page = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: subject.listing.id }, context: { knowledgeAt: completedAt } });
          expect(page.scan.status).toBe("current");
        }
      }
      expect(await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, effectiveAt: completedAt, knowledgeAt: completedAt })).toHaveLength(ordered.slice(0, 2).filter((record) => record.issuerId === identity.issuer.id).length);
    } finally { vi.useRealTimers(); }
  });


it.each(["history", "detail", "attachment"] as const)("internal board deadline during %s: combined request abort → unfinished failure without failing empty listings", async (stage) => {
  const { rows, identity } = fixture("TWSE"); const persistence = new MemoryPersistence();
  const empty = canonicalizeOfficialIdentityRow({ venue: "TWSE", snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z",
    artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE, contentHash: "empty" }, row: { kind: "company", ticker: "9997", legalName: "empty", displayName: "empty", unifiedBusinessNumber: "99999997", industryCode: "24", listedAt: "2000-01-01" } });
  await persistence.appendResearchIdentityRecords([identity, empty]);
  const history = JSON.parse(readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8"));
  const detail = JSON.parse(readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8"));
  detail.result.titles.push({ main: "附件", sub: [] }); detail.result.data[0].push({ url: "https://mops.twse.com.tw/budget.txt", fileName: "budget.txt" });
  const controller = new AbortController(); const external = new AbortController();
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => milliseconds === 20 * 60 * 1000 ? controller.signal : originalTimeout(milliseconds));
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  try {
    const fetchImpl: typeof fetch = async (url, init) => {
      const source = String(url);
      const stop = stage === "history" ? source.endsWith("t05st01") : stage === "detail" ? source.endsWith("t05st01_detail") : source.endsWith("budget.txt");
      if (stop) { controller.abort(new DOMException("Board work deadline", "TimeoutError")); expect(init?.signal?.aborted).toBe(true); throw init?.signal?.reason; }
      return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
    };
    await runOfficialDisclosureAcquisition(persistence, { fetchImpl, signal: external.signal, retrievedAt: at });
    expect(external.signal.aborted).toBe(false);
    const scope = { effectiveAt: at, knowledgeAt: at };
    const failed = (await persistence.listResearchDisclosureScans({ ...scope, issuerId: identity.issuer.id }))[0]!;
    expect(failed.status).toBe("failed");
    expect(failed.detailAttempts!.some((attempt) => attempt.reasonCodes.includes("disclosure_board_work_budget_exhausted"))).toBe(true);
    expect((await persistence.listResearchDisclosureScans({ ...scope, issuerId: empty.issuer.id }))[0]!.status).toBe("success");
    expect(await persistence.listResearchAnnouncements({ ...scope, issuerId: identity.issuer.id })).toEqual([]);
  } finally { timeout.mockRestore(); }
});


it.each(["TWSE", "TPEX"] as const)("%s repeated budget expiry: durable rotation → every row attempted and marker stays internal", async (venue) => {
  const result = await disclosureContinuationScenario(new MemoryPersistence(), venue);
  expect(result.markers).toEqual(result.expected);
  expect(result.afterFailure).toEqual(result.last);
  expect(result.page.scan.record).not.toHaveProperty("acquisitionContinuation");
  expect(result.page.scan.latestAttempt).not.toHaveProperty("acquisitionContinuation");
});


it("board rotation: removed cursor row and parser change → successor then deterministic reset", async () => {
  const persistence = new MemoryPersistence();
  const result = await disclosureContinuationScenario(persistence, "TWSE");
  const historicalAt = "2026-10-04T05:01:00.000Z";
  expect((await persistence.getLatestDisclosureAcquisitionContinuation({ venue: "TWSE", effectiveAt: historicalAt, knowledgeAt: historicalAt }))?.afterRecordId).toBe(result.records[1]!.id);
  const remaining = result.rows.filter((row) => row.主旨 !== result.records[0]!.subject);
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal); let controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 20 * 60 * 1000 ? controller.signal : originalTimeout(ms));
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
  const run = async (rows: typeof remaining, at: string) => {
    controller = new AbortController();
    await runOfficialDisclosureAcquisition(persistence, { retrievedAt: at, acquisitionRunId: at, fetchImpl: async (url, init) => {
      if (String(url) === OFFICIAL_ANNOUNCEMENT_SOURCES.TWSE) return new Response(JSON.stringify(rows));
      controller.abort(new DOMException("Budget", "TimeoutError")); throw init?.signal?.reason;
    } });
    return persistence.getLatestDisclosureAcquisitionContinuation({ venue: "TWSE", effectiveAt: at, knowledgeAt: at });
  };
  try {
    expect((await run(remaining, "2026-10-04T05:06:00.000Z"))?.afterRecordId).toBe(result.records[1]!.id);
    const scan = (await persistence.listResearchDisclosureScans({ issuerId: result.identity.issuer.id, effectiveAt: "2026-10-04T05:06:00.000Z", knowledgeAt: "2026-10-04T05:06:00.000Z" })).find((scan) => scan.checkedAt === "2026-10-04T05:06:00.000Z")!;
    await persistence.appendResearchDisclosureScans([{ ...scan, id: "old_parser_marker", knowledgeAt: "2026-10-04T05:07:00.000Z", provenance: { ...scan.provenance, processedAt: "2026-10-04T05:07:00.000Z" }, acquisitionContinuation: { ...scan.acquisitionContinuation!, parserVersion: "old" } }]);
    expect((await run(result.rows, "2026-10-04T05:08:00.000Z"))?.afterRecordId).toBe(result.records[0]!.id);
  } finally { timeout.mockRestore(); }
});
