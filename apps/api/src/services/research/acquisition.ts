import { createHash } from "node:crypto";
import { z } from "zod";
import type { Persistence } from "../../persistence/types.js";
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

export const OFFICIAL_PRICE_SOURCES = {
  twsePrices: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
  twseSuspensions: "https://openapi.twse.com.tw/v1/exchangeReport/TWTAWU",
  tpexPrices: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
  tpexSuspensionsToday: "https://www.tpex.org.tw/openapi/v1/tpex_spendi_today",
  tpexSuspensionsHistory: "https://www.tpex.org.tw/openapi/v1/tpex_spendi_history",
} as const;

const TPEX_DELISTING_FIRST_YEAR = 2021;
const ETF_ABSENCE_COMPLETENESS_GUARD_PERCENT = 1;

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

function officialSnapshotSessionDate(rows: Array<{ sessionDate: string }>): string | null {
  const uniqueDates = [...new Set(rows.map((row) => row.sessionDate))];
  if (uniqueDates.length === 0) return null;
  if (uniqueDates.length > 1) {
    throw new Error(`Official price snapshot returned multiple session dates: ${uniqueDates.join(",")}`);
  }
  return uniqueDates[0]!;
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
  options: AcquisitionOptions = {},
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
  const [twsePrices, twseSuspensions, tpexPrices, tpexSuspensionsToday, tpexSuspensionsHistory, twseListings, tpexListings] = await Promise.all([
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.twsePrices),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.twseSuspensions),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.tpexPrices),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday),
    fetchArtifact(fetchImpl, OFFICIAL_PRICE_SOURCES.tpexSuspensionsHistory),
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
  const activeTwseListings = twseListings.filter((record) => record.listing.status === "active");
  const activeTpexListings = tpexListings.filter((record) => record.listing.status === "active");
  const twseRows = parseTwsePriceSnapshot(twsePrices.payload);
  const tpexRows = parseTpexPriceSnapshot(tpexPrices.payload);
  const twseSnapshotDate = officialSnapshotSessionDate(twseRows);
  const tpexSnapshotDate = officialSnapshotSessionDate(tpexRows);
  const twseSuspended = twseSnapshotDate ? parseTwseSuspensionSnapshot(twseSuspensions.payload, twseSnapshotDate) : new Set<string>();
  const tpexSuspensionHistoryRows = z.array(z.object({}).passthrough()).parse(tpexSuspensionsHistory.payload);
  const tpexSuspensionTodayRows = z.array(z.object({}).passthrough()).parse(tpexSuspensionsToday.payload);
  const alignedTpexSuspensionTodayRows = tpexSnapshotDate === taiwanBusinessDate(retrievedAt)
    ? tpexSuspensionTodayRows
    : [];
  const tpexSuspended = tpexSnapshotDate
    ? parseTpexSuspensionSnapshot([
        ...tpexSuspensionHistoryRows,
        ...alignedTpexSuspensionTodayRows,
      ], tpexSnapshotDate)
    : new Set<string>();
  const tpexSuspendedToday = tpexSnapshotDate
    ? parseTpexSuspensionSnapshot(alignedTpexSuspensionTodayRows, tpexSnapshotDate)
    : new Set<string>();
  const twseByTicker = new Map(twseRows.map((row) => [row.ticker, row] as const));
  const tpexByTicker = new Map(tpexRows.map((row) => [row.ticker, row] as const));

  const records: ResearchPriceRecord[] = [];
  for (const listing of activeTwseListings) {
    const row = twseByTicker.get(listing.listing.ticker);
    const isSuspended = twseSuspended.has(listing.listing.ticker);
    const canonicalRow = isSuspended ? { state: "suspended" as const } : row;
    if (!canonicalRow) continue;
    const sessionDate = row?.sessionDate ?? twseSnapshotDate;
    if (!sessionDate) continue;
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
    if (!sessionDate) continue;
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
