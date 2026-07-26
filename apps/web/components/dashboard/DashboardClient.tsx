"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { AccountDefaultCurrency, DashboardPerformanceRange, LocaleCode, PriceRefreshPendingDto } from "@vakwen/shared-types";
import { cn, formatCompactCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { useDashboardPrimaryData } from "../../features/dashboard/hooks/useDashboardData";
import { useDashboardPerformance } from "../../features/dashboard/hooks/useDashboardPerformance";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import Link from "next/link";
import { AlertTriangle, RotateCw } from "lucide-react";
import { AllocationSnapshotCard } from "./AllocationSnapshotCard";
import { BiggestMoversCard } from "./BiggestMoversCard";
import { DashboardHero } from "./DashboardHero";
import { DashboardHoldingsPreview } from "./DashboardHoldingsPreview";
import { Alert, AlertDescription, AlertTitle } from "../ui/shadcn/alert";
import { Button } from "../ui/Button";
import { DASHBOARD_CARDS } from "./cards";
import { DashboardLoading } from "./DashboardLoading";
import { DividendsSection } from "./DividendsSection";
import { PortfolioTrendCard } from "./PortfolioTrendCard";
import { ReturnPercentCard } from "./ReturnPercentCard";
import { CustomizeRangesPopover } from "../settings/CustomizeRangesPopover";
import { resolveHoldingGroups, type DashboardOverviewHoldingGroupDto } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";
import { buildRouteDtoCacheKey, getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { refreshPortfolioCloses } from "../../features/portfolio/services/portfolioService";
import type { AppDictionary } from "../../lib/i18n";
import { Badge } from "../ui/shadcn/badge";
import { getRouteLoadingLabels } from "../layout/i18n";
import type { TimelineMode } from "../../lib/timelineAxis";
import { hydrateDashboardMarketStates, shouldPollForOpenMarket, type DashboardMarketStateLike } from "../../features/price-state/priceState";
import { buildUnrealizedPnlRoutePath } from "../../features/analysis/unrealizedPnlRouteState";
import { buildDashboardReportsHealthHref } from "../../features/reports/reportHealthDeepLinks";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";
import { getPortfolioCapabilityOptionSets } from "../../features/portfolio-capabilities/portfolioCapabilities";
import {
  Card as ShadcnCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/shadcn/card";
import type { DashboardSnapshot } from "../../features/dashboard/types";

const DEFAULT_TRANSACTION = {
  accountId: "",
  ticker: "",
  marketCode: null,
  quantity: 1000,
  unitPrice: 100,
  priceCurrency: "TWD" as const,
  tradeDate: new Date().toISOString().slice(0, 10),
  type: "BUY" as const,
  isDayTrade: false,
};

export function DashboardClient({
  initialPrimaryData = null,
  expectedReportingCurrency,
}: {
  expectedReportingCurrency?: AccountDefaultCurrency | null;
  initialPrimaryData?: DashboardSnapshot | null;
}) {
  const {
    uiDict: dict,
    locale,
    routeCachePolicy,
    sessionUserId,
    sessionUserRole,
    isSharedContext,
    canUseGlobalQuickActions,
    openQuickActions,
    portfolioCapabilities,
    reportingCurrency,
    recomputeAction,
    openRecomputeConfirm,
    sharedContextPermissions,
    contextRefreshSignal,
  } = useAppShellData();
  const cacheKey = buildRouteDtoCacheKey("dashboard-primary", getRouteDtoContextScope(sessionUserId), locale);
  const initialDashboardPollMs = resolveTickerPricePollMs(
    initialPrimaryData?.settings ?? null,
    initialPrimaryData?.settings,
  );
  const initialDashboardOpenMarketPollMs = isTickerPriceIntradayEnabled(initialPrimaryData?.settings)
    ? initialDashboardPollMs
    : null;
  const dashboard = useDashboardPrimaryData({
    cacheKey,
    cachePolicy: routeCachePolicy,
    expectedReportingCurrency,
    initialTransaction: DEFAULT_TRANSACTION,
    initialPrimaryData,
    openMarketPollMs: initialDashboardOpenMarketPollMs,
  });
  const resetCount = useCardLayoutResetCount("dashboard");
  const { allocationBasis } = useHoldingAllocationBasis();
  const [performanceRange, setPerformanceRange] = useState<DashboardPerformanceRange>("1M");
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("auto");
  const { effectiveRanges, refetch: refetchEffectiveRanges } = useEffectiveRanges();
  const [customizeRangesOpen, setCustomizeRangesOpen] = useState(false);
  const [isRefreshingCloses, setIsRefreshingCloses] = useState(false);
  const [closeRefreshError, setCloseRefreshError] = useState("");
  const performanceReportingCurrency = dashboard.summary.reportingCurrency ?? expectedReportingCurrency ?? reportingCurrency;
  const performanceCacheKey = buildRouteDtoCacheKey(
    "dashboard-performance",
    getRouteDtoContextScope(sessionUserId),
    locale,
    performanceReportingCurrency,
    performanceRange,
  );
  // DashboardClient only mounts on /dashboard; enabled unconditionally true.
  const performance = useDashboardPerformance({
    cacheKey: performanceCacheKey,
    cachePolicy: routeCachePolicy,
    range: performanceRange,
    enabled: true,
    expectedReportingCurrency: performanceReportingCurrency,
    timeoutMessage: dict.dashboardHome.performanceRefreshTimeout,
  });

  // Re-fetch performance series when AppShell signals a context/data change
  // (shared-context switch, trade mutation, recompute confirm, reporting-currency
  // save, snapshot generation, retry click). Initial mount skipped — the hook
  // performs its own first-load fetch.
  //
  // Phase 3d iter 2 §4.2 (architect-identified React #185 candidate) —
  // capture `performance.refresh` in a ref so the effect depends ONLY on
  // `contextRefreshSignal`. The previous form depended on `performance.refresh`
  // directly; if its identity ever shifted on a re-render triggered by
  // the refresh itself, the effect re-fired and looped (Maximum update
  // depth exceeded). The ref form is cycle-safe even if `useDashboardPerformance`
  // later changes its memoization shape.
  const firstSignalRef = useRef(true);
  const refreshDashboardRef = useRef(dashboard.refresh);
  refreshDashboardRef.current = dashboard.refresh;
  const refreshDashboardPricesRef = useRef(dashboard.refreshPrices);
  refreshDashboardPricesRef.current = dashboard.refreshPrices;
  const refreshPerformanceRef = useRef(performance.refresh);
  refreshPerformanceRef.current = performance.refresh;
  const refreshDashboardAndPerformance = () => {
    void dashboard.refresh();
    void performance.refresh();
  };
  const refreshDashboardPrices = () => {
    void dashboard.refreshPrices();
  };
  const refreshClosesAndDashboard = async () => {
    setIsRefreshingCloses(true);
    setCloseRefreshError("");
    try {
      await refreshPortfolioCloses();
      await dashboard.refresh();
      await performance.refresh();
    } catch (error) {
      setCloseRefreshError(error instanceof Error ? error.message : "Failed to refresh closes");
    } finally {
      setIsRefreshingCloses(false);
    }
  };
  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void refreshDashboardRef.current();
    void refreshPerformanceRef.current();
  }, [contextRefreshSignal]);

  useEffect(() => {
    if (effectiveRanges.length === 0) return;
    if (!effectiveRanges.includes(performanceRange)) {
      setPerformanceRange(effectiveRanges[0]);
    }
  }, [effectiveRanges, performanceRange]);

  const holdingGroups = resolveHoldingGroups({
    holdings: dashboard.holdings,
    holdingGroups: dashboard.holdingGroups,
    instruments: dashboard.instruments,
    accounts: dashboard.accounts,
  });
  const strictSummary = useMemo(() => {
    const hasUnavailableMarketValue = holdingGroups.some(hasIncompleteDashboardValuation);
    const hasUnavailableDailyChange = holdingGroups.some(hasIncompleteDashboardDailyChange);
    return {
      ...dashboard.summary,
      dailyChangeAmount: hasUnavailableDailyChange ? null : dashboard.summary.dailyChangeAmount,
      dailyChangePercent: hasUnavailableDailyChange ? null : dashboard.summary.dailyChangePercent,
      marketValueAmount: hasUnavailableMarketValue ? null : dashboard.summary.marketValueAmount,
    };
  }, [dashboard.summary, holdingGroups]);
  const restoredLabel = dashboard.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(dashboard.restoredAt))
    : null;
  const marketStates = useMemo(
    () => {
      const payloadStates = (dashboard as DashboardSnapshot & { marketStates?: DashboardMarketStateLike[] | null }).marketStates;
      return hydrateDashboardMarketStates(payloadStates, holdingGroups);
    },
    [dashboard, holdingGroups],
  );
  const dashboardPollMs = resolveTickerPricePollMs(dashboard.settings, initialPrimaryData?.settings);
  const shouldPollDashboardPrices = shouldPollForOpenMarket(dashboard.holdings, marketStates)
    && isTickerPriceIntradayEnabled(dashboard.settings, initialPrimaryData?.settings);
  const refreshPricesStatus = formatRefreshPricesPending(dict, dashboard.refreshPending ?? null);
  const dashboardHealthHref = buildDashboardReportsHealthHref();
  const dashboardFxHealthHref = buildDashboardReportsHealthHref(["missing_fx"]);
  const canManageAccounts = !isSharedContext || sharedContextPermissions.canManageAccounts;
  const dashboardCapabilities = dashboard.capabilities
    ?? initialPrimaryData?.capabilities
    ?? (dashboard.isBootstrapping ? portfolioCapabilities : null);
  const configuredDashboardMarkets = useMemo(
    () => dashboardCapabilities
      ? getPortfolioCapabilityOptionSets(dashboardCapabilities).configuredMarkets
      : [],
    [dashboardCapabilities],
  );

  useEffect(() => {
    if (!shouldPollDashboardPrices) return;
    const timer = window.setInterval(() => {
      void refreshDashboardPricesRef.current();
    }, dashboardPollMs);
    return () => window.clearInterval(timer);
  }, [dashboardPollMs, shouldPollDashboardPrices]);

  if (dashboard.isBootstrapping) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading locale={locale} loadingCopy={getRouteLoadingLabels(locale).dashboard} />
      </>
    );
  }

  if (dashboardCapabilities && configuredDashboardMarkets.length === 0) {
    return (
      <ZeroAccountSetupGate
        dict={dict}
        canManageAccounts={canManageAccounts}
        returnTo="/dashboard"
      />
    );
  }

  return (
    <div className="stagger grid min-w-0 gap-6">
      {/* Phase 5e — persistent integrity Alert above hero when an
          integrity issue is present. Not dismissible; clears when
          `integrityIssue` resolves on next dashboard fetch. */}
      {dashboard.actions.integrityIssue ? (
        <Alert variant="destructive" data-testid="dashboard-integrity-alert">
          <AlertTriangle className="size-4" aria-hidden="true" />
          <AlertTitle>{dict.dialogs.integrityTitle}</AlertTitle>
          <AlertDescription className="flex flex-col gap-3">
            <span>{dashboard.actions.integrityIssue.message}</span>
            <Button
              asChild
              size="sm"
              variant="secondary"
              className="self-start"
              data-testid="dashboard-integrity-alert-fix-cta"
            >
              <Link href="/settings">Fix in Settings</Link>
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Phase 5d — above-the-fold hero: total + day Δ + biggest movers.
          Hero block is non-draggable and fixed above the SortableCardGrid. */}
      <section
        className="grid gap-3 lg:grid-cols-[2fr_1fr]"
        data-testid="dashboard-hero-block"
      >
        <DashboardHero
          fxRates={dashboard.fxRates ?? []}
          holdingCount={holdingGroups.length}
          marketValues={dashboard.marketValues ?? []}
          summary={strictSummary}
          locale={locale}
          dict={dict}
          quoteRefreshVersion={dashboard.quoteRefreshVersion}
          canOpenQuickActions={canUseGlobalQuickActions}
          onOpenQuickActions={openQuickActions}
          dataHealthHref={dashboardHealthHref}
          fxHealthHref={dashboardFxHealthHref}
        />
        <BiggestMoversCard groups={holdingGroups} locale={locale} dict={dict} />
      </section>

      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        data-testid="dashboard-primary-refresh-strip"
      >
        <div className="flex flex-wrap items-center gap-2">
          {dashboard.restoredFromCache && restoredLabel ? (
            <span data-testid="dashboard-cache-restore-label">
              {formatDashboardMessage(dict.reports.restoredFromCache, { time: restoredLabel })}
            </span>
          ) : (
            <span>{dict.dashboardHome.primaryDataMountedDuringRefresh}</span>
          )}
          {dashboard.isRefreshing ? (
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              {dict.dashboardHome.silentRefreshRunning}
            </span>
          ) : null}
          {isRefreshingCloses ? (
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              {dict.dashboardHome.refreshClosesRunningLabel}
            </span>
          ) : null}
          {closeRefreshError ? (
            <span className="text-xs font-medium text-destructive">{closeRefreshError}</span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isSharedContext ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => { void refreshClosesAndDashboard(); }}
              disabled={dashboard.isRefreshing || performance.isLoading || isRefreshingCloses}
              data-testid="dashboard-refresh-closes-button"
            >
              {dict.dashboardHome.refreshClosesLabel}
            </Button>
          ) : null}
          {!isSharedContext ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={refreshDashboardPrices}
              disabled={dashboard.isRefreshing || performance.isLoading || isRefreshingCloses}
              data-testid="dashboard-refresh-prices-button"
            >
              {dict.dashboardHome.refreshPricesLabel}
            </Button>
          ) : null}
          {refreshPricesStatus ? (
            <span className="text-xs font-medium text-muted-foreground" data-testid="dashboard-refresh-prices-status">
              {refreshPricesStatus}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={refreshDashboardAndPerformance}
            disabled={dashboard.isRefreshing || performance.isLoading || isRefreshingCloses}
            data-testid="dashboard-refresh-button"
          >
            {dict.reports.refresh}
          </Button>
        </div>
        {!isSharedContext ? (
          <Button
            type="button"
            size="sm"
            onClick={openRecomputeConfirm}
            disabled={recomputeAction.isRunning}
            data-testid="recompute-button"
          >
            <RotateCw data-icon="inline-start" aria-hidden="true" />
            {recomputeAction.isRunning ? dict.actions.recomputing : dict.actions.recomputeHistory}
          </Button>
        ) : null}
      </div>

      {marketStates.length > 0 ? <DashboardMarketStateSummary dict={dict} marketStates={marketStates} /> : null}

      <DashboardCommandModules
        dict={dict}
        groups={holdingGroups}
        locale={locale}
        summary={dashboard.summary}
      />

      {/*
        KZO-161 (158C) F5: dashboard cards rendered as one flat
        `<SortableCardGrid>`. Render order is canonical ⋈ user-preference
        `cardOrder.dashboard` (unknown slugs dropped, new slugs appended).
        `ActionCenterSection` is also draggable (full-width slot at end of
        canonical list). `key` bumps on Reset Layout to re-fetch.
      */}
      <SortableCardGrid
        key={`card-grid-dashboard-${resetCount}`}
        cards={DASHBOARD_CARDS}
        orderKey="dashboard"
      >
        {(slug) => {
          switch (slug) {
            case "portfolio-trend":
              return (
                <PortfolioTrendCard
                  data={performance.data}
                  range={performanceRange}
                  ranges={effectiveRanges}
                  currency={dashboard.summary.reportingCurrency}
                  locale={locale}
                  dict={dict}
                  isLoading={performance.isLoading}
                  errorMessage={performance.errorMessage}
                  onRangeChange={setPerformanceRange}
                  showAdminActions={sessionUserRole === "admin"}
                  timelineMode={timelineMode}
                  onTimelineModeChange={setTimelineMode}
                  onOpenCustomize={() => setCustomizeRangesOpen(true)}
                  valuationHealth={performance.data?.valuationHealth ?? dashboard.valuationHealth}
                  dataHealthHref={dashboardHealthHref}
                  tickerRepairReturnTo="/dashboard"
                />
              );
            case "allocation-snapshot":
              return (
                <AllocationSnapshotCard
                  groups={holdingGroups}
                  locale={locale}
                  dict={dict}
                  allocationBasis={allocationBasis}
                />
              );
            case "return-percent":
              return (
                <ReturnPercentCard
                  data={performance.data}
                  locale={locale}
                  dict={dict}
                  isLoading={performance.isLoading}
                  errorMessage={performance.errorMessage}
                  timelineMode={timelineMode}
                  onTimelineModeChange={setTimelineMode}
                />
              );
            case "holdings-table":
              return (
                <DashboardHoldingsPreview
                  fxRates={dashboard.fxRates ?? []}
                  groups={holdingGroups}
                  locale={locale}
                  reportingCurrency={dashboard.summary.reportingCurrency}
                  quoteRefreshVersion={dashboard.quoteRefreshVersion}
                  isRefreshing={dashboard.isRefreshing}
                  onRefresh={refreshDashboardPrices}
                  showAdminActivityLinks={sessionUserRole === "admin"}
                  dataHealthHref={dashboardHealthHref}
                />
              );
            case "dividends-section":
              return (
                <DividendsSection
                  upcoming={dashboard.dividends.upcoming}
                  recent={dashboard.dividends.recent}
                  dict={dict}
                  locale={locale}
                />
              );
            // Phase 5e — `action-center` removed from DASHBOARD_CARDS;
            // recompute / generate-snapshots moved to FloatingQuickActions
            // (rendered by AppShell); integrity surfaces as the standalone
            // Alert above the hero (see below in this same file).
            default:
              return null;
          }
        }}
      </SortableCardGrid>

      {customizeRangesOpen ? (
        <CustomizeRangesPopover
          variant="popover"
          onClose={() => setCustomizeRangesOpen(false)}
          onSaved={refetchEffectiveRanges}
          copy={{
            title: dict.settings.customizeRangesTitle,
            activeSectionLabel: dict.settings.customizeRangesActiveLabel,
            addCustomLabel: dict.settings.customizeRangesAddCustomLabel,
            addCustomPlaceholder: dict.settings.customizeRangesAddPlaceholder,
            addCustomHint: dict.settings.customizeRangesAddHint,
            saveLabel: dict.settings.customizeRangesSaveLabel,
            savingLabel: dict.settings.customizeRangesSavingLabel,
            resetLabel: dict.settings.customizeRangesResetLabel,
            saveSuccess: dict.settings.customizeRangesSaveSuccess,
            saveError: dict.settings.customizeRangesSaveError,
            closeLabel: dict.settings.customizeRangesCloseLabel,
            toggleOnLabel: (range) =>
              dict.settings.customizeRangesToggleOnLabel.replace("{range}", range),
            toggleOffLabel: (range) =>
              dict.settings.customizeRangesToggleOffLabel.replace("{range}", range),
          }}
        />
      ) : null}
    </div>
  );
}

function DashboardMarketStateSummary({
  dict,
  marketStates,
}: {
  dict: AppDictionary;
  marketStates: DashboardMarketStateLike[];
}) {
  const describeState = (state: DashboardMarketStateLike) => {
    if (state.marketStateReason === "calendar_unknown" || state.calendarStatus === "calendar_unknown") {
      return dict.holdings.calendarUnknownWarningTitle;
    }
    return state.marketState === "open" ? dict.dashboardHome.heldMarketsOpen : dict.dashboardHome.heldMarketsClosed;
  };

  return (
    <ShadcnCard data-testid="dashboard-market-state-summary">
      <CardHeader className="pb-3">
        <CardTitle>{dict.dashboardHome.heldMarketsTitle}</CardTitle>
        <CardDescription>{dict.dashboardHome.heldMarketsDescription}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {marketStates.map((state) => (
          <div
            key={state.marketCode}
            className="rounded-xl border border-border/70 bg-muted/15 px-4 py-3"
            data-testid={`dashboard-market-state-${state.marketCode}`}
          >
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold text-foreground">{state.marketCode}</span>
                  <span
                    className={cn(
                      "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                      state.marketStateReason === "calendar_unknown" || state.calendarStatus === "calendar_unknown"
                        ? "border-amber-200 bg-amber-50 text-amber-800"
                        : state.marketState === "open"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-border bg-background text-muted-foreground",
                    )}
                  >
                    {describeState(state)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  <span>{formatDashboardTemplate(dict.dashboardHome.heldMarketsHeldCount, "{count} held", { count: String(state.heldCount ?? 0) })}</span>
                  {state.marketLocalDate ? <span>{formatDashboardTemplate(dict.dashboardHome.heldMarketsLocalDate, "Local date {date}", { date: state.marketLocalDate })}</span> : null}
                  <span>{formatDashboardTemplate(dict.dashboardHome.heldMarketsTimeZone, "Time zone {timezone}", { timezone: marketStateTimeZone(state) })}</span>
                </div>
                {state.marketStateReason === "calendar_unknown" || state.calendarStatus === "calendar_unknown" ? (
                  <p className="mt-3 text-sm text-amber-900">
                    {formatDashboardMessage(dict.holdings.calendarUnknownWarningMessage, {
                      market: state.marketCode,
                      year: state.marketLocalDate?.slice(0, 4) ?? "current",
                      location: marketLocationLabel(state.marketCode),
                      date: state.marketLocalDate ?? dict.holdings.priceStateUnknownValue,
                    })}
                  </p>
                ) : null}
              </div>
              <div className="text-xs text-muted-foreground">
                {formatDashboardTemplate(
                  dict.dashboardHome.heldMarketsSessionLabel,
                  "Session {state}",
                  { state: state.marketState === "open" ? dict.dashboardHome.heldMarketsOpen : dict.dashboardHome.heldMarketsClosed },
                )}
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </ShadcnCard>
  );
}

function marketLocationLabel(marketCode: string): string {
  switch (marketCode) {
    case "TW":
      return "Taipei";
    case "US":
      return "New York";
    case "AU":
      return "Sydney";
    case "KR":
      return "Seoul";
    default:
      return marketCode;
  }
}

function marketStateTimeZone(state: DashboardMarketStateLike): string {
  const record = state as DashboardMarketStateLike & { marketTimeZone?: string | null };
  if (record.marketTimeZone) return record.marketTimeZone;
  switch (state.marketCode) {
    case "TW":
      return "Asia/Taipei";
    case "US":
      return "America/New_York";
    case "AU":
      return "Australia/Sydney";
    case "KR":
      return "Asia/Seoul";
    default:
      return "Local market time";
  }
}

function formatDashboardTemplate(template: string | undefined, fallback: string, values: Record<string, string>): string {
  let output = template ?? fallback;
  for (const [key, value] of Object.entries(values)) {
    output = output.replace(`{${key}}`, value);
  }
  return output;
}

export function DashboardCommandModules({
  dict,
  groups,
  locale,
  summary,
}: {
  dict: AppDictionary;
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  summary: DashboardSnapshot["summary"];
}) {
  const largestHolding = groups[0] ?? null;
  const topMover = [...groups]
    .sort((left, right) => Math.abs(right.change ?? 0) - Math.abs(left.change ?? 0))[0] ?? null;
  const marketCount = new Set(groups.map((group) => group.marketCode)).size;
  const reportRangeParams = "range=1Y";
  const unrealizedAnalysisHref = buildUnrealizedPnlRoutePath({
    range: "3M",
    reportingCurrency: summary.reportingCurrency,
  });

  return (
    <section className="grid gap-3 md:grid-cols-3" data-testid="dashboard-command-modules">
      <DashboardCommandCard
        description={summary.asOf ? formatDateLabel(summary.asOf, locale) : dict.dashboardHome.latestAvailableSnapshot}
        href={`/reports?tab=daily-review&scope=all&${reportRangeParams}`}
        openLabel={dict.dashboardHome.commandOpenLabel}
        testId="dashboard-command-today"
        title={dict.dashboardHome.commandTodayTitle}
        value={summary.dailyChangeAmount === null
          ? "-"
          : formatCompactCurrencyAmount(summary.dailyChangeAmount, summary.reportingCurrency, locale)}
      >
        <div className="flex flex-wrap gap-2">
          {summary.dailyChangePercent !== null ? <Badge variant="secondary">{formatPercent(summary.dailyChangePercent, locale)}</Badge> : null}
          <Badge variant={summary.openIssueCount > 0 ? "destructive" : "outline"}>
            {formatDashboardMessage(dict.dashboardHome.commandIssueCount, { count: formatNumber(summary.openIssueCount, locale) })}
          </Badge>
          <Badge variant="outline">{formatDashboardMessage(dict.dashboardHome.commandDividendCount, { count: formatNumber(summary.upcomingDividendCount, locale) })}</Badge>
        </div>
      </DashboardCommandCard>

      <DashboardCommandCard
        description={`FX ${summary.fxStatus}`}
        href={`/reports?tab=market&scope=all&${reportRangeParams}`}
        openLabel={dict.dashboardHome.commandOpenLabel}
        testId="dashboard-command-market-pulse"
        title={dict.dashboardHome.commandMarketPulseTitle}
        value={formatDashboardMessage(dict.dashboardHome.commandMarketCount, { count: formatNumber(marketCount, locale) })}
      >
        <p className="text-sm text-muted-foreground">
          {topMover
            ? `${topMover.ticker} / ${topMover.marketCode}: ${topMover.change === null ? "-" : formatCompactCurrencyAmount(topMover.change, topMover.currency, locale)}`
            : dict.dashboardHome.commandNoMarketMovers}
        </p>
      </DashboardCommandCard>

      <DashboardCommandCard
        description={largestHolding ? `${largestHolding.ticker} / ${largestHolding.marketCode}` : dict.dashboardHome.commandNoHoldings}
        href={`/reports?tab=portfolio&scope=all&${reportRangeParams}`}
        openLabel={dict.dashboardHome.commandOpenLabel}
        testId="dashboard-command-portfolio-health"
        title={dict.dashboardHome.commandPortfolioHealthTitle}
        value={largestHolding?.allocationPct !== null && largestHolding?.allocationPct !== undefined
          ? formatPercent(largestHolding.allocationPct, locale)
          : "-"}
      >
        <p className="text-sm text-muted-foreground">
          <Link
            href={unrealizedAnalysisHref}
            className="inline-flex items-center gap-1 rounded-sm underline decoration-primary/30 underline-offset-4 hover:text-foreground"
            aria-label={dict.reports.openUnrealizedPnlAnalysis}
            data-testid="dashboard-unrealized-pnl-analysis-link"
          >
            <span>{dict.dashboardHome.commandUnrealizedLabel}</span>
            <span>{summary.unrealizedPnlAmount === null ? "-" : formatCompactCurrencyAmount(summary.unrealizedPnlAmount, summary.reportingCurrency, locale)}</span>
          </Link>
        </p>
      </DashboardCommandCard>
    </section>
  );
}

function DashboardCommandCard({
  children,
  description,
  href,
  openLabel,
  testId,
  title,
  value,
}: {
  children: ReactNode;
  description: string;
  href: string;
  openLabel: string;
  testId: string;
  title: string;
  value: string;
}) {
  return (
    <ShadcnCard data-testid={testId}>
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardDescription>{title}</CardDescription>
            <CardTitle className="mt-1 font-mono text-2xl tabular-nums">{value}</CardTitle>
          </div>
          <Button asChild size="sm" variant="secondary">
            <Link href={href}>{openLabel}</Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">{description}</p>
        {children}
      </CardContent>
    </ShadcnCard>
  );
}

function formatDashboardMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
}

function hasIncompleteDashboardValuation(group: DashboardOverviewHoldingGroupDto): boolean {
  return group.quoteStatus !== "current"
    || group.fxStatus !== "complete"
    || group.reportingMarketValueAmount === null;
}

function hasIncompleteDashboardDailyChange(group: DashboardOverviewHoldingGroupDto): boolean {
  return hasIncompleteDashboardValuation(group)
    || group.reportingDailyChangeAmount === null
    || group.changePercent === null;
}

function resolveTickerPricePollMs(
  currentSettings: DashboardSnapshot["settings"],
  initialSettings?: DashboardSnapshot["settings"],
): number {
  const intervalMinutes =
    currentSettings?.effectiveTickerPriceIntradayRefreshIntervalMinutes
    ?? initialSettings?.effectiveTickerPriceIntradayRefreshIntervalMinutes;
  if (typeof intervalMinutes === "number" && Number.isFinite(intervalMinutes) && intervalMinutes > 0) {
    return Math.max(60_000, intervalMinutes * 60_000);
  }
  return Math.max(
    15_000,
    (currentSettings?.quotePollIntervalSeconds ?? initialSettings?.quotePollIntervalSeconds ?? 60) * 1000,
  );
}

function isTickerPriceIntradayEnabled(
  currentSettings: DashboardSnapshot["settings"] | undefined,
  initialSettings?: DashboardSnapshot["settings"],
): boolean {
  return currentSettings?.effectiveTickerPriceIntradayEnabled
    ?? initialSettings?.effectiveTickerPriceIntradayEnabled
    ?? true;
}

function formatRefreshPricesPending(dict: AppDictionary, pending: PriceRefreshPendingDto | null | undefined): string | null {
  if (!pending) return null;
  if (pending.enqueuedPairs > 0) {
    return dict.dashboardHome.refreshPricesPendingQueued.replace("{count}", String(pending.enqueuedPairs));
  }
  if (pending.cappedPairs > 0) {
    return dict.dashboardHome.refreshPricesPendingCapped.replace("{count}", String(pending.cappedPairs));
  }
  if (pending.calendarUnknownPairs > 0) {
    return dict.dashboardHome.refreshPricesPendingCalendarUnknown.replace("{count}", String(pending.calendarUnknownPairs));
  }
  if (pending.consideredPairs > 0) return dict.dashboardHome.refreshPricesPendingIdle;
  return null;
}
