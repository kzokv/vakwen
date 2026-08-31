import { afterEach, describe, expect, it, vi } from "vitest";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { MarketCalendarExceptionInput } from "../../src/persistence/types.js";
import {
  OFFICIAL_IDENTITY_SOURCES,
  OFFICIAL_PRICE_SOURCES,
  runOfficialIdentityAcquisition,
  runOfficialMonthlyRevenueAcquisition,
  runOfficialPriceAcquisition,
} from "../../src/services/research/acquisition.js";
import {
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
  officialFundProductIdentityKey,
} from "../../src/services/research/identity.js";
import { getResearchIdentity } from "../../src/services/research/service.js";

function stubActiveTaiwanCalendar(
  persistence: MemoryPersistence,
  exceptions: MarketCalendarExceptionInput[] = [],
): void {
  vi.spyOn(persistence, "getActiveMarketCalendarVersion").mockImplementation(async (marketCode, calendarYear) =>
    marketCode === "TW"
      ? {
          marketCode,
          calendarYear,
          status: "confirmed",
          isActive: true,
          exceptions: exceptions.filter((item) => item.date.startsWith(`${calendarYear}-`)),
        } as never
      : null
  );
}

describe("official Taiwan identity acquisition", () => {
  afterEach(() => setResearchRolloutOverrideForTest(null));

  it("enabled acquisition: fetch both venues' official identity and status snapshots → append canonical records", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const tpexDelistingUrls = Array.from(
      { length: 6 },
      (_, index) => `${OFFICIAL_IDENTITY_SOURCES.tpexDelistings}&date=${2021 + index}`,
    );
    const payloads = new Map<string, unknown>([
      [OFFICIAL_IDENTITY_SOURCES.twseCompanies, [{
        出表日期: "1150827", 公司代號: "2330", 公司名稱: "台灣積體電路製造股份有限公司", 公司簡稱: "台積電",
        產業別: "24", 營利事業統一編號: "22099131", 上市日期: "19940905",
      }, {
        出表日期: "1150827", 公司代號: "9999", 公司名稱: "新上市股份有限公司", 公司簡稱: "新上市",
        產業別: "24", 營利事業統一編號: "88888888", 上市日期: "20260827",
      }, {
        出表日期: "1150827", 公司代號: "8888", 公司名稱: "延遲移除股份有限公司", 公司簡稱: "延遲移除",
        產業別: "24", 營利事業統一編號: "88880000", 上市日期: "20200101",
      }]],
      [OFFICIAL_IDENTITY_SOURCES.tpexCompanies, [{
        Date: "1150827", SecuritiesCompanyCode: "5274", CompanyName: "信驊科技股份有限公司", CompanyAbbreviation: "信驊",
        SecuritiesIndustryCode: "24", "UnifiedBusinessNo.": "27490748", DateOfListing: "20130430",
      }, {
        Date: "1150827", SecuritiesCompanyCode: "7777", CompanyName: "新上櫃股份有限公司", CompanyAbbreviation: "新上櫃",
        SecuritiesIndustryCode: "24", "UnifiedBusinessNo.": "77777777", DateOfListing: "20260827",
      }]],
      [OFFICIAL_IDENTITY_SOURCES.twseFunds, [{
        出表日期: "1150827", 基金代號: "0050", 基金簡稱: "元大台灣50", 基金類型: "ETF",
        基金中文名稱: "元大台灣卓越50證券投資信託基金", 基金統一編號: "00936523", 上市日期: "0920630",
      }]],
      [OFFICIAL_IDENTITY_SOURCES.tpexFunds, {
        status: true,
        data: [{ issuerID: "5801", issuer: "第一金投信", listingDate: "20260826", stockName: "第一金主動式台灣成長", stockNo: "00999A" }],
      }],
      [OFFICIAL_IDENTITY_SOURCES.twseSecuritiesFirms, [{
        證券代號: "9800", "券商(證券IB)簡稱": "元大", 營利事業統一編號: "97160609",
      }, {
        證券代號: "7000", "券商(證券IB)簡稱": "兆豐", 營利事業統一編號: "23474649",
      }]],
      [OFFICIAL_IDENTITY_SOURCES.twseEtns, {
        stat: "ok", fields: ["上市日期", "證券代號", "證券簡稱", "發行證券商", "標的指數", "到期日"],
        data: [["2022/04/25", "020032", "元大綠能N", "元大證券股份有限公司", "綠色能源報酬指數", "2032/04/26"]],
      }],
      [OFFICIAL_IDENTITY_SOURCES.tpexEtns, {
        stat: "ok",
        tables: [{ data: [[
          "020041", "兆豐半導體氣候N", "兆豐證券股份有限公司", "TPEx FactSet半導體氣候淨零優選報酬指數",
          "112/12/25", "117/12/24", "detail.html?type=domestic&code=020041",
        ]] }],
      }],
      [OFFICIAL_IDENTITY_SOURCES.twseEtnRetirements, {
        stat: "ok",
        fields: ["終止上市日期", "證券代號", "證券簡稱", "發行證券商", "終止上市理由"],
        data: [["2020/04/30", "020005", "永豐外資50N", "永豐金證券股份有限公司", "到期"]],
      }],
      [OFFICIAL_IDENTITY_SOURCES.tpexEtnRetirements, {
        stat: "ok",
        tables: [{ data: [["110/06/16", "020017", "永豐富櫃200N", "永豐金證券股份有限公司", "到期"]] }],
      }],
      [OFFICIAL_IDENTITY_SOURCES.twseDelistings, [{
        DelistingDate: "2026/08/26", Company: "既有下市股份有限公司", Code: "9999",
      }, {
        DelistingDate: "2026/08/26", Company: "延遲移除股份有限公司", Code: "8888",
      }]],
      ...tpexDelistingUrls.map((url, index) => [url, {
        stat: "ok",
        tables: [{ data: index === 3
          ? [["7777", "舊上櫃股份有限公司", "113-11-29", "終止上櫃原因", "https://mops.twse.com.tw/"]]
          : [] }],
      }] as const),
    ]);
    const requested: string[] = [];
    const requests: Array<{ url: string; method: string }> = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      requested.push(url);
      requests.push({ url, method: init?.method ?? "GET" });
      return new Response(JSON.stringify(payloads.get(url)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const persistence = new MemoryPersistence();
    const existing = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-25",
      retrievedAt: "2026-08-25T02:00:00.000Z",
      artifact: { contentHash: "sha256:existing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "9999", legalName: "既有下市股份有限公司", displayName: "既有下市",
        unifiedBusinessNumber: "99999999", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    const beforeTransfer = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-20",
      retrievedAt: "2026-08-20T02:00:00.000Z",
      artifact: { contentHash: "sha256:before-transfer", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company", ticker: "2330", legalName: "台灣積體電路製造股份有限公司", displayName: "台積電",
        unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1990-01-01",
      },
    });
    const retiredTpex = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2024-11-28",
      retrievedAt: "2024-11-28T02:00:00.000Z",
      artifact: { contentHash: "sha256:retired-tpex", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company", ticker: "7777", legalName: "舊上櫃股份有限公司", displayName: "舊上櫃",
        unifiedBusinessNumber: "11111111", industryCode: "24", listedAt: "2010-01-01",
      },
    });
    const absentTwseEtf = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-25",
      retrievedAt: "2026-08-25T02:00:00.000Z",
      artifact: { contentHash: "sha256:absent-twse-etf", sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseFunds },
      row: {
        kind: "fund", ticker: "00600", legalName: "舊上市ETF", displayName: "舊上市ETF",
        identityKey: "twse-etf:00600", fundType: "ETF", listedAt: "2015-01-01",
      },
    });
    const absentTpexEtf = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-25",
      retrievedAt: "2026-08-25T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:absent-tpex-etf",
        sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexFunds,
        publisherDataset: "etfFilter",
        accessProvider: "TPEX_WEB_JSON",
      },
      row: {
        kind: "fund", ticker: "00601", legalName: "舊上櫃ETF", displayName: "舊上櫃ETF",
        identityKey: "tpex-etf:00601", fundType: "ETF", listedAt: "2015-01-01",
      },
    });
    const preCorrectionTpexEtf = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-26",
      retrievedAt: "2026-08-26T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:pre-correction-tpex-etf",
        sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexFunds,
        publisherDataset: "etfFilter",
        accessProvider: "TPEX_WEB_JSON",
      },
      row: {
        kind: "fund",
        ticker: "00999B",
        legalName: "第一金主動式台灣成長",
        displayName: "第一金主動式台灣成長",
        issuerIdentityKey: "5801",
        issuerLegalName: "第一金投信",
        identityKey: "fund_product:official-code-before-correction",
        fundType: "ETF",
        listedAt: "2026-08-26",
      },
    });
    const retiredTwseEtn = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2020-04-29",
      retrievedAt: "2020-04-29T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:retired-twse-etn",
        sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseEtns,
        publisherDataset: "ETN/list",
        accessProvider: "TWSE_WEB_JSON",
      },
      row: {
        kind: "etn", ticker: "020005", legalName: "永豐金證券股份有限公司", displayName: "永豐外資50N",
        identityKey: "twse-etn:contract-retired", issuerIdentityKey: "23113343", noteType: "ETN", listedAt: "2019-04-30",
      },
    });
    const retiredTpexEtn = (await import("../../src/services/research/identity.js")).canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2021-06-15",
      retrievedAt: "2021-06-15T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:retired-tpex-etn",
        sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexEtns,
        publisherDataset: "ETN/list",
        accessProvider: "TPEX_WEB_JSON",
      },
      row: {
        kind: "etn", ticker: "020017", legalName: "永豐金證券股份有限公司", displayName: "永豐富櫃200N",
        identityKey: "tpex-etn:contract-retired", issuerIdentityKey: "23113343",
        noteType: "ETN", listedAt: "2020-06-16",
      },
    });
    await persistence.appendResearchIdentityRecords([
      existing,
      beforeTransfer,
      retiredTpex,
      absentTwseEtf,
      absentTpexEtf,
      preCorrectionTpexEtf,
      retiredTwseEtn,
      retiredTpexEtn,
    ]);
    const listHistorySpy = vi.spyOn(persistence, "listResearchIdentityRecords");
    const listLatestSpy = vi.spyOn(persistence, "listResearchIdentityLatestRevisions");
    const listResolvedLatestSpy = vi.spyOn(persistence, "listLatestResearchIdentityRecords");

    const result = await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T18:15:00.000Z",
      acquisitionRunId: "run-test-1",
    });
    expect(listHistorySpy).not.toHaveBeenCalled();
    expect(listLatestSpy).toHaveBeenCalledTimes(2);
    expect(listResolvedLatestSpy).not.toHaveBeenCalled();

    expect(requested.sort()).toEqual([
      OFFICIAL_IDENTITY_SOURCES.twseCompanies,
      OFFICIAL_IDENTITY_SOURCES.tpexCompanies,
      OFFICIAL_IDENTITY_SOURCES.twseFunds,
      OFFICIAL_IDENTITY_SOURCES.tpexFunds,
      OFFICIAL_IDENTITY_SOURCES.twseSecuritiesFirms,
      OFFICIAL_IDENTITY_SOURCES.twseEtns,
      OFFICIAL_IDENTITY_SOURCES.tpexEtns,
      OFFICIAL_IDENTITY_SOURCES.twseEtnRetirements,
      OFFICIAL_IDENTITY_SOURCES.tpexEtnRetirements,
      OFFICIAL_IDENTITY_SOURCES.twseDelistings,
      ...tpexDelistingUrls,
    ].sort());
    expect(requests.find(({ url }) => url === OFFICIAL_IDENTITY_SOURCES.tpexFunds)?.method).toBe("POST");
    expect(result).toMatchObject({ sourceCount: 13, recordCount: 16, acquisitionRunId: "run-test-1" });
    const etn = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "020032", venue: "TWSE" },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(etn[0]?.eligibility.profile).toBe("identity_only");
    const inactive = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: existing.listing.id },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(inactive.at(-1)?.listing.status).toBe("inactive");
    const reusedTicker = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "9999", venue: "TWSE" },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(reusedTicker.find((record) => record.listing.listedAt === "2026-08-27")?.listing.status).toBe("active");
    const correctedTpexEtf = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "00999A", venue: "TPEX" },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(correctedTpexEtf.at(-1)).toMatchObject({
      issuer: { id: preCorrectionTpexEtf.issuer.id },
      security: { id: preCorrectionTpexEtf.security.id },
      listing: { id: preCorrectionTpexEtf.listing.id, ticker: "00999A", status: "active" },
    });
    const laggingCurrentTicker = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "8888", venue: "TWSE" },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(laggingCurrentTicker.at(-1)?.listing).toMatchObject({
      status: "inactive",
      inactiveAt: "2026-08-26",
    });
    const laggingCurrentIdentity = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "8888", listingVenue: "TWSE" },
      context: {
        effectiveAt: "2026-08-28T23:59:59.999Z",
        knowledgeAt: "2026-08-28T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });
    expect(laggingCurrentIdentity.identity.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        field: "legal_name",
        normalized: { state: "present", value: "延遲移除股份有限公司" },
      }),
      expect.objectContaining({
        field: "display_name",
        normalized: { state: "present", value: "延遲移除" },
      }),
      expect.objectContaining({
        field: "industry_code",
        normalized: { state: "present", value: "24" },
      }),
    ]));
    const transferred = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "2330", venue: "TWSE" },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(transferred.at(-1)?.listing.predecessorListingId).toBe(beforeTransfer.listing.id);
    const retiredTpexHistory = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: retiredTpex.listing.id },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });
    expect(retiredTpexHistory.at(-1)?.listing).toMatchObject({
      venue: "TPEX",
      status: "inactive",
      inactiveAt: "2024-11-29",
    });
    const reusedTpexTicker = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "7777", venue: "TPEX" },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    });
    const latestByListing = new Map(reusedTpexTicker.map((record) => [record.listing.id, record]));
    expect([...latestByListing.values()].filter((record) => record.listing.status === "active")).toHaveLength(1);
    expect([...latestByListing.values()].find((record) => record.listing.status === "active")?.listing.listedAt).toBe("2026-08-27");

    for (const [listingId, accessProvider] of [
      [absentTwseEtf.listing.id, "TWSE_OPENAPI"],
      [absentTpexEtf.listing.id, "TPEX_WEB_JSON"],
    ] as const) {
      const history = await persistence.listResearchIdentityRecords({
        subject: { kind: "listing_id", listingId },
        effectiveAt: "2026-08-28T23:59:59.999Z",
        knowledgeAt: "2026-08-28T23:59:59.999Z",
      });
      expect(history.at(-1)?.listing.status).toBe("active");
      expect(history.at(-1)?.observations).toEqual([
        expect.objectContaining({ field: "listing_presence", normalized: { state: "present", value: "absent" } }),
      ]);
      expect(history.at(-1)?.provenance.accessProvider).toBe(accessProvider);
    }

    for (const [listingId, inactiveAt, accessProvider] of [
      [retiredTwseEtn.listing.id, "2020-04-30", "TWSE_WEB_JSON"],
      [retiredTpexEtn.listing.id, "2021-06-16", "TPEX_WEB_JSON"],
    ] as const) {
      const history = await persistence.listResearchIdentityRecords({
        subject: { kind: "listing_id", listingId },
        effectiveAt: "2026-08-28T23:59:59.999Z",
        knowledgeAt: "2026-08-28T23:59:59.999Z",
      });
      expect(history.at(-1)?.listing).toMatchObject({ status: "inactive", inactiveAt });
      expect(history.at(-1)?.provenance.accessProvider).toBe(accessProvider);
    }

    await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-28T18:15:00.000Z",
      acquisitionRunId: "run-test-2",
    });
    for (const listingId of [absentTwseEtf.listing.id, absentTpexEtf.listing.id]) {
      const history = await persistence.listResearchIdentityRecords({
        subject: { kind: "listing_id", listingId },
        effectiveAt: "2026-08-29T23:59:59.999Z",
        knowledgeAt: "2026-08-29T23:59:59.999Z",
      });
      expect(history.at(-1)?.listing).toMatchObject({ status: "inactive", inactiveAt: "2026-08-29" });
    }
  });

  it("monthly revenue acquisition: fetch official TWSE and TPEX snapshots → append authoritative raw-month revenue records only for known active listings", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const twseIdentity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-01",
      retrievedAt: "2026-08-01T02:00:00.000Z",
      artifact: { contentHash: "sha256:twse-revenue-identity", sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseCompanies },
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
    const tpexIdentity = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-01",
      retrievedAt: "2026-08-01T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-revenue-identity", sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexCompanies },
      row: {
        kind: "company",
        ticker: "5274",
        legalName: "信驊科技股份有限公司",
        displayName: "信驊",
        unifiedBusinessNumber: "27490748",
        industryCode: "24",
        listedAt: "2013-04-30",
      },
    });
    await persistence.appendResearchIdentityRecords([twseIdentity, tpexIdentity]);

    const requested: string[] = [];
    const payloads = new Map<string, unknown>([
      [OFFICIAL_IDENTITY_SOURCES.twseMonthlyRevenue, [
        {
          出表日期: "1150810",
          資料年月: "11507",
          公司代號: "2330",
          公司名稱: "台灣積體電路製造股份有限公司",
          產業別: "24",
          "營業收入-當月營收": "1,000",
          "營業收入-上月營收": "990",
          "營業收入-去年當月營收": "900",
          "營業收入-上月比較增減(%)": "1.01",
          "營業收入-去年同月增減(%)": "11.11",
          "累計營業收入-當月累計營收": "7,000",
          "累計營業收入-去年累計營收": "6,300",
          "累計營業收入-前期比較增減(%)": "11.11",
          備註: "自結數",
        },
        {
          出表日期: "1150810",
          資料年月: "11507",
          公司代號: "9999",
          公司名稱: "未建檔公司",
          產業別: "24",
          "營業收入-當月營收": "100",
          "營業收入-上月營收": "95",
          "營業收入-去年當月營收": "90",
          "營業收入-上月比較增減(%)": "5.26",
          "營業收入-去年同月增減(%)": "11.11",
          "累計營業收入-當月累計營收": "700",
          "累計營業收入-去年累計營收": "630",
          "累計營業收入-前期比較增減(%)": "11.11",
          備註: "-",
        },
      ]],
      [OFFICIAL_IDENTITY_SOURCES.tpexMonthlyRevenue, [
        {
          出表日期: "1150811",
          資料年月: "11507",
          公司代號: "5274",
          公司名稱: "信驊科技股份有限公司",
          產業別: "24",
          "營業收入-當月營收": "2,000",
          "營業收入-上月營收": "1,950",
          "營業收入-去年當月營收": "1,800",
          "營業收入-上月比較增減(%)": "2.56",
          "營業收入-去年同月增減(%)": "11.11",
          "累計營業收入-當月累計營收": "12,000",
          "累計營業收入-去年累計營收": "10,800",
          "累計營業收入-前期比較增減(%)": "11.11",
          備註: "個別自結數",
        },
      ]],
    ]);
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      requested.push(url);
      return new Response(JSON.stringify(payloads.get(url)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    const result = await runOfficialMonthlyRevenueAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-12T02:00:00.000Z",
      acquisitionRunId: "monthly-revenue-run",
    });

    expect(requested.sort()).toEqual([
      OFFICIAL_IDENTITY_SOURCES.tpexMonthlyRevenue,
      OFFICIAL_IDENTITY_SOURCES.twseMonthlyRevenue,
    ].sort());
    expect(result).toMatchObject({
      acquisitionRunId: "monthly-revenue-run",
      sourceCount: 2,
      recordCount: 2,
      months: ["2026-07"],
    });
    const twseRecords = await persistence.listLatestResearchMonthlyRevenueRecords({
      subject: { kind: "listing_id", listingId: twseIdentity.listing.id },
      effectiveAt: "2026-08-12T02:00:00.000Z",
      knowledgeAt: "2026-08-12T02:00:00.000Z",
      startMonth: "2026-07",
      endMonth: "2026-07",
    });
    const tpexRecords = await persistence.listLatestResearchMonthlyRevenueRecords({
      subject: { kind: "listing_id", listingId: tpexIdentity.listing.id },
      effectiveAt: "2026-08-12T02:00:00.000Z",
      knowledgeAt: "2026-08-12T02:00:00.000Z",
      startMonth: "2026-07",
      endMonth: "2026-07",
    });
    expect(twseRecords).toEqual([
      expect.objectContaining({
        rawRevenueMonth: "11507",
        publicationContext: {
          publishedAt: "2026-08-10",
          rawPublishedAt: "1150810",
          declaredUnit: "TWD_THOUSANDS",
          basis: "consolidated",
          qualifier: "estimated",
        },
        provenance: expect.objectContaining({
          publisher: "TWSE",
          publisherDataset: "t187ap05_L",
          acquisitionRunId: "monthly-revenue-run",
        }),
      }),
    ]);
    expect(tpexRecords).toEqual([
      expect.objectContaining({
        rawRevenueMonth: "11507",
        publicationContext: {
          publishedAt: "2026-08-11",
          rawPublishedAt: "1150811",
          declaredUnit: "TWD_THOUSANDS",
          basis: "individual",
          qualifier: "estimated",
        },
        provenance: expect.objectContaining({
          publisher: "TPEX",
          publisherDataset: "mopsfin_t187ap05_O",
          acquisitionRunId: "monthly-revenue-run",
        }),
      }),
    ]);

    payloads.set(OFFICIAL_IDENTITY_SOURCES.tpexMonthlyRevenue, []);
    await expect(runOfficialMonthlyRevenueAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-12T03:00:00.000Z",
      acquisitionRunId: "monthly-revenue-empty-tpex",
    })).rejects.toThrow("Official TPEX monthly revenue snapshot returned no canonical rows");
    expect(await persistence.listLatestResearchMonthlyRevenueRecords({
      subject: { kind: "listing_id", listingId: tpexIdentity.listing.id },
      effectiveAt: "2026-08-12T03:00:00.000Z",
      knowledgeAt: "2026-08-12T03:00:00.000Z",
      startMonth: "2026-07",
      endMonth: "2026-07",
    })).toHaveLength(1);
  });

  it("fresh database: historical company and ETN retirements → seed queryable inactive identities", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    let historicalTpexCompanyName = "歷史上櫃公司";
    let historicalTwseEtnName = "元大歷史N";
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      let payload: unknown;
      if (url === OFFICIAL_IDENTITY_SOURCES.twseCompanies || url === OFFICIAL_IDENTITY_SOURCES.tpexCompanies) {
        payload = [];
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseFunds) {
        payload = [{
          出表日期: "1150829", 基金代號: "0050", 基金簡稱: "元大台灣50", 基金類型: "ETF",
          基金中文名稱: "元大台灣卓越50證券投資信託基金", 基金統一編號: "00936523", 上市日期: "0920630",
        }];
      } else if (url === OFFICIAL_IDENTITY_SOURCES.tpexFunds) {
        payload = {
          status: true,
          data: [{ issuerID: "A00009", issuer: "統一投信", listingDate: "20260826", stockName: "主動統一前沿科技", stockNo: "00411A" }],
        };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseSecuritiesFirms) {
        payload = [{
          證券代號: "9800", "券商(證券IB)簡稱": "元大", 營利事業統一編號: "97160609",
        }, {
          證券代號: "7000", "券商(證券IB)簡稱": "兆豐", 營利事業統一編號: "23474649",
        }];
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseEtns) {
        payload = { stat: "ok", fields: [], data: [] };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.tpexEtns) {
        payload = { stat: "ok", tables: [{ data: [] }] };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseEtnRetirements) {
        payload = {
          stat: "ok",
          data: [["2020/04/30", "020005", historicalTwseEtnName, "元大證券股份有限公司", "到期"]],
        };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.tpexEtnRetirements) {
        payload = {
          stat: "ok",
          tables: [{ data: [["110/06/16", "020017", "兆豐歷史N", "兆豐證券股份有限公司", "到期"]] }],
        };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseDelistings) {
        payload = [{
          DelistingDate: "2020/01/31", Company: "第一代歷史上市公司", Code: "1234",
        }, {
          DelistingDate: "2023/06/30", Company: "第二代歷史上市公司", Code: "1234",
        }];
      } else {
        payload = {
          stat: "ok",
          tables: [{ data: url.endsWith("date=2024")
            ? [["5678", historicalTpexCompanyName, "113-11-29", "終止上櫃原因", "https://mops.twse.com.tw/"]]
            : [] }],
        };
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const persistence = new MemoryPersistence();

    const result = await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-29T04:00:00.000Z",
      acquisitionRunId: "run-fresh-history",
    });

    expect(result.recordCount).toBe(7);
    const reusedHistoricalTicker = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "1234", venue: "TWSE" },
      effectiveAt: "2026-08-29T23:59:59.999Z",
      knowledgeAt: "2026-08-29T23:59:59.999Z",
    });
    expect([...new Set(reusedHistoricalTicker.map((record) => record.listing.id))]).toHaveLength(2);
    expect(reusedHistoricalTicker.map((record) => record.listing.inactiveAt).sort()).toEqual([
      "2020-01-31",
      "2023-06-30",
    ]);
    expect(reusedHistoricalTicker.map((record) =>
      record.observations.find((observation) => observation.field === "legal_name")?.normalized
    )).toEqual(expect.arrayContaining([
      { state: "present", value: "第一代歷史上市公司" },
      { state: "present", value: "第二代歷史上市公司" },
    ]));
    for (const [ticker, listingVenue, profile, inactiveAt] of [
      ["5678", "TPEX", "unknown", "2024-11-29"],
      ["020005", "TWSE", "identity_only", "2020-04-30"],
      ["020017", "TPEX", "identity_only", "2021-06-16"],
    ] as const) {
      const identity = await getResearchIdentity(persistence, {
        subject: { kind: "ticker_venue", ticker, listingVenue },
        context: {
          effectiveAt: "2026-08-29T23:59:59.999Z",
          knowledgeAt: "2026-08-29T23:59:59.999Z",
          assessmentMode: "effective",
        },
        history: { limit: 25 },
      });
      expect(identity.identity).toMatchObject({
        listing: { ticker, venue: listingVenue, status: "inactive", inactiveAt },
        eligibility: { profile, state: "ineligible", reasonCode: "inactive_listing" },
      });
      expect(identity.history.items).toHaveLength(1);
    }

    const companyBeforeCorrection = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "5678", listingVenue: "TPEX" },
      context: {
        effectiveAt: "2026-08-29T23:59:59.999Z",
        knowledgeAt: "2026-08-29T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });
    const etnBeforeCorrection = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "020005", listingVenue: "TWSE" },
      context: {
        effectiveAt: "2026-08-29T23:59:59.999Z",
        knowledgeAt: "2026-08-29T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });
    historicalTpexCompanyName = "歷史上櫃公司更正";
    historicalTwseEtnName = "元大歷史更正N";
    await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-30T04:00:00.000Z",
      acquisitionRunId: "run-corrected-history",
    });

    const companyAfterCorrection = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "5678", listingVenue: "TPEX" },
      context: {
        effectiveAt: "2026-08-30T23:59:59.999Z",
        knowledgeAt: "2026-08-30T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });
    const etnAfterCorrection = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "020005", listingVenue: "TWSE" },
      context: companyAfterCorrection.context,
      history: { limit: 25 },
    });
    expect(companyAfterCorrection.selector).toEqual(companyBeforeCorrection.selector);
    expect(companyAfterCorrection.history.items).toHaveLength(2);
    expect(companyAfterCorrection.identity.facts.find((fact) => fact.field === "legal_name")?.normalized)
      .toEqual({ state: "present", value: historicalTpexCompanyName });
    expect(etnAfterCorrection.selector).toEqual(etnBeforeCorrection.selector);
    expect(etnAfterCorrection.history.items).toHaveLength(2);
    expect(etnAfterCorrection.identity.facts.find((fact) => fact.field === "display_name")?.normalized)
      .toEqual({ state: "present", value: historicalTwseEtnName });
  });

  it("partial ETF snapshot: unexplained absences exceed the completeness guard → reject without retiring listings", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    const historicalTpexEtfs = ["00610", "00611", "00612"].map((ticker, index) =>
      canonicalizeOfficialIdentityRow({
        venue: "TPEX",
        snapshotDate: "2026-08-28",
        retrievedAt: "2026-08-28T02:00:00.000Z",
        artifact: {
          contentHash: `sha256:historical-${ticker}`,
          sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexFunds,
          publisherDataset: "etfFilter",
          accessProvider: "TPEX_WEB_JSON",
        },
        row: {
          kind: "fund",
          ticker,
          legalName: `歷史ETF ${ticker}`,
          displayName: `歷史ETF ${ticker}`,
          issuerIdentityKey: `issuer-${index}`,
          identityKey: officialFundProductIdentityKey({
            venue: "TPEX",
            issuerIdentityKey: `issuer-${index}`,
            officialProductCode: ticker,
            listedAt: "2020-01-01",
            fundType: "ETF",
          }),
          fundType: "ETF",
          listedAt: "2020-01-01",
        },
      })
    );
    await persistence.appendResearchIdentityRecords(historicalTpexEtfs);

    let currentTpexTickers = ["00610"];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      let payload: unknown;
      if (url === OFFICIAL_IDENTITY_SOURCES.twseCompanies || url === OFFICIAL_IDENTITY_SOURCES.tpexCompanies) {
        payload = [];
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseFunds) {
        payload = [{
          出表日期: "1150829", 基金代號: "0050", 基金簡稱: "元大台灣50", 基金類型: "ETF",
          基金中文名稱: "元大台灣卓越50證券投資信託基金", 基金統一編號: "00936523", 上市日期: "0920630",
        }];
      } else if (url === OFFICIAL_IDENTITY_SOURCES.tpexFunds) {
        payload = {
          status: true,
          data: currentTpexTickers.map((ticker) => {
            const index = Number(ticker.slice(-1));
            return {
              issuerID: `issuer-${index}`,
              issuer: `歷史投信 ${index}`,
              listingDate: "20200101",
              stockName: `歷史ETF ${ticker}`,
              stockNo: ticker,
            };
          }),
        };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseSecuritiesFirms) {
        payload = [{
          證券代號: "9800", "券商(證券IB)簡稱": "元大", 營利事業統一編號: "97160609",
        }];
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseEtns) {
        payload = { stat: "ok", fields: [], data: [] };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.tpexEtns) {
        payload = { stat: "ok", tables: [{ data: [] }] };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseEtnRetirements) {
        payload = { stat: "ok", data: [] };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.tpexEtnRetirements) {
        payload = { stat: "ok", tables: [{ data: [] }] };
      } else if (url === OFFICIAL_IDENTITY_SOURCES.twseDelistings) {
        payload = [];
      } else {
        payload = { stat: "ok", tables: [{ data: [] }] };
      }
      return new Response(JSON.stringify(payload), { status: 200 });
    };

    await expect(runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-29T04:00:00.000Z",
      acquisitionRunId: "run-partial-etf",
    })).rejects.toThrow("TPEX ETF snapshot failed completeness guard: 2 of 3 active listings are absent");

    for (const record of historicalTpexEtfs) {
      const history = await persistence.listResearchIdentityRecords({
        subject: { kind: "listing_id", listingId: record.listing.id },
        effectiveAt: "2026-08-29T23:59:59.999Z",
        knowledgeAt: "2026-08-29T23:59:59.999Z",
      });
      expect(history).toHaveLength(1);
      expect(history[0]?.listing.status).toBe("active");
    }

    currentTpexTickers = ["00610", "00611"];
    await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-29T04:00:00.000Z",
      acquisitionRunId: "run-single-etf-absence",
    });
    const transientListingId = historicalTpexEtfs[2]!.listing.id;
    const pendingHistory = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: transientListingId },
      effectiveAt: "2026-08-29T23:59:59.999Z",
      knowledgeAt: "2026-08-29T23:59:59.999Z",
    });
    expect(pendingHistory.at(-1)?.listing.status).toBe("active");
    expect(pendingHistory.at(-1)?.observations[0]).toMatchObject({
      field: "listing_presence",
      normalized: { state: "present", value: "absent" },
    });

    await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-30T04:00:00.000Z",
      acquisitionRunId: "run-closed-day-etf-absence-suppressed",
      recordEtfAbsenceEvidence: false,
    });
    const suppressedHistory = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: transientListingId },
      effectiveAt: "2026-08-30T23:59:59.999Z",
      knowledgeAt: "2026-08-30T23:59:59.999Z",
    });
    expect(suppressedHistory).toHaveLength(2);
    expect(suppressedHistory.at(-1)?.listing.status).toBe("active");

    currentTpexTickers = ["00610", "00611", "00612"];
    await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-31T04:00:00.000Z",
      acquisitionRunId: "run-etf-reappeared",
    });
    const reappearedHistory = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: transientListingId },
      effectiveAt: "2026-08-31T23:59:59.999Z",
      knowledgeAt: "2026-08-31T23:59:59.999Z",
    });
    expect(reappearedHistory.at(-1)?.listing.status).toBe("active");
    expect(reappearedHistory.some((record) => record.listing.status === "inactive")).toBe(false);
  });

  it("enabled price acquisition: fetch official TWSE and TPEx settled snapshots → append canonical price records with full-bar, no-trade, and suspended states", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    stubActiveTaiwanCalendar(persistence);
    const twseListing = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:twse-listing", sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseCompanies },
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
    const twseFund = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:twse-fund", sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseFunds },
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
    const tpexListing = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-listing", sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexCompanies },
      row: {
        kind: "company",
        ticker: "5274",
        legalName: "信驊科技股份有限公司",
        displayName: "信驊",
        unifiedBusinessNumber: "27490748",
        industryCode: "24",
        listedAt: "2013-04-30",
      },
    });
    const suspendedTpexListing = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-suspended-listing", sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexCompanies },
      row: {
        kind: "company",
        ticker: "6488",
        legalName: "環球晶圓股份有限公司",
        displayName: "環球晶",
        unifiedBusinessNumber: "53036117",
        industryCode: "24",
        listedAt: "2011-10-31",
      },
    });
    await persistence.appendResearchIdentityRecords([twseListing, twseFund, tpexListing, suspendedTpexListing]);

    const payloads = new Map<string, unknown>([
      [OFFICIAL_PRICE_SOURCES.twsePrices, [
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
      ]],
      [OFFICIAL_PRICE_SOURCES.twseSuspensions, [{ Code: "2330", TradingHaltDate: "1150827" }]],
      [OFFICIAL_PRICE_SOURCES.tpexPrices, [
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
          SecuritiesCompanyCode: "6488",
          Date: "1150827",
          Open: "1,200",
          High: "1,250",
          Low: "1,180",
          Close: "1,230",
          TradingShares: "9,999",
          TransactionAmount: "12,345,678",
          TransactionNumber: "567",
        },
      ]],
      [OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday, [
        { SecuritiesCompanyCode: "6488", 暫停交易: "是", 恢復交易: "否" },
        { SecuritiesCompanyCode: "1788", 暫停交易: "否", 恢復交易: "是" },
      ]],
      [OFFICIAL_PRICE_SOURCES.tpexSuspensionsHistory, [
        { SecuritiesCompanyCode: "1788", DateOfSuspendedTrading: "1150618" },
        { SecuritiesCompanyCode: "1788", DateOfResumedTrading: "1150622" },
      ]],
    ]);
    const fetchImpl: typeof fetch = async (input) => new Response(JSON.stringify(payloads.get(String(input))), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

    const result = await runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T10:15:00.000Z",
      acquisitionRunId: "run-price-1",
    });

    expect(result).toMatchObject({ acquisitionRunId: "run-price-1", sourceCount: 5, recordCount: 4 });

    const twsePrices = await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: twseListing.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-27T10:15:00.000Z",
    });
    expect(twsePrices).toEqual([
      expect.objectContaining({
        listingId: twseListing.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        state: "suspended",
        provenance: expect.objectContaining({
          sourceUrl: OFFICIAL_PRICE_SOURCES.twseSuspensions,
          publisherDataset: "exchangeReport/TWTAWU",
          accessProvider: "TWSE_OPENAPI",
          acquisitionRunId: "run-price-1",
        }),
      }),
    ]);

    const noTrade = await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: twseFund.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-27T10:15:00.000Z",
    });
    expect(noTrade[0]).toMatchObject({
      state: "no_trade",
      observations: expect.arrayContaining([
        expect.objectContaining({ field: "close", normalized: { state: "present", value: "200.00" } }),
        expect.objectContaining({ field: "volume", normalized: { state: "present", value: "0" } }),
      ]),
    });

    const suspended = await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: suspendedTpexListing.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-27T10:15:00.000Z",
    });
    expect(suspended[0]).toMatchObject({
      state: "suspended",
      provenance: expect.objectContaining({
        sourceUrl: OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday,
        publisherDataset: "tpex_spendi_today",
        accessProvider: "TPEX_OPENAPI",
        acquisitionRunId: "run-price-1",
      }),
      observations: expect.arrayContaining([
        expect.objectContaining({ field: "session_state", normalized: { state: "present", value: "suspended" } }),
      ]),
    });

    payloads.set(OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday, [
      { SecuritiesCompanyCode: "5274", 暫停交易: "是", 恢復交易: "否" },
    ]);
    await runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-28T02:00:00.000Z",
      acquisitionRunId: "run-price-stale-quote",
    });
    const staleSnapshotListing = await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: tpexListing.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-28T02:00:00.000Z",
    });
    expect(staleSnapshotListing[0]).toMatchObject({
      state: "full_bar",
      provenance: {
        sourceUrl: OFFICIAL_PRICE_SOURCES.tpexPrices,
        publisherDataset: "tpex_mainboard_daily_close_quotes",
        acquisitionRunId: "run-price-stale-quote",
      },
    });
  });

  it("delayed price snapshot after ticker reuse: resolve identity at quote session → attach bar to predecessor listing", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    stubActiveTaiwanCalendar(persistence);
    const predecessor = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:predecessor", sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseCompanies },
      row: {
        kind: "company",
        ticker: "1234",
        legalName: "前手股份有限公司",
        displayName: "前手",
        unifiedBusinessNumber: "11111111",
        industryCode: "24",
        listedAt: "2010-01-01",
      },
    });
    const retiredPredecessor = appendOfficialListingStatusRevision(predecessor, {
      status: "inactive",
      effectiveDate: "2026-08-28",
      retrievedAt: "2026-08-28T02:00:00.000Z",
      acquisitionRunId: "identity-reuse",
      artifact: {
        contentHash: "sha256:retired-predecessor",
        sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseDelistings,
        publisherDataset: "company/suspendListingCsvAndHtml",
        accessProvider: "TWSE_OPENAPI",
      },
    });
    const successor = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-28",
      retrievedAt: "2026-08-28T02:00:00.000Z",
      artifact: { contentHash: "sha256:successor", sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseCompanies },
      row: {
        kind: "company",
        ticker: "1234",
        legalName: "後手股份有限公司",
        displayName: "後手",
        unifiedBusinessNumber: "22222222",
        industryCode: "24",
        listedAt: "2026-08-28",
      },
    });
    const tpexListing = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex", sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexCompanies },
      row: {
        kind: "company",
        ticker: "5274",
        legalName: "信驊科技股份有限公司",
        displayName: "信驊",
        unifiedBusinessNumber: "27490748",
        industryCode: "24",
        listedAt: "2013-04-30",
      },
    });
    await persistence.appendResearchIdentityRecords([
      predecessor,
      retiredPredecessor,
      successor,
      tpexListing,
    ]);
    const payloads = new Map<string, unknown>([
      [OFFICIAL_PRICE_SOURCES.twsePrices, [{
        Code: "1234", Date: "1150827", OpeningPrice: "10", HighestPrice: "11",
        LowestPrice: "9", ClosingPrice: "10", TradeVolume: "100", TradeValue: "1000", Transaction: "10",
      }]],
      [OFFICIAL_PRICE_SOURCES.twseSuspensions, []],
      [OFFICIAL_PRICE_SOURCES.tpexPrices, [{
        SecuritiesCompanyCode: "5274", Date: "1150827", Open: "2500", High: "2550",
        Low: "2480", Close: "2530", TradingShares: "8765", TransactionAmount: "88000000",
        TransactionNumber: "4321",
      }]],
      [OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday, []],
      [OFFICIAL_PRICE_SOURCES.tpexSuspensionsHistory, []],
    ]);
    const fetchImpl: typeof fetch = async (input) => new Response(
      JSON.stringify(payloads.get(String(input))),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-28T02:00:00.000Z",
      acquisitionRunId: "run-delayed-reused-ticker",
    });

    const predecessorPrices = await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: predecessor.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-28T02:00:00.000Z",
    });
    const successorPrices = await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: successor.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-28T02:00:00.000Z",
    });
    expect(predecessorPrices).toHaveLength(1);
    expect(predecessorPrices[0]).toMatchObject({ ticker: "1234", sessionDate: "2026-08-27" });
    expect(successorPrices).toEqual([]);

    await expect(runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-28T10:30:00.000Z",
      acquisitionRunId: "run-stale-reused-ticker",
    })).rejects.toThrow(
      "Official TWSE price snapshot is stale: expected 2026-08-28, received 2026-08-27",
    );
    expect(await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: predecessor.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-28T10:30:00.000Z",
    })).toHaveLength(1);
  });

  it("empty or incomplete price snapshot: validate every active listing before append → reject acquisition", async () => {
    setResearchRolloutOverrideForTest({ acquisitionEnabled: true });
    const persistence = new MemoryPersistence();
    stubActiveTaiwanCalendar(persistence);
    const twseListings = ["1101", "1102", "1103"].map((ticker, index) =>
      canonicalizeOfficialIdentityRow({
        venue: "TWSE",
        snapshotDate: "2026-08-27",
        retrievedAt: "2026-08-27T02:00:00.000Z",
        artifact: { contentHash: `sha256:twse-${ticker}`, sourceUrl: OFFICIAL_IDENTITY_SOURCES.twseCompanies },
        row: {
          kind: "company",
          ticker,
          legalName: `測試公司${index + 1}股份有限公司`,
          displayName: `測試${index + 1}`,
          unifiedBusinessNumber: `1234567${index}`,
          industryCode: "24",
          listedAt: "2010-01-01",
        },
      })
    );
    const tpexListing = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-complete", sourceUrl: OFFICIAL_IDENTITY_SOURCES.tpexCompanies },
      row: {
        kind: "company",
        ticker: "5274",
        legalName: "信驊科技股份有限公司",
        displayName: "信驊",
        unifiedBusinessNumber: "27490748",
        industryCode: "24",
        listedAt: "2013-04-30",
      },
    });
    await persistence.appendResearchIdentityRecords([...twseListings, tpexListing]);
    const payloads = new Map<string, unknown>([
      [OFFICIAL_PRICE_SOURCES.twsePrices, []],
      [OFFICIAL_PRICE_SOURCES.twseSuspensions, []],
      [OFFICIAL_PRICE_SOURCES.tpexPrices, [{
        SecuritiesCompanyCode: "5274", Date: "1150827", Open: "2500", High: "2550",
        Low: "2480", Close: "2530", TradingShares: "8765", TransactionAmount: "88000000",
        TransactionNumber: "4321",
      }]],
      [OFFICIAL_PRICE_SOURCES.tpexSuspensionsToday, []],
      [OFFICIAL_PRICE_SOURCES.tpexSuspensionsHistory, []],
    ]);
    const fetchImpl: typeof fetch = async (input) => new Response(
      JSON.stringify(payloads.get(String(input))),
      { status: 200, headers: { "content-type": "application/json" } },
    );

    await expect(runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T10:15:00.000Z",
      acquisitionRunId: "run-empty-price",
    })).rejects.toThrow("Official TWSE price snapshot returned no rows");

    payloads.set(OFFICIAL_PRICE_SOURCES.twsePrices, [{
      Code: "1101", Date: "1150827", OpeningPrice: "10", HighestPrice: "11",
      LowestPrice: "9", ClosingPrice: "10", TradeVolume: "100", TradeValue: "1000", Transaction: "10",
    }, {
      Code: "1102", Date: "1150826", OpeningPrice: "10", HighestPrice: "11",
      LowestPrice: "9", ClosingPrice: "10", TradeVolume: "100", TradeValue: "1000", Transaction: "10",
    }]);
    await expect(runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T10:15:00.000Z",
      acquisitionRunId: "run-mixed-date-price",
    })).rejects.toThrow(
      "Official TWSE price snapshot returned multiple session dates: 2026-08-27,2026-08-26",
    );

    payloads.set(OFFICIAL_PRICE_SOURCES.twsePrices, ["1101", "1102"].map((ticker) => ({
      Code: ticker, Date: "1150827", OpeningPrice: "10", HighestPrice: "11",
      LowestPrice: "9", ClosingPrice: "10", TradeVolume: "100", TradeValue: "1000", Transaction: "10",
    })));
    await expect(runOfficialPriceAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T10:15:00.000Z",
      acquisitionRunId: "run-truncated-price",
    })).rejects.toThrow(
      "Official TWSE price snapshot failed completeness guard: 1 of 3 active listings are absent",
    );
    expect(await persistence.listLatestResearchPriceRecords({
      subject: { kind: "listing_id", listingId: twseListings[0]!.listing.id },
      startDate: "2026-08-27",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-27T10:15:00.000Z",
    })).toEqual([]);
  });
});
