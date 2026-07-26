"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import type {
  AccountDefaultCurrency,
  AccountLifecycleMutationResponseDto,
  AccountMutationResponseDto,
  AccountType,
} from "@vakwen/shared-types";
import { ACCOUNT_DEFAULT_CURRENCIES } from "@vakwen/shared-types";
import { useSettingsRouteContext } from "./SettingsRouteProvider";
import { getDictionary } from "../../lib/i18n";
import { useAppShellData } from "../layout/AppShellDataContext";
import { AccountCreateForm } from "../../features/settings/components/AccountCreateForm";
import { AccountsListSection } from "../../features/settings/components/AccountsListSection";
import { createAccount } from "../../features/cash-ledger/services/cashLedgerService";
import { patchAccount, patchFeeProfile } from "../../features/settings/services/settingsService";
import { postJson } from "../../lib/api";
import type { FeeProfileDto } from "@vakwen/shared-types";
import type {
  SettingsAccountBindingModel,
  SettingsProfileModel,
  SettingsSecurityBindingModel,
} from "../../features/settings/types/settingsUi";
import { toSettingsFormModel } from "../../features/settings/mappers/settingsMappers";
import { parseAccountDividendSettingsFocus } from "../../features/dividends/services/dividendCalculationService";
import { Button } from "../ui/Button";
import { Drawer } from "../ui/Drawer";

interface AccountSettingsDraft extends SettingsAccountBindingModel {
  accountType: AccountType;
}

const PREFILL_CURRENCIES = new Set<AccountDefaultCurrency>(ACCOUNT_DEFAULT_CURRENCIES);

function parsePrefillCurrency(raw: string | null): AccountDefaultCurrency | undefined {
  if (raw && PREFILL_CURRENCIES.has(raw as AccountDefaultCurrency)) {
    return raw as AccountDefaultCurrency;
  }
  return undefined;
}

/**
 * Phase 3d S6 — `/settings/accounts` body.
 *
 * Wraps `<AccountCreateForm>` + `<AccountsListSection>` (the latter is
 * reskinned in-place for A6 — see the component file for the shadcn token
 * conversion). The existing sensitive-confirmation modals
 * (currency / fee-profile) inside `AccountsListSection` are preserved verbatim
 * per the §8 preservation checklist.
 *
 * Fee-profile editing is local-state with optimistic mutations against the
 * shell account config — the user clicks "Save profile edit" inline within
 * each profile card to commit. (The previous omnibus PUT /settings/full
 * tracked dirty state across the entire drawer; in the route world, each
 * profile-card has its own narrow save action.)
 */
export function AccountsSettingsClient() {
  const { locale, initialSettings } = useSettingsRouteContext();
  const dict = getDictionary(locale);
  const shellData = useAppShellData();
  const canManageAccounts = !shellData.isSharedContext || shellData.sharedContextPermissions.canManageAccounts;
  const allowHardPurge = !shellData.isSharedContext;
  // Phase 3d H1 — read the `accountsPrefillCurrency` query param so the
  // KZO-169 NC4 deep-link from the transaction form's "no {currency}
  // account" inline error still pre-selects the right currency on the
  // embedded `<AccountCreateForm>`. Per `.claude/rules/nextjs-server-cookie-access.md`,
  // client-side hooks (useSearchParams) are the correct mechanism in a
  // "use client" module — not server cookies.
  const searchParams = useSearchParams();
  const prefillCurrency = parsePrefillCurrency(
    searchParams?.get("accountsPrefillCurrency") ?? null,
  );
  const focusedDividendSettings = useMemo(
    () => searchParams ? parseAccountDividendSettingsFocus(searchParams) : null,
    [searchParams],
  );

  // Build a local working copy of the settings form model from the
  // shell account config. AccountsListSection still operates on its own
  // draft mutators (legacy API surface); we forward changes through to the
  // existing per-resource PATCH endpoints (PATCH /accounts/:id for the
  // default-profile selector; rename is handled by the section internally).
  const initialModel = useMemo(() => {
    if (!initialSettings) return null;
    return toSettingsFormModel(
      initialSettings,
      shellData.accounts,
      shellData.feeProfiles,
      shellData.feeProfileBindings,
    );
  }, [initialSettings, shellData.accounts, shellData.feeProfiles, shellData.feeProfileBindings]);

  const [accountDrafts, setAccountDrafts] = useState<AccountSettingsDraft[]>([]);
  const [profiles, setProfiles] = useState<SettingsProfileModel[]>([]);
  const [bindings, setBindings] = useState<SettingsSecurityBindingModel[]>([]);
  const [createFlowOpen, setCreateFlowOpen] = useState(false);
  const [highlightedAccountId, setHighlightedAccountId] = useState<string | null>(null);

  useEffect(() => {
    if (!initialModel) return;
    setAccountDrafts(initialModel.accounts.map((draft) => ({
      ...draft,
      accountType: shellData.accounts.find((account) => account.id === draft.id)?.accountType ?? "broker",
    })));
    setProfiles(initialModel.feeProfiles);
    setBindings(initialModel.feeProfileBindings);
  }, [initialModel, shellData.accounts]);

  const applyAccountMutation = useCallback((response: AccountMutationResponseDto) => {
    shellData.applyAccountMutationResponse(response);
    setAccountDrafts((current) => {
      const nextDraft: AccountSettingsDraft = {
        id: response.account.id,
        feeProfileId: response.account.feeProfileId,
        accountType: response.account.accountType,
      };
      const index = current.findIndex((draft) => draft.id === nextDraft.id);
      if (index === -1) {
        return [...current, nextDraft];
      }
      const next = [...current];
      next[index] = nextDraft;
      return next;
    });
    setProfiles((current) => {
      const nextProfile: SettingsProfileModel = {
        id: response.feeProfile.id,
        accountId: response.feeProfile.accountId,
        name: response.feeProfile.name,
        boardCommissionRate: response.feeProfile.boardCommissionRate,
        commissionDiscountPercent: response.feeProfile.commissionDiscountPercent,
        minimumCommissionAmount: response.feeProfile.minimumCommissionAmount,
        commissionCurrency: response.feeProfile.commissionCurrency,
        commissionRoundingMode: response.feeProfile.commissionRoundingMode,
        taxRoundingMode: response.feeProfile.taxRoundingMode,
        stockSellTaxRateBps: response.feeProfile.stockSellTaxRateBps,
        stockDayTradeTaxRateBps: response.feeProfile.stockDayTradeTaxRateBps,
        etfSellTaxRateBps: response.feeProfile.etfSellTaxRateBps,
        bondEtfSellTaxRateBps: response.feeProfile.bondEtfSellTaxRateBps,
        commissionChargeMode: response.feeProfile.commissionChargeMode,
      };
      const index = current.findIndex((profile) => profile.id === nextProfile.id);
      if (index === -1) {
        return [...current, nextProfile];
      }
      const next = [...current];
      next[index] = nextProfile;
      return next;
    });
  }, [shellData]);

  const applyAccountLifecycleMutation = useCallback((
    response: AccountLifecycleMutationResponseDto,
    operation: "soft_delete" | "restore" | "hard_purge",
  ) => {
    if (shellData.applyAccountLifecycleMutationResponse) {
      shellData.applyAccountLifecycleMutationResponse(response, operation);
    } else {
      void shellData.refreshPortfolioConfig();
    }
    setAccountDrafts((current) => {
      if (operation !== "restore") {
        return current.filter((draft) => draft.id !== response.accountId);
      }
      const restored = {
        id: response.account.id,
        feeProfileId: response.account.feeProfileId,
        accountType: response.account.accountType,
      };
      const index = current.findIndex((draft) => draft.id === response.accountId);
      if (index === -1) return [...current, restored];
      const next = [...current];
      next[index] = restored;
      return next;
    });
    if (operation === "hard_purge") {
      setProfiles((current) =>
        current.filter((profile) => profile.accountId !== response.accountId),
      );
    }
  }, [shellData]);

  const handleRenameAccount = useCallback(
    async (accountId: string, name: string) => {
      const response = await patchAccount(accountId, { name });
      applyAccountMutation(response);
    },
    [applyAccountMutation],
  );

  // Local mutators — Accounts tab's fee-profile editing is held in local
  // state until the user explicitly clicks the per-profile edit-done button
  // (which is wired below to `refreshPortfolioConfig()` so the next config
  // reflects committed changes). Per-profile PATCH endpoints are part of
  // a follow-up; for this phase we keep the in-section state ephemeral so
  // the rendered UI is functionally consistent with the prior drawer flow.

  const updateAccountProfile = useCallback(
    (accountId: string, feeProfileId: string) => {
      setAccountDrafts((current) =>
        current.map((d) => (d.id === accountId ? { ...d, feeProfileId } : d)),
      );
    },
    [],
  );

  const updateAccountType = useCallback(
    (accountId: string, accountType: AccountType) => {
      setAccountDrafts((current) =>
        current.map((draft) => (draft.id === accountId ? { ...draft, accountType } : draft)),
      );
    },
    [],
  );

  const saveAccountFeeProfile = useCallback(
    async (accountId: string, feeProfileId: string) => {
      const response = await patchAccount(accountId, { feeProfileId });
      applyAccountMutation(response);
    },
    [applyAccountMutation],
  );

  const saveAccountType = useCallback(
    async (accountId: string, accountType: AccountType) => {
      const response = await patchAccount(accountId, { accountType });
      applyAccountMutation(response);
    },
    [applyAccountMutation],
  );

  const updateProfileField = useCallback(
    (profileId: string, key: keyof SettingsProfileModel, value: string | number) => {
      setProfiles((current) =>
        current.map((p) => (p.id === profileId ? { ...p, [key]: value } : p)),
      );
    },
    [],
  );

  const saveProfile = useCallback(
    async (profileId: string) => {
      const profile = profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw new Error(`Fee profile ${profileId} was not found.`);
      }
      const authoritative = await patchFeeProfile(profileId, {
        name: profile.name,
        boardCommissionRate: profile.boardCommissionRate,
        commissionDiscountPercent: profile.commissionDiscountPercent,
        minimumCommissionAmount: profile.minimumCommissionAmount,
        commissionCurrency: profile.commissionCurrency,
        commissionRoundingMode: profile.commissionRoundingMode,
        taxRoundingMode: profile.taxRoundingMode,
        stockSellTaxRateBps: profile.stockSellTaxRateBps,
        stockDayTradeTaxRateBps: profile.stockDayTradeTaxRateBps,
        etfSellTaxRateBps: profile.etfSellTaxRateBps,
        bondEtfSellTaxRateBps: profile.bondEtfSellTaxRateBps,
        commissionChargeMode: profile.commissionChargeMode,
      });
      setProfiles((current) =>
        current.map((entry) =>
          entry.id === authoritative.id
            ? {
                ...entry,
                name: authoritative.name,
                boardCommissionRate: authoritative.boardCommissionRate,
                commissionDiscountPercent: authoritative.commissionDiscountPercent,
                minimumCommissionAmount: authoritative.minimumCommissionAmount,
                commissionCurrency: authoritative.commissionCurrency,
                commissionRoundingMode: authoritative.commissionRoundingMode,
                taxRoundingMode: authoritative.taxRoundingMode,
                stockSellTaxRateBps: authoritative.stockSellTaxRateBps,
                stockDayTradeTaxRateBps: authoritative.stockDayTradeTaxRateBps,
                etfSellTaxRateBps: authoritative.etfSellTaxRateBps,
                bondEtfSellTaxRateBps: authoritative.bondEtfSellTaxRateBps,
                commissionChargeMode: authoritative.commissionChargeMode,
              }
            : entry,
        ),
      );
      await shellData.refreshPortfolioConfig();
    },
    [profiles, shellData],
  );

  // Phase 3d iter 2 (architect ruling) — Add profile fires POST /fee-profiles
  // immediately. Previously held drafts locally only, which lost them on
  // navigation; the route world has no omnibus PUT /settings/full to commit
  // a batch. Per-resource POST is the authoritative path.
  const addProfileForAccount = useCallback(
    (accountId: string) => {
      void (async () => {
        try {
          await postJson<FeeProfileDto>("/fee-profiles", {
            accountId,
            name: "New profile",
            boardCommissionRate: 1.425,
            commissionDiscountPercent: 0,
            minimumCommissionAmount: 20,
            commissionCurrency: "TWD",
            commissionRoundingMode: "FLOOR",
            taxRoundingMode: "FLOOR",
            stockSellTaxRateBps: 30,
            stockDayTradeTaxRateBps: 15,
            etfSellTaxRateBps: 10,
            bondEtfSellTaxRateBps: 0,
            commissionChargeMode: "CHARGED_UPFRONT",
          });
          // Refresh shell config so the new profile appears in the
          // list via the `initialModel` → `setProfiles` sync effect.
          await shellData.refreshPortfolioConfig();
        } catch {
          // Inline error UX deferred — the toast layer surfaces failures.
        }
      })();
    },
    [shellData],
  );

  const removeProfileFromAccount = useCallback(
    (_accountId: string, profileId: string) => {
      setProfiles((current) => current.filter((p) => p.id !== profileId));
    },
    [],
  );

  // Phase 3d iter 2 — duplicate fires a POST /fee-profiles per copy. Each
  // posted profile gets a fresh DB id; we drop the temporary client id
  // entirely. Refresh runs once after all posts so the snapshot picks up
  // every new profile atomically.
  const duplicateProfilesFromAccount = useCallback(
    (sourceAccountId: string, targetAccountId: string, profileIds: string[], sourceAccountName?: string) => {
      const suffix = sourceAccountName ? ` (from ${sourceAccountName})` : "";
      const selected = profiles.filter(
        (p) => p.accountId === sourceAccountId && profileIds.includes(p.id),
      );
      if (selected.length === 0) return;
      void (async () => {
        try {
          for (const profile of selected) {
            // Strip the local `id` + `accountId` (override) + override `name`
            // per the duplicate semantics. The rest of the payload is the
            // cloned source profile's values.
            const {
              id: _omitId,
              accountId: _omitAccountId,
              name,
              ...rest
            } = profile;
            // Reference to silence unused-var lint; values are intentionally
            // discarded — the new profile gets a server-issued id and the
            // target accountId from the loop closure.
            void _omitId;
            void _omitAccountId;
            await postJson<FeeProfileDto>("/fee-profiles", {
              accountId: targetAccountId,
              name: `${name}${suffix}`,
              ...rest,
            });
          }
          await shellData.refreshPortfolioConfig();
        } catch {
          // Inline error UX deferred — toast layer surfaces failures.
        }
      })();
    },
    [profiles, shellData],
  );

  const addBinding = useCallback((accountId: string) => {
    const owned = profiles.find((p) => p.accountId === accountId);
    if (!owned) return;
    setBindings((current) => [
      ...current,
      { accountId, ticker: "2330", feeProfileId: owned.id },
    ]);
  }, [profiles]);

  const updateBinding = useCallback(
    (index: number, patch: Partial<SettingsSecurityBindingModel>) => {
      setBindings((current) => {
        const next = [...current];
        next[index] = { ...next[index], ...patch };
        return next;
      });
    },
    [],
  );

  const removeBinding = useCallback((index: number) => {
    setBindings((current) => current.filter((_, idx) => idx !== index));
  }, []);

  const handleAccountsRefresh = useCallback(
    async (response?: AccountMutationResponseDto | undefined) => {
      if (response) {
        applyAccountMutation(response);
        setHighlightedAccountId(response.account.id);
        setCreateFlowOpen(false);
      }
    },
    [applyAccountMutation],
  );

  if (!initialSettings) {
    return (
      <div data-testid="settings-section-accounts" className="text-sm text-muted-foreground">
        {dict.feedback.loadingSettings}
      </div>
    );
  }

  const hasShellAccountConfig = shellData.accounts.length > 0 || shellData.feeProfiles.length > 0;
  const hasAccounts = shellData.accounts.length > 0;

  const accountCreateForm = (
    <AccountCreateForm
      onCreate={createAccount}
      onAccountsRefresh={handleAccountsRefresh}
      prefillCurrency={prefillCurrency}
      dict={dict}
      disabled={!canManageAccounts}
      existingAccounts={shellData.accounts}
      isFirstAccount={!hasAccounts}
    />
  );

  return (
    <div className="space-y-4" data-testid="settings-section-accounts">
      {!hasAccounts ? (
        <section className="space-y-4 rounded-xl border border-border bg-card p-4">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold text-foreground">{dict.settings.accountsZeroStateTitle}</h2>
            <p className="text-sm text-muted-foreground">{dict.settings.accountsZeroStateDescription}</p>
          </div>
          {canManageAccounts ? accountCreateForm : (
            <div
              className="rounded-lg border border-border bg-muted/40 px-3 py-3 text-sm text-muted-foreground"
              data-testid="accounts-shared-readonly-note"
            >
              {dict.switcher.readonlyDescription}
            </div>
          )}
        </section>
      ) : (
        <>
          <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
            <div className="space-y-1">
              <h2 className="text-xl font-semibold text-foreground">{dict.settings.accountsListSectionTitle}</h2>
              <p className="text-sm text-muted-foreground">{dict.settings.accountsCreateAdditionalDescription}</p>
            </div>
            {canManageAccounts ? (
              <Button
                type="button"
                onClick={() => setCreateFlowOpen(true)}
                data-testid="accounts-add-account-trigger"
              >
                <Plus className="mr-2 h-4 w-4" />
                {dict.settings.accountsAddAccountTrigger}
              </Button>
            ) : null}
          </section>
          <Drawer
            open={createFlowOpen}
            onOpenChange={setCreateFlowOpen}
            title={dict.settings.accountsAddAccountTrigger}
            closeLabel={dict.actions.cancel}
          >
            {accountCreateForm}
          </Drawer>
        </>
      )}
      {shellData.isPortfolioConfigLoading && !hasShellAccountConfig ? (
        <div
          className="rounded-xl border border-border bg-card px-4 py-6 text-sm text-muted-foreground shadow-sm"
          role="status"
          aria-live="polite"
          aria-busy="true"
        >
          {dict.feedback.loadingSettings}
        </div>
      ) : (
        <AccountsListSection
          accounts={shellData.accounts}
          accountDrafts={accountDrafts}
          profiles={profiles}
          feeProfileBindings={bindings}
          activeLocale={initialSettings.locale ?? locale}
          onUpdateAccountProfile={updateAccountProfile}
          onSaveAccountProfile={saveAccountFeeProfile}
          onUpdateAccountType={updateAccountType}
          onSaveAccountType={saveAccountType}
          onRenameAccount={handleRenameAccount}
          onAddProfileForAccount={addProfileForAccount}
          onUpdateProfileField={updateProfileField}
          onSaveProfile={saveProfile}
          onRemoveProfileFromAccount={removeProfileFromAccount}
          onDuplicateProfilesFromAccount={duplicateProfilesFromAccount}
          onAddBinding={addBinding}
          onUpdateBinding={updateBinding}
          onRemoveBinding={removeBinding}
          onLifecycleMutation={applyAccountLifecycleMutation}
          effectiveAccountHardPurgeDays={initialSettings.effectiveAccountHardPurgeDays}
          dict={dict}
          canManage={canManageAccounts}
          allowHardPurge={allowHardPurge}
          focusedDividendSettings={focusedDividendSettings}
          highlightedAccountId={highlightedAccountId}
        />
      )}
    </div>
  );
}
