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

export const RESEARCH_FINANCIAL_STATEMENT_PARSER_VERSION = "research-financial-statements-parser/1.0.4";

export function researchFinancialStatementProcessingId(
  contentHash: string,
  parserVersion = RESEARCH_FINANCIAL_STATEMENT_PARSER_VERSION,
): string {
  return `proc_${createHash("sha256").update(`${contentHash}\u001f${parserVersion}`).digest("hex").slice(0, 32)}`;
}

export function researchFinancialStatementProcessingSequence(
  parserVersion = RESEARCH_FINANCIAL_STATEMENT_PARSER_VERSION,
): number {
  const match = /\/(\d+)\.(\d+)\.(\d+)$/.exec(parserVersion);
  if (!match) throw new Error(`Invalid financial statement parser version: ${parserVersion}`);
  return (Number(match[1]) * 1_000_000) + (Number(match[2]) * 1_000) + Number(match[3]);
}
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
  taxonomy?: {
    namespaceUri: string | null;
    version: string;
  };
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
  declaredDecimals: string | null;
  declaredPrecision: string | null;
  declaredSign?: string | null;
  declaredFormat?: string | null;
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
    parserVersion: string;
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
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return false;
  const date = new Date(value);
  return !Number.isNaN(date.getTime());
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

export function applyResearchFinancialStatementTransform(
  rawValue: string,
  scale: string | null,
  sign: string | null,
): string {
  const compact = rawValue.trim().replaceAll(",", "");
  if (!/^-?\d+(?:\.\d+)?$/.test(compact)) return compact;
  const scaleValue = scale === null ? 0 : Number(scale);
  if (!Number.isSafeInteger(scaleValue)) {
    throw new TypeError("XBRL numeric scale must be a safe integer");
  }
  const sourceNegative = compact.startsWith("-");
  const negative = sign === "-" || sourceNegative;
  const unsigned = sourceNegative ? compact.slice(1) : compact;
  const [whole = "0", fraction = ""] = unsigned.split(".");
  const digits = `${whole}${fraction}`;
  const maximumTransformedLength = 10_000;
  if (digits.length + Math.abs(scaleValue) + 2 > maximumTransformedLength) {
    throw new RangeError(`XBRL numeric transform exceeds ${maximumTransformedLength} characters`);
  }
  const decimalPosition = whole.length + scaleValue;
  let transformed: string;
  if (decimalPosition <= 0) {
    transformed = `0.${"0".repeat(-decimalPosition)}${digits}`;
  } else if (decimalPosition >= digits.length) {
    transformed = `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  } else {
    transformed = `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
  }
  const [transformedWhole = "0", transformedFraction] = transformed.split(".");
  const normalizedWhole = transformedWhole.replace(/^0+(?=\d)/, "") || "0";
  const normalizedFraction = transformedFraction?.replace(/0+$/, "");
  const normalized = normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
  return negative && normalized !== "0" ? `-${normalized}` : normalized;
}

export function applyResearchFinancialStatementInlineFormat(
  rawValue: string,
  format: string | null,
): string {
  if (!format) return rawValue;
  const localName = (format.includes(":") ? format.slice(format.indexOf(":") + 1) : format)
    .replaceAll(/[-_]/g, "")
    .toLowerCase();
  if (localName === "zerodash" && /^[-‐‑‒–—−]$/.test(rawValue)) return "0";
  if (["numcommadecimal", "numdotcomma", "numspacecomma"].includes(localName)) {
    return rawValue.replaceAll(/[.\s\u00a0]/g, "").replace(",", ".");
  }
  if (["numdotdecimal", "numcommadot", "numspacedot"].includes(localName)) {
    return rawValue.replaceAll(/[,\s\u00a0]/g, "");
  }
  return rawValue;
}

function financialStatementPublishedAtTimestamp(value: string): string {
  if (isIsoDate(value)) {
    return new Date(`${value}T00:00:00+08:00`).toISOString();
  }
  if (value.includes("T") && !Number.isNaN(Date.parse(value))) {
    return new Date(value).toISOString();
  }
  throw invalidResearchFinancialStatementRecord(`invalid published date or timestamp ${value}`);
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

export function researchFinancialStatementMetricForConcept(
  localName: string,
  namespaceUri: string | null,
): ResearchFinancialStatementMetricRef {
  if (!namespaceUri || !/^https?:\/\/xbrl\.ifrs\.org\/taxonomy\/.+\/ifrs-full\/?$/i.test(namespaceUri)) {
    return { state: "unmapped", reason: "no_core_metric_mapping" };
  }
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

export function valueKindForMopsFact(
  fact: MopsFactRecord,
  filing: MopsFinancialStatementArtifact["filing"],
): ResearchFinancialStatementValueKind {
  if (!fact.periodStart) return "instant";
  if (filing.fiscalPeriod === "annual" || filing.fiscalPeriod === "q1") return "cumulative";
  return fact.periodStart === `${filing.fiscalYear}-01-01` ? "cumulative" : "discrete";
}

export function resolveMopsArtifactFilingBasis(
  artifact: MopsFinancialStatementArtifact,
): ResearchFinancialStatementFilingBasis {
  const members = new Set(
    artifact.contexts.flatMap((context) => context.dimensions.map((dimension) => dimension.member.toLowerCase())),
  );
  const individual = [...members].some((member) => /separate|individual|個別|個體/.test(member));
  const consolidated = [...members].some((member) => /consolidated|合併/.test(member));
  const contextBasis: ResearchFinancialStatementFilingBasis = individual === consolidated
    ? "unknown"
    : individual ? "individual" : "consolidated";
  const claimedBasis = artifact.filing.filingBasis;
  if (claimedBasis !== "unknown" && contextBasis !== "unknown" && claimedBasis !== contextBasis) {
    throw new Error(`MOPS filing basis ${claimedBasis} contradicts artifact contexts (${contextBasis})`);
  }
  if (claimedBasis !== "unknown") return claimedBasis;
  if (artifact.issues.basisAmbiguity) return "unknown";
  return contextBasis;
}

export function researchFinancialStatementTaxonomyVersion(namespaceUri: string | null): string {
  if (!namespaceUri) return "unknown";
  return /\b(20\d{2}(?:[-/](?:Q?[1-4]|0[1-9]|1[0-2])(?:[-/](?:0[1-9]|[12]\d|3[01]))?)?)\b/.exec(namespaceUri)?.[1]
    ?? namespaceUri;
}

export function researchFinancialStatementUnitId(
  unit: { measures: string[]; numeratorMeasures: string[]; denominatorMeasures: string[] },
  fallback: string,
): string {
  if (unit.numeratorMeasures.length > 0 || unit.denominatorMeasures.length > 0) {
    const numerator = unit.numeratorMeasures.length > 0 ? unit.numeratorMeasures.join("*") : "1";
    const denominator = unit.denominatorMeasures.length > 0 ? unit.denominatorMeasures.join("*") : "1";
    return `${numerator}/${denominator}`;
  }
  return unit.measures.length > 0 ? unit.measures.join("*") : fallback;
}

export function materializeResearchFinancialStatementRecord(
  input: ResearchFinancialStatementAppendInput,
  options: { processedAt?: string } = {},
): ResearchFinancialStatementRecord {
  if ("publicationContext" in input) {
    validateResearchFinancialStatementRecord(input);
    return input;
  }
  const periodicity = input.filing.fiscalPeriod === "annual" ? "annual" : "quarterly";
  const fiscalQuarter = quarterForFilingPeriod(input.filing.fiscalPeriod);
  const periodStart = input.filing.periodStart;
  const periodEnd = input.filing.periodEnd;
  const filingBasis = resolveMopsArtifactFilingBasis(input);
  const publishedAt = financialStatementPublishedAtTimestamp(input.filing.publishedAt);
  const issuesByContextSignature = new Set(
    input.issues.duplicateContextGroups.flatMap((group) => group.contextIds),
  );
  const unitsById = new Map(input.units.map((unit) => [unit.id, unit] as const));
  const sections = new Map<ResearchFinancialStatementKind, ResearchFinancialStatementFact[]>();
  const pushFact = (kind: ResearchFinancialStatementKind, fact: ResearchFinancialStatementFact) => {
    const current = sections.get(kind) ?? [];
    const repeated = current.find((candidate) => candidate.id === fact.id);
    if (repeated && JSON.stringify(repeated) === JSON.stringify(fact)) return;
    current.push(fact);
    sections.set(kind, current);
  };
  for (const fact of input.facts) {
    const statementKind = statementKindForRole(fact.statementRole);
    if (!statementKind) continue;
    const unitRecord = fact.unitRef ? unitsById.get(fact.unitRef) : undefined;
    pushFact(statementKind, normalizeResearchFinancialStatementFact({
      listingId: input.listingId,
      issuerId: input.issuerId,
      filingId: input.filing.filingId,
      revisionId: `${input.filing.filingId}:r${input.filing.revision}`,
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
      period: durationPeriodForFact(fact, periodEnd),
      valueKind: valueKindForMopsFact(fact, input.filing),
      rawValue: fact.rawValue,
      normalizedValue: fact.normalizedValue,
      unit: unitRecord
        ? { state: "known", unitId: researchFinancialStatementUnitId(unitRecord, fact.unitRef ?? "unknown") }
        : { state: "unknown", rawUnitId: fact.unitRef },
      declaredScale: fact.scale,
      declaredDecimals: fact.decimals,
      declaredPrecision: fact.precision,
      declaredSign: fact.sign,
      declaredFormat: fact.format,
      ambiguityFlags: [
        ...(issuesByContextSignature.has(fact.contextRef) ? ["duplicate_context" as const] : []),
        ...(input.issues.basisAmbiguity ? ["filing_basis_ambiguous" as const] : []),
        ...(input.issues.taxonomyAmbiguity ? ["taxonomy_change" as const] : []),
      ],
    }));
  }
  const record: ResearchFinancialStatementRecord = {
    listingId: input.listingId,
    issuerId: input.issuerId,
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
      revisionPublishedAt: input.filing.revision > 0
        ? financialStatementPublishedAtTimestamp(input.artifact.retrievedAt)
        : null,
      filingSequence: 0,
      revisionSequence: input.filing.revision,
      processingId: researchFinancialStatementProcessingId(input.artifact.contentHash),
      processingSequence: researchFinancialStatementProcessingSequence(),
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
      ...(input.issues.unknownUnitIds.length > 0 ? ["unknown_unit" as const] : []),
      ...(input.issues.unmappedConcepts.length > 0 ? ["unmapped_concept" as const] : []),
    ],
    provenance: {
      id: opaqueId(
        "fin_stmt_prov",
        input.listingId,
        input.filing.filingId,
        input.artifact.contentHash,
        RESEARCH_FINANCIAL_STATEMENT_PARSER_VERSION,
      ),
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
      processedAt: options.processedAt ?? new Date().toISOString(),
      parserVersion: RESEARCH_FINANCIAL_STATEMENT_PARSER_VERSION,
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
  const publicationOrder = Date.parse(left.publicationContext.publishedAt)
    - Date.parse(right.publicationContext.publishedAt);
  if (publicationOrder !== 0) return publicationOrder;
  const filingSequenceOrder = left.publicationContext.filingSequence
    - right.publicationContext.filingSequence;
  if (filingSequenceOrder !== 0) return filingSequenceOrder;
  const revisionPublicationOrder = left.publicationContext.revisionPublishedAt === null
    ? right.publicationContext.revisionPublishedAt === null ? 0 : -1
    : right.publicationContext.revisionPublishedAt === null
      ? 1
      : Date.parse(left.publicationContext.revisionPublishedAt)
        - Date.parse(right.publicationContext.revisionPublishedAt);
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
  const publicationOrder = Date.parse(left.publicationContext.publishedAt)
    - Date.parse(right.publicationContext.publishedAt);
  if (publicationOrder !== 0) return publicationOrder;
  const filingSequenceOrder = left.publicationContext.filingSequence
    - right.publicationContext.filingSequence;
  if (filingSequenceOrder !== 0) return filingSequenceOrder;
  const revisionPublicationOrder = left.publicationContext.revisionPublishedAt === null
    ? right.publicationContext.revisionPublishedAt === null ? 0 : -1
    : right.publicationContext.revisionPublishedAt === null
      ? 1
      : Date.parse(left.publicationContext.revisionPublishedAt)
        - Date.parse(right.publicationContext.revisionPublishedAt);
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
    const sourcePrecedence = current
      ? compareResearchFinancialStatementSourcePrecedence(current, record)
      : null;
    const successiveProcessingRevision = current
      && current.publicationContext.filingId === record.publicationContext.filingId
      && current.publicationContext.revisionId === record.publicationContext.revisionId
      && current.provenance.contentHash === record.provenance.contentHash
      && current.publicationContext.processingSequence !== record.publicationContext.processingSequence;
    if (sourcePrecedence !== null && sourcePrecedence < 0) {
      ambiguityByPeriod.delete(periodKey);
    } else if (current && sourcePrecedence === 0 && !successiveProcessingRevision) {
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
  taxonomy?: {
    namespaceUri: string | null;
    version: string;
  };
  metric: ResearchFinancialStatementMetricRef;
  contextId: string;
  dimensions?: Record<string, string>;
  period: ResearchFinancialStatementPeriodRef;
  valueKind: ResearchFinancialStatementValueKind;
  rawValue: string;
  normalizedValue?: string;
  unit: ResearchFinancialStatementUnitRef;
  declaredScale?: string | null;
  declaredDecimals?: string | null;
  declaredPrecision?: string | null;
  declaredSign?: string | null;
  declaredFormat?: string | null;
  ambiguityFlags?: ResearchFinancialStatementAmbiguityFlag[];
}): ResearchFinancialStatementFact {
  const normalized = normalizeRawNumber(input.normalizedValue ?? input.rawValue);
  const ambiguityFlags = new Set(input.ambiguityFlags ?? []);
  const conceptIdentity = input.taxonomy?.namespaceUri
    ? input.concept.qname.split(":").at(-1) ?? input.concept.qname
    : input.concept.qname;
  if (input.metric.state === "unmapped") ambiguityFlags.add("unmapped_concept");
  if (input.unit.state === "unknown") ambiguityFlags.add("unknown_unit");
  return {
    id: opaqueId(
      "fin_stmt_fact",
      input.listingId,
      input.filingId,
      input.revisionId,
      input.statementKind,
      conceptIdentity,
      input.taxonomy?.namespaceUri ?? "",
      input.contextId,
      input.unit.state === "known"
        ? `known:${input.unit.unitId}`
        : `unknown:${input.unit.rawUnitId ?? ""}`,
    ),
    kind: "source_fact",
    listingId: input.listingId,
    issuerId: input.issuerId,
    filingId: input.filingId,
    revisionId: input.revisionId,
    statementKind: input.statementKind,
    concept: input.concept,
    ...(input.taxonomy ? { taxonomy: input.taxonomy } : {}),
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
    declaredDecimals: input.declaredDecimals ?? null,
    declaredPrecision: input.declaredPrecision ?? null,
    declaredSign: input.declaredSign ?? null,
    declaredFormat: input.declaredFormat ?? null,
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
  if (Date.parse(record.provenance.processedAt) < Date.parse(record.provenance.retrievedAt)) {
    throw invalidResearchFinancialStatementRecord("processedAt must be at or after retrievedAt");
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
      if (
        fact.listingId !== record.listingId
        || fact.issuerId !== record.issuerId
        || fact.filingId !== record.publicationContext.filingId
        || fact.revisionId !== record.publicationContext.revisionId
      ) {
        throw invalidResearchFinancialStatementRecord(`fact ${fact.id} ownership mismatch`);
      }
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
      const formattedRaw = applyResearchFinancialStatementInlineFormat(
        fact.raw.value,
        fact.declaredFormat ?? null,
      );
      const normalizedFromRaw = normalizeRawNumber(
        fact.declaredScale !== null || fact.declaredSign
          ? applyResearchFinancialStatementTransform(formattedRaw, fact.declaredScale, fact.declaredSign ?? null)
          : formattedRaw,
      );
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
