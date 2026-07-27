"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Building2, Landmark, Wallet } from "lucide-react";
import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountMutationResponseDto,
  AccountType,
} from "@vakwen/shared-types";
import { ACCOUNT_DEFAULT_CURRENCIES } from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { ApiError } from "../../../lib/api";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import {
  formatAccountOption,
  type AccountTypeLabels,
} from "../../cash-ledger/utils/accountOptions";
import type { CreateAccountInput } from "../../cash-ledger/services/cashLedgerService";

/**
 * KZO-179 — Add-account form. Lives at the top of the Accounts tab in the
 * settings drawer, above the per-account expandable cards.
 *
 * KZO-183 changes (copy + structure):
 * - Currency cards now read market names with a
 *   small `TWD · TWSE` (etc.) subtext. The underlying field stays
 *   `defaultCurrency` — the route still receives the wire value.
 * - The fee-profile picker (KZO-179 D5 conditional) was removed entirely:
 *   the route now auto-seeds an account-scoped default profile, so the
 *   client never sets `feeProfileId`.
 *
 * Visual contract (D13):
 * - Type pills use `lucide-react` icons (Building2 / Landmark / Wallet).
 * - Currency cards are button-style with `ring-2 ring-primary/30` selected.
 * - Live-preview chip imports `formatAccountOption` from cash-ledger utils
 *   (DO NOT duplicate per `nextjs-i18n-serialization.md`).
 *
 * Submit flow (D12): `await onCreate(input); onAccountsRefresh(); resetForm();`.
 */
const ACCOUNT_TYPES: ReadonlyArray<AccountType> = ["broker", "bank", "wallet"];
const ACCOUNT_CURRENCIES: ReadonlyArray<AccountDefaultCurrency> = ACCOUNT_DEFAULT_CURRENCIES;

const TYPE_ICONS: Record<AccountType, typeof Building2> = {
  broker: Building2,
  bank: Landmark,
  wallet: Wallet,
};

interface AccountCreateFormProps {
  // Returns the new account on success; the form ignores the resolved value
  // and signals refresh via `onAccountsRefresh`. Matches the
  // `createAccount` web service shape (`Promise<AccountMutationResponseDto>`).
  onCreate: (input: CreateAccountInput) => Promise<AccountMutationResponseDto>;
  onAccountsRefresh: (response?: AccountMutationResponseDto) => void | Promise<void>;
  dict: AppDictionary;
  // KZO-169 (NC4): deep-link support — the transaction form's "no {currency}
  // account" inline error links here with `?accountsPrefillCurrency=USD`,
  // and the SettingsDrawer pipes the value into this prop. We seed the
  // initial market-card selection so the user lands on the right currency
  // without having to reselect.
  prefillCurrency?: AccountDefaultCurrency;
  disabled?: boolean;
  existingAccounts?: AccountDto[];
  isFirstAccount?: boolean;
  onCreatedSuccess?: (response: AccountMutationResponseDto) => void;
}

export function AccountCreateForm({
  onCreate,
  onAccountsRefresh,
  dict,
  prefillCurrency,
  disabled = false,
  existingAccounts = [],
  isFirstAccount = false,
  onCreatedSuccess,
}: AccountCreateFormProps) {
  const [step, setStep] = useState<"market" | "details" | "review">("market");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("broker");
  const [defaultCurrency, setDefaultCurrency] = useState<AccountDefaultCurrency>(
    prefillCurrency ?? "TWD",
  );
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const trimmedName = name.trim();
  const submitDisabled = disabled || trimmedName.length === 0 || submitting || step !== "review";
  const marketAlreadyEnabled = existingAccounts.some((account) => account.defaultCurrency === defaultCurrency);

  const typeLabels: AccountTypeLabels = useMemo(
    () => ({
      accountTypeBroker: dict.cashLedger.accountTypeBroker,
      accountTypeBank: dict.cashLedger.accountTypeBank,
      accountTypeWallet: dict.cashLedger.accountTypeWallet,
    }),
    [
      dict.cashLedger.accountTypeBroker,
      dict.cashLedger.accountTypeBank,
      dict.cashLedger.accountTypeWallet,
    ],
  );

  const previewLabel = useMemo(
    () =>
      trimmedName.length > 0
        ? formatAccountOption(
            { name: trimmedName, defaultCurrency, accountType },
            typeLabels,
          )
        : dict.settings.accountCreateNamePlaceholder,
    [
      trimmedName,
      defaultCurrency,
      accountType,
      typeLabels,
      dict.settings.accountCreateNamePlaceholder,
    ],
  );

  function resetForm() {
    setName("");
    setAccountType("broker");
    setDefaultCurrency(prefillCurrency ?? "TWD");
    setErrorMessage("");
    setStep("market");
  }

  async function handleSubmit(event?: FormEvent<HTMLFormElement>) {
    if (event) {
      event.preventDefault();
    }
    if (submitDisabled) {
      return;
    }

    const input: CreateAccountInput = {
      name: trimmedName,
      defaultCurrency,
      accountType,
    };

    setErrorMessage("");
    setSuccessMessage("");
    setSubmitting(true);
    try {
      const created = await onCreate(input);
      await onAccountsRefresh(created);
      onCreatedSuccess?.(created);
      resetForm();
      setSuccessMessage(
        dict.settings.accountCreateSuccess
          .replace("{name}", created.account.name)
          .replace("{currency}", created.account.defaultCurrency),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        setErrorMessage(dict.settings.accountCreateNameInUseError);
      } else {
        setErrorMessage(dict.settings.accountCreateGenericError);
      }
    } finally {
      setSubmitting(false);
    }
  }

  function typePillClassName(active: boolean): string {
    return [
      "inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition",
      active
        ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30"
        : "border-border bg-background text-muted-foreground hover:border-input",
    ].join(" ");
  }

  function marketCardClassName(active: boolean): string {
    return [
      "flex flex-col items-start rounded-[18px] border px-3 py-3 text-left transition",
      active
        ? "border-primary bg-primary/10 text-primary ring-2 ring-primary/30"
        : "border-border bg-background text-foreground hover:border-input",
    ].join(" ");
  }

  function typeLabelFor(type: AccountType): string {
    switch (type) {
      case "broker": return dict.cashLedger.accountTypeBroker;
      case "bank": return dict.cashLedger.accountTypeBank;
      case "wallet": return dict.cashLedger.accountTypeWallet;
    }
  }

  // KZO-183: market label + subtext per currency. Field remains
  // `defaultCurrency` so the wire shape is unchanged.
  function marketLabelFor(currency: AccountDefaultCurrency): string {
    switch (currency) {
      case "TWD": return dict.settings.accountCreateMarketTaiwan;
      case "USD": return dict.settings.accountCreateMarketUnitedStates;
      case "AUD": return dict.settings.accountCreateMarketAustralia;
      case "KRW": return dict.settings.accountCreateMarketKorea;
      case "JPY": return dict.settings.accountCreateMarketJapan;
    }
  }

  function marketSubtextFor(currency: AccountDefaultCurrency): string {
    switch (currency) {
      case "TWD": return dict.settings.accountCreateMarketTaiwanSubtext;
      case "USD": return dict.settings.accountCreateMarketUnitedStatesSubtext;
      case "AUD": return dict.settings.accountCreateMarketAustraliaSubtext;
      case "KRW": return dict.settings.accountCreateMarketKoreaSubtext;
      case "JPY": return dict.settings.accountCreateMarketJapanSubtext;
    }
  }

  function capabilityLinesFor(currency: AccountDefaultCurrency): string[] {
    const marketCode = currency === "TWD" ? "TW" : currency === "USD" ? "US" : currency === "AUD" ? "AU" : currency === "KRW" ? "KR" : "JP";
    return [
      dict.settings.accountCreateCapabilityTransactions.replace("{market}", marketCode),
      dict.settings.accountCreateCapabilityReports.replace("{market}", marketCode),
      dict.settings.accountCreateCapabilityDividends,
      dict.settings.accountCreateCapabilityReportingCurrency.replace("{currency}", currency),
    ];
  }

  function canContinueFromDetails(): boolean {
    return !disabled && trimmedName.length > 0;
  }

  const titleId = "account-create-form-title";

  return (
    <section
      aria-labelledby={titleId}
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      data-testid="account-create-form"
    >
      <div className="grid gap-2 sm:grid-cols-3">
        {([
          ["market", dict.settings.accountCreateStepMarket],
          ["details", dict.settings.accountCreateStepDetails],
          ["review", dict.settings.accountCreateStepReview],
        ] as const).map(([value, label], index) => {
          const active = step === value;
          const complete = (step === "details" || step === "review") && value === "market"
            || step === "review" && value === "details";
          return (
            <div
              key={value}
              className={[
                "rounded-xl border px-3 py-2 text-sm",
                active ? "border-primary bg-primary/10 text-primary" : "border-border bg-muted/20 text-muted-foreground",
              ].join(" ")}
              data-testid={`account-create-step-${value}`}
            >
              <span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded-full border border-current text-xs font-semibold">
                {complete ? "✓" : index + 1}
              </span>
              {label}
            </div>
          );
        })}
      </div>
      <form className="space-y-4" onSubmit={(event) => void handleSubmit(event)}>
        <div className="space-y-1">
          <h3 id={titleId} className="text-lg font-semibold text-foreground">
            {isFirstAccount ? dict.settings.accountCreateFirstAccountTitle : dict.settings.accountCreateTitle}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isFirstAccount ? dict.settings.accountCreateFirstAccountDescription : dict.settings.accountCreateDescription}
          </p>
        </div>

        {step === "market" ? (
          <div className="space-y-4">
            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {dict.settings.accountCreateMarketLabel}
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5" role="radiogroup">
                {ACCOUNT_CURRENCIES.map((currency) => {
                  const active = defaultCurrency === currency;
                  const alreadyEnabled = existingAccounts.some((account) => account.defaultCurrency === currency);
                  return (
                    <button
                      key={currency}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setDefaultCurrency(currency)}
                      className={marketCardClassName(active)}
                      data-testid={`account-create-currency-${currency}`}
                      disabled={disabled}
                    >
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-foreground">
                        {marketLabelFor(currency)}
                      </span>
                      <span className="mt-1.5 font-mono text-[10px] text-muted-foreground">
                        {marketSubtextFor(currency)}
                      </span>
                      {alreadyEnabled ? (
                        <span className="mt-2 text-[10px] font-medium text-primary">
                          {dict.settings.accountCreateAlreadyEnabled}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div
              className="rounded-2xl border border-primary/20 bg-primary/10 p-4"
              data-testid="account-create-enabled-market-note"
            >
              <p className="text-sm font-semibold text-foreground">{dict.settings.accountCreateCapabilitiesTitle}</p>
              {marketAlreadyEnabled ? (
                <div className="mt-1 space-y-1">
                  <p className="text-xs font-semibold text-primary">{dict.settings.accountCreateAlreadyEnabled}</p>
                  <p className="text-xs text-muted-foreground">{dict.settings.accountCreateAlreadyEnabledBody}</p>
                </div>
              ) : null}
              <ul className="mt-3 grid gap-2 text-sm text-foreground sm:grid-cols-2">
                {capabilityLinesFor(defaultCurrency).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {step === "details" ? (
          <div className="space-y-4">
            <label className="space-y-1 text-sm">
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {dict.settings.accountCreateNameLabel}
              </span>
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder={dict.settings.accountCreateNamePlaceholder}
                className={fieldClassName}
                data-testid="account-create-name-input"
                disabled={disabled}
              />
            </label>

            <fieldset className="space-y-2">
              <legend className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {dict.settings.accountCreateTypeLabel}
              </legend>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup">
                {ACCOUNT_TYPES.map((type) => {
                  const Icon = TYPE_ICONS[type];
                  const active = accountType === type;
                  return (
                    <button
                      key={type}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setAccountType(type)}
                      className={typePillClassName(active)}
                      data-testid={`account-create-type-${type}`}
                      disabled={disabled}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{typeLabelFor(type)}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <p
              className="rounded-xl border border-primary/20 bg-primary/10 px-3 py-2 text-xs text-primary"
              data-testid="account-create-currency-lock"
            >
              {dict.settings.accountCreateCurrencyLockBody}
            </p>
          </div>
        ) : null}

        {step === "review" ? (
          <div className="space-y-4" data-testid="account-create-step-review">
            <div className="rounded-xl border border-border bg-muted/20 p-4">
              <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{dict.settings.accountCreateMarketLabel}</dt>
                  <dd>{marketLabelFor(defaultCurrency)} · {defaultCurrency}</dd>
                </div>
                <div>
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{dict.settings.accountCreateTypeLabel}</dt>
                  <dd>{typeLabelFor(accountType)}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs uppercase tracking-wide text-muted-foreground">{dict.settings.accountCreateDefaultProfileReviewTitle}</dt>
                  <dd>{dict.settings.accountCreateDefaultProfileReview}</dd>
                </div>
              </dl>
            </div>
          </div>
        ) : null}

        <div className="space-y-1 text-sm">
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {dict.settings.accountCreatePreviewLabel}
          </span>
          <div
            className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-3 py-1 text-xs text-foreground"
            data-testid="account-create-preview-chip"
          >
            {previewLabel}
          </div>
        </div>

        {errorMessage ? (
          <p
            className="text-xs text-rose-500"
            data-testid="account-create-error"
          >
            {errorMessage}
          </p>
        ) : null}

        {successMessage ? (
          <p
            className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700"
            data-testid="account-create-success"
          >
            {successMessage}
          </p>
        ) : null}

        <div className="flex flex-wrap justify-between gap-2">
          <div>
            {step !== "market" ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep(step === "review" ? "details" : "market")}
                data-testid="account-create-back"
              >
                {dict.settings.accountCreateBack}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            {step !== "review" ? (
              <Button
                type="button"
                disabled={disabled || (step === "details" && !canContinueFromDetails())}
                onClick={() => setStep(step === "market" ? "details" : "review")}
                data-testid="account-create-continue"
              >
                {dict.settings.accountCreateContinue}
              </Button>
            ) : (
              <Button
                type="submit"
                disabled={submitDisabled}
                data-testid="account-create-submit"
              >
                {dict.settings.accountCreateSubmit}
              </Button>
            )}
          </div>
        </div>
      </form>
    </section>
  );
}
