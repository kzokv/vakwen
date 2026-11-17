import type { DashboardOverviewHoldingChildDto, DashboardOverviewHoldingGroupDto } from "@vakwen/shared-types";

type HoldingDetailRow = DashboardOverviewHoldingChildDto | DashboardOverviewHoldingGroupDto;

/** An open sheet follows refreshed accounting data without losing its selected account. */
export function resolveCurrentHoldingDetail(selected: HoldingDetailRow | null, groups: DashboardOverviewHoldingGroupDto[]): HoldingDetailRow | null {
  if (!selected) return null;
  const group = groups.find(item => item.ticker === selected.ticker && item.marketCode === selected.marketCode);
  if (!group) return selected;
  return "accountId" in selected ? group.children.find(child => child.accountId === selected.accountId) ?? selected : group;
}
