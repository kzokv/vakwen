import { createHash } from "node:crypto";
import { z } from "zod";
import type { ResearchIdentityRecord } from "../identity.js";
import { researchAnnouncementRecordSchema, type ResearchAnnouncementRecord, type ResearchDisclosureArtifact } from "../disclosureContracts.js";
import { parseTaiwanOfficialDate } from "./twseIdentity.js";

export const OFFICIAL_ANNOUNCEMENT_SOURCES = {
  TWSE: "https://openapi.twse.com.tw/v1/opendata/t187ap04_L",
  TPEX: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O",
} as const;
export const DISCLOSURE_PARSER_VERSION = "mops-announcements/1.0.0";
export function disclosureId(prefix: string, ...parts: string[]) { return `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32)}`; }
export function disclosureHash(value: string) { return createHash("sha256").update(value).digest("hex"); }
export function safeDisclosureUrl(value: string): boolean {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !/[?&](?:token|key|secret|signature|auth)=/i.test(url.search)
    && ["mops.twse.com.tw", "mopsov.twse.com.tw", "mopsws.twse.com.tw", "openapi.twse.com.tw", "www.twse.com.tw", "www.tpex.org.tw"].includes(url.hostname); } catch { return false; }
}
const rowSchema = z.object({ 公司代號: z.string(), 發言日期: z.string(), 發言時間: z.string(), 主旨: z.string(), 符合條款: z.string(), 事實發生日: z.string(), 說明: z.string() }).passthrough();
export interface AnnouncementSnapshotMetadata { retrievedAt: string; contentHash: string; sourceUrl: string; acquisitionRunId: string }
function publication(dateValue: string, timeValue: string) {
  const date = parseTaiwanOfficialDate(dateValue);
  if (!date) throw new Error("announcement_publication_date_invalid");
  const raw = timeValue.trim();
  const minutePrecision = /^\d{2}:\d{2}$/.test(raw) || /^\d{4}$/.test(raw);
  const compact = minutePrecision ? raw.replaceAll(":", "") : raw.replaceAll(":", "").padStart(6, "0");
  if (!/^\d{4}(\d{2})?$/.test(compact)) throw new Error("announcement_publication_time_invalid");
  const hour = compact.slice(0,2), minute = compact.slice(2,4), second = compact.slice(4,6) || "00";
  if (+hour > 23 || +minute > 59 || +second > 59) throw new Error("announcement_publication_time_invalid");
  return { publishedAt: new Date(`${date}T${hour}:${minute}:${second}+08:00`).toISOString(), precision: compact.length === 6 ? "second" as const : "minute" as const };
}
export function parseOfficialAnnouncementSnapshot(payload: unknown, metadata: AnnouncementSnapshotMetadata, venue: "TWSE" | "TPEX", identities: readonly ResearchIdentityRecord[]): ResearchAnnouncementRecord[] {
  const rows = z.array(z.record(z.string(), z.unknown())).parse(payload).map((raw) => rowSchema.parse({ ...raw, 公司代號: raw.公司代號 ?? raw.SecuritiesCompanyCode, 主旨: raw.主旨 ?? raw["主旨 "] }));
  return rows.flatMap((row) => {
    const stamp = publication(row.發言日期, row.發言時間);
    const day = parseTaiwanOfficialDate(row.發言日期)!;
    const candidates = identities.filter((identity) => identity.listing.venue === venue && identity.listing.ticker === row.公司代號.trim()
      && identity.listing.listedAt <= day && (!identity.listing.inactiveAt || identity.listing.inactiveAt >= day));
    if (candidates.length !== 1) throw new Error("announcement_identity_unresolved");
    const identity = candidates[0]!;
    if (identity.security.type !== "common_equity" || identity.eligibility.profile !== "operating_company") return [];
    const id = disclosureId("ann", identity.issuer.id, venue, stamp.publishedAt, row.主旨, row.說明);
    const officialUrl = typeof row.網址 === "string" && safeDisclosureUrl(row.網址) ? row.網址 : metadata.sourceUrl;
    const attachments: ResearchAnnouncementRecord["attachments"] = [];
    if (Array.isArray(row.附件)) for (const [index, item] of row.附件.entries()) {
      if (typeof item !== "object" || item === null) continue;
      const attachment = item as Record<string, unknown>;
      if (typeof attachment.url !== "string" || !safeDisclosureUrl(attachment.url)) continue;
      attachments.push({ id: disclosureId("att", id, String(index)), artifactId: disclosureId("art", id, attachment.url), title: typeof attachment.title === "string" ? attachment.title : "官方附件", sourceUrl: attachment.url, mediaType: typeof attachment.mediaType === "string" ? attachment.mediaType : "application/octet-stream" });
    }
    // The issuer-authored explanation is also retained as bounded pages so inline
    // truncation never prevents inspection of its original contents.
    attachments.push({ id: disclosureId("att", id, "explanation"), artifactId: disclosureId("art", id, "explanation"), title: "發行人說明原文", sourceUrl: officialUrl, mediaType: "text/plain" });
    return [researchAnnouncementRecordSchema.parse({ id, issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: identity.listing.ticker, venue,
      rawPublication: { date: row.發言日期, time: row.發言時間 }, rawEventDate: row.事實發生日, publishedAt: stamp.publishedAt, publicationPrecision: stamp.precision, subject: row.主旨, ruleClause: row.符合條款, eventDate: parseTaiwanOfficialDate(row.事實發生日) ?? null,
      explanation: row.說明, sourceUrl: officialUrl, attachments, relations: [], quality: "available",
      provenance: { id: disclosureId("pr", id, metadata.contentHash), publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative", sourceUrl: metadata.sourceUrl, contentHash: metadata.contentHash,
        retrievedAt: metadata.retrievedAt, processedAt: metadata.retrievedAt, acquisitionRunId: metadata.acquisitionRunId, parserVersion: DISCLOSURE_PARSER_VERSION, usagePolicyVersion: "taiwan-open-data/1.0.0" },
    })];
  });
}
export function retainAnnouncementExplanation(record: ResearchAnnouncementRecord): ResearchDisclosureArtifact {
  const attachment = record.attachments.find((item) => item.id === disclosureId("att", record.id, "explanation"))!;
  const chars = Array.from(record.explanation);
  const totalPages = Math.max(1, Math.ceil(chars.length / 10_000));
  return { id: attachment.artifactId!, issuerId: record.issuerId, contentHash: disclosureHash(record.explanation), extractionVersion: DISCLOSURE_PARSER_VERSION,
    publishedAt: record.publishedAt, sourceUrl: attachment.sourceUrl, mediaType: "text/plain", reference: { kind: "announcement_attachment", id: record.id }, state: record.quality,
    totalPages, blocks: Array.from({ length: totalPages }, (_, i) => ({ id: disclosureId("blk", attachment.artifactId!, String(i)), page: i + 1, table: null, text: chars.slice(i * 10_000, (i + 1) * 10_000).join(""), extractionState: "retained_text", subject: record.issuerId, period: null, unit: null })), verifiedClaims: [], parentProvenance: record.provenance,
    provenance: { ...record.provenance, id: disclosureId("pr", attachment.artifactId!, disclosureHash(record.explanation)), sourceUrl: attachment.sourceUrl, contentHash: disclosureHash(record.explanation), parserVersion: DISCLOSURE_PARSER_VERSION } };
}
