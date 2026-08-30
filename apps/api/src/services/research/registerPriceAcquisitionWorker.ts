import type { FastifyBaseLogger } from "fastify";
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { Persistence } from "../../persistence/types.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "../market-data/registerBackfillWorker.js";
import { getOfficialCalendarDayStatus } from "../market-data/marketCalendarService.js";
import { runOfficialIdentityAcquisition, runOfficialPriceAcquisition } from "./acquisition.js";

export const RESEARCH_PRICE_ACQUISITION_QUEUE = "research-price-acquisition";
// 10:30 UTC = 18:30 Asia/Taipei, after the 18:00 due boundary and before the
// 22:00 stale boundary. Run daily so official weekend-open exceptions are not
// missed; the handler gates closed dates with the authoritative TW calendar.
export const RESEARCH_PRICE_ACQUISITION_CRON = "30 10 * * *";

interface ResearchPriceAcquisitionWorkerDeps {
  persistence: Persistence;
  log: FastifyBaseLogger;
  now?: () => Date;
}

interface ResearchPriceAcquisitionJobData {
  trigger: "scheduled" | "startup";
}

export function createResearchPriceAcquisitionHandler(
  deps: ResearchPriceAcquisitionWorkerDeps,
) {
  return async (jobs: JobWithMetadata<ResearchPriceAcquisitionJobData>[]): Promise<void> => {
    const now = deps.now?.() ?? new Date();
    const job = jobs[0];
    const trigger = job?.data?.trigger ?? "startup";
    const calendarDay = await getOfficialCalendarDayStatus(deps.persistence, "TW", now);
    if (calendarDay.status === "calendar_unknown") {
      throw new Error(`Official TW market calendar is unavailable for ${calendarDay.calendarYear}`);
    }
    if (calendarDay.status === "closed" && trigger === "scheduled") {
      deps.log.info(calendarDay, "research_price_acquisition_skipped_closed_session");
      return;
    }
    const acquisitionRunId = job ? `pg-boss:${job.id}` : undefined;
    const retrievedAt = now.toISOString();
    const identityResult = await runOfficialIdentityAcquisition(deps.persistence, {
      acquisitionRunId: acquisitionRunId ? `${acquisitionRunId}:identity` : undefined,
      retrievedAt,
    });
    deps.log.info(identityResult, "research_identity_acquisition_before_price_completed");
    const priceResult = await runOfficialPriceAcquisition(deps.persistence, {
      acquisitionRunId: acquisitionRunId ? `${acquisitionRunId}:price` : undefined,
      retrievedAt,
    });
    deps.log.info(priceResult, "research_price_acquisition_completed");
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
  await boss.schedule(RESEARCH_PRICE_ACQUISITION_QUEUE, RESEARCH_PRICE_ACQUISITION_CRON, {
    trigger: "scheduled",
  });
  await boss.send(RESEARCH_PRICE_ACQUISITION_QUEUE, { trigger: "startup" }, {
    singletonKey: RESEARCH_PRICE_ACQUISITION_QUEUE,
  });
}
