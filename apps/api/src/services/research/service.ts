import { createHash } from "node:crypto";
import type { MarketCalendarVersionRecord, Persistence } from "../../persistence/types.js";
import type {
  ResearchFinancialStatementsOutput,
  ResearchFinancialStatementsQuery,
  ResearchFinancialStatementsQueryInput,
  ResearchIdentityQuery,
  ResearchPriceMetricResult,
  ResearchPriceSeriesQuery,
  ResearchPriceSeriesOutput,
  ResearchQuery,
  ResearchPriceSession,
  ResearchMonthlyRevenueQuery,
  ResearchTemporalContext,
} from "./contracts.js";
import {
  researchFinancialStatementsOutputSchema,
  researchFinancialStatementsQuerySchema,
} from "./contracts.js";
import {
  researchFinancialStatementPeriodKey,
  type ResearchFinancialStatementFact,
  type ResearchFinancialStatementMetricId,
  type ResearchFinancialStatementRecord,
} from "./financialStatements.js";
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
import {
  firstMonthForTrailingWindow,
  resolveLatestMonthlyRevenueRecords,
  type ResearchMonthlyRevenueRecord,
} from "./monthlyRevenue.js";
import { researchSkillExposureEnabled } from "./rollout.js";

export class ResearchServiceError extends Error {
  readonly statusCode = 422;

  constructor(
    readonly code:
      | "research_subject_not_found"
      | "research_subject_ambiguous"
      | "research_cursor_invalid"
      | "research_assessment_mode_unsupported"
      | "research_dataset_unavailable"
      | "research_calendar_unavailable"
      | "research_record_too_large"
      | "research_window_invalid",
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
const DEFAULT_MONTHLY_REVENUE_MONTHS = 24;
const MAX_MONTHLY_REVENUE_WINDOW_MONTHS = 120;
const FINANCIAL_STATEMENTS_CURSOR_TTL_MS = 24 * 60 * 60 * 1000;
const RESEARCH_FINANCIAL_STATEMENTS_CURSOR_VERSION = 1;
const RESEARCH_FINANCIAL_STATEMENTS_CURSOR_PURPOSE = "canonical_research_financial_statements_read";
const RESEARCH_FINANCIAL_STATEMENTS_CONTRACT_VERSION = "research-financial-statements/1.0.0";
const RESEARCH_FINANCIAL_STATEMENTS_DATASET_VERSION = "financial_statements/1.0.0";
const RESEARCH_FINANCIAL_STATEMENTS_POLICY_VERSION = "mops-xbrl-canonical-store/1.0.0";
const FINANCIAL_STATEMENT_DEFAULT_POLICY_ID = "mops-xbrl-basis-selection/1.0.0";
const FINANCIAL_STATEMENT_MAX_FACTS_PER_PERIOD = 100;
const FINANCIAL_STATEMENT_MAX_QUALITY_OBSERVATIONS = 100;

type ResearchFinancialStatementPeriod = ResearchFinancialStatementsOutput["periods"][number];
type ResearchFinancialStatementDerivedOutcome = ResearchFinancialStatementsOutput["derivedOutcomes"][number];
type ResearchFinancialStatementGap = ResearchFinancialStatementsOutput["gaps"][number];
type ResearchFinancialStatementConflict = ResearchFinancialStatementsOutput["conflicts"][number];
type ResearchFinancialStatementRecovery = ResearchFinancialStatementsOutput["recovery"][number];
type ResearchFinancialStatementsAvailability = ResearchFinancialStatementsOutput["identity"]["availability"];
type FinancialMetricValue = {
  facts: ResearchFinancialStatementFact[];
  value: number;
  unit: string;
};
type FinancialMetricFailureReason = "missing_inputs" | "unknown_unit" | "ambiguous_inputs" | "incomparable_inputs";

const taiwanLocalDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function taiwanLocalDateParts(isoDateTime: string) {
  const instant = new Date(isoDateTime);
  if (Number.isNaN(instant.valueOf())) {
    throw new Error(`Invalid Taiwan local timestamp: ${isoDateTime}`);
  }
  const parts = Object.fromEntries(
    taiwanLocalDateFormatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

function taiwanCalendarDate(isoDateTime: string): string {
  const { year, month, day } = taiwanLocalDateParts(isoDateTime);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function latestDueFinancialStatementPeriodEnd(
  effectiveAt: string,
  periodicity: "annual" | "quarterly",
): string {
  const { year, month, day } = taiwanLocalDateParts(effectiveAt);
  const monthDay = `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (periodicity === "annual") {
    const fiscalYear = monthDay > "03-31" ? year - 1 : year - 2;
    return `${fiscalYear}-12-31`;
  }
  if (monthDay > "11-14") return `${year}-09-30`;
  if (monthDay > "08-14") return `${year}-06-30`;
  if (monthDay > "05-15") return `${year}-03-31`;
  if (monthDay > "03-31") return `${year - 1}-12-31`;
  return `${year - 1}-09-30`;
}

function formatMonth(year: number, month: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

function shiftMonth(month: string, delta: number): string {
  const [yearPart, monthPart] = month.split("-");
  const absolute = (Number(yearPart) * 12) + Number(monthPart) - 1 + delta;
  return formatMonth(Math.floor(absolute / 12), (absolute % 12) + 1);
}

function dedupeByKey<T>(items: readonly T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }
  return deduped;
}

function monthsInclusive(startMonth: string, endMonth: string): number {
  const [startYear, startMon] = startMonth.split("-").map(Number);
  const [endYear, endMon] = endMonth.split("-").map(Number);
  return ((endYear * 12) + endMon) - ((startYear * 12) + startMon) + 1;
}

async function nextTaiwanBusinessDay(
  persistence: Persistence,
  date: string,
  knowledgeAt: string,
): Promise<string> {
  const calendarEnd = addDays(date, 14);
  const versions = await loadTradingCalendarVersions(persistence, date, calendarEnd, knowledgeAt);
  let cursor = date;
  while (cursor <= calendarEnd) {
    const version = versions.get(Number(cursor.slice(0, 4)));
    if (!version) {
      throw new ResearchServiceError(
        "research_calendar_unavailable",
        `Authoritative Taiwan market calendar is unavailable for ${cursor.slice(0, 4)}`,
        { calendarYear: Number(cursor.slice(0, 4)) },
      );
    }
    if (isTradingDayFromCalendar(cursor, versions)) return cursor;
    cursor = addDays(cursor, 1);
  }
  throw new Error(`Unable to resolve Taiwan business day after ${date}`);
}

async function dueDateForRevenueMonth(
  persistence: Persistence,
  month: string,
  basis: "standard_10th" | "insurance_15th",
  knowledgeAt: string,
): Promise<string> {
  const [yearPart, monthPart] = month.split("-").map(Number);
  const dueMonth = monthPart === 12 ? 1 : monthPart + 1;
  const dueYear = monthPart === 12 ? yearPart + 1 : yearPart;
  const dueDay = basis === "insurance_15th" ? 15 : 10;
  return nextTaiwanBusinessDay(
    persistence,
    `${String(dueYear).padStart(4, "0")}-${String(dueMonth).padStart(2, "0")}-${String(dueDay).padStart(2, "0")}`,
    knowledgeAt,
  );
}

function resolveFreshnessBasis(identity: Awaited<ReturnType<typeof getResearchIdentity>>): "standard_10th" | "insurance_15th" {
  return identity.identity.issuer.classification === "financial_institution"
    ? "insurance_15th"
    : "standard_10th";
}

async function latestExpectedRevenueMonth(
  persistence: Persistence,
  effectiveAt: string,
  knowledgeAt: string,
  basis: "standard_10th" | "insurance_15th",
): Promise<{ latestExpectedMonth: string; statutoryDueDate: string }> {
  const { year, month, day } = taiwanLocalDateParts(effectiveAt);
  const currentMonth = formatMonth(year, month);
  const candidate = shiftMonth(currentMonth, -1);
  const candidateDueDate = await dueDateForRevenueMonth(persistence, candidate, basis, knowledgeAt);
  const knowledgeDate = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  if (knowledgeDate > candidateDueDate) {
    return { latestExpectedMonth: candidate, statutoryDueDate: candidateDueDate };
  }
  const previous = shiftMonth(candidate, -1);
  return {
    latestExpectedMonth: previous,
    statutoryDueDate: await dueDateForRevenueMonth(persistence, previous, basis, knowledgeAt),
  };
}

function revenueCursorBinding(
  listingId: string,
  context: ResearchTemporalContext,
  startMonth: string,
  endMonth: string,
  order: "asc" | "desc",
): string {
  return createHash("sha256")
    .update([
      listingId,
      context.effectiveAt,
      context.knowledgeAt,
      context.assessmentMode,
      context.policySetVersion ?? "",
      startMonth,
      endMonth,
      order,
    ].join("\u001f"))
    .digest("base64url")
    .slice(0, 32);
}

function decodeRevenueCursor(
  cursor: string | undefined,
  listingId: string,
  context: ResearchTemporalContext,
  startMonth: string,
  endMonth: string,
  order: "asc" | "desc",
): string | undefined {
  if (!cursor) return undefined;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ResearchServiceError("research_cursor_invalid", "The monthly revenue cursor is invalid");
  }
  if (
    !decoded
    || typeof decoded !== "object"
    || Array.isArray(decoded)
    || (decoded as { version?: unknown }).version !== 1
    || (decoded as { binding?: unknown }).binding !== revenueCursorBinding(listingId, context, startMonth, endMonth, order)
    || typeof (decoded as { revenueMonth?: unknown }).revenueMonth !== "string"
    || !/^\d{4}-(?:0[1-9]|1[0-2])$/.test((decoded as { revenueMonth: string }).revenueMonth)
  ) {
    throw new ResearchServiceError("research_cursor_invalid", "The monthly revenue cursor is invalid");
  }
  return (decoded as { revenueMonth: string }).revenueMonth;
}

function encodeRevenueCursor(
  revenueMonth: string,
  listingId: string,
  context: ResearchTemporalContext,
  startMonth: string,
  endMonth: string,
  order: "asc" | "desc",
): string {
  return Buffer.from(JSON.stringify({
    version: 1,
    revenueMonth,
    binding: revenueCursorBinding(listingId, context, startMonth, endMonth, order),
  }), "utf8").toString("base64url");
}

function numericValue(
  metric: { normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } },
): number | null {
  return metric.normalized.state === "present" ? Number(metric.normalized.value) : null;
}

function metricAvailable(value: number, lineageMonths: string[]) {
  return { status: "available" as const, value: value.toFixed(6).replace(/\.?0+$/, ""), lineageMonths };
}

function metricWithheld(
  reasonCode: "unknown_unit" | "unknown_basis" | "missing_comparable_month" | "basis_change" | "short_window" | "latest_due_gap" | "zero_denominator",
  lineageMonths: string[],
) {
  return { status: "withheld" as const, reasonCode, lineageMonths };
}

function currentRecordGate(
  current: ResearchMonthlyRevenueRecord,
): "ok" | "basis_change" | "unknown_unit" | "unknown_basis" {
  if (current.publicationContext.declaredUnit === "UNKNOWN") {
    return "unknown_unit";
  }
  if (current.publicationContext.basis === "unknown") {
    return "unknown_basis";
  }
  return "ok";
}

function comparable(
  current: ResearchMonthlyRevenueRecord,
  others: ResearchMonthlyRevenueRecord[],
): "ok" | "basis_change" | "unknown_unit" | "unknown_basis" {
  const currentGate = currentRecordGate(current);
  if (currentGate !== "ok") return currentGate;
  if (current.basisChange.state === "present") {
    return "basis_change";
  }
  if (others.some((record) => record.publicationContext.declaredUnit === "UNKNOWN")) {
    return "unknown_unit";
  }
  if (others.some((record) => record.publicationContext.basis === "unknown")) {
    return "unknown_basis";
  }
  if (others.some((record) => record.basisChange.state === "present")) {
    return "basis_change";
  }
  if (others.some((record) => record.publicationContext.basis !== current.publicationContext.basis)) {
    return "basis_change";
  }
  return "ok";
}

function supportPresenceGate(
  expectedMonths: readonly string[],
  records: readonly ResearchMonthlyRevenueRecord[],
  listingStartMonth: string,
): "ok" | "missing_comparable_month" | "short_window" {
  const availableMonths = new Set(records.map((record) => record.revenueMonth));
  const missingMonths = expectedMonths.filter((month) => !availableMonths.has(month));
  if (missingMonths.length === 0) return "ok";

  return missingMonths.every((month) => month < listingStartMonth)
    ? "short_window"
    : "missing_comparable_month";
}

function sumCurrentRevenue(records: ResearchMonthlyRevenueRecord[]): number | null {
  let total = 0;
  for (const record of records) {
    const value = numericValue(record.sourceFacts.currentMonthRevenue);
    if (value === null) return null;
    total += value;
  }
  return total;
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

type ResearchIdentityResult = Awaited<ReturnType<typeof getResearchIdentity>>;

async function resolveMonthlyRevenueFreshnessTarget(
  persistence: Persistence,
  identity: ResearchIdentityResult,
) {
  const freshnessBasis = resolveFreshnessBasis(identity);
  const uncappedTarget = await latestExpectedRevenueMonth(
    persistence,
    identity.context.effectiveAt,
    identity.context.knowledgeAt,
    freshnessBasis,
  );
  const inactiveAt = identity.identity.listing.status === "inactive"
    ? identity.identity.listing.inactiveAt
    : null;
  const finalApplicableMonth = inactiveAt?.slice(0, 7);
  return finalApplicableMonth && uncappedTarget.latestExpectedMonth > finalApplicableMonth
    ? {
        latestExpectedMonth: finalApplicableMonth,
        statutoryDueDate: await dueDateForRevenueMonth(
          persistence,
          finalApplicableMonth,
          freshnessBasis,
          identity.context.knowledgeAt,
        ),
      }
    : uncappedTarget;
}

async function hasMonthlyRevenueAvailable(
  persistence: Persistence,
  listingId: string,
  context: ResearchTemporalContext,
  latestApplicableMonth: string,
): Promise<boolean> {
  const records = await persistence.listLatestResearchMonthlyRevenueRecords({
    subject: { kind: "listing_id", listingId },
    effectiveAt: context.effectiveAt,
    knowledgeAt: context.knowledgeAt,
    startMonth: firstMonthForTrailingWindow(latestApplicableMonth, 24),
    endMonth: latestApplicableMonth,
  });
  return effectiveRevenueRecords(records, context.effectiveAt).length > 0;
}

function latestApplicableRevenueMonth(identity: ResearchIdentityResult): string {
  const effectiveMonth = taiwanLocalIsoDate(identity.context.effectiveAt).slice(0, 7);
  const inactiveMonth = identity.identity.listing.status === "inactive"
    ? identity.identity.listing.inactiveAt?.slice(0, 7)
    : null;
  return inactiveMonth && inactiveMonth < effectiveMonth ? inactiveMonth : effectiveMonth;
}

function displayNameFromIdentity(identity: Awaited<ReturnType<typeof getResearchIdentity>>): string | null {
  const displayFact = identity.identity.facts.find((fact) => fact.field === "display_name");
  if (displayFact?.normalized.state === "present") return displayFact.normalized.value;
  const legalFact = identity.identity.facts.find((fact) => fact.field === "legal_name");
  return legalFact?.normalized.state === "present" ? legalFact.normalized.value : null;
}

function financialStatementsDefaultLimit(periodicity: ResearchFinancialStatementsQuery["periodicity"]): number {
  return periodicity === "annual" ? 3 : 8;
}

function financialStatementsMaxLimit(periodicity: ResearchFinancialStatementsQuery["periodicity"]): number {
  return periodicity === "annual" ? 10 : 20;
}

function financialStatementsRangeRequestedCount(query: ResearchFinancialStatementsQuery): number {
  if (query.range.kind === "latest_periods") {
    return query.range.count ?? financialStatementsDefaultLimit(query.periodicity);
  }
  const range = query.range;
  const periodEndSuffixes = query.periodicity === "annual"
    ? ["12-31"]
    : ["03-31", "06-30", "09-30", "12-31"];
  let count = 0;
  for (let year = Number(range.startDate.slice(0, 4)); year <= Number(range.endDate.slice(0, 4)); year += 1) {
    count += periodEndSuffixes.filter((suffix) => {
      const periodEnd = `${year}-${suffix}`;
      return periodEnd >= range.startDate && periodEnd <= range.endDate;
    }).length;
  }
  return count;
}

function financialStatementSortOrder(
  left: ResearchFinancialStatementRecord,
  right: ResearchFinancialStatementRecord,
): number {
  return right.fiscalPeriod.periodEnd.localeCompare(left.fiscalPeriod.periodEnd)
    || right.publicationContext.publishedAt.localeCompare(left.publicationContext.publishedAt)
    || right.publicationContext.filingId.localeCompare(left.publicationContext.filingId)
    || right.publicationContext.revisionId.localeCompare(left.publicationContext.revisionId);
}

function financialStatementsCursorBinding(listingId: string, query: ResearchFinancialStatementsQuery): string {
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
        periodicity: query.periodicity,
        range: query.range,
        filingBasis: query.filingBasis,
        statements: query.statements,
        metricSelection: query.metricSelection,
        derivedMetrics: query.derivedMetrics,
        order: query.page.order,
        limit: query.page.limit,
      },
      purposes: [RESEARCH_FINANCIAL_STATEMENTS_CURSOR_PURPOSE, "mcp:get_financial_statements"],
      versions: {
        contractVersion: RESEARCH_FINANCIAL_STATEMENTS_CONTRACT_VERSION,
        datasetVersion: RESEARCH_FINANCIAL_STATEMENTS_DATASET_VERSION,
        policyVersion: RESEARCH_FINANCIAL_STATEMENTS_POLICY_VERSION,
      },
    }))
    .digest("base64url")
    .slice(0, 48);
}

function encodeFinancialStatementsCursor(
  listingId: string,
  query: ResearchFinancialStatementsQuery,
  period: ResearchFinancialStatementPeriod,
): string {
  return Buffer.from(JSON.stringify({
    version: RESEARCH_FINANCIAL_STATEMENTS_CURSOR_VERSION,
    binding: financialStatementsCursorBinding(listingId, query),
    issuedAt: new Date().toISOString(),
    boundaryPeriodEndDate: period.periodEndDate,
    filingPeriodId: period.filingPeriodId,
  }), "utf8").toString("base64url");
}

function decodeFinancialStatementsCursor(
  listingId: string,
  query: ResearchFinancialStatementsQuery,
  cursor?: string,
): { periodEndDate: string; filingPeriodId: string } | null {
  if (!cursor) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  } catch {
    throw new ResearchServiceError("research_cursor_invalid", "The financial-statements cursor is invalid");
  }
  if (
    !decoded
    || typeof decoded !== "object"
    || Array.isArray(decoded)
    || (decoded as { version?: unknown }).version !== RESEARCH_FINANCIAL_STATEMENTS_CURSOR_VERSION
    || (decoded as { binding?: unknown }).binding !== financialStatementsCursorBinding(listingId, query)
    || typeof (decoded as { boundaryPeriodEndDate?: unknown }).boundaryPeriodEndDate !== "string"
    || typeof (decoded as { filingPeriodId?: unknown }).filingPeriodId !== "string"
    || typeof (decoded as { issuedAt?: unknown }).issuedAt !== "string"
  ) {
    throw new ResearchServiceError("research_cursor_invalid", "The financial-statements cursor does not match the bound query");
  }
  const issuedAtMs = Date.parse((decoded as { issuedAt: string }).issuedAt);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs > Date.now()) {
    throw new ResearchServiceError("research_cursor_invalid", "The financial-statements cursor is invalid");
  }
  if (Date.now() - issuedAtMs > FINANCIAL_STATEMENTS_CURSOR_TTL_MS) {
    throw new ResearchServiceError("research_cursor_invalid", "The financial-statements cursor has expired");
  }
  return {
    periodEndDate: (decoded as { boundaryPeriodEndDate: string }).boundaryPeriodEndDate,
    filingPeriodId: (decoded as { filingPeriodId: string }).filingPeriodId,
  };
}

function financialStatementsAvailabilityForIdentity(
  identity: Awaited<ReturnType<typeof getResearchIdentity>>,
): ResearchFinancialStatementsAvailability {
  return identity.identity.eligibility.profile === "operating_company"
    && identity.identity.eligibility.state === "eligible"
    ? { status: "eligible", reasonCode: "operating_company" }
    : { status: "not_applicable", reasonCode: "not_applicable_subject" };
}

async function hasFinancialStatementsAvailable(
  persistence: Persistence,
  listingId: string,
  query: ResearchFinancialStatementsQuery,
): Promise<boolean> {
  try {
    const records = await persistence.listLatestResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId },
      knowledgeAt: query.context.knowledgeAt,
      effectiveAt: query.context.effectiveAt,
      periodicity: query.periodicity,
      filingBasis: "consolidated",
    });
    if (records.length > 0) return true;
    if ((await persistence.listLatestResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId },
      knowledgeAt: query.context.knowledgeAt,
      effectiveAt: query.context.effectiveAt,
      periodicity: query.periodicity,
      filingBasis: "individual",
    })).length > 0) return true;
    return (await persistence.listLatestResearchFinancialStatementRecords({
      subject: { kind: "listing_id", listingId },
      knowledgeAt: query.context.knowledgeAt,
      effectiveAt: query.context.effectiveAt,
      periodicity: query.periodicity,
      filingBasis: "unknown",
    })).length > 0;
  } catch (error) {
    if (error instanceof ResearchServiceError && error.code === "research_dataset_unavailable") {
      return false;
    }
    throw error;
  }
}

function selectFinancialStatementBasis(
  consolidated: readonly ResearchFinancialStatementRecord[],
  individual: readonly ResearchFinancialStatementRecord[],
  unknown: readonly ResearchFinancialStatementRecord[],
  requested: ResearchFinancialStatementsQuery["filingBasis"],
): { selected: ResearchFinancialStatementsOutput["basisPolicy"]["selected"]; fallbackApplied: boolean; records: ResearchFinancialStatementRecord[] } {
  if (requested === "consolidated" || requested === "individual") {
    return {
      selected: requested,
      fallbackApplied: false,
      records: [...(requested === "consolidated" ? consolidated : individual)],
    };
  }
  const includeUnknownPeriods = (selection: {
    selected: "consolidated" | "individual";
    fallbackApplied: boolean;
    records: ResearchFinancialStatementRecord[];
  }): { selected: ResearchFinancialStatementsOutput["basisPolicy"]["selected"]; fallbackApplied: boolean; records: ResearchFinancialStatementRecord[] } => {
    const coveredPeriods = new Set(selection.records.map((record) => researchFinancialStatementPeriodKey(record)));
    const additionalUnknown = unknown.filter((record) => !coveredPeriods.has(researchFinancialStatementPeriodKey(record)));
    return additionalUnknown.length === 0
      ? selection
      : {
          selected: "policy_selected",
          fallbackApplied: selection.fallbackApplied,
          records: [...selection.records, ...additionalUnknown],
        };
  };
  const consolidatedKeys = new Set(consolidated.map((record) => researchFinancialStatementPeriodKey(record)));
  const individualKeys = new Set(individual.map((record) => researchFinancialStatementPeriodKey(record)));
  const unionKeys = new Set([...consolidatedKeys, ...individualKeys]);
  const consolidatedCoversAll = unionKeys.size > 0 && unionKeys.size === consolidatedKeys.size;
  const individualCoversAll = unionKeys.size > 0 && unionKeys.size === individualKeys.size;
  if (consolidatedCoversAll) {
    return includeUnknownPeriods({ selected: "consolidated", fallbackApplied: false, records: [...consolidated] });
  }
  if (individualCoversAll) {
    return includeUnknownPeriods({ selected: "individual", fallbackApplied: true, records: [...individual] });
  }
  if (consolidated.length >= individual.length && consolidated.length > 0) {
    return includeUnknownPeriods({ selected: "consolidated", fallbackApplied: false, records: [...consolidated] });
  }
  if (individual.length > 0) {
    return includeUnknownPeriods({ selected: "individual", fallbackApplied: true, records: [...individual] });
  }
  return { selected: "policy_selected", fallbackApplied: false, records: [...unknown] };
}

function buildFinancialStatementsNotApplicableResult(
  identity: Awaited<ReturnType<typeof getResearchIdentity>>,
  query: ResearchFinancialStatementsQuery,
): ResearchFinancialStatementsOutput {
  return researchFinancialStatementsOutputSchema.parse({
    contractVersion: RESEARCH_FINANCIAL_STATEMENTS_CONTRACT_VERSION,
    selector: identity.selector,
    context: identity.context,
    identity: {
      issuer: identity.identity.issuer,
      security: identity.identity.security,
      listing: identity.identity.listing,
      displayName: displayNameFromIdentity(identity),
      eligibility: identity.identity.eligibility,
      availability: financialStatementsAvailabilityForIdentity(identity),
    },
    periodicity: query.periodicity,
    range: query.range,
    basisPolicy: {
      requested: query.filingBasis,
      selected: "policy_selected",
      policyId: FINANCIAL_STATEMENT_DEFAULT_POLICY_ID,
      fallbackApplied: false,
    },
    statements: query.statements,
    metricSelection: query.metricSelection,
    derivedMetricRequests: query.derivedMetrics,
    coverage: {
      status: "not_applicable",
      requestedPeriodCount: financialStatementsRangeRequestedCount(query),
      returnedPeriodCount: 0,
    },
    freshness: {
      state: "not_applicable",
      authoritativeAsOf: null,
      latestAcceptedAt: null,
    },
    completeness: {
      status: "not_applicable",
      missingFactCount: 0,
      missingMetricCount: 0,
    },
    confidence: {
      status: "not_applicable",
      reasonCodes: ["not_applicable_subject"],
    },
    readiness: {
      status: "not_applicable",
      reasonCodes: ["not_applicable_subject"],
    },
    periods: [],
    derivedOutcomes: [],
    gaps: [],
    conflicts: [],
    recovery: [],
    provenanceIndex: [],
    page: {
      limit: query.page.limit,
      order: query.page.order,
      nextCursor: null,
      recordCount: 0,
      truncatedByBudget: false,
    },
  });
}

function selectedStatementFacts(
  record: ResearchFinancialStatementRecord,
  statements: readonly ResearchFinancialStatementsQuery["statements"][number][],
): ResearchFinancialStatementFact[] {
  const allowed = new Set(statements);
  return record.statements
    .filter((section) => allowed.has(section.kind))
    .flatMap((section) => section.facts);
}

function metricIdsForGroups(groups: readonly ResearchFinancialStatementsQuery["metricSelection"]["groups"][number][]): Set<string> {
  const selected = new Set<string>();
  for (const group of groups) {
    if (group === "profitability") ["revenue", "gross_profit", "operating_income", "net_income"].forEach((id) => selected.add(id));
    if (group === "liquidity") ["current_assets", "current_liabilities", "cash_and_cash_equivalents"].forEach((id) => selected.add(id));
    if (group === "leverage") ["liabilities", "equity", "interest_bearing_debt"].forEach((id) => selected.add(id));
    if (group === "cash_flow") ["operating_cash_flow", "investing_cash_flow", "capital_expenditure"].forEach((id) => selected.add(id));
    if (group === "returns") ["assets", "equity", "net_income"].forEach((id) => selected.add(id));
    if (group === "growth") ["revenue", "gross_profit", "operating_income", "net_income"].forEach((id) => selected.add(id));
  }
  return selected;
}

const CORE_METRICS_BY_STATEMENT = {
  income: ["revenue", "gross_profit", "operating_income", "net_income"],
  balance_sheet: ["assets", "liabilities", "equity", "current_assets", "current_liabilities", "cash_and_cash_equivalents", "interest_bearing_debt"],
  cash_flow: ["operating_cash_flow", "investing_cash_flow", "capital_expenditure"],
  equity: [],
  sector_extension: [],
} as const;

function sourceFactIsCurrentIssuerWide(
  fact: ResearchFinancialStatementPeriod["sourceFacts"][number],
  period: ResearchFinancialStatementPeriod,
): boolean {
  if (fact.period.endDate !== period.periodEndDate) return false;
  return Object.entries(fact.dimensions).every(([dimension, member]) => {
    if (!/consolidated|separate|individual/i.test(`${dimension}:${member}`)) return false;
    if (period.filingBasis === "consolidated") return !/separate|individual/i.test(member);
    if (period.filingBasis === "individual") return !/consolidated/i.test(member);
    return false;
  });
}

function missingRequestedFactCount(
  period: ResearchFinancialStatementPeriod,
  query: ResearchFinancialStatementsQuery,
): number {
  const expected = new Set<string>();
  if (query.metricSelection.base === "required_core") {
    for (const statement of query.statements) {
      CORE_METRICS_BY_STATEMENT[statement].forEach((metricId) => expected.add(metricId));
    }
  }
  metricIdsForGroups(query.metricSelection.groups).forEach((metricId) => expected.add(metricId));
  const currentIssuerWideFacts = period.sourceFacts.filter((fact) => sourceFactIsCurrentIssuerWide(fact, period));
  const returnedMetricIds = new Set(currentIssuerWideFacts.map((fact) => fact.metricId));
  let missing = [...expected].filter((metricId) => !returnedMetricIds.has(metricId)).length;
  for (const explicit of query.metricSelection.explicitMetricIds) {
    if (expected.has(explicit)) continue;
    if (!currentIssuerWideFacts.some((fact) => fact.metricId === explicit || fact.concept.raw === explicit || fact.label.raw === explicit)) {
      missing += 1;
    }
  }
  return missing;
}

function factMatchesMetricSelection(
  fact: ResearchFinancialStatementFact,
  selection: ResearchFinancialStatementsQuery["metricSelection"],
): boolean {
  const explicit = new Set(selection.explicitMetricIds);
  if (selection.base === "required_core" && fact.metric.state === "mapped") return true;
  if (fact.metric.state === "mapped" && metricIdsForGroups(selection.groups).has(fact.metric.metricId)) return true;
  if (explicit.has(fact.concept.qname) || explicit.has(fact.concept.label)) return true;
  if (fact.metric.state === "mapped" && explicit.has(fact.metric.metricId)) return true;
  return false;
}

function selectedOutputFacts(
  record: ResearchFinancialStatementRecord,
  query: ResearchFinancialStatementsQuery,
): ResearchFinancialStatementFact[] {
  const sectorExtensionSelected = query.metricSelection.groups.includes("sector_extension");
  return selectedStatementFacts(record, query.statements).filter((fact) => (
    (sectorExtensionSelected && fact.statementKind === "sector_extension")
    || (query.metricSelection.base === "required_core" && fact.statementKind === "equity")
    || factMatchesMetricSelection(fact, query.metricSelection)
  ));
}

function factDateRange(fact: ResearchFinancialStatementFact) {
  if (fact.context.period.kind === "duration") {
    return {
      startDate: fact.context.period.startAt.slice(0, 10),
      endDate: fact.context.period.endAt.slice(0, 10),
    };
  }
  return {
    startDate: null,
    endDate: fact.context.period.instantAt.slice(0, 10),
  };
}

function factFiscalPeriod(
  fact: ResearchFinancialStatementFact,
  periodicity: ResearchFinancialStatementRecord["periodicity"],
): { fiscalYear: number; fiscalQuarter: 1 | 2 | 3 | 4 | null } {
  const endDate = fact.context.period.kind === "duration"
    ? fact.context.period.endAt.slice(0, 10)
    : fact.context.period.instantAt.slice(0, 10);
  return {
    fiscalYear: Number(endDate.slice(0, 4)),
    fiscalQuarter: periodicity === "annual"
      ? null
      : Math.ceil(Number(endDate.slice(5, 7)) / 3) as 1 | 2 | 3 | 4,
  };
}

function mapFinancialFact(
  fact: ResearchFinancialStatementFact,
  record: ResearchFinancialStatementRecord,
): ResearchFinancialStatementPeriod["sourceFacts"][number] {
  const period = factDateRange(fact);
  const fiscalPeriod = factFiscalPeriod(fact, record.periodicity);
  return {
    observationId: fact.id,
    statement: fact.statementKind,
    metricId: fact.metric.state === "mapped" ? fact.metric.metricId : "unmapped",
    concept: {
      raw: fact.concept.qname,
      normalized: { state: "present", value: fact.concept.qname },
    },
    label: {
      raw: fact.concept.label,
      normalized: { state: "present", value: fact.concept.label },
    },
    value: {
      raw: fact.raw.value,
      normalized: fact.normalized.state === "present"
        ? { state: "present", value: fact.normalized.value }
        : fact.statementKind === "sector_extension" && fact.raw.value.trim() !== ""
          ? { state: "present", value: fact.raw.value }
          : { state: "missing", reasonCode: fact.normalized.reason },
    },
    unit: fact.unit.state === "known"
      ? { raw: fact.unit.unitId, normalized: { state: "present", value: fact.unit.unitId } }
      : { raw: fact.unit.rawUnitId, normalized: { state: "missing", reasonCode: "unknown_unit" } },
    scale: fact.declaredScale
      ? { raw: fact.declaredScale, normalized: { state: "present", value: fact.declaredScale } }
      : { raw: null, normalized: { state: "missing", reasonCode: "not_reported" } },
    precision: fact.declaredPrecision
      ? { raw: fact.declaredPrecision, normalized: { state: "present", value: fact.declaredPrecision } }
      : { raw: null, normalized: { state: "missing", reasonCode: "not_reported" } },
    format: fact.declaredFormat
      ? { raw: fact.declaredFormat, normalized: { state: "present", value: fact.declaredFormat } }
      : { raw: null, normalized: { state: "missing", reasonCode: "not_reported" } },
    sign: fact.declaredSign
      ? { raw: fact.declaredSign, normalized: { state: "present", value: fact.declaredSign } }
      : { raw: null, normalized: { state: "missing", reasonCode: "not_reported" } },
    filingBasis: record.filingBasis === "consolidated" || record.filingBasis === "individual"
      ? { raw: record.filingBasis, normalized: { state: "present", value: record.filingBasis } }
      : { raw: record.filingBasis, normalized: { state: "missing", reasonCode: "unknown_basis" } },
    dimensions: fact.context.dimensions,
    period: {
      startDate: period.startDate,
      endDate: period.endDate,
      fiscalYear: fiscalPeriod.fiscalYear,
      fiscalQuarter: fiscalPeriod.fiscalQuarter,
      durationMonths: period.startDate === null
        ? 1
        : ((Number(period.endDate.slice(0, 4)) - Number(period.startDate.slice(0, 4))) * 12)
          + Number(period.endDate.slice(5, 7))
          - Number(period.startDate.slice(5, 7))
          + 1,
    },
    taxonomy: {
      namespace: fact.taxonomy?.namespaceUri ?? fact.concept.qname.split(":")[0] ?? "unknown",
      conceptName: fact.concept.qname.split(":").at(1) ?? fact.concept.qname,
      taxonomyVersion: fact.taxonomy?.version ?? record.provenance.taxonomyVersion,
    },
    provenanceId: record.provenance.id,
    ambiguity: {
      status: fact.ambiguityFlags.includes("duplicate_context")
        ? "duplicate_context"
        : fact.ambiguityFlags.includes("filing_basis_ambiguous")
          ? "ambiguous_basis"
          : fact.ambiguityFlags.includes("unmapped_concept")
            ? "unmapped_concept"
            : fact.ambiguityFlags.includes("unknown_unit")
              ? "unknown_unit"
              : "none",
      relatedObservationIds: [],
    },
    relations: {
      comparableObservationIds: [],
      supersededByObservationIds: [],
    },
    revision: {
      filingId: /^[0-9A-Za-z_-]+$/.test(record.publicationContext.filingId)
        ? record.publicationContext.filingId
        : `filing_${createHash("sha256").update(record.publicationContext.filingId).digest("hex").slice(0, 32)}`,
      accessionNumber: null,
      amended: record.publicationContext.amendment,
      restated: record.publicationContext.restatement,
      revisionTag: record.publicationContext.revisionId,
    },
  };
}

function qualityStateForRecord(
  record: ResearchFinancialStatementRecord,
  facts: readonly ResearchFinancialStatementFact[],
  kind: "taxonomyChanges" | "amendmentsRestatements" | "duplicateContexts" | "unmappedConcepts" | "unknownUnits" | "ambiguousBasis",
): ResearchFinancialStatementPeriod["quality"]["taxonomyChanges"] {
  const recordMatched = (() => {
    switch (kind) {
      case "taxonomyChanges":
        return record.ambiguityFlags.includes("taxonomy_change");
      case "amendmentsRestatements":
        return record.publicationContext.amendment || record.publicationContext.restatement;
      case "duplicateContexts":
        return record.ambiguityFlags.includes("duplicate_context");
      case "ambiguousBasis":
        return record.filingBasis === "unknown" || record.ambiguityFlags.includes("filing_basis_ambiguous");
      case "unmappedConcepts":
        return record.ambiguityFlags.includes("unmapped_concept");
      case "unknownUnits":
        return record.ambiguityFlags.includes("unknown_unit");
    }
  })();
  const matched = facts.filter((fact) => {
    if (recordMatched) return true;
    switch (kind) {
      case "taxonomyChanges":
        return fact.ambiguityFlags.includes("taxonomy_change");
      case "amendmentsRestatements":
        return false;
      case "duplicateContexts":
        return fact.ambiguityFlags.includes("duplicate_context");
      case "unmappedConcepts":
        return fact.ambiguityFlags.includes("unmapped_concept");
      case "unknownUnits":
        return fact.ambiguityFlags.includes("unknown_unit");
      case "ambiguousBasis":
        return fact.ambiguityFlags.includes("filing_basis_ambiguous");
    }
  });
  const present = recordMatched || matched.length > 0;
  return {
    status: present ? "present" : "clear",
    reasonCodes: present ? [kind] : [],
    observationIds: matched.slice(0, FINANCIAL_STATEMENT_MAX_QUALITY_OBSERVATIONS).map((fact) => fact.id),
  };
}

function parseFactNumber(fact: ResearchFinancialStatementFact): number | null {
  return fact.normalized.state === "present" ? Number(fact.normalized.value) : null;
}

function factsHaveComparableTaxonomy(facts: readonly ResearchFinancialStatementFact[]): boolean {
  const versions = new Set(facts.flatMap((fact) => fact.taxonomy?.version ? [fact.taxonomy.version] : []));
  return versions.size <= 1;
}

function periodIdForRecord(record: ResearchFinancialStatementRecord): string {
  return createHash("sha256")
    .update([
      record.publicationContext.filingId,
      record.publicationContext.revisionId,
      researchFinancialStatementPeriodKey(record),
    ].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
}

function deriveComparableMetricValue(
  facts: readonly ResearchFinancialStatementFact[],
  metricId: ResearchFinancialStatementMetricId,
  record: ResearchFinancialStatementRecord,
): FinancialMetricValue | { reason: FinancialMetricFailureReason } {
  if (record.filingBasis === "unknown" || record.ambiguityFlags.includes("filing_basis_ambiguous")) {
    return { reason: "ambiguous_inputs" };
  }
  const matches = facts.filter((fact) => {
    if (fact.metric.state !== "mapped" || fact.metric.metricId !== metricId) return false;
    const periodMatches = fact.context.period.kind === "instant"
      ? fact.context.period.instantAt.slice(0, 10) === record.fiscalPeriod.periodEnd
      : fact.context.period.endAt.slice(0, 10) === record.fiscalPeriod.periodEnd;
    if (!periodMatches) return false;
    return Object.entries(fact.context.dimensions).every(([dimension, member]) => {
      const basisDimension = /consolidated|separate|individual/i.test(`${dimension}:${member}`);
      if (!basisDimension) return false;
      if (record.filingBasis === "consolidated") return !/separate|individual/i.test(member);
      if (record.filingBasis === "individual") return !/consolidated/i.test(member);
      return true;
    });
  });
  if (matches.length === 0) return { reason: "missing_inputs" };
  if (matches.some((fact) => fact.ambiguityFlags.includes("filing_basis_ambiguous"))) {
    return { reason: "ambiguous_inputs" };
  }
  const contextPreferred = record.periodicity === "quarterly" && matches.some((fact) => fact.context.valueKind === "discrete")
    ? matches.filter((fact) => fact.context.valueKind === "discrete")
    : matches;
  if (contextPreferred.some((fact) => fact.unit.state === "unknown")) return { reason: "unknown_unit" };
  const present = contextPreferred.filter((fact) => fact.normalized.state === "present");
  if (present.length !== 1) return { reason: present.length === 0 ? "missing_inputs" : "ambiguous_inputs" };
  const value = parseFactNumber(present[0]);
  if (value === null) return { reason: "missing_inputs" };
  return { facts: [present[0]], value, unit: present[0].unit.state === "known" ? present[0].unit.unitId : "unknown" };
}

function quarterKeyFor(year: number, quarter: 1 | 2 | 3 | 4): string {
  return `${year}-Q${quarter}`;
}

function priorQuarterKey(record: ResearchFinancialStatementRecord): string | null {
  if (record.fiscalPeriod.fiscalQuarter === null) return null;
  if (record.fiscalPeriod.fiscalQuarter === 1) return quarterKeyFor(record.fiscalPeriod.fiscalYear - 1, 4);
  return quarterKeyFor(record.fiscalPeriod.fiscalYear, (record.fiscalPeriod.fiscalQuarter - 1) as 1 | 2 | 3 | 4);
}

function periodToken(record: ResearchFinancialStatementRecord): string {
  return researchFinancialStatementPeriodKey(record);
}

function previousAnnualToken(record: ResearchFinancialStatementRecord, years = 1): string | null {
  return record.periodicity === "annual" ? String(record.fiscalPeriod.fiscalYear - years).padStart(4, "0") : null;
}

function previousChronologicalRecord(
  record: ResearchFinancialStatementRecord,
  recordsInOrder: readonly ResearchFinancialStatementRecord[],
): ResearchFinancialStatementRecord | null {
  const expectedToken = record.periodicity === "annual"
    ? previousAnnualToken(record)
    : priorQuarterKey(record);
  return expectedToken
    ? recordsInOrder.find((candidate) => periodToken(candidate) === expectedToken) ?? null
    : null;
}

function metricParameterMetricId(
  parameters: Record<string, string | number | boolean>,
): ResearchFinancialStatementMetricId | null {
  const value = parameters.baseMetricId;
  if (
    value === "revenue"
    || value === "gross_profit"
    || value === "operating_income"
    || value === "net_income"
    || value === "assets"
    || value === "liabilities"
    || value === "equity"
    || value === "current_assets"
    || value === "current_liabilities"
    || value === "cash_and_cash_equivalents"
    || value === "interest_bearing_debt"
    || value === "operating_cash_flow"
    || value === "investing_cash_flow"
    || value === "capital_expenditure"
  ) {
    return value;
  }
  return null;
}

function metricWindowPeriods(
  parameters: Record<string, string | number | boolean>,
  fallback: number,
): number {
  const raw = parameters.windowPeriods;
  return typeof raw === "number" && Number.isInteger(raw) && raw > 1 ? raw : fallback;
}

function isDurationMetric(metricId: ResearchFinancialStatementMetricId): boolean {
  return metricId === "revenue"
    || metricId === "gross_profit"
    || metricId === "operating_income"
    || metricId === "net_income"
    || metricId === "operating_cash_flow"
    || metricId === "investing_cash_flow"
    || metricId === "capital_expenditure";
}

function isCumulativeFact(fact: ResearchFinancialStatementFact): boolean {
  return fact.context.valueKind === "cumulative" && fact.context.period.kind === "duration";
}

function isQ1DiscreteEligible(record: ResearchFinancialStatementRecord, fact: ResearchFinancialStatementFact): boolean {
  return record.fiscalPeriod.fiscalQuarter === 1
    && fact.context.period.kind === "duration"
    && fact.context.period.startAt.slice(0, 10) === `${record.fiscalPeriod.fiscalYear}-01-01`;
}

function discreteMetricValueForRecord(
  metricId: ResearchFinancialStatementMetricId,
  record: ResearchFinancialStatementRecord,
  recordFacts: readonly ResearchFinancialStatementFact[],
  recordsByToken: ReadonlyMap<string, ResearchFinancialStatementRecord>,
  factsByPeriodId: ReadonlyMap<string, ResearchFinancialStatementFact[]>,
): FinancialMetricValue | { reason: FinancialMetricFailureReason | "zero_denominator" } {
  const current = deriveComparableMetricValue(recordFacts, metricId, record);
  if ("reason" in current) return current;
  if (record.periodicity === "annual") return current;
  const currentFact = current.facts[0]!;
  if (currentFact.context.valueKind === "discrete") return current;
  if (!isCumulativeFact(currentFact)) return current;
  if (isQ1DiscreteEligible(record, currentFact)) return current;
  const priorToken = priorQuarterKey(record);
  if (!priorToken) return { reason: "missing_inputs" };
  const priorRecord = recordsByToken.get(priorToken);
  if (!priorRecord) return { reason: "missing_inputs" };
  if (priorRecord.filingBasis !== record.filingBasis) {
    return { reason: "incomparable_inputs" };
  }
  const priorFacts = factsByPeriodId.get(periodIdForRecord(priorRecord)) ?? [];
  const prior = deriveComparableMetricValue(
    priorFacts.filter((fact) => fact.context.valueKind === "cumulative"),
    metricId,
    priorRecord,
  );
  if ("reason" in prior) return prior;
  if (prior.unit !== current.unit || !factsHaveComparableTaxonomy([...current.facts, ...prior.facts])) {
    return { reason: "incomparable_inputs" };
  }
  return { facts: [...current.facts, ...prior.facts], value: current.value - prior.value, unit: current.unit };
}

function averageBalanceMetricForRecord(
  metricId: "equity" | "assets",
  record: ResearchFinancialStatementRecord,
  recordFacts: readonly ResearchFinancialStatementFact[],
  recordsInOrder: readonly ResearchFinancialStatementRecord[],
  factsByPeriodId: ReadonlyMap<string, ResearchFinancialStatementFact[]>,
): FinancialMetricValue | { reason: FinancialMetricFailureReason | "zero_denominator" } {
  const ending = deriveComparableMetricValue(recordFacts, metricId, record);
  if ("reason" in ending) return ending;
  const previous = previousChronologicalRecord(record, recordsInOrder);
  if (!previous) return { reason: "missing_inputs" };
  if (previous.filingBasis !== record.filingBasis) {
    return { reason: "incomparable_inputs" };
  }
  const previousFacts = factsByPeriodId.get(periodIdForRecord(previous)) ?? [];
  const beginning = deriveComparableMetricValue(previousFacts, metricId, previous);
  if ("reason" in beginning) return beginning;
  if (beginning.unit !== ending.unit || !factsHaveComparableTaxonomy([...beginning.facts, ...ending.facts])) {
    return { reason: "incomparable_inputs" };
  }
  const average = (beginning.value + ending.value) / 2;
  if (average === 0) return { reason: "zero_denominator" };
  return { facts: [...beginning.facts, ...ending.facts], value: average, unit: ending.unit };
}

function deriveMetricForRecord(
  metricId: ResearchFinancialStatementsQuery["derivedMetrics"][number]["metricId"],
  record: ResearchFinancialStatementRecord,
  recordFacts: readonly ResearchFinancialStatementFact[],
  recordsByKey: ReadonlyMap<string, ResearchFinancialStatementRecord>,
  factsByPeriodId: ReadonlyMap<string, ResearchFinancialStatementFact[]>,
  parameters: Record<string, string | number | boolean>,
  calculatedAt: string,
): ResearchFinancialStatementDerivedOutcome {
  const filingPeriodId = periodIdForRecord(record);
  const withholding = (
    reasonCode: Extract<ResearchFinancialStatementDerivedOutcome, { status: "withheld" }>["reasonCode"],
    observationIds: string[] = [],
  ): ResearchFinancialStatementDerivedOutcome => ({
    status: "withheld",
    metricId,
    filingPeriodId,
    reasonCode,
    periodObservationIds: observationIds,
    parameters,
  });
  const returned = (value: number, units: string, observationIds: string[], formulaId: string): ResearchFinancialStatementDerivedOutcome => ({
    status: "returned",
    metricId,
    filingPeriodId,
    periodObservationIds: observationIds,
    formulaId,
    formulaVersion: "1.0.0",
    parameters,
    units,
    value: Number.isInteger(value) ? String(value) : value.toFixed(6).replace(/0+$/, "").replace(/\.$/, ""),
    calculatedAt,
    rounding: "half_away_from_zero_6dp",
  });
  const recordsInOrder = [...recordsByKey.values()].sort((left, right) => (
    left.fiscalPeriod.periodEnd.localeCompare(right.fiscalPeriod.periodEnd)
      || left.publicationContext.publishedAt.localeCompare(right.publicationContext.publishedAt)
  ));
  const recordsByToken = new Map(recordsInOrder.map((candidate) => [periodToken(candidate), candidate] as const));
  if (metricId === "gross_margin" || metricId === "operating_margin" || metricId === "net_margin") {
    const numeratorMetric = metricId === "gross_margin" ? "gross_profit" : metricId === "operating_margin" ? "operating_income" : "net_income";
    const numerator = discreteMetricValueForRecord(numeratorMetric, record, recordFacts, recordsByToken, factsByPeriodId);
    const denominator = discreteMetricValueForRecord("revenue", record, recordFacts, recordsByToken, factsByPeriodId);
    if ("reason" in numerator) return withholding(numerator.reason, []);
    if ("reason" in denominator) return withholding(denominator.reason, []);
    const formulaFacts = [...numerator.facts, ...denominator.facts];
    if (numerator.unit !== denominator.unit || !factsHaveComparableTaxonomy(formulaFacts)) {
      return withholding("incomparable_inputs", formulaFacts.map((fact) => fact.id));
    }
    if (denominator.value === 0) return withholding("zero_denominator", [...numerator.facts, ...denominator.facts].map((fact) => fact.id));
    return returned(numerator.value / denominator.value, "ratio", [...numerator.facts, ...denominator.facts].map((fact) => fact.id), metricId);
  }
  if (metricId === "debt_to_equity" || metricId === "current_ratio") {
    const leftMetric = metricId === "debt_to_equity" ? "interest_bearing_debt" : "current_assets";
    const rightMetric = metricId === "debt_to_equity" ? "equity" : "current_liabilities";
    const left = deriveComparableMetricValue(recordFacts, leftMetric, record);
    const right = deriveComparableMetricValue(recordFacts, rightMetric, record);
    if ("reason" in left) return withholding(left.reason, []);
    if ("reason" in right) return withholding(right.reason, []);
    const formulaFacts = [...left.facts, ...right.facts];
    if (left.unit !== right.unit || !factsHaveComparableTaxonomy(formulaFacts)) {
      return withholding("incomparable_inputs", formulaFacts.map((fact) => fact.id));
    }
    if (right.value === 0) return withholding("zero_denominator", [...left.facts, ...right.facts].map((fact) => fact.id));
    return returned(left.value / right.value, "ratio", [...left.facts, ...right.facts].map((fact) => fact.id), metricId);
  }
  if (metricId === "free_cash_flow") {
    const ocf = discreteMetricValueForRecord("operating_cash_flow", record, recordFacts, recordsByToken, factsByPeriodId);
    const capex = discreteMetricValueForRecord("capital_expenditure", record, recordFacts, recordsByToken, factsByPeriodId);
    if ("reason" in ocf) return withholding(ocf.reason, []);
    if ("reason" in capex) return withholding(capex.reason, []);
    const formulaFacts = [...ocf.facts, ...capex.facts];
    if (ocf.unit !== capex.unit || !factsHaveComparableTaxonomy(formulaFacts)) {
      return withholding("incomparable_inputs", formulaFacts.map((fact) => fact.id));
    }
    return returned(ocf.value - Math.abs(capex.value), ocf.unit, [...ocf.facts, ...capex.facts].map((fact) => fact.id), metricId);
  }
  if (metricId === "reconstructed_discrete_quarter") {
    const baseMetricId = metricParameterMetricId(parameters);
    if (!baseMetricId || record.periodicity !== "quarterly") return withholding("missing_inputs", []);
    if (!isDurationMetric(baseMetricId)) return withholding("incomparable_inputs", []);
    const value = discreteMetricValueForRecord(baseMetricId, record, recordFacts, recordsByToken, factsByPeriodId);
    if ("reason" in value) return withholding(value.reason, []);
    return returned(value.value, value.unit, value.facts.map((fact) => fact.id), "reconstructed_discrete_quarter");
  }
  if (metricId === "trailing_twelve_month") {
    const baseMetricId = metricParameterMetricId(parameters);
    if (!baseMetricId || record.periodicity !== "quarterly") return withholding("missing_inputs", []);
    if (!isDurationMetric(baseMetricId)) return withholding("incomparable_inputs", []);
    const quarter = record.fiscalPeriod.fiscalQuarter;
    if (quarter === null) return withholding("missing_inputs", []);
    const quarterTokens = [0, 1, 2, 3].map((offset) => {
      let year = record.fiscalPeriod.fiscalYear;
      let q = quarter - offset;
      while (q <= 0) {
        q += 4;
        year -= 1;
      }
      return quarterKeyFor(year, q as 1 | 2 | 3 | 4);
    });
    const components = quarterTokens.map((token) => {
      const componentRecord = recordsByToken.get(token);
      if (!componentRecord) return { reason: "missing_inputs" as const };
      const componentFacts = factsByPeriodId.get(periodIdForRecord(componentRecord)) ?? [];
      return discreteMetricValueForRecord(baseMetricId, componentRecord, componentFacts, recordsByToken, factsByPeriodId);
    });
    if (components.some((component) => "reason" in component)) {
      return withholding((components.find((component) => "reason" in component) as { reason: Extract<ResearchFinancialStatementDerivedOutcome, { status: "withheld" }>["reasonCode"] }).reason, []);
    }
    const resolved = components as FinancialMetricValue[];
    if (
      new Set(resolved.map((item) => item.unit)).size !== 1
      || !factsHaveComparableTaxonomy(resolved.flatMap((item) => item.facts))
    ) return withholding("incomparable_inputs", resolved.flatMap((item) => item.facts.map((fact) => fact.id)));
    return returned(
      resolved.reduce((sum, item) => sum + item.value, 0),
      resolved[0]!.unit,
      resolved.flatMap((item) => item.facts.map((fact) => fact.id)),
      "trailing_twelve_month",
    );
  }
  if (metricId === "period_over_period_change") {
    const baseMetricId = metricParameterMetricId(parameters);
    if (!baseMetricId) return withholding("missing_inputs", []);
    const current = record.periodicity === "quarterly"
      ? discreteMetricValueForRecord(baseMetricId, record, recordFacts, recordsByToken, factsByPeriodId)
      : deriveComparableMetricValue(recordFacts, baseMetricId, record);
    if ("reason" in current) return withholding(current.reason, []);
    const priorToken = record.periodicity === "annual" ? previousAnnualToken(record) : priorQuarterKey(record);
    if (!priorToken) return withholding("missing_inputs", []);
    const priorRecord = recordsByToken.get(priorToken);
    if (!priorRecord) return withholding("missing_inputs", []);
    const priorFacts = factsByPeriodId.get(periodIdForRecord(priorRecord)) ?? [];
    const prior = record.periodicity === "quarterly"
      ? discreteMetricValueForRecord(baseMetricId, priorRecord, priorFacts, recordsByToken, factsByPeriodId)
      : deriveComparableMetricValue(priorFacts, baseMetricId, priorRecord);
    if ("reason" in prior) return withholding(prior.reason, []);
    if (current.unit !== prior.unit || !factsHaveComparableTaxonomy([...current.facts, ...prior.facts])) {
      return withholding("incomparable_inputs", [...current.facts, ...prior.facts].map((fact) => fact.id));
    }
    if (prior.value === 0) return withholding("zero_denominator", [...current.facts, ...prior.facts].map((fact) => fact.id));
    return returned((current.value - prior.value) / prior.value, "ratio", [...current.facts, ...prior.facts].map((fact) => fact.id), "period_over_period_change");
  }
  if (metricId === "compound_annual_growth_rate") {
    const baseMetricId = metricParameterMetricId(parameters);
    if (!baseMetricId || record.periodicity !== "annual") return withholding("missing_inputs", []);
    const windowPeriods = metricWindowPeriods(parameters, 3);
    const startToken = previousAnnualToken(record, windowPeriods - 1);
    if (!startToken) return withholding("missing_inputs", []);
    const startRecord = recordsByToken.get(startToken);
    if (!startRecord) return withholding("missing_inputs", []);
    const startFacts = factsByPeriodId.get(periodIdForRecord(startRecord)) ?? [];
    const start = deriveComparableMetricValue(startFacts, baseMetricId, startRecord);
    const end = deriveComparableMetricValue(recordFacts, baseMetricId, record);
    if ("reason" in start) return withholding(start.reason, []);
    if ("reason" in end) return withholding(end.reason, []);
    if (start.unit !== end.unit || !factsHaveComparableTaxonomy([...start.facts, ...end.facts])) {
      return withholding("incomparable_inputs", [...start.facts, ...end.facts].map((fact) => fact.id));
    }
    if (start.value <= 0) return withholding("zero_denominator", [...start.facts, ...end.facts].map((fact) => fact.id));
    if (end.value < 0) return withholding("incomparable_inputs", [...start.facts, ...end.facts].map((fact) => fact.id));
    const years = windowPeriods - 1;
    const growth = Math.pow(end.value / start.value, 1 / years) - 1;
    if (!Number.isFinite(growth)) return withholding("incomparable_inputs", [...start.facts, ...end.facts].map((fact) => fact.id));
    return returned(growth, "ratio", [...start.facts, ...end.facts].map((fact) => fact.id), "compound_annual_growth_rate");
  }
  if (metricId === "return_on_equity" || metricId === "return_on_assets") {
    const numerator = record.periodicity === "quarterly"
      ? discreteMetricValueForRecord("net_income", record, recordFacts, recordsByToken, factsByPeriodId)
      : deriveComparableMetricValue(recordFacts, "net_income", record);
    if ("reason" in numerator) return withholding(numerator.reason, []);
    const denominator = averageBalanceMetricForRecord(metricId === "return_on_equity" ? "equity" : "assets", record, recordFacts, recordsInOrder, factsByPeriodId);
    if ("reason" in denominator) return withholding(denominator.reason, []);
    const formulaFacts = [...numerator.facts, ...denominator.facts];
    if (numerator.unit !== denominator.unit || !factsHaveComparableTaxonomy(formulaFacts)) {
      return withholding("incomparable_inputs", formulaFacts.map((fact) => fact.id));
    }
    return returned(numerator.value / denominator.value, "ratio", [...numerator.facts, ...denominator.facts].map((fact) => fact.id), metricId);
  }
  return withholding("missing_inputs", []);
}

function unsupportedSectorDerivedMetricForRecord(
  request: ResearchFinancialStatementsQuery["derivedMetrics"][number],
  record: ResearchFinancialStatementRecord,
): ResearchFinancialStatementDerivedOutcome {
  return {
    status: "not_applicable",
    metricId: request.metricId,
    filingPeriodId: periodIdForRecord(record),
    reasonCode: "unsupported_sector_extension",
    periodObservationIds: [],
    parameters: request.parameters,
  };
}

export async function getResearchManifest(
  persistence: Persistence,
  query: ResearchQuery,
) {
  const identity = await getResearchIdentity(persistence, {
    ...query,
    history: { limit: 1 },
  });
  const effectiveAuthoritativeAsOf = await authoritativeCutoffDate(
    persistence,
    identity.context.effectiveAt,
    identity.context.knowledgeAt,
  );
  const effectiveBoundaryDate = effectiveAuthoritativeAsOf
    ?? conservativePriceBoundary(identity.context.effectiveAt);
  const listing = identity.identity.listing;
  const cappedEndDate = listing.status === "active"
    ? effectiveBoundaryDate
    : listing.inactiveAt && listing.inactiveAt < effectiveBoundaryDate
      ? listing.inactiveAt
      : effectiveBoundaryDate;
  const listingSessions = listing.listedAt > cappedEndDate
    ? []
    : await persistence.listLatestResearchPriceRecords({
        subject: { kind: "listing_id", listingId: identity.selector.listingId },
        startDate: listing.listedAt,
        endDate: cappedEndDate,
        knowledgeAt: identity.context.knowledgeAt,
      });
  const hasPriceSeries = identity.identity.eligibility.state === "eligible"
    && identity.identity.eligibility.profile !== "identity_only"
    && listingSessions.length > 0;
  const financialStatementsAvailable = financialStatementsAvailabilityForIdentity(identity).status === "eligible"
    ? (await Promise.all((["annual", "quarterly"] as const).map(async (periodicity) => (
        await hasFinancialStatementsAvailable(
          persistence,
          identity.selector.listingId,
          researchFinancialStatementsQuerySchema.parse({ ...query, periodicity }),
        )
      )))).some(Boolean)
    : false;
  return {
    contractVersion: "research-manifest/1.0.0" as const,
    selector: identity.selector,
    context: identity.context,
    eligibility: identity.identity.eligibility,
    orchestration: {
      skillExposure: researchSkillExposureEnabled() ? "enabled" as const : "disabled" as const,
    },
    datasets: await Promise.all(RESEARCH_DATASET_IDS.map(async (id) => {
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
      if (id === "monthly_revenue") {
        return await hasMonthlyRevenueAvailable(
          persistence,
          identity.selector.listingId,
          identity.context,
          latestApplicableRevenueMonth(identity),
        )
          ? { id, status: "available" as const }
          : { id, status: "unavailable" as const, reasonCode: "not_acquired" as const };
      }
      if (id === "financial_statements") {
        if (financialStatementsAvailabilityForIdentity(identity).status !== "eligible") {
          return { id, status: "unavailable" as const, reasonCode: "not_applicable_subject" as const };
        }
        return financialStatementsAvailable
          ? {
              id,
              status: "available" as const,
              capabilities: {
                periodicity: ["annual", "quarterly"],
                filingBasis: ["policy_selected", "consolidated", "individual"],
                statements: ["income", "balance_sheet", "cash_flow", "equity", "sector_extension"],
                metricBase: "required_core",
                metricGroups: [
                  "profitability",
                  "liquidity",
                  "leverage",
                  "cash_flow",
                  "returns",
                  "growth",
                  "sector_extension",
                ],
                derivedMetrics: [
                  "reconstructed_discrete_quarter",
                  "trailing_twelve_month",
                  "period_over_period_change",
                  "compound_annual_growth_rate",
                  "gross_margin",
                  "operating_margin",
                  "net_margin",
                  "return_on_equity",
                  "return_on_assets",
                  "debt_to_equity",
                  "current_ratio",
                  "free_cash_flow",
                ],
                pageLimits: {
                  annual: {
                    default: financialStatementsDefaultLimit("annual"),
                    max: financialStatementsMaxLimit("annual"),
                  },
                  quarterly: {
                    default: financialStatementsDefaultLimit("quarterly"),
                    max: financialStatementsMaxLimit("quarterly"),
                  },
                },
                maxSpanYears: 10,
                maxExplicitMetricIds: 100,
              },
            }
          : { id, status: "unavailable" as const, reasonCode: "no_authoritative_filing" as const };
      }
      return { id, status: "unavailable" as const, reasonCode: "identity_only_release" as const };
    })),
  };
}

export async function getFinancialStatements(
  persistence: Persistence,
  input: ResearchFinancialStatementsQueryInput,
): Promise<ResearchFinancialStatementsOutput> {
  const query = researchFinancialStatementsQuerySchema.parse(input);
  const identity = await getResearchIdentity(persistence, {
    subject: query.subject,
    context: query.context,
    history: { limit: 1 },
  });
  const availability = financialStatementsAvailabilityForIdentity(identity);
  if (availability.status !== "eligible") {
    return buildFinancialStatementsNotApplicableResult(identity, query);
  }
  const baseQuery = {
    subject: { kind: "listing_id" as const, listingId: identity.selector.listingId },
    knowledgeAt: identity.context.knowledgeAt,
    effectiveAt: identity.context.effectiveAt,
    periodicity: query.periodicity,
  };
  const consolidated = query.filingBasis === "individual"
    ? []
    : await persistence.listLatestResearchFinancialStatementRecords({ ...baseQuery, filingBasis: "consolidated" });
  const individual = query.filingBasis === "consolidated"
    ? []
    : await persistence.listLatestResearchFinancialStatementRecords({ ...baseQuery, filingBasis: "individual" });
  const unknown = query.filingBasis === "policy_selected"
    ? await persistence.listLatestResearchFinancialStatementRecords({ ...baseQuery, filingBasis: "unknown" })
    : [];
  const recordsWithinRange = (records: readonly ResearchFinancialStatementRecord[]) => {
    if (query.range.kind !== "period_end_range") return [...records];
    const { startDate, endDate } = query.range;
    return records.filter((record) => (
      record.fiscalPeriod.periodEnd >= startDate
      && record.fiscalPeriod.periodEnd <= endDate
    ));
  };
  const consolidatedWithinRange = recordsWithinRange(consolidated);
  const individualWithinRange = recordsWithinRange(individual);
  const unknownWithinRange = recordsWithinRange(unknown);
  const latestRequestedPeriodKeys = (() => {
    if (query.range.kind !== "latest_periods") return null;
    const keys: string[] = [];
    for (const record of [...consolidatedWithinRange, ...individualWithinRange, ...unknownWithinRange].sort(financialStatementSortOrder)) {
      const key = researchFinancialStatementPeriodKey(record);
      if (!keys.includes(key)) keys.push(key);
      if (keys.length === financialStatementsRangeRequestedCount(query)) break;
    }
    return new Set(keys);
  })();
  const recordsWithinBasisSelectionWindow = (records: readonly ResearchFinancialStatementRecord[]) => (
    latestRequestedPeriodKeys === null
      ? [...records]
      : records.filter((record) => latestRequestedPeriodKeys.has(researchFinancialStatementPeriodKey(record)))
  );
  const basisSelection = selectFinancialStatementBasis(
    recordsWithinBasisSelectionWindow(consolidatedWithinRange),
    recordsWithinBasisSelectionWindow(individualWithinRange),
    recordsWithinBasisSelectionWindow(unknownWithinRange),
    query.filingBasis,
  );
  const calculationRecords = (() => {
    if (query.filingBasis === "consolidated") return consolidated;
    if (query.filingBasis === "individual") return individual;
    const selectedKnownBasis = basisSelection.records.find((record) => record.filingBasis !== "unknown")?.filingBasis;
    if (selectedKnownBasis === "consolidated") {
      return selectFinancialStatementBasis(consolidated, [], unknown, "policy_selected").records;
    }
    if (selectedKnownBasis === "individual") {
      return selectFinancialStatementBasis([], individual, unknown, "policy_selected").records;
    }
    return unknown;
  })();
  const selectedRecordsWithinRange = basisSelection.records;
  const selectedRecordsForOutput = selectedRecordsWithinRange.filter((record) => (
    query.derivedMetrics.length > 0 || record.statements.some((section) => query.statements.includes(section.kind))
  ));
  const orderedSelected = [...selectedRecordsForOutput]
    .sort((left, right) => query.page.order === "desc" ? financialStatementSortOrder(left, right) : financialStatementSortOrder(right, left));
  const outputRange = query.range.kind === "latest_periods"
    ? [...selectedRecordsForOutput]
        .sort(financialStatementSortOrder)
        .slice(0, financialStatementsRangeRequestedCount(query))
        .sort((left, right) => query.page.order === "desc" ? financialStatementSortOrder(left, right) : financialStatementSortOrder(right, left))
    : orderedSelected;
  const latestSelected = [...outputRange].sort(financialStatementSortOrder)[0] ?? null;
  const cursor = decodeFinancialStatementsCursor(identity.selector.listingId, query, query.page.cursor);
  const remainingRecords = cursor === null
    ? outputRange
    : outputRange.filter((record) => (
      query.page.order === "desc"
        ? record.fiscalPeriod.periodEnd < cursor.periodEndDate
          || (record.fiscalPeriod.periodEnd === cursor.periodEndDate && periodIdForRecord(record) < cursor.filingPeriodId)
        : record.fiscalPeriod.periodEnd > cursor.periodEndDate
          || (record.fiscalPeriod.periodEnd === cursor.periodEndDate && periodIdForRecord(record) > cursor.filingPeriodId)
    ));
  const pageRecords = remainingRecords.slice(0, query.page.limit);
  const selectedPageFacts = new Map(pageRecords.map((record) => [periodIdForRecord(record), selectedOutputFacts(record, query)] as const));
  const truncatedByBudget = [...selectedPageFacts.values()].some((facts) => facts.length > FINANCIAL_STATEMENT_MAX_FACTS_PER_PERIOD);
  const pageFacts = new Map([...selectedPageFacts].map(([periodId, facts]) => [
    periodId,
    facts.slice(0, FINANCIAL_STATEMENT_MAX_FACTS_PER_PERIOD),
  ] as const));
  const periods = pageRecords.map((record) => {
    const facts = pageFacts.get(periodIdForRecord(record)) ?? [];
    const allStatementFacts = selectedStatementFacts(record, query.statements);
    return {
      filingPeriodId: periodIdForRecord(record),
      fiscalYear: record.fiscalPeriod.fiscalYear,
      fiscalQuarter: record.fiscalPeriod.fiscalQuarter,
      periodStartDate: record.fiscalPeriod.periodStart,
      periodEndDate: record.fiscalPeriod.periodEnd,
      publishedAt: taiwanCalendarDate(record.publicationContext.publishedAt),
      filingDate: taiwanCalendarDate(record.publicationContext.publishedAt),
      acceptedAt: record.publicationContext.revisionPublishedAt ?? record.publicationContext.publishedAt,
      filingBasis: record.filingBasis,
      statements: record.statements.filter((section) => query.statements.includes(section.kind)).map((section) => section.kind),
      sourceFacts: facts.map((fact) => mapFinancialFact(fact, record)),
      quality: {
        taxonomyChanges: qualityStateForRecord(record, allStatementFacts, "taxonomyChanges"),
        amendmentsRestatements: qualityStateForRecord(record, allStatementFacts, "amendmentsRestatements"),
        duplicateContexts: qualityStateForRecord(record, allStatementFacts, "duplicateContexts"),
        unmappedConcepts: qualityStateForRecord(record, allStatementFacts, "unmappedConcepts"),
        unknownUnits: qualityStateForRecord(record, allStatementFacts, "unknownUnits"),
        ambiguousBasis: qualityStateForRecord(record, allStatementFacts, "ambiguousBasis"),
      },
    };
  });
  const recordsByKey = new Map(calculationRecords.map((record) => [periodIdForRecord(record), record] as const));
  const factsByPeriodId = new Map(calculationRecords.map((record) => [
    periodIdForRecord(record),
    record.statements.flatMap((section) => section.facts),
  ] as const));
  const derivedOutcomes = query.page.cursor
    ? []
    : pageRecords.flatMap((record) => query.derivedMetrics.map((request) => (
        identity.identity.issuer.classification === "financial_institution"
          ? unsupportedSectorDerivedMetricForRecord(request, record)
          : deriveMetricForRecord(
              request.metricId,
              record,
              factsByPeriodId.get(periodIdForRecord(record)) ?? [],
              recordsByKey,
              factsByPeriodId,
              request.parameters,
              query.context.knowledgeAt,
            )
      )));
  const pageRecordIds = new Set(pageRecords.map((record) => periodIdForRecord(record)));
  const derivedObservationIds = new Set(derivedOutcomes.flatMap((outcome) => outcome.periodObservationIds));
  const provenanceRecords = calculationRecords.filter((record) => (
    pageRecordIds.has(periodIdForRecord(record))
    || record.statements.some((section) => section.facts.some((fact) => derivedObservationIds.has(fact.id)))
  ));
  const provenanceIndex = dedupeByKey(provenanceRecords.map((record) => ({
    provenanceId: record.provenance.id,
    publisher: record.provenance.publisher,
    accessProvider: record.provenance.accessProvider,
    authorityRole: record.provenance.authorityRole,
    publisherDataset: record.provenance.publisherDataset,
    sourceUrl: record.provenance.sourceUrl,
    contentHash: record.provenance.contentHash,
    retrievedAt: record.provenance.retrievedAt,
  })), (item) => item.provenanceId);
  const gaps: ResearchFinancialStatementGap[] = [];
  const conflicts: ResearchFinancialStatementConflict[] = [];
  const recovery: ResearchFinancialStatementRecovery[] = [];
  for (const record of pageRecords) {
    const facts = factsByPeriodId.get(periodIdForRecord(record)) ?? [];
    if (record.filingBasis === "unknown") {
      gaps.push({ code: "ambiguous_basis", severity: "warning", message: "Filing basis is ambiguous", observationIds: facts.slice(0, FINANCIAL_STATEMENT_MAX_QUALITY_OBSERVATIONS).map((fact) => fact.id) });
    }
    if (record.ambiguityFlags.includes("duplicate_context")) {
      conflicts.push({ code: "duplicate_context", status: "present", message: "Duplicate filing contexts remain in the selected revision", observationIds: facts.filter((fact) => fact.ambiguityFlags.includes("duplicate_context")).slice(0, FINANCIAL_STATEMENT_MAX_QUALITY_OBSERVATIONS).map((fact) => fact.id) });
    }
    if (record.ambiguityFlags.includes("taxonomy_change")) {
      recovery.push({ action: "taxonomy_review", status: "unavailable", message: "Taxonomy change requires manual mapping review." });
    }
  }
  const missingFactCount = periods.reduce((count, period) => (
    count
    + period.sourceFacts.filter((fact) => sourceFactIsCurrentIssuerWide(fact, period) && fact.value.normalized.state === "missing").length
    + missingRequestedFactCount(period, query)
  ), 0);
  const missingMetricCount = derivedOutcomes.filter((metric) => metric.status !== "returned").length;
  const readinessReasonCodes = dedupeByKey([
    ...(selectedRecordsForOutput.length === 0 ? ["no_authoritative_filing"] : []),
    ...(selectedRecordsForOutput.length > 0 && basisSelection.selected === "policy_selected" ? ["ambiguous_basis"] : []),
    ...pageRecords.flatMap((record) => record.ambiguityFlags.filter((flag) => (
      flag === "taxonomy_change" || flag === "unmapped_concept" || flag === "unknown_unit"
    ))),
    ...gaps.map((gap) => gap.code),
    ...conflicts.map((conflict) => conflict.code),
  ], (value) => value);
  return researchFinancialStatementsOutputSchema.parse({
    contractVersion: RESEARCH_FINANCIAL_STATEMENTS_CONTRACT_VERSION,
    selector: identity.selector,
    context: identity.context,
    identity: {
      issuer: identity.identity.issuer,
      security: identity.identity.security,
      listing: identity.identity.listing,
      displayName: displayNameFromIdentity(identity),
      eligibility: identity.identity.eligibility,
      availability: periods.length === 0 ? { status: "withheld", reasonCode: "no_authoritative_filing" } : availability,
    },
    periodicity: query.periodicity,
    range: query.range,
    basisPolicy: {
      requested: query.filingBasis,
      selected: basisSelection.selected,
      policyId: FINANCIAL_STATEMENT_DEFAULT_POLICY_ID,
      fallbackApplied: basisSelection.fallbackApplied,
    },
    statements: query.statements,
    metricSelection: query.metricSelection,
    derivedMetricRequests: query.derivedMetrics,
    coverage: {
      status: outputRange.length === 0 ? "none" : outputRange.length < financialStatementsRangeRequestedCount(query) ? "partial" : "complete",
      requestedPeriodCount: financialStatementsRangeRequestedCount(query),
      returnedPeriodCount: outputRange.length,
    },
    freshness: {
      state: periods.length === 0
        ? "unknown"
        : latestSelected!.fiscalPeriod.periodEnd < latestDueFinancialStatementPeriodEnd(identity.context.effectiveAt, query.periodicity)
          ? "stale"
          : "current",
      authoritativeAsOf: latestSelected
        ? taiwanCalendarDate(latestSelected.publicationContext.publishedAt)
        : null,
      latestAcceptedAt: latestSelected
        ? latestSelected.publicationContext.revisionPublishedAt ?? latestSelected.publicationContext.publishedAt
        : null,
    },
    completeness: {
      status: periods.length === 0 ? "withheld" : missingFactCount > 0 || missingMetricCount > 0 ? "partial" : "complete",
      missingFactCount,
      missingMetricCount,
    },
    confidence: {
      status: periods.length === 0 ? "low" : readinessReasonCodes.length > 0 ? "mixed" : "high",
      reasonCodes: readinessReasonCodes,
    },
    readiness: {
      status: periods.length === 0 ? "withheld" : readinessReasonCodes.length > 0 ? "usable_with_gaps" : "ready",
      reasonCodes: readinessReasonCodes,
    },
    periods,
    derivedOutcomes,
    gaps: dedupeByKey(gaps, (item) => JSON.stringify(item)),
    conflicts: dedupeByKey(conflicts, (item) => JSON.stringify(item)),
    recovery: dedupeByKey(recovery, (item) => JSON.stringify(item)),
    provenanceIndex,
    page: {
      limit: query.page.limit,
      order: query.page.order,
      nextCursor: remainingRecords.length > query.page.limit ? encodeFinancialStatementsCursor(identity.selector.listingId, query, periods.at(-1) ?? periods[periods.length - 1]!) : null,
      recordCount: periods.length,
      truncatedByBudget,
    },
  });
}

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

async function loadTradingCalendarVersions(
  persistence: Persistence,
  startDate: string,
  endDate: string,
  knowledgeAt: string,
) {
  const startYear = Number(startDate.slice(0, 4));
  const endYear = Number(endDate.slice(0, 4));
  const versions = new Map<number, MarketCalendarVersionRecord | null>();
  for (let year = startYear; year <= endYear; year += 1) {
    const history = await persistence.listMarketCalendarHistory("TW", year);
    const version = history
      .filter((candidate) => {
        if (!candidate.confirmedAt || candidate.confirmedAt > knowledgeAt) return false;
        const unavailableAt = candidate.invalidatedAt
          ?? (candidate.isActive ? null : candidate.updatedAt);
        return unavailableAt === null || knowledgeAt < unavailableAt;
      })
      .sort((left, right) => right.confirmedAt!.localeCompare(left.confirmedAt!))[0] ?? null;
    versions.set(year, version);
  }
  return versions;
}

function isTradingDayFromCalendar(
  date: string,
  versions: ReadonlyMap<number, MarketCalendarVersionRecord | null>,
): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  const weekdayOpenByDefault = day !== 0 && day !== 6;
  const version = versions.get(Number(date.slice(0, 4)));
  if (!version) return false;
  const exception = version.exceptions.find((item) => item.date === date);
  if (exception) return exception.status === "open";
  return weekdayOpenByDefault;
}

function enumerateTradingDates(
  startDate: string,
  endDate: string,
  versions: ReadonlyMap<number, MarketCalendarVersionRecord | null>,
): string[] {
  const dates: string[] = [];
  for (let current = startDate; current <= endDate; current = addDays(current, 1)) {
    if (isTradingDayFromCalendar(current, versions)) dates.push(current);
  }
  return dates;
}

async function authoritativeCutoffDate(
  persistence: Persistence,
  cutoffAt: string,
  knowledgeAt: string,
): Promise<string | null> {
  const { localDate, localHour, localMinute } = taipeiLocalParts(cutoffAt);
  const candidate = localHour > 18 || (localHour === 18 && localMinute >= 0)
    ? localDate
    : previousDate(localDate);
  const windowStart = addDays(candidate, -45);
  const versions = await loadTradingCalendarVersions(persistence, windowStart, candidate, knowledgeAt);
  return enumerateTradingDates(windowStart, candidate, versions).at(-1) ?? null;
}

function conservativePriceBoundary(instant: string): string {
  const { localDate, localHour, localMinute } = taipeiLocalParts(instant);
  return localHour > 18 || (localHour === 18 && localMinute >= 0)
    ? localDate
    : previousDate(localDate);
}

async function expectedTradingDatesForQuery(
  persistence: Persistence,
  venue: "TWSE" | "TPEX",
  listingListedAt: string,
  scope: ResearchPriceSeriesQuery["scope"],
  endDate: string,
  knowledgeAt: string,
): Promise<string[]> {
  let startDate: string;
  if (scope.kind === "date_range") {
    endDate = scope.endDate <= endDate ? scope.endDate : endDate;
    startDate = maxDate(listingListedAt, scope.startDate);
  } else {
    const sessionCount = scope.kind === "latest_sessions" ? scope.count : 1;
    const lookbackDays = Math.max(31, sessionCount * 3);
    startDate = maxDate(listingListedAt, addDays(endDate, -lookbackDays));
  }
  if (startDate > endDate) return [];
  const versions = await loadTradingCalendarVersions(persistence, startDate, endDate, knowledgeAt);
  const calendarDates = enumerateTradingDates(startDate, endDate, versions);
  const observedDates = (await persistence.getDistinctResearchPriceSessionDates(venue, startDate, knowledgeAt))
    .filter((date) => date <= endDate);
  const tradingDates = [...new Set([...calendarDates, ...observedDates])]
    .sort((left, right) => left.localeCompare(right));
  if (scope.kind === "latest") return tradingDates.slice(-1);
  if (scope.kind === "latest_sessions") return tradingDates.slice(-scope.count);
  return tradingDates;
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
  const windowSessions = Math.max(1, Math.min(requested.windowSessions ?? dates.length, 1260));
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
  const windowSessions = Math.max(1, Math.min(metric.windowSessions ?? sessions.length, 1260));
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
  const effectiveAuthoritativeAsOf = await authoritativeCutoffDate(
    persistence,
    query.context.effectiveAt,
    query.context.knowledgeAt,
  );
  const knowledgeAuthoritativeAsOf = await authoritativeCutoffDate(
    persistence,
    query.context.knowledgeAt,
    query.context.knowledgeAt,
  );
  const effectiveBoundaryDate = effectiveAuthoritativeAsOf ?? conservativePriceBoundary(query.context.effectiveAt);
  const cappedEndDate = listing.status === "active"
    ? effectiveBoundaryDate
    : listing.inactiveAt && listing.inactiveAt < effectiveBoundaryDate
      ? listing.inactiveAt
      : effectiveBoundaryDate;
  const expectedDates = (await expectedTradingDatesForQuery(
    persistence,
    listing.venue,
    listing.listedAt,
    query.scope,
    cappedEndDate,
    query.context.knowledgeAt,
  )).filter((date) => listing.status === "active" || date <= (listing.inactiveAt ?? cappedEndDate));
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
        provenance: priceSessionProvenance(record),
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

function resolveMonthlyRevenueWindow(
  query: ResearchMonthlyRevenueQuery,
  defaultEndMonth: string,
) {
  const explicitStart = query.range?.startMonth;
  const explicitEnd = query.range?.endMonth;
  const endMonth = explicitEnd ?? defaultEndMonth;
  const startMonth = explicitStart ?? firstMonthForTrailingWindow(endMonth, DEFAULT_MONTHLY_REVENUE_MONTHS);
  if (startMonth > endMonth) {
    throw new ResearchServiceError("research_window_invalid", "The monthly revenue range is invalid");
  }
  if (monthsInclusive(startMonth, endMonth) > MAX_MONTHLY_REVENUE_WINDOW_MONTHS) {
    throw new ResearchServiceError(
      "research_window_invalid",
      `The monthly revenue range must not exceed ${MAX_MONTHLY_REVENUE_WINDOW_MONTHS} months`,
    );
  }
  return { startMonth, endMonth };
}

function taiwanLocalIsoDate(isoDateTime: string): string {
  const { year, month, day } = taiwanLocalDateParts(isoDateTime);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function deriveMonthlyRevenueMetrics(
  outputRecords: ResearchMonthlyRevenueRecord[],
  supportRecords: readonly ResearchMonthlyRevenueRecord[],
  listingStartMonth: string,
) {
  const byMonth = new Map(supportRecords.map((record) => [record.revenueMonth, record]));
  return outputRecords.map((record) => {
    const previousYearMonth = shiftMonth(record.revenueMonth, -12);
    const previousYear = byMonth.get(previousYearMonth);
    const yoyComparable = currentRecordGate(record) !== "ok"
      ? currentRecordGate(record)
      : previousYear
        ? comparable(record, [previousYear])
        : previousYearMonth < listingStartMonth ? "short_window" : "missing_comparable_month";
    const yoyCurrent = numericValue(record.sourceFacts.currentMonthRevenue);
    const yoyPrior = previousYear ? numericValue(previousYear.sourceFacts.currentMonthRevenue) : null;
    const yearOverYearPercent = yoyComparable !== "ok"
      ? metricWithheld(yoyComparable, [previousYearMonth, record.revenueMonth])
      : yoyCurrent === null || yoyPrior === null
        ? metricWithheld("missing_comparable_month", [previousYearMonth, record.revenueMonth])
        : yoyPrior === 0
          ? metricWithheld("zero_denominator", [previousYearMonth, record.revenueMonth])
          : metricAvailable(((yoyCurrent - yoyPrior) / yoyPrior) * 100, [previousYearMonth, record.revenueMonth]);

    const rolling3Months = [shiftMonth(record.revenueMonth, -2), shiftMonth(record.revenueMonth, -1), record.revenueMonth];
    const rolling3Records = rolling3Months.map((month) => byMonth.get(month)).filter((item): item is ResearchMonthlyRevenueRecord => item !== undefined);
    const rolling3Coverage = supportPresenceGate(rolling3Months, supportRecords, listingStartMonth);
    const rolling3Comparable = rolling3Coverage === "ok"
      ? comparable(record, rolling3Records)
      : rolling3Coverage;
    const rolling3Sum = rolling3Records.length === 3 ? sumCurrentRevenue(rolling3Records) : null;
    const rolling3MonthRevenue = rolling3Comparable !== "ok" || rolling3Sum === null
      ? metricWithheld(rolling3Comparable === "ok" ? "short_window" : rolling3Comparable, rolling3Months)
      : metricAvailable(rolling3Sum, rolling3Months);

    const trailing12Months = Array.from({ length: 12 }, (_, index) => shiftMonth(record.revenueMonth, index - 11));
    const trailing12Records = trailing12Months.map((month) => byMonth.get(month)).filter((item): item is ResearchMonthlyRevenueRecord => item !== undefined);
    const trailing12Coverage = supportPresenceGate(trailing12Months, supportRecords, listingStartMonth);
    const trailing12Comparable = trailing12Coverage === "ok"
      ? comparable(record, trailing12Records)
      : trailing12Coverage;
    const trailing12Sum = trailing12Records.length === 12 ? sumCurrentRevenue(trailing12Records) : null;
    const trailing12MonthRevenue = trailing12Comparable !== "ok" || trailing12Sum === null
      ? metricWithheld(trailing12Comparable === "ok" ? "short_window" : trailing12Comparable, trailing12Months)
      : metricAvailable(trailing12Sum, trailing12Months);

    const currentYearPrefixMonths = Array.from({ length: Number(record.revenueMonth.slice(5, 7)) }, (_, index) => `${record.revenueMonth.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`);
    const currentYearRecords = currentYearPrefixMonths.map((month) => byMonth.get(month)).filter((item): item is ResearchMonthlyRevenueRecord => item !== undefined);
    const currentYtdCoverage = supportPresenceGate(currentYearPrefixMonths, supportRecords, listingStartMonth);
    const currentYtdComparable = currentRecordGate(record) !== "ok"
      ? currentRecordGate(record)
      : currentYtdCoverage === "ok" ? comparable(record, currentYearRecords) : currentYtdCoverage;
    const currentYtdSum = currentYearRecords.length === currentYearPrefixMonths.length ? sumCurrentRevenue(currentYearRecords) : null;
    const currentYearToDateRevenue = currentYtdComparable !== "ok" || currentYtdSum === null
      ? metricWithheld(currentYtdComparable === "ok" ? "missing_comparable_month" : currentYtdComparable, currentYearPrefixMonths)
      : metricAvailable(currentYtdSum, currentYearPrefixMonths);

    const previousYearPrefixMonths = currentYearPrefixMonths.map((month) => shiftMonth(month, -12));
    const previousYearRecords = previousYearPrefixMonths.map((month) => byMonth.get(month)).filter((item): item is ResearchMonthlyRevenueRecord => item !== undefined);
    const previousYtdCoverage = supportPresenceGate(previousYearPrefixMonths, supportRecords, listingStartMonth);
    const previousYtdComparable = currentRecordGate(record) !== "ok"
      ? currentRecordGate(record)
      : previousYtdCoverage === "ok" ? comparable(record, previousYearRecords) : previousYtdCoverage;
    const previousYtdSum = previousYearRecords.length === previousYearPrefixMonths.length ? sumCurrentRevenue(previousYearRecords) : null;
    const priorYearToDateRevenue = previousYtdComparable !== "ok" || previousYtdSum === null
      ? metricWithheld(previousYtdComparable === "ok" ? "missing_comparable_month" : previousYtdComparable, previousYearPrefixMonths)
      : metricAvailable(previousYtdSum, previousYearPrefixMonths);

    const yearToDateYearOverYearPercent = currentYearToDateRevenue.status === "available"
      && priorYearToDateRevenue.status === "available"
      && Number(priorYearToDateRevenue.value) !== 0
      ? metricAvailable(
          ((Number(currentYearToDateRevenue.value) - Number(priorYearToDateRevenue.value)) / Number(priorYearToDateRevenue.value)) * 100,
          [...previousYearPrefixMonths, ...currentYearPrefixMonths],
        )
      : metricWithheld(
          currentYearToDateRevenue.status === "withheld"
            ? currentYearToDateRevenue.reasonCode
            : priorYearToDateRevenue.status === "withheld"
              ? priorYearToDateRevenue.reasonCode
              : "zero_denominator",
          [...previousYearPrefixMonths, ...currentYearPrefixMonths],
        );

    const seasonalityShareOfTrailing12MonthRevenue = trailing12MonthRevenue.status === "withheld"
      ? metricWithheld(trailing12MonthRevenue.reasonCode, trailing12Months)
      : yoyCurrent === null
        ? metricWithheld("missing_comparable_month", trailing12Months)
        : Number(trailing12MonthRevenue.value) === 0
          ? metricWithheld("zero_denominator", trailing12Months)
          : metricAvailable((yoyCurrent / Number(trailing12MonthRevenue.value)) * 100, trailing12Months);

    return {
      ...record,
      derivedMetrics: {
        yearOverYearPercent,
        rolling3MonthRevenue,
        trailing12MonthRevenue,
        currentYearToDateRevenue,
        priorYearToDateRevenue,
        yearToDateYearOverYearPercent,
        seasonalityShareOfTrailing12MonthRevenue,
      },
    };
  });
}

function deriveMonthlyRevenueConclusion(
  latestItem: ReturnType<typeof deriveMonthlyRevenueMetrics>[number] | undefined,
  latestExpectedMonth: string,
  latestDueStatus: "reported" | "missing",
) {
  const latestYoy = latestItem?.derivedMetrics.yearOverYearPercent;
  if (latestItem !== undefined && latestYoy?.status === "available" && latestDueStatus === "reported") {
    return {
      status: "supported" as const,
      statement: `Monthly revenue trend remains descriptive only: latest available month ${latestItem.revenueMonth} shows YoY ${latestYoy.value}% with authoritative MOPS lineage.`,
      reasonCodes: [],
    };
  }
  return {
    status: "withheld" as const,
    statement: latestDueStatus === "missing"
      ? `Monthly revenue conclusion withheld because the latest due month ${latestExpectedMonth} is not yet present in the canonical store.`
      : "Monthly revenue conclusion withheld because the current window does not pass the required comparability gates.",
    reasonCodes: latestDueStatus === "missing"
      ? ["latest_due_gap"]
      : [
          ...(latestYoy?.status === "withheld" ? [latestYoy.reasonCode] : latestItem === undefined ? ["not_acquired"] : []),
        ],
  };
}

function effectiveRevenueRecords(
  records: readonly ResearchMonthlyRevenueRecord[],
  effectiveAt: string,
) {
  const effectiveDate = taiwanLocalIsoDate(effectiveAt);
  return records.filter((record) => record.publicationContext.publishedAt <= effectiveDate);
}

export async function getMonthlyRevenue(
  persistence: Persistence,
  query: ResearchMonthlyRevenueQuery,
) {
  const identity = await getResearchIdentity(persistence, {
    subject: query.subject,
    context: query.context,
    history: { limit: 1 },
  });
  const freshnessBasis = resolveFreshnessBasis(identity);
  const freshnessTarget = await resolveMonthlyRevenueFreshnessTarget(persistence, identity);
  const latestApplicableMonth = latestApplicableRevenueMonth(identity);
  const defaultWindowRecords = query.range?.endMonth === undefined
    ? resolveLatestMonthlyRevenueRecords(effectiveRevenueRecords(
        await persistence.listLatestResearchMonthlyRevenueRecords({
          subject: { kind: "listing_id", listingId: identity.selector.listingId },
          effectiveAt: query.context.effectiveAt,
          knowledgeAt: query.context.knowledgeAt,
          startMonth: firstMonthForTrailingWindow(freshnessTarget.latestExpectedMonth, DEFAULT_MONTHLY_REVENUE_MONTHS),
          endMonth: latestApplicableMonth,
        }),
        query.context.effectiveAt,
      ))
    : [];
  const newestEffectiveMonth = defaultWindowRecords.reduce(
    (latest, record) => record.revenueMonth > latest ? record.revenueMonth : latest,
    freshnessTarget.latestExpectedMonth,
  );
  const { startMonth, endMonth } = resolveMonthlyRevenueWindow(query, newestEffectiveMonth);
  const supportStartMonth = identity.identity.listing.listedAt.slice(0, 7);
  const freshnessRecords = resolveLatestMonthlyRevenueRecords(effectiveRevenueRecords(
    await persistence.listLatestResearchMonthlyRevenueRecords({
      subject: { kind: "listing_id", listingId: identity.selector.listingId },
      effectiveAt: query.context.effectiveAt,
      knowledgeAt: query.context.knowledgeAt,
      startMonth: freshnessTarget.latestExpectedMonth,
      endMonth: freshnessTarget.latestExpectedMonth,
    }),
    query.context.effectiveAt,
  ));
  const latestRecords = resolveLatestMonthlyRevenueRecords(effectiveRevenueRecords(
    await persistence.listLatestResearchMonthlyRevenueRecords({
      subject: { kind: "listing_id", listingId: identity.selector.listingId },
      effectiveAt: query.context.effectiveAt,
      knowledgeAt: query.context.knowledgeAt,
      startMonth: supportStartMonth,
      endMonth,
    }),
    query.context.effectiveAt,
  ));
  const windowRecords = latestRecords.filter((record) =>
    record.revenueMonth >= startMonth && record.revenueMonth <= endMonth
  );
  const derived = deriveMonthlyRevenueMetrics(
    windowRecords,
    latestRecords,
    identity.identity.listing.listedAt.slice(0, 7),
  );
  const ordered = query.page.order === "asc" ? derived : [...derived].reverse();
  const cursorMonth = decodeRevenueCursor(
    query.page.cursor,
    identity.selector.listingId,
    query.context,
    startMonth,
    endMonth,
    query.page.order,
  );
  if (cursorMonth !== undefined && !ordered.some((record) => record.revenueMonth === cursorMonth)) {
    throw new ResearchServiceError("research_cursor_invalid", "The monthly revenue cursor is invalid");
  }
  const filtered = cursorMonth === undefined
    ? ordered
    : ordered.filter((record) => query.page.order === "asc"
      ? record.revenueMonth > cursorMonth
      : record.revenueMonth < cursorMonth);
  const pageItems = filtered.slice(0, query.page.limit);
  const nextCursor = filtered.length > query.page.limit
    ? encodeRevenueCursor(
        pageItems.at(-1)!.revenueMonth,
        identity.selector.listingId,
        query.context,
        startMonth,
        endMonth,
        query.page.order,
      )
    : null;
  const conclusionItem = derived.at(-1);
  const evidenceMonths = new Set([
    ...pageItems.flatMap((record) => [
      record.revenueMonth,
      ...Object.values(record.derivedMetrics).flatMap((metric) => metric.lineageMonths),
    ]),
    ...(conclusionItem
      ? [conclusionItem.revenueMonth, ...conclusionItem.derivedMetrics.yearOverYearPercent.lineageMonths]
      : []),
  ]);
  const provenanceIds = [...new Set(
    [
      ...latestRecords
        .filter((record) => evidenceMonths.has(record.revenueMonth))
        .map((record) => record.provenance.id),
      ...freshnessRecords.map((record) => record.provenance.id),
    ],
  )];
  const latestDueStatus = freshnessRecords.length > 0 ? "reported" as const : "missing" as const;
  return {
    contractVersion: "monthly-revenue/1.0.0" as const,
    selector: identity.selector,
    context: identity.context,
    window: {
      startMonth,
      endMonth,
      requestedOrder: query.page.order,
      pageLimit: query.page.limit,
      defaultMonths: 24 as const,
      maxMonths: 120 as const,
    },
    freshness: {
      basis: freshnessBasis,
      gracePolicy: "next_taiwan_business_day" as const,
      latestExpectedMonth: freshnessTarget.latestExpectedMonth,
      statutoryDueDate: freshnessTarget.statutoryDueDate,
      latestDueStatus,
    },
    conclusion: deriveMonthlyRevenueConclusion(
      conclusionItem,
      freshnessTarget.latestExpectedMonth,
      latestDueStatus,
    ),
    items: pageItems.map((record) => ({
      revenueMonth: record.revenueMonth,
      publicationContext: record.publicationContext,
      sourceFacts: {
        companyName: record.sourceFacts.companyName,
        industryName: record.sourceFacts.industryName,
        currentMonthRevenue: record.sourceFacts.currentMonthRevenue,
        priorMonthRevenue: record.sourceFacts.priorMonthRevenue,
        priorYearSameMonthRevenue: record.sourceFacts.priorYearSameMonthRevenue,
        publisherComparisons: {
          monthOverMonthPercent: record.sourceFacts.publisherComparisons.monthOverMonthPercent,
          yearOverYearPercent: record.sourceFacts.publisherComparisons.yearOverYearPercent,
          currentYearToDateRevenue: record.sourceFacts.publisherComparisons.currentYearToDateRevenue,
          priorYearToDateRevenue: record.sourceFacts.publisherComparisons.priorYearToDateRevenue,
          yearToDateYearOverYearPercent: record.sourceFacts.publisherComparisons.yearToDateYearOverYearPercent,
        },
        note: record.sourceFacts.note,
      },
      basisChange: record.basisChange,
      derivedMetrics: record.derivedMetrics,
    })),
    page: { nextCursor },
    evidence: { provenanceIds },
  };
}
