import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PostgresPersistence } from "../../src/persistence/postgres.js";
import { loadMigrationManifest } from "../../src/persistence/migrationManifest.js";

const databaseUrl = process.env.POSTGRES_TEST_DB_URL;
const redisUrl = process.env.POSTGRES_TEST_REDIS_URL;
if (!databaseUrl || !redisUrl || process.env.VAKWEN_MANAGED_CI_STACK !== "1") {
  throw new Error(
    "Run this benchmark through scripts/run-account-mutation-benchmark-host.sh.",
  );
}

const samples = Number.parseInt(process.env.ACCOUNT_MUTATION_BENCHMARK_SAMPLES ?? "24", 10);
const warmups = Number.parseInt(process.env.ACCOUNT_MUTATION_BENCHMARK_WARMUPS ?? "2", 10);
const historyRows = Number.parseInt(
  process.env.ACCOUNT_MUTATION_BENCHMARK_HISTORY_ROWS ?? "2000",
  10,
);
if (samples < 20 || warmups < 1 || historyRows < 1000) {
  throw new Error("Benchmark requires >=20 samples, >=1 warmup, and >=1000 history rows.");
}

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "../../../..");
const migrationsDir = path.join(repoRoot, "db/migrations");
const artifactDir = path.join(
  repoRoot,
  "docs/notes/configured-portfolio-capabilities/benchmark-artifacts",
);

async function resetDatabase(pool: Pool): Promise<void> {
  await pool.query("DROP SCHEMA IF EXISTS market_data CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
  await pool.query("GRANT ALL ON SCHEMA public TO public");
  const manifest = await loadMigrationManifest(migrationsDir);
  for (const file of manifest.numberedMigrations) {
    await pool.query(await fs.readFile(path.join(migrationsDir, file), "utf8"));
  }
}

function percentile(values: readonly number[], fraction: number): number {
  const ordered = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(ordered.length * fraction) - 1);
  return ordered[index] ?? 0;
}

function summarize(values: readonly number[]) {
  const total = values.reduce((sum, value) => sum + value, 0);
  return {
    samples: values.length,
    meanMs: total / values.length,
    medianMs: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    minMs: Math.min(...values),
    maxMs: Math.max(...values),
  };
}

async function measure(operation: () => Promise<void>): Promise<number> {
  const started = performance.now();
  await operation();
  return performance.now() - started;
}

async function runSamples(operation: (index: number) => Promise<void>): Promise<number[]> {
  for (let index = 0; index < warmups; index += 1) {
    await operation(index);
  }
  const durations: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    durations.push(await measure(() => operation(index + warmups)));
  }
  return durations;
}

async function seedLargePortfolio(
  persistence: PostgresPersistence,
  subject: string,
): Promise<{ userId: string; accountId: string }> {
  const identity = await persistence.resolveOrCreateUser("google", subject, {
    email: `${subject}@example.com`,
    name: subject,
  });
  const store = await persistence.loadStore(identity.userId);
  const account = store.accounts[0]!;
  const feeProfile = store.feeProfiles[0]!;
  for (let index = 0; index < historyRows; index += 1) {
    store.accounting.facts.tradeEvents.push({
      id: `${subject}-trade-${index}`,
      userId: identity.userId,
      accountId: account.id,
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: index % 2 === 0 ? "BUY" : "SELL",
      quantity: 1,
      unitPrice: 100 + (index % 50),
      priceCurrency: "TWD",
      tradeDate: `2025-${String((index % 12) + 1).padStart(2, "0")}-${String((index % 27) + 1).padStart(2, "0")}`,
      bookingSequence: index + 1,
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: feeProfile,
    });
  }
  await persistence.saveStore(store);
  return { userId: identity.userId, accountId: account.id };
}

const pool = new Pool({ connectionString: databaseUrl });
const persistence = new PostgresPersistence({ databaseUrl, redisUrl });
try {
  await resetDatabase(pool);
  await persistence.init();
  const legacy = await seedLargePortfolio(persistence, "benchmark-legacy");
  const bounded = await seedLargePortfolio(persistence, "benchmark-bounded");

  const legacyCreateMs = await runSamples(async (index) => {
    const store = await persistence.loadStore(legacy.userId);
    const id = randomUUID();
    const profileId = randomUUID();
    const sourceProfile = store.feeProfiles[0]!;
    store.feeProfiles.push({
      ...sourceProfile,
      id: profileId,
      accountId: id,
      name: `Legacy default ${index}`,
      commissionCurrency: "USD",
      taxRules: sourceProfile.taxRules?.map((rule) => ({
        ...rule,
        id: `${profileId}:${rule.taxComponentCode}:${rule.sortOrder}`,
      })),
    });
    store.accounts.push({
      id,
      userId: legacy.userId,
      name: `Legacy create ${index}`,
      feeProfileId: profileId,
      defaultCurrency: "USD",
      accountType: "broker",
    });
    await persistence.saveStore(store);
  });

  const boundedCreateMs = await runSamples(async (index) => {
    await persistence.createAccount({
      userId: bounded.userId,
      name: `Bounded create ${index}`,
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput: {
        actorUserId: bounded.userId,
        ipAddress: null,
        metadata: { source: "benchmark" },
      },
    });
  });

  const legacyUpdateMs = await runSamples(async (index) => {
    const store = await persistence.loadStore(legacy.userId);
    const account = store.accounts.find((item) => item.id === legacy.accountId)!;
    account.name = `Legacy updated ${index}`;
    await persistence.saveStore(store);
  });

  const boundedUpdateMs = await runSamples(async (index) => {
    await persistence.updateAccount({
      userId: bounded.userId,
      accountId: bounded.accountId,
      name: `Bounded updated ${index}`,
      auditInput: {
        actorUserId: bounded.userId,
        ipAddress: null,
        metadata: { source: "benchmark" },
      },
    });
  });

  const raw = {
    generatedAt: new Date().toISOString(),
    environment: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      historyRows,
      samples,
      warmups,
    },
    durationsMs: {
      legacyCreate: legacyCreateMs,
      boundedCreate: boundedCreateMs,
      legacyUpdate: legacyUpdateMs,
      boundedUpdate: boundedUpdateMs,
    },
  };
  const summary = {
    generatedAt: raw.generatedAt,
    environment: raw.environment,
    create: {
      legacy: summarize(legacyCreateMs),
      bounded: summarize(boundedCreateMs),
      speedupByMean: summarize(legacyCreateMs).meanMs / summarize(boundedCreateMs).meanMs,
    },
    update: {
      legacy: summarize(legacyUpdateMs),
      bounded: summarize(boundedUpdateMs),
      speedupByMean: summarize(legacyUpdateMs).meanMs / summarize(boundedUpdateMs).meanMs,
    },
  };

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(
    path.join(artifactDir, "account-mutation-postgres-raw.json"),
    `${JSON.stringify(raw, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(artifactDir, "account-mutation-postgres-summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);

  if (
    summary.create.speedupByMean < 5
    || summary.update.speedupByMean < 5
    || summary.create.bounded.p95Ms >= 500
    || summary.update.bounded.p95Ms >= 500
  ) {
    throw new Error("Benchmark acceptance thresholds were not met; inspect raw artifacts.");
  }
} finally {
  await persistence.close().catch(() => undefined);
  await pool.end();
}
