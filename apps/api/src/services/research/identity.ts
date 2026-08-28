import { createHash } from "node:crypto";

export type ResearchListingVenue = "TWSE" | "TPEX";

export interface OfficialCompanyIdentityRow {
  kind: "company";
  ticker: string;
  legalName: string;
  displayName: string;
  unifiedBusinessNumber: string;
  industryCode: string;
  listedAt: string;
  parValue?: string;
  paidInCapital?: string;
  issuedShares?: string;
}

export interface OfficialFundIdentityRow {
  kind: "fund";
  ticker: string;
  legalName: string;
  displayName: string;
  unifiedBusinessNumber: string;
  fundType: string;
  listedAt: string;
  issuedUnits?: string;
}

export interface OfficialEtnIdentityRow {
  kind: "etn";
  ticker: string;
  legalName: string;
  displayName: string;
  issuerCode?: string;
  noteType: string;
  listedAt: string;
}

export interface OfficialUnknownIdentityRow {
  kind: "unknown";
  ticker: string;
  legalName: string;
  displayName: string;
  identityKey: string;
  declaredSecurityType: string;
  listedAt: string;
}

export interface OfficialIdentityInput {
  venue: ResearchListingVenue;
  snapshotDate: string;
  retrievedAt: string;
  acquisitionRunId?: string;
  predecessorListingId?: string;
  listingStatus?: "active" | "inactive";
  inactiveAt?: string;
  artifact: {
    contentHash: string;
    sourceUrl: string;
    publisherDataset?: string;
  };
  rawValues?: Partial<Record<string, string>>;
  row: OfficialCompanyIdentityRow | OfficialFundIdentityRow | OfficialEtnIdentityRow | OfficialUnknownIdentityRow;
}

export interface CanonicalIdentityObservation {
  id: string;
  kind: "source_fact";
  subject: { kind: "issuer" | "security" | "listing"; id: string };
  field: string;
  raw:
    | { state: "present"; label: string; value: string }
    | { state: "missing"; label: string; reason: "not_reported" };
  normalized:
    | { state: "present"; value: string }
    | { state: "missing"; reason: "not_reported" | "unparseable" };
  effectiveAt: string;
  publishedAt: { state: "missing"; reason: "unknown" };
  retrievedAt: string;
  processedAt: string;
  provenanceId: string;
  contractVersion: "research-observation/1.0.0";
  normalizationVersion: "identity-normalization/1.0.0";
}

export type ResearchIdentityRecord = ReturnType<typeof canonicalizeOfficialIdentityRow>;

export interface ResearchIdentityRecordQuery {
  subject:
    | { kind: "listing_id"; listingId: string }
    | { kind: "ticker_venue"; ticker: string; venue: ResearchListingVenue }
    | { kind: "security_id"; securityId: string };
  effectiveAt: string;
  knowledgeAt: string;
}

function opaqueId(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32);
  return `${prefix}_${digest}`;
}

function atStartOfDay(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function normalizedNumber(value: string): string {
  return value.replaceAll(",", "").trim();
}

function identityFacts(
  input: OfficialIdentityInput,
  issuerId: string,
  securityId: string,
  listingId: string,
): Array<{
  subject: { kind: "issuer" | "security" | "listing"; id: string };
  field: string;
  label: string;
  value?: string;
}> {
  const facts: Array<{
    subject: { kind: "issuer" | "security" | "listing"; id: string };
    field: string;
    label: string;
    value?: string;
  }> = [
    { subject: { kind: "issuer" as const, id: issuerId }, field: "legal_name", label: "legalName", value: input.row.legalName },
    { subject: { kind: input.row.kind === "etn" ? "security" as const : "issuer" as const, id: input.row.kind === "etn" ? securityId : issuerId }, field: "display_name", label: "displayName", value: input.row.displayName },
    { subject: { kind: "listing" as const, id: listingId }, field: "ticker", label: "ticker", value: input.row.ticker },
    { subject: { kind: "listing" as const, id: listingId }, field: "listing_venue", label: "listingVenue", value: input.venue },
    { subject: { kind: "listing" as const, id: listingId }, field: "listed_at", label: "listedAt", value: input.row.listedAt },
    { subject: { kind: "listing" as const, id: listingId }, field: "listing_status", label: "listingStatus", value: input.listingStatus ?? "active" },
  ];
  if (input.predecessorListingId) {
    facts.push({
      subject: { kind: "listing", id: listingId },
      field: "predecessor_listing_id",
      label: "predecessorListingId",
      value: input.predecessorListingId,
    });
  }
  if (input.row.kind === "company") {
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "unified_business_number", label: "unifiedBusinessNumber", value: input.row.unifiedBusinessNumber });
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "industry_code", label: "industryCode", value: input.row.industryCode });
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "par_value", label: "parValue", value: input.row.parValue ? normalizedNumber(input.row.parValue) : undefined });
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "paid_in_capital", label: "paidInCapital", value: input.row.paidInCapital ? normalizedNumber(input.row.paidInCapital) : undefined });
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "issued_shares", label: "issuedShares", value: input.row.issuedShares ? normalizedNumber(input.row.issuedShares) : undefined });
  } else if (input.row.kind === "fund") {
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "unified_business_number", label: "unifiedBusinessNumber", value: input.row.unifiedBusinessNumber });
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "fund_type", label: "fundType", value: input.row.fundType });
    facts.push({ subject: { kind: "issuer", id: issuerId }, field: "issued_units", label: "issuedUnits", value: input.row.issuedUnits ? normalizedNumber(input.row.issuedUnits) : undefined });
  } else if (input.row.kind === "etn") {
    if (input.row.issuerCode) {
      facts.push({ subject: { kind: "issuer", id: issuerId }, field: "issuer_code", label: "issuerCode", value: input.row.issuerCode });
    }
    facts.push({ subject: { kind: "security", id: securityId }, field: "note_type", label: "noteType", value: input.row.noteType });
  } else {
    facts.push({ subject: { kind: "security", id: securityId }, field: "declared_security_type", label: "declaredSecurityType", value: input.row.declaredSecurityType });
  }
  return facts;
}

export function canonicalizeOfficialIdentityRow(input: OfficialIdentityInput) {
  const issuerId = input.row.kind === "etn"
    ? opaqueId(
      "iss",
      input.venue,
      input.row.issuerCode ? "issuer_code" : "issuer_legal_name",
      input.row.issuerCode ?? input.row.legalName,
    )
    : input.row.kind === "unknown"
      ? opaqueId("iss", input.venue, "official_identity_key", input.row.identityKey)
      : opaqueId("iss", "business_number", input.row.unifiedBusinessNumber);
  const securityType = input.row.kind === "fund"
    ? "etf" as const
    : input.row.kind === "etn"
      ? "etn" as const
      : input.row.kind === "unknown" ? "unknown" as const : "common_equity" as const;
  const securityId = input.row.kind === "etn"
    ? opaqueId("sec", issuerId, securityType, input.venue, input.row.ticker, input.row.listedAt)
    : opaqueId("sec", issuerId, securityType);
  const listingId = opaqueId("lst", securityId, input.venue, input.row.listedAt);
  const provenanceId = opaqueId("prv", input.venue, input.artifact.contentHash, input.retrievedAt);
  const effectiveAt = atStartOfDay(input.snapshotDate);
  const processedAt = input.retrievedAt;
  const listingStatus: "active" | "inactive" = input.listingStatus ?? "active";
  const facts = identityFacts(input, issuerId, securityId, listingId);
  const observations: CanonicalIdentityObservation[] = facts.map((fact) => ({
    id: opaqueId("obs", provenanceId, fact.subject.id, fact.field, fact.value ?? "missing"),
    kind: "source_fact",
    subject: fact.subject,
    field: fact.field,
    raw: input.rawValues?.[fact.field] !== undefined || fact.value !== undefined
      ? {
          state: "present",
          label: fact.label,
          value: input.rawValues?.[fact.field] ?? fact.value!,
        }
      : { state: "missing", label: fact.label, reason: "not_reported" },
    normalized: fact.value !== undefined
      ? { state: "present", value: fact.value }
      : {
          state: "missing",
          reason: input.rawValues?.[fact.field] !== undefined ? "unparseable" : "not_reported",
        },
    effectiveAt,
    publishedAt: { state: "missing", reason: "unknown" },
    retrievedAt: input.retrievedAt,
    processedAt,
    provenanceId,
    contractVersion: "research-observation/1.0.0",
    normalizationVersion: "identity-normalization/1.0.0",
  }));

  return {
    issuer: {
      id: issuerId,
      classification: input.row.kind === "fund"
        ? "investment_fund" as const
        : input.row.kind === "etn"
          ? "financial_institution" as const
          : input.row.kind === "unknown" ? "unknown" as const : "operating_company" as const,
    },
    security: {
      id: securityId,
      issuerId,
      type: securityType,
      rights: input.row.kind === "fund"
        ? "fund_units" as const
        : input.row.kind === "etn"
          ? "senior_unsecured_note" as const
          : input.row.kind === "unknown" ? "unknown" as const : "common_shares" as const,
    },
    listing: {
      id: listingId,
      securityId,
      venue: input.venue,
      ticker: input.row.ticker,
      listedAt: input.row.listedAt,
      status: listingStatus,
      ...(input.predecessorListingId ? { predecessorListingId: input.predecessorListingId } : {}),
      ...(input.inactiveAt ? { inactiveAt: input.inactiveAt } : {}),
    },
    eligibility: listingStatus === "inactive"
      ? {
          profile: input.row.kind === "fund"
            ? "etf_limited" as const
            : input.row.kind === "etn"
              ? "identity_only" as const
              : input.row.kind === "unknown" ? "unknown" as const : "operating_company" as const,
          state: "ineligible" as const,
          reasonCode: "inactive_listing" as const,
        }
      : input.row.kind === "fund"
        ? { profile: "etf_limited" as const, state: "eligible" as const, reasonCode: "supported_etf" as const }
        : input.row.kind === "etn"
          ? { profile: "identity_only" as const, state: "eligible" as const, reasonCode: "supported_etn_identity_only" as const }
          : input.row.kind === "unknown"
            ? { profile: "unknown" as const, state: "indeterminate" as const, reasonCode: "unsupported_security_type" as const }
            : { profile: "operating_company" as const, state: "eligible" as const, reasonCode: "supported_common_equity" as const },
    observations,
    provenance: {
      id: provenanceId,
      publisher: input.venue,
      accessProvider: input.row.kind === "etn"
        ? "TWSE_WEB_JSON" as const
        : `${input.venue}_OPENAPI` as const,
      authorityRole: "authoritative" as const,
      canonicalDatasetId: "research_identity" as const,
      publisherDataset: input.artifact.publisherDataset ?? (input.row.kind === "fund"
        ? "t187ap47_L"
        : input.row.kind === "etn"
          ? "twse_etn"
          : input.venue === "TWSE" ? "t187ap03_L" : "mopsfin_t187ap03_O"),
      sourceUrl: input.artifact.sourceUrl,
      contentHash: input.artifact.contentHash,
      acquisitionPath: "scheduled_official_snapshot" as const,
      acquisitionRunId: input.acquisitionRunId ?? "manual-canonicalization",
      retrievedAt: input.retrievedAt,
      parserVersion: "research-identity-parser/1.0.0" as const,
      usagePolicyVersion: "taiwan-open-data/1.0.0" as const,
      retentionStatus: "retained" as const,
      contentExposure: "allowed" as const,
    },
  };
}

interface OfficialListingStatusRevisionInput {
  status: "inactive";
  effectiveDate: string;
  retrievedAt: string;
  acquisitionRunId?: string;
  artifact: {
    contentHash: string;
    sourceUrl: string;
    publisherDataset: string;
  };
}

export function appendOfficialListingStatusRevision(
  previous: ResearchIdentityRecord,
  input: OfficialListingStatusRevisionInput,
): ResearchIdentityRecord {
  const provenanceId = opaqueId(
    "prv",
    previous.listing.venue,
    input.artifact.contentHash,
    input.retrievedAt,
  );
  const effectiveAt = atStartOfDay(input.effectiveDate);
  const observation: CanonicalIdentityObservation = {
    id: opaqueId("obs", provenanceId, previous.listing.id, "listing_status", input.status),
    kind: "source_fact",
    subject: { kind: "listing", id: previous.listing.id },
    field: "listing_status",
    raw: { state: "present", label: "listingStatus", value: input.status },
    normalized: { state: "present", value: input.status },
    effectiveAt,
    publishedAt: { state: "missing", reason: "unknown" },
    retrievedAt: input.retrievedAt,
    processedAt: input.retrievedAt,
    provenanceId,
    contractVersion: "research-observation/1.0.0",
    normalizationVersion: "identity-normalization/1.0.0",
  };
  return {
    issuer: previous.issuer,
    security: previous.security,
    listing: {
      ...previous.listing,
      status: "inactive",
      inactiveAt: input.effectiveDate,
    },
    eligibility: {
      profile: previous.eligibility.profile,
      state: "ineligible",
      reasonCode: "inactive_listing",
    },
    observations: [observation],
    provenance: {
      id: provenanceId,
      publisher: previous.listing.venue,
      accessProvider: previous.listing.venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI",
      authorityRole: "authoritative",
      canonicalDatasetId: "research_identity",
      publisherDataset: input.artifact.publisherDataset,
      sourceUrl: input.artifact.sourceUrl,
      contentHash: input.artifact.contentHash,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: input.acquisitionRunId ?? "manual-status-revision",
      retrievedAt: input.retrievedAt,
      parserVersion: "research-identity-parser/1.0.0",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  };
}

export function withListingPredecessor(
  record: ResearchIdentityRecord,
  predecessorListingId: string,
): ResearchIdentityRecord {
  if (record.listing.id === predecessorListingId) return record;
  const effectiveAt = record.observations[0]?.effectiveAt ?? record.provenance.retrievedAt;
  const observation: CanonicalIdentityObservation = {
    id: opaqueId("obs", record.provenance.id, record.listing.id, "predecessor_listing_id", predecessorListingId),
    kind: "source_fact",
    subject: { kind: "listing", id: record.listing.id },
    field: "predecessor_listing_id",
    raw: { state: "present", label: "predecessorListingId", value: predecessorListingId },
    normalized: { state: "present", value: predecessorListingId },
    effectiveAt,
    publishedAt: { state: "missing", reason: "unknown" },
    retrievedAt: record.provenance.retrievedAt,
    processedAt: record.provenance.retrievedAt,
    provenanceId: record.provenance.id,
    contractVersion: "research-observation/1.0.0",
    normalizationVersion: "identity-normalization/1.0.0",
  };
  return {
    ...record,
    listing: { ...record.listing, predecessorListingId },
    observations: [...record.observations, observation],
  };
}
