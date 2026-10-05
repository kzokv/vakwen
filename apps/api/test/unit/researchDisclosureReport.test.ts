import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { runOfficialDisclosureAcquisition } from "../../src/services/research/disclosureAcquisition.js";
import type { z } from "zod";
import { disclosureCandidateSchema } from "../../src/services/research/disclosureReport.js";

function literalMarkdownText(value: string): string {
  return value.replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

const candidate = {
  id: "capacity", kind: "catalyst", status: "conditional",
  statement: "董事會於2026-10-03決議擴建產能，預計於2027-01-01完工。",
  statusEvidence: { reference: { kind: "announcement", announcementId: "announcement_1" }, excerpt: "董事會於2026-10-03決議擴建產能，預計於2027-01-01完工。" },
  materialMechanism: "Commissioned capacity permits additional production.",
  affectedMetricOrAssumption: "revenue", horizon: "2027",
  triggeringEvidence: [{ kind: "announcement", announcementId: "announcement_1" }],
  confirmingEvidence: [], disconfirmingEvidence: [],
  confirmationCondition: "Official commissioning disclosure", disconfirmationCondition: "Official cancellation",
  condition: "Commissioning completes",
} satisfies z.input<typeof disclosureCandidateSchema>;

const analyticalFields = ["materialMechanism", "affectedMetricOrAssumption", "horizon", "condition", "confirmationCondition", "disconfirmationCondition"] as const;

describe("disclosure specialist candidate contract", () => {
  it("causal candidate: required mechanism and evidence → accepted structured judgment", () => {
    expect(disclosureCandidateSchema.parse(candidate).status).toBe("conditional");
  });
  it("sentiment: unsupported field or missing mechanism → rejected", () => {
    expect(disclosureCandidateSchema.safeParse({ ...candidate, sentiment: "bullish" }).success).toBe(false);
    expect(disclosureCandidateSchema.safeParse({ ...candidate, materialMechanism: "" }).success).toBe(false);
    expect(disclosureCandidateSchema.safeParse({ ...candidate, triggeringEvidence: [] }).success).toBe(false);
  });
  it("issuer operations: sell inventory and hold shipments → preserve business mechanism", () => {
    expect(disclosureCandidateSchema.safeParse({ ...candidate, materialMechanism: "The issuer may sell inventory or hold shipments while capacity is commissioned." }).success).toBe(true);
    expect(disclosureCandidateSchema.safeParse({ ...candidate, materialMechanism: "Investors should buy the stock." }).success).toBe(false);
    expect(disclosureCandidateSchema.safeParse({ ...candidate, materialMechanism: "Bullish investor sentiment." }).success).toBe(false);
  });
  it.each(analyticalFields)("analytical %s: action or sentiment in either language → reject the specific field", (field) => {
    for (const text of ["Investors should buy the stock.", "Bullish investor sentiment.", "建議買進", "看漲",
      "Buy the stock now", "Sell these shares immediately.", "Hold this company's stock.", "Buy TSMC's shares.", "Buy TSMC shares now", "Buy 2330 stock",
      "- Buy the stock now", '"Buy the stock now"', "1. Sell TSMC shares.", "- 請買進股票",
      "I recommend buying shares", "I advise you to purchase shares.", "My advice is to buy stock.",
      "Investors could accumulate shares.", "Confirmation: sell your position.", "You should reduce your holdings.",
      "買進股票", "請賣出這檔股票", "立即持有股份", "建議投資人買入", "推薦加碼股票", "買進台積電股票", "請賣出2330股票"]) {
      const result = disclosureCandidateSchema.safeParse({ ...candidate, [field]: text });
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });
  it("publisher quote: exact source trading instruction → preserve literal evidence separately from analyst prose", () => {
    for (const excerpt of ["Buy the stock now", "建議買入股票"]) expect(disclosureCandidateSchema.safeParse({ ...candidate,
      statement: excerpt, statusEvidence: { ...candidate.statusEvidence, excerpt } }).success).toBe(true);
  });
  it("candidate identifier: prose or Markdown instruction → reject identifier misuse", () => {
    for (const id of ["Investors should buy the stock", "建議買進", "[advice](https://example.com)"]) {
      expect(disclosureCandidateSchema.safeParse({ ...candidate, id }).success).toBe(false);
    }
    expect(disclosureCandidateSchema.safeParse({ ...candidate, id: "capacity_phase-2" }).success).toBe(true);
  });
  it("conditional judgment: missing condition → rejected", () => {
    expect(disclosureCandidateSchema.safeParse({ ...candidate, condition: undefined }).success).toBe(false);
  });
});

import { beforeEach, afterEach } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { setResearchRolloutOverrideForTest } from "../../src/services/research/rollout.js";
import { getResearchIdentity } from "../../src/services/research/service.js";
import { listMaterialAnnouncements, getDisclosureArtifact } from "../../src/services/research/disclosures.js";
import { buildFocusedDisclosureResearchReport, composeFocusedDisclosureResearchReport, renderFocusedDisclosureResearchReportMarkdown } from "../../src/services/research/disclosureReport.js";
import type { ResearchAnnouncementRecord, ResearchDisclosureArtifact, ResearchDisclosureScan } from "../../src/services/research/disclosureContracts.js";

const context = { knowledgeAt: "2026-10-04T04:00:00.000Z", effectiveAt: "2026-10-04T04:00:00.000Z", assessmentMode: "effective" as const };
async function fixture(venue: "TWSE" | "TPEX" = "TWSE") {
  const persistence = new MemoryPersistence();
  const record = canonicalizeOfficialIdentityRow({
    venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T02:00:00.000Z",
    artifact: { contentHash: "sha256:disclosure-report", sourceUrl: venue === "TWSE" ? "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" : "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
    row: { kind: "company", ticker: venue === "TWSE" ? "2330" : "6488", legalName: "研究測試股份有限公司", displayName: "研究測試", unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "2000-01-01" },
  });
  await persistence.appendResearchIdentityRecords([record]);
  const query = { subject: { kind: "listing_id" as const, listingId: record.listing.id }, context };
  const provenance = {
    id: "provenance_1", publisher: "MOPS" as const, accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" as const : "TPEX_OPENAPI" as const,
    authorityRole: "authoritative" as const, sourceUrl: "https://mops.twse.com.tw/mops/web/t05st01", contentHash: "a".repeat(64),
    retrievedAt: "2026-10-04T03:50:00.000Z", processedAt: "2026-10-04T03:50:01.000Z", acquisitionRunId: "run_1",
    parserVersion: "mops-disclosure/1", usagePolicyVersion: "taiwan-open-data/1.0.0" as const,
  };
  const announcement: ResearchAnnouncementRecord = {
    id: "announcement_1", issuerId: record.issuer.id, listingId: record.listing.id, ticker: record.listing.ticker, venue,
    publishedAt: "2026-10-04T02:00:00.000Z", publicationPrecision: "second", subject: "董事會決議擴建產能", ruleClause: "第20款",
    eventDate: "2026-10-03", explanation: "董事會於2026-10-03決議擴建產能，預計於2027-01-01完工。", sourceUrl: provenance.sourceUrl,
    attachments: [{ id: "attachment_1", artifactId: "artifact_1", title: "補充說明", sourceUrl: provenance.sourceUrl, mediaType: "application/pdf" }],
    relations: [], quality: "available", provenance,
  };
  const artifact: ResearchDisclosureArtifact = {
    id: "artifact_1", issuerId: record.issuer.id, contentHash: "a".repeat(64), extractionVersion: "extract/1", publishedAt: announcement.publishedAt,
    sourceUrl: provenance.sourceUrl, mediaType: "application/pdf", reference: { kind: "announcement_attachment", id: announcement.id },
    state: "available", totalPages: 1,
    blocks: [{ id: "block_1", page: 1, table: "capacity", text: "2027 capacity 100 units", extractionState: "retained_text", subject: record.issuer.id, period: "2027", unit: "units" }],
    verifiedClaims: [{ id: "claim_1", kind: "source_fact", text: "Planned capacity is 100 units", blockIds: ["block_1"], page: 1, table: "capacity", subject: record.issuer.id, period: "2027", unit: "units", verification: "verified", publisher: "MOPS", verifiedAt: "2026-10-04T03:55:00.000Z" }], provenance,
  };
  const scan: ResearchDisclosureScan = {
    id: "scan_1", listingId: record.listing.id, issuerId: record.issuer.id, venue, checkedAt: "2026-10-04T03:50:00.000Z",
    publicationStart: "2025-10-04T04:00:00.000Z", publicationEnd: context.effectiveAt, knowledgeAt: context.knowledgeAt,
    status: "success", exhaustive: true, provenance,
  };
  return { persistence, query, record, announcement, artifact, scan };
}
async function seeded(venue: "TWSE" | "TPEX" = "TWSE") {
  const f = await fixture(venue);
  await f.persistence.appendResearchAnnouncements([f.announcement]);
  await f.persistence.appendResearchDisclosureArtifacts([f.artifact]);
  await f.persistence.appendResearchDisclosureScans([f.scan]);
  return f;
}
async function paginatedFixture(artifactOrder: "asc" | "desc" = "asc") {
  const f = await fixture();
  await f.persistence.appendResearchAnnouncements([f.announcement,
    { ...f.announcement, id: "announcement_2" }, { ...f.announcement, id: "announcement_3" }]);
  await f.persistence.appendResearchDisclosureScans([f.scan]);
  await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, totalPages: 3,
    blocks: [1, 2, 3].map((page) => ({ ...f.artifact.blocks[0]!, id: `block_${page}`, page })) }]);
  const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
  const announcementPages: Awaited<ReturnType<typeof listMaterialAnnouncements>>[] = [];
  const artifactPages: Awaited<ReturnType<typeof getDisclosureArtifact>>[] = [];
  let cursor: string | null = null;
  do {
    const page = await listMaterialAnnouncements(f.persistence, cursor ? { subject: f.query.subject, cursor }
      : { ...f.query, limit: 1, range: { publishedFrom: f.scan.publicationStart, publishedTo: f.scan.publicationEnd } });
    announcementPages.push(page);
    cursor = page.page.nextCursor;
  } while (cursor);
  do {
    const page = await getDisclosureArtifact(f.persistence, cursor ? { subject: f.query.subject, cursor }
      : { ...f.query, artifactId: f.artifact.id, limit: 1, order: artifactOrder });
    artifactPages.push(page);
    cursor = page.page.nextCursor;
  } while (cursor);
  return { ...f, identity, announcementPages, artifactPages };
}
const artifactCandidate = { ...candidate, id: "artifact_dependent", statement: "Planned capacity is 100 units",
  statusEvidence: { reference: { kind: "artifact_claim" as const, artifactId: "artifact_1", claimId: "claim_1" }, excerpt: "Planned capacity is 100 units" }, triggeringEvidence: [{ kind: "artifact_claim" as const, artifactId: "artifact_1", claimId: "claim_1" }] };

describe("focused disclosure report", () => {
  beforeEach(() => setResearchRolloutOverrideForTest({ skillExposureEnabled: true, mcpExposureEnabled: true }));
  afterEach(() => setResearchRolloutOverrideForTest(null));
  it.each(["TWSE", "TPEX"] as const)("%s issuer: retained official evidence → independent classifications and faithful rendering", async (venue) => {
    const f = await fixture(venue);
    f.announcement.explanation = f.announcement.explanation.replace("，", "。");
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const candidates = (["observed", "scheduled", "conditional", "speculative"] as const).map((status) => {
      const excerpt = status === "observed" ? "董事會於2026-10-03決議擴建產能" : f.announcement.explanation;
      return { ...candidate, id: status, status, statement: excerpt, statusEvidence: { ...candidate.statusEvidence, excerpt,
        ...(["observed", "scheduled"].includes(status) ? { eventDate: status === "observed" ? "2026-10-03" : "2027-01-01", eventDateText: status === "observed" ? "2026-10-03" : "2027-01-01" } : {}) } };
    });
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates, readBudget: 10 });
    expect(report.identity.listing.venue).toBe(venue);
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "provisional", "provisional", "provisional"]);
    expect(report.officialScanGate.status).toBe("passed");
    expect(report.finalRecommendation.state).toBe("not_requested");
    expect(report.window.exhaustive).toBe(false);
    const markdown = renderFocusedDisclosureResearchReportMarkdown(report);
    expect(markdown).toContain(f.announcement.subject);
    expect(markdown).toContain("conditional / provisional");
    expect(markdown).toContain("speculative / provisional");
    expect(markdown).not.toMatch(/bullish|bearish|buy|sell/i);
  });
  it.each(analyticalFields)("analytical %s: business sale/holding conditions in either language → preserve permitted report prose", async (field) => {
    const f = await seeded();
    for (const text of ["The issuer may sell inventory or hold shipments until commissioning completes.", "公司出售庫存或暫停出貨，待產能驗收完成後確認營收。",
      "The issuer will buy back shares under the approved repurchase program.",
      "The company may sell treasury shares to finance capacity.",
      "The issuer plans to purchase shares in its subsidiary to consolidate control.",
      "Holding shares reduces public float.", "The issuer is acquiring a business to expand capacity.",
      "公司買回股份以執行庫藏股計畫。", "公司收購企業以擴充產能。"]) {
      const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, [field]: text }], readBudget: 10 });
      expect(report.assessments[0]!.sourceSupport).toBe("supported");
      for (const locale of ["en", "zh-TW"] as const) {
        expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, locale))).toContain(text);
      }
      report.assessments[0]!.candidate[field] = "Investors should buy the stock.";
      for (const locale of ["en", "zh-TW"] as const) {
        expect(() => renderFocusedDisclosureResearchReportMarkdown(report, locale)).toThrow();
      }
    }
  });
  it("standard window: twelve-month complete scan → exhaustive evidence window without final recommendation", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "standard", readBudget: 10 });
    expect(report.window.publishedFrom).toBe("2025-10-04T04:00:00.000Z");
    expect(report.window.exhaustive).toBe(true);
    expect(report.finalRecommendation.state).toBe("not_requested");
  });
  it.each([
    ["2026-10-31T12:34:56.789Z", 13, "2025-09-30T12:34:56.789Z"],
    ["2028-03-31T12:34:56.789Z", 13, "2027-02-28T12:34:56.789Z"],
    ["2029-03-31T12:34:56.789Z", 13, "2028-02-29T12:34:56.789Z"],
    ["2028-02-29T12:34:56.789Z", 12, "2027-02-28T12:34:56.789Z"],
  ] as const)("calendar window %s minus %s months: clamp end of month → preserve precise time and require full coverage", async (effectiveAt, months, expectedStart) => {
    const f = await fixture();
    const query = { ...f.query, context: { ...context, effectiveAt, knowledgeAt: effectiveAt } };
    const extension = months > 12 ? { months, reason: "litigation" as const, thesisItem: "Unresolved litigation" } : undefined;
    await f.persistence.appendResearchDisclosureScans([{ ...f.scan, checkedAt: effectiveAt, knowledgeAt: effectiveAt,
      publicationStart: expectedStart, publicationEnd: effectiveAt }]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, query, { mode: "standard", extension, readBudget: 10 });
    expect(report.window.publishedFrom).toBe(expectedStart);
    expect(report.window.publishedTo).toBe(effectiveAt);
    expect(report.window.exhaustive).toBe(true);

    const identity = await getResearchIdentity(f.persistence, { ...query, history: { limit: 1 } });
    const incompletePages = report.announcementPages.map((page) => ({ ...page, window: { ...page.window,
      publishedFrom: new Date(Date.parse(expectedStart) + 1).toISOString() } }));
    const incomplete = composeFocusedDisclosureResearchReport({ identity, announcementPages: incompletePages, mode: "standard", extension });
    expect(incomplete.window.exhaustive).toBe(false);
  });
  it.each(analyticalFields)("rendered analytical %s: injected trading advice → reject revalidation", async (field) => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate], readBudget: 10 });
    for (const advice of ["Buy the stock now", "I recommend buying shares", "請買進股票", "推薦投資人賣出股票"]) {
      const mutated = structuredClone(report);
      mutated.assessments[0]!.candidate[field] = advice;
      for (const locale of ["en", "zh-TW"] as const) expect(() => renderFocusedDisclosureResearchReportMarkdown(mutated, locale)).toThrow();
    }
  });
  it.each(["corrects", "retracts"] as const)("%s relation: original evidence invalidated → only dependent judgment withheld", async (kind) => {
    const f = await seeded();
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, id: "revision", publishedAt: "2026-10-04T03:00:00.000Z", subject: "更正公告", relations: [{ kind, targetAnnouncementId: f.announcement.id }] }]);
    const independent = { ...candidate, id: "revision_judgment", statusEvidence: { ...candidate.statusEvidence, reference: { kind: "announcement" as const, announcementId: "revision" } }, triggeringEvidence: [{ kind: "announcement" as const, announcementId: "revision" }] };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, artifactCandidate, independent], readBudget: 10 });
    expect(report.assessments.map((item) => item.support)).toEqual(["withheld", "withheld", "provisional"]);
    expect(report.assessments[0]!.reasonCodes).toContain("announcement_corrected_or_retracted");
    expect(report.assessments[1]!.reasonCodes).toContain("artifact_parent_corrected_or_retracted");
    expect(report.officialScanGate.status).toBe("passed");
  });
  it.each((["corrects", "retracts"] as const).flatMap((kind) =>
    (["removed", "repointed"] as const).flatMap((change) =>
      (["inside", "outside"] as const).flatMap((position) =>
        (["selected_with_conflicts", "all_observations"] as const).map((evidenceView) => ({ kind, change, position, evidenceView }))))))(
    "revised $kind $change, $position window, $evidenceView: active lineage → recover prior target and retain new target restrictions",
    async ({ kind, change, position, evidenceView }) => {
      const f = await fixture();
      const second: ResearchAnnouncementRecord = { ...f.announcement, id: "second_target", subject: "Second target",
        attachments: [{ ...f.announcement.attachments[0]!, id: "second_attachment", artifactId: "second_artifact" }] };
      const obsolete: ResearchAnnouncementRecord = { ...f.announcement, id: "obsolete_notice", subject: "Original correction notice",
        publishedAt: "2026-10-04T02:15:00.000Z", attachments: [], relations: [{ kind, targetAnnouncementId: f.announcement.id }] };
      const replacement: ResearchAnnouncementRecord = { ...obsolete, id: "replacement_notice", subject: "Revised correction notice",
        publishedAt: "2026-10-04T03:00:00.000Z", relations: [{ kind: "supersedes", targetAnnouncementId: obsolete.id },
          ...(change === "repointed" ? [{ kind, targetAnnouncementId: second.id }] : [])] };
      await f.persistence.appendResearchAnnouncements([f.announcement, second, obsolete, replacement]);
      await f.persistence.appendResearchDisclosureArtifacts([f.artifact,
        { ...f.artifact, id: "second_artifact", reference: { kind: "announcement_attachment", id: second.id } }]);
      await f.persistence.appendResearchDisclosureScans([f.scan]);
      const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
      const first = await listMaterialAnnouncements(f.persistence, { ...f.query, evidenceView, limit: 1,
        range: { publishedFrom: "2026-10-04T00:00:00.000Z", publishedTo: position === "outside" ? "2026-10-04T02:30:00.000Z" : context.effectiveAt } });
      const announcementPages = [first];
      while (announcementPages.at(-1)!.page.nextCursor) announcementPages.push(await listMaterialAnnouncements(f.persistence,
        { subject: f.query.subject, cursor: announcementPages.at(-1)!.page.nextCursor! }));
      expect(announcementPages.every((page) => page.items.length === 1)).toBe(true);
      const items = announcementPages.flatMap((page) => page.items);
      expect(items.some((item) => item.id === replacement.id)).toBe(position === "inside");
      if (evidenceView === "all_observations") expect(items.find((item) => item.id === obsolete.id)?.relations).toEqual(obsolete.relations);
      const lineage = announcementPages.flatMap((page) => page.relationIndex);
      expect(lineage.some((relation) => relation.announcementId === obsolete.id && relation.kind === kind)).toBe(false);
      expect(lineage.some((relation) => relation.announcementId === replacement.id && relation.kind === kind && relation.targetAnnouncementId === second.id)).toBe(change === "repointed");
      const announcementCandidate = (id: string) => ({ ...candidate, id, triggeringEvidence: [{ kind: "announcement" as const, announcementId: id }],
        statusEvidence: { ...candidate.statusEvidence, reference: { kind: "announcement" as const, announcementId: id } } });
      const secondReference = { kind: "artifact_claim" as const, artifactId: "second_artifact", claimId: "claim_1" };
      const artifactPages = await Promise.all(["artifact_1", "second_artifact"].map((artifactId) => getDisclosureArtifact(f.persistence, { ...f.query, artifactId })));
      const report = composeFocusedDisclosureResearchReport({ identity, announcementPages, artifactPages,
        candidates: [candidate, artifactCandidate, announcementCandidate(second.id),
          { ...artifactCandidate, id: "second_artifact_judgment", triggeringEvidence: [secondReference], statusEvidence: { ...artifactCandidate.statusEvidence, reference: secondReference } },
          announcementCandidate(obsolete.id)] });
      expect(report.assessments.map((assessment) => assessment.sourceSupport)).toEqual([
        "supported", "supported", change === "repointed" ? "withheld" : "supported", change === "repointed" ? "withheld" : "supported", "withheld",
      ]);
      if (change === "repointed") {
        expect(report.assessments[2]!.reasonCodes).toContain("announcement_corrected_or_retracted");
        expect(report.assessments[3]!.reasonCodes).toContain("artifact_parent_corrected_or_retracted");
      }
      expect(report.officialScanGate.status).toBe("passed");
      expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
    });
  it.each(["corrects", "retracts", "supersedes", "unresolved", "unknown"] as const)("outside-window %s notice: one-item audit pages → retain exact lineage source provenance in report", async (kind) => {
    const f = await seeded();
    const second = { ...f.announcement, id: "second_target", subject: "Second target", attachments: [] };
    const notice: ResearchAnnouncementRecord = { ...f.announcement, id: "lineage_notice", subject: "更正公告", publishedAt: "2026-10-04T03:00:00.000Z", attachments: [],
      provenance: { ...f.announcement.provenance, id: "lineage_provenance", contentHash: "b".repeat(64), parserVersion: "lineage-parser/2" },
      relations: kind === "unresolved" || kind === "unknown" ? [] : [{ kind, targetAnnouncementId: f.announcement.id }],
      ...(kind === "unresolved" ? { unresolvedRelations: [{ kind: "corrects" as const, candidateAnnouncementIds: [f.announcement.id, second.id].sort() }] } : {}),
      ...(kind === "unknown" ? { unknownRelationTargets: [{ kind: "retracts" as const }] } : {}) };
    const unrelated = { ...notice, id: "unrelated_notice", relations: [], unresolvedRelations: [], unknownRelationTargets: [],
      provenance: { ...notice.provenance, id: "unrelated_provenance" } };
    await f.persistence.appendResearchAnnouncements([second, notice, unrelated]);
    const page = await listMaterialAnnouncements(f.persistence, { ...f.query, evidenceView: "all_observations", limit: 1,
      range: { publishedFrom: "2026-10-04T00:00:00.000Z", publishedTo: "2026-10-04T02:30:00.000Z" } });
    const announcementPages = [page];
    while (announcementPages.at(-1)!.page.nextCursor) announcementPages.push(await listMaterialAnnouncements(f.persistence,
      { subject: f.query.subject, cursor: announcementPages.at(-1)!.page.nextCursor! }));
    expect(announcementPages).toHaveLength(2);
    expect(announcementPages.flatMap((entry) => entry.items).some((item) => item.id === notice.id)).toBe(false);
    const indices = announcementPages.flatMap((entry) => [...entry.relationIndex, ...entry.unresolvedRelationIndex, ...entry.unknownRelationIndex]);
    expect(indices.length).toBeGreaterThan(0);
    for (const entry of announcementPages) {
      const references = [...entry.relationIndex, ...entry.unresolvedRelationIndex, ...entry.unknownRelationIndex];
      for (const reference of references) {
        expect(reference.provenanceId).toBe(notice.provenance.id);
        expect(entry.provenance.find((provenance) => provenance.id === reference.provenanceId)).toEqual(notice.provenance);
      }
      expect(entry.provenance.some((provenance) => provenance.id === unrelated.provenance.id)).toBe(false);
    }
    const report = composeFocusedDisclosureResearchReport({ identity: await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } }),
      announcementPages, candidates: [candidate] });
    expect(report.evidence.provenanceIds).toContain(notice.provenance.id);
    expect(report.evidence.provenanceIds).not.toContain(unrelated.provenance.id);
    for (const locale of ["en", "zh-TW"] as const) {
      const rendered = literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, locale));
      for (const retained of [notice.id, notice.provenance.id, notice.provenance.sourceUrl, notice.provenance.contentHash!, notice.provenance.parserVersion]) expect(rendered).toContain(retained);
      expect(rendered.split(`- ${notice.id} [`)).toHaveLength(2);
    }
    if (kind === "unresolved" || kind === "unknown") {
      const contradictory = structuredClone(report);
      const secondPage = contradictory.announcementPages[1]!;
      [...secondPage.unresolvedRelationIndex, ...secondPage.unknownRelationIndex][0]!.provenanceId = f.announcement.provenance.id;
      expect(() => renderFocusedDisclosureResearchReportMarkdown(contradictory)).toThrow("source provenance mapping mismatch");
    }
    for (const mutation of ["missing_record", "missing_mapping", "forged_mapping", "contradictory_record"] as const) {
      const altered = structuredClone(report);
      const pageWithSource = altered.announcementPages.find((entry) => entry.provenance.some((record) => record.id === notice.provenance.id))!;
      const entry = [...pageWithSource.relationIndex, ...pageWithSource.unresolvedRelationIndex, ...pageWithSource.unknownRelationIndex][0]!;
      if (mutation === "missing_record") pageWithSource.provenance = pageWithSource.provenance.filter((record) => record.id !== notice.provenance.id);
      if (mutation === "missing_mapping") Reflect.deleteProperty(entry, "provenanceId");
      if (mutation === "forged_mapping") entry.provenanceId = "invented_provenance";
      if (mutation === "contradictory_record") altered.announcementPages[1]!.provenance.find((record) => record.id === f.announcement.provenance.id)!.contentHash = "c".repeat(64);
      expect(() => renderFocusedDisclosureResearchReportMarkdown(altered)).toThrow();
    }
  });
  it.each([false, true])("superseded correction with raw notice returned=%s: effective provenance → exclude stale source unless its audit item is present", async (returnRawNotice) => {
    const f = await seeded();
    const obsolete: ResearchAnnouncementRecord = { ...f.announcement, id: "obsolete_notice", publishedAt: "2026-10-04T03:00:00.000Z", subject: "Old correction", attachments: [],
      relations: [{ kind: "corrects", targetAnnouncementId: f.announcement.id }], provenance: { ...f.announcement.provenance, id: "obsolete_provenance" } };
    const replacement: ResearchAnnouncementRecord = { ...obsolete, id: "replacement_notice", publishedAt: "2026-10-04T03:30:00.000Z", subject: "Replacement notice",
      relations: [{ kind: "supersedes", targetAnnouncementId: obsolete.id }], provenance: { ...obsolete.provenance, id: "replacement_provenance" } };
    await f.persistence.appendResearchAnnouncements([obsolete, replacement]);
    const page = await listMaterialAnnouncements(f.persistence, { ...f.query, evidenceView: "all_observations",
      range: { publishedFrom: "2026-10-04T00:00:00.000Z", publishedTo: returnRawNotice ? context.effectiveAt : "2026-10-04T02:30:00.000Z" } });
    expect(page.relationIndex.some((entry) => entry.announcementId === obsolete.id)).toBe(false);
    expect(page.provenance.some((entry) => entry.id === obsolete.provenance.id)).toBe(returnRawNotice);
    const report = composeFocusedDisclosureResearchReport({ identity: await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } }), announcementPages: [page], candidates: [candidate] });
    expect(report.assessments[0]!.support).toBe("provisional");
    expect(report.evidence.provenanceIds.includes(obsolete.provenance.id)).toBe(returnRawNotice);
  });
  it.each(["restricted", "processing_failed", "unavailable"] as const)("artifact %s: dependent evidence unavailable → independent facts and scan remain usable", async (state) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, state }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, artifactCandidate], readBudget: 10 });
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "withheld"]);
    expect(report.officialScanGate.status).toBe("passed");
    expect(report.artifactPages[0]!.artifact!.blocks).toEqual([]);
    expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report))).toContain(f.announcement.explanation);
  });
  it("verified artifact: page/table identity and units → evidence retained in canonical report", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [artifactCandidate], readBudget: 10 });
    expect(report.assessments[0]!.support).toBe("provisional");
    const retained = report.artifactPages[0]!.artifact!;
    expect(retained).toMatchObject({ contentHash: f.artifact.contentHash, extractionVersion: "extract/1", provenance: f.artifact.provenance });
    expect(retained.verifiedClaims[0]).toMatchObject({ page: 1, table: "capacity", subject: f.record.issuer.id, period: "2027", unit: "units" });
  });
  it.each(["stale", "indeterminate"] as const)("%s official scan: historical facts preserved → current judgments and recommendation gate withheld", async (status) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureScans([{ ...f.scan, checkedAt: status === "stale" ? "2026-10-04T01:00:00.000Z" : "2026-10-04T03:00:00.000Z" }]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate], readBudget: 10 });
    expect(report.officialScanGate.status).toBe("withheld");
    expect(report.assessments[0]!.reasonCodes).toContain(`official_scan_${status}`);
    expect(report.announcementPages[0]!.items[0]!.explanation.text).toBe(f.announcement.explanation);
  });
  it.each([
    ["corrects", "inside"], ["corrects", "outside"], ["retracts", "inside"], ["retracts", "outside"],
  ] as const)("ambiguous %s notice %s window: all candidate predecessors → withhold dependent judgments without resolving lineage", async (kind, position) => {
    const f = await fixture();
    const second = { ...f.announcement, id: "ambiguous_second", attachments: [{ ...f.announcement.attachments[0]!, id: "second_attachment", artifactId: "second_artifact" }] };
    const independent = { ...f.announcement, id: "independent", subject: "Unrelated disclosure", attachments: [] };
    const notice = { ...f.announcement, id: "ambiguous_notice", publishedAt: "2026-10-04T03:00:00.000Z", subject: "更正／撤回公告", attachments: [],
      detailQuality: { status: "available" as const, reasonCodes: ["unresolved_correction_reference"] },
      unresolvedRelations: [{ kind, candidateAnnouncementIds: [f.announcement.id, second.id].sort() }] };
    await f.persistence.appendResearchAnnouncements([f.announcement, second, independent, notice]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact, { ...f.artifact, id: "second_artifact", reference: { kind: "announcement_attachment", id: second.id } }]);
    const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
    const range = { publishedFrom: "2026-10-04T00:00:00.000Z", publishedTo: position === "outside" ? "2026-10-04T02:30:00.000Z" : context.effectiveAt };
    const page = await listMaterialAnnouncements(f.persistence, { ...f.query, range, limit: 1 });
    const announcementPages = [page];
    while (announcementPages.at(-1)!.page.nextCursor) {
      announcementPages.push(await listMaterialAnnouncements(f.persistence, { subject: f.query.subject, cursor: announcementPages.at(-1)!.page.nextCursor! }));
    }
    expect(announcementPages.flatMap((entry) => entry.items).some((item) => item.id === notice.id)).toBe(position === "inside");
    expect(announcementPages.flatMap((entry) => entry.relationIndex)).toEqual([]);
    const unresolved = announcementPages.flatMap((entry) => entry.unresolvedRelationIndex);
    expect(unresolved.every((relation) => relation.sourceAnnouncementId === notice.id && relation.kind === kind)).toBe(true);
    expect([...new Set(unresolved.flatMap((relation) => relation.candidateAnnouncementIds))].sort()).toEqual([f.announcement.id, second.id].sort());
    const artifactPages = await Promise.all(["artifact_1", "second_artifact"].map((artifactId) => getDisclosureArtifact(f.persistence, { ...f.query, artifactId })));
    const announcementCandidate = (id: string) => ({ ...candidate, id, triggeringEvidence: [{ kind: "announcement" as const, announcementId: id }],
      statusEvidence: { ...candidate.statusEvidence, reference: { kind: "announcement" as const, announcementId: id } } });
    const secondArtifactReference = { kind: "artifact_claim" as const, artifactId: "second_artifact", claimId: "claim_1" };
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages, artifactPages,
      candidates: [candidate, announcementCandidate(second.id), artifactCandidate,
        { ...artifactCandidate, id: "second_artifact_judgment", triggeringEvidence: [secondArtifactReference], statusEvidence: { ...artifactCandidate.statusEvidence, reference: secondArtifactReference } },
        announcementCandidate(independent.id)] });
    expect(report.assessments.map((assessment) => assessment.sourceSupport)).toEqual(["withheld", "withheld", "withheld", "withheld", "supported"]);
    for (const assessment of report.assessments.slice(0, 2)) expect(assessment.reasonCodes).toContain("announcement_unresolved_relation_target");
    for (const assessment of report.assessments.slice(2, 4)) expect(assessment.reasonCodes).toContain("artifact_parent_unresolved_relation_target");
    expect(report.officialScanGate.status).toBe("passed");
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain("Unresolved correction/retraction target");
    expect(renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW")).toContain("更正／撤回公告之指向尚未確定");
  });
  it.each(["after_knowledge", "foreign_listing", "superseded", "no_candidates"] as const)("unresolved notice %s: irrelevant or replaced ambiguity → preserve unrelated predecessor support", async (state) => {
    const f = await fixture();
    const second = { ...f.announcement, id: "ambiguous_second", attachments: [] };
    const notice: ResearchAnnouncementRecord = { ...f.announcement, id: "ambiguous_notice", publishedAt: "2026-10-04T03:00:00.000Z", attachments: [],
      detailQuality: { status: "available", reasonCodes: ["unresolved_correction_reference"] },
      ...(state === "no_candidates" ? {} : { unresolvedRelations: [{ kind: "corrects", candidateAnnouncementIds: [f.announcement.id, second.id].sort() }] }),
      ...(state === "foreign_listing" ? { listingId: "another_listing" } : {}),
      ...(state === "after_knowledge" ? { provenance: { ...f.announcement.provenance, retrievedAt: "2026-10-04T04:01:00.000Z", processedAt: "2026-10-04T04:01:00.000Z" } } : {}) };
    await f.persistence.appendResearchAnnouncements([f.announcement, second, notice]);
    if (state === "superseded") await f.persistence.appendResearchAnnouncements([{ ...notice, id: "resolved_notice", publishedAt: "2026-10-04T03:30:00.000Z",
      unresolvedRelations: undefined, detailQuality: { status: "available", reasonCodes: [] },
      relations: [{ kind: "supersedes", targetAnnouncementId: notice.id }, { kind: "corrects", targetAnnouncementId: f.announcement.id }] }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const page = await listMaterialAnnouncements(f.persistence, { ...f.query, range: { publishedFrom: "2026-10-04T00:00:00.000Z", publishedTo: "2026-10-04T02:30:00.000Z" } });
    expect(page.unresolvedRelationIndex).toEqual([]);
    const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
    const secondReference = { kind: "announcement" as const, announcementId: second.id };
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages: [page], candidates: [candidate,
      { ...candidate, id: second.id, triggeringEvidence: [secondReference], statusEvidence: { ...candidate.statusEvidence, reference: secondReference } }] });
    expect(report.assessments.map((assessment) => assessment.sourceSupport)).toEqual([state === "superseded" ? "withheld" : "supported", "supported"]);
    if (state === "superseded") expect(report.assessments[0]!.reasonCodes).toContain("announcement_corrected_or_retracted");
  });
  it("focused coverage: exhaustive-dependent judgment → withheld without blocking unrelated claim", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, { ...candidate, id: "exhaustive", requiresExhaustiveCoverage: true }], readBudget: 10 });
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "withheld"]);
    expect(report.assessments[1]!.reasonCodes).toContain("non_exhaustive_window");
    expect(report.officialScanGate.status).toBe("passed");
  });
  it("artifact budget exhausted: available announcement judgment → preserved with explicit partial status", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "standard", candidates: [candidate, artifactCandidate], readBudget: 1 });
    expect(report.reportStatus).toBe("partial");
    expect(report.window.exhaustive).toBe(true);
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "withheld"]);
  });
  it("malformed specialist evidence: wrong subject/context → reject cross-subject composition", async () => {
    const f = await seeded();
    const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
    const page = await listMaterialAnnouncements(f.persistence, f.query);
    const artifact = await getDisclosureArtifact(f.persistence, { ...f.query, artifactId: "artifact_1" });
    artifact.context.knowledgeAt = "2026-10-04T03:00:00.000Z";
    expect(() => composeFocusedDisclosureResearchReport({ identity, announcementPages: [page], artifactPages: [artifact] })).toThrow(/context mismatch/);
  });
  it("rendered support tampering: withheld judgment relabeled → validator rejects narrative", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, requiresExhaustiveCoverage: true }], readBudget: 10 });
    report.assessments[0]!.support = "provisional";
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).toThrow(/do not match retained evidence/);
  });
  it.each(["limitations", "recoveryRequirements", "provenance", "generatedAt", "status"] as const)("rendered %s tampering: alter derived metadata → reject in both locales", async (field) => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [artifactCandidate], readBudget: 1 });
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
    if (field === "limitations") report.limitations = [];
    if (field === "recoveryRequirements") report.recoveryRequirements = [];
    if (field === "provenance") report.evidence.provenanceIds.push("invented_provenance");
    if (field === "generatedAt") report.generatedAt = "2026-10-04T05:00:00.000Z";
    if (field === "status") report.reportStatus = "complete";
    for (const locale of ["en", "zh-TW"] as const) {
      expect(() => renderFocusedDisclosureResearchReportMarkdown(report, locale)).toThrow(/do not match retained evidence/);
    }
  });
  it("completed report status: relabel complete read as partial → reject circular status input", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { readBudget: 10 });
    report.reportStatus = "partial";
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).toThrow(/do not match retained evidence/);
  });
  it("announcement pagination: unread continuation → partial report without invented budget cause", async () => {
    const f = await paginatedFixture();
    const report = composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: [f.announcementPages[0]!] });
    expect(report.reportStatus).toBe("partial");
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain("Announcement reads are incomplete");
    expect(renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW")).toContain("公告讀取尚未完成");
    expect(report.limitations.join(" ")).not.toContain("budget");
    report.reportStatus = "complete";
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).toThrow(/do not match retained evidence/);
  });
  it("artifact pagination: unread continuation → independently derive partial report", async () => {
    const f = await paginatedFixture();
    const report = composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages,
      artifactPages: [f.artifactPages[0]!], candidates: [artifactCandidate] });
    expect(report.reportStatus).toBe("partial");
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
    expect(f.announcementPages).toHaveLength(3);
    expect(f.announcementPages.at(-1)!.page.nextCursor).toBeNull();
    for (const page of f.announcementPages) {
      expect(page.quality.completeness).toBe("partial");
      expect(page.quality.readiness.exhaustiveConclusion).toBe("blocked");
      expect(page.window.exhaustive).toBe(true);
    }
    const complete = composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages,
      artifactPages: f.artifactPages, candidates: [artifactCandidate], mode: "standard" });
    expect(complete.reportStatus).toBe("complete");
    expect(complete.window.exhaustive).toBe(true);
    expect(() => renderFocusedDisclosureResearchReportMarkdown(complete)).not.toThrow();
  });
  it("descending artifact chain: contiguous physical pages → complete renderable report", async () => {
    const f = await paginatedFixture("desc");
    expect(f.artifactPages.flatMap((page) => page.page.returnedPages)).toEqual([3, 2, 1]);
    const report = composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages,
      artifactPages: f.artifactPages, candidates: [artifactCandidate] });
    expect(report.reportStatus).toBe("complete");
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
  });
  it.each(["terminal_only", "missing_middle", "forged_terminal"] as const)("announcement %s: broken page chain → reject incomplete coverage", async (mutation) => {
    const f = await paginatedFixture();
    const announcementPages = mutation === "terminal_only" ? [f.announcementPages[2]!]
      : mutation === "missing_middle" ? [f.announcementPages[0]!, f.announcementPages[2]!]
        : [{ ...f.announcementPages[0]!, page: { ...f.announcementPages[0]!.page, nextCursor: null } }];
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages, mode: "standard" })).toThrow(/page continuity/);
  });
  it.each(["terminal_only", "missing_middle", "forged_terminal"] as const)("artifact %s: broken page chain → reject incomplete coverage", async (mutation) => {
    const f = await paginatedFixture();
    const artifactPages = mutation === "terminal_only" ? [f.artifactPages[2]!]
      : mutation === "missing_middle" ? [f.artifactPages[0]!, f.artifactPages[2]!]
        : [{ ...f.artifactPages[0]!, page: { ...f.artifactPages[0]!.page, nextCursor: null } }];
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages,
      artifactPages, candidates: [artifactCandidate] })).toThrow(/page continuity/);
  });
  it.each(["duplicate", "reversed"] as const)("%s page arrays: announcement and artifact chains → reject repeated or reordered responses", async (mutation) => {
    const f = await paginatedFixture();
    const announcements = mutation === "duplicate" ? [f.announcementPages[0]!, ...f.announcementPages] : [...f.announcementPages].reverse();
    const artifacts = mutation === "duplicate" ? [f.artifactPages[0]!, ...f.artifactPages] : [...f.artifactPages].reverse();
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: announcements })).toThrow(/page continuity/);
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages, artifactPages: artifacts })).toThrow(/page continuity/);
  });
  it.each(["duplicate", "reversed"] as const)("%s announcement payload: unchanged boundary counts → reject repeated or unordered records", async (mutation) => {
    const f = await paginatedFixture();
    if (mutation === "duplicate") f.announcementPages[1]!.items = f.announcementPages[0]!.items;
    else {
      const firstItems = f.announcementPages[0]!.items;
      f.announcementPages[0]!.items = f.announcementPages[2]!.items;
      f.announcementPages[2]!.items = firstItems;
    }
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages })).toThrow(/page continuity/);
  });
  it.each(["offset", "count", "total", "query", "cursor"] as const)("page boundary %s mutation: inconsistent service metadata → reject", async (field) => {
    const f = await paginatedFixture();
    const page = f.announcementPages[1]!;
    if (field === "offset") page.page.continuity.offset += 1;
    if (field === "count") page.page.continuity.returnedCount += 1;
    if (field === "total") page.page.continuity.totalCount += 1;
    if (field === "query") page.page.continuity.queryHash = "f".repeat(64);
    if (field === "cursor") page.page.continuity.requestCursor = "unrelated_cursor";
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages })).toThrow(/page continuity/);
  });
  it("artifact physical pages: duplicate or skipped number → reject despite consistent counts", async () => {
    const f = await paginatedFixture();
    f.artifactPages[1]!.page.returnedPages = [1];
    expect(() => composeFocusedDisclosureResearchReport({ identity: f.identity, announcementPages: f.announcementPages,
      artifactPages: f.artifactPages })).toThrow(/page continuity/);
  });
  it("empty collection: initial zero-count terminal page → valid complete read", async () => {
    const f = await fixture();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { readBudget: 10 });
    expect(report.reportStatus).toBe("complete");
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
  });
  it("missing retained artifact: unavailable dependency → only dependent claim withheld", async () => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, artifactCandidate], readBudget: 10 });
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "withheld"]);
    expect(report.officialScanGate.status).toBe("passed");
    expect(report.reportStatus).toBe("partial");
    expect(() => renderFocusedDisclosureResearchReportMarkdown(report)).not.toThrow();
    const zh = renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW");
    expect(zh).toContain("文件讀取尚未完成");
    expect(zh).not.toContain("額度已用盡");
  });

  it("invented prose: unrelated valid evidence ID → withheld without promoting caller sentiment", async () => {
    const f = await seeded();
    const invented = { ...candidate, statement: "Invented bullish price forecast", statusEvidence: { ...candidate.statusEvidence, excerpt: "Invented bullish price forecast" } };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [invented], readBudget: 10 });
    expect(report.assessments[0]!.support).toBe("withheld");
    expect(report.assessments[0]!.reasonCodes).toContain("publisher_excerpt_not_verified");
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).not.toContain("Invented bullish");
    expect(disclosureCandidateSchema.safeParse({ ...candidate, materialMechanism: "bullish sentiment guarantees price rise" }).success).toBe(false);
  });
  it.each([
    ["observed", "2026/10/03", "2026-10-03"], ["observed", "2026年10月3日", "2026-10-03"],
    ["observed", "2026-10-3", "2026-10-03"], ["observed", "115/10/03", "2026-10-03"], ["observed", "115年10月3日", "2026-10-03"],
    ["scheduled", "2027/01/01", "2027-01-01"], ["scheduled", "2027年1月1日", "2027-01-01"],
    ["scheduled", "2027-1-1", "2027-01-01"], ["scheduled", "116/01/01", "2027-01-01"], ["scheduled", "116年1月1日", "2027-01-01"],
    ["observed", "2024/2/29", "2024-02-29"], ["scheduled", "2028年2月29日", "2028-02-29"],
  ] as const)("%s publisher date %s: strict calendar normalization → preserve source assertion in both locales", async (status, literal, eventDate) => {
    for (const cue of status === "observed" ? ["completed", "已完成"] : ["scheduled", "預定"]) {
      const f = await fixture();
      const statement = `${literal}: ${cue}`;
      await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: statement, eventDate }]);
      await f.persistence.appendResearchDisclosureScans([f.scan]);
      const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status, statement,
        statusEvidence: { ...candidate.statusEvidence, excerpt: statement, eventDate, eventDateText: literal } }], readBudget: 10 });
      expect(report.assessments[0]!.sourceSupport).toBe("supported");
      for (const locale of ["en", "zh-TW"] as const) expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, locale))).toContain(statement);
    }
  });
  it.each([
    ["2027/02/29", "2027-02-29"], ["2027年4月31日", "2027-04-31"],
    ["2027-02-29", "2027-02-29"], ["2100/02/29", "2100-02-29"],
    ["116/02/29", "2027-02-29"], ["116年4月31日", "2027-04-31"],
    ["2027/13/01", "2027-13-01"], ["2027/00/01", "2027-00-01"], ["2027/01/00", "2027-01-00"],
    ["2027/01-01", "2027-01-01"], ["2027年1/1日", "2027-01-01"],
  ])("invalid publisher calendar %s: exact source literal → no rollover or mixed-separator classification", async (literal, eventDate) => {
    const f = await fixture();
    const statement = `${literal}: scheduled 預定`;
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: statement, eventDate }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status: "scheduled", statement,
      statusEvidence: { ...candidate.statusEvidence, excerpt: statement, eventDate, eventDateText: literal } }], readBudget: 10 });
    expect(report.assessments[0]!.reasonCodes).toContain("classification_date_not_verified");
    expect(report.assessments[0]!.sourceSupport).toBe("withheld");
  });
  it.each(["observed", "scheduled"] as const)("%s normalized date: absent literal or negation → preserve existing evidence gates", async (status) => {
    const f = await fixture();
    const eventDate = status === "observed" ? "2026-10-03" : "2027-01-01";
    const literal = status === "observed" ? "2026/10/03" : "2027/01/01";
    const statement = `${literal}: ${status === "observed" ? "not completed 尚未完成" : "not scheduled 尚未預定"}`;
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: statement, eventDate }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    for (const dateText of [literal, eventDate]) {
      const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status, statement,
        statusEvidence: { ...candidate.statusEvidence, excerpt: statement, eventDate, eventDateText: dateText } }], readBudget: 10 });
      expect(report.assessments[0]!.sourceSupport).toBe("withheld");
      expect(report.assessments[0]!.reasonCodes).toContain("classification_status_not_verified");
      if (dateText !== literal) expect(report.assessments[0]!.reasonCodes).toContain("classification_date_not_verified");
    }
  });
  it.each([
    ["observed", "The transaction was not completed on 2026/10/03.", "completed on 2026/10/03", "2026-10-03", "2026/10/03"],
    ["observed", "交易尚未完成於2026年10月3日。", "完成於2026年10月3日", "2026-10-03", "2026年10月3日"],
    ["observed", "The transaction was not, as previously claimed, completed on 2026/10/03.", "completed on 2026/10/03", "2026-10-03", "2026/10/03"],
    ["observed", "The transaction was not\ncompleted on 2026/10/03.", "completed on 2026/10/03", "2026-10-03", "2026/10/03"],
    ["observed", "交易尚未\n完成於2026年10月3日。", "完成於2026年10月3日", "2026-10-03", "2026年10月3日"],
    ["observed", "If approved, the transaction completed on 2026/10/03.", "completed on 2026/10/03", "2026-10-03", "2026/10/03"],
    ["scheduled", "The transaction is not scheduled for 2027/01/01.", "scheduled for 2027/01/01", "2027-01-01", "2027/01/01"],
    ["scheduled", "交易尚未預定於2027年1月1日。", "預定於2027年1月1日", "2027-01-01", "2027年1月1日"],
    ["scheduled", "The transaction was scheduled for 2027/01/01, but cancelled.", "scheduled for 2027/01/01", "2027-01-01", "2027/01/01"],
    ["observed", "The transaction was not completed on 2026/10/03. Another transaction completed on 2026/10/03.", "completed on 2026/10/03", "2026-10-03", "2026/10/03"],
    ["scheduled", "交易預定於2027年1月1日。另一交易尚未預定於2027年1月1日。", "預定於2027年1月1日", "2027-01-01", "2027年1月1日"],
  ] as const)("%s quote %s: omitted surrounding negation or uncertainty → withhold both announcement and artifact judgment", async (status, source, excerpt, eventDate, eventDateText) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: source, eventDate }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, verifiedClaims: [{ ...f.artifact.verifiedClaims[0]!, text: source }] }]);
    const announcementReference = { kind: "announcement" as const, announcementId: f.announcement.id };
    const artifactReference = { kind: "artifact_claim" as const, artifactId: f.artifact.id, claimId: "claim_1" };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [announcementReference, artifactReference].map((reference, index) => ({ ...candidate,
      id: `trimmed_${index}`, status, statement: excerpt, triggeringEvidence: [reference], statusEvidence: { reference, excerpt, eventDate, eventDateText } })), readBudget: 10 });
    for (const assessment of report.assessments) {
      expect(assessment.sourceSupport).toBe("withheld");
      expect(assessment.reasonCodes).toContain("classification_status_not_verified");
      expect(assessment.reasonCodes).not.toContain("publisher_excerpt_not_verified");
    }
    for (const locale of ["en", "zh-TW"] as const) expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, locale))).toContain(source.replaceAll("\n", " "));
  });
  it.each(["observed", "scheduled"] as const)("%s quote: independent affirmative source sentence → preserve supported exact excerpt", async (status) => {
    const f = await fixture();
    const eventDate = status === "observed" ? "2026-10-03" : "2027-01-01";
    const eventDateText = eventDate.replaceAll("-", "/");
    const excerpt = status === "observed" ? `completed on ${eventDateText}` : `scheduled for ${eventDateText}`;
    const source = `A different transaction was not approved. The transaction was ${excerpt}.`;
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: source, eventDate }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status, statement: excerpt,
      statusEvidence: { ...candidate.statusEvidence, excerpt, eventDate, eventDateText } }], readBudget: 10 });
    expect(report.assessments[0]!.sourceSupport).toBe("supported");
  });
  it("planned future event mislabeled observed: authentic excerpt → status withheld", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status: "observed", statusEvidence: { ...candidate.statusEvidence, eventDate: "2027-01-01", eventDateText: "2027-01-01" } }], readBudget: 10 });
    expect(report.assessments[0]!.reasonCodes).toContain("classification_date_not_verified");
    expect(report.assessments[0]!.reasonCodes).toContain("classification_status_not_verified");
    expect(disclosureCandidateSchema.safeParse({ ...candidate, status: "scheduled" }).success).toBe(false);
  });
  it.each([
    ["observed", "尚未發生", "2026-10-03"], ["observed", "並未完成", "2026-10-03"],
    ["observed", "已取消原決議", "2026-10-03"], ["observed", "若通過將完成", "2026-10-03"],
    ["observed", "not completed", "2026-10-03"], ["observed", "hasn't occurred", "2026-10-03"],
    ["observed", "uncompleted", "2026-10-03"], ["observed", "if approved", "2026-10-03"],
    ["observed", "completed subject to approval", "2026-10-03"],
    ["observed", "will be completed", "2026-10-03"], ["observed", "並無發生", "2026-10-03"],
    ["observed", "不排除發生", "2026-10-03"], ["observed", "預估完成", "2026-10-03"],
    ["scheduled", "尚未預定", "2027-01-01"], ["scheduled", "取消原訂於", "2027-01-01"],
    ["scheduled", "not scheduled", "2027-01-01"], ["scheduled", "no longer planned", "2027-01-01"],
    ["scheduled", "scheduled but cancelled", "2027-01-01"],
  ] as const)("%s negative/conditional cue %s: exact dated source → withhold affirmative classification", async (status, cue, date) => {
    const f = await fixture();
    const statement = `${date}: ${cue}`;
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: statement, eventDate: date }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate,
      status, statement, statusEvidence: { ...candidate.statusEvidence, excerpt: statement, eventDate: date, eventDateText: date } }], readBudget: 10 });
    expect(report.assessments[0]!.reasonCodes).toContain("classification_status_not_verified");
    expect(report.assessments[0]!.support).toBe("withheld");
    for (const locale of ["en", "zh-TW"] as const) {
      expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, locale))).toContain(statement);
    }
  });
  it.each(["已完成", "董事會決議通過", "approved", "completed", "occurred"])("affirmative occurrence %s: exact past dated source → retain supported classification", async (cue) => {
    const f = await fixture();
    const statement = `2026-10-03: ${cue}`;
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, explanation: statement }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status: "observed", statement,
      statusEvidence: { ...candidate.statusEvidence, excerpt: statement, eventDate: "2026-10-03", eventDateText: "2026-10-03" } }], readBudget: 10 });
    expect(report.assessments[0]!.sourceSupport).toBe("supported");
  });
  it.each(["en", "zh-TW"] as const)("%s literal rendering: source prose and metadata Markdown injection → inert text without changing evidence", async (locale) => {
    const f = await fixture();
    const injection = "\\`code` **bold** _em_ [link](https://evil.example) ![image](https://evil.example/p.png) <img src=\"https://evil.example\"> <https://evil.example> www.evil.example &#91;x&#93; | # heading\r\n> block - item";
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, subject: injection, explanation: injection,
      ruleClause: injection, eventDate: injection, detailQuality: { status: "available", reasonCodes: [injection] } }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, extractionVersion: injection,
      blocks: f.artifact.blocks.map((block) => ({ ...block, table: injection, period: injection, unit: injection })),
      verifiedClaims: f.artifact.verifiedClaims.map((claim) => ({ ...claim, text: injection, table: injection, period: injection, unit: injection })) }]);
    const maliciousCandidate = { ...candidate, id: "literal_metadata", statement: injection,
      statusEvidence: { ...candidate.statusEvidence, excerpt: injection }, materialMechanism: injection,
      affectedMetricOrAssumption: injection, horizon: injection, condition: injection,
      confirmationCondition: injection, disconfirmationCondition: injection };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [maliciousCandidate,
      { ...artifactCandidate, statement: injection, statusEvidence: { ...artifactCandidate.statusEvidence, excerpt: injection } }], readBudget: 10 });
    expect(report.assessments.every((assessment) => assessment.sourceSupport === "supported")).toBe(true);
    const before = JSON.stringify(report);
    const rendered = renderFocusedDisclosureResearchReportMarkdown(report, locale);
    expect(rendered).not.toMatch(/!\[|\]\(|<img|<https|`|https:\/\/|www\.|\\/);
    expect(rendered).toContain("&#91;link&#93;&#40;https&#58;&#47;&#47;evil&#46;example&#41;");
    expect(rendered).toContain("&#92;&#96;code&#96;");
    expect(rendered).toContain("&#38;&#35;91&#59;x&#38;&#35;93&#59;");
    expect(literalMarkdownText(rendered)).toContain(injection.replace(/[\r\n\u2028\u2029]/g, " "));
    expect(JSON.stringify(report)).toBe(before);
  });
  it.each(["announcement_attachment", "investor_material"] as const)("%s publication: old artifact → withhold until declared extension encompasses publication", async (kind) => {
    const f = await fixture();
    const publishedAt = "2025-01-04T04:00:00.000Z";
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, publishedAt, reference: { kind, id: kind === "announcement_attachment" ? f.announcement.id : "material_1" } }]);
    if (kind === "investor_material") await f.persistence.appendResearchDisclosureMaterialReferences([{ id: "material_1",
      issuerId: f.record.issuer.id, listingId: f.record.listing.id, venue: f.record.listing.venue,
      publishedAt, artifactIds: [f.artifact.id], provenance: f.artifact.provenance }]);
    for (const mode of ["focused", "standard"] as const) {
      const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode, candidates: [candidate, artifactCandidate], readBudget: 10 });
      expect(report.assessments[0]!.sourceSupport).toBe("supported");
      expect(report.assessments[1]!.reasonCodes).toContain("artifact_outside_report_window");
      expect(report.assessments[1]!.sourceSupport).toBe("withheld");
      expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain("Evidence excluded from report conclusions");
      expect(renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW")).toContain("此證據不納入報告結論");
    }
    const extension = { months: 24, reason: "litigation" as const, thesisItem: "Unresolved litigation" };
    const extended = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "standard", extension, candidates: [artifactCandidate], readBudget: 10 });
    expect(extended.assessments[0]!.sourceSupport).toBe("supported");
    const insufficient = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "standard", extension: { ...extension, months: 13 }, candidates: [artifactCandidate], readBudget: 10 });
    expect(insufficient.assessments[0]!.reasonCodes).toContain("artifact_outside_report_window");
  });
  it.each(["start", "end", "before", "after"] as const)("artifact %s boundary: direct composition → inclusive fixed report interval", async (boundary) => {
    const f = await seeded();
    const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
    const page = await listMaterialAnnouncements(f.persistence, f.query);
    const artifact = await getDisclosureArtifact(f.persistence, { ...f.query, artifactId: f.artifact.id });
    const lower = Date.parse(page.window.publishedFrom);
    const upper = Date.parse(page.window.publishedTo);
    artifact.artifact!.publishedAt = new Date(boundary === "start" ? lower : boundary === "end" ? upper : boundary === "before" ? lower - 1 : upper + 1).toISOString();
    const report = composeFocusedDisclosureResearchReport({ identity, announcementPages: [page], artifactPages: [artifact], candidates: [artifactCandidate] });
    expect(report.assessments[0]!.sourceSupport).toBe(boundary === "start" || boundary === "end" ? "supported" : "withheld");
    if (boundary === "before" || boundary === "after") expect(report.assessments[0]!.reasonCodes).toContain("artifact_outside_report_window");
  });
  it.each([null, undefined, "unknown"])("artifact unknown publication %s: invalid source metadata → reject composition", async (publishedAt) => {
    const f = await seeded();
    const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
    const page = await listMaterialAnnouncements(f.persistence, f.query);
    const artifact = await getDisclosureArtifact(f.persistence, { ...f.query, artifactId: f.artifact.id });
    const invalid = { ...artifact, artifact: { ...artifact.artifact!, publishedAt } };
    expect(() => composeFocusedDisclosureResearchReport({ identity, announcementPages: [page], artifactPages: [invalid as typeof artifact], candidates: [artifactCandidate] })).toThrow();
  });
  it("attachment excluded parent: current artifact publication → no bypass of selected announcement window", async () => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement, publishedAt: "2025-01-04T04:00:00.000Z" }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [artifactCandidate], readBudget: 10 });
    expect(report.assessments[0]!.reasonCodes).toContain("artifact_parent_not_returned");
  });
  it.each(["restricted", "unresolved", "truncated"] as const)("attachment parent %s: verified retained claim → honor parent eligibility without requiring full inline text", async (state) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([{ ...f.announcement,
      ...(state === "restricted" ? { quality: "restricted" as const } : {}),
      ...(state === "unresolved" ? { detailQuality: { status: "available" as const, reasonCodes: ["unresolved_correction_reference"] } } : {}),
      ...(state === "truncated" ? { explanation: "Long source text ".repeat(2000) } : {}) }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [artifactCandidate], readBudget: 10 });
    expect(report.assessments[0]!.sourceSupport).toBe(state === "truncated" ? "supported" : "withheld");
    if (state !== "truncated") expect(report.assessments[0]!.reasonCodes).toContain(state === "restricted" ? "artifact_parent_restricted" : "artifact_parent_unresolved_correction_reference");
  });
  it("long-lived thesis: declared extension → bounded two-year scan", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "standard", extension: { months: 24, reason: "litigation", thesisItem: "Unresolved litigation" }, readBudget: 10 });
    expect(report.window.publishedFrom).toBe("2024-10-04T04:00:00.000Z");
    expect(report.window.extension?.reason).toBe("litigation");
    const identity = await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } });
    expect(() => composeFocusedDisclosureResearchReport({ identity, announcementPages: report.announcementPages, mode: "focused", extension: report.window.extension })).toThrow(/standard/);
    await expect(buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "standard", extension: { months: 25, reason: "litigation", thesisItem: "Unresolved litigation" }, readBudget: 10 })).rejects.toThrow();
    await expect(buildFocusedDisclosureResearchReport(f.persistence, f.query, { mode: "focused", extension: { months: 24, reason: "litigation", thesisItem: "Unresolved litigation" }, readBudget: 10 })).rejects.toThrow(/standard/);
  });
  it.each([
    ["disclosure_source_too_large", "Operator action required: review the official attachment size against acquisition limits and retain a supported bounded source; dependent claims remain withheld.", "需由維運人員處理：依擷取上限檢查官方附件大小，並留存系統支援且大小受限的來源；依賴該附件的判斷仍暫不提出。"],
    ["disclosure_extraction_physical_page_limit", "Operator action required: a physical PDF page exceeds retrieval limits; retain a supported source preserving physical page locations. Dependent claims remain withheld.", "需由維運人員處理：PDF 實體頁面超出讀取上限；請留存系統支援且保留實體頁面位置的來源。依賴該內容的判斷仍暫不提出。"],
  ] as const)("%s: operator recovery → faithful zh-TW guidance without changing canonical evidence", async (reasonCode, recovery, translation) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureScans([{ ...f.scan, artifactAttempts: [{ artifactId: f.artifact.id,
      sourceUrl: f.artifact.sourceUrl, attemptedAt: f.scan.checkedAt, status: "processing_failed", reasonCode }] }]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [artifactCandidate], readBudget: 10 });
    expect(report.recoveryRequirements).toContain(recovery);
    const before = JSON.stringify(report);
    expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, "en"))).toContain(recovery);
    const zh = literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW"));
    expect(zh).toContain(translation);
    expect(zh).not.toContain(recovery);
    expect(JSON.stringify(report)).toBe(before);
  });
  it("zh-TW rendering: localized labels and policy explanations → identical original evidence and claims", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate], readBudget: 10 });
    const before = JSON.stringify(report);
    const en = renderFocusedDisclosureResearchReportMarkdown(report, "en");
    const zh = renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW");
    expect(zh).toContain("台灣重大訊息研究");
    expect(zh).toContain("本專題報告未評估其他必要條件，因此不提出最終建議。");
    expect(zh).toContain("催化因素 / 有條件 / 暫定");
    expect(literalMarkdownText(zh)).toContain(f.announcement.explanation);
    expect(literalMarkdownText(en)).toContain(f.announcement.explanation);
    expect(JSON.stringify(report)).toBe(before);
    expect(report.assessments[0]!.sourceSupport).toBe("supported");
    expect(report.assessments[0]!.interpretationType).toBe("analytical_judgment");
  });

  it.each((["TWSE", "TPEX"] as const).flatMap((venue) => (["corrects", "retracts"] as const).flatMap((kind) =>
    ([403, 500, "invalid"] as const).map((failure) => ({ venue, kind, failure })))))("$venue raw $kind citation with $failure detail failure: public report → withhold exact dependencies and preserve unrelated facts", async ({ venue, kind, failure }) => {
    const f = await seeded(venue);
    const independent = { ...f.announcement, id: "unrelated_fact", subject: "Unrelated disclosure", attachments: [] };
    await f.persistence.appendResearchAnnouncements([independent]);
    const rows = JSON.parse(readFileSync(new URL(`../fixtures/research/${venue.toLowerCase()}-announcements.json`, import.meta.url), "utf8"));
    const row = rows[0];
    row[venue === "TWSE" ? "公司代號" : "SecuritiesCompanyCode"] = f.record.listing.ticker;
    row[venue === "TWSE" ? "主旨 " : "主旨"] = `${kind === "corrects" ? "更正" : "撤回"}本公司公告`;
    row.發言日期 = "1151004"; row.發言時間 = "110000";
    row.說明 = `原115/10/04公告「${f.announcement.subject}」內容變更。`;
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
    const fetchImpl = vi.fn(async (url: string | URL | Request) => String(url).includes("t187ap04")
      ? new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } })
      : failure === "invalid" ? new Response("invalid JSON") : new Response("detail unavailable", { status: failure })) as unknown as typeof fetch;
    await runOfficialDisclosureAcquisition(f.persistence, { fetchImpl, retrievedAt: "2026-10-04T03:55:00.000Z", acquisitionRunId: "raw_citation_failure" });
    const first = await listMaterialAnnouncements(f.persistence, { ...f.query, limit: 1,
      range: { publishedFrom: "2026-10-04T00:00:00.000Z", publishedTo: "2026-10-04T02:30:00.000Z" } });
    const announcementPages = [first];
    while (announcementPages.at(-1)!.page.nextCursor) announcementPages.push(await listMaterialAnnouncements(f.persistence,
      { subject: f.query.subject, cursor: announcementPages.at(-1)!.page.nextCursor! }));
    expect(announcementPages.flatMap((page) => page.relationIndex)).toEqual(expect.arrayContaining([expect.objectContaining({ kind, targetAnnouncementId: f.announcement.id })]));
    const independentReference = { kind: "announcement" as const, announcementId: independent.id };
    const report = composeFocusedDisclosureResearchReport({ identity: await getResearchIdentity(f.persistence, { ...f.query, history: { limit: 1 } }), announcementPages,
      artifactPages: [await getDisclosureArtifact(f.persistence, { ...f.query, artifactId: f.artifact.id })],
      candidates: [candidate, artifactCandidate, { ...candidate, id: independent.id, triggeringEvidence: [independentReference], statusEvidence: { ...candidate.statusEvidence, reference: independentReference } }] });
    expect(report.assessments.map((assessment) => assessment.support)).toEqual(["withheld", "withheld", "provisional"]);
    expect(report.assessments[0]!.reasonCodes).toContain("announcement_corrected_or_retracted");
    expect(report.assessments[1]!.reasonCodes).toContain("artifact_parent_corrected_or_retracted");
    expect(report.officialScanGate.status).toBe("passed");
  });
  it.each([
    ["second", "2026-10-04T02:00:00.000Z", true], ["second", "2026-10-04T01:59:59.000Z", false],
    ["minute", "2026-10-04T02:00:00.000Z", true], ["minute", "2026-10-04T01:59:00.000Z", false],
    ["date", "2026-10-03T16:00:00.000Z", true], ["date", "2026-10-02T16:00:00.000Z", false],
  ] as const)("unknown target %s at %s: publication uncertainty → withhold interpretation only when potentially earlier", async (publicationPrecision, publishedAt, affected) => {
    const f = await seeded();
    const notice: ResearchAnnouncementRecord = { ...f.announcement, id: "unknown_notice", subject: "更正先前公告", explanation: "更正先前公告，指向尚待查證。",
      publishedAt, publicationPrecision, attachments: [], unknownRelationTargets: [{ kind: "corrects" }],
      detailQuality: { status: "restricted", reasonCodes: ["unresolved_correction_reference"] } };
    const later = { ...f.announcement, id: "later_fact", subject: "Later independent disclosure", publishedAt: "2026-10-04T03:00:00.000Z", attachments: [] };
    await f.persistence.appendResearchAnnouncements([notice, later]);
    const laterReference = { kind: "announcement" as const, announcementId: later.id };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { readBudget: 10,
      candidates: [candidate, artifactCandidate, { ...candidate, id: later.id, triggeringEvidence: [laterReference], statusEvidence: { ...candidate.statusEvidence, reference: laterReference } }] });
    expect(report.assessments.slice(0, 2).map((assessment) => assessment.sourceSupport)).toEqual(["supported", "supported"]);
    expect(report.assessments.slice(0, 2).map((assessment) => assessment.support)).toEqual([affected ? "withheld" : "provisional", affected ? "withheld" : "provisional"]);
    for (const assessment of report.assessments.slice(0, 2)) expect(assessment.reasonCodes.includes("unknown_correction_scope")).toBe(affected);
    expect(report.assessments[2]!.support).toBe(publicationPrecision === "date" && affected ? "withheld" : "provisional");
    expect(report.officialScanGate.status).toBe("passed");
    if (affected) expect(renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW")).toContain("原始留存事實仍予保留");
    await f.persistence.appendResearchAnnouncements([{ ...notice, id: "resolved_notice", unknownRelationTargets: [],
      publishedAt: "2026-10-04T03:30:00.000Z", publicationPrecision: "second", detailQuality: { status: "available", reasonCodes: [] },
      relations: [{ kind: "supersedes", targetAnnouncementId: notice.id }] }]);
    const recovered = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { readBudget: 10, candidates: [candidate, artifactCandidate] });
    expect(recovered.assessments.map((assessment) => assessment.support)).toEqual(["provisional", "provisional"]);
    expect(recovered.announcementPages.flatMap((page) => page.unknownRelationIndex)).toEqual([]);
  });
  it("slow enrichment: completed detail after stale snapshot → preserve original scan age and prior successful evidence", async () => {
    const f = await fixture();
    const snapshotAt = "2026-10-04T03:10:00.000Z";
    const completedAt = "2026-10-04T03:50:00.000Z";
    const identityRecord = canonicalizeOfficialIdentityRow({ venue: "TWSE", snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T02:00:00.000Z",
      artifact: { contentHash: "slow-enrichment-identity", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: { kind: "company", ticker: "2072", legalName: "公司", displayName: "公司", unifiedBusinessNumber: "11111111", industryCode: "24", listedAt: "2000-01-01" } });
    await f.persistence.appendResearchIdentityRecords([identityRecord]);
    const prior = { ...f.scan, id: "prior_snapshot", listingId: identityRecord.listing.id, issuerId: identityRecord.issuer.id,
      checkedAt: "2026-10-04T03:00:00.000Z", knowledgeAt: "2026-10-04T03:00:00.000Z", publicationEnd: "2026-10-04T03:00:00.000Z",
      provenance: { ...f.scan.provenance, retrievedAt: "2026-10-04T03:00:00.000Z", processedAt: "2026-10-04T03:00:00.000Z" } };
    await f.persistence.appendResearchDisclosureScans([prior]);
    const rows = readFileSync(new URL("../fixtures/research/twse-announcements.json", import.meta.url), "utf8");
    const history = readFileSync(new URL("../fixtures/research/mops-history-2072.json", import.meta.url), "utf8");
    const detail = readFileSync(new URL("../fixtures/research/mops-detail-2072.json", import.meta.url), "utf8");
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: true, announcementsTpexEnabled: false });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(snapshotAt);
      const fetchImpl = vi.fn(async (url: string | URL | Request) => {
        const source = String(url);
        if (source.endsWith("t05st01_detail")) vi.setSystemTime(completedAt);
        return new Response(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows,
          { headers: { "content-type": "application/json" } });
      }) as unknown as typeof fetch;
      await runOfficialDisclosureAcquisition(f.persistence, { fetchImpl, acquisitionRunId: "slow_enrichment" });
      const subject = { kind: "listing_id" as const, listingId: identityRecord.listing.id };
      const beforeCompletion = await listMaterialAnnouncements(f.persistence, { subject,
        context: { knowledgeAt: "2026-10-04T03:30:00.000Z", effectiveAt: "2026-10-04T03:30:00.000Z" } });
      expect(beforeCompletion.scan.record).toEqual(prior);
      const page = await listMaterialAnnouncements(f.persistence, { subject, context });
      expect(page.scan.record).toMatchObject({ checkedAt: snapshotAt, publicationEnd: snapshotAt, knowledgeAt: completedAt,
        provenance: { retrievedAt: snapshotAt, processedAt: completedAt } });
      expect(page.scan.status).toBe("indeterminate");
      const acquired = page.items.find((item) => item.provenance.acquisitionRunId === "slow_enrichment")!;
      expect(acquired.detailQuality?.status).toBe("available");
      const reference = { kind: "announcement" as const, announcementId: acquired.id };
      const report = composeFocusedDisclosureResearchReport({ identity: await getResearchIdentity(f.persistence, { subject, context, history: { limit: 1 } }),
        announcementPages: [page], candidates: [{ ...candidate, statement: acquired.explanation.text,
          statusEvidence: { reference, excerpt: acquired.explanation.text }, triggeringEvidence: [reference] }] });
      expect(report.officialScanGate.status).toBe("withheld");
      expect(report.assessments[0]!.reasonCodes).toContain("official_scan_indeterminate");
      expect((await f.persistence.listResearchDisclosureScans({ issuerId: identityRecord.issuer.id, effectiveAt: context.effectiveAt, knowledgeAt: context.knowledgeAt })).find((scan) => scan.id === prior.id)).toEqual(prior);
    } finally { vi.useRealTimers(); }
  });
  it("failed refresh after current success: keep supported source → expose degraded latest attempt", async () => {
    const f = await seeded();
    await f.persistence.appendResearchDisclosureScans([{ ...f.scan, id: "scan_failed_refresh", checkedAt: "2026-10-04T03:59:00.000Z", status: "failed" }]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate], readBudget: 10 });
    expect(report.officialScanGate.status).toBe("passed");
    expect(report.assessments[0]!.sourceSupport).toBe("supported");
    expect(report.announcementPages[0]!.scan.record?.id).toBe("scan_1");
    expect(report.announcementPages[0]!.scan.latestAttempt?.status).toBe("failed");
    expect(report.announcementPages[0]!.quality.readiness.currentAssessment).toBe("degraded");
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain("Latest acquisition attempt: failed");
    expect(renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW")).toContain("最近擷取嘗試: 失敗");
  });
  it("failed refresh beyond thirty-minute success boundary: preserve facts → withhold current assessment", async () => {
    const f = await seeded();
    await f.persistence.appendResearchDisclosureScans([{ ...f.scan, id: "scan_failed_refresh", checkedAt: "2026-10-04T03:59:00.000Z", status: "failed" }]);
    const laterQuery = { ...f.query, context: { ...f.query.context, knowledgeAt: "2026-10-04T04:21:00.000Z", effectiveAt: "2026-10-04T04:21:00.000Z" } };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, laterQuery, { candidates: [candidate], readBudget: 10 });
    expect(report.officialScanGate.status).toBe("withheld");
    expect(report.announcementPages[0]!.scan.status).toBe("indeterminate");
    expect(report.announcementPages[0]!.scan.checkedAt).toBe("2026-10-04T03:50:00.000Z");
    expect(report.assessments[0]!.reasonCodes).toContain("official_scan_indeterminate");
    expect(report.announcementPages[0]!.items[0]!.explanation.text).toBe(f.announcement.explanation);
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain("Latest acquisition attempt: failed");
  });

  it("open source conflict: two retained variants → withhold only their dependent judgments", async () => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([
      { ...f.announcement, collectionRecordId: "same_publisher_observation" },
      { ...f.announcement, id: "conflicting_variant", collectionRecordId: "same_publisher_observation", explanation: "更正後規劃尚未確定。" },
      { ...f.announcement, id: "independent_announcement", collectionRecordId: "independent_publisher_observation" },
    ]);
    await f.persistence.appendResearchDisclosureArtifacts([f.artifact]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const independentReference = { kind: "announcement" as const, announcementId: "independent_announcement" };
    const independent = { ...candidate, id: "independent_judgment", triggeringEvidence: [independentReference], statusEvidence: { ...candidate.statusEvidence, reference: independentReference } };
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, artifactCandidate, independent], readBudget: 10 });
    expect(report.assessments.map((assessment) => assessment.sourceSupport)).toEqual(["withheld", "withheld", "supported"]);
    expect(report.assessments[0]!.reasonCodes).toContain("announcement_conflict_unresolved");
    expect(report.assessments[1]!.reasonCodes).toContain("artifact_parent_conflict_unresolved");
    expect(report.officialScanGate.status).toBe("passed");
    expect(literalMarkdownText(renderFocusedDisclosureResearchReportMarkdown(report))).toContain("Unresolved source conflict: announcement_1");
  });

});
