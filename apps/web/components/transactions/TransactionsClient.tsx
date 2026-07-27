"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { TransactionPrimaryDto } from "@vakwen/shared-types";
import { formatNumber } from "../../lib/utils";
import { useTransactionHistory } from "../../features/portfolio/hooks/useTransactionHistory";
import { useTransactionsPrimaryData } from "../../features/portfolio/hooks/useTransactionsPrimaryData";
import {
  mergeTransactionHistoryRouteStateIntoSearchParams,
  normalizeTransactionHistoryRouteState,
  parseTransactionHistoryRouteState,
  transactionHistoryRouteStatesEqual,
  type TransactionHistoryRouteState,
  type TransactionHistorySortBy,
} from "../../features/portfolio/transactionHistoryRouteState";
import { useAppShellData } from "../layout/AppShellDataContext";
import { useCardLayoutResetCount } from "../layout/CardLayoutResetContext";
import { SortableCardGrid } from "../layout/SortableCardGrid";
import { buildRouteDtoCacheKey, getRouteDtoContextScope } from "../../lib/routeDtoCache";
import { AddTransactionCard } from "../portfolio/AddTransactionCard";
import { CapabilityNormalizationNotice } from "../../features/portfolio-capabilities/components/CapabilityNormalizationNotice";
import { ZeroAccountSetupGate } from "../../features/portfolio-capabilities/components/ZeroAccountSetupGate";
import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import { TabsContent, TabsList, TabsRoot, TabsTrigger } from "../ui/Tabs";
import { AiInboxPanel } from "./AiInboxPanel";
import { TransactionHistoryBrowser } from "./TransactionHistoryBrowser";
import { resolveTransactionMarketCapabilityState } from "../../features/portfolio/transactionMarketCapabilities";

interface TransactionsClientProps {
  initialTab?: "posted" | "ai-inbox";
  initialBatchId?: string | null;
  initialContextId?: string | null;
  initialPrimaryData?: TransactionPrimaryDto | null;
}

export function TransactionsClient({
  initialTab = "posted",
  initialBatchId = null,
  initialContextId = null,
  initialPrimaryData = null,
}: TransactionsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams?.toString() ?? "";
  const [activeTab, setActiveTab] = useState<"posted" | "ai-inbox">(initialTab);
  const {
    uiDict: dict,
    locale,
    routeCachePolicy,
    sessionUserId,
    isSharedContext,
    sharedContextPermissions,
    transactionSubmission,
    transactionAccountOptions,
    contextRefreshSignal,
  } = useAppShellData();
  const resetCount = useCardLayoutResetCount("transactions");
  const cacheKey = buildRouteDtoCacheKey("transactions-primary", getRouteDtoContextScope(sessionUserId), locale);
  const seededPrimaryData = contextRefreshSignal === 0 ? initialPrimaryData : null;
  const primary = useTransactionsPrimaryData(seededPrimaryData, cacheKey, routeCachePolicy);
  const historyState = useMemo(
    () => parseTransactionHistoryRouteState(new URLSearchParams(searchParamsKey)),
    [searchParamsKey],
  );
  const historyQuery = useMemo(() => ({
    accountId: historyState.accountId,
    from: historyState.from,
    limit: historyState.limit,
    marketCode: historyState.marketCode,
    offset: historyState.offset,
    pnl: historyState.pnl,
    sortBy: historyState.sortBy,
    sortOrder: historyState.sortOrder,
    ticker: historyState.ticker,
    to: historyState.to,
    type: historyState.type,
  }), [historyState]);
  const history = useTransactionHistory(historyQuery, { enabled: activeTab === "posted" });
  const addPanelRef = useRef<HTMLDivElement | null>(null);
  const [marketNormalizationNotice, setMarketNormalizationNotice] = useState<{
    id: number;
    key: string;
    effectiveLabel: string;
    normalization: NonNullable<ReturnType<typeof resolveTransactionMarketCapabilityState>["normalization"]>;
  } | null>(null);
  const handledMarketNormalizationKeyRef = useRef<string | null>(null);
  const effectiveTransactionAccountOptions = transactionAccountOptions.length > 0
    ? transactionAccountOptions
    : primary.data.accountOptions;
  const canWriteTransactions = !isSharedContext || sharedContextPermissions.canWriteTransactions;
  const canReadAiDrafts = !isSharedContext || sharedContextPermissions.canReadAiDrafts;
  const canManageAccounts = !isSharedContext || sharedContextPermissions.canManageAccounts;
  const transactionCapabilities = primary.isBootstrapping ? null : primary.data.capabilities ?? null;
  const marketCapabilities = useMemo(
    () => resolveTransactionMarketCapabilityState(transactionCapabilities, historyState.marketCode),
    [historyState.marketCode, transactionCapabilities],
  );

  const updateHistoryState = useCallback((
    patch: Partial<TransactionHistoryRouteState>,
    options: { resetOffset?: boolean; removeReturnTo?: boolean } = {},
  ) => {
    const next = normalizeTransactionHistoryRouteState({
      ...historyState,
      ...patch,
      offset: options.resetOffset ? 0 : patch.offset ?? historyState.offset,
      returnTo: options.removeReturnTo ? null : patch.returnTo ?? historyState.returnTo,
    });
    if (transactionHistoryRouteStatesEqual(historyState, next)) return;
    const params = mergeTransactionHistoryRouteStateIntoSearchParams(new URLSearchParams(searchParamsKey), next);
    const query = params.toString();
    router.replace(query ? `/transactions?${query}` : "/transactions", { scroll: false });
  }, [historyState, router, searchParamsKey]);

  useEffect(() => {
    setActiveTab(initialTab === "ai-inbox" && !canReadAiDrafts ? "posted" : initialTab);
  }, [canReadAiDrafts, initialTab]);

  useEffect(() => {
    const current = new URLSearchParams(searchParamsKey);
    const normalized = mergeTransactionHistoryRouteStateIntoSearchParams(current, historyState);
    if (normalized.toString() !== current.toString()) {
      const query = normalized.toString();
      router.replace(query ? `/transactions?${query}` : "/transactions", { scroll: false });
    }
  }, [historyState, router, searchParamsKey]);

  useEffect(() => {
    if (primary.isBootstrapping) return;

    const normalizationKey = `${historyState.marketCode}->${marketCapabilities.filterMarketCode}:${marketCapabilities.normalization?.reason ?? "none"}`;
    if (historyState.marketCode === marketCapabilities.filterMarketCode) {
      if (handledMarketNormalizationKeyRef.current === normalizationKey) {
        handledMarketNormalizationKeyRef.current = null;
      }
      return;
    }

    if (handledMarketNormalizationKeyRef.current === normalizationKey) {
      return;
    }
    handledMarketNormalizationKeyRef.current = normalizationKey;

    const marketNormalization = marketCapabilities.normalization;
    if (marketNormalization?.reason === "unconfigured_market" && marketCapabilities.filterMarketCode !== "ALL") {
      setMarketNormalizationNotice((current) => (
        current?.key === normalizationKey
          ? current
          : {
              id: Date.now(),
              key: normalizationKey,
              effectiveLabel: marketCapabilities.filterMarketCode,
              normalization: marketNormalization,
            }
      ));
    }

    updateHistoryState({ marketCode: marketCapabilities.filterMarketCode }, { resetOffset: true });
  }, [
    historyState.marketCode,
    marketCapabilities.filterMarketCode,
    marketCapabilities.normalization,
    primary.isBootstrapping,
    updateHistoryState,
  ]);

  // Re-fetch when AppShell signals a context/data change (shared-context
  // switch, transaction submit, retry click). Initial mount skipped.
  const handledSignalRef = useRef(contextRefreshSignal);
  useEffect(() => {
    if (handledSignalRef.current === contextRefreshSignal) {
      return;
    }
    handledSignalRef.current = contextRefreshSignal;
    void primary.refresh();
    if (activeTab === "posted") {
      void history.refresh();
    }
  }, [activeTab, contextRefreshSignal, history.refresh, primary.refresh]);

  useEffect(() => {
    if (history.data.total === 0 || historyState.offset < history.data.total) return;
    const lastPageOffset = Math.floor((history.data.total - 1) / historyState.limit) * historyState.limit;
    updateHistoryState({ offset: lastPageOffset });
  }, [history.data.total, historyState.limit, historyState.offset, updateHistoryState]);

  // TODO(performance-smooth-pages): switch these summary cards to a dedicated
  // transactions read-model endpoint when the backend exposes one. For now we
  // keep `/transactions` independent from `/dashboard/overview` by deriving
  // lightweight metrics from recent transactions + shell account config.
  const recentCountValue = primary.isBootstrapping
    ? "..."
    : formatNumber(primary.data.recentTransactions.length, locale);
  const uniqueTickerCount = primary.isBootstrapping
    ? "..."
    : formatNumber(new Set(primary.data.recentTransactions.map((item) => `${item.ticker}:${item.marketCode ?? "na"}`)).size, locale);
  const accountCountValue = effectiveTransactionAccountOptions.length > 0
    ? formatNumber(effectiveTransactionAccountOptions.length, locale)
    : primary.isBootstrapping
      ? "..."
      : "0";
  const restoredLabel = primary.restoredAt
    ? new Intl.DateTimeFormat(locale === "zh-TW" ? "zh-TW" : "en-US", {
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(primary.restoredAt))
    : null;

  function handleTabChange(next: string) {
    const tab = next === "ai-inbox" && canReadAiDrafts ? "ai-inbox" : "posted";
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    if (tab === "posted") {
      params.delete("tab");
      params.delete("batch");
      params.delete("context");
    } else {
      params.set("tab", "ai-inbox");
      if (initialBatchId) params.set("batch", initialBatchId);
      if (initialContextId) params.set("context", initialContextId);
    }
    const query = params.toString();
    router.replace(query ? `/transactions?${query}` : "/transactions", { scroll: false });
  }

  function handleAddTransactionClick() {
    if (activeTab !== "posted") {
      handleTabChange("posted");
      window.setTimeout(() => {
        addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      return;
    }

    addPanelRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function handleHistorySort(field: TransactionHistorySortBy) {
    updateHistoryState({
      sortBy: field,
      sortOrder: historyState.sortBy === field && historyState.sortOrder === "desc" ? "asc" : "desc",
    }, { resetOffset: true });
  }

  function handleRefreshClick() {
    void primary.refresh();
    if (activeTab === "posted") {
      void history.refresh();
    }
  }

  return (
    <div className="stagger grid min-w-0 gap-6">
      <section
        className="grid gap-4 rounded-xl border border-border bg-card px-5 py-5 shadow-sm sm:px-6"
        data-testid="transactions-intro"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.3em] text-primary/78">{dict.navigation.transactionsLabel}</p>
            <h1 className="mt-2 text-2xl font-semibold text-foreground sm:text-3xl">{dict.navigation.transactionsLabel}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{dict.navigation.transactionsDescription}</p>
          </div>
          <button
            type="button"
            onClick={handleAddTransactionClick}
            disabled={!canWriteTransactions}
            className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
          >
            {dict.transactions.title}
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <CompactMetric
            label={dict.dashboardHome.accountCountLabel}
            value={accountCountValue}
            detail={dict.navigation.transactionsLabel}
          />
          <CompactMetric
            label={dict.transactions.recentLedgerTitle}
            value={recentCountValue}
            detail={dict.transactions.recentLedgerDescription}
          />
          <CompactMetric
            label={dict.holdings.tickerTerm}
            value={uniqueTickerCount}
            detail={dict.transactions.verificationDescription}
          />
          <CompactMetric
            label={dict.transactions.verificationTitle}
            value={activeTab === "ai-inbox" ? "AI" : dict.navigation.transactionsLabel}
            detail={!canWriteTransactions && isSharedContext ? dict.switcher.readonlyDescription : dict.navigation.transactionsDescription}
          />
        </div>
      </section>
      <div
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 text-sm text-muted-foreground"
        data-testid="transactions-primary-refresh-strip"
      >
        <div className="flex flex-wrap items-center gap-2">
          {primary.restoredFromCache && restoredLabel ? (
            <span data-testid="transactions-cache-restore-label">Restored from cache at {restoredLabel}</span>
          ) : (
            <span>Recent rows stay visible while transactions refresh.</span>
          )}
          {primary.isRefreshing ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
              Refreshing
            </span>
          ) : null}
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleRefreshClick}
          disabled={primary.isRefreshing || history.isLoading}
          data-testid="transactions-refresh-button"
        >
          Refresh
        </Button>
      </div>

      <TabsRoot value={activeTab} onValueChange={handleTabChange}>
        <TabsList data-testid="transactions-tabs">
          <TabsTrigger value="posted" data-testid="transactions-tab-posted">Posted</TabsTrigger>
          {canReadAiDrafts ? (
            <TabsTrigger value="ai-inbox" data-testid="transactions-tab-ai-inbox">AI Inbox</TabsTrigger>
          ) : null}
        </TabsList>

        <TabsContent value="posted">
          {transactionCapabilities && marketCapabilities.configuredMarkets.length === 0 ? (
            <ZeroAccountSetupGate
              dict={dict}
              canManageAccounts={canManageAccounts}
              returnTo="/transactions"
            />
          ) : (
            <>
              {marketNormalizationNotice ? (
                <CapabilityNormalizationNotice
                  key={`transactions-market-normalization-${marketNormalizationNotice.id}`}
                  dict={dict}
                  kind="market"
                  normalization={marketNormalizationNotice.normalization}
                  effectiveLabel={marketNormalizationNotice.effectiveLabel}
                />
              ) : null}
              <TransactionHistoryBrowser
                accountOptions={effectiveTransactionAccountOptions}
                availableMarkets={marketCapabilities.configuredMarkets}
                data={history.data}
                dict={dict}
                errorMessage={history.errorMessage}
                isLoading={history.isLoading}
                locale={locale}
                onChange={updateHistoryState}
                onSort={handleHistorySort}
                state={historyState}
              />
          {/*
            KZO-162 — Add/status cards render through one SortableCardGrid.
            The full transaction history browser is fixed above this grid so
            report deep links land on visible filtered results. Both remaining
            slugs declare `fullWidth: true` so they stack vertically and can be
            reordered. The `transactions-add` slot renders the
            AddTransactionCard normally and a read-only notice in shared context;
            either way the slot stays in the saved order so a user's preferred
            position survives context switches.
            To add a card here, append a `{slug, fullWidth}` entry AND add a
            `case` to the switch below.
          */}
          <SortableCardGrid
            key={`card-grid-transactions-${resetCount}`}
            orderKey="transactions"
            cards={[
              { slug: "transactions-status", fullWidth: true },
              { slug: "transactions-add", fullWidth: true },
            ]}
          >
            {(slug) => {
              switch (slug) {
                case "transactions-status":
                  return (
                    <Card data-testid="transactions-verification-panel">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">
                        {dict.transactions.verificationTitle}
                      </p>
                      <h2 className="mt-2 text-xl font-semibold text-foreground">{dict.transactions.verificationTitle}</h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">{dict.transactions.verificationDescription}</p>
                      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        <CompactMetric
                          label={dict.dashboardHome.accountCountLabel}
                          value={accountCountValue}
                          detail={dict.navigation.transactionsLabel}
                        />
                        <CompactMetric
                          label={dict.transactions.recentLedgerTitle}
                          value={recentCountValue}
                          detail={dict.transactions.recentLedgerDescription}
                        />
                        <CompactMetric
                          label={dict.holdings.tickerTerm}
                          value={uniqueTickerCount}
                          detail={dict.transactions.verificationDescription}
                        />
                      </div>
                    </Card>
                  );
                case "transactions-add":
                  return !canWriteTransactions ? (
                    <Card
                      className="border border-rose-200 bg-rose-50/90 text-rose-700"
                      data-testid="transactions-readonly"
                    >
                      <p role="status" aria-live="polite">{dict.switcher.readonlyDescription}</p>
                    </Card>
                  ) : (
                    <Card>
                      <div ref={addPanelRef} className="mb-5 min-w-0">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">{dict.transactions.title}</p>
                        <h2 className="mt-2 text-xl font-semibold text-foreground">{dict.transactions.title}</h2>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{dict.transactions.description}</p>
                      </div>
                      <AddTransactionCard
                        value={transactionSubmission.draftTransaction}
                        accountOptions={effectiveTransactionAccountOptions}
                        availableMarkets={marketCapabilities.configuredMarkets}
                        pending={transactionSubmission.isSubmitting}
                        onChange={(next) => {
                          transactionSubmission.setMessage("");
                          transactionSubmission.setDraftTransaction(next);
                        }}
                        onUnitPriceEdited={transactionSubmission.markUnitPriceEdited}
                        onSubmit={async () => {
                          await transactionSubmission.submit();
                        }}
                        dict={dict}
                        locale={locale}
                        framed={false}
                        showHeader={false}
                        priceHint={transactionSubmission.priceHint}
                        showPriceUnavailableHint={transactionSubmission.showPriceUnavailableHint}
                        feeEstimate={transactionSubmission.feeEstimate}
                        sellAvailability={transactionSubmission.sellAvailability}
                        sellAvailabilityRequestKey={transactionSubmission.sellAvailabilityRequestKey}
                        isSellAvailabilityLoading={transactionSubmission.isSellAvailabilityLoading}
                        sellAvailabilityTransportError={transactionSubmission.sellAvailabilityTransportError}
                      />
                    </Card>
                  );
                default:
                  return null;
              }
            }}
          </SortableCardGrid>
            </>
          )}
        </TabsContent>

        {canReadAiDrafts ? (
          <TabsContent value="ai-inbox">
            <AiInboxPanel
              initialBatchId={initialBatchId}
              initialContextId={initialContextId}
              locale={locale}
              permissions={isSharedContext ? sharedContextPermissions : null}
            />
          </TabsContent>
        ) : null}
      </TabsRoot>
    </div>
  );
}

function CompactMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
      <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{detail}</p>
    </div>
  );
}
