import type { AppDictionary } from "../../../lib/i18n";
import type { CashLedgerEntryType } from "../types";

export const FX_TRANSFER_ENTRY_TYPES: CashLedgerEntryType[] = ["FX_TRANSFER_OUT", "FX_TRANSFER_IN"];
export type EntryTypeFilterOption = CashLedgerEntryType | "FX_TRANSFER";
export const ENTRY_TYPE_FILTER_OPTIONS: EntryTypeFilterOption[] = [
  "TRADE_SETTLEMENT_IN", "TRADE_SETTLEMENT_OUT", "DIVIDEND_RECEIPT", "DIVIDEND_DEDUCTION",
  "CAPITAL_REPAYMENT_RECEIPT", "CAPITAL_FRACTION_RECEIPT", "CAPITAL_REDUCTION_FEE_PAYMENT",
  "MANUAL_ADJUSTMENT", "REVERSAL", "FX_TRANSFER",
];

export function cashLedgerEntryTypeLabel(entryType: CashLedgerEntryType, dict: AppDictionary): string {
  const labels: Record<CashLedgerEntryType, string> = {
    TRADE_SETTLEMENT_IN: dict.cashLedger.entryTypeTradeSettlementIn,
    TRADE_SETTLEMENT_OUT: dict.cashLedger.entryTypeTradeSettlementOut,
    DIVIDEND_RECEIPT: dict.cashLedger.entryTypeDividendReceipt,
    DIVIDEND_DEDUCTION: dict.cashLedger.entryTypeDividendDeduction,
    CAPITAL_REPAYMENT_RECEIPT: dict.cashLedger.entryTypeCapitalRepaymentReceipt,
    CAPITAL_FRACTION_RECEIPT: dict.cashLedger.entryTypeCapitalFractionReceipt,
    CAPITAL_REDUCTION_FEE_PAYMENT: dict.cashLedger.entryTypeCapitalReductionFeePayment,
    MANUAL_ADJUSTMENT: dict.cashLedger.entryTypeManualAdjustment,
    FX_TRANSFER_OUT: dict.cashLedger.entryTypeFxTransferOut,
    FX_TRANSFER_IN: dict.cashLedger.entryTypeFxTransferIn,
    REVERSAL: dict.cashLedger.entryTypeReversal,
  };
  return labels[entryType];
}

export function isCapitalReductionCashType(entryType: CashLedgerEntryType): boolean {
  return entryType === "CAPITAL_REPAYMENT_RECEIPT" || entryType === "CAPITAL_FRACTION_RECEIPT" || entryType === "CAPITAL_REDUCTION_FEE_PAYMENT";
}

/** Only actual FX legs offer independent transfer editing and reversal. */
export function isFxTransferCashType(entryType: CashLedgerEntryType): boolean {
  return entryType === "FX_TRANSFER_OUT" || entryType === "FX_TRANSFER_IN";
}
