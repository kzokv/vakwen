import { PgBoss } from "pg-boss";
import pg from "pg";
import { createClient, type RedisClientType } from "redis";
import { Env } from "@vakwen/config";
import type { MarketCode } from "@vakwen/domain";
import { registerBackfillWorker } from "../services/market-data/registerBackfillWorker.js";
import { CATALOG_SYNC_CRON, CATALOG_SYNC_QUEUE, registerCatalogSyncWorker } from "../services/market-data/registerCatalogSyncWorker.js";
import { getEffectiveMetadataEnrichmentMode } from "../services/appConfig/metadataEnrichmentMode.js";
import { FX_REFRESH_CRON, FX_REFRESH_QUEUE } from "../services/market-data/fxRefreshWorker.js";
import { registerFxRefreshWorker } from "../services/market-data/registerFxRefreshWorker.js";
import {
  ANONYMOUS_SHARE_TOKEN_PURGE_CRON,
  ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE,
  registerAnonymousShareTokenPurgeWorker,
} from "../services/registerAnonymousShareTokenPurgeWorker.js";
import {
  ACCOUNT_HARD_PURGE_CRON,
  ACCOUNT_HARD_PURGE_QUEUE,
  registerAccountHardPurgeWorker,
} from "../services/registerAccountHardPurgeWorker.js";
import {
  ASX_GICS_SYNC_QUEUE,
  registerAsxGicsSyncWorker,
} from "../services/market-data/asxGicsSyncWorker.js";
import { registerProviderOperationExecutionWorker } from "../services/market-data/providerOperationExecutionWorker.js";
import { getEffectiveAsxGicsRefreshCron } from "../services/appConfig/asxGicsCron.js";
import { AsxGicsCatalogProvider } from "../services/market-data/providers/asxGicsCatalog.js";
import { MockAsxGicsCatalogProvider } from "../services/market-data/providers/mockAsxGicsCatalog.js";
import { getAppConfigCacheEntry } from "../services/appConfig/cache.js";
import { RateLimiter } from "../services/market-data/rateLimiter.js";
import { handleBatchComplete } from "../services/notificationService.js";
import { buildRedisSocketOptions } from "../lib/redisClientOptions.js";
import {
  enqueueSnapshotRepairIfActiveHeld,
  type SnapshotRepairJobData,
} from "../services/snapshotRepair.js";
import type { AppInstance } from "../app.js";
import { createIntradayOverlayCache } from "../services/market-data/intradayOverlayCache.js";
import { YahooFinanceIntradayProvider } from "../services/market-data/providers/yahooFinanceIntraday.js";
import { TwseStockDayCloseProvider, YahooChartCloseProvider } from "../services/market-data/providers/index.js";
import {
  getEffectiveTickerPriceFreshnessConfig,
} from "../services/appConfig/tickerPriceFreshness.js";
import { getEffectiveEodhdApiKey } from "../services/appConfig/providerKeys.js";
import {
  buildIntradayRefreshWorkerConfig,
  registerIntradayRefreshWorker,
} from "../services/market-data/registerIntradayRefreshWorker.js";
import type { IntradayRefreshRequestBudget } from "../services/market-data/intradayRefreshWorker.js";
import {
  buildCloseRefreshWorkerConfig,
  registerCloseRefreshWorker,
} from "../services/market-data/registerCloseRefreshWorker.js";
import {
  buildQuoteFallbackRefreshWorkerConfig,
  registerQuoteFallbackRefreshWorker,
} from "../services/market-data/registerQuoteFallbackRefreshWorker.js";
import { toDailyBarUpsertRows } from "../services/market-data/closeRefreshWorker.js";
import { upsertDailyBars } from "../services/market-data/upserts.js";
import { registerMcpReplayPositionRunWorker } from "../services/mcpReplayPositionRunWorker.js";
import { EodhdEodProvider } from "../services/market-data/providers/eodhdEod.js";
import { registerResearchIdentityAcquisitionWorker } from "../services/research/registerIdentityAcquisitionWorker.js";
import { registerResearchPriceAcquisitionWorker } from "../services/research/registerPriceAcquisitionWorker.js";
import {
  buildCurrentMopsFinancialStatementDescriptors,
  registerResearchFinancialStatementAcquisitionWorker,
} from "../services/research/registerFinancialStatementAcquisitionWorker.js";
import { researchAcquisitionEnabled } from "../services/research/rollout.js";

function createRedisIntradayRefreshRequestBudget(
  redis: Pick<RedisClientType, "isOpen" | "connect" | "incrBy" | "pExpire" | "pTTL">,
  getRequestsPerMinute: () => number,
): IntradayRefreshRequestBudget {
  return {
    async tryConsume(requests: number) {
      if (!redis.isOpen) {
        await redis.connect();
      }
      const windowMs = 60_000;
      const bucket = Math.floor(Date.now() / windowMs);
      const key = `intraday-refresh-budget:${bucket}`;
      const consumed = await redis.incrBy(key, requests);
      if (consumed === requests) {
        await redis.pExpire(key, windowMs);
      }
      if (consumed <= getRequestsPerMinute()) {
        return { allowed: true };
      }
      const retryAfterMs = await redis.pTTL(key);
      return {
        allowed: false,
        retryAfterMs: retryAfterMs > 0 ? retryAfterMs : windowMs,
      };
    },
  };
}

/**
 * Initialize pg-boss job queue and register the backfill worker.
 * Skipped entirely when persistence backend is memory (no Postgres available).
 */
export async function registerPgBoss(app: AppInstance, persistenceOverride?: string): Promise<void> {
  const backend = persistenceOverride ?? Env.PERSISTENCE_BACKEND;
  if (backend === "memory") {
    app.boss = null;
    app.tickerPriceChartRequestBudget = null;
    return;
  }

  const connectionString = Env.getDatabaseUrl();

  const boss = new PgBoss({ connectionString, application_name: "vakwen-boss" });
  boss.on("error", (err: Error) => app.log.error(err, "pg-boss error"));

  await boss.start();

  // Data pool for backfill worker SQL operations.
  // KZO-199 — env-tunable (restart-required); default 2.
  const pool = new pg.Pool({
    connectionString,
    max: Env.BACKFILL_POSTGRES_POOL_MAX,
    application_name: "vakwen-backfill",
  });
  let chartBudgetRedis: RedisClientType | null = null;
  let chartRequestBudget: IntradayRefreshRequestBudget | null = null;

  // KZO-163: providers + rate limiters now live inside `app.marketDataRegistry` (built in app.ts).
  // The backfill worker takes the marketData map; the catalog-sync worker takes the catalog map.
  const backfillDeps = {
    pool,
    marketDataRegistry: app.marketDataRegistry.marketData,
    // KZO-172: catalog registry threaded so the handler can call
    // `fetchInstrumentMetadata(ticker)` after bars+dividends. AU's same-instance
    // registration in both maps means the rate-limiter budget is shared.
    catalogRegistry: app.marketDataRegistry.catalog,
    // KZO-172: `persistence.upsertInstrumentCatalog([row], [])` writes the enriched
    // catalog row. The handler limits this to a single row per backfill, mirroring the
    // catalog-sync upsert path but scoped to one ticker.
    persistence: app.persistence,
    // KZO-170: `resolveMarketCode` deleted — `/market-data/price` now requires
    // `market_code` as a query param, producers stamp `marketCode` directly on
    // `BackfillJobData`, and the worker validates the marketCode via Zod at
    // handler entry. Nothing references `marketResolution.ts` post-KZO-170.
    eventBus: app.eventBus,
    boss,
    // KZO-189: AU metadata enrichment gate — read every job (no cache) so admin
    // toggles take effect on the next backfill. Hybrid env+DB resolution.
    getEffectiveMetadataEnrichmentMode: () => Promise.resolve(getEffectiveMetadataEnrichmentMode()),
    updateBackfillStatus: (
      ticker: string,
      marketCode: import("@vakwen/domain").MarketCode,
      status: import("@vakwen/domain").BackfillStatus,
    ) => app.persistence.updateBackfillStatus(ticker, marketCode, status),
    updateLastRepairAt: (ticker: string) => app.persistence.updateLastRepairAt(ticker),
    getUsersMonitoringTicker: (ticker: string) => app.persistence.getUsersMonitoringTicker(ticker),
    createNotification: (notification: Parameters<typeof app.persistence.createNotification>[0]) =>
      app.persistence.createNotification(notification),
    updateBatchTickerResult: (
      batchId: string,
      ticker: string,
      result: { status: "success" | "failed"; barsCount?: number; dividendsCount?: number; reason?: string },
    ) => app.persistence.updateBatchTickerResult(batchId, ticker, result),
    onBatchComplete: async (batchId: string) => {
      const batch = await app.persistence.getRefreshBatch(batchId);
      if (!batch) return;
      const finalStatus = batch.jobsFailed > 0 ? "failed" as const : "completed" as const;
      await app.persistence.completeRefreshBatch(batchId, finalStatus);
      await handleBatchComplete({
        persistence: app.persistence,
        eventBus: app.eventBus,
        batchId,
        tickerResults: batch.tickerResults,
        log: app.log,
      });
    },
    onBarsUpserted: (market: MarketCode, dates: ReadonlyArray<string>) => {
      app.tradingCalendarCache.notifyBarsUpserted(market, dates);
    },
    enqueueSnapshotRepair: (input: SnapshotRepairJobData) =>
      enqueueSnapshotRepairIfActiveHeld({
        boss,
        persistence: app.persistence,
        ticker: input.ticker,
        marketCode: input.marketCode,
        fromDate: input.fromDate,
        trigger: input.trigger,
      }).then(() => undefined),
    // KZO-177: feed provider outcomes (success/error/rate_limit) into the
    // health aggregator. Decorated by `registerProviderHealth(app)` in app.ts.
    providerHealth: app.providerHealth,
    providerOperationLogger: app.persistence,
    log: app.log,
  };

  const catalogDeps = {
    boss,
    catalogRegistry: app.marketDataRegistry.catalog,
    persistence: app.persistence,
    log: app.log,
    // KZO-200: feed catalog-sync outcomes into the health aggregator. AU is
    // attributed to `twelve-data-au` (KZO-194 catalog provider); TW/US share
    // their bars provider id (`finmind-tw`/`finmind-us`).
    providerHealth: app.providerHealth,
  };

  await registerBackfillWorker(app, boss, backfillDeps);
  await registerCatalogSyncWorker(app, boss, catalogDeps);
  await registerProviderOperationExecutionWorker(app, boss);
  await registerMcpReplayPositionRunWorker(app, boss);
  await boss.schedule(CATALOG_SYNC_QUEUE, CATALOG_SYNC_CRON, {});
  // KZO-194: kick the catalog-sync queue once on startup so a fresh deploy doesn't
  // wait up to 72h (Fri afternoon → Mon 17:30 UTC, the next CATALOG_SYNC_CRON tick)
  // for the AU catalog to populate. Pre-KZO-194, AU shipped a hardcoded 7-row
  // reserved set so an empty `instruments` table was acceptable post-deploy. Now
  // the AU catalog comes entirely from `TwelveDataAuCatalogProvider`'s upstream
  // call — without this startup-tick, the AU catalog stays empty until the cron
  // fires. Singleton policy collapses duplicate kicks from concurrent restarts.
  await boss.send(CATALOG_SYNC_QUEUE, {}, { singletonKey: CATALOG_SYNC_QUEUE });

  if (researchAcquisitionEnabled()) {
    await registerResearchIdentityAcquisitionWorker(boss, {
      persistence: app.persistence,
      log: app.log,
    });
    await registerResearchPriceAcquisitionWorker(boss, {
      persistence: app.persistence,
      log: app.log,
    });
    await registerResearchFinancialStatementAcquisitionWorker(boss, {
      persistence: app.persistence,
      log: app.log,
      resolveDescriptors: async () => {
        const now = new Date();
        const at = now.toISOString();
        const identities = await Promise.all([
          app.persistence.listLatestResearchIdentityRecords({
            subject: { kind: "venue", venue: "TWSE" },
            effectiveAt: at,
            knowledgeAt: at,
          }),
          app.persistence.listLatestResearchIdentityRecords({
            subject: { kind: "venue", venue: "TPEX" },
            effectiveAt: at,
            knowledgeAt: at,
          }),
        ]);
        return buildCurrentMopsFinancialStatementDescriptors(identities.flat(), now);
      },
    });
  }

  // KZO-164: Frankfurter FX rate ingestion. Singleton policy ensures concurrent
  // manual triggers (and overlapping cron + manual) coalesce. Cron schedule sends
  // an empty payload; the worker normalizes that to `trigger='cron'` and re-derives
  // the date window via `getLatestFxRateDate()`.
  const fxDeps = {
    fxProvider: app.marketDataRegistry.fxRate,
    persistence: app.persistence,
    log: app.log,
    // KZO-177: feed Frankfurter outcomes into the health aggregator.
    providerHealth: app.providerHealth,
  };
  await registerFxRefreshWorker(app, boss, fxDeps);
  await boss.schedule(FX_REFRESH_QUEUE, FX_REFRESH_CRON, {});

  const purgeCutoffMs = Env.ANONYMOUS_SHARE_TOKEN_PURGE_DAYS * 24 * 60 * 60 * 1000;
  await registerAnonymousShareTokenPurgeWorker(app, boss, {
    persistence: app.persistence,
    cutoffMs: purgeCutoffMs,
    log: app.log,
  });
  await boss.schedule(ANONYMOUS_SHARE_TOKEN_PURGE_QUEUE, ANONYMOUS_SHARE_TOKEN_PURGE_CRON, {});

  // ui-enhancement — daily account hard-purge cron. Grace period is admin-
  // tunable via app_config.account_hard_purge_days (default 30); the worker
  // reads `getEffectiveAccountHardPurgeDays()` AT TICK TIME so PATCH /admin/
  // settings overrides take effect without a redeploy.
  await registerAccountHardPurgeWorker(app, boss, {
    persistence: app.persistence,
    eventBus: app.eventBus,
    log: app.log,
  });
  await boss.schedule(ACCOUNT_HARD_PURGE_QUEUE, ACCOUNT_HARD_PURGE_CRON, {});

  // KZO-196 — ASX GICS catalog enrichment worker. Mock vs real selection
  // mirrors `AU_CATALOG_PROVIDER_MOCK` because the GICS feed is part of the
  // AU catalog story; environments running the mock TD AU provider should
  // also use a deterministic GICS source for tests/dev. The cron schedule
  // is read via `getEffectiveAsxGicsRefreshCron()` (DB override → env) per
  // the app_config bootstrap pattern in `.claude/rules/fastify-app-config-bootstrap.md`.
  // Eager pre-warm of the cache happened in `buildApp()` BEFORE this call,
  // so the resolver returns the hot value here.
  const asxGicsProvider = Env.AU_CATALOG_PROVIDER_MOCK
    ? new MockAsxGicsCatalogProvider()
    : new AsxGicsCatalogProvider({
        rateLimiter: new RateLimiter(
          () => getAppConfigCacheEntry()?.asxGicsProviderRateLimitPerHour ?? Env.ASX_GICS_RATE_LIMIT_PER_HOUR,
        ),
      });
  await registerAsxGicsSyncWorker(app, boss, {
    provider: asxGicsProvider,
    pool,
    persistence: app.persistence,
    log: app.log,
    providerHealth: app.providerHealth,
  });
  // Queue-level singleton policy (set inside `registerAsxGicsSyncWorker`'s
  // queue options) ensures cron + manual run-now collapses; no per-schedule
  // `singletonKey` needed here.
  await boss.schedule(
    ASX_GICS_SYNC_QUEUE,
    getEffectiveAsxGicsRefreshCron(),
    {},
  );

  const tickerPriceFreshness = getEffectiveTickerPriceFreshnessConfig();
  const tickerPriceReadiness = await app.persistence.readiness();
  if (tickerPriceReadiness.redis) {
    try {
      chartBudgetRedis = createClient({
        url: Env.getRedisUrl(),
        socket: buildRedisSocketOptions(),
      });
      chartBudgetRedis.on("error", (err) =>
        app.log.warn({ err: err instanceof Error ? err.message : String(err) }, "ticker_price_chart_budget_redis_error"));
      chartRequestBudget = createRedisIntradayRefreshRequestBudget(
        chartBudgetRedis,
        () => getEffectiveTickerPriceFreshnessConfig().yahooChartRequestLimitPerMinute,
      );
      app.tickerPriceChartRequestBudget = chartRequestBudget;
    } catch (error) {
      app.log.warn(
        {
          feature: "ticker_price_chart_budget",
          err: error instanceof Error ? error.message : String(error),
        },
        "ticker_price_chart_budget_unavailable; close_yahoo_fallback_and_intraday_budget_disabled",
      );
      chartBudgetRedis = null;
      chartRequestBudget = null;
      app.tickerPriceChartRequestBudget = null;
    }
  } else {
    app.log.warn(
      { feature: "ticker_price_chart_budget", backend: tickerPriceReadiness.backend },
      "ticker_price_chart_budget_unavailable_missing_redis; close_yahoo_fallback_and_intraday_budget_disabled",
    );
    app.tickerPriceChartRequestBudget = null;
  }
  await registerCloseRefreshWorker(
    boss,
    buildCloseRefreshWorkerConfig(tickerPriceFreshness),
    {
      boss,
      persistence: app.persistence,
      tradingCalendar: app.tradingCalendarCache,
      marketDataProviders: app.marketDataRegistry.marketData,
      fallbackProviders: {
        twseStockDay: new TwseStockDayCloseProvider(),
        ...(chartRequestBudget
          ? {
              yahooChartClose: {
                fetchCloseOnlyBar: (ticker, marketCode, barDate, now) => {
                  const currentConfig = getEffectiveTickerPriceFreshnessConfig();
                  return new YahooChartCloseProvider({
                    range: currentConfig.yahooChartRange,
                    interval: currentConfig.yahooChartInterval,
                    persistence: app.persistence,
                    requestBudget: chartRequestBudget,
                  }).fetchCloseOnlyBar(ticker, marketCode, barDate, now);
                },
              },
            }
          : {}),
      },
      upsertBars: async (bars, marketCode) => {
        if (bars.length === 0) return;
        await upsertDailyBars(pool, toDailyBarUpsertRows(bars, marketCode));
        app.tradingCalendarCache.notifyBarsUpserted(marketCode, [...new Set(bars.map((bar) => bar.barDate))]);
      },
      activityPersistence: app.persistence,
      closeRefreshGraceMinutes: tickerPriceFreshness.closeRefreshGraceMinutes,
      supportedMarkets: tickerPriceFreshness.supportedMarkets,
      resolveRuntimeConfig: () => {
        const currentConfig = getEffectiveTickerPriceFreshnessConfig();
        return {
          closeRefreshGraceMinutes: currentConfig.closeRefreshGraceMinutes,
          supportedMarkets: currentConfig.supportedMarkets,
        };
      },
      log: app.log,
    },
  );
  app.log.info(
    {
      feature: "ticker_price_close_refresh",
      concurrency: tickerPriceFreshness.queueConcurrency,
      closeRefreshGraceMinutes: tickerPriceFreshness.closeRefreshGraceMinutes,
    },
    "close_refresh_worker_registered",
  );

  await registerQuoteFallbackRefreshWorker(
    boss,
    buildQuoteFallbackRefreshWorkerConfig(tickerPriceFreshness),
    {
      boss,
      persistence: app.persistence,
      provider: new EodhdEodProvider({
        apiToken: getEffectiveEodhdApiKey,
        baseUrl: Env.EODHD_BASE_URL,
      }),
      tradingCalendar: app.tradingCalendarCache,
      resolveRuntimeConfig: () => {
        const currentConfig = getEffectiveTickerPriceFreshnessConfig();
        return {
          closeRefreshGraceMinutes: currentConfig.closeRefreshGraceMinutes,
          dailyCallLimit: getAppConfigCacheEntry()?.eodhdDailyCallLimit ?? Env.EODHD_DAILY_CALL_LIMIT,
          supportedMarkets: ["AU"],
        };
      },
      log: app.log,
    },
  );
  app.log.info(
    {
      feature: "quote_fallback_refresh",
      concurrency: tickerPriceFreshness.queueConcurrency,
      supportedMarkets: ["AU"],
      dailyCallLimit: getAppConfigCacheEntry()?.eodhdDailyCallLimit ?? Env.EODHD_DAILY_CALL_LIMIT,
    },
    "quote_fallback_refresh_worker_registered",
  );

  if (!tickerPriceReadiness.redis || !chartRequestBudget) {
    app.log.warn(
      { feature: "ticker_price_freshness_intraday", backend: tickerPriceReadiness.backend },
      "intraday_refresh_runtime_unavailable_missing_redis; falling back to daily_bar_behavior",
    );
  } else {
    try {
      await registerIntradayRefreshWorker(
        boss,
        buildIntradayRefreshWorkerConfig(tickerPriceFreshness),
        {
          cache: createIntradayOverlayCache(app.persistence, app.log),
          fetchOverlay: ({ ticker, marketCode, now }) => {
            const currentConfig = getEffectiveTickerPriceFreshnessConfig();
            return new YahooFinanceIntradayProvider({
              range: currentConfig.yahooChartRange,
              interval: currentConfig.yahooChartInterval,
              persistence: app.persistence,
            }).fetchLatestOverlayResult({
              ticker,
              marketCode,
              now,
            });
          },
          requestBudget: chartRequestBudget,
          persistence: app.persistence,
          resolveRuntimeConfig: () => {
            const currentConfig = getEffectiveTickerPriceFreshnessConfig();
            return {
              intradayEnabled: currentConfig.intradayEnabled,
              supportedMarkets: currentConfig.supportedMarkets,
            };
          },
          log: app.log,
        },
      );
      app.log.info(
        {
          feature: "ticker_price_freshness_intraday",
          concurrency: tickerPriceFreshness.queueConcurrency,
          intradayEnabled: tickerPriceFreshness.intradayEnabled,
          requestsPerMinute: tickerPriceFreshness.yahooChartRequestLimitPerMinute,
          range: tickerPriceFreshness.yahooChartRange,
          interval: tickerPriceFreshness.yahooChartInterval,
        },
        "intraday_refresh_worker_registered",
      );
    } catch (error) {
      app.log.warn(
        {
          feature: "ticker_price_freshness_intraday",
          err: error instanceof Error ? error.message : String(error),
        },
        "intraday_refresh_runtime_unavailable_missing_queue_or_redis; falling back to daily_bar_behavior",
      );
    }
  }

  app.boss = boss;

  app.addHook("onClose", async () => {
    await boss.stop({ graceful: true, timeout: 10_000 });
    if (chartBudgetRedis?.isOpen) {
      await chartBudgetRedis.quit();
    }
    await pool.end();
  });

  app.log.info("pg-boss started, market-data workers registered");
}
