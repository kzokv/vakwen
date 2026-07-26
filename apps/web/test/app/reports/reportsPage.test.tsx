import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";

interface MockAppShellProps {
  children: ReactNode;
  portfolioConfigMode?: string;
  section?: string;
}

interface MockReportsClientProps {
  initialReport?: { query?: { scope?: string } } | null;
  initialState: {
    tab: string;
    scope: string;
  };
}

vi.mock("../../../lib/auth", () => ({
  requireSession: vi.fn(),
}));

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

vi.mock("../../../lib/sidebar-cookie", () => ({
  readSidebarStateCookie: vi.fn(),
}));

vi.mock("../../../features/reports/services/reportService", () => ({
  fetchReport: vi.fn(),
}));

vi.mock("../../../components/layout/AppShell", () => ({
  AppShell(props: MockAppShellProps) {
    return (
      <div
        data-testid="app-shell"
        data-portfolio-config-mode={props.portfolioConfigMode}
        data-section={props.section}
      >
        {props.children}
      </div>
    );
  },
}));

vi.mock("../../../components/reports/ReportsClient", () => ({
  ReportsClient(props: MockReportsClientProps) {
    return (
      <div
        data-testid="reports-client"
        data-report-scope={props.initialReport?.query?.scope ?? ""}
        data-state-tab={props.initialState.tab}
        data-state-scope={props.initialState.scope}
      />
    );
  },
}));

import { requireSession } from "../../../lib/auth";
import { getJson } from "../../../lib/api";
import { readSidebarStateCookie } from "../../../lib/sidebar-cookie";
import { fetchReport } from "../../../features/reports/services/reportService";
import ReportsPage from "../../../app/reports/page";

describe("ReportsPage", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    vi.mocked(requireSession).mockResolvedValue({ isDemo: false } as never);
    vi.mocked(getJson).mockImplementation((async (path: string) => {
      if (path === "/settings") return { locale: "en" };
      if (path === "/profile") return {};
      return {};
    }) as never);
    vi.mocked(readSidebarStateCookie).mockResolvedValue(false as never);
    vi.mocked(fetchReport).mockImplementation(async (_tab, state) => ({
      query: { scope: state.scope },
    }) as never);
  });

  afterEach(() => vi.useRealTimers());

  it("renders the reports shell from validated query state with a server-seeded report", async () => {
    const html = renderToStaticMarkup(await ReportsPage({
      searchParams: Promise.resolve({
        tab: "market",
        scope: "US",
        currencyMode: "specified",
        currency: "USD",
      }),
    }));

    expect(html).toContain('data-testid="app-shell"');
    expect(html).toContain('data-section="reports"');
    expect(html).toContain('data-portfolio-config-mode="lazy"');
    expect(html).toContain('data-testid="reports-client"');
    expect(html).toContain('data-state-tab="market"');
    expect(html).toContain('data-state-scope="US"');
    expect(html).toContain('data-report-scope="US"');
    expect(fetchReport).toHaveBeenCalledWith("market", expect.objectContaining({ scope: "US" }));
  });

  it("server-seeds scoped pages before client hydration", async () => {
    const html = renderToStaticMarkup(await ReportsPage({
      searchParams: Promise.resolve({
        tab: "daily-review",
        scope: "TW",
      }),
    }));

    expect(html).toContain('data-testid="reports-client"');
    expect(html).toContain('data-state-tab="daily-review"');
    expect(html).toContain('data-state-scope="TW"');
    expect(html).toContain('data-report-scope="TW"');
    expect(fetchReport).toHaveBeenCalledWith("daily-review", expect.objectContaining({ scope: "TW" }));
  });
});
