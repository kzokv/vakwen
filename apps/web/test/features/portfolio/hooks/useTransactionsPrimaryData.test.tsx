import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TransactionPrimaryDto } from "@vakwen/shared-types";
import { useTransactionsPrimaryData } from "../../../../features/portfolio/hooks/useTransactionsPrimaryData";
import { buildRouteDtoCacheKey, writeRouteDtoCache } from "../../../../lib/routeDtoCache";

vi.mock("../../../../features/portfolio/services/portfolioService", () => ({
  fetchTransactionsPrimaryData: vi.fn(),
}));

import { fetchTransactionsPrimaryData } from "../../../../features/portfolio/services/portfolioService";

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

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

let result: ReturnType<typeof useTransactionsPrimaryData>;

const initialPrimaryData: TransactionPrimaryDto = {
  recentTransactions: [],
  accountOptions: [],
  capabilities: {
    configuredMarkets: ["US"],
    configuredCurrencies: ["USD"],
  },
  portfolioConfig: {
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    integrityIssue: null,
  },
};

function withTransaction(id: string): TransactionPrimaryDto {
  return {
    ...initialPrimaryData,
    recentTransactions: [
      {
        id,
        accountId: "acc-1",
        accountName: "Main",
        ticker: "NVDA",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "USD",
        tradeDate: "2026-06-01",
        tradeTimestamp: "2026-06-01T00:00:00.000Z",
        bookingSequence: 1,
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        realizedPnlAmount: null,
        realizedPnlCurrency: null,
        feeProfileId: "fee-1",
        feeProfileName: "Default",
        bookedAt: "2026-06-01T00:00:00.000Z",
        feesSource: "CALCULATED",
      },
    ],
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function Harness({
  cacheScope = "self",
  initialData = null,
}: {
  cacheScope?: string;
  initialData?: TransactionPrimaryDto | null;
}) {
  result = useTransactionsPrimaryData(initialData, buildRouteDtoCacheKey("transactions-primary", cacheScope));
  return null;
}

describe("useTransactionsPrimaryData", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installStorageMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.mocked(fetchTransactionsPrimaryData).mockReset();
  });

  it("hydrates immediately from server-provided primary data", async () => {
    act(() => {
      root.render(<Harness initialData={withTransaction("initial")} />);
    });

    await act(async () => {});

    expect(result.data.recentTransactions[0]?.id).toBe("initial");
    expect(result.isBootstrapping).toBe(false);
    expect(vi.mocked(fetchTransactionsPrimaryData)).not.toHaveBeenCalled();
  });

  it("restores fresh cached transactions data without fetching again", async () => {
    writeRouteDtoCache(buildRouteDtoCacheKey("transactions-primary", "self"), withTransaction("cached"));

    act(() => {
      root.render(<Harness />);
    });

    expect(result.data.recentTransactions[0]?.id).toBe("cached");
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {});

    expect(fetchTransactionsPrimaryData).not.toHaveBeenCalled();
    expect(result.data.recentTransactions[0]?.id).toBe("cached");
  });

  it("restores stale cached transactions data before refreshing", async () => {
    vi.useFakeTimers();
    const now = new Date("2026-06-08T12:00:00.000Z");
    vi.setSystemTime(now);
    writeRouteDtoCache(buildRouteDtoCacheKey("transactions-primary", "self"), withTransaction("cached"), 1000);
    vi.setSystemTime(new Date(now.getTime() + 1500));
    vi.mocked(fetchTransactionsPrimaryData).mockResolvedValue(withTransaction("fresh"));

    act(() => {
      root.render(<Harness />);
    });

    expect(result.data.recentTransactions[0]?.id).toBe("cached");
    expect(result.restoredFromCache).toBe(true);

    await act(async () => {});

    expect(fetchTransactionsPrimaryData).toHaveBeenCalledTimes(1);
    expect(result.data.recentTransactions[0]?.id).toBe("fresh");
  });

  it("ignores stale primary responses after cache key changes", async () => {
    const staleRequest = createDeferred<TransactionPrimaryDto>();
    const ownerRequest = createDeferred<TransactionPrimaryDto>();
    vi.mocked(fetchTransactionsPrimaryData)
      .mockReturnValueOnce(staleRequest.promise)
      .mockReturnValueOnce(ownerRequest.promise);

    act(() => {
      root.render(<Harness />);
    });
    await act(async () => {});

    act(() => {
      root.render(<Harness cacheScope="owner-1" />);
    });
    await act(async () => {});

    await act(async () => {
      ownerRequest.resolve(withTransaction("owner-fresh"));
      await ownerRequest.promise;
    });

    expect(result.data.recentTransactions[0]?.id).toBe("owner-fresh");

    await act(async () => {
      staleRequest.resolve(withTransaction("stale-self"));
      await staleRequest.promise;
    });

    expect(result.data.recentTransactions[0]?.id).toBe("owner-fresh");
  });

  it("does not let an older primary request overwrite a fresh cache restore after cache key changes", async () => {
    const staleRequest = createDeferred<TransactionPrimaryDto>();
    vi.mocked(fetchTransactionsPrimaryData).mockReturnValue(staleRequest.promise);
    writeRouteDtoCache(buildRouteDtoCacheKey("transactions-primary", "owner-1"), withTransaction("owner-cached"));

    act(() => {
      root.render(<Harness />);
    });
    await act(async () => {});

    expect(fetchTransactionsPrimaryData).toHaveBeenCalledTimes(1);

    act(() => {
      root.render(<Harness cacheScope="owner-1" />);
    });
    await act(async () => {});

    expect(result.data.recentTransactions[0]?.id).toBe("owner-cached");
    expect(fetchTransactionsPrimaryData).toHaveBeenCalledTimes(1);

    await act(async () => {
      staleRequest.resolve(withTransaction("stale-self"));
      await staleRequest.promise;
    });

    expect(result.data.recentTransactions[0]?.id).toBe("owner-cached");
  });
});
