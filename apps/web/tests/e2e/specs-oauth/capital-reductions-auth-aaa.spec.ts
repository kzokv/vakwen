import { test } from "@vakwen/test-e2e/fixtures/capitalReductionsOAuth";
import { syntheticCapitalReductionFields as fields } from "@vakwen/test-e2e/fixtures/capitalReductions";

test.describe("cash capital reduction authenticated account scope", () => {
  test.describe.configure({ timeout: 30_000 });

  test("OAuth owner: holding detail account → preview and confirm → one pending history", async ({ portfolio, appShell }) => {
    await portfolio.actions.navigateToPortfolio();
    await portfolio.actions.setDisplayModeExpanded();
    await portfolio.actions.openHoldingActivity();
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionMetric("calculation", "Expected whole shares", "542");
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionContains("action", "Reconciliation pending");
    await portfolio.assert.capitalReductionMetric("action", "Outstanding repayment receivable", 4579);
    await appShell.actions.navigateToRoute("/tickers/SYNTH?marketCode=TW&accountId=acc-1");
    await portfolio.assert.capitalReductionCount("panel", 1);
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.assert.capitalReductionCount("action", 1);
    const secondaryAccountId = await portfolio.arrange.createCapitalReductionScopeAccount();
    await appShell.actions.navigateToRoute(`/tickers/SYNTH?marketCode=TW&accountId=${secondaryAccountId}`);
    await portfolio.assert.capitalReductionCount("panel", 1);
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", secondaryAccountId);
    await portfolio.assert.capitalReductionVisible("timeline");
    await portfolio.assert.capitalReductionCount("action", 0);
  });

  test("OAuth reader: inspect scoped holding → mutation controls hidden and write API denied", async ({ portfolio, session, capitalReductionOAuthToken }) => {
    const cookie = await portfolio.arrange.capitalReductionOAuthRole(capitalReductionOAuthToken, "viewer");
    await session.actions.replaceSessionFromSetCookieHeader(cookie);
    await portfolio.actions.navigateToPortfolio();
    await portfolio.actions.setDisplayModeExpanded();
    await portfolio.actions.openHoldingActivity();
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.assert.capitalReductionContains("panel", "You have read-only access to this account.");
    await portfolio.assert.capitalReductionVisible("timeline");
    await portfolio.assert.capitalReductionCount("new", 0);
    await portfolio.assert.capitalReductionCount("register-announcement", 0);
    await portfolio.assert.mxAssertEqual(await portfolio.arrange.capitalReductionWriteStatus(), 403, "Viewer cannot request a financial write preview");
  });
});
