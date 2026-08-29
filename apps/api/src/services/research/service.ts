import { createHash } from "node:crypto";
import type { Persistence } from "../../persistence/types.js";
import type {
  ResearchIdentityQuery,
  ResearchQuery,
  ResearchTemporalContext,
} from "./contracts.js";
import {
  researchIdentityHistoryPosition,
  researchIdentityRecordSortOrder,
  researchIdentityRevisionPrecedence,
  resolveResearchIdentityLatestState,
  type CanonicalIdentityObservation,
  type ResearchIdentityHistoryPosition,
  type ResearchIdentityRecord,
} from "./identity.js";
import { researchSkillExposureEnabled } from "./rollout.js";

export class ResearchServiceError extends Error {
  readonly statusCode = 422;

  constructor(
    readonly code:
      | "research_subject_not_found"
      | "research_subject_ambiguous"
      | "research_cursor_invalid"
      | "research_assessment_mode_unsupported",
    message: string,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ResearchServiceError";
  }
}

function persistenceSubject(query: ResearchIdentityQuery) {
  return query.subject.kind === "listing_id"
    ? { kind: "listing_id" as const, listingId: query.subject.listingId }
    : {
        kind: "ticker_venue" as const,
        ticker: query.subject.ticker,
        venue: query.subject.listingVenue,
      };
}

function historyCursorBinding(
  listingId: string,
  context: ResearchTemporalContext,
): string {
  return createHash("sha256")
    .update([
      listingId,
      context.effectiveAt,
      context.knowledgeAt,
      context.assessmentMode,
      context.policySetVersion ?? "",
    ].join("\u001f"))
    .digest("base64url")
    .slice(0, 32);
}

function cursorPosition(
  cursor: string | undefined,
  listingId: string,
  context: ResearchTemporalContext,
): ResearchIdentityHistoryPosition | undefined {
  if (!cursor) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ResearchServiceError("research_cursor_invalid", "The research history cursor is invalid");
  }
  if (
    !decoded
    || typeof decoded !== "object"
    || Array.isArray(decoded)
    || (decoded as { version?: unknown }).version !== 2
    || (decoded as { binding?: unknown }).binding !== historyCursorBinding(listingId, context)
  ) {
    throw new ResearchServiceError(
      "research_cursor_invalid",
      "The research history cursor does not match the immutable listing and temporal context",
    );
  }
  const position = (decoded as { position?: unknown }).position;
  if (
    !position
    || typeof position !== "object"
    || Array.isArray(position)
    || typeof (position as { effectiveAt?: unknown }).effectiveAt !== "string"
    || typeof (position as { retrievedAt?: unknown }).retrievedAt !== "string"
    || Number.isNaN(Date.parse((position as { effectiveAt: string }).effectiveAt))
    || Number.isNaN(Date.parse((position as { retrievedAt: string }).retrievedAt))
    || !Number.isSafeInteger((position as { revisionPrecedence?: unknown }).revisionPrecedence)
    || Number((position as { revisionPrecedence: number }).revisionPrecedence) < 0
    || Number((position as { revisionPrecedence: number }).revisionPrecedence) > 32_767
    || typeof (position as { recordKey?: unknown }).recordKey !== "string"
    || (position as { recordKey: string }).recordKey.length === 0
  ) {
    throw new ResearchServiceError("research_cursor_invalid", "The research history cursor is invalid");
  }
  return position as ResearchIdentityHistoryPosition;
}

function encodeCursor(
  position: ResearchIdentityHistoryPosition,
  listingId: string,
  context: ResearchTemporalContext,
): string {
  return Buffer.from(JSON.stringify({
    version: 2,
    position,
    binding: historyCursorBinding(listingId, context),
  }), "utf8").toString("base64url");
}

function resolvableListingIds(records: ResearchIdentityRecord[]): string[] {
  const revisionsByListing = new Map<string, ResearchIdentityRecord[]>();
  for (const record of records) {
    const revisions = revisionsByListing.get(record.listing.id) ?? [];
    revisions.push(record);
    revisionsByListing.set(record.listing.id, revisions);
  }
  const latestByListing = [...revisionsByListing.values()]
    .map((revisions) => resolveResearchIdentityLatestState(revisions)!)
    .filter((record): record is ResearchIdentityRecord => record !== undefined);
  const activeIds = latestByListing
    .filter((record) => record.listing.status === "active")
    .map((record) => record.listing.id);
  return activeIds.length > 0
    ? activeIds
    : latestByListing.map((record) => record.listing.id);
}

function resolveEffectiveTickerListings(
  query: ResearchIdentityQuery & { subject: { kind: "ticker_venue"; ticker: string; listingVenue: "TWSE" | "TPEX" } },
  matchedRecords: ResearchIdentityRecord[],
) {
  const revisionsByListing = new Map<string, ResearchIdentityRecord[]>();
  for (const record of matchedRecords) {
    const revisions = revisionsByListing.get(record.listing.id) ?? [];
    revisions.push(record);
    revisionsByListing.set(record.listing.id, revisions);
  }
  const effectiveMatches = [...revisionsByListing.values()]
    .map((revisions) => resolveResearchIdentityLatestState(revisions))
    .filter((record): record is ResearchIdentityRecord => record !== undefined)
    .filter((record) => record.listing.ticker === query.subject.ticker
      && record.listing.venue === query.subject.listingVenue);
  return resolvableListingIds(effectiveMatches);
}

function latestFacts(records: ResearchIdentityRecord[]): CanonicalIdentityObservation[] {
  const facts = new Map<string, CanonicalIdentityObservation>();
  const terminalStatusFacts: CanonicalIdentityObservation[] = [];
  for (const record of records) {
    for (const observation of record.observations) {
      if (researchIdentityRevisionPrecedence(record) > 0 && observation.field === "listing_status") {
        terminalStatusFacts.push(observation);
        continue;
      }
      facts.set(`${observation.subject.kind}:${observation.subject.id}:${observation.field}`, observation);
    }
  }
  for (const observation of terminalStatusFacts) {
    facts.set(`${observation.subject.kind}:${observation.subject.id}:${observation.field}`, observation);
  }
  return [...facts.values()];
}

function supportingProvenance(
  records: ResearchIdentityRecord[],
  facts: CanonicalIdentityObservation[],
  historyItems: ResearchIdentityRecord[],
) {
  const provenanceIds = new Set([
    ...facts.map((fact) => fact.provenanceId),
    ...historyItems.map((record) => record.provenance.id),
  ]);
  const provenanceById = new Map([...records]
    .sort(researchIdentityRecordSortOrder)
    .map((record) => record.provenance)
    .filter((provenance) => provenanceIds.has(provenance.id))
    .map((provenance) => [provenance.id, provenance]));
  return [...provenanceById.values()];
}

export async function getResearchIdentity(
  persistence: Persistence,
  query: ResearchIdentityQuery,
) {
  if (query.context.assessmentMode === "re_evaluate") {
    throw new ResearchServiceError(
      "research_assessment_mode_unsupported",
      "Research eligibility re-evaluation is unavailable until versioned policy sets are implemented",
      { policySetVersion: query.context.policySetVersion },
    );
  }
  const matchedRecords = await persistence.listResearchIdentityLatestRevisions({
    subject: persistenceSubject(query),
    effectiveAt: query.context.effectiveAt,
    knowledgeAt: query.context.knowledgeAt,
  });
  if (matchedRecords.length === 0) {
    throw new ResearchServiceError(
      "research_subject_not_found",
      "No canonical research identity matched the selector and temporal context",
    );
  }
  const tickerResolution = query.subject.kind === "ticker_venue"
    ? resolveEffectiveTickerListings({
        ...query,
        subject: query.subject,
      }, matchedRecords)
    : null;
  const listingIds = query.subject.kind === "listing_id"
    ? [query.subject.listingId]
    : tickerResolution!;
  if (listingIds.length === 0) {
    throw new ResearchServiceError(
      "research_subject_not_found",
      "No canonical research identity matched the selector's effective latest ticker state",
    );
  }
  if (listingIds.length !== 1) {
    throw new ResearchServiceError(
      "research_subject_ambiguous",
      "The ticker and venue resolve to more than one canonical listing",
      { listingIds },
    );
  }
  const listingId = listingIds[0]!;
  const latestRevisions = matchedRecords.filter((record) => record.listing.id === listingId);
  const latest = resolveResearchIdentityLatestState(latestRevisions)!;
  const after = cursorPosition(query.history.cursor, listingId, query.context);
  const page = await persistence.listResearchIdentityHistoryPage({
    subject: { kind: "listing_id", listingId },
    effectiveAt: query.context.effectiveAt,
    knowledgeAt: query.context.knowledgeAt,
    ...(after ? { after } : {}),
    limit: query.history.limit + 1,
  });
  if (after && page.length === 0) {
    throw new ResearchServiceError("research_cursor_invalid", "The research history cursor is outside the available history");
  }
  const items = page.slice(0, query.history.limit);
  const hasMore = page.length > query.history.limit;
  const facts = latestFacts(latestRevisions);
  return {
    contractVersion: "research-identity/1.0.0" as const,
    selector: { kind: "listing_id" as const, listingId },
    context: query.context,
    identity: {
      issuer: latest.issuer,
      security: latest.security,
      listing: latest.listing,
      eligibility: latest.eligibility,
      facts,
      provenance: supportingProvenance([...latestRevisions, ...items], facts, items),
    },
    history: {
      items,
      nextCursor: hasMore
        ? encodeCursor(researchIdentityHistoryPosition(items.at(-1)!), listingId, query.context)
        : null,
    },
  };
}

export const RESEARCH_DATASET_IDS = [
  "research_identity",
  "price_series",
  "exchange_valuation_references",
  "monthly_revenue",
  "financial_statements",
  "institutional_trading",
  "foreign_ownership",
  "margin_and_short_balances",
  "dividend_events",
  "material_announcements",
  "investor_materials",
] as const;

export async function getResearchManifest(
  persistence: Persistence,
  query: ResearchQuery,
) {
  const identity = await getResearchIdentity(persistence, {
    ...query,
    history: { limit: 1 },
  });
  return {
    contractVersion: "research-manifest/1.0.0" as const,
    selector: identity.selector,
    context: identity.context,
    eligibility: identity.identity.eligibility,
    orchestration: {
      skillExposure: researchSkillExposureEnabled() ? "enabled" as const : "disabled" as const,
    },
    datasets: RESEARCH_DATASET_IDS.map((id) => id === "research_identity"
      ? { id, status: "available" as const }
      : { id, status: "unavailable" as const, reasonCode: "identity_only_release" as const }),
  };
}
