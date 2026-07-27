import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "../../../lib/i18n";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { TransactionsClient } from "../../../components/transactions/TransactionsClient";
import { deriveSharedContextPermissions } from "../../../features/sharing/capabilities";

const replaceMock = vi.fn();
const refreshMock = vi.fn();
const routerMock = { replace: replaceMock };
const historyRefreshMock = vi.hoisted(() => vi.fn());
const searchParamsValue = vi.hoisted(() => ({ value: "" }));
const transactionHistoryBrowserProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
const addTransactionCardProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
const transactionsPrimaryDataMock = vi.hoisted(() => vi.fn(() => ({
  data: {
    recentTransactions: [],
    accountOptions: [],
    capabilities: {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    },
  },
  isBootstrapping: false,
  restoredAt: null,
  restoredFromCache: false,
  isRefreshing: false,
  refresh: refreshMock,
  errorMessage: "",
})));

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(searchParamsValue.value),
}));

vi.mock("../../../features/portfolio/hooks/useTransactionsPrimaryData", () => ({
  useTransactionsPrimaryData: transactionsPrimaryDataMock,
}));

vi.mock("../../../components/layout/CardLayoutResetContext", () => ({
  useCardLayoutResetCount: () => 0,
}));

vi.mock("../../../components/ui/Tabs", () => ({
  TabsRoot: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children, ...props }: { children: ReactNode }) => <div {...props}>{children}</div>,
  TabsTrigger: ({ children, ...props }: { children: ReactNode }) => <button type="button" {...props}>{children}</button>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../components/layout/SortableCardGrid", () => ({
  SortableCardGrid: ({
    cards,
    children,
  }: {
    cards: Array<{ slug: string }>;
    children: (slug: string) => React.ReactNode;
  }) => (
    <div data-testid="mock-sortable-grid">
      {cards.map((card) => <div key={card.slug}>{children(card.slug)}</div>)}
    </div>
  ),
}));

vi.mock("../../../components/transactions/AiInboxPanel", () => ({
  AiInboxPanel: () => <div data-testid="mock-ai-inbox-panel" />,
}));

vi.mock("../../../components/portfolio/AddTransactionCard", () => ({
  AddTransactionCard: (props: Record<string, unknown>) => {
    addTransactionCardProps.last = props;
    return <div data-testid="mock-add-transaction-card" />;
  },
}));

vi.mock("../../../features/portfolio/hooks/useTransactionHistory", () => ({
  useTransactionHistory: () => ({
    data: {
      items: [],
      total: 0,
      limit: 50,
      offset: 0,
      aggregates: {
        realizedPnlByCurrency: [],
      },
    },
    errorMessage: "",
    isLoading: false,
    refresh: historyRefreshMock,
  }),
}));

vi.mock("../../../components/transactions/TransactionHistoryBrowser", () => ({
  TransactionHistoryBrowser: (props: Record<string, unknown>) => {
    transactionHistoryBrowserProps.last = props;
    return <div data-testid="mock-transaction-history-browser" />;
  },
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildShellData(capabilities: AppShellData["currentSharedCapabilities"], contextRefreshSignal = 0): AppShellData {
  return {
    uiDict: getDictionary("en"),
    locale: "en",
    sessionUserId: "delegate-user",
    sessionUserRole: "viewer",
    routeCachePolicy: null,
    isSharedContext: true,
    switcherLoaded: true,
    currentSharedCapabilities: capabilities,
    sharedContextPermissions: deriveSharedContextPermissions(capabilities),
    canUseGlobalQuickActions: false,
    openQuickActions: vi.fn(),
    portfolioCapabilities: null,
    reportingCurrency: "TWD",
    saveReportingCurrency: vi.fn(),
    applyAccountMutationResponse: vi.fn(),
    isReportingCurrencySaving: false,
    reportingCurrencyError: "",
    transactionSubmission: {
      draftTransaction: {},
      setDraftTransaction: vi.fn(),
      setMessage: vi.fn(),
      markUnitPriceEdited: vi.fn(),
      submit: vi.fn(),
      isSubmitting: false,
      priceHint: null,
      showPriceUnavailableHint: false,
      feeEstimate: null,
    } as never,
    mutations: {} as never,
    recomputeAction: {} as never,
    openRecomputeConfirm: vi.fn(),
    transactionAccountOptions: [],
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    refreshPortfolioConfig: vi.fn(),
    isPortfolioConfigLoading: false,
    portfolioConfigError: "",
    integrityIssue: null,
    showIntegrityDialog: false,
    setShowIntegrityDialog: vi.fn(),
    generateSnapshots: vi.fn(),
    isGeneratingSnapshots: false,
    contextRefreshSignal,
  };
}

describe("TransactionsClient shared AI Inbox visibility", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    historyRefreshMock.mockReset();
    transactionsPrimaryDataMock.mockReset();
    transactionsPrimaryDataMock.mockReturnValue({
      data: {
        recentTransactions: [],
        accountOptions: [],
        capabilities: {
          configuredMarkets: ["TW", "US"],
          configuredCurrencies: ["TWD", "USD"],
        },
      },
      isBootstrapping: false,
      restoredAt: null,
      restoredFromCache: false,
      isRefreshing: false,
      refresh: refreshMock,
      errorMessage: "",
    });
    transactionHistoryBrowserProps.last = null;
    addTransactionCardProps.last = null;
    searchParamsValue.value = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("hides AI Inbox for shared delegates without portfolio:mcp_read", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <TransactionsClient initialTab="ai-inbox" />
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='transactions-tab-ai-inbox']")).toBeNull();
    expect(document.querySelector("[data-testid='mock-ai-inbox-panel']")).toBeNull();
    expect(document.querySelector("[data-testid='transactions-tab-posted']")).not.toBeNull();
  });

  it("shows AI Inbox for shared delegates with portfolio:mcp_read", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData(["portfolio:mcp_read"])}>
          <TransactionsClient initialTab="ai-inbox" />
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='transactions-tab-ai-inbox']")).not.toBeNull();
    expect(document.querySelector("[data-testid='mock-ai-inbox-panel']")).not.toBeNull();
  });

  it("normalizes BUY + realized URLs to SELL with router.replace", () => {
    searchParamsValue.value = "type=BUY&pnl=realized";

    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock).toHaveBeenCalledWith("/transactions?type=SELL&pnl=realized", { scroll: false });
  });

  it("refreshes transaction history when the shell refresh signal changes on the posted tab", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([], 0)}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(refreshMock).not.toHaveBeenCalled();
    expect(historyRefreshMock).not.toHaveBeenCalled();

    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([], 1)}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(historyRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("refreshes transaction history from the visible refresh button", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    act(() => {
      document.querySelector<HTMLButtonElement>("[data-testid='transactions-refresh-button']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(refreshMock).toHaveBeenCalledTimes(1);
    expect(historyRefreshMock).toHaveBeenCalledTimes(1);
  });

  it("passes configured markets to the history browser and add transaction card", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData(["transaction:write"])}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(transactionHistoryBrowserProps.last?.availableMarkets).toEqual(["TW", "US"]);
    expect(addTransactionCardProps.last?.availableMarkets).toEqual(["TW", "US"]);
  });

  it("shows the readonly zero-account gate on transactions when no configured markets exist", () => {
    transactionsPrimaryDataMock.mockReturnValue({
      data: {
        recentTransactions: [],
        accountOptions: [],
        capabilities: {
          configuredMarkets: [],
          configuredCurrencies: [],
        },
      },
      isBootstrapping: false,
      restoredAt: null,
      restoredFromCache: false,
      isRefreshing: false,
      refresh: refreshMock,
      errorMessage: "",
    } as never);

    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-gate']")).not.toBeNull();
    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-cta']")).toBeNull();
    expect(document.querySelector("[data-testid='portfolio-capabilities-zero-account-readonly']")).not.toBeNull();
    expect(document.querySelector("[data-testid='mock-transaction-history-browser']")).toBeNull();
    expect(document.querySelector("[data-testid='mock-add-transaction-card']")).toBeNull();
  });

  it("normalizes stale market filters and renders the market capability notice", () => {
    transactionsPrimaryDataMock.mockReturnValue({
      data: {
        recentTransactions: [],
        accountOptions: [],
        capabilities: {
          configuredMarkets: ["TW"],
          configuredCurrencies: ["TWD"],
        },
      },
      isBootstrapping: false,
      restoredAt: null,
      restoredFromCache: false,
      isRefreshing: false,
      refresh: refreshMock,
      errorMessage: "",
    } as never);
    searchParamsValue.value = "marketCode=US";

    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData(["account:manage"])}>
          <TransactionsClient initialTab="posted" />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock).toHaveBeenCalledWith("/transactions?marketCode=TW", { scroll: false });
    expect(document.querySelector("[data-testid='portfolio-capabilities-normalization-notice-market']")).not.toBeNull();
  });
});
