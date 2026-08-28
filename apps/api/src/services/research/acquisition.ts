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
  parseTwseCompanyIdentitySnapshot,
  parseTwseDelistingSnapshot,
  parseTwseEtnIdentitySnapshot,
  parseTwseFundIdentitySnapshot,
} from "./providers/twseIdentity.js";
import { parseTpexCompanyIdentitySnapshot } from "./providers/tpexIdentity.js";

export const OFFICIAL_IDENTITY_SOURCES = {
  twseCompanies: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
  tpexCompanies: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
  twseFunds: "https://openapi.twse.com.tw/v1/opendata/t187ap47_L",
  twseEtns: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json",
  twseDelistings: "https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml",
} as const;

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

async function fetchArtifact(fetchImpl: typeof fetch, sourceUrl: string) {
  const response = await fetchImpl(sourceUrl, {
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
  const [twseCompanies, tpexCompanies, twseFunds, twseEtns, twseDelistings] = await Promise.all([
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseCompanies),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.tpexCompanies),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseFunds),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseEtns),
    fetchArtifact(fetchImpl, OFFICIAL_IDENTITY_SOURCES.twseDelistings),
  ]);
  const parseMetadata = (artifact: { metadata: { sourceUrl: string; contentHash: string } }) => ({
    ...artifact.metadata,
    retrievedAt,
  });
  const inputs: OfficialIdentityInput[] = [
    ...parseTwseCompanyIdentitySnapshot(twseCompanies.payload, parseMetadata(twseCompanies)),
    ...parseTpexCompanyIdentitySnapshot(tpexCompanies.payload, parseMetadata(tpexCompanies)),
    ...parseTwseFundIdentitySnapshot(twseFunds.payload, parseMetadata(twseFunds)),
    ...parseTwseEtnIdentitySnapshot(twseEtns.payload, parseMetadata(twseEtns)),
  ].map((input) => ({ ...input, acquisitionRunId }));
  const delistings = parseTwseDelistingSnapshot(twseDelistings.payload);
  const canonicalRecords = inputs.map(canonicalizeOfficialIdentityRow);
  const records: ResearchIdentityRecord[] = [];
  for (const record of canonicalRecords) {
    const history = await persistence.listResearchIdentityRecords({
      subject: { kind: "security_id", securityId: record.security.id },
      effectiveAt: retrievedAt,
      knowledgeAt: retrievedAt,
    });
    const predecessor = [...history, ...records]
      .filter((item) => item.listing.id !== record.listing.id)
      .filter((item) => item.listing.listedAt < record.listing.listedAt)
      .sort(recordOrder)
      .at(-1);
    records.push(predecessor ? withListingPredecessor(record, predecessor.listing.id) : record);
  }
  const statusRevisions: ResearchIdentityRecord[] = [];
  for (const delisting of delistings) {
    const history = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: delisting.ticker, venue: "TWSE" },
      effectiveAt: retrievedAt,
      knowledgeAt: retrievedAt,
    });
    const previous = [...history, ...records, ...statusRevisions]
      .filter((item) => item.listing.venue === "TWSE" && item.listing.ticker === delisting.ticker)
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
        ...twseDelistings.metadata,
        publisherDataset: "company/suspendListingCsvAndHtml",
      },
    }));
  }
  await persistence.appendResearchIdentityRecords([...records, ...statusRevisions]);
  return {
    acquisitionRunId,
    sourceCount: Object.keys(OFFICIAL_IDENTITY_SOURCES).length,
    recordCount: records.length + statusRevisions.length,
    retrievedAt,
  };
}
