"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  AccountDefaultCurrency,
  AccountType,
  CurrencyCode,
  LocaleCode,
  MarketCode,
  SellAvailabilityDto,
} from "@vakwen/shared-types";
import { MARKET_CODES, currencyFor, marketCodeFor } from "@vakwen/shared-types";
import type { AppDictionary } from "../../lib/i18n";
import { cn, formatCurrencyAmount, formatDateLabel, formatNumber } from "../../lib/utils";
import { SingleCapabilityContext } from "../../features/portfolio-capabilities/components/SingleCapabilityContext";
import { TooltipInfo } from "../ui/TooltipInfo";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { fieldClassName } from "../ui/fieldStyles";
import type { TransactionInput } from "./types";
import { InstrumentCombobox } from "./InstrumentCombobox";
import type { TransactionPriceHint } from "../../features/portfolio/hooks/useTransactionSubmission";
import type { TransactionEstimateResponse } from "../../features/portfolio/services/portfolioService";

// KZO-169: chip surface forces an explicit market choice. ui-enhancement
// (2026-05-13) removed the "All" chip from the Record Transaction surface:
// the chip now always commits a concrete `MarketCode` and is one-way driven
// from the selected account's `defaultCurrency`. (The Settings → Tickers
// catalog browser keeps its ALL chip — see `InstrumentCatalogSheet`.)
// `MarketChip` keeps `null` as an *internal* state for the brief window
// between mount and first account/derivation; user-visible chips are always
// `MarketCode` literals. `MARKET_CHIPS` no longer contains `null`.
export type MarketChip = MarketCode | null;

const MARKET_CHIPS: ReadonlyArray<MarketCode> = MARKET_CODES;

export interface TransactionAccountOption {
  id: string;
  name: string;
  feeProfileName: string;
  // KZO-169: defaultCurrency drives chip default (D8a) AND filters the
  // dropdown to currency-compatible accounts (D8b). KZO-167 already
  // populates this field.
  defaultCurrency: AccountDefaultCurrency;
  accountType?: AccountType;
}

interface AddTransactionCardProps {
  value: TransactionInput;
  accountOptions: TransactionAccountOption[];
  availableMarkets?: readonly MarketCode[];
  pending: boolean;
  onChange: (next: TransactionInput) => void;
  onUnitPriceEdited?: () => void;
  onSubmit: () => Promise<void>;
  dict: AppDictionary;
  locale: LocaleCode;
  framed?: boolean;
  showHeader?: boolean;
  // KZO-169 (D9a): rename `tickerReadOnly` → `instrumentReadOnly`. Locks BOTH
  // the ticker combobox AND the chip in edit-mode.
  instrumentReadOnly?: boolean;
  priceHint: TransactionPriceHint | null;
  showPriceUnavailableHint: boolean;
  feeEstimate: TransactionEstimateResponse | null;
  sellAvailability?: SellAvailabilityDto | null;
  sellAvailabilityRequestKey?: string | null;
  isSellAvailabilityLoading?: boolean;
  sellAvailabilityTransportError?: string;
}

function formatAccountOptionLabel(account: TransactionAccountOption): string {
  if (!account.feeProfileName.trim()) {
    return account.name;
  }
  return `${account.name} — ${account.feeProfileName}`;
}

function parseOptionalNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function resolvePriceHintCopy(dict: AppDictionary, locale: LocaleCode, hint: TransactionPriceHint): string {
  const formattedDate = formatDateLabel(hint.date, locale);
  if (hint.message === "exact") {
    return dict.priceHint.exact.replace("{date}", formattedDate);
  }
  if (hint.reason === "weekend") {
    return dict.priceHint.previous.weekend.replace("{date}", formattedDate);
  }
  return dict.priceHint.previous.no_bar.replace("{date}", formattedDate);
}

// ui-enhancement (2026-05-13) — scope item 21: the default chip is the
// first account's market (formerly: only-currency-or-null). Empty list
// falls back to "TW" so the form always commits a concrete `MarketCode`
// for new users before they create an account. Locale-agnostic — the
// first-account heuristic mirrors how the dropdown lists accounts.
export function deriveDefaultMarketChip(
  accounts: ReadonlyArray<{ defaultCurrency: AccountDefaultCurrency }>,
): MarketCode {
  if (accounts.length === 0) {
    return "TW";
  }
  try {
    return marketCodeFor(accounts[0].defaultCurrency);
  } catch {
    return "TW";
  }
}

// KZO-169 (D8b): filter the account dropdown to accounts whose
// defaultCurrency matches the derived trade currency. ALL mode (no chip
// commit, no instrument commit) returns the full list — only locks down
// once the form has produced a definite trade currency.
export function filterAccountsByDerivedCurrency(
  accounts: ReadonlyArray<TransactionAccountOption>,
  derivedCurrency: AccountDefaultCurrency | null,
): TransactionAccountOption[] {
  if (derivedCurrency === null) {
    return [...accounts];
  }
  return accounts.filter((account) => account.defaultCurrency === derivedCurrency);
}

// Phase 3d S10 — the settings drawer is retired in favor of the
// `/settings/*` routes. The inline "no account for this currency" CTA on
// the transaction form deep-links into `/settings/accounts` and passes
// `accountsPrefillCurrency` as a query param. `AccountsSettingsClient`
// reads this via `useSearchParams()` and pre-selects the currency on the
// embedded `<AccountCreateForm>`. The `pathname` argument is preserved
// for back-compat with call sites (and the unit test signature) but is
// ignored — the destination is always the absolute `/settings/accounts`
// route, regardless of where the user clicked from.
export function buildCreateAccountHref(
  _pathname: string,
  currency: AccountDefaultCurrency,
): string {
  const params = new URLSearchParams();
  params.set("accountsPrefillCurrency", currency);
  return `/settings/accounts?${params.toString()}`;
}

function chipPillClassName(active: boolean, disabled: boolean): string {
  return cn(
    "inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-medium uppercase tracking-[0.18em] transition",
    active
      ? "border-indigo-500 bg-indigo-50 text-indigo-700 ring-2 ring-indigo-300"
      : "border-slate-200 bg-white/85 text-slate-600 hover:border-slate-300",
    disabled && "cursor-not-allowed opacity-60",
  );
}

function chipLabel(dict: AppDictionary, chip: MarketCode): string {
  if (chip === "TW") return dict.transactions.marketChipTW;
  if (chip === "US") return dict.transactions.marketChipUS;
  if (chip === "AU") return dict.transactions.marketChipAU;
  if (chip === "KR") return dict.transactions.marketChipKR;
  return dict.transactions.marketChipJP;
}

export function AddTransactionCard({
  value,
  accountOptions,
  availableMarkets,
  pending,
  onChange,
  onUnitPriceEdited,
  onSubmit,
  dict,
  locale,
  framed = true,
  showHeader = true,
  instrumentReadOnly = false,
  priceHint,
  showPriceUnavailableHint,
  feeEstimate,
  sellAvailability = null,
  sellAvailabilityRequestKey = null,
  isSellAvailabilityLoading = false,
  sellAvailabilityTransportError = "",
}: AddTransactionCardProps) {
  const accountSelectId = useId();
  const constrainedMarkets = useMemo(() => {
    if (!availableMarkets || availableMarkets.length === 0) {
      return [...MARKET_CHIPS];
    }

    return MARKET_CHIPS.filter((market) => availableMarkets.includes(market));
  }, [availableMarkets]);

  function setField<K extends keyof TransactionInput>(key: K, nextValue: TransactionInput[K]) {
    onChange({ ...value, [key]: nextValue });
  }

  // KZO-169 + ui-enhancement: chip lives at the top of the form. Initial
  // value derives from the first account's market (or TW fallback for the
  // zero-account state). The chip is one-way driven from the selected
  // account but remains user-overridable via `handleChipChange` until the
  // account changes again. `explicitChip` records the user's override (if
  // any) so it survives reconciliation effects.
  const [explicitChip, setExplicitChip] = useState<MarketCode | undefined>(undefined);
  const defaultChip = useMemo(
    () => constrainedMarkets[0] ?? deriveDefaultMarketChip(accountOptions),
    [accountOptions, constrainedMarkets],
  );
  const activeChip: MarketCode = explicitChip !== undefined && constrainedMarkets.includes(explicitChip)
    ? explicitChip
    : (value.marketCode && constrainedMarkets.includes(value.marketCode) ? value.marketCode : defaultChip);

  // ui-enhancement: chip is always a concrete `MarketCode` (ALL chip
  // removed from this surface). Derived trade currency follows it directly.
  const derivedMarket: MarketCode = activeChip;
  const derivedCurrency: AccountDefaultCurrency = currencyFor(derivedMarket);

  const dropdownAccounts = filterAccountsByDerivedCurrency(accountOptions, derivedCurrency);
  const noCompatibleAccount = dropdownAccounts.length === 0;

  // KZO-169: priceCurrency input becomes purely derived. We mirror it back
  // into form state so consumers (history table, recompute) read a real value.
  const displayCurrency: CurrencyCode | "" = derivedCurrency;

  // ui-enhancement (2026-05-13) — scope items 22–23: account → chip is a
  // one-way binding. When the user selects a new account, the chip syncs
  // to that account's market AND the committed ticker clears (the user is
  // about to pick a new instrument scoped to the new market).
  //
  // `prevAccountIdRef` is a `useRef` (not state) so updating it does NOT
  // re-trigger this effect; we only want to fire the auto-sync once per
  // *real* user-driven account change. The ref starts at the initial
  // accountId so first-mount does NOT trigger a spurious clear — a
  // freshly-loaded form with `value.accountId="acc-tw"` is already in
  // sync, not a "new account selection". Branch 2's chip/currency
  // reconcile still runs every render via the same effect.
  const prevAccountIdRef = useRef<string>(value.accountId);
  useEffect(() => {
    // Branch 1 — user-driven account change → chip auto-sync + ticker clear.
    if (!instrumentReadOnly && value.accountId && value.accountId !== prevAccountIdRef.current) {
      prevAccountIdRef.current = value.accountId;
      const account = accountOptions.find((a) => a.id === value.accountId);
      if (account) {
        let nextMarket: MarketCode | null = null;
        try {
          nextMarket = marketCodeFor(account.defaultCurrency);
        } catch {
          // fall through to branch 2
        }
        if (nextMarket) {
          const formChanged =
            value.marketCode !== nextMarket
            || value.ticker.length > 0
            || value.priceCurrency !== currencyFor(nextMarket);
          setExplicitChip(nextMarket);
          if (formChanged) {
            onChange({
              ...value,
              marketCode: nextMarket,
              ticker: "",
              priceCurrency: currencyFor(nextMarket),
            });
          }
          return; // defer reconcile to next render
        }
      }
    }

    // Track even on no-op so re-selection of the same id later doesn't
    // double-fire after an intervening setValue from elsewhere.
    prevAccountIdRef.current = value.accountId;

    // Branch 2 — chip-driven priceCurrency reconcile. `handleChipChange`
    // clears `value.ticker`; this branch mirrors `derivedCurrency` into
    // `value.priceCurrency` so consumers see it.
    if (value.priceCurrency !== derivedCurrency) {
      onChange({ ...value, priceCurrency: derivedCurrency });
    }
  }, [
    derivedCurrency,
    instrumentReadOnly,
    value,
    onChange,
    accountOptions,
  ]);

  const selectedAccount = dropdownAccounts.find((account) => account.id === value.accountId);
  const accountSelectTitle = selectedAccount ? formatAccountOptionLabel(selectedAccount) : "";
  const hasCompleteSellAvailabilityLookup = (
    value.type === "SELL"
    && value.accountId.length > 0
    && value.ticker.trim().length > 0
    && value.marketCode !== null
    && value.tradeDate.length > 0
  );
  const currentSellAvailabilityKey = hasCompleteSellAvailabilityLookup
    ? `${value.accountId}|${value.ticker.trim().toUpperCase()}|${value.marketCode}|${value.tradeDate}`
    : null;
  const sellAvailabilityMatchesCurrentTuple = currentSellAvailabilityKey !== null && sellAvailabilityRequestKey === currentSellAvailabilityKey;
  const readySellAvailability = sellAvailabilityMatchesCurrentTuple && sellAvailability?.status === "ready" ? sellAvailability : null;
  const unavailableSellAvailability = sellAvailabilityMatchesCurrentTuple && sellAvailability?.status === "unavailable" ? sellAvailability : null;
  const knownAvailableQuantity = readySellAvailability?.availableQuantity ?? null;
  const hasInvalidQuantity = !Number.isFinite(value.quantity) || value.quantity <= 0;
  const hasKnownOversell = knownAvailableQuantity !== null && value.quantity > knownAvailableQuantity;
  const sellAvailabilityBlocksSubmit = (
    value.type === "SELL"
    && hasCompleteSellAvailabilityLookup
    && (isSellAvailabilityLoading || unavailableSellAvailability !== null || hasKnownOversell)
  );

  const submitDisabled =
    pending ||
    !value.accountId ||
    !selectedAccount ||
    !value.ticker.trim() ||
    !value.marketCode ||
    hasInvalidQuantity ||
    noCompatibleAccount ||
    sellAvailabilityBlocksSubmit;

  function handleChipChange(nextChip: MarketCode) {
    if (instrumentReadOnly) return;
    setExplicitChip(nextChip);
    const nextCurrency = currencyFor(nextChip);
    const nextAccountId =
      filterAccountsByDerivedCurrency(accountOptions, nextCurrency)[0]?.id ?? "";
    const keepCommittedInstrument =
      value.ticker.trim().length > 0 &&
      value.marketCode !== null &&
      nextChip === value.marketCode;

    onChange({
      ...value,
      accountId: nextAccountId,
      marketCode: keepCommittedInstrument ? value.marketCode : null,
      ticker: keepCommittedInstrument ? value.ticker : "",
      priceCurrency: nextCurrency,
    });
  }

  function handleInstrumentSelect(ticker: string, marketCode: MarketCode) {
    onChange({
      ...value,
      ticker,
      marketCode,
      // Currency derives from the committed instrument's market.
      priceCurrency: currencyFor(marketCode),
    });
  }

  // Pathname for the create-account link. Falls back to `/dashboard` so the
  // server-rendered HTML is stable in tests where `window` may be undefined.
  const pathname =
    typeof window !== "undefined" ? window.location.pathname : "/dashboard";
  const createAccountHref = buildCreateAccountHref(pathname, derivedCurrency);

  // ui-enhancement (2026-05-13) — 4-tuple gate for fee/tax sections.
  // Replaces the old `feeEstimate ?` gate so the sections stay rendered
  // during transient `feeEstimate == null` states (price mismatch race,
  // pre-fetch). When the 4-tuple is satisfied the section renders; if
  // `feeEstimate == null` the estimate label degrades to "—" + the
  // sub-label "estimate unavailable" — override inputs stay editable.
  const feeTuplelComplete =
    value.accountId.length > 0
    && value.ticker.trim().length > 0
    && value.quantity > 0
    && value.unitPrice > 0;
  const grossTradeValue = roundMoney(value.quantity * value.unitPrice);
  const effectiveCommissionAmount = value.commissionAmount ?? feeEstimate?.commissionAmount ?? null;
  const effectiveTaxAmount = value.taxAmount ?? feeEstimate?.taxAmount ?? (value.type === "BUY" ? 0 : null);
  const settlementAmount = effectiveCommissionAmount !== null && effectiveTaxAmount !== null
    ? roundMoney(
        value.type === "BUY"
          ? grossTradeValue + effectiveCommissionAmount + effectiveTaxAmount
          : grossTradeValue - effectiveCommissionAmount - effectiveTaxAmount,
      )
    : null;

  const content = (
    <>
      {showHeader ? (
        <div className="mb-5 min-w-0">
          <h2 className="text-xl leading-tight text-slate-950 sm:text-2xl md:text-[2rem]">{dict.transactions.title}</h2>
          <p className="mt-3 break-words text-sm leading-6 text-slate-600">{dict.transactions.description}</p>
        </div>
      ) : null}

      {/* KZO-169: market_code chip selector. Sits above the existing fields per
          mockup. Disabled in edit mode (D9a). */}
      <fieldset
        className="mb-5 space-y-2"
        aria-disabled={instrumentReadOnly || undefined}
        data-testid="tx-market-chip-row"
      >
        <legend className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
          {dict.transactions.marketTerm}
        </legend>
        {constrainedMarkets.length === 1 ? (
          <SingleCapabilityContext
            label={dict.transactions.marketTerm}
            value={chipLabel(dict, constrainedMarkets[0] ?? defaultChip)}
            testId="tx-market-context-single"
          />
        ) : (
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={dict.transactions.marketTerm}>
            {constrainedMarkets.map((chip) => {
              const active = activeChip === chip;
              return (
                <button
                  key={chip}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  disabled={instrumentReadOnly}
                  onClick={() => handleChipChange(chip)}
                  className={chipPillClassName(active, instrumentReadOnly)}
                  data-testid={`tx-market-chip-${chip}`}
                >
                  {chipLabel(dict, chip)}
                </button>
              );
            })}
          </div>
        )}
      </fieldset>

      <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2 text-sm" data-testid="account-selector">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <label htmlFor={accountSelectId} className="min-w-0">
              {dict.transactions.accountTerm}
            </label>
            <TooltipInfo
              label={dict.transactions.accountTerm}
              content={dict.tooltips.txAccount}
              triggerTestId="tooltip-tx-account-trigger"
              contentTestId="tooltip-tx-account-content"
            />
          </span>
          {/* KZO-169 (D8c): when no account matches the derived currency, the
              dropdown slot is replaced by an inline error block with a
              create-account link that pre-fills the missing currency. */}
          {noCompatibleAccount ? (
            <div
              className="rounded-[14px] border border-rose-200 bg-rose-50/80 px-3 py-2 text-xs text-rose-700"
              data-testid="tx-no-account-error"
              role="status"
              aria-live="polite"
            >
              <span>
                {dict.transactions.noAccountForCurrency.replace(
                  "{currency}",
                  derivedCurrency,
                )}
              </span>
              <a
                href={createAccountHref}
                className="font-medium text-rose-700 underline hover:text-rose-900"
                data-testid="tx-create-account-link"
              >
                {dict.transactions.createAccountLink.replace(
                  "{currency}",
                  derivedCurrency,
                )}
              </a>
            </div>
          ) : (
            <select
              id={accountSelectId}
              value={selectedAccount ? value.accountId : ""}
              onChange={(event) => setField("accountId", event.target.value)}
              title={accountSelectTitle}
              className={fieldClassName}
              data-testid="tx-account-select"
              disabled={dropdownAccounts.length === 0}
            >
              {dropdownAccounts.length === 0 || !selectedAccount ? (
                <option value="" disabled>
                  —
                </option>
              ) : null}
              {dropdownAccounts.map((account) => (
                <option key={account.id} value={account.id}>
                  {formatAccountOptionLabel(account)}
                </option>
              ))}
            </select>
          )}
        </div>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.typeTerm}</span>
            <TooltipInfo
              label={dict.transactions.typeTerm}
              content={dict.tooltips.txType}
              triggerTestId="tooltip-tx-type-trigger"
              contentTestId="tooltip-tx-type-content"
            />
          </span>
          <select
            value={value.type}
            onChange={(event) => setField("type", event.target.value as "BUY" | "SELL")}
            className={fieldClassName}
            data-testid="tx-type-select"
          >
            <option value="BUY">{dict.transactions.typeBuy}</option>
            <option value="SELL">{dict.transactions.typeSell}</option>
          </select>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.tickerTerm}</span>
            <TooltipInfo
              label={dict.transactions.tickerTerm}
              content={dict.tooltips.txTicker}
              triggerTestId="tooltip-tx-symbol-trigger"
              contentTestId="tooltip-tx-symbol-content"
            />
          </span>
          <InstrumentCombobox
            value={value.ticker}
            selectedMarketCode={value.marketCode}
            marketCodeFilter={activeChip}
            onSelect={handleInstrumentSelect}
            dict={dict}
            readOnly={instrumentReadOnly}
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.quantityTerm}</span>
            <TooltipInfo
              label={dict.transactions.quantityTerm}
              content={dict.tooltips.txQuantity}
              triggerTestId="tooltip-tx-quantity-trigger"
              contentTestId="tooltip-tx-quantity-content"
            />
          </span>
          <input
            type="number"
            min="1"
            step="1"
            value={value.quantity}
            onChange={(event) => setField("quantity", Number(event.target.value))}
            className={fieldClassName}
            data-testid="tx-quantity-input"
            max={knownAvailableQuantity ?? undefined}
            aria-invalid={hasKnownOversell || unavailableSellAvailability !== null ? "true" : undefined}
          />
          {value.type === "SELL" && hasCompleteSellAvailabilityLookup ? (
            <div className="space-y-1" data-testid="sell-availability-panel">
              {isSellAvailabilityLoading ? (
                <p className="text-[11px] text-slate-500" data-testid="sell-availability-loading">
                  {dict.transactions.sellAvailabilityLoading}
                </p>
              ) : null}
              {readySellAvailability ? (
                <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600" data-testid="sell-availability-ready">
                  <span>
                    {dict.transactions.sellAvailabilityReady.replace(
                      "{quantity}",
                      formatNumber(readySellAvailability.availableQuantity, locale, 6),
                    )}
                  </span>
                  <button
                    type="button"
                    className="font-medium text-indigo-700 underline underline-offset-2 hover:text-indigo-900 disabled:cursor-not-allowed disabled:text-slate-400"
                    onClick={() => setField("quantity", readySellAvailability.availableQuantity)}
                    disabled={readySellAvailability.availableQuantity <= 0}
                    data-testid="sell-availability-use-max"
                  >
                    {dict.transactions.sellAvailabilityUseMax}
                  </button>
                </div>
              ) : null}
              {sellAvailabilityTransportError ? (
                <p className="text-[11px] text-amber-700" data-testid="sell-availability-transport-warning">
                  {dict.transactions.sellAvailabilityTransportWarning}
                </p>
              ) : null}
              {unavailableSellAvailability ? (
                <p className="text-[11px] text-rose-700" data-testid="sell-availability-unavailable">
                  {dict.transactions.sellAvailabilityUnavailable}
                </p>
              ) : null}
              {hasKnownOversell ? (
                <p className="text-[11px] text-rose-700" data-testid="sell-availability-oversell">
                  {dict.transactions.sellAvailabilityOversell
                    .replace("{requested}", formatNumber(value.quantity, locale, 6))
                    .replace("{available}", formatNumber(knownAvailableQuantity ?? 0, locale, 6))}
                </p>
              ) : null}
            </div>
          ) : null}
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.unitPriceTerm}</span>
            <TooltipInfo
              label={dict.transactions.unitPriceTerm}
              content={dict.tooltips.txPrice}
              triggerTestId="tooltip-tx-price-trigger"
              contentTestId="tooltip-tx-price-content"
            />
          </span>
          <input
            type="number"
            min="0.01"
            step="0.01"
            value={value.unitPrice}
            onChange={(event) => {
              onUnitPriceEdited?.();
              setField("unitPrice", Number(event.target.value));
            }}
            className={fieldClassName}
            data-testid="unit-price-input"
          />
          {priceHint ? (
            <p className="text-[11px] text-slate-500" data-testid="price-source-hint">
              {resolvePriceHintCopy(dict, locale, priceHint)}
            </p>
          ) : null}
          {showPriceUnavailableHint ? (
            <p className="text-[11px] text-rose-600" data-testid="price-unavailable-hint">
              {dict.priceHint.unavailable}
            </p>
          ) : null}
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.currencyTerm}</span>
            <TooltipInfo
              label={dict.transactions.currencyTerm}
              content={dict.tooltips.txCurrency}
              triggerTestId="tooltip-tx-currency-trigger"
              contentTestId="tooltip-tx-currency-content"
            />
          </span>
          {/* KZO-169: currency input is purely derived from the chip+ticker
              commit. Locked + display-only; no user override path. */}
          <input
            value={displayCurrency}
            readOnly
            disabled
            aria-readonly="true"
            aria-disabled="true"
            className={`${fieldClassName} cursor-not-allowed bg-slate-100 text-slate-500`}
            data-testid="tx-price-currency-input"
          />
          <p className="text-[11px] text-slate-500">{dict.tooltips.txCurrency}</p>
        </label>

        <label className="min-w-0 space-y-2 text-sm">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.tradeDateTerm}</span>
            <TooltipInfo
              label={dict.transactions.tradeDateTerm}
              content={dict.tooltips.txTradeDate}
              triggerTestId="tooltip-tx-trade-date-trigger"
              contentTestId="tooltip-tx-trade-date-content"
            />
          </span>
          <input
            type="date"
            value={value.tradeDate}
            onChange={(event) => setField("tradeDate", event.target.value)}
            className={fieldClassName}
            data-testid="tx-trade-date-input"
          />
        </label>

        <label className="min-w-0 space-y-2 text-sm sm:col-span-2">
          <span className="flex min-w-0 flex-wrap items-center gap-1 text-[11px] uppercase tracking-[0.18em] text-slate-500">
            <span className="min-w-0">{dict.transactions.dayTradeTerm}</span>
            <TooltipInfo
              label={dict.transactions.dayTradeTerm}
              content={dict.tooltips.txDayTrade}
              triggerTestId="tooltip-tx-day-trade-trigger"
              contentTestId="tooltip-tx-day-trade-content"
            />
          </span>
          <select
            value={value.isDayTrade ? "yes" : "no"}
            onChange={(event) => setField("isDayTrade", event.target.value === "yes")}
            className={fieldClassName}
            data-testid="tx-day-trade-select"
          >
            <option value="no">{dict.transactions.dayTradeNo}</option>
            <option value="yes">{dict.transactions.dayTradeYes}</option>
          </select>
        </label>
      </div>

      {feeTuplelComplete ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <section className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4" data-testid="commission-estimate-section">
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.transactions.commissionEstimateTitle}</p>
              <p className="text-sm font-medium text-slate-900" data-testid="commission-estimate-value">
                {feeEstimate
                  ? dict.transactions.estimatedLabel.replace(
                      "{amount}",
                      formatCurrencyAmount(feeEstimate.commissionAmount, value.priceCurrency, locale),
                    )
                  : dict.transactions.estimatedUnavailable}
              </p>
              {!feeEstimate ? (
                <p
                  className="text-[11px] text-slate-500"
                  data-testid="commission-estimate-unavailable"
                >
                  {dict.transactions.estimateUnavailableSubLabel}
                </p>
              ) : null}
            </div>
            <input
              type="number"
              min="0"
              step="0.0001"
              inputMode="decimal"
              value={value.commissionAmount ?? ""}
              onChange={(event) => setField("commissionAmount", parseOptionalNumber(event.target.value))}
              className={fieldClassName}
              placeholder={dict.transactions.overrideAmountPlaceholder}
              data-testid="commission-override-input"
            />
          </section>

          {value.type === "SELL" ? (
            <section className="space-y-3 rounded-[20px] border border-slate-200 bg-slate-50/80 p-4" data-testid="tax-estimate-section">
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{dict.transactions.taxEstimateTitle}</p>
                <p className="text-sm font-medium text-slate-900" data-testid="tax-estimate-value">
                  {feeEstimate
                    ? dict.transactions.estimatedLabel.replace(
                        "{amount}",
                        formatCurrencyAmount(feeEstimate.taxAmount, value.priceCurrency, locale),
                      )
                    : dict.transactions.estimatedUnavailable}
                </p>
                {!feeEstimate ? (
                  <p
                    className="text-[11px] text-slate-500"
                    data-testid="tax-estimate-unavailable"
                  >
                    {dict.transactions.estimateUnavailableSubLabel}
                  </p>
                ) : null}
              </div>
              <input
                type="number"
                min="0"
                step="0.0001"
                inputMode="decimal"
                value={value.taxAmount ?? ""}
                onChange={(event) => setField("taxAmount", parseOptionalNumber(event.target.value))}
                className={fieldClassName}
                placeholder={dict.transactions.overrideAmountPlaceholder}
                data-testid="tax-override-input"
              />
            </section>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <section className="space-y-2 px-1 py-1" data-testid="gross-trade-value-section">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{dict.transactions.grossTradeValueLabel}</p>
          <p className="text-base font-semibold text-foreground" data-testid="gross-trade-value-amount">
            {formatCurrencyAmount(grossTradeValue, value.priceCurrency, locale)}
          </p>
        </section>
        <section className="space-y-2 px-1 py-1" data-testid="settlement-value-section">
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            {value.type === "BUY" ? dict.transactions.buyCashOutLabel : dict.transactions.sellNetProceedsLabel}
          </p>
          <p className="text-base font-semibold text-foreground" data-testid="settlement-value-amount">
            {settlementAmount === null
              ? dict.transactions.estimatedUnavailable
              : formatCurrencyAmount(settlementAmount, value.priceCurrency, locale)}
          </p>
          {settlementAmount === null ? (
            <p className="text-xs text-amber-700" data-testid="settlement-value-unavailable">
              {dict.transactions.settlementUnavailableMessage}
            </p>
          ) : null}
        </section>
      </div>

      <div className="mt-6 flex min-w-0 justify-end">
        <Button onClick={() => onSubmit()} disabled={submitDisabled} data-testid="tx-submit-button" className="w-full whitespace-normal text-center sm:w-auto">
          {pending ? dict.actions.submitting : dict.actions.submitTransaction}
        </Button>
      </div>
    </>
  );

  if (!framed) {
    return content;
  }

  return <Card>{content}</Card>;
}
