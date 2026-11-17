import type { EnrichedCashLedgerEntry } from "../types";

/** Parent history and individual cash effects have distinct durable identities. */
export function capitalReductionCashReferences(entry: Pick<EnrichedCashLedgerEntry, "relatedCapitalReductionId" | "sourceReference">): { actionReference: string | null; componentReference: string | null } {
  return { actionReference: entry.relatedCapitalReductionId ?? null, componentReference: entry.sourceReference ?? null };
}
