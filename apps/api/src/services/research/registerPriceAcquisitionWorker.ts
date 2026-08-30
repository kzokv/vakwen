import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "../market-data/registerBackfillWorker.js";
import { runOfficialPriceAcquisition } from "./acquisition.js";

export const RESEARCH_PRICE_ACQUISITION_QUEUE = "research-price-acquisition";
// 10:30 UTC = 18:30 Asia/Taipei, after the 18:00 due boundary and before the
// 22:00 stale boundary for authoritative Taiwan EOD research prices.
export const RESEARCH_PRICE_ACQUISITION_CRON = "30 10 * * 1-5";

interface ResearchPriceAcquisitionWorkerDeps {
  persistence: Persistence;
  log: FastifyBaseLogger;
}

export function createResearchPriceAcquisitionHandler(
  deps: ResearchPriceAcquisitionWorkerDeps,
) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    const job = jobs[0];
    const result = await runOfficialPriceAcquisition(deps.persistence, {
      acquisitionRunId: job ? `pg-boss:${job.id}` : undefined,
    });
    deps.log.info(result, "research_price_acquisition_completed");
  };
}

export async function registerResearchPriceAcquisitionWorker(
  boss: PgBoss,
  deps: ResearchPriceAcquisitionWorkerDeps,
): Promise<void> {
  await boss.createQueue(RESEARCH_PRICE_ACQUISITION_QUEUE, {
    ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
    policy: "singleton",
  });
  await boss.work(
    RESEARCH_PRICE_ACQUISITION_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createResearchPriceAcquisitionHandler(deps),
  );
  await boss.schedule(RESEARCH_PRICE_ACQUISITION_QUEUE, RESEARCH_PRICE_ACQUISITION_CRON, {});
  await boss.send(RESEARCH_PRICE_ACQUISITION_QUEUE, {}, {
    singletonKey: RESEARCH_PRICE_ACQUISITION_QUEUE,
  });
}
