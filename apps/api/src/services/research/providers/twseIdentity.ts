import { z } from "zod";
import {
  officialEtnContractIdentityKey,
  type OfficialIdentityInput,
} from "../identity.js";

const officialSecuritiesFirmRowSchema = z.object({
  證券代號: z.string().trim().min(1),
  "券商(證券IB)簡稱": z.string().trim().min(1),
  營利事業統一編號: z.string().trim().regex(/^\d{8}$/),
}).passthrough();

export type OfficialSecuritiesFirmDirectory = ReadonlyMap<string, {
  brokerCode: string;
  businessNumber: string;
}>;

const twseCompanyRowSchema = z.object({
  出表日期: z.string(),
  公司代號: z.string(),
  公司名稱: z.string(),
  公司簡稱: z.string(),
  產業別: z.string(),
  營利事業統一編號: z.string(),
  上市日期: z.string(),
  普通股每股面額: z.string().optional(),
  實收資本額: z.string().optional(),
  已發行普通股數或TDR原股發行股數: z.string().optional(),
}).passthrough();

const twseFundRowSchema = z.object({
  出表日期: z.string(),
  基金代號: z.string(),
  基金簡稱: z.string(),
  基金類型: z.string(),
  基金中文名稱: z.string(),
  基金統一編號: z.string(),
  上市日期: z.string(),
  "發行單位數/轉換數": z.string().optional(),
}).passthrough();

const twseEtnResponseSchema = z.object({
  stat: z.literal("ok"),
  fields: z.array(z.string()),
  data: z.array(z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
  ])),
}).passthrough();

const twseEtnRetirementResponseSchema = z.object({
  stat: z.literal("ok"),
  data: z.array(z.tuple([
    z.string(),
    z.string(),
    z.string(),
    z.string(),
    z.string(),
  ])),
}).passthrough();

const twseDelistingRowSchema = z.object({
  DelistingDate: z.string(),
  Company: z.string(),
  Code: z.string(),
}).passthrough();

interface SnapshotMetadata {
  retrievedAt: string;
  contentHash: string;
  sourceUrl: string;
}

const taiwanBusinessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function taiwanBusinessDate(retrievedAt: string): string {
  const instant = new Date(retrievedAt);
  if (Number.isNaN(instant.valueOf())) {
    throw new Error(`Invalid retrieval timestamp: ${retrievedAt}`);
  }
  const parts = Object.fromEntries(
    taiwanBusinessDateFormatter.formatToParts(instant).map(({ type, value }) => [type, value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function parseTaiwanOfficialDate(value: string): string {
  const compact = value.trim();
  const match = /^(?:(\d{3})(\d{2})(\d{2})|(\d{4})(\d{2})(\d{2}))$/.exec(compact);
  if (!match) throw new Error(`Unsupported Taiwan official date: ${value}`);
  const year = match[1] ? Number(match[1]) + 1911 : Number(match[4]);
  const month = Number(match[2] ?? match[5]);
  const day = Number(match[3] ?? match[6]);
  const normalized = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const parsed = new Date(`${normalized}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid Taiwan official date: ${value}`);
  }
  return normalized;
}

function normalizedNumber(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.replaceAll(",", "").trim();
}

function normalizedParValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /([0-9]+(?:\.[0-9]+)?)/.exec(value.replaceAll(",", ""))?.[1];
}

function normalizedText(value: string): string {
  return value.trim().replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_entity, hex: string | undefined, decimal: string | undefined) => {
    const codePoint = Number.parseInt(hex ?? decimal ?? "", hex ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : _entity;
  });
}

function securitiesFirmAlias(value: string): string {
  return normalizedText(value)
    .normalize("NFKC")
    .replaceAll(/\s+/g, "")
    .replace(/(?:綜合)?證券股份有限公司$/, "")
    .replace(/(?:綜合)?證券$/, "");
}

export function parseOfficialSecuritiesFirmDirectory(rows: unknown): OfficialSecuritiesFirmDirectory {
  const directory = new Map<string, { brokerCode: string; businessNumber: string }>();
  for (const row of z.array(officialSecuritiesFirmRowSchema).min(1).parse(rows)) {
    const alias = securitiesFirmAlias(row["券商(證券IB)簡稱"]);
    const identity = {
      brokerCode: row.證券代號.trim(),
      businessNumber: row.營利事業統一編號.trim(),
    };
    const existing = directory.get(alias);
    if (existing && existing.businessNumber !== identity.businessNumber) {
      throw new Error(`Ambiguous official securities-firm alias: ${alias}`);
    }
    directory.set(alias, identity);
  }
  return directory;
}

export function resolveOfficialEtnIssuerIdentity(
  legalName: string,
  directory: OfficialSecuritiesFirmDirectory,
): { brokerCode: string; businessNumber: string } {
  const identity = directory.get(securitiesFirmAlias(legalName));
  if (!identity) throw new Error(`Unknown official ETN issuer: ${legalName}`);
  return identity;
}

export function parseTwseCompanyIdentitySnapshot(
  rows: unknown,
  metadata: SnapshotMetadata,
): OfficialIdentityInput[] {
  return z.array(twseCompanyRowSchema).parse(rows).map((row) => ({
    venue: "TWSE",
    snapshotDate: parseTaiwanOfficialDate(row.出表日期),
    retrievedAt: metadata.retrievedAt,
    artifact: {
      contentHash: metadata.contentHash,
      sourceUrl: metadata.sourceUrl,
    },
    rawValues: {
      legal_name: row.公司名稱,
      display_name: row.公司簡稱,
      unified_business_number: row.營利事業統一編號,
      industry_code: row.產業別,
      ticker: row.公司代號,
      listed_at: row.上市日期,
      ...(row.普通股每股面額 !== undefined ? { par_value: row.普通股每股面額 } : {}),
      ...(row.實收資本額 !== undefined ? { paid_in_capital: row.實收資本額 } : {}),
      ...(row.已發行普通股數或TDR原股發行股數 !== undefined
        ? { issued_shares: row.已發行普通股數或TDR原股發行股數 }
        : {}),
    },
    row: {
      kind: "company",
      ticker: row.公司代號,
      legalName: normalizedText(row.公司名稱),
      displayName: normalizedText(row.公司簡稱),
      unifiedBusinessNumber: row.營利事業統一編號.trim(),
      industryCode: row.產業別.trim(),
      listedAt: parseTaiwanOfficialDate(row.上市日期),
      ...(normalizedParValue(row.普通股每股面額) ? { parValue: normalizedParValue(row.普通股每股面額) } : {}),
      ...(normalizedNumber(row.實收資本額) ? { paidInCapital: normalizedNumber(row.實收資本額) } : {}),
      ...(normalizedNumber(row.已發行普通股數或TDR原股發行股數)
        ? { issuedShares: normalizedNumber(row.已發行普通股數或TDR原股發行股數) }
        : {}),
    },
  }));
}

export function parseTwseFundIdentitySnapshot(
  rows: unknown,
  metadata: SnapshotMetadata,
): OfficialIdentityInput[] {
  return z.array(twseFundRowSchema).min(1).parse(rows).map((row) => ({
    venue: "TWSE",
    snapshotDate: parseTaiwanOfficialDate(row.出表日期),
    retrievedAt: metadata.retrievedAt,
    artifact: {
      contentHash: metadata.contentHash,
      sourceUrl: metadata.sourceUrl,
    },
    rawValues: {
      legal_name: row.基金中文名稱,
      display_name: row.基金簡稱,
      unified_business_number: row.基金統一編號,
      fund_type: row.基金類型,
      ticker: row.基金代號,
      listed_at: row.上市日期,
      ...(row["發行單位數/轉換數"] !== undefined ? { issued_units: row["發行單位數/轉換數"] } : {}),
    },
    row: {
      kind: "fund",
      ticker: row.基金代號,
      legalName: normalizedText(row.基金中文名稱),
      displayName: normalizedText(row.基金簡稱),
      identityKey: row.基金統一編號.trim(),
      unifiedBusinessNumber: row.基金統一編號.trim(),
      fundType: row.基金類型.trim(),
      listedAt: parseTaiwanOfficialDate(row.上市日期),
      ...(normalizedNumber(row["發行單位數/轉換數"])
        ? { issuedUnits: normalizedNumber(row["發行單位數/轉換數"]) }
        : {}),
    },
  }));
}

export function parseTwseEtnIdentitySnapshot(
  response: unknown,
  metadata: SnapshotMetadata,
  securitiesFirms: OfficialSecuritiesFirmDirectory,
): OfficialIdentityInput[] {
  const parsed = twseEtnResponseSchema.parse(response);
  return parsed.data.map(([listedAt, ticker, displayName, issuerName, _underlyingIndex, maturityAt]) => {
    const normalizedListedAt = parseTaiwanOfficialDate(listedAt.replaceAll("/", ""));
    const normalizedMaturityAt = parseTaiwanOfficialDate(maturityAt.replaceAll("/", ""));
    const issuerIdentity = resolveOfficialEtnIssuerIdentity(issuerName, securitiesFirms);
    const identityKey = officialEtnContractIdentityKey({
      venue: "TWSE",
      issuerIdentityKey: issuerIdentity.businessNumber,
      officialProductCode: ticker,
      listedAt: normalizedListedAt,
      maturityAt: normalizedMaturityAt,
      noteType: "ETN",
    });
    return {
      venue: "TWSE",
      snapshotDate: taiwanBusinessDate(metadata.retrievedAt),
      retrievedAt: metadata.retrievedAt,
      artifact: {
        contentHash: metadata.contentHash,
        sourceUrl: metadata.sourceUrl,
      },
      rawValues: {
        legal_name: issuerName,
        display_name: displayName,
        note_type: "ETN",
        ticker,
        listed_at: listedAt,
        issuer_identity_key: issuerIdentity.businessNumber,
        official_product_identity: identityKey,
      },
      row: {
        kind: "etn" as const,
        ticker,
        legalName: normalizedText(issuerName),
        displayName: normalizedText(displayName),
        identityKey,
        issuerIdentityKey: issuerIdentity.businessNumber,
        noteType: "ETN",
        listedAt: normalizedListedAt,
      },
    };
  });
}

export function parseTwseEtnRetirementSnapshot(response: unknown) {
  const parsed = twseEtnRetirementResponseSchema.parse(response);
  return parsed.data.map(([inactiveAt, ticker, displayName, issuerName]) => ({
    ticker,
    displayName: normalizedText(displayName),
    issuerName: normalizedText(issuerName),
    inactiveAt: parseTaiwanOfficialDate(inactiveAt.replaceAll("/", "")),
  }));
}

export function parseTwseDelistingSnapshot(rows: unknown) {
  return z.array(twseDelistingRowSchema).parse(rows).map((row) => ({
    ticker: row.Code,
    companyName: row.Company.trim(),
    inactiveAt: parseTaiwanOfficialDate(row.DelistingDate.replaceAll("/", "")),
  }));
}
