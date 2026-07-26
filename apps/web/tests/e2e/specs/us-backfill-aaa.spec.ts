/**
 * KZO-170 — US backfill E2E (dev_bypass / MemoryPersistence).
 *
 * Covers the browser-facing acceptance criterion that is not visible from the
 * HTTP suite: a user enters an AAPL trade through the chip-selector form
 * (with marketCode=US selected against a USD account), the transaction posts,
 * and the recent transactions table reflects the trade. The backfill itself
 * runs through the in-memory provider mock (the production pg-boss path is
 * exercised by the integration tests).
 *
 * G-CRIT-3 CONSTRAINT (HARD):
 *   ALL US trade dates in this file are >= 2024-01-01. The
 *   MockFinMindUsStockMarketDataProvider's fixture series start at 2024-01-01
 *   (post all known splits, sidesteps the splits gap from D3). Tests that need
 *   to exercise pre-2024 truncation must use a constructor variant of the mock
 *   that controls the fixture start — those live in the integration suite, not
 *   here.
 *
 * Reserved US ticker per scope-todo D8:
 *   AAPL — owned by `us-backfill-aaa.spec.ts` (this file).
 *   Other reserved US tickers (VOO / MSFT / BND) belong to other US specs
 *   per `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`.
 *
 * Dev_bypass seed identity: per `.claude/rules/e2e-seed-testuser-userid.md`,
 * the test relies on the appShell fixture's per-test user (the `tw_e2e_user`
 * cookie carries `testUser.userId`); seed helpers don't pass an explicit
 * owner override because all observable state here is the per-test default
 * account.
 *
 * Companion rules followed:
 *   - .claude/rules/e2e-aaa-guardrails.md — 2 workers parallel, no fullyParallel.
 *   - .claude/rules/playwright-navigation-patterns.md — no networkidle.
 *   - .claude/rules/playwright-web-bundle-rebuild.md — `npm run test:e2e:bypass:mem`.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";

const AAPL_US = {
  ticker: "AAPL",
  name: "Apple Inc.",
  instrumentType: "STOCK" as const,
  marketCode: "US" as const,
  barsBackfillStatus: "ready",
};

test("[transactions]: AAPL US trade against USD account → posted, recent table shows AAPL", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed AAPL as a US instrument + create a USD account ─────────
  await settings.arrange.seedInstruments([AAPL_US]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();

  await settings.actions.fillAccountCreateName("US Brokerage");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("USD");
  const accountResponse = await settings.actions.submitAccountCreate();
  const usAccount = (await accountResponse.json()) as { id: string };

  await settings.actions.closeWithEscape();

  // ── Act: enter the AAPL/US BUY through the chip-selector form ────────────
  await transactions.actions.navigateToTransactions();

  // The seeded TWD "Main" account is first, so the form starts on TW. Select
  // US before choosing the USD account because the account dropdown is now
  // filtered by the selected market's compatible currency.
  await transactions.actions.selectMarketChip("US");
  await transactions.actions.selectAccountById(usAccount.id);
  await transactions.actions.selectTransactionType("BUY");
  await transactions.actions.typeInTickerSearch("AAPL");
  await transactions.actions.selectTickerOption("AAPL", "US");

  await transactions.actions.fillTradeDate("2024-06-14"); // G-CRIT-3
  await transactions.actions.fillQuantity(10);
  await transactions.actions.fillUnitPrice(195);

  // Form should report the trade currency as USD (currencyFor("US") === "USD").
  await transactions.assert.priceCurrencyIs("USD");

  const txResponsePromise = transactions.actions.waitForTransactionPost();
  await transactions.actions.submitTransaction();
  await txResponsePromise;

  // ── Assert: the transaction landed and is reflected in the recent table ─
  await transactions.assert.recentTransactionsTableIsVisible();
  await transactions.actions.filterTransactionHistoryByTicker("AAPL");
  await transactions.assert.recentTransactionTickerIsVisible("AAPL");
});

test("[transactions]: TWD-only account set → US market chip is hidden", async ({
  transactions,
}) => {
  // ── Act ─────────────────────────────────────────────────────────────────
  await transactions.actions.navigateToTransactions();

  // ── Assert: US is not offered until a USD account enables that market.
  await transactions.assert.marketChipIsAbsent("US");
});
