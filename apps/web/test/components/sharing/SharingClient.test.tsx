import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SharingClient } from "../../../components/sharing/SharingClient";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { deriveSharedContextPermissions } from "../../../features/sharing/capabilities";
import { getDictionary } from "../../../lib/i18n";

const replaceMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: replaceMock,
    refresh: refreshMock,
  }),
  useSearchParams: () => new URLSearchParams(""),
}));

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

function buildShellData(capabilities: AppShellData["currentSharedCapabilities"]): AppShellData {
  return {
    uiDict: getDictionary("en"),
    locale: "en",
    sessionUserId: "viewer-1",
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

describe("SharingClient", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    replaceMock.mockReset();
    refreshMock.mockReset();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows a permission-required state in shared context without sharing:manage", async () => {
    await act(async () => {
      root.render(
        <AppShellDataProvider value={buildShellData([])}>
          <SharingClient locale="en" isDemo={false} role="viewer" />
        </AppShellDataProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='sharing-permission-required']")?.textContent).toContain(
      "Permission required",
    );
    expect(container.querySelector("[data-testid='sharing-tab-anonymous']")).toBeNull();
    expect(container.querySelector("[data-testid='sharing-grant-button']")).toBeNull();
  });
});
