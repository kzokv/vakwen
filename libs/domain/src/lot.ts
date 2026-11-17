import type { BuyApplicationResult, Lot, SellAllocationResult } from "./types.js";
import { roundToDecimal } from "./money.js";

export function applyBuyToLots(lots: Lot[], buyLot: Lot): BuyApplicationResult {
  assertWholePositiveQuantity(buyLot.openQuantity, "Buy quantity must be a positive integer");
  assertNonNegativeCost(buyLot.totalCostAmount);

  const updatedLots = normalizeLotsForWeightedAverage([...lots, buyLot]);
  const { averageCostAmount } = summarizeOpenLots(updatedLots);
  return { averageCostAmount, updatedLots };
}

export function allocateSellLots(lots: Lot[], quantityToSell: number): SellAllocationResult {
  assertWholePositiveQuantity(quantityToSell, "Sell quantity must be a positive integer");

  const normalizedLots = normalizeLotsForWeightedAverage(lots);
  const orderedLots = orderLots(normalizedLots);
  const { averageCostAmount, totalOpenCostAmount, totalOpenQuantity } = summarizeOpenLots(orderedLots);

  if (quantityToSell > totalOpenQuantity) {
    throw new Error("Insufficient quantity to sell");
  }

  // The rounded average is for display only. Allocate the aggregate cost in
  // cents so a sale cannot create cost or leave cost behind on liquidation.
  const totalOpenCostMinorUnits = costToMinorUnits(totalOpenCostAmount);
  const allocatedCostMinorUnits = roundNonNegativeRatio(
    totalOpenCostMinorUnits * BigInt(quantityToSell),
    BigInt(totalOpenQuantity),
  );
  const allocatedCostAmount = Number(allocatedCostMinorUnits) / 100;
  const remainingOpenCostAmount = Number(totalOpenCostMinorUnits - allocatedCostMinorUnits) / 100;

  let remainingQty = quantityToSell;
  const matchedLotIds: string[] = [];
  const matchedQuantities: Array<{ lot: Lot; quantity: number }> = [];
  const updates = new Map<string, Lot>();

  for (const lot of orderedLots) {
    if (remainingQty <= 0) break;
    if (lot.openQuantity <= 0) continue;

    const matchedQty = Math.min(remainingQty, lot.openQuantity);
    remainingQty -= matchedQty;

    updates.set(lot.id, {
      ...lot,
      openQuantity: lot.openQuantity - matchedQty,
      totalCostAmount: 0,
    });
    matchedLotIds.push(lot.id);
    matchedQuantities.push({ lot, quantity: matchedQty });
  }

  const matchedAllocations = allocateMatchedLotCosts(matchedQuantities, allocatedCostAmount, quantityToSell);

  const openLots = orderedLots
    .map((lot) => updates.get(lot.id) ?? lot)
    .filter((lot) => lot.openQuantity > 0);

  const normalizedOpenLots = normalizeLotsForWeightedAverage(openLots, remainingOpenCostAmount);
  for (const lot of normalizedOpenLots) {
    updates.set(lot.id, lot);
  }

  const updatedLots = normalizedLots.map((lot) => updates.get(lot.id) ?? lot);
  return { matchedLotIds, matchedAllocations, allocatedCostAmount, averageCostAmount, updatedLots };
}

function roundNonNegativeRatio(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  return quotient + (remainder * 2n >= denominator ? 1n : 0n);
}

function costToMinorUnits(amount: number): bigint {
  // Parse the decimal representation rather than multiplying a binary float
  // by 100; that multiplication can put an exact half-cent below the tie.
  const [coefficient, exponent = "0"] = amount.toString().split(/e/i);
  const [whole, fraction = ""] = coefficient.split(".");
  const digits = BigInt(whole + fraction);
  const scale = fraction.length - Number(exponent) - 2;
  return scale <= 0
    ? digits * 10n ** BigInt(-scale)
    : roundNonNegativeRatio(digits, 10n ** BigInt(scale));
}

function normalizeLotsForWeightedAverage(lots: Lot[], forcedTotalCostAmount?: number): Lot[] {
  if (lots.length === 0) return [];

  const orderedOpenLots = orderLots(
    lots.filter((lot) => lot.openQuantity > 0).map((lot) => {
      assertWholePositiveQuantity(lot.openQuantity, "Lot quantity must be a positive integer");
      assertNonNegativeCost(lot.totalCostAmount);
      return lot;
    }),
  );

  const totalOpenQuantity = orderedOpenLots.reduce((sum, lot) => sum + lot.openQuantity, 0);
  if (totalOpenQuantity === 0) {
    return lots.map((lot) => ({ ...lot, totalCostAmount: 0 }));
  }

  let costLeftToAssign =
    forcedTotalCostAmount ?? orderedOpenLots.reduce((sum, lot) => sum + Math.max(0, lot.totalCostAmount), 0);
  let quantityLeftToAssign = totalOpenQuantity;

  const normalizedCosts = new Map<string, number>();
  for (let index = 0; index < orderedOpenLots.length; index += 1) {
    const lot = orderedOpenLots[index];
    const isLast = index === orderedOpenLots.length - 1;
    const nextCost = isLast
      ? costLeftToAssign
      : roundToDecimal((costLeftToAssign * lot.openQuantity) / quantityLeftToAssign, 2);
    normalizedCosts.set(lot.id, nextCost);
    costLeftToAssign = roundToDecimal(costLeftToAssign - nextCost, 2);
    quantityLeftToAssign -= lot.openQuantity;
  }

  return lots.map((lot) =>
    lot.openQuantity > 0
      ? {
          ...lot,
          totalCostAmount: normalizedCosts.get(lot.id) ?? 0,
        }
      : {
          ...lot,
          totalCostAmount: 0,
        },
  );
}

function orderLots(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const openedAtCompare = a.openedAt.localeCompare(b.openedAt);
    if (openedAtCompare !== 0) return openedAtCompare;
    const openedSequenceCompare = (a.openedSequence ?? 0) - (b.openedSequence ?? 0);
    if (openedSequenceCompare !== 0) return openedSequenceCompare;
    return a.id.localeCompare(b.id);
  });
}

function allocateMatchedLotCosts(
  matches: Array<{ lot: Lot; quantity: number }>,
  allocatedCostAmount: number,
  quantityToSell: number,
): SellAllocationResult["matchedAllocations"] {
  let costLeftToAssign = allocatedCostAmount;
  let quantityLeftToAssign = quantityToSell;

  return matches.map(({ lot, quantity }, index) => {
    const isLast = index === matches.length - 1;
    const nextCost = isLast ? costLeftToAssign : roundToDecimal((costLeftToAssign * quantity) / quantityLeftToAssign, 2);
    costLeftToAssign = roundToDecimal(costLeftToAssign - nextCost, 2);
    quantityLeftToAssign -= quantity;

    return {
      lotId: lot.id,
      quantity,
      allocatedCostAmount: nextCost,
      costCurrency: lot.costCurrency,
      openedAt: lot.openedAt,
      openedSequence: lot.openedSequence,
    };
  });
}

function summarizeOpenLots(lots: Lot[]): {
  averageCostAmount: number;
  totalOpenCostAmount: number;
  totalOpenQuantity: number;
} {
  const totalOpenQuantity = lots.reduce((sum, lot) => sum + Math.max(0, lot.openQuantity), 0);
  const totalOpenCostAmount = lots.reduce((sum, lot) => sum + Math.max(0, lot.totalCostAmount), 0);
  return {
    averageCostAmount: totalOpenQuantity === 0 ? 0 : roundToDecimal(totalOpenCostAmount / totalOpenQuantity, 2),
    totalOpenCostAmount,
    totalOpenQuantity,
  };
}

function assertWholePositiveQuantity(quantity: number, message: string): void {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error(message);
  }
}

function assertNonNegativeCost(totalCostAmount: number): void {
  if (totalCostAmount < 0) {
    throw new Error("Lot cost must be non-negative");
  }
}
