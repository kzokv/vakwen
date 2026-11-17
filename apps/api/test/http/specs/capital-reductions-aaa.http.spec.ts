import { test } from "../fixtures.js";

test.describe("authenticated capital reduction HTTP contracts", () => {
  test.beforeEach(async ({ instrumentsApi, transactionsApi, capitalReductionsApi }) => {
    await capitalReductionsApi.assert.statusIs(await instrumentsApi.actions.seedInstruments([{ ticker: "SYNTH", name: "Synthetic HTTP Stock", instrumentType: "STOCK", marketCode: "TW", barsBackfillStatus: "ready" }]), 200);
    await capitalReductionsApi.assert.statusIs(await transactionsApi.actions.createTransaction({ accountId: "acc-1", ticker: "SYNTH", marketCode: "TW", quantity: 1000, unitPrice: 30, priceCurrency: "TWD", tradeDate: "2026-01-02", type: "BUY", commissionAmount: 0, taxAmount: 0, isDayTrade: false }, "synthetic-http-buy"), 200);
  });
  test("[R04 R10 R24]: OAuth preview → confirm → classify known net deposit without duplicate cash", async ({ capitalReductionsApi }) => {
    const input = capitalReductionsApi.arrange.syntheticInput();
    const previewResponse = await capitalReductionsApi.actions.preview(input); await capitalReductionsApi.assert.statusIs(previewResponse, 200);
    const preview = await previewResponse.json();
    await capitalReductionsApi.assert.fieldEquals(preview.calculation, "wholeQuantity", 542);
    await capitalReductionsApi.assert.fieldEquals(preview.calculation, "wholeCostAmount", 25418.69);
    const response = await capitalReductionsApi.actions.confirm(capitalReductionsApi.arrange.confirmation(preview)); await capitalReductionsApi.assert.statusIs(response, 200);
    let action = await response.json();
    const receipts = [{ id: "synthetic-net", evidenceReference: "synthetic-bank-credit", receivedDate: "2026-02-10", grossAmount: 4574, cashAmount: 4574, feeAmount: 0 }];
    const next = await capitalReductionsApi.actions.preview({ ...input, operation: "RECONCILE", actionId: action.id, expectedRevision: action.revision, repaymentReceipts: receipts });
    const nextResponse = await capitalReductionsApi.actions.confirm(capitalReductionsApi.arrange.confirmation(await next.json())); await capitalReductionsApi.assert.statusIs(nextResponse, 200); action = await nextResponse.json();
    await capitalReductionsApi.assert.fieldEquals(action.reconciliation, "outstandingRepaymentAmount", 5);
    const classified = await capitalReductionsApi.actions.preview({ ...input, operation: "RECONCILE", actionId: action.id, expectedRevision: action.revision, repaymentReceipts: [...receipts, { id: "synthetic-fee", evidenceReference: "synthetic-bank-fee", receivedDate: "2026-02-11", grossAmount: 5, cashAmount: 0, feeAmount: 5 }] });
    const classifiedResponse = await capitalReductionsApi.actions.confirm(capitalReductionsApi.arrange.confirmation(await classified.json())); await capitalReductionsApi.assert.statusIs(classifiedResponse, 200);
    const final = await classifiedResponse.json(); await capitalReductionsApi.assert.fieldEquals(final.reconciliation, "cashAmount", 4574); await capitalReductionsApi.assert.fieldEquals(final.reconciliation, "outstandingRepaymentAmount", 0); await capitalReductionsApi.assert.fieldEquals(final.reconciliation, "feeAmount", 5);
  });
  test("[R16 R24]: foreign actor or no cookie → confirmation cannot consume preview", async ({ capitalReductionsApi, sessionApi }) => {
    const input = capitalReductionsApi.arrange.syntheticInput(), preview = await (await capitalReductionsApi.actions.preview(input)).json();
    await capitalReductionsApi.assert.statusIs(await capitalReductionsApi.actions.previewForCookie(input, ""), 401);
    const session = await sessionApi.actions.createOauthSessionForClaims({ sub: "synthetic-http-stranger", email: "synthetic-http-stranger@example.test", name: "Synthetic Stranger" });
    const cookie = await sessionApi.arrange.sessionCookieHeader(session);
    await capitalReductionsApi.assert.statusIs(await capitalReductionsApi.actions.confirmForCookie(capitalReductionsApi.arrange.confirmation(preview), cookie), 404);
    await capitalReductionsApi.assert.statusIs(await capitalReductionsApi.actions.confirm(capitalReductionsApi.arrange.confirmation(preview)), 200);
  });
  test("[R02 R03]: future source-only confirmation → financial preview blocked", async ({ capitalReductionsApi }) => {
    const input = capitalReductionsApi.arrange.syntheticInput();
    input.announcement = { ...input.announcement, eventId: "synthetic-http-future-event", officialReference: "synthetic-http-future-reference", conversionDate: "2099-02-06", reductionDate: "2099-02-01", suspensionStartDate: "2099-02-02", suspensionEndDate: "2099-02-05", exchangeRecordDate: "2099-02-04", scheduledPaymentDate: "2099-02-10" };
    const preview = await capitalReductionsApi.actions.previewAnnouncement({ accountId: input.accountId, announcement: input.announcement, reason: "Synthetic future publication" });
    await capitalReductionsApi.assert.statusIs(preview, 200);
    const sourcePreview = await preview.json(); await capitalReductionsApi.assert.mxAssertEqual(sourcePreview.blockers.length, 0, "source preview has no blockers");
    await capitalReductionsApi.assert.statusIs(await capitalReductionsApi.actions.confirmAnnouncement(capitalReductionsApi.arrange.confirmation(sourcePreview)), 200);
    const list = await (await capitalReductionsApi.actions.list()).json(); await capitalReductionsApi.assert.mxAssertEqual(list.actions.length, 0, "source registration creates no account action");
    const financial = await (await capitalReductionsApi.actions.preview(input)).json(); await capitalReductionsApi.assert.mxAssertTruthy(financial.blockers.length > 0, "future financial conversion blocked");
  });
});
