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
