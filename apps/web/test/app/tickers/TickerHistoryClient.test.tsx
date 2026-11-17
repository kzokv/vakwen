import React, { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRoot, type Root } from "react-dom/client";
import type {
  AccountDto,
  AccountDefaultCurrency,
  FeeProfileDto,
  InstrumentCatalogItemDto,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import { canDeleteTickerTransactions, TickerHistoryClient } from "../../../app/tickers/[ticker]/TickerHistoryClient";
import type { TickerDetailsModel } from "../../../features/portfolio/services/tickerDetailsService";
import { getDictionary } from "../../../lib/i18n";
import { testPriceState } from "../../fixtures/priceState";

const appShellDataMocks = vi.hoisted(() => ({
  openQuickActions: vi.fn(),
}));
const breadcrumbMocks = vi.hoisted(() => ({
  set: vi.fn(),
}));
const navigationMocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  replace: vi.fn(),
  searchParams: "",
}));
const rechartsMocks = vi.hoisted(() => ({
  lineChartData: [] as unknown[][],
}));

vi.mock("../../../features/portfolio/services/tickerDetailsService", async () => {
  const actual = await vi.importActual<typeof import("../../../features/portfolio/services/tickerDetailsService")>(
    "../../../features/portfolio/services/tickerDetailsService",
  );
  return {
    ...actual,
    fetchTickerDetailsFullRefresh: vi.fn(),
    fetchTickerDetailsHydration: vi.fn(),
  };
});

vi.mock("../../../components/layout/AppShellDataContext", () => {
  const useAppShellData = () => ({
    canUseGlobalQuickActions: true,
    contextRefreshSignal: 0,
    locale: "en",
    openQuickActions: appShellDataMocks.openQuickActions,
    reportingCurrency: "TWD",
    saveReportingCurrency: async () => undefined,
    isReportingCurrencySaving: false,
    reportingCurrencyError: "",
    sessionUserId: "user-1",
    uiDict: {},
  });
  return { useAppShellData, useOptionalAppShellData: useAppShellData };
});

vi.mock("../../../components/layout/BreadcrumbProvider", () => ({
  useBreadcrumb: (items: unknown) => breadcrumbMocks.set(items),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tickers/2330",
  useRouter: () => ({
    push: navigationMocks.push,
    refresh: navigationMocks.refresh,
    replace: navigationMocks.replace,
  }),
  useSearchParams: () => new URLSearchParams(navigationMocks.searchParams),
}));

import {
  fetchTickerDetailsFullRefresh,
  fetchTickerDetailsHydration,
} from "../../../features/portfolio/services/tickerDetailsService";
import {
  buildRouteDtoCacheKey,
  getRouteDtoContextScope,
  readRouteDtoCache,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

vi.mock("recharts", () => ({
  Bar: () => null,
  BarChart: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Line: () => null,
  LineChart: ({ children, data }: { children?: React.ReactNode; data?: unknown[] }) => {
    rechartsMocks.lineChartData.push(data ?? []);
    return <div>{children}</div>;
  },
  ResponsiveContainer: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

if (typeof globalThis.IntersectionObserver === "undefined") {
  class StubIntersectionObserver {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  }
  Object.assign(globalThis, { IntersectionObserver: StubIntersectionObserver });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function installStorageMocks() {
  const store = new Map<string, string>();
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => { store.clear(); },
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  for (const key of ["localStorage", "sessionStorage"] as const) {
    Object.defineProperty(window, key, { configurable: true, value: storage });
  }
}

function mount(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(element);
  });
  return container;
}

beforeEach(() => {
  installStorageMocks();
  navigationMocks.searchParams = "";
  vi.mocked(fetchTickerDetailsFullRefresh).mockResolvedValue(details);
  vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(details);
  rechartsMocks.lineChartData = [];
});

afterEach(() => {
  if (root) {
    act(() => root!.unmount());
  }
  vi.useRealTimers();
  root = null;
  container?.remove();
  container = null;
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.clearAllMocks();
  appShellDataMocks.openQuickActions.mockReset();
  breadcrumbMocks.set.mockReset();
  navigationMocks.searchParams = "";
});

const dict = getDictionary("en");

const accounts: AccountDto[] = [
  {
    id: "acc-1",
    userId: "user-1",
    name: "Main Brokerage",
    feeProfileId: "fp-1",
    defaultCurrency: "TWD",
    accountType: "broker",
  },
  {
    id: "acc-2",
    userId: "user-1",
    name: "Scope Brokerage",
    feeProfileId: "fp-2",
    defaultCurrency: "TWD",
    accountType: "broker",
  },
];

const feeProfiles: FeeProfileDto[] = accounts.map((account) => ({
  id: account.feeProfileId,
  accountId: account.id,
  name: `${account.name} Default`,
  boardCommissionRate: 0,
  commissionDiscountPercent: 0,
  minimumCommissionAmount: 0,
  commissionCurrency: account.defaultCurrency,
  commissionRoundingMode: "FLOOR",
  taxRoundingMode: "FLOOR",
  stockSellTaxRateBps: 0,
  stockDayTradeTaxRateBps: 0,
  etfSellTaxRateBps: 0,
  bondEtfSellTaxRateBps: 0,
  commissionChargeMode: "CHARGED_UPFRONT",
}));

const transactions: TransactionHistoryItemDto[] = [
  {
    id: "tx-1",
    accountId: "acc-2",
    accountName: "Scope Brokerage",
    ticker: "2330",
    marketCode: "TW",
    instrumentType: "STOCK",
    type: "BUY",
    quantity: 10,
    unitPrice: 100,
    priceCurrency: "TWD",
    tradeDate: "2026-01-02",
    tradeTimestamp: "2026-01-02T00:00:00.000Z",
    bookingSequence: 1,
    commissionAmount: 0,
    taxAmount: 0,
    isDayTrade: false,
    realizedPnlAmount: null,
    realizedPnlCurrency: null,
    feeProfileId: "fp-2",
    feeProfileName: "Scope Brokerage Default",
    bookedAt: "2026-01-02T00:00:00.000Z",
    feesSource: "CALCULATED",
  },
];

const details: TickerDetailsModel = {
  identity: {
    ticker: "2330",
    name: "TSMC",
    marketCode: "TW",
    instrumentType: "STOCK",
    currency: "TWD",
  },
  quote: {
    currentPrice: 110,
    previousClose: 109,
    changeAmount: 1,
    changePercent: 0.92,
    quoteStatus: "current",
    priceState: testPriceState(),
  },
  position: {
    accountScope: "acc-2",
    quantity: 10,
    averageCost: 100,
    costBasis: 1000,
    marketValue: 1100,
    unrealizedPnl: 100,
    realizedPnl: 0,
    transactionsCount: 1,
    nextDividendDate: null,
    lastDividendPostedDate: null,
  },
  chart: {
    range: "1Y",
    metadata: {
      requested: { range: "1Y", startDate: null, endDate: null },
      resolved: { range: "1Y", startDate: null, endDate: null },
      available: { startDate: null, endDate: null },
      truncated: { startDate: false, endDate: false },
    },
    points: [],
  },
  unrealizedPnlHistory: [],
  holdingGroup: {
    ticker: "2330",
    marketCode: "TW",
    quantity: 10,
    costBasisAmount: 1000,
    currency: "TWD",
    averageCostPerShare: 100,
    currentUnitPrice: 110,
    marketValueAmount: 1100,
    unrealizedPnlAmount: 100,
    allocationPct: 100,
    change: 1,
    changePercent: 0.92,
    previousClose: 109,
    quoteStatus: "current",
    nextDividendDate: null,
    lastDividendPostedDate: null,
    priceState: testPriceState(),
    accountCount: 1,
    reportingCurrency: "TWD",
    reportingCostBasisAmount: 1000,
    reportingMarketValueAmount: 1100,
    reportingUnrealizedPnlAmount: 100,
    reportingAllocationPercent: 32.5,
    reportingMarketAllocationPercent: 32.5,
    fxStatus: "complete",
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
    children: [],
  },
  accountBreakdown: [{
    accountId: "acc-2",
    accountName: "Scope Brokerage",
    ticker: "2330",
    marketCode: "TW",
    quantity: 10,
    costBasisAmount: 1000,
    currency: "TWD",
    averageCostPerShare: 100,
    currentUnitPrice: 110,
    marketValueAmount: 1100,
    unrealizedPnlAmount: 100,
    allocationPct: 100,
    change: 1,
    changePercent: 0.92,
    previousClose: 109,
    quoteStatus: "current",
    nextDividendDate: null,
    lastDividendPostedDate: null,
    priceState: testPriceState(),
    reportingCurrency: "TWD",
    reportingCostBasisAmount: 1000,
    reportingMarketValueAmount: 1100,
    reportingUnrealizedPnlAmount: 100,
    reportingAllocationPercent: 100,
    reportingMarketAllocationPercent: 32.5,
    fxStatus: "complete",
    allocationBasisUsed: "market_value",
    allocationBasisFallbackReason: null,
  }],
  stats: [],
  dividends: {
    upcomingCount: 0,
    nextPaymentDate: null,
    lastPostedDate: null,
    openReconciliationCount: 0,
    upcoming: [],
    recent: [],
  },
  fundamentals: { panels: [] },
};

function tickerCacheKey(
  reportingCurrency: AccountDefaultCurrency = "TWD",
  provisionalScope = "default-provisional",
) {
  return buildRouteDtoCacheKey(
    "ticker-details",
    getRouteDtoContextScope("user-1"),
    "en",
    "2330",
    "TW",
    "acc-2",
    "",
    "1Y",
    "",
    "",
    reportingCurrency,
    provisionalScope,
  );
}

const tickerInstrument: InstrumentCatalogItemDto = {
  ticker: "2330",
  name: "TSMC",
  instrumentType: "STOCK",
  sector: null,
  marketCode: "TW",
  barsBackfillStatus: "complete",
  lastRepairAt: null,
  repairAvailableAt: null,
  gicsIndustryGroup: null,
};

function tickerHistoryClientElement(
  initialDetails: TickerDetailsModel = details,
  instrument: InstrumentCatalogItemDto | null = tickerInstrument,
  initialChartQuery?: {
    chartEnd?: string;
    chartRange?: string;
    chartStart?: string;
  },
  clientProps: Partial<React.ComponentProps<typeof TickerHistoryClient>> = {},
): React.ReactElement {
  return (
    <TickerHistoryClient
      transactions={transactions}
      dict={dict}
      locale="en"
      ticker="2330"
      accounts={accounts}
      feeProfiles={feeProfiles}
      feeProfileBindings={[]}
      instrument={instrument}
      details={initialDetails}
      isDemo={false}
      transactionAccountFilter="acc-2"
      transactionMarketFilter="TW"
      initialChartQuery={initialChartQuery}
      initialTradeDate="2026-06-12"
      {...clientProps}
    />
  );
}

function renderTickerHistoryClient(
  initialDetails: TickerDetailsModel = details,
  instrument: InstrumentCatalogItemDto | null = tickerInstrument,
  initialChartQuery?: {
    chartEnd?: string;
    chartRange?: string;
    chartStart?: string;
  },
  clientProps: Partial<React.ComponentProps<typeof TickerHistoryClient>> = {},
) {
  return mount(tickerHistoryClientElement(initialDetails, instrument, initialChartQuery, clientProps));
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createPointerEvent(type: string, pointerType: "mouse" | "touch"): Event {
  const event = new Event(type, { bubbles: true });
  Object.defineProperty(event, "pointerType", { value: pointerType });
  return event;
}

function findButtonByText(element: HTMLElement, text: string): HTMLButtonElement {
  const button = Array.from(element.querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === text);
  if (!button) throw new Error(`Button not found: ${text}`);
  return button as HTMLButtonElement;
}

function makeAnalysisChartDetails(overrides: Partial<TickerDetailsModel> = {}): TickerDetailsModel {
  return {
    ...details,
    chart: {
      range: "1Y",
      metadata: {
        requested: { range: null, startDate: "2026-04-10", endDate: "2026-06-26" },
        resolved: { range: "1Y", startDate: "2026-04-10", endDate: "2026-06-26" },
        available: { startDate: "2026-04-10", endDate: "2026-06-26" },
        truncated: { startDate: false, endDate: false },
      },
      points: [
        { date: "2026-04-10", label: "2026-04-10", price: 100, averageCost: 95, quantity: 10 },
        { date: "2026-06-26", label: "2026-06-26", price: 120, averageCost: 95, quantity: 10 },
      ],
    },
    unrealizedPnlHistory: [
      { date: "2026-04-10", label: "2026-04-10", unrealizedPnl: 50, currency: "TWD", quantity: 10 },
      { date: "2026-06-26", label: "2026-06-26", unrealizedPnl: 250, currency: "TWD", quantity: 10 },
    ],
    ...overrides,
  };
}

async function changeInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function testAccount(id: string, name: string, defaultCurrency: AccountDefaultCurrency): AccountDto {
  return {
    id,
    userId: "user-1",
    name,
    feeProfileId: `fp-${id}`,
    defaultCurrency,
    accountType: "broker",
  };
}

function feeProfilesFor(testAccounts: AccountDto[]): FeeProfileDto[] {
  return testAccounts.map((account) => ({
    id: account.feeProfileId,
    accountId: account.id,
    name: `${account.name} Default`,
    boardCommissionRate: 0,
    commissionDiscountPercent: 0,
    minimumCommissionAmount: 0,
    commissionCurrency: account.defaultCurrency,
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 0,
    stockDayTradeTaxRateBps: 0,
    etfSellTaxRateBps: 0,
    bondEtfSellTaxRateBps: 0,
    commissionChargeMode: "CHARGED_UPFRONT",
  }));
}

describe("TickerHistoryClient", () => {
  it("requires both delegated write permissions for transaction deletion", () => {
    expect(canDeleteTickerTransactions(true, {
      canWriteTransactions: true,
      canWriteDividends: false,
    })).toBe(false);
    expect(canDeleteTickerTransactions(true, {
      canWriteTransactions: true,
      canWriteDividends: true,
    })).toBe(true);
    expect(canDeleteTickerTransactions(false, {
      canWriteTransactions: false,
      canWriteDividends: false,
    })).toBe(true);
  });

  it("does not render the duplicated position summary strip above the tabs", () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(details);
    const element = renderTickerHistoryClient();

    expect(element.querySelector('[data-testid="ticker-stats-bar"]')).toBeNull();
    expect(element.querySelector('[data-testid="ticker-history-quantity"]')).toBeNull();
  });

  it("scopes the repair action copy to ticker data", () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    const element = renderTickerHistoryClient();

    const repairButton = element.querySelector('[data-testid="repair-button"]');
    expect(repairButton?.textContent).toContain("Repair ticker data");
    expect(repairButton?.getAttribute("title")).toBe("Ticker repair is on cooldown");
  });

  it("renders repair timestamps with a client-local timezone after mount", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    const element = renderTickerHistoryClient(details, {
      ...tickerInstrument,
      lastRepairAt: "2026-06-09T10:10:00.000Z",
    });
    await flushEffects();

    const expectedLocalTime = new Intl.DateTimeFormat("en", {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date("2026-06-09T10:10:00.000Z"));
    const repairStatus = element.querySelector('[data-testid="repair-status-badge"]');
    expect(repairStatus?.textContent).toContain(`Last repaired: ${expectedLocalTime}`);
  });

  it("renders localized quote status badges instead of raw enum values", () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(details);
    const element = renderTickerHistoryClient({
      ...details,
      quote: {
        ...details.quote,
        quoteStatus: "provisional",
        priceState: testPriceState({ basis: "delayed_intraday", chipState: "open_delayed", marketState: "open" }),
      },
    });

    expect(element.textContent).toContain("Provisional");
    expect(element.textContent).toContain("Delayed");
  });

  it("opens ticker price-state details from the header chip on hover", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(details);
    const element = renderTickerHistoryClient({
      ...details,
      quote: {
        ...details.quote,
        priceState: testPriceState({ basis: "today_close", chipState: "closed", marketState: "closed" }),
      },
    });
    const chip = element.querySelector('[data-testid="ticker-price-state-chip"]') as HTMLButtonElement | null;
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.textContent).toContain("Closed");

    await act(async () => {
      chip?.dispatchEvent(createPointerEvent("pointerover", "mouse"));
    });

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");
  });

  it("opens ticker price-state details from the header chip on click", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(details);
    const element = renderTickerHistoryClient({
      ...details,
      quote: {
        ...details.quote,
        priceState: testPriceState({ basis: "today_close", chipState: "closed", marketState: "closed" }),
      },
    });
    const chip = element.querySelector('[data-testid="ticker-price-state-chip"]') as HTMLButtonElement | null;
    expect(chip?.tagName).toBe("BUTTON");
    expect(chip?.textContent).toContain("Closed");

    await act(async () => {
      chip?.click();
    });

    expect(document.body.textContent).toContain("Basis: Today close");
    expect(document.body.textContent).toContain("Market: Closed");
  });

  it("restores cached ticker details before the silent refresh completes", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    writeRouteDtoCache<TickerDetailsModel>(tickerCacheKey(), {
      ...details,
      position: {
        ...details.position,
        marketValue: 2200,
      },
    });

    const element = renderTickerHistoryClient({
      ...details,
      position: {
        ...details.position,
        marketValue: null,
      },
    });
    await flushEffects();

    const marketValueCard = element.querySelector('[data-testid="ticker-history-market-value"]');
    expect(marketValueCard?.textContent).toContain("NT$2,200");
  });

  it("does not restore provisional-included cache for analysis final-only links", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis&includeProvisional=false";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    writeRouteDtoCache<TickerDetailsModel>(tickerCacheKey("TWD", "analysis-provisional:include"), {
      ...details,
      position: {
        ...details.position,
        marketValue: 2200,
      },
    });

    const element = renderTickerHistoryClient({
      ...details,
      position: {
        ...details.position,
        marketValue: null,
      },
    });
    await flushEffects();

    const marketValueCard = element.querySelector('[data-testid="ticker-history-market-value"]');
    expect(marketValueCard?.textContent).not.toContain("NT$2,200");
  });

  it("ignores cached ticker details with a different reporting currency", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    writeRouteDtoCache<TickerDetailsModel>(tickerCacheKey(), {
      ...details,
      holdingGroup: {
        ...details.holdingGroup!,
        reportingCurrency: "USD",
        reportingMarketValueAmount: 2200,
      },
      accountBreakdown: [{
        ...details.accountBreakdown[0]!,
        reportingCurrency: "USD",
        reportingMarketValueAmount: 2200,
      }],
      position: {
        ...details.position,
        marketValue: 2200,
      },
    });

    const element = renderTickerHistoryClient({
      ...details,
      position: {
        ...details.position,
        marketValue: null,
      },
    });
    await flushEffects();

    const marketValueCard = element.querySelector('[data-testid="ticker-history-market-value"]');
    expect(marketValueCard?.textContent).not.toContain("NT$2,200");
  });

  it("uses cached ticker details as the silent refresh fallback", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    writeRouteDtoCache<TickerDetailsModel>(tickerCacheKey(), {
      ...details,
      position: {
        ...details.position,
        marketValue: 2200,
      },
    });

    renderTickerHistoryClient({
      ...details,
      position: {
        ...details.position,
        marketValue: null,
      },
    });
    await flushEffects();
    await flushEffects();

    expect(fetchTickerDetailsHydration).toHaveBeenCalledWith(expect.objectContaining({
      primaryDetails: expect.objectContaining({
        position: expect.objectContaining({ marketValue: 2200 }),
      }),
    }));
    const cached = readRouteDtoCache<TickerDetailsModel>(tickerCacheKey());
    expect(cached?.payload.position.marketValue).toBe(2200);
  });

  it("writes refreshed ticker details to the route DTO cache", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue({
      ...details,
      position: {
        ...details.position,
        marketValue: 3300,
      },
    });

    renderTickerHistoryClient();
    await flushEffects();
    await flushEffects();

    const cached = readRouteDtoCache<TickerDetailsModel>(tickerCacheKey());
    expect(cached?.payload.position.marketValue).toBe(3300);
  });

  it("uses a full details refresh for open-market quote polling", async () => {
    const openDetails: TickerDetailsModel = {
      ...details,
      quote: {
        ...details.quote,
        priceState: testPriceState({
          basis: "delayed_intraday",
          chipState: "open_delayed",
          marketState: "open",
        }),
      },
    };
    vi.mocked(fetchTickerDetailsFullRefresh).mockResolvedValue(openDetails);
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(openDetails);

    renderTickerHistoryClient(openDetails);
    await flushEffects();
    await flushEffects();

    expect(fetchTickerDetailsFullRefresh).toHaveBeenCalledWith(expect.objectContaining({
      ticker: "2330",
      marketCode: "TW",
      primaryDetails: expect.objectContaining({
        quote: expect.objectContaining({
          priceState: expect.objectContaining({ marketState: "open" }),
        }),
      }),
    }));
    expect(fetchTickerDetailsHydration).not.toHaveBeenCalled();
  });

  it("refreshes ticker price state from full details at the admin intraday interval", async () => {
    vi.useFakeTimers();
    const openDetails: TickerDetailsModel = {
      ...details,
      quote: {
        ...details.quote,
        currentPrice: 110,
        priceState: testPriceState({
          basis: "delayed_intraday",
          chipState: "open_delayed",
          marketState: "open",
          asOfTimestamp: "2026-06-18T03:49:16.000Z",
          observedAt: "2026-06-18T04:09:46.188Z",
          source: "yahoo-finance-chart",
          sourceKind: "intraday_yahoo_chart",
        }),
      },
    };
    const refreshedDetails: TickerDetailsModel = {
      ...openDetails,
      quote: {
        ...openDetails.quote,
        currentPrice: 2390,
        previousClose: 2385,
        changeAmount: 5,
        changePercent: 0.2096,
        priceState: testPriceState({
          basis: "intraday",
          chipState: "open_fresh",
          marketState: "open",
          asOfDate: "2026-06-18",
          asOfTimestamp: "2026-06-18T03:54:43.000Z",
          observedAt: "2026-06-18T04:14:48.384Z",
          source: "yahoo-finance-chart",
          sourceKind: "intraday_yahoo_chart",
        }),
      },
    };
    vi.mocked(fetchTickerDetailsFullRefresh).mockResolvedValue(refreshedDetails);
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue(refreshedDetails);

    const element = renderTickerHistoryClient(openDetails, tickerInstrument, undefined, {
      quotePollIntervalSeconds: 10,
      tickerPriceIntradayEnabled: true,
      tickerPriceIntradayRefreshIntervalMinutes: 1,
    });
    await flushEffects();
    await flushEffects();

    expect(fetchTickerDetailsFullRefresh).toHaveBeenCalledTimes(1);
    expect(element.textContent).toContain("NT$2,390");
    expect(element.querySelector('[data-testid="ticker-price-state-chip"]')?.textContent).toContain("Updated");

    vi.mocked(fetchTickerDetailsFullRefresh).mockClear();
    await act(async () => {
      vi.advanceTimersByTime(59_999);
      await Promise.resolve();
    });
    expect(fetchTickerDetailsFullRefresh).not.toHaveBeenCalled();

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(fetchTickerDetailsFullRefresh).toHaveBeenCalledTimes(1);
    expect(fetchTickerDetailsHydration).not.toHaveBeenCalled();
  });

  it("requests ticker chart ranges and custom date windows from the details endpoint", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const element = renderTickerHistoryClient();
    await flushEffects();
    vi.mocked(fetchTickerDetailsHydration).mockClear();

    await act(async () => {
      findButtonByText(element, "3Y").click();
    });
    await flushEffects();
    expect(fetchTickerDetailsHydration).toHaveBeenLastCalledWith(expect.objectContaining({
      range: "3Y",
      startDate: undefined,
      endDate: undefined,
    }));

    vi.mocked(fetchTickerDetailsHydration).mockClear();
    await act(async () => {
      findButtonByText(element, "Custom").click();
    });
    const inputs = Array.from(element.querySelectorAll('[data-testid="ticker-chart-custom-range"] input'));
    await changeInput(inputs[0] as HTMLInputElement, "2024-01-01");
    await changeInput(inputs[1] as HTMLInputElement, "2024-06-30");
    await act(async () => {
      findButtonByText(element, "Apply").click();
    });
    await flushEffects();

    expect(fetchTickerDetailsHydration).toHaveBeenLastCalledWith(expect.objectContaining({
      range: undefined,
      startDate: "2024-01-01",
      endDate: "2024-06-30",
    }));
  });

  it("uses deep-linked ticker chart query params for the first hydration request", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    renderTickerHistoryClient(details, tickerInstrument, {
      chartEnd: "2024-06-30",
      chartRange: "CUSTOM",
      chartStart: "2024-01-01",
    });
    await flushEffects();

    expect(fetchTickerDetailsHydration).toHaveBeenCalledWith(expect.objectContaining({
      range: undefined,
      startDate: "2024-01-01",
      endDate: "2024-06-30",
    }));
  });

  it("keeps analysis date aliases as the ticker chart custom range after mount", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis&fromDate=2026-04-10&toDate=2026-06-26";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    renderTickerHistoryClient(details, tickerInstrument);
    await flushEffects();

    expect(fetchTickerDetailsHydration).toHaveBeenCalledWith(expect.objectContaining({
      range: undefined,
      startDate: "2026-04-10",
      endDate: "2026-06-26",
      includeProvisional: false,
    }));
  });

  it("defaults analysis-origin ticker charts to Unrealized P&L and renders scope chips", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(
      makeAnalysisChartDetails(),
      tickerInstrument,
      undefined,
      {
        transactionAccountFilter: undefined,
        transactionAccountIdsFilter: ["acc-1", "acc-2"],
      },
    );
    await flushEffects();

    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("true");
    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("false");
    expect(element.textContent).toContain(dict.tickerHistory.analysisSourceLabel);
    expect(element.textContent).toContain("2026-04-10 - 2026-06-26");
    expect(element.textContent).toContain("2 accounts");
    expect(element.textContent).toContain("Main Brokerage, Scope Brokerage");

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.currentPriceLabel).click();
    });
    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("true");
    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses market-scoped details identity for the title and breadcrumb when catalog rows collide across markets", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const duplicateCatalogInstrument: InstrumentCatalogItemDto = {
      ...tickerInstrument,
      marketCode: "US",
      name: "Acme Semiconductor ADR",
    };
    const element = renderTickerHistoryClient({
      ...details,
      identity: {
        ...details.identity,
        name: "Taiwan Semiconductor Manufacturing",
        marketCode: "TW",
      },
    }, duplicateCatalogInstrument);
    await flushEffects();

    expect(element.querySelector('[data-testid="ticker-history-title"]')?.textContent).toContain("Taiwan Semiconductor Manufacturing (2330)");
    expect(element.textContent).not.toContain("Acme Semiconductor ADR");
    expect(breadcrumbMocks.set).toHaveBeenLastCalledWith([
      { label: dict.navigation.portfolioLabel, href: "/portfolio" },
      { label: "Taiwan Semiconductor Manufacturing (2330)" },
    ]);
  });

  it("clears analysis context, resets the chart range, and switches back to Current Price", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis&fromDate=2026-04-10&toDate=2026-06-26&includeProvisional=true";
    window.history.replaceState(null, "", "/tickers/2330?source=unrealized-pnl-analysis&fromDate=2026-04-10&toDate=2026-06-26&includeProvisional=true");
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(makeAnalysisChartDetails());
    await flushEffects();
    vi.mocked(fetchTickerDetailsHydration).mockClear();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.clearAnalysisRangeLabel).click();
    });
    await flushEffects();

    const params = new URLSearchParams(window.location.search);
    expect(params.get("chartRange")).toBe("1Y");
    expect(params.has("source")).toBe(false);
    expect(params.has("fromDate")).toBe(false);
    expect(params.has("toDate")).toBe(false);
    expect(params.has("includeProvisional")).toBe(false);
    expect(element.textContent).not.toContain(dict.tickerHistory.analysisSourceLabel);
    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("true");
    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("false");
    expect(fetchTickerDetailsHydration).toHaveBeenLastCalledWith(expect.objectContaining({
      range: "1Y",
      startDate: undefined,
      endDate: undefined,
      includeProvisional: undefined,
    }));
  });

  it("locks record transactions to the full multi-account analysis scope", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(
      makeAnalysisChartDetails(),
      tickerInstrument,
      undefined,
      {
        transactionAccountFilter: undefined,
        transactionAccountIdsFilter: ["acc-1", "acc-2"],
      },
    );
    await flushEffects();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.recordTransaction).click();
    });

    const accountSelect = document.body.querySelector<HTMLSelectElement>('[data-testid="tx-account-select"]');
    expect(accountSelect).not.toBeNull();
    expect(Array.from(accountSelect?.options ?? []).map((option) => option.value)).toEqual(["acc-1", "acc-2"]);
    expect(Array.from(accountSelect?.options ?? []).map((option) => option.textContent)).toEqual([
      "Main Brokerage — Main Brokerage Default",
      "Scope Brokerage — Scope Brokerage Default",
    ]);
  });

  it("opens record transactions on market-scoped ticker pages with the first compatible account selected", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const mixedCurrencyAccounts: AccountDto[] = [
      testAccount("acc-aud", "AUD Brokerage", "AUD"),
      testAccount("acc-twd", "TWD Brokerage", "TWD"),
    ];

    const element = renderTickerHistoryClient(
      details,
      tickerInstrument,
      undefined,
      {
        accounts: mixedCurrencyAccounts,
        feeProfiles: feeProfilesFor(mixedCurrencyAccounts),
        transactionAccountFilter: undefined,
        transactionMarketFilter: "TW",
      },
    );
    await flushEffects();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.recordTransaction).click();
    });

    const dialog = document.body.querySelector('[data-testid="record-transaction-dialog"]');
    const accountSelect = document.body.querySelector<HTMLSelectElement>('[data-testid="tx-account-select"]');
    const tickerInput = document.body.querySelector<HTMLInputElement>('[data-testid="tx-ticker-combobox"]');
    const currencyInput = document.body.querySelector<HTMLInputElement>('[data-testid="tx-price-currency-input"]');

    expect(dialog).not.toBeNull();
    expect(accountSelect).not.toBeNull();
    expect(Array.from(accountSelect?.options ?? []).map((option) => option.value)).toEqual(["acc-twd"]);
    expect(accountSelect?.value).toBe("acc-twd");
    expect(tickerInput?.value).toBe("2330");
    expect(currencyInput?.value).toBe("TWD");
    expect(document.body.textContent).not.toContain("Something went wrong");
  });

  it("keeps explicit incompatible account filters scoped and shows the no-compatible-account state", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const mixedCurrencyAccounts: AccountDto[] = [
      testAccount("acc-aud", "AUD Brokerage", "AUD"),
      testAccount("acc-twd", "TWD Brokerage", "TWD"),
    ];

    const element = renderTickerHistoryClient(
      details,
      tickerInstrument,
      undefined,
      {
        accounts: mixedCurrencyAccounts,
        feeProfiles: feeProfilesFor(mixedCurrencyAccounts),
        transactionAccountFilter: "acc-aud",
        transactionMarketFilter: "TW",
      },
    );
    await flushEffects();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.recordTransaction).click();
    });

    expect(document.body.querySelector('[data-testid="record-transaction-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="tx-account-select"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="tx-no-account-error"]')?.textContent).toContain("TWD");
    expect(document.body.querySelector('[data-testid="tx-create-account-link"]')).not.toBeNull();
  });

  it("intersects explicit multi-account scopes with ticker-market compatible accounts", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const mixedCurrencyAccounts: AccountDto[] = [
      testAccount("acc-aud", "AUD Brokerage", "AUD"),
      testAccount("acc-twd", "TWD Brokerage", "TWD"),
      testAccount("acc-usd", "USD Brokerage", "USD"),
    ];

    const element = renderTickerHistoryClient(
      details,
      tickerInstrument,
      undefined,
      {
        accounts: mixedCurrencyAccounts,
        feeProfiles: feeProfilesFor(mixedCurrencyAccounts),
        transactionAccountFilter: undefined,
        transactionAccountIdsFilter: ["acc-aud", "acc-twd"],
        transactionMarketFilter: "TW",
      },
    );
    await flushEffects();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.recordTransaction).click();
    });

    const accountSelect = document.body.querySelector<HTMLSelectElement>('[data-testid="tx-account-select"]');
    expect(accountSelect).not.toBeNull();
    expect(Array.from(accountSelect?.options ?? []).map((option) => option.value)).toEqual(["acc-twd"]);
    expect(accountSelect?.value).toBe("acc-twd");
  });

  it("keeps explicit incompatible multi-account scopes in the no-compatible-account state", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const mixedCurrencyAccounts: AccountDto[] = [
      testAccount("acc-aud", "AUD Brokerage", "AUD"),
      testAccount("acc-usd", "USD Brokerage", "USD"),
      testAccount("acc-twd", "TWD Brokerage", "TWD"),
    ];

    const element = renderTickerHistoryClient(
      details,
      tickerInstrument,
      undefined,
      {
        accounts: mixedCurrencyAccounts,
        feeProfiles: feeProfilesFor(mixedCurrencyAccounts),
        transactionAccountFilter: undefined,
        transactionAccountIdsFilter: ["acc-aud", "acc-usd"],
        transactionMarketFilter: "TW",
      },
    );
    await flushEffects();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.recordTransaction).click();
    });

    expect(document.body.querySelector('[data-testid="record-transaction-dialog"]')).not.toBeNull();
    expect(document.body.querySelector('[data-testid="tx-account-select"]')).toBeNull();
    expect(document.body.querySelector('[data-testid="tx-no-account-error"]')?.textContent).toContain("TWD");
    expect(document.body.querySelector('[data-testid="tx-create-account-link"]')).not.toBeNull();
  });

  it("preserves the locked ticker and market when switching compatible accounts in the record dialog", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(
      details,
      tickerInstrument,
      undefined,
      {
        transactionAccountFilter: undefined,
        transactionMarketFilter: "TW",
      },
    );
    await flushEffects();

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.recordTransaction).click();
    });

    const accountSelect = document.body.querySelector<HTMLSelectElement>('[data-testid="tx-account-select"]');
    expect(accountSelect).not.toBeNull();
    expect(Array.from(accountSelect?.options ?? []).map((option) => option.value)).toEqual(["acc-1", "acc-2"]);

    await act(async () => {
      accountSelect!.value = "acc-2";
      accountSelect!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(document.body.querySelector<HTMLInputElement>('[data-testid="tx-ticker-combobox"]')?.value).toBe("2330");
    expect(document.body.querySelector<HTMLInputElement>('[data-testid="tx-price-currency-input"]')?.value).toBe("TWD");
    expect(document.body.querySelector<HTMLSelectElement>('[data-testid="tx-account-select"]')?.value).toBe("acc-2");
  });

  it("keeps direct ticker visits on Current Price by default", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(makeAnalysisChartDetails());
    await flushEffects();

    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("true");
    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("false");
    expect(element.textContent).not.toContain(dict.tickerHistory.analysisSourceLabel);
  });

  it("switches to Unrealized P&L when same-ticker client navigation gains the analysis source", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const element = renderTickerHistoryClient(makeAnalysisChartDetails());
    await flushEffects();

    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("true");

    navigationMocks.searchParams = "source=unrealized-pnl-analysis&fromDate=2026-04-10&toDate=2026-06-26";
    await act(async () => {
      root!.render(tickerHistoryClientElement(makeAnalysisChartDetails()));
    });
    await flushEffects();

    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("true");
    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("false");
  });

  it("shows an Unrealized P&L empty state while keeping Current Price available", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(makeAnalysisChartDetails({ unrealizedPnlHistory: [] }));
    await flushEffects();

    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("true");
    expect(element.textContent).toContain(dict.tickerHistory.unrealizedPnlEmptyState);

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.currentPriceLabel).click();
    });

    expect(findButtonByText(element, dict.tickerHistory.currentPriceLabel).getAttribute("aria-pressed")).toBe("true");
    expect(element.textContent).not.toContain(dict.tickerHistory.unrealizedPnlEmptyState);
  });

  it("switches the chart title and subtitle by metric", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);

    const element = renderTickerHistoryClient(makeAnalysisChartDetails());
    await flushEffects();

    expect(element.textContent).toContain(dict.tickerHistory.unrealizedPnlChartTitle);
    expect(element.textContent).toContain(dict.tickerHistory.unrealizedPnlChartSubtitle);

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.currentPriceLabel).click();
    });

    expect(element.textContent).toContain(dict.tickerHistory.chartTitle);
    expect(element.textContent).toContain(dict.tickerHistory.chartSubtitle);
  });

  it("shows a price-chart loading state while hydration is in flight", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));

    const element = renderTickerHistoryClient({
      ...details,
      chart: {
        ...details.chart,
        points: [],
      },
    });
    await flushEffects();

    expect(element.textContent).toContain(dict.tickerHistory.priceChartLoadingState);
    expect(element.textContent).not.toContain(dict.tickerHistory.priceChartEmptyState);
  });

  it("shows a price-chart empty state after hydration finishes without chart data", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue({
      ...details,
      chart: {
        ...details.chart,
        points: [],
      },
    });

    const element = renderTickerHistoryClient({
      ...details,
      chart: {
        ...details.chart,
        points: [],
      },
    });
    await flushEffects();
    await flushEffects();

    expect(element.textContent).toContain(dict.tickerHistory.priceChartEmptyState);
    expect(element.textContent).not.toContain(dict.tickerHistory.priceChartLoadingState);
  });

  it("renders raw close chart points as current-price history when DTO-shaped points reach the client", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const element = renderTickerHistoryClient({
      ...details,
      chart: {
        ...details.chart,
        points: [
          {
            date: "2026-06-11",
            label: "2026-06-11",
            close: 108,
          },
          {
            date: "2026-06-12",
            label: "2026-06-12",
            close: 110,
          },
        ] as unknown as TickerDetailsModel["chart"]["points"],
      },
    });
    await flushEffects();

    expect(element.textContent).not.toContain(dict.tickerHistory.priceChartEmptyState);
    const latestChartData = rechartsMocks.lineChartData.at(-1);
    expect(latestChartData).toEqual([
      expect.objectContaining({
        date: "2026-06-11",
        price: 108,
        averageCost: 100,
        quantity: 10,
      }),
      expect.objectContaining({
        date: "2026-06-12",
        price: 110,
        averageCost: 100,
        quantity: 10,
      }),
    ]);
  });

  it("does not use unrealized P&L history as current-price fallback without chart points", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const element = renderTickerHistoryClient({
      ...details,
      chart: {
        ...details.chart,
        points: [],
      },
      unrealizedPnlHistory: [
        {
          date: "2026-06-11",
          label: "2026-06-11",
          unrealizedPnl: 80,
          currency: "TWD",
          quantity: 10,
        },
        {
          date: "2026-06-12",
          label: "2026-06-12",
          unrealizedPnl: 100,
          currency: "TWD",
          quantity: 10,
        },
      ],
    });
    await flushEffects();
    await flushEffects();

    expect(element.textContent).toContain(dict.tickerHistory.priceChartEmptyState);
    expect(rechartsMocks.lineChartData).toEqual([]);
  });

  it("keeps the current-price chart empty when chart points have no numeric prices", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const element = renderTickerHistoryClient({
      ...details,
      chart: {
        ...details.chart,
        points: [
          { date: "2026-06-11", label: "2026-06-11" },
          { date: "2026-06-12", label: "2026-06-12" },
        ] as TickerDetailsModel["chart"]["points"],
      },
      unrealizedPnlHistory: [
        {
          date: "2026-06-11",
          label: "2026-06-11",
          unrealizedPnl: 80,
          currency: "TWD",
          quantity: 10,
        },
        {
          date: "2026-06-12",
          label: "2026-06-12",
          unrealizedPnl: 100,
          currency: "TWD",
          quantity: 10,
        },
      ],
    });
    await flushEffects();

    expect(element.textContent).toContain(dict.tickerHistory.priceChartEmptyState);
    expect(rechartsMocks.lineChartData).toEqual([]);
  });

  it("renders unrealized P&L history independently when price chart points are absent", async () => {
    navigationMocks.searchParams = "source=unrealized-pnl-analysis";
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(async (input) => input.primaryDetails);
    const element = renderTickerHistoryClient({
      ...details,
      chart: {
        ...details.chart,
        points: [],
      },
      unrealizedPnlHistory: [
        {
          date: "2026-06-11",
          label: "2026-06-11",
          unrealizedPnl: 80,
          currency: "TWD",
          quantity: 10,
        },
        {
          date: "2026-06-12",
          label: "2026-06-12",
          unrealizedPnl: 100,
          currency: "TWD",
          quantity: 10,
        },
      ],
    });
    await flushEffects();

    expect(findButtonByText(element, dict.tickerHistory.unrealizedPnlLabel).getAttribute("aria-pressed")).toBe("true");
    expect(element.textContent).not.toContain(dict.tickerHistory.unrealizedPnlEmptyState);
    const latestChartData = rechartsMocks.lineChartData.at(-1);
    expect(latestChartData).toEqual([
      expect.objectContaining({
        date: "2026-06-11",
        unrealizedPnl: 80,
        quantity: 10,
      }),
      expect.objectContaining({
        date: "2026-06-12",
        unrealizedPnl: 100,
        quantity: 10,
      }),
    ]);
  });

  it("renders refreshed account breakdown from ticker details state", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockResolvedValue({
      ...details,
      accountBreakdown: [{
        ...details.accountBreakdown[0]!,
        accountName: "Fresh Account",
        reportingMarketValueAmount: null,
        marketValueAmount: null,
        reportingCostBasisAmount: 1250,
      }],
    });

    const element = renderTickerHistoryClient();
    await flushEffects();
    await flushEffects();

    const breakdown = element.querySelector('[data-testid="ticker-account-breakdown"]');
    const rows = element.querySelector('[data-testid="ticker-account-breakdown-rows"]');
    expect(breakdown?.textContent).toContain("Fresh Account");
    expect(breakdown?.textContent).toContain("NT$1,250");
    expect(breakdown?.textContent).toContain("Cost basis fallback");
    expect(rows?.querySelector('[data-testid="ticker-account-breakdown-row-acc-2"]')).not.toBeNull();
    expect(breakdown?.querySelector("table")).toBeNull();
  });

  it("shows resolved reporting currency and routes currency changes to Quick Actions", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));

    const element = renderTickerHistoryClient();
    await flushEffects();

    const headerBadge = element.querySelector('[data-testid="ticker-reporting-currency"]');
    const breakdownBadge = element.querySelector('[data-testid="ticker-account-breakdown-reporting-currency"]');

    expect(headerBadge?.textContent).toContain("Reporting TWD");
    expect(headerBadge?.textContent).toContain(dict.tickerHistory.changeReportingCurrency);
    expect(breakdownBadge?.textContent).toContain("Reporting TWD");
    expect(breakdownBadge?.textContent).toContain(dict.tickerHistory.reportingCurrencyDescription);

    await act(async () => {
      findButtonByText(element, dict.tickerHistory.changeReportingCurrency).click();
    });

    expect(appShellDataMocks.openQuickActions).toHaveBeenCalledTimes(1);
  });

  it("renders market-scoped allocation on the position summary and account rows", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));

    const element = renderTickerHistoryClient();
    await flushEffects();

    const summary = element.querySelector('[data-testid="ticker-position-summary-market-allocation"]');
    const accountRow = element.querySelector('[data-testid="ticker-account-breakdown-row-acc-2"]');

    expect(summary?.textContent).toContain(dict.tickerHistory.marketAllocationLabel);
    expect(summary?.textContent).toContain("32.5%");
    expect(accountRow?.textContent).toContain(dict.tickerHistory.marketAllocationLabel);
    expect(accountRow?.textContent).toContain("32.5%");
    expect(element.textContent).toContain(dict.tickerHistory.marketAllocationSubtitle);
  });

  it("does not relabel native account values as reporting contribution when reporting amounts are missing", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));

    const element = renderTickerHistoryClient({
      ...details,
      accountBreakdown: [{
        ...details.accountBreakdown[0]!,
        marketValueAmount: 9876,
        costBasisAmount: 5432,
        reportingMarketValueAmount: null,
        reportingCostBasisAmount: null,
      }],
    });
    await flushEffects();

    const row = element.querySelector('[data-testid="ticker-account-breakdown-row-acc-2"]');
    expect(row?.textContent).toContain(dict.tickerHistory.noHoldingData);
    expect(row?.textContent).not.toContain("NT$9,876");
    expect(row?.textContent).not.toContain("NT$5,432");
    expect(row?.textContent).not.toContain(dict.dashboardHome.allocationFallbackLabel);
  });

  it("renders unavailable quote changes without positive or negative styling", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));

    const element = renderTickerHistoryClient({
      ...details,
      quote: {
        ...details.quote,
        changeAmount: null,
        changePercent: null,
      },
    });
    await flushEffects();

    const quoteChange = element.querySelector('[data-testid="ticker-quote-change"]');
    expect(quoteChange?.textContent).toContain("-");
    expect(quoteChange?.className).toContain("text-muted-foreground");
    expect(quoteChange?.className).not.toContain("text-success");
    expect(quoteChange?.className).not.toContain("text-destructive");
    expect(quoteChange?.querySelector("svg")).toBeNull();
  });

  it("opens the query-selected transactions tab and preserves account and market when switching tabs", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    navigationMocks.searchParams = "marketCode=TW&accountId=acc-2&tab=transactions";
    const replaceState = vi.spyOn(window.history, "replaceState");

    const element = renderTickerHistoryClient(details, tickerInstrument, undefined, {
      initialTab: "transactions",
    });
    await flushEffects();

    expect(element.querySelector("[data-testid='ticker-tab-transactions']")?.getAttribute("data-state")).toBe("active");
    await act(async () => {
      const overviewTab = element.querySelector<HTMLButtonElement>("[data-testid='ticker-tab-overview']");
      overviewTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      overviewTab?.click();
    });

    expect(replaceState).toHaveBeenCalledWith(
      null,
      "",
      "/tickers/2330?marketCode=TW&accountId=acc-2&tab=overview",
    );
  });

  it("responds to a live tab query change without remounting ticker detail", async () => {
    vi.mocked(fetchTickerDetailsHydration).mockImplementation(() => new Promise(() => {}));
    navigationMocks.searchParams = "marketCode=TW&tab=overview";
    const element = renderTickerHistoryClient(details, tickerInstrument, undefined, { initialTab: "overview" });
    await flushEffects();

    navigationMocks.searchParams = "marketCode=TW&tab=dividends";
    act(() => {
      root!.render(tickerHistoryClientElement(details, tickerInstrument, undefined, { initialTab: "overview" }));
    });
    await flushEffects();

    expect(element.querySelector("[data-testid='ticker-tab-dividends']")?.getAttribute("data-state")).toBe("active");
  });
});
