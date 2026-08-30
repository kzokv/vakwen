import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { createDividendEvent } from "../../src/services/dividends.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";
import {
  buildFocusedMarketResearchReport,
  renderFocusedMarketResearchReportMarkdown,
} from "../../src/services/research/report.js";
import { getResearchManifest } from "../../src/services/research/service.js";

function listing() {
  return canonicalizeOfficialIdentityRow({
    venue: "TWSE",
    snapshotDate: "2026-08-27",
    retrievedAt: "2026-08-27T02:00:00.000Z",
    artifact: { contentHash: "sha256:report-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
    row: {
      kind: "company",
      ticker: "2330",
      legalName: "台灣積體電路製造股份有限公司",
      displayName: "台積電",
      unifiedBusinessNumber: "22099131",
      industryCode: "24",
      listedAt: "1994-09-05",
    },
  });
}

function price(input: {
  listingId: string;
  sessionDate: string;
  state: "full_bar" | "close_only" | "suspended";
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  tradedValue?: string;
  tradeCount?: string;
  note?: string;
}) {
  return canonicalizeOfficialPriceRow({
    listingId: input.listingId,
    ticker: "2330",
    venue: "TWSE",
    sessionDate: input.sessionDate,
    retrievedAt: `${input.sessionDate}T10:00:00.000Z`,
    artifact: {
      contentHash: `sha256:${input.sessionDate}:${input.state}`,
      sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
      publisherDataset: "STOCK_DAY_ALL",
      accessProvider: "TWSE_OPENAPI",
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

describe("research focused market report QA", () => {
  it("report context: keep manifest and focused report on the same fixed context and exclude non-report technical claims", async () => {
    const persistence = new MemoryPersistence();
    const record = listing();
    await persistence.appendResearchIdentityRecords([record]);
    await persistence.appendResearchPriceRecords([
      price({
        listingId: record.listing.id,
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
      price({
        listingId: record.listing.id,
        sessionDate: "2026-08-27",
        state: "close_only",
        close: "101",
      }),
      price({
        listingId: record.listing.id,
        sessionDate: "2026-08-28",
        state: "suspended",
        note: "Trading halted",
      }),
    ]);
    const store = await persistence.loadStore("user-1");
    createDividendEvent(store, {
      id: "qa-report-dividend",
      ticker: "2330",
      marketCode: "TW",
      eventType: "STOCK",
      exDividendDate: "2026-08-29",
      paymentDate: "2026-09-12",
      cashDividendPerShare: 0,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      source: "qa",
    });
    await persistence.saveStore(store);

    const context = {
      knowledgeAt: "2026-08-29T15:00:00.000Z",
      effectiveAt: "2026-08-29T15:00:00.000Z",
      assessmentMode: "effective" as const,
    };
    const manifest = await getResearchManifest(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context,
    });
    const report = await buildFocusedMarketResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context,
      scope: { kind: "latest_sessions", count: 3 },
      basis: "corporate_action_adjusted",
      order: "asc",
      page: { limit: 3 },
      metrics: [{ id: "simple_price_return", windowSessions: 3 }],
    });
    const markdown = renderFocusedMarketResearchReportMarkdown(report);

    expect(report.context).toEqual(manifest.context);
    expect(report.sections[1]).toMatchObject({
      id: "market_context",
      statement: expect.any(String),
      indicativePricesExcluded: true,
      intradayPricesExcluded: true,
      technicalSignalsExcluded: true,
      priceSeries: {
        selector: { kind: "listing_id", listingId: record.listing.id },
        context,
        basis: "corporate_action_adjusted",
      },
    });
    expect(report.evidence.sessionDates).toEqual(["2026-08-26", "2026-08-27", "2026-08-28"]);
    expect(markdown).toContain("# Taiwan Market Research: 台積電");
    expect(markdown).toContain("- Session 2026-08-26: corporate_action_incomplete");
    expect(markdown).toContain("- Session 2026-08-27: corporate_action_incomplete");
    expect(markdown).toContain("- Session 2026-08-28: suspended");
    expect(markdown).not.toContain("RSI");
    expect(markdown).not.toContain("MACD");
  });
});
