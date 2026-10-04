import type { IntradayPriceOverlay } from "@vakwen/domain";
import { describe, expect, it } from "vitest";
import type { HoldingSnapshot } from "../../src/persistence/types.js";
import { createEmptyTickerFundamentals } from "../../src/services/fundamentals/types.js";
import { createDefaultFeeProfile, createStore, setStoreInstruments } from "../../src/services/store.js";
import { buildTickerDetails } from "../../src/services/tickerDetails.js";

describe("buildTickerDetails", () => {
  function createPersistence(
    bars: Array<{
      ticker: string;
      marketCode: "TW" | "US" | "AU" | "KR";
      barDate: string;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      source: string;
      quality?: "full_bar" | "close_only";
    }> = [],
    calls: {
      historicalReads?: Array<{ ticker: string; marketCode: string; startDate: string; endDate: string }>;
      latestReads?: Array<{ pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>; limit: number }>;
    } = {},
    overlays = new Map<string, IntradayPriceOverlay>(),
    holdingSnapshots: HoldingSnapshot[] = [],
  ) {
    return {
      async getDailyBarsForTickerMarket(ticker: string, marketCode: string, startDate: string, endDate: string) {
        calls.historicalReads?.push({ ticker, marketCode, startDate, endDate });
        return bars
          .filter((bar) => (
            bar.ticker === ticker
            && bar.marketCode === marketCode
            && bar.barDate >= startDate
            && bar.barDate <= endDate
          ))
          .map((bar) => ({
            ...bar,
            quality: bar.quality ?? "full_bar" as const,
            ingestedAt: "2026-06-01T00:00:00.000Z",
          }));
      },
      async getLatestBarsByTickerMarket(
        pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>,
        limit: number,
      ) {
        calls.latestReads?.push({ pairs, limit });
        const pairKeys = new Set(pairs.map((pair) => `${pair.ticker}:${pair.marketCode}`));
        const grouped = new Map<string, typeof bars>();
        for (const bar of bars) {
          const key = `${bar.ticker}:${bar.marketCode}`;
          if (!pairKeys.has(key)) continue;
          const group = grouped.get(key) ?? [];
          group.push(bar);
          grouped.set(key, group);
        }
        return [...grouped.values()]
          .flatMap((group) => group
            .sort((left, right) => right.barDate.localeCompare(left.barDate))
            .slice(0, limit))
          .map((bar) => ({
            ...bar,
            quality: bar.quality ?? "full_bar" as const,
            ingestedAt: "2026-06-01T00:00:00.000Z",
          }));
      },
      async getLatestBars(tickers: readonly string[], limit: number) {
        const tickerSet = new Set(tickers);
        const grouped = new Map<string, typeof bars>();
        for (const bar of bars) {
          if (!tickerSet.has(bar.ticker)) continue;
          const group = grouped.get(bar.ticker) ?? [];
          group.push(bar);
          grouped.set(bar.ticker, group);
        }
        return [...grouped.values()]
          .flatMap((group) => group
            .sort((left, right) => right.barDate.localeCompare(left.barDate))
            .slice(0, limit))
          .map((bar) => ({
            ...bar,
            quality: bar.quality ?? "full_bar" as const,
            ingestedAt: "2026-06-01T00:00:00.000Z",
          }));
      },
      async getLatestIntradayOverlays(
        pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>,
      ) {
        const result = new Map<string, IntradayPriceOverlay>();
        for (const pair of pairs) {
          const key = `${pair.ticker}:${pair.marketCode}`;
          const overlay = overlays.get(key);
          if (overlay) result.set(key, overlay);
        }
        return result;
      },
      async listQuoteFallbackPoliciesForTickerMarkets() {
        return [];
      },
      async getLatestBarDatesByTickerMarket() {
        const result = new Map<string, string>();
        for (const bar of bars) {
          const key = `${bar.ticker}:${bar.marketCode}`;
          const current = result.get(key);
          if (!current || bar.barDate > current) {
            result.set(key, bar.barDate);
          }
        }
        return result;
      },
      async getInstrument(ticker: string, marketCode?: string) {
        return ticker && marketCode
          ? {
              ticker,
              name: `${ticker} ${marketCode}`,
              instrumentType: "STOCK" as const,
              marketCode,
              isProvisional: false,
              barsBackfillStatus: "ready" as const,
              verificationStatus: "verified" as const,
              createdAt: "2026-06-01T00:00:00.000Z",
              updatedAt: "2026-06-01T00:00:00.000Z",
            }
          : null;
      },
      async getFxRate() {
        return null;
      },
      async listHoldingSnapshots(
        _userId: string,
        options: {
          accountIds?: readonly string[];
          pairs?: ReadonlyArray<{ accountId: string; ticker: string; marketCode: string }>;
          startDate?: string;
          endDate?: string;
          includeProvisional?: boolean;
          limit: number;
          offset: number;
        },
      ) {
        const accountIds = new Set(options.accountIds ?? []);
        const pairs = new Set((options.pairs ?? []).map((pair) => `${pair.accountId}:${pair.marketCode}:${pair.ticker}`));
        const filteredRows = holdingSnapshots
          .filter((snapshot) => accountIds.size === 0 || accountIds.has(snapshot.accountId))
          .filter((snapshot) => pairs.size === 0 || pairs.has(`${snapshot.accountId}:${snapshot.marketCode}:${snapshot.ticker}`))
          .filter((snapshot) => !options.startDate || snapshot.snapshotDate >= options.startDate)
          .filter((snapshot) => !options.endDate || snapshot.snapshotDate <= options.endDate)
          .filter((snapshot) => options.includeProvisional || !snapshot.isProvisional)
          .sort((left, right) => left.snapshotDate.localeCompare(right.snapshotDate));
        const rows = filteredRows
          .slice(options.offset, options.offset + options.limit)
          .map((snapshot) => ({ ...snapshot, accountName: null }));
        return {
          rows,
          total: filteredRows.length,
          provisionalCount: filteredRows.filter((row) => row.isProvisional).length,
        };
      },
    };
  }

  function buildCrossMarketStore() {
    const store = createStore();
    const usdFeeProfile = createDefaultFeeProfile("acc-us", "USD", "fp-us");
    const audFeeProfile = createDefaultFeeProfile("acc-au", "AUD", "fp-au");

    store.accounts.push(
      {
        id: "acc-us",
        userId: "user-1",
        name: "US Broker",
        feeProfileId: usdFeeProfile.id,
        defaultCurrency: "USD",
        accountType: "broker",
      },
      {
        id: "acc-au",
        userId: "user-1",
        name: "AU Broker",
        feeProfileId: audFeeProfile.id,
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    );
    store.feeProfiles.push(usdFeeProfile, audFeeProfile);
    setStoreInstruments(store, [
      ...store.instruments,
      { ticker: "BHP", name: "BHP Group ADR", type: "STOCK", marketCode: "US", isProvisional: false },
      { ticker: "BHP", name: "BHP Group", type: "STOCK", marketCode: "AU", isProvisional: false },
    ]);
    store.accounting.projections.holdings.push(
      {
        accountId: "acc-us",
        ticker: "BHP",
        quantity: 4,
        costBasisAmount: 200,
        currency: "USD",
      },
      {
        accountId: "acc-au",
        ticker: "BHP",
        quantity: 3,
        costBasisAmount: 120,
        currency: "AUD",
      },
    );
    store.accounting.facts.tradeEvents.push(
      {
        id: "bhp-us-buy",
        userId: "user-1",
        accountId: "acc-us",
        ticker: "BHP",
        marketCode: "US",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 4,
        unitPrice: 50,
        priceCurrency: "USD",
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: usdFeeProfile,
      },
      {
        id: "bhp-au-buy",
        userId: "user-1",
        accountId: "acc-au",
        ticker: "BHP",
        marketCode: "AU",
        instrumentType: "STOCK",
        type: "BUY",
        quantity: 3,
        unitPrice: 40,
        priceCurrency: "AUD",
        tradeDate: "2026-02-02",
        commissionAmount: 0,
        taxAmount: 0,
        isDayTrade: false,
        feeSnapshot: audFeeProfile,
      },
    );

    return store;
  }

  function makeHoldingSnapshot(overrides: Partial<HoldingSnapshot>): HoldingSnapshot {
    return {
      id: overrides.id ?? "snapshot-1",
      userId: "user-1",
      accountId: "acc-au",
      ticker: "BHP",
      marketCode: "AU",
      snapshotDate: "2026-02-01",
      quantity: 3,
      closePrice: 45,
      marketValue: 135,
      costBasis: 120,
      unrealizedPnl: 15,
      cumulativeRealizedPnl: 0,
      cumulativeDividends: 0,
      isProvisional: false,
      currency: "AUD",
      valueNative: 135,
      costBasisNative: 120,
      unrealizedPnlNative: 15,
      providerSource: "test",
      generatedAt: "2026-02-01T00:00:00.000Z",
      generationRunId: "run-1",
      ...overrides,
    };
  }

  it("requires an explicit market for same ticker across multiple held markets", async () => {
    await expect(buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      fundamentalsRecord: null,
    })).rejects.toMatchObject({
      code: "ticker_market_required",
      statusCode: 400,
    });
  });

  it("uses requested account ids to infer the market for cross-listed tickers", async () => {
    const { details, marketCode } = await buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      accountIds: ["acc-au"],
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(marketCode).toBe("AU");
    expect(details.position.accountIds).toEqual(["acc-au"]);
    expect(details.position.quantity).toBe(3);
    expect(details.transactions).toEqual([
      expect.objectContaining({ id: "bhp-au-buy", accountId: "acc-au", marketCode: "AU" }),
    ]);
  });

  it("uses same-market account ids to infer a cross-listed ticker market without scoped rows", async () => {
    const store = buildCrossMarketStore();
    const secondAudFeeProfile = createDefaultFeeProfile("acc-au-2", "AUD", "fp-au-2");
    store.accounts.push({
      id: "acc-au-2",
      userId: "user-1",
      name: "Second AU Broker",
      feeProfileId: secondAudFeeProfile.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    store.feeProfiles.push(secondAudFeeProfile);
    store.accounting.projections.holdings = store.accounting.projections.holdings
      .filter((holding) => holding.ticker !== "BHP");
    store.accounting.facts.tradeEvents = store.accounting.facts.tradeEvents
      .filter((trade) => trade.ticker !== "BHP");

    const { details, marketCode } = await buildTickerDetails({
      persistence: createPersistence(),
      store,
      userId: "user-1",
      ticker: "BHP",
      accountIds: ["acc-au", "acc-au-2"],
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(marketCode).toBe("AU");
    expect(details.position.accountIds).toEqual(["acc-au", "acc-au-2"]);
    expect(details.position.quantity).toBe(0);
    expect(details.transactions).toEqual([]);
  });

  it("uses the requested marketCode for same ticker across multiple markets", async () => {
    const store = buildCrossMarketStore();
    store.marketData.dividendEvents.push(
      {
        id: "bhp-us-dividend",
        ticker: "BHP",
        marketCode: "US",
        eventType: "CASH",
        exDividendDate: "2026-04-01",
        paymentDate: null,
        cashDividendPerShare: 1,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-au-dividend",
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: "2026-04-01",
        paymentDate: null,
        cashDividendPerShare: 2,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-us-upcoming-dividend",
        ticker: "BHP",
        marketCode: "US",
        eventType: "CASH",
        exDividendDate: "2026-05-01",
        paymentDate: null,
        cashDividendPerShare: 1.5,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-au-upcoming-dividend",
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: "2026-05-01",
        paymentDate: null,
        cashDividendPerShare: 2.5,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-au-nearest-paid-upcoming-dividend",
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: "2026-07-10",
        paymentDate: "2026-07-20",
        cashDividendPerShare: 2.75,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
      {
        id: "bhp-au-paid-upcoming-dividend",
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: "2026-07-15",
        paymentDate: "2026-08-01",
        cashDividendPerShare: 3,
        cashDividendCurrency: "USD",
        stockDividendPerShare: 0,
        source: "test",
      },
    );
    store.accounting.facts.dividendLedgerEntries.push(
      {
        id: "bhp-us-posted-dividend",
        accountId: "acc-au",
        dividendEventId: "bhp-us-dividend",
        eligibleQuantity: 3,
        expectedCashAmount: 3,
        expectedStockQuantity: 0,
        receivedCashAmount: 3,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-04-10T00:00:00.000Z",
      },
      {
        id: "bhp-au-posted-dividend",
        accountId: "acc-au",
        dividendEventId: "bhp-au-dividend",
        eligibleQuantity: 3,
        expectedCashAmount: 6,
        expectedStockQuantity: 0,
        receivedCashAmount: 6,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-04-11T00:00:00.000Z",
      },
      {
        id: "bhp-au-adjusted-dividend",
        accountId: "acc-au",
        dividendEventId: "bhp-au-dividend",
        eligibleQuantity: 3,
        expectedCashAmount: 6,
        expectedStockQuantity: 0,
        receivedCashAmount: 5,
        receivedStockQuantity: 0,
        postingStatus: "adjusted",
        reconciliationStatus: "open",
        version: 2,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-04-12T00:00:00.000Z",
      },
    );
    store.accounting.facts.tradeEvents.push({
      id: "rio-au-unrelated-sell",
      userId: "user-1",
      accountId: "acc-au",
      ticker: "RIO",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "AUD",
      tradeDate: "2026-03-01",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles.find((profile) => profile.accountId === "acc-au")!,
    });

    const { details, marketCode } = await buildTickerDetails({
      persistence: createPersistence(),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      now: new Date("2026-07-19T00:00:00.000Z"),
      fundamentalsRecord: {
        ticker: "BHP",
        marketCode: "AU",
        providerId: "test-provider",
        fundamentals: createEmptyTickerFundamentals(),
        refreshedAt: "2026-06-01T00:00:00.000Z",
        nextRefreshAt: "2026-06-15T00:00:00.000Z",
        lastAttemptedAt: null,
        lastError: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(marketCode).toBe("AU");
    expect(details.identity).toEqual(expect.objectContaining({
      ticker: "BHP",
      marketCode: "AU",
      priceCurrency: "AUD",
    }));
    expect(details.position).toEqual(expect.objectContaining({
      quantity: 3,
      costBasisAmount: 120,
      currency: "AUD",
      accountIds: ["acc-au"],
    }));
    expect(details.transactions).toEqual([
      expect.objectContaining({
        accountId: "acc-au",
        marketCode: "AU",
        priceCurrency: "AUD",
      }),
    ]);
    expect(details.holdingGroup).toEqual(expect.objectContaining({
      instrumentName: "BHP AU",
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      instrumentName: "BHP AU",
    }));
    expect(details.dividends.upcoming).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountId: "acc-au",
        tickerName: "BHP Group",
        marketCode: "AU",
        currency: "USD",
        expectedAmount: 8,
        paymentDate: null,
      }),
      expect.objectContaining({
        accountId: "acc-au",
        tickerName: "BHP Group",
        marketCode: "AU",
        currency: "USD",
        expectedAmount: 9,
        paymentDate: "2026-08-01",
      }),
    ]));
    expect(details.dividends.upcoming.map((item) => item.paymentDate)).toEqual([
      null,
      "2026-07-20",
      "2026-08-01",
    ]);
    expect(details.dividends.upcomingCount).toBe(3);
    expect(details.dividends.nextPaymentDate).toBe("2026-07-20");
    expect(details.dividends.recent).toEqual([
      expect.objectContaining({
        accountId: "acc-au",
        tickerName: "BHP Group",
        marketCode: "AU",
        dividendLedgerEntryId: "bhp-au-adjusted-dividend",
        reconciliationStatus: "open",
        currency: "USD",
        grossAmount: 5,
      }),
      expect.objectContaining({
        accountId: "acc-au",
        tickerName: "BHP Group",
        marketCode: "AU",
        dividendLedgerEntryId: "bhp-au-posted-dividend",
        reconciliationStatus: "open",
        currency: "USD",
        grossAmount: 6,
      }),
    ]);
    expect(details.dividends.lastPostedDate).toBe("2026-04-12T00:00:00.000Z");
    expect(details.dividends.openReconciliationCount).toBe(2);
  });

  it("scopes ticker transactions and realized P&L to requested account ids", async () => {
    const store = buildCrossMarketStore();
    const secondAuFeeProfile = createDefaultFeeProfile("acc-au-2", "AUD", "fp-au-2");
    store.accounts.push({
      id: "acc-au-2",
      userId: "user-1",
      name: "Second AU Broker",
      feeProfileId: secondAuFeeProfile.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    store.feeProfiles.push(secondAuFeeProfile);
    store.accounting.projections.holdings.push({
      accountId: "acc-au-2",
      ticker: "BHP",
      quantity: 9,
      costBasisAmount: 360,
      currency: "AUD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "bhp-au-2-sell",
      userId: "user-1",
      accountId: "acc-au-2",
      ticker: "BHP",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "SELL",
      quantity: 1,
      unitPrice: 55,
      priceCurrency: "AUD",
      tradeDate: "2026-02-03",
      commissionAmount: 0,
      taxAmount: 0,
      realizedPnlAmount: 999,
      isDayTrade: false,
      feeSnapshot: secondAuFeeProfile,
    });

    const { details } = await buildTickerDetails({
      persistence: createPersistence(),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      accountIds: ["acc-au"],
      fundamentalsRecord: null,
    });

    expect(details.position.accountIds).toEqual(["acc-au"]);
    expect(details.position.quantity).toBe(3);
    expect(details.position.realizedPnlAmount).toBe(0);
    expect(details.transactions).toHaveLength(1);
    expect(details.transactions).toEqual([
      expect.objectContaining({ id: "bhp-au-buy", accountId: "acc-au" }),
    ]);
  });

  it("rejects requested account ids from a different market", async () => {
    await expect(buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      accountIds: ["acc-au", "acc-us"],
      fundamentalsRecord: null,
    })).rejects.toMatchObject({
      code: "account_market_mismatch",
      statusCode: 400,
    });
  });

  it("builds native-currency unrealized P&L history from actual holding snapshots", async () => {
    const store = buildCrossMarketStore();
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-01",
        open: 45,
        high: 45,
        low: 45,
        close: 45,
        volume: 1000,
        source: "test",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-02",
        open: 48,
        high: 48,
        low: 48,
        close: 48,
        volume: 1000,
        source: "test",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-03",
        open: 48,
        high: 48,
        low: 48,
        close: 48,
        volume: 1000,
        source: "test",
      },
    ];
    const holdingSnapshots = [
      makeHoldingSnapshot({ id: "bhp-au-2026-02-01", snapshotDate: "2026-02-01", unrealizedPnlNative: 15, quantity: 3 }),
      makeHoldingSnapshot({ id: "bhp-au-2026-02-02", snapshotDate: "2026-02-02", unrealizedPnlNative: 24, quantity: 3 }),
      makeHoldingSnapshot({
        id: "bhp-au-2026-02-03",
        snapshotDate: "2026-02-03",
        quantity: 0,
        marketValue: 0,
        valueNative: 0,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
      }),
    ];

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars, {}, new Map(), holdingSnapshots),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2026-02-01",
      endDate: "2026-02-03",
      fundamentalsRecord: {
        ticker: "BHP",
        marketCode: "AU",
        providerId: "test-provider",
        fundamentals: createEmptyTickerFundamentals(),
        refreshedAt: "2026-06-01T00:00:00.000Z",
        nextRefreshAt: "2026-06-15T00:00:00.000Z",
        lastAttemptedAt: null,
        lastError: null,
        createdAt: "2026-06-01T00:00:00.000Z",
        updatedAt: "2026-06-01T00:00:00.000Z",
      },
    });

    expect(details.unrealizedPnlHistory).toEqual([
      expect.objectContaining({
        date: "2026-02-01",
        unrealizedPnlAmount: 15,
        currency: "AUD",
        quantity: 3,
        closePrice: 45,
        averageCostPerShare: 40,
        accountIds: ["acc-au"],
      }),
      expect.objectContaining({
        date: "2026-02-02",
        unrealizedPnlAmount: 24,
        currency: "AUD",
        quantity: 3,
        accountIds: ["acc-au"],
      }),
      expect.objectContaining({
        date: "2026-02-03",
        unrealizedPnlAmount: 0,
        currency: "AUD",
        quantity: 0,
        accountIds: ["acc-au"],
      }),
    ]);
  });

  it("ignores zero-quantity null close prices when aggregating multi-account unrealized P&L history", async () => {
    const store = buildCrossMarketStore();
    const closedFeeProfile = createDefaultFeeProfile("acc-au-closed", "AUD", "fp-au-closed");
    store.accounts.push({
      id: "acc-au-closed",
      userId: "user-1",
      name: "Closed AU Broker",
      feeProfileId: closedFeeProfile.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    store.feeProfiles.push(closedFeeProfile);
    const holdingSnapshots = [
      makeHoldingSnapshot({
        id: "bhp-au-open-2026-02-02",
        accountId: "acc-au",
        snapshotDate: "2026-02-02",
        closePrice: 48,
        quantity: 3,
        costBasisNative: 120,
        marketValue: 144,
        valueNative: 144,
        unrealizedPnl: 24,
        unrealizedPnlNative: 24,
      }),
      makeHoldingSnapshot({
        id: "bhp-au-closed-2026-02-02",
        accountId: "acc-au-closed",
        snapshotDate: "2026-02-02",
        closePrice: null,
        quantity: 0,
        costBasis: 0,
        costBasisNative: 0,
        marketValue: 0,
        valueNative: 0,
        unrealizedPnl: null,
        unrealizedPnlNative: null,
      }),
    ];

    const { details } = await buildTickerDetails({
      persistence: createPersistence([], {}, new Map(), holdingSnapshots),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2026-02-02",
      endDate: "2026-02-02",
      fundamentalsRecord: null,
    });

    expect(details.unrealizedPnlHistory).toEqual([
      expect.objectContaining({
        date: "2026-02-02",
        unrealizedPnlAmount: 24,
        quantity: 3,
        closePrice: 48,
        averageCostPerShare: 40,
        accountIds: ["acc-au", "acc-au-closed"],
      }),
    ]);
  });

  it("excludes provisional snapshots from analysis-scoped unrealized P&L history", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-01",
        open: 45,
        high: 45,
        low: 45,
        close: 45,
        volume: 1000,
        source: "test",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-02",
        open: 48,
        high: 48,
        low: 48,
        close: 48,
        volume: 1000,
        source: "test",
      },
    ];
    const holdingSnapshots = [
      makeHoldingSnapshot({ id: "bhp-au-final", snapshotDate: "2026-02-01", unrealizedPnlNative: 15, quantity: 3 }),
      makeHoldingSnapshot({ id: "bhp-au-provisional", snapshotDate: "2026-02-02", unrealizedPnlNative: 24, quantity: 3, isProvisional: true }),
    ];

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars, {}, new Map(), holdingSnapshots),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2026-02-01",
      endDate: "2026-02-02",
      includeProvisional: false,
      fundamentalsRecord: null,
    });

    expect(details.unrealizedPnlHistory).toEqual([
      expect.objectContaining({
        date: "2026-02-01",
        unrealizedPnlAmount: 15,
        isProvisional: false,
      }),
    ]);
  });

  it("pages through all scoped unrealized P&L history snapshots", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-01",
        open: 45,
        high: 45,
        low: 45,
        close: 45,
        volume: 1000,
        source: "test",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-02-02",
        open: 48,
        high: 48,
        low: 48,
        close: 48,
        volume: 1000,
        source: "test",
      },
    ];
    const holdingSnapshots = Array.from({ length: 10_001 }, (_, index) => makeHoldingSnapshot({
      id: `bhp-au-page-${index}`,
      snapshotDate: index === 10_000 ? "2026-02-02" : "2026-02-01",
      unrealizedPnlNative: index === 10_000 ? 7 : 1,
      unrealizedPnl: index === 10_000 ? 7 : 1,
      quantity: 1,
      marketValue: index === 10_000 ? 47 : 41,
      valueNative: index === 10_000 ? 47 : 41,
    }));

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars, {}, new Map(), holdingSnapshots),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2026-02-01",
      endDate: "2026-02-02",
      fundamentalsRecord: null,
    });

    expect(details.unrealizedPnlHistory).toEqual([
      expect.objectContaining({
        date: "2026-02-01",
        unrealizedPnlAmount: 10_000,
        quantity: 10_000,
      }),
      expect.objectContaining({
        date: "2026-02-02",
        unrealizedPnlAmount: 7,
        quantity: 1,
      }),
    ]);
  });

  it("returns empty unrealized P&L history when the resolved market has no account scope", async () => {
    const store = buildCrossMarketStore();
    const bars = [
      {
        ticker: "BHP",
        marketCode: "KR" as const,
        barDate: "2026-02-01",
        open: 45,
        high: 45,
        low: 45,
        close: 45,
        volume: 1000,
        source: "test",
      },
    ];
    const holdingSnapshots = [
      makeHoldingSnapshot({ id: "bhp-au-2026-02-01", snapshotDate: "2026-02-01", unrealizedPnlNative: 15, quantity: 3 }),
    ];

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars, {}, new Map(), holdingSnapshots),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "KR",
      startDate: "2026-02-01",
      endDate: "2026-02-01",
      fundamentalsRecord: null,
    });

    expect(details.position.accountIds).toEqual([]);
    expect(details.unrealizedPnlHistory).toEqual([]);
  });

  it("keeps missing ticker quote state open during an open regular session", async () => {
    const { details } = await buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "US",
      loadChart: false,
      fundamentalsRecord: null,
      getSettledTradingDay: async () => "2026-06-16",
      tradingCalendar: { isTradingDay: async () => true },
      now: new Date("2026-06-17T14:00:00.000Z"),
    });

    expect(details.quote.quoteStatus).toBe("missing");
    expect(details.quote.priceState).toEqual(expect.objectContaining({
      basis: "missing",
      chipState: "missing",
      marketState: "open",
      marketTimeZone: "America/New_York",
    }));
  });

  it("uses requested chart ranges while keeping the quote pinned to the latest local bar", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-01-15",
        open: 30,
        high: 31,
        low: 29,
        close: 30,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-07-15",
        open: 35,
        high: 36,
        low: 34,
        close: 35,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-01",
        open: 42,
        high: 43,
        low: 41,
        close: 42,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-10",
        open: 45,
        high: 46,
        low: 44,
        close: 45,
        volume: 100,
        source: "test-bars",
      },
    ];

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      range: "1M",
      fundamentalsRecord: null,
    });

    expect(details.quote).toEqual(expect.objectContaining({
      currentUnitPrice: 45,
      previousClose: 42,
    }));
    expect(details.chart).toEqual(expect.objectContaining({
      range: "1M",
      metadata: {
        requested: { range: "1M", startDate: null, endDate: null },
        resolved: { range: "1M", startDate: "2026-05-10", endDate: "2026-06-10" },
        available: { startDate: "2025-01-15", endDate: "2026-06-10" },
        truncated: { startDate: false, endDate: false },
      },
    }));
    expect(details.chart.points.map((point) => point.date)).toEqual(["2026-06-01", "2026-06-10"]);
  });

  it("uses the bounded latest-bar reader when chart data is not requested", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-01-15",
        open: 30,
        high: 31,
        low: 29,
        close: 30,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-01",
        open: 42,
        high: 43,
        low: 41,
        close: 42,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-10",
        open: 45,
        high: 46,
        low: 44,
        close: 45,
        volume: 100,
        source: "test-bars",
      },
    ];
    const calls = {
      historicalReads: [] as Array<{ ticker: string; marketCode: string; startDate: string; endDate: string }>,
      latestReads: [] as Array<{ pairs: ReadonlyArray<{ ticker: string; marketCode: "TW" | "US" | "AU" | "KR" }>; limit: number }>,
    };

    const { details } = await buildTickerDetails({
      persistence: createPersistence(bars, calls),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(calls.historicalReads).toEqual([]);
    expect(calls.latestReads).toEqual([
      { pairs: [{ ticker: "BHP", marketCode: "AU" }], limit: 2 },
      { pairs: [{ ticker: "BHP", marketCode: "AU" }], limit: 1 },
    ]);
    expect(details.quote).toEqual(expect.objectContaining({
      currentUnitPrice: 45,
      previousClose: 42,
    }));
    expect(details.chart.points).toEqual([]);
  });

  it("returns all locally stored bars for ALL and marks custom-range truncation against local history", async () => {
    const bars = [
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2025-01-15",
        open: 30,
        high: 31,
        low: 29,
        close: 30,
        volume: 100,
        source: "test-bars",
      },
      {
        ticker: "BHP",
        marketCode: "AU" as const,
        barDate: "2026-06-10",
        open: 45,
        high: 46,
        low: 44,
        close: 45,
        volume: 100,
        source: "test-bars",
      },
    ];

    const { details: allDetails } = await buildTickerDetails({
      persistence: createPersistence(bars),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      range: "ALL",
      fundamentalsRecord: null,
    });

    expect(allDetails.chart.metadata).toEqual({
      requested: { range: "ALL", startDate: null, endDate: null },
      resolved: { range: "ALL", startDate: "2025-01-15", endDate: "2026-06-10" },
      available: { startDate: "2025-01-15", endDate: "2026-06-10" },
      truncated: { startDate: false, endDate: false },
    });
    expect(allDetails.chart.points).toHaveLength(2);

    const { details: customDetails } = await buildTickerDetails({
      persistence: createPersistence(bars),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2024-01-01",
      endDate: "2026-12-31",
      fundamentalsRecord: null,
    });

    expect(customDetails.chart.range).toBe("CUSTOM");
    expect(customDetails.chart.metadata.truncated).toEqual({
      startDate: true,
      endDate: true,
    });
  });

  it("rejects custom chart ranges longer than 10 years", async () => {
    await expect(buildTickerDetails({
      persistence: createPersistence(),
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      startDate: "2010-01-01",
      endDate: "2021-01-02",
      fundamentalsRecord: null,
    })).rejects.toMatchObject({
      code: "ticker_chart_custom_range_too_large",
      statusCode: 400,
    });
  });

  it("keeps reporting ticker values unavailable when the requested reporting FX is missing", async () => {
    const persistence = {
      ...createPersistence([
        {
          ticker: "BHP",
          marketCode: "AU" as const,
          barDate: "2026-06-10",
          open: 45,
          high: 46,
          low: 44,
          close: 45,
          volume: 100,
          source: "test-bars",
        },
      ]),
      async getFxRate() {
        return null;
      },
    };

    const { details } = await buildTickerDetails({
      persistence,
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "TWD",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(details.position).toEqual(expect.objectContaining({
      marketValueAmount: 135,
      unrealizedPnlAmount: 15,
      currency: "AUD",
    }));
    expect(details.holdingGroup).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      fxStatus: "missing",
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      reportingUnrealizedPnlAmount: null,
      reportingDailyChangeAmount: null,
      fxStatus: "missing",
    }));
  });

  it("keeps missing-quote allocation reason when reporting FX is also missing", async () => {
    const persistence = {
      ...createPersistence(),
      async getFxRate() {
        return null;
      },
    };

    const { details } = await buildTickerDetails({
      persistence,
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "TWD",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(details.holdingGroup).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      fxStatus: "missing",
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: "missing_quote",
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      reportingCurrency: "TWD",
      reportingCostBasisAmount: null,
      reportingMarketValueAmount: null,
      fxStatus: "missing",
      allocationBasisUsed: "cost_basis",
      allocationBasisFallbackReason: "missing_quote",
    }));
  });

  it("computes market-scoped allocation percentages for ticker group and account rows", async () => {
    const store = buildCrossMarketStore();
    const audFeeProfileTwo = createDefaultFeeProfile("acc-au-2", "AUD", "fp-au-2");
    store.accounts.push({
      id: "acc-au-2",
      userId: "user-1",
      name: "Second AU Broker",
      feeProfileId: audFeeProfileTwo.id,
      defaultCurrency: "AUD",
      accountType: "broker",
    });
    store.feeProfiles.push(audFeeProfileTwo);
    setStoreInstruments(store, [
      ...store.instruments,
      { ticker: "CBA", type: "STOCK", marketCode: "AU", isProvisional: false },
    ]);
    store.accounting.projections.holdings.push({
      accountId: "acc-au-2",
      ticker: "CBA",
      quantity: 4,
      costBasisAmount: 280,
      currency: "AUD",
    });
    store.accounting.facts.tradeEvents.push({
      id: "cba-au-buy",
      userId: "user-1",
      accountId: "acc-au-2",
      ticker: "CBA",
      marketCode: "AU",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 4,
      unitPrice: 70,
      priceCurrency: "AUD",
      tradeDate: "2026-02-03",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: audFeeProfileTwo,
    });

    const { details } = await buildTickerDetails({
      persistence: createPersistence([
        { ticker: "BHP", marketCode: "AU", barDate: "2026-06-17", open: 44, high: 46, low: 43, close: 45, volume: 100, source: "daily" },
        { ticker: "BHP", marketCode: "AU", barDate: "2026-06-16", open: 42, high: 45, low: 41, close: 44, volume: 100, source: "daily" },
        { ticker: "CBA", marketCode: "AU", barDate: "2026-06-17", open: 69, high: 71, low: 68, close: 70, volume: 100, source: "daily" },
      ]),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      accountId: "acc-au",
      reportingCurrency: "AUD",
      loadChart: false,
      fundamentalsRecord: null,
    });

    expect(details.holdingGroup).toEqual(expect.objectContaining({
      reportingAllocationPercent: 100,
      reportingMarketAllocationPercent: 32.5301,
    }));
    expect(details.accountBreakdown[0]).toEqual(expect.objectContaining({
      accountId: "acc-au",
      reportingAllocationPercent: 100,
      reportingMarketAllocationPercent: 32.5301,
    }));
  });

  it("uses same-day intraday overlay as pending today close on ticker details after the official session closes", async () => {
    const overlays = new Map<string, IntradayPriceOverlay>([[
      "BHP:AU",
      {
        ticker: "BHP",
        marketCode: "AU",
        price: 48,
        previousClose: 45,
        asOfDate: "2026-06-18",
        asOfTimestamp: "2026-06-18T01:25:00.000Z",
        observedAt: "2026-06-18T01:26:00.000Z",
        sourceKind: "intraday_yahoo_chart",
        source: "yahoo-finance-chart",
        currency: "AUD",
      },
    ]]);
    const persistence = createPersistence([
      { ticker: "BHP", marketCode: "AU", barDate: "2026-06-17", open: 44, high: 46, low: 43, close: 45, volume: 100, source: "daily" },
      { ticker: "BHP", marketCode: "AU", barDate: "2026-06-16", open: 42, high: 45, low: 41, close: 44, volume: 100, source: "daily" },
    ], {}, overlays);

    const { details } = await buildTickerDetails({
      persistence,
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "AUD",
      loadChart: false,
      fundamentalsRecord: null,
      getSettledTradingDay: async () => "2026-06-17",
      tradingCalendar: {
        isTradingDay: async (_market, date) => date === "2026-06-17",
        getTradingDates: async () => new Set(["2026-06-17"]),
      },
      now: new Date("2026-06-18T01:30:00.000Z"),
    });

    expect(details.quote.currentUnitPrice).toBe(48);
    expect(details.quote.priceState).toEqual(expect.objectContaining({
      basis: "pending_today_close",
      chipState: "closed_pending",
      marketState: "closed",
      marketStateReason: "market_closed",
      sourceKind: "intraday_yahoo_chart",
    }));
  });

  it("keeps same-day Yahoo close-only bars closed on ticker details", async () => {
    const persistence = createPersistence([
      { ticker: "BHP", marketCode: "AU", barDate: "2026-06-18", open: 48, high: 48, low: 48, close: 48, volume: 0, source: "yahoo-chart-close", quality: "close_only" },
      { ticker: "BHP", marketCode: "AU", barDate: "2026-06-17", open: 44, high: 46, low: 43, close: 45, volume: 100, source: "daily" },
    ]);

    const { details } = await buildTickerDetails({
      persistence,
      store: buildCrossMarketStore(),
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "AUD",
      loadChart: false,
      fundamentalsRecord: null,
      getSettledTradingDay: async () => "2026-06-18",
      tradingCalendar: {
        isTradingDay: async (_market, date) => date === "2026-06-17" || date === "2026-06-18",
        getTradingDates: async () => new Set(["2026-06-17", "2026-06-18"]),
      },
      now: new Date("2026-06-18T06:30:00.000Z"),
    });

    expect(details.quote.currentUnitPrice).toBe(48);
    expect(details.quote.priceState).toEqual(expect.objectContaining({
      basis: "today_close",
      chipState: "closed",
      marketState: "closed",
      sourceKind: "yahoo_chart_close",
      sourceId: "yahoo-chart-close",
      quality: "close_only",
    }));
  });

  it("builds account dividend dates from rows beyond the 50-item previews", async () => {
    const store = buildCrossMarketStore();
    const feeProfile = createDefaultFeeProfile("acc-au-2", "AUD", "fp-au-2");
    store.accounts.push({
      id: "acc-au-2", userId: "user-1", name: "Second AU Broker",
      feeProfileId: feeProfile.id, defaultCurrency: "AUD", accountType: "broker",
    });
    store.feeProfiles.push(feeProfile);
    store.accounting.projections.holdings.push({
      accountId: "acc-au-2", ticker: "BHP", quantity: 1, costBasisAmount: 40, currency: "AUD",
    });

    const addDividend = (input: {
      id: string;
      accountId: string;
      paymentDate: string;
      bookedAt?: string;
    }) => {
      store.marketData.dividendEvents.push({
        id: input.id,
        ticker: "BHP",
        marketCode: "AU",
        eventType: "CASH",
        exDividendDate: input.paymentDate < "2026-07-12" ? "2026-02-01" : "2026-07-20",
        paymentDate: input.paymentDate,
        cashDividendPerShare: 1,
        cashDividendCurrency: "AUD",
        stockDividendPerShare: 0,
        source: "test",
      });
      store.accounting.facts.dividendLedgerEntries.push({
        id: `${input.id}-ledger`,
        accountId: input.accountId,
        dividendEventId: input.id,
        eligibleQuantity: 1,
        expectedCashAmount: 1,
        expectedStockQuantity: 0,
        receivedCashAmount: input.bookedAt ? 1 : 0,
        receivedStockQuantity: 0,
        postingStatus: input.bookedAt ? "posted" : "expected",
        reconciliationStatus: input.bookedAt ? "matched" : "open",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: input.bookedAt,
      });
    };

    for (let index = 0; index < 50; index += 1) {
      addDividend({ id: `bulk-upcoming-${index}`, accountId: "acc-au", paymentDate: "2026-08-01" });
      addDividend({
        id: `bulk-posted-${index}`,
        accountId: "acc-au",
        paymentDate: "2026-05-01",
        bookedAt: "2026-05-02T00:00:00.000Z",
      });
    }
    addDividend({ id: "second-upcoming", accountId: "acc-au-2", paymentDate: "2026-09-01" });
    addDividend({
      id: "second-posted",
      accountId: "acc-au-2",
      paymentDate: "2026-03-01",
      bookedAt: "2026-03-02T00:00:00.000Z",
    });

    const { details } = await buildTickerDetails({
      persistence: createPersistence(),
      store,
      userId: "user-1",
      ticker: "BHP",
      marketCode: "AU",
      reportingCurrency: "AUD",
      loadChart: false,
      fundamentalsRecord: null,
      now: new Date("2026-06-18T06:30:00.000Z"),
    });

    expect(details.dividends.upcoming).toHaveLength(50);
    expect(details.dividends.recent).toHaveLength(50);
    expect(details.accountBreakdown.find((row) => row.accountId === "acc-au-2")).toEqual(expect.objectContaining({
      nextDividendDate: "2026-09-01",
      lastDividendPostedDate: "2026-03-02T00:00:00.000Z",
    }));
  });
});
