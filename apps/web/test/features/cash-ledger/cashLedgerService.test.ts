import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("../../../lib/api", () => ({
  getJson: vi.fn(),
}));

import { getJson } from "../../../lib/api";
import { fetchCashLedgerEntries } from "../../../features/cash-ledger/services/cashLedgerService";

const mockGetJson = vi.mocked(getJson);

describe("fetchCashLedgerEntries", () => {
  beforeEach(() => {
    mockGetJson.mockReset();
    mockGetJson.mockResolvedValue({ entries: [], summary: [], total: 0 });
  });

  it("passes page as query param", async () => {
    await fetchCashLedgerEntries({ page: 2 });
    expect(mockGetJson).toHaveBeenCalledWith(
      expect.stringContaining("page=2"),
    );
  });

  it("passes sortBy as query param", async () => {
    await fetchCashLedgerEntries({ sortBy: "amount" });
    expect(mockGetJson).toHaveBeenCalledWith(
      expect.stringContaining("sortBy=amount"),
    );
  });

  it("passes sortOrder as query param", async () => {
    await fetchCashLedgerEntries({ sortOrder: "asc" });
    expect(mockGetJson).toHaveBeenCalledWith(
      expect.stringContaining("sortOrder=asc"),
    );
  });

  it("passes all pagination params together", async () => {
    await fetchCashLedgerEntries({ page: 3, sortBy: "entryDate", sortOrder: "desc" });
    const url = mockGetJson.mock.calls[0]![0] as string;
    expect(url).toContain("page=3");
    expect(url).toContain("sortBy=entryDate");
    expect(url).toContain("sortOrder=desc");
  });

  it("omits pagination params when not provided", async () => {
    await fetchCashLedgerEntries({});
    const url = mockGetJson.mock.calls[0]![0] as string;
    expect(url).not.toContain("page=");
    expect(url).not.toContain("sortBy=");
    expect(url).not.toContain("sortOrder=");
  });
  it("capital reduction filters: query actual receipt and fee-payment categories → preserve separate entry types", async () => {
    await fetchCashLedgerEntries({ entryType: ["CAPITAL_REPAYMENT_RECEIPT", "CAPITAL_FRACTION_RECEIPT", "CAPITAL_REDUCTION_FEE_PAYMENT"] });
    const url = mockGetJson.mock.calls[0]![0] as string;
    const params = new URLSearchParams(url.split("?")[1]);
    expect(params.getAll("entryType")).toEqual(["CAPITAL_REPAYMENT_RECEIPT", "CAPITAL_FRACTION_RECEIPT", "CAPITAL_REDUCTION_FEE_PAYMENT"]);
    expect(params.getAll("entryType")).not.toContain("MANUAL_ADJUSTMENT");
    expect(params.getAll("entryType")).not.toContain("FX_TRANSFER_IN");
  });

  it("cash response: retain explicit camel-case capital reduction parent → keep component reference independent", async () => {
    mockGetJson.mockResolvedValue({ entries: [{ id: "synthetic-receipt", relatedCapitalReductionId: "synthetic-action", sourceReference: "synthetic-receipt-effect" }], summary: [], total: 1 });
    const response = await fetchCashLedgerEntries();
    expect(response.entries[0]).toMatchObject({ relatedCapitalReductionId: "synthetic-action", sourceReference: "synthetic-receipt-effect" });
  });

});
