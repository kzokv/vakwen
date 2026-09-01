import { createHash } from "node:crypto";
import type { MopsFinancialStatementArtifact, MopsFactRecord, MopsStatementRole } from "./providers/mopsXbrl.js";
import type { ResearchListingVenue } from "./identity.js";

export type ResearchFinancialStatementPeriodicity = "annual" | "quarterly";
export type ResearchFinancialStatementFilingBasis = "consolidated" | "individual" | "unknown";
export type ResearchFinancialStatementKind =
  | "income"
  | "balance_sheet"
  | "cash_flow"
  | "equity"
  | "sector_extension";
export type ResearchFinancialStatementValueKind = "cumulative" | "discrete" | "instant";
export type ResearchFinancialStatementRelationKind =
  | "supersedes"
  | "equivalent_to"
  | "retracts"
  | "derived_from";
export type ResearchFinancialStatementAmbiguityFlag =
  | "duplicate_context"
  | "unmapped_concept"
  | "unknown_unit"
  | "filing_basis_ambiguous"
  | "taxonomy_change";
export type ResearchFinancialStatementMetricId =
  | "revenue"
  | "gross_profit"
  | "operating_income"
  | "net_income"
  | "assets"
  | "liabilities"
  | "equity"
  | "current_assets"
  | "current_liabilities"
  | "cash_and_cash_equivalents"
  | "interest_bearing_debt"
  | "operating_cash_flow"
  | "investing_cash_flow"
  | "capital_expenditure";

export interface ResearchFinancialStatementConceptRef {
  qname: string;
  label: string;
}

export type ResearchFinancialStatementMetricRef =
  | { state: "mapped"; metricId: ResearchFinancialStatementMetricId }
  | { state: "unmapped"; reason: "no_core_metric_mapping" };

export type ResearchFinancialStatementUnitRef =
  | { state: "known"; unitId: string }
  | { state: "unknown"; rawUnitId: string | null };

export type ResearchFinancialStatementPeriodRef =
  | { kind: "instant"; instantAt: string }
  | { kind: "duration"; startAt: string; endAt: string };

export type ResearchFinancialStatementNormalizedValue =
  | { state: "present"; value: string }
  | { state: "missing"; reason: "not_reported" | "unparseable" };

export interface ResearchFinancialStatementFact {
  id: string;
  kind: "source_fact";
  listingId: string;
  issuerId: string;
  filingId: string;
  revisionId: string;
  statementKind: ResearchFinancialStatementKind;
  concept: ResearchFinancialStatementConceptRef;
  metric: ResearchFinancialStatementMetricRef;
  context: {
    contextId: string;
    dimensions: Record<string, string>;
    period: ResearchFinancialStatementPeriodRef;
    valueKind: ResearchFinancialStatementValueKind;
  };
  raw: {
    state: "present";
    value: string;
  };
  normalized: ResearchFinancialStatementNormalizedValue;
  unit: ResearchFinancialStatementUnitRef;
  declaredScale: string | null;
  declaredPrecision: string | null;
  ambiguityFlags: ResearchFinancialStatementAmbiguityFlag[];
}

export interface ResearchFinancialStatementSection {
  kind: ResearchFinancialStatementKind;
  facts: ResearchFinancialStatementFact[];
  metadata?: Record<string, string>;
}

export interface ResearchFinancialStatementRelation {
  kind: ResearchFinancialStatementRelationKind;
  targetRecordKey: string;
  explanation?: string;
}

export interface ResearchFinancialStatementRecord {
  listingId: string;
  issuerId: string;
  ticker: string;
  venue: ResearchListingVenue;
  periodicity: ResearchFinancialStatementPeriodicity;
  fiscalPeriod: {
    fiscalYear: number;
    fiscalQuarter: 1 | 2 | 3 | 4 | null;
    periodStart: string;
    periodEnd: string;
  };
  filingBasis: ResearchFinancialStatementFilingBasis;
  publicationContext: {
    filingId: string;
    revisionId: string;
    publishedAt: string;
    revisionPublishedAt: string | null;
    filingSequence: number;
    revisionSequence: number;
    processingId: string;
    processingSequence: number;
    restatement: boolean;
    amendment: boolean;
  };
  statements: ResearchFinancialStatementSection[];
  relations: ResearchFinancialStatementRelation[];
  ambiguityFlags: ResearchFinancialStatementAmbiguityFlag[];
  provenance: {
    id: string;
    publisher: "MOPS";
    accessProvider: "MOPS_XBRL";
    authorityRole: "authoritative";
    canonicalDatasetId: "financial_statements";
    publisherDataset: string;
    sourceUrl: string;
    contentHash: string;
    acquisitionPath: "scheduled_official_snapshot";
    acquisitionRunId: string;
    retrievedAt: string;
    processedAt: string;
    parserVersion: "research-financial-statements-parser/1.0.0";
    taxonomyVersion: string;
    usagePolicyVersion: "taiwan-open-data/1.0.0";
    retentionStatus: "retained";
    contentExposure: "allowed";
  };
}

export interface ResearchFinancialStatementRecordQuery {
  subject:
    | { kind: "listing_id"; listingId: string }
    | { kind: "issuer_id"; issuerId: string };
  effectiveAt: string;
  knowledgeAt: string;
  periodicity: ResearchFinancialStatementPeriodicity;
  startPeriod?: string;
  endPeriod?: string;
  filingBasis?: ResearchFinancialStatementFilingBasis;
}

export type ResearchFinancialStatementAppendInput =
  | ResearchFinancialStatementRecord
  | MopsFinancialStatementArtifact;

function invalidResearchFinancialStatementRecord(message: string): Error {
  return new Error(`research_financial_statement_record_invalid: ${message}`);
}

function opaqueId(prefix: string, ...parts: string[]): string {
  return `${prefix}_${createHash("sha256").update(parts.join("\u001f")).digest("hex").slice(0, 32)}`;
}

function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isTimestamp(value: string): boolean {
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && value.includes("T");
}

function isNormalizedDecimal(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}

function normalizeRawNumber(value: string): ResearchFinancialStatementNormalizedValue {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "-" || trimmed === "--" || /^n\/?a$/i.test(trimmed)) {
    return { state: "missing", reason: "not_reported" };
  }
  const normalized = trimmed.replaceAll(",", "");
  if (!isNormalizedDecimal(normalized)) {
    return { state: "missing", reason: "unparseable" };
  }
  return { state: "present", value: /^-?0(?:\.0+)?$/.test(normalized) ? "0" : normalized };
}

function taiwanPublishedAtTimestamp(date: string): string {
  if (!isIsoDate(date)) {
    throw invalidResearchFinancialStatementRecord(`invalid published date ${date}`);
  }
  return new Date(`${date}T00:00:00+08:00`).toISOString();
}

function quarterForFilingPeriod(period: "annual" | "q1" | "q2" | "q3" | "q4"): 1 | 2 | 3 | 4 | null {
  switch (period) {
    case "annual":
      return null;
    case "q1":
      return 1;
    case "q2":
      return 2;
    case "q3":
      return 3;
    case "q4":
      return 4;
  }
}

function statementKindForRole(role: MopsStatementRole): ResearchFinancialStatementKind | null {
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

function metricForConcept(localName: string): ResearchFinancialStatementMetricRef {
  switch (localName) {
    case "RevenueFromContractsWithCustomers":
    case "Revenue":
      return { state: "mapped", metricId: "revenue" };
    case "GrossProfit":
      return { state: "mapped", metricId: "gross_profit" };
    case "OperatingIncomeLoss":
      return { state: "mapped", metricId: "operating_income" };
    case "ProfitLoss":
      return { state: "mapped", metricId: "net_income" };
    case "Assets":
      return { state: "mapped", metricId: "assets" };
    case "Liabilities":
      return { state: "mapped", metricId: "liabilities" };
    case "EquityAttributableToOwnersOfParent":
    case "Equity":
      return { state: "mapped", metricId: "equity" };
    case "CurrentAssets":
      return { state: "mapped", metricId: "current_assets" };
    case "CurrentLiabilities":
      return { state: "mapped", metricId: "current_liabilities" };
    case "CashAndCashEquivalents":
      return { state: "mapped", metricId: "cash_and_cash_equivalents" };
    case "InterestBearingBorrowings":
      return { state: "mapped", metricId: "interest_bearing_debt" };
    case "CashFlowsFromUsedInOperatingActivities":
    case "NetCashFlowsFromUsedInOperatingActivities":
      return { state: "mapped", metricId: "operating_cash_flow" };
    case "CashFlowsFromUsedInInvestingActivities":
    case "NetCashFlowsFromUsedInInvestingActivities":
      return { state: "mapped", metricId: "investing_cash_flow" };
    case "PurchaseOfPropertyPlantAndEquipment":
    case "AcquisitionOfPropertyPlantAndEquipment":
      return { state: "mapped", metricId: "capital_expenditure" };
    default:
      return { state: "unmapped", reason: "no_core_metric_mapping" };
  }
}

function durationPeriodForFact(fact: MopsFactRecord, periodEndFallback: string): ResearchFinancialStatementPeriodRef {
  if (fact.periodStart && fact.periodEnd) {
    return {
      kind: "duration",
      startAt: `${fact.periodStart}T00:00:00.000Z`,
      endAt: `${fact.periodEnd}T23:59:59.999Z`,
    };
  }
  return {
    kind: "instant",
    instantAt: `${(fact.periodEnd ?? periodEndFallback)}T23:59:59.999Z`,
  };
}

function valueKindForFact(fact: MopsFactRecord): ResearchFinancialStatementValueKind {
  return fact.periodStart ? "cumulative" : "instant";
}

function resolveArtifactFilingBasis(artifact: MopsFinancialStatementArtifact): ResearchFinancialStatementFilingBasis {
  if (artifact.issues.basisAmbiguity) return "unknown";
  const members = new Set(
    artifact.contexts.flatMap((context) => context.dimensions.map((dimension) => dimension.member.toLowerCase())),
  );
  const individual = [...members].some((member) => /separate|individual|個別|個體/.test(member));
  const consolidated = [...members].some((member) => /consolidated|合併/.test(member));
  if (individual && consolidated) return "unknown";
  if (individual) return "individual";
  return consolidated ? "consolidated" : "unknown";
}

export function materializeResearchFinancialStatementRecord(
  input: ResearchFinancialStatementAppendInput,
): ResearchFinancialStatementRecord {
  if ("publicationContext" in input) {
    validateResearchFinancialStatementRecord(input);
    return input;
  }
  const periodicity = input.filing.fiscalPeriod === "annual" ? "annual" : "quarterly";
  const fiscalQuarter = quarterForFilingPeriod(input.filing.fiscalPeriod);
  const periodEnd = input.facts.map((fact) => fact.periodEnd).find((value): value is string => value !== null)
    ?? `${input.filing.fiscalYear}-12-31`;
  const periodStart = input.facts.map((fact) => fact.periodStart).find((value): value is string => value !== null)
    ?? (periodicity === "annual"
      ? `${input.filing.fiscalYear}-01-01`
      : fiscalQuarter === 1
        ? `${input.filing.fiscalYear}-01-01`
        : fiscalQuarter === 2
          ? `${input.filing.fiscalYear}-04-01`
          : fiscalQuarter === 3
            ? `${input.filing.fiscalYear}-07-01`
            : `${input.filing.fiscalYear}-10-01`);
  const filingBasis = resolveArtifactFilingBasis(input);
  const publishedAt = taiwanPublishedAtTimestamp(input.filing.publishedAt);
  const issuesByContextSignature = new Set(
    input.issues.duplicateContextGroups.flatMap((group) => group.contextIds),
  );
  const unitsById = new Map(input.units.map((unit) => [unit.id, unit] as const));
  const sections = new Map<ResearchFinancialStatementKind, ResearchFinancialStatementFact[]>();
  const pushFact = (kind: ResearchFinancialStatementKind, fact: ResearchFinancialStatementFact) => {
    const current = sections.get(kind) ?? [];
    current.push(fact);
    sections.set(kind, current);
  };
  for (const fact of input.facts) {
    const statementKind = statementKindForRole(fact.statementRole);
    if (!statementKind) continue;
    const unitRecord = fact.unitRef ? unitsById.get(fact.unitRef) : undefined;
    pushFact(statementKind, normalizeResearchFinancialStatementFact({
      listingId: input.listingId,
      issuerId: input.contexts[0]?.entityIdentifiers[0] ?? input.listingId,
      filingId: input.filing.filingId,
      revisionId: `${input.filing.filingId}:r${input.filing.revision}`,
      statementKind,
      concept: {
        qname: fact.concept.qname,
        label: fact.concept.localName,
      },
      metric: metricForConcept(fact.concept.localName),
      contextId: fact.contextRef,
      dimensions: Object.fromEntries(fact.contextDimensions.map((dimension) => [dimension.dimension, dimension.member] as const)),
      period: durationPeriodForFact(fact, periodEnd),
      valueKind: valueKindForFact(fact),
      rawValue: fact.rawValue,
      unit: unitRecord
        ? { state: "known", unitId: unitRecord.measures[0] ?? fact.unitRef ?? "unknown" }
        : { state: "unknown", rawUnitId: fact.unitRef },
      declaredScale: fact.scale,
      declaredPrecision: fact.decimals,
      ambiguityFlags: [
        ...(issuesByContextSignature.has(fact.contextRef) ? ["duplicate_context" as const] : []),
        ...(input.issues.basisAmbiguity ? ["filing_basis_ambiguous" as const] : []),
        ...(input.issues.taxonomyAmbiguity ? ["taxonomy_change" as const] : []),
      ],
    }));
  }
  const record: ResearchFinancialStatementRecord = {
    listingId: input.listingId,
    issuerId: input.contexts[0]?.entityIdentifiers[0] ?? input.listingId,
    ticker: input.ticker,
    venue: input.venue,
    periodicity,
    fiscalPeriod: {
      fiscalYear: input.filing.fiscalYear,
      fiscalQuarter,
      periodStart,
      periodEnd,
    },
    filingBasis,
    publicationContext: {
      filingId: input.filing.filingId,
      revisionId: `${input.filing.filingId}:r${input.filing.revision}`,
      publishedAt,
      revisionPublishedAt: input.filing.revision > 0 ? publishedAt : null,
      filingSequence: 0,
      revisionSequence: input.filing.revision,
      processingId: input.artifact.contentHash,
      processingSequence: 0,
      restatement: input.filing.amendmentType === "restatement",
      amendment: input.filing.amendmentType === "amendment",
    },
    statements: [
      { kind: "income", facts: sections.get("income") ?? [] },
      { kind: "balance_sheet", facts: sections.get("balance_sheet") ?? [] },
      { kind: "cash_flow", facts: sections.get("cash_flow") ?? [] },
      ...(sections.has("equity") ? [{ kind: "equity" as const, facts: sections.get("equity") ?? [] }] : []),
      ...(sections.has("sector_extension") ? [{ kind: "sector_extension" as const, facts: sections.get("sector_extension") ?? [], metadata: { sector: input.sector } }] : []),
    ],
    relations: [],
    ambiguityFlags: [
      ...(input.issues.basisAmbiguity ? ["filing_basis_ambiguous" as const] : []),
      ...(input.issues.taxonomyAmbiguity ? ["taxonomy_change" as const] : []),
      ...(input.issues.contextAmbiguity ? ["duplicate_context" as const] : []),
    ],
    provenance: {
      id: opaqueId("fin_stmt_prov", input.listingId, input.filing.filingId, input.artifact.contentHash),
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      authorityRole: "authoritative",
      canonicalDatasetId: "financial_statements",
      publisherDataset: input.artifact.artifactKind === "ixbrl" ? "mops_ixbrl" : "mops_xbrl",
      sourceUrl: input.artifact.sourceUrl,
      contentHash: input.artifact.contentHash,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: input.artifact.acquisitionRunId,
      retrievedAt: input.artifact.retrievedAt,
      processedAt: input.artifact.retrievedAt,
      parserVersion: "research-financial-statements-parser/1.0.0",
      taxonomyVersion: input.artifact.taxonomyVersions[0] ?? input.artifact.primaryNamespace ?? "unknown",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  };
  validateResearchFinancialStatementRecord(record);
  return record;
}

function validatePeriodicity(queryOrRecord: {
  periodicity: ResearchFinancialStatementPeriodicity;
  fiscalPeriod?: { fiscalQuarter: 1 | 2 | 3 | 4 | null };
}): void {
  if (queryOrRecord.periodicity === "annual" && queryOrRecord.fiscalPeriod?.fiscalQuarter !== null) {
    throw invalidResearchFinancialStatementRecord("annual records cannot declare a fiscal quarter");
  }
  if (queryOrRecord.periodicity === "quarterly" && queryOrRecord.fiscalPeriod?.fiscalQuarter === null) {
    throw invalidResearchFinancialStatementRecord("quarterly records require a fiscal quarter");
  }
}

function assertPeriodToken(
  periodicity: ResearchFinancialStatementPeriodicity,
  value: string | undefined,
  field: string,
): void {
  if (value === undefined) return;
  const valid = periodicity === "annual"
    ? /^\d{4}$/.test(value)
    : /^\d{4}-Q[1-4]$/.test(value);
  if (!valid) {
    throw invalidResearchFinancialStatementRecord(`invalid ${field} ${value} for ${periodicity}`);
  }
}

export function researchFinancialStatementPeriodKey(record: ResearchFinancialStatementRecord): string {
  return record.periodicity === "annual"
    ? String(record.fiscalPeriod.fiscalYear).padStart(4, "0")
    : `${String(record.fiscalPeriod.fiscalYear).padStart(4, "0")}-Q${record.fiscalPeriod.fiscalQuarter}`;
}

export function researchFinancialStatementRecordKey(
  record: ResearchFinancialStatementRecord,
): string {
  return [
    record.issuerId,
    record.listingId,
    researchFinancialStatementPeriodKey(record),
    record.filingBasis,
    record.publicationContext.filingId,
    record.publicationContext.revisionId,
    record.publicationContext.processingId,
  ].join(":");
}

export function compareResearchFinancialStatementRevisionPrecedence(
  left: ResearchFinancialStatementRecord,
  right: ResearchFinancialStatementRecord,
): number {
  const publicationOrder = left.publicationContext.publishedAt.localeCompare(
    right.publicationContext.publishedAt,
  );
  if (publicationOrder !== 0) return publicationOrder;
  const filingSequenceOrder = left.publicationContext.filingSequence
    - right.publicationContext.filingSequence;
  if (filingSequenceOrder !== 0) return filingSequenceOrder;
  const revisionPublicationOrder = (left.publicationContext.revisionPublishedAt ?? "")
    .localeCompare(right.publicationContext.revisionPublishedAt ?? "");
  if (revisionPublicationOrder !== 0) return revisionPublicationOrder;
  const revisionSequenceOrder = left.publicationContext.revisionSequence
    - right.publicationContext.revisionSequence;
  if (revisionSequenceOrder !== 0) return revisionSequenceOrder;
  const processingSequenceOrder = left.publicationContext.processingSequence
    - right.publicationContext.processingSequence;
  return processingSequenceOrder !== 0
    ? processingSequenceOrder
    : researchFinancialStatementRecordKey(left).localeCompare(researchFinancialStatementRecordKey(right));
}

function compareResearchFinancialStatementSourcePrecedence(
  left: ResearchFinancialStatementRecord,
  right: ResearchFinancialStatementRecord,
): number {
  const publicationOrder = left.publicationContext.publishedAt.localeCompare(
    right.publicationContext.publishedAt,
  );
  if (publicationOrder !== 0) return publicationOrder;
  const filingSequenceOrder = left.publicationContext.filingSequence
    - right.publicationContext.filingSequence;
  if (filingSequenceOrder !== 0) return filingSequenceOrder;
  const revisionPublicationOrder = (left.publicationContext.revisionPublishedAt ?? "")
    .localeCompare(right.publicationContext.revisionPublishedAt ?? "");
  if (revisionPublicationOrder !== 0) return revisionPublicationOrder;
  return left.publicationContext.revisionSequence - right.publicationContext.revisionSequence;
}

export function researchFinancialStatementRecordSortOrder(
  left: ResearchFinancialStatementRecord,
  right: ResearchFinancialStatementRecord,
): number {
  const periodOrder = researchFinancialStatementPeriodKey(left).localeCompare(
    researchFinancialStatementPeriodKey(right),
  );
  if (periodOrder !== 0) return periodOrder;
  const basisOrder = left.filingBasis.localeCompare(right.filingBasis);
  if (basisOrder !== 0) return basisOrder;
  return compareResearchFinancialStatementRevisionPrecedence(left, right);
}

export function resolveLatestResearchFinancialStatementRecords(
  records: readonly ResearchFinancialStatementRecord[],
): ResearchFinancialStatementRecord[] {
  const latestByPeriod = new Map<string, ResearchFinancialStatementRecord>();
  const ambiguityByPeriod = new Map<string, Set<ResearchFinancialStatementAmbiguityFlag>>();
  for (const record of [...records].sort(researchFinancialStatementRecordSortOrder)) {
    const periodKey = `${record.listingId}:${researchFinancialStatementPeriodKey(record)}:${record.filingBasis}`;
    const current = latestByPeriod.get(periodKey);
    if (current && compareResearchFinancialStatementSourcePrecedence(current, record) === 0) {
      const flags = ambiguityByPeriod.get(periodKey) ?? new Set(current.ambiguityFlags);
      flags.add("duplicate_context");
      ambiguityByPeriod.set(periodKey, flags);
    }
    latestByPeriod.set(periodKey, record);
  }
  return [...latestByPeriod.entries()]
    .map(([periodKey, record]) => {
      const ambiguityFlags = ambiguityByPeriod.get(periodKey);
      return ambiguityFlags
        ? { ...record, ambiguityFlags: [...new Set([...record.ambiguityFlags, ...ambiguityFlags])].sort((left, right) => left.localeCompare(right)) }
        : record;
    })
    .sort(researchFinancialStatementRecordSortOrder);
}

export function normalizeResearchFinancialStatementFact(input: {
  listingId: string;
  issuerId: string;
  filingId: string;
  revisionId: string;
  statementKind: ResearchFinancialStatementKind;
  concept: ResearchFinancialStatementConceptRef;
  metric: ResearchFinancialStatementMetricRef;
  contextId: string;
  dimensions?: Record<string, string>;
  period: ResearchFinancialStatementPeriodRef;
  valueKind: ResearchFinancialStatementValueKind;
  rawValue: string;
  unit: ResearchFinancialStatementUnitRef;
  declaredScale?: string | null;
  declaredPrecision?: string | null;
  ambiguityFlags?: ResearchFinancialStatementAmbiguityFlag[];
}): ResearchFinancialStatementFact {
  const normalized = normalizeRawNumber(input.rawValue);
  const ambiguityFlags = new Set(input.ambiguityFlags ?? []);
  if (input.metric.state === "unmapped") ambiguityFlags.add("unmapped_concept");
  if (input.unit.state === "unknown") ambiguityFlags.add("unknown_unit");
  return {
    id: opaqueId(
      "fin_stmt_fact",
      input.listingId,
      input.filingId,
      input.revisionId,
      input.statementKind,
      input.concept.qname,
      input.contextId,
      input.rawValue,
    ),
    kind: "source_fact",
    listingId: input.listingId,
    issuerId: input.issuerId,
    filingId: input.filingId,
    revisionId: input.revisionId,
    statementKind: input.statementKind,
    concept: input.concept,
    metric: input.metric,
    context: {
      contextId: input.contextId,
      dimensions: { ...(input.dimensions ?? {}) },
      period: input.period,
      valueKind: input.valueKind,
    },
    raw: { state: "present", value: input.rawValue },
    normalized,
    unit: input.unit,
    declaredScale: input.declaredScale ?? null,
    declaredPrecision: input.declaredPrecision ?? null,
    ambiguityFlags: [...ambiguityFlags].sort((left, right) => left.localeCompare(right)),
  };
}

export function validateResearchFinancialStatementQuery(
  query: ResearchFinancialStatementRecordQuery,
): void {
  assertPeriodToken(query.periodicity, query.startPeriod, "startPeriod");
  assertPeriodToken(query.periodicity, query.endPeriod, "endPeriod");
  if (query.startPeriod && query.endPeriod && query.startPeriod > query.endPeriod) {
    throw invalidResearchFinancialStatementRecord("startPeriod must be <= endPeriod");
  }
  if (!isTimestamp(query.effectiveAt) || !isTimestamp(query.knowledgeAt)) {
    throw invalidResearchFinancialStatementRecord("query timestamps must be ISO datetimes");
  }
}

export function validateResearchFinancialStatementRecord(
  record: ResearchFinancialStatementRecord,
): void {
  validatePeriodicity(record);
  if (!isIsoDate(record.fiscalPeriod.periodStart) || !isIsoDate(record.fiscalPeriod.periodEnd)) {
    throw invalidResearchFinancialStatementRecord("fiscal period dates must be ISO dates");
  }
  if (record.fiscalPeriod.periodStart > record.fiscalPeriod.periodEnd) {
    throw invalidResearchFinancialStatementRecord("fiscal period start must be <= end");
  }
  if (!isTimestamp(record.publicationContext.publishedAt) || !isTimestamp(record.provenance.retrievedAt)) {
    throw invalidResearchFinancialStatementRecord("publication and retrieval timestamps must be ISO datetimes");
  }
  if (
    record.publicationContext.revisionPublishedAt !== null
    && !isTimestamp(record.publicationContext.revisionPublishedAt)
  ) {
    throw invalidResearchFinancialStatementRecord("revisionPublishedAt must be an ISO datetime when present");
  }
  if (!isTimestamp(record.provenance.processedAt)) {
    throw invalidResearchFinancialStatementRecord("processedAt must be an ISO datetime");
  }
  if (record.publicationContext.filingSequence < 0 || record.publicationContext.revisionSequence < 0) {
    throw invalidResearchFinancialStatementRecord("publication sequences must be non-negative");
  }
  if (record.publicationContext.processingSequence < 0 || !record.publicationContext.processingId) {
    throw invalidResearchFinancialStatementRecord("processing revision identity must be present and non-negative");
  }
  const sectionKinds = new Set<ResearchFinancialStatementKind>();
  for (const section of record.statements) {
    if (sectionKinds.has(section.kind)) {
      throw invalidResearchFinancialStatementRecord(`duplicate statement section ${section.kind}`);
    }
    sectionKinds.add(section.kind);
    const factIds = new Set<string>();
    for (const fact of section.facts) {
      if (fact.statementKind !== section.kind) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} statement kind mismatch`);
      }
      if (factIds.has(fact.id)) {
        throw invalidResearchFinancialStatementRecord(`duplicate fact id ${fact.id}`);
      }
      factIds.add(fact.id);
      if (fact.raw.state !== "present") {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} raw state must be present`);
      }
      if (fact.normalized.state === "present" && !isNormalizedDecimal(fact.normalized.value)) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} normalized value is invalid`);
      }
      if (!fact.concept.qname || !fact.concept.label) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} concept must preserve qname and label`);
      }
      if (fact.unit.state === "known" && !fact.unit.unitId) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} known unit must provide unitId`);
      }
      if (fact.metric.state === "mapped" && !fact.metric.metricId) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} mapped metricId missing`);
      }
      if (fact.context.period.kind === "instant") {
        if (!isTimestamp(fact.context.period.instantAt)) {
          throw invalidResearchFinancialStatementRecord(`fact ${fact.id} instant period invalid`);
        }
        if (fact.context.valueKind !== "instant") {
          throw invalidResearchFinancialStatementRecord(`fact ${fact.id} instant periods require instant valueKind`);
        }
      } else {
        if (
          !isTimestamp(fact.context.period.startAt)
          || !isTimestamp(fact.context.period.endAt)
          || fact.context.period.startAt > fact.context.period.endAt
        ) {
          throw invalidResearchFinancialStatementRecord(`fact ${fact.id} duration period invalid`);
        }
        if (fact.context.valueKind === "instant") {
          throw invalidResearchFinancialStatementRecord(`fact ${fact.id} duration periods cannot be instant valueKind`);
        }
      }
      const normalizedFromRaw = normalizeRawNumber(fact.raw.value);
      const normalizedMatches = normalizedFromRaw.state === "present"
        ? fact.normalized.state === "present" && normalizedFromRaw.value === fact.normalized.value
        : fact.normalized.state === "missing" && normalizedFromRaw.reason === fact.normalized.reason;
      if (!normalizedMatches) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} raw/normalized mismatch`);
      }
    }
  }
  const sectionKindSet = new Set(record.statements.map((section) => section.kind));
  for (const required of ["income", "balance_sheet", "cash_flow"] as const) {
    if (!sectionKindSet.has(required)) {
      throw invalidResearchFinancialStatementRecord(`missing required statement section ${required}`);
    }
  }
}
