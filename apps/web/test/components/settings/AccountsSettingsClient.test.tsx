import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type {
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
} from "@vakwen/shared-types";

const navigationMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(""),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigationMock.searchParams,
  useRouter: () => ({ replace: navigationMock.replace }),
}));

vi.mock("../../../components/layout/AppShellDataContext", () => ({
  useAppShellData: vi.fn(),
}));

vi.mock("../../../components/settings/SettingsRouteProvider", () => ({
  useSettingsRouteContext: vi.fn(),
}));

vi.mock("../../../features/settings/mappers/settingsMappers", () => ({
  toSettingsFormModel: vi.fn(() => ({
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
  })),
}));

const accountCreateFormPropsMock = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}));

const accountsListSectionPropsMock = vi.hoisted(() => ({
  current: null as null | Record<string, unknown>,
}));

vi.mock("../../../features/settings/components/AccountCreateForm", () => ({
  AccountCreateForm: (props: Record<string, unknown>) => {
    accountCreateFormPropsMock.current = props;
    return <div data-testid="account-create-form" />;
  },
}));

vi.mock("../../../features/settings/components/AccountsListSection", () => ({
  AccountsListSection: (props: Record<string, unknown>) => {
    accountsListSectionPropsMock.current = props;
    return <div data-testid="accounts-list-section" />;
  },
}));

import { useAppShellData } from "../../../components/layout/AppShellDataContext";
import { useSettingsRouteContext } from "../../../components/settings/SettingsRouteProvider";
import { AccountsSettingsClient } from "../../../components/settings/AccountsSettingsClient";
import { getDictionary } from "../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

const dict = getDictionary("en");

const mutationResponse: AccountMutationResponseDto = {
  id: "acc-2",
  name: "USD Wallet",
  userId: "user-1",
  feeProfileId: "fp-2",
  defaultCurrency: "USD",
  accountType: "wallet",
  account: {
    id: "acc-2",
    name: "USD Wallet",
    userId: "user-1",
    feeProfileId: "fp-2",
    defaultCurrency: "USD",
    accountType: "wallet",
  },
  feeProfile: {
    id: "fp-2",
    accountId: "acc-2",
    name: "USD Default",
    boardCommissionRate: 1.425,
    commissionDiscountPercent: 0,
    minimumCommissionAmount: 20,
    commissionCurrency: "USD",
    commissionRoundingMode: "FLOOR",
    taxRoundingMode: "FLOOR",
    stockSellTaxRateBps: 30,
    stockDayTradeTaxRateBps: 15,
    etfSellTaxRateBps: 10,
    bondEtfSellTaxRateBps: 0,
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

describe("AccountsSettingsClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    vi.mocked(useSettingsRouteContext).mockReturnValue({
      isDemo: false,
      locale: "en",
      profile: null as never,
      initialSidebarOpen: true,
      initialSettings: { locale: "en" } as never,
      setLocale: vi.fn(),
    });
    accountCreateFormPropsMock.current = null;
    accountsListSectionPropsMock.current = null;
    navigationMock.searchParams = new URLSearchParams("");
    navigationMock.replace.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.clearAllMocks();
  });

  it("shows first-account onboarding inline when there are no configured accounts", () => {
    vi.mocked(useAppShellData).mockReturnValue({
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      refreshPortfolioConfig: vi.fn(),
      applyAccountMutationResponse: vi.fn(),
      isPortfolioConfigLoading: false,
      isSharedContext: false,
      sharedContextPermissions: { canManageAccounts: true },
      uiDict: dict,
    } as never);

    act(() => {
      root.render(<AccountsSettingsClient />);
    });

    expect(container.querySelector('[data-testid="account-create-form"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="accounts-add-account-trigger"]')).toBeNull();
    expect(container.textContent).toContain(dict.settings.accountsZeroStateTitle);
  });

  it("recovers from missing initial settings without changing hook order", () => {
    vi.mocked(useAppShellData).mockReturnValue({
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      refreshPortfolioConfig: vi.fn(),
      applyAccountMutationResponse: vi.fn(),
      isPortfolioConfigLoading: false,
      isSharedContext: false,
      sharedContextPermissions: { canManageAccounts: true },
      uiDict: dict,
    } as never);
    vi.mocked(useSettingsRouteContext).mockReturnValue({
      isDemo: false,
      locale: "en",
      profile: null as never,
      initialSidebarOpen: true,
      initialSettings: null,
      setLocale: vi.fn(),
    });

    act(() => {
      root.render(<AccountsSettingsClient />);
    });
    expect(container.textContent).toContain(dict.feedback.loadingSettings);

    vi.mocked(useSettingsRouteContext).mockReturnValue({
      isDemo: false,
      locale: "en",
      profile: null as never,
      initialSidebarOpen: true,
      initialSettings: { locale: "en" } as never,
      setLocale: vi.fn(),
    });

    expect(() => {
      act(() => {
        root.render(<AccountsSettingsClient />);
      });
    }).not.toThrow();
    expect(container.querySelector('[data-testid="account-create-form"]')).not.toBeNull();
  });

  it("shows the account list first and opens add-account flow on demand when accounts already exist", async () => {
    vi.mocked(useAppShellData).mockReturnValue({
      accounts: [{
        id: "acc-1",
        name: "Main",
        userId: "user-1",
        feeProfileId: "fp-1",
        defaultCurrency: "TWD",
        accountType: "broker",
      }],
      feeProfiles: [],
      feeProfileBindings: [],
      refreshPortfolioConfig: vi.fn(),
      applyAccountMutationResponse: vi.fn(),
      isPortfolioConfigLoading: false,
      isSharedContext: false,
      sharedContextPermissions: { canManageAccounts: true },
      uiDict: dict,
    } as never);

    act(() => {
      root.render(<AccountsSettingsClient />);
    });

    expect(container.querySelector('[data-testid="accounts-add-account-trigger"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="account-create-form"]')).toBeNull();

    const trigger = container.querySelector('[data-testid="accounts-add-account-trigger"]') as HTMLButtonElement;
    await act(async () => trigger.click());

    expect(document.querySelector('[data-testid="account-create-form"]')).not.toBeNull();
  });

  it("applies authoritative create mutations locally without a full refresh", async () => {
    const refreshPortfolioConfig = vi.fn();
    const applyAccountMutationResponse = vi.fn();

    vi.mocked(useAppShellData).mockReturnValue({
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      refreshPortfolioConfig,
      applyAccountMutationResponse,
      isPortfolioConfigLoading: false,
      isSharedContext: false,
      sharedContextPermissions: { canManageAccounts: true },
      uiDict: dict,
    } as never);

    act(() => {
      root.render(<AccountsSettingsClient />);
    });

    const onAccountsRefresh = accountCreateFormPropsMock.current?.onAccountsRefresh as ((response?: AccountMutationResponseDto) => Promise<void>) | undefined;
    expect(onAccountsRefresh).toBeTypeOf("function");

    await act(async () => {
      await onAccountsRefresh?.(mutationResponse);
    });

    expect(applyAccountMutationResponse).toHaveBeenCalledWith(mutationResponse);
    expect(refreshPortfolioConfig).not.toHaveBeenCalled();
  });

  it("returns zero-account onboarding to a validated initiating route after creation", async () => {
    navigationMock.searchParams = new URLSearchParams("returnTo=%2Fdividends%3Fmonth%3D2026-07");
    vi.mocked(useAppShellData).mockReturnValue({
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      refreshPortfolioConfig: vi.fn(),
      applyAccountMutationResponse: vi.fn(),
      isPortfolioConfigLoading: false,
      isSharedContext: false,
      sharedContextPermissions: { canManageAccounts: true },
      uiDict: dict,
    } as never);

    act(() => {
      root.render(<AccountsSettingsClient />);
    });
    const onAccountsRefresh = accountCreateFormPropsMock.current
      ?.onAccountsRefresh as ((response?: AccountMutationResponseDto) => Promise<void>);

    await act(async () => {
      await onAccountsRefresh(mutationResponse);
    });

    expect(navigationMock.replace).toHaveBeenCalledWith("/dividends?month=2026-07");
  });

  it("threads authoritative lifecycle responses into the shell without a full refresh", async () => {
    const refreshPortfolioConfig = vi.fn();
    const applyAccountLifecycleMutationResponse = vi.fn();
    vi.mocked(useAppShellData).mockReturnValue({
      accounts: [mutationResponse.account],
      feeProfiles: [mutationResponse.feeProfile],
      feeProfileBindings: [],
      refreshPortfolioConfig,
      applyAccountMutationResponse: vi.fn(),
      applyAccountLifecycleMutationResponse,
      isPortfolioConfigLoading: false,
      isSharedContext: false,
      sharedContextPermissions: { canManageAccounts: true },
      uiDict: dict,
    } as never);
    act(() => {
      root.render(<AccountsSettingsClient />);
    });
    const response: AccountLifecycleMutationResponseDto = {
      accountId: mutationResponse.account.id,
      account: mutationResponse.account,
      deletedAt: "2026-07-26T00:00:00.000Z",
      finalName: null,
      capabilities: { configuredMarkets: [], configuredCurrencies: [] },
      reportingCurrency: {
        requested: "USD",
        effective: null,
        reason: "no_configured_currencies",
      },
    };
    const onLifecycleMutation = accountsListSectionPropsMock.current
      ?.onLifecycleMutation as ((value: AccountLifecycleMutationResponseDto, operation: "soft_delete") => void);

    act(() => onLifecycleMutation(response, "soft_delete"));

    expect(applyAccountLifecycleMutationResponse).toHaveBeenCalledWith(
      response,
      "soft_delete",
    );
    expect(refreshPortfolioConfig).not.toHaveBeenCalled();
  });
});
