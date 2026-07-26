import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryPersistence } from "../../src/persistence/memory.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

const auditInput = { actorUserId: "session-user", ipAddress: "127.0.0.1", metadata: { routeKey: "test" } } as const;

async function seedUser(persistence: MemoryPersistence, email: string): Promise<string> {
  const claims: OAuthClaims = {
    email,
    emailVerified: true,
    name: "Owner",
    picture: undefined,
  };
  const result = await persistence.resolveOrCreateUser("google", `sub-${email}`, claims);
  return result.userId;
}

describe("MemoryPersistence account mutations", () => {
  let persistence: MemoryPersistence;
  let userId: string;

  beforeEach(async () => {
    persistence = new MemoryPersistence();
    userId = await seedUser(persistence, "memory-account-mutations@example.com");
  });

  afterEach(async () => {
    await persistence.close();
  });

  it("createAccount returns account, seeded fee profile, and canonical capabilities", async () => {
    const result = await persistence.createAccount({
      userId,
      name: "USD Wallet",
      defaultCurrency: "USD",
      accountType: "wallet",
      auditInput,
    });

    expect(result.account).toMatchObject({
      name: "USD Wallet",
      defaultCurrency: "USD",
      accountType: "wallet",
    });
    expect(result.feeProfile).toMatchObject({
      id: result.account.feeProfileId,
      accountId: result.account.id,
      commissionCurrency: "USD",
    });
    expect(result.capabilities).toEqual({
      configuredMarkets: ["TW", "US"],
      configuredCurrencies: ["TWD", "USD"],
    });
  });

  it("updateAccount enforces fee-profile ownership and currency-change guard without loading unrelated history", async () => {
    const created = await persistence.createAccount({
      userId,
      name: "Guard Target",
      defaultCurrency: "USD",
      accountType: "broker",
      auditInput,
    });
    const other = await persistence.createAccount({
      userId,
      name: "Other Account",
      defaultCurrency: "AUD",
      accountType: "bank",
      auditInput,
    });

    await expect(persistence.updateAccount({
      userId,
      accountId: created.account.id,
      feeProfileId: other.feeProfile.id,
      auditInput,
    })).rejects.toMatchObject({ statusCode: 400, code: "invalid_fee_profile" });

    const store = await persistence.loadStore(userId);
    store.accounting.facts.tradeEvents.push({
      id: "trade-1",
      userId,
      accountId: created.account.id,
      ticker: "AAPL",
      marketCode: "US",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "USD",
      tradeDate: "2026-07-26",
      tradeTimestamp: "2026-07-26T00:00:00.000Z",
      bookingSequence: 1,
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: created.feeProfile,
      source: "MANUAL",
      bookedAt: "2026-07-26T00:00:00.000Z",
      feesSource: "MANUAL",
    });

    await expect(persistence.updateAccount({
      userId,
      accountId: created.account.id,
      defaultCurrency: "TWD",
      auditInput,
    })).rejects.toMatchObject({ statusCode: 409, code: "currency_change_blocked" });
  });
});
