import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "../market-data/registerBackfillWorker.js";
import {
  runOfficialFinancialStatementAcquisition,
} from "./acquisition.js";
import type { MopsFinancialStatementDescriptor } from "./providers/mopsXbrl.js";

export const RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_QUEUE = "research-financial-statement-acquisition";
// 17:30 UTC daily is 01:30 in Taiwan, after the usual nightly MOPS refresh window.
export const RESEARCH_FINANCIAL_STATEMENT_ACQUISITION_CRON = "30 17 * * *";

interface ResearchFinancialStatementAcquisitionWorkerDeps {
  persistence: Persistence;
  log: FastifyBaseLogger;
  resolveDescriptors: () => Promise<readonly MopsFinancialStatementDescriptor[]>;
}

export function createResearchFinancialStatementAcquisitionHandler(
  deps: ResearchFinancialStatementAcquisitionWorkerDeps,
) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    const job = jobs[0];
    const descriptors = await deps.resolveDescriptors();
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
