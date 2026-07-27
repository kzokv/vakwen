import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DividendsTabsClient } from "../../../components/dividends/DividendsTabsClient";
import { getDictionary } from "../../../lib/i18n";

vi.mock("../../../components/dividends/DividendCalendarClient", () => ({
  DividendCalendarClient: () => <div data-testid="mock-calendar-client">calendar</div>,
}));

vi.mock("../../../components/dividends/DividendReviewClient", () => ({
  DividendReviewClient: ({ accounts }: { accounts: unknown[] }) => (
    <div data-testid="mock-review-client" data-accounts-count={String(accounts.length)}>review</div>
  ),
}));

vi.mock("../../../features/dividends/services/dividendService", () => ({
  fetchDividendCalendarSnapshot: vi.fn(),
  fetchDividendLedgerReview: vi.fn(),
  fetchDividendLedgerYears: vi.fn(),
}));

vi.mock("../../../features/settings/services/shellPortfolioConfigService", () => ({
  fetchShellPortfolioConfig: vi.fn(),
}));

import {
  fetchDividendCalendarSnapshot,
  fetchDividendLedgerReview,
  fetchDividendLedgerYears,
} from "../../../features/dividends/services/dividendService";
import { fetchShellPortfolioConfig } from "../../../features/settings/services/shellPortfolioConfigService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("DividendsTabsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.history.replaceState(null, "", "/dividends");
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchDividendCalendarSnapshot).mockResolvedValue({ events: [], ledgerEntries: [] });
    vi.mocked(fetchDividendLedgerReview).mockResolvedValue({
      ledgerEntries: [],
      total: 0,
      aggregates: {
        totalExpectedCashAmount: {},
        totalReceivedCashAmount: {},
        openCount: 0,
        byMonth: {},
        byTicker: {},
      },
    });
    vi.mocked(fetchDividendLedgerYears).mockResolvedValue([2026]);
    vi.mocked(fetchShellPortfolioConfig).mockResolvedValue({
      accounts: [{
        id: "acc-1",
        userId: "user-1",
        name: "Main",
        feeProfileId: "fee-1",
        defaultCurrency: "TWD",
        accountType: "broker",
      }],
      feeProfiles: [],
      feeProfileBindings: [],
      integrityIssue: null,
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("fetches only the active tab payload on first render", async () => {
    const dict = getDictionary("en");

    act(() => {
      root.render(
        <DividendsTabsClient
          initialTab="calendar"
          calendarLabel={dict.dividends.tabs.calendar}
          ledgerLabel={dict.dividends.tabs.review}
          dict={dict}
          locale="en"
          accounts={[]}
          initialCalendarMonth="2026-07"
          initialCalendarSnapshot={{ events: [], ledgerEntries: [] }}
          initialReviewData={null}
          initialYears={[]}
        />,
      );
    });

    await act(async () => {});

    expect(fetchDividendCalendarSnapshot).not.toHaveBeenCalled();
    expect(fetchDividendLedgerReview).not.toHaveBeenCalled();
  });

  it("mounts the ledger client with a null seed so it owns the primary fetch", async () => {
    const dict = getDictionary("en");

    window.history.replaceState(null, "", "/dividends?view=ledger");

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
    await act(async () => {});

    expect(fetchDividendLedgerReview).not.toHaveBeenCalled();
    expect(fetchDividendLedgerYears).not.toHaveBeenCalled();
    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="mock-review-client"]')?.getAttribute("data-accounts-count")).toBe("0");
    expect(fetchDividendCalendarSnapshot).not.toHaveBeenCalled();
  });

  it("loads the requested initial calendar month when the snapshot is missing", async () => {
    const dict = getDictionary("en");

    act(() => {
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
          initialReviewData={null}
          initialYears={[]}
        />,
      );
    });

    await act(async () => {});
    await act(async () => {});

    expect(fetchDividendCalendarSnapshot).toHaveBeenCalledWith({
      fromPaymentDate: "2026-07-01",
      toPaymentDate: "2026-07-31",
      limit: 500,
    });
    expect(fetchDividendLedgerReview).not.toHaveBeenCalled();
  });
});
