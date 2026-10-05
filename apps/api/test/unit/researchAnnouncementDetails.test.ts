import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { parseOfficialAnnouncementSnapshot } from "../../src/services/research/providers/mopsAnnouncements.js";
import {
  announcementCitationSelectors, enrichOfficialAnnouncement, parseOfficialAnnouncementDetail, selectOfficialAnnouncementDetailParameters,
  MOPS_ANNOUNCEMENT_HISTORY_URL, MOPS_ANNOUNCEMENT_DETAIL_URL,
} from "../../src/services/research/providers/mopsAnnouncementDetails.js";

function raw(name: string) { return JSON.parse(readFileSync(new URL(`../fixtures/research/${name}.json`, import.meta.url), "utf8")); }
function fixture(venue: "TWSE" | "TPEX") {
  const ticker = venue === "TWSE" ? "2072" : "4530";
  const identity = canonicalizeOfficialIdentityRow({
    venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T02:00:00.000Z",
    artifact: { contentHash: "a".repeat(64), sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
    row: { kind: "company", ticker, legalName: "測試公司", displayName: "測試", unifiedBusinessNumber: "12345678", industryCode: "24", listedAt: "2000-01-01" },
  });
  const snapshot = raw(venue === "TWSE" ? "twse-announcements" : "tpex-announcements");
  const rows = snapshot.filter((row: Record<string, string>) => (row.公司代號 ?? row.SecuritiesCompanyCode) === ticker);
  const record = parseOfficialAnnouncementSnapshot(rows, { contentHash: "b".repeat(64), retrievedAt: "2026-10-04T04:00:00.000Z", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap04_L", acquisitionRunId: "run_1" }, venue, [identity])[0]!;
  return { record, history: raw(`mops-history-${ticker}`), detail: raw(`mops-detail-${ticker}`) };
}
const metadata = { contentHash: "c".repeat(64), retrievedAt: "2026-10-04T04:05:00.000Z" };

describe("official MOPS detail enrichment", () => {
  it.each(["TWSE", "TPEX"] as const)("%s authentic discovery: exact publisher row → board-specific detail identity", (venue) => {
    const { record, history, detail } = fixture(venue);
    expect(selectOfficialAnnouncementDetailParameters(history, record)).toMatchObject({ marketKind: venue === "TWSE" ? "sii" : "otc", companyId: record.ticker, serialNumber: "1", enterDate: "1151003" });
    const result = parseOfficialAnnouncementDetail(detail, record, metadata);
    expect(result.detailStatus).toBe("available");
    expect(result.record.explanation).toBe(record.explanation);
    expect(result.record.eventDate).toBe(record.eventDate);
    expect(result.record.collectionProvenance).toEqual(record.provenance);
    expect(result.record.provenance).toMatchObject({ accessProvider: "MOPS_API", contentHash: metadata.contentHash, sourceUrl: MOPS_ANNOUNCEMENT_DETAIL_URL });
  });
  it("native file cell: official {url,fileName} representation → retain metadata without fabricated content", () => {
    const { record, detail } = fixture("TWSE");
    // Mutation of the captured no-attachment response using the official SPA renderer's file-cell shape.
    detail.result.titles.push({ main: "附件" });
    detail.result.data[0].push({ url: "https://mopsov.twse.com.tw/nas/STR/2072/notice.pdf", fileName: "公司說明.pdf" });
    const result = parseOfficialAnnouncementDetail(detail, record, metadata);
    expect(result.record.attachments.at(-1)).toMatchObject({ title: "公司說明.pdf", mediaType: "application/pdf", sourceUrl: "https://mopsov.twse.com.tw/nas/STR/2072/notice.pdf" });
    expect(result.record.attachments.at(-1)!.artifactId).toMatch(/^art_/);
  });
  it("hostile file cell: nonofficial URL → reject acquisition evidence", () => {
    const { record, detail } = fixture("TWSE");
    detail.result.titles.push({ main: "附件" });
    detail.result.data[0].push({ url: "http://127.0.0.1/secrets", fileName: "attachment" });
    expect(() => parseOfficialAnnouncementDetail(detail, record, metadata)).toThrow(/source_not_permitted/);
  });
  it.each(["corrects", "retracts"] as const)("explicit %s: exact quoted title/date/issuer → immutable correction relation", (kind) => {
    const { record, detail } = fixture("TWSE");
    const prior = { ...record, id: "prior_1", publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
    const subject = `${kind === "corrects" ? "更正" : "撤回"}本公司公告`;
    const explanation = `原115/10/02公告「公司資本支出公告」${kind === "corrects" ? "金額更正" : "撤回"}。`;
    detail.result.data[0][6] = subject;
    detail.result.data[0][9] = explanation;
    const result = parseOfficialAnnouncementDetail(detail, { ...record, subject }, metadata, [prior]);
    expect(result.record.relations).toEqual([{ kind, targetAnnouncementId: "prior_1" }]);
    expect(result.reasonCodes).toEqual([]);
  });
  it.each(["corrects", "retracts"] as const)("cross-listing %s: matching issuer/title/date → no foreign lineage", (kind) => {
    const { record, detail } = fixture("TWSE");
    const prior = { ...record, id: "foreign_prior", listingId: "another_listing", venue: "TPEX" as const, publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
    const subject = `${kind === "corrects" ? "更正" : "撤回"}本公司公告`;
    detail.result.data[0][6] = subject;
    detail.result.data[0][9] = "原115/10/02公告「公司資本支出公告」更正或撤回。";
    const unresolved = parseOfficialAnnouncementDetail(detail, { ...record, subject }, metadata, [prior]);
    expect(unresolved.record.relations).toEqual([]);
    expect(unresolved.reasonCodes).toContain("unresolved_correction_reference");
    const local = { ...prior, id: "local_prior", listingId: record.listingId, venue: record.venue };
    const resolved = parseOfficialAnnouncementDetail(detail, { ...record, subject }, metadata, [prior, local]);
    expect(resolved.record.relations).toEqual([{ kind, targetAnnouncementId: local.id }]);
    expect(resolved.reasonCodes).toEqual([]);
  });
  it("ambiguous correction: no exact cited previous observation → preserve explicit unresolved reference", () => {
    const { record, detail } = fixture("TWSE");
    detail.result.data[0][6] = "更正本公司公告";
    detail.result.data[0][9] = "更正先前公告金額。";
    const result = parseOfficialAnnouncementDetail(detail, { ...record, subject: "更正本公司公告" }, metadata, [record]);
    expect(result.record.relations).toEqual([]);
    expect(result.reasonCodes).toEqual(["unresolved_correction_reference"]);
  });
  it("discovery row mismatch: shared ticker but different timestamp → reject guessed detail route", () => {
    const { record, history } = fixture("TWSE");
    history.result.data[0][3] = "07:00:05";
    expect(() => selectOfficialAnnouncementDetailParameters(history, record)).toThrow(/unresolved/);
  });
  it("internal acquisition: native discovery then detail → exactly two bounded official requests", async () => {
    const { record, history, detail } = fixture("TPEX");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(history))).mockResolvedValueOnce(new Response(JSON.stringify(detail)));
    const result = await enrichOfficialAnnouncement(record, { fetchImpl, retrievedAt: metadata.retrievedAt });
    expect(result.detailStatus).toBe("available");
    expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([MOPS_ANNOUNCEMENT_HISTORY_URL, MOPS_ANNOUNCEMENT_DETAIL_URL]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]![1]!.body))).toMatchObject({ marketKind: "otc", companyId: "4530" });
  });
  it.each([
    [new Response("FOR SECURITY REASONS, THIS PAGE CAN NOT BE ACCESSED."), "restricted"],
    [new Response("unavailable", { status: 503 }), "unavailable"],
    [new Response("not json"), "processing_failed"],
  ] as const)("source failure: response %j → detail %s without losing independent snapshot", async (response, expected) => {
    const { record } = fixture("TWSE");
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(response);
    const result = await enrichOfficialAnnouncement(record, { fetchImpl });
    expect(result.detailStatus).toBe(expected);
    expect(result.record.quality).toBe("available");
    expect(result.record.explanation).toBe(record.explanation);
    expect(result.record.attachments).toEqual(record.attachments);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("unbounded stream: response exceeds2MiB → cancel before decoding", async () => {
    const { record } = fixture("TWSE");
    const cancel = vi.fn();
    const stream = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)); }, cancel });
    const result = await enrichOfficialAnnouncement(record, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response(stream)) });
    expect(result.detailStatus).toBe("processing_failed");
    expect(result.reasonCodes).toEqual(["detail_response_too_large"]);
    expect(cancel).toHaveBeenCalledOnce();
  });

});

it("citation selectors: whitespace-normalized publisher date/title → same exact parser candidates", () => {
  const { record } = fixture("TWSE");
  expect(announcementCitationSelectors({ ...record, subject: "更正本公司公告", explanation: "原115 年 10 月 02 日公告「公司　資本\ufeff支出公告」金額更正。" })).toEqual({ titles: ["公司資本支出公告"], days: ["2026-10-02"] });
  expect(announcementCitationSelectors({ ...record, subject: "更正本公司公告", explanation: "原115 / 10 / 02公告「公司資本支出公告」金額更正。" }).days).toEqual(["2026-10-02"]);
});

it.each(["corrects", "retracts"] as const)("ambiguous %s: exact same-listing targets → retain candidates without resolved edges", (kind) => {
  const { record, detail } = fixture("TWSE");
  const subject = `${kind === "corrects" ? "更正" : "撤回"}本公司公告`;
  detail.result.data[0][6] = subject;
  detail.result.data[0][9] = "原115/10/02公告「公司資本支出公告」內容變更。";
  const prior = { ...record, id: "candidate_a", publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
  const result = parseOfficialAnnouncementDetail(detail, { ...record, subject }, metadata, [
    { ...prior, id: "candidate_b" }, prior,
    { ...prior, id: "wrong_listing", listingId: "other_listing" },
    { ...prior, id: "future_candidate", publishedAt: "2026-10-04T01:00:00.000Z" },
  ]);
  expect(result.record.relations).toEqual([]);
  expect(result.record.unresolvedRelations).toEqual([{ kind, candidateAnnouncementIds: ["candidate_a", "candidate_b"] }]);
  expect(result.reasonCodes).toEqual(["unresolved_correction_reference"]);
  expect(parseOfficialAnnouncementDetail(detail, { ...record, subject }, metadata, []).record.unresolvedRelations).toEqual([]);
});

it.each(["corrects", "retracts"] as const)("snapshot %s with unavailable detail: exact citation → retained lineage or explicit unresolved candidates", async (kind) => {
  const { record } = fixture("TWSE");
  const prior = { ...record, id: "prior_a", publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
  const notice = { ...record, subject: `${kind === "corrects" ? "更正" : "撤回"}本公司公告`, explanation: "原115 /10 /02 公告「公司資本支出公告」內容變更。" };
  for (const count of [0, 1, 2]) {
    const previous = [prior, { ...prior, id: "prior_b" }].slice(0, count);
    const resolver = vi.fn(async () => previous);
    const result = await enrichOfficialAnnouncement(notice, { fetchImpl: vi.fn<typeof fetch>().mockImplementation(async () => new Response("restricted", { status: 403 })), resolvePreviousRecords: resolver });
    expect(resolver).toHaveBeenCalledWith(notice);
    expect(result.record.quality).toBe("available"); expect(result.detailStatus).toBe("restricted");
    expect(result.record.provenance).toEqual(notice.provenance);
    expect(result.record.relations).toEqual(count === 1 ? [{ kind, targetAnnouncementId: prior.id }] : []);
    expect(result.record.unresolvedRelations).toEqual(count === 2 ? [{ kind, candidateAnnouncementIds: ["prior_a", "prior_b"] }] : []);
    expect(result.record.unknownRelationTargets).toEqual(count === 0 ? [{ kind }] : []);
    expect(result.reasonCodes.includes("unresolved_correction_reference")).toBe(count !== 1);
    expect(result.record.detailQuality?.reasonCodes).toEqual(result.reasonCodes);
  }
});
