import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InjectOptions, LightMyRequestResponse } from "fastify";
import type { ShareCapability } from "@vakwen/shared-types";
import { buildApp } from "../../src/app.js";
import { signSessionCookie, type GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { createDividendEvent } from "../../src/services/dividends.js";
import { replayPositionHistory } from "../../src/services/replayPositionHistory.js";

const SESSION_COOKIE_NAME = "g_auth_session";
const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("shared-context delegated capabilities", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let userSequence = 0;

  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory", oauthConfig: testOAuthConfig });
    await (app.persistence as typeof app.persistence & { ensureDevBypassUser(): Promise<void> }).ensureDevBypassUser();
    const originalInject = app.inject.bind(app) as (
      options: string | InjectOptions,
    ) => Promise<LightMyRequestResponse>;
    app.inject = (async (options: string | InjectOptions) => {
      let nextOptions = options;
      if (typeof options === "object" && options && "headers" in options) {
        const headers = { ...(options.headers ?? {}) } as Record<string, string>;
        if (!headers.cookie) {
          const viewerUserId = headers["x-user-id"];
          if (viewerUserId) {
            const authUser = await app.persistence.getAuthUserById(viewerUserId);
            if (authUser) {
              headers.cookie = `${SESSION_COOKIE_NAME}=${signSessionCookie(
                viewerUserId,
                testOAuthConfig.sessionSecret,
                authUser.sessionVersion,
              )}`;
              nextOptions = {
                ...options,
                headers,
              };
            }
          }
        }
      }
      return originalInject(nextOptions);
    }) as unknown as typeof app.inject;
  });

  afterEach(async () => {
    await app.close();
  });

  async function createViewerShare(capabilities: ShareCapability[]) {
    const { userId: viewerUserId } = await app.persistence.resolveOrCreateUser("google", "shared-context-viewer-sub", {
      email: "shared-context-viewer@example.com",
      name: "Shared Context Viewer",
    });
    const authUser = await app.persistence.getAuthUserById(viewerUserId);
    if (!authUser) throw new Error("expected viewer auth user");
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: viewerUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities,
      grantedByUserId: "user-1",
    });
    const cookieHeader = `${SESSION_COOKIE_NAME}=${signSessionCookie(
      viewerUserId,
      testOAuthConfig.sessionSecret,
      authUser.sessionVersion,
    )}`;
    return { shareId: share.id, viewerUserId, cookieHeader };
  }

  async function createUser(label: string) {
    userSequence += 1;
    const slug = `${label}-${userSequence}`;
    const email = `${slug}@example.com`;
    const result = await app.persistence.resolveOrCreateUser("google", `${slug}-sub`, {
      email,
      name: slug,
    });
    return {
      ...result,
      email,
    };
  }

  async function seedSharedDividendForOwner() {
    const store = await app.persistence.loadStore("user-1");
    store.accounting.facts.tradeEvents.push({
      id: "shared-dividend-buy-1",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1000,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    store.accounting.facts.tradeEvents.push({
      id: "shared-dividend-buy-2",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 500,
      unitPrice: 102,
      priceCurrency: "TWD",
      tradeDate: "2026-01-03",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    });
    createDividendEvent(store, {
      id: "shared-dividend-write-event",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH_AND_STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 1,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0.1,
      stockDistributionAmountRaw: 0,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
      stockParValueAmount: 10,
      stockParValueCurrency: "TWD",
      source: "test",
    });
    await app.persistence.saveStore(store);
    await replayPositionHistory(app.persistence, "user-1", "acc-1", "2330", { marketCode: "TW" });
  }

  it("[shared transaction write]: viewer with transaction:write can create and patch owner transaction", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);
    const commitMutation = vi.spyOn(app.persistence, "commitPostedTransactionMutation");

    const created = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-context-create-transaction-1",
      },
      payload: {
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        type: "BUY",
        isDayTrade: false,
      },
    });

    expect(created.statusCode).toBe(200);
    const tradeId = created.json<{ id: string }>().id;
    const ownerTrade = await app.persistence.getTradeEvent("user-1", tradeId);
    expect(ownerTrade).toBeTruthy();

    const patched = await app.inject({
      method: "PATCH",
      url: `/portfolio/transactions/${tradeId}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        quantity: 2,
      },
    });
    expect(patched.statusCode).toBe(202);
    expect(commitMutation).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user-1",
      auditEntry: expect.objectContaining({ actorUserId: viewerUserId }),
      run: expect.objectContaining({ actorUserId: viewerUserId }),
      replayRun: expect.objectContaining({ sessionUserId: viewerUserId }),
    }));
  });

  it("[shared transaction write]: viewer without transaction:write gets shared_capability_required", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-context-create-transaction-2",
      },
      payload: {
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        type: "BUY",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "POST /portfolio/transactions",
      },
    });
  });

  it("[shared read]: viewer with portfolio:mcp_read gets owner fee-config capabilities", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);
    const ownerStore = await app.persistence.loadStore("user-1");
    ownerStore.accounts.push({
      id: "owner-us-1",
      userId: "user-1",
      name: "Owner US Broker",
      defaultCurrency: "USD",
      accountType: "broker",
      feeProfileId: "owner-us-fee-1",
    });
    ownerStore.feeProfiles.push({
      ...ownerStore.feeProfiles[0]!,
      id: "owner-us-fee-1",
      accountId: "owner-us-1",
      commissionCurrency: "USD",
      name: "Owner US Fee",
    });

    const response = await app.inject({
      method: "GET",
      url: "/settings/fee-config",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      accounts: expect.arrayContaining([
        expect.objectContaining({ id: "acc-1", userId: "user-1" }),
        expect.objectContaining({ id: "owner-us-1", userId: "user-1" }),
      ]),
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
    }));
  });

  it("[shared read]: viewer with portfolio:mcp_read gets owner report capabilities", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);
    const ownerStore = await app.persistence.loadStore("user-1");
    const ownerFeeProfile = ownerStore.feeProfiles[0];
    if (!ownerFeeProfile) throw new Error("expected owner default fee profile");
    ownerStore.accounts.push(
      {
        id: "owner-us-1",
        userId: "user-1",
        name: "Owner US Broker",
        defaultCurrency: "USD",
        accountType: "broker",
        feeProfileId: "owner-us-fee-1",
      },
      {
        id: "owner-us-2",
        userId: "user-1",
        name: "Owner US Wallet",
        defaultCurrency: "USD",
        accountType: "wallet",
        feeProfileId: "owner-us-fee-2",
      },
    );
    ownerStore.feeProfiles.push(
      {
        ...ownerFeeProfile,
        id: "owner-us-fee-1",
        accountId: "owner-us-1",
        commissionCurrency: "USD",
        name: "Owner US Fee",
      },
      {
        ...ownerFeeProfile,
        id: "owner-us-fee-2",
        accountId: "owner-us-2",
        commissionCurrency: "USD",
        name: "Owner US Wallet Fee",
      },
    );
    ownerStore.accounting.projections.holdings.push({
      accountId: "acc-1",
      ticker: "2330",
      quantity: 1,
      costBasisAmount: 100,
      currency: "TWD",
    });
    ownerStore.accounting.facts.tradeEvents.push({
      id: "owner-report-buy-1",
      userId: "user-1",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      instrumentType: "STOCK",
      type: "BUY",
      quantity: 1,
      unitPrice: 100,
      priceCurrency: "TWD",
      tradeDate: "2026-01-02",
      commissionAmount: 0,
      taxAmount: 0,
      isDayTrade: false,
      feeSnapshot: ownerFeeProfile,
    });
    await app.persistence.saveStore(ownerStore);

    const response = await app.inject({
      method: "GET",
      url: "/reports/portfolio?scope=all&range=1Y",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
      query: expect.objectContaining({
        scope: "all",
      }),
    }));
  });

  it("[shared read]: viewer with portfolio:mcp_read gets owner dashboard capabilities", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);
    const ownerStore = await app.persistence.loadStore("user-1");
    const ownerFeeProfile = ownerStore.feeProfiles[0];
    if (!ownerFeeProfile) throw new Error("expected owner default fee profile");
    ownerStore.accounts.push({
      id: "owner-us-1",
      userId: "user-1",
      name: "Owner US Broker",
      defaultCurrency: "USD",
      accountType: "broker",
      feeProfileId: "owner-us-fee-1",
    });
    ownerStore.feeProfiles.push({
      ...ownerFeeProfile,
      id: "owner-us-fee-1",
      accountId: "owner-us-1",
      commissionCurrency: "USD",
      name: "Owner US Fee",
    });
    await app.persistence.saveStore(ownerStore);

    const response = await app.inject({
      method: "GET",
      url: "/dashboard/overview",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(expect.objectContaining({
      capabilities: {
        configuredMarkets: ["TW", "US"],
        configuredCurrencies: ["TWD", "USD"],
      },
    }));
  });

  it("[shared sell availability]: viewer with transaction:write can read owner sell availability", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=acc-1&ticker=2330&marketCode=TW&tradeDate=2026-01-02",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(200);
  });

  it("[shared sell availability]: unknown owner account returns the stable not-found contract", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=missing-account&ticker=2330&marketCode=TW&tradeDate=2026-01-02",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({
      error: "account_not_found",
      message: "Account not found",
    });
  });

  it("[shared sell availability]: viewer without transaction:write gets shared_capability_required", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/transactions/sell-availability?accountId=acc-1&ticker=2330&marketCode=TW&tradeDate=2026-01-02",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "GET /portfolio/transactions/sell-availability",
      },
    });
  });

  it("[shared transaction mutation]: delegated actor can open its preview and run deep links", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);
    const headers = {
      "x-user-id": viewerUserId,
      "x-user-role": "viewer",
      "x-context-user-id": "user-1",
    };
    const created = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { ...headers, "idempotency-key": "shared-context-mutation-link-1" },
      payload: {
        accountId: "acc-1",
        ticker: "2330",
        marketCode: "TW",
        quantity: 1,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-02",
        type: "BUY",
      },
    });
    expect(created.statusCode).toBe(200);
    const transactionId = created.json<{ id: string }>().id;

    const previewResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/mutations/update-preview",
      headers,
      payload: {
        reason: "Correct delegated transaction",
        items: [{ transactionId, patch: { quantity: 2 } }],
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    const preview = previewResponse.json<{
      previewId: string;
      previewVersion: number;
      operation: "update";
      fingerprint: string;
      confirmationSummary: string;
      confirmationDigest: string;
      deepLinks: {
        previewPath: string;
        transactionPath: string;
        previewUrl: string;
      };
    }>();
    expect(preview.deepLinks).toMatchObject({
      previewPath: `/transactions/mutations/previews/${preview.previewId}?as=user-1`,
      transactionPath: "/transactions?as=user-1",
    });
    expect(preview.deepLinks.previewUrl.endsWith(
      `/transactions/mutations/previews/${preview.previewId}?as=user-1`,
    )).toBe(true);

    const previewLink = await app.inject({
      method: "GET",
      url: `/portfolio/transactions/mutations/previews/${preview.previewId}`,
      headers,
    });
    expect(previewLink.statusCode).toBe(200);

    const confirmed = await app.inject({
      method: "POST",
      url: `/portfolio/transactions/mutations/previews/${preview.previewId}/confirm`,
      headers,
      payload: {
        previewVersion: preview.previewVersion,
        operation: preview.operation,
        fingerprint: preview.fingerprint,
        confirmationSummary: preview.confirmationSummary,
        confirmationDigest: preview.confirmationDigest,
      },
    });
    expect(confirmed.statusCode).toBe(200);
    const run = confirmed.json<{
      runId: string;
      deepLinks: { previewPath: string; runPath: string; transactionPath: string; runUrl: string };
    }>();
    const runId = run.runId;
    expect(run.deepLinks).toMatchObject({
      previewPath: `/transactions/mutations/previews/${preview.previewId}?as=user-1`,
      runPath: `/transactions/mutations/runs/${runId}?as=user-1`,
      transactionPath: "/transactions?as=user-1",
    });
    expect(run.deepLinks.runUrl.endsWith(`/transactions/mutations/runs/${runId}?as=user-1`)).toBe(true);

    const runLink = await app.inject({
      method: "GET",
      url: `/portfolio/transactions/mutations/runs/${runId}`,
      headers,
    });
    expect(runLink.statusCode).toBe(200);
    expect(runLink.json()).toMatchObject({ runId, previewId: preview.previewId });
  });

  it("[shared transaction mutation]: viewer without transaction:write cannot preview or confirm mutations", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);
    const headers = {
      "x-user-id": viewerUserId,
      "x-user-role": "viewer",
      "x-context-user-id": "user-1",
    };
    const requests = [
      {
        url: "/portfolio/transactions/mutations/update-preview",
        payload: {
          reason: "Unauthorized correction attempt",
          items: [{ transactionId: "shared-guard-trade", patch: { quantity: 2 } }],
        },
        routeKey: "POST /portfolio/transactions/mutations/update-preview",
      },
      {
        url: "/portfolio/transactions/mutations/delete-preview",
        payload: {
          reason: "Unauthorized deletion attempt",
          items: [{ transactionId: "shared-guard-trade" }],
        },
        routeKey: "POST /portfolio/transactions/mutations/delete-preview",
      },
      {
        url: "/portfolio/transactions/mutations/previews/shared-guard-preview/confirm",
        payload: {
          previewVersion: 1,
          operation: "update",
          fingerprint: "shared-guard-fingerprint",
          confirmationSummary: "Unauthorized confirmation attempt",
          confirmationDigest: "shared-guard-digest",
        },
        routeKey: "POST /portfolio/transactions/mutations/previews/:previewId/confirm",
      },
    ] as const;

    for (const request of requests) {
      const response = await app.inject({
        method: "POST",
        url: request.url,
        headers,
        payload: request.payload,
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: "shared_capability_required",
        metadata: {
          requiredCapability: "transaction:write",
          routeKey: request.routeKey,
        },
      });
    }
  });

  it("[shared transaction mutation]: dividend-impact previews require dividend:write before persistence", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);
    await seedSharedDividendForOwner();
    const savePreview = vi.spyOn(app.persistence, "savePostedTransactionMutationPreview");
    const headers = {
      "x-user-id": viewerUserId,
      "x-user-role": "viewer",
      "x-context-user-id": "user-1",
    };
    const previewResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/mutations/update-preview",
      headers,
      payload: {
        reason: "Move purchases beyond dividend eligibility",
        items: [
          { transactionId: "shared-dividend-buy-1", patch: { tradeDate: "2026-02-02" } },
          { transactionId: "shared-dividend-buy-2", patch: { tradeDate: "2026-02-03" } },
        ],
      },
    });
    expect(previewResponse.statusCode).toBe(403);
    expect(previewResponse.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "dividend:write",
        routeKey: "POST /portfolio/transactions/mutations/update-preview",
      },
    });
    expect(savePreview).not.toHaveBeenCalled();

    const deletePreview = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/mutations/delete-preview",
      headers,
      payload: {
        reason: "Remove delegated dividend-eligible transactions",
        items: [
          { transactionId: "shared-dividend-buy-1" },
          { transactionId: "shared-dividend-buy-2" },
        ],
      },
    });
    expect(deletePreview.statusCode).toBe(403);
    expect(deletePreview.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "dividend:write",
        routeKey: "POST /portfolio/transactions/mutations/delete-preview",
      },
    });
    expect(savePreview).not.toHaveBeenCalled();

    const ownerStore = await app.persistence.loadStore("user-1");
    ownerStore.accounting.facts.tradeEvents = ownerStore.accounting.facts.tradeEvents.filter(
      (trade) => trade.id !== "shared-dividend-buy-2",
    );
    await app.persistence.saveStore(ownerStore);
    await replayPositionHistory(app.persistence, "user-1", "acc-1", "2330", { marketCode: "TW" });

    const legacyPatch = await app.inject({
      method: "PATCH",
      url: "/portfolio/transactions/shared-dividend-buy-1",
      headers,
      payload: {
        date: "2026-02-02",
      },
    });
    expect(legacyPatch.statusCode).toBe(403);
    expect(legacyPatch.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "dividend:write",
        routeKey: "PATCH /portfolio/transactions/:tradeEventId",
      },
    });
    expect(savePreview).not.toHaveBeenCalled();
  });

  it("[shared dividend write]: viewer with dividend:write can post and reconcile owner dividend entries", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "dividend:write"]);
    await seedSharedDividendForOwner();

    const posted = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-dividend-posting-1",
      },
      payload: {
        accountId: "acc-1",
        dividendEventId: "shared-dividend-write-event",
        receivedCashAmount: 950,
        receivedStockQuantity: 0,
        deductions: [{
          id: "shared-dividend-deduction",
          deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
          amount: 50,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "test",
        }],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      },
    });

    expect(posted.statusCode).toBe(200);
    const ledgerId = posted.json<{ dividendLedgerEntry: { id: string } }>().dividendLedgerEntry.id;

    const amended = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-dividend-posting-amend-1",
      },
      payload: {
        accountId: "acc-1",
        dividendEventId: "shared-dividend-write-event",
        dividendLedgerEntryId: ledgerId,
        expectedVersion: 1,
        receivedCashAmount: 940,
        receivedStockQuantity: 0,
        deductions: [],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      },
    });
    expect(amended.statusCode).toBe(200);

    const reconciled = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerId}/reconciliation`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        status: "matched",
        expectedVersion: 1,
      },
    });

    expect(reconciled.statusCode).toBe(200);

    const delegatedAudits = (app.persistence as unknown as {
      auditLog: Array<{ action: string; metadata: Record<string, unknown> }>;
    }).auditLog.filter((entry) => entry.action === "delegated_portfolio_write");
    expect(delegatedAudits).toEqual(expect.arrayContaining([
      expect.objectContaining({
        metadata: expect.objectContaining({
          mutation: "dividend_posted",
          dividendLedgerEntryId: ledgerId,
          delegatedByUserId: viewerUserId,
          ownerUserId: "user-1",
        }),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          mutation: "dividend_posting_updated",
          dividendLedgerEntryId: ledgerId,
          delegatedByUserId: viewerUserId,
          ownerUserId: "user-1",
        }),
      }),
      expect.objectContaining({
        metadata: expect.objectContaining({
          mutation: "dividend_reconciliation_updated",
          dividendLedgerEntryId: ledgerId,
          delegatedByUserId: viewerUserId,
          ownerUserId: "user-1",
        }),
      }),
    ]));
  });

  it("[shared dividend write]: viewer with transaction:write and dividend:write can preview and confirm owner destructive dividend deletion", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write", "dividend:write"]);
    await seedSharedDividendForOwner();

    const preview = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/shared-dividend-buy-2/dividend-delete-preview",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { reason: "Delegated cleanup" },
    });

    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      operation: {
        kind: "trade_delete",
        accountId: "acc-1",
        targetTradeEventId: "shared-dividend-buy-2",
      },
      affectedGroups: {
        source: {
          tradeEventIds: ["shared-dividend-buy-2"],
        },
        derived: {
          dividendLedgerEntryIds: [expect.any(String)],
        },
      },
    });

    const previewBody = preview.json<{
      preview: { previewId: string; previewVersion: number; fingerprint: string };
    }>();
    const confirmed = await app.inject({
      method: "POST",
      url: "/portfolio/transactions/shared-dividend-buy-2/dividend-delete-confirm",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        previewId: previewBody.preview.previewId,
        previewVersion: previewBody.preview.previewVersion,
        fingerprint: previewBody.preview.fingerprint,
      },
    });

    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({
      preview: {
        consumedResult: "confirmed",
      },
    });
  });

  it("[shared dividend write]: viewer without dividend:write gets shared_capability_required", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "transaction:write"]);

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
        "idempotency-key": "shared-dividend-posting-denied",
      },
      payload: {
        accountId: "acc-1",
        dividendEventId: "missing-event",
        receivedCashAmount: 1,
        receivedStockQuantity: 0,
        deductions: [],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      },
    });

    expect(postingResponse.statusCode).toBe(403);
    expect(postingResponse.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "dividend:write",
        routeKey: "POST /portfolio/dividends/postings",
      },
    });

    const destructivePreviewResponse = await app.inject({
      method: "POST",
      url: `/portfolio/transactions/${randomUUID()}/dividend-delete-preview`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { reason: "Denied destructive preview" },
    });

    expect(destructivePreviewResponse.statusCode).toBe(403);
    expect(destructivePreviewResponse.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "dividend:write",
        routeKey: "POST /portfolio/transactions/:tradeEventId/dividend-delete-preview",
      },
    });

    const cutoffPreviewResponse = await app.inject({
      method: "POST",
      url: "/portfolio/accounts/acc-1/purge-rebuild-preview",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { cutoffDate: "2026-01-01", reason: "Denied cutoff without dividend write" },
    });
    expect(cutoffPreviewResponse.statusCode).toBe(403);
    expect(cutoffPreviewResponse.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "dividend:write",
        routeKey: "POST /portfolio/accounts/:accountId/purge-rebuild-preview",
      },
    });
  });

  it("[shared transaction delete]: viewer with dividend:write but without transaction:write is denied", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "dividend:write"]);

    const response = await app.inject({
      method: "POST",
      url: `/portfolio/transactions/${randomUUID()}/dividend-delete-preview`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { reason: "Denied without transaction write" },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "POST /portfolio/transactions/:tradeEventId/dividend-delete-preview",
      },
    });

    const cutoffResponse = await app.inject({
      method: "POST",
      url: "/portfolio/accounts/acc-1/purge-rebuild-preview",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { cutoffDate: "2026-01-01", reason: "Denied cutoff without transaction write" },
    });
    expect(cutoffResponse.statusCode).toBe(403);
    expect(cutoffResponse.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        requiredCapability: "transaction:write",
        routeKey: "POST /portfolio/accounts/:accountId/purge-rebuild-preview",
      },
    });
  });

  it("[shared account manage]: viewer with account:manage can create, soft-delete, and restore owner account but cannot purge", async () => {
    const { shareId, viewerUserId } = await createViewerShare(["portfolio:mcp_read", "account:manage"]);

    const created = await app.inject({
      method: "POST",
      url: "/accounts",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        name: "Delegated Account",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(created.statusCode).toBe(200);
    const accountId = created.json<{ id: string }>().id;

    const deleted = await app.inject({
      method: "DELETE",
      url: `/accounts/${accountId}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(deleted.statusCode).toBe(200);

    const restored = await app.inject({
      method: "POST",
      url: `/accounts/${accountId}/restore`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(restored.statusCode).toBe(200);

    const deniedPurge = await app.inject({
      method: "POST",
      url: `/accounts/${accountId}/purge`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        confirmationName: "Delegated Account",
      },
    });
    expect(deniedPurge.statusCode).toBe(403);
    expect(deniedPurge.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        routeKey: "POST /accounts/:id/purge",
      },
    });

    const accountAudit = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog.filter((entry) =>
      entry.action === "account_soft_deleted" || entry.action === "account_restored");
    expect(accountAudit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "account_soft_deleted",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            ownerUserId: "user-1",
            contextUserId: "user-1",
            delegatedByUserId: viewerUserId,
            shareId,
          }),
        }),
        expect.objectContaining({
          action: "account_restored",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            ownerUserId: "user-1",
            contextUserId: "user-1",
            delegatedByUserId: viewerUserId,
            shareId,
          }),
        }),
      ]),
    );
  });

  it("[shared out-of-scope write]: viewer with account:manage cannot hit owner-only write routes", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "account:manage"]);
    const cases: Array<{ method: "POST" | "PUT" | "PATCH" | "DELETE"; url: string; routeKey: string }> = [
      { method: "POST", url: "/portfolio/snapshots/generate", routeKey: "POST /portfolio/snapshots/generate" },
      { method: "POST", url: "/portfolio/refresh-closes", routeKey: "POST /portfolio/refresh-closes" },
      { method: "POST", url: "/portfolio/recompute/preview", routeKey: "POST /portfolio/recompute/preview" },
      { method: "POST", url: "/portfolio/recompute/confirm", routeKey: "POST /portfolio/recompute/confirm" },
      { method: "POST", url: "/fx-transfers", routeKey: "POST /fx-transfers" },
      { method: "PATCH", url: "/fx-transfers/fx-test", routeKey: "PATCH /fx-transfers/:id" },
      { method: "POST", url: "/fx-transfers/fx-test/reverse", routeKey: "POST /fx-transfers/:id/reverse" },
      { method: "POST", url: "/portfolio/dividends/postings", routeKey: "POST /portfolio/dividends/postings" },
      {
        method: "PATCH",
        url: "/portfolio/dividends/postings/dividend-test/reconciliation",
        routeKey: "PATCH /portfolio/dividends/postings/:dividendLedgerEntryId/reconciliation",
      },
      { method: "POST", url: "/corporate-actions", routeKey: "POST /corporate-actions" },
      { method: "PUT", url: "/monitored-tickers", routeKey: "PUT /monitored-tickers" },
      { method: "POST", url: "/backfill/retry", routeKey: "POST /backfill/retry" },
      { method: "POST", url: "/backfill/repair", routeKey: "POST /backfill/repair" },
      { method: "POST", url: "/share-tokens", routeKey: "POST /share-tokens" },
      { method: "DELETE", url: "/share-tokens/share-token-test", routeKey: "DELETE /share-tokens/:id" },
    ];

    for (const testCase of cases) {
      const response = await app.inject({
        method: testCase.method,
        url: testCase.url,
        headers: {
          "x-user-id": viewerUserId,
          "x-user-role": "viewer",
          "x-context-user-id": "user-1",
        },
        payload: testCase.method === "DELETE" ? undefined : {},
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: "shared_capability_required",
        metadata: { routeKey: testCase.routeKey },
      });
    }
  });

  it("[shared sharing manage]: delegated manager can list and manage owner named shares in shared context", async () => {
    const { shareId: delegationShareId, viewerUserId } = await createViewerShare([
      "portfolio:mcp_read",
      "sharing:manage",
      "transaction:write",
    ]);
    const { userId: activeGranteeUserId, email: activeGranteeEmail } = await createUser("owner-active-grantee");
    const ownerShare = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: activeGranteeUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: ownerShare.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });
    const pendingInvite = await app.persistence.createShareCoupledInvite({
      ownerUserId: "user-1",
      email: "owner-pending@example.com",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      issuedByUserId: "user-1",
    });
    await app.persistence.setPendingShareInviteCapabilities({
      inviteCode: pendingInvite.code,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });

    const { userId: viewerOwnedTargetUserId } = await createUser("viewer-owned-target");
    await app.persistence.createShareGrant({
      ownerUserId: viewerUserId,
      granteeUserId: viewerOwnedTargetUserId,
      auditInput: { actorUserId: viewerUserId, ipAddress: "127.0.0.1" },
    });
    const { email: delegatedResolvedEmail } = await createUser("delegated-created-target");

    const listed = await app.inject({
      method: "GET",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      outbound: {
        active: expect.arrayContaining([
          expect.objectContaining({ id: ownerShare.id, granteeEmail: activeGranteeEmail }),
        ]),
        pending: expect.arrayContaining([
          expect.objectContaining({ code: pendingInvite.code, email: "owner-pending@example.com" }),
        ]),
      },
      inbound: { active: [], revoked: [] },
    });

    const created = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        email: delegatedResolvedEmail,
        capabilities: ["portfolio:mcp_read", "transaction:write"],
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      type: "resolved",
      share: expect.objectContaining({
        ownerUserId: "user-1",
        capabilities: ["portfolio:mcp_read", "transaction:write"],
      }),
    });

    const activeUpdate = await app.inject({
      method: "PATCH",
      url: `/shares/${ownerShare.id}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { capabilities: ["portfolio:mcp_read", "transaction:write"] },
    });
    expect(activeUpdate.statusCode).toBe(200);
    expect(activeUpdate.json()).toMatchObject({
      id: ownerShare.id,
      ownerUserId: "user-1",
      capabilities: ["portfolio:mcp_read", "transaction:write"],
    });

    const pendingUpdate = await app.inject({
      method: "PATCH",
      url: `/shares/pending/${pendingInvite.code}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { capabilities: ["portfolio:mcp_read", "transaction:write"] },
    });
    expect(pendingUpdate.statusCode).toBe(200);

    const revokePending = await app.inject({
      method: "DELETE",
      url: `/shares/pending/${pendingInvite.code}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(revokePending.statusCode).toBe(204);

    const revokeActive = await app.inject({
      method: "DELETE",
      url: `/shares/${ownerShare.id}`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });
    expect(revokeActive.statusCode).toBe(204);

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; actorUserId: string | null; metadata: Record<string, unknown> }>;
    }).auditLog;
    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: "share_granted",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            delegatedByUserId: viewerUserId,
            ownerUserId: "user-1",
            delegationShareId,
          }),
        }),
        expect.objectContaining({
          action: "share_revoked",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            delegatedByUserId: viewerUserId,
            ownerUserId: "user-1",
            delegationShareId,
          }),
        }),
        expect.objectContaining({
          action: "admin_invite_revoked",
          actorUserId: viewerUserId,
          metadata: expect.objectContaining({
            delegatedByUserId: viewerUserId,
            ownerUserId: "user-1",
            delegationShareId,
          }),
        }),
      ]),
    );
  });

  it("[shared sharing manage]: direct shared-context /shares access requires sharing:manage", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);

    const response = await app.inject({
      method: "GET",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      error: "shared_capability_required",
      metadata: {
        routeKey: "GET /shares",
        requiredCapability: "sharing:manage",
      },
    });
  });

  it("[shared sharing manage]: delegated manager cannot grant sharing:manage or capabilities outside the active grant set", async () => {
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read", "sharing:manage"]);
    const { userId: granteeUserId } = await createUser("delegation-cap-grantee");
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });

    const forbiddenWrite = await app.inject({
      method: "PATCH",
      url: `/shares/${share.id}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { capabilities: ["portfolio:mcp_read", "transaction:write"] },
    });
    expect(forbiddenWrite.statusCode).toBe(403);
    expect(forbiddenWrite.json()).toMatchObject({
      error: "share_capability_assignment_forbidden",
      metadata: {
        forbiddenCapabilities: ["transaction:write"],
        assignableCapabilities: ["portfolio:mcp_read"],
      },
    });

    const forbiddenManage = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        email: "forbidden-manage@example.com",
        capabilities: ["portfolio:mcp_read", "sharing:manage"],
      },
    });
    expect(forbiddenManage.statusCode).toBe(403);
    expect(forbiddenManage.json()).toMatchObject({
      error: "share_capability_assignment_forbidden",
      metadata: {
        forbiddenCapabilities: ["sharing:manage"],
      },
    });
  });

  it("[share capability audit]: delegated updates include old/new capability arrays and owner/delegated audit metadata", async () => {
    const { shareId: delegationShareId, viewerUserId } = await createViewerShare([
      "portfolio:mcp_read",
      "sharing:manage",
      "account:manage",
    ]);
    const { userId: granteeUserId } = await createUser("cap-audit-grantee");
    const share = await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId,
      auditInput: { actorUserId: "user-1", ipAddress: "127.0.0.1" },
    });
    await app.persistence.setShareCapabilities({
      shareId: share.id,
      capabilities: ["portfolio:mcp_read"],
      grantedByUserId: "user-1",
    });

    const activeUpdate = await app.inject({
      method: "PATCH",
      url: `/shares/${share.id}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { capabilities: ["account:manage", "portfolio:mcp_read"] },
    });
    expect(activeUpdate.statusCode).toBe(200);

    const pendingCreate = await app.inject({
      method: "POST",
      url: "/shares",
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: {
        email: "pending-cap-audit@example.com",
        capabilities: ["portfolio:mcp_read"],
      },
    });
    expect(pendingCreate.statusCode).toBe(201);
    const pendingCode = pendingCreate.json<{ type: "pending"; invite: { code: string } }>().invite.code;

    const pendingUpdate = await app.inject({
      method: "PATCH",
      url: `/shares/pending/${pendingCode}/capabilities`,
      headers: {
        "x-user-id": viewerUserId,
        "x-user-role": "viewer",
        "x-context-user-id": "user-1",
      },
      payload: { capabilities: ["account:manage", "portfolio:mcp_read"] },
    });
    expect(pendingUpdate.statusCode).toBe(200);

    const auditLog = (app.persistence as unknown as {
      auditLog: Array<{ action: string; metadata: Record<string, unknown> }>;
    }).auditLog.filter((entry) => entry.action === "share_capabilities_updated");

    expect(auditLog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          metadata: expect.objectContaining({
            shareId: share.id,
            oldCapabilities: ["portfolio:mcp_read"],
            newCapabilities: ["account:manage", "portfolio:mcp_read"],
            delegatedByUserId: viewerUserId,
            ownerUserId: "user-1",
            delegationShareId,
          }),
        }),
        expect.objectContaining({
          metadata: expect.objectContaining({
            inviteCode: pendingCode,
            oldCapabilities: ["portfolio:mcp_read"],
            newCapabilities: ["account:manage", "portfolio:mcp_read"],
            delegatedByUserId: viewerUserId,
            ownerUserId: "user-1",
            delegationShareId,
          }),
        }),
      ]),
    );
  });

  it("[shared dividend read]: read-only viewer can preview provider provenance but cannot confirm", async () => {
    await seedSharedDividendForOwner();
    const { viewerUserId } = await createViewerShare(["portfolio:mcp_read"]);
    const headers = {
      "x-user-id": viewerUserId,
      "x-user-role": "viewer",
      "x-context-user-id": "user-1",
    };

    const preview = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/preview",
      headers,
      payload: {
        accountId: "acc-1",
        dividendEventId: "shared-dividend-write-event",
        method: "provider_ratio",
      },
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      providerUnit: "RATIO",
      ratio: "0.1",
      expectedWholeShares: 150,
    });

    const confirm = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { ...headers, "idempotency-key": "read-only-confirm" },
      payload: {
        accountId: "acc-1",
        dividendEventId: "shared-dividend-write-event",
        method: "provider_ratio",
        expectedActiveCalculationId: null,
      },
    });
    expect(confirm.statusCode).toBe(403);
  });
});
