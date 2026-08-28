import { describe, expect, it } from "vitest";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  parseOfficialSecuritiesFirmDirectory,
  parseTwseCompanyIdentitySnapshot,
  parseTwseEtnIdentitySnapshot,
  parseTwseEtnRetirementSnapshot,
  parseTwseFundIdentitySnapshot,
  taiwanBusinessDate,
} from "../../src/services/research/providers/twseIdentity.js";
import {
  parseTpexCompanyIdentitySnapshot,
  parseTpexDelistingSnapshot,
  parseTpexEtnIdentitySnapshot,
  parseTpexEtnRetirementSnapshot,
  parseTpexFundIdentitySnapshot,
} from "../../src/services/research/providers/tpexIdentity.js";

describe("official Taiwan identity providers", () => {
  const securitiesFirms = parseOfficialSecuritiesFirmDirectory([{
    證券代號: "9800",
    "券商(證券IB)簡稱": "元大",
    營利事業統一編號: "97160609",
  }, {
    證券代號: "7000",
    "券商(證券IB)簡稱": "兆豐",
    營利事業統一編號: "23474649",
  }]);

  it("retrieval fallback date: scheduled UTC instant after Taiwan midnight → use the next Taiwan business date", () => {
    expect(taiwanBusinessDate("2026-08-27T18:15:00.000Z")).toBe("2026-08-28");
  });

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
    }, securitiesFirms);

    expect(inputs[0]).toMatchObject({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      row: {
        kind: "etn",
        ticker: "020032",
        legalName: "元大證券股份有限公司",
        displayName: "元大綠能N",
        identityKey: expect.stringMatching(/^etn_contract_[a-f0-9]{32}$/),
        issuerIdentityKey: "97160609",
        noteType: "ETN",
        listedAt: "2022-04-25",
      },
    });
  });

  it("retrieval-dated feeds: scheduled UTC instant after Taiwan midnight → stamp the Taiwan date", () => {
    const retrievedAt = "2026-08-27T18:15:00.000Z";
    const metadata = {
      retrievedAt,
      contentHash: "sha256:taiwan-business-date",
      sourceUrl: "https://example.test/identity",
    };

    const twseEtn = parseTwseEtnIdentitySnapshot({
      stat: "ok",
      fields: ["上市日期", "證券代號", "證券簡稱", "發行證券商", "標的指數", "到期日"],
      data: [["2022/04/25", "020032", "元大綠能N", "元大證券股份有限公司", "綠色能源報酬指數", "2032/04/26"]],
    }, metadata, securitiesFirms);
    const tpexEtf = parseTpexFundIdentitySnapshot({
      status: true,
      data: [{ issuerID: "5801", issuer: "第一金投信", listingDate: "20260826", stockName: "第一金主動式台灣成長", stockNo: "00999A" }],
    }, metadata);
    const tpexEtn = parseTpexEtnIdentitySnapshot({
      stat: "ok",
      tables: [{ data: [[
        "020041", "兆豐半導體氣候N", "兆豐證券股份有限公司", "半導體指數",
        "112/12/25", "117/12/24", "detail.html?code=020041",
      ]] }],
    }, metadata, securitiesFirms);

    expect([twseEtn[0]?.snapshotDate, tpexEtf[0]?.snapshotDate, tpexEtn[0]?.snapshotDate])
      .toEqual(["2026-08-28", "2026-08-28", "2026-08-28"]);
  });

  it("TPEx ETF feed: parse official product identities → use a stable official fallback key without inventing a business number", () => {
    const inputs = parseTpexFundIdentitySnapshot({
      status: true,
      data: [{
        issuerID: "5801",
        issuer: "第一金投信",
        listingDate: "20260826",
        stockName: "第一金主動式台灣成長",
        stockNo: "00999A",
      }],
    }, {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:tpex-etf-list",
      sourceUrl: "https://info.tpex.org.tw/api/etfFilter",
    });

    expect(inputs[0]).toMatchObject({
      venue: "TPEX",
      artifact: {
        publisherDataset: "etfFilter",
        accessProvider: "TPEX_WEB_JSON",
      },
      row: {
        kind: "fund",
        ticker: "00999A",
        legalName: "第一金主動式台灣成長",
        issuerIdentityKey: "5801",
        issuerLegalName: "第一金投信",
        identityKey: expect.stringMatching(/^fund_product_[a-f0-9]{32}$/),
        fundType: "ETF",
        listedAt: "2026-08-26",
      },
    });
    expect(inputs[0]?.row).not.toHaveProperty("unifiedBusinessNumber");
  });

  it("TPEx ETF identity: shared issuer, distinct products, and ticker correction → preserve entity boundaries", () => {
    const metadata = {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:tpex-etf-boundaries",
      sourceUrl: "https://info.tpex.org.tw/api/etfFilter",
    };
    const [first, sibling] = parseTpexFundIdentitySnapshot({
      status: true,
      data: [{
        issuerID: "A00009", issuer: "統一投信", listingDate: "20260826", stockName: "主動統一前沿科技", stockNo: "00411A",
      }, {
        issuerID: "A00009", issuer: "統一投信", listingDate: "20260826", stockName: "主動統一美債量化", stockNo: "00987D",
      }],
    }, metadata).map(canonicalizeOfficialIdentityRow);
    const correctedTicker = canonicalizeOfficialIdentityRow(parseTpexFundIdentitySnapshot({
      status: true,
      data: [{
        issuerID: "A00009", issuer: "統一投信", listingDate: "20260826", stockName: "主動統一前沿科技", stockNo: "00411B",
      }],
    }, { ...metadata, contentHash: "sha256:tpex-etf-ticker-correction" })[0]!);

    expect(first?.issuer.id).toBe(sibling?.issuer.id);
    expect(first?.security.id).not.toBe(sibling?.security.id);
    expect(first?.listing.id).not.toBe(sibling?.listing.id);
    expect(correctedTicker.issuer.id).toBe(first?.issuer.id);
    expect(correctedTicker.security.id).toBe(first?.security.id);
    expect(correctedTicker.listing.id).toBe(first?.listing.id);
    expect(correctedTicker.listing.ticker).toBe("00411B");
    expect(first?.observations.find((fact) => fact.subject.kind === "issuer" && fact.field === "legal_name")?.normalized)
      .toEqual({ state: "present", value: "統一投信" });
    expect(first?.observations.find((fact) => fact.subject.kind === "security" && fact.field === "product_legal_name")?.normalized)
      .toEqual({ state: "present", value: "主動統一前沿科技" });
  });

  it("TPEx ETF feed: provider failure or empty success payload → reject before absence retirement", () => {
    const metadata = {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:tpex-etf-invalid",
      sourceUrl: "https://info.tpex.org.tw/api/etfFilter",
    };

    expect(() => parseTpexFundIdentitySnapshot({ status: false, data: [] }, metadata)).toThrow();
    expect(() => parseTpexFundIdentitySnapshot({ status: true, data: [] }, metadata)).toThrow();
  });

  it("TWSE ETF feed: empty HTTP-200 array → reject before absence retirement", () => {
    expect(() => parseTwseFundIdentitySnapshot([], {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:twse-etf-empty",
      sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap47_L",
    })).toThrow();
  });

  it("TPEx ETN feed: parse the official listed-note table → preserve venue-specific provenance", () => {
    const inputs = parseTpexEtnIdentitySnapshot({
      stat: "ok",
      tables: [{
        data: [[
          "020041",
          "兆豐半導體氣候N",
          "兆豐證券股份有限公司",
          "TPEx FactSet半導體氣候淨零優選報酬指數",
          "112/12/25",
          "117/12/24",
          "detail.html?type=domestic&code=020041",
        ]],
      }],
    }, {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:tpex-etn-list",
      sourceUrl: "https://www.tpex.org.tw/www/zh-tw/ETN/list?type=listed",
    }, securitiesFirms);

    expect(inputs[0]).toMatchObject({
      venue: "TPEX",
      artifact: {
        publisherDataset: "ETN/list",
        accessProvider: "TPEX_WEB_JSON",
      },
      row: {
        kind: "etn",
        ticker: "020041",
        legalName: "兆豐證券股份有限公司",
        displayName: "兆豐半導體氣候N",
        identityKey: expect.stringMatching(/^etn_contract_[a-f0-9]{32}$/),
        issuerIdentityKey: "23474649",
        listedAt: "2023-12-25",
      },
    });
  });

  it("ETN feed issuer: no official securities-firm identity match → reject instead of hashing a legal name", () => {
    expect(() => parseTwseEtnIdentitySnapshot({
      stat: "ok",
      fields: ["上市日期", "證券代號", "證券簡稱", "發行證券商", "標的指數", "到期日"],
      data: [["2022/04/25", "020032", "未知綠能N", "未知證券股份有限公司", "綠色能源報酬指數", "2032/04/26"]],
    }, {
      retrievedAt: "2026-08-27T03:00:00.000Z",
      contentHash: "sha256:twse-etn-list",
      sourceUrl: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json",
    }, securitiesFirms)).toThrow("Unknown official ETN issuer");
  });

  it("securities-firm master: missing official business number → reject before ETN identity resolution", () => {
    expect(() => parseOfficialSecuritiesFirmDirectory([{
      證券代號: "9800",
      "券商(證券IB)簡稱": "元大",
      營利事業統一編號: "",
    }])).toThrow();
  });

  it("TWSE ETN retirement feed: parse the official end-of-listing table → preserve the exact retirement date", () => {
    expect(parseTwseEtnRetirementSnapshot({
      stat: "ok",
      fields: ["終止上市日期", "證券代號", "證券簡稱", "發行證券商", "終止上市理由"],
      data: [["2020/04/30", "020005", "永豐外資50N", "永豐金證券股份有限公司", "到期"]],
    })).toEqual([{
      ticker: "020005",
      displayName: "永豐外資50N",
      issuerName: "永豐金證券股份有限公司",
      inactiveAt: "2020-04-30",
    }]);
  });

  it("TPEx ETN retirement feed: parse ROC dates → produce a Gregorian retirement date", () => {
    expect(parseTpexEtnRetirementSnapshot({
      stat: "ok",
      tables: [{
        data: [["110/06/16", "020017", "永豐富櫃200N", "永豐金證券股份有限公司", "到期"]],
      }],
    })).toEqual([{
      ticker: "020017",
      displayName: "永豐富櫃200N",
      issuerName: "永豐金證券股份有限公司",
      inactiveAt: "2021-06-16",
    }]);
  });

  it("TPEx delisting feed: parse official ROC dates → retain exact ticker and company identity", () => {
    expect(parseTpexDelistingSnapshot({
      stat: "ok",
      tables: [{
        data: [[
          "7777",
          "舊上櫃股份有限公司",
          "113-11-29",
          "終止上櫃原因",
          "https://mops.twse.com.tw/mops/#/web/t05st03",
        ]],
      }],
    })).toEqual([{
      ticker: "7777",
      companyName: "舊上櫃股份有限公司",
      inactiveAt: "2024-11-29",
    }]);
  });
});
