import type { FastifyInstance } from "fastify";
import { derivePortfolioCapabilities, roundToDecimal, resolveRangeBounds } from "@vakwen/domain";
import {
  ACCOUNT_DEFAULT_CURRENCIES,
  MARKET_CODES,
  UNREALIZED_PNL_GRANULARITIES,
  UNREALIZED_PNL_POSITION_STATUS_FILTERS,
  UNREALIZED_PNL_SELECTIONS,
  UNREALIZED_PNL_TICKER_MODES,
  type AccountDefaultCurrency,
  type InstrumentType,
  type MarketCode,
  type PortfolioCapabilitiesDto,
  type UnrealizedPnlAnalysisDto,
  type UnrealizedPnlAnalysisQueryStateDto,
  type UnrealizedPnlGranularity,
  type UnrealizedPnlMetricBoundary,
  type UnrealizedPnlAmountSemantics,
  type UnrealizedPnlAnalysisMetadataDto,
  type UnrealizedPnlPositionStatus,
  type UnrealizedPnlRequestedTickerAvailabilityDto,
  type UnrealizedPnlRankingRowDto,
  type UnrealizedPnlTickerCompositionRowDto,
  type UnrealizedPnlTickerRefDto,
  type UnrealizedPnlTradeMarkerDto,
  type UnrealizedPnlTradeMarkerKind,
} from "@vakwen/shared-types";
import { z } from "zod";
import { listTradeEvents } from "./accountingStore.js";
import { resolveReportingCurrency } from "./userPreferences.js";
import { routeError } from "../lib/routeError.js";

const DEFAULT_RANGE = "3M";
const DEFAULT_GRANULARITY: UnrealizedPnlGranularity = "weekly";
const DEFAULT_DRIVER_COUNT = 5;
const MAX_RENDERED_CANDIDATE_COUNT = 200;
const NOISY_CHART_LINE_THRESHOLD = 20;
const MAX_FILTER_ITEMS = 200;
const MIN_ANALYSIS_DATE = "1900-01-01";

const UNREALIZED_PNL_METRICS = {
  start: {
    field: "startUnrealizedPnlAmount",
    amountSemantics: "unrealized_pnl_level" as const satisfies UnrealizedPnlAmountSemantics,
    boundary: "period_start" as const satisfies UnrealizedPnlMetricBoundary,
  },
  end: {
    field: "endUnrealizedPnlAmount",
    amountSemantics: "unrealized_pnl_level" as const satisfies UnrealizedPnlAmountSemantics,
    boundary: "period_end" as const satisfies UnrealizedPnlMetricBoundary,
  },
  periodChange: {
    field: "periodChangeAmount",
    amountSemantics: "unrealized_pnl_period_change" as const,
    boundary: "period_change" as const satisfies UnrealizedPnlMetricBoundary,
  },
} as const;

function toPositionStatus(latestQuantity: number): UnrealizedPnlPositionStatus {
  return latestQuantity > 0 ? "open_position" : "closed_position";
}

function buildUnrealizedPnlMetadata(reportingCurrency: AccountDefaultCurrency): UnrealizedPnlAnalysisMetadataDto {
  return {
    reportingCurrencySemantics: {
      reportingCurrency,
      appliesToFields: ["startUnrealizedPnlAmount", "endUnrealizedPnlAmount", "periodChangeAmount"],
    },
    metricDefinitions: {
      startUnrealizedPnlAmount: {
        field: UNREALIZED_PNL_METRICS.start.field,
        amountSemantics: UNREALIZED_PNL_METRICS.start.amountSemantics,
        boundary: UNREALIZED_PNL_METRICS.start.boundary,
        unit: "reporting_currency",
        reportingCurrency,
      },
      endUnrealizedPnlAmount: {
        field: UNREALIZED_PNL_METRICS.end.field,
        amountSemantics: UNREALIZED_PNL_METRICS.end.amountSemantics,
        boundary: UNREALIZED_PNL_METRICS.end.boundary,
        unit: "reporting_currency",
        reportingCurrency,
      },
      periodChangeAmount: {
        field: UNREALIZED_PNL_METRICS.periodChange.field,
        amountSemantics: UNREALIZED_PNL_METRICS.periodChange.amountSemantics,
        boundary: UNREALIZED_PNL_METRICS.periodChange.boundary,
        unit: "reporting_currency",
        reportingCurrency,
      },
    },
  };
}

function isIsoCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

const isoDateSchema = z.string().refine(isIsoCalendarDate, {
  message: "Expected a valid ISO calendar date (YYYY-MM-DD)",
});

const tickerSchema = z.string().trim().min(1).max(32).transform((value) => value.toUpperCase());
const accountIdSchema = z.string().trim().min(1).max(200);
const marketCodeSchema = z.enum(MARKET_CODES);
const INSTRUMENT_TYPES = ["STOCK", "ETF", "BOND_ETF"] as const satisfies readonly InstrumentType[];
const instrumentTypeSchema = z.enum(INSTRUMENT_TYPES);
const granularitySchema = z.enum(UNREALIZED_PNL_GRANULARITIES);
const positionStatusFilterSchema = z.enum(UNREALIZED_PNL_POSITION_STATUS_FILTERS);
const selectionSchema = z.enum(UNREALIZED_PNL_SELECTIONS);
const tickerModeSchema = z.enum(UNREALIZED_PNL_TICKER_MODES);
const driverCountSchema = z.union([z.literal(5), z.literal(10), z.literal(20)]);
const reportingCurrencySchema = z.enum(ACCOUNT_DEFAULT_CURRENCIES);
const PERFORMANCE_RANGE_ELEMENT = /^YTD$|^ALL$|^([1-9]\d*)(M|Y)$/;
const performanceRangeSchema = z
  .string()
  .trim()
  .min(1)
  .max(20)
  .refine((value) => {
    const match = PERFORMANCE_RANGE_ELEMENT.exec(value);
    if (!match) return false;
    if (value === "YTD" || value === "ALL") return true;
    const amount = Number(match[1]);
    if (!Number.isInteger(amount) || amount <= 0) return false;
    return match[2] === "M" ? amount <= 240 : amount <= 50;
  }, { message: "invalid_analysis_range" });
const booleanQuerySchema = z.preprocess((value) => {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === true || value === "true" || value === "1") return true;
  if (value === false || value === "false" || value === "0") return false;
  return value;
}, z.boolean().optional());

const tickerRefSchema = z.object({
  ticker: tickerSchema,
  marketCode: marketCodeSchema,
}).strict();

function parseTickerRef(value: string): unknown {
  const parts = value.split(":");
  const [marketCode, ticker] = parts;
  if (!marketCode || !ticker || !MARKET_CODES.includes(marketCode as MarketCode)) {
    return { marketCode: marketCode ?? "", ticker: ticker ?? "" };
  }
  if (parts.length !== 2) {
    return { marketCode, ticker: parts.slice(1).join(":") };
  }
  return {
    marketCode: marketCode as MarketCode,
    ticker: ticker.trim().toUpperCase(),
  };
}

function normalizeCsvList(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const raw = Array.isArray(value) ? value : [value];
  return raw
    .flatMap((item) => String(item).split(","))
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const routeTickerRefsSchema = z.preprocess((value) => normalizeCsvList(value)?.map((item) => parseTickerRef(item)), z.array(tickerRefSchema).max(MAX_FILTER_ITEMS).optional());

export const unrealizedPnlAnalysisRouteQuerySchema = z.object({
  granularity: granularitySchema.optional(),
  range: performanceRangeSchema.optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  markets: z.preprocess(normalizeCsvList, z.array(marketCodeSchema).max(MARKET_CODES.length).optional()),
  accountIds: z.preprocess(normalizeCsvList, z.array(accountIdSchema).max(MAX_FILTER_ITEMS).optional()),
  tickerIds: routeTickerRefsSchema,
  instrumentTypes: z.preprocess(normalizeCsvList, z.array(instrumentTypeSchema).max(3).optional()),
  selection: selectionSchema.optional(),
  tickerMode: tickerModeSchema.optional(),
  drivers: z.coerce.number().pipe(driverCountSchema).optional(),
  positionStatus: positionStatusFilterSchema.optional(),
  reportingCurrency: reportingCurrencySchema.optional(),
  includeProvisional: booleanQuerySchema,
}).strip();

export const unrealizedPnlAnalysisMcpInputSchema = z.object({
  granularity: granularitySchema.optional(),
  range: performanceRangeSchema.optional(),
  fromDate: isoDateSchema.optional(),
  toDate: isoDateSchema.optional(),
  markets: z.array(marketCodeSchema).max(MARKET_CODES.length).optional(),
  accountIds: z.array(accountIdSchema).max(MAX_FILTER_ITEMS).optional(),
  tickerIds: z.array(tickerRefSchema).max(MAX_FILTER_ITEMS).optional(),
  instrumentTypes: z.array(instrumentTypeSchema).max(3).optional(),
  selection: selectionSchema.optional(),
  tickerMode: tickerModeSchema.optional(),
  drivers: driverCountSchema.optional(),
  positionStatus: positionStatusFilterSchema.optional(),
  reportingCurrency: reportingCurrencySchema.optional(),
  includeProvisional: z.boolean().optional(),
}).strip();

export type UnrealizedPnlAnalysisInput = z.infer<typeof unrealizedPnlAnalysisMcpInputSchema>;

type ResolvedInput = UnrealizedPnlAnalysisQueryStateDto;

interface BucketDescriptor {
  key: string;
  sortDate: string;
}

interface AggregatedPoint {
  date: string;
  unrealizedPnlAmount: number | null;
  marketValueAmount: number | null;
  costBasisAmount: number | null;
  quantity: number;
  closePrice: number | null;
  fxAvailable: boolean;
  isProvisional: boolean;
  accountIds: string[];
  snapshotDate: string | null;
  snapshotProviderSources: string[];
  fxAsOfDate: string | null;
}

interface TickerSeriesAggregate {
  ticker: string;
  marketCode: MarketCode;
  instrumentName: string | null;
  instrumentType: InstrumentType | null;
  accountIds: string[];
  accountNames: string[];
  points: AggregatedPoint[];
  latestQuantity: number;
  tradeMarkers: UnrealizedPnlTradeMarkerDto[];
}

function compareTickerRefs(left: UnrealizedPnlTickerRefDto, right: UnrealizedPnlTickerRefDto): number {
  return left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
}

function tickerKey(input: UnrealizedPnlTickerRefDto): string {
  return `${input.marketCode}:${input.ticker}`;
}

function tradeSortKey(
  left: { tradeDate: string; bookingSequence?: number; tradeTimestamp?: string; id: string },
  right: { tradeDate: string; bookingSequence?: number; tradeTimestamp?: string; id: string },
): number {
  return left.tradeDate.localeCompare(right.tradeDate)
    || (left.bookingSequence ?? 0) - (right.bookingSequence ?? 0)
    || (left.tradeTimestamp ?? "").localeCompare(right.tradeTimestamp ?? "")
    || left.id.localeCompare(right.id);
}

function isoWeekKey(date: string): string {
  const utc = new Date(`${date}T00:00:00.000Z`);
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function bucketKeyForDate(date: string, granularity: UnrealizedPnlGranularity): string {
  switch (granularity) {
    case "daily":
      return date;
    case "weekly":
      return isoWeekKey(date);
    case "monthly":
      return date.slice(0, 7);
    case "yearly":
      return date.slice(0, 4);
  }
}

function assertAnalysisDateBounds(startDate: string, endDate: string, granularity: UnrealizedPnlGranularity): void {
  if (startDate > endDate) {
    throw routeError(400, "invalid_analysis_date_range", "fromDate must be less than or equal to toDate");
  }
  if (granularity === "yearly") return;
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  const maxEnd = new Date(start);
  maxEnd.setUTCFullYear(maxEnd.getUTCFullYear() + 5);
  if (end > maxEnd) {
    throw routeError(400, "invalid_analysis_range_bounds", "daily, weekly, and monthly analysis is limited to 5Y");
  }
}

function resolveInput(
  input: UnrealizedPnlAnalysisInput,
  defaultReportingCurrency: AccountDefaultCurrency,
  earliestTradeDate?: string,
): ResolvedInput {
  const asOf = input.toDate ?? new Date().toISOString().slice(0, 10);
  const granularity = input.granularity ?? DEFAULT_GRANULARITY;
  if (input.range === "ALL" && granularity !== "yearly") {
    throw routeError(400, "invalid_analysis_range", "ALL is only supported for yearly granularity");
  }

  let startDate: string;
  let endDate: string;
  let range: UnrealizedPnlAnalysisQueryStateDto["range"];
  if (input.fromDate || input.toDate) {
    startDate = input.fromDate ?? input.toDate ?? asOf;
    endDate = input.toDate ?? asOf;
    range = null;
  } else {
    const resolvedRange = input.range ?? DEFAULT_RANGE;
    range = resolvedRange as UnrealizedPnlAnalysisQueryStateDto["range"];
    const bounds = resolveRangeBounds(resolvedRange, asOf, resolvedRange === "ALL" ? earliestTradeDate : undefined);
    startDate = bounds.startDate;
    endDate = bounds.endDate;
  }

  assertAnalysisDateBounds(startDate, endDate, granularity);

  const requestedTickers = [...(input.tickerIds ?? [])].sort(compareTickerRefs);
  const tickerMode = requestedTickers.length > 0 ? "custom" : (input.tickerMode ?? "allEligible");
  return {
    granularity,
    range,
    fromDate: input.fromDate ?? null,
    toDate: input.toDate ?? null,
    startDate,
    endDate,
    markets: [...(input.markets ?? [])].sort(),
    accountIds: [...(input.accountIds ?? [])].sort(),
    tickerIds: requestedTickers.map(tickerKey),
    instrumentTypes: [...(input.instrumentTypes ?? [])].sort() as InstrumentType[],
    selection: input.selection ?? "topDrivers",
    tickerMode,
    requestedTickers,
    drivers: input.drivers ?? DEFAULT_DRIVER_COUNT,
    positionStatus: input.positionStatus ?? "openOnly",
    reportingCurrency: input.reportingCurrency ?? defaultReportingCurrency,
    includeProvisional: input.includeProvisional ?? false,
    asOf,
  };
}

function buildBucketDescriptors(
  rows: ReadonlyArray<{ snapshotDate: string }>,
  granularity: UnrealizedPnlGranularity,
): BucketDescriptor[] {
  const descriptors = new Map<string, string>();
  for (const row of rows) {
    const key = bucketKeyForDate(row.snapshotDate, granularity);
    const current = descriptors.get(key);
    if (!current || row.snapshotDate > current) {
      descriptors.set(key, row.snapshotDate);
    }
  }
  return [...descriptors.entries()]
    .map(([key, sortDate]) => ({ key, sortDate }))
    .sort((left, right) => left.sortDate.localeCompare(right.sortDate));
}

function aggregateBucketRows(
  rows: ReadonlyArray<{
    snapshotDate: string;
    accountId: string;
    marketCode: string;
    ticker?: string;
    costBasisAmount: number | null;
    marketValueAmount: number | null;
    unrealizedPnlAmount: number | null;
    quantity: number;
    closePrice: number | null;
    fxAvailable: boolean;
    isProvisional: boolean;
    providerSource?: string | null;
    fxAsOfDate?: string | null;
  }>,
  descriptors: readonly BucketDescriptor[],
  granularity: UnrealizedPnlGranularity,
  contributorKeyForRow: (row: typeof rows[number], bucketKey: string) => string = (row, bucketKey) => `${row.accountId}\0${row.marketCode}\0${bucketKey}`,
): AggregatedPoint[] {
  const byContributorAndBucket = new Map<string, typeof rows[number]>();
  for (const row of rows) {
    const bucketKey = bucketKeyForDate(row.snapshotDate, granularity);
    const contributorKey = contributorKeyForRow(row, bucketKey);
    const current = byContributorAndBucket.get(contributorKey);
    if (!current || row.snapshotDate > current.snapshotDate) {
      byContributorAndBucket.set(contributorKey, row);
    }
  }

  const byBucket = new Map<string, Array<typeof rows[number]>>();
  for (const row of byContributorAndBucket.values()) {
    const bucketKey = bucketKeyForDate(row.snapshotDate, granularity);
    const bucketRows = byBucket.get(bucketKey) ?? [];
    bucketRows.push(row);
    byBucket.set(bucketKey, bucketRows);
  }

  return descriptors
    .filter((descriptor) => byBucket.has(descriptor.key))
    .map((descriptor) => {
      const bucketRows = byBucket.get(descriptor.key)!;
      const fxAvailable = bucketRows.every((row) => row.quantity === 0 || row.fxAvailable);
      const isProvisional = bucketRows.some((row) => row.isProvisional);
      const hasNullAmounts = bucketRows.some((row) =>
        row.quantity !== 0 && (
          row.costBasisAmount === null || row.marketValueAmount === null || row.unrealizedPnlAmount === null
        ),
      );
      const accountIds = [...new Set(bucketRows.map((row) => row.accountId))].sort();
      const quantity = roundToDecimal(bucketRows.reduce((sum, row) => sum + row.quantity, 0), 6);
      const closePrice = bucketRows.find((row) => row.quantity !== 0 && row.closePrice !== null)?.closePrice ?? null;
      const snapshotDate = maxNullableIsoDate(...bucketRows.map((row) => row.snapshotDate));
      const fxAsOfDate = minNullableIsoDate(...bucketRows.map((row) => row.fxAsOfDate ?? null));
      const snapshotProviderSources = [...new Set(bucketRows
        .map((row) => row.providerSource?.trim() ?? "")
        .filter((source) => source.length > 0))]
        .sort();
      return {
        date: descriptor.sortDate,
        unrealizedPnlAmount: !fxAvailable || isProvisional || hasNullAmounts
          ? null
          : roundToDecimal(bucketRows.reduce((sum, row) => sum + (row.unrealizedPnlAmount ?? 0), 0), 2),
        marketValueAmount: !fxAvailable || isProvisional || hasNullAmounts
          ? null
          : roundToDecimal(bucketRows.reduce((sum, row) => sum + (row.marketValueAmount ?? 0), 0), 2),
        costBasisAmount: !fxAvailable || hasNullAmounts
          ? null
          : roundToDecimal(bucketRows.reduce((sum, row) => sum + (row.costBasisAmount ?? 0), 0), 2),
        quantity,
        closePrice,
        fxAvailable,
        isProvisional,
        accountIds,
        snapshotDate,
        snapshotProviderSources,
        fxAsOfDate,
      };
    });
}

function maxNullableIsoDate(...dates: Array<string | null | undefined>): string | null {
  let latest: string | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (latest === null || date > latest) latest = date;
  }
  return latest;
}

function minNullableIsoDate(...dates: Array<string | null | undefined>): string | null {
  let earliest: string | null = null;
  for (const date of dates) {
    if (!date) continue;
    if (earliest === null || date < earliest) earliest = date;
  }
  return earliest;
}

function padSoldOutSeries(
  series: AggregatedPoint[],
  descriptors: readonly BucketDescriptor[],
): AggregatedPoint[] {
  if (series.length === 0) return [];
  const lastPoint = series[series.length - 1]!;
  if (lastPoint.quantity > 0) return series;
  const existing = new Set(series.map((point) => point.date));
  const padded = [...series];
  for (const descriptor of descriptors) {
    if (descriptor.sortDate <= lastPoint.date || existing.has(descriptor.sortDate)) continue;
    padded.push({
      date: descriptor.sortDate,
      unrealizedPnlAmount: 0,
      marketValueAmount: 0,
      costBasisAmount: 0,
      quantity: 0,
      closePrice: null,
      fxAvailable: true,
      isProvisional: false,
      accountIds: [...lastPoint.accountIds],
      snapshotDate: null,
      snapshotProviderSources: [],
      fxAsOfDate: null,
    });
  }
  return padded.sort((left, right) => left.date.localeCompare(right.date));
}

function pickCandidateTickers(
  rankings: readonly UnrealizedPnlRankingRowDto[],
  query: ResolvedInput,
): UnrealizedPnlTickerRefDto[] {
  if (query.selection === "manualTickers") {
    if (query.tickerMode === "custom") return [...query.requestedTickers];
    return rankings
      .map((row) => ({ ticker: row.ticker, marketCode: row.marketCode }));
  }
  const universe = query.tickerMode === "custom"
    ? rankings.filter((row) => query.requestedTickers.some((ticker) => tickerKey(ticker) === `${row.marketCode}:${row.ticker}`))
    : rankings;
  return universe
    .slice(0, query.drivers)
    .map((row) => ({ ticker: row.ticker, marketCode: row.marketCode }));
}

function manualDisplaySort(left: UnrealizedPnlTickerRefDto, right: UnrealizedPnlTickerRefDto): number {
  return left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
}

function buildRequestedTickerAvailability(input: {
  requestedTickers: readonly UnrealizedPnlTickerRefDto[];
  eligibleSeriesByKey: ReadonlyMap<string, TickerSeriesAggregate>;
  scopedSeriesByKey: ReadonlyMap<string, TickerSeriesAggregate>;
  instrumentNameByKey: ReadonlyMap<string, string>;
  instrumentByKey: ReadonlyMap<string, unknown>;
}): UnrealizedPnlRequestedTickerAvailabilityDto[] {
  return input.requestedTickers.map((ticker) => {
    const key = tickerKey(ticker);
    const eligibleSeries = input.eligibleSeriesByKey.get(key);
    const scopedSeries = input.scopedSeriesByKey.get(key);
    const series = eligibleSeries ?? scopedSeries;
    const instrumentExists = input.instrumentByKey.has(key) || input.instrumentNameByKey.has(key);
    const hasAnyEligiblePnlPoint = eligibleSeries?.points.some((point) => point.unrealizedPnlAmount !== null) ?? false;
    const hasAnyScopedPnlPoint = scopedSeries?.points.some((point) => point.unrealizedPnlAmount !== null) ?? false;
    return {
      ...ticker,
      tickerId: key,
      instrumentName: series?.instrumentName ?? input.instrumentNameByKey.get(key) ?? null,
      eligible: Boolean(eligibleSeries && hasAnyEligiblePnlPoint),
      reason: eligibleSeries && hasAnyEligiblePnlPoint
        ? null
        : instrumentExists
          ? scopedSeries
            ? hasAnyScopedPnlPoint
              ? "notInScope"
              : "valuationUnavailable"
            : "noChartableSnapshots"
          : "invalidTicker",
    };
  });
}

function filterChartableSeries(series: readonly TickerSeriesAggregate[]): TickerSeriesAggregate[] {
  return series.filter((item) => item.points.some((point) => point.unrealizedPnlAmount !== null));
}

function isOpenAtAnalysisEnd(series: TickerSeriesAggregate): boolean {
  return (series.points[series.points.length - 1]?.quantity ?? 0) > 0;
}

function rankingSort(left: Pick<UnrealizedPnlRankingRowDto, "periodChangeAmount" | "marketCode" | "ticker">, right: Pick<UnrealizedPnlRankingRowDto, "periodChangeAmount" | "marketCode" | "ticker">): number {
  const leftHasChange = left.periodChangeAmount !== null;
  const rightHasChange = right.periodChangeAmount !== null;
  if (leftHasChange !== rightHasChange) return leftHasChange ? -1 : 1;
  const leftScore = left.periodChangeAmount === null ? 0 : Math.abs(left.periodChangeAmount);
  const rightScore = right.periodChangeAmount === null ? 0 : Math.abs(right.periodChangeAmount);
  if (leftScore !== rightScore) return rightScore - leftScore;
  return left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
}

function buildDeepLink(query: ResolvedInput): string {
  const params = new URLSearchParams();
  params.set("granularity", query.granularity);
  if (query.range) {
    if (query.range !== DEFAULT_RANGE) params.set("range", query.range);
  } else if (query.fromDate || query.toDate) {
    params.set("range", "CUSTOM");
  }
  if (query.fromDate) params.set("fromDate", query.fromDate);
  if (query.toDate) params.set("toDate", query.toDate);
  if (query.markets.length > 0) params.set("markets", query.markets.join(","));
  if (query.accountIds.length > 0) params.set("accountIds", query.accountIds.join(","));
  if (query.tickerIds.length > 0) params.set("tickerIds", query.tickerIds.join(","));
  if (query.instrumentTypes.length > 0) params.set("instrumentTypes", query.instrumentTypes.join(","));
  if (query.selection !== "topDrivers") params.set("selection", query.selection);
  if (query.tickerMode !== "allEligible") params.set("tickerMode", query.tickerMode);
  if (query.drivers !== DEFAULT_DRIVER_COUNT) params.set("drivers", String(query.drivers));
  params.set("positionStatus", query.positionStatus);
  params.set("reportingCurrency", query.reportingCurrency);
  params.set("includeProvisional", query.includeProvisional ? "true" : "false");
  const queryString = params.toString();
  return `/analysis/unrealized-pnl${queryString ? `?${queryString}` : ""}`;
}

function isTickerAllowed(
  ticker: UnrealizedPnlTickerRefDto,
  allowed: ReadonlySet<string>,
): boolean {
  return allowed.has(tickerKey(ticker));
}

function buildTradeMarkers(input: {
  trades: ReturnType<typeof listTradeEvents>;
  accountNamesById: ReadonlyMap<string, string>;
  allowedTickers: ReadonlySet<string>;
  startDate: string;
  endDate: string;
  }): UnrealizedPnlTradeMarkerDto[] {
  const filtered = input.trades
    .filter((trade) => isTickerAllowed({ ticker: trade.ticker, marketCode: trade.marketCode as MarketCode }, input.allowedTickers))
    .sort(tradeSortKey);

  const positions = new Map<string, number>();
  const perDateEvents = new Map<string, Array<{
    kind: Exclude<UnrealizedPnlTradeMarkerKind, "aggregate">;
    accountId: string;
    quantityDelta: number;
    quantityAfter: number;
  }>>();

  for (const trade of filtered) {
    const key = `${trade.marketCode}:${trade.ticker}`;
    const previous = positions.get(key) ?? 0;
    const delta = trade.type === "BUY" ? trade.quantity : -trade.quantity;
    const next = roundToDecimal(previous + delta, 6);
    positions.set(key, next);

    if (trade.tradeDate < input.startDate || trade.tradeDate > input.endDate) continue;
    const kind: Exclude<UnrealizedPnlTradeMarkerKind, "aggregate"> = trade.type === "BUY"
      ? "buy"
      : next <= 0
        ? "full_exit"
        : "partial_sell";
    const groupKey = `${trade.marketCode}:${trade.ticker}:${trade.tradeDate}`;
    const list = perDateEvents.get(groupKey) ?? [];
    list.push({
      kind,
      accountId: trade.accountId,
      quantityDelta: delta,
      quantityAfter: next,
    });
    perDateEvents.set(groupKey, list);
  }

  const markers: UnrealizedPnlTradeMarkerDto[] = [];
  for (const [groupKey, events] of perDateEvents.entries()) {
    const [marketCode, ticker, date] = groupKey.split(":");
    const accountIds = [...new Set(events.map((event) => event.accountId))].sort();
    const accountNames = accountIds.map((accountId) => input.accountNamesById.get(accountId) ?? accountId);
    if (events.length === 1) {
      markers.push({
        ticker,
        marketCode: marketCode as MarketCode,
        date,
        kind: events[0]!.kind,
        eventCount: 1,
        accountIds,
        accountNames,
        netQuantityDelta: events[0]!.quantityDelta,
        quantityAfter: events[0]!.quantityAfter,
      });
      continue;
    }
    markers.push({
      ticker,
      marketCode: marketCode as MarketCode,
      date,
      kind: "aggregate",
      eventCount: events.length,
      accountIds,
      accountNames,
      netQuantityDelta: roundToDecimal(events.reduce((sum, event) => sum + event.quantityDelta, 0), 6),
      quantityAfter: events[events.length - 1]!.quantityAfter,
      componentKinds: [...new Set(events.map((event) => event.kind))].sort(),
    });
  }

  return markers.sort((left, right) =>
    left.marketCode.localeCompare(right.marketCode)
    || left.ticker.localeCompare(right.ticker)
    || left.date.localeCompare(right.date),
  );
}

export async function buildUnrealizedPnlAnalysis(
  app: FastifyInstance,
  userId: string,
  rawInput: UnrealizedPnlAnalysisInput,
): Promise<UnrealizedPnlAnalysisDto> {
  const [store, prefs] = await Promise.all([
    app.persistence.loadStore(userId),
    app.persistence.getUserPreferences(userId),
  ]);
  const capabilities: PortfolioCapabilitiesDto = derivePortfolioCapabilities(store.accounts);
  const defaultReportingCurrency = resolveReportingCurrency(prefs);
  const activeAccounts = new Map(store.accounts.map((account) => [account.id, account] as const));
  const earliestTradeDate = [...listTradeEvents(store)]
    .sort(tradeSortKey)
    .map((trade) => trade.tradeDate)[0];
  const query = resolveInput(rawInput, defaultReportingCurrency, earliestTradeDate);
  const metadata = buildUnrealizedPnlMetadata(query.reportingCurrency);

  const hasExplicitAccountFilter = query.accountIds.length > 0;
  const requestedAccountIds = hasExplicitAccountFilter
    ? query.accountIds.filter((accountId) => activeAccounts.has(accountId))
    : [...activeAccounts.keys()];
  const instrumentByKey = new Map<string, typeof store.instruments[number]>(
    store.instruments.map((instrument) => [`${instrument.marketCode}:${instrument.ticker}`, instrument] as const),
  );
  const instrumentNameByKey = new Map<string, string>();
  for (const instrument of store.marketData.instruments) {
    if (instrument.name) {
      instrumentNameByKey.set(`${instrument.marketCode}:${instrument.ticker}`, instrument.name);
    }
  }
  const customTickerScope = query.tickerMode === "custom" ? new Set(query.tickerIds) : null;
  const requestedTickerMarkets = customTickerScope ? [...new Set(query.requestedTickers.map((item) => item.marketCode))].sort() : [];
  const snapshotQueryMarkets = query.markets.length > 0 ? query.markets : (requestedTickerMarkets.length > 0 ? requestedTickerMarkets : undefined);
  const requestedTickerSymbols = customTickerScope
    ? [...new Set(query.requestedTickers.map((item) => item.ticker))]
    : undefined;

  const analysisSnapshotRows = requestedAccountIds.length === 0
    ? []
    : customTickerScope && query.tickerIds.length === 0
      ? []
    : await app.persistence.listUnrealizedPnlAnalysisSnapshots(userId, {
      accountIds: requestedAccountIds,
      markets: snapshotQueryMarkets,
      tickers: requestedTickerSymbols,
      startDate: query.range === "ALL" ? MIN_ANALYSIS_DATE : query.startDate,
      endDate: query.endDate,
      includeProvisional: query.includeProvisional,
      reportingCurrency: query.reportingCurrency,
    });
  const eligibleSnapshotRows = requestedAccountIds.length === 0
    ? []
    : customTickerScope
      ? await app.persistence.listUnrealizedPnlAnalysisSnapshots(userId, {
        accountIds: requestedAccountIds,
        markets: snapshotQueryMarkets,
        tickers: undefined,
        startDate: query.range === "ALL" ? MIN_ANALYSIS_DATE : query.startDate,
        endDate: query.endDate,
        includeProvisional: query.includeProvisional,
        reportingCurrency: query.reportingCurrency,
      })
      : analysisSnapshotRows;

  const scopedSnapshotRows = eligibleSnapshotRows.filter((row) => {
    const instrument = instrumentByKey.get(`${row.marketCode}:${row.ticker}`);
    if (query.instrumentTypes.length > 0 && (!instrument?.type || !query.instrumentTypes.includes(instrument.type))) return false;
    if (query.range !== "ALL" && row.snapshotDate < query.startDate) return false;
    return true;
  });
  const filteredSnapshotRows = (customTickerScope ? analysisSnapshotRows : scopedSnapshotRows).filter((row) => {
    const instrument = instrumentByKey.get(`${row.marketCode}:${row.ticker}`);
    if (customTickerScope && !customTickerScope.has(`${row.marketCode}:${row.ticker}`)) return false;
    if (query.instrumentTypes.length > 0 && (!instrument?.type || !query.instrumentTypes.includes(instrument.type))) return false;
    if (query.range !== "ALL" && row.snapshotDate < query.startDate) return false;
    return true;
  });

  const descriptors = buildBucketDescriptors(filteredSnapshotRows, query.granularity);
  const eligibleDescriptors = buildBucketDescriptors(scopedSnapshotRows, query.granularity);
  const latestSnapshotDate = filteredSnapshotRows[filteredSnapshotRows.length - 1]?.snapshotDate ?? null;
  const firstSnapshotDate = filteredSnapshotRows[0]?.snapshotDate ?? null;
  const accountNamesById = new Map(store.accounts.map((account) => [account.id, account.name] as const));

  function buildTickerSeriesFromRows(
    rows: typeof scopedSnapshotRows,
    bucketDescriptors: ReturnType<typeof buildBucketDescriptors>,
  ): TickerSeriesAggregate[] {
    const rowsByTicker = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.marketCode}:${row.ticker}`;
      const bucket = rowsByTicker.get(key) ?? [];
      bucket.push(row);
      rowsByTicker.set(key, bucket);
    }
    return [...rowsByTicker.entries()].map(([key, tickerRows]) => {
      const [marketCode, ticker] = key.split(":");
      const instrument = instrumentByKey.get(key);
      const series = aggregateBucketRows(
        tickerRows.map((row) => ({
          ...row,
          marketCode: row.marketCode,
          fxAsOfDate: row.fxAsOfDate ?? null,
        })),
        bucketDescriptors,
        query.granularity,
      );
      const latestQuantity = series[series.length - 1]?.quantity ?? 0;
      const paddedSeries = query.positionStatus === "includeClosed" ? padSoldOutSeries(series, bucketDescriptors) : series;
      const accountIds = [...new Set(tickerRows.map((row) => row.accountId))].sort();
      return {
        ticker,
        marketCode: marketCode as MarketCode,
        instrumentName: instrumentNameByKey.get(key) ?? null,
        instrumentType: instrument?.type ?? null,
        accountIds,
        accountNames: accountIds.map((accountId) => accountNamesById.get(accountId) ?? accountId),
        points: paddedSeries,
        latestQuantity,
        tradeMarkers: [],
      };
    });
  }

  const tickerSeriesAll = buildTickerSeriesFromRows(scopedSnapshotRows, eligibleDescriptors);
  const analysisTickerSeriesAll = customTickerScope
    ? buildTickerSeriesFromRows(filteredSnapshotRows, descriptors)
    : tickerSeriesAll;

  const positionScopedTickerSeries = tickerSeriesAll.filter((series) =>
    query.positionStatus === "includeClosed" || isOpenAtAnalysisEnd(series),
  );
  const includedTickerSeries = filterChartableSeries(positionScopedTickerSeries);
  const analysisPositionScopedTickerSeries = analysisTickerSeriesAll.filter((series) =>
    query.positionStatus === "includeClosed" || isOpenAtAnalysisEnd(series),
  );
  const analysisIncludedTickerSeries = customTickerScope ? filterChartableSeries(analysisPositionScopedTickerSeries) : includedTickerSeries;

  const rankings = includedTickerSeries
    .map((series): UnrealizedPnlRankingRowDto => {
      const startPoint = series.points[0] ?? null;
      const endPoint = series.points[series.points.length - 1] ?? null;
      const periodChangeAmount = startPoint?.unrealizedPnlAmount !== null && startPoint?.unrealizedPnlAmount !== undefined
        && endPoint?.unrealizedPnlAmount !== null && endPoint?.unrealizedPnlAmount !== undefined
        ? roundToDecimal((endPoint.unrealizedPnlAmount ?? 0) - (startPoint.unrealizedPnlAmount ?? 0), 2)
        : null;
      const positionStatus = toPositionStatus(series.latestQuantity);
      return {
        ticker: series.ticker,
        marketCode: series.marketCode,
        instrumentName: series.instrumentName,
        instrumentType: series.instrumentType,
        accountIds: series.accountIds,
        accountNames: series.accountNames,
        currentlyHeld: series.latestQuantity > 0,
        isSoldOut: series.latestQuantity <= 0,
        positionStatus,
        startUnrealizedPnlAmount: startPoint?.unrealizedPnlAmount ?? null,
        endUnrealizedPnlAmount: endPoint?.unrealizedPnlAmount ?? null,
        periodChangeAmount,
        latestMarketValueAmount: endPoint?.marketValueAmount ?? null,
        latestCostBasisAmount: endPoint?.costBasisAmount ?? null,
        latestQuantity: series.latestQuantity,
        tradeMarkerCount: 0,
        snapshotDate: endPoint?.snapshotDate ?? null,
        snapshotProviderSources: endPoint?.snapshotProviderSources ?? [],
        fxAsOfDate: endPoint?.fxAsOfDate ?? null,
      };
    })
    .sort(rankingSort);

  const uncappedCandidateTickers = pickCandidateTickers(rankings, query);
  const candidateLimitApplied = uncappedCandidateTickers.length > MAX_RENDERED_CANDIDATE_COUNT;
  const candidateTickers = [...uncappedCandidateTickers]
    .slice(0, MAX_RENDERED_CANDIDATE_COUNT)
    .sort(query.selection === "manualTickers" ? manualDisplaySort : () => 0);
  const candidateTickerKeySet = new Set(candidateTickers.map((item) => tickerKey(item)));
  const rankingTickerKeySet = new Set(rankings.map((item) => `${item.marketCode}:${item.ticker}`));
  const markerTickerKeySet = new Set([...rankingTickerKeySet, ...candidateTickerKeySet]);
  const filteredTrades = listTradeEvents(store).filter((trade) => requestedAccountIds.includes(trade.accountId)).filter((trade) => {
      if (query.markets.length > 0 && !query.markets.includes(trade.marketCode as MarketCode)) return false;
      if (query.markets.length === 0 && requestedTickerMarkets.length > 0 && !requestedTickerMarkets.includes(trade.marketCode as MarketCode)) return false;
      const instrument = instrumentByKey.get(`${trade.marketCode}:${trade.ticker}`);
      if (query.instrumentTypes.length > 0 && (!instrument?.type || !query.instrumentTypes.includes(instrument.type))) return false;
      return true;
    });
  const rankingTradeMarkers = buildTradeMarkers({
    trades: filteredTrades,
    accountNamesById,
    allowedTickers: markerTickerKeySet,
    startDate: query.startDate,
    endDate: query.endDate,
  });
  const tradeMarkers = rankingTradeMarkers.filter((marker) => candidateTickerKeySet.has(`${marker.marketCode}:${marker.ticker}`));

  const rankingTradeMarkerCount = new Map<string, number>();
  for (const marker of rankingTradeMarkers) {
    const key = `${marker.marketCode}:${marker.ticker}`;
    rankingTradeMarkerCount.set(key, (rankingTradeMarkerCount.get(key) ?? 0) + 1);
  }
  for (const ranking of rankings) {
    ranking.tradeMarkerCount = rankingTradeMarkerCount.get(`${ranking.marketCode}:${ranking.ticker}`) ?? 0;
  }
  const seriesByKey = new Map<string, TickerSeriesAggregate>(
    includedTickerSeries.map((series) => [`${series.marketCode}:${series.ticker}`, series] as const),
  );
  const scopedSeriesByKey = new Map<string, TickerSeriesAggregate>(
    tickerSeriesAll.map((series) => [`${series.marketCode}:${series.ticker}`, series] as const),
  );
  const requestedTickerAvailability = buildRequestedTickerAvailability({
    requestedTickers: query.requestedTickers,
    eligibleSeriesByKey: seriesByKey,
    scopedSeriesByKey,
    instrumentNameByKey,
    instrumentByKey,
  });
  const returnedTickerSeries = [...candidateTickerKeySet]
    .map((key) => seriesByKey.get(key))
    .filter((series): series is TickerSeriesAggregate => series !== undefined)
    .flatMap((series) => series.points.map((point) => {
      return {
        date: point.date,
        unrealizedPnlAmount: point.unrealizedPnlAmount,
        marketValueAmount: point.marketValueAmount,
        costBasisAmount: point.costBasisAmount,
        quantity: point.quantity,
        closePrice: point.closePrice,
        fxAvailable: point.fxAvailable,
        isProvisional: point.isProvisional,
        snapshotDate: point.snapshotDate,
        snapshotProviderSources: point.snapshotProviderSources,
        fxAsOfDate: point.fxAsOfDate,
        ticker: series.ticker,
        marketCode: series.marketCode,
        instrumentName: series.instrumentName,
        instrumentType: series.instrumentType,
        accountIds: series.accountIds,
        accountNames: series.accountNames,
        isSelected: candidateTickerKeySet.has(`${series.marketCode}:${series.ticker}`),
        isSoldOut: series.latestQuantity <= 0,
        positionStatus: toPositionStatus(series.latestQuantity),
      };
    }));

  const portfolioTickerKeySet = new Set(analysisPositionScopedTickerSeries.map((series) => `${series.marketCode}:${series.ticker}`));
  const portfolioSnapshotRows = filteredSnapshotRows.filter((row) => {
    const key = `${row.marketCode}:${row.ticker}`;
    return portfolioTickerKeySet.has(key) && (!customTickerScope || customTickerScope.has(key));
  });

  const portfolioSeries = aggregateBucketRows(
    portfolioSnapshotRows.map((row) => ({
      ...row,
      marketCode: row.marketCode,
      fxAsOfDate: row.fxAsOfDate ?? null,
    })),
    descriptors,
    query.granularity,
    (row, bucketKey) => `${row.accountId}\0${row.marketCode}\0${row.ticker ?? ""}\0${bucketKey}`,
  ).map((point) => ({
    date: point.date,
    unrealizedPnlAmount: point.unrealizedPnlAmount,
    marketValueAmount: point.marketValueAmount,
    costBasisAmount: point.costBasisAmount,
    quantity: point.quantity,
    fxAvailable: point.fxAvailable,
    isProvisional: point.isProvisional,
    snapshotDate: point.snapshotDate,
    snapshotProviderSources: point.snapshotProviderSources,
    fxAsOfDate: point.fxAsOfDate,
  }));

  const summaryStartPoint = portfolioSeries[0] ?? null;
  const summaryEndPoint = portfolioSeries[portfolioSeries.length - 1] ?? null;
  const summaryPeriodChangeAmount = summaryStartPoint?.unrealizedPnlAmount !== null && summaryStartPoint?.unrealizedPnlAmount !== undefined
    && summaryEndPoint?.unrealizedPnlAmount !== null && summaryEndPoint?.unrealizedPnlAmount !== undefined
    ? roundToDecimal((summaryEndPoint.unrealizedPnlAmount ?? 0) - (summaryStartPoint.unrealizedPnlAmount ?? 0), 2)
    : null;
  const totalEndUnrealizedPnlAmount = summaryEndPoint?.unrealizedPnlAmount ?? null;
  const summaryEndDate = summaryEndPoint?.date ?? null;
  const tickerComposition = analysisPositionScopedTickerSeries
    .map((series): UnrealizedPnlTickerCompositionRowDto => {
      const endPoint = summaryEndDate
        ? series.points.find((point) => point.date === summaryEndDate) ?? null
        : null;
      const endUnrealizedPnlAmount = endPoint?.unrealizedPnlAmount ?? null;
      const contributionSharePercent = totalEndUnrealizedPnlAmount !== null
        && totalEndUnrealizedPnlAmount !== 0
        && endUnrealizedPnlAmount !== null
        ? roundToDecimal((endUnrealizedPnlAmount / totalEndUnrealizedPnlAmount) * 100, 2)
        : null;
      const positionStatus = toPositionStatus(series.latestQuantity);
      return {
        ticker: series.ticker,
        marketCode: series.marketCode,
        instrumentName: series.instrumentName,
        instrumentType: series.instrumentType,
        accountIds: series.accountIds,
        accountNames: series.accountNames,
        currentlyHeld: series.latestQuantity > 0,
        isSoldOut: series.latestQuantity <= 0,
        positionStatus,
        endUnrealizedPnlAmount,
        latestMarketValueAmount: endPoint?.marketValueAmount ?? null,
        latestCostBasisAmount: endPoint?.costBasisAmount ?? null,
        latestQuantity: series.latestQuantity,
        contributionSharePercent,
        snapshotDate: endPoint?.snapshotDate ?? null,
        snapshotProviderSources: endPoint?.snapshotProviderSources ?? [],
        fxAsOfDate: endPoint?.fxAsOfDate ?? null,
      };
    })
    .sort((left, right) => {
      const leftScore = left.endUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY;
      const rightScore = right.endUnrealizedPnlAmount ?? Number.NEGATIVE_INFINITY;
      if (leftScore !== rightScore) return rightScore - leftScore;
      return (left.instrumentName ?? left.ticker).localeCompare(right.instrumentName ?? right.ticker)
        || left.marketCode.localeCompare(right.marketCode)
        || left.ticker.localeCompare(right.ticker);
    });
  const nonZeroQuantitySnapshotRows = portfolioSnapshotRows.filter((row) => row.quantity !== 0);

  return {
    capabilities,
    query,
    metadata,
    basis: {
      semantics: "snapshot_valuation",
      priceBasis: "daily_holding_snapshots",
      fxBasis: "snapshot_date_fx",
      reportingCurrency: query.reportingCurrency,
      startSnapshotDate: summaryStartPoint?.snapshotDate ?? summaryStartPoint?.date ?? null,
      endSnapshotDate: summaryEndPoint?.snapshotDate ?? summaryEndPoint?.date ?? null,
    },
    summary: {
      reportingCurrency: query.reportingCurrency,
      startDate: summaryStartPoint?.date ?? null,
      endDate: summaryEndPoint?.date ?? null,
      startUnrealizedPnlAmount: summaryStartPoint?.unrealizedPnlAmount ?? null,
      endUnrealizedPnlAmount: summaryEndPoint?.unrealizedPnlAmount ?? null,
      periodChangeAmount: summaryPeriodChangeAmount,
      currentOpenTickerCount: analysisTickerSeriesAll.filter((series) => series.latestQuantity > 0).length,
      includedTickerCount: analysisIncludedTickerSeries.length,
    },
    portfolioSeries,
    tickerSeries: returnedTickerSeries,
    rankings,
    tickerComposition,
    candidateTickers,
    requestedTickerAvailability,
    warningFacts: {
      noisyChartLineCount: candidateTickers.length,
      noisyChartThreshold: NOISY_CHART_LINE_THRESHOLD,
      candidateLimitApplied,
      candidateLimit: MAX_RENDERED_CANDIDATE_COUNT,
      omittedEligibleCount: Math.max(0, uncappedCandidateTickers.length - candidateTickers.length),
    },
    tradeMarkers,
    dataHealth: {
      snapshotRowCount: portfolioSnapshotRows.length,
      provisionalRowCount: portfolioSnapshotRows.filter((row) => row.isProvisional).length,
      missingFxRowCount: nonZeroQuantitySnapshotRows.filter((row) => !row.fxAvailable).length,
      nullUnrealizedRowCount: nonZeroQuantitySnapshotRows.filter((row) => row.unrealizedPnlAmount === null).length,
      unavailableRowCount: nonZeroQuantitySnapshotRows.filter((row) => !row.fxAvailable || row.unrealizedPnlAmount === null).length,
      excludedSoldOutTickerCount: analysisTickerSeriesAll.length - analysisPositionScopedTickerSeries.length,
    },
    diagnostics: {
      latestSnapshotDate,
      firstSnapshotDate,
      bucketCount: descriptors.length,
      returnedTickerSeriesCount: new Set(returnedTickerSeries.map((point) => `${point.marketCode}:${point.ticker}`)).size,
      availableTickerSeriesCount: analysisIncludedTickerSeries.length,
    },
    deepLink: buildDeepLink(query),
  };
}
