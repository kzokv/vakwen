import { createHash } from "node:crypto";
import type { Persistence } from "../../persistence/types.js";
import type {
  ResearchIdentityQuery,
  ResearchQuery,
  ResearchTemporalContext,
} from "./contracts.js";
import type { CanonicalIdentityObservation, ResearchIdentityRecord } from "./identity.js";
import { researchSkillExposureEnabled } from "./rollout.js";

export class ResearchServiceError extends Error {
  readonly statusCode = 422;

  constructor(
    readonly code:
      | "research_subject_not_found"
      | "research_subject_ambiguous"
      | "research_cursor_invalid",
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

function cursorOffset(
  cursor: string | undefined,
  listingId: string,
  context: ResearchTemporalContext,
): number {
  if (!cursor) return 0;
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
    || (decoded as { version?: unknown }).version !== 1
    || !Number.isSafeInteger((decoded as { offset?: unknown }).offset)
    || Number((decoded as { offset?: unknown }).offset) < 0
    || (decoded as { binding?: unknown }).binding !== historyCursorBinding(listingId, context)
  ) {
    throw new ResearchServiceError(
      "research_cursor_invalid",
      "The research history cursor does not match the immutable listing and temporal context",
    );
  }
  return Number((decoded as { offset: number }).offset);
}

function encodeCursor(
  offset: number,
  listingId: string,
  context: ResearchTemporalContext,
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    offset,
    binding: historyCursorBinding(listingId, context),
  }), "utf8").toString("base64url");
}

function resolvableListingIds(records: ResearchIdentityRecord[]): string[] {
  const latestByListing = new Map<string, ResearchIdentityRecord>();
  for (const record of records) latestByListing.set(record.listing.id, record);
  const activeIds = [...latestByListing.values()]
    .filter((record) => record.listing.status === "active")
    .map((record) => record.listing.id);
  return activeIds.length > 0 ? activeIds : [...latestByListing.keys()];
}

function latestFacts(records: ResearchIdentityRecord[]): CanonicalIdentityObservation[] {
  const facts = new Map<string, CanonicalIdentityObservation>();
  for (const record of records) {
    for (const observation of record.observations) {
      facts.set(`${observation.subject.kind}:${observation.subject.id}:${observation.field}`, observation);
    }
  }
  return [...facts.values()];
}

export async function getResearchIdentity(
  persistence: Persistence,
  query: ResearchIdentityQuery,
) {
  const matchedRecords = await persistence.listResearchIdentityRecords({
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
  const listingIds = query.subject.kind === "listing_id"
    ? [query.subject.listingId]
    : resolvableListingIds(matchedRecords);
  if (listingIds.length !== 1) {
    throw new ResearchServiceError(
      "research_subject_ambiguous",
      "The ticker and venue resolve to more than one canonical listing",
      { listingIds },
    );
  }
  const records = query.subject.kind === "listing_id"
    ? matchedRecords
    : await persistence.listResearchIdentityRecords({
        subject: { kind: "listing_id", listingId: listingIds[0]! },
        effectiveAt: query.context.effectiveAt,
        knowledgeAt: query.context.knowledgeAt,
      });

  const listingId = listingIds[0]!;
  const latest = records.at(-1)!;
  const offset = cursorOffset(query.history.cursor, listingId, query.context);
  if (offset >= records.length && offset !== 0) {
    throw new ResearchServiceError("research_cursor_invalid", "The research history cursor is outside the available history");
  }
  const items = records.slice(offset, offset + query.history.limit);
  const nextOffset = offset + items.length;
  return {
    contractVersion: "research-identity/1.0.0" as const,
    selector: { kind: "listing_id" as const, listingId },
    context: query.context,
    identity: {
      issuer: latest.issuer,
      security: latest.security,
      listing: latest.listing,
      eligibility: latest.eligibility,
      facts: latestFacts(records),
      provenance: records.map((record) => record.provenance),
    },
    history: {
      items,
      nextCursor: nextOffset < records.length
        ? encodeCursor(nextOffset, listingId, query.context)
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
