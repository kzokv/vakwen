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

test("[quick actions]: configured TWD and USD accounts → Dashboard and Portfolio can change reporting currency", async ({
  appShell,
  dashboard,
  page,
}) => {
  const user = await seedUser({
    sub: "e2e-configured-capabilities-quick-actions-user",
    email: "configured-capabilities-quick-actions@example.com",
    name: "Configured Capabilities Quick Actions",
    role: "member",
  });
  await softDeleteAllActiveAccountsForUser(user.userId);
  await seedAccountForUser(user.userId, {
    name: "Quick Actions TWD",
    defaultCurrency: "TWD",
  });
  await seedAccountForUser(user.userId, {
    name: "Quick Actions USD",
    defaultCurrency: "USD",
  });
  await seedUserPreferencesForUser(user.userId, { reportingCurrency: "TWD" });
  await switchIdentity(page, { userId: user.userId, role: "member" });

  for (const [route, targetCurrency] of [
    ["/dashboard", "USD"],
    ["/portfolio", "TWD"],
  ] as const) {
    await appShell.actions.navigateToRoute(route);
    await dashboard.actions.openFloatingQuickActions();

    const selector = page.getByTestId("floating-action-reporting-currency");
    await selector.waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("floating-action-reporting-currency-loading").count(),
      0,
      `${route} Quick Actions does not remain capability-loading`,
    );

    await selector.click();
    await page.getByRole("option", { name: targetCurrency, exact: true }).click();
    await selector.waitFor({ state: "visible" });
    await appShell.assert.mxAssertTruthy(
      (await selector.textContent())?.includes(targetCurrency) ?? false,
      `${route} Quick Actions saves ${targetCurrency} as reporting currency`,
    );
  }
});

test("[accounts readiness]: delayed existing-account config → onboarding never appears before account list", async ({
  appShell,
  page,
}) => {
  const user = await seedUser({
    sub: "e2e-configured-capabilities-accounts-readiness-user",
    email: "configured-capabilities-accounts-readiness@example.com",
    name: "Configured Capabilities Accounts Readiness",
    role: "member",
  });
  await softDeleteAllActiveAccountsForUser(user.userId);
  await seedAccountForUser(user.userId, {
    name: "Existing TWD Account",
    defaultCurrency: "TWD",
  });
  await switchIdentity(page, { userId: user.userId, role: "member" });

  let releaseConfig: () => void = () => undefined;
  const configGate = new Promise<void>((resolve) => {
    releaseConfig = resolve;
  });
  await page.route("**/settings/fee-config", async (route) => {
    await configGate;
    await route.continue();
  });

  try {
    await appShell.actions.navigateToRoute("/settings/accounts");
    const accountsSection = page.getByTestId("settings-section-accounts");
    await accountsSection.waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await accountsSection.getAttribute("aria-busy"),
      "true",
      "Accounts section reports unresolved configuration as busy",
    );
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("account-create-form").count(),
      0,
      "first-account form is absent while account configuration is unresolved",
    );
    await appShell.assert.mxAssertEqual(
      await page.getByText("Set up your portfolio capabilities", { exact: true }).count(),
      0,
      "first-account onboarding copy is absent while account configuration is unresolved",
    );

    releaseConfig();
    await page.getByTestId("accounts-add-account-trigger").waitFor({ state: "visible" });
    await appShell.assert.mxAssertEqual(
      await page.getByTestId("account-create-form").count(),
      0,
      "existing-account view keeps the additional-account form collapsed after readiness",
    );
  } finally {
    releaseConfig();
    await page.unroute("**/settings/fee-config");
  }
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
