import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { canonicalizeOfficialIdentityRow } from "../../src/services/research/identity.js";
import { canonicalizeOfficialPriceRow } from "../../src/services/research/price.js";
import { getPriceSeries } from "../../src/services/research/service.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}

const describePostgres = runPostgresIntegration && databaseUrl && redisUrl ? describe : describe.skip;

function listing() {
  return canonicalizeOfficialIdentityRow({
    venue: "TWSE",
    snapshotDate: "2026-08-27",
    retrievedAt: "2026-08-27T02:00:00.000Z",
    artifact: { contentHash: "sha256:pg-listing", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
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
}

function price(input: {
  listingId: string;
  sessionDate: string;
  state: "full_bar" | "close_only" | "no_trade" | "suspended";
  close?: string;
  open?: string;
  high?: string;
  low?: string;
  volume?: string;
  tradedValue?: string;
  tradeCount?: string;
  note?: string;
  retrievedAt: string;
  contentHash: string;
}) {
  return canonicalizeOfficialPriceRow({
    listingId: input.listingId,
    ticker: "2330",
    venue: "TWSE",
    sessionDate: input.sessionDate,
    retrievedAt: input.retrievedAt,
    artifact: {
      contentHash: input.contentHash,
      sourceUrl: "https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL",
      publisherDataset: "STOCK_DAY_ALL",
      accessProvider: "TWSE_OPENAPI",
    },
    row: {
      state: input.state,
      open: input.open,
      high: input.high,
      low: input.low,
      close: input.close,
      volume: input.volume,
      tradedValue: input.tradedValue,
      tradeCount: input.tradeCount,
      note: input.note,
    },
  });
}

describePostgres("research price memory/Postgres parity", () => {
  let pool: Pool;
  let postgres: PostgresPersistence;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query("DROP SCHEMA IF EXISTS research CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT ALL ON SCHEMA public TO public");
    postgres = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await postgres.init();
  });

  afterEach(async () => {
    await postgres.close();
    await pool.end();
  });

  it("price history: keep idempotent immutable rows and match memory across temporal cutoffs", async () => {
    const memory = new MemoryPersistence();
    const identity = listing();
    const first = price({
      listingId: identity.listing.id,
      sessionDate: "2026-08-27",
      state: "full_bar",
      open: "100",
      high: "102",
      low: "99",
      close: "101",
      volume: "1000",
      tradedValue: "101000",
      tradeCount: "100",
      retrievedAt: "2026-08-27T10:00:00.000Z",
      contentHash: "sha256:first",
    });
    const correction = price({
      listingId: identity.listing.id,
      sessionDate: "2026-08-27",
      state: "close_only",
      close: "102",
      retrievedAt: "2026-08-28T10:00:00.000Z",
      contentHash: "sha256:correction",
    });
    const next = price({
      listingId: identity.listing.id,
      sessionDate: "2026-08-28",
      state: "suspended",
      note: "Typhoon closure",
      retrievedAt: "2026-08-28T12:00:00.000Z",
      contentHash: "sha256:next",
    });

    await memory.appendResearchIdentityRecords([identity]);
    await postgres.appendResearchIdentityRecords([identity]);
    await memory.appendResearchPriceRecords([first, correction, correction, next]);
    await postgres.appendResearchPriceRecords([first, correction, correction, next]);

    for (const cutoff of ["2026-08-27T23:59:59.999Z", "2026-08-28T23:59:59.999Z"]) {
      const query = {
        subject: { kind: "listing_id" as const, listingId: identity.listing.id },
        startDate: "2026-08-27",
        endDate: "2026-08-28",
        knowledgeAt: cutoff,
      };
      expect(await postgres.listResearchPriceRecords(query)).toEqual(
        await memory.listResearchPriceRecords(query),
      );
      expect(await postgres.listLatestResearchPriceRecords(query)).toEqual(
        await memory.listLatestResearchPriceRecords(query),
      );
      expect(await getPriceSeries(postgres, {
        subject: query.subject,
        context: {
          knowledgeAt: cutoff,
          effectiveAt: cutoff,
          assessmentMode: "effective",
        },
        scope: { kind: "date_range", startDate: "2026-08-27", endDate: "2026-08-28" },
        basis: "raw",
        order: "asc",
        page: { limit: 5 },
        metrics: [],
      })).toEqual(await getPriceSeries(memory, {
        subject: query.subject,
        context: {
          knowledgeAt: cutoff,
          effectiveAt: cutoff,
          assessmentMode: "effective",
        },
        scope: { kind: "date_range", startDate: "2026-08-27", endDate: "2026-08-28" },
        basis: "raw",
        order: "asc",
        page: { limit: 5 },
        metrics: [],
      }));
    }

    expect(await postgres.getDistinctResearchPriceSessionDates(
      "TWSE",
      "2026-08-27",
      "2026-08-28T23:59:59.999Z",
    )).toEqual(await memory.getDistinctResearchPriceSessionDates(
      "TWSE",
      "2026-08-27",
      "2026-08-28T23:59:59.999Z",
    ));

    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM research.price_records WHERE listing_id = $1",
      [identity.listing.id],
    );
    expect(count.rows[0]?.count).toBe("3");

    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname
         FROM pg_indexes
        WHERE schemaname = 'research'
          AND indexname = ANY($1::text[])
        ORDER BY indexname`,
      [[
        "research_price_records_listing_page_idx",
        "research_price_records_listing_session_idx",
        "research_price_records_venue_session_idx",
      ]],
    );
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      "research_price_records_listing_page_idx",
      "research_price_records_listing_session_idx",
      "research_price_records_venue_session_idx",
    ]);
  });
});
