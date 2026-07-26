"use client";

import { useMemo } from "react";
import type {
  AccountDto,
  AccountDefaultCurrency,
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  LocaleCode,
  PortfolioCapabilitiesDto,
  RouteCachePolicyDto,
  ShareCapability,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n/types";
import type {
  AppShellData,
  AppShellTransactionAccountOption,
} from "./AppShellDataContext";
import type { IntegrityIssue } from "../../features/dashboard/types";
import type { SharedContextPermissions } from "../../features/sharing/capabilities";
import type { useTransactionSubmission as useTransactionSubmissionType } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { useTransactionMutations as useTransactionMutationsType } from "../../features/portfolio/hooks/useTransactionMutations";
import type { useRecomputeAction as useRecomputeActionType } from "../../features/portfolio/hooks/useRecomputeAction";

interface BuildAppShellDataValueOptions {
  uiDict: AppDictionary;
  locale: LocaleCode;
  sessionUserId: string | null;
  contextOwnerId: string | null;
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
  applyAccountLifecycleMutationResponse: (
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => void;
  isReportingCurrencySaving: boolean;
  reportingCurrencyError: string;
  transactionSubmission: ReturnType<typeof useTransactionSubmissionType>;
  mutations: ReturnType<typeof useTransactionMutationsType>;
  recomputeAction: ReturnType<typeof useRecomputeActionType>;
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
  contextRefreshSignal: number;
}

/**
 * Builds the memoized `AppShellData` provider value consumed by every page
 * via `useAppShellData()`. Extracted from `AppShell.tsx` per Phase 3c spec
 * target (AppShell ≤300 LOC).
 */
export function useAppShellDataValue(options: BuildAppShellDataValueOptions): AppShellData {
  const {
    uiDict,
    locale,
    sessionUserId,
    contextOwnerId,
    sessionUserRole,
    routeCachePolicy,
    isSharedContext,
    switcherLoaded,
    currentSharedCapabilities,
    sharedContextPermissions,
    canUseGlobalQuickActions,
    openQuickActions,
    portfolioCapabilities,
    reportingCurrency,
    saveReportingCurrency,
    applyAccountMutationResponse,
    applyAccountLifecycleMutationResponse,
    isReportingCurrencySaving,
    reportingCurrencyError,
    transactionSubmission,
    mutations,
    recomputeAction,
    openRecomputeConfirm,
    transactionAccountOptions,
    accounts,
    feeProfiles,
    feeProfileBindings,
    refreshPortfolioConfig,
    isPortfolioConfigLoading,
    integrityIssue,
    showIntegrityDialog,
    setShowIntegrityDialog,
    generateSnapshots,
    isGeneratingSnapshots,
    contextRefreshSignal,
  } = options;

  return useMemo<AppShellData>(
    () => ({
      uiDict,
      locale,
      sessionUserId,
      contextOwnerId,
      sessionUserRole,
      routeCachePolicy,
      isSharedContext,
      switcherLoaded,
      currentSharedCapabilities,
      sharedContextPermissions,
      canUseGlobalQuickActions,
      openQuickActions,
      portfolioCapabilities,
      reportingCurrency,
      saveReportingCurrency,
      applyAccountMutationResponse,
      applyAccountLifecycleMutationResponse,
      isReportingCurrencySaving,
      reportingCurrencyError,
      transactionSubmission,
      mutations,
      recomputeAction,
      openRecomputeConfirm,
      transactionAccountOptions,
      accounts,
      feeProfiles,
      feeProfileBindings,
      refreshPortfolioConfig,
      isPortfolioConfigLoading,
      integrityIssue,
      showIntegrityDialog,
      setShowIntegrityDialog,
      generateSnapshots,
      isGeneratingSnapshots,
      contextRefreshSignal,
    }),
    [
      accounts,
      canUseGlobalQuickActions,
      contextOwnerId,
      contextRefreshSignal,
      currentSharedCapabilities,
      feeProfileBindings,
      feeProfiles,
      generateSnapshots,
      integrityIssue,
      isReportingCurrencySaving,
      isGeneratingSnapshots,
      isPortfolioConfigLoading,
      isSharedContext,
      switcherLoaded,
      locale,
      mutations,
      openQuickActions,
      portfolioCapabilities,
      openRecomputeConfirm,
      recomputeAction,
      reportingCurrency,
      reportingCurrencyError,
      refreshPortfolioConfig,
      applyAccountMutationResponse,
      applyAccountLifecycleMutationResponse,
      routeCachePolicy,
      saveReportingCurrency,
      sessionUserId,
      sessionUserRole,
      sharedContextPermissions,
      setShowIntegrityDialog,
      showIntegrityDialog,
      transactionAccountOptions,
      transactionSubmission,
      uiDict,
    ],
  );
}
