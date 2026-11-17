import { ApiBaseArrange } from "../../mixins/index.js";
import type { CapitalReductionsEndpoint } from "../../endpoints/CapitalReductionsEndpoint.js";

export class CapitalReductionsApiArrange extends ApiBaseArrange {
  declare protected readonly _instance: CapitalReductionsEndpoint;
  syntheticInput(accountId = "acc-1") {
    return { operation: "POST", accountId, ticker: "SYNTH", confirmedWholeQuantity: 542, evidenceReference: "synthetic-http-delivery", reason: "Synthetic HTTP acceptance", repaymentReceipts: [] as Array<{ id: string; evidenceReference: string; receivedDate: string; grossAmount: number; cashAmount: number; feeAmount: number }>, announcement: {
      eventId: "synthetic-http-event", version: 1, ticker: "SYNTH", marketCode: "TW", venue: "TWSE", instrumentType: "STOCK", currency: "TWD", officialReference: "synthetic-http-reference", sourceUrl: "https://example.test/synthetic", publishedDate: "2026-01-01", reductionDate: "2026-02-01", suspensionStartDate: "2026-02-02", suspensionEndDate: "2026-02-05", exchangeRecordDate: "2026-02-04", conversionDate: "2026-02-06", scheduledPaymentDate: "2026-02-10", ratioNumerator: "542.0491512", ratioDenominator: "1000", repaymentPerOldShare: "4.579", payoutRounding: "FLOOR", officialReferencePrice: "57.80", fractionReferencePrice: "56.70" } };
  }
  confirmation(preview: Record<string, unknown>) {
    return { previewId: preview.previewId, fingerprint: preview.fingerprint, confirmationDigest: preview.confirmationDigest, confirmationSummary: preview.confirmationSummary, confirmed: true };
  }
}
