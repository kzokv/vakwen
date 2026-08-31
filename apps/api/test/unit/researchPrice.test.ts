import { describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";

describe("canonical research price records", () => {
  it("preserves publisher missing sentinels as raw evidence without treating them as numeric values", () => {
    const record = canonicalizeOfficialPriceRow({
      listingId: "lst_2330",
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      retrievedAt: "2026-08-27T10:00:00.000Z",
      artifact: {
        contentHash: "sha256:missing-sentinels",
        sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        publisherDataset: "exchangeReport/STOCK_DAY_ALL",
        accessProvider: "TWSE_OPENAPI",
      },
      row: {
        state: "no_trade",
        open: "--",
        high: "---",
        low: "----",
        close: "--",
        volume: "---",
        tradedValue: "----",
        tradeCount: "--",
      },
    });

    expect(record.observations.find((observation) => observation.field === "close")).toMatchObject({
      raw: { state: "present", value: "--" },
      normalized: { state: "missing", reason: "not_reported" },
    });
  });

  it("rejects malformed settled rows instead of fabricating missing numeric values", async () => {
    expect(() => canonicalizeOfficialPriceRow({
      listingId: "lst_2330",
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      retrievedAt: "2026-08-27T10:00:00.000Z",
      artifact: {
        contentHash: "sha256:malformed-full-bar",
        sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
        publisherDataset: "exchangeReport/STOCK_DAY_ALL",
        accessProvider: "TWSE_OPENAPI",
      },
      row: {
        state: "full_bar",
        high: "104",
        low: "100",
        close: "102",
        volume: "1100",
        tradedValue: "110000",
        tradeCount: "110",
      },
    })).toThrow("research_price_record_invalid");

    const valid = canonicalizeOfficialPriceRow({
      listingId: "lst_2330",
      ticker: "2330",
      venue: "TWSE",
      sessionDate: "2026-08-27",
      retrievedAt: "2026-08-27T10:00:00.000Z",
      artifact: {
        contentHash: "sha256:valid-full-bar",
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
    });
    const malformedRecord = {
      ...valid,
      observations: valid.observations.filter((observation) => observation.field !== "open"),
    };
    const persistence = new MemoryPersistence();
    await expect(persistence.appendResearchPriceRecords([valid, malformedRecord])).rejects.toThrow(
      "research_price_record_invalid",
    );
    await expect(persistence.listResearchPriceRecords({
      subject: { kind: "listing_id", listingId: valid.listingId },
      startDate: valid.sessionDate,
      endDate: valid.sessionDate,
      knowledgeAt: "2026-08-27T11:00:00.000Z",
    })).resolves.toEqual([]);
  });
});
