import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  fetchDividendDailyHighlights: vi.fn(),
  fetchDividendReviewPrimary: vi.fn(),
  fetchDividendLedgerReview: vi.fn(),
  fetchDividendLedgerYears: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div data-testid="mock-app-shell">{children}</div>,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

vi.mock("../../../components/dividends/DividendsTabsClient", () => ({
  DividendsTabsClient: ({
    initialTab,
    initialCalendarSnapshot,
    initialDailyHighlights,
    initialContextOwnerId,
    initialReviewData,
    initialReviewQuery,
    initialYears,
    accounts,
  }: {
    initialTab: string;
    initialCalendarSnapshot: unknown;
    initialDailyHighlights: {
      payingToday: { status: string };
      exDividendToday: { status: string };
    } | undefined;
    initialContextOwnerId: string;
    initialReviewData: unknown;
    initialReviewQuery: unknown;
    initialYears: unknown[];
    accounts: unknown[];
  }) => (
    <div
      data-testid="dividends-tabs-client"
      data-initial-tab={initialTab}
      data-has-calendar-snapshot={String(initialCalendarSnapshot !== null)}
      data-paying-today-status={initialDailyHighlights?.payingToday.status ?? "missing"}
      data-ex-dividend-today-status={initialDailyHighlights?.exDividendToday.status ?? "missing"}
      data-initial-context-owner={initialContextOwnerId}
      data-has-review-data={String(initialReviewData !== null)}
      data-years-count={String(initialYears.length)}
      data-accounts-count={String(accounts.length)}
      data-has-review-query={String(initialReviewQuery !== null)}
    />
  ),
}));

vi.mock("../../../components/dividends/DividendCalendarClient", () => ({
  DividendCalendarClient: () => <div data-testid="dividend-calendar-client" />,
}));

vi.mock("../../../components/dividends/DividendReviewClient", () => ({
  DividendReviewClient: () => <div data-testid="dividend-review-client" />,
}));

import { requireSession } from "../../../lib/auth";
import { cookies } from "next/headers";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import {
  fetchDividendCalendarSnapshot,
  fetchDividendDailyHighlights,
  fetchDividendReviewPrimary,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../../features/dividends/services/dividendService";
import DividendsPage from "../../../app/dividends/page";

const requireSessionMock = vi.mocked(requireSession);
const cookiesMock = vi.mocked(cookies);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchDividendCalendarSnapshotMock = vi.mocked(fetchDividendCalendarSnapshot);
const fetchDividendDailyHighlightsMock = vi.mocked(fetchDividendDailyHighlights);
const fetchDividendReviewPrimaryMock = vi.mocked(fetchDividendReviewPrimary);
const fetchDividendLedgerReviewMock = vi.mocked(fetchDividendLedgerReview);
const fetchDividendLedgerYearsMock = vi.mocked(fetchDividendLedgerYears);

describe("DividendsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user-1", isDemo: false } as never);
    cookiesMock.mockResolvedValue({ get: () => undefined } as never);
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/settings/fee-config") {
        return {
          accounts: [{ id: "acc-1", name: "Main" }],
          capabilities: {
            configuredMarkets: ["TW"],
            configuredCurrencies: ["TWD"],
          },
        };
      }
      if (path === "/profile") return {};
      return {};
    }) as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    fetchDividendCalendarSnapshotMock.mockResolvedValue({ events: [], ledgerEntries: [] } as never);
    fetchDividendDailyHighlightsMock.mockResolvedValue({ payingToday: [], exDividendToday: [] } as never);
    fetchDividendReviewPrimaryMock.mockResolvedValue({ reviewRows: [], total: 0, years: [2026], accounts: [{ id: "acc-1", name: "Main" }] } as never);
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
    fetchDividendLedgerYearsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("plain route renders calendar shell without server-side dividend probes", async () => {
    const result = await DividendsPage({
      searchParams: Promise.resolve({}),
    });

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledWith({
      fromPaymentDate: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      toPaymentDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      limit: 500,
    });
    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
    expect(getJsonMock).toHaveBeenCalledWith("/settings/fee-config");
    expect(result).toBeTruthy();
  });

  it("calendar route server-prefetches the requested month and passes it to the tabs client", async () => {
    const result = await DividendsPage({
      searchParams: Promise.resolve({ month: "2026-07" }),
    });
    const html = renderToStaticMarkup(result);

    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledWith({
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      limit: 500,
    });
    expect(fetchDividendDailyHighlightsMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-has-calendar-snapshot="true"');
    expect(html).toContain('data-paying-today-status="success"');
    expect(html).toContain('data-ex-dividend-today-status="success"');
    expect(html).toContain('data-initial-context-owner="user-1"');
  });

  it("passes an explicit daily-highlight error state without failing the calendar page", async () => {
    fetchDividendDailyHighlightsMock.mockRejectedValueOnce(new Error("daily read failed"));

    const result = await DividendsPage({ searchParams: Promise.resolve({ month: "2026-07" }) });
    const html = renderToStaticMarkup(result);

    expect(html).toContain('data-has-calendar-snapshot="true"');
    expect(html).toContain('data-paying-today-status="error"');
    expect(html).toContain('data-ex-dividend-today-status="error"');
  });

  it("ledger route server-fetches primary rows and metadata without waiting for enrichment", async () => {
    const result = await DividendsPage({
      searchParams: Promise.resolve({ view: "ledger" }),
    });
    const html = renderToStaticMarkup(result);

    expect(fetchDividendReviewPrimaryMock).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 10 }));
    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
    expect(fetchDividendCalendarSnapshotMock).not.toHaveBeenCalled();
    expect(getJsonMock).toHaveBeenCalledWith("/settings/fee-config");
    expect(html).toContain('data-accounts-count="1"');
    expect(html).toContain('data-has-review-data="true"');
    expect(result).toBeTruthy();
  });

  it("does not block the plain route on review counts before first paint", async () => {
    fetchDividendLedgerReviewMock.mockResolvedValueOnce({
      ledgerEntries: [{ id: "entry-1" }],
      total: 1,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 2,
        byMonth: {},
        byTicker: {},
      },
    } as never);

    const result = await DividendsPage({
      searchParams: Promise.resolve({}),
    });

    expect(fetchDividendLedgerReviewMock).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYearsMock).not.toHaveBeenCalled();
    expect(fetchDividendCalendarSnapshotMock).toHaveBeenCalledTimes(1);
    expect(result).toBeTruthy();
  });
});
