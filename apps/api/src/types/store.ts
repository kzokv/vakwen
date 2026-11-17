import type { CapitalReductionFacts } from "./capitalReduction.js";
import type { CapitalReductionInputDto, CapitalReductionCashEffectLinkDto } from "@vakwen/shared-types";
import type { CurrencyCode, FeeProfile, InstrumentRef, InstrumentType, Lot, MarketCode } from "@vakwen/domain";
import type {
  AccountDto,
  DividendCalculationDriftDto,
  DividendStockCalculationMethod,
  DividendStockProviderValueUnit,
  DividendCashReconciliationDto,
  DividendSourceLine,
  ExpectedStockCalcState,
  SourceCompositionStatus,
  StockDistributionRatioState,
  UserSettings,
  RecomputeAggregateCountsDto,
  RecomputeCurrencyImpactDto,
  RecomputeFeeMode,
  RecomputeJobStatus,
} from "@vakwen/shared-types";

// KZO-183: `marketCode` removed. Market is now derived from the binding's
// account.defaultCurrency rather than stored on the binding. Per-symbol
// override resolution is keyed by (accountId, ticker) only.
export interface FeeProfileBinding {
  accountId: string;
  ticker: string;
  feeProfileId: string;
}

export interface InstrumentDef {
  ticker: string;
  name?: string | null;
  type: InstrumentType | null;
  // KZO-169: required after migration 044's composite PK + provider stamping
  // audit (G1). Every code path that produces an InstrumentDef must supply a
  // valid market — fail-loud is preferred over a `?? "TW"` fallback.
  marketCode: MarketCode;
  isProvisional?: boolean;
  lastSyncedAt?: string | null;
  typeRaw?: string | null;
  industryCategoryRaw?: string | null;
  finmindDate?: string | null;
}

export type TransactionType = "BUY" | "SELL";

export interface BookedTradeEvent {
  id: string;
  userId: string;
  accountId: string;
  ticker: string;
  // KZO-169: required after migration 044. Books a trade against a specific
  // (ticker, market_code) — derives `priceCurrency` via `currencyFor()`.
  marketCode: MarketCode;
  instrumentType: InstrumentType;
  type: TransactionType;
  quantity: number;
  unitPrice: number;
  priceCurrency: CurrencyCode;
  tradeDate: string;
  commissionAmount: number;
  taxAmount: number;
  isDayTrade: boolean;
  feeSnapshot: FeeProfile;
  realizedPnlAmount?: number;
  realizedPnlCurrency?: CurrencyCode;
  tradeTimestamp?: string;
  bookingSequence?: number;
  source?: string;
  sourceReference?: string;
  bookedAt?: string;
  reversalOfTradeEventId?: string;
  feesSource?: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED";
}

export type Transaction = BookedTradeEvent;

export type CashLedgerEntryType =
  | "TRADE_SETTLEMENT_IN"
  | "TRADE_SETTLEMENT_OUT"
  | "DIVIDEND_RECEIPT"
  | "DIVIDEND_DEDUCTION"
  | "CAPITAL_REPAYMENT_RECEIPT"
  | "CAPITAL_FRACTION_RECEIPT"
  | "CAPITAL_REDUCTION_FEE_PAYMENT"
  | "MANUAL_ADJUSTMENT"
  | "FX_TRANSFER_OUT"
  | "FX_TRANSFER_IN"
  | "REVERSAL";

export interface CashLedgerEntry extends CapitalReductionCashEffectLinkDto {
  id: string;
  userId: string;
  accountId: string;
  entryDate: string;
  entryType: CashLedgerEntryType;
  amount: number;
  currency: CurrencyCode;
  relatedTradeEventId?: string;
  relatedDividendLedgerEntryId?: string;
  source: string;
  sourceReference?: string;
  note?: string;
  reversalOfCashLedgerEntryId?: string;
  bookedAt?: string;
  fxTransferId?: string | null;
  /**
   * KZO-166: USD rate at the moment of FX conversion. Non-null **only** for
   * cash entries that represent an FX conversion (KZO-168 FX_TRANSFER pair).
   * MANUAL_ADJUSTMENT entries set by tests may also stamp this field to drive
   * the WAC engine in the absence of KZO-168.
   */
  fxRateToUsd?: number | null;
}

export type DividendEventType = "CASH" | "STOCK" | "CASH_AND_STOCK";

export interface DividendEvent {
  id: string;
  ticker: string;
  marketCode?: MarketCode;
  eventType: DividendEventType;
  exDividendDate: string;
  paymentDate: string | null;
  cashDividendPerShare: number;
  cashDividendCurrency: CurrencyCode;
  stockDividendPerShare: number;
  stockDistributionAmountRaw?: number | null;
  stockProviderValue?: string | null;
  stockProviderValueUnit?: DividendStockProviderValueUnit | null;
  stockProviderSource?: string | null;
  stockProviderDataset?: string | null;
  stockProviderAuthoritativeRatio?: string | null;
  stockDistributionRatio?: number | null;
  stockDistributionRatioState?: StockDistributionRatioState;
  stockParValueAmount?: number | null;
  stockParValueCurrency?: CurrencyCode | null;
  source: string;
  sourceReference?: string;
  createdAt?: string;
  fiscalYearPeriod?: string;
  announcementDate?: string;
  totalDistributionShares?: number;
}

export type DividendPostingStatus = "expected" | "posted" | "adjusted";
export type DividendReconciliationStatus = "open" | "matched" | "explained" | "resolved";
export type DividendStockReconciliationStatus = "needs_calculation" | "pending_receipt" | "matched" | "variance" | "explained";

export interface DividendLedgerEntry {
  id: string;
  accountId: string;
  dividendEventId: string;
  eligibleQuantity: number;
  expectedCashAmount: number;
  expectedStockQuantity: number;
  expectedStockCalcState?: ExpectedStockCalcState;
  expectedStockDistributionRatio?: number | null;
  expectedStockParValueAmount?: number | null;
  activeCalculationId?: string | null;
  cashReconciliationStatus?: DividendReconciliationStatus;
  stockReconciliationStatus?: DividendStockReconciliationStatus | null;
  stockReconciliationNote?: string | null;
  legacyReconciliationStatus?: DividendReconciliationStatus | null;
  legacyReconciliationNote?: string | null;
  receivedCashAmount: number;
  receivedStockQuantity: number;
  postingStatus: DividendPostingStatus;
  reconciliationStatus: DividendReconciliationStatus;
  version: number;
  sourceCompositionStatus: SourceCompositionStatus;
  cashReconciliation?: DividendCashReconciliationDto;
  reconciliationNote?: string;
  reversalOfDividendLedgerEntryId?: string;
  supersededAt?: string;
  bookedAt?: string;
}

export interface DividendCalculationVersion {
  id: string;
  userId: string;
  accountId: string;
  dividendEventId: string;
  calculationVersion: number;
  status: "preview" | "confirmed" | "reset" | "amended";
  method: DividendStockCalculationMethod;
  providerValue?: string | null;
  providerUnit?: DividendStockProviderValueUnit | null;
  providerSource?: string | null;
  providerDataset?: string | null;
  providerAuthoritativeRatio?: string | null;
  selectedParValue?: string | null;
  customRatio?: string | null;
  ratio: string;
  theoreticalShares: string;
  expectedWholeShares: number | null;
  fractionalRemainder: string | null;
  requiresHighRatioConfirmation: boolean;
  confirmedAt?: string | null;
  supersededAt?: string | null;
  priorCalculationId?: string | null;
  dividendLedgerEntryId?: string | null;
  drift?: DividendCalculationDriftDto | null;
  createdAt?: string;
}
export type DividendDeductionType =
  | "NHI_SUPPLEMENTAL_PREMIUM"
  | "WITHHOLDING_TAX"
  | "BROKER_FEE"
  | "BANK_FEE"
  | "TRANSFER_FEE"
  | "CASH_IN_LIEU_ADJUSTMENT"
  | "ROUNDING_ADJUSTMENT"
  | "OTHER";

export interface DividendDeductionEntry {
  id: string;
  dividendLedgerEntryId: string;
  deductionType: DividendDeductionType;
  amount: number;
  currencyCode: CurrencyCode;
  withheldAtSource: boolean;
  source: string;
  sourceReference?: string;
  note?: string;
  bookedAt?: string;
}
export interface RecomputePreviewItem {
  tradeEventId: string;
  currency: CurrencyCode;
  feesSource: "CALCULATED" | "MANUAL" | "SOURCE_PROVIDED";
  previousCommissionAmount: number;
  previousTaxAmount: number;
  nextCommissionAmount: number;
  nextTaxAmount: number;
  appliedProfileId: string | null;
  appliedFeeProfile: FeeProfile | null;
}

export interface RecomputeJob {
  id: string;
  userId: string;
  accountId?: string;
  profileId: string;
  useFallbackBindings: boolean;
  status: RecomputeJobStatus;
  mode: RecomputeFeeMode;
  fingerprint: string;
  expiresAt: string;
  startedAt?: string;
  completedAt?: string;
  errorCode?: string;
  errorMessage?: string;
  counts: RecomputeAggregateCountsDto;
  impactsByCurrency: RecomputeCurrencyImpactDto[];
  accountRevisions: Record<string, number>;
  feeConfigFingerprint: string;
  createdAt: string;
  items: RecomputePreviewItem[];
}

export type CorporateActionType = "DIVIDEND" | "SPLIT" | "REVERSE_SPLIT";

export interface CorporateAction {
  id: string;
  accountId: string;
  ticker: string;
  actionType: CorporateActionType;
  numerator: number;
  denominator: number;
  actionDate: string;
}

export type PositionActionType = "STOCK_DIVIDEND" | "SPLIT" | "REVERSE_SPLIT" | "CASH_CAPITAL_REDUCTION";

export interface PositionAction {
  capitalReduction?: CapitalReductionInputDto;
  id: string;
  accountId: string;
  ticker: string;
  marketCode: MarketCode;
  actionType: PositionActionType;
  actionDate: string;
  actionTimestamp?: string;
  bookedAt?: string;
  quantity: number;
  ratioNumerator?: number;
  ratioDenominator?: number;
  cashInLieuQuantity?: number;
  cashInLieuAmount?: number;
  cashInLieuCurrency?: CurrencyCode;
  parValuePerShare?: number;
  premiumBaseAmount?: number;
  nhiPremiumBaseAmount?: number;
  relatedDividendLedgerEntryId?: string;
  source: string;
  sourceReference?: string;
  reversalOfPositionActionId?: string;
  supersededAt?: string;
}

export interface HoldingProjection {
  accountId: string;
  ticker: string;
  quantity: number;
  costBasisAmount: number;
  currency: CurrencyCode;
}

export interface LotAllocationProjection {
  id: string;
  userId: string;
  accountId: string;
  tradeEventId: string;
  ticker: string;
  lotId: string;
  lotOpenedAt: string;
  lotOpenedSequence: number;
  allocatedQuantity: number;
  allocatedCostAmount: number;
  costCurrency: CurrencyCode;
  createdAt?: string;
}

export interface DailyPortfolioSnapshot {
  id: string;
  snapshotDate: string;
  totalMarketValueAmount: number;
  totalCostAmount: number;
  totalUnrealizedPnlAmount: number;
  totalRealizedPnlAmount: number;
  totalDividendReceivedAmount: number;
  totalCashBalanceAmount: number;
  totalNavAmount: number;
  currency: CurrencyCode;
  generatedAt: string;
  generationRunId: string;
}

export interface AccountingFacts {
  capitalReductions?: CapitalReductionFacts;
  tradeEvents: BookedTradeEvent[];
  cashLedgerEntries: CashLedgerEntry[];
  dividendLedgerEntries: DividendLedgerEntry[];
  dividendCalculationVersions: DividendCalculationVersion[];
  dividendDeductionEntries: DividendDeductionEntry[];
  dividendSourceLines: DividendSourceLine[];
  positionActions: PositionAction[];
  corporateActions: CorporateAction[];
}

export interface MarketDataFacts {
  dividendEvents: DividendEvent[];
  instruments: InstrumentRef[];
}

export interface AccountingProjections {
  lots: Lot[];
  lotAllocations: LotAllocationProjection[];
  holdings: HoldingProjection[];
  dailyPortfolioSnapshots: DailyPortfolioSnapshot[];
}

export interface AccountingPolicy {
  inventoryModel: "LOT_CAPABLE";
  disposalPolicy: "WEIGHTED_AVERAGE";
}

export interface AccountingStore {
  facts: AccountingFacts;
  projections: AccountingProjections;
  policy: AccountingPolicy;
}

export interface Store {
  userId: string;
  settings: UserSettings;
  accounts: AccountDto[];
  feeProfileBindings: FeeProfileBinding[];
  feeProfiles: FeeProfile[];
  accounting: AccountingStore;
  marketData: MarketDataFacts;
  instruments: InstrumentDef[];
  recomputeJobs: RecomputeJob[];
  idempotencyKeys: Set<string>;
}
