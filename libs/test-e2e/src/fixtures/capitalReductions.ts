import { test as base } from "./appPages.js";
import { resolve } from "node:path";
import { createHash } from "node:crypto";

export function capitalReductionScreenshotPath(project: string, phase: string): string {
  const root = process.cwd().endsWith("/apps/web") ? resolve(process.cwd(), "../..") : process.cwd();
  return resolve(root, ".worklog/team/reports/browser-qa", `${project}-${phase}.png`);
}

/** Public synthetic announcement only; never uses real account evidence. */
export const syntheticCapitalReductionFields: Record<string, string> = {
  officialReference: "SYNTH-KZO270-2026",
  sourceUrl: "https://example.com/synthetic-capital-reduction",
  publishedDate: "2026-01-16", reductionDate: "2026-01-20",
  suspensionStartDate: "2026-01-19", suspensionEndDate: "2026-01-25",
  exchangeRecordDate: "2026-01-22", scheduledPaymentDate: "2026-01-28",
  conversionDate: "2026-01-26", conversionTime: "09:00",
  ratioDenominator: "1", ratioNumerator: "0.5420491512",
  repaymentPerOldShare: "4.579", officialReferencePrice: "57.80", fractionReferencePrice: "56.70",
  confirmedWholeQuantity: "542", evidenceReference: "SYNTH-delivery-542", reason: "Synthetic acceptance evidence",
};

export const test = base.extend<{ capitalReductionReady: void; capitalReductionLocale: "en" | "zh-TW"; capitalReductionTicker: string }>({
  capitalReductionLocale: ["en", { option: true }],
  capitalReductionTicker: async ({ testUser }, use, testInfo) => { await use(`SYNTH${createHash("sha256").update(`${testUser.userId}:${testInfo.project.name}`).digest("hex").slice(0, 5).toUpperCase()}`); },
  capitalReductionReady: [async ({ settings, dashboard, portfolio, capitalReductionLocale, capitalReductionTicker }, use) => {
    await portfolio.arrange.setCapitalReductionLocale(capitalReductionLocale);
    await settings.arrange.seedInstruments([{ ticker: capitalReductionTicker, name: "Synthetic Acceptance Stock", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" }]);
    await dashboard.arrange.seedTrade({ ticker: capitalReductionTicker, quantity: 1000, unitPrice: 30, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-01-15" });
    await dashboard.arrange.seedDailyBars([{ ticker: capitalReductionTicker, barDate: "2026-01-16", open: 31, high: 31, low: 31, close: 31, volume: 1000 }]);
    await portfolio.actions.navigateToPortfolio();
    await portfolio.actions.setDisplayModeExpanded();
    await portfolio.actions.openHoldingActivity(capitalReductionTicker);
    await portfolio.actions.capitalReductionClick("open");
    await portfolio.assert.capitalReductionVisible("new");
    await use();
  }, { auto: true }],
});
