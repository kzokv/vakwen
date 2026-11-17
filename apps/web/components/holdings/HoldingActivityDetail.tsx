"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  DividendLedgerHistoryItemDto,
  DividendUpcomingListItemDto,
  HoldingActivityDividendsDto,
  HoldingActivityPositionActionDto,
  LocaleCode,
  MarketCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import {
  mergeHoldingActivityRouteStateIntoSearchParams,
  parseHoldingActivityRouteState,
  type HoldingActivityRouteState,
} from "../../features/portfolio/holdingActivityRouteState";
import {
  fetchHoldingActivityDividends,
  type HoldingActivityPageSize,
} from "../../features/portfolio/services/holdingActivityService";
import { Button } from "../ui/Button";
import { CapitalReductionPanel } from "../../features/capital-reduction/CapitalReductionPanel";
import { getCapitalReductionCopy } from "../../features/capital-reduction/i18n";
import { CapitalReductionValuation } from "../../features/capital-reduction/CapitalReductionValuation";

type HoldingRow = DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto;

const PAGE_SIZE_OPTIONS: readonly HoldingActivityPageSize[] = [10, 25, 50] as const;
const UPCOMING_FETCH_LIMIT: HoldingActivityPageSize = 50;

export function HoldingActivityDetail({
  dict,
  locale,
  row,
}: {
  dict: AppDictionary;
  locale: LocaleCode;
  row: HoldingRow;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const searchParamKey = searchParams?.toString() ?? "";
  const scope = useMemo(
    () => ({
      ticker: row.ticker,
      marketCode: row.marketCode,
      accountId: "accountId" in row ? row.accountId : undefined,
      accountIds: "children" in row ? row.children.map((child) => child.accountId) : undefined,
    }),
    [row],
  );
  const routeState = useMemo(
    () => parseHoldingActivityRouteState(new URLSearchParams(searchParamKey), scope),
    [scope, searchParamKey],
  );
  const capitalReductionAccounts = useMemo(() => ("children" in row ? row.children : [row]).map(child => ({ id: child.accountId, name: child.accountName?.trim() || child.accountId, currency: child.currency })), [row]);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [data, setData] = useState<HoldingActivityDividendsDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const current = new URLSearchParams(searchParamKey);
    const next = mergeHoldingActivityRouteStateIntoSearchParams(current, routeState);
    if (next.toString() === current.toString()) return;
    router.replace(next.size > 0 ? `${pathname}?${next.toString()}` : pathname, { scroll: false });
  }, [pathname, routeState, router, searchParamKey]);

  useEffect(() => {
    const controller = new AbortController();
    setIsLoading(true);
    setErrorMessage("");
    void fetchHoldingActivityDividends({
      ticker: scope.ticker,
      marketCode: scope.marketCode as MarketCode,
      accountId: scope.accountId,
      accountIds: scope.accountIds,
      positionActionsPage: routeState.positionActionsPage,
      positionActionsLimit: routeState.positionActionsLimit,
      upcomingPage: 1,
      upcomingLimit: UPCOMING_FETCH_LIMIT,
      postedPage: routeState.postedPage,
      postedLimit: routeState.postedLimit,
      signal: controller.signal,
    })
      .then((response) => {
        setData(response);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string } | null)?.name === "AbortError") return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false);
      });
    return () => controller.abort();
  }, [routeState.positionActionsLimit, routeState.positionActionsPage, routeState.postedLimit, routeState.postedPage, scope, refreshVersion]);

  function updateRouteState(patch: Partial<HoldingActivityRouteState>) {
    const nextState: HoldingActivityRouteState = { ...routeState, ...patch };
    const current = new URLSearchParams(searchParamKey);
    const next = mergeHoldingActivityRouteStateIntoSearchParams(current, nextState);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  const contextChips = buildContextChips(dict, locale, row);

  return (
    <div className="mt-4 space-y-4" data-testid="holding-activity-detail">
      <section className="rounded-lg border border-border/70 bg-background p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          {dict.tickerHistory.actionTimelineEyebrow}
        </p>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-foreground">{dict.tickerHistory.actionTimelineTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{dict.tickerHistory.actionTimelineSubtitle}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {contextChips.map((chip) => (
              <span key={chip} className="rounded-md border border-border bg-muted/30 px-2.5 py-1 text-xs text-muted-foreground">
                {chip}
              </span>
            ))}
          </div>
        </div>
      </section>

      {row.capitalReductionValuation ? <CapitalReductionValuation valuation={row.capitalReductionValuation} locale={locale} copy={getCapitalReductionCopy(locale)} /> : null}
      {row.marketCode === "TW" ? <CapitalReductionPanel ticker={row.ticker} accounts={capitalReductionAccounts} locale={locale} onChanged={() => setRefreshVersion(value => value + 1)} /> : null}

      {isLoading ? (
        <section className="rounded-lg border border-border/70 bg-background px-4 py-6 text-sm text-muted-foreground">
          {dict.tickerHistory.refreshingDetails}
        </section>
      ) : errorMessage ? (
        <section className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </section>
      ) : data ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
          <section className="rounded-lg border border-border/70 bg-background p-4">
            <SectionHeader
              title={dict.tickerHistory.actionTimelineEyebrow}
              description={dict.tickerHistory.actionTimelineReplayOrder}
            />
            <PositionActionList dict={dict} items={data.positionActions.items} locale={locale} />
            <PaginationControls
              testIdPrefix="holding-position-actions"
              dict={dict}
              currentPage={data.positionActions.page}
              pageSize={routeState.positionActionsLimit}
              total={data.positionActions.total}
              onPageChange={(page) => updateRouteState({ positionActionsPage: page })}
              onPageSizeChange={(limit) => updateRouteState({ positionActionsLimit: limit, positionActionsPage: 1 })}
            />
          </section>

          <div className="grid gap-4">
            <section className="rounded-lg border border-border/70 bg-background p-4">
              <SectionHeader
                title={dict.dividends.ticker.upcoming.title}
                description={dict.dividends.ticker.upcoming.description}
              />
              <UpcomingDividendList dict={dict} items={data.upcomingDividends.items} locale={locale} />
            </section>

            <section className="rounded-lg border border-border/70 bg-background p-4">
              <SectionHeader
                title={dict.dividends.ticker.postedHistory.title}
                description={dict.dividends.ticker.postedHistory.description}
              />
              <PostedDividendList dict={dict} items={data.postedDividends.items} locale={locale} />
              <PaginationControls
                testIdPrefix="holding-posted-dividends"
                dict={dict}
                currentPage={data.postedDividends.page}
                pageSize={routeState.postedLimit}
                total={data.postedDividends.total}
                onPageChange={(page) => updateRouteState({ postedPage: page })}
                onPageSizeChange={(limit) => updateRouteState({ postedLimit: limit, postedPage: 1 })}
              />
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildContextChips(dict: AppDictionary, locale: LocaleCode, row: HoldingRow): string[] {
  const chips = [
    `${row.ticker} · ${row.marketCode}`,
    `${dict.holdings.quantityTerm}: ${formatNumber(row.quantity, locale)}`,
  ];
  if ("accountId" in row) {
    chips.push(row.accountName?.trim() || row.accountId);
  } else {
    chips.push(`${formatNumber(row.children.length, locale)} ${dict.holdings.parentAccountCountLabel.toLowerCase()}`);
  }
  return chips;
}

function SectionHeader({ title, description }: { title: string; description: string }) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function PositionActionList({
  dict,
  items,
  locale,
}: {
  dict: AppDictionary;
  items: HoldingActivityPositionActionDto[];
  locale: LocaleCode;
}) {
  if (items.length === 0) {
    return <EmptyState label={dict.tickerHistory.actionTimelineEmpty} />;
  }

  return (
    <div className="mt-4 divide-y divide-border rounded-lg border border-border/70">
      {items.map((item) => (
        <div key={item.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[124px_minmax(0,1fr)]" data-testid="holding-position-action-item">
          <div className="text-sm text-muted-foreground">
            <p>{formatDateLabel(item.actionDate, locale)}</p>
            <p>{item.actionTimestamp ? new Date(item.actionTimestamp).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" }) : "--"}</p>
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-semibold text-foreground">{resolvePositionActionTitle(dict, item.actionType, locale)}</p>
              {item.ratioNumerator && item.ratioDenominator ? (
                <span className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs text-muted-foreground">
                  {item.ratioNumerator}:{item.ratioDenominator}
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{item.accountName}</p>
            <div className="mt-2 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <span>{dict.holdings.quantityTerm}: {formatNumber(item.quantity, locale, 6)}</span>
              {item.cashInLieuAmount && item.cashInLieuCurrency ? (
                <span>{dict.tickerHistory.actionTimelineCashInLieuBadge}: {formatCurrencyAmount(item.cashInLieuAmount, item.cashInLieuCurrency, locale)}</span>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function UpcomingDividendList({
  dict,
  items,
  locale,
}: {
  dict: AppDictionary;
  items: DividendUpcomingListItemDto[];
  locale: LocaleCode;
}) {
  if (items.length === 0) {
    return <EmptyState label={dict.dividends.ticker.upcoming.empty} />;
  }

  return (
    <div className="mt-4 divide-y divide-border rounded-lg border border-border/70">
      {items.map((item) => (
        <div key={item.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_repeat(2,minmax(0,0.8fr))]">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.accountName}</p>
          </div>
          <DateMetric label={dict.dashboardHome.exDividendDateLabel} value={formatDateLabel(item.exDividendDate, locale)} />
          <DateMetric
            label={dict.dashboardHome.paymentDateLabel}
            value={item.paymentDate ? formatDateLabel(item.paymentDate, locale) : dict.dividends.paymentDateTbdSection}
          />
        </div>
      ))}
    </div>
  );
}

function PostedDividendList({
  dict,
  items,
  locale,
}: {
  dict: AppDictionary;
  items: DividendLedgerHistoryItemDto[];
  locale: LocaleCode;
}) {
  if (items.length === 0) {
    return <EmptyState label={dict.dividends.ticker.postedHistory.empty} />;
  }

  return (
    <div className="mt-4 divide-y divide-border rounded-lg border border-border/70">
      {items.map((item) => (
        <div key={item.dividendLedgerEntryId} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,0.8fr))]" data-testid="holding-posted-dividend-item">
          <div className="min-w-0">
            <p className="font-semibold text-foreground">{item.ticker}{item.tickerName ? ` ${item.tickerName}` : ""}</p>
            <p className="mt-1 text-sm text-muted-foreground">{item.accountName}</p>
          </div>
          <DateMetric label={dict.dashboardHome.exDividendDateLabel} value={formatDateLabel(item.exDividendDate, locale)} />
          <DateMetric
            label={dict.dashboardHome.paymentDateLabel}
            value={item.paymentDate ? formatDateLabel(item.paymentDate, locale) : dict.dividends.paymentDateTbdSection}
          />
          <DateMetric
            label={dict.dashboardHome.netAmountLabel}
            value={formatCurrencyAmount(item.actualNetAmount, item.cashDividendCurrency, locale)}
            valueClassName={cn("text-sm font-medium text-foreground")}
          />
        </div>
      ))}
    </div>
  );
}

function DateMetric({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-sm font-medium text-foreground", valueClassName)}>{value}</p>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/20 px-4 py-6 text-sm text-muted-foreground">
      {label}
    </p>
  );
}

function resolvePositionActionTitle(
  dict: AppDictionary,
  actionType: HoldingActivityPositionActionDto["actionType"],
  locale: LocaleCode,
): string {
  if (actionType === "CASH_CAPITAL_REDUCTION") return getCapitalReductionCopy(locale).title;
  if (actionType === "STOCK_DIVIDEND") return dict.tickerHistory.actionTimelineStockDividendPosted;
  if (actionType === "SPLIT") return dict.holdings.actionDetail.splitMode;
  return dict.holdings.actionDetail.reverseSplitMode;
}

function PaginationControls({
  testIdPrefix,
  dict,
  currentPage,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  testIdPrefix: string;
  dict: AppDictionary;
  currentPage: number;
  pageSize: HoldingActivityPageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: HoldingActivityPageSize) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{dict.dividends.review.pagination.pageSize}</span>
        <select
          data-testid={`${testIdPrefix}-page-size`}
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number.parseInt(event.target.value, 10) as HoldingActivityPageSize)}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)} data-testid={`${testIdPrefix}-previous`}>
          {dict.dividends.review.pagination.previous}
        </Button>
        <span className="text-sm text-muted-foreground">
          {dict.dividends.review.pagination.page} {currentPage} {dict.dividends.review.pagination.of} {totalPages}{dict.dividends.review.pagination.totalSuffix}
        </span>
        <Button type="button" size="sm" variant="secondary" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)} data-testid={`${testIdPrefix}-next`}>
          {dict.dividends.review.pagination.next}
        </Button>
      </div>
    </div>
  );
}
