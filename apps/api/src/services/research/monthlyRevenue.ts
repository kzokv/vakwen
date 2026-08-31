import { createHash } from "node:crypto";

export type ResearchRevenueListingVenue = "TWSE" | "TPEX";

export type MonthlyRevenueDeclaredUnit = "TWD_THOUSANDS" | "UNKNOWN";
export type MonthlyRevenueBasis = "consolidated" | "individual" | "unknown";
export type MonthlyRevenueQualifier = "estimated" | "final" | "unknown";

export interface OfficialMonthlyRevenueInput {
  venue: ResearchRevenueListingVenue;
  listingId: string;
  issuerId: string;
  ticker: string;
  companyName: string;
  industryName: string;
  revenueMonth: string;
  rawRevenueMonth: string;
  publishedAt: string;
  rawPublishedAt: string;
  retrievedAt: string;
  acquisitionRunId?: string;
  artifact: {
    contentHash: string;
    sourceUrl: string;
    publisherDataset: "t187ap05_L" | "mopsfin_t187ap05_O";
    accessProvider: "TWSE_OPENAPI" | "TPEX_OPENAPI";
  };
  source: {
    currentMonthRevenue: string;
    priorMonthRevenue: string;
    priorYearSameMonthRevenue: string;
    monthOverMonthPercent: string;
    yearOverYearPercent: string;
    currentYearToDateRevenue: string;
    priorYearToDateRevenue: string;
    yearToDateYearOverYearPercent: string;
    note: string;
  };
}

export interface ResearchMonthlyRevenueRecord {
  listingId: string;
  issuerId: string;
  ticker: string;
  venue: ResearchRevenueListingVenue;
  revenueMonth: string;
  rawRevenueMonth: string;
  publicationContext: {
    publishedAt: string;
    rawPublishedAt: string;
    declaredUnit: MonthlyRevenueDeclaredUnit;
    basis: MonthlyRevenueBasis;
    qualifier: MonthlyRevenueQualifier;
  };
  sourceFacts: {
    companyName: string;
    industryName: string;
    currentMonthRevenue: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
    priorMonthRevenue: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
    priorYearSameMonthRevenue: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
    publisherComparisons: {
      monthOverMonthPercent: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
      yearOverYearPercent: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
      currentYearToDateRevenue: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
      priorYearToDateRevenue: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
      yearToDateYearOverYearPercent: { raw: string; normalized: { state: "present"; value: string } | { state: "missing"; reason: "unparseable" } };
    };
    note: string | null;
  };
  basisChange: {
    state: "present" | "absent";
    reasonCode: "merged_entity_change" | "comparative_restatement" | "scope_change" | null;
  };
  provenance: {
    id: string;
    publisher: ResearchRevenueListingVenue;
    accessProvider: "TWSE_OPENAPI" | "TPEX_OPENAPI";
    authorityRole: "authoritative";
    canonicalDatasetId: "monthly_revenue";
    publisherDataset: "t187ap05_L" | "mopsfin_t187ap05_O";
    sourceUrl: string;
    contentHash: string;
    acquisitionPath: "scheduled_official_snapshot";
    acquisitionRunId: string;
    retrievedAt: string;
    parserVersion: "monthly-revenue-parser/1.0.0";
    usagePolicyVersion: "taiwan-open-data/1.0.0";
    retentionStatus: "retained";
    contentExposure: "allowed";
  };
}

export interface ResearchMonthlyRevenueRecordQuery {
  subject:
    | { kind: "listing_id"; listingId: string }
    | { kind: "ticker_venue"; ticker: string; venue: ResearchRevenueListingVenue };
  effectiveAt: string;
  knowledgeAt: string;
  startMonth?: string;
  endMonth?: string;
}

export function researchMonthlyRevenueRecordKey(record: ResearchMonthlyRevenueRecord): string {
  return `${record.provenance.id}:${record.listingId}:${record.revenueMonth}`;
}

export function researchMonthlyRevenueRecordSortOrder(
  left: ResearchMonthlyRevenueRecord,
  right: ResearchMonthlyRevenueRecord,
): number {
  const monthOrder = left.revenueMonth.localeCompare(right.revenueMonth);
  if (monthOrder !== 0) return monthOrder;
  const retrievedOrder = left.provenance.retrievedAt.localeCompare(right.provenance.retrievedAt);
  return retrievedOrder !== 0
    ? retrievedOrder
    : researchMonthlyRevenueRecordKey(left).localeCompare(researchMonthlyRevenueRecordKey(right));
}

function normalizeText(value: string): string {
  const normalized = value.trim().replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex: string | undefined, decimal: string | undefined) => {
    const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
  return normalized === "-" ? "" : normalized;
}

function normalizedNumericField(value: string) {
  const normalized = value.replaceAll(",", "").trim();
  if (normalized === "" || normalized === "-") {
    return { raw: value, normalized: { state: "missing" as const, reason: "unparseable" as const } };
  }
  if (!/^-?\d+(?:\.\d+)?$/.test(normalized)) {
    return { raw: value, normalized: { state: "missing" as const, reason: "unparseable" as const } };
  }
  return { raw: value, normalized: { state: "present" as const, value: normalized } };
}

function detectBasis(note: string): MonthlyRevenueBasis {
  if (/個別/.test(note)) return "individual";
  if (/合併|併入|新增合併個體|合併數/.test(note)) return "consolidated";
  return "consolidated";
}

function detectQualifier(note: string): MonthlyRevenueQualifier {
  if (/自結|初步自行結算|未經會計師|自行結算/.test(note)) return "estimated";
  return "final";
}

function detectBasisChange(note: string) {
  if (/新增合併個體|併入|收購|合併子公司|共同控制下組織重整/.test(note)) {
    return { state: "present" as const, reasonCode: "merged_entity_change" as const };
  }
  if (/重編去年比較期|更正.+財報|視為自始取得/.test(note)) {
    return { state: "present" as const, reasonCode: "comparative_restatement" as const };
  }
  if (/轉型|新增業務|結束.+營運|營運結構/.test(note)) {
    return { state: "present" as const, reasonCode: "scope_change" as const };
  }
  return { state: "absent" as const, reasonCode: null };
}

export function parseTaiwanOfficialMonth(value: string): string {
  const normalized = value.trim();
  const match = /^(\d{3}|\d{4})(\d{2})$/.exec(normalized);
  if (!match) throw new Error(`Unsupported Taiwan official month: ${value}`);
  const year = match[1]!.length === 3 ? Number(match[1]) + 1911 : Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Invalid Taiwan official month: ${value}`);
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function revenueMonthEndTimestamp(month: string): string {
  const [yearPart, monthPart] = month.split("-");
  const year = Number(yearPart);
  const monthIndex = Number(monthPart);
  const lastDay = new Date(Date.UTC(year, monthIndex, 0)).getUTCDate();
  return `${month}-${String(lastDay).padStart(2, "0")}T15:59:59.999Z`;
}

export function firstMonthForTrailingWindow(endMonth: string, months: number): string {
  const [yearPart, monthPart] = endMonth.split("-");
  const endIndex = (Number(yearPart) * 12) + Number(monthPart) - 1;
  const startIndex = endIndex - (months - 1);
  const year = Math.floor(startIndex / 12);
  const month = (startIndex % 12) + 1;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`;
}

export function canonicalizeOfficialMonthlyRevenueRow(
  input: OfficialMonthlyRevenueInput,
): ResearchMonthlyRevenueRecord {
  const note = normalizeText(input.source.note);
  const provenanceId = createHash("sha256")
    .update([
      input.venue,
      input.artifact.publisherDataset,
      input.artifact.contentHash,
      input.ticker,
      input.revenueMonth,
      input.retrievedAt,
    ].join("\u001f"))
    .digest("hex")
    .slice(0, 32);
  return {
    listingId: input.listingId,
    issuerId: input.issuerId,
    ticker: input.ticker,
    venue: input.venue,
    revenueMonth: input.revenueMonth,
    rawRevenueMonth: input.rawRevenueMonth,
    publicationContext: {
      publishedAt: input.publishedAt,
      rawPublishedAt: input.rawPublishedAt,
      declaredUnit: "TWD_THOUSANDS",
      basis: detectBasis(note),
      qualifier: detectQualifier(note),
    },
    sourceFacts: {
      companyName: normalizeText(input.companyName),
      industryName: normalizeText(input.industryName),
      currentMonthRevenue: normalizedNumericField(input.source.currentMonthRevenue),
      priorMonthRevenue: normalizedNumericField(input.source.priorMonthRevenue),
      priorYearSameMonthRevenue: normalizedNumericField(input.source.priorYearSameMonthRevenue),
      publisherComparisons: {
        monthOverMonthPercent: normalizedNumericField(input.source.monthOverMonthPercent),
        yearOverYearPercent: normalizedNumericField(input.source.yearOverYearPercent),
        currentYearToDateRevenue: normalizedNumericField(input.source.currentYearToDateRevenue),
        priorYearToDateRevenue: normalizedNumericField(input.source.priorYearToDateRevenue),
        yearToDateYearOverYearPercent: normalizedNumericField(input.source.yearToDateYearOverYearPercent),
      },
      note: note === "" ? null : note,
    },
    basisChange: detectBasisChange(note),
    provenance: {
      id: `prv_${provenanceId}`,
      publisher: input.venue,
      accessProvider: input.artifact.accessProvider,
      authorityRole: "authoritative",
      canonicalDatasetId: "monthly_revenue",
      publisherDataset: input.artifact.publisherDataset,
      sourceUrl: input.artifact.sourceUrl,
      contentHash: input.artifact.contentHash,
      acquisitionPath: "scheduled_official_snapshot",
      acquisitionRunId: input.acquisitionRunId ?? "manual-monthly-revenue",
      retrievedAt: input.retrievedAt,
      parserVersion: "monthly-revenue-parser/1.0.0",
      usagePolicyVersion: "taiwan-open-data/1.0.0",
      retentionStatus: "retained",
      contentExposure: "allowed",
    },
  };
}

export function resolveLatestMonthlyRevenueRecords(
  records: readonly ResearchMonthlyRevenueRecord[],
): ResearchMonthlyRevenueRecord[] {
  const latestByMonth = new Map<string, ResearchMonthlyRevenueRecord>();
  for (const record of [...records].sort(researchMonthlyRevenueRecordSortOrder)) {
    latestByMonth.set(record.revenueMonth, record);
  }
  return [...latestByMonth.values()].sort(researchMonthlyRevenueRecordSortOrder);
}
