/**
 * ui-enhancement — daily cron worker for hard-purging soft-deleted accounts.
 *
 * Schedule: `Env.ACCOUNT_HARD_PURGE_CRON` (default `0 4 * * *` — 04:00 UTC).
 * Grace period: read AT TICK TIME via `getEffectiveAccountHardPurgeDays()`
 * (admin override `app_config.account_hard_purge_days` → env fallback). This
 * mirrors `.claude/rules/fastify-eviction-lifecycle-pattern.md`'s
 * "schedule static, sweep parameter live" pattern — the cron schedule is
 * captured once at registration but the grace-period parameter is live.
 *
 * Per-row purge runs in its own transaction (`hardPurgeAccount` opens BEGIN).
 * Failures are logged and the batch continues — a single problematic account
 * does not block the rest of the candidates from being purged.
 *
 * SSE: each successful purge publishes `account_hard_purged` to the affected
 * user so the "Recently deleted" listing can refetch.
 *
 * Mirrors `registerAnonymousShareTokenPurgeWorker.ts`.
 */
import type { JobWithMetadata, PgBoss } from "pg-boss";
import type { FastifyBaseLogger } from "fastify";
import type { AppInstance } from "../app.js";
import type { EventBus } from "../events/types.js";
import type { Persistence } from "../persistence/types.js";
import { Env } from "@vakwen/config";
import { getEffectiveAccountHardPurgeDays } from "./appConfig/accountLifecycle.js";
import { publishLifecycleEventToOwnerAndActiveGrantees } from "./accountMutationEvents.js";
import { DEFAULT_MARKET_DATA_QUEUE_OPTIONS } from "./market-data/registerBackfillWorker.js";

export const ACCOUNT_HARD_PURGE_QUEUE = "account-hard-purge";
/** ui-enhancement: env-only cron schedule (restart-required). */
export const ACCOUNT_HARD_PURGE_CRON = Env.ACCOUNT_HARD_PURGE_CRON;

const ACCOUNT_HARD_PURGE_QUEUE_OPTIONS = {
  ...DEFAULT_MARKET_DATA_QUEUE_OPTIONS,
  policy: "singleton",
} as const;

export interface AccountHardPurgeDeps {
  persistence: Pick<
    Persistence,
    | "selectAccountsForHardPurge"
    | "hardPurgeAccount"
    | "getUserPreferences"
    | "listSharesForOwner"
  >;
  eventBus: Pick<EventBus, "publishEvent">;
  /** Resolver — read AT TICK TIME so admin overrides take effect each run. */
  getGraceDays?: () => number;
  log: FastifyBaseLogger;
}

export function createAccountHardPurgeHandler(deps: AccountHardPurgeDeps) {
  const getGraceDays = deps.getGraceDays ?? getEffectiveAccountHardPurgeDays;
  return async (_jobs: JobWithMetadata<Record<string, never>>[]): Promise<void> => {
    const graceDays = getGraceDays();
    let purged = 0;
    let errors = 0;
    try {
      const candidates = await deps.persistence.selectAccountsForHardPurge(graceDays);
      for (const { accountId, userId } of candidates) {
        try {
          const result = await deps.persistence.hardPurgeAccount(
            accountId,
            userId,
            { actorUserId: null, ipAddress: null, metadata: { reason: "cron" } },
            { mustBeSoftDeleted: true },
          );
          purged += 1;
          await publishLifecycleEventToOwnerAndActiveGrantees(
            deps,
            userId,
            "account_hard_purged",
            result,
          );
        } catch (err) {
          errors += 1;
          deps.log.warn(
            { err, accountId, userId, graceDays },
            "account_hard_purge_row_failed",
          );
        }
      }
      deps.log.info(
        { purged, errors, graceDays, candidates: candidates.length },
        "account_hard_purge_completed",
      );
    } catch (error) {
      deps.log.error({ error, purged, errors, graceDays }, "account_hard_purge_failed");
      throw error; // pg-boss retry
    }
  };
}

export async function registerAccountHardPurgeWorker(
  app: AppInstance,
  boss: PgBoss,
  deps: AccountHardPurgeDeps,
): Promise<void> {
  await boss.createQueue(ACCOUNT_HARD_PURGE_QUEUE, ACCOUNT_HARD_PURGE_QUEUE_OPTIONS);
  await boss.work(
    ACCOUNT_HARD_PURGE_QUEUE,
    { batchSize: 1, includeMetadata: true },
    createAccountHardPurgeHandler(deps),
  );
  app.log.info("account hard-purge worker registered");
}
