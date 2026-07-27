import type { FastifyInstance } from "fastify";
import { derivePortfolioCapabilities, resolveRangeBounds, roundToDecimal, type QuoteSnapshot } from "@vakwen/domain";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  marketCodeFor,
  type AccountDefaultCurrency,
  type AllocationBucketDto,
  type CurrencyCode,
  type DashboardPerformanceRange,
  type DailyReviewReportDto,
  type DashboardPerformanceDto,
  type FxConversionRateDto,
  type MarketReportDto,
  type MarketCode,
  type PortfolioCapabilitiesDto,
  type PortfolioReportDto,
  type ReportDataHealthDto,
  type ReportDiagnosticsDto,
  type ReportFxStatusDto,
  type ReportHoldingRowDto,
  type ReportQueryStateDto,
  type ReportScope,
  type ReportSummaryTotalsDto,
  type ReportTickerAllocationRowDto,
  type ReportValuationBasisDto,
} from "@vakwen/shared-types";
import { buildDashboardOverview, buildOverviewHoldingGroups } from "./dashboard.js";
import {
  translateDailyCompatibleCurrentValue,
  translateOverviewHoldingGroups,
  translateOverviewSummary,
  translatePerformancePoints,
} from "./dashboardReportingCurrency.js";
import {
  isCurrentPriceState,
  resolveQuoteSnapshots,
  type QuoteSnapshotPair,
  type ResolvedQuoteSnapshot,
} from "./market-data/quoteSnapshotService.js";
import { enqueueDemandIntradayRefreshes } from "./market-data/intradayDemandRefresh.js";
import { isInstrumentQuoteable } from "./instrumentRegistry.js";
import { resolveEffectiveRanges, resolveReportingCurrency } from "./userPreferences.js";
import { resolveReportContext } from "./reportContext.js";
import { buildFxConversionRateRows } from "./fxConversionRates.js";
import {
  translateHistoricalFxAmounts,
  type HistoricalFxAmountResult,
  type HistoricalFxMissingRatePair,
} from "./historicalFxTranslation.js";
import { buildValuationHealth } from "./valuationHealth.js";
import { routeError } from "../lib/routeError.js";
import type { HoldingSnapshotScopePair, Persistence } from "../persistence/types.js";
import type { Store } from "../types/store.js";

export const REPORT_HOLDINGS_MAX_LIMIT = 1000;
const CATALOG_NAME_LOOKUP_BATCH_SIZE = 25;

export interface BuildReportInput {
  scope?: string;
  currencyMode?: string;
  currency?: string;
  range?: string;
  limit?: number;
  offset?: number;
}

interface PreparedReportData {
  capabilities: PortfolioCapabilitiesDto;
  reportQuery: ReportQueryStateDto;
  translatedSummary: Awaited<ReturnType<typeof translateOverviewSummary>>;
  translatedHoldingGroups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>;
  dailyCompatibleCurrentValueAmount: number | null;
  quotes: ResolvedQuoteSnapshot[];
  dataHealth: ReportDataHealthDto;
  fxStatus: ReportFxStatusDto;
  fxRates: FxConversionRateDto[];
  realizedPnl: HistoricalFxAmountResult & { transactionCount: number };
  trailingDividendIncome: HistoricalFxAmountResult;
  store: Store;
  scopedStore: Store;
  asOf: string;
  snapshotDiagnostics: Awaited<ReturnType<Persistence["getLatestSnapshotDiagnostics"]>>;
  expectedValuationDatesByMarket: Map<MarketCode, string | null>;
  valuationBasis: ReportValuationBasisDto;
}

type MissingFxRatePair = HistoricalFxMissingRatePair;
type ReportRangeBounds = { startDate: string; endDate: string };

type ReportKnownGapReason =
  | "missing_snapshot"
  | "stale_snapshot"
  | "missing_quote"
  | "provisional_quote"
  | "non_current_price"
  | "missing_fx"
  | "missing_provider_source";

type ReportMarketDiagnostics = Array<{
  marketCode: MarketCode;
  expectedLatestValuationDate: string | null;
  latestSnapshotDate: string | null;
  missingProviderSourceCount: number;
  providerSources: string[];
  basis?: ReportValuationBasisDto["markets"][number];
  knownGapReasons: ReportKnownGapReason[];
}>;

type ReportSnapshotGapHolding = NonNullable<ReportDiagnosticsDto["snapshotGapHoldings"]>[number];
type ReportSnapshotGapReason = ReportSnapshotGapHolding["knownGapReasons"][number];

export async function buildDailyReviewReport(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<DailyReviewReportDto> {
  const prepared = await prepareReportData(app, userId, input);
  const allRows = mapHoldingRows(prepared.translatedHoldingGroups);
  const holdings = pageRows(allRows, input.limit, input.offset);
  const snapshotGapHoldings = await buildSnapshotGapHoldings(app, userId, allRows, prepared.expectedValuationDatesByMarket, prepared.scopedStore);
  const suggestions = buildDailyReviewSuggestions(prepared, allRows);
  const topMovers = [...allRows]
    .sort((left, right) => Math.abs(right.dailyChangeAmount ?? 0) - Math.abs(left.dailyChangeAmount ?? 0))
    .slice(0, 5);

  return {
    capabilities: prepared.capabilities,
    query: prepared.reportQuery,
    summary: buildSummaryTotals(
      prepared.translatedSummary,
      prepared.realizedPnl.amount,
      prepared.realizedPnl.transactionCount,
      prepared.trailingDividendIncome.amount,
    ),
    fxStatus: prepared.fxStatus,
    fxRates: prepared.fxRates,
    dataHealth: prepared.dataHealth,
    diagnostics: buildReportDiagnostics(prepared, holdings, {
      snapshotGapHoldings,
      topMovers: topMovers.length,
      suggestions: suggestions.length,
    }),
    suggestions,
    topMovers,
    holdings,
  };
}

export async function buildPortfolioReport(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<PortfolioReportDto> {
  const prepared = await prepareReportData(app, userId, input);
  const performance = await buildReportPerformance(app, userId, prepared.scopedStore, prepared.reportQuery, prepared.quotes);
  const valuationHealth = prepared.translatedHoldingGroups.length > 0
    ? await buildValuationHealth({
      app,
      userId,
      store: prepared.scopedStore,
      reportingCurrency: prepared.reportQuery.reportingCurrency,
      currentValueAmount: prepared.dailyCompatibleCurrentValueAmount,
      holdingGroups: prepared.translatedHoldingGroups,
      performance,
      asOf: prepared.asOf,
    })
    : undefined;
  const allRows = mapHoldingRows(prepared.translatedHoldingGroups);
  const topHoldings = [...allRows]
    .sort((left, right) => (right.reportingAllocationPercent ?? 0) - (left.reportingAllocationPercent ?? 0))
    .slice(0, 10);
  const byMarket = buildMarketAllocations(prepared.translatedHoldingGroups);
  const byAccount = buildAccountAllocations(prepared.scopedStore, prepared.translatedHoldingGroups, prepared.reportQuery.reportingCurrency);
  const byTicker = buildTickerAllocations(prepared.translatedHoldingGroups);
  const holdings = pageRows(allRows, input.limit, input.offset);
  const snapshotGapHoldings = await buildSnapshotGapHoldings(app, userId, allRows, prepared.expectedValuationDatesByMarket, prepared.scopedStore);

  return {
    capabilities: prepared.capabilities,
    query: prepared.reportQuery,
    summary: buildSummaryTotals(
      prepared.translatedSummary,
      prepared.realizedPnl.amount,
      prepared.realizedPnl.transactionCount,
      prepared.trailingDividendIncome.amount,
    ),
    fxStatus: prepared.fxStatus,
    fxRates: prepared.fxRates,
    dataHealth: prepared.dataHealth,
    diagnostics: buildReportDiagnostics(prepared, holdings, {
      snapshotGapHoldings,
      performance,
      topHoldings: topHoldings.length,
      marketBuckets: byMarket.length,
      accountBuckets: byAccount.length,
      tickerBuckets: byTicker.length,
    }),
    performance: valuationHealth ? { ...performance, valuationHealth } : performance,
    ...(valuationHealth ? { valuationHealth } : {}),
    allocation: {
      byMarket,
      byAccount,
      byTicker,
    },
    concentration: {
      topHoldings,
    },
    income: {
      trailingDividendAmount: prepared.trailingDividendIncome.amount,
      recentDividendCount: countActivePostedDividends(prepared.scopedStore),
    },
    holdings,
  };
}

export async function buildMarketReport(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<MarketReportDto> {
  const prepared = await prepareReportData(app, userId, input);
  const performance = await buildReportPerformance(app, userId, prepared.scopedStore, prepared.reportQuery, prepared.quotes);
  const valuationHealth = prepared.translatedHoldingGroups.length > 0
    ? await buildValuationHealth({
      app,
      userId,
      store: prepared.scopedStore,
      reportingCurrency: prepared.reportQuery.reportingCurrency,
      currentValueAmount: prepared.dailyCompatibleCurrentValueAmount,
      holdingGroups: prepared.translatedHoldingGroups,
      performance,
      asOf: prepared.asOf,
    })
    : undefined;
  const allRows = mapHoldingRows(prepared.translatedHoldingGroups);
  const marketSummary = buildMarketAllocations(prepared.translatedHoldingGroups);
  const topHoldings = [...allRows]
    .sort((left, right) => (right.reportingMarketValueAmount ?? 0) - (left.reportingMarketValueAmount ?? 0))
    .slice(0, 10);
  const detail = pageRows(allRows, input.limit, input.offset);
  const snapshotGapHoldings = await buildSnapshotGapHoldings(app, userId, allRows, prepared.expectedValuationDatesByMarket, prepared.scopedStore);

  return {
    capabilities: prepared.capabilities,
    query: prepared.reportQuery,
    summary: buildSummaryTotals(
      prepared.translatedSummary,
      prepared.realizedPnl.amount,
      prepared.realizedPnl.transactionCount,
      prepared.trailingDividendIncome.amount,
    ),
    fxStatus: prepared.fxStatus,
    fxRates: prepared.fxRates,
    dataHealth: prepared.dataHealth,
    diagnostics: buildReportDiagnostics(prepared, detail, {
      snapshotGapHoldings,
      performance,
      topHoldings: topHoldings.length,
      marketBuckets: marketSummary.length,
    }),
    performance: valuationHealth ? { ...performance, valuationHealth } : performance,
    ...(valuationHealth ? { valuationHealth } : {}),
    marketSummary,
    topHoldings,
    detail,
  };
}

async function prepareReportData(
  app: FastifyInstance,
  userId: string,
  input: BuildReportInput,
): Promise<PreparedReportData> {
  const [store, prefs] = await Promise.all([
    app.persistence.loadOverviewReadStore(userId),
    app.persistence.getUserPreferences(userId),
  ]);
  const capabilities = derivePortfolioCapabilities(store.accounts);
  const { ranges } = await resolveEffectiveRanges(app.persistence, userId, prefs);
  const context = resolveReportContext({
    scope: input.scope,
    currencyMode: input.currencyMode,
    currency: input.currency,
    defaultReportingCurrency: resolveReportingCurrency(prefs),
  });
  const range = resolveReportRange(input.range, ranges);
  const scopedStore = scopeStore(store, context.scope);
  const earliestTradeDate = scopedStore.accounting.facts.tradeEvents
    .map((trade) => trade.tradeDate)
    .sort()[0];
  const rangeBounds = resolveRangeBounds(range, new Date().toISOString().slice(0, 10), earliestTradeDate);
  const quoteableTickers = new Set(
    scopedStore.instruments
      .filter((instrument) => isInstrumentQuoteable(instrument))
      .map((instrument) => instrument.ticker),
  );
  const symbols = [...new Set(
    scopedStore.accounting.projections.holdings
      .map((holding) => holding.ticker)
      .filter((symbol) => quoteableTickers.has(symbol)),
  )];
  const { pairs, settledByMarket } = await buildQuoteInputs(app, scopedStore, symbols);
  const now = new Date();
  try {
    await enqueueDemandIntradayRefreshes({
      pairs,
      boss: app.boss,
      persistence: app.persistence,
      tradingCalendar: app.tradingCalendarCache,
      log: app.log,
      now,
    });
  } catch (error) {
    app.log.warn(
      {
        err: error instanceof Error ? error.message : String(error),
        pairCount: pairs.length,
      },
      "report_intraday_demand_refresh_failed_degrading_to_daily_bars",
    );
  }
  const snapshotMap = await resolveQuoteSnapshots(pairs, app.persistence, settledByMarket, {
    mode: "displayed",
    now,
    tradingCalendar: app.tradingCalendarCache,
    heldPairs: new Set(pairs
      .filter((pair): pair is { ticker: string; marketCode: MarketCode } => pair.marketCode !== undefined)
      .map((pair) => `${pair.ticker}:${pair.marketCode}`)),
  });
  const quotes = Object.values(snapshotMap).filter((quote): quote is ResolvedQuoteSnapshot => quote !== null);
  const asOf = rangeBounds.endDate;
  const overview = buildDashboardOverview(scopedStore, { integrityIssue: null, quotes, summaryAsOf: asOf });
  const translatedSummary = await translateOverviewSummary(
    overview.summary,
    overview.holdings,
    overview.dividends,
    context.reportingCurrency,
    asOf,
    app.persistence,
  );
  const translatedHoldingGroups = await attachInstrumentNames(await translateOverviewHoldingGroups(
    buildOverviewHoldingGroups(scopedStore, overview.holdings),
    context.reportingCurrency,
    "market_value",
    asOf,
    app.persistence,
  ), scopedStore, app.persistence);
  const dailyCompatibleCurrentValueAmount = await translateDailyCompatibleCurrentValue(
    translatedHoldingGroups,
    quotes,
    context.reportingCurrency,
    asOf,
    app.persistence,
  );

  const [realizedPnl, trailingDividendIncome] = await Promise.all([
    translateTradeAmounts(scopedStore, context.reportingCurrency, app.persistence, "realized_pnl", rangeBounds),
    buildTrailingDividendIncome(scopedStore, context.reportingCurrency, app.persistence),
  ]);
  const historicalMissingRatePairs = dedupeMissingRatePairs([
    ...realizedPnl.missingRatePairs,
    ...trailingDividendIncome.missingRatePairs,
  ]);
  const fxStatus = await buildFxStatus(app, scopedStore, context.reportingCurrency, asOf, historicalMissingRatePairs, rangeBounds);
  const fxRates = await buildFxConversionRateRows(
    app.persistence,
    fxStatus.nativeCurrencies,
    context.reportingCurrency,
    asOf,
  );
  const snapshotScopePairs = buildSnapshotScopePairs(context.scope, scopedStore);
  const snapshotDiagnostics = snapshotScopePairs && snapshotScopePairs.length === 0
    ? { latestSnapshotDate: null, missingProviderSourceCount: 0, markets: [] }
    : await app.persistence.getLatestSnapshotDiagnostics(userId, snapshotScopePairs);
  const expectedValuationDatesByMarket = await buildExpectedValuationDatesByMarket(app, scopedStore, asOf);
  const basisExpectedValuationDatesByMarket = await buildExpectedValuationDatesByMarket(app, scopedStore, asOf, context.scope);
  const reportQuery = {
    scope: context.scope,
    currencyMode: context.currencyMode,
    currency: context.currency,
    reportingCurrency: context.reportingCurrency,
    nativeCurrency: context.nativeCurrency,
    range,
    rangeStartDate: rangeBounds.startDate,
    rangeEndDate: rangeBounds.endDate,
    asOf,
  };
  return {
    capabilities,
    reportQuery,
    translatedSummary,
    translatedHoldingGroups,
    dailyCompatibleCurrentValueAmount,
    quotes,
    dataHealth: buildDataHealth(translatedHoldingGroups, historicalMissingRatePairs.length),
    fxStatus,
    fxRates,
    realizedPnl,
    trailingDividendIncome,
    store,
    scopedStore,
    asOf,
    snapshotDiagnostics,
    expectedValuationDatesByMarket,
    valuationBasis: await buildReportValuationBasis(
      app.persistence,
      translatedHoldingGroups,
      basisExpectedValuationDatesByMarket,
      reportQuery,
      fxRates,
    ),
  };
}

function resolveReportRange(inputRange: string | undefined, ranges: readonly string[]): string {
  const fallbackRange = ranges[0] ?? "1Y";
  if (inputRange === undefined) return fallbackRange;

  const range = inputRange.trim();
  if (!ranges.includes(range)) {
    throw routeError(400, "invalid_report_range", `range must be one of ${ranges.join(", ")}`);
  }
  return range;
}

function scopeStore(store: Store, scope: ReportScope): Store {
  if (scope === "all") return store;
  const instrumentMarketsByTicker = buildInstrumentMarketsByTicker(store);
  const tradeMarketsByHoldingKey = buildTradeMarketsByHoldingKey(store);
  const scopedHoldings = store.accounting.projections.holdings.filter((holding) =>
    resolveHoldingMarketCode(holding, tradeMarketsByHoldingKey, instrumentMarketsByTicker) === scope);
  const scopedLots = store.accounting.projections.lots.filter((lot) =>
    resolveLotMarketCode(lot, tradeMarketsByHoldingKey, instrumentMarketsByTicker) === scope);
  const scopedTrades = store.accounting.facts.tradeEvents.filter((trade) =>
    trade.marketCode === scope);
  const marketDividendEventIds = new Set(
    store.marketData.dividendEvents
      .filter((event) => (event.marketCode ?? resolveTickerMarketCode(event.ticker, event.cashDividendCurrency, instrumentMarketsByTicker)) === scope)
      .map((event) => event.id),
  );
  const scopedDividendLedgerEntries = store.accounting.facts.dividendLedgerEntries.filter((entry) =>
    marketDividendEventIds.has(entry.dividendEventId));
  const scopedDividendLedgerIds = new Set(scopedDividendLedgerEntries.map((entry) => entry.id));
  const scopedAccountIds = new Set([
    ...scopedHoldings.map((holding) => holding.accountId),
    ...scopedTrades.map((trade) => trade.accountId),
    ...scopedDividendLedgerEntries.map((entry) => entry.accountId),
  ]);
  const scopedTickers = new Set([
    ...scopedHoldings.map((holding) => holding.ticker),
    ...scopedTrades.map((trade) => trade.ticker),
    ...store.marketData.dividendEvents
      .filter((event) => marketDividendEventIds.has(event.id))
      .map((event) => event.ticker),
  ]);

  return {
    ...store,
    accounts: store.accounts.filter((account) => scopedAccountIds.has(account.id)),
    instruments: store.instruments.filter((instrument) =>
      instrument.marketCode === scope && scopedTickers.has(instrument.ticker)),
    accounting: {
      ...store.accounting,
      facts: {
        ...store.accounting.facts,
        tradeEvents: scopedTrades,
        dividendLedgerEntries: scopedDividendLedgerEntries,
        dividendDeductionEntries: store.accounting.facts.dividendDeductionEntries
          .filter((entry) => scopedDividendLedgerIds.has(entry.dividendLedgerEntryId)),
      },
      projections: {
        ...store.accounting.projections,
        holdings: scopedHoldings,
        lots: scopedLots,
      },
    },
    marketData: {
      ...store.marketData,
      dividendEvents: store.marketData.dividendEvents.filter((entry) => marketDividendEventIds.has(entry.id)),
    },
  };
}

function resolveHoldingMarketCode(
  holding: Store["accounting"]["projections"]["holdings"][number],
  tradeMarketsByHoldingKey: ReadonlyMap<string, readonly MarketCode[]>,
  instrumentMarketsByTicker: ReadonlyMap<string, readonly MarketCode[]>,
): MarketCode {
  const tradeMarkets = tradeMarketsByHoldingKey.get(`${holding.accountId}\0${holding.ticker}`) ?? [];
  if (tradeMarkets.length === 1) return tradeMarkets[0]!;
  return resolveTickerMarketCode(holding.ticker, holding.currency, instrumentMarketsByTicker);
}

function resolveLotMarketCode(
  lot: Store["accounting"]["projections"]["lots"][number],
  tradeMarketsByHoldingKey: ReadonlyMap<string, readonly MarketCode[]>,
  instrumentMarketsByTicker: ReadonlyMap<string, readonly MarketCode[]>,
): MarketCode {
  const tradeMarkets = tradeMarketsByHoldingKey.get(`${lot.accountId}\0${lot.ticker}`) ?? [];
  if (tradeMarkets.length === 1) return tradeMarkets[0]!;
  return resolveTickerMarketCode(lot.ticker, lot.costCurrency, instrumentMarketsByTicker);
}

function resolveTickerMarketCode(
  ticker: string,
  fallbackCurrency: CurrencyCode,
  instrumentMarketsByTicker: ReadonlyMap<string, readonly MarketCode[]>,
): MarketCode {
  const instrumentMarkets = instrumentMarketsByTicker.get(ticker) ?? [];
  if (instrumentMarkets.length === 1) return instrumentMarkets[0]!;
  return marketCodeFor(fallbackCurrency);
}

function buildInstrumentMarketsByTicker(store: Store): Map<string, readonly MarketCode[]> {
  const byTicker = new Map<string, Set<MarketCode>>();
  for (const instrument of store.instruments) {
    if (!(MARKET_CODES as readonly string[]).includes(instrument.marketCode)) continue;
    const markets = byTicker.get(instrument.ticker) ?? new Set<MarketCode>();
    markets.add(instrument.marketCode as MarketCode);
    byTicker.set(instrument.ticker, markets);
  }
  return new Map([...byTicker.entries()].map(([ticker, markets]) => [ticker, [...markets].sort()]));
}

function buildTradeMarketsByHoldingKey(store: Store): Map<string, readonly MarketCode[]> {
  const byHolding = new Map<string, Set<MarketCode>>();
  for (const trade of store.accounting.facts.tradeEvents) {
    if (!(MARKET_CODES as readonly string[]).includes(trade.marketCode)) continue;
    const key = `${trade.accountId}\0${trade.ticker}`;
    const markets = byHolding.get(key) ?? new Set<MarketCode>();
    markets.add(trade.marketCode as MarketCode);
    byHolding.set(key, markets);
  }
  return new Map([...byHolding.entries()].map(([key, markets]) => [key, [...markets].sort()]));
}

async function buildQuoteInputs(
  app: FastifyInstance,
  store: Store,
  tickers: ReadonlyArray<string>,
): Promise<{ pairs: QuoteSnapshotPair[]; settledByMarket: Map<MarketCode, string> }> {
  const tickerToMarkets = new Map<string, Set<MarketCode>>();
  for (const inst of store.instruments) {
    if (!(MARKET_CODES as readonly string[]).includes(inst.marketCode)) continue;
    const markets = tickerToMarkets.get(inst.ticker) ?? new Set<MarketCode>();
    markets.add(inst.marketCode as MarketCode);
    tickerToMarkets.set(inst.ticker, markets);
  }
  const pairs: QuoteSnapshotPair[] = tickers.flatMap((ticker) => {
    const markets = tickerToMarkets.get(ticker);
    return markets ? [...markets].map((marketCode) => ({ ticker, marketCode })) : [{ ticker }];
  });
  const settledByMarket = new Map<MarketCode, string>();
  for (const pair of pairs) {
    if (!pair.marketCode || settledByMarket.has(pair.marketCode as MarketCode)) continue;
    settledByMarket.set(
      pair.marketCode as MarketCode,
      await app.tradingCalendarCache.latestSettledTradingDay(pair.marketCode as MarketCode, new Date()),
    );
  }
  return { pairs, settledByMarket };
}

function mapHoldingRows(groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>): ReportHoldingRowDto[] {
  return groups.map((group) => {
    const fxRateToReporting = deriveFxRateToReporting(group);
    return {
      ticker: group.ticker,
      instrumentName: group.instrumentName ?? null,
      marketCode: group.marketCode,
      accountCount: group.accountCount,
      accounts: group.children
        .map((child) => ({
          id: child.accountId,
          name: child.accountName?.trim() || child.accountId,
        }))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)),
      quantity: group.quantity,
      nativeCurrency: group.currency,
      nativeAverageCostPerShare: group.averageCostPerShare,
      nativeCurrentUnitPrice: group.currentUnitPrice,
      nativeCostBasisAmount: group.costBasisAmount,
      nativeMarketValueAmount: group.marketValueAmount,
      reportingCurrency: group.reportingCurrency,
      reportingAverageCostPerShare: translateUnitAmount(group.averageCostPerShare, fxRateToReporting),
      reportingCurrentUnitPrice: translateUnitAmount(group.currentUnitPrice, fxRateToReporting),
      reportingCostBasisAmount: group.reportingCostBasisAmount,
      reportingMarketValueAmount: group.reportingMarketValueAmount,
      reportingUnrealizedPnlAmount: group.reportingUnrealizedPnlAmount,
      reportingAllocationPercent: group.reportingAllocationPercent,
      fxRateToReporting,
      dailyChangeAmount: translateDailyChange(group),
      dailyChangePercent: group.changePercent,
      quoteStatus: group.quoteStatus,
      fxStatus: group.fxStatus,
      priceState: group.priceState,
    };
  });
}

function deriveFxRateToReporting(
  group: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>[number],
): number | null {
  if (group.currency === group.reportingCurrency) return 1;
  if (group.costBasisAmount > 0 && group.reportingCostBasisAmount !== null) {
    return roundToDecimal(group.reportingCostBasisAmount / group.costBasisAmount, 8);
  }
  if (group.marketValueAmount !== null && group.marketValueAmount > 0 && group.reportingMarketValueAmount !== null) {
    return roundToDecimal(group.reportingMarketValueAmount / group.marketValueAmount, 8);
  }
  return null;
}

function buildInstrumentNameLookup(
  store: Pick<Store, "marketData" | "instruments">,
): ReadonlyMap<string, string> {
  const lookup = new Map<string, string>();
  const addInstrument = (instrument: { ticker: string; marketCode: string; name?: string | null }) => {
    const name = instrument.name?.trim();
    if (!name) return;
    if (!isMarketCode(instrument.marketCode)) return;
    lookup.set(`${instrument.marketCode}:${instrument.ticker}`, name);
    if (!lookup.has(instrument.ticker)) {
      lookup.set(instrument.ticker, name);
    }
  };
  for (const instrument of store.marketData.instruments) {
    addInstrument(instrument);
  }
  for (const instrument of store.instruments) {
    addInstrument(instrument);
  }
  return lookup;
}

async function resolveMissingCatalogInstrumentNames(
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  existingNames: ReadonlyMap<string, string>,
  persistence: Pick<Persistence, "getInstrument">,
): Promise<ReadonlyMap<string, string>> {
  const missingPairs = new Map<string, { ticker: string; marketCode: MarketCode }>();
  for (const group of groups) {
    if (group.instrumentName) continue;
    if (existingNames.has(`${group.marketCode}:${group.ticker}`) || existingNames.has(group.ticker)) continue;
    missingPairs.set(`${group.marketCode}:${group.ticker}`, {
      ticker: group.ticker,
      marketCode: group.marketCode,
    });
  }
  const resolvedNames = new Map<string, string>();
  const pairs = [...missingPairs.values()];
  for (let index = 0; index < pairs.length; index += CATALOG_NAME_LOOKUP_BATCH_SIZE) {
    const chunk = pairs.slice(index, index + CATALOG_NAME_LOOKUP_BATCH_SIZE);
    const instruments = await Promise.all(chunk.map(async (pair) => ({
      ...pair,
      instrument: await persistence.getInstrument(pair.ticker, pair.marketCode),
    })));
    for (const { ticker, marketCode, instrument } of instruments) {
      const name = instrument?.name?.trim();
      if (!name) continue;
      resolvedNames.set(`${marketCode}:${ticker}`, name);
      if (!resolvedNames.has(ticker)) {
        resolvedNames.set(ticker, name);
      }
    }
  }
  return resolvedNames;
}

async function attachInstrumentNames(
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  store: Pick<Store, "marketData" | "instruments">,
  persistence: Pick<Persistence, "getInstrument">,
): Promise<Awaited<ReturnType<typeof translateOverviewHoldingGroups>>> {
  const storeInstrumentNames = buildInstrumentNameLookup(store);
  const catalogInstrumentNames = await resolveMissingCatalogInstrumentNames(groups, storeInstrumentNames, persistence);
  const instrumentNames = new Map([...storeInstrumentNames, ...catalogInstrumentNames]);
  return groups.map((group) => {
    const instrumentName = instrumentNames.get(`${group.marketCode}:${group.ticker}`)
      ?? instrumentNames.get(group.ticker)
      ?? group.instrumentName
      ?? null;
    return {
      ...group,
      instrumentName,
      children: group.children.map((child) => ({
        ...child,
        instrumentName: child.instrumentName ?? instrumentName,
      })),
    };
  });
}

function translateUnitAmount(value: number | null, fxRateToReporting: number | null): number | null {
  if (value === null || fxRateToReporting === null) return null;
  return roundToDecimal(value * fxRateToReporting, 4);
}

function translateDailyChange(row: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>[number]): number | null {
  return row.reportingDailyChangeAmount ?? null;
}

function buildDataHealth(
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  historicalMissingFxCount = 0,
): ReportDataHealthDto {
  const currentMissingFxCount = groups.filter((group) => group.fxStatus !== "complete").length;
  return {
    holdingCount: groups.length,
    missingQuoteCount: groups.filter((group) => group.quoteStatus === "missing").length,
    provisionalQuoteCount: groups.filter((group) => group.quoteStatus === "provisional").length,
    missingFxCount: currentMissingFxCount + historicalMissingFxCount,
    currentMissingFxCount,
    nonCurrentPriceCount: groups.filter((group) => !isCurrentPriceState(group.priceState)).length,
  };
}

function buildMarketHealthGapReasons(
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
): Map<MarketCode, Set<ReportKnownGapReason>> {
  const reasonsByMarket = new Map<MarketCode, Set<ReportKnownGapReason>>();
  const addMarketReason = (marketCode: MarketCode, reason: ReportKnownGapReason) => {
    const reasons = reasonsByMarket.get(marketCode) ?? new Set<ReportKnownGapReason>();
    reasons.add(reason);
    reasonsByMarket.set(marketCode, reasons);
  };

  for (const group of groups) {
    if (group.quoteStatus === "missing") addMarketReason(group.marketCode, "missing_quote");
    if (group.quoteStatus === "provisional") addMarketReason(group.marketCode, "provisional_quote");
    if (!isCurrentPriceState(group.priceState)) addMarketReason(group.marketCode, "non_current_price");
    if (group.fxStatus !== "complete") addMarketReason(group.marketCode, "missing_fx");
  }

  return reasonsByMarket;
}

async function buildReportValuationBasis(
  persistence: Persistence,
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  expectedValuationDatesByMarket: ReadonlyMap<MarketCode, string | null>,
  reportQuery: ReportQueryStateDto,
  fxRates: readonly FxConversionRateDto[],
): Promise<ReportValuationBasisDto> {
  const groupsByMarket = new Map<MarketCode, typeof groups>();
  for (const group of groups) {
    const marketGroups = groupsByMarket.get(group.marketCode) ?? [];
    marketGroups.push(group);
    groupsByMarket.set(group.marketCode, marketGroups);
  }
  for (const marketCode of expectedValuationDatesByMarket.keys()) {
    if (!groupsByMarket.has(marketCode)) groupsByMarket.set(marketCode, []);
  }

  const fxAsOfDate = latestFxAsOfDate(fxRates);
  const markets = await Promise.all([...groupsByMarket.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(async ([marketCode, marketGroups]) => {
      const priceStates = marketGroups.map((group) => group.priceState);
      const hasMissingQuote = priceStates.some((state) => state.asOfDate === null);
      const quoteAsOfDate = hasMissingQuote ? null : minNullableDateFromValues(priceStates.map((state) => state.asOfDate));
      const representative = pickRepresentativePriceState(priceStates, quoteAsOfDate);
      const quoteSources = uniqueSortedStrings(priceStates.flatMap((state) => state.source ? [state.source] : []));
      const fallbackProviders = uniqueSortedStrings(priceStates.flatMap((state) => state.fallbackProvider ? [state.fallbackProvider] : []));
      const fallbackQuoteCount = priceStates.filter((state) => state.fallbackProvider || state.basis === "fallback_eod_close").length;
      const marketFxAsOfDate = latestFxAsOfDateForMarket(marketGroups, fxRates, reportQuery.reportingCurrency);
      const closure = await findFirstMarketClosureAfterQuote(
        persistence,
        marketCode,
        quoteAsOfDate,
        reportQuery.asOf,
      );
      return {
        marketCode,
        requestedAsOf: reportQuery.asOf,
        expectedLatestValuationDate: expectedValuationDatesByMarket.get(marketCode) ?? null,
        quoteAsOfDate,
        quoteSource: representative?.source ?? null,
        quoteSources,
        quoteSourceKind: representative?.sourceKind ?? null,
        usesFallbackQuote: fallbackQuoteCount > 0,
        fallbackQuoteCount,
        fallbackProvider: representative?.fallbackProvider ?? null,
        fallbackProviders,
        holdingCount: marketGroups.length,
        fallbackStale: representative?.fallbackStale ?? null,
        calendarStatus: representative?.calendarStatus ?? null,
        marketState: representative?.marketState ?? null,
        marketStateReason: representative?.marketStateReason ?? null,
        marketLocalDate: representative?.marketLocalDate ?? representative?.localMarketDate ?? null,
        closureDate: closure.closureDate,
        closureName: closure.closureName,
        closureReason: closure.closureReason,
        fxAsOfDate: marketFxAsOfDate,
        reportingCurrency: reportQuery.reportingCurrency,
      };
    }));

  return {
    semantics: "current_report_valuation",
    reportingCurrency: reportQuery.reportingCurrency,
    reportAsOf: reportQuery.asOf,
    fxAsOfDate,
    markets,
  };
}

function uniqueSortedStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function latestFxAsOfDate(fxRates: readonly FxConversionRateDto[]): string | null {
  if (fxRates.length === 0) return null;
  return maxNullableDateFromValues(fxRates.map((rate) => rate.asOf));
}

function latestFxAsOfDateForMarket(
  marketGroups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  fxRates: readonly FxConversionRateDto[],
  reportingCurrency: AccountDefaultCurrency,
): string | null {
  const requiredCurrencies = new Set<AccountDefaultCurrency>();
  for (const group of marketGroups) {
    if (group.currency === reportingCurrency) continue;
    if (isAccountDefaultCurrency(group.currency)) requiredCurrencies.add(group.currency);
  }
  if (requiredCurrencies.size === 0) return null;
  return maxNullableDateFromValues(
    fxRates
      .filter((rate) => rate.toCurrency === reportingCurrency && requiredCurrencies.has(rate.fromCurrency))
      .map((rate) => rate.asOf),
  );
}

function pickRepresentativePriceState(
  priceStates: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>[number]["priceState"][],
  quoteAsOfDate: string | null,
): Awaited<ReturnType<typeof translateOverviewHoldingGroups>>[number]["priceState"] | null {
  if (priceStates.length === 0) return null;
  const withLatestDate = quoteAsOfDate
    ? priceStates.filter((state) => state.asOfDate === quoteAsOfDate)
    : priceStates;
  return [...withLatestDate].sort((left, right) =>
    priceStateBasisDisclosureRank(right) - priceStateBasisDisclosureRank(left)
    || (right.source ?? "").localeCompare(left.source ?? ""),
  )[0] ?? null;
}

function priceStateBasisDisclosureRank(state: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>[number]["priceState"]): number {
  if (state.basis === "fallback_eod_close") return 4;
  if (state.basis === "stale_close") return 3;
  if (state.basis === "previous_close" || state.basis === "pending_today_close") return 2;
  if (state.basis === "missing") return 1;
  return 0;
}

async function findFirstMarketClosureAfterQuote(
  persistence: Persistence,
  marketCode: MarketCode,
  quoteAsOfDate: string | null,
  requestedAsOf: string,
): Promise<Pick<ReportValuationBasisDto["markets"][number], "closureDate" | "closureName" | "closureReason">> {
  if (quoteAsOfDate === null || quoteAsOfDate >= requestedAsOf) {
    return { closureDate: null, closureName: null, closureReason: null };
  }
  let firstClosure: Pick<ReportValuationBasisDto["markets"][number], "closureDate" | "closureName" | "closureReason"> | null = null;
  let current = addDaysIsoDate(quoteAsOfDate, 1);
  while (current <= requestedAsOf) {
    const version = await persistence.getActiveMarketCalendarVersion(marketCode, Number(current.slice(0, 4)));
    if (!version) {
      return { closureDate: current, closureName: null, closureReason: "calendar_unknown" };
    }
    const exception = version.exceptions.find((candidate) => candidate.date === current);
    if (exception?.status === "closed") {
      firstClosure ??= {
        closureDate: current,
        closureName: exception.name,
        closureReason: "market_holiday",
      };
      current = addDaysIsoDate(current, 1);
      continue;
    }
    if (!exception && isWeekendIsoDate(current)) {
      firstClosure ??= { closureDate: current, closureName: null, closureReason: "weekend" };
      current = addDaysIsoDate(current, 1);
      continue;
    }
    return { closureDate: null, closureName: null, closureReason: null };
  }
  return firstClosure ?? { closureDate: null, closureName: null, closureReason: null };
}

function addDaysIsoDate(date: string, days: number): string {
  const oneDayMs = 24 * 60 * 60 * 1000;
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * oneDayMs).toISOString().slice(0, 10);
}

function isWeekendIsoDate(date: string): boolean {
  const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
  return day === 0 || day === 6;
}

function isAccountDefaultCurrency(currency: string): currency is AccountDefaultCurrency {
  return (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(currency);
}

function maxNullableDateFromValues(values: readonly (string | null | undefined)[]): string | null {
  return values.reduce<string | null>((latest, value) => value ? maxNullableDate(latest, value) : latest, null);
}

function minNullableDateFromValues(values: readonly (string | null | undefined)[]): string | null {
  return values.reduce<string | null>((earliest, value) => value ? minNullableDate(earliest, value) : earliest, null);
}

function addKnownGapReason(reasons: ReportKnownGapReason[], reason: ReportKnownGapReason): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function buildReportDiagnostics(
  prepared: PreparedReportData,
  rowsPage: ReturnType<typeof pageRows>,
  options: {
    performance?: DashboardPerformanceDto;
    snapshotGapHoldings?: ReportSnapshotGapHolding[];
    topMovers?: number;
    topHoldings?: number;
    marketBuckets?: number;
    accountBuckets?: number;
    tickerBuckets?: number;
    suggestions?: number;
  } = {},
): ReportDiagnosticsDto {
  const markets = resolveReportMarketDiagnostics(prepared);
  const performanceLastDate = options.performance?.lastReliableDate ?? findLastPerformancePointDate(options.performance);
  const latestReliableValuationDate = performanceLastDate ?? prepared.snapshotDiagnostics.latestSnapshotDate ?? null;
  const requestedAsOfDate = prepared.reportQuery.asOf.slice(0, 10);
  const expectedLatestValuationDate = maxExpectedValuationDate(prepared.expectedValuationDatesByMarket) ?? requestedAsOfDate;
  const marketStaleSinceDate = latestStaleMarketSnapshotDate(markets);
  const performanceStaleSinceDate = options.performance?.marketDataStaleSince
    && options.performance.marketDataStaleSince < expectedLatestValuationDate
    ? options.performance.marketDataStaleSince
    : null;
  const aggregateStaleSinceDate = latestReliableValuationDate !== null && latestReliableValuationDate < expectedLatestValuationDate
    ? latestReliableValuationDate
    : null;
  const staleSinceDate = minNullableDate(
    minNullableDate(performanceStaleSinceDate, aggregateStaleSinceDate),
    marketStaleSinceDate,
  );
  const knownGapReasons: ReportKnownGapReason[] = [];
  if (prepared.snapshotDiagnostics.latestSnapshotDate === null) knownGapReasons.push("missing_snapshot");
  if (staleSinceDate !== null) knownGapReasons.push("stale_snapshot");
  if (options.snapshotGapHoldings?.some((holding) => holding.knownGapReasons.includes("missing_snapshot"))) {
    addKnownGapReason(knownGapReasons, "missing_snapshot");
  }
  if (options.snapshotGapHoldings?.some((holding) => holding.knownGapReasons.includes("stale_snapshot"))) {
    addKnownGapReason(knownGapReasons, "stale_snapshot");
  }
  if (prepared.dataHealth.missingQuoteCount > 0) knownGapReasons.push("missing_quote");
  if (prepared.dataHealth.provisionalQuoteCount > 0) knownGapReasons.push("provisional_quote");
  if (prepared.dataHealth.nonCurrentPriceCount > 0) knownGapReasons.push("non_current_price");
  if (prepared.dataHealth.missingFxCount > 0) knownGapReasons.push("missing_fx");
  if (prepared.snapshotDiagnostics.missingProviderSourceCount > 0) knownGapReasons.push("missing_provider_source");
  return {
    scope: prepared.reportQuery.scope,
    reportingCurrency: prepared.reportQuery.reportingCurrency,
    requestedAsOf: prepared.reportQuery.asOf,
    lastValuationDate: latestReliableValuationDate,
    marketDataStaleSince: staleSinceDate,
    latestSnapshotDate: prepared.snapshotDiagnostics.latestSnapshotDate,
    latestReliableValuationDate,
    expectedLatestValuationDate,
    staleSinceDate,
    missingQuoteCount: prepared.dataHealth.missingQuoteCount,
    provisionalQuoteCount: prepared.dataHealth.provisionalQuoteCount,
    nonCurrentPriceCount: prepared.dataHealth.nonCurrentPriceCount,
    missingFxCount: prepared.dataHealth.missingFxCount,
    missingProviderSourceCount: prepared.snapshotDiagnostics.missingProviderSourceCount,
    valuationBasis: prepared.valuationBasis,
    knownGapReasons,
    markets,
    ...(options.snapshotGapHoldings ? { snapshotGapHoldings: options.snapshotGapHoldings } : {}),
    rowCounts: {
      holdingsTotal: rowsPage.total,
      holdingsReturned: rowsPage.rows.length,
      ...(options.topMovers !== undefined ? { topMovers: options.topMovers } : {}),
      ...(options.topHoldings !== undefined ? { topHoldings: options.topHoldings } : {}),
      ...(options.marketBuckets !== undefined ? { marketBuckets: options.marketBuckets } : {}),
      ...(options.accountBuckets !== undefined ? { accountBuckets: options.accountBuckets } : {}),
      ...(options.tickerBuckets !== undefined ? { tickerBuckets: options.tickerBuckets } : {}),
      ...(options.suggestions !== undefined ? { suggestions: options.suggestions } : {}),
    },
  } as ReportDiagnosticsDto;
}

async function buildSnapshotGapHoldings(
  app: FastifyInstance,
  userId: string,
  rows: ReportHoldingRowDto[],
  expectedValuationDatesByMarket: ReadonlyMap<MarketCode, string | null>,
  store: Store,
): Promise<ReportSnapshotGapHolding[]> {
  const pairs: Array<{ accountId: string; ticker: string; marketCode: MarketCode }> = [];
  const rowByTickerMarket = new Map<string, ReportHoldingRowDto>();
  const openedAtByScope = buildEarliestOpenDateBySnapshotScope(store);

  for (const row of rows) {
    const expectedLatestValuationDate = expectedValuationDatesByMarket.get(row.marketCode) ?? null;
    if (expectedLatestValuationDate === null) continue;
    rowByTickerMarket.set(snapshotGapTickerMarketKey(row.ticker, row.marketCode), row);
    for (const account of row.accounts ?? []) {
      const openedAt = openedAtByScope.get(snapshotGapAccountScopeKey(account.id, row.ticker, row.marketCode)) ?? null;
      if (openedAt !== null && openedAt > expectedLatestValuationDate) continue;
      pairs.push({
        accountId: account.id,
        ticker: row.ticker,
        marketCode: row.marketCode,
      });
    }
  }

  if (pairs.length === 0) return [];

  const latestDatesByScope = await app.persistence.getLatestHoldingSnapshotDatesByScope(userId, pairs);
  const gapsByTickerMarket = new Map<string, {
    affectedAccountCount: number;
    latestSnapshotDate: string | null;
    knownGapReasons: Set<ReportSnapshotGapReason>;
  }>();

  for (const pair of pairs) {
    const expectedLatestValuationDate = expectedValuationDatesByMarket.get(pair.marketCode) ?? null;
    if (expectedLatestValuationDate === null) continue;
    const latestSnapshotDate = latestDatesByScope.get(`${pair.accountId}\0${pair.ticker}\0${pair.marketCode}`) ?? null;
    const reason: ReportSnapshotGapReason | null = latestSnapshotDate === null
      ? "missing_snapshot"
      : latestSnapshotDate < expectedLatestValuationDate
        ? "stale_snapshot"
        : null;
    if (reason === null) continue;

    const key = snapshotGapTickerMarketKey(pair.ticker, pair.marketCode);
    const current = gapsByTickerMarket.get(key) ?? {
      affectedAccountCount: 0,
      latestSnapshotDate: null,
      knownGapReasons: new Set<ReportSnapshotGapReason>(),
    };
    current.affectedAccountCount += 1;
    current.latestSnapshotDate = maxNullableDate(current.latestSnapshotDate, latestSnapshotDate);
    current.knownGapReasons.add(reason);
    gapsByTickerMarket.set(key, current);
  }

  return [...gapsByTickerMarket.entries()]
    .map(([key, gap]) => {
      const row = rowByTickerMarket.get(key);
      if (!row) return null;
      const expectedLatestValuationDate = expectedValuationDatesByMarket.get(row.marketCode);
      if (expectedLatestValuationDate === null || expectedLatestValuationDate === undefined) return null;
      return {
        ticker: row.ticker,
        marketCode: row.marketCode,
        accountCount: row.accountCount,
        affectedAccountCount: gap.affectedAccountCount,
        latestSnapshotDate: gap.latestSnapshotDate,
        expectedLatestValuationDate,
        knownGapReasons: [...gap.knownGapReasons].sort(),
      };
    })
    .filter((gap): gap is ReportSnapshotGapHolding => gap !== null)
    .sort((left, right) =>
      left.marketCode.localeCompare(right.marketCode)
      || left.ticker.localeCompare(right.ticker));
}

function snapshotGapTickerMarketKey(ticker: string, marketCode: MarketCode): string {
  return `${ticker}\0${marketCode}`;
}

function snapshotGapAccountScopeKey(accountId: string, ticker: string, marketCode: MarketCode): string {
  return `${accountId}\0${ticker}\0${marketCode}`;
}

function buildEarliestOpenDateBySnapshotScope(store: Store): ReadonlyMap<string, string> {
  const tradeMarketsByHoldingKey = buildTradeMarketsByHoldingKey(store);
  const instrumentMarketsByTicker = buildInstrumentMarketsByTicker(store);
  const openedAtByScope = new Map<string, string>();
  for (const lot of store.accounting.projections.lots) {
    if (lot.openQuantity <= 0) continue;
    const tradeMarkets = tradeMarketsByHoldingKey.get(`${lot.accountId}\0${lot.ticker}`) ?? [];
    const marketCode = tradeMarkets.length === 1
      ? tradeMarkets[0]!
      : resolveTickerMarketCode(lot.ticker, lot.costCurrency, instrumentMarketsByTicker);
    const key = snapshotGapAccountScopeKey(lot.accountId, lot.ticker, marketCode);
    const current = openedAtByScope.get(key);
    if (current === undefined || lot.openedAt < current) {
      openedAtByScope.set(key, lot.openedAt);
    }
  }
  return openedAtByScope;
}

function maxNullableDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left > right ? left : right;
}

function minNullableDate(left: string | null, right: string | null): string | null {
  if (left === null) return right;
  if (right === null) return left;
  return left < right ? left : right;
}

function maxExpectedValuationDate(datesByMarket: ReadonlyMap<MarketCode, string | null>): string | null {
  let latest: string | null = null;
  for (const date of datesByMarket.values()) {
    latest = maxNullableDate(latest, date);
  }
  return latest;
}

function latestStaleMarketSnapshotDate(markets: ReportMarketDiagnostics): string | null {
  let date: string | null = null;
  for (const market of markets) {
    if (!market.knownGapReasons.includes("stale_snapshot")) continue;
    date = minNullableDate(date, market.latestSnapshotDate);
  }
  return date;
}

function resolveReportMarketDiagnostics(prepared: PreparedReportData): ReportMarketDiagnostics {
  const healthGapReasonsByMarket = buildMarketHealthGapReasons(prepared.translatedHoldingGroups);
  const valuationBasisByMarket = new Map(
    prepared.valuationBasis.markets.map((market) => [market.marketCode, market] as const),
  );
  const seededMarketsByCode = new Map<MarketCode, {
    marketCode: MarketCode;
    latestSnapshotDate: string | null;
    missingProviderSourceCount: number;
    providerSources: string[];
  }>();

  for (const marketCode of prepared.expectedValuationDatesByMarket.keys()) {
    seededMarketsByCode.set(marketCode, {
      marketCode,
      latestSnapshotDate: null,
      missingProviderSourceCount: 0,
      providerSources: [],
    });
  }

  for (const market of prepared.snapshotDiagnostics.markets) {
    if (!isMarketCode(market.marketCode)) continue;
    seededMarketsByCode.set(market.marketCode, {
      marketCode: market.marketCode,
      latestSnapshotDate: market.latestSnapshotDate,
      missingProviderSourceCount: market.missingProviderSourceCount,
      providerSources: market.providerSources,
    });
  }

  return [...seededMarketsByCode.values()]
    .map((market) => {
      const expectedLatestValuationDate = prepared.expectedValuationDatesByMarket.get(market.marketCode) ?? null;
      const knownGapReasons: ReportKnownGapReason[] = [];
      if (market.latestSnapshotDate === null) addKnownGapReason(knownGapReasons, "missing_snapshot");
      if (
        market.latestSnapshotDate !== null
        && expectedLatestValuationDate !== null
        && market.latestSnapshotDate < expectedLatestValuationDate
      ) {
        addKnownGapReason(knownGapReasons, "stale_snapshot");
      }
      if (market.missingProviderSourceCount > 0) addKnownGapReason(knownGapReasons, "missing_provider_source");
      for (const reason of healthGapReasonsByMarket.get(market.marketCode) ?? []) {
        addKnownGapReason(knownGapReasons, reason);
      }
      return {
        marketCode: market.marketCode,
        expectedLatestValuationDate,
        latestSnapshotDate: market.latestSnapshotDate,
        missingProviderSourceCount: market.missingProviderSourceCount,
        providerSources: market.providerSources,
        basis: valuationBasisByMarket.get(market.marketCode),
        knownGapReasons,
      };
    })
    .sort((left, right) => left.marketCode.localeCompare(right.marketCode));
}

function buildSnapshotScopePairs(
  scope: ReportScope,
  store: Store,
): HoldingSnapshotScopePair[] | undefined {
  if (scope === "all") return undefined;
  const pairs = new Map<string, HoldingSnapshotScopePair>();
  for (const trade of store.accounting.facts.tradeEvents) {
    if (trade.marketCode !== scope) continue;
    const key = `${trade.accountId}\0${trade.ticker}\0${trade.marketCode}`;
    pairs.set(key, {
      accountId: trade.accountId,
      ticker: trade.ticker,
      marketCode: trade.marketCode,
    });
  }
  return [...pairs.values()];
}

function findLastPerformancePointDate(performance: DashboardPerformanceDto | undefined): string | null {
  if (!performance) return null;
  for (let index = performance.points.length - 1; index >= 0; index -= 1) {
    const point = performance.points[index];
    if (
      point
      && point.fxAvailable
      && (
        point.marketValueAmount !== null
        || point.totalCostAmount !== null
        || point.totalReturnAmount !== null
        || point.totalReturnPercent !== null
      )
    ) {
      return point.date;
    }
  }
  return null;
}

async function buildFxStatus(
  app: FastifyInstance,
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  asOf: string,
  historicalMissingRatePairs: ReadonlyArray<MissingFxRatePair> = [],
  rangeBounds?: ReportRangeBounds,
): Promise<ReportFxStatusDto> {
  const nativeCurrencies = collectReportFxCurrencies(store, rangeBounds);
  const currentMissingRatePairs: MissingFxRatePair[] = [];
  for (const currency of nativeCurrencies) {
    if (currency === reportingCurrency) continue;
    const rate = await app.persistence.getFxRate(currency, reportingCurrency, asOf);
    if (rate === null) currentMissingRatePairs.push({ from: currency, to: reportingCurrency });
  }
  const missingRatePairs = dedupeMissingRatePairs([
    ...currentMissingRatePairs,
    ...historicalMissingRatePairs,
  ]);
  const currentMissingKeys = new Set(currentMissingRatePairs.map((pair) => `${pair.from}\0${pair.to}`));
  const requiredCurrencies = nativeCurrencies.filter((currency) => currency !== reportingCurrency);
  return {
    status: missingRatePairs.length === 0
      ? "complete"
      : requiredCurrencies.length > 0
        && requiredCurrencies.every((currency) => currentMissingKeys.has(`${currency}\0${reportingCurrency}`))
        ? "missing"
        : "partial",
    reportingCurrency,
    nativeCurrencies,
    missingRatePairs,
  };
}

function dedupeMissingRatePairs(pairs: ReadonlyArray<MissingFxRatePair>): MissingFxRatePair[] {
  const byKey = new Map<string, MissingFxRatePair>();
  for (const pair of pairs) {
    byKey.set(`${pair.from}\0${pair.to}`, pair);
  }
  return [...byKey.values()];
}

function collectReportFxCurrencies(store: Store, rangeBounds?: ReportRangeBounds): AccountDefaultCurrency[] {
  const currencies = new Set<AccountDefaultCurrency>();
  const addCurrency = (currency: CurrencyCode | string | null | undefined) => {
    if (typeof currency === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(currency)) {
      currencies.add(currency as AccountDefaultCurrency);
    }
  };

  for (const holding of store.accounting.projections.holdings) {
    addCurrency(holding.currency);
  }
  for (const trade of store.accounting.facts.tradeEvents) {
    if (trade.realizedPnlAmount === undefined || trade.realizedPnlAmount === null) continue;
    if (rangeBounds && (trade.tradeDate < rangeBounds.startDate || trade.tradeDate > rangeBounds.endDate)) continue;
    addCurrency(trade.realizedPnlCurrency ?? trade.priceCurrency);
  }
  const holdingTickers = new Set(store.accounting.projections.holdings.map((holding) => holding.ticker));
  const dividendEventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  for (const event of store.marketData.dividendEvents) {
    if (!holdingTickers.has(event.ticker)) continue;
    addCurrency(event.cashDividendCurrency);
  }
  const reversedIds = collectReversedDividendLedgerIds(store);
  for (const entry of store.accounting.facts.dividendLedgerEntries) {
    if (!isActivePostedDividend(entry, reversedIds) || entry.receivedCashAmount === 0) continue;
    addCurrency(dividendEventById.get(entry.dividendEventId)?.cashDividendCurrency);
  }
  return [...currencies];
}

function buildSummaryTotals(
  translatedSummary: Awaited<ReturnType<typeof translateOverviewSummary>>,
  realizedPnlAmount: number,
  realizedPnlTransactionCount: number,
  incomeAmount: number,
): ReportSummaryTotalsDto {
  return {
    costBasisAmount: translatedSummary.totalCostAmount,
    marketValueAmount: translatedSummary.marketValueAmount,
    unrealizedPnlAmount: translatedSummary.unrealizedPnlAmount,
    realizedPnlAmount,
    realizedPnlTransactionCount,
    dailyChangeAmount: translatedSummary.dailyChangeAmount,
    dailyChangePercent: translatedSummary.dailyChangePercent,
    incomeAmount,
    upcomingDividendCount: translatedSummary.upcomingDividendCount,
    upcomingDividendAmount: translatedSummary.upcomingDividendAmount,
  };
}

async function translateTradeAmounts(
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  rates: Pick<Persistence, "getFxRate">,
  _kind: "realized_pnl",
  rangeBounds: ReportRangeBounds,
): Promise<HistoricalFxAmountResult & { transactionCount: number }> {
  const realizedTrades = store.accounting.facts.tradeEvents
    .filter((trade) => trade.realizedPnlAmount !== undefined && trade.realizedPnlAmount !== null)
    .filter((trade) => trade.tradeDate >= rangeBounds.startDate && trade.tradeDate <= rangeBounds.endDate);
  const result = await translateHistoricalFxAmounts(
    realizedTrades
      .map((trade) => ({
        amount: trade.realizedPnlAmount as number,
        currency: (trade.realizedPnlCurrency ?? trade.priceCurrency) as AccountDefaultCurrency,
        date: trade.tradeDate,
      })),
    reportingCurrency,
    rates,
  );
  return { ...result, transactionCount: realizedTrades.length };
}

async function buildTrailingDividendIncome(
  store: Store,
  reportingCurrency: AccountDefaultCurrency,
  rates: Pick<Persistence, "getFxRate">,
): Promise<HistoricalFxAmountResult> {
  const reversedIds = collectReversedDividendLedgerIds(store);
  const dividendEventById = new Map(store.marketData.dividendEvents.map((event) => [event.id, event]));
  return translateHistoricalFxAmounts(
    store.accounting.facts.dividendLedgerEntries.flatMap((entry) => {
      if (!isActivePostedDividend(entry, reversedIds) || entry.receivedCashAmount === 0) return [];
      const event = dividendEventById.get(entry.dividendEventId);
      const date = event?.paymentDate ?? event?.exDividendDate ?? entry.bookedAt?.slice(0, 10);
      if (!date) return [];
      return [{
        amount: entry.receivedCashAmount,
        currency: (event?.cashDividendCurrency ?? "TWD") as AccountDefaultCurrency,
        date,
      }];
    }),
    reportingCurrency,
    rates,
  );
}

async function buildExpectedValuationDatesByMarket(
  app: FastifyInstance,
  store: Store,
  asOf: string,
  scope?: ReportScope,
): Promise<Map<MarketCode, string | null>> {
  const markets = new Set<MarketCode>();
  if (scope) {
    if (scope === "all") {
      for (const marketCode of MARKET_CODES) {
        markets.add(marketCode);
      }
    } else {
      markets.add(scope);
    }
  }
  for (const holding of store.accounting.projections.holdings) {
    markets.add(marketCodeFor(holding.currency));
  }
  for (const trade of store.accounting.facts.tradeEvents) {
    if (isMarketCode(trade.marketCode)) {
      markets.add(trade.marketCode);
    }
  }
  const entries = await Promise.all(
    [...markets].map(async (marketCode) => [
      marketCode,
      await app.tradingCalendarCache.latestSettledTradingDay(marketCode, new Date(asOf)),
    ] as const),
  );
  return new Map(entries);
}

function isMarketCode(value: string): value is MarketCode {
  return (MARKET_CODES as readonly string[]).includes(value);
}

function countActivePostedDividends(store: Store): number {
  const reversedIds = collectReversedDividendLedgerIds(store);
  return store.accounting.facts.dividendLedgerEntries.filter((entry) =>
    isActivePostedDividend(entry, reversedIds)).length;
}

function collectReversedDividendLedgerIds(store: Store): Set<string> {
  return new Set(
    store.accounting.facts.dividendLedgerEntries
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((id): id is string => Boolean(id)),
  );
}

function isActivePostedDividend(
  entry: Store["accounting"]["facts"]["dividendLedgerEntries"][number],
  reversedIds: ReadonlySet<string>,
): boolean {
  return (entry.postingStatus === "posted" || entry.postingStatus === "adjusted")
    && !entry.reversalOfDividendLedgerEntryId
    && !entry.supersededAt
    && !reversedIds.has(entry.id);
}

async function buildReportPerformance(
  app: FastifyInstance,
  userId: string,
  scopedStore: Store,
  query: ReportQueryStateDto,
  quotes: ReadonlyArray<QuoteSnapshot>,
): Promise<DashboardPerformanceDto> {
  const range = query.range ?? "1Y";
  if (query.scope === "all") {
    return translatePerformancePoints(userId, range, query.asOf, query.reportingCurrency, app.persistence, scopedStore, quotes);
  }

  const earliestTradeDate = scopedStore.accounting.facts.tradeEvents
    .map((trade) => trade.tradeDate)
    .sort()[0];
  if (!earliestTradeDate) {
    return emptyScopedPerformance(range, query.reportingCurrency);
  }
  const scopedPairs = new Map<string, HoldingSnapshotScopePair>();
  for (const trade of scopedStore.accounting.facts.tradeEvents) {
    scopedPairs.set(`${trade.accountId}\0${trade.ticker}\0${trade.marketCode}`, {
      accountId: trade.accountId,
      ticker: trade.ticker,
      marketCode: trade.marketCode,
    });
  }
  const pairs = [...scopedPairs.values()];
  if (pairs.length === 0) {
    return emptyScopedPerformance(range, query.reportingCurrency);
  }

  const scopedPersistence = new Proxy(app.persistence, {
    get(target, property, receiver) {
      if (property === "getAggregatedSnapshotsInReportingCurrency") {
        return (
          scopedUserId: string,
          scopedStartDate: string,
          scopedEndDate: string,
          reportingCurrency: AccountDefaultCurrency,
        ) => {
          return target.getAggregatedSnapshotsInReportingCurrencyForScope(
            scopedUserId,
            scopedStartDate,
            scopedEndDate,
            reportingCurrency,
            pairs,
          );
        };
      }
      return Reflect.get(target, property, receiver);
    },
  });

  return translatePerformancePoints(
    userId,
    range as DashboardPerformanceRange,
    query.asOf,
    query.reportingCurrency,
    scopedPersistence,
    scopedStore,
    quotes,
  );
}

function emptyScopedPerformance(
  range: string,
  reportingCurrency: AccountDefaultCurrency,
): DashboardPerformanceDto {
  return {
    range,
    points: [],
    reportingCurrency,
    fxStatus: "complete",
  };
}

function buildMarketAllocations(groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>): AllocationBucketDto[] {
  const byMarket = new Map<string, AllocationBucketDto>();
  for (const group of groups) {
    const current = byMarket.get(group.marketCode) ?? {
      key: group.marketCode,
      label: group.marketCode,
      reportingCurrency: group.reportingCurrency,
      amount: 0,
      allocationPercent: 0,
    };
    current.amount = (current.amount ?? 0) + (group.reportingMarketValueAmount ?? group.reportingCostBasisAmount ?? 0);
    current.allocationPercent = (current.allocationPercent ?? 0) + (group.reportingAllocationPercent ?? 0);
    byMarket.set(group.marketCode, current);
  }
  return [...byMarket.values()].sort((left, right) => (right.amount ?? 0) - (left.amount ?? 0));
}

function buildAccountAllocations(
  store: Store,
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
  reportingCurrency: AccountDefaultCurrency,
): AllocationBucketDto[] {
  const byAccount = new Map<string, AllocationBucketDto>();
  for (const group of groups) {
    for (const child of group.children) {
      const current = byAccount.get(child.accountId) ?? {
        key: child.accountId,
        label: store.accounts.find((account) => account.id === child.accountId)?.name ?? child.accountId,
        reportingCurrency,
        amount: 0,
        allocationPercent: 0,
      };
      current.amount = (current.amount ?? 0) + (child.reportingMarketValueAmount ?? child.reportingCostBasisAmount ?? 0);
      current.allocationPercent = (current.allocationPercent ?? 0) + (child.reportingAllocationPercent ?? 0);
      byAccount.set(child.accountId, current);
    }
  }
  return [...byAccount.values()].sort((left, right) => (right.amount ?? 0) - (left.amount ?? 0));
}

function buildTickerAllocations(
  groups: Awaited<ReturnType<typeof translateOverviewHoldingGroups>>,
): ReportTickerAllocationRowDto[] {
  return groups
    .map((group) => ({
      ticker: group.ticker,
      instrumentName: group.instrumentName ?? null,
      marketCode: group.marketCode,
      accountCount: group.accountCount,
      reportingCurrency: group.reportingCurrency,
      reportingAmount: group.reportingMarketValueAmount ?? group.reportingCostBasisAmount,
      portfolioAllocationPercent: group.reportingAllocationPercent,
      allocationBasisUsed: group.allocationBasisUsed,
      allocationBasisFallbackReason: group.allocationBasisFallbackReason,
      quoteStatus: group.quoteStatus,
      fxStatus: group.fxStatus,
    }))
    .sort((left, right) =>
      (right.portfolioAllocationPercent ?? Number.NEGATIVE_INFINITY)
      - (left.portfolioAllocationPercent ?? Number.NEGATIVE_INFINITY)
      || (right.reportingAmount ?? Number.NEGATIVE_INFINITY) - (left.reportingAmount ?? Number.NEGATIVE_INFINITY)
      || `${left.marketCode}:${left.ticker}`.localeCompare(`${right.marketCode}:${right.ticker}`),
    );
}

function buildDailyReviewSuggestions(prepared: PreparedReportData, rows: ReportHoldingRowDto[]) {
  const suggestions = [];
  if (prepared.dataHealth.missingFxCount > 0) {
    suggestions.push({
      code: "fx_missing",
      severity: "warning" as const,
      title: "FX coverage is incomplete",
      detail: `${prepared.dataHealth.missingFxCount} FX input(s) could not be translated into ${prepared.reportQuery.reportingCurrency}.`,
    });
  }
  if (prepared.dataHealth.missingQuoteCount > 0 || prepared.dataHealth.provisionalQuoteCount > 0) {
    suggestions.push({
      code: "quote_quality",
      severity: "warning" as const,
      title: "Quote coverage is mixed",
      detail: `${prepared.dataHealth.missingQuoteCount} group(s) are missing quotes and ${prepared.dataHealth.provisionalQuoteCount} use provisional quotes.`,
    });
  }
  const topHolding = [...rows].sort((left, right) => (right.reportingAllocationPercent ?? 0) - (left.reportingAllocationPercent ?? 0))[0];
  if (topHolding && (topHolding.reportingAllocationPercent ?? 0) >= 35) {
    suggestions.push({
      code: "concentration",
      severity: "info" as const,
      title: "Portfolio concentration is elevated",
      detail: `${topHolding.ticker} represents ${roundToDecimal(topHolding.reportingAllocationPercent ?? 0, 2)}% of scoped holdings value.`,
    });
  }
  const deepestLoss = [...rows]
    .filter((row) => row.reportingUnrealizedPnlAmount !== null)
    .sort((left, right) => (left.reportingUnrealizedPnlAmount ?? 0) - (right.reportingUnrealizedPnlAmount ?? 0))[0];
  if (deepestLoss && (deepestLoss.reportingUnrealizedPnlAmount ?? 0) < 0) {
    suggestions.push({
      code: "largest_unrealized_loss",
      severity: "info" as const,
      title: "Largest unrealized drawdown",
      detail: `${deepestLoss.ticker} is the deepest unrealized detractor at ${deepestLoss.reportingCurrency} ${Math.abs(deepestLoss.reportingUnrealizedPnlAmount ?? 0).toFixed(2)}.`,
    });
  }
  return suggestions.slice(0, 5);
}

function pageRows(rows: ReportHoldingRowDto[], limit?: number, offset?: number) {
  const safeLimit = Math.min(Math.max(limit ?? 25, 1), REPORT_HOLDINGS_MAX_LIMIT);
  const safeOffset = Math.max(offset ?? 0, 0);
  return {
    total: rows.length,
    limit: safeLimit,
    offset: safeOffset,
    rows: rows.slice(safeOffset, safeOffset + safeLimit),
  };
}
