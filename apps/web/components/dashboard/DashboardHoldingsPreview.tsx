"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import type {
  AccountDefaultCurrency,
  CurrencyCode,
  DashboardHoldingFocusPreferenceDto,
  DashboardHoldingFocusPreset,
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  FxConversionRateDto,
  HoldingsSortField,
  LocaleCode,
} from "@vakwen/shared-types";
import {
  DASHBOARD_HOLDING_FOCUS_PRESETS,
  DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE,
  dashboardHoldingFocusPreferenceSchema,
} from "@vakwen/shared-types";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, RefreshCw, RotateCcw, Search, Settings2 } from "lucide-react";
import { getJson, patchJson } from "../../lib/api";
import { getDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { Button } from "../ui/Button";
import { RollingNumber } from "../ui/RollingNumber";
import { Alert, AlertDescription, AlertTitle } from "../ui/shadcn/alert";
import { Badge } from "../ui/shadcn/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../ui/shadcn/card";
import { Checkbox } from "../ui/shadcn/checkbox";
import { Input } from "../ui/shadcn/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/shadcn/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../ui/shadcn/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "../ui/shadcn/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "../ui/shadcn/tooltip";
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
  type HoldingsGridColumnDefinition,
  type HoldingsColumnSettingsState,
} from "../holdings/HoldingsColumnSettings";
import {
  resolveHoldingsTableContextPreference,
  resolveHoldingsTableSettingsPreference,
} from "../holdings/holdingsPreferenceHelpers";
import { sortHoldingsRows, type HoldingsSortPrimitive } from "../holdings/holdingsSorting";
import {
  HoldingsGridDesktopFrame,
  HoldingsGridEmptyState,
  HoldingsGridMobileList,
} from "../holdings/HoldingsGrid";
import {
  HoldingsSelectionInlineToggle,
  HoldingsSelectionSummaryStrip,
  HoldingsSelectionToolbar,
} from "../holdings/HoldingsSelectionControls";
import {
  HoldingsDataHealthBadges,
  getHoldingsQuoteStatusLabel,
} from "../holdings/HoldingsDataHealth";
import { HoldingsDetailSheet } from "../holdings/HoldingsDetailSheet";
import { HoldingActivityDetail } from "../holdings/HoldingActivityDetail";
import { resolveCurrentHoldingDetail } from "../../features/portfolio/holdingDetailRow";
import { CalendarUnknownWarnings } from "../holdings/CalendarUnknownWarnings";
import { PriceStateChip } from "../holdings/PriceStateChip";
import {
  getDashboardReportingAverageCost,
  getDashboardUnitPnl,
  getNativeUnitPnl,
} from "../../lib/holdingsMetrics";
import {
  holdingsFinanceToneClass,
  holdingsStickyFirstColumnClassName,
} from "../holdings/holdingsStyle";
import { buildHoldingsSelectionVisibleSummary, type HoldingsSelectionSummaryRow } from "../holdings/holdingsSelectionSummary";
import {
  DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY,
  buildHoldingsTickerId,
} from "../holdings/holdingsPreferenceHelpers";
import { useHoldingsSelection } from "../holdings/useHoldingsSelection";
import { buildMissingPriceState, buildPriceStateActivityPath, getPriceState, isNonCurrentPrice, priceStateSortRank, type PriceStateDtoLike } from "../../features/price-state/priceState";

type DashboardHoldingsColumn = "ticker" | "quantity" | "accounts" | "allocation" | "averageCost" | "price" | "unitPnl" | "marketValue" | "costBasis" | "dailyChange" | "unrealizedPnl" | "dataHealth" | "actions";
type DashboardHoldingDetailRow = DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto;

const DASHBOARD_HOLDINGS_COLUMNS: Array<HoldingsGridColumnDefinition<DashboardHoldingsColumn>> = [
  { id: "ticker", label: "Ticker", defaultWidth: 176, canHide: false, sortField: "ticker" },
  { id: "quantity", label: "Quantity", defaultWidth: 136, align: "right", sortField: "quantity" },
  { id: "accounts", label: "Accounts", defaultWidth: 112, align: "right", sortField: "accountCount" },
  { id: "allocation", label: "Allocation", defaultWidth: 140, align: "right", sortField: "allocation" },
  { id: "averageCost", label: "Average cost", defaultWidth: 156, align: "right", sortField: "averageCost" },
  { id: "price", label: "Price", defaultWidth: 156, align: "right", sortField: "price" },
  { id: "unitPnl", label: "Unit P&L", defaultWidth: 156, align: "right", sortField: "unitPnl" },
  { id: "marketValue", label: "Market value", defaultWidth: 176, align: "right", sortField: "marketValue" },
  { id: "costBasis", label: "Cost basis", defaultWidth: 168, align: "right", sortField: "costBasis" },
  { id: "dailyChange", label: "Daily change", defaultWidth: 156, align: "right", sortField: "dailyChangePercent" },
  { id: "unrealizedPnl", label: "Unrealized P&L", defaultWidth: 156, align: "right", sortField: "unrealizedPnl" },
  { id: "dataHealth", label: "Data health", defaultWidth: 184, sortField: "dataHealth" },
  { id: "actions", label: "Actions", defaultWidth: 112, align: "right" },
];
const DASHBOARD_MOBILE_FIELD_COLUMNS: DashboardHoldingsColumn[] = ["quantity", "accounts", "allocation", "averageCost", "price", "unitPnl", "marketValue", "costBasis", "dailyChange", "unrealizedPnl", "dataHealth"];
const DASHBOARD_SUPPORTED_SORT_FIELDS = DASHBOARD_HOLDINGS_COLUMNS.flatMap((column) => column.sortField ? [column.sortField] : []);
const MAX_ANIMATED_DASHBOARD_HOLDING_ROWS = 6;

const HOLDING_FOCUS_PRESETS: Array<{ id: DashboardHoldingFocusPreset; sortField: HoldingsSortField; sortDirection: "asc" | "desc" }> = [
  { id: "largest", sortField: "marketValue", sortDirection: "desc" },
  { id: "highest-allocation", sortField: "allocation", sortDirection: "desc" },
  { id: "worst-pnl", sortField: "unrealizedPnl", sortDirection: "asc" },
  { id: "best-pnl", sortField: "unrealizedPnl", sortDirection: "desc" },
  { id: "fx-exposure", sortField: "marketValue", sortDirection: "desc" },
  { id: "stale-quotes", sortField: "dataHealth", sortDirection: "desc" },
];

const HOLDING_FOCUS_PRESET_BY_ID = new Map(HOLDING_FOCUS_PRESETS.map((preset) => [preset.id, preset]));

interface UserPreferencesResponse {
  preferences?: {
    dashboardHoldingFocus?: unknown;
    holdingsTableSettings?: unknown;
  };
}

interface DashboardHoldingsPreviewProps {
  fxRates?: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  quoteRefreshVersion?: number;
  settingsContextKey?: string;
  showAdminActivityLinks?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  dataHealthHref?: string;
}

export function DashboardHoldingsPreview({
  fxRates = [],
  groups,
  locale,
  reportingCurrency,
  quoteRefreshVersion = 0,
  settingsContextKey = DASHBOARD_TOP_HOLDINGS_CONTEXT_KEY,
  showAdminActivityLinks = false,
  isRefreshing = false,
  onRefresh,
  dataHealthHref = "/reports?tab=portfolio&scope=all&health=1",
}: DashboardHoldingsPreviewProps) {
  const dict = getDictionary(locale);
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [hiddenPresetIds, setHiddenPresetIds] = useState<Set<DashboardHoldingFocusPreset>>(
    () => new Set(DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE.hiddenPresets),
  );
  const [presetError, setPresetError] = useState("");
  const [presetOrder, setPresetOrder] = useState<DashboardHoldingFocusPreset[]>(
    () => [...DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE.presetOrder],
  );
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<DashboardOverviewHoldingGroupDto | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<DashboardHoldingDetailRow | null>(null);
  const [selectedPreset, setSelectedPreset] = useState<DashboardHoldingFocusPreset>(
    DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE.selectedPreset,
  );
  const [defaultSort, setDefaultSort] = useState<{
    sortMode: "field";
    sortField: HoldingsSortField;
    sortDirection: "asc" | "desc";
  }>(() => ({
    sortMode: "field" as const,
    sortField: "marketValue" as const,
    sortDirection: "desc" as const,
  }));
  const dashboardHoldingColumns = useMemo(
    () => {
      const localizedDict = getDictionary(locale);
      return DASHBOARD_HOLDINGS_COLUMNS.map((column) => ({
        ...column,
        label: dashboardColumnLabel(localizedDict, column.id, reportingCurrency),
      }));
    },
    [locale, reportingCurrency],
  );
  const columnSettings = useHoldingsColumnSettings<DashboardHoldingsColumn>({
    columns: dashboardHoldingColumns,
    contextKey: settingsContextKey,
    defaultLayoutStyle: "dashboard",
    defaultSort,
    mobileSummaryColumnIds: DASHBOARD_MOBILE_FIELD_COLUMNS,
    supportedSortFields: DASHBOARD_SUPPORTED_SORT_FIELDS,
  });
  const visibleSortFields = useMemo(
    () => columnSettings.orderedColumns.flatMap((column) =>
      columnSettings.visibleColumns.includes(column.id) && column.sortField ? [column.sortField] : []),
    [columnSettings.orderedColumns, columnSettings.visibleColumns],
  );
  const marketOptions = useMemo(
    () => [...new Set(groups.map((group) => group.marketCode))],
    [groups],
  );
  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
      .then((response) => {
        if (cancelled) return;
        const preference = normalizeDashboardHoldingFocusPreference(response?.preferences?.dashboardHoldingFocus);
        setPresetOrder([...preference.presetOrder]);
        setHiddenPresetIds(new Set(preference.hiddenPresets));
        setSelectedPreset(preference.selectedPreset);
        const tableSettings = resolveHoldingsTableSettingsPreference(
          response?.preferences?.holdingsTableSettings,
        );
        const persistedContext = resolveHoldingsTableContextPreference(tableSettings.contexts, settingsContextKey);
        if (persistedContext?.sortMode === undefined) {
          const preset = HOLDING_FOCUS_PRESET_BY_ID.get(preference.selectedPreset);
          if (preset) {
            setDefaultSort({
              sortMode: "field",
              sortField: preset.sortField,
              sortDirection: preset.sortDirection,
            });
          }
        }
      })
      .catch(() => {
        // Keep the built-in preset defaults when preferences cannot be loaded.
      });
    return () => {
      cancelled = true;
    };
  }, [settingsContextKey]);
  const accountOptions = useMemo(() => {
    const accounts = new Map<string, string>();
    for (const group of groups) {
      for (const child of group.children) {
        accounts.set(child.accountId, child.accountName ?? child.accountId);
      }
    }
    return [...accounts.entries()]
      .map(([id, name]) => ({ id, name }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [groups]);
  const valuationAttentionGroups = useMemo(
    () => groups.filter(hasIncompleteDashboardValuation),
    [groups],
  );
  const valuationAttentionLabel = useMemo(
    () => formatAffectedDashboardTickers(dict, locale, valuationAttentionGroups),
    [dict, locale, valuationAttentionGroups],
  );
  const accountOptionIds = useMemo(() => accountOptions.map((account) => account.id), [accountOptions]);
  const selectedMarketCodes = useMemo(
    () => filterAvailableHoldingsSelections(columnSettings.selectedMarketCodes, marketOptions),
    [columnSettings.selectedMarketCodes, marketOptions],
  );
  const selectedAccountIds = useMemo(
    () => filterAvailableHoldingsSelections(columnSettings.selectedAccountIds, accountOptionIds),
    [accountOptionIds, columnSettings.selectedAccountIds],
  );
  const holdingsSelectionUniverse = useMemo(
    () => groups.map((group) => ({
      marketCode: group.marketCode,
      ticker: group.ticker,
      label: group.instrumentName?.trim() || group.ticker,
      searchText: `${group.marketCode} ${group.ticker} ${group.instrumentName ?? ""}`.toLowerCase(),
    })),
    [groups],
  );
  const holdingsSelection = useHoldingsSelection(holdingsSelectionUniverse);
  const filteredGroups = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    const baseGroups = groups.flatMap((group) => {
      const groupTickerId = buildHoldingsTickerId(group.marketCode, group.ticker);
      if (
        holdingsSelection.selectionMode !== "all"
        && !holdingsSelection.selectedTickerIdSet.has(groupTickerId)
      ) {
        return [];
      }
      const marketMatches = selectedMarketCodes.length === 0 || selectedMarketCodes.includes(group.marketCode);
      const visibleChildren = getVisibleAccountRows(group, selectedAccountIds);
      const accountMatches = visibleChildren.length > 0;
      const queryMatches = normalizedQuery === ""
        || group.ticker.toUpperCase().includes(normalizedQuery)
        || group.marketCode.toUpperCase().includes(normalizedQuery)
        || visibleChildren.some((child) =>
          child.accountName?.toUpperCase().includes(normalizedQuery) ||
          child.accountId.toUpperCase().includes(normalizedQuery));
      if (!marketMatches || !accountMatches || !queryMatches) return [];
      return [projectHoldingGroupToChildren(group, visibleChildren)];
    });
    return applyHoldingPreset(recalculateHoldingGroupAllocations(baseGroups), selectedPreset, reportingCurrency);
  }, [
    groups,
    holdingsSelection.selectedTickerIdSet,
    holdingsSelection.selectionMode,
    query,
    reportingCurrency,
    selectedAccountIds,
    selectedMarketCodes,
    selectedPreset,
  ]);
  const sortedFilteredGroups = useMemo(() => {
    const orderedGroups = columnSettings.sortMode === "field" && columnSettings.sortField && columnSettings.sortDirection
      ? sortHoldingsRows({
          rows: filteredGroups,
          field: columnSettings.sortField,
          direction: columnSettings.sortDirection,
          extractKey: (group, field) => dashboardHoldingSortKey(group, field, reportingCurrency),
          getIdentity: (group) => ({ ticker: group.ticker, marketCode: group.marketCode }),
        })
      : applyHoldingsRowOrder(filteredGroups, holdingRowKey, columnSettings.rowOrder);

    return orderedGroups.map((group) => ({
      ...group,
      children: columnSettings.sortMode === "field" && columnSettings.sortField && columnSettings.sortDirection
        ? sortHoldingsRows({
            rows: group.children,
            field: columnSettings.sortField,
            direction: columnSettings.sortDirection,
            extractKey: (child, field) => dashboardHoldingSortKey(child, field, reportingCurrency),
            getIdentity: (child) => ({ ticker: child.ticker, marketCode: child.marketCode, accountId: child.accountId }),
          })
        : sortAccountHoldingsForCustom(group.children),
    }));
  }, [
    columnSettings.rowOrder,
    columnSettings.sortDirection,
    columnSettings.sortField,
    columnSettings.sortMode,
    filteredGroups,
    reportingCurrency,
  ]);
  const visibleGroups = useMemo(
    () => sortedFilteredGroups.slice(0, columnSettings.topHoldingsLimit),
    [columnSettings.topHoldingsLimit, sortedFilteredGroups],
  );
  const visiblePresets = presetOrder
    .filter((presetId) => !hiddenPresetIds.has(presetId))
    .map((presetId) => HOLDING_FOCUS_PRESET_BY_ID.get(presetId))
    .filter((preset): preset is (typeof HOLDING_FOCUS_PRESETS)[number] => preset !== undefined);
  const activePreset = isFilterHoldingFocusPreset(selectedPreset)
    || holdingFocusPresetMatchesSort(
      selectedPreset,
      columnSettings.sortMode,
      columnSettings.sortField,
      columnSettings.sortDirection,
    )
    ? selectedPreset
    : "";
  const reportScope = selectedMarketCodes.length === 1 ? selectedMarketCodes[0]! : "all";
  const mobileColumnSplit = splitMobileHoldingColumns(columnSettings, DASHBOARD_MOBILE_FIELD_COLUMNS);
  const selectionSummaryRows = useMemo<HoldingsSelectionSummaryRow[]>(
    () => visibleGroups.map((group) => ({
      marketCode: group.marketCode,
      ticker: group.ticker,
      reportingCostBasisAmount: group.reportingCostBasisAmount,
      reportingMarketValueAmount: group.reportingMarketValueAmount,
      reportingUnrealizedPnlAmount: group.reportingUnrealizedPnlAmount,
    })),
    [visibleGroups],
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
  const persistDashboardHoldingFocus = (preference: DashboardHoldingFocusPreferenceDto) => {
    setPresetError("");
    void patchJson("/user-preferences", { dashboardHoldingFocus: preference }, { contextScope: "session" })
      .catch((error) => {
        setPresetError(error instanceof Error ? error.message : String(error));
      });
  };
  const handlePresetChange = (value: string) => {
    if (!isHoldingFocusPreset(value)) return;
    setSelectedPreset(value);
    const preset = HOLDING_FOCUS_PRESET_BY_ID.get(value);
    if (preset) columnSettings.setSort?.(preset.sortField, preset.sortDirection);
    persistDashboardHoldingFocus(buildDashboardHoldingFocusPreference({
      hiddenPresets: [...hiddenPresetIds],
      presetOrder,
      selectedPreset: value,
    }));
  };
  const toggleExpandedRow = (key: string) => {
    setExpandedRows((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const togglePresetVisibility = (presetId: DashboardHoldingFocusPreset) => {
    setHiddenPresetIds((current) => {
      const next = new Set(current);
      const currentlyVisible = !next.has(presetId);
      const visibleCount = presetOrder.filter((id) => !next.has(id)).length;
      if (currentlyVisible && visibleCount > 1) {
        next.add(presetId);
        if (presetId === selectedPreset) {
          const nextSelected = presetOrder.find((id) => !next.has(id)) ?? "largest";
          setSelectedPreset(nextSelected);
          const preset = HOLDING_FOCUS_PRESET_BY_ID.get(nextSelected);
          if (preset) columnSettings.setSort?.(preset.sortField, preset.sortDirection);
          persistDashboardHoldingFocus(buildDashboardHoldingFocusPreference({
            hiddenPresets: [...next],
            presetOrder,
            selectedPreset: nextSelected,
          }));
          return next;
        }
      } else {
        next.delete(presetId);
      }
      persistDashboardHoldingFocus(buildDashboardHoldingFocusPreference({
        hiddenPresets: [...next],
        presetOrder,
        selectedPreset,
      }));
      return next;
    });
  };
  const movePreset = (presetId: DashboardHoldingFocusPreset, direction: -1 | 1) => {
    setPresetOrder((current) => {
      const index = current.indexOf(presetId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.length) return current;
      const next = [...current];
      [next[index], next[targetIndex]] = [next[targetIndex]!, next[index]!];
      persistDashboardHoldingFocus(buildDashboardHoldingFocusPreference({
        hiddenPresets: [...hiddenPresetIds],
        presetOrder: next,
        selectedPreset,
      }));
      return next;
    });
  };
  const resetPresetPreference = () => {
    const preference = DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE;
    setPresetOrder([...preference.presetOrder]);
    setHiddenPresetIds(new Set(preference.hiddenPresets));
    setSelectedPreset(preference.selectedPreset);
    const preset = HOLDING_FOCUS_PRESET_BY_ID.get(preference.selectedPreset);
    if (preset) columnSettings.setSort?.(preset.sortField, preset.sortDirection);
    persistDashboardHoldingFocus(preference);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div data-testid="dashboard-holdings-section">
        <Card data-testid="dashboard-holdings-preview">
          <CardHeader className="gap-4">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <CardDescription>{dict.dashboardHome.topHoldingsEyebrow}</CardDescription>
                  <Badge variant="secondary">{formatTopHoldingsMessage(dict.dashboardHome.topHoldingsReportingBadge, { currency: reportingCurrency })}</Badge>
                  <Badge variant="outline">{formatTopHoldingsMessage(dict.dashboardHome.topHoldingsGroupedBadge, { count: formatNumber(groups.length, locale) })}</Badge>
                </div>
                <CardTitle className="mt-1 text-xl">{dict.dashboardHome.topHoldingsTitle}</CardTitle>
                <CardDescription className="mt-2">
                  {formatTopHoldingsMessage(dict.dashboardHome.topHoldingsDescription, { currency: reportingCurrency })}
                </CardDescription>
                {valuationAttentionGroups.length > 0 ? (
                  <Alert className="max-w-3xl" data-testid="dashboard-missing-valuation-alert">
                    <AlertTitle>{dict.dashboardHome.missingValuationTitle}</AlertTitle>
                    <AlertDescription className="space-y-1">
                      <p>
                        {formatTopHoldingsMessage(dict.dashboardHome.missingValuationDescription, {
                          tickers: valuationAttentionLabel,
                        })}
	                      </p>
	                      <p>{dict.dashboardHome.missingValuationHelp}</p>
                      <Link
                        href={dataHealthHref}
                        className="inline-flex text-sm font-medium text-primary underline decoration-primary/30 underline-offset-4 hover:text-primary/80"
                        data-testid="dashboard-holdings-data-health-link"
                      >
                        {dict.reports.viewDataHealth}
                      </Link>
	                    </AlertDescription>
                  </Alert>
                ) : null}
              </div>
              <div className="grid w-full gap-2 sm:grid-cols-2 xl:w-[36rem] xl:grid-cols-[minmax(12rem,1.4fr)_minmax(8.5rem,1fr)_minmax(9rem,1fr)]">
                <label className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{dict.dashboardHome.topHoldingsSearchLabel}</span>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder={dict.dashboardHome.topHoldingsSearchPlaceholder}
                      className="pl-8"
                      data-testid="dashboard-holdings-search"
                    />
                  </div>
                </label>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{dict.dashboardHome.topHoldingsMarketLabel}</span>
                  <DashboardMultiSelectMenu
                    allLabel={dict.dashboardHome.topHoldingsAllMarkets}
                    buttonLabel={formatFilterSummary(selectedMarketCodes, dict.dashboardHome.topHoldingsAllMarkets, dict.dashboardHome.topHoldingsMarketLabel)}
                    label={dict.dashboardHome.topHoldingsMarketLabel}
                    options={marketOptions.map((market) => ({ id: market, label: market }))}
                    selectedIds={selectedMarketCodes}
                    setSelectedIds={columnSettings.setSelectedMarketCodes}
                    testId="dashboard-holdings-market-filter"
                  />
                </div>
                <div className="flex min-w-0 flex-col gap-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{dict.dashboardHome.topHoldingsAccountLabel}</span>
                  <DashboardMultiSelectMenu
                    allLabel={dict.dashboardHome.topHoldingsAllAccounts}
                    buttonLabel={formatFilterSummary(
                      selectedAccountIds.map((accountId) => accountOptions.find((account) => account.id === accountId)?.name ?? accountId),
                      dict.dashboardHome.topHoldingsAllAccounts,
                      dict.dashboardHome.topHoldingsAccountLabel,
                    )}
                    label={dict.dashboardHome.topHoldingsAccountLabel}
                    options={accountOptions.map((account) => ({ id: account.id, label: account.name }))}
                    selectedIds={selectedAccountIds}
                    setSelectedIds={columnSettings.setSelectedAccountIds}
                    testId="dashboard-holdings-account-filter"
                  />
                </div>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                <div className="sm:hidden">
                  <Select value={activePreset} onValueChange={handlePresetChange}>
                    <SelectTrigger
                      aria-label={dict.dashboardHome.topHoldingsFocusPresetsAria}
                      className="w-full"
                      data-testid="dashboard-holdings-presets-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {visiblePresets.map((preset) => (
                          <SelectItem key={preset.id} value={preset.id}>
                            {holdingPresetLabel(dict, preset.id)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <div className="hidden min-w-0 flex-1 pb-1 sm:block">
                  <ToggleGroup
                    className="w-full flex-wrap justify-start"
                    type="single"
                    value={activePreset}
                    onValueChange={handlePresetChange}
                    aria-label={dict.dashboardHome.topHoldingsFocusPresetsAria}
                    data-testid="dashboard-holdings-presets"
                  >
                    {visiblePresets.map((preset) => (
                      <ToggleGroupItem key={preset.id} value={preset.id}>
                        {holdingPresetLabel(dict, preset.id)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
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
                  {onRefresh ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={onRefresh}
                      disabled={isRefreshing}
                      data-testid="dashboard-holdings-refresh"
                    >
                      <RefreshCw data-icon="inline-start" aria-hidden="true" />
                      {isRefreshing ? dict.dashboardHome.refreshingLabel : dict.reports.refresh}
                    </Button>
                  ) : null}
                  <HoldingsColumnSettingsMenu
                    dict={dict}
                    getColumnLabel={(column) => dashboardColumnLabel(dict, column.id, reportingCurrency)}
                    settings={columnSettings}
                  />
                  <HoldingsRowSettingsMenu
                    dict={dict}
                    rows={sortedFilteredGroups.map((group) => ({
                      id: holdingRowKey(group),
                      label: group.ticker,
                      description: group.instrumentName ? `${group.marketCode} · ${group.instrumentName}` : group.marketCode,
                    }))}
                    settings={columnSettings}
                    showTopHoldingsLimit
                    testIdPrefix="dashboard-holdings"
                  />
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button size="sm" variant="ghost" data-testid="dashboard-holdings-preset-settings">
                        <Settings2 data-icon="inline-start" aria-hidden="true" />
                        {dict.dashboardHome.topHoldingsChipsButton}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-72">
                      <div className="flex flex-col gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{dict.dashboardHome.topHoldingsChipVisibility}</p>
                        </div>
                        <div className="flex flex-col gap-2">
                          {presetOrder.map((presetId, index) => {
                            const preset = HOLDING_FOCUS_PRESET_BY_ID.get(presetId);
                            if (!preset) return null;
                            const isVisible = !hiddenPresetIds.has(preset.id);
                            const presetLabel = holdingPresetLabel(dict, preset.id);
                            return (
                              <div key={preset.id} className="flex items-center gap-2 rounded-md border border-border px-2 py-2 text-sm">
                                <Checkbox
                                  checked={isVisible}
                                  onCheckedChange={() => togglePresetVisibility(preset.id)}
                                  aria-label={formatTopHoldingsMessage(dict.dashboardHome.topHoldingsShowChipAria, { chip: presetLabel })}
                                />
                                <span className="min-w-0 flex-1 truncate">{presetLabel}</span>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => movePreset(preset.id, -1)}
                                  disabled={index === 0}
                                  aria-label={formatTopHoldingsMessage(dict.dashboardHome.topHoldingsMoveChipEarlierAria, { chip: presetLabel })}
                                  data-testid={`dashboard-holdings-preset-up-${preset.id}`}
                                >
                                  <ArrowUp data-icon="inline-start" aria-hidden="true" />
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => movePreset(preset.id, 1)}
                                  disabled={index === presetOrder.length - 1}
                                  aria-label={formatTopHoldingsMessage(dict.dashboardHome.topHoldingsMoveChipLaterAria, { chip: presetLabel })}
                                  data-testid={`dashboard-holdings-preset-down-${preset.id}`}
                                >
                                  <ArrowDown data-icon="inline-start" aria-hidden="true" />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                        {presetError ? <p className="text-xs text-destructive">{presetError}</p> : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={resetPresetPreference}
                          data-testid="dashboard-holdings-preset-reset"
                        >
                          <RotateCcw data-icon="inline-start" aria-hidden="true" />
                          {dict.dashboardHome.topHoldingsResetLabel}
                        </Button>
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
              <div className="sm:hidden">
                <HoldingsMobileSortControls
                  columns={dashboardHoldingColumns}
                  dict={dict}
                  settings={columnSettings}
                  testIdPrefix="dashboard-holdings"
                />
              </div>
              <div className="hidden sm:flex">
                <HoldingsHiddenSortChip
                  columns={dashboardHoldingColumns}
                  dict={dict}
                  settings={columnSettings}
                  testIdPrefix="dashboard-holdings"
                  visibleSortFields={visibleSortFields}
                />
              </div>
              {columnSettings.settingsError ? (
                <p className="text-sm text-destructive" data-testid="dashboard-holdings-settings-error">
                  {columnSettings.settingsError}
                </p>
              ) : null}
              {holdingsSelection.selectionError ? (
                <p className="text-sm text-destructive" data-testid="dashboard-holdings-selection-error">
                  {holdingsSelection.selectionError}
                </p>
              ) : null}
              <HoldingsSelectionSummaryStrip
                className="border-0 py-0"
                dict={dict}
                framed={false}
                locale={locale}
                reportingCurrency={reportingCurrency}
                summary={selectionSummary}
              />
              {visibleGroups.length === 0 ? (
                <HoldingsGridEmptyState>
                  {holdingsSelection.selectionMode === "none" ? dict.holdings.noneResults : dict.dashboardHome.topHoldingsNoMatches}
                </HoldingsGridEmptyState>
              ) : (
                <>
                <HoldingsFxStrip
                  dict={dict}
                  fxRates={fxRates}
                  groups={visibleGroups}
                  locale={locale}
                  reportingCurrency={reportingCurrency}
                />
                <CalendarUnknownWarnings dict={dict} rows={visibleGroups} />
                <HoldingsGridMobileList>
                  {visibleGroups.map((group, index) => (
                    <DashboardHoldingRow
                      dict={dict}
                      key={`${group.ticker}-${group.marketCode}`}
                      fxRate={findFxRate(fxRates, group.currency, reportingCurrency)}
                      group={group}
                      locale={locale}
                      summaryColumns={mobileColumnSplit.summaryColumns}
                      visibleColumns={[...mobileColumnSplit.summaryColumns, ...mobileColumnSplit.detailColumns]}
                      onOpen={() => setSelected(group)}
                      onOpenActivity={() => setSelectedActivity(group)}
                      onToggleSelection={() => holdingsSelection.toggleTicker(buildHoldingsTickerId(group.marketCode, group.ticker))}
                      quoteRefreshVersion={index < MAX_ANIMATED_DASHBOARD_HOLDING_ROWS ? quoteRefreshVersion : 0}
                      reportingCurrency={reportingCurrency}
                      selectionChecked={holdingsSelection.isTickerSelected(buildHoldingsTickerId(group.marketCode, group.ticker))}
                      showAdminActivityLinks={showAdminActivityLinks}
                      showSelectionControl
                    />
                  ))}
                </HoldingsGridMobileList>
                <DashboardHoldingsTable
                  dict={dict}
                  fxRates={fxRates}
                  groups={visibleGroups}
                  locale={locale}
                  onOpen={(row) => setSelected(row)}
                  onOpenActivity={(row) => setSelectedActivity(row)}
                  expandedRows={expandedRows}
                  columnSettings={columnSettings}
                  onToggleExpanded={toggleExpandedRow}
                  onToggleSelection={(group) => holdingsSelection.toggleTicker(buildHoldingsTickerId(group.marketCode, group.ticker))}
                  quoteRefreshVersion={quoteRefreshVersion}
                  reportingCurrency={reportingCurrency}
                  selectionCheckedMap={new Map(
                    visibleGroups.map((group) => [
                      holdingRowKey(group),
                      holdingsSelection.isTickerSelected(buildHoldingsTickerId(group.marketCode, group.ticker)),
                    ]),
                  )}
                  showAdminActivityLinks={showAdminActivityLinks}
                />
                </>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col items-stretch gap-3 border-t border-border/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {formatTopHoldingsMessage(dict.holdings.showingTickers, {
                visible: formatNumber(visibleGroups.length, locale),
                total: formatNumber(filteredGroups.length, locale),
              })}
            </p>
            <Button asChild size="sm" variant="secondary">
              <Link href={`/reports?tab=portfolio&scope=${reportScope}&range=1Y`}>
                {dict.dashboardHome.topHoldingsOpenReport}
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </div>
      <HoldingsDetailSheet
        description={dict.dashboardHome.topHoldingsOpenDetailsExactValues}
        onOpenChange={(open) => { if (!open) setSelected(null); }}
        selected={selected}
        title={(row) => `${row.ticker} · ${row.marketCode}`}
        renderDetail={(row) => (
          <DashboardHoldingDetail
            dict={dict}
            detailColumns={mobileColumnSplit.detailColumns}
            fxRate={findFxRate(fxRates, row.currency, reportingCurrency)}
            group={row}
            locale={locale}
            reportingCurrency={reportingCurrency}
            visibleColumns={[...mobileColumnSplit.summaryColumns, ...mobileColumnSplit.detailColumns]}
          />
        )}
      />
      <HoldingsDetailSheet
        description={dict.tickerHistory.actionTimelineSubtitle}
        onOpenChange={(open) => { if (!open) setSelectedActivity(null); }}
        selected={resolveCurrentHoldingDetail(selectedActivity, groups)}
        title={(row) => "accountId" in row
          ? `${row.ticker} · ${row.marketCode} · ${row.accountName?.trim() || row.accountId}`
          : `${row.ticker} · ${row.marketCode}`}
        renderDetail={(row) => (
          <HoldingActivityDetail dict={dict} locale={locale} row={row} />
        )}
      />
    </TooltipProvider>
  );
}

function DashboardMultiSelectMenu({
  allLabel,
  buttonLabel,
  label,
  options,
  selectedIds,
  setSelectedIds,
  testId,
}: {
  allLabel: string;
  buttonLabel: string;
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
        <Button type="button" size="sm" variant="outline" className="w-full justify-between" aria-label={label} data-testid={testId}>
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

function formatFilterSummary(selectedIds: string[], allLabel: string, label: string) {
  if (selectedIds.length === 0) return allLabel;
  if (selectedIds.length === 1) return selectedIds[0]!;
  return `${selectedIds.length} ${label}`;
}

function DashboardHoldingActivityQuickLink({
  label,
  onOpen,
  testId,
}: {
  label: string;
  onOpen: () => void;
  testId: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md"
          aria-label={label}
          title={label}
          onClick={onOpen}
          data-testid={testId}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  );
}

function DashboardHoldingRow({
  dict,
  fxRate,
  group,
  locale,
  summaryColumns,
  visibleColumns,
  onOpen,
  onOpenActivity,
  onToggleSelection,
  quoteRefreshVersion,
  reportingCurrency,
  selectionChecked,
  showAdminActivityLinks,
  showSelectionControl,
}: {
  dict: ReturnType<typeof getDictionary>;
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  summaryColumns: DashboardHoldingsColumn[];
  visibleColumns: DashboardHoldingsColumn[];
  onOpen: () => void;
  onOpenActivity: () => void;
  onToggleSelection: () => void;
  quoteRefreshVersion: number;
  reportingCurrency: AccountDefaultCurrency;
  selectionChecked: boolean;
  showAdminActivityLinks: boolean;
  showSelectionControl: boolean;
}) {
  const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
  const reportingAvgCost = getDashboardReportingAverageCost(group, reportingCurrency);
  const nativePrice = group.currentUnitPrice;
  const dailyMetric = getDailyMetric(dict, group, locale);
  const unitPnl = getDashboardUnitPnl(group, reportingCurrency);

  return (
    <div
      className="rounded-lg border border-border bg-background px-4 py-3 shadow-sm transition-colors hover:bg-muted/10"
      data-testid={`dashboard-holding-preview-${group.ticker}-${group.marketCode}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {showSelectionControl ? (
            <HoldingsSelectionInlineToggle
              dict={dict}
              tickerId={buildHoldingsTickerId(group.marketCode, group.ticker)}
              checked={selectionChecked}
              onToggle={onToggleSelection}
              className="mt-1"
            />
          ) : null}
          <div className="min-w-0">
            <Link
              href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
              className="font-semibold text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
            >
              {group.ticker}
            </Link>
            {group.instrumentName ? (
              <p className="mt-1 break-words text-sm text-muted-foreground">{group.instrumentName}</p>
            ) : null}
            <div className="mt-1 flex flex-wrap gap-1.5">
              <Badge variant="outline">{group.marketCode}</Badge>
            </div>
          </div>
        </div>
        <DashboardHoldingActivityQuickLink
          label={`${dict.tickerHistory.actionTimelineTitle}: ${group.ticker}`}
          onOpen={onOpenActivity}
          testId={`dashboard-holding-open-activity-${group.ticker}-${group.marketCode}`}
        />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        {summaryColumns.map((column) => (
          <DashboardMobileColumnMetric
            key={column}
            column={column}
            dailyMetric={dailyMetric}
            dict={dict}
            fxRate={fxRate}
            group={group}
            locale={locale}
            reportingAvgCost={reportingAvgCost}
            reportingCurrency={reportingCurrency}
            reportingPrice={reportingPrice}
            quoteRefreshVersion={quoteRefreshVersion}
            showAdminActivityLinks={showAdminActivityLinks}
            unitPnl={unitPnl}
          />
        ))}
      </div>
      <div className="mt-3 border-t border-border/70 pt-3">
        <p className="text-xs text-muted-foreground">
          {visibleColumns.includes("price") && nativePrice !== null && group.currency !== reportingCurrency
            ? formatTopHoldingsMessage(dict.dashboardHome.topHoldingsNativePriceAvailable, {
                price: formatUnitPrice(nativePrice, group.currency, locale),
              })
            : dict.dashboardHome.topHoldingsOpenDetailsExactValues}
        </p>
        <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={onOpen}>
          {dict.dashboardHome.topHoldingsDetailsLabel}
        </Button>
      </div>
    </div>
  );
}

function DashboardHoldingsTable({
  columnSettings,
  dict,
  expandedRows,
  fxRates,
  groups,
  locale,
  onOpen,
  onOpenActivity,
  onToggleSelection,
  onToggleExpanded,
  quoteRefreshVersion,
  reportingCurrency,
  selectionCheckedMap,
  showAdminActivityLinks,
}: {
  columnSettings: HoldingsColumnSettingsState<DashboardHoldingsColumn>;
  dict: ReturnType<typeof getDictionary>;
  expandedRows: Set<string>;
  fxRates: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  onOpen: (row: DashboardOverviewHoldingGroupDto) => void;
  onOpenActivity: (row: DashboardHoldingDetailRow) => void;
  onToggleSelection: (row: DashboardOverviewHoldingGroupDto) => void;
  onToggleExpanded: (key: string) => void;
  quoteRefreshVersion: number;
  reportingCurrency: AccountDefaultCurrency;
  selectionCheckedMap: Map<string, boolean>;
  showAdminActivityLinks: boolean;
}) {
  const visibleColumns = columnSettings.orderedColumns.filter((column) => columnSettings.visibleColumns.includes(column.id));
  const tableMinWidth = visibleColumns.reduce(
    (total, column) => total + columnSettings.getColumnWidth(column.id),
    0,
  );
  return (
    <HoldingsGridDesktopFrame className="max-h-[34rem]">
      <table
        className="w-max min-w-full table-fixed border-collapse text-sm text-muted-foreground [&_td]:whitespace-normal [&_td]:break-words [&_th]:whitespace-normal [&_th]:break-words"
        style={{ minWidth: tableMinWidth }}
      >
        <thead>
          <tr>
            {visibleColumns.map((column) => (
              <th
                key={column.id}
                {...holdingsSortableHeaderCellProps(columnSettings, column.id)}
                data-testid={column.id === "dailyChange" ? "dashboard-holdings-daily-change-label" : undefined}
                className={cn(
                  "sticky top-0 z-20 whitespace-normal break-words bg-card align-top font-medium",
                  holdingsStickyFirstColumnClassName(column.id === "ticker", "header"),
                  column.align === "right" && "text-right",
                )}
                style={holdingsColumnCellStyle(columnSettings, column.id)}
              >
                <HoldingsColumnHeaderContent
                  align={column.align}
                  column={column.id}
                  dict={dict}
                  label={dashboardColumnLabel(dict, column.id, reportingCurrency)}
                  settings={columnSettings}
                  testIdPrefix="dashboard-holdings"
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {groups.map((group, index) => {
            const rowKey = holdingRowKey(group);
            const fxRate = findFxRate(fxRates, group.currency, reportingCurrency);
            const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
            const reportingDailyMove = getReportingDailyMove(group);
            const visibleChildren = group.children;
            const isExpanded = expandedRows.has(rowKey);
            return (
              <Fragment key={rowKey}>
                <tr data-testid={`dashboard-holding-table-row-${group.ticker}-${group.marketCode}`}>
                  {visibleColumns.map((column) => renderDashboardGroupCell({
                    column: column.id,
                    columnSettings,
                    dict,
                    fxRate,
                    group,
                    isExpanded,
                    locale,
                    onOpen,
                    onOpenActivity,
                    onToggleSelection: () => onToggleSelection(group),
                    onToggleExpanded: () => onToggleExpanded(rowKey),
                    quoteRefreshVersion: index < MAX_ANIMATED_DASHBOARD_HOLDING_ROWS ? quoteRefreshVersion : 0,
                    reportingCurrency,
                    reportingDailyMove,
                    reportingPrice,
                    selectionChecked: selectionCheckedMap.get(rowKey) ?? false,
                    showAdminActivityLinks,
                    visibleChildren,
                  }))}
                </tr>
                {isExpanded
                  ? visibleChildren.map((child) => (
                    <tr key={`${rowKey}-${child.accountId}`} className="bg-muted/20" data-testid={`dashboard-holding-account-row-${group.ticker}-${child.accountId}`}>
                      {visibleColumns.map((column) => renderDashboardChildCell({
                        child,
                        column: column.id,
                        columnSettings,
                        dict,
                        group,
                        locale,
                        onOpenActivity,
                        quoteRefreshVersion: 0,
                        reportingCurrency,
                      }))}
                    </tr>
                  ))
                  : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </HoldingsGridDesktopFrame>
  );
}

function dashboardColumnLabel(dict: ReturnType<typeof getDictionary>, column: DashboardHoldingsColumn, reportingCurrency: AccountDefaultCurrency) {
  switch (column) {
    case "ticker":
      return dict.reports.ticker;
    case "quantity":
      return dict.holdings.quantityTerm;
    case "accounts":
      return dict.holdings.columnAccounts;
    case "allocation":
      return dict.holdings.allocationTerm;
    case "price":
      return formatTopHoldingsMessage(dict.dashboardHome.topHoldingsPriceWithCurrency, { currency: reportingCurrency });
    case "averageCost":
      return dict.holdings.averageCostTerm;
    case "unitPnl":
      return dict.holdings.unitPnlTerm;
    case "marketValue":
      return formatTopHoldingsMessage(dict.dashboardHome.topHoldingsMarketValueWithCurrency, { currency: reportingCurrency });
    case "costBasis":
      return dict.holdings.costBasisTerm;
    case "dailyChange":
      return `${dict.reports.dailyChange} (${reportingCurrency})`;
    case "unrealizedPnl":
      return `${dict.dashboardHome.unrealizedPnlLabel} (${reportingCurrency})`;
    case "dataHealth":
      return dict.holdings.dataHealthTerm;
    case "actions":
      return dict.dashboardHome.actionTitle;
  }
}

function dashboardCellClassName(column: DashboardHoldingsColumn, extra?: string) {
  return cn(
    "whitespace-normal break-words align-top",
    holdingsStickyFirstColumnClassName(column === "ticker"),
    ["quantity", "accounts", "allocation", "averageCost", "price", "unitPnl", "marketValue", "costBasis", "dailyChange", "unrealizedPnl", "actions"].includes(column) && "text-right",
    extra,
  );
}

function renderDashboardGroupCell({
  column,
  columnSettings,
  dict,
  fxRate,
  group,
  isExpanded,
  locale,
  onOpen,
  onOpenActivity,
  onToggleSelection,
  onToggleExpanded,
  quoteRefreshVersion,
  reportingCurrency,
  reportingDailyMove,
  reportingPrice,
  selectionChecked,
  showAdminActivityLinks,
  visibleChildren,
}: {
  column: DashboardHoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<DashboardHoldingsColumn>;
  dict: ReturnType<typeof getDictionary>;
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  isExpanded: boolean;
  locale: LocaleCode;
  onOpen: (group: DashboardOverviewHoldingGroupDto) => void;
  onOpenActivity: (row: DashboardHoldingDetailRow) => void;
  onToggleSelection: () => void;
  onToggleExpanded: () => void;
  quoteRefreshVersion: number;
  reportingCurrency: AccountDefaultCurrency;
  reportingDailyMove: number | null;
  reportingPrice: number | null;
  selectionChecked: boolean;
  showAdminActivityLinks: boolean;
  visibleChildren: DashboardOverviewHoldingChildDto[];
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  if (column === "ticker") {
    return (
      <td key={column} className={dashboardCellClassName(column)} style={style}>
        <div className="flex items-start gap-2">
          <HoldingsSelectionInlineToggle
            dict={dict}
            tickerId={buildHoldingsTickerId(group.marketCode, group.ticker)}
            checked={selectionChecked}
            onToggle={onToggleSelection}
            className="mt-2"
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleExpanded}
            aria-expanded={isExpanded}
            aria-label={formatTopHoldingsMessage(
              isExpanded ? dict.dashboardHome.topHoldingsAccountRowsHideAria : dict.dashboardHome.topHoldingsAccountRowsShowAria,
              { ticker: group.ticker },
            )}
            data-testid={`dashboard-holding-expand-${group.ticker}-${group.marketCode}`}
          >
            <ChevronRight
              data-icon="inline-start"
              aria-hidden="true"
              className={cn("transition-transform", isExpanded && "rotate-90")}
            />
          </Button>
          <div className="flex min-w-0 items-start gap-2">
            <div className="flex min-w-0 flex-col gap-1">
              <Link
                href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
                className="break-words font-semibold text-foreground underline decoration-primary/30 underline-offset-4 hover:text-primary"
              >
                {group.ticker}
              </Link>
              {group.instrumentName ? <span className="break-words text-xs text-muted-foreground">{group.instrumentName}</span> : null}
              <span className="text-xs text-muted-foreground">{group.marketCode}</span>
            </div>
            <DashboardHoldingActivityQuickLink
              label={`${dict.tickerHistory.actionTimelineTitle}: ${group.ticker}`}
              onOpen={() => onOpenActivity(group)}
              testId={`dashboard-holding-table-open-activity-${group.ticker}-${group.marketCode}`}
            />
          </div>
        </div>
      </td>
    );
  }
  if (column === "quantity") {
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        {formatNumber(group.quantity, locale, 2)}
      </td>
    );
  }
  if (column === "accounts") {
    return <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>{formatNumber(visibleChildren.length, locale)}</td>;
  }
  if (column === "allocation") {
    return <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>{group.reportingAllocationPercent === null ? "-" : formatPercent(group.reportingAllocationPercent, locale)}</td>;
  }
  if (column === "price") {
    return (
      <td key={column} className={dashboardCellClassName(column)} style={style}>
        <PriceTextButton
          dict={dict}
          fxRate={fxRate}
          group={group}
          locale={locale}
          reportingCurrency={reportingCurrency}
          reportingPrice={reportingPrice}
          showAdminActivityLinks={showAdminActivityLinks}
        />
      </td>
    );
  }
  if (column === "averageCost") {
    const avgCost = getDashboardReportingAverageCost(group, reportingCurrency);
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>{avgCost == null ? "-" : formatCurrencyAmount(avgCost, reportingCurrency, locale)}</span>
          {group.currency !== reportingCurrency ? (
            <span className="text-xs text-muted-foreground">{formatCurrencyAmount(group.averageCostPerShare, group.currency, locale)}</span>
          ) : null}
        </div>
      </td>
    );
  }
  if (column === "unitPnl") {
    const unitPnl = getDashboardUnitPnl(group, reportingCurrency);
    const nativeUnitPnl = getNativeUnitPnl(group.currentUnitPrice, group.averageCostPerShare);
    return (
      <td key={column} className={dashboardCellClassName(column, cn("font-mono tabular-nums", holdingsFinanceToneClass(unitPnl.amount)))} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>{unitPnl.amount == null ? "-" : formatFinanceCurrencyAmount(unitPnl.amount, reportingCurrency, locale, true)}</span>
          <span className="text-xs">{unitPnl.percent == null ? "-" : formatSignedPercent(unitPnl.percent, locale)}</span>
          {group.currency !== reportingCurrency ? (
            <span className="text-xs text-muted-foreground">
              {nativeUnitPnl.amount == null ? "-" : formatFinanceCurrencyAmount(nativeUnitPnl.amount, group.currency, locale, true)}
            </span>
          ) : null}
        </div>
      </td>
    );
  }
  if (column === "marketValue") {
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>
            {group.reportingMarketValueAmount === null ? "-" : (
              <RollingNumber
                value={formatCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)}
                animateOnKey={quoteRefreshVersion}
              />
            )}
          </span>
        </div>
      </td>
    );
  }
  if (column === "costBasis") {
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        {group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale)}
      </td>
    );
  }
  if (column === "dailyChange") {
    return (
      <td
        key={column}
        className={dashboardCellClassName(column, cn("font-mono tabular-nums", holdingsFinanceToneClass(reportingDailyMove ?? group.changePercent)))}
        data-testid={`holding-group-daily-change-${group.ticker}-${group.marketCode}`}
        style={style}
      >
        <div className="flex flex-col items-end gap-1">
          <span>{reportingDailyMove === null ? "-" : formatFinanceCurrencyAmount(reportingDailyMove, reportingCurrency, locale, true)}</span>
          <span className="text-xs">{group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale)}</span>
        </div>
      </td>
    );
  }
  if (column === "unrealizedPnl") {
    return (
      <td key={column} className={dashboardCellClassName(column, cn("font-mono tabular-nums", holdingsFinanceToneClass(group.reportingUnrealizedPnlAmount)))} style={style}>
        {group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
      </td>
    );
  }
  if (column === "dataHealth") {
    return (
      <td key={column} className={dashboardCellClassName(column)} style={style}>
        <HoldingsDataHealthBadges dict={dict} locale={locale} row={group} showCurrentFreshness={false} />
      </td>
    );
  }
  return (
      <td key={column} className={dashboardCellClassName(column)} style={style}>
      <Button size="sm" variant="ghost" onClick={() => onOpen(group)}>
        {dict.dashboardHome.topHoldingsDetailsLabel}
      </Button>
    </td>
  );
}

function renderDashboardChildCell({
  child,
  column,
  columnSettings,
  dict,
  group,
  locale,
  onOpenActivity,
  quoteRefreshVersion,
  reportingCurrency,
}: {
  child: DashboardOverviewHoldingChildDto;
  column: DashboardHoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<DashboardHoldingsColumn>;
  dict: ReturnType<typeof getDictionary>;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  onOpenActivity: (row: DashboardHoldingDetailRow) => void;
  quoteRefreshVersion: number;
  reportingCurrency: AccountDefaultCurrency;
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  if (column === "ticker") {
    return (
      <td key={column} className={dashboardCellClassName(column, "bg-muted")} style={style}>
        <div className="flex items-start gap-2 pl-10">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-medium text-foreground">{child.accountName ?? child.accountId}</span>
            <span className="text-xs text-muted-foreground">{dict.holdings.accountChildLabel}</span>
          </div>
          <DashboardHoldingActivityQuickLink
            label={`${dict.tickerHistory.actionTimelineTitle}: ${child.ticker} · ${child.accountName?.trim() || child.accountId}`}
            onOpen={() => onOpenActivity(child)}
            testId={`dashboard-holding-account-open-activity-${child.ticker}-${child.marketCode}-${child.accountId}`}
          />
        </div>
      </td>
    );
  }
  if (column === "quantity") {
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        {formatNumber(child.quantity, locale, 2)}
      </td>
    );
  }
  if (column === "accounts") {
    return <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>1</td>;
  }
  if (column === "allocation") {
    return <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>{child.reportingAllocationPercent === null ? "-" : formatPercent(child.reportingAllocationPercent, locale)}</td>;
  }
  if (column === "price") {
    const price = getReportingChildUnitPrice(child, reportingCurrency);
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        {price === null ? "-" : formatUnitPrice(price, reportingCurrency, locale)}
      </td>
    );
  }
  if (column === "averageCost") {
    const avgCost = getDashboardReportingAverageCost(child, reportingCurrency);
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>{avgCost == null ? "-" : formatCurrencyAmount(avgCost, reportingCurrency, locale)}</span>
          {child.currency !== reportingCurrency ? (
            <span className="text-xs text-muted-foreground">{formatCurrencyAmount(child.averageCostPerShare, child.currency, locale)}</span>
          ) : null}
        </div>
      </td>
    );
  }
  if (column === "unitPnl") {
    const unitPnl = getDashboardUnitPnl(child, reportingCurrency);
    const nativeUnitPnl = getNativeUnitPnl(child.currentUnitPrice, child.averageCostPerShare);
    return (
      <td key={column} className={dashboardCellClassName(column, cn("font-mono tabular-nums", holdingsFinanceToneClass(unitPnl.amount)))} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>{unitPnl.amount == null ? "-" : formatFinanceCurrencyAmount(unitPnl.amount, reportingCurrency, locale, true)}</span>
          <span className="text-xs">{unitPnl.percent == null ? "-" : formatSignedPercent(unitPnl.percent, locale)}</span>
          {child.currency !== reportingCurrency ? (
            <span className="text-xs text-muted-foreground">
              {nativeUnitPnl.amount == null ? "-" : formatFinanceCurrencyAmount(nativeUnitPnl.amount, child.currency, locale, true)}
            </span>
          ) : null}
        </div>
      </td>
    );
  }
  if (column === "marketValue") {
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>
            {child.reportingMarketValueAmount === null ? "-" : (
              <RollingNumber
                value={formatCurrencyAmount(child.reportingMarketValueAmount, reportingCurrency, locale)}
                animateOnKey={quoteRefreshVersion}
              />
            )}
          </span>
          {child.reportingMarketValueAmount === null ? null : (
            <span className="text-xs text-muted-foreground">
              {formatCurrencyAmount(child.reportingMarketValueAmount, reportingCurrency, locale)}
            </span>
          )}
        </div>
      </td>
    );
  }
  if (column === "costBasis") {
    return (
      <td key={column} className={dashboardCellClassName(column, "font-mono tabular-nums")} style={style}>
        {child.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(child.reportingCostBasisAmount, reportingCurrency, locale)}
      </td>
    );
  }
  if (column === "dailyChange") {
    const dailyMove = getReportingDailyMove(child);
    return (
      <td key={column} className={dashboardCellClassName(column, cn("font-mono tabular-nums", holdingsFinanceToneClass(dailyMove)))} style={style}>
        <div className="flex flex-col items-end gap-1">
          <span>{dailyMove === null ? "-" : formatFinanceCurrencyAmount(dailyMove, reportingCurrency, locale, true)}</span>
          {dailyMove === null ? null : (
            <span className="text-xs text-muted-foreground">
              {formatFinanceCurrencyAmount(dailyMove, reportingCurrency, locale)}
            </span>
          )}
          {child.changePercent === null ? null : <span className="text-xs">{formatSignedPercent(child.changePercent, locale)}</span>}
        </div>
      </td>
    );
  }
  if (column === "unrealizedPnl") {
    return (
      <td key={column} className={dashboardCellClassName(column, cn("font-mono tabular-nums", holdingsFinanceToneClass(child.reportingUnrealizedPnlAmount)))} style={style}>
        {child.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(child.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
      </td>
    );
  }
  if (column === "dataHealth") {
    return (
      <td key={column} className={dashboardCellClassName(column)} style={style}>
        <HoldingsDataHealthBadges dict={dict} locale={locale} row={child} showCurrentFreshness={false} />
      </td>
    );
  }
  return (
    <td key={column} className={dashboardCellClassName(column)} style={style}>
      <Link
        href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
        className="text-sm font-medium text-primary hover:underline"
      >
        {dict.reports.openTicker}
      </Link>
    </td>
  );
}

function HoldingsFxStrip({
  dict,
  fxRates,
  groups,
  locale,
  reportingCurrency,
}: {
  dict: ReturnType<typeof getDictionary>;
  fxRates: FxConversionRateDto[];
  groups: DashboardOverviewHoldingGroupDto[];
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
}) {
  const rows = buildHoldingFxRows(groups, fxRates, reportingCurrency);
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/20 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
      data-testid="dashboard-holdings-fx-rates"
    >
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground">{dict.dashboardHome.topHoldingsFxUsedTitle}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {rows.length === 0
            ? formatTopHoldingsMessage(dict.dashboardHome.topHoldingsFxNoConversion, { currency: reportingCurrency })
            : formatTopHoldingsMessage(dict.dashboardHome.topHoldingsFxConverted, { currency: reportingCurrency })}
        </p>
      </div>
      {rows.length > 0 ? (
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {rows.map((row) => (
            <div key={`${row.fromCurrency}-${row.toCurrency}`} className="rounded-md border border-border bg-background px-3 py-2">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-medium text-muted-foreground">
                  {formatTopHoldingsMessage(dict.dashboardHome.fxPairLabel, {
                    from: row.fromCurrency,
                    to: row.toCurrency,
                  })}
                </span>
                <Badge variant={row.rate === null ? "outline" : "secondary"}>
                  {row.rate === null ? dict.dashboardHome.topHoldingsFxMissing : formatFxRate(row.rate)}
                </Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatTopHoldingsMessage(dict.dashboardHome.topHoldingsFxVisibleHoldings, { count: formatNumber(row.holdingCount, locale) })}
                {row.asOf ? ` · ${formatDateLabel(row.asOf, locale)}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function PreviewMetric({
  label,
  labelTestId,
  testId,
  title,
  toneValue,
  value,
  subValue,
}: {
  label: string;
  labelTestId?: string;
  testId?: string;
  title?: string;
  toneValue?: number | null;
  value: ReactNode;
  subValue?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-left">
      <p className="text-xs text-muted-foreground" data-testid={labelTestId}>{label}</p>
      <p className={cn("mt-1 truncate font-mono text-sm font-semibold tabular-nums", holdingsFinanceToneClass(toneValue))} data-testid={testId} title={title}>
        {value}
      </p>
      {subValue ? <p className="mt-1 font-mono text-xs text-muted-foreground tabular-nums">{subValue}</p> : null}
    </div>
  );
}

function PriceTextButton({
  dict,
  fxRate,
  group,
  locale,
  reportingCurrency,
  reportingPrice,
  showAdminActivityLinks,
}: {
  dict: ReturnType<typeof getDictionary>;
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
  showAdminActivityLinks: boolean;
}) {
  const priceState = getPriceState(group);
  const tooltip = group.currentUnitPrice !== null && group.currency !== reportingCurrency
    ? formatTopHoldingsMessage(dict.dashboardHome.topHoldingsNativePriceTooltip, {
        price: formatUnitPrice(group.currentUnitPrice, group.currency, locale),
        fx: fxRate !== null ? ` · ${dict.reports.fxRate} ${formatFxRate(fxRate)}` : "",
      })
    : dict.dashboardHome.topHoldingsPriceDetailsTooltip;

  return (
    <div className="inline-flex flex-col items-end text-right font-mono tabular-nums">
      <Tooltip>
        <Popover>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex flex-col items-end rounded-md px-2 py-1 text-right text-foreground hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={formatTopHoldingsMessage(dict.dashboardHome.topHoldingsOpenPriceDetailsAria, { ticker: group.ticker })}
              >
                <span className="font-semibold">{reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}</span>
                {group.currency !== reportingCurrency && group.currentUnitPrice !== null ? (
                  <span className="text-xs text-muted-foreground">{dict.dashboardHome.topHoldingsNativeAvailable}</span>
                ) : null}
              </button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{tooltip}</TooltipContent>
          <PricePopoverContent
            dict={dict}
            fxRate={fxRate}
            group={group}
            locale={locale}
            reportingCurrency={reportingCurrency}
            reportingPrice={reportingPrice}
          />
        </Popover>
      </Tooltip>
      {priceState ? (
        <PriceStateChip
          className="w-full justify-start text-left md:justify-end md:text-right"
          activityPath={showAdminActivityLinks ? buildPriceStateActivityPath({ marketCode: group.marketCode, priceState, ticker: group.ticker }) : null}
          dict={dict}
          locale={locale}
          priceState={priceState}
          testId={`dashboard-price-state-${group.ticker}-${group.marketCode}`}
        />
      ) : null}
    </div>
  );
}

function PricePreviewMetric({
  dict,
  fxRate,
  group,
  locale,
  reportingCurrency,
  reportingPrice,
  showAdminActivityLinks,
}: {
  dict: ReturnType<typeof getDictionary>;
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
  showAdminActivityLinks: boolean;
}) {
  const priceState = getPriceState(group);

  return (
    <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-left">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="block w-full rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            aria-label={formatTopHoldingsMessage(dict.dashboardHome.topHoldingsOpenPriceDetailsAria, { ticker: group.ticker })}
          >
            <span className="block text-xs text-muted-foreground">
              {formatTopHoldingsMessage(dict.dashboardHome.topHoldingsPriceWithCurrency, { currency: reportingCurrency })}
            </span>
            <span
              className="mt-1 block truncate font-mono text-sm font-semibold tabular-nums text-foreground"
              title={reportingPrice === null ? undefined : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
            >
              {reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
            </span>
          </button>
        </PopoverTrigger>
        <PricePopoverContent
          dict={dict}
          fxRate={fxRate}
          group={group}
          locale={locale}
          reportingCurrency={reportingCurrency}
          reportingPrice={reportingPrice}
        />
      </Popover>
      {priceState ? (
        <PriceStateChip
          className="w-full justify-start text-left"
          activityPath={showAdminActivityLinks ? buildPriceStateActivityPath({ marketCode: group.marketCode, priceState, ticker: group.ticker }) : null}
          dict={dict}
          locale={locale}
          priceState={priceState}
          testId={`dashboard-mobile-price-state-${group.ticker}-${group.marketCode}`}
        />
      ) : null}
    </div>
  );
}

function PricePopoverContent({
  dict,
  fxRate,
  group,
  locale,
  reportingCurrency,
  reportingPrice,
}: {
  dict: ReturnType<typeof getDictionary>;
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
}) {
  return (
    <PopoverContent align="start" collisionPadding={16} className="w-[min(20rem,calc(100vw-2rem))] p-3">
      <div className="flex flex-col gap-3">
        <div>
          <p className="text-sm font-semibold text-foreground">{dict.reports.priceTranslationTitle}</p>
          <p className="text-xs text-muted-foreground">
            {formatTopHoldingsMessage(dict.reports.reportingCurrencySentence, { currency: reportingCurrency })}
          </p>
        </div>
        <PriceDetailRow
          label={formatTopHoldingsMessage(dict.reports.reportingPriceWithCurrency, { currency: reportingCurrency })}
          value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)}
        />
        <PriceDetailRow
          label={formatTopHoldingsMessage(dict.reports.nativePriceWithCurrency, { currency: group.currency })}
          value={group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale)}
        />
        <PriceDetailRow
          label={dict.reports.fxRate}
          value={group.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate)}
        />
        <PriceDetailRow
          label={dict.reports.quoteStatus}
          value={getHoldingsQuoteStatusLabel(dict, group.quoteStatus)}
        />
      </div>
    </PopoverContent>
  );
}

function PriceDetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-sm font-semibold tabular-nums text-foreground">{value}</span>
    </div>
  );
}

function DashboardHoldingDetail({
  dict,
  detailColumns,
  fxRate,
  group,
  locale,
  reportingCurrency,
  visibleColumns,
}: {
  dict: ReturnType<typeof getDictionary>;
  detailColumns: DashboardHoldingsColumn[];
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
  visibleColumns: DashboardHoldingsColumn[];
}) {
  const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
  const reportingDailyMove = getReportingDailyMove(group);
  const nativeDailyMove = group.change === null ? null : group.change * group.quantity;
  const portfolioAllocation = group.reportingAllocationPercent === null ? "-" : formatPercent(group.reportingAllocationPercent, locale);
  const reportingAverageCost = getReportingAverageCost(group.reportingCostBasisAmount, group.quantity);
  const visibleColumnSet = new Set(visibleColumns);
  const detailColumnSet = new Set(detailColumns);
  const showLegacyColumn = (column: DashboardHoldingsColumn) => visibleColumnSet.has(column) && !detailColumnSet.has(column);
  const showSupplementalColumn = (column: DashboardHoldingsColumn) => visibleColumnSet.has(column);

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <span className="text-sm text-muted-foreground">{dict.dashboardHome.topHoldingsTickerPage}</span>
        <Link
          href={`/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`}
          className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
        >
          {dict.dashboardHome.topHoldingsOpenLabel} <ChevronRight data-icon="inline-end" aria-hidden="true" />
        </Link>
      </div>

      {detailColumns.length > 0 ? (
        <DetailSection title={dict.reports.viewDetails}>
          <DetailGrid>
            {detailColumns.map((column) => (
              <DashboardDetailColumnMetric
                key={column}
                column={column}
                dict={dict}
                group={group}
                locale={locale}
                reportingCurrency={reportingCurrency}
              />
            ))}
          </DetailGrid>
        </DetailSection>
      ) : null}

      <DetailSection title={dict.dashboardHome.topHoldingsSummaryTitle}>
        <DetailGrid>
          {showLegacyColumn("marketValue") ? (
            <DetailMetric label={dict.reports.marketValue} value={group.reportingMarketValueAmount === null ? "-" : formatCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)} />
          ) : null}
          {showLegacyColumn("quantity") || showLegacyColumn("accounts") || showLegacyColumn("allocation") ? (
            <DetailMetric label={dict.reports.quantity} value={formatNumber(group.quantity, locale, 2)} />
          ) : null}
          <DetailMetric label={dict.dashboardHome.topHoldingsPortfolioAllocation} value={portfolioAllocation} />
          <DetailMetric label={dict.reports.accounts} value={formatNumber(group.children.length, locale)} />
        </DetailGrid>
      </DetailSection>

      <DetailSection title={dict.reports.accounts}>
        <div className="flex flex-col gap-2">
          {group.children.map((child) => (
            <div key={child.accountId} className="rounded-md border border-border px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{child.accountName ?? child.accountId}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {[
                      showLegacyColumn("quantity") ? `${dict.holdings.quantityTerm}: ${formatNumber(child.quantity, locale, 2)}` : null,
                      showLegacyColumn("accounts") ? `${dict.holdings.columnAccounts}: ${child.accountName ?? child.accountId}` : null,
                      showLegacyColumn("allocation") && child.reportingAllocationPercent !== null ? `${dict.holdings.allocationTerm}: ${formatPercent(child.reportingAllocationPercent, locale)}` : null,
                      child.reportingAllocationPercent === null ? null : `${dict.dashboardHome.topHoldingsPortfolioAllocation}: ${formatPercent(child.reportingAllocationPercent, locale)}`,
                    ].filter(Boolean).join(" · ")}
                  </p>
                </div>
                {showLegacyColumn("marketValue") || showLegacyColumn("unrealizedPnl") ? (
                  <div className="text-right">
                    {showLegacyColumn("marketValue") ? (
                      <p className="font-mono text-sm font-semibold tabular-nums">
                        {child.reportingMarketValueAmount === null ? "-" : formatCurrencyAmount(child.reportingMarketValueAmount, reportingCurrency, locale)}
                      </p>
                    ) : null}
                    {showLegacyColumn("unrealizedPnl") ? (
                      <p className={cn("mt-1 font-mono text-xs tabular-nums", holdingsFinanceToneClass(child.reportingUnrealizedPnlAmount))}>
                        {child.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(child.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                <DetailMetric label={dict.reports.costBasis} value={child.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(child.reportingCostBasisAmount, reportingCurrency, locale)} />
                {showLegacyColumn("averageCost") ? (
                  <DetailMetric label={dict.dashboardHome.topHoldingsAverageCost} value={formatUnitPrice(child.averageCostPerShare, child.currency, locale)} />
                ) : null}
                {showSupplementalColumn("price") ? (
                  <>
                    <DetailMetric label={dict.dashboardHome.topHoldingsLatestPrice} value={child.currentUnitPrice === null ? "-" : formatUnitPrice(child.currentUnitPrice, child.currency, locale)} />
                    <DetailMetric label={dict.reports.fxRate} value={child.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate)} />
                  </>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </DetailSection>

      <DetailSection title={`${dict.holdings.costBasisTerm} / ${dict.holdings.pnlTerm}`}>
        <DetailGrid>
          <DetailMetric label={dict.reports.costBasis} value={group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale)} />
          {showLegacyColumn("unrealizedPnl") ? (
            <DetailMetric label={dict.reports.unrealizedPnl} toneValue={group.reportingUnrealizedPnlAmount} value={group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale)} />
          ) : null}
          {showLegacyColumn("dailyChange") ? (
            <DetailMetric label={dict.dashboardHome.topHoldingsDailyMove} toneValue={reportingDailyMove} value={reportingDailyMove === null ? "-" : formatFinanceCurrencyAmount(reportingDailyMove, reportingCurrency, locale)} />
          ) : null}
        </DetailGrid>
      </DetailSection>

      <DetailSection title={dict.dashboardHome.topHoldingsFxPriceTitle}>
        <DetailGrid>
          {showSupplementalColumn("price") ? (
            <>
              {showLegacyColumn("price") ? (
                <DetailMetric label={dict.reports.reportingPrice} value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)} />
              ) : null}
              <DetailMetric label={dict.reports.nativePrice} value={group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale)} />
              <DetailMetric label={dict.dashboardHome.topHoldingsLatestPrice} value={group.currentUnitPrice === null ? "-" : formatUnitPrice(group.currentUnitPrice, group.currency, locale)} />
              <DetailMetric label={dict.reports.fxRate} value={group.currency === reportingCurrency ? "1" : fxRate === null ? "-" : formatFxRate(fxRate)} />
            </>
          ) : null}
          {showSupplementalColumn("marketValue") ? (
            <DetailMetric label={dict.reports.nativeMarketValue} value={group.marketValueAmount === null ? "-" : formatCurrencyAmount(group.marketValueAmount, group.currency, locale)} />
          ) : null}
          {showSupplementalColumn("averageCost") ? (
            <>
              <DetailMetric label={dict.dashboardHome.topHoldingsAverageCost} value={formatUnitPrice(group.averageCostPerShare, group.currency, locale)} />
              <DetailMetric label={dict.dashboardHome.topHoldingsReportingAverageCost} value={reportingAverageCost === null ? "-" : formatUnitPrice(reportingAverageCost, reportingCurrency, locale)} />
            </>
          ) : null}
          {showSupplementalColumn("dailyChange") ? (
            <>
              <DetailMetric label={dict.dashboardHome.topHoldingsNativeDailyMove} toneValue={nativeDailyMove} value={nativeDailyMove === null ? "-" : formatCurrencyAmount(nativeDailyMove, group.currency, locale)} />
              <DetailMetric label={dict.reports.dailyChangePercent} toneValue={group.changePercent} value={group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale)} />
            </>
          ) : null}
        </DetailGrid>
      </DetailSection>
    </div>
  );
}

function DetailSection({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </section>
  );
}

function DetailGrid({ children }: { children: ReactNode }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {children}
    </div>
  );
}

function DetailMetric({ label, toneValue, value }: { label: string; toneValue?: number | null; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 font-mono text-sm font-semibold tabular-nums text-foreground", holdingsFinanceToneClass(toneValue))}>
        {value}
      </p>
    </div>
  );
}

function DashboardMobileColumnMetric({
  column,
  dailyMetric,
  dict,
  fxRate,
  group,
  locale,
  reportingAvgCost,
  reportingCurrency,
  reportingPrice,
  quoteRefreshVersion,
  showAdminActivityLinks,
  unitPnl,
}: {
  column: DashboardHoldingsColumn;
  dailyMetric: ReturnType<typeof getDailyMetric>;
  dict: ReturnType<typeof getDictionary>;
  fxRate: number | null;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingAvgCost: number | null;
  reportingCurrency: AccountDefaultCurrency;
  reportingPrice: number | null;
  quoteRefreshVersion: number;
  showAdminActivityLinks: boolean;
  unitPnl: ReturnType<typeof getDashboardUnitPnl>;
}) {
  switch (column) {
    case "quantity":
      return (
        <PreviewMetric
          label={dict.holdings.quantityTerm}
          value={formatNumber(group.quantity, locale, 2)}
        />
      );
    case "accounts":
      return <PreviewMetric label={dict.holdings.columnAccounts} value={formatNumber(group.accountCount, locale)} />;
    case "allocation":
      return <PreviewMetric label={dict.holdings.allocationTerm} value={group.reportingAllocationPercent === null ? "-" : formatPercent(group.reportingAllocationPercent, locale)} />;
    case "averageCost":
      return <PreviewMetric label={dict.holdings.averageCostTerm} value={reportingAvgCost == null ? "-" : formatCurrencyAmount(reportingAvgCost, reportingCurrency, locale)} />;
    case "price":
      return (
        <PricePreviewMetric
          dict={dict}
          fxRate={fxRate}
          group={group}
          locale={locale}
          reportingCurrency={reportingCurrency}
          reportingPrice={reportingPrice}
          showAdminActivityLinks={showAdminActivityLinks}
        />
      );
    case "unitPnl":
      return (
        <PreviewMetric
          label={dict.holdings.unitPnlTerm}
          toneValue={unitPnl.amount}
          value={unitPnl.amount == null ? "-" : formatFinanceCurrencyAmount(unitPnl.amount, reportingCurrency, locale, true)}
          title={unitPnl.percent == null ? undefined : formatSignedPercent(unitPnl.percent, locale)}
        />
      );
    case "marketValue":
      return (
        <PreviewMetric
          label={dict.reports.marketValue}
          value={group.reportingMarketValueAmount === null ? "-" : (
            <RollingNumber
              value={formatFinanceCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)}
              animateOnKey={quoteRefreshVersion}
            />
          )}
        />
      );
    case "costBasis":
      return <PreviewMetric label={dict.holdings.costBasisTerm} value={group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale)} />;
    case "dailyChange":
      return (
        <PreviewMetric
          label={dict.reports.dailyChange}
          labelTestId="dashboard-holdings-daily-change-label"
          testId={`holding-group-daily-change-${group.ticker}-${group.marketCode}`}
          title={dailyMetric.title}
          toneValue={dailyMetric.toneValue}
          value={dailyMetric.value}
          subValue={dailyMetric.exactValue}
        />
      );
    case "unrealizedPnl":
      return (
        <PreviewMetric
          label={dict.dashboardHome.unrealizedPnlLabel}
          toneValue={group.reportingUnrealizedPnlAmount}
          value={group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale, true)}
        />
      );
    case "dataHealth":
      return (
        <div className="rounded-md border border-border bg-muted/20 px-3 py-2 text-left">
          <p className="text-xs text-muted-foreground">{dict.holdings.dataHealthTerm}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <HoldingsDataHealthBadges dict={dict} locale={locale} row={group} showCurrentFreshness />
          </div>
        </div>
      );
    case "ticker":
    case "actions":
      return null;
  }
}

function DashboardDetailColumnMetric({
  column,
  dict,
  group,
  locale,
  reportingCurrency,
}: {
  column: DashboardHoldingsColumn;
  dict: ReturnType<typeof getDictionary>;
  group: DashboardOverviewHoldingGroupDto;
  locale: LocaleCode;
  reportingCurrency: AccountDefaultCurrency;
}) {
  const reportingPrice = getReportingUnitPrice(group, reportingCurrency);
  const reportingDailyMove = getReportingDailyMove(group);
  const unitPnl = getDashboardUnitPnl(group, reportingCurrency);
  const reportingAvgCost = getDashboardReportingAverageCost(group, reportingCurrency);
  switch (column) {
    case "quantity":
      return <DetailMetric label={dict.holdings.quantityTerm} value={formatNumber(group.quantity, locale, 2)} />;
    case "accounts":
      return <DetailMetric label={dict.holdings.columnAccounts} value={formatNumber(group.accountCount, locale)} />;
    case "allocation":
      return <DetailMetric label={dict.holdings.allocationTerm} value={group.reportingAllocationPercent === null ? "-" : formatPercent(group.reportingAllocationPercent, locale)} />;
    case "averageCost":
      return <DetailMetric label={dict.holdings.averageCostTerm} value={reportingAvgCost == null ? "-" : formatCurrencyAmount(reportingAvgCost, reportingCurrency, locale)} />;
    case "price":
      return <DetailMetric label={dict.reports.reportingPrice} value={reportingPrice === null ? "-" : formatUnitPrice(reportingPrice, reportingCurrency, locale)} />;
    case "unitPnl":
      return <DetailMetric label={dict.holdings.unitPnlTerm} toneValue={unitPnl.amount} value={unitPnl.amount === null ? "-" : formatFinanceCurrencyAmount(unitPnl.amount, reportingCurrency, locale)} />;
    case "marketValue":
      return <DetailMetric label={dict.reports.marketValue} value={group.reportingMarketValueAmount === null ? "-" : formatCurrencyAmount(group.reportingMarketValueAmount, reportingCurrency, locale)} />;
    case "costBasis":
      return <DetailMetric label={dict.holdings.costBasisTerm} value={group.reportingCostBasisAmount === null ? "-" : formatCurrencyAmount(group.reportingCostBasisAmount, reportingCurrency, locale)} />;
    case "dailyChange":
      return <DetailMetric label={dict.reports.dailyChange} toneValue={reportingDailyMove} value={reportingDailyMove === null ? "-" : formatFinanceCurrencyAmount(reportingDailyMove, reportingCurrency, locale)} />;
    case "unrealizedPnl":
      return <DetailMetric label={dict.dashboardHome.unrealizedPnlLabel} toneValue={group.reportingUnrealizedPnlAmount} value={group.reportingUnrealizedPnlAmount === null ? "-" : formatFinanceCurrencyAmount(group.reportingUnrealizedPnlAmount, reportingCurrency, locale)} />;
    case "dataHealth":
      return <DetailMetric label={dict.holdings.dataHealthTerm} value={getHoldingsQuoteStatusLabel(dict, group.quoteStatus)} />;
    case "ticker":
    case "actions":
      return null;
  }
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

export function dashboardHoldingSortKey(
  row: DashboardHoldingDetailRow,
  field: HoldingsSortField,
  reportingCurrency: AccountDefaultCurrency,
): HoldingsSortPrimitive {
  switch (field) {
    case "ticker":
      return row.ticker;
    case "accountCount":
      return "accountCount" in row ? row.accountCount : 1;
    case "quantity":
      return row.quantity;
    case "averageCost":
      return getDashboardReportingAverageCost(row, reportingCurrency);
    case "price":
      return "accountId" in row
        ? getReportingChildUnitPrice(row, reportingCurrency)
        : getReportingUnitPrice(row, reportingCurrency);
    case "unitPnl":
      return getDashboardUnitPnl(row, reportingCurrency).amount;
    case "marketValue":
      return row.reportingMarketValueAmount;
    case "costBasis":
      return row.reportingCostBasisAmount;
    case "dailyChangePercent":
      return row.changePercent;
    case "unrealizedPnl":
      return row.reportingUnrealizedPnlAmount;
    case "allocation":
      return row.reportingAllocationPercent;
    case "dataHealth":
      return dashboardDataHealthSortRank(row);
    case "nextDividendDate":
      return row.nextDividendDate;
    case "lastDividendDate":
      return row.lastDividendPostedDate;
  }
}

function dashboardDataHealthSortRank(row: DashboardHoldingDetailRow): number {
  const fxRank = row.fxStatus === "missing" ? 50 : row.fxStatus === "partial" ? 25 : 0;
  const allocationRank = row.allocationBasisFallbackReason ? 10 : 0;
  return (priceStateSortRank(row) * 100) + fxRank + allocationRank;
}

function sortAccountHoldingsForCustom(
  rows: DashboardOverviewHoldingChildDto[],
): DashboardOverviewHoldingChildDto[] {
  return rows.slice().sort((left, right) =>
    (left.accountName?.trim() || left.accountId).localeCompare(right.accountName?.trim() || right.accountId)
    || left.accountId.localeCompare(right.accountId));
}

function isHoldingFocusPreset(value: string): value is DashboardHoldingFocusPreset {
  return (DASHBOARD_HOLDING_FOCUS_PRESETS as readonly string[]).includes(value);
}

function isFilterHoldingFocusPreset(preset: DashboardHoldingFocusPreset): boolean {
  return preset === "fx-exposure" || preset === "stale-quotes";
}

function holdingFocusPresetMatchesSort(
  presetId: DashboardHoldingFocusPreset,
  sortMode: "field" | "custom" | undefined,
  sortField: HoldingsSortField | null | undefined,
  sortDirection: "asc" | "desc" | null | undefined,
): boolean {
  const preset = HOLDING_FOCUS_PRESET_BY_ID.get(presetId);
  return preset !== undefined
    && sortMode === "field"
    && preset.sortField === sortField
    && preset.sortDirection === sortDirection;
}

function normalizeDashboardHoldingFocusPreference(value: unknown): DashboardHoldingFocusPreferenceDto {
  const parsed = dashboardHoldingFocusPreferenceSchema.safeParse(value);
  if (!parsed.success) return DEFAULT_DASHBOARD_HOLDING_FOCUS_PREFERENCE;
  return buildDashboardHoldingFocusPreference(parsed.data);
}

function buildDashboardHoldingFocusPreference({
  hiddenPresets,
  presetOrder,
  selectedPreset,
}: DashboardHoldingFocusPreferenceDto): DashboardHoldingFocusPreferenceDto {
  const known = new Set<DashboardHoldingFocusPreset>(DASHBOARD_HOLDING_FOCUS_PRESETS);
  const order: DashboardHoldingFocusPreset[] = [];
  for (const preset of presetOrder) {
    if (known.has(preset) && !order.includes(preset)) order.push(preset);
  }
  for (const preset of DASHBOARD_HOLDING_FOCUS_PRESETS) {
    if (!order.includes(preset)) order.push(preset);
  }

  const orderSet = new Set(order);
  const hidden = hiddenPresets.filter((preset, index, all) =>
    orderSet.has(preset) && all.indexOf(preset) === index);
  if (order.length > 0 && order.every((preset) => hidden.includes(preset))) {
    hidden.pop();
  }
  let selected = selectedPreset;
  if (!orderSet.has(selected) || hidden.includes(selected)) {
    selected = order.find((preset) => !hidden.includes(preset)) ?? order[0] ?? "largest";
  }

  return {
    presetOrder: order,
    hiddenPresets: hidden,
    selectedPreset: selected,
  };
}

function applyHoldingPreset(
  groups: DashboardOverviewHoldingGroupDto[],
  preset: DashboardHoldingFocusPreset,
  reportingCurrency: AccountDefaultCurrency,
): DashboardOverviewHoldingGroupDto[] {
  if (preset === "fx-exposure") {
    return groups.filter((group) => group.currency !== reportingCurrency);
  }
  if (preset === "stale-quotes") {
    return groups.filter((group) => isNonCurrentPrice(group));
  }
  return groups;
}

function aggregatePriceState(items: Array<{ priceState?: PriceStateDtoLike | null }>): PriceStateDtoLike {
  return items
    .map((item) => getPriceState(item))
    .filter((item): item is PriceStateDtoLike => item !== null)
    .sort((left, right) => priceStateSortRank({ priceState: right }) - priceStateSortRank({ priceState: left }))[0] ?? buildMissingPriceState();
}

function resolveQuoteStatus(
  items: Array<DashboardOverviewHoldingChildDto["quoteStatus"]>,
): DashboardOverviewHoldingChildDto["quoteStatus"] {
  if (items.includes("missing")) return "missing";
  if (items.includes("provisional")) return "provisional";
  return "current";
}

function holdingRowKey(group: DashboardOverviewHoldingGroupDto): string {
  return `${group.marketCode}:${group.ticker}`;
}

function getVisibleAccountRows(group: DashboardOverviewHoldingGroupDto, selectedAccountIds: string[]): DashboardOverviewHoldingChildDto[] {
  if (selectedAccountIds.length === 0) return group.children;
  return group.children.filter((child) => selectedAccountIds.includes(child.accountId));
}

function projectHoldingGroupToChildren(
  group: DashboardOverviewHoldingGroupDto,
  children: DashboardOverviewHoldingChildDto[],
): DashboardOverviewHoldingGroupDto {
  if (children.length === group.children.length) return group;
  const quantity = children.reduce((sum, child) => sum + child.quantity, 0);
  const costBasisAmount = children.reduce((sum, child) => sum + child.costBasisAmount, 0);
  const previousValue = children.every((child) => child.previousClose != null)
    ? children.reduce((sum, child) => sum + ((child.previousClose ?? 0) * child.quantity), 0)
    : null;
  const change = sumAllOrNull(children.map((child) => child.change));

  return {
    ...group,
    quantity,
    accountCount: children.length,
    averageCostPerShare: quantity > 0
      ? children.reduce((sum, child) => sum + (child.averageCostPerShare * child.quantity), 0) / quantity
      : 0,
    currentUnitPrice: firstNumber(children.map((child) => child.currentUnitPrice)),
    costBasisAmount,
    marketValueAmount: sumAllOrNull(children.map((child) => child.marketValueAmount)),
    unrealizedPnlAmount: sumAllOrNull(children.map((child) => child.unrealizedPnlAmount)),
    change,
    changePercent: change != null && previousValue != null && previousValue > 0 ? (change / previousValue) * 100 : null,
    previousClose: previousValue != null && previousValue > 0 && quantity > 0 ? previousValue / quantity : null,
    quoteStatus: resolveQuoteStatus(children.map((child) => child.quoteStatus)),
    nextDividendDate: children
      .map((child) => child.nextDividendDate)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null,
    lastDividendPostedDate: children
      .map((child) => child.lastDividendPostedDate)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
    priceState: aggregatePriceState(children),
    reportingCurrentUnitPrice: firstNumber(children.map((child) => child.reportingCurrentUnitPrice)),
    reportingCostBasisAmount: sumAllOrNull(children.map((child) => child.reportingCostBasisAmount)),
    reportingMarketValueAmount: sumAllOrNull(children.map((child) => child.reportingMarketValueAmount)),
    reportingUnrealizedPnlAmount: sumAllOrNull(children.map((child) => child.reportingUnrealizedPnlAmount)),
    reportingDailyChangeAmount: sumAllOrNull(children.map((child) => child.reportingDailyChangeAmount)),
    fxStatus: resolveFxStatus(children.map((child) => child.fxStatus)),
    children,
  };
}

function recalculateHoldingGroupAllocations(
  groups: DashboardOverviewHoldingGroupDto[],
): DashboardOverviewHoldingGroupDto[] {
  const hasCompleteMarketValues = groups.length > 0 && groups.every((group) => group.reportingMarketValueAmount != null);
  const hasCompleteCostBasis = groups.length > 0 && groups.every((group) => group.reportingCostBasisAmount != null);
  const totalReportingMarket = hasCompleteMarketValues
    ? groups.reduce((sum, group) => sum + (group.reportingMarketValueAmount ?? 0), 0)
    : 0;
  const totalReportingCost = hasCompleteCostBasis
    ? groups.reduce((sum, group) => sum + (group.reportingCostBasisAmount ?? 0), 0)
    : 0;
  return groups.map((group) => {
    const reportingAllocationPercent = hasCompleteMarketValues && totalReportingMarket > 0 && group.reportingMarketValueAmount != null
      ? (group.reportingMarketValueAmount / totalReportingMarket) * 100
      : hasCompleteCostBasis && totalReportingCost > 0 && group.reportingCostBasisAmount != null
        ? (group.reportingCostBasisAmount / totalReportingCost) * 100
        : null;
    return {
      ...group,
      allocationPct: reportingAllocationPercent,
      reportingAllocationPercent,
      children: group.children.map((child) => ({
        ...child,
        reportingAllocationPercent: hasCompleteMarketValues && totalReportingMarket > 0 && child.reportingMarketValueAmount != null
          ? (child.reportingMarketValueAmount / totalReportingMarket) * 100
          : hasCompleteCostBasis && totalReportingCost > 0 && child.reportingCostBasisAmount != null
            ? (child.reportingCostBasisAmount / totalReportingCost) * 100
            : null,
      })),
    };
  });
}

function resolveFxStatus(
  items: Array<DashboardOverviewHoldingChildDto["fxStatus"]>,
): DashboardOverviewHoldingChildDto["fxStatus"] {
  if (items.every((status) => status === "complete")) return "complete";
  if (items.includes("missing")) return "missing";
  return "partial";
}

function sumAllOrNull(values: Array<number | null | undefined>): number | null {
  if (values.length === 0 || values.some((value) => value == null)) return null;
  return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

function firstNumber(values: Array<number | null | undefined>): number | null {
  return values.find((value): value is number => typeof value === "number") ?? null;
}

function buildHoldingFxRows(
  groups: DashboardOverviewHoldingGroupDto[],
  rates: FxConversionRateDto[],
  reportingCurrency: AccountDefaultCurrency,
): Array<{
  asOf: string | null;
  fromCurrency: CurrencyCode;
  holdingCount: number;
  rate: number | null;
  toCurrency: AccountDefaultCurrency;
}> {
  const counts = new Map<CurrencyCode, number>();
  for (const group of groups) {
    if (group.currency === reportingCurrency) continue;
    counts.set(group.currency, (counts.get(group.currency) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([fromCurrency, holdingCount]) => {
      const fxRate = rates.find((rate) => rate.fromCurrency === fromCurrency && rate.toCurrency === reportingCurrency);
      return {
        asOf: fxRate?.asOf ?? null,
        fromCurrency,
        holdingCount,
        rate: fxRate?.rate ?? null,
        toCurrency: reportingCurrency,
      };
    })
    .sort((left, right) => left.fromCurrency.localeCompare(right.fromCurrency));
}

function holdingPresetLabel(dict: ReturnType<typeof getDictionary>, preset: DashboardHoldingFocusPreset): string {
  switch (preset) {
    case "largest":
      return dict.dashboardHome.topHoldingsPresetLargest;
    case "highest-allocation":
      return dict.dashboardHome.topHoldingsPresetHighestAllocation;
    case "worst-pnl":
      return dict.dashboardHome.topHoldingsPresetWorstPnl;
    case "best-pnl":
      return dict.dashboardHome.topHoldingsPresetBestPnl;
    case "fx-exposure":
      return dict.dashboardHome.topHoldingsPresetFxExposure;
    case "stale-quotes":
      return dict.dashboardHome.topHoldingsPresetStaleQuotes;
  }
}

function formatTopHoldingsMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, value),
    template,
  );
}

function hasIncompleteDashboardValuation(group: DashboardOverviewHoldingGroupDto): boolean {
  return group.quoteStatus !== "current"
    || group.fxStatus !== "complete"
    || group.reportingMarketValueAmount === null;
}

function formatAffectedDashboardTickers(
  dict: ReturnType<typeof getDictionary>,
  locale: LocaleCode,
  groups: DashboardOverviewHoldingGroupDto[],
): string {
  const tickers = groups.map((group) => `${group.ticker} (${group.marketCode})`);
  if (tickers.length <= 3) return tickers.join(", ");
  const visible = tickers.slice(0, 3);
  visible.push(
    formatTopHoldingsMessage(dict.dashboardHome.missingValuationMoreHoldings, {
      count: formatNumber(tickers.length - 3, locale),
    }),
  );
  return visible.join(", ");
}

function getDailyMetric(
  dict: ReturnType<typeof getDictionary>,
  group: DashboardOverviewHoldingGroupDto,
  locale: LocaleCode,
): { exactValue?: string; title?: string; toneValue: number | null; value: string } {
  if (group.quoteStatus === "missing") {
    return {
      toneValue: null,
      value: dict.dashboardHome.quoteStatusMissing,
    };
  }

  const suffix = group.quoteStatus === "provisional" ? " \u23f1" : "";
  return {
    title: group.change === null ? undefined : formatCurrencyAmount(group.change, group.currency, locale),
    toneValue: group.change ?? group.changePercent,
    value: `${group.changePercent === null ? "-" : formatSignedPercent(group.changePercent, locale)}${suffix}`,
    exactValue:
      group.reportingDailyChangeAmount == null
        ? undefined
        : formatFinanceCurrencyAmount(group.reportingDailyChangeAmount, group.reportingCurrency, locale),
  };
}

function findFxRate(
  rates: FxConversionRateDto[],
  fromCurrency: string,
  toCurrency: AccountDefaultCurrency,
): number | null {
  if (fromCurrency === toCurrency) return 1;
  return rates.find((rate) => rate.fromCurrency === fromCurrency && rate.toCurrency === toCurrency)?.rate ?? null;
}

function getReportingUnitPrice(
  group: DashboardOverviewHoldingGroupDto,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  const explicitReportingUnitPrice = getExplicitReportingUnitPrice(group, reportingCurrency);
  if (explicitReportingUnitPrice !== null) return explicitReportingUnitPrice;
  if (group.reportingCurrency !== reportingCurrency) return null;
  if (group.reportingMarketValueAmount === null || group.quantity <= 0) return null;
  return group.reportingMarketValueAmount / group.quantity;
}

function getExplicitReportingUnitPrice(
  group: DashboardOverviewHoldingGroupDto,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  if (group.reportingCurrency !== reportingCurrency) return null;
  const candidate = group.reportingCurrentUnitPrice;
  return typeof candidate === "number" ? candidate : null;
}

function getReportingChildUnitPrice(
  child: DashboardOverviewHoldingChildDto,
  reportingCurrency: AccountDefaultCurrency,
): number | null {
  if (child.reportingCurrency !== reportingCurrency) return null;
  if (typeof child.reportingCurrentUnitPrice === "number") return child.reportingCurrentUnitPrice;
  if (child.reportingMarketValueAmount === null || child.quantity <= 0) return null;
  return child.reportingMarketValueAmount / child.quantity;
}

function getReportingDailyMove(
  row: Pick<DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto, "reportingDailyChangeAmount">,
): number | null {
  return row.reportingDailyChangeAmount ?? null;
}

function getReportingAverageCost(costBasisAmount: number | null, quantity: number): number | null {
  if (costBasisAmount === null || quantity <= 0) return null;
  return costBasisAmount / quantity;
}

function formatFxRate(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 6,
  }).format(value);
}

function formatUnitPrice(value: number, currency: CurrencyCode, locale: LocaleCode): string {
  const intlLocale = locale === "zh-TW" ? "zh-TW" : "en-US";
  return new Intl.NumberFormat(intlLocale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
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

function formatSignedPercent(value: number, locale: LocaleCode): string {
  const formatted = formatPercent(Math.abs(value), locale);
  if (value > 0) return `+${formatted}`;
  if (value < 0) return `-${formatted}`;
  return formatted;
}
