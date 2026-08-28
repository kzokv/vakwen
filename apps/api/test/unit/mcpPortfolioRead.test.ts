import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@vakwen/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@vakwen/config")>();
  return {
    ...original,
    Env: {
      ...original.Env,
      AUTH_MODE: "dev_bypass" as const,
    },
  };
});

import { buildApp, type AppInstance } from "../../src/app.js";
import type { MemoryPersistence } from "../../src/persistence/memory.js";
import { getQuoteFreshness, searchInstruments } from "../../src/services/mcpPortfolioRead.js";
import type { McpRequestContext } from "../../src/mcp/types.js";
import { transactionPayload } from "../helpers/fixtures.js";

let app: AppInstance;

function createRequestContext(scopes: Array<"portfolio:mcp_read" | "research:read"> = ["portfolio:mcp_read"]): McpRequestContext {
  return {
    auth: {
      token: "vakwen-dev.test",
      clientId: "vakwen-dev-client",
      sessionUserId: "user-1",
      connection: null,
      scopes,
      toolToggles: {},
      expiresAt: null,
      authMode: "dev_token",
    },
    resolvedContext: {
      sessionUserId: "user-1",
      portfolioContextUserId: "user-1",
      shareId: null,
      shareCapabilities: [],
    },
    requestId: "mcp-portfolio-read-test",
    sourceIp: "127.0.0.1",
    userAgent: "vitest",
    logger: app.log,
  };
}

describe("mcp portfolio read services", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", seedMemoryCatalog: true });
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns factual priceState quote diagnostics without legacy freshness fields", async () => {
    (app.persistence as MemoryPersistence)._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    (app.persistence as MemoryPersistence)._seedDailyBars([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-16",
        open: 1000,
        high: 1010,
        low: 990,
        close: 1005,
        volume: 1_000_000,
        quality: "full_bar",
        source: "test-daily",
        ingestedAt: "2026-06-16T07:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-15",
        open: 990,
        high: 1000,
        low: 980,
        close: 995,
        volume: 1_000_000,
        quality: "full_bar",
        source: "test-daily",
        ingestedAt: "2026-06-15T07:00:00.000Z",
      },
    ]);
    const trade = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "mcp-price-state-seed" },
      payload: transactionPayload({
        ticker: "2330",
        marketCode: "TW",
        tradeDate: "2026-06-15",
        quantity: 1,
        unitPrice: 990,
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(trade.statusCode).toBe(200);

    const result = await getQuoteFreshness(
      {
        app,
        requestContext: createRequestContext(),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-06-16",
          isTradingDay: async () => false,
        } as never,
      },
      { tickers: ["2330"] },
    );

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0]).toEqual(expect.objectContaining({
      ticker: "2330",
      quoteStatus: "current",
      currentUnitPrice: 1005,
      previousClose: 995,
      priceState: expect.objectContaining({
        basis: "today_close",
        chipState: "closed",
        source: "test-daily",
        quality: "full_bar",
      }),
    }));
    expect(JSON.stringify(result)).not.toContain("freshnessTooltip");
    expect(Object.keys(result.quotes[0]!)).not.toContain("freshness");
  });

  it("legacy search only broadens inactive rows when includeInactive is true and never emits researchIdentity when research MCP is off", async () => {
    const persistence = app.persistence as MemoryPersistence;
    persistence._seedInstrument({
      ticker: "2330",
      name: "TSMC",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    persistence._seedInstrument({
      ticker: "9105",
      name: "Delisted TW",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "failed",
      delistedAt: "2026-08-01T00:00:00.000Z",
    });
    persistence._seedInstrument({
      ticker: "AAPL",
      name: "Apple",
      instrumentType: "STOCK",
      marketCode: "US",
      barsBackfillStatus: "ready",
    });

    const defaultResult = await searchInstruments(
      {
        app,
        requestContext: createRequestContext(["portfolio:mcp_read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "T", limit: 10, markets: ["TW"] },
    );

    const resultWithInactive = await searchInstruments(
      {
        app,
        requestContext: createRequestContext(["portfolio:mcp_read"]),
        tradingCalendar: {
          latestSettledTradingDay: async () => "2026-08-28",
          isTradingDay: async () => true,
        } as never,
      },
      { query: "T", limit: 10, markets: ["TW"], includeInactive: true },
    );

    expect(defaultResult.markets).toEqual(["TW"]);
    expect(defaultResult.items.map((item) => item.ticker)).toEqual(expect.arrayContaining(["2330"]));
    expect(defaultResult.items.map((item) => item.ticker)).not.toContain("9105");
    expect(defaultResult.items.every((item) => !("researchIdentity" in item))).toBe(true);

    expect(resultWithInactive.markets).toEqual(["TW"]);
    expect(resultWithInactive.items.map((item) => item.ticker)).toEqual(expect.arrayContaining(["2330", "9105"]));
    expect(resultWithInactive.items.every((item) => !("researchIdentity" in item))).toBe(true);
  });
});
