"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { AccountDefaultCurrency, PriceRefreshPendingDto } from "@vakwen/shared-types";
import { formatCurrencyAmount, formatNumber, formatPercent } from "../../lib/utils";
import { DashboardLoading } from "../dashboard/DashboardLoading";
import { DashboardHoldingsPreview } from "../dashboard/DashboardHoldingsPreview";
import { DividendsSection } from "../dashboard/DividendsSection";
import { PORTFOLIO_HOLDINGS_CONTEXT_KEY } from "../holdings/holdingsPreferenceHelpers";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { getRouteLoadingLabels } from "../layout/i18n";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { HoldingsTable } from "./HoldingsTable";
import { resolveHoldingGroups } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { usePortfolioPrimaryData } from "../../features/portfolio/hooks/usePortfolioPageData";
import { buildRouteDtoCacheKey, getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { refreshPortfolioCloses, type PortfolioPageData } from "../../features/portfolio/services/portfolioService";
import { Button } from "../ui/Button";
import { ToggleGroup, ToggleGroupItem } from "../ui/shadcn/toggle-group";
import { shouldPollForOpenMarket } from "../../features/price-state/priceState";
import type { AppDictionary } from "../../lib/i18n";
import { CAPITAL_REDUCTION_CHANGED_EVENT } from "../../features/capital-reduction/service";

export function PortfolioClient({
  initialPrimaryData = null,
}: {
  initialPrimaryData?: PortfolioPageData | null;
}) {
  const {
    uiDict: dict,
    locale,
    routeCachePolicy,
    sessionUserId,
    sessionUserRole,
    isSharedContext,
    mutations,
    contextRefreshSignal,
    canUseGlobalQuickActions,
    openQuickActions,
    reportingCurrency,
  } = useAppShellData();
  const seedReportingCurrency = resolvePortfolioReportingCurrency(initialPrimaryData, reportingCurrency);
  const cacheKey = buildRouteDtoCacheKey("portfolio-primary", getRouteDtoContextScope(sessionUserId), locale, reportingCurrency);
  const initialPortfolioPollMs = resolveTickerPricePollMs(
    initialPrimaryData?.settings,
    initialPrimaryData?.settings,
  );
  const initialPortfolioOpenMarketPollMs = isTickerPriceIntradayEnabled(initialPrimaryData?.settings)
    ? initialPortfolioPollMs
    : null;
  const portfolio = usePortfolioPrimaryData(initialPrimaryData, cacheKey, routeCachePolicy, initialPortfolioOpenMarketPollMs);
  const effectiveReportingCurrency = resolvePortfolioReportingCurrency(portfolio.data, seedReportingCurrency);
  const resetCount = useCardLayoutResetCount("portfolio");
  const { allocationBasis, setAllocationBasis } = useHoldingAllocationBasis();
  const [holdingsStyle, setHoldingsStyle] = useState<"portfolio" | "dashboard">("portfolio");
  const [isRefreshingCloses, setIsRefreshingCloses] = useState(false);
  const [closeRefreshError, setCloseRefreshError] = useState("");
  const firstSignalRef = useRef(true);
  const refreshPortfolioRef = useRef(portfolio.refresh);
  refreshPortfolioRef.current = portfolio.refresh;
  const refreshPortfolioPricesRef = useRef(portfolio.refreshPrices);
  refreshPortfolioPricesRef.current = portfolio.refreshPrices;
  const portfolioPollMs = resolveTickerPricePollMs(portfolio.data.settings, initialPrimaryData?.settings);
  const shouldPollPortfolioPrices = shouldPollForOpenMarket(portfolio.data.holdings)
    && isTickerPriceIntradayEnabled(portfolio.data.settings, initialPrimaryData?.settings);

  useEffect(() => {
    const refresh = () => { void refreshPortfolioRef.current(); };
    window.addEventListener(CAPITAL_REDUCTION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(CAPITAL_REDUCTION_CHANGED_EVENT, refresh);
  }, []);
  const refreshPricesStatus = formatRefreshPricesPending(dict, portfolio.data.refreshPending ?? null);

  useEffect(() => {
    if (firstSignalRef.current) {
      firstSignalRef.current = false;
      return;
    }
    void refreshPortfolioRef.current();
  }, [contextRefreshSignal]);

  useEffect(() => {
    if (!shouldPollPortfolioPrices) return;
    const timer = window.setInterval(() => {
      void refreshPortfolioPricesRef.current();
    }, portfolioPollMs);
    return () => window.clearInterval(timer);
  }, [portfolioPollMs, shouldPollPortfolioPrices]);

  async function refreshCloses() {
    setIsRefreshingCloses(true);
    setCloseRefreshError("");
    try {
      await refreshPortfolioCloses();
      await portfolio.refresh();
    } catch (error) {
      setCloseRefreshError(error instanceof Error ? error.message : "Failed to refresh closes");
    } finally {
      setIsRefreshingCloses(false);
    }
  }

  function refreshPrices() {
    void portfolio.refreshPrices();
  }

  if (portfolio.isBootstrapping) {
    return (
      <>
        <div className="mb-5 h-2 w-full rounded skeleton-line" aria-hidden="true" />
        <DashboardLoading locale={locale} loadingCopy={getRouteLoadingLabels(locale).portfolio} />
      </>
    );
  }

  const holdingGroups = resolveHoldingGroups({
    holdings: portfolio.data.holdings,
    holdingGroups: portfolio.data.holdingGroups,
    instruments: portfolio.data.instruments,
    accounts: portfolio.data.accounts,
  });
  const largestHolding = holdingGroups[0] ?? null;
  const quotedHoldingCount = holdingGroups.filter((holding) => holding.currentUnitPrice !== null).length;
  const marketCount = new Set(holdingGroups.map((holding) => holding.marketCode)).size;
  const quoteCoverageValue = holdingGroups.length === 0
    ? "-"
    : formatPercent((quotedHoldingCount / holdingGroups.length) * 100, locale);
  const quoteCoverageDetail = holdingGroups.length === 0
    ? dict.dashboardHome.holdingsEmpty
    : `${formatNumber(quotedHoldingCount, locale)} / ${formatNumber(holdingGroups.length, locale)}`;
  const largestHoldingCostBasis = largestHolding
    ? largestHolding.reportingCostBasisAmount ?? (
        largestHolding.reportingCurrency === largestHolding.currency
          ? largestHolding.costBasisAmount
          : null
      )
    : null;
  const largestHoldingCurrency = largestHolding?.reportingCurrency ?? effectiveReportingCurrency;
  const restoredLabel = portfolio.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(portfolio.restoredAt))
    : null;

  return (
    <div className="stagger grid min-w-0 gap-6">
      <section
        className="grid gap-4 rounded-xl border border-border bg-card px-5 py-5 shadow-sm sm:px-6"
        data-testid="portfolio-intro"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary/78">{dict.navigation.portfolioLabel}</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{dict.navigation.portfolioLabel}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              {formatPortfolioMessage(dict.dashboardHome.holdingsCount, { count: formatNumber(holdingGroups.length, locale) })}
              {" · "}
              {formatPortfolioMessage(dict.dashboardHome.marketsCount, { count: formatNumber(marketCount, locale) })}
              {" · "}
              <Link href="/dividends" className="font-medium text-primary underline-offset-4 hover:underline">
                {dict.dividends.viewAllLink}
              </Link>
            </p>
          </div>
          <div className="flex max-w-2xl flex-col items-start gap-2 text-sm leading-6 text-muted-foreground lg:items-end">
            <p>{dict.navigation.portfolioDescription}</p>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground">
                {dict.commandPalette.actionChangeReportingCurrency}: {effectiveReportingCurrency}
              </span>
              {canUseGlobalQuickActions ? (
                <Button type="button" size="sm" variant="secondary" onClick={openQuickActions}>
                  {dict.commandPalette.quickActionsTitle}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric
            label={dict.dashboardHome.largestHoldingLabel}
            value={largestHolding?.ticker ?? "-"}
            detail={largestHolding
              ? largestHoldingCostBasis == null
                ? "-"
                : formatCurrencyAmount(largestHoldingCostBasis, largestHoldingCurrency, locale)
              : dict.dashboardHome.holdingsEmpty}
          />
          <CompactMetric
            label={dict.dashboardHome.concentrationLabel}
            value={largestHolding?.allocationPct !== null && largestHolding?.allocationPct !== undefined
              ? formatPercent(largestHolding.allocationPct, locale)
              : "-"}
            detail={largestHolding ? dict.dashboardHome.allocationLabel : dict.dashboardHome.holdingsEmpty}
          />
          <CompactMetric
            label={dict.dashboardHome.holdingCountLabel}
            value={formatNumber(holdingGroups.length, locale)}
            detail={dict.holdings.entries.replace("{count}", String(holdingGroups.length))}
          />
          <CompactMetric
            label={dict.dashboardHome.quoteCoverageLabel}
            value={quoteCoverageValue}
            detail={quoteCoverageDetail}
          />
        </div>
      </section>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        data-testid="portfolio-primary-refresh-strip"
      >
        <div className="flex flex-wrap items-center gap-2">
          {portfolio.restoredFromCache && restoredLabel ? (
            <span data-testid="portfolio-cache-restore-label">
              {formatPortfolioMessage(dict.dashboardHome.restoredFromCacheAt, { time: restoredLabel })}
            </span>
          ) : (
            <span>{dict.dashboardHome.portfolioSnapshotMountedDuringRefresh}</span>
          )}
          {portfolio.isRefreshing ? (
            <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
              {dict.dashboardHome.refreshingLabel}
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
              onClick={() => { void refreshCloses(); }}
              disabled={portfolio.isRefreshing || isRefreshingCloses}
              data-testid="portfolio-refresh-closes-button"
            >
              {dict.dashboardHome.refreshClosesLabel}
            </Button>
          ) : null}
          {!isSharedContext ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={refreshPrices}
              disabled={portfolio.isRefreshing || isRefreshingCloses}
              data-testid="portfolio-refresh-prices-button"
            >
              {dict.dashboardHome.refreshPricesLabel}
            </Button>
          ) : null}
          {refreshPricesStatus ? (
            <span className="text-xs font-medium text-muted-foreground" data-testid="portfolio-refresh-prices-status">
              {refreshPricesStatus}
            </span>
          ) : null}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => { void portfolio.refresh(); }}
            disabled={portfolio.isRefreshing || isRefreshingCloses}
            data-testid="portfolio-refresh-button"
          >
            {dict.dashboardHome.refreshLabel}
          </Button>
        </div>
      </div>
      {/*
        KZO-162 — Portfolio cards rendered as a SortableCardGrid. Slugs
        `holdings-table` and `dividends-section` are intentionally reused
        from `DASHBOARD_CARDS` — same components, different `cardOrder.{key}`
        namespace, so dashboard reorder and portfolio reorder are isolated.
        To add a card here, append a `{slug, fullWidth}` entry AND add a
        `case` to the switch below.
      */}
      <SortableCardGrid
        key={`card-grid-portfolio-${resetCount}`}
        orderKey="portfolio"
        cards={[
          { slug: "holdings-table", fullWidth: true },
          { slug: "dividends-section", fullWidth: true },
        ]}
      >
        {(slug) => {
          switch (slug) {
            case "holdings-table":
              return (
                <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-3 pl-2 pt-2" data-testid="portfolio-holdings-style-shell">
                  <div className="w-full space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        {dict.holdings.layoutStyleLabel}
                      </div>
                      <ToggleGroup
                        type="single"
                        value={holdingsStyle}
                        data-testid="portfolio-holdings-style-control"
                        onValueChange={(value) => {
                          if (value === "portfolio" || value === "dashboard") setHoldingsStyle(value);
                        }}
                        className="flex-wrap justify-start"
                      >
                        <ToggleGroupItem value="dashboard" data-testid="portfolio-holdings-style-dashboard">
                          {dict.holdings.layoutStyleCompact}
                        </ToggleGroupItem>
                        <ToggleGroupItem value="portfolio" data-testid="portfolio-holdings-style-portfolio">
                          {dict.holdings.layoutStyleDetailed}
                        </ToggleGroupItem>
                      </ToggleGroup>
                    </div>
                    {holdingsStyle === "portfolio" ? (
                      <HoldingsTable
                        holdings={portfolio.data.holdings}
                        holdingGroups={holdingGroups}
                        instruments={portfolio.data.instruments}
                        accounts={portfolio.data.accounts}
                        dict={dict}
                        locale={locale}
                        recomputingSymbols={mutations.recomputingSymbols}
                        showFreshnessBadge={!isSharedContext}
                        showAdminActivityLinks={sessionUserRole === "admin" && !isSharedContext}
                        quoteRefreshVersion={portfolio.quoteRefreshVersion}
                        allocationBasis={allocationBasis}
                        onAllocationBasisChange={setAllocationBasis}
                        settingsContextKey={PORTFOLIO_HOLDINGS_CONTEXT_KEY}
                        enableSelectionWorkflow
                        enableLayoutStyleToggle
                      />
                    ) : (
                      <DashboardHoldingsPreview
                        groups={holdingGroups}
                        fxRates={portfolio.data.fxRates}
                        locale={locale}
                        reportingCurrency={effectiveReportingCurrency}
                        settingsContextKey={PORTFOLIO_HOLDINGS_CONTEXT_KEY}
                        quoteRefreshVersion={portfolio.quoteRefreshVersion}
                        showAdminActivityLinks={sessionUserRole === "admin" && !isSharedContext}
                        isRefreshing={portfolio.isRefreshing}
                        onRefresh={() => { void portfolio.refresh(); }}
                      />
                    )}
                  </div>
                </div>
              );
            case "dividends-section":
              return (
                <DividendsSection
                  upcoming={portfolio.data.dividends.upcoming}
                  recent={portfolio.data.dividends.recent}
                  dict={dict}
                  locale={locale}
                />
              );
            default:
              return null;
          }
        }}
      </SortableCardGrid>
    </div>
  );
}

function formatPortfolioMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce((message, [key, value]) => message.replace(`{${key}}`, value), template);
}

function resolvePortfolioReportingCurrency(
  data: PortfolioPageData | null,
  fallback: AccountDefaultCurrency,
): AccountDefaultCurrency {
  return data?.holdingGroups[0]?.reportingCurrency
    ?? data?.holdingGroups.find((group) => group.children[0]?.reportingCurrency)?.children[0]?.reportingCurrency
    ?? data?.fxRates?.[0]?.toCurrency
    ?? fallback;
}

function resolveTickerPricePollMs(
  currentSettings: PortfolioPageData["settings"],
  initialSettings?: PortfolioPageData["settings"],
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
  currentSettings: PortfolioPageData["settings"],
  initialSettings?: PortfolioPageData["settings"],
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

function CompactMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
