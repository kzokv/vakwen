import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { disclosureHash, parseOfficialAnnouncementSnapshot } from "../../src/services/research/providers/mopsAnnouncements.js";
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

it.each(["TWSE", "TPEX"] as const)("%s optional detailed event date: unavailable value → preserve raw value and valid detail", (venue) => {
  const { record, detail } = fixture(venue);
  const index = detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === "事實發生日");
  for (const rawEventDate of ["", "  不適用  ", "115/02/30", null]) {
    const payload = structuredClone(detail); payload.result.data[0][index] = rawEventDate;
    const result = parseOfficialAnnouncementDetail(payload, record, metadata);
    expect(result.detailStatus).toBe("available");
    expect(result.record.eventDate).toBeNull();
    expect(result.record.rawEventDate).toBe(rawEventDate ?? undefined);
  }
  const missing = structuredClone(detail); missing.result.titles.splice(index, 1); missing.result.data[0].splice(index, 1);
  expect(parseOfficialAnnouncementDetail(missing, record, metadata).record.eventDate).toBeNull();
});

it.each((["TWSE", "TPEX"] as const).flatMap((venue) => (["corrects", "retracts"] as const).flatMap((kind) =>
  ["2026-10-02", "2026-10-2", "2026/10/02", "2026/10/2", "2026年10月02日", "2026年10月2日", "115-10-02", "115-10-2", "115/10/02", "115/10/2", "115年10月02日", "115年10月2日"].map((citationDate) => ({ venue, kind, citationDate })))))(
  "$venue $kind citation $citationDate: shared normalized selectors → same exact lineage in detail and failed-detail fallback", async ({ venue, kind, citationDate }) => {
    const { record, detail } = fixture(venue);
    const prior = { ...record, id: "cited_prior", publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
    const notice = { ...record, subject: `${kind === "corrects" ? "更正" : "撤回"}本公司公告`, explanation: `原${citationDate}公告「公司\u3000資本支出公告」內容變更。` };
    for (const field of ["主旨", "說明"]) detail.result.data[0][detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === field)] = field === "主旨" ? notice.subject : notice.explanation;
    expect(announcementCitationSelectors(notice)).toEqual({ titles: [prior.subject], days: ["2026-10-02"] });
    const isolated = [
      { ...prior, id: "wrong_issuer", issuerId: "other_issuer" }, { ...prior, id: "wrong_listing", listingId: "other_listing" },
      { ...prior, id: "wrong_venue", venue: venue === "TWSE" ? "TPEX" as const : "TWSE" as const },
      { ...prior, id: "future", publishedAt: "2026-10-04T01:00:00.000Z" },
      { ...prior, id: "wrong_title", subject: "公司資本支出" },
    ];
    for (const targets of [[prior], [prior, { ...prior, id: "second_cited_prior" }], []]) {
      const previous = [...targets, ...isolated];
      const results = [parseOfficialAnnouncementDetail(detail, notice, metadata, previous),
        await enrichOfficialAnnouncement(notice, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })), resolvePreviousRecords: async () => previous })];
      expect(results[0]!.detailStatus).toBe("available");
      expect(results[0]!.record.provenance.parserVersion).toBe("mops-announcement-detail/1.0.8");
      expect(results[1]!.detailStatus).toBe("restricted");
      for (const result of results) {
        expect(result.record.relations).toEqual(targets.length === 1 ? [{ kind, targetAnnouncementId: prior.id }] : []);
        expect(result.record.unresolvedRelations).toEqual(targets.length === 2 ? [{ kind, candidateAnnouncementIds: [prior.id, "second_cited_prior"] }] : []);
        expect(result.record.unknownRelationTargets).toEqual(targets.length === 0 ? [{ kind }] : []);
        expect(result.record.explanation).toBe(notice.explanation);
      }
    }
  });

it.each(["2026/02/30", "115-02-30", "2026/13/02", "2026/10-02", "2026年10/02日", "12026/10/02", "2026/10/022"])(
  "invalid citation %s: detail and raw fallback → no fabricated predecessor relation", async (citationDate) => {
    const { record, detail } = fixture("TWSE");
    const prior = { ...record, id: "prior", publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
    const notice = { ...record, subject: "更正本公司公告", explanation: `原${citationDate}公告「${prior.subject}」內容變更。` };
    detail.result.data[0][6] = notice.subject; detail.result.data[0][9] = notice.explanation;
    expect(announcementCitationSelectors(notice).days).toEqual([]);
    for (const result of [parseOfficialAnnouncementDetail(detail, notice, metadata, [prior]),
      await enrichOfficialAnnouncement(notice, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })), previousRecords: [prior] })]) {
      expect(result.record.relations).toEqual([]);
      expect(result.record.unknownRelationTargets).toEqual([{ kind: "corrects" }]);
      expect(result.reasonCodes).toContain("unresolved_correction_reference");
    }
  });


it.each((["TWSE", "TPEX"] as const).flatMap((venue) => ["代子公司公告", "代重要子公司公告", "代子公司宏達股份有限公司公告", "代重要子公司「宏達股份有限公司」公告"].flatMap((prefix) =>
  ["更正", "撤回", "撤銷"].map((action) => ({ venue, prefix, action })))))(
  "$venue delegated $prefix$action: explicit prefix → same scoped detail and raw-fallback lineage", async ({ venue, prefix, action }) => {
    const { record, detail } = fixture(venue);
    const kind = action === "更正" ? "corrects" : "retracts";
    const prior = { ...record, id: "prior_a", publishedAt: "2026-10-02T01:00:00.000Z", subject: "公司資本支出公告" };
    const notice = { ...record, subject: `${prefix}${action}先前公告`, explanation: `原2026/10/02公告「${prior.subject}」內容變更。` };
    for (const field of ["主旨", "說明"]) detail.result.data[0][detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === field)] = field === "主旨" ? notice.subject : notice.explanation;
    expect(announcementCitationSelectors(notice)).toEqual({ titles: [prior.subject], days: ["2026-10-02"] });
    for (const count of [0, 1, 2]) {
      const previous = [prior, { ...prior, id: "prior_b" }].slice(0, count).concat([
        { ...prior, id: "foreign_issuer", issuerId: "foreign" }, { ...prior, id: "foreign_listing", listingId: "foreign" },
        { ...prior, id: "future", publishedAt: "2026-10-04T01:00:00.000Z" }, { ...prior, id: "partial_title", subject: "資本支出公告" },
      ]);
      for (const result of [parseOfficialAnnouncementDetail(detail, notice, metadata, previous),
        await enrichOfficialAnnouncement(notice, { previousRecords: previous, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })) })]) {
        expect(result.record.relations).toEqual(count === 1 ? [{ kind, targetAnnouncementId: prior.id }] : []);
        expect(result.record.unresolvedRelations).toEqual(count === 2 ? [{ kind, candidateAnnouncementIds: ["prior_a", "prior_b"] }] : []);
        expect(result.record.unknownRelationTargets).toEqual(count === 0 ? [{ kind }] : []);
      }
    }
    for (const subject of [`說明${prefix}${action}程序`, `代子公司宏達公告內容說明公告${action}`, `代子公司宏達。公告${action}`, `代子公司${"甲".repeat(121)}公告${action}`]) {
      const incidental = { ...notice, subject };
      detail.result.data[0][detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === "主旨")] = incidental.subject;
      expect(announcementCitationSelectors(incidental)).toEqual({ titles: [], days: [] });
      for (const result of [parseOfficialAnnouncementDetail(detail, incidental, metadata, [prior]),
        await enrichOfficialAnnouncement(incidental, { previousRecords: [prior], fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })) })]) {
        expect(result.record.relations).toEqual([]); expect(result.record.unknownRelationTargets).toEqual([]);
      }
    }
  });


it.each((["TWSE", "TPEX"] as const).flatMap((venue) => ["09:30", "0930"].flatMap((snapshotClock) =>
  ["09:30", "9:30", "09:30:00", "09:30:47", "9:30:47", "0930", "093047", "93047"].map((publisherClock) => ({ venue, snapshotClock, publisherClock })))))(
  "$venue minute snapshot $snapshotClock with publisher $publisherClock: unique minute match → retain original snapshot precision", async ({ venue, snapshotClock, publisherClock }) => {
    const { record, history, detail } = fixture(venue);
    const minuteRecord = { ...record, publishedAt: "2026-10-03T01:30:00.000Z", publicationPrecision: "minute" as const,
      rawPublication: { date: "1151003", time: snapshotClock } };
    history.result.data[0][3] = publisherClock;
    const timeIndex = detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === "發言時間");
    detail.result.data[0][timeIndex] = publisherClock;
    expect(selectOfficialAnnouncementDetailParameters(history, minuteRecord).companyId).toBe(record.ticker);
    expect(parseOfficialAnnouncementDetail(detail, minuteRecord, metadata).record).toMatchObject({ publishedAt: minuteRecord.publishedAt, publicationPrecision: "minute", rawPublication: minuteRecord.rawPublication });
    const result = await enrichOfficialAnnouncement(minuteRecord, { retrievedAt: metadata.retrievedAt,
      fetchImpl: vi.fn<typeof fetch>().mockImplementation(async (url) => new Response(JSON.stringify(String(url).endsWith("t05st01_detail") ? detail : history))) });
    expect(result.detailStatus).toBe("available"); expect(result.record.publicationPrecision).toBe("minute");
    const duplicate = structuredClone(history.result.data[0]); duplicate[3] = "09:30:59"; duplicate[5].parameters.serialNumber = "2";
    history.result.data.push(duplicate);
    expect(() => selectOfficialAnnouncementDetailParameters(history, minuteRecord)).toThrow("detail_reference_unresolved");
  });

it.each(["TWSE", "TPEX"] as const)("%s precise publication: clock mismatch or invalid value → reject history and detail without guessing", (venue) => {
  const { record, history, detail } = fixture(venue);
  const timeIndex = detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === "發言時間");
  for (const publicationPrecision of ["minute", "second"] as const) {
    const target = { ...record, publishedAt: "2026-10-03T01:30:47.000Z", publicationPrecision };
    for (const value of ["09:31", "09:31:47", "24:30:47", "09:60:47", "09:30:60", "09:3047", "930", "", "invalid", ...(publicationPrecision === "second" ? ["09:30", "0930", "09:30:46"] : [])]) {
      history.result.data[0][3] = value; detail.result.data[0][timeIndex] = value;
      expect(() => selectOfficialAnnouncementDetailParameters(history, target)).toThrow("detail_reference_unresolved");
      expect(() => parseOfficialAnnouncementDetail(detail, target, metadata)).toThrow("detail_observation_mismatch");
    }
    for (const validClock of ["09:30:47", "9:30:47", "093047", "93047"]) {
      history.result.data[0][3] = validClock; detail.result.data[0][timeIndex] = validClock;
      expect(selectOfficialAnnouncementDetailParameters(history, target).companyId).toBe(record.ticker);
      expect(parseOfficialAnnouncementDetail(detail, target, metadata).detailStatus).toBe("available");
    }
  }
  const dateOnly = { ...record, publicationPrecision: "date" as const };
  expect(() => selectOfficialAnnouncementDetailParameters(history, dateOnly)).toThrow("detail_reference_unresolved");
  expect(() => parseOfficialAnnouncementDetail(detail, dateOnly, metadata)).toThrow("detail_observation_mismatch");
});

it.each((["TWSE", "TPEX"] as const).flatMap((venue) => (["corrects", "retracts"] as const).map((kind) => ({ venue, kind }))))(
  "$venue $kind paired citations: coarse selector cross-product → only actual title/date pairs may link", async ({ venue, kind }) => {
    const { record, detail } = fixture(venue);
    const notice = { ...record, subject: `${kind === "corrects" ? "更正" : "撤回"}本公司公告`, explanation: '原115/10/01公告「公告A」及2026年10月2日公告「公告B」內容變更。' };
    const a = { ...record, id: "prior_a", subject: "公告A", publishedAt: "2026-10-01T01:00:00.000Z" };
    const b = { ...record, id: "prior_b", subject: "公告B", publishedAt: "2026-10-02T01:00:00.000Z" };
    const swapped = [{ ...a, id: "swapped_a", publishedAt: b.publishedAt }, { ...b, id: "swapped_b", publishedAt: a.publishedAt }];
    expect(announcementCitationSelectors(notice)).toEqual({ titles: ["公告A", "公告B"], days: ["2026-10-01", "2026-10-02"] });
    for (const matched of [[], [a], [b], [a, b]]) {
      for (const field of ["主旨", "說明"]) detail.result.data[0][detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === field)] = field === "主旨" ? notice.subject : notice.explanation;
      const results = [parseOfficialAnnouncementDetail(detail, notice, metadata, [...swapped, ...matched]),
        await enrichOfficialAnnouncement(notice, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })), resolvePreviousRecords: async () => [...swapped, ...matched] })];
      for (const result of results) {
        expect(result.record.relations).toEqual(matched.length === 1 ? [{ kind, targetAnnouncementId: matched[0]!.id }] : []);
        expect(result.record.unresolvedRelations).toEqual(matched.length === 2 ? [{ kind, candidateAnnouncementIds: [a.id, b.id] }] : []);
        expect(result.record.unknownRelationTargets).toEqual(matched.length === 0 ? [{ kind }] : []);
      }
    }
    for (const explanation of ['事實發生日115/10/01。更正「公告A」。', '115/10/01另有董事會決議，公告「公告A」。', '115/10/01「公告B」及「公告A」。', '「公告A」於2026/10/01完成交易。', '「其他公告」公告日期為2026/10/01「公告A」公告日期為2026/10/02。']) {
      const uncertain = { ...notice, explanation };
      detail.result.data[0][detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === "說明")] = explanation;
      const results = [parseOfficialAnnouncementDetail(detail, uncertain, metadata, [a]),
        await enrichOfficialAnnouncement(uncertain, { fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })), previousRecords: [a] })];
      for (const result of results) {
        expect(result.record.relations).toEqual([]);
        expect(result.record.unknownRelationTargets).toEqual([{ kind }]);
      }
    }
  });

it("citation token boundaries: title-first explicit date → paired; title-contained date and sentence boundary → unknown", () => {
  const { record } = fixture("TWSE");
  for (const explanation of ['「公告A」公告日期為115/10/01。', '「公告A」發布日期：2026年10月1日。', '「公告A」公告於2026/10/01。']) {
    expect(announcementCitationSelectors({ ...record, subject: "更正公告", explanation })).toEqual({ titles: ["公告A"], days: ["2026-10-01"] });
  }
  for (const explanation of ['「115/10/01公告」與「公告A」。', '「公告A」。公告日期115/10/01。', '「115/10/01」公告「公告A」。']) {
    expect(announcementCitationSelectors({ ...record, subject: "更正公告", explanation })).toEqual({ titles: [], days: [] });
  }
});

it("overlapping citation tokens: ambiguous component → discarded without losing independent pair", () => {
  const { record } = fixture("TWSE");
  const notice = { ...record, subject: "更正公告", explanation: '「公告A」公告日期為2026/10/01「公告B」公告日期為2026/10/02；2026/10/03公告「公告C」。' };
  expect(announcementCitationSelectors(notice)).toEqual({ titles: ["公告C"], days: ["2026-10-03"] });
});

it.each((["TWSE", "TPEX"] as const).flatMap((venue) => (["history", "detail"] as const).map((stage) => ({ venue, stage }))))(
  "$venue $stage JSON: malformed UTF8 → processing failure without replacement-character evidence", async ({ venue, stage }) => {
    const { record, history, detail } = fixture(venue);
    const fetchImpl: typeof fetch = async (url) => {
      const isDetail = String(url).endsWith("t05st01_detail");
      const payload = { ...(isDetail ? detail : history), utf8Marker: "marker" };
      const bytes = Buffer.from(JSON.stringify(payload));
      if ((stage === "detail") === isDetail) bytes[bytes.indexOf("marker")] = 0xff;
      return new Response(bytes);
    };
    const result = await enrichOfficialAnnouncement(record, { fetchImpl });
    expect(result.detailStatus).toBe("processing_failed");
    expect(result.reasonCodes).toContain("detail_response_invalid_utf8");
    expect(result.record.explanation).toBe(record.explanation);
    expect(result.record.provenance).toEqual(record.provenance);
  });
it("detail BOM UTF8: decoded valid JSON → provenance hashes original bytes", async () => {
  const { record, history, detail } = fixture("TWSE");
  const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(detail))]);
  const result = await enrichOfficialAnnouncement(record, { fetchImpl: async (url) => new Response(String(url).endsWith("t05st01_detail") ? bytes : JSON.stringify(history)) });
  expect(result.detailStatus).toBe("available");
  expect(result.record.provenance.contentHash).toBe(disclosureHash(bytes));
  expect(result.record.provenance.contentHash).not.toBe(disclosureHash(new TextDecoder().decode(bytes)));
});

it.each((["TWSE", "TPEX"] as const).flatMap((venue) => (["corrects", "retracts"] as const).map((kind) => ({ venue, kind }))))(
  "$venue $kind citation revisions: explicit lineage → active exact target without collapsing independent tips", async ({ venue, kind }) => {
    const { record, detail } = fixture(venue);
    const notice = { ...record, subject: `${kind === "corrects" ? "更正" : "撤回"}本公司公告`, explanation: '原115/10/02公告「公司資本支出公告」內容变更。' };
    const a = { ...record, id: "revision_a", subject: "公司資本支出公告", publishedAt: "2026-10-02T01:00:00.000Z", relations: [] };
    const b = { ...a, id: "revision_b", relations: [{ kind: "supersedes" as const, targetAnnouncementId: a.id }] };
    const c = { ...a, id: "revision_c", relations: [{ kind: "supersedes" as const, targetAnnouncementId: b.id }] };
    const independent = { ...a, id: "independent" };
    const cases = [
      { previous: [a, b, c], targets: [c.id] },
      { previous: [a, b, c, independent], targets: [independent.id, c.id].sort() },
      { previous: [a, { ...b, subject: "不同公告" }], targets: [] },
      { previous: [a, { ...b, publishedAt: "2026-10-01T01:00:00.000Z" }], targets: [] },
      { previous: [a, { ...b, quality: "restricted" as const }], targets: [a.id] },
      { previous: [a, { ...b, listingId: "other_listing" }], targets: [a.id] },
      { previous: [a, { ...b, issuerId: "other_issuer" }], targets: [a.id] },
      { previous: [a, { ...b, venue: venue === "TWSE" ? "TPEX" as const : "TWSE" as const }], targets: [a.id] },
      { previous: [a, { ...b, publishedAt: notice.publishedAt }], targets: [a.id] },
      { previous: [a, { ...b, provenance: { ...b.provenance, processedAt: "2099-01-01T00:00:00.000Z" } }], targets: [a.id] },
      { previous: [{ ...a, relations: [{ kind: "supersedes" as const, targetAnnouncementId: b.id }] }, b], targets: [] },
      { previous: [a, { ...b, id: "unrelated_x", subject: "另一公告", relations: [{ kind: "supersedes" as const, targetAnnouncementId: "unrelated_y" }] },
        { ...c, id: "unrelated_y", subject: "另一公告", relations: [{ kind: "supersedes" as const, targetAnnouncementId: "unrelated_x" }] }], targets: [a.id] },
    ];
    for (const field of ["主旨", "說明"]) detail.result.data[0][detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === field)] = field === "主旨" ? notice.subject : notice.explanation;
    for (const { previous, targets } of cases) {
      const results = [parseOfficialAnnouncementDetail(detail, notice, metadata, previous),
        await enrichOfficialAnnouncement(notice, { retrievedAt: metadata.retrievedAt, fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("restricted", { status: 403 })), previousRecords: previous })];
      for (const result of results) {
        expect(result.record.relations).toEqual(targets.length === 1 ? [{ kind, targetAnnouncementId: targets[0] }] : []);
        expect(result.record.unresolvedRelations).toEqual(targets.length > 1 ? [{ kind, candidateAnnouncementIds: targets }] : []);
        expect(result.record.unknownRelationTargets).toEqual(targets.length === 0 ? [{ kind }] : []);
      }
    }
  });
