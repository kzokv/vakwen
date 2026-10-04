import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "../market-data/registerBackfillWorker.js";
import { runOfficialDisclosureAcquisition } from "./disclosureAcquisition.js";
export const RESEARCH_DISCLOSURE_ACQUISITION_QUEUE = "research-disclosure-acquisition";
export const RESEARCH_DISCLOSURE_ACQUISITION_CRON = "*/15 * * * *";
interface Dependencies { persistence: Persistence; log: FastifyBaseLogger }
export function createResearchDisclosureAcquisitionHandler(deps: Dependencies) {
  return async (jobs: JobWithMetadata<Record<string, never>>[]) => {
    const result = await runOfficialDisclosureAcquisition(deps.persistence, { acquisitionRunId: jobs[0] ? `pg-boss:${jobs[0].id}:disclosures` : undefined });
    deps.log.info(result, "research_disclosure_acquisition_completed");
  };
}
export async function registerResearchDisclosureAcquisitionWorker(boss: PgBoss, deps: Dependencies) {
  await boss.createQueue(RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, { ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS, policy: "singleton" });
  await boss.work(RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, { batchSize: 1, includeMetadata: true }, createResearchDisclosureAcquisitionHandler(deps));
  await boss.schedule(RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, RESEARCH_DISCLOSURE_ACQUISITION_CRON, {});
  await boss.send(RESEARCH_DISCLOSURE_ACQUISITION_QUEUE, {}, { singletonKey: RESEARCH_DISCLOSURE_ACQUISITION_QUEUE });
}
