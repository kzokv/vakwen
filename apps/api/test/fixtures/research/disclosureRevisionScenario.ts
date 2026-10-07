import { getResearchIdentity } from "../../../src/services/research/service.js";
import { composeFocusedDisclosureResearchReport } from "../../../src/services/research/disclosureReport.js";
import { readFileSync } from "node:fs";
import type { Persistence } from "../../../src/persistence/types.js";
import { canonicalizeOfficialIdentityRow } from "../../../src/services/research/identity.js";
import { runOfficialDisclosureAcquisition } from "../../../src/services/research/disclosureAcquisition.js";
import { listMaterialAnnouncements } from "../../../src/services/research/disclosures.js";
import { setResearchRolloutOverrideForTest } from "../../../src/services/research/rollout.js";
import { OFFICIAL_ANNOUNCEMENT_SOURCES } from "../../../src/services/research/providers/mopsAnnouncements.js";

/** Genuine acquisition sequence with unchanged collection bytes and A→B→A detail content. */
export async function disclosureReversionScenario(persistence: Persistence, venue: "TWSE" | "TPEX") {
  const ticker = venue === "TWSE" ? "2072" : "4530";
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z",
    artifact: { sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue], contentHash: "reversion_identity" },
    row: { kind: "company", ticker, legalName: "公司", displayName: "公司", unifiedBusinessNumber: "12345678", industryCode: "24", listedAt: "2000-01-01" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const load = (name: string) => JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
  const rows = load(`${venue.toLowerCase()}-announcements`), history = load(`mops-history-${ticker}`), detail = load(`mops-detail-${ticker}`);
  const index = detail.result.titles.findIndex((title: { main: string }) => title.main.trim() === "說明");
  const original = String(detail.result.data[0][index]);
  const subject = { kind: "listing_id" as const, listingId: identity.listing.id };
  const records: Awaited<ReturnType<Persistence["listResearchAnnouncements"]>>[] = [];
  const pages: Awaited<ReturnType<typeof listMaterialAnnouncements>>[] = [];
  const counts: number[] = [];
  const clocks = ["05:00", "05:15", "05:30", "05:45", "06:00"];
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  try {
    for (const [step, clock] of clocks.entries()) {
      detail.result.data[0][index] = step === 1 ? `${original}\nRevised detail B.` : original;
      const at = `2026-10-04T${clock}:00.000Z`;
      const fetchImpl: typeof fetch = async (url) => {
        const source = String(url);
        if (step === 4 && source.endsWith("t05st01")) return new Response("restricted", { status: 403 });
        return new Response(JSON.stringify(source.endsWith("t05st01_detail") ? detail : source.endsWith("t05st01") ? history : rows));
      };
      const result = await runOfficialDisclosureAcquisition(persistence, { fetchImpl, retrievedAt: at, acquisitionRunId: `reversion_${step}` });
      counts.push(result.outcomes.find((outcome) => outcome.venue === venue)!.announcementCount);
      records.push(await persistence.listResearchAnnouncements({ issuerId: identity.issuer.id, effectiveAt: at, knowledgeAt: at }));
      pages.push(await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: at } }));
    }
    const historical = await listMaterialAnnouncements(persistence, { subject, context: { knowledgeAt: "2026-10-04T05:20:00.000Z" } });
    const artifacts = await persistence.listResearchDisclosureArtifacts({ issuerId: identity.issuer.id, effectiveAt: "2026-10-04T06:00:00.000Z", knowledgeAt: "2026-10-04T06:00:00.000Z" });
    const context = { knowledgeAt: "2026-10-04T06:00:00.000Z", effectiveAt: "2026-10-04T06:00:00.000Z", assessmentMode: "effective" as const };
    const auditPages = [await listMaterialAnnouncements(persistence, { subject, context, evidenceView: "all_observations", limit: 1 })];
    while (auditPages.at(-1)!.page.nextCursor) auditPages.push(await listMaterialAnnouncements(persistence, { subject, cursor: auditPages.at(-1)!.page.nextCursor! }));
    const auditReport = composeFocusedDisclosureResearchReport({ identity: await getResearchIdentity(persistence, { subject, context, history: { limit: 1 } }), announcementPages: auditPages });
    return { records, pages, counts, historical, artifacts, original, auditReport };
  } finally { setResearchRolloutOverrideForTest(null); }
}
