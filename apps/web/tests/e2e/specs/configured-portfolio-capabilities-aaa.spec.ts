import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedUser,
  seedAccountForUser,
  seedUserPreferencesForUser,
  softDeleteAllActiveAccountsForUser,
  switchIdentity,
} from "./helpers/sharing";

test("[configured capabilities]: TWD-only portfolio → static TW controls, stale report fallback, and FX enablement", async ({
  appShell,
  page,
}) => {
  const user = await seedUser({
    sub: "e2e-configured-capabilities-twd-user",
    email: "configured-capabilities-twd@example.com",
    name: "Configured Capabilities TWD",
    role: "member",
  });
  await softDeleteAllActiveAccountsForUser(user.userId);
  await seedAccountForUser(user.userId, {
    name: "TWD only",
    defaultCurrency: "TWD",
  });
  await switchIdentity(page, { userId: user.userId, role: "member" });

  // Act + Assert: transaction entry renders static TW context and never
  // exposes an unconfigured US market control.
  await appShell.actions.navigateToRoute("/transactions");
  await page.getByTestId("tx-market-context-single").waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    await page.getByTestId("tx-market-chip-US").count(),
    0,
    "unconfigured US transaction market is absent",
  );

  // Act + Assert: a stale US report scope normalizes to TW, replaces the URL,
  // and explains the adjustment.
  await appShell.actions.navigateToRoute("/reports?tab=portfolio&scope=US&range=1Y");
  await page
    .getByTestId("portfolio-capabilities-normalization-notice-reportScope")
    .waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    new URL(page.url()).searchParams.get("scope"),
    "TW",
    "stale report scope is replaced with the configured TW scope",
  );
  await page
    .getByTestId("portfolio-capabilities-single-context-report-scope")
    .waitFor({ state: "visible" });

  // Act + Assert: one distinct currency cannot record an FX transfer and
  // instead links the user back to account creation.
  await appShell.actions.navigateToRoute("/cash-ledger");
  await page.getByTestId("fx-transfer-enablement").waitFor({ state: "visible" });
  await appShell.assert.mxAssertEqual(
    await page.getByTestId("new-fx-transfer-button").count(),
    0,
    "FX transfer action is absent until two currencies are configured",
  );
});

test("[reporting fallback]: delete final TWD account → initiating shell immediately exposes USD only", async ({
  appShell,
  page,
  settings,
}) => {
  const user = await seedUser({
    sub: "e2e-configured-capabilities-fallback-user",
    email: "configured-capabilities-fallback@example.com",
    name: "Configured Capabilities Fallback",
    role: "member",
  });
  await softDeleteAllActiveAccountsForUser(user.userId);
  const twd = await seedAccountForUser(user.userId, {
    name: "Fallback TWD",
    defaultCurrency: "TWD",
  });
  await seedAccountForUser(user.userId, {
    name: "Fallback USD",
    defaultCurrency: "USD",
  });
  await seedUserPreferencesForUser(user.userId, { reportingCurrency: "TWD" });
  await switchIdentity(page, { userId: user.userId, role: "member" });

  await appShell.actions.navigateToRoute("/settings/accounts");
  await settings.assert.accountDeleteButtonIsVisible(twd.id);
  await settings.actions.clickAccountDeleteButton(twd.id);
  await settings.assert.softDeleteModalIsVisible();
  await settings.actions.confirmSoftDelete();
  await settings.assert.accountCardIsHidden(twd.id);

  await appShell.actions.navigateToRoute("/settings/display");
  const singleCurrency = page.getByTestId("display-reporting-currency-single");
  await singleCurrency.waitFor({ state: "visible" });
  await appShell.assert.mxAssertTruthy(
    (await singleCurrency.textContent())?.includes("USD") ?? false,
    "reporting currency falls back to the remaining configured USD account",
  );
  await appShell.assert.mxAssertEqual(
    await page.getByTestId("reporting-currency-select").count(),
    0,
    "single remaining reporting currency renders as static context",
  );
});

test("[zero-account onboarding]: no active accounts → dividends gate preserves return route into market-first setup", async ({
  appShell,
  page,
  settings,
}) => {
  const user = await seedUser({
    sub: "e2e-configured-capabilities-zero-user",
    email: "configured-capabilities-zero@example.com",
    name: "Configured Capabilities Zero",
    role: "member",
  });
  await softDeleteAllActiveAccountsForUser(user.userId);
  await switchIdentity(page, { userId: user.userId, role: "member" });

  await appShell.actions.navigateToRoute("/dividends");
  await page
    .getByTestId("portfolio-capabilities-zero-account-gate")
    .waitFor({ state: "visible" });
  await page.getByTestId("portfolio-capabilities-zero-account-cta").click();
  await page.getByTestId("account-create-form").waitFor({ state: "visible" });

  const target = new URL(page.url());
  await appShell.assert.mxAssertEqual(
    target.pathname,
    "/settings/accounts",
    "zero-account CTA opens account settings",
  );
  await appShell.assert.mxAssertEqual(
    target.searchParams.get("returnTo"),
    "/dividends",
    "zero-account CTA preserves the originating route",
  );
  await settings.assert.accountCreateFormIsVisible();
  await page.getByTestId("account-create-currency-TWD").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-USD").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-AUD").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-KRW").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-JPY").waitFor({ state: "visible" });
});
