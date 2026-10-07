import { composeFocusedDisclosureResearchReport } from "../../../src/services/research/disclosureReport.js";
import { getResearchIdentity } from "../../../src/services/research/service.js";
import { readFileSync } from "node:fs";
import type { Persistence } from "../../../src/persistence/types.js";
import { canonicalizeOfficialIdentityRow } from "../../../src/services/research/identity.js";
import { runOfficialDisclosureAcquisition } from "../../../src/services/research/disclosureAcquisition.js";
import { getDisclosureArtifact, listMaterialAnnouncements } from "../../../src/services/research/disclosures.js";
import { setResearchRolloutOverrideForTest } from "../../../src/services/research/rollout.js";
import { OFFICIAL_ANNOUNCEMENT_SOURCES } from "../../../src/services/research/providers/mopsAnnouncements.js";

/** Same official detail and attachment locator; only served bytes/access change. */
export async function disclosureAttachmentRevisionScenario(persistence: Persistence, venue: "TWSE" | "TPEX") {
  const ticker = venue === "TWSE" ? "2072" : "4530";
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z",
    artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], contentHash: "attachment_revision_identity" },
    row: { kind: "company", ticker, legalName: "公司", displayName: "公司", unifiedBusinessNumber: "12345678", industryCode: "24", listedAt: "2000-01-01" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const load = (name: string) => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
  const rows = load(`${venue.toLowerCase()}-announcements`), history = load(`mops-history-${ticker}`), detail = load(`mops-detail-${ticker}`);
  detail.result.titles.push({ main: "附件", sub: [] });
  detail.result.data[0].push({ url: "https://mops.twse.com.tw/unchanged.txt", fileName: "unchanged.txt" });
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const pages: Awaited<ReturnType<typeof listMaterialAnnouncements>>[] = [];
  const reads: Awaited<ReturnType<typeof getDisclosureArtifact>>[] = [];
  const counts: number[] = [];
  let requests = 0;
  let failureReport: ReturnType<typeof composeFocusedDisclosureResearchReport> | undefined;
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  try {
    for (const [step, content] of ["A", "B", "B", null, null, "A", "A"].entries()) {
      const at = new Date(Date.parse("2026-10-04T05:00:00.000Z") + step * 15 * 60_000).toISOString();
      const fetchImpl: typeof fetch = async (url) => {
        const source = String(url);
        if (source.endsWith("unchanged.txt")) { requests++; return content === null ? new Response("restricted", { status: 403 }) : new Response(content, { headers: { "content-type": "text/plain; charset=utf-8" } }); }
        return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
      };
      const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: `attachment_revision_${step}` });
      counts.push(result.outcomes.find((outcome) => outcome.venue === venue)!.announcementCount);
      const page = await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: at } }); pages.push(page);
      const artifactId = page.items[0]!.attachments.find((attachment) => attachment.sourceUrl.endsWith("unchanged.txt"))!.artifactId!;
      reads.push(await getDisclosureArtifact(persistence, { subject, context: { knowledgeAt: at }, artifactId }));
      if (step === 3) {
        const old = await getDisclosureArtifact(persistence, { subject, context: { knowledgeAt: at }, artifactId: reads[0]!.artifact!.id });
        const reference = { kind: "announcement" as const, announcementId: page.items[0]!.id };
        const candidate = { id: "inline", kind: "catalyst" as const, status: "conditional" as const,
          statement: page.items[0]!.explanation.text, statusEvidence: { reference, excerpt: page.items[0]!.explanation.text },
          materialMechanism: "The disclosed condition may affect operating capacity.", affectedMetricOrAssumption: "capacity", horizon: "next reporting period",
          triggeringEvidence: [reference], confirmingEvidence: [], disconfirmingEvidence: [], condition: "The disclosed conditions are met",
          confirmationCondition: "A subsequent official operating update", disconfirmationCondition: "An official cancellation" };
        failureReport = composeFocusedDisclosureResearchReport({ identity: await getResearchIdentity(persistence, { subject, context: page.context, history: { limit: 1 } }),
          announcementPages: [page], artifactPages: [reads.at(-1)!, old], candidates: [candidate,
            { ...candidate, id: "current_attachment", confirmingEvidence: [{ kind: "artifact_claim", artifactId, claimId: "unavailable_claim" }] },
            { ...candidate, id: "historical_attachment", confirmingEvidence: [{ kind: "artifact_claim", artifactId: old.artifact!.id, claimId: "historical_claim" }] }] });
      }

    }
    const context = { knowledgeAt: "2026-10-04T06:30:00.000Z" };
    const historical = await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: "2026-10-04T05:20:00.000Z" } });
    const oldRead = await getDisclosureArtifact(persistence, { subject, context, artifactId: reads[0]!.artifact!.id });
    const records = await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, effectiveAt: context.knowledgeAt, knowledgeAt: context.knowledgeAt });
    const artifacts = await persistence.listResearchDisclosureArtifacts({ issuerId: identity.issuer.id, effectiveAt: context.knowledgeAt, knowledgeAt: context.knowledgeAt });
    const agedAt = "2026-10-04T06:45:00.000Z";
    await runOfficialDisclosureAcquisition(persistence, { retrievedAt: agedAt, acquisitionRunId: "aged_out", fetchImpl: async (url) => {
      if (String(url) !== OFFICIAL_ANNOUNCEMENT_SOURCES[venue]) throw new Error("An aged-out attachment must not be fetched by a public read");
      return new Response("[]");
    } });
    const agedPage = await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: agedAt } });
    const agedRead = await getDisclosureArtifact(persistence, { subject, context: { knowledgeAt: agedAt }, artifactId: reads[6]!.artifact!.id });
    return { pages, reads, counts, requests, historical, oldRead, records, artifacts, failureReport: failureReport!, agedPage, agedRead };
  } finally { setResearchRolloutOverrideForTest(null); }
}
