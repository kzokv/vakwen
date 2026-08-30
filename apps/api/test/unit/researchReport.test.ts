import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import {
  researchFocusedMarketReportSchema,
  researchIdentityOnlyReportSchema,
} from "../../src/services/research/contracts.js";
import {
  buildFocusedMarketResearchReport,
  buildIdentityOnlyResearchReport,
  renderFocusedMarketResearchReportMarkdown,
  renderIdentityOnlyResearchReportMarkdown,
} from "../../src/services/research/report.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";

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
    await persistence.appendResearchPriceRecords([priceRecord]);

    const report = await buildFocusedMarketResearchReport(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-27T11:00:00.000Z",
        effectiveAt: "2026-08-27T11:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 10 },
      metrics: [],
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
    expect(report.evidence.provenanceIds).toEqual([priceRecord.provenance.id]);
    expect(report.evidence.sessionDates).toEqual(["2026-08-27"]);
    expect(markdown).toContain("# Taiwan Market Research: 台積電");
    expect(markdown).toContain("- Listing: TWSE:2330");
    expect(markdown).toContain("- Session 2026-08-27: settled_full_bar close 972");
    expect(markdown).toContain("## Provenance");
    expect(markdown).toContain(`- ${priceRecord.provenance.id}`);
  });
});
