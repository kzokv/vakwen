import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signSessionCookie } from "../../src/auth/googleOAuth.js";
import { buildApp } from "../../src/app.js";
import {
  confirmAdminMarketCalendarImport,
  previewAdminMarketCalendarImport,
} from "../../src/services/market-data/marketCalendarService.js";
import { buildPortfolioReport } from "../../src/services/reports.js";
let app: Awaited<ReturnType<typeof buildApp>>;
let cookieHeader: string;
let userId: string;

const testOAuthConfig = {
  clientId: "test-client",
  clientSecret: "test-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

function relativeIsoDate(daysFromToday: number): string {
  const date = new Date();
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return date.toISOString().slice(0, 10);
}

async function seedOfficialMarketCalendar(marketCode: "TW", calendarYear: number): Promise<void> {
  const preview = await previewAdminMarketCalendarImport(app.persistence, marketCode, {
    calendarYear,
    retrievedAt: "2026-06-18T00:00:00.000Z",
    coverage: { scope: "full_year", evidence: "Integration test confirmed full-year calendar coverage." },
    exceptions: [],
  });
  await confirmAdminMarketCalendarImport(app.persistence, marketCode, preview.previewToken);
}

describe("report routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const authUser = await app.persistence.resolveOrCreateUser("google", "reports-test-user", {
      email: "reports-test-user@example.com",
      name: "Reports Test User",
    });
    userId = authUser.userId;
    const user = await app.persistence.getAuthUserById(userId);
    if (!user) throw new Error("expected seeded auth user");
    cookieHeader = `g_auth_session=${signSessionCookie(userId, testOAuthConfig.sessionSecret, user.sessionVersion)}`;
  });

  afterEach(async () => {
    vi.useRealTimers();
    if (app) await app.close();
  });

  it("serves daily review, portfolio, and market reports with bounded holdings detail", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-trade-1",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedInstrument?: (instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK" | "ETF" | "BOND_ETF";
        marketCode: "TW" | "US" | "AU";
        barsBackfillStatus: "pending" | "backfilling" | "ready" | "failed";
      }) => void;
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedInstrument?.({
      ticker: "2330",
      name: "台積電",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "pending",
    });
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-02",
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        volume: 10_000,
        source: "test",
        ingestedAt: "2026-06-02T10:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 103,
        high: 106,
        low: 102,
        close: 105,
        volume: 12_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "report-diagnostics-snapshot-2330-valid",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-02",
        quantity: 10,
        closePrice: 104,
        marketValue: 1040,
        costBasis: 1000,
        unrealizedPnl: 40,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1040,
        costBasisNative: 1000,
        unrealizedPnlNative: 40,
        providerSource: "integration-test",
        generatedAt: "2026-06-02T10:05:00.000Z",
        generationRunId: "report-diagnostics-gen-valid",
      },
      {
        id: "report-diagnostics-snapshot-2330",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-03",
        quantity: 10,
        closePrice: 105,
        marketValue: 1050,
        costBasis: 1000,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1050,
        costBasisNative: 1000,
        unrealizedPnlNative: 50,
        providerSource: null,
        generatedAt: "2026-06-03T10:05:00.000Z",
        generationRunId: "report-diagnostics-gen",
      },
    ]);

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?scope=TW&limit=1",
      headers: { cookie: cookieHeader },
    });
    expect(dailyReview.statusCode).toBe(200);
    expect(dailyReview.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      query: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
      }),
      fxRates: [],
      summary: expect.objectContaining({
        costBasisAmount: expect.any(Number),
      }),
      diagnostics: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
        requestedAsOf: expect.any(String),
        lastValuationDate: expect.any(String),
        marketDataStaleSince: "2026-06-03",
        latestSnapshotDate: "2026-06-03",
        latestReliableValuationDate: "2026-06-03",
        expectedLatestValuationDate: expect.any(String),
        staleSinceDate: "2026-06-03",
        missingQuoteCount: expect.any(Number),
        provisionalQuoteCount: 1,
        nonCurrentPriceCount: 1,
        missingFxCount: 0,
        missingProviderSourceCount: 1,
        knownGapReasons: expect.arrayContaining([
          "missing_provider_source",
          "non_current_price",
          "provisional_quote",
          "stale_snapshot",
        ]),
        markets: expect.arrayContaining([
          expect.objectContaining({
            marketCode: "TW",
            latestSnapshotDate: "2026-06-03",
            missingProviderSourceCount: 1,
            providerSources: [],
            knownGapReasons: expect.arrayContaining(["missing_provider_source", "non_current_price", "provisional_quote"]),
          }),
        ]),
        snapshotGapHoldings: [
          expect.objectContaining({
            ticker: "2330",
            marketCode: "TW",
            accountCount: 1,
            affectedAccountCount: 1,
            latestSnapshotDate: "2026-06-02",
            expectedLatestValuationDate: expect.any(String),
            knownGapReasons: ["stale_snapshot"],
          }),
        ],
        rowCounts: expect.objectContaining({
          holdingsTotal: 1,
          holdingsReturned: 1,
          topMovers: expect.any(Number),
          suggestions: expect.any(Number),
        }),
      }),
      holdings: expect.objectContaining({
        total: 1,
        limit: 1,
        rows: [
          expect.objectContaining({
            ticker: "2330",
            instrumentName: "台積電",
            marketCode: "TW",
          }),
        ],
      }),
    }));

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });
    expect(portfolioReport.statusCode).toBe(200);
    expect(portfolioReport.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      query: expect.objectContaining({
        scope: "all",
        range: "1Y",
      }),
      fxRates: [],
      allocation: expect.objectContaining({
        byMarket: expect.arrayContaining([
          expect.objectContaining({ key: "TW" }),
        ]),
      }),
      diagnostics: expect.objectContaining({
        scope: "all",
        reportingCurrency: "TWD",
        latestSnapshotDate: "2026-06-03",
        latestReliableValuationDate: "2026-06-03",
        expectedLatestValuationDate: expect.any(String),
        staleSinceDate: "2026-06-03",
        missingProviderSourceCount: 1,
        nonCurrentPriceCount: 1,
        knownGapReasons: expect.arrayContaining([
          "missing_provider_source",
          "non_current_price",
          "stale_snapshot",
        ]),
        markets: expect.arrayContaining([
          expect.objectContaining({
            marketCode: "TW",
            latestSnapshotDate: "2026-06-03",
            missingProviderSourceCount: 1,
            providerSources: [],
          }),
        ]),
        snapshotGapHoldings: [
          expect.objectContaining({
            ticker: "2330",
            marketCode: "TW",
            latestSnapshotDate: "2026-06-02",
            knownGapReasons: ["stale_snapshot"],
          }),
        ],
        rowCounts: expect.objectContaining({
          holdingsTotal: 1,
          holdingsReturned: 1,
          topHoldings: 1,
          marketBuckets: 1,
          accountBuckets: expect.any(Number),
        }),
      }),
      concentration: expect.objectContaining({
        topHoldings: expect.arrayContaining([
          expect.objectContaining({ ticker: "2330", instrumentName: "台積電" }),
        ]),
      }),
    }));

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=TW&limit=1",
      headers: { cookie: cookieHeader },
    });
    expect(marketReport.statusCode).toBe(200);
    expect(marketReport.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      query: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
      }),
      fxRates: [],
      diagnostics: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
        latestSnapshotDate: "2026-06-03",
        latestReliableValuationDate: "2026-06-03",
        expectedLatestValuationDate: expect.any(String),
        staleSinceDate: "2026-06-03",
        missingProviderSourceCount: 1,
        nonCurrentPriceCount: 1,
        knownGapReasons: expect.arrayContaining([
          "missing_provider_source",
          "non_current_price",
          "stale_snapshot",
        ]),
        markets: expect.arrayContaining([
          expect.objectContaining({
            marketCode: "TW",
            latestSnapshotDate: "2026-06-03",
            missingProviderSourceCount: 1,
            providerSources: [],
          }),
        ]),
        snapshotGapHoldings: [
          expect.objectContaining({
            ticker: "2330",
            marketCode: "TW",
            latestSnapshotDate: "2026-06-02",
            knownGapReasons: ["stale_snapshot"],
          }),
        ],
        rowCounts: expect.objectContaining({
          holdingsTotal: 1,
          holdingsReturned: 1,
          topHoldings: 1,
          marketBuckets: 1,
        }),
      }),
      detail: expect.objectContaining({
        limit: 1,
        rows: [
          expect.objectContaining({
            ticker: "2330",
            instrumentName: "台積電",
          }),
        ],
      }),
    }));
  });

  it("does not mark current settled snapshots stale on non-trading report dates", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-04T12:00:00.000Z"));

    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.projections.lots.push({
      id: "lot-weekend-current-2330",
      accountId: "acc-1",
      ticker: "2330",
      openQuantity: 10,
      totalCostAmount: 1000,
      costCurrency: "TWD",
      openedAt: "2026-07-01",
      openedSequence: 1,
    });
    store.accounting.facts.tradeEvents.push({
      id: "weekend-current-trade-1",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-07-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-07-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-07-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedInstrument?: (instrument: {
        ticker: string;
        name: string;
        instrumentType: "STOCK" | "ETF" | "BOND_ETF";
        marketCode: "TW" | "US" | "AU";
        barsBackfillStatus: "pending" | "backfilling" | "ready" | "failed";
      }) => void;
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedInstrument?.({
      ticker: "2330",
      name: "台積電",
      instrumentType: "STOCK",
      marketCode: "TW",
      barsBackfillStatus: "ready",
    });
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-07-03",
        open: 100,
        high: 106,
        low: 99,
        close: 105,
        volume: 12_000,
        source: "test",
        ingestedAt: "2026-07-03T10:00:00.000Z",
      },
    ]);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "weekend-current-snapshot-2330",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-07-03",
        quantity: 10,
        closePrice: 105,
        marketValue: 1050,
        costBasis: 1000,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1050,
        costBasisNative: 1000,
        unrealizedPnlNative: 50,
        providerSource: "test",
        generatedAt: "2026-07-03T10:05:00.000Z",
        generationRunId: "weekend-current-gen",
      },
    ]);

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?scope=TW&limit=5",
      headers: { cookie: cookieHeader },
    });
    const body = dailyReview.json() as {
      diagnostics: {
        knownGapReasons: string[];
        marketDataStaleSince: string | null;
        staleSinceDate: string | null;
        expectedLatestValuationDate: string;
        snapshotGapHoldings?: Array<{ ticker: string; knownGapReasons: string[] }>;
      };
    };

    expect(dailyReview.statusCode).toBe(200);
    expect(body.diagnostics.expectedLatestValuationDate).toBe("2026-07-03");
    expect(body.diagnostics.knownGapReasons).not.toContain("stale_snapshot");
    expect(body.diagnostics.marketDataStaleSince).toBeNull();
    expect(body.diagnostics.staleSinceDate).toBeNull();
    expect(body.diagnostics.snapshotGapHoldings ?? []).toEqual([]);
  });

  it("enqueues displayed intraday refreshes before resolving report price states", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-18T02:00:00.000Z"));
    await seedOfficialMarketCalendar("TW", 2026);
    const sendCalls: unknown[][] = [];
    app.boss = {
      send: async (...args: unknown[]) => {
        sendCalls.push(args);
        return "intraday-report-job";
      },
    } as never;

    const store = await app.persistence.loadStore(userId);
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    await app.persistence.saveStore(store);

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });

    expect(portfolioReport.statusCode, portfolioReport.body).toBe(200);
    expect(sendCalls).toEqual(expect.arrayContaining([
      [
        "intraday-refresh",
        expect.objectContaining({
          ticker: "2330",
          marketCode: "TW",
          requestedAt: "2026-06-18T02:00:00.000Z",
        }),
        expect.objectContaining({
          singletonKey: "intraday-refresh:TW:2330",
        }),
      ],
    ]));
  });

  it("includes markets with missing snapshots in all-market report diagnostics", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usFeeProfile = {
      ...feeProfile,
      id: "fp-us-missing-diagnostics",
      accountId: "acc-us-missing-diagnostics",
      name: "US Broker Fee",
      commissionCurrency: "USD" as const,
    };
    store.feeProfiles.push(usFeeProfile);
    store.accounts.push({
      id: "acc-us-missing-diagnostics",
      userId,
      name: "US Broker",
      feeProfileId: usFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push(
      {
        ticker: "2330",
        type: "STOCK",
        marketCode: "TW",
      },
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
      },
    );
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-us-missing-diagnostics",
        ticker: "AAPL",
        quantity: 2,
        costBasisAmount: 300,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-market-diag-tw-trade",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        id: "report-market-diag-us-trade",
        userId,
        accountId: "acc-us-missing-diagnostics",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 2,
        unitPrice: 150,
        priceCurrency: "USD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usFeeProfile,
        tradeTimestamp: "2026-06-01T14:00:00.000Z",
        bookingSequence: 2,
        bookedAt: "2026-06-01T14:00:00.000Z",
      },
    );
    await app.persistence.saveStore(store);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "report-diagnostics-snapshot-tw-only",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-03",
        quantity: 10,
        closePrice: 105,
        marketValue: 1050,
        costBasis: 1000,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1050,
        costBasisNative: 1000,
        unrealizedPnlNative: 50,
        providerSource: "test",
        generatedAt: "2026-06-03T10:05:00.000Z",
        generationRunId: "report-market-diag-gen",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      diagnostics: {
        markets: Array<{
          knownGapReasons: string[];
          latestSnapshotDate: string | null;
          marketCode: string;
        }>;
      };
    };
    expect(body.diagnostics.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        marketCode: "TW",
        latestSnapshotDate: "2026-06-03",
      }),
      expect.objectContaining({
        marketCode: "US",
        latestSnapshotDate: null,
        knownGapReasons: expect.arrayContaining(["missing_snapshot"]),
      }),
    ]));
  });

  it("does not report missing snapshots for catalog-only markets", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.instruments.push(
      {
        ticker: "2330",
        type: "STOCK",
        marketCode: "TW",
      },
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
      },
    );
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-catalog-market-tw-trade",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "report-catalog-market-tw-snapshot",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-03",
        quantity: 10,
        closePrice: 105,
        marketValue: 1050,
        costBasis: 1000,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1050,
        costBasisNative: 1000,
        unrealizedPnlNative: 50,
        providerSource: "test",
        generatedAt: "2026-06-03T10:05:00.000Z",
        generationRunId: "report-catalog-market-gen",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      diagnostics: {
        markets: Array<{
          marketCode: string;
        }>;
      };
    };
    expect(body.diagnostics.markets.map((market) => market.marketCode)).toContain("TW");
    expect(body.diagnostics.markets.map((market) => market.marketCode)).not.toContain("US");
  });

  it("attributes quote and FX gaps to the affected market diagnostics", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usFeeProfile = {
      ...feeProfile,
      id: "fp-us-market-health-diagnostics",
      accountId: "acc-us-market-health-diagnostics",
      name: "US Market Health Fee",
    };
    store.feeProfiles.push(usFeeProfile);
    store.accounts.push({
      id: "acc-us-market-health-diagnostics",
      userId,
      name: "US Market Health",
      feeProfileId: usFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push({
      ticker: "AAPL",
      type: "STOCK",
      marketCode: "US",
      isProvisional: false,
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-us-market-health-diagnostics",
      ticker: "AAPL",
      quantity: 2,
      costBasisAmount: 300,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-market-health-us-trade",
      userId,
      accountId: "acc-us-market-health-diagnostics",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 2,
      unitPrice: 150,
      priceCurrency: "USD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: usFeeProfile,
      tradeTimestamp: "2026-06-01T14:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T14:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const snapshotDate = relativeIsoDate(0);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "report-market-health-us-snapshot",
        userId,
        accountId: "acc-us-market-health-diagnostics",
        ticker: "AAPL",
        marketCode: "US",
        snapshotDate,
        quantity: 2,
        closePrice: 150,
        marketValue: 300,
        costBasis: 300,
        unrealizedPnl: 0,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "USD",
        valueNative: 300,
        costBasisNative: 300,
        unrealizedPnlNative: 0,
        providerSource: "test",
        generatedAt: `${snapshotDate}T10:05:00.000Z`,
        generationRunId: "report-market-health-gen",
      },
    ]);

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      diagnostics: {
        knownGapReasons: string[];
        markets: Array<{
          knownGapReasons: string[];
          latestSnapshotDate: string | null;
          marketCode: string;
        }>;
      };
    };
    expect(body.diagnostics.knownGapReasons).toEqual(expect.arrayContaining(["missing_quote", "missing_fx"]));
    expect(body.diagnostics.markets).toEqual(expect.arrayContaining([
      expect.objectContaining({
        marketCode: "US",
        latestSnapshotDate: snapshotDate,
        knownGapReasons: expect.arrayContaining(["missing_quote", "missing_fx"]),
      }),
    ]));
  });

  it("normalizes legacy report currency overrides to backend-authoritative scope rules", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const audFeeProfile = {
      ...feeProfile,
      id: "fp-au-authoritative-report",
      accountId: "acc-au-authoritative-report",
      name: "AU Broker Fee",
    };
    store.feeProfiles.push(audFeeProfile);
    store.accounts.push({
      id: "acc-au-authoritative-report",
      userId,
      name: "AU Broker",
      feeProfileId: audFeeProfile.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    store.instruments.push({
      ticker: "BHP",
      type: "STOCK",
      marketCode: "AU",
      isProvisional: false,
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-au-authoritative-report",
      ticker: "BHP",
      quantity: 5,
      costBasisAmount: 200,
      currency: "AUD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-authoritative-au-trade",
      userId,
      accountId: "acc-au-authoritative-report",
      ticker: "BHP",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 5,
      unitPrice: 40,
      priceCurrency: "AUD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: audFeeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const allScope = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&currencyMode=specified&currency=USD&limit=5",
      headers: { cookie: cookieHeader },
    });
    expect(allScope.statusCode).toBe(200);
    expect(allScope.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "all",
        currencyMode: "specified",
        currency: "USD",
        reportingCurrency: "USD",
        nativeCurrency: null,
      }),
    }));

    const singleMarket = await app.inject({
      method: "GET",
      url: "/reports/market?scope=AU&currencyMode=specified&currency=USD&limit=5",
      headers: { cookie: cookieHeader },
    });
    expect(singleMarket.statusCode).toBe(200);
    expect(singleMarket.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "AU",
        currencyMode: "auto",
        currency: null,
        reportingCurrency: "AUD",
        nativeCurrency: "AUD",
      }),
      detail: expect.objectContaining({
        rows: [
          expect.objectContaining({
            ticker: "BHP",
            marketCode: "AU",
            reportingCurrency: "AUD",
          }),
        ],
      }),
    }));
  });

  it("adds resolved FX conversion rows to report DTOs for mixed-currency holdings", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const accountFeeProfile = {
      ...feeProfile,
      id: "fp-usd-1",
      accountId: "acc-usd-1",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(accountFeeProfile);
    store.accounts.push({
      id: "acc-usd-1",
      userId,
      name: "US Broker",
      feeProfileId: accountFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-usd-1",
      ticker: "AAPL",
      quantity: 5,
      costBasisAmount: 500,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-trade-usd-1",
      userId,
      accountId: "acc-usd-1",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 5,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T14:30:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.upsertFxRates([
      {
        date: "2026-06-03",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 32,
        source: "test",
      },
    ]);

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all",
      headers: { cookie: cookieHeader },
    });

    expect(portfolioReport.statusCode).toBe(200);
    expect(portfolioReport.json()).toEqual(expect.objectContaining({
      fxStatus: expect.objectContaining({
        status: "complete",
        missingRatePairs: [],
      }),
      fxRates: [
        expect.objectContaining({
          fromCurrency: "USD",
          toCurrency: "TWD",
          rate: 32,
          asOf: expect.any(String),
        }),
      ],
    }));
    expect(portfolioReport.json().fxRates).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ fromCurrency: "TWD", toCurrency: "TWD" }),
    ]));
  });

  it("keeps report summary totals reconciled with reporting-currency rows and market buckets", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usdFeeProfile = {
      ...feeProfile,
      id: "fp-usd-reconcile",
      accountId: "acc-usd-reconcile",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(usdFeeProfile);
    store.accounts.push({
      id: "acc-usd-reconcile",
      userId,
      name: "US Broker",
      feeProfileId: usdFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-usd-reconcile",
        ticker: "AAPL",
        quantity: 2,
        costBasisAmount: 100,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-reconcile-tw-trade",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        id: "report-reconcile-us-trade",
        userId,
        accountId: "acc-usd-reconcile",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 2,
        unitPrice: 50,
        priceCurrency: "USD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
        tradeTimestamp: "2026-06-01T14:30:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T14:30:00.000Z",
      },
    );
    await app.persistence.saveStore(store);
    await app.persistence.upsertInstruments(userId, [
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    ]);
    await app.persistence.upsertFxRates([
      {
        date: "2026-06-03",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 32,
        source: "test",
      },
    ]);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-02", open: 100, high: 100, low: 100, close: 100, volume: 10_000, source: "test", ingestedAt: "2026-06-02T10:00:00.000Z" },
      { ticker: "2330", marketCode: "TW", barDate: "2026-06-03", open: 110, high: 110, low: 110, close: 110, volume: 10_000, source: "test", ingestedAt: "2026-06-03T10:00:00.000Z" },
      { ticker: "AAPL", marketCode: "US", barDate: "2026-06-02", open: 50, high: 50, low: 50, close: 50, volume: 10_000, source: "test", ingestedAt: "2026-06-02T20:00:00.000Z" },
      { ticker: "AAPL", marketCode: "US", barDate: "2026-06-03", open: 55, high: 55, low: 55, close: 55, volume: 10_000, source: "test", ingestedAt: "2026-06-03T20:00:00.000Z" },
    ]);

    const allScope = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y&limit=10",
      headers: { cookie: cookieHeader },
    });
    expect(allScope.statusCode).toBe(200);
    const allBody = allScope.json() as {
      summary: {
        costBasisAmount: number;
        marketValueAmount: number | null;
        dailyChangeAmount: number | null;
      };
      holdings: {
        rows: Array<{
          ticker: string;
          reportingCostBasisAmount: number | null;
          reportingMarketValueAmount: number | null;
          dailyChangeAmount: number | null;
        }>;
      };
      allocation: { byMarket: Array<{ amount: number | null }> };
    };
    const allRowMarketValue = allBody.holdings.rows.reduce((sum, row) => sum + (row.reportingMarketValueAmount ?? 0), 0);
    const allRowCostBasis = allBody.holdings.rows.reduce((sum, row) => sum + (row.reportingCostBasisAmount ?? 0), 0);
    const allRowDailyChange = allBody.holdings.rows.reduce((sum, row) => sum + (row.dailyChangeAmount ?? 0), 0);
    const allMarketBucketValue = allBody.allocation.byMarket.reduce((sum, bucket) => sum + (bucket.amount ?? 0), 0);

    expect(allBody.summary.costBasisAmount).toBe(4200);
    expect(allBody.summary.marketValueAmount).toBe(4620);
    expect(allBody.summary.dailyChangeAmount).toBe(420);
    expect(allRowCostBasis).toBe(allBody.summary.costBasisAmount);
    expect(allRowMarketValue).toBe(allBody.summary.marketValueAmount);
    expect(allRowDailyChange).toBe(allBody.summary.dailyChangeAmount);
    expect(allMarketBucketValue).toBe(allBody.summary.marketValueAmount);
    expect(allBody.holdings.rows.find((row) => row.ticker === "AAPL")?.dailyChangeAmount).toBe(320);

    const usScope = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=US&range=1Y&limit=10",
      headers: { cookie: cookieHeader },
    });
    expect(usScope.statusCode).toBe(200);
    const usBody = usScope.json() as typeof allBody & { query: { reportingCurrency: string } };
    const usRow = usBody.holdings.rows[0];
    expect(usBody.query.reportingCurrency).toBe("USD");
    expect(usBody.summary.costBasisAmount).toBe(100);
    expect(usBody.summary.marketValueAmount).toBe(110);
    expect(usBody.summary.dailyChangeAmount).toBe(10);
    expect(usRow?.reportingCostBasisAmount).toBe(usBody.summary.costBasisAmount);
    expect(usRow?.reportingMarketValueAmount).toBe(usBody.summary.marketValueAmount);
    expect(usRow?.dailyChangeAmount).toBe(usBody.summary.dailyChangeAmount);
  });

  it("scopes realized pnl amount and transaction count to the resolved report range bounds", async () => {
    vi.setSystemTime(new Date("2026-06-21T12:00:00.000Z"));

    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");

    const realizedTrades = [
      { id: "range-sell-outside-1y", tradeDate: "2025-06-20", realizedPnlAmount: 5 },
      { id: "range-sell-1y-boundary", tradeDate: "2025-06-21", realizedPnlAmount: 10 },
      { id: "range-sell-ytd-boundary", tradeDate: "2026-01-01", realizedPnlAmount: 20 },
      { id: "range-sell-3m-boundary", tradeDate: "2026-03-21", realizedPnlAmount: 30 },
      { id: "range-sell-1m-boundary", tradeDate: "2026-05-21", realizedPnlAmount: 40 },
      { id: "range-sell-as-of", tradeDate: "2026-06-21", realizedPnlAmount: 50 },
    ];

    for (const [index, trade] of realizedTrades.entries()) {
      store.accounting.facts.tradeEvents.push({
        id: trade.id,
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 100 + index,
        priceCurrency: "TWD",
        tradeDate: trade.tradeDate,
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: `${trade.tradeDate}T09:00:00.000Z`,
        bookingSequence: index + 1,
        bookedAt: `${trade.tradeDate}T09:00:00.000Z`,
        realizedPnlAmount: trade.realizedPnlAmount,
        realizedPnlCurrency: "TWD",
      });
    }

    store.accounting.facts.tradeEvents.push({
      id: "range-buy-ignored",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1,
      unitPrice: 80,
      priceCurrency: "TWD",
      tradeDate: "2026-06-10",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-10T09:00:00.000Z",
      bookingSequence: 99,
      bookedAt: "2026-06-10T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const cases = [
      { range: "1M", rangeStartDate: "2026-05-21", rangeEndDate: "2026-06-21", realizedPnlAmount: 90, realizedPnlTransactionCount: 2 },
      { range: "3M", rangeStartDate: "2026-03-21", rangeEndDate: "2026-06-21", realizedPnlAmount: 120, realizedPnlTransactionCount: 3 },
      { range: "YTD", rangeStartDate: "2026-01-01", rangeEndDate: "2026-06-21", realizedPnlAmount: 140, realizedPnlTransactionCount: 4 },
      { range: "1Y", rangeStartDate: "2025-06-21", rangeEndDate: "2026-06-21", realizedPnlAmount: 150, realizedPnlTransactionCount: 5 },
    ] as const;

    for (const testCase of cases) {
      const response = await app.inject({
        method: "GET",
        url: `/reports/portfolio?scope=TW&range=${testCase.range}`,
        headers: { cookie: cookieHeader },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        query: expect.objectContaining({
          scope: "TW",
          range: testCase.range,
          rangeStartDate: testCase.rangeStartDate,
          rangeEndDate: testCase.rangeEndDate,
          asOf: testCase.rangeEndDate,
        }),
        summary: expect.objectContaining({
          realizedPnlAmount: testCase.realizedPnlAmount,
          realizedPnlTransactionCount: testCase.realizedPnlTransactionCount,
        }),
      }));
    }
  });

  it("ignores out-of-range realized pnl currencies when building report FX status", async () => {
    vi.setSystemTime(new Date("2026-06-21T12:00:00.000Z"));

    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");

    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push(
      {
        id: "range-fx-in-range-twd-sell",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-10",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-10T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-10T09:00:00.000Z",
        realizedPnlAmount: 25,
        realizedPnlCurrency: "TWD",
      },
      {
        id: "range-fx-out-of-range-usd-sell",
        userId,
        accountId: "acc-1",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 200,
        priceCurrency: "USD",
        tradeDate: "2026-05-20",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-05-20T14:30:00.000Z",
        bookingSequence: 2,
        bookedAt: "2026-05-20T14:30:00.000Z",
        realizedPnlAmount: 50,
        realizedPnlCurrency: "USD",
      },
    );
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1M&currencyMode=specified&currency=TWD&limit=5",
      headers: { cookie: cookieHeader },
    });
    const body = response.json() as {
      summary: {
        realizedPnlAmount: number;
        realizedPnlTransactionCount: number;
      };
      fxStatus: {
        status: string;
        nativeCurrencies: string[];
        missingRatePairs: Array<{ from: string; to: string }>;
      };
    };

    expect(response.statusCode).toBe(200);
    expect(body.summary.realizedPnlAmount).toBe(25);
    expect(body.summary.realizedPnlTransactionCount).toBe(1);
    expect(body.fxStatus.status).toBe("complete");
    expect(body.fxStatus.nativeCurrencies).not.toContain("USD");
    expect(body.fxStatus.missingRatePairs).toEqual([]);
  });

  it("returns an empty all-market performance series when holding snapshots are absent", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const quoteDate = relativeIsoDate(0);
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-all-synthetic-quote-trade",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: relativeIsoDate(-1),
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: `${relativeIsoDate(-1)}T09:00:00.000Z`,
      bookingSequence: 1,
      bookedAt: `${relativeIsoDate(-1)}T09:00:00.000Z`,
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: quoteDate,
        open: 105,
        high: 106,
        low: 104,
        close: 105,
        volume: 12_000,
        source: "test",
        ingestedAt: `${quoteDate}T10:00:00.000Z`,
      },
    ]);
    const historicalBarsSpy = vi.spyOn(app.persistence, "getDailyBarsForTickerMarket");

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const portfolioBody = portfolioReport.json() as {
      diagnostics: {
        lastValuationDate: string | null;
        latestReliableValuationDate: string | null;
        latestSnapshotDate: string | null;
        knownGapReasons: string[];
      };
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
          totalReturnPercent: number | null;
        }>;
      };
    };

    expect(portfolioReport.statusCode).toBe(200);
    expect(historicalBarsSpy).not.toHaveBeenCalled();
    expect(portfolioBody.performance.fxStatus).toBe("complete");
    expect(portfolioBody.performance.points).toEqual([]);
    expect(portfolioBody.diagnostics.lastValuationDate).toBeNull();
    expect(portfolioBody.diagnostics.latestReliableValuationDate).toBeNull();
    expect(portfolioBody.diagnostics.latestSnapshotDate).toBeNull();
    expect(portfolioBody.diagnostics.knownGapReasons).toContain("missing_snapshot");

    historicalBarsSpy.mockClear();

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=all&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const marketBody = marketReport.json() as {
      diagnostics: {
        lastValuationDate: string | null;
        latestReliableValuationDate: string | null;
        latestSnapshotDate: string | null;
        knownGapReasons: string[];
      };
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
          totalReturnPercent: number | null;
        }>;
      };
    };

    expect(marketReport.statusCode).toBe(200);
    expect(historicalBarsSpy).not.toHaveBeenCalled();
    expect(marketBody.performance.fxStatus).toBe("complete");
    expect(marketBody.performance.points).toEqual([]);
    expect(marketBody.diagnostics.lastValuationDate).toBeNull();
    expect(marketBody.diagnostics.latestReliableValuationDate).toBeNull();
    expect(marketBody.diagnostics.latestSnapshotDate).toBeNull();
    expect(marketBody.diagnostics.knownGapReasons).toContain("missing_snapshot");
  });

  it("returns empty TW-scoped performance when TW snapshots are absent", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usdFeeProfile = {
      ...feeProfile,
      id: "fp-usd-tw-scope",
      accountId: "acc-usd-tw-scope",
      name: "USD Broker Fee",
    };
    store.feeProfiles.push(usdFeeProfile);
    store.accounts.push({
      id: "acc-usd-tw-scope",
      userId,
      name: "US Broker",
      feeProfileId: usdFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-usd-tw-scope",
        ticker: "AAPL",
        quantity: 5,
        costBasisAmount: 500,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-tw-scope-trade-1",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        id: "report-us-scope-trade-1",
        userId,
        accountId: "acc-usd-tw-scope",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 5,
        unitPrice: 100,
        priceCurrency: "USD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
        tradeTimestamp: "2026-06-01T14:30:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T14:30:00.000Z",
      },
    );
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-02",
        open: 100,
        high: 104,
        low: 99,
        close: 103,
        volume: 10_000,
        source: "test",
        ingestedAt: "2026-06-02T10:00:00.000Z",
      },
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 103,
        high: 106,
        low: 102,
        close: 105,
        volume: 12_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);

    const generatedAt = "2026-06-03T10:00:00.000Z";
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "us-scope-snap-1",
        userId,
        accountId: "acc-usd-tw-scope",
        ticker: "AAPL",
        marketCode: "US",
        snapshotDate: "2026-06-02",
        quantity: 5,
        closePrice: 110,
        marketValue: 550,
        costBasis: 500,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "USD",
        valueNative: 550,
        costBasisNative: 500,
        unrealizedPnlNative: 50,
        providerSource: "test",
        generatedAt,
        generationRunId: "us-scope-gen",
      },
    ]);
    const snapshotSpy = vi.spyOn(app.persistence, "getHoldingSnapshotsForTicker");
    const scopedAggregateSpy = vi.spyOn(app.persistence, "getAggregatedSnapshotsInReportingCurrencyForScope");

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?scope=TW&limit=5",
      headers: { cookie: cookieHeader },
    });
    const dailyReviewBody = dailyReview.json() as { holdings: { rows: Array<{ ticker: string }> } };
    expect(dailyReview.statusCode).toBe(200);
    expect(dailyReviewBody.holdings.rows.map((row) => row.ticker)).toEqual(["2330"]);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(scopedAggregateSpy).not.toHaveBeenCalled();

    snapshotSpy.mockClear();
    scopedAggregateSpy.mockClear();

    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=TW&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const portfolioBody = portfolioReport.json() as {
      query: { scope: string; reportingCurrency: string };
      allocation: { byMarket: Array<{ key: string }> };
      concentration: { topHoldings: Array<{ ticker: string }> };
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
          totalReturnPercent: number | null;
        }>;
      };
    };
    expect(portfolioReport.statusCode).toBe(200);
    expect(portfolioBody).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "TW",
        reportingCurrency: "TWD",
      }),
    }));
    expect(portfolioBody.allocation.byMarket.map((bucket) => bucket.key)).toEqual(["TW"]);
    expect(portfolioBody.concentration.topHoldings.map((row) => row.ticker)).toEqual(["2330"]);
    expect(portfolioBody.performance.fxStatus).toBe("complete");
    expect(portfolioBody.performance.points).toEqual([]);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(scopedAggregateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "TWD",
      [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
    );

    snapshotSpy.mockClear();
    scopedAggregateSpy.mockClear();

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=TW&limit=5",
      headers: { cookie: cookieHeader },
    });
    const marketBody = marketReport.json() as {
      detail: { rows: Array<{ ticker: string }> };
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
        }>;
      };
    };
    expect(marketReport.statusCode).toBe(200);
    expect(marketBody.detail.rows.map((row) => row.ticker)).toEqual(["2330"]);
    expect(marketBody.performance.fxStatus).toBe("complete");
    expect(marketBody.performance.points).toEqual([]);
    expect(snapshotSpy).not.toHaveBeenCalled();
    expect(scopedAggregateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "TWD",
      [{ accountId: "acc-1", ticker: "2330", marketCode: "TW" }],
    );
  });

  it("does not resolve a second quote snapshot set for snapshot-backed scoped performance", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-tw-snapshot-trade",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "tw-scoped-snapshot-backed-1",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        snapshotDate: "2026-06-02",
        quantity: 10,
        closePrice: 103,
        marketValue: 1030,
        costBasis: 1000,
        unrealizedPnl: 30,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1030,
        costBasisNative: 1000,
        unrealizedPnlNative: 30,
        providerSource: "test",
        generatedAt: "2026-06-02T10:00:00.000Z",
        generationRunId: "tw-scoped-snapshot-backed",
      },
    ]);
    const quoteBarsSpy = vi.spyOn(app.persistence, "getLatestBarsByTickerMarket");

    const report = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=TW&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const body = report.json() as {
      performance: {
        points: Array<{ date: string; marketValueAmount: number | null }>;
      };
    };

    expect(report.statusCode).toBe(200);
    expect(body.performance.points).toEqual([
      expect.objectContaining({
        date: "2026-06-02",
        marketValueAmount: 1030,
      }),
    ]);
    expect(quoteBarsSpy).toHaveBeenCalledTimes(1);
  });

  it("uses market-qualified scoped snapshots when the same ticker exists in another market", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.instruments.push(
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "TW",
        isProvisional: false,
      },
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "AU",
        isProvisional: false,
      },
    );
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "BHP",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-bhp-tw-trade",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
      },
      {
        id: "report-bhp-au-trade",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 2,
        unitPrice: 50,
        priceCurrency: "AUD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T10:00:00.000Z",
        bookingSequence: 2,
        bookedAt: "2026-06-01T10:00:00.000Z",
      },
    );
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "BHP",
        marketCode: "TW",
        barDate: "2026-06-02",
        open: 100,
        high: 106,
        low: 99,
        close: 105,
        volume: 10_000,
        source: "test",
        ingestedAt: "2026-06-02T10:00:00.000Z",
      },
    ]);
    await app.persistence.bulkUpsertHoldingSnapshots(userId, [
      {
        id: "bhp-ambiguous-tw-snapshot",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "TW",
        snapshotDate: "2026-06-02",
        quantity: 10,
        closePrice: 105,
        marketValue: 1050,
        costBasis: 1000,
        unrealizedPnl: 50,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "TWD",
        valueNative: 1050,
        costBasisNative: 1000,
        unrealizedPnlNative: 50,
        providerSource: "test",
        generatedAt: "2026-06-02T10:00:00.000Z",
        generationRunId: "bhp-ambiguous-tw",
      },
      {
        id: "bhp-ambiguous-au-snapshot",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "AU",
        snapshotDate: "2026-06-02",
        quantity: 2,
        closePrice: 50,
        marketValue: 100,
        costBasis: 100,
        unrealizedPnl: 0,
        cumulativeRealizedPnl: 0,
        cumulativeDividends: 0,
        isProvisional: false,
        currency: "AUD",
        valueNative: 100,
        costBasisNative: 100,
        unrealizedPnlNative: 0,
        providerSource: "test",
        generatedAt: "2026-06-02T10:00:00.000Z",
        generationRunId: "bhp-ambiguous-au",
      },
    ]);
    const scopedAggregateSpy = vi.spyOn(app.persistence, "getAggregatedSnapshotsInReportingCurrencyForScope");

    const report = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=TW&range=1Y",
      headers: { cookie: cookieHeader },
    });
    const body = report.json() as {
      performance: {
        fxStatus: string;
        points: Array<{
          date: string;
          totalCostAmount: number | null;
          marketValueAmount: number | null;
          totalReturnAmount: number | null;
        }>;
      };
    };

    expect(report.statusCode).toBe(200);
    expect(body.performance.fxStatus).toBe("complete");
    expect(body.performance.points).toEqual([
      expect.objectContaining({
        date: "2026-06-02",
        totalCostAmount: 1000,
        marketValueAmount: 1050,
        totalReturnAmount: 50,
      }),
    ]);
    expect(scopedAggregateSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(String),
      "TWD",
      [{ accountId: "acc-1", ticker: "BHP", marketCode: "TW" }],
    );
  });

  it("does not let cross-market lots create scoped snapshot gap repair targets", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.instruments.push(
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "AU",
        isProvisional: false,
      },
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    );
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "BHP",
      quantity: 2,
      costBasisAmount: 100,
      currency: "AUD",
    });
    store.accounting.projections.lots.push(
      {
        id: "report-bhp-old-us-lot",
        accountId: "acc-1",
        ticker: "BHP",
        openQuantity: 1,
        totalCostAmount: 70,
        costCurrency: "USD",
        openedAt: "2020-01-01",
      },
      {
        id: "report-bhp-future-au-lot",
        accountId: "acc-1",
        ticker: "BHP",
        openQuantity: 2,
        totalCostAmount: 100,
        costCurrency: "AUD",
        openedAt: "2999-01-01",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-bhp-old-us-trade",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 1,
        unitPrice: 70,
        priceCurrency: "USD",
        tradeDate: "2020-01-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2020-01-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2020-01-01T09:00:00.000Z",
      },
      {
        id: "report-bhp-future-au-trade",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 2,
        unitPrice: 50,
        priceCurrency: "AUD",
        tradeDate: "2999-01-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2999-01-01T09:00:00.000Z",
        bookingSequence: 2,
        bookedAt: "2999-01-01T09:00:00.000Z",
      },
    );
    await app.persistence.saveStore(store);

    const report = await app.inject({
      method: "GET",
      url: "/reports/market?scope=AU&limit=5",
      headers: { cookie: cookieHeader },
    });
    const body = report.json() as {
      diagnostics: {
        snapshotGapHoldings?: Array<{ ticker: string; marketCode: string; knownGapReasons: string[] }>;
      };
    };

    expect(report.statusCode).toBe(200);
    expect(body.diagnostics.snapshotGapHoldings ?? []).toEqual([]);
  });

  it("preserves scoped upcoming dividend events that do not have ledger rows", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usdFeeProfile = {
      ...feeProfile,
      id: "fp-us-upcoming-dividend",
      accountId: "acc-us-upcoming-dividend",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(usdFeeProfile);
    store.accounts.push({
      id: "acc-us-upcoming-dividend",
      userId,
      name: "US Broker",
      feeProfileId: usdFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push(
      {
        ticker: "2330",
        type: "STOCK",
        marketCode: "TW",
        isProvisional: false,
      },
      {
        ticker: "AAPL",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    );
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 10,
        costBasisAmount: 1000,
        currency: "TWD",
      },
      {
        accountId: "acc-us-upcoming-dividend",
        ticker: "AAPL",
        quantity: 5,
        costBasisAmount: 500,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-tw-upcoming-dividend-trade",
        userId,
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 10,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: relativeIsoDate(-10),
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: `${relativeIsoDate(-10)}T09:00:00.000Z`,
        bookingSequence: 1,
        bookedAt: `${relativeIsoDate(-10)}T09:00:00.000Z`,
      },
      {
        id: "report-us-upcoming-dividend-trade",
        userId,
        accountId: "acc-us-upcoming-dividend",
        ticker: "AAPL",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 5,
        unitPrice: 100,
        priceCurrency: "USD",
        tradeDate: relativeIsoDate(-10),
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
        tradeTimestamp: `${relativeIsoDate(-10)}T14:30:00.000Z`,
        bookingSequence: 1,
        bookedAt: `${relativeIsoDate(-10)}T14:30:00.000Z`,
      },
    );
    store.marketData.dividendEvents.push(
      {
        id: "report-tw-upcoming-dividend-event",
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: relativeIsoDate(10),
        paymentDate: relativeIsoDate(20),
        cashDividendPerShare: 3,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "report-us-upcoming-dividend-event",
        ticker: "AAPL",
        eventType: "CASH",
        exDividendDate: relativeIsoDate(10),
        paymentDate: relativeIsoDate(20),
        cashDividendPerShare: 2,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
    );
    await app.persistence.saveStore(store);

    for (const endpoint of ["daily-review", "portfolio", "market"]) {
      const response = await app.inject({
        method: "GET",
        url: `/reports/${endpoint}?scope=TW&currencyMode=specified&currency=TWD&limit=5`,
        headers: { cookie: cookieHeader },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        query: expect.objectContaining({
          scope: "TW",
          reportingCurrency: "TWD",
        }),
        summary: expect.objectContaining({
          upcomingDividendCount: 1,
          upcomingDividendAmount: 30,
        }),
      }));
    }
  });

  it("includes realized P&L and dividend currencies in report FX status", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-krw-realized-pnl-trade",
      userId,
      accountId: "acc-1",
      ticker: "005930",
      marketCode: "KR",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 1,
      unitPrice: 10_000,
      priceCurrency: "KRW",
      realizedPnlAmount: 1_000,
      realizedPnlCurrency: "KRW",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-krw-realized-pnl-trade-duplicate-date",
      userId,
      accountId: "acc-1",
      ticker: "005930",
      marketCode: "KR",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 1,
      unitPrice: 10_000,
      priceCurrency: "KRW",
      realizedPnlAmount: 2_000,
      realizedPnlCurrency: "KRW",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:01:00.000Z",
      bookingSequence: 2,
      bookedAt: "2026-06-01T09:01:00.000Z",
    });
    store.marketData.dividendEvents.push({
      id: "report-krw-dividend-event",
      ticker: "005930",
      eventType: "CASH",
      exDividendDate: "2026-06-01",
      paymentDate: "2026-06-03",
      cashDividendPerShare: 100,
      cashDividendCurrency: "KRW",
      stockDividendPerShare: 0,
      source: "test",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "report-krw-dividend-ledger",
      accountId: "acc-1",
      dividendEventId: "report-krw-dividend-event",
      eligibleQuantity: 1,
      expectedCashAmount: 100,
      expectedStockQuantity: 0,
      receivedCashAmount: 100,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "report-krw-dividend-ledger-duplicate-date",
      accountId: "acc-1",
      dividendEventId: "report-krw-dividend-event",
      eligibleQuantity: 1,
      expectedCashAmount: 50,
      expectedStockQuantity: 0,
      receivedCashAmount: 50,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
    });
    await app.persistence.saveStore(store);
    const getFxRateSpy = vi.spyOn(app.persistence, "getFxRate");

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?range=1Y&currencyMode=specified&currency=TWD&limit=5",
      headers: { cookie: cookieHeader },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      fxStatus: expect.objectContaining({
        status: "missing",
        nativeCurrencies: expect.arrayContaining(["KRW"]),
        missingRatePairs: expect.arrayContaining([
          expect.objectContaining({ from: "KRW", to: "TWD" }),
        ]),
      }),
    }));
    const historicalKrwCalls = getFxRateSpy.mock.calls
      .filter(([from, to, date]) => from === "KRW" && to === "TWD" && (date === "2026-06-01" || date === "2026-06-03"))
      .map(([, , date]) => date);
    expect(historicalKrwCalls).toEqual(["2026-06-01", "2026-06-03"]);
  });

  it("[reports-fx]: historical income and realized-P&L FX missing while later report FX exists → report marks FX partial", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const usdFeeProfile = {
      ...feeProfile,
      id: "fp-us-historical-dividend-fx",
      accountId: "acc-us-historical-dividend-fx",
      name: "US Broker Fee",
    };
    store.feeProfiles.push(usdFeeProfile);
    store.accounts.push({
      id: "acc-us-historical-dividend-fx",
      userId,
      name: "US Broker",
      feeProfileId: usdFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push({
      ticker: "AAPL",
      type: "STOCK",
      marketCode: "US",
      isProvisional: false,
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-us-historical-dividend-fx",
      ticker: "AAPL",
      quantity: 5,
      costBasisAmount: 500,
      currency: "USD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-us-historical-dividend-fx-trade",
      userId,
      accountId: "acc-us-historical-dividend-fx",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 5,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: usdFeeProfile,
      tradeTimestamp: "2026-06-01T14:30:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T14:30:00.000Z",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-us-historical-realized-fx-trade",
      userId,
      accountId: "acc-us-historical-dividend-fx",
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 1,
      unitPrice: 125,
      priceCurrency: "USD",
      tradeDate: "2026-06-02",
      commissionAmount: 0,
      taxAmount: 0,
      realizedPnlAmount: 25,
      realizedPnlCurrency: "USD",
      isDayTrade: false,
      feeSnapshot: usdFeeProfile,
      tradeTimestamp: "2026-06-02T14:30:00.000Z",
      bookingSequence: 2,
      bookedAt: "2026-06-02T14:30:00.000Z",
    });
    store.marketData.dividendEvents.push({
      id: "report-us-historical-dividend-fx-event",
      ticker: "AAPL",
      eventType: "CASH",
      exDividendDate: "2026-06-01",
      paymentDate: "2026-06-03",
      cashDividendPerShare: 2,
      cashDividendCurrency: "USD",
      stockDividendPerShare: 0,
      source: "test",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "report-us-historical-dividend-fx-ledger",
      accountId: "acc-us-historical-dividend-fx",
      dividendEventId: "report-us-historical-dividend-fx-event",
      eligibleQuantity: 5,
      expectedCashAmount: 10,
      expectedStockQuantity: 0,
      receivedCashAmount: 10,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
    });
    await app.persistence.saveStore(store);
    await app.persistence.upsertFxRates([
      {
        date: "2026-06-04",
        baseCurrency: "USD",
        quoteCurrency: "TWD",
        rate: 32,
        source: "test",
      },
    ]);

    const portfolioResponse = await app.inject({
      method: "GET",
      url: "/reports/portfolio?currencyMode=specified&currency=TWD&limit=5",
      headers: { cookie: cookieHeader },
    });
    const portfolioBody = portfolioResponse.json() as {
      summary: { incomeAmount: number; realizedPnlAmount: number };
      income: { trailingDividendAmount: number };
      fxStatus: {
        status: string;
        missingRatePairs: Array<{ from: string; to: string }>;
      };
      dataHealth: { missingFxCount: number };
      diagnostics: { missingFxCount: number };
    };

    expect(portfolioResponse.statusCode).toBe(200);
    expect(portfolioBody.summary.incomeAmount).toBe(0);
    expect(portfolioBody.summary.realizedPnlAmount).toBe(0);
    expect(portfolioBody.income.trailingDividendAmount).toBe(0);
    expect(portfolioBody.fxStatus.status).toBe("partial");
    expect(portfolioBody.fxStatus.missingRatePairs).toEqual([
      expect.objectContaining({ from: "USD", to: "TWD" }),
    ]);
    expect(portfolioBody.dataHealth.missingFxCount).toBe(1);
    expect(portfolioBody.diagnostics.missingFxCount).toBe(1);

    const dailyResponse = await app.inject({
      method: "GET",
      url: "/reports/daily-review?currencyMode=specified&currency=TWD&limit=5",
      headers: { cookie: cookieHeader },
    });
    const dailyBody = dailyResponse.json() as {
      suggestions: Array<{ code: string; detail: string }>;
    };

    expect(dailyResponse.statusCode).toBe(200);
    expect(dailyBody.suggestions).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "fx_missing",
        detail: expect.stringContaining("1 FX input(s)"),
      }),
    ]));
  });

  it("excludes reversed and superseded dividend ledger rows from report income", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 10,
      costBasisAmount: 1000,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-income-trade",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 10,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    store.marketData.dividendEvents.push({
      id: "report-income-dividend-event",
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-06-01",
      paymentDate: "2026-06-03",
      cashDividendPerShare: 10,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    });
    store.accounting.facts.dividendLedgerEntries.push(
      {
        id: "report-income-active",
        accountId: "acc-1",
        dividendEventId: "report-income-dividend-event",
        eligibleQuantity: 10,
        expectedCashAmount: 100,
        expectedStockQuantity: 0,
        receivedCashAmount: 100,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
      },
      {
        id: "report-income-reversed-original",
        accountId: "acc-1",
        dividendEventId: "report-income-dividend-event",
        eligibleQuantity: 10,
        expectedCashAmount: 80,
        expectedStockQuantity: 0,
        receivedCashAmount: 80,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
      },
      {
        id: "report-income-reversal",
        accountId: "acc-1",
        dividendEventId: "report-income-dividend-event",
        eligibleQuantity: 10,
        expectedCashAmount: -80,
        expectedStockQuantity: 0,
        receivedCashAmount: -80,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
        reversalOfDividendLedgerEntryId: "report-income-reversed-original",
      },
      {
        id: "report-income-superseded",
        accountId: "acc-1",
        dividendEventId: "report-income-dividend-event",
        eligibleQuantity: 10,
        expectedCashAmount: 60,
        expectedStockQuantity: 0,
        receivedCashAmount: 60,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
        supersededAt: "2026-06-04T00:00:00.000Z",
      },
    );
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=TW&currencyMode=specified&currency=TWD&limit=5",
      headers: { cookie: cookieHeader },
    });
    const body = response.json() as {
      summary: { incomeAmount: number | null };
      income: { trailingDividendAmount: number | null; recentDividendCount: number };
    };

    expect(response.statusCode).toBe(200);
    expect(body.summary.incomeAmount).toBe(100);
    expect(body.income.trailingDividendAmount).toBe(100);
    expect(body.income.recentDividendCount).toBe(1);
  });

  it("rejects unsupported report ranges before route or MCP report builders can fail generically", async () => {
    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio?range=foo",
      headers: { cookie: cookieHeader },
    });
    expect(portfolioReport.statusCode).toBe(400);
    expect(portfolioReport.json()).toEqual(expect.objectContaining({
      error: "invalid_report_range",
      message: expect.stringContaining("range must be one of"),
    }));

    const dailyReview = await app.inject({
      method: "GET",
      url: "/reports/daily-review?range=foo",
      headers: { cookie: cookieHeader },
    });
    expect(dailyReview.statusCode).toBe(400);
    expect(dailyReview.json()).toEqual(expect.objectContaining({
      error: "invalid_report_range",
    }));

    await expect(buildPortfolioReport(app, userId, { range: "foo" })).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_report_range",
    });
  });

  it("omits valuation health for empty portfolio and market report scopes", async () => {
    const portfolioReport = await app.inject({
      method: "GET",
      url: "/reports/portfolio",
      headers: { cookie: cookieHeader },
    });
    expect(portfolioReport.statusCode).toBe(200);
    const portfolioBody = portfolioReport.json();
    expect(portfolioBody.holdings.total).toBe(0);
    expect(portfolioBody).not.toHaveProperty("valuationHealth");
    expect(portfolioBody.performance).not.toHaveProperty("valuationHealth");

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=US",
      headers: { cookie: cookieHeader },
    });
    expect(marketReport.statusCode).toBe(200);
    const marketBody = marketReport.json();
    expect(marketBody.detail.total).toBe(0);
    expect(marketBody).not.toHaveProperty("valuationHealth");
    expect(marketBody.performance).not.toHaveProperty("valuationHealth");
  });

  it("scopes market reports by holding market instead of account currency", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    const accountFeeProfile = {
      ...feeProfile,
      id: "fp-usd-au",
      accountId: "acc-usd-au",
      name: "USD AU Broker Fee",
    };
    store.feeProfiles.push(accountFeeProfile);
    store.accounts.push({
      id: "acc-usd-au",
      userId,
      name: "USD Broker With AU Holding",
      feeProfileId: accountFeeProfile.id,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    store.instruments.push({
      ticker: "BHP",
      type: "STOCK",
      marketCode: "AU",
      isProvisional: false,
    });
    store.accounting.projections.holdings.push({
      accountId: "acc-usd-au",
      ticker: "BHP",
      quantity: 8,
      costBasisAmount: 320,
      currency: "AUD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-au-trade-1",
      userId,
      accountId: "acc-usd-au",
      ticker: "BHP",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 8,
      unitPrice: 40,
      priceCurrency: "AUD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: accountFeeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=AU&currencyMode=auto&limit=5",
      headers: { cookie: cookieHeader },
    });

    expect(marketReport.statusCode).toBe(200);
    expect(marketReport.json()).toEqual(expect.objectContaining({
      query: expect.objectContaining({
        scope: "AU",
        reportingCurrency: "AUD",
      }),
      detail: expect.objectContaining({
        rows: expect.arrayContaining([
          expect.objectContaining({
            ticker: "BHP",
            marketCode: "AU",
            reportingCurrency: "AUD",
          }),
        ]),
      }),
    }));
  });

  it("keeps same-ticker realized P&L scoped to the selected market", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.instruments.push(
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "AU",
        isProvisional: false,
      },
      {
        ticker: "BHP",
        type: "STOCK",
        marketCode: "US",
        isProvisional: false,
      },
    );
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-1",
        ticker: "BHP",
        quantity: 8,
        costBasisAmount: 320,
        currency: "AUD",
      },
      {
        accountId: "acc-1",
        ticker: "BHP",
        quantity: 3,
        costBasisAmount: 180,
        currency: "USD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "report-au-sell-1",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 45,
        priceCurrency: "AUD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:00:00.000Z",
        bookingSequence: 1,
        bookedAt: "2026-06-01T09:00:00.000Z",
        realizedPnlAmount: 10,
        realizedPnlCurrency: "AUD",
      },
      {
        id: "report-us-sell-1",
        userId,
        accountId: "acc-1",
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "SELL",
        quantity: 1,
        unitPrice: 90,
        priceCurrency: "AUD",
        tradeDate: "2026-06-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: feeProfile,
        tradeTimestamp: "2026-06-01T09:01:00.000Z",
        bookingSequence: 2,
        bookedAt: "2026-06-01T09:01:00.000Z",
        realizedPnlAmount: 999,
        realizedPnlCurrency: "AUD",
      },
    );
    await app.persistence.saveStore(store);

    const marketReport = await app.inject({
      method: "GET",
      url: "/reports/market?scope=AU&range=1Y&currencyMode=specified&currency=AUD&limit=5",
      headers: { cookie: cookieHeader },
    });

    expect(marketReport.statusCode).toBe(200);
    expect(marketReport.json()).toEqual(expect.objectContaining({
      summary: expect.objectContaining({
        realizedPnlAmount: 10,
        realizedPnlTransactionCount: 1,
      }),
      detail: expect.objectContaining({
        rows: [
          expect.objectContaining({
            ticker: "BHP",
            marketCode: "AU",
            reportingCurrency: "AUD",
          }),
        ],
      }),
    }));
  });

  it("splits ticker primary and enrichment payloads", async () => {
    const store = await app.persistence.loadStore(userId);
    const feeProfile = store.feeProfiles[0];
    if (!feeProfile) throw new Error("expected default fee profile");
    store.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 4,
      costBasisAmount: 400,
      currency: "TWD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "report-ticker-trade-1",
      userId,
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 4,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-06-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
      tradeTimestamp: "2026-06-01T09:00:00.000Z",
      bookingSequence: 1,
      bookedAt: "2026-06-01T09:00:00.000Z",
    });
    await app.persistence.saveStore(store);

    const memoryPersistence = app.persistence as typeof app.persistence & {
      _seedDailyBars?: (bars: Array<{
        ticker: string;
        marketCode: "TW" | "US" | "AU";
        barDate: string;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        source: string;
        ingestedAt: string;
      }>) => void;
    };
    memoryPersistence._seedDailyBars?.([
      {
        ticker: "2330",
        marketCode: "TW",
        barDate: "2026-06-03",
        open: 100,
        high: 102,
        low: 99,
        close: 101,
        volume: 8_000,
        source: "test",
        ingestedAt: "2026-06-03T10:00:00.000Z",
      },
    ]);

    const primary = await app.inject({
      method: "GET",
      url: "/tickers/2330/primary?accountId=acc-1",
      headers: { cookie: cookieHeader },
    });
    expect(primary.statusCode).toBe(200);
    expect(primary.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "2330",
        marketCode: "TW",
      }),
      position: expect.objectContaining({
        quantity: 4,
      }),
      transactions: expect.any(Array),
    }));
    expect(primary.json().chart).toBeUndefined();
    expect(primary.json().fundamentals).toBeUndefined();

    const enrichment = await app.inject({
      method: "GET",
      url: "/tickers/2330/enrichment?accountId=acc-1",
      headers: { cookie: cookieHeader },
    });
    expect(enrichment.statusCode).toBe(200);
    expect(enrichment.json()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({
        ticker: "2330",
      }),
      chart: expect.objectContaining({
        range: "1Y",
      }),
      fundamentals: expect.any(Object),
      fundamentalsRefresh: expect.any(Object),
    }));
    expect(enrichment.json().position).toBeUndefined();
    expect(enrichment.json().transactions).toBeUndefined();
  });
});
