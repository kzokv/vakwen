import type { Response } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { SettingsDrawerPage } from "../../pages/settings/SettingsDrawerPage.js";

export class SettingsActions extends AppBaseActions {
  declare protected readonly _instance: SettingsDrawerPage;

  private static readonly saveOutcomeTimeoutMs = 2_000;
  private accountCreateName = "";

  private get el() {
    return this._instance.elements;
  }

  @Step()
  async getQuotePollValue(): Promise<string> {
    return await this.el.general.quotePollInput.inputValue();
  }

  @Step()
  async changeLocale(locale: string): Promise<void> {
    // Phase 3d S4 — the locale field moved from a native <select> in the
    // (deleted) GeneralSettingsSection to a shadcn `<Select>` in the
    // /settings/display body. The `display-language-select` testid is on
    // the SelectTrigger; opening it surfaces SelectItem options keyed by
    // their textual label (English / Traditional Chinese / 中文 …).
    await this.uiActions.click.perform(this.el.general.languageSelect);
    // Map locale code to option text. Default to the code itself for
    // forward-compat.
    const optionText = locale === "zh-TW"
      ? /Traditional Chinese|繁體中文/i
      : locale === "en"
        ? /English|英文/i
        : new RegExp(locale, "i");
    await this.uiActions.click.perform(this.el.general.languageOption(optionText));
  }

  @Step()
  async changeQuotePollInterval(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.general.quotePollInput, value);
  }

  @Step()
  async focusLocaleTooltip(): Promise<void> {
    await this.mxFocus(this.el.general.localeTooltipTrigger);
  }

  // Phase 3d iter 2 §5.3 — `focusCostBasisTooltip` removed alongside the
  // costBasisMethod UI (scope-addendum A5). Sole consumer was the deleted
  // cost-basis branch of tooltips-a11y-aaa.spec.ts.

  /**
   * Phase 3d S10 — the omnibus drawer Save button is retired. With
   * auto-save, callers no longer click "Save" to commit changes; the
   * preceding `commit(...)` from each field's input triggers the
   * debounced PATCH. This wrapper waits for the next /settings or
   * /user-preferences PATCH response (whichever fires first) so existing
   * specs that called `save()` after a field change continue to assert on
   * the persisted outcome.
   */
  @Step()
  async save(): Promise<void> {
    const outcomeTimeoutMs = SettingsActions.saveOutcomeTimeoutMs;
    const responsePredicate = (response: Response) => {
      const url = new URL(response.url());
      const path = url.pathname;
      const method = response.request().method();
      return (
        method === "PATCH"
        && (path === "/settings" || path === "/user-preferences" || path === "/profile"
          || path === "/api/settings" || path === "/api/user-preferences" || path === "/api/profile")
      );
    };
    // The auto-save hook commits on blur — emit a tab keypress so any
    // focused input releases focus and the debounce timer fires.
    try {
      await this.mxPressKey("Tab");
    } catch {
      // Ignore — Tab is best-effort here.
    }
    try {
      await this.mxWaitForResponse(responsePredicate, undefined, outcomeTimeoutMs);
    } catch {
      // No PATCH fired within the window. For tests that intentionally
      // exercise validation paths, the assertion layer will pick up the
      // inline-error indicator separately. Do not throw.
      return;
    }
    // Phase 3d iter 2 — settings-aaa changes locale AND quotePoll in the
    // same flow. Each field has its own 600ms-debounced save → TWO PATCH
    // /settings requests may fire. After the first response lands, wait
    // briefly for any sibling PATCH to settle before returning. The
    // short window (~1500ms) is long enough to swallow the second
    // debounce + RTT but short enough that callers committing a single
    // field don't pay a noticeable cost.
    try {
      await this.mxWaitForResponse(responsePredicate, undefined, 1500);
    } catch {
      // No second PATCH — the caller committed exactly one field.
    }
  }

  @Step()
  async openProfileTab(): Promise<void> {
    // Phase 3d S9 — drawer tab → nav-item click triggers /settings/profile navigation.
    await this.uiActions.click.perform(this.el.tabs.profile);
    await this.el.section("profile").waitFor({ state: "visible", timeout: 10_000 });
  }

  @Step()
  async clearProfileEmail(): Promise<void> {
    await this.el.profile.emailInput.clear();
  }

  @Step()
  async fillProfileEmail(value: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.profile.emailInput, value);
  }

  @Step()
  async saveProfileEmail(): Promise<Response> {
    const patchPromise = this.mxWaitForResponse(
      (response) => {
        const pathname = new URL(response.url()).pathname;
        return response.request().method() === "PATCH"
          && (pathname === "/profile" || pathname === "/api/profile");
      },
    );
    await this.uiActions.click.perform(this.el.profile.saveEmailButton);
    return await patchPromise;
  }

  @Step()
  async closeWithEscape(): Promise<void> {
    // Phase 3d D2(α) shim — was: press Escape to dismiss drawer overlay.
    // Now: navigate to /dashboard. Route-based /settings/* pages do not
    // dismiss on Escape; the "close settings, return to app" semantic is
    // expressed by navigating away. The `closeWithEscape` name is preserved
    // for back-compat with 4 existing OAuth specs (profile-tab-aaa,
    // admin-impersonation-aaa, card-reorder-aaa [card-B/C],
    // dashboard-timeframe-aaa [timeframe-Q]) — do not rename without a
    // co-ordinated spec sweep. @deprecated Prefer
    // `appShell.actions.mxNavigateToRoute("/dashboard")` directly at new
    // call sites.
    await this.mxNavigateToRoute("/dashboard");
  }

  /**
   * Phase 3d S10 — drawer Cancel / Keep-Editing / Discard-Changes buttons
   * are retired with the SettingsDrawer. Auto-save has no concept of an
   * "unsaved" state. These methods remain as no-ops so existing specs that
   * call them through inherited fixtures don't fail to compile; behavioral
   * expectations should be migrated by QA in the spec rewrites.
   */
  @Step()
  async cancel(): Promise<void> {
    // No-op: there is no Cancel dialog in the auto-save flow.
  }

  @Step()
  async keepEditing(): Promise<void> {
    // No-op: there is no unsaved-changes warning.
  }

  @Step()
  async discardChanges(): Promise<void> {
    // No-op: callers should rely on per-field reset / navigate-away.
  }

  // --- KZO-179: Account Create form (Accounts tab) ---

  @Step()
  async openAccountCreateFlow(): Promise<void> {
    // Wait for account configuration readiness before deciding whether this
    // is the inline first-account flow or the additional-account drawer.
    await this.el.accountCreate.portfolioConfigLoading
      .waitFor({ state: "hidden", timeout: 10_000 })
      .catch(() => undefined);
    if (await this.el.accountCreate.form.isVisible().catch(() => false)) return;
    await this.uiActions.click.perform(this.el.accountCreate.trigger);
    await this.el.accountCreate.form.waitFor({ state: "visible" });
  }

  @Step()
  async fillAccountCreateName(value: string): Promise<void> {
    await this.openAccountCreateFlow();
    if (await this.el.accountCreate.nameInput.count() === 0) {
      await this.uiActions.click.perform(this.el.accountCreate.continueButton);
    }
    await this.uiActions.fill.perform(this.el.accountCreate.nameInput, value);
    this.accountCreateName = value.trim();
  }

  @Step()
  async selectAccountCreateType(type: "broker" | "bank" | "wallet"): Promise<void> {
    await this.uiActions.click.perform(this.el.accountCreate.typePill(type));
  }

  @Step()
  async selectAccountCreateCurrency(currency: "TWD" | "USD" | "AUD" | "KRW" | "JPY"): Promise<void> {
    await this.openAccountCreateFlow();
    if (await this.el.accountCreate.currencyCard(currency).count() === 0) {
      await this.uiActions.click.perform(this.el.accountCreate.backButton);
    }
    await this.uiActions.click.perform(this.el.accountCreate.currencyCard(currency));
    await this.uiActions.click.perform(this.el.accountCreate.continueButton);
  }

  // KZO-183: per-account "Add override" button. Each account card hosts
  // its own button so the helper takes the account id explicitly.
  @Step()
  async addOverrideForAccount(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.addOverride(accountId));
  }

  // KZO-183: expand a per-account card to reveal its inline body (default
  // profile selector, profiles list, overrides list).
  @Step()
  async expandAccountCard(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.cardToggle(accountId));
  }

  // KZO-183: add a new fee profile to the given account card.
  @Step()
  async addFeeProfileToAccount(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.addProfile(accountId));
  }

  // KZO-183: type into the accounts-tab search input.
  @Step()
  async searchAccountsTab(query: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.accountsList.searchInput, query);
  }

  // KZO-183: clear the accounts-tab search input.
  @Step()
  async clearAccountsTabSearch(): Promise<void> {
    await this.el.accountsList.searchInput.clear();
  }

  // KZO-183: click the edit pencil, replace the name, confirm.
  @Step()
  async editProfileName(profileId: string, name: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.profileEditButton(profileId));
    await this.uiActions.fill.perform(this.el.accountsList.profileNameInput(profileId), name);
    await this.uiActions.click.perform(this.el.accountsList.profileEditDoneButton(profileId));
  }

  @Step()
  async editSelectedProfileDiscount(accountId: string, discount: string): Promise<void> {
    const profileId = await this.el.accountsList.accountProfileSelect(accountId).inputValue();
    if (!profileId) throw new Error(`Account ${accountId} has no selected fee profile`);
    await this.uiActions.click.perform(this.el.accountsList.profileEditButton(profileId));
    await this.uiActions.fill.perform(this.el.accountsList.profileDiscountInput(profileId), discount);
    await this.uiActions.click.perform(this.el.accountsList.profileEditDoneButton(profileId));
    await this.el.accountsList.profileDiscountInput(profileId).waitFor({ state: "hidden" });
  }

  @Step()
  async openSelectedProfileEditor(accountId: string): Promise<void> {
    const profileId = await this.el.accountsList.accountProfileSelect(accountId).inputValue();
    if (!profileId) throw new Error(`Account ${accountId} has no selected fee profile`);
    await this.uiActions.click.perform(this.el.accountsList.profileEditButton(profileId));
  }

  // KZO-183: open the "Duplicate from another account" picker for an account.
  @Step()
  async clickDuplicateFromAnotherAccount(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.duplicateCta(accountId));
  }

  // KZO-183: select a source account in the duplicate picker's <select>.
  @Step()
  async selectDuplicateSourceAccount(accountId: string): Promise<void> {
    await this.uiActions.select.perform(this.el.accountsList.duplicateSourceSelect, accountId);
  }

  // KZO-183: toggle a profile checkbox in the duplicate picker.
  @Step()
  async checkDuplicateProfile(profileId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.duplicateCheckbox(profileId));
  }

  // KZO-183: click the confirm button in the duplicate picker.
  @Step()
  async confirmDuplicate(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.duplicateConfirm);
  }

  @Step()
  async submitAccountCreate(): Promise<{ json: () => Promise<unknown> }> {
    const createdAccountLabel = this.el.testId("account-name-label", "Account Name Label")
      .filter({ hasText: this.accountCreateName });

    if (await this.el.accountCreate.submit.count() === 0) {
      await this.uiActions.click.perform(this.el.accountCreate.continueButton);
    }

    // Depending on the wizard entry path, Continue either reveals a distinct
    // review submit button or submits the already-reviewed form directly.
    // Wait for either stable outcome before deciding whether another submit
    // is necessary.
    await this.el.accountCreate.submit.or(createdAccountLabel)
      .waitFor({ state: "visible", timeout: 10_000 });
    if (await createdAccountLabel.isVisible().catch(() => false)) {
      // The final Continue already created the account.
    } else {
      // The successful mutation resets the wizard and replaces the review
      // submit button. Resolve and submit it in one browser task so Playwright
      // cannot retry a locator after the successful mutation unmounts the
      // drawer and replaces its button.
      await this.page.evaluate(() => {
        const button = document.querySelector('[data-testid="account-create-submit"]');
        if (button instanceof HTMLButtonElement && button.form) {
          button.form.requestSubmit(button);
        }
      });
      await createdAccountLabel.waitFor({ state: "visible", timeout: 10_000 });
    }

    /* eslint-disable aaa/no-page-access -- this helper must recover the authoritative account created after the wizard unmounts */
    const identityCookies = await this.page.context().cookies(TestEnv.appBaseUrl);
    const userId = identityCookies.find((cookie) => cookie.name === "tw_e2e_user")?.value;
    const accountsResponse = await this.page.request.get(
      new URL("/accounts", TestEnv.apiBaseUrl).href,
      userId ? { headers: { "x-user-id": userId } } : undefined,
    );
    /* eslint-enable aaa/no-page-access */
    if (!accountsResponse.ok()) {
      throw new Error(`Account list failed after creation: ${accountsResponse.status()}`);
    }
    const accounts = await accountsResponse.json() as Array<Record<string, unknown>>;
    const created = accounts.find((account) => account.name === this.accountCreateName);
    if (!created) {
      throw new Error(`Created account was not returned by the account list: ${this.accountCreateName}`);
    }
    return { json: async () => created };
  }

  // --- Monitored Symbols ---

  @Step()
  async openTickersTab(): Promise<void> {
    // Phase 3d S9 — drawer tab → nav-item click triggers /settings/tickers navigation.
    await this.uiActions.click.perform(this.el.tabs.tickers);
    await this.el.section("tickers").waitFor({ state: "visible", timeout: 10_000 });
  }

  @Step()
  async openCatalog(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.browseCatalogButton);
  }

  @Step()
  async closeCatalog(): Promise<void> {
    await this.uiActions.click.perform(this.el.catalog.backButton);
  }

  @Step()
  async toggleCatalogItem(ticker: string): Promise<void> {
    await this.mxClick(this.el.catalog.itemCheckbox(ticker));
  }

  @Step()
  async filterCatalogByType(type: "all" | "stock" | "etf" | "bond_etf"): Promise<void> {
    const filterMap = {
      all: this.el.catalog.filterAll,
      stock: this.el.catalog.filterStock,
      etf: this.el.catalog.filterEtf,
      bond_etf: this.el.catalog.filterBondEtf,
    };
    await this.uiActions.click.perform(filterMap[type]);
  }

  @Step()
  async searchCatalog(query: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.catalog.search, query);
  }

  @Step()
  async saveTickers(): Promise<void> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PUT"
        && response.url().includes("/monitored-tickers")
        && response.ok(),
      { timeout: 10_000 },
    );

    await this.uiActions.click.perform(this.el.tickers.saveButton);
    await responsePromise;
  }

  @Step()
  async retryBackfill(ticker: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.retryBackfillButton(ticker));
  }

  @Step()
  async enterRepairMode(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairModeButton);
  }

  @Step()
  async cancelRepairMode(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairCancelButton);
  }

  @Step()
  async selectTickerForRepair(ticker: string): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairSelection(ticker));
  }

  @Step()
  async continueToRepairModal(): Promise<void> {
    await this.uiActions.click.perform(this.el.tickers.repairContinueButton);
  }

  @Step()
  async setRepairDateRange(startDate: string, endDate: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.repairModal.startDateInput, startDate);
    await this.uiActions.fill.perform(this.el.repairModal.endDateInput, endDate);
  }

  @Step()
  async setRepairIncludeBars(enabled: boolean): Promise<void> {
    const checkbox = this.el.repairModal.includeBarsCheckbox;
    const checked = await checkbox.isChecked();
    if (checked !== enabled) {
      await this.uiActions.click.perform(checkbox);
    }
  }

  @Step()
  async setRepairIncludeDividends(enabled: boolean): Promise<void> {
    const checkbox = this.el.repairModal.includeDividendsCheckbox;
    const checked = await checkbox.isChecked();
    if (checked !== enabled) {
      await this.uiActions.click.perform(checkbox);
    }
  }

  @Step()
  async setRepairMode(mode: "apply-all" | "per-ticker"): Promise<void> {
    if (mode === "apply-all") {
      await this.uiActions.click.perform(this.el.repairModal.applyAllToggle);
      return;
    }
    await this.uiActions.click.perform(this.el.repairModal.perTickerToggle);
  }

  @Step()
  async submitRepair(): Promise<void> {
    const responsePromise = this.mxWaitForResponse(
      (response) =>
        response.request().method() === "POST"
        && response.url().includes("/backfill/repair"),
      { timeout: 10_000 },
    );

    await this.uiActions.click.perform(this.el.repairModal.submitButton);
    await responsePromise;
  }

  // ── KZO-188: AU ticker discovery ─────────────────────────────────────────

  /**
   * Click a market chip in the InstrumentCatalogSheet (All · TW · US · AU · KR · JP).
   * Must be called after the catalog sheet is open.
   */
  @Step()
  async clickMarketChip(market: "all" | "TW" | "US" | "AU" | "KR" | "JP"): Promise<void> {
    await this.uiActions.click.perform(this.el.catalog.marketChip(market));
  }

  // ── KZO-196: AU GICS sector filter ───────────────────────────────────────

  /**
   * Select a GICS sector in the AU catalog sheet's sector dropdown. Pass the
   * empty string to reset to "All sectors".
   *
   * Requires the AU market chip to be active (`clickMarketChip("AU")`); the
   * dropdown is hidden for ALL/TW/US per scope-todo.
   */
  @Step()
  async selectSectorFilter(sector: string): Promise<void> {
    await this.el.catalog.sectorSelect.selectOption(sector);
  }

  /**
   * Pre-attach a wait for the PUT /monitored-tickers response BEFORE clicking
   * the save button. Returns the response promise — caller awaits it after the
   * save click to satisfy the pre-attach contract per
   * `react-useEventStream-preconnect-pattern.md`.
   */
  @Step()
  async waitForSaveTickersResponse(): Promise<import("@playwright/test").Response> {
    return this.mxWaitForResponse(
      (response) =>
        response.request().method() === "PUT"
        && response.url().includes("/monitored-tickers")
        && response.ok(),
      { timeout: 10_000 },
    );
  }

  // ── ui-enhancement — Account deletion lifecycle ─────────────────────────

  @Step()
  async clickAccountDeleteButton(accountId: string): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.deleteButton(accountId));
  }

  @Step()
  async confirmSoftDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.softDeleteConfirmButton);
  }

  @Step()
  async cancelSoftDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.softDeleteCancelButton);
  }

  @Step()
  async clickRecentlyDeletedRestore(accountId: string): Promise<void> {
    await this.uiActions.click.perform(
      this.el.accountsList.recentlyDeletedRestoreButton(accountId),
    );
  }

  @Step()
  async clickRecentlyDeletedPurge(accountId: string): Promise<void> {
    await this.uiActions.click.perform(
      this.el.accountsList.recentlyDeletedPurgeButton(accountId),
    );
  }

  @Step()
  async fillPermanentDeleteConfirmation(name: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.accountsList.permanentDeleteInput, name);
  }

  @Step()
  async confirmPermanentDelete(): Promise<void> {
    await this.uiActions.click.perform(this.el.accountsList.permanentDeleteConfirmButton);
  }
}
