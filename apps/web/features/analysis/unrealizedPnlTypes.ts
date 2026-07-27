import type { AccountDefaultCurrency, CurrencyCode, PortfolioCapabilitiesDto } from "@vakwen/shared-types";

export const ANALYSIS_RANGE_OPTIONS = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL", "CUSTOM"] as const;
export type AnalysisRangeOption = (typeof ANALYSIS_RANGE_OPTIONS)[number];

export const ANALYSIS_GRANULARITIES = ["daily", "weekly", "monthly", "yearly"] as const;
export type AnalysisGranularity = (typeof ANALYSIS_GRANULARITIES)[number];

export const ANALYSIS_SELECTIONS = ["topDrivers", "manualTickers"] as const;
export type AnalysisSelection = (typeof ANALYSIS_SELECTIONS)[number];

export const ANALYSIS_POSITION_STATUSES = ["openOnly", "includeClosed"] as const;
export type AnalysisPositionStatus = (typeof ANALYSIS_POSITION_STATUSES)[number];

export const ANALYSIS_TICKER_MODES = ["allEligible", "custom"] as const;
export type AnalysisTickerMode = (typeof ANALYSIS_TICKER_MODES)[number];

export const ANALYSIS_DRIVER_COUNTS = [5, 10, 20] as const;
export type AnalysisDriverCount = (typeof ANALYSIS_DRIVER_COUNTS)[number];

export const ANALYSIS_DETAIL_LAYOUTS = ["responsive", "cards", "table"] as const;
export type AnalysisDetailLayout = (typeof ANALYSIS_DETAIL_LAYOUTS)[number];

export const ANALYSIS_VIEW_MODES = ["overview", "compare", "ticker-detail"] as const;
export type AnalysisViewMode = (typeof ANALYSIS_VIEW_MODES)[number];

export const ANALYSIS_MARKET_CODES = ["TW", "US", "AU", "KR", "JP"] as const;
export type AnalysisMarketCode = (typeof ANALYSIS_MARKET_CODES)[number];

export const ANALYSIS_INSTRUMENT_TYPES = ["STOCK", "ETF", "BOND_ETF"] as const;
export type AnalysisInstrumentType = (typeof ANALYSIS_INSTRUMENT_TYPES)[number];

export const ANALYSIS_MARKER_TYPES = ["buy", "partial-sell", "full-exit", "aggregate"] as const;
export type AnalysisMarkerType = (typeof ANALYSIS_MARKER_TYPES)[number];

export interface UnrealizedPnlAnalysisRouteState {
  range: AnalysisRangeOption;
  from: string | null;
  to: string | null;
  granularity: AnalysisGranularity;
  markets: AnalysisMarketCode[];
  accounts: string[];
  selection: AnalysisSelection;
  tickerMode: AnalysisTickerMode;
  tickerIds: string[];
  drivers: AnalysisDriverCount;
  positionStatus: AnalysisPositionStatus;
  reportingCurrency: AccountDefaultCurrency;
  includeProvisional: boolean;
  instrumentTypes: AnalysisInstrumentType[];
  detailLayout: AnalysisDetailLayout;
  focusDate: string | null;
  view: AnalysisViewMode;
}

export interface AnalysisFilterOption {
  value: string;
  label: string;
  count?: number;
}

export interface UnrealizedPnlAnalysisResolvedFilters {
  range: AnalysisRangeOption;
  from: string | null;
  to: string | null;
  startDate: string;
  endDate: string;
  granularity: AnalysisGranularity;
  markets: AnalysisMarketCode[];
  accounts: string[];
  selection: AnalysisSelection;
  tickerMode: AnalysisTickerMode;
  tickerIds: string[];
  drivers: AnalysisDriverCount;
  positionStatus: AnalysisPositionStatus;
  reportingCurrency: CurrencyCode | AccountDefaultCurrency;
  includeProvisional: boolean;
  instrumentTypes: AnalysisInstrumentType[];
}

export interface UnrealizedPnlFilterOptions {
  markets: AnalysisFilterOption[];
  accounts: AnalysisFilterOption[];
  tickers: AnalysisFilterOption[];
  reportingCurrencies: AnalysisFilterOption[];
  instrumentTypes: AnalysisFilterOption[];
}

export interface UnrealizedPnlSummaryDriver {
  label: string;
  marketCode: string;
  ticker: string;
  periodChange: number;
}

export interface UnrealizedPnlSummaryCard {
  label: string;
  value: number | null;
  currency: CurrencyCode | AccountDefaultCurrency;
  tone?: "positive" | "negative" | "neutral";
  detail: string;
}

export interface UnrealizedPnlSummarySection {
  totalUnrealized: UnrealizedPnlSummaryCard;
  periodChange: UnrealizedPnlSummaryCard;
  bestDriver: UnrealizedPnlSummaryDriver | null;
  worstDriver: UnrealizedPnlSummaryDriver | null;
  startDate: string | null;
  endDate: string | null;
}

export interface UnrealizedPnlDataHealth {
  status: "complete" | "partial" | "pending";
  title: string;
  detail: string;
  provisionalIncluded: boolean;
  stalePriceCount: number;
  missingPriceCount: number;
  source: "api" | "preview";
}

export interface UnrealizedPnlPointMarker {
  date: string;
  type: AnalysisMarkerType;
  label: string;
}

export interface UnrealizedPnlSnapshotPointBasis {
  snapshotDate: string | null;
  snapshotProviderSources: string[];
  fxAsOfDate: string | null;
}

export interface UnrealizedPnlSeriesPoint {
  date: string;
  unrealizedPnl: number | null;
  marketValue: number | null;
  costBasis: number | null;
  quantity: number;
  closePrice?: number | null;
  basis?: UnrealizedPnlSnapshotPointBasis;
  transactionContext: string;
}

export interface UnrealizedPnlSeries {
  seriesId: string;
  ticker: string;
  marketCode: AnalysisMarketCode;
  displayName: string;
  currency: CurrencyCode | AccountDefaultCurrency;
  instrumentType: AnalysisInstrumentType;
  stateLabel: string;
  state: "current" | "sold-out";
  positionStatus: "open_position" | "closed_position";
  colorToken: string;
  endUnrealizedPnl: number | null;
  periodChange: number | null;
  accountIds: string[];
  points: UnrealizedPnlSeriesPoint[];
  markers: UnrealizedPnlPointMarker[];
}

export interface UnrealizedPnlRankingRow {
  seriesId: string;
  ticker: string;
  marketCode: AnalysisMarketCode;
  displayName: string;
  stateLabel: string;
  state: "current" | "sold-out";
  positionStatus: "open_position" | "closed_position";
  endUnrealizedPnl: number | null;
  periodChange: number | null;
  isSelected: boolean;
}

export interface UnrealizedPnlTickerCompositionRow {
  seriesId: string;
  ticker: string;
  marketCode: AnalysisMarketCode;
  displayName: string;
  stateLabel: string;
  state: "current" | "sold-out";
  positionStatus: "open_position" | "closed_position";
  endUnrealizedPnl: number | null;
  marketValue: number | null;
  costBasis: number | null;
  quantity: number;
  contributionSharePercent: number | null;
}

export interface UnrealizedPnlTickerSelectionRow extends UnrealizedPnlRankingRow {
  rankLabel: string;
  rankSort: number;
  colorToken: string;
  isManual: boolean;
}

export interface UnrealizedPnlReportsPreview {
  currentUnrealized: number | null;
  topGainLabel: string | null;
  topGainValue: number | null;
  topLossLabel: string | null;
  topLossValue: number | null;
  openHref: string;
}

export interface UnrealizedPnlAnalysisBasis {
  semantics: "snapshot_valuation" | "preview";
  priceBasis: string;
  fxBasis: string;
  reportingCurrency: CurrencyCode | AccountDefaultCurrency;
  startSnapshotDate: string | null;
  endSnapshotDate: string | null;
}

export interface UnrealizedPnlAnalysisDto {
  capabilities?: PortfolioCapabilitiesDto;
  query: UnrealizedPnlAnalysisResolvedFilters;
  basis?: UnrealizedPnlAnalysisBasis;
  diagnostics?: {
    latestSnapshotDate: string | null;
    firstSnapshotDate: string | null;
  };
  availableFilters: UnrealizedPnlFilterOptions;
  requestedTickerAvailability: UnrealizedPnlRequestedTickerAvailability[];
  warningFacts: UnrealizedPnlWarningFacts;
  summary: UnrealizedPnlSummarySection;
  dataHealth: UnrealizedPnlDataHealth;
  portfolioSeries: Array<{
    date: string;
    unrealizedPnl: number | null;
  }>;
  tickerSeries: UnrealizedPnlSeries[];
  ranking: UnrealizedPnlRankingRow[];
  tickerSelection: UnrealizedPnlTickerSelectionRow[];
  tickerComposition: UnrealizedPnlTickerCompositionRow[];
  selectedSeriesIds: string[];
  reportsPreview: UnrealizedPnlReportsPreview;
  deepLink: string;
  generatedAt: string;
}

export interface UnrealizedPnlRequestedTickerAvailability {
  tickerId: string;
  marketCode: string;
  ticker: string;
  displayName: string | null;
  available: boolean;
  reason: "notInScope" | "noChartableSnapshots" | "valuationUnavailable" | "invalidTicker" | null;
}

export interface UnrealizedPnlWarningFacts {
  candidateLimitApplied: boolean;
  candidateLimit: number;
  omittedEligibleCount: number;
  noisyChart: boolean;
  renderedCandidateCount: number;
  noisyChartLineThreshold: number;
}
