import { afterEach, describe, expect, it, vi } from "vitest";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  OFFICIAL_IDENTITY_SOURCES,
  runOfficialIdentityAcquisition,
} from "../../src/services/research/acquisition.js";
import {
  canonicalizeOfficialIdentityRow,
  officialFundProductIdentityKey,
} from "../../src/services/research/identity.js";
import { getResearchIdentity } from "../../src/services/research/service.js";

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
    const listLatestSpy = vi.spyOn(persistence, "listLatestResearchIdentityRecords");

    const result = await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T18:15:00.000Z",
      acquisitionRunId: "run-test-1",
    });
    expect(listHistorySpy).not.toHaveBeenCalled();
    expect(listLatestSpy).toHaveBeenCalledTimes(2);

    expect(requested.sort()).toEqual([
      ...Object.values(OFFICIAL_IDENTITY_SOURCES).filter((url) => url !== OFFICIAL_IDENTITY_SOURCES.tpexDelistings),
      ...tpexDelistingUrls,
    ].sort());
    expect(requests.find(({ url }) => url === OFFICIAL_IDENTITY_SOURCES.tpexFunds)?.method).toBe("POST");
    expect(result).toMatchObject({ sourceCount: 11, recordCount: 16, acquisitionRunId: "run-test-1" });
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

    for (const [listingId, inactiveAt, accessProvider] of [
      [absentTwseEtf.listing.id, "2026-08-28", "TWSE_OPENAPI"],
      [absentTpexEtf.listing.id, "2026-08-28", "TPEX_WEB_JSON"],
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
          data: [{ issuerID: "issuer-0", issuer: "歷史投信 0", listingDate: "20200101", stockName: "歷史ETF 00610", stockNo: "00610" }],
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
  });
});
