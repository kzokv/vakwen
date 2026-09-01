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
  if (monthDay >= "11-14") {
    return { fiscalYear: year, fiscalPeriod: "q3", periodEnd: `${year}-09-30`, season: 3 };
  }
  if (monthDay >= "08-14") {
    return { fiscalYear: year, fiscalPeriod: "q2", periodEnd: `${year}-06-30`, season: 2 };
  }
  if (monthDay >= "05-15") {
    return { fiscalYear: year, fiscalPeriod: "q1", periodEnd: `${year}-03-31`, season: 1 };
  }
  if (monthDay >= "03-31") {
    return { fiscalYear: year - 1, fiscalPeriod: "annual", periodEnd: `${year - 1}-12-31`, season: 4 };
  }
  return { fiscalYear: year - 1, fiscalPeriod: "q3", periodEnd: `${year - 1}-09-30`, season: 3 };
}

export function buildCurrentMopsFinancialStatementDescriptors(
  identities: readonly ResearchIdentityRecord[],
  now = new Date(),
): MopsFinancialStatementDescriptor[] {
  const observedOn = taiwanDate(now);
  const due = latestDueFiling(observedOn);
  return identities
    .filter((identity) => (
      identity.listing.status === "active"
      && identity.security.type === "common_equity"
      && identity.eligibility.profile === "operating_company"
    ))
    .map((identity) => {
      const sourceUrl = new URL(OFFICIAL_FINANCIAL_STATEMENT_BASE_URL);
      sourceUrl.searchParams.set("step", "1");
      sourceUrl.searchParams.set("CO_ID", identity.listing.ticker);
      sourceUrl.searchParams.set("SYEAR", String(due.fiscalYear));
      sourceUrl.searchParams.set("SSEASON", String(due.season));
      sourceUrl.searchParams.set("REPORT_ID", "C");
      return {
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: identity.listing.ticker,
        venue: identity.listing.venue,
        sector: "operating_company" as const,
        sourceUrl: sourceUrl.toString(),
        filing: {
          filingId: `mops:${identity.listing.ticker}:${due.fiscalYear}:${due.fiscalPeriod}`,
          fiscalYear: due.fiscalYear,
          fiscalPeriod: due.fiscalPeriod,
          periodStart: `${due.fiscalYear}-01-01`,
          periodEnd: due.periodEnd,
          filingBasis: "unknown" as const,
          // The direct artifact endpoint does not expose a filing timestamp in
          // its URL contract. Use the first observation date conservatively;
          // never backdate it to the statutory due date.
          publishedAt: observedOn,
          revision: 0,
          amendmentType: "unknown" as const,
        },
      };
    })
    .sort((left, right) => `${left.venue}:${left.ticker}`.localeCompare(`${right.venue}:${right.ticker}`));
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
