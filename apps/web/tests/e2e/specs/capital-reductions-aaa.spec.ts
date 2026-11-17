import { test, syntheticCapitalReductionFields as fields, capitalReductionScreenshotPath as screenshot } from "@vakwen/test-e2e/fixtures/capitalReductions";

test.describe("cash capital reduction contextual entry", () => {
  test("holding account: preview exact entitlement → explicit confirmation persists one pending action", async ({ portfolio, appShell, capitalReductionTicker }, testInfo) => {
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "en-entry"));
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionVisible("preview");
    await portfolio.assert.capitalReductionCount("blockers", 0);
    await portfolio.assert.capitalReductionMetric("calculation", "Expected whole shares", "542");
    await portfolio.assert.capitalReductionMetric("calculation", "Pending fractional entitlement", "0.0491512");
    await portfolio.assert.capitalReductionMetric("calculation", "Delivered-share cost", 25418.69);
    await portfolio.assert.capitalReductionMetric("calculation", "Fraction allocated cost", 2.31);
    await portfolio.assert.capitalReductionMetric("calculation", "Remaining acquisition cost", 25421);
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.assert.capitalReductionContains("preview", "Main");
    await portfolio.assert.capitalReductionContains("preview", "acc-1");
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "en-preview"), "preview");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 0);
    await portfolio.assert.capitalReductionMetric("action", "Outstanding repayment receivable", 4579);
    await portfolio.assert.capitalReductionContains("action", "Reconciliation pending");
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "en-posted"), "action");
    await appShell.actions.reloadPage();
    await portfolio.actions.setDisplayModeExpanded();
    await portfolio.actions.openHoldingActivity(capitalReductionTicker);
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionContains("action", "SYNTH-delivery-542");
  });

  test("public terms: register before future conversion → reuse without financial effects → reject duplicate identity", async ({ portfolio, capitalReductionTicker }) => {
    await portfolio.actions.capitalReductionClick("register-announcement");
    const terms = Object.fromEntries(Object.entries(fields).filter(([key]) => !["confirmedWholeQuantity", "evidenceReference"].includes(key)));
    await portfolio.actions.fillCapitalReduction({ ...terms, suspensionStartDate: "2026-11-15", suspensionEndDate: "2099-01-25", conversionDate: "2099-01-26" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionVisible("announcement-preview");
    await portfolio.assert.capitalReductionContains("announcement-preview", "Main");
    await portfolio.assert.capitalReductionContains("announcement-preview", "acc-1");
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionContains("registered-announcements", fields.officialReference);
    await portfolio.assert.capitalReductionCount("action", 0);
    await portfolio.assert.mxAssertDeepEqual(await portfolio.arrange.capitalReductionFinancialOracle(capitalReductionTicker), { quantity: 1000, cost: 30000, cashEffectCount: 0 }, "Source registration preserves original quantity/cost and creates no cash effects");
    await portfolio.assert.capitalReductionContains("valuation-status", "Trading suspended — carried valuation");
    await portfolio.assert.capitalReductionContains("valuation", "2026-01-16");
    await portfolio.assert.capitalReductionMetric("valuation", "Share valuation price", 31);
    await portfolio.assert.capitalReductionMetric("valuation", "Combined asset value", 31000);
    await portfolio.actions.capitalReductionClick("reuse-announcement");
    await portfolio.assert.capitalReductionValue("officialReference", fields.officialReference);
    await portfolio.assert.capitalReductionDisabled("officialReference");
    await portfolio.assert.capitalReductionDisabled("preview-button");
    await portfolio.assert.capitalReductionCount("action", 0);
    await portfolio.actions.capitalReductionClick("register-announcement");
    await portfolio.actions.fillCapitalReduction({ ...terms, suspensionStartDate: "2026-11-15", suspensionEndDate: "2099-01-25", conversionDate: "2099-01-26" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionContains("announcement-blockers", /Resolve existing announcement/);
    await portfolio.assert.capitalReductionDisabled("confirm");
  });

  test("accounting changes: confirm stale preview → rejection → fresh preview posts once", async ({ portfolio, dashboard, capitalReductionTicker }) => {
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionVisible("preview");
    await dashboard.arrange.seedTrade({ ticker: capitalReductionTicker, quantity: 1, unitPrice: 30, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-01-18" });
    await portfolio.actions.submitCapitalReduction();
    await portfolio.assert.capitalReductionError(/Accounting or preview expiry changed|capital_reduction_preview_stale/);
    await portfolio.assert.capitalReductionCount("action", 0);
    await portfolio.actions.editCapitalReductionPreview();
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionCount("action", 1);
  });

  test("later sale conflict: backdated conversion would oversell → preview blocks all mutations", async ({ portfolio, dashboard, capitalReductionTicker }) => {
    await dashboard.arrange.seedTrade({ ticker: capitalReductionTicker, quantity: 600, unitPrice: 60, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-02-10", type: "SELL" });
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionVisible("blockers");
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.assert.capitalReductionCount("action", 0);
    await portfolio.assert.mxAssertDeepEqual(await portfolio.arrange.capitalReductionFinancialOracle(capitalReductionTicker), { quantity: 400, cost: 12000, cashEffectCount: 0 }, "Blocked replay preserves existing later sale and original remaining cost");
  });

  test("delivery evidence mismatch: source predicts 542 whole shares → invalid confirmed quantity blocks posting", async ({ portfolio }) => {
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction({ ...fields, confirmedWholeQuantity: "543" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionVisible("blockers");
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.assert.capitalReductionCount("action", 0);
  });

  test("zero whole shares: confirm pending fraction → reload ticker → settlement remains reachable in same account", async ({ portfolio, appShell, capitalReductionTicker }) => {
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction({ ...fields, ratioNumerator: "0.0000491512", confirmedWholeQuantity: "0" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionMetric("calculation", "Expected whole shares", "0");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionCount("action", 1);
    await appShell.actions.navigateToRoute(`/tickers/${capitalReductionTicker}?marketCode=TW&accountId=acc-1`);
    await portfolio.assert.capitalReductionVisible("open");
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.assert.capitalReductionVisible("add-fraction");
    await portfolio.assert.mxAssertDeepEqual(await portfolio.arrange.capitalReductionFinancialOracle(capitalReductionTicker), { quantity: 0, cost: 0, cashEffectCount: 0 }, "Zero whole delivery creates no positive stock holding or cash");
    await portfolio.actions.capitalReductionClick("add-fraction");
    await portfolio.actions.fillCapitalReduction({ "fraction-receivedDate": "2026-01-30", "fraction-evidenceReference": "SYNTH-zero-whole-fraction", "fraction-grossAmount": "2", "fraction-processingFeeAmount": "0", "fraction-feeOffsetAmount": "0", "fraction-cashAmount": "2", "fraction-feeCashPaidAmount": "0", reason: "Settle pending fraction without stock holding" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.confirmCapitalReduction();
    await appShell.actions.reloadPage();
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionValue("account", "acc-1");
    await portfolio.assert.capitalReductionCount("action", 1);
    await portfolio.assert.capitalReductionMetric("action", "Actual bank cash", 2);
  });
});

test.describe("cash capital reduction Traditional Chinese desktop", () => {
  test.use({ capitalReductionLocale: "zh-TW" });

  test("holding zh-TW: source entry → explicit preview → pending history → net receipt", async ({ portfolio }, testInfo) => {
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "zh-TW-entry"));
    await portfolio.actions.capitalReductionClick("new");
    await portfolio.actions.fillCapitalReduction(fields);
    await portfolio.actions.previewCapitalReduction();
    await portfolio.assert.capitalReductionMetric("calculation", "預期交付整股數", "542");
    await portfolio.assert.capitalReductionMetric("calculation", "畸零股分配成本", 2.31, "zh-TW");
    await portfolio.assert.capitalReductionDisabled("confirm");
    await portfolio.assert.capitalReductionContains("preview", "Main");
    await portfolio.assert.capitalReductionContains("preview", "acc-1");
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "zh-TW-preview"), "preview");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionContains("action", "待核對");
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "zh-TW-posted"), "action");
    await portfolio.actions.capitalReductionClick("reconcile");
    await portfolio.actions.capitalReductionClick("add-receipt");
    await portfolio.actions.fillCapitalReduction({ "receipt-0-receivedDate": "2026-01-28", "receipt-0-evidenceReference": "SYNTH-zh-bank", "receipt-0-grossAmount": "4579", "receipt-0-cashAmount": "4574", "receipt-0-feeAmount": "5", reason: "合成測試核對" });
    await portfolio.actions.previewCapitalReduction();
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "zh-TW-reconcile"), "preview");
    await portfolio.actions.confirmCapitalReduction();
    await portfolio.assert.capitalReductionMetric("action", "實際銀行現金", 4574, "zh-TW");
    await portfolio.assert.capitalReductionMetric("action", "已確認費用", 5, "zh-TW");
    await portfolio.actions.captureCapitalReduction(screenshot(testInfo.project.name, "zh-TW-valuation"), "valuation");
  });
});
