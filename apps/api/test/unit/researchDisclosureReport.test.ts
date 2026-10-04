import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { disclosureCandidateSchema } from "../../src/services/research/disclosureReport.js";

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
const artifactCandidate = { ...candidate, id: "artifact_dependent", statement: "Planned capacity is 100 units",
  statusEvidence: { reference: { kind: "artifact_claim" as const, artifactId: "artifact_1", claimId: "claim_1" }, excerpt: "Planned capacity is 100 units" }, triggeringEvidence: [{ kind: "artifact_claim" as const, artifactId: "artifact_1", claimId: "claim_1" }] };

describe("focused disclosure report", () => {
  beforeEach(() => setResearchRolloutOverrideForTest({ skillExposureEnabled: true, mcpExposureEnabled: true }));
  afterEach(() => setResearchRolloutOverrideForTest(null));
  it.each(["TWSE", "TPEX"] as const)("%s issuer: retained official evidence → independent classifications and faithful rendering", async (venue) => {
    const f = await seeded(venue);
    const candidates = (["observed", "scheduled", "conditional", "speculative"] as const).map((status) => {
      const excerpt = status === "observed" ? "董事會於2026-10-03決議擴建產能" : candidate.statement;
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
  it.each(["restricted", "processing_failed", "unavailable"] as const)("artifact %s: dependent evidence unavailable → independent facts and scan remain usable", async (state) => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureArtifacts([{ ...f.artifact, state }]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, artifactCandidate], readBudget: 10 });
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "withheld"]);
    expect(report.officialScanGate.status).toBe("passed");
    expect(report.artifactPages[0]!.artifact!.blocks).toEqual([]);
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain(f.announcement.explanation);
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
  it("missing retained artifact: unavailable dependency → only dependent claim withheld", async () => {
    const f = await fixture();
    await f.persistence.appendResearchAnnouncements([f.announcement]);
    await f.persistence.appendResearchDisclosureScans([f.scan]);
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate, artifactCandidate], readBudget: 10 });
    expect(report.assessments.map((item) => item.support)).toEqual(["provisional", "withheld"]);
    expect(report.officialScanGate.status).toBe("passed");
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
  it("planned future event mislabeled observed: authentic excerpt → status withheld", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [{ ...candidate, status: "observed", statusEvidence: { ...candidate.statusEvidence, eventDate: "2027-01-01", eventDateText: "2027-01-01" } }], readBudget: 10 });
    expect(report.assessments[0]!.reasonCodes).toContain("classification_date_not_verified");
    expect(report.assessments[0]!.reasonCodes).toContain("classification_status_not_verified");
    expect(disclosureCandidateSchema.safeParse({ ...candidate, status: "scheduled" }).success).toBe(false);
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
  it("zh-TW rendering: localized labels and policy explanations → identical original evidence and claims", async () => {
    const f = await seeded();
    const report = await buildFocusedDisclosureResearchReport(f.persistence, f.query, { candidates: [candidate], readBudget: 10 });
    const before = JSON.stringify(report);
    const en = renderFocusedDisclosureResearchReportMarkdown(report, "en");
    const zh = renderFocusedDisclosureResearchReportMarkdown(report, "zh-TW");
    expect(zh).toContain("台灣重大訊息研究");
    expect(zh).toContain("本專題報告未評估其他必要條件，因此不提出最終建議。");
    expect(zh).toContain("催化因素 / 有條件 / 暫定");
    expect(zh).toContain(f.announcement.explanation);
    expect(en).toContain(f.announcement.explanation);
    expect(JSON.stringify(report)).toBe(before);
    expect(report.assessments[0]!.sourceSupport).toBe("supported");
    expect(report.assessments[0]!.interpretationType).toBe("analytical_judgment");
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
    expect(renderFocusedDisclosureResearchReportMarkdown(report)).toContain("Unresolved source conflict: announcement_1");
  });

});
