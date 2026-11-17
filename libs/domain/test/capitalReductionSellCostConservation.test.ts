import { describe, expect, it } from "vitest";
import { allocateSellLots, type Lot } from "../src/index.js";

const converted: Lot = { id: "synthetic-converted-purchase", accountId: "synthetic-account", ticker: "SYNTH", openQuantity: 542, totalCostAmount: 25418.69, costCurrency: "TWD", openedAt: "2026-01-02" };
const inCents = (value: number) => Math.round(value * 100);
describe("capital reduction WAC sale cost conservation", () => {
  it("[R06 full sale]: sell542 → consume exact25418.69 with no residual cost", () => {
    const sale = allocateSellLots([converted], 542);
    expect(sale.averageCostAmount).toBe(46.9);
    expect(sale.allocatedCostAmount).toBe(25418.69);
    expect(sale.matchedAllocations.reduce((sum, row) => inCents(row.allocatedCostAmount) + sum, 0)).toBe(2541869);
    expect(sale.updatedLots.every(row => row.openQuantity === 0 && row.totalCostAmount === 0)).toBe(true);
  });
  it("[R06 sequential sales]: sell100 then442 → cost4689.80 plus20728.89 exactly", () => {
    const first = allocateSellLots([converted], 100);
    expect(first.allocatedCostAmount).toBe(4689.8);
    expect(first.updatedLots[0]).toMatchObject({ openQuantity: 442, totalCostAmount: 20728.89 });
    const last = allocateSellLots(first.updatedLots, 442);
    expect(last.allocatedCostAmount).toBe(20728.89);
    expect(inCents(first.allocatedCostAmount) + inCents(last.allocatedCostAmount)).toBe(2541869);
  });
  it("[R06 multi-lot WAC]: distinct purchase costs → proportional cost conserved across matched lots", () => {
    const lots = [{ ...converted, id: "synthetic-a", openQuantity: 271, totalCostAmount: 10000 }, { ...converted, id: "synthetic-b", openQuantity: 271, totalCostAmount: 15418.69, openedAt: "2026-01-03" }];
    const first = allocateSellLots(lots, 300);
    expect(first.allocatedCostAmount).toBe(14069.39);
    expect(first.matchedAllocations).toHaveLength(2);
    expect(first.matchedAllocations.reduce((sum, row) => sum + inCents(row.allocatedCostAmount), 0)).toBe(inCents(first.allocatedCostAmount));
    const remaining = first.updatedLots.reduce((sum, row) => sum + inCents(row.totalCostAmount), 0);
    expect(remaining + inCents(first.allocatedCostAmount)).toBe(2541869);
    expect(inCents(allocateSellLots(first.updatedLots, 242).allocatedCostAmount)).toBe(remaining);
  });
  it("[R06 half-cent boundary]: cost0.03 over2 shares → first0.02 and final0.01", () => {
    const first = allocateSellLots([{ ...converted, openQuantity: 2, totalCostAmount: 0.03 }], 1);
    expect(first.allocatedCostAmount).toBe(0.02);
    const final = allocateSellLots(first.updatedLots, 1);
    expect(final.allocatedCostAmount).toBe(0.01);
    expect(inCents(first.allocatedCostAmount) + inCents(final.allocatedCostAmount)).toBe(3);
  });
});
