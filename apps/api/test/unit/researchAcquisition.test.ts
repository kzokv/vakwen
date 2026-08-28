import { afterEach, describe, expect, it } from "vitest";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  OFFICIAL_IDENTITY_SOURCES,
  runOfficialIdentityAcquisition,
} from "../../src/services/research/acquisition.js";

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
        data: [{ issuerID: "5801", listingDate: "20260826", stockName: "第一金主動式台灣成長", stockNo: "00999A" }],
      }],
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
      [OFFICIAL_IDENTITY_SOURCES.twseDelistings, [{
        DelistingDate: "2026/08/26", Company: "既有下市股份有限公司", Code: "9999",
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
    await persistence.appendResearchIdentityRecords([existing, beforeTransfer, retiredTpex]);

    const result = await runOfficialIdentityAcquisition(persistence, {
      fetchImpl,
      retrievedAt: "2026-08-27T04:00:00.000Z",
      acquisitionRunId: "run-test-1",
    });

    expect(requested.sort()).toEqual([
      ...Object.values(OFFICIAL_IDENTITY_SOURCES).filter((url) => url !== OFFICIAL_IDENTITY_SOURCES.tpexDelistings),
      ...tpexDelistingUrls,
    ].sort());
    expect(requests.find(({ url }) => url === OFFICIAL_IDENTITY_SOURCES.tpexFunds)?.method).toBe("POST");
    expect(result).toMatchObject({ sourceCount: 8, recordCount: 10, acquisitionRunId: "run-test-1" });
    const etn = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "020032", venue: "TWSE" },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    });
    expect(etn[0]?.eligibility.profile).toBe("identity_only");
    const inactive = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: existing.listing.id },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    });
    expect(inactive.at(-1)?.listing.status).toBe("inactive");
    const reusedTicker = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "9999", venue: "TWSE" },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    });
    expect(reusedTicker.find((record) => record.listing.listedAt === "2026-08-27")?.listing.status).toBe("active");
    const transferred = await persistence.listResearchIdentityRecords({
      subject: { kind: "ticker_venue", ticker: "2330", venue: "TWSE" },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    });
    expect(transferred.at(-1)?.listing.predecessorListingId).toBe(beforeTransfer.listing.id);
    const retiredTpexHistory = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: retiredTpex.listing.id },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
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
  });
});
