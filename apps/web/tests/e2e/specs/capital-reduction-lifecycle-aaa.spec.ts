import { test, syntheticCapitalReductionFields as fields, capitalReductionScreenshotPath as screenshot } from "@vakwen/test-e2e/fixtures/capitalReductions";

test.describe("cash capital reduction reconciliation and lifecycle", () => {
  test.beforeEach(async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionCount("action", 1);
  });

  test("net receipt: book supported partial deposit → classify remaining fee without duplicate bank cash", async ({ portfolio }, testInfo) => {
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-receipt");
    await portfolio.actions.fillCapitalReduction({ "receipt-0-receivedDate": "2026-01-28", "receipt-0-evidenceReference": "SYNTH-bank-4574", "receipt-0-grossAmount": "4574", "receipt-0-cashAmount": "4574", "receipt-0-feeAmount": "0", reason: "Supported bank cash only" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "en-reconcile"), "preview");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Outstanding repayment receivable", 5);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 4574);
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-receipt");
    await portfolio.actions.fillCapitalReduction({ "receipt-1-receivedDate": "2026-01-29", "receipt-1-evidenceReference": "SYNTH-fee-5", "receipt-1-grossAmount": "5", reason: "Confirmed fee classification" });
    await portfolio.actions.classifyCapitalReductionReceipt(1);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Outstanding repayment receivable", 0);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 4574);
    await portfolio.assert.capitalReductionMetric("action", "Confirmed expenses", 5);
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "en-valuation"), "valuation");
  });

  test("unpaid fractional proceeds: confirm gross → separately date fee offset and bank receipt", async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-fraction");
    await portfolio.actions.fillCapitalReduction({ "fraction-receivedDate": "2026-01-30", "fraction-evidenceReference": "SYNTH-gross-unpaid", "fraction-grossAmount": "2", "fraction-processingFeeAmount": "0", "fraction-feeOffsetAmount": "0", "fraction-cashAmount": "0", "fraction-feeCashPaidAmount": "0", reason: "Confirmed unpaid gross" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Confirmed fractional proceeds awaiting receipt or classification", 2);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 0);
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-fraction-adjustment");
    await portfolio.actions.fillCapitalReduction({ "adjustment-0-occurredDate": "2026-02-02", "adjustment-0-evidenceReference": "SYNTH-later-fee", "adjustment-0-processingFeeAmount": "1", "adjustment-0-feeOffsetAmount": "1", "adjustment-0-cashAmount": "0", "adjustment-0-feeCashPaidAmount": "0", reason: "Independently confirmed fee" });
    await portfolio.actions.capitalReductionClick("add-fraction-adjustment");
    await portfolio.actions.fillCapitalReduction({ "adjustment-1-occurredDate": "2026-02-03", "adjustment-1-evidenceReference": "SYNTH-later-bank", "adjustment-1-processingFeeAmount": "0", "adjustment-1-feeOffsetAmount": "0", "adjustment-1-cashAmount": "1", "adjustment-1-feeCashPaidAmount": "0" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionContains("preview-fraction-adjustments", "2026-02-02");
    await portfolio.assert.capitalReductionContains("preview-fraction-adjustments", "2026-02-03");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Confirmed fractional proceeds awaiting receipt or classification", 0);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 1);
    await portfolio.assert.capitalReductionMetric("action", "Confirmed expenses", 1);
    await portfolio.assert.capitalReductionMetric("action", "Fraction result before fees", -0.31);
  });

  test("fraction fee exceeds proceeds: offset confirmed gross → later pay liability without another expense", async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-fraction");
    await portfolio.actions.fillCapitalReduction({ "fraction-receivedDate": "2026-01-30", "fraction-evidenceReference": "SYNTH-fraction-offset", "fraction-grossAmount": "2", "fraction-processingFeeAmount": "3", "fraction-feeOffsetAmount": "2", "fraction-cashAmount": "0", "fraction-feeCashPaidAmount": "0", reason: "Confirmed fee offset" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Outstanding fractional processing fee", 1);
    await portfolio.assert.capitalReductionMetric("action", "Confirmed expenses", 3);
    await portfolio.assert.capitalReductionMetric("action", "Fraction result before fees", -0.31);
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-fraction-adjustment");
    await portfolio.actions.fillCapitalReduction({ "adjustment-0-occurredDate": "2026-02-02", "adjustment-0-evidenceReference": "SYNTH-fee-payment", "adjustment-0-processingFeeAmount": "0", "adjustment-0-feeOffsetAmount": "0", "adjustment-0-cashAmount": "0", "adjustment-0-feeCashPaidAmount": "1", reason: "Pay existing fee" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionContains("preview-fraction-adjustments", "2026-02-02");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "Outstanding fractional processing fee", 0);
    await portfolio.assert.capitalReductionMetric("action", "Confirmed expenses", 3);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", -1);
  });

  test("audited correction: amend evidence → void → restore retains one action and revision history", async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("amend");
    await portfolio.actions.fillCapitalReduction({ evidenceReference: "SYNTH-corrected-delivery", reason: "Correct evidence" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionContains("linked-impact", "SYNTH-delivery-542");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.actions.capitalReductionClick("void");
    await portfolio.actions.fillCapitalReduction({ reason: "Mistaken event recorded" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionContains("linked-impact", "SYNTH-corrected-delivery");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionContains("action", "Voided");
    await portfolio.actions.capitalReductionClick("restore");
    await portfolio.actions.fillCapitalReduction({ reason: "Restore mistaken void" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionContains("action", "Revision: 4");
    await portfolio.assert.capitalReductionMetric("action", "Delivered-share cost", 25418.69);
  });

  test("amendment with later sale: reduce delivered entitlement below sold shares → reject and retain posted history", async ({ portfolio, dashboard, capitalReductionTicker }) => {
    await dashboard.arrange.seedTrade({ ticker: capitalReductionTicker, quantity: 500, unitPrice: 60, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-02-10", type: "SELL" });
    await portfolio.actions.capitalReductionClick("amend");
    await portfolio.actions.capitalReductionClick("new-version");
    await portfolio.actions.fillCapitalReduction({ ratioNumerator: "0.4", confirmedWholeQuantity: "400", reason: "Corrected source conflicts with later sale" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionVisible("blockers");
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionContains("action", "Revision: 1");
    await portfolio.assert.capitalReductionContains("action", fields.evidenceReference);
  });

  test("backdated correction: actual generation failure → retry rebuilds current valuations", async ({ portfolio, capitalReductionTicker }) => {
    await portfolio.arrange.failNextCapitalReductionGeneration(capitalReductionTicker);
    await portfolio.actions.capitalReductionClick("amend");
    await portfolio.actions.fillCapitalReduction({ evidenceReference: "SYNTH-regeneration-correction", reason: "Backdated evidence correction" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionContains("action", "Regeneration failed");
    await portfolio.assert.capitalReductionMetric("action", "Combined asset value", "Incomplete");
    await portfolio.actions.capitalReductionClick("retry-generation");
    await portfolio.assert.capitalReductionContains("action", "Historical valuations current");
    await portfolio.assert.capitalReductionMetric("action", "Combined asset value", 35908.6);
    await portfolio.assert.capitalReductionCount("action", 1);
  });

  test("position fully sold: later cash remains pending → reload ticker → reconciliation stays reachable", async ({ portfolio, dashboard, appShell, capitalReductionTicker }) => {
    await dashboard.arrange.seedTrade({ ticker: capitalReductionTicker, quantity: 542, unitPrice: 60, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-02-10", type: "SELL" });
    await appShell.actions.navigateToRoute(`/tickers/${capitalReductionTicker}?marketCode=TW&accountId=acc-1`);
    await portfolio.assert.capitalReductionVisible("open");
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.assert.capitalReductionMetric("action", "Outstanding repayment receivable", 4579);
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.assert.capitalReductionVisible("add-receipt");
    await portfolio.assert.mxAssertDeepEqual(await portfolio.arrange.capitalReductionFinancialOracle(capitalReductionTicker), { quantity: 0, cost: 0, cashEffectCount: 0 }, "Full sale clears stock while repayment remains pending");
    await portfolio.actions.capitalReductionClick("add-receipt");
    await portfolio.actions.fillCapitalReduction({ "receipt-0-receivedDate": "2026-02-12", "receipt-0-evidenceReference": "SYNTH-after-full-sale-bank", "receipt-0-grossAmount": "4579", "receipt-0-cashAmount": "4574", "receipt-0-feeAmount": "5", reason: "Receive repayment after all stock sold" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await appShell.actions.reloadPage();
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionMetric("action", "Outstanding repayment receivable", 0);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 4574);
  });
});
