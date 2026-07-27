"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  type AccountDefaultCurrency,
  type AccountLifecycleMutationResponseDto,
  type AccountMutationResponseDto,
  type LocaleCode,
  type PortfolioCapabilitiesDto,
  type SnapshotsGeneratedEvent,
  type UserSettings,
} from "@vakwen/shared-types";
import { getDictionary } from "../../lib/i18n";
import { getJson, patchJson } from "../../lib/api";
import {
  clearPortfolioContextRouteCaches,
  clearRouteDtoCacheByPrefix,
  getRouteDtoCachePrefix,
} from "../../lib/routeDtoCache";
import { useNotifications } from "../../hooks/useNotifications";
import { useCommandPalette } from "../../hooks/useCommandPalette";
import { useEventStream } from "../../hooks/useEventStream";
import { useProfile, type ProfileWithImpersonationDto } from "../../features/profile/hooks/useProfile";
import { useRecomputeAction } from "../../features/portfolio/hooks/useRecomputeAction";
import { useTransactionMutations } from "../../features/portfolio/hooks/useTransactionMutations";
import { useTransactionSubmission } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionInput } from "../portfolio/types";
import { AddTransactionDialog } from "../portfolio/AddTransactionDialog";
import { RecomputeConfirmDialog } from "../portfolio/RecomputeConfirmDialog";
import { FloatingQuickActions } from "../dashboard/FloatingQuickActions";
import { AppShellLayout } from "./AppShellLayout";
import { BreadcrumbProvider } from "./BreadcrumbProvider";
import { CommandPalette } from "./CommandPalette";
import { CommandPaletteProvider } from "./CommandPaletteContext";
import { AppShellDataProvider } from "./AppShellDataContext";
import { ImpersonationBanner } from "./ImpersonationBanner";
import { NavigationFeedbackProvider } from "./NavigationFeedbackContext";
import { PortfolioSwitcher } from "./PortfolioSwitcher";
import { useAppNavigation } from "./useAppNavigation";
import { useAppShellDataValue } from "./useAppShellDataValue";
import { useSharedContext } from "./useSharedContext";
import { useShellInstrumentIndex } from "./useShellInstrumentIndex";
import { useShellPortfolioConfig } from "./useShellPortfolioConfig";
import { useSnapshotGeneration } from "./useSnapshotGeneration";
import { deriveSharedContextPermissions } from "../../features/sharing/capabilities";
import type { ShellPortfolioConfigSeedDto } from "../../features/settings/services/shellPortfolioConfigService";

type AppSection = "dashboard" | "analysis" | "reports" | "portfolio" | "transactions" | "dividends" | "cash-ledger";

interface AppShellProps {
  section?: AppSection;
  isDemo?: boolean;
  localeOverride?: LocaleCode;
  titleOverride?: string;
  descriptionOverride?: string;
  activeSectionOverride?: AppSection | null;
  initialProfile?: ProfileWithImpersonationDto | null;
  initialSettings?: UserSettings | null;
  initialPortfolioConfig?: ShellPortfolioConfigSeedDto | null;
  portfolioConfigMode?: "eager" | "lazy";
  initialSidebarOpen?: boolean;
  children?: React.ReactNode;
}

interface UserPreferencesResponse {
  preferences?: {
    reportingCurrency?: unknown;
  } | null;
}

const DEFAULT_TRANSACTION: TransactionInput = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD",
  tradeDate: new Date().toISOString().slice(0, 10),
  type: "BUY",
  isDayTrade: false,
};

function isEditableQuickActionsPath(pathname: string): boolean {
  return [
    "/dashboard",
    "/analysis",
    "/reports",
    "/portfolio",
    "/transactions",
    "/dividends",
    "/cash-ledger",
    "/tickers",
  ].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function normalizeReportingCurrency(value: unknown): AccountDefaultCurrency {
  return typeof value === "string" && (ACCOUNT_DEFAULT_CURRENCIES as readonly string[]).includes(value)
    ? value as AccountDefaultCurrency
    : "TWD";
}

export function AppShell({
  section: _section = "dashboard",
  isDemo = false,
  localeOverride,
  titleOverride: _titleOverride,
  descriptionOverride: _descriptionOverride,
  activeSectionOverride: _activeSectionOverride,
  initialProfile = null,
  initialSettings = null,
  initialPortfolioConfig = null,
  portfolioConfigMode = "eager",
  initialSidebarOpen = true,
  children,
}: AppShellProps) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [isClientReady, setIsClientReady] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);
  const [reportingCurrency, setReportingCurrency] = useState<AccountDefaultCurrency>("TWD");
  const [isReportingCurrencySaving, setIsReportingCurrencySaving] = useState(false);
  const [reportingCurrencyError, setReportingCurrencyError] = useState("");
  const [portfolioCapabilities, setPortfolioCapabilities] = useState<PortfolioCapabilitiesDto | null>(
    initialPortfolioConfig?.capabilities ?? null,
  );

  const portfolioConfig = useShellPortfolioConfig({
    initialTransaction: DEFAULT_TRANSACTION,
    initialConfig: initialPortfolioConfig,
    fetchMode: portfolioConfigMode,
  });
  const profileData = useProfile(initialProfile);
  const sessionUserId = profileData.profile?.userId ?? initialProfile?.userId ?? null;
  const impersonation = profileData.profile?.impersonation
    && profileData.profile.impersonation.active !== false
    ? profileData.profile.impersonation
    : null;

  const locale: LocaleCode = localeOverride ?? "en";
  const dict = useMemo(() => getDictionary(locale), [locale]);

  const sharedContext = useSharedContext({
    refreshDashboard: async () => {
      await portfolioConfig.refresh();
    },
    refreshProfile: profileData.refresh,
    dict,
  });
  const {
    inboundShares,
    switcherLoaded,
    currentContextOwnerId,
    currentSharedOwner,
    currentSharedOwnerLabel,
    isSharedContext,
    contextMessage,
    contextRefreshSignal,
    bumpContextRefreshSignal,
    refreshContextDependentData,
    handleContextSelect,
    handleSharingNotification,
  } = sharedContext;

  const uiDict = useMemo(() => {
    if (!isSharedContext) return dict;
    return {
      ...dict,
      dashboardHome: {
        ...dict.dashboardHome,
        holdingsEmpty: dict.switcher.sharedHoldingsEmpty.replace("{owner}", currentSharedOwnerLabel),
      },
      transactions: {
        ...dict.transactions,
        recentLedgerEmpty: dict.switcher.sharedTransactionsEmpty.replace("{owner}", currentSharedOwnerLabel),
      },
    };
  }, [currentSharedOwnerLabel, dict, isSharedContext]);
  const currentSharedCapabilities = currentSharedOwner?.capabilities ?? [];
  const sharedContextPermissions = useMemo(
    () => deriveSharedContextPermissions(currentSharedCapabilities),
    [currentSharedCapabilities],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
      .then((response) => {
        if (cancelled) return;
        setReportingCurrency(normalizeReportingCurrency(response?.preferences?.reportingCurrency));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setPortfolioCapabilities(portfolioConfig.capabilities ?? null);
  }, [portfolioConfig.capabilities]);

  const refreshAfterTransaction = useCallback(async () => {
    clearRouteDtoCacheByPrefix(getRouteDtoCachePrefix());
    await portfolioConfig.refresh();
    bumpContextRefreshSignal();
  }, [bumpContextRefreshSignal, portfolioConfig]);

  const transactionSubmission = useTransactionSubmission({
    initialValue: DEFAULT_TRANSACTION,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: refreshAfterTransaction,
  });

  const recomputeAction = useRecomputeAction({
    locale,
    refresh: refreshAfterTransaction,
    previewRefreshedMessage: dict.recompute.previewRefreshed,
  });

  const snapshotGeneration = useSnapshotGeneration({
    dict,
    onSuccess: bumpContextRefreshSignal,
  });
  useEventStream({
    eventType: "snapshots_generated",
    onEvent: (event) => snapshotGeneration.handleSnapshotsGenerated(event as SnapshotsGeneratedEvent),
  });

  const mutations = useTransactionMutations({
    locale,
    dict,
    refresh: refreshAfterTransaction,
  });

  const notificationData = useNotifications({ onSharingNotification: handleSharingNotification });
  const [notificationDropdownOpen, setNotificationDropdownOpen] = useState(false);

  const transactionAccountOptions = useMemo(
    () =>
      portfolioConfig.accounts.map((account) => ({
        id: account.id,
        name: account.name,
        feeProfileName:
          portfolioConfig.feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
        defaultCurrency: account.defaultCurrency,
        accountType: account.accountType,
      })),
    [portfolioConfig.accounts, portfolioConfig.feeProfiles],
  );

  useEffect(() => {
    transactionSubmission.setDraftTransaction((previous) => portfolioConfig.synchronizeTransactionDraft(previous));
  }, [portfolioConfig.synchronizeTransactionDraft, transactionSubmission.setDraftTransaction]);

  const globalError = transactionSubmission.errorMessage || recomputeAction.errorMessage || portfolioConfig.errorMessage;

  const shellInstruments = useShellInstrumentIndex(contextRefreshSignal);
  const { quickSearchItems } = useAppNavigation(dict, shellInstruments);

  const handleClearGlobalError = useCallback(() => {
    portfolioConfig.setErrorMessage("");
    transactionSubmission.setErrorMessage("");
    recomputeAction.setErrorMessage("");
    void (async () => {
      await portfolioConfig.refresh();
      bumpContextRefreshSignal();
    })().catch(() => undefined);
  }, [bumpContextRefreshSignal, portfolioConfig, recomputeAction, transactionSubmission]);

  const handleReportingCurrencySaved = useCallback(() => {
    clearPortfolioContextRouteCaches();
    bumpContextRefreshSignal();
  }, [bumpContextRefreshSignal]);

  const saveReportingCurrency = useCallback(async (
    next: AccountDefaultCurrency,
    options?: { refreshRouter?: boolean },
  ) => {
    if (isReportingCurrencySaving || next === reportingCurrency) return;

    const previous = reportingCurrency;
    setReportingCurrency(next);
    setIsReportingCurrencySaving(true);
    setReportingCurrencyError("");

    try {
      await patchJson("/user-preferences", { reportingCurrency: next }, { contextScope: "session" });
      handleReportingCurrencySaved();
      if (options?.refreshRouter !== false) {
        router.refresh();
      }
    } catch (error) {
      setReportingCurrency(previous);
      setReportingCurrencyError(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setIsReportingCurrencySaving(false);
    }
  }, [handleReportingCurrencySaved, isReportingCurrencySaving, reportingCurrency, router]);

  const applyAccountMutationResponse = useCallback((response: AccountMutationResponseDto) => {
    portfolioConfig.applyAccountMutation(response);
    setPortfolioCapabilities(response.capabilities);
    if (response.reportingCurrency.effective) {
      setReportingCurrency(response.reportingCurrency.effective);
      setReportingCurrencyError("");
    }
  }, [portfolioConfig]);

  const applyAccountLifecycleMutationResponse = useCallback((
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => {
    portfolioConfig.applyAccountLifecycleMutation(response, operation);
    setPortfolioCapabilities(response.capabilities);
    if (response.reportingCurrency.effective) {
      setReportingCurrency(response.reportingCurrency.effective);
      setReportingCurrencyError("");
    }
  }, [portfolioConfig]);

  const accountEventRefreshIdRef = useRef(0);
  useEventStream({
    eventTypes: [
      "account_created",
      "account_updated",
      "account_soft_deleted",
      "account_restored",
      "account_hard_purged",
    ],
    onEvent: () => {
      const refreshId = ++accountEventRefreshIdRef.current;
      clearPortfolioContextRouteCaches();
      bumpContextRefreshSignal();
      void (async () => {
        const nextConfig = await portfolioConfig.refresh();
        if (!nextConfig || refreshId !== accountEventRefreshIdRef.current) return;
        setPortfolioCapabilities(nextConfig.capabilities ?? null);
        const preferenceResponse = await getJson<{
          preferences: { reportingCurrency?: AccountDefaultCurrency };
        }>("/user-preferences", { contextScope: "session" });
        if (refreshId !== accountEventRefreshIdRef.current) return;
        const requested = preferenceResponse.preferences.reportingCurrency ?? null;
        const effective = requested
          && nextConfig.capabilities?.configuredCurrencies.includes(requested)
          ? requested
          : nextConfig.capabilities?.configuredCurrencies[0] ?? null;
        if (effective) {
          setReportingCurrency(effective);
          setReportingCurrencyError("");
        }
      })().catch(() => undefined);
    },
  });

  const previousSessionUserIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (previousSessionUserIdRef.current === undefined) {
      previousSessionUserIdRef.current = sessionUserId;
      return;
    }
    if (sessionUserId !== null && previousSessionUserIdRef.current !== sessionUserId) {
      clearRouteDtoCacheByPrefix(getRouteDtoCachePrefix());
    }
    previousSessionUserIdRef.current = sessionUserId;
  }, [sessionUserId]);

  const commandPalette = useCommandPalette();
  const [addTransactionDialogOpen, setAddTransactionDialogOpen] = useState(false);
  const [recomputeDialogOpen, setRecomputeDialogOpen] = useState(false);

  const handleAddTransactionFromPalette = useCallback(() => {
    void (async () => {
      await portfolioConfig.ensureLoaded();
      setAddTransactionDialogOpen(true);
    })().catch(() => undefined);
  }, [portfolioConfig]);

  const handleRecomputeFromPalette = useCallback(() => {
    void (async () => {
      await portfolioConfig.ensureLoaded();
      recomputeAction.reset();
      setRecomputeDialogOpen(true);
    })().catch(() => undefined);
  }, [portfolioConfig, recomputeAction]);

  const canUseGlobalQuickActions = isEditableQuickActionsPath(pathname)
    && (!isSharedContext || sharedContextPermissions.canWriteTransactions);
  const showSharedContextStrip = isSharedContext
    && (!pathname.startsWith("/settings/") || pathname === "/settings/accounts");
  const handleQuickActionsOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen) {
      setQuickActionsOpen(false);
      return;
    }
    void portfolioConfig.ensureLoaded()
      .then(() => setQuickActionsOpen(true))
      .catch(() => undefined);
  }, [portfolioConfig.ensureLoaded]);

  const appShellDataValue = useAppShellDataValue({
    uiDict,
    locale,
    sessionUserId,
    contextOwnerId: currentContextOwnerId ?? sessionUserId,
    sessionUserRole: profileData.profile?.role ?? null,
    routeCachePolicy: initialSettings?.effectiveRouteCachePolicy ?? null,
    isSharedContext,
    switcherLoaded,
    currentSharedCapabilities,
    sharedContextPermissions,
    canUseGlobalQuickActions,
    openQuickActions: () => handleQuickActionsOpenChange(true),
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
    openRecomputeConfirm: handleRecomputeFromPalette,
    transactionAccountOptions,
    accounts: portfolioConfig.accounts,
    feeProfiles: portfolioConfig.feeProfiles,
    feeProfileBindings: portfolioConfig.feeProfileBindings,
    refreshPortfolioConfig: async () => {
      await portfolioConfig.refresh();
    },
    isPortfolioConfigLoading: portfolioConfig.isLoading,
    portfolioConfigError: portfolioConfig.errorMessage,
    integrityIssue: portfolioConfig.integrityIssue,
    showIntegrityDialog: portfolioConfig.showIntegrityDialog,
    setShowIntegrityDialog: portfolioConfig.setShowIntegrityDialog,
    generateSnapshots: snapshotGeneration.generateSnapshots,
    isGeneratingSnapshots: snapshotGeneration.isGeneratingSnapshots,
    contextRefreshSignal,
  });

  const portfolioSwitcher = inboundShares.length > 0 ? (
    <PortfolioSwitcher
      inboundActive={inboundShares}
      currentContextOwnerId={currentContextOwnerId}
      onSelect={handleContextSelect}
      dict={uiDict.switcher}
    />
  ) : null;

  const handleRecomputeConfirm = useCallback(() => {
    void recomputeAction.confirmPreview().then((confirmed) => {
      if (confirmed) setRecomputeDialogOpen(false);
    });
  }, [recomputeAction]);

  const handleExitSharedContext = useCallback(() => {
    handleContextSelect(null);
    router.push("/portfolio");
  }, [handleContextSelect, router]);

  const commandPaletteContextValue = useMemo(
    () => ({
      open: commandPalette.open,
      setOpen: commandPalette.setOpen,
      openWithQuery: commandPalette.openWithQuery,
    }),
    [commandPalette.open, commandPalette.setOpen, commandPalette.openWithQuery],
  );

  return (
    <div className="app-shell relative flex min-h-screen w-full min-w-0 max-w-full flex-col overflow-x-clip" data-testid="app-shell">
      {isDemo ? (
        <div
          className="flex h-8 items-center justify-center bg-amber-100 text-xs font-medium text-amber-800"
          data-testid="demo-banner"
        >
          {dict.feedback.demoSession}
        </div>
      ) : null}

      <ImpersonationBanner
        impersonation={impersonation}
        onRefreshContext={refreshContextDependentData}
      />

      <BreadcrumbProvider locale={locale}>
        <AppShellDataProvider value={appShellDataValue}>
          <CommandPaletteProvider value={commandPaletteContextValue}>
            <NavigationFeedbackProvider>
              <AppShellLayout
                initialSidebarOpen={initialSidebarOpen}
                profileData={profileData}
                integrityIssue={portfolioConfig.integrityIssue}
                showIntegrityDialog={portfolioConfig.showIntegrityDialog}
                setShowIntegrityDialog={portfolioConfig.setShowIntegrityDialog}
                dict={dict}
                uiDict={uiDict}
                locale={locale}
                isSharedContext={showSharedContextStrip}
                sharedOwnerId={currentContextOwnerId ?? currentSharedOwnerLabel}
                sharedOwnerLabel={currentSharedOwnerLabel}
                onExitSharedContext={handleExitSharedContext}
                switcherSlot={portfolioSwitcher}
                quickSearchItems={quickSearchItems}
                unreadCount={notificationData.unreadCount}
                notifications={notificationData.notifications}
                notificationDropdownOpen={notificationDropdownOpen}
                onNotificationOpenChange={setNotificationDropdownOpen}
                markRead={notificationData.markRead}
                markAllRead={notificationData.markAllRead}
                dismiss={notificationData.dismiss}
                contextMessage={contextMessage}
                globalError={globalError}
                transactionMessage={transactionSubmission.message}
                recomputeMessage={recomputeAction.message}
                snapshotMessage={snapshotGeneration.snapshotMessage}
                mutationsMessage={mutations.message}
                mutationsErrorMessage={mutations.errorMessage}
                onClearGlobalError={handleClearGlobalError}
                isClientReady={isClientReady}
                switcherLoaded={switcherLoaded}
                onTimeframesSaved={() => undefined}
                onReportingCurrencySaved={handleReportingCurrencySaved}
              >
                {children ?? null}
              </AppShellLayout>
            </NavigationFeedbackProvider>

            <CommandPalette
              open={commandPalette.open}
              onOpenChange={commandPalette.setOpen}
              initialQuery={commandPalette.initialQuery}
              dict={dict}
              onAddTransaction={handleAddTransactionFromPalette}
              onRecomputeAll={handleRecomputeFromPalette}
              showAddTransactionAction={!isSharedContext || sharedContextPermissions.canWriteTransactions}
              showRecomputeAction={!isSharedContext}
            />

            <AddTransactionDialog
              open={addTransactionDialogOpen}
              onOpenChange={setAddTransactionDialogOpen}
              value={transactionSubmission.draftTransaction}
              onChange={transactionSubmission.setDraftTransaction}
              onUnitPriceEdited={transactionSubmission.markUnitPriceEdited}
              onSubmit={async () => {
                const ok = await transactionSubmission.submit();
                if (ok) setAddTransactionDialogOpen(false);
              }}
              pending={transactionSubmission.isSubmitting}
              accountOptions={transactionAccountOptions}
              availableMarkets={portfolioConfig.capabilities?.configuredMarkets ?? []}
              message={transactionSubmission.message}
              errorMessage={transactionSubmission.errorMessage}
              dict={dict}
              locale={locale}
              priceHint={transactionSubmission.priceHint}
              showPriceUnavailableHint={transactionSubmission.showPriceUnavailableHint}
              feeEstimate={transactionSubmission.feeEstimate}
              sellAvailability={transactionSubmission.sellAvailability}
              sellAvailabilityRequestKey={transactionSubmission.sellAvailabilityRequestKey}
              isSellAvailabilityLoading={transactionSubmission.isSellAvailabilityLoading}
              sellAvailabilityTransportError={transactionSubmission.sellAvailabilityTransportError}
            />

            <RecomputeConfirmDialog
              open={recomputeDialogOpen}
              onOpenChange={setRecomputeDialogOpen}
              feeMode={recomputeAction.feeMode}
              onFeeModeChange={recomputeAction.setFeeMode}
              preview={recomputeAction.preview}
              onRequestPreview={() => {
                void recomputeAction.requestPreview();
              }}
              onConfirm={handleRecomputeConfirm}
              dict={dict}
              locale={locale}
              isPreviewLoading={recomputeAction.isPreviewLoading}
              isConfirming={recomputeAction.isConfirming}
              errorMessage={recomputeAction.errorMessage}
              statusMessage={recomputeAction.message}
            />

            <FloatingQuickActions
              hidden={!canUseGlobalQuickActions}
              open={quickActionsOpen}
              onOpenChange={handleQuickActionsOpenChange}
              portfolioCapabilities={portfolioCapabilities}
              isSharedContext={isSharedContext}
              canManageAccounts={!isSharedContext || sharedContextPermissions.canManageAccounts}
              reportingCurrency={reportingCurrency}
              onReportingCurrencyChange={saveReportingCurrency}
              isReportingCurrencySaving={isReportingCurrencySaving}
              reportingCurrencyError={reportingCurrencyError}
              onAddTransaction={handleAddTransactionFromPalette}
              onRecompute={handleRecomputeFromPalette}
              onGenerateSnapshots={snapshotGeneration.generateSnapshots}
              isGeneratingSnapshots={snapshotGeneration.isGeneratingSnapshots}
              showRecomputeAction={!isSharedContext}
              showGenerateSnapshotsAction={!isSharedContext}
              dict={dict}
            />
          </CommandPaletteProvider>
        </AppShellDataProvider>
      </BreadcrumbProvider>
    </div>
  );
}
