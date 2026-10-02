import { expect, type Locator } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { AppBaseActions } from "../../bases/index.js";
import type { AppShellPage } from "../../pages/layout/AppShellPage.js";
import type { TSidebarDestination } from "../../pages/layout/SideNavigationComponent.js";

export class AppShellActions extends AppBaseActions {
  declare protected readonly _instance: AppShellPage;

  private get el() {
    return this._instance.elements;
  }

  /**
   * dnd-kit drag helper — uses `mxDragTo` + post-drop cursor reset.
   *
   * Design-doc §3 spike confirmed `Locator.dragTo` works with dnd-kit
   * defaults — no mouse.down/move/up workaround needed.
   *
   * After `dragTo`, the mouse cursor is left at the target position. dnd-kit's
   * PointerSensor can briefly retain pointer-capture state for a few ms after
   * drop, intercepting the next click and preventing the React onClick handler
   * from firing on subsequent buttons (timeframe-save-button, card buttons,
   * etc.). The post-drop `mxMoveMouse(0, 0)` moves the cursor away to release
   * any lingering capture before the test continues. Without this
   * stabilization, [timeframe-G] flakes ~25% of runs even though the assertion
   * before the click confirms the React state has committed.
   */
  private async dndKitDrag(source: Locator, target: Locator): Promise<void> {
    await this.mxDragTo(source, target);
    await this.mxMoveMouse(0, 0);
  }

  @Step()
  async navigateToRoute(path: string): Promise<void> {
    await this.mxNavigateToRoute(path, TestEnv.appBaseUrl);
  }

  /**
   * Phase 3g (§12 A8) — viewport-aware navigation that skips the
   * `breadcrumb-root` visibility wait baked into `mxWaitForAppReady`.
   *
   * At the iPad-Mini tablet viewport (768 × 1024) the TopBar's fixed-width
   * controls (sidebar trigger, mobile search button, command-palette
   * trigger with full label + ⌘K kbd, notification bell, theme toggle
   * radiogroup, profile menu) consume more horizontal space than the
   * inset content area offers once the desktop sidebar takes its 256px.
   * The `min-w-0 flex-1` breadcrumb container collapses to width 0 and
   * `toBeVisible()` returns false — even though the `<nav>` element is in
   * the DOM and contains the expected `Dashboard` link (verified via the
   * Playwright snapshot dump).
   *
   * Wait for shell client readiness without requiring the breadcrumb to be
   * visible. Server-rendered controls can appear before their handlers are
   * hydrated, so the server shell marker alone is insufficient for clicks.
   */
  @Step()
  async navigateToRouteForResponsiveTest(path: string): Promise<void> {
    await this.mxGotoUrl(new URL(path, TestEnv.appBaseUrl).href);
    await this.mxWaitForShellClientReady(30_000);
  }

  /**
   * Open the Settings page (Phase 3d — formerly opened a drawer; now
   * navigates to `/settings/profile`, the default landing section).
   *
   * Phase 3d iter 2 (architect-locked) — the method name `openSettingsDrawer`
   * is retained as a back-compat shim. ~19 specs call this directly; they
   * continue to work via the route navigation. New specs SHOULD use
   * `openSettingsSection(slug)` for typed deep-link semantics.
   */
  @Step()
  async openSettingsDrawer(): Promise<void> {
    await this.openSettingsSection("profile");
  }

  /**
   * Alias for openSettingsDrawer() — preferred call site name post-3c.
   * openSettingsDrawer() kept for backward-compat with existing spec call sites.
   */
  @Step()
  async openSettingsViaSidebar(): Promise<void> {
    await this.openSettingsDrawer();
  }

  /**
   * Phase 3d S2 — navigate to `/settings/{slug}`. Waits for the two-pane
   * `settings-layout` testid to attach so callers can immediately drive
   * the rendered section.
   */
  @Step()
  async navigateToSettingsSection(
    slug: "profile" | "accounts" | "display" | "tickers",
  ): Promise<void> {
    await this.mxNavigateToRoute(`/settings/${slug}`, TestEnv.appBaseUrl);
    await expect(this.el.settings.drawer).toBeVisible({ timeout: 10_000 });
  }

  /**
   * Phase 3d iter 2 §4.1 (architect-locked) — typed deep-link helper for
   * the route-driven `/settings/{section}` shell. Alias for
   * `navigateToSettingsSection` with the architect's preferred call-site
   * name; waits on the `settings-section-{slug}` testid (one layer deeper
   * than `settings-layout`) so callers can immediately drive section UI.
   */
  @Step()
  async openSettingsSection(
    section: "profile" | "general" | "accounts" | "display" | "tickers",
  ): Promise<void> {
    await this.mxNavigateToRoute(`/settings/${section}`, TestEnv.appBaseUrl);
    await this.el.testId(`settings-section-${section}`).waitFor({ state: "visible", timeout: 10_000 });
  }

  @Step()
  async setViewport(width: number, height: number): Promise<void> {
    await this.mxSetViewportSize(width, height);
  }

  @Step()
  async navigateViaSidebar(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.sideNavigation[destination]);
    await this.mxWaitForAppReady();
  }

  @Step()
  async reloadPage(): Promise<void> {
    await this.mxReloadPage();
  }

  /**
   * Reload and wait for shell readiness.
   * Phase 3c: topbar-title H1 is removed. Replaced by breadcrumb. Wait on
   * appReady + breadcrumb wrapper instead of the now-absent title element.
   */
  @Step()
  async reloadShellPage(): Promise<void> {
    await this.mxReloadPage({ waitForReady: false });
    await expect(this.el.appReady).toBeAttached({ timeout: 20_000 });
    await expect(this.el.topBar.breadcrumb).toBeVisible({ timeout: 20_000 });
  }

  @Step()
  async toggleDesktopSidebar(): Promise<void> {
    // 3c: desktopNavToggle → app-sidebar-trigger (shadcn collapse ‹ button)
    await this.uiActions.click.perform(this.el.desktopNavToggle);
  }

  /**
   * Click a nav item inside the open mobile sidebar Sheet.
   * Phase 3c: renamed from sidebar-link-{dest} → app-sidebar-nav-{dest}.
   * On mobile (<md), the Sheet renders the same app-sidebar content.
   */
  @Step()
  async navigateViaMobileSidebar(destination: TSidebarDestination): Promise<void> {
    // 3c: nav items are app-sidebar-nav-{destination} (no longer scoped to mobile-sidebar)
    await this.uiActions.click.perform(this.el.mobileSidebar.getByTestId(`app-sidebar-nav-${destination}`));
    await this.mxWaitForAppReady();
  }

  @Step()
  async clickMobileSidebarNavItem(destination: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.mobileSidebar.getByTestId(`app-sidebar-nav-${destination}`));
  }

  /**
   * Open the mobile sidebar Sheet by clicking the brand link.
   * Phase 3c: mobileNavToggle → app-sidebar-brand (composite trigger on <md).
   */
  @Step()
  async openMobileNavigation(): Promise<void> {
    await this.uiActions.click.perform(this.el.mobileNavToggle);
    // Wait for the Sheet / sidebar to become interactive (nav items visible)
    await this.uiActions.wait.perform(this.el.mobileSidebar.getByTestId("app-sidebar-nav-dashboard"));
  }

  /**
   * Phase 3g (§12 A8) — preferred call-site name for opening the mobile
   * sidebar Sheet. Alias of `openMobileNavigation` retained for back-compat
   * with existing specs.
   */
  @Step()
  async openMobileSidebar(): Promise<void> {
    await this.openMobileNavigation();
  }

  /**
   * Phase 3g (§12 A8) — close the mobile sidebar Sheet via Escape. shadcn
   * Sheet (built on Radix Dialog) closes on Escape by default. After the
   * keypress the Sheet content unmounts; the nav items become inaccessible.
   */
  @Step()
  async closeMobileSidebar(): Promise<void> {
    await this.mxPressKey("Escape");
    await this.el.mobileSidebar
      .getByTestId("app-sidebar-nav-dashboard")
      .waitFor({ state: "hidden", timeout: 5_000 });
  }

  /**
   * Phase 3g (§12 A8) — open the settings mobile-nav <Select> dropdown.
   */
  @Step()
  async openMobileSettingsNav(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("settings-nav-mobile"));
  }

  /**
   * Phase 3g (§12 A8) — pick a section option from the open settings
   * mobile-nav dropdown. Radix Select renders `<SelectItem>` with
   * `role="option"`; address via a CSS-selector locator scoped to the
   * Radix portal so the click resolves the right element and the
   * `aaa/no-page-access` rule stays happy.
   */
  @Step()
  async selectMobileSettingsOption(label: string): Promise<void> {
    await this.uiActions.click.perform(
      this.el.css(`[role="option"]:has-text("${label}")`, `Settings nav option "${label}"`),
    );
  }

  // ── Phase 3e — Command palette actions ──────────────────────────────────

  /** Click the topbar ⌘K trigger to open the command palette dialog. */
  @Step()
  async openCommandPalette(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("topbar-command-trigger"));
    await this.el.testId("command-palette-dialog").waitFor({ state: "visible", timeout: 5_000 });
  }

  /** Type into the palette's CommandInput. cmdk filters items per keystroke. */
  @Step()
  async typeInCommandPalette(value: string): Promise<void> {
    await this.mxFill(this.el.testId("command-palette-input"), value);
  }

  /**
   * Press Enter inside the palette — cmdk activates the currently
   * highlighted item. The default highlight is the first matching item.
   */
  @Step()
  async pressEnterInCommandPalette(): Promise<void> {
    await this.mxFocus(this.el.testId("command-palette-input"));
    await this.mxPressKey("Enter");
  }

  /** Click a specific palette item by its locked testid suffix. */
  @Step()
  async clickCommandPaletteRoute(key: string): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`command-palette-item-route-${key}`));
  }

  /** Click a specific action item (e.g. `theme-dark`, `accent-emerald`, `recompute-all`). */
  @Step()
  async clickCommandPaletteAction(key: string): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`command-palette-item-action-${key}`));
  }

  /** Review impact, then explicitly confirm the Recompute AlertDialog. */
  @Step()
  async confirmRecomputeAlertDialog(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("recompute-confirm-dialog-cta"));
    await this.el.testId("recompute-impact-preview").waitFor({ state: "visible" });
    await this.uiActions.click.perform(this.el.testId("recompute-confirm-dialog-cta"));
  }

  /** Cancel the Recompute AlertDialog (clicks the locked Cancel button). */
  @Step()
  async cancelRecomputeAlertDialog(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("recompute-confirm-dialog-cancel"));
  }

  /** Press Escape inside the open command palette — closes the dialog. */
  @Step()
  async pressEscapeInCommandPalette(): Promise<void> {
    await this.mxFocus(this.el.testId("command-palette-input"));
    await this.mxPressKey("Escape");
  }

  /**
   * Click a specific sidebar nav item by key.
   * Phase 3c addition — covers all destinations in TSidebarDestination.
   */
  @Step()
  async clickSidebarNavItem(key: TSidebarDestination): Promise<void> {
    await this.uiActions.click.perform(this.el.sideNavigation[key]);
  }

  @Step()
  async fillDesktopSearch(value: string): Promise<void> {
    await this.mxFill(this.el.search.desktopSearch, value);
  }

  @Step()
  async openMobileSearch(): Promise<void> {
    await this.uiActions.click.perform(this.el.search.mobileSearchButton);
    await this.uiActions.wait.perform(this.el.search.mobileSheet);
  }

  @Step()
  async fillMobileSearch(value: string): Promise<void> {
    await this.mxFill(this.el.search.mobileSheetInput, value);
  }

  @Step()
  async clickQuickSearchRoute(route: string, panel: "desktop" | "mobile" = "desktop"): Promise<void> {
    const container = panel === "desktop"
      ? this.el.search.desktopResults
      : this.el.search.mobileResults;
    await this.uiActions.click.perform(container.getByTestId(`quick-search-item-route-${route}`));
  }

  @Step()
  async clickQuickSearchTicker(symbol: string): Promise<void> {
    await this.uiActions.click.perform(this.el.search.desktopResults.getByRole("button", { name: new RegExp(symbol) }));
  }

  @Step()
  async openAvatarMenu(): Promise<void> {
    await this.mxWaitForAppReady();
    await this.uiActions.click.perform(this.el.topBar.avatarButton);
  }

  @Step()
  async focusAvatarButton(): Promise<void> {
    await this.mxFocus(this.el.topBar.avatarButton);
  }

  @Step()
  async clickAvatarMenuSignOut(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.avatarMenuSignOut);
  }

  @Step()
  async clickAvatarMenuSharing(): Promise<void> {
    // Phase 3c amendment #11: the avatar-menu sharing entry is RETIRED.
    // The sidebar now owns sharing navigation. Specs that previously called
    // this helper now exercise the sidebar's Sharing nav-item directly.
    await this.uiActions.click.perform(this.el.testId("app-sidebar-nav-sharing"));
  }

  @Step()
  async clickSharingGrantButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("sharing-grant-button"));
  }

  @Step()
  async clickAdminAuditToggleFilters(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("toggle-filters"));
  }

  @Step()
  async clickAdminAuditActionFilter(action: string): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`action-filter-${action}`));
  }

  @Step()
  async clickNotificationBell(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.notificationBell);
  }

  @Step()
  async clickNotificationMarkAllRead(): Promise<void> {
    await this.uiActions.click.perform(this.el.topBar.notificationMarkAllRead);
  }

  @Step()
  async clickNotificationItem(notificationId: string): Promise<void> {
    await this.uiActions.click.perform(
      this.el.testId(`notification-item-${notificationId}`),
    );
  }

  @Step()
  async clickNotificationDismiss(notificationId: string): Promise<void> {
    await this.mxHover(this.el.testId(`notification-item-${notificationId}`));
    await this.uiActions.click.perform(
      this.el.testId(`notification-dismiss-${notificationId}`),
    );
  }

  @Step()
  async clickOutsideDropdown(): Promise<void> {
    await this.mxClick(this.el.css("body", "Page Body"), { position: { x: 10, y: 10 } });
  }

  // ── Admin portal actions ──────────────────────────────────────────────────

  @Step()
  async fillAdminInviteForm(email: string, role: string): Promise<void> {
    await this.mxFill(this.el.testId("invite-email-input"), email);
    await this.mxSelectOption(this.el.testId("invite-role-select"), role);
  }

  @Step()
  async submitAdminInviteForm(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("invite-submit"));
  }

  @Step()
  async clickFirstRevokeButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.css("[data-testid^='revoke-btn-']").first());
  }

  @Step()
  async confirmDialog(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("confirm-dialog-confirm"));
  }

  // ── Admin settings actions ────────────────────────────────────────────────

  // KZO-198 — repair-cooldown form was refactored to use the shared
  // `NumericOverrideRow` component; testids are now keyed by fieldKey
  // `repair-cooldown-minutes`. The action API is unchanged so callers
  // (admin-settings-aaa.spec.ts) don't need updates.
  @Step()
  async toggleAdminSettingsOverride(enable: boolean): Promise<void> {
    // KZO-199: repair-cooldown moved into the `backfill-repair` tab. Ensure
    // that tab is active before interacting with the toggle.
    await this.ensureAdminSettingsTabActive("backfill-repair");
    const toggle = this.el.testId("admin-settings-repair-cooldown-minutes-toggle");
    if (enable) {
      await this.mxCheck(toggle);
    } else {
      await this.mxUncheck(toggle);
    }
  }

  /**
   * Helper to switch /admin/settings into a specific tab. Click the tab
   * trigger only if the panel isn't already active (the rate-limits panel
   * is the default and many tests target it without a prior click).
   *
   * admin-ui-bugs: extended slug union to include `display-defaults` and
   * `api-keys` (the Dashboard Timeframe Defaults and Provider API keys
   * cards moved into their own dedicated tabs).
   */
  @Step()
  async ensureAdminSettingsTabActive(
    slug:
      | "rate-limits"
      | "sharing"
      | "provider-health"
      | "backfill-repair"
      | "catalog-metadata"
      | "display-defaults"
      | "api-keys",
  ): Promise<void> {
    const panel = this.el.testId(`admin-settings-panel-${slug}`);
    if (await panel.isVisible().catch(() => false)) return;
    const trigger = this.el.testId(`admin-settings-tab-${slug}`);
    await this.uiActions.click.perform(trigger);
    await panel.waitFor({ state: "visible" });
  }

  /** Alias for `ensureAdminSettingsTabActive` — preferred call site name. */
  @Step()
  async navigateToAdminSettingsTab(
    slug:
      | "rate-limits"
      | "sharing"
      | "provider-health"
      | "backfill-repair"
      | "catalog-metadata"
      | "display-defaults"
      | "api-keys",
  ): Promise<void> {
    await this.ensureAdminSettingsTabActive(slug);
  }

  @Step()
  async fillAdminSettingsMinutes(value: string): Promise<void> {
    // KZO-199: repair-cooldown lives in the backfill-repair tab.
    await this.ensureAdminSettingsTabActive("backfill-repair");
    await this.mxFill(this.el.testId("admin-settings-repair-cooldown-minutes-input"), value);
  }

  @Step()
  async clickAdminSettingsSave(): Promise<void> {
    // KZO-199: repair-cooldown lives in the backfill-repair tab.
    await this.ensureAdminSettingsTabActive("backfill-repair");
    await this.uiActions.click.perform(
      this.el.testId("admin-settings-repair-cooldown-minutes-save-button"),
    );
  }

  // ── KZO-159 — Admin timeframe defaults section actions ────────────────────
  //
  // Each active range is rendered as a row:
  //   • `timeframe-chip-${range}`          — toggle-off (clicking removes it)
  //   • `timeframe-drag-handle-${range}`   — dnd-kit drag handle (KZO-161 F4a)
  //
  // NOTE: `timeframe-chip-up-${range}` and `timeframe-chip-down-${range}`
  // have been removed — the ↑↓ buttons were replaced by dnd-kit drag handles
  // in KZO-161 F4a. Use `dragAdminTimeframeChip()` instead.
  //
  // Predefined chips not in the active list appear in the "Available" row
  // with the same `timeframe-chip-${range}` testid but `data-active="false"`.

  @Step()
  async clickAdminTimeframeChip(range: string): Promise<void> {
    await this.ensureAdminSettingsTabActive("display-defaults");
    await this.uiActions.click.perform(this.el.testId(`timeframe-chip-${range}`));
  }

  /**
   * Drag a timeframe chip to reorder it in the admin settings list.
   * Uses the dnd-kit drag handle testid `timeframe-drag-handle-{range}`.
   * `from` = the range to move; `to` = the range whose position to drop onto.
   */
  @Step()
  async dragAdminTimeframeChip(from: string, to: string): Promise<void> {
    await this.ensureAdminSettingsTabActive("display-defaults");
    const order = await this.adminActiveTimeframeOrder();
    const fromIndex = order.indexOf(from);
    const toIndex = order.indexOf(to);
    expect(fromIndex, `source timeframe ${from} exists in active order`).toBeGreaterThanOrEqual(0);
    expect(toIndex, `target timeframe ${to} exists in active order`).toBeGreaterThanOrEqual(0);
    if (fromIndex === toIndex) return;

    const sourceHandle = this.el.testId(`timeframe-drag-handle-${from}`);
    await this.mxFocus(sourceHandle);
    await expect(sourceHandle).toBeFocused();

    // Use the handle's ArrowUp/ArrowDown keyboard affordance for this compact
    // adjacent-row list. Pointer drops can land back on the source row when
    // handles are close together; the arrow path still exercises onReorder.
    const key = toIndex > fromIndex ? "ArrowDown" : "ArrowUp";
    for (let i = 0; i < Math.abs(toIndex - fromIndex); i += 1) {
      await this.mxPressKey(key);
    }
    await this.mxMoveMouse(0, 0);
  }

  private async adminActiveTimeframeOrder(): Promise<string[]> {
    const count = await this.el.adminActiveTimeframeChips.count();
    const order: string[] = [];
    for (let i = 0; i < count; i += 1) {
      const testId = await this.el.adminActiveTimeframeChips.nth(i).getAttribute("data-testid");
      if (testId?.startsWith("timeframe-chip-")) {
        order.push(testId.slice("timeframe-chip-".length));
      }
    }
    return order;
  }

  @Step()
  async fillAdminTimeframeAddInput(value: string): Promise<void> {
    await this.ensureAdminSettingsTabActive("display-defaults");
    await this.mxFill(this.el.testId("timeframe-add-input"), value);
  }

  @Step()
  async clickAdminTimeframeAddButton(): Promise<void> {
    await this.ensureAdminSettingsTabActive("display-defaults");
    await this.uiActions.click.perform(this.el.testId("timeframe-add-button"));
  }

  @Step()
  async clickAdminTimeframeReset(): Promise<void> {
    await this.ensureAdminSettingsTabActive("display-defaults");
    await this.uiActions.click.perform(this.el.testId("timeframe-reset-button"));
  }

  @Step()
  async clickAdminTimeframeSave(): Promise<void> {
    await this.ensureAdminSettingsTabActive("display-defaults");
    await this.uiActions.click.perform(this.el.testId("timeframe-save-button"));
  }

  // ── KZO-161 — User timeframe customization popover actions ────────────────

  /**
   * Click the gear button on PortfolioTrendCard to open the customize popover.
   */
  @Step()
  async openTimeframeCustomize(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("timeframe-gear-btn"));
    await expect(this.el.testId("timeframe-customize-popover")).toBeVisible();
  }

  /**
   * Drag a range row within the customize popover to reorder it.
   * `from` = the range to move; `to` = the range whose position to drop onto.
   */
  @Step()
  async dragTimeframeRange(from: string, to: string): Promise<void> {
    await this.dndKitDrag(
      this.el.testId(`timeframe-drag-handle-${from}`),
      this.el.testId(`timeframe-drag-handle-${to}`),
    );
  }

  /**
   * Toggle per-row range visibility inside the customize popover or Display tab.
   * Clicks the `timeframe-toggle-{range}` checkbox/button.
   */
  @Step()
  async toggleTimeframeRange(range: string): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`timeframe-toggle-${range}`));
  }

  @Step()
  async fillTimeframeCustomInput(value: string): Promise<void> {
    await this.mxFill(this.el.testId("timeframe-custom-input"), value);
  }

  @Step()
  async clickTimeframeAddButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("timeframe-add-btn"));
  }

  /** Save button in the user-facing customize popover / Display tab. */
  @Step()
  async clickTimeframeSaveButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("timeframe-save-btn"));
  }

  /** Reset button in the user-facing customize popover / Display tab. */
  @Step()
  async clickTimeframeResetButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("timeframe-reset-btn"));
  }

  // ── KZO-161 — Settings Display tab actions (Phase 3d S10 — repointed) ────

  /**
   * Phase 3d iter 2 (architect-locked) — REPOINTED from the deleted
   * `settings-tab-display` button click. Now navigates to `/settings/display`
   * and waits for the section root. Existing specs-oauth callers
   * (dashboard-timeframe, transactions-card-reorder, portfolio-card-reorder,
   * dashboard-reporting-currency, card-reorder) continue working via this
   * back-compat shim. New specs SHOULD use `openSettingsSection("display")`.
   */
  @Step()
  async clickSettingsDisplayTab(): Promise<void> {
    await this.openSettingsSection("display");
    // Existing callers also expect the timeframes section to be visible
    // (it's the Phase-2 DisplayTabSection rendered verbatim inside the
    // route's DisplaySettingsClient).
    await expect(this.el.testId("display-timeframes-section")).toBeVisible();
  }

  /**
   * KZO-162 — Click the global "Reset all layouts" button in the Display tab.
   * Sends PATCH /user-preferences { cardOrder: null } (clears every page's
   * saved order atomically).
   */
  @Step()
  async clickResetAllLayoutsButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("reset-all-layouts-btn"));
  }

  /**
   * KZO-162 — Click the per-page "Reset dashboard layout" button. Sends
   * PATCH /user-preferences { cardOrder: { dashboard: null } } (clears just
   * the dashboard sub-key while preserving the others).
   */
  @Step()
  async clickResetDashboardLayoutButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("reset-dashboard-layout-btn"));
  }

  /**
   * KZO-162 — Click the per-page "Reset transactions layout" button. Sends
   * PATCH /user-preferences { cardOrder: { transactions: null } }.
   */
  @Step()
  async clickResetTransactionsLayoutButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("reset-transactions-layout-btn"));
  }

  /**
   * KZO-162 — Click the per-page "Reset portfolio layout" button. Sends
   * PATCH /user-preferences { cardOrder: { portfolio: null } }.
   */
  @Step()
  async clickResetPortfolioLayoutButton(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("reset-portfolio-layout-btn"));
  }

  // ── KZO-161 — Card reorder actions (F5) ──────────────────────────────────

  /**
   * Drag a dashboard card to a new position.
   * `from` = slug of the card to move; `to` = slug of the destination card.
   * Uses `card-drag-handle-{slug}` testids.
   */
  @Step()
  async dragCard(from: string, to: string): Promise<void> {
    await this.dndKitDrag(
      this.el.testId(`card-drag-handle-${from}`),
      this.el.testId(`card-${to}`),
    );
  }

  // ── ui-reshape Phase 2 — Theme · Accent · Density ─────────────────────────

  /**
   * Click one of the three theme-toggle buttons in the TopBar.
   * Persists via next-themes localStorage ("vakwen-theme").
   */
  @Step()
  async clickThemeToggle(mode: "light" | "system" | "dark"): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`theme-toggle-${mode}`));
  }

  /** Click one of the 8 preset accent swatches in Settings → Display. */
  @Step()
  async clickAccentSwatch(
    preset: "indigo" | "violet" | "blue" | "cyan" | "emerald" | "amber" | "rose" | "slate",
  ): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`display-accent-swatch-${preset}`));
  }

  /** Open the custom-color picker panel (9th swatch). */
  @Step()
  async openCustomAccentPicker(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("display-accent-swatch-custom"));
    await expect(this.el.testId("display-custom-accent-panel")).toBeVisible();
  }

  /** Type a hex value into the custom-accent picker's hex input. */
  @Step()
  async setCustomAccentHex(hex: string): Promise<void> {
    await this.uiActions.fill.perform(this.el.testId("display-custom-accent-hex-input"), hex);
  }

  /** Click Apply in the custom-accent picker. */
  @Step()
  async applyCustomAccent(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("display-custom-accent-apply"));
  }

  /** Click Reset-to-Indigo in the custom-accent picker. */
  @Step()
  async resetCustomAccent(): Promise<void> {
    await this.uiActions.click.perform(this.el.testId("display-custom-accent-reset"));
  }

  /** Click Compact or Comfortable density toggle. */
  @Step()
  async clickDensityToggle(mode: "compact" | "comfortable"): Promise<void> {
    await this.uiActions.click.perform(this.el.testId(`display-density-toggle-${mode}`));
  }

  /** Click one of the Settings → Display gain/loss color convention options. */
  @Step()
  async clickPriceColorConvention(
    convention: "gain_green_loss_red" | "gain_red_loss_green",
  ): Promise<void> {
    const patchResponse = this.mxWaitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname.endsWith("/user-preferences") && response.request().method() === "PATCH";
    });
    await this.uiActions.click.perform(this.el.testId(`display-price-color-convention-${convention}`));
    expect((await patchResponse).ok(), "PATCH /user-preferences").toBeTruthy();
  }

  /** Ensure a deterministic gain/loss color convention baseline for a spec. */
  @Step()
  async ensurePriceColorConvention(
    convention: "gain_green_loss_red" | "gain_red_loss_green",
  ): Promise<void> {
    const option = this.el.testId(`display-price-color-convention-${convention}`);
    if (await option.getAttribute("aria-checked") !== "true") {
      await this.clickPriceColorConvention(convention);
      await expect(option).toHaveAttribute("aria-checked", "true");
    }
  }
}
