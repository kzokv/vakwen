import { createHash } from "node:crypto";
import { z } from "zod";
import { isCredentialFreeDisclosureUrl } from "../disclosureSourceUrl.js";
import type { ResearchIdentityRecord } from "../identity.js";
import { researchAnnouncementRecordSchema, type ResearchAnnouncementRecord, type ResearchDisclosureArtifact } from "../disclosureContracts.js";
import { parseTaiwanOfficialDate } from "./twseIdentity.js";

export const OFFICIAL_ANNOUNCEMENT_SOURCES = {
  TWSE: "https://openapi.twse.com.tw/v1/opendata/t187ap04_L",
  TPEX: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap04_O",
} as const;
export const DISCLOSURE_PARSER_VERSION = "mops-announcements/1.0.4";
export function disclosureId(prefix: string, ...parts: string[]) { return `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32)}`; }
export function disclosureHash(value: string | Uint8Array) { return createHash("sha256").update(value).digest("hex"); }
export function safeDisclosureUrl(value: string): boolean {
  try { const url = new URL(value); return isCredentialFreeDisclosureUrl(value)
    && ["mops.twse.com.tw", "mopsov.twse.com.tw", "mopsws.twse.com.tw", "openapi.twse.com.tw", "www.twse.com.tw", "www.tpex.org.tw"].includes(url.hostname); } catch { return false; }
}
const rowSchema = z.object({ 公司代號: z.string(), 發言日期: z.string(), 發言時間: z.string(), 主旨: z.string(), 符合條款: z.string(), 事實發生日: z.string().nullish(), 說明: z.string() }).passthrough();
export interface AnnouncementSnapshotMetadata { retrievedAt: string; contentHash: string; sourceUrl: string; acquisitionRunId: string }
export function parseOptionalAnnouncementEventDate(value: string | null | undefined): string | null {
  if (value == null) return null;
  try { return parseTaiwanOfficialDate(value); } catch { return null; }
}
/** Explicit source clock grammar; compact three/four digits are minute-only. */
export function parseOfficialAnnouncementClock(timeValue: string) {
  const raw = timeValue.trim();
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(raw)
    ?? /^(\d{1,2})(\d{2})$/.exec(raw) ?? /^(\d{1,2})(\d{2})(\d{2})$/.exec(raw);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || (match[3] !== undefined && Number(match[3]) > 59)) throw new Error("announcement_publication_time_invalid");
  return { clock: `${match[1]!.padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`, precision: match[3] === undefined ? "minute" as const : "second" as const };
}
function publication(dateValue: string, timeValue: string) {
  const date = parseTaiwanOfficialDate(dateValue);
  if (!date) throw new Error("announcement_publication_date_invalid");
  const parsed = parseOfficialAnnouncementClock(timeValue);
  return { publishedAt: new Date(`${date}T${parsed.clock}+08:00`).toISOString(), precision: parsed.precision };
}
export function parseOfficialAnnouncementSnapshot(payload: unknown, metadata: AnnouncementSnapshotMetadata, venue: "TWSE" | "TPEX", identities: readonly ResearchIdentityRecord[]): ResearchAnnouncementRecord[] {
  const rows = z.array(z.record(z.string(), z.unknown())).parse(payload);
  return rows.flatMap((raw) => {
    const ticker = z.string().trim().regex(/^[A-Za-z0-9]+$/).parse(raw.公司代號 ?? raw.SecuritiesCompanyCode);
    const issuerListings = identities.filter((identity) => identity.listing.venue === venue && identity.listing.ticker === ticker);
    // A board feed can contain instruments absent from the retained identity catalog.
    // Do not attribute their records or let their unrelated content block known issuers.
    if (issuerListings.length === 0) return [];
    const row = rowSchema.parse({ ...raw, 公司代號: ticker, 主旨: raw.主旨 ?? raw["主旨 "] });
    // Keep known ineligible listings distinguishable from an unknown subject.
    // Their rows must not poison the collection check for eligible issuers.
    if (issuerListings.length === 1 && issuerListings.every((identity) => identity.security.type !== "common_equity" || identity.eligibility.profile !== "operating_company" || identity.eligibility.state !== "eligible")) return [];
    const stamp = publication(row.發言日期, row.發言時間);
    const day = parseTaiwanOfficialDate(row.發言日期)!;
    const candidates = issuerListings.filter((identity) => identity.listing.listedAt <= day && (!identity.listing.inactiveAt || identity.listing.inactiveAt > day));
    if (candidates.length !== 1) throw new Error("announcement_identity_unresolved");
    const identity = candidates[0]!;
    if (identity.security.type !== "common_equity" || identity.eligibility.profile !== "operating_company" || identity.eligibility.state !== "eligible") return [];
    const officialUrl = typeof row.網址 === "string" && safeDisclosureUrl(row.網址) ? row.網址 : metadata.sourceUrl;
    const attachmentSources = Array.isArray(row.附件) ? row.附件.flatMap((item) => {
      if (typeof item !== "object" || item === null) return [];
      const attachment = item as Record<string, unknown>;
      if (typeof attachment.url !== "string" || !safeDisclosureUrl(attachment.url)) return [];
      return [{ title: typeof attachment.title === "string" ? attachment.title : "官方附件", sourceUrl: attachment.url,
        mediaType: typeof attachment.mediaType === "string" ? attachment.mediaType : "application/octet-stream" }];
    }) : [];
    // Bind every retained source field, not merely title/text. Cached enrichment
    // is reusable only for the same complete snapshot observation.
    const id = disclosureId("ann", JSON.stringify({ issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: identity.listing.ticker, venue,
      publishedAt: stamp.publishedAt, publicationPrecision: stamp.precision, rawPublication: { date: row.發言日期, time: row.發言時間 },
      subject: row.主旨, ruleClause: row.符合條款, eventDate: parseOptionalAnnouncementEventDate(row.事實發生日), rawEventDate: row.事實發生日 ?? null,
      explanation: row.說明, sourceUrl: officialUrl, attachments: attachmentSources }));
    const attachments: ResearchAnnouncementRecord["attachments"] = attachmentSources.map((attachment, index) => ({ ...attachment,
      id: disclosureId("att", id, String(index)), artifactId: disclosureId("art", id, attachment.sourceUrl) }));
    // The issuer-authored explanation is also retained as bounded pages so inline
    // truncation never prevents inspection of its original contents.
    attachments.push({ id: disclosureId("att", id, "explanation"), artifactId: disclosureId("art", id, "explanation"), title: "發行人說明原文", sourceUrl: officialUrl, mediaType: "text/plain" });
    return [researchAnnouncementRecordSchema.parse({ id, issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: identity.listing.ticker, venue,
      rawPublication: { date: row.發言日期, time: row.發言時間 }, rawEventDate: row.事實發生日 ?? undefined, publishedAt: stamp.publishedAt, publicationPrecision: stamp.precision, subject: row.主旨, ruleClause: row.符合條款, eventDate: parseOptionalAnnouncementEventDate(row.事實發生日),
      explanation: row.說明, sourceUrl: officialUrl, attachments, relations: [], quality: "available",
      provenance: { id: disclosureId("pr", id, metadata.contentHash, DISCLOSURE_PARSER_VERSION), publisher: "MOPS", accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI", authorityRole: "authoritative", sourceUrl: metadata.sourceUrl, contentHash: metadata.contentHash,
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
