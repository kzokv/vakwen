"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Pencil, Plus, RotateCcw, Search, Trash2, X } from "lucide-react";
import type {
  AccountDefaultCurrency,
  AccountDto,
  AccountLifecycleMutationResponseDto,
  AccountType,
  LocaleCode,
  MarketCode,
} from "@vakwen/shared-types";
import type { AppDictionary } from "../../../lib/i18n";
import { Button } from "../../../components/ui/Button";
import { fieldClassName } from "../../../components/ui/fieldStyles";
import { getCurrencyOptions } from "../../../lib/currencies";
import { fromZhFoldValue, toZhFoldValue } from "../services/commissionDiscount";
import { useEventStream } from "../../../hooks/useEventStream";
import { AccountSoftDeleteModal, type AccountSoftDeleteWarnings } from "./AccountSoftDeleteModal";
import { AccountPermanentDeleteModal } from "./AccountPermanentDeleteModal";
import { AccountDividendSettingsSection } from "./AccountDividendSettingsSection";
import {
  fetchSoftDeletedAccounts,
  permanentlyDeleteAccount,
  restoreAccount,
  softDeleteAccount,
  type SoftDeletedAccountDto,
} from "../services/accountLifecycleService";
import type {
  SettingsAccountBindingModel,
  SettingsProfileModel,
  SettingsSecurityBindingModel,
} from "../types/settingsUi";

/**
 * KZO-183: per-account expandable cards. Each card replaces the
 * legacy `FeeProfilesSection` + `SecurityBindingsSection` for a single
 * account — fee profiles, default-profile selector, "Duplicate from
 * another account" CTA, and per-symbol overrides all live inline.
 *
 * Search input above the cards filters by profile-name substring; cards
 * with hits stay expanded, misses collapse. Empty input → all cards
 * default to collapsed.
 */
interface AccountsListSectionProps {
  accounts: AccountDto[];
  /**
   * KZO-183: per-account draft entries from the settings form (one per account,
   * carrying the editable `feeProfileId` for the default-profile selector).
   * Renamed from `bindings` (SettingsAccountBindingModel naming was misleading
   * — these are account drafts, not fee-profile-bindings).
   */
  accountDrafts: SettingsAccountBindingModel[];
  profiles: SettingsProfileModel[];
  feeProfileBindings: SettingsSecurityBindingModel[];
  activeLocale: LocaleCode;
  onUpdateAccountProfile: (accountId: string, feeProfileId: string) => void;
  onSaveAccountProfile?: (accountId: string, feeProfileId: string) => Promise<void>;
  onUpdateAccountType?: (accountId: string, accountType: AccountType) => void;
  onSaveAccountType?: (accountId: string, accountType: AccountType) => Promise<void>;
  onRenameAccount: (accountId: string, name: string) => Promise<void>;
  onAddProfileForAccount: (accountId: string) => void;
  onUpdateProfileField: (
    profileId: string,
    key: keyof SettingsProfileModel,
    value: string | number,
  ) => void;
  onSaveProfile: (profileId: string) => Promise<void>;
  onRemoveProfileFromAccount: (accountId: string, profileId: string) => void;
  onDuplicateProfilesFromAccount: (
    sourceAccountId: string,
    targetAccountId: string,
    profileIds: string[],
    sourceAccountName?: string,
  ) => void;
  onAddBinding: (accountId: string) => void;
  onUpdateBinding: (
    index: number,
    patch: Partial<SettingsSecurityBindingModel>,
  ) => void;
  onRemoveBinding: (index: number) => void;
  /**
   * ui-enhancement (2026-05-13) — optional per-account warning signals
   * surfaced inside the soft-delete confirmation modal. Caller computes
   * from dashboard holdings / cash balances. When absent the modal still
   * fires the `isLastActiveAccount` warning (computed from `accounts`).
   */
  accountWarnings?: Record<
    string,
    { hasOpenPositions?: boolean; hasNonZeroCash?: boolean }
  >;
  /**
   * ui-enhancement — refresh parent-owned dashboard state after any
   * soft-delete / restore / permanent-delete completes. Optional so
   * existing test fixtures stay compatible.
   */
  onAccountsChanged?: () => void;
  onLifecycleMutation?: (
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => void;
  /**
   * ui-enhancement (2026-05-14) — admin-tunable grace period (in days)
   * for the soft-delete → hard-purge cron. Threaded from the API's
   * effective-settings DTO (`effectiveAccountHardPurgeDays`). Drives the
   * Recently-deleted countdown AND the header copy. Defaults to 30 so
   * the UI works when the field is absent (e.g. legacy DTO shapes or
   * pre-merge backend versions).
   */
  effectiveAccountHardPurgeDays?: number;
  dict: AppDictionary;
  canManage?: boolean;
  allowHardPurge?: boolean;
  focusedDividendSettings?: { accountId: string; marketCode: MarketCode } | null;
  highlightedAccountId?: string | null;
}

const PROFILE_FIELDS: ReadonlyArray<{
  key: keyof SettingsProfileModel;
  label: keyof AppDictionary["settings"];
  min?: number;
  step?: number;
}> = [
  { key: "boardCommissionRate", label: "profileCommissionLabel", min: 0, step: 0.001 },
  { key: "minimumCommissionAmount", label: "profileMinimumCommissionLabel", min: 0 },
  { key: "stockSellTaxRateBps", label: "profileStockTaxLabel", min: 0 },
  { key: "stockDayTradeTaxRateBps", label: "profileDayTradeTaxLabel", min: 0 },
  { key: "etfSellTaxRateBps", label: "profileEtfTaxLabel", min: 0 },
  { key: "bondEtfSellTaxRateBps", label: "profileBondEtfTaxLabel", min: 0 },
];

/**
 * KZO-183: derive the market badge label from the account's default
 * currency. Mirrors the planned `marketCodeFor` helper landing in
 * shared-types via backend B1.
 */
function marketBadgeLabel(
  currency: AccountDefaultCurrency,
  dict: AppDictionary,
): string {
  switch (currency) {
    case "TWD": return dict.settings.accountsListMarketBadgeTW;
    case "USD": return dict.settings.accountsListMarketBadgeUS;
    case "AUD": return dict.settings.accountsListMarketBadgeAU;
    case "KRW": return dict.settings.accountsListMarketBadgeKR;
    case "JPY": return dict.settings.accountsListMarketBadgeJP;
  }
}

function marketBadgeColorClass(currency: AccountDefaultCurrency): string {
  switch (currency) {
    case "TWD": return "bg-emerald-50 text-emerald-700";
    case "USD": return "bg-indigo-50 text-indigo-700";
    case "AUD": return "bg-rose-50 text-rose-700";
    case "KRW": return "bg-amber-50 text-amber-700";
    case "JPY": return "bg-slate-50 text-slate-700";
  }
}

function marketCodeForAccount(currency: AccountDefaultCurrency): MarketCode {
  switch (currency) {
    case "TWD": return "TW";
    case "USD": return "US";
    case "AUD": return "AU";
    case "KRW": return "KR";
    case "JPY": return "JP";
  }
}

function accountTypeLabel(account: AccountDto, dict: AppDictionary): string {
  switch (account.accountType) {
    case "broker": return dict.settings.accountsListAccountTypeBroker;
    case "bank": return dict.settings.accountsListAccountTypeBank;
    case "wallet": return dict.settings.accountsListAccountTypeWallet;
  }
}

function formatAccountSummary(
  account: AccountDto,
  profileCount: number,
  dict: AppDictionary,
): string {
  return dict.settings.accountsListAccountSummary
    .replace("{type}", accountTypeLabel(account, dict))
    .replace("{currency}", account.defaultCurrency)
    .replace("{profileCount}", String(profileCount));
}

export function AccountsListSection({
  accounts,
  accountDrafts,
  profiles,
  feeProfileBindings,
  activeLocale,
  onUpdateAccountProfile,
  onSaveAccountProfile = async () => undefined,
  onUpdateAccountType = () => undefined,
  onSaveAccountType = async () => undefined,
  onRenameAccount,
  onAddProfileForAccount,
  onUpdateProfileField,
  onSaveProfile,
  onRemoveProfileFromAccount,
  onDuplicateProfilesFromAccount,
  onAddBinding,
  onUpdateBinding,
  onRemoveBinding,
  accountWarnings,
  onAccountsChanged,
  onLifecycleMutation,
  effectiveAccountHardPurgeDays = 30,
  dict,
  canManage = true,
  allowHardPurge = true,
  focusedDividendSettings = null,
  highlightedAccountId = null,
}: AccountsListSectionProps) {
  // Rename UI state.
  const [editingAccountId, setEditingAccountId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [renameOverrides, setRenameOverrides] = useState<Record<string, string>>({});
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);
  const [savingAccountTypeIds, setSavingAccountTypeIds] = useState<Set<string>>(() => new Set());
  const [renameError, setRenameError] = useState("");
  const [accountErrorById, setAccountErrorById] = useState<Record<string, string>>({});

  // Expand state — keys are accountIds. Search overrides the user-driven
  // expand state (cards with hits force-expand; misses force-collapse).
  const [manualExpanded, setManualExpanded] = useState<Record<string, boolean>>({});

  // Profile editor state — only one profile per account is open at a time.
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [profileErrorById, setProfileErrorById] = useState<Record<string, string>>({});

  // Search input.
  const [searchInput, setSearchInput] = useState("");
  const search = searchInput.trim().toLowerCase();

  // Duplicate-picker state.
  const [duplicateTargetAccountId, setDuplicateTargetAccountId] = useState<string | null>(null);
  const [duplicateSourceAccountId, setDuplicateSourceAccountId] = useState<string>("");
  const [duplicateSelected, setDuplicateSelected] = useState<Set<string>>(new Set());

  // ui-enhancement (2026-05-13) — soft-delete + permanent-delete modal state.
  // `softDeleteTargetAccount` is the row the user opted to delete (active
  // account); `permanentDeleteTargetAccount` covers BOTH the
  // "Permanently delete now" CTA from an active row and the per-row
  // "Permanently delete now" CTA in the Recently-deleted subsection.
  const [softDeleteTargetAccount, setSoftDeleteTargetAccount] = useState<AccountDto | null>(null);
  const [softDeleteBusy, setSoftDeleteBusy] = useState(false);
  const [softDeleteError, setSoftDeleteError] = useState<string | undefined>(undefined);
  const [permanentDeleteTargetAccount, setPermanentDeleteTargetAccount] = useState<AccountDto | null>(null);
  const [permanentDeleteBusy, setPermanentDeleteBusy] = useState(false);
  const [permanentDeleteError, setPermanentDeleteError] = useState<string | undefined>(undefined);

  // ui-enhancement — recently-deleted list. Always-on SSE per
  // `.claude/rules/react-useEventStream-preconnect-pattern.md` ensures
  // events arriving immediately after the mutation are captured. The
  // refetch is debounced via a small in-flight guard.
  const [softDeletedAccounts, setSoftDeletedAccounts] = useState<SoftDeletedAccountDto[]>([]);
  const [restoreBusyById, setRestoreBusyById] = useState<Record<string, boolean>>({});

  const refreshSoftDeleted = useCallback(async () => {
    try {
      const rows = await fetchSoftDeletedAccounts();
      setSoftDeletedAccounts(rows);
    } catch {
      // Non-fatal — leave the list as-is. Toast/error UI surfaces are out
      // of scope for the initial slice; a follow-up can wire a banner.
    }
  }, []);

  useEffect(() => {
    void refreshSoftDeleted();
  }, [refreshSoftDeleted]);

  useEventStream({
    eventTypes: [
      "account_soft_deleted",
      "account_restored",
      "account_hard_purged",
    ],
    onEvent: () => {
      void refreshSoftDeleted();
    },
    enabled: true,
  });

  const accountNames = useMemo(
    () =>
      new Map(
        accounts.map((account) => [
          account.id,
          renameOverrides[account.id] ?? account.name,
        ]),
      ),
    [accounts, renameOverrides],
  );

  const profilesByAccount = useMemo(() => {
    const result = new Map<string, SettingsProfileModel[]>();
    for (const account of accounts) {
      result.set(account.id, []);
    }
    for (const profile of profiles) {
      const list = result.get(profile.accountId);
      if (list) list.push(profile);
    }
    return result;
  }, [accounts, profiles]);

  const matchedAccountIds = useMemo(() => {
    if (search.length === 0) return new Set<string>();
    const matched = new Set<string>();
    for (const account of accounts) {
      const haystacks = [
        (accountNames.get(account.id) ?? account.name).toLowerCase(),
        marketBadgeLabel(account.defaultCurrency, dict).toLowerCase(),
        account.defaultCurrency.toLowerCase(),
        accountTypeLabel(account, dict).toLowerCase(),
      ];
      if (haystacks.some((value) => value.includes(search))) {
        matched.add(account.id);
        continue;
      }
      for (const profile of profilesByAccount.get(account.id) ?? []) {
        if (profile.name.toLowerCase().includes(search)) {
          matched.add(account.id);
          break;
        }
      }
    }
    return matched;
  }, [accountNames, accounts, dict, profilesByAccount, search]);

  useEffect(() => {
    if (!focusedDividendSettings) return;
    const targetAccount = accounts.find((account) => account.id === focusedDividendSettings.accountId);
    if (!targetAccount || marketCodeForAccount(targetAccount.defaultCurrency) !== focusedDividendSettings.marketCode) return;
    setManualExpanded((current) => current[targetAccount.id]
      ? current
      : { ...current, [targetAccount.id]: true });
  }, [accounts, focusedDividendSettings]);

  // KZO-183 scope decision 27 + design E5: search filters EXPANSION state, not
  // visibility. All cards remain visible; matches expand, misses collapse.

  function expandedFor(accountId: string): boolean {
    if (search.length > 0) return matchedAccountIds.has(accountId);
    return manualExpanded[accountId] ?? false;
  }

  function toggleExpand(accountId: string) {
    if (search.length > 0) return; // search drives expand state
    setManualExpanded((current) => ({
      ...current,
      [accountId]: !(current[accountId] ?? false),
    }));
  }

  function startRename(account: AccountDto) {
    setRenameError("");
    setEditingAccountId(account.id);
    setDraftName(accountNames.get(account.id) ?? account.name);
  }

  function cancelRename(accountId: string) {
    setRenameError("");
    setEditingAccountId((current) => (current === accountId ? null : current));
    setDraftName("");
  }

  async function saveRename(accountId: string) {
    const trimmedName = draftName.trim();
    if (!trimmedName) return;

    setSavingAccountId(accountId);
    setRenameError("");
    try {
      await onRenameAccount(accountId, trimmedName);
      setRenameOverrides((current) => ({ ...current, [accountId]: trimmedName }));
      setEditingAccountId(null);
      setDraftName("");
    } catch {
      setRenameError(dict.settings.accountRenameError);
    } finally {
      setSavingAccountId(null);
    }
  }

  async function saveDefaultProfile(accountId: string, feeProfileId: string) {
    setAccountErrorById((current) => ({ ...current, [accountId]: "" }));
    try {
      await onSaveAccountProfile(accountId, feeProfileId);
    } catch {
      setAccountErrorById((current) => ({
        ...current,
        [accountId]: dict.settings.accountsListAccountUpdateError,
      }));
    }
  }

  async function saveAccountTypeChange(
    accountId: string,
    accountType: AccountType,
    previousAccountType: AccountType,
  ) {
    setSavingAccountTypeIds((current) => new Set(current).add(accountId));
    setAccountErrorById((current) => ({ ...current, [accountId]: "" }));
    try {
      await onSaveAccountType(accountId, accountType);
    } catch {
      onUpdateAccountType(accountId, previousAccountType);
      setAccountErrorById((current) => ({
        ...current,
        [accountId]: dict.settings.accountsListAccountUpdateError,
      }));
    } finally {
      setSavingAccountTypeIds((current) => {
        const next = new Set(current);
        next.delete(accountId);
        return next;
      });
    }
  }

  async function saveProfileEdit(profileId: string) {
    setSavingProfileId(profileId);
    setProfileErrorById((current) => ({ ...current, [profileId]: "" }));
    try {
      await onSaveProfile(profileId);
      setEditingProfileId((current) => (current === profileId ? null : current));
    } catch {
      setProfileErrorById((current) => ({
        ...current,
        [profileId]: dict.settings.accountsListProfileSaveError,
      }));
    } finally {
      setSavingProfileId((current) => (current === profileId ? null : current));
    }
  }

  function openDuplicatePicker(targetAccountId: string) {
    const fallbackSource = accounts.find((account) => account.id !== targetAccountId)?.id ?? "";
    setDuplicateTargetAccountId(targetAccountId);
    setDuplicateSourceAccountId(fallbackSource);
    setDuplicateSelected(new Set());
  }

  function closeDuplicatePicker() {
    setDuplicateTargetAccountId(null);
    setDuplicateSourceAccountId("");
    setDuplicateSelected(new Set());
  }

  function toggleDuplicateSelection(profileId: string) {
    setDuplicateSelected((current) => {
      const next = new Set(current);
      if (next.has(profileId)) next.delete(profileId);
      else next.add(profileId);
      return next;
    });
  }

  function confirmDuplicate() {
    if (
      duplicateTargetAccountId === null
      || duplicateSourceAccountId === ""
      || duplicateSelected.size === 0
    ) {
      return;
    }
    const sourceAccount = accounts.find((account) => account.id === duplicateSourceAccountId);
    onDuplicateProfilesFromAccount(
      duplicateSourceAccountId,
      duplicateTargetAccountId,
      Array.from(duplicateSelected),
      sourceAccount ? (renameOverrides[sourceAccount.id] ?? sourceAccount.name) : undefined,
    );
    closeDuplicatePicker();
  }

  // KZO-183: when the duplicate picker is open and the user changes the
  // source account, drop any selected profile ids that are no longer owned
  // by the new source so the list view stays consistent.
  useEffect(() => {
    if (duplicateTargetAccountId === null) return;
    const validIds = new Set(
      profiles
        .filter((profile) => profile.accountId === duplicateSourceAccountId)
        .map((profile) => profile.id),
    );
    setDuplicateSelected((current) => {
      const next = new Set<string>();
      for (const id of current) {
        if (validIds.has(id)) next.add(id);
      }
      return next;
    });
  }, [duplicateSourceAccountId, duplicateTargetAccountId, profiles]);

  const isTraditionalChinese = activeLocale === "zh-TW";

  // ui-enhancement — soft-delete entry point. Active-row Delete button →
  // open the soft-delete modal pre-populated with the row's warnings.
  function openSoftDeleteModal(account: AccountDto) {
    setSoftDeleteError(undefined);
    setSoftDeleteTargetAccount(account);
  }

  function closeSoftDeleteModal() {
    if (softDeleteBusy) return;
    setSoftDeleteTargetAccount(null);
    setSoftDeleteError(undefined);
  }

  async function handleSoftDeleteConfirm() {
    if (!softDeleteTargetAccount) return;
    setSoftDeleteBusy(true);
    setSoftDeleteError(undefined);
    try {
      const response = await softDeleteAccount(softDeleteTargetAccount.id);
      setSoftDeleteTargetAccount(null);
      void refreshSoftDeleted();
      if (onLifecycleMutation) onLifecycleMutation(response, "soft_delete");
      else onAccountsChanged?.();
    } catch {
      setSoftDeleteError(dict.settings.accountsDeleteError);
    } finally {
      setSoftDeleteBusy(false);
    }
  }

  function openPermanentDeleteModal(account: AccountDto) {
    setPermanentDeleteError(undefined);
    setPermanentDeleteTargetAccount(account);
  }

  function closePermanentDeleteModal() {
    if (permanentDeleteBusy) return;
    setPermanentDeleteTargetAccount(null);
    setPermanentDeleteError(undefined);
  }

  async function handlePermanentDeleteConfirm(typedName: string) {
    if (!permanentDeleteTargetAccount) return;
    setPermanentDeleteBusy(true);
    setPermanentDeleteError(undefined);
    try {
      const response = await permanentlyDeleteAccount(
        permanentDeleteTargetAccount.id,
        typedName,
      );
      setPermanentDeleteTargetAccount(null);
      void refreshSoftDeleted();
      if (onLifecycleMutation) onLifecycleMutation(response, "hard_purge");
      else onAccountsChanged?.();
    } catch {
      setPermanentDeleteError(dict.settings.accountsPurgeError);
    } finally {
      setPermanentDeleteBusy(false);
    }
  }

  async function handleRestore(accountId: string) {
    setRestoreBusyById((current) => ({ ...current, [accountId]: true }));
    try {
      const response = await restoreAccount(accountId);
      void refreshSoftDeleted();
      if (onLifecycleMutation) onLifecycleMutation(response, "restore");
      else onAccountsChanged?.();
    } catch {
      // Inline error per row is out of scope for the initial slice —
      // the SSE refetch will keep the list state truthful; a banner is
      // a follow-up. Leaving the row busy=false on error preserves the
      // current best-effort UX.
    } finally {
      setRestoreBusyById((current) => {
        const next = { ...current };
        delete next[accountId];
        return next;
      });
    }
  }

  function computeWarningsFor(account: AccountDto): AccountSoftDeleteWarnings {
    const hint = accountWarnings?.[account.id];
    return {
      hasOpenPositions: hint?.hasOpenPositions ?? false,
      hasNonZeroCash: hint?.hasNonZeroCash ?? false,
      isLastActiveAccount: accounts.length === 1,
    };
  }

  function timeRemainingDays(deletedAt: string): number {
    const deletedMs = Date.parse(deletedAt);
    if (Number.isNaN(deletedMs)) return effectiveAccountHardPurgeDays;
    const elapsedMs = Date.now() - deletedMs;
    const remainingMs = effectiveAccountHardPurgeDays * 24 * 60 * 60 * 1000 - elapsedMs;
    return Math.max(0, Math.ceil(remainingMs / (24 * 60 * 60 * 1000)));
  }

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <div className="space-y-1">
        <h3 className="text-lg font-semibold text-foreground">{dict.settings.accountsListSectionTitle}</h3>
        <p className="text-xs text-muted-foreground">{dict.settings.accountsListSectionDescription}</p>
      </div>

      {!canManage ? (
        <div
          className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground"
          data-testid="accounts-shared-readonly-note"
        >
          {dict.switcher.readonlyDescription}
        </div>
      ) : null}

      {/* KZO-183 E5 — top-of-tab search input. */}
      <div className="space-y-1">
        <label
          htmlFor="accounts-tab-search"
          className="block text-xs font-medium text-muted-foreground"
        >
          {dict.settings.accountsTabSearchLabel}
        </label>
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id="accounts-tab-search"
            type="text"
            value={searchInput}
            onChange={(event) => {
              const next = event.target.value;
              // KZO-183 scope item 27: clearing the search returns all cards to
              // their default collapsed state (don't carry pre-search manual
              // expansions back into the post-clear view).
              if (next.trim().length === 0) {
                setManualExpanded({});
              }
              setSearchInput(next);
            }}
            placeholder={dict.settings.accountsTabSearchPlaceholder}
            className={`${fieldClassName} pl-9`}
            data-testid="accounts-tab-search"
            disabled={!canManage}
          />
        </div>
      </div>

      {renameError ? <p className="text-xs text-rose-500">{renameError}</p> : null}

      <div className="space-y-3">
        {accounts.map((account) => {
          const draftAccount = accountDrafts.find((item) => item.id === account.id);
          const ownedProfiles = profilesByAccount.get(account.id) ?? [];
          const ownedProfileIds = new Set(ownedProfiles.map((profile) => profile.id));
          const expanded = expandedFor(account.id);
          const displayName = accountNames.get(account.id) ?? account.name;
          const isEditing = editingAccountId === account.id;
          const isSaving = savingAccountId === account.id;
          const disableRenameSave = draftName.trim().length === 0 || isSaving;
          const accountTypeValue = (
            draftAccount as SettingsAccountBindingModel & { accountType?: AccountType } | undefined
          )?.accountType ?? account.accountType;

          // Per-account overrides — `feeProfileBindings` carries flat (idx, accountId,
          // ticker, feeProfileId). We render only those that belong to this account
          // and pass the index into the legacy `onUpdateBinding`/`onRemoveBinding`
          // surface (which operates on the flat array).
          const accountOverrides = feeProfileBindings
            .map((binding, index) => ({ binding, index }))
            .filter((entry) => entry.binding.accountId === account.id);

          return (
            <article
              key={account.id}
              className={[
                "rounded-lg border bg-card transition-colors",
                highlightedAccountId === account.id
                  ? "border-emerald-300 ring-1 ring-emerald-200"
                  : "border-border",
              ].join(" ")}
              data-testid={`accounts-card-${account.id}`}
            >
              {/* Header */}
              <div className="flex items-center gap-3 border-b border-border px-4 py-3">
                <button
                  type="button"
                  onClick={() => toggleExpand(account.id)}
                  className="text-muted-foreground transition hover:text-foreground"
                  aria-label={
                    expanded
                      ? dict.settings.accountsListCollapseLabel
                      : dict.settings.accountsListExpandLabel
                  }
                  aria-expanded={expanded}
                  data-testid={`accounts-card-${account.id}-toggle`}
                >
                  {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>

                <div className="flex-1 min-w-0">
                  {isEditing ? (
                    <div className="space-y-2">
                      <input
                        value={draftName}
                        onChange={(event) => setDraftName(event.target.value)}
                        className={fieldClassName}
                        placeholder={dict.settings.accountRenamePlaceholder}
                        data-testid="account-name-input"
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => void saveRename(account.id)}
                          disabled={disableRenameSave}
                          data-testid="account-rename-save"
                        >
                          {dict.settings.accountRenameSave}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => cancelRename(account.id)}
                          data-testid="account-rename-cancel"
                        >
                          {dict.actions.cancel}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="font-medium text-foreground"
                          data-testid="account-name-label"
                        >
                          {displayName}
                        </span>
                        <span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                          {accountTypeLabel(account, dict)}
                        </span>
                        <span
                          className={`rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold tracking-wider ${marketBadgeColorClass(account.defaultCurrency)}`}
                          data-testid={`accounts-card-${account.id}-market-badge`}
                        >
                          {marketBadgeLabel(account.defaultCurrency, dict)}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground">
                        {formatAccountSummary(account, ownedProfiles.length, dict)}
                      </p>
                    </div>
                  )}
                </div>

                {!isEditing ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => startRename(account)}
                      className="rounded-full border border-border p-2 text-muted-foreground transition hover:border-foreground/30 hover:text-foreground"
                      data-testid="account-rename-icon"
                      aria-label={dict.settings.accountRenameIconLabel}
                      disabled={!canManage}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    {/* ui-enhancement (2026-05-13) — Delete account button.
                        Opens the soft-delete confirmation modal. */}
                    <button
                      type="button"
                      onClick={() => openSoftDeleteModal(account)}
                      className="rounded-full border border-border p-2 text-muted-foreground transition hover:border-rose-300/40 hover:bg-rose-500/15 hover:text-rose-600"
                      data-testid={`account-delete-btn-${account.id}`}
                      aria-label={dict.settings.accountsDeleteBtn}
                      disabled={!canManage}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ) : null}
              </div>

              {expanded ? (
                <div className="space-y-4 px-4 py-4">
                  <AccountDividendSettingsSection
                    accountId={account.id}
                    marketCode={marketCodeForAccount(account.defaultCurrency)}
                    canManage={canManage}
                    dict={dict}
                    focused={
                      focusedDividendSettings?.accountId === account.id
                      && focusedDividendSettings.marketCode === marketCodeForAccount(account.defaultCurrency)
                    }
                  />

                  {/* Default fee profile selector (scoped to this account's profiles). */}
                  <div className="space-y-1">
                    <label className="block text-xs text-muted-foreground">
                      {dict.settings.accountsListDefaultProfileLabel}
                    </label>
                    <select
                      value={
                        draftAccount && ownedProfileIds.has(draftAccount.feeProfileId)
                          ? draftAccount.feeProfileId
                          : ""
                      }
                      onChange={(event) => onUpdateAccountProfile(account.id, event.target.value)}
                      className={fieldClassName}
                      data-testid={`settings-account-profile-${account.id}`}
                      disabled={!canManage}
                      onBlur={(event) => {
                        const selected = event.currentTarget.value;
                        if (selected) {
                          void saveDefaultProfile(account.id, selected);
                        }
                      }}
                    >
                      {ownedProfiles.length === 0 ? (
                        <option value="">{dict.settings.accountsListNoProfilesYet}</option>
                      ) : null}
                      {ownedProfiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[10px] text-muted-foreground">
                      {dict.settings.accountsListDefaultProfileHint}
                    </p>
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs text-muted-foreground" htmlFor={`settings-account-type-${account.id}`}>
                      {dict.settings.accountsListAccountTypeLabel}
                    </label>
                    <select
                      id={`settings-account-type-${account.id}`}
                      value={accountTypeValue}
                      onChange={(event) => {
                        const nextType = event.target.value as AccountType;
                        onUpdateAccountType(account.id, nextType);
                        void saveAccountTypeChange(account.id, nextType, accountTypeValue);
                      }}
                      className={fieldClassName}
                      data-testid={`settings-account-type-${account.id}`}
                      disabled={!canManage || savingAccountTypeIds.has(account.id)}
                    >
                      <option value="broker">{dict.settings.accountsListAccountTypeBroker}</option>
                      <option value="bank">{dict.settings.accountsListAccountTypeBank}</option>
                      <option value="wallet">{dict.settings.accountsListAccountTypeWallet}</option>
                    </select>
                  </div>

                  {accountErrorById[account.id] ? (
                    <p
                      className="text-xs text-rose-500"
                      data-testid={`accounts-card-${account.id}-account-error`}
                    >
                      {accountErrorById[account.id]}
                    </p>
                  ) : null}

                  {/* Inline fee profiles list. */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {dict.settings.accountsListProfilesSectionLabel}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => onAddProfileForAccount(account.id)}
                          data-testid={`accounts-card-${account.id}-add-profile`}
                          disabled={!canManage}
                        >
                          <Plus className="mr-1 h-3.5 w-3.5" />
                          {dict.settings.accountsListAddProfile}
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="secondary"
                          onClick={() => openDuplicatePicker(account.id)}
                          data-testid={`accounts-card-${account.id}-duplicate-cta`}
                          disabled={!canManage || accounts.length < 2}
                        >
                          <Copy className="mr-1 h-3.5 w-3.5" />
                          {dict.settings.accountsListDuplicateFromAnotherCta}
                        </Button>
                      </div>
                    </div>

                    {ownedProfiles.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border bg-muted px-3 py-3 text-xs text-muted-foreground">
                        {dict.settings.accountsListNoProfilesYet}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {ownedProfiles.map((profile) => {
                          const isProfileEditing = editingProfileId === profile.id;
                          return (
                            <div
                              key={profile.id}
                              className="rounded-md border border-border bg-muted/50 px-3 py-2"
                              data-testid={`accounts-card-${account.id}-profile-${profile.id}`}
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p
                                    className="text-sm font-medium text-foreground truncate"
                                    data-testid={`accounts-profile-name-${profile.id}`}
                                  >
                                    {profile.name || dict.settings.accountsListProfileSummaryFallback}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground">
                                    {`${profile.boardCommissionRate}‰ commission · ${profile.commissionCurrency}`}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setEditingProfileId(isProfileEditing ? null : profile.id)
                                    }
                                    aria-label={dict.settings.accountsListEditProfileLabel}
                                    className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                                    data-testid={`accounts-profile-edit-${profile.id}`}
                                    disabled={!canManage}
                                  >
                                    <Pencil className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRemoveProfileFromAccount(account.id, profile.id)}
                                    aria-label={dict.settings.accountsListDeleteProfileLabel}
                                    className="rounded p-1 text-muted-foreground transition hover:bg-rose-500/15 hover:text-rose-600"
                                    data-testid={`accounts-profile-remove-${profile.id}`}
                                    disabled={!canManage || ownedProfiles.length <= 1}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>

                              {isProfileEditing ? (
                                <div className="mt-3 grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
                                  <label className="space-y-2 text-xs text-muted-foreground">
                                    {dict.settings.profileNameLabel}
                                    <input
                                      value={profile.name}
                                      onChange={(event) =>
                                        onUpdateProfileField(profile.id, "name", event.target.value)
                                      }
                                      className={fieldClassName}
                                      data-testid={`accounts-profile-name-input-${profile.id}`}
                                      disabled={!canManage}
                                    />
                                  </label>

                                  <label className="space-y-2 text-xs text-muted-foreground">
                                    <span>{dict.settings.profileDiscountLabel}</span>
                                    <input
                                      type="number"
                                      min={0}
                                      max={isTraditionalChinese ? 10 : 100}
                                      step={0.01}
                                      value={
                                        isTraditionalChinese
                                          ? toZhFoldValue(profile.commissionDiscountPercent)
                                          : profile.commissionDiscountPercent
                                      }
                                      onChange={(event) => {
                                        const nextValue = Number(event.target.value) || 0;
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionDiscountPercent",
                                          isTraditionalChinese ? fromZhFoldValue(nextValue) : nextValue,
                                        );
                                      }}
                                      className={fieldClassName}
                                      data-testid={`accounts-profile-discount-${profile.id}`}
                                      disabled={!canManage}
                                    />
                                    <p className="text-[11px] text-muted-foreground">
                                      {dict.settings.profileDiscountHint}
                                    </p>
                                  </label>

                                  {PROFILE_FIELDS.map((field) => (
                                    <label
                                      key={field.key}
                                      className="space-y-2 text-xs text-muted-foreground"
                                    >
                                      {dict.settings[field.label]}
                                      <input
                                        type="number"
                                        min={field.min}
                                        step={field.step}
                                        value={profile[field.key] as number}
                                        onChange={(event) =>
                                          onUpdateProfileField(
                                            profile.id,
                                            field.key,
                                            Number(event.target.value) || 0,
                                          )
                                        }
                                        className={fieldClassName}
                                        disabled={!canManage}
                                      />
                                    </label>
                                  ))}

                                  <label className="space-y-2 text-xs text-muted-foreground">
                                    {dict.settings.profileCommissionCurrencyLabel}
                                    <select
                                      value={profile.commissionCurrency}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionCurrency",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                      disabled={!canManage}
                                    >
                                      {getCurrencyOptions([profile.commissionCurrency]).map(
                                        (currency) => (
                                          <option key={currency} value={currency}>
                                            {currency}
                                          </option>
                                        ),
                                      )}
                                    </select>
                                  </label>

                                  <label className="space-y-2 text-xs text-muted-foreground">
                                    {dict.settings.profileCommissionRoundLabel}
                                    <select
                                      value={profile.commissionRoundingMode}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionRoundingMode",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                      disabled={!canManage}
                                    >
                                      <option value="FLOOR">FLOOR</option>
                                      <option value="ROUND">ROUND</option>
                                      <option value="CEIL">CEIL</option>
                                    </select>
                                  </label>

                                  <label className="space-y-2 text-xs text-muted-foreground">
                                    {dict.settings.profileTaxRoundLabel}
                                    <select
                                      value={profile.taxRoundingMode}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "taxRoundingMode",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                      disabled={!canManage}
                                    >
                                      <option value="FLOOR">FLOOR</option>
                                      <option value="ROUND">ROUND</option>
                                      <option value="CEIL">CEIL</option>
                                    </select>
                                  </label>

                                  <label className="space-y-2 text-xs text-muted-foreground">
                                    {dict.settings.profileChargeModeLabel}
                                    <select
                                      value={profile.commissionChargeMode}
                                      onChange={(event) =>
                                        onUpdateProfileField(
                                          profile.id,
                                          "commissionChargeMode",
                                          event.target.value,
                                        )
                                      }
                                      className={fieldClassName}
                                      data-testid={`accounts-profile-charge-mode-${profile.id}`}
                                      disabled={!canManage}
                                    >
                                      <option value="CHARGED_UPFRONT">CHARGED_UPFRONT</option>
                                      <option value="CHARGED_UPFRONT_REBATED_LATER">
                                        CHARGED_UPFRONT_REBATED_LATER
                                      </option>
                                    </select>
                                  </label>
                                </div>
                              ) : null}

                              {isProfileEditing && profileErrorById[profile.id] ? (
                                <p
                                  className="mt-3 text-xs text-rose-600"
                                  data-testid={`accounts-profile-error-${profile.id}`}
                                >
                                  {profileErrorById[profile.id]}
                                </p>
                              ) : null}

                              {isProfileEditing ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    onClick={() => void saveProfileEdit(profile.id)}
                                    data-testid={`accounts-profile-edit-done-${profile.id}`}
                                    disabled={!canManage || savingProfileId === profile.id}
                                  >
                                    {savingProfileId === profile.id ? dict.actions.submitting : dict.settings.accountsListSaveProfileEdit}
                                  </Button>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => setEditingProfileId(null)}
                                    disabled={!canManage || savingProfileId === profile.id}
                                  >
                                    {dict.settings.accountsListCancelProfileEdit}
                                  </Button>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Per-symbol overrides. */}
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {dict.settings.accountsListOverridesSectionLabel}
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => onAddBinding(account.id)}
                        data-testid={`accounts-card-${account.id}-add-override`}
                        disabled={!canManage || ownedProfiles.length === 0}
                      >
                        <Plus className="mr-1 h-3.5 w-3.5" />
                        {dict.settings.accountsListAddOverride}
                      </Button>
                    </div>

                    {accountOverrides.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border bg-muted px-3 py-3 text-xs text-muted-foreground">
                        {dict.settings.accountsListOverridesEmptyState}
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {accountOverrides.map(({ binding, index }) => (
                          <div
                            key={`${binding.accountId}-${binding.ticker}-${index}`}
                            className="grid items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 lg:grid-cols-[140px_1fr_auto]"
                            data-testid={`accounts-override-row-${index}`}
                          >
                            <input
                              value={binding.ticker}
                              onChange={(event) =>
                                onUpdateBinding(index, {
                                  ticker: event.target.value.toUpperCase(),
                                })
                              }
                              className={fieldClassName}
                              maxLength={16}
                              placeholder={dict.settings.accountsListOverrideTickerPlaceholder}
                              data-testid={`accounts-override-ticker-${index}`}
                              disabled={!canManage}
                            />
                            <select
                              value={
                                ownedProfileIds.has(binding.feeProfileId)
                                  ? binding.feeProfileId
                                  : ""
                              }
                              onChange={(event) =>
                                onUpdateBinding(index, { feeProfileId: event.target.value })
                              }
                              className={fieldClassName}
                              data-testid={`accounts-override-profile-${index}`}
                              disabled={!canManage}
                            >
                              {ownedProfiles.length === 0 ? (
                                <option value="">{dict.settings.accountsListNoProfilesYet}</option>
                              ) : null}
                              {ownedProfiles.map((profile) => (
                                <option key={profile.id} value={profile.id}>
                                  {profile.name}
                                </option>
                              ))}
                            </select>
                            <button
                              type="button"
                              onClick={() => onRemoveBinding(index)}
                              aria-label={dict.settings.accountsListOverrideRemoveLabel}
                              className="rounded p-1 text-muted-foreground transition hover:bg-rose-500/15 hover:text-rose-600"
                              data-testid={`accounts-override-remove-${index}`}
                              disabled={!canManage}
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>

      {/* KZO-183: duplicate-from-another-account picker. Inline panel keeps the
          UX self-contained without a portal/dialog dependency; the picker is
          per-target-account. */}
      {duplicateTargetAccountId !== null ? (
        <div
          className="space-y-3 rounded-[18px] border border-indigo-300/60 bg-indigo-500/10 p-4 text-sm"
          data-testid="accounts-duplicate-picker"
        >
          <div>
            <p className="text-sm font-semibold text-indigo-100">
              {dict.settings.accountsListDuplicatePickerTitle}
            </p>
            <p className="mt-0.5 text-xs text-indigo-200/80">
              {dict.settings.accountsListDuplicatePickerDescription}
            </p>
          </div>

          <label className="block space-y-1 text-xs text-indigo-100">
            {dict.settings.accountsListDuplicatePickerSourceLabel}
            <select
              value={duplicateSourceAccountId}
              onChange={(event) => setDuplicateSourceAccountId(event.target.value)}
              className={fieldClassName}
              data-testid="accounts-duplicate-source-select"
              disabled={!canManage}
            >
              {accounts
                .filter((account) => account.id !== duplicateTargetAccountId)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {accountNames.get(account.id) ?? account.name}
                  </option>
                ))}
            </select>
          </label>

          {(() => {
            const sourceProfiles = profiles.filter(
              (profile) => profile.accountId === duplicateSourceAccountId,
            );
            if (sourceProfiles.length === 0) {
              return (
                <p className="text-xs text-indigo-100">
                  {dict.settings.accountsListDuplicatePickerEmpty}
                </p>
              );
            }
            return (
              <ul className="space-y-1" data-testid="accounts-duplicate-source-profiles">
                {sourceProfiles.map((profile) => {
                  const checked = duplicateSelected.has(profile.id);
                  return (
                    <li key={profile.id}>
                      <label className="flex items-center gap-2 text-xs text-indigo-50">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleDuplicateSelection(profile.id)}
                          data-testid={`accounts-duplicate-checkbox-${profile.id}`}
                          disabled={!canManage}
                        />
                        <span>{profile.name}</span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            );
          })()}

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={confirmDuplicate}
              disabled={!canManage || duplicateSelected.size === 0}
              data-testid="accounts-duplicate-confirm"
            >
              {dict.settings.accountsListDuplicateConfirm}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={closeDuplicatePicker}
              data-testid="accounts-duplicate-cancel"
            >
              {dict.settings.accountsListDuplicateCancel}
            </Button>
          </div>
        </div>
      ) : null}

      {/* ui-enhancement (2026-05-13) — Recently deleted (N) subsection.
          Rendered below the active accounts list. Each row shows the
          original account name, the time-remaining indicator, Restore,
          and "Permanently delete now". Empty list → section is hidden
          entirely. */}
      {softDeletedAccounts.length > 0 ? (
        <section
          className="space-y-2 rounded-lg border border-border bg-muted/30 p-4"
          data-testid="recently-deleted-section"
        >
          <header data-testid="recently-deleted-header">
            <h4 className="text-sm font-semibold text-foreground">
              {dict.settings.accountsRecentlyDeletedTitle
                .replace("{count}", String(softDeletedAccounts.length))
                .replace("{graceDays}", String(effectiveAccountHardPurgeDays))}
            </h4>
          </header>
          <ul className="space-y-2">
            {softDeletedAccounts.map((deleted) => {
              const remaining = timeRemainingDays(deleted.deletedAt);
              const restoreBusy = restoreBusyById[deleted.id] ?? false;
              return (
                <li
                  key={deleted.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2"
                  data-testid={`recently-deleted-row-${deleted.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground">{deleted.name}</p>
                    <p
                      className="text-[10px] text-muted-foreground"
                      data-testid={`recently-deleted-time-remaining-${deleted.id}`}
                    >
                      {dict.settings.accountsTimeRemaining.replace(
                        "{days}",
                        String(remaining),
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleRestore(deleted.id)}
                      disabled={!canManage || restoreBusy}
                      data-testid={`recently-deleted-restore-btn-${deleted.id}`}
                    >
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />
                      {dict.settings.accountsRestoreBtn}
                    </Button>
                    {allowHardPurge ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => openPermanentDeleteModal(deleted)}
                        data-testid={`recently-deleted-purge-btn-${deleted.id}`}
                      >
                        <Trash2 className="mr-1 h-3.5 w-3.5" />
                        {dict.settings.accountsPurgeNowBtn}
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <AccountSoftDeleteModal
        open={softDeleteTargetAccount !== null}
        account={softDeleteTargetAccount}
        warnings={
          softDeleteTargetAccount
            ? computeWarningsFor(softDeleteTargetAccount)
            : { hasOpenPositions: false, hasNonZeroCash: false, isLastActiveAccount: false }
        }
        busy={softDeleteBusy}
        error={softDeleteError}
        onConfirm={() => void handleSoftDeleteConfirm()}
        onCancel={closeSoftDeleteModal}
        dict={dict}
      />

      <AccountPermanentDeleteModal
        open={permanentDeleteTargetAccount !== null}
        account={permanentDeleteTargetAccount}
        busy={permanentDeleteBusy}
        error={permanentDeleteError}
        onConfirm={(typedName) => void handlePermanentDeleteConfirm(typedName)}
        onCancel={closePermanentDeleteModal}
        dict={dict}
      />
    </section>
  );
}
