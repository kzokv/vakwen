import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { previewCapitalReduction, confirmCapitalReduction, previewCapitalReductionAnnouncement, confirmCapitalReductionAnnouncement } from "../../src/services/capitalReduction.js";
import { createTransaction } from "../../src/services/portfolio.js";
import { capitalReductionInput, confirmation, ownerContext, postCapitalReduction, seedCapitalReductionHolding } from "../helpers/capitalReductionFixtures.js";

describe("cash capital reduction public contracts", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeEach(async () => { app = await buildApp({ persistenceBackend: "memory" }); await seedCapitalReductionHolding(app.persistence); });
  afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await app.close(); });
  it("[R03 R04 R06 R08 R09]: HTTP preview → exact account conversion without inferred cash", async () => {
    const result = await app.inject({ method: "POST", url: "/portfolio/capital-reductions/preview", payload: capitalReductionInput() });
    expect(result.statusCode).toBe(200); const preview = result.json();
    expect(preview.blockers).toEqual([]);
    expect(preview.calculation).toMatchObject({ theoreticalQuantity: "542.0491512", wholeQuantity: 542, fractionalQuantity: "0.0491512", grossRepaymentAmount: 4579, remainingCostAmount: 25421, wholeCostAmount: 25418.69, fractionalCostAmount: 2.31, estimatedFractionAmount: 2 });
    expect((await app.persistence.loadStore("user-1")).accounting.facts.positionActions).toHaveLength(0);
    const posted = await app.inject({ method: "POST", url: "/portfolio/capital-reductions/confirm", payload: confirmation(preview) });
    expect(posted.statusCode).toBe(200); expect(posted.json().reconciliation).toMatchObject({ outstandingRepaymentAmount: 4579, cashAmount: 0, fractionalStatus: "PENDING", reconciled: false });
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.projections.holdings.find(row => row.ticker === "SYNTH")).toMatchObject({ quantity: 542, costBasisAmount: 25418.69 });
    expect(store.accounting.facts.cashLedgerEntries.filter(row => row.relatedCapitalReductionId)).toHaveLength(0);
    expect(store.accounting.facts.dividendLedgerEntries).toHaveLength(0);
  });
  it("[R02 R03]: future source registration → immutable terms without conversion or receivable", async () => {
    const input = capitalReductionInput(); input.announcement.conversionDate = "2099-02-06";
    const before = await app.persistence.loadStore("user-1");
    const preview = await previewCapitalReductionAnnouncement(app.persistence, ownerContext(), { accountId: input.accountId, announcement: input.announcement, reason: "Synthetic future source" });
    expect(preview.blockers).toEqual([]);
    const source = await confirmCapitalReductionAnnouncement(app.persistence, ownerContext(), confirmation(preview));
    expect(source).toEqual(input.announcement);
    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.projections.holdings).toEqual(before.accounting.projections.holdings);
    expect(after.accounting.facts.cashLedgerEntries).toEqual(before.accounting.facts.cashLedgerEntries);
    expect(after.accounting.facts.capitalReductions!.actions).toHaveLength(0);
    expect((await previewCapitalReduction(app.persistence, ownerContext(), input)).blockers.length).toBeGreaterThan(0);
    const changed = structuredClone(input); changed.announcement.ratioNumerator = "500";
    expect((await previewCapitalReductionAnnouncement(app.persistence, ownerContext(), { accountId: input.accountId, announcement: changed.announcement, reason: "Synthetic changed version" })).blockers.length).toBeGreaterThan(0);
  });
  it.each(["2026-02-31", "2026-13-01"])("[R03]: nonexistent date %s → route rejects before facts", async date => {
    const input = capitalReductionInput(); input.announcement.publishedDate = date;
    const response = await app.inject({ method: "POST", url: "/portfolio/capital-reductions/preview", payload: input });
    expect(response.statusCode).toBe(400);
  });
  it.each(["javascript:alert(1)", "file:///synthetic"])("[R02]: unsafe source %s → rejected", async sourceUrl => {
    const input = capitalReductionInput(); input.announcement.sourceUrl = sourceUrl;
    expect((await app.inject({ method: "POST", url: "/portfolio/capital-reductions/preview", payload: input })).statusCode).toBe(400);
  });
  it.each(["currency", "instrument"])("[R01]: actual unsupported %s → client TW/STOCK literals cannot bypass", async kind => {
    const store = await app.persistence.loadStore("user-1");
    if (kind === "currency") store.accounts[0]!.defaultCurrency = "USD";
    else await app.persistence.upsertInstruments("user-1", [{ ticker: "SYNTH", type: "ETF", marketCode: "TW" }]);
    if (kind === "currency") await app.persistence.saveStore(store);
    await expect(previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput())).rejects.toMatchObject({ statusCode: 400, code: "unsupported_capital_reduction" });
    expect((await app.persistence.loadStore("user-1")).accounting.facts.positionActions).toHaveLength(0);
  });
  it("[R07]: wrong confirmed whole quantity or excessive repayment → blockers preserve balances", async () => {
    for (const input of [capitalReductionInput("acc-1", { confirmedWholeQuantity: 543 }), (() => { const input = capitalReductionInput(); input.announcement.repaymentPerOldShare = "31"; return input; })()]) {
      const preview = await previewCapitalReduction(app.persistence, ownerContext(), input);
      expect(preview.blockers.length).toBeGreaterThan(0);
      await expect(confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview))).rejects.toMatchObject({ statusCode: 409 });
    }
    expect((await app.persistence.loadStore("user-1")).accounting.projections.holdings[0]!.quantity).toBe(1000);
  });
  it("[R16 R17]: parallel identical confirms and safe retries → single stable action", async () => {
    const preview = await previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput());
    const results = await Promise.all(Array.from({ length: 4 }, () => confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview))));
    expect(new Set(results.map(row => row.id)).size).toBe(1);
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.capitalReductions!.actions).toHaveLength(1); expect(store.accounting.facts.positionActions).toHaveLength(1);
  });
  it("[R16]: changed evidence digest, actor, access or accounting history → confirmation rejected", async () => {
    const context = ownerContext(), preview = await previewCapitalReduction(app.persistence, context, capitalReductionInput());
    await expect(confirmCapitalReduction(app.persistence, context, { ...confirmation(preview), fingerprint: "tampered" })).rejects.toMatchObject({ statusCode: 409 });
    await expect(confirmCapitalReduction(app.persistence, { ...context, actorId: "synthetic-other" }, confirmation(preview))).rejects.toMatchObject({ statusCode: 404 });
    await expect(confirmCapitalReduction(app.persistence, { ...context, authorize: async () => "revoked-access" }, confirmation(preview))).rejects.toMatchObject({ statusCode: 409 });
    const store = await app.persistence.loadStore("user-1");
    createTransaction(store, "user-1", { id: "synthetic-later-buy", accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", quantity: 1, unitPrice: 30, priceCurrency: "TWD", tradeDate: "2026-03-01", type: "BUY", commissionAmount: 0, taxAmount: 0, isDayTrade: false });
    await app.persistence.saveStore(store);
    await expect(confirmCapitalReduction(app.persistence, context, confirmation(preview))).rejects.toMatchObject({ statusCode: 409 });
  });
  it("[R16]: expired preview → no conversion", async () => {
    const preview = await previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput());
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(Date.parse(preview.expiresAt) + 1);
    await expect(confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview))).rejects.toMatchObject({ statusCode: 409 });
  });
  it("[R17]: access revoked after success → retry still rechecks permission", async () => {
    const preview = await previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput()); await confirmCapitalReduction(app.persistence, ownerContext(), confirmation(preview));
    await expect(confirmCapitalReduction(app.persistence, { ...ownerContext(), authorize: async () => { throw new Error("synthetic revoked"); } }, confirmation(preview))).rejects.toThrow("synthetic revoked");
  });
  it("[R02 R14]: duplicate event alias or same account event → no second conversion", async () => {
    await postCapitalReduction(app.persistence, capitalReductionInput());
    for (const alias of [false, true]) { const input = capitalReductionInput(); if (alias) input.announcement.eventId = "synthetic-alias";
      expect((await previewCapitalReduction(app.persistence, ownerContext(), input)).blockers.length).toBeGreaterThan(0);
    }
  });
  it("[R05 R08]: two one-share purchases at half ratio → account floor retains one share with deterministic lineage", async () => {
    const identity = await app.persistence.resolveOrCreateUser("google", "synthetic-two-lot-owner", { email: "synthetic-two-lot@example.test" });
    const fixture = await seedCapitalReductionHolding(app.persistence, identity.userId, [1, 1]);
    const input = capitalReductionInput(fixture.accountId, { confirmedWholeQuantity: 1 });
    input.announcement = { ...input.announcement, eventId: "synthetic-two-lot-event", officialReference: "synthetic-two-lot-reference", ratioNumerator: "1", ratioDenominator: "2", repaymentPerOldShare: "0", venue: "TPEX" };
    const action = await postCapitalReduction(app.persistence, input, ownerContext(identity.userId));
    expect(action.calculation).toMatchObject({ wholeQuantity: 1, fractionalQuantity: "0", wholeCostAmount: 60, fractionalCostAmount: 0 });
    expect(action.calculation.allocations.map(row => [row.wholeQuantity, row.wholeCostAmount])).toEqual([[1, 60], [0, 0]]);
    const store = await app.persistence.loadStore(identity.userId);
    expect(store.accounting.facts.tradeEvents.map(row => row.id)).toEqual(["synthetic-buy-0", "synthetic-buy-1"]);
    expect(store.accounting.projections.holdings[0]).toMatchObject({ quantity: 1, costBasisAmount: 60 });
  });
  it("[R08]: zero whole entitlement → fractional cost retained with no positive holding", async () => {
    const identity = await app.persistence.resolveOrCreateUser("google", "synthetic-fraction-only-owner", { email: "synthetic-fraction-only@example.test" });
    const fixture = await seedCapitalReductionHolding(app.persistence, identity.userId, [1]);
    const input = capitalReductionInput(fixture.accountId, { confirmedWholeQuantity: 0 });
    input.announcement = { ...input.announcement, eventId: "synthetic-fraction-only-event", officialReference: "synthetic-fraction-only-reference", ratioNumerator: "1", ratioDenominator: "2", repaymentPerOldShare: "4" };
    const action = await postCapitalReduction(app.persistence, input, ownerContext(identity.userId));
    expect(action.calculation).toMatchObject({ wholeQuantity: 0, fractionalQuantity: "0.5", wholeCostAmount: 0, fractionalCostAmount: 26, grossRepaymentAmount: 4 });
    expect((await app.persistence.loadStore(identity.userId)).accounting.projections.holdings).toHaveLength(0);
  });
  it("[R16 R17]: two independent previews for same event → exactly one conversion wins", async () => {
    const first = await previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput());
    const second = await previewCapitalReduction(app.persistence, ownerContext(), capitalReductionInput());
    const results = await Promise.allSettled([confirmCapitalReduction(app.persistence, ownerContext(), confirmation(first)), confirmCapitalReduction(app.persistence, ownerContext(), confirmation(second))]);
    expect(results.filter(row => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(row => row.status === "rejected")).toHaveLength(1);
    expect((await app.persistence.loadStore("user-1")).accounting.facts.positionActions).toHaveLength(1);
  });
  it("[R02 R16]: newer published source version → existing financial preview stays pinned", async () => {
    const input = capitalReductionInput();
    const original = await previewCapitalReduction(app.persistence, ownerContext(), input);
    const newer = { ...input.announcement, version: 2, officialReferencePrice: "59" };
    const publication = await previewCapitalReductionAnnouncement(app.persistence, ownerContext(), { accountId: "acc-1", announcement: newer, reason: "Synthetic newer source" });
    expect(publication.blockers).toEqual([]); await confirmCapitalReductionAnnouncement(app.persistence, ownerContext(), confirmation(publication));
    const action = await confirmCapitalReduction(app.persistence, ownerContext(), confirmation(original));
    expect(action.revisions[0]!.input.announcement).toEqual(input.announcement);
  });
  it("[R01 R02 R24]: same public announcement reused in another account → private evidence stays scoped", async () => {
    const first = await postCapitalReduction(app.persistence, capitalReductionInput());
    const other = await app.persistence.createAccount({ userId: "user-1", name: "Synthetic Reused Source Account", defaultCurrency: "TWD", accountType: "broker", auditInput: { actorUserId: "user-1" } });
    const store = await app.persistence.loadStore("user-1");
    createTransaction(store, "user-1", { id: "synthetic-second-account-buy", accountId: other.account.id, ticker: "SYNTH", marketCode: "TW", quantity: 1000, unitPrice: 30, priceCurrency: "TWD", tradeDate: "2026-01-03", type: "BUY", commissionAmount: 0, taxAmount: 0, isDayTrade: false });
    await app.persistence.saveStore(store);
    const second = await postCapitalReduction(app.persistence, capitalReductionInput(other.account.id, { evidenceReference: "synthetic-second-account-private-proof" }));
    expect(second.id).not.toBe(first.id); expect(second.eventId).toBe(first.eventId);
    const response = await app.inject({ method: "GET", url: `/portfolio/capital-reductions?accountId=${other.account.id}` });
    expect(response.statusCode).toBe(200); const body = response.json();
    expect(body.actions.map((row: { id: string }) => row.id)).toEqual([second.id]);
    expect(body.announcements).toHaveLength(1); expect(JSON.stringify(body)).not.toContain("synthetic-delivery");
  });
  it("[R01 foreign catalog]: actual US-only stock with declared TW terms → cannot forge a Taiwan listing", async () => {
    await app.persistence.upsertInstruments("user-1", [{ ticker: "FOREIGNSYNTH", name: "Synthetic Overseas Stock", type: "STOCK", marketCode: "US" }]);
    const before = structuredClone(await app.persistence.loadStore("user-1"));
    expect(before.instruments.some(row => row.ticker === "FOREIGNSYNTH" && row.marketCode === "US" && row.type === "STOCK")).toBe(true);
    expect(before.instruments.some(row => row.ticker === "FOREIGNSYNTH" && row.marketCode === "TW")).toBe(false);
    const input = capitalReductionInput("acc-1", { ticker: "FOREIGNSYNTH" });
    input.announcement = { ...input.announcement, ticker: "FOREIGNSYNTH", eventId: "synthetic-forged-tw-event", officialReference: "synthetic-forged-tw-reference" };
    const response = await app.inject({ method: "POST", url: "/portfolio/capital-reductions/preview", payload: input });
    expect(response.statusCode).toBe(400); expect(response.json().error).toBe("unsupported_capital_reduction");
    const after = await app.persistence.loadStore("user-1");
    expect(after.accounting.facts).toEqual(before.accounting.facts); expect(after.accounting.projections).toEqual(before.accounting.projections);
  });
  it("[R07 per-lot cents]: aggregate cost covers repayment but one normalized lot does not → conversion blocked atomically", async () => {
    const identity = await app.persistence.resolveOrCreateUser("google", "synthetic-cent-guard-owner", { email: "synthetic-cent-guard@example.test" });
    await app.persistence.upsertInstruments(identity.userId, [{ ticker: "SYNTH", type: "STOCK", marketCode: "TW", name: "Synthetic Cent Guard Stock" }]);
    const initial = await app.persistence.loadStore(identity.userId), accountId = initial.accounts[0]!.id;
    for (const [index, unitPrice] of [0.33, 0.33, 0.34].entries()) {
      const trade = await app.inject({ method: "POST", url: "/portfolio/transactions", headers: { "x-user-id": identity.userId, "idempotency-key": `synthetic-cent-buy-${index}` }, payload: { accountId, ticker: "SYNTH", marketCode: "TW", quantity: 1, unitPrice, priceCurrency: "TWD", tradeDate: `2026-01-0${index + 2}`, type: "BUY", commissionAmount: 0, taxAmount: 0, isDayTrade: false } });
      expect(trade.statusCode, trade.body).toBe(200);
    }
    const before = structuredClone(await app.persistence.loadStore(identity.userId));
    const lots = before.accounting.projections.lots.filter(row => row.ticker === "SYNTH").sort((a, b) => a.openedAt.localeCompare(b.openedAt));
    expect(lots.map(row => row.openQuantity)).toEqual([1, 1, 1]);
    expect(lots.map(row => row.totalCostAmount)).toEqual([0.33, 0.34, 0.33]);
    expect(lots.reduce((sum, row) => sum + Math.round(row.totalCostAmount * 100), 0)).toBe(100);
    // Account payout floor(3 * 0.34) = 1.00. Equal-share Hamilton cents are [34,33,33].
    expect(34).toBeGreaterThan(Math.round(lots[0]!.totalCostAmount * 100));
    const input = capitalReductionInput(accountId, { confirmedWholeQuantity: 1 });
    input.announcement = { ...input.announcement, eventId: "synthetic-cent-guard-event", officialReference: "synthetic-cent-guard-reference", ratioNumerator: "1", ratioDenominator: "2", repaymentPerOldShare: "0.34" };
    const previewResponse = await app.inject({ method: "POST", url: "/portfolio/capital-reductions/preview", headers: { "x-user-id": identity.userId }, payload: input });
    expect(previewResponse.statusCode).toBe(200); const preview = previewResponse.json();
    expect(preview.blockers).toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/lot.*remaining cost/i) })]));
    const rejected = await app.inject({ method: "POST", url: "/portfolio/capital-reductions/confirm", headers: { "x-user-id": identity.userId }, payload: confirmation(preview) });
    expect(rejected.statusCode).toBe(409);
    const after = await app.persistence.loadStore(identity.userId);
    expect(after.accounting.facts.positionActions).toEqual(before.accounting.facts.positionActions);
    expect(after.accounting.facts.tradeEvents).toEqual(before.accounting.facts.tradeEvents);
    expect(after.accounting.facts.cashLedgerEntries).toEqual(before.accounting.facts.cashLedgerEntries);
    expect(after.accounting.projections).toEqual(before.accounting.projections);
    expect(after.accounting.facts.capitalReductions?.actions ?? []).toHaveLength(0);
  });
  it.each(["financial", "source-only"])("[R16 R17 F05 valid maximum]: %s preview → exact confirmation and retry preserve binding", async mode => {
    const input = capitalReductionInput("acc-1", { reason: "R".repeat(2000) });
    const sourceUrlPrefix = "https://example.test/";
    input.announcement = { ...input.announcement, eventId: "E".repeat(2000), officialReference: "S".repeat(2000), sourceUrl: `${sourceUrlPrefix}${"s".repeat(2000 - sourceUrlPrefix.length)}` };
    const financialSnapshot = async () => {
      const store = await app.persistence.loadStore("user-1");
      return structuredClone({ trades: store.accounting.facts.tradeEvents, cash: store.accounting.facts.cashLedgerEntries, positions: store.accounting.facts.positionActions, projections: store.accounting.projections, actions: store.accounting.facts.capitalReductions?.actions ?? [] });
    };
    const before = await financialSnapshot();
    const base = mode === "financial" ? "/portfolio/capital-reductions" : "/portfolio/capital-reductions/announcements";
    const payload = mode === "financial" ? input : { accountId: input.accountId, announcement: input.announcement, reason: input.reason };
    const previewResponse = await app.inject({ method: "POST", url: `${base}/preview`, payload });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200); const preview = previewResponse.json();
    expect(preview.blockers).toEqual([]); expect(preview.input.reason).toHaveLength(2000);
    expect(preview.input.announcement.eventId).toHaveLength(2000); expect(preview.input.announcement.sourceUrl).toHaveLength(2000);
    expect(await financialSnapshot()).toEqual(before);
    const issued = confirmation(preview);
    const tampered = await app.inject({ method: "POST", url: `${base}/confirm`, payload: { ...issued, confirmationSummary: `X${issued.confirmationSummary.slice(1)}` } });
    expect(tampered.statusCode, tampered.body).toBe(409); expect(tampered.json().error).toBe("capital_reduction_confirmation_mismatch");
    expect(await financialSnapshot()).toEqual(before);
    const whitespaceTamper = await app.inject({ method: "POST", url: `${base}/confirm`, payload: { ...issued, confirmationSummary: ` ${issued.confirmationSummary}` } });
    expect(whitespaceTamper.statusCode, whitespaceTamper.body).toBe(409);
    expect(await financialSnapshot()).toEqual(before);
    const confirmedResponse = await app.inject({ method: "POST", url: `${base}/confirm`, payload: issued });
    expect(confirmedResponse.statusCode, confirmedResponse.body).toBe(200); const confirmed = confirmedResponse.json();
    const retriedResponse = await app.inject({ method: "POST", url: `${base}/confirm`, payload: issued });
    expect(retriedResponse.statusCode, retriedResponse.body).toBe(200); const retried = retriedResponse.json();
    const store = await app.persistence.loadStore("user-1");
    expect(store.accounting.facts.capitalReductions!.announcements).toEqual([input.announcement]);
    if (mode === "financial") {
      expect(retried).toMatchObject({ id: confirmed.id, revision: 1, calculation: { wholeQuantity: 542, wholeCostAmount: 25418.69 } });
      expect(store.accounting.facts.capitalReductions!.actions).toHaveLength(1);
      expect(store.accounting.facts.capitalReductions!.actions[0]!.revisions).toHaveLength(1);
      expect(store.accounting.facts.capitalReductions!.actions[0]!.revisions[0]!.reason).toBe(input.reason);
      expect(store.accounting.facts.positionActions).toHaveLength(1);
      expect(store.accounting.projections.holdings.find(row => row.ticker === "SYNTH")).toMatchObject({ quantity: 542, costBasisAmount: 25418.69 });
      // Canonical replay rebuilds derived trade-cash IDs/bookedAt; every financial field stays exact.
      const cashEffects = (entries: typeof before.cash) => entries.map(entry => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "id" && key !== "bookedAt")));
      expect(store.accounting.facts.tradeEvents).toEqual(before.trades);
      expect(cashEffects(store.accounting.facts.cashLedgerEntries)).toEqual(cashEffects(before.cash));
    } else {
      expect(confirmed).toEqual(input.announcement); expect(retried).toEqual(input.announcement);
      expect(await financialSnapshot()).toEqual(before);
    }
  });
});
