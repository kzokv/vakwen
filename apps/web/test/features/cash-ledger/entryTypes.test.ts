import { describe, expect, it } from "vitest";
import type { CashLedgerEntryType } from "../../../features/cash-ledger/types";
import { cashLedgerEntryTypeLabel, ENTRY_TYPE_FILTER_OPTIONS, isCapitalReductionCashType, isFxTransferCashType } from "../../../features/cash-ledger/utils/entryTypes";
import { getDictionary } from "../../../lib/i18n";

const capitalTypes: CashLedgerEntryType[] = ["CAPITAL_REPAYMENT_RECEIPT", "CAPITAL_FRACTION_RECEIPT", "CAPITAL_REDUCTION_FEE_PAYMENT"];

describe("capital reduction cash movement labels and filters", () => {
  it("confirmed capital cash: label in both languages → identify repayment, proceeds and paid fee independently", () => {
    expect(capitalTypes.map(type => cashLedgerEntryTypeLabel(type, getDictionary("en")))).toEqual(["Capital repayment received", "Fractional proceeds received", "Capital reduction fee paid"]);
    expect(capitalTypes.map(type => cashLedgerEntryTypeLabel(type, getDictionary("zh-TW")))).toEqual(["減資退還股款實收", "畸零股結算款實收", "減資費用支付"]);
  });
  it("cash filters: select capital reduction component → preserve semantic receipt/payment types", () => {
    for (const type of capitalTypes) expect(ENTRY_TYPE_FILTER_OPTIONS).toContain(type);
    expect(ENTRY_TYPE_FILTER_OPTIONS.filter(type => isCapitalReductionCashType(type === "FX_TRANSFER" ? "FX_TRANSFER_IN" : type))).toEqual(capitalTypes);
  });
  it("source-linked cash: identify capital reduction facts → keep them out of editable FX transfers", () => {
    for (const type of capitalTypes) {
      expect(isCapitalReductionCashType(type)).toBe(true);
      expect(isFxTransferCashType(type)).toBe(false);
    }
    expect(isCapitalReductionCashType("MANUAL_ADJUSTMENT")).toBe(false);
    expect(isCapitalReductionCashType("DIVIDEND_RECEIPT")).toBe(false);
    expect(isFxTransferCashType("FX_TRANSFER_IN")).toBe(true);
  });
});
