import { createHash } from "node:crypto";
import {
  applyResearchFinancialStatementInlineFormat,
  applyResearchFinancialStatementTransform,
} from "../financialStatements.js";

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
  expectedEntityIdentifiers: string[];
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
  inlineType: "nonFraction" | "nonNumeric" | null;
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
  precision: string | null;
  scale: string | null;
  sign: string | null;
  format: string | null;
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
  for (const match of fragment.matchAll(/([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    attributes[match[1]] = match[2] ?? match[3] ?? "";
  }
  return attributes;
}

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(?:(\d+)|x([0-9a-f]+));/gi, (entity, decimal: string | undefined, hexadecimal: string | undefined) => {
      const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal ? 16 : 10);
      return Number.isInteger(codePoint)
        && codePoint >= 0
        && codePoint <= 0x10ffff
        && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
        ? String.fromCodePoint(codePoint)
        : entity;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFactValue(
  rawValue: string,
  sign: string | null,
  scale: string | null,
  format: string | null,
): string {
  return applyResearchFinancialStatementTransform(
    applyResearchFinancialStatementInlineFormat(stripMarkup(rawValue), format),
    scale,
    sign,
  );
}

function detectArtifactKind(content: string, declaredKind: MopsArtifactKind | undefined): MopsArtifactKind {
  if (declaredKind) return declaredKind;
  return /<ix:(?:nonFraction|nonNumeric)\b/i.test(content) || /<html\b/i.test(content)
    ? "ixbrl"
    : "xbrl";
}

function namespaceMapWithDeclarations(
  inherited: Readonly<Record<string, string>>,
  attributes: Readonly<Record<string, string>>,
): Record<string, string> {
  const namespaceMap = { ...inherited };
  for (const [attributeName, value] of Object.entries(attributes)) {
    if (attributeName === "xmlns") {
      namespaceMap[""] = value;
    } else if (attributeName.startsWith("xmlns:")) {
      namespaceMap[attributeName.slice(6)] = value;
    }
  }
  return namespaceMap;
}

function namespaceMapsAtElementOffsets(
  content: string,
  elements: readonly { offset: number; attributes: Readonly<Record<string, string>> }[],
): Map<number, Record<string, string>> {
  const results = new Map<number, Record<string, string>>();
  const ordered = [...elements].sort((left, right) => left.offset - right.offset);
  const openElements: Array<{ name: string; parentNamespaces: Record<string, string> }> = [];
  const voidHtmlElements = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
  ]);
  let activeNamespaces: Record<string, string> = {};
  const tagPattern = /<\/?([A-Za-z_][\w:.-]*)\b([^>]*)>/g;
  let pendingTag = tagPattern.exec(content);

  for (const element of ordered) {
    while (pendingTag && pendingTag.index < element.offset) {
      const fullTag = pendingTag[0];
      const name = (pendingTag[1] ?? "").toLowerCase();
      if (fullTag.startsWith("</")) {
        for (let index = openElements.length - 1; index >= 0; index -= 1) {
          if (openElements[index]?.name !== name) continue;
          activeNamespaces = openElements[index]?.parentNamespaces ?? {};
          openElements.length = index;
          break;
        }
      } else {
        const attributes = parseAttributes(pendingTag[2] ?? "");
        const elementNamespaces = namespaceMapWithDeclarations(activeNamespaces, attributes);
        const selfClosing = /\/\s*>$/.test(fullTag) || voidHtmlElements.has(name);
        if (!selfClosing) {
          openElements.push({ name, parentNamespaces: activeNamespaces });
          activeNamespaces = elementNamespaces;
        }
      }
      pendingTag = tagPattern.exec(content);
    }
    results.set(element.offset, namespaceMapWithDeclarations(activeNamespaces, element.attributes));
  }
  return results;
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

function canonicalMeasureQName(measure: string, namespaceMap: Readonly<Record<string, string>>): string {
  const separator = measure.indexOf(":");
  const prefix = separator >= 0 ? measure.slice(0, separator) : "";
  const localName = separator >= 0 ? measure.slice(separator + 1) : measure;
  const namespaceUri = namespaceMap[prefix];
  return namespaceUri ? `{${namespaceUri}}${localName}` : measure;
}

function extractUnits(content: string): MopsUnitRecord[] {
  type MeasureCandidate = {
    offset: number;
    attributes: Record<string, string>;
    value: string;
    location: "numerator" | "denominator" | "measure";
  };
  const pendingUnits: Array<{ id: string; measures: MeasureCandidate[] }> = [];
  const allMeasures: MeasureCandidate[] = [];
  for (const match of content.matchAll(/<(?:\w+:)?unit\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?unit>/g)) {
    const attributes = parseAttributes(match[1] ?? "");
    const body = match[2] ?? "";
    const bodyOffset = match.index + match[0].indexOf(body);
    const ranges = (elementName: "unitNumerator" | "unitDenominator") => [
      ...body.matchAll(new RegExp(`<(?:\\w+:)?${elementName}\\b[\\s\\S]*?<\\/(?:\\w+:)?${elementName}>`, "g")),
    ].map((item) => ({ start: item.index, end: item.index + item[0].length }));
    const numeratorRanges = ranges("unitNumerator");
    const denominatorRanges = ranges("unitDenominator");
    const measures = [...body.matchAll(/<(?:\w+:)?measure\b([^>]*)>([^<]+)<\/(?:\w+:)?measure>/g)]
      .map((item): MeasureCandidate => {
        const relativeOffset = item.index;
        const location = numeratorRanges.some((range) => relativeOffset >= range.start && relativeOffset < range.end)
          ? "numerator"
          : denominatorRanges.some((range) => relativeOffset >= range.start && relativeOffset < range.end)
            ? "denominator"
            : "measure";
        return {
          offset: bodyOffset + relativeOffset,
          attributes: parseAttributes(item[1] ?? ""),
          value: stripMarkup(item[2] ?? ""),
          location,
        };
      });
    allMeasures.push(...measures);
    pendingUnits.push({ id: attributes.id ?? `unit_${pendingUnits.length + 1}`, measures });
  }
  const namespaceMaps = namespaceMapsAtElementOffsets(content, allMeasures);
  const canonical = (measure: MeasureCandidate) => canonicalMeasureQName(
    measure.value,
    namespaceMaps.get(measure.offset) ?? {},
  );
  return pendingUnits.map((unit) => ({
    id: unit.id,
    measures: unit.measures.map(canonical),
    numeratorMeasures: unit.measures.filter((measure) => measure.location === "numerator").map(canonical),
    denominatorMeasures: unit.measures.filter((measure) => measure.location === "denominator").map(canonical),
  }));
}

function statementRoleForConcept(
  localName: string,
  namespaceUri: string | null,
  context: MopsContextRecord | undefined,
): MopsStatementRole {
  const knownRole = KNOWN_STATEMENT_ROLE_BY_CONCEPT.get(localName);
  if (knownRole) return knownRole;
  if (namespaceUri && /^https?:\/\/xbrl\.ifrs\.org\/taxonomy\/.+\/ifrs-full\/?$/i.test(namespaceUri)) {
    if (context?.periodType === "instant") return "balance_sheet";
    if (context?.periodType === "duration") {
      if (/Equity|ShareCapital|TreasuryShares|DistributionsToOwners|TransactionsWithOwners/i.test(localName)) {
        return "equity_statement";
      }
      if (
        /(?:Net)?CashFlows?(?:From|UsedIn)|AdjustmentsFor|ReconcileProfitLoss|IncreaseDecreaseIn|ClassifiedAs(?:Operating|Investing|Financing)Activities|ProceedsFrom|Payments(?:To|For)|PurchaseOf|AcquisitionOf|DisposalOf/i
          .test(localName)
      ) {
        return "cash_flow_statement";
      }
      return "income_statement";
    }
  }
  return "unknown";
}

function buildFactRecord(
  qname: string,
  attributes: Record<string, string>,
  innerValue: string,
  namespaceMap: Record<string, string>,
  contextsById: ReadonlyMap<string, MopsContextRecord>,
  inlineType: MopsFactRecord["inlineType"] = null,
): MopsFactRecord | null {
  const [prefix, localName] = qname.includes(":") ? qname.split(":", 2) : ["", qname];
  if (CORE_PREFIXES.has(prefix)) return null;
  const contextRef = attributes.contextRef;
  if (!contextRef) return null;
  const context = contextsById.get(contextRef);
  if (!context) {
    throw new Error(`MOPS XBRL fact ${qname} references unknown context ${contextRef}`);
  }
  const rawValue = stripMarkup(innerValue);
  return {
    id: `fact_${createHash("sha256").update([qname, contextRef, attributes.unitRef ?? "", rawValue].join("\u001f")).digest("hex").slice(0, 24)}`,
    inlineType,
    statementRole: inlineType === "nonNumeric"
      ? "notes"
      : statementRoleForConcept(localName, namespaceMap[prefix] ?? null, context),
    concept: {
      qname,
      prefix,
      localName,
      namespaceUri: namespaceMap[prefix] ?? null,
    },
    contextRef,
    unitRef: attributes.unitRef ?? null,
    decimals: attributes.decimals ?? null,
    precision: attributes.precision ?? null,
    scale: attributes.scale ?? null,
    sign: attributes.sign ?? null,
    format: attributes.format ?? null,
    rawValue,
    normalizedValue: inlineType === "nonNumeric"
      ? rawValue
      : normalizeFactValue(
          rawValue,
          attributes.sign ?? null,
          attributes.scale ?? null,
          attributes.format ?? null,
        ),
    periodEnd: context.endDate ?? context.instant ?? null,
    periodStart: context.startDate,
    contextDimensions: context.dimensions,
  };
}

function withoutInlineExcludedContent(value: string): string {
  return value.replace(/<ix:exclude\b[^>]*>[\s\S]*?<\/ix:exclude>/gi, " ");
}

function inlineFactValue(
  innerValue: string,
  continuedAt: string | undefined,
  continuationsById: ReadonlyMap<string, { body: string; continuedAt?: string }>,
): string {
  const parts = [withoutInlineExcludedContent(innerValue)];
  const visited = new Set<string>();
  let continuationId = continuedAt;
  while (continuationId) {
    if (visited.has(continuationId)) {
      throw new Error(`MOPS iXBRL continuation cycle at ${continuationId}`);
    }
    visited.add(continuationId);
    const continuation = continuationsById.get(continuationId);
    if (!continuation) {
      throw new Error(`MOPS iXBRL continuation ${continuationId} was not found`);
    }
    parts.push(withoutInlineExcludedContent(continuation.body));
    continuationId = continuation.continuedAt;
  }
  return parts.join(" ");
}

function extractInlineFacts(
  content: string,
  contextsById: ReadonlyMap<string, MopsContextRecord>,
): MopsFactRecord[] {
  const candidates: Array<{
    offset: number;
    inlineType: "nonFraction" | "nonNumeric";
    qname: string;
    attributes: Record<string, string>;
    value: string;
  }> = [];
  const continuationsById = new Map<string, { body: string; continuedAt?: string }>();
  for (const match of content.matchAll(/<ix:continuation\b([^>]*)>([\s\S]*?)<\/ix:continuation>/gi)) {
    const attributes = parseAttributes(match[1] ?? "");
    if (!attributes.id) continue;
    continuationsById.set(attributes.id, {
      body: match[2] ?? "",
      ...(attributes.continuedAt ? { continuedAt: attributes.continuedAt } : {}),
    });
  }
  for (const match of content.matchAll(/<ix:(nonFraction|nonNumeric)\b([^>]*?)(?<!\/)>([\s\S]*?)<\/ix:\1>/gi)) {
    const inlineType = match[1] as "nonFraction" | "nonNumeric";
    const attributes = parseAttributes(match[2] ?? "");
    const qname = attributes.name;
    if (!qname) continue;
    const value = inlineFactValue(match[3] ?? "", attributes.continuedAt, continuationsById);
    candidates.push({ offset: match.index, inlineType, qname, attributes, value });
  }
  for (const match of content.matchAll(/<ix:(nonFraction|nonNumeric)\b([^>]*)\/>/gi)) {
    const inlineType = match[1] as "nonFraction" | "nonNumeric";
    const attributes = parseAttributes(match[2] ?? "");
    const qname = attributes.name;
    if (!qname) continue;
    const value = inlineFactValue("", attributes.continuedAt, continuationsById);
    candidates.push({ offset: match.index, inlineType, qname, attributes, value });
  }
  candidates.sort((left, right) => left.offset - right.offset);
  const namespaceMaps = namespaceMapsAtElementOffsets(content, candidates);
  const facts = candidates.flatMap((candidate) => {
    const fact = buildFactRecord(
      candidate.qname,
      candidate.attributes,
      candidate.value,
      namespaceMaps.get(candidate.offset) ?? {},
      contextsById,
      candidate.inlineType,
    );
    return fact ? [fact] : [];
  });
  return facts;
}

function extractXbrlFacts(
  content: string,
  contextsById: ReadonlyMap<string, MopsContextRecord>,
): MopsFactRecord[] {
  const candidates: Array<{
    offset: number;
    qname: string;
    attributes: Record<string, string>;
    value: string;
  }> = [];
  for (const match of content.matchAll(/<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b([^>]*)>([^<]*)<\/\1>/g)) {
    const attributes = parseAttributes(match[2] ?? "");
    if (!attributes.contextRef) continue;
    candidates.push({ offset: match.index, qname: match[1] ?? "", attributes, value: match[3] ?? "" });
  }
  for (const match of content.matchAll(/<([A-Za-z_][\w.-]*(?::[A-Za-z_][\w.-]*)?)\b([^>]*)\/>/g)) {
    const attributes = parseAttributes(match[2] ?? "");
    if (!attributes.contextRef) continue;
    candidates.push({ offset: match.index, qname: match[1] ?? "", attributes, value: "" });
  }
  candidates.sort((left, right) => left.offset - right.offset);
  const namespaceMaps = namespaceMapsAtElementOffsets(content, candidates);
  const facts = candidates.flatMap((candidate) => {
    const fact = buildFactRecord(
      candidate.qname,
      candidate.attributes,
      candidate.value,
      namespaceMaps.get(candidate.offset) ?? {},
      contextsById,
    );
    return fact ? [fact] : [];
  });
  return facts;
}

function taxonomyVersionsForFacts(
  facts: readonly MopsFactRecord[],
): string[] {
  const candidates = new Set<string>();
  for (const fact of facts) {
    if (fact.concept.namespaceUri) {
      const versionMatch = /\b(20\d{2}(?:[-/](?:Q?[1-4]|0[1-9]|1[0-2])(?:[-/](?:0[1-9]|[12]\d|3[01]))?)?)\b/.exec(fact.concept.namespaceUri);
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
  const contexts = extractContexts(content);
  const units = extractUnits(content);
  const contextsById = new Map(contexts.map((context) => [context.id, context] as const));
  const facts = artifactKind === "ixbrl"
    ? extractInlineFacts(content, contextsById)
    : extractXbrlFacts(content, contextsById);
  const unitsById = new Map(units.map((unit) => [unit.id, unit] as const));
  const contextIdsBySignature = new Map<string, string[]>();
  for (const context of contexts) {
    const contextIds = contextIdsBySignature.get(context.signature) ?? [];
    contextIds.push(context.id);
    contextIdsBySignature.set(context.signature, contextIds);
  }
  const duplicateContextGroups = [...contextIdsBySignature.entries()]
    .filter(([, contextIds]) => contextIds.length > 1)
    .map(([signature, contextIds]) => ({ signature, contextIds }));
  const unknownUnitIds = [...new Set(facts
    .filter((fact) => fact.inlineType !== "nonNumeric")
    .map((fact) => fact.unitRef ?? "<missing>")
    .filter((unitRef) => unitRef === "<missing>" || !unitsById.has(unitRef)))].sort();
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
