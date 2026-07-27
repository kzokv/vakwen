import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountDefaultCurrency } from "@vakwen/shared-types";
import { PortfolioClient } from "../../../components/portfolio/PortfolioClient";
import { getDictionary } from "../../../lib/i18n";
import { buildRouteDtoCacheKey, getRouteDtoContextScope } from "../../../lib/routeDtoCache";
import type { PortfolioPageData } from "../../../features/portfolio/services/portfolioService";
import { testPriceState } from "../../fixtures/priceState";

const holdingsTableMock = vi.hoisted(() => vi.fn((_props: unknown) => <div data-testid="mock-holdings-table" />));
const dashboardHoldingsPreviewMock = vi.hoisted(() => vi.fn((_props: unknown) => <div data-testid="mock-dashboard-holdings-preview" />));
const portfolioRefreshMock = vi.hoisted(() => vi.fn(async () => undefined));
const portfolioRefreshPricesMock = vi.hoisted(() => vi.fn(async () => undefined));
const refreshPortfolioClosesMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: vi.fn(),
}));

vi.mock("../../../components/layout/CardLayoutResetContext", () => ({
  useCardLayoutResetCount: () => 0,
}));

vi.mock("../../../components/layout/SortableCardGrid", () => ({
  SortableCardGrid: ({ cards, children }: { cards: Array<{ slug: string }>; children: (slug: string) => React.ReactNode }) => (
    <div data-testid="mock-card-grid">{cards.map((card) => <React.Fragment key={card.slug}>{children(card.slug)}</React.Fragment>)}</div>
  ),
}));

vi.mock("../../../components/portfolio/HoldingsTable", () => ({
  HoldingsTable: holdingsTableMock,
}));

vi.mock("../../../components/dashboard/DashboardHoldingsPreview", () => ({
  DashboardHoldingsPreview: dashboardHoldingsPreviewMock,
}));

vi.mock("../../../components/dashboard/DividendsSection", () => ({
  DividendsSection: () => <div data-testid="mock-dividends-section" />,
}));

vi.mock("../../../features/portfolio/hooks/useHoldingAllocationBasis", () => ({
  useHoldingAllocationBasis: () => ({
    allocationBasis: "market_value",
    setAllocationBasis: vi.fn(),
  }),
}));

vi.mock("../../../features/portfolio/hooks/usePortfolioPageData", () => ({
  usePortfolioPrimaryData: vi.fn(),
}));

vi.mock("../../../features/portfolio/services/portfolioService", async () => {
  const actual = await vi.importActual<typeof import("../../../features/portfolio/services/portfolioService")>("../../../features/portfolio/services/portfolioService");
  return {
    ...actual,
    refreshPortfolioCloses: refreshPortfolioClosesMock,
  };
});

import { useAppShellData } from "../../../components/layout/AppShellDataContext";
import { usePortfolioPrimaryData } from "../../../features/portfolio/hooks/usePortfolioPageData";

const dict = getDictionary("en");
const openQuickActions = vi.fn();

const portfolioData = {
  capabilities: {
    configuredMarkets: ["TW", "US"],
    configuredCurrencies: ["TWD", "USD"],
  },
  holdings: [],
  holdingGroups: [
    {
      ticker: "AAPL",
      marketCode: "US",
      quantity: 10,
      costBasisAmount: 1_000,
      currency: "USD",
      averageCostPerShare: 100,
      currentUnitPrice: 110,
      marketValueAmount: 1_100,
      unrealizedPnlAmount: 100,
      allocationPct: 100,
      change: 1,
      changePercent: 0.91,
      previousClose: 109,
      quoteStatus: "current",
      nextDividendDate: null,
      lastDividendPostedDate: null,
      priceState: testPriceState(),
      accountCount: 1,
      reportingCurrency: "TWD",
      reportingCostBasisAmount: 32_000,
      reportingMarketValueAmount: 35_200,
      reportingUnrealizedPnlAmount: 3_200,
      reportingAllocationPercent: 100,
      fxStatus: "complete",
      allocationBasisUsed: "market_value",
      allocationBasisFallbackReason: null,
      children: [],
    },
  ],
  dividends: { upcoming: [], recent: [] },
  fxRates: [],
  instruments: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  actions: { integrityIssue: null },
};

function portfolioDataWithReportingCurrency(reportingCurrency: AccountDefaultCurrency): PortfolioPageData {
  return {
    ...portfolioData,
    holdingGroups: portfolioData.holdingGroups.map((group) => ({
      ...group,
      reportingCurrency,
      reportingCostBasisAmount: reportingCurrency === "AUD" ? 1_500 : group.reportingCostBasisAmount,
      reportingMarketValueAmount: reportingCurrency === "AUD" ? 1_650 : group.reportingMarketValueAmount,
      reportingUnrealizedPnlAmount: reportingCurrency === "AUD" ? 150 : group.reportingUnrealizedPnlAmount,
    })),
    integrityIssue: null,
  } as PortfolioPageData;
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("PortfolioClient", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  beforeEach(() => {
    openQuickActions.mockReset();
    holdingsTableMock.mockClear();
    dashboardHoldingsPreviewMock.mockClear();
    refreshPortfolioClosesMock.mockClear();
    vi.mocked(useAppShellData).mockReturnValue({
      uiDict: dict,
      locale: "en",
      sessionUserId: "user-1",
      isSharedContext: false,
      mutations: { recomputingSymbols: new Set() },
      contextRefreshSignal: 0,
      canUseGlobalQuickActions: true,
      openQuickActions,
      reportingCurrency: "TWD",
    } as never);
    vi.mocked(usePortfolioPrimaryData).mockReturnValue({
      data: portfolioData,
      isBootstrapping: false,
      isRefreshing: false,
      restoredFromCache: false,
      restoredAt: null,
      refresh: portfolioRefreshMock,
      refreshPrices: portfolioRefreshPricesMock,
    } as never);

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) {
      act(() => root?.unmount());
    }
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows reporting currency from shell preferences and opens global Quick Actions", () => {
    act(() => {
      root!.render(<PortfolioClient />);
    });

    expect(vi.mocked(usePortfolioPrimaryData).mock.calls[0]?.[1]).toBe(
      buildRouteDtoCacheKey("portfolio-primary", getRouteDtoContextScope("user-1"), "en", "TWD"),
    );
    expect(container.textContent).toContain("Change reporting currency: TWD");
    expect(container.textContent).toContain("NT$32,000");

    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Quick actions"),
    );
    expect(button).toBeTruthy();
    act(() => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(openQuickActions).toHaveBeenCalledTimes(1);
  });

  it("offers a separate refresh prices action that only refreshes enrichment data", () => {
    act(() => {
      root!.render(<PortfolioClient />);
    });

    const button = container.querySelector("[data-testid='portfolio-refresh-prices-button']");
    expect(button).not.toBeNull();

    act(() => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(portfolioRefreshPricesMock).toHaveBeenCalledTimes(1);
    expect(portfolioRefreshMock).not.toHaveBeenCalled();
    expect(refreshPortfolioClosesMock).not.toHaveBeenCalled();
  });

  it("keys portfolio cache by the shell reporting currency when server seed matches", () => {
    const audPortfolioData = portfolioDataWithReportingCurrency("AUD");
    vi.mocked(useAppShellData).mockReturnValue({
      uiDict: dict,
      locale: "en",
      sessionUserId: "user-1",
      isSharedContext: false,
      mutations: { recomputingSymbols: new Set() },
      contextRefreshSignal: 0,
      canUseGlobalQuickActions: true,
      openQuickActions,
      reportingCurrency: "AUD",
    } as never);
    vi.mocked(usePortfolioPrimaryData).mockReturnValue({
      data: audPortfolioData,
      isBootstrapping: false,
      isRefreshing: false,
      restoredFromCache: false,
      restoredAt: null,
      refresh: portfolioRefreshMock,
      refreshPrices: portfolioRefreshPricesMock,
    } as never);

    act(() => {
      root!.render(<PortfolioClient initialPrimaryData={audPortfolioData} />);
    });

    expect(vi.mocked(usePortfolioPrimaryData).mock.calls[0]?.[1]).toBe(
      buildRouteDtoCacheKey("portfolio-primary", getRouteDtoContextScope("user-1"), "en", "AUD"),
    );
    expect(container.textContent).toContain("Change reporting currency: AUD");
    expect(container.textContent).toContain("A$1,500");
  });

  it("keeps portfolio cache key aligned to live shell currency when server seed is stale", () => {
    const audPortfolioData = portfolioDataWithReportingCurrency("AUD");
    vi.mocked(useAppShellData).mockReturnValue({
      uiDict: dict,
      locale: "en",
      sessionUserId: "user-1",
      isSharedContext: false,
      mutations: { recomputingSymbols: new Set() },
      contextRefreshSignal: 1,
      canUseGlobalQuickActions: true,
      openQuickActions,
      reportingCurrency: "USD",
    } as never);
    vi.mocked(usePortfolioPrimaryData).mockReturnValue({
      data: audPortfolioData,
      isBootstrapping: false,
      isRefreshing: false,
      restoredFromCache: false,
      restoredAt: null,
      refresh: portfolioRefreshMock,
      refreshPrices: portfolioRefreshPricesMock,
    } as never);

    act(() => {
      root!.render(<PortfolioClient initialPrimaryData={audPortfolioData} />);
    });

    expect(vi.mocked(usePortfolioPrimaryData).mock.calls[0]?.[1]).toBe(
      buildRouteDtoCacheKey("portfolio-primary", getRouteDtoContextScope("user-1"), "en", "USD"),
    );
    expect(container.textContent).toContain("Change reporting currency: AUD");
  });

  it("falls back to the shell reporting currency when portfolio data has no currency-bearing rows", () => {
    const emptyPortfolioData = {
      ...portfolioData,
      holdingGroups: [],
      fxRates: [],
      integrityIssue: null,
    } as PortfolioPageData;
    vi.mocked(useAppShellData).mockReturnValue({
      uiDict: dict,
      locale: "en",
      sessionUserId: "user-1",
      isSharedContext: false,
      mutations: { recomputingSymbols: new Set() },
      contextRefreshSignal: 0,
      canUseGlobalQuickActions: true,
      openQuickActions,
      reportingCurrency: "USD",
    } as never);
    vi.mocked(usePortfolioPrimaryData).mockReturnValue({
      data: emptyPortfolioData,
      isBootstrapping: false,
      isRefreshing: false,
      restoredFromCache: false,
      restoredAt: null,
      refresh: portfolioRefreshMock,
      refreshPrices: portfolioRefreshPricesMock,
    } as never);

    act(() => {
      root!.render(<PortfolioClient initialPrimaryData={emptyPortfolioData} />);
    });

    expect(vi.mocked(usePortfolioPrimaryData).mock.calls[0]?.[1]).toBe(
      buildRouteDtoCacheKey("portfolio-primary", getRouteDtoContextScope("user-1"), "en", "USD"),
    );
    expect(container.textContent).toContain("Change reporting currency: USD");
  });

  it("uses portfolio holdings by default and can switch to dashboard top holdings", () => {
    act(() => {
      root!.render(<PortfolioClient />);
    });

    expect(container.textContent).toContain("Table style");
    expect(container.textContent).toContain("Dashboard Top Holdings");
    expect(container.textContent).toContain("Portfolio Holdings");
    expect(container.textContent).not.toContain("Compact holdings");
    expect(container.textContent).not.toContain("Detailed holdings");
    const styleShell = container.querySelector('[data-testid="portfolio-holdings-style-shell"]');
    expect(styleShell?.className).not.toContain("overflow-hidden");
    expect(styleShell?.className).toContain("pl-2");
    expect(styleShell?.className).toContain("grid-cols-[minmax(0,1fr)]");
    expect(styleShell?.querySelector("div")?.className).toContain("w-full");
    expect(holdingsTableMock).toHaveBeenCalledTimes(1);
    expect(holdingsTableMock.mock.calls[0]?.[0]).not.toHaveProperty("variant");
    expect(dashboardHoldingsPreviewMock).not.toHaveBeenCalled();

    const dashboardButton = container.querySelector('[data-testid="portfolio-holdings-style-dashboard"]');
    expect(dashboardButton).not.toBeNull();
    act(() => {
      dashboardButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(dashboardHoldingsPreviewMock).toHaveBeenCalledTimes(1);
    expect(dashboardHoldingsPreviewMock.mock.calls[0]?.[0]).toMatchObject({
      isRefreshing: false,
      onRefresh: expect.any(Function),
      settingsContextKey: "portfolio.holdings",
    });
  });

  it("polls price enrichment at the admin intraday interval without refreshing primary portfolio data", () => {
    vi.useFakeTimers();
    const openPortfolioData = {
      ...portfolioData,
      settings: {
        userId: "user-1",
        locale: "en",
        costBasisMethod: "WEIGHTED_AVERAGE",
        quotePollIntervalSeconds: 10,
        effectiveTickerPriceIntradayEnabled: true,
        effectiveTickerPriceIntradayRefreshIntervalMinutes: 5,
      },
      holdings: [{
        accountId: "acct-1",
        accountName: "Broker",
        ticker: "2330",
        instrumentName: "Taiwan Semiconductor",
        marketCode: "TW",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
        averageCostPerShare: 100,
        currentUnitPrice: 120,
        marketValueAmount: 1200,
        unrealizedPnlAmount: 200,
        allocationPct: 100,
        change: 1,
        changePercent: 0.84,
        previousClose: 119,
        quoteStatus: "current",
        nextDividendDate: null,
        lastDividendPostedDate: null,
        priceState: testPriceState({
          basis: "intraday",
          chipState: "open_fresh",
          marketState: "open",
          sourceKind: "intraday_yahoo_chart",
          asOfTimestamp: "2026-06-18T02:00:00.000Z",
          quality: null,
        }),
      }],
      integrityIssue: null,
    } as PortfolioPageData;
    vi.mocked(usePortfolioPrimaryData).mockReturnValue({
      data: openPortfolioData,
      isBootstrapping: false,
      isRefreshing: false,
      restoredFromCache: false,
      restoredAt: null,
      refresh: portfolioRefreshMock,
      refreshPrices: portfolioRefreshPricesMock,
    } as never);

    act(() => {
      root!.render(<PortfolioClient />);
    });

    act(() => {
      vi.advanceTimersByTime(299_999);
    });
    expect(portfolioRefreshPricesMock).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(portfolioRefreshPricesMock).toHaveBeenCalledTimes(1);
    expect(portfolioRefreshMock).not.toHaveBeenCalled();
  });

  it("does not poll price enrichment when admin disables intraday freshness", () => {
    vi.useFakeTimers();
    const openPortfolioData = {
      ...portfolioData,
      settings: {
        userId: "user-1",
        locale: "en",
        costBasisMethod: "WEIGHTED_AVERAGE",
        quotePollIntervalSeconds: 10,
        effectiveTickerPriceIntradayEnabled: false,
        effectiveTickerPriceIntradayRefreshIntervalMinutes: 5,
      },
      holdings: [{
        accountId: "acct-1",
        accountName: "Broker",
        ticker: "2330",
        instrumentName: "Taiwan Semiconductor",
        marketCode: "TW",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
        averageCostPerShare: 100,
        currentUnitPrice: 120,
        marketValueAmount: 1200,
        unrealizedPnlAmount: 200,
        allocationPct: 100,
        change: 1,
        changePercent: 0.84,
        previousClose: 119,
        quoteStatus: "current",
        nextDividendDate: null,
        lastDividendPostedDate: null,
        priceState: testPriceState({
          basis: "intraday",
          chipState: "open_fresh",
          marketState: "open",
          sourceKind: "intraday_yahoo_chart",
          asOfTimestamp: "2026-06-18T02:00:00.000Z",
          quality: null,
        }),
      }],
      integrityIssue: null,
    } as PortfolioPageData;
    vi.mocked(usePortfolioPrimaryData).mockReturnValue({
      data: openPortfolioData,
      isBootstrapping: false,
      isRefreshing: false,
      restoredFromCache: false,
      restoredAt: null,
      refresh: portfolioRefreshMock,
      refreshPrices: portfolioRefreshPricesMock,
    } as never);

    act(() => {
      root!.render(<PortfolioClient />);
    });

    act(() => {
      vi.advanceTimersByTime(600_000);
    });

    expect(portfolioRefreshPricesMock).not.toHaveBeenCalled();
    expect(portfolioRefreshMock).not.toHaveBeenCalled();
  });
});
