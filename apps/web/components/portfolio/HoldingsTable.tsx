"use client";

import React, { useDeferredValue, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import * as Tooltip from "@radix-ui/react-tooltip";
import type {
  AccountDto,
  AccountDefaultCurrency,
  DashboardOverviewHoldingDto,
  HoldingsSortField,
  InstrumentOptionDto,
  LocaleCode,
} from "@vakwen/shared-types";
import { Building2, ChevronDown, ChevronRight, Search, SlidersHorizontal } from "lucide-react";
import type { AppDictionary } from "../../lib/i18n";
import { getDashboardReportingAverageCost, getDashboardUnitPnl, getNativeUnitPnl } from "../../lib/holdingsMetrics";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber, formatPercent } from "../../lib/utils";
import { buildAllocationPercentages, getAmountForAllocationBasis, resolveHoldingGroups, type DashboardOverviewHoldingChildDto, type DashboardOverviewHoldingGroupDto, type HoldingAllocationBasis } from "../../features/portfolio/holdingGroups";
import { useHoldingAllocationBasis } from "../../features/portfolio/hooks/useHoldingAllocationBasis";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { RollingNumber } from "../ui/RollingNumber";
import { fieldClassName } from "../ui/fieldStyles";
import { Checkbox } from "../ui/shadcn/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../ui/shadcn/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/shadcn/select";
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
  type HoldingsColumnSettingsState,
  type HoldingsGridColumnDefinition,
} from "../holdings/HoldingsColumnSettings";
import { sortHoldingsRows, type HoldingsSortPrimitive } from "../holdings/holdingsSorting";
import { HoldingsDataHealthBadges } from "../holdings/HoldingsDataHealth";
import {
  HoldingsSelectionInlineToggle,
  HoldingsSelectionSummaryStrip,
  HoldingsSelectionToolbar,
} from "../holdings/HoldingsSelectionControls";
import {
  HoldingsGridDesktopFrame,
  HoldingsGridEmptyState,
  HoldingsGridMobileList,
  HoldingsGridNativeTable,
} from "../holdings/HoldingsGrid";
import { CalendarUnknownWarnings } from "../holdings/CalendarUnknownWarnings";
import { PriceStateChip } from "../holdings/PriceStateChip";
import { buildHoldingsSelectionVisibleSummary } from "../holdings/holdingsSelectionSummary";
import { holdingsFinanceToneClass, holdingsStickyFirstColumnClassName } from "../holdings/holdingsStyle";
import { buildHoldingsTickerId } from "../holdings/holdingsPreferenceHelpers";
import { HoldingsDetailSheet } from "../holdings/HoldingsDetailSheet";
import { useHoldingsSelection } from "../holdings/useHoldingsSelection";
import { HoldingActivityDetail } from "../holdings/HoldingActivityDetail";
import { resolveCurrentHoldingDetail } from "../../features/portfolio/holdingDetailRow";
import { buildPriceStateActivityPath, getPriceState, priceStateSortRank } from "../../features/price-state/priceState";

type HoldingsDisplayMode = "aggregated" | "expanded" | "accounts";
type DetailHoldingRow = DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto;
type HoldingsColumn =
  | "ticker"
  | "accounts"
  | "quantity"
  | "averageCost"
  | "unitPnl"
  | "price"
  | "dailyChange"
  | "marketValue"
  | "unrealizedPnl"
  | "dataHealth"
  | "costBasis"
  | "allocation"
  | "nextDividendDate"
  | "lastDividendDate";

interface HoldingsTableProps {
  holdings: DashboardOverviewHoldingDto[];
  holdingGroups?: DashboardOverviewHoldingGroupDto[];
  instruments?: InstrumentOptionDto[];
  accounts?: AccountDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  recomputingSymbols?: Set<string>;
  showFreshnessBadge?: boolean;
  showAdminActivityLinks?: boolean;
  quoteRefreshVersion?: number;
  variant?: "default" | "compact";
  allocationBasis?: HoldingAllocationBasis;
  onAllocationBasisChange?: (basis: HoldingAllocationBasis) => void;
  settingsContextKey?: string;
  enableSelectionWorkflow?: boolean;
  enableLayoutStyleToggle?: boolean;
}

const PORTFOLIO_HOLDINGS_COLUMNS: Array<HoldingsGridColumnDefinition<HoldingsColumn>> = [
  { id: "ticker", label: "Ticker", defaultWidth: 224, canHide: false, sortField: "ticker" },
  { id: "accounts", label: "Accounts", defaultWidth: 112, align: "right", sortField: "accountCount" },
  { id: "quantity", label: "Quantity", defaultWidth: 128, canHide: false, align: "right", sortField: "quantity" },
  { id: "averageCost", label: "Average cost", defaultWidth: 144, align: "right", sortField: "averageCost" },
  { id: "unitPnl", label: "Unit P&L", defaultWidth: 152, align: "right", sortField: "unitPnl" },
  { id: "price", label: "Price", defaultWidth: 144, align: "right", sortField: "price" },
  { id: "dailyChange", label: "Daily change", defaultWidth: 144, align: "right", sortField: "dailyChangePercent" },
  { id: "marketValue", label: "Market value", defaultWidth: 160, align: "right", sortField: "marketValue" },
  { id: "unrealizedPnl", label: "Unrealized P&L", defaultWidth: 144, align: "right", sortField: "unrealizedPnl" },
  { id: "dataHealth", label: "Data health", defaultWidth: 192, sortField: "dataHealth" },
  { id: "costBasis", label: "Cost basis", defaultWidth: 160, align: "right", sortField: "costBasis" },
  { id: "allocation", label: "Allocation", defaultWidth: 148, align: "right", sortField: "allocation" },
  { id: "nextDividendDate", label: "Next dividend", defaultWidth: 152, align: "right", sortField: "nextDividendDate" },
  { id: "lastDividendDate", label: "Last dividend", defaultWidth: 152, align: "right", sortField: "lastDividendDate" },
];
const PORTFOLIO_DETAILED_MIN_COLUMN_WIDTHS: Record<HoldingsColumn, number> = {
  ticker: 224,
  accounts: 160,
  quantity: 160,
  averageCost: 192,
  unitPnl: 160,
  price: 144,
  dailyChange: 192,
  marketValue: 192,
  unrealizedPnl: 224,
  dataHealth: 192,
  costBasis: 176,
  allocation: 168,
  nextDividendDate: 200,
  lastDividendDate: 192,
};
const PORTFOLIO_MOBILE_FIELD_COLUMNS: HoldingsColumn[] = [
  "accounts",
  "quantity",
  "averageCost",
  "unitPnl",
  "price",
  "dailyChange",
  "marketValue",
  "unrealizedPnl",
  "dataHealth",
  "costBasis",
  "allocation",
  "nextDividendDate",
  "lastDividendDate",
];
const PORTFOLIO_SUPPORTED_SORT_FIELDS = PORTFOLIO_HOLDINGS_COLUMNS.flatMap((column) => column.sortField ? [column.sortField] : []);
const MAX_ANIMATED_HOLDING_VALUE_ROWS = 8;

const PORTFOLIO_COMPACT_DEFAULT_HIDDEN_COLUMNS: HoldingsColumn[] = [];
const PORTFOLIO_DETAILED_DEFAULT_HIDDEN_COLUMNS: HoldingsColumn[] = ["averageCost", "unitPnl"];
const SHARED_HOLDINGS_SETTINGS_CONTEXT_KEY = "holdings.shared";

function isHoldingsDisplayMode(value: string): value is HoldingsDisplayMode {
  return value === "aggregated" || value === "expanded" || value === "accounts";
}

export function holdingGroupMatchesStatusFilter(
  group: DashboardOverviewHoldingGroupDto,
  selectedStatuses: DashboardOverviewHoldingDto["quoteStatus"][],
  displayMode: HoldingsDisplayMode,
): boolean {
  if (selectedStatuses.length === 0) return true;
  if (displayMode === "aggregated") return selectedStatuses.includes(group.quoteStatus);
  return group.children.some((child) => selectedStatuses.includes(child.quoteStatus));
}

function isHoldingAllocationBasis(value: string): value is HoldingAllocationBasis {
  return value === "market_value" || value === "cost_basis";
}
const toolbarButtonClassName = "inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-foreground transition hover:bg-muted";

function groupLinkHref(group: DashboardOverviewHoldingGroupDto) {
  return `/tickers/${encodeURIComponent(group.ticker)}?marketCode=${encodeURIComponent(group.marketCode)}`;
}

function holdingGroupRowId(group: { ticker: string; marketCode: string }) {
  return `${group.marketCode}:${group.ticker}`;
}

function childLinkHref(child: DashboardOverviewHoldingChildDto) {
  return `/tickers/${encodeURIComponent(child.ticker)}?marketCode=${encodeURIComponent(child.marketCode)}&accountId=${encodeURIComponent(child.accountId)}`;
}

function holdingMatchesQuery(group: DashboardOverviewHoldingGroupDto, query: string): boolean {
  if (!query) return true;
  const normalized = query.toUpperCase();
  if (group.ticker.toUpperCase().includes(normalized) || group.marketCode.toUpperCase().includes(normalized)) {
    return true;
  }

  return group.children.some((child) =>
    (child.accountName ?? child.accountId).toUpperCase().includes(normalized)
    || child.accountId.toUpperCase().includes(normalized),
  );
}

function hasRecomputingChild(group: DashboardOverviewHoldingGroupDto, recomputingSymbols?: Set<string>): boolean {
  if (!recomputingSymbols) return false;
  return group.children.some((child) => recomputingSymbols.has(`${child.accountId}:${child.ticker}`));
}

function getStatusLabel(dict: AppDictionary, status: DashboardOverviewHoldingDto["quoteStatus"]) {
  if (status === "current") return dict.holdings.statusCurrent;
  if (status === "provisional") return dict.holdings.statusProvisional;
  return dict.holdings.statusMissing;
}

export function HoldingsTable({
  holdings,
  holdingGroups,
  instruments = [],
  accounts = [],
  dict,
  locale,
  recomputingSymbols,
  showFreshnessBadge = true,
  showAdminActivityLinks = false,
  quoteRefreshVersion = 0,
  variant = "default",
  allocationBasis,
  onAllocationBasisChange,
  settingsContextKey = SHARED_HOLDINGS_SETTINGS_CONTEXT_KEY,
  enableSelectionWorkflow = false,
  enableLayoutStyleToggle = false,
}: HoldingsTableProps) {
  const { allocationBasis: storedBasis, setAllocationBasis: setStoredBasis } = useHoldingAllocationBasis();
  const effectiveAllocationBasis = allocationBasis ?? storedBasis;
  const setEffectiveAllocationBasis = onAllocationBasisChange ?? setStoredBasis;

  const [query, setQuery] = useState("");
  const [displayMode, setDisplayMode] = useState<HoldingsDisplayMode>("aggregated");
  const [selectedStatuses, setSelectedStatuses] = useState<DashboardOverviewHoldingDto["quoteStatus"][]>([]);
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(new Set());
  const [selectedHolding, setSelectedHolding] = useState<DetailHoldingRow | null>(null);
  const deferredQuery = useDeferredValue(query);
  const portfolioHoldingColumns = useMemo(
    () => PORTFOLIO_HOLDINGS_COLUMNS.map((column) => ({
      ...column,
      label: portfolioColumnLabel(dict, column.id),
    })),
    [dict],
  );
  const columnSettings = useHoldingsColumnSettings<HoldingsColumn>({
    columns: portfolioHoldingColumns,
    contextKey: settingsContextKey,
    defaultLayoutStyle: variant === "compact" ? "dashboard" : "portfolio",
    defaultHiddenColumns: variant === "compact" ? PORTFOLIO_COMPACT_DEFAULT_HIDDEN_COLUMNS : PORTFOLIO_DETAILED_DEFAULT_HIDDEN_COLUMNS,
    defaultSort: variant === "compact"
      ? { sortMode: "field", sortField: "marketValue", sortDirection: "desc" }
      : { sortMode: "custom" },
    mobileSummaryColumnIds: PORTFOLIO_MOBILE_FIELD_COLUMNS,
    supportedSortFields: PORTFOLIO_SUPPORTED_SORT_FIELDS,
  });
  const visibleColumnDefs = columnSettings.orderedColumns.filter((column) => columnSettings.visibleColumns.includes(column.id));
  const visibleColumns = visibleColumnDefs.map((column) => column.id);
  const detailedDesktopTableMinWidth = variant === "default"
    ? visibleColumns.reduce((total, column) => total + portfolioDetailedColumnWidth(columnSettings, column), 0)
    : undefined;
  const mobileColumnSplit = splitMobileHoldingColumns(columnSettings, PORTFOLIO_MOBILE_FIELD_COLUMNS);
  const visibleSortFields = useMemo(
    () => visibleColumnDefs.flatMap((column) => column.sortField ? [column.sortField] : []),
    [visibleColumnDefs],
  );

  const groups = useMemo(
    () => resolveHoldingGroups({ holdings, holdingGroups, instruments, accounts }),
    [accounts, holdingGroups, holdings, instruments],
  );

  const marketOptions = useMemo(
    () => [...new Set(groups.map((group) => group.marketCode))],
    [groups],
  );

  const accountOptions = useMemo(
    () => groups.flatMap((group) => group.children).reduce<Array<{ id: string; label: string }>>((acc, child) => {
      if (acc.some((entry) => entry.id === child.accountId)) return acc;
      acc.push({ id: child.accountId, label: child.accountName?.trim() || child.accountId });
      return acc;
    }, []),
    [groups],
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
  const accountOptionIds = useMemo(() => accountOptions.map((option) => option.id), [accountOptions]);
  const selectedMarketCodes = useMemo(
    () => filterAvailableHoldingsSelections(columnSettings.selectedMarketCodes, marketOptions),
    [columnSettings.selectedMarketCodes, marketOptions],
  );
  const selectedAccountIds = useMemo(
    () => filterAvailableHoldingsSelections(columnSettings.selectedAccountIds, accountOptionIds),
    [accountOptionIds, columnSettings.selectedAccountIds],
  );

  const filteredGroups = useMemo(() => {
    return groups.filter((group) => {
      const groupTickerId = buildHoldingsTickerId(group.marketCode, group.ticker);
      if (
        enableSelectionWorkflow
        && holdingsSelection.selectionMode !== "all"
        && !holdingsSelection.selectedTickerIdSet.has(groupTickerId)
      ) {
        return false;
      }
      if (selectedMarketCodes.length > 0 && !selectedMarketCodes.includes(group.marketCode)) return false;
      if (!holdingGroupMatchesStatusFilter(group, selectedStatuses, displayMode)) return false;
      if (selectedAccountIds.length > 0 && !group.children.some((child) => selectedAccountIds.includes(child.accountId))) return false;
      return holdingMatchesQuery(group, deferredQuery.trim());
    });
  }, [
    deferredQuery,
    displayMode,
    enableSelectionWorkflow,
    groups,
    holdingsSelection.selectedTickerIdSet,
    holdingsSelection.selectionMode,
    selectedAccountIds,
    selectedMarketCodes,
    selectedStatuses,
  ]);

  const projectedGroups = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toUpperCase();
    return filteredGroups.flatMap((group) => {
      const groupIdentityMatchesQuery = normalizedQuery.length > 0
        && (group.ticker.toUpperCase().includes(normalizedQuery)
          || group.marketCode.toUpperCase().includes(normalizedQuery));
      const visibleChildren = group.children.filter((child) => {
        if (selectedAccountIds.length > 0 && !selectedAccountIds.includes(child.accountId)) return false;
        if (
          displayMode !== "aggregated"
          && selectedStatuses.length > 0
          && !selectedStatuses.includes(child.quoteStatus)
        ) return false;
        return !normalizedQuery
          || groupIdentityMatchesQuery
          || child.ticker.toUpperCase().includes(normalizedQuery)
          || (child.accountName ?? child.accountId).toUpperCase().includes(normalizedQuery)
          || child.accountId.toUpperCase().includes(normalizedQuery);
      });
      return group.children.length > 0 && visibleChildren.length === 0
        ? []
        : [projectPortfolioHoldingGroup(group, visibleChildren)];
    });
  }, [deferredQuery, displayMode, filteredGroups, selectedAccountIds, selectedStatuses]);

  const groupAllocationMap = useMemo(
    () => buildAllocationPercentages(projectedGroups, effectiveAllocationBasis),
    [effectiveAllocationBasis, projectedGroups],
  );

  const projectedChildRows = useMemo(() => projectedGroups.flatMap((group) => group.children), [projectedGroups]);
  const childAllocationMap = useMemo(() => {
    const values = projectedChildRows.map((child) => ({
      key: `${child.accountId}:${child.ticker}:${child.marketCode}`,
      ...getAmountForAllocationBasis(child, effectiveAllocationBasis),
    }));
    const total = values.reduce((sum, value) => sum + value.amount, 0);
    return new Map(values.map((value) => [value.key, total > 0 ? (value.amount / total) * 100 : 0]));
  }, [effectiveAllocationBasis, projectedChildRows]);

  const orderedFilteredGroups = useMemo(() => {
    const ordered = displayMode !== "accounts"
      && columnSettings.sortMode === "field"
      && columnSettings.sortField
      && columnSettings.sortDirection
      ? sortHoldingsRows({
          rows: projectedGroups,
          field: columnSettings.sortField,
          direction: columnSettings.sortDirection,
          extractKey: (group, field) => portfolioHoldingSortKey(
            group,
            field,
            groupAllocationMap.get(`${group.ticker}::${group.marketCode}`) ?? null,
          ),
          getIdentity: (group) => ({ ticker: group.ticker, marketCode: group.marketCode }),
        })
      : applyHoldingsRowOrder(projectedGroups, holdingGroupRowId, columnSettings.rowOrder);

    if (displayMode !== "expanded") return ordered;
    return ordered.map((group) => ({
      ...group,
      children: columnSettings.sortMode === "field" && columnSettings.sortField && columnSettings.sortDirection
        ? sortHoldingsRows({
            rows: group.children,
            field: columnSettings.sortField,
            direction: columnSettings.sortDirection,
            extractKey: (child, field) => portfolioHoldingSortKey(
              child,
              field,
              childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null,
            ),
            getIdentity: (child) => ({ ticker: child.ticker, marketCode: child.marketCode, accountId: child.accountId }),
          })
        : sortPortfolioAccountHoldings(group.children),
    }));
  }, [
    childAllocationMap,
    columnSettings.rowOrder,
    columnSettings.sortDirection,
    columnSettings.sortField,
    columnSettings.sortMode,
    displayMode,
    groupAllocationMap,
    projectedGroups,
  ]);

  const visibleGroupKeys = useMemo(
    () => new Set(orderedFilteredGroups.map((group) => `${group.ticker}::${group.marketCode}`)),
    [orderedFilteredGroups],
  );

  const expandedState = useMemo(() => {
    if (displayMode === "expanded") {
      return visibleGroupKeys;
    }
    return expandedKeys;
  }, [displayMode, expandedKeys, visibleGroupKeys]);

  const visibleChildRows = useMemo(() => {
    const rows = orderedFilteredGroups.flatMap((group) => group.children);
    if (displayMode !== "accounts") return rows;
    return columnSettings.sortMode === "field" && columnSettings.sortField && columnSettings.sortDirection
      ? sortHoldingsRows({
          rows,
          field: columnSettings.sortField,
          direction: columnSettings.sortDirection,
          extractKey: (child, field) => portfolioHoldingSortKey(
            child,
            field,
            childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null,
          ),
          getIdentity: (child) => ({ ticker: child.ticker, marketCode: child.marketCode, accountId: child.accountId }),
        })
      : orderedFilteredGroups.flatMap((group) => sortPortfolioAccountHoldings(group.children));
  }, [
    childAllocationMap,
    columnSettings.sortDirection,
    columnSettings.sortField,
    columnSettings.sortMode,
    displayMode,
    orderedFilteredGroups,
  ]);
  const selectionSummary = useMemo(
    () => buildHoldingsSelectionVisibleSummary({
      mode: holdingsSelection.selectionMode,
      rows: displayMode === "accounts" ? visibleChildRows : orderedFilteredGroups,
      selectedTickerIds: holdingsSelection.selectedTickerIds,
      universeTickerIds: holdingsSelection.universeTickerIds,
    }),
    [
      displayMode,
      holdingsSelection.selectedTickerIds,
      holdingsSelection.selectionMode,
      holdingsSelection.universeTickerIds,
      orderedFilteredGroups,
      visibleChildRows,
    ],
  );
  const layoutStyle = columnSettings.layoutStyle;

  function toggleGroup(key: string) {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  function toggleStatus(status: DashboardOverviewHoldingDto["quoteStatus"]) {
    setSelectedStatuses((current) =>
      current.includes(status) ? current.filter((item) => item !== status) : [...current, status],
    );
  }

  function toggleMarket(marketCode: string) {
    columnSettings.setSelectedMarketCodes(
      selectedMarketCodes.includes(marketCode)
        ? selectedMarketCodes.filter((item) => item !== marketCode)
        : [...selectedMarketCodes, marketCode],
    );
  }

  function toggleAccount(accountId: string) {
    columnSettings.setSelectedAccountIds(
      selectedAccountIds.includes(accountId)
        ? selectedAccountIds.filter((item) => item !== accountId)
        : [...selectedAccountIds, accountId],
    );
  }

  const visibleGroupCountLabel = dict.holdings.showingTickers
    .replace("{visible}", String(orderedFilteredGroups.length))
    .replace("{total}", String(groups.length));
  const marketFilterSummary = selectedMarketCodes.length === 0
    ? dict.holdings.allMarketsOption
    : selectedMarketCodes.length === 1
      ? selectedMarketCodes[0]!
      : `${selectedMarketCodes.length} ${dict.holdings.marketFilterLabel}`;

  return (
    <Tooltip.Provider delayDuration={150}>
      <Card data-testid="portfolio-holdings-section">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-[0.22em] text-primary/78">{dict.holdings.title}</p>
              <h2 className="mt-2 text-2xl text-foreground sm:text-3xl">{dict.holdings.title}</h2>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{dict.holdings.description}</p>
            </div>
            <div className="text-sm text-muted-foreground">{visibleGroupCountLabel}</div>
          </div>

          <div className="grid items-start gap-3 xl:grid-cols-[minmax(220px,1.2fr)_auto_auto_auto_auto_auto] lg:grid-cols-[minmax(220px,1fr)_auto_auto_auto]">
            <label className="relative block min-w-0 self-start">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">{dict.dashboardHome.holdingsSearchPlaceholder}</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={dict.dashboardHome.holdingsSearchPlaceholder}
                className={cn(fieldClassName, "!pl-10")}
                data-testid="holdings-filter-input"
              />
            </label>

            <div className="min-w-0">
              <span className="sr-only">{dict.holdings.displayModeLabel}</span>
              <Select
                value={displayMode}
                onValueChange={(value) => {
                  if (isHoldingsDisplayMode(value)) setDisplayMode(value);
                }}
              >
                <SelectTrigger aria-label={dict.holdings.displayModeLabel} className="w-full" data-testid="holdings-display-mode-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="aggregated" data-testid="holdings-display-mode-aggregated">
                      {dict.holdings.displayModeAggregated}
                    </SelectItem>
                    <SelectItem value="expanded" data-testid="holdings-display-mode-expanded">
                      {dict.holdings.displayModeExpanded}
                    </SelectItem>
                    <SelectItem value="accounts" data-testid="holdings-display-mode-accounts">
                      {dict.holdings.displayModeAccounts}
                    </SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-market">
                  {dict.holdings.marketFilterLabel}: {marketFilterSummary}
                  <ChevronDown />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{dict.holdings.marketFilterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedMarketCodes.length === 0}
                      onCheckedChange={() => columnSettings.setSelectedMarketCodes([])}
                    />
                    {dict.holdings.allMarketsOption}
                  </label>
                </div>
                {marketOptions.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option}
                    checked={selectedMarketCodes.includes(option)}
                    onSelect={(event) => event.preventDefault()}
                    onCheckedChange={() => toggleMarket(option)}
                  >
                    {option}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-account">
                  <Building2 className="size-4" />
                  {dict.holdings.accountFilterLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>{dict.holdings.accountFilterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedAccountIds.length === 0}
                      onCheckedChange={() => columnSettings.setSelectedAccountIds([])}
                    />
                    {dict.holdings.allAccountsOption}
                  </label>
                </div>
                {accountOptions.map((option) => (
                  <div key={option.id} className="px-2 py-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedAccountIds.includes(option.id)}
                        onCheckedChange={() => toggleAccount(option.id)}
                      />
                      {option.label}
                    </label>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={toolbarButtonClassName} data-testid="holdings-filter-status">
                  <SlidersHorizontal className="size-4" />
                  {dict.holdings.statusFilterLabel}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuLabel>{dict.holdings.statusFilterLabel}</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <div className="px-2 py-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selectedStatuses.length === 0}
                      onCheckedChange={() => setSelectedStatuses([])}
                    />
                    {dict.holdings.allStatusesOption}
                  </label>
                </div>
                {(["current", "provisional", "missing"] as const).map((status) => (
                  <div key={status} className="px-2 py-1.5">
                    <label className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={selectedStatuses.includes(status)}
                        onCheckedChange={() => toggleStatus(status)}
                      />
                      {getStatusLabel(dict, status)}
                    </label>
                  </div>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {enableSelectionWorkflow ? (
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
              ) : null}
              <div data-testid="holdings-filter-columns">
                <HoldingsColumnSettingsMenu
                  dict={dict}
                  enableLayoutStyle={enableLayoutStyleToggle}
                  getColumnLabel={(column) => portfolioColumnLabel(dict, column.id)}
                  settings={columnSettings}
                />
              </div>
              <HoldingsRowSettingsMenu
                dict={dict}
                rows={orderedFilteredGroups.map((group) => ({
                  id: holdingGroupRowId(group),
                  label: group.ticker,
                  description: group.instrumentName ? `${group.marketCode} · ${group.instrumentName}` : group.marketCode,
                }))}
                settings={columnSettings}
              />

              <div className="min-w-0">
                <span className="text-sm text-muted-foreground">{dict.dashboardHome.allocationBasisLabel}</span>
                <Select
                  value={effectiveAllocationBasis}
                  onValueChange={(value) => {
                    if (isHoldingAllocationBasis(value)) setEffectiveAllocationBasis(value);
                  }}
                >
                  <SelectTrigger aria-label={dict.dashboardHome.allocationBasisLabel} className="mt-2 w-full" data-testid="holdings-allocation-basis-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="market_value" data-testid="holdings-allocation-basis-market-value">
                        {dict.dashboardHome.allocationBasisMarketValue}
                      </SelectItem>
                      <SelectItem value="cost_basis" data-testid="holdings-allocation-basis-cost-basis">
                        {dict.dashboardHome.allocationBasisCostBasis}
                      </SelectItem>
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 lg:hidden">
          <HoldingsMobileSortControls columns={portfolioHoldingColumns} dict={dict} settings={columnSettings} />
        </div>
        <div className="mt-4 hidden lg:flex">
          <HoldingsHiddenSortChip
            columns={portfolioHoldingColumns}
            dict={dict}
            settings={columnSettings}
            visibleSortFields={visibleSortFields}
          />
        </div>
        {columnSettings.settingsError ? (
          <p className="mt-3 text-sm text-destructive" data-testid="holdings-settings-error">
            {columnSettings.settingsError}
          </p>
        ) : null}

        {enableSelectionWorkflow ? (
          <div className="mt-4 space-y-2">
            {holdingsSelection.selectionError ? (
              <p className="text-sm text-destructive" data-testid="holdings-selection-error">{holdingsSelection.selectionError}</p>
            ) : null}
            <HoldingsSelectionSummaryStrip
              dict={dict}
              locale={locale}
              reportingCurrency={groups[0]?.reportingCurrency ?? "TWD"}
              summary={selectionSummary}
            />
          </div>
        ) : null}

        {orderedFilteredGroups.length === 0 ? (
          <HoldingsGridEmptyState className="mt-6 rounded-xl bg-muted/30 px-5">
            {holdingsSelection.selectionMode === "none" ? dict.holdings.noneResults : dict.holdings.noResults}
          </HoldingsGridEmptyState>
        ) : (
          <>
            <CalendarUnknownWarnings className="mt-6" dict={dict} rows={orderedFilteredGroups} />
            <HoldingsGridMobileList className={cn("mt-6", layoutStyle === "dashboard" ? "[&_div[data-testid^='holding-']]:gap-1.5" : undefined)} testId="holdings-mobile-list">
              {displayMode === "accounts"
                ? visibleChildRows.map((child, index) => {
                  const childTickerId = buildHoldingsTickerId(child.marketCode, child.ticker);
                  return (
                    <HoldingChildMobileCard
                      key={`${child.accountId}:${child.ticker}:${child.marketCode}`}
                      child={child}
                      dict={dict}
                      locale={locale}
                      allocationPercent={childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null}
                      allocationBasis={effectiveAllocationBasis}
                      detailColumns={mobileColumnSplit.detailColumns}
                      nested={false}
                      showFreshnessBadge={showFreshnessBadge}
                      showSelectionControl={enableSelectionWorkflow}
                      selectionChecked={enableSelectionWorkflow && holdingsSelection.isTickerSelected(childTickerId)}
                      onToggleSelection={() => holdingsSelection.toggleTicker(childTickerId)}
                      onOpenDetail={() => setSelectedHolding(child)}
                      summaryColumns={mobileColumnSplit.summaryColumns}
                      quoteRefreshVersion={index < MAX_ANIMATED_HOLDING_VALUE_ROWS ? quoteRefreshVersion : 0}
                    />
                  );
                })
                : orderedFilteredGroups.map((group, index) => {
                  const groupKey = `${group.ticker}::${group.marketCode}`;
                  const groupTickerId = buildHoldingsTickerId(group.marketCode, group.ticker);
                  const showChildren = expandedState.has(groupKey);
                  const visibleChildren = group.children;

                  return (
                    <div key={groupKey} className="flex flex-col gap-2">
                      <HoldingGroupMobileCard
                        group={group}
                        dict={dict}
                        locale={locale}
                        allocationPercent={groupAllocationMap.get(groupKey) ?? null}
                        allocationBasis={effectiveAllocationBasis}
                        detailColumns={mobileColumnSplit.detailColumns}
                        expanded={showChildren}
                        layoutStyle={layoutStyle}
                        showFreshnessBadge={showFreshnessBadge}
                        showAdminActivityLinks={showAdminActivityLinks}
                        quoteRefreshVersion={index < MAX_ANIMATED_HOLDING_VALUE_ROWS ? quoteRefreshVersion : 0}
                        selectionChecked={holdingsSelection.isTickerSelected(groupTickerId)}
                        summaryColumns={mobileColumnSplit.summaryColumns}
                        showSelectionControl={enableSelectionWorkflow}
                        onToggle={() => toggleGroup(groupKey)}
                        onToggleSelection={() => holdingsSelection.toggleTicker(groupTickerId)}
                        onOpenDetail={() => setSelectedHolding(group)}
                      />
                      {showChildren
                        ? visibleChildren.map((child) => (
                          <HoldingChildMobileCard
                            key={`${child.accountId}:${child.ticker}:${child.marketCode}`}
                            child={child}
                            dict={dict}
                            locale={locale}
                            allocationPercent={childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null}
                            allocationBasis={effectiveAllocationBasis}
                            detailColumns={mobileColumnSplit.detailColumns}
                            nested
                            showFreshnessBadge={showFreshnessBadge}
                            showSelectionControl={enableSelectionWorkflow}
                            selectionChecked={enableSelectionWorkflow && holdingsSelection.isTickerSelected(groupTickerId)}
                            onToggleSelection={() => holdingsSelection.toggleTicker(groupTickerId)}
                            onOpenDetail={() => setSelectedHolding(child)}
                            summaryColumns={mobileColumnSplit.summaryColumns}
                            quoteRefreshVersion={0}
                          />
                        ))
                        : null}
                    </div>
                  );
                })}
            </HoldingsGridMobileList>

            <HoldingsGridDesktopFrame
              className={cn(
                "mt-6 max-h-[42rem] overflow-x-auto overflow-y-auto overscroll-x-contain rounded-xl bg-card",
                layoutStyle === "dashboard" && "[&_td]:py-2.5 [&_th]:py-2.5",
              )}
              testId="portfolio-holdings-desktop-scroll"
            >
            <HoldingsGridNativeTable
              className={cn(variant === "default" && "min-w-max")}
              style={detailedDesktopTableMinWidth === undefined ? undefined : { minWidth: detailedDesktopTableMinWidth }}
              testId="holdings-table"
            >
              <thead>
                <tr className="bg-muted/40 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  {visibleColumnDefs.map((column) => (
                    <th
                      key={column.id}
                      {...holdingsSortableHeaderCellProps(columnSettings, column.id)}
                      className={cn(
                        "sticky top-0 z-20 px-4 py-3 align-top font-medium [&_[data-testid^='holdings-column-sort-']>span]:whitespace-nowrap",
                        holdingsStickyFirstColumnClassName(column.id === "ticker", "header", "bg-muted/95"),
                        column.align === "right" ? "text-right" : "text-left",
                      )}
                      style={portfolioHeaderCellStyle(columnSettings, column.id, variant === "default")}
                    >
                      <HoldingsColumnHeaderContent
                        align={column.align}
                        column={column.id}
                        dict={dict}
                        label={portfolioColumnLabel(dict, column.id)}
                        settings={columnSettings}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayMode === "accounts"
                  ? visibleChildRows.map((child, index) => {
                    const childTickerId = buildHoldingsTickerId(child.marketCode, child.ticker);
                    return (
                      <HoldingChildRow
                        key={`${child.accountId}:${child.ticker}:${child.marketCode}`}
                        child={child}
                        dict={dict}
                        locale={locale}
                        visibleColumns={visibleColumns}
                        columnSettings={columnSettings}
                        allocationPercent={childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null}
                        allocationBasis={effectiveAllocationBasis}
                        isRecomputing={recomputingSymbols?.has(`${child.accountId}:${child.ticker}`) ?? false}
                        selectionChecked={enableSelectionWorkflow && holdingsSelection.isTickerSelected(childTickerId)}
                        showSelectionControl={enableSelectionWorkflow}
                        onOpenDetail={() => setSelectedHolding(child)}
                        onToggleSelection={() => holdingsSelection.toggleTicker(childTickerId)}
                        quoteRefreshVersion={index < MAX_ANIMATED_HOLDING_VALUE_ROWS ? quoteRefreshVersion : 0}
                      />
                    );
                  })
                  : orderedFilteredGroups.map((group, index) => {
                    const groupKey = `${group.ticker}::${group.marketCode}`;
                    const groupTickerId = buildHoldingsTickerId(group.marketCode, group.ticker);
                    const showChildren = expandedState.has(groupKey);
                    const visibleChildren = group.children;

                    return (
                      <React.Fragment key={groupKey}>
                        <HoldingGroupRow
                          group={group}
                          dict={dict}
                          locale={locale}
                          visibleColumns={visibleColumns}
                          columnSettings={columnSettings}
                          allocationPercent={groupAllocationMap.get(groupKey) ?? null}
                          allocationBasis={effectiveAllocationBasis}
                          expanded={showChildren}
                          layoutStyle={layoutStyle}
                          onToggle={() => toggleGroup(groupKey)}
                          onOpenDetail={() => setSelectedHolding(group)}
                          onToggleSelection={() => holdingsSelection.toggleTicker(groupTickerId)}
                          showFreshnessBadge={showFreshnessBadge}
                          showAdminActivityLinks={showAdminActivityLinks}
                          isRecomputing={hasRecomputingChild(group, recomputingSymbols)}
                          selectionChecked={enableSelectionWorkflow && holdingsSelection.isTickerSelected(groupTickerId)}
                          showSelectionControl={enableSelectionWorkflow}
                          quoteRefreshVersion={index < MAX_ANIMATED_HOLDING_VALUE_ROWS ? quoteRefreshVersion : 0}
                        />
                        {showChildren
                          ? visibleChildren.map((child) => (
                            <HoldingChildRow
                              key={`${child.accountId}:${child.ticker}:${child.marketCode}`}
                              child={child}
                              dict={dict}
                              locale={locale}
                              visibleColumns={visibleColumns}
                              columnSettings={columnSettings}
                              allocationPercent={childAllocationMap.get(`${child.accountId}:${child.ticker}:${child.marketCode}`) ?? null}
                              allocationBasis={effectiveAllocationBasis}
                              isRecomputing={recomputingSymbols?.has(`${child.accountId}:${child.ticker}`) ?? false}
                              nested
                              selectionChecked={enableSelectionWorkflow && holdingsSelection.isTickerSelected(groupTickerId)}
                              showSelectionControl={enableSelectionWorkflow}
                              onOpenDetail={() => setSelectedHolding(child)}
                              onToggleSelection={() => holdingsSelection.toggleTicker(groupTickerId)}
                              quoteRefreshVersion={0}
                            />
                          ))
                          : null}
                      </React.Fragment>
                    );
                  })}
              </tbody>
            </HoldingsGridNativeTable>
            </HoldingsGridDesktopFrame>
          </>
        )}
      </Card>
      <HoldingsDetailSheet
        description={dict.tickerHistory.actionTimelineSubtitle}
        onOpenChange={(open) => { if (!open) setSelectedHolding(null); }}
        selected={resolveCurrentHoldingDetail(selectedHolding, groups)}
        title={(selected) => "accountId" in selected
          ? `${selected.ticker} · ${selected.marketCode} · ${selected.accountName?.trim() || selected.accountId}`
          : `${selected.ticker} · ${selected.marketCode}`}
        renderDetail={(selected) => (
          <HoldingActivityDetail
            dict={dict}
            locale={locale}
            row={selected}
          />
        )}
      />
    </Tooltip.Provider>
  );
}

function HoldingGroupMobileCard({
  group,
  dict,
  locale,
  allocationPercent,
  allocationBasis,
  detailColumns,
  expanded,
  layoutStyle,
  showFreshnessBadge,
  showAdminActivityLinks,
  quoteRefreshVersion,
  selectionChecked,
  showSelectionControl,
  summaryColumns,
  onToggle,
  onToggleSelection,
  onOpenDetail,
}: {
  group: DashboardOverviewHoldingGroupDto;
  dict: AppDictionary;
  locale: LocaleCode;
  allocationPercent: number | null;
  allocationBasis: HoldingAllocationBasis;
  detailColumns: HoldingsColumn[];
  expanded: boolean;
  layoutStyle: "dashboard" | "portfolio";
  showFreshnessBadge: boolean;
  showAdminActivityLinks: boolean;
  quoteRefreshVersion: number;
  selectionChecked: boolean;
  showSelectionControl: boolean;
  summaryColumns: HoldingsColumn[];
  onToggle: () => void;
  onToggleSelection: () => void;
  onOpenDetail: () => void;
}) {
  const reportingCurrency = group.reportingCurrency;
  const allocation = getAmountForAllocationBasis(group, allocationBasis);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-lg border border-border bg-background shadow-sm",
        layoutStyle === "dashboard" ? "p-3" : "p-4",
      )}
      data-testid={`holding-group-mobile-row-${group.ticker}-${group.marketCode}`}
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
          <button
            type="button"
            onClick={onToggle}
            className="mt-0.5 rounded p-0.5 text-muted-foreground hover:bg-muted"
            data-testid={`holding-group-mobile-toggle-${group.ticker}-${group.marketCode}`}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
          <div className="min-w-0">
            <Link href={groupLinkHref(group)} className="break-words font-semibold text-foreground hover:text-primary">
              {group.ticker}
            </Link>
            {group.instrumentName ? <p className="mt-1 text-sm text-foreground">{group.instrumentName}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">{group.marketCode} · {group.currency}</p>
          </div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {summaryColumns.map((column) => (
          <PortfolioMobileColumnMetric
            key={column}
            allocation={allocation}
            allocationBasis={allocationBasis}
            allocationPercent={allocationPercent}
            column={column}
            dict={dict}
            locale={locale}
            row={group}
            showFreshnessBadge={showFreshnessBadge}
            showAdminActivityLinks={showAdminActivityLinks}
            quoteRefreshVersion={quoteRefreshVersion}
          />
        ))}
      </div>

      {detailColumns.length > 0 ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <div className="flex items-center justify-between gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setDetailsOpen((open) => !open)}>
              {dict.reports.viewDetails}
            </Button>
            <HoldingActivityQuickLink
              label={`${dict.tickerHistory.actionTimelineTitle}: ${group.ticker}`}
              onOpenDetail={onOpenDetail}
              testId={`holding-group-open-detail-${group.ticker}-${group.marketCode}`}
            />
          </div>
          {detailsOpen ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {detailColumns.map((column) => (
                <PortfolioMobileColumnMetric
                  key={column}
                  allocation={allocation}
                  allocationBasis={allocationBasis}
                  allocationPercent={allocationPercent}
                  column={column}
                  dict={dict}
                  locale={locale}
                  row={group}
                  showFreshnessBadge={showFreshnessBadge}
                  showAdminActivityLinks={showAdminActivityLinks}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {allocation.usedFallback ? (
        <p className="mt-3 text-xs text-warning">
          {dict.dashboardHome.allocationFallbackLabel}: {formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}
        </p>
      ) : null}

    </div>
  );
}

function HoldingChildMobileCard({
  child,
  dict,
  locale,
  allocationPercent,
  allocationBasis,
  detailColumns,
  nested,
  showFreshnessBadge,
  showSelectionControl,
  selectionChecked,
  onOpenDetail,
  onToggleSelection,
  quoteRefreshVersion,
  summaryColumns,
}: {
  child: DashboardOverviewHoldingChildDto;
  dict: AppDictionary;
  locale: LocaleCode;
  allocationPercent: number | null;
  allocationBasis: HoldingAllocationBasis;
  detailColumns: HoldingsColumn[];
  nested: boolean;
  showFreshnessBadge: boolean;
  showSelectionControl: boolean;
  selectionChecked: boolean;
  onOpenDetail: () => void;
  onToggleSelection: () => void;
  quoteRefreshVersion: number;
  summaryColumns: HoldingsColumn[];
}) {
  const reportingCurrency = child.reportingCurrency;
  const allocation = getAmountForAllocationBasis(child, allocationBasis);
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div
      className={cn(
        "rounded-xl border border-border bg-background p-4 shadow-sm",
        nested && "ml-4 border-border/70 bg-muted/[0.18]",
      )}
      data-testid={`holding-child-mobile-row-${child.ticker}-${child.marketCode}-${child.accountId}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          {showSelectionControl ? (
            <HoldingsSelectionInlineToggle
              dict={dict}
              tickerId={buildHoldingsTickerId(child.marketCode, child.ticker)}
              checked={selectionChecked}
              onToggle={onToggleSelection}
              className="mt-1"
            />
          ) : null}
          <div className="min-w-0">
            <Link href={childLinkHref(child)} className="break-words font-semibold text-foreground hover:text-primary">
              {child.ticker}
            </Link>
            {child.instrumentName ? <p className="mt-1 text-sm text-foreground">{child.instrumentName}</p> : null}
            <p className="mt-1 text-xs text-muted-foreground">{child.marketCode} · {child.currency}</p>
            <p className="mt-1 text-xs text-muted-foreground">{child.accountName?.trim() || child.accountId}</p>
          </div>
        </div>
        <HoldingActivityQuickLink
          label={`${dict.tickerHistory.actionTimelineTitle}: ${child.ticker} · ${child.accountName?.trim() || child.accountId}`}
          onOpenDetail={onOpenDetail}
          testId={`holding-child-open-detail-${child.ticker}-${child.marketCode}-${child.accountId}`}
        />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        {summaryColumns.map((column) => (
          <PortfolioMobileColumnMetric
            key={column}
            allocation={allocation}
            allocationBasis={allocationBasis}
            allocationPercent={allocationPercent}
            column={column}
            dict={dict}
            locale={locale}
            row={child}
            showFreshnessBadge={showFreshnessBadge}
            quoteRefreshVersion={quoteRefreshVersion}
          />
        ))}
      </div>

      {detailColumns.length > 0 ? (
        <div className="mt-3 border-t border-border/70 pt-3">
          <Button type="button" size="sm" variant="ghost" onClick={() => setDetailsOpen((open) => !open)}>
            {dict.reports.viewDetails}
          </Button>
          {detailsOpen ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {detailColumns.map((column) => (
                <PortfolioMobileColumnMetric
                  key={column}
                  allocation={allocation}
                  allocationBasis={allocationBasis}
                  allocationPercent={allocationPercent}
                  column={column}
                  dict={dict}
                  locale={locale}
                  row={child}
                  showFreshnessBadge={showFreshnessBadge}
                  quoteRefreshVersion={quoteRefreshVersion}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {allocation.usedFallback ? (
        <p className="mt-3 text-xs text-warning">
          {dict.dashboardHome.allocationFallbackLabel}: {formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}
        </p>
      ) : null}
    </div>
  );
}

function MobileHoldingMetric({
  label,
  value,
  tone = null,
  toneClassName,
  secondary,
  detail,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  tone?: number | null;
  toneClassName?: string;
  secondary?: string;
  detail?: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/20 px-3 py-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className={cn("mt-1 min-w-0 break-words font-mono text-sm font-semibold tabular-nums", toneClassName ?? getUnrealizedPnlTone(tone), valueClassName)}>{value}</div>
      {secondary ? <p className="mt-1 font-mono text-xs tabular-nums text-muted-foreground">{secondary}</p> : null}
      {detail ? <div className="mt-1 text-xs text-muted-foreground">{detail}</div> : null}
    </div>
  );
}

function PortfolioMobileColumnMetric({
  allocation,
  allocationPercent,
  column,
  dict,
  locale,
  row,
  showFreshnessBadge,
  showAdminActivityLinks = false,
  quoteRefreshVersion = 0,
}: {
  allocation: ReturnType<typeof getAmountForAllocationBasis>;
  allocationBasis: HoldingAllocationBasis;
  allocationPercent: number | null;
  column: HoldingsColumn;
  dict: AppDictionary;
  locale: LocaleCode;
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto;
  showFreshnessBadge: boolean;
  showAdminActivityLinks?: boolean;
  quoteRefreshVersion?: number;
}) {
  const reportingCurrency = row.reportingCurrency;
  const avgCost = getDashboardReportingAverageCost(row, reportingCurrency);
  const unitPnl = getDashboardUnitPnl(row, reportingCurrency);
  const nativeUnitPnl = getNativeUnitPnl(row.currentUnitPrice, row.averageCostPerShare);
  const accountCount = "accountCount" in row ? row.accountCount : null;

  switch (column) {
    case "accounts":
      return <MobileHoldingMetric label={dict.holdings.columnAccounts} value={accountCount === null ? "-" : formatNumber(accountCount, locale)} />;
    case "quantity":
      return <MobileHoldingMetric label={dict.holdings.quantityTerm} value={formatNumber(row.quantity, locale)} />;
    case "averageCost":
      return (
        <MobileHoldingMetric
          label={dict.holdings.averageCostTerm}
          value={avgCost == null ? "-" : formatCurrencyAmount(avgCost, reportingCurrency, locale)}
          secondary={row.currency !== reportingCurrency ? formatCurrencyAmount(row.averageCostPerShare, row.currency, locale) : undefined}
        />
      );
    case "unitPnl":
      return (
        <MobileHoldingMetric
          label={dict.holdings.unitPnlTerm}
          tone={unitPnl.amount}
          value={unitPnl.amount == null ? "-" : formatCurrencyAmount(unitPnl.amount, reportingCurrency, locale)}
          secondary={row.currency !== reportingCurrency ? (nativeUnitPnl.amount == null ? "-" : formatCurrencyAmount(nativeUnitPnl.amount, row.currency, locale)) : undefined}
          detail={unitPnl.percent == null ? "-" : formatPercent(unitPnl.percent, locale)}
        />
      );
    case "price": {
      const isChildRow = "accountId" in row;
      const priceState = isChildRow ? null : getPriceState(row);
      const priceStateTestId = `holdings-mobile-price-state-${row.ticker}-${row.marketCode}`;
      const displayedPrice = getPortfolioDisplayedPrice(row);
      return (
        <MobileHoldingMetric
          label={dict.holdings.priceTerm}
          toneClassName={getCurrentPriceTone(row.currentUnitPrice, row.averageCostPerShare)}
          value={displayedPrice.amount == null
            ? dict.holdings.quoteMissing
            : formatCurrencyAmount(displayedPrice.amount, displayedPrice.currency, locale)}
          secondary={displayedPrice.nativeAmount == null
            ? undefined
            : formatCurrencyAmount(displayedPrice.nativeAmount, row.currency, locale)}
          detail={showFreshnessBadge && priceState ? (
            <div className="flex justify-start">
              <PriceStateChip
                className="mt-0 w-full justify-start text-left"
                activityPath={showAdminActivityLinks ? buildPriceStateActivityPath({ marketCode: row.marketCode, priceState, ticker: row.ticker }) : null}
                dict={dict}
                locale={locale}
                priceState={priceState}
                testId={priceStateTestId}
              />
            </div>
          ) : undefined}
        />
      );
    }
    case "dailyChange":
      return (
        <MobileHoldingMetric
          label={dict.dashboardHome.dailyChangeLabel}
          tone={row.change}
          value={row.quoteStatus === "missing" ? dict.dashboardHome.quoteStatusMissing : row.change === null ? "-" : formatCurrencyAmount(row.change, row.currency, locale)}
          detail={row.changePercent == null ? "-" : formatPercent(row.changePercent, locale)}
        />
      );
    case "marketValue":
      return (
        <MobileHoldingMetric
          label={dict.holdings.marketValueTerm}
          value={row.reportingMarketValueAmount == null ? "-" : (
            <RollingNumber
              value={formatCurrencyAmount(row.reportingMarketValueAmount, reportingCurrency, locale)}
              animateOnKey={quoteRefreshVersion}
            />
          )}
          valueClassName="break-all"
        />
      );
    case "unrealizedPnl":
      return (
        <MobileHoldingMetric
          label={dict.holdings.pnlTerm}
          tone={row.reportingUnrealizedPnlAmount}
          value={row.reportingUnrealizedPnlAmount == null ? "-" : formatCurrencyAmount(row.reportingUnrealizedPnlAmount, reportingCurrency, locale)}
        />
      );
    case "dataHealth":
      return (
        <MobileHoldingMetric
          label={dict.holdings.dataHealthTerm}
          value={<HoldingsDataHealthBadges dict={dict} row={row} showAllocationFallback />}
          valueClassName="flex flex-wrap gap-1.5 font-sans"
        />
      );
    case "costBasis":
      return <MobileHoldingMetric label={dict.holdings.costBasisTerm} value={row.reportingCostBasisAmount == null ? "-" : formatCurrencyAmount(row.reportingCostBasisAmount, reportingCurrency, locale)} />;
    case "allocation":
      return (
        <MobileHoldingMetric
          label={dict.holdings.allocationTerm}
          value={allocationPercent == null ? "-" : formatPercent(allocationPercent, locale)}
          detail={allocation.usedFallback ? `${dict.dashboardHome.allocationFallbackLabel}: ${formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}` : undefined}
        />
      );
    case "nextDividendDate":
      return <MobileHoldingMetric label={dict.dashboardHome.nextDividendLabel} value={row.nextDividendDate ? formatDateLabel(row.nextDividendDate, locale) : "-"} />;
    case "lastDividendDate":
      return <MobileHoldingMetric label={dict.dashboardHome.lastDividendLabel} value={row.lastDividendPostedDate ? formatDateLabel(row.lastDividendPostedDate, locale) : "-"} />;
    case "ticker":
      return null;
  }
}

function HoldingGroupRow({
  columnSettings,
  group,
  dict,
  locale,
  visibleColumns,
  allocationPercent,
  allocationBasis,
  expanded,
  layoutStyle,
  onToggle,
  onToggleSelection,
  onOpenDetail,
  showFreshnessBadge,
  showAdminActivityLinks,
  isRecomputing,
  selectionChecked,
  showSelectionControl,
  quoteRefreshVersion,
}: {
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
  group: DashboardOverviewHoldingGroupDto;
  dict: AppDictionary;
  locale: LocaleCode;
  visibleColumns: HoldingsColumn[];
  allocationPercent: number | null;
  allocationBasis: HoldingAllocationBasis;
  expanded: boolean;
  layoutStyle: "dashboard" | "portfolio";
  onToggle: () => void;
  onToggleSelection: () => void;
  onOpenDetail: () => void;
  showFreshnessBadge: boolean;
  showAdminActivityLinks: boolean;
  isRecomputing: boolean;
  selectionChecked: boolean;
  showSelectionControl: boolean;
  quoteRefreshVersion: number;
}) {
  const allocation = getAmountForAllocationBasis(group, allocationBasis);
  const reportingCurrency = group.reportingCurrency;

  return (
    <tr className={cn("border-b border-border align-top", isRecomputing && "animate-pulse opacity-50")} data-testid={`holding-group-row-${group.ticker}-${group.marketCode}`}>
      {visibleColumns.map((column) => (
        <HoldingGroupCell
          key={column}
          allocation={allocation}
          allocationPercent={allocationPercent}
          column={column}
          columnSettings={columnSettings}
          costBasisAmount={group.reportingCostBasisAmount}
          dict={dict}
          expanded={expanded}
          group={group}
          layoutStyle={layoutStyle}
          locale={locale}
          marketValueAmount={group.reportingMarketValueAmount}
          onToggle={onToggle}
          onToggleSelection={onToggleSelection}
          onOpenDetail={onOpenDetail}
          reportingCurrency={reportingCurrency}
          selectionChecked={selectionChecked}
          showSelectionControl={showSelectionControl}
          showFreshnessBadge={showFreshnessBadge}
          showAdminActivityLinks={showAdminActivityLinks}
          unrealizedPnlAmount={group.reportingUnrealizedPnlAmount}
          quoteRefreshVersion={quoteRefreshVersion}
        />
      ))}
    </tr>
  );
}

function HoldingChildRow({
  columnSettings,
  child,
  dict,
  locale,
  visibleColumns,
  allocationPercent,
  allocationBasis,
  isRecomputing,
  nested = false,
  selectionChecked,
  showSelectionControl,
  onOpenDetail,
  onToggleSelection,
  quoteRefreshVersion,
}: {
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
  child: DashboardOverviewHoldingChildDto;
  dict: AppDictionary;
  locale: LocaleCode;
  visibleColumns: HoldingsColumn[];
  allocationPercent: number | null;
  allocationBasis: HoldingAllocationBasis;
  isRecomputing: boolean;
  nested?: boolean;
  selectionChecked: boolean;
  showSelectionControl: boolean;
  onOpenDetail: () => void;
  onToggleSelection: () => void;
  quoteRefreshVersion: number;
}) {
  const allocation = getAmountForAllocationBasis(child, allocationBasis);
  const reportingCurrency = child.reportingCurrency;

  return (
    <tr className={cn("border-b border-border/70 bg-muted/[0.18] align-top", isRecomputing && "animate-pulse opacity-50")} data-testid={`holding-child-row-${child.ticker}-${child.marketCode}-${child.accountId}`}>
      {visibleColumns.map((column) => (
        <HoldingChildCell
          key={column}
          allocation={allocation}
          allocationPercent={allocationPercent}
          child={child}
          column={column}
          columnSettings={columnSettings}
          costBasisAmount={child.reportingCostBasisAmount}
          dict={dict}
          locale={locale}
          marketValueAmount={child.reportingMarketValueAmount}
          nested={nested}
          onOpenDetail={onOpenDetail}
          onToggleSelection={onToggleSelection}
          reportingCurrency={reportingCurrency}
          selectionChecked={selectionChecked}
          showSelectionControl={showSelectionControl}
          unrealizedPnlAmount={child.reportingUnrealizedPnlAmount}
          quoteRefreshVersion={quoteRefreshVersion}
        />
      ))}
    </tr>
  );
}

function portfolioColumnLabel(dict: AppDictionary, column: HoldingsColumn) {
  switch (column) {
    case "ticker":
      return dict.holdings.tickerTerm;
    case "accounts":
      return dict.holdings.parentAccountCountLabel;
    case "quantity":
      return dict.holdings.quantityTerm;
    case "averageCost":
      return dict.holdings.averageCostTerm;
    case "unitPnl":
      return dict.holdings.unitPnlTerm;
    case "price":
      return dict.holdings.priceTerm;
    case "dailyChange":
      return dict.reports.dailyChange;
    case "marketValue":
      return dict.holdings.marketValueTerm;
    case "unrealizedPnl":
      return dict.dashboardHome.unrealizedPnlLabel;
    case "dataHealth":
      return dict.holdings.dataHealthTerm;
    case "costBasis":
      return dict.holdings.costBasisTerm;
    case "allocation":
      return dict.holdings.allocationTerm;
    case "nextDividendDate":
      return dict.dashboardHome.nextDividendLabel;
    case "lastDividendDate":
      return dict.dashboardHome.lastDividendLabel;
  }
}

function portfolioDetailedColumnWidth(
  settings: HoldingsColumnSettingsState<HoldingsColumn>,
  column: HoldingsColumn,
): number {
  return Math.max(settings.getColumnWidth(column), PORTFOLIO_DETAILED_MIN_COLUMN_WIDTHS[column]);
}

function portfolioHeaderCellStyle(
  settings: HoldingsColumnSettingsState<HoldingsColumn>,
  column: HoldingsColumn,
  enforceReadableMinimum: boolean,
): CSSProperties {
  const style = holdingsColumnCellStyle(settings, column);
  if (!enforceReadableMinimum) return style;
  const width = portfolioDetailedColumnWidth(settings, column);
  return { maxWidth: width, minWidth: width, width };
}

function HoldingGroupCell({
  allocation,
  allocationPercent,
  column,
  columnSettings,
  costBasisAmount,
  dict,
  expanded,
  group,
  layoutStyle,
  locale,
  marketValueAmount,
  onToggle,
  onToggleSelection,
  onOpenDetail,
  reportingCurrency,
  selectionChecked,
  showSelectionControl,
  showFreshnessBadge,
  showAdminActivityLinks,
  unrealizedPnlAmount,
  quoteRefreshVersion,
}: {
  allocation: ReturnType<typeof getAmountForAllocationBasis>;
  allocationPercent: number | null;
  column: HoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
  costBasisAmount: number | null;
  dict: AppDictionary;
  expanded: boolean;
  group: DashboardOverviewHoldingGroupDto;
  layoutStyle: "dashboard" | "portfolio";
  locale: LocaleCode;
  marketValueAmount: number | null;
  onToggle: () => void;
  onToggleSelection: () => void;
  onOpenDetail: () => void;
  reportingCurrency: AccountDefaultCurrency;
  selectionChecked: boolean;
  showSelectionControl: boolean;
  showFreshnessBadge: boolean;
  showAdminActivityLinks: boolean;
  unrealizedPnlAmount: number | null;
  quoteRefreshVersion: number;
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  if (column === "ticker") {
    return (
      <td className={cn("sticky left-0 z-10 bg-card px-4", layoutStyle === "dashboard" ? "py-2.5" : "py-3")} style={style}>
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
          <button
            type="button"
            onClick={onToggle}
            className="mt-1 rounded p-0.5 text-muted-foreground hover:bg-muted"
            data-testid={`holding-group-toggle-${group.ticker}-${group.marketCode}`}
          >
            {expanded ? <ChevronDown /> : <ChevronRight />}
          </button>
          <div className="flex min-w-0 items-start gap-2">
            <div className="min-w-0">
              <Link href={groupLinkHref(group)} className="break-words font-semibold text-foreground hover:text-primary">
                {group.ticker}
              </Link>
              {group.instrumentName ? <p className="mt-1 break-words text-sm text-muted-foreground">{group.instrumentName}</p> : null}
              <p className="text-xs text-muted-foreground">{group.marketCode} · {group.currency}</p>
            </div>
            <HoldingActivityQuickLink
              label={`${dict.tickerHistory.actionTimelineTitle}: ${group.ticker}`}
              onOpenDetail={onOpenDetail}
              testId={`holding-group-open-detail-${group.ticker}-${group.marketCode}`}
            />
          </div>
        </div>
      </td>
    );
  }
  if (column === "accounts") {
    return <td className="px-4 py-3 text-right text-foreground" style={style}>{formatNumber(group.accountCount, locale)}</td>;
  }
  if (column === "quantity") {
    return <td className="px-4 py-3 text-right text-foreground" style={style}>{formatNumber(group.quantity, locale)}</td>;
  }
  if (column === "averageCost") {
    const avgCost = getDashboardReportingAverageCost(group, reportingCurrency);
    return (
      <td className="px-4 py-3 text-right font-mono tabular-nums" style={style}>
        {avgCost == null ? "-" : formatCurrencyAmount(avgCost, reportingCurrency, locale)}
        {group.currency !== reportingCurrency ? (
          <div className="text-xs text-muted-foreground">{formatCurrencyAmount(group.averageCostPerShare, group.currency, locale)}</div>
        ) : null}
      </td>
    );
  }
  if (column === "unitPnl") {
    const unitPnl = getDashboardUnitPnl(group, reportingCurrency);
    const nativeUnitPnl = getNativeUnitPnl(group.currentUnitPrice, group.averageCostPerShare);
    return (
      <td className={cn("px-4 py-3 text-right font-mono font-medium tabular-nums", getUnrealizedPnlTone(unitPnl.amount))} style={style}>
        {unitPnl.amount == null ? "-" : formatCurrencyAmount(unitPnl.amount, reportingCurrency, locale)}
        <div className="text-xs">{unitPnl.percent == null ? "-" : formatPercent(unitPnl.percent, locale)}</div>
        {group.currency !== reportingCurrency ? (
          <div className="text-xs text-muted-foreground">
            {nativeUnitPnl.amount == null ? "-" : formatCurrencyAmount(nativeUnitPnl.amount, group.currency, locale)}
          </div>
        ) : null}
      </td>
    );
  }
  if (column === "price") {
    const priceState = getPriceState(group);
    const displayedPrice = getPortfolioDisplayedPrice(group);
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getCurrentPriceTone(group.currentUnitPrice, group.averageCostPerShare))} style={style}>
        <div className="flex min-w-0 flex-col items-end text-right">
          <span>{displayedPrice.amount == null
            ? dict.holdings.quoteMissing
            : formatCurrencyAmount(displayedPrice.amount, displayedPrice.currency, locale)}</span>
          {displayedPrice.nativeAmount == null ? null : (
            <span className="text-xs text-muted-foreground">
              {formatCurrencyAmount(displayedPrice.nativeAmount, group.currency, locale)}
            </span>
          )}
          {showFreshnessBadge && priceState ? (
            <div className="mt-1 flex w-full justify-end">
              <PriceStateChip activityPath={showAdminActivityLinks ? buildPriceStateActivityPath({ marketCode: group.marketCode, priceState, ticker: group.ticker }) : null} className="mt-0 w-full max-w-full justify-start text-left md:justify-end md:text-right" dict={dict} locale={locale} priceState={priceState} testId={`holdings-price-state-${group.ticker}-${group.marketCode}`} />
            </div>
          ) : null}
        </div>
      </td>
    );
  }
  if (column === "dailyChange") {
    return (
      <DailyChangeCell
        change={group.change}
        changePercent={group.changePercent}
        quoteStatus={group.quoteStatus}
        currency={group.currency}
        dict={dict}
        locale={locale}
        style={style}
        testId={`holding-group-daily-change-${group.ticker}-${group.marketCode}`}
      />
    );
  }
  if (column === "marketValue") {
    return (
      <td className="px-4 py-3 text-right" style={style}>
        {marketValueAmount == null ? "-" : (
          <RollingNumber
            value={formatCurrencyAmount(marketValueAmount, reportingCurrency, locale)}
            animateOnKey={quoteRefreshVersion}
          />
        )}
      </td>
    );
  }
  if (column === "unrealizedPnl") {
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getUnrealizedPnlTone(unrealizedPnlAmount))} style={style}>
        {unrealizedPnlAmount != null ? formatCurrencyAmount(unrealizedPnlAmount, reportingCurrency, locale) : "-"}
        {group.changePercent != null ? <div className="text-xs">{formatPercent(group.changePercent, locale)}</div> : null}
      </td>
    );
  }
  if (column === "dataHealth") {
    return (
      <td className="px-4 py-3" style={style}>
        <HoldingsDataHealthBadges dict={dict} locale={locale} row={group} showAllocationFallback />
      </td>
    );
  }
  if (column === "costBasis") {
    return <td className="px-4 py-3 text-right" style={style}>{costBasisAmount == null ? "-" : formatCurrencyAmount(costBasisAmount, reportingCurrency, locale)}</td>;
  }
  if (column === "allocation") {
    return (
      <td className="px-4 py-3 text-right" style={style}>
        {allocationPercent != null ? formatPercent(allocationPercent, locale) : "-"}
        {allocation.usedFallback ? (
          <div className="text-xs text-warning" data-testid={`holding-allocation-fallback-${group.ticker}-${group.marketCode}`}>
            {dict.dashboardHome.allocationFallbackLabel}: {formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}
          </div>
        ) : null}
      </td>
    );
  }
  if (column === "nextDividendDate") {
    return <td className="px-4 py-3 text-right" style={style}>{group.nextDividendDate ? formatDateLabel(group.nextDividendDate, locale) : "-"}</td>;
  }
  return <td className="px-4 py-3 text-right" style={style}>{group.lastDividendPostedDate ? formatDateLabel(group.lastDividendPostedDate, locale) : "-"}</td>;
}

function HoldingChildCell({
  allocation,
  allocationPercent,
  child,
  column,
  columnSettings,
  costBasisAmount,
  dict,
  locale,
  marketValueAmount,
  nested,
  onOpenDetail,
  onToggleSelection,
  reportingCurrency,
  selectionChecked,
  showSelectionControl,
  unrealizedPnlAmount,
  quoteRefreshVersion,
}: {
  allocation: ReturnType<typeof getAmountForAllocationBasis>;
  allocationPercent: number | null;
  child: DashboardOverviewHoldingChildDto;
  column: HoldingsColumn;
  columnSettings: HoldingsColumnSettingsState<HoldingsColumn>;
  costBasisAmount: number | null;
  dict: AppDictionary;
  locale: LocaleCode;
  marketValueAmount: number | null;
  nested: boolean;
  onOpenDetail: () => void;
  onToggleSelection: () => void;
  reportingCurrency: AccountDefaultCurrency;
  selectionChecked: boolean;
  showSelectionControl: boolean;
  unrealizedPnlAmount: number | null;
  quoteRefreshVersion: number;
}) {
  const style = holdingsColumnCellStyle(columnSettings, column);
  if (column === "ticker") {
    return (
      <td className="sticky left-0 z-10 bg-muted px-4 py-3" style={style}>
        <div className={cn("flex min-w-0 items-start gap-2", nested && "pl-8")}>
          {showSelectionControl ? (
            <HoldingsSelectionInlineToggle
              dict={dict}
              tickerId={buildHoldingsTickerId(child.marketCode, child.ticker)}
              checked={selectionChecked}
              onToggle={onToggleSelection}
              className="mt-1"
            />
          ) : null}
          <div className="min-w-0">
            <Link href={childLinkHref(child)} className="break-words font-medium text-primary hover:underline">
              {showSelectionControl ? child.ticker : child.accountName?.trim() || child.accountId}
            </Link>
            <p className="text-xs text-muted-foreground">
              {showSelectionControl
                ? `${child.accountName?.trim() || child.accountId} · ${child.marketCode}`
                : `${child.ticker} · ${child.marketCode}`}
            </p>
          </div>
          <HoldingActivityQuickLink
            label={`${dict.tickerHistory.actionTimelineTitle}: ${child.ticker} · ${child.accountName?.trim() || child.accountId}`}
            onOpenDetail={onOpenDetail}
            testId={`holding-child-open-detail-${child.ticker}-${child.marketCode}-${child.accountId}`}
          />
        </div>
      </td>
    );
  }
  if (column === "accounts") {
    return <td className="px-4 py-3 text-right text-muted-foreground" style={style}>-</td>;
  }
  if (column === "quantity") {
    return <td className="px-4 py-3 text-right" style={style}>{formatNumber(child.quantity, locale)}</td>;
  }
  if (column === "averageCost") {
    const avgCost = getDashboardReportingAverageCost(child, reportingCurrency);
    return (
      <td className="px-4 py-3 text-right font-mono tabular-nums" style={style}>
        {avgCost == null ? "-" : formatCurrencyAmount(avgCost, reportingCurrency, locale)}
        {child.currency !== reportingCurrency ? (
          <div className="text-xs text-muted-foreground">{formatCurrencyAmount(child.averageCostPerShare, child.currency, locale)}</div>
        ) : null}
      </td>
    );
  }
  if (column === "unitPnl") {
    const unitPnl = getDashboardUnitPnl(child, reportingCurrency);
    const nativeUnitPnl = getNativeUnitPnl(child.currentUnitPrice, child.averageCostPerShare);
    return (
      <td className={cn("px-4 py-3 text-right font-mono font-medium tabular-nums", getUnrealizedPnlTone(unitPnl.amount))} style={style}>
        {unitPnl.amount == null ? "-" : formatCurrencyAmount(unitPnl.amount, reportingCurrency, locale)}
        <div className="text-xs">{unitPnl.percent == null ? "-" : formatPercent(unitPnl.percent, locale)}</div>
        {child.currency !== reportingCurrency ? (
          <div className="text-xs text-muted-foreground">
            {nativeUnitPnl.amount == null ? "-" : formatCurrencyAmount(nativeUnitPnl.amount, child.currency, locale)}
          </div>
        ) : null}
      </td>
    );
  }
  if (column === "price") {
    const displayedPrice = getPortfolioDisplayedPrice(child);
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getCurrentPriceTone(child.currentUnitPrice, child.averageCostPerShare))} style={style}>
        <div className="flex min-w-0 flex-col items-end text-right">
          <span>{displayedPrice.amount == null
            ? dict.holdings.quoteMissing
            : formatCurrencyAmount(displayedPrice.amount, displayedPrice.currency, locale)}</span>
          {displayedPrice.nativeAmount == null ? null : (
            <span className="text-xs text-muted-foreground">
              {formatCurrencyAmount(displayedPrice.nativeAmount, child.currency, locale)}
            </span>
          )}
        </div>
      </td>
    );
  }
  if (column === "dailyChange") {
    return (
      <DailyChangeCell
        change={child.change}
        changePercent={child.changePercent}
        quoteStatus={child.quoteStatus}
        currency={child.currency}
        dict={dict}
        locale={locale}
        style={style}
        testId={`holding-child-daily-change-${child.ticker}-${child.marketCode}-${child.accountId}`}
      />
    );
  }
  if (column === "marketValue") {
    return (
      <td className="px-4 py-3 text-right" style={style}>
        {marketValueAmount == null ? "-" : (
          <RollingNumber
            value={formatCurrencyAmount(marketValueAmount, reportingCurrency, locale)}
            animateOnKey={quoteRefreshVersion}
          />
        )}
      </td>
    );
  }
  if (column === "unrealizedPnl") {
    return (
      <td className={cn("px-4 py-3 text-right font-medium", getUnrealizedPnlTone(unrealizedPnlAmount))} style={style}>
        {unrealizedPnlAmount != null ? formatCurrencyAmount(unrealizedPnlAmount, reportingCurrency, locale) : "-"}
        {child.changePercent != null ? <div className="text-xs">{formatPercent(child.changePercent, locale)}</div> : null}
      </td>
    );
  }
  if (column === "dataHealth") {
    return (
      <td className="px-4 py-3" style={style}>
        <HoldingsDataHealthBadges dict={dict} locale={locale} row={child} showAllocationFallback />
      </td>
    );
  }
  if (column === "costBasis") {
    return <td className="px-4 py-3 text-right" style={style}>{costBasisAmount == null ? "-" : formatCurrencyAmount(costBasisAmount, reportingCurrency, locale)}</td>;
  }
  if (column === "allocation") {
    return (
      <td className="px-4 py-3 text-right" style={style}>
        {allocationPercent != null ? formatPercent(allocationPercent, locale) : "-"}
        {allocation.usedFallback ? (
          <div className="text-xs text-warning" data-testid={`holding-allocation-fallback-${child.ticker}-${child.marketCode}-${child.accountId}`}>
            {dict.dashboardHome.allocationFallbackLabel}: {formatCurrencyAmount(allocation.amount, reportingCurrency, locale)}
          </div>
        ) : null}
      </td>
    );
  }
  if (column === "nextDividendDate") {
    return <td className="px-4 py-3 text-right" style={style}>{child.nextDividendDate ? formatDateLabel(child.nextDividendDate, locale) : "-"}</td>;
  }
  return <td className="px-4 py-3 text-right" style={style}>{child.lastDividendPostedDate ? formatDateLabel(child.lastDividendPostedDate, locale) : "-"}</td>;
}

function DailyChangeCell({
  change,
  changePercent,
  quoteStatus,
  currency,
  dict,
  locale,
  style,
  testId,
}: {
  change: number | null;
  changePercent: number | null;
  quoteStatus: DashboardOverviewHoldingDto["quoteStatus"];
  currency: string;
  dict: AppDictionary;
  locale: LocaleCode;
  style?: CSSProperties;
  testId: string;
}) {
  if (quoteStatus === "missing") {
    return (
      <td className="px-4 py-3 text-right font-medium text-warning" data-testid={testId} style={style}>
        {dict.dashboardHome.quoteStatusMissing}
      </td>
    );
  }

  if (change === null) {
    return (
      <td className="px-4 py-3 text-right font-medium text-muted-foreground" data-testid={testId} style={style}>
        <div>-</div>
        <div className="text-xs">
          {changePercent != null ? formatPercent(changePercent, locale) : "-"}
          {quoteStatus === "provisional" ? (
            <span className="ml-1" aria-label={dict.dashboardHome.quoteStatusProvisional}>{"\u23f1"}</span>
          ) : null}
        </div>
      </td>
    );
  }

  return (
    <td className={cn("px-4 py-3 text-right font-medium", getDailyChangeTone(change))} data-testid={testId} style={style}>
      <div>{formatCurrencyAmount(change, currency, locale)}</div>
      <div className="text-xs">
        {changePercent != null ? formatPercent(changePercent, locale) : "-"}
        {quoteStatus === "provisional" ? (
          <span className="ml-1" aria-label={dict.dashboardHome.quoteStatusProvisional}>{"\u23f1"}</span>
        ) : null}
      </div>
    </td>
  );
}

function getCurrentPriceTone(currentUnitPrice: number | null, averageCostPerShare: number): string {
  if (currentUnitPrice == null) return "text-muted-foreground";
  if (currentUnitPrice > averageCostPerShare) return "text-success";
  if (currentUnitPrice < averageCostPerShare) return "text-destructive";
  return "text-foreground";
}

function getDailyChangeTone(change: number): string {
  return holdingsFinanceToneClass(change, "text-foreground");
}

function getUnrealizedPnlTone(value: number | null): string {
  return holdingsFinanceToneClass(value, "text-muted-foreground");
}

export function portfolioHoldingSortKey(
  row: DetailHoldingRow,
  field: HoldingsSortField,
  allocationPercent: number | null,
): HoldingsSortPrimitive {
  switch (field) {
    case "ticker":
      return row.ticker;
    case "accountCount":
      return "accountCount" in row ? row.accountCount : 1;
    case "quantity":
      return row.quantity;
    case "averageCost":
      return getDashboardReportingAverageCost(row, row.reportingCurrency);
    case "price":
      return getPortfolioDisplayedPrice(row).amount;
    case "unitPnl":
      return getDashboardUnitPnl(row, row.reportingCurrency).amount;
    case "marketValue":
      return row.reportingMarketValueAmount;
    case "costBasis":
      return row.reportingCostBasisAmount;
    case "dailyChangePercent":
      return row.changePercent;
    case "unrealizedPnl":
      return row.reportingUnrealizedPnlAmount;
    case "allocation":
      return allocationPercent;
    case "dataHealth": {
      const fxRank = row.fxStatus === "missing" ? 50 : row.fxStatus === "partial" ? 25 : 0;
      const allocationRank = row.allocationBasisFallbackReason ? 10 : 0;
      return (priceStateSortRank(row) * 100) + fxRank + allocationRank;
    }
    case "nextDividendDate":
      return row.nextDividendDate;
    case "lastDividendDate":
      return row.lastDividendPostedDate;
  }
}

function finitePortfolioSortPrice(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function getPortfolioDisplayedPrice(row: DetailHoldingRow) {
  const reportingAmount = finitePortfolioSortPrice(row.reportingCurrentUnitPrice);
  const nativeAmount = finitePortfolioSortPrice(row.currentUnitPrice);
  if (reportingAmount === null) {
    return { amount: nativeAmount, currency: row.currency, nativeAmount: null };
  }
  const reportingCurrency = row.reportingCurrency ?? row.currency;
  return {
    amount: reportingAmount,
    currency: reportingCurrency,
    nativeAmount: reportingCurrency !== row.currency ? nativeAmount : null,
  };
}

function sumPortfolioValues(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0);
}

function firstFinitePortfolioValue(values: Array<number | null | undefined>): number | null {
  return values.find((value): value is number => typeof value === "number" && Number.isFinite(value)) ?? null;
}

function sortPortfolioAccountHoldings(
  rows: DashboardOverviewHoldingChildDto[],
): DashboardOverviewHoldingChildDto[] {
  return rows.slice().sort((left, right) =>
    (left.accountName?.trim() || left.accountId).localeCompare(right.accountName?.trim() || right.accountId)
    || left.accountId.localeCompare(right.accountId));
}

function projectPortfolioHoldingGroup(
  group: DashboardOverviewHoldingGroupDto,
  children: DashboardOverviewHoldingChildDto[],
): DashboardOverviewHoldingGroupDto {
  if (children.length === group.children.length) return group;
  const quantity = children.reduce((sum, child) => sum + child.quantity, 0);
  const previousValue = children.every((child) => child.previousClose != null)
    ? children.reduce((sum, child) => sum + ((child.previousClose ?? 0) * child.quantity), 0)
    : null;
  const change = sumPortfolioValues(children.map((child) => child.change));
  const worstPriceStateChild = children.reduce<DashboardOverviewHoldingChildDto | null>(
    (worst, child) => worst === null || priceStateSortRank(child) > priceStateSortRank(worst) ? child : worst,
    null,
  );
  const fxStatuses = children.map((child) => child.fxStatus);

  return {
    ...group,
    quantity,
    accountCount: children.length,
    averageCostPerShare: quantity > 0
      ? children.reduce((sum, child) => sum + (child.averageCostPerShare * child.quantity), 0) / quantity
      : 0,
    currentUnitPrice: firstFinitePortfolioValue(children.map((child) => child.currentUnitPrice)),
    costBasisAmount: children.reduce((sum, child) => sum + child.costBasisAmount, 0),
    marketValueAmount: sumPortfolioValues(children.map((child) => child.marketValueAmount)),
    unrealizedPnlAmount: sumPortfolioValues(children.map((child) => child.unrealizedPnlAmount)),
    allocationPct: null,
    change,
    changePercent: change != null && previousValue != null && previousValue > 0 ? (change / previousValue) * 100 : null,
    previousClose: previousValue != null && previousValue > 0 && quantity > 0 ? previousValue / quantity : null,
    quoteStatus: children.some((child) => child.quoteStatus === "missing")
      ? "missing"
      : children.some((child) => child.quoteStatus === "provisional") ? "provisional" : "current",
    nextDividendDate: children
      .map((child) => child.nextDividendDate)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? null,
    lastDividendPostedDate: children
      .map((child) => child.lastDividendPostedDate)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? null,
    priceState: worstPriceStateChild?.priceState ?? group.priceState,
    reportingCurrentUnitPrice: firstFinitePortfolioValue(children.map((child) => child.reportingCurrentUnitPrice)),
    reportingCostBasisAmount: sumPortfolioValues(children.map((child) => child.reportingCostBasisAmount)),
    reportingMarketValueAmount: sumPortfolioValues(children.map((child) => child.reportingMarketValueAmount)),
    reportingUnrealizedPnlAmount: sumPortfolioValues(children.map((child) => child.reportingUnrealizedPnlAmount)),
    reportingDailyChangeAmount: children.some((child) => (
      child.reportingDailyChangeAmount == null || !Number.isFinite(child.reportingDailyChangeAmount)
    ))
      ? null
      : sumPortfolioValues(children.map((child) => child.reportingDailyChangeAmount)),
    reportingAllocationPercent: null,
    reportingMarketAllocationPercent: null,
    fxStatus: fxStatuses.length > 0 && fxStatuses.every((status) => status === "complete")
      ? "complete"
      : fxStatuses.includes("missing") ? "missing" : "partial",
    allocationBasisUsed: children.every((child) => child.allocationBasisUsed === children[0]?.allocationBasisUsed)
      ? children[0]?.allocationBasisUsed ?? group.allocationBasisUsed
      : group.allocationBasisUsed,
    allocationBasisFallbackReason: children.some((child) => child.allocationBasisFallbackReason === "missing_quote")
      ? "missing_quote"
      : null,
    children,
  };
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

function HoldingActivityQuickLink({
  label,
  onOpenDetail,
  testId,
}: {
  label: string;
  onOpenDetail: () => void;
  testId: string;
}) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 rounded-md"
          aria-label={label}
          title={label}
          onClick={onOpenDetail}
          data-testid={testId}
        >
          <Search className="h-4 w-4" aria-hidden="true" />
        </Button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="top" sideOffset={6} className="z-50 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
