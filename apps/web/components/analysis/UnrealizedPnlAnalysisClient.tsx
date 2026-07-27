"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Info, Search, X } from "lucide-react";
import type { LocaleCode } from "@vakwen/shared-types";
import { CapabilityNormalizationNotice } from "../../features/portfolio-capabilities/components/CapabilityNormalizationNotice";
import { SingleCapabilityContext } from "../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/shadcn/card";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/shadcn/popover";
import { cn, formatCompactCurrencyAmount, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { getDictionary } from "../../lib/i18n";
import { getJson, patchJson } from "../../lib/api";
import { getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { useReducedMotion } from "../../lib/hooks/use-reduced-motion";
import { useAppShellData } from "../layout/AppShellDataContext";
import { holdingsFinanceToneClass } from "../holdings/holdingsStyle";
import { useUnrealizedPnlData } from "../../features/analysis/hooks/useUnrealizedPnlData";
import { resolveUnrealizedPnlCapabilityState } from "../../features/analysis/unrealizedPnlCapabilities";
import {
  ANALYSIS_DEFAULT_STATE,
  ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY,
  EMPTY_ANALYSIS_EXPLICIT_PREFERENCE_KEYS,
  LEGACY_ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY,
  applyAnalysisSettings,
  applySelectionModeSettings,
  mergeSettingsWithState,
  parseAnalysisSettingsFromPreferences,
  settingsFromState,
  unrealizedPnlRouteStateToSearchParams,
} from "../../features/analysis/unrealizedPnlRouteState";
import type { UnrealizedPnlAnalysisExplicitPreferenceKeys, UnrealizedPnlAnalysisSettings } from "../../features/analysis/unrealizedPnlRouteState";
import type {
  AnalysisFilterOption,
  AnalysisDetailLayout,
  AnalysisDriverCount,
  AnalysisGranularity,
  AnalysisPositionStatus,
  AnalysisInstrumentType,
  AnalysisMarketCode,
  AnalysisRangeOption,
  AnalysisSelection,
  AnalysisTickerMode,
  UnrealizedPnlAnalysisDto,
  UnrealizedPnlAnalysisRouteState,
  UnrealizedPnlRequestedTickerAvailability,
  UnrealizedPnlSeries,
  UnrealizedPnlTickerCompositionRow,
  UnrealizedPnlTickerSelectionRow,
} from "../../features/analysis/unrealizedPnlTypes";

interface UnrealizedPnlAnalysisClientProps {
  explicitPreferenceKeys?: UnrealizedPnlAnalysisExplicitPreferenceKeys;
  initialData: UnrealizedPnlAnalysisDto | null;
  initialState: UnrealizedPnlAnalysisRouteState;
  locale?: LocaleCode;
}

interface UserPreferencesResponse {
  preferences?: Record<string, unknown>;
}

type AnalysisDict = ReturnType<typeof getDictionary>["analysis"];

const RANGE_OPTIONS: AnalysisRangeOption[] = ["1M", "3M", "YTD", "1Y", "3Y", "5Y", "ALL"];
const EXTENDED_RANGE_OPTIONS: AnalysisRangeOption[] = [...RANGE_OPTIONS, "CUSTOM"];
const GRANULARITY_OPTIONS: AnalysisGranularity[] = ["daily", "weekly", "monthly", "yearly"];
const SELECTION_OPTIONS: AnalysisSelection[] = ["topDrivers", "manualTickers"];
const HOLDINGS_OPTIONS: AnalysisPositionStatus[] = ["openOnly", "includeClosed"];
const DRIVER_OPTIONS: AnalysisDriverCount[] = [5, 10, 20];
const DETAIL_SORT_OPTIONS = ["ranking", "name", "end-pnl"] as const;
type DetailSortOption = typeof DETAIL_SORT_OPTIONS[number];
const DETAIL_LAYOUT_OPTIONS: AnalysisDetailLayout[] = ["responsive", "cards", "table"];
const CUSTOM_TICKER_ID_LIMIT = 200;
const TICKER_DETAIL_ACCOUNT_IDS_QUERY_LIMIT = 50;

export function UnrealizedPnlAnalysisClient({
  explicitPreferenceKeys = EMPTY_ANALYSIS_EXPLICIT_PREFERENCE_KEYS,
  initialData,
  initialState,
  locale,
}: UnrealizedPnlAnalysisClientProps) {
  const router = useRouter();
  const shellData = useAppShellData();
  const resolvedLocale = locale ?? shellData.locale;
  const dict = useMemo(() => getDictionary(resolvedLocale).analysis, [resolvedLocale]);
  const [state, setState] = useState(initialState);
  const [focusIndex, setFocusIndex] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileTotalDetailOpen, setMobileTotalDetailOpen] = useState(false);
  const [detailSort, setDetailSort] = useState<DetailSortOption>("ranking");
  const [mutedSeriesIds, setMutedSeriesIds] = useState<Set<string>>(() => new Set());
  const [marketNormalizationNotice, setMarketNormalizationNotice] = useState<{
    id: number;
    key: string;
    effectiveLabel: string;
    normalization: NonNullable<ReturnType<typeof resolveUnrealizedPnlCapabilityState>["marketNormalization"]>;
  } | null>(null);
  const [currencyNormalizationNotice, setCurrencyNormalizationNotice] = useState<{
    id: number;
    key: string;
    effectiveLabel: string;
    normalization: NonNullable<ReturnType<typeof resolveUnrealizedPnlCapabilityState>["reportingCurrencyNormalization"]>;
  } | null>(null);
  const [, startTransition] = useTransition();
  const stateRef = useRef(initialState);
  const didHydratePreferencesRef = useRef(false);
  const hasLocalStateEditRef = useRef(false);
  const settingsRef = useRef<UnrealizedPnlAnalysisSettings>(settingsFromState(initialState));
  const lastPersistedPreferencesRef = useRef<string | null>(null);
  const suppressedPersistStateKeyRef = useRef<string | null>(null);
  const handledMarketNormalizationKeyRef = useRef<string | null>(null);
  const handledCurrencyNormalizationKeyRef = useRef<string | null>(null);
  const cacheScope = useMemo(() => getRouteDtoContextScope(shellData.sessionUserId), [shellData.sessionUserId]);
  const reducedMotion = useReducedMotion();
  const { cacheStatus, data, errorMessage, isBootstrapping, isRefreshing, refresh } = useUnrealizedPnlData({
    cachePolicy: shellData.routeCachePolicy ?? null,
    cacheScope,
    contextRefreshSignal: shellData.contextRefreshSignal,
    initialData,
    locale: resolvedLocale,
    state,
  });
  const canManageAccounts = !shellData.isSharedContext || shellData.sharedContextPermissions.canManageAccounts;
  const analysisCapabilities = data?.capabilities
    ?? initialData?.capabilities
    ?? (isBootstrapping ? shellData.portfolioCapabilities : null);
  const capabilityState = useMemo(
    () => resolveUnrealizedPnlCapabilityState(
      analysisCapabilities,
      state.markets,
      state.reportingCurrency,
    ),
    [analysisCapabilities, state.markets, state.reportingCurrency],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!mobileTotalDetailOpen || typeof window.matchMedia !== "function") return undefined;
    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const closeIfDesktop = (matches: boolean) => {
      if (matches) setMobileTotalDetailOpen(false);
    };
    const handleChange = (event: MediaQueryListEvent) => closeIfDesktop(event.matches);
    closeIfDesktop(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => {
      mediaQuery.removeEventListener("change", handleChange);
    };
  }, [mobileTotalDetailOpen]);

  useEffect(() => {
    if (!analysisCapabilities) return;
    if (capabilityState.mode === "zero") {
      handledMarketNormalizationKeyRef.current = null;
      handledCurrencyNormalizationKeyRef.current = null;
      return;
    }

    const normalizedMarkets = capabilityState.effectiveMarkets;
    const sameMarkets = sameStringArray(normalizedMarkets, state.markets);
    const marketNormalizationKey = `${state.markets.join(",")}->${normalizedMarkets.join(",")}:${capabilityState.marketNormalization?.reason ?? "none"}`;
    if (!sameMarkets) {
      if (handledMarketNormalizationKeyRef.current !== marketNormalizationKey) {
        handledMarketNormalizationKeyRef.current = marketNormalizationKey;
        const marketNormalization = capabilityState.marketNormalization;
        if (marketNormalization?.reason === "unconfigured_market") {
          setMarketNormalizationNotice((current) => (
            current?.key === marketNormalizationKey
              ? current
              : {
                  id: Date.now(),
                  key: marketNormalizationKey,
                  effectiveLabel: normalizedMarkets.length === 0 ? shellData.uiDict.reports.allMarkets : normalizedMarkets.join(", "),
                  normalization: marketNormalization,
                }
          ));
        }
        replaceState({ ...state, markets: normalizedMarkets }, { persist: false });
        return;
      }
    } else if (handledMarketNormalizationKeyRef.current === marketNormalizationKey) {
      handledMarketNormalizationKeyRef.current = null;
    }

    const normalizedCurrency = capabilityState.effectiveReportingCurrency;
    const currencyNormalizationKey = `${state.reportingCurrency}->${normalizedCurrency ?? "none"}:${capabilityState.reportingCurrencyNormalization?.reason ?? "none"}`;
    if (normalizedCurrency && normalizedCurrency !== state.reportingCurrency) {
      if (handledCurrencyNormalizationKeyRef.current !== currencyNormalizationKey) {
        handledCurrencyNormalizationKeyRef.current = currencyNormalizationKey;
        const reportingCurrencyNormalization = capabilityState.reportingCurrencyNormalization;
        if (reportingCurrencyNormalization?.reason === "unconfigured_currency") {
          setCurrencyNormalizationNotice((current) => (
            current?.key === currencyNormalizationKey
              ? current
              : {
                  id: Date.now(),
                  key: currencyNormalizationKey,
                  effectiveLabel: normalizedCurrency,
                  normalization: reportingCurrencyNormalization,
                }
          ));
        }
        replaceState({ ...state, reportingCurrency: normalizedCurrency }, { persist: false });
      }
      return;
    }
    if (handledCurrencyNormalizationKeyRef.current === currencyNormalizationKey) {
      handledCurrencyNormalizationKeyRef.current = null;
    }
  }, [
    analysisCapabilities,
    capabilityState.effectiveMarkets,
    capabilityState.effectiveReportingCurrency,
    capabilityState.marketNormalization,
    capabilityState.mode,
    capabilityState.reportingCurrencyNormalization,
    shellData.uiDict.reports.allMarkets,
    state,
  ]);

  useEffect(() => {
    let cancelled = false;
    void getJson<UserPreferencesResponse>("/user-preferences", { contextScope: "session" })
      .then((response) => {
        if (cancelled) return;
        const defaults = parseAnalysisSettingsFromPreferences(response.preferences);
        const shouldMigrateLegacySettings = response.preferences?.[ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY] === undefined
          && response.preferences?.[LEGACY_ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY] !== undefined;
        const legacySettings = response.preferences?.[LEGACY_ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY];
        const migratedSettings = buildMigratedAnalysisSettings(defaults, legacySettings);
        didHydratePreferencesRef.current = true;
        setState((current) => {
          if (hasLocalStateEditRef.current) {
            settingsRef.current = mergeSettingsWithState(defaults, current);
            lastPersistedPreferencesRef.current = JSON.stringify(defaults);
            return current;
          }
          settingsRef.current = defaults;
          const next = applyAnalysisSettings(current, defaults, explicitPreferenceKeys);
          lastPersistedPreferencesRef.current = JSON.stringify(defaults);
          if (JSON.stringify(next) === JSON.stringify(current)) return current;
          stateRef.current = next;
          const params = unrealizedPnlRouteStateToSearchParams(next);
          startTransition(() => {
            router.replace(`/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`, { scroll: false });
          });
          return next;
        });
        if (shouldMigrateLegacySettings && !hasLocalStateEditRef.current) {
          void patchJson(
            "/user-preferences",
            {
              [ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY]: migratedSettings,
              [LEGACY_ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY]: null,
            },
            { contextScope: "session" },
          ).catch(() => undefined);
        }
      })
      .catch(() => {
        didHydratePreferencesRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [explicitPreferenceKeys, router, startTransition]);

  const candidateSeriesIds = useMemo(() => {
    if (state.selection === "manualTickers" && state.tickerMode === "custom") return state.tickerIds;
    return data?.selectedSeriesIds ?? state.tickerIds;
  }, [data?.selectedSeriesIds, state.selection, state.tickerIds, state.tickerMode]);
  const selectedSet = useMemo(() => {
    return new Set(candidateSeriesIds.filter((seriesId) => !mutedSeriesIds.has(seriesId)));
  }, [candidateSeriesIds, mutedSeriesIds]);
  const hasZeroSelectedManualTickers = state.selection === "manualTickers" && state.tickerMode === "custom" && candidateSeriesIds.length === 0;
  const chartDates = useMemo(() => collectChartDates(data?.tickerSeries ?? []), [data?.tickerSeries]);
  const maxFocusIndex = Math.max(0, chartDates.length - 1);
  const stateFocusIndex = state.focusDate ? chartDates.indexOf(state.focusDate) : -1;
  const activeFocusIndex = stateFocusIndex >= 0 ? stateFocusIndex : Math.min(focusIndex, maxFocusIndex);
  const focusDate = chartDates[activeFocusIndex] ?? null;
  const responseCurrency = data?.query.reportingCurrency ?? state.reportingCurrency;
  const isCurrencyStale = data !== null && data.query.reportingCurrency !== state.reportingCurrency;
  const staleCurrencyTitle = dict.staleCurrencyTitle.replace("{currency}", state.reportingCurrency);
  const staleCurrencyDetail = dict.staleCurrencyDetail.replace("{currency}", responseCurrency);
  const selectedSeries = useMemo(
    () => (data?.tickerSeries ?? []).filter((series) => selectedSet.has(series.seriesId)),
    [data?.tickerSeries, selectedSet],
  );
  const seriesById = useMemo(
    () => new Map((data?.tickerSeries ?? []).map((series) => [series.seriesId, series] as const)),
    [data?.tickerSeries],
  );
  const detailRows = useMemo(() => {
    const rows = data?.tickerSelection ?? [];
    const rankedRows = rows.filter((row) => !row.isManual);
    const manualRows = rows.filter((row) => row.isManual);
    const compareRows = (left: UnrealizedPnlTickerSelectionRow, right: UnrealizedPnlTickerSelectionRow) => {
      if (detailSort === "name") {
        return left.displayName.localeCompare(right.displayName) || left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
      }
      if (detailSort === "end-pnl") {
        const leftScore = left.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
        const rightScore = right.endUnrealizedPnl ?? Number.NEGATIVE_INFINITY;
        if (leftScore !== rightScore) return rightScore - leftScore;
        return left.displayName.localeCompare(right.displayName) || left.marketCode.localeCompare(right.marketCode) || left.ticker.localeCompare(right.ticker);
      }
      return left.rankSort - right.rankSort || left.displayName.localeCompare(right.displayName);
    };
    return [...rankedRows].sort(compareRows).concat([...manualRows].sort(compareRows));
  }, [data?.tickerSelection, detailSort]);
  const selectedDetailTotal = useMemo(() => {
    const activeRows = detailRows.filter((row) => selectedSet.has(row.seriesId));
    const values = activeRows.flatMap((row) => row.endUnrealizedPnl === null ? [] : [row.endUnrealizedPnl]);
    if (values.length === 0) return null;
    return values.reduce((sum, value) => sum + value, 0);
  }, [detailRows, selectedSet]);
  const selectedDetailBasis = useMemo(() => {
    const points = focusDate
      ? selectedSeries.flatMap((series) => {
          const point = series.points.find((candidate) => candidate.date === focusDate);
          return point ? [point] : [];
        })
      : selectedSeries.flatMap((series) => series.points);
    const snapshotDates = points.flatMap((point) => point.basis?.snapshotDate ? [point.basis.snapshotDate] : []);
    const providerSources = [...new Set(points.flatMap((point) => point.basis?.snapshotProviderSources ?? [])
      .map((source) => source.trim())
      .filter(Boolean))]
      .sort();
    const fxDates = [...new Set(points.flatMap((point) => point.basis?.fxAsOfDate ? [point.basis.fxAsOfDate] : []))]
      .sort();
    const fallbackSnapshotDate = focusDate ? null : data?.basis?.endSnapshotDate ?? data?.diagnostics?.latestSnapshotDate ?? null;
    return {
      latestSnapshotDate: latestDate(snapshotDates) ?? fallbackSnapshotDate,
      providerSources,
      latestFxAsOfDate: latestDate(fxDates),
    };
  }, [data?.basis?.endSnapshotDate, data?.diagnostics?.latestSnapshotDate, focusDate, selectedSeries]);
  const focusedSelectedValues = useMemo(
    () => selectedSeries.map((series) => {
      const point = focusDate ? series.points.find((candidate) => candidate.date === focusDate) : undefined;
      return {
        colorToken: series.colorToken,
        displayName: series.displayName,
        value: point?.unrealizedPnl ?? null,
      };
    }),
    [focusDate, selectedSeries],
  );

  useEffect(() => {
    setMutedSeriesIds(new Set());
  }, [
    candidateSeriesIds,
    data?.selectedSeriesIds,
    state.accounts,
    state.from,
    state.granularity,
    state.positionStatus,
    state.includeProvisional,
    state.instrumentTypes,
    state.drivers,
    state.markets,
    state.range,
    state.reportingCurrency,
    state.selection,
    state.tickerIds,
    state.tickerMode,
    state.to,
  ]);

  function replaceState(next: UnrealizedPnlAnalysisRouteState, options: { persist?: boolean } = {}): void {
    const previousState = stateRef.current;
    hasLocalStateEditRef.current = true;
    if (options.persist === false) {
      suppressedPersistStateKeyRef.current = JSON.stringify(next);
    } else {
      suppressedPersistStateKeyRef.current = null;
    }
    stateRef.current = next;
    setState(next);
    settingsRef.current = mergeSettingsWithState(settingsRef.current, next);
    if (options.persist !== false && next.detailLayout !== previousState.detailLayout) persistSettings(next);
    const params = unrealizedPnlRouteStateToSearchParams(next);
    startTransition(() => {
      router.replace(`/analysis/unrealized-pnl${params.size > 0 ? `?${params.toString()}` : ""}`, { scroll: false });
    });
  }

  useEffect(() => {
    if (!data || !analysisDataMatchesState(data, state)) return;
    if (suppressedPersistStateKeyRef.current === JSON.stringify(state)) {
      return;
    }
    persistSettings(state);
  }, [data, state]);

  function persistSettings(next: UnrealizedPnlAnalysisRouteState): void {
    if (!didHydratePreferencesRef.current) return;
    const payload = mergeSettingsWithState(settingsRef.current, next);
    const serialized = JSON.stringify(payload);
    if (serialized === lastPersistedPreferencesRef.current) return;
    settingsRef.current = payload;
    lastPersistedPreferencesRef.current = serialized;
    void patchJson(
      "/user-preferences",
      { [ANALYSIS_UNREALIZED_PNL_PREFERENCE_KEY]: payload },
      { contextScope: "session" },
    ).catch(() => {
      lastPersistedPreferencesRef.current = null;
    });
  }

  function toggleSeries(seriesId: string): void {
    setMutedSeriesIds((current) => {
      const next = new Set(current);
      if (next.has(seriesId)) {
        next.delete(seriesId);
      } else {
        next.add(seriesId);
      }
      return next;
    });
  }

  function updateFocus(index: number): void {
    const nextDate = chartDates[Math.min(index, maxFocusIndex)] ?? null;
    setFocusIndex(index);
    replaceState({ ...state, focusDate: nextDate });
  }

  function positionLabel(positionStatus: "open_position" | "closed_position"): string {
    return formatPositionLabel(positionStatus, dict);
  }

  const totalCompositionContent = (
    <TotalCompositionContent
      composition={data?.tickerComposition ?? []}
      currency={data?.summary.totalUnrealized.currency ?? state.reportingCurrency}
      dict={dict}
      endDate={data?.summary.endDate ?? null}
      locale={resolvedLocale}
      totalValue={data?.summary.totalUnrealized.value ?? null}
    />
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 md:px-8 md:py-7">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/75">{dict.navLabel}</p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground md:text-3xl">{dict.pageTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">{dict.pageDescription}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => replaceState(ANALYSIS_DEFAULT_STATE)}>{dict.resetFilters}</Button>
          <Button onClick={() => void refresh({ bypassCache: true })} disabled={isRefreshing}>{dict.retry}</Button>
        </div>
      </header>

      {data?.dataHealth.source === "preview" ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <strong>{dict.previewBanner}</strong> {dict.previewDetail}
        </div>
      ) : null}
      {isCurrencyStale ? (
        <div className="rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-primary" data-testid="analysis-stale-currency-banner">
          <strong>{staleCurrencyTitle}</strong> {staleCurrencyDetail}
        </div>
      ) : null}
      {marketNormalizationNotice ? (
        <CapabilityNormalizationNotice
          key={`analysis-market-normalization-${marketNormalizationNotice.id}`}
          dict={shellData.uiDict}
          kind="market"
          normalization={marketNormalizationNotice.normalization}
          effectiveLabel={marketNormalizationNotice.effectiveLabel}
        />
      ) : null}
      {currencyNormalizationNotice ? (
        <CapabilityNormalizationNotice
          key={`analysis-currency-normalization-${currencyNormalizationNotice.id}`}
          dict={shellData.uiDict}
          kind="reportingCurrency"
          normalization={currencyNormalizationNotice.normalization}
          effectiveLabel={currencyNormalizationNotice.effectiveLabel}
        />
      ) : null}
      {errorMessage ? <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{errorMessage}</div> : null}
      {isBootstrapping && !data ? <AnalysisSkeleton /> : null}

      {analysisCapabilities && capabilityState.mode === "zero" ? (
        <ZeroAccountSetupGate
          dict={shellData.uiDict}
          canManageAccounts={canManageAccounts}
          returnTo="/analysis/unrealized-pnl"
        />
      ) : (
        <>

      <button
        className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2 text-sm font-medium md:hidden"
        type="button"
        onClick={() => setShowFilters((current) => !current)}
      >
        <span>{dict.filtersTitle}</span>
        <span>{showFilters ? dict.hideFilters : dict.showFilters}</span>
      </button>
      <section className={cn(
        "gap-3 rounded-lg border border-border/70 bg-card/70 p-3 md:grid md:grid-cols-2 xl:grid-cols-4",
        showFilters ? "grid" : "hidden",
      )}>
        <ControlGroup label={dict.rangeLabel}>
          <Segmented
            options={EXTENDED_RANGE_OPTIONS}
            value={state.range}
            onChange={(range) => replaceState({ ...state, range, granularity: range === "ALL" ? "yearly" : state.granularity })}
          />
        </ControlGroup>
        {state.range === "CUSTOM" ? (
          <div className="grid grid-cols-2 gap-2">
            <ControlGroup label={dict.customFrom}>
              <input
                aria-label={dict.customFrom}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={state.from ?? ""}
                onChange={(event) => replaceState({ ...state, from: event.currentTarget.value || null })}
              />
            </ControlGroup>
            <ControlGroup label={dict.customTo}>
              <input
                aria-label={dict.customTo}
                className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                type="date"
                value={state.to ?? ""}
                onChange={(event) => replaceState({ ...state, to: event.currentTarget.value || null })}
              />
            </ControlGroup>
          </div>
        ) : null}
        <ControlGroup label={dict.granularityLabel}>
          <Segmented
            options={GRANULARITY_OPTIONS}
            value={state.granularity}
            onChange={(granularity) => replaceState({ ...state, granularity, range: state.range === "ALL" && granularity !== "yearly" ? "5Y" : state.range })}
          />
        </ControlGroup>
        {state.selection === "topDrivers" ? (
          <ControlGroup label={dict.linesLabel}>
            <Segmented
              labelFor={(option) => String(option)}
              options={DRIVER_OPTIONS}
              value={state.drivers}
              onChange={(drivers) => replaceState({ ...state, drivers })}
            />
          </ControlGroup>
        ) : null}
        <ControlGroup label={dict.selectionLabel}>
          <Segmented
            labelFor={(option) => option === "manualTickers" ? dict.manualSelection : dict.topDrivers}
            options={SELECTION_OPTIONS}
            value={state.selection}
            onChange={(selection) => replaceState(applySelectionModeSettings(stateRef.current, settingsRef.current, selection))}
          />
        </ControlGroup>
        <ControlGroup label={dict.holdingsLabel}>
          <Segmented
            labelFor={(option) => option === "includeClosed" ? dict.includeSold : dict.currentOnly}
            options={HOLDINGS_OPTIONS}
            value={state.positionStatus}
            onChange={(positionStatus) => replaceState({ ...state, positionStatus })}
          />
        </ControlGroup>
        {capabilityState.mode === "single" ? (
          <SingleCapabilityContext
            label={dict.marketsLabel}
            value={capabilityState.configuredMarkets[0] ?? "-"}
            testId="portfolio-capabilities-single-context-analysis-market"
          />
        ) : (
          <OptionChecklist
            label={dict.marketsLabel}
            options={analysisMarketOptions(capabilityState, data?.availableFilters.markets)}
            selected={state.markets}
            onChange={(markets) => replaceState({ ...state, markets: markets as AnalysisMarketCode[] })}
          />
        )}
        <OptionChecklist
          label={dict.accountsLabel}
          options={data?.availableFilters.accounts ?? []}
          selected={state.accounts}
          onChange={(accounts) => replaceState({ ...state, accounts })}
        />
        <TickerPicker
          label={state.selection === "topDrivers" ? dict.tickerUniverseLabel : dict.tickerMembershipLabel}
          options={data?.availableFilters.tickers ?? []}
          requestedTickerAvailability={data?.requestedTickerAvailability ?? []}
          selection={state.selection}
          tickerIds={state.tickerIds}
          tickerMode={state.tickerMode}
          onChange={(tickerMode, tickerIds) => replaceState({ ...state, tickerMode, tickerIds })}
          dict={dict}
        />
        <OptionChecklist
          label={dict.instrumentTypeLabel}
          options={data?.availableFilters.instrumentTypes ?? []}
          selected={state.instrumentTypes}
          onChange={(instrumentTypes) => replaceState({ ...state, instrumentTypes: instrumentTypes as AnalysisInstrumentType[] })}
        />
        {capabilityState.configuredCurrencies.length === 1 ? (
          <SingleCapabilityContext
            label={dict.currencyLabel}
            value={capabilityState.configuredCurrencies[0] ?? state.reportingCurrency}
            testId="portfolio-capabilities-single-context-analysis-currency"
          />
        ) : (
          <ControlGroup label={dict.currencyLabel}>
            <select
              aria-label={dict.currencyLabel}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              data-testid="analysis-currency-select"
              value={state.reportingCurrency}
              onChange={(event) => replaceState({ ...state, reportingCurrency: event.currentTarget.value as UnrealizedPnlAnalysisRouteState["reportingCurrency"] })}
            >
              {analysisCurrencyOptions(capabilityState, data?.availableFilters.reportingCurrencies, state.reportingCurrency).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </ControlGroup>
        )}
        <label className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm md:self-end">
          <input
            type="checkbox"
            checked={state.includeProvisional}
            onChange={(event) => replaceState({ ...state, includeProvisional: event.currentTarget.checked })}
          />
              {dict.provisionalLabel}
        </label>
      </section>

      {data?.warningFacts.candidateLimitApplied ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {dict.hardLimitWarning
            .replace("{shown}", String(data.warningFacts.candidateLimit))
            .replace("{total}", String(data.warningFacts.candidateLimit + data.warningFacts.omittedEligibleCount))}
        </div>
      ) : data?.warningFacts.noisyChart ? (
        <div className="rounded-md border border-amber-300/60 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {dict.noisyChartWarning}
        </div>
      ) : null}

      <section className={cn("grid gap-3 md:grid-cols-4", isCurrencyStale && "opacity-45")} aria-busy={isCurrencyStale}>
        <div>
          <Popover>
            <PopoverTrigger asChild>
              <button className="hidden w-full rounded-lg text-left md:block" data-testid="analysis-total-detail-trigger" type="button">
                <SummaryCard
                  actionIcon={<Info className="h-4 w-4" aria-hidden="true" />}
                  label={dict.summaryTotal}
                  value={data?.summary.totalUnrealized.value ?? null}
                  currency={data?.summary.totalUnrealized.currency ?? state.reportingCurrency}
                  locale={resolvedLocale}
                />
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-[min(30rem,calc(100vw-2rem))] p-0">
              {totalCompositionContent}
            </PopoverContent>
          </Popover>
          <button className="w-full rounded-lg text-left md:hidden" data-testid="analysis-total-detail-trigger-mobile" type="button" onClick={() => setMobileTotalDetailOpen(true)}>
            <SummaryCard
              actionIcon={<Info className="h-4 w-4" aria-hidden="true" />}
              label={dict.summaryTotal}
              value={data?.summary.totalUnrealized.value ?? null}
              currency={data?.summary.totalUnrealized.currency ?? state.reportingCurrency}
              locale={resolvedLocale}
            />
          </button>
        </div>
        <SummaryCard label={dict.summaryChange} value={data?.summary.periodChange.value ?? null} currency={data?.summary.periodChange.currency ?? state.reportingCurrency} locale={resolvedLocale} />
        <DriverCard label={dict.summaryBest} text={data?.summary.bestDriver?.label ?? "-"} />
        <DriverCard label={dict.summaryHealth} text={data?.dataHealth.detail ?? (isBootstrapping ? dict.loadingBody : "-")} />
      </section>

      <Drawer
        open={mobileTotalDetailOpen}
        onOpenChange={setMobileTotalDetailOpen}
        title={dict.totalCompositionTitle}
        closeLabel={dict.closeTotalComposition}
        className="md:hidden"
      >
        {totalCompositionContent}
      </Drawer>

      <section className={cn(isCurrencyStale && "opacity-45")} aria-busy={isCurrencyStale}>
        <Card>
          <CardHeader className="pb-3">
            <CardTitle>{dict.decompositionTitle}</CardTitle>
            <CardDescription>
              {dict.decompositionDescription}
              {cacheStatus ? <span className="ml-2 text-xs uppercase text-muted-foreground">cache {cacheStatus}</span> : null}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4">
              <div className="min-w-0">
                {hasZeroSelectedManualTickers ? (
                  <AnalysisEmptyState title={dict.manualEmptyTitle} body={dict.manualEmptyBody} />
                ) : (
                  <>
                    <AnalysisSvgChart
                      ariaLabel={dict.chartAriaLabel}
                      axisLabels={{
                        max: dict.chartAxisMaxLabel,
                        min: dict.chartAxisMinLabel,
                        zero: dict.chartAxisZeroLabel,
                      }}
                      currency={responseCurrency}
                      dates={chartDates}
                      focusDate={focusDate}
                      locale={resolvedLocale}
                      onToggleSeries={toggleSeries}
                      reducedMotion={reducedMotion}
                      selectedSet={selectedSet}
                      series={data?.tickerSeries ?? []}
                    />
                    <label className="mt-4 block text-xs font-medium text-muted-foreground" htmlFor="analysis-focus">{dict.focusLabel}</label>
                    <input
                      data-testid="analysis-focus-scrub"
                      id="analysis-focus"
                      className="mt-2 w-full"
                      max={maxFocusIndex}
                      min={0}
                      type="range"
                      value={activeFocusIndex}
                      onChange={(event) => updateFocus(Number(event.currentTarget.value))}
                    />
                    <div className="mt-2 text-sm text-muted-foreground">
                      {focusDate ? formatDateLabel(focusDate, resolvedLocale) : dict.emptyBody}
                    </div>
                  </>
                )}
                {!hasZeroSelectedManualTickers && focusedSelectedValues.length > 0 ? (
                  <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-2" data-testid="analysis-focus-values">
                    <p className="text-[11px] font-semibold uppercase text-muted-foreground">{dict.focusValuesLabel}</p>
                    <div className="mt-2 grid gap-1 sm:grid-cols-2">
                      {focusedSelectedValues.map((item) => (
                        <div key={item.displayName} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded px-1 py-0.5 text-xs">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.colorToken }} />
                            <span className="truncate">{item.displayName}</span>
                          </span>
                          <span
                            className={cn("max-w-[44vw] truncate text-right font-mono tabular-nums sm:max-w-none", holdingsFinanceToneClass(item.value, "text-foreground"))}
                            title={formatNullableCurrency(item.value, responseCurrency, resolvedLocale)}
                          >
                            {formatNullableCompactCurrency(item.value, responseCurrency, resolvedLocale)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

            </div>

            <div className="border-t border-border/70 pt-4" data-testid="analysis-selected-detail">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">{dict.selectedDetailTitle}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{dict.selectedDetailDescription}</p>
                </div>
                <Segmented
                  labelFor={(option) => option === "ranking" ? dict.sortRanking : option === "name" ? dict.sortName : dict.sortEndPnl}
                  options={DETAIL_SORT_OPTIONS}
                  value={detailSort}
                  onChange={setDetailSort}
                />
                <Segmented
                  labelFor={(option) => option === "responsive" ? "Auto" : option === "cards" ? "Cards" : "Table"}
                  options={DETAIL_LAYOUT_OPTIONS}
                  value={state.detailLayout}
                  onChange={(detailLayout) => replaceState({ ...state, detailLayout })}
                />
              </div>
              <div
                className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3"
                data-testid="analysis-selected-detail-basis-tip"
                role="note"
              >
                <p className="text-sm text-foreground">{dict.selectedDetailBasisTip}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {selectedDetailBasis.latestSnapshotDate
                    ? dict.selectedDetailSnapshotAsOf.replace("{date}", formatDateLabel(selectedDetailBasis.latestSnapshotDate, resolvedLocale))
                    : dict.selectedDetailSnapshotAsOf.replace("{date}", "-")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dict.selectedDetailSnapshotSources.replace("{sources}", selectedDetailBasis.providerSources.length > 0 ? selectedDetailBasis.providerSources.join(", ") : "-")}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {dict.selectedDetailSnapshotFxAsOf.replace("{date}", selectedDetailBasis.latestFxAsOfDate ? formatDateLabel(selectedDetailBasis.latestFxAsOfDate, resolvedLocale) : "-")}
                </p>
              </div>
              <div
                className="mt-3 flex flex-col gap-1 rounded-lg border border-border/70 bg-muted/20 px-4 py-3 sm:flex-row sm:items-end sm:justify-between"
                data-testid="analysis-selected-detail-total"
              >
                <div>
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{dict.selectedDetailTotalLabel}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{dict.selectedDetailTotalValueLabel}</p>
                </div>
                <p className={cn("text-xl font-semibold tabular-nums", holdingsFinanceToneClass(selectedDetailTotal, "text-foreground"))}>
                  {formatNullableCurrency(selectedDetailTotal, responseCurrency, resolvedLocale)}
                </p>
              </div>
              <div
                className={cn("mt-3 grid gap-3 lg:grid-cols-2", state.detailLayout === "table" && "hidden", state.detailLayout === "responsive" && "lg:hidden")}
                data-testid="analysis-detail-cards"
              >
                {hasZeroSelectedManualTickers ? (
                  <AnalysisEmptyState compact title={dict.manualEmptyTitle} body={dict.manualEmptyBody} />
                ) : detailRows.map((row) => {
                  const series = seriesById.get(row.seriesId);
                  const isChecked = selectedSet.has(row.seriesId);
                  const href = buildTickerDetailHref(row, state, data);
                  const point = series ? (focusDate ? series.points.find((candidate) => candidate.date === focusDate) : series.points.at(-1)) : undefined;
                  const focusedMarkers = series?.markers.filter((marker) => marker.date === point?.date) ?? [];
                  const healthLabel = !point
                    ? dict.healthPending
                    : point.unrealizedPnl === null || point.marketValue === null || point.costBasis === null
                    ? dict.healthPartial
                    : dict.healthComplete;
                  return (
                    <div key={row.seriesId} className={cn("rounded-md border border-border p-3", !isChecked && "bg-muted/30 opacity-60")} data-testid={isChecked ? "analysis-detail-expanded" : "analysis-detail-muted"}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex min-w-0 flex-wrap items-center gap-2 font-medium">
                            <SelectionBadge label={row.isManual ? dict.manualBadge : row.rankLabel} tone={row.isManual ? "manual" : "default"} />
                            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: row.colorToken }} />
                            <a className="min-w-0 flex-1 basis-40 break-words text-primary hover:underline" href={href}>{row.displayName}</a>
                            {!isChecked ? <SelectionBadge label={dict.mutedLineLabel} tone="muted" /> : null}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground"><a className="text-primary hover:underline" href={href}>{row.marketCode}:{row.ticker}</a> · {positionLabel(row.positionStatus)}</p>
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-sm md:grid-cols-3">
                        <DetailTerm
                          label={focusDate ? dict.detailFocusedPnl : dict.detailEndPnl}
                          toneValue={point?.unrealizedPnl ?? null}
                          value={formatNullableCurrency(point?.unrealizedPnl ?? null, series?.currency ?? responseCurrency, resolvedLocale)}
                        />
                        <DetailTerm
                          label={dict.tableChange}
                          toneValue={row.periodChange}
                          value={formatNullableCurrency(row.periodChange, series?.currency ?? responseCurrency, resolvedLocale)}
                        />
                        <DetailTerm label={dict.detailQuantity} value={point ? formatNumber(point.quantity, resolvedLocale, 4) : "-"} />
                        <DetailTerm label={dict.detailMarketValue} value={formatNullableCurrency(point?.marketValue ?? null, series?.currency ?? responseCurrency, resolvedLocale)} />
                        <DetailTerm label={dict.detailCostBasis} value={formatNullableCurrency(point?.costBasis ?? null, series?.currency ?? responseCurrency, resolvedLocale)} />
                        <DetailTerm label={dict.detailClosePrice} value={point?.closePrice === null || point?.closePrice === undefined ? "-" : formatNumber(point.closePrice, resolvedLocale, 4)} />
                        <DetailTerm label={dict.detailState} value={healthLabel} />
                      </dl>
                      <p className="mt-3 text-xs text-muted-foreground">{point?.transactionContext ?? "-"}</p>
                      {focusedMarkers.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {focusedMarkers.map((marker) => (
                            <span key={`${marker.date}-${marker.type}-${marker.label}`} className="rounded border border-border px-2 py-0.5 text-xs text-muted-foreground">
                              {marker.label}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div
                className={cn("mt-3 overflow-x-auto rounded-md border border-border", state.detailLayout === "cards" && "hidden", state.detailLayout === "responsive" && "hidden lg:block")}
                data-testid="analysis-detail-table"
              >
                {hasZeroSelectedManualTickers ? (
                  <AnalysisEmptyState compact title={dict.manualEmptyTitle} body={dict.manualEmptyBody} />
                ) : (
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-muted/50 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">{dict.tableTicker}</th>
                      <th className="px-3 py-2">Market</th>
                      <th className="px-3 py-2">{dict.detailEndPnl}</th>
                      <th className="px-3 py-2">{dict.tableChange}</th>
                      <th className="px-3 py-2">{dict.detailMarketValue}</th>
                      <th className="px-3 py-2">{dict.detailCostBasis}</th>
                      <th className="px-3 py-2">{dict.detailQuantity}</th>
                      <th className="px-3 py-2">{dict.tableState}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detailRows.map((row) => {
                      const series = seriesById.get(row.seriesId);
                      const point = series ? (focusDate ? series.points.find((candidate) => candidate.date === focusDate) : series.points.at(-1)) : undefined;
                      const isChecked = selectedSet.has(row.seriesId);
                      const href = buildTickerDetailHref(row, state, data);
                      return (
                        <tr key={row.seriesId} className={cn("border-t border-border", !isChecked && "bg-muted/30 opacity-60")}>
                          <td className="min-w-56 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <SelectionBadge label={row.isManual ? dict.manualBadge : row.rankLabel} tone={row.isManual ? "manual" : "default"} />
                              {!isChecked ? <SelectionBadge label={dict.mutedLineLabel} tone="muted" /> : null}
                            </div>
                            <a className="font-medium text-primary hover:underline" href={href}>{row.marketCode}:{row.ticker}</a>
                            <a className="mt-0.5 block max-w-64 truncate text-xs text-primary/80 hover:underline" href={href}>{row.displayName}</a>
                          </td>
                          <td className="px-3 py-2">{row.marketCode}</td>
                          <td className={cn("px-3 py-2 font-mono tabular-nums", holdingsFinanceToneClass(row.endUnrealizedPnl, "text-foreground"))}>{formatNullableCurrency(row.endUnrealizedPnl, series?.currency ?? responseCurrency, resolvedLocale)}</td>
                          <td className={cn("px-3 py-2 font-mono tabular-nums", holdingsFinanceToneClass(row.periodChange, "text-foreground"))}>{formatNullableCurrency(row.periodChange, series?.currency ?? responseCurrency, resolvedLocale)}</td>
                          <td className="px-3 py-2 font-mono tabular-nums">{formatNullableCurrency(point?.marketValue ?? null, series?.currency ?? responseCurrency, resolvedLocale)}</td>
                          <td className="px-3 py-2 font-mono tabular-nums">{formatNullableCurrency(point?.costBasis ?? null, series?.currency ?? responseCurrency, resolvedLocale)}</td>
                          <td className="px-3 py-2 font-mono tabular-nums">{point ? formatNumber(point.quantity, resolvedLocale, 4) : "-"}</td>
                          <td className="px-3 py-2">{positionLabel(row.positionStatus)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </section>
        </>
      )}
    </main>
  );
}

function buildMigratedAnalysisSettings(
  settings: UnrealizedPnlAnalysisSettings,
  legacySettings: unknown,
): Partial<UnrealizedPnlAnalysisSettings> {
  const legacyHasReportingCurrency = Boolean(
    legacySettings
      && typeof legacySettings === "object"
      && !Array.isArray(legacySettings)
      && Object.prototype.hasOwnProperty.call(legacySettings, "reportingCurrency"),
  );
  if (legacyHasReportingCurrency) return settings;
  const settingsWithoutCurrency: Partial<UnrealizedPnlAnalysisSettings> = { ...settings };
  delete settingsWithoutCurrency.reportingCurrency;
  return settingsWithoutCurrency;
}

function collectChartDates(series: UnrealizedPnlSeries[]): string[] {
  return [...new Set(series.flatMap((item) => item.points.map((point) => point.date)))].sort();
}

function latestDate(values: readonly string[]): string | null {
  return [...values].sort().at(-1) ?? null;
}

function TotalCompositionContent({
  composition,
  currency,
  dict,
  endDate,
  locale,
  totalValue,
}: {
  composition: UnrealizedPnlTickerCompositionRow[];
  currency: string;
  dict: AnalysisDict;
  endDate: string | null;
  locale: LocaleCode;
  totalValue: number | null;
}) {
  const hasUnavailableRows = composition.some((row) => row.endUnrealizedPnl === null);
  return (
    <div data-testid="analysis-total-composition">
      <div className="border-b border-border bg-muted/30 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-foreground">{dict.totalCompositionTitle}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{dict.totalCompositionDescription}</p>
          </div>
          <div className="shrink-0 text-right text-xs font-medium text-muted-foreground">
            {endDate ? dict.totalCompositionAsOf.replace("{date}", endDate) : "-"}
          </div>
        </div>
        <div className="mt-3 text-lg font-semibold text-foreground">{formatNullableCurrency(totalValue, currency, locale)}</div>
      </div>
      {hasUnavailableRows ? (
        <div className="border-b border-amber-300/70 bg-amber-50 px-4 py-2 text-xs text-amber-900" data-testid="analysis-total-composition-warning">
          {dict.totalCompositionWarning}
        </div>
      ) : null}
      <div className="max-h-[22rem] overflow-y-auto p-2">
        {composition.length > 0 ? composition.map((row) => (
          <div key={row.seriesId} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-border/70 px-2 py-2.5 last:border-b-0">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-foreground">{row.displayName}</div>
              <div className="mt-0.5 truncate text-xs text-muted-foreground">{row.ticker} {row.marketCode} · {formatPositionLabel(row.positionStatus, dict)}</div>
            </div>
            <div className="text-right">
              <div className={cn("font-mono text-sm font-semibold tabular-nums", row.endUnrealizedPnl === null ? "text-muted-foreground" : row.endUnrealizedPnl < 0 ? "text-red-600" : "text-emerald-700")}>
                {formatNullableCurrency(row.endUnrealizedPnl, currency, locale)}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {row.contributionSharePercent === null ? "-" : `${formatNumber(row.contributionSharePercent, locale, 2)}%`}
              </div>
            </div>
          </div>
        )) : (
          <div className="px-2 py-6 text-sm text-muted-foreground">{dict.totalCompositionEmpty}</div>
        )}
      </div>
    </div>
  );
}

function formatPositionLabel(positionStatus: "open_position" | "closed_position", dict: AnalysisDict): string {
  return positionStatus === "open_position" ? dict.openPosition : dict.closedPosition;
}

function AnalysisSvgChart({
  ariaLabel,
  axisLabels,
  currency,
  dates,
  focusDate,
  locale,
  onToggleSeries,
  reducedMotion,
  selectedSet,
  series,
}: {
  ariaLabel: string;
  axisLabels: {
    max: string;
    min: string;
    zero: string;
  };
  currency: string;
  dates: string[];
  focusDate: string | null;
  locale: LocaleCode;
  onToggleSeries: (seriesId: string) => void;
  reducedMotion: boolean;
  selectedSet: ReadonlySet<string>;
  series: UnrealizedPnlSeries[];
}) {
  const activeSeries = selectedSet.size > 0
    ? series.filter((item) => selectedSet.has(item.seriesId))
    : series;
  const values = activeSeries.flatMap((item) => item.points.map((point) => point.unrealizedPnl))
    .filter((value): value is number => value !== null);
  const min = values.length > 0 ? Math.min(0, ...values) : -1;
  const max = values.length > 0 ? Math.max(0, ...values) : 1;
  const span = Math.max(1, max - min);
  const width = 920;
  const height = 280;
  const leftPad = 88;
  const rightPad = 28;
  const topPad = 28;
  const bottomPad = 28;
  const xForDate = (date: string) => leftPad + (Math.max(0, dates.indexOf(date)) / Math.max(1, dates.length - 1)) * (width - leftPad - rightPad);
  const yForValue = (value: number) => height - bottomPad - ((value - min) / span) * (height - topPad - bottomPad);
  const focusX = focusDate ? xForDate(focusDate) : null;
  const zeroY = yForValue(0);
  const yAxisLabels = [
    { id: "max", label: axisLabels.max, value: max, y: yForValue(max) },
    { id: "zero", label: axisLabels.zero, value: 0, y: zeroY },
    { id: "min", label: axisLabels.min, value: min, y: yForValue(min) },
  ];
  const focusPoints = focusDate
    ? series
      .filter((item) => selectedSet.has(item.seriesId))
      .map((item) => {
        const point = item.points.find((candidate) => candidate.date === focusDate);
        return point
          ? {
              colorToken: item.colorToken,
              displayName: item.displayName,
              value: point.unrealizedPnl,
              y: point.unrealizedPnl === null ? null : yForValue(point.unrealizedPnl),
            }
          : null;
      })
      .filter((item): item is { colorToken: string; displayName: string; value: number | null; y: number | null } => item !== null)
    : [];
  return (
    <div className="w-full overflow-hidden rounded-md border border-border bg-background">
      <div className="grid max-h-[5.75rem] grid-cols-2 gap-x-4 gap-y-1 overflow-y-auto border-b border-border/70 bg-muted/20 px-3 py-2 text-[11px] lg:grid-cols-3 xl:grid-cols-2" data-testid="analysis-chart-legend">
        {series.map((item) => {
          const isActive = selectedSet.has(item.seriesId);
          return (
          <button
            key={item.seriesId}
            aria-pressed={isActive}
            className={cn(
              "flex min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left transition hover:bg-background",
              !isActive && "opacity-50",
            )}
            type="button"
            onClick={() => onToggleSeries(item.seriesId)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: item.colorToken }} />
            <span className="min-w-0 truncate leading-tight" title={item.displayName}>{item.displayName}</span>
          </button>
          );
        })}
      </div>
      <svg aria-label={ariaLabel} className="h-[280px] w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
        <g data-testid="analysis-chart-y-axis">
          <line stroke="hsl(var(--border))" x1={leftPad} x2={leftPad} y1={topPad} y2={height - bottomPad} />
          {yAxisLabels.map((item) => (
            <g key={item.id} data-testid={`analysis-chart-y-axis-${item.id}`}>
              <line
                stroke={item.id === "zero" ? "hsl(var(--foreground))" : "hsl(var(--border))"}
                strokeDasharray={item.id === "zero" ? undefined : "3 3"}
                strokeOpacity={item.id === "zero" ? 0.55 : 1}
                x1={leftPad - 6}
                x2={width - rightPad}
                y1={item.y}
                y2={item.y}
              />
              <text
                fill="hsl(var(--muted-foreground))"
                fontSize={11}
                textAnchor="start"
                x={12}
                y={item.y + 4}
              >
                {`${item.label} ${formatNullableCompactCurrency(item.value, currency, locale)}`}
              </text>
            </g>
          ))}
        </g>
        {series.map((item) => (
          <polyline
            key={item.seriesId}
            fill="none"
            points={item.points
              .flatMap((point) => point.unrealizedPnl === null ? [] : [`${xForDate(point.date)},${yForValue(point.unrealizedPnl)}`])
              .join(" ")}
            stroke={item.colorToken}
            strokeDasharray={item.state === "sold-out" ? "7 7" : undefined}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeOpacity={selectedSet.has(item.seriesId) ? 1 : 0.22}
            strokeWidth={selectedSet.has(item.seriesId) ? 4 : 2}
            style={reducedMotion ? undefined : { transition: "stroke-opacity 160ms ease, stroke-width 160ms ease" }}
          >
            <title>{`${item.displayName} ${formatNullableCurrency(item.endUnrealizedPnl, item.currency, locale)}`}</title>
          </polyline>
        ))}
        {focusDate && focusX !== null ? <line stroke="hsl(var(--muted-foreground))" strokeDasharray="4 4" x1={focusX} x2={focusX} y1={topPad} y2={height - bottomPad} /> : null}
        {focusX !== null ? focusPoints.map((point, index) => {
          const label = formatNullableCurrency(point.value, currency, locale);
          const labelWidth = Math.min(150, Math.max(68, label.length * 7.2 + 16));
          const labelX = focusX > width - 190 ? focusX - labelWidth - 12 : focusX + 12;
          const labelY = point.y === null
            ? topPad + 18 + index * 24
            : Math.max(topPad + 12, Math.min(height - bottomPad - 10, point.y - 8 + index * 4));
          return (
            <g key={`${point.displayName}-${index}`} className="hidden lg:block">
              {point.y !== null ? <circle cx={focusX} cy={point.y} fill={point.colorToken} r={5} stroke="white" strokeWidth={2} /> : null}
              <rect fill="hsl(var(--background))" height={20} opacity={0.92} rx={4} stroke={point.colorToken} strokeOpacity={0.45} width={labelWidth} x={labelX} y={labelY - 15} />
              <text fill="hsl(var(--foreground))" fontSize={12} fontWeight={600} x={labelX + 8} y={labelY}>
                {label}
              </text>
            </g>
          );
        }) : null}
      </svg>
    </div>
  );
}

function AnalysisEmptyState({
  body,
  compact = false,
  title,
}: {
  body: string;
  compact?: boolean;
  title: string;
}) {
  return (
    <div className={cn(
      "flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-muted/20 text-center",
      compact ? "min-h-28 p-4" : "min-h-[280px] p-6",
    )}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 max-w-md text-sm text-muted-foreground">{body}</p>
    </div>
  );
}

function ControlGroup({ children, label }: { children: ReactNode; label: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function Segmented<T extends string | number>({
  labelFor = (option) => String(option),
  onChange,
  options,
  value,
}: {
  labelFor?: (option: T) => string;
  onChange: (value: T) => void;
  options: readonly T[];
  value: T;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option}
          className={cn("h-8 rounded-md border px-2 text-xs font-medium", option === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted")}
          type="button"
          onClick={() => onChange(option)}
        >
          {labelFor(option)}
        </button>
      ))}
    </div>
  );
}

function TickerPicker({
  dict,
  label,
  onChange,
  options,
  requestedTickerAvailability,
  selection,
  tickerIds,
  tickerMode,
}: {
  dict: AnalysisDict;
  label: string;
  onChange: (tickerMode: AnalysisTickerMode, tickerIds: string[]) => void;
  options: AnalysisFilterOption[];
  requestedTickerAvailability: UnrealizedPnlRequestedTickerAvailability[];
  selection: AnalysisSelection;
  tickerIds: string[];
  tickerMode: AnalysisTickerMode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selectedSet = new Set(tickerIds);
  const availableRows = options.map((option) => buildTickerPickerRow(option.value, option.label, true, null));
  const availableIds = new Set(availableRows.map((row) => row.tickerId));
  const unavailableRows = requestedTickerAvailability
    .filter((row) => !row.available && selectedSet.has(row.tickerId) && !availableIds.has(row.tickerId))
    .map((row) => ({
      tickerId: row.tickerId,
      marketCode: row.marketCode,
      ticker: row.ticker,
      label: row.displayName ? `${row.tickerId}:${row.displayName}` : row.tickerId,
      searchText: `${row.tickerId} ${row.displayName ?? ""}`.toLowerCase(),
      available: false,
      reason: row.reason,
    }));
  const rows = [...availableRows, ...unavailableRows];
  const filteredRows = rows.filter((row) => row.searchText.includes(search.trim().toLowerCase()));
  const groups = groupTickerRows(filteredRows);
  const selectedCount = tickerMode === "allEligible" ? 0 : tickerIds.length;
  const isZeroSelectedManualState = selection === "manualTickers" && tickerMode === "custom" && selectedCount === 0;
  const triggerText = tickerMode === "allEligible"
    ? dict.tickerPickerAllEligible
    : isZeroSelectedManualState
      ? dict.tickerPickerZeroSelected
      : dict.tickerPickerCustomCount.replace("{count}", String(selectedCount));
  const helperText = selection === "topDrivers"
    ? dict.driversHint
    : isZeroSelectedManualState
      ? dict.manualEmptyBody
      : dict.tickerMembershipLabel;

  function close(nextOpen: boolean): void {
    setOpen(nextOpen);
    if (!nextOpen) setSearch("");
  }

  function toggle(row: TickerPickerRow): void {
    if (!row.available && selectedSet.has(row.tickerId)) return;
    const next = tickerMode === "allEligible"
      ? new Set(seedCustomTickerIdsFromAllEligible(availableRows.map((candidate) => candidate.tickerId), row.tickerId))
      : new Set(selectedSet);
    if (tickerMode === "allEligible") {
      next.delete(row.tickerId);
    } else if (next.has(row.tickerId)) {
      next.delete(row.tickerId);
    } else {
      if (next.size >= CUSTOM_TICKER_ID_LIMIT) return;
      next.add(row.tickerId);
    }
    onChange("custom", [...next].sort((left, right) => left.localeCompare(right)));
  }

  function removeUnavailable(row: TickerPickerRow): void {
    const next = tickerIds.filter((tickerId) => tickerId !== row.tickerId);
    onChange("custom", next);
  }

  function reset(): void {
    onChange("allEligible", []);
    close(false);
  }

  function checkAll(): void {
    reset();
  }

  function uncheckAll(): void {
    onChange("custom", []);
    close(false);
  }

  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="truncate text-[11px] text-muted-foreground">{helperText}</span>
      </div>
      <Popover open={open} onOpenChange={close}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-left text-sm"
            aria-expanded={open}
            data-testid="analysis-ticker-picker-trigger"
          >
            <span className="min-w-0 truncate">{triggerText}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-0" data-testid="analysis-ticker-picker">
          <div className="border-b border-border p-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-background px-2">
              <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <input
                aria-label={dict.tickerPickerSearch}
                className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none"
                placeholder={dict.tickerPickerSearch}
                value={search}
                onChange={(event) => setSearch(event.currentTarget.value)}
              />
            </div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {selection === "manualTickers" ? (
                <>
                  <Button className="h-8 w-full" variant="secondary" onClick={checkAll}>{dict.tickerPickerCheckAll}</Button>
                  <Button className="h-8 w-full" variant="secondary" onClick={uncheckAll}>{dict.tickerPickerUncheckAll}</Button>
                </>
              ) : null}
              {selection !== "manualTickers" && tickerMode === "custom" ? (
                <Button className="h-8 w-full" variant="secondary" onClick={reset}>{dict.tickerPickerReset}</Button>
              ) : null}
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto p-2" role="listbox" aria-multiselectable="true">
            {groups.length > 0 ? groups.map((group) => (
              <div key={group.marketCode} className="py-1">
                <div className="px-2 py-1 text-[11px] font-semibold uppercase text-muted-foreground">{group.marketCode}</div>
                <div className="grid gap-1">
                  {group.rows.map((row) => {
                    const checked = tickerMode === "allEligible" || selectedSet.has(row.tickerId);
                    const unavailable = !row.available;
                    const wouldExceedCustomLimit = tickerMode === "custom"
                      && !selectedSet.has(row.tickerId)
                      && selectedSet.size >= CUSTOM_TICKER_ID_LIMIT;
                    const disabled = unavailable || wouldExceedCustomLimit;
                    return (
                      <label
                        key={row.tickerId}
                        className={cn(
                          "flex min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted",
                          disabled && "opacity-65",
                        )}
                      >
                        <input
                          checked={checked}
                          disabled={disabled && !selectedSet.has(row.tickerId)}
                          type="checkbox"
                          onChange={() => toggle(row)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{row.label}</span>
                          {unavailable ? <span className="block text-xs text-amber-700">{dict.tickerPickerUnavailable}</span> : null}
                        </span>
                        {unavailable && selectedSet.has(row.tickerId) ? (
                          <button
                            type="button"
                            className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                            aria-label={`${dict.tickerPickerReset} ${row.tickerId}`}
                            onClick={(event) => {
                              event.preventDefault();
                              removeUnavailable(row);
                            }}
                          >
                            <X className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        ) : null}
                      </label>
                    );
                  })}
                </div>
              </div>
            )) : (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">{dict.tickerPickerNoMatches}</div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function seedCustomTickerIdsFromAllEligible(tickerIds: string[], toggledTickerId: string): string[] {
  const uniqueTickerIds = [...new Set(tickerIds)];
  if (uniqueTickerIds.length <= CUSTOM_TICKER_ID_LIMIT) return uniqueTickerIds;
  const cappedTickerIds = uniqueTickerIds.slice(0, CUSTOM_TICKER_ID_LIMIT);
  if (cappedTickerIds.includes(toggledTickerId)) return cappedTickerIds;
  return [
    toggledTickerId,
    ...uniqueTickerIds
      .filter((tickerId) => tickerId !== toggledTickerId)
      .slice(0, CUSTOM_TICKER_ID_LIMIT - 1),
  ];
}

function OptionChecklist({
  label,
  onChange,
  options,
  selected,
}: {
  label: string;
  onChange: (selected: string[]) => void;
  options: AnalysisFilterOption[];
  selected: string[];
}) {
  const selectedSet = new Set(selected);

  function toggle(value: string): void {
    const next = new Set(selectedSet);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange([...next].sort((left, right) => left.localeCompare(right)));
  }

  return (
    <fieldset className="min-w-0 rounded-md border border-border bg-background/70 p-2">
      <legend className="px-1 text-xs font-medium text-muted-foreground">{label}</legend>
      <div className="mt-1 flex max-h-24 flex-wrap gap-1 overflow-y-auto pr-1">
        {options.length > 0 ? options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex h-7 max-w-full items-center gap-1 rounded border px-2 text-xs",
              selectedSet.has(option.value) ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card",
            )}
          >
            <input
              checked={selectedSet.has(option.value)}
              className="sr-only"
              type="checkbox"
              onChange={() => toggle(option.value)}
            />
            <span className="truncate">{option.label}</span>
            {typeof option.count === "number" ? <span className="opacity-70">{option.count}</span> : null}
          </label>
        )) : <span className="text-xs text-muted-foreground">-</span>}
      </div>
    </fieldset>
  );
}

interface TickerPickerRow {
  tickerId: string;
  marketCode: string;
  ticker: string;
  label: string;
  searchText: string;
  available: boolean;
  reason: string | null;
}

function buildTickerPickerRow(tickerId: string, label: string, available: boolean, reason: string | null): TickerPickerRow {
  const [marketCode = "", ticker = ""] = tickerId.split(":");
  return {
    tickerId,
    marketCode,
    ticker,
    label,
    searchText: `${tickerId} ${label}`.toLowerCase(),
    available,
    reason,
  };
}

function groupTickerRows(rows: TickerPickerRow[]): Array<{ marketCode: string; rows: TickerPickerRow[] }> {
  const groups = new Map<string, TickerPickerRow[]>();
  for (const row of rows) {
    const marketRows = groups.get(row.marketCode) ?? [];
    marketRows.push(row);
    groups.set(row.marketCode, marketRows);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([marketCode, marketRows]) => ({
      marketCode,
      rows: marketRows.sort((left, right) => left.ticker.localeCompare(right.ticker)),
    }));
}

function buildTickerDetailHref(
  row: Pick<UnrealizedPnlTickerSelectionRow, "seriesId" | "ticker" | "marketCode">,
  state: UnrealizedPnlAnalysisRouteState,
  data: UnrealizedPnlAnalysisDto | null,
): string {
  const params = new URLSearchParams({
    marketCode: row.marketCode,
    source: "unrealized-pnl-analysis",
  });
  params.set("includeProvisional", (data?.query.includeProvisional ?? state.includeProvisional) ? "true" : "false");
  const fromDate = data?.query.startDate ?? (state.range === "CUSTOM" ? state.from : null);
  const toDate = data?.query.endDate ?? (state.range === "CUSTOM" ? state.to : null);
  if (state.range === "ALL" || customTickerChartRangeExceedsLimit(fromDate, toDate)) {
    params.set("chartRange", "ALL");
  } else {
    if (fromDate) params.set("fromDate", fromDate);
    if (toDate) params.set("toDate", toDate);
  }
  const matchingSeries = data?.tickerSeries.find((series) => series.seriesId === row.seriesId);
  const scopedAccountIds = matchingSeries
    ? matchingSeries.accountIds.filter((accountId) => state.accounts.includes(accountId))
    : state.accounts.length === 1
      ? state.accounts
      : [];
  if (scopedAccountIds.length === 1) {
    params.set("accountId", scopedAccountIds[0]!);
  } else if (scopedAccountIds.length > 1 && scopedAccountIds.length <= TICKER_DETAIL_ACCOUNT_IDS_QUERY_LIMIT) {
    params.set("accountIds", scopedAccountIds.join(","));
  }
  return `/tickers/${encodeURIComponent(row.ticker)}?${params.toString()}`;
}

function customTickerChartRangeExceedsLimit(fromDate: string | null, toDate: string | null): boolean {
  if (!fromDate || !toDate) return false;
  const maxEnd = new Date(`${fromDate}T00:00:00.000Z`);
  maxEnd.setUTCFullYear(maxEnd.getUTCFullYear() + 10);
  return new Date(`${toDate}T00:00:00.000Z`).getTime() > maxEnd.getTime();
}

function analysisDataMatchesState(data: UnrealizedPnlAnalysisDto, state: UnrealizedPnlAnalysisRouteState): boolean {
  return data.query.granularity === state.granularity
    && data.query.selection === state.selection
    && data.query.tickerMode === state.tickerMode
    && data.query.drivers === state.drivers
    && data.query.positionStatus === state.positionStatus
    && data.query.reportingCurrency === state.reportingCurrency
    && data.query.includeProvisional === state.includeProvisional
    && sameStringArray(data.query.markets, state.markets)
    && sameStringArray(data.query.accounts, state.accounts)
    && sameStringArray(data.query.tickerIds, state.tickerMode === "custom" ? state.tickerIds : [])
    && sameStringArray(data.query.instrumentTypes, state.instrumentTypes);
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function analysisMarketOptions(
  capabilityState: ReturnType<typeof resolveUnrealizedPnlCapabilityState>,
  fallback: AnalysisFilterOption[] | undefined,
): AnalysisFilterOption[] {
  if (capabilityState.mode === "loading") return fallback ?? [];
  if (capabilityState.configuredMarkets.length === 0) return [];
  return capabilityState.configuredMarkets.map((market) => ({ value: market, label: market }));
}

function analysisCurrencyOptions(
  capabilityState: ReturnType<typeof resolveUnrealizedPnlCapabilityState>,
  fallback: AnalysisFilterOption[] | undefined,
  currentCurrency: UnrealizedPnlAnalysisRouteState["reportingCurrency"],
): AnalysisFilterOption[] {
  if (capabilityState.mode === "loading") {
    return fallback ?? [{ value: currentCurrency, label: currentCurrency }];
  }
  if (capabilityState.configuredCurrencies.length === 0) {
    return [{ value: currentCurrency, label: currentCurrency }];
  }
  return capabilityState.configuredCurrencies.map((currency) => ({ value: currency, label: currency }));
}

function formatNullableCurrency(value: number | null, currency: string, locale: LocaleCode): string {
  return value === null ? "-" : formatCurrencyAmount(value, currency as never, locale);
}

function formatNullableCompactCurrency(value: number | null, currency: string, locale: LocaleCode): string {
  return value === null ? "-" : formatCompactCurrencyAmount(value, currency as never, locale);
}

function SummaryCard({
  actionIcon,
  currency,
  label,
  locale,
  value,
}: {
  actionIcon?: ReactNode;
  currency: string;
  label: string;
  locale: LocaleCode;
  value: number | null;
}) {
  return (
    <Card className="h-full">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
          {actionIcon ? <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-primary/30 bg-primary/10 text-primary">{actionIcon}</span> : null}
        </div>
        <p className={cn("mt-2 text-xl font-semibold", value !== null && value < 0 ? "text-red-600" : "text-foreground")}>
          {value === null ? "-" : formatCurrencyAmount(value, currency as never, locale)}
        </p>
      </CardContent>
    </Card>
  );
}

function DriverCard({ label, text }: { label: string; text: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className="mt-2 text-sm font-medium text-foreground">{text}</p>
      </CardContent>
    </Card>
  );
}

function DetailTerm({ label, toneValue, value }: { label: string; toneValue?: number | null; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("font-medium", toneValue === undefined ? "text-foreground" : holdingsFinanceToneClass(toneValue, "text-foreground"))}>{value}</dd>
    </div>
  );
}

function SelectionBadge({
  label,
  tone,
}: {
  label: string;
  tone: "default" | "manual" | "muted";
}) {
  return (
    <span className={cn(
      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
      tone === "manual"
        ? "bg-violet-100 text-violet-700"
        : tone === "muted"
          ? "bg-muted text-muted-foreground"
          : "bg-muted text-muted-foreground",
    )}>
      {label}
    </span>
  );
}

function AnalysisSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-3 md:grid-cols-4">
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="h-24 animate-pulse rounded-md border border-border bg-muted/50" />
      ))}
      <div className="h-80 animate-pulse rounded-md border border-border bg-muted/50 md:col-span-3" />
      <div className="h-80 animate-pulse rounded-md border border-border bg-muted/50" />
    </div>
  );
}
