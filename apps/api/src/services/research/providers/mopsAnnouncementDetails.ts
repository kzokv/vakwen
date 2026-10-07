import type { ResearchAnnouncementMetadata } from "../disclosureContracts.js";
import { isMopsAccessDenial } from "./mopsAccessDenial.js";
import { z } from "zod";
import type { ResearchAnnouncementRecord } from "../disclosureContracts.js";
import { researchAnnouncementRecordSchema } from "../disclosureContracts.js";
import { disclosureHash, disclosureId, safeDisclosureUrl, parseOptionalAnnouncementEventDate } from "./mopsAnnouncements.js";
import { parseTaiwanOfficialDate } from "./twseIdentity.js";

/** Routes and parameter names verified against the official MOPS SPA on 2026-10-04. */
export const MOPS_ANNOUNCEMENT_HISTORY_URL = "https://mops.twse.com.tw/mops/api/t05st01";
export const MOPS_ANNOUNCEMENT_DETAIL_URL = "https://mops.twse.com.tw/mops/api/t05st01_detail";
export const MOPS_DETAIL_PARSER_VERSION = "mops-announcement-detail/1.0.4";
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const parametersSchema = z.object({
  marketKind: z.enum(["sii", "otc"]), companyId: z.string().regex(/^[A-Za-z0-9]+$/),
  serialNumber: z.string().regex(/^\d+$/), enterDate: z.string().regex(/^\d{7}$/),
}).strict();
const historySchema = z.object({ code: z.literal(200), result: z.object({
  marketName: z.string(), companyId: z.string(), data: z.array(z.tuple([
    z.string(), z.string(), z.string(), z.string(), z.string(),
    z.object({ apiName: z.literal("t05st01_detail"), parameters: parametersSchema }),
  ])),
}) });
const detailSchema = z.object({ code: z.literal(200), result: z.object({
  marketName: z.string(), companyId: z.string(),
  titles: z.array(z.object({ main: z.string() })), data: z.array(z.array(z.unknown())).length(1),
}) });
export type OfficialAnnouncementDetailParameters = z.infer<typeof parametersSchema>;
export type AnnouncementDetailStatus = "available" | "restricted" | "processing_failed" | "unavailable";
export interface AnnouncementEnrichmentResult {
  record: ResearchAnnouncementRecord;
  detailStatus: AnnouncementDetailStatus;
  reasonCodes: string[];
}
export interface AnnouncementEnrichmentOptions {
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  previousRecords?: readonly ResearchAnnouncementMetadata[];
  resolvePreviousRecords?: (record: ResearchAnnouncementRecord) => Promise<readonly ResearchAnnouncementMetadata[]>;
  retrievedAt?: string;
}
function attachmentMediaType(url: string, fileName: string): string {
  const filenameExtension = /\.(pdf|txt|html?|xhtml)$/i.exec(fileName.trim())?.[1]?.toLowerCase();
  const extension = filenameExtension ?? /\.(pdf|txt|html?|xhtml)$/i.exec(new URL(url).pathname)?.[1]?.toLowerCase();
  return extension === "pdf" ? "application/pdf" : extension === "txt" ? "text/plain" : extension === "xhtml" ? "application/xhtml+xml" : extension === "html" || extension === "htm" ? "text/html" : "application/octet-stream";
}
function compactTitle(value: string): string { return value.replace(/\s+/g, "").trim(); }
function localStamp(record: Pick<ResearchAnnouncementRecord, "publishedAt">) {
  const taiwan = new Date(Date.parse(record.publishedAt) + 8 * 3_600_000).toISOString();
  return { day: taiwan.slice(0, 10), clock: taiwan.slice(11, 19) };
}
function dateMatches(raw: string, isoDate: string): boolean { return parseTaiwanOfficialDate(raw.replaceAll("/", "")) === isoDate; }
function publicationClockMatches(raw: string, record: ResearchAnnouncementRecord): boolean {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw.trim())
    ?? /^(\d{2})(\d{2})$/.exec(raw.trim()) ?? /^(\d{1,2})(\d{2})(\d{2})$/.exec(raw.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[3] !== undefined && Number(match[3]) > 59)) return false;
  const clock = `${match[1]!.padStart(2, "0")}:${match[2]}`;
  const retainedClock = localStamp(record).clock;
  if (record.publicationPrecision === "minute") return clock === retainedClock.slice(0, 5);
  if (record.publicationPrecision === "date") return false; // No date-only detail producer is supported.
  return match[3] !== undefined && `${clock}:${match[3]}` === retainedClock;
}
function expectedMarket(record: ResearchAnnouncementRecord) { return record.venue === "TWSE" ? "sii" : "otc"; }
function assertMarket(marketName: string, record: ResearchAnnouncementRecord) {
  if (marketName !== (record.venue === "TWSE" ? "上市公司" : "上櫃公司")) throw new Error("detail_market_mismatch");
}

export function selectOfficialAnnouncementDetailParameters(payload: unknown, record: ResearchAnnouncementRecord): OfficialAnnouncementDetailParameters {
  const response = historySchema.parse(payload);
  const stamp = localStamp(record);
  assertMarket(response.result.marketName, record);
  if (response.result.companyId !== record.ticker) throw new Error("detail_subject_mismatch");
  const matches = response.result.data.filter((row) => row[0] === record.ticker
    && dateMatches(row[2], stamp.day) && publicationClockMatches(row[3], record) && compactTitle(row[4]) === compactTitle(record.subject));
  if (matches.length !== 1) throw new Error("detail_reference_unresolved");
  const parameters = matches[0]![5].parameters;
  if (parameters.companyId !== record.ticker || parameters.marketKind !== expectedMarket(record)
    || !dateMatches(parameters.enterDate, stamp.day)) throw new Error("detail_reference_mismatch");
  return parameters;
}

function announcementNoticeKind(subject: string): "corrects" | "retracts" | null {
  const notice = /^(?:公告|代(?:重要)?子公司(?:(?!公告)[^。！？；：.!?;:\r\n\u2028\u2029]){0,120}公告)?(更正|撤回|撤銷)/u.exec(subject.trim());
  return notice ? notice[1] === "更正" ? "corrects" : "retracts" : null;
}

function relationFromPublisherText(record: ResearchAnnouncementRecord, previousRecords: readonly ResearchAnnouncementMetadata[]) {
  // Require an explicit correction/retraction notice plus both a complete cited title
  // and its publication date. Shared keywords or coincident event dates never link facts.
  const kind = announcementNoticeKind(record.subject);
  if (!kind) return { relations: record.relations, unresolved: false, unresolvedRelations: record.unresolvedRelations ?? [], unknownRelationTargets: record.unknownRelationTargets ?? [] };
  const selectors = announcementCitationSelectors(record);
  const matches = previousRecords.filter((prior) => {
    if (prior.id === record.id || prior.issuerId !== record.issuerId || prior.listingId !== record.listingId || prior.venue !== record.venue || prior.publishedAt >= record.publishedAt) return false;
    return selectors.titles.includes(compactTitle(prior.subject)) && selectors.days.includes(localStamp(prior).day);
  });
  const unresolvedRelations = (record.unresolvedRelations ?? []).filter((relation) => relation.kind !== kind);
  const unknownRelationTargets = (record.unknownRelationTargets ?? []).filter((relation) => relation.kind !== kind);
  if (matches.length !== 1) return { relations: record.relations, unresolved: true, unresolvedRelations: matches.length > 1
    ? [...unresolvedRelations, { kind, candidateAnnouncementIds: [...new Set(matches.map((match) => match.id))].sort() }] : unresolvedRelations, unknownRelationTargets: matches.length === 0 ? [...unknownRelationTargets, { kind }] : unknownRelationTargets };
  const relation = { kind, targetAnnouncementId: matches[0]!.id };
  return { relations: [...record.relations.filter((old) => old.kind !== kind || old.targetAnnouncementId !== relation.targetAnnouncementId), relation], unresolved: false, unresolvedRelations, unknownRelationTargets };
}

export function parseOfficialAnnouncementDetail(
  payload: unknown,
  record: ResearchAnnouncementRecord,
  metadata: { contentHash: string; retrievedAt: string },
  previousRecords: readonly ResearchAnnouncementMetadata[] = [],
): AnnouncementEnrichmentResult {
  const response = detailSchema.parse(payload);
  assertMarket(response.result.marketName, record);
  if (response.result.companyId !== record.ticker) throw new Error("detail_subject_mismatch");
  const row = response.result.data[0]!;
  if (row.length !== response.result.titles.length) throw new Error("detail_columns_mismatch");
  const values = new Map(response.result.titles.map((title, index) => [title.main.trim(), row[index]]));
  function field(name: string) {
    const value = values.get(name);
    if (typeof value !== "string") throw new Error("detail_required_field_missing");
    return value.trim();
  }
  const stamp = localStamp(record);
  if (!dateMatches(field("發言日期"), stamp.day) || !publicationClockMatches(field("發言時間"), record)
    || compactTitle(field("主旨")) !== compactTitle(record.subject)) throw new Error("detail_observation_mismatch");
  const attachments = [...record.attachments];
  for (const [index, value] of row.entries()) {
    // MOPS's own detail renderer uses {url,fileName} cells for downloadable files.
    if (typeof value !== "object" || value === null || !("url" in value) || !("fileName" in value)) continue;
    const cell = value as { url: unknown; fileName: unknown };
    if (typeof cell.url !== "string" || typeof cell.fileName !== "string") throw new Error("detail_attachment_invalid");
    const url = new URL(cell.url, MOPS_ANNOUNCEMENT_DETAIL_URL).toString();
    if (!safeDisclosureUrl(url)) throw new Error("detail_attachment_source_not_permitted");
    if (attachments.some((attachment) => attachment.sourceUrl === url)) continue;
    attachments.push({ id: disclosureId("att", record.id, String(index), url), artifactId: disclosureId("art", record.id, url),
      title: cell.fileName, sourceUrl: url, mediaType: attachmentMediaType(url, cell.fileName) });
  }
  const rawEventDate = typeof values.get("事實發生日") === "string" ? values.get("事實發生日") as string : undefined;
  const enriched = { ...record, rawEventDate, subject: field("主旨"), ruleClause: field("符合條款"), eventDate: parseOptionalAnnouncementEventDate(rawEventDate?.replaceAll("/", "")),
    explanation: field("說明"), attachments };
  const relation = relationFromPublisherText(enriched, previousRecords);
  const reasons = relation.unresolved ? ["unresolved_correction_reference"] : [];
  const output = researchAnnouncementRecordSchema.parse({ ...enriched, relations: relation.relations, unresolvedRelations: relation.unresolvedRelations, unknownRelationTargets: relation.unknownRelationTargets,
    collectionProvenance: record.collectionProvenance ?? record.provenance,
    detailQuality: { status: "available", reasonCodes: reasons },
    provenance: { ...record.provenance, id: disclosureId("pr", record.id, metadata.contentHash, MOPS_DETAIL_PARSER_VERSION),
      accessProvider: "MOPS_API", sourceUrl: MOPS_ANNOUNCEMENT_DETAIL_URL, contentHash: metadata.contentHash,
      retrievedAt: metadata.retrievedAt, processedAt: metadata.retrievedAt, parserVersion: MOPS_DETAIL_PARSER_VERSION },
  });
  return { record: output, detailStatus: "available", reasonCodes: reasons };
}

class DetailAcquisitionError extends Error {
  constructor(readonly status: AnnouncementDetailStatus, readonly safeCode: string) { super(safeCode); }
}
async function readOfficialJson(fetchImpl: typeof fetch, url: string, body: object, signal?: AbortSignal): Promise<{ payload: unknown; hash: string }> {
  let response: Response;
  try {
    response = await fetchImpl(url, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json", Origin: "https://mops.twse.com.tw" },
      body: JSON.stringify(body), redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  } catch { throw new DetailAcquisitionError("unavailable", "detail_source_unavailable"); }
  if (response.status === 401 || response.status === 403 || response.status === 429) throw new DetailAcquisitionError("restricted", "detail_access_restricted");
  if (!response.ok) throw new DetailAcquisitionError("unavailable", "detail_source_unavailable");
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_RESPONSE_BYTES) throw new DetailAcquisitionError("processing_failed", "detail_response_too_large");
  const reader = response.body?.getReader();
  if (!reader) throw new DetailAcquisitionError("processing_failed", "detail_response_invalid");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new DetailAcquisitionError("processing_failed", "detail_response_too_large");
      }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const text = Buffer.concat(chunks).toString("utf8");
  if (isMopsAccessDenial(text)) throw new DetailAcquisitionError("restricted", "detail_access_restricted");
  try { return { payload: JSON.parse(text) as unknown, hash: disclosureHash(text) }; }
  catch { throw new DetailAcquisitionError("processing_failed", "detail_response_invalid"); }
}

/** Internal ingestion only. Public MCP readers never call this network acquisition. */
export async function enrichOfficialAnnouncement(record: ResearchAnnouncementRecord, options: AnnouncementEnrichmentOptions = {}): Promise<AnnouncementEnrichmentResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const stamp = localStamp(record);
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  try {
    options.signal?.throwIfAborted();
    const history = await readOfficialJson(fetchImpl, MOPS_ANNOUNCEMENT_HISTORY_URL, {
      companyId: record.ticker, year: String(Number(stamp.day.slice(0, 4)) - 1911), month: String(Number(stamp.day.slice(5, 7))),
      firstDay: String(Number(stamp.day.slice(8, 10))), lastDay: String(Number(stamp.day.slice(8, 10))),
    }, options.signal);
    options.signal?.throwIfAborted();
    const parameters = selectOfficialAnnouncementDetailParameters(history.payload, record);
    const detail = await readOfficialJson(fetchImpl, MOPS_ANNOUNCEMENT_DETAIL_URL, parameters, options.signal);
    options.signal?.throwIfAborted();
    const metadata = { contentHash: detail.hash, retrievedAt };
    const result = parseOfficialAnnouncementDetail(detail.payload, record, metadata, options.previousRecords);
    if (!options.resolvePreviousRecords) return result;
    const previousRecords = await options.resolvePreviousRecords(result.record);
    return previousRecords.length ? parseOfficialAnnouncementDetail(detail.payload, record, metadata, previousRecords) : result;
  } catch (error) {
    options.signal?.throwIfAborted();
    const status = error instanceof DetailAcquisitionError ? error.status : "processing_failed";
    const reason = error instanceof DetailAcquisitionError ? error.safeCode : "detail_evidence_unresolved";
    // The official snapshot independently contains publisher explanation text.
    // A failed detail request cannot erase an exact correction citation in it.
    const previousRecords = options.resolvePreviousRecords ? await options.resolvePreviousRecords(record) : options.previousRecords ?? [];
    options.signal?.throwIfAborted();
    const relation = relationFromPublisherText(record, previousRecords);
    const reasonCodes = [reason, ...(relation.unresolved ? ["unresolved_correction_reference"] : [])];
    return { record: { ...record, relations: relation.relations, unresolvedRelations: relation.unresolvedRelations, unknownRelationTargets: relation.unknownRelationTargets, detailQuality: { status, reasonCodes } }, detailStatus: status, reasonCodes };
  }
}

/** Exact publisher citation selectors; final relation verification remains in the parser. */
export function announcementCitationSelectors(record: ResearchAnnouncementRecord): { titles: string[]; days: string[] } {
  if (!announcementNoticeKind(record.subject)) return { titles: [], days: [] };
  const explanation = compactTitle(record.explanation);
  const titles = [...explanation.matchAll(/「([^」]+)」|"([^"]+)"/g)].map((match) => compactTitle(match[1] ?? match[2]!));
  const days = [...explanation.matchAll(/(?<!\d)(\d{3,4})(?:([/-])(\d{1,2})\2(\d{1,2})|年(\d{1,2})月(\d{1,2})日?)(?!\d)/g)].map((match) => {
    const year = Number(match[1]) + (match[1]!.length === 3 ? 1911 : 0);
    const month = match[3] ?? match[5]!;
    const day = match[4] ?? match[6]!;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  });
  return { titles: [...new Set(titles.filter(Boolean))], days: [...new Set(days.filter((day) => Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day))] };
}
