import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../features/portfolio/services/portfolioService", () => ({
  fetchPortfolioPrimaryData: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({
    children,
    initialPortfolioConfig,
    portfolioConfigMode,
  }: {
    children: React.ReactNode;
    initialPortfolioConfig?: {
      accounts?: unknown[];
      capabilities?: { configuredCurrencies?: unknown[] };
    } | null;
    portfolioConfigMode?: string;
  }) => (
    <div
      data-testid="mock-app-shell"
      data-portfolio-config-mode={portfolioConfigMode ?? ""}
      data-portfolio-config-accounts={String(initialPortfolioConfig?.accounts?.length ?? 0)}
      data-portfolio-config-currencies={String(
        initialPortfolioConfig?.capabilities?.configuredCurrencies?.length ?? 0,
      )}
    >
      {children}
    </div>
  ),
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

vi.mock("../../../components/portfolio/PortfolioClient", () => ({
  PortfolioClient: ({
    initialPrimaryData,
  }: {
    initialPrimaryData: { holdings?: unknown[] } | null;
  }) => (
    <div
      data-testid="portfolio-client"
      data-has-initial-primary={String(initialPrimaryData !== null)}
      data-holdings-count={String(initialPrimaryData?.holdings?.length ?? 0)}
    />
  ),
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchPortfolioPrimaryData } from "../../../features/portfolio/services/portfolioService";
import PortfolioPage from "../../../app/portfolio/page";

const requireSessionMock = vi.mocked(requireSession);
const getJsonMock = vi.mocked(getJson);
const readSidebarStateCookieMock = vi.mocked(readSidebarStateCookie);
const fetchPortfolioPrimaryDataMock = vi.mocked(fetchPortfolioPrimaryData);

const primaryData = {
  holdings: [{ accountId: "acc-1", ticker: "NVDA" }],
  holdingGroups: [],
  dividends: { upcoming: [], recent: [] },
  instruments: [],
  accounts: [{ id: "acc-1", name: "Main" }],
  feeProfiles: [{ id: "fee-1" }],
  feeProfileBindings: [],
  integrityIssue: null,
  capabilities: {
    configuredMarkets: ["TW", "US"],
    configuredCurrencies: ["TWD", "USD"],
  },
};

describe("PortfolioPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ isDemo: false } as never);
    getJsonMock.mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/profile") return {};
      return {};
    }) as never);
    readSidebarStateCookieMock.mockResolvedValue(false as never);
    fetchPortfolioPrimaryDataMock.mockResolvedValue(primaryData as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("server-seeds portfolio primary data and shell portfolio config", async () => {
    const element = await PortfolioPage();
    const html = renderToStaticMarkup(element);

    expect(fetchPortfolioPrimaryDataMock).toHaveBeenCalledTimes(1);
    expect(html).toContain('data-testid="portfolio-client"');
    expect(html).toContain('data-has-initial-primary="true"');
    expect(html).toContain('data-holdings-count="1"');
    expect(html).toContain('data-portfolio-config-accounts="1"');
    expect(html).toContain('data-portfolio-config-currencies="2"');
  });

  it("falls back to lazy client bootstrap when server primary load fails", async () => {
    fetchPortfolioPrimaryDataMock.mockRejectedValue(new Error("primary unavailable"));

    const element = await PortfolioPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-has-initial-primary="false"');
    expect(html).toContain('data-portfolio-config-mode="lazy"');
    expect(html).toContain('data-portfolio-config-accounts="0"');
  });
});
