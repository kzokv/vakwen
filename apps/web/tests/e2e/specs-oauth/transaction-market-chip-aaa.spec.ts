// ui-enhancement — AAA E2E for the Record Transaction market chip cleanup
// (Item 4 from scope-todo).
//
// Coverage:
//   [no-all]    `tx-market-chip-ALL` testid never renders (scope item 20).
//   [configured] Only markets backed by the shared OAuth user's accounts render.
//
// Reserved ticker: ACCDEL05 per
// `.claude/rules/e2e-shared-memory-bars-ticker-hygiene.md`. (The auto-sync
// cross-market case requires a non-default-currency seeded account which
// the default test seed doesn't provide; the auto-sync behavior is fully
// covered by the web-unit spec `AddTransactionCard.uiEnhancement.test.tsx`
// — see the live-DOM "chip auto-sync + ticker clear" test.)

import type { Page } from "@playwright/test";
import { TestEnv } from "@vakwen/config/test";
import { test } from "@vakwen/test-e2e/fixtures/oauthPages";

async function ensureCurrencyAccount(
  page: Page,
  defaultCurrency: "USD" | "AUD",
): Promise<void> {
  const accountsResponse = await page.request.get(new URL("/accounts", TestEnv.apiBaseUrl).href);
  if (!accountsResponse.ok()) {
    throw new Error(`GET /accounts failed: ${accountsResponse.status()}`);
  }
  const accounts = await accountsResponse.json() as Array<{ defaultCurrency: string }>;
  if (accounts.some((account) => account.defaultCurrency === defaultCurrency)) return;

  const createResponse = await page.request.post(new URL("/accounts", TestEnv.apiBaseUrl).href, {
    data: {
      name: `OAuth ${defaultCurrency} Market Coverage`,
      defaultCurrency,
      accountType: "bank",
    },
  });
  if (!createResponse.ok()) {
    throw new Error(`POST /accounts failed: ${createResponse.status()} ${await createResponse.text()}`);
  }
}

test.describe("ui-enhancement — Market chip cleanup (Record Transaction)", () => {
  test("[configured] only account-backed market chips render", async ({
    appShell,
    page,
    transactions,
  }) => {
    await ensureCurrencyAccount(page, "USD");
    await ensureCurrencyAccount(page, "AUD");
    await appShell.actions.navigateToRoute("/transactions");

    await transactions.assert.marketChipIsAbsent("ALL");
    await transactions.assert.marketChipIsVisible("TW");
    await transactions.assert.marketChipIsVisible("US");
    await transactions.assert.marketChipIsVisible("AU");
    await transactions.assert.marketChipIsAbsent("KR");
    await transactions.assert.marketChipIsAbsent("JP");
  });
});
