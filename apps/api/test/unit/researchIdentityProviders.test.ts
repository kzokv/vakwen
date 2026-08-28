import { describe, expect, it } from "vitest";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  parseTwseCompanyIdentitySnapshot,
  parseTwseEtnIdentitySnapshot,
  parseTwseFundIdentitySnapshot,
} from "../../src/services/research/providers/twseIdentity.js";
import { parseTpexCompanyIdentitySnapshot } from "../../src/services/research/providers/tpexIdentity.js";

describe("official Taiwan identity providers", () => {
  it("TWSE company snapshot: parse official date and numeric fields → produce a canonical input without ticker coercion", () => {
    const inputs = parseTwseCompanyIdentitySnapshot([{
      出表日期: "1150827",
      公司代號: "0050A",
      公司名稱: "測試股份有限公司",
      公司簡稱: "測試",
      產業別: "24",
      營利事業統一編號: "12345678",
      上市日期: "19940905",
      普通股每股面額: "新台幣                 10.0000元",
      實收資本額: "1,200,000",
      已發行普通股數或TDR原股發行股數: "100,000",
    }], {
      retrievedAt: "2026-08-27T02:00:00.000Z",
      contentHash: "sha256:twse-company",
      sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
    });

    expect(inputs).toEqual([expect.objectContaining({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      row: {
        kind: "company",
        ticker: "0050A",
        legalName: "測試股份有限公司",
        displayName: "測試",
        unifiedBusinessNumber: "12345678",
        industryCode: "24",
        listedAt: "1994-09-05",
        parValue: "10.0000",
        paidInCapital: "1200000",
        issuedShares: "100000",
      },
    })]);
    const record = canonicalizeOfficialIdentityRow(inputs[0]!);
    expect(record.observations.find((item) => item.field === "paid_in_capital")).toMatchObject({
      raw: { state: "present", value: "1,200,000" },
      normalized: { state: "present", value: "1200000" },
    });
  });

  it("TPEx company snapshot: parse the official dotted keys → retain the exact alphanumeric ticker", () => {
    const inputs = parseTpexCompanyIdentitySnapshot([{
      Date: "1150827",
      SecuritiesCompanyCode: "5274A",
      CompanyName: "信驊科技股份有限公司",
      CompanyAbbreviation: "信驊",
      SecuritiesIndustryCode: "24",
      "UnifiedBusinessNo.": "27490748",
      DateOfListing: "20130430",
      ParValueOfCommonStock: "新台幣                 10.0000元",
      "Paidin.Capital.NTDollars": "4,976,543,210",
      IssueShares: "49,765,432",
    }], {
      retrievedAt: "2026-08-27T02:00:00.000Z",
      contentHash: "sha256:tpex-company",
      sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O",
    });

    expect(inputs[0]).toMatchObject({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      row: {
        kind: "company",
        ticker: "5274A",
        unifiedBusinessNumber: "27490748",
        listedAt: "2013-04-30",
        parValue: "10.0000",
        paidInCapital: "4976543210",
        issuedShares: "49765432",
      },
    });
  });

  it("TWSE fund snapshot: parse official ETF rows → retain leading zeroes and declared fund classification", () => {
    const inputs = parseTwseFundIdentitySnapshot([{
      出表日期: "1150827",
      基金代號: "0050",
      基金簡稱: "元大台灣50",
      基金類型: "國內成分證券指數股票型基金",
      基金中文名稱: "元大台灣卓越50證券投資信託基&#37329;",
      基金統一編號: "00936523",
      上市日期: "0920630",
      "發行單位數/轉換數": "1,234,567,890",
    }], {
      retrievedAt: "2026-08-27T02:00:00.000Z",
      contentHash: "sha256:twse-fund",
      sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap47_L",
    });

    expect(inputs[0]).toMatchObject({
      venue: "TWSE",
      row: {
        kind: "fund",
        ticker: "0050",
        legalName: "元大台灣卓越50證券投資信託基金",
        fundType: "國內成分證券指數股票型基金",
        listedAt: "2003-06-30",
        issuedUnits: "1234567890",
      },
    });
  });

  it("TWSE ETN feed: parse the declared product list → classify the note without ticker-pattern inference", () => {
    const inputs = parseTwseEtnIdentitySnapshot({
      stat: "ok",
      fields: ["上市日期", "證券代號", "證券簡稱", "發行證券商", "標的指數", "到期日"],
      data: [["2022/04/25", "020032", "元大綠能N", "元大證券股份有限公司", "綠色能源報酬指數", "2032/04/26"]],
    }, {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:twse-etn-list",
      sourceUrl: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json",
    });

    expect(inputs[0]).toMatchObject({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      row: {
        kind: "etn",
        ticker: "020032",
        legalName: "元大證券股份有限公司",
        displayName: "元大綠能N",
        noteType: "ETN",
        listedAt: "2022-04-25",
      },
    });
  });
});
