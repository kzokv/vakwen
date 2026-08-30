import { Buffer } from "node:buffer";
import { describe, expect, it, vi } from "vitest";
import { createDividendEvent } from "../../src/services/dividends.js";
import { appendOfficialListingStatusRevision, canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";
import { getPriceSeries, getResearchManifest } from "../../src/services/research/service.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";

function companyListing(overrides: Partial<{
  venue: "TWSE" | "TPEX";
  ticker: string;
  listedAt: string;
  displayName: string;
  unifiedBusinessNumber: string;
}> = {}) {
  return canonicalizeOfficialIdentityRow({
    venue: overrides.venue ?? "TWSE",
    snapshotDate: "2026-08-27",
    retrievedAt: "2026-08-27T02:00:00.000Z",
    artifact: {
      contentHash: `sha256:${overrides.ticker ?? "2330"}`,
      sourceUrl: overrides.venue === "TPEX"
        ? "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O"
        : "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    },
    row: {
      kind: "company",
      ticker: overrides.ticker ?? "2330",
      legalName: "台灣測試股份有限公司",
      displayName: overrides.displayName ?? "測試公司",
      unifiedBusinessNumber: overrides.unifiedBusinessNumber ?? "22099131",
      industryCode: "24",
      listedAt: overrides.listedAt ?? "1994-09-05",
    },
  });
}

function etnListing() {
  return canonicalizeOfficialIdentityRow({
    venue: "TWSE",
    snapshotDate: "2026-08-27",
    retrievedAt: "2026-08-27T03:00:00.000Z",
    artifact: {
      contentHash: "sha256:etn",
      sourceUrl: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json",
    },
    row: {
      kind: "etn",
      ticker: "020032",
      legalName: "Yuanta Securities Co., Ltd.",
      displayName: "Yuanta Green Energy ETN",
      identityKey: "twse-etn:020032:2024-02-01",
      issuerIdentityKey: "97160609",
      noteType: "ETN",
      listedAt: "2024-02-01",
    },
  });
}

function priceRecord(input: {
  listingId: string;
  ticker: string;
  venue: "TWSE" | "TPEX";
  sessionDate: string;
  state: "full_bar" | "close_only" | "no_trade" | "suspended";
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  tradedValue?: string;
  tradeCount?: string;
  note?: string;
  retrievedAt?: string;
  contentHash?: string;
}) {
  return canonicalizeOfficialPriceRow({
    listingId: input.listingId,
    ticker: input.ticker,
    venue: input.venue,
    sessionDate: input.sessionDate,
    retrievedAt: input.retrievedAt ?? `${input.sessionDate}T10:00:00.000Z`,
    artifact: {
      contentHash: input.contentHash ?? `sha256:${input.sessionDate}:${input.state}`,
      sourceUrl: input.venue === "TPEX"
        ? "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes"
        : "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
      publisherDataset: input.venue === "TPEX" ? "daily_quotes" : "STOCK_DAY_ALL",
      accessProvider: input.venue === "TPEX" ? "TPEX_OPENAPI" : "TWSE_OPENAPI",
    },
    row: {
      state: input.state,
      open: input.open,
      high: input.high,
      low: input.low,
      close: input.close,
      volume: input.volume,
      tradedValue: input.tradedValue,
      tradeCount: input.tradeCount,
      note: input.note,
    },
  });
}

async function seedDividendEvent(persistence: MemoryPersistence) {
  const store = await persistence.loadStore("user-1");
  createDividendEvent(store, {
    id: "qa-dividend-1",
    ticker: "2330",
    marketCode: "TW",
    eventType: "CASH_AND_STOCK",
    exDividendDate: "2026-08-27",
    paymentDate: "2026-09-10",
    cashDividendPerShare: 5,
    cashDividendCurrency: "TWD",
    stockDividendPerShare: 1,
    stockDistributionRatio: 0.1,
    stockDistributionRatioState: "authoritative",
    source: "qa",
  });
  await persistence.saveStore(store);
}

function weekdayDates(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function installAuthoritativeCalendarCoverage(persistence: MemoryPersistence): void {
  vi.spyOn(persistence, "getActiveMarketCalendarVersion").mockImplementation(async (marketCode, calendarYear) =>
    calendarYear === 2026
      ? {
          versionId: "calendar-tw-2026",
          importOperationId: "calendar-import-tw-2026",
          marketCode,
          calendarYear,
          sourceId: null,
          sourceLabel: "TW official calendar",
          sourceType: "official_source" as const,
          sourceUrl: "https://example.test/tw-calendar-2026",
          retrievedAt: "2025-12-01T00:00:00.000Z",
          coverage: { scope: "full_year" as const, evidence: "test fixture" },
          confirmedAt: "2025-12-01T00:00:00.000Z",
          invalidatedAt: null,
          invalidationReason: null,
          status: "confirmed" as const,
          isActive: true,
          annualCounts: {
            tradingDayCount: 261,
            nonTradingDayCount: 104,
            weekdayClosedCount: 0,
            weekendOpenCount: 0,
          },
          exceptions: [],
          createdAt: "2025-12-01T00:00:00.000Z",
          updatedAt: "2025-12-01T00:00:00.000Z",
        }
      : null
  );
}

describe("research price store QA", () => {
  it("store-only read: preserve scope/order/metrics lineage and avoid write-side effects", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-25",
        state: "full_bar",
        open: "100",
        high: "101",
        low: "99",
        close: "100",
        volume: "10",
        tradedValue: "1001",
        tradeCount: "2",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        state: "full_bar",
        open: "110",
        high: "112",
        low: "108",
        close: "110",
        volume: "20",
        tradedValue: "2203",
        tradeCount: "3",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        state: "full_bar",
        open: "121",
        high: "123",
        low: "120",
        close: "121",
        volume: "30",
        tradedValue: "3635",
        tradeCount: "4",
      }),
    ]);
    await seedDividendEvent(persistence);

    const appendIdentitySpy = vi.spyOn(persistence, "appendResearchIdentityRecords");
    const appendPriceSpy = vi.spyOn(persistence, "appendResearchPriceRecords");
    const saveStoreSpy = vi.spyOn(persistence, "saveStore");
    const loadStoreSpy = vi.spyOn(persistence, "loadStore");
    const legacyDividendSpy = vi.spyOn(persistence, "listDividendEventsForTickerMarket");

    const manifest = await getResearchManifest(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
    });
    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 3 },
      basis: "raw",
      order: "asc",
      page: { limit: 3 },
      metrics: [
        { id: "simple_price_return", windowSessions: 3 },
        { id: "total_shareholder_return", windowSessions: 3 },
        { id: "annualized_realized_volatility", windowSessions: 3 },
        { id: "maximum_drawdown", windowSessions: 3 },
        { id: "average_daily_volume", windowSessions: 3 },
        { id: "average_daily_traded_value", windowSessions: 3 },
      ],
    });

    expect(manifest.datasets[1]).toEqual({
      id: "price_series",
      status: "available",
      capabilities: {
        scopeKinds: ["latest", "latest_sessions", "date_range"],
        basis: ["raw", "corporate_action_adjusted"],
        metrics: [
          "simple_price_return",
          "total_shareholder_return",
          "annualized_realized_volatility",
          "maximum_drawdown",
          "average_daily_volume",
          "average_daily_traded_value",
        ],
        pageDefault: 60,
        pageMax: 260,
        maxWindowSessions: 1260,
        maxSpanYears: 5,
      },
    });
    expect(result.order).toBe("asc");
    expect(result.basisPolicy.status).toBe("raw");
    expect(result.page).toEqual({
      limit: 3,
      nextCursor: null,
      recordCount: 3,
      truncatedByBudget: false,
    });
    expect(result.sessions.map((session) => session.sessionDate)).toEqual([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ]);
    expect(result.metrics).toMatchObject([
      {
        status: "returned",
        id: "simple_price_return",
        formulaId: "simple_price_return",
        formulaVersion: "1.0.0",
        observationInputs: ["2026-08-25", "2026-08-26", "2026-08-27"],
      },
      {
        status: "withheld",
        id: "total_shareholder_return",
        reasonCode: "corporate_action_incomplete",
      },
      {
        status: "returned",
        id: "annualized_realized_volatility",
        formulaId: "annualized_realized_volatility",
        formulaVersion: "1.0.0",
        parameters: { tradingDaysPerYear: 252 },
      },
      {
        status: "returned",
        id: "maximum_drawdown",
        formulaId: "maximum_drawdown",
        formulaVersion: "1.0.0",
      },
      {
        status: "returned",
        id: "average_daily_volume",
        formulaId: "average_daily_volume",
        formulaVersion: "1.0.0",
        value: 20,
      },
      {
        status: "returned",
        id: "average_daily_traded_value",
        formulaId: "average_daily_traded_value",
        formulaVersion: "1.0.0",
        value: (1001 + 2203 + 3635) / 3,
      },
    ]);
    expect(legacyDividendSpy).not.toHaveBeenCalled();
    expect(appendIdentitySpy).not.toHaveBeenCalled();
    expect(appendPriceSpy).not.toHaveBeenCalled();
    expect(saveStoreSpy).not.toHaveBeenCalled();
    expect(loadStoreSpy).not.toHaveBeenCalled();
  });

  it("explicit states and historical cutoff: surface close-only, no-trade, suspended, missing, stale, and inactive history", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const listing = companyListing({ ticker: "5274", venue: "TPEX", listedAt: "2013-04-30", unifiedBusinessNumber: "27490748" });
    const inactive = appendOfficialListingStatusRevision(listing, {
      status: "inactive",
      effectiveDate: "2026-08-28",
      retrievedAt: "2026-08-29T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:inactive",
        sourceUrl: "https://www.tpex.org.tw/openapi/v1/termination",
        publisherDataset: "termination",
      },
    });
    await persistence.appendResearchIdentityRecords([listing, inactive]);
    await persistence.appendResearchPriceRecords([
      priceRecord({
        listingId: listing.listing.id,
        ticker: "5274",
        venue: "TPEX",
        sessionDate: "2026-08-25",
        state: "close_only",
        close: "2500",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "5274",
        venue: "TPEX",
        sessionDate: "2026-08-26",
        state: "no_trade",
        close: "2500",
        volume: "0",
        tradedValue: "0",
        tradeCount: "0",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "5274",
        venue: "TPEX",
        sessionDate: "2026-08-27",
        state: "suspended",
        note: "Exchange suspension",
      }),
    ]);

    const historical = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T13:00:00.000Z",
        effectiveAt: "2026-08-28T13:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 3 },
      page: { limit: 4 },
      basis: "raw",
      order: "asc",
      metrics: [{ id: "average_daily_volume", windowSessions: 4 }],
    });
    const historicalWithCloseOnly = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T13:00:00.000Z",
        effectiveAt: "2026-08-28T13:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 4 },
      basis: "raw",
      order: "asc",
      page: { limit: 4 },
      metrics: [{ id: "average_daily_volume", windowSessions: 4 }],
    });
    const inactiveLatest = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-29T15:00:00.000Z",
        effectiveAt: "2026-08-29T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });

    expect(historical.freshness).toEqual({ state: "due_pending", authoritativeAsOf: "2026-08-28" });
    expect(historical.sessions).toMatchObject([
      { state: "no_trade", sessionDate: "2026-08-26", prices: { close: 2500, volume: 0, tradedValue: 0, tradeCount: 0 } },
      { state: "suspended", sessionDate: "2026-08-27", reasonCode: "official_trading_suspension", note: "Exchange suspension" },
      { state: "missing", sessionDate: "2026-08-28", reasonCode: "missing_authoritative_price" },
    ]);
    expect(historicalWithCloseOnly.sessions).toMatchObject([
      { state: "settled_close_only", sessionDate: "2026-08-25", prices: { close: 2500 } },
      { state: "no_trade", sessionDate: "2026-08-26", prices: { close: 2500, volume: 0, tradedValue: 0, tradeCount: 0 } },
      { state: "suspended", sessionDate: "2026-08-27", reasonCode: "official_trading_suspension", note: "Exchange suspension" },
      { state: "missing", sessionDate: "2026-08-28", reasonCode: "missing_authoritative_price" },
    ]);
    expect(historicalWithCloseOnly.metrics).toEqual([{
      status: "withheld",
      id: "average_daily_volume",
      windowSessions: 4,
      reasonCode: "close_only_series",
    }]);
    expect(inactiveLatest.sessions).toEqual([{
      state: "missing",
      sessionDate: "2026-08-28",
      reasonCode: "listing_inactive",
    }]);
  });

  it("date-range pagination: bind cursor to scope, metrics, order, limit, and 24h TTL", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ].map((sessionDate, index) => priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate,
      state: "full_bar",
      open: `${100 + index}`,
      high: `${101 + index}`,
      low: `${99 + index}`,
      close: `${100 + index}`,
      volume: `${1000 + index}`,
      tradedValue: `${100000 + index}`,
      tradeCount: `${10 + index}`,
      retrievedAt: `${sessionDate}T10:00:00.000Z`,
    })));

    const firstPage = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "date_range", startDate: "2026-08-25", endDate: "2026-08-27" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [{ id: "simple_price_return", windowSessions: 3 }],
    });
    const cursor = firstPage.page.nextCursor!;
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { issuedAt: string };

    const secondPage = await getPriceSeries(persistence, {
      subject: firstPage.selector,
      context: firstPage.context,
      scope: { kind: "date_range", startDate: "2026-08-25", endDate: "2026-08-27" },
      basis: "raw",
      order: "desc",
      page: { limit: 1, cursor },
      metrics: [{ id: "simple_price_return", windowSessions: 3 }],
    });

    expect(secondPage.sessions).toMatchObject([{ sessionDate: "2026-08-26" }]);

    await expect(getPriceSeries(persistence, {
      subject: firstPage.selector,
      context: firstPage.context,
      scope: { kind: "date_range", startDate: "2026-08-25", endDate: "2026-08-27" },
      basis: "raw",
      order: "asc",
      page: { limit: 1, cursor },
      metrics: [{ id: "simple_price_return", windowSessions: 3 }],
    })).rejects.toMatchObject({ code: "research_cursor_invalid" });

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(Date.parse(decoded.issuedAt) + (24 * 60 * 60 * 1000) + 1);
    await expect(getPriceSeries(persistence, {
      subject: firstPage.selector,
      context: firstPage.context,
      scope: { kind: "date_range", startDate: "2026-08-25", endDate: "2026-08-27" },
      basis: "raw",
      order: "desc",
      page: { limit: 1, cursor },
      metrics: [{ id: "simple_price_return", windowSessions: 3 }],
    })).rejects.toMatchObject({ code: "research_cursor_invalid" });
    nowSpy.mockRestore();
  });

  it("future date-range requests: clamp to the authoritative cutoff instead of emitting future missing sessions", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "full_bar",
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: "1000",
      tradedValue: "100123",
      tradeCount: "10",
    })]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "date_range", startDate: "2026-08-27", endDate: "2026-09-30" },
      basis: "raw",
      order: "asc",
      page: { limit: 60 },
      metrics: [],
    });

    expect(result.freshness).toEqual({ state: "current", authoritativeAsOf: "2026-08-27" });
    expect(result.sessions).toMatchObject([{ sessionDate: "2026-08-27", state: "settled_full_bar" }]);
  });

  it("missing calendar coverage: return only proven exchange sessions and never fabricate weekday gaps", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "full_bar",
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: "1000",
      tradedValue: "100123",
      tradeCount: "10",
    })]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "date_range", startDate: "2026-08-27", endDate: "2026-08-28" },
      basis: "raw",
      order: "asc",
      page: { limit: 60 },
      metrics: [],
    });

    expect(result.freshness).toEqual({ state: "not_applicable", authoritativeAsOf: null });
    expect(result.sessions).toMatchObject([{ sessionDate: "2026-08-27", state: "settled_full_bar" }]);
    expect(result.sessions.some((session) => session.sessionDate === "2026-08-28")).toBe(false);
  });

  it("historical effectiveAt: freeze sessions to the effective timeline even when knowledgeAt is later", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        state: "full_bar",
        open: "99",
        high: "100",
        low: "98",
        close: "99",
        volume: "900",
        tradedValue: "89100",
        tradeCount: "9",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        state: "full_bar",
        open: "100",
        high: "101",
        low: "99",
        close: "100",
        volume: "1000",
        tradedValue: "100000",
        tradeCount: "10",
      }),
    ]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-30T15:00:00.000Z",
        effectiveAt: "2026-08-27T08:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });
    const historicalRange = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-30T15:00:00.000Z",
        effectiveAt: "2026-08-27T08:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "date_range", startDate: "2026-08-20", endDate: "2026-08-30" },
      basis: "raw",
      order: "asc",
      page: { limit: 10 },
      metrics: [],
    });

    expect(result.context.effectiveAt).toBe("2026-08-27T08:00:00.000Z");
    expect(result.freshness).toEqual({ state: "not_applicable", authoritativeAsOf: "2026-08-28" });
    expect(result.sessions).toMatchObject([{ sessionDate: "2026-08-26", state: "settled_full_bar" }]);
    expect(historicalRange.freshness).toEqual({ state: "not_applicable", authoritativeAsOf: "2026-08-28" });
    expect(historicalRange.sessions.at(-1)).toMatchObject({ sessionDate: "2026-08-26", state: "settled_full_bar" });
  });

  it("metric lineage: withhold volume and traded-value metrics when canonical no-trade facts are missing", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        state: "full_bar",
        open: "100",
        high: "101",
        low: "99",
        close: "100",
        volume: "1000",
        tradedValue: "100000",
        tradeCount: "10",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        state: "no_trade",
        close: "100",
      }),
    ]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "asc",
      page: { limit: 2 },
      metrics: [
        { id: "average_daily_volume", windowSessions: 2 },
        { id: "average_daily_traded_value", windowSessions: 2 },
      ],
    });

    expect(result.metrics).toEqual([
      {
        status: "withheld",
        id: "average_daily_volume",
        windowSessions: 2,
        reasonCode: "insufficient_basis_history",
      },
      {
        status: "withheld",
        id: "average_daily_traded_value",
        windowSessions: 2,
        reasonCode: "insufficient_basis_history",
      },
    ]);
  });

  it("metric windows: withhold a requested window larger than the selected scope", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      "2026-08-25",
      "2026-08-26",
      "2026-08-27",
    ].map((sessionDate, index) => priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate,
      state: "full_bar",
      open: `${100 + index}`,
      high: `${102 + index}`,
      low: `${99 + index}`,
      close: `${101 + index}`,
      volume: `${1000 + index}`,
      tradedValue: `${100000 + index}`,
      tradeCount: `${10 + index}`,
    })));

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 3 },
      basis: "raw",
      order: "asc",
      page: { limit: 3 },
      metrics: [{ id: "simple_price_return", windowSessions: 252 }],
    });

    expect(result.metrics).toEqual([{
      status: "withheld",
      id: "simple_price_return",
      windowSessions: 252,
      reasonCode: "insufficient_basis_history",
    }]);
  });

  it("metric lineage: bounds five-year evidence independently from session pagination", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    const dates = weekdayDates("2021-09-01", "2026-08-27");
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords(dates.map((sessionDate, index) => priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate,
      state: "full_bar",
      open: `${100 + index}`,
      high: `${102 + index}`,
      low: `${99 + index}`,
      close: `${101 + index}`,
      volume: `${1000 + index}`,
      tradedValue: `${100000 + index}`,
      tradeCount: `${10 + index}`,
    })));

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "date_range", startDate: "2021-09-01", endDate: "2026-08-27" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [
        { id: "simple_price_return", windowSessions: 1260 },
        { id: "annualized_realized_volatility", windowSessions: 1260 },
        { id: "maximum_drawdown", windowSessions: 1260 },
        { id: "average_daily_volume", windowSessions: 1260 },
        { id: "average_daily_traded_value", windowSessions: 1260 },
      ],
    });

    expect(result.metrics).toHaveLength(5);
    for (const metric of result.metrics) {
      expect(metric.status).toBe("returned");
      if (metric.status !== "returned") continue;
      expect(metric.lineage).toMatchObject({
        state: "bounded",
        totalObservationCount: 1260,
        maxReturnedObservations: 64,
        digestAlgorithm: "sha256",
      });
      expect(metric.observationInputs).toHaveLength(64);
      expect(metric.observationIds).toHaveLength(64);
    }
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(256 * 1024);
  });

  it("response budget: truncate oversized pages and reject a single oversized suspended record", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords(
      Array.from({ length: 31 }, (_, index) => priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        state: "suspended",
        note: "budget-note-".repeat(1600),
        retrievedAt: `2026-08-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`,
        contentHash: `sha256:budget:${index}`,
      })),
    );

    const truncated = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 31 },
      basis: "raw",
      order: "desc",
      page: { limit: 31 },
      metrics: [],
    });

    expect(truncated.page.recordCount).toBeLessThan(40);
    expect(truncated.page.truncatedByBudget).toBe(true);
    expect(truncated.page.nextCursor).toEqual(expect.any(String));

    const oversized = new MemoryPersistence();
    await oversized.appendResearchIdentityRecords([listing]);
    await oversized.appendResearchPriceRecords([priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "suspended",
      note: "X".repeat(300_000),
      contentHash: "sha256:oversized",
    })]);

    await expect(getPriceSeries(oversized, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    })).rejects.toMatchObject({ code: "research_record_too_large" });
  });

  it("adjusted basis: withhold metrics and expose incomplete sessions when corporate-action lineage is missing", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        state: "full_bar",
        open: "100",
        high: "101",
        low: "99",
        close: "100",
        volume: "1000",
        tradedValue: "100000",
        tradeCount: "10",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        state: "full_bar",
        open: "98",
        high: "100",
        low: "97",
        close: "99",
        volume: "1200",
        tradedValue: "118800",
        tradeCount: "12",
      }),
    ]);
    const store = await persistence.loadStore("user-1");
    createDividendEvent(store, {
      id: "qa-missing-ratio",
      ticker: "2330",
      marketCode: "TW",
      eventType: "STOCK",
      exDividendDate: "2026-08-28",
      paymentDate: "2026-09-10",
      cashDividendPerShare: 0,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      source: "qa",
    });
    await persistence.saveStore(store);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "corporate_action_adjusted",
      order: "asc",
      page: { limit: 2 },
      metrics: [
        { id: "simple_price_return", windowSessions: 2 },
        { id: "total_shareholder_return", windowSessions: 2 },
      ],
    });

    expect(result.basisPolicy.status).toBe("incomplete");
    expect(result.sessions).toEqual([
      {
        state: "corporate_action_incomplete",
        sessionDate: "2026-08-26",
        close: 100,
        missingInputs: ["canonical_verified_corporate_actions_unavailable"],
      },
      {
        state: "corporate_action_incomplete",
        sessionDate: "2026-08-27",
        close: 99,
        missingInputs: ["canonical_verified_corporate_actions_unavailable"],
      },
    ]);
    expect(result.metrics).toEqual([
      {
        status: "withheld",
        id: "simple_price_return",
        windowSessions: 2,
        reasonCode: "corporate_action_incomplete",
      },
      {
        status: "withheld",
        id: "total_shareholder_return",
        windowSessions: 2,
        reasonCode: "corporate_action_incomplete",
      },
    ]);
  });

  it("malformed canonical prices: never coerce invalid numeric facts into zero-valued settled prices", async () => {
    expect(() => priceRecord({
      listingId: "lst_2330",
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "close_only",
      close: "NaN",
      contentHash: "sha256:malformed-close",
    })).toThrow("research_price_record_invalid");
  });

  it("missing expected session: stale without unrelated seed and flips from not-yet-due at 18:00 to stale at 22:00 Asia/Taipei", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "full_bar",
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: "1000",
      tradedValue: "100000",
      tradeCount: "10",
    })]);

    const duePending = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T10:00:00.000Z",
        effectiveAt: "2026-08-28T10:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });
    const stale = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T14:00:00.000Z",
        effectiveAt: "2026-08-28T14:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });

    expect(duePending.freshness).toEqual({ state: "due_pending", authoritativeAsOf: "2026-08-28" });
    expect(stale.freshness).toEqual({ state: "stale", authoritativeAsOf: "2026-08-28" });
    expect(stale.sessions).toEqual([{
      state: "stale",
      sessionDate: "2026-08-28",
      latestAvailableDate: "2026-08-27",
      reasonCode: "authoritative_close_overdue",
    }]);
  });

  it("prior-day overdue session: report stale even before the next local close boundary", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([priceRecord({
      listingId: listing.listing.id,
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "full_bar",
      open: "100",
      high: "101",
      low: "99",
      close: "100",
      volume: "1000",
      tradedValue: "100000",
      tradeCount: "10",
    })]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-31T02:00:00.000Z",
        effectiveAt: "2026-08-29T02:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });

    expect(result.freshness).toEqual({ state: "stale", authoritativeAsOf: "2026-08-28" });
    expect(result.sessions).toEqual([{
      state: "stale",
      sessionDate: "2026-08-28",
      latestAvailableDate: "2026-08-27",
      reasonCode: "authoritative_close_overdue",
    }]);
  });

  it("adjusted basis and TSR: withhold without canonical verified actions and never read the legacy dividend store", async () => {
    const persistence = new MemoryPersistence();
    const listing = companyListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        state: "full_bar",
        open: "100",
        high: "101",
        low: "99",
        close: "100",
        volume: "1000",
        tradedValue: "100000",
        tradeCount: "10",
      }),
      priceRecord({
        listingId: listing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        state: "full_bar",
        open: "101",
        high: "102",
        low: "100",
        close: "101",
        volume: "1100",
        tradedValue: "111100",
        tradeCount: "11",
      }),
    ]);
    const legacyDividendSpy = vi.spyOn(persistence, "listDividendEventsForTickerMarket");

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-27T15:00:00.000Z",
        effectiveAt: "2026-08-27T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "corporate_action_adjusted",
      order: "asc",
      page: { limit: 2 },
      metrics: [{ id: "total_shareholder_return", windowSessions: 2 }],
    });

    expect(result.metrics).toEqual([{
      status: "withheld",
      id: "total_shareholder_return",
      windowSessions: 2,
      reasonCode: "corporate_action_incomplete",
    }]);
    expect(legacyDividendSpy).not.toHaveBeenCalled();
  });

  it("identity-only profile: hide price dataset and mark metrics not applicable", async () => {
    const persistence = new MemoryPersistence();
    const listing = etnListing();
    await persistence.appendResearchIdentityRecords([listing]);
    await persistence.appendResearchPriceRecords([priceRecord({
      listingId: listing.listing.id,
      ticker: "020032",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "close_only",
      close: "7.12",
    })]);

    const manifest = await getResearchManifest(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
    });
    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: listing.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [{ id: "simple_price_return", windowSessions: 1 }],
    });

    expect(manifest.datasets[1]).toEqual({
      id: "price_series",
      status: "unavailable",
      reasonCode: "identity_only_profile",
    });
    expect(result.metrics).toEqual([{
      status: "not_applicable",
      id: "simple_price_return",
      windowSessions: 1,
      reasonCode: "identity_only_profile",
    }]);
  });
});
