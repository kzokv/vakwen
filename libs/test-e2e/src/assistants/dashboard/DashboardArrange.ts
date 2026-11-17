import { TestEnv } from "@vakwen/config/test";
import { Step } from "@vakwen/test-framework/decorators";
import { BaseArrange } from "@vakwen/test-framework/mixins";
import { apiUrl } from "../../utils/url.js";

import type { DashboardPage } from "../../pages/dashboard/DashboardPage.js";

interface TSeedDailyBar {
  ticker: string;
  marketCode?: "TW" | "US" | "AU";
  barDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source?: string;
  ingestedAt?: string;
}

interface TSeedTradeOptions {
  commissionAmount?: number;
  taxAmount?: number;
  accountId?: string;
  ticker?: string;
  marketCode?: "TW" | "US" | "AU";
  quantity?: number;
  unitPrice?: number;
  priceCurrency?: string;
  tradeDate?: string;
  type?: "BUY" | "SELL";
  isDayTrade?: boolean;
}

export class DashboardArrange extends BaseArrange {
  declare protected readonly _instance: DashboardPage;

  @Step()
  async seedDailyBars(bars: TSeedDailyBar[]): Promise<void> {
    const response = await this.request.post(apiUrl("/__e2e/seed-daily-bars"), {
      headers: { "x-user-id": this.userId ?? "user-1" },
      data: { bars },
    });
    if (!response.ok()) throw new Error(`seedDailyBars failed: ${response.status()} ${await response.text()}`);
  }

  @Step()
  async seedTrade(overrides: TSeedTradeOptions = {}): Promise<void> {
    if (!this.userId) throw new Error("seedTrade requires userId");

    const res = await this.request.post(
      new URL("/portfolio/transactions", TestEnv.apiBaseUrl).href,
      {
        headers: {
          "content-type": "application/json",
          "x-user-id": this.userId,
          "idempotency-key": `seed-${Date.now()}-${Math.random()}`,
        },
        data: {
          accountId: "acc-1",
          ticker: "2330",
          marketCode: "TW",
          quantity: 100,
          unitPrice: 500,
          priceCurrency: "TWD",
          tradeDate: "2026-01-15",
          type: "BUY",
          isDayTrade: false,
          ...overrides,
        },
      },
    );
    if (!res.ok()) throw new Error(`seedTrade failed: ${res.status()} ${await res.text()}`);
  }
}
