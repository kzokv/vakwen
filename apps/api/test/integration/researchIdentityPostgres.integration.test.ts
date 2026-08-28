import { Pool } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import {
  appendOfficialListingStatusRevision,
  canonicalizeOfficialIdentityRow,
} from "../../src/services/research/identity.js";
import { getResearchIdentity } from "../../src/services/research/service.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error("RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host");
}

const describePostgres = runPostgresIntegration && databaseUrl && redisUrl ? describe : describe.skip;

describePostgres("research identity memory/Postgres parity", () => {
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

  it("append immutable corrections and query two temporal cutoffs → match memory and retain durable history", async () => {
    const memory = new MemoryPersistence();
    const first = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-27T02:00:00.000Z",
      artifact: { contentHash: "sha256:pg-first", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company", ticker: "5274", legalName: "信驊科技股份有限公司", displayName: "信驊",
        unifiedBusinessNumber: "27490748", industryCode: "24", listedAt: "2013-04-30",
      },
    });
    const correction = canonicalizeOfficialIdentityRow({
      venue: "TPEX",
      snapshotDate: "2026-08-27",
      retrievedAt: "2026-08-28T02:00:00.000Z",
      artifact: { contentHash: "sha256:pg-correction", sourceUrl: "https://www.tpex.org.tw/openapi/v1/mopsfin_t187ap03_O" },
      row: {
        kind: "company", ticker: "5274", legalName: "信驊科技股份有限公司", displayName: "信驊科技",
        unifiedBusinessNumber: "27490748", industryCode: "24", listedAt: "2013-04-30",
      },
    });
    await memory.appendResearchIdentityRecords([first, correction, correction]);
    await postgres.appendResearchIdentityRecords([first, correction, correction]);

    for (const cutoff of ["2026-08-27T23:59:59.999Z", "2026-08-28T23:59:59.999Z"]) {
      const query = {
        subject: { kind: "listing_id" as const, listingId: first.listing.id },
        effectiveAt: cutoff,
        knowledgeAt: cutoff,
      };
      expect(await postgres.listResearchIdentityRecords(query)).toEqual(
        await memory.listResearchIdentityRecords(query),
      );
      expect(await postgres.listLatestResearchIdentityRecords(query)).toEqual(
        await memory.listLatestResearchIdentityRecords(query),
      );
      const serviceQuery = {
        subject: { kind: "listing_id" as const, listingId: first.listing.id },
        context: {
          effectiveAt: cutoff,
          knowledgeAt: cutoff,
          assessmentMode: "effective" as const,
        },
        history: { limit: 1 },
      };
      expect(await getResearchIdentity(postgres, serviceQuery)).toEqual(
        await getResearchIdentity(memory, serviceQuery),
      );
    }
    const latestVenueQuery = {
      subject: { kind: "venue" as const, venue: "TPEX" as const },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-28T23:59:59.999Z",
    };
    expect(await postgres.listLatestResearchIdentityRecords(latestVenueQuery)).toEqual(
      await memory.listLatestResearchIdentityRecords(latestVenueQuery),
    );
    expect(await postgres.listLatestResearchIdentityRecords(latestVenueQuery)).toEqual([correction]);
    expect(await postgres.listResearchIdentityRecords({
      subject: { kind: "listing_id", listingId: first.listing.id },
      effectiveAt: "2026-08-28T23:59:59.999Z",
      knowledgeAt: "2026-08-27T23:59:59.999Z",
    })).toHaveLength(1);
    const count = await pool.query<{ count: string }>(
      "SELECT count(*)::text AS count FROM research.identity_records WHERE listing_id = $1",
      [first.listing.id],
    );
    expect(count.rows[0]?.count).toBe("2");

    const firstPage = await getResearchIdentity(postgres, {
      subject: { kind: "ticker_venue", ticker: "5274", listingVenue: "TPEX" },
      context: {
        effectiveAt: "2026-08-28T23:59:59.999Z",
        knowledgeAt: "2026-08-28T23:59:59.999Z",
        assessmentMode: "effective",
      },
      history: { limit: 1 },
    });
    const secondPage = await getResearchIdentity(postgres, {
      subject: firstPage.selector,
      context: firstPage.context,
      history: { limit: 1, cursor: firstPage.history.nextCursor! },
    });
    expect(firstPage.history.items).toEqual([first]);
    expect(secondPage.history.items).toEqual([correction]);
    expect(secondPage.history.nextCursor).toBeNull();

    const tiedActive = canonicalizeOfficialIdentityRow({
      venue: "TWSE",
      snapshotDate: "2026-08-29",
      retrievedAt: "2026-08-29T02:00:00.000Z",
      artifact: { contentHash: "sha256:tied-active", sourceUrl: "https://openapi.twse.com.tw/v1/opendata/t187ap03_L" },
      row: {
        kind: "company", ticker: "8888", legalName: "同時點股份有限公司", displayName: "同時點",
        unifiedBusinessNumber: "88888888", industryCode: "24", listedAt: "2020-01-01",
      },
    });
    const tiedInactive = appendOfficialListingStatusRevision(tiedActive, {
      status: "inactive",
      effectiveDate: "2026-08-29",
      retrievedAt: "2026-08-29T02:00:00.000Z",
      artifact: {
        contentHash: "sha256:tied-inactive",
        sourceUrl: "https://openapi.twse.com.tw/v1/company/suspendListingCsvAndHtml",
        publisherDataset: "company/suspendListingCsvAndHtml",
      },
    });
    await memory.appendResearchIdentityRecords([tiedActive, tiedInactive]);
    await postgres.appendResearchIdentityRecords([tiedActive, tiedInactive]);
    const tiedQuery = {
      subject: { kind: "listing_id" as const, listingId: tiedActive.listing.id },
      effectiveAt: "2026-08-29T23:59:59.999Z",
      knowledgeAt: "2026-08-29T23:59:59.999Z",
    };
    const memoryTied = await memory.listResearchIdentityRecords(tiedQuery);
    const postgresTied = await postgres.listResearchIdentityRecords(tiedQuery);
    expect(postgresTied).toEqual(memoryTied);
    expect(postgresTied.at(-1)?.listing.status).toBe("inactive");
  });
});
