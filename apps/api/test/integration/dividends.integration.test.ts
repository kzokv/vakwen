import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { createDividendEvent, type CreateDividendEventInput } from "../../src/services/dividends.js";
import type { DividendLedgerEntry } from "../../src/types/store.js";
import {
  dividendEventPayload,
  dividendPostingPayload,
  dividendPostingUpdatePayload,
  dividendReconciliationPayload,
  transactionPayload,
} from "../helpers/fixtures.js";

let app: Awaited<ReturnType<typeof buildApp>>;

async function seedInstrument() {
  const store = await app.persistence.loadStore("user-1");
  const instrument = store.instruments.find((entry) => entry.ticker === "2330" && entry.marketCode === "TW");
  if (!instrument) throw new Error("instrument_not_found:2330:TW");
  instrument.name = "TSMC";
}

async function seedBuy(quantity: number = 10) {
  await app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `buy-${quantity}-${Math.random()}` },
    payload: transactionPayload({
      quantity,
      unitPrice: 100,
      tradeDate: "2026-01-15",
      commissionAmount: 0,
      taxAmount: 0,
    }),
  });
}

async function seedBuyForTicker(ticker: string, quantity: number = 10) {
  await app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `buy-${ticker}-${quantity}-${Math.random()}` },
    payload: transactionPayload({
      ticker,
      quantity,
      unitPrice: 100,
      tradeDate: "2026-01-15",
      commissionAmount: 0,
      taxAmount: 0,
    }),
  });
}

async function seedBuyAtDate(tradeDate: string, quantity: number = 10) {
  await app.inject({
    method: "POST",
    url: "/portfolio/transactions",
    headers: { "idempotency-key": `buy-${quantity}-${tradeDate}-${Math.random()}` },
    payload: transactionPayload({
      quantity,
      unitPrice: 100,
      tradeDate,
      commissionAmount: 0,
      taxAmount: 0,
    }),
  });
}

async function seedDividendEvent(
  overrides: Record<string, unknown> = {},
): Promise<ReturnType<typeof createDividendEvent>> {
  const store = await app.persistence.loadStore("user-1");
  const dividendEvent = createDividendEvent(store, {
    id: randomUUID(),
    ...dividendEventPayload(overrides),
  } as CreateDividendEventInput);
  await app.persistence.saveStore(store);
  return dividendEvent;
}

describe("dividends", () => {
  beforeEach(async () => {
    app = await buildApp({ persistenceBackend: "memory" });
  });

  afterEach(async () => {
    if (app) await app.close();
  });

  it("declares a dividend event and posts cash receipt with linked deductions and source lines", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 108,
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    const posting = postingResponse.json();
    expect(posting.comparison).toEqual({
      expectedCashAmount: 120,
      actualCashEconomicAmount: 120,
      cashVarianceAmount: 0,
      expectedStockQuantity: 0,
      actualStockQuantity: 0,
      stockVarianceQuantity: 0,
    });
    expect(posting.dividendSourceLines).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
      }),
    ]);

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    expect(ledgerResponse.statusCode).toBe(200);
    expect(ledgerResponse.json()).toEqual(
      expect.objectContaining({
        ledgerEntries: [
          expect.objectContaining({
            accountId: "acc-1",
            dividendEventId: dividendEvent.id,
            eligibleQuantity: 10,
            ticker: "2330",
            expectedCashAmount: 120,
            receivedCashAmount: 108,
            postingStatus: "posted",
            reconciliationStatus: "open",
            sourceCompositionStatus: "provided",
            version: 1,
            deductions: [
              expect.objectContaining({
                deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
                amount: 12,
              }),
            ],
            sourceLines: [
              expect.objectContaining({
                sourceBucket: "DIVIDEND_INCOME",
                amount: 120,
              }),
            ],
          }),
        ],
      }),
    );

    const reviewResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?ticker=2330&limit=10",
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toMatchObject({
      capabilities: {
        configuredMarkets: ["TW"],
        configuredCurrencies: ["TWD"],
      },
      reviewRows: [
        expect.objectContaining({
          id: posting.dividendLedgerEntry.id,
          ticker: "2330",
          cashDividendPerShare: 12,
        }),
      ],
    });

    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.dividendDeductionEntries).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
        amount: 12,
        currencyCode: "TWD",
      }),
    ]);
    expect(store.accounting.facts.dividendSourceLines).toEqual([
      expect.objectContaining({
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        sourceBucket: "DIVIDEND_INCOME",
        amount: 120,
      }),
    ]);
    expect(store.accounting.facts.cashLedgerEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
          entryType: "DIVIDEND_RECEIPT",
          amount: 108,
        }),
        expect.objectContaining({
          relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
          entryType: "DIVIDEND_DEDUCTION",
          amount: -12,
        }),
      ]),
    );
  });

  it("[dividend posting]: duplicate active posting → remains blocked with a different idempotency key", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const first = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "active-posting-first" },
      payload: dividendPostingPayload({ dividendEventId: dividendEvent.id, receivedCashAmount: 108 }),
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "active-posting-second" },
      payload: dividendPostingPayload({ dividendEventId: dividendEvent.id, receivedCashAmount: 108 }),
    });

    expect(first.statusCode).toBe(200);
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json()).toMatchObject({ error: "dividend_conflict" });
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.dividendLedgerEntries.filter((entry) =>
      entry.dividendEventId === dividendEvent.id && !entry.supersededAt && !entry.reversalOfDividendLedgerEntryId,
    )).toHaveLength(1);
  });

  it("returns account-scoped dividend rows and includes payment-date TBD events", async () => {
    await seedInstrument();
    await seedBuy();
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-05",
      paymentDate: null,
      cashDividendPerShare: 8,
    });

    const response = await app.inject({
      method: "GET",
      url: "/dividend-events?fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      dividendEvents: expect.arrayContaining([
        expect.objectContaining({
          accountId: "acc-1",
          ticker: "2330",
          tickerName: "TSMC",
          marketCode: "TW",
          paymentDate: "2026-02-20",
          eligibleQuantity: 10,
          expectedCashAmount: 120,
          hasPostedLedgerEntry: false,
        }),
        expect.objectContaining({
          accountId: "acc-1",
          ticker: "2330",
          tickerName: "TSMC",
          marketCode: "TW",
          paymentDate: null,
          eligibleQuantity: 10,
          expectedCashAmount: 80,
          hasPostedLedgerEntry: false,
        }),
      ]),
    });
  });

  it("[daily highlights]: targeted read → does not load the full user store", async () => {
    await seedInstrument();
    await seedBuy();
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-07-21",
      paymentDate: "2026-07-21",
      cashDividendPerShare: 12,
    });
    const loadStore = vi.spyOn(app.persistence, "loadStore");

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/daily-highlights?at=2026-07-21T04:00:00.000Z",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      payingToday: [expect.objectContaining({ ticker: "2330", applicableLocalDate: "2026-07-21" })],
      exDividendToday: [expect.objectContaining({ ticker: "2330", applicableLocalDate: "2026-07-21" })],
    });
    expect(loadStore).not.toHaveBeenCalled();
  });

  it("[daily highlights]: targeted persistence failure → returns an isolated server error", async () => {
    vi.spyOn(app.persistence, "listDividendDailyHighlightsSnapshot").mockRejectedValueOnce(new Error("daily read failed"));

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/daily-highlights?at=2026-07-21T04:00:00.000Z",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ error: "internal_error" });
  });

  it("[dividend review metadata]: scoped universe → returns complete sorted eligible ticker options", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.instruments.push(
      { ticker: "2886", name: "Mega Financial", type: "STOCK", marketCode: "TW", isProvisional: false },
      { ticker: "3714", name: "Ennoconn", type: "STOCK", marketCode: "TW", isProvisional: false },
    );
    await app.persistence.saveStore(store);
    await seedBuyForTicker("3714");
    await seedBuyForTicker("2886");
    const namedStore = await app.persistence.loadStore("user-1");
    namedStore.instruments.find((instrument) => instrument.ticker === "2886")!.name = "Mega Financial";
    namedStore.instruments.find((instrument) => instrument.ticker === "3714")!.name = "Ennoconn";
    await app.persistence.saveStore(namedStore);
    await seedDividendEvent({ ticker: "3714", exDividendDate: "2026-02-01", paymentDate: "2026-03-01" });
    await seedDividendEvent({ ticker: "2886", exDividendDate: "2026-02-01", paymentDate: "2026-03-02" });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?fromPaymentDate=2026-01-01&toPaymentDate=2026-12-31&reconciliationStatus=matched&limit=10",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      reviewRows: [],
      eligibleTickers: [
        { ticker: "2886", name: "Mega Financial" },
        { ticker: "3714", name: "Ennoconn" },
      ],
    });
  });

  it("[dividend review filters]: repeated ticker query → applies OR semantics and preserves a single ticker", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.instruments.push(
      { ticker: "2886", name: "Mega Financial", type: "STOCK", marketCode: "TW", isProvisional: false },
      { ticker: "3714", name: "Ennoconn", type: "STOCK", marketCode: "TW", isProvisional: false },
    );
    await app.persistence.saveStore(store);
    await seedBuyForTicker("3714");
    await seedBuyForTicker("2886");
    await seedDividendEvent({ ticker: "3714", exDividendDate: "2026-02-01", paymentDate: "2026-03-01" });
    await seedDividendEvent({ ticker: "2886", exDividendDate: "2026-02-01", paymentDate: "2026-03-02" });

    const repeated = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?ticker=3714&ticker=2886&limit=10&sortBy=ticker&sortOrder=asc",
    });
    const single = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?ticker=2886&limit=10",
    });
    const compatibility = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review?ticker=3714&ticker=2886&limit=10&sortBy=ticker&sortOrder=asc",
    });
    const enrichment = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/enrichment?ticker=3714&ticker=2886",
    });

    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().reviewRows.map((row: { ticker: string }) => row.ticker)).toEqual(["2886", "3714"]);
    expect(single.statusCode).toBe(200);
    expect(single.json().reviewRows.map((row: { ticker: string }) => row.ticker)).toEqual(["2886"]);
    expect(compatibility.statusCode).toBe(200);
    expect(compatibility.json().reviewRows.map((row: { ticker: string }) => row.ticker)).toEqual(["2886", "3714"]);
    expect(enrichment.statusCode).toBe(200);
    expect(enrichment.json().hero.needsAttentionCount).toBe(2);
  });

  it("returns the combined calendar snapshot with display-name enrichment", async () => {
    await seedInstrument();
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "calendar-snapshot-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 108,
      }),
    });
    expect(postingResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&limit=20",
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      events: Array<Record<string, unknown>>;
      ledgerEntries: Array<Record<string, unknown>>;
    };
    expect(body.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        paymentDate: "2026-02-20",
        hasPostedLedgerEntry: true,
      }),
    ]));
    expect(body.ledgerEntries).toEqual(expect.arrayContaining([
      expect.objectContaining({
        ticker: "2330",
        tickerName: "TSMC",
        marketCode: "TW",
        paymentDate: "2026-02-20",
        reconciliationStatus: "open",
      }),
    ]));
    expect(body.events[0]).toHaveProperty("dividendLedgerEntryId");
    expect(body.ledgerEntries[0]).toHaveProperty("id");
  });

  it("returns authoritative par value for an expected stock dividend before posting", async () => {
    await seedInstrument();
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
      stockParValueAmount: 10,
      stockParValueCurrency: "TWD",
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-08-01&toPaymentDate=2026-08-31&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [expect.objectContaining({
        id: dividendEvent.id,
        expectedStockQuantity: 100,
        stockDistributionRatio: 0.1,
        stockDistributionRatioState: "authoritative",
        parValuePerShare: 10,
        hasPostedLedgerEntry: false,
      })],
    });
  });

  it("preserves a 2886 stock receipt of 150 shares while the review row still needs calculation", async () => {
    const store = await app.persistence.loadStore("user-1");
    store.instruments.push({
      ticker: "2886",
      name: "Mega Financial",
      type: "STOCK",
      marketCode: "TW",
      isProvisional: false,
    });
    await app.persistence.saveStore(store);

    await seedBuyForTicker("2886", 1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2886",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockParValueAmount: null,
      stockParValueCurrency: null,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "unresolved-stock-receipt-2886" },
      payload: dividendPostingPayload({
        ticker: "2886",
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 0,
        receivedStockQuantity: 150,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    const postingBody = postingResponse.json() as {
      dividendLedgerEntry: { id: string };
    };

    const persisted = await app.persistence.loadStore("user-1");
    const ledgerEntry = persisted.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.id === postingBody.dividendLedgerEntry.id,
    );
    expect(ledgerEntry).toMatchObject({
      receivedStockQuantity: 150,
      expectedStockQuantity: 0,
      postingStatus: "posted",
    });
    expect(
      persisted.accounting.facts.positionActions.find(
        (entry) => entry.relatedDividendLedgerEntryId === postingBody.dividendLedgerEntry.id,
      ),
    ).toMatchObject({
      ticker: "2886",
      actionType: "STOCK_DIVIDEND",
      quantity: 150,
    });

    const reviewResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?ticker=2886&limit=10",
    });
    expect(reviewResponse.statusCode).toBe(200);
    expect(reviewResponse.json()).toMatchObject({
      reviewRows: [expect.objectContaining({
        id: postingBody.dividendLedgerEntry.id,
        ticker: "2886",
        receivedStockQuantity: 150,
        stockDistributionRatio: null,
        expectedStockCalcState: "needs_action",
      })],
    });
  });

  it("keeps unresolved seeded provider values non-authoritative in calculation preview", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 1,
      stockDistributionAmountRaw: 1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockProviderValueUnit: null,
      stockProviderSource: "seeded_test",
      stockProviderDataset: null,
    });

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/preview",
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: "dividend_stock_provider_ratio_unavailable",
    });
  });

  it("uses normalized provider value and authoritative ratio before conflicting legacy stock fields", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockDistributionAmountRaw: 0.1,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
      stockProviderValue: 0.25,
      stockProviderValueUnit: "RATIO",
      stockProviderSource: "normalized-test",
      stockProviderDataset: "NormalizedDividendDataset",
      stockProviderAuthoritativeRatio: 0.25,
    });

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/preview",
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      providerValue: "0.25",
      providerUnit: "RATIO",
      providerSource: "normalized-test",
      providerDataset: "NormalizedDividendDataset",
      ratio: "0.25",
      expectedWholeShares: 250,
    });
  });

  it("provider drift: authoritative-ratio-only change → requires reconfirmation", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockDistributionAmountRaw: 0.1,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
      stockProviderValue: "0.1",
      stockProviderValueUnit: "RATIO",
      stockProviderSource: "normalized-test",
      stockProviderDataset: "NormalizedDividendDataset",
      stockProviderAuthoritativeRatio: "0.1",
    });

    const confirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "ratio-only-drift-initial" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
        expectedActiveCalculationId: null,
      },
    });
    expect(confirmResponse.statusCode).toBe(200);
    const confirmed = confirmResponse.json() as { id: string; calculationVersion: number };

    const store = await app.persistence.loadStore("user-1");
    const persistedEvent = store.marketData.dividendEvents.find((item) => item.id === dividendEvent.id);
    if (!persistedEvent) throw new Error("expected dividend event");
    persistedEvent.stockProviderAuthoritativeRatio = "0.2";
    await app.persistence.saveStore(store);

    const previewResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/preview",
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
      },
    });
    expect(previewResponse.statusCode).toBe(200);
    expect(previewResponse.json()).toMatchObject({
      providerValue: "0.1",
      providerAuthoritativeRatio: "0.2",
      drift: {
        hasDrift: true,
        previousAuthoritativeRatio: "0.1",
        currentAuthoritativeRatio: "0.2",
      },
    });

    const reconfirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "ratio-only-drift-reconfirm" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
        expectedActiveCalculationId: confirmed.id,
        expectedCalculationVersion: confirmed.calculationVersion,
      },
    });
    expect(reconfirmResponse.statusCode).toBe(409);
    expect(reconfirmResponse.json()).toMatchObject({
      error: "dividend_calculation_drift_confirmation_required",
    });
  });

  it.each([
    ["preview", "derived_from_par_value", "selectedParValue", "0"],
    ["preview", "derived_from_par_value", "selectedParValue", "-10"],
    ["preview", "derived_from_par_value", "selectedParValue", "not-a-number"],
    ["preview", "derived_from_par_value", "selectedParValue", "Infinity"],
    ["preview", "derived_from_par_value", "selectedParValue", "123456789012345"],
    ["preview", "derived_from_par_value", "selectedParValue", "10.1234567"],
    ["confirm", "custom_ratio", "customRatio", "0"],
    ["confirm", "custom_ratio", "customRatio", "-0.1"],
    ["confirm", "custom_ratio", "customRatio", "1e-1"],
    ["confirm", "custom_ratio", "customRatio", "NaN"],
    ["confirm", "custom_ratio", "customRatio", "123456789"],
    ["confirm", "custom_ratio", "customRatio", "0.1234567890123"],
    ["amend", "custom_ratio", "customRatio", "Infinity"],
  ] as const)(
    "rejects invalid decimal input on calculation %s",
    async (route, method, field, value) => {
      const response = await app.inject({
        method: "POST",
        url: `/portfolio/dividends/calculations/${route}`,
        headers: route === "preview" ? undefined : { "idempotency-key": `invalid-${route}-${field}-${value}` },
        payload: {
          accountId: "acc-1",
          dividendEventId: "validation-event",
          dividendLedgerEntryId: route === "amend" ? "validation-ledger" : undefined,
          method,
          expectedActiveCalculationId: route === "preview" ? undefined : null,
          [field]: value,
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ error: "validation_error" });
    },
  );

  it.each([
    0,
    -0.1,
    "not-a-number",
    Number.POSITIVE_INFINITY,
    "123456789",
    "0.1234567890123",
  ])("returns a deterministic validation error for invalid normalized provider value %s", async (providerValue) => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockProviderValue: providerValue,
      stockProviderValueUnit: "RATIO",
      stockProviderAuthoritativeRatio: providerValue,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
    });

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/preview",
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "dividend_stock_provider_value_invalid" });
  });

  it("applies account-market fallback versions atomically in memory", async () => {
    const payload = { expectedVersion: 0, fallbackParValue: "10" };
    const [left, right] = await Promise.all([
      app.inject({ method: "PATCH", url: "/accounts/acc-1/dividend-settings/TW", payload }),
      app.inject({ method: "PATCH", url: "/accounts/acc-1/dividend-settings/TW", payload }),
    ]);

    expect([left.statusCode, right.statusCode].sort()).toEqual([200, 409]);
    const conflict = left.statusCode === 409 ? left : right;
    expect(conflict.json()).toMatchObject({
      error: "account_market_dividend_settings_version_conflict",
    });
    const settings = await app.persistence.getAccountMarketDividendSettings("user-1", "acc-1", "TW");
    expect(settings).toMatchObject({ version: 1, fallbackParValue: "10" });
  });

  it("confirms and returns the latest dividend calculation for a TW par-value derivation", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 1,
      stockDistributionAmountRaw: 1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockProviderValueUnit: "TWD_PER_SHARE",
      stockProviderSource: "finmind",
      stockProviderDataset: "TaiwanStockDividend",
    });

    const confirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "calc-confirm-par-value" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "derived_from_par_value",
        selectedParValue: "10",
        expectedActiveCalculationId: null,
      },
    });

    expect(confirmResponse.statusCode).toBe(200);
    expect(confirmResponse.json()).toMatchObject({
      accountId: "acc-1",
      dividendEventId: dividendEvent.id,
      status: "confirmed",
      method: "derived_from_par_value",
      provider: {
        value: "1",
        unit: "TWD_PER_SHARE",
        source: "finmind",
        dataset: "TaiwanStockDividend",
      },
      ratio: "0.1",
      expectedWholeShares: 100,
    });

    const latest = await app.persistence.getLatestDividendCalculation("user-1", "acc-1", dividendEvent.id);
    expect(latest).toMatchObject({
      status: "confirmed",
      method: "derived_from_par_value",
      expectedWholeShares: 100,
    });

    const primaryResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?ticker=2330&limit=10",
    });
    expect(primaryResponse.statusCode).toBe(200);
    expect(primaryResponse.json()).toMatchObject({
      reviewRows: [expect.objectContaining({
        postingStatus: "expected",
        dividendEventId: dividendEvent.id,
        expectedStockQuantity: 100,
        provider: expect.objectContaining({
          value: "1",
          unit: "TWD_PER_SHARE",
          source: "finmind",
          dataset: "TaiwanStockDividend",
        }),
        activeCalculation: expect.objectContaining({
          status: "confirmed",
          method: "derived_from_par_value",
          expectedWholeShares: 100,
        }),
      })],
    });
  });

  it("posts with an inline calculation, amends expectation-only later, and exposes stockStatus plus hero filters", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 1,
      stockDistributionAmountRaw: 1,
      stockDistributionRatio: null,
      stockDistributionRatioState: "unresolved",
      stockProviderValueUnit: "TWD_PER_SHARE",
      stockProviderSource: "finmind",
      stockProviderDataset: "TaiwanStockDividend",
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "inline-calculation-posting" },
      payload: {
        ...dividendPostingPayload({
          ticker: "2330",
          dividendEventId: dividendEvent.id,
          receivedCashAmount: 0,
          receivedStockQuantity: 150,
          deductions: [],
          sourceCompositionStatus: "unknown_pending_disclosure",
          sourceLines: [],
        }),
        calculation: {
          method: "derived_from_par_value",
          selectedParValue: "10",
        },
      },
    });
    expect(postingResponse.statusCode).toBe(200);
    const postingBody = postingResponse.json() as {
      dividendLedgerEntry: { id: string; receivedStockQuantity: number };
    };

    const detailResponse = await app.inject({
      method: "GET",
      url: `/portfolio/dividends/postings/${postingBody.dividendLedgerEntry.id}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    const detailBody = detailResponse.json() as {
      activeCalculation: { id: string; calculationVersion: number };
      calculationHistory?: Array<{ id: string; status: string }>;
    };
    expect(detailBody).toMatchObject({
      id: postingBody.dividendLedgerEntry.id,
      expectedStockQuantity: 100,
      receivedStockQuantity: 150,
      stockVarianceQuantity: 50,
      activeCalculation: expect.objectContaining({
        status: "confirmed",
        method: "derived_from_par_value",
        expectedWholeShares: 100,
      }),
      provider: {
        value: "1",
        unit: "TWD_PER_SHARE",
        source: "finmind",
        dataset: "TaiwanStockDividend",
      },
    });
    expect(detailBody.calculationHistory).toEqual([
      expect.objectContaining({
        id: detailBody.activeCalculation.id,
        status: "confirmed",
      }),
    ]);

    const amendResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/amend",
      headers: { "idempotency-key": "inline-calculation-amend" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: postingBody.dividendLedgerEntry.id,
        method: "custom_ratio",
        customRatio: "0.2",
        expectedActiveCalculationId: detailBody.activeCalculation.id,
        expectedCalculationVersion: detailBody.activeCalculation.calculationVersion,
      },
    });
    expect(amendResponse.statusCode).toBe(200);
    expect(amendResponse.json()).toMatchObject({
      status: "amended",
      method: "custom_ratio",
      expectedWholeShares: 200,
      dividendLedgerEntryId: postingBody.dividendLedgerEntry.id,
    });

    const amendedDetailResponse = await app.inject({
      method: "GET",
      url: `/portfolio/dividends/postings/${postingBody.dividendLedgerEntry.id}`,
    });
    expect(amendedDetailResponse.statusCode).toBe(200);
    const amendedDetailBody = amendedDetailResponse.json() as {
      activeCalculation: { id: string };
      calculationHistory?: Array<{ id: string; status: string }>;
    };
    expect(amendedDetailBody).toMatchObject({
      id: postingBody.dividendLedgerEntry.id,
      expectedStockQuantity: 200,
      receivedStockQuantity: 150,
      stockVarianceQuantity: -50,
      activeCalculation: expect.objectContaining({
        status: "amended",
        method: "custom_ratio",
        expectedWholeShares: 200,
      }),
    });
    expect(amendedDetailBody.calculationHistory).toEqual([
      expect.objectContaining({
        id: amendedDetailBody.activeCalculation.id,
        status: "amended",
      }),
      expect.objectContaining({
        id: detailBody.activeCalculation.id,
        status: "confirmed",
      }),
    ]);

    const persisted = await app.persistence.loadStore("user-1");
    expect(
      persisted.accounting.facts.positionActions.find(
        (entry) => entry.relatedDividendLedgerEntryId === postingBody.dividendLedgerEntry.id,
      ),
    ).toMatchObject({
      ticker: "2330",
      actionType: "STOCK_DIVIDEND",
      quantity: 150,
    });
    expect(
      persisted.accounting.facts.dividendLedgerEntries.find(
        (entry) => entry.id === postingBody.dividendLedgerEntry.id,
      ),
    ).toMatchObject({
      expectedStockQuantity: 200,
      receivedStockQuantity: 150,
    });

    const primaryResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/primary?stockStatus=variance&limit=10",
    });
    expect(primaryResponse.statusCode).toBe(200);
    expect(primaryResponse.json()).toMatchObject({
      reviewRows: [expect.objectContaining({
        id: postingBody.dividendLedgerEntry.id,
        stockReconciliationStatus: "variance",
        expectedStockQuantity: 200,
        receivedStockQuantity: 150,
      })],
    });

    const compatibilityResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review?stockStatus=variance&limit=10",
    });
    expect(compatibilityResponse.statusCode).toBe(200);
    expect(compatibilityResponse.json()).toMatchObject({
      reviewRows: [expect.objectContaining({
        id: postingBody.dividendLedgerEntry.id,
        stockReconciliationStatus: "variance",
      })],
    });

    const enrichmentResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/enrichment?stockStatus=variance",
    });
    expect(enrichmentResponse.statusCode).toBe(200);
    expect(enrichmentResponse.json()).toMatchObject({
      hero: {
        expectedStockTickers: [expect.objectContaining({
          marketCode: "TW",
          ticker: "2330",
          expectedWholeShares: 200,
        })],
        expectedStockTopTickers: [expect.objectContaining({
          marketCode: "TW",
          ticker: "2330",
          expectedWholeShares: 200,
        })],
        receivedStockTickers: [expect.objectContaining({
          marketCode: "TW",
          ticker: "2330",
          receivedShares: 150,
        })],
        receivedStockTopTickers: [expect.objectContaining({
          marketCode: "TW",
          ticker: "2330",
          receivedShares: 150,
        })],
        stockAttentionCount: 1,
      },
    });
  });

  it("review hero: overlapping cash and stock attention → counts the row once", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH_AND_STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 1,
      stockDividendPerShare: 0.1,
      stockDistributionAmountRaw: 0.1,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "overlapping-attention-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 0,
        receivedStockQuantity: 50,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);
    const posted = postingResponse.json() as { dividendLedgerEntry: { id: string } };
    const store = await app.persistence.loadStore("user-1");
    const ledgerEntry = store.accounting.facts.dividendLedgerEntries.find(
      (item) => item.id === posted.dividendLedgerEntry.id,
    );
    if (!ledgerEntry) throw new Error("expected dividend ledger entry");
    ledgerEntry.cashReconciliationStatus = "open";
    await app.persistence.saveStore(store);

    const enrichmentResponse = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/review/enrichment",
    });
    expect(enrichmentResponse.statusCode).toBe(200);
    expect(enrichmentResponse.json()).toMatchObject({
      hero: {
        cashAttentionCount: 1,
        stockAttentionCount: 1,
        needsAttentionCount: 1,
      },
    });
  });

  it("enforces calculation idempotency and optimistic conflicts for confirm, reset, amend, and stock explanation audits", async () => {
    await seedBuy(1_000);
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-07-15",
      paymentDate: "2026-08-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
      stockDistributionRatio: 0.1,
      stockDistributionRatioState: "authoritative",
    });

    const confirmPayload = {
      accountId: "acc-1",
      dividendEventId: dividendEvent.id,
      method: "provider_ratio",
      expectedActiveCalculationId: null,
    };
    const confirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "calc-confirm-1" },
      payload: confirmPayload,
    });
    expect(confirmResponse.statusCode).toBe(200);
    const confirmed = confirmResponse.json() as { id: string; calculationVersion: number };

    const duplicateConfirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "calc-confirm-1" },
      payload: confirmPayload,
    });
    expect(duplicateConfirmResponse.statusCode).toBe(409);
    expect(duplicateConfirmResponse.json()).toMatchObject({ error: "duplicate_idempotency_key" });

    const staleConfirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "calc-confirm-stale" },
      payload: confirmPayload,
    });
    expect(staleConfirmResponse.statusCode).toBe(409);
    expect(staleConfirmResponse.json()).toMatchObject({ error: "dividend_calculation_conflict" });

    const resetResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/reset",
      headers: { "idempotency-key": "calc-reset-1" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        expectedActiveCalculationId: confirmed.id,
        expectedCalculationVersion: confirmed.calculationVersion,
      },
    });
    expect(resetResponse.statusCode).toBe(200);

    expect(
      await app.persistence.getLatestDividendCalculation("user-1", "acc-1", dividendEvent.id),
    ).toBeNull();
    const previewAfterResetResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/preview",
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
      },
    });
    expect(previewAfterResetResponse.statusCode).toBe(200);
    expect(previewAfterResetResponse.json()).toMatchObject({
      activeCalculation: null,
      drift: null,
    });

    const duplicateResetResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/reset",
      headers: { "idempotency-key": "calc-reset-1" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        expectedActiveCalculationId: confirmed.id,
      },
    });
    expect(duplicateResetResponse.statusCode).toBe(409);
    expect(duplicateResetResponse.json()).toMatchObject({ error: "duplicate_idempotency_key" });

    const staleResetResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/reset",
      headers: { "idempotency-key": "calc-reset-stale" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        expectedActiveCalculationId: confirmed.id,
      },
    });
    expect(staleResetResponse.statusCode).toBe(409);
    expect(staleResetResponse.json()).toMatchObject({ error: "dividend_calculation_conflict" });

    const reconfirmResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/confirm",
      headers: { "idempotency-key": "calc-confirm-2" },
      payload: {
        accountId: "acc-1",
        dividendEventId: dividendEvent.id,
        method: "provider_ratio",
        expectedActiveCalculationId: previewAfterResetResponse.json().activeCalculation?.id ?? null,
      },
    });
    expect(reconfirmResponse.statusCode).toBe(200);
    const reconfirmed = reconfirmResponse.json() as { id: string; calculationVersion: number };

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "calc-amend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 0,
        receivedStockQuantity: 150,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);
    const posted = postingResponse.json() as { dividendLedgerEntry: { id: string; version: number } };

    const amendPayload = {
      accountId: "acc-1",
      dividendEventId: dividendEvent.id,
      dividendLedgerEntryId: posted.dividendLedgerEntry.id,
      method: "custom_ratio",
      customRatio: "0.2",
      expectedActiveCalculationId: reconfirmed.id,
      expectedCalculationVersion: reconfirmed.calculationVersion,
    };
    const amendResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/amend",
      headers: { "idempotency-key": "calc-amend-1" },
      payload: amendPayload,
    });
    expect(amendResponse.statusCode).toBe(200);
    const amended = amendResponse.json() as { id: string; calculationVersion: number };

    const duplicateAmendResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/amend",
      headers: { "idempotency-key": "calc-amend-1" },
      payload: amendPayload,
    });
    expect(duplicateAmendResponse.statusCode).toBe(409);
    expect(duplicateAmendResponse.json()).toMatchObject({ error: "duplicate_idempotency_key" });

    const staleAmendResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/calculations/amend",
      headers: { "idempotency-key": "calc-amend-stale" },
      payload: amendPayload,
    });
    expect(staleAmendResponse.statusCode).toBe(409);
    expect(staleAmendResponse.json()).toMatchObject({ error: "dividend_calculation_conflict" });

    const stockExplanationResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${posted.dividendLedgerEntry.id}/stock-reconciliation`,
      payload: {
        status: "explained",
        note: "Issuer rounded the entitlement.",
        expectedVersion: posted.dividendLedgerEntry.version,
      },
    });
    expect(stockExplanationResponse.statusCode).toBe(200);

    const explainedEntry = stockExplanationResponse.json() as { ledgerEntry: { version: number } };
    const clearExplanationResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${posted.dividendLedgerEntry.id}/stock-reconciliation`,
      payload: {
        status: "variance",
        note: null,
        expectedVersion: explainedEntry.ledgerEntry.version,
      },
    });
    expect(clearExplanationResponse.statusCode).toBe(200);
    expect(clearExplanationResponse.json()).toMatchObject({
      ledgerEntry: {
        stockReconciliationStatus: "variance",
        stockReconciliationNote: null,
      },
    });

    const latest = await app.persistence.getLatestDividendCalculation("user-1", "acc-1", dividendEvent.id);
    expect(latest).toMatchObject({
      id: amended.id,
      calculationVersion: amended.calculationVersion,
      status: "amended",
    });

    const auditLog = await app.persistence.listAuditLog({ page: 1, limit: 20 });
    expect(auditLog.items.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "dividend_calculation_confirmed",
      "dividend_calculation_reset",
      "dividend_calculation_amended",
      "dividend_stock_reconciliation_updated",
    ]));
  });

  it("filters the dividend ledger route by marketCode", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "AU Account",
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const auAccount = accountResponse.json() as { id: string };
    const store = await app.persistence.loadStore("user-1");
    const twEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "TW",
        cashDividendCurrency: "TWD",
        paymentDate: "2026-02-20",
      }),
    } as CreateDividendEventInput);
    const auEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "AU",
        cashDividendCurrency: "AUD",
        paymentDate: "2026-02-21",
      }),
    } as CreateDividendEventInput);
    store.accounting.facts.dividendLedgerEntries.push(
      {
        id: "ledger-tw",
        accountId: "acc-1",
        dividendEventId: twEvent.id,
        eligibleQuantity: 10,
        expectedCashAmount: 120,
        expectedStockQuantity: 0,
        receivedCashAmount: 120,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: new Date().toISOString(),
      },
      {
        id: "ledger-au",
        accountId: auAccount.id,
        dividendEventId: auEvent.id,
        eligibleQuantity: 10,
        expectedCashAmount: 80,
        expectedStockQuantity: 0,
        receivedCashAmount: 80,
        receivedStockQuantity: 0,
        postingStatus: "posted",
        reconciliationStatus: "matched",
        version: 1,
        sourceCompositionStatus: "provided",
        bookedAt: new Date().toISOString(),
      },
    );
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/ledger?ticker=DUPE&marketCode=AU",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().ledgerEntries).toEqual([
      expect.objectContaining({
        id: "ledger-au",
        marketCode: "AU",
        ticker: "DUPE",
      }),
    ]);
  });

  it("applies the calendar market filter before limiting dividend events", async () => {
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "AU Account",
        defaultCurrency: "AUD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const auAccount = accountResponse.json() as { id: string };
    const tradeResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "calendar-au-position" },
      payload: transactionPayload({
        accountId: auAccount.id,
        ticker: "DUPE",
        marketCode: "AU",
        quantity: 10,
        unitPrice: 10,
        priceCurrency: "AUD",
        tradeDate: "2026-01-15",
      }),
    });
    expect(tradeResponse.statusCode).toBe(200);
    const store = await app.persistence.loadStore("user-1");
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "TW",
        cashDividendCurrency: "TWD",
        paymentDate: "2026-02-20",
      }),
    } as CreateDividendEventInput);
    createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "DUPE",
        marketCode: "AU",
        cashDividendCurrency: "AUD",
        paymentDate: "2026-02-21",
      }),
    } as CreateDividendEventInput);
    await app.persistence.saveStore(store);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&marketCode=AU&limit=1",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events).toEqual([
      expect.objectContaining({
        ticker: "DUPE",
        marketCode: "AU",
        paymentDate: "2026-02-21",
      }),
    ]);
  });

  it("applies the calendar account filter to dividend event rows", async () => {
    await seedInstrument();
    await seedBuyAtDate("2026-01-15");
    const accountResponse = await app.inject({
      method: "POST",
      url: "/accounts",
      payload: {
        name: "Second TW Account",
        defaultCurrency: "TWD",
        accountType: "broker",
      },
    });
    expect(accountResponse.statusCode).toBe(200);
    const secondAccount = accountResponse.json() as { id: string };
    const secondTradeResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "calendar-second-account-position" },
      payload: transactionPayload({
        accountId: secondAccount.id,
        ticker: "2330",
        marketCode: "TW",
        quantity: 20,
        unitPrice: 100,
        priceCurrency: "TWD",
        tradeDate: "2026-01-15",
      }),
    });
    expect(secondTradeResponse.statusCode).toBe(200);
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?accountId=acc-1&fromPaymentDate=2026-02-01&toPaymentDate=2026-02-28&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().events).toEqual([
      expect.objectContaining({
        accountId: "acc-1",
        ticker: "2330",
        tickerName: "TSMC",
        paymentDate: "2026-02-20",
        eligibleQuantity: 10,
        expectedCashAmount: 120,
      }),
    ]);
    expect(response.json().events).toHaveLength(1);
  });

  it("returns only paid January 2026 rows for the month-scoped calendar snapshot", async () => {
    await seedInstrument();
    await seedBuyAtDate("2025-12-15");
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-01-10",
      paymentDate: "2026-01-20",
      cashDividendPerShare: 10,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-03-10",
      paymentDate: null,
      cashDividendPerShare: 9,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-04-10",
      paymentDate: "2026-04-20",
      cashDividendPerShare: 12,
    });

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-01-01&toPaymentDate=2026-01-31&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        expect.objectContaining({
          ticker: "2330",
          tickerName: "TSMC",
          paymentDate: "2026-01-20",
          expectedCashAmount: 100,
        }),
      ],
      ledgerEntries: [],
    });
    expect(response.json().events).toHaveLength(1);
    expect(response.json().events.every((event: { paymentDate: string | null }) => event.paymentDate !== null)).toBe(true);
  });

  it("returns only paid April 2026 rows for the month-scoped calendar snapshot", async () => {
    await seedInstrument();
    await seedBuyAtDate("2025-12-15");
    const aprilDividend = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-04-10",
      paymentDate: "2026-04-20",
      cashDividendPerShare: 11,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-01-10",
      paymentDate: "2026-01-20",
      cashDividendPerShare: 10,
    });
    await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-03-10",
      paymentDate: null,
      cashDividendPerShare: 9,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "calendar-april-posting" },
      payload: dividendPostingPayload({
        dividendEventId: aprilDividend.id,
        receivedCashAmount: 99,
        sourceLines: [
          {
            sourceBucket: "DIVIDEND_INCOME",
            amount: 110,
            currencyCode: "TWD",
            source: "issuer_statement",
            sourceReference: "stmt-2026-04",
          },
        ],
        deductions: [
          {
            deductionType: "NHI_SUPPLEMENTAL_PREMIUM",
            amount: 11,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "dividend_posting",
          },
        ],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);

    const response = await app.inject({
      method: "GET",
      url: "/portfolio/dividends/calendar?fromPaymentDate=2026-04-01&toPaymentDate=2026-04-30&limit=20",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      events: [
        expect.objectContaining({
          ticker: "2330",
          tickerName: "TSMC",
          paymentDate: "2026-04-20",
          hasPostedLedgerEntry: true,
        }),
      ],
      ledgerEntries: [
        expect.objectContaining({
          ticker: "2330",
          tickerName: "TSMC",
          paymentDate: "2026-04-20",
          receivedCashAmount: 99,
        }),
      ],
    });
    expect(response.json().events).toHaveLength(1);
    expect(response.json().ledgerEntries).toHaveLength(1);
    expect(response.json().events.every((event: { paymentDate: string | null }) => event.paymentDate !== null)).toBe(true);
  });

  it("updates posted cash dividends in place and emits dividend events", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    app.eventBus.subscribe("user-1", (event) => events.push({ type: event.type, data: event.data }));

    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });

    const initialPostingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting-initial" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 108,
      }),
    });
    expect(initialPostingResponse.statusCode).toBe(200);
    const initialPosting = initialPostingResponse.json();

    const updateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: initialPosting.dividendLedgerEntry.id,
        expectedVersion: initialPosting.dividendLedgerEntry.version,
        receivedCashAmount: 96,
        deductions: [
          {
            deductionType: "WITHHOLDING_TAX",
            amount: 24,
            currencyCode: "TWD",
            withheldAtSource: true,
            source: "broker_statement",
          },
        ],
        sourceLines: [
          {
            sourceBucket: "DIVIDEND_INCOME",
            amount: 120,
            currencyCode: "TWD",
            source: "broker_statement",
          },
        ],
      }),
    });

    expect(updateResponse.statusCode).toBe(200);
    const updatedPosting = updateResponse.json();
    expect(updatedPosting.dividendLedgerEntry.version).toBe(2);
    expect(updatedPosting.dividendLedgerEntry.reconciliationStatus).toBe("open");
    expect(updatedPosting.comparison.actualCashEconomicAmount).toBe(120);

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    const [updatedEntry] = ledgerResponse.json().ledgerEntries;
    expect(updatedEntry).toEqual(
      expect.objectContaining({
        id: initialPosting.dividendLedgerEntry.id,
        receivedCashAmount: 96,
        version: 2,
        deductions: [
          expect.objectContaining({
            deductionType: "WITHHOLDING_TAX",
            amount: 24,
          }),
        ],
      }),
    );

    // The seed transaction commits its replay synchronously, before this
    // dividend exists. Only the posting and amendment lifecycle events belong
    // to this operation; their relative order is the load-bearing contract.
    const dividendOnly = events.filter((event) => event.type.startsWith("dividend_"));
    expect(dividendOnly.map((event) => event.type)).toEqual(["dividend_posted", "dividend_updated"]);
  });

  it("posts stock dividends through the non-cash holdings path, amends before sells, and reverses/replaces after sells", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 0,
        receivedStockQuantity: 1,
        deductions: [
          {
            id: "cash-in-lieu-deduction",
            deductionType: "CASH_IN_LIEU_ADJUSTMENT",
            amount: 5,
            currencyCode: "TWD",
            withheldAtSource: false,
            source: "broker_statement",
          },
        ],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });

    expect(postingResponse.statusCode).toBe(200);
    const posting = postingResponse.json();
    expect(posting.comparison.expectedStockQuantity).toBe(1);
    expect(posting.positionAction).toEqual(expect.objectContaining({
      cashInLieuAmount: 5,
      cashInLieuCurrency: "TWD",
    }));

    const holdingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(holdingsResponse.statusCode).toBe(200);
    expect(holdingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 11,
        costBasisAmount: 1_000,
        currency: "TWD",
      },
    ]);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        expectedVersion: posting.dividendLedgerEntry.version,
        receivedCashAmount: 0,
        receivedStockQuantity: 2,
        deductions: [],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      }),
    });

    expect(updateResponse.statusCode).toBe(200);
    const updatedPosting = updateResponse.json();
    expect(updatedPosting.dividendLedgerEntry).toEqual(expect.objectContaining({
      id: posting.dividendLedgerEntry.id,
      receivedStockQuantity: 2,
      version: 2,
    }));
    expect(updatedPosting.positionAction).toEqual(expect.objectContaining({
      relatedDividendLedgerEntryId: posting.dividendLedgerEntry.id,
      quantity: 2,
      actionType: "STOCK_DIVIDEND",
    }));
    expect(updatedPosting.positionAction.actionTimestamp).toBeUndefined();

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stock-dividend-sell" },
      payload: transactionPayload({
        type: "SELL",
        quantity: 1,
        unitPrice: 120,
        tradeDate: "2026-03-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const replacementUpdateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-replacement-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        expectedVersion: updatedPosting.dividendLedgerEntry.version,
        receivedCashAmount: 0,
        receivedStockQuantity: 3,
        deductions: [],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      }),
    });

    expect(replacementUpdateResponse.statusCode).toBe(200);
    const replacementPosting = replacementUpdateResponse.json();
    expect(replacementPosting.dividendLedgerEntry).toEqual(expect.objectContaining({
      receivedStockQuantity: 3,
      postingStatus: "adjusted",
      version: 1,
    }));
    expect(replacementPosting.dividendLedgerEntry.id).not.toBe(posting.dividendLedgerEntry.id);
    expect(replacementPosting.positionAction).toEqual(expect.objectContaining({
      relatedDividendLedgerEntryId: replacementPosting.dividendLedgerEntry.id,
      quantity: 3,
      actionType: "STOCK_DIVIDEND",
    }));

    const store = await app.persistence.loadStore("user-1");
    const original = store.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === posting.dividendLedgerEntry.id);
    const reversal = store.accounting.facts.dividendLedgerEntries.find(
      (entry) => entry.reversalOfDividendLedgerEntryId === posting.dividendLedgerEntry.id,
    );
    expect(original?.supersededAt).toEqual(expect.any(String));
    expect(reversal).toEqual(expect.objectContaining({
      reversalOfDividendLedgerEntryId: posting.dividendLedgerEntry.id,
    }));

    const refreshedHoldingsResponse = await app.inject({ method: "GET", url: "/portfolio/holdings" });
    expect(refreshedHoldingsResponse.statusCode).toBe(200);
    expect(refreshedHoldingsResponse.json()).toEqual([
      {
        accountId: "acc-1",
        ticker: "2330",
        quantity: 12,
        costBasisAmount: 923.08,
        currency: "TWD",
      },
    ]);
  });

  it("rejects stock dividend corrections that would make later sells impossible without mutating projections", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "STOCK",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 0,
      stockDividendPerShare: 0.1,
    });

    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-preflight-posting" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 0,
        receivedStockQuantity: 1,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);
    const posting = postingResponse.json();

    const sellResponse = await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-stock-dividend-preflight-sell" },
      payload: transactionPayload({
        type: "SELL",
        quantity: 11,
        unitPrice: 120,
        tradeDate: "2026-03-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    expect(sellResponse.statusCode).toBe(200);

    const storeBefore = structuredClone(await app.persistence.loadStore("user-1"));
    const allocationCountBefore = storeBefore.accounting.projections.lotAllocations.length;
    expect(allocationCountBefore).toBeGreaterThan(0);

    const failingUpdateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-stock-dividend-preflight-failing-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: posting.dividendLedgerEntry.id,
        expectedVersion: posting.dividendLedgerEntry.version,
        receivedCashAmount: 0,
        receivedStockQuantity: 0,
        deductions: [],
        sourceLines: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
      }),
    });

    expect(failingUpdateResponse.statusCode).toBe(500);
    expect(failingUpdateResponse.json().error).toBe("internal_error");

    const storeAfter = await app.persistence.loadStore("user-1");
    expect(storeAfter.accounting.facts.dividendLedgerEntries).toEqual(storeBefore.accounting.facts.dividendLedgerEntries);
    expect(storeAfter.accounting.facts.positionActions).toEqual(storeBefore.accounting.facts.positionActions);
    const stableAllocations = (store: typeof storeBefore) => store.accounting.projections.lotAllocations.map((allocation) => ({
      id: allocation.id,
      tradeEventId: allocation.tradeEventId,
      lotId: allocation.lotId,
      allocatedQuantity: allocation.allocatedQuantity,
      allocatedCostAmount: allocation.allocatedCostAmount,
    }));
    const stableTradeCashEntries = (store: typeof storeBefore) => store.accounting.facts.cashLedgerEntries
      .filter((entry) => entry.relatedTradeEventId)
      .map((entry) => ({
        accountId: entry.accountId,
        relatedTradeEventId: entry.relatedTradeEventId,
        entryDate: entry.entryDate,
        entryType: entry.entryType,
        amount: entry.amount,
        currency: entry.currency,
      }));
    expect(stableAllocations(storeAfter)).toEqual(stableAllocations(storeBefore));
    expect(stableTradeCashEntries(storeAfter)).toEqual(stableTradeCashEntries(storeBefore));
  });

  it("rejects stock quantities for pure cash dividend postings", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 2,
      stockDividendPerShare: 0,
    });

    const response = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-cash-dividend-stock-quantity-reject" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 2000,
        receivedStockQuantity: 100,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual(expect.objectContaining({
      error: "cash_dividend_stock_quantity_not_allowed",
    }));
  });

  it("clears legacy stock quantities when editing pure cash dividend postings", async () => {
    await seedBuy();
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 2,
      stockDividendPerShare: 0,
    });
    const initialPostingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-legacy-cash-stock-quantity-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 2000,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    expect(initialPostingResponse.statusCode).toBe(200);
    const initialPosting = initialPostingResponse.json();

    const store = await app.persistence.loadStore("user-1");
    const legacyEntry = store.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === initialPosting.dividendLedgerEntry.id)!;
    legacyEntry.receivedStockQuantity = 100;
    store.accounting.facts.positionActions.push({
      id: "position-action-legacy-cash-stock-quantity",
      accountId: "acc-1",
      ticker: "2330",
      marketCode: "TW",
      actionType: "STOCK_DIVIDEND",
      actionDate: "2026-02-20",
      bookedAt: "2026-02-20T09:00:00.000Z",
      quantity: 100,
      relatedDividendLedgerEntryId: legacyEntry.id,
      source: "legacy_bad_cash_dividend",
      sourceReference: legacyEntry.id,
    });
    await app.persistence.saveStore(store);

    const updateResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-legacy-cash-stock-quantity-update" },
      payload: dividendPostingUpdatePayload({
        dividendEventId: dividendEvent.id,
        dividendLedgerEntryId: legacyEntry.id,
        expectedVersion: legacyEntry.version,
        receivedCashAmount: 1990,
        receivedStockQuantity: 0,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });

    expect(updateResponse.statusCode).toBe(200);
    expect(updateResponse.json().dividendLedgerEntry).toEqual(expect.objectContaining({
      receivedStockQuantity: 0,
      receivedCashAmount: 1990,
    }));

    const updatedStore = await app.persistence.loadStore("user-1");
    expect(updatedStore.accounting.facts.dividendLedgerEntries.find((entry) => entry.id === legacyEntry.id)).toEqual(expect.objectContaining({
      receivedStockQuantity: 0,
    }));
    expect(updatedStore.accounting.facts.positionActions.find((action) => action.id === "position-action-legacy-cash-stock-quantity")).toEqual(
      expect.objectContaining({
        supersededAt: expect.any(String),
      }),
    );
  });

  it("patches reconciliation status, requires note for explained, and rejects expected rows", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    app.eventBus.subscribe("user-1", (event) => events.push({ type: event.type, data: event.data }));

    await seedBuy();
    const postedEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-01",
      paymentDate: "2026-02-20",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-dividend-posting-reconciliation" },
      payload: dividendPostingPayload({
        dividendEventId: postedEvent.id,
        receivedCashAmount: 108,
      }),
    });
    const postedEntryId = postResponse.json().dividendLedgerEntry.id as string;

    const detailResponse = await app.inject({
      method: "GET",
      url: `/portfolio/dividends/postings/${postedEntryId}`,
    });
    expect(detailResponse.statusCode).toBe(200);
    expect(detailResponse.json()).toEqual(expect.objectContaining({
      id: postedEntryId,
      ticker: "2330",
      postingStatus: "posted",
    }));

    const matchedResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${postedEntryId}/reconciliation`,
      payload: dividendReconciliationPayload(),
    });
    expect(matchedResponse.statusCode).toBe(200);
    expect(matchedResponse.json().ledgerEntry).toEqual(
      expect.objectContaining({
        id: postedEntryId,
        reconciliationStatus: "matched",
        version: 2,
      }),
    );

    const explainedWithoutNote = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${postedEntryId}/reconciliation`,
      payload: dividendReconciliationPayload({ status: "explained" }),
    });
    expect(explainedWithoutNote.statusCode).toBe(400);
    expect(explainedWithoutNote.json()).toEqual(
      expect.objectContaining({ error: "reconciliation_note_required" }),
    );

    const explainedWithNote = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${postedEntryId}/reconciliation`,
      payload: dividendReconciliationPayload({ status: "explained", note: "Broker netted tax separately" }),
    });
    expect(explainedWithNote.statusCode).toBe(200);
    expect(explainedWithNote.json().ledgerEntry).toEqual(
      expect.objectContaining({
        id: postedEntryId,
        reconciliationStatus: "explained",
        reconciliationNote: "Broker netted tax separately",
        version: 3,
      }),
    );

    const store = await app.persistence.loadStore("user-1");
    const expectedEvent = createDividendEvent(store, {
      id: randomUUID(),
      ...dividendEventPayload({
        ticker: "2330",
        eventType: "CASH",
        exDividendDate: "2026-03-01",
        paymentDate: "2026-03-20",
        cashDividendPerShare: 5,
      }),
    } as CreateDividendEventInput);
    const expectedEntry: DividendLedgerEntry = {
      id: randomUUID(),
      accountId: "acc-1",
      dividendEventId: expectedEvent.id,
      eligibleQuantity: 10,
      expectedCashAmount: 50,
      expectedStockQuantity: 0,
      receivedCashAmount: 0,
      receivedStockQuantity: 0,
      postingStatus: "expected",
      reconciliationStatus: "open",
      version: 1,
      sourceCompositionStatus: "unknown_pending_disclosure",
      bookedAt: new Date().toISOString(),
    };
    store.accounting.facts.dividendLedgerEntries.push(expectedEntry);
    await app.persistence.saveStore(store);

    const expectedPatchResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${expectedEntry.id}/reconciliation`,
      payload: dividendReconciliationPayload(),
    });
    expect(expectedPatchResponse.statusCode).toBe(409);
    expect(expectedPatchResponse.json()).toEqual(
      expect.objectContaining({ error: "reconciliation_requires_posted_status" }),
    );

    expect(events.map((event) => event.type)).toContain("dividend_reconciliation_changed");
  });

  it("updates stored expected amounts when a retroactive trade lands (Rule B)", async () => {
    // Buy 1 share initially.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-retro-initial-buy" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    // Declare and post a dividend — eligibleQuantity captured at this moment = 1.
    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postingResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-retro-initial-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 12,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    expect(postingResponse.statusCode).toBe(200);
    const postedLedgerEntryId = postingResponse.json().dividendLedgerEntry.id;

    // Sanity: stored snapshot captured eligibleQuantity=1.
    let store = await app.persistence.loadStore("user-1");
    let storedEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === postedLedgerEntryId)!;
    expect(storedEntry.eligibleQuantity).toBe(1);
    expect(storedEntry.expectedCashAmount).toBe(12);
    const originalVersion = storedEntry.version;

    // Retroactively enter a forgotten BUY of 9 more shares dated before the
    // ex-dividend cutoff. The scheduled replay should recompute the posted
    // ledger entry and bring stored values in line with current trades.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-retro-late-buy" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    // Replay runs on setImmediate — yield the event loop to let it finish.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Stored snapshot should now reflect 10 × 12 = 120 via recompute.
    store = await app.persistence.loadStore("user-1");
    storedEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === postedLedgerEntryId)!;
    expect(storedEntry.eligibleQuantity).toBe(10);
    expect(storedEntry.expectedCashAmount).toBe(120);
    expect(storedEntry.version).toBe(originalVersion + 1);

    // GET endpoints must also reflect the recomputed values.
    const listResponse = await app.inject({ method: "GET", url: "/dividend-events" });
    const eventsBody = listResponse.json();
    const item = eventsBody.dividendEvents.find(
      (entry: { id: string }) => entry.id === dividendEvent.id,
    );
    expect(item).toEqual(
      expect.objectContaining({
        eligibleQuantity: 10,
        expectedCashAmount: 120,
      }),
    );

    const ledgerResponse = await app.inject({ method: "GET", url: "/portfolio/dividends/ledger" });
    const ledgerBody = ledgerResponse.json();
    expect(ledgerBody.ledgerEntries).toHaveLength(1);
    expect(ledgerBody.ledgerEntries[0]).toEqual(
      expect.objectContaining({
        eligibleQuantity: 10,
        expectedCashAmount: 120,
        receivedCashAmount: 12,
      }),
    );
  });

  it("resets a matched ledger entry to open and emits SSE when recompute changes expected (Rule B)", async () => {
    const events: Array<{ type: string; data: unknown }> = [];
    app.eventBus.subscribe("user-1", (event) => events.push({ type: event.type, data: event.data }));

    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-matched-initial" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-matched-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 12,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    const ledgerEntryId = postResponse.json().dividendLedgerEntry.id;

    // Mark matched manually.
    const matchedResponse = await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerEntryId}/reconciliation`,
      payload: { status: "matched" },
    });
    expect(matchedResponse.statusCode).toBe(200);

    // Add retroactive buy — recompute must reset status to "open" and
    // emit a dividend_reconciliation_changed event.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-matched-late-buy" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const store = await app.persistence.loadStore("user-1");
    const storedEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    expect(storedEntry.reconciliationStatus).toBe("open");
    expect(storedEntry.expectedCashAmount).toBe(120);
    // Two dividend_reconciliation_changed events: one from the manual PATCH,
    // one from the Rule B auto-reopen during recompute.
    const reconciliationEvents = events.filter((e) => e.type === "dividend_reconciliation_changed");
    expect(reconciliationEvents.length).toBeGreaterThanOrEqual(2);
    expect(reconciliationEvents.at(-1)?.data).toEqual(
      expect.objectContaining({
        dividendLedgerEntryId: ledgerEntryId,
        reconciliationStatus: "open",
      }),
    );
  });

  it("preserves reconciliation_note on explained → open transitions (1a)", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-explained-initial" },
      payload: transactionPayload({
        quantity: 1,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-explained-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 10,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    const ledgerEntryId = postResponse.json().dividendLedgerEntry.id;

    const explainedNote = "Broker netted a NT$2 rounding";
    await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerEntryId}/reconciliation`,
      payload: { status: "explained", note: explainedNote },
    });

    // Retroactive buy flips expected and triggers auto-reopen.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-explained-late-buy" },
      payload: transactionPayload({
        quantity: 9,
        unitPrice: 100,
        tradeDate: "2026-02-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const store = await app.persistence.loadStore("user-1");
    const entry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    expect(entry.reconciliationStatus).toBe("open");
    expect(entry.reconciliationNote).toBe(explainedNote); // preserved
  });

  it("is a full no-op when a trade does not change expected values (1b)", async () => {
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-noop-initial" },
      payload: transactionPayload({
        quantity: 10,
        unitPrice: 100,
        tradeDate: "2026-01-10",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });

    const dividendEvent = await seedDividendEvent({
      ticker: "2330",
      eventType: "CASH",
      exDividendDate: "2026-02-15",
      paymentDate: "2026-02-28",
      cashDividendPerShare: 12,
    });
    const postResponse = await app.inject({
      method: "POST",
      url: "/portfolio/dividends/postings",
      headers: { "idempotency-key": "k-noop-post" },
      payload: dividendPostingPayload({
        dividendEventId: dividendEvent.id,
        receivedCashAmount: 120,
        deductions: [],
        sourceCompositionStatus: "unknown_pending_disclosure",
        sourceLines: [],
      }),
    });
    const ledgerEntryId = postResponse.json().dividendLedgerEntry.id;

    await app.inject({
      method: "PATCH",
      url: `/portfolio/dividends/postings/${ledgerEntryId}/reconciliation`,
      payload: { status: "matched" },
    });

    let store = await app.persistence.loadStore("user-1");
    const beforeEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    const versionBefore = beforeEntry.version;
    expect(beforeEntry.reconciliationStatus).toBe("matched");

    // Add a trade AFTER the ex-dividend date — does not affect eligibility
    // and therefore must not change expected_cash_amount. Rule 1b: full no-op.
    await app.inject({
      method: "POST",
      url: "/portfolio/transactions",
      headers: { "idempotency-key": "k-noop-post-exdiv" },
      payload: transactionPayload({
        quantity: 5,
        unitPrice: 100,
        tradeDate: "2026-03-01",
        commissionAmount: 0,
        taxAmount: 0,
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    store = await app.persistence.loadStore("user-1");
    const afterEntry = store.accounting.facts.dividendLedgerEntries.find((e) => e.id === ledgerEntryId)!;
    expect(afterEntry.version).toBe(versionBefore);
    expect(afterEntry.reconciliationStatus).toBe("matched"); // preserved
    expect(afterEntry.expectedCashAmount).toBe(120);
  });
});
