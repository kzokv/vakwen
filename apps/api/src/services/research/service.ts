import { createHash } from "node:crypto";
import type { Persistence } from "../../persistence/types.js";
import { latestSettledTradingDayPure } from "../market-data/tradingCalendar.js";
import type {
  ResearchIdentityQuery,
  ResearchPriceMetricResult,
  ResearchPriceSeriesQuery,
  ResearchPriceSeriesOutput,
  ResearchQuery,
  ResearchPriceSession,
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
import {
  type CanonicalPriceObservation,
  type ResearchPriceRecord,
} from "./price.js";
import { researchSkillExposureEnabled } from "./rollout.js";

export class ResearchServiceError extends Error {
  readonly statusCode = 422;

  constructor(
    readonly code:
      | "research_subject_not_found"
      | "research_subject_ambiguous"
      | "research_cursor_invalid"
      | "research_assessment_mode_unsupported"
      | "research_record_too_large",
    message: string,
    readonly metadata?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ResearchServiceError";
  }
}

const PRICE_SERIES_PUBLIC_RESPONSE_BUDGET_BYTES = 256 * 1024;
// Reserve 16 KiB for the authenticated MCP wrapper and long follow-up cursor; the locked 256 KiB
// contract is verified against the final public structuredContent payload in the MCP suite.
const PRICE_SERIES_RESPONSE_BUDGET_RESERVE_BYTES = 16 * 1024;
const PRICE_SERIES_RESPONSE_BUDGET_BYTES = PRICE_SERIES_PUBLIC_RESPONSE_BUDGET_BYTES - PRICE_SERIES_RESPONSE_BUDGET_RESERVE_BYTES;
const PRICE_SERIES_CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const RESEARCH_PRICE_CURSOR_VERSION = 2;
const RESEARCH_PRICE_CURSOR_PURPOSE = "canonical_research_price_series_read";
const RESEARCH_PRICE_CONTRACT_VERSION = "research-price-series/1.0.0";
const RESEARCH_PRICE_DATASET_VERSION = "price_series/1.0.0";
const RESEARCH_PRICE_FRESHNESS_POLICY_VERSION = "taiwan-authoritative-freshness/1.0.0";
const RESEARCH_PRICE_METRIC_POLICY_VERSION = "research-price-metrics/1.0.0";
const RESEARCH_PRICE_RUNTIME_POLICY_VERSION = "canonical-store-only/1.0.0";
const METRIC_LINEAGE_MAX_RETURNED_OBSERVATIONS = 64;

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
      const precedence = researchIdentityRevisionPrecedence(record);
      if (precedence === 2) continue;
      if (precedence === 1 && observation.field === "listing_status") {
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
  const sessionDates = await persistence.getDistinctResearchPriceSessionDates(
    identity.identity.listing.venue,
    identity.identity.listing.listedAt,
    identity.context.knowledgeAt,
  );
  const listingSessions = await persistence.listLatestResearchPriceRecords({
    subject: { kind: "listing_id", listingId: identity.selector.listingId },
    startDate: identity.identity.listing.listedAt,
    endDate: sessionDates.at(-1) ?? identity.identity.listing.listedAt,
    knowledgeAt: identity.context.knowledgeAt,
  });
  const hasPriceSeries = identity.identity.eligibility.state === "eligible"
    && identity.identity.eligibility.profile !== "identity_only"
    && listingSessions.length > 0;
  return {
    contractVersion: "research-manifest/1.0.0" as const,
    selector: identity.selector,
    context: identity.context,
    eligibility: identity.identity.eligibility,
    orchestration: {
      skillExposure: researchSkillExposureEnabled() ? "enabled" as const : "disabled" as const,
    },
    datasets: RESEARCH_DATASET_IDS.map((id) => {
      if (id === "research_identity") return { id, status: "available" as const };
      if (id === "price_series") {
        if (identity.identity.eligibility.profile === "identity_only") {
          return { id, status: "unavailable" as const, reasonCode: "identity_only_profile" as const };
        }
        return hasPriceSeries
          ? {
              id,
              status: "available" as const,
              capabilities: {
                scopeKinds: ["latest", "latest_sessions", "date_range"],
                basis: ["raw", "corporate_action_adjusted"],
                metrics: [
                  "simple_price_return",
                  "total_shareholder_return",
                  "annualized_realized_volatility",
                  "maximum_drawdown",
                  "average_daily_volume",
                  "average_daily_traded_value",
                ],
                pageDefault: 60,
                pageMax: 260,
                maxWindowSessions: 1260,
                maxSpanYears: 5,
              },
            }
          : { id, status: "unavailable" as const, reasonCode: "no_authoritative_price_history" as const };
      }
      return { id, status: "unavailable" as const, reasonCode: "identity_only_release" as const };
    }),
  };
}

type ResearchIdentityResult = Awaited<ReturnType<typeof getResearchIdentity>>;

function priceSeriesCursorBinding(listingId: string, query: ResearchPriceSeriesQuery): string {
  return createHash("sha256")
    .update(JSON.stringify({
      listingId,
      authContext: {
        knowledgeAt: query.context.knowledgeAt,
        effectiveAt: query.context.effectiveAt,
        assessmentMode: query.context.assessmentMode,
        policySetVersion: query.context.policySetVersion ?? null,
      },
      normalizedQuery: {
        scope: query.scope,
        basis: query.basis,
        order: query.order,
        metrics: query.metrics,
        limit: query.page.limit,
      },
      purposes: [RESEARCH_PRICE_CURSOR_PURPOSE, "mcp:get_price_series"],
      versions: {
        contractVersion: RESEARCH_PRICE_CONTRACT_VERSION,
        datasetVersion: RESEARCH_PRICE_DATASET_VERSION,
        metricPolicyVersion: RESEARCH_PRICE_METRIC_POLICY_VERSION,
        freshnessPolicyVersion: RESEARCH_PRICE_FRESHNESS_POLICY_VERSION,
        runtimePolicyVersion: RESEARCH_PRICE_RUNTIME_POLICY_VERSION,
      },
    }))
    .digest("base64url")
    .slice(0, 48);
}

function encodePriceSeriesCursor(listingId: string, query: ResearchPriceSeriesQuery, sessionDate: string): string {
  return Buffer.from(JSON.stringify({
    version: RESEARCH_PRICE_CURSOR_VERSION,
    binding: priceSeriesCursorBinding(listingId, query),
    issuedAt: new Date().toISOString(),
    sessionDate,
  }), "utf8").toString("base64url");
}

function decodePriceSeriesCursor(listingId: string, query: ResearchPriceSeriesQuery, cursor?: string): string | null {
  if (!cursor) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ResearchServiceError("research_cursor_invalid", "The price-series cursor is invalid");
  }
  if (
    !decoded
    || typeof decoded !== "object"
    || Array.isArray(decoded)
    || (decoded as { version?: unknown }).version !== RESEARCH_PRICE_CURSOR_VERSION
    || (decoded as { binding?: unknown }).binding !== priceSeriesCursorBinding(listingId, query)
    || typeof (decoded as { sessionDate?: unknown }).sessionDate !== "string"
    || typeof (decoded as { issuedAt?: unknown }).issuedAt !== "string"
  ) {
    throw new ResearchServiceError("research_cursor_invalid", "The price-series cursor does not match the bound query");
  }
  const issuedAtMs = Date.parse((decoded as { issuedAt: string }).issuedAt);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > Date.now()) {
    throw new ResearchServiceError("research_cursor_invalid", "The price-series cursor is invalid");
  }
  if (Date.now() - issuedAtMs > PRICE_SERIES_CURSOR_TTL_MS) {
    throw new ResearchServiceError("research_cursor_invalid", "The price-series cursor has expired");
  }
  return (decoded as { sessionDate: string }).sessionDate;
}

function taipeiLocalParts(instant: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  return {
    localDate: `${parts.year}-${parts.month}-${parts.day}`,
    localHour: Number(parts.hour),
    localMinute: Number(parts.minute),
  };
}

function previousDate(date: string): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (days * 86_400_000)).toISOString().slice(0, 10);
}

function maxDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function marketCodeForVenue(): "TW" {
  return "TW";
}

async function loadTradingCalendarVersions(
  persistence: Persistence,
  startDate: string,
  endDate: string,
) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const versions = new Map<number, Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>>();
  for (let year = startYear; year <= endYear; year += 1) {
    versions.set(year, await persistence.getActiveMarketCalendarVersion("TW", year));
  }
  return versions;
}

function isTradingDayFromCalendar(
  date: string,
  versions: ReadonlyMap<number, Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>>,
): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const weekdayOpenByDefault = day !== 0 && day !== 6;
  const version = versions.get(Number(date.slice(0, 4)));
  const exception = version?.exceptions.find((item) => item.date === date);
  if (exception) return exception.status === "open";
  return weekdayOpenByDefault;
}

function enumerateTradingDates(
  startDate: string,
  endDate: string,
  versions: ReadonlyMap<number, Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>>,
): string[] {
  const dates: string[] = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
    if (isTradingDayFromCalendar(current, versions)) dates.push(current);
  }
  return dates;
}

async function authoritativeCutoffDate(
  persistence: Persistence,
  knowledgeAt: string,
): Promise<string | null> {
  const { localDate, localHour, localMinute } = taipeiLocalParts(knowledgeAt);
  const candidate = localHour > 18 || (localHour === 18 && localMinute >= 0)
    ? localDate
    : previousDate(localDate);
  const windowStart = addDays(candidate, -45);
  const versions = await loadTradingCalendarVersions(persistence, windowStart, candidate);
  const tradingDates = new Set(enumerateTradingDates(windowStart, candidate, versions));
  return latestSettledTradingDayPure(tradingDates, marketCodeForVenue(), new Date(`${candidate}T23:59:59.000Z`));
}

async function expectedTradingDatesForQuery(
  persistence: Persistence,
  listingListedAt: string,
  scope: ResearchPriceSeriesQuery["scope"],
  authoritativeAsOf: string | null,
): Promise<string[]> {
  if (!authoritativeAsOf) return [];
  if (scope.kind === "date_range") {
    const boundedEndDate = scope.endDate <= authoritativeAsOf ? scope.endDate : authoritativeAsOf;
    const startDate = maxDate(listingListedAt, scope.startDate);
    if (startDate > boundedEndDate) return [];
    const versions = await loadTradingCalendarVersions(persistence, startDate, boundedEndDate);
    return enumerateTradingDates(startDate, boundedEndDate, versions);
  }
  const sessionCount = scope.kind === "latest_sessions" ? scope.count : 1;
  const lookbackDays = Math.max(31, sessionCount * 3);
  const startDate = maxDate(listingListedAt, addDays(authoritativeAsOf, -lookbackDays));
  const versions = await loadTradingCalendarVersions(persistence, startDate, authoritativeAsOf);
  const tradingDates = enumerateTradingDates(startDate, authoritativeAsOf, versions);
  return scope.kind === "latest"
    ? tradingDates.slice(-1)
    : tradingDates.slice(-scope.count);
}

function authoritativeFreshness(knowledgeAt: string, authoritativeAsOf: string | null, latestBarDate: string | null, endDate: string) {
  if (!authoritativeAsOf || endDate < authoritativeAsOf) {
    return { state: "not_applicable" as const, authoritativeAsOf };
  }
  const { localDate, localHour } = taipeiLocalParts(knowledgeAt);
  if (latestBarDate && latestBarDate >= authoritativeAsOf) {
    return { state: "current" as const, authoritativeAsOf };
  }
  if (authoritativeAsOf < localDate) {
    return { state: "stale" as const, authoritativeAsOf };
  }
  if (localHour < 18) return { state: "not_yet_due" as const, authoritativeAsOf };
  if (localHour < 22) return { state: "due_pending" as const, authoritativeAsOf };
  return { state: "stale" as const, authoritativeAsOf };
}

function priceObservationValue(
  record: ResearchPriceRecord,
  field: string,
): string | undefined {
  const observation = record.observations.find((item) => item.field === field);
  return observation?.normalized.state === "present" ? observation.normalized.value : undefined;
}

function priceObservationNumber(
  record: ResearchPriceRecord,
  field: string,
): number | null {
  const value = priceObservationValue(record, field);
  if (value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function requiredPriceObservationNumber(record: ResearchPriceRecord, field: string): number {
  const value = priceObservationNumber(record, field);
  if (value === null) {
    throw new Error(`research_price_record_invalid: missing or invalid ${field} for ${record.state}`);
  }
  return value;
}

function priceSessionProvenance(record: ResearchPriceRecord) {
  return {
    provenanceId: record.provenance.id,
    publisher: record.provenance.publisher,
    accessProvider: record.provenance.accessProvider,
    sourceUrl: record.provenance.sourceUrl,
    contentHash: record.provenance.contentHash,
    barDate: record.sessionDate,
    retrievedAt: record.provenance.retrievedAt,
  };
}

function metricWindowDates(dates: string[], requested: { windowSessions?: number }): string[] {
  const windowSessions = Math.min(requested.windowSessions ?? dates.length, 1260);
  return dates.slice(-windowSessions);
}

function metricLineageObservations(
  metricId: ResearchPriceSeriesQuery["metrics"][number]["id"],
  sessionDates: string[],
  recordByDate: ReadonlyMap<string, ResearchPriceRecord>,
) {
  const field = metricId === "average_daily_volume"
    ? "volume"
    : metricId === "average_daily_traded_value"
      ? "traded_value"
      : "close";
  return sessionDates.map((sessionDate) =>
    recordByDate.get(sessionDate)?.observations.find((observation) =>
      observation.field === field && observation.normalized.state === "present"
    ),
  );
}

function boundedMetricLineage(
  observationInputs: string[],
  observations: CanonicalPriceObservation[],
) {
  const allObservationIds = observations.map((observation) => observation.id);
  const allProvenanceIds = observations.map((observation) => observation.provenanceId);
  const completeProvenanceIds = [...new Set(allProvenanceIds)];
  const bounded = observationInputs.length > METRIC_LINEAGE_MAX_RETURNED_OBSERVATIONS;
  const indices = bounded
    ? [
        ...Array.from({ length: METRIC_LINEAGE_MAX_RETURNED_OBSERVATIONS / 2 }, (_, index) => index),
        ...Array.from(
          { length: METRIC_LINEAGE_MAX_RETURNED_OBSERVATIONS / 2 },
          (_, index) => observationInputs.length - (METRIC_LINEAGE_MAX_RETURNED_OBSERVATIONS / 2) + index,
        ),
      ]
    : observationInputs.map((_, index) => index);
  const returnedObservationInputs = indices.map((index) => observationInputs[index]!);
  const returnedObservationIds = indices.map((index) => allObservationIds[index]!);
  const returnedProvenanceIds = [...new Set(indices.map((index) => allProvenanceIds[index]!))];
  const digest = createHash("sha256")
    .update(JSON.stringify(observationInputs.map((date, index) => [
      date,
      allObservationIds[index],
      allProvenanceIds[index],
    ])))
    .digest("hex");
  return {
    observationInputs: returnedObservationInputs,
    observationIds: returnedObservationIds,
    provenanceIds: returnedProvenanceIds,
    lineage: {
      state: bounded ? "bounded" as const : "complete" as const,
      totalObservationCount: observationInputs.length,
      returnedObservationCount: returnedObservationInputs.length,
      totalProvenanceCount: completeProvenanceIds.length,
      maxReturnedObservations: METRIC_LINEAGE_MAX_RETURNED_OBSERVATIONS as 64,
      digestAlgorithm: "sha256" as const,
      digest,
    },
  };
}

function buildMetricResult(
  metric: ResearchPriceSeriesQuery["metrics"][number],
  sessions: ResearchPriceSession[],
  recordByDate: ReadonlyMap<string, ResearchPriceRecord>,
  profile: ResearchIdentityResult["identity"]["eligibility"]["profile"],
  calculatedAt: string,
): ResearchPriceMetricResult {
  const windowSessions = Math.min(metric.windowSessions ?? sessions.length, 1260);
  const windowedDates = metricWindowDates(
    sessions.map((session) => session.sessionDate),
    metric,
  );
  if (profile === "identity_only") {
    return { status: "not_applicable" as const, id: metric.id, windowSessions, reasonCode: "identity_only_profile" as const };
  }
  const windowed = sessions.filter((session) => windowedDates.includes(session.sessionDate));
  if (windowed.length < windowSessions) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
  }
  if ((metric.id === "average_daily_volume" || metric.id === "average_daily_traded_value")
    && windowed.some((session) => session.state === "settled_close_only")) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "close_only_series" as const };
  }
  if (
    windowed.length === 0
    || windowed.some((session) =>
      session.state === "missing"
      || session.state === "stale"
      || session.state === "suspended"
    )
  ) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
  }
  if (windowed.some((session) => session.state === "corporate_action_incomplete")) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "corporate_action_incomplete" as const };
  }
  if (metric.id === "total_shareholder_return") {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "corporate_action_incomplete" as const };
  }
  if ((metric.id === "average_daily_volume" || metric.id === "average_daily_traded_value")
    && windowed.some((session) => session.state !== "settled_full_bar" && session.state !== "no_trade")) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "close_only_series" as const };
  }
  const calculationObservationInputs = windowed.map((session) => session.sessionDate);
  const lineageObservations = metricLineageObservations(metric.id, calculationObservationInputs, recordByDate);
  if (lineageObservations.some((observation) => observation === undefined)) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
  }
  const metricLineage = boundedMetricLineage(
    calculationObservationInputs,
    lineageObservations as CanonicalPriceObservation[],
  );
  if (metric.id === "average_daily_volume") {
    const volumeValues = calculationObservationInputs.map((sessionDate) => {
      const record = recordByDate.get(sessionDate);
      return record ? priceObservationNumber(record, "volume") : null;
    });
    if (volumeValues.some((value) => value === null)) {
      return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
    }
    const presentVolumeValues = volumeValues as number[];
    return {
      status: "returned" as const,
      id: metric.id,
      windowSessions,
      value: presentVolumeValues.reduce((sum, value) => sum + value, 0) / presentVolumeValues.length,
      units: "shares",
      formulaId: "average_daily_volume",
      formulaVersion: "1.0.0",
      parameters: {},
      ...metricLineage,
      calculatedAt,
      rounding: "full_precision",
    };
  }
  if (metric.id === "average_daily_traded_value") {
    const tradedValueValues = calculationObservationInputs.map((sessionDate) => {
      const record = recordByDate.get(sessionDate);
      return record ? priceObservationNumber(record, "traded_value") : null;
    });
    if (tradedValueValues.some((value) => value === null)) {
      return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
    }
    const presentTradedValueValues = tradedValueValues as number[];
    return {
      status: "returned" as const,
      id: metric.id,
      windowSessions,
      value: presentTradedValueValues.reduce((sum, value) => sum + value, 0) / presentTradedValueValues.length,
      units: "twd",
      formulaId: "average_daily_traded_value",
      formulaVersion: "1.0.0",
      parameters: {},
      ...metricLineage,
      calculatedAt,
      rounding: "full_precision",
    };
  }
  const series = windowed
    .map((session) => ("basisClose" in session ? session.basisClose : null))
    .filter((value): value is number => value !== null);
  if (series.length !== windowed.length) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
  }
  if (series.length < 2) {
    return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
  }
  if (metric.id === "simple_price_return") {
    return {
      status: "returned" as const,
      id: metric.id,
      windowSessions,
      value: (series.at(-1)! - series[0]!) / series[0]!,
      units: "ratio",
      formulaId: "simple_price_return",
      formulaVersion: "1.0.0",
      parameters: {},
      ...metricLineage,
      calculatedAt,
      rounding: "full_precision",
    };
  }
  const returns = series.slice(1).map((value, index) => Math.log(value / series[index]!));
  if (metric.id === "annualized_realized_volatility") {
    const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
    const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
    return {
      status: "returned" as const,
      id: metric.id,
      windowSessions,
      value: Math.sqrt(variance) * Math.sqrt(252),
      units: "annualized_ratio",
      formulaId: "annualized_realized_volatility",
      formulaVersion: "1.0.0",
      parameters: { tradingDaysPerYear: 252 },
      ...metricLineage,
      calculatedAt,
      rounding: "full_precision",
    };
  }
  if (metric.id === "maximum_drawdown") {
    let peak = Number.NEGATIVE_INFINITY;
    let drawdown = 0;
    for (const value of series) {
      peak = Math.max(peak, value);
      drawdown = Math.min(drawdown, (value - peak) / peak);
    }
    return {
      status: "returned" as const,
      id: metric.id,
      windowSessions,
      value: drawdown,
      units: "ratio",
      formulaId: "maximum_drawdown",
      formulaVersion: "1.0.0",
      parameters: {},
      ...metricLineage,
      calculatedAt,
      rounding: "full_precision",
    };
  }
  return { status: "withheld" as const, id: metric.id, windowSessions, reasonCode: "insufficient_basis_history" as const };
}

export async function getPriceSeries(
  persistence: Persistence,
  query: ResearchPriceSeriesQuery,
): Promise<ResearchPriceSeriesOutput> {
  const identity = await getResearchIdentity(persistence, { ...query, history: { limit: 1 } });
  const listing = identity.identity.listing;
  const effectiveAuthoritativeAsOf = await authoritativeCutoffDate(persistence, query.context.effectiveAt);
  const knowledgeAuthoritativeAsOf = await authoritativeCutoffDate(persistence, query.context.knowledgeAt);
  const cappedEndDate = listing.status === "active"
    ? effectiveAuthoritativeAsOf
    : (listing.inactiveAt ?? effectiveAuthoritativeAsOf);
  const expectedDates = cappedEndDate
    ? (await expectedTradingDatesForQuery(
        persistence,
        listing.listedAt,
        query.scope,
        cappedEndDate,
      )).filter((date) => listing.status === "active" || date <= (listing.inactiveAt ?? cappedEndDate))
    : [];
  const scopedDates = expectedDates.length === 0
    ? { startDate: "", endDate: "", requestedDates: [] as string[] }
    : {
        startDate: expectedDates[0]!,
        endDate: expectedDates.at(-1)!,
        requestedDates: expectedDates,
      };
  const priceRecords = scopedDates.requestedDates.length === 0
    ? []
    : await persistence.listLatestResearchPriceRecords({
        subject: { kind: "listing_id", listingId: listing.id },
        startDate: scopedDates.startDate,
        endDate: scopedDates.endDate,
        knowledgeAt: query.context.knowledgeAt,
      });
  const latestAvailableRecords = scopedDates.endDate === ""
    ? []
    : await persistence.listLatestResearchPriceRecords({
        subject: { kind: "listing_id", listingId: listing.id },
        startDate: listing.listedAt,
        endDate: scopedDates.endDate,
        knowledgeAt: query.context.knowledgeAt,
      });
  const latestAvailableBarDate = latestAvailableRecords.at(-1)?.sessionDate ?? null;
  const recordByDate = new Map(priceRecords.map((record) => [record.sessionDate, record]));
  const freshness = authoritativeFreshness(
    query.context.knowledgeAt,
    knowledgeAuthoritativeAsOf,
    latestAvailableBarDate,
    scopedDates.endDate || effectiveAuthoritativeAsOf || "",
  );
  const sessionsAscending = scopedDates.requestedDates.map((sessionDate) => {
    const record = recordByDate.get(sessionDate) ?? null;
    if (!record) {
      if (listing.status === "inactive" && sessionDate >= (listing.inactiveAt ?? sessionDate)) {
        return {
          state: "missing" as const,
          sessionDate,
          reasonCode: "listing_inactive" as const,
        };
      }
      if (knowledgeAuthoritativeAsOf === sessionDate && freshness.state === "stale") {
        return {
          state: "stale" as const,
          sessionDate,
          latestAvailableDate: latestAvailableBarDate,
          reasonCode: "authoritative_close_overdue" as const,
        };
      }
      return {
        state: "missing" as const,
        sessionDate,
        reasonCode: listing.status === "inactive" ? "listing_inactive" as const : "missing_authoritative_price" as const,
      };
    }
    const close = priceObservationNumber(record, "close");
    if (query.basis === "corporate_action_adjusted" && (record.state === "full_bar" || record.state === "close_only" || record.state === "no_trade")) {
      return {
        state: "corporate_action_incomplete" as const,
        sessionDate,
        close,
        missingInputs: ["canonical_verified_corporate_actions_unavailable"],
      };
    }
    const basisClose = close;
    if (record.state === "suspended") {
      return {
        state: "suspended" as const,
        sessionDate,
        reasonCode: "official_trading_suspension" as const,
        note: priceObservationValue(record, "note") ?? null,
        provenance: priceSessionProvenance(record),
      };
    }
    if (record.state === "no_trade") {
      return {
        state: "no_trade" as const,
        sessionDate,
        prices: {
          close,
          volume: priceObservationNumber(record, "volume"),
          tradedValue: priceObservationNumber(record, "traded_value"),
          tradeCount: priceObservationNumber(record, "trade_count"),
        },
        basisClose,
        provenance: priceSessionProvenance(record),
      };
    }
    if (record.state === "close_only") {
      return {
        state: "settled_close_only" as const,
        sessionDate,
        prices: { close: requiredPriceObservationNumber(record, "close") },
        basisClose: requiredPriceObservationNumber(record, "close"),
        provenance: priceSessionProvenance(record),
      };
    }
    return {
      state: "settled_full_bar" as const,
      sessionDate,
      prices: {
        open: requiredPriceObservationNumber(record, "open"),
        high: requiredPriceObservationNumber(record, "high"),
        low: requiredPriceObservationNumber(record, "low"),
        close: requiredPriceObservationNumber(record, "close"),
        volume: requiredPriceObservationNumber(record, "volume"),
        tradedValue: requiredPriceObservationNumber(record, "traded_value"),
        tradeCount: requiredPriceObservationNumber(record, "trade_count"),
      },
      basisClose: requiredPriceObservationNumber(record, "close"),
      provenance: priceSessionProvenance(record),
    };
  });
  const orderedSessions = query.order === "asc" ? sessionsAscending : [...sessionsAscending].reverse();
  const afterDate = decodePriceSeriesCursor(identity.selector.listingId, query, query.page.cursor);
  const afterIndex = afterDate ? orderedSessions.findIndex((session) => session.sessionDate === afterDate) : -1;
  if (afterDate && afterIndex < 0) {
    throw new ResearchServiceError("research_cursor_invalid", "The price-series cursor is outside the available history");
  }
  const candidateSessions = orderedSessions.slice(afterIndex + 1, afterIndex + 1 + query.page.limit + 1);
  const calculatedAt = query.context.knowledgeAt;
  const metrics = query.metrics.map((metric) => buildMetricResult(
    metric,
    sessionsAscending,
    recordByDate,
    identity.identity.eligibility.profile,
    calculatedAt,
  ));
  const baseEnvelope = {
    contractVersion: "research-price-series/1.0.0" as const,
    selector: identity.selector,
    context: identity.context,
    listing,
    scope: query.scope,
    basis: query.basis,
    basisPolicy: {
      id: "taiwan-authoritative-stock-actions/1.0.0" as const,
      status: query.basis === "raw"
        ? "raw" as const
        : "incomplete" as const,
    },
    order: query.order,
    freshness,
    metrics,
  };
  const pageSessions: typeof candidateSessions = [];
  let truncatedByBudget = false;
  for (const session of candidateSessions.slice(0, query.page.limit)) {
    const projected = {
      ...baseEnvelope,
      page: { limit: query.page.limit, nextCursor: null, recordCount: pageSessions.length + 1, truncatedByBudget: false },
      sessions: [...pageSessions, session],
    };
    const size = Buffer.byteLength(JSON.stringify(projected), "utf8");
    if (pageSessions.length === 0 && size > PRICE_SERIES_RESPONSE_BUDGET_BYTES) {
      throw new ResearchServiceError("research_record_too_large", "A single price-series record exceeds the response budget");
    }
    if (size > PRICE_SERIES_RESPONSE_BUDGET_BYTES) {
      truncatedByBudget = true;
      break;
    }
    pageSessions.push(session);
  }
  const hasMore = candidateSessions.length > pageSessions.length;
  return {
    ...baseEnvelope,
    page: {
      limit: query.page.limit,
      nextCursor: hasMore ? encodePriceSeriesCursor(identity.selector.listingId, query, pageSessions.at(-1)!.sessionDate) : null,
      recordCount: pageSessions.length,
      truncatedByBudget,
    },
    sessions: pageSessions,
  };
}
