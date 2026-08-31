import { z } from "zod";
import {
  canonicalizeOfficialMonthlyRevenueRow,
  parseTaiwanOfficialMonth,
  type OfficialMonthlyRevenueInput,
  type ResearchRevenueListingVenue,
} from "../monthlyRevenue.js";
import { parseTaiwanOfficialDate } from "./twseIdentity.js";

const monthlyRevenueRowSchema = z.object({
  出表日期: z.string(),
  資料年月: z.string(),
  公司代號: z.string(),
  公司名稱: z.string(),
  產業別: z.string(),
  "營業收入-當月營收": z.string(),
  "營業收入-上月營收": z.string(),
  "營業收入-去年當月營收": z.string(),
  "營業收入-上月比較增減(%)": z.string(),
  "營業收入-去年同月增減(%)": z.string(),
  "累計營業收入-當月累計營收": z.string(),
  "累計營業收入-去年累計營收": z.string(),
  "累計營業收入-前期比較增減(%)": z.string(),
  備註: z.string().optional(),
}).passthrough();

interface SnapshotMetadata {
  retrievedAt: string;
  contentHash: string;
  sourceUrl: string;
}

export interface RevenueIdentityLookup {
  listingId: string;
  issuerId: string;
  listedAt: string;
  inactiveAt?: string;
  companyNames: readonly string[];
}

function normalizedCompanyName(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function resolveRevenueIdentity(
  candidates: readonly RevenueIdentityLookup[],
  revenueMonth: string,
  companyName: string,
): RevenueIdentityLookup | undefined {
  const applicable = candidates.filter((candidate) =>
    candidate.listedAt.slice(0, 7) <= revenueMonth
      && (candidate.inactiveAt === undefined || revenueMonth <= candidate.inactiveAt.slice(0, 7))
  );
  if (applicable.length <= 1) return applicable[0];

  const normalizedRowName = normalizedCompanyName(companyName);
  const nameMatches = applicable.filter((candidate) =>
    candidate.companyNames.some((name) => normalizedCompanyName(name) === normalizedRowName)
  );
  return nameMatches.length === 1 ? nameMatches[0] : undefined;
}

export function parseOfficialMonthlyRevenueSnapshot(
  rows: unknown,
  metadata: SnapshotMetadata,
  venue: ResearchRevenueListingVenue,
  identitiesByTicker: ReadonlyMap<string, readonly RevenueIdentityLookup[]>,
): ReturnType<typeof canonicalizeOfficialMonthlyRevenueRow>[] {
  const publisherDataset = venue === "TWSE" ? "t187ap05_L" : "mopsfin_t187ap05_O";
  const accessProvider = venue === "TWSE" ? "TWSE_OPENAPI" : "TPEX_OPENAPI";
  return z.array(monthlyRevenueRowSchema).parse(rows).flatMap((row) => {
    const revenueMonth = parseTaiwanOfficialMonth(row.資料年月);
    const identity = resolveRevenueIdentity(
      identitiesByTicker.get(row.公司代號.trim()) ?? [],
      revenueMonth,
      row.公司名稱,
    );
    if (!identity) return [];
    const input: OfficialMonthlyRevenueInput = {
      venue,
      listingId: identity.listingId,
      issuerId: identity.issuerId,
      ticker: row.公司代號.trim(),
      companyName: row.公司名稱,
      industryName: row.產業別,
      revenueMonth,
      rawRevenueMonth: row.資料年月.trim(),
      publishedAt: parseTaiwanOfficialDate(row.出表日期),
      rawPublishedAt: row.出表日期.trim(),
      retrievedAt: metadata.retrievedAt,
      artifact: {
        contentHash: metadata.contentHash,
        sourceUrl: metadata.sourceUrl,
        publisherDataset,
        accessProvider,
      },
      source: {
        currentMonthRevenue: row["營業收入-當月營收"],
        priorMonthRevenue: row["營業收入-上月營收"],
        priorYearSameMonthRevenue: row["營業收入-去年當月營收"],
        monthOverMonthPercent: row["營業收入-上月比較增減(%)"],
        yearOverYearPercent: row["營業收入-去年同月增減(%)"],
        currentYearToDateRevenue: row["累計營業收入-當月累計營收"],
        priorYearToDateRevenue: row["累計營業收入-去年累計營收"],
        yearToDateYearOverYearPercent: row["累計營業收入-前期比較增減(%)"],
        note: row.備註 ?? "",
      },
    };
    return [canonicalizeOfficialMonthlyRevenueRow(input)];
  });
}
