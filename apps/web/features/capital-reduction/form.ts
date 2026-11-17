import type { CapitalReductionAnnouncementDto, CapitalReductionFractionAdjustmentDto, CapitalReductionFractionSettlementDto, CapitalReductionRepaymentDto } from "@vakwen/shared-types";

export type AnnouncementForm = Omit<CapitalReductionAnnouncementDto, "version"> & { version: string };
export type RepaymentForm = { [Key in keyof CapitalReductionRepaymentDto]: string };
export type FractionAdjustmentForm = { [Key in keyof CapitalReductionFractionAdjustmentDto]: string };
export type FractionSettlementForm = { [Key in keyof CapitalReductionFractionSettlementDto]: string };

export function createAnnouncementForm(ticker: string): AnnouncementForm {
  return {
    eventId: "", version: "1", ticker, marketCode: "TW", venue: "TWSE", instrumentType: "STOCK", currency: "TWD",
    officialReference: "", sourceUrl: "", publishedDate: "", reductionDate: "", suspensionStartDate: "", suspensionEndDate: "", exchangeRecordDate: "", conversionDate: "", scheduledPaymentDate: "",
    ratioNumerator: "", ratioDenominator: "", repaymentPerOldShare: "", payoutRounding: "FLOOR", officialReferencePrice: "", fractionReferencePrice: "",
  };
}

export function announcementToForm(announcement: CapitalReductionAnnouncementDto): AnnouncementForm {
  const time = announcement.conversionTimestamp ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(announcement.conversionTimestamp)) : "00:00";
  return { ...announcement, version: String(announcement.version), conversionDate: `${announcement.conversionDate}T${time}` };
}

function amount(value: string): number {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value) || !Number.isFinite(Number(value))) throw new Error("INVALID_AMOUNT");
  return Number(value);
}

export function toAnnouncement(form: AnnouncementForm): CapitalReductionAnnouncementDto {
  if (!form.eventId || !form.officialReference.trim() || !/^https?:\/\//i.test(form.sourceUrl)) throw new Error("INVALID_SOURCE");
  const version = Number(form.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new Error("INVALID_VERSION");
  for (const key of ["ratioNumerator", "ratioDenominator", "repaymentPerOldShare"] as const) {
    if (!/^\d+(?:\.\d+)?$/.test(form[key]) || Number(form[key]) <= 0) throw new Error("INVALID_TERMS");
  }
  for (const key of ["publishedDate", "reductionDate", "suspensionStartDate", "suspensionEndDate", "exchangeRecordDate", "scheduledPaymentDate"] as const) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form[key])) throw new Error("INVALID_DATE");
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(form.conversionDate)) throw new Error("INVALID_DATE");
  const conversionDate = /(?:Z|[+-]\d{2}:\d{2})$/.test(form.conversionDate) ? form.conversionDate : `${form.conversionDate.slice(0, 16)}:00+08:00`;
  return {
    ...form, version, officialReference: form.officialReference.trim(), sourceUrl: form.sourceUrl.trim(), conversionDate: conversionDate.slice(0, 10), conversionTimestamp: conversionDate,
    officialReferencePrice: form.officialReferencePrice || undefined,
    fractionReferencePrice: form.fractionReferencePrice || undefined,
  };
}

export function toRepayment(form: RepaymentForm): CapitalReductionRepaymentDto {
  return { id: form.id, evidenceReference: form.evidenceReference, receivedDate: form.receivedDate, grossAmount: amount(form.grossAmount), cashAmount: amount(form.cashAmount), feeAmount: amount(form.feeAmount) };
}

export function toFractionSettlement(form: FractionSettlementForm): CapitalReductionFractionSettlementDto {
  return { id: form.id, evidenceReference: form.evidenceReference, receivedDate: form.receivedDate, grossAmount: amount(form.grossAmount), processingFeeAmount: amount(form.processingFeeAmount), feeOffsetAmount: amount(form.feeOffsetAmount), cashAmount: amount(form.cashAmount), feeCashPaidAmount: amount(form.feeCashPaidAmount) };
}

export function createRepaymentForm(): RepaymentForm {
  return { id: "", evidenceReference: "", receivedDate: "", grossAmount: "", cashAmount: "", feeAmount: "0" };
}
export function createFractionSettlementForm(): FractionSettlementForm {
  return { id: "", evidenceReference: "", receivedDate: "", grossAmount: "", processingFeeAmount: "0", feeOffsetAmount: "0", cashAmount: "0", feeCashPaidAmount: "0" };
}

export function createFractionAdjustmentForm(): FractionAdjustmentForm {
  return { id: "", evidenceReference: "", occurredDate: "", processingFeeAmount: "0", feeOffsetAmount: "0", cashAmount: "0", feeCashPaidAmount: "0" };
}

export function fractionAdjustmentToForm(adjustment: CapitalReductionFractionAdjustmentDto): FractionAdjustmentForm {
  return { ...adjustment, processingFeeAmount: String(adjustment.processingFeeAmount), feeOffsetAmount: String(adjustment.feeOffsetAmount), cashAmount: String(adjustment.cashAmount), feeCashPaidAmount: String(adjustment.feeCashPaidAmount) };
}

export function toFractionAdjustment(form: FractionAdjustmentForm): CapitalReductionFractionAdjustmentDto {
  if (!form.evidenceReference.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(form.occurredDate)) throw new Error("INVALID_EVIDENCE");
  return { id: form.id, evidenceReference: form.evidenceReference, occurredDate: form.occurredDate, processingFeeAmount: amount(form.processingFeeAmount), feeOffsetAmount: amount(form.feeOffsetAmount), cashAmount: amount(form.cashAmount), feeCashPaidAmount: amount(form.feeCashPaidAmount) };
}

/** Schedule dates and effective timestamps use Taiwan time, independently of the viewer's browser timezone. */
export function isFutureCapitalReductionConversion(announcement: Pick<CapitalReductionAnnouncementDto, "conversionDate" | "conversionTimestamp">, now = Date.now()): boolean {
  const taipeiDate = new Date(now + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return announcement.conversionDate > taipeiDate || Boolean(announcement.conversionTimestamp && Date.parse(announcement.conversionTimestamp) > now);
}
