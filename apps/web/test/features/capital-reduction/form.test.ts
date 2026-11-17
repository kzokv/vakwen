import { describe, expect, it } from "vitest";
import { createAnnouncementForm, announcementToForm, toAnnouncement, toRepayment, toFractionSettlement, createFractionAdjustmentForm, toFractionAdjustment, fractionAdjustmentToForm, isFutureCapitalReductionConversion } from "../../../features/capital-reduction/form";

describe("capital reduction form", () => {
  it("source terms: map independent dates and precise ratios → preserve published evidence", () => {
    const form = { ...createAnnouncementForm("SYNTH"), eventId: "synthetic-event", officialReference: "synthetic-publication", sourceUrl: "https://example.com/announcement", publishedDate: "2026-01-01", reductionDate: "2026-01-02", suspensionStartDate: "2026-01-03", suspensionEndDate: "2026-01-04", exchangeRecordDate: "2026-01-05", conversionDate: "2026-01-06T09:00", scheduledPaymentDate: "2026-01-07", ratioNumerator: "542.0491512", ratioDenominator: "1000", repaymentPerOldShare: "4.579" };
    const result = toAnnouncement(form);
    expect(result.ratioNumerator).toBe("542.0491512");
    expect(result.conversionDate).toBe("2026-01-06");
    expect(result.conversionTimestamp).toBe("2026-01-06T09:00:00+08:00");
    expect(result.suspensionEndDate).toBe("2026-01-04");
    expect(result.scheduledPaymentDate).toBe("2026-01-07");
  });
  it("repayment: classify confirmed fee later → preserve zero additional bank cash", () => {
    expect(toRepayment({ id: "fee", evidenceReference: "synthetic-fee", receivedDate: "2026-01-08", grossAmount: "5", cashAmount: "0", feeAmount: "5" })).toMatchObject({ grossAmount: 5, cashAmount: 0, feeAmount: 5 });
  });
  it("fraction: apply proceeds against fee → preserve zero deposit and separate expenses", () => {
    expect(toFractionSettlement({ id: "fraction", evidenceReference: "synthetic-fee-offset", receivedDate: "2026-01-09", grossAmount: "2", processingFeeAmount: "5", feeOffsetAmount: "2", cashAmount: "0", feeCashPaidAmount: "0" })).toMatchObject({ grossAmount: 2, processingFeeAmount: 5, feeOffsetAmount: 2, cashAmount: 0, feeCashPaidAmount: 0 });
  });
  it("later fee payment: retain independent date and evidence → pay recorded expense without another fee", () => {
    const originalSettlement = toFractionSettlement({ id: "fraction", evidenceReference: "synthetic-offset", receivedDate: "2026-01-09", grossAmount: "2", processingFeeAmount: "5", feeOffsetAmount: "2", cashAmount: "0", feeCashPaidAmount: "0" });
    const payment = toFractionAdjustment({ ...createFractionAdjustmentForm(), id: "later-payment", evidenceReference: "synthetic-payment", occurredDate: "2026-01-12", feeCashPaidAmount: "3" });
    expect(payment).toEqual({ id: "later-payment", evidenceReference: "synthetic-payment", occurredDate: "2026-01-12", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 0, feeCashPaidAmount: 3 });
    expect(originalSettlement).toMatchObject({ receivedDate: "2026-01-09", grossAmount: 2, processingFeeAmount: 5, feeCashPaidAmount: 0 });
    expect(toFractionAdjustment(fractionAdjustmentToForm(payment))).toEqual(payment);
  });
  it("later fee classification: offset retained proceeds → preserve new fee, offset and zero bank deposit separately", () => {
    const classification = toFractionAdjustment({ ...createFractionAdjustmentForm(), id: "classification", evidenceReference: "synthetic-later-fee", occurredDate: "2026-01-13", processingFeeAmount: "3", feeOffsetAmount: "2" });
    expect(classification).toMatchObject({ occurredDate: "2026-01-13", processingFeeAmount: 3, feeOffsetAmount: 2, cashAmount: 0, feeCashPaidAmount: 0 });
  });
  it("later fractional cash receipt: allocate prior confirmed proceeds → leave newly confirmed fee at zero", () => {
    const receipt = toFractionAdjustment({ ...createFractionAdjustmentForm(), id: "later-cash", evidenceReference: "synthetic-cash", occurredDate: "2026-01-14", cashAmount: "2" });
    expect(receipt).toMatchObject({ occurredDate: "2026-01-14", processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 2, feeCashPaidAmount: 0 });
  });
  it("later fee evidence: reject missing date or negative payment → require supported nonnegative facts", () => {
    expect(() => toFractionAdjustment(createFractionAdjustmentForm())).toThrow("INVALID_EVIDENCE");
    expect(() => toFractionAdjustment({ ...createFractionAdjustmentForm(), id: "bad-payment", evidenceReference: "synthetic-bad", occurredDate: "2026-01-14", feeCashPaidAmount: "-1" })).toThrow("INVALID_AMOUNT");
  });
  it("conversion eligibility: compare independent effective time → block financial posting until Taiwan effective instant", () => {
    const now = Date.parse("2026-02-05T00:59:59Z");
    expect(isFutureCapitalReductionConversion({ conversionDate: "2026-02-05", conversionTimestamp: "2026-02-05T09:00:00+08:00" }, now)).toBe(true);
    expect(isFutureCapitalReductionConversion({ conversionDate: "2026-02-05", conversionTimestamp: "2026-02-05T09:00:00+08:00" }, now + 1000)).toBe(false);
  });
  it("Taiwan calendar: conversion date arrives before UTC midnight → permit current local date without scheduling", () => {
    const now = Date.parse("2026-02-04T16:00:00Z");
    expect(isFutureCapitalReductionConversion({ conversionDate: "2026-02-05" }, now)).toBe(false);
    expect(isFutureCapitalReductionConversion({ conversionDate: "2026-02-06" }, now)).toBe(true);
  });

  it("reused source: render UTC evidence in Taiwan time → show correct effective time without changing source evidence", () => {
    const source = { ...createAnnouncementForm("SYNTH"), version: 1, conversionDate: "2026-02-05", conversionTimestamp: "2026-02-05T01:00:00Z" };
    expect(announcementToForm(source).conversionDate).toBe("2026-02-05T09:00");
    expect(source.conversionTimestamp).toBe("2026-02-05T01:00:00Z");
  });

});
