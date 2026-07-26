"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RouteCachePolicyDto, TransactionPrimaryDto } from "@vakwen/shared-types";
import {
  buildRouteDtoCacheTag,
  readRouteDtoCache,
  resolveRouteDtoCacheDurations,
  type RouteDtoCacheStatus,
  writeRouteDtoCache,
} from "../../../lib/routeDtoCache";
import { resolveErrorMessage } from "../../../lib/utils";
import { fetchTransactionsPrimaryData } from "../services/portfolioService";

const EMPTY_PORTFOLIO_CAPABILITIES = {
  configuredMarkets: [],
  configuredCurrencies: [],
} as const;

const EMPTY_PRIMARY_DATA: TransactionPrimaryDto = {
  recentTransactions: [],
  accountOptions: [],
  capabilities: EMPTY_PORTFOLIO_CAPABILITIES,
  portfolioConfig: {
    accounts: [],
    feeProfiles: [],
    feeProfileBindings: [],
    integrityIssue: null,
    capabilities: EMPTY_PORTFOLIO_CAPABILITIES,
  } as TransactionPrimaryDto["portfolioConfig"],
};

const TRANSACTIONS_PRIMARY_CACHE_TAGS = [buildRouteDtoCacheTag("route", "transactions-primary")];

export function useTransactionsPrimaryData(
  initialPrimaryData: TransactionPrimaryDto | null = null,
  cacheKey?: string,
  cachePolicy?: RouteCachePolicyDto | null,
) {
  const cacheDurations = resolveRouteDtoCacheDurations(cachePolicy, "transactions-primary");
  const initialCachedRef = useState<ReturnType<typeof readRouteDtoCache<TransactionPrimaryDto>>>(() =>
    initialPrimaryData === null && cacheKey
      ? readRouteDtoCache<TransactionPrimaryDto>(cacheKey)
      : null,
  )[0];
  const initialCached = initialCachedRef;
  const [data, setData] = useState<TransactionPrimaryDto>(initialPrimaryData ?? initialCached?.payload ?? EMPTY_PRIMARY_DATA);
  const [isBootstrapping, setIsBootstrapping] = useState(initialPrimaryData === null && initialCached === null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [cacheStatus, setCacheStatus] = useState<RouteDtoCacheStatus | null>(initialCached?.status ?? null);
  const [restoredFromCache, setRestoredFromCache] = useState(initialPrimaryData === null && initialCached !== null);
  const [restoredAt, setRestoredAt] = useState<number | null>(initialCached?.savedAt ?? null);
  const initialCacheKeyRef = useRef(cacheKey);
  const requestVersionRef = useRef(0);

  const startRequest = useCallback(() => {
    requestVersionRef.current += 1;
    return requestVersionRef.current;
  }, []);

  const isCurrentRequest = useCallback((version: number) => version === requestVersionRef.current, []);

  const refresh = useCallback(async () => {
    const version = startRequest();
    setIsRefreshing(true);
    try {
      const next = await fetchTransactionsPrimaryData();
      if (!isCurrentRequest(version)) return;
      setData(next);
      if (cacheKey) {
        writeRouteDtoCache(cacheKey, next, {
          staleTtlMs: cacheDurations.staleTtlMs,
          tags: TRANSACTIONS_PRIMARY_CACHE_TAGS,
          ttlMs: cacheDurations.ttlMs,
        });
      }
      setCacheStatus("fresh");
      setErrorMessage("");
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
    } catch (error) {
      if (!isCurrentRequest(version)) return;
      setErrorMessage(resolveErrorMessage(error));
    } finally {
      if (isCurrentRequest(version)) setIsRefreshing(false);
    }
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, isCurrentRequest, startRequest]);

  useEffect(() => {
    const shouldUseInitialData = initialPrimaryData !== null && initialCacheKeyRef.current === cacheKey;
    if (shouldUseInitialData) {
      startRequest();
      setData(initialPrimaryData);
      if (cacheKey) {
        writeRouteDtoCache(cacheKey, initialPrimaryData, {
          staleTtlMs: cacheDurations.staleTtlMs,
          tags: TRANSACTIONS_PRIMARY_CACHE_TAGS,
          ttlMs: cacheDurations.ttlMs,
        });
      }
      setCacheStatus("fresh");
      setIsBootstrapping(false);
      setRestoredFromCache(false);
      setRestoredAt(Date.now());
      return;
    }

    const cached = cacheKey ? readRouteDtoCache<TransactionPrimaryDto>(cacheKey) : null;
    if (cached !== null) {
      startRequest();
      setData(cached.payload);
      setIsBootstrapping(false);
      setCacheStatus(cached.status);
      setRestoredFromCache(true);
      setRestoredAt(cached.savedAt);
      if (cached.status === "stale") {
        void refresh();
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
  }, [cacheDurations.staleTtlMs, cacheDurations.ttlMs, cacheKey, initialPrimaryData, refresh, startRequest]);

  return {
    data,
    errorMessage,
    isBootstrapping,
    isRefreshing,
    refresh,
    cacheStatus,
    restoredFromCache,
    restoredAt,
  };
}
