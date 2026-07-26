import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { ReportsClient } from "../../components/reports/ReportsClient";
import { parseReportRouteState } from "../../features/reports/reportState";
import { fetchReport } from "../../features/reports/services/reportService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface ReportsPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const rawSearchParams = await searchParams;
  const initialState = parseReportRouteState(rawSearchParams);
  const [session, profile, sidebarOpen, settings, initialReport] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    fetchReport(initialState.tab, initialState).catch(() => null),
  ]);

  const locale = settings?.locale ?? "en";
  const loadingCopy = getRouteLoadingLabels(locale).reports;

  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="reports"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialSettings={settings}
        initialSidebarOpen={sidebarOpen}
        portfolioConfigMode="lazy"
      >
        <ReportsClient initialReport={initialReport} initialState={initialState} />
      </AppShell>
    </Suspense>
  );
}
