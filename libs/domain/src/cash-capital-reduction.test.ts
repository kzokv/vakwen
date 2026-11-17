import { describe, expect, test } from "vitest";
import { calculateCashCapitalReduction, calculateCapitalReductionSettlement } from "./cash-capital-reduction.js";

const lot = (id: string, openQuantity: number, totalCostAmount: number, openedAt = "2026-01-01", openedSequence = 1) => ({
  id, accountId: "synthetic-account", ticker: "SYNTH", openQuantity, totalCostAmount,
  costCurrency: "TWD", openedAt, openedSequence,
});
const terms = {
  ratioNumerator: "542.0491512", ratioDenominator: "1000",
  repaymentPerOldShare: "4.579", payoutRounding: "FLOOR" as const,
  confirmedWholeQuantity: 542, fractionReferencePrice: "56.70",
};

describe("cash capital reduction", () => {
  test("synthetic conversion: exact published ratio → whole shares, receivable and conserved fraction cost", () => {
    const result = calculateCashCapitalReduction({ lots: [lot("original-buy", 1000, 30000)], ...terms });
    expect(result).toMatchObject({
      theoreticalQuantity: "542.0491512", wholeQuantity: 542, fractionalQuantity: "0.0491512",
      grossRepaymentAmount: 4579, remainingCostAmount: 25421,
      wholeCostAmount: 25418.69, fractionalCostAmount: 2.31, estimatedFractionAmount: 2,
    });
    expect(result.lots).toEqual([expect.objectContaining({ id: "original-buy", openQuantity: 542, totalCostAmount: 25418.69 })]);
  });

  test("two equal remainders: account entitlement → one whole share retained by earliest purchase", () => {
    const result = calculateCashCapitalReduction({
      lots: [lot("later", 1, 100, "2026-01-02"), lot("earlier", 1, 100)],
      ...terms, ratioNumerator: "1", ratioDenominator: "2", repaymentPerOldShare: "1", confirmedWholeQuantity: 1,
    });
    expect(result.wholeQuantity).toBe(1);
    expect(result.fractionalQuantity).toBe("0");
    expect(result.lots.find((item) => item.id === "earlier")).toMatchObject({ openQuantity: 1, totalCostAmount: 198 });
    expect(result.lots.find((item) => item.id === "later")).toMatchObject({ openQuantity: 0, totalCostAmount: 0 });
  });

  test("confirmed delivery: rounded whole entitlement mismatch → rejected", () => {
    expect(() => calculateCashCapitalReduction({ lots: [lot("buy", 1000, 30000)], ...terms, confirmedWholeQuantity: 543 })).toThrow(/deliver|quantity/i);
  });

  test("partial repayment: known net then fee classification → receivable settles without repeated deposit", () => {
    const conversion = calculateCashCapitalReduction({ lots: [lot("buy", 1000, 30000)], ...terms });
    const result = calculateCapitalReductionSettlement(conversion, { repaymentReceipts: [
      { id: "bank-credit", evidenceReference: "synthetic-credit", receivedDate: "2026-11-01", grossAmount: 4574, cashAmount: 4574, feeAmount: 0 },
      { id: "classification", evidenceReference: "synthetic-fee", receivedDate: "2026-11-02", grossAmount: 5, cashAmount: 0, feeAmount: 5 },
    ] });
    expect(result).toMatchObject({ outstandingRepaymentAmount: 0, cashAmount: 4574, feeAmount: 5 });
  });

  test("fraction proceeds applied against fee: explicit settlement → zero bank cash and separate result", () => {
    const conversion = calculateCashCapitalReduction({ lots: [lot("buy", 1000, 30000)], ...terms });
    const result = calculateCapitalReductionSettlement(conversion, { repaymentReceipts: [], fractionSettlement: {
      id: "fraction-settlement", evidenceReference: "synthetic-fraction", receivedDate: "2026-11-03",
      grossAmount: 2, processingFeeAmount: 3, feeOffsetAmount: 2, cashAmount: 0, feeCashPaidAmount: 0,
    } });
    expect(result).toMatchObject({ cashAmount: 0, fractionalRealizedAmount: -0.31, feeAmount: 3, outstandingFractionFeeAmount: 1, fractionalStatus: "SETTLED" });
  });
  test("precision boundary: more than six ratio places → account floor stays exact", () => {
    const result = calculateCashCapitalReduction({ lots: [lot("buy", 1000000, 30000000)], ...terms,
      ratioNumerator: "0.999999999999999999", ratioDenominator: "1", repaymentPerOldShare: "0", confirmedWholeQuantity: 999999 });
    expect(result.theoreticalQuantity).toBe("999999.999999999999");
    expect(result.wholeQuantity).toBe(999999);
  });
  test("all fraction: no delivered whole shares → residual cost remains on entitlement", () => {
    const result = calculateCashCapitalReduction({ lots: [lot("buy", 1, 30)], ...terms,
      ratioNumerator: "1", ratioDenominator: "2", repaymentPerOldShare: "4", confirmedWholeQuantity: 0 });
    expect(result).toMatchObject({ wholeCostAmount: 0, fractionalCostAmount: 26 });
    expect(result.lots[0]).toMatchObject({ openQuantity: 0, totalCostAmount: 0 });
  });
  test("repayment: lot contribution exceeds remaining cost → cannot shift excess to another purchase", () => {
    expect(() => calculateCashCapitalReduction({ lots: [lot("cheap", 1, 1), lot("expensive", 1, 99)], ...terms,
      ratioNumerator: "1", ratioDenominator: "2", repaymentPerOldShare: "2", confirmedWholeQuantity: 1 })).toThrow(/lot.*cost/i);
  });
  test("repayment: overpayment or duplicate application → rejected", () => {
    const conversion = calculateCashCapitalReduction({ lots: [lot("buy", 1000, 30000)], ...terms });
    const receipt = { id: "r", evidenceReference: "synthetic", receivedDate: "2026-11-01", grossAmount: 4580, cashAmount: 4580, feeAmount: 0 };
    expect(() => calculateCapitalReductionSettlement(conversion, { repaymentReceipts: [receipt] })).toThrow(/exceeds/);
    expect(() => calculateCapitalReductionSettlement(conversion, { repaymentReceipts: [receipt, receipt] })).toThrow(/Duplicate/);
  });

  test("fraction adjustment date: before initial confirmed settlement → rejected", () => {
    const conversion = calculateCashCapitalReduction({ lots: [lot("buy", 1000, 30000)], ...terms });
    expect(() => calculateCapitalReductionSettlement(conversion, { repaymentReceipts: [], fractionSettlement: {
      id: "gross", evidenceReference: "synthetic-gross", receivedDate: "2026-11-03", grossAmount: 2,
      processingFeeAmount: 0, feeOffsetAmount: 0, cashAmount: 0, feeCashPaidAmount: 0,
    }, fractionAdjustments: [{ id: "fee", evidenceReference: "synthetic-fee", occurredDate: "2026-11-02", processingFeeAmount: 3, feeOffsetAmount: 2, cashAmount: 0, feeCashPaidAmount: 0 }] })).toThrow(/date|before/i);
  });
  test("settlement date: nonexistent calendar day → rejected", () => {
    const conversion = calculateCashCapitalReduction({ lots: [lot("buy", 1000, 30000)], ...terms });
    expect(() => calculateCapitalReductionSettlement(conversion, { repaymentReceipts: [{ id: "r", evidenceReference: "synthetic", receivedDate: "2026-02-31", grossAmount: 1, cashAmount: 1, feeAmount: 0 }] })).toThrow(/date/i);
  });

  test("integer-rational entitlement: recurring published ratio → exact fractional ownership survives", () => {
    const result=calculateCashCapitalReduction({lots:[lot("buy",1,30)],...terms,ratioNumerator:"1",ratioDenominator:"3",repaymentPerOldShare:"0",confirmedWholeQuantity:0});
    expect(result).toMatchObject({theoreticalQuantity:"1/3",fractionalQuantity:"1/3",wholeQuantity:0,fractionalCostAmount:30,estimatedFractionAmount:18});
  });
  test("fraction gross then dated fee offset and payment → cost and expense recognized once", () => {
    const conversion=calculateCashCapitalReduction({lots:[lot("buy",1000,30000)],...terms});
    const base={id:"gross",evidenceReference:"synthetic-gross",receivedDate:"2026-11-01",grossAmount:2,processingFeeAmount:0,feeOffsetAmount:0,cashAmount:0,feeCashPaidAmount:0};
    expect(calculateCapitalReductionSettlement(conversion,{repaymentReceipts:[],fractionSettlement:base})).toMatchObject({outstandingFractionProceedsAmount:2,fractionalRealizedAmount:-.31,feeAmount:0});
    const result=calculateCapitalReductionSettlement(conversion,{repaymentReceipts:[],fractionSettlement:base,fractionAdjustments:[
      {id:"fee",evidenceReference:"synthetic-fee",occurredDate:"2026-11-02",processingFeeAmount:3,feeOffsetAmount:2,cashAmount:0,feeCashPaidAmount:0},
      {id:"payment",evidenceReference:"synthetic-payment",occurredDate:"2026-11-03",processingFeeAmount:0,feeOffsetAmount:0,cashAmount:0,feeCashPaidAmount:1},
    ]});
    expect(result).toMatchObject({outstandingFractionProceedsAmount:0,outstandingFractionFeeAmount:0,fractionalRealizedAmount:-.31,feeAmount:3,cashAmount:-1});
  });

  test("fraction timeline: fee payment before supported fee confirmation → rejected", () => {
    const conversion=calculateCashCapitalReduction({lots:[lot("buy",1000,30000)],...terms});
    expect(()=>calculateCapitalReductionSettlement(conversion,{repaymentReceipts:[],fractionSettlement:{id:"gross",evidenceReference:"synthetic-gross",receivedDate:"2026-11-01",grossAmount:2,processingFeeAmount:0,feeOffsetAmount:0,cashAmount:0,feeCashPaidAmount:0},fractionAdjustments:[
      {id:"offset",evidenceReference:"synthetic-offset",occurredDate:"2026-11-02",processingFeeAmount:0,feeOffsetAmount:2,cashAmount:0,feeCashPaidAmount:0},
      {id:"fee",evidenceReference:"synthetic-fee",occurredDate:"2026-11-03",processingFeeAmount:3,feeOffsetAmount:0,cashAmount:0,feeCashPaidAmount:0},
    ]})).toThrow(/supported|fee|balance/i);
  });

});
