import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { extractDisclosureContent } from "../../src/services/research/providers/disclosureExtraction.js";
import { getDisclosureArtifact, listMaterialAnnouncements } from "../../src/services/research/disclosures.js";
import { getResearchIdentity } from "../../src/services/research/service.js";
import { composeFocusedDisclosureResearchReport, renderFocusedDisclosureResearchReportMarkdown } from "../../src/services/research/disclosureReport.js";
import type { ResearchAnnouncementRecord, ResearchDisclosureArtifact } from "../../src/services/research/disclosureContracts.js";

// Genuine PDF page objects and xref offsets; second-page operators vary without mocking PDF.js.
function pdfWithSecondPage(stream: string): Uint8Array {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["BT /F1 12 Tf 40 700 Td (Revenue 100 TWD) Tj ET", stream].map((text) => `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(pdf));
}

async function fixture(bytes: Uint8Array, mediaType: string) {
  const persistence = new MemoryPersistence();
  const identity = canonicalizeOfficialIdentityRow({ venue: "TWSE", snapshotDate: "2026-08-31", retrievedAt: "2026-08-31T00:00:00.000Z",
    artifact: { contentHash: "extraction-fixture", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
    row: { kind: "company", ticker: "2330", legalName: "研究公司", displayName: "研究公司", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "2000-01-01" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const context = { knowledgeAt: "2026-09-02T02:00:00.000Z", effectiveAt: "2026-09-02T02:00:00.000Z", assessmentMode: "effective" as const };
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const hash = createHash("sha256").update(bytes).digest("hex");
  const provenance: ResearchAnnouncementRecord["provenance"] = { id: "extraction_provenance", publisher: "MOPS", accessProvider: "TWSE_OPENAPI", authorityRole: "authoritative",
    sourceUrl: "https://mops.twse.com.tw/retained", contentHash: hash, retrievedAt: "2026-09-02T01:59:00.000Z", processedAt: "2026-09-02T01:59:00.000Z", acquisitionRunId: "extraction_run", parserVersion: "disclosures/1.0.0", usagePolicyVersion: "taiwan-open-data/1.0.0" };
  const announcement: ResearchAnnouncementRecord = { id: "extraction_parent", issuerId: identity.issuer.id, listingId: identity.listing.id, ticker: identity.listing.ticker, venue: "TWSE",
    publishedAt: "2026-09-01T01:00:00.000Z", publicationPrecision: "second", subject: "重大訊息", ruleClause: "51", eventDate: "2026-09-01", explanation: "官方已公告財務資訊。",
    sourceUrl: provenance.sourceUrl, attachments: [{ id: "attachment", artifactId: "extracted_artifact", title: "附件", sourceUrl: provenance.sourceUrl, mediaType }], relations: [], quality: "available", provenance };
  await persistence.appendResearchAnnouncements([announcement]);
  await persistence.appendResearchDisclosureScans([{ id: "scan", issuerId: identity.issuer.id, listingId: identity.listing.id, venue: "TWSE", checkedAt: context.knowledgeAt,
    publicationStart: "2025-09-02T02:00:00.000Z", publicationEnd: context.knowledgeAt, knowledgeAt: context.knowledgeAt, status: "success", exhaustive: true, provenance }]);
  const extracted = await extractDisclosureContent(bytes, mediaType, identity.issuer.id, "extracted_artifact");
  const artifact: ResearchDisclosureArtifact = { id: "extracted_artifact", issuerId: identity.issuer.id, contentHash: hash, publishedAt: announcement.publishedAt,
    sourceUrl: provenance.sourceUrl, mediaType, reference: { kind: "announcement_attachment", id: announcement.id }, state: "available", retainedBytesBase64: Buffer.from(bytes).toString("base64"), verifiedClaims: [], provenance, ...extracted };
  return { persistence, identity, subject, context, announcement, artifact, extracted };
}

async function readAll(f: Awaited<ReturnType<typeof fixture>>, limit = 2) {
  const pages: Awaited<ReturnType<typeof getDisclosureArtifact>>[] = [];
  let cursor: string | null = null;
  do {
    const page = await getDisclosureArtifact(f.persistence, cursor ? { subject: f.subject, cursor }
      : { subject: f.subject, context: f.context, artifactId: f.artifact.id, limit });
    pages.push(page); cursor = page.page.nextCursor;
    expect(page.page.retainedCharacters).toBeLessThanOrEqual(50_000);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThanOrEqual(255 * 1024);
    expect(page.artifact).not.toHaveProperty("retainedBytesBase64");
  } while (cursor);
  return pages;
}

describe("disclosure extraction through retained public reads", () => {
  it("large Unicode HTML table: extraction and cursor traversal → retain every character and table location", async () => {
    const prefix = "前言😀".repeat(4000);
    const tableText = "財報🚀".repeat(20_000);
    const suffix = "結語🧾".repeat(4000);
    const bytes = new TextEncoder().encode(`<html><body><p>${prefix}</p><table><tr><td>${tableText}</td></tr></table><p>${suffix}</p></body></html>`);
    const f = await fixture(bytes, "text/html");
    expect(f.extracted.totalPages).toBeGreaterThan(1);
    expect(f.extracted).not.toHaveProperty("verifiedClaims");
    expect(f.extracted.blocks.filter((block) => block.table === "table:1").map((block) => block.text).join("")).toBe(tableText);
    expect(new Set(f.extracted.blocks.filter((block) => block.table === "table:1").map((block) => block.page)).size).toBeGreaterThan(1);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact]);
    const pages = await readAll(f);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.flatMap((page) => page.page.returnedPages)).toEqual(Array.from({ length: f.artifact.totalPages }, (_, index) => index + 1));
    expect(pages.flatMap((page) => page.artifact!.blocks)).toMatchObject(f.extracted.blocks);
    expect(pages.flatMap((page) => page.artifact!.blocks).map((block) => block.text).join("")).toBe(prefix + tableText + suffix);
    expect(pages.every((page) => !page.page.pageTruncated && page.artifact!.verifiedClaims.length === 0)).toBe(true);
    expect(new Set(pages.map((page) => page.page.continuity.queryHash)).size).toBe(1);
    const identity = await getResearchIdentity(f.persistence, { subject: f.subject, context: f.context, history: { limit: 1 } });
    const announcements = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context });
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages: [announcements], artifactPages: pages });
    expect(report.reportStatus).toBe("complete");
    expect(report.assessments).toEqual([]);
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
  });
  it.each([
    ["blank", "", true],
    ["nonpainting", "q 1 0 0 1 0 0 cm Q", true],
    ["vector", "0 0 100 100 re f", false],
    ["image", "q 10 0 0 10 0 0 cm BI /W 1 /H 1 /CS /RGB /BPC 8 /F /AHx ID FF0000> EI Q", false],
  ] as const)("PDF text plus %s page: operator evidence → distinguish proven empty from unextracted visual content", async (_kind, stream, confirmedEmpty) => {
    const f = await fixture(pdfWithSecondPage(stream), "application/pdf");
    expect(f.extracted.totalPages).toBe(2);
    expect(f.extracted.blocks.map((block) => [block.page, block.text])).toEqual([[1, "Revenue 100 TWD"]]);
    expect(f.extracted.confirmedEmptyPages?.includes(2) ?? false).toBe(confirmedEmpty);
    expect(f.extracted).not.toHaveProperty("verifiedClaims");
    // Explicit verification is separate from extraction; it cannot create a claim on a blank/visual-only page.
    const block = { ...f.artifact.blocks[0]!, period: "2026", unit: "TWD" };
    const claim: ResearchDisclosureArtifact["verifiedClaims"][number] = { id: "verified_revenue", kind: "source_fact", text: "Revenue 100 TWD", blockIds: [block.id], page: 1,
      table: block.table, subject: f.identity.issuer.id, period: block.period, unit: block.unit, verification: "verified", publisher: "MOPS", verifiedAt: f.context.knowledgeAt };
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, blocks: [block], verifiedClaims: [claim, { ...claim, id: "invalid_page_claim", page: 2 }] }]);
    const pages = await readAll(f, 10);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.page.returnedPages).toEqual([1, 2]);
    expect(page.page.pageTruncated).toBe(!confirmedEmpty);
    expect(page.quality.completeness).toBe(confirmedEmpty ? "complete" : "indeterminate");
    expect(page.quality.readiness.exhaustiveConclusion).toBe(confirmedEmpty ? "ready" : "blocked");
    expect(page.artifact!.verifiedClaims.map((item) => item.id)).toEqual(["verified_revenue"]);
    const identity = await getResearchIdentity(f.persistence, { subject: f.subject, context: f.context, history: { limit: 1 } });
    const announcements = await listMaterialAnnouncements(f.persistence, { subject: f.subject, context: f.context });
    const reference = { kind: "artifact_claim" as const, artifactId: f.artifact.id, claimId: claim.id };
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages: [announcements], artifactPages: pages,
      candidates: [{ id: "revenue", kind: "catalyst", status: "conditional", statement: claim.text, statusEvidence: { reference, excerpt: claim.text },
        triggeringEvidence: [reference], confirmingEvidence: [], disconfirmingEvidence: [], materialMechanism: "Reported revenue informs production assumptions",
        affectedMetricOrAssumption: "revenue", horizon: "2026", condition: "Production continues", confirmationCondition: "Official production disclosure", disconfirmationCondition: "Official cancellation" }] });
    expect(report.assessments[0]!.sourceSupport).toBe(confirmedEmpty ? "supported" : "withheld");
    if (!confirmedEmpty) expect(report.assessments[0]!.reasonCodes).toContain("artifact_claim_page_truncated");
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
  });

});
