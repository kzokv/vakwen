import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "../market-data/registerBackfillWorker.js";
import { runOfficialIdentityAcquisition } from "./acquisition.js";

export const RESEARCH_IDENTITY_ACQUISITION_QUEUE = "research-identity-acquisition";
export const RESEARCH_IDENTITY_ACQUISITION_CRON = "15 18 * * 1-5";

interface ResearchIdentityAcquisitionWorkerDeps {
  persistence: Persistence;
  log: FastifyBaseLogger;
}

export function createResearchIdentityAcquisitionHandler(
  deps: ResearchIdentityAcquisitionWorkerDeps,
) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    const job = jobs[0];
    const result = await runOfficialIdentityAcquisition(deps.persistence, {
      acquisitionRunId: job ? `pg-boss:${job.id}` : undefined,
    });
    deps.log.info(result, "research_identity_acquisition_completed");
  };
}

export async function registerResearchIdentityAcquisitionWorker(
  boss: PgBoss,
  deps: ResearchIdentityAcquisitionWorkerDeps,
): Promise<void> {
  await boss.createQueue(RESEARCH_IDENTITY_ACQUISITION_QUEUE, {
    ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
    policy: "singleton",
  });
  await boss.work(
    RESEARCH_IDENTITY_ACQUISITION_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createResearchIdentityAcquisitionHandler(deps),
  );
  await boss.schedule(RESEARCH_IDENTITY_ACQUISITION_QUEUE, RESEARCH_IDENTITY_ACQUISITION_CRON, {});
  await boss.send(RESEARCH_IDENTITY_ACQUISITION_QUEUE, {}, {
    singletonKey: RESEARCH_IDENTITY_ACQUISITION_QUEUE,
  });
}
