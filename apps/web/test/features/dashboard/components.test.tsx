import React, { Profiler, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type {
  DashboardPerformanceDto,
  DashboardOverviewHoldingDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { AllocationSnapshotCard } from "../../../components/dashboard/AllocationSnapshotCard";
import { BiggestMoversCard } from "../../../components/dashboard/BiggestMoversCard";
import { DashboardCommandModules } from "../../../components/dashboard/DashboardClient";
import { DashboardHero } from "../../../components/dashboard/DashboardHero";
import { DashboardHoldingsPreview } from "../../../components/dashboard/DashboardHoldingsPreview";
import { PortfolioTrendCard } from "../../../components/dashboard/PortfolioTrendCard";
import { RecentTransactionsCard } from "../../../components/dashboard/RecentTransactionsCard";
import { ReturnPercentCard } from "../../../components/dashboard/ReturnPercentCard";
// Phase 5d — SummarySection deleted; the dashboard hero is now a slim
// 2-metric layout (DashboardHero + BiggestMoversCard). Tile-order behavior
// no longer exists; the obsolete test below is also removed.
import { AddTransactionCard } from "../../../components/portfolio/AddTransactionCard";
import { HoldingsTable } from "../../../components/portfolio/HoldingsTable";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { buildHoldingGroupsFromHoldings } from "../../../features/portfolio/holdingGroups";
import { getDictionary } from "../../../lib/i18n";
import { testPriceState, testPriceStateRollup } from "../../fixtures/priceState";
import {
  createCommitProfilerRecorder,
  recordPerformanceScenario,
} from "../../performance/holdingsSortingPerformanceHarness";

vi.mock("recharts", () => ({
  Cell: () => null,
  Area: () => null,
  Pie: () => null,
  PieChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  ComposedChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Legend: () => null,
  Line: () => null,
  LineChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  ReferenceDot: () => null,
  Tooltip: () => null,
  XAxis: (props: { domain?: unknown; ticks?: unknown }) => (
    <span
      data-testid="mock-xaxis"
      data-domain={JSON.stringify(props.domain ?? null)}
      data-ticks={JSON.stringify(props.ticks ?? null)}
    />
  ),
  YAxis: () => null,
}));

const dict = getDictionary("en");

// Phase 5d — `summary` fixture removed alongside SummarySection deletion.

const holdings: DashboardOverviewHoldingDto[] = [
  {
    accountId: "acc-1",
    accountName: "Main Brokerage",
    ticker: "2330",
    instrumentName: "Taiwan Semiconductor Manufacturing",
    marketCode: "TW",
    quantity: 2_000,
    costBasisAmount: 1_185_472,
    currency: "TWD",
    averageCostPerShare: 593,
    currentUnitPrice: 610,
    marketValueAmount: 1_220_000,
    unrealizedPnlAmount: 34_528,
    allocationPct: 98.2,
    change: 5,
    changePercent: 0.82,
    previousClose: 605,
    quoteStatus: "current",
    nextDividendDate: null,
    lastDividendPostedDate: "2026-02-20",
    priceState: testPriceState(),
  },
];

const transactions: TransactionHistoryItemDto[] = [
  {
    id: "tx-1",
    accountId: "acc-1",
    accountName: "Main Brokerage",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "SELL",
    quantity: 500,
    unitPrice: 650,
    priceCurrency: "TWD",
    tradeDate: "2026-03-12",
    tradeTimestamp: "2026-03-12T01:00:00.000Z",
    bookingSequence: 2,
    commissionAmount: 20,
    taxAmount: 975,
    isDayTrade: false,
    realizedPnlAmount: 12_000,
    realizedPnlCurrency: "TWD",
    feeProfileId: "fp-default",
    feeProfileName: "Default Broker",
    bookedAt: "2026-03-12T08:00:00.000Z",
    feesSource: "CALCULATED",
  } as TransactionHistoryItemDto & { accountName: string },
];

const performance: DashboardPerformanceDto = {
  range: "1M",
  // KZO-180: response-level reporting currency + fxStatus rollup.
  reportingCurrency: "TWD",
  fxStatus: "complete",
  points: [
    {
      date: "2026-03-01",
      totalCostAmount: 1_200_000,
      marketValueAmount: 1_210_000,
      unrealizedPnlAmount: 10_000,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      fxAvailable: true,
    },
    {
      date: "2026-03-13",
      totalCostAmount: 1_200_000,
      marketValueAmount: 1_260_000,
      unrealizedPnlAmount: 60_000,
      cumulativeRealizedPnlAmount: 0,
      cumulativeDividendsAmount: 0,
      fxAvailable: true,
    },
  ],
};

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false;
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => undefined;
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => undefined;
  }
  if (!HTMLElement.prototype.scrollIntoView) {
    HTMLElement.prototype.scrollIntoView = () => undefined;
  }
});

function input(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (!setter) {
    throw new Error("HTMLInputElement.value setter is unavailable");
  }
  act(() => {
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function click(el: Element) {
  act(() => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function pointerDown(el: Element) {
  act(() => {
    const event = new MouseEvent("pointerdown", { bubbles: true, button: 0, cancelable: true, ctrlKey: false });
    Object.defineProperty(event, "pointerId", { value: 1 });
    Object.defineProperty(event, "pointerType", { value: "mouse" });
    el.dispatchEvent(event);
  });
}

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function mockUserPreferencesFetch(preferences: Record<string, unknown> = {}) {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    if (init?.method === "PATCH") {
      return new Response(JSON.stringify({ preferences }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ preferences }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dashboard components", () => {
  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    container?.remove();
    container = null;
    vi.unstubAllGlobals();
  });

  // Phase 5d — "renders summary cards in the requested order" removed.
  // The 7-tile SummarySection was deleted; the new DashboardHero is a
  // slim 2-card layout (total + day Δ). Hero rendering is covered by
  // the new E2E spec in Phase 5f (commit 5f).

  it.runIf(process.env.HOLDINGS_PERF_CAPTURE === "1")("captures the current Dashboard deterministic sort-to-commit baseline", async () => {
    mockUserPreferencesFetch();
    const base = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!base) throw new Error("Expected holding group");
    const fixtureGroups = Array.from({ length: 40 }, (_, index) => ({
      ...base,
      ticker: `D${String(index).padStart(4, "0")}`,
      marketCode: index % 2 === 0 ? "TW" as const : "US" as const,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000 + ((index * 7_919) % 400_000),
      reportingCostBasisAmount: 58_000 + ((index * 3_571) % 350_000),
      reportingUnrealizedPnlAmount: ((index * 1_013) % 90_000) - 45_000,
      reportingDailyChangeAmount: ((index * 71) % 4_000) - 2_000,
      reportingAllocationPercent: ((index * 37) % 1_000) / 10,
      children: base.children.map((child) => ({
        ...child,
        accountId: `${child.accountId}-${index}`,
        ticker: `D${String(index).padStart(4, "0")}`,
      })),
    }));
    const recorder = createCommitProfilerRecorder({
      measuredCount: 10,
      name: "dashboard-current-sort-to-commit",
      warmupCount: 3,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <Profiler id="dashboard-current-sort" onRender={recorder.onRender}>
          <DashboardHoldingsPreview groups={fixtureGroups} locale="en" reportingCurrency="AUD" />
        </Profiler>,
      );
    });
    await flushPromises();

    const presetGroup = container.querySelector('[data-testid="dashboard-holdings-presets"]');
    const buttons = Array.from(presetGroup?.querySelectorAll("button") ?? []);
    const largest = buttons.find((button) => button.textContent?.includes(dict.dashboardHome.topHoldingsPresetLargest));
    const worstPnl = buttons.find((button) => button.textContent?.includes(dict.dashboardHome.topHoldingsPresetWorstPnl));
    if (!largest || !worstPnl) throw new Error("Expected Dashboard focus preset buttons");
    for (let iteration = 0; iteration < 13; iteration += 1) {
      const button = iteration % 2 === 0 ? worstPnl : largest;
      recorder.arm(iteration % 2 === 0 ? "worst-pnl" : "largest");
      click(button);
      recorder.assertCommitted();
    }
    recordPerformanceScenario(recorder.scenario({
      interaction: "alternate existing Worst P&L and Largest focus controls",
      measuredCount: 10,
      renderedDesktopRowCount: 5,
      renderedMobileRowCount: 5,
      sourceRowCount: fixtureGroups.length,
      warmupCount: 3,
    }));
  }, 60_000);

  it("shows reporting currency status and simplified report links", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings })
      .map((group) => ({
        ...group,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD" as const,
          reportingMarketValueAmount: 60_000,
          reportingCostBasisAmount: 58_000,
        })),
      }));

    const html = renderToStaticMarkup(
      <DashboardHero
        fxRates={[{
          fromCurrency: "TWD",
          toCurrency: "AUD",
          rate: 0.049,
          asOf: "2026-06-08",
        }]}
        holdingCount={groups.length}
        marketValues={[{ marketCode: "TW", value: 60_000, reportingCurrency: "AUD" }]}
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 58_000,
          reportingCurrency: "AUD",
          fxStatus: "complete",
          marketValueAmount: 60_000,
          unrealizedPnlAmount: 2_000,
          dailyChangeAmount: 120,
          dailyChangePercent: 0.2,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
          priceStateRollup: testPriceStateRollup({ holdingCount: 1, currentPriceCount: 1 }),
        }}
        locale="en"
        dict={dict}
        canOpenQuickActions
        onOpenQuickActions={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="dashboard-hero-currency"');
    expect(html).toContain("Current report baseline is AUD");
    expect(html).toContain("Change in Quick Actions");
    expect(html).toContain('data-testid="dashboard-hero-total-exact"');
    expect(html).toContain("Exact A$60,000");
    expect(html).toContain('data-testid="dashboard-hero-day-delta-exact"');
    expect(html).toContain("Exact A$120");
    expect(html).toContain('data-testid="dashboard-hero-fx-rates"');
    expect(html).toContain("TWD to AUD");
    expect(html).toContain("0.049");
    expect(html).toContain('data-testid="dashboard-hero-market-strip"');
    expect(html).toContain('href="/reports?tab=market&amp;scope=TW&amp;range=1Y"');
    expect(html).toContain("AUD");
    expect(html).toContain("Exact A$60,000");
  });

  it("keeps a held market visible when its valuation is unavailable", () => {
    const html = renderToStaticMarkup(
      <DashboardHero
        holdingCount={1}
        marketValues={[{ marketCode: "US", value: null, reportingCurrency: "TWD" }]}
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 1_000,
          reportingCurrency: "TWD",
          fxStatus: "missing",
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          dailyChangeAmount: null,
          dailyChangePercent: null,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
          priceStateRollup: testPriceStateRollup({ holdingCount: 1, missingPriceCount: 1 }),
        }}
        locale="en"
        dict={dict}
        canOpenQuickActions
        onOpenQuickActions={() => undefined}
      />,
    );

    expect(html).toContain('data-testid="dashboard-hero-market-US"');
    expect(html).toContain(dict.dashboardHome.noMarketValue);
    expect(html).toContain(dict.reports.viewDataHealth);
  });

  it("shows a read-only quick-actions hint when the dashboard cannot change reporting currency", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings })
      .map((group) => ({
        ...group,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD" as const,
          reportingMarketValueAmount: 60_000,
          reportingCostBasisAmount: 58_000,
        })),
      }));

    const html = renderToStaticMarkup(
      <DashboardHero
        holdingCount={groups.length}
        marketValues={[{ marketCode: "TW", value: 60_000, reportingCurrency: "AUD" }]}
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 58_000,
          reportingCurrency: "AUD",
          fxStatus: "complete",
          marketValueAmount: 60_000,
          unrealizedPnlAmount: 2_000,
          dailyChangeAmount: 120,
          dailyChangePercent: 0.2,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
          priceStateRollup: testPriceStateRollup({ holdingCount: 1, currentPriceCount: 1 }),
        }}
        locale="en"
        dict={dict}
      />,
    );

    expect(html).toContain("Reporting currency is managed from global Quick Actions.");
    expect(html).not.toContain("dashboard-hero-open-quick-actions");
  });

  it("renders dashboard holdings as a compact reporting-currency preview with native price disclosure", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingDailyChangeAmount: 123,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
        reportingDailyChangeAmount: 123,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        fxRates={[{
          fromCurrency: "TWD",
          toCurrency: "AUD",
          rate: 0.049,
          asOf: "2026-06-08",
        }]}
        groups={[reportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain('data-testid="dashboard-holdings-preview"');
    expect(html).toContain('data-testid="dashboard-holdings-fx-rates"');
    expect(html).toContain("FX used for visible holdings");
    expect(html).toContain("Prices and values below are converted to AUD.");
    expect(html).toContain("TWD to AUD");
    expect(html).toContain("0.049");
    expect(html).toContain("1 visible holding");
    expect(html).toContain("Showing 1 of 1 matching holdings.");
    expect(html).not.toContain("grouped position(s)");
    expect(html).toContain("Price (AUD)");
    expect(html).toContain("Market value (AUD)");
    expect(html).toContain('href="/tickers/2330?marketCode=TW"');
    expect(html).toContain("Taiwan Semiconductor Manufacturing");
    expect(html).toContain("A$60,000");
    expect(html).toContain("+A$123");
    expect(html).toContain("lg:hidden");
    expect(html).toContain("lg:block");
    expect(html).not.toContain("A$490");
    expect(html).toContain("A$30.00");
    expect(html).toContain("Native NT$610");
    expect(html).toContain('data-testid="dashboard-mobile-price-state-2330-TW"');
    expect(html).toContain('data-testid="dashboard-price-state-2330-TW"');
    expect(html).toContain("Open Portfolio Report");
    expect(html).not.toContain('data-testid="holdings-table"');
  });

  it("opens the dashboard mobile freshness popover outside the price details button", async () => {
    mockUserPreferencesFetch();
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingDailyChangeAmount: 123,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
        reportingDailyChangeAmount: 123,
      })),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[reportingGroup]}
          locale="en"
          reportingCurrency="AUD"
        />,
      );
    });
    await flushPromises();

    const priceDetailsButton = container.querySelector('[aria-label="Open 2330 price details"]') as HTMLButtonElement | null;
    if (!priceDetailsButton) throw new Error("Expected dashboard mobile price details button");
    expect(priceDetailsButton.parentElement?.closest("button")).toBeNull();

    click(priceDetailsButton);
    await flushPromises();

    expect(document.body.textContent).toContain("Price translation");
    expect(document.body.textContent).not.toContain("Reporting and native price details");

    const chip = container.querySelector('[data-testid="dashboard-mobile-price-state-2330-TW"]') as HTMLButtonElement | null;
    if (!chip) throw new Error("Expected dashboard mobile price-state chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.parentElement?.closest("button")).toBeNull();

    click(chip);
    await flushPromises();

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");
  });

  it("renders holding focus presets and account filter controls", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
        reportingAllocationPercent: 12,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[reportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain('data-testid="dashboard-holdings-account-filter"');
    expect(html).toContain('data-testid="dashboard-holdings-presets"');
    expect(html).toContain('data-testid="dashboard-holdings-preset-settings"');
    expect(html).toContain('aria-label="Market"');
    expect(html).toContain('aria-label="Account"');
    expect(html).toContain('data-testid="dashboard-holdings-mobile-sort-field"');
    expect(html).toContain('aria-label="Sort field"');
    expect(html).toContain("Largest");
    expect(html).toContain("Worst P&amp;L");
    expect(html).toContain("Best P&amp;L");
    expect(html).toContain("FX exposure");
    expect(html).toContain("Stale quotes");
  });

  it("renders dashboard top holdings shell copy in zh-TW", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[group]}
        locale="zh-TW"
        reportingCurrency="TWD"
      />,
    );

    expect(html).toContain("主要持倉");
    expect(html).toContain("報表幣別 TWD");
    expect(html).toContain("市場");
    expect(html).toContain("開啟投資組合報表");
  });

  it("expands holding focus account rows on desktop table", () => {
    mockUserPreferencesFetch();
    const multiAccountHoldings: DashboardOverviewHoldingDto[] = [
      holdings[0]!,
      {
        ...holdings[0]!,
        accountId: "acc-2",
        accountName: "Retirement Brokerage",
        quantity: 500,
        costBasisAmount: 296_368,
        marketValueAmount: 305_000,
        unrealizedPnlAmount: 8_632,
      },
    ];
    const group = buildHoldingGroupsFromHoldings({ holdings: multiAccountHoldings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 75_000,
      reportingCostBasisAmount: 72_500,
      reportingUnrealizedPnlAmount: 2_500,
      reportingDailyChangeAmount: 500,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child, index) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: index === 0 ? 60_000 : 15_000,
        reportingCostBasisAmount: index === 0 ? 58_000 : 14_500,
        reportingUnrealizedPnlAmount: index === 0 ? 2_000 : 500,
        reportingDailyChangeAmount: index === 0 ? 400 : 100,
        reportingAllocationPercent: index === 0 ? 9.6 : 2.4,
      })),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[reportingGroup]}
          locale="en"
          reportingCurrency="AUD"
        />,
      );
    });

    expect(container.querySelector('[data-testid="dashboard-holding-account-row-2330-acc-1"]')).toBeNull();
    const expandButton = container.querySelector('[data-testid="dashboard-holding-expand-2330-TW"]');
    expect(expandButton).not.toBeNull();
    click(expandButton!);

    expect(container.querySelector('[data-testid="dashboard-holding-account-row-2330-acc-1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="dashboard-holding-account-row-2330-acc-2"]')).not.toBeNull();
    expect(container.textContent).toContain("Main Brokerage");
    expect(container.textContent).toContain("Retirement Brokerage");
    expect(container.textContent).toContain("Account holding");
    expect(container.textContent).not.toContain("Account position");
    expect(container.textContent).toContain("Open ticker");
  });

  it("recomputes holding focus group metrics for the selected account filter", async () => {
    mockUserPreferencesFetch();
    const multiAccountHoldings: DashboardOverviewHoldingDto[] = [
      holdings[0]!,
      {
        ...holdings[0]!,
        accountId: "acc-2",
        accountName: "Retirement Brokerage",
        quantity: 500,
        costBasisAmount: 296_368,
        marketValueAmount: 305_000,
        unrealizedPnlAmount: 8_632,
      },
    ];
    const group = buildHoldingGroupsFromHoldings({ holdings: multiAccountHoldings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingCurrentUnitPrice: 30.5,
      reportingMarketValueAmount: 75_000,
      reportingCostBasisAmount: 72_500,
      reportingUnrealizedPnlAmount: 2_500,
      reportingDailyChangeAmount: 500,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child, index) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingCurrentUnitPrice: 30.5,
        reportingMarketValueAmount: index === 0 ? 60_000 : 15_000,
        reportingCostBasisAmount: index === 0 ? 58_000 : 14_500,
        reportingUnrealizedPnlAmount: index === 0 ? 2_000 : 500,
        reportingDailyChangeAmount: index === 0 ? 400 : 100,
        reportingAllocationPercent: index === 0 ? 9.6 : 2.4,
      })),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[reportingGroup]}
          locale="en"
          reportingCurrency="AUD"
        />,
      );
    });
    await flushPromises();

    const accountTrigger = container.querySelector('[data-testid="dashboard-holdings-account-filter"]');
    expect(accountTrigger).not.toBeNull();
    pointerDown(accountTrigger!);
    await flushPromises();

    const retirementOption = [...document.body.querySelectorAll('[role="menuitemcheckbox"]')]
      .find((option) => option.textContent?.includes("Retirement Brokerage"));
    expect(retirementOption).toBeDefined();
    click(retirementOption!);
    await flushPromises();

    expect(accountTrigger?.textContent).toContain("Retirement Brokerage");
    expect(accountTrigger?.textContent).not.toContain("acc-2");
    expect(container.textContent).toContain("Quantity500");
    expect(container.textContent).toContain("Accounts1");
    expect(container.textContent).toContain("A$15,000");
    expect(container.textContent).toContain("+A$500");
    expect(container.textContent).not.toContain("Quantity2,500");
    expect(container.textContent).not.toContain("A$75,000");
    expect(container.textContent).not.toContain("+A$2,500");
  });

  it("does not mix market-value and cost-basis allocation in dashboard holdings", () => {
    const missingQuoteHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      accountId: "acc-2",
      accountName: "US Brokerage",
      ticker: "AAPL",
      marketCode: "US",
      currency: "USD",
      quantity: 10,
      costBasisAmount: 1_000,
      averageCostPerShare: 100,
      currentUnitPrice: null,
      marketValueAmount: null,
      unrealizedPnlAmount: null,
      change: null,
      changePercent: null,
      previousClose: null,
      quoteStatus: "missing",
    };
    const groups = buildHoldingGroupsFromHoldings({ holdings: [holdings[0]!, missingQuoteHolding] })
      .map((group) => ({
        ...group,
        reportingCurrency: "TWD" as const,
        reportingMarketValueAmount: group.ticker === "2330" ? 10_000 : null,
        reportingCostBasisAmount: 10_000,
        reportingUnrealizedPnlAmount: group.ticker === "2330" ? 500 : null,
        reportingAllocationPercent: group.ticker === "2330" ? 100 : 50,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "TWD" as const,
          reportingMarketValueAmount: group.ticker === "2330" ? 10_000 : null,
          reportingCostBasisAmount: 10_000,
          reportingUnrealizedPnlAmount: group.ticker === "2330" ? 500 : null,
          reportingAllocationPercent: group.ticker === "2330" ? 100 : 50,
        })),
      }));

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={groups}
        locale="en"
        reportingCurrency="TWD"
      />,
    );

    expect(html).toContain("Accounts</p><p");
    expect(html).toContain(">1</p>");
    expect(html).toContain("Allocation</p><p");
    expect(html).toContain(">50%</p>");
    expect(html).not.toContain(">100%</p>");
  });

  it("opens holding focus detail sheet with account, cost, and FX sections", () => {
    mockUserPreferencesFetch();
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingCurrentUnitPrice: 30.5,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingCurrentUnitPrice: 30.5,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
        reportingAllocationPercent: 12,
      })),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          fxRates={[{
            fromCurrency: "TWD",
            toCurrency: "AUD",
            rate: 0.049,
            asOf: "2026-06-08",
          }]}
          groups={[reportingGroup]}
          locale="en"
          reportingCurrency="AUD"
        />,
      );
    });

    const detailButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Details");
    expect(detailButton).toBeDefined();
    click(detailButton!);

    expect(document.body.textContent).toContain("Summary");
    expect(document.body.textContent).toContain("Accounts");
    expect(document.body.textContent).toContain("Cost basis / Unrealized P&L");
    expect(document.body.textContent).toContain("FX/Price");
    expect(document.body.textContent).toContain("Cost basis");
    expect(document.body.textContent).toContain("Portfolio allocation");
    expect(document.body.textContent).toContain("Average cost");
    expect(document.body.textContent).toContain("Latest price");
    expect(document.body.textContent).toContain("Ticker page");
    expect(document.body.textContent).not.toContain("FX-Translated Cost");
    expect(document.body.textContent).not.toContain("Market allocation");
  });

  it("hydrates and persists holding focus chip preferences", async () => {
    const fetchMock = mockUserPreferencesFetch({
      dashboardHoldingFocus: {
        presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure", "highest-allocation"],
        hiddenPresets: ["worst-pnl"],
        selectedPreset: "stale-quotes",
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      priceState: testPriceState({ basis: "delayed_intraday", chipState: "open_delayed", marketState: "open" }),
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
        reportingAllocationPercent: 12,
      })),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[reportingGroup]}
          locale="en"
          reportingCurrency="AUD"
        />,
      );
    });
    await flushPromises();

    const presetText = container.querySelector('[data-testid="dashboard-holdings-presets"]')?.textContent ?? "";
    expect(presetText.indexOf("Stale quotes")).toBeLessThan(presetText.indexOf("Largest"));
    expect(presetText).not.toContain("Worst P&L");

    const largestButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Largest");
    expect(largestButton).toBeDefined();
    click(largestButton!);
    await flushPromises();

    const patchCall = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").at(-1);
    expect(patchCall).toBeDefined();
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({
      dashboardHoldingFocus: {
        presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure", "highest-allocation"],
        hiddenPresets: ["worst-pnl"],
        selectedPreset: "largest",
      },
    });
  });

  it("hydrates dashboard holdings column order and width settings", async () => {
    const fetchMock = mockUserPreferencesFetch({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["pnl", "ticker", "position", "avgCost", "price", "unitPnl", "marketValue", "costBasis", "daily", "health", "action"],
            hiddenColumns: [],
            columnWidths: { pnl: 222 },
            layoutStyle: "dashboard",
            rowOrder: ["US:AAPL", "TW:2330"],
            topHoldingsLimit: 8,
          },
        },
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const headers = [...container.querySelectorAll('[data-testid^="dashboard-holdings-column-drag-"]')];
    expect(headers[0]?.getAttribute("data-testid")).toBe("dashboard-holdings-column-drag-unrealizedPnl");
    expect(headers[0]?.getAttribute("draggable")).toBe("true");
    expect((headers[0]?.closest("th") as HTMLTableCellElement | null)?.style.width).toBe("222px");
    expect(container.querySelector('[data-testid="dashboard-holdings-column-resize-unrealizedPnl"]')).not.toBeNull();

    const settingsButton = container.querySelector('[data-testid="holdings-column-settings"]');
    expect(settingsButton).not.toBeNull();
    pointerDown(settingsButton!);
    await flushPromises();

    const moveRight = document.body.querySelector('[data-testid="holdings-column-move-right-unrealizedPnl"]');
    expect(moveRight).not.toBeNull();
    click(moveRight!);
    await flushPromises();

    const reorderedHeaders = [...container.querySelectorAll('[data-testid^="dashboard-holdings-column-drag-"]')];
    expect(reorderedHeaders[0]?.getAttribute("data-testid")).toBe("dashboard-holdings-column-drag-ticker");
    const patchCall = fetchMock.mock.calls.find(([, init]) => {
      if (init?.method !== "PATCH") return false;
      const body = JSON.parse(String(init.body)) as {
        holdingsTableSettings?: { contexts?: Record<string, { columnOrder?: string[] }> };
      };
      return body.holdingsTableSettings?.contexts?.["dashboard.topHoldings"]?.columnOrder?.[0] === "ticker";
    });
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(String(patchCall?.[1]?.body)) as {
      holdingsTableSettings: { contexts: Record<string, { columnOrder: string[]; columnWidths: Record<string, number> }> };
    };
    expect(patchBody.holdingsTableSettings.contexts["dashboard.topHoldings"]?.columnOrder).toEqual(
      [
        "ticker",
        "unrealizedPnl",
        "quantity",
        "accounts",
        "allocation",
        "averageCost",
        "price",
        "unitPnl",
        "marketValue",
        "costBasis",
        "dailyChange",
        "dataHealth",
        "actions",
      ],
    );
    expect(patchBody.holdingsTableSettings.contexts["dashboard.topHoldings"]?.columnWidths.unrealizedPnl).toBe(222);

    const resetButton = document.body.querySelector('[data-testid="holdings-reset-columns"]');
    expect(resetButton).toBeDefined();
    click(resetButton!);
    await flushPromises();

    const resetPatchBody = JSON.parse(String(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").at(-1)?.[1]?.body)) as {
      holdingsTableSettings: { contexts: Record<string, { columnOrder: string[]; rowOrder: string[]; topHoldingsLimit: number }> };
    };
    expect(resetPatchBody.holdingsTableSettings.contexts["dashboard.topHoldings"]).toMatchObject({
      columnOrder: [
        "ticker",
        "quantity",
        "accounts",
        "allocation",
        "averageCost",
        "price",
        "unitPnl",
        "marketValue",
        "costBasis",
        "dailyChange",
        "unrealizedPnl",
        "dataHealth",
        "actions",
      ],
      rowOrder: ["US:AAPL", "TW:2330"],
      topHoldingsLimit: 8,
    });
  });

  it("lists dashboard row settings in the same sorted order as the visible table", async () => {
    mockUserPreferencesFetch();
    const groups = buildHoldingGroupsFromHoldings({
      holdings: [
        {
          ...holdings[0]!,
          accountId: "acc-2",
          accountName: "US Brokerage",
          ticker: "AAPL",
          instrumentName: "Apple Inc.",
          marketCode: "US",
          currency: "USD",
          quantity: 10,
          costBasisAmount: 1_500,
          averageCostPerShare: 150,
          currentUnitPrice: 180,
          marketValueAmount: 1_800,
          unrealizedPnlAmount: 300,
          allocationPct: 1.8,
        },
        holdings[0]!,
      ],
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={groups}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const visibleRows = [...container.querySelectorAll('[data-testid^="dashboard-holding-preview-"]')];
    expect(visibleRows[0]?.getAttribute("data-testid")).toBe("dashboard-holding-preview-2330-TW");

    const settingsButton = container.querySelector('[data-testid="dashboard-holdings-row-settings"]');
    expect(settingsButton).not.toBeNull();
    pointerDown(settingsButton!);
    await flushPromises();

    const rowSettingsRows = [...document.body.querySelectorAll('[data-testid^="dashboard-holdings-row-drag-"]')];
    expect(rowSettingsRows[0]?.getAttribute("data-testid")).toBe("dashboard-holdings-row-drag-TW:2330");
    expect(rowSettingsRows[1]?.getAttribute("data-testid")).toBe("dashboard-holdings-row-drag-US:AAPL");
  });

  it("hydrates legacy dashboard settings and persists row order and top holdings count in the stable context", async () => {
    const fetchMock = mockUserPreferencesFetch({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: [],
            hiddenColumns: [],
            columnWidths: {},
            layoutStyle: "dashboard",
            rowOrder: ["US:AAPL", "TW:2330"],
            topHoldingsLimit: 1,
          },
        },
      },
    });
    const groups = buildHoldingGroupsFromHoldings({
      holdings: [
        holdings[0]!,
        {
          ...holdings[0]!,
          accountId: "acc-2",
          accountName: "US Brokerage",
          ticker: "AAPL",
          instrumentName: "Apple Inc.",
          marketCode: "US",
          currency: "USD",
          quantity: 10,
          costBasisAmount: 1_500,
          averageCostPerShare: 150,
          currentUnitPrice: 180,
          marketValueAmount: 1_800,
          unrealizedPnlAmount: 300,
          allocationPct: 1.8,
        },
      ],
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={groups}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    expect(container.querySelector("[data-testid='dashboard-holding-preview-AAPL-US']")).not.toBeNull();
    expect(container.querySelector("[data-testid='dashboard-holding-preview-2330-TW']")).toBeNull();
    expect(container.textContent).toContain("Cost basis");
    expect(container.textContent).not.toContain("Total Cost");

    const settingsButton = container.querySelector('[data-testid="dashboard-holdings-row-settings"]');
    expect(settingsButton).not.toBeNull();
    pointerDown(settingsButton!);
    await flushPromises();

    const increaseLimit = document.body.querySelector('[data-testid="dashboard-holdings-top-holdings-limit-increase"]');
    expect(increaseLimit).not.toBeNull();
    click(increaseLimit!);
    await flushPromises();

    const moveAaplDown = document.body.querySelector('[data-testid="dashboard-holdings-row-move-down-US:AAPL"]');
    expect(moveAaplDown).not.toBeNull();
    click(moveAaplDown!);
    await flushPromises();

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls.length).toBeGreaterThan(0);
    const patchBody = JSON.parse(String(patchCalls.at(-1)?.[1]?.body)) as {
      holdingsTableSettings: { contexts: Record<string, { rowOrder: string[]; topHoldingsLimit: number }> };
    };
    expect(patchBody.holdingsTableSettings.contexts["dashboard.topHoldings"]).toMatchObject({
      rowOrder: ["TW:2330", "US:AAPL"],
      topHoldingsLimit: 2,
    });
  });

  it("allows dashboard holdings widths to shrink to the shared holdings floor", async () => {
    mockUserPreferencesFetch({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["ticker", "position", "marketValue", "costBasis", "price", "avgCost", "unitPnl", "daily", "pnl", "health", "action"],
            hiddenColumns: [],
            columnWidths: { price: 72 },
            layoutStyle: "dashboard",
          },
        },
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const priceHeader = container
      .querySelector('[data-testid="dashboard-holdings-column-drag-price"]')
      ?.closest("th") as HTMLTableCellElement | null;
    expect(priceHeader?.style.width).toBe("72px");
    expect(priceHeader?.style.minWidth).toBe("72px");
  });

  it("keeps hidden dashboard mobile columns out of card and details content", async () => {
    mockUserPreferencesFetch({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["position", "avgCost", "unitPnl", "daily", "pnl", "ticker", "price", "marketValue", "costBasis", "health", "action"],
            hiddenColumns: ["price", "marketValue", "health"],
            columnWidths: {},
            layoutStyle: "dashboard",
            mobileSummaryCount: 2,
          },
        },
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="USD"
        />,
      );
    });
    await flushPromises();

    const mobileRow = container.querySelector("[data-testid='dashboard-holding-preview-2330-TW']");
    expect(mobileRow).not.toBeNull();
    expect(mobileRow?.textContent).not.toContain("Market value");
    expect(mobileRow?.textContent).not.toContain("Data health");
    expect(mobileRow?.textContent).not.toContain("NT$610");

    const detailsButton = Array.from(mobileRow?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === "Details");
    expect(detailsButton).toBeDefined();
    click(detailsButton!);
    await flushPromises();

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).not.toContain("Market value");
    expect(dialog?.textContent).not.toContain("Data health");
    expect(dialog?.textContent).not.toContain("Reporting price");
  });

  it("keeps native and FX context when dashboard columns move into mobile details", async () => {
    mockUserPreferencesFetch({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["position", "price", "marketValue", "costBasis", "daily", "ticker", "avgCost", "unitPnl", "pnl", "health", "action"],
            hiddenColumns: [],
            columnWidths: {},
            layoutStyle: "dashboard",
            mobileSummaryCount: 1,
          },
        },
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingCurrentUnitPrice: 30.5,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingCurrentUnitPrice: 30.5,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
        reportingAllocationPercent: 12,
      })),
    };

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          fxRates={[{
            fromCurrency: "TWD",
            toCurrency: "AUD",
            rate: 0.049,
            asOf: "2026-06-08",
          }]}
          groups={[reportingGroup]}
          locale="en"
          reportingCurrency="AUD"
        />,
      );
    });
    await flushPromises();

    const mobileRow = container.querySelector("[data-testid='dashboard-holding-preview-2330-TW']");
    const detailsButton = Array.from(mobileRow?.querySelectorAll("button") ?? [])
      .find((button) => button.textContent === "Details");
    expect(detailsButton).toBeDefined();
    click(detailsButton!);
    await flushPromises();

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.textContent).toContain("Reporting price");
    expect(dialog?.textContent).toContain("Native price");
    expect(dialog?.textContent).toContain("FX rate");
    expect(dialog?.textContent).toContain("0.049");
    expect(dialog?.textContent).toContain("Native market value");
    expect(dialog?.textContent).toContain("Daily change %");
  });

  it("patches only the dashboard context when editing before preferences hydrate", async () => {
    const resolvePreferences: Array<(response: Response) => void> = [];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ preferences: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Promise<Response>((resolve) => {
        resolvePreferences.push(resolve);
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const settingsButton = container.querySelector('[data-testid="holdings-column-settings"]');
    expect(settingsButton).not.toBeNull();
    pointerDown(settingsButton!);
    await flushPromises();

    const moveRight = document.body.querySelector('[data-testid="holdings-column-move-right-ticker"]');
    expect(moveRight).not.toBeNull();
    click(moveRight!);
    await flushPromises();

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);

    const preferencesBody = JSON.stringify({
        preferences: {
          holdingsTableSettings: {
            version: 1,
            contexts: {
              "reports.market.topHoldings": {
                columnOrder: ["ticker", "marketValue"],
                hiddenColumns: ["daily"],
                columnWidths: { ticker: 180 },
                layoutStyle: "dashboard",
              },
            },
          },
        },
      });
    act(() => {
      for (const resolve of resolvePreferences) {
        resolve(new Response(preferencesBody, {
          status: 200,
          headers: { "content-type": "application/json" },
        }));
      }
    });
    await flushPromises();
    await flushPromises();

    const patchCall = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH").at(-1);
    expect(patchCall).toBeDefined();
    const patchBody = JSON.parse(String(patchCall?.[1]?.body)) as {
      holdingsTableSettings: { contexts: Record<string, { columnOrder: string[]; hiddenColumns: string[]; columnWidths: Record<string, number> }> };
    };
    expect(patchBody.holdingsTableSettings.contexts["reports.market.topHoldings"]).toBeUndefined();
    expect(patchBody.holdingsTableSettings.contexts["dashboard.topHoldings"]?.columnOrder.slice(0, 2)).toEqual(["quantity", "ticker"]);
  });

  it("does not persist holdings table contexts when preference hydration fails", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response(JSON.stringify({ preferences: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error("preferences unavailable");
    });
    vi.stubGlobal("fetch", fetchMock);
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const settingsButton = container.querySelector('[data-testid="holdings-column-settings"]');
    expect(settingsButton).not.toBeNull();
    pointerDown(settingsButton!);
    await flushPromises();

    const moveRight = document.body.querySelector('[data-testid="holdings-column-move-right-ticker"]');
    expect(moveRight).not.toBeNull();
    click(moveRight!);
    await flushPromises();

    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(0);
  });

  it("selects the next visible chip before hiding the active holding focus preset", async () => {
    const fetchMock = mockUserPreferencesFetch({
      dashboardHoldingFocus: {
        presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure", "highest-allocation"],
        hiddenPresets: ["worst-pnl"],
        selectedPreset: "stale-quotes",
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const settingsButton = container.querySelector('[data-testid="dashboard-holdings-preset-settings"]');
    expect(settingsButton).not.toBeNull();
    click(settingsButton!);
    await flushPromises();

    const staleCheckbox = document.body.querySelector('[aria-label="Show Stale quotes chip"]');
    expect(staleCheckbox).not.toBeNull();
    click(staleCheckbox!);
    await flushPromises();

    const patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(patchCalls.length).toBeGreaterThan(0);
    expect(JSON.parse(String(patchCalls.at(-1)?.[1]?.body))).toEqual({
      dashboardHoldingFocus: {
        presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure", "highest-allocation"],
        hiddenPresets: ["worst-pnl", "stale-quotes"],
        selectedPreset: "largest",
      },
    });
  });

  it("persists holding focus chip reorder and reset actions", async () => {
    const fetchMock = mockUserPreferencesFetch({
      dashboardHoldingFocus: {
        presetOrder: ["stale-quotes", "largest", "worst-pnl", "best-pnl", "fx-exposure", "highest-allocation"],
        hiddenPresets: ["worst-pnl"],
        selectedPreset: "stale-quotes",
      },
    });
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(
        <DashboardHoldingsPreview
          groups={[group]}
          locale="en"
          reportingCurrency="TWD"
        />,
      );
    });
    await flushPromises();

    const settingsButton = container.querySelector('[data-testid="dashboard-holdings-preset-settings"]');
    expect(settingsButton).not.toBeNull();
    click(settingsButton!);
    await flushPromises();

    const moveLargestUp = document.body.querySelector('[data-testid="dashboard-holdings-preset-up-largest"]');
    expect(moveLargestUp).not.toBeNull();
    click(moveLargestUp!);
    await flushPromises();

    let patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCalls.at(-1)?.[1]?.body))).toEqual({
      dashboardHoldingFocus: {
        presetOrder: ["largest", "stale-quotes", "worst-pnl", "best-pnl", "fx-exposure", "highest-allocation"],
        hiddenPresets: ["worst-pnl"],
        selectedPreset: "stale-quotes",
      },
    });

    const resetButton = document.body.querySelector('[data-testid="dashboard-holdings-preset-reset"]');
    expect(resetButton).not.toBeNull();
    click(resetButton!);
    await flushPromises();

    patchCalls = fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH");
    expect(JSON.parse(String(patchCalls.at(-1)?.[1]?.body))).toEqual({
      dashboardHoldingFocus: {
        presetOrder: ["largest", "highest-allocation", "worst-pnl", "best-pnl", "fx-exposure", "stale-quotes"],
        hiddenPresets: [],
        selectedPreset: "largest",
      },
    });
  });

  it("prefers explicit server-provided reporting unit prices in dashboard holdings preview", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      reportingCurrentUnitPrice: 30.5,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[reportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain("A$30.50");
    expect(html).not.toContain("A$30.00");
  });

  it("does not relabel stale reporting unit prices from a different currency", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const staleReportingGroup = {
      ...group,
      reportingCurrency: "USD" as const,
      reportingCurrentUnitPrice: 30.5,
      reportingMarketValueAmount: 60_000,
      reportingCostBasisAmount: 58_000,
      reportingUnrealizedPnlAmount: 2_000,
      reportingAllocationPercent: 12,
      fxStatus: "complete" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "USD" as const,
        reportingMarketValueAmount: 60_000,
        reportingCostBasisAmount: 58_000,
        reportingUnrealizedPnlAmount: 2_000,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[staleReportingGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).not.toContain("A$30.50");
    expect(html).not.toContain("A$30.00");
  });

  it("does not render native market values as selected reporting-currency holdings values", () => {
    const group = buildHoldingGroupsFromHoldings({ holdings })[0];
    if (!group) throw new Error("Expected holding group");
    const untranslatedGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingCurrentUnitPrice: null,
      reportingMarketValueAmount: null,
      reportingCostBasisAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingAllocationPercent: null,
      fxStatus: "missing" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "AUD" as const,
        reportingCurrentUnitPrice: null,
        reportingMarketValueAmount: null,
        reportingCostBasisAmount: null,
        reportingUnrealizedPnlAmount: null,
        reportingAllocationPercent: null,
        fxStatus: "missing" as const,
      })),
    };

    const html = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={[untranslatedGroup]}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(html).toContain("Missing");
    expect(html).not.toContain("AUD 1.22M");
    expect(html).not.toContain("A$1.22M");
    expect(html).not.toContain("A$610.00");
  });

  it("does not label native holding values as reporting-currency market values", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings })
      .map((group) => ({
        ...group,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: null,
        reportingCostBasisAmount: null,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD" as const,
          reportingMarketValueAmount: null,
          reportingCostBasisAmount: null,
        })),
      }));

    const html = renderToStaticMarkup(
      <DashboardHero
        holdingCount={groups.length}
        marketValues={[]}
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 0,
          reportingCurrency: "AUD",
          fxStatus: "missing",
          marketValueAmount: null,
          unrealizedPnlAmount: null,
          dailyChangeAmount: null,
          dailyChangePercent: null,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
          priceStateRollup: testPriceStateRollup({ holdingCount: 1, missingPriceCount: 1 }),
        }}
        locale="en"
        dict={dict}
      />,
    );

    expect(html).toContain(dict.dashboardHome.noMarketValue);
    expect(html).not.toContain('data-testid="dashboard-hero-market-TW"');
  });

  it("keeps dashboard hero totals strict and explains missing valuations in holdings health", () => {
    const missingQuoteHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      ticker: "AAPL",
      marketCode: "US",
      currency: "USD",
      quantity: 10,
      costBasisAmount: 1_000,
      averageCostPerShare: 100,
      currentUnitPrice: null,
      marketValueAmount: null,
      unrealizedPnlAmount: null,
      change: null,
      changePercent: null,
      previousClose: null,
      quoteStatus: "missing",
    };
    const groups = buildHoldingGroupsFromHoldings({ holdings: [holdings[0]!, missingQuoteHolding] })
      .map((group) => ({
        ...group,
        reportingCurrency: "AUD" as const,
        reportingMarketValueAmount: group.ticker === "2330" ? 60_000 : 1_500,
        reportingCostBasisAmount: group.ticker === "2330" ? 58_000 : 1_200,
        reportingUnrealizedPnlAmount: group.ticker === "2330" ? 2_000 : 300,
        reportingDailyChangeAmount: group.ticker === "2330" ? 120 : 15,
        reportingAllocationPercent: 50,
        fxStatus: group.ticker === "2330" ? "complete" as const : "partial" as const,
        children: group.children.map((child) => ({
          ...child,
          reportingCurrency: "AUD" as const,
          reportingMarketValueAmount: group.ticker === "2330" ? 60_000 : 1_500,
          reportingCostBasisAmount: group.ticker === "2330" ? 58_000 : 1_200,
          reportingUnrealizedPnlAmount: group.ticker === "2330" ? 2_000 : 300,
          reportingDailyChangeAmount: group.ticker === "2330" ? 120 : 15,
          reportingAllocationPercent: 50,
          fxStatus: group.ticker === "2330" ? "complete" as const : "partial" as const,
        })),
      }));

    const heroHtml = renderToStaticMarkup(
      <DashboardHero
        holdingCount={groups.length}
        marketValues={[{ marketCode: "TW", value: 60_000, reportingCurrency: "AUD" }]}
        summary={{
          asOf: "2026-06-08",
          accountCount: 2,
          holdingCount: 2,
          totalCostAmount: 59_200,
          reportingCurrency: "AUD",
          fxStatus: "partial",
          marketValueAmount: null,
          unrealizedPnlAmount: 2_300,
          dailyChangeAmount: null,
          dailyChangePercent: null,
          upcomingDividendCount: 0,
          upcomingDividendAmount: null,
          openIssueCount: 0,
          priceStateRollup: testPriceStateRollup({ holdingCount: 2, currentPriceCount: 1, missingPriceCount: 1 }),
        }}
        locale="en"
        dict={dict}
      />,
    );
    const holdingsHtml = renderToStaticMarkup(
      <DashboardHoldingsPreview
        groups={groups}
        locale="en"
        reportingCurrency="AUD"
      />,
    );

    expect(heroHtml).toContain(dict.dashboardHome.noMarketValue);
    expect(holdingsHtml).toContain('data-testid="dashboard-missing-valuation-alert"');
    expect(holdingsHtml).toContain("Market data needs attention");
    expect(holdingsHtml).toContain("AAPL (US)");
    expect(holdingsHtml).toContain("Data health column below");
  });

  it("renders the priority command modules without duplicating the old intro panel", () => {
    const groups = buildHoldingGroupsFromHoldings({ holdings });
    const html = renderToStaticMarkup(
      <DashboardCommandModules
        dict={dict}
        groups={groups}
        locale="en"
        summary={{
          asOf: "2026-06-08",
          accountCount: 1,
          holdingCount: 1,
          totalCostAmount: 58_000,
          reportingCurrency: "AUD",
          fxStatus: "complete",
          marketValueAmount: 60_000,
          unrealizedPnlAmount: 2_000,
          dailyChangeAmount: 120,
          dailyChangePercent: 0.2,
          upcomingDividendCount: 1,
          upcomingDividendAmount: 12,
          openIssueCount: 0,
          priceStateRollup: testPriceStateRollup({ holdingCount: 1, currentPriceCount: 1 }),
        }}
      />,
    );

    expect(html).toContain('data-testid="dashboard-command-modules"');
    expect(html).toContain('data-testid="dashboard-command-today"');
    expect(html).toContain('data-testid="dashboard-command-market-pulse"');
    expect(html).toContain('data-testid="dashboard-command-portfolio-health"');
    expect(html).toContain('href="/reports?tab=daily-review&amp;scope=all&amp;range=1Y"');
    expect(html).toContain('data-testid="dashboard-unrealized-pnl-analysis-link"');
    expect(html).toContain('href="/analysis/unrealized-pnl?reportingCurrency=AUD"');
    expect(html).not.toContain('data-testid="dashboard-intro"');
  });

  it("renders aggregated holdings with a current-price column and ticker link", () => {
    const html = renderToStaticMarkup(<HoldingsTable holdings={holdings} dict={dict} locale="en" />);

    expect(html).toContain("Price");
    expect(html).toContain("Market value");
    expect(html).toContain("P&amp;L");
    expect(html).toContain("Cost basis");
    expect(html).not.toContain("Total Cost");
    expect(html).toContain("Last Posted");
    expect(html).toContain("href=\"/tickers/2330?marketCode=TW\"");
    expect(html).not.toContain("href=\"/tickers/2330?marketCode=TW&amp;accountId=acc-1\"");
    expect(html).toContain("NT$610");
    expect(html).toContain("NT$1,220,000");
    expect(html).toContain("NT$1,185,472");
  });

  it("renders unavailable daily change without labeling current quotes as missing", () => {
    const currentWithoutPreviousClose: DashboardOverviewHoldingDto[] = [
      {
        ...holdings[0]!,
        change: null,
        changePercent: null,
        previousClose: null,
        quoteStatus: "current",
      },
    ];

    const html = renderToStaticMarkup(
      <HoldingsTable holdings={currentWithoutPreviousClose} dict={dict} locale="en" />,
    );

    expect(html).toContain('data-testid="holding-group-daily-change-2330-TW"');
    expect(html).not.toContain(dict.dashboardHome.quoteStatusMissing);
  });

  it("uses reporting-currency P&L amounts for grouped and child holding rows", () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      accountId: "acc-us",
      accountName: "US Brokerage",
      ticker: "AAPL",
      quantity: 10,
      costBasisAmount: 1_000,
      currency: "USD",
      averageCostPerShare: 100,
      currentUnitPrice: 120,
      marketValueAmount: 1_200,
      unrealizedPnlAmount: 200,
    };
    const group = buildHoldingGroupsFromHoldings({ holdings: [usdHolding] })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "TWD" as const,
      reportingCostBasisAmount: 32_000,
      reportingMarketValueAmount: 38_400,
      reportingUnrealizedPnlAmount: 6_400,
      children: group.children.map((child) => ({
        ...child,
        reportingCurrency: "TWD" as const,
        reportingCostBasisAmount: 32_000,
        reportingMarketValueAmount: 38_400,
        reportingUnrealizedPnlAmount: 6_400,
      })),
    };

    const html = renderToStaticMarkup(
      <HoldingsTable holdings={[usdHolding]} holdingGroups={[reportingGroup]} dict={dict} locale="en" />,
    );

    expect(html).toContain("NT$6,400");
    expect(html).not.toContain("NT$200");
  });

  it("shows the actual amount and Data health reason when allocation falls back to cost basis", () => {
    const missingQuoteHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      currentUnitPrice: null,
      marketValueAmount: null,
      unrealizedPnlAmount: null,
      quoteStatus: "missing",
    };
    const group = buildHoldingGroupsFromHoldings({ holdings: [missingQuoteHolding] })[0];
    if (!group) throw new Error("Expected holding group");
    const fallbackGroup = {
      ...group,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      allocationBasisUsed: "cost_basis" as const,
      allocationBasisFallbackReason: "missing_quote" as const,
      children: group.children.map((child) => ({
        ...child,
        reportingMarketValueAmount: null,
        reportingUnrealizedPnlAmount: null,
        allocationBasisUsed: "cost_basis" as const,
        allocationBasisFallbackReason: "missing_quote" as const,
      })),
    };

    const html = renderToStaticMarkup(
      <HoldingsTable
        holdings={[missingQuoteHolding]}
        holdingGroups={[fallbackGroup]}
        dict={dict}
        locale="en"
        allocationBasis="market_value"
      />,
    );

    expect(html).toContain("Data health");
    expect(html).toContain("Missing quote");
    expect(html).toContain("FX complete");
    expect(html).toContain("Missing quote; allocation uses cost basis");
    expect(html).toContain("Cost basis fallback: NT$1,185,472");
  });

  it("formats biggest mover daily change in native quote currency", () => {
    const usdHolding: DashboardOverviewHoldingDto = {
      ...holdings[0]!,
      ticker: "AAPL",
      currency: "USD",
      currentUnitPrice: 120,
      change: 2.5,
      changePercent: 2.13,
      quoteStatus: "current",
    };
    const group = buildHoldingGroupsFromHoldings({ holdings: [usdHolding] })[0];
    if (!group) throw new Error("Expected holding group");
    const reportingGroup = {
      ...group,
      reportingCurrency: "AUD" as const,
      reportingMarketValueAmount: 3_840,
      reportingUnrealizedPnlAmount: 640,
    };

    const html = renderToStaticMarkup(
      <BiggestMoversCard groups={[reportingGroup]} locale="en" dict={dict} />,
    );

    expect(html).toContain("$2.50");
    expect(html).not.toContain("NT$2.50");
    expect(html).toContain('data-testid="dashboard-mover-analysis-link-AAPL-TW"');
    expect(html).toContain("selection=manualTickers");
    expect(html).toContain("tickerMode=custom");
    expect(html).toContain("tickerIds=TW%3AAAPL");
    expect(html).toContain("view=ticker-detail");
    expect(html).toContain("reportingCurrency=AUD");
  });

  it("aggregates account counts in compact holdings rows", () => {
    const compactHoldings: DashboardOverviewHoldingDto[] = [
      holdings[0]!,
      {
        ...holdings[0]!,
        accountId: "acc-2",
        accountName: "Retirement Brokerage",
        quantity: 500,
        costBasisAmount: 296_368,
        marketValueAmount: 305_000,
        unrealizedPnlAmount: 8_632,
      },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={compactHoldings} dict={dict} locale="en" variant="compact" />,
    );

    expect(html).toContain("Accounts");
    expect(html).toContain("2");
    expect(html).toContain("TWD");
  });

  it("hydrates portfolio holdings column order and widths from backend preferences", async () => {
    mockUserPreferencesFetch({
      holdingsTableSettings: {
        version: 1,
        contexts: {
          "holdings.shared": {
            columnOrder: ["allocation", "ticker", "quantity", "accounts", "avgCost", "unitPnl", "price", "dailyChange", "marketValue", "pnl", "costBasis", "nextDividend", "lastDividend"],
            hiddenColumns: [],
            columnWidths: { allocation: 211 },
            layoutStyle: "portfolio",
          },
        },
      },
    });

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(<HoldingsTable holdings={holdings} dict={dict} locale="en" />);
    });
    await flushPromises();

    const headers = [...container.querySelectorAll('[data-testid^="holdings-column-drag-"]')];
    expect(headers[0]?.getAttribute("data-testid")).toBe("holdings-column-drag-allocation");
    expect(headers[0]?.getAttribute("draggable")).toBe("true");
    expect((headers[0]?.closest("th") as HTMLTableCellElement | null)?.style.width).toBe("211px");
    expect(container.querySelector('[data-testid="holdings-column-resize-allocation"]')).not.toBeNull();
  });

  it("renders delayed price-state chip when showFreshnessBadge=true", () => {
    const stale: DashboardOverviewHoldingDto[] = [
      { ...holdings[0]!, priceState: testPriceState({ basis: "delayed_intraday", chipState: "open_delayed", marketState: "open" }) },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={stale} dict={dict} locale="en" showFreshnessBadge={true} />,
    );

    expect(html).toContain("holdings-price-state-");
    expect(html).toContain("holdings-mobile-price-state-");
    expect(html).toMatch(/bg-warning/);
  });

  it("opens the portfolio mobile freshness popover outside the metric card", async () => {
    mockUserPreferencesFetch();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(<HoldingsTable holdings={holdings} dict={dict} locale="en" showFreshnessBadge={true} />);
    });
    await flushPromises();

    const chip = container.querySelector('[data-testid="holdings-mobile-price-state-2330-TW"]') as HTMLButtonElement | null;
    if (!chip) throw new Error("Expected portfolio mobile price-state chip");
    expect(chip.tagName).toBe("BUTTON");
    expect(chip.parentElement?.closest("button")).toBeNull();

    click(chip);
    await flushPromises();

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");
  });

  it("renders stale price-state chip", () => {
    const stale: DashboardOverviewHoldingDto[] = [
      { ...holdings[0]!, priceState: testPriceState({ basis: "stale_close", chipState: "stale" }) },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={stale} dict={dict} locale="en" showFreshnessBadge={true} />,
    );

    expect(html).toContain("holdings-price-state-");
    expect(html).toMatch(/bg-slate-400/);
  });

  it("does not render price-state chip when showFreshnessBadge=false", () => {
    const stale: DashboardOverviewHoldingDto[] = [
      { ...holdings[0]!, priceState: testPriceState({ basis: "delayed_intraday", chipState: "open_delayed", marketState: "open" }) },
    ];
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={stale} dict={dict} locale="en" showFreshnessBadge={false} />,
    );

    expect(html).not.toContain("holdings-price-state-");
    expect(html).not.toContain("holdings-mobile-price-state-");
  });

  it("renders closed price-state chip for current close data", () => {
    const html = renderToStaticMarkup(
      <HoldingsTable holdings={holdings} dict={dict} locale="en" showFreshnessBadge={true} />,
    );

    expect(html).toContain("holdings-price-state-");
  });

  it("renders performance range controls and chart legend", () => {
    const html = renderToStaticMarkup(
      <PortfolioTrendCard
        data={performance}
        range="1M"
        currency="TWD"
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        onRangeChange={() => undefined}
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );

    expect(html).toContain("Portfolio Trend");
    expect(html).toContain("dashboard-performance-range-1m");
    expect(html).toContain("Market value");
    expect(html).toContain("Cost basis");
  });

  it("keeps the requested trend timeline when snapshot points start later", () => {
    const rangedPerformance: DashboardPerformanceDto = {
      ...performance,
      range: "3M",
      rangeStartDate: "2026-03-10",
      rangeEndDate: "2026-06-10",
      requestedAsOf: "2026-06-10",
      points: [
        {
          ...performance.points[0]!,
          date: "2026-05-29",
          totalReturnPercent: 0.05,
        },
        {
          ...performance.points[1]!,
          date: "2026-06-10",
          totalReturnPercent: 0.08,
        },
      ],
    };

    const trendHtml = renderToStaticMarkup(
      <PortfolioTrendCard
        data={rangedPerformance}
        range="3M"
        currency="TWD"
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        onRangeChange={() => undefined}
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );
    const returnHtml = renderToStaticMarkup(
      <ReturnPercentCard
        data={rangedPerformance}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );
    const expectedDomain = JSON.stringify([Date.parse("2026-03-10T00:00:00.000Z"), Date.parse("2026-06-10T00:00:00.000Z")]);

    expect(trendHtml).toContain(`data-domain="${expectedDomain.replaceAll("\"", "&quot;")}"`);
    expect(returnHtml).toContain(`data-domain="${expectedDomain.replaceAll("\"", "&quot;")}"`);
  });

  it("renders performance as-of and stale-data warnings from server metadata", () => {
    const stalePerformance: DashboardPerformanceDto = {
      ...performance,
      requestedAsOf: "2026-06-08",
      lastReliableDate: "2026-05-29",
      marketDataStaleSince: "2026-05-29",
    };

    const trendHtml = renderToStaticMarkup(
      <PortfolioTrendCard
        data={stalePerformance}
        range="1M"
        currency="TWD"
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        onRangeChange={() => undefined}
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );
    expect(trendHtml).toContain("As of May 29");
    expect(trendHtml).toContain("Market data stale since May 29");
    expect(trendHtml).toContain("Latest available snapshot");
    expect(trendHtml).toContain("Requested Jun 8");
    expect(trendHtml).toContain("dashboard-performance-market-value-meta");
    expect(trendHtml).toContain("dashboard-performance-as-of-tooltip-trigger");
    expect(trendHtml).toContain("text-warning");

    const returnHtml = renderToStaticMarkup(
      <ReturnPercentCard
        data={stalePerformance}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );
    expect(returnHtml).toContain("As of May 29");
    expect(returnHtml).toContain("Market data stale since May 29");
    expect(returnHtml).toContain("dashboard-return-percent-as-of-tooltip-trigger");
    expect(returnHtml).toContain("text-warning");
  });

  it("renders explicit snapshot-gap empty states for missing snapshots and missing FX", () => {
    const missingSnapshotPerformance: DashboardPerformanceDto = {
      ...performance,
      points: [],
      requestedAsOf: "2026-06-10",
      diagnostics: {
        latestSnapshotDate: null,
        latestReliableValuationDate: null,
        expectedLatestValuationDate: "2026-06-10",
        staleSinceDate: null,
        knownGapReasons: ["missing_snapshot"],
      },
    };
    const missingFxPerformance: DashboardPerformanceDto = {
      ...performance,
      points: [
        {
          ...performance.points[0]!,
          marketValueAmount: null,
          totalCostAmount: null,
          totalReturnPercent: null,
          fxAvailable: false,
        },
      ],
      diagnostics: {
        latestSnapshotDate: "2026-03-01",
        latestReliableValuationDate: null,
        expectedLatestValuationDate: "2026-06-10",
        staleSinceDate: null,
        knownGapReasons: ["missing_fx"],
      },
    };

    const trendHtml = renderToStaticMarkup(
      <PortfolioTrendCard
        data={missingSnapshotPerformance}
        range="1M"
        currency="TWD"
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        onRangeChange={() => undefined}
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );
    const returnHtml = renderToStaticMarkup(
      <ReturnPercentCard
        data={missingFxPerformance}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
        timelineMode="auto"
        onTimelineModeChange={() => undefined}
      />,
    );

    expect(trendHtml).toContain("No snapshot-backed series is available for the selected range yet.");
    expect(trendHtml).not.toContain("dashboard-performance-chart");
    expect(returnHtml).toContain("Snapshot-backed series is unavailable because FX conversion is incomplete for one or more points.");
    expect(returnHtml).not.toContain("dashboard-return-percent-chart");
  });

  it("renders allocation snapshot legend and recent transactions card", () => {
    const allocationHtml = renderToStaticMarkup(
      <AllocationSnapshotCard
        groups={buildHoldingGroupsFromHoldings({ holdings })}
        dict={dict}
        locale="en"
        allocationBasis="market_value"
      />,
    );
    expect(allocationHtml).toContain("Allocation Snapshot");
    expect(allocationHtml).toContain("2330");

    const recentTransactionsHtml = renderToStaticMarkup(
      <RecentTransactionsCard
        items={transactions}
        locale="en"
        dict={dict}
        isLoading={false}
        errorMessage=""
      />,
    );
    expect(recentTransactionsHtml).toContain("Recent Transactions");
    expect(recentTransactionsHtml).toContain("href=\"/tickers/2330?marketCode=TW&amp;accountId=acc-1\"");
    expect(recentTransactionsHtml).toContain("Main Brokerage");
  });

  it("renders symbol history empty and populated states", () => {
    const emptyHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={[]} dict={dict} locale="en" />);
    expect(emptyHtml).toContain("No historical transactions were found");

    const populatedHtml = renderToStaticMarkup(<TransactionHistoryTable transactions={transactions} dict={dict} locale="en" />);
    expect(populatedHtml).toContain("Default Broker");
    expect(populatedHtml).toContain("Main Brokerage");
    expect(populatedHtml).toContain("Realized P&amp;L");
    expect(populatedHtml).toContain("SELL");
  });

  it("renders the instrument combobox in the transaction form", () => {
    const html = renderToStaticMarkup(
      <AddTransactionCard
        value={{
          accountId: "acc-1",
          ticker: "0050",
          // KZO-169: TransactionInput now carries marketCode (TW for legacy
          // 0050 fixture). null = "All" mode (chip-derived).
          marketCode: "TW",
          quantity: 1,
          unitPrice: 100,
          priceCurrency: "TWD",
          tradeDate: "2026-03-13",
          type: "BUY",
          isDayTrade: false,
        }}
        accountOptions={[{
          id: "acc-1",
          name: "Primary",
          feeProfileName: "Default Broker",
          // KZO-169: defaultCurrency drives chip default + dropdown filter.
          defaultCurrency: "TWD",
          accountType: "broker",
        }]}
        pending={false}
        onChange={() => undefined}
        onSubmit={async () => undefined}
        dict={dict}
        locale="en"
        framed={false}
        priceHint={null}
        showPriceUnavailableHint={false}
        feeEstimate={null}
      />,
    );

    expect(html).toContain("data-testid=\"tx-ticker-combobox\"");
    expect(html).toContain("placeholder=\"Search by ticker or name...\"");
    expect(html).toContain("value=\"0050\"");
    expect(html).toContain("Primary — Default Broker");
    expect(html).not.toContain("data-testid=\"tx-ticker-select\"");
  });

  it("marks manual unit-price edits only from the unit-price input handler", () => {
    const onChange = vi.fn();
    const onUnitPriceEdited = vi.fn();

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <AddTransactionCard
          value={{
            accountId: "acc-1",
            ticker: "0050",
            // KZO-169: marketCode required field; TWD account ⇒ TW.
            marketCode: "TW",
            quantity: 1,
            unitPrice: 100,
            priceCurrency: "TWD",
            tradeDate: "2026-03-13",
            type: "BUY",
            isDayTrade: false,
          }}
          accountOptions={[{
            id: "acc-1",
            name: "Primary",
            feeProfileName: "Default Broker",
            defaultCurrency: "TWD",
            accountType: "broker",
          }]}
          pending={false}
          onChange={onChange}
          onUnitPriceEdited={onUnitPriceEdited}
          onSubmit={async () => undefined}
          dict={dict}
          locale="en"
          framed={false}
          priceHint={null}
          showPriceUnavailableHint={false}
          feeEstimate={null}
        />,
      );
    });

    const quantityInput = container.querySelector('[data-testid="tx-quantity-input"]') as HTMLInputElement | null;
    const unitPriceInput = container.querySelector('[data-testid="unit-price-input"]') as HTMLInputElement | null;

    expect(quantityInput).not.toBeNull();
    expect(unitPriceInput).not.toBeNull();

    input(quantityInput!, "2");
    expect(onUnitPriceEdited).not.toHaveBeenCalled();

    input(unitPriceInput!, "101");
    expect(onUnitPriceEdited).toHaveBeenCalledTimes(1);
  });
});
