import { capitalReductionAsOfDate, loadCapitalReductionValuations, registeredCapitalReductionValuationKey } from "./capitalReductionValuation.js";
import {
  calculateDividendCashReconciliation,
  resolveDividendStockEntitlement,
  resolveRangeBounds,
  roundToDecimal,
  type DailyBar,
} from "@vakwen/domain";
import {
  MARKET_CODES,
  type AccountDefaultCurrency,
  currencyFor,
  marketCodeFor,
  type DividendLedgerHistoryItemDto,
  type DividendLedgerHistoryPageDto,
  type DividendUpcomingListItemDto,
  type DividendUpcomingPageDto,
  type DashboardOverviewHoldingChildDto,
  type DashboardOverviewHoldingGroupDto,
  type DashboardOverviewRecentDividendDto,
  type DashboardOverviewUpcomingDividendDto,
  type HoldingActivityDividendsDto,
  type HoldingActivityPositionActionDto,
  type HoldingActivityPositionActionPageDto,
  type MarketCode,
  type TickerDetailsDto,
  type TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import type { PersistedTickerFundamentalsRecord, Persistence } from "../persistence/types.js";
import { routeError } from "../lib/routeError.js";
import { listDividendDeductionEntries, listDividendLedgerEntries, listTradeEvents } from "./accountingStore.js";
import { resolveDividendTickerName } from "./dividends.js";
import { deriveEligibleQuantityFromReplayStream } from "./replayPositionHistory.js";
import { createEmptyTickerFundamentals } from "./fundamentals/types.js";
import { historyStartFor } from "./market-data/types.js";
import {
  buildMissingPriceState,
  mapDailySourceKind,
  resolveQuoteSnapshots,
} from "./market-data/quoteSnapshotService.js";
import {
  getRegularSessionState,
  isRegularSessionMarketCode,
  type RegularSessionClock,
} from "./market-data/marketRegularSession.js";
import { resolveAccountDisplayName } from "./mcpAccountHelpers.js";
import { listHoldings } from "./portfolio.js";
import { createRealizedPnlBreakdownResolver } from "./realizedPnlBreakdown.js";
import type { DividendEvent, Store, Transaction } from "../types/store.js";

type TickerChartRange = "1M" | "3M" | "YTD" | "1Y" | "3Y" | "5Y" | "ALL";
type TickerChartSelection = TickerChartRange | "CUSTOM";

interface BuildTickerDetailsInput {
  persistence: Pick<Persistence, "getDailyBarsForTickerMarket" | "getLatestBarDatesByTickerMarket" | "getLatestBarsByTickerMarket" | "getLatestBars" | "getLatestIntradayOverlays" | "getInstrument" | "getFxRate" | "listHoldingSnapshots">;
  store: Store;
  userId: string;
  ticker: string;
  accountId?: string;
  accountIds?: readonly string[];
  marketCode?: MarketCode;
  reportingCurrency?: AccountDefaultCurrency;
  includeProvisional?: boolean;
  range?: TickerChartRange;
  startDate?: string;
  endDate?: string;
  loadChart?: boolean;
  getSettledTradingDay?: (marketCode: MarketCode) => Promise<string | null>;
  tradingCalendar?: RegularSessionClock;
  enqueueIntradayRefresh?: (input: { ticker: string; marketCode: MarketCode; now: Date }) => Promise<void>;
  fundamentalsRecord: PersistedTickerFundamentalsRecord | null;
  now?: Date;
}

interface ResolveTickerReadScopeInput {
  persistence: Pick<BuildTickerDetailsInput["persistence"], "getInstrument">;
  store: Store;
  userId: string;
  ticker: string;
  accountId?: string;
  accountIds?: readonly string[];
  marketCode?: MarketCode;
}

export interface ResolvedTickerReadScope {
  normalizedTicker: string;
  resolvedMarketCode: MarketCode;
  scopedAccountIds: Set<string>;
  filteredTransactions: Transaction[];
  filteredHoldings: ReturnType<typeof listHoldings>;
  instrument: Awaited<ReturnType<BuildTickerDetailsInput["persistence"]["getInstrument"]>>;
}

export async function resolveTickerReadScope(
  input: ResolveTickerReadScopeInput,
): Promise<ResolvedTickerReadScope> {
  const normalizedTicker = input.ticker.trim().toUpperCase();
  const accountById = new Map(input.store.accounts.map((account) => [account.id, account]));

  if (input.accountId && !accountById.has(input.accountId)) {
    throw routeError(404, "account_not_found", "Account not found");
  }
  const requestedAccountIds = input.accountIds?.length ? [...new Set(input.accountIds)] : [];
  for (const requestedAccountId of requestedAccountIds) {
    if (!accountById.has(requestedAccountId)) {
      throw routeError(404, "account_not_found", "Account not found");
    }
  }

  const requestedAccountIdSet = new Set(requestedAccountIds);
  const matchesRequestedAccountScope = (accountId: string) => (
    input.accountId
      ? accountId === input.accountId
      : requestedAccountIdSet.size > 0
        ? requestedAccountIdSet.has(accountId)
        : true
  );

  const matchingTrades = listTradeEvents(input.store)
    .filter((trade) => trade.ticker === normalizedTicker)
    .filter((trade) => matchesRequestedAccountScope(trade.accountId));
  const matchingHoldings = listHoldings(input.store, input.userId)
    .filter((holding) => holding.ticker === normalizedTicker)
    .filter((holding) => matchesRequestedAccountScope(holding.accountId));

  const resolvedMarketCode = await resolveMarketCode({
    requestedMarketCode: input.marketCode,
    requestedAccountId: input.accountId,
    requestedAccountIds,
    matchingTrades,
    matchingHoldings,
    accountById,
    getInstrument: (ticker, marketCode) => input.persistence.getInstrument(ticker, marketCode),
    ticker: normalizedTicker,
  });

  const instrument = await input.persistence.getInstrument(normalizedTicker, resolvedMarketCode);
  if (!instrument && matchingTrades.length === 0 && matchingHoldings.length === 0) {
    throw routeError(404, "ticker_not_found", "Ticker not found");
  }

  if (input.accountId) {
    const account = accountById.get(input.accountId)!;
    if (marketCodeFor(account.defaultCurrency) !== resolvedMarketCode) {
      throw routeError(400, "account_market_mismatch", "Account does not match the requested market");
    }
  }
  for (const requestedAccountId of requestedAccountIds) {
    const account = accountById.get(requestedAccountId)!;
    if (marketCodeFor(account.defaultCurrency) !== resolvedMarketCode) {
      throw routeError(400, "account_market_mismatch", "Account does not match the requested market");
    }
  }

  const scopedAccountIds = new Set(
    input.accountId
      ? [input.accountId]
      : requestedAccountIds.length > 0
        ? requestedAccountIds
        : input.store.accounts
          .filter((account) => marketCodeFor(account.defaultCurrency) === resolvedMarketCode)
          .map((account) => account.id),
  );

  return {
    normalizedTicker,
    resolvedMarketCode,
    scopedAccountIds,
    filteredTransactions: matchingTrades
      .filter((trade) => trade.marketCode === resolvedMarketCode)
      .filter((trade) => scopedAccountIds.has(trade.accountId))
      .sort(compareTransactionsForHistory),
    filteredHoldings: matchingHoldings.filter((holding) => scopedAccountIds.has(holding.accountId)),
    instrument,
  };
}

export async function buildTickerDetails(
  input: BuildTickerDetailsInput,
): Promise<{ details: TickerDetailsDto; marketCode: MarketCode }> {
  const accountById = new Map(input.store.accounts.map((account) => [account.id, account]));
  const {
    normalizedTicker,
    resolvedMarketCode,
    scopedAccountIds,
    filteredTransactions,
    filteredHoldings,
    instrument,
  } = await resolveTickerReadScope(input);

  const loadChart = input.loadChart ?? true;
  const { allLocalBars, latestBarDate, quoteBars } = loadChart
    ? await loadTickerChartBars(input.persistence, normalizedTicker, resolvedMarketCode)
    : await loadTickerQuoteBars(input.persistence, normalizedTicker, resolvedMarketCode);
  const settledTradingDay = input.getSettledTradingDay
    ? await input.getSettledTradingDay(resolvedMarketCode)
    : null;
  let quote = input.tradingCalendar
    ? await buildQuoteForTicker({
        persistence: input.persistence,
        ticker: normalizedTicker,
        marketCode: resolvedMarketCode,
        settledTradingDay,
        hasHeldPosition: quantityForHoldings(filteredHoldings) > 0,
        tradingCalendar: input.tradingCalendar,
        enqueueIntradayRefresh: input.enqueueIntradayRefresh,
        now: input.now,
      })
    : buildQuoteFromBars(quoteBars, settledTradingDay);
  const valuationDate = capitalReductionAsOfDate((input.now ?? new Date()).toISOString());
  const capitalValuations = await loadCapitalReductionValuations(input.store,input.persistence,valuationDate);
  const capitalActions = (input.store.accounting.facts.capitalReductions?.actions ?? []).filter((action) => action.ticker===normalizedTicker && scopedAccountIds.has(action.accountId));
  const capitalByAccount = new Map<string, import("@vakwen/shared-types").CapitalReductionValuationDto>();
  for (const accountId of scopedAccountIds) {
    const action = capitalActions.filter((row) => row.accountId===accountId && row.status==="POSTED").sort((a,b) => b.revisions[b.revisions.length-1].input.announcement.conversionDate.localeCompare(a.revisions[a.revisions.length-1].input.announcement.conversionDate))[0];
    const announced = input.store.accounting.facts.capitalReductions?.announcements.filter((row) => row.ticker===normalizedTicker && row.suspensionStartDate<=valuationDate).sort((a,b) => b.conversionDate.localeCompare(a.conversionDate) || b.version-a.version)[0];
    const valuation = announced && (!action || announced.conversionDate>action.revisions[action.revisions.length-1].input.announcement.conversionDate)
      ? capitalValuations.get(registeredCapitalReductionValuationKey(accountId,announced)) : action ? capitalValuations.get(action.id) : undefined;
    if (valuation) capitalByAccount.set(accountId,valuation);
  }
  if (capitalByAccount.size) {
    const values = [...capitalByAccount.values()];
    const price = values.every((row) => row.sharePrice===values[0].sharePrice) ? values[0].sharePrice : null;
    const allMarket = values.every((row) => row.status==="MARKET");
    if (!allMarket || price===null) {
      const source = values.some((row) => row.status==="SUSPENDED") ? "capital_reduction:suspended" : price===null ? "capital_reduction:incomplete" : "capital_reduction:official_reference";
      quote = { ...quote,currentUnitPrice:price,previousClose:null,change:null,changePercent:null,
        asOf:values[0].valuationDate,source,quoteStatus:price===null ? "missing" : "provisional",
        priceState:{...buildMissingPriceState(resolvedMarketCode),source,asOfDate:values[0].valuationDate} };
    }
  }
  const chart = buildChart({
    allLocalBars,
    latestBarDate,
    range: input.range,
    startDate: input.startDate,
    endDate: input.endDate,
    availableStartDate: !loadChart && input.range === "ALL" && latestBarDate
      ? historyStartFor(resolvedMarketCode)
      : undefined,
    availableEndDate: !loadChart && input.range === "ALL" ? latestBarDate : undefined,
  });
  const unrealizedPnlHistory = await buildUnrealizedPnlHistory({
    persistence: input.persistence,
    userId: input.userId,
    ticker: normalizedTicker,
    marketCode: resolvedMarketCode,
    accountIds: [...scopedAccountIds],
    startDate: chart.metadata.resolved.startDate,
    endDate: chart.metadata.resolved.endDate,
    currency: currencyFor(resolvedMarketCode),
    includeProvisional: input.includeProvisional ?? true,
  });

  const quantity = filteredHoldings.reduce((sum, holding) => sum + holding.quantity, 0);
  const costBasisAmount = filteredHoldings.reduce((sum, holding) => sum + holding.costBasisAmount, 0);
  const averageCostPerShare = quantity > 0 ? roundToDecimal(costBasisAmount / quantity, 4) : null;
  const marketValueAmount = quote.currentUnitPrice !== null ? roundToDecimal(quantity * quote.currentUnitPrice, 2) : null;
  const generationCurrent = capitalActions.every((action) => action.generation.status==="current");
  const unrealizedPnlAmount = generationCurrent && marketValueAmount !== null ? roundToDecimal(marketValueAmount - costBasisAmount, 2) : null;
  const realizedPnlAmount = filteredTransactions.reduce((sum, trade) => sum + (trade.realizedPnlAmount ?? 0), 0);
  const currency = filteredHoldings[0]?.currency ?? filteredTransactions[0]?.priceCurrency ?? currencyFor(resolvedMarketCode);
  const reportingCurrency = input.reportingCurrency ?? currencyFor(resolvedMarketCode);
  const fxRateToReporting = currency === reportingCurrency ? 1 : await input.persistence.getFxRate(
    currency as AccountDefaultCurrency,
    reportingCurrency,
    quote.asOf ?? filteredTransactions[0]?.tradeDate ?? new Date().toISOString().slice(0, 10),
  );
  const upcomingDividendPage = buildTickerDividendUpcomingPage(input.store, normalizedTicker, resolvedMarketCode, scopedAccountIds, {
    page: 1,
    limit: 50,
  }, input.now);
  const openReconciliationPage = buildTickerDividendOpenReconciliationPage(
    input.store,
    normalizedTicker,
    resolvedMarketCode,
    scopedAccountIds,
    { page: 1, limit: 50 },
  );
  const postedHistoryPage = buildTickerDividendPostedHistoryPage(input.store, normalizedTicker, resolvedMarketCode, scopedAccountIds, {
    page: 1,
    limit: 50,
  });
  const upcomingDividends = upcomingDividendPage.items.map(mapUpcomingDividendListItemToLegacyDto);
  const recentDividends = postedHistoryPage.items.map(mapDividendLedgerHistoryItemToLegacyRecentDto);
  const allUpcomingDividends = collectAllDividendPageItems(upcomingDividendPage, (page) =>
    buildTickerDividendUpcomingPage(input.store, normalizedTicker, resolvedMarketCode, scopedAccountIds, { page, limit: 50 }, input.now))
    .map(mapUpcomingDividendListItemToLegacyDto);
  const allRecentDividends = collectAllDividendPageItems(postedHistoryPage, (page) =>
    buildTickerDividendPostedHistoryPage(input.store, normalizedTicker, resolvedMarketCode, scopedAccountIds, { page, limit: 50 }))
    .map(mapDividendLedgerHistoryItemToLegacyRecentDto);
  const rawAccountBreakdown = buildAccountBreakdown({
    holdings: filteredHoldings,
    accountById,
    instrumentName: instrument?.name ?? null,
    marketCode: resolvedMarketCode,
    quote,
    reportingCurrency,
    fxRateToReporting,
    upcomingDividends: allUpcomingDividends,
    recentDividends: allRecentDividends,
  });
  const marketAllocationTotal = await buildTickerMarketAllocationTotal({
    persistence: input.persistence,
    store: input.store,
    userId: input.userId,
    marketCode: resolvedMarketCode,
    reportingCurrency,
    selectedTicker: normalizedTicker,
    selectedCurrentUnitPrice: quote.currentUnitPrice,
    asOf: quote.asOf ?? filteredTransactions[0]?.tradeDate ?? new Date().toISOString().slice(0, 10),
  });
  const accountBreakdown = rawAccountBreakdown
    .map((row) => ({ ...row, capitalReductionValuation: capitalByAccount.get(row.accountId),
      unrealizedPnlAmount: capitalActions.some((action) => action.accountId===row.accountId && action.generation.status!=="current") ? null : row.unrealizedPnlAmount,
      reportingUnrealizedPnlAmount: capitalActions.some((action) => action.accountId===row.accountId && action.generation.status!=="current") ? null : row.reportingUnrealizedPnlAmount }))
    .map((row) => applyMarketAllocation(row, marketAllocationTotal))
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.accountId.localeCompare(right.accountId));
  const holdingGroup = buildHoldingGroup({
    ticker: normalizedTicker,
    instrumentName: instrument?.name ?? null,
    marketCode: resolvedMarketCode,
    currency,
    quote,
    reportingCurrency,
    fxRateToReporting,
    accountBreakdown,
  });
  const allocatedHoldingGroup = holdingGroup ? applyMarketAllocation(holdingGroup, marketAllocationTotal) : null;

  const buildRealizedPnlBreakdown = createRealizedPnlBreakdownResolver(input.store.accounting);

  const details: TickerDetailsDto = {
    capitalReductions: capitalActions.map((action) => ({...action,valuation:capitalValuations.get(action.id) ?? action.valuation})),
    identity: {
      ticker: normalizedTicker,
      marketCode: resolvedMarketCode,
      accountId: input.accountId ?? null,
      name: instrument?.name ?? null,
      instrumentType: instrument?.instrumentType ?? null,
      priceCurrency: currency,
      barsBackfillStatus: instrument?.barsBackfillStatus ?? null,
    },
    quote,
    position: {
      quantity,
      averageCostPerShare,
      costBasisAmount,
      marketValueAmount,
      unrealizedPnlAmount,
      realizedPnlAmount,
      currency,
      accountIds: [...scopedAccountIds].sort(),
      lastTradeDate: filteredTransactions[0]?.tradeDate ?? null,
    },
    chart: {
      range: chart.range,
      metadata: chart.metadata,
      points: chart.points,
    },
    unrealizedPnlHistory,
    transactions: filteredTransactions.map((trade) => mapTransactionHistoryItem(trade, accountById, buildRealizedPnlBreakdown)),
    dividends: {
      upcomingCount: upcomingDividendPage.total,
      nextPaymentDate: minNullableDate(allUpcomingDividends.map((dividend) => dividend.paymentDate)),
      lastPostedDate: maxNullableDate(allRecentDividends.map((dividend) => dividend.postedAt)),
      openReconciliationCount: openReconciliationPage.total,
      upcoming: upcomingDividends,
      recent: recentDividends,
    },
    holdingGroup: allocatedHoldingGroup,
    accountBreakdown,
    fundamentals: input.fundamentalsRecord?.fundamentals ?? createEmptyTickerFundamentals(),
    fundamentalsRefresh: buildFundamentalsRefresh(input.fundamentalsRecord, input.now ?? new Date()),
  };

  return {
    details,
    marketCode: resolvedMarketCode,
  };
}

async function buildTickerMarketAllocationTotal(input: {
  persistence: BuildTickerDetailsInput["persistence"];
  store: Store;
  userId: string;
  marketCode: MarketCode;
  reportingCurrency: AccountDefaultCurrency;
  selectedTicker: string;
  selectedCurrentUnitPrice: number | null;
  asOf: string;
}): Promise<number> {
  const marketAccountIds = new Set(
    input.store.accounts
      .filter((account) => marketCodeFor(account.defaultCurrency) === input.marketCode)
      .map((account) => account.id),
  );
  const holdings = listHoldings(input.store, input.userId)
    .filter((holding) => marketAccountIds.has(holding.accountId));
  if (holdings.length === 0) return 0;

  const pairs = [...new Set(holdings.map((holding) => holding.ticker))]
    .map((ticker) => ({ ticker, marketCode: input.marketCode }));
  const latestBars = await input.persistence.getLatestBarsByTickerMarket(pairs, 1);
  const latestCloseByTicker = new Map<string, number>();
  for (const bar of latestBars) {
    if (bar.marketCode !== input.marketCode) continue;
    if (!latestCloseByTicker.has(bar.ticker)) {
      latestCloseByTicker.set(bar.ticker, bar.close);
    }
  }
  if (input.selectedCurrentUnitPrice !== null) {
    latestCloseByTicker.set(input.selectedTicker, input.selectedCurrentUnitPrice);
  }

  const fxRateByCurrency = new Map<string, number | null>();
  const getFxRate = async (currency: string): Promise<number | null> => {
    if (currency === input.reportingCurrency) return 1;
    if (fxRateByCurrency.has(currency)) return fxRateByCurrency.get(currency) ?? null;
    const rate = await input.persistence.getFxRate(
      currency as AccountDefaultCurrency,
      input.reportingCurrency,
      input.asOf,
    );
    fxRateByCurrency.set(currency, rate);
    return rate;
  };

  let total = 0;
  for (const holding of holdings) {
    const fxRate = await getFxRate(holding.currency);
    if (fxRate === null) continue;
    const latestClose = latestCloseByTicker.get(holding.ticker) ?? null;
    if (latestClose !== null) {
      total += roundToDecimal(holding.quantity * latestClose * fxRate, 2);
      continue;
    }
    total += roundToDecimal(holding.costBasisAmount * fxRate, 2);
  }
  return roundToDecimal(total, 2);
}

async function buildUnrealizedPnlHistory(input: {
  persistence: Pick<Persistence, "listHoldingSnapshots">;
  userId: string;
  ticker: string;
  marketCode: MarketCode;
  accountIds: readonly string[];
  startDate: string | null;
  endDate: string | null;
  currency: AccountDefaultCurrency;
  includeProvisional: boolean;
}): Promise<TickerDetailsDto["unrealizedPnlHistory"]> {
  if (!input.startDate || !input.endDate) return [];
  if (input.accountIds.length === 0) return [];
  const pageSize = 10_000;
  type HoldingSnapshotRow = Awaited<ReturnType<Persistence["listHoldingSnapshots"]>>["rows"][number];
  const rows: HoldingSnapshotRow[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const result = await input.persistence.listHoldingSnapshots(input.userId, {
      accountIds: input.accountIds,
      pairs: input.accountIds.map((accountId) => ({ accountId, ticker: input.ticker, marketCode: input.marketCode })),
      startDate: input.startDate,
      endDate: input.endDate,
      includeProvisional: input.includeProvisional,
      limit: pageSize,
      offset,
    });
    rows.push(...result.rows);
    if (result.rows.length < pageSize || rows.length >= result.total) break;
  }
  const byDate = new Map<string, {
    accountIds: Set<string>;
    closePriceNumerator: number | null;
    costBasisAmount: number;
    currency: string;
    isProvisional: boolean;
    quantity: number;
    unrealizedPnlAmount: number | null;
  }>();
  for (const row of rows) {
    const current = byDate.get(row.snapshotDate) ?? {
      accountIds: new Set<string>(),
      closePriceNumerator: 0,
      costBasisAmount: 0,
      currency: row.currency || input.currency,
      isProvisional: false,
      quantity: 0,
      unrealizedPnlAmount: 0,
    };
    current.accountIds.add(row.accountId);
    current.isProvisional = current.isProvisional || row.isProvisional;
    if (row.quantity > 0) {
      current.closePriceNumerator = current.closePriceNumerator === null || row.closePrice === null
        ? null
        : roundToDecimal(current.closePriceNumerator + (row.closePrice * row.quantity), 4);
    }
    current.costBasisAmount = roundToDecimal(current.costBasisAmount + row.costBasisNative, 2);
    current.quantity = roundToDecimal(current.quantity + row.quantity, 4);
    const unrealizedPnlAmount = row.unrealizedPnlNative ?? (row.quantity === 0 ? 0 : null);
    current.unrealizedPnlAmount = current.unrealizedPnlAmount === null || unrealizedPnlAmount === null
      ? null
      : roundToDecimal(current.unrealizedPnlAmount + unrealizedPnlAmount, 2);
    byDate.set(row.snapshotDate, current);
  }
  return [...byDate.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, row]) => ({
      date,
      unrealizedPnlAmount: row.unrealizedPnlAmount,
      currency: row.currency as TickerDetailsDto["unrealizedPnlHistory"][number]["currency"],
      quantity: row.quantity,
      closePrice: row.closePriceNumerator !== null && row.quantity > 0
        ? roundToDecimal(row.closePriceNumerator / row.quantity, 4)
        : null,
      averageCostPerShare: row.quantity > 0
        ? roundToDecimal(row.costBasisAmount / row.quantity, 4)
        : null,
      accountIds: [...row.accountIds].sort(),
      isProvisional: row.isProvisional,
    }));
}

function applyMarketAllocation<T extends DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto>(
  row: T,
  marketAllocationTotal: number,
): T {
  const allocation = resolveTickerDetailsAllocationValue(row);
  const allocationPercent = marketAllocationTotal > 0 && allocation.value !== null
    ? roundToDecimal((allocation.value / marketAllocationTotal) * 100, 4)
    : null;
  return {
    ...row,
    reportingMarketAllocationPercent: allocationPercent,
    allocationBasisUsed: allocation.allocationBasisUsed,
    allocationBasisFallbackReason: allocation.allocationBasisFallbackReason,
  };
}

function resolveTickerDetailsAllocationValue(
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto,
): {
  value: number | null;
  allocationBasisUsed: DashboardOverviewHoldingGroupDto["allocationBasisUsed"];
  allocationBasisFallbackReason: DashboardOverviewHoldingGroupDto["allocationBasisFallbackReason"];
} {
  if (row.reportingMarketValueAmount !== null) {
    return {
      value: row.reportingMarketValueAmount,
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
    };
  }
  if (row.quoteStatus === "missing") {
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

function buildAccountBreakdown(input: {
  holdings: ReturnType<typeof listHoldings>;
  accountById: ReadonlyMap<string, Store["accounts"][number]>;
  instrumentName: string | null;
  marketCode: MarketCode;
  quote: TickerDetailsDto["quote"];
  reportingCurrency: AccountDefaultCurrency;
  fxRateToReporting: number | null;
  upcomingDividends: DashboardOverviewUpcomingDividendDto[];
  recentDividends: DashboardOverviewRecentDividendDto[];
}): DashboardOverviewHoldingChildDto[] {
  const allocationBasisUsed = input.quote.currentUnitPrice === null ? "cost_basis" : "market_value";
  const rows = input.holdings.map((holding) => {
    const marketValueAmount = input.quote.currentUnitPrice !== null
      ? roundToDecimal(holding.quantity * input.quote.currentUnitPrice, 2)
      : null;
    const unrealizedPnlAmount = marketValueAmount === null ? null : roundToDecimal(marketValueAmount - holding.costBasisAmount, 2);
    return {
      accountId: holding.accountId,
      accountName: input.accountById.get(holding.accountId)?.name ?? holding.accountId,
      ticker: holding.ticker,
      instrumentName: input.instrumentName,
      marketCode: input.marketCode,
      quantity: holding.quantity,
      costBasisAmount: holding.costBasisAmount,
      currency: holding.currency,
      averageCostPerShare: holding.quantity > 0 ? roundToDecimal(holding.costBasisAmount / holding.quantity, 2) : 0,
      currentUnitPrice: input.quote.currentUnitPrice,
      marketValueAmount,
      unrealizedPnlAmount,
      allocationPct: null,
      change: input.quote.change,
      changePercent: input.quote.changePercent,
      previousClose: input.quote.previousClose,
      quoteStatus: input.quote.quoteStatus,
      nextDividendDate: minNullableDate(
        input.upcomingDividends
          .filter((dividend) => dividend.accountId === holding.accountId)
          .map((dividend) => dividend.paymentDate ?? dividend.exDividendDate),
      ),
      lastDividendPostedDate: maxNullableDate(
        input.recentDividends
          .filter((dividend) => dividend.accountId === holding.accountId)
          .map((dividend) => dividend.postedAt),
      ),
      priceState: input.quote.priceState,
      reportingCurrency: input.reportingCurrency,
      reportingCostBasisAmount: input.fxRateToReporting === null ? null : roundToDecimal(holding.costBasisAmount * input.fxRateToReporting, 2),
      reportingMarketValueAmount: input.fxRateToReporting === null || marketValueAmount === null
        ? null
        : roundToDecimal(marketValueAmount * input.fxRateToReporting, 2),
      reportingUnrealizedPnlAmount: input.fxRateToReporting === null || unrealizedPnlAmount === null
        ? null
        : roundToDecimal(unrealizedPnlAmount * input.fxRateToReporting, 2),
      reportingDailyChangeAmount: input.fxRateToReporting === null || input.quote.change === null || input.quote.previousClose === null
        ? null
        : roundToDecimal(input.quote.change * holding.quantity * input.fxRateToReporting, 2),
      reportingAllocationPercent: null,
      reportingMarketAllocationPercent: null,
      fxStatus: input.fxRateToReporting === null ? "missing" as const : "complete" as const,
      allocationBasisUsed,
      allocationBasisFallbackReason: input.quote.currentUnitPrice === null ? "missing_quote" as const : null,
    } satisfies DashboardOverviewHoldingChildDto;
  });

  const allocationTotal = rows.reduce((sum, row) => {
    const value = allocationBasisUsed === "market_value"
      ? row.reportingMarketValueAmount
      : row.reportingCostBasisAmount;
    return sum + (value ?? 0);
  }, 0);

  return rows
    .map((row) => {
      const value = allocationBasisUsed === "market_value"
        ? row.reportingMarketValueAmount
        : row.reportingCostBasisAmount;
      return {
        ...row,
        allocationPct: allocationTotal > 0 && value !== null ? (value / allocationTotal) * 100 : null,
        reportingAllocationPercent: allocationTotal > 0 && value !== null
          ? roundToDecimal((value / allocationTotal) * 100, 4)
          : null,
      };
    })
    .sort((left, right) => right.costBasisAmount - left.costBasisAmount || left.accountId.localeCompare(right.accountId));
}

function buildHoldingGroup(input: {
  ticker: string;
  instrumentName: string | null;
  marketCode: MarketCode;
  currency: string;
  quote: TickerDetailsDto["quote"];
  reportingCurrency: AccountDefaultCurrency;
  fxRateToReporting: number | null;
  accountBreakdown: DashboardOverviewHoldingChildDto[];
}): DashboardOverviewHoldingGroupDto | null {
  if (input.accountBreakdown.length === 0) return null;

  const quantity = input.accountBreakdown.reduce((sum, child) => sum + child.quantity, 0);
  const costBasisAmount = roundToDecimal(
    input.accountBreakdown.reduce((sum, child) => sum + child.costBasisAmount, 0),
    2,
  );
  const marketValueAmount = input.quote.currentUnitPrice !== null
    ? roundToDecimal(quantity * input.quote.currentUnitPrice, 2)
    : null;
  const unrealizedPnlAmount = marketValueAmount === null
    ? null
    : roundToDecimal(marketValueAmount - costBasisAmount, 2);
  const allocationBasisUsed = input.quote.currentUnitPrice === null ? "cost_basis" : "market_value";

  return {
    ticker: input.ticker,
    instrumentName: input.instrumentName,
    marketCode: input.marketCode,
    quantity,
    costBasisAmount,
    currency: input.currency,
    averageCostPerShare: quantity > 0 ? roundToDecimal(costBasisAmount / quantity, 2) : 0,
    currentUnitPrice: input.quote.currentUnitPrice,
    marketValueAmount,
    unrealizedPnlAmount,
    allocationPct: null,
    change: input.quote.change,
    changePercent: input.quote.changePercent,
    previousClose: input.quote.previousClose,
    quoteStatus: input.quote.quoteStatus,
    nextDividendDate: minNullableDate(input.accountBreakdown.map((child) => child.nextDividendDate)),
    lastDividendPostedDate: maxNullableDate(input.accountBreakdown.map((child) => child.lastDividendPostedDate)),
    priceState: input.quote.priceState,
    accountCount: new Set(input.accountBreakdown.map((child) => child.accountId)).size,
    reportingCurrency: input.reportingCurrency,
    reportingCostBasisAmount: input.fxRateToReporting === null ? null : roundToDecimal(costBasisAmount * input.fxRateToReporting, 2),
    reportingMarketValueAmount: input.fxRateToReporting === null || marketValueAmount === null
      ? null
      : roundToDecimal(marketValueAmount * input.fxRateToReporting, 2),
    reportingUnrealizedPnlAmount: input.fxRateToReporting === null || unrealizedPnlAmount === null
      ? null
      : roundToDecimal(unrealizedPnlAmount * input.fxRateToReporting, 2),
    reportingDailyChangeAmount: input.accountBreakdown.some((child) => child.reportingDailyChangeAmount == null)
      ? null
      : roundToDecimal(input.accountBreakdown.reduce((sum, child) => sum + (child.reportingDailyChangeAmount ?? 0), 0), 2),
    reportingAllocationPercent: input.accountBreakdown.some((child) => child.reportingAllocationPercent === null)
      ? null
      : roundToDecimal(input.accountBreakdown.reduce((sum, child) => sum + (child.reportingAllocationPercent ?? 0), 0), 4),
    reportingMarketAllocationPercent: null,
    fxStatus: input.fxRateToReporting === null ? "missing" : "complete",
    allocationBasisUsed,
    allocationBasisFallbackReason: input.quote.currentUnitPrice === null ? "missing_quote" : null,
    children: input.accountBreakdown,
  };
}

function minNullableDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort()[0] ?? null;
}

function maxNullableDate(values: Array<string | null>): string | null {
  return values.filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

async function resolveMarketCode(input: {
  requestedMarketCode?: MarketCode;
  requestedAccountId?: string;
  requestedAccountIds?: readonly string[];
  matchingTrades: Store["accounting"]["facts"]["tradeEvents"];
  matchingHoldings: ReturnType<typeof listHoldings>;
  accountById: ReadonlyMap<string, Store["accounts"][number]>;
  getInstrument: Persistence["getInstrument"];
  ticker: string;
}): Promise<MarketCode> {
  if (input.requestedMarketCode) {
    return input.requestedMarketCode;
  }

  if (input.requestedAccountId) {
    const account = input.accountById.get(input.requestedAccountId);
    if (account) {
      return marketCodeFor(account.defaultCurrency);
    }
  }

  const requestedAccountMarkets = [...new Set(
    (input.requestedAccountIds ?? [])
      .map((accountId) => input.accountById.get(accountId)?.defaultCurrency)
      .filter((currency): currency is NonNullable<typeof currency> => Boolean(currency))
      .map((currency) => marketCodeFor(currency)),
  )];
  if (requestedAccountMarkets.length === 1) {
    return requestedAccountMarkets[0] as MarketCode;
  }

  const tradeMarkets = [...new Set(input.matchingTrades.map((trade) => trade.marketCode))];
  const holdingMarkets = [...new Set(
    input.matchingHoldings
      .map((holding) => input.accountById.get(holding.accountId)?.defaultCurrency)
      .filter((currency): currency is NonNullable<typeof currency> => Boolean(currency))
      .map((currency) => marketCodeFor(currency)),
  )];

  const candidateMarkets = [...new Set([...tradeMarkets, ...holdingMarkets])];
  if (candidateMarkets.length === 1) {
    return candidateMarkets[0] as MarketCode;
  }
  if (candidateMarkets.length === 0) {
    const catalogMarkets = (
      await Promise.all(MARKET_CODES.map(async (marketCode) => {
        const instrument = await input.getInstrument(input.ticker, marketCode);
        return instrument ? marketCode : null;
      }))
    ).filter((marketCode): marketCode is MarketCode => marketCode !== null);

    if (catalogMarkets.length === 1) {
      return catalogMarkets[0];
    }
    if (catalogMarkets.length === 0) {
      return "TW";
    }
  }

  throw routeError(
    400,
    "ticker_market_required",
    "marketCode is required when the ticker exists in multiple markets",
  );
}

async function loadTickerChartBars(
  persistence: BuildTickerDetailsInput["persistence"],
  ticker: string,
  marketCode: MarketCode,
): Promise<{ allLocalBars: DailyBar[]; latestBarDate: string | null; quoteBars: DailyBar[] }> {
  const latestBarDates = await persistence.getLatestBarDatesByTickerMarket([{ ticker, marketCode }]);
  const latestBarDate = latestBarDates.get(`${ticker}:${marketCode}`) ?? null;
  const allLocalBars = latestBarDate
    ? await persistence.getDailyBarsForTickerMarket(ticker, marketCode, historyStartFor(marketCode), latestBarDate)
    : [];
  return {
    allLocalBars,
    latestBarDate,
    quoteBars: allLocalBars.slice(-2),
  };
}

async function loadTickerQuoteBars(
  persistence: BuildTickerDetailsInput["persistence"],
  ticker: string,
  marketCode: MarketCode,
): Promise<{ allLocalBars: DailyBar[]; latestBarDate: string | null; quoteBars: DailyBar[] }> {
  const latestBars = await persistence.getLatestBarsByTickerMarket([{ ticker, marketCode }], 2);
  const quoteBars = latestBars
    .map((bar) => ({
      ticker: bar.ticker,
      barDate: bar.barDate,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      quality: bar.quality,
      source: bar.source,
      ingestedAt: bar.ingestedAt,
    }))
    .sort((left, right) => left.barDate.localeCompare(right.barDate));
  return {
    allLocalBars: [],
    latestBarDate: quoteBars.at(-1)?.barDate ?? null,
    quoteBars,
  };
}

function buildQuoteFromBars(
  chartBars: readonly DailyBar[],
  settledTradingDay: string | null,
): TickerDetailsDto["quote"] {
  const latest = chartBars.at(-1);
  if (!latest) {
    return {
      currentUnitPrice: null,
      previousClose: null,
      change: null,
      changePercent: null,
      asOf: null,
      source: null,
      quoteStatus: "missing",
      priceState: buildMissingPriceState(),
    };
  }

  const previous = chartBars.length >= 2 ? chartBars[chartBars.length - 2] : null;
  const previousClose = previous?.close ?? null;
  const change = previousClose === null ? null : roundToDecimal(latest.close - previousClose, 4);
  const changePercent = previousClose === null || previousClose === 0
    ? null
    : roundToDecimal(((latest.close - previousClose) / previousClose) * 100, 4);
  const quoteStatus = settledTradingDay && latest.barDate < settledTradingDay ? "provisional" : "current";

  return {
    currentUnitPrice: latest.close,
    previousClose,
    change,
    changePercent,
    asOf: latest.barDate,
    source: latest.source,
    quoteStatus,
    priceState: {
      basis: settledTradingDay && latest.barDate < settledTradingDay ? "stale_close" : "today_close",
      chipState: settledTradingDay && latest.barDate < settledTradingDay ? "stale" : "closed",
      marketState: "closed",
      source: latest.source,
      sourceKind: mapDailySourceKind(latest.source),
      sourceId: latest.source,
      asOfDate: latest.barDate,
      asOfTimestamp: null,
      observedAt: latest.ingestedAt,
      delaySeconds: null,
      marketTimeZone: null,
      quality: latest.quality,
    },
  };
}

async function buildQuoteForTicker(input: {
  persistence: BuildTickerDetailsInput["persistence"];
  ticker: string;
  marketCode: MarketCode;
  settledTradingDay: string | null;
  hasHeldPosition: boolean;
  tradingCalendar?: RegularSessionClock;
  enqueueIntradayRefresh?: (input: { ticker: string; marketCode: MarketCode; now: Date }) => Promise<void>;
  now?: Date;
}): Promise<TickerDetailsDto["quote"]> {
  if (!input.tradingCalendar) {
    return buildQuoteFromBars(
      (await loadTickerQuoteBars(input.persistence, input.ticker, input.marketCode)).quoteBars,
      input.settledTradingDay,
    );
  }

  const now = input.now ?? new Date();
  if (input.hasHeldPosition) {
    await input.enqueueIntradayRefresh?.({
      ticker: input.ticker,
      marketCode: input.marketCode,
      now,
    });
  }

  const snapshotMap = await resolveQuoteSnapshots(
    [{ ticker: input.ticker, marketCode: input.marketCode }],
    input.persistence as Persistence,
    new Map(input.settledTradingDay ? [[input.marketCode, input.settledTradingDay]] : []),
    {
      mode: input.hasHeldPosition ? "displayed" : "daily_only",
      now,
      tradingCalendar: input.tradingCalendar,
      heldPairs: input.hasHeldPosition ? new Set([`${input.ticker}:${input.marketCode}`]) : new Set<string>(),
    },
  );
  const snapshot = snapshotMap[`${input.ticker}:${input.marketCode}`];
  if (!snapshot) {
    const session = isRegularSessionMarketCode(input.marketCode)
      ? await getRegularSessionState(input.marketCode, input.tradingCalendar, now)
      : null;
    return {
      currentUnitPrice: null,
      previousClose: null,
      change: null,
      changePercent: null,
      asOf: null,
      source: null,
      quoteStatus: "missing",
      priceState: buildMissingPriceState(input.marketCode, {
        marketState: session?.isOpen ? "open" : "closed",
        marketStateReason: session?.marketStateReason,
        calendarStatus: session?.calendarStatus ?? null,
        marketLocalDate: session?.localDate ?? null,
        marketTimeZone: session?.marketTimeZone ?? null,
      }),
    };
  }

  return {
    currentUnitPrice: snapshot.close,
    previousClose: snapshot.previousClose,
    change: snapshot.change,
    changePercent: snapshot.changePercent,
    asOf: snapshot.asOf,
    source: snapshot.source,
    quoteStatus: snapshot.isProvisional ? "provisional" : "current",
    priceState: snapshot.priceState,
  };
}

function quantityForHoldings(holdings: ReturnType<typeof listHoldings>): number {
  return holdings.reduce((sum, holding) => sum + holding.quantity, 0);
}

function buildChart(input: {
  allLocalBars: readonly DailyBar[];
  latestBarDate: string | null;
  range?: TickerChartRange;
  startDate?: string;
  endDate?: string;
  availableStartDate?: string | null;
  availableEndDate?: string | null;
}): TickerDetailsDto["chart"] {
  const requestedRange = input.startDate || input.endDate ? null : (input.range ?? "1Y");
  const resolvedRange: TickerChartSelection = input.startDate || input.endDate ? "CUSTOM" : (requestedRange ?? "1Y");
  const availableStartDate = input.allLocalBars[0]?.barDate ?? input.availableStartDate ?? null;
  const availableEndDate = input.allLocalBars.at(-1)?.barDate ?? input.availableEndDate ?? null;

  if (input.startDate && input.endDate) {
    assertCustomRangeWithinTenYears(input.startDate, input.endDate);
  }

  const resolvedBounds = resolveChartBounds({
    latestBarDate: input.latestBarDate,
    availableStartDate,
    availableEndDate,
    range: requestedRange,
    startDate: input.startDate,
    endDate: input.endDate,
  });

  return {
    range: resolvedRange,
    metadata: {
      requested: {
        range: requestedRange,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      },
      resolved: {
        range: resolvedRange,
        startDate: resolvedBounds.startDate,
        endDate: resolvedBounds.endDate,
      },
      available: {
        startDate: availableStartDate,
        endDate: availableEndDate,
      },
      truncated: {
        startDate: Boolean(
          resolvedBounds.startDate
          && availableStartDate
          && resolvedBounds.startDate < availableStartDate,
        ),
        endDate: Boolean(
          resolvedBounds.endDate
          && availableEndDate
          && resolvedBounds.endDate > availableEndDate,
        ),
      },
    },
    points: input.allLocalBars
      .filter((bar) => (
        resolvedBounds.startDate !== null
        && resolvedBounds.endDate !== null
        && bar.barDate >= resolvedBounds.startDate
        && bar.barDate <= resolvedBounds.endDate
      ))
      .map((bar) => ({
        date: bar.barDate,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        source: bar.source,
      })),
  };
}

function resolveChartBounds(input: {
  latestBarDate: string | null;
  availableStartDate: string | null;
  availableEndDate: string | null;
  range: TickerChartRange | null;
  startDate?: string;
  endDate?: string;
}): { startDate: string | null; endDate: string | null } {
  if (input.startDate && input.endDate) {
    return {
      startDate: input.startDate,
      endDate: input.endDate,
    };
  }

  if (!input.latestBarDate) {
    return {
      startDate: null,
      endDate: null,
    };
  }

  if (input.range === "ALL") {
    return {
      startDate: input.availableStartDate ?? input.latestBarDate,
      endDate: input.availableEndDate ?? input.latestBarDate,
    };
  }

  const { startDate, endDate } = resolveRangeBounds(
    input.range ?? "1Y",
    input.latestBarDate,
    input.availableStartDate ?? undefined,
  );
  return { startDate, endDate };
}

function assertCustomRangeWithinTenYears(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw routeError(400, "ticker_chart_invalid_date_range", "startDate must be before or equal to endDate");
  }

  if (endDate > addYears(startDate, 10)) {
    throw routeError(
      400,
      "ticker_chart_custom_range_too_large",
      "Custom ticker chart ranges cannot exceed 10 years",
    );
  }
}

export function buildHoldingActivityDividends(
  store: Store,
  input: {
    ticker: string;
    marketCode: MarketCode;
    scopedAccountIds: ReadonlySet<string>;
    positionActionsPage: number;
    positionActionsLimit: 10 | 25 | 50;
    upcomingPage: number;
    upcomingLimit: 10 | 25 | 50;
    postedPage: number;
    postedLimit: 10 | 25 | 50;
  },
): HoldingActivityDividendsDto {
  return {
    positionActions: buildHoldingActivityPositionActionPage(
      store,
      input.ticker,
      input.marketCode,
      input.scopedAccountIds,
      { page: input.positionActionsPage, limit: input.positionActionsLimit },
    ),
    upcomingDividends: buildTickerDividendUpcomingPage(
      store,
      input.ticker,
      input.marketCode,
      input.scopedAccountIds,
      { page: input.upcomingPage, limit: input.upcomingLimit },
    ),
    postedDividends: buildTickerDividendPostedHistoryPage(
      store,
      input.ticker,
      input.marketCode,
      input.scopedAccountIds,
      { page: input.postedPage, limit: input.postedLimit },
    ),
  };
}

export function buildHoldingActivityPositionActionPage(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
  pageInput: { page: number; limit: 10 | 25 | 50 },
): HoldingActivityPositionActionPageDto {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const reversedActionIds = new Set(
    store.accounting.facts.positionActions
      .map((action) => action.reversalOfPositionActionId)
      .filter((value): value is string => Boolean(value)),
  );
  const items = store.accounting.facts.positionActions
    .filter((action) => action.ticker === ticker)
    .filter((action) => action.marketCode === marketCode)
    .filter((action) => scopedAccountIds.has(action.accountId))
    .filter((action) => !action.reversalOfPositionActionId)
    .filter((action) => !action.supersededAt)
    .filter((action) => !reversedActionIds.has(action.id))
    .map((action): HoldingActivityPositionActionDto => ({
      id: action.id,
      accountId: action.accountId,
      accountName: accountById.get(action.accountId)?.name ?? action.accountId,
      ticker: action.ticker,
      marketCode: action.marketCode as MarketCode,
      actionType: action.actionType,
      actionDate: action.actionDate,
      actionTimestamp: action.actionTimestamp ?? null,
      bookedAt: action.bookedAt ?? null,
      quantity: action.quantity,
      ratioNumerator: action.ratioNumerator ?? null,
      ratioDenominator: action.ratioDenominator ?? null,
      cashInLieuQuantity: action.cashInLieuQuantity ?? null,
      cashInLieuAmount: action.cashInLieuAmount ?? null,
      cashInLieuCurrency: action.cashInLieuCurrency ?? null,
      parValuePerShare: action.parValuePerShare ?? null,
      premiumBaseAmount: action.premiumBaseAmount ?? null,
      nhiPremiumBaseAmount: action.nhiPremiumBaseAmount ?? null,
      relatedDividendLedgerEntryId: action.relatedDividendLedgerEntryId ?? null,
      source: action.source,
      sourceReference: action.sourceReference ?? null,
    }))
    .sort(comparePositionActionsDescending);
  return paginateItems(items, pageInput);
}

export function buildTickerDividendUpcomingPage(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
  pageInput: { page: number; limit: 10 | 25 | 50 },
  now = new Date(),
): DividendUpcomingPageDto {
  const activeLedgerByAccountAndEvent = new Map<string, Store["accounting"]["facts"]["dividendLedgerEntries"][number]>();
  const postedEventKeys = new Set<string>();
  const reversedLedgerIds = new Set(
    listDividendLedgerEntries(store)
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((value): value is string => Boolean(value)),
  );

  for (const entry of listDividendLedgerEntries(store)) {
    const key = `${entry.accountId}:${entry.dividendEventId}`;
    if (entry.reversalOfDividendLedgerEntryId || entry.supersededAt || reversedLedgerIds.has(entry.id)) continue;
    activeLedgerByAccountAndEvent.set(key, entry);
    if (entry.postingStatus === "posted" || entry.postingStatus === "adjusted") {
      postedEventKeys.add(key);
    }
  }

  const today = now.toISOString().slice(0, 10);
  const horizon = new Date(now);
  horizon.setUTCDate(horizon.getUTCDate() + 365);
  const horizonDate = horizon.toISOString().slice(0, 10);

  const items = store.accounts
    .filter((account) => scopedAccountIds.has(account.id))
    .flatMap((account) =>
      store.marketData.dividendEvents.flatMap((event): DividendUpcomingListItemDto[] => {
        if (event.ticker !== ticker) return [];
        if (resolveDividendEventMarketCode(event) !== marketCode) return [];
        const ledgerKey = `${account.id}:${event.id}`;
        if (postedEventKeys.has(ledgerKey)) return [];
        if (event.paymentDate !== null) {
          if (event.paymentDate < today) return [];
          if (event.paymentDate > horizonDate) return [];
        }

        const activeEntry = activeLedgerByAccountAndEvent.get(ledgerKey);
        const scopedTrades = store.accounting.facts.tradeEvents.filter((trade) =>
          trade.accountId === account.id
          && trade.ticker === event.ticker
          && trade.marketCode === marketCode
        );
        const scopedPositionActions = store.accounting.facts.positionActions.filter((action) =>
          action.accountId === account.id
          && action.ticker === event.ticker
          && action.marketCode === marketCode
        );
        const eligibleQuantity = activeEntry?.eligibleQuantity
          ?? deriveEligibleQuantityFromReplayStream(
            scopedTrades,
            scopedPositionActions,
            account.id,
            event.ticker,
            marketCode,
            event,
          );
        if (!activeEntry && eligibleQuantity <= 0) return [];

        const stockEntitlement = resolveDividendStockEntitlement({
          eligibleQuantity,
          stockEntitlementRequired: event.eventType !== "CASH",
          stockDistributionRatio: event.stockDistributionRatio ?? null,
          stockDistributionRatioState: event.stockDistributionRatioState ?? "unresolved",
        });
        const cashReconciliation = calculateDividendCashReconciliation({
          expectedGrossAmount: activeEntry?.expectedCashAmount
            ?? Math.max(0, Math.round(eligibleQuantity * event.cashDividendPerShare + Number.EPSILON)),
          actualNetAmount: 0,
        });

        return [{
          id: event.id,
          accountId: account.id,
          accountName: account.name,
          ticker: event.ticker,
          tickerName: resolveDividendTickerName(store, event.ticker, marketCode),
          marketCode,
          instrumentType: resolveInstrumentType(store, event.ticker, marketCode),
          eventType: event.eventType,
          exDividendDate: event.exDividendDate,
          paymentDate: event.paymentDate,
          expectedCashAmount: cashReconciliation.expectedGrossAmount,
          expectedNetAmount: cashReconciliation.expectedNetAmount,
          expectedStockQuantity: activeEntry?.expectedStockQuantity ?? stockEntitlement.expectedStockQuantity,
          eligibleQuantity,
          stockDistributionRatio: stockEntitlement.stockDistributionRatio,
          stockDistributionRatioState: stockEntitlement.stockDistributionRatioState,
          expectedStockCalcState: activeEntry?.expectedStockCalcState ?? stockEntitlement.expectedStockCalcState,
          cashDividendCurrency: event.cashDividendCurrency,
          hasPostedLedgerEntry: activeEntry ? activeEntry.postingStatus !== "expected" : false,
          dividendLedgerEntryId: activeEntry?.id ?? null,
          status: resolveUpcomingStatus(event.paymentDate, activeEntry?.postingStatus),
        }];
      }),
    )
    .sort(compareUpcomingDividendItems);

  return paginateItems(items, pageInput);
}

export function buildTickerDividendOpenReconciliationPage(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
  pageInput: { page: number; limit: 10 | 25 | 50 },
): DividendLedgerHistoryPageDto {
  return paginateItems(
    buildActivePostedDividendHistoryItems(store, ticker, marketCode, scopedAccountIds)
      .filter((item) => item.reconciliationStatus === "open"),
    pageInput,
  );
}

export function buildTickerDividendPostedHistoryPage(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
  pageInput: { page: number; limit: 10 | 25 | 50 },
): DividendLedgerHistoryPageDto {
  return paginateItems(buildActivePostedDividendHistoryItems(store, ticker, marketCode, scopedAccountIds), pageInput);
}

function buildActivePostedDividendHistoryItems(
  store: Store,
  ticker: string,
  marketCode: MarketCode,
  scopedAccountIds: ReadonlySet<string>,
): DividendLedgerHistoryItemDto[] {
  const accountById = new Map(store.accounts.map((account) => [account.id, account]));
  const eventById = new Map(
    store.marketData.dividendEvents
      .filter((event) => event.ticker === ticker)
      .filter((event) => resolveDividendEventMarketCode(event) === marketCode)
      .map((event) => [event.id, event]),
  );
  const reversedLedgerIds = new Set(
    listDividendLedgerEntries(store)
      .map((entry) => entry.reversalOfDividendLedgerEntryId)
      .filter((value): value is string => Boolean(value)),
  );
  const deductionsByLedgerId = new Map<string, ReturnType<typeof listDividendDeductionEntries>>();
  for (const deduction of listDividendDeductionEntries(store)) {
    const group = deductionsByLedgerId.get(deduction.dividendLedgerEntryId) ?? [];
    group.push(deduction);
    deductionsByLedgerId.set(deduction.dividendLedgerEntryId, group);
  }
  const receivedCashByLedgerId = new Map<string, number>();
  for (const cashEntry of store.accounting.facts.cashLedgerEntries) {
    if (cashEntry.entryType !== "DIVIDEND_RECEIPT" || !cashEntry.relatedDividendLedgerEntryId) continue;
    receivedCashByLedgerId.set(
      cashEntry.relatedDividendLedgerEntryId,
      (receivedCashByLedgerId.get(cashEntry.relatedDividendLedgerEntryId) ?? 0) + cashEntry.amount,
    );
  }

  return listDividendLedgerEntries(store)
    .filter((entry) => scopedAccountIds.has(entry.accountId))
    .filter((entry) => entry.postingStatus === "posted" || entry.postingStatus === "adjusted")
    .filter((entry) => !entry.reversalOfDividendLedgerEntryId)
    .filter((entry) => !entry.supersededAt)
    .filter((entry) => !reversedLedgerIds.has(entry.id))
    .flatMap((entry): DividendLedgerHistoryItemDto[] => {
      const event = eventById.get(entry.dividendEventId);
      if (!event) return [];
      const receivedCashAmount = receivedCashByLedgerId.get(entry.id) ?? entry.receivedCashAmount;
      const deductions = summarizeDividendDeductions(deductionsByLedgerId.get(entry.id) ?? []);
      const cashReconciliation = calculateDividendCashReconciliation({
        expectedGrossAmount: entry.expectedCashAmount,
        actualNetAmount: receivedCashAmount,
        deductions,
      });
      const stockEntitlement = resolveDividendStockEntitlement({
        eligibleQuantity: entry.eligibleQuantity,
        stockEntitlementRequired: event.eventType !== "CASH",
        stockDistributionRatio: event.stockDistributionRatio ?? null,
        stockDistributionRatioState: event.stockDistributionRatioState ?? "unresolved",
      });
      return [{
        dividendLedgerEntryId: entry.id,
        accountId: entry.accountId,
        accountName: accountById.get(entry.accountId)?.name ?? entry.accountId,
        ticker: event.ticker,
        tickerName: resolveDividendTickerName(store, event.ticker, marketCode),
        marketCode,
        instrumentType: resolveInstrumentType(store, event.ticker, marketCode),
        eventType: event.eventType,
        paymentDate: event.paymentDate,
        exDividendDate: event.exDividendDate,
        postedAt: entry.bookedAt ?? event.paymentDate ?? entry.id,
        expectedCashAmount: entry.expectedCashAmount,
        expectedNetAmount: cashReconciliation.expectedNetAmount,
        receivedCashAmount,
        actualNetAmount: cashReconciliation.actualNetAmount,
        varianceAmount: cashReconciliation.varianceAmount,
        expectedStockQuantity: entry.expectedStockQuantity,
        receivedStockQuantity: entry.receivedStockQuantity,
        stockDistributionRatio: stockEntitlement.stockDistributionRatio,
        stockDistributionRatioState: stockEntitlement.stockDistributionRatioState,
        expectedStockCalcState: entry.expectedStockCalcState ?? stockEntitlement.expectedStockCalcState,
        cashDividendCurrency: event.cashDividendCurrency,
        nhiAmount: deductions.nhiAmount,
        bankFeeAmount: deductions.bankFeeAmount,
        otherDeductionAmount: deductions.otherDeductionAmount,
        deductions,
        postingStatus: entry.postingStatus as "posted" | "adjusted",
        reconciliationStatus: entry.reconciliationStatus,
      }];
    })
    .sort(compareDividendLedgerHistoryItems);
}

function mapUpcomingDividendListItemToLegacyDto(item: DividendUpcomingListItemDto): DashboardOverviewUpcomingDividendDto {
  return {
    accountId: item.accountId,
    accountName: item.accountName,
    ticker: item.ticker,
    tickerName: item.tickerName,
    marketCode: item.marketCode,
    exDividendDate: item.exDividendDate,
    paymentDate: item.paymentDate,
    expectedAmount: item.expectedCashAmount,
    expectedNetAmount: item.expectedNetAmount,
    stockDistributionRatio: item.stockDistributionRatio,
    stockDistributionRatioState: item.stockDistributionRatioState,
    expectedStockCalcState: item.expectedStockCalcState,
    currency: item.cashDividendCurrency,
    status: item.status,
  };
}

function mapDividendLedgerHistoryItemToLegacyRecentDto(item: DividendLedgerHistoryItemDto): DashboardOverviewRecentDividendDto {
  const deductionAmount = item.nhiAmount + item.bankFeeAmount + item.otherDeductionAmount;
  return {
    accountId: item.accountId,
    accountName: item.accountName,
    ticker: item.ticker,
    tickerName: item.tickerName,
    marketCode: item.marketCode,
    dividendLedgerEntryId: item.dividendLedgerEntryId,
    paymentDate: item.paymentDate,
    postedAt: item.postedAt,
    netAmount: item.receivedCashAmount,
    grossAmount: item.receivedCashAmount + deductionAmount,
    deductionAmount: deductionAmount || null,
    reconciliation: {
      expectedGrossAmount: item.expectedCashAmount,
      expectedNetAmount: item.expectedNetAmount,
      actualNetAmount: item.actualNetAmount,
      varianceAmount: item.varianceAmount,
      deductions: item.deductions,
    },
    currency: item.cashDividendCurrency,
    sourceSummary: resolveSourceSummary(item.eventType),
    reconciliationStatus: item.reconciliationStatus,
    status: item.reconciliationStatus === "matched" ? "posted" : "unreconciled",
  };
}

function resolveDividendEventMarketCode(event: Pick<DividendEvent, "marketCode" | "cashDividendCurrency">): MarketCode {
  return (event.marketCode ?? marketCodeFor(event.cashDividendCurrency)) as MarketCode;
}

function buildFundamentalsRefresh(
  record: PersistedTickerFundamentalsRecord | null,
  now: Date,
): TickerDetailsDto["fundamentalsRefresh"] {
  if (!record) {
    return {
      providerId: null,
      refreshedAt: null,
      nextRefreshAt: null,
      lastAttemptedAt: null,
      lastError: null,
      status: "missing",
    };
  }

  const status = !record.refreshedAt
    ? "missing"
    : record.nextRefreshAt && record.nextRefreshAt <= now.toISOString()
      ? "stale"
      : "fresh";

  return {
    providerId: record.providerId,
    refreshedAt: record.refreshedAt,
    nextRefreshAt: record.nextRefreshAt,
    lastAttemptedAt: record.lastAttemptedAt,
    lastError: record.lastError,
    status,
  };
}

function mapTransactionHistoryItem(
  trade: Transaction,
  accountById: ReadonlyMap<string, { id: string; name: string }>,
  buildRealizedPnlBreakdown: (trade: Transaction) => TransactionHistoryItemDto["realizedPnlBreakdown"],
): TransactionHistoryItemDto {
  const grossTradeValueAmount = roundToDecimal(trade.quantity * trade.unitPrice, 2);
  const settlementAmount = trade.type === "BUY"
    ? roundToDecimal(grossTradeValueAmount + trade.commissionAmount + trade.taxAmount, 2)
    : roundToDecimal(grossTradeValueAmount - trade.commissionAmount - trade.taxAmount, 2);
  return {
    id: trade.id,
    accountId: trade.accountId,
    accountName: resolveAccountDisplayName(accountById, trade.accountId),
    ticker: trade.ticker,
    marketCode: trade.marketCode,
    instrumentType: trade.instrumentType,
    type: trade.type,
    quantity: trade.quantity,
    unitPrice: trade.unitPrice,
    priceCurrency: trade.priceCurrency,
    tradeDate: trade.tradeDate,
    tradeTimestamp: trade.tradeTimestamp ?? null,
    bookingSequence: trade.bookingSequence ?? null,
    grossTradeValueAmount,
    commissionAmount: trade.commissionAmount,
    taxAmount: trade.taxAmount,
    settlementAmount,
    settlementAvailable: true,
    bookedCostAmount: trade.type === "BUY" ? settlementAmount : null,
    isDayTrade: trade.isDayTrade,
    realizedPnlAmount: trade.realizedPnlAmount ?? null,
    realizedPnlCurrency: trade.realizedPnlCurrency ?? null,
    realizedPnlBreakdown: buildRealizedPnlBreakdown(trade),
    feeProfileId: trade.feeSnapshot.id,
    feeProfileName: trade.feeSnapshot.name,
    bookedAt: trade.bookedAt ?? null,
    feesSource: trade.feesSource ?? "CALCULATED",
  };
}

function compareTransactionsForHistory(left: Transaction, right: Transaction): number {
  return (
    right.tradeDate.localeCompare(left.tradeDate)
    || (right.bookingSequence ?? 0) - (left.bookingSequence ?? 0)
    || (right.tradeTimestamp ?? "").localeCompare(left.tradeTimestamp ?? "")
    || (right.bookedAt ?? "").localeCompare(left.bookedAt ?? "")
    || right.id.localeCompare(left.id)
  );
}

function paginateItems<T>(
  items: readonly T[],
  pageInput: { page: number; limit: 10 | 25 | 50 },
): { items: T[]; page: number; limit: 10 | 25 | 50; total: number } {
  const total = items.length;
  const startIndex = (pageInput.page - 1) * pageInput.limit;
  return {
    items: items.slice(startIndex, startIndex + pageInput.limit),
    page: pageInput.page,
    limit: pageInput.limit,
    total,
  };
}

function collectAllDividendPageItems<T>(
  firstPage: { items: T[]; total: number },
  loadPage: (page: number) => { items: T[] },
): T[] {
  const items = [...firstPage.items];
  for (let page = 2; items.length < firstPage.total; page += 1) {
    const nextItems = loadPage(page).items;
    if (nextItems.length === 0) break;
    items.push(...nextItems);
  }
  return items;
}

function summarizeDividendDeductions(
  deductions: readonly { deductionType: string; amount: number }[],
): { nhiAmount: number; bankFeeAmount: number; otherDeductionAmount: number } {
  let nhiAmount = 0;
  let bankFeeAmount = 0;
  let otherDeductionAmount = 0;

  for (const deduction of deductions) {
    if (deduction.deductionType === "NHI_SUPPLEMENTAL_PREMIUM") {
      nhiAmount += deduction.amount;
      continue;
    }
    if (deduction.deductionType === "BANK_FEE") {
      bankFeeAmount += deduction.amount;
      continue;
    }
    otherDeductionAmount += deduction.amount;
  }

  return { nhiAmount, bankFeeAmount, otherDeductionAmount };
}

function resolveInstrumentType(store: Store, ticker: string, marketCode: MarketCode) {
  return store.instruments.find((instrument) => instrument.ticker === ticker && instrument.marketCode === marketCode)?.type ?? "STOCK";
}

function comparePositionActionsDescending(left: HoldingActivityPositionActionDto, right: HoldingActivityPositionActionDto): number {
  return (
    right.actionDate.localeCompare(left.actionDate)
    || (right.actionTimestamp ?? "").localeCompare(left.actionTimestamp ?? "")
    || (right.bookedAt ?? "").localeCompare(left.bookedAt ?? "")
    || left.id.localeCompare(right.id)
  );
}

function compareUpcomingDividendItems(left: DividendUpcomingListItemDto, right: DividendUpcomingListItemDto): number {
  return (
    (left.paymentDate ?? left.exDividendDate).localeCompare(right.paymentDate ?? right.exDividendDate)
    || left.exDividendDate.localeCompare(right.exDividendDate)
    || left.accountId.localeCompare(right.accountId)
    || left.ticker.localeCompare(right.ticker)
    || left.id.localeCompare(right.id)
  );
}

function compareDividendLedgerHistoryItems(left: DividendLedgerHistoryItemDto, right: DividendLedgerHistoryItemDto): number {
  return (
    compareNullableDates(right.paymentDate, left.paymentDate)
    || right.postedAt.localeCompare(left.postedAt)
    || left.dividendLedgerEntryId.localeCompare(right.dividendLedgerEntryId)
  );
}

function compareNullableDates(left: string | null | undefined, right: string | null | undefined): number {
  const leftValue = left ?? "";
  const rightValue = right ?? "";
  return leftValue.localeCompare(rightValue);
}

function resolveSourceSummary(eventType: string | undefined): string | null {
  if (eventType === "STOCK") return "Stock dividend";
  if (eventType === "CASH_AND_STOCK") return "Cash and stock dividend";
  if (eventType === "CASH") return "Cash dividend";
  return null;
}

function resolveUpcomingStatus(
  paymentDate: string | null,
  postingStatus: string | undefined,
): DashboardOverviewUpcomingDividendDto["status"] {
  if (postingStatus === "expected") return "expected";
  if (!paymentDate) return "declared";

  const now = new Date();
  const payment = new Date(`${paymentDate}T00:00:00.000Z`);
  const diffMs = payment.getTime() - now.getTime();
  return diffMs <= 7 * 24 * 60 * 60 * 1000 ? "paying-soon" : "declared";
}

function addYears(date: string, years: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next.toISOString().slice(0, 10);
}
