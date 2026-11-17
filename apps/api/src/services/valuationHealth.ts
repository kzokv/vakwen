import { capitalReductionEffectsAtDate } from "./capitalReductionReporting.js";
import type { FastifyInstance } from "fastify";
import type {
  DashboardOverviewHoldingGroupDto,
  DashboardPerformanceDto,
  ValuationHealthDto,
  ValuationHealthHoldingDto,
  ValuationHealthMarketFreshnessDto,
} from "@vakwen/shared-types";
import { MARKET_CODES, type AccountDefaultCurrency, type MarketCode } from "@vakwen/shared-types";
import { getEffectiveValuationHealthThresholds, minorUnitToleranceFor } from "./appConfig/valuationHealth.js";
import { isIntradayPriceState } from "./market-data/quoteSnapshotService.js";
import type { HoldingSnapshotLatestDateScopePair } from "../persistence/types.js";
import type { Store } from "../types/store.js";

interface BuildValuationHealthInput {
  app: FastifyInstance;
  userId: string;
  store: Store;
  reportingCurrency: AccountDefaultCurrency;
  currentValueAmount: number | null;
  holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>;
  performance: DashboardPerformanceDto;
  /** Full performance charts include pending fractions; lightweight snapshot reads do not. */
  includesCapitalReductionPendingValue?: boolean;
  asOf: string;
}

export async function buildValuationHealth(input: BuildValuationHealthInput): Promise<ValuationHealthDto> {
  const thresholds = getEffectiveValuationHealthThresholds();
  const minorUnitTolerance = minorUnitToleranceFor(input.reportingCurrency);
  const latestPerformancePoint = findLatestPerformancePoint(input.performance);
  const capitalEffects = capitalReductionEffectsAtDate(input.store, latestPerformancePoint?.date ?? input.asOf);
  const rawSnapshotValue = latestPerformancePoint?.marketValueAmount ?? null;
  // Compare delivered securities on both sides; pending fraction value belongs to NAV.
  const snapshotValueAmount = !capitalEffects.generationCurrent ? null : rawSnapshotValue === null ? null : rawSnapshotValue - (input.includesCapitalReductionPendingValue && input.reportingCurrency === "TWD" ? capitalEffects.pendingValue ?? 0 : 0);
  const latestUsableSnapshotDate = input.performance.diagnostics?.latestReliableValuationDate ?? input.performance.lastReliableDate ?? null;
  const latestSnapshotDate = input.performance.diagnostics?.latestSnapshotDate ?? null;
  const latestComparableSnapshotDate =
    input.performance.diagnostics?.latestComparableSnapshotDate ?? latestUsableSnapshotDate;
  const latestPartialSnapshotDate = input.performance.diagnostics?.latestPartialSnapshotDate ?? null;
  const expectedLatestValuationDate = input.performance.diagnostics?.expectedLatestValuationDate ?? input.asOf.slice(0, 10);

  const tickerMarketPairs = dedupeTickerMarketPairs(input.holdingGroups);
  const latestBarByKey = await input.app.persistence.getLatestBarDatesForReconciliation(tickerMarketPairs);
  const latestBarAsOf = latestBarDateForPairs(tickerMarketPairs, latestBarByKey);
  const repairTargetDate = maxNullableDate(
    maxNullableDate(expectedLatestValuationDate, latestPartialSnapshotDate),
    latestBarAsOf,
  ) ?? expectedLatestValuationDate;
  const expectedDateTradingDayByKey = await buildExpectedDateTradingDayByKey(
    input.app,
    tickerMarketPairs,
    repairTargetDate,
  );
  const backfillStatusByKey = new Map<string, ValuationHealthHoldingDto["backfillStatus"]>();
  await Promise.all(
    tickerMarketPairs.map(async (pair) => {
      const instrument = await input.app.persistence.getInstrument(pair.ticker, pair.marketCode);
      backfillStatusByKey.set(
        `${pair.ticker}:${pair.marketCode}`,
        instrument?.barsBackfillStatus ?? "unknown",
      );
    }),
  );
  const scopePairs = buildScopePairs(input.holdingGroups);
  const latestSnapshotByScope = await input.app.persistence.getLatestHoldingSnapshotDatesByScope(input.userId, scopePairs);
  const currentOpenStartDateByScope = buildCurrentOpenStartDateByScope(input.store, scopePairs);

  const affectedHoldings = input.holdingGroups
    .map((group) => buildHoldingHealthRow({
      group,
      latestBarByKey,
      latestSnapshotByScope,
      backfillStatusByKey,
      currentOpenStartDateByScope,
      repairTargetDate,
      expectedDateTradingDayByKey,
    }))
    .filter((row): row is ValuationHealthHoldingDto => row !== null)
    .filter((row) => row.status !== "healthy");

  const deltaAmount =
    input.currentValueAmount !== null && snapshotValueAmount !== null
      ? Math.abs(input.currentValueAmount - snapshotValueAmount)
      : null;
  const relativeDeltaBps =
    deltaAmount !== null
      ? (deltaAmount / Math.max(Math.abs(input.currentValueAmount ?? 0), Math.abs(snapshotValueAmount ?? 0), 1)) * 10_000
      : null;
  const absoluteThreshold = thresholdAmountForCurrency(thresholds, input.reportingCurrency);
  const intradayDisplayedKeys = new Set(input.holdingGroups
    .filter((group) => isIntradayPriceState(group.priceState))
    .map((group) => `${group.ticker}:${group.marketCode}`));
  const materialRelevantAffectedHoldings = affectedHoldings.filter((row) =>
    row.status !== "awaiting_latest_bar" || !intradayDisplayedKeys.has(`${row.ticker}:${row.marketCode}`),
  );
  const hasSuppressedIntradayAwaitingRow = affectedHoldings.some((row) =>
    row.status === "awaiting_latest_bar" && intradayDisplayedKeys.has(`${row.ticker}:${row.marketCode}`),
  );

  let status: ValuationHealthDto["status"] = "healthy";
  let reason: ValuationHealthDto["reason"] = "within_threshold";
  if (input.currentValueAmount === null) {
    status = "unavailable";
    reason = "missing_current_value";
  } else if (snapshotValueAmount === null) {
    status = "unavailable";
    reason = "missing_snapshot_value";
  } else if (deltaAmount !== null && deltaAmount <= minorUnitTolerance) {
    status = "healthy";
    reason = "within_minor_unit_tolerance";
  } else if (
    deltaAmount !== null
    && relativeDeltaBps !== null
    && (deltaAmount >= absoluteThreshold || relativeDeltaBps >= thresholds.relativeBps)
  ) {
    if (hasSuppressedIntradayAwaitingRow && materialRelevantAffectedHoldings.length === 0) {
      status = "healthy";
      reason = "within_threshold";
    } else {
      status = "material";
      reason = deltaAmount >= absoluteThreshold ? "absolute_threshold_exceeded" : "relative_threshold_exceeded";
    }
  }

  const recommendedActions = [...new Set(affectedHoldings
    .map((row) => row.recommendedAction)
    .filter((action) => action !== "none"))];
  const marketFreshness = buildMarketFreshness(affectedHoldings);

  return {
    status,
    reason,
    reportingCurrency: input.reportingCurrency,
    currentValueAmount: input.currentValueAmount,
    snapshotValueAmount,
    deltaAmount,
    relativeDeltaBps,
    minorUnitTolerance,
    thresholds,
    latestBarAsOf,
    latestSnapshotDate,
    latestUsableSnapshotDate,
    latestComparableSnapshotDate,
    latestPartialSnapshotDate,
    expectedLatestValuationDate,
    ...(status !== "healthy" || affectedHoldings.length > 0
      ? { title: "Market data out of sync" as const }
      : {}),
    marketFreshness,
    affectedHoldings,
    recommendedActions,
  };
}

function buildMarketFreshness(
  holdings: ReadonlyArray<ValuationHealthHoldingDto>,
): ValuationHealthMarketFreshnessDto[] {
  const byMarket = new Map<string, ValuationHealthMarketFreshnessDto>();
  for (const holding of holdings) {
    const existing = byMarket.get(holding.marketCode) ?? {
      marketCode: holding.marketCode,
      latestBarDate: null,
      latestSnapshotDate: null,
      staleTickerCount: 0,
      missingTickerCount: 0,
    };
    existing.latestBarDate = maxNullableDate(existing.latestBarDate, holding.latestBarDate);
    existing.latestSnapshotDate = maxNullableDate(existing.latestSnapshotDate, holding.latestSnapshotDate);
    if (holding.status === "missing_latest_bar" || holding.status === "missing_snapshot") {
      existing.missingTickerCount += 1;
    } else if (holding.status !== "healthy") {
      existing.staleTickerCount += 1;
    }
    byMarket.set(holding.marketCode, existing);
  }
  return [...byMarket.values()].sort((left, right) => left.marketCode.localeCompare(right.marketCode));
}

function maxNullableDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}

function thresholdAmountForCurrency(
  thresholds: ReturnType<typeof getEffectiveValuationHealthThresholds>,
  reportingCurrency: AccountDefaultCurrency,
): number {
  if (reportingCurrency === "AUD") return thresholds.absoluteAud;
  if (reportingCurrency === "USD") return thresholds.absoluteUsd;
  if (reportingCurrency === "KRW") return thresholds.absoluteKrw;
  if (reportingCurrency === "JPY") return thresholds.absoluteJpy ?? thresholds.absoluteTwd;
  return thresholds.absoluteTwd;
}

function dedupeTickerMarketPairs(holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>): Array<{ ticker: string; marketCode: MarketCode }> {
  const pairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const group of holdingGroups) {
    pairs.set(`${group.ticker}:${group.marketCode}`, { ticker: group.ticker, marketCode: group.marketCode });
  }
  return [...pairs.values()];
}

function buildScopePairs(holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>): HoldingSnapshotLatestDateScopePair[] {
  const pairs = new Map<string, HoldingSnapshotLatestDateScopePair>();
  for (const group of holdingGroups) {
    for (const child of group.children) {
      const key = `${child.accountId}\0${child.ticker}\0${child.marketCode}`;
      pairs.set(key, {
        accountId: child.accountId,
        ticker: child.ticker,
        marketCode: child.marketCode,
      });
    }
  }
  return [...pairs.values()];
}

function buildHoldingHealthRow(
  input: {
    group: DashboardOverviewHoldingGroupDto;
    latestBarByKey: ReadonlyMap<string, string | null>;
    latestSnapshotByScope: ReadonlyMap<string, string | null>;
    backfillStatusByKey: ReadonlyMap<string, ValuationHealthHoldingDto["backfillStatus"]>;
    currentOpenStartDateByScope: ReadonlyMap<string, string | null>;
    repairTargetDate: string;
    expectedDateTradingDayByKey: ReadonlyMap<string, boolean>;
  },
): ValuationHealthHoldingDto | null {
  const { group } = input;
  const tickerMarketKey = `${group.ticker}:${group.marketCode}`;
  const latestBarDate = input.latestBarByKey.get(tickerMarketKey) ?? null;
  const scopeKeys = group.children.map((child) => `${child.accountId}\0${child.ticker}\0${child.marketCode}`);
  const snapshotEligibleScopeKeys = latestBarDate === null
    ? scopeKeys
    : scopeKeys.filter((key) => {
      const currentOpenStartDate = input.currentOpenStartDateByScope.get(key) ?? null;
      return currentOpenStartDate === null || currentOpenStartDate <= latestBarDate;
    });
  const hasIneligibleCurrentScope = latestBarDate !== null && snapshotEligibleScopeKeys.length < scopeKeys.length;
  const scopeSnapshotDates = snapshotEligibleScopeKeys.map((key) => input.latestSnapshotByScope.get(key) ?? null);
  const latestSnapshotDate = scopeSnapshotDates.some((date) => date === null)
    ? null
    : scopeSnapshotDates.reduce<string | null>((min, date) => (min === null || (date !== null && date < min) ? date : min), null);
  const backfillStatus = input.backfillStatusByKey.get(tickerMarketKey) ?? "unknown";
  const hasSnapshotEligibleScope = latestBarDate === null || snapshotEligibleScopeKeys.length > 0;
  const expectedDateIsTradingDay = input.expectedDateTradingDayByKey.get(tickerMarketKey) === true;

  let status: ValuationHealthHoldingDto["status"] = "healthy";
  let recommendedAction: ValuationHealthHoldingDto["recommendedAction"] = "none";
  if (backfillStatus === "pending" || backfillStatus === "backfilling") {
    status = "backfill_pending";
    recommendedAction = "wait_for_backfill";
  } else if (backfillStatus === "failed") {
    status = "backfill_failed";
    recommendedAction = "run_backfill";
  } else if (latestBarDate === null) {
    status = "missing_latest_bar";
    recommendedAction = "run_backfill";
  } else if (expectedDateIsTradingDay && latestBarDate < input.repairTargetDate) {
    if (isIntradayPriceState(group.priceState)) {
      status = "awaiting_latest_bar";
      recommendedAction = "none";
    } else {
      status = "missing_latest_bar";
      recommendedAction = "run_backfill";
    }
  } else if (latestSnapshotDate === null && hasSnapshotEligibleScope) {
    status = "missing_snapshot";
    recommendedAction = "run_snapshot_repair";
  } else if (latestSnapshotDate !== null && latestSnapshotDate < latestBarDate) {
    status = "stale_snapshot";
    recommendedAction = "run_snapshot_repair";
  } else if (hasIneligibleCurrentScope) {
    status = "awaiting_latest_bar";
    recommendedAction = "none";
  }

  return {
    ticker: group.ticker,
    marketCode: group.marketCode,
    currentReportingValueAmount: group.reportingMarketValueAmount ?? null,
    latestBarDate,
    latestSnapshotDate,
    backfillStatus,
    status,
    recommendedAction,
  };
}

async function buildExpectedDateTradingDayByKey(
  app: FastifyInstance,
  pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  expectedLatestValuationDate: string,
): Promise<Map<string, boolean>> {
  const cache = (app as {
    tradingCalendarCache?: {
      isTradingDay(marketCode: MarketCode, date: string): Promise<boolean>;
    };
  }).tradingCalendarCache;
  const result = new Map<string, boolean>();
  if (!cache) return result;
  await Promise.all(pairs.map(async (pair) => {
    result.set(
      `${pair.ticker}:${pair.marketCode}`,
      await cache.isTradingDay(pair.marketCode, expectedLatestValuationDate),
    );
  }));
  return result;
}

function buildCurrentOpenStartDateByScope(
  store: Store,
  scopePairs: readonly HoldingSnapshotLatestDateScopePair[],
): Map<string, string | null> {
  const scopeKeys = new Set(scopePairs.map((pair) => `${pair.accountId}\0${pair.ticker}\0${pair.marketCode}`));
  const tradesByScope = new Map<string, Store["accounting"]["facts"]["tradeEvents"]>();
  const tradeEvents = (store as { accounting?: { facts?: Partial<Store["accounting"]["facts"]> } }).accounting?.facts?.tradeEvents ?? [];

  for (const trade of tradeEvents) {
    const key = `${trade.accountId}\0${trade.ticker}\0${trade.marketCode}`;
    if (!scopeKeys.has(key)) continue;
    const trades = tradesByScope.get(key) ?? [];
    trades.push(trade);
    tradesByScope.set(key, trades);
  }

  const result = new Map<string, string | null>();
  for (const key of scopeKeys) {
    const trades = [...(tradesByScope.get(key) ?? [])].sort(
      (left, right) =>
        left.tradeDate.localeCompare(right.tradeDate)
        || (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0)
        || (left.tradeTimestamp ?? "").localeCompare(right.tradeTimestamp ?? "")
        || left.id.localeCompare(right.id),
    );
    let quantity = 0;
    let currentOpenStartDate: string | null = null;
    for (const trade of trades) {
      const previousQuantity = quantity;
      quantity = trade.type === "BUY"
        ? quantity + trade.quantity
        : Math.max(0, quantity - trade.quantity);
      if (previousQuantity <= 0 && quantity > 0) {
        currentOpenStartDate = trade.tradeDate;
      } else if (quantity <= 0) {
        currentOpenStartDate = null;
      }
    }
    result.set(key, currentOpenStartDate);
  }

  return result;
}

function latestBarDateForPairs(
  pairs: ReadonlyArray<{ ticker: string; marketCode: MarketCode }>,
  latestBarByKey: ReadonlyMap<string, string | null>,
): string | null {
  let latest: string | null = null;
  for (const pair of pairs) {
    const latestBarDate = latestBarByKey.get(`${pair.ticker}:${pair.marketCode}`) ?? null;
    if (latestBarDate && (latest === null || latestBarDate > latest)) {
      latest = latestBarDate;
    }
  }
  return latest;
}

export async function buildAllRangePerformance(
  app: FastifyInstance,
  userId: string,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
): Promise<DashboardPerformanceDto> {
  const { translatePerformancePoints } = await import("./dashboardReportingCurrency.js");
  return translatePerformancePoints(userId, "ALL", asOf, reportingCurrency, app.persistence, store);
}

export async function buildValuationHealthSnapshotPerformance(
  app: FastifyInstance,
  userId: string,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
): Promise<DashboardPerformanceDto> {
  const { translateValuationHealthSnapshotPoints } = await import("./dashboardReportingCurrency.js");
  return translateValuationHealthSnapshotPoints(userId, "ALL", asOf, reportingCurrency, app.persistence, store);
}

export function isMarketCode(value: string): value is MarketCode {
  return (MARKET_CODES as readonly string[]).includes(value);
}

function findLatestPerformancePoint(performance: DashboardPerformanceDto) {
  for (let index = performance.points.length - 1; index >= 0; index -= 1) {
    const point = performance.points[index];
    if (point && point.fxAvailable && point.marketValueAmount !== null) {
      return point;
    }
  }
  return null;
}
