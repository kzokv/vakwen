import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { signSessionCookie, type GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";

const SESSION_COOKIE_NAME = "g_auth_session";
const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("portfolio capability read paths", () => {
  let app: AppInstance;
  let ownerHeaders: { cookie: string };

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    await (app.persistence as typeof app.persistence & { ensureDevBypassUser(): Promise<void> }).ensureDevBypassUser();
    const authUser = await app.persistence.getAuthUserById("user-1");
    if (!authUser) throw new Error("expected dev bypass auth user");
    ownerHeaders = {
      cookie: `${SESSION_COOKIE_NAME}=${signSessionCookie(
        "user-1",
        testOAuthConfig.sessionSecret,
        authUser.sessionVersion,
      )}`,
    };
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns empty capabilities from fee-config when the owner has no active accounts", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounts.splice(0, store.accounts.length);
    store.feeProfiles.splice(0, store.feeProfiles.length);
    store.feeProfileBindings.splice(0, store.feeProfileBindings.length);

    const response = await app.inject({
      method: "GET",
      url: "/settings/fee-config",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      accounts: [],
      feeProfiles: [],
      feeProfileBindings: [],
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
    }));
  });

  it("returns canonical deduped capabilities from transactions primary", async () => {
    const store = await app.persistence.loadStore("user-1");
    const defaultFeeProfile = store.feeProfiles[0];
    if (!defaultFeeProfile) throw new Error("expected default fee profile");

    store.accounts.push(
      {
        id: "acc-us-1",
        userId: "user-1",
        name: "US Broker",
        defaultCurrency: "USD",
        accountType: "broker",
        feeProfileId: "fee-us-1",
      },
      {
        id: "acc-au-1",
        userId: "user-1",
        name: "AU Broker",
        defaultCurrency: "AUD",
        accountType: "broker",
        feeProfileId: "fee-au-1",
      },
      {
        id: "acc-us-2",
        userId: "user-1",
        name: "US Wallet",
        defaultCurrency: "USD",
        accountType: "wallet",
        feeProfileId: "fee-us-2",
      },
    );
    store.feeProfiles.push(
      { ...defaultFeeProfile, id: "fee-us-1", accountId: "acc-us-1", commissionCurrency: "USD", name: "US Fee" },
      { ...defaultFeeProfile, id: "fee-au-1", accountId: "acc-au-1", commissionCurrency: "AUD", name: "AU Fee" },
      { ...defaultFeeProfile, id: "fee-us-2", accountId: "acc-us-2", commissionCurrency: "USD", name: "US Wallet Fee" },
    );

    const response = await app.inject({
      method: "GET",
      url: "/transactions/primary",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW", "US", "AU"],
        configuredCurrencies: ["TWD", "USD", "AUD"],
      },
      portfolioConfig: expect.objectContaining({
        capabilities: {
          configuredMarkets: ["TW", "US", "AU"],
          configuredCurrencies: ["TWD", "USD", "AUD"],
        },
      }),
    }));
  });

  it("returns empty capabilities from dashboard primary when the owner has no active accounts", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.accounts.splice(0, store.accounts.length);
    store.feeProfiles.splice(0, store.feeProfiles.length);
    store.feeProfileBindings.splice(0, store.feeProfileBindings.length);

    const response = await app.inject({
      method: "GET",
      url: "/dashboard/primary",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
    }));
  });

  it("returns canonical deduped capabilities from portfolio primary and enrichment reads", async () => {
    const store = await app.persistence.loadStore("user-1");
    const defaultFeeProfile = store.feeProfiles[0];
    if (!defaultFeeProfile) throw new Error("expected default fee profile");

    store.accounts.push(
      {
        id: "acc-us-1",
        userId: "user-1",
        name: "US Broker",
        defaultCurrency: "USD",
        accountType: "broker",
        feeProfileId: "fee-us-1",
      },
      {
        id: "acc-us-2",
        userId: "user-1",
        name: "US Wallet",
        defaultCurrency: "USD",
        accountType: "wallet",
        feeProfileId: "fee-us-2",
      },
    );
    store.feeProfiles.push(
      { ...defaultFeeProfile, id: "fee-us-1", accountId: "acc-us-1", commissionCurrency: "USD", name: "US Fee" },
      { ...defaultFeeProfile, id: "fee-us-2", accountId: "acc-us-2", commissionCurrency: "USD", name: "US Wallet Fee" },
    );

    for (const url of ["/portfolio/primary", "/portfolio/enrichment"]) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: ownerHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual(expect.objectContaining({
        capabilities: {
          configuredMarkets: ["TW", "US"],
          configuredCurrencies: ["TWD", "USD"],
        },
      }));
    }
  });

  it("returns canonical deduped capabilities from dashboard overview", async () => {
    const store = await app.persistence.loadStore("user-1");
    const defaultFeeProfile = store.feeProfiles[0];
    if (!defaultFeeProfile) throw new Error("expected default fee profile");

    store.accounts.push(
      {
        id: "acc-us-1",
        userId: "user-1",
        name: "US Broker",
        defaultCurrency: "USD",
        accountType: "broker",
        feeProfileId: "fee-us-1",
      },
      {
        id: "acc-au-1",
        userId: "user-1",
        name: "AU Broker",
        defaultCurrency: "AUD",
        accountType: "broker",
        feeProfileId: "fee-au-1",
      },
      {
        id: "acc-us-2",
        userId: "user-1",
        name: "US Wallet",
        defaultCurrency: "USD",
        accountType: "wallet",
        feeProfileId: "fee-us-2",
      },
    );
    store.feeProfiles.push(
      { ...defaultFeeProfile, id: "fee-us-1", accountId: "acc-us-1", commissionCurrency: "USD", name: "US Fee" },
      { ...defaultFeeProfile, id: "fee-au-1", accountId: "acc-au-1", commissionCurrency: "AUD", name: "AU Fee" },
      { ...defaultFeeProfile, id: "fee-us-2", accountId: "acc-us-2", commissionCurrency: "USD", name: "US Wallet Fee" },
    );

    const response = await app.inject({
      method: "GET",
      url: "/dashboard/overview",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW", "US", "AU"],
        configuredCurrencies: ["TWD", "USD", "AUD"],
      },
    }));
  });
});
