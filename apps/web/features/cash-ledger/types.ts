import type { CapitalReductionCashEffectLinkDto } from "@vakwen/shared-types";

export type CashLedgerEntryType =
  | "CAPITAL_REPAYMENT_RECEIPT"
  | "CAPITAL_FRACTION_RECEIPT"
  | "CAPITAL_REDUCTION_FEE_PAYMENT"
  | "TRADE_SETTLEMENT_IN"
  | "TRADE_SETTLEMENT_OUT"
  | "DIVIDEND_RECEIPT"
  | "DIVIDEND_DEDUCTION"
  | "MANUAL_ADJUSTMENT"
  | "FX_TRANSFER_OUT"
  | "FX_TRANSFER_IN"
  | "REVERSAL";

export interface TradeDetail {
  quantity: number;
  unitPrice: number;
  commissionAmount: number;
  taxAmount: number;
}

export interface DividendDetail {
  expectedCashAmount: number;
  receivedCashAmount: number;
  deductionTotal: number;
}

export interface FxTransferDetail {
  pairedAccountId: string;
  pairedAccountName: string;
  pairedAmount: number;
  pairedCurrency: string;
  effectiveRate: number;
}

export interface EnrichedCashLedgerEntry extends CapitalReductionCashEffectLinkDto {
  id: string;
  userId: string;
  accountId: string;
  entryDate: string;
  entryType: CashLedgerEntryType;
  amount: number;
  currency: string;
  relatedTradeEventId?: string;
  relatedDividendLedgerEntryId?: string;
  source: string;
  sourceReference?: string;
  note?: string;
  reversalOfCashLedgerEntryId?: string;
  bookedAt?: string;
  fxTransferId?: string | null;
  ticker: string | null;
  side: "BUY" | "SELL" | null;
  tradeDetail?: TradeDetail;
  dividendDetail?: DividendDetail;
  fxTransferDetail?: FxTransferDetail;
  fxTransferReversed?: boolean;
}

export interface CashLedgerSummary {
  accountId: string;
  currency: string;
  amount: number;
}

export type CashLedgerSortColumn = "entryDate" | "entryType" | "amount" | "currency" | "accountId";

export interface CashLedgerListResponse {
  entries: EnrichedCashLedgerEntry[];
  summary: CashLedgerSummary[];
  total: number;
}

export interface CashLedgerQuery {
  fromEntryDate?: string;
  toEntryDate?: string;
  accountId?: string;
  entryType?: CashLedgerEntryType[];
  limit?: number;
  page?: number;
  sortBy?: CashLedgerSortColumn;
  sortOrder?: "asc" | "desc";
}
