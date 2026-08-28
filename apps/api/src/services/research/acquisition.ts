import { createHash } from "node:crypto";
import type { Persistence } from "../../persistence/types.js";
import {
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
  withListingPredecessor,
  type OfficialIdentityInput,
  type ResearchIdentityRecord,
} from "./identity.js";
import { researchAcquisitionEnabled } from "./rollout.js";
import {
  parseOfficialSecuritiesFirmDirectory,
  parseTwseCompanyIdentitySnapshot,
  parseTwseDelistingSnapshot,
  parseTwseEtnIdentitySnapshot,
  parseTwseEtnRetirementSnapshot,
  parseTwseFundIdentitySnapshot,
  taiwanBusinessDate,
} from "./providers/twseIdentity.js";
import {
  parseTpexCompanyIdentitySnapshot,
  parseTpexDelistingSnapshot,
  parseTpexEtnIdentitySnapshot,
  parseTpexEtnRetirementSnapshot,
  parseTpexFundIdentitySnapshot,
} from "./providers/tpexIdentity.js";

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

function recordOrder(left: ResearchIdentityRecord, right: ResearchIdentityRecord): number {
  const listedOrder = left.listing.listedAt.localeCompare(right.listing.listedAt);
  if (listedOrder !== 0) return listedOrder;
  const effectiveOrder = (left.observations[0]?.effectiveAt ?? "")
    .localeCompare(right.observations[0]?.effectiveAt ?? "");
  return effectiveOrder !== 0
    ? effectiveOrder
    : left.provenance.retrievedAt.localeCompare(right.provenance.retrievedAt);
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
  const canonicalRecords = inputs.map(canonicalizeOfficialIdentityRow);
  const historicalLatest = (await Promise.all((["TWSE", "TPEX"] as const).map((venue) =>
    persistence.listLatestResearchIdentityRecords({
      subject: { kind: "venue", venue },
      effectiveAt: retrievedAt,
      knowledgeAt: retrievedAt,
    })
  ))).flat();
  const records: ResearchIdentityRecord[] = [];
  for (const record of canonicalRecords) {
    const predecessor = [...historicalLatest, ...records]
      .filter((item) => item.security.id === record.security.id)
      .filter((item) => item.listing.id !== record.listing.id)
      .filter((item) => item.listing.listedAt < record.listing.listedAt)
      .sort(recordOrder)
      .at(-1);
    records.push(predecessor ? withListingPredecessor(record, predecessor.listing.id) : record);
  }
  const statusRevisions: ResearchIdentityRecord[] = [];
  for (const delisting of delistings) {
    const previous = [...historicalLatest, ...records, ...statusRevisions]
      .filter((item) => item.listing.venue === delisting.venue && item.listing.ticker === delisting.ticker)
      .filter((item) => !("securityType" in delisting) || item.security.type === delisting.securityType)
      .filter((item) => item.listing.listedAt <= delisting.inactiveAt)
      .sort(recordOrder)
      .at(-1);
    if (!previous || previous.listing.status === "inactive") continue;
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
      statusRevisions.push(appendOfficialListingStatusRevision(previous, {
        status: "inactive",
        effectiveDate: retrievalBusinessDate,
        retrievedAt,
        acquisitionRunId,
        artifact: {
          ...fundArtifact.metadata,
          publisherDataset: venue === "TWSE" ? "opendata/t187ap47_L:absence" : "etfFilter:absence",
          accessProvider: venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_WEB_JSON",
        },
      }));
    }
  }
  await persistence.appendResearchIdentityRecords([...records, ...statusRevisions]);
  return {
    acquisitionRunId,
    sourceCount: Object.keys(OFFICIAL_IDENTITY_SOURCES).length,
    recordCount: records.length + statusRevisions.length,
    retrievedAt,
  };
}
