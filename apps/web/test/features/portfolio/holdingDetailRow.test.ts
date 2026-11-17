import { describe, expect, it } from "vitest";
import type { DashboardOverviewHoldingChildDto, DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";
import { resolveCurrentHoldingDetail } from "../../../features/portfolio/holdingDetailRow";

describe("open holding detail", () => {
  it("account refresh: resolve current row → show updated conversion and valuation in the existing sheet", () => {
    const selected = { ticker: "SYNTH", marketCode: "TW", accountId: "synthetic-a", quantity: 1000 } as DashboardOverviewHoldingChildDto;
    const updated = { ...selected, quantity: 542, capitalReductionValuation: { status: "OFFICIAL_REFERENCE", valuationDate: "2026-01-06" } } as DashboardOverviewHoldingChildDto;
    const otherAccount = { ...selected, accountId: "synthetic-b", quantity: 999 };
    const groups = [{ ticker: "SYNTH", marketCode: "TW", children: [otherAccount, updated] }] as DashboardOverviewHoldingGroupDto[];
    expect(resolveCurrentHoldingDetail(selected, groups)).toBe(updated);
  });
  it("group refresh: retain selected security and venue → replace stale aggregated detail", () => {
    const selected = { ticker: "SYNTH", marketCode: "TW", children: [], quantity: 1000 } as unknown as DashboardOverviewHoldingGroupDto;
    const updated = { ...selected, quantity: 542 };
    expect(resolveCurrentHoldingDetail(selected, [{ ...updated, marketCode: "US" }, updated])).toBe(updated);
    expect(resolveCurrentHoldingDetail(null, [updated])).toBeNull();
  });
});
