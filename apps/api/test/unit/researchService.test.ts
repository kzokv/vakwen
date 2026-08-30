import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { researchIdentityQuerySchema } from "../../src/services/research/contracts.js";
import {
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
} from "../../src/services/research/identity.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";
import { getPriceSeries, getResearchIdentity, getResearchManifest } from "../../src/services/research/service.js";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

function installAuthoritativeCalendarCoverage(persistence: MemoryPersistence): void {
  vi.spyOn(persistence, "getActiveMarketCalendarVersion").mockImplementation(async (marketCode, calendarYear) =>
    calendarYear === 2026
      ? {
          versionId: "calendar-tw-2026",
          importOperationId: "calendar-import-tw-2026",
          marketCode,
          calendarYear,
          sourceId: null,
          sourceLabel: "TW official calendar",
          sourceType: "official_source" as const,
          sourceUrl: "https://example.test/tw-calendar-2026",
          retrievedAt: "2025-12-01T00:00:00.000Z",
          coverage: { scope: "full_year" as const, evidence: "test fixture" },
          confirmedAt: "2025-12-01T00:00:00.000Z",
          invalidatedAt: null,
          invalidationReason: null,
          status: "confirmed" as const,
          isActive: true,
          annualCounts: {
            tradingDayCount: 261,
            nonTradingDayCount: 104,
            weekdayClosedCount: 0,
            weekendOpenCount: 0,
          },
          exceptions: [],
          createdAt: "2025-12-01T00:00:00.000Z",
          updatedAt: "2025-12-01T00:00:00.000Z",
        }
      : null
  );
}

describe("Taiwan research store-only service", () => {
  afterEach(() => setResearchRolloutOverrideForTest(null));

  it("identity query: select ticker and venue with a fixed context → return one immutable listing and latest known facts", async () => {
    const persistence = new MemoryPersistence();
    const first = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:first", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    const latest = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-28",
      retrievedAt: "2026-08-28T02:00:00.000Z",
      artifact: { contentHash: "sha256:latest", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company",
        ticker: "2330",
        legalName: "台灣積體電路製造股份有限公司",
        displayName: "台積電公司",
        unifiedBusinessNumber: "22099131",
        industryCode: "24",
        listedAt: "1994-09-05",
      },
    });
    await persistence.appendResearchIdentityRecords([first, latest]);

    const result = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T23:59:59.999Z",
        effectiveAt: "2026-08-28T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });

    expect(result.selector).toEqual({ kind: "listing_id", listingId: first.listing.id });
    expect(result.context).toEqual({
      knowledgeAt: "2026-08-28T23:59:59.999Z",
      effectiveAt: "2026-08-28T23:59:59.999Z",
      assessmentMode: "effective",
    });
    expect(result.identity.listing).toEqual(latest.listing);
    expect(result.identity.facts.find((fact) => fact.field === "display_name")?.normalized).toEqual({
      state: "present",
      value: "台積電公司",
    });
    expect(result.history.items).toHaveLength(2);
    expect(result.history.nextCursor).toBeNull();
  });

  it("reused ticker: resolve two effective listings on one venue → fail with explicit ambiguity", async () => {
    const persistence = new MemoryPersistence();
    const records = ["11111111", "22222222"].map((businessNumber, index) => canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: `2026-08-27T0${index + 2}:00:00.000Z`,
      artifact: { contentHash: `sha256:ambiguous-${index}`, sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company" as const,
        ticker: "1234",
        legalName: `測試公司${index}`,
        displayName: `測試${index}`,
        unifiedBusinessNumber: businessNumber,
        industryCode: "24",
        listedAt: "2020-01-01",
      },
    }));
    await persistence.appendResearchIdentityRecords(records);

    await expect(getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "1234", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    })).rejects.toMatchObject({
      code: "research_subject_ambiguous",
      metadata: { listingIds: expect.arrayContaining(records.map((record) => record.listing.id)) },
    });
  });

  it("missing subject: query the canonical store only → fail with a stable not-found state", async () => {
    await expect(getResearchIdentity(new MemoryPersistence(), {
      subject: { kind: "ticker_venue", ticker: "0000", listingVenue: "TPEX" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    })).rejects.toMatchObject({ code: "research_subject_not_found" });
  });

  it("re-evaluate assessment: policy application is unavailable → reject instead of returning persisted eligibility", async () => {
    await expect(getResearchIdentity(new MemoryPersistence(), {
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "re_evaluate",
        policySetVersion: "policy-set/does-not-exist",
      },
      history: { limit: 25 },
    })).rejects.toMatchObject({
      code: "research_assessment_mode_unsupported",
      metadata: { policySetVersion: "policy-set/does-not-exist" },
    });
  });

  it("reused ticker: retire the predecessor before reuse → resolve the sole active immutable listing", async () => {
    const persistence = new MemoryPersistence();
    const predecessor = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2019-12-31",
      retrievedAt: "2019-12-31T02:00:00.000Z",
      artifact: { contentHash: "sha256:reused-old", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234", legalName: "舊公司股份有限公司", displayName: "舊公司",
        unifiedBusinessNumber: "11111111", industryCode: "24", listedAt: "2000-01-01",
      },
    });
    const inactive = appendOfficialListingStatusRevision(predecessor, {
      status: "inactive",
      effectiveDate: "2020-01-31",
      retrievedAt: "2020-02-01T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:reused-old-inactive",
        sourceUrl: "https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml",
        publisherDataset: "company/suspendListingCsvAndHtml",
      },
    });
    const successor = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-01-02",
      retrievedAt: "2026-01-02T02:00:00.000Z",
      artifact: { contentHash: "sha256:reused-new", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234", legalName: "新公司股份有限公司", displayName: "新公司",
        unifiedBusinessNumber: "22222222", industryCode: "24", listedAt: "2026-01-02",
      },
    });
    await persistence.appendResearchIdentityRecords([predecessor, inactive, successor]);

    const current = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "1234", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-01-03T00:00:00.000Z",
        effectiveAt: "2026-01-03T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });
    const historical = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "1234", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2019-12-31T23:59:59.999Z",
        effectiveAt: "2019-12-31T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });

    expect(current.selector.listingId).toBe(successor.listing.id);
    expect(current.identity.listing.status).toBe("active");
    expect(historical.selector.listingId).toBe(predecessor.listing.id);

    const retired = await getResearchIdentity(persistence, {
      subject: { kind: "listing_id", listingId: predecessor.listing.id },
      context: {
        knowledgeAt: "2026-01-03T00:00:00.000Z",
        effectiveAt: "2026-01-03T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });
    expect(retired.identity).toMatchObject({
      listing: { status: "inactive", inactiveAt: "2020-01-31" },
      eligibility: { state: "ineligible", reasonCode: "inactive_listing" },
    });
  });

  it("history pagination: follow an opaque cursor → bind it to the immutable listing and fixed context", async () => {
    const persistence = new MemoryPersistence();
    const records = ["2026-08-27", "2026-08-28"].map((snapshotDate, index) => canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate,
      retrievedAt: `${snapshotDate}T02:00:00.000Z`,
      artifact: { contentHash: `sha256:cursor-${index}`, sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company" as const, ticker: "2330", legalName: "台灣積體電路製造股份有限公司",
        displayName: index === 0 ? "台積電" : "台積電公司", unifiedBusinessNumber: "22099131",
        industryCode: "24", listedAt: "1994-09-05",
      },
    }));
    await persistence.appendResearchIdentityRecords(records);
    const context = {
      knowledgeAt: "2026-08-29T00:00:00.000Z",
      effectiveAt: "2026-08-29T00:00:00.000Z",
      assessmentMode: "effective" as const,
    };
    const firstPage = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context,
      history: { limit: 1 },
    });
    expect(firstPage.history.nextCursor).toEqual(expect.any(String));
    expect(firstPage.history.nextCursor!.length).toBeGreaterThan(200);
    expect(researchIdentityQuerySchema.safeParse({
      subject: firstPage.selector,
      context,
      history: { limit: 1, cursor: firstPage.history.nextCursor! },
    }).success).toBe(true);

    const secondPage = await getResearchIdentity(persistence, {
      subject: firstPage.selector,
      context,
      history: { limit: 1, cursor: firstPage.history.nextCursor! },
    });
    expect(secondPage.history.items).toEqual([records[1]]);
    expect(secondPage.history.nextCursor).toBeNull();

    await expect(getResearchIdentity(persistence, {
      subject: firstPage.selector,
      context: { ...context, assessmentMode: "as_recorded" },
      history: { limit: 1, cursor: firstPage.history.nextCursor! },
    })).rejects.toMatchObject({ code: "research_cursor_invalid" });
  });

  it("history pagination: provenance includes current facts and page items without unbounded older snapshots", async () => {
    const persistence = new MemoryPersistence();
    const records = ["2026-08-26", "2026-08-27", "2026-08-28"].map((snapshotDate, index) =>
      canonicalizeOfficialIdentityRow({
        venue: "TWSE",
        snapshotDate,
        retrievedAt: `${snapshotDate}T02:00:00.000Z`,
        artifact: {
          contentHash: `sha256:bounded-provenance-${index}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
        },
        row: {
          kind: "company" as const,
          ticker: "2330",
          legalName: "台灣積體電路製造股份有限公司",
          displayName: `台積電${index}`,
          unifiedBusinessNumber: "22099131",
          industryCode: "24",
          listedAt: "1994-09-05",
        },
      })
    );
    await persistence.appendResearchIdentityRecords(records);

    const result = await getResearchIdentity(persistence, {
      subject: { kind: "listing_id", listingId: records[0]!.listing.id },
      context: {
        knowledgeAt: "2026-08-29T00:00:00.000Z",
        effectiveAt: "2026-08-29T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 1 },
    });

    expect(result.history.items).toEqual([records[0]]);
    expect(result.identity.provenance.map((provenance) => provenance.id)).toEqual([
      records[0]!.provenance.id,
      records[2]!.provenance.id,
    ]);
  });

  it("identity history: request one page → use bounded latest-revision and keyset page reads", async () => {
    const persistence = new MemoryPersistence();
    const records = ["2026-08-25", "2026-08-26", "2026-08-27"].map((snapshotDate, index) =>
      canonicalizeOfficialIdentityRow({
        venue: "TWSE",
        snapshotDate,
        retrievedAt: `${snapshotDate}T02:00:00.000Z`,
        artifact: {
          contentHash: `sha256:bounded-page-${index}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
        },
        row: {
          kind: "company" as const,
          ticker: "2330",
          legalName: "台灣積體電路製造股份有限公司",
          displayName: `台積電${index}`,
          unifiedBusinessNumber: "22099131",
          industryCode: "24",
          listedAt: "1994-09-05",
        },
      })
    );
    await persistence.appendResearchIdentityRecords(records);
    const unboundedSpy = vi.spyOn(persistence, "listResearchIdentityRecords");
    const latestSpy = vi.spyOn(persistence, "listResearchIdentityLatestRevisions");
    const pageSpy = vi.spyOn(persistence, "listResearchIdentityHistoryPage");
    const context = {
      knowledgeAt: "2026-08-28T00:00:00.000Z",
      effectiveAt: "2026-08-28T00:00:00.000Z",
      assessmentMode: "effective" as const,
    };

    const firstPage = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "2330", listingVenue: "TWSE" },
      context,
      history: { limit: 1 },
    });
    expect(unboundedSpy).not.toHaveBeenCalled();
    expect(latestSpy).toHaveBeenCalledTimes(1);
    expect(pageSpy).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 2 }));

    await getResearchIdentity(persistence, {
      subject: firstPage.selector,
      context,
      history: { limit: 1, cursor: firstPage.history.nextCursor! },
    });
    expect(pageSpy).toHaveBeenLastCalledWith(expect.objectContaining({
      limit: 2,
      after: expect.objectContaining({ recordKey: expect.any(String) }),
    }));
  });

  it("ticker correction: resolve the current ticker → return the immutable listing's earlier ticker history", async () => {
    const persistence = new MemoryPersistence();
    const original = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-26",
      retrievedAt: "2026-08-26T02:00:00.000Z",
      artifact: { contentHash: "sha256:old-ticker", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234", legalName: "測試股份有限公司", displayName: "測試",
        unifiedBusinessNumber: "11112222", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    const corrected = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:new-ticker", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234A", legalName: "測試股份有限公司", displayName: "測試",
        unifiedBusinessNumber: "11112222", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    await persistence.appendResearchIdentityRecords([original, corrected]);

    const result = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "1234A", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });

    expect(result.selector.listingId).toBe(original.listing.id);
    expect(result.history.items.map((record) => record.listing.ticker)).toEqual(["1234", "1234A"]);

    await expect(getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "1234", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    })).rejects.toMatchObject({ code: "research_subject_not_found" });
  });

  it("ticker correction and reassignment: query the effective ticker → resolve only its new immutable listing", async () => {
    const persistence = new MemoryPersistence();
    const original = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-26",
      retrievedAt: "2026-08-26T02:00:00.000Z",
      artifact: { contentHash: "sha256:reassigned-old", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234", legalName: "原測試股份有限公司", displayName: "原測試",
        unifiedBusinessNumber: "11112222", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    const corrected = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:reassigned-corrected", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234A", legalName: "原測試股份有限公司", displayName: "原測試",
        unifiedBusinessNumber: "11112222", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    const successor = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T03:00:00.000Z",
      artifact: { contentHash: "sha256:reassigned-successor", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "1234", legalName: "新測試股份有限公司", displayName: "新測試",
        unifiedBusinessNumber: "33334444", industryCode: "24", listedAt: "2026-08-27",
      },
    });
    await persistence.appendResearchIdentityRecords([original, corrected, successor]);

    const result = await getResearchIdentity(persistence, {
      subject: { kind: "ticker_venue", ticker: "1234", listingVenue: "TWSE" },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
      history: { limit: 25 },
    });

    expect(result.selector.listingId).toBe(successor.listing.id);
    expect(result.identity.facts.find((fact) => fact.field === "legal_name")?.normalized).toMatchObject({
      state: "present",
      value: "新測試股份有限公司",
    });
  });

  it("identity-only manifest: resolve a supported listing → report all eleven dataset statuses without embedding dataset payloads", async () => {
    setResearchRolloutOverrideForTest({ skillExposureEnabled: false });
    const persistence = new MemoryPersistence();
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:manifest", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    const unboundedSpy = vi.spyOn(persistence, "listResearchIdentityRecords");
    const latestSpy = vi.spyOn(persistence, "listResearchIdentityLatestRevisions");
    const pageSpy = vi.spyOn(persistence, "listResearchIdentityHistoryPage");

    const manifest = await getResearchManifest(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T00:00:00.000Z",
        effectiveAt: "2026-08-28T00:00:00.000Z",
        assessmentMode: "effective",
      },
    });

    expect(manifest.datasets.map((dataset) => dataset.id)).toEqual([
      "research_identity",
      "price_series",
      "exchange_valuation_references",
      "monthly_revenue",
      "financial_statements",
      "institutional_trading",
      "foreign_ownership",
      "margin_and_short_balances",
      "dividend_events",
      "material_announcements",
      "investor_materials",
    ]);
    expect(manifest.datasets[0]).toEqual({ id: "research_identity", status: "available" });
    expect(manifest.datasets.slice(1).every((dataset) => dataset.status === "unavailable")).toBe(true);
    expect(manifest).not.toHaveProperty("observations");
    expect(manifest.orchestration).toEqual({ skillExposure: "disabled" });
    expect(unboundedSpy).not.toHaveBeenCalled();
    expect(latestSpy).toHaveBeenCalledTimes(1);
    expect(pageSpy).toHaveBeenCalledWith(expect.objectContaining({ limit: 2 }));
  });

  it("price-series manifest and service: read stored TWSE bars only → expose price availability, lineage, and no write-side effects", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:price-series", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchPriceRecords([
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        retrievedAt: "2026-08-26T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:price-0826",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "100",
          high: "103",
          low: "99",
          close: "101",
          volume: "1000",
          tradedValue: "100000",
          tradeCount: "100",
        },
      }),
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        retrievedAt: "2026-08-27T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:price-0827",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "101",
          high: "104",
          low: "100",
          close: "102",
          volume: "1100",
          tradedValue: "110000",
          tradeCount: "110",
        },
      }),
    ]);

    const sessionDatesSpy = vi.spyOn(persistence, "getDistinctResearchPriceSessionDates");
    const priceRecordsSpy = vi.spyOn(persistence, "listLatestResearchPriceRecords");
    const appendSpy = vi.spyOn(persistence, "appendResearchIdentityRecords");

    const query = {
      subject: { kind: "listing_id" as const, listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-27T12:00:00.000Z",
        effectiveAt: "2026-08-27T12:00:00.000Z",
        assessmentMode: "effective" as const,
      },
      scope: { kind: "latest_sessions" as const, count: 2 },
      basis: "raw" as const,
      order: "asc" as const,
      page: { limit: 2 },
      metrics: [{ id: "simple_price_return" as const, windowSessions: 2 }],
    };

    const manifest = await getResearchManifest(persistence, {
      subject: query.subject,
      context: query.context,
    });
    const series = await getPriceSeries(persistence, query);

    expect(manifest.datasets[1]).toMatchObject({ id: "price_series", status: "available" });
    expect(series.sessions).toMatchObject([
      { state: "settled_full_bar", sessionDate: "2026-08-26" },
      { state: "settled_full_bar", sessionDate: "2026-08-27" },
    ]);
    expect(series.metrics).toMatchObject([{
      status: "returned",
      id: "simple_price_return",
      windowSessions: 2,
      observationInputs: ["2026-08-26", "2026-08-27"],
      formulaId: "simple_price_return",
      formulaVersion: "1.0.0",
    }]);
    expect(series.freshness).toEqual({ state: "current", authoritativeAsOf: "2026-08-27" });
    expect(sessionDatesSpy).toHaveBeenCalledWith("TWSE", "1994-09-05", "2026-08-27T12:00:00.000Z");
    expect(priceRecordsSpy).toHaveBeenCalledWith({
      subject: { kind: "listing_id", listingId: record.listing.id },
      startDate: "2026-08-26",
      endDate: "2026-08-27",
      knowledgeAt: "2026-08-27T12:00:00.000Z",
    });
    expect(appendSpy).not.toHaveBeenCalled();
  });

  it("price-series pagination: mutate the bound page limit → reject the follow-up cursor", async () => {
    const persistence = new MemoryPersistence();
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:price-cursor", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchPriceRecords(["2026-08-25", "2026-08-26", "2026-08-27"].map((sessionDate, index) =>
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate,
        retrievedAt: `${sessionDate}T10:00:00.000Z`,
        artifact: {
          contentHash: `sha256:page-${index}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: String(100 + index),
          high: String(101 + index),
          low: String(99 + index),
          close: String(100 + index),
          volume: String(900 + (index * 50)),
          tradedValue: String(100000 + (index * 5000)),
          tradeCount: String(100 + (index * 10)),
        },
      })
    ));

    const baseQuery = {
      subject: { kind: "listing_id" as const, listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-27T20:00:00.000Z",
        effectiveAt: "2026-08-27T20:00:00.000Z",
        assessmentMode: "effective" as const,
      },
      scope: { kind: "latest_sessions" as const, count: 3 },
      basis: "raw" as const,
      order: "desc" as const,
      page: { limit: 1 },
      metrics: [],
    };

    const firstPage = await getPriceSeries(persistence, baseQuery);
    expect(firstPage.page.nextCursor).toEqual(expect.any(String));

    await expect(getPriceSeries(persistence, {
      ...baseQuery,
      page: { limit: 2, cursor: firstPage.page.nextCursor! },
    })).rejects.toMatchObject({ code: "research_cursor_invalid" });
  });

  it("price-series historical effective context: freeze sessions by effectiveAt but suppress freshness assessment against later knowledgeAt", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:historical-effective", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchPriceRecords([
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-26",
        retrievedAt: "2026-08-26T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:historical-effective-0826",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "99",
          high: "100",
          low: "98",
          close: "99",
          volume: "900",
          tradedValue: "89100",
          tradeCount: "9",
        },
      }),
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        retrievedAt: "2026-08-27T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:historical-effective-0827",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "100",
          high: "101",
          low: "99",
          close: "100",
          volume: "1000",
          tradedValue: "100000",
          tradeCount: "10",
        },
      }),
    ]);

    const latest = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-30T15:00:00.000Z",
        effectiveAt: "2026-08-27T08:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });
    const historicalRange = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-30T15:00:00.000Z",
        effectiveAt: "2026-08-27T08:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "date_range", startDate: "2026-08-20", endDate: "2026-08-30" },
      basis: "raw",
      order: "asc",
      page: { limit: 10 },
      metrics: [],
    });

    expect(latest.sessions).toMatchObject([{ sessionDate: "2026-08-26", state: "settled_full_bar" }]);
    expect(latest.freshness).toEqual({ state: "not_applicable", authoritativeAsOf: "2026-08-28" });
    expect(historicalRange.sessions.at(-1)).toMatchObject({ sessionDate: "2026-08-26", state: "settled_full_bar" });
    expect(historicalRange.freshness).toEqual({ state: "not_applicable", authoritativeAsOf: "2026-08-28" });
  });

  it("price-series stale latest: miss the due session while older bars exist → keep the latest available date visible", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const record = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:stale-price", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
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
    await persistence.appendResearchIdentityRecords([record]);
    await persistence.appendResearchPriceRecords([
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "5274",
        venue: "TPEX",
        sessionDate: "2026-08-26",
        retrievedAt: "2026-08-26T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:tpex-stale-0826",
          sourceUrl: "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes",
          publisherDataset: "tpex_mainboard_daily_close_quotes",
          accessProvider: "TPEX_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "100",
          high: "101",
          low: "99",
          close: "100",
          volume: "800",
          tradedValue: "80000",
          tradeCount: "80",
        },
      }),
    ]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T12:00:00.000Z",
        effectiveAt: "2026-08-28T12:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest" },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });

    expect(result.freshness).toEqual({ state: "due_pending", authoritativeAsOf: "2026-08-28" });
    expect(result.sessions).toEqual([{
      state: "missing",
      sessionDate: "2026-08-28",
      reasonCode: "missing_authoritative_price",
    }]);
  });

  it("price-series latest sessions: derive expected Taiwan session boundaries without unrelated venue rows → include the missing latest completed session", async () => {
    const persistence = new MemoryPersistence();
    installAuthoritativeCalendarCoverage(persistence);
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:latest-sessions", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchPriceRecords([
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate: "2026-08-27",
        retrievedAt: "2026-08-27T10:00:00.000Z",
        artifact: {
          contentHash: "sha256:latest-sessions-0827",
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: "101",
          high: "104",
          low: "100",
          close: "102",
          volume: "1100",
          tradedValue: "110000",
          tradeCount: "110",
        },
      }),
    ]);

    const result = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-28T15:00:00.000Z",
        effectiveAt: "2026-08-28T15:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "asc",
      page: { limit: 2 },
      metrics: [],
    });

    expect(result.freshness).toEqual({ state: "stale", authoritativeAsOf: "2026-08-28" });
    expect(result.sessions).toEqual([
      expect.objectContaining({ state: "settled_full_bar", sessionDate: "2026-08-27" }),
      {
        state: "stale",
        sessionDate: "2026-08-28",
        latestAvailableDate: "2026-08-27",
        reasonCode: "authoritative_close_overdue",
      },
    ]);
  });

  it("price-series adjusted basis and TSR: with no canonical corporate-action facts → withhold adjusted sessions and total shareholder return", async () => {
    const persistence = new MemoryPersistence();
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:adjusted-basis", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchPriceRecords(["2026-08-26", "2026-08-27"].map((sessionDate, index) =>
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate,
        retrievedAt: `${sessionDate}T10:00:00.000Z`,
        artifact: {
          contentHash: `sha256:adjusted-basis-${index}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: String(100 + index),
          high: String(103 + index),
          low: String(99 + index),
          close: String(101 + index),
          volume: String(1000 + (index * 100)),
          tradedValue: String(100000 + (index * 10000)),
          tradeCount: String(100 + (index * 10)),
        },
      })
    ));
    const dividendsSpy = vi.spyOn(persistence, "listDividendEventsForTickerMarket");

    const adjusted = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-27T12:00:00.000Z",
        effectiveAt: "2026-08-27T12:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "corporate_action_adjusted",
      order: "asc",
      page: { limit: 2 },
      metrics: [{ id: "total_shareholder_return", windowSessions: 2 }],
    });

    expect(adjusted.basisPolicy).toEqual({
      id: "taiwan-authoritative-stock-actions/1.0.0",
      status: "incomplete",
    });
    expect(adjusted.sessions).toEqual([
      {
        state: "corporate_action_incomplete",
        sessionDate: "2026-08-26",
        close: 101,
        missingInputs: ["canonical_verified_corporate_actions_unavailable"],
      },
      {
        state: "corporate_action_incomplete",
        sessionDate: "2026-08-27",
        close: 102,
        missingInputs: ["canonical_verified_corporate_actions_unavailable"],
      },
    ]);
    expect(adjusted.metrics).toEqual([{
      status: "withheld",
      id: "total_shareholder_return",
      windowSessions: 2,
      reasonCode: "corporate_action_incomplete",
    }]);
    expect(dividendsSpy).not.toHaveBeenCalled();
  });

  it("price-series pagination: mutate the fixed temporal context → reject the follow-up cursor", async () => {
    const persistence = new MemoryPersistence();
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:price-cursor-context", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
    await persistence.appendResearchPriceRecords(["2026-08-26", "2026-08-27"].map((sessionDate, index) =>
      canonicalizeOfficialPriceRow({
        listingId: record.listing.id,
        ticker: "2330",
        venue: "TWSE",
        sessionDate,
        retrievedAt: `${sessionDate}T10:00:00.000Z`,
        artifact: {
          contentHash: `sha256:price-cursor-context-${index}`,
          sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
          publisherDataset: "exchangeReport/STOCK_DAY_ALL",
          accessProvider: "TWSE_OPENAPI",
        },
        row: {
          state: "full_bar",
          open: String(100 + index),
          high: String(101 + index),
          low: String(99 + index),
          close: String(100 + index),
          volume: String(900 + (index * 50)),
          tradedValue: String(100000 + (index * 5000)),
          tradeCount: String(100 + (index * 10)),
        },
      })
    ));
    const firstPage = await getPriceSeries(persistence, {
      subject: { kind: "listing_id", listingId: record.listing.id },
      context: {
        knowledgeAt: "2026-08-27T20:00:00.000Z",
        effectiveAt: "2026-08-27T20:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1 },
      metrics: [],
    });

    await expect(getPriceSeries(persistence, {
      subject: firstPage.selector,
      context: {
        knowledgeAt: "2026-08-27T20:00:00.000Z",
        effectiveAt: "2026-08-27T19:00:00.000Z",
        assessmentMode: "effective",
      },
      scope: { kind: "latest_sessions", count: 2 },
      basis: "raw",
      order: "desc",
      page: { limit: 1, cursor: firstPage.page.nextCursor! },
      metrics: [],
    })).rejects.toMatchObject({ code: "research_cursor_invalid" });
  });
});
