import { listMaterialAnnouncements } from "../../../src/services/research/disclosures.js";
import type { Persistence } from "../../../src/persistence/types.js";
import type { ResearchAnnouncementRecord } from "../../../src/services/research/disclosureContracts.js";

export async function disclosurePublisherIdentityScenario(persistence: Persistence, base: ResearchAnnouncementRecord, knowledgeAt: string) {
  const a = { ...base, id: "publisher_a", collectionRecordId: "collection_a", publisherRecordId: "mops_a", relations: [] };
  const b = { ...a, id: "publisher_b", publisherRecordId: "mops_b" };
  const a2 = { ...a, id: "publisher_a2", collectionRecordId: "collection_a2", ruleClause: "changed", eventDate: "2026-08-31" };
  const unknown = { ...a, id: "unknown_publisher", collectionRecordId: "collection_unknown", publisherRecordId: undefined };
  await persistence.appendResearchAnnouncements([a, b, a2, unknown]);
  const scope = { issuerId: base.issuerId, listingId: base.listingId, venue: base.venue, effectiveAt: knowledgeAt, knowledgeAt };
  const query = { ...scope, kind: "revision" as const, collectionRecordId: a.collectionRecordId, publishedAt: base.publishedAt, subject: base.subject };
  const samePublisher = await persistence.findResearchAnnouncementCandidates({ ...query, publisherRecordId: "mops_a" });
  const differentPublisher = await persistence.findResearchAnnouncementCandidates({ ...query, publisherRecordId: "mops_b" });
  const noProof = await persistence.findResearchAnnouncementCandidates({ ...query, collectionRecordId: "new_unknown_collection" });
  const window = await persistence.listResearchAnnouncementSelectionMetadata({ ...scope, publishedFrom: base.publishedAt, publishedTo: base.publishedAt, eventFrom: "2026-09-01", eventTo: "2026-09-01" });
  const page = await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: base.listingId }, context: { knowledgeAt } });
  const pages = [page];
  while (pages.at(-1)!.page.nextCursor) pages.push(await listMaterialAnnouncements(persistence, { subject: { kind: "listing_id", listingId: base.listingId }, cursor: pages.at(-1)!.page.nextCursor! }));
  return { samePublisher, differentPublisher, noProof, window, pages };
}
