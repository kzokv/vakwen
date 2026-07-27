import { beforeEach, describe, expect, it, vi } from "vitest";
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

vi.mock("../../../features/dashboard/services/dashboardService", () => ({
  fetchDashboardPrimaryData: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell: ({
    children,
    initialPortfolioConfig,
  }: {
    children: React.ReactNode;
    initialPortfolioConfig?: {
      capabilities?: { configuredCurrencies?: unknown[] };
    } | null;
  }) => (
    <div
      data-testid="mock-app-shell"
      data-portfolio-config-currencies={String(
        initialPortfolioConfig?.capabilities?.configuredCurrencies?.length ?? 0,
      )}
    >
      {children}
    </div>
  ),
}));

vi.mock("../../../components/dashboard/DashboardClient", () => ({
  DashboardClient: () => <div data-testid="dashboard-client" />,
}));

vi.mock("../../../components/dashboard/DashboardLoading", () => ({
  DashboardLoading: () => <div data-testid="dashboard-loading" />,
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchDashboardPrimaryData } from "../../../features/dashboard/services/dashboardService";
import DashboardPage from "../../../app/dashboard/page";

describe("DashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue({ isDemo: false } as never);
    vi.mocked(readSidebarStateCookie).mockResolvedValue(false as never);
    vi.mocked(getJson).mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/user-preferences") return { preferences: { reportingCurrency: "TWD" } };
      return {};
    }) as never);
    vi.mocked(fetchDashboardPrimaryData).mockResolvedValue({
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
      summary: { reportingCurrency: "TWD" },
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      actions: { integrityIssue: null },
    } as never);
  });

  it("server-seeds portfolio capabilities from dashboard primary data", async () => {
    const element = await DashboardPage();
    const html = renderToStaticMarkup(element);

    expect(html).toContain('data-testid="dashboard-client"');
    expect(html).toContain('data-portfolio-config-currencies="2"');
  });
});
