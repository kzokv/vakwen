import { vi } from "vitest";
import type { Persistence } from "../../../src/persistence/types.js";
import { canonicalizeOfficialIdentityRow } from "../../../src/services/research/identity.js";
import { runOfficialDisclosureAcquisition } from "../../../src/services/research/disclosureAcquisition.js";
import { listMaterialAnnouncements } from "../../../src/services/research/disclosures.js";
import { setResearchRolloutOverrideForTest } from "../../../src/services/research/rollout.js";
import { OFFICIAL_ANNOUNCEMENT_SOURCES, parseOfficialAnnouncementSnapshot, disclosureHash } from "../../../src/services/research/providers/mopsAnnouncements.js";

export async function disclosureContinuationScenario(persistence: Persistence, venue: "TWSE" | "TPEX") {
  const at = "2026-10-04T05:00:00.000Z";
  const identity = canonicalizeOfficialIdentityRow({ venue, snapshotDate: "2026-10-03", retrievedAt: "2026-10-03T00:00:00.000Z", artifact: { contentHash: "rotation", sourceUrl: OFFICIAL_ANNOUNCEMENT_SOURCES[venue] }, row: { kind: "company", ticker: "7777", legalName: "輪替公司", displayName: "輪替公司", unifiedBusinessNumber: "77777777", industryCode: "24", listedAt: "2000-01-01" } });
  await persistence.appendResearchIdentityRecords([identity]);
  const rows = [0, 1, 2].map((index) => ({ 公司代號: "7777", 發言日期: "1151003", 發言時間: "090000", 主旨: `公告${index}`, 符合條款: "51", 事實發生日: "1151003", 說明: `保留內容${index}` }));
  const sourceUrl = OFFICIAL_ANNOUNCEMENT_SOURCES[venue];
  const records = parseOfficialAnnouncementSnapshot(rows, { retrievedAt: at, contentHash: disclosureHash(JSON.stringify(rows)), sourceUrl, acquisitionRunId: "rotation" }, venue, [identity]).sort((a, b) => a.id < b.id ? -1 : 1);
  setResearchRolloutOverrideForTest({ acquisitionEnabled: true, announcementsTwseEnabled: venue === "TWSE", announcementsTpexEnabled: venue === "TPEX" });
  const originalTimeout = AbortSignal.timeout.bind(AbortSignal);
  let controller = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => ms === 20 * 60 * 1000 ? controller.signal : originalTimeout(ms));
  const markers: string[] = [];
  let clock = at;
  try {
    for (let run = 0; run < records.length + 1; run++) {
      controller = new AbortController(); clock = new Date(Date.parse(at) + run * 60_000).toISOString();
      await runOfficialDisclosureAcquisition(persistence, { retrievedAt: clock, acquisitionRunId: `rotation_${run}`, fetchImpl: async (url, init) => {
        if (String(url) === sourceUrl) return new Response(JSON.stringify(rows));
        controller.abort(new DOMException("Board budget", "TimeoutError")); throw init?.signal?.reason;
      } });
      markers.push((await persistence.getLatestDisclosureAcquisitionContinuation({ venue, effectiveAt: clock, knowledgeAt: clock }))!.afterRecordId);
    }
    const scope = { venue, effectiveAt: clock, knowledgeAt: clock };
    const last = await persistence.getLatestDisclosureAcquisitionContinuation(scope);
    const failedAt = new Date(Date.parse(clock) + 60_000).toISOString();
    await runOfficialDisclosureAcquisition(persistence, { retrievedAt: failedAt, acquisitionRunId: "rotation_fetch_failed", fetchImpl: async () => new Response("denied", { status: 403 }) });
    const afterFailure = await persistence.getLatestDisclosureAcquisitionContinuation({ venue, effectiveAt: failedAt, knowledgeAt: failedAt });
    const page = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: identity.listing.id }, context: { knowledgeAt: clock } });
    return { rows, records, identity, markers, expected: [...records.map((record) => record.id), records[0]!.id], last, afterFailure, page, scope };
  } finally { timeout.mockRestore(); setResearchRolloutOverrideForTest(null); }
}
