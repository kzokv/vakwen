"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, Pencil, Plus, RotateCcw } from "lucide-react";
import type { LocaleCode } from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { formatCurrencyAmount, formatDateLabel } from "../../../lib/utils";
import { useEventStream } from "../../../hooks/useEventStream";
import {
  fetchAccounts,
  fetchCashLedgerEntries,
  type AccountWithLiveBalance,
} from "../services/cashLedgerService";
import { reverseFxTransfer } from "../../fx-transfer/services/fxTransferService";
import {
  formatAccountOption,
  type AccountOptionInput,
} from "../utils/accountOptions";
import type {
  CashLedgerEntryType,
  CashLedgerListResponse,
  CashLedgerSortColumn,
  CashLedgerSummary,
  EnrichedCashLedgerEntry,
} from "../types";
import { CashLedgerDrawer } from "./CashLedgerDrawer";
import { Card } from "../../../components/ui/Card";
import { Button } from "../../../components/ui/Button";
import {
  RecordFxTransferDialog,
} from "../../../components/fx-transfer/RecordFxTransferDialog";
import type { FxTransferFormValue } from "../../../components/fx-transfer/AddFxTransferCard";
import { ConfirmDialog } from "../../../components/admin/ConfirmDialog";
import { useOptionalAppShellData } from "../../../components/layout/AppShellDataContext";
import { ZeroAccountSetupGate } from "../../portfolio-capabilities/components/ZeroAccountSetupGate";
import { buildAccountsSetupHref } from "../../portfolio-capabilities/portfolioCapabilities";

interface CashLedgerClientProps {
  initialData: CashLedgerListResponse | null;
  initialDataReady?: boolean;
  initialAccounts?: AccountWithLiveBalance[];
  initialAccountMetaReady?: boolean;
  dict: AppDictionary;
  locale: LocaleCode;
}

const PAGE_SIZE = 50;

function SortHeader({
  label,
  field,
  sortBy,
  sortOrder,
  onSort,
  sticky = false,
}: {
  label: string;
  field: CashLedgerSortColumn;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (field: CashLedgerSortColumn) => void;
  /** Phase 4 \u2014 opt-in sticky-first-column styling for the leading date header. */
  sticky?: boolean;
}) {
  const isActive = sortBy === field;
  return (
    <th
      className={`cursor-pointer px-3 py-3 hover:text-foreground ${sticky ? "sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0" : ""}`}
      onClick={() => onSort(field)}
    >
      <span className={isActive ? "text-foreground font-semibold" : ""}>
        {label}
        {isActive ? (sortOrder === "asc" ? " \u2191" : " \u2193") : ""}
      </span>
    </th>
  );
}

const ENTRY_TYPE_OPTIONS: CashLedgerEntryType[] = [
  "TRADE_SETTLEMENT_IN",
  "TRADE_SETTLEMENT_OUT",
  "DIVIDEND_RECEIPT",
  "DIVIDEND_DEDUCTION",
  "MANUAL_ADJUSTMENT",
  "REVERSAL",
];

const FX_TRANSFER_ENTRY_TYPES: CashLedgerEntryType[] = ["FX_TRANSFER_OUT", "FX_TRANSFER_IN"];
type EntryTypeFilterOption = CashLedgerEntryType | "FX_TRANSFER";
const ENTRY_TYPE_FILTER_OPTIONS: EntryTypeFilterOption[] = [...ENTRY_TYPE_OPTIONS, "FX_TRANSFER"];

function entryTypeLabel(entryType: CashLedgerEntryType, dict: AppDictionary): string {
  switch (entryType) {
    case "TRADE_SETTLEMENT_IN": return dict.cashLedger.entryTypeTradeSettlementIn;
    case "TRADE_SETTLEMENT_OUT": return dict.cashLedger.entryTypeTradeSettlementOut;
    case "DIVIDEND_RECEIPT": return dict.cashLedger.entryTypeDividendReceipt;
    case "DIVIDEND_DEDUCTION": return dict.cashLedger.entryTypeDividendDeduction;
    case "MANUAL_ADJUSTMENT": return dict.cashLedger.entryTypeManualAdjustment;
    case "FX_TRANSFER_OUT": return dict.cashLedger.entryTypeFxTransferOut;
    case "FX_TRANSFER_IN": return dict.cashLedger.entryTypeFxTransferIn;
    case "REVERSAL": return dict.cashLedger.entryTypeReversal;
  }
}

function isFxTransferEntry(entry: EnrichedCashLedgerEntry): boolean {
  return entry.entryType === "FX_TRANSFER_OUT" || entry.entryType === "FX_TRANSFER_IN";
}

// KZO-167: the account chip / dropdown label uses `formatAccountOption`
// from `../utils/accountOptions.ts` (extracted so the pure helper can be
// unit-tested at `apps/web/test/features/cash-ledger/accountOptions.test.ts`
// per scope-todo Phase 7). The helper lives outside the i18n dictionary
// per `.claude/rules/nextjs-i18n-serialization.md` — function values
// cannot cross the Next.js server→client boundary inside dictionaries.

function buildAccountMeta(accounts: AccountWithLiveBalance[]): Map<string, AccountOptionInput> {
  const next = new Map<string, AccountOptionInput>();
  for (const account of accounts) {
    next.set(account.id, {
      name: account.name,
      defaultCurrency: account.defaultCurrency,
      accountType: account.accountType,
    });
  }
  return next;
}

export function CashLedgerClient({
  initialData,
  initialDataReady = true,
  initialAccounts = [],
  initialAccountMetaReady = false,
  dict,
  locale,
}: CashLedgerClientProps) {
  const shellData = useOptionalAppShellData();
  const [entries, setEntries] = useState<EnrichedCashLedgerEntry[]>(initialData?.entries ?? []);
  const [summary, setSummary] = useState<CashLedgerSummary[]>(initialData?.summary ?? []);
  const [total, setTotal] = useState(initialData?.total ?? 0);
  const [isLedgerLoading, setIsLedgerLoading] = useState(!initialDataReady);
  const [drawerEntry, setDrawerEntry] = useState<EnrichedCashLedgerEntry | null>(null);
  const [accounts, setAccounts] = useState<AccountWithLiveBalance[]>(initialAccounts);
  const [fxDialogOpen, setFxDialogOpen] = useState(false);
  const [fxDialogMode, setFxDialogMode] = useState<"create" | "edit">("create");
  const [fxDialogInitialValue, setFxDialogInitialValue] = useState<FxTransferFormValue | undefined>(undefined);
  const [editingFxTransferId, setEditingFxTransferId] = useState<string | undefined>(undefined);
  const [reverseEntry, setReverseEntry] = useState<EnrichedCashLedgerEntry | null>(null);
  const [reversePending, setReversePending] = useState(false);
  const [reverseError, setReverseError] = useState("");
  const [accountMetaReady, setAccountMetaReady] = useState(initialAccountMetaReady);
  const initialDataFetchStartedRef = useRef(initialDataReady);

  // KZO-167: account chip metadata — name, defaultCurrency, accountType.
  // Empty until the GET /accounts fetch resolves; renders fall back to the
  // raw account ID until populated.
  const [accountMeta, setAccountMeta] = useState<Map<string, AccountOptionInput>>(
    () => buildAccountMeta(initialAccounts),
  );

  // Filters
  const [fromEntryDate, setFromEntryDate] = useState("");
  const [toEntryDate, setToEntryDate] = useState("");
  const [accountId, setAccountId] = useState("");
  const [entryTypeFilter, setEntryTypeFilter] = useState<CashLedgerEntryType[]>([]);

  // Pagination & sorting
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState<CashLedgerSortColumn>("entryDate");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");
  const d = dict.cashLedger;

  const loadAccounts = useCallback(async () => {
    // TODO(performance-smooth-pages): switch to a cash-ledger-scoped account
    // metadata read endpoint once the backend exposes one. We currently reuse
    // `/accounts?includeBalances=true` to preserve labels without blocking on
    // `/dashboard/overview`.
    const nextAccounts = await fetchAccounts({ includeBalances: true });
    setAccounts(nextAccounts);
    setAccountMeta(buildAccountMeta(nextAccounts));
    setAccountMetaReady(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadAccounts()
      .catch(() => {
        if (cancelled) return;
        // Fall back to raw IDs only after the account metadata request fails.
        setAccountMetaReady(true);
      });
    return () => { cancelled = true; };
  }, [loadAccounts]);

  const renderAccountLabel = useCallback(
    (id: string): string => {
      const meta = accountMeta.get(id);
      if (!meta) return accountMetaReady ? id : dict.cashLedger.accountLabelLoading;
      return formatAccountOption(meta, {
        accountTypeBroker: dict.cashLedger.accountTypeBroker,
        accountTypeBank: dict.cashLedger.accountTypeBank,
        accountTypeWallet: dict.cashLedger.accountTypeWallet,
      });
    },
    [accountMeta, accountMetaReady, dict],
  );

  const fetchData = useCallback(async (opts: {
    pg?: number;
    sort?: CashLedgerSortColumn;
    order?: "asc" | "desc";
    // Explicit overrides for filter values that may not yet be reflected in
    // the closure (account select onChange, entry-type chip clicks).
    account?: string;
    entryTypes?: CashLedgerEntryType[];
  } = {}) => {
    const pg = opts.pg ?? page;
    const sort = opts.sort ?? sortBy;
    const order = opts.order ?? sortOrder;
    const resolvedAccount = "account" in opts ? (opts.account ?? "") : accountId;
    const resolvedEntryTypes = "entryTypes" in opts ? (opts.entryTypes ?? []) : entryTypeFilter;
    setIsLedgerLoading(true);
    try {
      const data = await fetchCashLedgerEntries({
        fromEntryDate: fromEntryDate || undefined,
        toEntryDate: toEntryDate || undefined,
        accountId: resolvedAccount || undefined,
        entryType: resolvedEntryTypes.length > 0 ? resolvedEntryTypes : undefined,
        page: pg,
        sortBy: sort,
        sortOrder: order,
        limit: PAGE_SIZE,
      });
      const newTotal = data.total ?? 0;
      const newTotalPages = Math.max(1, Math.ceil(newTotal / PAGE_SIZE));
      if (pg > newTotalPages) {
        // Result set shrank under the current page (e.g. SSE refresh removed entries).
        // Clamp to page 1 and re-fetch so the user sees the remaining rows.
        setPage(1);
        void fetchData({ pg: 1, sort, order, account: resolvedAccount, entryTypes: resolvedEntryTypes });
        return;
      }
      // Commit page/sort state only on a successful fetch so that a failed
      // request leaves the controls consistent with the visible data.
      setPage(pg);
      setSortBy(sort);
      setSortOrder(order);
      setEntries(data.entries);
      setSummary(data.summary);
      setTotal(newTotal);
    } catch {
      // Keep current data and UI state on error
    } finally {
      setIsLedgerLoading(false);
    }
  }, [fromEntryDate, toEntryDate, accountId, entryTypeFilter, page, sortBy, sortOrder]);

  useEffect(() => {
    if (initialDataFetchStartedRef.current) return;
    initialDataFetchStartedRef.current = true;
    void fetchData({ pg: 1 });
  }, [fetchData]);

  // SSE: pre-connect pattern (always enabled). Refresh account metadata for
  // account lifecycle mutations so FX controls never use a stale account list.
  useEventStream({
    enabled: true,
    eventTypes: [
      "recompute_complete",
      "dividend_posted",
      "dividend_updated",
      "currency_wallet_recomputed",
      "account_created",
      "account_updated",
      "account_soft_deleted",
      "account_restored",
      "account_hard_purged",
    ],
    onEvent: () => {
      void fetchData();
      void loadAccounts();
    },
  });

  // Prefer the account endpoint so accounts without current ledger rows remain selectable.
  const accountOptions = accounts.length > 0
    ? accounts.map((account) => account.id)
    : Array.from(new Set(summary.map((s) => s.accountId)));

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const handleSort = useCallback((col: CashLedgerSortColumn) => {
    const nextOrder = col === sortBy
      ? (sortOrder === "asc" ? "desc" : "asc")
      : "desc";
    // State is committed inside fetchData on success, keeping controls
    // consistent with the visible data even when the request fails.
    void fetchData({ pg: 1, sort: col, order: nextOrder });
  }, [sortBy, sortOrder, fetchData]);

  const handlePageChange = useCallback((newPage: number) => {
    void fetchData({ pg: newPage });
  }, [fetchData]);

  // Date inputs: onBlur fires after onChange has already re-rendered the component,
  // so the fetchData closure will already have the latest fromEntryDate/toEntryDate.
  const handleDateBlur = useCallback(() => {
    void fetchData({ pg: 1 });
  }, [fetchData]);

  // Account select: must pass the new value explicitly — the closure is stale
  // until the next render, which happens after this event handler returns.
  const handleAccountChange = useCallback((newAccountId: string) => {
    setAccountId(newAccountId);
    void fetchData({ pg: 1, account: newAccountId });
  }, [fetchData]);

  // Entry-type chips: same stale-closure issue — compute the toggled array and
  // pass it explicitly so the fetch sees the new value immediately.
  const handleEntryTypeToggle = useCallback((type: EntryTypeFilterOption) => {
    const toggledTypes = type === "FX_TRANSFER" ? FX_TRANSFER_ENTRY_TYPES : [type];
    const allSelected = toggledTypes.every((item) => entryTypeFilter.includes(item));
    const newFilter = allSelected
      ? entryTypeFilter.filter((item) => !toggledTypes.includes(item))
      : Array.from(new Set([...entryTypeFilter, ...toggledTypes]));
    setEntryTypeFilter(newFilter);
    void fetchData({ pg: 1, entryTypes: newFilter });
  }, [entryTypeFilter, fetchData]);

  const refreshAfterFxMutation = useCallback(() => {
    void fetchData({ pg: 1 });
    void loadAccounts();
  }, [fetchData, loadAccounts]);

  const openCreateFxDialog = useCallback(() => {
    setFxDialogMode("create");
    setFxDialogInitialValue(undefined);
    setEditingFxTransferId(undefined);
    setFxDialogOpen(true);
  }, []);

  const openEditFxDialog = useCallback((entry: EnrichedCashLedgerEntry) => {
    if (!entry.fxTransferId || !entry.fxTransferDetail || !isFxTransferEntry(entry)) return;
    const detail = entry.fxTransferDetail;
    const sourceAccountId = entry.entryType === "FX_TRANSFER_OUT" ? entry.accountId : detail.pairedAccountId;
    const destinationAccountId = entry.entryType === "FX_TRANSFER_OUT" ? detail.pairedAccountId : entry.accountId;
    const sourceAmount = entry.entryType === "FX_TRANSFER_OUT" ? Math.abs(entry.amount) : detail.pairedAmount;
    const destinationAmount = entry.entryType === "FX_TRANSFER_OUT" ? detail.pairedAmount : Math.abs(entry.amount);
    setFxDialogMode("edit");
    setEditingFxTransferId(entry.fxTransferId);
    setFxDialogInitialValue({
      fromAccountId: sourceAccountId,
      toAccountId: destinationAccountId,
      fromAmount: String(sourceAmount),
      toAmount: String(destinationAmount),
      effectiveRate: String(detail.effectiveRate),
      entryDate: entry.entryDate,
      notes: entry.note ?? "",
    });
    setFxDialogOpen(true);
  }, []);

  const confirmReverseFxTransfer = useCallback(async () => {
    if (!reverseEntry?.fxTransferId) return;
    setReversePending(true);
    setReverseError("");
    try {
      await reverseFxTransfer(reverseEntry.fxTransferId);
      setReverseEntry(null);
      refreshAfterFxMutation();
    } catch (error) {
      setReverseError(error instanceof Error ? error.message : d.fxGenericError);
    } finally {
      setReversePending(false);
    }
  }, [d.fxGenericError, refreshAfterFxMutation, reverseEntry]);

  function renderFxPairedLine(entry: EnrichedCashLedgerEntry): string | null {
    const detail = entry.fxTransferDetail;
    if (!detail || !isFxTransferEntry(entry)) return null;
    const destinationCurrency = entry.entryType === "FX_TRANSFER_OUT" ? detail.pairedCurrency : entry.currency;
    const sourceCurrency = entry.entryType === "FX_TRANSFER_OUT" ? entry.currency : detail.pairedCurrency;
    const rateText = `${detail.effectiveRate.toFixed(6)} ${destinationCurrency}/${sourceCurrency}`;
    return d.fxPairedLine
      .replace("{account}", detail.pairedAccountName)
      .replace("{amount}", formatCurrencyAmount(detail.pairedAmount, detail.pairedCurrency, locale))
      .replace("{rate}", rateText);
  }

  function renderTypeCell(entry: EnrichedCashLedgerEntry) {
    if (entry.entryType === "FX_TRANSFER_OUT" || entry.entryType === "FX_TRANSFER_IN") {
      const isOut = entry.entryType === "FX_TRANSFER_OUT";
      const pairedLine = renderFxPairedLine(entry);
      return (
        <div className="min-w-0">
          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${
            isOut ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}>
            {isOut ? d.fxBadgeOut : d.fxBadgeIn}
          </span>
          {entry.fxTransferReversed ? (
            <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {d.fxAlreadyReversed}
            </span>
          ) : null}
          {pairedLine ? <p className="mt-1 text-xs text-slate-500">{pairedLine}</p> : null}
        </div>
      );
    }
    if (entry.entryType === "REVERSAL" && entry.fxTransferId) {
      return (
        <div>
          <span>{entryTypeLabel(entry.entryType, dict)}</span>
          <span className="ml-2 inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
            {d.fxReversalIndicator}
          </span>
        </div>
      );
    }
    return entryTypeLabel(entry.entryType, dict);
  }

  function renderFxActionMenu(entry: EnrichedCashLedgerEntry) {
    if (!isFxTransferEntry(entry) || !entry.fxTransferId) return null;
    const disabled = entry.fxTransferReversed === true;
    return (
      <div onClick={(event) => event.stopPropagation()} className="flex justify-end">
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <button
              type="button"
              className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
              aria-label={d.fxActionEdit}
              data-testid={`fx-actions-${entry.id}`}
            >
              <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
            </button>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              align="end"
              className="z-[80] min-w-44 rounded-xl border border-slate-200 bg-white p-1 text-sm shadow-xl"
            >
              <DropdownMenu.Item
                disabled={disabled}
                onSelect={() => openEditFxDialog(entry)}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-slate-700 outline-none hover:bg-slate-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                data-testid={`fx-edit-${entry.id}`}
              >
                <Pencil className="h-4 w-4" aria-hidden="true" />
                {d.fxActionEdit}
              </DropdownMenu.Item>
              <DropdownMenu.Item
                disabled={disabled}
                onSelect={() => {
                  setReverseError("");
                  setReverseEntry(entry);
                }}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-rose-700 outline-none hover:bg-rose-50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50"
                data-testid={`fx-reverse-${entry.id}`}
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                {d.fxActionReverse}
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    );
  }

  const configuredCurrencyCount =
    shellData?.portfolioCapabilities?.configuredCurrencies.length ?? null;
  if (shellData && !shellData.isPortfolioConfigLoading && configuredCurrencyCount === 0) {
    return (
      <ZeroAccountSetupGate
        dict={dict}
        canManageAccounts={
          !shellData.isSharedContext
          || shellData.sharedContextPermissions.canManageAccounts
        }
        returnTo="/cash-ledger"
      />
    );
  }
  const capabilitiesUnknown = configuredCurrencyCount === null;
  const canCreateFxTransfer = configuredCurrencyCount !== null && configuredCurrencyCount >= 2;

  return (
    <div className="grid gap-4" data-testid="cash-ledger-page">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-950 sm:text-3xl">{d.pageTitle}</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">{d.pageDescription}</p>
        </div>
        {capabilitiesUnknown ? (
          shellData?.portfolioConfigError ? (
            <div
              className="max-w-md rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3"
              data-testid="fx-transfer-capabilities-error"
              role="alert"
            >
              <p className="text-sm font-semibold text-rose-900">{d.fxCapabilitiesError}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-3"
                data-testid="fx-transfer-capabilities-retry"
                onClick={() => void shellData.refreshPortfolioConfig()}
              >
                {d.fxCapabilitiesRetry}
              </Button>
            </div>
          ) : (
            <div
              className="h-10 w-52 animate-pulse rounded-xl bg-muted/50"
              data-testid="fx-transfer-capabilities-loading"
              role="status"
              aria-label={d.fxCapabilitiesLoading}
              aria-busy="true"
            />
          )
        ) : canCreateFxTransfer ? (
          <Button onClick={openCreateFxDialog} data-testid="new-fx-transfer-button" className="self-start lg:self-auto">
            <Plus className="h-4 w-4" aria-hidden="true" />
            {d.fxFormTitleCreate}
          </Button>
        ) : (
          <div
            className="max-w-md rounded-2xl border border-dashed border-border bg-muted/20 px-4 py-3"
            data-testid="fx-transfer-enablement"
          >
            <p className="text-sm font-semibold text-foreground">{d.fxEnablementTitle}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              {d.fxEnablementDescription}
            </p>
            {(
              !shellData?.isSharedContext
              || shellData.sharedContextPermissions.canManageAccounts
            ) ? (
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link href={buildAccountsSetupHref("/cash-ledger")}>
                  {d.fxEnablementAction}
                </Link>
              </Button>
            ) : null}
          </div>
        )}
      </div>

      {/* Summary bar */}
      {summary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="cash-ledger-summary">
          {summary.map((s) => (
            <div
              key={`${s.accountId}:${s.currency}`}
              className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3 shadow-sm"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                {renderAccountLabel(s.accountId)}
              </p>
              <p className="mt-1 text-lg font-semibold text-slate-950">
                {formatCurrencyAmount(s.amount, s.currency, locale)}
              </p>
              <p className="mt-1 text-xs text-slate-500">{s.currency}</p>
            </div>
          ))}
        </div>
      )}

      {/* Filter toolbar — each control triggers fetch immediately on change */}
      <Card data-testid="cash-ledger-filter-toolbar" className="rounded-[20px] px-4 py-4 sm:px-5 sm:py-5">
        <div className="grid gap-4 lg:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.5fr)]">
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{d.filterDateFrom}</label>
            <input
              type="date"
              value={fromEntryDate}
              onChange={(e) => setFromEntryDate(e.target.value)}
              onBlur={handleDateBlur}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{d.filterDateTo}</label>
            <input
              type="date"
              value={toEntryDate}
              onChange={(e) => setToEntryDate(e.target.value)}
              onBlur={handleDateBlur}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{d.filterAccount}</label>
            <select
              value={accountId}
              onChange={(e) => handleAccountChange(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              data-testid="cash-ledger-account-select"
            >
              <option value="">—</option>
              {accountOptions.map((id) => (
                <option key={id} value={id}>{renderAccountLabel(id)}</option>
              ))}
            </select>
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">{d.filterEntryType}</label>
            <div className="flex flex-wrap gap-2">
              {ENTRY_TYPE_FILTER_OPTIONS.map((type) => {
                const active = type === "FX_TRANSFER"
                  ? FX_TRANSFER_ENTRY_TYPES.every((item) => entryTypeFilter.includes(item))
                  : entryTypeFilter.includes(type);
                const label = type === "FX_TRANSFER" ? d.entryTypeFxTransferFilter : entryTypeLabel(type, dict);
                return (
                <button
                  key={type}
                  type="button"
                  onClick={() => handleEntryTypeToggle(type)}
                  className={`rounded-full px-2 py-0.5 text-xs transition ${
                    active
                      ? "bg-indigo-100 text-indigo-700"
                      : "bg-slate-100 text-slate-500 hover:bg-slate-200"
                  }`}
                >
                  {label}
                </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Phase 4 — single-DOM table (drops legacy `lg:hidden` mobile cards).
          Scroll + sticky-date column at narrow viewports per scope-grill. */}
      {isLedgerLoading && entries.length === 0 ? (
        <Card>
          <p
            className="py-8 text-center text-sm text-muted-foreground"
            data-testid="cash-ledger-loading"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            Loading cash ledger...
          </p>
        </Card>
      ) : entries.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-muted-foreground" data-testid="cash-ledger-empty">
            {d.emptyState}
          </p>
        </Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="cash-ledger-table">
            <thead>
              <tr className="border-b border-border text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <SortHeader label={d.columnDate} field="entryDate" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} sticky />
                <SortHeader label={d.columnType} field="entryType" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <th className="px-3 py-3">{d.columnTicker}</th>
                <th className="px-3 py-3">{d.columnSide}</th>
                <SortHeader label={d.columnAmount} field="amount" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader label={d.columnCurrency} field="currency" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <SortHeader label={d.columnAccount} field="accountId" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                <th className="px-3 py-3 text-right"> </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  data-testid={`cash-ledger-row-${entry.id}`}
                  onClick={() => setDrawerEntry(entry)}
                  className="cursor-pointer border-b border-border transition hover:bg-muted/50"
                >
                  <td className="sticky left-0 z-10 bg-card border-r border-border md:static md:bg-transparent md:border-r-0 px-3 py-3 whitespace-nowrap">
                    {formatDateLabel(entry.entryDate, locale)}
                  </td>
                  <td className="px-3 py-3">{renderTypeCell(entry)}</td>
                  <td className="px-3 py-3 whitespace-nowrap font-medium">{entry.ticker ?? "—"}</td>
                  <td className="px-3 py-3 whitespace-nowrap">{entry.side ?? "—"}</td>
                  <td className={`px-3 py-3 whitespace-nowrap text-right font-medium ${entry.amount >= 0 ? "text-emerald-700" : "text-rose-700"}`}>
                    {formatCurrencyAmount(entry.amount, entry.currency, locale)}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{entry.currency}</td>
                  <td className="px-3 py-3 text-muted-foreground">{renderAccountLabel(entry.accountId)}</td>
                  <td className="px-3 py-3 text-right">{renderFxActionMenu(entry)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border px-4 py-3" data-testid="pagination">
              <span className="text-sm text-muted-foreground" data-testid="pagination-info">
                {d.pagination.page} {page} {d.pagination.of} {totalPages}{d.pagination.totalSuffix}
              </span>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                  data-testid="pagination-prev"
                >
                  {d.pagination.previous}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={page >= totalPages}
                  onClick={() => handlePageChange(page + 1)}
                  data-testid="pagination-next"
                >
                  {d.pagination.next}
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Drawer */}
      <CashLedgerDrawer
        entry={drawerEntry}
        onClose={() => setDrawerEntry(null)}
        dict={dict}
        locale={locale}
      />
      <RecordFxTransferDialog
        open={fxDialogOpen}
        mode={fxDialogMode}
        fxTransferId={editingFxTransferId}
        initialValue={fxDialogInitialValue}
        accounts={accounts}
        onOpenChange={setFxDialogOpen}
        onSaved={refreshAfterFxMutation}
        dict={dict}
        locale={locale}
      />
      <ConfirmDialog
        open={reverseEntry !== null}
        title={d.fxReverseTitle}
        description={reverseError || d.fxReverseDescription}
        confirmLabel={d.fxReverseConfirm}
        cancelLabel={d.fxReverseCancel}
        variant="danger"
        loading={reversePending}
        dialogTestId="fx-reverse-confirm-dialog"
        confirmTestId="fx-reverse-confirm"
        cancelTestId="fx-reverse-cancel"
        onConfirm={() => { void confirmReverseFxTransfer(); }}
        onCancel={() => {
          if (!reversePending) {
            setReverseEntry(null);
            setReverseError("");
          }
        }}
      />
    </div>
  );
}
