"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  REPORT_SCOPES,
  type AccountDefaultCurrency,
  type AllocationBucketDto,
  type CurrencyCode,
  type DailyReviewReportDto,
  type DashboardPerformanceDto,
  type FxConversionRateDto,
  type HoldingsSortField,
  type LocaleCode,
  type MarketReportDto,
  type PortfolioReportDto,
  type ReportDataHealthDto,
  type ReportDiagnosticsDto,
  type ReportFxStatusDto,
  type ReportHoldingRowDto,
  type ReportHoldingRowsPageDto,
  type ReportSummaryTotalsDto,
  type ReportTickerAllocationRowDto,
  type TickerAllocationChartMode,
  type TickerAllocationTopN,
} from "@vakwen/shared-types";
import { Bar, BarChart, CartesianGrid, Line, LineChart, Tooltip, XAxis, YAxis } from "recharts";
import { ChevronDown, ExternalLink, RefreshCw, Search } from "lucide-react";
import { useAppShellData } from "../layout/AppShellDataContext";
import { CapabilityNormalizationNotice } from "../../features/portfolio-capabilities/components/CapabilityNormalizationNotice";
import { SingleCapabilityContext } from "../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";
import { Button } from "../ui/Button";
import { Alert, AlertDescription, AlertTitle } from "../ui/shadcn/alert";
import { Badge } from "../ui/shadcn/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/shadcn/card";
import { ChartContainer, type ChartConfig } from "../ui/shadcn/chart";
import { Checkbox } from "../ui/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/shadcn/dropdown-menu";
import { Input } from "../ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/shadcn/popover";
import { Skeleton } from "../ui/shadcn/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/shadcn/tabs";
import { ToggleGroup, ToggleGroupItem } from "../ui/shadcn/toggle-group";
import {
  HoldingsColumnHeaderContent,
  HoldingsColumnSettingsMenu,
  HoldingsHiddenSortChip,
  HoldingsMobileSortControls,
  HoldingsRowSettingsMenu,
  applyHoldingsRowOrder,
  filterAvailableHoldingsSelections,
  holdingsColumnCellStyle,
  holdingsSortableHeaderCellProps,
  useHoldingsColumnSettings,
  type HoldingsDefaultSort,
  type HoldingsColumnSettingsState,
  type HoldingsGridColumnDefinition,
} from "../holdings/HoldingsColumnSettings";
import { sortHoldingsRows } from "../holdings/holdingsSorting";
import {
  HoldingsSelectionInlineToggle,
  HoldingsSelectionSummaryStrip,
  HoldingsSelectionToolbar,
} from "../holdings/HoldingsSelectionControls";
import { HoldingsDetailSheet } from "../holdings/HoldingsDetailSheet";
import { HoldingsDataHealthBadges } from "../holdings/HoldingsDataHealth";
import {
  HoldingsGridDesktopFrame,
  HoldingsGridEmptyState,
  HoldingsGridNativeTable,
} from "../holdings/HoldingsGrid";
import { PriceStateChip } from "../holdings/PriceStateChip";
import {
  holdingsFinanceToneClass,
  holdingsInfoBadgeClassName,
  holdingsStickyFirstColumnClassName,
  holdingsWarningBadgeClassName,
} from "../holdings/holdingsStyle";
import { buildHoldingsSelectionVisibleSummary, type HoldingsSelectionSummaryRow } from "../holdings/holdingsSelectionSummary";
import {
  buildHoldingsTickerId,
  fetchHoldingsPreferences,
  persistHoldingsTableContexts,
  REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY,
  REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY,
  REPORTS_MARKET_DETAIL_CONTEXT_KEY,
  REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY,
  REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY,
} from "../holdings/holdingsPreferenceHelpers";
import { useHoldingsSelection } from "../holdings/useHoldingsSelection";
import { TooltipInfo } from "../ui/TooltipInfo";
import { ValuationHealthPanel } from "../valuation/ValuationHealthPanel";
import { getValuationHealthAdminRepairHref } from "../valuation/valuationHealthAdminLink";
import { useReportData } from "../../features/reports/hooks/useReportData";
import {
  buildSelectedSeriesId,
  buildUnrealizedPnlRoutePath,
  mapPerformanceRangeToAnalysisRange,
} from "../../features/analysis/unrealizedPnlRouteState";
import {
  buildRealizedPnlTransactionsHref,
  hasRealizedPnlTransactionDrilldown,
} from "../../features/reports/realizedPnlDrilldown";
import { useEffectiveRanges } from "../../hooks/useEffectiveRanges";
import { buildPriceStateActivityPath, getPriceState, isNonCurrentPrice, priceStateSortRank } from "../../features/price-state/priceState";
import {
  REPORT_TABS,
  parseReportRouteState,
  reportRouteStateToSearchParams,
  type ReportRouteState,
  type ReportTab,
} from "../../features/reports/reportState";
import {
  buildReportsHealthHref,
  buildTickerRepairHref,
  parseReportHealthQuery,
  reportHealthReasonFromDiagnostics,
  reportHealthReasonFromPerformanceGap,
  type ReportHealthQuery,
  type ReportHealthReason,
} from "../../features/reports/reportHealthDeepLinks";
import { resolveReportScopeCapabilityState } from "../../features/reports/reportScopeCapabilities";
import type { AnyReportDto } from "../../features/reports/services/reportService";
import type { AppDictionary } from "../../lib/i18n";
import { getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { buildTimelineAxis, type TimelineMode } from "../../lib/timelineAxis";
import { getNativeUnitPnl, getReportUnitPnl } from "../../lib/holdingsMetrics";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";

type OptionalFxRateDto = {
  asOf?: string;
  baseCurrency?: string;
  date?: string;
  from?: string;
  fromCurrency?: string;
  quoteCurrency?: string;
  rate?: number | null;
  to?: string;
  toCurrency?: string;
};

type ReportHoldingsColumn = "ticker" | "accounts" | "quantity" | "averageCost" | "price" | "unitPnl" | "marketValue" | "costBasis" | "dailyChange" | "unrealizedPnl" | "allocation" | "dataHealth" | "actions";
type ReportHoldingFocusPreset = "largest" | "highest-allocation" | "worst-pnl" | "best-pnl" | "stale-quotes" | "fx-exposure";

const REPORT_HOLDING_FOCUS_PRESETS: Array<{
  direction: "asc" | "desc";
  field: HoldingsSortField;
  id: ReportHoldingFocusPreset;
}> = [
  { direction: "desc", field: "marketValue", id: "largest" },
  { direction: "desc", field: "allocation", id: "highest-allocation" },
  { direction: "asc", field: "unrealizedPnl", id: "worst-pnl" },
  { direction: "desc", field: "unrealizedPnl", id: "best-pnl" },
  { direction: "desc", field: "dataHealth", id: "stale-quotes" },
  { direction: "desc", field: "marketValue", id: "fx-exposure" },
];

const TICKER_ALLOCATION_CHART_CONTEXT_KEY = "reports.portfolio.tickerAllocation";
const DEFAULT_TICKER_ALLOCATION_CHART_MODE: TickerAllocationChartMode = "bars";
const DEFAULT_TICKER_ALLOCATION_TOP_N: TickerAllocationTopN = "auto";

const REPORT_HOLDINGS_COLUMNS: Array<HoldingsGridColumnDefinition<ReportHoldingsColumn>> = [
  { id: "ticker", label: "Ticker", defaultWidth: 176, canHide: false, sortField: "ticker" },
  { id: "accounts", label: "Accounts", defaultWidth: 116, align: "right", sortField: "accountCount" },
  { id: "quantity", label: "Quantity", defaultWidth: 132, align: "right", sortField: "quantity" },
  { id: "averageCost", label: "Average cost", defaultWidth: 148, align: "right", sortField: "averageCost" },
  { id: "price", label: "Price", defaultWidth: 148, align: "right", sortField: "price" },
  { id: "unitPnl", label: "Unit P&L", defaultWidth: 148, align: "right", sortField: "unitPnl" },
  { id: "marketValue", label: "Market value", defaultWidth: 168, align: "right", sortField: "marketValue" },
  { id: "costBasis", label: "Cost basis", defaultWidth: 156, align: "right", sortField: "costBasis" },
  { id: "dailyChange", label: "Daily change", defaultWidth: 156, align: "right", sortField: "dailyChangePercent" },
  { id: "unrealizedPnl", label: "Unrealized P&L", defaultWidth: 156, align: "right", sortField: "unrealizedPnl" },
  { id: "allocation", label: "Allocation", defaultWidth: 128, align: "right", sortField: "allocation" },
  { id: "dataHealth", label: "Data health", defaultWidth: 192, sortField: "dataHealth" },
  { id: "actions", label: "Actions", defaultWidth: 132, align: "right", canHide: false },
];
const REPORT_MOBILE_FIELD_COLUMNS: ReportHoldingsColumn[] = ["quantity", "accounts", "marketValue", "unrealizedPnl", "averageCost", "price", "unitPnl", "costBasis", "dailyChange", "allocation", "dataHealth"];
const REPORT_HOLDINGS_SORT_FIELDS = REPORT_HOLDINGS_COLUMNS.flatMap((column) => column.sortField ? [column.sortField] : []);

function reportHoldingColumnLabel(dict: AppDictionary, column: ReportHoldingsColumn): string {
  switch (column) {
    case "ticker":
      return dict.reports.ticker;
    case "accounts":
      return dict.reports.accounts;
    case "quantity":
      return dict.reports.quantity;
    case "price":
      return dict.reports.price;
    case "averageCost":
      return dict.reports.averageCost;
    case "unitPnl":
      return dict.holdings.unitPnlTerm;
    case "marketValue":
      return dict.reports.marketValue;
    case "costBasis":
      return dict.reports.costBasis;
    case "unrealizedPnl":
      return dict.reports.unrealizedPnl;
    case "dailyChange":
      return dict.reports.dailyChange;
    case "allocation":
      return dict.reports.allocation;
    case "dataHealth":
      return dict.holdings.dataHealthTerm;
    case "actions":
      return dict.reports.actions;
  }
}

function reportHoldingRowId(row: { marketCode: string; ticker: string }): string {
  return `${row.marketCode}:${row.ticker}`;
}

function buildPerformanceChartConfig(totalReturnAmount: number | null | undefined): ChartConfig {
  return {
    marketValueAmount: {
      label: "Market value",
      color: "hsl(var(--chart-primary))",
    },
    totalCostAmount: {
      label: "Cost basis",
      color: "hsl(var(--chart-muted))",
    },
    totalReturnAmount: {
      label: "Total return",
      color: totalReturnAmount != null && totalReturnAmount < 0
        ? "hsl(var(--chart-direction-negative))"
        : "hsl(var(--chart-direction-positive))",
    },
  } satisfies ChartConfig;
}

const ALLOCATION_CHART_CONFIG = {
  amount: {
    label: "Amount",
    color: "hsl(var(--chart-primary))",
  },
} satisfies ChartConfig;

export function ReportsClient({
  initialReport,
  initialState,
}: {
  initialReport: AnyReportDto | null;
  initialState: ReportRouteState;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const {
    canUseGlobalQuickActions,
    contextRefreshSignal,
    isSharedContext,
    locale,
    openQuickActions,
    portfolioCapabilities,
    reportingCurrency,
    routeCachePolicy,
    sessionUserId,
    sessionUserRole,
    sharedContextPermissions,
    uiDict,
  } = useAppShellData();
  const searchParamsKey = searchParams?.toString() ?? "";
  const healthQuery = useMemo(
    () => parseReportHealthQuery(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const routeState = useMemo(
    () => searchParamsKey === ""
      ? { ...initialState, useServerDefaultRange: true }
      : parseReportRouteState(new URLSearchParams(searchParamsKey)),
    [initialState, searchParamsKey],
  );
  const [initialScopeCapabilities] = useState(
    () => resolveReportScopeCapabilityState(
      initialReport?.capabilities ?? portfolioCapabilities,
      routeState.scope,
    ),
  );
  const [initialNormalizedState] = useState<ReportRouteState>(
    () => initialScopeCapabilities.normalization
      ? { ...routeState, scope: initialScopeCapabilities.scope }
      : routeState,
  );
  const initialNormalizationKey = initialScopeCapabilities.normalization
    ? `${routeState.scope}->${initialScopeCapabilities.scope}:${initialScopeCapabilities.normalization.reason}`
    : null;
  const [state, setState] = useState(() => initialNormalizedState);
  const [scopeNormalizationNotice, setScopeNormalizationNotice] = useState<{
    id: number;
    key: string;
    effectiveLabel: string;
    normalization: NonNullable<ReturnType<typeof resolveReportScopeCapabilityState>["normalization"]>;
  } | null>(() => initialScopeCapabilities.normalization?.reason === "unconfigured_market"
    ? {
        id: Date.now(),
        key: initialNormalizationKey ?? "",
        effectiveLabel: initialScopeCapabilities.scope,
        normalization: initialScopeCapabilities.normalization,
      }
    : null);
  const [timelineMode, setTimelineMode] = useState<TimelineMode>("auto");
  const handledScopeNormalizationKeyRef = useRef<string | null>(null);
  const pendingRouteStateRef = useRef<ReportRouteState | null>(
    reportRouteStatesEqual(routeState, initialNormalizedState) ? null : initialNormalizedState,
  );
  const { effectiveRanges } = useEffectiveRanges();
  const cacheScope = getRouteDtoContextScope(sessionUserId);
  const report = useReportData({
    cachePolicy: routeCachePolicy,
    cacheScope,
    contextRefreshSignal,
    initialReport,
    locale,
    state,
  });
  const canManageAccounts = !isSharedContext || sharedContextPermissions.canManageAccounts;
  const reportCapabilities = report.data?.capabilities
    ?? initialReport?.capabilities
    ?? (report.isBootstrapping ? portfolioCapabilities : null);
  const scopeCapabilities = useMemo(
    () => resolveReportScopeCapabilityState(reportCapabilities, state.scope),
    [reportCapabilities, state.scope],
  );

  const updateState = useCallback((patch: Partial<ReportRouteState>) => {
    const next = { ...state, ...patch, useServerDefaultRange: false };
    if (reportRouteStatesEqual(state, next)) return;
    pendingRouteStateRef.current = next;
    setState(next);
    router.replace(`/reports?${reportRouteStateToSearchParams(next).toString()}`, { scroll: false });
  }, [router, state]);

  const normalizeState = useCallback((patch: Partial<ReportRouteState>) => {
    const next = { ...state, ...patch, useServerDefaultRange: false };
    if (reportRouteStatesEqual(state, next)) return;
    pendingRouteStateRef.current = next;
    setState(next);
    // Capability normalization is a correction to the current client view,
    // not a new server navigation. Native history keeps Next's search-param
    // hooks in sync without remounting controlled Radix collections midway
    // through their ref lifecycle.
    window.history.replaceState(
      window.history.state,
      "",
      `/reports?${reportRouteStateToSearchParams(next).toString()}`,
    );
  }, [state]);

  useEffect(() => {
    const pending = pendingRouteStateRef.current;
    if (!pending || reportRouteStatesEqual(routeState, pending)) return;
    window.history.replaceState(
      window.history.state,
      "",
      `/reports?${reportRouteStateToSearchParams(pending).toString()}`,
    );
  }, [routeState]);

  useEffect(() => {
    const pending = pendingRouteStateRef.current;
    if (pending && !reportRouteStatesEqual(routeState, pending)) return;
    if (pending) pendingRouteStateRef.current = null;
    setState((current) => reportRouteStatesEqual(current, routeState) ? current : routeState);
  }, [routeState, searchParamsKey]);

  useEffect(() => {
    if (effectiveRanges.length === 0) return;
    if (state.useServerDefaultRange && state.range !== effectiveRanges[0]) {
      updateState({ range: effectiveRanges[0] });
      return;
    }
    if (effectiveRanges.includes(state.range)) return;
    updateState({ range: effectiveRanges[0] });
  }, [effectiveRanges, state.range, state.useServerDefaultRange, updateState]);

  useEffect(() => {
    if (!reportCapabilities) return;

    const normalizationKey = `${state.scope}->${scopeCapabilities.scope}:${scopeCapabilities.normalization?.reason ?? "none"}`;
    if (state.scope === scopeCapabilities.scope) {
      if (handledScopeNormalizationKeyRef.current === normalizationKey) {
        handledScopeNormalizationKeyRef.current = null;
      }
      return;
    }

    if (handledScopeNormalizationKeyRef.current === normalizationKey) return;
    handledScopeNormalizationKeyRef.current = normalizationKey;

    const scopeNormalization = scopeCapabilities.normalization;
    if (scopeNormalization?.reason === "unconfigured_market") {
      setScopeNormalizationNotice((current) => (
        current?.key === normalizationKey
          ? current
          : {
              id: Date.now(),
              key: normalizationKey,
              effectiveLabel: scopeCapabilities.scope,
              normalization: scopeNormalization,
            }
      ));
    }

    normalizeState({ scope: scopeCapabilities.scope });
  }, [
    normalizeState,
    reportCapabilities,
    scopeCapabilities.normalization,
    scopeCapabilities.scope,
    state.scope,
  ]);

  const restoredLabel = report.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(report.restoredAt))
    : null;
  const resolvedReportingCurrency = report.data?.query.reportingCurrency ?? initialReport?.query.reportingCurrency ?? reportingCurrency;
  const unrealizedPnlHref = buildUnrealizedPnlRoutePath({
    range: mapPerformanceRangeToAnalysisRange(state.range),
    markets: state.scope === "all" ? [] : [state.scope],
    reportingCurrency: resolvedReportingCurrency,
  });

  return (
    <div className="stagger flex min-w-0 flex-col gap-6" data-testid="reports-page">
      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <CardDescription className="text-xs font-semibold uppercase text-primary/80">{uiDict.navigation.reportsLabel}</CardDescription>
              <CardTitle className="mt-2 text-2xl sm:text-3xl">{uiDict.navigation.reportsLabel}</CardTitle>
              <CardDescription className="mt-2 max-w-3xl leading-6">{uiDict.navigation.reportsDescription}</CardDescription>
            </div>
            <ReportControls
              scopeCapabilities={scopeCapabilities}
              dict={uiDict}
              ranges={effectiveRanges}
              state={state}
              resolvedReportingCurrency={resolvedReportingCurrency}
              canOpenQuickActions={canUseGlobalQuickActions}
              onOpenQuickActions={openQuickActions}
              onChange={updateState}
            />
          </div>
        </CardHeader>
        <CardContent>
          <FreshnessStrip
            dict={uiDict}
            isRefreshing={report.isRefreshing}
            restoredFromCache={report.restoredFromCache}
            restoredLabel={restoredLabel}
            onRefresh={() => { void report.refresh({ bypassCache: true }); }}
          />
        </CardContent>
      </Card>

      {reportCapabilities && scopeCapabilities.mode === "zero" ? (
        <ZeroAccountSetupGate
          dict={uiDict}
          canManageAccounts={canManageAccounts}
          returnTo="/reports"
        />
      ) : (
        <>
          {scopeNormalizationNotice ? (
            <CapabilityNormalizationNotice
              key={`reports-scope-normalization-${scopeNormalizationNotice.id}`}
              dict={uiDict}
              kind="reportScope"
              normalization={scopeNormalizationNotice.normalization}
              effectiveLabel={scopeNormalizationNotice.effectiveLabel}
            />
          ) : null}
          <Tabs
            value={state.tab}
            onValueChange={(value) => updateState({ tab: value as ReportTab })}
            data-testid="reports-tabs"
          >
            <TabsList className="h-auto w-full flex-wrap justify-start">
              {REPORT_TABS.map((value) => (
                <TabsTrigger key={value} value={value} data-testid={`reports-tab-${value}`}>
                  {reportTabLabel(uiDict, value)}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="daily-review" className="mt-5">
              <ReportBody
                data={report.data}
                errorMessage={report.errorMessage}
                isBootstrapping={report.isBootstrapping}
                isRefreshing={report.isRefreshing}
                locale={locale}
                onRefresh={() => { void report.refresh({ bypassCache: true }); }}
                realizedPnlHref={buildRealizedPnlTransactionsHref({
                  query: report.data?.query ?? initialReport?.query ?? {
                    scope: state.scope,
                    rangeStartDate: new Date().toISOString().slice(0, 10),
                    rangeEndDate: new Date().toISOString().slice(0, 10),
                  },
                  returnTo: `/reports?${reportRouteStateToSearchParams(state).toString()}`,
                })}
                unrealizedPnlHref={unrealizedPnlHref}
                healthQuery={healthQuery}
                reportState={state}
                showAdminActions={sessionUserRole === "admin"}
                tab="daily-review"
                timelineMode={timelineMode}
                onTimelineModeChange={setTimelineMode}
                uiDict={uiDict}
              />
            </TabsContent>
            <TabsContent value="portfolio" className="mt-5">
              <ReportBody
                data={report.data}
                errorMessage={report.errorMessage}
                isBootstrapping={report.isBootstrapping}
                isRefreshing={report.isRefreshing}
                locale={locale}
                onRefresh={() => { void report.refresh({ bypassCache: true }); }}
                realizedPnlHref={buildRealizedPnlTransactionsHref({
                  query: report.data?.query ?? initialReport?.query ?? {
                    scope: state.scope,
                    rangeStartDate: new Date().toISOString().slice(0, 10),
                    rangeEndDate: new Date().toISOString().slice(0, 10),
                  },
                  returnTo: `/reports?${reportRouteStateToSearchParams(state).toString()}`,
                })}
                unrealizedPnlHref={unrealizedPnlHref}
                healthQuery={healthQuery}
                reportState={state}
                showAdminActions={sessionUserRole === "admin"}
                tab="portfolio"
                timelineMode={timelineMode}
                onTimelineModeChange={setTimelineMode}
                uiDict={uiDict}
              />
            </TabsContent>
            <TabsContent value="market" className="mt-5">
              <ReportBody
                data={report.data}
                errorMessage={report.errorMessage}
                isBootstrapping={report.isBootstrapping}
                isRefreshing={report.isRefreshing}
                locale={locale}
                onRefresh={() => { void report.refresh({ bypassCache: true }); }}
                realizedPnlHref={buildRealizedPnlTransactionsHref({
                  query: report.data?.query ?? initialReport?.query ?? {
                    scope: state.scope,
                    rangeStartDate: new Date().toISOString().slice(0, 10),
                    rangeEndDate: new Date().toISOString().slice(0, 10),
                  },
                  returnTo: `/reports?${reportRouteStateToSearchParams(state).toString()}`,
                })}
                unrealizedPnlHref={unrealizedPnlHref}
                healthQuery={healthQuery}
                reportState={state}
                showAdminActions={sessionUserRole === "admin"}
                tab="market"
                timelineMode={timelineMode}
                onTimelineModeChange={setTimelineMode}
                uiDict={uiDict}
              />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  );
}

function reportRouteStatesEqual(left: ReportRouteState, right: ReportRouteState): boolean {
  return left.tab === right.tab
    && left.scope === right.scope
    && left.range === right.range
    && left.useServerDefaultRange === right.useServerDefaultRange;
}

function reportTabLabel(dict: AppDictionary, tab: ReportTab): string {
  if (tab === "daily-review") return dict.reports.tabDailyReview;
  if (tab === "portfolio") return dict.reports.tabPortfolio;
  return dict.reports.tabMarket;
}

function formatReportMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template,
  );
}

function ReportControls({
  scopeCapabilities,
  dict,
  ranges,
  resolvedReportingCurrency,
  canOpenQuickActions,
  onOpenQuickActions,
  state,
  onChange,
}: {
  scopeCapabilities: ReturnType<typeof resolveReportScopeCapabilityState>;
  dict: AppDictionary;
  ranges: string[];
  resolvedReportingCurrency: string;
  canOpenQuickActions: boolean;
  onOpenQuickActions: () => void;
  state: ReportRouteState;
  onChange: (patch: Partial<ReportRouteState>) => void;
}) {
  const rangeOptions = ranges.length > 0 ? ranges : [state.range];
  return (
    <div className="flex min-w-0 flex-col gap-3 lg:max-w-xl" data-testid="reports-controls">
      <div className="grid gap-3 sm:grid-cols-2">
        {scopeCapabilities.mode === "single" ? (
          <SingleCapabilityContext
            label={dict.reports.controlScope}
            value={reportScopeLabel(dict, scopeCapabilities.scope)}
            testId="portfolio-capabilities-single-context-report-scope"
          />
        ) : scopeCapabilities.mode === "zero" ? null : (
          <ControlSelect label={dict.reports.controlScope} value={state.scope} onValueChange={(scope) => onChange({ scope: scope as ReportRouteState["scope"] })}>
            {(scopeCapabilities.mode === "multiple" ? scopeCapabilities.configuredReportScopes : REPORT_SCOPES)
              .map((scope) => <SelectItem key={scope} value={scope}>{reportScopeLabel(dict, scope)}</SelectItem>)}
          </ControlSelect>
        )}
        {scopeCapabilities.normalization?.reason ? (
          <SingleCapabilityContext
            label={dict.reports.controlRange}
            value={state.range}
            testId="portfolio-capabilities-normalizing-report-range"
          />
        ) : (
          <ControlSelect label={dict.reports.controlRange} value={state.range} onValueChange={(range) => onChange({ range })}>
            {rangeOptions.map((range) => <SelectItem key={range} value={range}>{range}</SelectItem>)}
          </ControlSelect>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="reports-controls-meta">
        <Badge variant="secondary">{formatReportMessage(dict.reports.resolvedCurrency, { currency: resolvedReportingCurrency })}</Badge>
        {canOpenQuickActions ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-auto px-0 text-sm font-medium text-primary hover:bg-transparent"
            onClick={onOpenQuickActions}
            data-testid="reports-open-quick-actions"
          >
            {dict.reports.changeInQuickActions}
          </Button>
        ) : (
          <span>{dict.reports.reportingCurrencyQuickActionsOnly}</span>
        )}
      </div>
    </div>
  );
}

function reportScopeLabel(dict: AppDictionary, scope: ReportRouteState["scope"]): string {
  return scope === "all" ? dict.reports.allMarkets : scope;
}

function ControlSelect({
  children,
  label,
  onValueChange,
  value,
}: {
  children: ReactNode;
  label: string;
  onValueChange: (value: string) => void;
  value: string;
}) {
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      <Select value={value} onValueChange={onValueChange}>
        <SelectTrigger className="w-full bg-background" data-testid={`reports-control-${label.toLowerCase().replace(/\s+/g, "-")}`}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {children}
          </SelectGroup>
        </SelectContent>
      </Select>
    </label>
  );
}

function FreshnessStrip({
  dict,
  isRefreshing,
  onRefresh,
  restoredFromCache,
  restoredLabel,
}: {
  dict: AppDictionary;
  isRefreshing: boolean;
  onRefresh: () => void;
  restoredFromCache: boolean;
  restoredLabel: string | null;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
      <div className="flex flex-wrap items-center gap-2">
        {restoredFromCache && restoredLabel ? (
          <span data-testid="reports-cache-restore-label">{formatReportMessage(dict.reports.restoredFromCache, { time: restoredLabel })}</span>
        ) : (
          <span>{dict.reports.contentVisibleWhileLoading}</span>
        )}
        {isRefreshing ? <Badge variant="secondary">{dict.reports.refreshing}</Badge> : null}
      </div>
      <Button size="sm" variant="secondary" onClick={onRefresh} disabled={isRefreshing} data-testid="reports-refresh-button">
        <RefreshCw data-icon="inline-start" />
        {dict.reports.refresh}
      </Button>
    </div>
  );
}

function ReportBody({
  data,
  errorMessage,
  isBootstrapping,
  isRefreshing,
  locale,
  onRefresh,
  realizedPnlHref,
  unrealizedPnlHref,
  healthQuery,
  reportState,
  showAdminActions,
  tab,
  timelineMode,
  onTimelineModeChange,
  uiDict,
}: {
  data: AnyReportDto | null;
  errorMessage: string;
  isBootstrapping: boolean;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  realizedPnlHref: string;
  unrealizedPnlHref: string;
  healthQuery: ReportHealthQuery;
  reportState: ReportRouteState;
  showAdminActions: boolean;
  tab: ReportTab;
  timelineMode: TimelineMode;
  onTimelineModeChange: (mode: TimelineMode) => void;
  uiDict: AppDictionary;
}) {
  const reportHoldingsColumns = useMemo(
    () => REPORT_HOLDINGS_COLUMNS.map((column) => ({
      ...column,
      label: reportHoldingColumnLabel(uiDict, column.id),
    })),
    [
      uiDict.holdings.dataHealthTerm,
      uiDict.holdings.unitPnlTerm,
      uiDict.reports.accounts,
      uiDict.reports.actions,
      uiDict.reports.allocation,
      uiDict.reports.averageCost,
      uiDict.reports.costBasis,
      uiDict.reports.dailyChange,
      uiDict.reports.marketValue,
      uiDict.reports.price,
      uiDict.reports.quantity,
      uiDict.reports.ticker,
      uiDict.reports.unrealizedPnl,
    ],
  );
  const dataHealthRef = useRef<HTMLDivElement | null>(null);
  const focusedHealthKeyRef = useRef<string | null>(null);
  const healthFocusKey = healthQuery.open ? healthQuery.reasons.join(",") || "open" : "";
  useEffect(() => {
    if (!healthQuery.open) {
      focusedHealthKeyRef.current = null;
      return;
    }
    if (focusedHealthKeyRef.current === healthFocusKey) return;
    const node = dataHealthRef.current;
    if (!node) return;
    focusedHealthKeyRef.current = healthFocusKey;
    window.requestAnimationFrame(() => {
      node.scrollIntoView?.({ block: "start", behavior: "smooth" });
      node.focus?.({ preventScroll: true });
    });
  }, [data, healthFocusKey, healthQuery.open]);

  if (isBootstrapping) return <ReportSkeleton />;
  if (errorMessage && !data) {
    return (
      <Card data-testid="reports-error">
        <CardHeader>
          <CardTitle>{uiDict.reports.reportUnavailable}</CardTitle>
          <CardDescription>{errorMessage}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{uiDict.reports.noReportData}</CardTitle>
          <CardDescription>{uiDict.reports.noReportDataDescription}</CardDescription>
        </CardHeader>
      </Card>
    );
  }
  if (!reportDataMatchesTab(data, tab)) return <ReportSkeleton />;
  const reportHealthHref = buildReportsHealthHref({ state: reportState, reasons: collectActiveReportHealthReasons(data) });
  const reportHealthReturnPath = buildReportsHealthHref({ state: reportState, reasons: healthQuery.reasons });

  return (
    <div className="flex flex-col gap-6" data-testid={`reports-${tab}-content`}>
      {errorMessage ? (
        <Alert data-testid="reports-refresh-error">
          <AlertTitle>{uiDict.reports.latestRefreshFailed}</AlertTitle>
          <AlertDescription>{errorMessage}</AlertDescription>
        </Alert>
      ) : null}
      <ReportMeta data={data} dict={uiDict} locale={locale} />
      <ReportBasisStrip data={data} dict={uiDict} locale={locale} />
      <SummaryGrid
        dataHealth={data.dataHealth}
        summary={data.summary}
        currency={data.query.reportingCurrency}
        dict={uiDict}
        locale={locale}
        realizedPnlHref={realizedPnlHref}
        unrealizedPnlHref={unrealizedPnlHref}
        healthHref={reportHealthHref}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <FxStatusCard dict={uiDict} fxRates={data.fxRates} fxStatus={data.fxStatus} locale={locale} />
        <DataHealthCard
          data={data}
          dataHealth={data.dataHealth}
          dict={uiDict}
          healthQuery={healthQuery}
          locale={locale}
          returnTo={reportHealthReturnPath}
          sectionRef={dataHealthRef}
          showAdminActions={showAdminActions}
        />
      </div>
      {tab === "daily-review" ? <DailyReviewView data={data as DailyReviewReportDto} dict={uiDict} holdingsColumns={reportHoldingsColumns} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} showAdminActions={showAdminActions} /> : null}
      {tab === "portfolio" ? (
        <PortfolioReportView
          data={data as PortfolioReportDto}
          dict={uiDict}
          holdingsColumns={reportHoldingsColumns}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
          showAdminActions={showAdminActions}
          tickerRepairReturnTo={reportHealthReturnPath}
          timelineMode={timelineMode}
          onTimelineModeChange={onTimelineModeChange}
        />
      ) : null}
      {tab === "market" ? (
        <MarketReportView
          data={data as MarketReportDto}
          dict={uiDict}
          holdingsColumns={reportHoldingsColumns}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
          showAdminActions={showAdminActions}
          tickerRepairReturnTo={reportHealthReturnPath}
          timelineMode={timelineMode}
          onTimelineModeChange={onTimelineModeChange}
        />
      ) : null}
    </div>
  );
}

function reportDataMatchesTab(data: AnyReportDto, tab: ReportTab): boolean {
  if (tab === "daily-review") return "suggestions" in data && "topMovers" in data && "holdings" in data;
  if (tab === "portfolio") return "performance" in data && "allocation" in data && "income" in data;
  return "performance" in data && "marketSummary" in data && "detail" in data;
}

function hasIncompleteReportValuation(dataHealth: ReportDataHealthDto): boolean {
  const currentMissingFxCount = dataHealth.currentMissingFxCount ?? dataHealth.missingFxCount;
  return dataHealth.missingQuoteCount > 0
    || dataHealth.provisionalQuoteCount > 0
    || dataHealth.nonCurrentPriceCount > 0
    || currentMissingFxCount > 0;
}

function hasIncompleteReportValuationFromHealth(
  valuationHealth: DashboardPerformanceDto["valuationHealth"] | undefined,
): boolean {
  return valuationHealth != null && valuationHealth.status !== "healthy";
}

function collectActiveReportHealthReasons(data: AnyReportDto): ReportHealthReason[] {
  const holdings = collectReportHoldingRows(data);
  const diagnostics = data.diagnostics;
  return REPORT_HEALTH_REASON_ORDER.filter((reason) => isReportHealthReasonActive(reason, data, holdings, diagnostics));
}

interface ReportHealthCause {
  reason: ReportHealthReason;
  active: boolean;
  count: number;
  title: string;
  description: string;
  tickers: string[];
  markets: string[];
  fxPairs: string[];
  settingsRepairHref: string | null;
  adminHref: string | null;
}

function isBackfillRelatedReportHealthReason(reason: ReportHealthReason): boolean {
  return reason !== "missing_fx";
}

function reportHealthReasonCopy(dict: AppDictionary, reason: ReportHealthReason): { title: string; description: string } {
  switch (reason) {
    case "missing_quote":
      return { title: dict.reports.dataHealthMissingQuoteTitle, description: dict.reports.dataHealthMissingQuoteDescription };
    case "provisional_quote":
      return { title: dict.reports.dataHealthProvisionalQuoteTitle, description: dict.reports.dataHealthProvisionalQuoteDescription };
    case "non_current_price":
      return { title: dict.reports.dataHealthNonCurrentPriceTitle, description: dict.reports.dataHealthNonCurrentPriceDescription };
    case "missing_fx":
      return { title: dict.reports.dataHealthMissingFxTitle, description: dict.reports.dataHealthMissingFxDescription };
    case "missing_snapshot":
      return { title: dict.reports.dataHealthMissingSnapshotTitle, description: dict.reports.dataHealthMissingSnapshotDescription };
    case "stale_snapshot":
      return { title: dict.reports.dataHealthStaleSnapshotTitle, description: dict.reports.dataHealthStaleSnapshotDescription };
    case "missing_provider_source":
      return { title: dict.reports.dataHealthMissingProviderSourceTitle, description: dict.reports.dataHealthMissingProviderSourceDescription };
  }
}

function buildReportHealthCauses({
  data,
  dict,
  healthQuery,
  returnTo,
}: {
  data: AnyReportDto;
  dict: AppDictionary;
  healthQuery: ReportHealthQuery;
  returnTo: string;
}): ReportHealthCause[] {
  const holdings = collectReportHoldingRows(data);
  const diagnostics = data.diagnostics;
  const valuationHealth = reportValuationHealth(data);
  const reasons = new Set<ReportHealthReason>();
  diagnostics.knownGapReasons.forEach((reason) => {
    const mappedReason = reportHealthReasonFromDiagnostics(reason);
    if (isSnapshotReportHealthReason(mappedReason) && !canSurfaceSnapshotReportHealthReason(mappedReason, data, diagnostics, valuationHealth)) return;
    reasons.add(mappedReason);
  });
  diagnostics.snapshotGapHoldings?.forEach((holding) => {
    holding.knownGapReasons.forEach((reason) => reasons.add(reason));
  });
  if (affectedValuationHealthSnapshotTickers("missing_snapshot", valuationHealth).length > 0) reasons.add("missing_snapshot");
  if (affectedValuationHealthSnapshotTickers("stale_snapshot", valuationHealth).length > 0) reasons.add("stale_snapshot");
  if (data.dataHealth.missingQuoteCount > 0) reasons.add("missing_quote");
  if (data.dataHealth.provisionalQuoteCount > 0) reasons.add("provisional_quote");
  if (data.dataHealth.nonCurrentPriceCount > 0) reasons.add("non_current_price");
  if ((data.dataHealth.currentMissingFxCount ?? data.dataHealth.missingFxCount) > 0 || data.fxStatus.status !== "complete") reasons.add("missing_fx");
  if ("performance" in data) {
    const reportHasStaleSnapshot = hasReportStaleSnapshotDiagnostic(diagnostics);
    data.performance.diagnostics?.knownGapReasons.forEach((reason) => {
      const mappedReason = reportHealthReasonFromPerformanceGap(reason);
      if (isSnapshotReportHealthReason(mappedReason) && !canSurfaceSnapshotReportHealthReason(mappedReason, data, diagnostics, valuationHealth)) return;
      if (mappedReason === "stale_snapshot" && !reportHasStaleSnapshot) return;
      reasons.add(mappedReason);
    });
    if (
      data.performance.marketDataStaleSince
      && reportHasStaleSnapshot
      && canSurfaceSnapshotReportHealthReason("stale_snapshot", data, diagnostics, valuationHealth)
    ) reasons.add("stale_snapshot");
    if (
      data.performance.points.length === 0
      && canSurfaceSnapshotReportHealthReason("missing_snapshot", data, diagnostics, valuationHealth)
    ) reasons.add("missing_snapshot");
  }
  const requestedReasons = new Set(healthQuery.reasons);
  requestedReasons.forEach((reason) => reasons.add(reason));

  return [...reasons].sort((left, right) => reportHealthReasonRank(left) - reportHealthReasonRank(right)).map((reason) => {
    const copy = reportHealthReasonCopy(dict, reason);
    const active = isReportHealthReasonActive(reason, data, holdings, diagnostics, valuationHealth);
    const tickers = affectedReportTickers(reason, holdings, diagnostics, valuationHealth);
    const markets = affectedReportMarkets(reason, data, holdings, diagnostics);
    const fxPairs = reason === "missing_fx"
      ? data.fxStatus.missingRatePairs.map((pair) => `${pair.from}->${pair.to}`)
      : [];
    const repairMarket = reason === "missing_fx" ? "FX" : markets.length === 1 ? markets[0] : data.query.scope === "all" ? null : data.query.scope;
    const repairTickers = tickers.map((value) => value.split(" · ")[0]).filter(Boolean);
    return {
      reason,
      active,
      count: reportHealthReasonCount(reason, data, holdings, diagnostics),
      title: copy.title,
      description: active ? copy.description : dict.reports.dataHealthInactiveDescription,
      tickers,
      markets,
      fxPairs,
      settingsRepairHref: active && isBackfillRelatedReportHealthReason(reason)
        ? buildTickerRepairHref({ marketCode: repairMarket, reason, returnTo, tickers: repairTickers })
        : null,
      adminHref: active ? buildReportHealthAdminHref(repairMarket, repairTickers) : null,
    };
  });
}

function reportHealthReasonRank(reason: ReportHealthReason): number {
  return REPORT_HEALTH_REASON_ORDER.indexOf(reason);
}

const REPORT_HEALTH_REASON_ORDER: ReportHealthReason[] = [
  "missing_quote",
  "provisional_quote",
  "non_current_price",
  "missing_fx",
  "missing_snapshot",
  "stale_snapshot",
  "missing_provider_source",
];

function collectReportHoldingRows(data: AnyReportDto): ReportHoldingRowDto[] {
  if ("suggestions" in data) return [...data.topMovers, ...data.holdings.rows];
  if ("allocation" in data) return [...data.concentration.topHoldings, ...data.holdings.rows];
  return [...data.topHoldings, ...data.detail.rows];
}

function isReportHealthReasonActive(
  reason: ReportHealthReason,
  data: AnyReportDto,
  holdings: ReportHoldingRowDto[],
  diagnostics: ReportDiagnosticsDto,
  valuationHealth = reportValuationHealth(data),
): boolean {
  return reportHealthReasonCount(reason, data, holdings, diagnostics, valuationHealth) > 0;
}

function reportHealthReasonCount(
  reason: ReportHealthReason,
  data: AnyReportDto,
  holdings: ReportHoldingRowDto[],
  diagnostics: ReportDiagnosticsDto,
  valuationHealth = reportValuationHealth(data),
): number {
  switch (reason) {
    case "missing_quote":
      return Math.max(data.dataHealth.missingQuoteCount, holdings.filter((row) => row.quoteStatus === "missing").length);
    case "provisional_quote":
      return Math.max(data.dataHealth.provisionalQuoteCount, holdings.filter((row) => row.quoteStatus === "provisional").length);
    case "non_current_price":
      return Math.max(data.dataHealth.nonCurrentPriceCount, holdings.filter((row) => isNonCurrentPrice(row)).length);
    case "missing_fx":
      return Math.max(data.dataHealth.currentMissingFxCount ?? data.dataHealth.missingFxCount, data.fxStatus.missingRatePairs.length);
    case "missing_snapshot": {
      const snapshotGapCount = snapshotGapHoldingCountForReason("missing_snapshot", diagnostics, valuationHealth);
      if (snapshotGapCount > 0) return snapshotGapCount;
      if (!canSurfaceSnapshotReportHealthReason("missing_snapshot", data, diagnostics, valuationHealth)) return 0;
      return diagnostics.knownGapReasons.includes("missing_snapshot") || ("performance" in data && data.performance.points.length === 0) ? 1 : 0;
    }
    case "stale_snapshot": {
      const snapshotGapCount = snapshotGapHoldingCountForReason("stale_snapshot", diagnostics, valuationHealth);
      if (snapshotGapCount > 0) return snapshotGapCount;
      if (!canSurfaceSnapshotReportHealthReason("stale_snapshot", data, diagnostics, valuationHealth)) return 0;
      return hasReportStaleSnapshotDiagnostic(diagnostics) ? 1 : 0;
    }
    case "missing_provider_source":
      return diagnostics.missingProviderSourceCount;
  }
}

function isSnapshotReportHealthReason(reason: ReportHealthReason): reason is "missing_snapshot" | "stale_snapshot" {
  return reason === "missing_snapshot" || reason === "stale_snapshot";
}

function snapshotGapHoldingCountForReason(
  reason: "missing_snapshot" | "stale_snapshot",
  diagnostics: ReportDiagnosticsDto,
  valuationHealth?: DashboardPerformanceDto["valuationHealth"],
): number {
  return Math.max(
    diagnostics.snapshotGapHoldings?.filter((holding) => holding.knownGapReasons.includes(reason)).length ?? 0,
    affectedValuationHealthSnapshotTickers(reason, valuationHealth).length,
  );
}

function canSurfaceSnapshotReportHealthReason(
  reason: "missing_snapshot" | "stale_snapshot",
  data: AnyReportDto,
  diagnostics: ReportDiagnosticsDto,
  valuationHealth?: DashboardPerformanceDto["valuationHealth"],
): boolean {
  return data.dataHealth.holdingCount > 0 || snapshotGapHoldingCountForReason(reason, diagnostics, valuationHealth) > 0;
}

function hasReportStaleSnapshotDiagnostic(diagnostics: ReportDiagnosticsDto): boolean {
  return diagnostics.knownGapReasons.includes("stale_snapshot")
    || Boolean(diagnostics.staleSinceDate)
    || Boolean(diagnostics.snapshotGapHoldings?.some((holding) => holding.knownGapReasons.includes("stale_snapshot")))
    || diagnostics.markets.some((market) => market.knownGapReasons.map(reportHealthReasonFromDiagnostics).includes("stale_snapshot"));
}

function affectedReportTickers(
  reason: ReportHealthReason,
  holdings: ReportHoldingRowDto[],
  diagnostics: ReportDiagnosticsDto,
  valuationHealth?: DashboardPerformanceDto["valuationHealth"],
): string[] {
  if (reason === "missing_snapshot" || reason === "stale_snapshot") {
    const fromSnapshotGaps = diagnostics.snapshotGapHoldings
      ?.filter((holding) => holding.knownGapReasons.includes(reason))
      .map((holding) => `${holding.ticker} · ${holding.marketCode}`) ?? [];
    const fromValuationHealth = affectedValuationHealthSnapshotTickers(reason, valuationHealth);
    if (fromSnapshotGaps.length > 0 || fromValuationHealth.length > 0) {
      return uniqueLimited([...fromSnapshotGaps, ...fromValuationHealth], 12);
    }

    const affectedMarkets = new Set(diagnostics.markets
      .filter((market) => market.knownGapReasons.map(reportHealthReasonFromDiagnostics).includes(reason))
      .map((market) => market.marketCode));
    return uniqueLimited(holdings
      .filter((row) => affectedMarkets.has(row.marketCode))
      .map((row) => `${row.ticker} · ${row.marketCode}`), 12);
  }

  const filtered = holdings.filter((row) => {
    if (reason === "missing_quote") return row.quoteStatus === "missing";
    if (reason === "provisional_quote") return row.quoteStatus === "provisional";
    if (reason === "non_current_price") return isNonCurrentPrice(row);
    if (reason === "missing_fx") return row.fxStatus !== "complete";
    return false;
  });
  return uniqueLimited(filtered.map((row) => `${row.ticker} · ${row.marketCode}`), 12);
}

function reportValuationHealth(data: AnyReportDto): DashboardPerformanceDto["valuationHealth"] | undefined {
  return "performance" in data ? data.valuationHealth ?? data.performance.valuationHealth : undefined;
}

function affectedValuationHealthSnapshotTickers(
  reason: "missing_snapshot" | "stale_snapshot",
  valuationHealth?: DashboardPerformanceDto["valuationHealth"],
): string[] {
  return valuationHealth?.affectedHoldings
    .filter((holding) => holding.status === reason)
    .map((holding) => `${holding.ticker} · ${holding.marketCode}`) ?? [];
}

function affectedReportMarkets(
  reason: ReportHealthReason,
  data: AnyReportDto,
  holdings: ReportHoldingRowDto[],
  diagnostics: ReportDiagnosticsDto,
): string[] {
  const fromDiagnostics = data.diagnostics.markets
    .filter((market) => market.knownGapReasons.map(reportHealthReasonFromDiagnostics).includes(reason))
    .map((market) => market.marketCode);
  const fromHoldings = affectedReportTickers(reason, holdings, diagnostics, reportValuationHealth(data))
    .map((label) => label.split(" · ")[1])
    .filter((market): market is string => Boolean(market));
  const scopedMarket = data.query.scope === "all" ? [] : [data.query.scope];
  return uniqueLimited([...fromDiagnostics, ...fromHoldings, ...scopedMarket], 8);
}

function buildReportHealthAdminHref(marketCode: string | null, tickers: string[]): string {
  const params = new URLSearchParams();
  if (tickers.length > 0) params.set("search", tickers.slice(0, 20).join(" "));
  return marketCode
    ? `/admin/market-data/${encodeURIComponent(marketCode)}/overview${params.size > 0 ? `?${params.toString()}` : ""}`
    : `/admin/market-data${params.size > 0 ? `?${params.toString()}` : ""}`;
}

function uniqueLimited(values: string[], limit: number): string[] {
  return [...new Set(values.filter(Boolean))].slice(0, limit);
}

function ReportMeta({ data, dict, locale }: { data: AnyReportDto; dict: AppDictionary; locale: LocaleCode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground" data-testid="reports-meta">
      <Badge variant="outline">{data.query.scope === "all" ? dict.reports.allMarkets : data.query.scope}</Badge>
      <Badge variant="secondary">{formatReportMessage(dict.reports.reportingCurrencyBadge, { currency: data.query.reportingCurrency })}</Badge>
      <Badge variant={data.fxStatus.status === "complete" ? "secondary" : "outline"}>{formatReportMessage(dict.reports.fxStatusBadge, { status: data.fxStatus.status })}</Badge>
      <span>{formatDateLabel(data.query.asOf, locale)}</span>
    </div>
  );
}

function ReportBasisStrip({ data, dict, locale }: { data: AnyReportDto; dict: AppDictionary; locale: LocaleCode }) {
  const marketSummaries = buildReportBasisMarketSummaries(data);
  const fxSummary = buildReportBasisFxSummary(data, dict, locale);

  return (
    <section
      aria-labelledby="reports-basis-strip-title"
      className="rounded-lg border border-border/70 bg-muted/20 px-4 py-3"
      data-testid="reports-basis-strip"
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="max-w-3xl">
          <h2 id="reports-basis-strip-title" className="text-sm font-semibold text-foreground">{dict.reports.basisStripTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{dict.reports.basisStripDescription}</p>
        </div>
        <div className="flex min-w-0 flex-wrap gap-2">
          {marketSummaries.map((summary) => (
            <div
              key={summary.marketCode}
              className="min-w-[16rem] rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground"
              data-testid={`reports-basis-market-${summary.marketCode}`}
            >
              <p className="font-medium text-foreground">
                {formatReportMessage(dict.reports.basisMarketLabel, { market: summary.marketCode })}
              </p>
              <p className="mt-1">
                {summary.quoteAsOf
                  ? formatReportMessage(dict.reports.basisMarketQuoteAsOf, { date: formatDateLabel(summary.quoteAsOf, locale) })
                  : dict.reports.basisMarketUnavailable}
              </p>
              <p className="mt-1">
                {summary.sources.length > 0
                  ? formatReportBasisSourceSummary(summary, dict)
                  : dict.reports.basisMarketUnavailable}
              </p>
              <p className="mt-1">
                {formatReportBasisFallbackSummary(summary, dict)}
              </p>
              <p className="mt-1">
                {summary.closureDate && summary.quoteAsOf && isConfirmedMarketClosure(summary.closureReason)
                  ? formatReportMessage(dict.reports.basisMarketRollback, {
                      actual: formatDateLabel(summary.quoteAsOf, locale),
                      expected: formatReportClosureLabel(summary, locale),
                      market: summary.marketCode,
                    })
                  : summary.expectedLatestValuationDate && summary.quoteAsOf && summary.quoteAsOf < summary.expectedLatestValuationDate
                    ? formatReportMessage(dict.reports.basisMarketStaleQuote, {
                        actual: formatDateLabel(summary.quoteAsOf, locale),
                        expected: formatDateLabel(summary.expectedLatestValuationDate, locale),
                        market: summary.marketCode,
                      })
                  : summary.quoteAsOf
                    ? formatReportMessage(dict.reports.basisMarketCurrent, { date: formatDateLabel(summary.quoteAsOf, locale) })
                    : dict.reports.basisMarketUnavailable}
              </p>
            </div>
          ))}
          <div className="min-w-[14rem] rounded-md border border-border bg-background px-3 py-2 text-xs text-muted-foreground" data-testid="reports-basis-fx">
            <p className="font-medium text-foreground">{dict.reports.basisFxLabel}</p>
            <p className="mt-1">{fxSummary}</p>
          </div>
        </div>
      </div>
    </section>
  );
}

function buildReportBasisMarketSummaries(data: AnyReportDto): Array<{
  marketCode: string;
  quoteAsOf: string | null;
  sources: string[];
  fallbackUsed: boolean;
  fallbackQuoteCount: number | null;
  holdingCount: number | null;
  expectedLatestValuationDate: string | null;
  closureDate: string | null;
  closureName: string | null;
  closureReason: "market_holiday" | "weekend" | "calendar_unknown" | null;
}> {
  const holdings = collectReportHoldingRows(data);
  const rowsByMarket = new Map<string, ReportHoldingRowDto[]>();
  for (const row of holdings) {
    const list = rowsByMarket.get(row.marketCode) ?? [];
    list.push(row);
    rowsByMarket.set(row.marketCode, list);
  }

  const valuationMarkets = data.diagnostics.valuationBasis?.markets;
  if (valuationMarkets && valuationMarkets.length > 0) {
    return valuationMarkets.map((market) => {
      const rows = rowsByMarket.get(market.marketCode) ?? [];
      const rowFallbackCount = rows.filter((row) => row.priceState.fallbackProvider || row.priceState.basis === "fallback_eod_close").length;
      const fallbackQuoteCount = market.fallbackQuoteCount ?? (rows.length > 0 ? rowFallbackCount : null);
      const holdingCount = market.holdingCount ?? (rows.length > 0 ? rows.length : null);
      const quoteSources = uniqueSortedNonEmptyStrings([
        ...(market.quoteSources ?? []),
        ...rows.map((row) => row.priceState.source),
        market.quoteSource,
      ]);
      const fallbackProviders = uniqueSortedNonEmptyStrings([
        ...(market.fallbackProviders ?? []),
        ...rows.map((row) => row.priceState.fallbackProvider),
        market.fallbackProvider ?? null,
      ]);
      return {
        marketCode: market.marketCode,
        quoteAsOf: market.quoteAsOfDate,
        sources: buildReportBasisSourceList(quoteSources, fallbackProviders, fallbackQuoteCount, holdingCount),
        fallbackUsed: market.usesFallbackQuote,
        fallbackQuoteCount,
        holdingCount,
        expectedLatestValuationDate: market.expectedLatestValuationDate,
        closureDate: market.closureDate,
        closureName: market.closureName,
        closureReason: market.closureReason,
      };
    });
  }

  const marketCodes = data.diagnostics.markets.length > 0
    ? data.diagnostics.markets.map((market) => market.marketCode)
    : Array.from(rowsByMarket.keys());

  return marketCodes.map((marketCode) => {
    const market = data.diagnostics.markets.find((candidate) => candidate.marketCode === marketCode);
    const rows = rowsByMarket.get(marketCode) ?? [];
    const quoteAsOf = conservativeQuoteAsOfDate(rows.map((row) => row.priceState.asOfDate));
    const fallbackQuoteCount = rows.filter((row) => row.priceState.fallbackProvider || row.priceState.basis === "fallback_eod_close").length;
    const quoteSources = uniqueSortedNonEmptyStrings([
      ...rows.map((row) => row.priceState.source),
      ...(market?.providerSources ?? []),
    ]);
    const fallbackProviders = uniqueSortedNonEmptyStrings(rows.map((row) => row.priceState.fallbackProvider));
    const sources = buildReportBasisSourceList(quoteSources, fallbackProviders, fallbackQuoteCount, rows.length);
    const fallbackUsed = fallbackQuoteCount > 0;

    return {
      marketCode,
      quoteAsOf,
      sources,
      fallbackUsed,
      fallbackQuoteCount,
      holdingCount: rows.length,
      expectedLatestValuationDate: market?.expectedLatestValuationDate ?? null,
      closureDate: market?.basis?.closureDate ?? null,
      closureName: market?.basis?.closureName ?? null,
      closureReason: market?.basis?.closureReason ?? null,
    };
  });
}

function buildReportBasisSourceList(
  quoteSources: string[],
  fallbackProviders: string[],
  fallbackQuoteCount: number | null,
  holdingCount: number | null,
): string[] {
  if (
    fallbackQuoteCount !== null
    && holdingCount !== null
    && fallbackQuoteCount > 0
    && fallbackQuoteCount === holdingCount
    && fallbackProviders.length > 0
  ) {
    return fallbackProviders;
  }
  return uniqueSortedNonEmptyStrings([...quoteSources, ...fallbackProviders]);
}

function formatReportBasisSourceSummary(
  summary: { sources: string[]; fallbackQuoteCount: number | null; holdingCount: number | null },
  dict: AppDictionary,
): string {
  const source = summary.sources.join(", ");
  const hasPartialFallback = summary.fallbackQuoteCount !== null
    && summary.holdingCount !== null
    && summary.fallbackQuoteCount > 0
    && summary.fallbackQuoteCount < summary.holdingCount;
  if (summary.sources.length > 1 || hasPartialFallback) {
    return formatReportMessage(dict.reports.basisMarketSources, { sources: source });
  }
  return formatReportMessage(dict.reports.basisMarketSource, { source });
}

function formatReportBasisFallbackSummary(
  summary: { fallbackUsed: boolean; fallbackQuoteCount: number | null; holdingCount: number | null },
  dict: AppDictionary,
): string {
  if (!summary.fallbackUsed) return dict.reports.basisMarketFallbackNone;
  if (
    summary.fallbackQuoteCount !== null
    && summary.holdingCount !== null
    && summary.fallbackQuoteCount > 0
    && summary.fallbackQuoteCount < summary.holdingCount
  ) {
    return formatReportMessage(dict.reports.basisMarketFallbackPartial, {
      count: String(summary.fallbackQuoteCount),
      total: String(summary.holdingCount),
    });
  }
  return dict.reports.basisMarketFallbackUsed;
}

function isConfirmedMarketClosure(reason: "market_holiday" | "weekend" | "calendar_unknown" | null): boolean {
  return reason === "market_holiday" || reason === "weekend";
}

function formatReportClosureLabel(
  summary: { closureDate: string | null; closureName: string | null },
  locale: LocaleCode,
): string {
  if (!summary.closureDate) return "-";
  const date = formatDateLabel(summary.closureDate, locale);
  return summary.closureName ? `${date} (${summary.closureName})` : date;
}

function buildReportBasisFxSummary(data: AnyReportDto, dict: AppDictionary, locale: LocaleCode): string {
  if (data.fxStatus.nativeCurrencies.every((currency) => currency === data.fxStatus.reportingCurrency)) {
    return dict.reports.basisFxNotRequired;
  }
  const rates = getOptionalFxRates(data.fxStatus, data.fxRates);
  const dates = [...new Set(rates.flatMap((rate) => rate.asOf ? [rate.asOf] : []))].sort();
  if (data.fxStatus.status !== "complete" || data.fxStatus.missingRatePairs.length > 0) {
    const pairs = data.fxStatus.missingRatePairs.map((pair) => `${pair.from}->${pair.to}`).join(", ");
    const unavailable = pairs
      ? formatReportMessage(dict.reports.basisFxUnavailableForPairs, { pairs })
      : dict.reports.basisFxUnavailable;
    if (dates.length === 1) {
      return `${unavailable}; ${formatReportMessage(dict.reports.basisFxAsOf, { date: formatDateLabel(dates[0]!, locale) })}`;
    }
    if (dates.length > 1) {
      return `${unavailable}; ${formatReportMessage(dict.reports.basisFxDateRange, {
        start: formatDateLabel(dates[0]!, locale),
        end: formatDateLabel(dates.at(-1)!, locale),
      })}`;
    }
    return unavailable;
  }
  if (dates.length === 1) {
    return formatReportMessage(dict.reports.basisFxAsOf, { date: formatDateLabel(dates[0]!, locale) });
  }
  if (dates.length > 1) {
    return formatReportMessage(dict.reports.basisFxDateRange, {
      start: formatDateLabel(dates[0]!, locale),
      end: formatDateLabel(dates.at(-1)!, locale),
    });
  }
  return dict.reports.basisFxLatest;
}

function conservativeQuoteAsOfDate(values: Array<string | null | undefined>): string | null {
  if (values.length === 0 || values.some((value) => !value)) return null;
  return [...values].sort()[0] ?? null;
}

function uniqueSortedNonEmptyStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right));
}

type SummaryMetricItem = {
  label: string;
  value: number | null;
  toneValue?: number | null;
  detail?: string;
  href?: string | null;
  linkAriaLabel?: string;
  linkTestId?: string;
  healthHref?: string | null;
  healthLinkLabel?: string;
  healthLinkTestId?: string;
};

function SummaryGrid({
  dataHealth,
  currency,
  dict,
  locale,
  realizedPnlHref,
  summary,
  unrealizedPnlHref,
  healthHref,
}: {
  dataHealth: ReportDataHealthDto;
  currency: AccountDefaultCurrency;
  dict: AppDictionary;
  locale: LocaleCode;
  realizedPnlHref: string;
  summary: ReportSummaryTotalsDto;
  unrealizedPnlHref: string;
  healthHref: string;
}) {
  const strictTotalsUnavailable = hasIncompleteReportValuation(dataHealth);
  const items: SummaryMetricItem[] = [
    {
      label: dict.reports.marketValue,
      value: strictTotalsUnavailable ? null : summary.marketValueAmount,
      healthHref: strictTotalsUnavailable ? healthHref : null,
      healthLinkLabel: dict.reports.viewDataHealth,
      healthLinkTestId: "reports-summary-market-value-data-health-link",
    },
    { label: dict.reports.costBasis, value: summary.costBasisAmount },
    {
      label: dict.reports.unrealizedPnl,
      toneValue: strictTotalsUnavailable ? null : summary.unrealizedPnlAmount,
      value: strictTotalsUnavailable ? null : summary.unrealizedPnlAmount,
      href: unrealizedPnlHref,
      linkAriaLabel: dict.reports.openUnrealizedPnlAnalysis,
      linkTestId: "reports-summary-unrealized-pnl-analysis-link",
      healthHref: strictTotalsUnavailable ? healthHref : null,
      healthLinkLabel: dict.reports.whyHidden,
      healthLinkTestId: "reports-summary-unrealized-pnl-data-health-link",
    },
    {
      label: dict.reports.realizedPnl,
      toneValue: summary.realizedPnlAmount,
      value: summary.realizedPnlAmount,
      href: hasRealizedPnlTransactionDrilldown(summary) ? realizedPnlHref : null,
      linkAriaLabel: dict.reports.openRealizedPnlTransactions,
      linkTestId: "reports-summary-realized-pnl-link",
      detail: hasRealizedPnlTransactionDrilldown(summary)
        ? formatReportMessage(dict.reports.viewTransactionRecords, { count: formatNumber(summary.realizedPnlTransactionCount, locale) })
        : undefined,
    },
    {
      label: dict.reports.dailyChange,
      detail: strictTotalsUnavailable || summary.dailyChangePercent === null ? "-" : formatPercent(summary.dailyChangePercent, locale),
      toneValue: strictTotalsUnavailable ? null : summary.dailyChangeAmount,
      value: strictTotalsUnavailable ? null : summary.dailyChangeAmount,
      healthHref: strictTotalsUnavailable ? healthHref : null,
      healthLinkLabel: dict.reports.whyHidden,
      healthLinkTestId: "reports-summary-daily-change-data-health-link",
    },
    { label: dict.reports.income, value: summary.incomeAmount },
    {
      label: dict.reports.upcomingIncome,
      detail: formatReportMessage(dict.reports.dividendsCount, { count: formatNumber(summary.upcomingDividendCount, locale) }),
      value: summary.upcomingDividendAmount,
    },
  ];
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="reports-summary-grid">
      {items.map((item) => (
        <Card key={item.label} className={cn(item.toneValue != null && item.toneValue !== 0 ? "border-border/80" : null, item.href ? "transition hover:border-primary/40 hover:bg-muted/20" : null)}>
          <CardHeader className="p-4 pb-2">
            <CardDescription className="flex items-center justify-between gap-3">
              <span>{item.label}</span>
              <span className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground/80">{currency}</span>
            </CardDescription>
            {item.href ? (
              <Link
                href={item.href}
                className="block"
                aria-label={item.linkAriaLabel ?? item.label}
                data-testid={item.linkTestId}
              >
                <CardTitle
                  className={cn("break-words font-mono text-xl tabular-nums underline decoration-primary/30 underline-offset-4 sm:text-2xl", holdingsFinanceToneClass(item.toneValue ?? null, "text-foreground"))}
                  title={item.value === null ? undefined : formatCurrencyAmount(item.value, currency, locale)}
                >
                  {item.value === null
                    ? "-"
                    : item.toneValue === undefined
                      ? formatCompactCurrencyAmount(item.value, currency, locale)
                      : formatFinanceCurrencyAmount(item.value, currency, locale, true)}
                </CardTitle>
              </Link>
            ) : (
              <CardTitle
                className={cn("break-words font-mono text-xl tabular-nums sm:text-2xl", holdingsFinanceToneClass(item.toneValue ?? null, "text-foreground"))}
                title={item.value === null ? undefined : formatCurrencyAmount(item.value, currency, locale)}
              >
                {item.value === null
                  ? "-"
                  : item.toneValue === undefined
                    ? formatCompactCurrencyAmount(item.value, currency, locale)
                    : formatFinanceCurrencyAmount(item.value, currency, locale, true)}
              </CardTitle>
            )}
            {item.value !== null ? (
              <CardDescription className={cn("mt-1 break-words font-mono text-xs tabular-nums", holdingsFinanceToneClass(item.toneValue ?? null, "text-muted-foreground"))}>
                {formatExactAmountInline(dict, formatCurrencyAmount(item.value, currency, locale))}
              </CardDescription>
            ) : null}
          </CardHeader>
          {item.detail ? (
            <CardContent className={cn("px-4 pb-4 pt-0 text-sm", holdingsFinanceToneClass(item.toneValue ?? null, "text-muted-foreground"))}>
              {item.detail}
            </CardContent>
          ) : null}
          {item.healthHref ? (
            <CardContent className="px-4 pb-4 pt-0 text-sm">
              <Link
                href={item.healthHref}
                className="font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
                data-testid={item.healthLinkTestId}
              >
                {item.healthLinkLabel ?? dict.reports.viewDataHealth}
              </Link>
            </CardContent>
          ) : null}
        </Card>
      ))}
    </div>
  );
}

function FxStatusCard({
  dict,
  fxRates,
  fxStatus,
  locale,
}: {
  dict: AppDictionary;
  fxRates?: FxConversionRateDto[];
  fxStatus: ReportFxStatusDto;
  locale: LocaleCode;
}) {
  const rates = getOptionalFxRates(fxStatus, fxRates);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{dict.reports.fxStatusTitle}</CardTitle>
        <CardDescription>{formatReportMessage(dict.reports.fxPairDescription, {
          from: fxStatus.nativeCurrencies.join(", ") || fxStatus.reportingCurrency,
          to: fxStatus.reportingCurrency,
        })}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Badge variant={fxStatus.status === "complete" ? "secondary" : "outline"} className="w-fit">{fxStatus.status}</Badge>
        {fxStatus.missingRatePairs.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {fxStatus.missingRatePairs.map((pair) => (
              <Badge key={`${pair.from}-${pair.to}`} variant="outline">
                {formatReportMessage(dict.reports.fxPairLabel, { from: pair.from, to: pair.to })}
              </Badge>
            ))}
          </div>
        ) : null}
        {rates.length > 0 ? (
          <div className="grid gap-2" data-testid="reports-fx-rates">
            {rates.map((rate) => (
              <div key={`${rate.from}-${rate.to}-${rate.asOf ?? "latest"}`} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-sm font-medium text-foreground">{formatReportMessage(dict.reports.fxPairLabel, { from: rate.from, to: rate.to })}</span>
                  {rate.asOf ? <span className="text-xs text-muted-foreground">As of {formatDateLabel(rate.asOf, locale)}</span> : null}
                </div>
                <span className="font-mono text-sm font-semibold tabular-nums text-foreground">
                  {rate.rate === null ? "-" : formatFxRate(rate.rate)}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function DataHealthCard({
  data,
  dataHealth,
  dict,
  healthQuery,
  locale,
  returnTo,
  sectionRef,
  showAdminActions,
}: {
  data: AnyReportDto;
  dataHealth: ReportDataHealthDto;
  dict: AppDictionary;
  healthQuery: ReportHealthQuery;
  locale: LocaleCode;
  returnTo: string;
  sectionRef: { current: HTMLDivElement | null };
  showAdminActions: boolean;
}) {
  const [copiedAdminHref, setCopiedAdminHref] = useState<string | null>(null);
  const causes = useMemo(
    () => buildReportHealthCauses({ data, dict, healthQuery, returnTo }),
    [data, dict, healthQuery, returnTo],
  );
  const rows = [
    { key: "holdingCount", label: dict.holdings.dataHealthHoldingCount, value: dataHealth.holdingCount },
    { key: "missingQuoteCount", label: dict.holdings.dataHealthMissingQuoteCount, value: dataHealth.missingQuoteCount },
    { key: "provisionalQuoteCount", label: dict.holdings.dataHealthProvisionalQuoteCount, value: dataHealth.provisionalQuoteCount },
    { key: "missingFxCount", label: dict.holdings.dataHealthMissingFxCount, value: dataHealth.currentMissingFxCount ?? dataHealth.missingFxCount },
    { key: "nonCurrentPriceCount", label: dict.holdings.dataHealthNonCurrentPriceCount, value: dataHealth.nonCurrentPriceCount },
  ];
  return (
    <Card
      ref={(node) => {
        sectionRef.current = node;
      }}
      tabIndex={-1}
      data-testid="reports-data-health-card"
      className={cn(healthQuery.open && "ring-2 ring-primary/30")}
    >
      <CardHeader>
        <CardTitle>{dict.reports.dataHealthChecklistTitle}</CardTitle>
        <CardDescription>{dict.reports.dataHealthChecklistDescription}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
              <span className="text-sm text-muted-foreground">{row.label}</span>
              <span className="font-mono text-sm font-semibold tabular-nums">{row.value}</span>
            </div>
          ))}
        </div>
        {hasIncompleteReportValuation(dataHealth) ? (
          <Alert data-testid="reports-strict-totals-alert">
            <AlertTitle>{dict.reports.strictTotalsNoticeTitle}</AlertTitle>
            <AlertDescription>{dict.reports.strictTotalsNoticeDescription}</AlertDescription>
          </Alert>
        ) : null}
        {causes.length > 0 ? (
          <div className="space-y-2" data-testid="reports-data-health-causes">
            {causes.map((cause) => (
              <div
                key={cause.reason}
                className={cn(
                  "rounded-lg border border-border bg-background p-3",
                  !cause.active && "border-dashed bg-muted/20 opacity-75",
                  healthQuery.reasons.includes(cause.reason) && "ring-2 ring-primary/25",
                )}
                data-testid={`reports-data-health-cause-${cause.reason}`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-foreground">{cause.title}</p>
                      <Badge variant={cause.active ? "outline" : "secondary"}>
                        {cause.active ? dict.reports.dataHealthActive : dict.reports.dataHealthInactive}
                      </Badge>
                      {cause.active ? <Badge variant="secondary">{formatNumber(cause.count, locale)}</Badge> : null}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{cause.description}</p>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {cause.settingsRepairHref ? (
                      <Button asChild size="sm" variant="secondary" data-testid={`reports-data-health-settings-${cause.reason}`}>
                        <Link href={cause.settingsRepairHref}>{dict.reports.dataHealthSettingsRepairAction}</Link>
                      </Button>
                    ) : null}
                    {cause.adminHref && showAdminActions ? (
                      <Button asChild size="sm" data-testid={`reports-data-health-admin-${cause.reason}`}>
                        <Link href={cause.adminHref}>{dict.reports.dataHealthAdminRepairAction}</Link>
                      </Button>
                    ) : null}
                    {cause.adminHref && !showAdminActions ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        data-testid={`reports-data-health-copy-admin-${cause.reason}`}
                        onClick={() => {
                          void copyReportHealthAdminLink(cause, locale).then((copied) => {
                            if (copied) setCopiedAdminHref(cause.adminHref);
                          });
                        }}
                      >
                        {copiedAdminHref === cause.adminHref ? dict.reports.dataHealthAdminCopied : dict.reports.dataHealthCopyAdminAction}
                      </Button>
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 text-sm md:grid-cols-3">
                  <AffectedItems label={dict.reports.dataHealthAffectedTickers} values={cause.tickers} emptyLabel={dict.reports.dataHealthNoAffectedItems} />
                  <AffectedItems label={dict.reports.dataHealthAffectedMarkets} values={cause.markets} emptyLabel={dict.reports.dataHealthNoAffectedItems} />
                  <AffectedItems label={dict.reports.dataHealthAffectedFxPairs} values={cause.fxPairs} emptyLabel={dict.reports.dataHealthNoAffectedItems} />
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function AffectedItems({ emptyLabel, label, values }: { emptyLabel: string; label: string; values: string[] }) {
  return (
    <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="mt-1 break-words font-mono text-xs text-foreground">
        {values.length > 0 ? values.join(", ") : emptyLabel}
      </p>
    </div>
  );
}

async function copyReportHealthAdminLink(cause: ReportHealthCause, locale: LocaleCode): Promise<boolean> {
  if (!cause.adminHref || !navigator.clipboard?.writeText) return false;
  const absoluteHref = typeof window === "undefined"
    ? cause.adminHref
    : new URL(cause.adminHref, window.location.origin).href;
  const lines = [
    cause.title,
    cause.description,
    cause.tickers.length > 0 ? `${cause.tickers.join(", ")}` : null,
    cause.markets.length > 0 ? `${cause.markets.join(", ")}` : null,
    cause.fxPairs.length > 0 ? `${cause.fxPairs.join(", ")}` : null,
    formatDateLabel(new Date().toISOString().slice(0, 10), locale),
    absoluteHref,
  ].filter((line): line is string => line !== null);
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    return true;
  } catch {
    return false;
  }
}

function DailyReviewView({
  data,
  dict,
  holdingsColumns,
  isRefreshing,
  locale,
  onRefresh,
  showAdminActions,
}: {
  data: DailyReviewReportDto;
  dict: AppDictionary;
  holdingsColumns: Array<HoldingsGridColumnDefinition<ReportHoldingsColumn>>;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  showAdminActions: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Card>
          <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>{dict.reports.todayTitle}</CardTitle>
              <CardDescription>{dict.reports.todayDescription}</CardDescription>
            </div>
            <SectionRefreshButton dict={dict} isRefreshing={isRefreshing} onRefresh={onRefresh} testId="reports-today-refresh" />
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {data.suggestions.length === 0 ? <p className="text-sm text-muted-foreground">{dict.reports.todayEmpty}</p> : null}
            {data.suggestions.map((item) => (
              <div key={item.code} className="rounded-md border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{item.title}</p>
                  <Badge
                    variant={item.severity === "critical" ? "destructive" : "outline"}
                    className={dailyReviewSeverityBadgeClass(item.severity)}
                    data-testid={`reports-today-severity-${item.code}`}
                  >
                    {dailyReviewSeverityLabel(dict, item.severity)}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{item.detail}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <HoldingsCard
          columns={holdingsColumns}
          defaultSort={{ sortMode: "custom" }}
          dict={dict}
          title={dict.reports.topMoversTitle}
          contextKey={REPORTS_DAILY_REVIEW_TOP_MOVERS_CONTEXT_KEY}
          selectionUniverseRows={data.topMovers}
          rows={{
            ...data.holdings,
            limit: data.topMovers.length,
            offset: 0,
            rows: data.topMovers,
            total: data.topMovers.length,
          }}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
          showAdminActivityLinks={showAdminActions}
          showTopHoldingsLimit
        />
      </div>
      <HoldingsCard columns={holdingsColumns} dict={dict} title={dict.reports.holdingsDetailTitle} contextKey={REPORTS_DAILY_REVIEW_HOLDINGS_CONTEXT_KEY} selectionUniverseRows={data.holdings.rows} rows={data.holdings} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} showAdminActivityLinks={showAdminActions} stickyFirstColumn />
    </>
  );
}

function dailyReviewSeverityBadgeClass(severity: DailyReviewReportDto["suggestions"][number]["severity"]): string {
  switch (severity) {
    case "critical":
      return "border-destructive/70 bg-destructive/10 text-destructive";
    case "warning":
      return holdingsWarningBadgeClassName;
    case "info":
    default:
      return holdingsInfoBadgeClassName;
  }
}

function dailyReviewSeverityLabel(dict: AppDictionary, severity: DailyReviewReportDto["suggestions"][number]["severity"]): string {
  switch (severity) {
    case "critical":
      return dict.reports.severityCritical;
    case "warning":
      return dict.reports.severityWarning;
    case "info":
    default:
      return dict.reports.severityInfo;
  }
}

function PortfolioReportView({
  data,
  dict,
  holdingsColumns,
  isRefreshing,
  locale,
  onRefresh,
  showAdminActions,
  tickerRepairReturnTo,
  timelineMode,
  onTimelineModeChange,
}: {
  data: PortfolioReportDto;
  dict: AppDictionary;
  holdingsColumns: Array<HoldingsGridColumnDefinition<ReportHoldingsColumn>>;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  showAdminActions: boolean;
  tickerRepairReturnTo: string;
  timelineMode: TimelineMode;
  onTimelineModeChange: (mode: TimelineMode) => void;
}) {
  return (
    <>
      <PerformanceChart
        dict={dict}
        isRefreshing={isRefreshing}
        locale={locale}
        onRefresh={onRefresh}
        performance={data.performance}
        showAdminActions={showAdminActions}
        tickerRepairReturnTo={tickerRepairReturnTo}
        timelineMode={timelineMode}
        onTimelineModeChange={onTimelineModeChange}
        valuationHealth={data.valuationHealth ?? data.performance.valuationHealth}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <AllocationChart dict={dict} title={dict.reports.allocationByMarketTitle} buckets={data.allocation.byMarket} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
        <AllocationChart dict={dict} title={dict.reports.allocationByAccountTitle} buckets={data.allocation.byAccount} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
      </div>
      <TickerAllocationCard
        dict={dict}
        isRefreshing={isRefreshing}
        locale={locale}
        onRefresh={onRefresh}
        reportScope={data.query.scope}
        rows={Array.isArray(data.allocation.byTicker) ? data.allocation.byTicker : []}
      />
      <HoldingsCard columns={holdingsColumns} dict={dict} title={dict.reports.holdingsDetailTitle} contextKey={REPORTS_PORTFOLIO_HOLDINGS_CONTEXT_KEY} selectionUniverseRows={data.holdings.rows} rows={data.holdings} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} showAdminActivityLinks={showAdminActions} stickyFirstColumn />
    </>
  );
}

function MarketReportView({
  data,
  dict,
  holdingsColumns,
  isRefreshing,
  locale,
  onRefresh,
  showAdminActions,
  tickerRepairReturnTo,
  timelineMode,
  onTimelineModeChange,
}: {
  data: MarketReportDto;
  dict: AppDictionary;
  holdingsColumns: Array<HoldingsGridColumnDefinition<ReportHoldingsColumn>>;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  showAdminActions: boolean;
  tickerRepairReturnTo: string;
  timelineMode: TimelineMode;
  onTimelineModeChange: (mode: TimelineMode) => void;
}) {
  return (
    <>
      <PerformanceChart
        dict={dict}
        isRefreshing={isRefreshing}
        locale={locale}
        onRefresh={onRefresh}
        performance={data.performance}
        showAdminActions={showAdminActions}
        tickerRepairReturnTo={tickerRepairReturnTo}
        timelineMode={timelineMode}
        onTimelineModeChange={onTimelineModeChange}
        valuationHealth={data.valuationHealth ?? data.performance.valuationHealth}
      />
      <div className="grid gap-4 lg:grid-cols-[1fr_1.5fr]">
        <AllocationChart dict={dict} title={dict.reports.marketSummaryTitle} buckets={data.marketSummary} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} />
        <HoldingsCard
          columns={holdingsColumns}
          dict={dict}
          title={dict.reports.topHoldingsTitle}
          contextKey={REPORTS_MARKET_TOP_HOLDINGS_CONTEXT_KEY}
          selectionUniverseRows={data.topHoldings}
          rows={{
            ...data.detail,
            limit: data.topHoldings.length,
            offset: 0,
            rows: data.topHoldings,
            total: data.topHoldings.length,
          }}
          isRefreshing={isRefreshing}
          locale={locale}
          onRefresh={onRefresh}
          showAdminActivityLinks={showAdminActions}
          showTopHoldingsLimit
        />
      </div>
      <HoldingsCard columns={holdingsColumns} dict={dict} title={dict.reports.marketDetailTitle} contextKey={REPORTS_MARKET_DETAIL_CONTEXT_KEY} selectionUniverseRows={data.detail.rows} rows={data.detail} isRefreshing={isRefreshing} locale={locale} onRefresh={onRefresh} showAdminActivityLinks={showAdminActions} stickyFirstColumn />
    </>
  );
}

function PerformanceChart({
  dict,
  isRefreshing,
  locale,
  onRefresh,
  performance,
  showAdminActions,
  tickerRepairReturnTo,
  timelineMode,
  onTimelineModeChange,
  valuationHealth,
}: {
  dict: AppDictionary;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  performance: DashboardPerformanceDto;
  showAdminActions: boolean;
  tickerRepairReturnTo: string | null;
  timelineMode: TimelineMode;
  onTimelineModeChange: (mode: TimelineMode) => void;
  valuationHealth?: DashboardPerformanceDto["valuationHealth"];
}) {
  const points = performance.points;
  const chartPoints = points.map((point) => ({ ...point, dateMs: new Date(`${point.date}T00:00:00.000Z`).getTime() }));
  const latestTotalReturnAmount = [...points].reverse().find((point) => point.totalReturnAmount != null)?.totalReturnAmount;
  const lastReliableDate = performance.lastReliableDate ?? findLastReliablePointDate(points);
  const marketDataStaleSince = performance.marketDataStaleSince ?? null;
  const timelineAxis = buildTimelineAxis({
    endDate: performance.rangeEndDate ?? performance.requestedAsOf ?? points.at(-1)?.date ?? new Date().toISOString().slice(0, 10),
    locale,
    mode: timelineMode,
    pointDates: points.map((point) => point.date),
    startDate: performance.rangeStartDate ?? points[0]?.date ?? performance.requestedAsOf ?? new Date().toISOString().slice(0, 10),
  });
  const adminRepairHref = showAdminActions
    ? getValuationHealthAdminRepairHref(valuationHealth)
    : null;
  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{dict.reports.performanceTrendTitle}</CardTitle>
          <CardDescription className="flex flex-wrap items-center gap-1">
            <span>
              {performance.range} · {performance.reportingCurrency} · FX {performance.fxStatus}
              {lastReliableDate ? ` · ${formatReportMessage(dict.reports.performanceMetaAsOf, { date: formatDateLabel(lastReliableDate, locale) })}` : ""}
            </span>
            {lastReliableDate ? (
              <TooltipInfo
                label={dict.reports.performanceTrendLabel}
                content={formatSnapshotAsOfTooltip(dict, lastReliableDate, locale)}
                triggerTestId="reports-performance-as-of-tooltip-trigger"
                contentTestId="reports-performance-as-of-tooltip-content"
              />
            ) : null}
          </CardDescription>
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          <Select
            value={timelineMode}
            onValueChange={(value) => {
              if (value === "auto" || value === "day" || value === "week" || value === "month" || value === "year") {
                onTimelineModeChange(value);
              }
            }}
          >
            <SelectTrigger
              aria-label={dict.reports.performanceTrendLabel}
              className="w-full sm:hidden"
              data-testid="reports-performance-timeline-select"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="auto">{dict.reports.timelineAuto}</SelectItem>
                <SelectItem value="day">{dict.reports.timelineDay}</SelectItem>
                <SelectItem value="week">{dict.reports.timelineWeek}</SelectItem>
                <SelectItem value="month">{dict.reports.timelineMonth}</SelectItem>
                <SelectItem value="year">{dict.reports.timelineYear}</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <ToggleGroup
            className="hidden sm:flex"
            type="single"
            aria-label={dict.reports.performanceTrendLabel}
            value={timelineMode}
            onValueChange={(value) => {
              if (value === "auto" || value === "day" || value === "week" || value === "month" || value === "year") {
                onTimelineModeChange(value);
              }
            }}
            data-testid="reports-performance-timeline"
          >
            <ToggleGroupItem value="auto">{dict.reports.timelineAuto}</ToggleGroupItem>
            <ToggleGroupItem value="day">{dict.reports.timelineDay}</ToggleGroupItem>
            <ToggleGroupItem value="week">{dict.reports.timelineWeek}</ToggleGroupItem>
            <ToggleGroupItem value="month">{dict.reports.timelineMonth}</ToggleGroupItem>
            <ToggleGroupItem value="year">{dict.reports.timelineYear}</ToggleGroupItem>
          </ToggleGroup>
          <SectionRefreshButton dict={dict} isRefreshing={isRefreshing} onRefresh={onRefresh} testId="reports-performance-refresh" />
        </div>
      </CardHeader>
      <CardContent>
        {marketDataStaleSince ? (
          <div
            className="mb-4 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning"
            data-testid="reports-performance-stale-warning"
          >
            {formatReportMessage(dict.reports.performanceStaleDataWarning, { date: formatDateLabel(marketDataStaleSince, locale) })}
          </div>
        ) : null}
        {valuationHealth ? (
          <ValuationHealthPanel
            adminRepairHref={adminRepairHref}
            className="mb-4"
            copy={dict.valuationHealth}
            locale={locale}
            showAdminActions={showAdminActions}
            strictTotalsNotice={hasIncompleteReportValuationFromHealth(valuationHealth) ? dict.valuationHealth.strictTotalsNotice : null}
            tickerRepairReturnTo={tickerRepairReturnTo}
            valuationHealth={valuationHealth}
          />
        ) : null}
        {points.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">{dict.reports.noSnapshotSeries}</div>
        ) : (
          <ChartContainer config={buildPerformanceChartConfig(latestTotalReturnAmount)} className="h-72 w-full aspect-auto" data-testid="reports-performance-chart">
            <LineChart data={chartPoints} margin={{ top: 12, right: 8, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="4 6" vertical={false} />
              <XAxis dataKey="dateMs" type="number" domain={timelineAxis.domain} ticks={timelineAxis.ticks} tickFormatter={timelineAxis.tickFormatter} tickLine={false} axisLine={false} minTickGap={40} />
              <YAxis tickFormatter={(value: number) => formatCompactCurrencyAmount(value, performance.reportingCurrency, locale)} tickLine={false} axisLine={false} width={62} />
              <Tooltip
                formatter={(value: number | string) => typeof value === "number" ? formatCurrencyAmount(value, performance.reportingCurrency, locale) : value}
                labelFormatter={(value: number | string) => typeof value === "number" ? formatDateLabel(new Date(value).toISOString().slice(0, 10), locale) : formatDateLabel(value, locale)}
              />
              <Line dataKey="marketValueAmount" type="monotone" stroke="var(--color-marketValueAmount)" strokeWidth={3} dot={false} connectNulls={false} />
              <Line dataKey="totalCostAmount" type="monotone" stroke="var(--color-totalCostAmount)" strokeWidth={2} dot={false} connectNulls={false} />
              <Line dataKey="totalReturnAmount" type="monotone" stroke="var(--color-totalReturnAmount)" strokeWidth={2} dot={false} connectNulls={false} />
            </LineChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

function AllocationChart({
  buckets,
  dict,
  isRefreshing,
  locale,
  onRefresh,
  title,
}: {
  buckets: AllocationBucketDto[];
  dict: AppDictionary;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  title: string;
}) {
  const visible = buckets.filter((bucket) => bucket.amount !== null).slice(0, 8);
  const currency = visible[0]?.reportingCurrency ?? "TWD";
  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{formatReportMessage(dict.reports.allocationBucketCount, { count: formatNumber(buckets.length, locale) })}</CardDescription>
        </div>
        <SectionRefreshButton dict={dict} isRefreshing={isRefreshing} onRefresh={onRefresh} testId={`reports-${title.toLowerCase().replace(/\s+/g, "-")}-refresh`} />
      </CardHeader>
      <CardContent>
        {visible.length === 0 ? (
          <HoldingsGridEmptyState className="p-6">{dict.reports.noAllocationBuckets}</HoldingsGridEmptyState>
        ) : (
          <ChartContainer config={ALLOCATION_CHART_CONFIG} className="h-64 w-full aspect-auto" data-testid={`reports-${title.toLowerCase().replace(/\s+/g, "-")}-chart`}>
            <BarChart data={visible} layout="vertical" margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid strokeDasharray="4 6" horizontal={false} />
              <XAxis type="number" tickFormatter={(value: number) => formatCompactCurrencyAmount(value, currency, locale)} tickLine={false} axisLine={false} />
              <YAxis dataKey="label" type="category" tickLine={false} axisLine={false} width={72} />
              <Tooltip formatter={(value: number | string) => typeof value === "number" ? formatCurrencyAmount(value, currency, locale) : value} />
              <Bar dataKey="amount" fill="var(--color-amount)" radius={4} />
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  );
}

type TickerAllocationViewRow = {
  key: string;
  ticker: string;
  instrumentName?: string | null;
  marketCode: string;
  accountCount: number;
  reportingCurrency: AccountDefaultCurrency;
  reportingAmount: number | null;
  portfolioAllocationPercent: number | null;
  selectedAllocationPercent: number | null;
  allocationBasisUsed: "cost_basis" | "market_value";
  allocationBasisFallbackReason: "missing_quote" | null;
  quoteStatus: "current" | "provisional" | "missing";
  fxStatus: "complete" | "partial" | "missing";
  isOther: boolean;
};

function TickerAllocationCard({
  dict,
  isRefreshing,
  locale,
  onRefresh,
  reportScope,
  rows,
}: {
  dict: AppDictionary;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  reportScope: PortfolioReportDto["query"]["scope"];
  rows: ReportTickerAllocationRowDto[];
}) {
  const lockedMarketCode = reportScope === "all" ? null : reportScope;
  const availableMarketCodes = useMemo(
    () => [...new Set(rows.map((row) => row.marketCode))].sort((left, right) => left.localeCompare(right)),
    [rows],
  );
  const [selectedMarketCodes, setSelectedMarketCodes] = useState<string[]>(lockedMarketCode ? [lockedMarketCode] : []);
  const [chartMode, setChartMode] = useState<TickerAllocationChartMode>(DEFAULT_TICKER_ALLOCATION_CHART_MODE);
  const [topN, setTopN] = useState<TickerAllocationTopN>(DEFAULT_TICKER_ALLOCATION_TOP_N);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [settingsError, setSettingsError] = useState("");
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const forcedMarketCodeRef = useRef<string | null>(lockedMarketCode);

  useEffect(() => {
    if (lockedMarketCode) {
      forcedMarketCodeRef.current = lockedMarketCode;
      setSelectedMarketCodes([lockedMarketCode]);
      return;
    }
    setSelectedMarketCodes((current) => {
      const wasForcedScopeSelection = forcedMarketCodeRef.current !== null
        && current.length === 1
        && current[0] === forcedMarketCodeRef.current;
      forcedMarketCodeRef.current = null;
      return wasForcedScopeSelection ? [] : filterAvailableHoldingsSelections(current, availableMarketCodes);
    });
  }, [availableMarketCodes, lockedMarketCode]);

  useEffect(() => {
    let cancelled = false;
    void fetchHoldingsPreferences()
      .then((response) => {
        if (cancelled) return;
        const contexts = response.holdingsTableSettings.contexts;
        const context = contexts[TICKER_ALLOCATION_CHART_CONTEXT_KEY];
        setChartMode(context?.tickerAllocationChartMode ?? DEFAULT_TICKER_ALLOCATION_CHART_MODE);
        setTopN(context?.tickerAllocationTopN ?? DEFAULT_TICKER_ALLOCATION_TOP_N);
        setSettingsHydrated(true);
      })
      .catch(() => {
        if (cancelled) return;
        setSettingsError(dict.reports.tickerAllocationSettingsLoadError);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredRows = useMemo(
    () => rows.filter((row) => lockedMarketCode
      ? row.marketCode === lockedMarketCode
      : selectedMarketCodes.length === 0 || selectedMarketCodes.includes(row.marketCode)),
    [lockedMarketCode, rows, selectedMarketCodes],
  );
  const rowsWithSelectedAllocation = useMemo(
    () => buildTickerAllocationRows(filteredRows, topN),
    [filteredRows, topN],
  );

  useEffect(() => {
    if (rowsWithSelectedAllocation.length === 0) {
      setSelectedKey(null);
      return;
    }
    setSelectedKey((current) => rowsWithSelectedAllocation.some((row) => row.key === current) ? current : rowsWithSelectedAllocation[0]!.key);
  }, [rowsWithSelectedAllocation]);

  const selectedRow = rowsWithSelectedAllocation.find((row) => row.key === selectedKey) ?? rowsWithSelectedAllocation[0] ?? null;
  const marketFilterLabel = lockedMarketCode
    ? lockedMarketCode
    : formatFilterSummary(selectedMarketCodes, dict.dashboardHome.topHoldingsAllMarkets, dict.dashboardHome.topHoldingsMarketLabel);
  const fallbackCount = filteredRows.filter((row) => row.allocationBasisFallbackReason !== null).length;
  const basisSummary = fallbackCount > 0
    ? formatReportMessage(dict.reports.tickerAllocationBasisFallbackSummary, {
        basis: filteredRows.some((row) => row.allocationBasisUsed === "market_value")
          ? dict.dashboardHome.allocationBasisMarketValue
          : dict.dashboardHome.allocationBasisCostBasis,
        count: formatNumber(fallbackCount, locale),
      })
    : formatReportMessage(dict.reports.tickerAllocationBasisSummary, {
        basis: filteredRows.some((row) => row.allocationBasisUsed === "market_value")
          ? dict.dashboardHome.allocationBasisMarketValue
          : dict.dashboardHome.allocationBasisCostBasis,
      });

  function persistChartSettings(nextMode: TickerAllocationChartMode, nextTopN: TickerAllocationTopN) {
    if (!settingsHydrated) return;
    setSettingsError("");
    void persistHoldingsTableContexts({
      [TICKER_ALLOCATION_CHART_CONTEXT_KEY]: {
        tickerAllocationChartMode: nextMode,
        tickerAllocationTopN: nextTopN,
      },
    }).catch((error) => {
      setSettingsError(error instanceof Error ? error.message : String(error));
    });
  }

  function handleChartModeChange(value: string) {
    if (value !== "bars" && value !== "pie") return;
    setChartMode(value);
    persistChartSettings(value, topN);
  }

  function handleTopNChange(value: string) {
    if (value !== "auto" && value !== "5" && value !== "10" && value !== "20" && value !== "all") return;
    setTopN(value);
    persistChartSettings(chartMode, value);
  }

  return (
    <Card data-testid="reports-ticker-allocation-card">
      <CardHeader className="flex flex-col items-stretch gap-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <CardTitle>{dict.reports.tickerAllocationTitle}</CardTitle>
            <CardDescription>{formatReportMessage(dict.reports.allocationBucketCount, { count: formatNumber(filteredRows.length, locale) })}</CardDescription>
            <p className="mt-2 text-xs text-muted-foreground">{basisSummary}</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <ReportsMultiSelectMenu
              allLabel={dict.dashboardHome.topHoldingsAllMarkets}
              buttonLabel={marketFilterLabel}
              disabled={lockedMarketCode !== null}
              label={dict.dashboardHome.topHoldingsMarketLabel}
              options={availableMarketCodes.map((market) => ({ id: market, label: market }))}
              selectedIds={selectedMarketCodes}
              setSelectedIds={setSelectedMarketCodes}
              testId="reports-ticker-allocation-market-filter"
            />
            <ToggleGroup
              type="single"
              value={chartMode}
              onValueChange={handleChartModeChange}
              aria-label={dict.reports.tickerAllocationChartTypeLabel}
              data-testid="reports-ticker-allocation-mode"
            >
              <ToggleGroupItem value="bars">{dict.reports.tickerAllocationBars}</ToggleGroupItem>
              <ToggleGroupItem value="pie">{dict.reports.tickerAllocationPie}</ToggleGroupItem>
            </ToggleGroup>
            <ToggleGroup
              type="single"
              value={topN}
              onValueChange={handleTopNChange}
              aria-label={dict.reports.tickerAllocationTopNLabel}
              data-testid="reports-ticker-allocation-topn"
            >
              <ToggleGroupItem value="auto">{dict.reports.tickerAllocationTopNAuto}</ToggleGroupItem>
              <ToggleGroupItem value="5">5</ToggleGroupItem>
              <ToggleGroupItem value="10">10</ToggleGroupItem>
              <ToggleGroupItem value="20">20</ToggleGroupItem>
              <ToggleGroupItem value="all">{dict.reports.tickerAllocationTopNAll}</ToggleGroupItem>
            </ToggleGroup>
            <SectionRefreshButton dict={dict} isRefreshing={isRefreshing} onRefresh={onRefresh} testId="reports-ticker-allocation-refresh" />
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {rowsWithSelectedAllocation.length === 0 ? (
          <HoldingsGridEmptyState className="p-6">{dict.reports.noAllocationBuckets}</HoldingsGridEmptyState>
        ) : (
          <div className="grid gap-4">
            <div className="grid gap-4">
              {chartMode === "bars" ? (
                <div className="grid gap-2" data-testid="reports-ticker-allocation-bars">
                  {rowsWithSelectedAllocation.map((row) => (
                    <Popover key={row.key}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className={cn(
                            "grid gap-3 rounded-xl border border-border px-3 py-3 text-left transition hover:border-primary/40 hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_4.75rem_4.75rem]",
                            selectedRow?.key === row.key && "border-primary/60 bg-primary/5",
                          )}
                          onClick={() => setSelectedKey(row.key)}
                          data-testid={`reports-ticker-allocation-row-${row.key}`}
                        >
                          <TickerAllocationRowContent dict={dict} locale={locale} row={row} />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
                        <TickerAllocationDetailPanel dict={dict} locale={locale} row={row} />
                      </PopoverContent>
                    </Popover>
                  ))}
                </div>
              ) : (
                <div className="grid gap-4 rounded-xl border border-border p-4" data-testid="reports-ticker-allocation-pie">
                  <TickerAllocationPieChart
                    dict={dict}
                    locale={locale}
                    rows={rowsWithSelectedAllocation}
                    selectedKey={selectedRow?.key ?? null}
                    onSelect={setSelectedKey}
                  />
                  <div className="grid gap-2">
                    {rowsWithSelectedAllocation.map((row, index) => (
                      <Popover key={row.key}>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className={cn(
                              "flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-left transition hover:border-primary/40 hover:bg-muted/40",
                              selectedRow?.key === row.key && "border-primary/60 bg-primary/5",
                            )}
                            onClick={() => setSelectedKey(row.key)}
                            data-testid={`reports-ticker-allocation-pie-row-${row.key}`}
                          >
                            <span className="size-3 rounded-full" style={{ backgroundColor: tickerAllocationColor(index) }} />
                            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{row.isOther ? dict.reports.tickerAllocationOtherLabel : `${row.ticker} · ${row.marketCode}`}</span>
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {row.selectedAllocationPercent === null ? "-" : formatPercent(row.selectedAllocationPercent, locale)}
                            </span>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
                          <TickerAllocationDetailPanel dict={dict} locale={locale} row={row} />
                        </PopoverContent>
                      </Popover>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid gap-2 rounded-xl border border-border px-3 py-3 text-xs text-muted-foreground md:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_4.75rem_4.75rem]">
                <span>{dict.reports.ticker}</span>
                <span>{dict.reports.reportingValue}</span>
                <span className="text-right">{dict.reports.tickerAllocationPortfolioAllocation}</span>
                <span className="text-right">{dict.reports.tickerAllocationSelectedAllocation}</span>
              </div>
            </div>
          </div>
        )}
        {settingsError ? <p className="mt-3 text-xs text-destructive">{settingsError}</p> : null}
      </CardContent>
    </Card>
  );
}

function TickerAllocationPieChart({
  dict,
  locale,
  onSelect,
  rows,
  selectedKey,
}: {
  dict: AppDictionary;
  locale: LocaleCode;
  onSelect: (key: string) => void;
  rows: TickerAllocationViewRow[];
  selectedKey: string | null;
}) {
  const [hoveredKey, setHoveredKey] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slices = useMemo(() => buildTickerAllocationPieSlices(rows), [rows]);

  const cancelPendingClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);
  const openSlice = useCallback((key: string) => {
    cancelPendingClose();
    onSelect(key);
    setHoveredKey(key);
  }, [cancelPendingClose, onSelect]);
  const scheduleCloseSlice = useCallback((key: string) => {
    cancelPendingClose();
    closeTimerRef.current = setTimeout(() => {
      setHoveredKey((current) => current === key ? null : current);
      closeTimerRef.current = null;
    }, 120);
  }, [cancelPendingClose]);

  useEffect(() => () => {
    cancelPendingClose();
  }, [cancelPendingClose]);

  return (
    <div className="mx-auto size-56">
      <svg
        aria-label={dict.reports.tickerAllocationTitle}
        className="size-full overflow-visible"
        data-testid="reports-ticker-allocation-pie-chart"
        role="img"
        viewBox="0 0 100 100"
      >
        <circle cx="50" cy="50" r="48" className="fill-muted stroke-border" />
        {slices.map((slice) => {
          const open = hoveredKey === slice.row.key;
          const label = slice.row.isOther
            ? dict.reports.tickerAllocationOtherLabel
            : [slice.row.ticker, slice.row.instrumentName].filter(Boolean).join(" · ");
          return (
            <Popover key={slice.row.key} open={open}>
              <PopoverTrigger asChild>
                <path
                  aria-label={`${label}: ${formatPercent(slice.percent, locale)}`}
                  className={cn(
                    "cursor-pointer stroke-background stroke-[0.8] outline-none transition-opacity hover:opacity-85 focus-visible:opacity-85 focus-visible:ring-2 focus-visible:ring-primary",
                    selectedKey === slice.row.key && "stroke-primary stroke-[1.4]",
                  )}
                  d={slice.path}
                  data-testid={`reports-ticker-allocation-pie-slice-${slice.row.key}`}
                  fill={tickerAllocationColor(slice.index)}
                  role="button"
                  tabIndex={0}
                  onBlur={() => scheduleCloseSlice(slice.row.key)}
                  onClick={() => openSlice(slice.row.key)}
                  onFocus={() => openSlice(slice.row.key)}
                  onMouseEnter={() => openSlice(slice.row.key)}
                  onMouseLeave={() => scheduleCloseSlice(slice.row.key)}
                />
              </PopoverTrigger>
              <PopoverContent
                align="center"
                className="w-[min(22rem,calc(100vw-2rem))] p-0"
                onBlur={() => scheduleCloseSlice(slice.row.key)}
                onFocus={() => openSlice(slice.row.key)}
                onMouseEnter={() => openSlice(slice.row.key)}
                onMouseLeave={() => scheduleCloseSlice(slice.row.key)}
              >
                <TickerAllocationDetailPanel dict={dict} locale={locale} row={slice.row} />
              </PopoverContent>
            </Popover>
          );
        })}
        {slices.flatMap((slice) => slice.labelLines.map((line, lineIndex) => (
          <text
            key={`${slice.row.key}-${lineIndex}`}
            className="pointer-events-none fill-background text-[4px] font-semibold [paint-order:stroke] [stroke:hsl(var(--foreground))] [stroke-width:0.6px]"
            data-testid={lineIndex === 0 ? `reports-ticker-allocation-pie-label-${slice.row.key}` : undefined}
            dominantBaseline="middle"
            textAnchor="middle"
            x={slice.labelX}
            y={slice.labelY + ((lineIndex - ((slice.labelLines.length - 1) / 2)) * 5)}
          >
            {line}
          </text>
        )))}
      </svg>
    </div>
  );
}

function TickerAllocationDetailPanel({
  dict,
  locale,
  row,
}: {
  dict: AppDictionary;
  locale: LocaleCode;
  row: TickerAllocationViewRow;
}) {
  const detailRows = [
    [dict.reports.reportingValue, row.reportingAmount === null ? "-" : formatCurrencyAmount(row.reportingAmount, row.reportingCurrency, locale)],
    [dict.reports.tickerAllocationPortfolioAllocation, row.portfolioAllocationPercent === null ? "-" : formatPercent(row.portfolioAllocationPercent, locale)],
    [dict.reports.tickerAllocationSelectedAllocation, row.selectedAllocationPercent === null ? "-" : formatPercent(row.selectedAllocationPercent, locale)],
    [dict.reports.accounts, formatNumber(row.accountCount, locale)],
    [dict.reports.quoteStatus, reportQuoteStatusLabel(dict, row.quoteStatus)],
    [dict.reports.tickerAllocationFxStatus, reportFxStatusLabel(dict, row.fxStatus)],
    [dict.dashboardHome.allocationBasisLabel, row.allocationBasisUsed === "market_value" ? dict.dashboardHome.allocationBasisMarketValue : dict.dashboardHome.allocationBasisCostBasis],
    [dict.dashboardHome.allocationFallbackLabel, row.allocationBasisFallbackReason === "missing_quote" ? dict.holdings.allocationFallbackMissingQuote : dict.reports.tickerAllocationFallbackNotNeeded],
  ] as const;

  return (
    <div className="grid gap-3 rounded-2xl border border-border bg-muted/20 p-4" data-testid="reports-ticker-allocation-detail">
      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{dict.reports.tickerAllocationDetailTitle}</p>
        <h3 className="mt-2 text-lg font-semibold text-foreground">{row.isOther ? dict.reports.tickerAllocationOtherLabel : row.ticker}</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          {row.isOther ? dict.reports.tickerAllocationOtherDescription : [row.marketCode, row.instrumentName].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="grid gap-2">
        {detailRows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
            <span className="text-sm text-muted-foreground">{label}</span>
            <span className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">{value}</span>
          </div>
        ))}
      </div>
      {!row.isOther ? (
        <div className="flex justify-end">
          <Link
            href={tickerHref(row.ticker, row.marketCode)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary transition hover:bg-muted hover:text-primary"
          >
            <ExternalLink data-icon="inline-start" aria-hidden="true" />
            {dict.reports.openTicker}
          </Link>
        </div>
      ) : null}
    </div>
  );
}

function TickerAllocationRowContent({
  dict,
  locale,
  row,
}: {
  dict: AppDictionary;
  locale: LocaleCode;
  row: TickerAllocationViewRow;
}) {
  return (
    <>
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold text-foreground">{row.isOther ? dict.reports.tickerAllocationOtherLabel : row.ticker}</p>
        <p className="truncate text-xs text-muted-foreground">
          {row.isOther
            ? dict.reports.tickerAllocationOtherDescription
            : [row.marketCode, row.instrumentName].filter(Boolean).join(" · ")}
        </p>
      </div>
      <div className="flex min-w-0 items-center gap-3">
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${Math.max(4, row.selectedAllocationPercent ?? 0)}%` }}
          />
        </div>
        <p className="min-w-[7.5rem] text-right font-mono text-xs tabular-nums text-muted-foreground">
          {row.reportingAmount === null ? "-" : formatCurrencyAmount(row.reportingAmount, row.reportingCurrency, locale)}
        </p>
      </div>
      <p className="text-right font-mono text-xs tabular-nums text-foreground">
        {row.portfolioAllocationPercent === null ? "-" : formatPercent(row.portfolioAllocationPercent, locale)}
      </p>
      <p className="text-right font-mono text-xs tabular-nums text-foreground">
        {row.selectedAllocationPercent === null ? "-" : formatPercent(row.selectedAllocationPercent, locale)}
      </p>
    </>
  );
}

function HoldingsCard({
  columns,
  contextKey,
  defaultSort = { sortDirection: "desc", sortField: "marketValue", sortMode: "field" },
  dict,
  locale,
  isRefreshing,
  onRefresh,
  rows,
  selectionUniverseRows,
  showAdminActivityLinks = false,
  showTopHoldingsLimit = false,
  stickyFirstColumn = true,
  title,
}: {
  columns: Array<HoldingsGridColumnDefinition<ReportHoldingsColumn>>;
  contextKey: string;
  defaultSort?: HoldingsDefaultSort;
  dict: AppDictionary;
  isRefreshing: boolean;
  locale: LocaleCode;
  onRefresh: () => void;
  rows: ReportHoldingRowsPageDto;
  selectionUniverseRows: ReportHoldingRowDto[];
  showAdminActivityLinks?: boolean;
  showTopHoldingsLimit?: boolean;
  stickyFirstColumn?: boolean;
  title: string;
}) {
  const columnSettings = useHoldingsColumnSettings<ReportHoldingsColumn>({
    columns,
    contextKey,
    defaultMobileSummaryCount: 6,
    defaultSort,
    defaultLayoutStyle: "portfolio",
    mobileSummaryColumnIds: REPORT_MOBILE_FIELD_COLUMNS,
    supportedSortFields: REPORT_HOLDINGS_SORT_FIELDS,
  });
  const reportingCurrency = rows.rows[0]?.reportingCurrency ?? null;
  const [query, setQuery] = useState("");
  const [selectedPreset, setSelectedPreset] = useState<ReportHoldingFocusPreset | null>("largest");
  const clearRankOnlyPreset = useCallback(() => {
    setSelectedPreset((current) => current !== null && isRankOnlyReportHoldingPreset(current) ? null : current);
  }, []);
  const explicitSortSettings = useMemo<HoldingsColumnSettingsState<ReportHoldingsColumn>>(() => ({
    ...columnSettings,
    resetSort: columnSettings.resetSort
      ? () => {
        clearRankOnlyPreset();
        columnSettings.resetSort?.();
      }
      : undefined,
    setCustomSort: columnSettings.setCustomSort
      ? () => {
        clearRankOnlyPreset();
        columnSettings.setCustomSort?.();
      }
      : undefined,
    setSort: columnSettings.setSort
      ? (field, direction) => {
        clearRankOnlyPreset();
        columnSettings.setSort?.(field, direction);
      }
      : undefined,
  }), [clearRankOnlyPreset, columnSettings]);
  useEffect(() => {
    setSelectedPreset((current) => {
      if (current === null || !isRankOnlyReportHoldingPreset(current)) return current;
      const preset = REPORT_HOLDING_FOCUS_PRESETS.find((candidate) => candidate.id === current);
      return preset
        && columnSettings.sortMode === "field"
        && columnSettings.sortField === preset.field
        && columnSettings.sortDirection === preset.direction
        ? current
        : null;
    });
  }, [columnSettings.sortDirection, columnSettings.sortField, columnSettings.sortMode]);
  const visibleColumns = columnSettings.orderedColumns.filter((column) => columnSettings.visibleColumns.includes(column.id));
  const mobileColumnSplit = splitMobileHoldingColumns(columnSettings, REPORT_MOBILE_FIELD_COLUMNS);
  const holdingsSelectionUniverse = useMemo(
    () => selectionUniverseRows.map((row) => ({
      marketCode: row.marketCode,
      ticker: row.ticker,
      label: row.instrumentName?.trim() || row.ticker,
      searchText: `${row.marketCode} ${row.ticker} ${row.instrumentName ?? ""}`.toLowerCase(),
    })),
    [selectionUniverseRows],
  );
  const holdingsSelection = useHoldingsSelection(holdingsSelectionUniverse);
  const marketOptions = useMemo(
    () => [...new Set(selectionUniverseRows.map((row) => row.marketCode))].sort((left, right) => left.localeCompare(right)),
    [selectionUniverseRows],
  );
  const accountOptions = useMemo(() => {
    const accounts = new Map<string, string>();
    for (const row of selectionUniverseRows) {
      for (const account of row.accounts ?? []) {
        accounts.set(account.id, account.name);
      }
    }
    return [...accounts.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
  }, [selectionUniverseRows]);
  const accountOptionIds = useMemo(() => accountOptions.map((account) => account.id), [accountOptions]);
  const selectedMarketCodes = useMemo(
    () => filterAvailableHoldingsSelections(columnSettings.selectedMarketCodes, marketOptions),
    [columnSettings.selectedMarketCodes, marketOptions],
  );
  const selectedAccountIds = useMemo(
    () => filterAvailableHoldingsSelections(columnSettings.selectedAccountIds, accountOptionIds),
    [accountOptionIds, columnSettings.selectedAccountIds],
  );
  const marketFilterLabel = formatFilterSummary(
    selectedMarketCodes,
    dict.dashboardHome.topHoldingsAllMarkets,
    dict.dashboardHome.topHoldingsMarketLabel,
  );
  const accountFilterLabel = formatFilterSummary(
    selectedAccountIds.map((accountId) => accountOptions.find((account) => account.id === accountId)?.name ?? accountId),
    dict.dashboardHome.topHoldingsAllAccounts,
    dict.dashboardHome.topHoldingsAccountLabel,
  );
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    const baseRows = rows.rows.filter((row) => {
      const tickerId = buildHoldingsTickerId(row.marketCode, row.ticker);
      if (
        holdingsSelection.selectionMode !== "all"
        && !holdingsSelection.selectedTickerIdSet.has(tickerId)
      ) {
        return false;
      }
      const marketMatches = selectedMarketCodes.length === 0 || selectedMarketCodes.includes(row.marketCode);
      const accountMatches = selectedAccountIds.length === 0 || (row.accounts ?? []).some((account) => selectedAccountIds.includes(account.id));
      const queryMatches = normalizedQuery === ""
        || row.ticker.toUpperCase().includes(normalizedQuery)
        || row.instrumentName?.toUpperCase().includes(normalizedQuery) === true
        || row.marketCode.toUpperCase().includes(normalizedQuery)
        || (row.accounts ?? []).some((account) =>
          account.name.toUpperCase().includes(normalizedQuery) || account.id.toUpperCase().includes(normalizedQuery));
      return marketMatches && accountMatches && queryMatches;
    });
    const presetFilteredRows = applyReportHoldingPreset(baseRows, selectedPreset);
    if (columnSettings.sortMode === "field" && columnSettings.sortField && columnSettings.sortDirection) {
      return sortHoldingsRows({
        direction: columnSettings.sortDirection,
        extractKey: reportHoldingSortKey,
        field: columnSettings.sortField,
        getIdentity: (row) => ({ marketCode: row.marketCode, ticker: row.ticker }),
        rows: presetFilteredRows,
      });
    }
    return applyHoldingsRowOrder(presetFilteredRows, reportHoldingRowId, columnSettings.rowOrder);
  }, [
    columnSettings.rowOrder,
    columnSettings.sortDirection,
    columnSettings.sortField,
    columnSettings.sortMode,
    holdingsSelection.selectedTickerIdSet,
    holdingsSelection.selectionMode,
    query,
    rows.rows,
    selectedAccountIds,
    selectedMarketCodes,
    selectedPreset,
  ]);
  const visibleRows = useMemo(
    () => showTopHoldingsLimit ? filteredRows.slice(0, columnSettings.topHoldingsLimit) : filteredRows,
    [columnSettings.topHoldingsLimit, filteredRows, showTopHoldingsLimit],
  );
  const filteredRowsPage: ReportHoldingRowsPageDto = {
    ...rows,
    limit: visibleRows.length,
    offset: 0,
    rows: visibleRows,
    total: visibleRows.length,
  };
  const selectionSummaryRows = useMemo<HoldingsSelectionSummaryRow[]>(
    () => visibleRows.map((row) => ({
      marketCode: row.marketCode,
      ticker: row.ticker,
      reportingCostBasisAmount: row.reportingCostBasisAmount,
      reportingMarketValueAmount: row.reportingMarketValueAmount,
      reportingUnrealizedPnlAmount: row.reportingUnrealizedPnlAmount,
    })),
    [visibleRows],
  );
  const selectionSummary = useMemo(
    () => buildHoldingsSelectionVisibleSummary({
      mode: holdingsSelection.selectionMode,
      rows: selectionSummaryRows,
      selectedTickerIds: holdingsSelection.selectedTickerIds,
      universeTickerIds: holdingsSelection.universeTickerIds,
    }),
    [
      holdingsSelection.selectedTickerIds,
      holdingsSelection.selectionMode,
      holdingsSelection.universeTickerIds,
      selectionSummaryRows,
    ],
  );

  function handlePresetChange(value: string) {
    if (!isReportHoldingFocusPreset(value)) return;
    setSelectedPreset(value);
    const preset = REPORT_HOLDING_FOCUS_PRESETS.find((candidate) => candidate.id === value);
    if (preset) columnSettings.setSort?.(preset.field, preset.direction);
  }

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 flex-col gap-2">
          <CardTitle>{title}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <CardDescription>{formatReportMessage(dict.reports.totalRows, { count: formatNumber(visibleRows.length, locale) })}</CardDescription>
            {reportingCurrency ? <Badge variant="outline">{formatReportMessage(dict.reports.reportingCurrencyBadge, { currency: reportingCurrency })}</Badge> : null}
            <CardDescription className="basis-full">
              {dict.holdings.dataHealthDescription}
            </CardDescription>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <HoldingsColumnSettingsMenu
            dict={dict}
            getColumnLabel={(column) => reportHoldingColumnLabel(dict, column.id)}
            settings={columnSettings}
          />
          <HoldingsRowSettingsMenu
            dict={dict}
            rows={filteredRows.map((row) => ({
              id: reportHoldingRowId(row),
              label: row.ticker,
              description: row.instrumentName ? `${row.marketCode} · ${row.instrumentName}` : row.marketCode,
            }))}
            settings={columnSettings}
            showTopHoldingsLimit={showTopHoldingsLimit}
            testIdPrefix="reports-holdings"
          />
          <SectionRefreshButton dict={dict} isRefreshing={isRefreshing} onRefresh={onRefresh} testId={`reports-${title.toLowerCase().replace(/\s+/g, "-")}-refresh`} />
        </div>
      </CardHeader>
      <CardContent className="pb-24 sm:pb-6">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <HoldingsSelectionToolbar
              dict={dict}
              mode={holdingsSelection.selectionMode}
              universeItems={holdingsSelection.universeItems}
              selectedTickerIds={holdingsSelection.selectedTickerIds}
              availableSelectedTickerIds={holdingsSelection.availableSelectedTickerIds}
              unavailableTickerIds={holdingsSelection.unavailableTickerIds}
              onReset={holdingsSelection.setAll}
              onSelectAll={holdingsSelection.setAll}
              onDeselectAll={holdingsSelection.setNone}
              onToggleTicker={holdingsSelection.toggleTicker}
              onRemoveTicker={holdingsSelection.removeTicker}
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_auto_auto]">
            <label className="relative block min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <span className="sr-only">{dict.dashboardHome.topHoldingsSearchLabel}</span>
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={dict.dashboardHome.topHoldingsSearchPlaceholder}
                className="pl-9"
                data-testid={`reports-holdings-search-${contextKey}`}
              />
            </label>
            <ReportsMultiSelectMenu
              allLabel={dict.dashboardHome.topHoldingsAllMarkets}
              buttonLabel={marketFilterLabel}
              label={dict.dashboardHome.topHoldingsMarketLabel}
              options={marketOptions.map((market) => ({ id: market, label: market }))}
              selectedIds={selectedMarketCodes}
              setSelectedIds={columnSettings.setSelectedMarketCodes}
              testId={`reports-holdings-market-filter-${contextKey}`}
            />
            <ReportsMultiSelectMenu
              allLabel={dict.dashboardHome.topHoldingsAllAccounts}
              buttonLabel={accountFilterLabel}
              label={dict.dashboardHome.topHoldingsAccountLabel}
              options={accountOptions.map((account) => ({ id: account.id, label: account.name }))}
              selectedIds={selectedAccountIds}
              setSelectedIds={columnSettings.setSelectedAccountIds}
              testId={`reports-holdings-account-filter-${contextKey}`}
            />
          </div>
          {holdingsSelection.selectionError ? (
            <p className="text-sm text-destructive" data-testid={`reports-holdings-selection-error-${contextKey}`}>
              {holdingsSelection.selectionError}
            </p>
          ) : null}
          <HoldingsSelectionSummaryStrip
            className="border-0 py-0"
            dict={dict}
            framed={false}
            locale={locale}
            reportingCurrency={reportingCurrency ?? "TWD"}
            summary={selectionSummary}
          />
        </div>
        <div className="mb-4 sm:hidden">
          <HoldingsMobileSortControls
            columns={columns}
            dict={dict}
            settings={explicitSortSettings}
            testIdPrefix={`reports-holdings-${contextKey}`}
          />
        </div>
        <div className="mb-4 sm:hidden">
          <Select value={selectedPreset ?? ""} onValueChange={handlePresetChange}>
            <SelectTrigger
              aria-label={dict.dashboardHome.topHoldingsFocusPresetsAria}
              className="w-full"
              data-testid={`reports-holdings-presets-select-${contextKey}`}
            >
              <SelectValue placeholder={dict.holdings.customSortLabel} />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {REPORT_HOLDING_FOCUS_PRESETS.map((preset) => (
                  <SelectItem key={preset.id} value={preset.id}>
                    {reportHoldingPresetLabel(dict, preset.id)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="mb-4 hidden min-w-0 overflow-x-auto pb-1 sm:flex">
          <ToggleGroup
            className="w-max"
            type="single"
            value={selectedPreset ?? ""}
            onValueChange={handlePresetChange}
            aria-label={dict.dashboardHome.topHoldingsFocusPresetsAria}
            data-testid={`reports-holdings-presets-${contextKey}`}
          >
            {REPORT_HOLDING_FOCUS_PRESETS.map((preset) => (
              <ToggleGroupItem key={preset.id} value={preset.id}>
                {reportHoldingPresetLabel(dict, preset.id)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="mb-4 hidden sm:flex">
          <HoldingsHiddenSortChip
            columns={columns}
            dict={dict}
            settings={explicitSortSettings}
            testIdPrefix={`reports-holdings-${contextKey}`}
            visibleSortFields={visibleColumns.flatMap((column) => column.sortField ? [column.sortField] : [])}
          />
        </div>
        <HoldingsMobileList
          detailColumns={mobileColumnSplit.detailColumns}
          dict={dict}
          holdingsSelection={holdingsSelection}
          rows={filteredRowsPage.rows}
          locale={locale}
          showAdminActivityLinks={showAdminActivityLinks}
          summaryColumns={mobileColumnSplit.summaryColumns}
        />
        {filteredRowsPage.rows.length === 0 ? (
          <HoldingsGridEmptyState className="p-6">
            {holdingsSelection.selectionMode === "none" ? dict.holdings.noneResults : dict.holdings.noResults}
          </HoldingsGridEmptyState>
        ) : null}
        <HoldingsGridDesktopFrame className="max-h-[32rem]">
          <HoldingsGridNativeTable testId={`reports-holdings-table-${contextKey}`}>
            <thead>
              <tr>
                {visibleColumns.map((column) => (
                  <th
                    key={column.id}
                    {...holdingsSortableHeaderCellProps(columnSettings, column.id)}
                    className={cn(
                      "sticky top-0 z-20 whitespace-normal break-words bg-card align-top font-medium",
                      holdingsStickyFirstColumnClassName(stickyFirstColumn && column.id === "ticker", "header"),
                      column.align === "right" && "text-right",
                    )}
                    style={holdingsColumnCellStyle(columnSettings, column.id)}
                  >
                    <HoldingsColumnHeaderContent
                      align={column.align}
                      column={column.id}
                      dict={dict}
                      label={reportHoldingColumnLabel(dict, column.id)}
                      settings={explicitSortSettings}
                    />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredRowsPage.rows.map((row) => (
                <tr key={`${row.ticker}-${row.marketCode}`} className="hover:bg-muted/10">
                  {visibleColumns.map((column) => (
                    <ReportHoldingTableCell
                      key={column.id}
                      column={column.id}
                      columnSettings={columnSettings}
                      dict={dict}
                      holdingsSelection={holdingsSelection}
                      locale={locale}
                      row={row}
                      showAdminActivityLinks={showAdminActivityLinks}
                      stickyFirstColumn={stickyFirstColumn}
                    />
                  ))}
                </tr>
              ))}
            </tbody>
          </HoldingsGridNativeTable>
        </HoldingsGridDesktopFrame>
      </CardContent>
    </Card>
  );
}

function SectionRefreshButton({
  dict,
  isRefreshing,
  onRefresh,
  testId,
}: {
  dict: AppDictionary;
  isRefreshing: boolean;
  onRefresh: () => void;
  testId: string;
}) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onRefresh}
      disabled={isRefreshing}
      data-testid={testId}
    >
      <RefreshCw data-icon="inline-start" />
      {dict.reports.refresh}
    </Button>
  );
}

function ReportsMultiSelectMenu({
  allLabel,
  buttonLabel,
  disabled = false,
  label,
  options,
  selectedIds,
  setSelectedIds,
  testId,
}: {
  allLabel: string;
  buttonLabel: string;
  disabled?: boolean;
  label: string;
  options: Array<{ id: string; label: string }>;
  selectedIds: string[];
  setSelectedIds: (ids: string[]) => void;
  testId: string;
}) {
  function toggle(id: string) {
    setSelectedIds(selectedIds.includes(id) ? selectedIds.filter((selectedId) => selectedId !== id) : [...selectedIds, id]);
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="w-full justify-between" aria-label={label} data-testid={testId} disabled={disabled}>
          <span className="sr-only">{label}</span>
          <span className="truncate">{buttonLabel}</span>
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={selectedIds.length === 0} onCheckedChange={() => setSelectedIds([])} />
            {allLabel}
          </label>
        </div>
        {options.map((option) => (
          <DropdownMenuCheckboxItem
            key={option.id}
            checked={selectedIds.includes(option.id)}
            onSelect={(event) => event.preventDefault()}
            onCheckedChange={() => toggle(option.id)}
          >
            {option.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatFilterSummary(selectedLabels: string[], allLabel: string, label: string) {
  if (selectedLabels.length === 0) return allLabel;
  if (selectedLabels.length === 1) return selectedLabels[0]!;
  return `${selectedLabels.length} ${label}`;
}

function ReportHoldingTableCell({
  column,
  columnSettings,
  dict,
  holdingsSelection,
  locale,
  row,
  showAdminActivityLinks,
  stickyFirstColumn,
}: {
  column: ReportHoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<ReportHoldingsColumn>;
  dict: AppDictionary;
  holdingsSelection: ReturnType<typeof useHoldingsSelection>;
  locale: LocaleCode;
  row: ReportHoldingRowDto;
  showAdminActivityLinks: boolean;
  stickyFirstColumn: boolean;
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  const className = reportHoldingCellClassName(column, stickyFirstColumn);
  if (column === "ticker") {
    const tickerId = buildHoldingsTickerId(row.marketCode, row.ticker);
    return (
      <td className={className} style={style}>
        <div className="flex min-w-0 items-start gap-2">
          <HoldingsSelectionInlineToggle
            dict={dict}
            tickerId={tickerId}
            checked={holdingsSelection.isTickerSelected(tickerId)}
            onToggle={() => holdingsSelection.toggleTicker(tickerId)}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-col gap-1">
            <TickerLink marketCode={row.marketCode} ticker={row.ticker} />
            {row.instrumentName ? <span className="text-xs text-muted-foreground">{row.instrumentName}</span> : null}
            <span className="text-xs text-muted-foreground">{row.marketCode}</span>
          </div>
        </div>
      </td>
    );
  }
  if (column === "accounts") {
    return (
      <td className={cn(className, "text-right font-mono tabular-nums")} style={style}>
        {formatNumber(row.accountCount, locale)}
      </td>
    );
  }
  if (column === "quantity") {
    return (
      <td className={cn(className, "text-right font-mono tabular-nums")} style={style}>
        {formatNumber(row.quantity, locale, 4)}
      </td>
    );
  }
  if (column === "price") {
    return (
      <td className={className} style={style}>
        <PriceDisclosure dict={dict} row={row} locale={locale} align="end" showAdminActivityLinks={showAdminActivityLinks} />
      </td>
    );
  }
  if (column === "averageCost") {
    return (
      <ReportMoneyTableCell
        className={className}
        currency={row.reportingCurrency}
        locale={locale}
        secondary={row.nativeCurrency === row.reportingCurrency ? undefined : formatOptionalUnitPrice(row.nativeAverageCostPerShare, row.nativeCurrency, locale)}
        style={style}
        value={row.reportingAverageCostPerShare}
      />
    );
  }
  if (column === "unitPnl") {
    const unitPnl = getReportUnitPnl(row);
    const nativeUnitPnl = getNativeUnitPnl(row.nativeCurrentUnitPrice, row.nativeAverageCostPerShare);
    return (
      <ReportMoneyTableCell
        className={className}
        currency={row.reportingCurrency}
        locale={locale}
        percent={unitPnl.percent}
        secondary={row.nativeCurrency === row.reportingCurrency ? undefined : formatOptionalFinanceMoney(nativeUnitPnl.amount, row.nativeCurrency, locale)}
        style={style}
        tone
        value={unitPnl.amount}
      />
    );
  }
  if (column === "marketValue") {
    return (
      <ReportMoneyTableCell className={className} currency={row.reportingCurrency} locale={locale} style={style} value={row.reportingMarketValueAmount} compact />
    );
  }
  if (column === "costBasis") {
    return (
      <ReportMoneyTableCell className={className} currency={row.reportingCurrency} locale={locale} style={style} value={row.reportingCostBasisAmount} compact />
    );
  }
  if (column === "unrealizedPnl") {
    return (
      <ReportMoneyTableCell className={className} currency={row.reportingCurrency} locale={locale} style={style} value={row.reportingUnrealizedPnlAmount} tone compact />
    );
  }
  if (column === "dailyChange") {
    return (
      <ReportMoneyTableCell className={className} currency={row.reportingCurrency} locale={locale} percent={row.dailyChangePercent} style={style} value={row.dailyChangeAmount} tone compact />
    );
  }
  if (column === "allocation") {
    return (
      <td className={cn(className, "font-mono tabular-nums")} style={style}>
        {row.reportingAllocationPercent === null ? "-" : formatPercent(row.reportingAllocationPercent, locale)}
      </td>
    );
  }
  if (column === "dataHealth") return (
    <td
      className={className}
      style={style}
    >
      <HoldingsDataHealthBadges dict={dict} locale={locale} row={row} showCurrentFreshness />
    </td>
  );
  return (
    <td className={cn(className, "text-right")} style={style}>
      <div className="flex flex-wrap justify-end gap-2">
        <Link
          href={reportHoldingAnalysisHref(row)}
          className="text-xs font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
          aria-label={dict.reports.openUnrealizedPnlAnalysis}
          data-testid={`reports-holding-analysis-link-${row.ticker}-${row.marketCode}`}
        >
          {dict.navigation.analysisLabel}
        </Link>
        <Link
          href={tickerHref(row.ticker, row.marketCode)}
          className="text-xs font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
          aria-label={formatReportMessage(dict.reports.openTickerAria, { ticker: row.ticker })}
        >
          {dict.reports.openTicker}
        </Link>
      </div>
    </td>
  );
}

function ReportMoneyTableCell({
  className,
  compact = false,
  currency,
  locale,
  percent,
  secondary,
  style,
  tone = false,
  value,
}: {
  className?: string;
  compact?: boolean;
  currency: CurrencyCode;
  locale: LocaleCode;
  percent?: number | null;
  secondary?: string;
  style?: CSSProperties;
  tone?: boolean;
  value: number | null;
}) {
  return (
    <td className={cn(className, "font-mono tabular-nums", tone ? holdingsFinanceToneClass(value, "text-foreground") : null)} style={style}>
      <div className="flex flex-col items-end gap-1">
        <span>
          {value === null
            ? "-"
            : tone
              ? formatFinanceCurrencyAmount(value, currency, locale, compact)
              : formatCurrencyAmount(value, currency, locale)}
        </span>
        {compact && value !== null ? (
          <span className={cn("text-xs", tone ? holdingsFinanceToneClass(value, "text-muted-foreground") : "text-muted-foreground")}>
            {tone ? formatFinanceCurrencyAmount(value, currency, locale) : formatCurrencyAmount(value, currency, locale)}
          </span>
        ) : null}
        {percent !== undefined ? (
          <span className={cn("text-xs", holdingsFinanceToneClass(percent, "text-muted-foreground"))}>
            {percent === null ? "-" : formatSignedPercent(percent, locale)}
          </span>
        ) : null}
        {secondary ? <span className="text-xs text-muted-foreground">{secondary}</span> : null}
      </div>
    </td>
  );
}

function reportHoldingCellClassName(column: ReportHoldingsColumn, stickyFirstColumn: boolean) {
  return cn(
    "whitespace-normal break-words align-top",
    column === "ticker" && "font-medium",
    holdingsStickyFirstColumnClassName(stickyFirstColumn && column === "ticker"),
    ["accounts", "quantity", "averageCost", "price", "unitPnl", "marketValue", "costBasis", "dailyChange", "unrealizedPnl", "allocation", "actions"].includes(column) && "text-right",
  );
}

function applyReportHoldingPreset(
  rows: ReportHoldingRowDto[],
  preset: ReportHoldingFocusPreset | null,
): ReportHoldingRowDto[] {
  if (preset === "stale-quotes") {
    return rows.filter((row) => isNonCurrentPrice(row));
  }
  if (preset === "fx-exposure") {
    return rows.filter((row) => row.nativeCurrency !== row.reportingCurrency);
  }
  return rows;
}

export function reportHoldingSortKey(row: ReportHoldingRowDto, field: HoldingsSortField): number | string | null {
  switch (field) {
    case "ticker":
      return row.ticker;
    case "accountCount":
      return row.accountCount;
    case "quantity":
      return row.quantity;
    case "averageCost":
      return row.reportingAverageCostPerShare;
    case "price":
      return row.reportingCurrentUnitPrice;
    case "unitPnl":
      return getReportUnitPnl(row).amount;
    case "marketValue":
      return row.reportingMarketValueAmount;
    case "costBasis":
      return row.reportingCostBasisAmount;
    case "dailyChangePercent":
      return row.dailyChangePercent;
    case "unrealizedPnl":
      return row.reportingUnrealizedPnlAmount;
    case "allocation":
      return row.reportingAllocationPercent;
    case "dataHealth":
      return reportHoldingDataHealthRank(row);
    case "nextDividendDate":
    case "lastDividendDate":
      return null;
  }
}

function reportHoldingDataHealthRank(row: ReportHoldingRowDto): number {
  const quoteRank = row.quoteStatus === "missing" ? 2 : row.quoteStatus === "provisional" ? 1 : 0;
  const fxRank = row.fxStatus === "missing" ? 50 : row.fxStatus === "partial" ? 25 : 0;
  const allocationFallbackRank = inferReportHoldingAllocationFallback(row) ? 10 : 0;
  return (quoteRank * 10_000) + (priceStateSortRank(row) * 100) + fxRank + allocationFallbackRank;
}

function inferReportHoldingAllocationFallback(row: ReportHoldingRowDto): boolean {
  return !Number.isFinite(row.reportingMarketValueAmount)
    && Number.isFinite(row.reportingCostBasisAmount);
}

function isReportHoldingFocusPreset(value: string): value is ReportHoldingFocusPreset {
  return REPORT_HOLDING_FOCUS_PRESETS.some((preset) => preset.id === value);
}

function isRankOnlyReportHoldingPreset(preset: ReportHoldingFocusPreset): boolean {
  return preset === "largest"
    || preset === "highest-allocation"
    || preset === "worst-pnl"
    || preset === "best-pnl";
}

function reportHoldingPresetLabel(dict: AppDictionary, preset: ReportHoldingFocusPreset): string {
  switch (preset) {
    case "largest":
      return dict.dashboardHome.topHoldingsPresetLargest;
    case "highest-allocation":
      return dict.dashboardHome.topHoldingsPresetHighestAllocation;
    case "worst-pnl":
      return dict.dashboardHome.topHoldingsPresetWorstPnl;
    case "best-pnl":
      return dict.dashboardHome.topHoldingsPresetBestPnl;
    case "stale-quotes":
      return dict.dashboardHome.topHoldingsPresetStaleQuotes;
    case "fx-exposure":
      return dict.dashboardHome.topHoldingsPresetFxExposure;
  }
}

function buildTickerAllocationRows(
  rows: ReportTickerAllocationRowDto[],
  topN: TickerAllocationTopN,
): TickerAllocationViewRow[] {
  const ranked = rows
    .slice()
    .sort((left, right) =>
      (right.portfolioAllocationPercent ?? right.reportingAmount ?? Number.NEGATIVE_INFINITY)
      - (left.portfolioAllocationPercent ?? left.reportingAmount ?? Number.NEGATIVE_INFINITY));
  const denominator = ranked.reduce((sum, row) => sum + (row.reportingAmount ?? 0), 0);
  const projected = ranked.map((row) => ({
    ...row,
    key: `${row.marketCode}:${row.ticker}`,
    selectedAllocationPercent: denominator > 0 && row.reportingAmount !== null ? (row.reportingAmount / denominator) * 100 : null,
    isOther: false,
  } satisfies TickerAllocationViewRow));
  const limit = resolveTickerAllocationTopNLimit(projected.length, topN);
  if (limit === null || projected.length <= limit) return projected;
  return [
    ...projected.slice(0, limit),
    buildOtherTickerAllocationRow(projected.slice(limit)),
  ];
}

function buildOtherTickerAllocationRow(rows: TickerAllocationViewRow[]): TickerAllocationViewRow {
  return {
    key: "other",
    ticker: "OTHER",
    instrumentName: null,
    marketCode: rows.length === 1 ? rows[0]!.marketCode : "MULTI",
    accountCount: rows.reduce((sum, row) => sum + row.accountCount, 0),
    reportingCurrency: rows[0]?.reportingCurrency ?? "TWD",
    reportingAmount: sumNullableAllocationMetric(rows, (row) => row.reportingAmount),
    portfolioAllocationPercent: sumNullableAllocationMetric(rows, (row) => row.portfolioAllocationPercent),
    selectedAllocationPercent: sumNullableAllocationMetric(rows, (row) => row.selectedAllocationPercent),
    allocationBasisUsed: rows.every((row) => row.allocationBasisUsed === "cost_basis") ? "cost_basis" : "market_value",
    allocationBasisFallbackReason: rows.some((row) => row.allocationBasisFallbackReason === "missing_quote") ? "missing_quote" : null,
    quoteStatus: rows.some((row) => row.quoteStatus === "missing")
      ? "missing"
      : rows.some((row) => row.quoteStatus === "provisional")
        ? "provisional"
        : "current",
    fxStatus: rows.some((row) => row.fxStatus === "missing")
      ? "missing"
      : rows.some((row) => row.fxStatus === "partial")
        ? "partial"
        : "complete",
    isOther: true,
  };
}

function sumNullableAllocationMetric(
  rows: TickerAllocationViewRow[],
  select: (row: TickerAllocationViewRow) => number | null,
): number | null {
  let hasNumericValue = false;
  const total = rows.reduce((sum, row) => {
    const value = select(row);
    if (value === null) return sum;
    hasNumericValue = true;
    return sum + value;
  }, 0);
  return hasNumericValue ? total : null;
}

function resolveTickerAllocationTopNLimit(total: number, topN: TickerAllocationTopN): number | null {
  if (topN === "all") return null;
  if (topN === "5") return 5;
  if (topN === "10") return 10;
  if (topN === "20") return 20;
  if (total <= 5) return null;
  if (total <= 15) return 10;
  return 20;
}

type TickerAllocationPieSlice = {
  index: number;
  labelLines: string[];
  labelX: number;
  labelY: number;
  path: string;
  percent: number;
  row: TickerAllocationViewRow;
};

function buildTickerAllocationPieSlices(rows: TickerAllocationViewRow[]): TickerAllocationPieSlice[] {
  const positiveRows = rows
    .map((row, index) => ({ row, index, percent: Math.max(row.selectedAllocationPercent ?? 0, 0) }))
    .filter((slice) => slice.percent > 0);
  const totalPercent = positiveRows.reduce((sum, slice) => sum + slice.percent, 0);
  if (totalPercent <= 0) return [];

  let startAngle = 0;
  return positiveRows.map((slice) => {
    const sweep = (slice.percent / totalPercent) * 360;
    const endAngle = startAngle + sweep;
    const labelAngle = startAngle + (sweep / 2);
    const labelPoint = polarToCartesian(50, 50, 29, labelAngle);
    const result: TickerAllocationPieSlice = {
      index: slice.index,
      labelLines: tickerAllocationPieLabelLines(slice.row, slice.percent),
      labelX: labelPoint.x,
      labelY: labelPoint.y,
      path: describePieSlicePath(50, 50, 48, startAngle, endAngle),
      percent: slice.percent,
      row: slice.row,
    };
    startAngle = endAngle;
    return result;
  });
}

function tickerAllocationPieLabelLines(row: TickerAllocationViewRow, percent: number): string[] {
  if (percent < 8) return [];
  const percentLabel = `${formatNumber(percent, "en", percent >= 10 ? 0 : 1)}%`;
  if (row.isOther) return [percent >= 18 ? "Other" : "", percentLabel].filter(Boolean);
  if (percent >= 28 && row.instrumentName) {
    return [row.ticker, truncatePieLabel(row.instrumentName), percentLabel];
  }
  return [row.ticker, percentLabel];
}

function truncatePieLabel(value: string): string {
  return value.length > 16 ? `${value.slice(0, 15)}...` : value;
}

function describePieSlicePath(centerX: number, centerY: number, radius: number, startAngle: number, endAngle: number): string {
  const adjustedEndAngle = endAngle - startAngle >= 360 ? startAngle + 359.99 : endAngle;
  const start = polarToCartesian(centerX, centerY, radius, startAngle);
  const end = polarToCartesian(centerX, centerY, radius, adjustedEndAngle);
  const largeArcFlag = adjustedEndAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${centerX} ${centerY}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`,
    "Z",
  ].join(" ");
}

function polarToCartesian(centerX: number, centerY: number, radius: number, angleInDegrees: number): { x: number; y: number } {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: centerX + (radius * Math.cos(angleInRadians)),
    y: centerY + (radius * Math.sin(angleInRadians)),
  };
}

function tickerAllocationColor(index: number): string {
  return [
    "hsl(var(--chart-1))",
    "hsl(var(--chart-2))",
    "hsl(var(--chart-3))",
    "hsl(var(--chart-4))",
    "hsl(var(--chart-5))",
    "hsl(var(--chart-primary))",
  ][index % 6]!;
}

function reportQuoteStatusLabel(
  dict: AppDictionary,
  value: "current" | "provisional" | "missing",
): string {
  switch (value) {
    case "current":
      return dict.reports.quoteStatusCurrent;
    case "provisional":
      return dict.reports.quoteStatusProvisional;
    case "missing":
      return dict.reports.quoteStatusMissing;
  }
}

function reportFxStatusLabel(
  dict: AppDictionary,
  value: "complete" | "partial" | "missing",
): string {
  switch (value) {
    case "complete":
      return dict.holdings.fxStatusComplete;
    case "partial":
      return dict.holdings.fxStatusPartial;
    case "missing":
      return dict.holdings.fxStatusMissing;
  }
}

function formatExactAmountInline(dict: AppDictionary, amount: string): string {
  return dict.dashboardHome.exactAmountInline.replace("{amount}", amount);
}

function ReportMobileColumnMetric({
  column,
  dict,
  locale,
  row,
  showAdminActivityLinks,
}: {
  column: ReportHoldingsColumn;
  dict: AppDictionary;
  locale: LocaleCode;
  row: ReportHoldingRowDto;
  showAdminActivityLinks: boolean;
}) {
  switch (column) {
    case "accounts":
      return (
        <CompactFinanceStat
          currency={row.reportingCurrency}
          label={dict.reports.accounts}
          locale={locale}
          value={null}
          valueOverride={formatNumber(row.accountCount, locale)}
        />
      );
    case "quantity":
      return (
        <CompactFinanceStat
          currency={row.reportingCurrency}
          label={dict.reports.quantity}
          locale={locale}
          value={null}
          valueOverride={formatNumber(row.quantity, locale, 4)}
        />
      );
    case "averageCost":
      return (
        <CompactFinanceStat
          label={dict.reports.averageCost}
          locale={locale}
          secondary={row.nativeCurrency === row.reportingCurrency ? undefined : formatOptionalUnitPrice(row.nativeAverageCostPerShare, row.nativeCurrency, locale)}
          value={row.reportingAverageCostPerShare}
          currency={row.reportingCurrency}
        />
      );
    case "price":
      return (
        <CompactFinanceStat
          label={dict.reports.price}
          locale={locale}
          value={row.reportingCurrentUnitPrice}
          currency={row.reportingCurrency}
          valueOverride={<PriceDisclosure dict={dict} row={row} locale={locale} showAdminActivityLinks={showAdminActivityLinks} />}
        />
      );
    case "unitPnl":
      return (
        <CompactFinanceStat
          label={dict.holdings.unitPnlTerm}
          locale={locale}
          percent={getReportUnitPnl(row).percent}
          secondary={row.nativeCurrency === row.reportingCurrency
            ? undefined
            : formatOptionalFinanceMoney(getNativeUnitPnl(row.nativeCurrentUnitPrice, row.nativeAverageCostPerShare).amount, row.nativeCurrency, locale)}
          value={getReportUnitPnl(row).amount}
          currency={row.reportingCurrency}
          tone
        />
      );
    case "marketValue":
      return <CompactFinanceStat label={dict.reports.marketValue} locale={locale} value={row.reportingMarketValueAmount} currency={row.reportingCurrency} />;
    case "costBasis":
      return <CompactFinanceStat label={dict.reports.costBasis} locale={locale} value={row.reportingCostBasisAmount} currency={row.reportingCurrency} />;
    case "unrealizedPnl":
      return <CompactFinanceStat label={dict.reports.unrealizedPnl} locale={locale} value={row.reportingUnrealizedPnlAmount} currency={row.reportingCurrency} tone />;
    case "dailyChange":
      return <CompactFinanceStat label={dict.reports.dailyChange} locale={locale} percent={row.dailyChangePercent} value={row.dailyChangeAmount} currency={row.reportingCurrency} tone />;
    case "allocation":
      return (
        <CompactFinanceStat
          label={dict.reports.allocation}
          locale={locale}
          value={null}
          currency={row.reportingCurrency}
          valueOverride={row.reportingAllocationPercent === null ? "-" : formatPercent(row.reportingAllocationPercent, locale)}
        />
      );
    case "dataHealth":
      return (
        <CompactFinanceStat
          label={dict.holdings.dataHealthTerm}
          locale={locale}
          value={null}
          currency={row.reportingCurrency}
          valueOverride={<span className="flex flex-wrap gap-1.5"><HoldingsDataHealthBadges dict={dict} locale={locale} row={row} showCurrentFreshness /></span>}
        />
      );
    case "ticker":
    case "actions":
      return null;
  }
}

function HoldingsMobileList({
  detailColumns,
  dict,
  holdingsSelection,
  locale,
  rows,
  showAdminActivityLinks,
  summaryColumns,
}: {
  detailColumns: ReportHoldingsColumn[];
  dict: AppDictionary;
  holdingsSelection: ReturnType<typeof useHoldingsSelection>;
  locale: LocaleCode;
  rows: ReportHoldingRowDto[];
  showAdminActivityLinks: boolean;
  summaryColumns: ReportHoldingsColumn[];
}) {
  const [selected, setSelected] = useState<ReportHoldingRowDto | null>(null);
  const visibleColumns = [...summaryColumns, ...detailColumns];
  return (
    <div className="flex flex-col gap-3 lg:hidden">
      {rows.map((row) => (
        <div
          key={`${row.ticker}-${row.marketCode}`}
          className="rounded-lg border border-border bg-background p-4 text-left shadow-sm"
          data-testid={`reports-mobile-row-${row.ticker}-${row.marketCode}`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-start gap-3">
              <HoldingsSelectionInlineToggle
                dict={dict}
                tickerId={buildHoldingsTickerId(row.marketCode, row.ticker)}
                checked={holdingsSelection.isTickerSelected(buildHoldingsTickerId(row.marketCode, row.ticker))}
                onToggle={() => holdingsSelection.toggleTicker(buildHoldingsTickerId(row.marketCode, row.ticker))}
                className="mt-1"
              />
              <div className="min-w-0">
                <TickerLink marketCode={row.marketCode} ticker={row.ticker} className="font-medium" />
                {row.instrumentName ? <p className="mt-1 text-xs text-muted-foreground">{row.instrumentName}</p> : null}
                <p className="mt-1 text-xs text-muted-foreground">
                  {row.marketCode}
                </p>
              </div>
            </div>
          </div>
          <div
            className="mt-3 grid grid-cols-2 gap-2 pb-14 pr-12 sm:pb-0 sm:pr-0"
            data-testid={`reports-mobile-metrics-${row.ticker}-${row.marketCode}`}
          >
            {summaryColumns.map((column) => (
              <ReportMobileColumnMetric key={column} column={column} dict={dict} locale={locale} row={row} showAdminActivityLinks={showAdminActivityLinks} />
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
            <Link
              href={reportHoldingAnalysisHref(row)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary transition hover:bg-muted hover:text-primary"
              aria-label={dict.reports.openUnrealizedPnlAnalysis}
              data-testid={`reports-mobile-analysis-link-${row.ticker}-${row.marketCode}`}
            >
              {dict.navigation.analysisLabel}
            </Link>
            <Link
              href={tickerHref(row.ticker, row.marketCode)}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-sm font-medium text-primary transition hover:bg-muted hover:text-primary"
              aria-label={formatReportMessage(dict.reports.openTickerAria, { ticker: row.ticker })}
            >
              <ExternalLink data-icon="inline-start" aria-hidden="true" />
              {dict.reports.openTicker}
            </Link>
            <Button size="sm" variant="ghost" onClick={() => setSelected(row)}>
              {dict.reports.viewDetails}
            </Button>
          </div>
        </div>
      ))}
      <HoldingsDetailSheet
        description={dict.reports.holdingDetailDescription}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        selected={selected}
        title={(row) => <TickerLink marketCode={row.marketCode} ticker={row.ticker} className="text-base" />}
        renderDetail={(row) => (
          <HoldingDetail
            detailColumns={detailColumns}
            dict={dict}
            locale={locale}
            row={row}
            visibleColumns={visibleColumns}
          />
        )}
      />
    </div>
  );
}

function HoldingDetail({
  detailColumns,
  dict,
  locale,
  row,
  visibleColumns,
}: {
  detailColumns: ReportHoldingsColumn[];
  dict: AppDictionary;
  locale: LocaleCode;
  row: ReportHoldingRowDto;
  visibleColumns: ReportHoldingsColumn[];
}) {
  const visibleColumnSet = new Set(visibleColumns);
  const showSupplementalColumn = (column: ReportHoldingsColumn) => visibleColumnSet.has(column);
  const supplementalRows = [
    ...(row.nativeCurrency !== row.reportingCurrency && showSupplementalColumn("price") ? [
      [dict.reports.nativePrice, formatOptionalNativePrice(row, locale), null],
      [dict.reports.fxRate, formatOptionalFxRate(row), null],
    ] as const : []),
    ...(row.nativeCurrency !== row.reportingCurrency && showSupplementalColumn("marketValue") ? [
      [dict.reports.nativeMarketValue, formatOptionalMoney(row.nativeMarketValueAmount, row.nativeCurrency, locale), null],
    ] as const : []),
    ...(row.nativeCurrency !== row.reportingCurrency && showSupplementalColumn("costBasis") ? [
      [dict.reports.nativeCostBasis, formatOptionalMoney(row.nativeCostBasisAmount, row.nativeCurrency, locale), null],
    ] as const : []),
    ...(showSupplementalColumn("dailyChange") ? [
      [dict.reports.dailyChangePercent, row.dailyChangePercent === null ? "-" : formatSignedPercent(row.dailyChangePercent, locale), row.dailyChangePercent],
    ] as const : []),
  ] as const;
  return (
    <div className="mt-5 flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        {row.instrumentName ? (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
            <span className="text-sm text-muted-foreground">{dict.reports.ticker}</span>
            <span className="text-right text-sm font-semibold text-foreground">{row.instrumentName}</span>
          </div>
        ) : null}
        <Badge variant="outline" className="w-fit">{row.marketCode}</Badge>
      </div>
      {detailColumns.map((column) => (
        <ReportHoldingDetailColumn key={column} column={column} dict={dict} locale={locale} row={row} />
      ))}
      {supplementalRows.map(([label, value, tone]) => (
        <div key={label} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
          <span className="text-sm text-muted-foreground">{label}</span>
          <span className={cn("text-right font-mono text-sm font-semibold tabular-nums", holdingsFinanceToneClass(tone, "text-foreground"))}>{value}</span>
        </div>
      ))}
    </div>
  );
}

function PriceDisclosure({
  align = "start",
  dict,
  locale,
  row,
  showAdminActivityLinks = false,
}: {
  align?: "center" | "end" | "start";
  dict: AppDictionary;
  locale: LocaleCode;
  row: ReportHoldingRowDto;
  showAdminActivityLinks?: boolean;
}) {
  const hasNativeDisclosure = row.nativeCurrency !== row.reportingCurrency;
  const priceState = getPriceState(row);
  return (
    <div className="inline-flex max-w-full flex-col items-start data-[align=end]:items-end data-[align=end]:text-right" data-align={align}>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex max-w-full flex-col items-start rounded-md text-left font-mono tabular-nums text-foreground hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 data-[align=end]:items-end data-[align=end]:text-right"
            data-align={align}
            aria-label={`${dict.reports.priceTranslationTitle}: ${row.ticker}`}
          >
            <span className="font-semibold">
              {formatOptionalUnitPrice(row.reportingCurrentUnitPrice, row.reportingCurrency, locale)}
            </span>
            {hasNativeDisclosure ? (
              <span className="text-xs text-muted-foreground">
                {dict.reports.nativePrice} {formatOptionalNativePrice(row, locale)}
              </span>
            ) : null}
          </button>
        </PopoverTrigger>
        <PopoverContent align={align} className="w-80 p-3">
          <div className="flex flex-col gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">{dict.reports.priceTranslationTitle}</p>
              <p className="text-xs text-muted-foreground">{formatReportMessage(dict.reports.reportingCurrencySentence, { currency: row.reportingCurrency })}</p>
            </div>
            <DetailRow label={formatReportMessage(dict.reports.reportingPriceWithCurrency, { currency: row.reportingCurrency })} value={formatOptionalUnitPrice(row.reportingCurrentUnitPrice, row.reportingCurrency, locale)} />
            {hasNativeDisclosure ? (
              <>
                <DetailRow label={formatReportMessage(dict.reports.nativePriceWithCurrency, { currency: row.nativeCurrency })} value={formatOptionalNativePrice(row, locale)} />
                <DetailRow label={dict.reports.fxRate} value={formatOptionalFxRate(row)} />
              </>
            ) : null}
            <DetailRow label={dict.reports.quoteStatus} value={getQuoteStatusLabel(dict, row.quoteStatus)} />
          </div>
        </PopoverContent>
      </Popover>
      {priceState ? <PriceStateChip activityPath={showAdminActivityLinks ? buildPriceStateActivityPath({ marketCode: row.marketCode, priceState, ticker: row.ticker }) : null} className="w-full justify-start text-left md:justify-end md:text-right" dict={dict} locale={locale} priceState={priceState} testId={`reports-price-state-${row.ticker}-${row.marketCode}`} /> : null}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function ReportHoldingDetailColumn({
  column,
  dict,
  locale,
  row,
}: {
  column: ReportHoldingsColumn;
  dict: AppDictionary;
  locale: LocaleCode;
  row: ReportHoldingRowDto;
}) {
  switch (column) {
    case "accounts":
      return <DetailRow label={dict.reports.accounts} value={formatNumber(row.accountCount, locale)} />;
    case "quantity":
      return <DetailRow label={dict.reports.quantity} value={formatNumber(row.quantity, locale, 4)} />;
    case "averageCost":
      return <DetailRow label={dict.reports.averageCost} value={formatDualReportUnitValue(formatOptionalUnitPrice(row.reportingAverageCostPerShare, row.reportingCurrency, locale), row.nativeCurrency === row.reportingCurrency ? null : formatOptionalUnitPrice(row.nativeAverageCostPerShare, row.nativeCurrency, locale))} />;
    case "price":
      return <DetailRow label={dict.reports.reportingPrice} value={formatOptionalUnitPrice(row.reportingCurrentUnitPrice, row.reportingCurrency, locale)} />;
    case "unitPnl":
      return <DetailRow label={dict.holdings.unitPnlTerm} value={formatOptionalFinanceMoney(getReportUnitPnl(row).amount, row.reportingCurrency, locale)} />;
    case "marketValue":
      return <DetailRow label={dict.reports.marketValue} value={formatOptionalMoney(row.reportingMarketValueAmount, row.reportingCurrency, locale)} />;
    case "costBasis":
      return <DetailRow label={dict.reports.costBasis} value={formatOptionalMoney(row.reportingCostBasisAmount, row.reportingCurrency, locale)} />;
    case "unrealizedPnl":
      return <DetailRow label={dict.reports.unrealizedPnl} value={formatOptionalFinanceMoney(row.reportingUnrealizedPnlAmount, row.reportingCurrency, locale)} />;
    case "dailyChange":
      return <DetailRow label={dict.reports.dailyChange} value={formatOptionalFinanceMoney(row.dailyChangeAmount, row.reportingCurrency, locale)} />;
    case "allocation":
      return <DetailRow label={dict.reports.allocation} value={row.reportingAllocationPercent === null ? "-" : formatPercent(row.reportingAllocationPercent, locale)} />;
    case "dataHealth":
      return <DetailRow label={dict.holdings.dataHealthTerm} value={getQuoteStatusLabel(dict, row.quoteStatus)} />;
    case "ticker":
    case "actions":
      return null;
  }
}

function TickerLink({
  className,
  marketCode,
  ticker,
}: {
  className?: string;
  marketCode: string;
  ticker: string;
}) {
  return (
    <Link
      href={tickerHref(ticker, marketCode)}
      className={cn("text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary", className)}
    >
      {ticker}
    </Link>
  );
}

function tickerHref(ticker: string, marketCode: string): string {
  return `/tickers/${encodeURIComponent(ticker)}?marketCode=${encodeURIComponent(marketCode)}`;
}

function reportHoldingAnalysisHref(row: ReportHoldingRowDto): string {
  return buildUnrealizedPnlRoutePath({
    range: "3M",
    markets: [row.marketCode],
    selection: "manualTickers",
    tickerMode: "custom",
    tickerIds: [buildSelectedSeriesId(row.marketCode, row.ticker)],
    reportingCurrency: row.reportingCurrency,
    view: "ticker-detail",
  });
}

function CompactFinanceStat({
  currency,
  label,
  locale,
  percent,
  secondary,
  tone = false,
  value,
  valueOverride,
}: {
  currency: CurrencyCode;
  label: string;
  locale: LocaleCode;
  percent?: number | null;
  secondary?: string;
  tone?: boolean;
  value: number | null;
  valueOverride?: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-md border border-border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={cn("mt-1 min-w-0 break-words font-mono text-sm font-semibold tabular-nums", tone ? holdingsFinanceToneClass(value, "text-foreground") : "text-foreground")}>
        {valueOverride ?? (value === null ? "-" : tone ? formatFinanceCurrencyAmount(value, currency, locale) : formatCurrencyAmount(value, currency, locale))}
      </div>
      {valueOverride === undefined && value !== null ? (
        <p className={cn("mt-1 font-mono text-xs tabular-nums", tone ? holdingsFinanceToneClass(value, "text-muted-foreground") : "text-muted-foreground")}>
          {tone ? formatFinanceCurrencyAmount(value, currency, locale) : formatCurrencyAmount(value, currency, locale)}
        </p>
      ) : null}
      {percent !== undefined ? (
        <p className={cn("mt-1 font-mono text-xs tabular-nums", holdingsFinanceToneClass(percent, "text-muted-foreground"))}>
          {percent === null ? "-" : formatSignedPercent(percent, locale)}
        </p>
      ) : null}
      {secondary ? <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">{secondary}</p> : null}
    </div>
  );
}

function formatFinanceCurrencyAmount(
  value: number,
  currency: CurrencyCode,
  locale: LocaleCode,
  _compact = false,
): string {
  const formatted = formatCurrencyAmount(Math.abs(value), currency, locale);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatOptionalMoney(value: number | null, currency: CurrencyCode, locale: LocaleCode): string {
  return value === null ? "-" : formatCurrencyAmount(value, currency, locale);
}

function formatOptionalFinanceMoney(value: number | null, currency: CurrencyCode, locale: LocaleCode): string {
  return value === null ? "-" : formatFinanceCurrencyAmount(value, currency, locale);
}

function formatSignedPercent(value: number, locale: LocaleCode): string {
  const formatted = formatPercent(Math.abs(value), locale);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}

function formatOptionalUnitPrice(value: number | null, currency: CurrencyCode, locale: LocaleCode): string {
  if (value === null) return "-";
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(value);
}

function formatOptionalNativePrice(row: ReportHoldingRowDto, locale: LocaleCode): string {
  return formatOptionalUnitPrice(row.nativeCurrentUnitPrice, row.nativeCurrency, locale);
}

function formatDualReportUnitValue(primary: string, secondary: string | null): string {
  return secondary ? `${primary} (${secondary})` : primary;
}

function formatOptionalFxRate(row: ReportHoldingRowDto): string {
  if (row.nativeCurrency === row.reportingCurrency) return "1";
  if (row.fxRateToReporting === null) return "-";
  return formatFxRate(row.fxRateToReporting);
}

function splitMobileHoldingColumns<ColumnId extends string>(
  settings: HoldingsColumnSettingsState<ColumnId>,
  supportedColumns: ColumnId[],
) {
  const supported = new Set(supportedColumns);
  const visibleColumns = settings.orderedColumns
    .map((column) => column.id)
    .filter((column) => supported.has(column) && settings.visibleColumns.includes(column));
  return {
    summaryColumns: visibleColumns.slice(0, settings.mobileSummaryCount),
    detailColumns: visibleColumns.slice(settings.mobileSummaryCount),
  };
}

function getQuoteStatusLabel(dict: AppDictionary, status: ReportHoldingRowDto["quoteStatus"]): string {
  if (status === "missing") return dict.reports.quoteStatusMissing;
  if (status === "provisional") return dict.reports.quoteStatusProvisional;
  return dict.reports.quoteStatusCurrent;
}

function findLastReliablePointDate(points: DashboardPerformanceDto["points"]): string | null {
  return [...points].reverse().find((point) =>
    point.fxAvailable && point.marketValueAmount !== null && point.totalCostAmount !== null,
  )?.date ?? null;
}

function formatSnapshotAsOfTooltip(dict: AppDictionary, date: string, locale: LocaleCode): string {
  return dict.dashboardHome.performanceSnapshotAsOfTooltip.replace(
    "{date}",
    formatDateLabel(date, locale),
  );
}

function getOptionalFxRates(
  fxStatus: ReportFxStatusDto,
  topLevelRates?: FxConversionRateDto[],
): Array<{ asOf: string | null; from: string; rate: number | null; to: string }> {
  const rates = topLevelRates ?? (fxStatus as ReportFxStatusDto & { rates?: OptionalFxRateDto[] }).rates;
  if (!Array.isArray(rates)) return [];

  return rates.flatMap((rate) => {
    const optionalRate = rate as OptionalFxRateDto;
    const from = optionalRate.fromCurrency ?? optionalRate.from ?? optionalRate.baseCurrency;
    const to = optionalRate.toCurrency ?? optionalRate.to ?? optionalRate.quoteCurrency;
    if (!from || !to) return [];
    return [{
      asOf: optionalRate.asOf ?? optionalRate.date ?? null,
      from,
      rate: optionalRate.rate ?? null,
      to,
    }];
  });
}

function formatFxRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}

function ReportSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true" data-testid="reports-loading-skeleton">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-28" />)}
      </div>
      <Skeleton className="h-80" />
      <Skeleton className="h-96" />
    </div>
  );
}
