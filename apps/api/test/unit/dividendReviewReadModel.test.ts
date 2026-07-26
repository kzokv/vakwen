import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp, type AppInstance } from "../../src/app.js";
import { signSessionCookie, type GoogleOAuthConfig } from "../../src/auth/googleOAuth.js";
import { ReadPathTiming } from "../../src/services/readPathTiming.js";
import type { DividendEvent, DividendLedgerEntry } from "../../src/types/store.js";
import { dividendReviewFilterParity } from "../helpers/dividendReviewFilterParity.js";

const SORT_COLUMNS = [
  "paymentDate",
  "ticker",
  "account",
  "expectedNetAmount",
  "nhiAmount",
  "bankFeeAmount",
  "otherDeductionAmount",
  "actualNetAmount",
  "varianceAmount",
  "reconciliationStatus",
] as const;

const SESSION_COOKIE_NAME = "g_auth_session";
const testOAuthConfig: GoogleOAuthConfig = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:4000/auth/google/callback",
  sessionSecret: "test-session-secret-that-is-long-enough-32chars!!",
};

describe("dividend review read-model routes", () => {
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

  it("timing recorder: emits named premeasured phases in the structured log", () => {
    const timing = new ReadPathTiming();
    timing.record("review_enrichment_db", "db", 4.5);
    timing.record("review_enrichment_shape", "app", 1.25);
    timing.record("review_enrichment_aggregate", "phase", 5.75);
    const info = vi.fn();
    const header = vi.fn();
    timing.attach(
      { log: { info } } as never,
      { header } as never,
      "/portfolio/dividends/review/enrichment",
      { reviewRows: [] },
    );
    expect(header).toHaveBeenCalledWith("Server-Timing", expect.stringContaining("review_enrichment_db;dur=4.5"));
    expect(header).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringContaining("review_enrichment_aggregate;dur=5.75"),
    );
    expect(header).toHaveBeenCalledWith(
      "Server-Timing",
      expect.stringContaining(", db;dur=4.5, app;dur=1.25,"),
    );
    expect(info).toHaveBeenCalledWith(expect.objectContaining({
      msg: "read_path_timing",
      route: "/portfolio/dividends/review/enrichment",
      dbMs: 4.5,
      appMs: 1.25,
      segments: [
        { name: "review_enrichment_db", kind: "db", durationMs: 4.5 },
        { name: "review_enrichment_shape", kind: "app", durationMs: 1.25 },
        { name: "review_enrichment_aggregate", kind: "phase", durationMs: 5.75 },
      ],
    }));
  });

  it("primary query: accepts every supported sort, page size, and pending source composition", async () => {
    for (const sortBy of SORT_COLUMNS) {
      for (const limit of [10, 25, 50]) {
        const response = await app.inject({
          method: "GET",
          url: `/portfolio/dividends/review/primary?sortBy=${sortBy}&sortOrder=asc&page=1&limit=${limit}&sourceComposition=pending`,
          headers: ownerHeaders,
        });

        expect(response.statusCode, `${sortBy}/${limit}: ${response.body}`).toBe(200);
      }
    }
  });

  it("primary query: rejects unsupported sort, page size, and source composition values", async () => {
    for (const query of [
      "sortBy=unsupported",
      "sortBy=expectedCashAmount",
      "sortBy=expectedGrossAmount",
      "sortBy=receivedCashAmount",
      "limit=20",
      "sourceComposition=provided",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/portfolio/dividends/review/primary?${query}`,
        headers: ownerHeaders,
      });

      expect(response.statusCode, `${query}: ${response.body}`).toBe(400);
    }
  });

  it("primary query: accepts repeated singular filter keys and deduplicates them internally", async () => {
    const response = await app.inject({
      method: "GET",
      url: [
        "/portfolio/dividends/review/primary",
        "?accountId=acc-1",
        "&accountId=acc-1",
        "&cashStatus=open",
        "&cashStatus=open",
        "&stockStatus=matched",
        "&stockStatus=matched",
        "&limit=10",
      ].join(""),
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
  });

  it("primary query: rejects more than 50 repeated singular filter values", async () => {
    const tooManyAccountIds = new URLSearchParams();
    for (let index = 0; index < 51; index += 1) {
      tooManyAccountIds.append("accountId", `acc-${index}`);
    }

    const response = await app.inject({
      method: "GET",
      url: `/portfolio/dividends/review/primary?${tooManyAccountIds.toString()}`,
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "validation_error" });
  });

  it("primary response: filters pending composition before count and omits detail arrays", async () => {
    const store = await app.persistence.loadStore("user-1");
    const account = store.accounts[0]!;
    account.defaultCurrency = "TWD";
    const pendingEtfInstrument = store.instruments.find(
      (candidate) => candidate.ticker === "2330" && candidate.marketCode === "TW",
    );
    if (!pendingEtfInstrument) throw new Error("missing test instrument");
    pendingEtfInstrument.type = "ETF";
    const events: DividendEvent[] = ["pending", "provided"].map((suffix, index) => ({
      id: `event-${suffix}`,
      ticker: `23${30 + index}`,
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2024-06-01",
      paymentDate: `2024-07-${10 + index}`,
      cashDividendPerShare: 3,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    }));
    const entries: DividendLedgerEntry[] = events.map((event, index) => ({
      id: `ledger-${index === 0 ? "pending" : "provided"}`,
      accountId: account.id,
      dividendEventId: event.id,
      eligibleQuantity: 100,
      expectedCashAmount: 300,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: index === 0 ? "unknown_pending_disclosure" : "provided",
    }));
    store.marketData.dividendEvents.push(...events);
    store.accounting.facts.dividendLedgerEntries.push(...entries);
    store.marketData.dividendEvents.push({
      ...events[0]!,
      id: "event-pending-stock",
      ticker: "2331",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      ...entries[0]!,
      id: "ledger-pending-stock",
      dividendEventId: "event-pending-stock",
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?sourceComposition=pending&limit=10",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      total: 1,
      reviewRows: [{ id: "ledger-pending", sourceCompositionStatus: "unknown_pending_disclosure" }],
      accounts: [{ id: account.id, name: account.name }],
    });
    expect(response.json().reviewRows[0]).not.toHaveProperty("deductions");
    expect(response.json().reviewRows[0]).not.toHaveProperty("sourceLines");
  });

  it("generated expectations: preserve per-lot split/FIFO and mixed-null replay ordering", async () => {
    const store = await app.persistence.loadStore("user-1");
    const account = store.accounts[0]!;
    account.defaultCurrency = "TWD";
    store.marketData.dividendEvents.push(
      {
        id: "memory-event-lot", ticker: "MLOT", marketCode: "TW", eventType: "CASH",
        exDividendDate: "2026-03-01", paymentDate: "2026-03-20",
        cashDividendPerShare: 1, cashDividendCurrency: "TWD", stockDividendPerShare: 0, source: "test",
      },
      {
        id: "memory-event-order", ticker: "MORDER", marketCode: "TW", eventType: "CASH",
        exDividendDate: "2026-03-02", paymentDate: "2026-03-21",
        cashDividendPerShare: 1, cashDividendCurrency: "TWD", stockDividendPerShare: 0, source: "test",
      },
    );
    store.accounting.facts.tradeEvents.push(...[
      { id: "memory-lot-buy-3", ticker: "MLOT", type: "BUY" as const, quantity: 3, tradeDate: "2026-01-01", bookingSequence: 1 },
      { id: "memory-lot-buy-5", ticker: "MLOT", type: "BUY" as const, quantity: 5, tradeDate: "2026-01-02", bookingSequence: 2 },
      { id: "memory-lot-sell-2", ticker: "MLOT", type: "SELL" as const, quantity: 2, tradeDate: "2026-02-02", bookingSequence: 3 },
      { id: "memory-order-buy", ticker: "MORDER", type: "BUY" as const, quantity: 3, tradeDate: "2026-02-01",
        bookingSequence: 1, tradeTimestamp: "2026-02-01T09:00:00.000Z" },
    ].map((trade) => ({
      ...trade, userId: "user-1", accountId: account.id, marketCode: "TW" as const, instrumentType: "STOCK" as const,
      unitPrice: 100, priceCurrency: "TWD", commissionAmount: 0, taxAmount: 0, isDayTrade: false,
      feeSnapshot: store.feeProfiles[0]!,
    })));
    store.accounting.facts.positionActions.push(
      {
        id: "memory-per-lot-split", accountId: account.id, ticker: "MLOT", marketCode: "TW",
        actionType: "REVERSE_SPLIT", actionDate: "2026-02-01", quantity: 4,
        ratioNumerator: 1, ratioDenominator: 2, cashInLieuAmount: 1, source: "test",
      },
      {
        id: "memory-untimestamped-action", accountId: account.id, ticker: "MORDER", marketCode: "TW",
        actionType: "SPLIT", actionDate: "2026-02-01", quantity: 0,
        ratioNumerator: 2, ratioDenominator: 1, source: "test",
      },
    );

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?limit=10",
      headers: ownerHeaders,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
    });
    const rows = response.json().reviewRows as Array<{ id: string; eligibleQuantity: number }>;
    expect(rows.find((row) => row.id === `expected:${account.id}:memory-event-lot`)).toMatchObject({ eligibleQuantity: 1 });
    expect(rows.find((row) => row.id === `expected:${account.id}:memory-event-order`)).toMatchObject({ eligibleQuantity: 3 });
  });

  it("primary query: applies OR within account and status groups, AND across groups", async () => {
    const store = await app.persistence.loadStore("user-1");
    const account = store.accounts[0]!;
    const templateFeeProfile = store.feeProfiles.find((profile) => profile.id === account.feeProfileId)!;
    const secondAccountId = "review-parity-account-2";
    const secondFeeProfileId = "review-parity-fee-2";
    store.feeProfiles.push({
      ...templateFeeProfile,
      id: secondFeeProfileId,
      accountId: secondAccountId,
      name: "Review Parity Fee 2",
      taxRules: undefined,
    });
    store.accounts.push({
      ...account,
      id: secondAccountId,
      name: "Review Parity 2",
      feeProfileId: secondFeeProfileId,
    });
    store.instruments.push(
      { ticker: "PARA", name: "Parity A", type: "STOCK", marketCode: "TW", isProvisional: false },
      { ticker: "PARB", name: "Parity B", type: "STOCK", marketCode: "TW", isProvisional: false },
      { ticker: "PARC", name: "Parity C", type: "STOCK", marketCode: "TW", isProvisional: false },
    );
    store.marketData.dividendEvents.push(
      {
        id: "parity-event-a",
        ticker: "PARA",
        marketCode: "TW",
        eventType: "CASH_AND_STOCK",
        exDividendDate: "2026-03-01",
        paymentDate: "2026-03-20",
        cashDividendPerShare: 2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0.1,
        stockDistributionRatio: 0.1,
        stockDistributionRatioState: "authoritative",
        source: "test",
      },
      {
        id: "parity-event-b",
        ticker: "PARB",
        marketCode: "TW",
        eventType: "CASH_AND_STOCK",
        exDividendDate: "2026-03-02",
        paymentDate: "2026-03-21",
        cashDividendPerShare: 2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0.1,
        stockDistributionRatio: 0.1,
        stockDistributionRatioState: "authoritative",
        source: "test",
      },
      {
        id: "parity-event-c",
        ticker: "PARC",
        marketCode: "TW",
        eventType: "CASH_AND_STOCK",
        exDividendDate: "2026-03-03",
        paymentDate: "2026-03-22",
        cashDividendPerShare: 2,
        cashDividendCurrency: "TWD",
        stockDividendPerShare: 0.1,
        stockDistributionRatio: 0.1,
        stockDistributionRatioState: "authoritative",
        source: "test",
      },
    );
    store.accounting.facts.dividendLedgerEntries.push(
      {
        id: "parity-ledger-a",
        accountId: account.id,
        dividendEventId: "parity-event-a",
        eligibleQuantity: 100,
        expectedCashAmount: 200,
        expectedStockQuantity: 10,
        receivedCashAmount: 0,
        receivedStockQuantity: 10,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-03-20T09:00:00.000Z",
      },
      {
        id: "parity-ledger-b",
        accountId: secondAccountId,
        dividendEventId: "parity-event-b",
        eligibleQuantity: 100,
        expectedCashAmount: 200,
        expectedStockQuantity: 10,
        receivedCashAmount: 200,
        receivedStockQuantity: 7,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-03-21T09:00:00.000Z",
      },
      {
        id: "parity-ledger-c",
        accountId: secondAccountId,
        dividendEventId: "parity-event-c",
        eligibleQuantity: 100,
        expectedCashAmount: 200,
        expectedStockQuantity: 10,
        receivedCashAmount: 0,
        receivedStockQuantity: 7,
        postingStatus: "posted",
        reconciliationStatus: "open",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: "2026-03-22T09:00:00.000Z",
      },
    );
    store.accounting.facts.cashLedgerEntries.push(
      {
        id: "parity-cash-b",
        userId: "user-1",
        accountId: secondAccountId,
        entryDate: "2026-03-21",
        entryType: "DIVIDEND_RECEIPT",
        amount: 200,
        currency: "TWD",
        relatedDividendLedgerEntryId: "parity-ledger-b",
        source: "test",
        bookedAt: "2026-03-21T09:00:01.000Z",
      },
    );
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: `/portfolio/dividends/review/primary?accountId=${account.id}&accountId=${secondAccountId}`
        + dividendReviewFilterParity.cashStatuses.map((status) => `&cashStatus=${status}`).join("")
        + dividendReviewFilterParity.stockStatuses.map((status) => `&stockStatus=${status}`).join("")
        + "&limit=10",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().reviewRows.map((row: { id: string }) => row.id).sort()).toEqual(
      dividendReviewFilterParity.expectedRowSuffixes.map((suffix) => `parity-ledger-${suffix}`),
    );
  });

  it("enrichment response: aggregates the full filtered set including ETF NHI and source composition", async () => {
    const store = await app.persistence.loadStore("user-1");
    const account = store.accounts[0]!;
    account.defaultCurrency = "TWD";
    const instrument = store.instruments.find((candidate) => candidate.ticker === "2330" && candidate.marketCode === "TW");
    if (!instrument) throw new Error("missing test instrument");
    instrument.type = "ETF";
    const events: DividendEvent[] = ["pending", "provided"].map((suffix, index) => ({
      id: `enrichment-event-${suffix}`,
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2024-06-01",
      paymentDate: `2024-07-${10 + index}`,
      cashDividendPerShare: 3,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    }));
    const entries: DividendLedgerEntry[] = events.map((event, index) => ({
      id: `enrichment-ledger-${index === 0 ? "pending" : "provided"}`,
      accountId: account.id,
      dividendEventId: event.id,
      eligibleQuantity: 10_000,
      expectedCashAmount: 30_000,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: index === 0 ? "unknown_pending_disclosure" : "provided",
    }));
    store.marketData.dividendEvents.push(...events);
    store.accounting.facts.dividendLedgerEntries.push(...entries);
    store.accounting.facts.dividendSourceLines.push({
      id: "source-dividend",
      dividendLedgerEntryId: "enrichment-ledger-provided",
      sourceBucket: "DIVIDEND_INCOME",
      amount: 20_000,
      currencyCode: "TWD",
      source: "test",
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/enrichment?ticker=2330",
      headers: ownerHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      aggregates: {
        totalExpectedCashAmount: { TWD: 60_000 },
        openCount: 2,
      },
      nhiRollup: {
        bucketAggregates: [{ sourceBucket: "DIVIDEND_INCOME", totalAmount: 20_000, isNhiSubject: true }],
        nhiSubjectTotal: 20_000,
        projectedPremium: 422,
        pendingCount: 1,
        hasEtfEntries: true,
      },
      sourceComposition: { providedCount: 1, pendingCount: 1 },
    });
  });

  it("hot reads: expose stable timing segments and preserve tenant isolation", async () => {
    const store = await app.persistence.loadStore("user-1");
    const account = store.accounts[0]!;
    account.defaultCurrency = "TWD";
    store.marketData.dividendEvents.push({
      id: "tenant-event",
      ticker: "2330",
      marketCode: "TW",
      eventType: "CASH",
      exDividendDate: "2024-06-01",
      paymentDate: "2024-07-10",
      cashDividendPerShare: 3,
      cashDividendCurrency: "TWD",
      stockDividendPerShare: 0,
      source: "test",
    });
    store.accounting.facts.dividendLedgerEntries.push({
      id: "tenant-ledger",
      accountId: account.id,
      dividendEventId: "tenant-event",
      eligibleQuantity: 100,
      expectedCashAmount: 300,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "posted",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "provided",
    });

    const primary = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary",
      headers: ownerHeaders,
    });
    const enrichment = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/enrichment",
      headers: ownerHeaders,
    });
    const detail = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/postings/tenant-ledger",
      headers: ownerHeaders,
    });
    const { userId: otherTenantUserId } = await app.persistence.resolveOrCreateUser(
      "google",
      "dividend-review-other-tenant",
      { email: "dividend-review-other-tenant@example.com", name: "Dividend Review Other Tenant" },
    );
    const { userId: viewerUserId } = await app.persistence.resolveOrCreateUser(
      "google",
      "dividend-review-context-viewer",
      { email: "dividend-review-viewer@example.com", name: "Dividend Review Viewer" },
    );
    const otherTenantAuthUser = await app.persistence.getAuthUserById(otherTenantUserId);
    const viewerAuthUser = await app.persistence.getAuthUserById(viewerUserId);
    if (!otherTenantAuthUser || !viewerAuthUser) throw new Error("expected test auth users");
    const otherTenantHeaders = {
      cookie: `${SESSION_COOKIE_NAME}=${signSessionCookie(
        otherTenantUserId,
        testOAuthConfig.sessionSecret,
        otherTenantAuthUser.sessionVersion,
      )}`,
    };
    const viewerHeaders = {
      cookie: `${SESSION_COOKIE_NAME}=${signSessionCookie(
        viewerUserId,
        testOAuthConfig.sessionSecret,
        viewerAuthUser.sessionVersion,
      )}`,
    };
    const isolatedTenant = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary",
      headers: otherTenantHeaders,
    });
    const isolatedTenantDetail = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/postings/tenant-ledger",
      headers: otherTenantHeaders,
    });
    await app.persistence.createShareGrant({
      ownerUserId: "user-1",
      granteeUserId: viewerUserId,
      auditInput: { actorUserId: "user-1" },
    });
    const sharedContextDetail = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/postings/tenant-ledger",
      headers: { ...viewerHeaders, "x-context-user-id": "user-1" },
    });

    expect(primary.headers["server-timing"]).toContain("review_primary_db;dur=");
    expect(primary.headers["server-timing"]).toContain("review_primary_hydration;dur=");
    expect(primary.headers["server-timing"]).toContain("review_primary_metadata;dur=");
    expect(primary.headers["server-timing"]).toContain("total;dur=");
    expect(enrichment.headers["server-timing"]).toContain("review_enrichment_db;dur=");
    expect(enrichment.headers["server-timing"]).toContain("review_enrichment_aggregate;dur=");
    expect(enrichment.headers["server-timing"]).toContain("total;dur=");
    expect(isolatedTenant.statusCode).toBe(200);
    expect(isolatedTenant.json().reviewRows).toEqual([]);
    expect(isolatedTenant.json().total).toBe(0);
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({ id: "tenant-ledger", rowKind: "ledger", ticker: "2330" });
    expect(detail.json()).toHaveProperty("deductions");
    expect(detail.json()).toHaveProperty("sourceLines");
    expect(isolatedTenantDetail.statusCode).toBe(404);
    expect(sharedContextDetail.statusCode).toBe(200);
    expect(sharedContextDetail.json()).toMatchObject({ id: "tenant-ledger", accountId: account.id });
  });

  it("memory primary: globally sorts every field with deterministic ties and stable 10/25/50 paging", async () => {
    const store = await app.persistence.loadStore("user-1");
    const templateAccount = store.accounts[0]!;
    templateAccount.defaultCurrency = "TWD";
    const statuses = ["open", "matched", "explained", "resolved"] as const;

    for (let index = 0; index < 60; index += 1) {
      const valueIndex = index === 1 ? 0 : index;
      const accountId = `sort-account-${valueIndex}`;
      const eventId = `sort-event-${valueIndex}`;
      if (index !== 1) {
        store.accounts.push({
          ...templateAccount,
          id: accountId,
          name: `Account ${String(valueIndex).padStart(3, "0")}`,
        });
        const paymentDate = new Date(Date.UTC(2024, 0, 1 + valueIndex)).toISOString().slice(0, 10);
        store.marketData.dividendEvents.push({
          id: eventId,
          ticker: `T${String(valueIndex).padStart(3, "0")}`,
          marketCode: "TW",
          eventType: "CASH",
          exDividendDate: "2023-12-01",
          paymentDate,
          cashDividendPerShare: 1,
          cashDividendCurrency: "TWD",
          stockDividendPerShare: 0,
          source: "test",
        });
      }
      const ledgerId = index === 0 ? "sort-ledger-z-tie" : index === 1 ? "sort-ledger-a-tie" : `sort-ledger-${index}`;
      const expected = 1_000 + valueIndex * 20;
      const received = 500 + valueIndex * 10;
      store.accounting.facts.dividendLedgerEntries.push({
        id: ledgerId,
        accountId,
        dividendEventId: eventId,
        eligibleQuantity: 100,
        expectedCashAmount: expected,
        expectedStockQuantity: 0,
        receivedCashAmount: 0,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: statuses[valueIndex % statuses.length]!,
        version: 1,
        sourceCompositionStatus: "provided",
      });
      store.accounting.facts.cashLedgerEntries.push({
        id: `sort-receipt-${index}`,
        userId: "user-1",
        accountId,
        entryDate: "2024-03-01",
        entryType: "DIVIDEND_RECEIPT",
        amount: received,
        currency: "TWD",
        relatedDividendLedgerEntryId: ledgerId,
        source: "test",
      });
      for (const [deductionType, amount] of [
        ["NHI_SUPPLEMENTAL_PREMIUM", valueIndex],
        ["BANK_FEE", valueIndex * 2],
        ["OTHER", valueIndex * 3],
      ] as const) {
        store.accounting.facts.dividendDeductionEntries.push({
          id: `sort-deduction-${index}-${deductionType}`,
          dividendLedgerEntryId: ledgerId,
          deductionType,
          amount,
          currencyCode: "TWD",
          withheldAtSource: true,
          source: "test",
        });
      }
    }

    const keyFor = (sortBy: typeof SORT_COLUMNS[number], row: Record<string, unknown>): string | number => {
      switch (sortBy) {
        case "account": return String(row.accountName ?? "");
        default: return row[sortBy] == null ? "" : row[sortBy] as string | number;
      }
    };

    for (const sortBy of SORT_COLUMNS) {
      for (const sortOrder of ["asc", "desc"] as const) {
        const first = await app.persistence.listDividendReviewPrimary("user-1", {
          page: 1, limit: 50, sortBy, sortOrder,
        });
        const second = await app.persistence.listDividendReviewPrimary("user-1", {
          page: 2, limit: 50, sortBy, sortOrder,
        });
        const rows = [...first.rows, ...second.rows];
        expect(rows).toHaveLength(60);
        const keys = rows.map((row) => keyFor(sortBy, row as unknown as Record<string, unknown>));
        for (let index = 1; index < keys.length; index += 1) {
          const previous = keys[index - 1]!;
          const current = keys[index]!;
          const comparison = typeof previous === "number" && typeof current === "number"
            ? previous - current
            : String(previous).localeCompare(String(current));
          expect(sortOrder === "asc" ? comparison <= 0 : comparison >= 0).toBe(true);
        }
        expect(rows.findIndex((row) => row.id === "sort-ledger-a-tie"))
          .toBeLessThan(rows.findIndex((row) => row.id === "sort-ledger-z-tie"));
      }
    }

    for (const limit of [10, 25, 50] as const) {
      const page = await app.persistence.listDividendReviewPrimary("user-1", {
        page: 1, limit, sortBy: "paymentDate", sortOrder: "asc",
      });
      expect(page.rows).toHaveLength(limit);
    }
    const firstVisit = await app.persistence.listDividendReviewPrimary("user-1", {
      page: 1, limit: 10, sortBy: "paymentDate", sortOrder: "asc",
    });
    const secondVisit = await app.persistence.listDividendReviewPrimary("user-1", {
      page: 2, limit: 10, sortBy: "paymentDate", sortOrder: "asc",
    });
    const returnVisit = await app.persistence.listDividendReviewPrimary("user-1", {
      page: 1, limit: 10, sortBy: "paymentDate", sortOrder: "asc",
    });
    expect(secondVisit.rows.map((row) => row.id)).not.toEqual(firstVisit.rows.map((row) => row.id));
    expect(returnVisit.rows.map((row) => row.id)).toEqual(firstVisit.rows.map((row) => row.id));
  });
});
