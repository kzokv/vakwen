import { test, syntheticCapitalReductionFields as fields } from "@vakwen/test-e2e/fixtures/capitalReductions";

test.describe("cash capital reduction valuation", () => {
  test.describe("isolated synthetic matching quote", () => {
    test.use({ capitalReductionTicker: "SYNTHQ" });

    test("new share basis: old quote → official reference → matching new quote replaces reference", async ({ portfolio, dashboard, appShell }) => {
      await portfolio.actions.capitalReductionClick("new");
      await portfolio.actions.fillCapitalReduction(fields);
      await portfolio.actions.previewCapitalReduction();
      await portfolio.actions.confirmCapitalReduction();
      await portfolio.assert.capitalReductionContains("action", "Official new-share reference valuation");
      await portfolio.assert.capitalReductionMetric("action", "Share valuation price", 57.8);
      await portfolio.assert.capitalReductionMetric("action", "Delivered-share value", 31327.6);
      await portfolio.assert.capitalReductionMetric("action", "Repayment receivable value", 4579);
      await portfolio.assert.capitalReductionMetric("action", "Pending fraction estimated gross value", 2);
      await portfolio.assert.capitalReductionMetric("action", "Combined asset value", 35908.6);
      await dashboard.arrange.seedDailyBars([{ ticker: "SYNTHQ", barDate: "2026-11-16", open: 60.25, high: 60.25, low: 60.25, close: 60.25, volume: 1000 }]);
      await appShell.actions.reloadPage();
      await portfolio.actions.setDisplayModeExpanded();
      await portfolio.actions.openHoldingActivity("SYNTHQ");
      await portfolio.actions.capitalReductionClick("open");
      await portfolio.assert.capitalReductionContains("action", "Market quote on the new-share basis");
      await portfolio.assert.capitalReductionMetric("action", "Share valuation price", 60.25);
      await portfolio.assert.capitalReductionMetric("action", "Delivered-share value", 32655.5);
    });
  });

  test("missing reference inputs: confirm conversion → affected total remains incomplete", async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction({ ...fields, officialReferencePrice: "", fractionReferencePrice: "" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionContains("action", "Valuation incomplete");
    await portfolio.assert.capitalReductionMetric("action", "Combined asset value", "Incomplete");
    await portfolio.assert.capitalReductionMetric("action", "Pending fraction estimated gross value", "Incomplete");
  });

  test("NAV components: confirmed bank fee → cash plus remaining assets accounts for expense once", async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.capitalReductionClick("add-receipt");
    await portfolio.actions.fillCapitalReduction({ "receipt-0-receivedDate": "2026-01-28", "receipt-0-evidenceReference": "SYNTH-full-net", "receipt-0-grossAmount": "4579", "receipt-0-cashAmount": "4574", "receipt-0-feeAmount": "5" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 4574);
    await portfolio.assert.capitalReductionMetric("action", "Confirmed expenses", 5);
    await portfolio.assert.capitalReductionMetric("action", "Delivered-share cost", 25418.69);
    await portfolio.assert.capitalReductionMetric("action", "Repayment receivable value", 0);
    await portfolio.assert.capitalReductionMetric("action", "Pending fraction estimated gross value", 2);
    await portfolio.assert.capitalReductionMetric("action", "Combined asset value", 31329.6);
  });
});
