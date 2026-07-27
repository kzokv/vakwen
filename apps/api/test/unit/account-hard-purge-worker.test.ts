/**
 * ui-enhancement — Unit tests for the account hard-purge cron handler.
 *
 * Mirrors `registerAnonymousShareTokenPurgeWorker.test.ts` shape. The handler:
 *  1. Reads `graceDays` via `getEffectiveAccountHardPurgeDays()` AT TICK TIME
 *     (sweep-parameter-live per `fastify-eviction-lifecycle-pattern.md`).
 *  2. Calls `persistence.selectAccountsForHardPurge(graceDays)`.
 *  3. For each candidate, calls
 *     `persistence.hardPurgeAccount(accountId, userId, {...}, { mustBeSoftDeleted: true })`.
 *  4. After each successful purge, publishes
 *     `eventBus.publishEvent(userId, { type: "account_hard_purged", accountId })`.
 *  5. Logs aggregate `{ purged, errors, graceDays }`.
 *
 * Per-row failure tolerance: one row throwing must NOT stop the rest of the
 * batch. Errors are accumulated and logged.
 */

import { describe, expect, it, vi } from "vitest";
import type { JobWithMetadata } from "pg-boss";
import { createAccountHardPurgeHandler } from "../../src/services/registerAccountHardPurgeWorker.js";

function makeJob(): JobWithMetadata<Record<string, never>> {
  return { data: {}, retryCount: 0, retryLimit: 3 } as JobWithMetadata<Record<string, never>>;
}

function makePurgeResult(accountId: string, userId: string) {
  return {
    account: {
      id: accountId,
      userId,
      name: accountId,
      feeProfileId: `fee-${accountId}`,
      defaultCurrency: "TWD" as const,
      accountType: "broker" as const,
    },
    deletedAt: "2026-07-01T00:00:00.000Z",
    finalName: null,
    capabilities: {
      hasAccounts: false,
      configuredCurrencies: [],
      configuredMarkets: [],
      accountCount: 0,
    },
    reportingCurrency: {
      requested: "TWD" as const,
      effective: null,
      reason: "no_configured_currencies" as const,
    },
  };
}

describe("createAccountHardPurgeHandler", () => {
  it("reads grace days via the resolver AT TICK TIME and forwards to selectAccountsForHardPurge", async () => {
    let resolverCalls = 0;
    const persistence = {
      selectAccountsForHardPurge: vi.fn().mockResolvedValue([]),
      hardPurgeAccount: vi.fn(),
      getUserPreferences: vi.fn(),
      listSharesForOwner: vi.fn(),
    };
    const eventBus = { publishEvent: vi.fn().mockResolvedValue(undefined) };
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const handler = createAccountHardPurgeHandler({
      persistence,
      eventBus,
      log,
      getGraceDays: () => {
        resolverCalls += 1;
        return 45; // admin-overridden value
      },
    } as never);

    await handler([makeJob()]);

    expect(resolverCalls).toBe(1);
    expect(persistence.selectAccountsForHardPurge).toHaveBeenCalledWith(45);
  });

  it("calls hardPurgeAccount per candidate with mustBeSoftDeleted=true and emits SSE per row", async () => {
    const persistence = {
      selectAccountsForHardPurge: vi.fn().mockResolvedValue([
        { accountId: "acc-1", userId: "user-A" },
        { accountId: "acc-2", userId: "user-B" },
      ]),
      hardPurgeAccount: vi.fn().mockImplementation((accountId: string, userId: string) =>
        Promise.resolve(makePurgeResult(accountId, userId))),
      getUserPreferences: vi.fn().mockResolvedValue({ reportingCurrency: "TWD" }),
      listSharesForOwner: vi.fn().mockResolvedValue({ active: [], revoked: [] }),
    };
    const eventBus = { publishEvent: vi.fn().mockResolvedValue(undefined) };
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const handler = createAccountHardPurgeHandler({
      persistence,
      eventBus,
      log,
      getGraceDays: () => 30,
    } as never);

    await handler([makeJob()]);

    expect(persistence.hardPurgeAccount).toHaveBeenCalledTimes(2);
    expect(persistence.hardPurgeAccount).toHaveBeenCalledWith(
      "acc-1",
      "user-A",
      expect.any(Object),
      { mustBeSoftDeleted: true },
    );

    expect(eventBus.publishEvent).toHaveBeenCalledTimes(2);
    // Per-row event payload shape — accept either argv shape.
    const calls = eventBus.publishEvent.mock.calls;
    const types = calls.map((c) => {
      const last = c[c.length - 1] as { type?: string };
      return last?.type;
    });
    expect(types).toEqual(["account_hard_purged", "account_hard_purged"]);
  });

  it("one row failing does NOT stop the batch; aggregate is logged with error count", async () => {
    const boom = new Error("boom");
    const persistence = {
      selectAccountsForHardPurge: vi.fn().mockResolvedValue([
        { accountId: "acc-fail", userId: "user-X" },
        { accountId: "acc-ok", userId: "user-Y" },
      ]),
      hardPurgeAccount: vi.fn().mockImplementation((accountId: string) => {
        if (accountId === "acc-fail") throw boom;
        return Promise.resolve(makePurgeResult(accountId, "user-Y"));
      }),
      getUserPreferences: vi.fn().mockResolvedValue({ reportingCurrency: "TWD" }),
      listSharesForOwner: vi.fn().mockResolvedValue({ active: [], revoked: [] }),
    };
    const eventBus = { publishEvent: vi.fn().mockResolvedValue(undefined) };
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const handler = createAccountHardPurgeHandler({
      persistence,
      eventBus,
      log,
      getGraceDays: () => 30,
    } as never);

    await handler([makeJob()]);

    expect(persistence.hardPurgeAccount).toHaveBeenCalledTimes(2);
    // Only the successful row publishes an event.
    expect(eventBus.publishEvent).toHaveBeenCalledTimes(1);
    // Aggregate log fires and includes graceDays + non-zero error count.
    const aggregateLogCalls = log.info.mock.calls.filter((args) => {
      const payload = args[0] as Record<string, unknown>;
      return payload && typeof payload === "object" && "purged" in payload;
    });
    expect(aggregateLogCalls.length).toBeGreaterThanOrEqual(1);
    const payload = aggregateLogCalls[0]![0] as Record<string, unknown>;
    expect(payload.purged).toBe(1);
    expect(payload.errors).toBe(1);
    expect(payload.graceDays).toBe(30);
  });

  it("empty candidates: no hardPurgeAccount calls; aggregate logs purged=0", async () => {
    const persistence = {
      selectAccountsForHardPurge: vi.fn().mockResolvedValue([]),
      hardPurgeAccount: vi.fn(),
      getUserPreferences: vi.fn(),
      listSharesForOwner: vi.fn(),
    };
    const eventBus = { publishEvent: vi.fn() };
    const log = { info: vi.fn(), error: vi.fn(), warn: vi.fn() };

    const handler = createAccountHardPurgeHandler({
      persistence,
      eventBus,
      log,
      getGraceDays: () => 30,
    } as never);

    await handler([makeJob()]);

    expect(persistence.hardPurgeAccount).not.toHaveBeenCalled();
    expect(eventBus.publishEvent).not.toHaveBeenCalled();
    const payload = (log.info.mock.calls.find(
      (c) => (c[0] as Record<string, unknown>)?.purged === 0,
    )?.[0] ?? {}) as Record<string, unknown>;
    expect(payload.purged).toBe(0);
    expect(payload.errors).toBe(0);
  });
});
