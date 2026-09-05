import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "../market-data/registerBackfillWorker.js";
import {
  OFFICIAL_FINANCIAL_STATEMENT_BASE_URL,
  runOfficialFinancialStatementAcquisition,
} from "./acquisition.js";
import type { ResearchIdentityRecord } from "./identity.js";
import type { MopsFinancialStatementDescriptor } from "./providers/mopsXbrl.js";

export const RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE = "research-financial-statement-acquisition";
// One singleton run may cover roughly 1,000 listings x 11 filings x two filing bases
// at four-way concurrency. Twelve hours leaves about eight seconds per remote artifact,
// including parse and persistence work.
export const RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_EXPIRE_SECONDS = 12 * 60 * 60;
// 17:30 UTC daily is 01:30 in Taiwan, after the usual nightly MOPS refresh window.
export const RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_CRON = "30 17 * * *";

interface ResearchFinancialStatementAcquisitionWorkerDeps {
  persistence: Persistence;
  log: FastifyBaseLogger;
  resolveDescriptors: () => Promise<readonly MopsFinancialStatementDescriptor[]>;
}

function taiwanDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function latestDueFiling(localDate: string): {
  fiscalYear: number;
  fiscalPeriod: MopsFinancialStatementDescriptor["filing"]["fiscalPeriod"];
  periodEnd: string;
  season: number;
} {
  const year = Number(localDate.slice(0, 4));
  const monthDay = localDate.slice(5);
  if (monthDay > "11-14") {
    return { fiscalYear: year, fiscalPeriod: "q3", periodEnd: `${year}-09-30`, season: 3 };
  }
  if (monthDay > "08-14") {
    return { fiscalYear: year, fiscalPeriod: "q2", periodEnd: `${year}-06-30`, season: 2 };
  }
  if (monthDay > "05-15") {
    return { fiscalYear: year, fiscalPeriod: "q1", periodEnd: `${year}-03-31`, season: 1 };
  }
  if (monthDay > "03-31") {
    return { fiscalYear: year - 1, fiscalPeriod: "annual", periodEnd: `${year - 1}-12-31`, season: 4 };
  }
  return { fiscalYear: year - 1, fiscalPeriod: "q3", periodEnd: `${year - 1}-09-30`, season: 3 };
}

interface FilingTarget {
  fiscalYear: number;
  fiscalPeriod: MopsFinancialStatementDescriptor["filing"]["fiscalPeriod"];
  periodStart: string;
  periodEnd: string;
  season: number;
}

function quarterTarget(fiscalYear: number, quarter: 1 | 2 | 3 | 4): FilingTarget {
  const startMonth = ((quarter - 1) * 3) + 1;
  const endMonth = quarter * 3;
  const endDay = quarter === 1 || quarter === 4 ? 31 : 30;
  return {
    fiscalYear,
    fiscalPeriod: `q${quarter}` as FilingTarget["fiscalPeriod"],
    periodStart: `${fiscalYear}-${String(startMonth).padStart(2, "0")}-01`,
    periodEnd: `${fiscalYear}-${String(endMonth).padStart(2, "0")}-${endDay}`,
    season: quarter,
  };
}

function previousQuarter(target: FilingTarget): FilingTarget {
  const quarter = Number(target.fiscalPeriod.slice(1)) as 1 | 2 | 3 | 4;
  return quarter === 1
    ? quarterTarget(target.fiscalYear - 1, 4)
    : quarterTarget(target.fiscalYear, (quarter - 1) as 1 | 2 | 3 | 4);
}

function requiredFilingTargets(localDate: string): FilingTarget[] {
  const due = latestDueFiling(localDate);
  const year = Number(localDate.slice(0, 4));
  const monthDay = localDate.slice(5);
  const latestAnnualYear = monthDay > "03-31" ? year - 1 : year - 2;
  const latestQuarter = due.fiscalPeriod === "annual"
    ? quarterTarget(due.fiscalYear, 4)
    : quarterTarget(due.fiscalYear, Number(due.fiscalPeriod.slice(1)) as 1 | 2 | 3 | 4);
  const quarters: FilingTarget[] = [latestQuarter];
  while (quarters.length < 8) quarters.push(previousQuarter(quarters.at(-1)!));
  const annuals = Array.from({ length: 3 }, (_, index): FilingTarget => ({
    fiscalYear: latestAnnualYear - index,
    fiscalPeriod: "annual",
    periodStart: `${latestAnnualYear - index}-01-01`,
    periodEnd: `${latestAnnualYear - index}-12-31`,
    season: 4,
  }));
  return [...annuals, ...quarters];
}

export function buildCurrentMopsFinancialStatementDescriptors(
  identities: readonly ResearchIdentityRecord[],
  now = new Date(),
): MopsFinancialStatementDescriptor[] {
  const observedOn = taiwanDate(now);
  const observedAt = now.toISOString();
  const targets = requiredFilingTargets(observedOn);
  return identities
    .filter((identity) => (
      identity.listing.status === "active"
      && identity.security.type === "common_equity"
      && identity.eligibility.profile === "operating_company"
    ))
    .flatMap((identity) => {
      const unifiedBusinessNumber = identity.observations.find((observation) => (
        observation.subject.kind === "issuer"
        && observation.subject.id === identity.issuer.id
        && observation.field === "unified_business_number"
        && observation.normalized.state === "present"
      ))?.normalized;
      if (!unifiedBusinessNumber || unifiedBusinessNumber.state !== "present") return [];
      return targets.flatMap((target) => ([
        { reportId: "C", filingBasis: "consolidated" as const },
        { reportId: "A", filingBasis: "individual" as const },
      ]).map(({ reportId, filingBasis }) => {
        const sourceUrl = new URL(OFFICIAL_FINANCIAL_STATEMENT_BASE_URL);
        sourceUrl.searchParams.set("functionName", "t164sb01");
        sourceUrl.searchParams.set("step", "9");
        sourceUrl.searchParams.set("co_id", identity.listing.ticker);
        sourceUrl.searchParams.set("year", String(target.fiscalYear - 1911));
        sourceUrl.searchParams.set("season", String(target.season));
        sourceUrl.searchParams.set("report_id", reportId);
        return {
          listingId: identity.listing.id,
          issuerId: identity.issuer.id,
          ticker: identity.listing.ticker,
          expectedEntityIdentifiers: [unifiedBusinessNumber.value],
          venue: identity.listing.venue,
          sector: identity.issuer.classification === "financial_institution"
            ? "financial_institution" as const
            : "operating_company" as const,
          sourceUrl: sourceUrl.toString(),
          filing: {
            filingId: `mops:${identity.listing.ticker}:${target.fiscalYear}:${target.fiscalPeriod}:${filingBasis}`,
            fiscalYear: target.fiscalYear,
            fiscalPeriod: target.fiscalPeriod,
            periodStart: target.periodStart,
            periodEnd: target.periodEnd,
            filingBasis,
            // The direct artifact endpoint does not expose a filing timestamp.
            // Preserve the exact first-observation instant rather than making the
            // artifact visible from the start of its Taiwan calendar date.
            publishedAt: observedAt,
            // The canonicalizer compares content hashes with stored revisions and
            // promotes changed artifacts to the next amendment revision.
            revision: 0,
            amendmentType: "unknown" as const,
          },
        };
      }));
    })
    .sort((left, right) => `${left.venue}:${left.ticker}:${left.filing.periodEnd}:${left.filing.fiscalPeriod}:${left.filing.filingBasis}`
      .localeCompare(`${right.venue}:${right.ticker}:${right.filing.periodEnd}:${right.filing.fiscalPeriod}:${right.filing.filingBasis}`));
}

export function createResearchFinancialStatementAcquisitionHandler(
  deps: ResearchFinancialStatementAcquisitionWorkerDeps,
) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    const job = jobs[0];
    const descriptors = await deps.resolveDescriptors();
    if (descriptors.length === 0) {
      deps.log.info({ descriptorCount: 0 }, "research_financial_statement_acquisition_skipped_no_descriptors");
      return;
    }
    const result = await runOfficialFinancialStatementAcquisition(deps.persistence, {
      descriptors,
      acquisitionRunId: job ? `pg-boss:${job.id}:financial-statements` : undefined,
    });
    deps.log.info({ ...result, descriptorCount: descriptors.length }, "research_financial_statement_acquisition_completed");
  };
}

export async function registerResearchFinancialStatementAcquisitionWorker(
  boss: PgBoss,
  deps: ResearchFinancialStatementAcquisitionWorkerDeps,
): Promise<void> {
  await boss.createQueue(RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE, {
    ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
    expireInSeconds: RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_EXPIRE_SECONDS,
    policy: "singleton",
  });
  await boss.work(
    RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createResearchFinancialStatementAcquisitionHandler(deps),
  );
  await boss.schedule(
    RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE,
    RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_CRON,
    {},
  );
}
