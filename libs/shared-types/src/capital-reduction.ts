/** Decimal source inputs remain strings; displayed numbers must never replace source precision. */
export interface CapitalReductionAnnouncementDto {
  eventId: string;
  version: number;
  ticker: string;
  marketCode: "TW";
  venue: "TWSE" | "TPEX";
  instrumentType: "STOCK";
  currency: "TWD";
  officialReference: string;
  sourceUrl: string;
  publishedDate: string;
  reductionDate: string;
  suspensionStartDate: string;
  suspensionEndDate: string;
  exchangeRecordDate: string;
  conversionDate: string;
  conversionTimestamp?: string;
  scheduledPaymentDate: string;
  ratioNumerator: string;
  ratioDenominator: string;
  repaymentPerOldShare: string;
  payoutRounding: "FLOOR" | "HALF_UP";
  officialReferencePrice?: string;
  fractionReferencePrice?: string;
}
export interface CapitalReductionRepaymentDto {
  id: string;
  evidenceReference: string;
  receivedDate: string;
  /** Classification-only entries have cashAmount zero. */
  grossAmount: number;
  cashAmount: number;
  feeAmount: number;
}
export interface CapitalReductionFractionSettlementDto {
  id: string;
  evidenceReference: string;
  receivedDate: string;
  grossAmount: number;
  processingFeeAmount: number;
  feeOffsetAmount: number;
  cashAmount: number;
  feeCashPaidAmount: number;
}
export interface CapitalReductionFractionAdjustmentDto {
  id: string;
  evidenceReference: string;
  occurredDate: string;
  processingFeeAmount: number;
  feeOffsetAmount: number;
  cashAmount: number;
  feeCashPaidAmount: number;
}
export interface CapitalReductionInputDto {
  operation: "POST" | "RECONCILE" | "AMEND" | "VOID" | "RESTORE";
  accountId: string;
  ticker: string;
  announcement: CapitalReductionAnnouncementDto;
  actionId?: string;
  expectedRevision?: number;
  confirmedWholeQuantity: number;
  evidenceReference: string;
  reason: string;
  repaymentReceipts: CapitalReductionRepaymentDto[];
  fractionSettlement?: CapitalReductionFractionSettlementDto;
  fractionAdjustments?: CapitalReductionFractionAdjustmentDto[];
}
export interface CapitalReductionCalculationDto {
  theoreticalQuantity: string;
  wholeQuantity: number;
  fractionalQuantity: string;
  grossRepaymentAmount: number;
  remainingCostAmount: number;
  wholeCostAmount: number;
  fractionalCostAmount: number;
  estimatedFractionAmount: number | null;
  allocations: Array<{ lotId: string; oldQuantity: number; oldCostAmount: number; wholeQuantity: number; repaymentAmount: number; wholeCostAmount: number }>;
}
export interface CapitalReductionReconciliationDto {
  outstandingRepaymentAmount: number;
  cashAmount: number;
  feeAmount: number;
  fractionalRealizedAmount: number;
  outstandingFractionFeeAmount: number;
  outstandingFractionProceedsAmount: number;
  fractionalStatus: "NONE" | "PENDING" | "SETTLED";
  reconciled: boolean;
}
export interface CapitalReductionValuationDto {
  status: "SUSPENDED" | "MARKET" | "OFFICIAL_REFERENCE" | "INCOMPLETE";
  valuationDate: string | null;
  sharePrice: number | null;
  deliveredShareValue: number | null;
  repaymentReceivableValue: number;
  pendingFractionValue: number | null;
  totalAssetValue: number | null;
  unresolvedFees: boolean;
}
export interface CapitalReductionGenerationDto {
  status: "stale" | "queued" | "running" | "failed" | "current";
  fromDate: string;
  updatedAt: string;
  error?: string;
  retryable: boolean;
}
export interface CapitalReductionRevisionDto {
  revision: number;
  operation: CapitalReductionInputDto["operation"];
  actorId: string;
  confirmedAt: string;
  reason: string;
  input: CapitalReductionInputDto;
  calculation: CapitalReductionCalculationDto;
  reconciliation: CapitalReductionReconciliationDto;
  supersededFactIds: string[];
}
export interface AccountCapitalReductionDto {
  id: string;
  accountId: string;
  ticker: string;
  eventId: string;
  revision: number;
  status: "POSTED" | "VOIDED";
  revisions: CapitalReductionRevisionDto[];
  calculation: CapitalReductionCalculationDto;
  reconciliation: CapitalReductionReconciliationDto;
  valuation: CapitalReductionValuationDto;
  generation: CapitalReductionGenerationDto;
}
export interface CapitalReductionPreviewDto {
  previewId: string;
  fingerprint: string;
  confirmationDigest: string;
  confirmationSummary: string;
  expiresAt: string;
  input: CapitalReductionInputDto;
  calculation: CapitalReductionCalculationDto | null;
  reconciliation: CapitalReductionReconciliationDto | null;
  valuation: CapitalReductionValuationDto | null;
  priorAction?: AccountCapitalReductionDto;
  eligibleLots: Array<{ id: string; openQuantity: number; totalCostAmount: number; openedAt: string; openedSequence?: number }>;
  supersededFactIds: string[];
  laterSales: Array<{ tradeEventId: string; priorCostAmount: number; nextCostAmount: number; differenceAmount: number }>;
  affectedSnapshotDates: string[];
  cashDifferenceAmount: number;
  receivableDifferenceAmount: number;
  warnings: string[];
  blockers: Array<{ code: string; message: string }>;
}
export interface CapitalReductionConfirmDto {
  previewId: string;
  fingerprint: string;
  confirmationDigest: string;
  confirmationSummary: string;
  confirmed: true;
}
export interface CapitalReductionPortfolioSummaryDto {
  currency: "TWD";
  outstandingRepaymentAmount: number;
  pendingFractionValueAmount: number | null;
  pendingFractionCostAmount: number;
  confirmedFeeAmount: number;
  fractionalRealizedAmount: number;
  outstandingFractionFeeAmount: number;
  outstandingFractionProceedsAmount: number;
  cashBalanceAmount: number;
  deliveredStockValueAmount: number | null;
  navAmount: number | null;
  valuationComplete: boolean;
  generationStatus: CapitalReductionGenerationDto["status"];
  returnsComplete: boolean;
}
export interface CapitalReductionAnnouncementInputDto {
  accountId: string;
  announcement: CapitalReductionAnnouncementDto;
  reason: string;
}
export interface CapitalReductionAnnouncementPreviewDto {
  previewId: string;
  fingerprint: string;
  confirmationDigest: string;
  confirmationSummary: string;
  expiresAt: string;
  input: CapitalReductionAnnouncementInputDto;
  blockers: Array<{ code: string; message: string }>;
  warnings: string[];
}
export interface CapitalReductionAnnouncementGenerationDto {
  accountId: string;
  eventId: string;
  version: number;
  generation: CapitalReductionGenerationDto;
}
/** Canonical parent link on cash-ledger wire records; sourceReference identifies one effect. */
export interface CapitalReductionCashEffectLinkDto {
  relatedCapitalReductionId?: string;
}
