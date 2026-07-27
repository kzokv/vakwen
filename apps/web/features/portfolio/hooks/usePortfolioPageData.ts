"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteCachePolicyDto } from "@vakwen/shared-types";
import {
  buildRouteDtoCacheTag,
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  type RouteDtoCacheStatus,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import { shouldPollForOpenMarket } from "../../price-state/priceState";
import {
  fetchPortfolioEnrichmentData,
  fetchPortfolioPrimaryData,
  type PortfolioPageData,
} from "../services/portfolioService";

const EMPTY_PORTFOLIO_PAGE_DATA: PortfolioPageData = {
  capabilities: {
    configuredMarkets: [],
    configuredCurrencies: [],
  },
  holdings: [],
  holdingGroups: [],
  dividends: {
    upcoming: [],
    recent: [],
  },
  instruments: [],
  fxRates: [],
  accounts: [],
  feeProfiles: [],
  feeProfileBindings: [],
  integrityIssue: null,
  refreshPending: null,
};

const PORTFOLIO_PRIMARY_CACHE_TAGS = [buildRouteDtoCacheTag("route", "portfolio-primary")];

export function usePortfolioPrimaryData(
  initialPrimaryData: PortfolioPageData | null = null,
  cacheKey?: string,
  cachePolicy?: RouteCachePolicyDto | null,
  openMarketPollMs?: number | null,
) {
  const cacheDurations = resolveRouteDtoCacheDurations(cachePolicy, "portfolio-primary");
  const initialCachedRef = useRef<ReturnType<typeof readRouteDtoCache<PortfolioPageData>> | undefined>(undefined);
  if (initialCachedRef.current === undefined) {
    initialCachedRef.current = initialPrimaryData === null && cacheKey
      ? readPortfolioCache(cacheKey, openMarketPollMs)
      : null;
  }
  const initialCached = initialCachedRef.current;
  const [data, setData] = useState<PortfolioPageData>(initialPrimaryData ?? initialCached?.payload ?? EMPTY_PORTFOLIO_PAGE_DATA);
  const [isBootstrapping, setIsBootstrapping] = useState(initialPrimaryData === null && initialCached === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cacheStatus, setCacheStatus] = useState<RouteDtoCacheStatus | null>(initialCached?.status ?? null);
  const [restoredFromCache, setRestoredFromCache] = useState(initialPrimaryData === null && initialCached !== null);
  const [restoredAt, setRestoredAt] = useState<number | null>(initialCached?.savedAt ?? null);
  const [quoteRefreshVersion, setQuoteRefreshVersion] = useState(0);
  const initialCacheKeyRef = useRef(cacheKey);
  const requestVersionRef = useRef(0);

  const startRequest = useCallback(() => {
    requestVersionRef.current += 1;
    return requestVersionRef.current;
  }, []);

  const isCurrentRequest = useCallback((version: number) => version === requestVersionRef.current, []);

  const refreshEnrichment = useCallback(async (
    version: number,
    options?: { markQuoteRefresh?: boolean },
  ) => {
    try {
      const next = await fetchPortfolioEnrichmentData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      if (cacheKey) {
        writeRouteDtoCache(cacheKey, next, {
          staleTtlMs: cacheDurations.staleTtlMs,
          tags: PORTFOLIO_PRIMARY_CACHE_TAGS,
          ttlMs: cacheDurations.ttlMs,
        });
      }
      setCacheStatus("fresh");
      setErrorMessage("");
      if (options?.markQuoteRefresh) {
        setQuoteRefreshVersion((current) => current + 1);
      }
    } catch {
      // Secondary quote/freshness/dividend enrichment must not blank primary content.
    }
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, isCurrentRequest]);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const next = await fetchPortfolioPrimaryData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      if (cacheKey) {
        writeRouteDtoCache(cacheKey, next, {
          staleTtlMs: cacheDurations.staleTtlMs,
          tags: PORTFOLIO_PRIMARY_CACHE_TAGS,
          ttlMs: cacheDurations.ttlMs,
        });
      }
      setCacheStatus("fresh");
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      void refreshEnrichment(version);
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, isCurrentRequest, refreshEnrichment, startRequest]);

  const refreshPrices = useCallback(async () => {
    await refreshEnrichment(requestVersionRef.current, { markQuoteRefresh: true });
  }, [refreshEnrichment]);

  useEffect(() => {
    const shouldUseInitialData = initialPrimaryData !== null && initialCacheKeyRef.current === cacheKey;
    if (shouldUseInitialData) {
      const version = startRequest();
      setData(initialPrimaryData);
      if (cacheKey) {
        writeRouteDtoCache(cacheKey, initialPrimaryData, {
          staleTtlMs: cacheDurations.staleTtlMs,
          tags: PORTFOLIO_PRIMARY_CACHE_TAGS,
          ttlMs: cacheDurations.ttlMs,
        });
      }
      setCacheStatus("fresh");
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      void refreshEnrichment(version);
      return;
    }

    const cached = cacheKey ? readPortfolioCache(cacheKey, openMarketPollMs) : null;
    if (cached !== null) {
      const version = startRequest();
      setData(cached.payload);
      setIsBootstrapping(false);
      setCacheStatus(cached.status);
      setRestoredFromCache(true);
      setRestoredAt(cached.savedAt);
      if (cached.status === "stale") {
        void refresh();
      } else if (needsPortfolioEnrichment(cached.payload)) {
        void refreshEnrichment(version);
      }
      return;
    }

    let mounted = true;
    async function load() {
      try {
        await refresh();
      } finally {
        if (mounted) setIsBootstrapping(false);
      }
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, initialPrimaryData, openMarketPollMs, refresh, refreshEnrichment, startRequest]);

  return {
    data,
    isBootstrapping,
    isRefreshing,
    errorMessage,
    refresh,
    refreshPrices,
    cacheStatus,
    restoredFromCache,
    restoredAt,
    quoteRefreshVersion,
  };
}

function needsPortfolioEnrichment(data: PortfolioPageData): boolean {
  return data.holdings.some((holding) => holding.marketValueAmount === null);
}

function readPortfolioCache(
  cacheKey: string,
  openMarketPollMs?: number | null,
): ReturnType<typeof readRouteDtoCache<PortfolioPageData>> {
  const cached = readRouteDtoCache<PortfolioPageData>(cacheKey);
  if (
    cached !== null
    && typeof openMarketPollMs === "number"
    && openMarketPollMs > 0
    && shouldPollForOpenMarket(cached.payload.holdings)
    && Date.now() - cached.createdAt > openMarketPollMs
  ) {
    return null;
  }
  return cached;
}
