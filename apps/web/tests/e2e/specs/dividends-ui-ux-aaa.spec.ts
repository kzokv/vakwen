import { test } from "@vakwen/test-e2e/fixtures/appPages";

const TEST_TICKER = "7799";
const TEST_TICKER_NAME = "Scope Dividend Industries";
const TEST_MARKET = "TW";
const TEST_MONTH = "2026-07";

async function seedDividendUiScope({
  ticker,
  dividends,
}: {
  ticker: import("@vakwen/test-e2e/fixtures/appPages").TAppPagesFixtures["ticker"];
  dividends: import("@vakwen/test-e2e/fixtures/appPages").TAppPagesFixtures["dividends"];
}) {
  await ticker.arrange.seedInstruments([
    {
      ticker: TEST_TICKER,
      name: TEST_TICKER_NAME,
      instrumentType: "STOCK",
      marketCode: TEST_MARKET,
      barsBackfillStatus: "ready",
    },
  ]);

  const openPosted = await dividends.arrange.seedPostedDividendWithReconciliation({
    ticker: TEST_TICKER,
    eventType: "CASH",
    exDividendDate: "2026-07-08",
    paymentDate: "2026-07-24",
    cashDividendPerShare: 0.18,
    receivedCashAmount: 168,
    sourceCompositionStatus: "unknown_pending_disclosure",
    deductions: [],
    sourceLines: [],
    reconciliationStatus: "open",
  });

  await dividends.arrange.seedDividendEvent({
    ticker: TEST_TICKER,
    eventType: "CASH",
    exDividendDate: "2026-07-16",
    paymentDate: null,
    cashDividendPerShare: 0.11,
  });

  return openPosted;
}

test("[dividends-ui-ux-A]: Overview month picker, action queue, dashboard names, and ticker quick reconciliation work", async ({
  appShell,
  dashboard,
  dividends,
  ticker,
}) => {
  const posted = await seedDividendUiScope({ ticker, dividends });

  await appShell.actions.navigateToRoute(`/dividends?month=${TEST_MONTH}`);
  await dividends.assert.calendarLoaded();
  await dividends.assert.monthInputHasValue(TEST_MONTH);
  await dividends.assert.actionQueueContains(TEST_TICKER_NAME);
  await dividends.assert.thisMonthContains(TEST_TICKER_NAME);
  await dividends.assert.recentReceiptsContains(TEST_TICKER_NAME);

  await dividends.actions.setOverviewMonth("2026-08");
  await dividends.assert.urlContains("month=2026-08");

  await dashboard.actions.navigateToDashboard();
  await dashboard.assert.appIsReady();
  await dashboard.assert.dividendsSectionContains(TEST_TICKER);
  await dashboard.assert.dividendsSectionContains(TEST_TICKER_NAME);

  await appShell.actions.navigateToRoute(`/tickers/${TEST_TICKER}?marketCode=${TEST_MARKET}`);
  await ticker.assert.sectionIsVisible();
  await ticker.actions.openDividendsTab();
  await ticker.assert.dividendsPanelIsVisible();
  await ticker.assert.dividendsPanelContains(TEST_TICKER_NAME);
  await ticker.assert.dividendsOpenReviewHrefContains(TEST_TICKER, TEST_MARKET);
  await ticker.assert.dividendsUpcomingReviewLinkPreservesMarket(TEST_TICKER, TEST_MARKET);
  await ticker.assert.dividendsPostedReviewButtonIsVisible(0);

  await ticker.actions.clickDividendReconciliationMarkMatched(posted.dividendLedgerEntryId);
  await ticker.assert.dividendReconciliationMarkMatchedIsHidden(posted.dividendLedgerEntryId);
  await ticker.assert.dividendsPanelContains(/Matched|相符/);
});
