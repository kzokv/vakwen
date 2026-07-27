import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { signSessionCookie } from "../../src/auth/googleOAuth.js";
import type { OAuthClaims } from "../../src/persistence/types.js";

let app: AppInstance;
let sessionCookie: string;
let ownerUserId: string;

const testOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("account mutation routes", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    const claims: OAuthClaims = {
      email: "route-tests@example.com",
      emailVerified: true,
      name: "Route Tester",
      picture: undefined,
    };
    const auth = await app.persistence.resolveOrCreateUser("google", "route-tests-sub", claims);
    ownerUserId = auth.userId;
    sessionCookie = `g_auth_session=${signSessionCookie(auth.userId, testOAuthConfig.sessionSecret, auth.sessionVersion)}`;
  });

  afterEach(async () => {
    if (app) await app.close();
    vi.restoreAllMocks();
  });

  it("POST /accounts uses the specialized persistence write and never falls back to loadStore/saveStore", async () => {
    const loadStoreSpy = vi.spyOn(app.persistence, "loadStore").mockRejectedValue(
      new Error("POST /accounts should not call loadStore"),
    );
    const saveStoreSpy = vi.spyOn(app.persistence, "saveStore").mockRejectedValue(
      new Error("POST /accounts should not call saveStore"),
    );
    const createAccountSpy = vi.spyOn(app.persistence, "createAccount");

    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        name: "Route Create",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(createAccountSpy).toHaveBeenCalledTimes(1);
    expect(loadStoreSpy).not.toHaveBeenCalled();
    expect(saveStoreSpy).not.toHaveBeenCalled();
  });

  it("POST /accounts returns the committed result when post-commit fanout target lookup fails", async () => {
    vi.spyOn(app.persistence, "listSharesForOwner").mockRejectedValue(
      new Error("fanout target lookup unavailable"),
    );

    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        name: "Committed Create",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: {
        name: "Committed Create",
        defaultCurrency: "USD",
      },
    });
    await expect(app.persistence.listActiveAccounts(ownerUserId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Committed Create", defaultCurrency: "USD" }),
      ]),
    );
  });

  it("POST /accounts returns the committed result when reporting-currency enrichment fails", async () => {
    vi.spyOn(app.persistence, "getUserPreferences").mockRejectedValue(
      new Error("preferences unavailable"),
    );

    const response = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        name: "Committed Create Without Preferences",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: {
        name: "Committed Create Without Preferences",
        defaultCurrency: "USD",
      },
      reportingCurrency: {
        requested: null,
        effective: "TWD",
        reason: null,
      },
    });
    await expect(app.persistence.listActiveAccounts(ownerUserId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Committed Create Without Preferences",
          defaultCurrency: "USD",
        }),
      ]),
    );
  });

  it("PATCH /accounts/:id uses the specialized persistence write and never falls back to loadStore/saveStore", async () => {
    const loadStoreSpy = vi.spyOn(app.persistence, "loadStore").mockRejectedValue(
      new Error("PATCH /accounts/:id should not call loadStore"),
    );
    const saveStoreSpy = vi.spyOn(app.persistence, "saveStore").mockRejectedValue(
      new Error("PATCH /accounts/:id should not call saveStore"),
    );
    const updateAccountSpy = vi.spyOn(app.persistence, "updateAccount");

    const response = await app.inject({
      method: "PATCH",
      url: "/accounts/acc-1",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        accountType: "wallet",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(updateAccountSpy).toHaveBeenCalledTimes(1);
    expect(loadStoreSpy).not.toHaveBeenCalled();
    expect(saveStoreSpy).not.toHaveBeenCalled();
  });

  it("PATCH /accounts/:id returns the committed result when post-commit event delivery fails", async () => {
    vi.spyOn(app.eventBus, "publishEvent").mockRejectedValue(new Error("event delivery unavailable"));

    const response = await app.inject({
      method: "PATCH",
      url: "/accounts/acc-1",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        accountType: "wallet",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: {
        id: "acc-1",
        accountType: "wallet",
      },
    });
    await expect(app.persistence.listActiveAccounts(ownerUserId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "acc-1", accountType: "wallet" }),
      ]),
    );
  });

  it("PATCH /accounts/:id returns the committed result when reporting-currency enrichment fails", async () => {
    vi.spyOn(app.persistence, "getUserPreferences").mockRejectedValue(
      new Error("preferences unavailable"),
    );

    const response = await app.inject({
      method: "PATCH",
      url: "/accounts/acc-1",
      headers: {
        cookie: sessionCookie,
      },
      payload: {
        accountType: "wallet",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      account: {
        id: "acc-1",
        accountType: "wallet",
      },
      reportingCurrency: {
        requested: null,
        effective: "TWD",
        reason: null,
      },
    });
    await expect(app.persistence.listActiveAccounts(ownerUserId)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "acc-1", accountType: "wallet" }),
      ]),
    );
  });

  it("DELETE /accounts/:id returns the authoritative lifecycle delta and falls owner reporting currency to remaining USD", async () => {
    await app.persistence._setUserPreferences(ownerUserId, { reportingCurrency: "TWD" });

    const created = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { cookie: sessionCookie },
      payload: {
        name: "Route Delete USD",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });
    expect(created.statusCode).toBe(200);

    const deleted = await app.inject({
      method: "DELETE",
      url: "/accounts/acc-1",
      headers: { cookie: sessionCookie },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      accountId: "acc-1",
      account: {
        id: "acc-1",
        defaultCurrency: "TWD",
      },
      deletedAt: expect.any(String),
      finalName: null,
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
    await expect(app.persistence.getUserPreferences(ownerUserId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });

  it("DELETE /accounts/:id clears the owner reporting currency when zero accounts remain", async () => {
    await app.persistence._setUserPreferences(ownerUserId, { reportingCurrency: "TWD", locale: "en" });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/accounts/acc-1",
      headers: { cookie: sessionCookie },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      accountId: "acc-1",
      deletedAt: expect.any(String),
      capabilities: {
        configuredMarkets: [],
        configuredCurrencies: [],
      },
      reportingCurrency: {
        requested: null,
        effective: null,
        reason: "no_configured_currencies",
      },
    });
    await expect(app.persistence.getUserPreferences(ownerUserId)).resolves.toEqual({ locale: "en" });
  });

  it("POST /accounts/:id/restore preserves the owner fallback currency instead of restoring the old one", async () => {
    await app.persistence._setUserPreferences(ownerUserId, { reportingCurrency: "TWD" });
    await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { cookie: sessionCookie },
      payload: {
        name: "Route Restore USD",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });
    await app.inject({
      method: "DELETE",
      url: "/accounts/acc-1",
      headers: { cookie: sessionCookie },
    });

    const restored = await app.inject({
      method: "POST",
      url: "/accounts/acc-1/restore",
      headers: { cookie: sessionCookie },
    });

    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      accountId: "acc-1",
      finalName: "Main",
      account: {
        id: "acc-1",
        name: "Main",
      },
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
      reportingCurrency: {
        requested: "USD",
        effective: "USD",
        reason: null,
      },
      feeProfiles: [
        {
          accountId: "acc-1",
        },
      ],
      feeProfileBindings: [],
    });
    await expect(app.persistence.getUserPreferences(ownerUserId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });

  it("POST /accounts/:id/purge returns the authoritative fallback after purging an active account", async () => {
    await app.persistence._setUserPreferences(ownerUserId, { reportingCurrency: "TWD" });
    await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { cookie: sessionCookie },
      payload: {
        name: "Purge fallback USD",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });

    const purged = await app.inject({
      method: "POST",
      url: "/accounts/acc-1/purge",
      headers: { cookie: sessionCookie },
      payload: { confirmationName: "Main" },
    });

    expect(purged.statusCode).toBe(200);
    expect(purged.json()).toMatchObject({
      accountId: "acc-1",
      deletedAt: null,
      finalName: null,
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
    await expect(app.persistence.getUserPreferences(ownerUserId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
  });

  it("shared delete preserves the viewer preference in the response, leaves viewer prefs untouched, and fans SSE out to active grantees only", async () => {
    const ownerPublishSpy = vi.spyOn(app.eventBus, "publishEvent");
    await app.persistence._setUserPreferences(ownerUserId, { reportingCurrency: "TWD" });
    await app.inject({
      method: "POST",
      url: "/accounts",
      headers: { cookie: sessionCookie },
      payload: {
        name: "Viewer USD",
        defaultCurrency: "USD",
        accountType: "broker",
      },
    });

    const viewer = await app.persistence.resolveOrCreateUser("google", "route-tests-viewer-sub", {
      email: "route-tests-viewer@example.com",
      emailVerified: true,
      name: "Route Viewer",
      picture: undefined,
    });
    const viewerCookie = `g_auth_session=${signSessionCookie(
      viewer.userId,
      testOAuthConfig.sessionSecret,
      viewer.sessionVersion,
    )}`;
    await app.persistence._setUserPreferences(viewer.userId, { reportingCurrency: "AUD" });
    const activeShare = await app.persistence.createShareGrant({
      ownerUserId,
      granteeUserId: viewer.userId,
      auditInput: { actorUserId: ownerUserId, ipAddress: null, metadata: {} },
    });
    await app.persistence.setShareCapabilities({
      shareId: activeShare.id,
      capabilities: ["portfolio:mcp_read", "account:manage"],
      grantedByUserId: ownerUserId,
    });

    const revokedViewer = await app.persistence.resolveOrCreateUser("google", "route-tests-revoked-sub", {
      email: "route-tests-revoked@example.com",
      emailVerified: true,
      name: "Route Revoked",
      picture: undefined,
    });
    const revokedShare = await app.persistence.createShareGrant({
      ownerUserId,
      granteeUserId: revokedViewer.userId,
      auditInput: { actorUserId: ownerUserId, ipAddress: null, metadata: {} },
    });
    await app.persistence.revokeShareGrant(revokedShare.id, {
      ownerUserId,
      revokedByUserId: ownerUserId,
      auditInput: { actorUserId: ownerUserId, ipAddress: null, metadata: {} },
    });
    await app.persistence.createShareCoupledInvite({
      ownerUserId,
      email: "pending-share@example.com",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      issuedByUserId: ownerUserId,
    });

    const deleted = await app.inject({
      method: "DELETE",
      url: "/accounts/acc-1",
      headers: {
        cookie: viewerCookie,
        "x-context-user-id": ownerUserId,
      },
    });

    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({
      reportingCurrency: {
        requested: "AUD",
        effective: "USD",
        reason: "unconfigured_currency",
      },
      capabilities: {
        configuredMarkets: ["US"],
        configuredCurrencies: ["USD"],
      },
    });
    await expect(app.persistence.getUserPreferences(ownerUserId)).resolves.toMatchObject({
      reportingCurrency: "USD",
    });
    await expect(app.persistence.getUserPreferences(viewer.userId)).resolves.toMatchObject({
      reportingCurrency: "AUD",
    });

    const lifecycleCalls = ownerPublishSpy.mock.calls.filter((call) => call[1] === "account_soft_deleted");
    expect(lifecycleCalls).toHaveLength(2);
    expect(lifecycleCalls.map((call) => call[0]).sort()).toEqual([ownerUserId, viewer.userId].sort());
    expect(lifecycleCalls.every(
      (call) => (call[2] as { accountId?: string } | undefined)?.accountId === "acc-1",
    )).toBe(true);
    expect(lifecycleCalls.find((call) => call[0] === ownerUserId)?.[2]).toMatchObject({
      reportingCurrency: {
        requested: "USD",
        effective: "USD",
        reason: null,
      },
    });
    expect(lifecycleCalls.find((call) => call[0] === viewer.userId)?.[2]).toMatchObject({
      reportingCurrency: {
        requested: "AUD",
        effective: "USD",
        reason: "unconfigured_currency",
      },
    });
    expect(activeShare.granteeUserId).toBe(viewer.userId);
  });
});
