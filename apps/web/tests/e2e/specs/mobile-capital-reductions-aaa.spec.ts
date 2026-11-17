import { test, syntheticCapitalReductionFields as fields, capitalReductionScreenshotPath as screenshot } from "@vakwen/test-e2e/fixtures/capitalReductions";

for (const locale of ["en", "zh-TW"] as const) {
  test.describe(`capital reduction ${locale} narrow layouts`, () => {
    test.use({ capitalReductionLocale: locale });

    test(`holding ${locale}: sourced preview → posted timeline → reconciliation fits narrow viewport`, async ({ portfolio }, testInfo) => {
      await portfolio.assert.capitalReductionValue("account", "acc-1");
      await portfolio.assert.capitalReductionFitsViewport();
      await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, `${locale}-entry`));
      await portfolio.actions.capitalReductionClick("new");
      await portfolio.actions.fillCapitalReduction(fields);
      await portfolio.actions.previewCapitalReduction();
      await portfolio.assert.capitalReductionVisible("preview");
      await portfolio.assert.capitalReductionContains("preview", "Main");
      await portfolio.assert.capitalReductionContains("preview", "acc-1");
      await portfolio.assert.capitalReductionContains("calculation", "0.0491512");
      await portfolio.assert.capitalReductionFitsViewport();
      await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, `${locale}-preview`), "preview");
      await portfolio.actions.confirmCapitalReduction();
      await portfolio.assert.capitalReductionContains("action", locale === "en" ? "Reconciliation pending" : "待核對");
      await portfolio.assert.capitalReductionFitsViewport();
      await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, `${locale}-posted`), "action");
      await portfolio.actions.capitalReductionClick("reconcile");
      await portfolio.actions.capitalReductionClick("add-receipt");
      await portfolio.actions.fillCapitalReduction({ "receipt-0-receivedDate": "2026-01-28", "receipt-0-evidenceReference": "SYNTH-mobile-bank", "receipt-0-grossAmount": "4579", "receipt-0-cashAmount": "4574", "receipt-0-feeAmount": "5", reason: "Synthetic mobile reconciliation" });
      await portfolio.actions.previewCapitalReduction();
      await portfolio.assert.capitalReductionFitsViewport();
      await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, `${locale}-reconcile`), "preview");
      await portfolio.actions.confirmCapitalReduction();
      await portfolio.assert.capitalReductionMetric("action", locale === "en" ? "Actual bank cash" : "實際銀行現金", 4574, locale);
      await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, `${locale}-valuation`), "valuation");
    });
  });
}
