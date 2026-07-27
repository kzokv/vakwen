import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { UnrealizedPnlAnalysisClient } from "../../../components/analysis/UnrealizedPnlAnalysisClient";
import { AppShellDataProvider, type AppShellData } from "../../../components/layout/AppShellDataContext";
import { financeGainTextClass, financeLossTextClass } from "../../../components/holdings/holdingsStyle";
import { getDictionary } from "../../../lib/i18n";
import { formatCurrencyAmount } from "../../../lib/utils";
import { ANALYSIS_DEFAULT_STATE } from "../../../features/analysis/unrealizedPnlRouteState";
import { buildPreviewUnrealizedPnlAnalysis } from "../../../features/analysis/unrealizedPnlPreview";

const replaceMock = vi.hoisted(() => vi.fn());
const searchParamsState = vi.hoisted(() => ({ value: "" }));
const getJsonMock = vi.hoisted(() => vi.fn(async () => ({ preferences: {} })));
const patchJsonMock = vi.hoisted(() => vi.fn(async () => ({ preferences: {} })));
const originalMatchMedia = window.matchMedia;

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
  useSearchParams: () => new URLSearchParams(searchParamsState.value),
}));

vi.mock("../../../lib/hooks/use-reduced-motion", () => ({
  useReducedMotion: () => true,
}));

vi.mock("../../../lib/api", () => ({
  getJson: getJsonMock,
  patchJson: patchJsonMock,
}));

function buildShellData(
  locale: "en" | "zh-TW" = "en",
  overrides: Partial<AppShellData> = {},
): AppShellData {
  const dict = getDictionary(locale);
  return {
    uiDict: dict,
    locale,
    sessionUserId: "user-1",
    isSharedContext: false,
    switcherLoaded: true,
    currentSharedCapabilities: [],
    sharedContextPermissions: {
      canManageAccounts: true,
      canManageSharing: true,
      canReadAiDrafts: true,
      canWriteTransactions: true,
      canWriteDividends: true,
      canCreateDrafts: true,
      canEditDrafts: true,
      canArchiveDrafts: true,
      canDeleteDrafts: true,
      hasAnyDelegatedWrite: true,
    },
    canUseGlobalQuickActions: false,
    openQuickActions: vi.fn(),
    portfolioCapabilities: {
      configuredMarkets: ["TW", "US", "AU"],
      configuredCurrencies: ["TWD", "USD", "AUD"],
    },
    reportingCurrency: "TWD",
    saveReportingCurrency: vi.fn(async () => undefined),
    isReportingCurrencySaving: false,
    reportingCurrencyError: "",
    applyAccountMutationResponse: vi.fn(),
    transactionSubmission: {} as never,
    mutations: {} as never,
    recomputeAction: {} as never,
    openRecomputeConfirm: vi.fn(),
    transactionAccountOptions: [],
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    refreshPortfolioConfig: vi.fn(async () => undefined),
    isPortfolioConfigLoading: false,
    portfolioConfigError: "",
    integrityIssue: null,
    showIntegrityDialog: false,
    setShowIntegrityDialog: vi.fn(),
    generateSnapshots: vi.fn(async () => undefined),
    isGeneratingSnapshots: false,
    contextRefreshSignal: 0,
    routeCachePolicy: null,
    ...overrides,
  };
}

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("UnrealizedPnlAnalysisClient", () => {
  let root: Root | null = null;
  let container: HTMLDivElement;

  const legendButton = (label: string): HTMLButtonElement | null => {
    const legend = container.querySelector("[data-testid='analysis-chart-legend']");
    const row = Array.from(legend?.querySelectorAll("button") ?? [])
      .find((candidate) => candidate.textContent?.includes(label));
    return row as HTMLButtonElement | null;
  };
  const containsClass = (rootNode: ParentNode, className: string): boolean => (
    Array.from(rootNode.querySelectorAll("*")).some((node) => node.className.toString().includes(className))
  );

  beforeEach(() => {
    replaceMock.mockReset();
    getJsonMock.mockReset();
    getJsonMock.mockResolvedValue({ preferences: {} });
    patchJsonMock.mockReset();
    patchJsonMock.mockResolvedValue({ preferences: {} });
    searchParamsState.value = "";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) act(() => root?.unmount());
    window.matchMedia = originalMatchMedia;
    container.remove();
  });

  it("renders the preview shell and routes ranking selection into deterministic URL state", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);
    const selectedTotal = initialData.tickerSelection
      .filter((row) => initialData.selectedSeriesIds.includes(row.seriesId))
      .reduce((sum, row) => sum + (row.endUnrealizedPnl ?? 0), 0);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("Unrealized P&L Analysis");
    expect(container.textContent).toContain("Preview contract fallback");
    expect(container.querySelector("[data-testid='analysis-chart-legend']")?.textContent).toContain("Apple Inc.");
    expect(container.querySelector("[data-testid='analysis-selected-detail']")?.textContent).toContain("Apple Inc.");
    expect(container.querySelector("[data-testid='analysis-selected-detail-basis-tip']")?.textContent).toContain("Snapshot basis");
    expect(container.querySelector("[data-testid='analysis-selected-detail-basis-tip']")?.textContent).toContain("Latest snapshot shown:");
    expect(container.querySelector("[data-testid='analysis-selected-detail-basis-tip']")?.textContent).toContain("Snapshot sources:");
    expect(container.querySelector("[data-testid='analysis-selected-detail-basis-tip']")?.textContent).toContain("Snapshot FX as of:");
    expect(container.querySelector("[data-testid='analysis-selected-detail-total']")?.textContent).toContain(
      formatCurrencyAmount(selectedTotal, initialData.summary.totalUnrealized.currency as never, "en"),
    );
    expect(container.querySelector("[data-testid='analysis-chart-y-axis-max']")?.textContent).toContain("Max");
    expect(container.querySelector("[data-testid='analysis-chart-y-axis-zero']")?.textContent).toContain("Zero");
    expect(container.querySelector("[data-testid='analysis-chart-y-axis-min']")?.textContent).toContain("Min");

    const nvda = legendButton("NVIDIA Corporation");
    expect(nvda).not.toBeNull();

    act(() => {
      nvda?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(nvda?.getAttribute("aria-pressed")).toBe("false");
  });

  it("recomputes the selected detail total from unmuted selected rows only", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    act(() => {
      legendButton("NVIDIA Corporation")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const selectedTotal = initialData.tickerSelection
      .filter((row) => initialData.selectedSeriesIds.includes(row.seriesId) && row.ticker !== "NVDA")
      .reduce((sum, row) => sum + (row.endUnrealizedPnl ?? 0), 0);

    expect(container.querySelector("[data-testid='analysis-selected-detail-total']")?.textContent).toContain(
      formatCurrencyAmount(selectedTotal, initialData.summary.totalUnrealized.currency as never, "en"),
    );
  });

  it("does not invent an FX basis date when selected points have unresolved FX", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);
    const missingFxData = {
      ...initialData,
      tickerSeries: initialData.tickerSeries.map((series) => ({
        ...series,
        points: series.points.map((point) => ({
          ...point,
          basis: point.basis ? { ...point.basis, fxAsOfDate: null } : point.basis,
        })),
      })),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={missingFxData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(container.querySelector("[data-testid='analysis-selected-detail-basis-tip']")?.textContent)
      .toContain("Snapshot FX as of: -");
  });

  it("shows the readonly zero-account gate when analysis capabilities resolve zero configured markets in shared context", async () => {
    const initialData = {
      ...buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE),
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      } as const,
    };

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData("en", {
          isSharedContext: true,
          sharedContextPermissions: {
            canManageAccounts: false,
            canManageSharing: true,
            canReadAiDrafts: true,
            canWriteTransactions: true,
            canWriteDividends: true,
            canCreateDrafts: true,
            canEditDrafts: true,
            canArchiveDrafts: true,
            canDeleteDrafts: true,
            hasAnyDelegatedWrite: true,
          },
        })}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(container.querySelector("[data-testid='portfolio-capabilities-zero-account-gate']")).not.toBeNull();
    expect(container.querySelector("[data-testid='portfolio-capabilities-zero-account-cta']")).toBeNull();
    expect(container.querySelector("[data-testid='portfolio-capabilities-zero-account-readonly']")).not.toBeNull();
  });

  it("renders static market and currency contexts for single-capability analysis responses", async () => {
    const initialState = { ...ANALYSIS_DEFAULT_STATE, reportingCurrency: "TWD" as const };
    const initialData = {
      ...buildPreviewUnrealizedPnlAnalysis(initialState),
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      } as const,
      availableFilters: {
        ...buildPreviewUnrealizedPnlAnalysis(initialState).availableFilters,
        markets: [],
        reportingCurrencies: [],
      },
    };

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.querySelector("[data-testid='portfolio-capabilities-single-context-analysis-market']")?.textContent).toContain("TW");
    expect(container.querySelector("[data-testid='portfolio-capabilities-single-context-analysis-currency']")?.textContent).toContain("TWD");
    expect(container.querySelector("[data-testid='analysis-currency-select']")).toBeNull();
  });

  it("keeps capability-derived TW+US and TWD+USD controls operational even when availability lists are empty", async () => {
    const initialState = { ...ANALYSIS_DEFAULT_STATE, reportingCurrency: "USD" as const };
    const baseData = buildPreviewUnrealizedPnlAnalysis(initialState, "USD");
    const initialData = {
      ...baseData,
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      } as const,
      availableFilters: {
        ...baseData.availableFilters,
        markets: [],
        reportingCurrencies: [],
      },
    };

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.querySelector("[data-testid='portfolio-capabilities-single-context-analysis-market']")).toBeNull();
    expect(container.querySelector("[data-testid='analysis-currency-select']")).not.toBeNull();
    expect(container.textContent).toContain("TW");
    expect(container.textContent).toContain("US");
  });

  it("normalizes stale analysis markets and shows the market capability notice", async () => {
    const initialState = { ...ANALYSIS_DEFAULT_STATE, markets: ["KR"] as ["KR"] };
    const initialData = {
      ...buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE),
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      } as const,
    };

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock.mock.calls.at(-1)?.[0]).not.toContain("markets=KR");
    expect(container.querySelector("[data-testid='portfolio-capabilities-normalization-notice-market']")).not.toBeNull();
    expect(patchJsonMock).not.toHaveBeenCalled();
  });

  it("normalizes stale analysis currencies without patching preferences in shared context", async () => {
    const initialState = { ...ANALYSIS_DEFAULT_STATE, reportingCurrency: "AUD" as const };
    const initialData = {
      ...buildPreviewUnrealizedPnlAnalysis(initialState, "AUD"),
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      } as const,
    };

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData("en", {
          isSharedContext: true,
          portfolioCapabilities: {
            configuredMarkets: ["TW"],
            configuredCurrencies: ["TWD"],
          },
        })}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("reportingCurrency=TWD");
    expect(container.querySelector("[data-testid='portfolio-capabilities-normalization-notice-reportingCurrency']")).not.toBeNull();
    expect(patchJsonMock).not.toHaveBeenCalled();

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData("en", {
          isSharedContext: true,
          portfolioCapabilities: {
            configuredMarkets: ["TW"],
            configuredCurrencies: ["TWD"],
          },
        })}>
          <UnrealizedPnlAnalysisClient
            initialData={{
              ...initialData,
              query: {
                ...initialData.query,
                reportingCurrency: "TWD",
              },
            }}
            initialState={{ ...initialState, reportingCurrency: "TWD" }}
          />
        </AppShellDataProvider>,
      );
    });

    expect(patchJsonMock).not.toHaveBeenCalled();
  });

  it("uses local muted state for manual legend toggles without changing route params", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "custom" as const,
      tickerIds: ["US:AAPL", "US:NVDA"],
      drivers: 5 as const,
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    act(() => {
      legendButton("Apple Inc.")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(legendButton("Apple Inc.")?.getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector("[data-testid='analysis-detail-muted']")?.textContent).toContain("Muted context line");
  });

  it("renders the manual zero-selected empty state while preserving custom route state", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "custom" as const,
      tickerIds: [],
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("No tickers selected");
    expect(container.textContent).toContain("Select tickers from the Tickers filter to draw lines.");
    expect(container.querySelector("[data-testid='analysis-chart-legend']")).toBeNull();
    expect(container.querySelector("[data-testid='analysis-focus-scrub']")).toBeNull();
    expect(container.querySelector("[data-testid='analysis-detail-muted']")).toBeNull();
    expect(container.querySelector("[data-testid='analysis-ticker-picker-trigger']")?.textContent).toContain("0 selected");
  });

  it("lets the manual picker uncheck all eligible without falling back to all-eligible mode", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "allEligible" as const,
      tickerIds: [],
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });
    replaceMock.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-ticker-picker-trigger']")?.click();
    });
    const uncheckAllButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Uncheck all eligible");
    const checkAllButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Check all eligible");
    expect(checkAllButton).toBeDefined();
    expect(uncheckAllButton).toBeDefined();

    act(() => {
      uncheckAllButton!.click();
    });

    const lastUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    const params = new URL(lastUrl, "http://localhost").searchParams;
    expect(params.get("selection")).toBe("manualTickers");
    expect(params.get("tickerMode")).toBe("custom");
    expect(params.get("tickerIds")).toBeNull();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-ticker-picker-trigger']")?.click();
    });
    const reopenedCheckAllButton = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Check all eligible");
    expect(reopenedCheckAllButton).toBeDefined();

    act(() => {
      reopenedCheckAllButton!.click();
    });

    const resetUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    const resetParams = new URL(resetUrl, "http://localhost").searchParams;
    expect(resetParams.get("selection")).toBe("manualTickers");
    expect(resetParams.get("tickerMode")).toBeNull();
    expect(resetParams.get("tickerIds")).toBeNull();
  });

  it("resets manual muted state when picker membership changes", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "custom" as const,
      tickerIds: ["US:AAPL", "US:NVDA"],
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    act(() => {
      legendButton("Apple Inc.")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(container.querySelector("[data-testid='analysis-detail-muted']")?.textContent).toContain("Apple Inc.");

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-ticker-picker-trigger']")?.click();
    });
    const nvdaCheckbox = Array.from(document.body.querySelectorAll<HTMLInputElement>("[data-testid='analysis-ticker-picker'] input[type='checkbox']"))
      .find((input) => input.closest("label")?.textContent?.includes("US:NVDA"));
    expect(nvdaCheckbox).toBeDefined();

    act(() => {
      nvdaCheckbox!.click();
    });

    const mutedRows = Array.from(container.querySelectorAll("[data-testid='analysis-detail-muted']"));
    expect(mutedRows.some((row) => row.textContent?.includes("Apple Inc."))).toBe(false);
  });

  it("seeds all-eligible picker conversion from the full available ticker set", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "allEligible" as const,
      tickerIds: [],
      drivers: 5 as const,
    };
    const tickerIds = Array.from({ length: 12 }, (_, index) => `US:T${String(index).padStart(3, "0")}`);
    const selectedSeriesIds = tickerIds.slice(0, 5);
    const previewData = buildPreviewUnrealizedPnlAnalysis(initialState);
    const initialData = {
      ...previewData,
      selectedSeriesIds,
      availableFilters: {
        ...previewData.availableFilters,
        tickers: tickerIds.map((tickerId) => ({ value: tickerId, label: tickerId })),
      },
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });
    replaceMock.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-ticker-picker-trigger']")?.click();
    });
    const firstTickerCheckbox = Array.from(document.body.querySelectorAll<HTMLInputElement>("[data-testid='analysis-ticker-picker'] input[type='checkbox']"))
      .find((input) => input.closest("label")?.textContent?.includes("US:T000"));
    expect(firstTickerCheckbox).toBeDefined();

    act(() => {
      firstTickerCheckbox!.click();
    });

    const lastUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    const params = new URL(lastUrl, "http://localhost").searchParams;
    const customTickerIds = params.get("tickerIds")?.split(",") ?? [];
    expect(params.get("tickerMode")).toBe("custom");
    expect(customTickerIds).toHaveLength(11);
    expect(customTickerIds).not.toContain("US:T000");
    expect(customTickerIds).toContain("US:T011");
  });

  it("caps all-eligible picker conversion to the supported custom ticker limit", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "allEligible" as const,
      tickerIds: [],
      drivers: 5 as const,
    };
    const tickerIds = Array.from({ length: 205 }, (_, index) => `US:T${String(index).padStart(3, "0")}`);
    const previewData = buildPreviewUnrealizedPnlAnalysis(initialState);
    const initialData = {
      ...previewData,
      selectedSeriesIds: tickerIds.slice(0, 5),
      availableFilters: {
        ...previewData.availableFilters,
        tickers: tickerIds.map((tickerId) => ({ value: tickerId, label: tickerId })),
      },
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });
    replaceMock.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-ticker-picker-trigger']")?.click();
    });
    const overflowTickerCheckbox = Array.from(document.body.querySelectorAll<HTMLInputElement>("[data-testid='analysis-ticker-picker'] input[type='checkbox']"))
      .find((input) => input.closest("label")?.textContent?.includes("US:T204"));
    expect(overflowTickerCheckbox).toBeDefined();

    act(() => {
      overflowTickerCheckbox!.click();
    });

    const lastUrl = String(replaceMock.mock.calls.at(-1)?.[0] ?? "");
    const params = new URL(lastUrl, "http://localhost").searchParams;
    const customTickerIds = params.get("tickerIds")?.split(",") ?? [];
    expect(params.get("tickerMode")).toBe("custom");
    expect(customTickerIds).toHaveLength(199);
    expect(customTickerIds).not.toContain("US:T204");
    expect(customTickerIds).toContain("US:T000");
    expect(customTickerIds).toContain("US:T198");
  });

  it("does not append a ticker when custom selection is already at the supported limit", () => {
    const selectedTickerIds = Array.from({ length: 200 }, (_, index) => `US:T${String(index).padStart(3, "0")}`);
    const extraTickerId = "US:T200";
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "custom" as const,
      tickerIds: selectedTickerIds,
      drivers: 5 as const,
    };
    const previewData = buildPreviewUnrealizedPnlAnalysis(initialState);
    const initialData = {
      ...previewData,
      availableFilters: {
        ...previewData.availableFilters,
        tickers: [...selectedTickerIds, extraTickerId].map((tickerId) => ({ value: tickerId, label: tickerId })),
      },
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });
    replaceMock.mockClear();

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-ticker-picker-trigger']")?.click();
    });
    const extraTickerCheckbox = Array.from(document.body.querySelectorAll<HTMLInputElement>("[data-testid='analysis-ticker-picker'] input[type='checkbox']"))
      .find((input) => input.closest("label")?.textContent?.includes(extraTickerId));
    expect(extraTickerCheckbox).toBeDefined();
    expect(extraTickerCheckbox?.disabled).toBe(true);

    act(() => {
      extraTickerCheckbox!.click();
    });

    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("keeps manual detail rows pinned after ranked rows when sorting by name", () => {
    const previewData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);
    const initialData = {
      ...previewData,
      tickerSelection: previewData.tickerSelection.map((row) => row.ticker === "AAPL"
        ? { ...row, isManual: true, rankLabel: "Manual", rankSort: Number.MAX_SAFE_INTEGER }
        : row),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    const nameSort = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Name");
    expect(nameSort).toBeDefined();

    act(() => {
      nameSort?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const detailPanel = container.querySelector("[data-testid='analysis-selected-detail']");
    const detailRows = Array.from(detailPanel?.querySelectorAll("[data-testid='analysis-detail-expanded'], [data-testid='analysis-detail-collapsed']") ?? []);
    expect(detailRows.length).toBeGreaterThan(1);
    expect(detailRows.at(-1)?.textContent).toContain("Apple Inc.");
    expect(detailRows.at(-1)?.textContent).toContain("Manual");
    const cardNameLink = detailRows.at(-1)?.querySelector<HTMLAnchorElement>("a[href*='/tickers/AAPL']");
    expect(cardNameLink?.className).toContain("break-words");
    expect(cardNameLink?.className).not.toContain("truncate");
  });

  it("keeps muted and manual badges visible in table detail rows", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      selection: "manualTickers" as const,
      tickerMode: "custom" as const,
      tickerIds: ["US:AAPL", "US:NVDA"],
      detailLayout: "table" as const,
    };
    const previewData = buildPreviewUnrealizedPnlAnalysis(initialState);
    const initialData = {
      ...previewData,
      tickerSelection: previewData.tickerSelection.map((row) => row.ticker === "AAPL"
        ? { ...row, isManual: true, rankLabel: "Manual", rankSort: Number.MAX_SAFE_INTEGER }
        : row),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    act(() => {
      legendButton("Apple Inc.")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='analysis-detail-table']")?.textContent).toContain("Manual");
    expect(container.querySelector("[data-testid='analysis-detail-table']")?.textContent).toContain("Muted context line");
  });

  it("updates the selected detail total when a legend item is muted and renders chart baseline labels", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);
    const activeRows = initialData.tickerSelection.filter((row) => initialData.selectedSeriesIds.includes(row.seriesId));
    const baselineTotal = activeRows.reduce((sum, row) => sum + (row.endUnrealizedPnl ?? 0), 0);
    const mutedRow = activeRows.find((row) => row.displayName === "Apple Inc.");
    expect(mutedRow).toBeDefined();
    const mutedTotal = baselineTotal - (mutedRow?.endUnrealizedPnl ?? 0);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain(formatCurrencyAmount(baselineTotal, "TWD", "en"));

    act(() => {
      legendButton("Apple Inc.")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.textContent).toContain(formatCurrencyAmount(mutedTotal, "TWD", "en"));

    expect(container.querySelector("[data-testid='analysis-chart-y-axis-max']")?.textContent).toContain("Max");
    expect(container.querySelector("[data-testid='analysis-chart-y-axis-zero']")?.textContent).toContain("Zero");
    expect(container.querySelector("[data-testid='analysis-chart-y-axis-zero']")?.textContent).toContain("TWD 0");
    expect(container.querySelector("[data-testid='analysis-chart-y-axis-min']")?.textContent).toContain("Min");
  });

  it("hydrates presentation defaults from preferences when the URL does not override them", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        analysisUnrealizedPnlSettings: {
          version: 1,
          selection: "topDrivers",
          granularity: "monthly",
          reportingCurrency: "USD",
          includeProvisional: true,
          detailLayout: "responsive",
          topDrivers: { positionStatus: "includeClosed", tickerMode: "allEligible", tickerIds: [], drivers: 10 },
          manualTickers: { positionStatus: "openOnly", tickerMode: "allEligible", tickerIds: [] },
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(getJsonMock).toHaveBeenCalledWith("/user-preferences", { contextScope: "session" });
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("granularity=monthly");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("drivers=10");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("positionStatus=includeClosed");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("reportingCurrency=USD");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("includeProvisional=true");
    expect(patchJsonMock).not.toHaveBeenCalled();
  });

  it("hydrates and migrates legacy presentation defaults when canonical settings are absent", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        analysisUnrealizedPnlDefaults: {
          granularity: "monthly",
          lineCount: 10,
          holdingsState: "include-sold",
          reportingCurrency: "USD",
          includeProvisional: true,
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("granularity=monthly");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("drivers=10");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("positionStatus=includeClosed");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("reportingCurrency=USD");
    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("includeProvisional=true");
    expect(patchJsonMock).toHaveBeenCalledWith(
      "/user-preferences",
      {
        analysisUnrealizedPnlSettings: expect.objectContaining({
          granularity: "monthly",
          reportingCurrency: "USD",
          includeProvisional: true,
          topDrivers: expect.objectContaining({ drivers: 10, positionStatus: "includeClosed" }),
          manualTickers: expect.objectContaining({ positionStatus: "includeClosed" }),
        }),
        analysisUnrealizedPnlDefaults: null,
      },
      { contextScope: "session" },
    );
  });

  it("does not freeze inherited reporting currency when migrating legacy defaults", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        reportingCurrency: "USD",
        analysisUnrealizedPnlDefaults: {
          granularity: "monthly",
          lineCount: 10,
          holdingsState: "include-sold",
          includeProvisional: true,
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={{ ...buildShellData(), reportingCurrency: "USD" }}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("reportingCurrency=USD");
    const patchCall = (patchJsonMock.mock.calls as unknown[][]).at(-1);
    const patchPayload = patchCall?.[1] as
      | { analysisUnrealizedPnlSettings?: Record<string, unknown> }
      | undefined;
    const migratedSettings = patchPayload?.analysisUnrealizedPnlSettings;
    expect(migratedSettings).toMatchObject({
      granularity: "monthly",
      includeProvisional: true,
      topDrivers: expect.objectContaining({ drivers: 10, positionStatus: "includeClosed" }),
      manualTickers: expect.objectContaining({ positionStatus: "includeClosed" }),
    });
    expect(migratedSettings).not.toHaveProperty("reportingCurrency");
  });

  it("keeps explicit URL presentation values ahead of saved defaults", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        analysisUnrealizedPnlSettings: {
          version: 1,
          selection: "topDrivers",
          granularity: "monthly",
          reportingCurrency: "USD",
          includeProvisional: true,
          detailLayout: "responsive",
          topDrivers: { positionStatus: "includeClosed", tickerMode: "allEligible", tickerIds: [], drivers: 10 },
          manualTickers: { positionStatus: "openOnly", tickerMode: "allEligible", tickerIds: [] },
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient
            explicitPreferenceKeys={{
              selection: false,
              granularity: true,
              drivers: true,
              positionStatus: true,
              tickerMode: false,
              tickerIds: false,
              reportingCurrency: true,
              includeProvisional: true,
            }}
            initialData={initialData}
            initialState={ANALYSIS_DEFAULT_STATE}
          />
        </AppShellDataProvider>,
      );
    });

    expect(replaceMock).not.toHaveBeenCalled();
    expect(patchJsonMock).not.toHaveBeenCalled();
  });

  it("restores saved mode settings when switching selection modes", async () => {
    getJsonMock.mockResolvedValue({
      preferences: {
        analysisUnrealizedPnlSettings: {
          version: 1,
          selection: "topDrivers",
          granularity: "weekly",
          reportingCurrency: "TWD",
          includeProvisional: false,
          detailLayout: "responsive",
          topDrivers: { positionStatus: "openOnly", tickerMode: "allEligible", tickerIds: [], drivers: 5 },
          manualTickers: {
            positionStatus: "includeClosed",
            tickerMode: "custom",
            tickerIds: ["US:NVDA", "US:MSFT"],
          },
        },
      },
    });
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });
    replaceMock.mockClear();

    const manualButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Manual tickers");
    expect(manualButton).toBeDefined();

    await act(async () => {
      manualButton!.click();
      await Promise.resolve();
    });

    const href = replaceMock.mock.calls
      .map((call) => String(call[0] ?? ""))
      .find((candidate) => candidate.includes("selection=manualTickers")) ?? "";
    const params = new URL(href, "http://localhost").searchParams;
    expect(params.get("selection")).toBe("manualTickers");
    expect(params.get("tickerMode")).toBe("custom");
    expect(params.get("positionStatus")).toBe("includeClosed");
    expect(params.get("tickerIds")?.split(",").sort()).toEqual(["US:MSFT", "US:NVDA"]);
  });

  it("persists layout settings immediately when the detail layout control changes", async () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    const tableButton = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Table");
    expect(tableButton).toBeDefined();

    await act(async () => {
      tableButton!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(patchJsonMock).toHaveBeenLastCalledWith(
      "/user-preferences",
      {
        analysisUnrealizedPnlSettings: {
          version: 1,
          selection: "topDrivers",
          granularity: "weekly",
          reportingCurrency: "TWD",
          includeProvisional: false,
          detailLayout: "table",
          topDrivers: {
            positionStatus: "openOnly",
            tickerMode: "allEligible",
            tickerIds: [],
            drivers: 5,
          },
          manualTickers: {
            positionStatus: "openOnly",
            tickerMode: "allEligible",
            tickerIds: [],
          },
        },
      },
      { contextScope: "session" },
    );
  });

  it("syncs focus scrub changes into the URL", () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    const slider = container.querySelector("[data-testid='analysis-focus-scrub']") as HTMLInputElement | null;
    expect(slider).not.toBeNull();

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      setter?.call(slider, "2");
      slider!.dispatchEvent(new Event("input", { bubbles: true }));
      slider!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(replaceMock.mock.calls.at(-1)?.[0]).toContain("focus=2026-04-24");
  });

  it("restores the focus scrub position from deep-link state", () => {
    const focusedState = { ...ANALYSIS_DEFAULT_STATE, focusDate: "2026-04-24" };
    const initialData = buildPreviewUnrealizedPnlAnalysis(focusedState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={focusedState} />
        </AppShellDataProvider>,
      );
    });

    const slider = container.querySelector("[data-testid='analysis-focus-scrub']") as HTMLInputElement | null;
    expect(slider).not.toBeNull();
    expect(slider?.value).toBe("2");
    expect(container.textContent).toContain("Apr 24, 2026");
  });

  it("uses focused points for the selected detail basis disclosure", () => {
    const focusedState = { ...ANALYSIS_DEFAULT_STATE, focusDate: "2026-04-24" };
    const initialData = buildPreviewUnrealizedPnlAnalysis(focusedState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={focusedState} />
        </AppShellDataProvider>,
      );
    });

    const basisTip = container.querySelector("[data-testid='analysis-selected-detail-basis-tip']");
    expect(basisTip?.textContent).toContain("Latest snapshot shown: Apr 24, 2026");
    expect(basisTip?.textContent).toContain("Snapshot FX as of: Apr 24, 2026");
    expect(basisTip?.textContent).not.toContain("Jun 26, 2026");
  });

  it("keeps large focused values compact in the mobile focus strip", () => {
    const focusedState = { ...ANALYSIS_DEFAULT_STATE, focusDate: "2026-04-24" };
    const initialData = buildPreviewUnrealizedPnlAnalysis(focusedState);
    const largeFocusedData = {
      ...initialData,
      tickerSeries: initialData.tickerSeries.map((series) => {
        if (series.seriesId !== "US:NVDA") return series;
        return {
          ...series,
          points: series.points.map((point) => point.date === focusedState.focusDate
            ? { ...point, unrealizedPnl: 987654321 }
            : point),
        };
      }),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={largeFocusedData} initialState={focusedState} />
        </AppShellDataProvider>,
      );
    });

    const focusValues = container.querySelector("[data-testid='analysis-focus-values']");
    expect(focusValues?.textContent).toContain("TWD 987.7M");
    expect(focusValues?.textContent).not.toContain("987,654,321");
    expect(focusValues?.querySelector("[title='NT$987,654,321']")).not.toBeNull();
  });

  it("uses resolved date bounds for half-open custom ticker drilldown links", () => {
    const halfOpenState = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "CUSTOM" as const,
      from: "2026-04-10",
      to: null,
    };
    const previewData = buildPreviewUnrealizedPnlAnalysis(halfOpenState);
    const initialData = {
      ...previewData,
      query: {
        ...previewData.query,
        startDate: "2026-04-10",
        endDate: "2026-07-01",
      },
      summary: {
        ...previewData.summary,
        startDate: "2026-04-10",
        endDate: "2026-07-01",
      },
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={halfOpenState} />
        </AppShellDataProvider>,
      );
    });

    const tickerHref = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .find((href) => href.startsWith("/tickers/"));
    expect(tickerHref).toContain("source=unrealized-pnl-analysis");
    expect(tickerHref).toContain("fromDate=2026-04-10");
    expect(tickerHref).toContain("toDate=2026-07-01");
  });

  it("uses ALL ticker chart links for long-range analysis drilldowns", () => {
    const allState = {
      ...ANALYSIS_DEFAULT_STATE,
      range: "ALL" as const,
      granularity: "yearly" as const,
    };
    const previewData = buildPreviewUnrealizedPnlAnalysis(allState);
    const initialData = {
      ...previewData,
      query: {
        ...previewData.query,
        startDate: "2010-01-01",
        endDate: "2026-07-01",
      },
      summary: {
        ...previewData.summary,
        startDate: "2010-01-01",
        endDate: "2026-07-01",
      },
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={allState} />
        </AppShellDataProvider>,
      );
    });

    const tickerHref = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .find((href) => href.startsWith("/tickers/"));
    expect(tickerHref).toContain("source=unrealized-pnl-analysis");
    expect(tickerHref).toContain("chartRange=ALL");
    expect(tickerHref).not.toContain("fromDate=");
    expect(tickerHref).not.toContain("toDate=");
  });

  it("filters multi-account ticker drilldown links to the clicked ticker account scope", () => {
    const mixedAccountState = {
      ...ANALYSIS_DEFAULT_STATE,
      accounts: ["acc-us-growth", "acc-tw-main"],
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(mixedAccountState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={mixedAccountState} />
        </AppShellDataProvider>,
      );
    });

    const nvdaHref = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .find((href) => href.startsWith("/tickers/NVDA?"));
    expect(nvdaHref).toBeDefined();

    const params = new URL(nvdaHref!, "http://localhost").searchParams;
    expect(params.get("marketCode")).toBe("US");
    expect(params.get("accountId")).toBe("acc-us-growth");
    expect(params.get("accountIds")).toBeNull();
    expect(nvdaHref).not.toContain("acc-tw-main");
  });

  it("omits oversized multi-account ticker drilldown params that exceed ticker route limits", () => {
    const scopedAccounts = ["acc-us-growth", ...Array.from({ length: 51 }, (_unused, index) => `acc-us-extra-${index + 1}`)];
    const oversizedAccountState = {
      ...ANALYSIS_DEFAULT_STATE,
      accounts: scopedAccounts,
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(oversizedAccountState);
    const oversizedData = {
      ...initialData,
      tickerSeries: initialData.tickerSeries.map((series) => (
        series.seriesId === "US:NVDA"
          ? { ...series, accountIds: scopedAccounts, accountNames: scopedAccounts }
          : series
      )),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={oversizedData} initialState={oversizedAccountState} />
        </AppShellDataProvider>,
      );
    });

    const nvdaHref = Array.from(container.querySelectorAll("a"))
      .map((anchor) => anchor.getAttribute("href") ?? "")
      .find((href) => href.startsWith("/tickers/NVDA?"));
    expect(nvdaHref).toBeDefined();

    const params = new URL(nvdaHref!, "http://localhost").searchParams;
    expect(params.get("marketCode")).toBe("US");
    expect(params.get("accountId")).toBeNull();
    expect(params.get("accountIds")).toBeNull();
  });

  it("closes the mobile total composition sheet when the viewport becomes desktop", () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    const mediaQuery = {
      matches: false,
      media: "(min-width: 768px)",
      onchange: null,
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      addListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeListener: (listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
      dispatchEvent: () => true,
    } as MediaQueryList;
    window.matchMedia = vi.fn(() => mediaQuery);
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
    });

    act(() => {
      container.querySelector<HTMLButtonElement>("[data-testid='analysis-total-detail-trigger-mobile']")?.click();
    });

    expect(document.body.querySelector("[data-testid='ui-drawer']")).not.toBeNull();

    act(() => {
      Object.defineProperty(mediaQuery, "matches", { configurable: true, value: true });
      listeners.forEach((listener) => listener({ matches: true } as MediaQueryListEvent));
    });

    expect(document.body.querySelector("[data-testid='ui-drawer']")).toBeNull();
  }, 10000);

  it("does not show stale selected detail values when a focused date is missing for a series", () => {
    const focusedState = { ...ANALYSIS_DEFAULT_STATE, focusDate: "2026-04-24" };
    const initialData = buildPreviewUnrealizedPnlAnalysis(focusedState);
    const sparseData = {
      ...initialData,
      tickerSeries: initialData.tickerSeries.map((series) => {
        if (series.seriesId !== "US:NVDA") return series;
        const lastPoint = series.points.at(-1);
        return {
          ...series,
          points: series.points
            .filter((point) => point.date !== focusedState.focusDate)
            .map((point) => point.date === lastPoint?.date ? { ...point, unrealizedPnl: 987654321 } : point),
        };
      }),
    };

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={sparseData} initialState={focusedState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("US:NVDA");
    expect(container.textContent).toContain("Pending");
    expect(container.textContent).not.toContain("987,654,321");
  });

  it("formats ranking and detail amounts with the response currency", () => {
    const audState = { ...ANALYSIS_DEFAULT_STATE, reportingCurrency: "AUD" as const };
    const initialData = buildPreviewUnrealizedPnlAnalysis(audState, "AUD");

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={audState} />
        </AppShellDataProvider>,
      );
    });

    expect(container.textContent).toContain("A$");
    expect(container.textContent).not.toContain("NT$");
  });

  it("applies gain/loss tones to focused, detail, and table P&L values", () => {
    const initialState = {
      ...ANALYSIS_DEFAULT_STATE,
      detailLayout: "table" as const,
    };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);

    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    const focusValues = container.querySelector("[data-testid='analysis-focus-values']");
    const detailCards = container.querySelector("[data-testid='analysis-detail-cards']");
    const detailTable = container.querySelector("[data-testid='analysis-detail-table']");
    expect(focusValues).not.toBeNull();
    expect(detailCards).not.toBeNull();
    expect(detailTable).not.toBeNull();
    expect(containsClass(focusValues!, financeGainTextClass)).toBe(true);
    expect(containsClass(detailCards!, financeGainTextClass)).toBe(true);
    expect(containsClass(detailCards!, financeLossTextClass)).toBe(true);
    expect(containsClass(detailTable!, financeGainTextClass)).toBe(true);
    expect(containsClass(detailTable!, financeLossTextClass)).toBe(true);
    expect(detailCards?.textContent).toContain("Period unrealized P&L change");
    expect(detailTable?.textContent).toContain("Period unrealized P&L change");
  });

  it("[Analysis metrics EN]: render holdings-derived detail → canonical metric terms coexist with valid Rank, Period change, and Position status", () => {
    const initialState = { ...ANALYSIS_DEFAULT_STATE, detailLayout: "table" as const };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);
    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData("en")}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    const detail = container.querySelector("[data-testid='analysis-selected-detail']");
    expect(detail?.textContent).toContain("End unrealized P&L");
    expect(detail?.textContent).toContain("Period unrealized P&L change");
    expect(detail?.textContent).toContain("Focused unrealized P&L");
    expect(detail?.textContent).toContain("Cost basis");
    expect(detail?.textContent).toContain("Market value");
    expect(detail?.textContent).toContain("Quantity");
    expect(container.textContent).toContain("Ranking");
    expect(container.textContent).toContain("Open positions");
    expect(container.textContent).toContain("Open position");
    expect(container.querySelector("[data-testid*='mobile-sort']")).toBeNull();
    expect(container.querySelector("[data-testid*='column-sort']")).toBeNull();
  });

  it("[Analysis metrics zh-TW]: render holdings-derived detail → canonical metric vocabulary is localized without erasing Position status", () => {
    const initialState = { ...ANALYSIS_DEFAULT_STATE, detailLayout: "table" as const };
    const initialData = buildPreviewUnrealizedPnlAnalysis(initialState);
    act(() => {
      root!.render(
        <AppShellDataProvider value={buildShellData("zh-TW")}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={initialState} />
        </AppShellDataProvider>,
      );
    });

    const detail = container.querySelector("[data-testid='analysis-selected-detail']");
    expect(detail?.textContent).toContain("期末未實現損益");
    expect(detail?.textContent).toContain("期間未實現損益變動");
    expect(detail?.textContent).toContain("焦點未實現損益");
    expect(detail?.textContent).toContain("成本基礎");
    expect(detail?.textContent).toContain("市值");
    expect(detail?.textContent).toContain("數量");
    expect(container.textContent).toContain("排名");
    expect(container.textContent).toContain("開放部位");
    expect(container.querySelector("[data-testid*='mobile-sort']")).toBeNull();
    expect(container.querySelector("[data-testid*='column-sort']")).toBeNull();
  });

  it("keeps stale response values in their original currency while refreshing the selected reporting currency", async () => {
    const initialData = buildPreviewUnrealizedPnlAnalysis(ANALYSIS_DEFAULT_STATE, "AUD");

    await act(async () => {
      root!.render(
        <AppShellDataProvider value={buildShellData()}>
          <UnrealizedPnlAnalysisClient initialData={initialData} initialState={ANALYSIS_DEFAULT_STATE} />
        </AppShellDataProvider>,
      );
      await Promise.resolve();
    });

    expect(container.querySelector("[data-testid='analysis-stale-currency-banner']")).not.toBeNull();
    expect(container.textContent).toContain("Refreshing values in TWD");
    expect(container.textContent).toContain("A$");
  });
});
