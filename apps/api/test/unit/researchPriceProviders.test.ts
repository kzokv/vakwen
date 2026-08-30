import { describe, expect, it } from "vitest";
import { parseTpexPriceSnapshot, parseTpexSuspensionSnapshot } from "../../src/services/research/providers/tpexPrice.js";
import { parseTwsePriceSnapshot, parseTwseSuspensionSnapshot } from "../../src/services/research/providers/twsePrice.js";

describe("official Taiwan price providers", () => {
  it("TWSE snapshot: parse full-bar, no-trade, and close-only rows without fabricating fields", () => {
    expect(parseTwsePriceSnapshot([
      {
        Code: "2330",
        Date: "1150827",
        OpeningPrice: "970.00",
        HighestPrice: "975.00",
        LowestPrice: "965.00",
        ClosingPrice: "972.00",
        TradeVolume: "123,456",
        TradeValue: "120,000,000",
        Transaction: "12,345",
      },
      {
        證券代號: "0050",
        出表日期: "1150827",
        開盤價: "200.00",
        最高價: "200.00",
        最低價: "200.00",
        收盤價: "200.00",
        成交股數: "0",
        成交金額: "0",
        成交筆數: "0",
      },
      {
        證券代號: "020032",
        資料日期: "1150827",
        收盤價: "7.12",
      },
    ])).toEqual([
      {
        ticker: "2330",
        sessionDate: "2026-08-27",
        state: "full_bar",
        open: "970.00",
        high: "975.00",
        low: "965.00",
        close: "972.00",
        volume: "123,456",
        tradedValue: "120,000,000",
        tradeCount: "12,345",
      },
      {
        ticker: "0050",
        sessionDate: "2026-08-27",
        state: "no_trade",
        open: "200.00",
        high: "200.00",
        low: "200.00",
        close: "200.00",
        volume: "0",
        tradedValue: "0",
        tradeCount: "0",
      },
      {
        ticker: "020032",
        sessionDate: "2026-08-27",
        state: "close_only",
        open: undefined,
        high: undefined,
        low: undefined,
        close: "7.12",
        volume: undefined,
        tradedValue: undefined,
        tradeCount: undefined,
      },
    ]);
    expect(parseTwseSuspensionSnapshot([
      { Code: "2337", TradingHaltDate: "1150827" },
      { 證券代號: "5274", TradingHaltDate: "1150826", TradingResumptionDate: "1150827" },
    ], "2026-08-27")).toEqual(new Set(["2337"]));
  });

  it("TPEx snapshot: parse full-bar, no-trade, and close-only rows without fabricating fields", () => {
    expect(parseTpexPriceSnapshot([
      {
        SecuritiesCompanyCode: "5274",
        Date: "1150827",
        Open: "2,500",
        High: "2,550",
        Low: "2,480",
        Close: "2,530",
        TradingShares: "8,765",
        TransactionAmount: "88,000,000",
        TransactionNumber: "4,321",
      },
      {
        股票代號: "00999A",
        資料日期: "1150827",
        開盤價: "15.00",
        最高價: "15.00",
        最低價: "15.00",
        收盤價: "15.00",
        成交股數: "0",
        成交金額: "0",
        成交筆數: "0",
      },
      {
        股票代號: "020041",
        資料日期: "1150827",
        收盤價: "4.56",
      },
    ])).toEqual([
      {
        ticker: "5274",
        sessionDate: "2026-08-27",
        state: "full_bar",
        open: "2,500",
        high: "2,550",
        low: "2,480",
        close: "2,530",
        volume: "8,765",
        tradedValue: "88,000,000",
        tradeCount: "4,321",
      },
      {
        ticker: "00999A",
        sessionDate: "2026-08-27",
        state: "no_trade",
        open: "15.00",
        high: "15.00",
        low: "15.00",
        close: "15.00",
        volume: "0",
        tradedValue: "0",
        tradeCount: "0",
      },
      {
        ticker: "020041",
        sessionDate: "2026-08-27",
        state: "close_only",
        open: undefined,
        high: undefined,
        low: undefined,
        close: "4.56",
        volume: undefined,
        tradedValue: undefined,
        tradeCount: undefined,
      },
    ]);
    expect(parseTpexSuspensionSnapshot([
      { SecuritiesCompanyCode: "6488", 暫停交易: "是", 恢復交易: "否" },
      { 股票代碼: "6679", 暫停交易: "是", 恢復交易: "是" },
    ], "2026-08-27")).toEqual(new Set(["6488"]));
  });

  it("TPEx suspension resolution: a later resume row clears an earlier halt row for the same code", () => {
    expect(parseTpexSuspensionSnapshot([
      { SecuritiesCompanyCode: "1788", DateOfSuspendedTrading: "1150618" },
      { SecuritiesCompanyCode: "1788", DateOfResumedTrading: "1150622" },
      { SecuritiesCompanyCode: "6488", DateOfSuspendedTrading: "1150826" },
    ], "2026-08-28")).toEqual(new Set(["6488"]));
  });

  it("TPEx suspension resolution: keeps a halt active until its future resumption date", () => {
    expect(parseTpexSuspensionSnapshot([{
      SecuritiesCompanyCode: "1788",
      DateOfSuspendedTrading: "1150618",
      DateOfResumedTrading: "1150901",
    }], "2026-08-27")).toEqual(new Set(["1788"]));
  });

  it("TPEx snapshot: accept the live official singular TransactionNumber field", () => {
    expect(parseTpexPriceSnapshot([{
      SecuritiesCompanyCode: "6488",
      Date: "1150827",
      Open: "1,200",
      High: "1,250",
      Low: "1,180",
      Close: "1,230",
      TradingShares: "9,999",
      TransactionAmount: "12,345,678",
      TransactionNumber: "567",
    }])).toEqual([expect.objectContaining({
      ticker: "6488",
      sessionDate: "2026-08-27",
      state: "full_bar",
      tradeCount: "567",
    })]);
  });
});
