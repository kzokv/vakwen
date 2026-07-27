/**
 * KZO-172 — AU backfill E2E (dev_bypass / MemoryPersistence).
 *
 * Covers the browser-facing acceptance criterion that is not visible from the
 * HTTP suite: a user enters a BHP trade through the chip-selector form
 * (with marketCode=AU selected against an AUD account), the transaction posts,
 * and the recent transactions table reflects the trade. The backfill itself
 * runs through the in-memory provider mock (the production pg-boss path is
 * exercised by the integration tests).
 *
 * AU FIXTURE-START CONSTRAINT (HARD):
 *   ALL AU trade dates in this file are >= 2024-01-02. The
 *   MockYahooFinanceAuMarketDataProvider's fixture series start at 2024-01-02
 *   per scope-todo §2 (default `fixtureStartDate`). Tests that need to
 *   exercise pre-1988 truncation or other history-start edge cases must use a
 *   constructor variant of the mock that controls the fixture start — those
 *   live in the integration suite (`auStockBackfill.integration.test.ts`),
 *   not here.
 *
 * Reserved AU tickers per scope-todo Phase 9 + `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`:
 *   BHP, CSL, WBC — owned by `au-backfill-aaa.spec.ts` (this file).
 *   VAS, AFI       — reserved for future AU specs (au-etf-aaa, au-lic-aaa).
 *   GMG, IMD       — reserved for Postgres-only `auStockBackfill.integration.test.ts`.
 *   CBA            — reserved for KZO-188's `au-ticker-discovery-aaa.spec.ts`.
 *   Other AU specs (au-dividends-aaa) reuse BHP per the rule's reservation note.
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
 *   - .claude/rules/playwright-fast-sse-assertions.md — accept multi-state assertions on mutation-status.
 *   - .claude/rules/playwright-duplicate-testid-pattern.md — use .first() on duplicated testids.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";

const BHP_AU = {
  ticker: "BHP",
  name: "BHP Group Limited",
  instrumentType: "STOCK" as const,
  marketCode: "AU" as const,
  barsBackfillStatus: "ready",
};

test("[transactions]: BHP AU trade against AUD account → posted, recent table shows BHP", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed BHP as an AU instrument + create an AUD account ────────
  await settings.arrange.seedInstruments([BHP_AU]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();

  await settings.actions.fillAccountCreateName("AU Brokerage");
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency("AUD");
  const accountResponse = await settings.actions.submitAccountCreate();
  const auAccount = (await accountResponse.json()) as { id: string };

  await settings.actions.closeWithEscape();

  // ── Act: enter the BHP/AU BUY through the chip-selector form ─────────────
  await transactions.actions.navigateToTransactions();

  // The seeded TWD "Main" account is first, so the form starts on TW. Select
  // AU before choosing the AUD account because the account dropdown is now
  // filtered by the selected market's compatible currency.
  await transactions.actions.selectMarketChip("AU");
  await transactions.actions.selectAccountById(auAccount.id);
  await transactions.actions.selectTransactionType("BUY");
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.actions.selectTickerOption("BHP", "AU");

  await transactions.actions.fillTradeDate("2024-06-14"); // AU fixture start ≥ 2024-01-02
  await transactions.actions.fillQuantity(50);
  await transactions.actions.fillUnitPrice(45);

  // Form should report the trade currency as AUD (currencyFor("AU") === "AUD").
  await transactions.assert.priceCurrencyIs("AUD");

  const txResponsePromise = transactions.actions.waitForTransactionPost();
  await transactions.actions.submitTransaction();
  await txResponsePromise;

  // ── Assert: the transaction landed and is reflected in the recent table ─
  await transactions.assert.recentTransactionsTableIsVisible();
  await transactions.actions.filterTransactionHistoryByTicker("BHP");
  await transactions.assert.recentTransactionTickerIsVisible("BHP");
});

test("[transactions]: TWD-only account set → AU market chip is hidden", async ({
  transactions,
}) => {
  // ── Act ─────────────────────────────────────────────────────────────────
  await transactions.actions.navigateToTransactions();

  // ── Assert: AU is not offered until an AUD account enables that market.
  await transactions.assert.marketChipIsAbsent("AU");
});
