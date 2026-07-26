import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const { PostgresPersistence } = await import("../../src/persistence/postgres.js");
const { loadMigrationManifest } = await import("../../src/persistence/migrationManifest.js");

type PostgresPersistenceInstance = InstanceType<typeof PostgresPersistence>;

const databaseUrl = process.env.POSTGRES_TEST_DB_URL ?? process.env.DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL ?? process.env.REDIS_URL;
const runPostgresIntegration = process.env.RUN_POSTGRES_INTEGRATION === "1";
const managedCiStack = process.env.VAKWEN_MANAGED_CI_STACK === "1";

if (runPostgresIntegration && !managedCiStack) {
  throw new Error(
    "RUN_POSTGRES_INTEGRATION=1 must be executed via npm run test:integration:full:host " +
      "or npm run test:integration:full:container so the DB/Redis stack is managed automatically.",
  );
}

const shouldRunPostgresSuite = runPostgresIntegration && Boolean(databaseUrl) && Boolean(redisUrl);
const describePostgres = shouldRunPostgresSuite ? describe : describe.skip;

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(currentDir, "../../../../db/migrations");
const migrationManifestPromise = loadMigrationManifest(migrationsDir);

async function resetDatabase(pool: Pool): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("DROP SCHEMA IF EXISTS market_data CASCADE");
    await client.query("DROP SCHEMA IF EXISTS public CASCADE");
    await client.query("CREATE SCHEMA public");
    await client.query("GRANT ALL ON SCHEMA public TO public");
  } finally {
    client.release();
  }
}

async function applyNumberedMigrations(pool: Pool): Promise<void> {
  const manifest = await migrationManifestPromise;
  const client = await pool.connect();
  try {
    for (const file of manifest.numberedMigrations) {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      await client.query(sql);
    }
  } finally {
    client.release();
  }
}

describePostgres("bounded account mutations (postgres integration)", () => {
  let pool: Pool;
  let persistence: PostgresPersistenceInstance | null = null;
  let userId: string;
  let seededAccountId: string;

  beforeEach(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await resetDatabase(pool);
    await applyNumberedMigrations(pool);

    persistence = new PostgresPersistence({ databaseUrl: databaseUrl!, redisUrl: redisUrl! });
    await persistence.init();

    const result = await persistence.resolveOrCreateUser("google", "bounded-account-mutations", {
      email: "bounded-account-mutations@example.com",
      name: "Bounded Mutation Test",
    });
    userId = result.userId;
    const seededStore = await persistence.loadStore(userId);
    seededAccountId = seededStore.accounts[0]!.id;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (persistence) {
      await persistence.close();
      persistence = null;
    }
    await pool.end();
  });

  it("createAccount avoids full-store persistence and writes an audit row atomically", async () => {
    const fullStoreRead = vi.spyOn(persistence!, "loadStore");
    const fullStoreWrite = vi.spyOn(persistence!, "saveStore");

    const result = await persistence!.createAccount({
      userId,
      name: "Postgres USD",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "POST /accounts" } },
    });

    expect(fullStoreRead).not.toHaveBeenCalled();
    expect(fullStoreWrite).not.toHaveBeenCalled();
    expect(result.account).toMatchObject({
      name: "Postgres USD",
      defaultCurrency: "USD",
      accountType: "broker",
    });
    expect(result.capabilities).toEqual({
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    });

    const audit = await pool.query<{ action: string; metadata: { accountId?: string } }>(
      `SELECT action, metadata FROM audit_log WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    expect(audit.rows[0]?.action).toBe("account_created");
    expect(audit.rows[0]?.metadata.accountId).toBe(result.account.id);
  });

  it("createAccount atomically initializes reporting currency for the first active account", async () => {
    await persistence!.softDeleteAccount(seededAccountId, userId, {
      actorUserId: userId,
      ipAddress: "127.0.0.1",
      metadata: { routeKey: "DELETE /accounts/:id" },
    });

    const result = await persistence!.createAccount({
      userId,
      name: "First Active USD",
      defaultCurrency: "USD",
      accountType: "wallet",
      auditInput: {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "POST /accounts" },
      },
    });

    expect(result.capabilities).toEqual({
      configuredMarkets: ["US"],
      configuredCurrencies: ["USD"],
    });
    await expect(persistence!.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });

  it("updateAccount avoids full-store persistence and preserves ownership guards", async () => {
    const created = await persistence!.createAccount({
      userId,
      name: "Patch Me",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "POST /accounts" } },
    });
    const other = await persistence!.createAccount({
      userId,
      name: "Other Profile Source",
      defaultCurrency: "AUD",
      accountType: "bank",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "POST /accounts" } },
    });

    const fullStoreRead = vi.spyOn(persistence!, "loadStore");
    const fullStoreWrite = vi.spyOn(persistence!, "saveStore");

    await expect(persistence!.updateAccount({
      userId,
      accountId: created.account.id,
      feeProfileId: other.feeProfile.id,
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "PATCH /accounts/:id" } },
    })).rejects.toMatchObject({ statusCode: 400, code: "invalid_fee_profile" });

    const updated = await persistence!.updateAccount({
      userId,
      accountId: created.account.id,
      name: "Patched Name",
      accountType: "wallet",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "PATCH /accounts/:id" } },
    });

    expect(fullStoreRead).not.toHaveBeenCalled();
    expect(fullStoreWrite).not.toHaveBeenCalled();
    expect(updated.account).toMatchObject({
      id: created.account.id,
      name: "Patched Name",
      accountType: "wallet",
    });
    expect(updated.changedFields).toEqual(["name", "accountType"]);
  });

  it("updateAccount audits an implicit dividend-setting clear in the same mutation", async () => {
    const created = await persistence!.createAccount({
      userId,
      name: "Currency Audit Target",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "POST /accounts" } },
    });
    await persistence!.patchAccountMarketDividendSettings(userId, {
      accountId: created.account.id,
      marketCode: "US",
      fallbackParValue: "10",
      auditInput: {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "PATCH /accounts/:id/dividend-settings" },
      },
    });

    await persistence!.updateAccount({
      userId,
      accountId: created.account.id,
      defaultCurrency: "AUD",
      auditInput: {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "PATCH /accounts/:id" },
      },
    });

    const audit = await pool.query<{
      action: string;
      metadata: { accountId?: string; marketCode?: string; fallbackParValue?: string | null };
    }>(
      `SELECT action, metadata
         FROM audit_log
        WHERE target_user_id = $1
          AND action = 'account_market_dividend_settings_updated'
          AND metadata->>'accountId' = $2
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId, created.account.id],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "account_market_dividend_settings_updated",
      metadata: {
        accountId: created.account.id,
        marketCode: "US",
        fallbackParValue: null,
      },
    });
  });

  it("softDeleteAccount atomically falls the owner reporting currency to the first remaining configured currency", async () => {
    await persistence!._setUserPreferences(userId, { reportingCurrency: "TWD" });
    await persistence!.createAccount({
      userId,
      name: "Delete Fallback USD",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "POST /accounts" } },
    });

    const deleted = await persistence!.softDeleteAccount(seededAccountId, userId, {
      actorUserId: userId,
      ipAddress: "127.0.0.1",
      metadata: { routeKey: "DELETE /accounts/:id" },
    });

    expect(deleted.capabilities).toEqual({
      configuredMarkets: ["US"],
      configuredCurrencies: ["USD"],
    });
    expect(deleted.reportingCurrency).toEqual({
      requested: "USD",
      effective: "USD",
      reason: null,
    });
    await expect(persistence!.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });

    const audit = await pool.query<{ metadata: { reportingCurrencyBefore?: string | null; reportingCurrencyAfter?: string | null } }>(
      `SELECT metadata
         FROM audit_log
        WHERE target_user_id = $1
          AND action = 'account_soft_deleted'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    expect(audit.rows[0]?.metadata).toMatchObject({
      reportingCurrencyBefore: "TWD",
      reportingCurrencyAfter: "USD",
    });
  });

  it("softDeleteAccount normalizes an implicit TWD preference when only USD remains", async () => {
    await persistence!.createAccount({
      userId,
      name: "Implicit Fallback USD",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: { actorUserId: userId, ipAddress: "127.0.0.1", metadata: { routeKey: "POST /accounts" } },
    });

    const deleted = await persistence!.softDeleteAccount(seededAccountId, userId, {
      actorUserId: userId,
      ipAddress: "127.0.0.1",
      metadata: { routeKey: "DELETE /accounts/:id" },
    });

    expect(deleted.reportingCurrency).toEqual({
      requested: "USD",
      effective: "USD",
      reason: null,
    });
    await expect(persistence!.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });

  it("softDeleteAccount clears the stored reporting currency when zero active accounts remain, and restore does not revert it", async () => {
    await persistence!._setUserPreferences(userId, { reportingCurrency: "TWD", locale: "en" });

    const deleted = await persistence!.softDeleteAccount(seededAccountId, userId, {
      actorUserId: userId,
      ipAddress: "127.0.0.1",
      metadata: { routeKey: "DELETE /accounts/:id" },
    });

    expect(deleted.capabilities).toEqual({
      configuredMarkets: [],
      configuredCurrencies: [],
    });
    expect(deleted.reportingCurrency).toEqual({
      requested: null,
      effective: null,
      reason: "no_configured_currencies",
    });
    await expect(persistence!.getUserPreferences(userId)).resolves.toEqual({ locale: "en" });

    const restored = await persistence!.restoreAccount(seededAccountId, userId, {
      actorUserId: userId,
      ipAddress: "127.0.0.1",
      metadata: { routeKey: "POST /accounts/:id/restore" },
    });

    expect(restored.reportingCurrency).toEqual({
      requested: null,
      effective: "TWD",
      reason: null,
    });
    expect(restored.feeProfiles).toEqual([
      expect.objectContaining({
        id: restored.account.feeProfileId,
        accountId: seededAccountId,
      }),
    ]);
    expect(restored.feeProfileBindings).toEqual([]);
    await expect(persistence!.getUserPreferences(userId)).resolves.toEqual({ locale: "en" });
  });

  it("serializes concurrent final-account deletions before deriving reporting fallback", async () => {
    const usdAccount = await persistence!.createAccount({
      userId,
      name: "Concurrent Delete USD",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "POST /accounts" },
      },
    });
    await persistence!._setUserPreferences(userId, {
      reportingCurrency: "TWD",
      locale: "en",
    });

    await Promise.all([
      persistence!.softDeleteAccount(seededAccountId, userId, {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "DELETE /accounts/:id", concurrent: "twd" },
      }),
      persistence!.softDeleteAccount(usdAccount.account.id, userId, {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "DELETE /accounts/:id", concurrent: "usd" },
      }),
    ]);

    await expect(persistence!.listActiveAccounts(userId)).resolves.toEqual([]);
    await expect(persistence!.getUserPreferences(userId)).resolves.toEqual({ locale: "en" });
  });

  it("hardPurgeAccount atomically returns capabilities and applies reporting fallback for an active purge", async () => {
    await persistence!._setUserPreferences(userId, { reportingCurrency: "TWD" });
    await persistence!.createAccount({
      userId,
      name: "Hard purge fallback USD",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "POST /accounts" },
      },
    });

    const purged = await persistence!.hardPurgeAccount(
      seededAccountId,
      userId,
      {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "POST /accounts/:id/purge" },
      },
      { mustBeSoftDeleted: false },
    );

    expect(purged).toMatchObject({
      account: { id: seededAccountId, defaultCurrency: "TWD" },
      deletedAt: null,
      capabilities: {
        configuredMarkets: ["US"],
        configuredCurrencies: ["USD"],
      },
      reportingCurrency: {
        requested: "USD",
        effective: "USD",
        reason: null,
      },
    });
    await expect(persistence!.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
    const audit = await pool.query<{ action: string }>(
      `SELECT action
         FROM audit_log
        WHERE target_user_id = $1
          AND action = 'account_hard_purged'
        ORDER BY created_at DESC
        LIMIT 1`,
      [userId],
    );
    expect(audit.rows[0]?.action).toBe("account_hard_purged");
  });

  it("hardPurgeAccount normalizes an implicit TWD preference when only USD remains", async () => {
    await persistence!.createAccount({
      userId,
      name: "Implicit Purge USD",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "POST /accounts" },
      },
    });

    const purged = await persistence!.hardPurgeAccount(
      seededAccountId,
      userId,
      {
        actorUserId: userId,
        ipAddress: "127.0.0.1",
        metadata: { routeKey: "POST /accounts/:id/purge" },
      },
      { mustBeSoftDeleted: false },
    );

    expect(purged.reportingCurrency).toEqual({
      requested: "USD",
      effective: "USD",
      reason: null,
    });
    await expect(persistence!.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });
});
