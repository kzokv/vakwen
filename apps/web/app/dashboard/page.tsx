import { Suspense } from "react";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  type AccountDefaultCurrency,
  type UserSettings,
} from "@vakwen/shared-types";
import { DashboardClient } from "../../components/dashboard/DashboardClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { fetchDashboardPrimaryData } from "../../features/dashboard/services/dashboardService";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

interface UserPreferencesResponse {
  preferences?: {
    reportingCurrency?: unknown;
  };
}

export default async function DashboardPage() {
  const [session, profile, sidebarOpen, settings, preferences, initialPrimaryData] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
    getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" }).catch(() => null),
    fetchDashboardPrimaryData().catch(() => null),
  ]);
  const expectedReportingCurrency =
    initialPrimaryData?.summary.reportingCurrency
    ?? resolveExpectedReportingCurrency(preferences);
  const initialPortfolioConfig = initialPrimaryData
    ? {
      accounts: initialPrimaryData.accounts,
      feeProfiles: initialPrimaryData.feeProfiles,
      feeProfileBindings: initialPrimaryData.feeProfileBindings,
      integrityIssue: initialPrimaryData.actions.integrityIssue,
      capabilities: initialPrimaryData.capabilities,
    }
    : null;
  const locale = settings?.locale ?? "en";
  const loadingCopy = getRouteLoadingLabels(locale).dashboard;
  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="dashboard"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        initialSettings={settings}
        initialPortfolioConfig={initialPortfolioConfig}
        initialSidebarOpen={sidebarOpen}
      >
        <DashboardClient
          expectedReportingCurrency={expectedReportingCurrency}
          initialPrimaryData={initialPrimaryData}
        />
      </AppShell>
    </Suspense>
  );
}

function resolveExpectedReportingCurrency(
  preferences: UserPreferencesResponse | null,
): AccountDefaultCurrency | null {
  if (preferences === null) return null;
  const currency = preferences.preferences?.reportingCurrency;
  return typeof currency === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(currency)
    ? currency as AccountDefaultCurrency
    : "TWD";
}
