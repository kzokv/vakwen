/**
 * KZO-169 — Transaction form market_code selector + symbol disambiguation.
 *
 * Covers the browser-facing acceptance criteria that are not visible from the
 * HTTP suite: chip defaults, filtered autocomplete rows, account dropdown
 * filtering, currency lock, and no-compatible-account UX.
 *
 * ui-enhancement (2026-05-13) — Item 4: the user-facing "ALL" chip is removed
 * from the transaction form (kept only in the settings catalog browser per
 * locked scope). Default chip is now the first account's market, NOT ALL.
 * Ambiguous-ticker disambiguation is exercised via the per-market chips
 * (TW/US/AU) — the ALL-mode "BHP · AU" / "BHP · US" suffix path is no
 * longer reachable from the transaction form.
 */

import { test } from "@vakwen/test-e2e/fixtures/appPages";
import type { TSettingsAssistant } from "@vakwen/test-e2e/assistants/settings";

const BHP_AU = {
  ticker: "BHP",
  name: "BHP Group Limited",
  instrumentType: "STOCK",
  marketCode: "AU",
  barsBackfillStatus: "ready",
};

const BHP_US = {
  ticker: "BHP",
  name: "BHP Group Sponsored ADR",
  instrumentType: "STOCK",
  marketCode: "US",
  barsBackfillStatus: "ready",
};

const TOYOTA_JP = {
  ticker: "7203",
  name: "Toyota Motor Corporation",
  instrumentType: "STOCK",
  marketCode: "JP",
  barsBackfillStatus: "ready",
};

async function createAccount(
  settings: TSettingsAssistant,
  name: string,
  currency: "USD" | "AUD" | "JPY",
): Promise<void> {
  await settings.actions.fillAccountCreateName(name);
  await settings.actions.selectAccountCreateType("broker");
  await settings.actions.selectAccountCreateCurrency(currency);
  await settings.actions.submitAccountCreate();
}

test("[transactions]: multi-currency user can disambiguate BHP via per-market chips + USD account filtering", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ── Arrange: seed ambiguous ticker rows + create USD/AUD accounts ────────
  await settings.arrange.seedInstruments([BHP_AU, BHP_US]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();
  await createAccount(settings, "USD Brokerage", "USD");
  await createAccount(settings, "AUD Brokerage", "AUD");
  await settings.actions.closeWithEscape();

  // ── ui-enhancement: default chip = first account's market (TWD seeded
  //    "Main" account is first → "TW"). The ALL chip is no longer rendered.
  await transactions.actions.navigateToTransactions();
  await transactions.assert.selectedMarketChipIs("TW");

  // ── Act/Assert: AU chip filters autocomplete and account options to AU.
  await transactions.actions.selectMarketChip("AU");
  await transactions.assert.selectedAccountOptionsContain(/AUD Brokerage/);
  await transactions.assert.selectedAccountOptionsExclude(/USD Brokerage/);
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.assert.comboboxOptionContains(/BHP/);

  // ── Act/Assert: switching to the US chip filters autocomplete and accounts.
  await transactions.actions.selectMarketChip("US");
  await transactions.assert.selectedAccountOptionsContain(/USD Brokerage/);
  await transactions.assert.selectedAccountOptionsExclude(/AUD Brokerage/);
  await transactions.actions.typeInTickerSearch("BHP");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.assert.comboboxOptionContains(/BHP/);

  // ── Act/Assert: selecting BHP·US locks the derived priceCurrency to USD.
  await transactions.actions.selectTickerOption("BHP", "US");
  await transactions.assert.priceCurrencyIs("USD");
});

test("[transactions]: TWD-only account set → AU market chip is hidden", async ({
  transactions,
}) => {
  // ── Act ─────────────────────────────────────────────────────────────────
  await transactions.actions.navigateToTransactions();

  // ── Assert: AU is not offered until an AUD account enables that market.
  await transactions.assert.marketChipIsAbsent("AU");
});

test("[transactions]: JP chip filters Toyota catalog rows and JPY accounts", async ({
  appShell,
  settings,
  transactions,
}) => {
  // ARRANGE: JP catalog row + a JPY brokerage account.
  await settings.arrange.seedInstruments([TOYOTA_JP]);

  await appShell.actions.navigateToRoute("/portfolio");
  await appShell.actions.openSettingsDrawer();
  await settings.arrange.openAccountsTab();
  await createAccount(settings, "JPY Brokerage", "JPY");
  await settings.actions.closeWithEscape();

  // ACT/ASSERT: JP chip scopes autocomplete and compatible account options.
  await transactions.actions.navigateToTransactions();
  await transactions.actions.selectMarketChip("JP");
  await transactions.assert.selectedAccountOptionsContain(/JPY Brokerage/);
  await transactions.actions.typeInTickerSearch("7203");
  await transactions.assert.comboboxShowsOptions(1);
  await transactions.assert.comboboxOptionContains(/Toyota/);

  await transactions.actions.selectTickerOption("7203", "JP");
  await transactions.assert.priceCurrencyIs("JPY");
});

test("[transactions]: TWD-only account set → JP market chip is hidden", async ({
  transactions,
}) => {
  // ACT
  await transactions.actions.navigateToTransactions();

  // ASSERT: JP is not offered until a JPY account enables that market.
  await transactions.assert.marketChipIsAbsent("JP");
});
