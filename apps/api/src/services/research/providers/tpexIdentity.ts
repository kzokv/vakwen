import { z } from "zod";
import type { OfficialIdentityInput } from "../identity.js";
import { parseTaiwanOfficialDate } from "./twseIdentity.js";

const tpexCompanyRowSchema = z.object({
  Date: z.string(),
  SecuritiesCompanyCode: z.string(),
  CompanyName: z.string(),
  CompanyAbbreviation: z.string(),
  SecuritiesIndustryCode: z.string(),
  "UnifiedBusinessNo.": z.string(),
  DateOfListing: z.string(),
  ParValueOfCommonStock: z.string().optional(),
  "Paidin.Capital.NTDollars": z.string().optional(),
  IssueShares: z.string().optional(),
}).passthrough();

const tpexFundRowSchema = z.object({
  issuerID: z.string(),
  listingDate: z.string(),
  stockName: z.string(),
  stockNo: z.string(),
}).passthrough();

const tpexFundResponseSchema = z.object({
  data: z.array(tpexFundRowSchema),
}).passthrough();

const tpexEtnResponseSchema = z.object({
  stat: z.literal("ok"),
  tables: z.array(z.object({
    data: z.array(z.tuple([
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
    ])),
  }).passthrough()).min(1),
}).passthrough();

const tpexDelistingResponseSchema = z.object({
  stat: z.literal("ok"),
  tables: z.array(z.object({
    data: z.array(z.tuple([
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
    ])),
  }).passthrough()).min(1),
}).passthrough();

const tpexEtnRetirementResponseSchema = z.object({
  stat: z.literal("ok"),
  tables: z.array(z.object({
    data: z.array(z.tuple([
      z.string(),
      z.string(),
      z.string(),
      z.string(),
      z.string(),
    ])),
  }).passthrough()).min(1),
}).passthrough();

interface SnapshotMetadata {
  retrievedAt: string;
  contentHash: string;
  sourceUrl: string;
}

function normalizedNumber(value: string | undefined): string | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  return value.replaceAll(",", "").trim();
}

function normalizedParValue(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return /([0-9]+(?:\.[0-9]+)?)/.exec(value.replaceAll(",", ""))?.[1];
}

export function parseTpexCompanyIdentitySnapshot(
  rows: unknown,
  metadata: SnapshotMetadata,
): OfficialIdentityInput[] {
  return z.array(tpexCompanyRowSchema).parse(rows).map((row) => ({
    venue: "TPEX",
    snapshotDate: parseTaiwanOfficialDate(row.Date),
    retrievedAt: metadata.retrievedAt,
    artifact: {
      contentHash: metadata.contentHash,
      sourceUrl: metadata.sourceUrl,
    },
    rawValues: {
      legal_name: row.CompanyName,
      display_name: row.CompanyAbbreviation,
      unified_business_number: row["UnifiedBusinessNo."],
      industry_code: row.SecuritiesIndustryCode,
      ticker: row.SecuritiesCompanyCode,
      listed_at: row.DateOfListing,
      ...(row.ParValueOfCommonStock !== undefined ? { par_value: row.ParValueOfCommonStock } : {}),
      ...(row["Paidin.Capital.NTDollars"] !== undefined
        ? { paid_in_capital: row["Paidin.Capital.NTDollars"] }
        : {}),
      ...(row.IssueShares !== undefined ? { issued_shares: row.IssueShares } : {}),
    },
    row: {
      kind: "company",
      ticker: row.SecuritiesCompanyCode,
      legalName: row.CompanyName.trim(),
      displayName: row.CompanyAbbreviation.trim(),
      unifiedBusinessNumber: row["UnifiedBusinessNo."].trim(),
      industryCode: row.SecuritiesIndustryCode.trim(),
      listedAt: parseTaiwanOfficialDate(row.DateOfListing),
      ...(normalizedParValue(row.ParValueOfCommonStock) ? { parValue: normalizedParValue(row.ParValueOfCommonStock) } : {}),
      ...(normalizedNumber(row["Paidin.Capital.NTDollars"])
        ? { paidInCapital: normalizedNumber(row["Paidin.Capital.NTDollars"]) }
        : {}),
      ...(normalizedNumber(row.IssueShares) ? { issuedShares: normalizedNumber(row.IssueShares) } : {}),
    },
  }));
}

export function parseTpexFundIdentitySnapshot(
  response: unknown,
  metadata: SnapshotMetadata,
): OfficialIdentityInput[] {
  const parsed = tpexFundResponseSchema.parse(response);
  return parsed.data.map((row) => {
    const listedAt = parseTaiwanOfficialDate(row.listingDate);
    return {
      venue: "TPEX",
      snapshotDate: metadata.retrievedAt.slice(0, 10),
      retrievedAt: metadata.retrievedAt,
      artifact: {
        contentHash: metadata.contentHash,
        sourceUrl: metadata.sourceUrl,
        publisherDataset: "etfFilter",
        accessProvider: "TPEX_WEB_JSON",
      },
      rawValues: {
        legal_name: row.stockName,
        display_name: row.stockName,
        fund_type: "ETF",
        ticker: row.stockNo,
        listed_at: row.listingDate,
      },
      row: {
        kind: "fund",
        ticker: row.stockNo,
        legalName: row.stockName.trim(),
        displayName: row.stockName.trim(),
        identityKey: `tpex-etf:${row.issuerID}:${row.stockNo}:${listedAt}`,
        fundType: "ETF",
        listedAt,
      },
    };
  });
}

export function parseTpexEtnIdentitySnapshot(
  response: unknown,
  metadata: SnapshotMetadata,
): OfficialIdentityInput[] {
  const parsed = tpexEtnResponseSchema.parse(response);
  return parsed.tables.flatMap((table) => table.data).map(([
    ticker,
    displayName,
    issuerName,
    _underlyingIndex,
    listedAt,
  ]) => ({
    venue: "TPEX",
    snapshotDate: metadata.retrievedAt.slice(0, 10),
    retrievedAt: metadata.retrievedAt,
    artifact: {
      contentHash: metadata.contentHash,
      sourceUrl: metadata.sourceUrl,
      publisherDataset: "ETN/list",
      accessProvider: "TPEX_WEB_JSON",
    },
    rawValues: {
      legal_name: issuerName,
      display_name: displayName,
      note_type: "ETN",
      ticker,
      listed_at: listedAt,
    },
    row: {
      kind: "etn",
      ticker,
      legalName: issuerName.trim(),
      displayName: displayName.trim(),
      noteType: "ETN",
      listedAt: parseTaiwanOfficialDate(listedAt.replaceAll("/", "")),
    },
  }));
}

export function parseTpexEtnRetirementSnapshot(response: unknown) {
  const parsed = tpexEtnRetirementResponseSchema.parse(response);
  return parsed.tables.flatMap((table) => table.data).map(([
    inactiveAt,
    ticker,
    displayName,
  ]) => ({
    ticker,
    displayName: displayName.trim(),
    inactiveAt: parseTaiwanOfficialDate(inactiveAt.replaceAll("/", "")),
  }));
}

export function parseTpexDelistingSnapshot(response: unknown) {
  const parsed = tpexDelistingResponseSchema.parse(response);
  return parsed.tables.flatMap((table) => table.data).map(([
    ticker,
    companyName,
    inactiveAt,
  ]) => ({
    ticker,
    companyName: companyName.trim(),
    inactiveAt: parseTaiwanOfficialDate(inactiveAt.replaceAll("-", "")),
  }));
}
