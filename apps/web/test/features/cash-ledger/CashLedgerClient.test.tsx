import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CashLedgerClient } from "../../../features/cash-ledger/components/CashLedgerClient";
import { AppShellDataProvider } from "../../../components/layout/AppShellDataContext";
import { getDictionary } from "../../../lib/i18n";
import type {
  CashLedgerListResponse,
  EnrichedCashLedgerEntry,
} from "../../../features/cash-ledger/types";

const { mockUseEventStream } = vi.hoisted(() => ({
  mockUseEventStream: vi.fn(),
}));

vi.mock("../../../features/cash-ledger/services/cashLedgerService", () => ({
  fetchCashLedgerEntries: vi.fn(),
  fetchAccounts: vi.fn().mockResolvedValue([]),
  // KZO-179: cashLedgerService now exports createAccount (used by the
  // settings drawer's Accounts tab). CashLedgerClient does NOT call it,
  // but vitest's mock factory must enumerate every export consumed by any
  // file in the test's module graph — see
  // `.claude/rules/implementer-qa-test-ownership.md`.
  createAccount: vi.fn(),
}));

vi.mock("../../../hooks/useEventStream", () => ({
  useEventStream: mockUseEventStream,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

import {
  fetchAccounts,
  fetchCashLedgerEntries,
} from "../../../features/cash-ledger/services/cashLedgerService";
import type { AccountWithLiveBalance } from "../../../features/cash-ledger/services/cashLedgerService";

const mockFetch = vi.mocked(fetchCashLedgerEntries);
const mockFetchAccounts = vi.mocked(fetchAccounts);

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

function buildEntry(overrides: Partial<EnrichedCashLedgerEntry> = {}): EnrichedCashLedgerEntry {
  return {
    id: overrides.id ?? "entry-1",
    userId: overrides.userId ?? "user-1",
    accountId: overrides.accountId ?? "acc-1",
    entryDate: overrides.entryDate ?? "2026-04-10",
    entryType: overrides.entryType ?? "TRADE_SETTLEMENT_IN",
    amount: overrides.amount ?? 1000,
    currency: overrides.currency ?? "TWD",
    source: overrides.source ?? "trade",
    ticker: overrides.ticker ?? "2330",
    side: overrides.side ?? "BUY",
    ...overrides,
  };
}

function buildResponse(total: number, count: number): CashLedgerListResponse {
  const entries: EnrichedCashLedgerEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(buildEntry({ id: `entry-${i + 1}` }));
  }
  return { entries, summary: [], total };
}

async function renderCashLedgerClient(
  root: Root,
  props: {
    initialData: CashLedgerListResponse | null;
    initialDataReady?: boolean;
    initialAccounts?: AccountWithLiveBalance[];
    initialAccountMetaReady?: boolean;
    locale?: "en";
  },
) {
  await act(async () => {
    root.render(
      <CashLedgerClient
        initialData={props.initialData}
        initialDataReady={props.initialDataReady}
        initialAccounts={props.initialAccounts}
        initialAccountMetaReady={props.initialAccountMetaReady}
        dict={dict}
        locale={props.locale ?? "en"}
      />,
    );
    await Promise.resolve();
  });
}

describe("CashLedgerClient pagination", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    mockFetch.mockReset();
    mockFetchAccounts.mockReset();
    mockFetchAccounts.mockResolvedValue([]);
    mockUseEventStream.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renders pagination when total exceeds PAGE_SIZE", async () => {
    const data = buildResponse(100, 50);
    await renderCashLedgerClient(root, { initialData: data });

    const pagination = container.querySelector('[data-testid="pagination"]');
    expect(pagination).toBeTruthy();
    expect(pagination!.textContent).toContain("Page");
    expect(pagination!.textContent).toContain("1");
    expect(pagination!.textContent).toContain("of");
    expect(pagination!.textContent).toContain("2");
  });

  it("does not render pagination when total fits in one page", async () => {
    const data = buildResponse(10, 10);
    await renderCashLedgerClient(root, { initialData: data });

    const pagination = container.querySelector('[data-testid="pagination"]');
    expect(pagination).toBeNull();
  });

  it("shows FX enablement instead of the transfer action for a single configured currency", async () => {
    await act(async () => {
      root.render(
        <AppShellDataProvider
          value={{
            portfolioCapabilities: {
              configuredMarkets: ["TW"],
              configuredCurrencies: ["TWD"],
            },
            isPortfolioConfigLoading: false,
            sharedContextPermissions: { canManageAccounts: true },
          } as never}
        >
          <CashLedgerClient
            initialData={buildResponse(0, 0)}
            initialAccounts={[]}
            initialAccountMetaReady
            dict={dict}
            locale="en"
          />
        </AppShellDataProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="fx-transfer-enablement"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="new-fx-transfer-button"]')).toBeNull();
  });

  it("refreshes account metadata when an account lifecycle event arrives", async () => {
    await renderCashLedgerClient(root, { initialData: buildResponse(0, 0) });
    expect(mockFetchAccounts).toHaveBeenCalledTimes(1);

    const streamOptions = mockUseEventStream.mock.calls[0]?.[0] as {
      eventTypes: string[];
      onEvent: () => void;
    };
    expect(streamOptions.eventTypes).toEqual(expect.arrayContaining([
      "account_created",
      "account_updated",
      "account_soft_deleted",
      "account_restored",
      "account_hard_purged",
    ]));

    await act(async () => {
      streamOptions.onEvent();
      await Promise.resolve();
    });

    expect(mockFetchAccounts).toHaveBeenCalledTimes(2);
  });

  it("disables prev button on page 1", async () => {
    const data = buildResponse(100, 50);
    await renderCashLedgerClient(root, { initialData: data });

    const prevBtn = container.querySelector('[data-testid="pagination-prev"]') as HTMLButtonElement;
    expect(prevBtn).toBeTruthy();
    expect(prevBtn.disabled).toBe(true);
  });

  it("enables next button when not on last page", async () => {
    const data = buildResponse(100, 50);
    await renderCashLedgerClient(root, { initialData: data });

    const nextBtn = container.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement;
    expect(nextBtn).toBeTruthy();
    expect(nextBtn.disabled).toBe(false);
  });

  it("calls service with page when next is clicked", async () => {
    mockFetch.mockResolvedValue(buildResponse(100, 50));
    const data = buildResponse(100, 50);
    await renderCashLedgerClient(root, { initialData: data });

    const nextBtn = container.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement;
    await act(async () => nextBtn.click());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ page: 2 }),
    );
  });

  it("renders sortable column headers with sort indicators", async () => {
    const data = buildResponse(5, 5);
    await renderCashLedgerClient(root, { initialData: data });

    // entryDate is the default sort column
    const headers = container.querySelectorAll("th");
    const dateHeader = Array.from(headers).find((th) => th.textContent?.includes("Date"));
    expect(dateHeader).toBeTruthy();
    // Default sort is entryDate desc, so it should show the down indicator
    expect(dateHeader!.textContent).toContain("\u2193");
  });

  it("toggles sort direction on clicking active column header", async () => {
    mockFetch.mockResolvedValue(buildResponse(5, 5));
    const data = buildResponse(5, 5);
    await renderCashLedgerClient(root, { initialData: data });

    // Click the Date header (already active with desc) to toggle to asc
    const headers = container.querySelectorAll("th");
    const dateHeader = Array.from(headers).find((th) => th.textContent?.includes("Date"));
    await act(async () => dateHeader!.click());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "entryDate", sortOrder: "asc" }),
    );
  });

  it("sets new column and desc when clicking a different column header", async () => {
    mockFetch.mockResolvedValue(buildResponse(5, 5));
    const data = buildResponse(5, 5);
    await renderCashLedgerClient(root, { initialData: data });

    // Click the Amount header (not active)
    const headers = container.querySelectorAll("th");
    const amountHeader = Array.from(headers).find((th) => th.textContent?.includes("Amount"));
    await act(async () => amountHeader!.click());

    expect(mockFetch).toHaveBeenCalledWith(
      expect.objectContaining({ sortBy: "amount", sortOrder: "desc" }),
    );
  });

  it("resets page to 1 when filter changes trigger refresh", async () => {
    mockFetch.mockResolvedValue(buildResponse(100, 50));
    const data = buildResponse(100, 50);
    await renderCashLedgerClient(root, { initialData: data });

    // Navigate to page 2 first
    const nextBtn = container.querySelector('[data-testid="pagination-next"]') as HTMLButtonElement;
    await act(async () => nextBtn.click());

    // Toggle an entry-type chip — triggers fetch immediately with page reset to 1
    const chip = Array.from(container.querySelectorAll<HTMLButtonElement>('[data-testid="cash-ledger-filter-toolbar"] button'))
      .find((b) => b.textContent?.includes("Reversal"));
    await act(async () => chip!.click());

    // The most recent call should have page: 1
    const lastCall = mockFetch.mock.calls[mockFetch.mock.calls.length - 1]![0];
    expect(lastCall).toEqual(expect.objectContaining({ page: 1 }));
  });

  it("replaces account ids with display labels after account metadata loads without flashing the raw id", async () => {
    let resolveAccounts: ((value: AccountWithLiveBalance[]) => void) | null = null;
    mockFetchAccounts.mockReturnValue(
      new Promise((resolve) => {
        resolveAccounts = resolve;
      }),
    );

    const accountId = "550e8400-e29b-41d4-a716-446655440000";
    const data: CashLedgerListResponse = {
      entries: [buildEntry({ accountId })],
      summary: [{ accountId, currency: "TWD", amount: 1000 }],
      total: 1,
    };

    await renderCashLedgerClient(root, { initialData: data });

    expect(container.textContent).toContain("Loading account...");
    expect(container.textContent).not.toContain(accountId);

    await act(async () => {
      resolveAccounts?.([
        {
          id: accountId,
          userId: "user-1",
          name: "Shared Brokerage",
          defaultCurrency: "TWD",
          accountType: "broker",
          feeProfileId: "fp-1",
        },
      ]);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Shared Brokerage (TWD · Broker)");
    expect(container.textContent).not.toContain(accountId);
  });

  it("renders seeded account labels on first paint when the server passes account metadata", async () => {
    mockFetchAccounts.mockReturnValue(new Promise(() => undefined));
    const accountId = "seeded-account";
    const data: CashLedgerListResponse = {
      entries: [buildEntry({ accountId })],
      summary: [{ accountId, currency: "TWD", amount: 1000 }],
      total: 1,
    };

    await renderCashLedgerClient(root, {
      initialData: data,
      initialAccounts: [
        {
          id: accountId,
          userId: "user-1",
          name: "Seeded Brokerage",
          defaultCurrency: "TWD",
          accountType: "broker",
          feeProfileId: "fp-1",
        },
      ],
      initialAccountMetaReady: true,
    });

    expect(container.textContent).toContain("Seeded Brokerage (TWD · Broker)");
    expect(container.textContent).not.toContain("Loading account...");
    expect(container.textContent).not.toContain(accountId);
  });

  it("fetches the initial ledger page on the client when server data is deferred", async () => {
    let resolveLedger: ((value: CashLedgerListResponse) => void) | null = null;
    mockFetch.mockReturnValue(
      new Promise((resolve) => {
        resolveLedger = resolve;
      }),
    );

    await renderCashLedgerClient(root, {
      initialData: null,
      initialDataReady: false,
    });

    expect(container.querySelector('[data-testid="cash-ledger-loading"]')).toBeTruthy();

    await act(async () => {
      await Promise.resolve();
    });

    expect(mockFetch).toHaveBeenCalledWith(expect.objectContaining({
      limit: 50,
      page: 1,
      sortBy: "entryDate",
      sortOrder: "desc",
    }));

    await act(async () => {
      resolveLedger?.(buildResponse(2, 2));
      await Promise.resolve();
    });

    expect(container.querySelector('[data-testid="cash-ledger-table"]')).toBeTruthy();
  });
});
