import { test as base } from "./oauthPages.js";
import { makeDeterministicIdToken } from "../utils/jwt.js";

export const test = base.extend<{ capitalReductionOAuthReady: void; capitalReductionOAuthToken: string }>({
  capitalReductionOAuthToken: async ({ testUser }, use) => {
    await use(makeDeterministicIdToken({ sub: `cr-${testUser.userId}`, email: `cr-${testUser.userId}@example.com`, name: "Synthetic Capital Reduction QA" }));
  },
  capitalReductionOAuthReady: [async ({ session, capitalReductionOAuthToken, settings, dashboard, portfolio }, use) => {
    await session.actions.seedOAuthSession(capitalReductionOAuthToken);
    await settings.arrange.seedInstruments([{ ticker: "SYNTH", name: "Synthetic Acceptance Stock", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" }]);
    await dashboard.arrange.seedTrade({ ticker: "SYNTH", quantity: 1000, unitPrice: 30, commissionAmount: 0, taxAmount: 0, tradeDate: "2026-01-15" });
    await portfolio.arrange.setCapitalReductionLocale("en");
    await use();
  }, { auto: true }],
});
