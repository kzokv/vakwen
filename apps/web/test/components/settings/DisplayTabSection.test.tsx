import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction } from "vitest";
import type { AppShellData } from "../../../components/layout/AppShellDataContext";
import { AppShellDataProvider } from "../../../components/layout/AppShellDataContext";
import { DisplayTabSection } from "../../../components/settings/DisplayTabSection";
import { deriveSharedContextPermissions } from "../../../features/sharing/capabilities";
import { getDictionary } from "../../../lib/i18n";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings/display",
  useRouter: () => ({
    replace: vi.fn(),
  }),
}));

const dict = getDictionary("en");

beforeAll(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
});

interface RenderHandle {
  container: HTMLDivElement;
  root: Root;
}

interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

function makeContainer(): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  return { container, root };
}

function teardown({ container, root }: RenderHandle) {
  act(() => root.unmount());
  container.remove();
}

function buildFetchMock(opts: {
  initialPrefs?: Record<string, unknown>;
  patchStatus?: number;
  recordCalls: FetchCall[];
}): MockedFunction<typeof fetch> {
  const { initialPrefs = {}, patchStatus = 200, recordCalls } = opts;
  return vi.fn().mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: unknown = null;
    if (init?.body && typeof init.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    recordCalls.push({ url, method, body });

    if (url.includes("/user-preferences") && !url.includes("effective")) {
      if (method === "PATCH") {
        if (patchStatus >= 400) {
          return new Response(
            JSON.stringify({ error: "patch_failed", message: "PATCH rejected" }),
            { status: patchStatus, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(JSON.stringify({ preferences: initialPrefs }), { status: patchStatus });
      }
      return new Response(JSON.stringify({ preferences: initialPrefs }), { status: 200 });
    }
    return new Response("", { status: 200 });
  });
}

function buildShellData(overrides: Partial<AppShellData> = {}): AppShellData {
  const currentSharedCapabilities = overrides.currentSharedCapabilities ?? [];
  return {
    uiDict: getDictionary("en"),
    locale: "en",
    sessionUserId: "viewer-1",
    contextOwnerId: "viewer-1",
    sessionUserRole: "viewer",
    routeCachePolicy: null,
    isSharedContext: false,
    switcherLoaded: true,
    currentSharedCapabilities,
    sharedContextPermissions: deriveSharedContextPermissions(currentSharedCapabilities),
    canUseGlobalQuickActions: false,
    openQuickActions: vi.fn(),
    portfolioCapabilities: {
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    },
    reportingCurrency: "TWD",
    saveReportingCurrency: vi.fn(async () => undefined),
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
    refreshPortfolioConfig: vi.fn(async () => undefined),
    isPortfolioConfigLoading: false,
    integrityIssue: null,
    showIntegrityDialog: false,
    setShowIntegrityDialog: vi.fn(),
    generateSnapshots: vi.fn(async () => undefined),
    isGeneratingSnapshots: false,
    contextRefreshSignal: 0,
    ...overrides,
  };
}

function renderSection(
  handle: RenderHandle,
  shellDataOverrides: Partial<AppShellData> = {},
  locale: AppShellData["locale"] = "en",
) {
  const shellData = buildShellData(shellDataOverrides);
  const onReportingCurrencySaved = vi.fn();

  act(() => {
    handle.root.render(
      <AppShellDataProvider value={shellData}>
        <DisplayTabSection
          dict={getDictionary(locale)}
          onTimeframesSaved={() => undefined}
          onLayoutReset={() => undefined}
          onPageLayoutReset={() => undefined}
          onReportingCurrencySaved={onReportingCurrencySaved}
        />
      </AppShellDataProvider>,
    );
  });

  return {
    shellData,
    onReportingCurrencySaved,
  };
}

describe("DisplayTabSection", () => {
  let handle: RenderHandle;
  let calls: FetchCall[];

  beforeEach(() => {
    handle = makeContainer();
    calls = [];
  });

  afterEach(() => {
    teardown(handle);
    vi.restoreAllMocks();
    document.documentElement.style.removeProperty("--finance-gain");
    document.documentElement.style.removeProperty("--finance-loss");
    document.documentElement.style.removeProperty("--chart-direction-positive");
    document.documentElement.style.removeProperty("--chart-direction-negative");
  });

  it("renders only configured reporting currencies and saves through app shell state", async () => {
    const fetchMock = buildFetchMock({ initialPrefs: {}, recordCalls: calls });
    vi.stubGlobal("fetch", fetchMock);
    const { shellData, onReportingCurrencySaved } = renderSection(handle);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const select = handle.container.querySelector("[data-testid='reporting-currency-select']") as HTMLSelectElement | null;
    expect(select).not.toBeNull();
    expect(Array.from(select!.options).map((option) => option.value)).toEqual(["TWD", "USD"]);

    const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value")?.set;
    act(() => {
      setter!.call(select, "USD");
      select!.dispatchEvent(new Event("change", { bubbles: true }));
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shellData.saveReportingCurrency).toHaveBeenCalledWith("USD");
    expect(onReportingCurrencySaved).toHaveBeenCalledTimes(1);
    expect(handle.container.querySelector("[data-testid='reporting-currency-saved']")?.textContent)
      .toContain(dict.settings.displayReportingCurrencySaved);
  });

  it("renders the zero-account gate with zh-TW copy when no currencies are configured", async () => {
    const fetchMock = buildFetchMock({ initialPrefs: {}, recordCalls: calls });
    vi.stubGlobal("fetch", fetchMock);
    renderSection(handle, {
      portfolioCapabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
    }, "zh-TW");

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(handle.container.querySelector("[data-testid='portfolio-capabilities-zero-account-gate']")).not.toBeNull();
    expect(handle.container.textContent).toContain("請先設定帳戶再使用這個畫面");
    expect(handle.container.textContent).toContain("目前尚未設定任何報表幣別。");
  });

  it("renders static single-currency context when only one configured currency exists", async () => {
    const fetchMock = buildFetchMock({ initialPrefs: {}, recordCalls: calls });
    vi.stubGlobal("fetch", fetchMock);
    renderSection(handle, {
      portfolioCapabilities: {
        configuredMarkets: ["US"],
        configuredCurrencies: ["USD"],
      },
      reportingCurrency: "USD",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(handle.container.querySelector("[data-testid='display-reporting-currency-single']")).not.toBeNull();
    expect(handle.container.textContent).toContain("USD");
    expect(handle.container.querySelector("[data-testid='reporting-currency-select']")).toBeNull();
  });

  it("normalizes stale owner preferences through the app shell without reloading the router", async () => {
    const fetchMock = buildFetchMock({ initialPrefs: {}, recordCalls: calls });
    vi.stubGlobal("fetch", fetchMock);
    const { shellData } = renderSection(handle, {
      portfolioCapabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      reportingCurrency: "USD",
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shellData.saveReportingCurrency).toHaveBeenCalledWith("TWD", { refreshRouter: false });
    expect(handle.container.textContent).toContain("Showing TWD instead.");
  });

  it("uses shared effective fallback display without overwriting the viewer preference", async () => {
    const fetchMock = buildFetchMock({ initialPrefs: {}, recordCalls: calls });
    vi.stubGlobal("fetch", fetchMock);
    const { shellData } = renderSection(handle, {
      isSharedContext: true,
      reportingCurrency: "USD",
      portfolioCapabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
    });

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(shellData.saveReportingCurrency).not.toHaveBeenCalled();
    const select = handle.container.querySelector("[data-testid='display-reporting-currency-single']");
    expect(select?.textContent).toContain("TWD");
    expect(handle.container.textContent).toContain("Showing TWD instead.");
  });

  it("hydrates the gain/loss color convention from GET /user-preferences", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { priceColorConvention: "gain_red_loss_green" },
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection(handle);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const redGainOption = handle.container.querySelector("[data-testid='display-price-color-convention-gain_red_loss_green']");
    expect(redGainOption?.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--success)");
  });

  it("PATCHes /user-preferences with gain/loss color convention and applies it immediately", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { priceColorConvention: "gain_green_loss_red" },
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection(handle);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const redGainOption = handle.container.querySelector("[data-testid='display-price-color-convention-gain_red_loss_green']") as HTMLButtonElement | null;
    expect(redGainOption).not.toBeNull();
    act(() => {
      redGainOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const patchCall = calls.find((c) => c.method === "PATCH" && c.url.includes("/user-preferences"));
    expect(patchCall?.body).toEqual({ priceColorConvention: "gain_red_loss_green" });
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--destructive)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--success)");
    expect(handle.container.querySelector("[data-testid='price-color-convention-saved']")?.textContent)
      .toContain(dict.settings.displayPriceColorConventionSaved);
  });

  it("rolls back gain/loss color convention when PATCH fails", async () => {
    const fetchMock = buildFetchMock({
      initialPrefs: { priceColorConvention: "gain_green_loss_red" },
      patchStatus: 500,
      recordCalls: calls,
    });
    vi.stubGlobal("fetch", fetchMock);
    renderSection(handle);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const redGainOption = handle.container.querySelector("[data-testid='display-price-color-convention-gain_red_loss_green']") as HTMLButtonElement | null;
    act(() => {
      redGainOption!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const greenGainOption = handle.container.querySelector("[data-testid='display-price-color-convention-gain_green_loss_red']");
    expect(greenGainOption?.getAttribute("aria-checked")).toBe("true");
    expect(document.documentElement.style.getPropertyValue("--finance-gain")).toBe("var(--success)");
    expect(document.documentElement.style.getPropertyValue("--finance-loss")).toBe("var(--destructive)");
    expect(handle.container.querySelector("[data-testid='price-color-convention-error']")).not.toBeNull();
  });
});
