import { Profiler, act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import {
  holdingsTableSettingsPreferenceSchema,
  type DailyReviewReportDto,
  type MarketReportDto,
  type PortfolioReportDto,
  type ReportHoldingRowDto,
} from "@vakwen/shared-types";
import { ReportsClient } from "../../../components/reports/ReportsClient";
import { parseReportRouteState, type ReportRouteState } from "../../../features/reports/reportState";
import { getDictionary } from "../../../lib/i18n";
import { testPriceState } from "../../fixtures/priceState";
import {
  createCommitProfilerRecorder,
  recordPerformanceScenario,
} from "../../performance/holdingsSortingPerformanceHarness";

const refreshMock = vi.hoisted(() => vi.fn());
const replaceMock = vi.hoisted(() => vi.fn());
const useReportDataMock = vi.hoisted(() => vi.fn());
const openQuickActionsMock = vi.hoisted(() => vi.fn());
const appShellStateMock = vi.hoisted(() => ({
  isSharedContext: false,
  portfolioCapabilities: null as DailyReviewReportDto["capabilities"] | null,
  sessionUserRole: "viewer",
  sharedContextPermissions: { canManageAccounts: true },
}));
const searchParamsMock = vi.hoisted(() => ({ value: "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y" }));
const effectiveRangesMock = vi.hoisted(() => ({ value: ["1M", "1Y"] }));
const reportHookOverride = vi.hoisted(() => ({
  data: undefined as DailyReviewReportDto | PortfolioReportDto | null | undefined,
  errorMessage: "",
  isBootstrapping: false,
}));
const fetchMock = vi.hoisted(() => vi.fn());
const userPreferencesMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsMock.value),
}));

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: () => ({
    canUseGlobalQuickActions: true,
    contextRefreshSignal: 0,
    isSharedContext: appShellStateMock.isSharedContext,
    locale: "en",
    openQuickActions: openQuickActionsMock,
    portfolioCapabilities: appShellStateMock.portfolioCapabilities,
    sessionUserId: "user-a",
    sessionUserRole: appShellStateMock.sessionUserRole,
    sharedContextPermissions: appShellStateMock.sharedContextPermissions,
    uiDict: {
      actions: {
        dismiss: "Dismiss",
      },
      navigation: {
        reportsLabel: "Reports",
        reportsDescription: "Structured reports",
      },
      portfolioCapabilities: {
        normalizationNoticeTitle: "Updated to available portfolio settings",
        dismissNormalizationNotice: "Dismiss update notice",
        noConfiguredMarkets: "Set up at least one account market before using this view.",
        noConfiguredCurrencies: "Set up at least one account currency before using this view.",
        unconfiguredMarket: "Updated to {value}.",
        unconfiguredReportScope: "Updated report scope to {value}.",
        unconfiguredCurrency: "Updated currency to {value}.",
        noneAvailable: "None available",
        zeroAccountGateTitle: "Set up an account to continue",
        zeroAccountGateDescription: "Add an account before using reports.",
        zeroAccountGateReadonly: "The owner has not configured any account markets for this shared view.",
        zeroAccountGateAction: "Open account setup",
      },
      dashboardHome: {
        performanceSnapshotAsOfTooltip: "Latest reliable snapshot: {date}. Trend charts use server snapshots only.",
        allocationBasisLabel: "Allocation basis",
        allocationBasisCostBasis: "Cost basis",
        allocationBasisMarketValue: "Market value",
        allocationFallbackLabel: "Cost basis fallback",
        exactAmountInline: "Exact {amount}",
        latestAvailableSnapshot: "Latest available snapshot",
        requestedAsOfLabel: "Requested {date}",
        topHoldingsAllMarkets: "All markets",
        topHoldingsMarketLabel: "Market",
        topHoldingsPresetLargest: "Largest",
        topHoldingsPresetHighestAllocation: "Highest allocation",
        topHoldingsPresetWorstPnl: "Worst P&L first",
        topHoldingsPresetBestPnl: "Best P&L first",
        topHoldingsPresetFxExposure: "FX exposure",
        topHoldingsPresetStaleQuotes: "Stale quotes",
        topHoldingsFocusPresetsAria: "Holding Focus presets",
      },
      reports: {
        tabDailyReview: "Daily Review",
        tabPortfolio: "Portfolio Report",
        tabMarket: "Market Report",
        controlScope: "Scope",
        controlRange: "Range",
        allMarkets: "All markets",
        resolvedCurrency: "Resolved {currency}",
        changeInQuickActions: "Change in Quick Actions",
        reportingCurrencyQuickActionsOnly: "Reporting currency is managed from Quick Actions.",
        restoredFromCache: "Restored from cache at {time}",
        contentVisibleWhileLoading: "Report content stays visible while fresh data loads.",
        refreshing: "Refreshing",
        refresh: "Refresh",
        reportUnavailable: "Report unavailable",
        noReportData: "No report data",
        noReportDataDescription: "Run refresh after the portfolio read model is available.",
        latestRefreshFailed: "Latest refresh failed",
        reportingCurrencyBadge: "Reporting {currency}",
        fxStatusBadge: "FX {status}",
        basisStripTitle: "Valuation basis",
        basisStripDescription: "Reports stay on the current-valuation path. Quote timing, fallback use, and FX timing are shown here so report totals can be compared with snapshot-based analysis.",
        basisMarketLabel: "Market {market}",
        basisFxLabel: "FX",
        basisMarketQuoteAsOf: "Quote {date}",
        basisMarketSource: "Source {source}",
        basisMarketSources: "Sources by holding: {sources}",
        basisMarketFallbackUsed: "Fallback quote used",
        basisMarketFallbackPartial: "Fallback quote used by {count}/{total} holdings",
        basisMarketFallbackNone: "Primary quote path",
        basisMarketRollback: "{market} closed {expected}: using {actual} close",
        basisMarketStaleQuote: "Stale market data: {market} expected {expected}, using {actual} close",
        basisMarketCurrent: "Current through {date}",
        basisMarketUnavailable: "Quote basis unavailable",
        basisFxAsOf: "FX as of {date}",
        basisFxDateRange: "FX dates {start} to {end}",
        basisFxLatest: "Latest available FX in report response",
        basisFxUnavailable: "FX unavailable",
        basisFxUnavailableForPairs: "FX unavailable for {pairs}",
        basisFxNotRequired: "No FX conversion required",
        marketValue: "Market value",
        costBasis: "Cost basis",
        unrealizedPnl: "Unrealized P&L",
        realizedPnl: "Realized P&L",
        dailyChange: "Daily change",
        income: "Income",
        upcomingIncome: "Upcoming income",
        dividendsCount: "{count} dividend(s)",
        fxStatusTitle: "FX status",
        fxPairDescription: "{from} to {to}",
        fxPairLabel: "{from} to {to}",
        todayTitle: "Today",
        todayDescription: "Deterministic observations from the report data.",
        todayEmpty: "No observations for this scope.",
        topMoversTitle: "Top movers",
        holdingsDetailTitle: "Holdings detail",
        allocationByMarketTitle: "Allocation by market",
        allocationByAccountTitle: "Allocation by account",
        tickerAllocationTitle: "Ticker allocation",
        tickerAllocationBars: "Bars",
        tickerAllocationPie: "Pie",
        tickerAllocationChartTypeLabel: "Chart type",
        tickerAllocationTopNLabel: "Top N",
        tickerAllocationTopNAuto: "Auto",
        tickerAllocationTopNAll: "All",
        tickerAllocationPortfolioAllocation: "Portfolio allocation",
        tickerAllocationSelectedAllocation: "Selected allocation",
        tickerAllocationOtherLabel: "Other",
        tickerAllocationOtherDescription: "Combined remainder outside the visible top slice.",
        tickerAllocationDetailTitle: "Allocation details",
        tickerAllocationBasisSummary: "Allocation basis: {basis}.",
        tickerAllocationBasisFallbackSummary: "Allocation basis: {basis}. Cost basis fallback used by {count} ticker(s).",
        tickerAllocationFxStatus: "FX status",
        tickerAllocationFallbackNotNeeded: "Not needed",
        tickerAllocationSettingsLoadError: "Unable to load allocation chart settings.",
        reportingValue: "Reporting value",
        incomeTitle: "Income",
        postedDividendRows: "{count} posted dividend row(s)",
        concentrationTitle: "Concentration",
        marketSummaryTitle: "Market summary",
        topHoldingsTitle: "Top holdings",
        marketDetailTitle: "Market detail",
        performanceTrendTitle: "Performance trend",
        performanceTrendLabel: "Performance trend",
        performanceMetaAsOf: "As of {date}",
        performanceStaleDataWarning: "Market data stale since {date}",
        timelineAuto: "Auto",
        timelineDay: "Day",
        timelineWeek: "Week",
        timelineMonth: "Month",
        timelineYear: "Year",
        noSnapshotSeries: "No server snapshot series is available for this scope.",
        allocationBucketCount: "{count} bucket(s)",
        noAllocationBuckets: "No allocation buckets for this scope.",
        totalRows: "{count} total row(s)",
        ticker: "Ticker",
        position: "Position",
        unitsLabel: "{count} units",
        accountAbbrev: "{count} acct",
        price: "Price",
        averageCost: "Average cost",
        pnl: "Unrealized P&L",
        weight: "Allocation",
        actions: "Actions",
        openTicker: "Open ticker",
        openTickerAria: "Open {ticker} ticker page",
        viewDetails: "View details",
        holdingDetailTitle: "Holding detail",
        holdingDetailDescription: "Exact report values for the selected holding row.",
        reportingPrice: "Reporting price",
        nativePrice: "Native price",
        nativeMarketValue: "Native market value",
        nativeCostBasis: "Native cost basis",
        fxRate: "FX rate",
        accounts: "Accounts",
        quantity: "Quantity",
        dailyChangePercent: "Daily change %",
        allocation: "Allocation",
        priceTranslationTitle: "Price translation",
        reportingCurrencySentence: "Reporting currency is {currency}.",
        reportingPriceWithCurrency: "Reporting price ({currency})",
        nativePriceWithCurrency: "Native price ({currency})",
        quoteStatus: "Quote status",
        quoteStatusMissing: "No quote",
        quoteStatusProvisional: "Provisional",
        quoteStatusCurrent: "Current",
        severityCritical: "Critical",
        severityWarning: "Warning",
        severityInfo: "Info",
        viewTransactionRecords: "View {count} records",
        openRealizedPnlTransactions: "Open realized P&L transactions",
        strictTotalsNoticeTitle: "Strict totals",
        strictTotalsNoticeDescription: "Market value, unrealized P&L, and daily change stay unavailable instead of showing partial totals while one or more holdings are still waiting for current reportable valuations.",
        viewDataHealth: "View Data Health",
        whyHidden: "Why hidden?",
        dataHealthChecklistTitle: "Data Health checklist",
        dataHealthChecklistDescription: "Active causes explain why report valuation values may be unavailable.",
        dataHealthActive: "Active",
        dataHealthInactive: "Not active in this scope",
        dataHealthInactiveDescription: "This cause was requested by a link, but it is not active in the current report scope.",
        dataHealthAffectedTickers: "Affected tickers",
        dataHealthAffectedMarkets: "Affected markets",
        dataHealthAffectedFxPairs: "Affected FX pairs",
        dataHealthNoAffectedItems: "No affected items available",
        dataHealthSettingsRepairAction: "Open Settings ticker repair",
        dataHealthAdminRepairAction: "Open Admin Market Data",
        dataHealthCopyAdminAction: "Copy admin link",
        dataHealthAdminCopied: "Admin link copied",
        dataHealthMissingQuoteTitle: "Missing quote prices",
        dataHealthMissingQuoteDescription: "One or more holdings do not have a usable quote price for report valuation.",
        dataHealthProvisionalQuoteTitle: "Provisional quote prices",
        dataHealthProvisionalQuoteDescription: "One or more holdings are using provisional quote data.",
        dataHealthNonCurrentPriceTitle: "Non-current prices",
        dataHealthNonCurrentPriceDescription: "One or more holdings do not have a current reportable price.",
        dataHealthMissingFxTitle: "Missing FX rates",
        dataHealthMissingFxDescription: "One or more currency conversions are missing.",
        dataHealthMissingSnapshotTitle: "Missing daily snapshots",
        dataHealthMissingSnapshotDescription: "The report is missing daily snapshot coverage for this scope.",
        dataHealthStaleSnapshotTitle: "Stale daily snapshots",
        dataHealthStaleSnapshotDescription: "The latest daily snapshot is older than expected.",
        dataHealthMissingProviderSourceTitle: "Missing provider source",
        dataHealthMissingProviderSourceDescription: "A market data provider source is not configured for one or more affected markets.",
      },
      holdings: {
        dataHealthTerm: "Data health",
        dataHealthDescription: "Quote status, FX conversion, and price freshness. Allocation fallback appears when relevant.",
        dataHealthHoldingCount: "Holdings",
        dataHealthMissingQuoteCount: "Missing quotes",
        dataHealthProvisionalQuoteCount: "Provisional quotes",
        dataHealthMissingFxCount: "Missing FX",
        dataHealthStaleQuoteCount: "Stale quotes",
        statusCurrent: "Current",
        statusProvisional: "Provisional",
        statusMissing: "Missing quote",
        fxStatusComplete: "FX complete",
        fxStatusPartial: "FX partial",
        fxStatusMissing: "FX missing",
        freshnessCurrent: "Fresh",
        freshnessStale: "Stale",
        freshnessDelayed: "Delayed",
        priceStateUpdated: "Updated {relative}",
        priceStateDelayed: "Delayed {relative}",
        priceStatePreviousClose: "Previous close",
        priceStateClosed: "Closed",
        priceStateStale: "Stale close",
        priceStateUnavailable: "Unavailable",
        priceStateBasisLabel: "Basis",
        priceStateMarketStateLabel: "Market",
        priceStateAsOfLabel: "As of",
        priceStateObservedAtLabel: "Observed",
        priceStateSourceLabel: "Source",
        priceStateQualityLabel: "Quality",
        priceStateDelayLabel: "Delay",
        priceStateTimeZoneLabel: "Time zone",
        priceStateUnknownValue: "Unknown",
        priceStateBasisIntraday: "Intraday",
        priceStateBasisDelayedIntraday: "Delayed intraday",
        priceStateBasisPreviousClose: "Previous close",
        priceStateBasisTodayClose: "Today close",
        priceStateBasisPendingTodayClose: "Pending today close",
        priceStateBasisStaleClose: "Stale close",
        priceStateBasisMissing: "Missing",
        priceStateMarketOpen: "Open",
        priceStateMarketClosed: "Closed",
        priceStateQualityFullBar: "Full bar",
        priceStateQualityCloseOnly: "Close only",
        priceStateDelaySeconds: "{count} seconds",
        priceStateDelayMinutes: "{count} minutes",
        priceStateCloseDetailsLabel: "Close",
        averageCostTerm: "Avg Cost",
        unitPnlTerm: "Unit P&L",
        columnSettingsButtonLabel: "Columns",
        columnSettingsTitle: "Column settings",
        dragColumnTitle: "Drag to reorder {column}",
        layoutStyleLabel: "Table style",
        layoutStyleCompact: "Dashboard Top Holdings",
        layoutStyleDetailed: "Portfolio Holdings",
        moveColumnLeftAria: "Move {column} column left",
        moveColumnRightAria: "Move {column} column right",
        resizeColumnAria: "Resize {column} column",
        resetColumnsLabel: "Reset",
        toggleColumnAria: "Show {column} column",
        allocationFallbackMissingQuote: "Missing quote; allocation uses cost basis",
      },
      valuationHealth: {
        absoluteExceeded: "Current valuation and the latest usable snapshot diverge beyond the absolute threshold.",
        action: "Recommended action",
        adminHelp: "Admins can open the affected-holdings repair flow and follow market-data remediation with targeted snapshot repair.",
        adminRepairAction: "Open admin repair",
        affectedHoldings: "Holdings affecting latest valuation freshness",
        adminLinkCopied: "Admin link copied",
        awaitingLatestBar: "Awaiting latest bar",
        backfillAction: "Run admin backfill",
        backfillFailed: "Backfill failed",
        backfillPending: "Backfill pending",
        chartValue: "Chart valuation",
        comparableSnapshotDate: "Comparable snapshot",
        copyAdminHelpLink: "Copy admin link · {market}",
        currentValue: "Current valuation",
        delta: "Delta",
        healthy: "Healthy",
        latestBarAsOf: "Latest bar date",
        latestSnapshotDate: "Latest snapshot date",
        market: "Market",
        marketFreshness: "Market freshness",
        material: "Material gap",
        missing: "Missing",
        missingCurrentValue: "Current valuation is unavailable, so the gap cannot be compared yet.",
        missingLatestBar: "Missing latest bar",
        missingSnapshot: "Missing snapshot",
        missingSnapshotValue: "The latest snapshot-backed chart point is unavailable.",
        none: "None",
        outOfSyncTitle: "Market data out of sync",
        relativeDelta: "Relative delta",
        relativeExceeded: "Current valuation and the latest usable snapshot diverge beyond the relative threshold.",
        partialSnapshotDate: "Partial snapshot",
        snapshotOnly: "Charts stay snapshot-only and do not inject live holdings into historical points.",
        snapshotRepairAction: "Repair snapshots",
        settingsRepairAction: "Open Settings repair",
        stale: "Stale",
        staleSnapshot: "Stale snapshot",
        status: "Status",
        ticker: "Ticker",
        title: "Valuation health",
        unavailable: "Unavailable",
        userInfoHelp: "Current valuation and snapshot-backed chart values are within the configured threshold; this panel explains the chart data source.",
        userInfoTipTitle: "No action needed",
        userNoRepairHelp: "No repair action is available yet. The holding opened after the latest available market bar, so the chart can catch up after the next bar and snapshot run.",
        userNoRepairTipTitle: "Waiting for market data",
        userRepairHelp: "No repair action is available here. If the gap persists, wait for market data to settle and refresh again, or ask an admin to repair the affected holdings.",
        userRepairTipTitle: "Admin repair required",
        strictTotalsNotice: "Main valuation KPIs stay unavailable instead of showing partial totals while one or more affected holdings are still waiting for current reportable valuations.",
        waitForBackfill: "Wait for backfill",
        withinThreshold: "Current valuation and the latest chart snapshot are still within the configured threshold.",
        withinTolerance: "The difference is only within minor-unit rounding tolerance.",
      },
    },
  }),
}));

vi.mock("../../../hooks/useEffectiveRanges", () => ({
  useEffectiveRanges: () => ({ effectiveRanges: effectiveRangesMock.value }),
}));

vi.mock("../../../features/reports/hooks/useReportData", () => ({
  useReportData: (args: { initialReport: DailyReviewReportDto | PortfolioReportDto; state: ReportRouteState }) => {
    useReportDataMock(args);
    return {
      data: reportHookOverride.data === undefined ? args.initialReport : reportHookOverride.data,
      errorMessage: reportHookOverride.errorMessage,
      isBootstrapping: reportHookOverride.isBootstrapping,
      isRefreshing: false,
      refresh: refreshMock,
      restoredFromCache: false,
      restoredAt: null,
    };
  },
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  class ResizeObserverStub {
    observe(): void {
      return undefined;
    }
    unobserve(): void {
      return undefined;
    }
    disconnect(): void {
      return undefined;
    }
  }
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.stubGlobal("fetch", fetchMock);
});

const fixture: DailyReviewReportDto = {
  capabilities: {
    configuredMarkets: ["AU", "US"],
    configuredCurrencies: ["AUD", "USD"],
  },
  query: {
    scope: "all",
    currencyMode: "specified",
    currency: "AUD",
    reportingCurrency: "AUD",
    nativeCurrency: null,
    range: "1Y",
    rangeStartDate: "2025-06-08",
    rangeEndDate: "2026-06-08",
    asOf: "2026-06-08",
  },
  summary: {
    costBasisAmount: 1000,
    marketValueAmount: 1200,
    unrealizedPnlAmount: 200,
    realizedPnlAmount: 30,
    realizedPnlTransactionCount: 2,
    dailyChangeAmount: 10,
    dailyChangePercent: 0.8,
    incomeAmount: 15,
    upcomingDividendCount: 1,
    upcomingDividendAmount: 12,
  },
  fxStatus: {
    status: "complete",
    reportingCurrency: "AUD",
    nativeCurrencies: ["AUD"],
    missingRatePairs: [],
  },
  dataHealth: {
    holdingCount: 1,
    missingQuoteCount: 0,
    provisionalQuoteCount: 0,
    missingFxCount: 0,
    nonCurrentPriceCount: 0,
  },
  diagnostics: {
    scope: "all",
    reportingCurrency: "AUD",
    requestedAsOf: "2026-06-08",
    lastValuationDate: "2026-06-08",
    marketDataStaleSince: null,
    latestSnapshotDate: "2026-06-08",
    latestReliableValuationDate: "2026-06-08",
    expectedLatestValuationDate: "2026-06-08",
    staleSinceDate: null,
    missingQuoteCount: 0,
    provisionalQuoteCount: 0,
    nonCurrentPriceCount: 0,
    missingFxCount: 0,
    missingProviderSourceCount: 0,
    markets: [],
    knownGapReasons: [],
    rowCounts: {
      holdingsTotal: 1,
      holdingsReturned: 1,
      topMovers: 0,
      suggestions: 1,
    },
  },
  suggestions: [{ code: "coverage", severity: "info", title: "Coverage looks complete", detail: "All rows resolved." }],
  topMovers: [],
  holdings: {
    total: 1,
    limit: 25,
    offset: 0,
    rows: [{
      ticker: "BHP",
      instrumentName: "BHP Group",
      marketCode: "AU",
      accountCount: 1,
      quantity: 5,
      nativeCurrency: "AUD",
      nativeAverageCostPerShare: 200,
      nativeCurrentUnitPrice: 240,
      nativeCostBasisAmount: 1000,
      nativeMarketValueAmount: 1200,
      reportingCurrency: "AUD",
      reportingAverageCostPerShare: 200,
      reportingCurrentUnitPrice: 240,
      reportingCostBasisAmount: 1000,
      reportingMarketValueAmount: 1200,
      reportingUnrealizedPnlAmount: 200,
      reportingAllocationPercent: 100,
      fxRateToReporting: 1,
      dailyChangeAmount: 10,
      dailyChangePercent: 0.8,
      quoteStatus: "current",
      fxStatus: "complete",
      priceState: testPriceState(),
    }],
  },
};

const portfolioFixture: PortfolioReportDto = {
  capabilities: fixture.capabilities,
  query: {
    ...fixture.query,
    range: "1Y",
  },
  summary: fixture.summary,
  fxStatus: fixture.fxStatus,
  dataHealth: fixture.dataHealth,
  diagnostics: {
    ...fixture.diagnostics,
    lastValuationDate: "2026-05-29",
    marketDataStaleSince: "2026-05-29",
    rowCounts: {
      holdingsTotal: 1,
      holdingsReturned: 1,
      topHoldings: 1,
      marketBuckets: 1,
      accountBuckets: 1,
    },
  },
  performance: {
    range: "1Y",
    reportingCurrency: "AUD",
    fxStatus: "complete",
    requestedAsOf: "2026-06-08",
    lastReliableDate: "2026-05-29",
    marketDataStaleSince: "2026-05-29",
    points: [
      {
        date: "2026-05-29",
        totalCostAmount: 1000,
        marketValueAmount: 1200,
        unrealizedPnlAmount: 200,
        cumulativeRealizedPnlAmount: 30,
        cumulativeDividendsAmount: 15,
        totalReturnAmount: 245,
        totalReturnPercent: 24.5,
        fxAvailable: true,
      },
    ],
  },
  allocation: {
    byMarket: [{ key: "AU", label: "Australia", reportingCurrency: "AUD", amount: 1200, allocationPercent: 100 }],
    byAccount: [{ key: "acct-1", label: "Main", reportingCurrency: "AUD", amount: 1200, allocationPercent: 100 }],
    byTicker: [{ ticker: "BHP", instrumentName: "BHP Group", marketCode: "AU", accountCount: 1, reportingCurrency: "AUD", reportingAmount: 1200, portfolioAllocationPercent: 100, allocationBasisUsed: "market_value", allocationBasisFallbackReason: null, quoteStatus: "current", fxStatus: "complete" }],
  },
  concentration: {
    topHoldings: fixture.holdings.rows,
  },
  income: {
    trailingDividendAmount: 15,
    recentDividendCount: 1,
  },
  holdings: fixture.holdings,
};

const marketFixture: MarketReportDto = {
  capabilities: fixture.capabilities,
  query: { ...portfolioFixture.query, scope: "AU" },
  summary: portfolioFixture.summary,
  fxStatus: portfolioFixture.fxStatus,
  dataHealth: portfolioFixture.dataHealth,
  diagnostics: portfolioFixture.diagnostics,
  performance: portfolioFixture.performance,
  marketSummary: portfolioFixture.allocation.byMarket,
  topHoldings: fixture.holdings.rows,
  detail: fixture.holdings,
};

function reportHoldingRow(overrides: Partial<ReportHoldingRowDto>): ReportHoldingRowDto {
  const source = fixture.holdings.rows[0];
  if (!source) throw new Error("Expected report holding fixture row");
  return { ...source, ...overrides };
}

function reportHoldingTickerOrder(contextKey: string): string[] {
  const table = document.querySelector(`[data-testid='reports-holdings-table-${contextKey}']`);
  if (!table) return [];
  return Array.from(table.querySelectorAll("tbody tr")).map((row) => {
    const tickerLink = row.querySelector<HTMLAnchorElement>("a[href^='/tickers/']");
    return tickerLink?.getAttribute("href")?.match(/\/tickers\/([^?]+)/)?.[1] ?? "";
  });
}

function reportsPreferencePatches(): Array<Record<string, unknown>> {
  return fetchMock.mock.calls.flatMap(([_input, init]) => {
    if (init?.method !== "PATCH") return [];
    return [JSON.parse(String(init.body)) as Record<string, unknown>];
  });
}

describe("ReportsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    refreshMock.mockReset();
    replaceMock.mockReset();
    openQuickActionsMock.mockReset();
    useReportDataMock.mockReset();
    fetchMock.mockReset();
    reportHookOverride.data = undefined;
    reportHookOverride.errorMessage = "";
    reportHookOverride.isBootstrapping = false;
    appShellStateMock.isSharedContext = false;
    appShellStateMock.portfolioCapabilities = null;
    appShellStateMock.sessionUserRole = "viewer";
    appShellStateMock.sharedContextPermissions = { canManageAccounts: true };
    searchParamsMock.value = "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y";
    effectiveRangesMock.value = ["1M", "1Y"];
    userPreferencesMock.value = {};
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ preferences: userPreferencesMock.value }), { status: 200 });
      }
      return new Response(JSON.stringify({ preferences: userPreferencesMock.value }), { status: 200 });
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows the readonly zero-account gate when reports resolve zero configured markets in shared context", async () => {
    appShellStateMock.isSharedContext = true;
    appShellStateMock.sharedContextPermissions = { canManageAccounts: false };
    reportHookOverride.data = {
      ...fixture,
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });
    await act(async () => {});

    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-gate']")).not.toBeNull();
    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-cta']")).toBeNull();
    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-readonly']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-tabs']")).toBeNull();
  });

  it("renders a static single-scope context for single-market report capabilities", async () => {
    reportHookOverride.data = {
      ...fixture,
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      query: {
        ...fixture.query,
        scope: "TW",
        reportingCurrency: "TWD",
        currency: "TWD",
      },
      fxStatus: {
        ...fixture.fxStatus,
        reportingCurrency: "TWD",
        nativeCurrencies: ["TWD"],
      },
      diagnostics: {
        ...fixture.diagnostics,
        scope: "TW",
        reportingCurrency: "TWD",
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={reportHookOverride.data ?? null} initialState={parseReportRouteState({ scope: "TW" })} />);
    });
    await act(async () => {});

    expect(document.querySelector("[data-testid='portfolio-capabilities-single-context-report-scope']")?.textContent).toContain("TW");
    expect(document.querySelector("[data-testid='reports-control-scope']")).toBeNull();
  });

  it("renders the multi-market scope selector for TW+US report capabilities", async () => {
    reportHookOverride.data = {
      ...fixture,
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={reportHookOverride.data ?? null} initialState={parseReportRouteState({})} />);
    });
    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-control-scope']")).not.toBeNull();
    expect(document.querySelector("[data-testid='portfolio-capabilities-single-context-report-scope']")).toBeNull();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("normalizes stale report scopes to all and shows the report scope capability notice", async () => {
    searchParamsMock.value = "tab=daily-review&scope=US&range=1Y";
    reportHookOverride.data = {
      ...fixture,
      capabilities: {
        configuredMarkets: ["TW", "AU"],
        configuredCurrencies: ["TWD", "AUD"],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={reportHookOverride.data ?? null} initialState={parseReportRouteState({ scope: "US" })} />);
    });
    await act(async () => {});

    expect(`${window.location.pathname}${window.location.search}`).toBe(
      "/reports?tab=daily-review&scope=all&range=1Y",
    );
    expect(replaceMock).not.toHaveBeenCalled();
    expect(document.querySelector("[data-testid='portfolio-capabilities-normalization-notice-reportScope']")).not.toBeNull();
  });

  it("keeps rendering report content when configured markets exist but the report data is empty", async () => {
    reportHookOverride.data = {
      ...fixture,
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      dataHealth: {
        ...fixture.dataHealth,
        holdingCount: 0,
      },
      diagnostics: {
        ...fixture.diagnostics,
        rowCounts: {
          ...fixture.diagnostics.rowCounts,
          holdingsReturned: 0,
          holdingsTotal: 0,
        },
      },
      topMovers: [],
      holdings: {
        ...fixture.holdings,
        total: 0,
        rows: [],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={reportHookOverride.data ?? null} initialState={parseReportRouteState({ scope: "TW" })} />);
    });
    await act(async () => {});

    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-gate']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-daily-review-content']")).not.toBeNull();
  });

  it("[Holdings terminology]: uses Cost basis and holdings consistently in English and Traditional Chinese", () => {
    const en = getDictionary("en");
    const zh = getDictionary("zh-TW");
    expect(en.dashboardHome.totalCostLabel).toBe("Cost basis");
    expect(en.dashboardHome.topHoldingsShowingSummary).toContain("grouped holdings");
    expect(en.dashboardHome.topHoldingsAccountHolding).toBe("Account holding");
    expect(en.reports.holding).toBe("Holding");
    expect(zh.dashboardHome.totalCostLabel).toBe("成本基礎");
    expect(zh.dashboardHome.topHoldingsAccountHolding).toBe("帳戶持倉");
    expect(zh.reports.holding).toBe("持倉");
  });

  it.runIf(process.env.HOLDINGS_PERF_CAPTURE === "1")("captures the current Reports deterministic sort-to-commit baseline", async () => {
    const sourceRow = fixture.holdings.rows[0];
    if (!sourceRow) throw new Error("Expected report holding fixture row");
    const fixtureRows = Array.from({ length: 25 }, (_, index) => ({
      ...sourceRow,
      ticker: `R${String(index).padStart(4, "0")}`,
      marketCode: index % 2 === 0 ? "AU" as const : "US" as const,
      quantity: 5 + index * 11,
      reportingMarketValueAmount: 1_200 + ((index * 7_919) % 400_000),
      reportingCostBasisAmount: 1_000 + ((index * 3_571) % 350_000),
      reportingUnrealizedPnlAmount: ((index * 1_013) % 90_000) - 45_000,
      dailyChangeAmount: ((index * 71) % 4_000) - 2_000,
      dailyChangePercent: ((index * 17) % 230 - 115) / 10,
      reportingAllocationPercent: ((index * 37) % 1_000) / 10,
    }));
    const largeFixture: DailyReviewReportDto = {
      ...fixture,
      dataHealth: { ...fixture.dataHealth, holdingCount: fixtureRows.length },
      diagnostics: {
        ...fixture.diagnostics,
        rowCounts: {
          ...fixture.diagnostics.rowCounts,
          holdingsReturned: fixtureRows.length,
          holdingsTotal: fixtureRows.length,
        },
      },
      holdings: {
        ...fixture.holdings,
        limit: fixtureRows.length,
        rows: fixtureRows,
        total: fixtureRows.length,
      },
    };
    const recorder = createCommitProfilerRecorder({
      measuredCount: 8,
      name: "reports-current-sort-to-commit",
      warmupCount: 3,
    });
    act(() => {
      root.render(
        <Profiler id="reports-current-sort" onRender={recorder.onRender}>
          <ReportsClient initialReport={largeFixture} initialState={parseReportRouteState({})} />
        </Profiler>,
      );
    });
    await act(async () => {});

    const presetGroup = document.querySelector('[data-testid="reports-holdings-presets-reports.dailyReview.holdings"]');
    const buttons = Array.from(presetGroup?.querySelectorAll("button") ?? []);
    const largest = buttons.find((button) => button.textContent?.includes("Largest"));
    const worstPnl = buttons.find((button) => button.textContent?.includes("Worst P&L first"));
    if (!largest || !worstPnl) throw new Error("Expected Reports focus preset buttons");
    for (let iteration = 0; iteration < 11; iteration += 1) {
      const button = iteration % 2 === 0 ? worstPnl : largest;
      recorder.arm(iteration % 2 === 0 ? "worst-pnl" : "largest");
      act(() => {
        button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      recorder.assertCommitted();
    }
    recordPerformanceScenario(recorder.scenario({
      interaction: "alternate existing Worst P&L and Largest focus controls",
      measuredCount: 8,
      renderedDesktopRowCount: fixtureRows.length,
      renderedMobileRowCount: fixtureRows.length,
      sourceRowCount: fixtureRows.length,
      warmupCount: 3,
    }));
  }, 60_000);

  it("[Reports holdings]: render canonical columns → market code stays in Ticker and account/quantity values are not duplicated", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });
    await act(async () => {});

    const table = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    const headers = Array.from(table?.querySelectorAll("thead th") ?? []).map((header) => header.textContent?.trim());
    expect(headers).toEqual([
      "Ticker",
      "Accounts",
      "Quantity",
      "Average cost",
      "Price",
      "Unit P&L",
      "Market value",
      "Cost basis",
      "Daily change",
      "Unrealized P&L",
      "Allocation",
      "Data health",
      "Actions",
    ]);
    const cells = Array.from(table?.querySelectorAll("tbody tr:first-child td") ?? []);
    expect(cells[0]?.textContent).toContain("BHP");
    expect(cells[0]?.textContent).toContain("AU");
    expect(cells[1]?.textContent?.trim()).toBe("1");
    expect(cells[2]?.textContent?.trim()).toBe("5");
    expect(cells[0]?.textContent).not.toContain("acct");
    expect(cells[0]?.textContent).not.toContain("units");
    expect(document.body.textContent).not.toContain("Book Cost");
    expect(document.body.textContent).not.toContain("Weight");
  });

  it("[Reports reports.dailyReview.topMovers]: preserve API mover rank by default without PATCH", async () => {
    const topMovers = [
      reportHoldingRow({ ticker: "BIGGEST_MOVE", reportingMarketValueAmount: 100 }),
      reportHoldingRow({ ticker: "LARGEST_HOLDING", reportingMarketValueAmount: 900 }),
    ];
    act(() => {
      root.render(<ReportsClient
        initialReport={{ ...fixture, topMovers } as DailyReviewReportDto}
        initialState={parseReportRouteState({})}
      />);
    });
    await act(async () => {});

    expect(reportHoldingTickerOrder("reports.dailyReview.topMovers")).toEqual(["BIGGEST_MOVE", "LARGEST_HOLDING"]);
    const table = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.topMovers']");
    expect(table?.querySelector("th[aria-sort]")).toBeNull();
    expect(reportsPreferencePatches()).toEqual([]);
  });

  it.each([
    { contextKey: "reports.dailyReview.holdings", initialReport: fixture, route: {} },
    {
      contextKey: "reports.portfolio.holdings",
      initialReport: portfolioFixture,
      route: { tab: "portfolio", range: "1Y" },
    },
    {
      contextKey: "reports.market.topHoldings",
      initialReport: marketFixture,
      route: { tab: "market", scope: "AU", range: "1Y" },
    },
    {
      contextKey: "reports.market.detail",
      initialReport: marketFixture,
      route: { tab: "market", scope: "AU", range: "1Y" },
    },
  ])("[Reports $contextKey]: hydrate defaults → Market value descending is active without PATCH", async ({ contextKey, initialReport, route }) => {
    searchParamsMock.value = new URLSearchParams(
      Object.entries(route).map(([key, value]) => [key, String(value)]),
    ).toString();
    act(() => {
      root.render(<ReportsClient initialReport={initialReport} initialState={parseReportRouteState(route)} />);
    });
    await act(async () => {});

    const table = document.querySelector(`[data-testid='reports-holdings-table-${contextKey}']`);
    const marketValueHeader = table?.querySelector("[data-testid$='column-sort-marketValue']")?.closest("th");
    expect(marketValueHeader?.getAttribute("aria-sort")).toBe("descending");
    expect(reportsPreferencePatches()).toEqual([]);
  });

  it("[Reports legacy hydration]: materialize multiple contexts in memory without PATCH until an explicit interaction", async () => {
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["ticker", "pnl", "health"],
            hiddenColumns: ["health"],
            rowOrder: ["AU:BHP"],
          },
        },
      },
    };
    const rows = [reportHoldingRow({ ticker: "BHP", marketCode: "AU" })];
    const data = {
      ...fixture,
      topMovers: rows,
      holdings: { ...fixture.holdings, rows, total: rows.length },
    } as DailyReviewReportDto;
    act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.topMovers']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']")).not.toBeNull();
    expect(reportsPreferencePatches()).toEqual([]);
  });

  it("[Reports contexts]: commit one header sort → only that stable context is persisted once", async () => {
    const rows = [
      reportHoldingRow({ ticker: "ALPHA", marketCode: "AU", reportingMarketValueAmount: 100 }),
      reportHoldingRow({ ticker: "ZULU", marketCode: "US", reportingMarketValueAmount: 900 }),
    ];
    const data = {
      ...fixture,
      topMovers: rows,
      holdings: { ...fixture.holdings, rows, total: rows.length },
    } as DailyReviewReportDto;
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.topMovers": { sortDirection: "desc", sortField: "marketValue", sortMode: "field" },
          "reports.dailyReview.holdings": { sortDirection: "asc", sortField: "ticker", sortMode: "field" },
        },
      },
    };
    act(() => {
      root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />);
    });
    await act(async () => {});
    expect(reportHoldingTickerOrder("reports.dailyReview.topMovers")).toEqual(["ZULU", "ALPHA"]);
    expect(reportHoldingTickerOrder("reports.dailyReview.holdings")).toEqual(["ALPHA", "ZULU"]);
    expect(reportsPreferencePatches()).toEqual([]);

    const topMoversTable = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.topMovers']");
    const tickerSort = topMoversTable?.querySelector<HTMLButtonElement>("[data-testid$='column-sort-ticker']");
    expect(tickerSort).not.toBeNull();
    act(() => tickerSort?.click());
    await act(async () => {});

    const patches = reportsPreferencePatches();
    expect(patches).toHaveLength(1);
    expect(patches[0]).toEqual({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.topMovers": expect.objectContaining({
            sortDirection: "asc",
            sortField: "ticker",
            sortMode: "field",
          }),
        },
      },
    });
  });

  it("[Reports adapter]: hydrate Average cost ascending → reporting values sort once with missing last and identity ties", async () => {
    const rows = [
      reportHoldingRow({ ticker: "MISSING", marketCode: "US", nativeAverageCostPerShare: 1, reportingAverageCostPerShare: null, reportingMarketValueAmount: 900 }),
      reportHoldingRow({ ticker: "BETA", marketCode: "US", nativeAverageCostPerShare: 2, reportingAverageCostPerShare: 10, reportingMarketValueAmount: 800 }),
      reportHoldingRow({ ticker: "ALPHA", marketCode: "AU", nativeAverageCostPerShare: 999, reportingAverageCostPerShare: 10, reportingMarketValueAmount: 100 }),
      reportHoldingRow({ ticker: "MID", marketCode: "AU", nativeAverageCostPerShare: 0, reportingAverageCostPerShare: 30, reportingMarketValueAmount: 700 }),
    ];
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.holdings": { sortDirection: "asc", sortField: "averageCost", sortMode: "field" },
        },
      },
    };
    const data = { ...fixture, holdings: { ...fixture.holdings, rows, total: rows.length } } as DailyReviewReportDto;
    act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    expect(reportHoldingTickerOrder("reports.dailyReview.holdings")).toEqual(["ALPHA", "BETA", "MID", "MISSING"]);
    const largestPreset = Array.from(document.querySelectorAll("[data-testid='reports-holdings-presets-reports.dailyReview.holdings'] button"))
      .find((button) => button.textContent?.includes("Largest"));
    expect(largestPreset?.getAttribute("data-state")).toBe("off");
    expect(reportsPreferencePatches()).toEqual([]);
  });

  it("[Reports controls]: hide the active sort field → desktop, keyboard, mobile, and hidden-sort controls remain isolated", async () => {
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.holdings": {
            hiddenColumns: ["allocation"],
            sortDirection: "desc",
            sortField: "allocation",
            sortMode: "field",
          },
        },
      },
    };
    act(() => root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    const prefix = "reports-holdings-reports.dailyReview.holdings";
    const table = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    const marketValueSort = table?.querySelector<HTMLButtonElement>("[data-testid='holdings-column-sort-marketValue']");
    const marketValueDrag = table?.querySelector("[data-testid='holdings-column-drag-marketValue']");
    const marketValueResize = table?.querySelector("[data-testid='holdings-column-resize-marketValue']");
    expect(marketValueSort).not.toBeNull();
    expect(marketValueSort?.closest("[draggable='true']")).toBeNull();
    expect(marketValueDrag?.contains(marketValueSort ?? null)).toBe(false);
    expect(marketValueResize).not.toBe(marketValueSort);
    expect(document.querySelector(`[data-testid='${prefix}-mobile-sort-field']`)).not.toBeNull();
    expect(document.querySelector(`[data-testid='${prefix}-mobile-sort-direction']`)).not.toBeNull();
    expect(document.querySelector(`[data-testid='${prefix}-hidden-sort-chip']`)?.textContent).toMatch(/Allocation.*descending/i);
  });

  it("[Reports presets]: explicit sort after Stale quotes → filter remains; selecting Largest reapplies Market value descending", async () => {
    const rows = [
      reportHoldingRow({ ticker: "STALE_LOW", quantity: 2, reportingMarketValueAmount: 200, priceState: testPriceState({ basis: "stale_close", chipState: "stale" }) }),
      reportHoldingRow({ ticker: "STALE_HIGH", quantity: 9, reportingMarketValueAmount: 300, priceState: testPriceState({ basis: "stale_close", chipState: "stale" }) }),
      reportHoldingRow({ ticker: "CURRENT", quantity: 5, reportingMarketValueAmount: 1_000, priceState: testPriceState() }),
    ];
    const data = { ...fixture, holdings: { ...fixture.holdings, rows, total: rows.length } } as DailyReviewReportDto;
    act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    const presets = document.querySelector("[data-testid='reports-holdings-presets-reports.dailyReview.holdings']");
    const stale = Array.from(presets?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Stale quotes"));
    const largest = Array.from(presets?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("Largest"));
    expect(largest?.getAttribute("data-state")).toBe("on");
    act(() => stale?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(stale?.getAttribute("data-state")).toBe("on");
    const table = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    const quantitySort = table?.querySelector<HTMLButtonElement>("[data-testid$='column-sort-quantity']");
    expect(quantitySort).not.toBeNull();
    act(() => quantitySort?.click());
    expect(reportHoldingTickerOrder("reports.dailyReview.holdings")).toEqual(["STALE_HIGH", "STALE_LOW"]);
    expect(stale?.getAttribute("data-state")).toBe("on");

    act(() => largest?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(reportHoldingTickerOrder("reports.dailyReview.holdings")).toEqual(["CURRENT", "STALE_HIGH", "STALE_LOW"]);
    expect(table?.querySelector("[data-testid$='column-sort-marketValue']")?.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(largest?.getAttribute("data-state")).toBe("on");

    act(() => quantitySort?.click());
    expect(largest?.getAttribute("data-state")).toBe("off");
    expect(quantitySort?.closest("th")?.getAttribute("aria-sort")).toBe("descending");
    expect(document.querySelector("[data-testid='reports-holdings-presets-select-reports.dailyReview.holdings']")?.hasAttribute("data-placeholder")).toBe(true);
  });

  it("[Reports top-N]: hydrate a semantic sort → complete loaded rows sort before limiting without URL/API sort state", async () => {
    const loadedRows = [
      reportHoldingRow({ ticker: "Q40", quantity: 40, reportingMarketValueAmount: 4_000 }),
      reportHoldingRow({ ticker: "Q10", quantity: 10, reportingMarketValueAmount: 1_000 }),
      reportHoldingRow({ ticker: "Q30", quantity: 30, reportingMarketValueAmount: 3_000 }),
      reportHoldingRow({ ticker: "Q20", quantity: 20, reportingMarketValueAmount: 2_000 }),
    ];
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.topMovers": {
            sortDirection: "asc",
            sortField: "quantity",
            sortMode: "field",
            topHoldingsLimit: 2,
          },
        },
      },
    };
    const data = {
      ...fixture,
      diagnostics: {
        ...fixture.diagnostics,
        rowCounts: { ...fixture.diagnostics.rowCounts, holdingsReturned: 1_000, holdingsTotal: 1_000 },
      },
      topMovers: loadedRows,
      holdings: { ...fixture.holdings, limit: 1_000, rows: loadedRows, total: 1_000 },
    } as DailyReviewReportDto;
    act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    expect(reportHoldingTickerOrder("reports.dailyReview.topMovers")).toEqual(["Q10", "Q20"]);
    expect(useReportDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
      state: expect.not.objectContaining({ sortDirection: expect.anything(), sortField: expect.anything() }),
    }));
    expect(replaceMock.mock.calls.map((call) => String(call[0])).join(" ")).not.toMatch(/sort(Field|Direction|Mode)?=/i);
    expect(fetchMock.mock.calls.map((call) => String(call[0])).join(" ")).not.toMatch(/[?&]sort/i);
  });

  it.each([
    { contextKey: "reports.dailyReview.topMovers", tab: "daily" as const },
    { contextKey: "reports.market.topHoldings", tab: "market" as const },
  ])("[Reports $contextKey]: use the server leader rows even when paginated detail contains a different local winner", async ({ contextKey, tab }) => {
    const serverLeader = reportHoldingRow({ ticker: "SERVER_LEADER", quantity: 50, reportingMarketValueAmount: 500 });
    const paginatedDetailRows = [
      reportHoldingRow({ ticker: "DETAIL_WINNER", quantity: 1, reportingMarketValueAmount: 100 }),
      reportHoldingRow({ ticker: "DETAIL_SECOND", quantity: 20, reportingMarketValueAmount: 200 }),
    ];
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          [contextKey]: { sortDirection: "asc", sortField: "quantity", sortMode: "field", topHoldingsLimit: 1 },
        },
      },
    };
    if (tab === "market") {
      searchParamsMock.value = "tab=market&scope=AU&range=1Y";
      const data = {
        ...marketFixture,
        topHoldings: [serverLeader],
        detail: { ...marketFixture.detail, rows: paginatedDetailRows, total: 100 },
      } as MarketReportDto;
      act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({ tab: "market", scope: "AU", range: "1Y" })} />));
    } else {
      const data = {
        ...fixture,
        topMovers: [serverLeader],
        holdings: { ...fixture.holdings, rows: paginatedDetailRows, total: 100 },
      } as DailyReviewReportDto;
      act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    }
    await act(async () => {});

    expect(reportHoldingTickerOrder(contextKey)).toEqual(["SERVER_LEADER"]);
  });

  it("[Reports allocation]: filter rows → displayed allocation preserves the API report-scope percentage", async () => {
    const rows = [
      reportHoldingRow({ ticker: "AU_ONLY", marketCode: "AU", reportingMarketValueAmount: 100, reportingAllocationPercent: 25 }),
      reportHoldingRow({ ticker: "US_ONLY", marketCode: "US", reportingMarketValueAmount: 300, reportingAllocationPercent: 75 }),
    ];
    const data = { ...fixture, holdings: { ...fixture.holdings, rows, total: rows.length } } as DailyReviewReportDto;
    act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    const search = document.querySelector<HTMLInputElement>("[data-testid='reports-holdings-search-reports.dailyReview.holdings']");
    if (!search) throw new Error("Expected Reports holdings search");
    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setter?.call(search, "AU_ONLY");
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const table = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    const row = table?.querySelector("tbody tr");
    expect(row?.textContent).toContain("AU_ONLY");
    expect(row?.textContent).toContain("25%");
    expect(row?.textContent).not.toContain("100%");
  });

  it("[Reports data health]: sort inferred fallback with deterministic quote, freshness, FX, and fallback precedence", async () => {
    const rows = [
      reportHoldingRow({ ticker: "HEALTHY", reportingMarketValueAmount: 100, reportingCostBasisAmount: 90, quoteStatus: "current", fxStatus: "complete", priceState: testPriceState() }),
      reportHoldingRow({ ticker: "FALLBACK", reportingMarketValueAmount: null, reportingCostBasisAmount: 90, quoteStatus: "current", fxStatus: "complete", priceState: testPriceState() }),
      reportHoldingRow({ ticker: "PARTIAL_FX", reportingMarketValueAmount: 100, quoteStatus: "current", fxStatus: "partial", priceState: testPriceState() }),
      reportHoldingRow({ ticker: "STALE", reportingMarketValueAmount: 100, quoteStatus: "current", fxStatus: "complete", priceState: testPriceState({ basis: "stale_close", chipState: "stale" }) }),
      reportHoldingRow({ ticker: "MISSING_QUOTE", reportingMarketValueAmount: null, reportingCostBasisAmount: null, quoteStatus: "missing", fxStatus: "complete", priceState: testPriceState() }),
    ];
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.dailyReview.holdings": { sortDirection: "desc", sortField: "dataHealth", sortMode: "field" },
        },
      },
    };
    const data = { ...fixture, holdings: { ...fixture.holdings, rows, total: rows.length } } as DailyReviewReportDto;
    act(() => root.render(<ReportsClient initialReport={data} initialState={parseReportRouteState({})} />));
    await act(async () => {});

    expect(reportHoldingTickerOrder("reports.dailyReview.holdings")).toEqual([
      "MISSING_QUOTE",
      "STALE",
      "PARTIAL_FX",
      "FALLBACK",
      "HEALTHY",
    ]);
  });

  it("[Reports mobile]: reserves lower card space so the quick-action FAB does not cover a holding metric", async () => {
    act(() => root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />));
    await act(async () => {});
    const table = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    expect(table?.closest(".pb-24")).not.toBeNull();
    const metrics = document.querySelector("[data-testid='reports-mobile-metrics-BHP-AU']");
    expect(metrics?.classList.contains("pr-12")).toBe(true);
    expect(metrics?.classList.contains("pb-14")).toBe(true);
    expect(metrics?.classList.contains("sm:pr-0")).toBe(true);
    expect(metrics?.classList.contains("sm:pb-0")).toBe(true);
  });

  it("renders daily report summary, controls, and mobile detail rows", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Reports");
    expect(document.body.textContent).toContain("Daily Review");
    expect(document.body.textContent).toContain("AUD");
    expect(document.querySelector("[data-testid='reports-control-scope']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-control-range']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-control-currency']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-control-currency-mode']")).toBeNull();
    expect(document.body.textContent).toContain("Resolved AUD");
    expect(document.body.textContent).toContain("Upcoming income");
    expect(document.body.textContent).toContain("1 dividend(s)");
    expect(document.body.textContent).toContain("Coverage looks complete");
    expect(document.body.textContent).toContain("Quote status, FX conversion, and price freshness. Allocation fallback appears when relevant.");
    expect(document.body.textContent).toContain("Data health");
    expect(document.body.textContent).toContain("BHP Group");
    const mobileRow = document.querySelector("[data-testid='reports-mobile-row-BHP-AU']");
    expect(mobileRow).not.toBeNull();
    expect(mobileRow?.textContent).toContain("BHP");
    expect(mobileRow?.textContent).toContain("BHP Group");
    expect(mobileRow?.textContent).toContain("5");
    expect(mobileRow?.textContent).toContain("A$1,200");
    expect(mobileRow?.textContent).toContain("Open ticker");
    expect(mobileRow?.textContent).toContain("View details");

    const viewDetailsButton = Array.from(mobileRow?.querySelectorAll("button") ?? []).find((button) => button.textContent?.includes("View details"));
    expect(viewDetailsButton).not.toBeUndefined();
    act(() => {
      viewDetailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("Cost basis");
    expect(dialog?.textContent).toContain("Daily change");
    expect(dialog?.textContent).toContain("Allocation");
    expect(dialog?.textContent).toContain("Daily change %");
    expect(dialog?.textContent).toContain("Allocation");

    const sectionRefresh = document.querySelector("[data-testid='reports-today-refresh']");
    expect(sectionRefresh).not.toBeNull();
    act(() => {
      sectionRefresh?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(refreshMock).toHaveBeenCalledWith({ bypassCache: true });

    const quickActionsButton = document.querySelector("[data-testid='reports-open-quick-actions']");
    expect(quickActionsButton).not.toBeNull();
    act(() => {
      quickActionsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openQuickActionsMock).toHaveBeenCalledTimes(1);
  });

  it("renders a realized P&L drilldown link with range, scope, and returnTo when summary count is positive", async () => {
    searchParamsMock.value = "tab=portfolio&scope=AU&range=1M";
    const drilldownFixture: PortfolioReportDto = {
      ...portfolioFixture,
      query: {
        ...portfolioFixture.query,
        scope: "AU",
        range: "1M",
        rangeStartDate: "2026-05-21",
        rangeEndDate: "2026-06-21",
        asOf: "2026-06-21",
      },
      summary: {
        ...portfolioFixture.summary,
        realizedPnlAmount: 45,
        realizedPnlTransactionCount: 2,
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={drilldownFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "AU",
        range: "1M",
      })} />);
    });

    await act(async () => {});

    const drilldownHref = Array.from(document.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href"))
      .find((href) => href?.includes("/transactions?") && href.includes("pnl=realized"));

    expect(drilldownHref).toBeTruthy();
    const url = new URL(drilldownHref!, "http://localhost");
    expect(url.pathname).toBe("/transactions");
    expect(url.searchParams.get("type")).toBe("SELL");
    expect(url.searchParams.get("pnl")).toBe("realized");
    expect(url.searchParams.get("marketCode")).toBe("AU");
    expect(url.searchParams.get("from")).toBe("2026-05-21");
    expect(url.searchParams.get("to")).toBe("2026-06-21");
    expect(url.searchParams.get("returnTo")).toBe("/reports?tab=portfolio&scope=AU&range=1M");
  });

  it("keeps the realized P&L summary non-clickable when there are no realized transactions", async () => {
    searchParamsMock.value = "tab=portfolio&scope=AU&range=1M";
    const emptyDrilldownFixture: PortfolioReportDto = {
      ...portfolioFixture,
      query: {
        ...portfolioFixture.query,
        scope: "AU",
        range: "1M",
        rangeStartDate: "2026-05-21",
        rangeEndDate: "2026-06-21",
        asOf: "2026-06-21",
      },
      summary: {
        ...portfolioFixture.summary,
        realizedPnlAmount: 0,
        realizedPnlTransactionCount: 0,
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={emptyDrilldownFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "AU",
        range: "1M",
      })} />);
    });

    await act(async () => {});

    const drilldownLinks = Array.from(document.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href"))
      .filter((href): href is string => Boolean(href?.includes("/transactions?") && href.includes("pnl=realized")));

    expect(drilldownLinks).toHaveLength(0);
  });

  it("renders unrealized P&L analysis deep links for summary and holding rows", async () => {
    searchParamsMock.value = "tab=portfolio&scope=US&range=1M";
    const scopedFixture: PortfolioReportDto = {
      ...portfolioFixture,
      query: {
        ...portfolioFixture.query,
        scope: "US",
        reportingCurrency: "USD",
        range: "1M",
      },
      holdings: {
        ...portfolioFixture.holdings,
        rows: portfolioFixture.holdings.rows.map((row) => ({
          ...row,
          ticker: "NVDA",
          marketCode: "US",
          reportingCurrency: "USD",
        })),
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={scopedFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "US",
        range: "1M",
      })} />);
    });

    await act(async () => {});

    const summaryHref = document.querySelector("[data-testid='reports-summary-unrealized-pnl-analysis-link']")?.getAttribute("href");
    expect(summaryHref).toBe("/analysis/unrealized-pnl?range=1M&markets=US&reportingCurrency=USD");

    const rowHref = document.querySelector("[data-testid='reports-holding-analysis-link-NVDA-US']")?.getAttribute("href");
    expect(rowHref).toContain("/analysis/unrealized-pnl?");
    expect(rowHref).toContain("tickerIds=US%3ANVDA");
    expect(rowHref).toContain("selection=manualTickers");
    expect(rowHref).toContain("tickerMode=custom");
    expect(rowHref).toContain("view=ticker-detail");
    expect(rowHref).toContain("reportingCurrency=USD");
  });

  it("renders a valuation basis disclosure near the report meta header", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    const basisFixture: PortfolioReportDto = {
      ...portfolioFixture,
      fxStatus: {
        ...portfolioFixture.fxStatus,
        nativeCurrencies: ["USD"],
      },
      fxRates: [{
        fromCurrency: "USD",
        toCurrency: "AUD",
        rate: 1.52,
        asOf: "2026-06-08",
      }],
      diagnostics: {
        ...portfolioFixture.diagnostics,
        markets: [{
          marketCode: "AU",
          expectedLatestValuationDate: "2026-06-08",
          latestSnapshotDate: "2026-06-07",
          missingProviderSourceCount: 0,
          providerSources: ["Test Feed"],
          knownGapReasons: [],
        }],
        valuationBasis: {
          semantics: "current_report_valuation",
          reportingCurrency: "AUD",
          reportAsOf: "2026-06-08",
          fxAsOfDate: "2026-06-08",
          markets: [{
            marketCode: "AU",
            requestedAsOf: "2026-06-08",
            expectedLatestValuationDate: "2026-06-08",
            quoteAsOfDate: "2026-06-07",
            quoteSource: "Test Feed",
            quoteSourceKind: "primary_daily",
            usesFallbackQuote: true,
            fallbackProvider: "eodhd",
            fallbackStale: null,
            calendarStatus: null,
            marketState: null,
            marketStateReason: null,
            marketLocalDate: "2026-06-08",
            closureDate: "2026-06-08",
            closureName: null,
            closureReason: "market_holiday",
            fxAsOfDate: "2026-06-08",
            reportingCurrency: "AUD",
          }],
        },
      },
      holdings: {
        ...portfolioFixture.holdings,
        rows: portfolioFixture.holdings.rows.map((row) => ({
          ...row,
          priceState: testPriceState({
            asOfDate: "2026-06-07",
            basis: "fallback_eod_close",
            fallbackProvider: "eodhd",
            source: "Test Feed",
          }),
        })),
      },
      concentration: {
        ...portfolioFixture.concentration,
        topHoldings: portfolioFixture.concentration.topHoldings.map((row) => ({
          ...row,
          priceState: testPriceState({
            asOfDate: "2026-06-07",
            basis: "fallback_eod_close",
            fallbackProvider: "eodhd",
            source: "Test Feed",
          }),
        })),
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={basisFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-basis-strip']")?.textContent).toContain("Valuation basis");
    expect(document.querySelector("[data-testid='reports-basis-market-AU']")?.textContent).toContain("Quote Jun 7, 2026");
    expect(document.querySelector("[data-testid='reports-basis-market-AU']")?.textContent).toContain("Source eodhd");
    expect(document.querySelector("[data-testid='reports-basis-market-AU']")?.textContent).toContain("Fallback quote used");
    expect(document.querySelector("[data-testid='reports-basis-market-AU']")?.textContent).toContain("AU closed Jun 8, 2026: using Jun 7, 2026 close");
    expect(document.querySelector("[data-testid='reports-basis-fx']")?.textContent).toContain("FX as of Jun 8, 2026");
  });

  it("discloses mixed per-holding sources when only part of a market uses fallback quotes", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1M";
    const baseRow = portfolioFixture.holdings.rows[0]!;
    const qauRow = {
      ...baseRow,
      ticker: "QAU",
      instrumentName: "BetaShares Gold Bullion ETF",
      priceState: testPriceState({
        asOfDate: "2026-07-03",
        basis: "today_close",
        source: "yahoo-finance-au",
      }),
    };
    const etpmagRow = {
      ...baseRow,
      ticker: "ETPMAG",
      instrumentName: "Global X Physical Silver",
      quantity: 23,
      priceState: testPriceState({
        asOfDate: "2026-07-03",
        basis: "fallback_eod_close",
        chipState: "stale",
        source: "eodhd",
        fallbackProvider: "eodhd",
      }),
    };
    const mixedSourceFixture: PortfolioReportDto = {
      ...portfolioFixture,
      diagnostics: {
        ...portfolioFixture.diagnostics,
        markets: [{
          marketCode: "AU",
          expectedLatestValuationDate: "2026-07-03",
          latestSnapshotDate: "2026-07-03",
          missingProviderSourceCount: 0,
          providerSources: ["yahoo-finance-au", "eodhd"],
          knownGapReasons: ["non_current_price"],
        }],
        valuationBasis: {
          semantics: "current_report_valuation",
          reportingCurrency: "AUD",
          reportAsOf: "2026-07-06",
          fxAsOfDate: null,
          markets: [{
            marketCode: "AU",
            requestedAsOf: "2026-07-06",
            expectedLatestValuationDate: "2026-07-03",
            quoteAsOfDate: "2026-07-03",
            quoteSource: "eodhd",
            quoteSources: ["eodhd", "yahoo-finance-au"],
            quoteSourceKind: "eodhd_eod",
            usesFallbackQuote: true,
            fallbackQuoteCount: 1,
            fallbackProvider: "eodhd",
            fallbackProviders: ["eodhd"],
            holdingCount: 2,
            fallbackStale: true,
            calendarStatus: null,
            marketState: null,
            marketStateReason: null,
            marketLocalDate: "2026-07-06",
            closureDate: null,
            closureName: null,
            closureReason: null,
            fxAsOfDate: null,
            reportingCurrency: "AUD",
          }],
        },
      },
      holdings: {
        ...portfolioFixture.holdings,
        total: 2,
        rows: [qauRow, etpmagRow],
      },
      concentration: {
        ...portfolioFixture.concentration,
        topHoldings: [qauRow, etpmagRow],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={mixedSourceFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1M",
      })} />);
    });

    await act(async () => {});

    const auBasis = document.querySelector("[data-testid='reports-basis-market-AU']")?.textContent;
    expect(auBasis).toContain("Sources by holding: eodhd, yahoo-finance-au");
    expect(auBasis).toContain("Fallback quote used by 1/2 holdings");
    expect(auBasis).not.toContain("Source eodhdFallback quote used");
  });

  it("does not label missing FX as latest available in valuation basis disclosure", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    const missingFxFixture: PortfolioReportDto = {
      ...portfolioFixture,
      fxStatus: {
        ...portfolioFixture.fxStatus,
        status: "missing",
        nativeCurrencies: ["USD"],
        missingRatePairs: [{ from: "USD", to: "AUD" }],
      },
      fxRates: [],
    };

    act(() => {
      root.render(<ReportsClient initialReport={missingFxFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const fxBasis = document.querySelector("[data-testid='reports-basis-fx']")?.textContent;
    expect(fxBasis).toContain("FX unavailable for USD->AUD");
    expect(fxBasis).not.toContain("Latest available FX in report response");
  });

  it("does not label stale or unknown-calendar quotes as market closures in valuation basis disclosure", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    const staleQuoteFixture: PortfolioReportDto = {
      ...portfolioFixture,
      diagnostics: {
        ...portfolioFixture.diagnostics,
        valuationBasis: {
          semantics: "current_report_valuation",
          reportingCurrency: "AUD",
          reportAsOf: "2026-07-06",
          fxAsOfDate: null,
          markets: [{
            marketCode: "US",
            requestedAsOf: "2026-07-06",
            expectedLatestValuationDate: "2026-07-06",
            quoteAsOfDate: "2026-07-02",
            quoteSource: "test-us-close",
            quoteSourceKind: "primary_daily",
            usesFallbackQuote: false,
            fallbackProvider: null,
            fallbackStale: null,
            calendarStatus: null,
            marketState: null,
            marketStateReason: null,
            marketLocalDate: "2026-07-06",
            closureDate: "2026-07-03",
            closureName: null,
            closureReason: "calendar_unknown",
            fxAsOfDate: null,
            reportingCurrency: "AUD",
          }],
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={staleQuoteFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const marketBasis = document.querySelector("[data-testid='reports-basis-market-US']")?.textContent;
    expect(marketBasis).toContain("Stale market data: US expected Jul 6, 2026, using Jul 2, 2026 close");
    expect(marketBasis).not.toContain("US closed");
  });

  it("surfaces missing FX pairs before resolved date summaries in valuation basis disclosure", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    const partialFxFixture: PortfolioReportDto = {
      ...portfolioFixture,
      query: {
        ...portfolioFixture.query,
        currency: "TWD",
        reportingCurrency: "TWD",
      },
      fxStatus: {
        ...portfolioFixture.fxStatus,
        status: "partial",
        reportingCurrency: "TWD",
        nativeCurrencies: ["USD", "AUD"],
        missingRatePairs: [{ from: "AUD", to: "TWD" }],
      },
      fxRates: [{
        fromCurrency: "USD",
        toCurrency: "TWD",
        rate: 32,
        asOf: "2026-06-08",
      }],
    };

    act(() => {
      root.render(<ReportsClient initialReport={partialFxFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const fxBasis = document.querySelector("[data-testid='reports-basis-fx']")?.textContent;
    expect(fxBasis).toContain("FX unavailable for AUD->TWD");
    expect(fxBasis).toContain("FX as of Jun 8, 2026");
  });

  it("renders the ticker allocation card and persists chart preferences through holdings table settings", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["health", "ticker", "position", "avgCost", "price", "unitPnl", "marketValue", "costBasis", "unrealized", "daily", "weight"],
            hiddenColumns: ["health"],
            columnWidths: { ticker: 220 },
            layoutStyle: "portfolio",
          },
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={portfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const allocationCard = document.querySelector("[data-testid='reports-ticker-allocation-card']");
    expect(allocationCard?.textContent).toContain("Ticker allocation");
    expect(allocationCard?.textContent).toContain("Allocation basis: Market value.");
    expect(allocationCard?.textContent).not.toContain("Income");
    expect(allocationCard?.textContent).not.toContain("Concentration");

    const allocationRow = document.querySelector("[data-testid='reports-ticker-allocation-row-AU:BHP']");
    expect(allocationRow?.textContent).toContain("BHP");
    expect(allocationRow?.textContent).toContain("BHP Group");
    act(() => {
      allocationRow?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(document.querySelector("[data-testid='reports-ticker-allocation-detail']")?.textContent).toContain("Allocation details");

    const pieButton = Array.from(document.querySelectorAll("[data-testid='reports-ticker-allocation-mode'] button"))
      .find((button) => button.textContent?.includes("Pie"));
    expect(pieButton).toBeDefined();
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["ticker", "health", "position", "avgCost", "price", "unitPnl", "marketValue", "costBasis", "unrealized", "daily", "weight"],
            hiddenColumns: ["health", "daily"],
            columnWidths: { ticker: 260 },
            layoutStyle: "portfolio",
          },
        },
      },
    };
    act(() => {
      pieButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.querySelector("[data-testid='reports-ticker-allocation-pie']")).not.toBeNull();
    await act(async () => {});
    await act(async () => {});

    const settingsPatch = fetchMock.mock.calls.find(([_input, init]) => {
      if (init?.method !== "PATCH") return false;
      const body = JSON.parse(String(init.body)) as {
        holdingsTableSettings?: { contexts?: Record<string, unknown> };
      };
      return body.holdingsTableSettings?.contexts?.["reports.portfolio.tickerAllocation"] !== undefined;
    });
    expect(settingsPatch).toBeDefined();
    const patchBody = JSON.parse(String(settingsPatch?.[1]?.body)) as {
      holdingsTableSettings?: {
        contexts?: Record<string, unknown>;
      };
    };
    expect(patchBody.holdingsTableSettings?.contexts?.["holdings.shared"]).toBeUndefined();
    expect(patchBody.holdingsTableSettings?.contexts?.["reports.portfolio.tickerAllocation"]).toEqual({
      tickerAllocationChartMode: "pie",
      tickerAllocationTopN: "auto",
    });
    expect(holdingsTableSettingsPreferenceSchema.safeParse(patchBody.holdingsTableSettings).success).toBe(true);
  });

  it("clears a forced market filter when returning ticker allocation to all markets", async () => {
    const allMarketsFixture: PortfolioReportDto = {
      ...portfolioFixture,
      query: {
        ...portfolioFixture.query,
        scope: "all",
      },
      allocation: {
        ...portfolioFixture.allocation,
        byTicker: [
          ...portfolioFixture.allocation.byTicker,
          {
            ticker: "AAPL",
            instrumentName: "Apple Inc.",
            marketCode: "US",
            accountCount: 1,
            reportingCurrency: "AUD",
            reportingAmount: 800,
            portfolioAllocationPercent: 40,
            allocationBasisUsed: "market_value",
            allocationBasisFallbackReason: null,
            quoteStatus: "current",
            fxStatus: "complete",
          },
        ],
      },
    };
    const scopedMarketFixture: PortfolioReportDto = {
      ...allMarketsFixture,
      query: {
        ...allMarketsFixture.query,
        scope: "US",
      },
      allocation: {
        ...allMarketsFixture.allocation,
        byTicker: allMarketsFixture.allocation.byTicker.filter((row) => row.marketCode === "US"),
      },
    };

    searchParamsMock.value = "tab=portfolio&scope=US&range=1Y";
    act(() => {
      root.render(<ReportsClient initialReport={scopedMarketFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "US",
        range: "1Y",
      })} />);
    });
    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-ticker-allocation-row-US:AAPL']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-ticker-allocation-row-AU:BHP']")).toBeNull();

    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    act(() => {
      root.render(<ReportsClient initialReport={allMarketsFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });
    await act(async () => {});
    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-ticker-allocation-row-US:AAPL']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-ticker-allocation-row-AU:BHP']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-ticker-allocation-market-filter']")?.textContent).toContain("All markets");
  });

  it("keeps unavailable values unavailable when missing rows collapse into the Other allocation bucket", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "reports.portfolio.tickerAllocation": {
            tickerAllocationChartMode: "bars",
            tickerAllocationTopN: "5",
          },
        },
      },
    };
    const missingOtherFixture: PortfolioReportDto = {
      ...portfolioFixture,
      allocation: {
        ...portfolioFixture.allocation,
        byTicker: [
          { ...portfolioFixture.allocation.byTicker[0]!, reportingAmount: 1200, portfolioAllocationPercent: 40 },
          {
            ticker: "AAPL",
            instrumentName: "Apple Inc.",
            marketCode: "US",
            accountCount: 1,
            reportingCurrency: "AUD",
            reportingAmount: 900,
            portfolioAllocationPercent: 30,
            allocationBasisUsed: "market_value",
            allocationBasisFallbackReason: null,
            quoteStatus: "current",
            fxStatus: "complete",
          },
          {
            ticker: "MSFT",
            instrumentName: "Microsoft Corporation",
            marketCode: "US",
            accountCount: 1,
            reportingCurrency: "AUD",
            reportingAmount: 600,
            portfolioAllocationPercent: 20,
            allocationBasisUsed: "market_value",
            allocationBasisFallbackReason: null,
            quoteStatus: "current",
            fxStatus: "complete",
          },
          {
            ticker: "VTS",
            instrumentName: "Vanguard US Total Market Shares Index ETF",
            marketCode: "AU",
            accountCount: 1,
            reportingCurrency: "AUD",
            reportingAmount: 200,
            portfolioAllocationPercent: 7,
            allocationBasisUsed: "market_value",
            allocationBasisFallbackReason: null,
            quoteStatus: "current",
            fxStatus: "complete",
          },
          {
            ticker: "NDQ",
            instrumentName: "BetaShares Nasdaq 100 ETF",
            marketCode: "AU",
            accountCount: 1,
            reportingCurrency: "AUD",
            reportingAmount: 90,
            portfolioAllocationPercent: 3,
            allocationBasisUsed: "market_value",
            allocationBasisFallbackReason: null,
            quoteStatus: "current",
            fxStatus: "complete",
          },
          {
            ticker: "005930",
            instrumentName: "Samsung Electronics",
            marketCode: "KR",
            accountCount: 1,
            reportingCurrency: "AUD",
            reportingAmount: null,
            portfolioAllocationPercent: null,
            allocationBasisUsed: "market_value",
            allocationBasisFallbackReason: null,
            quoteStatus: "current",
            fxStatus: "missing",
          },
        ],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={missingOtherFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });
    await act(async () => {});
    await act(async () => {});

    const otherRow = document.querySelector("[data-testid='reports-ticker-allocation-row-other']");
    expect(otherRow).not.toBeNull();
    expect(otherRow?.textContent).toContain("Other");
    expect(otherRow?.textContent).toContain("-");
    expect(otherRow?.textContent).not.toContain("A$0");
    expect(otherRow?.textContent).not.toContain("0%");
  });

  it("renders legacy cached portfolio reports without ticker allocation rows", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    const legacyPortfolioFixture: PortfolioReportDto = {
      ...portfolioFixture,
      allocation: {
        byMarket: portfolioFixture.allocation.byMarket,
        byAccount: portfolioFixture.allocation.byAccount,
      } as PortfolioReportDto["allocation"],
    };

    act(() => {
      root.render(<ReportsClient initialReport={legacyPortfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const allocationCard = document.querySelector("[data-testid='reports-ticker-allocation-card']");
    expect(allocationCard?.textContent).toContain("Ticker allocation");
    expect(allocationCard?.textContent).toContain("0 bucket(s)");
  });

  it("keeps legacy valuation basis conservative when any market row is missing a quote date", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    const baseRow = portfolioFixture.holdings.rows[0]!;
    const legacyMissingBasisFixture: PortfolioReportDto = {
      ...portfolioFixture,
      diagnostics: {
        ...portfolioFixture.diagnostics,
        valuationBasis: undefined,
        markets: [],
      },
      holdings: {
        ...portfolioFixture.holdings,
        total: 2,
        rows: [
          {
            ...baseRow,
            ticker: "QAU",
            instrumentName: "BetaShares Gold Bullion ETF",
            priceState: testPriceState({ asOfDate: "2026-07-03", source: "yahoo-finance-au" }),
          },
          {
            ...baseRow,
            ticker: "ETPMAG",
            instrumentName: "Global X Physical Silver",
            priceState: testPriceState({
              asOfDate: null,
              basis: "missing",
              chipState: "missing",
              source: null,
              sourceKind: "missing",
            }),
          },
        ],
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={legacyMissingBasisFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const auBasis = document.querySelector("[data-testid='reports-basis-market-AU']")?.textContent;
    expect(auBasis).toContain("Quote basis unavailable");
    expect(auBasis).not.toContain("Quote Jul 3, 2026");
  });

  it("shows ticker details and large-slice labels from the pie chart itself", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={portfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const pieButton = Array.from(document.querySelectorAll("[data-testid='reports-ticker-allocation-mode'] button"))
      .find((button) => button.textContent?.includes("Pie"));
    expect(pieButton).toBeDefined();
    act(() => {
      pieButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    const sliceLabel = document.querySelector("[data-testid='reports-ticker-allocation-pie-label-AU:BHP']");
    expect(sliceLabel?.textContent).toContain("BHP");
    expect(document.querySelector("[data-testid='reports-ticker-allocation-pie-chart']")?.textContent).toContain("100%");

    const slice = document.querySelector("[data-testid='reports-ticker-allocation-pie-slice-AU:BHP']");
    expect(slice).not.toBeNull();
    act(() => {
      slice?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await act(async () => {});

    const detail = document.querySelector("[data-testid='reports-ticker-allocation-detail']");
    expect(detail?.textContent).toContain("BHP");
    expect(detail?.textContent).toContain("BHP Group");
    expect(detail?.textContent).toContain("100%");
    act(() => {
      slice?.dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      detail?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 150));
    });

    expect(document.querySelector("[data-testid='reports-ticker-allocation-detail']")?.textContent).toContain("BHP");
  });

  it("does not patch ticker allocation chart settings after preferences fail to load", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&range=1Y";
    fetchMock.mockImplementation(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ preferences: userPreferencesMock.value }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: "Failed to load settings" }), { status: 500 });
    });

    act(() => {
      root.render(<ReportsClient initialReport={portfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const pieButton = Array.from(document.querySelectorAll("[data-testid='reports-ticker-allocation-mode'] button"))
      .find((button) => button.textContent?.includes("Pie"));
    expect(pieButton).toBeDefined();
    act(() => {
      pieButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-ticker-allocation-pie']")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([_input, init]) => init?.method === "PATCH")).toBe(false);
  });

  it("colors Today severity badges by level", async () => {
    const severityFixture: DailyReviewReportDto = {
      ...fixture,
      suggestions: [
        { code: "coverage", severity: "info", title: "Coverage looks complete", detail: "All rows resolved." },
        { code: "quotes", severity: "warning", title: "Quote coverage is mixed", detail: "Some rows need attention." },
        { code: "fx", severity: "critical", title: "FX is missing", detail: "Some totals cannot be reconciled." },
      ],
    };

    act(() => {
      root.render(<ReportsClient initialReport={severityFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-today-severity-coverage']")?.className).toContain("text-primary");
    expect(document.querySelector("[data-testid='reports-today-severity-coverage']")?.textContent).toContain("Info");
    expect(document.querySelector("[data-testid='reports-today-severity-quotes']")?.className).toContain("text-warning");
    expect(document.querySelector("[data-testid='reports-today-severity-quotes']")?.textContent).toContain("Warning");
    expect(document.querySelector("[data-testid='reports-today-severity-fx']")?.className).toContain("text-destructive");
    expect(document.querySelector("[data-testid='reports-today-severity-fx']")?.textContent).toContain("Critical");
  });

  it("renders report price-state chips outside the price disclosure button", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const chips = Array.from(document.querySelectorAll("[data-testid='reports-price-state-BHP-AU']"));
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.tagName).toBe("BUTTON");
      expect(chip.parentElement?.closest("button")).toBeNull();
    }
  });

  it("hydrates report holdings column order and widths from backend preferences", async () => {
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["health", "ticker", "position", "avgCost", "price", "unitPnl", "marketValue", "costBasis", "unrealized", "daily", "weight"],
            hiddenColumns: [],
            columnWidths: { health: 234 },
            layoutStyle: "portfolio",
          },
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const holdingsTable = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    expect(holdingsTable).not.toBeNull();
    const firstHeader = holdingsTable?.querySelector("[data-testid^='holdings-column-drag-']");
    expect(firstHeader?.getAttribute("data-testid")).toBe("holdings-column-drag-dataHealth");
    expect(firstHeader?.getAttribute("draggable")).toBe("true");
    expect((firstHeader?.closest("th") as HTMLTableCellElement | null)?.style.width).toBe("234px");
    expect(holdingsTable?.querySelector("[data-testid='holdings-column-resize-dataHealth']")).not.toBeNull();
  });

  it("keeps hidden report mobile columns out of card/details and avoids duplicate detail rows", async () => {
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["position", "avgCost", "price", "unitPnl", "costBasis", "unrealized", "daily", "weight", "ticker", "marketValue", "health"],
            hiddenColumns: ["marketValue", "health"],
            columnWidths: {},
            layoutStyle: "portfolio",
            mobileSummaryCount: 1,
          },
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const mobileRow = document.querySelector("[data-testid='reports-mobile-row-BHP-AU']");
    expect(mobileRow).not.toBeNull();
    expect(mobileRow?.textContent).not.toContain("Market value");
    expect(mobileRow?.textContent).not.toContain("Data health");

    const viewDetailsButton = Array.from(mobileRow?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("View details"));
    expect(viewDetailsButton).not.toBeUndefined();
    act(() => {
      viewDetailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).not.toContain("Market value");
    expect(dialog?.textContent).not.toContain("Data health");
    expect(dialog?.textContent?.match(/Reporting price/g) ?? []).toHaveLength(1);
  });

  it("keeps native and FX context when report columns move into mobile details", async () => {
    userPreferencesMock.value = {
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["position", "price", "marketValue", "costBasis", "daily", "ticker", "avgCost", "unitPnl", "unrealized", "weight", "health"],
            hiddenColumns: [],
            columnWidths: {},
            layoutStyle: "portfolio",
            mobileSummaryCount: 1,
          },
        },
      },
    };
    const rateFixture = {
      ...fixture,
      fxRates: [
        {
          fromCurrency: "USD",
          toCurrency: "AUD",
          rate: 1.52,
          asOf: "2026-06-08",
        },
      ],
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          nativeCurrency: "USD",
          nativeAverageCostPerShare: 100,
          nativeCurrentUnitPrice: 150,
          nativeCostBasisAmount: 500,
          nativeMarketValueAmount: 750,
          reportingAverageCostPerShare: 152,
          reportingCurrentUnitPrice: 228,
          reportingCostBasisAmount: 760,
          reportingMarketValueAmount: 1140,
          fxRateToReporting: 1.52,
          dailyChangeAmount: -10,
          dailyChangePercent: -0.8,
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={rateFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const mobileRow = document.querySelector("[data-testid='reports-mobile-row-BHP-AU']");
    const viewDetailsButton = Array.from(mobileRow?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent?.includes("View details"));
    expect(viewDetailsButton).not.toBeUndefined();
    act(() => {
      viewDetailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("Reporting price");
    expect(dialog?.textContent).toContain("Native price");
    expect(dialog?.textContent).toContain("FX rate");
    expect(dialog?.textContent).toContain("1.52");
    expect(dialog?.textContent).toContain("Native market value");
    expect(dialog?.textContent).toContain("Native cost basis");
    expect(dialog?.textContent).toContain("Daily change %");
    expect(dialog?.textContent).toContain("-0.8%");
  });

  it("links tickers, colors finance values, and renders optional fx rates", async () => {
    const rateFixture = {
      ...fixture,
      summary: {
        ...fixture.summary,
        unrealizedPnlAmount: -200,
        realizedPnlAmount: -30,
        dailyChangeAmount: -10,
        dailyChangePercent: -0.8,
      },
      fxRates: [
        {
          fromCurrency: "USD",
          toCurrency: "AUD",
          rate: 1.52,
          asOf: "2026-06-08",
        },
      ],
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          nativeCurrency: "USD",
          nativeAverageCostPerShare: 100,
          nativeCurrentUnitPrice: 150,
          nativeCostBasisAmount: 500,
          nativeMarketValueAmount: 750,
          reportingAverageCostPerShare: 152,
          reportingCurrentUnitPrice: 228,
          fxRateToReporting: 1.52,
          reportingUnrealizedPnlAmount: -200,
          dailyChangeAmount: -10,
          dailyChangePercent: -0.8,
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={rateFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const tickerLinks = Array.from(document.querySelectorAll("a")).map((anchor) => anchor.getAttribute("href"));
    expect(tickerLinks).toContain("/tickers/BHP?marketCode=AU");
    expect(document.body.textContent).toContain("Open ticker");
    const holdingsTable = document.querySelector("[data-testid='reports-holdings-table-reports.dailyReview.holdings']");
    expect(holdingsTable?.parentElement?.getAttribute("class")).toContain("lg:block");
    expect(holdingsTable?.querySelector("th")?.getAttribute("class")).toContain("sticky");
    expect(holdingsTable?.querySelector("th")?.getAttribute("class")).toContain("left-0");

    const negativeValue = Array.from(document.querySelectorAll("p, span, h3, div")).find((node) =>
      node.textContent?.includes("-A$10") && String(node.className).includes("text-[hsl(var(--finance-loss))]"));
    expect(negativeValue?.className).toContain("text-[hsl(var(--finance-loss))]");
    expect(document.body.textContent).toContain("Native price $150.00");

    const fxRates = document.querySelector("[data-testid='reports-fx-rates']");
    expect(fxRates?.textContent).toContain("USD to AUD");
    expect(fxRates?.textContent).toContain("1.52");

    const viewDetailsButton = Array.from(document.querySelectorAll("button")).find((button) => button.textContent?.includes("View details"));
    expect(viewDetailsButton).not.toBeUndefined();
    act(() => {
      viewDetailsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(document.body.textContent).toContain("Native price");
    expect(document.body.textContent).toContain("FX rate");
    expect(document.body.textContent).toContain("1.52");
    const detailPercent = Array.from(document.querySelectorAll("span")).find((node) => node.textContent?.includes("-0.8%"));
    expect(detailPercent?.className).toContain("text-[hsl(var(--finance-loss))]");
  });

  it("keeps valuation summary cards strict and explains why partial totals are hidden", async () => {
    const strictFixture = {
      ...fixture,
      dataHealth: {
        ...fixture.dataHealth,
        missingQuoteCount: 1,
        provisionalQuoteCount: 1,
      },
      summary: {
        ...fixture.summary,
        marketValueAmount: 1200,
        unrealizedPnlAmount: 200,
        dailyChangeAmount: 10,
        dailyChangePercent: 0.8,
      },
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          ticker: "AAPL",
          marketCode: "US",
          nativeCurrency: "USD",
          reportingCurrency: "AUD",
          reportingCurrentUnitPrice: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
          dailyChangeAmount: null,
          dailyChangePercent: null,
          quoteStatus: "missing",
          fxStatus: "partial",
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={strictFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const summaryGrid = document.querySelector("[data-testid='reports-summary-grid']");
    const marketValueCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Market value"));
    const unrealizedCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Unrealized P&L"));
    const dailyChangeCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Daily change"));

    expect(marketValueCard?.textContent).toContain("Market value");
    expect(marketValueCard?.textContent).toContain("-");
    expect(unrealizedCard?.textContent).toContain("-");
    expect(dailyChangeCard?.textContent).toContain("-");
    expect(document.querySelector("[data-testid='reports-strict-totals-alert']")?.textContent).toContain("Strict totals");
    expect(document.body.textContent).toContain("partial totals");
  });

  it("opens guided Data Health causes from summary links and uses settings repair before admin fallback", async () => {
    searchParamsMock.value = "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=1Y&health=1&healthReasons=missing_quote,missing_fx,stale_snapshot";
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const strictFixture = {
      ...fixture,
      dataHealth: {
        ...fixture.dataHealth,
        missingQuoteCount: 1,
        missingFxCount: 1,
        currentMissingFxCount: 1,
      },
      diagnostics: {
        ...fixture.diagnostics,
        missingQuoteCount: 1,
        missingFxCount: 1,
        markets: [{
          marketCode: "AU",
          expectedLatestValuationDate: "2026-06-08",
          latestSnapshotDate: "2026-06-08",
          missingProviderSourceCount: 0,
          providerSources: [],
          knownGapReasons: ["missing_quote", "missing_fx"],
        }],
        knownGapReasons: ["missing_quote", "missing_fx"],
      },
      fxStatus: {
        ...fixture.fxStatus,
        status: "partial",
        missingRatePairs: [{ from: "USD", to: "AUD" }],
      },
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          quoteStatus: "missing",
          fxStatus: "partial",
          reportingCurrentUnitPrice: null,
          reportingMarketValueAmount: null,
          reportingUnrealizedPnlAmount: null,
          dailyChangeAmount: null,
          dailyChangePercent: null,
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={strictFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const marketValueHref = document.querySelector<HTMLAnchorElement>("[data-testid='reports-summary-market-value-data-health-link']")?.getAttribute("href");
    expect(marketValueHref).toBe("/reports?tab=daily-review&scope=all&range=1Y&health=1&healthReasons=missing_quote%2Cmissing_fx");
    const missingQuoteCause = document.querySelector("[data-testid='reports-data-health-cause-missing_quote']");
    const missingFxCause = document.querySelector("[data-testid='reports-data-health-cause-missing_fx']");
    const staleSnapshotCause = document.querySelector("[data-testid='reports-data-health-cause-stale_snapshot']");
    expect(document.querySelector("[data-testid='reports-data-health-card']")?.className).toContain("ring-2");
    expect(missingQuoteCause?.textContent).toContain("Missing quote prices");
    expect(missingQuoteCause?.textContent).toContain("Active");
    expect(missingQuoteCause?.textContent).toContain("BHP");
    expect(missingFxCause?.textContent).toContain("Missing FX rates");
    expect(missingFxCause?.textContent).toContain("USD->AUD");
    expect(staleSnapshotCause?.textContent).toContain("Not active in this scope");

    const settingsHref = document.querySelector<HTMLAnchorElement>("[data-testid='reports-data-health-settings-missing_quote']")?.getAttribute("href");
    expect(settingsHref).toContain("/settings/tickers?repair=1&origin=data-health&healthReason=missing_quote");
    expect(settingsHref).toContain("tickers=BHP");
    expect(settingsHref).toContain("returnTo=%2Freports%3Ftab%3Ddaily-review");
    expect(settingsHref).toContain("health%3D1");
    expect(settingsHref).toContain("healthReasons%3Dmissing_quote%252Cmissing_fx%252Cstale_snapshot");
    expect(document.querySelector("[data-testid='reports-data-health-admin-missing_quote']")).toBeNull();
    const copyAdminLinkButton = document.querySelector<HTMLButtonElement>("[data-testid='reports-data-health-copy-admin-missing_quote']");
    expect(copyAdminLinkButton).not.toBeNull();

    await act(async () => {
      copyAdminLinkButton?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("/admin/market-data"));

    const copyFxAdminLinkButton = document.querySelector<HTMLButtonElement>("[data-testid='reports-data-health-copy-admin-missing_fx']");
    expect(copyFxAdminLinkButton).not.toBeNull();
    await act(async () => {
      copyFxAdminLinkButton?.click();
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenLastCalledWith(expect.stringContaining("/admin/market-data/FX/overview"));
  });

  it("focuses the Data Health card after a health deep link cold load finishes", async () => {
    searchParamsMock.value = "tab=daily-review&scope=all&range=1Y&health=1&healthReason=missing_quote";
    const scrollIntoView = vi.fn();
    const focus = vi.fn();
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView;
    const originalFocus = HTMLElement.prototype.focus;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(HTMLElement.prototype, "focus", {
      configurable: true,
      value: focus,
    });
    const requestAnimationFrameSpy = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    try {
      reportHookOverride.data = null;
      reportHookOverride.isBootstrapping = true;
      act(() => {
        root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
      });
      await act(async () => {});
      expect(scrollIntoView).not.toHaveBeenCalled();
      expect(focus).not.toHaveBeenCalled();

      reportHookOverride.data = fixture;
      reportHookOverride.isBootstrapping = false;
      act(() => {
        root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
      });
      await act(async () => {});

      expect(scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
      expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    } finally {
      requestAnimationFrameSpy.mockRestore();
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
        configurable: true,
        value: originalScrollIntoView,
      });
      Object.defineProperty(HTMLElement.prototype, "focus", {
        configurable: true,
        value: originalFocus,
      });
      reportHookOverride.data = undefined;
      reportHookOverride.isBootstrapping = false;
    }
  });

  it("names affected tickers for active stale daily snapshot causes", async () => {
    searchParamsMock.value = "tab=daily-review&scope=all&range=1Y";
    const staleFixture = {
      ...fixture,
      diagnostics: {
        ...fixture.diagnostics,
        lastValuationDate: "2026-06-03",
        latestSnapshotDate: "2026-06-03",
        latestReliableValuationDate: "2026-06-03",
        staleSinceDate: "2026-06-03",
        marketDataStaleSince: "2026-06-03",
        knownGapReasons: [],
        markets: [],
        snapshotGapHoldings: [{
          ticker: "BHP",
          marketCode: "AU",
          accountCount: 1,
          affectedAccountCount: 1,
          latestSnapshotDate: "2026-06-03",
          expectedLatestValuationDate: "2026-06-08",
          knownGapReasons: ["stale_snapshot"],
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={staleFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const staleSnapshotCause = document.querySelector("[data-testid='reports-data-health-cause-stale_snapshot']");
    expect(staleSnapshotCause?.textContent).toContain("Stale daily snapshots");
    expect(staleSnapshotCause?.textContent).toContain("Active");
    expect(staleSnapshotCause?.textContent).toContain("BHP");
    expect(staleSnapshotCause?.textContent).toContain("AU");

    const settingsHref = document.querySelector<HTMLAnchorElement>("[data-testid='reports-data-health-settings-stale_snapshot']")?.getAttribute("href");
    expect(settingsHref).toContain("/settings/tickers?repair=1&origin=data-health&healthReason=stale_snapshot");
    expect(settingsHref).toContain("market=AU");
    expect(settingsHref).toContain("tickers=BHP");
  });

  it("uses valuation health affected holdings when stale snapshot diagnostics are aggregate-only", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";
    const staleFixture: PortfolioReportDto = {
      ...portfolioFixture,
      diagnostics: {
        ...portfolioFixture.diagnostics,
        lastValuationDate: "2026-06-03",
        latestSnapshotDate: "2026-06-03",
        latestReliableValuationDate: "2026-06-03",
        staleSinceDate: "2026-06-03",
        marketDataStaleSince: "2026-06-03",
        knownGapReasons: ["stale_snapshot"],
        markets: [{
          marketCode: "US",
          expectedLatestValuationDate: "2026-06-08",
          latestSnapshotDate: "2026-06-03",
          missingProviderSourceCount: 0,
          providerSources: [],
          knownGapReasons: ["stale_snapshot"],
        }],
        snapshotGapHoldings: [],
      },
      performance: {
        ...portfolioFixture.performance,
        valuationHealth: {
          status: "material",
          reason: "absolute_threshold_exceeded",
          reportingCurrency: "AUD",
          currentValueAmount: 2600,
          snapshotValueAmount: 2400,
          deltaAmount: 200,
          relativeDeltaBps: 770,
          minorUnitTolerance: 1,
          thresholds: {
            relativeBps: 50,
            absoluteAud: 10,
            absoluteUsd: 10,
            absoluteTwd: 300,
            absoluteKrw: 10_000,
          },
          latestBarAsOf: "2026-06-08",
          latestSnapshotDate: "2026-06-03",
          latestUsableSnapshotDate: "2026-06-03",
          latestComparableSnapshotDate: "2026-06-03",
          latestPartialSnapshotDate: null,
          expectedLatestValuationDate: "2026-06-08",
          affectedHoldings: [{
            ticker: "VRT",
            marketCode: "US",
            currentReportingValueAmount: 2600,
            latestBarDate: "2026-06-08",
            latestSnapshotDate: "2026-06-03",
            backfillStatus: "ready",
            status: "stale_snapshot",
            recommendedAction: "run_snapshot_repair",
          }],
          recommendedActions: ["run_snapshot_repair"],
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={staleFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    const staleSnapshotCause = document.querySelector("[data-testid='reports-data-health-cause-stale_snapshot']");
    expect(staleSnapshotCause?.textContent).toContain("Stale daily snapshots");
    expect(staleSnapshotCause?.textContent).toContain("Active");
    expect(staleSnapshotCause?.textContent).toContain("VRT");
    expect(staleSnapshotCause?.textContent).toContain("US");

    const settingsHref = document.querySelector<HTMLAnchorElement>("[data-testid='reports-data-health-settings-stale_snapshot']")?.getAttribute("href");
    expect(settingsHref).toContain("/settings/tickers?repair=1&origin=data-health&healthReason=stale_snapshot");
    expect(settingsHref).toContain("market=US");
    expect(settingsHref).toContain("tickers=VRT");
  });

  it("does not hide current valuation totals for historical-only missing FX gaps", async () => {
    const historicalFxFixture = {
      ...fixture,
      dataHealth: {
        ...fixture.dataHealth,
        missingFxCount: 1,
        currentMissingFxCount: 0,
      },
      diagnostics: {
        ...fixture.diagnostics,
        missingFxCount: 1,
        knownGapReasons: ["missing_fx"],
      },
      fxStatus: {
        ...fixture.fxStatus,
        status: "partial",
        missingRatePairs: [{ from: "USD", to: "AUD" }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={historicalFxFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const summaryGrid = document.querySelector("[data-testid='reports-summary-grid']");
    const marketValueCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Market value"));
    const unrealizedCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Unrealized P&L"));
    const dailyChangeCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Daily change"));

    expect(marketValueCard?.textContent).toContain("A$1,200");
    expect(unrealizedCard?.textContent).toContain("A$200");
    expect(dailyChangeCard?.textContent).toContain("A$10");
    expect(document.querySelector("[data-testid='reports-strict-totals-alert']")).toBeNull();
  });

  it("keeps valuation summary cards strict when prices are non-current", async () => {
    const nonCurrentPriceFixture = {
      ...fixture,
      dataHealth: {
        ...fixture.dataHealth,
        nonCurrentPriceCount: 1,
      },
      diagnostics: {
        ...fixture.diagnostics,
        nonCurrentPriceCount: 1,
        knownGapReasons: ["non_current_price"],
      },
      holdings: {
        ...fixture.holdings,
        rows: [{
          ...fixture.holdings.rows[0]!,
          priceState: testPriceState({ basis: "previous_close", chipState: "open_previous_close" }),
          quoteStatus: "current",
          fxStatus: "complete",
        }],
      },
    } as DailyReviewReportDto;

    act(() => {
      root.render(<ReportsClient initialReport={nonCurrentPriceFixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    const summaryGrid = document.querySelector("[data-testid='reports-summary-grid']");
    const marketValueCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Market value"));
    const unrealizedCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Unrealized P&L"));
    const dailyChangeCard = Array.from(summaryGrid?.querySelectorAll("[class*='rounded']") ?? [])
      .find((node) => node.textContent?.includes("Daily change"));

    expect(marketValueCard?.textContent).toContain("-");
    expect(unrealizedCard?.textContent).toContain("-");
    expect(dailyChangeCard?.textContent).toContain("-");
    expect(document.querySelector("[data-testid='reports-strict-totals-alert']")?.textContent).toContain("Strict totals");
  });

  it("does not render a stale daily-review DTO as another report tab", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-loading-skeleton']")).not.toBeNull();
    expect(document.body.textContent).not.toContain("Performance trend");
  });

  it("keeps cached report content visible when refresh reports an error", async () => {
    reportHookOverride.errorMessage = "Report refresh timed out. Try refreshing again.";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-error']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-refresh-error']")?.textContent).toContain("Report refresh timed out");
    expect(document.querySelector("[data-testid='reports-daily-review-content']")).not.toBeNull();
    expect(document.body.textContent).toContain("Top movers");
  });

  it("renders portfolio report performance as-of and stale-data metadata", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={portfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    expect(document.body.textContent).toContain("Performance trend");
    expect(document.body.textContent).toContain("As of May 29, 2026");
    expect(document.body.textContent).toContain("Market data stale since May 29, 2026");
    expect(document.querySelector("[data-testid='reports-performance-stale-warning']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-performance-as-of-tooltip-trigger']")).not.toBeNull();
  });

  it("does not create a stale snapshot checklist cause from performance metadata alone", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";

    act(() => {
      root.render(<ReportsClient initialReport={portfolioFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-performance-stale-warning']")).not.toBeNull();
    expect(document.querySelector("[data-testid='reports-data-health-cause-stale_snapshot']")).toBeNull();
  });

  it("does not create snapshot repair causes for empty report scopes", async () => {
    searchParamsMock.value = "tab=portfolio&scope=US&currencyMode=specified&currency=AUD&range=1Y";
    const emptyScopeFixture: PortfolioReportDto = {
      ...portfolioFixture,
      query: {
        ...portfolioFixture.query,
        scope: "US",
      },
      dataHealth: {
        holdingCount: 0,
        missingQuoteCount: 0,
        provisionalQuoteCount: 0,
        missingFxCount: 0,
        nonCurrentPriceCount: 0,
      },
      diagnostics: {
        ...portfolioFixture.diagnostics,
        scope: "US",
        lastValuationDate: null,
        latestSnapshotDate: null,
        latestReliableValuationDate: null,
        knownGapReasons: ["missing_snapshot"],
        rowCounts: {
          holdingsTotal: 0,
          holdingsReturned: 0,
          topHoldings: 0,
          marketBuckets: 0,
          accountBuckets: 0,
        },
      },
      performance: {
        ...portfolioFixture.performance,
        points: [],
        lastReliableDate: null,
        marketDataStaleSince: null,
        diagnostics: {
          latestSnapshotDate: null,
          latestReliableValuationDate: null,
          latestComparableSnapshotDate: null,
          latestPartialSnapshotDate: null,
          hasPartialMarketData: false,
          expectedLatestValuationDate: "2026-06-08",
          staleSinceDate: null,
          knownGapReasons: ["missing_snapshot"],
        },
      },
      allocation: {
        byMarket: [],
        byAccount: [],
        byTicker: [],
      },
      concentration: {
        topHoldings: [],
      },
      holdings: {
        rows: [],
        total: 0,
        limit: 50,
        offset: 0,
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={emptyScopeFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "US",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='reports-data-health-cause-missing_snapshot']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-data-health-settings-missing_snapshot']")).toBeNull();
    expect(document.querySelector("[data-testid='reports-data-health-admin-missing_snapshot']")).toBeNull();
  });

  it("does not show strict totals notice for healthy valuation health with suppressed affected holdings", async () => {
    searchParamsMock.value = "tab=portfolio&scope=all&currencyMode=specified&currency=AUD&range=1Y";
    const healthyFixture: PortfolioReportDto = {
      ...portfolioFixture,
      diagnostics: {
        ...portfolioFixture.diagnostics,
        marketDataStaleSince: null,
      },
      performance: {
        ...portfolioFixture.performance,
        marketDataStaleSince: null,
        valuationHealth: {
          status: "healthy",
          reason: "within_threshold",
          reportingCurrency: "AUD",
          currentValueAmount: 1200,
          snapshotValueAmount: 1199.99,
          deltaAmount: 0.01,
          relativeDeltaBps: 0.1,
          minorUnitTolerance: 1,
          thresholds: {
            relativeBps: 50,
            absoluteAud: 10,
            absoluteUsd: 10,
            absoluteTwd: 300,
            absoluteKrw: 10_000,
          },
          latestBarAsOf: "2026-06-08",
          latestSnapshotDate: "2026-06-08",
          latestUsableSnapshotDate: "2026-06-08",
          latestComparableSnapshotDate: "2026-06-08",
          latestPartialSnapshotDate: null,
          expectedLatestValuationDate: "2026-06-08",
          affectedHoldings: [{
            ticker: "BHP",
            marketCode: "AU",
            currentReportingValueAmount: 1200,
            latestBarDate: "2026-06-08",
            latestSnapshotDate: "2026-06-08",
            backfillStatus: "ready",
            status: "awaiting_latest_bar",
            recommendedAction: "none",
          }],
          recommendedActions: [],
        },
      },
    };

    act(() => {
      root.render(<ReportsClient initialReport={healthyFixture} initialState={parseReportRouteState({
        tab: "portfolio",
        scope: "all",
        range: "1Y",
      })} />);
    });

    await act(async () => {});

    expect(document.querySelector("[data-testid='valuation-health-panel']")).not.toBeNull();
    expect(document.querySelector("[data-testid='valuation-health-strict-totals-alert']")).toBeNull();
    expect(document.body.textContent).toContain("A$1,200");
    expect(document.body.textContent).not.toContain("Main valuation KPIs stay unavailable");
  });

  it("snaps unsupported report ranges to the configured dashboard ranges", async () => {
    searchParamsMock.value = "tab=daily-review&scope=all&currencyMode=specified&currency=AUD&range=5Y";
    effectiveRangesMock.value = ["1M", "1Y"];

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("range=1M"),
      { scroll: false },
    );
    expect(replaceMock).not.toHaveBeenCalledWith(
      expect.stringContaining("range=5Y"),
      expect.anything(),
    );
  });

  it("syncs report state from changed search params while mounted", async () => {
    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    searchParamsMock.value = "tab=market&scope=AU&currencyMode=auto&currency=AUD&range=1M";

    act(() => {
      root.render(<ReportsClient initialReport={fixture} initialState={parseReportRouteState({})} />);
    });

    await act(async () => {});

    expect(useReportDataMock).toHaveBeenLastCalledWith(expect.objectContaining({
      state: {
        tab: "market",
        scope: "AU",
        range: "1M",
      },
    }));
  });
});
