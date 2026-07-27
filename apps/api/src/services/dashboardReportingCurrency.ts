/**
 * KZO-180: FX-aware dashboard aggregation service.
 *
 * Translates the per-currency native dashboard outputs into the user's chosen
 * `reportingCurrency` for `/dashboard/overview.summary` and
 * `/dashboard/performance.points[]`. Per-holding rows on `/overview` and per-event
 * dividend rows stay native (D3) — those surfaces translate at the UI layer when
 * KZO-176 lands the per-market-section cards.
 *
 * v1 deviation from KZO-166 D4: `cumulative_realized_pnl` is translated at
 * `snapshot_date` FX, NOT the sale-date FX. The denormalized cumulative column
 * doesn't preserve per-trade sale-date breakdown; strict D4 adherence requires a
 * JOIN-to-trades aggregation owned by KZO-176's per-position FX-attribution
 * decomposition. This is correct for TWD-only users (today's entire production
 * user base) and an approximation for mixed-currency users until KZO-176.
 *
 * D8 self-pair guard: the persistence-layer SQL `LEFT JOIN LATERAL ... ON
 * s.currency <> $reportingCurrency` gates the FX lookup so TWD→TWD positions
 * don't hit `market_data.fx_rates` (which has no self-pair rows). Without that
 * guard, `value_native * NULL` propagates into SUM and silently NULLs out the
 * entire production user base's totals. See
 * `docs/004-notes/kzo-180/scope-todo-202604291600-reporting-currency.md` §D8.
 *
 * Status convention (`fxStatus`):
 *   - `"complete"` — every contributing source-currency resolved (or self-pair).
 *   - `"partial"`  — some contributing rows resolved, others did not.
 *   - `"missing"`  — every contributing row's pair failed.
 */

import { resolveRangeBounds, roundToDecimal } from "@vakwen/domain";
import type { QuoteSnapshot } from "@vakwen/domain";
import type {
  AccountDefaultCurrency,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  DashboardOverviewHoldingDto,
  DashboardOverviewMarketValueDto,
  DashboardOverviewRecentDividendDto,
  DashboardOverviewSummaryDto,
  DashboardOverviewUpcomingDividendDto,
  HoldingAllocationBasis,
  DashboardPerformanceDto,
  DashboardPerformancePointDto,
  DashboardPerformanceRange,
} from "@vakwen/shared-types";
import type {
  AggregatedSnapshotPoint,
  Persistence,
  SnapshotDividendInput,
  SnapshotLotAllocationInput,
  SnapshotTradeInput,
} from "../persistence/types.js";
import type { BookedTradeEvent, LotAllocationProjection, Store } from "../types/store.js";
import { quoteSnapshotKey, type ResolvedQuoteSnapshot } from "./market-data/quoteSnapshotService.js";

const VALUATION_HEALTH_SNAPSHOT_LOOKBACK_DAYS = 120;

interface PreTranslationOverviewSummary {
  asOf: string;
  accountCount: number;
  holdingCount: number;
  totalCostAmount: number;
  marketValueAmount: number | null;
  unrealizedPnlAmount: number | null;
  dailyChangeAmount: number | null;
  dailyChangePercent: number | null;
  upcomingDividendCount: number;
  upcomingDividendAmount: number | null;
  openIssueCount: number;
  priceStateRollup: import("@vakwen/shared-types").PriceStateRollupDto;
}

interface OverviewDividends {
  upcoming: DashboardOverviewUpcomingDividendDto[];
  recent: DashboardOverviewRecentDividendDto[];
}

type PerformanceCoverageTrade = Pick<
  BookedTradeEvent | SnapshotTradeInput,
  "accountId" | "ticker" | "marketCode" | "type" | "quantity" | "tradeDate" | "id"
> & {
  bookingSequence?: number;
  tradeTimestamp?: string;
};

type PerformanceFinanceTrade = PerformanceCoverageTrade & Pick<
  BookedTradeEvent | SnapshotTradeInput,
  "unitPrice" | "commissionAmount" | "taxAmount" | "priceCurrency"
> & {
  realizedPnlAmount?: number | null;
  realizedPnlCurrency?: string | null;
};

type PerformanceFinanceAllocation = Pick<
  LotAllocationProjection | SnapshotLotAllocationInput,
  "tradeEventId" | "allocatedCostAmount" | "costCurrency" | "lotOpenedAt"
>;

export interface TranslatePerformanceOptions {
  earliestTradeDate?: string;
  expectedContributorKeysByDate?: ReadonlyMap<string, ReadonlySet<string>>;
  strictExpectedContributorKeysByDate?: ReadonlyMap<string, ReadonlySet<string>>;
  financeTrades?: ReadonlyArray<PerformanceFinanceTrade>;
  financeDividends?: ReadonlyArray<SnapshotDividendInput>;
  financeLotAllocations?: ReadonlyArray<PerformanceFinanceAllocation>;
}

interface SnapshotCoverageResult {
  points: AggregatedSnapshotPoint[];
  hasSnapshotCoverageGap: boolean;
  latestPartialSnapshotDate: string | null;
}

/**
 * Pre-fetches per-source-currency FX rates into a Map keyed by source-currency
 * code. Self-pair entries map to 1.0 without touching the persistence layer.
 *
 * The Map's null entries flow into the `fxStatus` rollup at the call site:
 *   - all-resolved → "complete"
 *   - some-null    → "partial"
 *   - all-null     → "missing" (rare; only fires when nothing in fx_rates
 *                                 covers any contributing source currency)
 */
async function buildFxRateMap(
  sourceCurrencies: ReadonlyArray<string>,
  reportingCurrency: AccountDefaultCurrency,
  asOfDate: string,
  persistence: Persistence,
): Promise<Map<string, number | null>> {
  const map = new Map<string, number | null>();
  const pending: Array<Promise<void>> = [];
  for (const src of sourceCurrencies) {
    if (map.has(src)) continue;
    if (src === reportingCurrency) {
      map.set(src, 1.0);
      continue;
    }
    map.set(src, null);
    pending.push(
      persistence.getFxRate(src, reportingCurrency, asOfDate).then((rate) => {
        map.set(src, rate);
      }),
    );
  }
  await Promise.all(pending);
  return map;
}

function rollupFxStatus(
  fxMap: ReadonlyMap<string, number | null>,
): "complete" | "partial" | "missing" {
  // Empty contributors → "complete": no FX is needed when there are no
  // holdings/dividends to translate. The HTTP-1 spec pins this contract for
  // the empty-portfolio default-user case.
  if (fxMap.size === 0) return "complete";
  let resolvedCount = 0;
  let nullCount = 0;
  for (const rate of fxMap.values()) {
    if (rate === null) nullCount += 1;
    else resolvedCount += 1;
  }
  if (nullCount === 0) return "complete";
  if (resolvedCount === 0) return "missing";
  return "partial";
}

/**
 * KZO-180: Translate the native overview summary (5 KPIs) into the user's
 * chosen reporting currency.
 *
 * Inputs:
 *  - `summary`    — pre-translation native summary (without `totalCostCurrency`).
 *                   The legacy field has been dropped from the wire DTO; we
 *                   accept the legacy-shaped projection so the route handler
 *                   stays simple.
 *  - `holdings`   — per-holding rows on `/overview` (each carries `currency`,
 *                   `costBasisAmount`, `marketValueAmount`, `unrealizedPnlAmount`,
 *                   `change`, `quantity`, `previousClose`).
 *  - `dividends`  — pass-through; only `upcoming` is summed for translation.
 *  - `reportingCurrency` — target currency.
 *  - `asOfDate`   — single FX-rate timestamp for all 5 KPIs (D4 — `/overview`
 *                   uses asOf-day FX uniformly across the section).
 *  - `persistence` — used for `getFxRate(src, target, asOf)`.
 *
 * Behavior on missing FX:
 *  - Per-holding contributions whose FX rate is null drop out of the summed
 *    KPI; nullable KPIs surface as null when at least one contributing rate
 *    failed. `totalCostAmount` remains non-null per the shared DTO contract,
 *    with `fxStatus` carrying the degradation signal.
 *  - `fxStatus` reflects the rollup across all unique source currencies.
 */
export async function translateOverviewSummary(
  summary: PreTranslationOverviewSummary,
  holdings: ReadonlyArray<DashboardOverviewHoldingDto>,
  dividends: OverviewDividends,
  reportingCurrency: AccountDefaultCurrency,
  asOfDate: string,
  persistence: Persistence,
): Promise<DashboardOverviewSummaryDto> {
  const sourceCurrencies = new Set<string>();
  for (const h of holdings) sourceCurrencies.add(h.currency);
  for (const d of dividends.upcoming) sourceCurrencies.add(d.currency);
  // recent dividends not summed — stays native per D3.

  const fxMap = await buildFxRateMap(
    [...sourceCurrencies],
    reportingCurrency,
    asOfDate,
    persistence,
  );
  const fxStatus = rollupFxStatus(fxMap);

  // Aggregate the 5 KPIs by translating each holding's contribution.
  let totalCostAmount = 0;
  let marketValueAmount = 0;
  let unrealizedPnlAmount = 0;
  let dailyChangeAmount = 0;
  let previousMarketValue = 0;
  let totalCostHasMissing = false;
  let marketValueHasMissing = false;
  let unrealizedHasMissing = false;
  let dailyChangeHasMissing = false;
  let dailyChangeAllAvailable = true;
  let dailyChangeHasContributors = false;

  for (const h of holdings) {
    const fx = fxMap.get(h.currency) ?? null;
    if (fx === null) {
      totalCostHasMissing = true;
      marketValueHasMissing = true;
      unrealizedHasMissing = true;
      dailyChangeAllAvailable = false;
      continue;
    }
    totalCostAmount += h.costBasisAmount * fx;

    const mvNative = h.marketValueAmount;
    if (mvNative === null) marketValueHasMissing = true;
    else marketValueAmount += mvNative * fx;

    const upNative = h.unrealizedPnlAmount;
    if (upNative === null) unrealizedHasMissing = true;
    else unrealizedPnlAmount += upNative * fx;

    if (h.change !== null && h.previousClose !== null) {
      dailyChangeHasContributors = true;
      dailyChangeAmount += h.quantity * h.change * fx;
      previousMarketValue += h.quantity * h.previousClose * fx;
    } else {
      dailyChangeHasMissing = true;
    }
  }

  // Upcoming-dividend amount: translated sum across upcoming events.
  let upcomingDividendAmount = 0;
  let upcomingHasMissing = false;
  let upcomingHasContributors = false;
  for (const d of dividends.upcoming) {
    if (d.expectedAmount === null) continue;
    const fx = fxMap.get(d.currency) ?? null;
    if (fx === null) {
      upcomingHasMissing = true;
      continue;
    }
    upcomingHasContributors = true;
    upcomingDividendAmount += d.expectedAmount * fx;
  }

  // Apply missing-FX semantics to each KPI:
  //  - totalCostAmount: `number` (not nullable in the DTO). When ANY contributing
  //    holding's FX failed we keep the partial-translated sum and let `fxStatus`
  //    signal partial. The DTO contract for this single field is intentionally
  //    not-null so the upstream UI never has to render a null total.
  //    `totalCostHasMissing` is informational here — totalCostAmount is the
  //    accumulator so far, which is 0 when nothing translated.
  //  - The rest of the KPIs are nullable; null when ANY contributor failed.
  const finalTotalCost = totalCostAmount;
  void totalCostHasMissing;
  const finalMarketValue =
    marketValueHasMissing || summary.marketValueAmount === null
      ? null
      : marketValueAmount;
  const finalUnrealized =
    unrealizedHasMissing || summary.unrealizedPnlAmount === null
      ? null
      : unrealizedPnlAmount;
  // dailyChange: null when no contributors, when any holding's per-share change
  // wasn't available (dailyChangeHasMissing), or when any holding's FX failed
  // (!dailyChangeAllAvailable). Rounding mirrors the legacy `dashboard.ts`
  // shape (2 dp absolute, 4 dp percent) so existing TWD-only assertions pass.
  let finalDailyChange: number | null;
  let finalDailyChangePercent: number | null;
  if (
    !dailyChangeHasContributors ||
    dailyChangeHasMissing ||
    !dailyChangeAllAvailable
  ) {
    finalDailyChange = null;
    finalDailyChangePercent = null;
  } else {
    finalDailyChange = roundToDecimal(dailyChangeAmount, 2);
    finalDailyChangePercent =
      previousMarketValue > 0
        ? roundToDecimal((finalDailyChange / previousMarketValue) * 100, 4)
        : null;
  }
  // upcomingDividendAmount: null when no contributors, when any upcoming
  // dividend's FX failed, or when the resulting sum is exactly 0 (mirrors the
  // legacy `|| null` semantics — empty upcoming widgets render the count, not
  // a "$0" amount).
  let finalUpcomingDividend: number | null;
  if (!upcomingHasContributors || upcomingHasMissing) {
    finalUpcomingDividend = null;
  } else {
    finalUpcomingDividend = upcomingDividendAmount || null;
  }

  return {
    asOf: summary.asOf,
    accountCount: summary.accountCount,
    holdingCount: summary.holdingCount,
    totalCostAmount: finalTotalCost,
    reportingCurrency,
    fxStatus,
    marketValueAmount: finalMarketValue,
    unrealizedPnlAmount: finalUnrealized,
    dailyChangeAmount: finalDailyChange,
    dailyChangePercent: finalDailyChangePercent,
    upcomingDividendCount: summary.upcomingDividendCount,
    upcomingDividendAmount: finalUpcomingDividend,
    openIssueCount: summary.openIssueCount,
    priceStateRollup: summary.priceStateRollup,
  };
}

export async function translateOverviewHoldingGroups(
  holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>,
  reportingCurrency: AccountDefaultCurrency,
  allocationBasis: HoldingAllocationBasis,
  asOfDate: string,
  persistence: Persistence,
): Promise<DashboardOverviewHoldingGroupDto[]> {
  const sourceCurrencies = [...new Set(holdingGroups.map((group) => group.currency))];
  const fxMap = await buildFxRateMap(
    sourceCurrencies,
    reportingCurrency,
    asOfDate,
    persistence,
  );

  const translatedGroups = holdingGroups.map((group) =>
    translateHoldingGroup(group, reportingCurrency, fxMap.get(group.currency) ?? null),
  );
  const groupAllocations = deriveAllocationDetails(translatedGroups, allocationBasis);
  const childAllocations = deriveAllocationDetails(
    translatedGroups.flatMap((group) => group.children),
    allocationBasis,
  );

  return translatedGroups.map((group) => ({
    ...applyAllocationDetails(group, groupAllocations),
    children: group.children.map((child) => applyAllocationDetails(child, childAllocations)),
  }));
}

export async function translateDailyCompatibleCurrentValue(
  holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>,
  quotes: ReadonlyArray<ResolvedQuoteSnapshot>,
  reportingCurrency: AccountDefaultCurrency,
  asOfDate: string,
  persistence: Persistence,
): Promise<number | null> {
  const quoteByKey = new Map<string, ResolvedQuoteSnapshot>();
  for (const quote of quotes) {
    quoteByKey.set(quoteSnapshotKey(quote.ticker, quote.marketCode), quote);
    if (!quote.marketCode && !quoteByKey.has(quote.ticker)) {
      quoteByKey.set(quote.ticker, quote);
    }
  }

  const children = holdingGroups.flatMap((group) => group.children);
  const fxMap = await buildFxRateMap(
    [...new Set(children.map((child) => child.currency))],
    reportingCurrency,
    asOfDate,
    persistence,
  );

  let total = 0;
  for (const child of children) {
    const quote = quoteByKey.get(quoteSnapshotKey(child.ticker, child.marketCode)) ?? quoteByKey.get(child.ticker);
    const fx = fxMap.get(child.currency) ?? null;
    if (!quote || fx === null) return null;
    total += child.quantity * quote.dailyCompatibleClose * fx;
  }
  return roundToDecimal(total, 2);
}

export function buildOverviewMarketValues(
  holdingGroups: ReadonlyArray<DashboardOverviewHoldingGroupDto>,
  reportingCurrency: AccountDefaultCurrency,
): DashboardOverviewMarketValueDto[] {
  const values = new Map<string, number | null>();
  for (const group of holdingGroups) {
    if (group.reportingCurrency !== reportingCurrency) continue;
    if (group.reportingMarketValueAmount === null) {
      values.set(group.marketCode, null);
      continue;
    }
    const current = values.get(group.marketCode);
    if (current === null) continue;
    values.set(group.marketCode, (current ?? 0) + group.reportingMarketValueAmount);
  }
  return [...values.entries()]
    .map(([marketCode, value]) => ({
      marketCode: marketCode as DashboardOverviewMarketValueDto["marketCode"],
      value: value === null ? null : roundToDecimal(value, 2),
      reportingCurrency,
    }))
    .sort((left, right) =>
      (right.value ?? Number.NEGATIVE_INFINITY) - (left.value ?? Number.NEGATIVE_INFINITY)
      || left.marketCode.localeCompare(right.marketCode),
    );
}

/**
 * KZO-180: Build the `/dashboard/performance` time series in reporting currency.
 *
 * Always reads from `daily_holding_snapshots` via the FX-aware persistence
 * method. When the snapshot table has zero rows for the user/range, returns an
 * empty series so formal trend charts do not imply unsnapshotted history.
 *
 * `fxStatus` is rolled up from per-point `fxAvailable` flags using the same
 * convention as `translateOverviewSummary`. Per-point numerics become null
 * when `fxAvailable === false`.
 */
export async function translatePerformancePoints(
  userId: string,
  range: DashboardPerformanceRange,
  asOf: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
  store?: Store,
  _quotes?: SyntheticQuoteInput,
  options: TranslatePerformanceOptions = {},
): Promise<DashboardPerformanceDto> {
  const earliestTradeDate = options.earliestTradeDate ?? store?.accounting.facts.tradeEvents
    .map((trade) => trade.tradeDate)
    .sort()[0];
  const { startDate, endDate } = resolveRangeBounds(range, asOf, earliestTradeDate);
  const aggregated =
    await persistence.getAggregatedSnapshotsInReportingCurrency(
      userId,
      startDate,
      endDate,
      reportingCurrency,
    );

  if (aggregated.length === 0) {
    return withPerformanceFreshness(
      { range, rangeStartDate: startDate, rangeEndDate: endDate, points: [], reportingCurrency, fxStatus: "complete" },
      asOf,
    );
  }

  const strictExpectedKeysByDate = options.strictExpectedContributorKeysByDate
    ?? (store
      ? await buildExpectedSnapshotContributorKeysByDate(store, startDate, endDate, persistence, {
          omitNonTradingContributors: false,
        })
      : null);
  const coverage = options.expectedContributorKeysByDate
    ? filterAggregatedSnapshotsByActiveCoverage(aggregated, options.expectedContributorKeysByDate)
    : store
    ? filterAggregatedSnapshotsByActiveCoverage(
        aggregated,
        await buildExpectedSnapshotContributorKeysByDate(store, startDate, endDate, persistence),
      )
    : { points: aggregated, hasSnapshotCoverageGap: false, latestPartialSnapshotDate: null };

  if (coverage.points.length > 0) {
    const datedFinance = store
      ? await buildDatedPerformanceFinance(store, startDate, endDate, reportingCurrency, persistence)
      : options.financeTrades
        ? await buildDatedPerformanceFinanceFromInputs(
            options.financeTrades,
            options.financeDividends ?? [],
            options.financeLotAllocations ?? [],
            startDate,
            endDate,
            reportingCurrency,
            persistence,
          )
        : null;
    let usedSnapshotFinanceFallback = false;
    const points: DashboardPerformancePointDto[] = coverage.points.map((p) => {
      const finance = datedFinance?.get(p.date) ?? null;
      const partialMetadata = partialMetadataForPoint(p, strictExpectedKeysByDate);
      if (!finance) {
        return translateAggregatedPerformancePoint(p, partialMetadata);
      }

      if (!p.fxAvailable) {
        return translateAggregatedPerformancePoint(p, partialMetadata);
      }

      if (!finance.fxAvailable) {
        usedSnapshotFinanceFallback = true;
        return translateAggregatedPerformancePoint(p, partialMetadata);
      }

      return buildPerformancePoint({
        date: p.date,
        marketValueAmount: p.totalMarketValue,
        bookCostAmount: finance.bookCostAmount,
        cumulativeRealizedPnlAmount: finance.cumulativeRealizedPnlAmount,
        cumulativeDividendsAmount: finance.cumulativeDividendsAmount,
        fxAvailable: true,
      }, partialMetadata);
    });
    const fxStatus: "complete" | "partial" | "missing" = (() => {
      let allAvail = true;
      let allMissing = true;
      for (const pt of points) {
        if (pt.fxAvailable) allMissing = false;
        else allAvail = false;
      }
      if (allAvail) return "complete";
      if (allMissing) return "missing";
      return "partial";
    })();
    return withPerformanceFreshness(
      {
        range,
        rangeStartDate: startDate,
        rangeEndDate: endDate,
        points,
        reportingCurrency,
        fxStatus,
      },
      asOf,
      {
        hasFinanceFxGap: usedSnapshotFinanceFallback,
        hasSnapshotCoverageGap: coverage.hasSnapshotCoverageGap,
        latestPartialSnapshotDate: coverage.latestPartialSnapshotDate,
      },
    );
  }

  return withPerformanceFreshness(
    { range, rangeStartDate: startDate, rangeEndDate: endDate, points: [], reportingCurrency, fxStatus: "complete" },
    asOf,
    {
      hasSnapshotCoverageGap: coverage.hasSnapshotCoverageGap,
      latestPartialSnapshotDate: coverage.latestPartialSnapshotDate,
    },
  );
}

/**
 * Build the lightweight performance DTO needed by valuation health.
 *
 * Valuation health only compares current value against the latest reliable
 * snapshot value and reads freshness diagnostics. It must preserve active
 * contributor coverage semantics, but it does not need the dated finance
 * reconstruction used by charts.
 */
export async function translateValuationHealthSnapshotPoints(
  userId: string,
  range: DashboardPerformanceRange,
  asOf: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
  store: Store,
): Promise<DashboardPerformanceDto> {
  const earliestTradeDate = store.accounting.facts.tradeEvents
    .map((trade) => trade.tradeDate)
    .sort()[0];
  const { startDate: rangeStartDate, endDate } = resolveRangeBounds(range, asOf, earliestTradeDate);
  const coverage = await loadValuationHealthSnapshotCoverage(
    userId,
    rangeStartDate,
    endDate,
    reportingCurrency,
    persistence,
    store,
  );

  if (coverage.points.length === 0) {
    return withPerformanceFreshness(
      { range, rangeStartDate, rangeEndDate: endDate, points: [], reportingCurrency, fxStatus: "complete" },
      asOf,
      {
        hasSnapshotCoverageGap: coverage.hasSnapshotCoverageGap,
        latestPartialSnapshotDate: coverage.latestPartialSnapshotDate,
      },
    );
  }

  const points = coverage.points.map((point) => translateAggregatedPerformancePoint(point));
  let allAvailable = true;
  let allMissing = true;
  for (const point of points) {
    if (point.fxAvailable) allMissing = false;
    else allAvailable = false;
  }
  const fxStatus = allAvailable ? "complete" : allMissing ? "missing" : "partial";

  return withPerformanceFreshness(
    {
      range,
      rangeStartDate,
      rangeEndDate: endDate,
      points,
      reportingCurrency,
      fxStatus,
    },
    asOf,
    {
      hasSnapshotCoverageGap: coverage.hasSnapshotCoverageGap,
      latestPartialSnapshotDate: coverage.latestPartialSnapshotDate,
    },
  );
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function loadValuationHealthSnapshotCoverage(
  userId: string,
  rangeStartDate: string,
  endDate: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
  store: Store,
): Promise<SnapshotCoverageResult> {
  const queryStartDates = buildValuationHealthSnapshotQueryStartDates(rangeStartDate, endDate);
  let hasSnapshotCoverageGap = false;
  let latestPartialSnapshotDate: string | null = null;

  for (const queryStartDate of queryStartDates) {
    const aggregated = await persistence.getAggregatedSnapshotsInReportingCurrency(
      userId,
      queryStartDate,
      endDate,
      reportingCurrency,
    );
    if (aggregated.length === 0 && queryStartDate !== rangeStartDate) {
      continue;
    }

    const coverage = filterAggregatedSnapshotsByActiveCoverage(
      aggregated,
      await buildExpectedSnapshotContributorKeysForTrades(
        store.accounting.facts.tradeEvents,
        queryStartDate,
        endDate,
        persistence,
        { omitNonTradingContributors: false },
      ),
    );
    hasSnapshotCoverageGap = hasSnapshotCoverageGap || coverage.hasSnapshotCoverageGap;
    latestPartialSnapshotDate = maxNullableDate(latestPartialSnapshotDate, coverage.latestPartialSnapshotDate);

    const hasReliablePoint = coverage.points.some((point) =>
      point.fxAvailable && point.totalMarketValue !== null && point.totalCostBasis !== null);
    if (coverage.points.length > 0 && (hasReliablePoint || queryStartDate === rangeStartDate)) {
      return {
        points: coverage.points,
        hasSnapshotCoverageGap,
        latestPartialSnapshotDate,
      };
    }
  }

  return { points: [], hasSnapshotCoverageGap, latestPartialSnapshotDate };
}

function buildValuationHealthSnapshotQueryStartDates(rangeStartDate: string, endDate: string): string[] {
  const boundedStartDate = maxDateString(
    rangeStartDate,
    addUtcDays(endDate, -VALUATION_HEALTH_SNAPSHOT_LOOKBACK_DAYS),
  );
  return boundedStartDate === rangeStartDate
    ? [rangeStartDate]
    : [boundedStartDate, rangeStartDate];
}

function addUtcDays(date: string, days: number): string {
  const oneDayMs = 86_400_000;
  const timestamp = new Date(`${date}T00:00:00.000Z`).getTime() + days * oneDayMs;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function maxDateString(left: string, right: string): string {
  return left >= right ? left : right;
}

function filterAggregatedSnapshotsByActiveCoverage(
  points: ReadonlyArray<AggregatedSnapshotPoint>,
  expectedKeysByDate: ReadonlyMap<string, ReadonlySet<string>>,
): SnapshotCoverageResult {
  let hasSnapshotCoverageGap = false;
  let latestPartialSnapshotDate: string | null = null;
  const filtered = points.filter((point) => {
    const expectedKeys = expectedKeysByDate.get(point.date);
    if (!expectedKeys || expectedKeys.size === 0) return true;

    // Older/fake persistence implementations may not expose contributor keys.
    // In that case, keep the point rather than assuming it is incomplete.
    if (!point.snapshotContributorKeys) return true;

    const missingKeys = missingContributorKeysForPoint(point, expectedKeysByDate);
    if (missingKeys.length > 0) {
      hasSnapshotCoverageGap = true;
      latestPartialSnapshotDate = maxNullableDate(latestPartialSnapshotDate, point.date);
      return false;
    }
    return true;
  });
  return { points: filtered, hasSnapshotCoverageGap, latestPartialSnapshotDate };
}

async function buildExpectedSnapshotContributorKeysByDate(
  store: Store,
  startDate: string,
  endDate: string,
  persistence: Persistence,
  options: { omitNonTradingContributors?: boolean } = {},
): Promise<Map<string, Set<string>>> {
  return buildExpectedSnapshotContributorKeysForTrades(
    store.accounting.facts.tradeEvents,
    startDate,
    endDate,
    persistence,
    options,
  );
}

export async function buildExpectedSnapshotContributorKeysForTrades(
  inputTrades: ReadonlyArray<PerformanceCoverageTrade>,
  startDate: string,
  endDate: string,
  persistence: Persistence,
  options: { omitNonTradingContributors?: boolean } = {},
): Promise<Map<string, Set<string>>> {
  const trades = sortPerformanceCoverageTrades(inputTrades);
  const activeQuantities = new Map<string, number>();
  const expectedByDate = new Map<string, Set<string>>();
  const contributors = new Map<string, Pick<PerformanceCoverageTrade, "ticker" | "marketCode">>();
  let tradeIndex = 0;

  function applyTradeQuantity(trade: PerformanceCoverageTrade): void {
    const key = performancePositionKey(trade);
    contributors.set(key, { ticker: trade.ticker, marketCode: trade.marketCode });
    const current = activeQuantities.get(key) ?? 0;
    const next = trade.type === "BUY"
      ? current + trade.quantity
      : Math.max(0, current - trade.quantity);
    if (next === 0) activeQuantities.delete(key);
    else activeQuantities.set(key, next);
  }

  while (tradeIndex < trades.length && trades[tradeIndex].tradeDate < startDate) {
    applyTradeQuantity(trades[tradeIndex]);
    tradeIndex += 1;
  }

  const oneDayMs = 86_400_000;
  for (
    let cursor = new Date(`${startDate}T00:00:00.000Z`).getTime();
    cursor <= new Date(`${endDate}T00:00:00.000Z`).getTime();
    cursor += oneDayMs
  ) {
    const currentDate = new Date(cursor).toISOString().slice(0, 10);
    while (tradeIndex < trades.length && trades[tradeIndex].tradeDate <= currentDate) {
      applyTradeQuantity(trades[tradeIndex]);
      tradeIndex += 1;
    }
    expectedByDate.set(currentDate, new Set(activeQuantities.keys()));
  }

  if (options.omitNonTradingContributors ?? true) {
    const tradingDatesByTickerMarket = await buildSnapshotTradingDatesByTickerMarket(
      contributors,
      startDate,
      endDate,
      persistence,
    );

    for (const [date, keys] of expectedByDate) {
      for (const key of [...keys]) {
        const contributor = contributors.get(key);
        const contributorTradingDates = contributor
          ? tradingDatesByTickerMarket.get(tickerMarketKey(contributor.ticker, contributor.marketCode))
          : undefined;
        if (!contributor || !contributorTradingDates?.has(date)) {
          keys.delete(key);
        }
      }
    }
  }

  return expectedByDate;
}

async function buildSnapshotTradingDatesByTickerMarket(
  contributors: ReadonlyMap<string, Pick<BookedTradeEvent, "ticker" | "marketCode">>,
  startDate: string,
  endDate: string,
  persistence: Persistence,
): Promise<Map<string, Set<string>>> {
  const tradingDatesByTickerMarket = new Map<string, Set<string>>();
  const pairsByTickerMarket = new Map<string, Pick<BookedTradeEvent, "ticker" | "marketCode">>();
  for (const contributor of contributors.values()) {
    pairsByTickerMarket.set(tickerMarketKey(contributor.ticker, contributor.marketCode), contributor);
  }

  const barsByTickerMarket = await persistence.getDailyBarsForTickerMarkets(
    [...pairsByTickerMarket.values()],
    startDate,
    endDate,
  );

  for (const contributor of contributors.values()) {
    const key = tickerMarketKey(contributor.ticker, contributor.marketCode);
    const tradingDates = tradingDatesByTickerMarket.get(key) ?? new Set<string>();
    const bars = barsByTickerMarket.get(key) ?? [];
    for (const bar of bars) {
      tradingDates.add(bar.barDate);
    }
    tradingDatesByTickerMarket.set(key, tradingDates);
  }
  return tradingDatesByTickerMarket;
}

function tickerMarketKey(ticker: string, marketCode: string): string {
  return `${ticker}\0${marketCode}`;
}

function withPerformanceFreshness(
  dto: Omit<DashboardPerformanceDto, "requestedAsOf" | "lastReliableDate" | "marketDataStaleSince">,
  requestedAsOf: string,
  options: {
    hasFinanceFxGap?: boolean;
    hasSnapshotCoverageGap?: boolean;
    latestPartialSnapshotDate?: string | null;
  } = {},
): DashboardPerformanceDto {
  const requestedAsOfDate = requestedAsOf.slice(0, 10);
  const latestSnapshotDate = dto.points.at(-1)?.date ?? null;
  const lastReliableDate =
    [...dto.points].reverse().find((point) => isReliablePerformancePoint(point))?.date ?? null;
  const latestComparableSnapshotDate =
    [...dto.points].reverse().find((point) => isReliablePerformancePoint(point) && !point.isPartialMarketData)?.date ?? null;
  const latestPartialSnapshotDate = maxNullableDate(
    options.latestPartialSnapshotDate ?? null,
    [...dto.points].reverse().find((point) => point.isPartialMarketData && isReliablePerformancePoint(point))?.date ?? null,
  );
  const staleSinceDate =
    lastReliableDate !== null && lastReliableDate < requestedAsOfDate
      ? lastReliableDate
      : null;
  const knownGapReasons: NonNullable<DashboardPerformanceDto["diagnostics"]>["knownGapReasons"] = [];
  if (latestSnapshotDate === null || options.hasSnapshotCoverageGap) knownGapReasons.push("missing_snapshot");
  if (staleSinceDate !== null) knownGapReasons.push("stale_snapshot");
  if (dto.fxStatus !== "complete" || options.hasFinanceFxGap) knownGapReasons.push("missing_fx");

  return {
    ...dto,
    requestedAsOf: requestedAsOfDate,
    lastReliableDate,
    marketDataStaleSince: staleSinceDate,
    diagnostics: {
      latestSnapshotDate,
      latestReliableValuationDate: lastReliableDate,
      latestComparableSnapshotDate,
      latestPartialSnapshotDate,
      hasPartialMarketData: latestPartialSnapshotDate !== null,
      expectedLatestValuationDate: requestedAsOfDate,
      staleSinceDate,
      knownGapReasons,
    },
  };
}

function translateAggregatedPerformancePoint(
  point: {
    date: string;
    totalCostBasis: number;
    totalMarketValue: number | null;
    totalUnrealizedPnl: number | null;
    cumulativeRealizedPnl: number;
    cumulativeDividends: number;
    totalReturnAmount: number | null;
    totalReturnPercent: number | null;
    fxAvailable: boolean;
  },
  metadata: { isPartialMarketData?: boolean; missingContributorKeys?: string[] } = {},
): DashboardPerformancePointDto {
  return {
    date: point.date,
    totalCostAmount: point.fxAvailable ? point.totalCostBasis : null,
    marketValueAmount: point.fxAvailable ? point.totalMarketValue : null,
    unrealizedPnlAmount: point.fxAvailable ? point.totalUnrealizedPnl : null,
    cumulativeRealizedPnlAmount: point.fxAvailable ? point.cumulativeRealizedPnl : null,
    cumulativeDividendsAmount: point.fxAvailable ? point.cumulativeDividends : null,
    totalReturnAmount: point.fxAvailable ? point.totalReturnAmount : null,
    totalReturnPercent: point.fxAvailable ? point.totalReturnPercent : null,
    fxAvailable: point.fxAvailable,
    ...metadata,
  };
}

function isReliablePerformancePoint(point: DashboardPerformancePointDto): boolean {
  return point.fxAvailable && point.marketValueAmount !== null && point.totalCostAmount !== null;
}

type SyntheticQuoteInput = ReadonlyArray<QuoteSnapshot> | (() => Promise<ReadonlyArray<QuoteSnapshot>>);

interface DatedPerformanceFinancePoint {
  bookCostAmount: number | null;
  cumulativeRealizedPnlAmount: number | null;
  cumulativeDividendsAmount: number | null;
  fxAvailable: boolean;
}

interface PerformancePositionFinance {
  quantity: number;
  bookCostAmount: number;
  hasMissingBookCost: boolean;
}

function buildPerformancePoint(input: {
  date: string;
  marketValueAmount: number | null;
  bookCostAmount: number | null;
  cumulativeRealizedPnlAmount: number | null;
  cumulativeDividendsAmount: number | null;
  fxAvailable: boolean;
}, metadata: { isPartialMarketData?: boolean; missingContributorKeys?: string[] } = {}): DashboardPerformancePointDto {
  const totalReturnAmount =
    input.fxAvailable &&
    input.marketValueAmount !== null &&
    input.bookCostAmount !== null &&
    input.cumulativeRealizedPnlAmount !== null &&
    input.cumulativeDividendsAmount !== null
      ? roundToDecimal(
          input.marketValueAmount +
          input.cumulativeRealizedPnlAmount +
          input.cumulativeDividendsAmount -
          input.bookCostAmount,
          2,
        )
      : null;
  return {
    date: input.date,
    totalCostAmount: input.fxAvailable ? input.bookCostAmount : null,
    marketValueAmount: input.fxAvailable ? input.marketValueAmount : null,
    unrealizedPnlAmount:
      input.fxAvailable && input.marketValueAmount !== null && input.bookCostAmount !== null
        ? roundToDecimal(input.marketValueAmount - input.bookCostAmount, 2)
        : null,
    cumulativeRealizedPnlAmount: input.fxAvailable ? input.cumulativeRealizedPnlAmount : null,
    cumulativeDividendsAmount: input.fxAvailable ? input.cumulativeDividendsAmount : null,
    totalReturnAmount,
    totalReturnPercent:
      totalReturnAmount !== null && input.bookCostAmount !== null && input.bookCostAmount > 0
        ? (totalReturnAmount / input.bookCostAmount) * 100
        : null,
    fxAvailable: input.fxAvailable,
    ...metadata,
  };
}

function partialMetadataForPoint(
  point: AggregatedSnapshotPoint,
  expectedKeysByDate: ReadonlyMap<string, ReadonlySet<string>> | null,
): { isPartialMarketData?: boolean; missingContributorKeys?: string[] } {
  if (!expectedKeysByDate) return {};
  const missingContributorKeys = missingContributorKeysForPoint(point, expectedKeysByDate);
  return missingContributorKeys.length > 0
    ? { isPartialMarketData: true, missingContributorKeys }
    : {};
}

function missingContributorKeysForPoint(
  point: Pick<AggregatedSnapshotPoint, "date" | "snapshotContributorKeys">,
  expectedKeysByDate: ReadonlyMap<string, ReadonlySet<string>>,
): string[] {
  const expectedKeys = expectedKeysByDate.get(point.date);
  if (!expectedKeys || expectedKeys.size === 0 || !point.snapshotContributorKeys) return [];
  const actualKeys = new Set(point.snapshotContributorKeys);
  return [...expectedKeys].filter((expectedKey) => !actualKeys.has(expectedKey)).sort();
}

function maxNullableDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left >= right ? left : right;
}

async function buildDatedPerformanceFinance(
  store: Store,
  startDate: string,
  endDate: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
): Promise<Map<string, DatedPerformanceFinancePoint>> {
  return buildDatedPerformanceFinanceFromInputs(
    store.accounting.facts.tradeEvents,
    sortDividendEntries(store),
    store.accounting.projections?.lotAllocations ?? [],
    startDate,
    endDate,
    reportingCurrency,
    persistence,
  );
}

async function buildDatedPerformanceFinanceFromInputs(
  tradesInput: ReadonlyArray<PerformanceFinanceTrade>,
  dividendsInput: ReadonlyArray<DatedDividendEntry | SnapshotDividendInput>,
  allocationsInput: ReadonlyArray<PerformanceFinanceAllocation>,
  startDate: string,
  endDate: string,
  reportingCurrency: AccountDefaultCurrency,
  persistence: Persistence,
): Promise<Map<string, DatedPerformanceFinancePoint>> {
  const trades = sortPerformanceCoverageTrades(tradesInput);
  const dividendEntries = sortPerformanceFinanceDividends(dividendsInput);
  const fxCache = new Map<string, number | null>();
  const allocationsByTradeId = groupLotAllocationsByTradeId(allocationsInput);
  const positions = new Map<string, PerformancePositionFinance>();
  const points = new Map<string, DatedPerformanceFinancePoint>();
  let tradeIndex = 0;
  let dividendIndex = 0;
  let cumulativeRealizedPnlAmount = 0;
  let cumulativeDividendsAmount = 0;
  let realizedPnlComplete = true;
  let dividendsComplete = true;

  async function fxFor(src: string, date: string): Promise<number | null> {
    if (src === reportingCurrency) return 1.0;
    const cacheKey = `${src}|${date}`;
    if (fxCache.has(cacheKey)) return fxCache.get(cacheKey) ?? null;
    const rate = await persistence.getFxRate(src, reportingCurrency, date);
    fxCache.set(cacheKey, rate);
    return rate;
  }

  async function applyTrade(trade: PerformanceFinanceTrade): Promise<void> {
    const key = performancePositionKey(trade);
    const previous = positions.get(key) ?? {
      quantity: 0,
      bookCostAmount: 0,
      hasMissingBookCost: false,
    };
    const tradeFx = await fxFor(trade.priceCurrency, trade.tradeDate);

    if (trade.type === "BUY") {
      const nativeCost = roundToDecimal(trade.quantity * trade.unitPrice, 2) + trade.commissionAmount + trade.taxAmount;
      positions.set(key, {
        quantity: previous.quantity + trade.quantity,
        bookCostAmount: tradeFx === null
          ? previous.bookCostAmount
          : roundToDecimal(previous.bookCostAmount + nativeCost * tradeFx, 2),
        hasMissingBookCost: previous.hasMissingBookCost || tradeFx === null,
      });
      return;
    }

    const proceedsNative = roundToDecimal(trade.quantity * trade.unitPrice, 2) - trade.commissionAmount - trade.taxAmount;
    const allocatedBookCostResult = await resolveAllocatedBookCostAmount(trade, previous, allocationsByTradeId, fxFor);
    const realizedPnlResult = await resolveRealizedPnlAmount(
      trade,
      proceedsNative,
      tradeFx,
      allocatedBookCostResult,
      fxFor,
    );
    if (!realizedPnlResult.complete || previous.hasMissingBookCost) {
      realizedPnlComplete = false;
    } else {
      cumulativeRealizedPnlAmount = roundToDecimal(
        cumulativeRealizedPnlAmount + realizedPnlResult.amount,
        2,
      );
    }

    const nextQuantity = Math.max(0, previous.quantity - trade.quantity);
    if (nextQuantity === 0) {
      positions.delete(key);
      return;
    }
    positions.set(key, {
      quantity: nextQuantity,
      bookCostAmount: roundToDecimal(Math.max(0, previous.bookCostAmount - allocatedBookCostResult.amount), 2),
      hasMissingBookCost: previous.hasMissingBookCost || !allocatedBookCostResult.complete,
    });
  }

  async function applyDividend(entry: DatedDividendEntry): Promise<void> {
    const fx = await fxFor(entry.currency, entry.date);
    if (fx === null) {
      dividendsComplete = false;
      return;
    }
    cumulativeDividendsAmount = roundToDecimal(cumulativeDividendsAmount + entry.amount * fx, 2);
  }

  const oneDayMs = 86_400_000;
  while (tradeIndex < trades.length && trades[tradeIndex].tradeDate < startDate) {
    await applyTrade(trades[tradeIndex]);
    tradeIndex += 1;
  }
  while (dividendIndex < dividendEntries.length && dividendEntries[dividendIndex].date < startDate) {
    await applyDividend(dividendEntries[dividendIndex]);
    dividendIndex += 1;
  }

  for (
    let cursor = new Date(`${startDate}T00:00:00.000Z`).getTime();
    cursor <= new Date(`${endDate}T00:00:00.000Z`).getTime();
    cursor += oneDayMs
  ) {
    const currentDate = new Date(cursor).toISOString().slice(0, 10);
    while (tradeIndex < trades.length && trades[tradeIndex].tradeDate <= currentDate) {
      await applyTrade(trades[tradeIndex]);
      tradeIndex += 1;
    }
    while (dividendIndex < dividendEntries.length && dividendEntries[dividendIndex].date <= currentDate) {
      await applyDividend(dividendEntries[dividendIndex]);
      dividendIndex += 1;
    }

    const hasMissingBookCost = [...positions.values()].some((position) => position.hasMissingBookCost);
    points.set(currentDate, {
      bookCostAmount: hasMissingBookCost
        ? null
        : roundToDecimal([...positions.values()].reduce((sum, position) => sum + position.bookCostAmount, 0), 2),
      cumulativeRealizedPnlAmount: realizedPnlComplete ? cumulativeRealizedPnlAmount : null,
      cumulativeDividendsAmount: dividendsComplete ? cumulativeDividendsAmount : null,
      fxAvailable: !hasMissingBookCost && realizedPnlComplete && dividendsComplete,
    });
  }

  return points;
}

function groupLotAllocationsByTradeId(
  allocations: ReadonlyArray<PerformanceFinanceAllocation>,
): Map<string, PerformanceFinanceAllocation[]> {
  const byTradeId = new Map<string, PerformanceFinanceAllocation[]>();
  for (const allocation of allocations) {
    const group = byTradeId.get(allocation.tradeEventId) ?? [];
    group.push(allocation);
    byTradeId.set(allocation.tradeEventId, group);
  }
  return byTradeId;
}

async function resolveAllocatedBookCostAmount(
  trade: PerformanceFinanceTrade,
  previous: PerformancePositionFinance,
  allocationsByTradeId: ReadonlyMap<string, ReadonlyArray<PerformanceFinanceAllocation>>,
  fxFor: (src: string, date: string) => Promise<number | null>,
): Promise<{ amount: number; complete: boolean }> {
  const allocations = allocationsByTradeId.get(trade.id) ?? [];
  if (allocations.length === 0) {
    const allocatedQuantity = Math.min(trade.quantity, previous.quantity);
    return {
      amount: previous.quantity > 0
        ? roundToDecimal((previous.bookCostAmount / previous.quantity) * allocatedQuantity, 2)
        : 0,
      complete: !previous.hasMissingBookCost,
    };
  }

  let total = 0;
  for (const allocation of allocations) {
    const fx = await fxFor(allocation.costCurrency, allocation.lotOpenedAt);
    if (fx === null) {
      return { amount: 0, complete: false };
    }
    total += allocation.allocatedCostAmount * fx;
  }
  return { amount: roundToDecimal(total, 2), complete: true };
}

async function resolveRealizedPnlAmount(
  trade: PerformanceFinanceTrade,
  proceedsNative: number,
  tradeFx: number | null,
  allocatedBookCostResult: { amount: number; complete: boolean },
  fxFor: (src: string, date: string) => Promise<number | null>,
): Promise<{ amount: number; complete: boolean }> {
  if (trade.realizedPnlAmount !== undefined && trade.realizedPnlAmount !== null) {
    const realizedFx = await fxFor(trade.realizedPnlCurrency ?? trade.priceCurrency, trade.tradeDate);
    return realizedFx === null
      ? { amount: 0, complete: false }
      : { amount: roundToDecimal(trade.realizedPnlAmount * realizedFx, 2), complete: true };
  }

  if (!allocatedBookCostResult.complete) {
    return { amount: 0, complete: false };
  }

  return tradeFx === null
    ? { amount: 0, complete: false }
    : { amount: roundToDecimal(proceedsNative * tradeFx - allocatedBookCostResult.amount, 2), complete: true };
}

function sortPerformanceCoverageTrades<T extends PerformanceCoverageTrade>(trades: ReadonlyArray<T>): T[] {
  return [...trades].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      (a.bookingSequence ?? 0) - (b.bookingSequence ?? 0) ||
      (a.tradeTimestamp ?? "").localeCompare(b.tradeTimestamp ?? "") ||
      a.id.localeCompare(b.id),
  );
}

interface DatedDividendEntry {
  date: string;
  amount: number;
  currency: string;
}

function sortPerformanceFinanceDividends(
  dividends: ReadonlyArray<DatedDividendEntry | SnapshotDividendInput>,
): DatedDividendEntry[] {
  return dividends
    .map((entry) => "paymentDate" in entry
      ? {
          date: entry.paymentDate,
          amount: entry.amount,
          currency: entry.currency,
        }
      : entry)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function sortDividendEntries(store: Store): DatedDividendEntry[] {
  const eventById = new Map((store.marketData?.dividendEvents ?? []).map((event) => [event.id, event]));
  const ledgerEntries = store.accounting.facts.dividendLedgerEntries ?? [];
  const reversedIds = new Set(
    ledgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((id): id is string => Boolean(id)),
  );
  return ledgerEntries
    .filter((entry) =>
      (entry.postingStatus === "posted" || entry.postingStatus === "adjusted") &&
      !entry.reversalOfDividendLedgerEntryId &&
      !entry.supersededAt &&
      !reversedIds.has(entry.id) &&
      entry.receivedCashAmount !== 0)
    .map((entry): DatedDividendEntry | null => {
      const event = eventById.get(entry.dividendEventId);
      if (!event) return null;
      const date = event.paymentDate ?? entry.bookedAt?.slice(0, 10);
      if (!date) return null;
      return {
        date,
        amount: entry.receivedCashAmount,
        currency: event.cashDividendCurrency,
      };
    })
    .filter((entry): entry is DatedDividendEntry => entry !== null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function performancePositionKey(trade: Pick<BookedTradeEvent, "accountId" | "marketCode" | "ticker">): string {
  return `${trade.accountId}:${trade.marketCode}:${trade.ticker}`;
}

function translateHoldingGroup(
  group: DashboardOverviewHoldingGroupDto,
  reportingCurrency: AccountDefaultCurrency,
  fx: number | null,
): DashboardOverviewHoldingGroupDto {
  const children = group.children.map((child) => translateHoldingRow(child, reportingCurrency, fx));
  return {
    ...translateHoldingRow(group, reportingCurrency, fx),
    reportingDailyChangeAmount: rollupTranslatedDailyChange(children),
    children,
  };
}

function translateHoldingRow<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  row: T,
  reportingCurrency: AccountDefaultCurrency,
  fx: number | null,
): T {
  return {
    ...row,
    reportingCurrency,
    reportingCurrentUnitPrice:
      fx === null || row.currentUnitPrice === null ? null : roundToDecimal(row.currentUnitPrice * fx, 4),
    reportingCostBasisAmount: fx === null ? null : roundToDecimal(row.costBasisAmount * fx, 2),
    reportingMarketValueAmount:
      fx === null || row.marketValueAmount === null ? null : roundToDecimal(row.marketValueAmount * fx, 2),
    reportingUnrealizedPnlAmount:
      fx === null || row.unrealizedPnlAmount === null ? null : roundToDecimal(row.unrealizedPnlAmount * fx, 2),
    reportingDailyChangeAmount:
      fx === null || row.change === null || row.previousClose === null ? null : roundToDecimal(row.change * row.quantity * fx, 2),
    reportingAllocationPercent: null,
    fxStatus: fx === null ? "missing" : "complete",
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
  };
}

function rollupTranslatedDailyChange(rows: ReadonlyArray<DashboardOverviewHoldingChildDto>): number | null {
  if (rows.length === 0) return null;
  const values = rows.map((row) => row.reportingDailyChangeAmount ?? null);
  const presentValues = values.filter((value): value is number => value !== null);
  if (presentValues.length !== rows.length) return null;
  const total = presentValues.reduce((sum, value) => sum + value, 0);
  return roundToDecimal(total, 2);
}

function deriveAllocationDetails<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  rows: ReadonlyArray<T>,
  allocationBasis: HoldingAllocationBasis,
): Map<string, {
  reportingAllocationPercent: number | null;
  allocationBasisUsed: HoldingAllocationBasis;
  allocationBasisFallbackReason: "missing_quote" | null;
}> {
  const resolved = rows.map((row) => {
    const detail = resolveAllocationValue(row, allocationBasis);
    return { row, ...detail };
  });
  const total = resolved.reduce((sum, row) => sum + (row.value ?? 0), 0);

  return new Map(
    resolved.map((entry) => [
      allocationRowKey(entry.row),
      {
        reportingAllocationPercent: total > 0 && entry.value !== null
          ? roundToDecimal((entry.value / total) * 100, 4)
          : null,
        allocationBasisUsed: entry.allocationBasisUsed,
        allocationBasisFallbackReason: entry.allocationBasisFallbackReason,
      },
    ]),
  );
}

function resolveAllocationValue(
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
  allocationBasis: HoldingAllocationBasis,
): {
  value: number | null;
  allocationBasisUsed: HoldingAllocationBasis;
  allocationBasisFallbackReason: "missing_quote" | null;
} {
  if (allocationBasis === "cost_basis") {
    return {
      value: row.reportingCostBasisAmount,
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: null,
    };
  }

  if (row.reportingMarketValueAmount !== null) {
    return {
      value: row.reportingMarketValueAmount,
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
    };
  }

  if (row.quoteStatus === "missing" && row.reportingCostBasisAmount !== null) {
    return {
      value: row.reportingCostBasisAmount,
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: "missing_quote",
    };
  }

  return {
    value: null,
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
  };
}

function applyAllocationDetails<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  row: T,
  detailsByKey: ReadonlyMap<string, {
    reportingAllocationPercent: number | null;
    allocationBasisUsed: HoldingAllocationBasis;
    allocationBasisFallbackReason: "missing_quote" | null;
  }>,
): T {
  const details = detailsByKey.get(allocationRowKey(row));
  if (!details) return row;
  return {
    ...row,
    reportingAllocationPercent: details.reportingAllocationPercent,
    allocationBasisUsed: details.allocationBasisUsed,
    allocationBasisFallbackReason: details.allocationBasisFallbackReason,
  };
}

function allocationRowKey(
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
): string {
  return "children" in row
    ? `${row.ticker}:${row.marketCode}:group`
    : `${row.accountId}:${row.ticker}:${row.marketCode}:child`;
}
