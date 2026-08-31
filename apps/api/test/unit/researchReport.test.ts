import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  researchFocusedMarketReportSchema,
  researchIdentityOnlyReportSchema,
  researchRevenueFocusedReportSchema,
} from "../../src/services/research/contracts.js";
import {
  buildFocusedMarketResearchReport,
  buildIdentityOnlyResearchReport,
  buildRevenueFocusedResearchReport,
  renderFocusedMarketResearchReportMarkdown,
  renderIdentityOnlyResearchReportMarkdown,
} from "../../src/services/research/report.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";
import { canonicalizeOfficialMonthlyRevenueRow } from "../../src/services/research/monthlyRevenue.js";

describe("identity-only Taiwan ResearchReport", () => {
  it("canonical report: build from stored identity → render only report-carried claims with provenance references", async () => {
    const persistence = new MemoryPersistence();
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:report", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchIdentityRecords([record]);

    const report = await buildIdentityOnlyResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });
    const markdown = renderIdentityOnlyResearchReportMarkdown(report);

    expect(report).toMatchObject({
      contractVersion: "research-report/1.0.0",
      profile: "identity_only",
      selector: { kind: "listing_id", listingId: record.listing.id },
      sections: [
        { id: "identity" },
        { id: "eligibility" },
        { id: "unsupported_scope", reasonCode: "identity_only_release" },
      ],
    });
    expect(report.evidence.provenanceIds).toEqual([record.provenance.id]);
    expect(researchIdentityOnlyReportSchema.parse(report)).toEqual(report);
    expect(markdown).toBe([
      "# Taiwan Identity Research: 台積電",
      "",
      `- Listing: TWSE:2330`,
      `- Listing ID: ${record.listing.id}`,
      "- Legal name: 台灣積體電路製造股份有限公司",
      "- Security type: common_equity",
      "- Industry code: 24",
      "- Eligibility: eligible (operating_company; supported_common_equity)",
      "- Effective at: 2026-08-28T00:00:00.000Z",
      "- Knowledge at: 2026-08-28T00:00:00.000Z",
      "",
      "## Scope",
      "",
      report.sections[2]!.statement,
      "",
      "## Provenance",
      "",
      `- ${record.provenance.id}`,
    ].join("\n"));
    expect(() => researchIdentityOnlyReportSchema.parse({
      ...report,
      generatedAt: "2026-08-29T00:00:00.000Z",
    })).toThrow();
  });

  it("focused market report: build from stored identity and settled prices → render only report-carried market context", async () => {
    const persistence = new MemoryPersistence();
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:focused-market", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchIdentityRecords([record]);
    const olderPriceRecord = canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        retrievedAt: "2026-08-26T10:15:00.000Z",
        artifact: {
          contentHash: "sha256:focused-market-price-older",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "960",
          high: "965",
          low: "955",
          close: "962",
          volume: "120000",
          tradedValue: "115000000",
          tradeCount: "12000",
        },
      });
    const priceRecord = canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        retrievedAt: "2026-08-27T10:15:00.000Z",
        artifact: {
          contentHash: "sha256:focused-market-price",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "970",
          high: "975",
          low: "965",
          close: "972",
          volume: "123456",
          tradedValue: "120000000",
          tradeCount: "12345",
        },
      });
    await persistence.appendResearchPriceRecords([olderPriceRecord, priceRecord]);

    const report = await buildFocusedMarketResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-27T11:00:00.000Z",
        effectiveAt: "2026-08-27T11:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [{ id: "simple_price_return", windowSessions: 2 }],
    });
    const markdown = renderFocusedMarketResearchReportMarkdown(report);

    expect(report).toMatchObject({
      contractVersion: "research-report/1.0.0",
      profile: "focused_market",
      selector: { kind: "listing_id", listingId: record.listing.id },
      sections: [
        { id: "identity", listing: { ticker: "2330", venue: "TWSE" } },
        {
          id: "market_context",
          indicativePricesExcluded: true,
          intradayPricesExcluded: true,
          technicalSignalsExcluded: true,
          priceSeries: {
            contractVersion: "research-price-series/1.0.0",
            sessions: [
              {
                state: "settled_full_bar",
                sessionDate: "2026-08-27",
              },
            ],
          },
        },
      ],
    });
    expect(researchFocusedMarketReportSchema.parse(report)).toEqual(report);
    expect(report.selector).toEqual({ kind: "listing_id", listingId: record.listing.id });
    expect(report.context).toEqual({
      knowledgeAt: "2026-08-27T11:00:00.000Z",
      effectiveAt: "2026-08-27T11:00:00.000Z",
      assessmentMode: "effective",
    });
    expect(report.evidence.provenanceIds).toEqual([
      record.provenance.id,
      priceRecord.provenance.id,
      olderPriceRecord.provenance.id,
    ]);
    expect(report.evidence.sessionDates).toEqual(["2026-08-27"]);
    expect(markdown).toContain("# Taiwan Market Research: 台積電");
    expect(markdown).toContain("- Listing: TWSE:2330");
    expect(markdown).toContain("- Session 2026-08-27: settled_full_bar close 972");
    expect(markdown).toContain("## Provenance");
    expect(markdown).toContain(`- ${priceRecord.provenance.id}`);
    expect(markdown).toContain(`- ${olderPriceRecord.provenance.id}`);
  });

  it("focused market report: reject when the manifest does not expose an available price series", async () => {
    const persistence = new MemoryPersistence();
    const companyWithoutPrices = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:no-price-report", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2317",
        legalName: "鴻海精密工業股份有限公司",
        displayName: "鴻海",
        unifiedBusinessNumber: "04541302",
        industryCode: "31",
        listedAt: "1991-06-18",
      },
    });
    const identityOnlyEtn = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:identity-only-report", sourceUrl: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json" },
      row: {
        kind: "etn",
        ticker: "020032",
        legalName: "元大證券股份有限公司",
        displayName: "元大綠能N",
        identityKey: "twse-etn:020032:2024-02-01",
        issuerIdentityKey: "97160609",
        noteType: "ETN",
        listedAt: "2024-02-01",
      },
    });
    await persistence.appendResearchIdentityRecords([companyWithoutPrices, identityOnlyEtn]);
    await persistence.appendResearchPriceRecords([canonicalizeOfficialPriceRow({
      listingId: identityOnlyEtn.listing.id,
      ticker: "020032",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      retrievedAt: "2026-08-27T10:15:00.000Z",
      artifact: {
        contentHash: "sha256:identity-only-price",
        sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        publisherDataset: "exchangeReport/STOCK_DAY_ALL",
        accessProvider: "TWSE_OPENAPI",
      },
      row: { state: "close_only", close: "7.12" },
    })]);
    const commonQuery = {
      context: {
        knowledgeAt: "2026-08-27T11:00:00.000Z",
        effectiveAt: "2026-08-27T11:00:00.000Z",
        assessmentMode: "effective" as const,
      },
      scope: { kind: "latest" as const },
      basis: "raw" as const,
      order: "desc" as const,
      page: { limit: 10 },
      metrics: [],
    };

    await expect(buildFocusedMarketResearchReport(persistence, {
      ...commonQuery,
      subject: { kind: "listing_id", listingId: companyWithoutPrices.listing.id },
    })).rejects.toMatchObject({
      code: "research_dataset_unavailable",
      metadata: { datasetId: "price_series", reasonCode: "no_authoritative_price_history" },
    });
    await expect(buildFocusedMarketResearchReport(persistence, {
      ...commonQuery,
      subject: { kind: "listing_id", listingId: identityOnlyEtn.listing.id },
    })).rejects.toMatchObject({
      code: "research_dataset_unavailable",
      metadata: { datasetId: "price_series", reasonCode: "identity_only_profile" },
    });
  });

  it("monthly revenue report: build a focused conclusion without crossing into recommendation language", async () => {
    const persistence = new MemoryPersistence();
    const identity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:report-revenue", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchIdentityRecords([identity]);
    for (const [index, revenueMonth] of ["2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2024-08", "2024-09", "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03", "2025-04", "2025-05", "2025-06", "2025-07"].entries()) {
      const [year, month] = revenueMonth.split("-").map(Number);
      const rocYear = year - 1911;
      await persistence.appendResearchMonthlyRevenueRecords([canonicalizeOfficialMonthlyRevenueRow({
        venue: "TWSE",
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: "2330",
        companyName: "台積電",
        industryName: "半導體業",
        revenueMonth,
        rawRevenueMonth: `${rocYear}${String(month).padStart(2, "0")}`,
        publishedAt: revenueMonth === "2026-07" ? "2026-08-17" : `${year}-${String((month % 12) + 1).padStart(2, "0")}-10`,
        rawPublishedAt: revenueMonth === "2026-07" ? "1150817" : `${rocYear}${String((month % 12) + 1).padStart(2, "0")}10`,
        retrievedAt: `2026-08-${String((index % 20) + 1).padStart(2, "0")}T02:00:00.000Z`,
        artifact: {
          contentHash: `sha256:rev-${revenueMonth}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
          publisherDataset: "t187ap05_L",
          accessProvider: "TWSE_OPENAPI",
        },
        source: {
          currentMonthRevenue: String(1000 + index * 10),
          priorMonthRevenue: String(990 + index * 10),
          priorYearSameMonthRevenue: String(900 + index * 10),
          monthOverMonthPercent: "1.01",
          yearOverYearPercent: "11.11",
          currentYearToDateRevenue: String(10000 + index * 100),
          priorYearToDateRevenue: String(9000 + index * 100),
          yearToDateYearOverYearPercent: "11.11",
          note: "合併營收",
        },
      })]);
    }

    const report = await buildRevenueFocusedResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });

    expect(researchRevenueFocusedReportSchema.parse(report)).toEqual(report);
    expect(report.profile).toBe("monthly_revenue");
    expect(report.conclusion.status).toBe("supported");
    expect(report.sections[2].latestRecord).toMatchObject({
      revenueMonth: "2026-07",
      publicationContext: {
        rawPublishedAt: "1150817",
        declaredUnit: "TWD_THOUSANDS",
        basis: "consolidated",
      },
      sourceFacts: {
        currentMonthRevenue: {
          raw: "1110",
          normalized: { state: "present", value: "1110" },
        },
        publisherComparisons: {
          yearOverYearPercent: {
            raw: "11.11",
            normalized: { state: "present", value: "11.11" },
          },
        },
      },
    });
    expect(report.evidence.provenanceIds).toContain(identity.provenance.id);
    expect(report.evidence.provenanceIds.length).toBeGreaterThan(1);
    expect(report.conclusion.statement.toLowerCase()).not.toContain("buy");
    expect(report.conclusion.statement.toLowerCase()).not.toContain("target price");
    expect(() => researchRevenueFocusedReportSchema.parse({
      ...report,
      sections: [report.sections[0], report.sections[0], report.sections[0]],
    })).toThrow();
    expect(() => researchRevenueFocusedReportSchema.parse({
      ...report,
      generatedAt: "2026-08-29T00:00:00.000Z",
    })).toThrow();
  });

  it("monthly revenue report: unavailable manifest dataset → reject instead of emitting an empty revenue profile", async () => {
    const persistence = new MemoryPersistence();
    const identity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:report-revenue-unavailable", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2317",
        legalName: "鴻海精密工業股份有限公司",
        displayName: "鴻海",
        unifiedBusinessNumber: "04541302",
        industryCode: "31",
        listedAt: "1991-06-18",
      },
    });
    await persistence.appendResearchIdentityRecords([identity]);

    await expect(buildRevenueFocusedResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    })).rejects.toMatchObject({
      code: "research_dataset_unavailable",
      metadata: { datasetId: "monthly_revenue", reasonCode: "not_acquired" },
    });
  });

  it("monthly revenue report: withhold the conclusion when the latest due month is missing → keep the scope descriptive", async () => {
    const persistence = new MemoryPersistence();
    const identity = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:report-revenue-gap", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchIdentityRecords([identity]);
    for (const revenueMonth of ["2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06"]) {
      const [year, month] = revenueMonth.split("-").map(Number);
      const rocYear = year - 1911;
      await persistence.appendResearchMonthlyRevenueRecords([canonicalizeOfficialMonthlyRevenueRow({
        venue: "TWSE",
        listingId: identity.listing.id,
        issuerId: identity.issuer.id,
        ticker: "2330",
        companyName: "台積電",
        industryName: "半導體業",
        revenueMonth,
        rawRevenueMonth: `${rocYear}${String(month).padStart(2, "0")}`,
        publishedAt: `${year}-${String((month % 12) + 1).padStart(2, "0")}-10`,
        rawPublishedAt: `${rocYear}${String((month % 12) + 1).padStart(2, "0")}10`,
        retrievedAt: `2026-08-${String((month % 9) + 1).padStart(2, "0")}T02:00:00.000Z`,
        artifact: {
          contentHash: `sha256:gap-${revenueMonth}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap05_L",
          publisherDataset: "t187ap05_L",
          accessProvider: "TWSE_OPENAPI",
        },
        source: {
          currentMonthRevenue: String(1000 + month * 10),
          priorMonthRevenue: String(990 + month * 10),
          priorYearSameMonthRevenue: String(900 + month * 10),
          monthOverMonthPercent: "1.01",
          yearOverYearPercent: "11.11",
          currentYearToDateRevenue: String(5000 + month * 100),
          priorYearToDateRevenue: String(4500 + month * 100),
          yearToDateYearOverYearPercent: "11.11",
          note: "合併營收",
        },
      })]);
    }

    const report = await buildRevenueFocusedResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: identity.listing.id },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });

    expect(report.conclusion).toMatchObject({
      status: "withheld",
      reasonCodes: ["latest_due_gap"],
    });
    expect(report.conclusion.statement.toLowerCase()).not.toContain("sell");
    expect(report.conclusion.statement.toLowerCase()).not.toContain("forecast");
  });
});
