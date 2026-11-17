"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowDownRight, ArrowUpRight, BarChart3, Landmark, Plus, ReceiptText, Wrench } from "lucide-react";
import { Bar, BarChart, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TICKER_CHART_RANGES, currencyFor } from "@vakwen/shared-types";
import type {
  AccountDefaultCurrency,
  LocaleCode,
  MarketCode,
  TransactionHistoryItemDto,
  AccountDto,
  FeeProfileBindingDto,
  FeeProfileDto,
  InstrumentCatalogItemDto,
  TickerChartRange,
  TickerChartSelection,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import type { TransactionInput } from "../../../components/portfolio/types";
import { TransactionHistoryTable } from "../../../components/portfolio/TransactionHistoryTable";
import { RecordTransactionDialog } from "../../../components/portfolio/RecordTransactionDialog";
import { DeleteConfirmationDialog } from "../../../components/portfolio/DeleteConfirmationDialog";
import { EditConfirmationDialog } from "../../../components/portfolio/EditConfirmationDialog";
import { FeeRecalcConfirmDialog } from "../../../components/portfolio/FeeRecalcConfirmDialog";
import { TickerDividendsTab } from "../../../components/dividends/TickerDividendsTab";
import { Button } from "../../../components/ui/Button";
import { Card } from "../../../components/ui/Card";
import { StatusToast } from "../../../components/ui/StatusToast";
import { Badge } from "../../../components/ui/shadcn/badge";
import { Input } from "../../../components/ui/shadcn/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/shadcn/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/shadcn/tabs";
import { ToggleGroup, ToggleGroupItem } from "../../../components/ui/shadcn/toggle-group";
import {
  getHoldingsQuoteStatusLabel,
} from "../../../components/holdings/HoldingsDataHealth";
import { HoldingActionDetail } from "../../../components/holdings/HoldingActionDetail";
import { CapitalReductionPanel } from "../../../features/capital-reduction/CapitalReductionPanel";
import { PriceStateChip } from "../../../components/holdings/PriceStateChip";
import { holdingsFinanceSurfaceClass, holdingsFinanceToneClass, holdingsWarningBadgeClassName } from "../../../components/holdings/holdingsStyle";
import { useTransactionMutations } from "../../../features/portfolio/hooks/useTransactionMutations";
import { useTransactionSubmission } from "../../../features/portfolio/hooks/useTransactionSubmission";
import { fetchTransactionHistory } from "../../../features/portfolio/services/portfolioService";
import { updateDividendReconciliation } from "../../../features/dividends/services/dividendService";
import {
  fetchTickerDetailsFullRefresh,
  fetchTickerDetailsHydration,
  type TickerDetailsModel,
} from "../../../features/portfolio/services/tickerDetailsService";
import { useEventStream } from "../../../hooks/useEventStream";
import { RepairModal, type RepairModalValue } from "../../../features/settings/components/RepairModal";
import { requestRepair } from "../../../features/settings/services/repairService";
import { getCooldownRemainingMinutes } from "../../../features/settings/utils/cooldown";
import { useSharedContextOwnerId } from "../../../hooks/useSharedContextOwnerId";
import { resolveTransactionDraftAccount } from "../../../features/dashboard/types";
import { useBreadcrumb } from "../../../components/layout/BreadcrumbProvider";
import { useAppShellData } from "../../../components/layout/AppShellDataContext";
import {
  buildRouteDtoCacheKey,
  getRouteDtoContextScope,
  readRouteDtoCache,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../../lib/utils";
import { getNativeUnitPnl } from "../../../lib/holdingsMetrics";
import { buildTimelineAxis, type TimelineMode } from "../../../lib/timelineAxis";
import { buildPriceStateActivityPath, getPriceState, shouldPollForOpenMarket } from "../../../features/price-state/priceState";

interface TickerHistoryClientProps {
  transactions: TransactionHistoryItemDto[];
  dict: AppDictionary;
  locale: LocaleCode;
  ticker: string;
  accounts: AccountDto[];
  feeProfiles: FeeProfileDto[];
  feeProfileBindings: FeeProfileBindingDto[];
  instrument: InstrumentCatalogItemDto | null;
  details: TickerDetailsModel;
  isDemo: boolean;
  transactionAccountFilter?: string;
  transactionAccountIdsFilter?: string[];
  transactionMarketFilter?: MarketCode;
  initialChartQuery?: {
    chartEnd?: string;
    chartRange?: string;
    chartStart?: string;
  };
  initialTradeDate: string;
  initialTab?: TickerDetailTab;
  quotePollIntervalSeconds?: number | null;
  tickerPriceIntradayEnabled?: boolean | null;
  tickerPriceIntradayRefreshIntervalMinutes?: number | null;
}

export type TickerDetailTab = "overview" | "dividends" | "fundamentals" | "transactions";

function normalizeTickerDetailTab(value: string | null | undefined): TickerDetailTab {
  return value === "dividends" || value === "fundamentals" || value === "transactions"
    ? value
    : "overview";
}

export function canDeleteTickerTransactions(
  isSharedContext: boolean,
  permissions: { canWriteTransactions: boolean; canWriteDividends: boolean },
): boolean {
  return !isSharedContext || (permissions.canWriteTransactions && permissions.canWriteDividends);
}

const REPAIR_EVENT_TYPES: string[] = ["repair_started", "repair_complete", "repair_failed"];
const TICKER_DETAILS_CACHE_TTL_MS = 3 * 60 * 1000;
const TICKER_RANGE_ITEMS = [...TICKER_CHART_RANGES, "CUSTOM"] as const;
const MAX_TICKER_CHART_POINTS = 900;
const TICKER_CHART_EMPTY_FALLBACK_DATE = "1970-01-01";

type TickerRangeControl = TickerChartRange | "CUSTOM";
type TickerChartMetric = "price" | "unrealizedPnl";

interface TickerChartRequest {
  range?: TickerChartRange;
  startDate?: string;
  endDate?: string;
}

function isMatchingTickerDetailsCache(
  cached: { payload: TickerDetailsModel } | null,
  ticker: string,
  marketCode: string | null | undefined,
  reportingCurrency: AccountDefaultCurrency,
): cached is { payload: TickerDetailsModel } {
  const cachedReportingCurrency = cached ? resolveTickerDetailsReportingCurrency(cached.payload) : null;
  return cached?.payload.identity.ticker === ticker
    && (!marketCode || cached.payload.identity.marketCode === marketCode)
    && (cachedReportingCurrency === null || cachedReportingCurrency === reportingCurrency);
}

function resolveTickerDetailsReportingCurrency(details: TickerDetailsModel): AccountDefaultCurrency | null {
  return details.holdingGroup?.reportingCurrency
    ?? details.accountBreakdown.find((row) => row.reportingCurrency !== undefined)?.reportingCurrency
    ?? null;
}

function transactionInputsEqual(left: TransactionInput, right: TransactionInput): boolean {
  return left.accountId === right.accountId
    && left.ticker === right.ticker
    && left.marketCode === right.marketCode
    && left.quantity === right.quantity
    && left.unitPrice === right.unitPrice
    && left.priceCurrency === right.priceCurrency
    && left.tradeDate === right.tradeDate
    && left.commissionAmount === right.commissionAmount
    && left.taxAmount === right.taxAmount
    && left.type === right.type
    && left.isDayTrade === right.isDayTrade;
}

function formatLastRepairTime(locale: LocaleCode, value: Date): string {
  return new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

function formatCompactNumber(locale: LocaleCode, value: number | null): string {
  if (value == null) return "-";
  return new Intl.NumberFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(locale: LocaleCode, value: number | null): string {
  if (value == null) return "-";
  return `${formatCompactNumber(locale, value)}%`;
}

function metricValueClassName(value: string, emptyValue: string, compact = false, toneClassName = "text-foreground"): string {
  const size = compact ? "text-base sm:text-lg" : "text-xl sm:text-2xl";
  return value === emptyValue
    ? "mt-3 break-words text-sm font-medium leading-6 text-muted-foreground sm:text-base"
    : cn("mt-3 font-semibold tracking-tight", toneClassName, size);
}

function isTickerChartRange(value: string): value is TickerChartRange {
  return (TICKER_CHART_RANGES as readonly string[]).includes(value);
}

function isTickerRangeControl(value: string): value is TickerRangeControl {
  return value === "CUSTOM" || isTickerChartRange(value);
}

function buildTickerChartRequest(selection: TickerRangeControl, startDate?: string | null, endDate?: string | null): TickerChartRequest {
  if (selection === "CUSTOM" && startDate && endDate) {
    return { startDate, endDate };
  }
  if (selection !== "CUSTOM") {
    return { range: selection };
  }
  return { range: "1Y" };
}

function tickerChartRequestsEqual(left: TickerChartRequest, right: TickerChartRequest): boolean {
  return left.range === right.range
    && left.startDate === right.startDate
    && left.endDate === right.endDate;
}

function getTickerChartMetadata(chart: TickerDetailsModel["chart"]) {
  return chart.metadata ?? {
    requested: {
      range: chart.range === "CUSTOM" ? null : chart.range ?? "1Y",
      startDate: null,
      endDate: null,
    },
    resolved: {
      range: chart.range ?? "1Y",
      startDate: chart.points[0]?.date ?? null,
      endDate: chart.points.at(-1)?.date ?? null,
    },
    available: {
      startDate: chart.points[0]?.date ?? null,
      endDate: chart.points.at(-1)?.date ?? null,
    },
    truncated: {
      startDate: false,
      endDate: false,
    },
  };
}

function resolveInitialTickerChartState(
  searchParams: Pick<URLSearchParams, "get">,
  fallbackRange: TickerChartSelection,
  fallbackStartDate: string | null,
  fallbackEndDate: string | null,
): {
  customEndDate: string;
  customStartDate: string;
  request: TickerChartRequest;
  selection: TickerRangeControl;
} {
  const analysisDateAlias = searchParams.get("source") === "unrealized-pnl-analysis";
  const queryStart = searchParams.get("chartStart")?.trim() || (analysisDateAlias ? searchParams.get("fromDate")?.trim() : undefined) || "";
  const queryEnd = searchParams.get("chartEnd")?.trim() || (analysisDateAlias ? searchParams.get("toDate")?.trim() : undefined) || "";
  const queryRange = searchParams.get("chartRange")?.trim().toUpperCase()
    ?? (analysisDateAlias && queryStart && queryEnd ? "CUSTOM" : undefined);

  if (queryRange === "CUSTOM" && isValidCustomTickerChartRange(queryStart, queryEnd)) {
    return {
      customEndDate: queryEnd,
      customStartDate: queryStart,
      request: { startDate: queryStart, endDate: queryEnd },
      selection: "CUSTOM",
    };
  }

  if (queryRange && isTickerChartRange(queryRange)) {
    return {
      customEndDate: fallbackEndDate ?? "",
      customStartDate: fallbackStartDate ?? "",
      request: { range: queryRange },
      selection: queryRange,
    };
  }

  const selection = fallbackRange === "CUSTOM" && fallbackStartDate && fallbackEndDate
    ? "CUSTOM"
    : fallbackRange === "CUSTOM"
      ? "1Y"
      : fallbackRange;
  return {
    customEndDate: fallbackEndDate ?? "",
    customStartDate: fallbackStartDate ?? "",
    request: buildTickerChartRequest(selection, fallbackStartDate, fallbackEndDate),
    selection,
  };
}

function buildInitialTickerChartSearchParams(
  query: TickerHistoryClientProps["initialChartQuery"],
): Pick<URLSearchParams, "get"> {
  return {
    get: (key: string) => {
      if (key === "chartRange") return query?.chartRange ?? null;
      if (key === "chartStart") return query?.chartStart ?? null;
      if (key === "chartEnd") return query?.chartEnd ?? null;
      if (key === "source") return null;
      if (key === "fromDate") return null;
      if (key === "toDate") return null;
      return null;
    },
  };
}

function resolveAnalysisIncludeProvisional(searchParams: Pick<URLSearchParams, "get">): boolean | undefined {
  if (searchParams.get("source") !== "unrealized-pnl-analysis") return undefined;
  return searchParams.get("includeProvisional")?.trim().toLowerCase() === "true";
}

function isValidCustomTickerChartRange(startDate: string, endDate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return false;
  if (startDate > endDate) return false;
  const maxEnd = new Date(`${startDate}T00:00:00.000Z`);
  maxEnd.setUTCFullYear(maxEnd.getUTCFullYear() + 10);
  return new Date(`${endDate}T00:00:00.000Z`).getTime() <= maxEnd.getTime();
}

function formatTickerChartRangeLabel(dict: AppDictionary, range: TickerRangeControl): string {
  if (range === "ALL") return dict.tickerHistory.chartAllRangeLabel;
  if (range === "CUSTOM") return dict.tickerHistory.chartCustomRangeLabel;
  if (range === "YTD") return dict.dashboardHome.rangeYtdLabel;
  if (range === "1M") return dict.dashboardHome.range1MLabel;
  if (range === "3M") return dict.dashboardHome.range3MLabel;
  if (range === "1Y") return dict.dashboardHome.range1YLabel;
  return range;
}

function formatTickerChartMessage(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(new RegExp(`\\{${key}\\}`, "g"), value),
    template,
  );
}

function resolveTickerPricePollMs(
  quotePollIntervalSeconds: number | null | undefined,
  tickerPriceIntradayRefreshIntervalMinutes: number | null | undefined,
): number {
  if (
    typeof tickerPriceIntradayRefreshIntervalMinutes === "number"
    && Number.isFinite(tickerPriceIntradayRefreshIntervalMinutes)
    && tickerPriceIntradayRefreshIntervalMinutes > 0
  ) {
    return Math.max(60_000, tickerPriceIntradayRefreshIntervalMinutes * 60_000);
  }
  return Math.max(15_000, (quotePollIntervalSeconds ?? 60) * 1000);
}

function truncateChartLabel(value: string, maxLength = 9): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(1, maxLength - 3))}...`;
}

function downsampleTickerChartPoints(
  points: TickerDetailsModel["chart"]["points"],
  maxPoints: number,
): { downsampled: boolean; points: TickerDetailsModel["chart"]["points"]; total: number } {
  if (points.length <= maxPoints) return { downsampled: false, points, total: points.length };
  const first = points[0]!;
  const last = points.at(-1)!;
  const bucketCount = Math.max(1, Math.floor((maxPoints - 2) / 2));
  const interior = points.slice(1, -1);
  const bucketSize = Math.ceil(interior.length / bucketCount);
  const sampled = [first];

  for (let index = 0; index < interior.length; index += bucketSize) {
    const bucket = interior.slice(index, index + bucketSize);
    const priced = bucket.filter((point) => point.price !== null);
    if (priced.length === 0) {
      sampled.push(bucket[0]!);
      continue;
    }
    const min = priced.reduce((current, point) => (point.price! < current.price! ? point : current), priced[0]!);
    const max = priced.reduce((current, point) => (point.price! > current.price! ? point : current), priced[0]!);
    sampled.push(min, max);
  }

  sampled.push(last);
  const uniqueSorted = [...new Map(sampled.map((point) => [`${point.date}:${point.label}`, point])).values()]
    .sort((left, right) => left.date.localeCompare(right.date));
  if (uniqueSorted.length <= maxPoints) {
    return { downsampled: true, points: uniqueSorted, total: points.length };
  }

  const lastKey = `${last.date}:${last.label}`;
  const withoutLast = uniqueSorted.filter((point) => `${point.date}:${point.label}` !== lastKey);
  return {
    downsampled: true,
    points: [...thinTickerChartPoints(withoutLast, Math.max(1, maxPoints - 1)), last],
    total: points.length,
  };
}

function thinTickerChartPoints(
  points: TickerDetailsModel["chart"]["points"],
  maxPoints: number,
): TickerDetailsModel["chart"]["points"] {
  if (points.length <= maxPoints) return points;
  if (maxPoints <= 1) return points.slice(0, 1);
  const step = (points.length - 1) / (maxPoints - 1);
  return Array.from({ length: maxPoints }, (_, index) => points[Math.round(index * step)]!)
    .filter((point, index, arr) => index === 0 || point !== arr[index - 1]);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function resolveTickerChartPrice(point: TickerDetailsModel["chart"]["points"][number]): number | null {
  const rawPoint = point as typeof point & { close?: unknown; closePrice?: unknown };
  return finiteNumber(point.price)
    ?? finiteNumber(rawPoint.close)
    ?? finiteNumber(rawPoint.closePrice);
}

function resolveTickerChartAverageCost(
  point: TickerDetailsModel["chart"]["points"][number],
  fallbackAverageCost: number | null,
): number | null {
  const rawPoint = point as typeof point & { averageCostPerShare?: unknown };
  return finiteNumber(point.averageCost)
    ?? finiteNumber(rawPoint.averageCostPerShare)
    ?? finiteNumber(fallbackAverageCost);
}

function resolveTickerChartQuantity(
  point: TickerDetailsModel["chart"]["points"][number],
  fallbackQuantity: number,
): number {
  return finiteNumber(point.quantity) ?? finiteNumber(fallbackQuantity) ?? 0;
}

type TickerTimelineAxis = ReturnType<typeof buildTimelineAxis>;

interface PriceChartDataPoint {
  averageCost: number | null;
  axisLabel: string;
  date: string;
  dateMs: number;
  label: string;
  price: number | null;
  quantity: number;
}

interface UnrealizedPnlChartDataPoint {
  axisLabel: string;
  currency: string;
  date: string;
  dateMs: number;
  label: string;
  quantity: number;
  unrealizedPnl: number | null;
}

function ChartEmptyState({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center rounded-md border border-dashed border-slate-300 bg-slate-50 text-sm text-slate-500">
      {children}
    </div>
  );
}

function PriceVsAverageCostChart({
  axis,
  currency,
  data,
  dict,
  locale,
}: {
  axis: TickerTimelineAxis;
  currency: string;
  data: PriceChartDataPoint[];
  dict: AppDictionary;
  locale: LocaleCode;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="dateMs"
          type="number"
          scale="time"
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={axis.tickFormatter}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis tickLine={false} axisLine={false} width={76} tickFormatter={(value: number) => formatCompactCurrencyAmount(value, currency, locale)} />
        <Tooltip
          labelFormatter={(value) => (
            typeof value === "number"
              ? formatDateLabel(new Date(value).toISOString().slice(0, 10), locale)
              : String(value)
          )}
          formatter={(value, name) => {
            if (typeof value !== "number") return Array.isArray(value) ? value.join(" / ") : value;
            if (name === "quantity") return formatNumber(value, locale);
            return formatCurrencyAmount(value, currency, locale);
          }}
        />
        <Line type="monotone" dataKey="price" stroke="#0f766e" strokeWidth={2.5} dot={false} name={dict.tickerHistory.currentPriceLabel} />
        <Line type="monotone" dataKey="averageCost" stroke="#334155" strokeWidth={2} strokeDasharray="6 4" dot={false} name={dict.tickerHistory.avgCostLabel} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function UnrealizedPnlChart({
  axis,
  currency,
  data,
  dict,
  locale,
}: {
  axis: TickerTimelineAxis;
  currency: string;
  data: UnrealizedPnlChartDataPoint[];
  dict: AppDictionary;
  locale: LocaleCode;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 12, right: 12, left: 0, bottom: 4 }}>
        <XAxis
          dataKey="dateMs"
          type="number"
          scale="time"
          domain={axis.domain}
          ticks={axis.ticks}
          tickFormatter={axis.tickFormatter}
          tickLine={false}
          axisLine={false}
          minTickGap={32}
        />
        <YAxis tickLine={false} axisLine={false} width={76} tickFormatter={(value: number) => formatCompactCurrencyAmount(value, currency, locale)} />
        <Tooltip
          labelFormatter={(value) => (
            typeof value === "number"
              ? formatDateLabel(new Date(value).toISOString().slice(0, 10), locale)
              : String(value)
          )}
          formatter={(value, name) => {
            if (typeof value !== "number") return Array.isArray(value) ? value.join(" / ") : value;
            if (name === "quantity") return formatNumber(value, locale);
            return formatCurrencyAmount(value, currency, locale);
          }}
        />
        <Line type="monotone" dataKey="unrealizedPnl" stroke="#215dc6" strokeWidth={2.5} dot={false} connectNulls={false} name={dict.tickerHistory.unrealizedPnlLabel} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function TickerHistoryClient({
  transactions,
  dict,
  locale,
  ticker,
  accounts,
  feeProfiles,
  feeProfileBindings,
  instrument,
  details,
  isDemo,
  transactionAccountFilter,
  transactionAccountIdsFilter,
  transactionMarketFilter,
  initialChartQuery,
  initialTradeDate,
  initialTab = "overview",
  quotePollIntervalSeconds,
  tickerPriceIntradayEnabled,
  tickerPriceIntradayRefreshIntervalMinutes,
}: TickerHistoryClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams.toString();
  const openedFromAnalysis = searchParams.get("source") === "unrealized-pnl-analysis";
  const liveAnalysisIncludeProvisional = resolveAnalysisIncludeProvisional(searchParams);
  const tickerOpenMarketPollMs = resolveTickerPricePollMs(
    quotePollIntervalSeconds,
    tickerPriceIntradayRefreshIntervalMinutes,
  );
  const isTickerPriceIntradayEnabled = tickerPriceIntradayEnabled ?? true;
  const initialChartMetadata = getTickerChartMetadata(details.chart);
  const initialTickerChartState = resolveInitialTickerChartState(
    buildInitialTickerChartSearchParams(initialChartQuery),
    details.chart.range ?? "1Y",
    initialChartMetadata.resolved.startDate,
    initialChartMetadata.resolved.endDate,
  );
  const [isClientReady, setIsClientReady] = useState(false);
  const [isRecordDialogOpen, setIsRecordDialogOpen] = useState(false);
  const [isRepairDialogOpen, setIsRepairDialogOpen] = useState(false);
  const [isRepairSubmitting, setIsRepairSubmitting] = useState(false);
  const [repairMessage, setRepairMessage] = useState("");
  const [repairError, setRepairError] = useState("");
  const [repairInProgress, setRepairInProgress] = useState(false);
  const [instrumentState, setInstrumentState] = useState<InstrumentCatalogItemDto | null>(instrument);
  const [displayTransactions, setDisplayTransactions] = useState(transactions);
  const [detailsState, setDetailsState] = useState(details);
  const detailsStateRef = useRef(details);
  const [isDetailsLoading, setIsDetailsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TickerDetailTab>(initialTab);
  const [pendingDividendLedgerEntryId, setPendingDividendLedgerEntryId] = useState<string | null>(null);
  const [analysisContextCleared, setAnalysisContextCleared] = useState(false);
  const [tickerChartSelection, setTickerChartSelection] = useState<TickerRangeControl>(() => initialTickerChartState.selection);
  const [tickerChartMetric, setTickerChartMetric] = useState<TickerChartMetric>(() => openedFromAnalysis ? "unrealizedPnl" : "price");
  const analysisContextActive = openedFromAnalysis && !analysisContextCleared;
  const analysisIncludeProvisional = analysisContextActive ? liveAnalysisIncludeProvisional : undefined;
  const previousOpenedFromAnalysisRef = useRef(analysisContextActive);
  const [tickerTimelineMode, setTickerTimelineMode] = useState<TimelineMode>("auto");
  const [tickerChartRequest, setTickerChartRequest] = useState<TickerChartRequest>(() => initialTickerChartState.request);
  const [customStartDate, setCustomStartDate] = useState(initialTickerChartState.customStartDate);
  const [customEndDate, setCustomEndDate] = useState(initialTickerChartState.customEndDate);
  const [tickerChartError, setTickerChartError] = useState("");
  const [repairValue, setRepairValue] = useState<RepairModalValue>({
    startDate: "",
    endDate: "",
    includeBars: true,
    includeDividends: true,
  });

  useEffect(() => {
    setActiveTab(normalizeTickerDetailTab(searchParams.get("tab")));
  }, [searchParamKey, searchParams]);

  const selectTickerTab = useCallback((value: string) => {
    const nextTab = normalizeTickerDetailTab(value);
    setActiveTab(nextTab);
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("tab", nextTab);
    const query = nextParams.toString();
    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
  }, [pathname, searchParams]);
  const sharedContextOwnerId = useSharedContextOwnerId();
  const {
    sessionUserId,
    sessionUserRole,
    openQuickActions,
    reportingCurrency,
    sharedContextPermissions,
  } = useAppShellData();
  const tickerDetailsProvisionalCacheScope = analysisContextActive
    ? `analysis-provisional:${analysisIncludeProvisional ? "include" : "exclude"}`
    : "default-provisional";
  const tickerDetailsCacheKey = useMemo(
    () => buildRouteDtoCacheKey(
      "ticker-details",
      getRouteDtoContextScope(sessionUserId),
      locale,
      ticker,
      transactionMarketFilter ?? details.identity.marketCode,
      transactionAccountFilter ?? "all",
      transactionAccountIdsFilter?.join(",") ?? "",
      tickerChartRequest.range ?? "CUSTOM",
      tickerChartRequest.startDate ?? "",
      tickerChartRequest.endDate ?? "",
      reportingCurrency,
      tickerDetailsProvisionalCacheScope,
    ),
    [details.identity.marketCode, locale, reportingCurrency, sessionUserId, ticker, tickerChartRequest.endDate, tickerChartRequest.range, tickerChartRequest.startDate, tickerDetailsProvisionalCacheScope, transactionAccountFilter, transactionAccountIdsFilter, transactionMarketFilter],
  );
  const isSharedContext = sharedContextOwnerId !== null;
  const canWriteTransactions = !isSharedContext || sharedContextPermissions.canWriteTransactions;
  const canWriteDividends = !isSharedContext || sharedContextPermissions.canWriteDividends;
  const canDeleteTransactions = canDeleteTickerTransactions(isSharedContext, sharedContextPermissions);
  const currency = detailsState.identity.currency;
  const identityDisplayName = detailsState.identity.name?.trim();
  const tickerTitle = identityDisplayName ? `${identityDisplayName} (${ticker})` : ticker;
  // Per-page breadcrumb override (spec amendment #21). Display label uses the
  // market-scoped details identity so duplicate ticker codes in other markets
  // cannot leak a broad catalog name into the ticker page.
  useBreadcrumb([
    { label: dict.navigation.portfolioLabel, href: "/portfolio" },
    { label: tickerTitle },
  ]);
  const accountNameById = useMemo(() => new Map(accounts.map((account) => [account.id, account.name])), [accounts]);
  const accountScopeDisplayName = useMemo(() => {
    if (transactionAccountFilter) return accountNameById.get(transactionAccountFilter) ?? transactionAccountFilter;
    if (transactionAccountIdsFilter?.length) {
      if (transactionAccountIdsFilter.length <= 2) {
        return transactionAccountIdsFilter.map((accountId) => accountNameById.get(accountId) ?? accountId).join(", ");
      }
      return formatTickerChartMessage(dict.tickerHistory.analysisAccountsCountLabel, {
        count: String(transactionAccountIdsFilter.length),
      });
    }
    return dict.tickerHistory.allAccountsLabel;
  }, [accountNameById, dict.tickerHistory.allAccountsLabel, dict.tickerHistory.analysisAccountsCountLabel, transactionAccountFilter, transactionAccountIdsFilter]);
  const recordMarketCode = transactionMarketFilter ?? detailsState.identity.marketCode;
  const recordCurrency = currencyFor(recordMarketCode);
  const recordAccounts = useMemo(() => {
    const scopedAccountIds = transactionAccountFilter
      ? [transactionAccountFilter]
      : transactionAccountIdsFilter;
    const candidateAccounts = scopedAccountIds
      ? accounts.filter((account) => scopedAccountIds.includes(account.id))
      : accounts;
    return candidateAccounts.filter((account) => account.defaultCurrency === recordCurrency);
  }, [accounts, recordCurrency, transactionAccountFilter, transactionAccountIdsFilter]);
  const recordAccountIds = useMemo(() => recordAccounts.map((account) => account.id), [recordAccounts]);
  const capitalReductionAccounts = useMemo(() => recordAccounts.map((account) => ({ id: account.id, name: account.name, currency: account.defaultCurrency })), [recordAccounts]);
  const recordAccountIdSet = useMemo(() => new Set(recordAccountIds), [recordAccountIds]);
  const defaultRecordAccountId = recordAccountIds[0] ?? "";
  const effectiveHoldingGroup = detailsState.holdingGroup;
  const accountBreakdownRows = effectiveHoldingGroup?.children.length
    ? effectiveHoldingGroup.children
    : detailsState.accountBreakdown;
  const actionDetailRow = effectiveHoldingGroup ?? accountBreakdownRows[0] ?? null;
  const aggregateScopeLabel = effectiveHoldingGroup
    ? `${effectiveHoldingGroup.marketCode} · ${formatNumber(effectiveHoldingGroup.accountCount, locale)}`
    : detailsState.identity.marketCode;

  useEffect(() => {
    setIsClientReady(true);
  }, []);

  useEffect(() => {
    if (openedFromAnalysis) setAnalysisContextCleared(false);
  }, [openedFromAnalysis, searchParamKey]);

  useEffect(() => {
    const queryParams = new URLSearchParams(searchParamKey);
    const next = resolveInitialTickerChartState(
      queryParams,
      details.chart.range ?? "1Y",
      initialChartMetadata.resolved.startDate,
      initialChartMetadata.resolved.endDate,
    );
    setTickerChartSelection((current) => current === next.selection ? current : next.selection);
    setTickerChartRequest((current) => tickerChartRequestsEqual(current, next.request) ? current : next.request);
    setCustomStartDate((current) => current === next.customStartDate ? current : next.customStartDate);
    setCustomEndDate((current) => current === next.customEndDate ? current : next.customEndDate);
  }, [details.chart.range, initialChartMetadata.resolved.endDate, initialChartMetadata.resolved.startDate, searchParamKey]);

  useEffect(() => {
    if (previousOpenedFromAnalysisRef.current === analysisContextActive) return;
    previousOpenedFromAnalysisRef.current = analysisContextActive;
    setTickerChartMetric(analysisContextActive ? "unrealizedPnl" : "price");
  }, [analysisContextActive]);

  useEffect(() => {
    setInstrumentState(instrument);
  }, [instrument]);

  useEffect(() => {
    setDisplayTransactions(transactions);
  }, [transactions]);

  useEffect(() => {
    detailsStateRef.current = details;
    setDetailsState(details);
  }, [details]);

  useEffect(() => {
    detailsStateRef.current = detailsState;
  }, [detailsState]);

  useEffect(() => {
    const cached = readRouteDtoCache<TickerDetailsModel>(tickerDetailsCacheKey, {
      maxAgeMs: isTickerPriceIntradayEnabled && shouldPollForOpenMarket([detailsStateRef.current.quote])
        ? tickerOpenMarketPollMs
        : undefined,
    });
    if (isMatchingTickerDetailsCache(cached, ticker, transactionMarketFilter, reportingCurrency)) {
      detailsStateRef.current = cached.payload;
      setDetailsState(cached.payload);
    }
  }, [isTickerPriceIntradayEnabled, reportingCurrency, ticker, tickerDetailsCacheKey, tickerOpenMarketPollMs, transactionMarketFilter]);

  const refreshDetails = useCallback(async () => {
    setIsDetailsLoading(true);
    try {
      const shouldRefreshQuote = isTickerPriceIntradayEnabled && shouldPollForOpenMarket([detailsStateRef.current.quote]);
      const cached = readRouteDtoCache<TickerDetailsModel>(tickerDetailsCacheKey, {
        maxAgeMs: shouldRefreshQuote ? tickerOpenMarketPollMs : undefined,
      });
      const primaryDetails = isMatchingTickerDetailsCache(cached, ticker, transactionMarketFilter, reportingCurrency)
        ? cached.payload
        : detailsStateRef.current;
      const refreshTickerDetails = shouldRefreshQuote
        ? fetchTickerDetailsFullRefresh
        : fetchTickerDetailsHydration;
      const next = await refreshTickerDetails({
        ticker,
        accountId: transactionAccountFilter,
        accountIds: transactionAccountIdsFilter,
        marketCode: transactionMarketFilter,
        range: tickerChartRequest.range,
        startDate: tickerChartRequest.startDate,
        endDate: tickerChartRequest.endDate,
        includeProvisional: analysisIncludeProvisional,
        instrument,
        transactions,
        primaryDetails,
      });
      detailsStateRef.current = next;
      setDetailsState(next);
      writeRouteDtoCache(tickerDetailsCacheKey, next, TICKER_DETAILS_CACHE_TTL_MS);
    } finally {
      setIsDetailsLoading(false);
    }
  }, [analysisIncludeProvisional, instrument, isTickerPriceIntradayEnabled, reportingCurrency, ticker, tickerChartRequest.endDate, tickerChartRequest.range, tickerChartRequest.startDate, tickerDetailsCacheKey, tickerOpenMarketPollMs, transactionAccountFilter, transactionAccountIdsFilter, transactionMarketFilter, transactions]);

  useEffect(() => {
    void refreshDetails();
  }, [refreshDetails]);

  const shouldPollTickerPrices = isTickerPriceIntradayEnabled && shouldPollForOpenMarket([detailsState.quote]);

  useEffect(() => {
    if (!shouldPollTickerPrices) return;
    const timer = window.setInterval(() => {
      void refreshDetails();
    }, tickerOpenMarketPollMs);
    return () => window.clearInterval(timer);
  }, [refreshDetails, shouldPollTickerPrices, tickerOpenMarketPollMs]);

  const refresh = useCallback(async () => {
    const nextTransactions = await fetchTransactionHistory({
      ticker,
      accountId: transactionAccountFilter,
      accountIds: transactionAccountIdsFilter,
      marketCode: transactionMarketFilter,
    });
    setDisplayTransactions(nextTransactions);
    const nextDetails = await fetchTickerDetailsFullRefresh({
      ticker,
      accountId: transactionAccountFilter,
      accountIds: transactionAccountIdsFilter,
      marketCode: transactionMarketFilter,
      range: tickerChartRequest.range,
      startDate: tickerChartRequest.startDate,
      endDate: tickerChartRequest.endDate,
      includeProvisional: analysisIncludeProvisional,
      instrument,
      transactions: nextTransactions,
      primaryDetails: detailsStateRef.current,
    });
    detailsStateRef.current = nextDetails;
    setDetailsState(nextDetails);
    writeRouteDtoCache(tickerDetailsCacheKey, nextDetails, TICKER_DETAILS_CACHE_TTL_MS);
    router.refresh();
  }, [analysisIncludeProvisional, instrument, router, ticker, tickerChartRequest.endDate, tickerChartRequest.range, tickerChartRequest.startDate, tickerDetailsCacheKey, transactionAccountFilter, transactionAccountIdsFilter, transactionMarketFilter]);

  const handleTickerDividendMarkMatched = useCallback(async (dividendLedgerEntryId: string) => {
    setPendingDividendLedgerEntryId(dividendLedgerEntryId);
    try {
      await updateDividendReconciliation(dividendLedgerEntryId, "matched");
      await refresh();
    } finally {
      setPendingDividendLedgerEntryId(null);
    }
  }, [refresh]);

  const handleDeleteAccepted = useCallback((transactionId: string) => {
    setDisplayTransactions((current) => current.filter((transaction) => transaction.id !== transactionId));
  }, []);

  const mutations = useTransactionMutations({
    locale,
    dict,
    refresh,
    transactions: displayTransactions,
    onDeleteAccepted: handleDeleteAccepted,
  });

  const initialTransaction = useMemo<TransactionInput>(
    () => {
      return resolveTransactionDraftAccount(
        {
          accountId: defaultRecordAccountId,
          ticker,
          // KZO-169: pre-populate marketCode from the most-recent trade event
          // for this ticker. Edit-mode locks both chip + ticker (D9a) so the
          // value is fixed; on Record (instrumentReadOnly=false) the user may
          // still pivot via the chip.
          marketCode: (
            transactionMarketFilter
            ?? transactions[0]?.marketCode
            ?? detailsState.identity.marketCode
          ) as TransactionInput["marketCode"],
          quantity: 1000,
          unitPrice: 100,
          priceCurrency: transactions[0]?.priceCurrency ?? "TWD",
          tradeDate: initialTradeDate,
          type: "BUY",
          isDayTrade: false,
        },
        recordAccounts,
        feeProfiles,
        feeProfileBindings,
      );
    },
    [
      defaultRecordAccountId,
      detailsState.identity.marketCode,
      feeProfileBindings,
      feeProfiles,
      initialTradeDate,
      recordAccounts,
      ticker,
      transactionMarketFilter,
      transactions,
    ],
  );

  const submission = useTransactionSubmission({
    initialValue: initialTransaction,
    noAccountsMessage: dict.feedback.noAccounts,
    tickerRequiredMessage: dict.transactions.tickerRequired,
    successMessage: dict.feedback.transactionSubmitted,
    refresh: async () => {
      await refresh();
      setIsRecordDialogOpen(false);
    },
  });

  const handleDraftChange = useCallback(
    (next: TransactionInput) => {
      const nextAccountId = next.accountId && recordAccountIdSet.has(next.accountId)
        ? next.accountId
        : defaultRecordAccountId;
      const resolvedDraft = resolveTransactionDraftAccount(
        { ...next, ticker, accountId: nextAccountId },
        recordAccounts,
        feeProfiles,
        feeProfileBindings,
      );
      submission.setDraftTransaction((current) =>
        transactionInputsEqual(current, resolvedDraft) ? current : resolvedDraft,
      );
    },
    [defaultRecordAccountId, feeProfileBindings, feeProfiles, recordAccountIdSet, recordAccounts, submission.setDraftTransaction, ticker],
  );

  // KZO-169: include `defaultCurrency` so the chip default + account filter
  // pipeline in AddTransactionCard works consistently from the ticker
  // history page. `accountType` is optional metadata.
  const lockedAccountOptions = useMemo(
    () =>
      recordAccounts
        .map((account) => ({
          id: account.id,
          name: account.name,
          feeProfileName: feeProfiles.find((profile) => profile.id === account.feeProfileId)?.name ?? "",
          defaultCurrency: account.defaultCurrency,
          accountType: account.accountType,
        })),
    [feeProfiles, recordAccounts],
  );

  const cooldownRemaining = useMemo(() => getCooldownRemainingMinutes(instrumentState?.repairAvailableAt), [instrumentState]);
  const isBackfillBusy = instrumentState?.barsBackfillStatus === "pending" || instrumentState?.barsBackfillStatus === "backfilling";
  const repairDisabled = isDemo || isBackfillBusy || cooldownRemaining > 0 || isRepairSubmitting;
  const lastRepairAt = useMemo(() => {
    const raw = instrumentState?.lastRepairAt;
    if (!raw) return null;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }, [instrumentState?.lastRepairAt]);
  const statusText = repairInProgress
    ? dict.tickerHistory.repairStatusRunning
    : lastRepairAt && isClientReady
      ? `${dict.tickerHistory.repairStatusLastRun}: ${formatLastRepairTime(locale, lastRepairAt)}`
      : dict.tickerHistory.repairStatusIdle;
  const repairDisabledReason = isDemo
    ? dict.tickerHistory.repairDisabledDemo
    : isBackfillBusy
      ? dict.settings.repairModeUnavailableBackfill
      : cooldownRemaining > 0
        ? dict.settings.repairModeUnavailableCooldown.replace("{minutes}", String(cooldownRemaining))
        : "";
  const quoteDirection = detailsState.quote.changeAmount == null || detailsState.quote.changeAmount === 0
    ? "neutral"
    : detailsState.quote.changeAmount > 0
      ? "up"
      : "down";
  const quoteAccent = holdingsFinanceSurfaceClass(detailsState.quote.changeAmount);
  const quoteStatusBadgeClassName = detailsState.quote.quoteStatus === "provisional" ? holdingsWarningBadgeClassName : undefined;
  const priceState = getPriceState(detailsState.quote);
  const currentChartMetadata = getTickerChartMetadata(detailsState.chart);
  const chartStartDate = currentChartMetadata.resolved.startDate
    ?? detailsState.chart.points[0]?.date
    ?? currentChartMetadata.requested.startDate
    ?? currentChartMetadata.requested.endDate
    ?? TICKER_CHART_EMPTY_FALLBACK_DATE;
  const chartEndDate = currentChartMetadata.resolved.endDate
    ?? detailsState.chart.points.at(-1)?.date
    ?? currentChartMetadata.requested.endDate
    ?? currentChartMetadata.requested.startDate
    ?? chartStartDate;
  const priceChartAxis = buildTimelineAxis({
    endDate: chartEndDate,
    locale,
    mode: tickerTimelineMode,
    pointDates: detailsState.chart.points.map((point) => point.date),
    startDate: chartStartDate,
  });
  const downsampledPriceChart = downsampleTickerChartPoints(detailsState.chart.points, MAX_TICKER_CHART_POINTS);
  const priceChartData: PriceChartDataPoint[] = downsampledPriceChart.points.map((point) => ({
    date: point.date,
    label: point.label,
    price: resolveTickerChartPrice(point),
    averageCost: resolveTickerChartAverageCost(point, detailsState.position.averageCost),
    quantity: resolveTickerChartQuantity(point, detailsState.position.quantity),
    dateMs: new Date(`${point.date}T00:00:00.000Z`).getTime(),
    axisLabel: point.label === "Now" ? dict.tickerHistory.nowLabel : formatDateLabel(point.date, locale),
  }));
  const pnlChartResolvedStartDate = detailsState.unrealizedPnlHistory[0]?.date ?? null;
  const pnlChartResolvedEndDate = detailsState.unrealizedPnlHistory.at(-1)?.date ?? null;
  const pnlChartStartDate = pnlChartResolvedStartDate
    ?? currentChartMetadata.requested.startDate
    ?? currentChartMetadata.requested.endDate
    ?? TICKER_CHART_EMPTY_FALLBACK_DATE;
  const pnlChartEndDate = pnlChartResolvedEndDate
    ?? currentChartMetadata.requested.endDate
    ?? currentChartMetadata.requested.startDate
    ?? pnlChartStartDate;
  const pnlChartAxis = buildTimelineAxis({
    endDate: pnlChartEndDate,
    locale,
    mode: tickerTimelineMode,
    pointDates: detailsState.unrealizedPnlHistory.map((point) => point.date),
    startDate: pnlChartStartDate,
  });
  const pnlChartData: UnrealizedPnlChartDataPoint[] = detailsState.unrealizedPnlHistory.map((point) => ({
    date: point.date,
    label: point.label,
    unrealizedPnl: finiteNumber(point.unrealizedPnl),
    currency: point.currency,
    quantity: finiteNumber(point.quantity) ?? 0,
    dateMs: new Date(`${point.date}T00:00:00.000Z`).getTime(),
    axisLabel: formatDateLabel(point.date, locale),
  }));
  const unrealizedPnlChartCurrency = detailsState.unrealizedPnlHistory[0]?.currency ?? currency;
  const activeChartResolvedStartDate = tickerChartMetric === "unrealizedPnl"
    ? pnlChartResolvedStartDate
    : currentChartMetadata.resolved.startDate;
  const activeChartResolvedEndDate = tickerChartMetric === "unrealizedPnl"
    ? pnlChartResolvedEndDate
    : currentChartMetadata.resolved.endDate;
  const chartTitle = tickerChartMetric === "unrealizedPnl" ? dict.tickerHistory.unrealizedPnlChartTitle : dict.tickerHistory.chartTitle;
  const chartSubtitle = tickerChartMetric === "unrealizedPnl" ? dict.tickerHistory.unrealizedPnlChartSubtitle : dict.tickerHistory.chartSubtitle;
  const hasPriceChartValues = priceChartData.some((point) => point.price !== null);
  const hasUnrealizedPnlChartValues = pnlChartData.some((point) => point.unrealizedPnl !== null);
  const isPriceChartEmpty = !hasPriceChartValues;
  const isPriceChartLoading = isPriceChartEmpty && isDetailsLoading;
  const isUnrealizedPnlChartEmpty = !hasUnrealizedPnlChartValues;
  const isUnrealizedPnlChartLoading = isUnrealizedPnlChartEmpty && isDetailsLoading;
  const accountContributionData = useMemo(
    () => accountBreakdownRows.map((child) => {
      const reportingCurrency = child.reportingCurrency ?? null;
      const marketValue = reportingCurrency ? child.reportingMarketValueAmount ?? null : null;
      const costBasis = reportingCurrency ? child.reportingCostBasisAmount ?? null : null;
      const contribution = marketValue ?? costBasis;
      return {
        accountId: child.accountId,
        label: child.accountName?.trim() || child.accountId,
        quantity: child.quantity,
        averageCost: child.averageCostPerShare,
        averageCostCurrency: child.currency,
        currentPrice: child.currentUnitPrice,
        contribution,
        contributionCurrency: reportingCurrency,
        marketAllocationPercent: child.reportingMarketAllocationPercent ?? child.reportingAllocationPercent ?? null,
        usedCostBasisFallback: marketValue == null && costBasis != null,
      };
    }),
    [accountBreakdownRows],
  );
  const holdingGroupMarketAllocationPercent = effectiveHoldingGroup?.reportingMarketAllocationPercent ?? effectiveHoldingGroup?.reportingAllocationPercent ?? null;
  const holdingGroupUsesCostBasisFallback = effectiveHoldingGroup?.allocationBasisFallbackReason === "missing_quote";
  const resolvedReportingCurrency =
    accountContributionData.find((row) => row.contributionCurrency)?.contributionCurrency
    ?? effectiveHoldingGroup?.reportingCurrency
    ?? reportingCurrency
    ?? currency;
  const accountBreakdownChartHeight = Math.min(320, Math.max(180, accountContributionData.length * 58));
  const syncTickerChartUrl = useCallback(
    (selection: TickerRangeControl, request: TickerChartRequest) => {
      const nextParams = new URLSearchParams(searchParams.toString());
      nextParams.set("chartRange", selection);
      if (request.startDate && request.endDate) {
        nextParams.set("chartStart", request.startDate);
        nextParams.set("chartEnd", request.endDate);
      } else {
        nextParams.delete("chartStart");
        nextParams.delete("chartEnd");
      }
      const query = nextParams.toString();
      window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
    },
    [pathname, searchParams],
  );

  const selectTickerChartRange = useCallback(
    (selection: TickerRangeControl) => {
      if (!selection) return;
      setTickerChartSelection(selection);
      setTickerChartError("");
      if (selection === "CUSTOM") {
        return;
      }
      const request = buildTickerChartRequest(selection);
      setTickerChartRequest(request);
      syncTickerChartUrl(selection, request);
    },
    [syncTickerChartUrl],
  );

  const applyCustomTickerChartRange = useCallback(() => {
    if (!isValidCustomTickerChartRange(customStartDate, customEndDate)) {
      setTickerChartError(dict.tickerHistory.chartCustomRangeError);
      return;
    }
    const request = buildTickerChartRequest("CUSTOM", customStartDate, customEndDate);
    setTickerChartSelection("CUSTOM");
    setTickerChartError("");
    setTickerChartRequest(request);
    syncTickerChartUrl("CUSTOM", request);
  }, [customEndDate, customStartDate, dict.tickerHistory.chartCustomRangeError, syncTickerChartUrl]);

  const clearAnalysisContext = useCallback(() => {
    const nextRequest = buildTickerChartRequest("1Y");
    setAnalysisContextCleared(true);
    setTickerChartMetric("price");
    setTickerChartError("");
    setTickerChartSelection("1Y");
    setTickerChartRequest(nextRequest);
    setCustomStartDate("");
    setCustomEndDate("");

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("source");
    nextParams.delete("fromDate");
    nextParams.delete("toDate");
    nextParams.delete("includeProvisional");
    nextParams.delete("chartStart");
    nextParams.delete("chartEnd");
    nextParams.set("chartRange", "1Y");
    const query = nextParams.toString();
    window.history.replaceState(null, "", `${pathname}${query ? `?${query}` : ""}`);
  }, [pathname, searchParams]);

  async function handleRepairSubmit(): Promise<void> {
    setIsRepairSubmitting(true);
    setRepairMessage("");
    setRepairError("");
    try {
      const response = await requestRepair({
        tickers: [ticker],
        startDate: repairValue.startDate || undefined,
        endDate: repairValue.endDate || undefined,
        includeBars: repairValue.includeBars,
        includeDividends: repairValue.includeDividends,
      });

      if (response.queued.includes(ticker)) {
        setRepairInProgress(true);
        setRepairMessage(dict.tickerHistory.repairToastQueued);
      }
      if (response.rejected.length > 0) {
        setRepairError(response.rejected.map((item) => `${item.ticker}: ${item.reason}`).join(" | "));
      } else {
        setIsRepairDialogOpen(false);
      }
    } catch (err) {
      setRepairError(err instanceof Error ? err.message : dict.settings.repairRequestError);
    } finally {
      setIsRepairSubmitting(false);
    }
  }

  const handleRepairEvent = useCallback(
    (eventData: unknown) => {
      const event = eventData as { type: string; ticker?: string; reason?: string };
      if (event.ticker !== ticker) return;

      if (event.type === "repair_started") {
        setRepairInProgress(true);
        setRepairMessage(dict.tickerHistory.repairStatusRunning);
      }

      if (event.type === "repair_complete") {
        setRepairInProgress(false);
        setRepairMessage(dict.tickerHistory.repairToastCompleted);
        const now = new Date();
        const nowIso = now.toISOString();
        const optimisticAvailableAt = new Date(now.getTime() + 60 * 60_000).toISOString();
        setInstrumentState((prev) =>
          prev ? { ...prev, lastRepairAt: nowIso, repairAvailableAt: optimisticAvailableAt } : prev,
        );
      }

      if (event.type === "repair_failed") {
        setRepairInProgress(false);
        setRepairError(event.reason ? `${dict.tickerHistory.repairToastFailed} ${event.reason}` : dict.tickerHistory.repairToastFailed);
      }
    },
    [ticker, dict],
  );

  useEventStream({
    eventTypes: REPAIR_EVENT_TYPES,
    enabled: true,
    onEvent: handleRepairEvent,
  });

  return (
    <>
      {isClientReady ? <div aria-hidden="true" className="sr-only" data-testid="ticker-history-client-ready" /> : null}
      <section className="grid gap-6 pb-24 sm:pb-28" data-testid="ticker-history-section">
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
          data-testid="ticker-primary-refresh-strip"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span>{dict.tickerHistory.positionSummaryReadyMessage}</span>
            {isDetailsLoading ? (
              <span className="rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success">
                {dict.tickerHistory.refreshingDetails}
              </span>
            ) : (
              <span className="rounded-full border border-border bg-background px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {dict.tickerHistory.primaryReady}
              </span>
            )}
          </div>
          <Button type="button" variant="secondary" onClick={() => { void refreshDetails(); }} disabled={isDetailsLoading}>
            {dict.tickerHistory.refreshTicker}
          </Button>
        </div>
        <Card className="overflow-hidden rounded-[30px] border border-border bg-[linear-gradient(145deg,hsla(var(--background),0.98),hsla(var(--muted),0.35))] p-0 shadow-[0_28px_70px_rgba(15,23,42,0.08)]">
          <div className="grid gap-8 px-5 py-6 sm:px-6 md:px-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(320px,0.9fr)]">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] uppercase tracking-[0.28em] text-primary/80">{dict.tickerHistory.eyebrow}</p>
                <Badge
                  variant={detailsState.quote.quoteStatus === "current" ? "secondary" : detailsState.quote.quoteStatus === "missing" ? "destructive" : "outline"}
                  className={quoteStatusBadgeClassName}
                >
                  {getHoldingsQuoteStatusLabel(dict, detailsState.quote.quoteStatus)}
                </Badge>
                {priceState ? (
                  <PriceStateChip
                    activityPath={sessionUserRole === "admin" ? buildPriceStateActivityPath({ marketCode: detailsState.identity.marketCode, priceState, ticker }) : null}
                    dict={dict}
                    locale={locale}
                    priceState={priceState}
                    testId="ticker-price-state-chip"
                  />
                ) : null}
              </div>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                <h1 className="text-balance text-3xl font-semibold leading-tight text-foreground sm:text-4xl" data-testid="ticker-history-title">
                  {tickerTitle}
                </h1>
                <span className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-muted-foreground">
                  {detailsState.identity.marketCode} · {detailsState.identity.instrumentType ?? dict.tickerHistory.instrumentFallbackLabel}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="ticker-reporting-currency">
                <Badge variant="secondary">
                  {formatTickerChartMessage(dict.tickerHistory.reportingCurrencyValue, { currency: resolvedReportingCurrency })}
                </Badge>
                <Button type="button" variant="ghost" size="sm" onClick={openQuickActions}>
                  {dict.tickerHistory.changeReportingCurrency}
                </Button>
              </div>
              <div className="mt-5 flex flex-wrap items-end gap-4">
                <div>
                  <p className={metricValueClassName(
                    detailsState.quote.currentPrice != null
                      ? formatCurrencyAmount(detailsState.quote.currentPrice, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                  )}>
                    {detailsState.quote.currentPrice != null
                      ? formatCurrencyAmount(detailsState.quote.currentPrice, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {detailsState.quote.previousClose != null
                      ? `${dict.tickerHistory.previousCloseLabel}: ${formatCurrencyAmount(detailsState.quote.previousClose, currency, locale)}`
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className={cn("rounded-2xl border px-4 py-3 text-sm", quoteAccent)} data-testid="ticker-quote-change">
                  <div className="flex items-center gap-2 font-medium">
                    {quoteDirection === "up" ? <ArrowUpRight className="h-4 w-4" /> : null}
                    {quoteDirection === "down" ? <ArrowDownRight className="h-4 w-4" /> : null}
                    <span>{detailsState.quote.changeAmount != null ? formatCurrencyAmount(detailsState.quote.changeAmount, currency, locale) : "-"}</span>
                    <span>{formatPercent(locale, detailsState.quote.changePercent)}</span>
                  </div>
                  <p className="mt-1 text-xs opacity-80" data-testid="repair-status-badge">{statusText}</p>
                </div>
              </div>
          </div>

            <Card className="rounded-[26px] border-border bg-background/90 p-5 shadow-none">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.floatingSummaryTitle}</p>
                  <p data-testid="ticker-history-market-value" className={metricValueClassName(
                    detailsState.position.marketValue != null
                      ? formatCurrencyAmount(detailsState.position.marketValue, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {detailsState.position.marketValue != null
                      ? formatCurrencyAmount(detailsState.position.marketValue, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <BarChart3 className="h-5 w-5 text-slate-400" />
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.quantityLabel}</p>
                  <p className="mt-1 text-base font-semibold text-foreground" data-testid="ticker-summary-quantity">{formatNumber(detailsState.position.quantity, locale)}</p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.totalCostLabel}</p>
                  <p data-testid="ticker-summary-total-cost" className={metricValueClassName(
                    detailsState.position.costBasis != null
                      ? formatCurrencyAmount(detailsState.position.costBasis, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {detailsState.position.costBasis != null
                      ? formatCurrencyAmount(detailsState.position.costBasis, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.avgCostLabel}</p>
                  <p className={metricValueClassName(
                    detailsState.position.quantity > 0 && detailsState.position.averageCost != null
                      ? formatCurrencyAmount(detailsState.position.averageCost, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {detailsState.position.quantity > 0 && detailsState.position.averageCost != null
                      ? formatCurrencyAmount(detailsState.position.averageCost, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.unrealizedPnlLabel}</p>
                  <p className={metricValueClassName(
                    detailsState.position.unrealizedPnl != null
                      ? formatCurrencyAmount(detailsState.position.unrealizedPnl, currency, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                    holdingsFinanceToneClass(detailsState.position.unrealizedPnl, "text-foreground"),
                  )}>
                    {detailsState.position.unrealizedPnl != null
                      ? formatCurrencyAmount(detailsState.position.unrealizedPnl, currency, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
                <div className="min-w-0 rounded-2xl bg-muted/40 px-4 py-3">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.nextDividendLabel}</p>
                  <p className={metricValueClassName(
                    detailsState.dividends.nextPaymentDate
                      ? formatDateLabel(detailsState.dividends.nextPaymentDate, locale)
                      : dict.tickerHistory.noHoldingData,
                    dict.tickerHistory.noHoldingData,
                    true,
                  )}>
                    {detailsState.dividends.nextPaymentDate
                      ? formatDateLabel(detailsState.dividends.nextPaymentDate, locale)
                      : dict.tickerHistory.noHoldingData}
                  </p>
                </div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Link
                  href="/portfolio"
                  className="inline-flex items-center justify-center rounded-full border border-border bg-background px-4 py-2 text-sm text-primary transition hover:border-primary/40 hover:bg-primary/10"
                >
                  {dict.tickerHistory.backToDashboard}
                </Link>
                <Button
                  variant="secondary"
                  onClick={() => setIsRepairDialogOpen(true)}
                  disabled={repairDisabled}
                  className="gap-1.5"
                  title={repairDisabledReason || dict.tickerHistory.repairButtonCooldownTooltip}
                  data-testid="repair-button"
                >
                  <Wrench className="h-4 w-4" />
                  {dict.tickerHistory.repairAction}
                </Button>
                {canWriteTransactions ? (
                  <Button onClick={() => setIsRecordDialogOpen(true)} data-testid="record-transaction-button" className="gap-1.5">
                    <Plus className="h-4 w-4" />
                    {dict.tickerHistory.recordTransaction}
                  </Button>
                ) : null}
              </div>
            </Card>
          </div>
        </Card>

        <Tabs value={activeTab} onValueChange={selectTickerTab} className="grid gap-6">
          <div className="sm:hidden">
            <Select value={activeTab} onValueChange={selectTickerTab}>
              <SelectTrigger aria-label={dict.tickerHistory.tabsAriaLabel} className="w-full" data-testid="ticker-tab-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="overview">{dict.tickerHistory.overviewTabLabel}</SelectItem>
                  <SelectItem value="dividends" data-testid="ticker-tab-select-dividends">{dict.tickerHistory.dividendsTabLabel}</SelectItem>
                  <SelectItem value="fundamentals">{dict.tickerHistory.fundamentalsTabLabel}</SelectItem>
                  <SelectItem value="transactions">{dict.tickerHistory.transactionsTabLabel}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <TabsList className="hidden w-full justify-start overflow-x-auto rounded-2xl bg-slate-100/90 p-1.5 sm:flex">
            <TabsTrigger value="overview" data-testid="ticker-tab-overview" className="rounded-xl px-4 py-2">
              <BarChart3 className="mr-2 h-4 w-4" />
              {dict.tickerHistory.overviewTabLabel}
            </TabsTrigger>
            <TabsTrigger value="dividends" data-testid="ticker-tab-dividends" className="rounded-xl px-4 py-2">
              <ReceiptText className="mr-2 h-4 w-4" />
              {dict.tickerHistory.dividendsTabLabel}
            </TabsTrigger>
            <TabsTrigger value="fundamentals" data-testid="ticker-tab-fundamentals" className="rounded-xl px-4 py-2">
              <Landmark className="mr-2 h-4 w-4" />
              {dict.tickerHistory.fundamentalsTabLabel}
            </TabsTrigger>
            <TabsTrigger value="transactions" data-testid="ticker-tab-transactions" className="rounded-xl px-4 py-2">
              <ReceiptText className="mr-2 h-4 w-4" />
              {dict.tickerHistory.transactionsTabLabel}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-0 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,0.9fr)]">
            <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]" data-testid="ticker-detail-chart">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{chartTitle}</p>
                  <h2 className="mt-2 text-xl font-semibold text-slate-950">{chartSubtitle}</h2>
                </div>
                <div className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs text-slate-600">
                  {detailsState.identity.currency}
                </div>
              </div>
              <div className="mt-5 flex flex-col gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <span className="text-xs font-medium text-slate-500">{dict.tickerHistory.chartRangeLabel}</span>
                  <Select
                    value={tickerChartSelection}
                    onValueChange={(value) => {
                      if (isTickerRangeControl(value)) selectTickerChartRange(value);
                    }}
                  >
                    <SelectTrigger
                      aria-label={dict.tickerHistory.chartRangeLabel}
                      className="w-full sm:hidden"
                      data-testid="ticker-chart-range-select"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {TICKER_RANGE_ITEMS.map((rangeItem) => (
                          <SelectItem key={rangeItem} value={rangeItem}>
                            {formatTickerChartRangeLabel(dict, rangeItem)}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                  <ToggleGroup
                    type="single"
                    aria-label={dict.tickerHistory.chartRangeLabel}
                    value={tickerChartSelection}
                    onValueChange={(value) => {
                      if (isTickerRangeControl(value)) selectTickerChartRange(value);
                    }}
                    className="hidden flex-wrap justify-start sm:flex"
                    data-testid="ticker-chart-range-controls"
                  >
                    {TICKER_RANGE_ITEMS.map((rangeItem) => (
                      <ToggleGroupItem key={rangeItem} value={rangeItem}>
                        {formatTickerChartRangeLabel(dict, rangeItem)}
                      </ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <span className="text-xs font-medium text-slate-500">{dict.tickerHistory.chartMetricLabel}</span>
                  <ToggleGroup
                    type="single"
                    aria-label={dict.tickerHistory.chartMetricLabel}
                    value={tickerChartMetric}
                    onValueChange={(value) => {
                      if (value === "price" || value === "unrealizedPnl") setTickerChartMetric(value);
                    }}
                    className="flex flex-wrap justify-start"
                    data-testid="ticker-chart-metric-controls"
                  >
                    <ToggleGroupItem value="price">{dict.tickerHistory.currentPriceLabel}</ToggleGroupItem>
                    <ToggleGroupItem value="unrealizedPnl">{dict.tickerHistory.unrealizedPnlLabel}</ToggleGroupItem>
                  </ToggleGroup>
                  {analysisContextActive ? (
                    <div className="flex flex-wrap gap-1 text-xs text-slate-600">
                      <Badge variant="secondary">{dict.tickerHistory.analysisSourceLabel}</Badge>
                      {activeChartResolvedStartDate && activeChartResolvedEndDate ? (
                        <Badge variant="secondary">{activeChartResolvedStartDate} - {activeChartResolvedEndDate}</Badge>
                      ) : null}
                      {transactionAccountFilter ? <Badge variant="secondary">{dict.tickerHistory.analysisAccountCountLabel}</Badge> : null}
                      {!transactionAccountFilter && transactionAccountIdsFilter?.length ? (
                        <Badge variant="secondary">
                          {formatTickerChartMessage(dict.tickerHistory.analysisAccountsCountLabel, { count: String(transactionAccountIdsFilter.length) })}
                        </Badge>
                      ) : null}
                      <Button type="button" variant="ghost" size="sm" onClick={clearAnalysisContext}>
                        {dict.tickerHistory.clearAnalysisRangeLabel}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {tickerChartSelection === "CUSTOM" ? (
                  <div className="flex flex-wrap items-end gap-2" data-testid="ticker-chart-custom-range">
                    <label className="grid gap-1 text-xs text-slate-500">
                      <span>{dict.tickerHistory.chartCustomStartLabel}</span>
                      <Input type="date" value={customStartDate} onChange={(event) => setCustomStartDate(event.target.value)} className="h-9 w-[150px]" />
                    </label>
                    <label className="grid gap-1 text-xs text-slate-500">
                      <span>{dict.tickerHistory.chartCustomEndLabel}</span>
                      <Input type="date" value={customEndDate} onChange={(event) => setCustomEndDate(event.target.value)} className="h-9 w-[150px]" />
                    </label>
                    <Button type="button" variant="secondary" onClick={applyCustomTickerChartRange}>
                      {dict.tickerHistory.chartApplyCustomRange}
                    </Button>
                  </div>
                ) : null}
                {tickerChartError ? <p className="text-sm text-destructive">{tickerChartError}</p> : null}
                <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3">
                  <span className="text-xs font-medium text-slate-500">{dict.tickerHistory.chartTimelineLabel}</span>
                  <Select
                    value={tickerTimelineMode}
                    onValueChange={(value) => {
                      if (value === "auto" || value === "day" || value === "week" || value === "month" || value === "year") {
                        setTickerTimelineMode(value);
                      }
                    }}
                  >
                    <SelectTrigger
                      aria-label={dict.tickerHistory.chartTimelineLabel}
                      className="w-full sm:hidden"
                      data-testid="ticker-chart-timeline-select"
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
                    type="single"
                    aria-label={dict.tickerHistory.chartTimelineLabel}
                    value={tickerTimelineMode}
                    onValueChange={(value) => {
                      if (value === "auto" || value === "day" || value === "week" || value === "month" || value === "year") {
                        setTickerTimelineMode(value);
                      }
                    }}
                    className="hidden flex-wrap justify-start sm:flex"
                    data-testid="ticker-chart-timeline-controls"
                  >
                    <ToggleGroupItem value="auto">{dict.reports.timelineAuto}</ToggleGroupItem>
                    <ToggleGroupItem value="day">{dict.reports.timelineDay}</ToggleGroupItem>
                    <ToggleGroupItem value="week">{dict.reports.timelineWeek}</ToggleGroupItem>
                    <ToggleGroupItem value="month">{dict.reports.timelineMonth}</ToggleGroupItem>
                    <ToggleGroupItem value="year">{dict.reports.timelineYear}</ToggleGroupItem>
                  </ToggleGroup>
                </div>
                {tickerChartMetric === "price" && (currentChartMetadata.truncated.startDate || currentChartMetadata.truncated.endDate) ? (
                  <p className="text-sm text-warning">
                    {formatTickerChartMessage(dict.tickerHistory.chartTruncatedNote, {
                      start: currentChartMetadata.resolved.startDate ?? "-",
                      end: currentChartMetadata.resolved.endDate ?? "-",
                    })}
                  </p>
                ) : null}
                {tickerChartMetric === "price" && downsampledPriceChart.downsampled ? (
                  <p className="text-sm text-slate-500">
                    {formatTickerChartMessage(dict.tickerHistory.chartDownsampledNote, {
                      shown: String(downsampledPriceChart.points.length),
                      total: String(downsampledPriceChart.total),
                    })}
                  </p>
                ) : null}
              </div>
              <div className="mt-6 h-[320px]">
                {tickerChartMetric === "unrealizedPnl" ? (
                  isUnrealizedPnlChartLoading ? (
                    <ChartEmptyState>{dict.tickerHistory.priceChartLoadingState}</ChartEmptyState>
                  ) : isUnrealizedPnlChartEmpty ? (
                    <ChartEmptyState>{dict.tickerHistory.unrealizedPnlEmptyState}</ChartEmptyState>
                  ) : (
                    <UnrealizedPnlChart
                      axis={pnlChartAxis}
                      currency={unrealizedPnlChartCurrency}
                      data={pnlChartData}
                      dict={dict}
                      locale={locale}
                    />
                  )
                ) : isPriceChartLoading ? (
                  <ChartEmptyState>{dict.tickerHistory.priceChartLoadingState}</ChartEmptyState>
                ) : isPriceChartEmpty ? (
                  <ChartEmptyState>{dict.tickerHistory.priceChartEmptyState}</ChartEmptyState>
                ) : (
                  <PriceVsAverageCostChart
                    axis={priceChartAxis}
                    currency={currency}
                    data={priceChartData}
                    dict={dict}
                    locale={locale}
                  />
                )}
              </div>
            </Card>

            <div className="grid gap-6">
              <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.dividendsPanelTitle}</p>
                <div className="mt-4 grid gap-3">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.upcomingDividendsLabel}</p>
                    <p className="mt-1 text-xl font-semibold text-slate-950">{formatNumber(detailsState.dividends.upcomingCount, locale)}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.nextDividendLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {detailsState.dividends.nextPaymentDate
                        ? formatDateLabel(detailsState.dividends.nextPaymentDate, locale)
                        : dict.tickerHistory.noHoldingData}
                    </p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.lastDividendLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">
                      {detailsState.dividends.lastPostedDate
                        ? formatDateLabel(detailsState.dividends.lastPostedDate, locale)
                        : dict.tickerHistory.noHoldingData}
                    </p>
                  </div>
                </div>
              </Card>
              <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.positionSummaryTitle}</p>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.accountScopeLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{accountScopeDisplayName}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.aggregateScopeLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{aggregateScopeLabel}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-50 px-4 py-3" data-testid="ticker-position-summary-market-allocation">
                    <p className="text-sm text-slate-500">{dict.tickerHistory.marketAllocationLabel}</p>
                    <p className="mt-1 text-base font-semibold text-slate-950">{formatPercent(locale, holdingGroupMarketAllocationPercent)}</p>
                  </div>
                </div>
                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50/70 px-4 py-3 text-sm text-slate-600">
                  <p className="font-medium text-slate-900">{dict.tickerHistory.marketAllocationTitle}</p>
                  <p className="mt-1">{dict.tickerHistory.marketAllocationSubtitle}</p>
                  <p className="mt-2">
                    {holdingGroupUsesCostBasisFallback
                      ? dict.holdings.allocationFallbackMissingQuote
                      : formatTickerChartMessage(dict.tickerHistory.marketAllocationBasisSummary, {
                          basis: effectiveHoldingGroup?.allocationBasisUsed === "cost_basis"
                            ? dict.dashboardHome.allocationBasisCostBasis
                            : dict.dashboardHome.allocationBasisMarketValue,
                        })}
                  </p>
                </div>
              </Card>
              <Card className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]" data-testid="ticker-account-breakdown">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.accountBreakdownTitle}</p>
                <h3 className="mt-2 text-base font-semibold text-slate-950">{dict.tickerHistory.accountBreakdownContributionTitle}</h3>
                <p className="mt-1 text-sm text-slate-500">{dict.tickerHistory.accountBreakdownSubtitle}</p>
                <div className="mt-3 flex flex-wrap items-center gap-2" data-testid="ticker-account-breakdown-reporting-currency">
                  <Badge variant="outline">
                    {formatTickerChartMessage(dict.tickerHistory.reportingCurrencyValue, { currency: resolvedReportingCurrency })}
                  </Badge>
                  <p className="text-xs text-muted-foreground">{dict.tickerHistory.reportingCurrencyDescription}</p>
                </div>
                {accountContributionData.length === 0 ? (
                  <p className="mt-4 rounded-2xl bg-slate-50 px-4 py-4 text-sm text-slate-500">{dict.tickerHistory.accountBreakdownEmpty}</p>
                ) : (
                  <>
                    <div className="mt-4 w-full min-w-0" style={{ height: accountBreakdownChartHeight }}>
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={accountContributionData} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                          <XAxis type="number" hide />
                          <YAxis
                            type="category"
                            dataKey="label"
                            width={72}
                            tickFormatter={(value: string) => truncateChartLabel(value)}
                            tickLine={false}
                            axisLine={false}
                          />
                          <Tooltip
                            formatter={(value, _name, item) => {
                              const payload = (item as { payload?: { contributionCurrency?: string } }).payload;
                              return typeof value === "number"
                                ? formatCurrencyAmount(value, payload?.contributionCurrency ?? currency, locale)
                                : value;
                            }}
                          />
                          <Bar dataKey="contribution" fill="#2563eb" radius={[6, 6, 6, 6]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="mt-4 grid gap-3" data-testid="ticker-account-breakdown-rows">
                      {accountContributionData.map((row) => (
                        <div
                          key={row.accountId}
                          className="min-w-0 rounded-2xl border border-border bg-muted/30 p-4 text-sm"
                          data-testid={`ticker-account-breakdown-row-${row.accountId}`}
                        >
                          <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                {dict.tickerHistory.accountBreakdownAccountLabel}
                              </p>
                              <p className="mt-1 break-words font-semibold text-foreground">{row.label}</p>
                            </div>
                            <div className="grid min-w-0 gap-3 sm:min-w-[440px] sm:grid-cols-5">
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">{dict.tickerHistory.quantityLabel}</p>
                                <p className="mt-1 break-words font-medium text-foreground">{formatNumber(row.quantity, locale)}</p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">{dict.tickerHistory.avgCostLabel}</p>
                                <p className="mt-1 break-words font-medium text-foreground">
                                  {formatCurrencyAmount(row.averageCost, row.averageCostCurrency, locale)}
                                </p>
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">{dict.holdings.unitPnlTerm}</p>
                                {(() => {
                                  const unitPnl = getNativeUnitPnl(row.currentPrice, row.averageCost);
                                  return (
                                    <>
                                      <p className="mt-1 break-words font-medium text-foreground">
                                        {unitPnl.amount == null ? "-" : formatCurrencyAmount(unitPnl.amount, row.averageCostCurrency, locale)}
                                      </p>
                                      <p className="mt-1 break-words text-xs text-muted-foreground">
                                        {unitPnl.percent == null ? "-" : `${formatNumber(unitPnl.percent, locale)}%`}
                                      </p>
                                    </>
                                  );
                                })()}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">{dict.tickerHistory.accountContributionLabel}</p>
                                <p className="mt-1 break-words font-semibold text-foreground">
                                  {row.contribution != null && row.contributionCurrency
                                    ? formatCurrencyAmount(row.contribution, row.contributionCurrency, locale)
                                    : dict.tickerHistory.noHoldingData}
                                </p>
                                {row.usedCostBasisFallback ? (
                                  <p className="mt-1 break-words text-xs font-normal text-warning">
                                    {dict.dashboardHome.allocationFallbackLabel}
                                  </p>
                                ) : null}
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">{dict.tickerHistory.marketAllocationLabel}</p>
                                <p className="mt-1 break-words font-medium text-foreground">{formatPercent(locale, row.marketAllocationPercent)}</p>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                </Card>
              </div>
              {recordMarketCode === "TW" ? (
                <div className="min-w-0 lg:col-span-2">
                  <CapitalReductionPanel ticker={ticker} accounts={capitalReductionAccounts} locale={locale} onChanged={() => { void refresh(); }} />
                </div>
              ) : null}
              {actionDetailRow ? (
                <div className="min-w-0 lg:col-span-2">
                  <HoldingActionDetail
                    dict={dict}
                    locale={locale}
                    marketCode={detailsState.identity.marketCode}
                    onActionPosted={refresh}
                    row={actionDetailRow}
                    showCapitalReduction={false}
                    transactions={displayTransactions}
                    allowAuthoring
                  />
                </div>
              ) : null}
          </TabsContent>

          <TabsContent value="dividends" className="mt-0" data-testid="ticker-detail-dividends-tab">
            <TickerDividendsTab
              dict={dict}
              locale={locale}
              marketCode={detailsState.identity.marketCode}
              ticker={detailsState.identity.ticker}
              tickerName={detailsState.identity.name}
              accountId={transactionAccountFilter}
              accountIds={transactionAccountIdsFilter}
              dividends={detailsState.dividends}
              onMarkMatched={handleTickerDividendMarkMatched}
              pendingLedgerEntryId={pendingDividendLedgerEntryId}
              canWriteDividends={canWriteDividends}
            />
          </TabsContent>

          <TabsContent value="fundamentals" className="mt-0 grid gap-6 lg:grid-cols-2" data-testid="ticker-detail-fundamentals">
            {detailsState.fundamentals.panels.map((panel) => (
              <Card key={panel.key} className="rounded-[28px] border-slate-200 bg-white/94 p-5 shadow-[0_18px_34px_rgba(148,163,184,0.12)]">
                <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{panel.title}</p>
                <div className="mt-4 grid gap-3">
                  {panel.items.map((item) => (
                    <div key={item.key} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm text-slate-500">{item.label}</p>
                          <p className="mt-1 text-base font-semibold text-slate-950">
                            {typeof item.value === "number"
                              ? formatCompactNumber(locale, item.value)
                              : item.value ?? dict.tickerHistory.fundamentalsUnavailable}
                          </p>
                        </div>
                        {(item.source || item.asOf) ? (
                          <div className="text-right text-[11px] text-slate-400">
                            <p>{item.source ?? ""}</p>
                            <p>{item.asOf ? formatDateLabel(item.asOf, locale) : ""}</p>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </TabsContent>

          <TabsContent value="transactions" className="mt-0 grid gap-6" data-testid="ticker-detail-transactions">
            {!canWriteTransactions ? (
              <div
                className="rounded-[22px] border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                data-testid="ticker-history-readonly"
                role="status"
                aria-live="polite"
              >
                {dict.switcher.readonlyDescription}
              </div>
            ) : null}
            <TransactionHistoryTable
              transactions={displayTransactions}
              dict={dict}
              locale={locale}
              onDeleteRequest={canDeleteTransactions ? mutations.startDelete : undefined}
              editingId={canWriteTransactions ? mutations.editingId : null}
              onEditStart={canWriteTransactions ? mutations.startEdit : undefined}
              onEditCancel={canWriteTransactions ? mutations.cancelEdit : undefined}
              onEditSave={canWriteTransactions ? mutations.submitEdit : undefined}
              recomputingIds={mutations.recomputingIds}
            />
          </TabsContent>
        </Tabs>
      </section>

      <RecordTransactionDialog
        open={isRecordDialogOpen}
        onOpenChange={setIsRecordDialogOpen}
        value={submission.draftTransaction}
        onChange={handleDraftChange}
        onUnitPriceEdited={submission.markUnitPriceEdited}
        onSubmit={async () => {
          await submission.submit();
        }}
        pending={submission.isSubmitting}
        accountOptions={lockedAccountOptions}
        message={submission.message}
        errorMessage={submission.errorMessage}
        title={dict.tickerHistory.recordTransaction}
        dict={dict}
        locale={locale}
        instrumentReadOnly
        priceHint={submission.priceHint}
        showPriceUnavailableHint={submission.showPriceUnavailableHint}
        feeEstimate={submission.feeEstimate}
        sellAvailability={submission.sellAvailability}
        sellAvailabilityRequestKey={submission.sellAvailabilityRequestKey}
        isSellAvailabilityLoading={submission.isSellAvailabilityLoading}
        sellAvailabilityTransportError={submission.sellAvailabilityTransportError}
      />

      <RepairModal
        open={isRepairDialogOpen}
        pending={isRepairSubmitting}
        title={formatTickerChartMessage(dict.tickerHistory.repairDialogTitle, { ticker })}
        subtitle={statusText}
        value={repairValue}
        onOpenChange={setIsRepairDialogOpen}
        onChange={setRepairValue}
        onSubmit={handleRepairSubmit}
        dict={dict}
      />

      <DeleteConfirmationDialog
        open={mutations.isDeleteDialogOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelDelete();
        }}
        transaction={mutations.deleteTarget}
        preview={mutations.deletePreview}
        dividendPreview={mutations.deleteDividendPreview}
        isLoading={mutations.isDeletePreviewLoading}
        isSubmitting={mutations.isDeleteSubmitting}
        errorMessage={mutations.errorMessage}
        statusMessage={mutations.message}
        onConfirm={mutations.confirmDelete}
        dict={dict}
        locale={locale}
      />
      <EditConfirmationDialog
        open={mutations.isEditPreviewOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelEditPreview();
        }}
        preview={mutations.editPreview}
        isLoading={mutations.isEditPreviewLoading}
        isSubmitting={mutations.isEditSubmitting}
        onConfirm={mutations.confirmEdit}
        dict={dict}
        locale={locale}
      />
      <FeeRecalcConfirmDialog
        open={mutations.isFeeConfirmOpen}
        onOpenChange={(open) => {
          if (!open) mutations.cancelEdit();
        }}
        onRecalculate={mutations.confirmFeeRecalc}
        onKeepManual={mutations.keepManualFees}
        dict={dict}
      />

      <StatusToast message={mutations.message} variant="success" testId="mutation-status" />
      <StatusToast message={mutations.errorMessage} variant="error" testId="mutation-error" />
      <StatusToast message={repairMessage} variant="success" testId="repair-status" />
      <StatusToast message={repairError} variant="error" testId="repair-error" />
    </>
  );
}
