import type { AccountDefaultCurrency } from "@vakwen/shared-types";
import { buildSelectedSeriesId, unrealizedPnlRouteStateToSearchParams } from "./unrealizedPnlRouteState";
import type {
  AnalysisInstrumentType,
  AnalysisMarketCode,
  UnrealizedPnlAnalysisDto,
  UnrealizedPnlAnalysisRouteState,
  UnrealizedPnlPointMarker,
  UnrealizedPnlRankingRow,
  UnrealizedPnlSeries,
  UnrealizedPnlSeriesPoint,
  UnrealizedPnlTickerSelectionRow,
} from "./unrealizedPnlTypes";

interface PreviewSeriesSeed {
  ticker: string;
  marketCode: AnalysisMarketCode;
  displayName: string;
  instrumentType: AnalysisInstrumentType;
  state: "current" | "sold-out";
  positionStatus: "open_position" | "closed_position";
  stateLabel: string;
  colorToken: string;
  endUnrealizedPnl: number;
  periodChange: number;
  accountIds: string[];
  series: number[];
  costBasisSeries: number[];
  marketValueSeries: number[];
  quantitySeries: number[];
  closePriceSeries: Array<number | null>;
  transactionContexts: string[];
  markers: UnrealizedPnlPointMarker[];
}

const PREVIEW_DATES = [
  "2026-04-10",
  "2026-04-17",
  "2026-04-24",
  "2026-05-01",
  "2026-05-08",
  "2026-05-15",
  "2026-05-22",
  "2026-05-29",
  "2026-06-05",
  "2026-06-12",
  "2026-06-19",
  "2026-06-26",
];

const PREVIEW_ACCOUNTS = [
  { value: "acc-tw-main", label: "TW Main" },
  { value: "acc-us-growth", label: "US Growth" },
  { value: "acc-au-income", label: "AU Income" },
];

const PREVIEW_SERIES: PreviewSeriesSeed[] = [
  {
    ticker: "NVDA",
    marketCode: "US",
    displayName: "NVIDIA Corporation",
    instrumentType: "STOCK",
    state: "current",
    positionStatus: "open_position",
    stateLabel: "Open position",
    colorToken: "#157f5b",
    endUnrealizedPnl: 350000,
    periodChange: 92000,
    accountIds: ["acc-us-growth"],
    series: [150000, 158000, 171000, 182000, 195000, 209000, 220000, 232000, 246000, 262000, 275000, 350000],
    costBasisSeries: [620000, 620000, 620000, 620000, 620000, 620000, 620000, 620000, 620000, 620000, 620000, 620000],
    marketValueSeries: [770000, 778000, 791000, 802000, 815000, 829000, 840000, 852000, 866000, 882000, 895000, 970000],
    quantitySeries: [120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120],
    closePriceSeries: [640, 648, 659, 668, 679, 691, 700, 710, 722, 735, 746, 808],
    transactionContexts: PREVIEW_DATES.map(() => "Held through the period; price momentum stayed the main contributor."),
    markers: [{ date: "2026-04-24", type: "buy", label: "B" }],
  },
  {
    ticker: "2330",
    marketCode: "TW",
    displayName: "Taiwan Semiconductor Manufacturing",
    instrumentType: "STOCK",
    state: "current",
    positionStatus: "open_position",
    stateLabel: "Open position",
    colorToken: "#215dc6",
    endUnrealizedPnl: 240000,
    periodChange: 61000,
    accountIds: ["acc-tw-main"],
    series: [120000, 125000, 131000, 142000, 151000, 159000, 168000, 177000, 186000, 198000, 205000, 240000],
    costBasisSeries: [572000, 572000, 572000, 572000, 572000, 572000, 572000, 572000, 572000, 582000, 582000, 582000],
    marketValueSeries: [692000, 697000, 703000, 714000, 723000, 731000, 740000, 749000, 758000, 780000, 787000, 822000],
    quantitySeries: [1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1200, 1200, 1200],
    closePriceSeries: [692, 697, 703, 714, 723, 731, 740, 749, 758, 650, 656, 685],
    transactionContexts: PREVIEW_DATES.map((date) =>
      date === "2026-06-19" ? "Added 200 shares; period change reflects the larger open position." : "Current core holding with stable quantity."),
    markers: [{ date: "2026-06-19", type: "aggregate", label: "S" }],
  },
  {
    ticker: "BHP",
    marketCode: "AU",
    displayName: "BHP Group Limited",
    instrumentType: "STOCK",
    state: "current",
    positionStatus: "open_position",
    stateLabel: "Open position",
    colorToken: "#d28a2e",
    endUnrealizedPnl: 90000,
    periodChange: 24000,
    accountIds: ["acc-au-income"],
    series: [15000, 18000, 12000, 25000, 23000, 28000, 22000, 29000, 26000, 36000, 41000, 90000],
    costBasisSeries: [410000, 410000, 410000, 410000, 410000, 410000, 410000, 410000, 410000, 410000, 410000, 410000],
    marketValueSeries: [425000, 428000, 422000, 435000, 433000, 438000, 432000, 439000, 436000, 446000, 451000, 500000],
    quantitySeries: [800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800, 800],
    closePriceSeries: [53.1, 53.5, 52.8, 54.4, 54.1, 54.8, 54.0, 54.9, 54.5, 55.7, 56.4, 62.5],
    transactionContexts: PREVIEW_DATES.map(() => "Dividend-heavy position; price move stayed secondary to carry."),
    markers: [],
  },
  {
    ticker: "0050",
    marketCode: "TW",
    displayName: "Yuanta Taiwan 50 ETF",
    instrumentType: "ETF",
    state: "current",
    positionStatus: "open_position",
    stateLabel: "Open position",
    colorToken: "#4ca7c7",
    endUnrealizedPnl: 150000,
    periodChange: 19000,
    accountIds: ["acc-tw-main"],
    series: [90000, 92000, 95000, 101000, 105000, 111000, 116000, 120000, 125000, 130000, 137000, 150000],
    costBasisSeries: [510000, 510000, 510000, 510000, 510000, 510000, 510000, 510000, 510000, 510000, 510000, 510000],
    marketValueSeries: [600000, 602000, 605000, 611000, 615000, 621000, 626000, 630000, 635000, 640000, 647000, 660000],
    quantitySeries: [1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500, 1500],
    closePriceSeries: [40, 40.1, 40.3, 40.7, 41, 41.4, 41.7, 42, 42.3, 42.7, 43.1, 44],
    transactionContexts: PREVIEW_DATES.map(() => "Broad market ETF used as portfolio ballast."),
    markers: [],
  },
  {
    ticker: "AAPL",
    marketCode: "US",
    displayName: "Apple Inc.",
    instrumentType: "STOCK",
    state: "current",
    positionStatus: "open_position",
    stateLabel: "Open position",
    colorToken: "#e15555",
    endUnrealizedPnl: 190000,
    periodChange: -18000,
    accountIds: ["acc-us-growth"],
    series: [205000, 204000, 203000, 207000, 210000, 213000, 216000, 220000, 214000, 208000, 201000, 190000],
    costBasisSeries: [420000, 420000, 420000, 420000, 420000, 420000, 420000, 420000, 420000, 420000, 420000, 420000],
    marketValueSeries: [625000, 624000, 623000, 627000, 630000, 633000, 636000, 640000, 634000, 628000, 621000, 610000],
    quantitySeries: [210, 210, 210, 210, 210, 210, 210, 210, 210, 210, 210, 210],
    closePriceSeries: [297, 296, 295, 297, 300, 301, 303, 305, 302, 299, 296, 291],
    transactionContexts: PREVIEW_DATES.map(() => "Open position stayed profitable, but trailed the main drivers this period."),
    markers: [{ date: "2026-06-12", type: "partial-sell", label: "X" }],
  },
  {
    ticker: "TSLA",
    marketCode: "US",
    displayName: "Tesla Inc.",
    instrumentType: "STOCK",
    state: "sold-out",
    positionStatus: "closed_position",
    stateLabel: "Closed position",
    colorToken: "#7a7a7a",
    endUnrealizedPnl: 0,
    periodChange: -12000,
    accountIds: ["acc-us-growth"],
    series: [42000, 40000, 38000, 32000, 25000, 18000, 8000, 0, 0, 0, 0, 0],
    costBasisSeries: [280000, 280000, 280000, 280000, 280000, 280000, 280000, 0, 0, 0, 0, 0],
    marketValueSeries: [322000, 320000, 318000, 312000, 305000, 298000, 288000, 0, 0, 0, 0, 0],
    quantitySeries: [80, 80, 80, 80, 80, 80, 80, 0, 0, 0, 0, 0],
    closePriceSeries: [402, 400, 398, 390, 381, 372, 360, null, null, null, null, null],
    transactionContexts: PREVIEW_DATES.map((date) =>
      date >= "2026-05-29" ? "Position fully exited; post-exit history is intentionally pinned to zero." : "Position was trimmed into a full exit late in the period."),
    markers: [{ date: "2026-05-29", type: "full-exit", label: "F" }],
  },
];

export function buildPreviewUnrealizedPnlAnalysis(
  state: UnrealizedPnlAnalysisRouteState,
  reportingCurrency: AccountDefaultCurrency = state.reportingCurrency,
): UnrealizedPnlAnalysisDto {
  const filtered = PREVIEW_SERIES.filter((series) => {
    if (state.markets.length > 0 && !state.markets.includes(series.marketCode)) return false;
    if (state.accounts.length > 0 && !series.accountIds.some((accountId) => state.accounts.includes(accountId))) return false;
    if (state.tickerMode === "custom" && state.tickerIds.length > 0 && !state.tickerIds.includes(buildSelectedSeriesId(series.marketCode, series.ticker))) return false;
    if (state.instrumentTypes.length > 0 && !state.instrumentTypes.includes(series.instrumentType)) return false;
    if (state.positionStatus === "openOnly" && series.state === "sold-out") return false;
    return true;
  });

  const ranking = filtered
    .map((series) => buildRankingRow(series))
    .sort((left, right) =>
      Math.abs(right.periodChange ?? 0) - Math.abs(left.periodChange ?? 0)
      || (right.endUnrealizedPnl ?? 0) - (left.endUnrealizedPnl ?? 0),
    );

  const selectedSeriesIds = resolveSelectedSeriesIds(ranking, state);
  const selectedSet = new Set(selectedSeriesIds);

  const tickerSeries = filtered.map((series) => ({
    ...buildSeries(series, reportingCurrency),
    markers: series.markers,
  }));
  const seriesById = new Map(tickerSeries.map((series) => [series.seriesId, series] as const));
  const portfolioSeries = PREVIEW_DATES.map((date, index) => ({
    date,
    unrealizedPnl: filtered.reduce((sum, series) => sum + series.series[index]!, 0),
  }));
  const summaryBest = ranking[0] ?? null;
  const summaryWorst = [...ranking].sort((left, right) => (left.periodChange ?? 0) - (right.periodChange ?? 0))[0] ?? null;

  const currentUnrealized = portfolioSeries[portfolioSeries.length - 1]?.unrealizedPnl ?? null;
  const startUnrealized = portfolioSeries[0]?.unrealizedPnl ?? null;
  const periodChange = currentUnrealized !== null && startUnrealized !== null ? currentUnrealized - startUnrealized : null;
  const deepLink = `/analysis/unrealized-pnl${stateToQuerySuffix(state)}`;

  return {
    capabilities: {
      configuredMarkets: ["TW", "US", "AU"],
      configuredCurrencies: ["TWD", "USD", "AUD"],
    },
    query: {
      range: state.range,
      from: state.range === "CUSTOM" ? state.from : null,
      to: state.range === "CUSTOM" ? state.to : null,
      startDate: state.range === "CUSTOM" ? state.from ?? PREVIEW_DATES[0]! : PREVIEW_DATES[0]!,
      endDate: state.range === "CUSTOM" ? state.to ?? PREVIEW_DATES.at(-1)! : PREVIEW_DATES.at(-1)!,
      granularity: state.granularity,
      markets: state.markets,
      accounts: state.accounts,
      tickerIds: state.tickerIds,
      selection: state.selection,
      tickerMode: state.tickerMode,
      drivers: state.drivers,
      positionStatus: state.positionStatus,
      reportingCurrency,
      includeProvisional: state.includeProvisional,
      instrumentTypes: state.instrumentTypes,
    },
    basis: {
      semantics: "preview",
      priceBasis: "daily_holding_snapshots",
      fxBasis: "snapshot_date_fx",
      reportingCurrency,
      startSnapshotDate: PREVIEW_DATES[0] ?? null,
      endSnapshotDate: PREVIEW_DATES.at(-1) ?? null,
    },
    diagnostics: {
      latestSnapshotDate: PREVIEW_DATES.at(-1) ?? null,
      firstSnapshotDate: PREVIEW_DATES[0] ?? null,
    },
    availableFilters: {
      markets: ["TW", "US", "AU"].map((marketCode) => ({
        value: marketCode,
        label: marketCode,
        count: PREVIEW_SERIES.filter((series) => series.marketCode === marketCode).length,
      })),
      accounts: PREVIEW_ACCOUNTS.map((account) => ({
        value: account.value,
        label: account.label,
        count: PREVIEW_SERIES.filter((series) => series.accountIds.includes(account.value)).length,
      })),
      tickers: PREVIEW_SERIES.map((series) => ({
        value: buildSelectedSeriesId(series.marketCode, series.ticker),
        label: `${series.marketCode}:${series.ticker}:${series.displayName}`,
      })),
      reportingCurrencies: ["TWD", "USD", "AUD"].map((currency) => ({ value: currency, label: currency })),
      instrumentTypes: [
        { value: "STOCK", label: "Stock" },
        { value: "ETF", label: "ETF" },
        { value: "BOND_ETF", label: "Bond ETF" },
      ],
    },
    requestedTickerAvailability: state.tickerIds.map((tickerId) => {
      const row = PREVIEW_SERIES.find((series) => buildSelectedSeriesId(series.marketCode, series.ticker) === tickerId);
      const [marketCode = "", ticker = ""] = tickerId.split(":");
      return {
        tickerId,
        marketCode,
        ticker,
        displayName: row?.displayName ?? null,
        available: Boolean(row),
        reason: row ? null : "invalidTicker",
      };
    }),
    warningFacts: {
      candidateLimitApplied: false,
      candidateLimit: 200,
      omittedEligibleCount: 0,
      noisyChart: selectedSeriesIds.length > 20,
      renderedCandidateCount: selectedSeriesIds.length,
      noisyChartLineThreshold: 20,
    },
    summary: {
      totalUnrealized: {
        label: "Total unrealized",
        value: currentUnrealized,
        currency: reportingCurrency,
        tone: toneForValue(currentUnrealized),
        detail: state.includeProvisional ? "Preview includes provisional rows." : "Preview excludes provisional rows.",
      },
      periodChange: {
        label: "Period change",
        value: periodChange,
        currency: reportingCurrency,
        tone: toneForValue(periodChange),
        detail: "End minus start unrealized P&L.",
      },
      bestDriver: summaryBest ? {
        label: summaryBest.displayName,
        marketCode: summaryBest.marketCode,
        ticker: summaryBest.ticker,
        periodChange: summaryBest.periodChange ?? 0,
      } : null,
      worstDriver: summaryWorst ? {
        label: summaryWorst.displayName,
        marketCode: summaryWorst.marketCode,
        ticker: summaryWorst.ticker,
        periodChange: summaryWorst.periodChange ?? 0,
      } : null,
      startDate: portfolioSeries[0]?.date ?? null,
      endDate: portfolioSeries.at(-1)?.date ?? null,
    },
    dataHealth: {
      status: state.includeProvisional ? "partial" : "complete",
      title: state.includeProvisional ? "Partial" : "Complete",
      detail: state.includeProvisional
        ? "Preview includes provisional rows until the API route resolves final data-health diagnostics."
        : "Preview currently assumes complete snapshot coverage.",
      provisionalIncluded: state.includeProvisional,
      stalePriceCount: 0,
      missingPriceCount: 0,
      source: "preview",
    },
    portfolioSeries,
    tickerSeries,
    ranking: ranking.map((row) => ({ ...row, isSelected: selectedSet.has(row.seriesId) })),
    tickerSelection: buildTickerSelection(
      ranking.map((row) => ({ ...row, isSelected: selectedSet.has(row.seriesId) })),
      selectedSeriesIds,
      seriesById,
    ),
    tickerComposition: filtered
      .map((series) => ({
        seriesId: buildSelectedSeriesId(series.marketCode, series.ticker),
        ticker: series.ticker,
        marketCode: series.marketCode,
        displayName: series.displayName,
        stateLabel: series.stateLabel,
        state: series.state,
        positionStatus: series.positionStatus,
        endUnrealizedPnl: series.endUnrealizedPnl,
        marketValue: series.marketValueSeries.at(-1) ?? null,
        costBasis: series.costBasisSeries.at(-1) ?? null,
        quantity: series.quantitySeries.at(-1) ?? 0,
        contributionSharePercent: currentUnrealized !== null && currentUnrealized > 0
          ? Math.round((series.endUnrealizedPnl / currentUnrealized) * 10000) / 100
          : null,
      }))
      .sort(compareCompositionRows),
    selectedSeriesIds,
    reportsPreview: {
      currentUnrealized,
      topGainLabel: summaryBest?.displayName ?? null,
      topGainValue: summaryBest?.periodChange ?? null,
      topLossLabel: summaryWorst?.displayName ?? null,
      topLossValue: summaryWorst?.periodChange ?? null,
      openHref: deepLink,
    },
    deepLink,
    generatedAt: "2026-06-29T00:00:00.000Z",
  };

  function buildSeries(seed: PreviewSeriesSeed, currency: AccountDefaultCurrency): UnrealizedPnlSeries {
    const seriesId = buildSelectedSeriesId(seed.marketCode, seed.ticker);
    return {
      seriesId,
      ticker: seed.ticker,
      marketCode: seed.marketCode,
      displayName: seed.displayName,
      currency,
      instrumentType: seed.instrumentType,
      stateLabel: seed.stateLabel,
      state: seed.state,
      positionStatus: seed.positionStatus,
      colorToken: seed.colorToken,
      endUnrealizedPnl: seed.endUnrealizedPnl,
      periodChange: seed.periodChange,
      accountIds: seed.accountIds,
      points: PREVIEW_DATES.map((date, index) => buildPoint(seed, date, index)),
      markers: seed.markers,
    };
  }

  function buildPoint(seed: PreviewSeriesSeed, date: string, index: number): UnrealizedPnlSeriesPoint {
    return {
      date,
      unrealizedPnl: seed.series[index]!,
      marketValue: seed.marketValueSeries[index]!,
      costBasis: seed.costBasisSeries[index]!,
      quantity: seed.quantitySeries[index]!,
      closePrice: seed.closePriceSeries[index]!,
      basis: {
        snapshotDate: date,
        snapshotProviderSources: [`preview-${seed.marketCode.toLowerCase()}`],
        fxAsOfDate: date,
      },
      transactionContext: seed.transactionContexts[index]!,
    };
  }

  function buildRankingRow(seed: PreviewSeriesSeed): UnrealizedPnlRankingRow {
    return {
      seriesId: buildSelectedSeriesId(seed.marketCode, seed.ticker),
      ticker: seed.ticker,
      marketCode: seed.marketCode,
      displayName: seed.displayName,
      stateLabel: seed.stateLabel,
      state: seed.state,
      positionStatus: seed.positionStatus,
      endUnrealizedPnl: seed.endUnrealizedPnl,
      periodChange: seed.periodChange,
      isSelected: false,
    };
  }
}

function buildTickerSelection(
  ranking: UnrealizedPnlRankingRow[],
  selectedIds: string[],
  seriesById: ReadonlyMap<string, UnrealizedPnlSeries>,
): UnrealizedPnlTickerSelectionRow[] {
  const rows: UnrealizedPnlTickerSelectionRow[] = ranking.map((row, index) => ({
    ...row,
    rankLabel: `#${index + 1}`,
    rankSort: index + 1,
    colorToken: seriesById.get(row.seriesId)?.colorToken ?? "#64748b",
    isManual: false,
  }));
  const existing = new Set(rows.map((row) => row.seriesId));
  for (const selectedId of selectedIds) {
    if (existing.has(selectedId)) continue;
    const series = seriesById.get(selectedId);
    if (!series) continue;
    rows.push({
      seriesId: series.seriesId,
      ticker: series.ticker,
      marketCode: series.marketCode,
      displayName: series.displayName,
      stateLabel: series.stateLabel,
      state: series.state,
      positionStatus: series.positionStatus,
      endUnrealizedPnl: series.endUnrealizedPnl,
      periodChange: series.periodChange,
      isSelected: true,
      rankLabel: "Manual",
      rankSort: Number.MAX_SAFE_INTEGER,
      colorToken: series.colorToken,
      isManual: true,
    });
  }
  return rows;
}

function compareCompositionRows(
  left: Pick<ReturnType<typeof buildPreviewUnrealizedPnlAnalysis>["tickerComposition"][number], "displayName" | "endUnrealizedPnl" | "marketCode" | "ticker">,
  right: Pick<ReturnType<typeof buildPreviewUnrealizedPnlAnalysis>["tickerComposition"][number], "displayName" | "endUnrealizedPnl" | "marketCode" | "ticker">,
): number {
  const leftScore = left.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
  const rightScore = right.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
  if (leftScore !== rightScore) return rightScore - leftScore;
  return left.displayName.localeCompare(right.displayName)
    || left.marketCode.localeCompare(right.marketCode)
    || left.ticker.localeCompare(right.ticker);
}

function resolveSelectedSeriesIds(
  ranking: UnrealizedPnlRankingRow[],
  state: UnrealizedPnlAnalysisRouteState,
): string[] {
  if (ranking.length === 0) return [];
  if (state.selection === "manualTickers" && state.tickerMode === "custom") {
    const allowed = new Set(ranking.map((row) => row.seriesId));
    const manual = state.tickerIds.filter((seriesId) => allowed.has(seriesId));
    return manual.slice(0, 200);
  }
  return ranking.slice(0, state.drivers).map((row) => row.seriesId);
}

function toneForValue(value: number | null): "positive" | "negative" | "neutral" {
  if (value === null || value === 0) return "neutral";
  return value > 0 ? "positive" : "negative";
}

function stateToQuerySuffix(state: UnrealizedPnlAnalysisRouteState): string {
  const params = unrealizedPnlRouteStateToSearchParams(state);
  const query = params.toString();
  return query ? `?${query}` : "";
}
