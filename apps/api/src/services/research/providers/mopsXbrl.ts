import { createHash } from "node:crypto";
import { applyResearchFinancialStatementTransform } from "../financialStatements.js";

export type MopsStatementVenue = "TWSE" | "TPEX";
export type MopsStatementSector = "operating_company" | "financial_institution" | "unknown";
export type MopsArtifactKind = "xbrl" | "ixbrl";
export type MopsFilingPeriod = "annual" | "q1" | "q2" | "q3" | "q4";
export type MopsAmendmentType = "original" | "amendment" | "restatement" | "unknown";
export type MopsStatementRole =
  | "balance_sheet"
  | "income_statement"
  | "cash_flow_statement"
  | "equity_statement"
  | "notes"
  | "unknown";

export interface MopsFinancialStatementDescriptor {
  listingId: string;
  issuerId: string;
  ticker: string;
  venue: MopsStatementVenue;
  sector: MopsStatementSector;
  sourceUrl: string;
  artifactKind?: MopsArtifactKind;
  filing: {
    filingId: string;
    fiscalYear: number;
    fiscalPeriod: MopsFilingPeriod;
    periodStart: string;
    periodEnd: string;
    filingBasis: "consolidated" | "individual" | "unknown";
    publishedAt: string;
    revision: number;
    amendmentType: MopsAmendmentType;
    accessionNumber?: string | null;
  };
}

export interface MopsContextDimension {
  dimension: string;
  member: string;
}

export interface MopsContextRecord {
  id: string;
  entityIdentifiers: string[];
  periodType: "instant" | "duration" | "forever" | "unknown";
  instant: string | null;
  startDate: string | null;
  endDate: string | null;
  dimensions: MopsContextDimension[];
  signature: string;
}

export interface MopsUnitRecord {
  id: string;
  measures: string[];
  numeratorMeasures: string[];
  denominatorMeasures: string[];
}

export interface MopsFactRecord {
  id: string;
  statementRole: MopsStatementRole;
  concept: {
    qname: string;
    prefix: string;
    localName: string;
    namespaceUri: string | null;
  };
  contextRef: string;
  unitRef: string | null;
  decimals: string | null;
  scale: string | null;
  sign: string | null;
  rawValue: string;
  normalizedValue: string;
  periodEnd: string | null;
  periodStart: string | null;
  contextDimensions: MopsContextDimension[];
}

export interface MopsFinancialStatementArtifact {
  listingId: string;
  issuerId: string;
  ticker: string;
  venue: MopsStatementVenue;
  sector: MopsStatementSector;
  filing: MopsFinancialStatementDescriptor["filing"];
  artifact: {
    publisher: "MOPS";
    accessProvider: "MOPS_XBRL";
    sourceUrl: string;
    contentHash: string;
    retrievedAt: string;
    acquisitionRunId: string;
    artifactKind: MopsArtifactKind;
    taxonomyVersions: string[];
    primaryNamespace: string | null;
  };
  contexts: MopsContextRecord[];
  units: MopsUnitRecord[];
  facts: MopsFactRecord[];
  issues: {
    duplicateContextGroups: Array<{ signature: string; contextIds: string[] }>;
    unknownUnitIds: string[];
    unmappedConcepts: string[];
    basisAmbiguity: boolean;
    taxonomyAmbiguity: boolean;
    contextAmbiguity: boolean;
    missingStatementRoles: MopsStatementRole[];
  };
}

const CORE_PREFIXES = new Set(["xbrli", "xbrldi", "link", "xlink", "ix", "html"]);
const KNOWN_STATEMENT_ROLE_BY_CONCEPT = new Map<string, MopsStatementRole>([
  ["Assets", "balance_sheet"],
  ["CashAndCashEquivalents", "balance_sheet"],
  ["CurrentAssets", "balance_sheet"],
  ["CurrentLiabilities", "balance_sheet"],
  ["Equity", "balance_sheet"],
  ["EquityAttributableToOwnersOfParent", "balance_sheet"],
  ["ChangesInEquity", "equity_statement"],
  ["EquityAtBeginningOfPeriod", "equity_statement"],
  ["EquityAtEndOfPeriod", "equity_statement"],
  ["IncreaseDecreaseThroughOtherChangesInEquity", "equity_statement"],
  ["InterestBearingBorrowings", "balance_sheet"],
  ["Liabilities", "balance_sheet"],
  ["GrossProfit", "income_statement"],
  ["OperatingIncomeLoss", "income_statement"],
  ["ProfitLoss", "income_statement"],
  ["Revenue", "income_statement"],
  ["RevenueFromContractsWithCustomers", "income_statement"],
  ["AcquisitionOfPropertyPlantAndEquipment", "cash_flow_statement"],
  ["CashFlowsFromUsedInOperatingActivities", "cash_flow_statement"],
  ["NetCashFlowsFromUsedInOperatingActivities", "cash_flow_statement"],
  ["CashFlowsFromUsedInInvestingActivities", "cash_flow_statement"],
  ["NetCashFlowsFromUsedInInvestingActivities", "cash_flow_statement"],
  ["CashFlowsFromUsedInFinancingActivities", "cash_flow_statement"],
  ["PurchaseOfPropertyPlantAndEquipment", "cash_flow_statement"],
]);

function parseAttributes(fragment: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  for (const match of fragment.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*"([^"]*)"/g)) {
    attributes[match[1]] = match[2] ?? "";
  }
  return attributes;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFactValue(rawValue: string, sign: string | null, scale: string | null): string {
  return applyResearchFinancialStatementTransform(stripMarkup(rawValue), scale, sign);
}

function detectArtifactKind(content: string, declaredKind: MopsArtifactKind | undefined): MopsArtifactKind {
  if (declaredKind) return declaredKind;
  return /<ix:(?:nonFraction|nonNumeric)\b/i.test(content) || /<html\b/i.test(content)
    ? "ixbrl"
    : "xbrl";
}

function extractNamespaceMap(content: string): Record<string, string> {
  const rootMatch = /<([A-Za-z_][\w:.-]*)([^>]*)>/m.exec(content);
  if (!rootMatch) return {};
  const namespaceMap: Record<string, string> = {};
  for (const [attributeName, value] of Object.entries(parseAttributes(rootMatch[2] ?? ""))) {
    if (attributeName === "xmlns") {
      namespaceMap[""] = value;
      continue;
    }
    if (attributeName.startsWith("xmlns:")) {
      namespaceMap[attributeName.slice(6)] = value;
    }
  }
  return namespaceMap;
}

function extractContexts(content: string): MopsContextRecord[] {
  const contexts: MopsContextRecord[] = [];
  for (const match of content.matchAll(/<(?:\w+:)?context\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?context>/g)) {
    const attributes = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const entityIdentifiers = [...body.matchAll(/<(?:\w+:)?identifier\b[^>]*>([^<]+)<\/(?:\w+:)?identifier>/g)]
      .map((item) => stripMarkup(item[1] ?? ""));
    const instant = /<(?:\w+:)?instant\b[^>]*>([^<]+)<\/(?:\w+:)?instant>/.exec(body)?.[1] ?? null;
    const startDate = /<(?:\w+:)?startDate\b[^>]*>([^<]+)<\/(?:\w+:)?startDate>/.exec(body)?.[1] ?? null;
    const endDate = /<(?:\w+:)?endDate\b[^>]*>([^<]+)<\/(?:\w+:)?endDate>/.exec(body)?.[1] ?? null;
    const explicitDimensions = [...body.matchAll(/<(?:\w+:)?explicitMember\b([^>]*)>([^<]+)<\/(?:\w+:)?explicitMember>/g)]
      .map((item) => {
        const explicitAttributes = parseAttributes(item[1] ?? "");
        return {
          dimension: explicitAttributes.dimension ?? "unknown",
          member: stripMarkup(item[2] ?? ""),
        };
      });
    const typedDimensions = [...body.matchAll(/<(?:\w+:)?typedMember\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?typedMember>/g)]
      .map((item) => {
        const typedAttributes = parseAttributes(item[1] ?? "");
        const typedBody = item[2] ?? "";
        const typedValue = /^\s*<([A-Za-z_][\w:.-]*)\b[^>]*>([\s\S]*?)<\/\1>\s*$/.exec(typedBody);
        return {
          dimension: typedAttributes.dimension ?? "unknown",
          member: typedValue
            ? `${typedValue[1]}:${stripMarkup(typedValue[2] ?? "")}`
            : stripMarkup(typedBody) || "unknown",
        };
      });
    const dimensions = [...explicitDimensions, ...typedDimensions]
      .sort((left, right) => `${left.dimension}:${left.member}`.localeCompare(`${right.dimension}:${right.member}`));
    const periodType = instant
      ? "instant"
      : startDate && endDate
        ? "duration"
        : /<(?:\w+:)?forever\b/i.test(body)
          ? "forever"
          : "unknown";
    const signature = JSON.stringify({
      entityIdentifiers,
      periodType,
      instant,
      startDate,
      endDate,
      dimensions,
    });
    contexts.push({
      id: attributes.id ?? `context_${contexts.length + 1}`,
      entityIdentifiers,
      periodType,
      instant,
      startDate,
      endDate,
      dimensions,
      signature,
    });
  }
  return contexts;
}

function extractUnits(content: string): MopsUnitRecord[] {
  const units: MopsUnitRecord[] = [];
  for (const match of content.matchAll(/<(?:\w+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?unit>/g)) {
    const attributes = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const numerator = /<(?:\w+:)?divide\b/i.test(body)
      ? [...body.matchAll(/<(?:\w+:)?unitNumerator\b[\s\S]*?<(?:\w+:)?measure\b[^>]*>([^<]+)<\/(?:\w+:)?measure>[\s\S]*?<\/(?:\w+:)?unitNumerator>/g)]
        .map((item) => stripMarkup(item[1] ?? ""))
      : [];
    const denominator = /<(?:\w+:)?divide\b/i.test(body)
      ? [...body.matchAll(/<(?:\w+:)?unitDenominator\b[\s\S]*?<(?:\w+:)?measure\b[^>]*>([^<]+)<\/(?:\w+:)?measure>[\s\S]*?<\/(?:\w+:)?unitDenominator>/g)]
        .map((item) => stripMarkup(item[1] ?? ""))
      : [];
    const measures = [...body.matchAll(/<(?:\w+:)?measure\b[^>]*>([^<]+)<\/(?:\w+:)?measure>/g)]
      .map((item) => stripMarkup(item[1] ?? ""));
    units.push({
      id: attributes.id ?? `unit_${units.length + 1}`,
      measures,
      numeratorMeasures: numerator,
      denominatorMeasures: denominator,
    });
  }
  return units;
}

function statementRoleForConcept(localName: string): MopsStatementRole {
  return KNOWN_STATEMENT_ROLE_BY_CONCEPT.get(localName) ?? "unknown";
}

function buildFactRecord(
  qname: string,
  attributes: Record<string, string>,
  innerValue: string,
  namespaceMap: Record<string, string>,
  contextsById: ReadonlyMap<string, MopsContextRecord>,
): MopsFactRecord | null {
  const [prefix, localName] = qname.includes(":") ? qname.split(":", 2) : ["", qname];
  if (CORE_PREFIXES.has(prefix)) return null;
  const contextRef = attributes.contextRef;
  if (!contextRef) return null;
  const context = contextsById.get(contextRef);
  const rawValue = stripMarkup(innerValue);
  return {
    id: `fact_${createHash("sha256").update([qname, contextRef, attributes.unitRef ?? "", rawValue].join("\u001f")).digest("hex").slice(0, 24)}`,
    statementRole: statementRoleForConcept(localName),
    concept: {
      qname,
      prefix,
      localName,
      namespaceUri: namespaceMap[prefix] ?? null,
    },
    contextRef,
    unitRef: attributes.unitRef ?? null,
    decimals: attributes.decimals ?? null,
    scale: attributes.scale ?? null,
    sign: attributes.sign ?? null,
    rawValue,
    normalizedValue: normalizeFactValue(rawValue, attributes.sign ?? null, attributes.scale ?? null),
    periodEnd: context?.endDate ?? context?.instant ?? null,
    periodStart: context?.startDate ?? null,
    contextDimensions: context?.dimensions ?? [],
  };
}

function extractInlineFacts(
  content: string,
  namespaceMap: Record<string, string>,
  contextsById: ReadonlyMap<string, MopsContextRecord>,
): MopsFactRecord[] {
  const facts: MopsFactRecord[] = [];
  for (const match of content.matchAll(/<ix:(?:nonFraction|nonNumeric)\b([^>]*?)(?<!\/)>([\s\S]*?)<\/ix:(?:nonFraction|nonNumeric)>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const qname = attributes.name;
    if (!qname) continue;
    const fact = buildFactRecord(qname, attributes, match[2] ?? "", namespaceMap, contextsById);
    if (fact) facts.push(fact);
  }
  for (const match of content.matchAll(/<ix:(?:nonFraction|nonNumeric)\b([^>]*)\/>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    const qname = attributes.name;
    if (!qname) continue;
    const fact = buildFactRecord(qname, attributes, "", namespaceMap, contextsById);
    if (fact) facts.push(fact);
  }
  return facts;
}

function extractXbrlFacts(
  content: string,
  namespaceMap: Record<string, string>,
  contextsById: ReadonlyMap<string, MopsContextRecord>,
): MopsFactRecord[] {
  const facts: MopsFactRecord[] = [];
  for (const match of content.matchAll(/<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b([^>]*)>([^<]*)<\/\1>/g)) {
    const attributes = parseAttributes(match[2] ?? "");
    if (!attributes.contextRef) continue;
    const fact = buildFactRecord(match[1] ?? "", attributes, match[3] ?? "", namespaceMap, contextsById);
    if (fact) facts.push(fact);
  }
  for (const match of content.matchAll(/<([A-Za-z_][\w.-]*:[A-Za-z_][\w.-]*)\b([^>]*)\/>/g)) {
    const attributes = parseAttributes(match[2] ?? "");
    if (!attributes.contextRef) continue;
    const fact = buildFactRecord(match[1] ?? "", attributes, "", namespaceMap, contextsById);
    if (fact) facts.push(fact);
  }
  return facts;
}

function taxonomyVersionsForFacts(
  facts: readonly MopsFactRecord[],
): string[] {
  const candidates = new Set<string>();
  for (const fact of facts) {
    if (fact.concept.namespaceUri) {
      const versionMatch = /\b(20\d{2}(?:[-/](?:Q?[1-4]|0[1-9]|1[0-2]))?)\b/.exec(fact.concept.namespaceUri);
      candidates.add(versionMatch?.[1] ?? fact.concept.namespaceUri);
    }
  }
  return [...candidates].filter((value) => value !== "").sort();
}

function hasTaxonomyAmbiguity(facts: readonly MopsFactRecord[]): boolean {
  const versionsByFamily = new Map<string, Set<string>>();
  for (const fact of facts) {
    const namespace = fact.concept.namespaceUri;
    if (!namespace) continue;
    const versionMatch = /\b20\d{2}(?:[-/](?:Q?[1-4]|0[1-9]|1[0-2]))?(?:[-/]\d{2})?\b/.exec(namespace);
    if (!versionMatch) continue;
    const family = namespace.replace(versionMatch[0], "{version}");
    const versions = versionsByFamily.get(family) ?? new Set<string>();
    versions.add(versionMatch[0]);
    versionsByFamily.set(family, versions);
  }
  return [...versionsByFamily.values()].some((versions) => versions.size > 1);
}

function hasBasisAmbiguity(facts: readonly MopsFactRecord[]): boolean {
  const basisByConcept = new Map<string, Set<string>>();
  for (const fact of facts) {
    const basisMembers = fact.contextDimensions
      .filter((dimension) => /basis|separate|consolidated/i.test(dimension.dimension) || /separate|consolidated/i.test(dimension.member))
      .map((dimension) => dimension.member);
    if (basisMembers.length === 0) continue;
    const members = basisByConcept.get(fact.concept.qname) ?? new Set<string>();
    for (const member of basisMembers) members.add(member);
    basisByConcept.set(fact.concept.qname, members);
  }
  return [...basisByConcept.values()].some((members) => members.size > 1);
}

export function parseMopsFinancialStatementArtifact(
  content: string,
  descriptor: MopsFinancialStatementDescriptor,
  metadata: {
    retrievedAt: string;
    acquisitionRunId: string;
    contentHash?: string;
  },
): MopsFinancialStatementArtifact {
  const artifactKind = detectArtifactKind(content, descriptor.artifactKind);
  const namespaceMap = extractNamespaceMap(content);
  const contexts = extractContexts(content);
  const units = extractUnits(content);
  const contextsById = new Map(contexts.map((context) => [context.id, context] as const));
  const facts = artifactKind === "ixbrl"
    ? extractInlineFacts(content, namespaceMap, contextsById)
    : extractXbrlFacts(content, namespaceMap, contextsById);
  const unitsById = new Map(units.map((unit) => [unit.id, unit] as const));
  const duplicateContextGroups = [...new Map(
    contexts.map((context) => [context.signature, contexts.filter((item) => item.signature === context.signature).map((item) => item.id)] as const),
  ).entries()]
    .filter(([, contextIds]) => contextIds.length > 1)
    .map(([signature, contextIds]) => ({ signature, contextIds }));
  const unknownUnitIds = [...new Set(facts
    .map((fact) => fact.unitRef)
    .filter((unitRef): unitRef is string => unitRef !== null && !unitsById.has(unitRef)))].sort();
  const unmappedConcepts = [...new Set(facts
    .filter((fact) => fact.statementRole === "unknown")
    .map((fact) => fact.concept.qname))].sort();
  const statementRoles = new Set(facts.map((fact) => fact.statementRole));
  const missingStatementRoles = (["balance_sheet", "income_statement", "cash_flow_statement"] as const)
    .filter((role) => !statementRoles.has(role));
  const taxonomyVersions = taxonomyVersionsForFacts(facts);
  const primaryNamespace = facts[0]?.concept.namespaceUri ?? null;
  const contentHash = metadata.contentHash
    ?? `sha256:${createHash("sha256").update(content).digest("hex")}`;
  return {
    listingId: descriptor.listingId,
    issuerId: descriptor.issuerId,
    ticker: descriptor.ticker,
    venue: descriptor.venue,
    sector: descriptor.sector,
    filing: descriptor.filing,
    artifact: {
      publisher: "MOPS",
      accessProvider: "MOPS_XBRL",
      sourceUrl: descriptor.sourceUrl,
      contentHash,
      retrievedAt: metadata.retrievedAt,
      acquisitionRunId: metadata.acquisitionRunId,
      artifactKind,
      taxonomyVersions,
      primaryNamespace,
    },
    contexts,
    units,
    facts,
    issues: {
      duplicateContextGroups,
      unknownUnitIds,
      unmappedConcepts,
      basisAmbiguity: hasBasisAmbiguity(facts),
      taxonomyAmbiguity: hasTaxonomyAmbiguity(facts),
      contextAmbiguity: duplicateContextGroups.length > 0,
      missingStatementRoles,
    },
  };
}
