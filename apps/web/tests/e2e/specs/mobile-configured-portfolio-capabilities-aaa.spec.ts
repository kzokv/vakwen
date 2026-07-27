import { test } from "@vakwen/test-e2e/fixtures/appPages";
import {
  seedUser,
  softDeleteAllActiveAccountsForUser,
  switchIdentity,
} from "./helpers/sharing";

test("[mobile configured capabilities]: zero-account dividends → market-first setup fits the viewport", async ({
  appShell,
  page,
}) => {
  const user = await seedUser({
    sub: "e2e-mobile-configured-capabilities-zero-user",
    email: "mobile-configured-capabilities-zero@example.com",
    name: "Mobile Configured Capabilities Zero",
    role: "member",
  });
  await softDeleteAllActiveAccountsForUser(user.userId);
  await switchIdentity(page, { userId: user.userId, role: "member" });

  await appShell.actions.navigateToRouteForResponsiveTest("/dividends");
  await page
    .getByTestId("portfolio-capabilities-zero-account-gate")
    .waitFor({ state: "visible" });
  await page.getByTestId("portfolio-capabilities-zero-account-cta").click();

  await page.getByTestId("account-create-form").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-TWD").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-USD").waitFor({ state: "visible" });
  await page.getByTestId("account-create-currency-TWD").click();
  await page.getByTestId("account-create-continue").click();
  await page.getByTestId("account-create-name-input").waitFor({ state: "visible" });

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await appShell.assert.mxAssertTruthy(
    overflow <= 1,
    `market-first account setup has no horizontal overflow (overflow=${overflow}px)`,
  );
});
