import { createHash } from "node:crypto";
import { z } from "zod";
import type { Persistence } from "../../persistence/types.js";
import { resolveMarketCalendarDayStatus } from "../market-data/marketCalendarService.js";
import { getMarketLocalParts } from "../market-data/marketRegularSession.js";
import {
  appendOfficialListingAbsenceObservation,
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
  officialHistoricalListingIdentityKey,
  researchIdentityRevisionPrecedence,
  resolveResearchIdentityLatestState,
  withListingPredecessor,
  type OfficialIdentityInput,
  type ResearchIdentityRecord,
} from "./identity.js";
import {
  canonicalizeOfficialPriceRow,
  type ResearchPriceRecord,
} from "./price.js";
import {
  parseOfficialMonthlyRevenueSnapshot,
  type RevenueIdentityLookup,
} from "./providers/monthlyRevenue.js";
import {
  parseMopsFinancialStatementArtifact,
  type MopsFinancialStatementArtifact,
  type MopsFinancialStatementDescriptor,
} from "./providers/mopsXbrl.js";
import { researchAcquisitionEnabled } from "./rollout.js";
import {
  parseOfficialSecuritiesFirmDirectory,
  parseTwseCompanyIdentitySnapshot,
  parseTwseDelistingSnapshot,
  parseTwseEtnIdentitySnapshot,
  parseTwseEtnRetirementSnapshot,
  parseTwseFundIdentitySnapshot,
  resolveOfficialEtnIssuerIdentity,
  taiwanBusinessDate,
  type OfficialSecuritiesFirmDirectory,
} from "./providers/twseIdentity.js";
import {
  parseTpexCompanyIdentitySnapshot,
  parseTpexDelistingSnapshot,
  parseTpexEtnIdentitySnapshot,
  parseTpexEtnRetirementSnapshot,
  parseTpexFundIdentitySnapshot,
} from "./providers/tpexIdentity.js";
import {
  parseTpexPriceSnapshot,
  parseTpexSuspensionSnapshot,
} from "./providers/tpexPrice.js";
import {
  parseTwsePriceSnapshot,
  parseTwseSuspensionSnapshot,
} from "./providers/twsePrice.js";
import type { ResearchMonthlyRevenueRecord } from "./monthlyRevenue.js";
import {
  normalizeResearchFinancialStatementFact,
  researchFinancialStatementMetricForConcept,
  researchFinancialStatementTaxonomyVersion,
  researchFinancialStatementUnitId,
  resolveMopsArtifactFilingBasis,
  type ResearchFinancialStatementAmbiguityFlag,
  type ResearchFinancialStatementFact,
  type ResearchFinancialStatementKind,
  type ResearchFinancialStatementRecord,
  researchFinancialStatementRecordKey,
  valueKindForMopsFact,
} from "./financialStatements.js";

export const OFFICIAL_IDENTITY_SOURCES = {
  twseCompanies: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  tpexCompanies: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
  twseFunds: "https://openapi.twse.com.tw/v1/opendata/t187ap47_L",
  tpexFunds: "https://info.tpex.org.tw/api/etfFilter",
  twseSecuritiesFirms: "https://openapi.twse.com.tw/v1/opendata/t187ap18",
  twseEtns: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json",
  tpexEtns: "https://www.tpex.org.tw/www/zh-tw/ETN/list?type=listed",
  twseEtnRetirements: "https://www.twse.com.tw/rwd/zh/ETN/expireEnd?response=json",
  tpexEtnRetirements: "https://www.tpex.org.tw/www/zh-tw/ETN/list?type=delisted",
  twseDelistings: "https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml",
  tpexDelistings: "https://www.tpex.org.tw/www/zh-tw/company/deListed?code=&reason=-1",
} as const;

export const OFFICIAL_MONTHLY_REVENUE_SOURCES = {
  twseMonthlyRevenue: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
  tpexMonthlyRevenue: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap05_O",
} as const;

export const OFFICIAL_PRICE_SOURCES = {
  twsePrices: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  twseSuspensions: "https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU",
  tpexPrices: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  tpexSuspensionsToday: "https://www.tpex.org.tw/openapi/v1/tpex_spendi_today",
  tpexSuspensionsHistory: "https://www.tpex.org.tw/openapi/v1/tpex_spendi_history",
} as const;

export const OFFICIAL_FINANCIAL_STATEMENT_BASE_URL = "https://mops.twse.com.tw/server-java/t164sb01";

const TPEX_DELISTING_FIRST_YEAR = 2021;
const ETF_ABSENCE_COMPLETENESS_GUARD_PERCENT = 1;
const MONTHLY_REVENUE_MINIMUM_COVERAGE_PERCENT = 80;

export class ResearchAcquisitionDisabledError extends Error {
  readonly code = "research_acquisition_disabled";
  readonly statusCode = 503;

  constructor() {
    super("Taiwan research acquisition is disabled by rollout policy");
    this.name = "ResearchAcquisitionDisabledError";
  }
}

interface AcquisitionOptions {
  fetchImpl?: typeof fetch;
  retrievedAt?: string;
  acquisitionRunId?: string;
}

interface IdentityAcquisitionOptions extends AcquisitionOptions {
  recordEtfAbsenceEvidence?: boolean;
}

interface FinancialStatementAcquisitionOptions extends AcquisitionOptions {
  descriptors?: readonly MopsFinancialStatementDescriptor[];
  resolveDescriptors?: () => Promise<readonly MopsFinancialStatementDescriptor[]>;
}

const FINANCIAL_STATEMENT_ACQUISITION_CONCURRENCY = 4;

async function fetchArtifact(fetchImpl: typeof fetch, sourceUrl: string, init?: RequestInit) {
  const response = await fetchImpl(sourceUrl, {
    ...init,
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Official identity source ${sourceUrl} returned HTTP ${response.status}`);
  }
  const body = await response.text();
  return {
    payload: JSON.parse(body) as unknown,
    metadata: {
      sourceUrl,
      contentHash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    },
  };
}

async function fetchRawArtifact(fetchImpl: typeof fetch, sourceUrl: string, init?: RequestInit) {
  const response = await fetchImpl(sourceUrl, {
    ...init,
    headers: { accept: "application/xhtml+xml,application/xml,text/xml,text/html;q=0.9,*/*;q=0.8" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Official MOPS financial statement source ${sourceUrl} returned HTTP ${response.status}`);
  }
  const body = await response.text();
  return {
    body,
    metadata: {
      sourceUrl,
      contentHash: `sha256:${createHash("sha256").update(body).digest("hex")}`,
    },
  };
}

function statementKindForMopsRole(role: MopsFinancialStatementArtifact["facts"][number]["statementRole"]): ResearchFinancialStatementKind | null {
  switch (role) {
    case "income_statement":
      return "income";
    case "balance_sheet":
      return "balance_sheet";
    case "cash_flow_statement":
      return "cash_flow";
    case "equity_statement":
      return "equity";
    case "unknown":
      return "sector_extension";
    default:
      return null;
  }
}

function timestampAtEndOfDay(date: string): string {
  return `${date}T23:59:59.999Z`;
}

function timestampAtStartOfDay(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function financialStatementPublishedAtTimestamp(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return new Date(`${value}T00:00:00+08:00`).toISOString();
  }
  if (value.includes("T") && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw new Error(`Invalid financial statement publication date or timestamp: ${value}`);
}

function artifactAmbiguityFlags(
  artifact: MopsFinancialStatementArtifact,
): ResearchFinancialStatementAmbiguityFlag[] {
  return [
    ...(artifact.issues.contextAmbiguity ? ["duplicate_context" as const] : []),
    ...(artifact.issues.unmappedConcepts.length > 0 ? ["unmapped_concept" as const] : []),
    ...(artifact.issues.unknownUnitIds.length > 0 ? ["unknown_unit" as const] : []),
    ...(artifact.issues.basisAmbiguity ? ["filing_basis_ambiguous" as const] : []),
    ...(artifact.issues.taxonomyAmbiguity ? ["taxonomy_change" as const] : []),
  ];
}

async function canonicalizeFinancialStatementArtifact(
  persistence: Persistence,
  artifact: MopsFinancialStatementArtifact,
): Promise<ResearchFinancialStatementRecord> {
  const initialPeriodToken = artifact.filing.fiscalPeriod === "annual"
    ? String(artifact.filing.fiscalYear).padStart(4, "0")
    : `${String(artifact.filing.fiscalYear).padStart(4, "0")}-Q${artifact.filing.fiscalPeriod.slice(1)}`;
  const initialFilingBasis = resolveMopsArtifactFilingBasis(artifact);
  const existingRevisions = await persistence.listResearchFinancialStatementRecords({
    subject: { kind: "listing_id", listingId: artifact.listingId },
    effectiveAt: artifact.artifact.retrievedAt,
    knowledgeAt: artifact.artifact.retrievedAt,
    periodicity: artifact.filing.fiscalPeriod === "annual" ? "annual" : "quarterly",
    filingBasis: initialFilingBasis,
    startPeriod: initialPeriodToken,
    endPeriod: initialPeriodToken,
  });
  const latestRevisionSequence = existingRevisions.reduce(
    (latest, record) => Math.max(latest, record.publicationContext.revisionSequence),
    -1,
  );
  const latestRevision = existingRevisions.find(
    (record) => record.publicationContext.revisionSequence === latestRevisionSequence,
  );
  const matchesLatestRevision = latestRevision?.provenance.contentHash === artifact.artifact.contentHash;
  if (artifact.filing.revision === 0 && existingRevisions.length > 0) {
    artifact = {
      ...artifact,
      filing: {
        ...artifact.filing,
        revision: matchesLatestRevision ? latestRevisionSequence : latestRevisionSequence + 1,
        amendmentType: matchesLatestRevision
          ? latestRevision!.publicationContext.restatement
            ? "restatement"
            : latestRevision!.publicationContext.amendment
              ? "amendment"
              : "original"
          : "amendment",
        publishedAt: matchesLatestRevision
          ? latestRevision!.publicationContext.publishedAt
          : artifact.filing.publishedAt,
      },
    };
  }
  const unitsById = new Map(artifact.units.map((unit) => [unit.id, unit] as const));
  const duplicateContextIds = new Set(
    artifact.issues.duplicateContextGroups.flatMap((group) => group.contextIds),
  );
  const statementFacts = new Map<ResearchFinancialStatementKind, ResearchFinancialStatementFact[]>();
  const pushFact = (statementKind: ResearchFinancialStatementKind, fact: ResearchFinancialStatementFact) => {
    const current = statementFacts.get(statementKind) ?? [];
    const repeated = current.find((candidate) => candidate.id === fact.id);
    if (repeated && JSON.stringify(repeated) === JSON.stringify(fact)) return;
    current.push(fact);
    statementFacts.set(statementKind, current);
  };
  for (const fact of artifact.facts) {
    const statementKind = statementKindForMopsRole(fact.statementRole);
    if (!statementKind) continue;
    const unit = fact.unitRef ? unitsById.get(fact.unitRef) : undefined;
    pushFact(statementKind, normalizeResearchFinancialStatementFact({
      listingId: artifact.listingId,
      issuerId: artifact.issuerId,
      filingId: artifact.filing.filingId,
      revisionId: `${artifact.filing.filingId}:r${artifact.filing.revision}`,
      statementKind,
      concept: {
        qname: fact.concept.qname,
        label: fact.concept.localName,
      },
      taxonomy: {
        namespaceUri: fact.concept.namespaceUri,
        version: researchFinancialStatementTaxonomyVersion(fact.concept.namespaceUri),
      },
      metric: researchFinancialStatementMetricForConcept(fact.concept.localName, fact.concept.namespaceUri),
      contextId: fact.contextRef,
      dimensions: Object.fromEntries(fact.contextDimensions.map((dimension) => [dimension.dimension, dimension.member] as const)),
      period: fact.periodStart
        ? {
            kind: "duration",
            startAt: timestampAtStartOfDay(fact.periodStart),
            endAt: timestampAtEndOfDay(fact.periodEnd ?? artifact.filing.periodEnd),
          }
        : {
            kind: "instant",
            instantAt: timestampAtEndOfDay(fact.periodEnd ?? artifact.filing.periodEnd),
          },
      valueKind: valueKindForMopsFact(fact, artifact.filing),
      rawValue: fact.rawValue,
      normalizedValue: fact.normalizedValue,
      unit: unit
        ? { state: "known", unitId: researchFinancialStatementUnitId(unit, fact.unitRef ?? "unknown") }
        : { state: "unknown", rawUnitId: fact.unitRef },
      declaredScale: fact.scale,
      declaredPrecision: fact.decimals,
      declaredSign: fact.sign,
      declaredFormat: fact.format,
      ambiguityFlags: [
        ...(duplicateContextIds.has(fact.contextRef) ? ["duplicate_context" as const] : []),
        ...(artifact.issues.basisAmbiguity ? ["filing_basis_ambiguous" as const] : []),
        ...(artifact.issues.taxonomyAmbiguity ? ["taxonomy_change" as const] : []),
      ],
    }));
  }
  const revisionId = `${artifact.filing.filingId}:r${artifact.filing.revision}`;
  const statements: ResearchFinancialStatementRecord["statements"] = [
    { kind: "income", facts: statementFacts.get("income") ?? [] },
    { kind: "balance_sheet", facts: statementFacts.get("balance_sheet") ?? [] },
    { kind: "cash_flow", facts: statementFacts.get("cash_flow") ?? [] },
    ...(statementFacts.has("equity") ? [{ kind: "equity" as const, facts: statementFacts.get("equity") ?? [] }] : []),
    ...(statementFacts.has("sector_extension")
      ? [{ kind: "sector_extension" as const, facts: statementFacts.get("sector_extension") ?? [], metadata: { sector: artifact.sector } }]
      : []),
  ];
  const periodToken = artifact.filing.fiscalPeriod === "annual"
    ? String(artifact.filing.fiscalYear).padStart(4, "0")
    : `${String(artifact.filing.fiscalYear).padStart(4, "0")}-Q${artifact.filing.fiscalPeriod.slice(1)}`;
  const filingBasis = resolveMopsArtifactFilingBasis(artifact);
  const observedPublishedAt = financialStatementPublishedAtTimestamp(artifact.filing.publishedAt);
  const predecessorCandidates = artifact.filing.revision > 0
    ? await persistence.listLatestResearchFinancialStatementRecords({
        subject: { kind: "listing_id", listingId: artifact.listingId },
        effectiveAt: observedPublishedAt,
        knowledgeAt: artifact.artifact.retrievedAt,
        periodicity: artifact.filing.fiscalPeriod === "annual" ? "annual" : "quarterly",
        filingBasis,
        startPeriod: periodToken,
        endPeriod: periodToken,
      })
    : [];
  const predecessor = predecessorCandidates
    .filter((candidate) => candidate.publicationContext.revisionSequence < artifact.filing.revision)
    .sort((left, right) => right.publicationContext.revisionSequence - left.publicationContext.revisionSequence)[0];
  const publishedAt = matchesLatestRevision
    ? latestRevision!.publicationContext.publishedAt
    : predecessor?.publicationContext.publishedAt ?? observedPublishedAt;
  const revisionPublishedAt = artifact.filing.revision > 0
    ? matchesLatestRevision
      ? latestRevision!.publicationContext.revisionPublishedAt
      : observedPublishedAt
    : null;
  const relations: ResearchFinancialStatementRecord["relations"] = predecessor
    ? [{
        kind: "supersedes",
        targetRecordKey: researchFinancialStatementRecordKey(predecessor),
      }]
    : [];
  return {
    listingId: artifact.listingId,
    issuerId: artifact.issuerId,
    ticker: artifact.ticker,
    venue: artifact.venue,
    periodicity: artifact.filing.fiscalPeriod === "annual" ? "annual" : "quarterly",
    fiscalPeriod: {
      fiscalYear: artifact.filing.fiscalYear,
      fiscalQuarter: artifact.filing.fiscalPeriod === "annual" ? null : Number(artifact.filing.fiscalPeriod.slice(1)) as 1 | 2 | 3 | 4,
      periodStart: artifact.filing.periodStart,
      periodEnd: artifact.filing.periodEnd,
    },
    filingBasis,
    publicationContext: {
      filingId: artifact.filing.filingId,
      revisionId,
      publishedAt,
      revisionPublishedAt,
      filingSequence: 0,
      revisionSequence: artifact.filing.revision,
      processingId: artifact.artifact.contentHash,
      processingSequence: 0,
      restatement: artifact.filing.amendmentType === "restatement",
      amendment: artifact.filing.amendmentType === "amendment",
    },
    statements,
    relations,
    ambiguityFlags: artifactAmbiguityFlags(artifact),
    provenance: {
      id: `prv_${createHash("sha256").update([artifact.listingId, artifact.filing.filingId, artifact.artifact.contentHash].join("\u001f")).digest("hex").slice(0, 32)}`,
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      authorityRole: "authoritative",
      canonicalDatasetId: "financial_statements",
      publisherDataset: artifact.artifact.artifactKind === "ixbrl" ? "mops_ixbrl" : "mops_xbrl",
      sourceUrl: artifact.artifact.sourceUrl,
      contentHash: artifact.artifact.contentHash,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: artifact.artifact.acquisitionRunId,
      retrievedAt: artifact.artifact.retrievedAt,
      processedAt: artifact.artifact.retrievedAt,
      parserVersion: "research-financial-statements-parser/1.0.0",
      taxonomyVersion: artifact.artifact.taxonomyVersions[0] ?? artifact.artifact.primaryNamespace ?? "unknown",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  };
}

function officialSnapshotSessionDate(
  venue: "TWSE" | "TPEX",
  rows: Array<{ sessionDate: string }>,
): string {
  const uniqueDates = [...new Set(rows.map((row) => row.sessionDate))];
  if (uniqueDates.length === 0) {
    throw new Error(`Official ${venue} price snapshot returned no rows`);
  }
  if (uniqueDates.length > 1) {
    throw new Error(
      `Official ${venue} price snapshot returned multiple session dates: ${uniqueDates.join(",")}`,
    );
  }
  return uniqueDates[0]!;
}

function priceSessionEffectiveAt(sessionDate: string): string {
  return new Date(`${sessionDate}T16:00:00.000+08:00`).toISOString();
}

function addIsoDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (days * 86_400_000))
    .toISOString()
    .slice(0, 10);
}

async function expectedOfficialPriceSessionDate(
  persistence: Persistence,
  retrievedAt: string,
): Promise<string> {
  const instant = new Date(retrievedAt);
  if (Number.isNaN(instant.valueOf())) {
    throw new Error(`Invalid retrieval timestamp: ${retrievedAt}`);
  }
  const { localDate, localHour, localMinute } = getMarketLocalParts("TW", instant);
  let candidate = localHour > 18 || (localHour === 18 && localMinute >= 0)
    ? localDate
    : addIsoDays(localDate, -1);
  const versions = new Map<number, Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>>();
  for (let dayOffset = 0; dayOffset < 45; dayOffset += 1) {
    const calendarYear = Number(candidate.slice(0, 4));
    if (!versions.has(calendarYear)) {
      versions.set(
        calendarYear,
        await persistence.getActiveMarketCalendarVersion("TW", calendarYear),
      );
    }
    const status = resolveMarketCalendarDayStatus(versions.get(calendarYear) ?? null, candidate);
    if (status === "calendar_unknown") {
      throw new Error(`Official TW market calendar is unavailable for ${calendarYear}`);
    }
    if (status === "open") return candidate;
    candidate = addIsoDays(candidate, -1);
  }
  throw new Error(`Official TW market calendar has no expected session before ${localDate}`);
}

function assertExpectedPriceSnapshotSession(
  venue: "TWSE" | "TPEX",
  actualSessionDate: string,
  expectedSessionDate: string,
): void {
  if (actualSessionDate !== expectedSessionDate) {
    throw new Error(
      `Official ${venue} price snapshot is stale: expected ${expectedSessionDate}, received ${actualSessionDate}`,
    );
  }
}

function assertPriceSnapshotCompleteness(
  venue: "TWSE" | "TPEX",
  activeListings: ResearchIdentityRecord[],
  observedTickers: Set<string>,
): void {
  if (activeListings.length === 0) {
    throw new Error(`Official ${venue} price snapshot has no active canonical listing universe`);
  }
  const missingListings = activeListings.filter(
    (record) => !observedTickers.has(record.listing.ticker),
  );
  if (missingListings.length > 0) {
    throw new Error(
      `Official ${venue} price snapshot failed completeness guard: `
      + `${missingListings.length} of ${activeListings.length} active listings are absent`,
    );
  }
}

function assertMonthlyRevenueSnapshotCompleteness(
  venue: "TWSE" | "TPEX",
  listings: ResearchIdentityRecord[],
  records: ResearchMonthlyRevenueRecord[],
  expectedStandardMonth: string,
  expectedInsuranceMonth: string,
): ResearchMonthlyRevenueRecord[] {
  const activeCompanies = listings.filter(
    (record) => record.listing.status === "active" && record.eligibility.profile === "operating_company",
  );
  if (activeCompanies.length === 0) {
    throw new Error(`Official ${venue} monthly revenue snapshot has no active canonical company universe`);
  }
  if (records.length === 0) {
    throw new Error(`Official ${venue} monthly revenue snapshot returned no canonical rows`);
  }
  const companiesByListingId = new Map(activeCompanies.map((record) => [record.listing.id, record]));
  const activeListingIds = new Set(companiesByListingId.keys());
  const currentRecords = records.filter((record) => {
    const company = companiesByListingId.get(record.listingId);
    if (!company) return false;
    const expectedMonth = company.issuer.classification === "financial_institution"
      ? expectedInsuranceMonth
      : expectedStandardMonth;
    return record.revenueMonth >= expectedMonth;
  });
  const observedListingIds = new Set(currentRecords.map((record) => record.listingId));
  const receivedMonths = [...new Set(records.map((record) => record.revenueMonth))].sort();
  const groups = [
    {
      companies: activeCompanies.filter((record) => record.issuer.classification !== "financial_institution"),
      expectedMonth: expectedStandardMonth,
    },
    {
      companies: activeCompanies.filter((record) => record.issuer.classification === "financial_institution"),
      expectedMonth: expectedInsuranceMonth,
    },
  ];
  for (const group of groups) {
    if (group.companies.length === 0) continue;
    const observedCount = group.companies.filter((record) => observedListingIds.has(record.listing.id)).length;
    if (observedCount === 0) {
      throw new Error(
        `Official ${venue} monthly revenue snapshot is stale: `
        + `expected ${group.expectedMonth}, received ${receivedMonths.join(",")}`,
      );
    }
    if (observedCount * 100 < group.companies.length * MONTHLY_REVENUE_MINIMUM_COVERAGE_PERCENT) {
      throw new Error(
        `Official ${venue} monthly revenue snapshot failed completeness guard: `
        + `${group.companies.length - observedCount} of ${group.companies.length} active companies are absent`,
      );
    }
  }
  const inactiveCutoffByListingId = new Map(listings.flatMap((record) =>
    record.listing.status === "inactive" && record.listing.inactiveAt
      ? [[record.listing.id, record.listing.inactiveAt.slice(0, 7)] as const]
      : []
  ));
  const lifecycleApplicableRecords = records.filter((record) => {
    if (activeListingIds.has(record.listingId)) return true;
    const inactiveCutoff = inactiveCutoffByListingId.get(record.listingId);
    return inactiveCutoff !== undefined && record.revenueMonth <= inactiveCutoff;
  });
  return lifecycleApplicableRecords;
}

function shiftIsoMonth(month: string, offset: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, monthNumber - 1 + offset, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function expectedMonthlyRevenueMonth(
  persistence: Persistence,
  retrievedAt: string,
  dueDay: 10 | 15,
): Promise<string> {
  const localDate = taiwanBusinessDate(retrievedAt);
  const currentMonth = localDate.slice(0, 7);
  const rawDueDate = `${currentMonth}-${dueDay}`;
  let dueDate = rawDueDate;
  let dueDateResolved = false;
  const versions = new Map<number, Awaited<ReturnType<Persistence["getActiveMarketCalendarVersion"]>>>();
  for (let dayOffset = 0; dayOffset < 14; dayOffset += 1) {
    const calendarYear = Number(dueDate.slice(0, 4));
    if (!versions.has(calendarYear)) {
      versions.set(
        calendarYear,
        await persistence.getActiveMarketCalendarVersion("TW", calendarYear),
      );
    }
    const status = resolveMarketCalendarDayStatus(versions.get(calendarYear) ?? null, dueDate);
    if (status === "calendar_unknown") {
      throw new Error(`Official TW market calendar is unavailable for ${calendarYear}`);
    }
    if (status === "open") {
      dueDateResolved = true;
      break;
    }
    dueDate = addIsoDays(dueDate, 1);
  }
  if (!dueDateResolved) {
    throw new Error(`Official TW market calendar has no revenue due date after ${rawDueDate}`);
  }
  return shiftIsoMonth(currentMonth, localDate > dueDate ? -1 : -2);
}

function recordOrder(left: ResearchIdentityRecord, right: ResearchIdentityRecord): number {
  const listedOrder = left.listing.listedAt.localeCompare(right.listing.listedAt);
  if (listedOrder !== 0) return listedOrder;
  const effectiveOrder = (left.observations[0]?.effectiveAt ?? "")
    .localeCompare(right.observations[0]?.effectiveAt ?? "");
  return effectiveOrder !== 0
    ? effectiveOrder
    : left.provenance.retrievedAt.localeCompare(right.provenance.retrievedAt);
}

function normalizedObservationValue(
  record: ResearchIdentityRecord,
  field: string,
  subjectKind: "issuer" | "security" | "listing",
): string | undefined {
  const observation = record.observations.find((item) =>
    item.field === field && item.subject.kind === subjectKind
  );
  return observation?.normalized.state === "present" ? observation.normalized.value : undefined;
}

function reconcileExistingProductIdentity(
  input: OfficialIdentityInput,
  provisional: ResearchIdentityRecord,
  historicalLatest: ResearchIdentityRecord[],
): OfficialIdentityInput {
  if (input.row.kind === "fund") {
    if (input.venue !== "TPEX" || input.row.issuerIdentityKey === undefined) return input;
  } else if (input.row.kind !== "etn") {
    return input;
  }

  const securityType = input.row.kind === "fund" ? "etf" : "etn";
  const productNameField = input.row.kind === "fund" ? "product_legal_name" : "display_name";
  const productName = input.row.kind === "fund" ? input.row.legalName : input.row.displayName;
  const candidates = historicalLatest.filter((record) =>
    record.listing.status === "active"
    && record.listing.venue === input.venue
    && record.security.type === securityType
    && record.issuer.id === provisional.issuer.id
    && record.listing.listedAt === input.row.listedAt
  );
  const exactTickerMatches = candidates.filter((record) => record.listing.ticker === input.row.ticker);
  const exactNameMatches = candidates.filter((record) =>
    normalizedObservationValue(record, productNameField, "security") === productName
  );
  const matches = exactTickerMatches.length > 0 ? exactTickerMatches : exactNameMatches;
  if (matches.length > 1) {
    throw new Error(`Ambiguous official product identity correction: ${input.venue}:${input.row.ticker}`);
  }
  const identityKey = matches[0]
    ? normalizedObservationValue(matches[0], "official_product_identity", "security")
    : undefined;
  if (!identityKey) return input;
  if (input.row.kind === "fund") {
    return {
      ...input,
      rawValues: { ...input.rawValues, official_product_identity: identityKey },
      row: { ...input.row, identityKey },
    };
  }
  return {
    ...input,
    rawValues: { ...input.rawValues, official_product_identity: identityKey },
    row: { ...input.row, identityKey },
  };
}

interface HistoricalDelistingSeed {
  venue: "TWSE" | "TPEX";
  ticker: string;
  inactiveAt: string;
  companyName?: string;
  displayName?: string;
  issuerName?: string;
  securityType?: "etn";
  artifact: {
    sourceUrl: string;
    contentHash: string;
    publisherDataset: string;
    accessProvider?: "TWSE_OPENAPI" | "TPEX_OPENAPI" | "TWSE_WEB_JSON" | "TPEX_WEB_JSON";
  };
}

function historicalIdentitySeed(
  delisting: HistoricalDelistingSeed,
  securitiesFirms: OfficialSecuritiesFirmDirectory,
  retrievedAt: string,
  acquisitionRunId: string,
): ResearchIdentityRecord {
  const securityType = delisting.securityType ?? "common_equity";
  const identityKey = officialHistoricalListingIdentityKey({
    venue: delisting.venue,
    securityType,
    ticker: delisting.ticker,
    inactiveAt: delisting.inactiveAt,
  });
  const common = {
    venue: delisting.venue,
    snapshotDate: delisting.inactiveAt,
    retrievedAt,
    acquisitionRunId,
    listingStatus: "inactive" as const,
    inactiveAt: delisting.inactiveAt,
    artifact: delisting.artifact,
  } as const;
  if (delisting.securityType === "etn") {
    if (!delisting.issuerName || !delisting.displayName) {
      throw new Error(`Incomplete official ETN retirement identity: ${delisting.venue}:${delisting.ticker}`);
    }
    const issuerIdentity = resolveOfficialEtnIssuerIdentity(delisting.issuerName, securitiesFirms);
    return canonicalizeOfficialIdentityRow({
      ...common,
      rawValues: {
        legal_name: delisting.issuerName,
        display_name: delisting.displayName,
        ticker: delisting.ticker,
        issuer_identity_key: issuerIdentity.businessNumber,
        official_product_identity: identityKey,
        note_type: "ETN",
      },
      row: {
        kind: "etn",
        ticker: delisting.ticker,
        legalName: delisting.issuerName,
        displayName: delisting.displayName,
        identityKey,
        issuerIdentityKey: issuerIdentity.businessNumber,
        noteType: "ETN",
        // Retirement tables do not publish the original listing date. Use the
        // first official effective boundary so the identity is never projected
        // into an earlier period without source evidence.
        listedAt: delisting.inactiveAt,
      },
    });
  }
  if (!delisting.companyName) {
    throw new Error(`Incomplete official company delisting identity: ${delisting.venue}:${delisting.ticker}`);
  }
  return canonicalizeOfficialIdentityRow({
    ...common,
    rawValues: {
      legal_name: delisting.companyName,
      display_name: delisting.companyName,
      ticker: delisting.ticker,
      declared_security_type: "common_equity",
      official_product_identity: identityKey,
    },
    row: {
      kind: "unknown",
      ticker: delisting.ticker,
      legalName: delisting.companyName,
      displayName: delisting.companyName,
      identityKey,
      declaredSecurityType: "common_equity",
      // See the ETN branch above: this is an evidence boundary, not an
      // inferred historical listing date.
      listedAt: delisting.inactiveAt,
    },
  });
}

function retirementTargetsRecord(
  delisting: HistoricalDelistingSeed,
  record: ResearchIdentityRecord,
): boolean {
  const securityTypeMatches = delisting.securityType === "etn"
    ? record.security.type === "etn"
    : record.security.type === "common_equity" || record.security.type === "unknown";
  return delisting.venue === record.listing.venue
    && delisting.ticker === record.listing.ticker
    && securityTypeMatches
    && record.listing.listedAt <= delisting.inactiveAt;
}

function retirementAlreadyRecorded(
  delisting: HistoricalDelistingSeed,
  record: ResearchIdentityRecord,
): boolean {
  if (
    !retirementTargetsRecord(delisting, record)
    || record.listing.status !== "inactive"
    || record.listing.inactiveAt !== delisting.inactiveAt
  ) return false;
  const legalName = normalizedObservationValue(record, "legal_name", "issuer");
  if (delisting.securityType === "etn") {
    return legalName === delisting.issuerName
      && normalizedObservationValue(record, "display_name", "security") === delisting.displayName;
  }
  return legalName === delisting.companyName;
}

export async function runOfficialIdentityAcquisition(
  persistence: Persistence,
  options: IdentityAcquisitionOptions = {},
) {
  if (!researchAcquisitionEnabled()) throw new ResearchAcquisitionDisabledError();
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const acquisitionRunId = options.acquisitionRunId ?? `research-identity-${retrievedAt}`;
  const retrievalBusinessDate = taiwanBusinessDate(retrievedAt);
  const retrievalYear = Number(retrievalBusinessDate.slice(0, 4));
  if (!Number.isInteger(retrievalYear) || retrievalYear < TPEX_DELISTING_FIRST_YEAR) {
    throw new Error(`Unsupported identity acquisition retrieval time: ${retrievedAt}`);
  }
  const tpexDelistingUrls = Array.from(
    { length: retrievalYear - TPEX_DELISTING_FIRST_YEAR + 1 },
    (_, index) => `${OFFICIAL_IDENTITY_SOURCES.tpexDelistings}&date=${TPEX_DELISTING_FIRST_YEAR + index}`,
  );
  const [
    twseCompanies,
    tpexCompanies,
    twseFunds,
    tpexFunds,
    twseSecuritiesFirms,
    twseEtns,
    tpexEtns,
    twseEtnRetirements,
    tpexEtnRetirements,
    twseDelistings,
    tpexDelistingArtifacts,
  ] = await Promise.all([
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseCompanies),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.tpexCompanies),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseFunds),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.tpexFunds, { method: "POST" }),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseSecuritiesFirms),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseEtns),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.tpexEtns),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseEtnRetirements),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.tpexEtnRetirements),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseDelistings),
    Promise.all(tpexDelistingUrls.map((sourceUrl) => fetchArtifact(fetchImpl, sourceUrl))),
  ]);
  const parseMetadata = (artifact: { metadata: { sourceUrl: string; contentHash: string } }) => ({
    ...artifact.metadata,
    retrievedAt,
  });
  const securitiesFirms = parseOfficialSecuritiesFirmDirectory(twseSecuritiesFirms.payload);
  const inputs: OfficialIdentityInput[] = [
    ...parseTwseCompanyIdentitySnapshot(twseCompanies.payload, parseMetadata(twseCompanies)),
    ...parseTpexCompanyIdentitySnapshot(tpexCompanies.payload, parseMetadata(tpexCompanies)),
    ...parseTwseFundIdentitySnapshot(twseFunds.payload, parseMetadata(twseFunds)),
    ...parseTpexFundIdentitySnapshot(tpexFunds.payload, parseMetadata(tpexFunds)),
    ...parseTwseEtnIdentitySnapshot(twseEtns.payload, parseMetadata(twseEtns), securitiesFirms),
    ...parseTpexEtnIdentitySnapshot(tpexEtns.payload, parseMetadata(tpexEtns), securitiesFirms),
  ].map((input) => ({ ...input, acquisitionRunId }));
  const delistings = [
    ...parseTwseDelistingSnapshot(twseDelistings.payload).map((delisting) => ({
      ...delisting,
      venue: "TWSE" as const,
      artifact: {
        ...twseDelistings.metadata,
        publisherDataset: "company/suspendListingCsvAndHtml",
      },
    })),
    ...tpexDelistingArtifacts.flatMap((artifact) => parseTpexDelistingSnapshot(artifact.payload).map((delisting) => ({
      ...delisting,
      venue: "TPEX" as const,
      artifact: {
        ...artifact.metadata,
        publisherDataset: "company/deListed",
      },
    }))),
    ...parseTwseEtnRetirementSnapshot(twseEtnRetirements.payload).map((delisting) => ({
      ...delisting,
      venue: "TWSE" as const,
      securityType: "etn" as const,
      artifact: {
        ...twseEtnRetirements.metadata,
        publisherDataset: "ETN/expireEnd",
        accessProvider: "TWSE_WEB_JSON" as const,
      },
    })),
    ...parseTpexEtnRetirementSnapshot(tpexEtnRetirements.payload).map((delisting) => ({
      ...delisting,
      venue: "TPEX" as const,
      securityType: "etn" as const,
      artifact: {
        ...tpexEtnRetirements.metadata,
        publisherDataset: "ETN/list?type=delisted",
        accessProvider: "TPEX_WEB_JSON" as const,
      },
    })),
  ];
  const historicalRevisions = (await Promise.all((["TWSE", "TPEX"] as const).map((venue) =>
    persistence.listResearchIdentityLatestRevisions({
      subject: { kind: "venue", venue },
      effectiveAt: retrievedAt,
      knowledgeAt: retrievedAt,
    })
  ))).flat();
  const historicalByListing = new Map<string, ResearchIdentityRecord[]>();
  for (const record of historicalRevisions) {
    const revisions = historicalByListing.get(record.listing.id) ?? [];
    revisions.push(record);
    historicalByListing.set(record.listing.id, revisions);
  }
  const historicalLatest = [...historicalByListing.values()]
    .map((revisions) => resolveResearchIdentityLatestState(revisions))
    .filter((record): record is ResearchIdentityRecord => record !== undefined);
  const historicalAbsenceObservations = historicalRevisions.filter((record) =>
    researchIdentityRevisionPrecedence(record) === 2
  );
  const provisionalRecords = inputs.map(canonicalizeOfficialIdentityRow);
  const reconciledInputs = inputs.map((input, index) =>
    reconcileExistingProductIdentity(input, provisionalRecords[index]!, historicalLatest)
  );
  const canonicalRecords = reconciledInputs.map(canonicalizeOfficialIdentityRow);
  // Explicit retirement evidence outranks a lagging current-product snapshot.
  // Keep the current row available as the identity basis for the inactive
  // revision, but never append it as a later-effective active revision.
  const blockedCurrentRecordsWithRetirement = canonicalRecords.flatMap((record, index) => {
    const snapshotDate = reconciledInputs[index]!.snapshotDate;
    const retirement = delistings
      .filter((delisting) =>
        retirementTargetsRecord(delisting, record)
        && delisting.inactiveAt <= snapshotDate
      )
      .sort((left, right) => left.inactiveAt.localeCompare(right.inactiveAt))
      .at(-1);
    return retirement ? [{ record, inactiveAt: retirement.inactiveAt }] : [];
  });
  const currentRecordsBlockedByRetirement = blockedCurrentRecordsWithRetirement.map(({ record }) => record);
  const blockedCurrentRecords = new Set(currentRecordsBlockedByRetirement);
  const activeCanonicalRecords = canonicalRecords.filter((record) => !blockedCurrentRecords.has(record));
  const records: ResearchIdentityRecord[] = [];
  for (const record of activeCanonicalRecords) {
    const predecessor = [...historicalLatest, ...records]
      .filter((item) => item.security.id === record.security.id)
      .filter((item) => item.listing.id !== record.listing.id)
      .filter((item) => item.listing.listedAt < record.listing.listedAt)
      .sort(recordOrder)
      .at(-1);
    records.push(predecessor ? withListingPredecessor(record, predecessor.listing.id) : record);
  }
  const statusRevisions: ResearchIdentityRecord[] = [];
  const absenceObservations: ResearchIdentityRecord[] = [];
  for (const delisting of delistings) {
    const candidates = [
      ...historicalLatest,
      ...records,
      ...currentRecordsBlockedByRetirement,
      ...statusRevisions,
    ]
      .filter((item) => retirementTargetsRecord(delisting, item));
    if (candidates.some((item) => retirementAlreadyRecorded(delisting, item))) continue;
    const previous = candidates
      .filter((item) => item.listing.status === "active")
      .sort(recordOrder)
      .at(-1);
    if (!previous) {
      records.push(historicalIdentitySeed(delisting, securitiesFirms, retrievedAt, acquisitionRunId));
      continue;
    }
    statusRevisions.push(appendOfficialListingStatusRevision(previous, {
      status: "inactive",
      effectiveDate: delisting.inactiveAt,
      retrievedAt,
      acquisitionRunId,
      artifact: {
        ...delisting.artifact,
      },
    }));
  }

  // Retain the identity facts from a lagging current feed without persisting
  // its contradicted active-status observation. The authoritative retirement
  // revision remains the sole source for listing status.
  for (const { record, inactiveAt } of blockedCurrentRecordsWithRetirement) {
    const identityBasis: ResearchIdentityRecord = {
      ...record,
      listing: { ...record.listing, status: "inactive", inactiveAt },
      eligibility: {
        profile: record.eligibility.profile,
        state: "ineligible",
        reasonCode: "inactive_listing",
      },
      observations: record.observations.filter((observation) => observation.field !== "listing_status"),
    };
    const predecessor = [...historicalLatest, ...records]
      .filter((item) => item.security.id === identityBasis.security.id)
      .filter((item) => item.listing.id !== identityBasis.listing.id)
      .filter((item) => item.listing.listedAt < identityBasis.listing.listedAt)
      .sort(recordOrder)
      .at(-1);
    records.push(predecessor
      ? withListingPredecessor(identityBasis, predecessor.listing.id)
      : identityBasis);
  }

  const currentEtfListingIds = new Set(canonicalRecords
    .filter((record) => record.security.type === "etf")
    .map((record) => record.listing.id));
  const explicitlyInactiveListingIds = new Set(statusRevisions.map((record) => record.listing.id));
  for (const venue of ["TWSE", "TPEX"] as const) {
    if (options.recordEtfAbsenceEvidence === false) continue;
    const historical = historicalLatest.filter((record) => record.listing.venue === venue);
    const historicalActiveEtfs = historical.filter((record) =>
      record.security.type === "etf" && record.listing.status === "active"
    );
    const unexplainedMissingEtfs = historicalActiveEtfs.filter((record) =>
      !currentEtfListingIds.has(record.listing.id)
      && !explicitlyInactiveListingIds.has(record.listing.id)
    );
    const absenceGuardCeiling = Math.max(
      1,
      Math.floor(historicalActiveEtfs.length * ETF_ABSENCE_COMPLETENESS_GUARD_PERCENT / 100),
    );
    if (unexplainedMissingEtfs.length > absenceGuardCeiling) {
      throw new Error(
        `Official ${venue} ETF snapshot failed completeness guard: `
        + `${unexplainedMissingEtfs.length} of ${historicalActiveEtfs.length} active listings are absent`,
      );
    }
    const latestByListing = new Map<string, ResearchIdentityRecord>();
    for (const record of [...historical, ...records, ...statusRevisions]) {
      if (record.listing.venue === venue) latestByListing.set(record.listing.id, record);
    }
    const fundArtifact = venue === "TWSE" ? twseFunds : tpexFunds;
    for (const previous of latestByListing.values()) {
      if (
        previous.security.type !== "etf"
        || previous.listing.status !== "active"
        || currentEtfListingIds.has(previous.listing.id)
      ) continue;
      const priorAbsence = historicalAbsenceObservations
        .filter((record) => record.listing.id === previous.listing.id)
        .sort(recordOrder)
        .at(-1);
      const consecutiveAbsence = priorAbsence !== undefined
        && priorAbsence.provenance.retrievedAt > previous.provenance.retrievedAt
        && taiwanBusinessDate(priorAbsence.provenance.retrievedAt) < retrievalBusinessDate;
      const artifact = {
        ...fundArtifact.metadata,
        publisherDataset: venue === "TWSE" ? "opendata/t187ap47_L:absence" : "etfFilter:absence",
        accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" as const : "TPEX_WEB_JSON" as const,
      };
      if (consecutiveAbsence) {
        statusRevisions.push(appendOfficialListingStatusRevision(previous, {
          status: "inactive",
          effectiveDate: retrievalBusinessDate,
          retrievedAt,
          acquisitionRunId,
          artifact,
        }));
      } else {
        absenceObservations.push(appendOfficialListingAbsenceObservation(previous, {
          effectiveDate: retrievalBusinessDate,
          retrievedAt,
          acquisitionRunId,
          artifact: {
            ...artifact,
            publisherDataset: `${artifact.publisherDataset}-candidate`,
          },
        }));
      }
    }
  }
  await persistence.appendResearchIdentityRecords([...records, ...statusRevisions, ...absenceObservations]);
  return {
    acquisitionRunId,
    sourceCount: Object.keys(OFFICIAL_IDENTITY_SOURCES).length,
    recordCount: records.length + statusRevisions.length + absenceObservations.length,
    retrievedAt,
  };
}

export async function runOfficialPriceAcquisition(
  persistence: Persistence,
  options: AcquisitionOptions = {},
) {
  if (!researchAcquisitionEnabled()) throw new ResearchAcquisitionDisabledError();
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const acquisitionRunId = options.acquisitionRunId ?? `research-price-${retrievedAt}`;
  const [twsePrices, twseSuspensions, tpexPrices, tpexSuspensionsToday, tpexSuspensionsHistory] = await Promise.all([
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.twsePrices),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.twseSuspensions),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.tpexPrices),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.tpexSuspensionsHistory),
  ]);
  const twseRows = parseTwsePriceSnapshot(twsePrices.payload);
  const tpexRows = parseTpexPriceSnapshot(tpexPrices.payload);
  const twseSnapshotDate = officialSnapshotSessionDate("TWSE", twseRows);
  const tpexSnapshotDate = officialSnapshotSessionDate("TPEX", tpexRows);
  const expectedSessionDate = await expectedOfficialPriceSessionDate(persistence, retrievedAt);
  assertExpectedPriceSnapshotSession("TWSE", twseSnapshotDate, expectedSessionDate);
  assertExpectedPriceSnapshotSession("TPEX", tpexSnapshotDate, expectedSessionDate);
  const twseSuspended = parseTwseSuspensionSnapshot(twseSuspensions.payload, twseSnapshotDate);
  const tpexSuspensionHistoryRows = z.array(z.object({}).passthrough()).parse(tpexSuspensionsHistory.payload);
  const tpexSuspensionTodayRows = z.array(z.object({}).passthrough()).parse(tpexSuspensionsToday.payload);
  const alignedTpexSuspensionTodayRows = tpexSnapshotDate === taiwanBusinessDate(retrievedAt)
    ? tpexSuspensionTodayRows
    : [];
  const tpexSuspended = parseTpexSuspensionSnapshot([
    ...tpexSuspensionHistoryRows,
    ...alignedTpexSuspensionTodayRows,
  ], tpexSnapshotDate);
  const tpexSuspendedToday = parseTpexSuspensionSnapshot(
    alignedTpexSuspensionTodayRows,
    tpexSnapshotDate,
  );
  const [twseListings, tpexListings] = await Promise.all([
    persistence.listLatestResearchIdentityRecords({
      subject: { kind: "venue", venue: "TWSE" },
      effectiveAt: priceSessionEffectiveAt(twseSnapshotDate),
      knowledgeAt: retrievedAt,
    }),
    persistence.listLatestResearchIdentityRecords({
      subject: { kind: "venue", venue: "TPEX" },
      effectiveAt: priceSessionEffectiveAt(tpexSnapshotDate),
      knowledgeAt: retrievedAt,
    }),
  ]);
  const activeTwseListings = twseListings.filter((record) => record.listing.status === "active");
  const activeTpexListings = tpexListings.filter((record) => record.listing.status === "active");
  const twseByTicker = new Map(twseRows.map((row) => [row.ticker, row] as const));
  const tpexByTicker = new Map(tpexRows.map((row) => [row.ticker, row] as const));
  assertPriceSnapshotCompleteness(
    "TWSE",
    activeTwseListings,
    new Set([...twseByTicker.keys(), ...twseSuspended]),
  );
  assertPriceSnapshotCompleteness(
    "TPEX",
    activeTpexListings,
    new Set([...tpexByTicker.keys(), ...tpexSuspended]),
  );

  const records: ResearchPriceRecord[] = [];
  for (const listing of activeTwseListings) {
    const row = twseByTicker.get(listing.listing.ticker);
    const isSuspended = twseSuspended.has(listing.listing.ticker);
    const canonicalRow = isSuspended ? { state: "suspended" as const } : row;
    if (!canonicalRow) continue;
    const sessionDate = row?.sessionDate ?? twseSnapshotDate;
    records.push(canonicalizeOfficialPriceRow({
      listingId: listing.listing.id,
      ticker: listing.listing.ticker,
      venue: "TWSE",
      sessionDate,
      retrievedAt,
      acquisitionRunId,
      artifact: {
        contentHash: (isSuspended ? twseSuspensions : twsePrices).metadata.contentHash,
        sourceUrl: (isSuspended ? twseSuspensions : twsePrices).metadata.sourceUrl,
        publisherDataset: isSuspended ? "exchangeReport/TWTAWU" : "exchangeReport/STOCK_DAY_ALL",
        accessProvider: "TWSE_OPENAPI",
      },
      row: canonicalRow,
    }));
  }
  for (const listing of activeTpexListings) {
    const row = tpexByTicker.get(listing.listing.ticker);
    const isSuspended = tpexSuspended.has(listing.listing.ticker);
    const canonicalRow = isSuspended ? { state: "suspended" as const } : row;
    if (!canonicalRow) continue;
    const sessionDate = row?.sessionDate ?? tpexSnapshotDate;
    const suspensionArtifact = tpexSuspendedToday.has(listing.listing.ticker)
      ? tpexSuspensionsToday
      : tpexSuspensionsHistory;
    records.push(canonicalizeOfficialPriceRow({
      listingId: listing.listing.id,
      ticker: listing.listing.ticker,
      venue: "TPEX",
      sessionDate,
      retrievedAt,
      acquisitionRunId,
      artifact: {
        contentHash: (isSuspended ? suspensionArtifact : tpexPrices).metadata.contentHash,
        sourceUrl: (isSuspended ? suspensionArtifact : tpexPrices).metadata.sourceUrl,
        publisherDataset: isSuspended
          ? tpexSuspendedToday.has(listing.listing.ticker) ? "tpex_spendi_today" : "tpex_spendi_history"
          : "tpex_mainboard_daily_close_quotes",
        accessProvider: "TPEX_OPENAPI",
      },
      row: canonicalRow,
    }));
  }
  await persistence.appendResearchPriceRecords(records);
  return {
    acquisitionRunId,
    sourceCount: Object.keys(OFFICIAL_PRICE_SOURCES).length,
    recordCount: records.length,
    retrievedAt,
  };
}

export async function runOfficialMonthlyRevenueAcquisition(
  persistence: Persistence,
  options: AcquisitionOptions = {},
) {
  if (!researchAcquisitionEnabled()) {
    throw new ResearchAcquisitionDisabledError();
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const acquisitionRunId = options.acquisitionRunId ?? `monthly-revenue:${retrievedAt}`;
  const [twseRevenue, tpexRevenue, twseListings, tpexListings] = await Promise.all([
    fetchArtifact(fetchImpl, OFFICIAL_MONTHLY_REVENUE_SOURCES.twseMonthlyRevenue),
    fetchArtifact(fetchImpl, OFFICIAL_MONTHLY_REVENUE_SOURCES.tpexMonthlyRevenue),
    persistence.listLatestResearchIdentityRecords({
      subject: { kind: "venue", venue: "TWSE" },
      effectiveAt: retrievedAt,
      knowledgeAt: retrievedAt,
    }),
    persistence.listLatestResearchIdentityRecords({
      subject: { kind: "venue", venue: "TPEX" },
      effectiveAt: retrievedAt,
      knowledgeAt: retrievedAt,
    }),
  ]);
  const indexRevenueIdentities = (listings: ResearchIdentityRecord[]) => {
    const byTicker = new Map<string, RevenueIdentityLookup[]>();
    for (const record of listings) {
      const companyNames = [
        normalizedObservationValue(record, "legal_name", "issuer"),
        normalizedObservationValue(record, "display_name", "security"),
      ].filter((name): name is string => name !== undefined);
      const candidates = byTicker.get(record.listing.ticker) ?? [];
      candidates.push({
        listingId: record.listing.id,
        issuerId: record.issuer.id,
        listedAt: record.listing.listedAt,
        ...(record.listing.inactiveAt ? { inactiveAt: record.listing.inactiveAt } : {}),
        companyNames,
      });
      byTicker.set(record.listing.ticker, candidates);
    }
    return byTicker;
  };
  const twseIdentitiesByTicker = indexRevenueIdentities(twseListings);
  const tpexIdentitiesByTicker = indexRevenueIdentities(tpexListings);
  const twseRecords = parseOfficialMonthlyRevenueSnapshot(
    twseRevenue.payload,
    { ...twseRevenue.metadata, retrievedAt },
    "TWSE",
    twseIdentitiesByTicker,
  );
  const tpexRecords = parseOfficialMonthlyRevenueSnapshot(
    tpexRevenue.payload,
    { ...tpexRevenue.metadata, retrievedAt },
    "TPEX",
    tpexIdentitiesByTicker,
  );
  const [expectedStandardMonth, expectedInsuranceMonth] = await Promise.all([
    expectedMonthlyRevenueMonth(persistence, retrievedAt, 10),
    expectedMonthlyRevenueMonth(persistence, retrievedAt, 15),
  ]);
  const currentTwseRecords = assertMonthlyRevenueSnapshotCompleteness(
    "TWSE",
    twseListings,
    twseRecords,
    expectedStandardMonth,
    expectedInsuranceMonth,
  );
  const currentTpexRecords = assertMonthlyRevenueSnapshotCompleteness(
    "TPEX",
    tpexListings,
    tpexRecords,
    expectedStandardMonth,
    expectedInsuranceMonth,
  );
  const records: ResearchMonthlyRevenueRecord[] = [...currentTwseRecords, ...currentTpexRecords].map((record) => ({
    ...record,
    provenance: {
      ...record.provenance,
      acquisitionRunId,
    },
  }));
  await persistence.appendResearchMonthlyRevenueRecords(records);
  return {
    acquisitionRunId,
    sourceCount: Object.keys(OFFICIAL_MONTHLY_REVENUE_SOURCES).length,
    recordCount: records.length,
    retrievedAt,
    months: [...new Set(records.map((record) => record.revenueMonth))].sort(),
  };
}

export async function runOfficialFinancialStatementAcquisition(
  persistence: Persistence,
  options: FinancialStatementAcquisitionOptions = {},
) {
  if (!researchAcquisitionEnabled()) {
    throw new ResearchAcquisitionDisabledError();
  }
  const descriptors = options.descriptors ?? await options.resolveDescriptors?.() ?? [];
  if (descriptors.length === 0) {
    throw new Error("Official MOPS financial statement acquisition requires at least one descriptor");
  }
  const fetchImpl = options.fetchImpl ?? fetch;
  const retrievedAt = options.retrievedAt ?? new Date().toISOString();
  const acquisitionRunId = options.acquisitionRunId ?? `research-financial-statements-${retrievedAt}`;
  const records: ResearchFinancialStatementRecord[] = [];
  const failures: Array<{ listingId: string; sourceUrl: string; message: string; error: unknown }> = [];
  let nextDescriptorIndex = 0;
  const acquireNext = async (): Promise<void> => {
    while (nextDescriptorIndex < descriptors.length) {
      const descriptor = descriptors[nextDescriptorIndex++];
      if (!descriptor) return;
      try {
        const artifact = await fetchRawArtifact(fetchImpl, descriptor.sourceUrl);
        const parsed = parseMopsFinancialStatementArtifact(artifact.body, descriptor, {
          retrievedAt,
          acquisitionRunId,
          contentHash: artifact.metadata.contentHash,
        });
        if (parsed.facts.length === 0) {
          throw new Error(`Official MOPS financial statement artifact ${descriptor.sourceUrl} returned no statement facts`);
        }
        if (parsed.issues.missingStatementRoles.length > 0) {
          throw new Error(
            `Official MOPS financial statement artifact ${descriptor.sourceUrl} is missing required statement roles: ${parsed.issues.missingStatementRoles.join(",")}`,
          );
        }
        const record = await canonicalizeFinancialStatementArtifact(persistence, parsed);
        await persistence.appendResearchFinancialStatementRecords([record]);
        records.push(record);
      } catch (error) {
        failures.push({
          listingId: descriptor.listingId,
          sourceUrl: descriptor.sourceUrl,
          message: error instanceof Error ? error.message : String(error),
          error,
        });
      }
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(FINANCIAL_STATEMENT_ACQUISITION_CONCURRENCY, descriptors.length) },
    () => acquireNext(),
  ));
  if (records.length === 0) {
    throw failures[0]?.error ?? new Error("Official MOPS financial statement acquisition produced no records");
  }
  return {
    acquisitionRunId,
    sourceCount: descriptors.length,
    recordCount: records.length,
    failureCount: failures.length,
    failures: failures.map(({ listingId, sourceUrl, message }) => ({ listingId, sourceUrl, message })),
    retrievedAt,
  };
}
