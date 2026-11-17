import { describe, expect, it } from "vitest";
import { capitalReductionCashReferences } from "../../../features/cash-ledger/utils/capitalReductionCashReferences";

describe("capital reduction cash source references", () => {
  it("partial receipts: preserve a shared parent action → display each independent cash effect separately", () => {
    const first = capitalReductionCashReferences({ relatedCapitalReductionId: "synthetic-action", sourceReference: "synthetic-first-receipt" });
    const later = capitalReductionCashReferences({ relatedCapitalReductionId: "synthetic-action", sourceReference: "synthetic-later-fee-payment" });
    expect(first).toEqual({ actionReference: "synthetic-action", componentReference: "synthetic-first-receipt" });
    expect(later).toEqual({ actionReference: "synthetic-action", componentReference: "synthetic-later-fee-payment" });
  });
  it("missing explicit parent: retain only effect identity → never infer an action from a source reference", () => {
    expect(capitalReductionCashReferences({ sourceReference: "cr-cash-synthetic-action-receipt" })).toEqual({ actionReference: null, componentReference: "cr-cash-synthetic-action-receipt" });
  });
});
