import type { Locator } from "@playwright/test";
import { BasePage, type TElementLocatorHelpers } from "@vakwen/test-framework/core";

/**
 * Phase 3d S9 — formerly the page-object for the (now-deleted) SettingsDrawer.
 * Repurposed as the page-object for the `/settings/*` two-pane shell. The
 * class name is retained for back-compat with existing AAA assistants /
 * fixtures; the underlying testids point at the route-driven UI now.
 *
 * Locked testid contract (architect-design.md §6.1):
 *   - `settings-layout` on the two-pane root
 *   - `settings-nav` / `settings-nav-mobile` on the nav surfaces
 *   - `settings-nav-item-{slug}` on each <a> link
 *   - `settings-section-{slug}` on each section root
 *   - `settings-locale-select`, `general-quote-poll-section`,
 *     `general-cost-basis-section` (post-3d /settings/general additions)
 *
 * Drawer-era locators (`unsavedChangesDialog`, `footer.saveButton`, etc.) are
 * intentionally absent — the route-driven shell has auto-save + per-field
 * confirmation dialogs instead of an omnibus footer.
 */
export interface TSettingsDrawerElements extends TElementLocatorHelpers {
  layout: Locator;
  nav: Locator;
  navMobile: Locator;
  navItem: (slug: "profile" | "accounts" | "display" | "tickers") => Locator;
  /** Section roots — replaces the drawer's tab-button locators. */
  section: (slug: "profile" | "accounts" | "display" | "tickers") => Locator;

  // ── Legacy aliases (preserved for spec back-compat) ──────────────────────
  /** Was `<DialogContent data-testid="settings-drawer">` — now the two-pane
   * layout root. Specs that assert `drawer.toBeVisible()` continue to work. */
  drawer: Locator;
  /** Was the tab-button strip; now points at each section's <a> nav link. */
  tabs: {
    profile: Locator;
    general: Locator; // retired; aliased to display nav-item for legacy specs
    accounts: Locator;
    tickers: Locator;
    display: Locator;
  };

  accountCreate: {
    trigger: Locator;
    form: Locator;
    portfolioConfigLoading: Locator;
    continueButton: Locator;
    backButton: Locator;
    nameInput: Locator;
    typePill: (type: "broker" | "bank" | "wallet") => Locator;
    currencyCard: (currency: "TWD" | "USD" | "AUD" | "KRW" | "JPY") => Locator;
    previewChip: Locator;
    submit: Locator;
    error: Locator;
  };
  general: {
    localeSelect: Locator;
    quotePollInput: Locator;
    localeTooltipTrigger: Locator;
    localeTooltipContent: Locator;
    // Phase 3d S4 additions
    calculationsSection: Locator;
    languageSelect: Locator;
    /** shadcn `<SelectItem>` rendered into a Radix portal as
     * `role="option"`. Used by the locale-change flow. */
    languageOption: (label: RegExp | string) => Locator;
    /** First visible `role="alert"` element in the section — surfaces
     * inline auto-save validation errors (e.g. quote-poll, picture URL). */
    inlineAlert: Locator;
  };
  accountsList: {
    searchInput: Locator;
    card: (accountId: string) => Locator;
    cardToggle: (accountId: string) => Locator;
    marketBadge: (accountId: string) => Locator;
    accountProfileSelect: (accountId: string) => Locator;
    addProfile: (accountId: string) => Locator;
    duplicateCta: (accountId: string) => Locator;
    addOverride: (accountId: string) => Locator;
    duplicatePicker: Locator;
    duplicateSourceSelect: Locator;
    duplicateConfirm: Locator;
    duplicateCancel: Locator;
    duplicateCheckbox: (profileId: string) => Locator;
    profileRows: (accountId: string) => Locator;
    profileRow: (accountId: string, profileId: string) => Locator;
    profileEditButton: (profileId: string) => Locator;
    profileNameInput: (profileId: string) => Locator;
    profileDiscountInput: (profileId: string) => Locator;
    profileEditDoneButton: (profileId: string) => Locator;
    deleteButton: (accountId: string) => Locator;
    softDeleteModal: Locator;
    softDeleteConfirmButton: Locator;
    softDeleteCancelButton: Locator;
    softDeleteWarningOpenPositions: Locator;
    softDeleteWarningCashBalance: Locator;
    softDeleteWarningLastAccount: Locator;
    permanentDeleteModal: Locator;
    permanentDeleteInput: Locator;
    permanentDeleteConfirmButton: Locator;
    permanentDeleteCancelButton: Locator;
    recentlyDeletedSection: Locator;
    recentlyDeletedHeader: Locator;
    recentlyDeletedRow: (accountId: string) => Locator;
    recentlyDeletedRestoreButton: (accountId: string) => Locator;
    recentlyDeletedPurgeButton: (accountId: string) => Locator;
    recentlyDeletedTimeRemaining: (accountId: string) => Locator;
  };
  profile: {
    section: Locator;
    displayNameInput: Locator;
    emailInput: Locator;
    saveEmailButton: Locator;
    emailSavedIndicator: Locator;
  };
  tickers: {
    section: Locator;
    search: Locator;
    emptyState: Locator;
    browseCatalogButton: Locator;
    saveButton: Locator;
    savedMessage: Locator;
    positionTicker: (ticker: string) => Locator;
    manualTicker: (ticker: string) => Locator;
    backfillBadge: (ticker: string) => Locator;
    retryBackfillButton: (ticker: string) => Locator;
    repairModeButton: Locator;
    repairCancelButton: Locator;
    repairContinueButton: Locator;
    repairCheckboxRow: (ticker: string) => Locator;
    repairSelection: (ticker: string) => Locator;
    repairCooldownHint: (ticker: string) => Locator;
  };
  repairModal: {
    dialog: Locator;
    startDateInput: Locator;
    endDateInput: Locator;
    includeBarsCheckbox: Locator;
    includeDividendsCheckbox: Locator;
    applyAllToggle: Locator;
    perTickerToggle: Locator;
    submitButton: Locator;
  };
  catalog: {
    sheet: Locator;
    backButton: Locator;
    search: Locator;
    list: Locator;
    filterAll: Locator;
    filterStock: Locator;
    filterEtf: Locator;
    filterBondEtf: Locator;
    item: (ticker: string) => Locator;
    allItems: Locator;
    itemCheckbox: (ticker: string) => Locator;
    marketChip: (market: "all" | "TW" | "US" | "AU" | "KR" | "JP") => Locator;
    liveItemBadge: (ticker: string) => Locator;
    liveUnavailableMessage: Locator;
    liveSearchingMessage: Locator;
    sectorSelect: Locator;
    itemIndustryLabel: (ticker: string) => Locator;
  };
}

export class SettingsDrawerPage extends BasePage<TSettingsDrawerElements> {
  protected initializeElements(): void {
    const navItem = (slug: "profile" | "accounts" | "display" | "tickers") =>
      this.locate(`settings-nav-item-${slug}`, `Settings Nav Item (${slug})`);
    const section = (slug: "profile" | "accounts" | "display" | "tickers") =>
      this.locate(`settings-section-${slug}`, `Settings Section (${slug})`);

    this._elements = {
      ...this.locatorHelpers(),
      layout: this.locate("settings-layout", "Settings Two-Pane Layout"),
      nav: this.locate("settings-nav", "Settings Nav"),
      navMobile: this.locate("settings-nav-mobile", "Settings Mobile Nav"),
      navItem,
      section,

      // Back-compat: `drawer` is the two-pane root; tab locators point at
      // the section nav-items (clicking still drives navigation).
      drawer: this.locate("settings-layout", "Settings Layout (legacy alias)"),
      tabs: {
        profile: navItem("profile"),
        // General tab was retired (A5); aliased to display nav-item so
        // legacy `settings.actions.openGeneralTab()` redirects there.
        general: navItem("display"),
        accounts: navItem("accounts"),
        tickers: navItem("tickers"),
        display: navItem("display"),
      },

      accountCreate: {
        trigger: this.locate("accounts-add-account-trigger", "Add Account Trigger"),
        form: this.locate("account-create-form", "Account Create Form"),
        portfolioConfigLoading: this.withinByCss(
          section("accounts"),
          '[aria-busy="true"]',
          "Accounts Portfolio Config Loading",
        ),
        continueButton: this.locate("account-create-continue", "Account Create Continue"),
        backButton: this.locate("account-create-back", "Account Create Back"),
        nameInput: this.locate("account-create-name-input", "Account Create Name Input"),
        typePill: (type) =>
          this.locate(`account-create-type-${type}`, `Account Create Type Pill (${type})`),
        currencyCard: (currency) =>
          this.locate(
            `account-create-currency-${currency}`,
            `Account Create Market Card (${currency})`,
          ),
        previewChip: this.locate("account-create-preview-chip", "Account Create Preview Chip"),
        submit: this.locate("account-create-submit", "Account Create Submit"),
        error: this.locate("account-create-error", "Account Create Inline Error"),
      },
      general: {
        localeSelect: this.locate("settings-locale-select", "Locale Select"),
        quotePollInput: this.locate("settings-quote-poll-input", "Quote Poll Interval Input"),
        localeTooltipTrigger: this.locate(
          "tooltip-settings-locale-trigger",
          "Locale Tooltip Trigger",
        ),
        localeTooltipContent: this.locate(
          "tooltip-settings-locale-content",
          "Locale Tooltip Content",
        ),
        // Locale + Quote Poll + Cost Basis live under `/settings/general`
        // after the post-Phase-3d UI bugfix sweep. The section root testid
        // is `settings-section-general`; per-section anchors are
        // `general-language-section` / `general-cost-basis-section` /
        // `general-quote-poll-section`.
        calculationsSection: this.locate(
          "general-quote-poll-section",
          "Quote Poll Section",
        ),
        languageSelect: this.locate("settings-locale-select", "Locale Select"),
        languageOption: (label: RegExp | string) =>
          this.locateByRole("option", {
            name: label,
            description: `Language Option (${label})`,
          }),
        inlineAlert: this.withDescription(
          this.page.getByRole("alert").first(),
          "Inline Validation Alert",
        ),
      },
      accountsList: {
        searchInput: this.locate("accounts-tab-search", "Accounts Tab Search Input"),
        card: (accountId) =>
          this.locate(`accounts-card-${accountId}`, `Accounts Card (${accountId})`),
        cardToggle: (accountId) =>
          this.locate(
            `accounts-card-${accountId}-toggle`,
            `Accounts Card Toggle (${accountId})`,
          ),
        marketBadge: (accountId) =>
          this.locate(
            `accounts-card-${accountId}-market-badge`,
            `Accounts Card Market Badge (${accountId})`,
          ),
        accountProfileSelect: (accountId) =>
          this.locate(
            `settings-account-profile-${accountId}`,
            `Account Profile Select (${accountId})`,
          ),
        addProfile: (accountId) =>
          this.locate(
            `accounts-card-${accountId}-add-profile`,
            `Add Profile Button (${accountId})`,
          ),
        duplicateCta: (accountId) =>
          this.locate(
            `accounts-card-${accountId}-duplicate-cta`,
            `Duplicate-from-another-account CTA (${accountId})`,
          ),
        addOverride: (accountId) =>
          this.locate(
            `accounts-card-${accountId}-add-override`,
            `Add Override Button (${accountId})`,
          ),
        duplicatePicker: this.locate("accounts-duplicate-picker", "Duplicate Profile Picker"),
        duplicateSourceSelect: this.locate(
          "accounts-duplicate-source-select",
          "Duplicate Source Account Select",
        ),
        duplicateConfirm: this.locate(
          "accounts-duplicate-confirm",
          "Duplicate Confirm Button",
        ),
        duplicateCancel: this.locate(
          "accounts-duplicate-cancel",
          "Duplicate Cancel Button",
        ),
        duplicateCheckbox: (profileId) =>
          this.locate(
            `accounts-duplicate-checkbox-${profileId}`,
            `Duplicate Profile Checkbox (${profileId})`,
          ),
        profileRows: (accountId) =>
          this.withDescription(
            this.page.locator(`[data-testid^="accounts-card-${accountId}-profile-"]`),
            `Profile Rows (${accountId})`,
          ),
        profileRow: (accountId, profileId) =>
          this.locate(
            `accounts-card-${accountId}-profile-${profileId}`,
            `Profile Row (${accountId}/${profileId})`,
          ),
        profileEditButton: (profileId) =>
          this.locate(`accounts-profile-edit-${profileId}`, `Profile Edit Button (${profileId})`),
        profileNameInput: (profileId) =>
          this.locate(
            `accounts-profile-name-input-${profileId}`,
            `Profile Name Input (${profileId})`,
          ),
        profileDiscountInput: (profileId) =>
          this.locate(
            `accounts-profile-discount-${profileId}`,
            `Profile Discount Input (${profileId})`,
          ),
        profileEditDoneButton: (profileId) =>
          this.locate(
            `accounts-profile-edit-done-${profileId}`,
            `Profile Edit Done (${profileId})`,
          ),
        deleteButton: (accountId) =>
          this.locate(`account-delete-btn-${accountId}`, `Account Delete Button (${accountId})`),
        softDeleteModal: this.locate("account-soft-delete-modal", "Soft Delete Modal"),
        softDeleteConfirmButton: this.locate(
          "account-soft-delete-confirm-btn",
          "Soft Delete Confirm Button",
        ),
        softDeleteCancelButton: this.locate(
          "account-soft-delete-cancel-btn",
          "Soft Delete Cancel Button",
        ),
        softDeleteWarningOpenPositions: this.locate(
          "account-soft-delete-warning-open-positions",
          "Soft Delete Warning — Open Positions",
        ),
        softDeleteWarningCashBalance: this.locate(
          "account-soft-delete-warning-cash-balance",
          "Soft Delete Warning — Cash Balance",
        ),
        softDeleteWarningLastAccount: this.locate(
          "account-soft-delete-warning-last-account",
          "Soft Delete Warning — Last Account",
        ),
        permanentDeleteModal: this.locate(
          "account-permanent-delete-modal",
          "Permanent Delete Modal",
        ),
        permanentDeleteInput: this.locate(
          "account-permanent-delete-input",
          "Permanent Delete Typed-Name Input",
        ),
        permanentDeleteConfirmButton: this.locate(
          "account-permanent-delete-confirm-btn",
          "Permanent Delete Confirm Button",
        ),
        permanentDeleteCancelButton: this.locate(
          "account-permanent-delete-cancel-btn",
          "Permanent Delete Cancel Button",
        ),
        recentlyDeletedSection: this.locate(
          "recently-deleted-section",
          "Recently Deleted Section",
        ),
        recentlyDeletedHeader: this.locate(
          "recently-deleted-header",
          "Recently Deleted Header",
        ),
        recentlyDeletedRow: (accountId) =>
          this.locate(
            `recently-deleted-row-${accountId}`,
            `Recently Deleted Row (${accountId})`,
          ),
        recentlyDeletedRestoreButton: (accountId) =>
          this.locate(
            `recently-deleted-restore-btn-${accountId}`,
            `Recently Deleted Restore Button (${accountId})`,
          ),
        recentlyDeletedPurgeButton: (accountId) =>
          this.locate(
            `recently-deleted-purge-btn-${accountId}`,
            `Recently Deleted Purge Button (${accountId})`,
          ),
        recentlyDeletedTimeRemaining: (accountId) =>
          this.locate(
            `recently-deleted-time-remaining-${accountId}`,
            `Recently Deleted Time Remaining (${accountId})`,
          ),
      },
      profile: {
        section: this.locate("profile-section", "Profile Section"),
        displayNameInput: this.locate(
          "profile-display-name-input",
          "Profile Display Name Input (readonly)",
        ),
        emailInput: this.locate("profile-email-input", "Profile Email Input"),
        saveEmailButton: this.locate("profile-save-email", "Profile Save Email Button"),
        emailSavedIndicator: this.locate(
          "profile-email-saved",
          "Profile Email Saved Indicator",
        ),
      },
      tickers: {
        section: this.locate("monitored-tickers-section", "Monitored Tickers Section"),
        search: this.locate("tickers-search", "Tickers Search Input"),
        emptyState: this.withDescription(
          this.page.getByText("No tickers selected"),
          "Tickers Empty State",
        ),
        browseCatalogButton: this.locate("browse-catalog-btn", "Browse Full Catalog Button"),
        saveButton: this.locate("tickers-save-btn", "Tickers Save Button"),
        savedMessage: this.withDescription(
          this.page.getByText("Selections saved"),
          "Tickers Saved Message",
        ),
        positionTicker: (ticker) =>
          this.locate(`position-ticker-${ticker}`, `Position Ticker ${ticker}`),
        manualTicker: (ticker) =>
          this.locate(`manual-ticker-${ticker}`, `Manual Ticker ${ticker}`),
        backfillBadge: (ticker) =>
          this.locate(`backfill-badge-${ticker}`, `Backfill Badge ${ticker}`),
        retryBackfillButton: (ticker) =>
          this.locate(`retry-backfill-${ticker}`, `Retry Backfill Button ${ticker}`),
        repairModeButton: this.withDescription(
          this.page.getByTestId("repair-mode-toggle-btn"),
          "Repair Mode Button",
        ),
        repairCancelButton: this.withDescription(
          this.page.getByTestId("repair-cancel-btn"),
          "Repair Cancel Button",
        ),
        repairContinueButton: this.withDescription(
          this.page.getByTestId("repair-continue-btn"),
          "Repair Continue Button",
        ),
        repairCheckboxRow: (ticker) =>
          this.withDescription(
            this.page.getByTestId(`repair-row-${ticker}`),
            `Repair Checkbox Row ${ticker}`,
          ),
        repairSelection: (ticker) =>
          this.locate(`repair-selection-${ticker}`, `Repair Selection ${ticker}`),
        repairCooldownHint: (ticker) =>
          this.withDescription(
            this.page.getByTestId(`repair-cooldown-hint-${ticker}`),
            `Repair Cooldown Hint ${ticker}`,
          ),
      },
      repairModal: {
        dialog: this.withDescription(this.page.getByTestId("repair-modal"), "Repair Modal"),
        startDateInput: this.withDescription(
          this.page.getByTestId("repair-start-date"),
          "Repair Start Date Input",
        ),
        endDateInput: this.withDescription(
          this.page.getByTestId("repair-end-date"),
          "Repair End Date Input",
        ),
        includeBarsCheckbox: this.withDescription(
          this.page.getByTestId("repair-include-bars"),
          "Repair Include Bars Checkbox",
        ),
        includeDividendsCheckbox: this.withDescription(
          this.page.getByTestId("repair-include-dividends"),
          "Repair Include Dividends Checkbox",
        ),
        applyAllToggle: this.withDescription(
          this.page.getByTestId("repair-apply-all"),
          "Repair Apply-All Toggle",
        ),
        perTickerToggle: this.withDescription(
          this.page.getByTestId("repair-per-ticker"),
          "Repair Per-Ticker Toggle",
        ),
        submitButton: this.withDescription(
          this.page.getByTestId("repair-submit"),
          "Repair Submit Button",
        ),
      },
      catalog: {
        sheet: this.locate("instrument-catalog-sheet", "Instrument Catalog Sheet"),
        backButton: this.locate("catalog-back-btn", "Catalog Back Button"),
        search: this.locate("catalog-search", "Catalog Search Input"),
        list: this.locate("catalog-list", "Catalog List"),
        filterAll: this.locate("catalog-filter-all", "Catalog Filter All"),
        filterStock: this.locate("catalog-filter-stock", "Catalog Filter Stock"),
        filterEtf: this.locate("catalog-filter-etf", "Catalog Filter ETF"),
        filterBondEtf: this.locate("catalog-filter-bond_etf", "Catalog Filter Bond ETF"),
        item: (ticker) => this.locate(`catalog-item-${ticker}`, `Catalog Item ${ticker}`),
        allItems: this.withDescription(
          this.page.locator('[data-testid^="catalog-item-"]'),
          "All Catalog Items",
        ),
        itemCheckbox: (ticker) =>
          this.withinByCss(
            this.locate(`catalog-item-${ticker}`),
            "input[type=checkbox]",
            `Catalog Item Checkbox ${ticker}`,
          ),
        marketChip: (market) =>
          this.locate(`catalog-market-chip-${market.toLowerCase()}`, `Market Chip ${market}`),
        liveItemBadge: (ticker) =>
          this.locate(`catalog-live-badge-${ticker}`, `Live Badge ${ticker}`),
        liveUnavailableMessage: this.locate(
          "catalog-live-unavailable",
          "Catalog Live Unavailable Message",
        ),
        liveSearchingMessage: this.locate(
          "catalog-live-loading",
          "Catalog Live Searching Indicator",
        ),
        sectorSelect: this.locate("catalog-sector-filter", "Catalog Sector Filter"),
        itemIndustryLabel: (ticker) =>
          this.locate(
            `catalog-row-industry-group-${ticker}`,
            `Catalog Row Industry Group ${ticker}`,
          ),
      },
    };
  }
}
