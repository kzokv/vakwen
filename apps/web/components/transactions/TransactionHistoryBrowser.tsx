"use client";

import Link from "next/link";
import { MARKET_CODES, type LocaleCode, type MarketCode, type TransactionAccountOptionDto, type TransactionHistoryPageDto } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatNumber } from "../../lib/utils";
import { SingleCapabilityContext } from "../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { holdingsFinanceSurfaceClass } from "../holdings/holdingsStyle";
import { TransactionHistoryTable } from "./TransactionHistoryTable";
import {
  DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE,
  TRANSACTION_HISTORY_LIMIT_VALUES,
  type TransactionHistoryRouteState,
  type TransactionHistorySortBy,
} from "../../features/portfolio/transactionHistoryRouteState";

interface TransactionHistoryBrowserProps {
  accountOptions: TransactionAccountOptionDto[];
  availableMarkets?: readonly MarketCode[];
  data: TransactionHistoryPageDto;
  dict: AppDictionary;
  errorMessage: string;
  isLoading: boolean;
  locale: LocaleCode;
  onChange: (patch: Partial<TransactionHistoryRouteState>, options?: { resetOffset?: boolean; removeReturnTo?: boolean }) => void;
  onSort: (field: TransactionHistorySortBy) => void;
  state: TransactionHistoryRouteState;
}

export function TransactionHistoryBrowser({
  accountOptions,
  availableMarkets,
  data,
  dict,
  errorMessage,
  isLoading,
  locale,
  onChange,
  onSort,
  state,
}: TransactionHistoryBrowserProps) {
  const supportedMarkets = availableMarkets && availableMarkets.length > 0
    ? MARKET_CODES.filter((marketCode) => availableMarkets.includes(marketCode))
    : MARKET_CODES;
  const chips = buildActiveFilterChips(dict, state, accountOptions);
  const pageStart = data.total === 0 ? 0 : state.offset + 1;
  const pageEnd = Math.min(state.offset + data.items.length, data.total);
  const hasPrevPage = state.offset > 0;
  const hasNextPage = state.offset + state.limit < data.total;

  return (
    <Card data-testid="transaction-history-browser">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary/78">
              {dict.navigation.transactionsLabel}
            </p>
            <h2 className="mt-2 text-xl font-semibold text-foreground sm:text-2xl">
              {dict.transactions.historyTitle}
            </h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">
              {dict.transactions.historyDescription}
            </p>
          </div>
          {state.returnTo ? (
            <Link
              href={state.returnTo}
              className="inline-flex items-center justify-center rounded-lg border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition hover:bg-accent"
              data-testid="transaction-history-back-link"
            >
              {dict.transactions.backToReport}
            </Link>
          ) : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" data-testid="transaction-history-toolbar">
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.typeTerm}</span>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={state.type}
              onChange={(event) => onChange({ type: event.target.value as TransactionHistoryRouteState["type"] }, { resetOffset: true })}
            >
              <option value="ALL">{dict.transactions.filterAllTypes}</option>
              <option value="BUY">{dict.transactions.typeBuy}</option>
              <option value="SELL">{dict.transactions.typeSell}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.filterPnl}</span>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={state.pnl}
              onChange={(event) => onChange({ pnl: event.target.value as TransactionHistoryRouteState["pnl"] }, { resetOffset: true })}
            >
              <option value="any">{dict.transactions.filterPnlAny}</option>
              <option value="realized">{dict.transactions.filterPnlRealized}</option>
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.marketTerm}</span>
            {supportedMarkets.length === 1 ? (
              <SingleCapabilityContext
                label={dict.transactions.marketTerm}
                value={getMarketFilterLabel(dict, supportedMarkets[0] ?? "ALL")}
                testId="transaction-history-market-context-single"
              />
            ) : (
              <select
                className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
                value={state.marketCode}
                data-testid="transaction-history-market-filter"
                onChange={(event) => onChange({ marketCode: event.target.value as TransactionHistoryRouteState["marketCode"] }, { resetOffset: true })}
              >
                <option value="ALL">{dict.transactions.filterAllMarkets}</option>
                {supportedMarkets.map((marketCode) => (
                  <option key={marketCode} value={marketCode}>{getMarketFilterLabel(dict, marketCode)}</option>
                ))}
              </select>
            )}
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.accountTerm}</span>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={state.accountId}
              onChange={(event) => onChange({ accountId: event.target.value }, { resetOffset: true })}
            >
              <option value="ALL">{dict.transactions.filterAllAccounts}</option>
              {accountOptions.map((account) => (
                <option key={account.id} value={account.id}>{account.name}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.tickerTerm}</span>
            <input
              type="text"
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={state.ticker}
              onChange={(event) => onChange({ ticker: event.target.value.toUpperCase() }, { resetOffset: true })}
              placeholder={dict.transactions.tickerPlaceholder}
              data-testid="transaction-history-ticker-filter"
            />
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.filterTradeDateFrom}</span>
            <input
              type="date"
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={state.from}
              onChange={(event) => onChange({ from: event.target.value }, { resetOffset: true })}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.filterTradeDateTo}</span>
            <input
              type="date"
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={state.to}
              onChange={(event) => onChange({ to: event.target.value }, { resetOffset: true })}
            />
          </label>
          <label className="grid gap-1 text-sm text-muted-foreground">
            <span>{dict.transactions.pageSizeLabel}</span>
            <select
              className="rounded-lg border border-border bg-background px-3 py-2 text-foreground"
              value={String(state.limit)}
              onChange={(event) => onChange({ limit: Number(event.target.value) as TransactionHistoryRouteState["limit"] }, { resetOffset: true })}
            >
              {TRANSACTION_HISTORY_LIMIT_VALUES.map((limit) => (
                <option key={limit} value={String(limit)}>{limit}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex flex-col gap-3 rounded-xl border border-border/70 bg-muted/20 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground" data-testid="transaction-history-result-count">
              {dict.transactions.resultsCount
                .replace("{count}", formatNumber(data.total, locale))
                .replace("{start}", formatNumber(pageStart, locale))
                .replace("{end}", formatNumber(pageEnd, locale))}
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-testid="transaction-history-clear-all"
              onClick={() => onChange(DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE, { removeReturnTo: true })}
            >
              {dict.transactions.clearAll}
            </Button>
          </div>
          {chips.length > 0 ? (
            <div className="flex flex-wrap gap-2" data-testid="transaction-history-active-chips">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="rounded-full border border-border bg-background px-3 py-1 text-xs font-medium text-foreground transition hover:bg-accent"
                  onClick={() => onChange(chip.reset, { resetOffset: true })}
                >
                  {chip.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {state.returnTo ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" data-testid="transaction-history-report-note">
            {dict.transactions.reportSubtotalNote}
          </p>
        ) : null}

        {errorMessage ? (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {errorMessage}
          </div>
        ) : null}

        {isLoading && data.items.length === 0 ? (
          <div className="rounded-xl border border-border bg-muted/25 px-4 py-8 text-center text-sm text-muted-foreground">
            {dict.transactions.historyLoading}
          </div>
        ) : (
          <TransactionHistoryTable
            dict={dict}
            items={data.items}
            locale={locale}
            mode="full"
            onSort={onSort}
            sortBy={state.sortBy}
            sortOrder={state.sortOrder}
            tableTestId="transaction-history-table"
          />
        )}

        <div className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid gap-2" data-testid="transaction-history-subtotals">
            <p className="text-sm font-medium text-foreground">{dict.transactions.realizedSubtotalLabel}</p>
            {data.aggregates.realizedPnlByCurrency.length === 0 ? (
              <p className="text-sm text-muted-foreground">{dict.transactions.realizedSubtotalEmpty}</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {data.aggregates.realizedPnlByCurrency.map((item) => (
                  <span
                    key={item.currency}
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm font-medium",
                      holdingsFinanceSurfaceClass(item.amount, "border-border bg-background text-foreground"),
                    )}
                  >
                    {item.currency}: {formatCurrencyAmount(item.amount, item.currency, locale)}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto" data-testid="transaction-history-pagination">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasPrevPage}
              onClick={() => onChange({ offset: Math.max(0, state.offset - state.limit) })}
            >
              {dict.transactions.paginationPrevious}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!hasNextPage}
              onClick={() => onChange({ offset: state.offset + state.limit })}
            >
              {dict.transactions.paginationNext}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}

function buildActiveFilterChips(
  dict: AppDictionary,
  state: TransactionHistoryRouteState,
  accountOptions: TransactionAccountOptionDto[],
) {
  const chips: Array<{ key: string; label: string; reset: Partial<TransactionHistoryRouteState> }> = [];
  const isRealizedPnlDerivedSellType = state.pnl === "realized" && state.type === "SELL";

  if (state.type !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.type && !isRealizedPnlDerivedSellType) {
    chips.push({ key: "type", label: `${dict.transactions.typeTerm}: ${state.type}`, reset: { type: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.type } });
  }
  if (state.pnl !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.pnl) {
    chips.push({
      key: "pnl",
      label: `${dict.transactions.filterPnl}: ${state.pnl === "realized" ? dict.transactions.filterPnlRealized : dict.transactions.filterPnlAny}`,
      reset: { pnl: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.pnl },
    });
  }
  if (state.marketCode !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.marketCode) {
    chips.push({ key: "marketCode", label: `${dict.transactions.marketTerm}: ${getMarketFilterLabel(dict, state.marketCode)}`, reset: { marketCode: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.marketCode } });
  }
  if (state.accountId !== DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.accountId) {
    const accountLabel = accountOptions.find((account) => account.id === state.accountId)?.name ?? state.accountId;
    chips.push({ key: "accountId", label: `${dict.transactions.accountTerm}: ${accountLabel}`, reset: { accountId: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.accountId } });
  }
  if (state.ticker) {
    chips.push({ key: "ticker", label: `${dict.transactions.tickerTerm}: ${state.ticker}`, reset: { ticker: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.ticker } });
  }
  if (state.from) {
    chips.push({ key: "from", label: `${dict.transactions.filterTradeDateFrom}: ${state.from}`, reset: { from: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.from } });
  }
  if (state.to) {
    chips.push({ key: "to", label: `${dict.transactions.filterTradeDateTo}: ${state.to}`, reset: { to: DEFAULT_TRANSACTION_HISTORY_ROUTE_STATE.to } });
  }

  return chips;
}

function getMarketFilterLabel(dict: AppDictionary, marketCode: MarketCode | "ALL"): string {
  switch (marketCode) {
    case "TW":
      return dict.transactions.marketChipTW;
    case "US":
      return dict.transactions.marketChipUS;
    case "AU":
      return dict.transactions.marketChipAU;
    case "KR":
      return dict.transactions.marketChipKR;
    case "ALL":
      return dict.transactions.filterAllMarkets;
    case "JP":
      return dict.transactions.marketChipJP;
  }
}
