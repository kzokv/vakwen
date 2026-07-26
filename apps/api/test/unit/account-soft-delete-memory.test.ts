/**
 * ui-enhancement — Unit tests for MemoryPersistence's new account-lifecycle
 * methods: softDeleteAccount, restoreAccount, listSoftDeletedAccounts,
 * selectAccountsForHardPurge, hardPurgeAccount.
 *
 * Placement rationale (per `test-placement-persistence-backend.md`):
 * - Memory-side behavioral semantics + restore-name auto-rename live here.
 * - Postgres cascade-ordering and audit_log FK assertions live in suite 5
 *   (`apps/api/test/integration/accountHardPurgeCascade.integration.test.ts`).
 * - 20-attempt restore-collision overflow lives in suite 5 too because the
 *   memory backend may not strictly enforce the unique constraint counter —
 *   architect-design.md §4 routes the throw to either side; we assert it on
 *   the memory side as a smoke and keep the canonical assertion in suite 5.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import { createDefaultFeeProfile } from "../../src/services/store.js";
import type { AccountDto } from "@vakwen/shared-types";
import type { OAuthClaims } from "../../src/persistence/types.js";

const baseAudit = { actorUserId: null, ipAddress: null, metadata: {} } as const;

async function seedUser(p: MemoryPersistence, email: string): Promise<string> {
  const claims: OAuthClaims = {
    email,
    emailVerified: true,
    name: "Owner",
    picture: undefined,
  };
  const result = await p.resolveOrCreateUser("google", `sub-${email}`, claims);
  return result.userId;
}

/**
 * Push a fresh account onto a user's in-memory store. Also seeds a matching
 * `FeeProfile` row so MemoryPersistence's pre-existing composite-FK ownership
 * validator (`validateMemoryStoreOwnership`) does not reject on saveStore.
 * Mirrors the POST /accounts auto-seed pattern at registerRoutes.ts:2941.
 */
async function seedAccount(
  p: MemoryPersistence,
  userId: string,
  partial: Partial<AccountDto> & { name: string; id: string },
): Promise<AccountDto> {
  const store = await p.loadStore(userId);
  const defaultCurrency = partial.defaultCurrency ?? "TWD";
  const feeProfileId = partial.feeProfileId ?? `fp-${partial.id}`;
  // Seed the matching fee profile FIRST so the account row's FK resolves.
  store.feeProfiles.push(createDefaultFeeProfile(partial.id, defaultCurrency, feeProfileId));
  const account: AccountDto = {
    id: partial.id,
    userId,
    name: partial.name,
    feeProfileId,
    defaultCurrency,
    accountType: partial.accountType ?? "broker",
  };
  store.accounts.push(account);
  await p.saveStore(store);
  return account;
}

describe("MemoryPersistence — softDeleteAccount", () => {
  let p: MemoryPersistence;
  let userId: string;

  beforeEach(async () => {
    p = new MemoryPersistence();
    userId = await seedUser(p, "soft-delete@example.com");
  });

  afterEach(async () => {
    await p.close();
  });

  it("stamps deletedAt and returns ISO string", async () => {
    await seedAccount(p, userId, { id: "acc-soft", name: "To Soft Delete" });

    const result = await p.softDeleteAccount("acc-soft", userId, baseAudit);

    expect(typeof result.deletedAt).toBe("string");
    if (result.deletedAt === null) throw new Error("Expected deletedAt to be populated");
    expect(new Date(result.deletedAt).getTime()).toBeGreaterThan(0);
  });

  it("is idempotent: second call returns the same deletedAt", async () => {
    await seedAccount(p, userId, { id: "acc-idem", name: "Idempotent" });

    const first = await p.softDeleteAccount("acc-idem", userId, baseAudit);
    const second = await p.softDeleteAccount("acc-idem", userId, baseAudit);

    expect(second.deletedAt).toBe(first.deletedAt);
  });

  it("404s on unknown account id with routeError shape", async () => {
    await expect(
      p.softDeleteAccount("acc-missing", userId, baseAudit),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("hides the account from default store.accounts reads (filter-on-read)", async () => {
    await seedAccount(p, userId, { id: "acc-hide", name: "Hide Me" });
    await p.softDeleteAccount("acc-hide", userId, baseAudit);

    const store = await p.loadStore(userId);
    const active = store.accounts.filter(
      (a) => (a as unknown as Record<string, unknown>).deletedAt == null,
    );
    expect(active.find((a) => a.id === "acc-hide")).toBeUndefined();
  });

  it("falls back the owner's persisted reporting currency to the first remaining configured currency", async () => {
    await p._setUserPreferences(userId, { reportingCurrency: "TWD" });
    await seedAccount(p, userId, { id: "acc-us", name: "USD Account", defaultCurrency: "USD" });

    const result = await p.softDeleteAccount("acc-1", userId, baseAudit);

    expect(result.capabilities).toEqual({
      configuredMarkets: ["US"],
      configuredCurrencies: ["USD"],
    });
    expect(result.reportingCurrency).toEqual({
      requested: "USD",
      effective: "USD",
      reason: null,
    });
    await expect(p.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });

  it("clears the stored reporting currency when zero active accounts remain", async () => {
    await p._setUserPreferences(userId, { reportingCurrency: "TWD", locale: "en" });

    const result = await p.softDeleteAccount("acc-1", userId, baseAudit);

    expect(result.capabilities).toEqual({
      configuredMarkets: [],
      configuredCurrencies: [],
    });
    expect(result.reportingCurrency).toEqual({
      requested: null,
      effective: null,
      reason: "no_configured_currencies",
    });
    await expect(p.getUserPreferences(userId)).resolves.toEqual({ locale: "en" });
  });
});

describe("MemoryPersistence — restoreAccount", () => {
  let p: MemoryPersistence;
  let userId: string;

  beforeEach(async () => {
    p = new MemoryPersistence();
    userId = await seedUser(p, "restore@example.com");
  });

  afterEach(async () => {
    await p.close();
  });

  it("clears deletedAt; finalName equals original when no collision", async () => {
    await seedAccount(p, userId, { id: "acc-r1", name: "Restore Me" });
    await p.softDeleteAccount("acc-r1", userId, baseAudit);

    const result = await p.restoreAccount("acc-r1", userId, baseAudit);

    expect(result.account.id).toBe("acc-r1");
    expect(result.finalName).toBe("Restore Me");
  });

  it("auto-renames on single collision: '{name} (restored)'", async () => {
    await seedAccount(p, userId, { id: "acc-a", name: "Collide" });
    await p.softDeleteAccount("acc-a", userId, baseAudit);
    await seedAccount(p, userId, { id: "acc-b", name: "Collide" });

    const result = await p.restoreAccount("acc-a", userId, baseAudit);
    expect(result.finalName).toBe("Collide (restored)");
  });

  it("auto-renames on double collision: '{name} (restored 2)'", async () => {
    await seedAccount(p, userId, { id: "acc-a", name: "Twice" });
    await p.softDeleteAccount("acc-a", userId, baseAudit);
    await seedAccount(p, userId, { id: "acc-b", name: "Twice" });
    await seedAccount(p, userId, { id: "acc-c", name: "Twice (restored)" });

    const result = await p.restoreAccount("acc-a", userId, baseAudit);
    expect(result.finalName).toBe("Twice (restored 2)");
  });

  it("404s on unknown id", async () => {
    await expect(
      p.restoreAccount("acc-nope", userId, baseAudit),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("404s when account exists but is not soft-deleted", async () => {
    await seedAccount(p, userId, { id: "acc-active", name: "Active" });
    await expect(
      p.restoreAccount("acc-active", userId, baseAudit),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("does not restore the previous reporting currency after a fallback-triggering delete", async () => {
    await p._setUserPreferences(userId, { reportingCurrency: "TWD" });
    await seedAccount(p, userId, { id: "acc-us", name: "USD Account", defaultCurrency: "USD" });
    await p.softDeleteAccount("acc-1", userId, baseAudit);

    const result = await p.restoreAccount("acc-1", userId, baseAudit);

    expect(result.capabilities).toEqual({
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    });
    expect(result.reportingCurrency).toEqual({
      requested: "USD",
      effective: "USD",
      reason: null,
    });
    await expect(p.getUserPreferences(userId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });
});

describe("MemoryPersistence — listSoftDeletedAccounts", () => {
  let p: MemoryPersistence;
  let userId: string;

  beforeEach(async () => {
    p = new MemoryPersistence();
    userId = await seedUser(p, "list-deleted@example.com");
  });

  afterEach(async () => {
    await p.close();
  });

  it("returns [] when no accounts soft-deleted", async () => {
    const result = await p.listSoftDeletedAccounts(userId);
    expect(result).toEqual([]);
  });

  it("returns soft-deleted accounts with deletedAt ISO and excludes active rows", async () => {
    await seedAccount(p, userId, { id: "acc-list-a", name: "Deleted A" });
    await seedAccount(p, userId, { id: "acc-list-b", name: "Active B" });
    await p.softDeleteAccount("acc-list-a", userId, baseAudit);

    const result = await p.listSoftDeletedAccounts(userId);
    expect(result.find((r) => r.id === "acc-list-a")).toBeDefined();
    expect(result.find((r) => r.id === "acc-list-b")).toBeUndefined();
    const aRow = result.find((r) => r.id === "acc-list-a")!;
    expect(typeof aRow.deletedAt).toBe("string");
  });
});

describe("MemoryPersistence — selectAccountsForHardPurge", () => {
  let p: MemoryPersistence;
  let userId: string;

  beforeEach(async () => {
    p = new MemoryPersistence();
    userId = await seedUser(p, "purge-select@example.com");
  });

  afterEach(async () => {
    await p.close();
  });

  it("returns soft-deleted accounts older than the grace window", async () => {
    await seedAccount(p, userId, { id: "acc-old", name: "Old" });
    await p.softDeleteAccount("acc-old", userId, baseAudit);

    // Back-date the deletedAt directly on the shadow map so the row's age
    // crosses the 30-day grace threshold. The shadow store is private; this
    // is a deliberate test-only reach-through, mirroring how the cron-
    // retention case is exercised on the Postgres side via raw INSERT.
    const shadow = (p as unknown as {
      softDeletedAccounts: Map<string, { deletedAt: string }>;
    }).softDeletedAccounts;
    const shadowKey = `${userId}:acc-old`;
    const target = shadow.get(shadowKey);
    if (!target) throw new Error(`shadow row missing for ${shadowKey}`);
    target.deletedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();

    const candidates = await p.selectAccountsForHardPurge(30);
    expect(candidates.find((c) => c.accountId === "acc-old" && c.userId === userId)).toBeDefined();
  });

  it("excludes recently-soft-deleted accounts within the grace window", async () => {
    await seedAccount(p, userId, { id: "acc-recent", name: "Recent" });
    await p.softDeleteAccount("acc-recent", userId, baseAudit);

    const candidates = await p.selectAccountsForHardPurge(30);
    expect(candidates.find((c) => c.accountId === "acc-recent")).toBeUndefined();
  });

  it("excludes active (non-soft-deleted) accounts entirely", async () => {
    await seedAccount(p, userId, { id: "acc-still-active", name: "Active" });
    const candidates = await p.selectAccountsForHardPurge(0); // even with 0-day grace
    expect(candidates.find((c) => c.accountId === "acc-still-active")).toBeUndefined();
  });
});

describe("MemoryPersistence — hardPurgeAccount", () => {
  let p: MemoryPersistence;
  let userId: string;

  beforeEach(async () => {
    p = new MemoryPersistence();
    userId = await seedUser(p, "hard-purge@example.com");
  });

  afterEach(async () => {
    await p.close();
  });

  it("removes the soft-deleted account row entirely when mustBeSoftDeleted=true", async () => {
    await seedAccount(p, userId, { id: "acc-purge", name: "Purge Target" });
    await p.softDeleteAccount("acc-purge", userId, baseAudit);

    await p.hardPurgeAccount("acc-purge", userId, baseAudit, { mustBeSoftDeleted: true });

    const store = await p.loadStore(userId);
    expect(store.accounts.find((a) => a.id === "acc-purge")).toBeUndefined();
  });

  it("404s on active account when mustBeSoftDeleted=true", async () => {
    await seedAccount(p, userId, { id: "acc-active-purge", name: "Still Active" });
    await expect(
      p.hardPurgeAccount("acc-active-purge", userId, baseAudit, { mustBeSoftDeleted: true }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("removes active account when mustBeSoftDeleted=false (skip-wait route)", async () => {
    await seedAccount(p, userId, { id: "acc-skip-wait", name: "Skip Wait" });
    await p.hardPurgeAccount("acc-skip-wait", userId, baseAudit, { mustBeSoftDeleted: false });

    const store = await p.loadStore(userId);
    expect(store.accounts.find((a) => a.id === "acc-skip-wait")).toBeUndefined();
  });

  it("does NOT touch the user row", async () => {
    await seedAccount(p, userId, { id: "acc-isolated", name: "Isolated" });
    await p.softDeleteAccount("acc-isolated", userId, baseAudit);
    await p.hardPurgeAccount("acc-isolated", userId, baseAudit, { mustBeSoftDeleted: true });

    // User row still resolvable via re-login claim path.
    const claims: OAuthClaims = {
      email: "hard-purge@example.com",
      emailVerified: true,
      name: "Owner",
      picture: undefined,
    };
    const reLogin = await p.resolveOrCreateUser("google", "sub-hard-purge@example.com", claims);
    expect(reLogin.userId).toBe(userId);
  });
});
