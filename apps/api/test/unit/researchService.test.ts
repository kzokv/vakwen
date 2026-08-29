import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { researchIdentityQuerySchema } from "../../src/services/research/contracts.js";
import {
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
} from "../../src/services/research/identity.js";
import { getResearchIdentity, getResearchManifest } from "../../src/services/research/service.js";
import { setResearchRolloutOverrideForTest } from "../../src/mcp/tools.js";

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
});
