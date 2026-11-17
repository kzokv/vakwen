"use client";

import { useEffect, useMemo, useState } from "react";
import type {
  DashboardOverviewHoldingChildDto,
  DashboardOverviewHoldingGroupDto,
  LocaleCode,
  MarketCode,
  TransactionHistoryItemDto,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import type { DividendLedgerEntryDetails } from "../../features/dividends/types";
import { fetchDividendLedgerReview } from "../../features/dividends/services/dividendService";
import { buildHoldingActionTimelineItems, buildSplitPreview, getHoldingChildren, applySplitPreviewToLineItems } from "../../features/portfolio/holdingActionTimeline";
import { fetchTransactionHistory, submitCorporateAction } from "../../features/portfolio/services/portfolioService";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Input } from "../ui/shadcn/input";
import { Tabs, TabsList, TabsTrigger } from "../ui/shadcn/tabs";
import { CapitalReductionPanel } from "../../features/capital-reduction/CapitalReductionPanel";

interface HoldingActionDetailProps {
  dict: AppDictionary;
  locale: LocaleCode;
  marketCode: string;
  onActionPosted?: () => Promise<void> | void;
  row: DashboardOverviewHoldingGroupDto | DashboardOverviewHoldingChildDto;
  transactions?: TransactionHistoryItemDto[];
  allowAuthoring?: boolean;
  showCapitalReduction?: boolean;
}

type ActionMode = "SPLIT" | "REVERSE_SPLIT";
type PageSize = 10 | 25 | 50;

const PAGE_SIZE_OPTIONS: readonly PageSize[] = [10, 25, 50] as const;
const DIVIDEND_FETCH_LIMIT = 50;

async function fetchAllDividendEntries(ticker: string, marketCode: MarketCode): Promise<DividendLedgerEntryDetails[]> {
  const entries: DividendLedgerEntryDetails[] = [];
  for (let page = 1; ; page += 1) {
    const review = await fetchDividendLedgerReview({ tickers: [ticker], marketCode, page, limit: DIVIDEND_FETCH_LIMIT });
    entries.push(...review.ledgerEntries);
    if (entries.length >= review.total || review.ledgerEntries.length === 0) return entries;
  }
}

export function HoldingActionDetail({
  dict,
  locale,
  marketCode,
  onActionPosted,
  row,
  transactions,
  allowAuthoring = false,
  showCapitalReduction = true,
}: HoldingActionDetailProps) {
  const children = useMemo(() => getHoldingChildren(row), [row]);
  const [timelineTransactions, setTimelineTransactions] = useState<TransactionHistoryItemDto[]>(transactions ?? []);
  const [dividendEntries, setDividendEntries] = useState<DividendLedgerEntryDetails[]>([]);
  const [isLoading, setIsLoading] = useState(transactions === undefined);
  const [errorMessage, setErrorMessage] = useState("");
  const [actionMode, setActionMode] = useState<ActionMode>("SPLIT");
  const [selectedAccountId, setSelectedAccountId] = useState(children[0]?.accountId ?? "");
  const [actionDate, setActionDate] = useState("");
  const [actionTime, setActionTime] = useState("");
  const [numerator, setNumerator] = useState("2");
  const [denominator, setDenominator] = useState("1");
  const [cashInLieuAmount, setCashInLieuAmount] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitMessage, setSubmitMessage] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [timelinePage, setTimelinePage] = useState(1);
  const [timelineLimit, setTimelineLimit] = useState<PageSize>(10);
  const [upcomingPage, setUpcomingPage] = useState(1);
  const [upcomingLimit, setUpcomingLimit] = useState<PageSize>(10);
  const [postedPage, setPostedPage] = useState(1);
  const [postedLimit, setPostedLimit] = useState<PageSize>(10);

  useEffect(() => {
    if (transactions) {
      setTimelineTransactions(transactions);
    }
  }, [transactions]);

  useEffect(() => {
    let active = true;
    async function load() {
      setIsLoading(true);
      setErrorMessage("");
      try {
        const [nextTransactions, review] = await Promise.all([
          transactions
            ? Promise.resolve(transactions)
            : fetchTransactionHistory({
                ticker: row.ticker,
                accountIds: "children" in row ? row.children.map((child) => child.accountId) : [row.accountId],
                marketCode: marketCode as MarketCode,
              }),
          fetchAllDividendEntries(row.ticker, marketCode as MarketCode),
        ]);
        if (!active) return;
        setTimelineTransactions(nextTransactions);
        setDividendEntries(review.filter((entry) => entry.ticker === row.ticker && entry.marketCode === marketCode));
      } catch (error) {
        if (!active) return;
        setErrorMessage(error instanceof Error ? error.message : String(error));
      } finally {
        if (active) setIsLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [marketCode, row, transactions]);

  useEffect(() => {
    const defaultRatio = actionMode === "SPLIT" ? { numerator: "2", denominator: "1" } : { numerator: "1", denominator: "2" };
    setNumerator(defaultRatio.numerator);
    setDenominator(defaultRatio.denominator);
  }, [actionMode]);

  const selectedChild = children.find((child) => child.accountId === selectedAccountId) ?? children[0] ?? null;
  const scopedAccountIds = new Set(children.map((child) => child.accountId));
  const preview = buildSplitPreview({
    costBasis: selectedChild?.reportingCostBasisAmount ?? ("children" in row ? row.reportingCostBasisAmount : row.reportingCostBasisAmount),
    currentQuantity: selectedChild?.quantity ?? row.quantity,
    numerator: Math.max(0, Number(numerator) || 0),
    denominator: Math.max(0, Number(denominator) || 0),
    cashInLieuAmount: cashInLieuAmount ? Number(cashInLieuAmount) : null,
  });
  const previewRows = applySplitPreviewToLineItems(
    children.map((child) => ({
      accountId: child.accountId,
      accountLabel: child.accountName?.trim() || child.accountId,
      beforeQuantity: child.quantity,
      afterQuantity: child.quantity,
      fractionalQuantity: 0,
    })),
    Math.max(0, Number(numerator) || 0),
    Math.max(0, Number(denominator) || 0),
  );
  const timelineItems = buildHoldingActionTimelineItems({
    dividendEntries: dividendEntries.filter((entry) =>
      scopedAccountIds.has(entry.accountId) &&
      (entry.receivedStockQuantity > 0 || (entry.cashInLieuAmount ?? 0) > 0 || entry.deductions.some((deduction) => deduction.deductionType === "CASH_IN_LIEU_ADJUSTMENT"))),
    transactions: timelineTransactions,
  });
  const upcomingDividendEntries = useMemo(
    () => dividendEntries
      .filter((entry) => scopedAccountIds.has(entry.accountId) && entry.rowKind === "expected")
      .sort((left, right) => (left.paymentDate ?? left.exDividendDate).localeCompare(right.paymentDate ?? right.exDividendDate)),
    [dividendEntries, scopedAccountIds],
  );
  const postedDividendEntries = useMemo(
    () => dividendEntries
      .filter((entry) => scopedAccountIds.has(entry.accountId) && entry.rowKind !== "expected")
      .sort((left, right) => (right.paymentDate ?? right.exDividendDate).localeCompare(left.paymentDate ?? left.exDividendDate)),
    [dividendEntries, scopedAccountIds],
  );
  const pagedTimelineItems = paginateItems(timelineItems, timelinePage, timelineLimit);
  const pagedUpcomingDividends = paginateItems(upcomingDividendEntries, upcomingPage, upcomingLimit);
  const pagedPostedDividends = paginateItems(postedDividendEntries, postedPage, postedLimit);

  async function handleSubmitAction() {
    if (!selectedChild || !actionDate || preview.blocked || Number(numerator) <= 0 || Number(denominator) <= 0) return;
    setIsSubmitting(true);
    setSubmitError("");
    setSubmitMessage("");
    try {
      await submitCorporateAction({
        accountId: selectedChild.accountId,
        ticker: row.ticker,
        actionType: actionMode,
        numerator: Number(numerator),
        denominator: Number(denominator),
        actionDate,
        actionTimestamp: actionTime ? toOffsetDateTime(actionDate, actionTime) : undefined,
        cashInLieuAmount: cashInLieuAmount ? Number(cashInLieuAmount) : undefined,
        cashInLieuCurrency: cashInLieuAmount ? selectedChild.currency : undefined,
      });
      setSubmitMessage(dict.holdings.actionDetail.actionPosted);
      await onActionPosted?.();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mt-5 grid gap-4">
      {!allowAuthoring ? (
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label={dict.tickerHistory.quantityLabel} value={formatNumber(row.quantity, locale)} />
          <MetricCard label={dict.tickerHistory.avgCostLabel} value={row.averageCostPerShare ? formatCurrencyAmount(row.averageCostPerShare, row.currency, locale) : dict.tickerHistory.noHoldingData} />
          <MetricCard
            label={dict.tickerHistory.totalCostLabel}
            value={("children" in row ? row.reportingCostBasisAmount : row.reportingCostBasisAmount) != null
              ? formatCurrencyAmount(("children" in row ? row.reportingCostBasisAmount : row.reportingCostBasisAmount) ?? 0, ("children" in row ? row.reportingCurrency : row.reportingCurrency), locale)
              : dict.tickerHistory.noHoldingData}
          />
          <MetricCard
            label={dict.tickerHistory.marketValueLabel}
            value={("children" in row ? row.reportingMarketValueAmount : row.reportingMarketValueAmount) != null
              ? formatCurrencyAmount(("children" in row ? row.reportingMarketValueAmount : row.reportingMarketValueAmount) ?? 0, ("children" in row ? row.reportingCurrency : row.reportingCurrency), locale)
              : dict.tickerHistory.noHoldingData}
          />
        </div>
      ) : null}

      {showCapitalReduction && marketCode === "TW" ? <CapitalReductionPanel ticker={row.ticker} accounts={children.map(child => ({ id: child.accountId, name: child.accountName?.trim() || child.accountId, currency: child.currency }))} locale={locale} onChanged={() => { void onActionPosted?.(); }} /> : null}

      <Card className="rounded-lg border border-border/70 bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{dict.tickerHistory.actionTimelineEyebrow}</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">{dict.tickerHistory.actionTimelineTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{dict.tickerHistory.actionTimelineSubtitle}</p>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
            {dict.tickerHistory.actionTimelineReplayOrder}
          </span>
        </div>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">{dict.tickerHistory.refreshingDetails}</p>
        ) : errorMessage ? (
          <p className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{errorMessage}</p>
        ) : timelineItems.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/25 px-4 py-6 text-sm text-muted-foreground">{dict.tickerHistory.actionTimelineEmpty}</p>
        ) : (
          <>
            <div className="mt-4 divide-y divide-border rounded-lg border border-border/70">
              {pagedTimelineItems.items.map((item) => (
              <div key={item.id} className="grid gap-3 px-4 py-4 md:grid-cols-[148px_minmax(0,1fr)_auto] md:items-start">
                <div className="text-sm text-muted-foreground">
                  <p>{formatDateLabel(item.date, locale)}</p>
                  <p>{item.timeLabel ?? "--"}</p>
                </div>
                <div>
                  <p className="font-semibold text-foreground">{resolveTimelineTitle(dict, item.title)}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{resolveTimelineDescription(dict, locale, item, row.currency)}</p>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
                    {item.accountLabel ? <span>{item.accountLabel}</span> : null}
                    {item.linkedDividendId ? <span>{formatToken(dict.tickerHistory.actionTimelineLinkedDividend, item.linkedDividendId)}</span> : null}
                    {item.linkedActionId ? <span>{formatToken(dict.tickerHistory.actionTimelineLinkedAction, item.linkedActionId)}</span> : null}
                    {item.amendBlocked ? <span>{dict.tickerHistory.actionTimelineAmendBlocked}</span> : null}
                  </div>
                </div>
                <div className={cn(
                  "inline-flex h-fit rounded-full border px-3 py-1 text-xs font-medium",
                  item.badgeTone === "warning"
                    ? "border-amber-200 bg-amber-50 text-amber-700"
                    : item.badgeTone === "success"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-slate-200 bg-slate-50 text-slate-600",
                )}>
                  {resolveTimelineBadge(dict, item.badgeLabel)}
                </div>
              </div>
              ))}
            </div>
            <PaginationControls
              dict={dict}
              currentPage={timelinePage}
              pageSize={timelineLimit}
              total={timelineItems.length}
              onPageChange={setTimelinePage}
              onPageSizeChange={(next) => {
                setTimelineLimit(next);
                setTimelinePage(1);
              }}
            />
          </>
        )}
      </Card>

      {!allowAuthoring ? (
        <div className="grid gap-4 xl:grid-cols-2">
          <DividendListCard
            title={dict.dividends.ticker.upcoming.title}
            description={dict.dividends.ticker.upcoming.description}
            dict={dict}
            locale={locale}
            emptyLabel={dict.dividends.ticker.upcoming.empty}
            entries={pagedUpcomingDividends.items}
            total={upcomingDividendEntries.length}
            page={upcomingPage}
            pageSize={upcomingLimit}
            onPageChange={setUpcomingPage}
            onPageSizeChange={(next) => {
              setUpcomingLimit(next);
              setUpcomingPage(1);
            }}
          />
          <DividendListCard
            title={dict.dividends.ticker.postedHistory.title}
            description={dict.dividends.ticker.postedHistory.description}
            dict={dict}
            locale={locale}
            emptyLabel={dict.dividends.ticker.postedHistory.empty}
            entries={pagedPostedDividends.items}
            total={postedDividendEntries.length}
            page={postedPage}
            pageSize={postedLimit}
            onPageChange={setPostedPage}
            onPageSizeChange={(next) => {
              setPostedLimit(next);
              setPostedPage(1);
            }}
          />
        </div>
      ) : (
      <Card className="rounded-lg border border-border/70 bg-card p-4" data-testid="holding-split-action-panel">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{dict.holdings.actionDetail.splitEyebrow}</p>
            <h3 className="mt-1 text-lg font-semibold text-foreground">{dict.holdings.actionDetail.splitTitle}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{dict.holdings.actionDetail.splitSubtitle}</p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700">
            {dict.holdings.actionDetail.previewRequired}
          </span>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(280px,0.9fr)]">
          <div className="grid gap-3">
            <Tabs value={actionMode} onValueChange={(value) => setActionMode(value as ActionMode)}>
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="SPLIT">{dict.holdings.actionDetail.splitMode}</TabsTrigger>
                <TabsTrigger value="REVERSE_SPLIT">{dict.holdings.actionDetail.reverseSplitMode}</TabsTrigger>
              </TabsList>
            </Tabs>

            {children.length > 1 ? (
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{dict.holdings.actionDetail.accountLabel}</span>
                <select
                  className="h-10 rounded-md border border-input bg-background px-3"
                  value={selectedAccountId}
                  onChange={(event) => setSelectedAccountId(event.target.value)}
                  data-testid="holding-split-account-select"
                >
                  {children.map((child) => (
                    <option key={child.accountId} value={child.accountId}>
                      {child.accountName?.trim() || child.accountId}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{dict.holdings.actionDetail.effectiveDate}</span>
                <Input type="date" value={actionDate} onChange={(event) => setActionDate(event.target.value)} data-testid="holding-split-date" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{dict.holdings.actionDetail.effectiveTime}</span>
                <Input type="time" value={actionTime} onChange={(event) => setActionTime(event.target.value)} data-testid="holding-split-time" />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{dict.holdings.actionDetail.oldShares}</span>
                <Input inputMode="numeric" value={denominator} onChange={(event) => setDenominator(event.target.value)} data-testid="holding-split-old-shares" />
              </label>
              <label className="grid gap-1 text-sm">
                <span className="text-muted-foreground">{dict.holdings.actionDetail.newShares}</span>
                <Input inputMode="numeric" value={numerator} onChange={(event) => setNumerator(event.target.value)} data-testid="holding-split-new-shares" />
              </label>
            </div>

            <label className="grid gap-1 text-sm">
              <span className="text-muted-foreground">{dict.holdings.actionDetail.cashInLieuAmount}</span>
              <Input inputMode="decimal" value={cashInLieuAmount} onChange={(event) => setCashInLieuAmount(event.target.value)} data-testid="holding-split-cash-in-lieu" />
            </label>

            {preview.blocked ? (
              <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700" data-testid="holding-split-blocked-preview">
                <p className="font-semibold">{dict.holdings.actionDetail.postingBlockedTitle}</p>
                <p className="mt-1">{formatToken(dict.holdings.actionDetail.postingBlockedDescription, formatNumber(preview.fractionalQuantity, locale, 6))}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" data-testid="holding-split-impact-preview">
                <p className="font-semibold">{dict.holdings.actionDetail.previewImpactTitle}</p>
                <p className="mt-1">{dict.holdings.actionDetail.previewImpactBody}</p>
              </div>
            )}

            {submitError ? <p className="text-sm text-rose-700" data-testid="holding-split-submit-error">{submitError}</p> : null}
            {submitMessage ? <p className="text-sm text-emerald-700" data-testid="holding-split-submit-success">{submitMessage}</p> : null}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => {
                setActionDate("");
                setActionTime("");
                setCashInLieuAmount("");
              }}>
                {dict.actions.cancel}
              </Button>
              <Button
                type="button"
                disabled={!selectedChild || !actionDate || preview.blocked || Number(numerator) <= 0 || Number(denominator) <= 0 || isSubmitting}
                onClick={() => { void handleSubmitAction(); }}
                data-testid="holding-split-submit"
              >
                {isSubmitting ? dict.actions.savingSettings : dict.holdings.actionDetail.postAction}
              </Button>
            </div>
          </div>

          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <MetricCard label={dict.holdings.actionDetail.beforeQuantity} value={formatNumber(selectedChild?.quantity ?? row.quantity, locale)} />
              <MetricCard label={dict.holdings.actionDetail.afterQuantity} value={formatNumber(preview.afterQuantity, locale, 6)} />
              <MetricCard
                label={dict.holdings.actionDetail.costBasis}
                value={selectedChild?.reportingCostBasisAmount != null
                  ? formatCurrencyAmount(selectedChild.reportingCostBasisAmount, selectedChild.reportingCurrency, locale)
                  : dict.tickerHistory.noHoldingData}
              />
              <MetricCard
                label={dict.holdings.actionDetail.averageCost}
                value={preview.averageCost != null && selectedChild
                  ? formatCurrencyAmount(preview.averageCost, selectedChild.reportingCurrency, locale)
                  : dict.tickerHistory.noHoldingData}
              />
            </div>

            <div className="overflow-hidden rounded-lg border border-border/70">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{dict.holdings.actionDetail.lotSource}</th>
                    <th className="px-3 py-2 text-right font-medium">{dict.holdings.actionDetail.beforeQuantity}</th>
                    <th className="px-3 py-2 text-right font-medium">{dict.holdings.actionDetail.afterQuantity}</th>
                    <th className="px-3 py-2 text-right font-medium">{dict.holdings.actionDetail.fractionColumn}</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.map((previewRow) => (
                    <tr key={previewRow.accountId} className="border-t border-border/70">
                      <td className="px-3 py-2">{previewRow.accountLabel}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(previewRow.beforeQuantity, locale)}</td>
                      <td className="px-3 py-2 text-right">{formatNumber(previewRow.afterQuantity, locale, 6)}</td>
                      <td className="px-3 py-2 text-right">{previewRow.fractionalQuantity > 0 ? formatNumber(previewRow.fractionalQuantity, locale, 6) : "0"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {actionTime ? (
              <p className="text-xs text-muted-foreground">{dict.holdings.actionDetail.timestampPriorityHint}</p>
            ) : (
              <p className="text-xs text-muted-foreground">{dict.holdings.actionDetail.sameDayOrderingHint}</p>
            )}
          </div>
        </div>
      </Card>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border/70 px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}

function resolveTimelineTitle(dict: AppDictionary, key: string): string {
  if (key === "stock_dividend_posted") return dict.tickerHistory.actionTimelineStockDividendPosted;
  if (key === "cash_in_lieu_recorded") return dict.tickerHistory.actionTimelineCashInLieuRecorded;
  if (key === "buy_trade") return dict.tickerHistory.actionTimelineBuyTrade;
  return dict.tickerHistory.actionTimelineSellTrade;
}

function resolveTimelineBadge(dict: AppDictionary, key: string): string {
  if (key === "stock_dividend") return dict.tickerHistory.actionTimelineStockDividendBadge;
  if (key === "amend_blocked") return dict.tickerHistory.actionTimelineAmendBlockedBadge;
  if (key === "cash_in_lieu") return dict.tickerHistory.actionTimelineCashInLieuBadge;
  if (key === "open_lot") return dict.tickerHistory.actionTimelineOpenLotBadge;
  return dict.tickerHistory.actionTimelineTradeBadge;
}

function resolveTimelineDescription(
  dict: AppDictionary,
  locale: LocaleCode,
  item: ReturnType<typeof buildHoldingActionTimelineItems>[number],
  fallbackCurrency: string,
): string {
  if (item.description.startsWith("shares:")) {
    const parts = Object.fromEntries(item.description.split("|").map((part) => {
      const [key, value, extra] = part.split(":");
      return [key, extra ? `${value}:${extra}` : value];
    }));
    const [costAmount = "0", costCurrency = fallbackCurrency] = (parts.cost ?? "0").split(":");
    const [premiumAmount = "", premiumCurrency = fallbackCurrency] = (parts.premium ?? "").split(":");
    const summary = formatToken(dict.tickerHistory.actionTimelineStockDividendDescription, formatNumber(Number(parts.shares ?? "0"), locale));
    const cost = formatToken(dict.tickerHistory.actionTimelineCostDescription, formatCurrencyAmount(Number(costAmount), costCurrency, locale));
    const premium = premiumAmount
      ? formatToken(dict.tickerHistory.actionTimelinePremiumBaseDescription, formatCurrencyAmount(Number(premiumAmount), premiumCurrency, locale))
      : null;
    return [summary, cost, premium].filter(Boolean).join(" ");
  }
  if (item.description.startsWith("cash_in_lieu:")) {
    const [, amount = "0", currency = fallbackCurrency] = item.description.split(":");
    return formatToken(dict.tickerHistory.actionTimelineCashInLieuDescription, formatCurrencyAmount(Number(amount), currency, locale));
  }

  const [, quantity = "0", unitPrice = "0", currency = fallbackCurrency] = item.description.split(":");
  return formatToken(
    item.kind === "buy" ? dict.tickerHistory.actionTimelineBuyDescription : dict.tickerHistory.actionTimelineSellDescription,
    `${formatNumber(Number(quantity), locale)} · ${formatCurrencyAmount(Number(unitPrice), currency, locale)}`,
  );
}

function formatToken(template: string, value: string): string {
  return template.replace("{value}", value);
}

function toOffsetDateTime(date: string, time: string): string {
  const localDate = new Date(`${date}T${time}:00`);
  const offsetMinutes = -localDate.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  const hours = String(Math.floor(absoluteOffset / 60)).padStart(2, "0");
  const minutes = String(absoluteOffset % 60).padStart(2, "0");
  return `${date}T${time}:00${sign}${hours}:${minutes}`;
}

function paginateItems<T>(items: T[], page: number, limit: PageSize): { items: T[]; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / limit));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    totalPages,
  };
}

function PaginationControls({
  dict,
  currentPage,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
}: {
  dict: AppDictionary;
  currentPage: number;
  pageSize: PageSize;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
}) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <label className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{dict.dividends.review.pagination.pageSize}</span>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm text-foreground"
          value={String(pageSize)}
          onChange={(event) => onPageSizeChange(Number.parseInt(event.target.value, 10) as PageSize)}
        >
          {PAGE_SIZE_OPTIONS.map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      </label>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="secondary" disabled={currentPage <= 1} onClick={() => onPageChange(currentPage - 1)}>
          {dict.dividends.review.pagination.previous}
        </Button>
        <span className="text-sm text-muted-foreground">
          {dict.dividends.review.pagination.page} {currentPage} {dict.dividends.review.pagination.of} {totalPages}{dict.dividends.review.pagination.totalSuffix}
        </span>
        <Button type="button" size="sm" variant="secondary" disabled={currentPage >= totalPages} onClick={() => onPageChange(currentPage + 1)}>
          {dict.dividends.review.pagination.next}
        </Button>
      </div>
    </div>
  );
}

function DividendListCard({
  title,
  description,
  dict,
  locale,
  emptyLabel,
  entries,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
}: {
  title: string;
  description: string;
  dict: AppDictionary;
  locale: LocaleCode;
  emptyLabel: string;
  entries: DividendLedgerEntryDetails[];
  total: number;
  page: number;
  pageSize: PageSize;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: PageSize) => void;
}) {
  return (
    <Card className="rounded-lg border border-border/70 bg-card p-4">
      <div>
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {entries.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-border bg-muted/25 px-4 py-6 text-sm text-muted-foreground">{emptyLabel}</p>
      ) : (
        <div className="mt-4 divide-y divide-border rounded-lg border border-border/70">
          {entries.map((entry) => (
            <div key={entry.id} className="grid gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_repeat(3,minmax(0,0.8fr))]">
              <div className="min-w-0">
                <p className="font-semibold text-foreground">{entry.ticker}{entry.tickerName ? ` ${entry.tickerName}` : ""}</p>
                <p className="mt-1 text-sm text-muted-foreground">{entry.accountName?.trim() || entry.accountId}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{dict.dashboardHome.exDividendDateLabel}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatDateLabel(entry.exDividendDate, locale)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{dict.dashboardHome.paymentDateLabel}</p>
                <p className="mt-1 text-sm font-medium text-foreground">{entry.paymentDate ? formatDateLabel(entry.paymentDate, locale) : dict.dividends.paymentDateTbdSection}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">{dict.dashboardHome.netAmountLabel}</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {formatCurrencyAmount(entry.rowKind === "expected" ? entry.expectedCashAmount : entry.receivedCashAmount, entry.cashCurrency, locale)}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
      <PaginationControls
        dict={dict}
        currentPage={page}
        pageSize={pageSize}
        total={total}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </Card>
  );
}
