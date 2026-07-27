import { Suspense } from "react";
import type { UserSettings } from "@vakwen/shared-types";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { PortfolioClient } from "../../components/portfolio/PortfolioClient";
import { fetchPortfolioPrimaryData } from "../../features/portfolio/services/portfolioService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function PortfolioPage() {
  const [session, profile, sidebarOpen, settings, initialPrimaryData] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    fetchPortfolioPrimaryData().catch(() => null),
  ]);
  const initialPortfolioConfig = initialPrimaryData
    ? {
      accounts: initialPrimaryData.accounts,
      feeProfiles: initialPrimaryData.feeProfiles,
      feeProfileBindings: initialPrimaryData.feeProfileBindings,
      integrityIssue: initialPrimaryData.integrityIssue,
      capabilities: initialPrimaryData.capabilities,
    }
    : null;
  const locale = settings?.locale ?? "en";
  const loadingCopy = getRouteLoadingLabels(locale).portfolio;
  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="portfolio"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialSettings={settings}
        initialPortfolioConfig={initialPortfolioConfig}
        portfolioConfigMode={initialPortfolioConfig ? "eager" : "lazy"}
        initialSidebarOpen={sidebarOpen}
      >
        <PortfolioClient initialPrimaryData={initialPrimaryData} />
      </AppShell>
    </Suspense>
  );
}
