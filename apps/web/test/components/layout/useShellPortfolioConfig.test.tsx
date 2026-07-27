import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
} from "@vakwen/shared-types";
import { useShellPortfolioConfig } from "../../../components/layout/useShellPortfolioConfig";
import type {
  ShellPortfolioConfigDto,
  ShellPortfolioConfigSeedDto,
} from "../../../features/settings/services/shellPortfolioConfigService";
import type { TransactionInput } from "../../../components/portfolio/types";

vi.mock("../../../features/settings/services/shellPortfolioConfigService", () => ({
  fetchShellPortfolioConfig: vi.fn(),
}));

import { fetchShellPortfolioConfig } from "../../../features/settings/services/shellPortfolioConfigService";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const initialTransaction: TransactionInput = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: "2026-06-02",
  type: "BUY",
  isDayTrade: false,
};

const loadedConfig: ShellPortfolioConfigDto = {
  accounts: [{
    id: "account-1",
    name: "Brokerage",
    userId: "user-1",
    feeProfileId: "fee-1",
    defaultCurrency: "TWD",
    accountType: "broker",
  }],
  feeProfiles: [{
    id: "fee-1",
    accountId: "account-1",
    name: "Standard",
    boardCommissionRate: 0.001425,
    commissionDiscountPercent: 60,
    minimumCommissionAmount: 20,
    commissionCurrency: "TWD",
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 10,
    commissionChargeMode: "CHARGED_UPFRONT",
  }],
  feeProfileBindings: [],
  integrityIssue: null,
  capabilities: {
    configuredMarkets: ["TW"],
    configuredCurrencies: ["TWD"],
  },
};

const accountMutationResponse: AccountMutationResponseDto = {
  id: "account-2",
  name: "USD Wallet",
  userId: "user-1",
  feeProfileId: "fee-2",
  defaultCurrency: "USD",
  accountType: "wallet",
  account: {
    id: "account-2",
    name: "USD Wallet",
    userId: "user-1",
    feeProfileId: "fee-2",
    defaultCurrency: "USD",
    accountType: "wallet",
  },
  feeProfile: {
    id: "fee-2",
    accountId: "account-2",
    name: "USD Default",
    boardCommissionRate: 0.001425,
    commissionDiscountPercent: 50,
    minimumCommissionAmount: 20,
    commissionCurrency: "USD",
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 10,
    commissionChargeMode: "CHARGED_UPFRONT",
  },
  capabilities: {
    configuredMarkets: ["TW", "US"],
    configuredCurrencies: ["TWD", "USD"],
  },
  reportingCurrency: {
    requested: "USD",
    effective: "USD",
    reason: null,
  },
  changedFields: ["name", "accountType", "feeProfileId"],
};

const lifecycleResponse: AccountLifecycleMutationResponseDto = {
  accountId: "account-1",
  account: loadedConfig.accounts[0]!,
  deletedAt: "2026-07-26T00:00:00.000Z",
  finalName: null,
  capabilities: {
    configuredMarkets: [],
    configuredCurrencies: [],
  },
  reportingCurrency: {
    requested: "TWD",
    effective: null,
    reason: "no_configured_currencies",
  },
};

let result: ReturnType<typeof useShellPortfolioConfig>;

function Harness({
  fetchMode = "lazy",
  initialConfig = null,
}: {
  fetchMode?: "eager" | "lazy";
  initialConfig?: ShellPortfolioConfigSeedDto | null;
}) {
  result = useShellPortfolioConfig({
    initialTransaction,
    initialConfig,
    fetchMode,
  });
  return null;
}

describe("useShellPortfolioConfig", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(fetchShellPortfolioConfig).mockResolvedValue(loadedConfig);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.mocked(fetchShellPortfolioConfig).mockReset();
  });

  it("defers lazy shell config until config-dependent actions request it", async () => {
    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    await act(async () => {});

    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
    expect(result.accounts).toEqual([]);
    expect(result.capabilities).toBeUndefined();
    expect(result.isLoading).toBe(false);

    await act(async () => {
      await result.ensureLoaded();
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts).toEqual(loadedConfig.accounts);
    expect(result.feeProfiles).toEqual(loadedConfig.feeProfiles);
    expect(result.capabilities).toEqual(loadedConfig.capabilities);
    expect(result.isLoading).toBe(false);
  });

  it("loads missing capabilities when a lazy initial config is incomplete", async () => {
    const partialConfig: ShellPortfolioConfigSeedDto = {
      ...loadedConfig,
      capabilities: undefined,
    };
    act(() => {
      root.render(<Harness fetchMode="lazy" initialConfig={partialConfig} />);
    });

    await act(async () => {});

    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
    expect(result.accounts).toEqual(loadedConfig.accounts);
    expect(result.capabilities).toBeUndefined();

    await act(async () => {
      await result.ensureLoaded();
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.capabilities).toEqual(loadedConfig.capabilities);
  });

  it("loads missing capabilities immediately when an eager initial config is incomplete", async () => {
    const partialConfig: ShellPortfolioConfigSeedDto = {
      ...loadedConfig,
      capabilities: undefined,
    };
    act(() => {
      root.render(<Harness fetchMode="eager" initialConfig={partialConfig} />);
    });

    await act(async () => {});

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts).toEqual(loadedConfig.accounts);
    expect(result.capabilities).toEqual(loadedConfig.capabilities);
    expect(result.isLoading).toBe(false);
  });

  it("does not refetch a complete server-seeded config", async () => {
    act(() => {
      root.render(<Harness fetchMode="eager" initialConfig={loadedConfig} />);
    });

    await act(async () => {
      await result.ensureLoaded();
    });

    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
    expect(result.capabilities).toEqual(loadedConfig.capabilities);
  });

  it("deduplicates concurrent lazy config loads", async () => {
    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    await act(async () => {
      await Promise.all([result.ensureLoaded(), result.ensureLoaded()]);
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts[0]?.id).toBe("account-1");
  });

  it("discards an older refresh result that completes after a newer request", async () => {
    let resolveOlder!: (value: ShellPortfolioConfigDto) => void;
    let resolveNewer!: (value: ShellPortfolioConfigDto) => void;
    const olderPromise = new Promise<ShellPortfolioConfigDto>((resolve) => {
      resolveOlder = resolve;
    });
    const newerPromise = new Promise<ShellPortfolioConfigDto>((resolve) => {
      resolveNewer = resolve;
    });
    const newerConfig: ShellPortfolioConfigDto = {
      ...loadedConfig,
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
    };
    vi.mocked(fetchShellPortfolioConfig)
      .mockImplementationOnce(() => olderPromise)
      .mockImplementationOnce(() => newerPromise);

    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    let olderRefresh!: Promise<ShellPortfolioConfigDto>;
    let newerRefresh!: Promise<ShellPortfolioConfigDto>;
    act(() => {
      olderRefresh = result.refresh();
      newerRefresh = result.refresh();
    });

    await act(async () => {
      resolveNewer(newerConfig);
      await newerRefresh;
    });
    expect(result.capabilities).toEqual(newerConfig.capabilities);

    await act(async () => {
      resolveOlder(loadedConfig);
      await olderRefresh;
    });
    expect(result.capabilities).toEqual(newerConfig.capabilities);
    expect(result.isLoading).toBe(false);
  });

  it("applies authoritative account mutation responses without a follow-up fetch", async () => {
    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    await act(async () => {
      result.applyAccountMutation(accountMutationResponse);
    });

    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
    expect(result.accounts).toEqual([accountMutationResponse.account]);
    expect(result.capabilities).toEqual(accountMutationResponse.capabilities);
    expect(result.feeProfiles).toEqual([accountMutationResponse.feeProfile]);

    await act(async () => {
      await result.ensureLoaded();
    });
    expect(fetchShellPortfolioConfig).not.toHaveBeenCalled();
  });

  it("keeps authoritative mutation state when an older config read finishes later", async () => {
    let resolveAccountRead!: (value: ShellPortfolioConfigDto) => void;
    let resolveLifecycleRead!: (value: ShellPortfolioConfigDto) => void;
    vi.mocked(fetchShellPortfolioConfig)
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAccountRead = resolve;
      }))
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveLifecycleRead = resolve;
      }));

    act(() => {
      root.render(<Harness fetchMode="lazy" />);
    });

    let accountRefresh!: Promise<ShellPortfolioConfigDto>;
    act(() => {
      accountRefresh = result.refresh();
    });
    await act(async () => {
      result.applyAccountMutation(accountMutationResponse);
    });
    expect(result.accounts).toEqual([accountMutationResponse.account]);
    expect(result.isLoading).toBe(false);

    await act(async () => {
      resolveAccountRead(loadedConfig);
      await accountRefresh;
    });
    expect(result.accounts).toEqual([accountMutationResponse.account]);
    expect(result.capabilities).toEqual(accountMutationResponse.capabilities);

    let lifecycleRefresh!: Promise<ShellPortfolioConfigDto>;
    act(() => {
      lifecycleRefresh = result.refresh();
    });
    await act(async () => {
      result.applyAccountLifecycleMutation(
        {
          ...lifecycleResponse,
          accountId: accountMutationResponse.account.id,
          account: accountMutationResponse.account,
        },
        "soft_delete",
      );
    });
    expect(result.accounts).toEqual([]);
    expect(result.isLoading).toBe(false);

    await act(async () => {
      resolveLifecycleRead({
        ...loadedConfig,
        accounts: [accountMutationResponse.account],
        feeProfiles: [accountMutationResponse.feeProfile],
        capabilities: accountMutationResponse.capabilities,
      });
      await lifecycleRefresh;
    });
    expect(result.accounts).toEqual([]);
    expect(result.capabilities).toEqual(lifecycleResponse.capabilities);
  });

  it("applies lifecycle capability deltas without a follow-up fetch", async () => {
    act(() => {
      root.render(<Harness fetchMode="eager" />);
    });
    await act(async () => {});

    await act(async () => {
      result.applyAccountLifecycleMutation(lifecycleResponse, "soft_delete");
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts).toEqual([]);
    expect(result.capabilities).toEqual(lifecycleResponse.capabilities);

    await act(async () => {
      result.applyAccountLifecycleMutation(
        { ...lifecycleResponse, finalName: "Brokerage restored" },
        "restore",
      );
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts).toEqual([lifecycleResponse.account]);
  });

  it("restores the account fee configuration when the page loaded after deletion", async () => {
    vi.mocked(fetchShellPortfolioConfig).mockResolvedValue({
      ...loadedConfig,
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
    });
    act(() => {
      root.render(<Harness fetchMode="eager" />);
    });
    await act(async () => {});

    await act(async () => {
      result.applyAccountLifecycleMutation({
        ...lifecycleResponse,
        deletedAt: null,
        finalName: "Brokerage",
        capabilities: loadedConfig.capabilities!,
        feeProfiles: loadedConfig.feeProfiles,
        feeProfileBindings: [{
          accountId: "account-1",
          ticker: "2330",
          feeProfileId: "fee-1",
        }],
      }, "restore");
    });

    expect(fetchShellPortfolioConfig).toHaveBeenCalledTimes(1);
    expect(result.accounts).toEqual(loadedConfig.accounts);
    expect(result.feeProfiles).toEqual(loadedConfig.feeProfiles);
    expect(result.feeProfileBindings).toEqual([{
      accountId: "account-1",
      ticker: "2330",
      feeProfileId: "fee-1",
    }]);
  });
});
