"use client";

import { createContext, useContext, type ReactNode } from "react";
import type {
  AccountDto,
  AccountDefaultCurrency,
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
  AccountType,
  FeeProfileBindingDto,
  FeeProfileDto,
  LocaleCode,
  PortfolioCapabilitiesDto,
  RouteCachePolicyDto,
  ShareCapability,
} from "@vakwen/shared-types";
import type { IntegrityIssue } from "../../features/dashboard/types";
import type { SharedContextPermissions } from "../../features/sharing/capabilities";
import type { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import type { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import type { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { getDictionary } from "../../lib/i18n";

export interface AppShellTransactionAccountOption {
  id: string;
  name: string;
  feeProfileName: string;
  defaultCurrency: AccountDefaultCurrency;
  accountType?: AccountType;
}

export interface AppShellData {
  uiDict: ReturnType<typeof getDictionary>;
  locale: LocaleCode;
  sessionUserId: string | null;
  contextOwnerId?: string | null;
  sessionUserRole?: string | null;
  routeCachePolicy?: RouteCachePolicyDto | null;
  isSharedContext: boolean;
  switcherLoaded: boolean;
  currentSharedCapabilities: ShareCapability[];
  sharedContextPermissions: SharedContextPermissions;
  canUseGlobalQuickActions: boolean;
  openQuickActions: () => void;
  portfolioCapabilities: PortfolioCapabilitiesDto | null;
  reportingCurrency: AccountDefaultCurrency;
  saveReportingCurrency: (
    currency: AccountDefaultCurrency,
    options?: { refreshRouter?: boolean },
  ) => Promise<void>;
  applyAccountMutationResponse: (response: AccountMutationResponseDto) => void;
  applyAccountLifecycleMutationResponse?: (
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => void;
  isReportingCurrencySaving: boolean;
  reportingCurrencyError: string;
  transactionSubmission: ReturnType<typeof useTransactionSubmission>;
  mutations: ReturnType<typeof useTransactionMutations>;
  recomputeAction: ReturnType<typeof useRecomputeAction>;
  openRecomputeConfirm: () => void;
  transactionAccountOptions: AppShellTransactionAccountOption[];
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  refreshPortfolioConfig: () => Promise<void>;
  isPortfolioConfigLoading: boolean;
  integrityIssue: IntegrityIssue | null;
  showIntegrityDialog: boolean;
  setShowIntegrityDialog: (open: boolean) => void;
  generateSnapshots: () => Promise<void>;
  isGeneratingSnapshots: boolean;
  // Bumped by AppShell whenever shared-context cookie changes (switcher
  // select, ?as= deep link, fallback revoke). DashboardClient /
  // TransactionsClient watch this and call their hook .refresh() so their
  // page-scoped data picks up the new owner without remount.
  contextRefreshSignal: number;
}

const AppShellDataCtx = createContext<AppShellData | null>(null);

export function AppShellDataProvider({
  value,
  children,
}: {
  value: AppShellData;
  children: ReactNode;
}) {
  return <AppShellDataCtx.Provider value={value}>{children}</AppShellDataCtx.Provider>;
}

export function useAppShellData(): AppShellData {
  const value = useContext(AppShellDataCtx);
  if (!value) {
    throw new Error("useAppShellData must be used inside <AppShellDataProvider>");
  }
  return value;
}

/**
 * Non-throwing variant — returns `null` outside the provider. Useful for
 * leaf chrome components (e.g. the Breadcrumb) that render inside BOTH the
 * user shell (with AppShellDataProvider) and the admin shell (without).
 */
export function useOptionalAppShellData(): AppShellData | null {
  return useContext(AppShellDataCtx);
}
