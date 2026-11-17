import type { Lot } from "./types.js";

export interface CashCapitalReductionInput {
  lots: readonly Lot[];
  ratioNumerator: string;
  ratioDenominator: string;
  repaymentPerOldShare: string;
  payoutRounding: "FLOOR" | "HALF_UP";
  confirmedWholeQuantity: number;
  fractionReferencePrice?: string;
}
export interface CapitalReductionLotAllocation {
  lotId: string;
  oldQuantity: number;
  oldCostAmount: number;
  wholeQuantity: number;
  repaymentAmount: number;
  wholeCostAmount: number;
}
export interface CashCapitalReductionCalculation {
  theoreticalQuantity: string;
  wholeQuantity: number;
  fractionalQuantity: string;
  grossRepaymentAmount: number;
  remainingCostAmount: number;
  wholeCostAmount: number;
  fractionalCostAmount: number;
  estimatedFractionAmount: number | null;
  lots: Lot[];
  allocations: CapitalReductionLotAllocation[];
}
export interface CapitalRepaymentReceipt {
  id: string;
  evidenceReference: string;
  receivedDate: string;
  grossAmount: number;
  cashAmount: number;
  feeAmount: number;
}
export interface CapitalFractionSettlement {
  id: string;
  evidenceReference: string;
  receivedDate: string;
  grossAmount: number;
  processingFeeAmount: number;
  feeOffsetAmount: number;
  cashAmount: number;
  feeCashPaidAmount: number;
}
export interface CapitalFractionAdjustment {
  id: string;
  evidenceReference: string;
  occurredDate: string;
  processingFeeAmount: number;
  feeOffsetAmount: number;
  cashAmount: number;
  feeCashPaidAmount: number;
}
export interface CapitalReductionSettlementInput {
  repaymentReceipts: readonly CapitalRepaymentReceipt[];
  fractionSettlement?: CapitalFractionSettlement;
  fractionAdjustments?: readonly CapitalFractionAdjustment[];
}

interface Rational { n: bigint; d: bigint }
const decimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/;
function decimal(value: string): Rational {
  if (!decimalPattern.test(value)) throw new Error("Expected an exact nonnegative decimal string");
  const [whole, fraction = ""] = value.split(".");
  return { n: BigInt(whole + fraction), d: 10n ** BigInt(fraction.length) };
}
function multiply(a: Rational, b: Rational): Rational { return { n: a.n * b.n, d: a.d * b.d }; }
function divide(a: Rational, b: Rational): Rational {
  if (b.n === 0n) throw new Error("Ratio denominator must be positive");
  return { n: a.n * b.d, d: a.d * b.n };
}
function rounded(value: Rational, mode: "FLOOR" | "HALF_UP"): bigint {
  return value.n / value.d + (mode === "HALF_UP" && (value.n % value.d) * 2n >= value.d ? 1n : 0n);
}
function exactString(value: Rational): string {
  let a=value.n, b=value.d;
  while (b) { const remainder=a%b; a=b; b=remainder; }
  const divisor=a || 1n, numerator=value.n/divisor, denominator=value.d/divisor;
  let finite=denominator;
  while (finite%2n===0n) finite/=2n;
  while (finite%5n===0n) finite/=5n;
  if (finite!==1n) return `${numerator}/${denominator}`;
  let n=numerator;
  const whole=n/denominator;
  n%=denominator;
  if (!n) return String(whole);
  let digits="";
  while (n) { n*=10n; digits+=String(n/denominator); n%=denominator; }
  return `${whole}.${digits}`;
}

function safeNumber(value: bigint): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Amount exceeds supported exact range");
  return result;
}
function cents(amount: number): bigint {
  if (!Number.isFinite(amount) || amount < 0) throw new Error("Amount must be finite and nonnegative");
  const value = decimal(amount.toFixed(2));
  if (Math.abs(Number(value.n) / Number(value.d) - amount) > 1e-8) throw new Error("Currency amount must have at most two decimal places");
  return value.n * 100n / value.d;
}
function money(value: bigint): number { return safeNumber(value) / 100; }
function lotOrder(a: Lot, b: Lot): number {
  return a.openedAt.localeCompare(b.openedAt) || (a.openedSequence ?? 0) - (b.openedSequence ?? 0) || a.id.localeCompare(b.id);
}
/** Integer Hamilton apportionment: stable input order resolves exact ties. */
function allocate(total: bigint, weights: readonly bigint[]): bigint[] {
  const sum = weights.reduce((a, b) => a + b, 0n);
  if (sum === 0n) {
    if (total !== 0n) throw new Error("Cannot allocate money without a positive entitlement");
    return weights.map(() => 0n);
  }
  const rows = weights.map((weight, index) => ({ index, amount: total * weight / sum, remainder: total * weight % sum }));
  let left = total - rows.reduce((a, b) => a + b.amount, 0n);
  for (const row of [...rows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (left === 0n) break;
    row.amount += 1n;
    left -= 1n;
  }
  return rows.map((row) => row.amount);
}

/** Validate reusable source terms before publishing an immutable announcement version. */
export function validateCashCapitalReductionTerms(input: Pick<CashCapitalReductionInput,"ratioNumerator"|"ratioDenominator"|"repaymentPerOldShare"|"payoutRounding">): void {
  const ratio=divide(decimal(input.ratioNumerator),decimal(input.ratioDenominator));
  if (ratio.n<=0n || ratio.n>=ratio.d) throw new Error("Cash capital reduction replacement ratio must be between zero and one");
  decimal(input.repaymentPerOldShare);
  if (input.payoutRounding!=="FLOOR" && input.payoutRounding!=="HALF_UP") throw new Error("Unsupported capital repayment rounding rule");
}

export function calculateCashCapitalReduction(input: CashCapitalReductionInput): CashCapitalReductionCalculation {
  validateCashCapitalReductionTerms(input);
  const lots = input.lots.filter((lot) => lot.openQuantity > 0).sort(lotOrder);
  if (!lots.length || new Set(lots.map((lot) => lot.id)).size !== lots.length) throw new Error("Eligible lots must be nonempty and unique");
  if (new Set(lots.map((lot) => `${lot.accountId}:${lot.ticker}:${lot.costCurrency}`)).size !== 1 || lots.some((lot) => lot.costCurrency !== "TWD")) throw new Error("Conversion requires one TWD account and security");
  for (const lot of lots) if (!Number.isSafeInteger(lot.openQuantity)) throw new Error("Eligible quantity must be a positive whole number");
  const ratio = divide(decimal(input.ratioNumerator), decimal(input.ratioDenominator));
  if (ratio.n <= 0n || ratio.n >= ratio.d) throw new Error("Cash capital reduction replacement ratio must be between zero and one");
  const quantities = lots.map((lot) => BigInt(lot.openQuantity));
  const oldQuantity = quantities.reduce((a, b) => a + b, 0n);
  const theoretical = multiply({ n: oldQuantity, d: 1n }, ratio);
  const whole = theoretical.n / theoretical.d;
  if (!Number.isSafeInteger(input.confirmedWholeQuantity) || BigInt(input.confirmedWholeQuantity) !== whole) throw new Error("Confirmed delivered quantity differs from expected whole entitlement");
  const fractional: Rational = { n: theoretical.n % theoretical.d, d: theoretical.d };
  const shareRows = quantities.map((quantity, index) => ({ index, amount: quantity * ratio.n / ratio.d, remainder: quantity * ratio.n % ratio.d }));
  let sharesLeft = whole - shareRows.reduce((a, b) => a + b.amount, 0n);
  for (const row of [...shareRows].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (!sharesLeft) break;
    row.amount += 1n; sharesLeft -= 1n;
  }
  const oldCosts = lots.map((lot) => cents(lot.totalCostAmount));
  const oldCost = oldCosts.reduce((a, b) => a + b, 0n);
  // Published TWD payout rounds once to whole dollars at account scope.
  const gross = rounded(multiply({ n: oldQuantity, d: 1n }, decimal(input.repaymentPerOldShare)), input.payoutRounding) * 100n;
  if (gross > oldCost) throw new Error("Gross repayment exceeds remaining acquisition cost");
  const repayments = allocate(gross, quantities);
  if (repayments.some((amount, index) => amount > oldCosts[index])) throw new Error("Repayment allocated to a lot exceeds its remaining cost");
  const remaining = oldCost - gross;
  const [wholeCost, fractionalCost] = allocate(remaining, [whole * theoretical.d, fractional.n]);
  const retainedCosts = allocate(wholeCost, shareRows.map((row) => row.amount));
  const next = lots.map((lot, index) => ({ ...lot, openQuantity: safeNumber(shareRows[index].amount), totalCostAmount: money(retainedCosts[index]) }));
  return {
    theoreticalQuantity: exactString(theoretical), wholeQuantity: safeNumber(whole), fractionalQuantity: exactString(fractional),
    grossRepaymentAmount: money(gross), remainingCostAmount: money(remaining), wholeCostAmount: money(wholeCost), fractionalCostAmount: money(fractionalCost),
    estimatedFractionAmount: !fractional.n ? 0 : input.fractionReferencePrice === undefined ? null : safeNumber(rounded(multiply(fractional, decimal(input.fractionReferencePrice)), "FLOOR")),
    lots: input.lots.map((lot) => next.find((row) => row.id === lot.id) ?? { ...lot }),
    allocations: lots.map((lot, index) => ({ lotId: lot.id, oldQuantity: lot.openQuantity, oldCostAmount: lot.totalCostAmount, wholeQuantity: next[index].openQuantity, repaymentAmount: money(repayments[index]), wholeCostAmount: next[index].totalCostAmount })),
  };
}

function assertCalendarDate(value: string): void {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) throw new Error("Settlement date must be an actual calendar date");
}
export function calculateCapitalReductionSettlement(conversion: CashCapitalReductionCalculation, input: CapitalReductionSettlementInput) {
  for (const receipt of input.repaymentReceipts) assertCalendarDate(receipt.receivedDate);
  if (input.fractionSettlement) assertCalendarDate(input.fractionSettlement.receivedDate);
  for (const adjustment of input.fractionAdjustments ?? []) {
    assertCalendarDate(adjustment.occurredDate);
    if (!input.fractionSettlement || adjustment.occurredDate < input.fractionSettlement.receivedDate) throw new Error("Fraction adjustment date cannot be before initial settlement");
  }
  const components = [...input.repaymentReceipts, ...(input.fractionSettlement ? [input.fractionSettlement] : []), ...(input.fractionAdjustments ?? [])];
  if (new Set(components.map((row) => row.id)).size !== components.length || new Set(components.map((row) => row.evidenceReference)).size !== components.length) throw new Error("Duplicate settlement component or evidence");
  let settled = 0n; let cash = 0n; let fee = 0n;
  for (const receipt of input.repaymentReceipts) {
    const gross = cents(receipt.grossAmount); const deposited = cents(receipt.cashAmount); const deduction = cents(receipt.feeAmount);
    if (gross !== deposited + deduction) throw new Error("Repayment gross must equal cash plus confirmed fees");
    settled += gross; cash += deposited; fee += deduction;
  }
  const outstanding = cents(conversion.grossRepaymentAmount) - settled;
  if (outstanding < 0n) throw new Error("Repayment settlement exceeds outstanding receivable");
  let fractionalRealized = 0n; let outstandingFractionFee = 0n; let outstandingFractionProceeds = 0n;
  const fraction = input.fractionSettlement;
  if (fraction) {
    if (conversion.fractionalQuantity === "0") throw new Error("No fractional entitlement to settle");
    const proceeds = cents(fraction.grossAmount);
    let expense=0n,offset=0n,deposit=0n,paid=0n;
    const dated = [{...fraction,occurredDate:fraction.receivedDate},...(input.fractionAdjustments ?? [])].sort((a,b)=>a.occurredDate.localeCompare(b.occurredDate));
    for (let index=0;index<dated.length;index++) {
      const component=dated[index];
      expense+=cents(component.processingFeeAmount); offset+=cents(component.feeOffsetAmount);
      deposit+=cents(component.cashAmount); paid+=cents(component.feeCashPaidAmount);
      if (dated[index+1]?.occurredDate===component.occurredDate) continue;
      if (offset>proceeds || offset>expense || deposit+offset>proceeds || offset+paid>expense) throw new Error("Fraction settlement timeline exceeds supported proceeds or fee balance");
    }
    fractionalRealized = proceeds - cents(conversion.fractionalCostAmount);
    outstandingFractionFee = expense - offset - paid;
    outstandingFractionProceeds = proceeds - offset - deposit;
    cash += deposit - paid; fee += expense;
  }
  if (!fraction && input.fractionAdjustments?.length) throw new Error("Fraction adjustment requires confirmed gross settlement");
  return {
    outstandingRepaymentAmount: money(outstanding), cashAmount: money(cash), feeAmount: money(fee),
    fractionalRealizedAmount: money(fractionalRealized), outstandingFractionFeeAmount: money(outstandingFractionFee), outstandingFractionProceedsAmount: money(outstandingFractionProceeds),
    fractionalStatus: fraction ? "SETTLED" as const : conversion.fractionalQuantity === "0" ? "NONE" as const : "PENDING" as const,
    reconciled: outstanding === 0n && (conversion.fractionalQuantity === "0" || !!fraction) && outstandingFractionFee === 0n && outstandingFractionProceeds === 0n,
  };
}
