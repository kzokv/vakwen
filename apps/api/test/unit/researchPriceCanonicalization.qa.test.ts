import { describe, expect, it } from "vitest";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";
import { parseTpexPriceSnapshot } from "../../src/services/research/providers/tpexPrice.js";
import { parseTwsePriceSnapshot } from "../../src/services/research/providers/twsePrice.js";

describe("research price canonicalization QA", () => {
  it("TWSE route: preserve leading-zero tickers and wrong-board rows stay unmatched", () => {
    expect(parseTwsePriceSnapshot([{
      證券代號: "0050",
      出表日期: "1150827",
      開盤價: "200.00",
      最高價: "201.00",
      最低價: "199.00",
      收盤價: "200.50",
      成交股數: "1,234",
      成交金額: "246,000",
      成交筆數: "321",
    }])).toEqual([expect.objectContaining({
      ticker: "0050",
      sessionDate: "2026-08-27",
      state: "full_bar",
    })]);

    expect(parseTwsePriceSnapshot([{
      SecuritiesCompanyCode: "5274",
      Date: "1150827",
      Open: "2500",
      High: "2550",
      Low: "2480",
      Close: "2530",
      TradingShares: "8765",
      TransactionAmount: "88000000",
      TransactionNumber: "4321",
    }])).toEqual([]);
  });

  it("TPEx route: preserve leading-zero tickers and wrong-board rows stay unmatched", () => {
    expect(parseTpexPriceSnapshot([{
      股票代號: "00999A",
      資料日期: "1150827",
      開盤價: "15.00",
      最高價: "15.20",
      最低價: "14.90",
      收盤價: "15.10",
      成交股數: "8,888",
      成交金額: "134,000",
      成交筆數: "99",
    }])).toEqual([expect.objectContaining({
      ticker: "00999A",
      sessionDate: "2026-08-27",
      state: "full_bar",
    })]);

    expect(parseTpexPriceSnapshot([{
      Code: "2330",
      Date: "1150827",
      OpeningPrice: "970.00",
      HighestPrice: "975.00",
      LowestPrice: "965.00",
      ClosingPrice: "972.00",
      TradeVolume: "123,456",
      TradeValue: "120,000,000",
      Transaction: "12,345",
    }])).toEqual([]);
  });

  it("canonical price row: normalize provenance and sparse session observations without ticker coercion", () => {
    const listing = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "fund",
        ticker: "0050",
        legalName: "元大台灣卓越50證券投資信託基金",
        displayName: "元大台灣50",
        identityKey: "twse-etf:0050",
        fundType: "ETF",
        listedAt: "2003-06-30",
      },
    });

    const suspended = canonicalizeOfficialPriceRow({
      listingId: listing.listing.id,
      ticker: "0050",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      retrievedAt: "2026-08-27T12:34:56.000Z",
      acquisitionRunId: "qa-run-1",
      artifact: {
        contentHash: "sha256:price-suspended",
        sourceUrl: "https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY",
        publisherDataset: "STOCK_DAY",
        accessProvider: "TWSE_WEB_JSON",
      },
      row: {
        state: "suspended",
        note: "Temporary trading suspension",
      },
    });

    expect(suspended).toMatchObject({
      listingId: listing.listing.id,
      ticker: "0050",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      state: "suspended",
      provenance: {
        publisher: "TWSE",
        canonicalDatasetId: "price_series",
        accessProvider: "TWSE_WEB_JSON",
        acquisitionRunId: "qa-run-1",
      },
    });
    expect(suspended.observations.find((item) => item.field === "session_state")?.normalized).toEqual({
      state: "present",
      value: "suspended",
    });
    expect(suspended.observations.find((item) => item.field === "note")?.normalized).toEqual({
      state: "present",
      value: "Temporary trading suspension",
    });
    expect(suspended.observations.find((item) => item.field === "open")?.normalized).toEqual({
      state: "missing",
      reason: "not_reported",
    });
  });
});
