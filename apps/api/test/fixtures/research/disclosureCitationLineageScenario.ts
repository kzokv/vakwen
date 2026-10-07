import type { Persistence } from "../../../src/persistence/types.js";
import type { ResearchAnnouncementRecord } from "../../../src/services/research/disclosureContracts.js";

export async function disclosureCitationLineageScenario(persistence: Persistence, base: ResearchAnnouncementRecord, knowledgeAt: string) {
  const seed = { ...base, id: "citation_seed", subject: "精確引用公告", relations: [] };
  const next = { ...base, id: "citation_next", subject: "更名後公告", publishedAt: new Date(Date.parse(base.publishedAt) - 24 * 3_600_000).toISOString(),
    relations: [{ kind: "supersedes" as const, targetAnnouncementId: seed.id }], provenance: { ...base.provenance, processedAt: knowledgeAt } };
  const tip = { ...next, id: "citation_tip", subject: "再次修訂標題", relations: [{ kind: "supersedes" as const, targetAnnouncementId: next.id }] };
  const before = new Date(Date.parse(base.publishedAt) + 30 * 60_000).toISOString();
  const scope = { issuerId: base.issuerId, listingId: base.listingId, venue: base.venue, effectiveAt: knowledgeAt, knowledgeAt };
  await persistence.appendResearchAnnouncements([seed, next, tip,
    { ...next, id: "foreign_listing", listingId: "other_listing" }, { ...next, id: "foreign_issuer", issuerId: "other_issuer" },
    { ...next, id: "foreign_venue", venue: base.venue === "TWSE" ? "TPEX" : "TWSE" },
    { ...next, id: "future_published", publishedAt: before }, { ...next, id: "future_knowledge", provenance: { ...next.provenance, processedAt: "2099-01-01T00:00:00.000Z" } },
    { ...next, id: "unavailable_source", quality: "restricted" },
    { ...next, id: "non_retiring_relation", relations: [{ kind: "corrects", targetAnnouncementId: seed.id }] },
    { ...base, id: "citation_cycle_a", subject: "循環公告", relations: [{ kind: "supersedes", targetAnnouncementId: "citation_cycle_b" }] },
    { ...base, id: "citation_cycle_b", subject: "循環公告", relations: [{ kind: "supersedes", targetAnnouncementId: "citation_cycle_a" }] },
  ]);
  const day = new Date(Date.parse(seed.publishedAt) + 8 * 3_600_000).toISOString().slice(0, 10);
  const query = { ...scope, kind: "citation" as const, before, titles: [seed.subject], days: [day] };
  const current = await persistence.findResearchAnnouncementCandidates(query);
  const historical = await persistence.findResearchAnnouncementCandidates({ ...query, knowledgeAt: base.provenance.processedAt, effectiveAt: base.provenance.processedAt });
  const cycle = await persistence.findResearchAnnouncementCandidates({ ...query, titles: ["循環公告"] });
  return { current, historical, cycle };
}
