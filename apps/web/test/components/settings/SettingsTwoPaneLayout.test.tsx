import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SettingsTwoPaneLayout } from "../../../components/settings/SettingsTwoPaneLayout";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { deriveSharedContextPermissions } from "../../../features/sharing/capabilities";
import { getDictionary } from "../../../lib/i18n";

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildShellData(isSharedContext: boolean, capabilities: AppShellData["currentSharedCapabilities"]): AppShellData {
  return {
    uiDict: getDictionary("en"),
    locale: "en",
    sessionUserId: "viewer-1",
    sessionUserRole: "viewer",
    routeCachePolicy: null,
    isSharedContext,
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
    transactionSubmission: {} as never,
    mutations: {} as never,
    recomputeAction: {} as never,
    openRecomputeConfirm: vi.fn(),
    transactionAccountOptions: [],
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    refreshPortfolioConfig: vi.fn(),
    isPortfolioConfigLoading: false,
    integrityIssue: null,
    showIntegrityDialog: false,
    setShowIntegrityDialog: vi.fn(),
    generateSnapshots: vi.fn(),
    isGeneratingSnapshots: false,
    contextRefreshSignal: 0,
  };
}

describe("SettingsTwoPaneLayout", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("renames accounts to portfolio settings in shared context with account access", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData(true, ["account:manage"])}>
          <SettingsTwoPaneLayout dict={getDictionary("en")}>
            <div>content</div>
          </SettingsTwoPaneLayout>
        </AppShellDataProvider>,
      );
    });

    expect(container.querySelector("[data-testid='settings-nav-item-accounts']")?.textContent).toContain(
      "Portfolio settings",
    );
  });

  it("hides the accounts entry in shared context without account:manage", () => {
    act(() => {
      root.render(
        <AppShellDataProvider value={buildShellData(true, [])}>
          <SettingsTwoPaneLayout dict={getDictionary("en")}>
            <div>content</div>
          </SettingsTwoPaneLayout>
        </AppShellDataProvider>,
      );
    });

    expect(container.querySelector("[data-testid='settings-nav-item-accounts']")).toBeNull();
  });
});
