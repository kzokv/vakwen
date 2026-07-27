import { Suspense } from "react";
import type { LocaleCode, UserSettings } from "@vakwen/shared-types";
import { CashLedgerClient } from "../../features/cash-ledger/components/CashLedgerClient";
import { DashboardLoading } from "../../components/dashboard/DashboardLoading";
import { AppShell } from "../../components/layout/AppShell";
import { getRouteLoadingLabels } from "../../components/layout/i18n";
import { requireSession } from "../../lib/auth";
import { getJson } from "../../lib/api";
import { readSidebarStateCookie } from "../../lib/sidebar-cookie";
import { getDictionary } from "../../lib/i18n";
import type { ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";

export default async function CashLedgerPage() {
  const [session, profile, sidebarOpen, settings] = await Promise.all([
    requireSession(),
    getJson<ProfileWithImpersonationDto>("/profile", { contextScope: "session" }),
    readSidebarStateCookie(),
    getJson<UserSettings>("/settings", { contextScope: "session" }).catch(() => null),
  ]);

  const locale: LocaleCode = settings?.locale ?? "en";
  const dict = getDictionary(locale);
  const loadingCopy = getRouteLoadingLabels(locale).cashLedger;

  return (
    <Suspense fallback={<DashboardLoading standalone locale={locale} loadingCopy={loadingCopy} />}>
      <AppShell
        section="cash-ledger"
        isDemo={session.isDemo}
        localeOverride={locale}
        initialProfile={profile}
        portfolioConfigMode="eager"
        initialSidebarOpen={sidebarOpen}
      >
        <CashLedgerClient
          initialData={null}
          initialAccounts={[]}
          initialAccountMetaReady={false}
          initialDataReady={false}
          dict={dict}
          locale={locale}
        />
      </AppShell>
    </Suspense>
  );
}
