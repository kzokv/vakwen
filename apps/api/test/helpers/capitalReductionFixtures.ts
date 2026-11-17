import { expect } from "vitest";
import type { AccountCapitalReductionDto, CapitalReductionInputDto, CapitalReductionPreviewDto, CapitalReductionConfirmDto } from "@vakwen/shared-types";
import type { Persistence } from "../../src/persistence/types.js";
import { createTransaction } from "../../src/services/portfolio.js";
import { previewCapitalReduction, confirmCapitalReduction, type CapitalReductionContext } from "../../src/services/capitalReduction.js";

/** Invented account facts only; distinct old-price/new-price/fraction-price bases. */
export const SYNTHETIC_PRICES = { old: 31, reference: 57.8, market: 60.25, fraction: 56.7 };
export function capitalReductionInput(accountId = "acc-1", overrides: Partial<CapitalReductionInputDto> = {}): CapitalReductionInputDto {
  return { operation: "POST", accountId, ticker: "SYNTH", confirmedWholeQuantity: 542,
    evidenceReference: "synthetic-delivery", reason: "Synthetic acceptance evidence", repaymentReceipts: [],
    announcement: { eventId: "synthetic-event", version: 1, ticker: "SYNTH", marketCode: "TW", venue: "TWSE", instrumentType: "STOCK", currency: "TWD",
      officialReference: "synthetic-reference", sourceUrl: "https://example.test/synthetic-announcement", publishedDate: "2026-01-01", reductionDate: "2026-02-01",
      suspensionStartDate: "2026-02-02", suspensionEndDate: "2026-02-05", exchangeRecordDate: "2026-02-04", conversionDate: "2026-02-06", scheduledPaymentDate: "2026-02-10",
      ratioNumerator: "542.0491512", ratioDenominator: "1000", repaymentPerOldShare: "4.579", payoutRounding: "FLOOR", officialReferencePrice: "57.80", fractionReferencePrice: "56.70" }, ...overrides };
}
export function confirmation(preview: Pick<CapitalReductionPreviewDto, "previewId" | "fingerprint" | "confirmationDigest" | "confirmationSummary">): CapitalReductionConfirmDto {
  return { previewId: preview.previewId, fingerprint: preview.fingerprint, confirmationDigest: preview.confirmationDigest, confirmationSummary: preview.confirmationSummary, confirmed: true };
}
export function ownerContext(userId = "user-1"): CapitalReductionContext { return { ownerUserId: userId, actorId: userId, authorize: async () => `synthetic-owner:${userId}` }; }
export async function seedCapitalReductionHolding(persistence: Persistence, userId = "user-1", quantities = [1000]) {
  await persistence.upsertInstruments(userId, [{ ticker: "SYNTH", type: "STOCK", marketCode: "TW", name: "Synthetic Acceptance Stock" }]);
  const store = await persistence.loadStore(userId), accountId = store.accounts[0]!.id;
  for (const [index, quantity] of quantities.entries()) createTransaction(store, userId, { id: `synthetic-buy-${index}`, accountId, ticker: "SYNTH", marketCode: "TW", quantity, unitPrice: 30, priceCurrency: "TWD", tradeDate: `2026-01-${String(index + 2).padStart(2, "0")}`, type: "BUY", commissionAmount: 0, taxAmount: 0, isDayTrade: false });
  await persistence.saveStore(store);
  return { userId, accountId, input: capitalReductionInput(accountId), cashBefore: store.accounting.facts.cashLedgerEntries.reduce((sum, row) => sum + row.amount, 0) };
}
export async function postCapitalReduction(persistence: Persistence, input: CapitalReductionInputDto, context = ownerContext()): Promise<AccountCapitalReductionDto> {
  const preview = await previewCapitalReduction(persistence, context, input);
  expect(preview.blockers, JSON.stringify(preview.blockers)).toEqual([]);
  return confirmCapitalReduction(persistence, context, confirmation(preview));
}
export function amendInput(action: AccountCapitalReductionDto, updates: Partial<CapitalReductionInputDto> = {}): CapitalReductionInputDto {
  return { ...structuredClone(action.revisions.at(-1)!.input), operation: "RECONCILE", actionId: action.id, expectedRevision: action.revision, reason: "Synthetic reconciliation", ...updates };
}
export const syntheticFraction = { id: "synthetic-fraction", evidenceReference: "synthetic-fraction-proof", receivedDate: "2026-02-12", grossAmount: 2, processingFeeAmount: 3, feeOffsetAmount: 2, cashAmount: 0, feeCashPaidAmount: 0 };
export const syntheticFeePayment = { id: "synthetic-fee-payment", evidenceReference: "synthetic-fee-payment-proof", occurredDate: "2026-02-13", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 0, feeCashPaidAmount: 1 };
