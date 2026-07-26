import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getDictionary } from "../../../lib/i18n";
import { AppShellDataProvider } from "../../../components/layout/AppShellDataContext";

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  fetchDividendLedgerReview: vi.fn(),
  fetchDividendLedgerYears: vi.fn(),
}));

vi.mock("../../../components/dividends/DividendCalendarClient", () => ({
  DividendCalendarClient: () => <div data-testid="mock-dividend-calendar-client" />,
}));

vi.mock("../../../components/dividends/DividendReviewClient", () => ({
  DividendReviewClient: () => <div data-testid="mock-dividend-review-client" />,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../../features/dividends/services/dividendService";
import { buildOverviewTabUrl, DividendsTabsClient } from "../../../components/dividends/DividendsTabsClient";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");
const fetchDividendCalendarSnapshotMock = vi.mocked(fetchDividendCalendarSnapshot);
const fetchDividendLedgerReviewMock = vi.mocked(fetchDividendLedgerReview);
const fetchDividendLedgerYearsMock = vi.mocked(fetchDividendLedgerYears);
const emptyReviewData = {
  reviewRows: [],
  eligibleTickers: [],
  years: [2026],
  accounts: [],
  ledgerEntries: [],
  total: 0,
  aggregates: {
    totalExpectedCashAmount: {},
    totalReceivedCashAmount: {},
    openCount: 0,
    byMonth: {},
    byTicker: {},
  },
};

describe("DividendsTabsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, "", "/dividends?view=ledger");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    fetchDividendCalendarSnapshotMock.mockResolvedValue({
      events: [],
      ledgerEntries: [],
    } as never);
    fetchDividendLedgerReviewMock.mockResolvedValue({
      ledgerEntries: [],
      total: 0,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 0,
        byMonth: {},
        byTicker: {},
      },
    } as never);
    fetchDividendLedgerYearsMock.mockResolvedValue([2026]);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("does not fetch calendar data while ledger is the active tab on first render", async () => {
    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="ledger"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={null}
          initialReviewData={emptyReviewData}
          initialYears={[2026]}
        />,
      );
    });

    await act(async () => {});

    expect(fetchDividendCalendarSnapshotMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
  });

  it("shows the shared-safe zero-account gate instead of dividend tabs", async () => {
    act(() => {
      root.render(
        <AppShellDataProvider
          value={{
            portfolioCapabilities: {
              configuredMarkets: [],
              configuredCurrencies: [],
            },
            isPortfolioConfigLoading: false,
            sharedContextPermissions: { canManageAccounts: false },
          } as never}
        >
          <DividendsTabsClient
            initialTab="calendar"
            calendarLabel={dict.dividends.tabs.calendar}
            ledgerLabel={dict.dividends.tabs.review}
            dict={dict}
            locale="en"
            accounts={[]}
            initialCalendarMonth="2026-07"
            initialCalendarSnapshot={{ events: [], ledgerEntries: [] } as never}
            initialReviewData={null}
            initialYears={[]}
          />
        </AppShellDataProvider>,
      );
    });

    expect(
      container.querySelector('[data-testid="portfolio-capabilities-zero-account-gate"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-testid="dividends-tabs"]')).toBeNull();
  });

  it("keeps Review metadata inside the primary DTO without a separate years waterfall", async () => {
    fetchDividendLedgerYearsMock.mockResolvedValue([]);

    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="ledger"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={null}
          initialReviewData={emptyReviewData}
          initialYears={[]}
        />,
      );
    });

    await act(async () => {});
    await act(async () => {});

    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
  });

  it("fetches calendar data only once after the inactive tab is first activated", async () => {
    const renderTabs = (initialTab: "calendar" | "ledger") => {
      root.render(
        <DividendsTabsClient
          initialTab={initialTab}
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={null}
          initialReviewData={emptyReviewData}
          initialYears={[2026]}
        />,
      );
    };

    act(() => {
      renderTabs("ledger");
    });

    await act(async () => {});

    await act(async () => {
      renderTabs("calendar");
    });
    await act(async () => {});

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      renderTabs("ledger");
    });
    await act(async () => {
      renderTabs("calendar");
    });
    await act(async () => {});

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("preserves the current URL month when building the Review to Overview tab URL", () => {
    expect(buildOverviewTabUrl("?view=ledger&month=2026-08&ticker=2330&marketCode=TW")).toEqual({
      month: "2026-08",
      url: "/dividends?month=2026-08",
    });
  });

  it("passes a newly selected Review query to the Review client without a tabs-level fetch", async () => {
    const calendarSnapshot = { events: [], ledgerEntries: [] };
    const renderTabs = (initialTab: "calendar" | "ledger") => {
      root.render(
        <DividendsTabsClient
          initialTab={initialTab}
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-04"
          initialCalendarSnapshot={calendarSnapshot}
          initialReviewData={emptyReviewData}
          initialYears={[2026]}
        />,
      );
    };

    window.history.replaceState(null, "", "/dividends?view=ledger&month=2026-04&fromPaymentDate=2026-04-01&toPaymentDate=2026-04-30");
    act(() => {
      renderTabs("ledger");
    });
    await act(async () => {});

    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();

    await act(async () => {
      renderTabs("calendar");
    });
    window.history.replaceState(null, "", "/dividends?view=ledger&month=2026-05&fromPaymentDate=2026-05-01&toPaymentDate=2026-05-31&ticker=2330&marketCode=TW");
    await act(async () => {
      renderTabs("ledger");
    });
    await act(async () => {});

    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
  });

  it("renders an error state when lazy calendar loading fails", async () => {
    fetchDividendCalendarSnapshotMock.mockRejectedValue(new Error("calendar unavailable"));

    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="ledger"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={null}
          initialReviewData={emptyReviewData}
          initialYears={[2026]}
        />,
      );
    });

    await act(async () => {
      root.render(
        <DividendsTabsClient
          initialTab="calendar"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={null}
          initialReviewData={emptyReviewData}
          initialYears={[2026]}
        />,
      );
    });
    await act(async () => {});

    expect(container.textContent).toContain("calendar unavailable");
  });

  it("mounts the Review shell when SSR primary data is unavailable", async () => {
    fetchDividendLedgerReviewMock.mockRejectedValue(new Error("ledger unavailable"));

    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="ledger"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={null}
          initialReviewData={null}
          initialYears={[]}
        />,
      );
    });

    await act(async () => {});

    expect(container.querySelector("[data-testid='mock-dividend-review-client']")).not.toBeNull();
  });
});
