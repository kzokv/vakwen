/**
 * KZO-183 — Account-market binding E2E (dev_bypass / MemoryPersistence).
 *
 * Covers F4 scope items:
 *   AMB-1  Create account with "United States" currency card → market badge shown.
 *   AMB-2  TW-only account set → US market is absent from the transaction form.
 *   AMB-3  BUY trade against US account with US ticker (MSFT) → succeeds.
 *
 * Ticker hygiene (e2e-shared-memory-bars-ticker-hygiene.md):
 *   MSFT — verified absent from all specs/http-specs/integration test files
 *   before this file was created.
 *
 * Default seeded state (MemoryPersistence):
 *   - Account: { id: "acc-1", name: "Main", defaultCurrency: "TWD", accountType: "broker" }
 *   - Profile: { accountId: "acc-1", name: "Default Broker" }
 *   - Instruments: 2330 / 0050 / 00919 / 0056 (all TW market).
 *     MSFT must be seeded via settings.arrange.seedInstruments for AMB-2 and AMB-3.
 *
 * Rules followed:
 *   - 2 workers parallel (e2e-aaa-guardrails.md).
 *   - No networkidle (playwright-navigation-patterns.md).
 *   - Bundle rebuild via `npm run test:e2e:bypass:mem --prefix apps/web`.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";

// ─── AMB-1 ────────────────────────────────────────────────────────────────────

test("[settings drawer]: create account with United States currency card → market badge shows for that account", async ({
  appShell,
  settings,
}) => {
  // ── Arrange ───────────────────────────────────────────────────────────────
  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();

  // ── Act: fill the create-account form with USD (United States) ────────────
  await settings.actions.fillAccountCreateName("US Brokerage");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");

  // Preview chip should contain "USD" (currency code still present post-KZO-183 i18n rename).
  await settings.assert.accountCreatePreviewContains(/USD/);

  const submitResponse = await settings.actions.submitAccountCreate();
  const newAccount = (await submitResponse.json()) as { id: string };

  // ── Assert: market badge for the new account is visible ───────────────────
  // The market badge is derived from default_currency: USD → "United States" (or "US").
  // asserting with /United States|US/i guards against either label form.
  await settings.assert.accountMarketBadgeContains(newAccount.id, /United States|US/i);
});

// ─── AMB-2 ────────────────────────────────────────────────────────────────────

test("[transactions]: TW-only account set → US market chip is hidden", async ({
  transactions,
}) => {
  // ── Act ─────────────────────────────────────────────────────────────────
  await transactions.actions.navigateToTransactions();

  // ── Assert: account-derived capabilities expose TW as a static single
  //    market context. An unconfigured US market cannot be selected.
  await transactions.assert.marketChipIsAbsent("US");
});

// ─── AMB-3 ────────────────────────────────────────────────────────────────────

test("[transactions]: BUY trade against US account with US ticker MSFT succeeds (market match)", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed MSFT + create a USD brokerage account ──────────────────
  await settings.arrange.seedInstruments([
    {
      ticker: "MSFT",
      name: "Microsoft Corporation",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "none",
    },
  ]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();

  await settings.actions.fillAccountCreateName("US Brokerage");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");
  const accountResponse = await settings.actions.submitAccountCreate();
  const usAccount = (await accountResponse.json()) as { id: string };

  await settings.actions.closeWithEscape();

  // ── Act: submit a MSFT BUY against the US account ────────────────────────
  await transactions.actions.navigateToTransactions();
  await transactions.actions.selectMarketChip("US");
  await transactions.actions.selectAccountById(usAccount.id);

  await transactions.actions.selectTransactionType("BUY");
  await transactions.actions.typeInTickerSearch("MSFT");
  await transactions.actions.selectTickerOption("MSFT", "US");
  await transactions.actions.fillTradeDate("2026-01-15");
  await transactions.actions.fillQuantity(5);
  await transactions.actions.fillUnitPrice(400);

  const txResponsePromise = transactions.actions.waitForTransactionPost();
  await transactions.actions.submitTransaction();
  await txResponsePromise;

  // ── Assert: transaction appears in the recent-transactions table ──────────
  await transactions.assert.recentTransactionsTableIsVisible();
  await transactions.actions.filterTransactionHistoryByTicker("MSFT");
  await transactions.assert.recentTransactionTickerIsVisible("MSFT");
});
