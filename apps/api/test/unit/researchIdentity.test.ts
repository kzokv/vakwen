import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import {
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
} from "../../src/services/research/identity.js";

describe("Taiwan research identity", () => {
  it("official company revisions: change name and industry classification → keep stable IDs and append sourced evidence", () => {
    const original = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:original",
        sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
      },
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
    const corrected = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-28",
      retrievedAt: "2026-08-28T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:corrected",
        sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L",
      },
      row: {
        kind: "company",
        ticker: "2330",
        legalName: "台灣積體電路製造股份有限公司",
        displayName: "台積電公司",
        unifiedBusinessNumber: "22099131",
        industryCode: "31",
        listedAt: "1994-09-05",
      },
    });

    expect(corrected.issuer.id).toBe(original.issuer.id);
    expect(corrected.security.id).toBe(original.security.id);
    expect(corrected.listing.id).toBe(original.listing.id);
    expect(corrected.listing.ticker).toBe("2330");
    expect(corrected.eligibility).toEqual({
      profile: "operating_company",
      state: "eligible",
      reasonCode: "supported_common_equity",
    });
    expect(corrected.observations.find((item) => item.field === "display_name")).toMatchObject({
      kind: "source_fact",
      raw: { value: "台積電公司" },
      normalized: { state: "present", value: "台積電公司" },
      effectiveAt: "2026-08-28T00:00:00.000Z",
      provenanceId: corrected.provenance.id,
    });
    expect(corrected.observations.find((item) => item.field === "industry_code")?.normalized).toEqual({
      state: "present",
      value: "31",
    });
    expect(corrected.provenance).toMatchObject({
      publisher: "TWSE",
      accessProvider: "TWSE_OPENAPI",
      authorityRole: "authoritative",
      contentHash: "sha256:corrected",
      retrievedAt: "2026-08-28T02:00:00.000Z",
    });
    expect(corrected.observations.find((item) => item.field === "paid_in_capital")).toMatchObject({
      raw: { state: "missing", reason: "not_reported" },
      normalized: { state: "missing", reason: "not_reported" },
    });
  });

  it("official fund snapshot: canonicalize a leading-zero ETF → preserve its ticker and apply the ETF-limited profile", () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:twse-funds",
        sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap47_L",
      },
      row: {
        kind: "fund",
        ticker: "0050",
        legalName: "元大台灣卓越50證券投資信託基金",
        displayName: "元大台灣50",
        identityKey: "00936523",
        unifiedBusinessNumber: "00936523",
        fundType: "ETF",
        listedAt: "2003-06-30",
        issuedUnits: "1,234,567,890",
      },
    });

    expect(record.listing.ticker).toBe("0050");
    expect(record.security).toMatchObject({ type: "etf", rights: "fund_units" });
    expect(record.eligibility).toEqual({
      profile: "etf_limited",
      state: "eligible",
      reasonCode: "supported_etf",
    });
    expect(record.observations.find((item) => item.field === "issued_units")?.normalized).toEqual({
      state: "present",
      value: "1234567890",
    });
    expect(record.provenance.publisherDataset).toBe("t187ap47_L");
  });

  it("official ETN snapshot: canonicalize an exchange-traded note → constrain research to identity-only", () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T03:00:00.000Z",
      artifact: {
        contentHash: "sha256:twse-etn",
        sourceUrl: "https://www.twse.com.tw/rwd/en/esg-index-product/etn",
      },
      row: {
        kind: "etn",
        ticker: "020032",
        legalName: "Yuanta Securities Co., Ltd.",
        displayName: "Yuanta 20Y US Treasury Bond ER Index ETN",
        issuerCode: "9800",
        noteType: "ETN",
        listedAt: "2024-02-01",
      },
    });

    expect(record.security).toMatchObject({ type: "etn", rights: "senior_unsecured_note" });
    expect(record.eligibility).toEqual({
      profile: "identity_only",
      state: "eligible",
      reasonCode: "supported_etn_identity_only",
    });
    expect(record.provenance.publisherDataset).toBe("twse_etn");
    expect(record.provenance.accessProvider).toBe("TWSE_WEB_JSON");
  });

  it("ETNs from one issuer: canonicalize distinct notes → assign distinct Security and Listing IDs", () => {
    const common = {
      venue: "TWSE" as const,
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T03:00:00.000Z",
      artifact: {
        contentHash: "sha256:twse-etn-list",
        sourceUrl: "https://www.twse.com.tw/rwd/zh/ETN/list?response=json",
      },
    };
    const first = canonicalizeOfficialIdentityRow({
      ...common,
      row: {
        kind: "etn", ticker: "020032", legalName: "元大證券股份有限公司", displayName: "元大綠能N",
        issuerCode: "9800", noteType: "ETN", listedAt: "2022-04-25",
      },
    });
    const second = canonicalizeOfficialIdentityRow({
      ...common,
      row: {
        kind: "etn", ticker: "020033", legalName: "元大證券股份有限公司", displayName: "元大科技N",
        issuerCode: "9800", noteType: "ETN", listedAt: "2022-04-25",
      },
    });

    expect(second.issuer.id).toBe(first.issuer.id);
    expect(second.security.id).not.toBe(first.security.id);
    expect(second.listing.id).not.toBe(first.listing.id);
  });

  it("unrecognized official security: retain its identity evidence → mark eligibility indeterminate with an explicit reason", () => {
    const record = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T03:00:00.000Z",
      artifact: {
        contentHash: "sha256:unknown-security",
        sourceUrl: "https://example.twse.com.tw/official-identity",
        publisherDataset: "official_identity_other",
      },
      row: {
        kind: "unknown",
        ticker: "09999X",
        legalName: "未知發行人",
        displayName: "未知商品",
        identityKey: "official:09999X",
        declaredSecurityType: "OTHER",
        listedAt: "2026-08-01",
      },
    });

    expect(record.security).toMatchObject({ type: "unknown", rights: "unknown" });
    expect(record.eligibility).toEqual({
      profile: "unknown",
      state: "indeterminate",
      reasonCode: "unsupported_security_type",
    });
  });

  it("identity history: append a later correction → preserve both revisions and prevent future-information leakage", async () => {
    const persistence = new MemoryPersistence();
    const first = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-first", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
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
    const correction = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-28",
      retrievedAt: "2026-08-28T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-correction", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company",
        ticker: "5274",
        legalName: "信驊科技股份有限公司",
        displayName: "信驊科技",
        unifiedBusinessNumber: "27490748",
        industryCode: "24",
        listedAt: "2013-04-30",
      },
    });

    await persistence.appendResearchIdentityRecords([first, correction]);

    const historical = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: first.listing.id },
      effectiveAt: "2026-08-27T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    });
    const current = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: first.listing.id },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    });

    expect(historical).toHaveLength(1);
    expect(historical[0]?.observations.find((item) => item.field === "display_name")?.normalized).toEqual({
      state: "present",
      value: "信驊",
    });
    expect(current).toHaveLength(2);
    expect(current.map((record) => record.provenance.contentHash)).toEqual([
      "sha256:tpex-first",
      "sha256:tpex-correction",
    ]);
  });

  it("late correction: use an earlier effective date but later retrieval → hide it until knowledge time reaches acquisition", async () => {
    const persistence = new MemoryPersistence();
    const original = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-20",
      retrievedAt: "2026-08-20T02:00:00.000Z",
      artifact: { contentHash: "sha256:known", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "2330", legalName: "台灣積體電路製造股份有限公司", displayName: "舊名稱",
        unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05",
      },
    });
    const lateCorrection = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-21",
      retrievedAt: "2026-08-29T02:00:00.000Z",
      artifact: { contentHash: "sha256:late", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "2330", legalName: "台灣積體電路製造股份有限公司", displayName: "更正名稱",
        unifiedBusinessNumber: "22099131", industryCode: "24", listedAt: "1994-09-05",
      },
    });
    await persistence.appendResearchIdentityRecords([original, lateCorrection]);

    const beforeKnowledge = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: original.listing.id },
      effectiveAt: "2026-08-28T00:00:00.000Z",
      knowledgeAt: "2026-08-28T00:00:00.000Z",
    });
    const afterKnowledge = await persistence.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: original.listing.id },
      effectiveAt: "2026-08-28T00:00:00.000Z",
      knowledgeAt: "2026-08-30T00:00:00.000Z",
    });

    expect(beforeKnowledge).toHaveLength(1);
    expect(afterKnowledge).toHaveLength(2);
  });

  it("listing lifecycle: transfer venue then delist → retain stable entities, distinct listings, and sourced inactive history", async () => {
    const tpex = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2025-01-01",
      retrievedAt: "2025-01-01T02:00:00.000Z",
      artifact: { contentHash: "sha256:tpex-active", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company", ticker: "7777", legalName: "轉板股份有限公司", displayName: "轉板",
        unifiedBusinessNumber: "12345678", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    const twse = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2025-06-01",
      retrievedAt: "2025-06-01T02:00:00.000Z",
      predecessorListingId: tpex.listing.id,
      artifact: { contentHash: "sha256:twse-transfer", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "7777", legalName: "轉板股份有限公司", displayName: "轉板",
        unifiedBusinessNumber: "12345678", industryCode: "24", listedAt: "2025-06-01",
      },
    });
    const inactive = appendOfficialListingStatusRevision(twse, {
      status: "inactive",
      effectiveDate: "2026-01-15",
      retrievedAt: "2026-01-16T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:twse-delisted",
        sourceUrl: "https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml",
        publisherDataset: "company/suspendListingCsvAndHtml",
      },
    });

    expect(twse.issuer.id).toBe(tpex.issuer.id);
    expect(twse.security.id).toBe(tpex.security.id);
    expect(twse.listing.id).not.toBe(tpex.listing.id);
    expect(twse.listing.predecessorListingId).toBe(tpex.listing.id);
    expect(inactive.listing).toMatchObject({ status: "inactive", inactiveAt: "2026-01-15" });
    expect(inactive.eligibility).toMatchObject({ state: "ineligible", reasonCode: "inactive_listing" });
    expect(inactive.observations.find((item) => item.field === "listing_status")?.normalized).toEqual({
      state: "present",
      value: "inactive",
    });
    expect(inactive.provenance.publisherDataset).toBe("company/suspendListingCsvAndHtml");
  });
});
